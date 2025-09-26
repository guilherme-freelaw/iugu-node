// Enrich invoices script - fetch complete invoice data from Iugu API
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/enrich_invoices.js

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

async function getIncompleteInvoices(limit = 10) {
  try {
    // Get invoices that have incomplete data (null status or total_cents)
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,total_cents&or=(status.is.null,total_cents.is.null)&limit=${limit}`,
      { headers: supabaseHeaders }
    );

    if (!response.ok) {
      throw new Error(`Failed to get incomplete invoices: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error('Error getting incomplete invoices:', err.message);
    return [];
  }
}

async function fetchCompleteInvoiceFromIugu(invoiceId) {
  try {
    const response = await fetch(`${IUGU_API_BASE_URL}/invoices/${invoiceId}`, {
      headers: iuguHeaders,
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Invoice ${invoiceId} not found in Iugu`);
        return null;
      }
      throw new Error(`Failed to fetch invoice ${invoiceId}: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error(`Error fetching invoice ${invoiceId}:`, err.message);
    return null;
  }
}

async function updateInvoiceInSupabase(invoiceId, invoiceData) {
  try {
    const updateData = {
      status: invoiceData.status || null,
      due_date: invoiceData.due_date || null,
      paid_at: invoiceData.paid_at || null,
      payment_method: invoiceData.payment_method || null,
      total_cents:
        invoiceData.total_cents || (invoiceData.total ? Math.round(invoiceData.total * 100) : null),
      paid_cents:
        invoiceData.paid_cents || (invoiceData.paid ? Math.round(invoiceData.paid * 100) : null),
      discount_cents:
        invoiceData.discount_cents ||
        (invoiceData.discount ? Math.round(invoiceData.discount * 100) : null),
      taxes_cents:
        invoiceData.taxes_cents || (invoiceData.taxes ? Math.round(invoiceData.taxes * 100) : null),
      external_reference: invoiceData.external_reference || null,
      order_id: invoiceData.order_id || null,
      created_at_iugu: invoiceData.created_at || null,
      updated_at_iugu: invoiceData.updated_at || null,
      payer_name: invoiceData.payer?.name || null,
      payer_email: invoiceData.payer?.email || null,
      payer_cpf_cnpj: invoiceData.payer?.cpf_cnpj || null,
      payer_phone: invoiceData.payer?.phone || null,
      raw_json: invoiceData,
    };

    // Remove null/undefined values
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === null || updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/iugu_invoices?id=eq.${invoiceId}`, {
      method: 'PATCH',
      headers: supabaseHeaders,
      body: JSON.stringify(updateData),
    });

    return response.ok;
  } catch (err) {
    console.error(`Error updating invoice ${invoiceId}:`, err.message);
    return false;
  }
}

async function processInvoiceItems(invoiceData) {
  if (!invoiceData.items || invoiceData.items.length === 0) {
    return 0;
  }

  let processedItems = 0;

  for (const item of invoiceData.items) {
    try {
      const itemData = {
        id: item.id || `${invoiceData.id}_item_${processedItems}`,
        invoice_id: invoiceData.id,
        description: item.description || null,
        quantity: item.quantity || 1,
        price_cents: item.price_cents || (item.price ? Math.round(item.price * 100) : null),
        created_at_iugu: item.created_at || invoiceData.created_at || null,
        updated_at_iugu: item.updated_at || invoiceData.updated_at || null,
        raw_json: item,
      };

      const response = await fetch(`${SUPABASE_URL}/rest/v1/iugu_invoice_items`, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(itemData),
      });

      if (response.ok || response.status === 409) {
        processedItems++;
      }
    } catch (err) {
      console.warn(`Error processing item for invoice ${invoiceData.id}:`, err.message);
    }
  }

  return processedItems;
}

async function main() {
  console.log('🚀 ENRICHING INVOICE DATA');
  console.log('=========================');
  console.log(`📅 Started at: ${new Date().toLocaleString()}\n`);

  const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5', 10);
  const MAX_INVOICES = parseInt(process.env.MAX_INVOICES || '50', 10);
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '1000', 10);

  let totalProcessed = 0;
  let totalEnriched = 0;
  let totalItems = 0;
  let totalErrors = 0;

  while (totalProcessed < MAX_INVOICES) {
    // Get incomplete invoices
    const invoices = await getIncompleteInvoices(BATCH_SIZE);

    if (invoices.length === 0) {
      console.log('✅ No more incomplete invoices found');
      break;
    }

    console.log(`\n🔄 Processing ${invoices.length} invoices...`);

    for (const invoice of invoices) {
      try {
        console.log(`📄 Processing invoice ${invoice.id}...`);

        // Fetch complete data from Iugu
        const completeInvoice = await fetchCompleteInvoiceFromIugu(invoice.id);

        if (completeInvoice) {
          // Update invoice in Supabase
          const updated = await updateInvoiceInSupabase(invoice.id, completeInvoice);

          if (updated) {
            totalEnriched++;
            console.log(`   ✅ Enriched invoice ${invoice.id}`);

            // Process invoice items
            const itemsProcessed = await processInvoiceItems(completeInvoice);
            totalItems += itemsProcessed;

            if (itemsProcessed > 0) {
              console.log(`   📦 Processed ${itemsProcessed} items`);
            }
          } else {
            totalErrors++;
            console.log(`   ❌ Failed to update invoice ${invoice.id}`);
          }
        } else {
          totalErrors++;
          console.log(`   ❌ Could not fetch invoice ${invoice.id} from Iugu`);
        }

        totalProcessed++;

        // Pause between invoices to be gentle with APIs
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      } catch (err) {
        totalErrors++;
        console.error(`   💥 Error processing invoice ${invoice.id}:`, err.message);
      }
    }

    console.log(
      `📊 Progress: ${totalEnriched}/${totalProcessed} enriched, ${totalItems} items, ${totalErrors} errors`
    );

    // Pause between batches
    await new Promise((r) => setTimeout(r, PAUSE_MS * 2));
  }

  console.log('\n🎉 ENRICHMENT COMPLETE!');
  console.log('=======================');
  console.log(`📄 Total processed: ${totalProcessed}`);
  console.log(`✅ Total enriched: ${totalEnriched}`);
  console.log(`📦 Total items: ${totalItems}`);
  console.log(`❌ Total errors: ${totalErrors}`);
  console.log(`📅 Finished at: ${new Date().toLocaleString()}`);
}

main().catch((err) => {
  console.error('💥 Enrichment failed:', err.message);
  process.exit(1);
});
