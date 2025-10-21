// Complete invoice backfill - fetch ALL invoices from Iugu API systematically
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/complete_invoice_backfill.js

const { upsertViaRpc } = require('./lib/upsert_rpc');

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!IUGU_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const iuguHeaders = {
  Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
  'Content-Type': 'application/json',
};

async function getTotalInvoices() {
  try {
    const response = await fetch(`${IUGU_API_BASE_URL}/invoices?limit=1`, {
      headers: iuguHeaders,
    });

    if (!response.ok) {
      throw new Error(`Failed to get total: ${response.status}`);
    }

    const data = await response.json();
    return data.totalItems || 0;
  } catch (err) {
    console.error('Error getting total invoices:', err.message);
    return 0;
  }
}

async function fetchInvoiceBatch(startIndex, limit = 100) {
  try {
    const response = await fetch(
      `${IUGU_API_BASE_URL}/invoices?limit=${limit}&start=${startIndex}&sortBy=created_at&sortType=desc`,
      { headers: iuguHeaders }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch batch at ${startIndex}: ${response.status}`);
    }

    const data = await response.json();
    return data.items || [];
  } catch (err) {
    console.error(`Error fetching batch at ${startIndex}:`, err.message);
    return [];
  }
}

async function insertInvoiceWithRetry(invoice, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'invoices', invoice);
      return { success: true, existed: false };
    } catch (err) {
      if (attempt === retries) {
        console.error(`   💥 Exception on final attempt for ${invoice.id}:`, err.message);
        return { success: false, error: err.message };
      }

      // Wait before retry
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  return { success: false, error: 'All retries failed' };
}

async function insertCustomerIfNeeded(invoice) {
  if (!invoice.customer_id) return true;

  try {
    // Create a synthetic customer payload that mimics Iugu's customer structure
    const customerPayload = {
      id: invoice.customer_id,
      email: invoice.payer_email || invoice.email || 'unknown@example.com',
      name: invoice.payer_name || invoice.customer_name || 'Unknown Customer',
      cpf_cnpj: invoice.payer_cpf_cnpj || null,
      phone: invoice.payer_phone || null,
      created_at: invoice.created_at_iso || invoice.created_at,
      updated_at: invoice.updated_at,
      notes: 'Synthetic customer from invoice backfill',
    };

    await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'customers', customerPayload);
    return true;
  } catch (err) {
    console.warn(`   ⚠️  Customer insert failed for ${invoice.customer_id}:`, err.message);
    return false;
  }
}

async function saveCheckpoint(currentIndex, totalProcessed, totalInserted) {
  const checkpoint = {
    currentIndex,
    totalProcessed,
    totalInserted,
    timestamp: new Date().toISOString(),
  };

  try {
    const fs = require('fs');
    fs.writeFileSync('checkpoint_complete_backfill.json', JSON.stringify(checkpoint, null, 2));
  } catch (err) {
    console.warn('Could not save checkpoint:', err.message);
  }
}

async function loadCheckpoint() {
  try {
    const fs = require('fs');
    const data = fs.readFileSync('checkpoint_complete_backfill.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('🚀 COMPLETE INVOICE BACKFILL');
  console.log('============================');
  console.log(`📅 Started at: ${new Date().toLocaleString()}\n`);

  // Configuration
  const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);
  const MAX_INVOICES = parseInt(process.env.MAX_INVOICES || '0', 10); // 0 = no limit
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '2000', 10);
  const SAVE_CHECKPOINT_EVERY = parseInt(process.env.CHECKPOINT_INTERVAL || '500', 10);

  // Get total invoices available
  const totalAvailable = await getTotalInvoices();
  console.log(`📊 Total invoices in Iugu: ${totalAvailable.toLocaleString()}`);

  if (totalAvailable === 0) {
    console.log('❌ No invoices found in API');
    return;
  }

  // Load checkpoint if exists
  const checkpoint = await loadCheckpoint();
  let startIndex = 0;
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalExisted = 0;
  let totalErrors = 0;

  if (checkpoint) {
    startIndex = checkpoint.currentIndex;
    totalProcessed = checkpoint.totalProcessed;
    totalInserted = checkpoint.totalInserted;
    console.log(`🔄 Resuming from checkpoint: index ${startIndex}, processed ${totalProcessed}`);
  }

  const maxToProcess = MAX_INVOICES > 0 ? Math.min(MAX_INVOICES, totalAvailable) : totalAvailable;
  console.log(`🎯 Target: ${maxToProcess.toLocaleString()} invoices\n`);

  while (startIndex < maxToProcess) {
    const batchEnd = Math.min(startIndex + BATCH_SIZE, maxToProcess);
    console.log(
      `\n🔄 Processing batch ${Math.floor(startIndex / BATCH_SIZE) + 1}: invoices ${startIndex + 1}-${batchEnd}`
    );

    // Fetch batch
    const invoices = await fetchInvoiceBatch(startIndex, BATCH_SIZE);

    if (invoices.length === 0) {
      console.log('⚠️  Empty batch received, stopping');
      break;
    }

    console.log(`📄 Processing ${invoices.length} invoices...`);

    // Process each invoice
    for (const invoice of invoices) {
      try {
        // Insert customer first
        if (invoice.customer_id) {
          await insertCustomerIfNeeded(invoice);
        }

        // Insert invoice
        const result = await insertInvoiceWithRetry(invoice);

        if (result.success) {
          if (result.existed) {
            totalExisted++;
          } else {
            totalInserted++;
          }
        } else {
          totalErrors++;
          console.error(`   ❌ ${invoice.id}: ${result.error}`);
        }

        totalProcessed++;

        // Small pause between invoices
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        totalErrors++;
        console.error(`   💥 Unexpected error for ${invoice.id}:`, err.message);
        totalProcessed++;
      }
    }

    startIndex += BATCH_SIZE;

    // Save checkpoint periodically
    if (totalProcessed % SAVE_CHECKPOINT_EVERY === 0) {
      await saveCheckpoint(startIndex, totalProcessed, totalInserted);
      console.log(`💾 Checkpoint saved`);
    }

    // Show progress
    const percent = ((totalProcessed / maxToProcess) * 100).toFixed(1);
    console.log(
      `📊 Progress: ${totalInserted} new, ${totalExisted} existed, ${totalErrors} errors (${percent}%)`
    );

    // Pause between batches
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log('\n🎉 COMPLETE BACKFILL FINISHED!');
  console.log('==============================');
  console.log(`📊 Total available: ${totalAvailable.toLocaleString()}`);
  console.log(`📊 Total processed: ${totalProcessed.toLocaleString()}`);
  console.log(`✅ New invoices: ${totalInserted.toLocaleString()}`);
  console.log(`🔄 Already existed: ${totalExisted.toLocaleString()}`);
  console.log(`❌ Errors: ${totalErrors.toLocaleString()}`);
  console.log(`📅 Finished at: ${new Date().toLocaleString()}`);

  // Clean up checkpoint
  try {
    const fs = require('fs');
    fs.unlinkSync('checkpoint_complete_backfill.json');
    console.log('🧹 Checkpoint file cleaned up');
  } catch (err) {
    // Ignore cleanup errors
  }
}

main().catch((err) => {
  console.error('💥 Complete backfill failed:', err.message);
  process.exit(1);
});
