// Monitor backfill progress and process staging batches
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/monitor_backfill.js

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

async function checkBackfillProgress() {
  try {
    // Check staging batches count and status
    const batchesRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_iugu_batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_page: 0, p_payload: [] }), // dummy call to test connectivity
    });

    if (!batchesRes.ok) {
      console.error('❌ Supabase connectivity failed:', batchesRes.status);
      return;
    }

    console.log('✅ Supabase connected');

    // Check if process_next_iugu_batch is available
    const processRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_next_iugu_batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (processRes.status === 404) {
      console.log('⚠️ process_next_iugu_batch RPC not found in schema cache');
    } else if (processRes.ok) {
      const result = await processRes.text();
      console.log('✅ process_next_iugu_batch available, result:', result);
    } else {
      console.log('❓ process_next_iugu_batch status:', processRes.status);
    }
  } catch (err) {
    console.error('❌ Error checking backfill progress:', err.message);
  }
}

async function processPendingBatches() {
  try {
    console.log('🔄 Processing pending batches...');

    let processedCount = 0;
    for (let i = 0; i < 10; i++) {
      // Process up to 10 batches
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_next_iugu_batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        if (res.status === 404) {
          console.log('⚠️ process_next_iugu_batch RPC not available yet');
          break;
        }
        console.error('❌ Error processing batch:', res.status, await res.text());
        break;
      }

      const batchId = await res.text();
      if (batchId === '0') {
        console.log('✅ No more pending batches to process');
        break;
      }

      processedCount++;
      console.log(`✅ Processed batch ID: ${batchId}`);
    }

    console.log(`📊 Total batches processed: ${processedCount}`);
  } catch (err) {
    console.error('❌ Error processing batches:', err.message);
  }
}

async function showLocalProgress() {
  try {
    const fs = await import('node:fs');
    if (!fs.existsSync('out')) {
      console.log('📁 No local checkpoint directory found');
      return;
    }

    const files = fs.readdirSync('out').filter((f) => f.startsWith('page_') && f.endsWith('.json'));
    if (files.length === 0) {
      console.log('📁 No checkpoint files found');
      return;
    }

    const pages = files
      .map((f) => parseInt(f.replace('page_', '').replace('.json', ''), 10))
      .filter((n) => !isNaN(n));
    const minPage = Math.min(...pages);
    const maxPage = Math.max(...pages);

    console.log(`📊 Local checkpoints: ${files.length} files, pages ${minPage}-${maxPage}`);

    // Check latest file size to estimate if still active
    const latestFile = `out/page_${maxPage}.json`;
    const stats = fs.statSync(latestFile);
    const ageMinutes = Math.floor((Date.now() - stats.mtime.getTime()) / 60000);

    console.log(`📅 Latest file: page_${maxPage}.json (${ageMinutes} minutes ago)`);

    if (ageMinutes < 5) {
      console.log('🔄 Backfill appears to be running (recent file)');
    } else {
      console.log('⏸️ Backfill may have stopped (old file)');
    }
  } catch (err) {
    console.error('❌ Error checking local progress:', err.message);
  }
}

async function main() {
  console.log('🔍 Monitoring backfill progress...\n');

  await showLocalProgress();
  console.log('');

  await checkBackfillProgress();
  console.log('');

  // Only try to process if user wants to
  if (process.argv.includes('--process')) {
    await processPendingBatches();
  } else {
    console.log('💡 Run with --process to attempt batch processing');
  }
}

main().catch((err) => {
  console.error('❌ Monitor failed:', err.message);
  process.exit(1);
});
