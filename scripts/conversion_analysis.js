#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

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

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function formatCurrency(cents) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

async function conversionAnalysis() {
  console.log('📊 ANÁLISE DE CONVERSÃO POR PERÍODO');
  console.log('===================================');
  console.log(`🕐 ${new Date().toLocaleString()}\n`);

  try {
    // Buscar todas as faturas com data de criação
    console.log('🔄 Carregando dados...');
    const allInvoicesQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=created_at_iugu,status,total_cents&limit=20000&order=created_at_iugu.desc`;
    const allInvoices = await makeRequest(allInvoicesQuery);

    console.log(`📊 Analisando ${allInvoices.length} faturas com data válida\n`);

    // Agrupar por ano-mês
    const periodAnalysis = {};

    allInvoices.forEach((invoice) => {
      if (!invoice.created_at_iugu) return;

      const date = new Date(invoice.created_at_iugu);
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!periodAnalysis[yearMonth]) {
        periodAnalysis[yearMonth] = {
          total: 0,
          paid: 0,
          pending: 0,
          canceled: 0,
          refunded: 0,
          unknown: 0,
          totalValue: 0,
          paidValue: 0,
          pendingValue: 0,
        };
      }

      const period = periodAnalysis[yearMonth];
      const amount = invoice.total_cents || 0;
      const status = invoice.status || 'unknown';

      period.total++;
      period.totalValue += amount;

      switch (status) {
        case 'paid':
          period.paid++;
          period.paidValue += amount;
          break;
        case 'pending':
          period.pending++;
          period.pendingValue += amount;
          break;
        case 'canceled':
          period.canceled++;
          break;
        case 'refunded':
          period.refunded++;
          break;
        default:
          period.unknown++;
          break;
      }
    });

    // Ordenar períodos por data (mais recente primeiro)
    const sortedPeriods = Object.entries(periodAnalysis).sort(([a], [b]) => b.localeCompare(a));

    console.log('📈 TAXA DE CONVERSÃO POR PERÍODO:');
    console.log('='.repeat(80));
    console.log('Período    | Total | Pagas | Pendentes | Cancel. | Taxa Conv. | Valor Pago     ');
    console.log('-'.repeat(80));

    let totalInvoices = 0;
    let totalPaid = 0;
    let totalPaidValue = 0;
    let totalValue = 0;

    sortedPeriods.forEach(([period, data]) => {
      const conversionRate = data.total > 0 ? (data.paid / data.total) * 100 : 0;
      const pendingRate = data.total > 0 ? (data.pending / data.total) * 100 : 0;
      const canceledRate = data.total > 0 ? (data.canceled / data.total) * 100 : 0;

      totalInvoices += data.total;
      totalPaid += data.paid;
      totalPaidValue += data.paidValue;
      totalValue += data.totalValue;

      console.log(
        `${period}    | ${data.total.toString().padStart(5)} | ` +
          `${data.paid.toString().padStart(5)} | ` +
          `${data.pending.toString().padStart(9)} | ` +
          `${data.canceled.toString().padStart(7)} | ` +
          `${formatPercent(conversionRate).padStart(10)} | ` +
          `${formatCurrency(data.paidValue).padStart(14)}`
      );
    });

    console.log('-'.repeat(80));

    // Resumo geral
    const overallConversion = totalInvoices > 0 ? (totalPaid / totalInvoices) * 100 : 0;
    console.log(
      `TOTAL      | ${totalInvoices.toString().padStart(5)} | ` +
        `${totalPaid.toString().padStart(5)} | ` +
        `${(totalInvoices - totalPaid).toString().padStart(9)} | ` +
        `${''.padStart(7)} | ` +
        `${formatPercent(overallConversion).padStart(10)} | ` +
        `${formatCurrency(totalPaidValue).padStart(14)}`
    );

    console.log('\n📊 RESUMO EXECUTIVO:');
    console.log('='.repeat(30));
    console.log(`📈 Taxa de conversão geral: ${formatPercent(overallConversion)}`);
    console.log(`💰 Receita total: ${formatCurrency(totalPaidValue)}`);
    console.log(`📄 Total de faturas: ${totalInvoices.toLocaleString()}`);
    console.log(`✅ Faturas pagas: ${totalPaid.toLocaleString()}`);
    console.log(`💵 Ticket médio: ${formatCurrency(totalPaidValue / totalPaid)}`);

    // Análise de tendências
    console.log('\n📈 ANÁLISE DE TENDÊNCIAS:');
    console.log('='.repeat(35));

    const recentPeriods = sortedPeriods.slice(0, 6); // Últimos 6 meses
    const olderPeriods = sortedPeriods.slice(6, 12); // 6 meses anteriores

    if (recentPeriods.length > 0 && olderPeriods.length > 0) {
      const recentConversion =
        recentPeriods.reduce((sum, [, data]) => {
          return sum + (data.total > 0 ? (data.paid / data.total) * 100 : 0);
        }, 0) / recentPeriods.length;

      const olderConversion =
        olderPeriods.reduce((sum, [, data]) => {
          return sum + (data.total > 0 ? (data.paid / data.total) * 100 : 0);
        }, 0) / olderPeriods.length;

      const trend = recentConversion - olderConversion;
      const trendIcon = trend > 0 ? '📈' : trend < 0 ? '📉' : '➡️';

      console.log(`${trendIcon} Conversão últimos 6 meses: ${formatPercent(recentConversion)}`);
      console.log(`📊 Conversão 6 meses anteriores: ${formatPercent(olderConversion)}`);
      console.log(`🔄 Variação: ${trend > 0 ? '+' : ''}${formatPercent(trend)}`);
    }

    // Melhores e piores períodos
    const bestPeriod = sortedPeriods
      .filter(([, data]) => data.total >= 10) // Mínimo de 10 faturas
      .reduce(
        (best, [period, data]) => {
          const rate = (data.paid / data.total) * 100;
          return rate > best.rate ? { period, rate, data } : best;
        },
        { period: '', rate: 0, data: null }
      );

    const worstPeriod = sortedPeriods
      .filter(([, data]) => data.total >= 10)
      .reduce(
        (worst, [period, data]) => {
          const rate = (data.paid / data.total) * 100;
          return rate < worst.rate ? { period, rate, data } : worst;
        },
        { period: '', rate: 100, data: null }
      );

    if (bestPeriod.period && worstPeriod.period) {
      console.log('\n🏆 PERFORMANCE DESTAQUE:');
      console.log('='.repeat(25));
      console.log(`🥇 Melhor período: ${bestPeriod.period} (${formatPercent(bestPeriod.rate)})`);
      console.log(`🥉 Pior período: ${worstPeriod.period} (${formatPercent(worstPeriod.rate)})`);
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

conversionAnalysis();
