'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');

function parseArgs() {
  const csvArg = process.argv.find((a) => a.startsWith('--csv='));
  const startArg = process.argv.find((a) => a.startsWith('--start='));
  const endArg = process.argv.find((a) => a.startsWith('--end='));
  const offsetArg = process.argv.find((a) => a.startsWith('--offsetDays='));
  if (!csvArg || !startArg || !endArg)
    throw new Error(
      'Use --csv=tmp/arquivo.csv --start=YYYY-MM-DD --end=YYYY-MM-DD [--offsetDays=-1|0|1]'
    );
  return {
    csv: csvArg.split('=')[1],
    start: startArg.split('=')[1],
    end: endArg.split('=')[1],
    offsetDays: Number((offsetArg || '').split('=')[1] || 0),
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
function normalizeToken(s) {
  if (!s) return '';
  const v = String(s).toLowerCase();
  if (v.includes('pix')) return 'pix';
  if (v.includes('credit') || v.includes('cartão') || v.includes('card')) return 'credit_card';
  if (v.includes('boleto') || v.includes('bank_slip')) return 'bank_slip';
  return '';
}
function classifyCsvMethod(row, keys) {
  const token = normalizeToken(row[keys.methodKey]);
  const adquirente = String(row[keys.acquirerKey] || '').toLowerCase();
  const nossoNumero = String(row[keys.nossoNumeroKey] || '').trim();
  if (nossoNumero) return 'bank_slip';
  if (adquirente.includes('pix')) return 'pix';
  if (adquirente) return 'credit_card';
  return token || 'other';
}
function parseDateBrOrIso(s) {
  const v = String(s).trim();
  // try dd/mm/yyyy
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    const [_, d, mo, y] = m;
    return `${y}-${mo}-${d}`; // ISO date
  }
  // fallback assume ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

function applyOffset(dateIso, offsetDays) {
  if (!dateIso) return null;
  try {
    const ts = Date.parse(dateIso + 'T00:00:00Z');
    if (!Number.isFinite(ts)) return null;
    const ts2 = ts + offsetDays * 86400000;
    const d2 = new Date(ts2);
    if (!Number.isFinite(d2.getTime())) return null;
    return d2.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function aggregateCsv(csvPath, offsetDays) {
  const buf = fs.readFileSync(path.resolve(csvPath));
  let text = buf.toString('utf8');
  if (/Ã|Ê|Ç|Õ|Ô|Â/.test(text)) text = Buffer.from(buf).toString('latin1');
  const rows = parse(text, {
    columns: (hdrs) => hdrs.map(normalizeHeader),
    skip_empty_lines: true,
    relax_column_count: true,
  });
  const headers = Object.keys(rows[0] || {});
  const amountKey = headers.find((h) =>
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
  const paidAtKey = headers.find((h) =>
    ['data do pagamento', 'payment', 'paid', 'paid at', 'data de pagamento'].some((k) =>
      h.includes(k)
    )
  );
  if (!amountKey || !paidAtKey) throw new Error('Não encontrei colunas de valor/data no CSV');
  const map = new Map(); // key: date|method -> cents
  for (const row of rows) {
    const baseDate = parseDateBrOrIso(row[paidAtKey]);
    if (!baseDate) continue;
    const dateIso = applyOffset(baseDate, offsetDays);
    if (!dateIso) continue;
    const method = classifyCsvMethod(row, { methodKey, acquirerKey, nossoNumeroKey });
    const key = `${dateIso}|${method}`;
    map.set(key, (map.get(key) || 0) + toCents(row[amountKey]));
  }
  const out = {};
  for (const [key, cents] of map) {
    const [date, method] = key.split('|');
    if (!out[date]) out[date] = {};
    out[date][method] = cents;
  }
  return out;
}

function brl(c) {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function fetchApiDaily(start, end) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('daily_revenue_by_method')
    .select('paid_date,method,total_cents')
    .gte('paid_date', start)
    .lte('paid_date', end)
    .order('paid_date', { ascending: true })
    .limit(200000);
  if (error) throw error;
  const out = {};
  for (const r of data || []) {
    const date = r.paid_date.slice(0, 10);
    if (!out[date]) out[date] = {};
    out[date][r.method] = Number(r.total_cents || 0);
  }
  return out;
}

async function main() {
  const { csv, start, end } = parseArgs();
  const [api, csvAgg] = await Promise.all([
    fetchApiDaily(start, end),
    Promise.resolve(aggregateCsv(csv)),
  ]);
  const days = Array.from(new Set([...Object.keys(api), ...Object.keys(csvAgg)])).sort();
  const methods = ['pix', 'credit_card', 'bank_slip'];
  const rows = [];
  for (const date of days) {
    for (const m of methods) {
      const a = (api[date] || {})[m] || 0;
      const c = (csvAgg[date] || {})[m] || 0;
      rows.push({
        date,
        method: m,
        api_cents: a,
        csv_cents: c,
        diff_cents: a - c,
        api_brl: brl(a),
        csv_brl: brl(c),
        diff_brl: brl(a - c),
      });
    }
  }
  console.log(JSON.stringify(rows, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
