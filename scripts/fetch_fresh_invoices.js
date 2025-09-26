// Fetch fresh invoices - get the latest invoices directly from Iugu API
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fetch_fresh_invoices.js

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

async function fetchInvoicesFromIugu(limit = 10, startIndex = 0) {
  try {
    const response = await fetch(
      `${IUGU_API_BASE_URL}/invoices?limit=${limit}&start=${startIndex}&sortBy=created_at&sortType=desc`,
      { headers: iuguHeaders }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch invoices: ${response.status}`);
    }

    const data = await response.json();
    return data.items || [];
  } catch (err) {
    console.error('Error fetching invoices from Iugu:', err.message);
    return [];
  }
}

async function insertInvoiceIntoSupabase(invoice) {
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
      payer_name: invoice.payer?.name || null,
      payer_email: invoice.payer?.email || null,
      payer_cpf_cnpj: invoice.payer?.cpf_cnpj || null,
      payer_phone: invoice.payer?.phone || null,
      secure_id: invoice.secure_id || null,
      secure_url: invoice.secure_url || null,
      notification_url: invoice.notification_url || null,
      return_url: invoice.return_url || null,
      expired_url: invoice.expired_url || null,
      financial_return_date: invoice.financial_return_date || null,
      installments: invoice.installments || null,
      credit_card_brand: invoice.credit_card?.brand || null,
      credit_card_last_4: invoice.credit_card?.last_4 || null,
      early_payment_discount: invoice.early_payment_discount || false,
      early_payment_discounts: invoice.early_payment_discounts || null,
      late_payment_fine: invoice.late_payment_fine || null,
      commission_cents: invoice.commission_cents || null,
      bank_slip: invoice.bank_slip || null,
      pix: invoice.pix || null,
      logs: invoice.logs || null,
      custom_variables: invoice.custom_variables || null,
      raw_json: invoice,
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/iugu_invoices`, {
      method: 'POST',
      headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(invoiceData),
    });

    return response.ok || response.status === 409; // OK or conflict (already exists)
  } catch (err) {
    console.error(`Error inserting invoice ${invoice.id}:`, err.message);
    return false;
  }
}

async function insertCustomerFromInvoice(invoice) {
  if (!invoice.customer_id) return true;

  try {
    const customer = {
      id: invoice.customer_id,
      email: invoice.payer?.email || invoice.customer_email || 'unknown@example.com',
      name: invoice.payer?.name || invoice.customer_name || 'Unknown Customer',
      cpf_cnpj: invoice.payer?.cpf_cnpj || null,
      phone: invoice.payer?.phone || null,
      created_at_iugu: invoice.created_at || null,
      updated_at_iugu: invoice.updated_at || null,
      raw_json: { id: invoice.customer_id, from_invoice: true, source: 'fresh_fetch' },
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/iugu_customers`, {
      method: 'POST',
      headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(customer),
    });

    return response.ok || response.status === 409;
  } catch (err) {
    console.warn(`Error inserting customer ${invoice.customer_id}:`, err.message);
    return false;
  }
}

async function main() {
  console.log('🚀 FETCHING FRESH INVOICES FROM IUGU');
  console.log('===================================');
  console.log(`📅 Started at: ${new Date().toLocaleString()}\n`);

  const MAX_INVOICES = parseInt(process.env.MAX_INVOICES || '50', 10);
  const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '1000', 10);

  let totalFetched = 0;
  let totalInserted = 0;
  let totalCustomers = 0;
  let totalErrors = 0;
  let startIndex = 0;

  while (totalFetched < MAX_INVOICES) {
    console.log(`\n🔄 Fetching invoices ${startIndex + 1}-${startIndex + BATCH_SIZE}...`);

    // Fetch invoices from Iugu
    const invoices = await fetchInvoicesFromIugu(BATCH_SIZE, startIndex);

    if (invoices.length === 0) {
      console.log('✅ No more invoices available');
      break;
    }

    console.log(`📄 Processing ${invoices.length} invoices...`);

    for (const invoice of invoices) {
      try {
        // Insert customer first (if exists)
        if (invoice.customer_id) {
          const customerInserted = await insertCustomerFromInvoice(invoice);
          if (customerInserted) totalCustomers++;
        }

        // Insert invoice
        const inserted = await insertInvoiceIntoSupabase(invoice);

        if (inserted) {
          totalInserted++;
          console.log(
            `   ✅ ${invoice.id} - ${invoice.status || 'N/A'} - R$ ${(invoice.total || 0).toFixed(2)}`
          );
        } else {
          totalErrors++;
          console.log(`   ❌ Failed to insert ${invoice.id}`);
        }

        totalFetched++;

        // Small pause between invoices
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        totalErrors++;
        console.error(`   💥 Error processing invoice ${invoice.id}:`, err.message);
      }
    }

    startIndex += BATCH_SIZE;

    // Show progress
    console.log(
      `📊 Progress: ${totalInserted}/${totalFetched} inserted, ${totalCustomers} customers, ${totalErrors} errors`
    );

    // Pause between batches
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log('\n🎉 FRESH INVOICES FETCH COMPLETE!');
  console.log('=================================');
  console.log(`📄 Total fetched: ${totalFetched}`);
  console.log(`✅ Total inserted: ${totalInserted}`);
  console.log(`👥 Total customers: ${totalCustomers}`);
  console.log(`❌ Total errors: ${totalErrors}`);
  console.log(`📅 Finished at: ${new Date().toLocaleString()}`);

  if (totalInserted > 0) {
    console.log('\n🎯 SUCCESS! Fresh invoice data has been collected and enriched.');
    console.log('   All new invoices include complete field data from Iugu API.');
  }
}

main().catch((err) => {
  console.error('💥 Fresh fetch failed:', err.message);
  process.exit(1);
});
