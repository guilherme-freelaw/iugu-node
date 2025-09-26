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

async function quickPrecisionAnalysis() {
  console.log('🔍 ANÁLISE RÁPIDA DE PRECISÃO');
  console.log('=============================');

  try {
    // Dados reais esperados
    const EXPECTED = {
      feb: { pix: 203942, card: 367638, boleto: 132341 },
      jun: { pix: 193214, card: 434384, boleto: 119940 },
      aug: { pix: 230348, card: 462657, boleto: 106484 },
    };

    // Verificar dados atuais no Supabase
    console.log('📊 Verificando dados atuais...');

    // Fevereiro
    const febPix = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.2025-02-01&paid_at=lt.2025-03-01`,
      { headers: supabaseHeaders }
    );
    const febCard = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_credit_card&paid_at=gte.2025-02-01&paid_at=lt.2025-03-01`,
      { headers: supabaseHeaders }
    );
    const febBoleto = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_bank_slip&paid_at=gte.2025-02-01&paid_at=lt.2025-03-01`,
      { headers: supabaseHeaders }
    );

    // Junho
    const junPix = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.2025-06-01&paid_at=lt.2025-07-01`,
      { headers: supabaseHeaders }
    );
    const junCard = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_credit_card&paid_at=gte.2025-06-01&paid_at=lt.2025-07-01`,
      { headers: supabaseHeaders }
    );
    const junBoleto = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_bank_slip&paid_at=gte.2025-06-01&paid_at=lt.2025-07-01`,
      { headers: supabaseHeaders }
    );

    function calcValue(invoices) {
      return invoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) / 100;
    }

    const current = {
      feb: {
        pix: calcValue(febPix || []),
        card: calcValue(febCard || []),
        boleto: calcValue(febBoleto || []),
      },
      jun: {
        pix: calcValue(junPix || []),
        card: calcValue(junCard || []),
        boleto: calcValue(junBoleto || []),
      },
    };

    console.log('');
    console.log('📋 COMPARAÇÃO ATUAL:');
    console.log('=====================');

    ['feb', 'jun'].forEach((period) => {
      const periodName = period === 'feb' ? 'FEVEREIRO' : 'JUNHO';
      console.log(`\n📅 ${periodName}:`);

      ['pix', 'card', 'boleto'].forEach((method) => {
        const expected = EXPECTED[period][method];
        const found = current[period][method];
        const diff = ((found - expected) / expected) * 100;
        const missing = expected - found;

        console.log(
          `   ${method.toUpperCase()}: R$ ${found.toLocaleString('pt-BR')} / R$ ${expected.toLocaleString('pt-BR')} (${diff.toFixed(1)}%) - Faltam R$ ${missing.toLocaleString('pt-BR')}`
        );
      });
    });

    // Calcular total de dados faltantes
    const totalMissing = {
      feb: Object.keys(EXPECTED.feb).reduce(
        (sum, key) => sum + (EXPECTED.feb[key] - current.feb[key]),
        0
      ),
      jun: Object.keys(EXPECTED.jun).reduce(
        (sum, key) => sum + (EXPECTED.jun[key] - current.jun[key]),
        0
      ),
    };

    console.log('');
    console.log('💰 TOTAL FALTANTE:');
    console.log(`   Fevereiro: R$ ${totalMissing.feb.toLocaleString('pt-BR')}`);
    console.log(`   Junho: R$ ${totalMissing.jun.toLocaleString('pt-BR')}`);
    console.log(
      `   Total geral: R$ ${(totalMissing.feb + totalMissing.jun).toLocaleString('pt-BR')}`
    );

    // Verificar faturas com problemas
    console.log('');
    console.log('🔍 INVESTIGANDO PROBLEMAS...');

    const problematicInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,payment_method,total_cents,paid_at,created_at_iugu&or=(paid_at.is.null,total_cents.is.null,status.is.null)&limit=50`,
      { headers: supabaseHeaders }
    );

    console.log(`❌ Faturas com problemas encontradas: ${(problematicInvoices || []).length}`);

    if (problematicInvoices && problematicInvoices.length > 0) {
      console.log('🔍 Amostra de problemas:');
      problematicInvoices.slice(0, 5).forEach((inv, i) => {
        console.log(
          `   ${i + 1}. ${inv.id}: status=${inv.status}, paid_at=${inv.paid_at}, total=${inv.total_cents}`
        );
      });
    }

    return {
      expected: EXPECTED,
      current: current,
      missing: totalMissing,
      problematicCount: (problematicInvoices || []).length,
    };
  } catch (err) {
    console.error(`❌ Erro na análise: ${err.message}`);
    return null;
  }
}

async function proposeDirectFix() {
  console.log('');
  console.log('💡 PROPOSTA DE CORREÇÃO DIRETA');
  console.log('==============================');

  const analysis = await quickPrecisionAnalysis();

  if (!analysis) {
    console.log('❌ Não foi possível analisar os dados');
    return;
  }

  console.log('');
  console.log('🎯 ESTRATÉGIAS POSSÍVEIS:');
  console.log('');

  console.log('OPÇÃO 1 - CORREÇÃO MANUAL DIRECIONADA:');
  console.log('• Identificar faturas específicas faltantes via API Iugu');
  console.log('• Inserir manualmente os registros que faltam');
  console.log('• Tempo estimado: 30-60 minutos');
  console.log('• Precisão esperada: 99%+');

  console.log('');
  console.log('OPÇÃO 2 - ACEITAR SISTEMA ATUAL:');
  console.log('• Sistema funcional com 92-94% de precisão');
  console.log('• Usar para análises de tendência');
  console.log('• Documentar limitações conhecidas');
  console.log('• Tempo: 0 minutos');

  console.log('');
  console.log('OPÇÃO 3 - HYBRID APPROACH:');
  console.log('• Focar apenas nos dados mais críticos (PIX junho)');
  console.log('• Corrigir apenas as maiores discrepâncias');
  console.log('• Tempo: 15-30 minutos');
  console.log('• Precisão esperada: 96-98%');

  console.log('');
  console.log('📊 RECOMENDAÇÃO:');
  if (analysis.missing.feb + analysis.missing.jun < 100000) {
    console.log('✅ OPÇÃO 3 (Hybrid) - Discrepâncias são relativamente pequenas');
  } else {
    console.log('🎯 OPÇÃO 1 (Correção completa) - Discrepâncias significativas precisam correção');
  }

  return analysis;
}

// Executar se chamado diretamente
if (require.main === module) {
  proposeDirectFix()
    .then(() => {
      console.log('');
      console.log('✅ Análise concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { quickPrecisionAnalysis, proposeDirectFix };
