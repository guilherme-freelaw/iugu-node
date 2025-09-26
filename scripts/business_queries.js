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

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

async function queryPixInvoicesJune2025() {
  logWithTimestamp('🔍 CONSULTA 1: Faturas pagas via PIX em junho de 2025');
  logWithTimestamp('======================================================');

  try {
    const startTime = Date.now();

    // Buscar faturas pagas via PIX em junho 2025
    const pixInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,paid_cents,paid_at,payment_method&status=eq.paid&payment_method=eq.pix&paid_at=gte.2025-06-01&paid_at=lt.2025-07-01`,
      { headers: supabaseHeaders }
    );

    const queryTime = Date.now() - startTime;

    const totalInvoices = pixInvoices.length;
    const totalValue =
      pixInvoices.reduce(
        (sum, invoice) => sum + (invoice.paid_cents || invoice.total_cents || 0),
        0
      ) / 100;

    console.log('');
    console.log('📊 RESULTADOS:');
    console.log(`   💳 Faturas pagas via PIX: ${totalInvoices.toLocaleString()}`);
    console.log(
      `   💰 Valor total: R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(`   ⚡ Tempo de consulta: ${queryTime}ms`);

    // Mostrar algumas faturas como exemplo
    if (pixInvoices.length > 0) {
      console.log('');
      console.log('📄 EXEMPLOS (primeiras 5 faturas):');
      pixInvoices.slice(0, 5).forEach((invoice, index) => {
        const value = (invoice.paid_cents || invoice.total_cents || 0) / 100;
        const date = new Date(invoice.paid_at).toLocaleDateString('pt-BR');
        console.log(`   ${index + 1}. ID: ${invoice.id} | R$ ${value.toFixed(2)} | ${date}`);
      });
    }

    return {
      query: 'PIX invoices June 2025',
      count: totalInvoices,
      totalValue: totalValue,
      queryTime: queryTime,
    };
  } catch (err) {
    console.error(`❌ Erro na consulta PIX: ${err.message}`);
    return null;
  }
}

async function queryActiveMRRAugust2025() {
  logWithTimestamp('');
  logWithTimestamp('🔍 CONSULTA 2: MRR ativo ao final de agosto 2025');
  logWithTimestamp('================================================');

  try {
    const startTime = Date.now();

    // Buscar assinaturas ativas no final de agosto
    const activeSubscriptions = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_subscriptions?select=id,customer_id,plan_id,suspended,active,raw_json&active=eq.true&suspended=eq.false`,
      { headers: supabaseHeaders }
    );

    // Para cada assinatura ativa, buscar a última fatura de agosto para calcular valor
    const subscriptionValues = [];

    for (const subscription of activeSubscriptions.slice(0, 50)) {
      // Limitar para não sobrecarregar
      try {
        // Buscar última fatura da assinatura em agosto
        const subscriptionInvoices = await makeRequest(
          `${SUPABASE_URL}/rest/v1/iugu_invoices?select=total_cents,created_at_iugu,status&subscription_id=eq.${subscription.id}&created_at_iugu=gte.2025-08-01&created_at_iugu=lt.2025-09-01&order=created_at_iugu.desc&limit=1`,
          { headers: supabaseHeaders }
        );

        if (subscriptionInvoices.length > 0) {
          const lastInvoice = subscriptionInvoices[0];
          subscriptionValues.push({
            subscriptionId: subscription.id,
            value: lastInvoice.total_cents || 0,
            status: lastInvoice.status,
          });
        }
      } catch (err) {
        // Ignorar erros de assinaturas individuais
      }
    }

    const queryTime = Date.now() - startTime;

    // Calcular MRR
    const totalMRR = subscriptionValues.reduce((sum, sub) => sum + sub.value, 0) / 100;
    const activeCount = activeSubscriptions.length;
    const withInvoices = subscriptionValues.length;

    console.log('');
    console.log('📊 RESULTADOS:');
    console.log(`   📋 Assinaturas ativas: ${activeCount.toLocaleString()}`);
    console.log(
      `   💰 MRR calculado (amostra de ${withInvoices}): R$ ${totalMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(`   📈 MRR médio por assinatura: R$ ${(totalMRR / withInvoices).toFixed(2)}`);
    console.log(
      `   🔄 Projeção total (${activeCount} subs): R$ ${((totalMRR / withInvoices) * activeCount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(`   ⚡ Tempo de consulta: ${queryTime}ms`);

    // Distribuição de valores
    if (subscriptionValues.length > 0) {
      const values = subscriptionValues.map((s) => s.value / 100).sort((a, b) => b - a);
      console.log('');
      console.log('📈 DISTRIBUIÇÃO DE VALORES:');
      console.log(`   🏆 Maior: R$ ${values[0]?.toFixed(2) || '0.00'}`);
      console.log(
        `   📊 Mediana: R$ ${values[Math.floor(values.length / 2)]?.toFixed(2) || '0.00'}`
      );
      console.log(`   📉 Menor: R$ ${values[values.length - 1]?.toFixed(2) || '0.00'}`);
    }

    return {
      query: 'Active MRR August 2025',
      activeSubscriptions: activeCount,
      calculatedMRR: totalMRR,
      projectedMRR: (totalMRR / withInvoices) * activeCount,
      queryTime: queryTime,
    };
  } catch (err) {
    console.error(`❌ Erro na consulta MRR: ${err.message}`);
    return null;
  }
}

async function runBusinessQueries() {
  console.log('🚀 CONSULTAS DE NEGÓCIO - SUPABASE');
  console.log('===================================');
  console.log('🎯 Testando velocidade e precisão das consultas diretas no Supabase');
  console.log('');

  const results = [];

  // Executar consultas
  const pixResult = await queryPixInvoicesJune2025();
  if (pixResult) results.push(pixResult);

  const mrrResult = await queryActiveMRRAugust2025();
  if (mrrResult) results.push(mrrResult);

  // Resumo final
  console.log('');
  console.log('⚡ RESUMO DE PERFORMANCE:');
  console.log('========================');
  results.forEach((result) => {
    console.log(`📊 ${result.query}: ${result.queryTime}ms`);
  });

  const avgTime = results.reduce((sum, r) => sum + r.queryTime, 0) / results.length;
  console.log(`🎯 Tempo médio: ${avgTime.toFixed(0)}ms`);

  if (avgTime < 1000) {
    console.log('🚀 PERFORMANCE: EXCELENTE (< 1s)');
  } else if (avgTime < 3000) {
    console.log('✅ PERFORMANCE: BOA (< 3s)');
  } else {
    console.log('⚠️  PERFORMANCE: PODE MELHORAR (> 3s)');
  }

  return results;
}

// Executar se chamado diretamente
if (require.main === module) {
  runBusinessQueries()
    .then((results) => {
      console.log('');
      console.log('✅ Consultas concluídas com sucesso!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { queryPixInvoicesJune2025, queryActiveMRRAugust2025, runBusinessQueries };
