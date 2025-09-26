#!/usr/bin/env node

/**
 * 📊 ANÁLISE DE REEMBOLSOS E RESUMO ANUAL
 * ====================================
 *
 * 1. Como reembolsos estão sendo considerados
 * 2. Cálculo de desvio anual total
 * 3. Análise detalhada de reembolsos
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
    invoice.id === 'test_inv' ||
    /^test_/i.test(invoice.id || '') ||
    /teste/i.test(invoice.id || '') ||
    (invoice.total_cents === 1000 && invoice.id === 'test_inv')
  );
}

function calcValue(invoices, field = 'paid_cents') {
  if (!invoices || !Array.isArray(invoices)) return 0;
  return (
    invoices
      .filter((inv) => !isTestInvoice(inv) && inv.status !== null)
      .reduce((sum, inv) => sum + (inv[field] || inv.total_cents || 0), 0) / 100
  );
}

async function analyzeRefunds() {
  console.log('🔄 ANÁLISE DETALHADA DE REEMBOLSOS');
  console.log('==================================');
  console.log('');

  console.log('📋 COMO REEMBOLSOS ESTÃO SENDO CALCULADOS ATUALMENTE:');
  console.log('• Campo usado: total_cents (valor total da fatura reembolsada)');
  console.log('• Critério temporal: created_at_iugu (data de criação do reembolso)');
  console.log('• Filtros: status = "refunded"');
  console.log('• Valor: NEGATIVO (multiplicado por -1)');
  console.log('• Exclusões: faturas de teste');
  console.log('');

  const months = [
    { code: '02', name: 'FEVEREIRO', expected: -11282 },
    { code: '06', name: 'JUNHO', expected: -2001 },
    { code: '08', name: 'AGOSTO', expected: -14891 },
  ];

  let totalSystemRefunds = 0;
  let totalExpectedRefunds = 0;

  for (const month of months) {
    const startDate = `2025-${month.code}-01`;
    const endDate =
      month.code === '12'
        ? '2026-01-01'
        : `2025-${(parseInt(month.code) + 1).toString().padStart(2, '0')}-01`;

    console.log(`🔍 ${month.name} 2025:`);
    console.log('====================');

    try {
      // Reembolsos por data de criação (critério atual)
      const refundsByCreation = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,paid_cents,status,customer_id,created_at_iugu&status=eq.refunded&created_at_iugu=gte.${startDate}&created_at_iugu=lt.${endDate}`,
        { headers: supabaseHeaders }
      );

      // Reembolsos por data de pagamento (critério alternativo)
      const refundsByPayment = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,paid_cents,status,customer_id,paid_at&status=eq.refunded&paid_at=gte.${startDate}&paid_at=lt.${endDate}`,
        { headers: supabaseHeaders }
      );

      const refundsCreationValue = -calcValue(refundsByCreation, 'total_cents');
      const refundsPaymentValue = -calcValue(refundsByPayment, 'total_cents');

      console.log(
        `   Reembolsos (por criação): R$ ${refundsCreationValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${refundsByCreation ? refundsByCreation.length : 0} faturas)`
      );
      console.log(
        `   Reembolsos (por pagamento): R$ ${refundsPaymentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${refundsByPayment ? refundsByPayment.length : 0} faturas)`
      );
      console.log(
        `   Esperado: R$ ${month.expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );

      const diffCreation =
        ((refundsCreationValue - month.expected) / Math.abs(month.expected)) * 100;
      const diffPayment = ((refundsPaymentValue - month.expected) / Math.abs(month.expected)) * 100;

      console.log(`   Diferença (criação): ${diffCreation.toFixed(1)}%`);
      console.log(`   Diferença (pagamento): ${diffPayment.toFixed(1)}%`);

      // Detalhar algumas faturas se houver
      if (refundsByCreation && refundsByCreation.length > 0) {
        console.log('   📄 Amostra de reembolsos:');
        refundsByCreation.slice(0, 3).forEach((ref, i) => {
          console.log(
            `     ${i + 1}. ${ref.id}: R$ ${((ref.total_cents || 0) / 100).toFixed(2)} (${ref.created_at_iugu})`
          );
        });
      }

      totalSystemRefunds += refundsCreationValue;
      totalExpectedRefunds += month.expected;

      console.log('');
    } catch (err) {
      console.error(`❌ Erro em ${month.name}: ${err.message}`);
    }
  }

  console.log('🔄 RESUMO TOTAL DE REEMBOLSOS:');
  console.log('==============================');
  console.log(
    `Sistema (3 meses): R$ ${totalSystemRefunds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  );
  console.log(
    `Esperado (3 meses): R$ ${totalExpectedRefunds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  );

  const refundDiff =
    ((totalSystemRefunds - totalExpectedRefunds) / Math.abs(totalExpectedRefunds)) * 100;
  console.log(`Diferença total: ${refundDiff.toFixed(1)}%`);
  console.log('');

  return {
    totalSystemRefunds,
    totalExpectedRefunds,
    refundDiff,
  };
}

async function calculateAnnualDeviation() {
  console.log('📊 CÁLCULO DE DESVIO ANUAL TOTAL');
  console.log('================================');
  console.log('');

  // Dados do sistema (já calculados anteriormente)
  const systemData = {
    '2025-02': {
      mrr: 700912.88,
      grossRevenue: 721658.83,
      pix: 215745.34,
      creditCard: 360609.67,
      bankSlip: 145303.82,
      invoicesGenerated: 679,
    },
    '2025-06': {
      mrr: 719163.73,
      grossRevenue: 741923.64,
      pix: 191798.74,
      creditCard: 412821.95,
      bankSlip: 137302.95,
      invoicesGenerated: 693,
    },
    '2025-08': {
      mrr: 826606.68,
      grossRevenue: 849262.72,
      pix: 250466.04,
      creditCard: 476101.3,
      bankSlip: 122695.38,
      invoicesGenerated: 945,
    },
  };

  // Dados esperados (fornecidos pelo usuário)
  const expectedData = {
    '2025-02': {
      mrr: 694125,
      grossRevenue: 715202,
      pix: 203942,
      creditCard: 367638,
      bankSlip: 132341,
      invoicesGenerated: 707,
    },
    '2025-06': {
      mrr: 726164,
      grossRevenue: 749539,
      pix: 193214,
      creditCard: 434384,
      bankSlip: 119940,
      invoicesGenerated: 512,
    },
    '2025-08': {
      mrr: 791311,
      grossRevenue: 814381,
      pix: 230348,
      creditCard: 462657,
      bankSlip: 106484,
      invoicesGenerated: 584,
    },
  };

  const metrics = ['mrr', 'grossRevenue', 'pix', 'creditCard', 'bankSlip', 'invoicesGenerated'];
  const periods = ['2025-02', '2025-06', '2025-08'];

  let totalSystemValue = 0;
  let totalExpectedValue = 0;
  let metricResults = {};

  metrics.forEach((metric) => {
    let systemSum = 0;
    let expectedSum = 0;

    periods.forEach((period) => {
      systemSum += systemData[period][metric];
      expectedSum += expectedData[period][metric];
    });

    const deviation = ((systemSum - expectedSum) / expectedSum) * 100;

    metricResults[metric] = {
      system: systemSum,
      expected: expectedSum,
      deviation: deviation,
    };

    console.log(`📊 ${metric.toUpperCase()}:`);
    console.log(
      `   Sistema (3 meses): R$ ${systemSum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `   Esperado (3 meses): R$ ${expectedSum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(`   Desvio: ${deviation.toFixed(2)}%`);
    console.log('');

    // Para receitas, somar ao total geral
    if (['mrr', 'grossRevenue'].includes(metric)) {
      totalSystemValue += systemSum;
      totalExpectedValue += expectedSum;
    }
  });

  const overallDeviation = ((totalSystemValue - totalExpectedValue) / totalExpectedValue) * 100;

  console.log('🏆 DESVIO GERAL (MRR + RECEITA BRUTA):');
  console.log('=====================================');
  console.log(
    `Sistema total: R$ ${totalSystemValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  );
  console.log(
    `Esperado total: R$ ${totalExpectedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  );
  console.log(`DESVIO ANUAL: ${overallDeviation.toFixed(2)}%`);
  console.log('');

  // Classificação do desvio
  if (Math.abs(overallDeviation) <= 2) {
    console.log('✅ EXCELENTE: Desvio ≤ 2%');
  } else if (Math.abs(overallDeviation) <= 5) {
    console.log('✅ BOM: Desvio ≤ 5%');
  } else if (Math.abs(overallDeviation) <= 10) {
    console.log('⚠️ ACEITÁVEL: Desvio ≤ 10%');
  } else {
    console.log('❌ REQUER CORREÇÃO: Desvio > 10%');
  }

  return {
    metricResults,
    overallDeviation,
    totalSystemValue,
    totalExpectedValue,
  };
}

async function runCompleteAnalysis() {
  console.log('🚀 ANÁLISE COMPLETA: REEMBOLSOS + DESVIO ANUAL');
  console.log('==============================================');
  console.log('');

  const refundAnalysis = await analyzeRefunds();
  const annualAnalysis = await calculateAnnualDeviation();

  console.log('📋 CONCLUSÕES FINAIS:');
  console.log('====================');
  console.log(`• Reembolsos: ${refundAnalysis.refundDiff.toFixed(1)}% de desvio`);
  console.log(`• Receitas anuais: ${annualAnalysis.overallDeviation.toFixed(2)}% de desvio`);
  console.log('');

  if (Math.abs(annualAnalysis.overallDeviation) <= 5) {
    console.log('🎉 SISTEMA VALIDADO: Desvio anual aceitável!');
  } else {
    console.log('🔧 AJUSTES NECESSÁRIOS: Desvio anual acima do ideal');
  }

  return {
    refundAnalysis,
    annualAnalysis,
  };
}

// Executar se chamado diretamente
if (require.main === module) {
  runCompleteAnalysis()
    .then(() => {
      console.log('✅ Análise completa concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { analyzeRefunds, calculateAnnualDeviation, runCompleteAnalysis };
