#!/usr/bin/env node

const https = require('https');
const { upsertViaRpc } = require('./lib/upsert_rpc');

// Configurações
const IUGU_API_TOKEN =
  process.env.IUGU_API_TOKEN || '9225D1D7C8065F541CDDD73D9B9AFD4BEF07F815ACA09519530DDD8568F0C0D2';
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

const iuguHeaders = {
  Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
  'Content-Type': 'application/json',
};

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
};

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    if (options.body) {
      req.write(options.body);
    }

    req.on('error', reject);
    req.end();
  });
}

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

function parseIuguDate(dateString) {
  if (!dateString) return null;

  if (typeof dateString === 'string' && dateString.includes('T')) {
    return dateString;
  }

  if (typeof dateString === 'string') {
    const ddmmPattern = /^(\d{2})\/(\d{2}),\s*(\d{2}):(\d{2})$/;
    const ddmmMatch = dateString.match(ddmmPattern);
    if (ddmmMatch) {
      const [, day, month, hour, minute] = ddmmMatch;
      const currentYear = new Date().getFullYear();
      return `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:00Z`;
    }

    const monthNamePattern = /^(\d{1,2})\s+(\w{3})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i;
    const monthNameMatch = dateString.match(monthNamePattern);
    if (monthNameMatch) {
      const [, day, monthName, hour, minute, ampm] = monthNameMatch;
      const months = {
        jan: '01',
        feb: '02',
        mar: '03',
        apr: '04',
        may: '05',
        jun: '06',
        jul: '07',
        aug: '08',
        sep: '09',
        oct: '10',
        nov: '11',
        dec: '12',
      };
      const month = months[monthName.toLowerCase()];
      if (month) {
        let hour24 = parseInt(hour);
        if (ampm.toUpperCase() === 'PM' && hour24 !== 12) hour24 += 12;
        if (ampm.toUpperCase() === 'AM' && hour24 === 12) hour24 = 0;

        const currentYear = new Date().getFullYear();
        return `${currentYear}-${month}-${day.padStart(2, '0')}T${hour24.toString().padStart(2, '0')}:${minute}:00Z`;
      }
    }

    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (dateOnlyPattern.test(dateString)) {
      return `${dateString}T00:00:00Z`;
    }
  }

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (err) {
    return null;
  }
}

// Buscar TODOS os clientes (não apenas 1.000)
async function syncAllCustomers() {
  logWithTimestamp('👥 BUSCANDO TODOS OS CLIENTES DA IUGU');

  try {
    let page = 1;
    let totalSynced = 0;
    let hasMore = true;

    while (hasMore) {
      const customersUrl = `${IUGU_API_BASE_URL}/customers?limit=100&start=${(page - 1) * 100}`;
      const response = await makeRequest(customersUrl, {
        method: 'GET',
        headers: iuguHeaders,
      });

      if (!response.items || response.items.length === 0) {
        hasMore = false;
        break;
      }

      logWithTimestamp(`👥 Página ${page}: ${response.items.length} clientes`);

      for (const customer of response.items) {
        try {
          await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'customers', customer);
          totalSynced++;
        } catch (error) {
          if (!error.message.includes('duplicate key')) {
            // Log apenas primeiros erros para não poluir
            if (totalSynced < 5) {
              logWithTimestamp(`⚠️ Erro ao sincronizar cliente ${customer.id}: ${error.message}`);
            }
          }
        }
      }

      if (response.items.length < 100) {
        hasMore = false;
      } else {
        page++;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    logWithTimestamp(`✅ ${totalSynced} clientes sincronizados (novos)`);
    return totalSynced;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar clientes: ${error.message}`);
    return 0;
  }
}

// Buscar planos faltantes específicos
async function addMissingPlans() {
  logWithTimestamp('📋 ADICIONANDO PLANOS FALTANTES');

  const missingPlans = [
    'plano_otimizacao',
    'plano_controle',
    'planoinicial2x',
    'plano_escala',
    'plano_iniciacao',
  ];

  let added = 0;

  for (const planIdentifier of missingPlans) {
    try {
      // Criar plano dummy baseado no identifier
      const planPayload = {
        id: `DUMMY_${planIdentifier.toUpperCase()}`,
        identifier: planIdentifier,
        name: `Plano ${planIdentifier}`,
        interval: 1,
        interval_type: 'months',
        value_cents: 0,
        dummy: true,
      };

      await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'plans', planPayload);

      logWithTimestamp(`✅ Plano adicionado: ${planIdentifier}`);
      added++;
    } catch (error) {
      if (!error.message.includes('duplicate key')) {
        logWithTimestamp(`⚠️ Erro ao adicionar plano ${planIdentifier}: ${error.message}`);
      }
    }
  }

  return added;
}

async function main() {
  logWithTimestamp('🚀 COMPLETANDO ENTIDADES FALTANTES');
  console.log('====================================');

  const results = {
    customers: 0,
    plans: 0,
  };

  try {
    // 1. Sincronizar TODOS os clientes
    logWithTimestamp('🔄 Etapa 1: Buscando todos os clientes...');
    results.customers = await syncAllCustomers();

    // 2. Adicionar planos faltantes
    logWithTimestamp('🔄 Etapa 2: Adicionando planos faltantes...');
    results.plans = await addMissingPlans();

    console.log('\n📊 RESUMO:');
    console.log('==========');
    console.log(`👥 Clientes adicionados: ${results.customers}`);
    console.log(`📋 Planos adicionados: ${results.plans}`);

    logWithTimestamp('✅ ENTIDADES COMPLETADAS!');

    // Agora verificar totais
    logWithTimestamp('🔍 Verificando totais finais...');

    const customersTotal = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_customers?select=count`,
      {
        method: 'GET',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'count=exact',
        },
      }
    );

    const plansTotal = await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_plans?select=count`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'count=exact',
      },
    });

    console.log(`\n📈 TOTAIS FINAIS:`);
    console.log(`👥 Total clientes: ${customersTotal[0]?.count || 'N/A'}`);
    console.log(`📋 Total planos: ${plansTotal[0]?.count || 'N/A'}`);
  } catch (error) {
    logWithTimestamp(`❌ Erro: ${error.message}`);
    process.exit(1);
  }
}

main();
