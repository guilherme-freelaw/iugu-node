#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function log(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

async function iuguGet(path) {
  const url = `${IUGU_API_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Iugu ${res.status}: ${t}`);
  }
  return res.json();
}

async function upsertSupabase(table, rows) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase ${table} ${res.status}: ${t}`);
  }
}

function parseIuguDate(dateString) {
  if (!dateString) return null;
  if (typeof dateString === 'string' && dateString.includes('T')) return dateString;
  const ddmm = /^(\d{1,2})\/(\d{1,2}),\s*(\d{1,2}):(\d{2})$/;
  const m1 = dateString.match(ddmm);
  if (m1) {
    const [, d, m, hh, mm] = m1;
    const y = new Date().getFullYear();
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm}:00Z`;
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (dateOnly.test(dateString)) return `${dateString}T00:00:00Z`;
  const dt = new Date(dateString);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

async function backfillTransfers(startDate, endDate) {
  log(`🔄 Backfill de transferências ${startDate} → ${endDate}`);
  let page = 0;
  const limit = 100;
  let total = 0;

  while (true) {
    const start = page * limit;
    const path = `/transfers?limit=${limit}&start=${start}&created_at_from=${startDate}&created_at_to=${endDate}&sortBy=created_at&sortType=asc`;
    const data = await iuguGet(path);
    const items = data.items || [];
    if (items.length === 0) break;

    const rows = items.map((tr) => ({
      id: tr.id,
      amount_cents: tr.amount_cents ?? 0,
      currency: tr.currency || 'BRL',
      status: tr.status,
      created_at_iugu: parseIuguDate(tr.created_at),
      updated_at_iugu: parseIuguDate(tr.updated_at),
      raw_json: tr,
    }));

    await upsertSupabase('iugu_transfers', rows);
    total += rows.length;
    log(`   ✅ Inseridos ${rows.length} (acum: ${total})`);

    page++;
    if (page > 200) break; // segurança
  }

  log(`🎉 Backfill concluído. Total ${total}`);
}

(async () => {
  try {
    const start = process.argv[2] || '2025-08-01';
    const end = process.argv[3] || '2025-10-01';
    await backfillTransfers(start, end);
    process.exit(0);
  } catch (e) {
    log(`❌ Erro: ${e.message}`);
    process.exit(1);
  }
})();
