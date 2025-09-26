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

function makeRequest(url, options = {}, retries = 3) {
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
        } else if ((res.statusCode === 502 || res.statusCode === 429) && retries > 0) {
          logWithTimestamp(
            `⚠️  HTTP ${res.statusCode}, tentando novamente em 5s... (${retries} tentativas restantes)`
          );
          setTimeout(() => {
            makeRequest(url, options, retries - 1)
              .then(resolve)
              .catch(reject);
          }, 5000);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      if (retries > 0) {
        logWithTimestamp(
          `⚠️  Erro de rede, tentando novamente em 5s... (${retries} tentativas restantes)`
        );
        setTimeout(() => {
          makeRequest(url, options, retries - 1)
            .then(resolve)
            .catch(reject);
        }, 5000);
      } else {
        reject(err);
      }
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// Função para normalizar datas problemáticas
function normalizeDate(dateString) {
  if (!dateString) return null;

  try {
    // Se já está em formato ISO, retornar
    if (dateString.includes('T') && dateString.includes('Z')) {
      return dateString;
    }

    // Converter formatos problemáticos
    // "27/02, 14:06" -> "2025-02-27T14:06:00.000Z"
    // "26 Feb 07:21 PM" -> "2025-02-26T19:21:00.000Z"

    if (dateString.includes('/')) {
      // Formato: "27/02, 14:06"
      const match = dateString.match(/(\d{1,2})\/(\d{1,2}),?\s*(\d{1,2}):(\d{2})/);
      if (match) {
        const [, day, month, hour, minute] = match;
        return `2025-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00.000Z`;
      }
    }

    if (dateString.includes('Feb')) {
      // Formato: "26 Feb 07:21 PM"
      const match = dateString.match(/(\d{1,2})\s+Feb\s+(\d{1,2}):(\d{2})\s+(AM|PM)/);
      if (match) {
        const [, day, hour, minute, period] = match;
        let normalizedHour = parseInt(hour);
        if (period === 'PM' && normalizedHour !== 12) normalizedHour += 12;
        if (period === 'AM' && normalizedHour === 12) normalizedHour = 0;

        return `2025-02-${day.padStart(2, '0')}T${normalizedHour.toString().padStart(2, '0')}:${minute}:00.000Z`;
      }
    }

    // Tentar parsing direto
    const parsed = new Date(dateString);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    logWithTimestamp(`⚠️  Data não reconhecida: ${dateString}`);
    return null;
  } catch (err) {
    logWithTimestamp(`⚠️  Erro ao normalizar data ${dateString}: ${err.message}`);
    return null;
  }
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
    // Ignorar erros de timestamp para não parar o processo
    if (err.message.includes('invalid input syntax for type timestamp')) {
      logWithTimestamp(`⚠️  Timestamp inválido ignorado: ${data.id}`);
      return null;
    }
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
    due_date: normalizeDate(invoice.due_date),
    paid_at: normalizeDate(invoice.paid_at),
    payment_method: invoice.payment_method,
    total_cents: invoice.total_cents || (invoice.total ? Math.round(invoice.total * 100) : 0),
    paid_cents: invoice.paid_cents || (invoice.paid ? Math.round(invoice.paid * 100) : null),
    discount_cents:
      invoice.discount_cents || (invoice.discount ? Math.round(invoice.discount * 100) : 0),
    taxes_cents: invoice.taxes_cents || (invoice.taxes ? Math.round(invoice.taxes * 100) : 0),
    commission_cents: invoice.commission_cents,
    external_reference: invoice.external_reference,
    order_id: invoice.order_id,
    created_at_iugu: normalizeDate(invoice.created_at),
    updated_at_iugu: normalizeDate(invoice.updated_at),
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
    created_at_iugu: normalizeDate(customer.created_at),
    updated_at_iugu: normalizeDate(customer.updated_at),
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
    expires_at: normalizeDate(subscription.expires_at),
    renews_at: normalizeDate(subscription.renews_at),
    created_at_iugu: normalizeDate(subscription.created_at),
    updated_at_iugu: normalizeDate(subscription.updated_at),
    raw_json: subscription,
  };
}

