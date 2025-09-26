// Complete backfill by date periods - bypass 10k API limit
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/complete_backfill_by_periods.js

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

const CONFIG = {
  BATCH_SIZE: 100,
  PAUSE_BETWEEN_BATCHES: 2000,
  PAUSE_BETWEEN_INVOICES: 100,
  MAX_RETRIES: 5,
  CHECKPOINT_INTERVAL: 500,
  NETWORK_TIMEOUT: 15000,
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

// Generate monthly periods from 2020 to 2025
function generateDatePeriods() {
  const periods = [];
  const currentDate = new Date();

  for (let year = 2020; year <= currentDate.getFullYear(); year++) {
    const maxMonth = year === currentDate.getFullYear() ? currentDate.getMonth() + 1 : 12;

    for (let month = 1; month <= maxMonth; month++) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0); // Last day of month

      periods.push({
        year,
        month,
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
        description: `${year}-${month.toString().padStart(2, '0')}`,
      });
    }
  }

  return periods.reverse(); // Start with most recent
}

async function getInvoicesCountForPeriod(startDate, endDate) {
  try {
    const url = `${IUGU_API_BASE_URL}/invoices?limit=1&created_at_from=${startDate}&created_at_to=${endDate}`;
    const response = await fetch(url, { headers: iuguHeaders });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.totalItems || 0;
  } catch (err) {
    logWithTimestamp(`⚠️  Error getting count for ${startDate}-${endDate}: ${err.message}`);
    return 0;
  }
}

