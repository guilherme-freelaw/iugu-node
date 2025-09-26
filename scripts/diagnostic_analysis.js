#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !IUGU_API_TOKEN) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const iuguHeaders = {
  Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
  'Content-Type': 'application/json',
};

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

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

async function getSupabaseData(query) {
  try {
    return await makeRequest(`${SUPABASE_URL}/rest/v1/${query}`, { headers: supabaseHeaders });
  } catch (err) {
    logWithTimestamp(`❌ Erro Supabase: ${err.message}`);
    return null;
  }
}

async function getIuguData(endpoint, params = {}) {
  try {
    const queryString = new URLSearchParams(params).toString();
    const url = `${IUGU_API_BASE_URL}${endpoint}?${queryString}`;
    return await makeRequest(url, { headers: iuguHeaders });
  } catch (err) {
    logWithTimestamp(`❌ Erro Iugu: ${err.message}`);
    return null;
  }
}

async function diagnosePeriod(year, month, monthName) {
  logWithTimestamp(`🔍 DIAGNÓSTICO DETALHADO: ${monthName}/${year}`);
  logWithTimestamp('='.repeat(50));

  const monthStr = month.toString().padStart(2, '0');
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStr = nextMonth.toString().padStart(2, '0');

  const diagnosis = {
    period: `${monthName}/${year}`,
    supabase: {},
    iugu: {},
    gaps: {},
    recommendations: [],
  };

  try {
    // 1. Analisar dados no Supabase
    console.log('📊 Analisando dados no Supabase...');

    // Total de faturas no período
    const supabaseInvoices = await getSupabaseData(
      `iugu_invoices?select=count&created_at_iugu=gte.${year}-${monthStr}-01&created_at_iugu=lt.${nextYear}-${nextMonthStr}-01&headers={"Prefer":"count=exact"}`
    );

    // Faturas pagas por método
    const pixSupabase = await getSupabaseData(
      `iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_pix&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr}-01`
    );

    const cardSupabase = await getSupabaseData(
      `iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_credit_card&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr}-01`
    );

    const boletoSupabase = await getSupabaseData(
      `iugu_invoices?select=paid_cents,total_cents&status=eq.paid&payment_method=eq.iugu_bank_slip&paid_at=gte.${year}-${monthStr}-01&paid_at=lt.${nextYear}-${nextMonthStr}-01`
    );

    // Faturas com problemas de data
    const problematicDates = await getSupabaseData(
      `iugu_invoices?select=id,created_at_iugu,paid_at&or=(created_at_iugu.is.null,paid_at.is.null)&created_at_iugu=gte.${year}-${monthStr}-01&created_at_iugu=lt.${nextYear}-${nextMonthStr}-01`
    );

    diagnosis.supabase = {
      totalInvoices: supabaseInvoices?.[0]?.count || 0,
      pixValue:
        (pixSupabase || []).reduce(
          (sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0),
          0
        ) / 100,
      pixCount: (pixSupabase || []).length,
      cardValue:
        (cardSupabase || []).reduce(
          (sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0),
          0
        ) / 100,
      cardCount: (cardSupabase || []).length,
      boletoValue:
        (boletoSupabase || []).reduce(
          (sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0),
          0
        ) / 100,
      boletoCount: (boletoSupabase || []).length,
      problematicDates: (problematicDates || []).length,
    };

    // 2. Comparar com dados da API Iugu diretamente
    console.log('🔍 Consultando API Iugu diretamente...');

    // Amostra de faturas da Iugu no período
    const iuguSample = await getIuguData('/invoices', {
      limit: 100,
      created_at_from: `${year}-${monthStr}-01`,
      created_at_to: `${year}-${monthStr}-28`,
    });

    const iuguInvoices = iuguSample?.items || [];

    // Analisar métodos de pagamento na amostra Iugu
    const iuguPixCount = iuguInvoices.filter(
      (inv) => inv.payment_method === 'iugu_pix' && inv.status === 'paid'
    ).length;
    const iuguCardCount = iuguInvoices.filter(
      (inv) => inv.payment_method === 'iugu_credit_card' && inv.status === 'paid'
    ).length;
    const iuguBoletoCount = iuguInvoices.filter(
      (inv) => inv.payment_method === 'iugu_bank_slip' && inv.status === 'paid'
    ).length;

    diagnosis.iugu = {
      sampleSize: iuguInvoices.length,
      pixCount: iuguPixCount,
      cardCount: iuguCardCount,
      boletoCount: iuguBoletoCount,
      statusDistribution: {},
      dateFormats: [],
    };

    // Analisar distribuição de status
    iuguInvoices.forEach((inv) => {
      diagnosis.iugu.statusDistribution[inv.status] =
        (diagnosis.iugu.statusDistribution[inv.status] || 0) + 1;
    });

    // Analisar formatos de data problemáticos
    iuguInvoices.forEach((inv) => {
      if (inv.created_at && typeof inv.created_at === 'string') {
        const format = inv.created_at.includes('T')
          ? 'ISO'
          : inv.created_at.includes('/')
            ? 'DD/MM'
            : inv.created_at.includes('Feb')
              ? 'DD Feb'
              : 'OTHER';
        if (!diagnosis.iugu.dateFormats.includes(format)) {
          diagnosis.iugu.dateFormats.push(format);
        }
      }
    });

    // 3. Identificar lacunas específicas
    console.log('🔍 Identificando lacunas...');

    const totalSupabasePayments =
      diagnosis.supabase.pixCount + diagnosis.supabase.cardCount + diagnosis.supabase.boletoCount;
    const totalIuguPayments =
      diagnosis.iugu.pixCount + diagnosis.iugu.cardCount + diagnosis.iugu.boletoCount;

    diagnosis.gaps = {
      totalInvoiceGap: 'N/A', // Precisaria de contagem total da Iugu
      paymentMethodGaps: {
        pix: diagnosis.supabase.pixCount - diagnosis.iugu.pixCount,
        card: diagnosis.supabase.cardCount - diagnosis.iugu.cardCount,
        boleto: diagnosis.supabase.boletoCount - diagnosis.iugu.boletoCount,
      },
      problematicDates: diagnosis.supabase.problematicDates,
      suspectedIssues: [],
    };

    // 4. Gerar recomendações
    if (diagnosis.supabase.problematicDates > 0) {
      diagnosis.recommendations.push(
        `Corrigir ${diagnosis.supabase.problematicDates} faturas com datas nulas`
      );
    }

    if (
      diagnosis.iugu.dateFormats.includes('DD/MM') ||
      diagnosis.iugu.dateFormats.includes('DD Feb')
    ) {
      diagnosis.recommendations.push('Implementar normalização de formatos de data não-ISO');
      diagnosis.gaps.suspectedIssues.push('TIMESTAMP_FORMAT_ISSUES');
    }

    if (diagnosis.supabase.totalInvoices < 50) {
      diagnosis.recommendations.push(
        `Período com poucos dados (${diagnosis.supabase.totalInvoices} faturas) - pode precisar busca mais abrangente`
      );
      diagnosis.gaps.suspectedIssues.push('INSUFFICIENT_DATA');
    }

    // 5. Exibir resultados
    console.log('');
    console.log('📊 RESULTADOS DO DIAGNÓSTICO:');
    console.log('-'.repeat(40));
    console.log(`Faturas no Supabase: ${diagnosis.supabase.totalInvoices}`);
    console.log(`Faturas na amostra Iugu: ${diagnosis.iugu.sampleSize}`);
    console.log('');
    console.log('💳 MÉTODOS DE PAGAMENTO (Supabase):');
    console.log(
      `   PIX: ${diagnosis.supabase.pixCount} faturas (R$ ${diagnosis.supabase.pixValue.toLocaleString('pt-BR')})`
    );
    console.log(
      `   Cartão: ${diagnosis.supabase.cardCount} faturas (R$ ${diagnosis.supabase.cardValue.toLocaleString('pt-BR')})`
    );
    console.log(
      `   Boleto: ${diagnosis.supabase.boletoCount} faturas (R$ ${diagnosis.supabase.boletoValue.toLocaleString('pt-BR')})`
    );
    console.log('');
    console.log('📋 STATUS IUGU (amostra):');
    Object.entries(diagnosis.iugu.statusDistribution).forEach(([status, count]) => {
      console.log(`   ${status}: ${count} faturas`);
    });
    console.log('');
    console.log('📅 FORMATOS DE DATA ENCONTRADOS:');
    console.log(`   ${diagnosis.iugu.dateFormats.join(', ')}`);
    console.log('');
    console.log('⚠️  PROBLEMAS IDENTIFICADOS:');
    diagnosis.gaps.suspectedIssues.forEach((issue) => {
      console.log(`   - ${issue}`);
    });
    console.log('');
    console.log('💡 RECOMENDAÇÕES:');
    diagnosis.recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });

    return diagnosis;
  } catch (err) {
    logWithTimestamp(`❌ Erro no diagnóstico: ${err.message}`);
    return diagnosis;
  }
}

