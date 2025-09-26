// Enrich recent invoices script - focus on recent invoices from September 2025
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/enrich_recent_invoices.js

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

async function getRecentInvoices(limit = 10) {
  try {
    // Get recent invoices from September 2025 that might need enrichment
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,status,total_cents,created_at_iugu&created_at_iugu=gte.2025-09-01&order=created_at_iugu.desc&limit=${limit}`,
      { headers: supabaseHeaders }
    );

    if (!response.ok) {
      throw new Error(`Failed to get recent invoices: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error('Error getting recent invoices:', err.message);
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
        console.warn(`   ⚠️  Invoice ${invoiceId} not found in Iugu (might be old/deleted)`);
        return null;
      }
      throw new Error(`Failed to fetch invoice ${invoiceId}: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error(`   💥 Error fetching invoice ${invoiceId}:`, err.message);
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
      secure_id: invoiceData.secure_id || null,
      secure_url: invoiceData.secure_url || null,
      notification_url: invoiceData.notification_url || null,
      return_url: invoiceData.return_url || null,
      expired_url: invoiceData.expired_url || null,
      financial_return_date: invoiceData.financial_return_date || null,
      installments: invoiceData.installments || null,
      credit_card_brand: invoiceData.credit_card?.brand || null,
      credit_card_last_4: invoiceData.credit_card?.last_4 || null,
      early_payment_discount: invoiceData.early_payment_discount || false,
      early_payment_discounts: invoiceData.early_payment_discounts || null,
      late_payment_fine: invoiceData.late_payment_fine || null,
      commission_cents: invoiceData.commission_cents || null,
      bank_slip: invoiceData.bank_slip || null,
      pix: invoiceData.pix || null,
      logs: invoiceData.logs || null,
      custom_variables: invoiceData.custom_variables || null,
      raw_json: invoiceData,
    };

    // Remove null/undefined values to avoid overwriting existing data
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
    console.error(`   💥 Error updating invoice ${invoiceId}:`, err.message);
    return false;
  }
}

async function main() {
  console.log('🚀 ENRICHING RECENT INVOICE DATA');
  console.log('=================================');
  console.log(`📅 Started at: ${new Date().toLocaleString()}\n`);

  const MAX_INVOICES = parseInt(process.env.MAX_INVOICES || '20', 10);
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '1500', 10);

  // Get recent invoices
  const invoices = await getRecentInvoices(MAX_INVOICES);

  if (invoices.length === 0) {
    console.log('❌ No recent invoices found');
    return;
  }

  console.log(`📄 Found ${invoices.length} recent invoices to process\n`);

  let totalProcessed = 0;
  let totalEnriched = 0;
  let totalErrors = 0;
  let totalNotFound = 0;

  for (const invoice of invoices) {
    try {
      console.log(`📄 Processing invoice ${invoice.id} (${invoice.created_at_iugu})...`);

      // Fetch complete data from Iugu
      const completeInvoice = await fetchCompleteInvoiceFromIugu(invoice.id);

      if (completeInvoice) {
        // Update invoice in Supabase
        const updated = await updateInvoiceInSupabase(invoice.id, completeInvoice);

        if (updated) {
          totalEnriched++;
          console.log(`   ✅ Enriched invoice ${invoice.id}`);
          console.log(`      📊 Status: ${completeInvoice.status}`);
          console.log(`      💰 Value: R$ ${(completeInvoice.total || 0).toFixed(2)}`);
          console.log(`      📅 Due: ${completeInvoice.due_date || 'N/A'}`);
          console.log(`      👤 Payer: ${completeInvoice.payer?.name || 'N/A'}`);
        } else {
          totalErrors++;
          console.log(`   ❌ Failed to update invoice ${invoice.id}`);
        }
      } else {
        totalNotFound++;
      }

      totalProcessed++;

      // Pause between invoices to be gentle with APIs
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    } catch (err) {
      totalErrors++;
      console.error(`   💥 Error processing invoice ${invoice.id}:`, err.message);
    }

    // Show progress every 5 invoices
    if (totalProcessed % 5 === 0) {
      console.log(
        `\n📊 Progress: ${totalEnriched}/${totalProcessed} enriched, ${totalNotFound} not found, ${totalErrors} errors\n`
      );
    }
  }

  console.log('\n🎉 RECENT INVOICES ENRICHMENT COMPLETE!');
  console.log('=======================================');
  console.log(`📄 Total processed: ${totalProcessed}`);
  console.log(`✅ Total enriched: ${totalEnriched}`);
  console.log(`⚠️  Not found in Iugu: ${totalNotFound}`);
  console.log(`❌ Total errors: ${totalErrors}`);
  console.log(`📅 Finished at: ${new Date().toLocaleString()}`);

  if (totalEnriched > 0) {
    console.log('\n🎯 SUCCESS! Invoice data has been enriched.');
    console.log('   You can now query the enhanced invoice fields in Supabase.');
  }
}

main().catch((err) => {
  console.error('💥 Enrichment failed:', err.message);
  process.exit(1);
});