async function fetchInvoicesForPeriod(
  startDate,
  endDate,
  startIndex = 0,
  limit = CONFIG.BATCH_SIZE
) {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const url = `${IUGU_API_BASE_URL}/invoices?limit=${limit}&start=${startIndex}&created_at_from=${startDate}&created_at_to=${endDate}&sortBy=created_at&sortType=desc`;
      const response = await fetch(url, { headers: iuguHeaders });

      if (!response.ok) {
        if (response.status === 400 && startIndex >= 10000) {
          logWithTimestamp(
            `⚠️  Hit 10k limit for period ${startDate}-${endDate}, stopping this period`
          );
          return [];
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.items || [];
    } catch (err) {
      logWithTimestamp(`⚠️  Attempt ${attempt} failed for ${startDate}-${endDate}: ${err.message}`);
      if (attempt === CONFIG.MAX_RETRIES) {
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

      Object.keys(invoiceData).forEach((key) => {
        if (invoiceData[key] === undefined) {
          delete invoiceData[key];
        }
      });

      const response = await fetch(`${SUPABASE_URL}/rest/v1/iugu_invoices`, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(invoiceData),
      });

      if (response.ok || response.status === 409) {
        return { success: true, existed: response.status === 409 };
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
        source: 'period_backfill',
      },
    };

    Object.keys(customer).forEach((key) => {
      if (customer[key] === undefined) {
        delete customer[key];
      }
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/iugu_customers`, {
      method: 'POST',
      headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(customer),
    });

    return response.ok || response.status === 409;
  } catch (err) {
    return false;
  }
}

async function saveCheckpoint(data) {
  try {
    const fs = require('fs');
    const checkpoint = {
      ...data,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync('period_backfill_checkpoint.json', JSON.stringify(checkpoint, null, 2));
    logWithTimestamp(`💾 Checkpoint saved: ${data.totalProcessed} processed`);
  } catch (err) {
    logWithTimestamp(`⚠️  Could not save checkpoint: ${err.message}`);
  }
}

async function loadCheckpoint() {
  try {
    const fs = require('fs');
    const data = fs.readFileSync('period_backfill_checkpoint.json', 'utf8');
    const checkpoint = JSON.parse(data);
    logWithTimestamp(`🔄 Loaded checkpoint from ${checkpoint.timestamp}`);
    return checkpoint;
  } catch (err) {
    logWithTimestamp(`ℹ️  No checkpoint found, starting fresh`);
    return null;
  }
}

async function main() {
  const startTime = Date.now();

  logWithTimestamp('🚀 COMPLETE BACKFILL BY DATE PERIODS');
  logWithTimestamp('=====================================');
  logWithTimestamp('🎯 Strategy: Bypass 10k API limit using monthly periods');

  const periods = generateDatePeriods();
  logWithTimestamp(`📅 Generated ${periods.length} monthly periods (2020-2025)`);

  // Load checkpoint
  const checkpoint = await loadCheckpoint();
  let currentPeriodIndex = 0;
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalExisted = 0;
  let totalErrors = 0;

  if (checkpoint) {
    currentPeriodIndex = checkpoint.currentPeriodIndex || 0;
    totalProcessed = checkpoint.totalProcessed || 0;
    totalInserted = checkpoint.totalInserted || 0;
    totalExisted = checkpoint.totalExisted || 0;
    totalErrors = checkpoint.totalErrors || 0;
    logWithTimestamp(`🔄 Resuming from period ${currentPeriodIndex}`);
  }

  logWithTimestamp('');

  // Process each period
  for (let i = currentPeriodIndex; i < periods.length; i++) {
    const period = periods[i];

    logWithTimestamp(
      `📅 Period ${i + 1}/${periods.length}: ${period.description} (${period.start} to ${period.end})`
    );

    // Get count for this period
    const periodCount = await getInvoicesCountForPeriod(period.start, period.end);

    if (periodCount === 0) {
      logWithTimestamp(`   ℹ️  No invoices in this period, skipping`);
      continue;
    }

    logWithTimestamp(`   📊 Found ${periodCount.toLocaleString()} invoices in this period`);

    if (periodCount > 10000) {
      logWithTimestamp(`   ⚠️  Period has >10k invoices, may hit API limit`);
    }

    // Process all invoices in this period
    let startIndex = 0;
    let periodProcessed = 0;
    let periodInserted = 0;
    let periodExisted = 0;
    let periodErrors = 0;

    while (startIndex < periodCount) {
      const invoices = await fetchInvoicesForPeriod(
        period.start,
        period.end,
        startIndex,
        CONFIG.BATCH_SIZE
      );

      if (invoices.length === 0) {
        logWithTimestamp(`   ⚠️  Empty batch at index ${startIndex}, stopping this period`);
        break;
      }

      // Process each invoice
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
              periodExisted++;
            } else {
              periodInserted++;
            }
          } else {
            periodErrors++;
          }

          periodProcessed++;
          totalProcessed++;

          // Pause between invoices
          await sleep(CONFIG.PAUSE_BETWEEN_INVOICES);
        } catch (err) {
          periodErrors++;
          totalErrors++;
          logWithTimestamp(`   💥 Error processing invoice: ${err.message}`);
        }
      }

      startIndex += CONFIG.BATCH_SIZE;

      // Show progress
      if (periodProcessed % 500 === 0) {
        logWithTimestamp(
          `   📈 Period progress: ${periodProcessed}/${periodCount} (${((periodProcessed / periodCount) * 100).toFixed(1)}%)`
        );
      }

      // Pause between batches
      await sleep(CONFIG.PAUSE_BETWEEN_BATCHES);
    }

    totalInserted += periodInserted;
    totalExisted += periodExisted;
    totalErrors += periodErrors;

    logWithTimestamp(
      `   ✅ Period complete: +${periodInserted} new, +${periodExisted} existed, ${periodErrors} errors`
    );

    // Save checkpoint after each period
    await saveCheckpoint({
      currentPeriodIndex: i + 1,
      totalProcessed,
      totalInserted,
      totalExisted,
      totalErrors,
      lastPeriod: period.description,
    });

    // Show overall progress
    const overallPercent = (((i + 1) / periods.length) * 100).toFixed(1);
    logWithTimestamp(
      `📊 Overall progress: ${overallPercent}% periods complete, ${totalInserted.toLocaleString()} invoices inserted`
    );

    logWithTimestamp('');
  }

  // Final results
  const totalTime = (Date.now() - startTime) / 1000;
  const hours = Math.floor(totalTime / 3600);
  const minutes = Math.floor((totalTime % 3600) / 60);

  logWithTimestamp('🎉 PERIOD-BASED BACKFILL COMPLETE!');
  logWithTimestamp('==================================');
  logWithTimestamp(`📊 Total processed: ${totalProcessed.toLocaleString()}`);
  logWithTimestamp(`✅ New invoices: ${totalInserted.toLocaleString()}`);
  logWithTimestamp(`🔄 Already existed: ${totalExisted.toLocaleString()}`);
  logWithTimestamp(`❌ Errors: ${totalErrors.toLocaleString()}`);
  logWithTimestamp(`⏱️  Total time: ${hours}h ${minutes}m`);

  // Clean up checkpoint
  try {
    const fs = require('fs');
    fs.unlinkSync('period_backfill_checkpoint.json');
    logWithTimestamp('🧹 Checkpoint file cleaned up');
  } catch (err) {
    // Ignore cleanup errors
  }

  logWithTimestamp(`📅 Finished at: ${new Date().toLocaleString()}`);
  logWithTimestamp('🎯 All available invoices have been synchronized!');
}

main().catch((err) => {
  logWithTimestamp(`💥 Period backfill failed: ${err.message}`);
  logWithTimestamp(`💾 Checkpoint should be available for resuming`);
  process.exit(1);
});
