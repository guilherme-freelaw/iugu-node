#!/usr/bin/env node

/**
 * 🔍 INVESTIGAÇÃO DE TAXAS FALTANTES
 * ===============================
 *
 * 1. Verificar campos relacionados a taxas no Supabase
 * 2. Verificar se a API Iugu retorna informações de taxa
 * 3. Identificar como popular o campo commission_cents
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !IUGU_API_TOKEN) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const iuguHeaders = {
  Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
  'Content-Type': 'application/json',
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

    req.on('error', reject);
    req.end();
  });
}

async function investigateMissingTaxes() {
  console.log('🔍 INVESTIGAÇÃO DE TAXAS FALTANTES');
  console.log('=================================');
  console.log('');

  try {
    // 1. Verificar campos relacionados a taxa no Supabase
    console.log('1. 📊 VERIFICANDO CAMPOS DE TAXA NO SUPABASE:');
    console.log('==============================================');

    const invoicesWithTaxes = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,total_cents,paid_cents,commission_cents,taxes_paid_cents,discount_cents&status=eq.paid&limit=10`,
      { headers: supabaseHeaders }
    );

    if (invoicesWithTaxes && invoicesWithTaxes.length > 0) {
      console.log('📄 Amostra de faturas no Supabase:');
      invoicesWithTaxes.forEach((inv, i) => {
        console.log(`   ${i + 1}. ID: ${inv.id}`);
        console.log(`      Total: R$ ${(inv.total_cents / 100).toFixed(2)}`);
        console.log(`      Pago: R$ ${(inv.paid_cents / 100).toFixed(2)}`);
        console.log(`      Commission: R$ ${((inv.commission_cents || 0) / 100).toFixed(2)}`);
        console.log(`      Taxes Paid: R$ ${((inv.taxes_paid_cents || 0) / 100).toFixed(2)}`);
        console.log(`      Discount: R$ ${((inv.discount_cents || 0) / 100).toFixed(2)}`);
        console.log('');
      });
    }

    // 2. Verificar diretamente na API Iugu
    console.log('2. 🔌 VERIFICANDO API IUGU DIRETAMENTE:');
    console.log('=====================================');

    // Pegar uma fatura da base para testar
    if (invoicesWithTaxes && invoicesWithTaxes.length > 0) {
      const sampleId = invoicesWithTaxes[0].id;
      console.log(`📋 Consultando fatura ${sampleId} na API Iugu...`);

      try {
        const iuguInvoice = await makeRequest(`${IUGU_API_BASE_URL}/invoices/${sampleId}`, {
          headers: iuguHeaders,
        });

        if (iuguInvoice) {
          console.log('📄 Dados da API Iugu:');
          console.log(`   ID: ${iuguInvoice.id}`);
          console.log(`   Status: ${iuguInvoice.status}`);
          console.log(`   Total (cents): ${iuguInvoice.total_cents}`);
          console.log(`   Paid (cents): ${iuguInvoice.paid_cents}`);
          console.log(`   Commission: ${iuguInvoice.commission || 'N/A'}`);
          console.log(`   Taxes Paid: ${iuguInvoice.taxes_paid || 'N/A'}`);
          console.log(`   Discount: ${iuguInvoice.discount || 'N/A'}`);
          console.log(`   Bank Rate: ${iuguInvoice.bank_rate || 'N/A'}`);
          console.log(`   Transaction Fee: ${iuguInvoice.transaction_fee || 'N/A'}`);

          // Listar todos os campos disponíveis
          console.log('');
          console.log('🔍 TODOS OS CAMPOS DISPONÍVEIS NA API:');
          Object.keys(iuguInvoice).forEach((key) => {
            const value = iuguInvoice[key];
            if (
              key.toLowerCase().includes('tax') ||
              key.toLowerCase().includes('fee') ||
              key.toLowerCase().includes('commission') ||
              key.toLowerCase().includes('rate') ||
              key.toLowerCase().includes('discount')
            ) {
              console.log(`   • ${key}: ${value}`);
            }
          });
        }
      } catch (apiErr) {
        console.log(`❌ Erro ao consultar API Iugu: ${apiErr.message}`);
      }
    }

    // 3. Verificar estrutura da tabela no Supabase
    console.log('');
    console.log('3. 🗂️ ESTRUTURA DA TABELA NO SUPABASE:');
    console.log('====================================');

    try {
      // Verificar colunas da tabela
      const tableInfo = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=*&limit=1`,
        { headers: supabaseHeaders }
      );

      if (tableInfo && tableInfo.length > 0) {
        console.log('📋 Campos disponíveis na tabela iugu_invoices:');
        Object.keys(tableInfo[0]).forEach((field) => {
          if (
            field.toLowerCase().includes('tax') ||
            field.toLowerCase().includes('fee') ||
            field.toLowerCase().includes('commission') ||
            field.toLowerCase().includes('rate') ||
            field.toLowerCase().includes('discount') ||
            field.toLowerCase().includes('cents')
          ) {
            console.log(`   • ${field}: ${tableInfo[0][field]}`);
          }
        });
      }
    } catch (err) {
      console.log(`❌ Erro ao verificar estrutura: ${err.message}`);
    }

    // 4. Análise de estatísticas
    console.log('');
    console.log('4. 📈 ESTATÍSTICAS DE CAMPOS DE TAXA:');
    console.log('===================================');

    const statsQuery = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=commission_cents,taxes_paid_cents,discount_cents&status=eq.paid&commission_cents=not.is.null&limit=100`,
      { headers: supabaseHeaders }
    );

    if (statsQuery && statsQuery.length > 0) {
      console.log(`✅ Encontradas ${statsQuery.length} faturas com commission_cents preenchido`);
    } else {
      console.log('❌ Nenhuma fatura encontrada com commission_cents preenchido');
    }

    const taxesPaidQuery = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=taxes_paid_cents&status=eq.paid&taxes_paid_cents=not.is.null&limit=10`,
      { headers: supabaseHeaders }
    );

    if (taxesPaidQuery && taxesPaidQuery.length > 0) {
      console.log(
        `✅ Encontradas ${taxesPaidQuery.length} faturas com taxes_paid_cents preenchido`
      );
    } else {
      console.log('❌ Nenhuma fatura encontrada com taxes_paid_cents preenchido');
    }
  } catch (err) {
    console.error(`❌ Erro na investigação: ${err.message}`);
  }

  console.log('');
  console.log('🎯 PRÓXIMOS PASSOS SUGERIDOS:');
  console.log('=============================');
  console.log('1. Identificar campo correto da taxa na API Iugu');
  console.log('2. Atualizar lógica de importação para capturar taxas');
  console.log('3. Fazer backfill das taxas para faturas existentes');
  console.log('4. Recalcular KPIs com taxas corretas');
  console.log('5. Validar contra planilha do usuário');
}

// Executar se chamado diretamente
if (require.main === module) {
  investigateMissingTaxes()
    .then(() => {
      console.log('');
      console.log('✅ Investigação de taxas concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { investigateMissingTaxes };
