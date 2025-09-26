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

// Dados reais da planilha do usuário
const REAL_DATA = {
  'fev/25': {
    mrr: 694125,
    receita_bruta: 715202,
    devolucoes: -11282,
    receita_liquida: 703920,
    taxas_iugu: 9904,
    pix: 203942,
    cartao_credito: 367638,
    boleto_bancario: 132341,
    faturas_geradas: 707,
  },
  'jun/25': {
    mrr: 726164,
    receita_bruta: 749539,
    devolucoes: -2001,
    receita_liquida: 747538,
    taxas_iugu: 11420,
    pix: 193214,
    cartao_credito: 434384,
    boleto_bancario: 119940,
    faturas_geradas: 512,
  },
  'ago/25': {
    mrr: 791311,
    receita_bruta: 814381,
    devolucoes: -14891,
    receita_liquida: 799490,
    taxas_iugu: 12302,
    pix: 230348,
    cartao_credito: 462657,
    boleto_bancario: 106484,
    faturas_geradas: 584,
  },
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

function formatCurrency(value) {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function calculateDifference(found, expected) {
  const diff = found - expected;
  const percent = (diff / expected) * 100;
  return {
    absolute: diff,
    percent: percent,
    acceptable: Math.abs(percent) <= 0.5,
  };
}

async function validateMonthData(year, month, monthName, expectedData) {
  logWithTimestamp(`🔍 VALIDAÇÃO COMPLETA: ${monthName.toUpperCase()}/${year}`);
  logWithTimestamp('='.repeat(50));

  const monthStr = month.toString().padStart(2, '0');
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStr = nextMonth.toString().padStart(2, '0');

  const results = {
    month: `${monthName}/${year}`,
    validations: {},
  };

  try {
    // 1. MRR - Faturas pagas por data de pagamento + reembolsadas por data de criação
    console.log('📊 Calculando MRR...');
    const mrrPaidInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=total_cents,paid_cents&subscription_id=not.is.null&status=eq.paid&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr}-01`,
      { headers: supabaseHeaders }
    );

    const mrrRefundedInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=total_cents&subscription_id=not.is.null&status=eq.refunded&created_at_iugu=gte.${year}-${monthStr}-01&created_at_iugu=lt.${nextYear}-${nextMonthStr}-01`,
      { headers: supabaseHeaders }
    );

    const mrrPaid =
      mrrPaidInvoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) / 100;
    const mrrRefunded =
      mrrRefundedInvoices.reduce((sum, inv) => sum + (inv.total_cents || 0), 0) / 100;
    const totalMRR = mrrPaid + mrrRefunded;

    results.validations.mrr = {
      found: totalMRR,
      expected: expectedData.mrr,
      difference: calculateDifference(totalMRR, expectedData.mrr),
    };

    // 2. Receita Bruta - Todas as faturas pagas por data de pagamento
    console.log('💰 Calculando Receita Bruta...');
    const allPaidInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=total_cents,paid_cents&status=eq.paid&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr}-01`,
      { headers: supabaseHeaders }
    );

    const receitaBruta =
      allPaidInvoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) / 100;

    results.validations.receita_bruta = {
      found: receitaBruta,
      expected: expectedData.receita_bruta,
      difference: calculateDifference(receitaBruta, expectedData.receita_bruta),
    };

    // 3. Devoluções - Faturas reembolsadas por data de criação
    console.log('🔄 Calculando Devoluções...');
    const allRefundedInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=total_cents&status=eq.refunded&created_at_iugu=gte.${year}-${monthStr}-01&created_at_iugu=lt.${nextYear}-${nextMonthStr}-01`,
      { headers: supabaseHeaders }
    );

    const devolucoes = -(
      allRefundedInvoices.reduce((sum, inv) => sum + (inv.total_cents || 0), 0) / 100
    );

    results.validations.devolucoes = {
      found: devolucoes,
      expected: expectedData.devolucoes,
      difference: calculateDifference(devolucoes, expectedData.devolucoes),
    };

    // 4. Receita Líquida (calculada)
    const receitaLiquida = receitaBruta + devolucoes;

    results.validations.receita_liquida = {
      found: receitaLiquida,
      expected: expectedData.receita_liquida,
      difference: calculateDifference(receitaLiquida, expectedData.receita_liquida),
    };

    // 5. Pagamentos por método - PIX
    console.log('💳 Calculando pagamentos PIX...');
    const pixInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=total_cents,paid_cents&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr}-01`,
      { headers: supabaseHeaders }
    );

    const pixValue =
      pixInvoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) / 100;

    results.validations.pix = {
      found: pixValue,
      expected: expectedData.pix,
      difference: calculateDifference(pixValue, expectedData.pix),
    };

    // 6. Pagamentos por método - Cartão de Crédito
    console.log('💳 Calculando pagamentos Cartão...');
    const creditCardInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=total_cents,paid_cents&status=eq.paid&payment_method=eq.iugu_credit_card&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr}-01`,
      { headers: supabaseHeaders }
    );

    const creditCardValue =
      creditCardInvoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) /
      100;

    results.validations.cartao_credito = {
      found: creditCardValue,
      expected: expectedData.cartao_credito,
      difference: calculateDifference(creditCardValue, expectedData.cartao_credito),
    };

    // 7. Pagamentos por método - Boleto Bancário
    console.log('💳 Calculando pagamentos Boleto...');
    const bankSlipInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=total_cents,paid_cents&status=eq.paid&payment_method=eq.iugu_bank_slip&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr}-01`,
      { headers: supabaseHeaders }
    );

    const bankSlipValue =
      bankSlipInvoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) /
      100;

    results.validations.boleto_bancario = {
      found: bankSlipValue,
      expected: expectedData.boleto_bancario,
      difference: calculateDifference(bankSlipValue, expectedData.boleto_bancario),
    };

    // 8. Faturas Geradas - Por data de criação
    console.log('📄 Contando faturas geradas...');
    const generatedInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&created_at_iugu=gte.${year}-${monthStr}-01&created_at_iugu=lt.${nextYear}-${nextMonthStr}-01`,
      { headers: { ...supabaseHeaders, Prefer: 'count=exact' } }
    );

    const faturasGeradas = generatedInvoices[0]?.count || 0;

    results.validations.faturas_geradas = {
      found: faturasGeradas,
      expected: expectedData.faturas_geradas,
      difference: calculateDifference(faturasGeradas, expectedData.faturas_geradas),
    };

    // Verificar soma dos métodos de pagamento
    const somaPagamentos = pixValue + creditCardValue + bankSlipValue;
    const diferençaSoma = Math.abs(somaPagamentos - receitaBruta);

    console.log('');
    console.log(`📊 RESULTADOS ${monthName.toUpperCase()}/${year}:`);
    console.log('='.repeat(40));

    Object.entries(results.validations).forEach(([key, validation]) => {
      const status = validation.difference.acceptable ? '✅' : '❌';
      const label = key.replace('_', ' ').toUpperCase();
      console.log(`${status} ${label}:`);
      console.log(`   Encontrado: ${formatCurrency(validation.found)}`);
      console.log(`   Esperado: ${formatCurrency(validation.expected)}`);
      console.log(`   Diferença: ${validation.difference.percent.toFixed(3)}%`);
      console.log('');
    });

    console.log('🧮 VERIFICAÇÃO SOMA MÉTODOS PAGAMENTO:');
    console.log(`   PIX + Cartão + Boleto: ${formatCurrency(somaPagamentos)}`);
    console.log(`   Receita Bruta: ${formatCurrency(receitaBruta)}`);
    console.log(
      `   Diferença: ${formatCurrency(diferençaSoma)} (${((diferençaSoma / receitaBruta) * 100).toFixed(3)}%)`
    );

    const allAcceptable = Object.values(results.validations).every((v) => v.difference.acceptable);

    if (allAcceptable) {
      console.log('🎉 VALIDAÇÃO APROVADA: Todos os dados dentro da tolerância!');
    } else {
      console.log('❌ VALIDAÇÃO REPROVADA: Alguns dados fora da tolerância');
    }

    return results;
  } catch (err) {
    console.error(`❌ Erro na validação de ${monthName}: ${err.message}`);
    return null;
  }
}

