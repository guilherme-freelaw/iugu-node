// Automated sync cycle - runs incremental sync every N minutes
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/automated_sync_cycle.js

const SYNC_INTERVAL_MINUTES = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30', 10);

console.log(`🔄 AUTOMATED SYNC CYCLE`);
console.log(`======================`);
console.log(`📅 Started at: ${new Date().toLocaleString()}`);
console.log(`⏰ Sync interval: ${SYNC_INTERVAL_MINUTES} minutes`);
console.log(`🔄 First sync will start immediately...\n`);

async function runIncrementalSync() {
  console.log(`🚀 Running incremental sync at ${new Date().toLocaleString()}...`);

  try {
    const { spawn } = await import('child_process');

    return new Promise((resolve, reject) => {
      const child = spawn('node', ['scripts/incremental_sync.js'], {
        stdio: 'inherit',
        env: process.env,
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Incremental sync completed successfully`);
          resolve();
        } else {
          console.error(`❌ Incremental sync failed with code ${code}`);
          reject(new Error(`Sync process exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        console.error(`❌ Failed to start sync process:`, err.message);
        reject(err);
      });
    });
  } catch (err) {
    console.error(`❌ Error running incremental sync:`, err.message);
    throw err;
  }
}

async function main() {
  let syncCount = 0;

  // Run first sync immediately
  try {
    await runIncrementalSync();
    syncCount++;
  } catch (err) {
    console.error(`💥 First sync failed:`, err.message);
  }

  // Then run every N minutes
  setInterval(
    async () => {
      try {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`🔄 SYNC CYCLE #${syncCount + 1}`);
        console.log(`${'='.repeat(50)}`);

        await runIncrementalSync();
        syncCount++;

        console.log(`\n⏰ Next sync in ${SYNC_INTERVAL_MINUTES} minutes...`);
      } catch (err) {
        console.error(`💥 Sync cycle failed:`, err.message);
        console.log(`⏰ Will retry in ${SYNC_INTERVAL_MINUTES} minutes...`);
      }
    },
    SYNC_INTERVAL_MINUTES * 60 * 1000
  );

  // Keep process alive
  console.log(`\n💡 Automated sync is running. Press Ctrl+C to stop.`);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Automated sync stopped by user');
  console.log('📅 Stopped at:', new Date().toLocaleString());
  process.exit(0);
});

main().catch((err) => {
  console.error('💥 Automated sync cycle failed:', err.message);
  process.exit(1);
});
