#!/usr/bin/env node

/**
 * 📊 DOCUMENTAÇÃO COMPLETA DAS REGRAS DE NEGÓCIO DOS KPIs
 * =====================================================
 *
 * Este arquivo documenta EXATAMENTE como cada KPI está sendo calculado
 * no sistema atual para identificar divergências com o controle manual.
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

async function documentKPIRules() {
  console.log('📊 DOCUMENTAÇÃO COMPLETA DOS KPIs');
  console.log('=================================');
  console.log('');

  // 1. MRR (Monthly Recurring Revenue)
  console.log('💰 1. MRR (MONTHLY RECURRING REVENUE)');
  console.log('=====================================');
  console.log('REGRA ATUAL NO SISTEMA:');
  console.log('• Campo usado: paid_cents (valor efetivamente pago)');
  console.log('• Critério temporal: paid_at (data do pagamento)');
  console.log('• Filtros: status = "paid"');
  console.log('• Filtros: subscription_id IS NOT NULL (só faturas com assinatura)');
  console.log('• Exclusões: devoluções (status = "refunded")');
  console.log('• Período: mês específico baseado em paid_at');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT SUM(paid_cents)/100 as mrr
FROM iugu_invoices 
WHERE status = 'paid' 
  AND subscription_id IS NOT NULL
  AND paid_at >= '2025-08-01' 
  AND paid_at < '2025-09-01'`);
  console.log('');
  console.log('❓ POSSÍVEIS DIVERGÊNCIAS:');
  console.log('• Usa paid_cents vs total_cents?');
  console.log('• Inclui devoluções ou não?');
  console.log('• Considera subscription_id ou todos os pagamentos recorrentes?');
  console.log('• Data de pagamento vs data de vencimento vs data de criação?');
  console.log('');

  // 2. Receita Bruta
  console.log('💵 2. RECEITA BRUTA');
  console.log('==================');
  console.log('REGRA ATUAL NO SISTEMA:');
  console.log('• Campo usado: paid_cents (valor efetivamente pago)');
  console.log('• Critério temporal: paid_at (data do pagamento)');
  console.log('• Filtros: status = "paid"');
  console.log('• Inclui: TODAS as faturas pagas (com ou sem assinatura)');
  console.log('• Exclusões: devoluções são calculadas separadamente');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT SUM(paid_cents)/100 as receita_bruta
FROM iugu_invoices 
WHERE status = 'paid' 
  AND paid_at >= '2025-08-01' 
  AND paid_at < '2025-09-01'`);
  console.log('');
  console.log('❓ POSSÍVEIS DIVERGÊNCIAS:');
  console.log('• Valor bruto vs líquido (antes/depois de taxas)?');
  console.log('• Inclui taxas da Iugu ou valor que chega na conta?');
  console.log('• paid_cents vs total_cents vs valor recebido?');
  console.log('');

  // 3. Devoluções
  console.log('🔄 3. DEVOLUÇÕES');
  console.log('===============');
  console.log('REGRA ATUAL NO SISTEMA:');
  console.log('• Campo usado: total_cents (valor total da fatura devolvida)');
  console.log('• Critério temporal: created_at_iugu (data de criação da devolução)');
  console.log('• Filtros: status = "refunded"');
  console.log('• Valor: negativo (multiplicado por -1)');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT -SUM(total_cents)/100 as devolucoes
FROM iugu_invoices 
WHERE status = 'refunded' 
  AND created_at_iugu >= '2025-08-01' 
  AND created_at_iugu < '2025-09-01'`);
  console.log('');
  console.log('❓ POSSÍVEIS DIVERGÊNCIAS:');
  console.log('• Data de criação vs data de processamento da devolução?');
  console.log('• total_cents vs paid_cents vs valor efetivamente devolvido?');
  console.log('• Inclui devoluções parciais?');
  console.log('');

  // 4. Receita Líquida
  console.log('💎 4. RECEITA LÍQUIDA');
  console.log('====================');
  console.log('REGRA ATUAL NO SISTEMA:');
  console.log('• Cálculo: Receita Bruta + Devoluções');
  console.log('• Devoluções são negativas, então é uma subtração');
  console.log('• Não considera taxas/comissões da Iugu');
  console.log('');
  console.log('❓ POSSÍVEIS DIVERGÊNCIAS:');
  console.log('• Receita líquida = bruta - devoluções - taxas Iugu?');
  console.log('• Ou receita líquida = valor que efetivamente chega na conta?');
  console.log('• Considera comissões/taxas de processamento?');
  console.log('');

  // 5. Métodos de Pagamento
  console.log('💳 5. MÉTODOS DE PAGAMENTO (PIX, CARTÃO, BOLETO)');
  console.log('===============================================');
  console.log('REGRA ATUAL NO SISTEMA:');
  console.log('• Campo usado: payment_method');
  console.log('• Valores: "iugu_pix", "iugu_credit_card", "iugu_bank_slip"');
  console.log('• Campo valor: paid_cents');
  console.log('• Critério temporal: paid_at');
  console.log('• Filtros: status = "paid"');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT 
  payment_method,
  SUM(paid_cents)/100 as valor
FROM iugu_invoices 
WHERE status = 'paid' 
  AND paid_at >= '2025-06-01' 
  AND paid_at < '2025-07-01'
GROUP BY payment_method`);
  console.log('');
  console.log('❓ POSSÍVEIS DIVERGÊNCIAS:');
  console.log('• Faturas com payment_method NULL são incluídas onde?');
  console.log('• Outros métodos (débito, transferência) são considerados?');
  console.log('• paid_cents vs valor líquido após taxas do método?');
  console.log('');

  // 6. Faturas Geradas
  console.log('📄 6. FATURAS GERADAS');
  console.log('====================');
  console.log('REGRA ATUAL NO SISTEMA:');
  console.log('• Contagem: COUNT(*) de faturas');
  console.log('• Critério temporal: created_at_iugu (data de criação)');
  console.log('• Filtros: NENHUM (todas as faturas criadas)');
  console.log('• Inclui: pagas, pendentes, canceladas, expiradas');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT COUNT(*) as faturas_geradas
FROM iugu_invoices 
WHERE created_at_iugu >= '2025-08-01' 
  AND created_at_iugu < '2025-09-01'`);
  console.log('');
  console.log('❓ POSSÍVEIS DIVERGÊNCIAS:');
  console.log('• Conta todas as faturas ou só as válidas?');
  console.log('• Exclui faturas de teste?');
  console.log('• Considera apenas faturas enviadas ao cliente?');
  console.log('');

  console.log('');
  console.log('🔍 VERIFICAÇÃO PRÁTICA');
  console.log('=====================');

  try {
    // Exemplo prático para Agosto 2025
    console.log('📅 EXEMPLO: AGOSTO 2025');
    console.log('');

    // MRR
    const mrrInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,paid_cents,subscription_id&status=eq.paid&subscription_id=not.is.null&paid_at=gte.2025-08-01&paid_at=lt.2025-09-01&limit=5`,
      { headers: supabaseHeaders }
    );
    console.log('📊 AMOSTRA MRR (5 faturas):');
    if (mrrInvoices && mrrInvoices.length > 0) {
      mrrInvoices.forEach((inv, i) => {
        console.log(
          `   ${i + 1}. ${inv.id}: R$ ${(inv.paid_cents / 100).toFixed(2)} (subscription: ${inv.subscription_id})`
        );
      });
    }
    console.log('');

    // Métodos de pagamento únicos
    const paymentMethods = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=payment_method&status=eq.paid&paid_at=gte.2025-08-01&paid_at=lt.2025-09-01&limit=1000`,
      { headers: supabaseHeaders }
    );
    if (paymentMethods) {
      const methods = [...new Set(paymentMethods.map((p) => p.payment_method))];
      console.log('💳 MÉTODOS DE PAGAMENTO ENCONTRADOS:');
      methods.forEach((method) => {
        console.log(`   • ${method || 'NULL'}`);
      });
    }
    console.log('');

    // Status das faturas
    const statuses = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=status&created_at_iugu=gte.2025-08-01&created_at_iugu=lt.2025-09-01&limit=1000`,
      { headers: supabaseHeaders }
    );
    if (statuses) {
      const statusCounts = statuses.reduce((acc, s) => {
        acc[s.status || 'NULL'] = (acc[s.status || 'NULL'] || 0) + 1;
        return acc;
      }, {});
      console.log('📊 STATUS DAS FATURAS (AGOSTO):');
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`   • ${status}: ${count} faturas`);
      });
    }
  } catch (err) {
    console.error(`❌ Erro na verificação: ${err.message}`);
  }

  console.log('');
  console.log('📋 PRÓXIMOS PASSOS:');
  console.log('==================');
  console.log('1. Revisar cada regra acima com seus critérios manuais');
  console.log('2. Identificar divergências específicas');
  console.log('3. Ajustar os cálculos conforme necessário');
  console.log('4. Recalcular os KPIs com as regras corretas');
  console.log('5. Validar contra os números reais');
  console.log('');
  console.log('❓ QUESTÕES ESPECÍFICAS PARA VOCÊ:');
  console.log('================================');
  console.log('A. MRR deve usar paid_cents ou total_cents?');
  console.log('B. Receita bruta inclui taxas da Iugu ou é valor líquido?');
  console.log('C. Devoluções: data de criação ou data de processamento?');
  console.log('D. Métodos de pagamento: há outros além de PIX/Cartão/Boleto?');
  console.log('E. Faturas geradas: inclui todas ou só as enviadas?');
  console.log('F. Há exclusões específicas (teste, cancelamentos, etc.)?');
}

// Executar se chamado diretamente
if (require.main === module) {
  documentKPIRules()
    .then(() => {
      console.log('');
      console.log('✅ Documentação concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { documentKPIRules };
