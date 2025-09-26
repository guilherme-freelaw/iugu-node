#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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

async function debugDataIssues() {
  console.log('🔍 DEPURAÇÃO DE PROBLEMAS NOS DADOS');
  console.log('==================================');

  try {
    // 1. Verificar se há qualquer fatura na base
    console.log('1. 📊 Total de faturas na base:');
    const totalInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id&limit=1`,
      { headers: supabaseHeaders }
    );
    console.log(`   Total na base: ${totalInvoices ? totalInvoices.length : 0}`);

    if (!totalInvoices || totalInvoices.length === 0) {
      console.log('❌ PROBLEMA: Não há faturas na base de dados!');
      return;
    }

    // 2. Verificar faturas com status "paid"
    console.log('\n2. 💰 Faturas com status "paid":');
    const paidInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status&status=eq.paid&limit=5`,
      { headers: supabaseHeaders }
    );
    console.log(`   Faturas pagas: ${paidInvoices ? paidInvoices.length : 0}`);
    if (paidInvoices && paidInvoices.length > 0) {
      console.log(
        '   Amostra:',
        paidInvoices.slice(0, 3).map((inv) => inv.id)
      );
    }

    // 3. Verificar faturas de agosto 2025
    console.log('\n3. 📅 Faturas de agosto 2025:');
    const augustInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,paid_at,created_at_iugu&limit=10`,
      { headers: supabaseHeaders }
    );

    if (augustInvoices && augustInvoices.length > 0) {
      console.log(`   Total encontradas: ${augustInvoices.length}`);
      console.log('   Amostra de datas:');
      augustInvoices.slice(0, 5).forEach((inv, i) => {
        console.log(
          `     ${i + 1}. ${inv.id}: paid_at=${inv.paid_at}, created=${inv.created_at_iugu}`
        );
      });

      // Verificar se alguma é de agosto
      const augustCount = augustInvoices.filter(
        (inv) =>
          (inv.paid_at && inv.paid_at.startsWith('2025-08')) ||
          (inv.created_at_iugu && inv.created_at_iugu.startsWith('2025-08'))
      ).length;
      console.log(`   Faturas de agosto encontradas: ${augustCount}`);
    }

    // 4. Verificar todos os status
    console.log('\n4. 📋 Status das faturas:');
    const allStatuses = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=status&limit=1000`,
      { headers: supabaseHeaders }
    );

    if (allStatuses) {
      const statusCounts = allStatuses.reduce((acc, inv) => {
        const status = inv.status || 'NULL';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});

      console.log('   Distribuição de status:');
      Object.entries(statusCounts)
        .sort(([, a], [, b]) => b - a)
        .forEach(([status, count]) => {
          console.log(`     • ${status}: ${count} faturas`);
        });
    }

    // 5. Verificar campos paid_at
    console.log('\n5. 💳 Análise do campo paid_at:');
    const paidAtSample = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_at&paid_at=not.is.null&limit=10`,
      { headers: supabaseHeaders }
    );

    if (paidAtSample && paidAtSample.length > 0) {
      console.log(`   Faturas com paid_at: ${paidAtSample.length}`);
      console.log('   Amostra de datas paid_at:');
      paidAtSample.slice(0, 5).forEach((inv, i) => {
        console.log(`     ${i + 1}. ${inv.paid_at}`);
      });
    } else {
      console.log('   ❌ PROBLEMA: Nenhuma fatura tem paid_at preenchido!');
    }

    // 6. Verificar faturas com subscription_id
    console.log('\n6. 🔄 Faturas com subscription_id:');
    const subscriptionInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,subscription_id&subscription_id=not.is.null&limit=5`,
      { headers: supabaseHeaders }
    );

    console.log(
      `   Faturas com subscription: ${subscriptionInvoices ? subscriptionInvoices.length : 0}`
    );

    // 7. Testar a função de detecção de teste
    console.log('\n7. 🧪 Teste da função de detecção de faturas de teste:');
    const sampleInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,customer_id,total_cents,subscription_id&limit=10`,
      { headers: supabaseHeaders }
    );

    if (sampleInvoices) {
      sampleInvoices.slice(0, 5).forEach((inv, i) => {
        const isTest =
          /^test/i.test(inv.id || '') ||
          /test$/i.test(inv.id || '') ||
          /teste/i.test(inv.id || '') ||
          /^[0-9A-F]{32}$/.test(inv.id || '') ||
          /^test/i.test(inv.customer_id || '') ||
          /teste/i.test(inv.customer_id || '') ||
          (inv.total_cents === 1000 && !inv.subscription_id);

        console.log(
          `     ${i + 1}. ${inv.id}: isTest=${isTest} (total=${inv.total_cents}, subscription=${inv.subscription_id})`
        );
      });
    }

    console.log('\n8. 🔍 RECOMENDAÇÕES:');
    console.log('====================');

    if (!paidAtSample || paidAtSample.length === 0) {
      console.log('❌ PROBLEMA PRINCIPAL: Campo paid_at está vazio');
      console.log('   Solução: Usar created_at_iugu ou outro campo de data');
    }

    if (!paidInvoices || paidInvoices.length === 0) {
      console.log('❌ PROBLEMA: Nenhuma fatura com status "paid"');
      console.log('   Solução: Verificar outros status válidos');
    }
  } catch (err) {
    console.error(`❌ Erro na depuração: ${err.message}`);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  debugDataIssues()
    .then(() => {
      console.log('\n✅ Depuração concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { debugDataIssues };
