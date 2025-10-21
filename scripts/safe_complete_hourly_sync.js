#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SYNC_CHECKPOINT_FILE = 'hourly_sync_checkpoint.json';
const fs = require('fs');

function logWithTimestamp(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
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
      delay *= 2; // Exponential backoff
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

function loadCheckpoint() {
  try {
    if (fs.existsSync(SYNC_CHECKPOINT_FILE)) {
      const data = fs.readFileSync(SYNC_CHECKPOINT_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logWithTimestamp(`⚠️ Erro ao carregar checkpoint: ${error.message}`);
  }

  // Checkpoint padrão - última hora
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return {
    lastSync: oneHourAgo.toISOString(),
    invoices: 0,
    customers: 0,
    chargebacks: 0,
  };
}

function saveCheckpoint(checkpoint) {
  try {
    fs.writeFileSync(SYNC_CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  } catch (error) {
    logWithTimestamp(`⚠️ Erro ao salvar checkpoint: ${error.message}`);
  }
}

async function syncInvoices(lastSync) {
  logWithTimestamp('📄 Sincronizando faturas...');
  let totalProcessed = 0;
  let page = 1;
  const limit = 100;

  try {
    while (true) {
      const start = (page - 1) * limit;
      const endpoint = `/invoices?limit=${limit}&start=${start}&updated_at_from=${lastSync}&sortBy=updated_at&sortType=desc`;

      const response = await makeIuguRequest(endpoint);
      const invoices = response.items || [];

      if (invoices.length === 0) break;

      logWithTimestamp(`   📋 Página ${page}: ${invoices.length} faturas`);

      for (const invoice of invoices) {
        try {
          // Usar apenas campos que existem na tabela
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
            payer_name: invoice.payer?.name || null,
            payer_email: invoice.payer?.email || null,
            // Removidos: currency, payer_cpf, description (campos faltantes)
          };

          await upsertToSupabase('iugu_invoices', invoiceData);
          totalProcessed++;

          // Se a fatura tem status chargeback, criar entrada de chargeback
          if (invoice.status === 'chargeback') {
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

            try {
              await upsertToSupabase('iugu_chargebacks', chargebackData);
            } catch (error) {
              logWithTimestamp(
                `   ⚠️ Erro ao criar chargeback para ${invoice.id}: ${error.message}`
              );
            }
          }
        } catch (error) {
          logWithTimestamp(`   ⚠️ Erro ao processar fatura ${invoice.id}: ${error.message}`);
        }
      }

      page++;
      if (page > 50) break; // Limite de segurança
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de faturas: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} faturas sincronizadas`);
  return totalProcessed;
}

async function syncCustomers(lastSync) {
  logWithTimestamp('👥 Sincronizando clientes...');
  let totalProcessed = 0;

  try {
    const endpoint = `/customers?limit=100&updated_at_from=${lastSync}`;
    const response = await makeIuguRequest(endpoint);
    const customers = response.items || [];

    logWithTimestamp(`   👤 ${customers.length} clientes para sincronizar`);

    for (const customer of customers) {
      try {
        // Usar apenas campos que existem na tabela
        const customerData = {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          cpf_cnpj: customer.cpf_cnpj,
          zip_code: customer.zip_code,
          phone: customer.phone,
          created_at_iugu: parseIuguDate(customer.created_at),
          updated_at_iugu: parseIuguDate(customer.updated_at),
          // Removidos: address, number, district, city, state, country, notes (campos faltantes)
        };

        await upsertToSupabase('iugu_customers', customerData);
        totalProcessed++;
      } catch (error) {
        logWithTimestamp(`   ⚠️ Erro ao processar cliente ${customer.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de clientes: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} clientes sincronizados`);
  return totalProcessed;
}

async function syncChargebacks(lastSync) {
  logWithTimestamp('⚡ Sincronizando chargebacks...');
  let totalProcessed = 0;

  try {
    const endpoint = `/chargebacks?limit=100&updated_at_from=${lastSync}`;
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
        logWithTimestamp(`   ⚠️ Erro ao processar chargeback ${chargeback.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de chargebacks: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} chargebacks sincronizados`);
  return totalProcessed;
}

async function safeHourlySync() {
  const startTime = new Date();
  logWithTimestamp('🚀 Iniciando sincronização horária SEGURA (apenas campos existentes)...');

  const checkpoint = loadCheckpoint();
  const lastSync = checkpoint.lastSync;
  logWithTimestamp(`📅 Última sincronização: ${lastSync}`);

  const results = {
    invoices: 0,
    customers: 0,
    chargebacks: 0,
  };

  try {
    // Sincronizar apenas entidades que funcionam
    results.invoices = await syncInvoices(lastSync);
    results.customers = await syncCustomers(lastSync);
    results.chargebacks = await syncChargebacks(lastSync);

    // Atualizar checkpoint
    const newCheckpoint = {
  lastSync: startTime.toISOString(),
  ...results,
  totalSynced: Object.values(results).reduce((a,b)=>a+(Number(b)||0),0),
  lastRun: new Date().toISOString(),
};

    saveCheckpoint(newCheckpoint);

    const duration = (new Date() - startTime) / 1000;
    const totalRecords = Object.values(results).reduce((sum, count) => sum + count, 0);

    logWithTimestamp('');
    logWithTimestamp('🎉 SINCRONIZAÇÃO HORÁRIA SEGURA COMPLETA!');
    logWithTimestamp('═'.repeat(50));
    logWithTimestamp(`📄 Faturas: ${results.invoices}`);
    logWithTimestamp(`👥 Clientes: ${results.customers}`);
    logWithTimestamp(`⚡ Chargebacks: ${results.chargebacks}`);
    logWithTimestamp('─'.repeat(50));
    logWithTimestamp(`🎯 Total: ${totalRecords} registros`);
    logWithTimestamp(`⏱️  Duração: ${duration.toFixed(2)}s`);
    logWithTimestamp('');
    logWithTimestamp('📋 NOTA: Usando apenas campos existentes no schema atual');
    logWithTimestamp(
      '💡 Para sincronização completa, aplique a migração 024_add_missing_columns.sql'
    );

    return results;
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização: ${error.message}`);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  safeHourlySync()
    .then((results) => {
      logWithTimestamp('✅ Sincronização horária segura concluída com sucesso!');
      process.exit(0);
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = safeHourlySync;
