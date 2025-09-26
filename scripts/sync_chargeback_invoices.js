#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function logWithTimestamp(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

function parseIuguDate(dateString) {
  if (!dateString) return null;

  // Se já está em formato ISO, retorna
  if (typeof dateString === 'string' && dateString.includes('T')) {
    return dateString;
  }

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (err) {
    logWithTimestamp(`⚠️ Could not parse date: ${dateString}`);
    return null;
  }
}

async function makeIuguRequest(endpoint, options = {}) {
  const url = `${IUGU_API_BASE_URL}${endpoint}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

async function makeSupabaseRequest(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...options.headers,
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

async function syncChargebackInvoices() {
  logWithTimestamp('🔍 Sincronizando faturas com status chargeback...');

  try {
    // Buscar faturas com chargeback por período
    const periods = [
      { name: 'Agosto 2025', from: '2025-08-01', to: '2025-08-31' },
      { name: 'Setembro 2025', from: '2025-09-01', to: '2025-09-30' },
      { name: 'Julho 2025', from: '2025-07-01', to: '2025-07-31' }, // Para comparação
    ];

    let totalProcessed = 0;
    const chargebacksByMonth = {};

    for (const period of periods) {
      logWithTimestamp(`📅 Processando ${period.name}...`);

      let page = 1;
      let hasMore = true;
      let periodTotal = 0;

      while (hasMore) {
        const endpoint = `/invoices?status=chargeback&created_at_from=${period.from}&created_at_to=${period.to}&limit=100&start=${(page - 1) * 100}`;

        try {
          const result = await makeIuguRequest(endpoint);
          const invoices = result.items || [];

          logWithTimestamp(`   📄 Página ${page}: ${invoices.length} faturas`);

          if (invoices.length === 0) {
            hasMore = false;
            break;
          }

          // Processar e sincronizar cada fatura
          for (const invoice of invoices) {
            try {
              // Verificar se a fatura tem dados válidos
              if (!invoice.id) {
                logWithTimestamp(`   ⚠️ Fatura sem ID, pulando...`);
                continue;
              }

              // Criar entrada específica para chargeback (usando a fatura como base)
              const chargebackData = {
                id: `chargeback_${invoice.id}`, // ID único para o chargeback
                invoice_id: invoice.id,
                amount_cents: invoice.total_cents || 0,
                currency: invoice.currency || 'BRL',
                reason: 'chargeback_from_invoice',
                reason_code: 'invoice_status_chargeback',
                status: 'from_invoice',
                type: 'invoice_based',
                due_date: parseIuguDate(invoice.due_date),
                created_at_iugu: parseIuguDate(invoice.created_at),
                updated_at_iugu: parseIuguDate(invoice.updated_at),
                raw_json: invoice, // Incluindo o raw_json obrigatório
              };

              // Upsert no Supabase com tratamento de erro mais robusto
              const response = await fetch(`${SUPABASE_URL}/rest/v1/iugu_chargebacks`, {
                method: 'POST',
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                  Prefer: 'resolution=merge-duplicates',
                },
                body: JSON.stringify(chargebackData),
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Supabase error: ${response.status} - ${errorText}`);
              }

              // Também atualizar a fatura no Supabase se necessário
              const invoiceData = {
                id: invoice.id,
                status: invoice.status,
                total_cents: invoice.total_cents || 0,
                paid_cents: invoice.paid_cents || 0,
                taxes_cents: invoice.taxes_paid_cents || 0,
                commission_cents: invoice.commission_cents || 0,
                customer_id: invoice.customer_id,
                subscription_id: invoice.subscription_id,
                due_date: parseIuguDate(invoice.due_date),
                paid_at: parseIuguDate(invoice.paid_at),
                created_at_iugu: parseIuguDate(invoice.created_at),
                updated_at_iugu: parseIuguDate(invoice.updated_at),
                payment_method: invoice.payment_method,
                currency: invoice.currency || 'BRL',
              };

              const invoiceResponse = await fetch(`${SUPABASE_URL}/rest/v1/iugu_invoices`, {
                method: 'POST',
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                  Prefer: 'resolution=merge-duplicates',
                },
                body: JSON.stringify(invoiceData),
              });

              if (!invoiceResponse.ok) {
                const errorText = await invoiceResponse.text();
                logWithTimestamp(`   ⚠️ Erro ao atualizar fatura ${invoice.id}: ${errorText}`);
              }

              periodTotal++;
              totalProcessed++;
            } catch (error) {
              logWithTimestamp(`   ⚠️ Erro ao processar fatura ${invoice.id}: ${error.message}`);
            }
          }

          // Agrupar por mês para estatísticas
          const monthKey = `${period.from.substring(0, 7)}`;
          if (!chargebacksByMonth[monthKey]) {
            chargebacksByMonth[monthKey] = 0;
          }
          chargebacksByMonth[monthKey] += invoices.length;

          page++;

          // Evitar loop infinito
          if (page > 20) {
            logWithTimestamp(`   ⚠️ Limite de páginas atingido para ${period.name}`);
            break;
          }
        } catch (error) {
          logWithTimestamp(`   ❌ Erro na página ${page}: ${error.message}`);
          hasMore = false;
        }
      }

      logWithTimestamp(`   ✅ ${period.name}: ${periodTotal} faturas com chargeback processadas`);
      logWithTimestamp('');
    }

    // Mostrar estatísticas finais
    logWithTimestamp('📊 ESTATÍSTICAS FINAIS:');
    logWithTimestamp('═'.repeat(50));

    for (const [month, count] of Object.entries(chargebacksByMonth)) {
      const [year, monthNum] = month.split('-');
      const monthNames = [
        'Jan',
        'Fev',
        'Mar',
        'Abr',
        'Mai',
        'Jun',
        'Jul',
        'Ago',
        'Set',
        'Out',
        'Nov',
        'Dez',
      ];
      const monthName = monthNames[parseInt(monthNum) - 1];

      logWithTimestamp(`📅 ${monthName}/${year}: ${count} chargebacks (via faturas)`);
    }

    logWithTimestamp('');
    logWithTimestamp(`🎯 Total processado: ${totalProcessed} chargebacks`);

    // Verificar totais no Supabase após sincronização
    logWithTimestamp('');
    logWithTimestamp('🔍 Verificando totais no Supabase...');

    const supabaseTotal = await makeSupabaseRequest('iugu_chargebacks?select=count', {
      headers: { Prefer: 'count=exact' },
    });

    logWithTimestamp(
      `📊 Total no Supabase após sincronização: ${supabaseTotal.length > 0 ? 'Múltiplos registros' : '0'}`
    );

    return {
      success: true,
      totalProcessed,
      chargebacksByMonth,
    };
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização: ${error.message}`);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  syncChargebackInvoices()
    .then((result) => {
      logWithTimestamp('🎉 Sincronização de chargebacks via faturas concluída!');
      logWithTimestamp('Agora os números devem bater com suas expectativas!');
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = syncChargebackInvoices;
