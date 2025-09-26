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

async function validatePixByPaymentDate() {
  logWithTimestamp('🔍 VALIDAÇÃO PIX JUNHO 2025 - POR DATA DE PAGAMENTO');
  logWithTimestamp('==================================================');
  logWithTimestamp('🎯 Valor esperado: R$ 193.214,00');
  logWithTimestamp('📅 Critério: paid_at entre 01/06/2025 e 30/06/2025');

  try {
    // Buscar TODAS as faturas PIX pagas em junho por DATA DE PAGAMENTO
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

      if (batch.length < limit) break;
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
    console.log('📊 RESULTADOS PIX JUNHO (POR DATA DE PAGAMENTO):');
    console.log(`   💳 Total de faturas PIX: ${allPixInvoices.length.toLocaleString()}`);
    console.log(
      `   💰 Valor no Supabase: R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   🎯 Valor esperado: R$ ${expectedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   📈 Diferença: R$ ${Math.abs(difference).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${percentDiff.toFixed(3)}%)`
    );

    if (Math.abs(percentDiff) <= 0.5) {
      console.log('   ✅ PRECISÃO: EXCELENTE (≤ 0.5% diferença)');
    } else if (Math.abs(percentDiff) <= 2) {
      console.log('   ⚠️  PRECISÃO: BOA (≤ 2% diferença)');
    } else {
      console.log('   ❌ PRECISÃO: INADMISSÍVEL (> 2% diferença)');
    }

    return {
      found: totalValue,
      expected: expectedValue,
      difference: difference,
      percentDiff: percentDiff,
      count: allPixInvoices.length,
      acceptable: Math.abs(percentDiff) <= 0.5,
    };
  } catch (err) {
    console.error(`❌ Erro na validação PIX: ${err.message}`);
    return null;
  }
}

