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

async function detailedAnalytics() {
  console.log('🔍 ANÁLISE DETALHADA - SETEMBRO 2025');
  console.log('====================================');
  console.log(`🕐 ${new Date().toLocaleString()}\n`);

  try {
    // Faturas de setembro 2025 com todos os detalhes
    const septQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=*&created_at_iugu=gte.2025-09-01&created_at_iugu=lt.2025-10-01&limit=1000`;
    const septInvoices = await makeRequest(septQuery);

    console.log(`📊 Total de faturas em setembro 2025: ${septInvoices.length}`);

    // Análise por status
    const statusAnalysis = {};
    const paymentMethodAnalysis = {};
    let totalRevenue = 0;
    let paidRevenue = 0;

    septInvoices.forEach((inv) => {
      const status = inv.status || 'unknown';
      const method = inv.payment_method || 'unknown';
      const amount = (inv.total_cents || 0) / 100;

      statusAnalysis[status] = statusAnalysis[status] || { count: 0, value: 0 };
      statusAnalysis[status].count++;
      statusAnalysis[status].value += amount;

      paymentMethodAnalysis[method] = paymentMethodAnalysis[method] || { count: 0, value: 0 };
      paymentMethodAnalysis[method].count++;
      paymentMethodAnalysis[method].value += amount;

      totalRevenue += amount;
      if (status === 'paid') {
        paidRevenue += amount;
      }
    });

    console.log('\n💰 ANÁLISE POR STATUS:');
    console.log('-'.repeat(25));
    Object.entries(statusAnalysis)
      .sort(([, a], [, b]) => b.value - a.value)
      .forEach(([status, data]) => {
        const percentage = ((data.count / septInvoices.length) * 100).toFixed(1);
        console.log(
          `  ${status.padEnd(15)}: ${data.count.toString().padStart(4)} faturas | R$ ${data.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }).padStart(12)} (${percentage}%)`
        );
      });

    console.log('\n💳 ANÁLISE POR MÉTODO DE PAGAMENTO:');
    console.log('-'.repeat(40));
    Object.entries(paymentMethodAnalysis)
      .sort(([, a], [, b]) => b.value - a.value)
      .forEach(([method, data]) => {
        if (data.count > 0) {
          const percentage = ((data.count / septInvoices.length) * 100).toFixed(1);
          console.log(
            `  ${method.padEnd(20)}: ${data.count.toString().padStart(4)} faturas | R$ ${data.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }).padStart(12)} (${percentage}%)`
          );
        }
      });

    // Top clientes de setembro
    console.log('\n👑 TOP CLIENTES (Set 2025):');
    console.log('-'.repeat(30));

    const customerRevenue = {};
    septInvoices.forEach((inv) => {
      if (inv.customer_id && inv.status === 'paid') {
        const customerId = inv.customer_id;
        const amount = (inv.total_cents || 0) / 100;
        customerRevenue[customerId] = (customerRevenue[customerId] || 0) + amount;
      }
    });

    Object.entries(customerRevenue)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .forEach(([customerId, revenue], i) => {
        console.log(
          `  ${(i + 1).toString().padStart(2)}. ${customerId.substring(0, 12)}... | R$ ${revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 }).padStart(10)}`
        );
      });

    // Resumo financeiro
    console.log('\n💵 RESUMO FINANCEIRO - SETEMBRO 2025:');
    console.log('-'.repeat(40));
    console.log(
      `  📊 Total faturado: R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(
      `  ✅ Total recebido: R$ ${paidRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );
    console.log(`  📈 Taxa conversão: ${((paidRevenue / totalRevenue) * 100).toFixed(1)}%`);
    console.log(
      `  💰 Ticket médio: R$ ${(totalRevenue / septInvoices.length).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );

    // Análise de assinaturas (baseado na sua consulta original)
    const subscriptionsWithPaidInvoices = new Set();
    septInvoices.forEach((inv) => {
      if (inv.subscription_id && inv.status === 'paid') {
        subscriptionsWithPaidInvoices.add(inv.subscription_id);
      }
    });

    console.log('\n📋 ASSINATURAS ATIVAS (Set 2025):');
    console.log('-'.repeat(35));
    console.log(`  🎯 Assinaturas com faturas pagas: ${subscriptionsWithPaidInvoices.size}`);
    console.log(
      `  📊 Total de faturas pagas: ${septInvoices.filter((inv) => inv.status === 'paid').length}`
    );
    console.log(
      `  💡 Média faturas/assinatura: ${(septInvoices.filter((inv) => inv.status === 'paid').length / subscriptionsWithPaidInvoices.size).toFixed(1)}`
    );
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

detailedAnalytics();
