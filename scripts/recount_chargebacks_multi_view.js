#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function log(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

async function fetchAll(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const res = await fetch(url, { headers });
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

function countByMonth(items, getDate) {
  const counts = {};
  for (const it of items) {
    const m = toMonth(getDate(it));
    if (!m) continue;
    counts[m] = (counts[m] || 0) + 1;
  }
  return { aug: counts['2025-08'] || 0, sep: counts['2025-09'] || 0 };
}

(async () => {
  try {
    log('🔍 Recontando chargebacks (visões múltiplas)...');

    const baseQuery =
      'iugu_invoices?status=eq.chargeback&updated_at_iugu=gte.2025-08-01&updated_at_iugu=lt.2025-10-01&select=id,paid_cents,total_cents,payment_method,updated_at_iugu,raw_json';
    const invoices = await fetchAll(baseQuery);

    // 1) Bruto (todos)
    const v1 = countByMonth(invoices, (i) => i.updated_at_iugu);

    // 2) Pago e não-teste
    const nonTest = invoices.filter((i) => {
      try {
        const raw = typeof i.raw_json === 'string' ? JSON.parse(i.raw_json) : i.raw_json;
        if (raw && (raw.test === true || raw.is_test === true)) return false;
      } catch {}
      return true;
    });
    const paidNonTest = nonTest.filter((i) => (i.paid_cents || 0) > 0 || (i.total_cents || 0) > 0);
    const v2 = countByMonth(paidNonTest, (i) => i.updated_at_iugu);

    // 3) Apenas cartão (heurística)
    const cardOnly = paidNonTest.filter((i) => {
      const pm = (i.payment_method || '').toLowerCase();
      return pm.includes('card'); // ex: credit_card, iugu_credit_card
    });
    const v3 = countByMonth(cardOnly, (i) => i.updated_at_iugu);

    log('📊 Resultado por visão (Agosto/Setembro 2025):');
    log(`   1) Bruto (todos): Ago=${v1.aug}, Set=${v1.sep}`);
    log(`   2) Pago + não-teste: Ago=${v2.aug}, Set=${v2.sep}`);
    log(`   3) Cartão (subconjunto de 2): Ago=${v3.aug}, Set=${v3.sep}`);

    process.exit(0);
  } catch (err) {
    log(`❌ Erro: ${err.message}`);
    process.exit(1);
  }
})();
