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

function walk(obj, path = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    out.push({ path: p, value: v });
    if (v && typeof v === 'object') walk(v, p, out);
  }
  return out;
}

function interesting(entry) {
  const key = entry.path.toLowerCase();
  return (
    key.includes('chargeback') ||
    key.includes('dispute') ||
    key.includes('contest') ||
    key.includes('contesta')
  );
}

(async () => {
  try {
    log('🔍 Inspecionando campos de chargeback no raw_json...');

    const url = `${SUPABASE_URL}/rest/v1/iugu_invoices?status=eq.chargeback&updated_at_iugu=gte.2025-08-01&updated_at_iugu=lt.2025-10-01&select=id,payment_method,updated_at_iugu,raw_json&limit=25`;
    const items = await fetchJson(url);

    let foundAny = false;
    for (const it of items) {
      let raw = it.raw_json;
      try {
        if (typeof raw === 'string') raw = JSON.parse(raw);
      } catch {}
      const flat = walk(raw);
      const hits = flat.filter(interesting);
      if (hits.length) {
        foundAny = true;
        console.log(
          `\nID: ${it.id} | PM: ${it.payment_method} | updated_at_iugu: ${it.updated_at_iugu}`
        );
        for (const h of hits.slice(0, 10)) {
          let val = h.value;
          if (typeof val === 'object')
            val = Array.isArray(val) ? `[array:${val.length}]` : '{object}';
          console.log(`  - ${h.path}: ${val}`);
        }
      }
    }

    if (!foundAny) {
      log('⚠️ Nenhum campo evidente de chargeback/dispute encontrado nos 25 exemplos.');
    }

    process.exit(0);
  } catch (err) {
    log(`❌ Erro: ${err.message}`);
    process.exit(1);
  }
})();
