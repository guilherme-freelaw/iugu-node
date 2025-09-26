#!/usr/bin/env node

/**
 * 📊 CALCULADORA DE KPIs CORRIGIDA - VERSÃO FINAL
 * ============================================
 *
 * Correções aplicadas:
 * 1. Remover filtro de teste muito restritivo
 * 2. Usar created_at_iugu como fallback para paid_at
 * 3. Incluir todos os status válidos
 * 4. Filtrar apenas faturas claramente de teste
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
  // Filtro MUITO mais específico para faturas de teste
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

function countInvoices(invoices, includeAll = false) {
  if (!invoices || !Array.isArray(invoices)) return 0;
  return invoices.filter((inv) => {
    if (isTestInvoice(inv)) return false;
    if (!includeAll && inv.status === null) return false;
    return true;
  }).length;
}

async function calculateFixedKPIs(month) {
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
    // 1. MRR - usar created_at_iugu como fallback
    console.log('💰 1. MRR (Monthly Recurring Revenue)');
    const mrrQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,total_cents,subscription_id,status,customer_id&status=eq.paid&subscription_id=not.is.null&or=(paid_at.gte.${startDate},created_at_iugu.gte.${startDate})&or=(paid_at.lt.${endDate},created_at_iugu.lt.${endDate})`;

    const mrrInvoices = await makeRequest(mrrQuery, { headers: supabaseHeaders });
    const mrr = calcValue(mrrInvoices, 'paid_cents');
    console.log(`   Faturas com assinatura pagas: ${countInvoices(mrrInvoices)}`);
    console.log(`   MRR: R$ ${mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    console.log('');

    // 2. Receita Bruta - TODAS as faturas pagas
    console.log('💵 2. Receita Bruta (incluindo taxas Iugu)');
    const grossQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,total_cents,status,customer_id,commission_cents&status=eq.paid&or=(paid_at.gte.${startDate},created_at_iugu.gte.${startDate})&or=(paid_at.lt.${endDate},created_at_iugu.lt.${endDate})`;

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

    // 3. Devoluções
    console.log('🔄 3. Devoluções (por data de criação)');
    const refundQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,status,customer_id&status=eq.refunded&created_at_iugu=gte.${startDate}&created_at_iugu=lt.${endDate}`;

    const refundInvoices = await makeRequest(refundQuery, { headers: supabaseHeaders });
    const refunds = -calcValue(refundInvoices, 'total_cents');
    console.log(`   Faturas devolvidas: ${countInvoices(refundInvoices)}`);
    console.log(
      `   Devoluções: R$ ${refunds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log('');

    // 4. Métodos de Pagamento
    console.log('💳 4. Métodos de Pagamento');
    const pixQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,total_cents,status,customer_id&status=eq.paid&payment_method=eq.iugu_pix&or=(paid_at.gte.${startDate},created_at_iugu.gte.${startDate})&or=(paid_at.lt.${endDate},created_at_iugu.lt.${endDate})`;
    const cardQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,total_cents,status,customer_id&status=eq.paid&payment_method=eq.iugu_credit_card&or=(paid_at.gte.${startDate},created_at_iugu.gte.${startDate})&or=(paid_at.lt.${endDate},created_at_iugu.lt.${endDate})`;
    const boletoQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,total_cents,status,customer_id&status=eq.paid&payment_method=eq.iugu_bank_slip&or=(paid_at.gte.${startDate},created_at_iugu.gte.${startDate})&or=(paid_at.lt.${endDate},created_at_iugu.lt.${endDate})`;

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
    console.log('');

    // 5. Faturas Geradas
    console.log('📄 5. Faturas Geradas');
    const allQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,customer_id,total_cents&created_at_iugu=gte.${startDate}&created_at_iugu=lt.${endDate}`;

    const allInvoices = await makeRequest(allQuery, { headers: supabaseHeaders });
    const totalGenerated = countInvoices(allInvoices, true);
    const validGenerated = countInvoices(allInvoices, false);

    console.log(`   Faturas Geradas (total): ${totalGenerated}`);
    console.log(`   Faturas Válidas (sem NULL): ${validGenerated}`);
    console.log('');

    // 6. Status breakdown se houver dados
    if (allInvoices && allInvoices.length > 0) {
      const statusCounts = allInvoices
        .filter((inv) => !isTestInvoice(inv))
        .reduce((acc, inv) => {
          const status = inv.status || 'NULL';
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, {});

      console.log('📊 6. Breakdown por Status:');
      Object.entries(statusCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .forEach(([status, count]) => {
          console.log(`   • ${status}: ${count} faturas`);
        });
      console.log('');
    }

    return {
      month: `${year}-${month.padStart(2, '0')}`,
      mrr,
      grossRevenue,
      refunds,
      netRevenue: grossRevenue + refunds - totalCommission,
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

async function runFixedAnalysis() {
  console.log('🚀 ANÁLISE COM CORREÇÕES APLICADAS');
  console.log('==================================');
  console.log('✅ Filtro de teste menos restritivo');
  console.log('✅ created_at_iugu como fallback para paid_at');
  console.log('✅ Incluindo todos os status válidos');
  console.log('');

  const months = ['02', '06', '08'];
  const results = [];

  for (const month of months) {
    const result = await calculateFixedKPIs(month);
    if (result) results.push(result);
    console.log(''.padEnd(50, '='));
    console.log('');
  }

  // Validação simples
  console.log('🎯 RESUMO DOS RESULTADOS');
  console.log('========================');
  results.forEach((result) => {
    if (result) {
      console.log(`📅 ${result.month}:`);
      console.log(`   MRR: R$ ${result.mrr.toLocaleString('pt-BR')}`);
      console.log(`   Receita Bruta: R$ ${result.grossRevenue.toLocaleString('pt-BR')}`);
      console.log(`   PIX: R$ ${result.pix.toLocaleString('pt-BR')}`);
      console.log(`   Faturas: ${result.invoicesGenerated}`);
      console.log('');
    }
  });

  return results;
}

// Executar se chamado diretamente
if (require.main === module) {
  runFixedAnalysis()
    .then(() => {
      console.log('✅ Análise corrigida concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { calculateFixedKPIs, runFixedAnalysis };
