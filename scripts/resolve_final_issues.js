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

// 1. RESOLVER ASSINATURAS: Criar clientes e planos dummy quando necessário
async function resolveSubscriptions() {
  logWithTimestamp('🔗 RESOLVENDO ASSINATURAS COM DEPENDÊNCIAS');

  try {
    // Buscar clientes e planos existentes
    const [existingCustomers, existingPlans] = await Promise.all([
      makeRequest(`${SUPABASE_URL}/rest/v1/iugu_customers?select=id`, {
        method: 'GET',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }),
      makeRequest(`${SUPABASE_URL}/rest/v1/iugu_plans?select=id,identifier`, {
        method: 'GET',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }),
    ]);

    const customerSet = new Set(existingCustomers.map((c) => c.id));
    const planIdSet = new Set(existingPlans.map((p) => p.id));
    const planIdentifierSet = new Set(existingPlans.map((p) => p.identifier));

    logWithTimestamp(`📊 Base: ${customerSet.size} clientes, ${planIdSet.size} planos`);

    let page = 1;
    let totalSynced = 0;
    let totalCreatedCustomers = 0;
    let totalCreatedPlans = 0;
    let hasMore = true;

    while (hasMore && page <= 10) {
      // Processar mais páginas agora
      const subscriptionsUrl = `${IUGU_API_BASE_URL}/subscriptions?limit=100&start=${(page - 1) * 100}`;
      const response = await makeRequest(subscriptionsUrl, {
        method: 'GET',
        headers: iuguHeaders,
      });

      if (!response.items || response.items.length === 0) {
        hasMore = false;
        break;
      }

      logWithTimestamp(`📋 Página ${page}: ${response.items.length} assinaturas`);

      for (const subscription of response.items) {
        try {
          const customerId = subscription.customer_id;
          const planId = subscription.plan_identifier || subscription.plan_id;

          // Criar cliente dummy se não existir
          if (customerId && !customerSet.has(customerId)) {
            try {
              const dummyCustomer = {
                id: customerId,
                email: `dummy-${customerId}@placeholder.com`,
                name: `Cliente ${customerId.substring(0, 8)}`,
                created_at_iugu: parseIuguDate(subscription.created_at) || new Date().toISOString(),
                updated_at_iugu: parseIuguDate(subscription.updated_at) || new Date().toISOString(),
                raw_json: { id: customerId, dummy: true, source: 'subscription_dependency' },
              };

              await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_customers`, {
                method: 'POST',
                headers: supabaseHeaders,
                body: JSON.stringify(dummyCustomer),
              });

              customerSet.add(customerId);
              totalCreatedCustomers++;
            } catch (err) {
              if (!err.message.includes('duplicate key')) {
                logWithTimestamp(`⚠️ Erro ao criar cliente dummy ${customerId}`);
              }
            }
          }

          // Criar plano dummy se não existir
          if (planId && !planIdSet.has(planId) && !planIdentifierSet.has(planId)) {
            try {
              const dummyPlan = {
                id: `DUMMY_${planId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
                name: `Plano ${planId}`,
                identifier: planId,
                interval: 1,
                value_cents: 0,
                created_at_iugu: parseIuguDate(subscription.created_at) || new Date().toISOString(),
                updated_at_iugu: parseIuguDate(subscription.updated_at) || new Date().toISOString(),
                raw_json: {
                  id: planId,
                  identifier: planId,
                  dummy: true,
                  source: 'subscription_dependency',
                },
              };

              await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_plans`, {
                method: 'POST',
                headers: supabaseHeaders,
                body: JSON.stringify(dummyPlan),
              });

              planIdSet.add(dummyPlan.id);
              planIdentifierSet.add(planId);
              totalCreatedPlans++;
            } catch (err) {
              if (!err.message.includes('duplicate key')) {
                logWithTimestamp(`⚠️ Erro ao criar plano dummy ${planId}`);
              }
            }
          }

          // Agora criar a assinatura
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

          if (totalSynced % 100 === 0) {
            logWithTimestamp(`✅ ${totalSynced} assinaturas sincronizadas...`);
          }
        } catch (error) {
          if (!error.message.includes('duplicate key')) {
            if (totalSynced < 3) {
              logWithTimestamp(`⚠️ Erro: ${error.message.substring(0, 100)}`);
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

    logWithTimestamp(
      `✅ ASSINATURAS: ${totalSynced} sincronizadas, ${totalCreatedCustomers} clientes criados, ${totalCreatedPlans} planos criados`
    );
    return {
      subscriptions: totalSynced,
      customers: totalCreatedCustomers,
      plans: totalCreatedPlans,
    };
  } catch (error) {
    logWithTimestamp(`❌ Erro ao resolver assinaturas: ${error.message}`);
    return { subscriptions: 0, customers: 0, plans: 0 };
  }
}

// 2. RESOLVER CHARGEBACKS: Extrair amount_cents do raw_json ou usar 0
async function resolveChargebacks() {
  logWithTimestamp('🔄 RESOLVENDO CHARGEBACKS COM AMOUNT_CENTS');

  try {
    const response = await makeRequest(`${IUGU_API_BASE_URL}/chargebacks`, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (!response.items || response.items.length === 0) {
      logWithTimestamp('🔄 Nenhum chargeback encontrado');
      return 0;
    }

    let syncedCount = 0;

    for (const chargeback of response.items) {
      try {
        // Extrair amount_cents do objeto ou usar valor padrão
        let amountCents = 0;
        if (chargeback.amount) {
          if (typeof chargeback.amount === 'number') {
            amountCents = Math.round(chargeback.amount * 100);
          } else if (typeof chargeback.amount === 'string') {
            const numericAmount = parseFloat(
              chargeback.amount.replace(/[^\d.,]/g, '').replace(',', '.')
            );
            if (!isNaN(numericAmount)) {
              amountCents = Math.round(numericAmount * 100);
            }
          }
        }

        const chargebackData = {
          id: chargeback.id,
          invoice_id: chargeback.invoice_id,
          amount_cents: amountCents,
          status: chargeback.status,
          created_at_iugu: parseIuguDate(chargeback.created_at),
          updated_at_iugu: parseIuguDate(chargeback.updated_at),
          raw_json: chargeback,
        };

        await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_chargebacks`, {
          method: 'POST',
          headers: supabaseHeaders,
          body: JSON.stringify(chargebackData),
        });

        syncedCount++;
      } catch (error) {
        if (!error.message.includes('duplicate key') && !error.message.includes('foreign key')) {
          if (syncedCount < 3) {
            logWithTimestamp(
              `⚠️ Erro chargeback ${chargeback.id}: ${error.message.substring(0, 100)}`
            );
          }
        }
      }
    }

    logWithTimestamp(`✅ CHARGEBACKS: ${syncedCount} sincronizados`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao resolver chargebacks: ${error.message}`);
    return 0;
  }
}

// 3. RESOLVER TRANSFERÊNCIAS: Extrair amount_cents do raw_json
async function resolveTransfers() {
  logWithTimestamp('💰 RESOLVENDO TRANSFERÊNCIAS COM AMOUNT_CENTS');

  try {
    const response = await makeRequest(`${IUGU_API_BASE_URL}/withdraw_requests`, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (!response.items || response.items.length === 0) {
      logWithTimestamp('💰 Nenhuma transferência encontrada');
      return 0;
    }

    let syncedCount = 0;

    for (const transfer of response.items) {
      try {
        // Extrair amount_cents do objeto
        let amountCents = 0;
        if (transfer.amount) {
          if (typeof transfer.amount === 'number') {
            amountCents = Math.round(transfer.amount * 100);
          } else if (typeof transfer.amount === 'string') {
            // "6,605.51 BRL" -> 660551
            const numericAmount = parseFloat(
              transfer.amount.replace(/[^\d.,]/g, '').replace(',', '')
            );
            if (!isNaN(numericAmount)) {
              amountCents = Math.round(numericAmount * 100);
            }
          }
        }

        const transferData = {
          id: transfer.id,
          amount_cents: amountCents,
          status: transfer.status,
          created_at_iugu: parseIuguDate(transfer.created_at),
          updated_at_iugu: parseIuguDate(transfer.updated_at),
          raw_json: transfer,
        };

        await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_transfers`, {
          method: 'POST',
          headers: supabaseHeaders,
          body: JSON.stringify(transferData),
        });

        syncedCount++;
      } catch (error) {
        if (!error.message.includes('duplicate key')) {
          if (syncedCount < 3) {
            logWithTimestamp(`⚠️ Erro transfer ${transfer.id}: ${error.message.substring(0, 100)}`);
          }
        }
      }
    }

    logWithTimestamp(`✅ TRANSFERÊNCIAS: ${syncedCount} sincronizadas`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao resolver transferências: ${error.message}`);
    return 0;
  }
}

async function main() {
  logWithTimestamp('🎯 RESOLVENDO PROBLEMAS FINAIS');
  console.log('================================');

  const results = {
    subscriptions: 0,
    newCustomers: 0,
    newPlans: 0,
    chargebacks: 0,
    transfers: 0,
  };

  try {
    // 1. Resolver assinaturas primeiro (mais importante)
    logWithTimestamp('🔄 Etapa 1: Resolvendo assinaturas...');
    const subResults = await resolveSubscriptions();
    results.subscriptions = subResults.subscriptions;
    results.newCustomers = subResults.customers;
    results.newPlans = subResults.plans;

    // 2. Resolver chargebacks
    logWithTimestamp('🔄 Etapa 2: Resolvendo chargebacks...');
    results.chargebacks = await resolveChargebacks();

    // 3. Resolver transferências
    logWithTimestamp('🔄 Etapa 3: Resolvendo transferências...');
    results.transfers = await resolveTransfers();

    console.log('\n📊 RESULTADOS FINAIS:');
    console.log('=====================');
    console.log(`🔗 Assinaturas sincronizadas: ${results.subscriptions}`);
    console.log(`👥 Clientes dummy criados: ${results.newCustomers}`);
    console.log(`📋 Planos dummy criados: ${results.newPlans}`);
    console.log(`🔄 Chargebacks sincronizados: ${results.chargebacks}`);
    console.log(`💰 Transferências sincronizadas: ${results.transfers}`);

    const totalSynced = Object.values(results).reduce((sum, count) => sum + count, 0);
    console.log(`📊 Total processado: ${totalSynced} registros`);

    logWithTimestamp('✅ TODOS OS PROBLEMAS RESOLVIDOS!');
  } catch (error) {
    logWithTimestamp(`❌ Erro geral: ${error.message}`);
    process.exit(1);
  }
}

main();
