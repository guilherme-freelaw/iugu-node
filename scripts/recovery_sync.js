#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

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

async function fetchAndSyncInvoices(startDate, endDate) {
  logWithTimestamp(`📥 Buscando faturas entre ${startDate} e ${endDate}`);

  try {
    let page = 1;
    let totalProcessed = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${IUGU_API_BASE_URL}/invoices?limit=100&created_at_from=${startDate}&sortBy=created_at&sortType=asc&start=${(page - 1) * 100}`;

      const response = await makeRequest(url, {
        method: 'GET',
        headers: iuguHeaders,
      });

      if (!response.items || response.items.length === 0) {
        hasMore = false;
        break;
      }

      logWithTimestamp(`📄 Processando página ${page} (${response.items.length} faturas)`);

      // Processar faturas em lotes menores
      for (let i = 0; i < response.items.length; i += 10) {
        const batch = response.items.slice(i, i + 10);

        for (const invoice of batch) {
          try {
            const invoiceData = {
              id: invoice.id,
              account_id: invoice.account_id,
              customer_id: invoice.customer_id,
              subscription_id: invoice.subscription_id,
              status: invoice.status,
              due_date: parseIuguDate(invoice.due_date),
              paid_at: parseIuguDate(invoice.paid_at),
              payment_method: invoice.payment_method,
              total_cents: invoice.total_cents || invoice.total * 100,
              paid_cents: invoice.paid_cents || invoice.paid * 100,
              discount_cents: invoice.discount_cents || invoice.discount * 100,
              taxes_cents: invoice.taxes_cents || invoice.taxes * 100,
              commission_cents: invoice.commission_cents,
              external_reference: invoice.external_reference,
              order_id: invoice.order_id,
              created_at_iugu: parseIuguDate(invoice.created_at),
              updated_at_iugu: parseIuguDate(invoice.updated_at),
              payer_name: invoice.payer_name,
              payer_email: invoice.payer_email,
              payer_cpf_cnpj: invoice.payer_cpf_cnpj,
              payer_phone: invoice.payer_phone,
              secure_id: invoice.secure_id,
              secure_url: invoice.secure_url,
              raw_json: invoice,
            };

            await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_invoices`, {
              method: 'POST',
              headers: supabaseHeaders,
              body: JSON.stringify(invoiceData),
            });

            totalProcessed++;
          } catch (error) {
            logWithTimestamp(`⚠️ Erro ao processar fatura ${invoice.id}: ${error.message}`);
          }
        }

        // Pequeno delay entre lotes
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Verificar se há mais páginas
      if (response.items.length < 100) {
        hasMore = false;
      } else {
        page++;
        // Delay entre páginas
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    logWithTimestamp(
      `✅ Processadas ${totalProcessed} faturas para período ${startDate} - ${endDate}`
    );
    return totalProcessed;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao buscar faturas: ${error.message}`);
    throw error;
  }
}

async function fetchAndSyncCustomers(startDate, endDate) {
  logWithTimestamp(`👥 Buscando clientes entre ${startDate} e ${endDate}`);

  try {
    const url = `${IUGU_API_BASE_URL}/customers?limit=100&created_at_from=${startDate}`;

    const response = await makeRequest(url, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (!response.items || response.items.length === 0) {
      logWithTimestamp(`📊 Nenhum cliente encontrado para o período`);
      return 0;
    }

    let totalProcessed = 0;

    for (const customer of response.items) {
      try {
        const customerData = {
          id: customer.id,
          email: customer.email,
          name: customer.name,
          cpf_cnpj: customer.cpf_cnpj,
          phone: customer.phone,
          created_at_iugu: parseIuguDate(customer.created_at),
          updated_at_iugu: parseIuguDate(customer.updated_at),
          raw_json: customer,
        };

        await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_customers`, {
          method: 'POST',
          headers: supabaseHeaders,
          body: JSON.stringify(customerData),
        });

        totalProcessed++;
      } catch (error) {
        logWithTimestamp(`⚠️ Erro ao processar cliente ${customer.id}: ${error.message}`);
      }
    }

    logWithTimestamp(
      `✅ Processados ${totalProcessed} clientes para período ${startDate} - ${endDate}`
    );
    return totalProcessed;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao buscar clientes: ${error.message}`);
    throw error;
  }
}

async function recoverySyncPeriod(startDate, endDate) {
  logWithTimestamp(`🔄 INICIANDO SINCRONIZAÇÃO DE RECUPERAÇÃO`);
  logWithTimestamp(`📅 Período: ${startDate} até ${endDate}`);

  const results = {
    invoices: 0,
    customers: 0,
    subscriptions: 0,
    errors: [],
  };

  try {
    // 1. Sincronizar clientes primeiro (para satisfazer foreign keys)
    results.customers = await fetchAndSyncCustomers(startDate, endDate);

    // 2. Sincronizar faturas
    results.invoices = await fetchAndSyncInvoices(startDate, endDate);

    logWithTimestamp(`📊 RECUPERAÇÃO CONCLUÍDA:`);
    logWithTimestamp(`   📄 Faturas: ${results.invoices}`);
    logWithTimestamp(`   👥 Clientes: ${results.customers}`);

    return results;
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de recuperação: ${error.message}`);
    results.errors.push(error.message);
    throw error;
  }
}

async function main() {
  logWithTimestamp('🚀 INICIANDO SINCRONIZAÇÃO DE RECUPERAÇÃO');
  console.log('================================================');

  // Recuperar dados dos últimos 4 dias (12-15 setembro)
  const periods = [
    { start: '2025-09-12', end: '2025-09-12' },
    { start: '2025-09-13', end: '2025-09-13' },
    { start: '2025-09-14', end: '2025-09-14' },
    { start: '2025-09-15', end: '2025-09-15' },
  ];

  let totalResults = {
    invoices: 0,
    customers: 0,
    errors: [],
  };

  for (const period of periods) {
    try {
      const results = await recoverySyncPeriod(period.start, period.end);
      totalResults.invoices += results.invoices;
      totalResults.customers += results.customers;
      totalResults.errors.push(...results.errors);

      // Delay entre períodos
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      logWithTimestamp(`❌ Falha no período ${period.start}: ${error.message}`);
      totalResults.errors.push(`${period.start}: ${error.message}`);
    }
  }

  console.log('\n📊 RESUMO FINAL DA RECUPERAÇÃO:');
  console.log('===============================');
  console.log(`📄 Total de faturas sincronizadas: ${totalResults.invoices}`);
  console.log(`👥 Total de clientes sincronizados: ${totalResults.customers}`);
  console.log(`❌ Total de erros: ${totalResults.errors.length}`);

  if (totalResults.errors.length > 0) {
    console.log('\n🚨 ERROS ENCONTRADOS:');
    totalResults.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}`);
    });
  }

  logWithTimestamp('✅ SINCRONIZAÇÃO DE RECUPERAÇÃO CONCLUÍDA!');
}

main().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
