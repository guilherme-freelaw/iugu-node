'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');

function parseArgs() {
  const csvArg = process.argv.find((a) => a.startsWith('--csv='));
  const dateArg = process.argv.find((a) => a.startsWith('--date='));
  const methodArg = process.argv.find((a) => a.startsWith('--method='));
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  if (!csvArg || !dateArg || !methodArg)
    throw new Error(
      'Use --csv=tmp/arquivo.csv --date=YYYY-MM-DD --method=pix|credit_card|bank_slip [--limit=20]'
    );
  return {
    csv: csvArg.split('=')[1],
    date: dateArg.split('=')[1],
    method: methodArg.split('=')[1],
    limit: Number((limitArg || '').split('=')[1] || 20),
  };
}

function normalizeHeader(h) {
  return String(h).toLowerCase().trim();
}
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
function classifyCsvMethod(row, keys) {
  const adquirente = String(row[keys.acquirerKey] || '').toLowerCase();
  const nossoNumero = String(row[keys.nossoNumeroKey] || '').trim();
  const pagaCom = String(row[keys.methodKey] || '').toLowerCase();
  if (nossoNumero) return 'bank_slip';
  if (adquirente.includes('pix')) return 'pix';
  if (adquirente) return 'credit_card';
  if (pagaCom.includes('pix')) return 'pix';
  if (pagaCom.includes('credit') || pagaCom.includes('card') || pagaCom.includes('cartão'))
    return 'credit_card';
  if (pagaCom.includes('boleto')) return 'bank_slip';
  return 'other';
}
function parseDateBrOrIso(s) {
  const v = String(s).trim();
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    const [_, d, mo, y] = m;
    return `${y}-${mo}-${d}`;
  }
  return v.slice(0, 10);
}

function loadCsvRows(csvPath) {
  const buf = fs.readFileSync(path.resolve(csvPath));
  let text = buf.toString('utf8');
  if (/Ã|Ê|Ç|Õ|Ô|Â/.test(text)) text = Buffer.from(buf).toString('latin1');
  const rows = parse(text, {
    columns: (hdrs) => hdrs.map(normalizeHeader),
    skip_empty_lines: true,
    relax_column_count: true,
  });
  return rows;
}

async function main() {
  const { csv, date, method, limit } = parseArgs();
  const rows = loadCsvRows(csv);
  const headers = Object.keys(rows[0] || {});
  const paidKey = headers.find((h) =>
    ['data do pagamento', 'payment', 'paid', 'data de pagamento'].some((k) => h.includes(k))
  );
  const totalKey = headers.find((h) =>
    ['total', 'valor', 'amount', 'value'].some((k) => h.includes(k))
  );
  const methodKey = headers.find((h) =>
    ['paga com', 'method', 'metodo', 'payment_method', 'forma'].some((k) => h.includes(k))
  );
  const acquirerKey = headers.find((h) =>
    ['adquirente', 'acquirer', 'gateway'].some((k) => h.includes(k))
  );
  const nossoNumeroKey = headers.find((h) =>
    ['nosso número', 'nosso numero', 'linha digitável', 'linha digitavel'].some((k) =>
      h.includes(k)
    )
  );
  const codigoKey = headers.find((h) => ['código', 'codigo'].some((k) => h.includes(k)));
  const emailKey = headers.find((h) => ['e-mail', 'email'].some((k) => h.includes(k)));

  const csvSample = rows
    .map((r) => ({
      date: parseDateBrOrIso(r[paidKey]),
      method: classifyCsvMethod(r, { methodKey, acquirerKey, nossoNumeroKey }),
      total_cents: toCents(r[totalKey]),
      raw: r,
    }))
    .filter((r) => r.date === date && r.method === method)
    .sort((a, b) => b.total_cents - a.total_cents)
    .slice(0, limit)
    .map((r) => ({
      date: r.date,
      method: r.method,
      total_cents: r.total_cents,
      code: r.raw[codigoKey],
      acquirer: r.raw[acquirerKey],
      nosso_numero: r.raw[nossoNumeroKey],
      paga_com: r.raw[methodKey],
      email: r.raw[emailKey],
    }));

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: apiRows, error } = await supabase
    .from('invoice_payments_classified')
    .select('id,paid_cents,paid_date,method')
    .eq('paid_date', date)
    .eq('method', method)
    .order('paid_cents', { ascending: false })
    .limit(limit);
  if (error) throw error;

  console.log(JSON.stringify({ date, method, api_top: apiRows, csv_top: csvSample }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
