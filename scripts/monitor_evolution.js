// Real-time monitoring dashboard for Iugu → Supabase population
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/monitor_evolution.js

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

async function getTableCount(tableName) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=id&limit=1000`, {
      headers,
    });
    if (res.ok) {
      const data = await res.json();
      return data.length >= 1000 ? '1000+' : data.length.toString();
    }
    return 'error';
  } catch (err) {
    return 'error';
  }
}

async function getStagingStatus() {
  try {
    // Get total batches in staging
    const totalRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staging.iugu_batches?select=id&limit=2000`,
      { headers }
    );
    const totalBatches = totalRes.ok ? (await totalRes.json()).length : 0;

    // Get pending batches
    const pendingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staging.iugu_batches?select=id&status=eq.pending&limit=2000`,
      { headers }
    );
    const pendingBatches = pendingRes.ok ? (await pendingRes.json()).length : 0;

    // Get processed batches
    const doneRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staging.iugu_batches?select=id&status=eq.done&limit=2000`,
      { headers }
    );
    const doneBatches = doneRes.ok ? (await doneRes.json()).length : 0;

    return { totalBatches, pendingBatches, doneBatches };
  } catch (err) {
    return { totalBatches: 0, pendingBatches: 0, doneBatches: 0 };
  }
}

async function getLocalBackfillStatus() {
  try {
    const fs = await import('node:fs');
    if (!fs.existsSync('out')) return { pages: 0, latestPage: 0 };

    const files = fs.readdirSync('out').filter((f) => f.startsWith('page_') && f.endsWith('.json'));
    if (files.length === 0) return { pages: 0, latestPage: 0 };

    const pageNumbers = files
      .map((f) => parseInt(f.replace('page_', '').replace('.json', ''), 10))
      .filter((n) => !isNaN(n));
    const latestPage = Math.max(...pageNumbers);

    return { pages: files.length, latestPage };
  } catch (err) {
    return { pages: 0, latestPage: 0 };
  }
}

function formatProgress(current, total) {
  if (total === 0) return '0%';
  const pct = Math.round((current / total) * 100);
  return `${pct}%`;
}

function createProgressBar(current, total, width = 30) {
  if (total === 0) return '▱'.repeat(width);
  const filled = Math.round((current / total) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

async function displayDashboard() {
  console.clear();
  console.log('🚀 IUGU → SUPABASE POPULATION DASHBOARD');
  console.log('======================================');
  console.log(`📅 ${new Date().toLocaleString()}\n`);

  // Get all data
  const [
    customers,
    invoices,
    subscriptions,
    plans,
    accounts,
    transfers,
    stagingStatus,
    backfillStatus,
  ] = await Promise.all([
    getTableCount('iugu_customers'),
    getTableCount('iugu_invoices'),
    getTableCount('iugu_subscriptions'),
    getTableCount('iugu_plans'),
    getTableCount('iugu_accounts'),
    getTableCount('iugu_transfers'),
    getStagingStatus(),
    getLocalBackfillStatus(),
  ]);

  // 1. BACKFILL STATUS (Data Collection from Iugu)
  console.log('📥 BACKFILL STATUS (Iugu → Staging)');
  console.log('-----------------------------------');
  console.log(`📊 Pages collected: ${backfillStatus.pages}`);
  console.log(`📄 Latest page: ${backfillStatus.latestPage}`);
  console.log(`💾 Estimated records: ${(backfillStatus.pages * 100).toLocaleString()}`);
  console.log('');

  // 2. PROCESSING STATUS (Staging → Public Tables)
  console.log('⚙️  PROCESSING STATUS (Staging → Public)');
  console.log('----------------------------------------');
  console.log(`📦 Total batches: ${stagingStatus.totalBatches}`);
  console.log(`✅ Processed: ${stagingStatus.doneBatches}`);
  console.log(`⏳ Pending: ${stagingStatus.pendingBatches}`);

  if (stagingStatus.totalBatches > 0) {
    const progress = formatProgress(stagingStatus.doneBatches, stagingStatus.totalBatches);
    const progressBar = createProgressBar(stagingStatus.doneBatches, stagingStatus.totalBatches);
    console.log(`📊 Progress: ${progress} ${progressBar}`);
  }
  console.log('');

  // 3. PUBLIC TABLES STATUS (Queryable Data)
  console.log('💾 PUBLIC TABLES STATUS (Queryable Data)');
  console.log('----------------------------------------');
  console.log(`👥 Customers:     ${customers.padStart(6)}`);
  console.log(`📄 Invoices:      ${invoices.padStart(6)}`);
  console.log(`🔄 Subscriptions: ${subscriptions.padStart(6)}`);
  console.log(`📋 Plans:         ${plans.padStart(6)}`);
  console.log(`🏢 Accounts:      ${accounts.padStart(6)}`);
  console.log(`💰 Transfers:     ${transfers.padStart(6)}`);
  console.log('');

  // 4. ESTIMATED COMPLETION
  if (stagingStatus.pendingBatches > 0) {
    const estimatedMinutes = Math.ceil(stagingStatus.pendingBatches / 15); // ~15 batches/min
    console.log('⏱️  ESTIMATED COMPLETION');
    console.log('------------------------');
    console.log(`🕐 Time remaining: ~${estimatedMinutes} minutes`);
    console.log(
      `🎯 Total records: ~${(stagingStatus.totalBatches * 100 + backfillStatus.pages * 100).toLocaleString()}`
    );
    console.log('');
  }

  // 5. NEXT REFRESH
  console.log('🔄 Auto-refreshing every 30 seconds...');
  console.log('   Press Ctrl+C to stop monitoring');
}

async function main() {
  console.log('🚀 Starting real-time monitoring...\n');

  // Display dashboard immediately
  await displayDashboard();

  // Then refresh every 30 seconds
  setInterval(async () => {
    await displayDashboard();
  }, 30000);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Monitoring stopped by user');
  process.exit(0);
});

main().catch((err) => {
  console.error('💥 Monitoring failed:', err.message);
  process.exit(1);
});
