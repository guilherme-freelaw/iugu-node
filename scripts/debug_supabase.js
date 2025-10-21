#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function checkSupabase() {
  console.log('🔍 Verificando estado do Supabase...\n');

  // 1. Verificar tabelas existentes
  console.log('1️⃣ Verificando tabelas...');
  try {
    const tables = ['iugu_invoices', 'iugu_customers', 'iugu_plans'];

    for (const table of tables) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=5`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        }
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`   ✅ ${table}: ${data.length} registros (amostra)`);
      } else {
        const error = await res.text();
        console.log(`   ❌ ${table}: ${res.status} - ${error.substring(0, 100)}`);
      }
    }
  } catch (error) {
    console.error(`   ❌ Erro: ${error.message}`);
  }

  console.log('\n2️⃣ Testando RPCs...');

  // 2. Testar RPC de invoice
  try {
    const testInvoice = {
      id: 'test_invoice_' + Date.now(),
      status: 'pending',
      total_cents: 1000,
      paid_cents: 0,
      customer_id: 'test_customer',
      created_at_iugu: new Date().toISOString()
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_invoice_from_payload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ payload: testInvoice })
    });

    if (res.ok) {
      console.log('   ✅ RPC upsert_invoice_from_payload: OK');
    } else {
      const error = await res.text();
      console.log(`   ❌ RPC upsert_invoice_from_payload: ${res.status} - ${error.substring(0, 200)}`);
    }
  } catch (error) {
    console.error(`   ❌ Erro no RPC: ${error.message}`);
  }

  // 3. Testar RPC de customer
  try {
    const testCustomer = {
      id: 'test_customer_' + Date.now(),
      name: 'Test Customer',
      email: 'test@example.com',
      created_at_iugu: new Date().toISOString()
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_customer_from_payload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ payload: testCustomer })
    });

    if (res.ok) {
      console.log('   ✅ RPC upsert_customer_from_payload: OK');
    } else {
      const error = await res.text();
      console.log(`   ❌ RPC upsert_customer_from_payload: ${res.status} - ${error.substring(0, 200)}`);
    }
  } catch (error) {
    console.error(`   ❌ Erro no RPC: ${error.message}`);
  }

  console.log('\n3️⃣ Contando registros totais...');

  // 4. Contar registros
  try {
    const tables = ['iugu_invoices', 'iugu_customers', 'iugu_plans'];

    for (const table of tables) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=count`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'count=exact'
        }
      });

      if (res.ok) {
        const count = res.headers.get('content-range');
        console.log(`   📊 ${table}: ${count || 'N/A'}`);
      } else {
        console.log(`   ❌ ${table}: ${res.status}`);
      }
    }
  } catch (error) {
    console.error(`   ❌ Erro: ${error.message}`);
  }
}

checkSupabase().catch(console.error);
