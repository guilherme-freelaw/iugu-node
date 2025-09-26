'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthStartSP(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1, 3, 0, 0));
}
function addMonthsSP(date, n) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth() + n, 1, 3, 0, 0));
}

async function getCurrentBalances(supabase) {
  const { data, error } = await supabase.rpc('get_current_balances');
  if (error) throw error;
  let available = 0,
    receivable = 0;
  for (const r of data || []) {
    available += Number(r.available_cents || 0);
    receivable += Number(r.receivable_cents || 0);
  }
  return { available_cents: available, receivable_cents: receivable };
}

async function revenuePaidInMonth(supabase, monthDate) {
  const { data, error } = await supabase.rpc('get_monthly_received', { month_date: monthDate });
  if (error) throw error;
  return Number((data || [])[0]?.total_cents || 0);
}

async function refundsInMonth(supabase, monthDate) {
  try {
    const { data, error } = await supabase.rpc('get_monthly_refunds', { month_date: monthDate });
    if (error) return 0;
    return Math.abs(Number((data || [])[0]?.refunds_cents || 0));
  } catch {
    return 0;
  }
}

async function taxesInMonth(supabase, startIso, endIso) {
  const { data, error } = await supabase
    .from('iugu_invoices')
    .select('taxes_cents')
    .in('status', ['paid', 'partially_paid'])
    .gte('paid_at', startIso)
    .lt('paid_at', endIso)
    .limit(200000);
  if (error) throw error;
  return (data || []).reduce((a, b) => a + Number(b.taxes_cents || 0), 0);
}

async function countsInMonth(supabase, startDate, endDate) {
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();
  const [inv, subs, cust] = await Promise.all([
    supabase
      .from('iugu_invoices')
      .select('id', { count: 'exact', head: true })
      .gte('created_at_iugu', startIso)
      .lt('created_at_iugu', endIso),
    supabase
      .from('iugu_subscriptions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at_iugu', startIso)
      .lt('created_at_iugu', endIso),
    supabase
      .from('iugu_customers')
      .select('id', { count: 'exact', head: true })
      .gte('created_at_iugu', startIso)
      .lt('created_at_iugu', endIso),
  ]);
  return {
    invoices_created: inv.count || 0,
    subscriptions_created: subs.count || 0,
    customers_created: cust.count || 0,
  };
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  const start = monthStartSP(addMonthsSP(now, -5)); // últimos 6 meses incluindo atual

  const rows = [];
  for (let i = 0; i < 6; i++) {
    const mStart = addMonthsSP(start, i);
    const mEnd = addMonthsSP(start, i + 1);
    const monthDateStr = mStart.toISOString().slice(0, 10);
    const paid = await revenuePaidInMonth(supabase, monthDateStr);
    const refunds = await refundsInMonth(supabase, monthDateStr);
    const taxes = await taxesInMonth(supabase, mStart.toISOString(), mEnd.toISOString());
    const counts = await countsInMonth(supabase, mStart, mEnd);
    rows.push({
      month: monthDateStr,
      paid_cents: paid,
      refunds_cents: refunds,
      taxes_cents: taxes,
      net_after_taxes_and_refunds_cents: paid - taxes - refunds,
      ...counts,
    });
  }

  const balances = await getCurrentBalances(supabase);

  const pretty = rows.map((r) => ({
    month: r.month,
    paid: toBRL(r.paid_cents),
    taxes: toBRL(r.taxes_cents),
    refunds: toBRL(r.refunds_cents),
    net_after_taxes_and_refunds: toBRL(r.net_after_taxes_and_refunds_cents),
    invoices_created: r.invoices_created,
    subscriptions_created: r.subscriptions_created,
    customers_created: r.customers_created,
  }));

  console.log(
    JSON.stringify(
      {
        balances: {
          available_brl: toBRL(balances.available_cents),
          receivable_brl: toBRL(balances.receivable_cents),
        },
        months: pretty,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