async function runDiagnosticAnalysis() {
  logWithTimestamp('🩺 ANÁLISE DIAGNÓSTICA DETALHADA');
  logWithTimestamp('=================================');
  logWithTimestamp('🎯 Objetivo: Identificar causas raiz das defasagens');
  logWithTimestamp('');

  const diagnostics = [];

  // Focar nos períodos mais problemáticos
  const periodsToAnalyze = [
    { year: 2025, month: 2, name: 'fevereiro' },
    { year: 2025, month: 6, name: 'junho' },
  ];

  for (const period of periodsToAnalyze) {
    const diagnosis = await diagnosePeriod(period.year, period.month, period.name);
    diagnostics.push(diagnosis);

    console.log('');
    console.log('⏸️  Pausa entre diagnósticos...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // Resumo consolidado
  logWithTimestamp('');
  logWithTimestamp('🎯 RESUMO CONSOLIDADO:');
  logWithTimestamp('=====================');

  const allIssues = new Set();
  const allRecommendations = [];

  diagnostics.forEach((diag) => {
    diag.gaps.suspectedIssues.forEach((issue) => allIssues.add(issue));
    allRecommendations.push(...diag.recommendations);
  });

  console.log('🚨 PROBLEMAS PRINCIPAIS:');
  [...allIssues].forEach((issue) => {
    console.log(`   - ${issue}`);
  });

  console.log('');
  console.log('🔧 AÇÕES CORRETIVAS NECESSÁRIAS:');
  [...new Set(allRecommendations)].forEach((rec, index) => {
    console.log(`   ${index + 1}. ${rec}`);
  });

  return diagnostics;
}

// Executar se chamado diretamente
if (require.main === module) {
  runDiagnosticAnalysis()
    .then((diagnostics) => {
      console.log('');
      console.log('✅ Análise diagnóstica concluída!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Erro fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { runDiagnosticAnalysis, diagnosePeriod };
