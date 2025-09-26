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

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (err) {
    return null;
  }
}

async function makeIuguRequest(endpoint, retries = 3, delay = 1000) {
  const url = `${IUGU_API_BASE_URL}${endpoint}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
    'Content-Type': 'application/json',
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { method: 'GET', headers });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      logWithTimestamp(`⚠️ Tentativa ${attempt} falhou, tentando novamente em ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

async function upsertToSupabase(table, data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase ${table} error: ${response.status} - ${errorText}`);
  }

  return response;
}

async function syncChargebacks() {
  logWithTimestamp('⚡ Sincronizando chargebacks...');
  let totalProcessed = 0;

  try {
    const endpoint = `/chargebacks?limit=100`;
    const response = await makeIuguRequest(endpoint);
    const chargebacks = response.items || [];

    logWithTimestamp(`   ⚡ ${chargebacks.length} chargebacks para sincronizar`);

    for (const chargeback of chargebacks) {
      try {
        const chargebackData = {
          id: chargeback.id,
          invoice_id: chargeback.invoice_id,
          amount_cents: chargeback.amount_cents || 0,
          currency: chargeback.currency || 'BRL',
          reason: chargeback.reason,
          reason_code: chargeback.reason_code,
          status: chargeback.status,
          type: chargeback.type,
          due_date: parseIuguDate(chargeback.due_date),
          created_at_iugu: parseIuguDate(chargeback.created_at),
          updated_at_iugu: parseIuguDate(chargeback.updated_at),
          raw_json: chargeback,
        };

        await upsertToSupabase('iugu_chargebacks', chargebackData);
        totalProcessed++;
      } catch (error) {
        if (error.message.includes('violates foreign key constraint')) {
          logWithTimestamp(`   ⚠️ Chargeback ${chargeback.id}: fatura não existe (ignorando)`);
        } else {
          logWithTimestamp(`   ⚠️ Erro ao processar chargeback ${chargeback.id}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de chargebacks: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} chargebacks sincronizados`);
  return totalProcessed;
}

async function syncChargebackInvoices() {
  logWithTimestamp('📄 Sincronizando faturas com status chargeback para setembro e agosto...');
  let totalProcessed = 0;

  const periods = [
    { month: 'Setembro 2025', filter: '2025-09' },
    { month: 'Agosto 2025', filter: '2025-08' },
  ];

  for (const period of periods) {
    logWithTimestamp(`📅 Processando ${period.month}...`);

    try {
      let page = 1;
      while (true) {
        const start = (page - 1) * 100;
        const endpoint = `/invoices?limit=100&start=${start}&status=chargeback&created_at_from=${period.filter}-01&created_at_to=${period.filter}-31&sortBy=created_at&sortType=desc`;

        const response = await makeIuguRequest(endpoint);
        const invoices = response.items || [];

        if (invoices.length === 0) break;

        logWithTimestamp(`   📄 Página ${page}: ${invoices.length} faturas`);

        for (const invoice of invoices) {
          try {
            // Criar entrada de chargeback baseada na fatura
            const chargebackData = {
              id: `chargeback_${invoice.id}`,
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
              raw_json: invoice,
            };

            await upsertToSupabase('iugu_chargebacks', chargebackData);
            totalProcessed++;
          } catch (error) {
            logWithTimestamp(`   ⚠️ Erro ao processar fatura ${invoice.id}: ${error.message}`);
          }
        }

        page++;
        if (page > 20) break; // Limite de segurança
      }
    } catch (error) {
      logWithTimestamp(`❌ Erro ao processar ${period.month}: ${error.message}`);
    }
  }

  logWithTimestamp(`   ✅ ${totalProcessed} chargebacks de faturas sincronizados`);
  return totalProcessed;
}

async function minimalWorkingSync() {
  const startTime = new Date();
  logWithTimestamp('🚀 Iniciando sincronização MÍNIMA (apenas chargebacks funcionais)...');

  const results = {
    chargebacks_direct: 0,
    chargebacks_from_invoices: 0,
  };

  try {
    // Sincronizar chargebacks diretos da API
    results.chargebacks_direct = await syncChargebacks();

    // Sincronizar chargebacks via faturas para agosto e setembro
    results.chargebacks_from_invoices = await syncChargebackInvoices();

    const duration = (new Date() - startTime) / 1000;
    const totalRecords = Object.values(results).reduce((sum, count) => sum + count, 0);

    logWithTimestamp('');
    logWithTimestamp('🎉 SINCRONIZAÇÃO MÍNIMA COMPLETA!');
    logWithTimestamp('═'.repeat(50));
    logWithTimestamp(`⚡ Chargebacks diretos: ${results.chargebacks_direct}`);
    logWithTimestamp(`📄 Chargebacks via faturas: ${results.chargebacks_from_invoices}`);
    logWithTimestamp('─'.repeat(50));
    logWithTimestamp(`🎯 Total: ${totalRecords} registros`);
    logWithTimestamp(`⏱️  Duração: ${duration.toFixed(2)}s`);
    logWithTimestamp('');

    return results;
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização: ${error.message}`);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  minimalWorkingSync()
    .then((results) => {
      logWithTimestamp('✅ Sincronização mínima concluída com sucesso!');
      process.exit(0);
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = minimalWorkingSync;
