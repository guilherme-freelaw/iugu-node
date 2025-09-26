'use strict';

const { createClient } = require('@supabase/supabase-js');

function cents(n) {
  return Number(n || 0);
}

async function fetchRow(supabase, query) {
  const { data, error } = await supabase.rpc(query.fn, query.args || {});
  if (error) throw error;
  return data;
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase envs');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Saldo atual via RPC
  const { data: balances, error: bErr } = await supabase.from('get_current_balances').select('*');
  // Supabase não permite select direto em function; usar rpc
  const { data: balRpc, error: balErr } = await supabase.rpc('get_current_balances');
  if (balErr) throw balErr;

  // 2) Saldo total via view
  const { data: totalView, error: tErr } = await supabase
    .from('kpi_total_balance')
    .select('total_cents');
  if (tErr) throw tErr;
  const totalViewCents = cents(totalView?.[0]?.total_cents);

  // 3) Recalcular saldo total a partir do último snapshot por conta
  let totalCalc = 0;
  for (const row of balRpc || []) {
    totalCalc += cents(row.available_cents) + cents(row.receivable_cents);
  }

  // 4) Recebimentos do mês e mês anterior
  const { data: mNow, error: mErr } = await supabase.rpc('get_monthly_received', {
    month_date: new Date().toISOString().slice(0, 10),
  });
  if (mErr) throw mErr;
  const { data: mPrev, error: pErr } = await supabase.rpc('get_previous_month_received', {
    ref_date: new Date().toISOString().slice(0, 10),
  });
  if (pErr) throw pErr;

  // 4b) Taxes e refunds para comparação
  const { data: taxesNow, error: tNowErr } = await supabase
    .from('iugu_invoices')
    .select('taxes_cents')
    .eq('status', 'paid')
    .gte('paid_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
    .lt('paid_at', new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString())
    .limit(100000);
  if (tNowErr) throw tNowErr;
  const taxesNowSum = (taxesNow || []).reduce((a, b) => a + cents(b.taxes_cents), 0);

  const prevStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const prevEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const { data: taxesPrev, error: tPrevErr } = await supabase
    .from('iugu_invoices')
    .select('taxes_cents')
    .eq('status', 'paid')
    .gte('paid_at', prevStart.toISOString())
    .lt('paid_at', prevEnd.toISOString())
    .limit(100000);
  if (tPrevErr) throw tPrevErr;
  const taxesPrevSum = (taxesPrev || []).reduce((a, b) => a + cents(b.taxes_cents), 0);

  // 5) Total de assinantes via view
  const { data: subsView, error: sErr } = await supabase
    .from('kpi_total_subscribers')
    .select('total_subscribers');
  if (sErr) throw sErr;
  const subsViewCount = subsView?.[0]?.total_subscribers || 0;

  // 6) Recalcular assinantes (regra da view)
  const { data: subsCalc, error: scErr } = await supabase
    .from('iugu_subscriptions')
    .select('id, status, expires_at')
    .limit(100000);
  if (scErr) throw scErr;
  const subsRecalc = (subsCalc || []).filter(
    (s) => (s.status || '') === 'active' || !s.expires_at || new Date(s.expires_at) >= new Date()
  ).length;

  const result = {
    current_balances: balRpc,
    total_balance_view_cents: totalViewCents,
    total_balance_recalc_cents: totalCalc,
    monthly_received_cents: cents(mNow?.[0]?.total_cents || 0),
    previous_month_received_cents: cents(mPrev?.[0]?.total_cents || 0),
    monthly_taxes_cents: taxesNowSum,
    previous_month_taxes_cents: taxesPrevSum,
    total_subscribers_view: subsViewCount,
    total_subscribers_recalc: subsRecalc,
  };

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
