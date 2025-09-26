'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { parse } = require('csv-parse/sync');

function parseArgs() {
  const mArg = process.argv.find((a) => a.startsWith('--month='));
  const csvArg = process.argv.find((a) => a.startsWith('--csv-pay='));
  if (!mArg || !csvArg) throw new Error('Use --month=YYYY-MM --csv-pay=tmp/arquivo.csv');
  return { month: mArg.split('=')[1], csv: csvArg.split('=')[1] };
}

function monthBounds(month) {
  const d = new Date(`${month}-01T00:00:00`);
  const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1, 3, 0, 0));
  const end = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1, 3, 0, 0));
  return { start, end };
}

function normalizeMethodFromRow(r) {
  const pm = (r.payment_method || '').toLowerCase();
  if (pm.includes('pix') || r.pix_end_to_end_id) return 'pix';
  if (pm.includes('credit') || pm.includes('card') || r.secure_url) return 'credit_card';
  if (pm.includes('bank_slip') || pm.includes('boleto') || r.bank_slip_url) return 'bank_slip';
  return 'other';
}

// removed: separator auto-detected by csv-parse
function toCents(v) {
  if (v == null) return 0;
  let s = String(v)
    .trim()
    .replace(/^R\$\s*/i, '');
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}
function normalizeHeader(h) {
  return h.toLowerCase().trim();
}
function normalizeMethodCsv(s) {
  if (!s) return 'other';
  const v = String(s).toLowerCase();
  if (v.includes('pix')) return 'pix';
  if (v.includes('credit') || v.includes('cartão') || v.includes('card')) return 'credit_card';
  if (v.includes('boleto') || v.includes('bank_slip')) return 'bank_slip';
  return 'other';
}

function sumCsvByMethod(csvPath) {
  const buf = fs.readFileSync(path.resolve(csvPath));
  let text = buf.toString('utf8');
  if (/Ã|Ê|Ç|Õ|Ô|Â/.test(text)) text = Buffer.from(buf).toString('latin1');
  const rows = parse(text, {
    columns: (hdrs) => hdrs.map((h) => normalizeHeader(String(h))),
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter: undefined,
  });
  const headers = Object.keys(rows[0] || {});
  const amountKey = headers.find((h) =>
    ['total', 'valor', 'amount', 'value'].some((k) => h.includes(k))
  );
  const methodKey = headers.find((h) =>
    ['paga com', 'method', 'metodo', 'payment_method', 'forma'].some((k) => h.includes(k))
  );
  const sum = { pix: 0, credit_card: 0, bank_slip: 0, other: 0 };
  for (const row of rows) {
    const amt = toCents(row[amountKey]);
    const m = normalizeMethodCsv(methodKey ? row[methodKey] : '');
    sum[m] += amt;
  }
  return sum;
}

async function sumApiByMethod(month) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase
    .from('iugu_invoices')
    .select('payment_method,paid_cents,bank_slip_url,secure_url,pix_end_to_end_id,status,paid_at')
    .in('status', ['paid', 'partially_paid'])
    .gte('paid_at', start.toISOString())
    .lt('paid_at', end.toISOString())
    .limit(200000);
  if (error) throw error;
  const sum = { pix: 0, credit_card: 0, bank_slip: 0, other: 0 };
  for (const r of data || []) {
    const m = normalizeMethodFromRow(r);
    sum[m] += Number(r.paid_cents || 0);
  }
  return sum;
}

function brl(c) {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  const { month, csv } = parseArgs();
  const [api, csvS] = await Promise.all([
    sumApiByMethod(month),
    Promise.resolve(sumCsvByMethod(csv)),
  ]);
  const methods = ['pix', 'credit_card', 'bank_slip', 'other'];
  const out = { month, api_cents: api, csv_cents: csvS, diff_cents: {} };
  for (const m of methods) {
    out.diff_cents[m] = (api[m] || 0) - (csvS[m] || 0);
  }
  out.api_brl = Object.fromEntries(Object.entries(api).map(([k, v]) => [k, brl(v)]));
  out.csv_brl = Object.fromEntries(Object.entries(csvS).map(([k, v]) => [k, brl(v)]));
  out.diff_brl = Object.fromEntries(Object.entries(out.diff_cents).map(([k, v]) => [k, brl(v)]));
  out.api_total_brl = brl(Object.values(api).reduce((a, b) => a + b, 0));
  out.csv_total_brl = brl(Object.values(csvS).reduce((a, b) => a + b, 0));
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
