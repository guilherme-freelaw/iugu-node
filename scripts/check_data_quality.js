// Check data quality in processed tables using SQL queries
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check_data_quality.js

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function executeSQL(query, description) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.log(`❌ ${description}: ${res.status} ${await res.text()}`);
      return null;
    }

    const result = await res.json();
    return result;
  } catch (err) {
    console.log(`❌ ${description}: ${err.message}`);
    return null;
  }
}

async function checkDataCounts() {
  console.log('📊 Checking data counts in processed tables...\n');

  const queries = [
    {
      query: 'SELECT count(*) as count FROM public.iugu_invoices;',
      description: 'Invoices count',
    },
    {
      query: 'SELECT count(*) as count FROM public.iugu_customers;',
      description: 'Customers count',
    },
    {
      query: 'SELECT count(*) as count FROM public.iugu_subscriptions;',
      description: 'Subscriptions count',
    },
    {
      query: 'SELECT count(*) as count FROM public.iugu_plans;',
      description: 'Plans count',
    },
    {
      query: 'SELECT count(*) as count FROM staging.iugu_batches;',
      description: 'Total batches in staging',
    },
    {
      query: "SELECT count(*) as pending FROM staging.iugu_batches WHERE status = 'pending';",
      description: 'Pending batches',
    },
    {
      query: "SELECT count(*) as done FROM staging.iugu_batches WHERE status = 'done';",
      description: 'Processed batches',
    },
  ];

  for (const { query, description } of queries) {
    const result = await executeSQL(query, description);
    if (result && result.length > 0) {
      const count = result[0].count || result[0].pending || result[0].done || 0;
      console.log(`✅ ${description}: ${count}`);
    }
  }
}

async function checkAugustData() {
  console.log('\n🗓️ Checking August 2025 specific data...\n');

  const queries = [
    {
      query: `
        SELECT count(*) as count 
        FROM public.iugu_invoices 
        WHERE paid_at >= '2025-08-01' AND paid_at < '2025-09-01';
      `,
      description: 'Invoices paid in August 2025',
    },
    {
      query: `
        SELECT count(DISTINCT subscription_id) as count 
        FROM public.iugu_invoices 
        WHERE paid_at >= '2025-08-01' AND paid_at < '2025-09-01' 
        AND subscription_id IS NOT NULL;
      `,
      description: 'Unique subscriptions with paid invoices in August',
    },
    {
      query: `
        SELECT s.status, count(*) as count
        FROM public.iugu_subscriptions s
        JOIN public.iugu_invoices i ON s.id = i.subscription_id
        WHERE i.paid_at >= '2025-08-01' AND i.paid_at < '2025-09-01'
        GROUP BY s.status
        ORDER BY count DESC;
      `,
      description: 'Subscription statuses for August paid invoices',
    },
  ];

  for (const { query, description } of queries) {
    const result = await executeSQL(query, description);
    if (result && result.length > 0) {
      if (description.includes('statuses')) {
        console.log(`✅ ${description}:`);
        result.forEach((row) => {
          console.log(`    ${row.status || 'null'}: ${row.count}`);
        });
      } else {
        const count = result[0].count || 0;
        console.log(`✅ ${description}: ${count}`);
      }
    }
  }
}

async function main() {
  console.log('🔍 Checking data quality and August analysis...\n');

  await checkDataCounts();
  await checkAugustData();

  console.log('\n📝 Summary: Data processing verification complete.');
}

main().catch((err) => {
  console.error('❌ Data quality check failed:', err.message);
  process.exit(1);
});
