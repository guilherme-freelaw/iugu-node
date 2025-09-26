#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SYNC_CHECKPOINT_FILE = 'sync_checkpoint.json';
const fs = require('fs');

function logWithTimestamp(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

function parseIuguDate(dateString) {
  if (!dateString) return null;

  // Se já está em formato ISO, retorna
  if (typeof dateString === 'string' && dateString.includes('T')) {
    return dateString;
  }

  // Converte formatos da Iugu para ISO (versão corrigida)
  if (typeof dateString === 'string') {
    // Formato: "01/07, 13:02" -> "2025-07-01T13:02:00Z"
    const ddmmPattern = /^(\d{1,2})\/(\d{1,2}),\s*(\d{1,2}):(\d{2})$/;
    const ddmmMatch = dateString.match(ddmmPattern);
    if (ddmmMatch) {
      const [, day, month, hour, minute] = ddmmMatch;
      const currentYear = new Date().getFullYear();
      return `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00Z`;
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

    // Verificar se a data é válida e recente (não no passado distante)
    const year = date.getFullYear();
    if (year < 2020 || year > 2030) {
      logWithTimestamp(`⚠️ Data suspeita ignorada: ${dateString} -> ${year}`);
      return null;
    }

    return date.toISOString();
  } catch (err) {
    logWithTimestamp(`⚠️ Erro ao converter data: ${dateString}`);
    return null;
  }
}

async function makeIuguRequest(endpoint, retries = 3, delay = 1000) {
  const url = `${IUGU_API_BASE_URL}${endpoint}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
    'Content-Type': 'application/json',
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { method: 'GET', headers });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      logWithTimestamp(`⚠️ Tentativa ${attempt} falhou, tentando novamente em ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

async function upsertToSupabase(table, data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase ${table} error: ${response.status} - ${errorText}`);
  }

  return response;
}

async function getPlanIdentifiersFromSupabase() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/iugu_plans?select=identifier&limit=10000`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) return new Set();
    const rows = await res.json();
    const set = new Set();
    for (const r of rows) if (r.identifier) set.add(r.identifier);
    return set;
  } catch {
    return new Set();
  }
}

async function querySupabase(pathAndQuery) {
  const url = `${SUPABASE_URL}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase query error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getPlansByIdentifiers(identifiers) {
  if (!identifiers || identifiers.size === 0) return new Set();
  // Monta filtro in.(a,b,c)
  const list = Array.from(identifiers)
    .map((v) => v.replace(/[,()]/g, ''))
    .join(',');
  const url = `${SUPABASE_URL}/rest/v1/iugu_plans?select=identifier&identifier=in.(${encodeURIComponent(list)})`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) return new Set();
    const rows = await res.json();
    const set = new Set();
    for (const r of rows) if (r.identifier) set.add(r.identifier);
    return set;
  } catch {
    return new Set();
  }
}

async function ensurePlansExist(identifiers, priceHints = new Map()) {
  const clean = new Set();
  for (const ident of identifiers) {
    if (!ident) continue;
    if (/test/i.test(ident)) continue;
    clean.add(ident);
  }
  if (clean.size === 0) return 0;

  const existing = await getPlansByIdentifiers(clean);
  const toCreate = [];
  const nowIso = new Date().toISOString();
  for (const ident of clean) {
    if (existing.has(ident)) continue;
    toCreate.push({
      id: `stub_${ident}`,
      name: ident,
      identifier: ident,
      interval: 1,
      value_cents: priceHints.get(ident) || 0,
      created_at_iugu: nowIso,
      updated_at_iugu: nowIso,
      raw_json: { stub_from: 'subscriptions_batch' },
    });
  }
  if (toCreate.length === 0) return 0;
  try {
    await upsertToSupabase('iugu_plans', toCreate);
    return toCreate.length;
  } catch (e) {
    logWithTimestamp(`   ⚠️ Falha ao criar planos do batch: ${e.message}`);
    return 0;
  }
}

async function fetchPlanIdentifiersFromIugu(maxPages = 200) {
  const identifiers = new Set();
  let page = 1;
  const limit = 100;
  try {
    while (true) {
      const start = (page - 1) * limit;
      const endpoint = `/subscriptions?limit=${limit}&start=${start}&sortBy=updated_at&sortType=desc`;
      const response = await makeIuguRequest(endpoint);
      const subs = response.items || [];
      if (subs.length === 0) break;
      for (const s of subs) {
        if (s?.plan_identifier) identifiers.add(s.plan_identifier);
      }
      page++;
      if (page > maxPages) break;
    }
  } catch (e) {
    logWithTimestamp(`⚠️ Falha ao buscar identifiers de planos via Iugu: ${e.message}`);
  }
  return identifiers;
}

async function seedMissingPlansFromSubscriptions() {
  logWithTimestamp('🌱 Semear planos ausentes a partir de assinaturas...');
  const existing = await getPlanIdentifiersFromSupabase();
  const fromIugu = await fetchPlanIdentifiersFromIugu();

  const toCreate = [];
  const nowIso = new Date().toISOString();
  for (const ident of fromIugu) {
    if (!ident) continue;
    if (/test/i.test(ident)) continue; // pular planos de teste
    if (!existing.has(ident)) {
      toCreate.push({
        id: `stub_${ident}`,
        name: ident,
        identifier: ident,
        interval: 1,
        value_cents: 0,
        created_at_iugu: nowIso,
        updated_at_iugu: nowIso,
        raw_json: { stub_from: 'subscriptions_seed' },
      });
    }
  }

  if (toCreate.length === 0) {
    logWithTimestamp('   ✅ Nenhum plano ausente encontrado.');
    return 0;
  }

  try {
    await upsertToSupabase('iugu_plans', toCreate);
    logWithTimestamp(`   ✅ Criados ${toCreate.length} planos mínimos.`);
    return toCreate.length;
  } catch (e) {
    logWithTimestamp(`   ⚠️ Falha ao criar planos mínimos: ${e.message}`);
    return 0;
  }
}

function loadCheckpoint() {
  try {
    if (fs.existsSync(SYNC_CHECKPOINT_FILE)) {
      const data = fs.readFileSync(SYNC_CHECKPOINT_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logWithTimestamp(`⚠️ Erro ao carregar checkpoint: ${error.message}`);
  }

  // Checkpoint padrão - última hora
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return {
    lastSync: oneHourAgo.toISOString(),
    invoices: 0,
    customers: 0,
    subscriptions: 0,
    plans: 0,
    transfers: 0,
    payment_methods: 0,
  };
}

function saveCheckpoint(checkpoint) {
  try {
    fs.writeFileSync(SYNC_CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  } catch (error) {
    logWithTimestamp(`⚠️ Erro ao salvar checkpoint: ${error.message}`);
  }
}

async function syncInvoices(lastSync) {
  logWithTimestamp('📄 Sincronizando faturas...');
  let totalProcessed = 0;
  let page = 1;
  const limit = 100;
  const invoiceIdsBatch = [];

  try {
    while (true) {
      const start = (page - 1) * limit;
      const endpoint = `/invoices?limit=${limit}&start=${start}&updated_at_from=${lastSync}&sortBy=updated_at&sortType=desc`;

      const response = await makeIuguRequest(endpoint);
      const invoices = response.items || [];

      if (invoices.length === 0) break;

      logWithTimestamp(`   📋 Página ${page}: ${invoices.length} faturas`);

      for (const invoice of invoices) {
        try {
          let invoiceData = {
            id: invoice.id,
            status: invoice.status,
            total_cents: invoice.total_cents || 0,
            paid_cents: invoice.paid_cents || 0,
            taxes_cents: invoice.taxes_paid_cents || 0,
            commission_cents: invoice.commission_cents || 0,
            customer_id: invoice.customer_id,
            subscription_id: invoice.subscription_id,
            due_date: parseIuguDate(invoice.due_date),
            paid_at: parseIuguDate(invoice.paid_at),
            created_at_iugu: parseIuguDate(invoice.created_at),
            updated_at_iugu: parseIuguDate(invoice.updated_at),
            payment_method: invoice.payment_method,
            raw_json: invoice,
          };

          // Se faltar customer_id, tentar resolver por subscription
          if (!invoiceData.customer_id && invoiceData.subscription_id) {
            try {
              const sub = await makeIuguRequest(
                `/subscriptions/${encodeURIComponent(invoiceData.subscription_id)}`
              );
              if (sub?.customer_id) invoiceData.customer_id = sub.customer_id;
            } catch {}
          }
          await upsertToSupabase('iugu_invoices', invoiceData);
          totalProcessed++;
          invoiceIdsBatch.push(invoice.id);
        } catch (error) {
          logWithTimestamp(`   ⚠️ Erro ao processar fatura ${invoice.id}: ${error.message}`);
        }
      }

      page++;
      if (page > 50) break; // Limite de segurança
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de faturas: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} faturas sincronizadas`);

  // Sincronizar itens de fatura das faturas processadas
  try {
    const itemCount = await syncInvoiceItemsForInvoices(invoiceIdsBatch);
    if (itemCount > 0)
      logWithTimestamp(`   🧾 ${itemCount} itens de fatura sincronizados (lote atual)`);
  } catch (e) {
    logWithTimestamp(`   ⚠️ Falha ao sincronizar itens de fatura do lote: ${e.message}`);
  }
  return totalProcessed;
}

