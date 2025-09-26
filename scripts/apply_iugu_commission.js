#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

// Dados reais para comparação final
const REAL_DATA = {
  '2025-08': 799490,
  '2025-07': 784646,
  '2025-06': 747538,
  '2025-05': 749793,
  '2025-04': 758793,
  '2025-03': 725383,
  '2025-02': 703920,
  '2025-01': 712846,
  '2024-12': 641019,
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

// Taxas Iugu por método de pagamento (aproximadas)
const IUGU_RATES = {
  iugu_credit_card: 0.037, // 3.7%
  iugu_pix: 0.0099, // 0.99%
  iugu_bank_slip: 0.0179, // 1.79%
  unknown: 0.025, // 2.5% (média)
  default: 0.025, // 2.5% (padrão)
};

async function applyCommissionAndAnalyze() {
  console.log('💰 APLICAÇÃO DE TAXAS IUGU E ANÁLISE FINAL');
  console.log('==========================================');
  console.log(`🕐 ${new Date().toLocaleString()}\n`);

  try {
    // Buscar faturas pagas com método de pagamento
    console.log('🔄 Buscando faturas pagas com dados completos...');
    const paidInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_at,paid_cents,payment_method&status=eq.paid&paid_at=not.is.null&paid_cents=not.is.null&limit=5000`
    );

    console.log(`📊 Faturas pagas analisadas: ${paidInvoices.length.toLocaleString()}\n`);

    // Agrupar por mês de pagamento e calcular receita líquida
    const netRevenueByMonth = {};

    paidInvoices.forEach((inv) => {
      const paidDate = new Date(inv.paid_at);
      const month = `${paidDate.getFullYear()}-${String(paidDate.getMonth() + 1).padStart(2, '0')}`;

      if (!netRevenueByMonth[month]) {
        netRevenueByMonth[month] = {
          count: 0,
          grossRevenue: 0,
          commission: 0,
          netRevenue: 0,
          methodBreakdown: {},
        };
      }

      const data = netRevenueByMonth[month];
      const paidAmount = inv.paid_cents || 0;
      const method = inv.payment_method || 'unknown';
      const rate = IUGU_RATES[method] || IUGU_RATES.default;
      const commission = Math.round(paidAmount * rate);
      const netAmount = paidAmount - commission;

      data.count++;
      data.grossRevenue += paidAmount;
      data.commission += commission;
      data.netRevenue += netAmount;

      // Breakdown por método
      if (!data.methodBreakdown[method]) {
        data.methodBreakdown[method] = { count: 0, gross: 0, commission: 0, net: 0 };
      }
      data.methodBreakdown[method].count++;
      data.methodBreakdown[method].gross += paidAmount;
      data.methodBreakdown[method].commission += commission;
      data.methodBreakdown[method].net += netAmount;
    });

    // Comparação final com dados reais
    console.log('🎯 COMPARAÇÃO FINAL - RECEITA LÍQUIDA:');
    console.log('='.repeat(80));
    console.log(
      'Mês      | Real          | Gross Supabase | Net Supabase   | Diff Gross | Diff Net   |'
    );
    console.log('-'.repeat(80));

    let totalAccuracyGross = 0;
    let totalAccuracyNet = 0;
    let periodsAnalyzed = 0;

    Object.entries(REAL_DATA)
      .sort(([a], [b]) => b.localeCompare(a))
      .forEach(([period, realValue]) => {
        const data = netRevenueByMonth[period];
        if (!data) return;

        const realValueCents = realValue * 100;
        const diffGross = (((data.grossRevenue - realValueCents) / realValueCents) * 100).toFixed(
          1
        );
        const diffNet = (((data.netRevenue - realValueCents) / realValueCents) * 100).toFixed(1);

        const accuracyGross = 100 - Math.abs(parseFloat(diffGross));
        const accuracyNet = 100 - Math.abs(parseFloat(diffNet));

        totalAccuracyGross += accuracyGross;
        totalAccuracyNet += accuracyNet;
        periodsAnalyzed++;

        console.log(
          `${period} | ${formatCurrency(realValueCents).padStart(13)} | ` +
            `${formatCurrency(data.grossRevenue).padStart(14)} | ` +
            `${formatCurrency(data.netRevenue).padStart(14)} | ` +
            `${diffGross >= 0 ? '+' : ''}${diffGross}%`.padStart(10) +
            ' | ' +
            `${diffNet >= 0 ? '+' : ''}${diffNet}%`.padStart(10) +
            ' |'
        );
      });

    console.log('-'.repeat(80));

    // Resumo de precisão
    const avgAccuracyGross = totalAccuracyGross / periodsAnalyzed;
    const avgAccuracyNet = totalAccuracyNet / periodsAnalyzed;

    console.log('\\n📊 RESUMO DE PRECISÃO:');
    console.log('='.repeat(25));
    console.log(`🎯 Precisão média (Receita Bruta): ${avgAccuracyGross.toFixed(1)}%`);
    console.log(`💰 Precisão média (Receita Líquida): ${avgAccuracyNet.toFixed(1)}%`);

    // Melhor convergência
    const bestPeriod = Object.entries(REAL_DATA)
      .map(([period, realValue]) => {
        const data = netRevenueByMonth[period];
        if (!data) return null;

        const realValueCents = realValue * 100;
        const accuracyNet =
          100 - Math.abs(((data.netRevenue - realValueCents) / realValueCents) * 100);

        return { period, accuracyNet, realValue, netRevenue: data.netRevenue };
      })
      .filter(Boolean)
      .reduce((best, current) => (current.accuracyNet > best.accuracyNet ? current : best));

    console.log('\\n🏆 MELHOR CONVERGÊNCIA:');
    console.log(`📅 Período: ${bestPeriod.period}`);
    console.log(`💰 Real: ${formatCurrency(bestPeriod.realValue * 100)}`);
    console.log(`💵 Supabase (Líquida): ${formatCurrency(bestPeriod.netRevenue)}`);
    console.log(`🎯 Precisão: ${bestPeriod.accuracyNet.toFixed(1)}%`);

    // Breakdown de métodos de pagamento
    console.log('\\n💳 BREAKDOWN POR MÉTODO (Agosto 2025):');
    console.log('='.repeat(45));
    const aug2025 = netRevenueByMonth['2025-08'];
    if (aug2025) {
      Object.entries(aug2025.methodBreakdown)
        .sort(([, a], [, b]) => b.gross - a.gross)
        .forEach(([method, data]) => {
          const rate = ((data.commission / data.gross) * 100).toFixed(2);
          console.log(
            `${method.padEnd(20)}: ${data.count.toString().padStart(3)} faturas | ` +
              `${formatCurrency(data.gross).padStart(12)} gross | ` +
              `${formatCurrency(data.net).padStart(12)} net (${rate}% taxa)`
          );
        });
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

applyCommissionAndAnalyze();
