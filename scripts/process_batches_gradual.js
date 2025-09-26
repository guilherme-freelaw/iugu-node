// Gradual batch processing with rate limiting and monitoring
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/process_batches_gradual.js

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

// Configuration for sustainable processing
const CONFIG = {
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '10', 10), // Process N batches then pause
  PAUSE_BETWEEN_BATCHES: parseInt(process.env.PAUSE_MS || '1000', 10), // Pause between each batch
  PAUSE_BETWEEN_CYCLES: parseInt(process.env.CYCLE_PAUSE_MS || '5000', 10), // Pause between batch groups
  MAX_CYCLES: parseInt(process.env.MAX_CYCLES || '100', 10), // Safety limit
  MAX_CONSECUTIVE_FAILURES: 3,
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
      return { success: false, error: `${res.status}: ${errorText}` };
    }

    const batchId = await res.text();
    if (batchId === '0') {
      return { success: true, batchId: null, empty: true };
    }

    return { success: true, batchId: parseInt(batchId) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function processBatchCycle() {
  console.log(`🔄 Processing cycle of ${CONFIG.BATCH_SIZE} batches...`);

  let processed = 0;
  let failed = 0;
  const cycleStart = Date.now();

  for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
    const result = await processNextBatch();

    if (!result.success) {
      console.error(`  ❌ Batch failed: ${result.error}`);
      failed++;
      if (failed >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
        console.error(`  💥 Too many failures (${failed}), stopping cycle`);
        break;
      }
      continue;
    }

    if (result.empty) {
      console.log(`  ✅ No more batches available`);
      break;
    }

    processed++;
    console.log(`  ✅ Processed batch ${result.batchId} (${processed}/${CONFIG.BATCH_SIZE})`);

    // Small pause between individual batches
    if (i < CONFIG.BATCH_SIZE - 1) {
      await new Promise((r) => setTimeout(r, CONFIG.PAUSE_BETWEEN_BATCHES));
    }
  }

  const cycleTime = Date.now() - cycleStart;
  const rate = processed > 0 ? ((processed / cycleTime) * 1000 * 60).toFixed(1) : 0;

  console.log(
    `📊 Cycle complete: ${processed} processed, ${failed} failed (${rate} batches/min)\n`
  );

  return { processed, failed, empty: processed === 0 };
}

async function checkDataCounts() {
  console.log('📊 Current data counts:');

  const entities = ['iugu_customers', 'iugu_invoices', 'iugu_subscriptions', 'iugu_plans'];

  for (const entity of entities) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${entity}?select=id&limit=1000`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`  ✅ ${entity}: ${data.length}+ records`);
      } else {
        console.log(`  ⚠️ ${entity}: check failed`);
      }
    } catch (err) {
      console.log(`  ❌ ${entity}: error`);
    }
  }
  console.log('');
}

async function main() {
  console.log('🔄 GRADUAL BATCH PROCESSING');
  console.log('===========================');
  console.log(
    `📋 Config: ${CONFIG.BATCH_SIZE} batches/cycle, ${CONFIG.PAUSE_BETWEEN_BATCHES}ms between batches, ${CONFIG.PAUSE_BETWEEN_CYCLES}ms between cycles`
  );
  console.log('');

  // Show initial state
  await checkDataCounts();

  let totalProcessed = 0;
  let totalCycles = 0;
  const startTime = Date.now();

  for (let cycle = 0; cycle < CONFIG.MAX_CYCLES; cycle++) {
    const result = await processBatchCycle();

    totalProcessed += result.processed;
    totalCycles++;

    if (result.empty) {
      console.log('🎉 All available batches processed!');
      break;
    }

    if (result.failed >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
      console.log('💥 Too many failures, stopping');
      break;
    }

    // Progress update every 5 cycles
    if (totalCycles % 5 === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const overallRate = ((totalProcessed / elapsed) * 60).toFixed(1);
      console.log(
        `🎯 Progress: ${totalProcessed} batches in ${totalCycles} cycles (${overallRate} batches/min overall)`
      );

      // Show current data counts
      await checkDataCounts();
    }

    // Pause between cycles to be gentle on the system
    console.log(`⏸️  Pausing ${CONFIG.PAUSE_BETWEEN_CYCLES}ms before next cycle...`);
    await new Promise((r) => setTimeout(r, CONFIG.PAUSE_BETWEEN_CYCLES));
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000);

  console.log('\n🎉 GRADUAL PROCESSING COMPLETE!');
  console.log('===============================');
  console.log(`📊 Total batches processed: ${totalProcessed}`);
  console.log(`🔄 Total cycles: ${totalCycles}`);
  console.log(`⏱️  Total time: ${elapsed}s`);
  console.log(`🚀 Average rate: ${((totalProcessed / elapsed) * 60).toFixed(1)} batches/min`);
  console.log(`💾 Estimated records processed: ${totalProcessed * 100} records`);

  // Final data count
  console.log('\n📊 Final data counts:');
  await checkDataCounts();
}

main().catch((err) => {
  console.error('💥 Gradual processing failed:', err.message);
  process.exit(1);
});
