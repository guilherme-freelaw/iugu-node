#!/usr/bin/env node

/**
 * 📊 CALCULADORA FINAL DE KPIs COM TAXAS CORRETAS
 * ==============================================
 *
 * Agora usando o campo correto: taxes_cents (não commission_cents)
 * Lógica de caixa pura + taxas Iugu corretas
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

async function calculateFinalKPIsWithTaxes(month) {
  const year = '2025';
  const startDate = `${year}-${month.padStart(2, '0')}-01`;
  const endDate =
    month === '12'
      ? `${parseInt(year) + 1}-01-01`
      : `${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-01`;

  console.log(`📊 KPIs FINAIS COM TAXAS CORRETAS: ${month}/${year}`);
  console.log('=================================================');
  console.log(`📅 Período: ${startDate} até ${endDate}`);
  console.log('🎯 Critério: paid_at (lógica de caixa)');
  console.log('💰 Campo Taxa: taxes_cents (correto!)');
  console.log('');

  try {
    // 1. MRR
    console.log('💰 1. MRR (Monthly Recurring Revenue)');
    const mrrQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,subscription_id,status,customer_id,taxes_cents&status=eq.paid&subscription_id=not.is.null&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;

    const mrrInvoices = await makeRequest(mrrQuery, { headers: supabaseHeaders });
    const mrr = calcValue(mrrInvoices, 'paid_cents');
    const mrrTaxes = calcValue(mrrInvoices, 'taxes_cents');
    console.log(`   Faturas com assinatura pagas: ${countInvoices(mrrInvoices)}`);
    console.log(`   MRR (bruto): R$ ${mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    console.log(
      `   Taxas MRR: R$ ${mrrTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   MRR (líquido): R$ ${(mrr - mrrTaxes).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 2. Receita Bruta
    console.log('💵 2. Receita Bruta (todas as faturas pagas)');
    const grossQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id,taxes_cents&status=eq.paid&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;

    const grossInvoices = await makeRequest(grossQuery, { headers: supabaseHeaders });
    const grossRevenue = calcValue(grossInvoices, 'paid_cents');
    const totalTaxes = calcValue(grossInvoices, 'taxes_cents');
    console.log(`   Faturas pagas total: ${countInvoices(grossInvoices)}`);
    console.log(
      `   Receita Bruta: R$ ${grossRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Taxas Iugu: R$ ${totalTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Receita Líquida (s/ devoluções): R$ ${(grossRevenue - totalTaxes).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 3. Devoluções
    console.log('🔄 3. Devoluções (por data de execução)');
    const refundQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,status,customer_id,paid_at,taxes_cents&status=eq.refunded&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;

    const refundInvoices = await makeRequest(refundQuery, { headers: supabaseHeaders });
    const refunds = -calcValue(refundInvoices, 'total_cents');
    const refundTaxes = calcValue(refundInvoices, 'taxes_cents');
    console.log(`   Faturas devolvidas: ${countInvoices(refundInvoices)}`);
    console.log(
      `   Devoluções (total): R$ ${refunds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Taxas devolvidas: R$ ${refundTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 4. Receita Líquida Final
    console.log('💎 4. Receita Líquida Final');
    const netRevenue = grossRevenue + refunds - totalTaxes + refundTaxes;
    console.log(
      `   Receita Bruta: R$ ${grossRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   (-) Devoluções: R$ ${refunds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   (-) Taxas Iugu: R$ ${totalTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   (+) Taxas devolvidas: R$ ${refundTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   = Receita Líquida: R$ ${netRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 5. Métodos de Pagamento
    console.log('💳 5. Métodos de Pagamento (com taxas)');
    const pixQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id,taxes_cents&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;
    const cardQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id,taxes_cents&status=eq.paid&payment_method=eq.iugu_credit_card&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;
    const boletoQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,status,customer_id,taxes_cents&status=eq.paid&payment_method=eq.iugu_bank_slip&paid_at=gte.${startDate}&paid_at=lt.${endDate}`;

    const [pixInvoices, cardInvoices, boletoInvoices] = await Promise.all([
      makeRequest(pixQuery, { headers: supabaseHeaders }),
      makeRequest(cardQuery, { headers: supabaseHeaders }),
      makeRequest(boletoQuery, { headers: supabaseHeaders }),
    ]);

    const pixValue = calcValue(pixInvoices, 'paid_cents');
    const pixTaxes = calcValue(pixInvoices, 'taxes_cents');
    const cardValue = calcValue(cardInvoices, 'paid_cents');
    const cardTaxes = calcValue(cardInvoices, 'taxes_cents');
    const boletoValue = calcValue(boletoInvoices, 'paid_cents');
    const boletoTaxes = calcValue(boletoInvoices, 'taxes_cents');

    console.log(
      `   PIX: R$ ${pixValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (taxas: R$ ${pixTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) [${countInvoices(pixInvoices)} faturas]`
    );
    console.log(
      `   Cartão: R$ ${cardValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (taxas: R$ ${cardTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) [${countInvoices(cardInvoices)} faturas]`
    );
    console.log(
      `   Boleto: R$ ${boletoValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (taxas: R$ ${boletoTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) [${countInvoices(boletoInvoices)} faturas]`
    );
    console.log(
      `   Total Métodos: R$ ${(pixValue + cardValue + boletoValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Total Taxas: R$ ${(pixTaxes + cardTaxes + boletoTaxes).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 6. Faturas Geradas
    console.log('📄 6. Faturas Geradas');
    const allQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,customer_id&created_at_iugu=gte.${startDate}&created_at_iugu=lt.${endDate}`;

    const allInvoices = await makeRequest(allQuery, { headers: supabaseHeaders });
    const totalGenerated = countInvoices(allInvoices, true);
    const validGenerated = countInvoices(allInvoices, false);

    console.log(`   Faturas Geradas (total): ${totalGenerated}`);
    console.log(`   Faturas Válidas (sem NULL): ${validGenerated}`);
    console.log('');

    return {
      month: `${year}-${month.padStart(2, '0')}`,
      mrr: mrr - mrrTaxes, // MRR líquido
      mrrGross: mrr,
      mrrTaxes,
      grossRevenue,
      refunds,
      netRevenue,
      iuguTaxes: totalTaxes,
      pix: pixValue,
      pixTaxes,
      creditCard: cardValue,
      cardTaxes,
      bankSlip: boletoValue,
      boletoTaxes,
      invoicesGenerated: totalGenerated,
      invoicesValid: validGenerated,
    };
  } catch (err) {
    console.error(`❌ Erro no cálculo: ${err.message}`);
    return null;
  }
}

async function validateWithTaxes(results) {
  console.log('🎯 VALIDAÇÃO FINAL COM TAXAS CORRETAS');
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

    console.log(`\n📅 ${result.month.toUpperCase()} - COM TAXAS IUGU`);
    console.log('========================================');

    const metrics = [
      ['MRR (bruto)', result.mrrGross, expected.mrr],
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

    // Mostrar info das taxas
    console.log('\n💰 INFORMAÇÕES EXTRAS - TAXAS:');
    console.log(
      `   Taxas Iugu totais: R$ ${result.iuguTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Taxas PIX: R$ ${result.pixTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Taxas Cartão: R$ ${result.cardTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Taxas Boleto: R$ ${result.boletoTaxes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
  });

  const successRate = ((successCount / totalMetrics) * 100).toFixed(1);
  console.log('\n🏆 RESULTADO FINAL COM TAXAS CORRETAS');
  console.log('====================================');
  console.log(`✅ Métricas validadas: ${successCount}/${totalMetrics} (${successRate}%)`);

  if (successRate >= 99.5) {
    console.log('🎉 SISTEMA 100% VALIDADO - PERFEITO!');
  } else if (successRate >= 95) {
    console.log('✅ Sistema altamente preciso com taxas');
  } else {
    console.log('⚠️  Ainda há ajustes necessários');
  }

  return { successRate: parseFloat(successRate), successCount, totalMetrics };
}

async function runFinalAnalysisWithTaxes() {
  console.log('🚀 ANÁLISE FINAL COM TAXAS IUGU CORRETAS');
  console.log('========================================');
  console.log('✅ Campo correto: taxes_cents');
  console.log('✅ Lógica de caixa: paid_at');
  console.log('✅ Receita Bruta: inclui taxas');
  console.log('✅ Receita Líquida: desconta taxas');
  console.log('');

  const months = ['02', '06', '08'];
  const results = [];

  for (const month of months) {
    const result = await calculateFinalKPIsWithTaxes(month);
    if (result) results.push(result);
    console.log(''.padEnd(60, '='));
    console.log('');
  }

  await validateWithTaxes(results);

  return results;
}

// Executar se chamado diretamente
if (require.main === module) {
  runFinalAnalysisWithTaxes()
    .then(() => {
      console.log('');
      console.log('✅ Análise final com taxas corretas concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { calculateFinalKPIsWithTaxes, validateWithTaxes, runFinalAnalysisWithTaxes };
