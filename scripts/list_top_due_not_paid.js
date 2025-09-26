'use strict';

const { createClient } = require('@supabase/supabase-js');

function monthBounds(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(Date.UTC(y, m, 1, 3, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 1, 3, 0, 0));
  return {
    start,
    end,
    startStr: start.toISOString().slice(0, 10),
    endStr: end.toISOString().slice(0, 10),
  };
}
function isTestId(id) {
  if (!id) return false;
  const v = String(id).toLowerCase();
  return v === 'test_inv' || v.startsWith('test_') || v.includes('teste');
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { start, end, startStr, endStr } = monthBounds(new Date());

  const { data, error } = await supabase
    .from('iugu_invoices')
    .select(
      'id,customer_id,subscription_id,payment_method,total_cents,paid_cents,status,due_date,paid_at'
    )
    .gte('due_date', startStr)
    .lt('due_date', endStr)
    .order('total_cents', { ascending: false })
    .limit(5000);
  if (error) throw error;

  const rows = (data || []).filter((r) => !isTestId(r.id));
  const notPaidInMonth = rows.filter(
    (r) =>
      !(r.status === 'paid' || r.status === 'partially_paid') ||
      !(r.paid_at && r.paid_at >= start.toISOString() && r.paid_at < end.toISOString())
  );

  const top = notPaidInMonth
    .sort((a, b) => Number(b.total_cents || 0) - Number(a.total_cents || 0))
    .slice(0, 50);

  console.log(
    JSON.stringify(
      { period: { start: startStr, end: endStr }, count: notPaidInMonth.length, top },
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
