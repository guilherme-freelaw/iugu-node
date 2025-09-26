// Monitor and process script - checks status and processes batches
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/monitor_and_process.js

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function getTableCounts() {
  try {
    // Get customers count
    const customersRes = await fetch(`${SUPABASE_URL}/rest/v1/iugu_customers?select=count`, {
      headers: { ...headers, Prefer: 'count=exact' },
    });
    const customers = customersRes.ok ? (await customersRes.json())[0]?.count || 0 : 0;

    // Get invoices count
    const invoicesRes = await fetch(`${SUPABASE_URL}/rest/v1/iugu_invoices?select=count`, {
      headers: { ...headers, Prefer: 'count=exact' },
    });
    const invoices = invoicesRes.ok ? (await invoicesRes.json())[0]?.count || 0 : 0;

    // Get subscriptions count
    const subscriptionsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/iugu_subscriptions?select=count`,
      {
        headers: { ...headers, Prefer: 'count=exact' },
      }
    );
    const subscriptions = subscriptionsRes.ok ? (await subscriptionsRes.json())[0]?.count || 0 : 0;

    // Get plans count
    const plansRes = await fetch(`${SUPABASE_URL}/rest/v1/iugu_plans?select=count`, {
      headers: { ...headers, Prefer: 'count=exact' },
    });
    const plans = plansRes.ok ? (await plansRes.json())[0]?.count || 0 : 0;

    return { customers, invoices, subscriptions, plans };
  } catch (err) {
    console.warn('Error getting table counts:', err.message);
    return { customers: 0, invoices: 0, subscriptions: 0, plans: 0 };
  }
}

async function processOneBatch() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_staging_batches_direct`, {
      method: 'POST',
      headers,
      body: '{}',
    });

    if (!res.ok) {
      console.warn(`❌ Process failed: ${res.status} - ${await res.text()}`);
      return null;
    }

    const result = await res.json();
    return (
      result[0] || {
        batches_processed: 0,
        customers_inserted: 0,
        invoices_inserted: 0,
        errors_count: 0,
      }
    );
  } catch (err) {
    console.warn('❌ Error processing batch:', err.message);
    return null;
  }
}

async function main() {
  console.log('🚀 MONITORING AND PROCESSING');
  console.log('============================');
  console.log(`📅 Started at: ${new Date().toLocaleString()}\n`);

  const MAX_CYCLES = parseInt(process.env.MAX_CYCLES || '20', 10);
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '3000', 10);

  let cycle = 0;
  let totalBatchesProcessed = 0;
  let totalCustomersInserted = 0;
  let totalInvoicesInserted = 0;

  while (cycle < MAX_CYCLES) {
    console.log(`\n🔄 Cycle ${cycle + 1}/${MAX_CYCLES}`);
    console.log('─'.repeat(40));

    // Get current status
    const counts = await getTableCounts();
    console.log(`📊 Current data:`);
    console.log(`   👥 Customers: ${counts.customers.toLocaleString()}`);
    console.log(`   🧾 Invoices: ${counts.invoices.toLocaleString()}`);
    console.log(`   📋 Subscriptions: ${counts.subscriptions.toLocaleString()}`);
    console.log(`   📦 Plans: ${counts.plans.toLocaleString()}`);

    // Try to process one batch
    console.log(`\n🔄 Processing next batch...`);
    const result = await processOneBatch();

    if (result === null) {
      console.log('❌ Could not process batch (possibly no more pending)');
    } else if (result.batches_processed === 0) {
      console.log('✅ No more pending batches to process');
      break;
    } else {
      console.log(`✅ Batch processed:`);
      console.log(`   📦 Batches: ${result.batches_processed}`);
      console.log(`   👥 Customers: ${result.customers_inserted}`);
      console.log(`   🧾 Invoices: ${result.invoices_inserted}`);
      console.log(`   ❌ Errors: ${result.errors_count}`);

      totalBatchesProcessed += result.batches_processed;
      totalCustomersInserted += result.customers_inserted;
      totalInvoicesInserted += result.invoices_inserted;
    }

    cycle++;

    // Pause between cycles
    console.log(`\n⏱️  Pausing for ${PAUSE_MS}ms...`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log('\n🎉 PROCESSING COMPLETE!');
  console.log('======================');
  console.log(`📦 Total batches processed: ${totalBatchesProcessed}`);
  console.log(`👥 Total customers inserted: ${totalCustomersInserted}`);
  console.log(`🧾 Total invoices inserted: ${totalInvoicesInserted}`);
  console.log(`🔄 Cycles completed: ${cycle}`);
  console.log(`📅 Finished at: ${new Date().toLocaleString()}`);

  // Final status check
  console.log('\n📊 FINAL STATUS:');
  const finalCounts = await getTableCounts();
  console.log(`👥 Customers: ${finalCounts.customers.toLocaleString()}`);
  console.log(`🧾 Invoices: ${finalCounts.invoices.toLocaleString()}`);
  console.log(`📋 Subscriptions: ${finalCounts.subscriptions.toLocaleString()}`);
  console.log(`📦 Plans: ${finalCounts.plans.toLocaleString()}`);
}

main().catch((err) => {
  console.error('💥 Processing failed:', err.message);
  process.exit(1);
});
