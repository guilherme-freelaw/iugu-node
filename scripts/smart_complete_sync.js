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

// 1. Sincronizar Planos (APENAS colunas que existem)
async function syncPlans() {
  logWithTimestamp('📋 Sincronizando planos...');

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
          // APENAS colunas que sabemos que existem
          const planData = {
            id: plan.id,
            name: plan.name,
            identifier: plan.identifier,
            interval: plan.interval,
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
          if (!error.message.includes('duplicate key')) {
            logWithTimestamp(`⚠️ Erro ao sincronizar plano ${plan.id}: ${error.message}`);
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

    logWithTimestamp(`✅ ${totalSynced} planos sincronizados`);
    return totalSynced;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar planos: ${error.message}`);
    return 0;
  }
}

// 2. Sincronizar Assinaturas (SEM foreign key por enquanto)
async function syncSubscriptions() {
  logWithTimestamp('📋 Sincronizando assinaturas...');

  try {
    let page = 1;
    let totalSynced = 0;
    let totalSkipped = 0;
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
          // APENAS colunas básicas que existem
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
          if (
            error.message.includes('foreign key') ||
            error.message.includes('not present in table')
          ) {
            totalSkipped++;
          } else if (!error.message.includes('duplicate key')) {
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
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    logWithTimestamp(
      `✅ ${totalSynced} assinaturas sincronizadas (${totalSkipped} puladas por FK)`
    );
    return totalSynced;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar assinaturas: ${error.message}`);
    return 0;
  }
}

// 3. Sincronizar Métodos de Pagamento
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
        if (!error.message.includes('duplicate key')) {
          logWithTimestamp(`⚠️ Erro ao sincronizar método ${method.id}: ${error.message}`);
        }
      }
    }

    logWithTimestamp(`✅ ${syncedCount} métodos de pagamento sincronizados`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar métodos de pagamento: ${error.message}`);
    return 0;
  }
}

// 4. Sincronizar Chargebacks (SEM amount_cents por enquanto)
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
        // APENAS colunas básicas
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
        if (!error.message.includes('duplicate key')) {
          logWithTimestamp(`⚠️ Erro ao sincronizar chargeback ${chargeback.id}: ${error.message}`);
        }
      }
    }

    logWithTimestamp(`✅ ${syncedCount} chargebacks sincronizados`);
    return syncedCount;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao sincronizar chargebacks: ${error.message}`);
    return 0;
  }
}

// 5. Sincronizar Transfers (SEM amount_cents por enquanto)
async function syncTransfers() {
  logWithTimestamp('💰 Sincronizando transferências...');

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
        // APENAS colunas básicas
        const transferData = {
          id: transfer.id,
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
          logWithTimestamp(`⚠️ Erro ao sincronizar transferência ${transfer.id}: ${error.message}`);
        }
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
  logWithTimestamp('🚀 INICIANDO SINCRONIZAÇÃO INTELIGENTE');
  console.log('==============================================');
  console.log('📌 ESTRATÉGIA: Popular dados básicos primeiro, relacionamentos depois');
  console.log('');

  const results = {
    plans: 0,
    subscriptions: 0,
    paymentMethods: 0,
    chargebacks: 0,
    transfers: 0,
  };

  try {
    // ORDEM ESTRATÉGICA: Planos primeiro, depois assinaturas
    logWithTimestamp('🔄 Etapa 1: Planos (base para assinaturas)');
    results.plans = await syncPlans();

    logWithTimestamp('🔄 Etapa 2: Assinaturas (algumas podem falhar por FK)');
    results.subscriptions = await syncSubscriptions();

    logWithTimestamp('🔄 Etapa 3: Métodos de pagamento');
    results.paymentMethods = await syncPaymentMethods();

    logWithTimestamp('🔄 Etapa 4: Chargebacks');
    results.chargebacks = await syncChargebacks();

    logWithTimestamp('🔄 Etapa 5: Transferências');
    results.transfers = await syncTransfers();

    console.log('\n📊 RESUMO FINAL:');
    console.log('================');
    console.log(`📋 Planos: ${results.plans}`);
    console.log(`📋 Assinaturas: ${results.subscriptions}`);
    console.log(`💳 Métodos de pagamento: ${results.paymentMethods}`);
    console.log(`🔄 Chargebacks: ${results.chargebacks}`);
    console.log(`💰 Transferências: ${results.transfers}`);

    const total = Object.values(results).reduce((sum, count) => sum + count, 0);
    console.log(`📊 Total sincronizado: ${total} registros`);

    console.log('\n🔗 PRÓXIMOS PASSOS:');
    console.log('==================');
    console.log('1. ✅ Dados básicos populados');
    console.log('2. 🔄 Executar análise de completude');
    console.log('3. 🔗 Verificar relacionamentos');

    logWithTimestamp('✅ SINCRONIZAÇÃO INTELIGENTE CONCLUÍDA!');
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização: ${error.message}`);
    process.exit(1);
  }
}

main();
