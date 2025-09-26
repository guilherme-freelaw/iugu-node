'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getMonthStartSP(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const toUtcFromSP = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd, 3, 0, 0));
  return toUtcFromSP(y, m, 1).toISOString().slice(0, 10);
}

function getTodaySPDate() {
  return new Date().toLocaleString('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const start = getMonthStartSP(new Date());
  const todaySP = getTodaySPDate();
  const now = new Date();

  const { data: invoices, error } = await supabase
    .from('iugu_invoices')
    .select('customer_id,total_cents,status,paid_at,due_date,id,subscription_id')
    .gte('due_date', start)
    .lt('due_date', todaySP)
    .or(`paid_at.is.null,paid_at.gte.${now.toISOString()}`)
    .or('status.is.null,status.in.(pending,expired)')
    .not('id', 'eq', 'test_inv')
    .not('id', 'ilike', 'test_%')
    .not('id', 'ilike', '%teste%')
    .not('customer_id', 'is', null)
    .limit(100000);

  if (error) throw error;

  // Filtrar apenas as faturas com assinatura ativa vinculada
  const withSub = (invoices || []).filter((r) => r.subscription_id);
  const subIds = Array.from(new Set(withSub.map((r) => r.subscription_id))).filter(Boolean);

  let activeSubs = new Set();
  if (subIds.length > 0) {
    const { data: subs, error: sErr } = await supabase
      .from('iugu_subscriptions')
      .select('id,status,expires_at,suspended')
      .in('id', subIds)
      .limit(subIds.length);
    if (sErr) throw sErr;

    const isActive = (sub) => {
      const statusActive = String(sub.status || '').toLowerCase() === 'active';
      const notSuspended = sub.suspended !== true;
      const expiresOk = !sub.expires_at || sub.expires_at >= todaySP;
      return notSuspended && (statusActive || expiresOk);
    };

    activeSubs = new Set((subs || []).filter(isActive).map((s) => s.id));
  }

  const eligible = withSub.filter((r) => activeSubs.has(r.subscription_id));

  const byCustomer = new Map();
  for (const row of eligible) {
    const cid = row.customer_id;
    const cents = Number(row.total_cents || 0);
    byCustomer.set(cid, (byCustomer.get(cid) || 0) + cents);
  }

  const ids = Array.from(byCustomer.keys());
  let customers = [];
  if (ids.length > 0) {
    const { data: custs, error: cErr } = await supabase
      .from('iugu_customers')
      .select('id,name,email,cpf_cnpj')
      .in('id', ids)
      .limit(ids.length);
    if (cErr) throw cErr;
    customers = custs || [];
  }

  const infoById = new Map(customers.map((c) => [c.id, c]));
  const result = ids
    .map((id) => {
      const total_cents = byCustomer.get(id) || 0;
      const c = infoById.get(id) || {};
      return {
        customer_id: id,
        name: c.name || null,
        email: c.email || null,
        cpf_cnpj: c.cpf_cnpj || null,
        total_cents,
        total_brl: toBRL(total_cents),
      };
    })
    .sort((a, b) => b.total_cents - a.total_cents);

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}


