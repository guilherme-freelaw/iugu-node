// Autonomous complete backfill - runs unsupervised for hours with full error handling
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/autonomous_complete_backfill.js

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

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

// Conservative configuration for stability
const CONFIG = {
  BATCH_SIZE: 50, // Smaller batches for stability
  PAUSE_BETWEEN_BATCHES: 3000, // 3 seconds between batches
  PAUSE_BETWEEN_INVOICES: 200, // 200ms between invoices
  MAX_RETRIES: 5, // More retries for network issues
  CHECKPOINT_INTERVAL: 250, // Save checkpoint every 250 invoices
  MAX_CONSECUTIVE_ERRORS: 10, // Stop if too many consecutive errors
  RATE_LIMIT_PAUSE: 30000, // 30 seconds if we hit rate limits
  NETWORK_TIMEOUT: 15000, // 15 second timeout for requests
  LONG_PAUSE_INTERVAL: 5000, // Every 50 batches, take longer pause
  LONG_PAUSE_DURATION: 10000, // 10 second pause every 50 batches
};

function parseDate(dateStr) {
  if (!dateStr || dateStr === '') return null;
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return null;
  }
}

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeRequestWithTimeout(url, options, timeoutMs = CONFIG.NETWORK_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function getTotalInvoices() {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await makeRequestWithTimeout(`${IUGU_API_BASE_URL}/invoices?limit=1`, {
        headers: iuguHeaders,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.totalItems || 0;
    } catch (err) {
      logWithTimestamp(`⚠️  Attempt ${attempt} to get total failed: ${err.message}`);
      if (attempt === CONFIG.MAX_RETRIES) {
        throw new Error(`Failed to get total after ${CONFIG.MAX_RETRIES} attempts`);
      }
      await sleep(2000 * attempt);
    }
  }
}

async function fetchInvoiceBatch(startIndex, limit = CONFIG.BATCH_SIZE) {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await makeRequestWithTimeout(
        `${IUGU_API_BASE_URL}/invoices?limit=${limit}&start=${startIndex}&sortBy=created_at&sortType=desc`,
        { headers: iuguHeaders }
      );

      if (response.status === 429) {
        logWithTimestamp(`🚦 Rate limit hit, waiting ${CONFIG.RATE_LIMIT_PAUSE}ms...`);
        await sleep(CONFIG.RATE_LIMIT_PAUSE);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.items || [];
    } catch (err) {
      logWithTimestamp(`⚠️  Batch fetch attempt ${attempt} failed: ${err.message}`);
      if (attempt === CONFIG.MAX_RETRIES) {
        logWithTimestamp(`❌ Failed to fetch batch after ${CONFIG.MAX_RETRIES} attempts`);
        return [];
      }
      await sleep(2000 * attempt);
    }
  }
  return [];
}

async function insertInvoiceRobust(invoice) {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const invoiceData = {
        id: invoice.id,
        account_id: invoice.account_id || null,
        customer_id: invoice.customer_id || null,
        subscription_id: invoice.subscription_id || null,
        status: invoice.status || null,
        due_date: invoice.due_date || null,
        paid_at: parseDate(invoice.paid_at),
        payment_method: invoice.payment_method || null,
        total_cents: invoice.total_cents || null,
        paid_cents: invoice.paid_cents || invoice.total_paid_cents || null,
        discount_cents: invoice.discount_cents || null,
        taxes_cents: invoice.tax_cents || invoice.taxes_paid_cents || null,
        external_reference: invoice.external_reference || null,
        order_id: invoice.order_id || null,
        created_at_iugu: parseDate(invoice.created_at_iso || invoice.created_at),
        updated_at_iugu: parseDate(invoice.updated_at),
        payer_name: invoice.payer_name || null,
        payer_email: invoice.payer_email || invoice.email || null,
        payer_cpf_cnpj: invoice.payer_cpf_cnpj || null,
        payer_phone: invoice.payer_phone || null,
        secure_id: invoice.secure_id || null,
        secure_url: invoice.secure_url || null,
        notification_url: invoice.notification_url || null,
        return_url: invoice.return_url || null,
        expired_url: invoice.expired_url || null,
        financial_return_date: invoice.financial_return_date || null,
        installments: invoice.installments || null,
        credit_card_brand: invoice.credit_card_brand || null,
        credit_card_last_4: invoice.credit_card_last_4 || null,
        early_payment_discount: invoice.early_payment_discount || false,
        commission_cents: invoice.commission_cents || null,
        raw_json: invoice,
      };

      // Clean undefined values
      Object.keys(invoiceData).forEach((key) => {
        if (invoiceData[key] === undefined) {
          delete invoiceData[key];
        }
      });

      const response = await makeRequestWithTimeout(`${SUPABASE_URL}/rest/v1/iugu_invoices`, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(invoiceData),
      });

      if (response.ok || response.status === 409) {
        return { success: true, existed: response.status === 409 };
      }

      if (response.status === 429) {
        logWithTimestamp(`🚦 Supabase rate limit, waiting...`);
        await sleep(CONFIG.RATE_LIMIT_PAUSE);
        continue;
      }

      if (attempt === CONFIG.MAX_RETRIES) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return { success: false, error: `${response.status}: ${errorText.substring(0, 100)}` };
      }

      await sleep(1000 * attempt);
    } catch (err) {
      if (attempt === CONFIG.MAX_RETRIES) {
        return { success: false, error: err.message };
      }
      await sleep(1000 * attempt);
    }
  }

  return { success: false, error: 'All retries exhausted' };
}