async function runComprehensiveValidation() {
  console.log('🎯 VALIDAÇÃO ABRANGENTE CONTRA PLANILHA REAL');
  console.log('=============================================');
  console.log('📊 Tolerância: 0.5% para cada métrica');
  console.log('📅 Critério: Data de pagamento para receitas, data de criação para devoluções');
  console.log('');

  const allResults = [];

  // Validar Fevereiro 2025
  const febResults = await validateMonthData(2025, 2, 'fevereiro', REAL_DATA['fev/25']);
  if (febResults) allResults.push(febResults);

  // Validar Junho 2025
  const junResults = await validateMonthData(2025, 6, 'junho', REAL_DATA['jun/25']);
  if (junResults) allResults.push(junResults);

  // Validar Agosto 2025
  const augResults = await validateMonthData(2025, 8, 'agosto', REAL_DATA['ago/25']);
  if (augResults) allResults.push(augResults);

  // Resumo Geral
  console.log('');
  console.log('🎯 RESUMO GERAL DA VALIDAÇÃO:');
  console.log('=============================');

  let totalValidations = 0;
  let passedValidations = 0;

  allResults.forEach((result) => {
    console.log(`\n📅 ${result.month.toUpperCase()}:`);

    Object.entries(result.validations).forEach(([metric, validation]) => {
      totalValidations++;
      const status = validation.difference.acceptable ? '✅' : '❌';
      const label = metric.replace('_', ' ');

      if (validation.difference.acceptable) {
        passedValidations++;
      }

      console.log(`   ${status} ${label}: ${validation.difference.percent.toFixed(3)}%`);
    });
  });

  const successRate = (passedValidations / totalValidations) * 100;

  console.log('');
  console.log(
    `📊 TAXA DE SUCESSO: ${successRate.toFixed(1)}% (${passedValidations}/${totalValidations})`
  );

  if (successRate >= 90) {
    console.log('🎉 SISTEMA VALIDADO: Excelente convergência!');
  } else if (successRate >= 80) {
    console.log('⚠️  SISTEMA PARCIALMENTE VALIDADO: Boa convergência com algumas discrepâncias');
  } else {
    console.log('❌ SISTEMA NÃO VALIDADO: Muitas discrepâncias encontradas');
  }

  return allResults;
}

// Executar se chamado diretamente
if (require.main === module) {
  runComprehensiveValidation()
    .then((results) => {
      console.log('');
      console.log('✅ Validação abrangente concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { runComprehensiveValidation, validateMonthData };