async function calculateMRRByPaymentDate(year, month, monthName) {
  logWithTimestamp('');
  logWithTimestamp(`🔍 CÁLCULO MRR ${monthName.toUpperCase()} ${year} - POR DATA DE PAGAMENTO`);
  logWithTimestamp('='.repeat(50 + monthName.length));
  logWithTimestamp('📅 Critério: paid_at dentro do mês + refunded com data de criação no mês');

  try {
    const monthStr = month.toString().padStart(2, '0');
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonthStr = nextMonth.toString().padStart(2, '0');

    // Buscar faturas PAGAS no mês (por data de pagamento)
    let paidInvoices = [];
    let offset = 0;
    const limit = 1000;

    console.log(`📥 Buscando faturas pagas em ${monthName}/${year} (por data de pagamento)...`);

    while (true) {
      const batch = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,subscription_id,total_cents,paid_cents,status,paid_at&subscription_id=not.is.null&status=eq.paid&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr.padStart(2, '0')}-01&limit=${limit}&offset=${offset}`,
        { headers: supabaseHeaders }
      );

      if (batch.length === 0) break;
      paidInvoices.push(...batch);
      offset += limit;

      if (batch.length < limit) break;
    }

    // Buscar faturas REEMBOLSADAS criadas no mês
    let refundedInvoices = [];
    offset = 0;

    console.log(`📥 Buscando faturas reembolsadas criadas em ${monthName}/${year}...`);

    while (true) {
      const batch = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,subscription_id,total_cents,status,created_at_iugu&subscription_id=not.is.null&status=eq.refunded&created_at_iugu=gte.${year}-${monthStr}-01&created_at_iugu=lt.${nextYear}-${nextMonthStr.padStart(2, '0')}-01&limit=${limit}&offset=${offset}`,
        { headers: supabaseHeaders }
      );

      if (batch.length === 0) break;
      refundedInvoices.push(...batch);
      offset += limit;

      if (batch.length < limit) break;
    }

    // Calcular valores
    const paidValue =
      paidInvoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) / 100;
    const refundedValue =
      refundedInvoices.reduce((sum, inv) => sum + (inv.total_cents || 0), 0) / 100;
    const totalMRR = paidValue + refundedValue;

    // Análise por assinatura única
    const uniqueSubscriptions = new Set([
      ...paidInvoices.map((inv) => inv.subscription_id),
      ...refundedInvoices.map((inv) => inv.subscription_id),
    ]);

    console.log('');
    console.log(`📊 RESULTADOS MRR ${monthName.toUpperCase()} ${year}:`);
    console.log(
      `   ✅ Faturas pagas (por data pagamento): ${paidInvoices.length.toLocaleString()} (R$ ${paidValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
    );
    console.log(
      `   🔄 Faturas reembolsadas (por data criação): ${refundedInvoices.length.toLocaleString()} (R$ ${refundedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
    );
    console.log(
      `   💰 MRR TOTAL: R$ ${totalMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   📋 Assinaturas únicas envolvidas: ${uniqueSubscriptions.size.toLocaleString()}`
    );
    console.log(
      `   📊 Valor médio por assinatura: R$ ${(totalMRR / uniqueSubscriptions.size).toFixed(2)}`
    );

    // Top 10 assinaturas
    const subscriptionTotals = {};
    [...paidInvoices, ...refundedInvoices].forEach((inv) => {
      if (!subscriptionTotals[inv.subscription_id]) {
        subscriptionTotals[inv.subscription_id] = 0;
      }
      subscriptionTotals[inv.subscription_id] += (inv.paid_cents || inv.total_cents || 0) / 100;
    });

    const topSubscriptions = Object.entries(subscriptionTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    console.log('');
    console.log(`🏆 TOP 10 ASSINATURAS ${monthName.toUpperCase()}:`);
    topSubscriptions.forEach(([subId, value], index) => {
      console.log(
        `   ${index + 1}. ${subId}: R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
    });

    return {
      month: `${monthName}/${year}`,
      paid: { count: paidInvoices.length, value: paidValue },
      refunded: { count: refundedInvoices.length, value: refundedValue },
      total: { value: totalMRR, subscriptions: uniqueSubscriptions.size },
      topSubscriptions: topSubscriptions,
    };
  } catch (err) {
    console.error(`❌ Erro no cálculo MRR ${monthName}: ${err.message}`);
    return null;
  }
}

async function runPreciseValidation() {
  console.log('🎯 VALIDAÇÃO PRECISA POR DATA DE PAGAMENTO');
  console.log('==========================================');
  console.log('📊 Tolerância máxima: 0.5%');
  console.log('📅 Critério: Sempre usar paid_at para pagamentos');
  console.log('');

  const results = {};

  // Validar PIX junho por data de pagamento
  const pixResult = await validatePixByPaymentDate();
  if (pixResult) results.pix = pixResult;

  // Calcular MRR agosto (para confirmar)
  const mrrAugust = await calculateMRRByPaymentDate(2025, 8, 'agosto');
  if (mrrAugust) results.august = mrrAugust;

  // Calcular MRR fevereiro 2025
  const mrrFebruary = await calculateMRRByPaymentDate(2025, 2, 'fevereiro');
  if (mrrFebruary) results.february = mrrFebruary;

  // Resumo final
  console.log('');
  console.log('🎯 RESUMO FINAL:');
  console.log('================');

  if (results.pix) {
    const status = results.pix.acceptable ? '✅ APROVADO' : '❌ REPROVADO';
    console.log(`💳 PIX Jun/2025: ${status} (${results.pix.percentDiff.toFixed(3)}%)`);
  }

  if (results.august) {
    console.log(
      `📊 MRR Ago/2025: R$ ${results.august.total.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${results.august.total.subscriptions} assinaturas)`
    );
  }

  if (results.february) {
    console.log(
      `📊 MRR Fev/2025: R$ ${results.february.total.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${results.february.total.subscriptions} assinaturas)`
    );
  }

  const allAcceptable = !results.pix || results.pix.acceptable;

  if (allAcceptable) {
    console.log('');
    console.log('🎉 VALIDAÇÃO APROVADA: Precisão dentro da tolerância!');
  } else {
    console.log('');
    console.log('❌ VALIDAÇÃO REPROVADA: Precisão fora da tolerância');
  }

  return results;
}

// Executar se chamado diretamente
if (require.main === module) {
  runPreciseValidation()
    .then((results) => {
      console.log('');
      console.log('✅ Validação precisa concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { validatePixByPaymentDate, calculateMRRByPaymentDate, runPreciseValidation };
