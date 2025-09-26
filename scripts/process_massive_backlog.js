// Process ALL pending batches at maximum speed
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/process_massive_backlog.js

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

async function main() {
  console.log('🚀 MASSIVE BATCH PROCESSING - Processing ALL pending batches...\n');

  let totalProcessed = 0;
  let consecutiveFailures = 0;
  const startTime = Date.now();
  const MAX_CONSECUTIVE_FAILURES = 5;
  const MAX_BATCHES = parseInt(process.env.MAX_BATCHES || '10000', 10); // Safety limit

  while (totalProcessed < MAX_BATCHES && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
    const batchId = await processNextBatch();

    if (batchId === null) {
      consecutiveFailures++;
      if (consecutiveFailures === 1) {
        console.log('✅ No more pending batches found');
      }
      // Small delay before checking again
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }

    consecutiveFailures = 0; // Reset failure counter
    totalProcessed++;

    // Progress updates
    if (totalProcessed % 10 === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const rate = ((totalProcessed / elapsed) * 60).toFixed(1);
      console.log(
        `📊 Processed: ${totalProcessed} batches (${rate} batches/min) - Latest: ${batchId}`
      );
    } else if (totalProcessed % 100 === 0) {
      console.log(`🎯 MILESTONE: ${totalProcessed} batches processed!`);
    }
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const rate = totalProcessed / elapsed;

  console.log('\n🎉 MASSIVE PROCESSING COMPLETE!');
  console.log('================================');
  console.log(`📊 Total batches processed: ${totalProcessed}`);
  console.log(`⏱️  Total time: ${elapsed}s`);
  console.log(`🚀 Average rate: ${(rate * 60).toFixed(1)} batches/min`);
  console.log(`💾 Estimated records processed: ${totalProcessed * 100} records`);

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.log(`⚠️  Stopped due to ${consecutiveFailures} consecutive failures`);
  } else if (totalProcessed >= MAX_BATCHES) {
    console.log(`⚠️  Stopped due to safety limit (${MAX_BATCHES} batches)`);
  } else {
    console.log('✅ All available batches processed successfully!');
  }
}

main().catch((err) => {
  console.error('💥 Massive processing failed:', err.message);
  process.exit(1);
});
