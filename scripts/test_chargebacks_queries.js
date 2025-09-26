#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function logWithTimestamp(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
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

async function testChargebacksQueries() {
  logWithTimestamp('🔍 Testando consultas de chargebacks...');

  try {
    // 1. Contar total de chargebacks
    logWithTimestamp('📊 1. Contando total de chargebacks...');
    const countResult = await makeSupabaseRequest('iugu_chargebacks?select=count', {
      headers: { Prefer: 'count=exact' },
    });
    logWithTimestamp(`   Total: ${countResult.length > 0 ? 'Vários registros' : '0'} chargebacks`);

    // 2. Listar todos os chargebacks com detalhes
    logWithTimestamp('📋 2. Listando todos os chargebacks...');
    const allChargebacks = await makeSupabaseRequest('iugu_chargebacks?select=*');
    logWithTimestamp(`   Encontrados: ${allChargebacks.length} chargebacks`);

    if (allChargebacks.length > 0) {
      logWithTimestamp('   Detalhes dos chargebacks:');
      allChargebacks.forEach((chargeback, index) => {
        logWithTimestamp(`   ${index + 1}. ID: ${chargeback.id}`);
        logWithTimestamp(`      Invoice ID: ${chargeback.invoice_id || 'N/A'}`);
        logWithTimestamp(`      Amount: R$ ${(chargeback.amount_cents || 0) / 100}`);
        logWithTimestamp(`      Created: ${chargeback.created_at_iugu || 'N/A'}`);
        logWithTimestamp(`      Updated: ${chargeback.updated_at_iugu || 'N/A'}`);
        logWithTimestamp('');
      });
    }

    // 3. Testar consulta por invoice_id (se houver chargebacks)
    if (allChargebacks.length > 0) {
      const firstChargeback = allChargebacks[0];
      if (firstChargeback.invoice_id) {
        logWithTimestamp('🔗 3. Testando consulta por invoice_id...');
        const chargebacksByInvoice = await makeSupabaseRequest(
          `iugu_chargebacks?invoice_id=eq.${firstChargeback.invoice_id}&select=*`
        );
        logWithTimestamp(
          `   Chargebacks para invoice ${firstChargeback.invoice_id}: ${chargebacksByInvoice.length}`
        );
      }
    }

    // 4. Testar consulta com join para pegar dados da fatura relacionada
    if (allChargebacks.length > 0) {
      logWithTimestamp('🔗 4. Testando join com faturas...');
      const chargebacksWithInvoices = await makeSupabaseRequest(
        'iugu_chargebacks?select=*,iugu_invoices!inner(*)'
      );
      logWithTimestamp(`   Chargebacks com dados da fatura: ${chargebacksWithInvoices.length}`);

      if (chargebacksWithInvoices.length > 0) {
        logWithTimestamp('   Exemplo de chargeback com fatura:');
        const example = chargebacksWithInvoices[0];
        logWithTimestamp(`     Chargeback ID: ${example.id}`);
        logWithTimestamp(`     Fatura valor: R$ ${(example.iugu_invoices.total_cents || 0) / 100}`);
        logWithTimestamp(`     Fatura status: ${example.iugu_invoices.status || 'N/A'}`);
      }
    }

    // 5. Estatísticas dos chargebacks
    if (allChargebacks.length > 0) {
      logWithTimestamp('📈 5. Estatísticas dos chargebacks...');

      const totalAmount = allChargebacks.reduce((sum, cb) => sum + (cb.amount_cents || 0), 0);
      const avgAmount = totalAmount / allChargebacks.length;

      logWithTimestamp(`   Valor total dos chargebacks: R$ ${totalAmount / 100}`);
      logWithTimestamp(`   Valor médio: R$ ${avgAmount / 100}`);

      const withInvoiceId = allChargebacks.filter((cb) => cb.invoice_id).length;
      logWithTimestamp(
        `   Chargebacks com invoice_id: ${withInvoiceId} de ${allChargebacks.length}`
      );

      const withAmount = allChargebacks.filter(
        (cb) => cb.amount_cents && cb.amount_cents > 0
      ).length;
      logWithTimestamp(`   Chargebacks com valor > 0: ${withAmount} de ${allChargebacks.length}`);
    }

    // 6. Testar estrutura da tabela
    logWithTimestamp('🏗️  6. Verificando estrutura da tabela...');
    try {
      const schemaCheck = await makeSupabaseRequest('iugu_chargebacks?limit=1&select=*');
      if (schemaCheck.length > 0) {
        const columns = Object.keys(schemaCheck[0]);
        logWithTimestamp(`   Colunas disponíveis: ${columns.join(', ')}`);
      }
    } catch (error) {
      logWithTimestamp(`   ⚠️ Erro ao verificar schema: ${error.message}`);
    }

    logWithTimestamp('✅ Testes de consulta de chargebacks concluídos!');

    return {
      success: true,
      totalChargebacks: allChargebacks.length,
      chargebacks: allChargebacks,
    };
  } catch (error) {
    logWithTimestamp(`❌ Erro nos testes de chargebacks: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  testChargebacksQueries()
    .then((result) => {
      if (result.success) {
        logWithTimestamp('🎉 Consultas de chargebacks funcionando perfeitamente!');
      } else {
        logWithTimestamp('💥 Problemas encontrados nas consultas de chargebacks');
        process.exit(1);
      }
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = testChargebacksQueries;
