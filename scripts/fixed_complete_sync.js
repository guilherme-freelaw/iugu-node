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

// 1. Sincronizar Planos (CORRIGIDO)
async function syncPlans() {
  logWithTimestamp('📋 Sincronizando TODOS os planos...');

  try {
    let page = 1;
    let totalSynced = 0;
    let hasMore = true;

    while (hasMore) {
      const plansUrl = `${IUGU_API_BASE_URL}/plans?limit=100&start=${(page - 1) * 100}`;
      const response = await makeRequest(plansUrl, {
        method: 'GET',
        headers: iuguHeaders,
      });

      if (!response.items || response.items.length === 0) {
        hasMore = false;
        break;
      }

      logWithTimestamp(`📋 Processando página ${page} (${response.items.length} planos)`);

      for (const plan of response.items) {
        try {
          const planData = {
            id: plan.id,
            name: plan.name,
            identifier: plan.identifier,
            interval: plan.interval,
            interval_type: plan.interval_type,
            value_cents: plan.value_cents || (plan.value ? plan.value * 100 : 0),
            created_at_iugu: parseIuguDate(plan.created_at),
            updated_at_iugu: parseIuguDate(plan.updated_at),
            raw_json: plan,
          };

          await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_plans`, {
            method: 'POST',
            headers: supabaseHeaders,
            body: JSON.stringify(planData),
          });

          totalSynced++;
        } catch (error) {
          logWithTimestamp(`⚠️ Erro ao sincronizar plano ${plan.id}: ${error.message}`);
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

    logWithTimestamp(`✅ ${totalSynced} planos sincronizados`);
    return totalSynced;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar planos: ${error.message}`);
    return 0;
  }
}

// 2. Sincronizar Assinaturas (CORRIGIDO com planos primeiro)
async function syncSubscriptions() {
  logWithTimestamp('📋 Sincronizando TODAS as assinaturas...');

  try {
    let page = 1;
    let totalSynced = 0;
    let totalErrors = 0;
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
          const subscriptionData = {
            id: subscription.id,
            customer_id: subscription.customer_id,
            plan_id: subscription.plan_identifier || subscription.plan_id,
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
        } catch (error) {
          totalErrors++;
          if (totalErrors <= 5) {
            // Log apenas os primeiros 5 erros para não poluir
            logWithTimestamp(
              `⚠️ Erro ao sincronizar assinatura ${subscription.id}: ${error.message}`
            );
          }
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

    logWithTimestamp(`✅ ${totalSynced} assinaturas sincronizadas (${totalErrors} erros)`);
    return totalSynced;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar assinaturas: ${error.message}`);
    return 0;
  }
}

// 3. Sincronizar Métodos de Pagamento (CORRIGIDO)
async function syncPaymentMethods() {
  logWithTimestamp('💳 Sincronizando métodos de pagamento...');

  try {
    const response = await makeRequest(`${IUGU_API_BASE_URL}/payment_methods`, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (!response.items || response.items.length === 0) {
      logWithTimestamp('💳 Nenhum método de pagamento encontrado');
      return 0;
    }

    let syncedCount = 0;

    for (const method of response.items) {
      try {
        const methodData = {
          id: method.id,
          customer_id: method.customer_id,
          description: method.description,
          item_type: method.item_type,
          brand: method.brand,
          last_four_digits: method.last_four_digits,
          created_at_iugu: parseIuguDate(method.created_at),
          updated_at_iugu: parseIuguDate(method.updated_at),
          raw_json: method,
        };

        await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_payment_methods`, {
          method: 'POST',
          headers: supabaseHeaders,
          body: JSON.stringify(methodData),
        });

        syncedCount++;
      } catch (error) {
        logWithTimestamp(`⚠️ Erro ao sincronizar método ${method.id}: ${error.message}`);
      }
    }

    logWithTimestamp(`✅ ${syncedCount} métodos de pagamento sincronizados`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar métodos de pagamento: ${error.message}`);
    return 0;
  }
}

// 4. Sincronizar Chargebacks
async function syncChargebacks() {
  logWithTimestamp('🔄 Sincronizando chargebacks...');

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
        const chargebackData = {
          id: chargeback.id,
          invoice_id: chargeback.invoice_id,
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
        logWithTimestamp(`⚠️ Erro ao sincronizar chargeback ${chargeback.id}: ${error.message}`);
      }
    }

    logWithTimestamp(`✅ ${syncedCount} chargebacks sincronizados`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar chargebacks: ${error.message}`);
    return 0;
  }
}

// 5. Sincronizar Transferências/Saques
async function syncWithdrawRequests() {
  logWithTimestamp('💰 Sincronizando solicitações de saque...');

  try {
    const response = await makeRequest(`${IUGU_API_BASE_URL}/withdraw_requests`, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (!response.items || response.items.length === 0) {
      logWithTimestamp('💰 Nenhuma solicitação de saque encontrada');
      return 0;
    }

    let syncedCount = 0;

    for (const withdraw of response.items) {
      try {
        const withdrawData = {
          id: withdraw.id,
          status: withdraw.status,
          amount_cents: withdraw.amount ? withdraw.amount * 100 : 0,
          created_at_iugu: parseIuguDate(withdraw.created_at),
          updated_at_iugu: parseIuguDate(withdraw.updated_at),
          raw_json: withdraw,
        };

        await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_transfers`, {
          method: 'POST',
          headers: supabaseHeaders,
          body: JSON.stringify(withdrawData),
        });

        syncedCount++;
      } catch (error) {
        logWithTimestamp(`⚠️ Erro ao sincronizar saque ${withdraw.id}: ${error.message}`);
      }
    }

    logWithTimestamp(`✅ ${syncedCount} solicitações de saque sincronizadas`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar saques: ${error.message}`);
    return 0;
  }
}

async function main() {
  logWithTimestamp('🚀 INICIANDO SINCRONIZAÇÃO COMPLETA CORRIGIDA');
  console.log('======================================================');

  const results = {
    plans: 0,
    subscriptions: 0,
    paymentMethods: 0,
    chargebacks: 0,
    withdrawRequests: 0,
  };

  try {
    // ORDEM IMPORTANTE: Planos primeiro, depois assinaturas
    logWithTimestamp('🔄 Etapa 1: Sincronizando planos...');
    results.plans = await syncPlans();

    logWithTimestamp('🔄 Etapa 2: Sincronizando assinaturas...');
    results.subscriptions = await syncSubscriptions();

    logWithTimestamp('🔄 Etapa 3: Sincronizando métodos de pagamento...');
    results.paymentMethods = await syncPaymentMethods();

    logWithTimestamp('🔄 Etapa 4: Sincronizando chargebacks...');
    results.chargebacks = await syncChargebacks();

    logWithTimestamp('🔄 Etapa 5: Sincronizando solicitações de saque...');
    results.withdrawRequests = await syncWithdrawRequests();

    console.log('\n📊 RESUMO FINAL:');
    console.log('================');
    console.log(`📋 Planos: ${results.plans}`);
    console.log(`📋 Assinaturas: ${results.subscriptions}`);
    console.log(`💳 Métodos de pagamento: ${results.paymentMethods}`);
    console.log(`🔄 Chargebacks: ${results.chargebacks}`);
    console.log(`💰 Solicitações de saque: ${results.withdrawRequests}`);

    const total = Object.values(results).reduce((sum, count) => sum + count, 0);
    console.log(`📊 Total sincronizado: ${total} registros`);

    logWithTimestamp('✅ SINCRONIZAÇÃO COMPLETA CONCLUÍDA COM SUCESSO!');
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização: ${error.message}`);
    process.exit(1);
  }
}

main();
