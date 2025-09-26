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
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,paid_cents,paid_at,payment_method&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.2025-06-01&paid_at=lt.2025-07-01`,
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

    // Buscar assinaturas não suspensas
    const activeSubscriptions = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_subscriptions?select=id,customer_id,plan_id,suspended,price_cents,status&suspended=eq.false`,
      { headers: supabaseHeaders }
    );

    console.log(`📋 Total de assinaturas não suspensas: ${activeSubscriptions.length}`);

    // Calcular MRR baseado nos preços das assinaturas
    let totalMRR = 0;
    let validSubscriptions = 0;

    activeSubscriptions.forEach((subscription) => {
      if (subscription.price_cents && subscription.price_cents > 0) {
        totalMRR += subscription.price_cents / 100;
        validSubscriptions++;
      }
    });

    // Buscar dados de algumas assinaturas para validação
    const sampleSubscriptions = activeSubscriptions.slice(0, 10);
    console.log('');
    console.log('📋 AMOSTRA DE ASSINATURAS:');
    sampleSubscriptions.forEach((sub, index) => {
      const value = (sub.price_cents || 0) / 100;
      console.log(
        `   ${index + 1}. ID: ${sub.id} | R$ ${value.toFixed(2)} | Status: ${sub.status || 'N/A'} | Suspensa: ${sub.suspended}`
      );
    });

    // Alternativa: Calcular MRR baseado em faturas recentes de assinaturas
    console.log('');
    console.log('🔍 Validando com faturas recentes de agosto...');

    const recentInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=subscription_id,total_cents,status,created_at_iugu&subscription_id=not.is.null&created_at_iugu=gte.2025-08-01&created_at_iugu=lt.2025-09-01&status=eq.paid&limit=100`,
      { headers: supabaseHeaders }
    );

    // Agrupar por subscription_id para evitar duplicatas
    const subscriptionRevenue = {};
    recentInvoices.forEach((invoice) => {
      if (invoice.subscription_id && invoice.total_cents) {
        if (
          !subscriptionRevenue[invoice.subscription_id] ||
          new Date(invoice.created_at_iugu) >
            new Date(subscriptionRevenue[invoice.subscription_id].date)
        ) {
          subscriptionRevenue[invoice.subscription_id] = {
            value: invoice.total_cents / 100,
            date: invoice.created_at_iugu,
          };
        }
      }
    });

    const invoiceBasedMRR = Object.values(subscriptionRevenue).reduce(
      (sum, sub) => sum + sub.value,
      0
    );
    const subscriptionsWithInvoices = Object.keys(subscriptionRevenue).length;

    const queryTime = Date.now() - startTime;

    console.log('');
    console.log('📊 RESULTADOS:');
    console.log(`   📋 Assinaturas não suspensas: ${activeSubscriptions.length.toLocaleString()}`);
    console.log(
      `   💰 MRR (baseado em preços): R$ ${totalMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(`   📈 Assinaturas com preços válidos: ${validSubscriptions.toLocaleString()}`);
    console.log('');
    console.log(
      `   🧾 MRR (baseado em faturas ago): R$ ${invoiceBasedMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(`   📋 Assinaturas com faturas ago: ${subscriptionsWithInvoices.toLocaleString()}`);
    console.log(
      `   📊 Valor médio por assinatura: R$ ${(invoiceBasedMRR / subscriptionsWithInvoices || 0).toFixed(2)}`
    );
    console.log(`   ⚡ Tempo de consulta: ${queryTime}ms`);

    // Projeção com base nas faturas
    if (subscriptionsWithInvoices > 0 && activeSubscriptions.length > 0) {
      const avgValue = invoiceBasedMRR / subscriptionsWithInvoices;
      const projectedMRR = avgValue * activeSubscriptions.length;
      console.log(
        `   🎯 MRR projetado total: R$ ${projectedMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
    }

    return {
      query: 'Active MRR August 2025',
      activeSubscriptions: activeSubscriptions.length,
      priceBased: totalMRR,
      invoiceBased: invoiceBasedMRR,
      subscriptionsWithInvoices: subscriptionsWithInvoices,
      queryTime: queryTime,
    };
  } catch (err) {
    console.error(`❌ Erro na consulta MRR: ${err.message}`);
    return null;
  }
}

async function runOptimizedQueries() {
  console.log('🚀 CONSULTAS DE NEGÓCIO OTIMIZADAS - SUPABASE');
  console.log('==============================================');
  console.log('🎯 Respostas diretas baseadas nos dados sincronizados');
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

  console.log('');
  console.log('🎯 RESUMO DAS RESPOSTAS:');
  console.log('========================');

  if (pixResult) {
    console.log(
      `💳 PIX em junho/2025: ${pixResult.count} faturas, R$ ${pixResult.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
  }

  if (mrrResult) {
    console.log(
      `📊 MRR ativo (agosto): ~R$ ${(mrrResult.invoiceBased || mrrResult.priceBased).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${mrrResult.activeSubscriptions} assinaturas)`
    );
  }

  return results;
}

// Executar se chamado diretamente
if (require.main === module) {
  runOptimizedQueries()
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

module.exports = { queryPixInvoicesJune2025, queryActiveMRRAugust2025, runOptimizedQueries };
