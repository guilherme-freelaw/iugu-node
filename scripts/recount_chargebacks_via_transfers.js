#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function log(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t}`);
  }
  return res.json();
}

function toMonth(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function looksLikeChargeback(raw) {
  try {
    if (typeof raw === 'string') raw = JSON.parse(raw);
  } catch {}
  if (!raw || typeof raw !== 'object') return false;
  const s = JSON.stringify(raw).toLowerCase();
  return s.includes('chargeback') || s.includes('dispute') || s.includes('estorno por chargeback');
}

(async () => {
  try {
    log('🔍 Recontando chargebacks via transferências (ajustes negativos)...');

    const url = `${SUPABASE_URL}/rest/v1/iugu_transfers?created_at_iugu=gte.2025-08-01&created_at_iugu=lt.2025-10-01&select=id,amount_cents,created_at_iugu,raw_json&limit=10000`;
    const transfers = await fetchJson(url);

    const candidates = transfers.filter(
      (t) => (t.amount_cents || 0) < 0 && looksLikeChargeback(t.raw_json)
    );

    const counts = { '2025-08': 0, '2025-09': 0 };
    for (const t of candidates) {
      const m = toMonth(t.created_at_iugu);
      if (m === '2025-08' || m === '2025-09') counts[m]++;
    }

    log('📊 Resultado por transferências (indicativos de chargeback):');
    log(`   Agosto/2025: ${counts['2025-08']}`);
    log(`   Setembro/2025: ${counts['2025-09']}`);

    process.exit(0);
  } catch (err) {
    log(`❌ Erro: ${err.message}`);
    process.exit(1);
  }
})();
