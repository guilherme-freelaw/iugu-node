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

function formatCurrency(cents) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

async function revenue2025Analysis() {
  console.log('💰 ANÁLISE DE FATURAMENTO - 2025');
  console.log('=================================');
  console.log(`🕐 ${new Date().toLocaleString()}\n`);

  try {
    // Buscar todas as faturas de 2025 com detalhes financeiros
    console.log('🔄 Carregando dados de 2025...');
    const query2025 = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=created_at_iugu,status,total_cents,paid_cents,payment_method&created_at_iugu=gte.2025-01-01&created_at_iugu=lt.2026-01-01&limit=2000`;
    const invoices2025 = await makeRequest(query2025);

    console.log(`📊 Total de faturas 2025: ${invoices2025.length}\n`);

    // Agrupar por mês
    const monthlyRevenue = {};

    invoices2025.forEach((inv) => {
      if (!inv.created_at_iugu) return;

      const date = new Date(inv.created_at_iugu);
      const month = `2025-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

      if (!monthlyRevenue[month]) {
        monthlyRevenue[month] = {
          name: monthName,
          total: 0,
          paid: 0,
          pending: 0,
          canceled: 0,
          refunded: 0,
          totalRevenue: 0,
          paidRevenue: 0,
          pendingRevenue: 0,
          avgTicket: 0,
          paymentMethods: {},
        };
      }

      const data = monthlyRevenue[month];
      const totalAmount = inv.total_cents || 0;
      const paidAmount = inv.paid_cents || 0;
      const status = inv.status || 'unknown';
      const method = inv.payment_method || 'unknown';

      data.total++;
      data.totalRevenue += totalAmount;

      // Agrupar métodos de pagamento
      if (!data.paymentMethods[method]) {
        data.paymentMethods[method] = { count: 0, revenue: 0 };
      }
      data.paymentMethods[method].count++;
      data.paymentMethods[method].revenue += totalAmount;

      switch (status) {
        case 'paid':
          data.paid++;
          data.paidRevenue += paidAmount || totalAmount;
          break;
        case 'pending':
          data.pending++;
          data.pendingRevenue += totalAmount;
          break;
        case 'canceled':
          data.canceled++;
          break;
        case 'refunded':
          data.refunded++;
          break;
      }

      data.avgTicket = data.total > 0 ? data.totalRevenue / data.total : 0;
    });

    // Ordenar meses
    const sortedMonths = Object.keys(monthlyRevenue).sort();

    console.log('💰 FATURAMENTO MENSAL - 2025:');
    console.log('='.repeat(120));
    console.log(
      'Mês         | Total Fat. | Pagas | Receita Confirmada   | Receita Pendente    | Conv.% | Ticket Médio  '
    );
    console.log('-'.repeat(120));

    let totalYearInvoices = 0;
    let totalYearPaid = 0;
    let totalYearRevenue = 0;
    let totalYearPaidRevenue = 0;
    let totalYearPending = 0;

    sortedMonths.forEach((month) => {
      const data = monthlyRevenue[month];
      const conversionRate = data.total > 0 ? ((data.paid / data.total) * 100).toFixed(1) : '0.0';

      totalYearInvoices += data.total;
      totalYearPaid += data.paid;
      totalYearRevenue += data.totalRevenue;
      totalYearPaidRevenue += data.paidRevenue;
      totalYearPending += data.pendingRevenue;

      console.log(
        `${data.name.substring(0, 11).padEnd(11)} | ` +
          `${data.total.toString().padStart(10)} | ` +
          `${data.paid.toString().padStart(5)} | ` +
          `${formatCurrency(data.paidRevenue).padStart(19)} | ` +
          `${formatCurrency(data.pendingRevenue).padStart(18)} | ` +
          `${conversionRate.padStart(5)}% | ` +
          `${formatCurrency(data.avgTicket).padStart(13)}`
      );
    });

    console.log('-'.repeat(120));
    const overallConv =
      totalYearInvoices > 0 ? ((totalYearPaid / totalYearInvoices) * 100).toFixed(1) : '0.0';
    const overallAvgTicket = totalYearInvoices > 0 ? totalYearRevenue / totalYearInvoices : 0;

    console.log(
      `${'TOTAL 2025'.padEnd(11)} | ` +
        `${totalYearInvoices.toString().padStart(10)} | ` +
        `${totalYearPaid.toString().padStart(5)} | ` +
        `${formatCurrency(totalYearPaidRevenue).padStart(19)} | ` +
        `${formatCurrency(totalYearPending).padStart(18)} | ` +
        `${overallConv.padStart(5)}% | ` +
        `${formatCurrency(overallAvgTicket).padStart(13)}`
    );

    // Análise detalhada por método de pagamento
    console.log('\n💳 ANÁLISE POR MÉTODO DE PAGAMENTO - 2025:');
    console.log('='.repeat(60));

    const allPaymentMethods = {};
    sortedMonths.forEach((month) => {
      const data = monthlyRevenue[month];
      Object.entries(data.paymentMethods).forEach(([method, methodData]) => {
        if (!allPaymentMethods[method]) {
          allPaymentMethods[method] = { count: 0, revenue: 0 };
        }
        allPaymentMethods[method].count += methodData.count;
        allPaymentMethods[method].revenue += methodData.revenue;
      });
    });

    Object.entries(allPaymentMethods)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .forEach(([method, data]) => {
        const percentage = ((data.count / totalYearInvoices) * 100).toFixed(1);
        const avgValue = data.count > 0 ? data.revenue / data.count : 0;
        console.log(
          `${method.padEnd(20)}: ${data.count.toString().padStart(4)} faturas (${percentage.padStart(5)}%) | ` +
            `${formatCurrency(data.revenue).padStart(15)} | Média: ${formatCurrency(avgValue)}`
        );
      });

    // Projeções e insights
    console.log('\n📈 INSIGHTS E PROJEÇÕES:');
    console.log('='.repeat(35));

    // Calcular médias mensais
    const monthsWithData = sortedMonths.length;
    const avgMonthlyRevenue = monthsWithData > 0 ? totalYearPaidRevenue / monthsWithData : 0;
    const avgMonthlyInvoices = monthsWithData > 0 ? totalYearInvoices / monthsWithData : 0;

    console.log(`📊 Receita média mensal: ${formatCurrency(avgMonthlyRevenue)}`);
    console.log(`📄 Faturas médias/mês: ${avgMonthlyInvoices.toFixed(0)}`);
    console.log(`💰 Ticket médio geral: ${formatCurrency(overallAvgTicket)}`);
    console.log(`📈 Taxa conversão média: ${overallConv}%`);

    // Projeção anual (se temos dados parciais)
    if (monthsWithData < 12) {
      const projectedAnnualRevenue = avgMonthlyRevenue * 12;
      const projectedAnnualInvoices = avgMonthlyInvoices * 12;

      console.log('\n🔮 PROJEÇÃO ANUAL (baseada na média):');
      console.log(`💰 Receita projetada 2025: ${formatCurrency(projectedAnnualRevenue)}`);
      console.log(`📄 Faturas projetadas 2025: ${projectedAnnualInvoices.toFixed(0)}`);
    }

    // Melhor e pior mês
    if (sortedMonths.length > 1) {
      const bestMonth = sortedMonths.reduce((best, month) => {
        return monthlyRevenue[month].paidRevenue > monthlyRevenue[best].paidRevenue ? month : best;
      });

      const worstMonth = sortedMonths.reduce((worst, month) => {
        return monthlyRevenue[month].paidRevenue < monthlyRevenue[worst].paidRevenue
          ? month
          : worst;
      });

      console.log('\n🏆 PERFORMANCE DESTAQUE:');
      console.log(
        `🥇 Melhor mês: ${monthlyRevenue[bestMonth].name} - ${formatCurrency(monthlyRevenue[bestMonth].paidRevenue)}`
      );
      console.log(
        `📉 Menor mês: ${monthlyRevenue[worstMonth].name} - ${formatCurrency(monthlyRevenue[worstMonth].paidRevenue)}`
      );
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

revenue2025Analysis();
