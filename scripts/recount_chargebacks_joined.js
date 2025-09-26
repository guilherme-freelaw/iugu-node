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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

(async () => {
  try {
    log(
      '🔍 Recontando chargebacks com join em invoices (cartão, sem teste, por updated_at_iugu)...'
    );

    // Buscar chargebacks no período pelo updated_at_iugu
    const cbUrl = `${SUPABASE_URL}/rest/v1/iugu_chargebacks?updated_at_iugu=gte.2025-08-01&updated_at_iugu=lt.2025-10-01&select=id,invoice_id,updated_at_iugu,created_at_iugu,raw_json`;
    const chargebacks = await fetchJson(cbUrl);

    if (chargebacks.length === 0) {
      log('📭 Nenhum chargeback no período no banco atual.');
      console.log('Agosto=0, Setembro=0');
      process.exit(0);
    }

    // Excluir testes pelo raw_json do chargeback quando existir
    const nonTestCB = chargebacks.filter((cb) => {
      try {
        const raw = typeof cb.raw_json === 'string' ? JSON.parse(cb.raw_json) : cb.raw_json;
        if (raw && (raw.test === true || raw.is_test === true)) return false;
      } catch {}
      return true;
    });

    const invoiceIds = [...new Set(nonTestCB.map((cb) => cb.invoice_id).filter(Boolean))];

    // Buscar invoices correspondentes em lotes
    const idChunks = chunk(invoiceIds, 200);
    const invoiceMap = new Map();
    for (const ids of idChunks) {
      // Usar in. para lista de IDs
      const inList = ids.map((id) => `"${id}"`).join(',');
      const invUrl = `${SUPABASE_URL}/rest/v1/iugu_invoices?id=in.(${encodeURIComponent(ids.join(','))})&select=id,payment_method,raw_json`;
      const invoices = await fetchJson(invUrl);
      for (const inv of invoices) invoiceMap.set(inv.id, inv);
    }

    // Filtrar por cartão e não-teste também no invoice
    const filtered = nonTestCB.filter((cb) => {
      const inv = invoiceMap.get(cb.invoice_id);
      if (!inv) return false;
      const pm = (inv.payment_method || '').toLowerCase();
      if (!pm.includes('card')) return false;
      try {
        const raw = typeof inv.raw_json === 'string' ? JSON.parse(inv.raw_json) : inv.raw_json;
        if (raw && (raw.test === true || raw.is_test === true)) return false;
      } catch {}
      return true;
    });

    const counts = { '2025-08': 0, '2025-09': 0 };
    for (const cb of filtered) {
      const m = toMonth(cb.updated_at_iugu || cb.created_at_iugu);
      if (m === '2025-08' || m === '2025-09') counts[m]++;
    }

    log(`📊 Resultado (cartão, sem teste, por updated_at_iugu):`);
    log(`   Agosto/2025: ${counts['2025-08']}`);
    log(`   Setembro/2025: ${counts['2025-09']}`);

    process.exit(0);
  } catch (err) {
    log(`❌ Erro: ${err.message}`);
    process.exit(1);
  }
})();
