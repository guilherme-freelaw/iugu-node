#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

// Configurações
const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!IUGU_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
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

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

function parseIuguDate(dateString) {
  if (!dateString) return null;

  // Se já está em formato ISO, retorna
  if (typeof dateString === 'string' && dateString.includes('T')) {
    return dateString;
  }

  // Converte formatos da Iugu para ISO
  if (typeof dateString === 'string') {
    // Formato: "13/09, 13:49" -> "2025-09-13T13:49:00Z"
    const ddmmPattern = /^(\d{2})\/(\d{2}),\s*(\d{2}):(\d{2})$/;
    const ddmmMatch = dateString.match(ddmmPattern);
    if (ddmmMatch) {
      const [, day, month, hour, minute] = ddmmMatch;
      const currentYear = new Date().getFullYear();
      return `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:00Z`;
    }

    // Formato: "26 Feb 10:20 PM" -> "2025-02-26T22:20:00Z"
    const monthNamePattern = /^(\d{1,2})\s+(\w{3})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i;
    const monthNameMatch = dateString.match(monthNamePattern);
    if (monthNameMatch) {
      const [, day, monthName, hour, minute, ampm] = monthNameMatch;
      const months = {
        jan: '01',
        feb: '02',
        mar: '03',
        apr: '04',
        may: '05',
        jun: '06',
        jul: '07',
        aug: '08',
        sep: '09',
        oct: '10',
        nov: '11',
        dec: '12',
      };
      const month = months[monthName.toLowerCase()];
      if (month) {
        let hour24 = parseInt(hour);
        if (ampm.toUpperCase() === 'PM' && hour24 !== 12) hour24 += 12;
        if (ampm.toUpperCase() === 'AM' && hour24 === 12) hour24 = 0;

        const currentYear = new Date().getFullYear();
        return `${currentYear}-${month}-${day.padStart(2, '0')}T${hour24.toString().padStart(2, '0')}:${minute}:00Z`;
      }
    }

    // Formato: "2025-09-13" -> "2025-09-13T00:00:00Z"
    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (dateOnlyPattern.test(dateString)) {
      return `${dateString}T00:00:00Z`;
    }
  }

  // Se não conseguir converter, tenta criar data válida ou retorna null
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (err) {
    logWithTimestamp(`⚠️ Could not parse date: ${dateString}`);
    return null;
  }
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

async function getLastSyncTime() {
  try {
    const data = fs.readFileSync('hourly_sync_checkpoint.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // Se não existe checkpoint, começar da última hora
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return {
      lastSync: oneHourAgo.toISOString(),
      lastInvoiceId: null,
      totalSynced: 0,
    };
  }
}

async function saveCheckpoint(data) {
  try {
    fs.writeFileSync('hourly_sync_checkpoint.json', JSON.stringify(data, null, 2));
    logWithTimestamp(`💾 Checkpoint saved: ${data.totalSynced} total synced`);
  } catch (err) {
    logWithTimestamp(`⚠️  Could not save checkpoint: ${err.message}`);
  }
}

async function fetchNewInvoices(since) {
  const url = `${IUGU_API_BASE_URL}/invoices?limit=100&created_at_from=${since}&sortBy=created_at&sortType=asc`;

  try {
    const response = await makeRequest(url, { headers: iuguHeaders });
    return response.items || [];
  } catch (err) {
    logWithTimestamp(`❌ Error fetching invoices: ${err.message}`);
    return [];
  }
}

async function fetchNewCustomers(since) {
  const url = `${IUGU_API_BASE_URL}/customers?limit=100&created_at_from=${since}`;

  try {
    const response = await makeRequest(url, { headers: iuguHeaders });
    return response.items || [];
  } catch (err) {
    logWithTimestamp(`❌ Error fetching customers: ${err.message}`);
    return [];
  }
}

async function fetchNewSubscriptions(since) {
  const url = `${IUGU_API_BASE_URL}/subscriptions?limit=100&created_at_from=${since}`;

  try {
    const response = await makeRequest(url, { headers: iuguHeaders });
    return response.items || [];
  } catch (err) {
    logWithTimestamp(`❌ Error fetching subscriptions: ${err.message}`);
    return [];
  }
}

async function upsertInvoices(invoices) {
  if (invoices.length === 0) return 0;

  let inserted = 0;

  for (const invoice of invoices) {
    try {
      // Preparar dados da fatura
      const invoiceData = {
        id: invoice.id,
        account_id: invoice.account_id,
        customer_id: invoice.customer_id,
        subscription_id: invoice.subscription_id,
        status: invoice.status,
        due_date: parseIuguDate(invoice.due_date),
        paid_at: parseIuguDate(invoice.paid_at),
        payment_method: invoice.payment_method,
        total_cents: invoice.total_cents || invoice.total * 100,
        paid_cents: invoice.paid_cents || invoice.paid * 100,
        discount_cents: invoice.discount_cents || invoice.discount * 100,
        taxes_cents: invoice.taxes_cents || invoice.taxes * 100,
        commission_cents: invoice.commission_cents,
        external_reference: invoice.external_reference,
        order_id: invoice.order_id,
        created_at_iugu: parseIuguDate(invoice.created_at),
        updated_at_iugu: parseIuguDate(invoice.updated_at),
        payer_name: invoice.payer_name,
        payer_email: invoice.payer_email,
        payer_cpf_cnpj: invoice.payer_cpf_cnpj,
        payer_phone: invoice.payer_phone,
        secure_id: invoice.secure_id,
        secure_url: invoice.secure_url,
        raw_json: invoice,
      };

      // Inserir no Supabase
      const response = await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_invoices`, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(invoiceData),
      });

      inserted++;
    } catch (err) {
      logWithTimestamp(`⚠️  Error upserting invoice ${invoice.id}: ${err.message}`);
    }
  }

  return inserted;
}

async function upsertCustomers(customers) {
  if (customers.length === 0) return 0;

  let inserted = 0;

  for (const customer of customers) {
    try {
      const customerData = {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        cpf_cnpj: customer.cpf_cnpj,
        phone: customer.phone,
        created_at_iugu: parseIuguDate(customer.created_at),
        updated_at_iugu: parseIuguDate(customer.updated_at),
        raw_json: customer,
      };

      await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_customers`, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(customerData),
      });

      inserted++;
    } catch (err) {
      logWithTimestamp(`⚠️  Error upserting customer ${customer.id}: ${err.message}`);
    }
  }

  return inserted;
}