async function insertCustomerRobust(invoice) {
  if (!invoice.customer_id) return true;

  try {
    const customer = {
      id: invoice.customer_id,
      email: invoice.payer_email || invoice.email || 'unknown@example.com',
      name: invoice.payer_name || invoice.customer_name || 'Unknown Customer',
      cpf_cnpj: invoice.payer_cpf_cnpj || null,
      phone: invoice.payer_phone || null,
      created_at_iugu: parseDate(invoice.created_at_iso || invoice.created_at),
      updated_at_iugu: parseDate(invoice.updated_at),
      raw_json: {
        id: invoice.customer_id,
        from_invoice: true,
        source: 'autonomous_backfill',
      },
    };

    Object.keys(customer).forEach((key) => {
      if (customer[key] === undefined) {
        delete customer[key];
      }
    });

    const response = await makeRequestWithTimeout(`${SUPABASE_URL}/rest/v1/iugu_customers`, {
      method: 'POST',
      headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(customer),
    });

    return response.ok || response.status === 409;
  } catch (err) {
    // Don't fail the whole process for customer errors
    return false;
  }
}

async function saveCheckpoint(data) {
  try {
    const fs = require('fs');
    const checkpoint = {
      ...data,
      timestamp: new Date().toISOString(),
      config: CONFIG,
    };
    fs.writeFileSync('autonomous_backfill_checkpoint.json', JSON.stringify(checkpoint, null, 2));
    logWithTimestamp(`💾 Checkpoint saved: ${data.totalProcessed} processed`);
  } catch (err) {
    logWithTimestamp(`⚠️  Could not save checkpoint: ${err.message}`);
  }
}

async function loadCheckpoint() {
  try {
    const fs = require('fs');
    const data = fs.readFileSync('autonomous_backfill_checkpoint.json', 'utf8');
    const checkpoint = JSON.parse(data);
    logWithTimestamp(`🔄 Loaded checkpoint from ${checkpoint.timestamp}`);
    return checkpoint;
  } catch (err) {
    logWithTimestamp(`ℹ️  No checkpoint found, starting fresh`);
    return null;
  }
}

async function estimateCompletion(totalProcessed, totalTarget, startTime) {
  const elapsed = Date.now() - startTime;
  const rate = totalProcessed / (elapsed / 1000); // invoices per second
  const remaining = totalTarget - totalProcessed;
  const eta = remaining / rate;

  const etaHours = Math.floor(eta / 3600);
  const etaMinutes = Math.floor((eta % 3600) / 60);

  return {
    rate: rate.toFixed(2),
    etaHours,
    etaMinutes,
    percentComplete: ((totalProcessed / totalTarget) * 100).toFixed(1),
  };
}

