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

(async () => {
  try {
    log('🔍 Recontando chargebacks (apenas cartão, por updated_at_iugu)...');

    // Buscar invoices com status=chargeback e janela de tempo (2025-08/09)
    const query =
      'iugu_invoices?status=eq.chargeback&updated_at_iugu=gte.2025-08-01&updated_at_iugu=lt.2025-10-01&select=id,payment_method,updated_at_iugu,created_at_iugu';
    const invoices = await fetchAll(query);

    // Filtrar por método de pagamento cartão
    const cardOnly = invoices.filter((inv) =>
      (inv.payment_method || '').toLowerCase().includes('card')
    );

    // Agrupar por mês usando updated_at_iugu (data do evento)
    const counts = {};
    for (const inv of cardOnly) {
      const m = toMonth(inv.updated_at_iugu);
      if (!m) continue;
      counts[m] = (counts[m] || 0) + 1;
    }

    const aug = counts['2025-08'] || 0;
    const sep = counts['2025-09'] || 0;

    log(`📊 Resultado corrigido:`);
    log(`   Agosto/2025 (cartão, evento por updated_at_iugu): ${aug}`);
    log(`   Setembro/2025 (cartão, evento por updated_at_iugu): ${sep}`);

    // Também mostra total bruto anterior (para contraste) usando todos os métodos
    const countsAll = {};
    for (const inv of invoices) {
      const m = toMonth(inv.updated_at_iugu);
      if (!m) continue;
      countsAll[m] = (countsAll[m] || 0) + 1;
    }
    log(
      `   (Comparativo, todos os métodos): Ago ${countsAll['2025-08'] || 0}, Set ${countsAll['2025-09'] || 0}`
    );

    process.exit(0);
  } catch (err) {
    log(`❌ Erro: ${err.message}`);
    process.exit(1);
  }
})();
