#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

// Dados reais da planilha (Receita Líquida)
const REAL_DATA = {
  '2024-12': 641019,
  '2025-01': 712846,
  '2025-02': 703920,
  '2025-03': 725383,
  '2025-04': 758793,
  '2025-05': 749793,
  '2025-06': 747538,
  '2025-07': 784646,
  '2025-08': 799490,
};

// Dados de faturas da planilha
const REAL_INVOICES = {
  '2024-12': { geradas: 727, pagas: 449 },
  '2025-01': { geradas: 851, pagas: 477 },
  '2025-02': { geradas: 707, pagas: 496 },
  '2025-03': { geradas: 769, pagas: 512 },
  '2025-04': { geradas: 769, pagas: 502 },
  '2025-05': { geradas: 758, pagas: 517 },
  '2025-06': { geradas: 512, pagas: 506 },
  '2025-07': { geradas: 571, pagas: 562 },
  '2025-08': { geradas: 584, pagas: 574 },
};

function makeRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const fullHeaders = {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...headers,
    };

    const req = https.request(url, { method: 'GET', headers: fullHeaders }, (res) => {
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

function formatCurrency(value) {
  return `R$ ${(value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

async function validateData() {
  console.log('🔍 VALIDAÇÃO CONTRA DADOS REAIS DA PLANILHA');
  console.log('============================================');
  console.log(`🕐 ${new Date().toLocaleString()}\n`);

  try {
    // Buscar dados do Supabase para comparação
    console.log('🔄 Buscando dados do Supabase...');
    const supabaseData = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=created_at_iugu,status,total_cents,paid_cents&created_at_iugu=gte.2024-12-01&created_at_iugu=lt.2025-09-01&status=not.is.null&total_cents=not.is.null&limit=10000`
    );

    console.log(`📊 Total de faturas analisadas: ${supabaseData.length}\n`);

    // Agrupar dados do Supabase por mês
    const supabaseByMonth = {};

    supabaseData.forEach((inv) => {
      if (!inv.created_at_iugu) return;

      const month = inv.created_at_iugu.substring(0, 7);
      if (!supabaseByMonth[month]) {
        supabaseByMonth[month] = {
          total: 0,
          paid: 0,
          revenue: 0,
          paidRevenue: 0,
        };
      }

      const data = supabaseByMonth[month];
      data.total++;
      data.revenue += inv.total_cents || 0;

      if (inv.status === 'paid') {
        data.paid++;
        data.paidRevenue += inv.paid_cents || inv.total_cents || 0;
      }
    });

    // Comparação período por período
    console.log('📊 COMPARAÇÃO DADOS REAIS vs SUPABASE:');
    console.log('='.repeat(120));
    console.log(
      'Período    | Receita Real     | Receita Supabase | Diferença        | Faturas Real | Faturas Supabase | Diferença'
    );
    console.log('-'.repeat(120));

    let totalDiffRevenue = 0;
    let totalDiffInvoices = 0;
    let periodsAnalyzed = 0;

    Object.keys(REAL_DATA)
      .sort()
      .forEach((period) => {
        const realRevenue = REAL_DATA[period] * 100; // Converter para centavos
        const supabaseRevenue = supabaseByMonth[period]?.paidRevenue || 0;
        const diffRevenue = supabaseRevenue - realRevenue;
        const diffPercentRevenue = realRevenue > 0 ? (diffRevenue / realRevenue) * 100 : 0;

        const realInvoices = REAL_INVOICES[period]?.pagas || 0;
        const supabaseInvoices = supabaseByMonth[period]?.paid || 0;
        const diffInvoices = supabaseInvoices - realInvoices;

        totalDiffRevenue += Math.abs(diffRevenue);
        totalDiffInvoices += Math.abs(diffInvoices);
        periodsAnalyzed++;

        const realRevenueStr = formatCurrency(realRevenue);
        const supabaseRevenueStr = formatCurrency(supabaseRevenue);
        const diffRevenueStr = `${diffRevenue >= 0 ? '+' : ''}${formatCurrency(diffRevenue)} (${diffPercentRevenue >= 0 ? '+' : ''}${formatPercent(diffPercentRevenue)})`;

        console.log(
          `${period}    | ${realRevenueStr.padStart(15)} | ${supabaseRevenueStr.padStart(16)} | ${diffRevenueStr.padStart(16)} | ` +
            `${realInvoices.toString().padStart(12)} | ${supabaseInvoices.toString().padStart(16)} | ${diffInvoices >= 0 ? '+' : ''}${diffInvoices}`
        );
      });

    console.log('-'.repeat(120));

    // Análise de discrepâncias
    console.log('\n🔍 ANÁLISE DE DISCREPÂNCIAS:');
    console.log('='.repeat(35));

    const avgDiffRevenue = totalDiffRevenue / periodsAnalyzed;
    const avgDiffInvoices = totalDiffInvoices / periodsAnalyzed;

    console.log(`💰 Diferença média de receita: ${formatCurrency(avgDiffRevenue)}`);
    console.log(`📄 Diferença média de faturas: ${avgDiffInvoices.toFixed(0)}`);

    // Identificar períodos com maior discrepância
    console.log('\n⚠️  PERÍODOS COM MAIOR DISCREPÂNCIA:');
    const discrepancies = Object.keys(REAL_DATA)
      .map((period) => {
        const realRevenue = REAL_DATA[period] * 100;
        const supabaseRevenue = supabaseByMonth[period]?.paidRevenue || 0;
        const diff = Math.abs(supabaseRevenue - realRevenue);
        const diffPercent = realRevenue > 0 ? (diff / realRevenue) * 100 : 0;

        return { period, diff, diffPercent, realRevenue, supabaseRevenue };
      })
      .sort((a, b) => b.diffPercent - a.diffPercent);

    discrepancies.slice(0, 3).forEach((item, i) => {
      console.log(
        `${i + 1}. ${item.period}: ${formatPercent(item.diffPercent)} de diferença | ` +
          `Real: ${formatCurrency(item.realRevenue)} | Supabase: ${formatCurrency(item.supabaseRevenue)}`
      );
    });

    // Possíveis causas das discrepâncias
    console.log('\n🔧 POSSÍVEIS CAUSAS DAS DISCREPÂNCIAS:');
    console.log('='.repeat(45));

    // Verificar se temos dados incompletos
    const incompleteCount = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&created_at_iugu=gte.2024-12-01&created_at_iugu=lt.2025-09-01&or=(status.is.null,total_cents.is.null)`,
      { Prefer: 'count=exact' }
    );

    console.log(`📊 Faturas com dados incompletos: ${incompleteCount[0]?.count || 0}`);

    if (incompleteCount[0]?.count > 0) {
      console.log('⚠️  1. DADOS INCOMPLETOS: Algumas faturas ainda não têm status/valores');
    }

    // Verificar critérios de pagamento
    const paidWithNullAmount = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&created_at_iugu=gte.2024-12-01&created_at_iugu=lt.2025-09-01&status=eq.paid&paid_cents=is.null`,
      { Prefer: 'count=exact' }
    );

    if (paidWithNullAmount[0]?.count > 0) {
      console.log(
        `⚠️  2. VALORES PAGOS NULOS: ${paidWithNullAmount[0].count} faturas "paid" sem valor pago`
      );
    }

    console.log('💡 3. CRITÉRIOS DIFERENTES: Planilha pode usar critérios de conciliação bancária');
    console.log('💡 4. TIMING: Diferenças entre data de criação vs data de pagamento');
    console.log('💡 5. ESTORNOS/REEMBOLSOS: Podem não estar sendo contabilizados corretamente');

    // Recomendações
    console.log('\n✅ RECOMENDAÇÕES PARA MELHORAR PRECISÃO:');
    console.log('='.repeat(50));
    console.log('1. 🔄 Aguardar conclusão completa do backfill');
    console.log('2. 📅 Analisar por data de pagamento (paid_at) em vez de created_at');
    console.log('3. 💰 Usar paid_cents quando disponível em vez de total_cents');
    console.log('4. 🔍 Implementar lógica de conciliação bancária similar à planilha');
    console.log('5. ⚠️  Considerar estornos e cancelamentos no cálculo');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

validateData();
