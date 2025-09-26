// Complete backfill script for all Iugu entities
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill_all_entities.js

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!IUGU_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const BASIC_AUTH = 'Basic ' + Buffer.from(IUGU_API_TOKEN + ':').toString('base64');

// Configuration for each entity
const ENTITIES = {
  customers: {
    endpoint: '/customers',
    batchTable: 'iugu_customers_batches',
    upsertRpc: 'upsert_customer_from_payload',
    enabled: true,
  },
  invoices: {
    endpoint: '/invoices',
    batchTable: 'iugu_invoices_batches',
    upsertRpc: 'upsert_invoice_from_payload',
    enabled: true, // Already working
  },
  subscriptions: {
    endpoint: '/subscriptions',
    batchTable: 'iugu_subscriptions_batches',
    upsertRpc: 'upsert_subscription_from_payload',
    enabled: true,
  },
  plans: {
    endpoint: '/plans',
    batchTable: 'iugu_plans_batches',
    upsertRpc: 'upsert_plan_from_payload',
    enabled: true,
  },
  transfers: {
    endpoint: '/transfers',
    batchTable: 'iugu_transfers_batches',
    upsertRpc: 'upsert_transfer_from_payload',
    enabled: true,
  },
  charges: {
    endpoint: '/charges',
    batchTable: 'iugu_charges_batches',
    upsertRpc: 'upsert_charge_from_payload',
    enabled: true,
  },
  accounts: {
    endpoint: '/accounts',
    batchTable: 'iugu_accounts_batches',
    upsertRpc: 'upsert_account_from_payload',
    enabled: true,
  },
};

async function fetchEntityPage(entity, page = 1) {
  const url = `${IUGU_API_BASE_URL}${entity.endpoint}?page=${page}&per_page=100`;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: BASIC_AUTH },
        timeout: 30000,
      });

      if (!res.ok) {
        if (res.status >= 500 && attempt < maxAttempts) {
          const waitMs = Math.pow(2, attempt) * 1000;
          console.warn(
            `${entity.endpoint} page ${page} failed (${res.status}), retrying in ${waitMs}ms`
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`API error ${res.status}: ${await res.text()}`);
      }

      const json = await res.json();
      // Handle different response formats
      if (Array.isArray(json)) return json;
      if (json.items) return json.items;
      if (json.data) return json.data;
      return [];
    } catch (err) {
      if (attempt < maxAttempts) {
        const waitMs = Math.pow(2, attempt) * 1000;
        console.warn(
          `${entity.endpoint} page ${page} error, retrying in ${waitMs}ms:`,
          err.message
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      console.error(
        `${entity.endpoint} page ${page} failed after ${maxAttempts} attempts:`,
        err.message
      );
      return [];
    }
  }
  return [];
}

async function storeBatchInSupabase(entityName, page, data) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_iugu_batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        p_page: page + 10000 + Math.floor(Math.random() * 1000), // Avoid collision with existing batches
        p_payload: data,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`Failed to store ${entityName} batch page ${page}: ${res.status} ${text}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`Error storing ${entityName} batch page ${page}:`, err.message);
    return false;
  }
}

async function backfillEntity(entityName, entity) {
  console.log(`\n🔄 Starting backfill for ${entityName}...`);

  let page = 1;
  let totalRecords = 0;
  let pagesFetched = 0;
  const MAX_PAGES = parseInt(process.env.MAX_PAGES || '1000', 10);
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '2000', 10);

  while (pagesFetched < MAX_PAGES) {
    const data = await fetchEntityPage(entity, page);

    if (!data || data.length === 0) {
      console.log(`✅ ${entityName}: No more data at page ${page}`);
      break;
    }

    // Store in Supabase staging
    await storeBatchInSupabase(entityName, page, data);

    totalRecords += data.length;
    pagesFetched++;

    console.log(`📄 ${entityName}: Page ${page} (${data.length} records, total: ${totalRecords})`);

    // Stop if we got less than full page
    if (data.length < 100) {
      console.log(
        `✅ ${entityName}: Reached end of data (page ${page} had ${data.length} records)`
      );
      break;
    }

    page++;

    // Polite pause
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(
    `✅ ${entityName} backfill complete: ${totalRecords} records in ${pagesFetched} pages`
  );
  return { totalRecords, pagesFetched };
}

async function main() {
  console.log('🚀 Starting complete Iugu → Supabase backfill...\n');

  const results = {};
  const startTime = Date.now();

  // Process each enabled entity
  for (const [entityName, entity] of Object.entries(ENTITIES)) {
    if (!entity.enabled) {
      console.log(`⏭️  Skipping ${entityName} (disabled)`);
      continue;
    }

    try {
      results[entityName] = await backfillEntity(entityName, entity);
    } catch (err) {
      console.error(`❌ Failed to backfill ${entityName}:`, err.message);
      results[entityName] = { error: err.message };
    }
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000);

  console.log('\n📊 BACKFILL SUMMARY');
  console.log('==================');

  let totalRecords = 0;
  let totalPages = 0;

  for (const [entityName, result] of Object.entries(results)) {
    if (result.error) {
      console.log(`❌ ${entityName}: ERROR - ${result.error}`);
    } else {
      console.log(
        `✅ ${entityName}: ${result.totalRecords} records (${result.pagesFetched} pages)`
      );
      totalRecords += result.totalRecords;
      totalPages += result.pagesFetched;
    }
  }

  console.log('==================');
  console.log(`🎯 Total: ${totalRecords} records in ${totalPages} pages`);
  console.log(`⏱️  Time: ${elapsed}s (${(totalRecords / elapsed).toFixed(1)} records/sec)`);
  console.log('🎉 Backfill complete!');
}

main().catch((err) => {
  console.error('💥 Backfill failed:', err.message);
  process.exit(1);
});
