#!/usr/bin/env node

/**
 * 🔍 INVESTIGAÇÃO DE COMPETÊNCIA DOS MEIOS DE PAGAMENTO
 * ==================================================
 *
 * Hipótese: Cartão (D+30) vs PIX/Boleto (liquidação imediata)
 * pode estar causando divergências temporais na análise.
 *
 * Vamos investigar:
 * 1. Diferenças entre created_at vs paid_at por método
 * 2. Padrões de liquidação temporal
 * 3. Impact nos KPIs por competência
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

function analyzeTimeDifference(invoices) {
  const analysis = [];

  invoices
    .filter((inv) => !isTestInvoice(inv) && inv.created_at_iugu && inv.paid_at)
    .forEach((inv) => {
      const created = new Date(inv.created_at_iugu);
      const paid = new Date(inv.paid_at);
      const diffDays = Math.round((paid - created) / (1000 * 60 * 60 * 24));

      analysis.push({
        id: inv.id,
        method: inv.payment_method,
        diffDays: diffDays,
        created: inv.created_at_iugu.substring(0, 10),
        paid: inv.paid_at.substring(0, 10),
        value: (inv.paid_cents || 0) / 100,
      });
    });

  return analysis;
}

async function investigatePaymentCompetence() {
  console.log('🔍 INVESTIGAÇÃO DE COMPETÊNCIA DOS MEIOS DE PAGAMENTO');
  console.log('===================================================');
  console.log('💡 Hipótese: Cartão (D+30) vs PIX/Boleto (imediato) causando divergências');
  console.log('');

  try {
    // Analisar agosto 2025 (período com melhor dados)
    const augustStart = '2025-08-01';
    const augustEnd = '2025-09-01';

    console.log('📅 ANÁLISE DETALHADA - AGOSTO 2025');
    console.log('==================================');

    // 1. Buscar faturas com datas detalhadas por método
    console.log('1. 🔍 COLETANDO DADOS POR MÉTODO DE PAGAMENTO...');

    const pixInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,created_at_iugu,paid_at,payment_method&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.${augustStart}&paid_at=lt.${augustEnd}&limit=500`,
      { headers: supabaseHeaders }
    );

    const cardInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,created_at_iugu,paid_at,payment_method&status=eq.paid&payment_method=eq.iugu_credit_card&paid_at=gte.${augustStart}&paid_at=lt.${augustEnd}&limit=500`,
      { headers: supabaseHeaders }
    );

    const boletoInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,created_at_iugu,paid_at,payment_method&status=eq.paid&payment_method=eq.iugu_bank_slip&paid_at=gte.${augustStart}&paid_at=lt.${augustEnd}&limit=500`,
      { headers: supabaseHeaders }
    );

    console.log(`📊 PIX: ${pixInvoices ? pixInvoices.length : 0} faturas`);
    console.log(`📊 Cartão: ${cardInvoices ? cardInvoices.length : 0} faturas`);
    console.log(`📊 Boleto: ${boletoInvoices ? boletoInvoices.length : 0} faturas`);
    console.log('');

    // 2. Analisar diferenças temporais
    console.log('2. ⏰ ANÁLISE DE DIFERENÇAS TEMPORAIS');
    console.log('====================================');

    const methods = [
      { name: 'PIX', data: pixInvoices, expected: 230348 },
      { name: 'CARTÃO', data: cardInvoices, expected: 462657 },
      { name: 'BOLETO', data: boletoInvoices, expected: 106484 },
    ];

    methods.forEach((method) => {
      if (!method.data || method.data.length === 0) return;

      console.log(`\n💳 ${method.name.toUpperCase()}:`);
      console.log('========================');

      const timeAnalysis = analyzeTimeDifference(method.data);

      if (timeAnalysis.length > 0) {
        // Estatísticas de tempo
        const timeDiffs = timeAnalysis.map((a) => a.diffDays);
        const avgDiff = timeDiffs.reduce((sum, diff) => sum + diff, 0) / timeDiffs.length;
        const minDiff = Math.min(...timeDiffs);
        const maxDiff = Math.max(...timeDiffs);

        console.log(`⏱️ Diferença média created→paid: ${avgDiff.toFixed(1)} dias`);
        console.log(`📈 Range: ${minDiff} a ${maxDiff} dias`);

        // Distribuição por faixas de tempo
        const sameDay = timeAnalysis.filter((a) => a.diffDays === 0).length;
        const within7Days = timeAnalysis.filter((a) => a.diffDays >= 1 && a.diffDays <= 7).length;
        const within30Days = timeAnalysis.filter((a) => a.diffDays >= 8 && a.diffDays <= 30).length;
        const over30Days = timeAnalysis.filter((a) => a.diffDays > 30).length;

        console.log(`📊 Distribuição temporal:`);
        console.log(
          `   • Mesmo dia: ${sameDay} (${((sameDay / timeAnalysis.length) * 100).toFixed(1)}%)`
        );
        console.log(
          `   • 1-7 dias: ${within7Days} (${((within7Days / timeAnalysis.length) * 100).toFixed(1)}%)`
        );
        console.log(
          `   • 8-30 dias: ${within30Days} (${((within30Days / timeAnalysis.length) * 100).toFixed(1)}%)`
        );
        console.log(
          `   • +30 dias: ${over30Days} (${((over30Days / timeAnalysis.length) * 100).toFixed(1)}%)`
        );

        // Valor por competência
        const currentValue = calcValue(method.data, 'paid_cents');
        const deviation = ((currentValue - method.expected) / method.expected) * 100;

        console.log(
          `💰 Valor atual (paid_at): R$ ${currentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        );
        console.log(
          `💰 Valor esperado: R$ ${method.expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        );
        console.log(`📈 Desvio: ${deviation.toFixed(2)}%`);

        // Mostrar amostra de casos extremos
        if (method.name === 'CARTÃO') {
          console.log('\n🔍 AMOSTRA CARTÃO (casos com mais dias):');
          const longTermCard = timeAnalysis
            .filter((a) => a.diffDays >= 7)
            .sort((a, b) => b.diffDays - a.diffDays)
            .slice(0, 5);

          longTermCard.forEach((item, i) => {
            console.log(
              `   ${i + 1}. ${item.diffDays} dias: criada ${item.created}, paga ${item.paid} - R$ ${item.value.toFixed(2)}`
            );
          });
        }
      }
    });

    // 3. TESTE DA HIPÓTESE: Usar created_at para análise de competência
    console.log('\n\n3. 🧪 TESTE DA HIPÓTESE - COMPETÊNCIA POR CRIAÇÃO');
    console.log('=================================================');
    console.log('🎯 Testando se usar created_at_iugu melhora a precisão...');

    // Recalcular com competência por criação (não pagamento)
    const pixByCreation = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents&status=eq.paid&payment_method=eq.iugu_pix&created_at_iugu=gte.${augustStart}&created_at_iugu=lt.${augustEnd}`,
      { headers: supabaseHeaders }
    );

    const cardByCreation = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents&status=eq.paid&payment_method=eq.iugu_credit_card&created_at_iugu=gte.${augustStart}&created_at_iugu=lt.${augustEnd}`,
      { headers: supabaseHeaders }
    );

    const boletoByCreation = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents&status=eq.paid&payment_method=eq.iugu_bank_slip&created_at_iugu=gte.${augustStart}&created_at_iugu=lt.${augustEnd}`,
      { headers: supabaseHeaders }
    );

    console.log('\n📊 COMPARAÇÃO: COMPETÊNCIA POR CRIAÇÃO vs PAGAMENTO');
    console.log('===================================================');

    const creationMethods = [
      { name: 'PIX', byPayment: pixInvoices, byCreation: pixByCreation, expected: 230348 },
      { name: 'CARTÃO', byPayment: cardInvoices, byCreation: cardByCreation, expected: 462657 },
      { name: 'BOLETO', byPayment: boletoInvoices, byCreation: boletoByCreation, expected: 106484 },
    ];

    creationMethods.forEach((method) => {
      const paymentValue = calcValue(method.byPayment, 'paid_cents');
      const creationValue = calcValue(method.byCreation, 'paid_cents');

      const paymentDeviation = ((paymentValue - method.expected) / method.expected) * 100;
      const creationDeviation = ((creationValue - method.expected) / method.expected) * 100;

      console.log(`\n💳 ${method.name}:`);
      console.log(
        `   Por PAGAMENTO: R$ ${paymentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${paymentDeviation.toFixed(2)}%)`
      );
      console.log(
        `   Por CRIAÇÃO: R$ ${creationValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${creationDeviation.toFixed(2)}%)`
      );
      console.log(
        `   Esperado: R$ ${method.expected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );

      const improvement = Math.abs(creationDeviation) < Math.abs(paymentDeviation);
      console.log(`   📈 Melhoria com criação: ${improvement ? '✅ SIM' : '❌ NÃO'}`);
    });

    // 4. ANÁLISE DE CRUZAMENTO DE MESES
    console.log('\n\n4. 📅 ANÁLISE DE CRUZAMENTO ENTRE MESES');
    console.log('======================================');
    console.log('🔍 Verificando faturas criadas em julho mas pagas em agosto...');

    const crossMonthJulyAug = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,payment_method,created_at_iugu,paid_at&status=eq.paid&created_at_iugu=gte.2025-07-01&created_at_iugu=lt.2025-08-01&paid_at=gte.${augustStart}&paid_at=lt.${augustEnd}&limit=200`,
      { headers: supabaseHeaders }
    );

    const crossMonthAugSep = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,payment_method,created_at_iugu,paid_at&status=eq.paid&created_at_iugu=gte.${augustStart}&created_at_iugu=lt.${augustEnd}&paid_at=gte.2025-09-01&paid_at=lt.2025-10-01&limit=200`,
      { headers: supabaseHeaders }
    );

    if (crossMonthJulyAug && crossMonthJulyAug.length > 0) {
      console.log(`📊 Faturas Jul→Ago: ${crossMonthJulyAug.length}`);
      const crossValue = calcValue(crossMonthJulyAug, 'paid_cents');
      console.log(
        `💰 Valor cruzando para agosto: R$ ${crossValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );

      // Breakdown por método
      const pixCross = crossMonthJulyAug.filter((inv) => inv.payment_method === 'iugu_pix');
      const cardCross = crossMonthJulyAug.filter(
        (inv) => inv.payment_method === 'iugu_credit_card'
      );
      const boletoCross = crossMonthJulyAug.filter(
        (inv) => inv.payment_method === 'iugu_bank_slip'
      );

      console.log(
        `   PIX: ${pixCross.length} faturas, R$ ${calcValue(pixCross, 'paid_cents').toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
      console.log(
        `   Cartão: ${cardCross.length} faturas, R$ ${calcValue(cardCross, 'paid_cents').toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
      console.log(
        `   Boleto: ${boletoCross.length} faturas, R$ ${calcValue(boletoCross, 'paid_cents').toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
    }

    if (crossMonthAugSep && crossMonthAugSep.length > 0) {
      console.log(`📊 Faturas Ago→Set: ${crossMonthAugSep.length}`);
      const crossValue = calcValue(crossMonthAugSep, 'paid_cents');
      console.log(
        `💰 Valor saindo de agosto: R$ ${crossValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
    }
  } catch (err) {
    console.error(`❌ Erro na investigação: ${err.message}`);
  }

  console.log('\n\n🎯 CONCLUSÕES E RECOMENDAÇÕES');
  console.log('=============================');
  console.log('1. Verificar se cartão realmente tem D+30 vs PIX/boleto imediato');
  console.log('2. Testar competência por criação vs pagamento');
  console.log('3. Analisar cruzamento entre meses');
  console.log('4. Definir critério de competência mais adequado');
  console.log('5. Recalcular KPIs com critério correto');
}

// Executar se chamado diretamente
if (require.main === module) {
  investigatePaymentCompetence()
    .then(() => {
      console.log('\n✅ Investigação de competência concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { investigatePaymentCompetence };
