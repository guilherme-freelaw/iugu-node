#!/usr/bin/env node

/**
 * 📊 CALCULADORA DE KPIs CORRIGIDA
 * ==============================
 *
 * Implementação das regras de negócio corretas definidas pelo usuário:
 * a. MRR: paid_cents
 * b. Receita bruta: incluir taxas Iugu + segregar taxas para análise de custo
 * c. Devoluções: data de criação da devolução
 * d. Só PIX/Cartão/Boleto
 * e. Faturas geradas: todas + possibilidade de segregar
 * f. Excluir faturas de teste
 * g. Excluir status NULL das contagens
 */

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

function isTestInvoice(invoice) {
  // Identificar faturas de teste
  const testPatterns = [
    /^test/i,
    /test$/i,
    /teste/i,
    /^[0-9A-F]{32}$/, // IDs de teste gerados automaticamente
  ];

  return testPatterns.some(
    (pattern) =>
      pattern.test(invoice.id || '') ||
      pattern.test(invoice.customer_id || '') ||
      (invoice.total_cents === 1000 && !invoice.subscription_id) // R$ 10 sem assinatura
  );
}

function calcValue(invoices, field = 'paid_cents') {
  if (!invoices || !Array.isArray(invoices)) return 0;
  return (
    invoices
      .filter((inv) => !isTestInvoice(inv) && inv.status !== null) // Excluir teste e NULL
      .reduce((sum, inv) => sum + (inv[field] || 0), 0) / 100
  );
}

function countInvoices(invoices, includeAll = false) {
  if (!invoices || !Array.isArray(invoices)) return 0;
  return invoices.filter((inv) => {
    if (isTestInvoice(inv)) return false;
    if (!includeAll && inv.status === null) return false;
    return true;
  }).length;
}

