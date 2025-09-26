'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function rpcOne(supabase, fn, args) {
  const { data, error } = await supabase.rpc(fn, args || {});
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const key = Object.keys(row || { total_cents: 0 })[0] || 'total_cents';
  return Number(row?.[key] || 0);
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);

  const inv = await rpcOne(supabase, 'get_monthly_received', { month_date: today });
  const chg = await rpcOne(supabase, 'get_monthly_charges_received', { month_date: today });
  let refundsNeg = 0;
  try {
    refundsNeg = await rpcOne(supabase, 'get_monthly_refunds', { month_date: today });
  } catch (_) {}

  const scenarios = {
    invoices_only_cents: inv,
    invoices_plus_charges_cents: inv + chg,
    invoices_plus_refunds_positive_cents: inv + Math.abs(refundsNeg),
    invoices_plus_charges_and_refunds_positive_cents: inv + chg + Math.abs(refundsNeg),
  };

  const pretty = Object.fromEntries(
    Object.entries(scenarios).map(([k, v]) => [
      k.replace(/_cents$/, ''),
      { cents: v, brl: toBRL(v) },
    ])
  );
  console.log(JSON.stringify(pretty, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
