'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthBoundsSP(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(Date.UTC(y, m, 1, 3, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 1, 3, 0, 0));
  return { start, end, startStr: start.toISOString().slice(0, 10) };
}

async function latestSumReceivableBefore(supabase, cutoffIso) {
  const { data, error } = await supabase
    .from('iugu_account_balances')
    .select('account_id, receivable_cents, captured_at')
    .lt('captured_at', cutoffIso)
    .order('captured_at', { ascending: false })
    .limit(10000);
  if (error) throw error;
  const byAcc = new Map();
  for (const r of data || []) if (!byAcc.has(r.account_id)) byAcc.set(r.account_id, r);
  let sum = 0;
  for (const r of byAcc.values()) sum += Number(r.receivable_cents || 0);
  return sum;
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { start, end } = monthBoundsSP(new Date());

  // receita híbrida (base)
  const { data: d1, error: e1 } = await supabase.rpc('get_monthly_revenue_hybrid', {
    month_date: start.toISOString().slice(0, 10),
  });
  if (e1) throw e1;
  const hybridCents = Number((d1 || [])[0]?.total_cents || 0);

  // delta receivable
  const startReceivable = await latestSumReceivableBefore(supabase, start.toISOString());
  const endReceivable = await latestSumReceivableBefore(supabase, end.toISOString());
  const receivableDelta = Math.max(0, endReceivable - startReceivable);

  const combined = hybridCents + receivableDelta;

  console.log(
    JSON.stringify(
      {
        hybrid_cents: hybridCents,
        hybrid_brl: toBRL(hybridCents),
        receivable_start_cents: startReceivable,
        receivable_end_cents: endReceivable,
        receivable_delta_cents: receivableDelta,
        receivable_delta_brl: toBRL(receivableDelta),
        combined_brl: toBRL(combined),
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