async function main() {
  const startTime = Date.now();

  logWithTimestamp('🚀 AUTONOMOUS COMPLETE INVOICE BACKFILL');
  logWithTimestamp('=====================================');
  logWithTimestamp(`📋 Configuration:`);
  logWithTimestamp(`   • Batch size: ${CONFIG.BATCH_SIZE}`);
  logWithTimestamp(`   • Pause between batches: ${CONFIG.PAUSE_BETWEEN_BATCHES}ms`);
  logWithTimestamp(`   • Max retries: ${CONFIG.MAX_RETRIES}`);
  logWithTimestamp(`   • Checkpoint interval: ${CONFIG.CHECKPOINT_INTERVAL}`);

  // Get total invoices
  const totalAvailable = await getTotalInvoices();
  logWithTimestamp(`📊 Total invoices in Iugu: ${totalAvailable.toLocaleString()}`);

  if (totalAvailable === 0) {
    logWithTimestamp('❌ No invoices found in API');
    return;
  }

  // Load checkpoint
  const checkpoint = await loadCheckpoint();
  let startIndex = 0;
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalExisted = 0;
  let totalErrors = 0;
  let consecutiveErrors = 0;
  let batchCount = 0;

  if (checkpoint) {
    startIndex = checkpoint.startIndex || 0;
    totalProcessed = checkpoint.totalProcessed || 0;
    totalInserted = checkpoint.totalInserted || 0;
    totalExisted = checkpoint.totalExisted || 0;
    totalErrors = checkpoint.totalErrors || 0;
    logWithTimestamp(`🔄 Resuming from index ${startIndex}`);
  }

  logWithTimestamp(`🎯 Processing all ${totalAvailable.toLocaleString()} invoices`);
  logWithTimestamp('');

  // Main processing loop
  while (startIndex < totalAvailable) {
    batchCount++;
    const batchEnd = Math.min(startIndex + CONFIG.BATCH_SIZE, totalAvailable);

    logWithTimestamp(
      `🔄 Batch ${batchCount}: invoices ${(startIndex + 1).toLocaleString()}-${batchEnd.toLocaleString()}`
    );

    // Fetch batch
    const invoices = await fetchInvoiceBatch(startIndex, CONFIG.BATCH_SIZE);

    if (invoices.length === 0) {
      logWithTimestamp(`⚠️  Empty batch received, skipping...`);
      startIndex += CONFIG.BATCH_SIZE;
      continue;
    }

    // Process each invoice
    let batchInserted = 0;
    let batchExisted = 0;
    let batchErrors = 0;

    for (const invoice of invoices) {
      try {
        // Insert customer if needed
        if (invoice.customer_id) {
          await insertCustomerRobust(invoice);
        }

        // Insert invoice
        const result = await insertInvoiceRobust(invoice);

        if (result.success) {
          if (result.existed) {
            batchExisted++;
            totalExisted++;
          } else {
            batchInserted++;
            totalInserted++;
          }
          consecutiveErrors = 0; // Reset consecutive error counter
        } else {
          batchErrors++;
          totalErrors++;
          consecutiveErrors++;

          if (consecutiveErrors >= CONFIG.MAX_CONSECUTIVE_ERRORS) {
            logWithTimestamp(`❌ Too many consecutive errors (${consecutiveErrors}), stopping!`);
            throw new Error('Too many consecutive errors');
          }
        }

        totalProcessed++;

        // Pause between invoices
        await sleep(CONFIG.PAUSE_BETWEEN_INVOICES);
      } catch (err) {
        logWithTimestamp(`💥 Fatal error processing invoice: ${err.message}`);
        throw err;
      }
    }

    startIndex += CONFIG.BATCH_SIZE;

    // Show progress with ETA
    const estimate = await estimateCompletion(totalProcessed, totalAvailable, startTime);
    logWithTimestamp(
      `📊 Batch complete: +${batchInserted} new, +${batchExisted} existed, ${batchErrors} errors`
    );
    logWithTimestamp(
      `📈 Progress: ${totalInserted.toLocaleString()} inserted, ${totalExisted.toLocaleString()} existed, ${totalErrors} errors (${estimate.percentComplete}%)`
    );
    logWithTimestamp(
      `⏱️  ETA: ${estimate.etaHours}h ${estimate.etaMinutes}m (${estimate.rate} invoices/sec)`
    );

    // Save checkpoint periodically
    if (totalProcessed % CONFIG.CHECKPOINT_INTERVAL === 0) {
      await saveCheckpoint({
        startIndex,
        totalProcessed,
        totalInserted,
        totalExisted,
        totalErrors,
        batchCount,
      });
    }

    // Pause between batches
    await sleep(CONFIG.PAUSE_BETWEEN_BATCHES);

    // Longer pause every 50 batches to be extra gentle
    if (batchCount % 50 === 0) {
      logWithTimestamp(`😴 Taking extended pause (batch ${batchCount})...`);
      await sleep(CONFIG.LONG_PAUSE_DURATION);
    }
  }

  // Final results
  const totalTime = (Date.now() - startTime) / 1000;
  const hours = Math.floor(totalTime / 3600);
  const minutes = Math.floor((totalTime % 3600) / 60);

  logWithTimestamp('');
  logWithTimestamp('🎉 AUTONOMOUS BACKFILL COMPLETE!');
  logWithTimestamp('================================');
  logWithTimestamp(`📊 Total available: ${totalAvailable.toLocaleString()}`);
  logWithTimestamp(`📊 Total processed: ${totalProcessed.toLocaleString()}`);
  logWithTimestamp(`✅ New invoices: ${totalInserted.toLocaleString()}`);
  logWithTimestamp(`🔄 Already existed: ${totalExisted.toLocaleString()}`);
  logWithTimestamp(`❌ Errors: ${totalErrors.toLocaleString()}`);
  logWithTimestamp(`⏱️  Total time: ${hours}h ${minutes}m`);
  logWithTimestamp(`📈 Average rate: ${(totalProcessed / totalTime).toFixed(2)} invoices/sec`);

  // Clean up checkpoint
  try {
    const fs = require('fs');
    fs.unlinkSync('autonomous_backfill_checkpoint.json');
    logWithTimestamp('🧹 Checkpoint file cleaned up');
  } catch (err) {
    // Ignore cleanup errors
  }

  logWithTimestamp(`📅 Finished at: ${new Date().toLocaleString()}`);
  logWithTimestamp('🎯 All invoices have been synchronized to Supabase!');
}

// Handle process signals gracefully
process.on('SIGINT', async () => {
  logWithTimestamp('🛑 Received interrupt signal, saving checkpoint...');
  // The checkpoint is already being saved periodically
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logWithTimestamp('🛑 Received termination signal, saving checkpoint...');
  process.exit(0);
});

// Start the process
main().catch((err) => {
  logWithTimestamp(`💥 Autonomous backfill failed: ${err.message}`);
  logWithTimestamp(`💾 Checkpoint should be available for resuming`);
  process.exit(1);
});