async function smartFetchPeriod(startDate, endDate, periodName) {
  logWithTimestamp(`🔄 CORREÇÃO INTELIGENTE: ${periodName}`);
  logWithTimestamp(`📅 Período: ${startDate} até ${endDate}`);

  const stats = {
    invoices: { found: 0, inserted: 0, errors: 0, skipped: 0 },
    customers: { found: 0, inserted: 0, errors: 0, skipped: 0 },
    subscriptions: { found: 0, inserted: 0, errors: 0, skipped: 0 },
  };

  try {
    // 1. Buscar faturas do período com controle de rate limiting
    logWithTimestamp('📄 Buscando faturas com rate limiting inteligente...');
    let page = 1;
    let hasMore = true;
    let consecutiveErrors = 0;

    while (hasMore && consecutiveErrors < 5) {
      try {
        const invoicesResponse = await fetchFromIugu('/invoices', {
          limit: 50, // Reduzir limite para evitar sobrecarga
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

        // Inserir faturas com melhor tratamento de erro
        for (const invoice of invoices) {
          try {
            const normalizedInvoice = normalizeInvoice(invoice);
            const result = await upsertToSupabase('iugu_invoices', normalizedInvoice);
            if (result !== null) {
              stats.invoices.inserted++;
            } else {
              stats.invoices.skipped++;
            }
          } catch (err) {
            stats.invoices.errors++;
            if (stats.invoices.errors <= 5) {
              // Mostrar apenas os primeiros 5 erros
              logWithTimestamp(`   ⚠️  Erro na fatura ${invoice.id}: ${err.message}`);
            }
          }
        }

        page++;
        consecutiveErrors = 0;

        // Pausa mais longa para evitar rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err) {
        consecutiveErrors++;
        logWithTimestamp(`❌ Erro na página ${page}: ${err.message}`);
        if (consecutiveErrors < 5) {
          logWithTimestamp(`⏸️  Pausa de ${consecutiveErrors * 10}s antes de tentar novamente...`);
          await new Promise((resolve) => setTimeout(resolve, consecutiveErrors * 10000));
        }
      }
    }

    if (consecutiveErrors >= 5) {
      logWithTimestamp('⚠️  Muitos erros consecutivos, pulando para clientes...');
    }

    // 2. Buscar clientes (processo similar mas mais conservador)
    logWithTimestamp('👥 Buscando clientes...');
    page = 1;
    hasMore = true;
    consecutiveErrors = 0;

    while (hasMore && consecutiveErrors < 3) {
      try {
        const customersResponse = await fetchFromIugu('/customers', {
          limit: 30, // Limite ainda menor
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

        for (const customer of customers) {
          try {
            const normalizedCustomer = normalizeCustomer(customer);
            const result = await upsertToSupabase('iugu_customers', normalizedCustomer);
            if (result !== null) {
              stats.customers.inserted++;
            } else {
              stats.customers.skipped++;
            }
          } catch (err) {
            stats.customers.errors++;
          }
        }

        page++;
        consecutiveErrors = 0;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (err) {
        consecutiveErrors++;
        logWithTimestamp(`❌ Erro na página de clientes ${page}: ${err.message}`);
        if (consecutiveErrors < 3) {
          await new Promise((resolve) => setTimeout(resolve, consecutiveErrors * 15000));
        }
      }
    }

    logWithTimestamp(`✅ CORREÇÃO ${periodName} CONCLUÍDA:`);
    logWithTimestamp(
      `   📄 Faturas: ${stats.invoices.inserted} inseridas, ${stats.invoices.skipped} puladas, ${stats.invoices.errors} erros`
    );
    logWithTimestamp(
      `   👥 Clientes: ${stats.customers.inserted} inseridos, ${stats.customers.skipped} pulados, ${stats.customers.errors} erros`
    );

    return stats;
  } catch (err) {
    logWithTimestamp(`❌ Erro na correção ${periodName}: ${err.message}`);
    return stats; // Retornar stats parciais ao invés de falhar
  }
}

async function runFixedCorrectiveBackfill() {
  logWithTimestamp('🚀 BACKFILL CORRETIVO OTIMIZADO');
  logWithTimestamp('===============================');
  logWithTimestamp('🎯 Foco: Resolver problemas de timestamp e rate limiting');
  logWithTimestamp('⚡ Estratégia: Rate limiting inteligente + normalização de datas');
  logWithTimestamp('');

  const allStats = [];

  try {
    // Focar apenas nos períodos mais críticos primeiro
    const periodsToCorrect = [
      {
        name: 'FEVEREIRO 2025',
        start: '2025-02-01',
        end: '2025-02-28',
      },
      {
        name: 'JUNHO 2025',
        start: '2025-06-01',
        end: '2025-06-30',
      },
    ];

    for (const period of periodsToCorrect) {
      logWithTimestamp(`\n🔥 Iniciando ${period.name}...`);
      const stats = await smartFetchPeriod(period.start, period.end, period.name);
      allStats.push({ period: period.name, stats });

      logWithTimestamp('');
      logWithTimestamp('⏸️  Pausa longa entre períodos para evitar rate limiting...');
      await new Promise((resolve) => setTimeout(resolve, 30000)); // 30 segundos
    }

    // Resumo final
    logWithTimestamp('');
    logWithTimestamp('🎯 RESUMO DO BACKFILL CORRETIVO:');
    logWithTimestamp('================================');

    let totalInvoices = 0;
    let totalCustomers = 0;

    allStats.forEach(({ period, stats }) => {
      logWithTimestamp(`📅 ${period}:`);
      logWithTimestamp(
        `   📄 ${stats.invoices.inserted} faturas inseridas (${stats.invoices.errors} erros, ${stats.invoices.skipped} puladas)`
      );
      logWithTimestamp(
        `   👥 ${stats.customers.inserted} clientes inseridos (${stats.customers.errors} erros)`
      );

      totalInvoices += stats.invoices.inserted;
      totalCustomers += stats.customers.inserted;
    });

    logWithTimestamp('');
    logWithTimestamp('📊 TOTAL INSERIDO:');
    logWithTimestamp(`   📄 ${totalInvoices} faturas`);
    logWithTimestamp(`   👥 ${totalCustomers} clientes`);

    // Salvar relatório
    const report = {
      timestamp: new Date().toISOString(),
      type: 'fixed_corrective_backfill',
      periods: allStats,
      totals: {
        invoices: totalInvoices,
        customers: totalCustomers,
      },
    };

    fs.writeFileSync('fixed_corrective_backfill_report.json', JSON.stringify(report, null, 2));
    logWithTimestamp('💾 Relatório salvo: fixed_corrective_backfill_report.json');

    logWithTimestamp('');
    logWithTimestamp('🎉 BACKFILL CORRETIVO CONCLUÍDO!');
    logWithTimestamp('📊 Execute a validação novamente para verificar melhorias');

    return report;
  } catch (err) {
    logWithTimestamp(`💥 Erro fatal no backfill corretivo: ${err.message}`);
    return { error: err.message, partial_stats: allStats };
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  runFixedCorrectiveBackfill()
    .then((report) => {
      console.log('');
      if (report.error) {
        console.log('⚠️  Backfill parcialmente executado com alguns erros');
        process.exit(1);
      } else {
        console.log('✅ Backfill corretivo executado com sucesso!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error(`💥 Erro fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { runFixedCorrectiveBackfill, smartFetchPeriod };
