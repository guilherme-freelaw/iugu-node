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

async function validatePixPaymentsJune() {
  logWithTimestamp('🔍 VALIDAÇÃO: Pagamentos PIX em junho de 2025');
  logWithTimestamp('==============================================');
  logWithTimestamp('🎯 Valor esperado: R$ 193.214,00');

  try {
    // Buscar TODAS as faturas PIX pagas em junho (sem limit)
    let allPixInvoices = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const batch = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,paid_cents,paid_at,payment_method,status&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.2025-06-01&paid_at=lt.2025-07-01&limit=${limit}&offset=${offset}`,
        { headers: supabaseHeaders }
      );

      if (batch.length === 0) break;
      allPixInvoices.push(...batch);
      offset += limit;

      if (batch.length < limit) break; // Última página
    }

    const totalValue =
      allPixInvoices.reduce(
        (sum, invoice) => sum + (invoice.paid_cents || invoice.total_cents || 0),
        0
      ) / 100;
    const expectedValue = 193214;
    const difference = totalValue - expectedValue;
    const percentDiff = (difference / expectedValue) * 100;

    console.log('');
    console.log('📊 RESULTADOS PIX JUNHO:');
    console.log(`   💳 Total de faturas PIX: ${allPixInvoices.length.toLocaleString()}`);
    console.log(
      `   💰 Valor no Supabase: R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   🎯 Valor esperado: R$ ${expectedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   📈 Diferença: R$ ${Math.abs(difference).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${percentDiff.toFixed(2)}%)`
    );

    if (Math.abs(percentDiff) < 5) {
      console.log('   ✅ CONVERGÊNCIA: EXCELENTE (< 5% diferença)');
    } else if (Math.abs(percentDiff) < 10) {
      console.log('   ⚠️  CONVERGÊNCIA: BOA (< 10% diferença)');
    } else {
      console.log('   ❌ CONVERGÊNCIA: PRECISA INVESTIGAÇÃO (> 10% diferença)');
    }

    // Mostrar algumas faturas para debugging
    console.log('');
    console.log('🔍 AMOSTRA DE FATURAS PIX (últimas 10):');
    allPixInvoices.slice(-10).forEach((invoice, index) => {
      const value = (invoice.paid_cents || invoice.total_cents || 0) / 100;
      const date = new Date(invoice.paid_at).toLocaleDateString('pt-BR');
      console.log(
        `   ${allPixInvoices.length - 10 + index + 1}. ${invoice.id} | R$ ${value.toFixed(2)} | ${date}`
      );
    });

    return {
      found: totalValue,
      expected: expectedValue,
      difference: difference,
      percentDiff: percentDiff,
      count: allPixInvoices.length,
    };
  } catch (err) {
    console.error(`❌ Erro na validação PIX: ${err.message}`);
    return null;
  }
}

async function validateMRRAugust() {
  logWithTimestamp('');
  logWithTimestamp('🔍 VALIDAÇÃO: MRR ativo em agosto de 2025');
  logWithTimestamp('==========================================');
  logWithTimestamp('🎯 Valor esperado: R$ 791.311,00');
  logWithTimestamp('📋 Critério: Pagamentos + reembolsos de faturas com assinatura vinculada');

  try {
    // Buscar TODAS as faturas com subscription_id em agosto
    let allSubscriptionInvoices = [];
    let offset = 0;
    const limit = 1000;

    console.log('📥 Buscando todas as faturas com assinatura em agosto...');

    while (true) {
      const batch = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,subscription_id,total_cents,paid_cents,status,created_at_iugu,paid_at&subscription_id=not.is.null&created_at_iugu=gte.2025-08-01&created_at_iugu=lt.2025-09-01&limit=${limit}&offset=${offset}`,
        { headers: supabaseHeaders }
      );

      if (batch.length === 0) break;
      allSubscriptionInvoices.push(...batch);
      offset += limit;

      console.log(`   📄 Carregadas ${allSubscriptionInvoices.length} faturas...`);

      if (batch.length < limit) break; // Última página
    }

    console.log(`✅ Total carregado: ${allSubscriptionInvoices.length} faturas com assinatura`);

    // Separar por status
    const paidInvoices = allSubscriptionInvoices.filter((inv) => inv.status === 'paid');
    const refundedInvoices = allSubscriptionInvoices.filter((inv) => inv.status === 'refunded');
    const allRelevantInvoices = allSubscriptionInvoices.filter(
      (inv) => inv.status === 'paid' || inv.status === 'refunded'
    );

    // Calcular valores
    const paidValue =
      paidInvoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) / 100;
    const refundedValue =
      refundedInvoices.reduce((sum, inv) => sum + (inv.total_cents || 0), 0) / 100;
    const totalMRR = paidValue + refundedValue; // Incluir reembolsos como especificado

    const expectedValue = 791311;
    const difference = totalMRR - expectedValue;
    const percentDiff = (difference / expectedValue) * 100;

    console.log('');
    console.log('📊 RESULTADOS MRR AGOSTO:');
    console.log(
      `   📋 Total faturas com assinatura: ${allSubscriptionInvoices.length.toLocaleString()}`
    );
    console.log(
      `   ✅ Faturas pagas: ${paidInvoices.length.toLocaleString()} (R$ ${paidValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
    );
    console.log(
      `   🔄 Faturas reembolsadas: ${refundedInvoices.length.toLocaleString()} (R$ ${refundedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
    );
    console.log(
      `   💰 MRR no Supabase: R$ ${totalMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   🎯 MRR esperado: R$ ${expectedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   📈 Diferença: R$ ${Math.abs(difference).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${percentDiff.toFixed(2)}%)`
    );

    if (Math.abs(percentDiff) < 5) {
      console.log('   ✅ CONVERGÊNCIA: EXCELENTE (< 5% diferença)');
    } else if (Math.abs(percentDiff) < 10) {
      console.log('   ⚠️  CONVERGÊNCIA: BOA (< 10% diferença)');
    } else {
      console.log('   ❌ CONVERGÊNCIA: PRECISA INVESTIGAÇÃO (> 10% diferença)');
    }

    // Análise por status
    console.log('');
    console.log('📈 DISTRIBUIÇÃO POR STATUS:');
    const statusCounts = {};
    allSubscriptionInvoices.forEach((inv) => {
      statusCounts[inv.status] = (statusCounts[inv.status] || 0) + 1;
    });

    Object.entries(statusCounts).forEach(([status, count]) => {
      const value =
        allSubscriptionInvoices
          .filter((inv) => inv.status === status)
          .reduce((sum, inv) => sum + (inv.total_cents || 0), 0) / 100;
      console.log(
        `   ${status}: ${count} faturas (R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
      );
    });

    // Top assinaturas por valor
    console.log('');
    console.log('🏆 TOP 10 ASSINATURAS POR VALOR:');
    const subscriptionTotals = {};
    allRelevantInvoices.forEach((inv) => {
      if (!subscriptionTotals[inv.subscription_id]) {
        subscriptionTotals[inv.subscription_id] = 0;
      }
      subscriptionTotals[inv.subscription_id] += (inv.paid_cents || inv.total_cents || 0) / 100;
    });

    const topSubscriptions = Object.entries(subscriptionTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    topSubscriptions.forEach(([subId, value], index) => {
      console.log(
        `   ${index + 1}. ${subId}: R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
    });

    return {
      found: totalMRR,
      expected: expectedValue,
      difference: difference,
      percentDiff: percentDiff,
      breakdown: {
        paid: { count: paidInvoices.length, value: paidValue },
        refunded: { count: refundedInvoices.length, value: refundedValue },
        total: { count: allSubscriptionInvoices.length, value: totalMRR },
      },
    };
  } catch (err) {
    console.error(`❌ Erro na validação MRR: ${err.message}`);
    return null;
  }
}

async function runValidation() {
  console.log('🎯 VALIDAÇÃO CONTRA NÚMEROS REAIS');
  console.log('==================================');
  console.log('📊 Comparando dados do Supabase com controle manual');
  console.log('');

  const results = {};

  // Validar PIX junho
  const pixResult = await validatePixPaymentsJune();
  if (pixResult) results.pix = pixResult;

  // Validar MRR agosto
  const mrrResult = await validateMRRAugust();
  if (mrrResult) results.mrr = mrrResult;

  // Resumo final
  console.log('');
  console.log('🎯 RESUMO DA VALIDAÇÃO:');
  console.log('=======================');

  if (results.pix) {
    console.log(
      `💳 PIX Jun/2025: ${results.pix.percentDiff > 0 ? '+' : ''}${results.pix.percentDiff.toFixed(2)}% vs controle`
    );
  }

  if (results.mrr) {
    console.log(
      `📊 MRR Ago/2025: ${results.mrr.percentDiff > 0 ? '+' : ''}${results.mrr.percentDiff.toFixed(2)}% vs controle`
    );
  }

  const allWithinRange = Object.values(results).every((r) => Math.abs(r.percentDiff) < 10);

  if (allWithinRange) {
    console.log('');
    console.log('🎉 SISTEMA VALIDADO: Convergência excelente com dados reais!');
  } else {
    console.log('');
    console.log('⚠️  NECESSITA INVESTIGAÇÃO: Algumas diferenças encontradas');
  }

  return results;
}

// Executar se chamado diretamente
if (require.main === module) {
  runValidation()
    .then((results) => {
      console.log('');
      console.log('✅ Validação concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { validatePixPaymentsJune, validateMRRAugust, runValidation };
