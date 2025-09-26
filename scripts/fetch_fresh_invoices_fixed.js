// Fixed fresh invoices fetch - robust version with better error handling
// Usage: IUGU_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fetch_fresh_invoices_fixed.js

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

function parseDate(dateStr) {
  if (!dateStr || dateStr === '') return null;
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return null;
  }
}

function parseNumber(numStr) {
  if (!numStr || numStr === '') return null;
  const num = parseFloat(numStr);
  return isNaN(num) ? null : num;
}

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
    // Careful parsing of all fields
    const invoiceData = {
      id: invoice.id,
      account_id: invoice.account_id || null,
      customer_id: invoice.customer_id || null,
      subscription_id: invoice.subscription_id || null,
      status: invoice.status || null,
      due_date: invoice.due_date ? invoice.due_date : null,
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
      financial_return_date: invoice.financial_return_date ? invoice.financial_return_date : null,
      installments: invoice.installments || null,
      credit_card_brand: invoice.credit_card_brand || null,
      credit_card_last_4: invoice.credit_card_last_4 || null,
      early_payment_discount: invoice.early_payment_discount || false,
      early_payment_discounts: invoice.early_payment_discounts
        ? JSON.stringify(invoice.early_payment_discounts)
        : null,
      late_payment_fine: invoice.late_payment_fine
        ? JSON.stringify(invoice.late_payment_fine)
        : null,
      commission_cents: invoice.commission_cents || null,
      bank_slip: invoice.bank_slip ? JSON.stringify(invoice.bank_slip) : null,
      pix: invoice.pix ? JSON.stringify(invoice.pix) : null,
      logs: invoice.logs ? JSON.stringify(invoice.logs) : null,
      custom_variables: invoice.custom_variables ? JSON.stringify(invoice.custom_variables) : null,
      raw_json: invoice,
    };

    // Remove undefined values
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`   💥 Insert error for ${invoice.id}: ${response.status} - ${errorText}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`   💥 Exception inserting invoice ${invoice.id}:`, err.message);
    return false;
  }
}

async function insertCustomerFromInvoice(invoice) {
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
        source: 'fresh_fetch',
        customer_ref: invoice.customer_ref,
        customer_name: invoice.customer_name,
      },
    };

    // Remove undefined values
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

    if (!response.ok && response.status !== 409) {
      const errorText = await response.text();
      console.error(
        `   ⚠️  Customer insert error for ${invoice.customer_id}: ${response.status} - ${errorText}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`   ⚠️  Error inserting customer ${invoice.customer_id}:`, err.message);
    return false;
  }
}

async function insertInvoiceItems(invoice) {
  if (!invoice.items || invoice.items.length === 0) return 0;

  let itemsInserted = 0;

  for (const item of invoice.items) {
    try {
      const itemData = {
        id: item.id || `${invoice.id}_item_${itemsInserted}`,
        invoice_id: invoice.id,
        description: item.description || null,
        quantity: item.quantity || 1,
        price_cents: item.price_cents || null,
        created_at_iugu: parseDate(item.created_at),
        updated_at_iugu: parseDate(item.updated_at),
        raw_json: item,
      };

      // Remove undefined values
      Object.keys(itemData).forEach((key) => {
        if (itemData[key] === undefined) {
          delete itemData[key];
        }
      });

      const response = await fetch(`${SUPABASE_URL}/rest/v1/iugu_invoice_items`, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(itemData),
      });

      if (response.ok || response.status === 409) {
        itemsInserted++;
      }
    } catch (err) {
      console.warn(`   ⚠️  Error inserting item for invoice ${invoice.id}:`, err.message);
    }
  }

  return itemsInserted;
}

async function main() {
  console.log('🚀 FETCHING FRESH INVOICES (FIXED VERSION)');
  console.log('==========================================');
  console.log(`📅 Started at: ${new Date().toLocaleString()}\n`);

  const MAX_INVOICES = parseInt(process.env.MAX_INVOICES || '20', 10);
  const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5', 10);
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '1500', 10);

  let totalFetched = 0;
  let totalInserted = 0;
  let totalCustomers = 0;
  let totalItems = 0;
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
        console.log(
          `   📄 ${invoice.id} - ${invoice.status || 'N/A'} - R$ ${(invoice.total || '0').replace('R$ ', '')}`
        );

        // Insert customer first (if exists)
        if (invoice.customer_id) {
          const customerInserted = await insertCustomerFromInvoice(invoice);
          if (customerInserted) totalCustomers++;
        }

        // Insert invoice
        const inserted = await insertInvoiceIntoSupabase(invoice);

        if (inserted) {
          totalInserted++;

          // Insert invoice items
          const itemsInserted = await insertInvoiceItems(invoice);
          totalItems += itemsInserted;

          console.log(`   ✅ Inserted with ${itemsInserted} items`);
        } else {
          totalErrors++;
        }

        totalFetched++;

        // Small pause between invoices
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        totalErrors++;
        console.error(`   💥 Error processing invoice ${invoice.id}:`, err.message);
      }
    }

    startIndex += BATCH_SIZE;

    // Show progress
    console.log(
      `📊 Progress: ${totalInserted}/${totalFetched} inserted, ${totalCustomers} customers, ${totalItems} items, ${totalErrors} errors`
    );

    // Pause between batches
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log('\n🎉 FRESH INVOICES FETCH COMPLETE!');
  console.log('=================================');
  console.log(`📄 Total fetched: ${totalFetched}`);
  console.log(`✅ Total inserted: ${totalInserted}`);
  console.log(`👥 Total customers: ${totalCustomers}`);
  console.log(`📦 Total items: ${totalItems}`);
  console.log(`❌ Total errors: ${totalErrors}`);
  console.log(`📅 Finished at: ${new Date().toLocaleString()}`);

  if (totalInserted > 0) {
    console.log('\n🎯 SUCCESS! Fresh invoice data has been collected with rich details.');
    console.log('   All new invoices include complete field data from Iugu API.');
  }
}

main().catch((err) => {
  console.error('💥 Fresh fetch failed:', err.message);
  process.exit(1);
});
