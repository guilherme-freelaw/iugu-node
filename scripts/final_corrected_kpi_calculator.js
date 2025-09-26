#!/usr/bin/env node

/**
 * 📊 CALCULADORA DE KPIs FINAL CORRIGIDA
 * ====================================
 *
 * Ajustes finais baseados nas regras do usuário:
 * - TUDO por lógica de caixa (paid_at sempre, sem fallback)
 * - Devoluções por data de execução (não criação)
 * - Receita bruta inclui taxas
 * - MRR exige assinatura
 * - Devoluções usam total_cents
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
  return (
    invoice.id === 'test_inv' || /^test_/i.test(invoice.id || '') || /teste/i.test(invoice.id || '')
  );
}

function calcValue(invoices, field = 'paid_cents') {
  if (!invoices || !Array.isArray(invoices)) return 0;
  return (
    invoices
      .filter((inv) => !isTestInvoice(inv) && inv.status !== null)
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

async function calculateFinalKPIs(month) {
  const year = '2025';
  const startDate = `${year}-${month.padStart(2, '0')}-01`;
  const endDate =
    month === '12'
      ? `${parseInt(year) + 1}-01-01`
      : `${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-01`;

  console.log(`📊 CALCULANDO KPIs FINAIS - LÓGICA DE CAIXA: ${month}/${year}`);
  console.log('========================================================');
  console.log(`📅 Período: ${startDate} até ${endDate}`);
  console.log('🎯 Critério: SEMPRE paid_at (lógica de caixa)');
  console.log('');

  try {
    // 1. MRR - SEMPRE paid_at, exige subscription_id
    console.log('💰 1. MRR (Monthly Recurring Revenue)');
    console.log('• Critério: paid_at (lógica de caixa)');
    console.log('• Exige: subscription_id IS NOT NULL');
    const mrrQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,subscription_id,status,customer_id&status=eq.paid&subscription_id=not.is.null&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;

    const mrrInvoices = await makeRequest(mrrQuery, { headers: supabaseHeaders });
    const mrr = calcValue(mrrInvoices, 'paid_cents');
    console.log(`   Faturas com assinatura pagas: ${countInvoices(mrrInvoices)}`);
    console.log(`   MRR: R$ ${mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    console.log('');

    // 2. Receita Bruta - SEMPRE paid_at, TODAS as faturas pagas
    console.log('💵 2. Receita Bruta (incluindo taxas Iugu)');
    console.log('• Critério: paid_at (lógica de caixa)');
    console.log('• Inclui: TODAS as faturas pagas');
    const grossQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id,commission_cents&status=eq.paid&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;

    const grossInvoices = await makeRequest(grossQuery, { headers: supabaseHeaders });
    const grossRevenue = calcValue(grossInvoices, 'paid_cents');
    const totalCommission = calcValue(grossInvoices, 'commission_cents');
    console.log(`   Faturas pagas total: ${countInvoices(grossInvoices)}`);
    console.log(
      `   Receita Bruta: R$ ${grossRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Taxas Iugu (comissões): R$ ${totalCommission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 3. Devoluções - AGORA por paid_at (data de execução da devolução)
    console.log('🔄 3. Devoluções (por data de EXECUÇÃO)');
    console.log('• Critério: paid_at (data de execução da devolução)');
    console.log('• Campo: total_cents');
    const refundQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,status,customer_id,paid_at&status=eq.refunded&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;

    const refundInvoices = await makeRequest(refundQuery, { headers: supabaseHeaders });
    const refunds = -calcValue(refundInvoices, 'total_cents');
    console.log(`   Faturas devolvidas: ${countInvoices(refundInvoices)}`);
    console.log(
      `   Devoluções: R$ ${refunds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );

    // Mostrar amostra se houver devoluções
    if (refundInvoices && refundInvoices.length > 0) {
      console.log('   📄 Amostra de devoluções (por paid_at):');
      refundInvoices.slice(0, 3).forEach((ref, i) => {
        console.log(
          `     ${i + 1}. ${ref.id}: R$ ${((ref.total_cents || 0) / 100).toFixed(2)} (executada em ${ref.paid_at})`
        );
      });
    }
    console.log('');

    // 4. Receita Líquida
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

    // 5. Métodos de Pagamento - SEMPRE paid_at
    console.log('💳 5. Métodos de Pagamento');
    console.log('• Critério: paid_at (lógica de caixa)');
    const pixQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;
    const cardQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id&status=eq.paid&payment_method=eq.iugu_credit_card&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;
    const boletoQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id&status=eq.paid&payment_method=eq.iugu_bank_slip&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;

    const [pixInvoices, cardInvoices, boletoInvoices] = await Promise.all([
      makeRequest(pixQuery, { headers: supabaseHeaders }),
      makeRequest(cardQuery, { headers: supabaseHeaders }),
      makeRequest(boletoQuery, { headers: supabaseHeaders }),
    ]);

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

    // 6. Faturas Geradas - mantém created_at_iugu (única exceção)
    console.log('📄 6. Faturas Geradas (por data de criação)');
    console.log('• Critério: created_at_iugu (única exceção à lógica de caixa)');
    const allQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,customer_id&created_at_iugu=gte.${startDate}&created_at_iugu=lt.${endDate}`;

    const allInvoices = await makeRequest(allQuery, { headers: supabaseHeaders });
    const totalGenerated = countInvoices(allInvoices, true);
    const validGenerated = countInvoices(allInvoices, false);

    console.log(`   Faturas Geradas (total): ${totalGenerated}`);
    console.log(`   Faturas Válidas (sem NULL): ${validGenerated}`);
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
      invoicesGenerated: totalGenerated,
      invoicesValid: validGenerated,
    };
  } catch (err) {
    console.error(`❌ Erro no cálculo: ${err.message}`);
    return null;
  }
}

async function validateFinalResults(results) {
  console.log('🎯 VALIDAÇÃO FINAL CONTRA DADOS REAIS');
  console.log('====================================');

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

    console.log(`\n📅 ${result.month.toUpperCase()} - LÓGICA DE CAIXA`);
    console.log('=======================================');

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
      console.log(`   Sistema: R$ ${found.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      console.log(
        `   Esperado: R$ ${expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
      console.log(`   Diferença: ${percentage}%`);
    });
  });

  const successRate = ((successCount / totalMetrics) * 100).toFixed(1);
  console.log('\n🏆 RESULTADO FINAL COM LÓGICA DE CAIXA');
  console.log('======================================');
  console.log(`✅ Métricas validadas: ${successCount}/${totalMetrics} (${successRate}%)`);

  if (successRate >= 99.5) {
    console.log('🎉 SISTEMA 100% VALIDADO - LÓGICA DE CAIXA PERFEITA!');
  } else if (successRate >= 95) {
    console.log('✅ Sistema altamente preciso com lógica de caixa');
  } else {
    console.log('⚠️  Ajustes adicionais necessários');
  }

  return { successRate: parseFloat(successRate), successCount, totalMetrics };
}

async function runFinalAnalysis() {
  console.log('🚀 ANÁLISE FINAL - LÓGICA DE CAIXA PURA');
  console.log('=======================================');
  console.log('✅ MRR: paid_at + subscription_id obrigatório');
  console.log('✅ Receita Bruta: paid_at + inclui taxas');
  console.log('✅ Devoluções: paid_at (execução) + total_cents');
  console.log('✅ Métodos Pagamento: paid_at sempre');
  console.log('✅ Faturas Geradas: created_at_iugu (única exceção)');
  console.log('');

  const months = ['02', '06', '08'];
  const results = [];

  for (const month of months) {
    const result = await calculateFinalKPIs(month);
    if (result) results.push(result);
    console.log(''.padEnd(60, '='));
    console.log('');
  }

  await validateFinalResults(results);

  return results;
}

// Executar se chamado diretamente
if (require.main === module) {
  runFinalAnalysis()
    .then(() => {
      console.log('');
      console.log('✅ Análise final com lógica de caixa concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { calculateFinalKPIs, validateFinalResults, runFinalAnalysis };
