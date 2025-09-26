#!/usr/bin/env node

/**
 * 📚 GLOSSÁRIO COMPLETO DOS KPIs - DEFINIÇÕES TÉCNICAS
 * ==================================================
 *
 * Definições exatas de como cada KPI está sendo calculado no sistema
 * para validação contra as regras de negócio do usuário.
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

async function generateKPIGlossary() {
  console.log('📚 GLOSSÁRIO COMPLETO DOS KPIs');
  console.log('==============================');
  console.log('');

  console.log('🎯 LEGENDA DE CAMPOS UTILIZADOS:');
  console.log('================================');
  console.log('• paid_cents: Valor efetivamente pago (em centavos)');
  console.log('• total_cents: Valor total da fatura (em centavos)');
  console.log('• commission_cents: Taxas/comissões da Iugu (em centavos)');
  console.log('• status: Status da fatura (paid, refunded, canceled, etc.)');
  console.log('• subscription_id: ID da assinatura (se aplicável)');
  console.log('• payment_method: Método de pagamento (iugu_pix, iugu_credit_card, etc.)');
  console.log('• paid_at: Data/hora do pagamento');
  console.log('• created_at_iugu: Data/hora de criação da fatura na Iugu');
  console.log('');

  // Buscar amostra de dados para exemplificar
  try {
    const sampleInvoice = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,paid_cents,total_cents,commission_cents,subscription_id,payment_method,paid_at,created_at_iugu&status=eq.paid&limit=1`,
      { headers: supabaseHeaders }
    );

    if (sampleInvoice && sampleInvoice.length > 0) {
      const inv = sampleInvoice[0];
      console.log('📄 EXEMPLO DE FATURA NO SISTEMA:');
      console.log('================================');
      console.log(`ID: ${inv.id}`);
      console.log(`Status: ${inv.status}`);
      console.log(`Valor pago: R$ ${(inv.paid_cents / 100).toFixed(2)}`);
      console.log(`Valor total: R$ ${(inv.total_cents / 100).toFixed(2)}`);
      console.log(`Comissão Iugu: R$ ${((inv.commission_cents || 0) / 100).toFixed(2)}`);
      console.log(`Assinatura: ${inv.subscription_id || 'N/A'}`);
      console.log(`Método: ${inv.payment_method || 'N/A'}`);
      console.log(`Data pagamento: ${inv.paid_at || 'N/A'}`);
      console.log(`Data criação: ${inv.created_at_iugu || 'N/A'}`);
      console.log('');
    }
  } catch (err) {
    console.log('⚠️ Não foi possível buscar exemplo de fatura');
  }

  console.log('📊 DEFINIÇÕES DOS KPIs:');
  console.log('=======================');
  console.log('');

  // 1. MRR
  console.log('💰 1. MRR (MONTHLY RECURRING REVENUE)');
  console.log('=====================================');
  console.log('DEFINIÇÃO:');
  console.log('• Receita recorrente mensal proveniente de assinaturas pagas');
  console.log('');
  console.log('COMPOSIÇÃO DO CÁLCULO:');
  console.log('• Campo valor: paid_cents (valor efetivamente pago)');
  console.log('• Filtro principal: status = "paid"');
  console.log('• Filtro obrigatório: subscription_id IS NOT NULL');
  console.log('• Critério temporal: paid_at OU created_at_iugu (como fallback)');
  console.log('• Período: Mês específico (ex: 2025-08-01 até 2025-09-01)');
  console.log('• Exclusões: Faturas de teste (id = "test_inv", etc.)');
  console.log('• Exclusões: Status NULL');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT SUM(paid_cents)/100 as mrr
FROM iugu_invoices 
WHERE status = 'paid' 
  AND subscription_id IS NOT NULL
  AND (paid_at >= '2025-08-01' OR created_at_iugu >= '2025-08-01')
  AND (paid_at < '2025-09-01' OR created_at_iugu < '2025-09-01')
  AND id != 'test_inv'`);
  console.log('');
  console.log('O QUE INCLUI: Todos os pagamentos de faturas com assinatura');
  console.log('O QUE EXCLUI: Faturas avulsas, canceladas, teste, reembolsadas');
  console.log('');
  console.log(''.padEnd(70, '-'));
  console.log('');

  // 2. Receita Bruta
  console.log('💵 2. RECEITA BRUTA');
  console.log('==================');
  console.log('DEFINIÇÃO:');
  console.log('• Valor total recebido de todas as faturas pagas, incluindo taxas');
  console.log('');
  console.log('COMPOSIÇÃO DO CÁLCULO:');
  console.log('• Campo valor: paid_cents (valor efetivamente pago)');
  console.log('• Filtro principal: status = "paid"');
  console.log('• Filtro de assinatura: NENHUM (inclui todas as faturas pagas)');
  console.log('• Critério temporal: paid_at OU created_at_iugu (como fallback)');
  console.log('• Período: Mês específico');
  console.log('• Exclusões: Faturas de teste');
  console.log('• Exclusões: Status NULL');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT SUM(paid_cents)/100 as receita_bruta
FROM iugu_invoices 
WHERE status = 'paid' 
  AND (paid_at >= '2025-08-01' OR created_at_iugu >= '2025-08-01')
  AND (paid_at < '2025-09-01' OR created_at_iugu < '2025-09-01')
  AND id != 'test_inv'`);
  console.log('');
  console.log('O QUE INCLUI: Faturas com assinatura + faturas avulsas pagas');
  console.log('O QUE EXCLUI: Faturas canceladas, teste, reembolsadas');
  console.log('OBSERVAÇÃO: Inclui taxas da Iugu no valor total');
  console.log('');
  console.log(''.padEnd(70, '-'));
  console.log('');

  // 3. Taxas Iugu
  console.log('🏦 3. TAXAS IUGU (COMISSÕES)');
  console.log('===========================');
  console.log('DEFINIÇÃO:');
  console.log('• Valor das comissões cobradas pela Iugu sobre transações');
  console.log('');
  console.log('COMPOSIÇÃO DO CÁLCULO:');
  console.log('• Campo valor: commission_cents (comissão em centavos)');
  console.log('• Filtro principal: status = "paid"');
  console.log('• Critério temporal: paid_at OU created_at_iugu');
  console.log('• Período: Mês específico');
  console.log('• Exclusões: Faturas de teste, status NULL');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT SUM(commission_cents)/100 as taxas_iugu
FROM iugu_invoices 
WHERE status = 'paid' 
  AND (paid_at >= '2025-08-01' OR created_at_iugu >= '2025-08-01')
  AND (paid_at < '2025-09-01' OR created_at_iugu < '2025-09-01')
  AND commission_cents IS NOT NULL`);
  console.log('');
  console.log('USO: Para calcular receita líquida e analisar custos financeiros');
  console.log('');
  console.log(''.padEnd(70, '-'));
  console.log('');

  // 4. Devoluções
  console.log('🔄 4. DEVOLUÇÕES (REEMBOLSOS)');
  console.log('============================');
  console.log('DEFINIÇÃO:');
  console.log('• Valor das faturas que foram reembolsadas');
  console.log('');
  console.log('COMPOSIÇÃO DO CÁLCULO:');
  console.log('• Campo valor: total_cents (valor total da fatura reembolsada)');
  console.log('• Filtro principal: status = "refunded"');
  console.log('• Critério temporal: created_at_iugu (data de criação do reembolso)');
  console.log('• Período: Mês específico');
  console.log('• Valor: NEGATIVO (multiplicado por -1)');
  console.log('• Exclusões: Faturas de teste, status NULL');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT -SUM(total_cents)/100 as devolucoes
FROM iugu_invoices 
WHERE status = 'refunded' 
  AND created_at_iugu >= '2025-08-01' 
  AND created_at_iugu < '2025-09-01'
  AND id != 'test_inv'`);
  console.log('');
  console.log('O QUE INCLUI: Todas as faturas reembolsadas no período');
  console.log('OBSERVAÇÃO: Usa data de criação, não data do pagamento original');
  console.log('');
  console.log(''.padEnd(70, '-'));
  console.log('');

  // 5. Receita Líquida
  console.log('💎 5. RECEITA LÍQUIDA');
  console.log('====================');
  console.log('DEFINIÇÃO:');
  console.log('• Receita final após descontar devoluções e taxas');
  console.log('');
  console.log('COMPOSIÇÃO DO CÁLCULO:');
  console.log('• Fórmula: Receita Bruta + Devoluções - Taxas Iugu');
  console.log('• Receita Bruta: Soma de paid_cents de faturas pagas');
  console.log('• Devoluções: Soma negativa de total_cents de faturas refunded');
  console.log('• Taxas Iugu: Soma de commission_cents');
  console.log('');
  console.log('CÁLCULO FINAL:');
  console.log('receita_liquida = receita_bruta + devolucoes - taxas_iugu');
  console.log('(devoluções já são negativas)');
  console.log('');
  console.log('O QUE REPRESENTA: Valor que efetivamente fica na empresa');
  console.log('');
  console.log(''.padEnd(70, '-'));
  console.log('');

  // 6. Métodos de Pagamento
  console.log('💳 6. MÉTODOS DE PAGAMENTO');
  console.log('=========================');
  console.log('DEFINIÇÃO:');
  console.log('• Distribuição da receita por forma de pagamento');
  console.log('');
  console.log('COMPOSIÇÃO DO CÁLCULO:');
  console.log('• Campo valor: paid_cents');
  console.log('• Campo filtro: payment_method');
  console.log('• Filtro principal: status = "paid"');
  console.log('• Critério temporal: paid_at OU created_at_iugu');
  console.log('• Exclusões: Faturas de teste, status NULL');
  console.log('');
  console.log('MÉTODOS CONSIDERADOS:');
  console.log('• PIX: payment_method = "iugu_pix"');
  console.log('• Cartão de Crédito: payment_method = "iugu_credit_card"');
  console.log('• Boleto Bancário: payment_method = "iugu_bank_slip"');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`SELECT 
  payment_method,
  SUM(paid_cents)/100 as valor
FROM iugu_invoices 
WHERE status = 'paid' 
  AND payment_method IN ('iugu_pix', 'iugu_credit_card', 'iugu_bank_slip')
  AND (paid_at >= '2025-08-01' OR created_at_iugu >= '2025-08-01')
  AND (paid_at < '2025-09-01' OR created_at_iugu < '2025-09-01')
GROUP BY payment_method`);
  console.log('');
  console.log('OBSERVAÇÃO: Faturas com payment_method NULL não são incluídas');
  console.log('');
  console.log(''.padEnd(70, '-'));
  console.log('');

  // 7. Faturas Geradas
  console.log('📄 7. FATURAS GERADAS');
  console.log('====================');
  console.log('DEFINIÇÃO:');
  console.log('• Quantidade total de faturas criadas no período');
  console.log('');
  console.log('COMPOSIÇÃO DO CÁLCULO:');
  console.log('• Métrica: COUNT(*) - contagem de registros');
  console.log('• Filtro principal: NENHUM (todas as faturas)');
  console.log('• Critério temporal: created_at_iugu (data de criação)');
  console.log('• Período: Mês específico');
  console.log('• Exclusões: Faturas de teste');
  console.log('');
  console.log('DUAS VERSÕES:');
  console.log('• Total: Inclui todos os status (paid, canceled, pending, etc.)');
  console.log('• Válidas: Exclui status NULL');
  console.log('');
  console.log('SQL EQUIVALENTE:');
  console.log(`-- Faturas Total
SELECT COUNT(*) as faturas_total
FROM iugu_invoices 
WHERE created_at_iugu >= '2025-08-01' 
  AND created_at_iugu < '2025-09-01'
  AND id != 'test_inv'

-- Faturas Válidas  
SELECT COUNT(*) as faturas_validas
FROM iugu_invoices 
WHERE created_at_iugu >= '2025-08-01' 
  AND created_at_iugu < '2025-09-01'
  AND status IS NOT NULL
  AND id != 'test_inv'`);
  console.log('');
  console.log('PERMITE SEGREGAÇÃO: Análise por status (pagas vs canceladas)');
  console.log('');
  console.log(''.padEnd(70, '-'));
  console.log('');

  // 8. Filtros de Exclusão
  console.log('🚫 8. FILTROS DE EXCLUSÃO APLICADOS');
  console.log('===================================');
  console.log('FATURAS DE TESTE:');
  console.log('• id = "test_inv"');
  console.log('• id começando com "test_"');
  console.log('• id contendo "teste"');
  console.log('');
  console.log('STATUS INVÁLIDOS:');
  console.log('• status IS NULL (conforme regra G)');
  console.log('');
  console.log('FUNÇÃO DE DETECÇÃO:');
  console.log(`function isTestInvoice(invoice) {
  return (
    invoice.id === 'test_inv' ||
    /^test_/i.test(invoice.id || '') ||
    /teste/i.test(invoice.id || '')
  );
}`);
  console.log('');
  console.log(''.padEnd(70, '-'));
  console.log('');

  // 9. Critérios Temporais
  console.log('📅 9. CRITÉRIOS TEMPORAIS');
  console.log('========================');
  console.log('REGRA PRINCIPAL:');
  console.log('• Prioridade 1: paid_at (data de pagamento)');
  console.log('• Prioridade 2: created_at_iugu (fallback quando paid_at é NULL)');
  console.log('');
  console.log('IMPLEMENTAÇÃO:');
  console.log('WHERE (paid_at >= início OR created_at_iugu >= início)');
  console.log('  AND (paid_at < fim OR created_at_iugu < fim)');
  console.log('');
  console.log('EXCEÇÃO - DEVOLUÇÕES:');
  console.log('• Sempre usam created_at_iugu (data de criação do reembolso)');
  console.log('');

  console.log('✅ GLOSSÁRIO COMPLETO GERADO!');
  console.log('');
  console.log('🔍 PRÓXIMOS PASSOS:');
  console.log('===================');
  console.log('1. Revisar cada definição contra suas regras de negócio');
  console.log('2. Identificar divergências específicas');
  console.log('3. Solicitar ajustes necessários');
  console.log('4. Recalcular KPIs com regras corrigidas');
}

// Executar se chamado diretamente
if (require.main === module) {
  generateKPIGlossary()
    .then(() => {
      console.log('✅ Glossário concluído!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { generateKPIGlossary };
