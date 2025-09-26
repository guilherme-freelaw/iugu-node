'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { parse } = require('csv-parse/sync');

function parseArgs() {
  const arg = process.argv.find((a) => a.startsWith('--file='));
  if (!arg) throw new Error('Use --file=tmp/arquivo.csv');
  const file = arg.split('=')[1];
  const monthArg = process.argv.find((a) => a.startsWith('--month='));
  const month = monthArg ? monthArg.split('=')[1] : null; // YYYY-MM
  return { file, month };
}

function toCents(value) {
  if (value == null) return 0;
  let s = String(value)
    .trim()
    .replace(/^R\$\s*/i, '');
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

function normalizeHeader(h) {
  const v = h.toLowerCase().trim();
  if (['data', 'date'].includes(v)) return 'date';
  if (['descricao', 'description', 'memo'].includes(v)) return 'description';
  if (['valor', 'amount', 'value'].includes(v)) return 'amount';
  if (['metodo', 'method', 'payment_method', 'forma'].includes(v)) return 'method';
  if (['referencia', 'reference', 'invoice_id', 'id'].includes(v)) return 'reference';
  return v;
}

async function main() {
  const { file, month } = parseArgs();
  const buf = fs.readFileSync(path.resolve(file));
  let text = buf.toString('utf8');
  if (/Ã|Ê|Ç|Õ|Ô|Â/.test(text)) text = Buffer.from(buf).toString('latin1');
  const rows = parse(text, {
    columns: (hdrs) => hdrs.map((h) => normalizeHeader(String(h))),
    skip_empty_lines: true,
    relax_column_count: true,
  });
  if (rows.length === 0) throw new Error('CSV vazio');
  const headers = Object.keys(rows[0]);
  const findKey = (...alts) => headers.find((h) => alts.some((k) => h.includes(k)));
  const amountKey = findKey('total', 'valor', 'amount');
  const methodKey = findKey('paga com', 'metodo', 'method', 'payment_method', 'forma');
  if (!amountKey)
    throw new Error('Cabeçalho precisa ter a coluna de valor (ex.: Total/Valor/Amount)');
  const totalCsv = rows.reduce((acc, row) => acc + toCents(row[amountKey]), 0);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let hybridCents = null;
  try {
    const ref = month ? new Date(`${month}-01T00:00:00`) : new Date();
    const monthDate = new Date(ref.getFullYear(), ref.getMonth(), 1).toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('get_monthly_revenue_hybrid', {
      month_date: monthDate,
    });
    if (!error) hybridCents = Number((data || [])[0]?.total_cents || 0);
  } catch (_) {}

  const out = {
    file,
    month: month || null,
    detected_headers: headers,
    csv_total_cents: totalCsv,
    csv_total_brl: (totalCsv / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  };
  if (hybridCents != null) {
    out.hybrid_cents = hybridCents;
    out.hybrid_brl = (hybridCents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    out.diff_cents = totalCsv - hybridCents;
    out.diff_brl = ((totalCsv - hybridCents) / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
