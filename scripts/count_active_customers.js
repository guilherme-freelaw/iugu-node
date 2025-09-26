#!/usr/bin/env node

const https = require('https');

// Configurações
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

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

    if (options.body) {
      req.write(options.body);
    }

    req.on('error', reject);
    req.end();
  });
}

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

async function countActiveCustomers() {
  logWithTimestamp('👥 CONTAGEM DE CLIENTES ATIVOS');
  console.log('=====================================');

  try {
    // 1. Total de clientes cadastrados
    const totalCustomersQuery = `${SUPABASE_URL}/rest/v1/iugu_customers?select=count`;
    const totalCustomers = await makeRequest(totalCustomersQuery, {
      method: 'GET',
      headers: { ...supabaseHeaders, Prefer: 'count=exact' },
    });

    console.log(`📊 Total de clientes cadastrados: ${totalCustomers.length || 0}`);

    // 2. Clientes com assinaturas (não suspensas)
    const activeSubscriptionsQuery = `${SUPABASE_URL}/rest/v1/iugu_subscriptions?select=customer_id&suspended=eq.false`;
    const activeSubscriptions = await makeRequest(activeSubscriptionsQuery, {
      method: 'GET',
      headers: supabaseHeaders,
    });

    const uniqueActiveCustomers = [...new Set(activeSubscriptions.map((sub) => sub.customer_id))];
    console.log(`💰 Clientes com assinaturas não suspensas: ${uniqueActiveCustomers.length}`);

    // 3. Clientes que fizeram pagamento nos últimos 90 dias
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 90);
    const recentDateStr = recentDate.toISOString();

    const recentPayersQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=customer_id&status=eq.paid&paid_at=gte.${recentDateStr}`;
    const recentPayers = await makeRequest(recentPayersQuery, {
      method: 'GET',
      headers: supabaseHeaders,
    });

    const uniqueRecentPayers = [
      ...new Set(recentPayers.map((inv) => inv.customer_id).filter((id) => id)),
    ];
    console.log(`💳 Clientes com pagamentos (últimos 90 dias): ${uniqueRecentPayers.length}`);

    // 4. Clientes que fizeram pagamento nos últimos 30 dias
    const recent30Date = new Date();
    recent30Date.setDate(recent30Date.getDate() - 30);
    const recent30DateStr = recent30Date.toISOString();

    const recent30PayersQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=customer_id&status=eq.paid&paid_at=gte.${recent30DateStr}`;
    const recent30Payers = await makeRequest(recent30PayersQuery, {
      method: 'GET',
      headers: supabaseHeaders,
    });

    const uniqueRecent30Payers = [
      ...new Set(recent30Payers.map((inv) => inv.customer_id).filter((id) => id)),
    ];
    console.log(`🔥 Clientes com pagamentos (últimos 30 dias): ${uniqueRecent30Payers.length}`);

    // 5. Análise detalhada por mês atual
    const currentMonth = new Date();
    const startOfMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      1
    ).toISOString();
    const endOfMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1,
      0,
      23,
      59,
      59
    ).toISOString();

    const currentMonthPayersQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=customer_id,paid_cents&status=eq.paid&paid_at=gte.${startOfMonth}&paid_at=lte.${endOfMonth}`;
    const currentMonthPayers = await makeRequest(currentMonthPayersQuery, {
      method: 'GET',
      headers: supabaseHeaders,
    });

    const uniqueCurrentMonthPayers = [
      ...new Set(currentMonthPayers.map((inv) => inv.customer_id).filter((id) => id)),
    ];
    const currentMonthRevenue =
      currentMonthPayers.reduce((sum, inv) => sum + (inv.paid_cents || 0), 0) / 100;

    console.log(
      `📅 Clientes que pagaram em ${currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}: ${uniqueCurrentMonthPayers.length}`
    );
    console.log(
      `💰 Receita do mês atual: R$ ${currentMonthRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    );

    // 6. Top 10 clientes por valor pago (últimos 90 dias)
    const recentPayersWithAmountQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=customer_id,paid_cents&status=eq.paid&paid_at=gte.${recentDateStr}`;
    const recentPayersWithAmount = await makeRequest(recentPayersWithAmountQuery, {
      method: 'GET',
      headers: supabaseHeaders,
    });

    const customerRevenueMap = {};
    recentPayersWithAmount.forEach((inv) => {
      if (inv.customer_id) {
        customerRevenueMap[inv.customer_id] =
          (customerRevenueMap[inv.customer_id] || 0) + (inv.paid_cents || 0);
      }
    });

    const topCustomers = Object.entries(customerRevenueMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    console.log('\n🏆 TOP 10 CLIENTES (últimos 90 dias):');
    console.log('====================================');
    for (let i = 0; i < topCustomers.length; i++) {
      const [customerId, totalCents] = topCustomers[i];
      const totalValue = totalCents / 100;
      console.log(
        `${i + 1}. ${customerId.substring(0, 8)}... - R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      );
    }

    // 7. Resumo final
    console.log('\n📊 RESUMO DE CLIENTES ATIVOS:');
    console.log('=============================');
    console.log(`👥 Total cadastrados: ${totalCustomers.length || 0}`);
    console.log(`💰 Com assinaturas não suspensas: ${uniqueActiveCustomers.length}`);
    console.log(`💳 Pagaram nos últimos 90 dias: ${uniqueRecentPayers.length}`);
    console.log(`🔥 Pagaram nos últimos 30 dias: ${uniqueRecent30Payers.length}`);
    console.log(`📅 Pagaram no mês atual: ${uniqueCurrentMonthPayers.length}`);

    // Determinar definição de "ativo"
    const activeDefinition = Math.max(uniqueActiveCustomers.length, uniqueRecent30Payers.length);
    console.log(`\n🎯 CLIENTES ATIVOS (estimativa): ${activeDefinition}`);
    console.log('   (baseado em assinaturas não suspensas OU pagamentos recentes)');

    logWithTimestamp('✅ Contagem de clientes ativos concluída!');
  } catch (error) {
    logWithTimestamp(`❌ Erro: ${error.message}`);
    process.exit(1);
  }
}

countActiveCustomers();
