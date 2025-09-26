#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

// Dados reais da planilha
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

async function fetchAllInvoices() {
  console.log('🔄 Buscando TODAS as faturas do período...');

  let allInvoices = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=created_at_iugu,paid_at,status,total_cents,paid_cents,commission_cents&created_at_iugu=gte.2024-12-01&created_at_iugu=lt.2025-09-01&status=not.is.null&total_cents=not.is.null&limit=${limit}&offset=${offset}`;

    const batch = await makeRequest(url);

    if (batch.length === 0) break;

    allInvoices = allInvoices.concat(batch);
    offset += limit;

    console.log(`📊 Carregadas: ${allInvoices.length} faturas...`);

    if (batch.length < limit) break; // Última página
  }

  return allInvoices;
}

async function finalValidation() {
  console.log('🔍 VALIDAÇÃO FINAL - DADOS COMPLETOS');
  console.log('=====================================');
  console.log(`🕐 ${new Date().toLocaleString()}\n`);

  try {
    // 1. Status geral do banco
    console.log('📊 STATUS GERAL DO BANCO:');
    const totalCount = await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_invoices?select=count`, {
      Prefer: 'count=exact',
    });
    console.log(`Total de faturas no banco: ${totalCount[0]?.count?.toLocaleString() || 'N/A'}`);

    // 2. Buscar todas as faturas do período
    const allInvoices = await fetchAllInvoices();
    console.log(`📋 Faturas analisadas: ${allInvoices.length.toLocaleString()}\n`);

    // 3. Análise por created_at (critério atual)
    console.log('📅 ANÁLISE POR DATA DE CRIAÇÃO (created_at):');
    console.log('='.repeat(70));

    const byCreatedMonth = {};
    allInvoices.forEach((inv) => {
      if (!inv.created_at_iugu) return;

      const month = inv.created_at_iugu.substring(0, 7);
      if (!byCreatedMonth[month]) {
        byCreatedMonth[month] = { total: 0, paid: 0, revenue: 0 };
      }

      byCreatedMonth[month].total++;
      if (inv.status === 'paid') {
        byCreatedMonth[month].paid++;
        byCreatedMonth[month].revenue += inv.paid_cents || inv.total_cents || 0;
      }
    });

    Object.entries(REAL_DATA)
      .sort()
      .forEach(([period, realRevenue]) => {
        const supabaseData = byCreatedMonth[period] || { total: 0, paid: 0, revenue: 0 };
        const realInvoices = REAL_INVOICES[period]?.pagas || 0;

        const realRevenueFormatted = formatCurrency(realRevenue * 100);
        const supabaseRevenueFormatted = formatCurrency(supabaseData.revenue);
        const diff = (((supabaseData.revenue / 100 - realRevenue) / realRevenue) * 100).toFixed(1);

        console.log(
          `${period}: Real=${realRevenueFormatted} | Supabase=${supabaseRevenueFormatted} | ` +
            `Diff=${diff}% | Faturas Real=${realInvoices} Supabase=${supabaseData.paid}`
        );
      });

    // 4. Análise por paid_at (se disponível)
    console.log('\\n📅 ANÁLISE POR DATA DE PAGAMENTO (paid_at):');
    console.log('='.repeat(70));

    const withPaidAt = allInvoices.filter((inv) => inv.paid_at && inv.status === 'paid');
    console.log(
      `Faturas com paid_at: ${withPaidAt.length} de ${allInvoices.filter((inv) => inv.status === 'paid').length} pagas`
    );

    if (withPaidAt.length > 100) {
      const byPaidMonth = {};
      withPaidAt.forEach((inv) => {
        const paidDate = new Date(inv.paid_at);
        const month = `${paidDate.getFullYear()}-${String(paidDate.getMonth() + 1).padStart(2, '0')}`;

        if (!byPaidMonth[month]) {
          byPaidMonth[month] = { count: 0, revenue: 0 };
        }

        byPaidMonth[month].count++;
        byPaidMonth[month].revenue += inv.paid_cents || inv.total_cents || 0;
      });

      console.log('Top meses por data de pagamento:');
      Object.entries(byPaidMonth)
        .sort(([, a], [, b]) => b.revenue - a.revenue)
        .slice(0, 10)
        .forEach(([month, data]) => {
          console.log(`  ${month}: ${data.count} faturas | ${formatCurrency(data.revenue)}`);
        });
    } else {
      console.log('❌ Dados de paid_at insuficientes para análise');
    }

    // 5. Detectar problemas específicos
    console.log('\\n🔍 DIAGNÓSTICO DE PROBLEMAS:');
    console.log('='.repeat(35));

    const withoutPaidAt = allInvoices.filter((inv) => inv.status === 'paid' && !inv.paid_at).length;
    const withoutPaidCents = allInvoices.filter(
      (inv) => inv.status === 'paid' && !inv.paid_cents
    ).length;
    const withoutCommission = allInvoices.filter(
      (inv) => inv.status === 'paid' && !inv.commission_cents
    ).length;

    console.log(`❌ Faturas pagas sem paid_at: ${withoutPaidAt}`);
    console.log(`❌ Faturas pagas sem paid_cents: ${withoutPaidCents}`);
    console.log(`❌ Faturas pagas sem commission_cents: ${withoutCommission}`);

    // 6. Comparação com maior período disponível
    const bestPeriod = Object.entries(byCreatedMonth)
      .filter(([period]) => REAL_DATA[period])
      .reduce(
        (best, [period, data]) => {
          const realRevenue = REAL_DATA[period] * 100;
          const accuracy = Math.abs(data.revenue - realRevenue) / realRevenue;
          return accuracy < best.accuracy ? { period, accuracy, data } : best;
        },
        { accuracy: Infinity }
      );

    if (bestPeriod.period) {
      console.log('\\n🎯 MELHOR CONVERGÊNCIA:');
      const real = REAL_DATA[bestPeriod.period] * 100;
      const diff = (((bestPeriod.data.revenue - real) / real) * 100).toFixed(1);
      console.log(`Período: ${bestPeriod.period}`);
      console.log(
        `Real: ${formatCurrency(real)} | Supabase: ${formatCurrency(bestPeriod.data.revenue)}`
      );
      console.log(
        `Precisão: ${(100 - bestPeriod.accuracy * 100).toFixed(1)}% | Diferença: ${diff}%`
      );
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

finalValidation();
