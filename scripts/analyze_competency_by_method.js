'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
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

  // Competência por método (due_date no mês)
  const { data: dueRows, error: dueErr } = await supabase
    .from('iugu_invoices')
    .select('id,payment_method,total_cents,due_date')
    .gte('due_date', startStr)
    .lt('due_date', endStr)
    .limit(200000);
  if (dueErr) throw dueErr;
  const due = {};
  for (const r of dueRows || []) {
    if (isTestId(r.id)) continue;
    const k = r.payment_method || 'unknown';
    due[k] = (due[k] || 0) + Number(r.total_cents || 0);
  }

  // Caixa por método (paid_at no mês)
  const { data: cashRows, error: cashErr } = await supabase
    .from('iugu_invoices')
    .select('id,payment_method,paid_cents,paid_at,status')
    .in('status', ['paid', 'partially_paid'])
    .gte('paid_at', start.toISOString())
    .lt('paid_at', end.toISOString())
    .limit(200000);
  if (cashErr) throw cashErr;
  const cash = {};
  for (const r of cashRows || []) {
    if (isTestId(r.id)) continue;
    const k = r.payment_method || 'unknown';
    cash[k] = (cash[k] || 0) + Number(r.paid_cents || 0);
  }

  // Montar comparação
  const methods = Array.from(new Set([...Object.keys(due), ...Object.keys(cash)])).sort();
  const result = methods.map((m) => ({
    method: m,
    due_cents: due[m] || 0,
    due_brl: toBRL(due[m] || 0),
    cash_cents: cash[m] || 0,
    cash_brl: toBRL(cash[m] || 0),
    gap_cents: (due[m] || 0) - (cash[m] || 0),
    gap_brl: toBRL((due[m] || 0) - (cash[m] || 0)),
  }));

  const totals = {
    due_total_cents: result.reduce((a, x) => a + x.due_cents, 0),
    due_total_brl: toBRL(result.reduce((a, x) => a + x.due_cents, 0)),
    cash_total_cents: result.reduce((a, x) => a + x.cash_cents, 0),
    cash_total_brl: toBRL(result.reduce((a, x) => a + x.cash_cents, 0)),
    gap_total_cents: result.reduce((a, x) => a + x.gap_cents, 0),
    gap_total_brl: toBRL(result.reduce((a, x) => a + x.gap_cents, 0)),
  };

  console.log(
    JSON.stringify({ period: { start: startStr, end: endStr }, by_method: result, totals }, null, 2)
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