async function upsertSubscriptions(subscriptions) {
  if (subscriptions.length === 0) return 0;

  let inserted = 0;

  for (const subscription of subscriptions) {
    try {
      const subscriptionData = {
        id: subscription.id,
        customer_id: subscription.customer_id,
        plan_id: subscription.plan_id,
        suspended: subscription.suspended || false,
        active: subscription.active || false,
        expires_at: parseIuguDate(subscription.expires_at),
        created_at_iugu: parseIuguDate(subscription.created_at),
        updated_at_iugu: parseIuguDate(subscription.updated_at),
        raw_json: subscription,
      };

      await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_subscriptions`, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(subscriptionData),
      });

      inserted++;
    } catch (err) {
      logWithTimestamp(`⚠️  Error upserting subscription ${subscription.id}: ${err.message}`);
    }
  }

  return inserted;
}

async function performHourlySync() {
  logWithTimestamp('🔄 STARTING HOURLY SYNC');
  logWithTimestamp('=====================');

  try {
    // Carregar último checkpoint
    const checkpoint = await getLastSyncTime();
    const since = checkpoint.lastSync;

    logWithTimestamp(`📅 Syncing data since: ${since}`);

    // Buscar novos dados
    logWithTimestamp('📥 Fetching new invoices...');
    const newInvoices = await fetchNewInvoices(since);

    logWithTimestamp('👥 Fetching new customers...');
    const newCustomers = await fetchNewCustomers(since);

    logWithTimestamp('📋 Fetching new subscriptions...');
    const newSubscriptions = await fetchNewSubscriptions(since);

    logWithTimestamp(
      `📊 Found: ${newInvoices.length} invoices, ${newCustomers.length} customers, ${newSubscriptions.length} subscriptions`
    );

    // Inserir dados
    const insertedCustomers = await upsertCustomers(newCustomers);
    const insertedSubscriptions = await upsertSubscriptions(newSubscriptions);
    const insertedInvoices = await upsertInvoices(newInvoices);

    // Atualizar checkpoint
    const newCheckpoint = {
      lastSync: new Date().toISOString(),
      lastInvoiceId:
        newInvoices.length > 0 ? newInvoices[newInvoices.length - 1].id : checkpoint.lastInvoiceId,
      totalSynced:
        checkpoint.totalSynced + insertedInvoices + insertedCustomers + insertedSubscriptions,
      lastRun: {
        timestamp: new Date().toISOString(),
        invoices: insertedInvoices,
        customers: insertedCustomers,
        subscriptions: insertedSubscriptions,
      },
    };

    await saveCheckpoint(newCheckpoint);

    logWithTimestamp('✅ SYNC COMPLETED SUCCESSFULLY');
    logWithTimestamp(
      `📈 Inserted: ${insertedInvoices} invoices, ${insertedCustomers} customers, ${insertedSubscriptions} subscriptions`
    );
    logWithTimestamp(`📊 Total synced: ${newCheckpoint.totalSynced} records`);

    return {
      success: true,
      inserted: {
        invoices: insertedInvoices,
        customers: insertedCustomers,
        subscriptions: insertedSubscriptions,
      },
    };
  } catch (err) {
    logWithTimestamp(`❌ Sync failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  performHourlySync()
    .then((result) => {
      if (result.success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch((err) => {
      logWithTimestamp(`💥 Fatal error: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { performHourlySync };
