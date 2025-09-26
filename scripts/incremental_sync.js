// Incremental synchronization system for ongoing Iugu updates
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/incremental_sync.js

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!IUGU_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const BASIC_AUTH = 'Basic ' + Buffer.from(IUGU_API_TOKEN + ':').toString('base64');

// Entities to sync incrementally
const SYNC_ENTITIES = {
  invoices: {
    endpoint: '/invoices',
    upsertRpc: 'upsert_invoice_from_payload',
    updateField: 'updated_at',
    enabled: true,
  },
  customers: {
    endpoint: '/customers',
    upsertRpc: 'upsert_customer_from_payload',
    updateField: 'updated_at',
    enabled: true,
  },
  subscriptions: {
    endpoint: '/subscriptions',
    upsertRpc: 'upsert_subscription_from_payload',
    updateField: 'updated_at',
    enabled: true,
  },
  plans: {
    endpoint: '/plans',
    upsertRpc: 'upsert_plan_from_payload',
    updateField: 'updated_at',
    enabled: true,
  },
};

async function getLastSyncTimestamp(entityName) {
  try {
    const fs = await import('node:fs');
    const syncFile = `sync_checkpoints/${entityName}_last_sync.json`;

    if (fs.existsSync(syncFile)) {
      const data = JSON.parse(fs.readFileSync(syncFile, 'utf8'));
      return data.lastSync;
    }

    // If no sync file, start from 24 hours ago
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    return yesterday.toISOString();
  } catch (err) {
    console.warn(`Error reading sync timestamp for ${entityName}:`, err.message);
    // Default to 1 hour ago
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    return oneHourAgo.toISOString();
  }
}

async function saveLastSyncTimestamp(entityName, timestamp) {
  try {
    const fs = await import('node:fs');

    if (!fs.existsSync('sync_checkpoints')) {
      fs.mkdirSync('sync_checkpoints');
    }

    const syncFile = `sync_checkpoints/${entityName}_last_sync.json`;
    const data = {
      entityName,
      lastSync: timestamp,
      syncedAt: new Date().toISOString(),
    };

    fs.writeFileSync(syncFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`Error saving sync timestamp for ${entityName}:`, err.message);
  }
}

async function fetchUpdatedRecords(entity, entityName, sinceTimestamp) {
  console.log(`🔄 Fetching ${entityName} updated since ${sinceTimestamp}...`);

  let allRecords = [];
  let page = 1;
  const maxPages = 10; // Safety limit for incremental sync

  while (page <= maxPages) {
    try {
      // Iugu API doesn't have native filtering by updated_at, so we fetch recent pages
      const url = `${IUGU_API_BASE_URL}${entity.endpoint}?page=${page}&per_page=100`;

      const res = await fetch(url, {
        headers: { Authorization: BASIC_AUTH },
        timeout: 30000,
      });

      if (!res.ok) {
        console.warn(`API error for ${entityName} page ${page}: ${res.status}`);
        break;
      }

      const json = await res.json();
      let records = Array.isArray(json) ? json : json.items || json.data || [];

      if (records.length === 0) break;

      // Filter records updated since last sync
      const updatedRecords = records.filter((record) => {
        const recordUpdated = record.updated_at || record.created_at;
        return recordUpdated && new Date(recordUpdated) > new Date(sinceTimestamp);
      });

      allRecords.push(...updatedRecords);

      console.log(`  📄 Page ${page}: ${records.length} total, ${updatedRecords.length} updated`);

      // If no updated records in this page, we can stop (assuming chronological order)
      if (updatedRecords.length === 0) {
        console.log(`  ✅ No more updated ${entityName} found`);
        break;
      }

      page++;

      // Polite pause
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`Error fetching ${entityName} page ${page}:`, err.message);
      break;
    }
  }

  console.log(`✅ Found ${allRecords.length} updated ${entityName} records`);
  return allRecords;
}

async function upsertRecord(entityName, record, upsertRpc) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${upsertRpc}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ payload: record }),
    });

    return res.ok;
  } catch (err) {
    console.warn(`Error upserting ${entityName} ${record.id}:`, err.message);
    return false;
  }
}

async function syncEntity(entityName, entity) {
  console.log(`\n🔄 Starting incremental sync for ${entityName}...`);

  const lastSync = await getLastSyncTimestamp(entityName);
  const syncStartTime = new Date().toISOString();

  // Fetch updated records
  const updatedRecords = await fetchUpdatedRecords(entity, entityName, lastSync);

  if (updatedRecords.length === 0) {
    console.log(`✅ No updates for ${entityName}`);
    return { updated: 0, failed: 0 };
  }

  // Upsert records
  console.log(`💾 Upserting ${updatedRecords.length} ${entityName} records...`);

  let updated = 0;
  let failed = 0;

  for (const record of updatedRecords) {
    const success = await upsertRecord(entityName, record, entity.upsertRpc);
    if (success) {
      updated++;
    } else {
      failed++;
    }

    // Small pause between upserts
    await new Promise((r) => setTimeout(r, 100));
  }

  // Save sync checkpoint
  await saveLastSyncTimestamp(entityName, syncStartTime);

  console.log(`✅ ${entityName} sync complete: ${updated} updated, ${failed} failed`);
  return { updated, failed };
}

async function main() {
  console.log('🔄 INCREMENTAL SYNC - Iugu → Supabase');
  console.log('====================================');
  console.log(`📅 Started at: ${new Date().toLocaleString()}\n`);

  const results = {};
  let totalUpdated = 0;
  let totalFailed = 0;

  // Sync each enabled entity
  for (const [entityName, entity] of Object.entries(SYNC_ENTITIES)) {
    if (!entity.enabled) {
      console.log(`⏭️  Skipping ${entityName} (disabled)`);
      continue;
    }

    try {
      const result = await syncEntity(entityName, entity);
      results[entityName] = result;
      totalUpdated += result.updated;
      totalFailed += result.failed;
    } catch (err) {
      console.error(`❌ Failed to sync ${entityName}:`, err.message);
      results[entityName] = { error: err.message };
    }
  }

  console.log('\n📊 INCREMENTAL SYNC SUMMARY');
  console.log('============================');

  for (const [entityName, result] of Object.entries(results)) {
    if (result.error) {
      console.log(`❌ ${entityName}: ERROR - ${result.error}`);
    } else {
      console.log(`✅ ${entityName}: ${result.updated} updated, ${result.failed} failed`);
    }
  }

  console.log('============================');
  console.log(`🎯 Total: ${totalUpdated} updated, ${totalFailed} failed`);
  console.log(`📅 Completed at: ${new Date().toLocaleString()}`);

  if (totalUpdated > 0) {
    console.log('\n💡 TIP: Run this script periodically (every 15-30 minutes) to keep data fresh!');
  }
}

main().catch((err) => {
  console.error('💥 Incremental sync failed:', err.message);
  process.exit(1);
});
