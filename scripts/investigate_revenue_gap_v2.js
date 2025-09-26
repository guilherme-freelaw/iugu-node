'use strict';

const { createClient } = require('@supabase/supabase-js');

function startEndOfMonthSP(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  // America/Sao_Paulo ~ UTC-3 (sem DST atualmente)
  const toUtcFromSP = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd, 3, 0, 0));
  const start = toUtcFromSP(y, m, 1);
  const end = toUtcFromSP(y, m + 1, 1);
  return { start, end };
}

function isTestId(id) {
  if (!id) return false;
  const v = String(id).toLowerCase();
  return v === 'test_inv' || v.startsWith('test_') || v.includes('teste');
}

function sum(arr, get) {
  return arr.reduce((a, x) => a + (get(x) || 0), 0);
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { start, end } = startEndOfMonthSP(new Date());
  const { data, error } = await supabase
    .from('iugu_invoices')
    .select('id,status,paid_cents,total_cents,paid_at')
    .gte('paid_at', start.toISOString())
    .lt('paid_at', end.toISOString())
    .limit(100000);
  if (error) throw error;

  const rows = (data || []).filter((r) => r.status !== null && !isTestId(r.id));

  const paidOnly = rows.filter((r) => r.status === 'paid');
  const paidOrPartial = rows.filter((r) => r.status === 'paid' || r.status === 'partially_paid');
  const refunds = rows.filter((r) => r.status === 'refunded');

  const results = {
    paid_only_cents: sum(paidOnly, (r) => Number(r.paid_cents)),
    paid_partial_cents: sum(paidOrPartial, (r) => Number(r.paid_cents)),
    total_cents_paid: sum(paidOnly, (r) => Number(r.total_cents)),
    include_refunds_positive_cents:
      sum(paidOrPartial, (r) => Number(r.paid_cents)) + sum(refunds, (r) => Number(r.total_cents)),
    sample_counts: {
      paid_only: paidOnly.length,
      paid_partial: paidOrPartial.length,
      refunds: refunds.length,
      total_rows: rows.length,
    },
  };

  console.log(
    JSON.stringify(
      { period_utc: { start: start.toISOString(), end: end.toISOString() }, results },
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
