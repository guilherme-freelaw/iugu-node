#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function showRecentData() {
  console.log('📊 DADOS SINCRONIZADOS NO SUPABASE\n');
  console.log('═'.repeat(70));

  // Mostrar faturas recentes
  console.log('\n💰 FATURAS MAIS RECENTES (últimas 10):');
  console.log('─'.repeat(70));

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,total_cents,customer_id,created_at_iugu,updated_at_iugu&order=updated_at_iugu.desc&limit=10`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        }
      }
    );

    if (res.ok) {
      const invoices = await res.json();
      invoices.forEach((inv, i) => {
        const total = (inv.total_cents / 100).toFixed(2);
        const date = inv.updated_at_iugu ? new Date(inv.updated_at_iugu).toLocaleString('pt-BR') : 'N/A';
        console.log(`${i + 1}. ${inv.id.substring(0, 20)}... | R$ ${total} | ${inv.status} | ${date}`);
      });
    } else {
      console.log(`❌ Erro ao buscar faturas: ${res.status}`);
    }
  } catch (error) {
    console.error(`❌ Erro: ${error.message}`);
  }

  // Mostrar clientes recentes
  console.log('\n👥 CLIENTES MAIS RECENTES (últimos 10):');
  console.log('─'.repeat(70));

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/iugu_customers?select=id,name,email,created_at_iugu,updated_at_iugu&order=updated_at_iugu.desc&limit=10`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        }
      }
    );

    if (res.ok) {
      const customers = await res.json();
      customers.forEach((cust, i) => {
        const date = cust.updated_at_iugu ? new Date(cust.updated_at_iugu).toLocaleString('pt-BR') : 'N/A';
        const name = cust.name || '(sem nome)';
        const email = cust.email || '(sem email)';
        console.log(`${i + 1}. ${name.substring(0, 25).padEnd(25)} | ${email.substring(0, 30).padEnd(30)} | ${date}`);
      });
    } else {
      console.log(`❌ Erro ao buscar clientes: ${res.status}`);
    }
  } catch (error) {
    console.error(`❌ Erro: ${error.message}`);
  }

  // Estatísticas gerais
  console.log('\n📈 ESTATÍSTICAS GERAIS:');
  console.log('─'.repeat(70));

  const tables = [
    { name: 'iugu_invoices', label: 'Faturas' },
    { name: 'iugu_customers', label: 'Clientes' },
    { name: 'iugu_plans', label: 'Planos' },
    { name: 'iugu_subscriptions', label: 'Assinaturas' },
    { name: 'iugu_chargebacks', label: 'Chargebacks' }
  ];

  for (const table of tables) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table.name}?select=count`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'count=exact'
        }
      });

      if (res.ok) {
        const count = res.headers.get('content-range');
        const totalCount = count ? count.split('/')[1] : 'N/A';
        console.log(`   ${table.label.padEnd(20)}: ${totalCount.toString().padStart(8)} registros`);
      }
    } catch (error) {
      console.log(`   ${table.label.padEnd(20)}: Erro`);
    }
  }

  console.log('\n' + '═'.repeat(70));
}

showRecentData().catch(console.error);
