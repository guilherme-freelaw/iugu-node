// Process all pending batches from staging to public tables
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/process_all_batches.js

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

async function processNextBatch() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_next_iugu_batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`❌ Error processing batch: ${res.status} ${errorText}`);
      return null;
    }

    const batchId = await res.text();
    return batchId === '0' ? null : parseInt(batchId);
  } catch (err) {
    console.error('❌ Network error processing batch:', err.message);
    return null;
  }
}

async function checkDataCounts() {
  try {
    console.log('\n📊 Checking data counts in public tables...');

    const tables = [
      'iugu_customers',
      'iugu_invoices',
      'iugu_subscriptions',
      'iugu_plans',
      'iugu_payment_methods',
    ];

    for (const table of tables) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        });

        if (res.ok) {
          const countRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=count()`, {
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              Prefer: 'count=exact',
            },
          });

          if (countRes.ok) {
            const countHeader = countRes.headers.get('content-range');
            const count = countHeader ? countHeader.split('/')[1] : 'unknown';
            console.log(`  ✅ ${table}: ${count} records`);
          } else {
            console.log(`  ⚠️ ${table}: count failed`);
          }
        } else {
          console.log(`  ❌ ${table}: not accessible`);
        }
      } catch (err) {
        console.log(`  ❌ ${table}: error checking`);
      }
    }
  } catch (err) {
    console.error('❌ Error checking data counts:', err.message);
  }
}

async function main() {
  console.log('🔄 Starting batch processing...\n');

  let processedCount = 0;
  let totalProcessed = 0;
  const startTime = Date.now();

  // Process batches in continuous loop
  while (true) {
    const batchId = await processNextBatch();

    if (batchId === null) {
      console.log('✅ No more pending batches to process');
      break;
    }

    processedCount++;
    totalProcessed++;

    console.log(`✅ Processed batch ID: ${batchId} (total: ${totalProcessed})`);

    // Show progress every 10 batches
    if (processedCount >= 10) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(
        `📊 Progress: ${totalProcessed} batches in ${elapsed}s (${((totalProcessed / elapsed) * 60).toFixed(1)} batches/min)`
      );
      processedCount = 0;

      // Brief pause to avoid overwhelming the system
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log(`\n✅ Processing complete! ${totalProcessed} batches in ${elapsed}s`);

  // Check final data counts
  await checkDataCounts();
}

main().catch((err) => {
  console.error('❌ Batch processing failed:', err.message);
  process.exit(1);
});
