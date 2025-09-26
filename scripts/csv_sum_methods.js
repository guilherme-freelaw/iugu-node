'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

function parseArgs() {
  const arg = process.argv.find((a) => a.startsWith('--file='));
  if (!arg) throw new Error('Use --file=tmp/arquivo.csv');
  return { file: arg.split('=')[1] };
}

function normalizeHeader(h) {
  return h.toLowerCase().trim();
}

function toCents(value) {
  if (value == null) return 0;
  let s = String(value)
    .trim()
    .replace(/^R\$\s*/i, '');
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

function normalizeMethodToken(s) {
  if (!s) return '';
  const v = String(s).toLowerCase();
  if (v.includes('pix')) return 'pix';
  if (v.includes('credit') || v.includes('cartão') || v.includes('card')) return 'credit_card';
  if (v.includes('boleto') || v.includes('bank_slip')) return 'bank_slip';
  return '';
}

function classifyCsvMethod(row, keys) {
  const get = (k) => k && row[k];
  const token = normalizeMethodToken(get(keys.methodKey));
  const adquirente = String(get(keys.acquirerKey) || '').toLowerCase();
  const nossoNumero = String(get(keys.nossoNumeroKey) || '').trim();
  // Heurísticas (preferenciais):
  if (nossoNumero) return 'bank_slip';
  if (adquirente.includes('pix')) return 'pix';
  if (adquirente) return 'credit_card';
  // fallback no token textual
  return token || 'other';
}

async function main() {
  const { file } = parseArgs();
  const content = fs.readFileSync(path.resolve(file));
  // Tentar detectar encoding latin-1 com fallback para utf-8
  let text = content.toString('utf8');
  if (/Ã|Ê|Ç|Õ|Ô|Â/.test(text)) {
    // heurística simples
    text = Buffer.from(content).toString('latin1');
  }
  const records = parse(text, {
    columns: (hdrs) => hdrs.map((h) => normalizeHeader(String(h))),
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter: undefined,
  });

  const headers = Object.keys(records[0] || {});
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
    [
      'nosso número',
      'nosso numero',
      'nosso_número',
      'nosso_numero',
      'linha digitável',
      'linha digitavel',
    ].some((k) => h.includes(k))
  );
  if (!amountKey) throw new Error('Coluna de valor não encontrada');

  const sum = { pix: 0, credit_card: 0, bank_slip: 0, other: 0 };
  for (const row of records) {
    const amt = toCents(row[amountKey]);
    const m = classifyCsvMethod(row, { methodKey, acquirerKey, nossoNumeroKey });
    sum[m] += amt;
  }

  const toBRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  console.log(
    JSON.stringify(
      {
        file,
        totals_cents: sum,
        totals_brl: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, toBRL(v)])),
        grand_total_brl: toBRL(sum.pix + sum.credit_card + sum.bank_slip + sum.other),
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
