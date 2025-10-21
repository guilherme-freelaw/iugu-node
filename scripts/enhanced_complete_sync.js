#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
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

  // Se já está em formato ISO, retorna
  if (typeof dateString === 'string' && dateString.includes('T')) {
    return dateString;
  }

  // Converte formatos da Iugu para ISO
  if (typeof dateString === 'string') {
    // Formato: "13/09, 13:49" -> "2025-09-13T13:49:00Z"
    const ddmmPattern = /^(\d{2})\/(\d{2}),\s*(\d{2}):(\d{2})$/;
    const ddmmMatch = dateString.match(ddmmPattern);
    if (ddmmMatch) {
      const [, day, month, hour, minute] = ddmmMatch;
      const currentYear = new Date().getFullYear();
      return `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:00Z`;
    }

    // Formato: "26 Feb 10:20 PM" -> "2025-02-26T22:20:00Z"
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

    // Formato: "2025-09-13" -> "2025-09-13T00:00:00Z"
    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (dateOnlyPattern.test(dateString)) {
      return `${dateString}T00:00:00Z`;
    }
  }

  // Se não conseguir converter, tenta criar data válida ou retorna null
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (err) {
    logWithTimestamp(`⚠️ Could not parse date: ${dateString}`);
    return null;
  }
}

// 1. Sincronizar Planos
async function syncPlans() {
  logWithTimestamp('📋 Sincronizando planos...');

  try {
    const plansUrl = `${IUGU_API_BASE_URL}/plans?limit=100`;
    const response = await makeRequest(plansUrl, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (!response.items || response.items.length === 0) {
      logWithTimestamp('📋 Nenhum plano encontrado');
      return 0;
    }

    let syncedCount = 0;

    for (const plan of response.items) {
      try {
        await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'plans', plan);
        syncedCount++;
      } catch (error) {
        logWithTimestamp(`⚠️ Erro ao sincronizar plano ${plan.id}: ${error.message}`);
      }
    }

    logWithTimestamp(`✅ ${syncedCount} planos sincronizados`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar planos: ${error.message}`);
    return 0;
  }
}

// 2. Sincronizar Assinaturas (melhorado)
async function syncSubscriptions() {
  logWithTimestamp('📋 Sincronizando assinaturas...');

  try {
    let page = 1;
    let totalSynced = 0;
    let hasMore = true;

    while (hasMore) {
      const subscriptionsUrl = `${IUGU_API_BASE_URL}/subscriptions?limit=100&start=${(page - 1) * 100}`;
      const response = await makeRequest(subscriptionsUrl, {
        method: 'GET',
        headers: iuguHeaders,
      });

      if (!response.items || response.items.length === 0) {
        hasMore = false;
        break;
      }

      logWithTimestamp(`📋 Processando página ${page} (${response.items.length} assinaturas)`);

      for (const subscription of response.items) {
        try {
          await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'subscriptions', subscription);
          totalSynced++;
        } catch (error) {
          logWithTimestamp(
            `⚠️ Erro ao sincronizar assinatura ${subscription.id}: ${error.message}`
          );
        }
      }

      if (response.items.length < 100) {
        hasMore = false;
      } else {
        page++;
        // Delay entre páginas
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    logWithTimestamp(`✅ ${totalSynced} assinaturas sincronizadas`);
    return totalSynced;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar assinaturas: ${error.message}`);
    return 0;
  }
}

// 3. Sincronizar Charges
async function syncCharges() {
  logWithTimestamp('💳 Sincronizando charges...');

  try {
    const chargesUrl = `${IUGU_API_BASE_URL}/charge?limit=100`;
    const response = await makeRequest(chargesUrl, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (!response.items || response.items.length === 0) {
      logWithTimestamp('💳 Nenhum charge encontrado');
      return 0;
    }

    let syncedCount = 0;

    for (const charge of response.items) {
      try {
        await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'charges', charge);
        syncedCount++;
      } catch (error) {
        logWithTimestamp(`⚠️ Erro ao sincronizar charge ${charge.id}: ${error.message}`);
      }
    }

    logWithTimestamp(`✅ ${syncedCount} charges sincronizados`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar charges: ${error.message}`);
    return 0;
  }
}

// 4. Sincronizar Payment Methods
async function syncPaymentMethods() {
  logWithTimestamp('💳 Sincronizando métodos de pagamento...');

  try {
    // Buscar alguns clientes para obter seus métodos de pagamento
    const customersResponse = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_customers?select=id&limit=50`,
      {
        method: 'GET',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let syncedCount = 0;

    for (const customer of customersResponse) {
      try {
        const paymentMethodsUrl = `${IUGU_API_BASE_URL}/customers/${customer.id}/payment_methods`;
        const response = await makeRequest(paymentMethodsUrl, {
          method: 'GET',
          headers: iuguHeaders,
        });

        if (response.items && response.items.length > 0) {
          for (const method of response.items) {
            try {
              await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'payment_methods', method);
              syncedCount++;
            } catch (error) {
              logWithTimestamp(`⚠️ Erro ao sincronizar método ${method.id}: ${error.message}`);
            }
          }
        }

        // Delay para não sobrecarregar API
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        // Cliente pode não ter métodos de pagamento, é normal
        continue;
      }
    }

    logWithTimestamp(`✅ ${syncedCount} métodos de pagamento sincronizados`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar métodos de pagamento: ${error.message}`);
    return 0;
  }
}

// 5. Sincronizar Transfers
async function syncTransfers() {
  logWithTimestamp('🔄 Sincronizando transferências...');

  try {
    const transfersUrl = `${IUGU_API_BASE_URL}/transfers?limit=100`;
    const response = await makeRequest(transfersUrl, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (!response.items || response.items.length === 0) {
      logWithTimestamp('🔄 Nenhuma transferência encontrada');
      return 0;
    }

    let syncedCount = 0;

    for (const transfer of response.items) {
      try {
        await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'transfers', transfer);
        syncedCount++;
      } catch (error) {
        logWithTimestamp(`⚠️ Erro ao sincronizar transferência ${transfer.id}: ${error.message}`);
      }
    }

    logWithTimestamp(`✅ ${syncedCount} transferências sincronizadas`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar transferências: ${error.message}`);
    return 0;
  }
}

async function main() {
  logWithTimestamp('🚀 INICIANDO SINCRONIZAÇÃO COMPLETA DE ENTIDADES');
  console.log('======================================================');

  const results = {
    plans: 0,
    subscriptions: 0,
    charges: 0,
    paymentMethods: 0,
    transfers: 0,
  };

  try {
    // Executar sincronizações em sequência
    results.plans = await syncPlans();
    results.subscriptions = await syncSubscriptions();
    results.charges = await syncCharges();
    results.paymentMethods = await syncPaymentMethods();
    results.transfers = await syncTransfers();

    console.log('\n📊 RESUMO FINAL:');
    console.log('================');
    console.log(`📋 Planos: ${results.plans}`);
    console.log(`📋 Assinaturas: ${results.subscriptions}`);
    console.log(`💳 Charges: ${results.charges}`);
    console.log(`💳 Métodos de pagamento: ${results.paymentMethods}`);
    console.log(`🔄 Transferências: ${results.transfers}`);

    const total = Object.values(results).reduce((sum, count) => sum + count, 0);
    console.log(`📊 Total sincronizado: ${total} registros`);

    logWithTimestamp('✅ SINCRONIZAÇÃO COMPLETA CONCLUÍDA!');
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização: ${error.message}`);
    process.exit(1);
  }
}

main();
