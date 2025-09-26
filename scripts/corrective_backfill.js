#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

// Configurações
const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!IUGU_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

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

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

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

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

async function fetchFromIugu(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `${IUGU_API_BASE_URL}${endpoint}?${queryString}`;

  try {
    const response = await makeRequest(url, { headers: iuguHeaders });
    return response;
  } catch (err) {
    logWithTimestamp(`❌ Erro ao buscar ${endpoint}: ${err.message}`);
    throw err;
  }
}

async function upsertToSupabase(table, data) {
  try {
    const response = await makeRequest(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify(data),
    });
    return response;
  } catch (err) {
    logWithTimestamp(`❌ Erro ao inserir em ${table}: ${err.message}`);
    throw err;
  }
}

function normalizeInvoice(invoice) {
  return {
    id: invoice.id,
    account_id: invoice.account_id,
    customer_id: invoice.customer_id,
    subscription_id: invoice.subscription_id,
    status: invoice.status,
    due_date: invoice.due_date || null,
    paid_at: invoice.paid_at || null,
    payment_method: invoice.payment_method,
    total_cents: invoice.total_cents || (invoice.total ? Math.round(invoice.total * 100) : 0),
    paid_cents: invoice.paid_cents || (invoice.paid ? Math.round(invoice.paid * 100) : null),
    discount_cents:
      invoice.discount_cents || (invoice.discount ? Math.round(invoice.discount * 100) : 0),
    taxes_cents: invoice.taxes_cents || (invoice.taxes ? Math.round(invoice.taxes * 100) : 0),
    commission_cents: invoice.commission_cents,
    external_reference: invoice.external_reference,
    order_id: invoice.order_id,
    created_at_iugu: invoice.created_at,
    updated_at_iugu: invoice.updated_at,
    payer_name: invoice.payer?.name || invoice.payer_name,
    payer_email: invoice.payer?.email || invoice.payer_email,
    payer_cpf_cnpj: invoice.payer?.cpf_cnpj || invoice.payer_cpf_cnpj,
    payer_phone: invoice.payer?.phone || invoice.payer_phone,
    secure_id: invoice.secure_id,
    secure_url: invoice.secure_url,
    raw_json: invoice,
  };
}

function normalizeCustomer(customer) {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    cpf_cnpj: customer.cpf_cnpj,
    phone: customer.phone,
    created_at_iugu: customer.created_at,
    updated_at_iugu: customer.updated_at,
    raw_json: customer,
  };
}

function normalizeSubscription(subscription) {
  return {
    id: subscription.id,
    customer_id: subscription.customer_id,
    plan_id: subscription.plan_id,
    plan_identifier: subscription.plan_identifier,
    plan_name: subscription.plan?.name,
    price_cents: subscription.price_cents,
    currency: subscription.currency,
    credits: subscription.credits,
    suspended: subscription.suspended || false,
    status: subscription.status,
    expires_at: subscription.expires_at,
    renews_at: subscription.renews_at,
    created_at_iugu: subscription.created_at,
    updated_at_iugu: subscription.updated_at,
    raw_json: subscription,
  };
}