async function calculateCorrectedKPIs(month) {
  const year = '2025';
  const startDate = `${year}-${month.padStart(2, '0')}-01`;
  const endDate =
    month === '12'
      ? `${parseInt(year) + 1}-01-01`
      : `${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-01`;

  console.log(`📊 CALCULANDO KPIs CORRIGIDOS: ${month}/${year}`);
  console.log('===============================================');
  console.log(`📅 Período: ${startDate} até ${endDate}`);
  console.log('');

  try {
    // 1. MRR - paid_cents de faturas pagas com subscription_id, por paid_at
    console.log('💰 1. MRR (Monthly Recurring Revenue)');
    const mrrInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,subscription_id,status,customer_id,total_cents&status=eq.paid&subscription_id=not.is.null&paid_at=gte.${startDate}&paid_at=lt.${endDate}`,
      { headers: supabaseHeaders }
    );
    const mrr = calcValue(mrrInvoices, 'paid_cents');
    console.log(`   Faturas com assinatura pagas: ${countInvoices(mrrInvoices)}`);
    console.log(`   MRR: R$ ${mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    console.log('');

    // 2. Receita Bruta - TODAS as faturas pagas, incluindo taxas
    console.log('💵 2. Receita Bruta (incluindo taxas Iugu)');
    const grossInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,total_cents,status,customer_id,commission_cents&status=eq.paid&paid_at=gte.${startDate}&paid_at=lt.${endDate}`,
      { headers: supabaseHeaders }
    );
    const grossRevenue = calcValue(grossInvoices, 'paid_cents');
    const totalCommission = calcValue(grossInvoices, 'commission_cents');
    console.log(`   Faturas pagas total: ${countInvoices(grossInvoices)}`);
    console.log(
      `   Receita Bruta: R$ ${grossRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Taxas Iugu (comissões): R$ ${totalCommission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Receita Líquida (sem taxas): R$ ${(grossRevenue - totalCommission).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 3. Devoluções - por data de criação da devolução
    console.log('🔄 3. Devoluções (por data de criação)');
    const refundInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,status,customer_id&status=eq.refunded&created_at_iugu=gte.${startDate}&created_at_iugu=lt.${endDate}`,
      { headers: supabaseHeaders }
    );
    const refunds = -calcValue(refundInvoices, 'total_cents'); // Negativo
    console.log(`   Faturas devolvidas: ${countInvoices(refundInvoices)}`);
    console.log(
      `   Devoluções: R$ ${refunds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 4. Receita Líquida Final
    console.log('💎 4. Receita Líquida Final');
    const netRevenue = grossRevenue + refunds - totalCommission;
    console.log(
      `   Receita Bruta: R$ ${grossRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   (-) Devoluções: R$ ${refunds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   (-) Taxas Iugu: R$ ${totalCommission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   = Receita Líquida: R$ ${netRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 5. Métodos de Pagamento
    console.log('💳 5. Métodos de Pagamento');
    const pixInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id,total_cents&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.${startDate}&paid_at=lt.${endDate}`,
      { headers: supabaseHeaders }
    );
    const cardInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id,total_cents&status=eq.paid&payment_method=eq.iugu_credit_card&paid_at=gte.${startDate}&paid_at=lt.${endDate}`,
      { headers: supabaseHeaders }
    );
    const boletoInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id,total_cents&status=eq.paid&payment_method=eq.iugu_bank_slip&paid_at=gte.${startDate}&paid_at=lt.${endDate}`,
      { headers: supabaseHeaders }
    );

    const pixValue = calcValue(pixInvoices, 'paid_cents');
    const cardValue = calcValue(cardInvoices, 'paid_cents');
    const boletoValue = calcValue(boletoInvoices, 'paid_cents');

    console.log(
      `   PIX: R$ ${pixValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${countInvoices(pixInvoices)} faturas)`
    );
    console.log(
      `   Cartão de Crédito: R$ ${cardValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${countInvoices(cardInvoices)} faturas)`
    );
    console.log(
      `   Boleto Bancário: R$ ${boletoValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${countInvoices(boletoInvoices)} faturas)`
    );
    console.log(
      `   Total Métodos: R$ ${(pixValue + cardValue + boletoValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 6. Faturas Geradas (segregando por status)
    console.log('📄 6. Faturas Geradas (por data de criação)');
    const allInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,customer_id,total_cents&created_at_iugu=gte.${startDate}&created_at_iugu=lt.${endDate}`,
      { headers: supabaseHeaders }
    );

    if (allInvoices && Array.isArray(allInvoices)) {
      const validInvoices = allInvoices.filter((inv) => !isTestInvoice(inv));
      const statusCounts = validInvoices.reduce((acc, inv) => {
        const status = inv.status || 'NULL';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});

      const validCount = validInvoices.filter((inv) => inv.status !== null).length;
      const totalCount = validInvoices.length;

      console.log(`   Faturas Total (excl. teste): ${totalCount}`);
      console.log(`   Faturas Válidas (excl. NULL): ${validCount}`);
      console.log('   Detalhamento por status:');
      Object.entries(statusCounts)
        .sort(([, a], [, b]) => b - a)
        .forEach(([status, count]) => {
          console.log(`     • ${status}: ${count} faturas`);
        });
    }
    console.log('');

    return {
      month: `${year}-${month.padStart(2, '0')}`,
      mrr,
      grossRevenue,
      refunds,
      netRevenue,
      iuguTaxes: totalCommission,
      pix: pixValue,
      creditCard: cardValue,
      bankSlip: boletoValue,
      invoicesGenerated: allInvoices ? countInvoices(allInvoices, true) : 0,
      invoicesValid: allInvoices ? countInvoices(allInvoices, false) : 0,
    };
  } catch (err) {
    console.error(`❌ Erro no cálculo: ${err.message}`);
    return null;
  }
}

async function validateAgainstRealData(results) {
  console.log('🎯 VALIDAÇÃO CONTRA DADOS REAIS');
  console.log('==============================');

  // Dados reais fornecidos pelo usuário
  const expectedData = {
    '2025-02': {
      mrr: 694125,
      grossRevenue: 715202,
      refunds: -11282,
      netRevenue: 703920,
      pix: 203942,
      creditCard: 367638,
      bankSlip: 132341,
      invoicesGenerated: 707,
    },
    '2025-06': {
      mrr: 726164,
      grossRevenue: 749539,
      refunds: -2001,
      netRevenue: 747538,
      pix: 193214,
      creditCard: 434384,
      bankSlip: 119940,
      invoicesGenerated: 512,
    },
    '2025-08': {
      mrr: 791311,
      grossRevenue: 814381,
      refunds: -14891,
      netRevenue: 799490,
      pix: 230348,
      creditCard: 462657,
      bankSlip: 106484,
      invoicesGenerated: 584,
    },
  };

  const tolerance = 0.005; // 0.5%
  let successCount = 0;
  let totalMetrics = 0;

  results.forEach((result) => {
    if (!result) return;

    const expected = expectedData[result.month];
    if (!expected) return;

    console.log(`\n📅 ${result.month.toUpperCase()}`);
    console.log('========================');

    const metrics = [
      ['MRR', result.mrr, expected.mrr],
      ['Receita Bruta', result.grossRevenue, expected.grossRevenue],
      ['Devoluções', result.refunds, expected.refunds],
      ['Receita Líquida', result.netRevenue, expected.netRevenue],
      ['PIX', result.pix, expected.pix],
      ['Cartão', result.creditCard, expected.creditCard],
      ['Boleto', result.bankSlip, expected.bankSlip],
      ['Faturas Geradas', result.invoicesGenerated, expected.invoicesGenerated],
    ];

    metrics.forEach(([name, found, expected]) => {
      totalMetrics++;
      const diff = Math.abs((found - expected) / expected);
      const isValid = diff <= tolerance;

      if (isValid) successCount++;

      const status = isValid ? '✅' : '❌';
      const percentage = (diff * 100).toFixed(3);

      console.log(`${status} ${name}:`);
      console.log(
        `   Encontrado: R$ ${found.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
      console.log(
        `   Esperado: R$ ${expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
      console.log(`   Diferença: ${percentage}%`);
    });
  });

  const successRate = ((successCount / totalMetrics) * 100).toFixed(1);
  console.log('\n🏆 RESULTADO FINAL');
  console.log('==================');
  console.log(`✅ Métricas validadas: ${successCount}/${totalMetrics} (${successRate}%)`);

  if (successRate >= 99.5) {
    console.log('🎉 SISTEMA 100% VALIDADO!');
  } else if (successRate >= 95) {
    console.log('✅ Sistema altamente preciso');
  } else {
    console.log('⚠️  Requer ajustes adicionais');
  }

  return { successRate: parseFloat(successRate), successCount, totalMetrics };
}

async function runCorrectedAnalysis() {
  console.log('🚀 ANÁLISE COMPLETA COM REGRAS CORRETAS');
  console.log('========================================');
  console.log('');

  const months = ['02', '06', '08'];
  const results = [];

  for (const month of months) {
    const result = await calculateCorrectedKPIs(month);
    if (result) results.push(result);
    console.log(''.padEnd(50, '='));
    console.log('');
  }

  await validateAgainstRealData(results);

  return results;
}

// Executar se chamado diretamente
if (require.main === module) {
  runCorrectedAnalysis()
    .then(() => {
      console.log('');
      console.log('✅ Análise com regras corretas concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { calculateCorrectedKPIs, validateAgainstRealData, runCorrectedAnalysis };