async function syncInvoiceItemsForInvoices(invoiceIds) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) return 0;
  let total = 0;
  for (const invId of invoiceIds) {
    try {
      const endpoint = `/invoices/${encodeURIComponent(invId)}`;
      const inv = await makeIuguRequest(endpoint);
      const items = Array.isArray(inv?.items) ? inv.items : [];
      for (const it of items) {
        const itemRow = {
          invoice_id: invId,
          description: it.description || null,
          price_cents: it.price_cents || 0,
          quantity: it.quantity || 1,
          raw_json: it,
        };
        await upsertToSupabase('iugu_invoice_items', itemRow);
        total++;
      }
    } catch (e) {
      logWithTimestamp(`   ⚠️ Falha ao buscar itens da fatura ${invId}: ${e.message}`);
    }
  }
  return total;
}

async function syncCustomers(lastSync) {
  logWithTimestamp('👥 Sincronizando clientes...');
  let totalProcessed = 0;

  try {
    const endpoint = `/customers?limit=100&updated_at_from=${lastSync}`;
    const response = await makeIuguRequest(endpoint);
    const customers = response.items || [];

    logWithTimestamp(`   👤 ${customers.length} clientes para sincronizar`);

    for (const customer of customers) {
      try {
        const customerData = {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          cpf_cnpj: customer.cpf_cnpj,
          phone: customer.phone,
          created_at_iugu: parseIuguDate(customer.created_at),
          updated_at_iugu: parseIuguDate(customer.updated_at),
          raw_json: customer,
        };

        await upsertToSupabase('iugu_customers', customerData);
        totalProcessed++;
        // Se necessário, tentar corrigir faturas órfãs deste cliente
        try {
          await fixOrphanInvoicesForCustomer(customer.id);
        } catch {}
      } catch (error) {
        logWithTimestamp(`   ⚠️ Erro ao processar cliente ${customer.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de clientes: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} clientes sincronizados`);
  return totalProcessed;
}

async function fixOrphanInvoicesForCustomer(customerId) {
  if (!customerId) return;
  // Busca faturas do cliente na Iugu e garante vínculo no Supabase
  try {
    const resp = await makeIuguRequest(
      `/invoices?limit=50&customer_id=${encodeURIComponent(customerId)}&sortBy=updated_at&sortType=desc`
    );
    const invoices = resp.items || [];
    for (const inv of invoices) {
      try {
        const invoiceData = {
          id: inv.id,
          customer_id: customerId,
          status: inv.status,
          total_cents: inv.total_cents || 0,
          paid_cents: inv.paid_cents || 0,
          taxes_cents: inv.taxes_paid_cents || 0,
          subscription_id: inv.subscription_id,
          due_date: parseIuguDate(inv.due_date),
          paid_at: parseIuguDate(inv.paid_at),
          created_at_iugu: parseIuguDate(inv.created_at),
          updated_at_iugu: parseIuguDate(inv.updated_at),
          payment_method: inv.payment_method,
          raw_json: inv,
        };
        await upsertToSupabase('iugu_invoices', invoiceData);
      } catch {}
    }
  } catch {}
}

async function syncSubscriptions(lastSync) {
  logWithTimestamp('📋 Sincronizando assinaturas...');
  let totalProcessed = 0;

  try {
    const endpoint = `/subscriptions?limit=100&updated_at_from=${lastSync}`;
    const response = await makeIuguRequest(endpoint);
    const subscriptions = response.items || [];

    logWithTimestamp(`   📝 ${subscriptions.length} assinaturas para sincronizar`);

    // Pré-passo: garantir planos do batch
    const batchIdentifiers = new Set();
    const priceHints = new Map();
    for (const s of subscriptions) {
      if (s?.plan_identifier) {
        batchIdentifiers.add(s.plan_identifier);
        if (typeof s.price_cents === 'number') {
          if (!priceHints.has(s.plan_identifier)) priceHints.set(s.plan_identifier, s.price_cents);
        }
      }
    }
    const createdFromBatch = await ensurePlansExist(batchIdentifiers, priceHints);
    if (createdFromBatch > 0) {
      logWithTimestamp(`   ✅ Criados ${createdFromBatch} planos mínimos do batch de assinaturas.`);
    }

    // Carregar identificadores de planos existentes para validar FK (após garantir)
    const existingPlans = await getPlanIdentifiersFromSupabase();

    for (const subscription of subscriptions) {
      try {
        const planIdentifier = subscription.plan_identifier || null;

        // Após ensure, se ainda não existir, forçar NULL para evitar FK
        const resolvedPlanId =
          planIdentifier && existingPlans.has(planIdentifier) && !/test/i.test(planIdentifier)
            ? planIdentifier
            : null;

        const subscriptionData = {
          id: subscription.id,
          customer_id: subscription.customer_id,
          plan_id: resolvedPlanId,
          suspended: subscription.suspended || false,
          expires_at: parseIuguDate(subscription.expires_at),
          created_at_iugu: parseIuguDate(subscription.created_at),
          updated_at_iugu: parseIuguDate(subscription.updated_at),
          price_cents: subscription.price_cents || 0,
          raw_json: subscription,
        };

        try {
          await upsertToSupabase('iugu_subscriptions', subscriptionData);
        } catch (err) {
          // Tentar uma vez com plan_id=null se houve FK
          if (/23503/.test(err.message)) {
            subscriptionData.plan_id = null;
            await upsertToSupabase('iugu_subscriptions', subscriptionData);
          } else {
            throw err;
          }
        }
        totalProcessed++;
      } catch (error) {
        logWithTimestamp(`   ⚠️ Erro ao processar assinatura ${subscription.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de assinaturas: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} assinaturas sincronizadas`);
  return totalProcessed;
}

async function syncPlans() {
  logWithTimestamp('📊 Sincronizando planos...');
  let totalProcessed = 0;

  try {
    const endpoint = `/plans?limit=100`;
    const response = await makeIuguRequest(endpoint);
    const plans = response.items || [];

    logWithTimestamp(`   📈 ${plans.length} planos para sincronizar`);

    for (const plan of plans) {
      try {
        const planData = {
          id: plan.id,
          name: plan.name,
          identifier: plan.identifier,
          interval: plan.interval || 1,
          value_cents: plan.value_cents || 0,
          created_at_iugu: parseIuguDate(plan.created_at),
          updated_at_iugu: parseIuguDate(plan.updated_at),
          raw_json: plan,
        };

        await upsertToSupabase('iugu_plans', planData);
        totalProcessed++;
      } catch (error) {
        logWithTimestamp(`   ⚠️ Erro ao processar plano ${plan.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de planos: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} planos sincronizados`);
  return totalProcessed;
}

async function syncTransfers(lastSync) {
  logWithTimestamp('💸 Sincronizando transferências...');
  let totalProcessed = 0;

  try {
    const endpoint = `/transfers?limit=100&updated_at_from=${lastSync}`;
    const response = await makeIuguRequest(endpoint);
    const transfers = response.items || [];

    logWithTimestamp(`   💰 ${transfers.length} transferências para sincronizar`);

    for (const transfer of transfers) {
      try {
        const transferData = {
          id: transfer.id,
          amount_cents: transfer.amount_cents || 0,
          status: transfer.status,
          created_at_iugu: parseIuguDate(transfer.created_at),
          updated_at_iugu: parseIuguDate(transfer.updated_at),
          raw_json: transfer,
        };

        await upsertToSupabase('iugu_transfers', transferData);
        totalProcessed++;
      } catch (error) {
        logWithTimestamp(`   ⚠️ Erro ao processar transferência ${transfer.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de transferências: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} transferências sincronizadas`);
  return totalProcessed;
}

async function syncPaymentMethods() {
  logWithTimestamp('💳 Sincronizando métodos de pagamento...');
  let totalProcessed = 0;

  try {
    // Buscar clientes recentes para reduzir escopo
    const recentCustomers = await querySupabase(
      `/rest/v1/iugu_customers?select=id,updated_at_iugu&order=updated_at_iugu.desc&limit=200`
    );
    const customerIds = recentCustomers.map((c) => c.id);
    const paymentMethods = [];
    // Para cada cliente, buscar payment methods na Iugu
    for (const customerId of customerIds) {
      try {
        // Endpoint por cliente (mais confiável)
        const endpoint = `/customers/${encodeURIComponent(customerId)}/payment_methods?limit=100`;
        const res = await makeIuguRequest(endpoint);
        const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
        for (const pm of items) paymentMethods.push(pm);
      } catch (e) {
        logWithTimestamp(`   ⚠️ Falha ao buscar métodos do cliente ${customerId}: ${e.message}`);
      }
    }

    logWithTimestamp(`   💳 ${paymentMethods.length} métodos de pagamento para sincronizar`);

    for (const paymentMethod of paymentMethods) {
      try {
        const paymentMethodData = {
          id: paymentMethod.id,
          customer_id: paymentMethod.customer_id,
          description: paymentMethod.description,
          raw_json: paymentMethod,
        };

        await upsertToSupabase('iugu_payment_methods', paymentMethodData);
        totalProcessed++;
      } catch (error) {
        logWithTimestamp(
          `   ⚠️ Erro ao processar método de pagamento ${paymentMethod.id}: ${error.message}`
        );
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização de métodos de pagamento: ${error.message}`);
  }

  logWithTimestamp(`   ✅ ${totalProcessed} métodos de pagamento sincronizados`);
  return totalProcessed;
}

async function completeHourlySync() {
  const startTime = new Date();
  logWithTimestamp('🚀 Iniciando sincronização horária completa...');

  const checkpoint = loadCheckpoint();
  const lastSync = checkpoint.lastSync;
  logWithTimestamp(`📅 Última sincronização: ${lastSync}`);

  const results = {
    invoices: 0,
    customers: 0,
    subscriptions: 0,
    plans: 0,
    transfers: 0,
    payment_methods: 0,
  };

  try {
    // Sincronizar entidades em ordem correta
    results.plans = await syncPlans(); // garantir base de planos
    await seedMissingPlansFromSubscriptions(); // criar planos mínimos faltantes
    results.invoices = await syncInvoices(lastSync);
    results.customers = await syncCustomers(lastSync);
    results.subscriptions = await syncSubscriptions(lastSync);
    results.transfers = await syncTransfers(lastSync);
    results.payment_methods = await syncPaymentMethods(); // agora busca por clientes recentes

    // Pós-steps: corrigir órfãs e itens recentes
    try {
      const fixed = await fixOrphanInvoicesBatch(200);
      if (fixed > 0) logWithTimestamp(`🔧 Corrigidas ${fixed} faturas órfãs (batch).`);
    } catch (e) {
      logWithTimestamp(`⚠️ Falha na correção de faturas órfãs: ${e.message}`);
    }

    try {
      const recentIds = await getRecentInvoiceIdsFromSupabase(200);
      const items = await syncInvoiceItemsForInvoices(recentIds);
      if (items > 0) logWithTimestamp(`🧾 Backfill de ${items} itens de fatura (recentes).`);
    } catch (e) {
      logWithTimestamp(`⚠️ Falha no backfill de itens de fatura: ${e.message}`);
    }

    // Fallbacks locais para contornar 404 na Iugu
    try {
      const locallyFixed = await fixOrphanInvoicesFromLocal(200);
      if (locallyFixed > 0)
        logWithTimestamp(`🛠️ Corrigidas ${locallyFixed} faturas órfãs via dados locais.`);
    } catch (e) {
      logWithTimestamp(`⚠️ Falha na correção local de faturas órfãs: ${e.message}`);
    }

    try {
      const localItems = await backfillInvoiceItemsFromLocal(200);
      if (localItems > 0)
        logWithTimestamp(`📦 Inseridos ${localItems} itens de fatura a partir de raw_json.`);
    } catch (e) {
      logWithTimestamp(`⚠️ Falha no backfill local de itens de fatura: ${e.message}`);
    }

    // Atualizar checkpoint
    const newCheckpoint = {
      lastSync: startTime.toISOString(),
      ...results,
      completedAt: new Date().toISOString(),
    };

    saveCheckpoint(newCheckpoint);

    const duration = (new Date() - startTime) / 1000;
    const totalRecords = Object.values(results).reduce((sum, count) => sum + count, 0);

    logWithTimestamp('');
    logWithTimestamp('🎉 SINCRONIZAÇÃO HORÁRIA COMPLETA!');
    logWithTimestamp('═'.repeat(50));
    logWithTimestamp(`📄 Faturas: ${results.invoices}`);
    logWithTimestamp(`👥 Clientes: ${results.customers}`);
    logWithTimestamp(`📋 Assinaturas: ${results.subscriptions}`);
    logWithTimestamp(`📊 Planos: ${results.plans}`);
    logWithTimestamp(`💸 Transferências: ${results.transfers}`);
    logWithTimestamp(`💳 Métodos de pagamento: ${results.payment_methods}`);
    logWithTimestamp('─'.repeat(50));
    logWithTimestamp(`🎯 Total: ${totalRecords} registros`);
    logWithTimestamp(`⏱️  Duração: ${duration.toFixed(2)}s`);
    logWithTimestamp('');

    return results;
  } catch (error) {
    logWithTimestamp(`❌ Erro na sincronização: ${error.message}`);
    throw error;
  }
}

async function getRecentInvoiceIdsFromSupabase(limit = 200) {
  try {
    const rows = await querySupabase(
      `/rest/v1/iugu_invoices?select=id&order=updated_at_iugu.desc&limit=${limit}`
    );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

async function fixOrphanInvoicesBatch(limit = 200) {
  let fixed = 0;
  let rows = [];
  try {
    rows = await querySupabase(
      `/rest/v1/iugu_invoices?select=id,subscription_id&customer_id=is.null&order=updated_at_iugu.desc&limit=${limit}`
    );
  } catch {
    return 0;
  }
  for (const row of rows) {
    try {
      const inv = await makeIuguRequest(`/invoices/${encodeURIComponent(row.id)}`);
      let customerId = inv?.customer_id || null;
      if (!customerId && row.subscription_id) {
        try {
          const sub = await makeIuguRequest(
            `/subscriptions/${encodeURIComponent(row.subscription_id)}`
          );
          if (sub?.customer_id) customerId = sub.customer_id;
        } catch {}
      }
      if (customerId) {
        await upsertToSupabase('iugu_invoices', {
          id: row.id,
          customer_id: customerId,
          raw_json: inv || { patched: true },
        });
        fixed++;
      }
    } catch {}
  }
  return fixed;
}

async function fixOrphanInvoicesFromLocal(limit = 200) {
  let fixed = 0;
  let rows = [];
  try {
    rows = await querySupabase(
      `/rest/v1/iugu_invoices?select=id,subscription_id,raw_json&customer_id=is.null&order=updated_at_iugu.desc&limit=${limit}`
    );
  } catch {
    return 0;
  }
  for (const row of rows) {
    try {
      let customerId = row?.raw_json?.customer_id || null;
      if (!customerId && row.subscription_id) {
        try {
          const subs = await querySupabase(
            `/rest/v1/iugu_subscriptions?select=customer_id&id=eq.${encodeURIComponent(row.subscription_id)}&limit=1`
          );
          if (Array.isArray(subs) && subs[0]?.customer_id) customerId = subs[0].customer_id;
        } catch {}
      }
      if (customerId) {
        await upsertToSupabase('iugu_invoices', {
          id: row.id,
          customer_id: customerId,
          raw_json: row.raw_json || { patched_local: true },
        });
        fixed++;
      }
    } catch {}
  }
  return fixed;
}

async function backfillInvoiceItemsFromLocal(limit = 200) {
  let inserted = 0;
  let rows = [];
  try {
    rows = await querySupabase(
      `/rest/v1/iugu_invoices?select=id,raw_json&order=updated_at_iugu.desc&limit=${limit}`
    );
  } catch {
    return 0;
  }
  for (const row of rows) {
    const items = Array.isArray(row?.raw_json?.items) ? row.raw_json.items : [];
    for (const it of items) {
      try {
        const itemRow = {
          invoice_id: row.id,
          description: it.description || null,
          price_cents: it.price_cents || 0,
          quantity: it.quantity || 1,
          raw_json: it,
        };
        await upsertToSupabase('iugu_invoice_items', itemRow);
        inserted++;
      } catch {}
    }
  }
  return inserted;
}

// Executar se chamado diretamente
if (require.main === module) {
  completeHourlySync()
    .then((results) => {
      logWithTimestamp('✅ Sincronização horária concluída com sucesso!');
      process.exit(0);
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = completeHourlySync;
