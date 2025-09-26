#!/usr/bin/env node

const https = require('https');

// Configurações
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'count=exact',
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

async function analyzeDatabaseCompleteness() {
  logWithTimestamp('🔍 ANÁLISE DE COMPLETUDE DO BANCO DE DADOS');
  console.log('================================================');

  try {
    const tables = [
      'iugu_invoices',
      'iugu_customers',
      'iugu_subscriptions',
      'iugu_plans',
      'iugu_accounts',
      'iugu_transfers',
      'iugu_charges',
      'iugu_chargebacks',
      'iugu_payment_methods',
      'iugu_invoice_items',
      'iugu_webhook_events',
    ];

    console.log('📊 CONTAGEM POR TABELA:');
    console.log('=======================');

    const results = {};

    for (const table of tables) {
      try {
        const countQuery = `${SUPABASE_URL}/rest/v1/${table}?select=count`;
        const response = await makeRequest(countQuery, {
          method: 'GET',
          headers: supabaseHeaders,
        });

        const count = response[0]?.count || 0;
        results[table] = count;

        const status =
          count === 0
            ? '❌ VAZIA'
            : count === 1
              ? '⚠️ APENAS 1'
              : count < 10
                ? '🟡 POUCOS'
                : '✅ OK';

        console.log(`${status.padEnd(12)} ${table.padEnd(25)}: ${count.toLocaleString()}`);

        // Pequeno delay para não sobrecarregar
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.log(`❌ ERRO     ${table.padEnd(25)}: ${error.message}`);
        results[table] = 'ERROR';
      }
    }

    // Análise de relacionamentos
    console.log('\n🔗 ANÁLISE DE RELACIONAMENTOS:');
    console.log('==============================');

    // Verificar faturas órfãs (sem cliente)
    try {
      const orphanInvoicesQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&customer_id=is.null`;
      const orphanInvoices = await makeRequest(orphanInvoicesQuery, {
        method: 'GET',
        headers: supabaseHeaders,
      });
      console.log(`📄 Faturas sem cliente: ${orphanInvoices[0]?.count || 0}`);
    } catch (error) {
      console.log(`❌ Erro ao verificar faturas órfãs: ${error.message}`);
    }

    // Verificar faturas com clientes válidos
    try {
      const validInvoicesQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&customer_id=not.is.null`;
      const validInvoices = await makeRequest(validInvoicesQuery, {
        method: 'GET',
        headers: supabaseHeaders,
      });
      console.log(`📄 Faturas com cliente: ${validInvoices[0]?.count || 0}`);
    } catch (error) {
      console.log(`❌ Erro ao verificar faturas válidas: ${error.message}`);
    }

    // Verificar faturas com assinatura
    try {
      const subscriptionInvoicesQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&subscription_id=not.is.null`;
      const subscriptionInvoices = await makeRequest(subscriptionInvoicesQuery, {
        method: 'GET',
        headers: supabaseHeaders,
      });
      console.log(`📄 Faturas com assinatura: ${subscriptionInvoices[0]?.count || 0}`);
    } catch (error) {
      console.log(`❌ Erro ao verificar faturas com assinatura: ${error.message}`);
    }

    // Análise de problemas
    console.log('\n🚨 POSSÍVEIS PROBLEMAS IDENTIFICADOS:');
    console.log('====================================');

    const problems = [];

    if (results.iugu_subscriptions <= 1) {
      problems.push('❌ Assinaturas não estão sendo sincronizadas');
    }

    if (results.iugu_plans <= 1) {
      problems.push('❌ Planos não estão sendo sincronizados');
    }

    if (results.iugu_charges === 0) {
      problems.push('❌ Charges não estão sendo sincronizados');
    }

    if (results.iugu_payment_methods === 0) {
      problems.push('❌ Métodos de pagamento não estão sendo sincronizados');
    }

    if (results.iugu_transfers <= 1) {
      problems.push('❌ Transferências não estão sendo sincronizadas');
    }

    if (problems.length === 0) {
      console.log('✅ Nenhum problema crítico identificado');
    } else {
      problems.forEach((problem) => console.log(problem));
    }

    // Recomendações
    console.log('\n💡 RECOMENDAÇÕES:');
    console.log('=================');

    if (results.iugu_subscriptions <= 1) {
      console.log('1. ✅ Implementar sincronização de assinaturas no script hourly_sync.js');
    }

    if (results.iugu_plans <= 1) {
      console.log('2. ✅ Implementar sincronização de planos');
    }

    if (results.iugu_charges === 0) {
      console.log('3. ✅ Implementar sincronização de charges');
    }

    if (results.iugu_payment_methods === 0) {
      console.log('4. ✅ Implementar sincronização de métodos de pagamento');
    }

    console.log('5. 🔄 Executar backfill completo para entidades faltantes');
    console.log('6. 📊 Verificar se o script de sincronização está capturando todas as entidades');

    logWithTimestamp('✅ Análise de completude concluída!');
  } catch (error) {
    logWithTimestamp(`❌ Erro: ${error.message}`);
    process.exit(1);
  }
}

analyzeDatabaseCompleteness();
