#!/usr/bin/env node

const https = require('https');

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

async function getExistingPlans() {
  logWithTimestamp('📋 Buscando planos existentes no Supabase...');

  try {
    const response = await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_plans?select=id,identifier`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const planIdentifiers = new Set();
    const planIds = new Set();

    response.forEach((plan) => {
      if (plan.identifier) planIdentifiers.add(plan.identifier);
      if (plan.id) planIds.add(plan.id);
    });

    logWithTimestamp(
      `✅ Encontrados ${response.length} planos (${planIdentifiers.size} identifiers únicos)`
    );
    return { planIdentifiers, planIds };
  } catch (error) {
    logWithTimestamp(`❌ Erro ao buscar planos: ${error.message}`);
    return { planIdentifiers: new Set(), planIds: new Set() };
  }
}

async function getExistingCustomers() {
  logWithTimestamp('👥 Buscando clientes existentes no Supabase...');

  try {
    const response = await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_customers?select=id`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const customerIds = new Set(response.map((customer) => customer.id));

    logWithTimestamp(`✅ Encontrados ${customerIds.size} clientes`);
    return customerIds;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao buscar clientes: ${error.message}`);
    return new Set();
  }
}

async function syncSubscriptionsWithValidation() {
  logWithTimestamp('🔗 SINCRONIZANDO ASSINATURAS COM VALIDAÇÃO');
  console.log('=============================================');

  try {
    // Buscar dados de referência
    const { planIdentifiers, planIds } = await getExistingPlans();
    const customerIds = await getExistingCustomers();

    let page = 1;
    let totalSynced = 0;
    let totalSkippedPlan = 0;
    let totalSkippedCustomer = 0;
    let totalErrors = 0;
    let hasMore = true;

    while (hasMore) {
      logWithTimestamp(`🔄 Processando página ${page}...`);

      const subscriptionsUrl = `${IUGU_API_BASE_URL}/subscriptions?limit=100&start=${(page - 1) * 100}`;
      const response = await makeRequest(subscriptionsUrl, {
        method: 'GET',
        headers: iuguHeaders,
      });

      if (!response.items || response.items.length === 0) {
        hasMore = false;
        break;
      }

      logWithTimestamp(`📋 Processando ${response.items.length} assinaturas...`);

      for (const subscription of response.items) {
        try {
          const planId = subscription.plan_identifier || subscription.plan_id;
          const customerId = subscription.customer_id;

          // Validar se plano existe
          if (!planIdentifiers.has(planId) && !planIds.has(planId)) {
            totalSkippedPlan++;
            if (totalSkippedPlan <= 5) {
              logWithTimestamp(
                `⚠️ Plano não encontrado: ${planId} (assinatura ${subscription.id})`
              );
            }
            continue;
          }

          // Validar se cliente existe
          if (!customerIds.has(customerId)) {
            totalSkippedCustomer++;
            if (totalSkippedCustomer <= 5) {
              logWithTimestamp(
                `⚠️ Cliente não encontrado: ${customerId} (assinatura ${subscription.id})`
              );
            }
            continue;
          }

          // Criar assinatura com dados validados
          const subscriptionData = {
            id: subscription.id,
            customer_id: customerId,
            plan_id: planId,
            suspended: subscription.suspended || false,
            expires_at: parseIuguDate(subscription.expires_at),
            created_at_iugu: parseIuguDate(subscription.created_at),
            updated_at_iugu: parseIuguDate(subscription.updated_at),
            raw_json: subscription,
          };

          await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_subscriptions`, {
            method: 'POST',
            headers: supabaseHeaders,
            body: JSON.stringify(subscriptionData),
          });

          totalSynced++;

          if (totalSynced % 50 === 0) {
            logWithTimestamp(`✅ ${totalSynced} assinaturas sincronizadas...`);
          }
        } catch (error) {
          totalErrors++;
          if (totalErrors <= 5) {
            logWithTimestamp(
              `❌ Erro ao sincronizar assinatura ${subscription.id}: ${error.message}`
            );
          }
        }
      }

      if (response.items.length < 100) {
        hasMore = false;
      } else {
        page++;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    console.log('\n📊 RESUMO DA SINCRONIZAÇÃO:');
    console.log('===========================');
    console.log(`✅ Assinaturas sincronizadas: ${totalSynced}`);
    console.log(`⚠️ Puladas por plano inexistente: ${totalSkippedPlan}`);
    console.log(`⚠️ Puladas por cliente inexistente: ${totalSkippedCustomer}`);
    console.log(`❌ Erros: ${totalErrors}`);

    const totalProcessed = totalSynced + totalSkippedPlan + totalSkippedCustomer + totalErrors;
    console.log(`📊 Total processadas: ${totalProcessed}`);

    logWithTimestamp('✅ SINCRONIZAÇÃO CONCLUÍDA!');
    return totalSynced;
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização: ${error.message}`);
    return 0;
  }
}

syncSubscriptionsWithValidation();