async function correctiveFetchPeriod(startDate, endDate, periodName) {
  logWithTimestamp(`🔄 INICIANDO CORREÇÃO: ${periodName}`);
  logWithTimestamp(`📅 Período: ${startDate} até ${endDate}`);

  const stats = {
    invoices: { found: 0, inserted: 0, errors: 0 },
    customers: { found: 0, inserted: 0, errors: 0 },
    subscriptions: { found: 0, inserted: 0, errors: 0 },
  };

  try {
    // 1. Buscar faturas do período
    logWithTimestamp('📄 Buscando faturas...');
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const invoicesResponse = await fetchFromIugu('/invoices', {
        limit: 100,
        created_at_from: startDate,
        created_at_to: endDate,
        page: page,
      });

      const invoices = invoicesResponse.items || [];

      if (invoices.length === 0) {
        hasMore = false;
        break;
      }

      stats.invoices.found += invoices.length;
      logWithTimestamp(`   📄 Página ${page}: ${invoices.length} faturas encontradas`);

      // Inserir faturas
      for (const invoice of invoices) {
        try {
          const normalizedInvoice = normalizeInvoice(invoice);
          await upsertToSupabase('iugu_invoices', normalizedInvoice);
          stats.invoices.inserted++;
        } catch (err) {
          stats.invoices.errors++;
          logWithTimestamp(`   ⚠️  Erro na fatura ${invoice.id}: ${err.message}`);
        }
      }

      page++;

      // Pausa para não sobrecarregar
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 2. Buscar clientes únicos das faturas
    logWithTimestamp('👥 Buscando clientes...');
    page = 1;
    hasMore = true;

    while (hasMore) {
      const customersResponse = await fetchFromIugu('/customers', {
        limit: 100,
        created_at_from: startDate,
        created_at_to: endDate,
        page: page,
      });

      const customers = customersResponse.items || [];

      if (customers.length === 0) {
        hasMore = false;
        break;
      }

      stats.customers.found += customers.length;
      logWithTimestamp(`   👥 Página ${page}: ${customers.length} clientes encontrados`);

      // Inserir clientes
      for (const customer of customers) {
        try {
          const normalizedCustomer = normalizeCustomer(customer);
          await upsertToSupabase('iugu_customers', normalizedCustomer);
          stats.customers.inserted++;
        } catch (err) {
          stats.customers.errors++;
          logWithTimestamp(`   ⚠️  Erro no cliente ${customer.id}: ${err.message}`);
        }
      }

      page++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 3. Buscar assinaturas
    logWithTimestamp('📋 Buscando assinaturas...');
    page = 1;
    hasMore = true;

    while (hasMore) {
      const subscriptionsResponse = await fetchFromIugu('/subscriptions', {
        limit: 100,
        created_at_from: startDate,
        created_at_to: endDate,
        page: page,
      });

      const subscriptions = subscriptionsResponse.items || [];

      if (subscriptions.length === 0) {
        hasMore = false;
        break;
      }

      stats.subscriptions.found += subscriptions.length;
      logWithTimestamp(`   📋 Página ${page}: ${subscriptions.length} assinaturas encontradas`);

      // Inserir assinaturas
      for (const subscription of subscriptions) {
        try {
          const normalizedSubscription = normalizeSubscription(subscription);
          await upsertToSupabase('iugu_subscriptions', normalizedSubscription);
          stats.subscriptions.inserted++;
        } catch (err) {
          stats.subscriptions.errors++;
          logWithTimestamp(`   ⚠️  Erro na assinatura ${subscription.id}: ${err.message}`);
        }
      }

      page++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    logWithTimestamp(`✅ CORREÇÃO ${periodName} CONCLUÍDA:`);
    logWithTimestamp(
      `   📄 Faturas: ${stats.invoices.inserted}/${stats.invoices.found} (${stats.invoices.errors} erros)`
    );
    logWithTimestamp(
      `   👥 Clientes: ${stats.customers.inserted}/${stats.customers.found} (${stats.customers.errors} erros)`
    );
    logWithTimestamp(
      `   📋 Assinaturas: ${stats.subscriptions.inserted}/${stats.subscriptions.found} (${stats.subscriptions.errors} erros)`
    );

    return stats;
  } catch (err) {
    logWithTimestamp(`❌ Erro na correção ${periodName}: ${err.message}`);
    throw err;
  }
}

async function runCorrectiveBackfill() {
  logWithTimestamp('🚀 INICIANDO BACKFILL CORRETIVO');
  logWithTimestamp('================================');
  logWithTimestamp('🎯 Foco: Períodos com defasagens identificadas');
  logWithTimestamp('📊 Objetivo: Atingir precisão > 99.5%');
  logWithTimestamp('');

  const allStats = [];

  try {
    // Períodos críticos identificados na validação
    const periodsToCorrect = [
      {
        name: 'FEVEREIRO 2025',
        start: '2025-02-01T00:00:00.000Z',
        end: '2025-02-28T23:59:59.999Z',
      },
      {
        name: 'JUNHO 2025',
        start: '2025-06-01T00:00:00.000Z',
        end: '2025-06-30T23:59:59.999Z',
      },
      {
        name: 'AGOSTO 2025 (reforço)',
        start: '2025-08-01T00:00:00.000Z',
        end: '2025-08-31T23:59:59.999Z',
      },
    ];

    for (const period of periodsToCorrect) {
      const stats = await correctiveFetchPeriod(period.start, period.end, period.name);
      allStats.push({ period: period.name, stats });

      logWithTimestamp('');
      logWithTimestamp('⏸️  Pausa entre períodos...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Resumo final
    logWithTimestamp('');
    logWithTimestamp('🎯 RESUMO DO BACKFILL CORRETIVO:');
    logWithTimestamp('================================');

    let totalInvoices = 0;
    let totalCustomers = 0;
    let totalSubscriptions = 0;

    allStats.forEach(({ period, stats }) => {
      logWithTimestamp(`📅 ${period}:`);
      logWithTimestamp(`   📄 ${stats.invoices.inserted} faturas`);
      logWithTimestamp(`   👥 ${stats.customers.inserted} clientes`);
      logWithTimestamp(`   📋 ${stats.subscriptions.inserted} assinaturas`);

      totalInvoices += stats.invoices.inserted;
      totalCustomers += stats.customers.inserted;
      totalSubscriptions += stats.subscriptions.inserted;
    });

    logWithTimestamp('');
    logWithTimestamp('📊 TOTAL PROCESSADO:');
    logWithTimestamp(`   📄 ${totalInvoices} faturas`);
    logWithTimestamp(`   👥 ${totalCustomers} clientes`);
    logWithTimestamp(`   📋 ${totalSubscriptions} assinaturas`);

    // Salvar relatório
    const report = {
      timestamp: new Date().toISOString(),
      type: 'corrective_backfill',
      periods: allStats,
      totals: {
        invoices: totalInvoices,
        customers: totalCustomers,
        subscriptions: totalSubscriptions,
      },
    };

    fs.writeFileSync('corrective_backfill_report.json', JSON.stringify(report, null, 2));
    logWithTimestamp('💾 Relatório salvo: corrective_backfill_report.json');

    logWithTimestamp('');
    logWithTimestamp('🎉 BACKFILL CORRETIVO CONCLUÍDO!');
    logWithTimestamp('⚡ Execute novamente a validação para verificar melhorias');

    return report;
  } catch (err) {
    logWithTimestamp(`💥 Erro fatal no backfill corretivo: ${err.message}`);
    throw err;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  runCorrectiveBackfill()
    .then((report) => {
      console.log('');
      console.log('✅ Backfill corretivo executado com sucesso!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { runCorrectiveBackfill, correctiveFetchPeriod };
