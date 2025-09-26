// Direct batch processor - bypasses RPC issues by processing data directly
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/direct_batch_processor.js

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

async function getPendingBatches(limit = 5) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/staging.iugu_batches?select=id,page,payload&status=eq.pending&order=page.asc&limit=${limit}`,
      {
        headers,
      }
    );

    if (!res.ok) {
      console.error('Failed to get pending batches:', res.status);
      return [];
    }

    return await res.json();
  } catch (err) {
    console.error('Error getting pending batches:', err.message);
    return [];
  }
}

async function markBatchAsProcessing(batchId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/staging.iugu_batches?id=eq.${batchId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'processing',
        processed_at: new Date().toISOString(),
      }),
    });

    return res.ok;
  } catch (err) {
    console.warn('Error marking batch as processing:', err.message);
    return false;
  }
}

async function markBatchAsDone(batchId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/staging.iugu_batches?id=eq.${batchId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'done',
        processed_at: new Date().toISOString(),
      }),
    });

    return res.ok;
  } catch (err) {
    console.warn('Error marking batch as done:', err.message);
    return false;
  }
}

async function upsertCustomer(invoice) {
  if (!invoice.customer_id) return true;

  try {
    const customer = {
      id: invoice.customer_id,
      email: invoice.customer_email || invoice.email || 'unknown@example.com',
      name: invoice.customer_name || invoice.payer_name || 'Unknown Customer',
      cpf_cnpj: invoice.payer_cpf_cnpj || null,
      phone: invoice.payer_phone || null,
      created_at_iugu: invoice.created_at || null,
      updated_at_iugu: invoice.updated_at || null,
      raw_json: { id: invoice.customer_id, from_invoice: true },
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/iugu_customers`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(customer),
    });

    return res.ok || res.status === 409; // OK or conflict (already exists)
  } catch (err) {
    console.warn(`Error upserting customer ${invoice.customer_id}:`, err.message);
    return false;
  }
}

async function upsertInvoice(invoice) {
  try {
    const invoiceData = {
      id: invoice.id,
      account_id: invoice.account_id || null,
      customer_id: invoice.customer_id || null,
      subscription_id: invoice.subscription_id || null,
      status: invoice.status || null,
      due_date: invoice.due_date || null,
      paid_at: invoice.paid_at || null,
      payment_method: invoice.payment_method || null,
      total_cents: invoice.total_cents || (invoice.total ? Math.round(invoice.total * 100) : null),
      paid_cents: invoice.paid_cents || (invoice.paid ? Math.round(invoice.paid * 100) : null),
      discount_cents:
        invoice.discount_cents || (invoice.discount ? Math.round(invoice.discount * 100) : null),
      taxes_cents: invoice.taxes_cents || (invoice.taxes ? Math.round(invoice.taxes * 100) : null),
      external_reference: invoice.external_reference || null,
      order_id: invoice.order_id || null,
      created_at_iugu: invoice.created_at || null,
      updated_at_iugu: invoice.updated_at || null,
      raw_json: invoice,
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/iugu_invoices`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(invoiceData),
    });

    return res.ok || res.status === 409; // OK or conflict (already exists)
  } catch (err) {
    console.warn(`Error upserting invoice ${invoice.id}:`, err.message);
    return false;
  }
}

async function processBatch(batch) {
  console.log(`🔄 Processing batch ${batch.id} (page ${batch.page})`);

  // Mark as processing
  await markBatchAsProcessing(batch.id);

  const invoices = batch.payload || [];
  let processed = 0;
  let failed = 0;

  for (const invoice of invoices) {
    try {
      // First upsert customer (if exists)
      await upsertCustomer(invoice);

      // Then upsert invoice
      const success = await upsertInvoice(invoice);

      if (success) {
        processed++;
      } else {
        failed++;
      }

      // Small pause to be gentle
      await new Promise((r) => setTimeout(r, 50));
    } catch (err) {
      console.warn(`Error processing invoice ${invoice.id}:`, err.message);
      failed++;
    }
  }

  // Mark as done
  await markBatchAsDone(batch.id);

  console.log(`✅ Batch ${batch.id}: ${processed} processed, ${failed} failed`);
  return { processed, failed };
}

async function main() {
  console.log('🚀 DIRECT BATCH PROCESSING');
  console.log('==========================');
  console.log(`📅 Started at: ${new Date().toLocaleString()}\n`);

  const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '3', 10);
  const MAX_CYCLES = parseInt(process.env.MAX_CYCLES || '10', 10);
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '2000', 10);

  let totalProcessed = 0;
  let totalFailed = 0;
  let cycle = 0;

  while (cycle < MAX_CYCLES) {
    // Get pending batches
    const batches = await getPendingBatches(BATCH_SIZE);

    if (batches.length === 0) {
      console.log('✅ No more pending batches found');
      break;
    }

    console.log(`\n🔄 Cycle ${cycle + 1}: Processing ${batches.length} batches`);

    // Process each batch
    for (const batch of batches) {
      const result = await processBatch(batch);
      totalProcessed += result.processed;
      totalFailed += result.failed;

      // Pause between batches
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }

    cycle++;

    // Show progress
    console.log(`📊 Progress: ${totalProcessed} processed, ${totalFailed} failed`);

    // Pause between cycles
    await new Promise((r) => setTimeout(r, PAUSE_MS * 2));
  }

  console.log('\n🎉 DIRECT PROCESSING COMPLETE!');
  console.log('==============================');
  console.log(`📊 Total processed: ${totalProcessed}`);
  console.log(`❌ Total failed: ${totalFailed}`);
  console.log(`🔄 Cycles completed: ${cycle}`);
  console.log(`📅 Finished at: ${new Date().toLocaleString()}`);
}

main().catch((err) => {
  console.error('💥 Direct processing failed:', err.message);
  process.exit(1);
});
