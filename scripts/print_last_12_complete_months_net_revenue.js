'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function monthStartISO(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
  return new Date(d).toISOString().slice(0, 10);
}

async function getMonthlyReceived(supabase, monthDateISO) {
  const { data, error } = await supabase.rpc('get_monthly_received', { month_date: monthDateISO });
  if (error) throw error;
  return Number((data && data[0] && data[0].total_cents) || 0);
}

async function getMonthlyRefunds(supabase, monthDateISO) {
  // Try RPC first; if missing, fall back to direct query
  const rpc = await supabase.rpc('get_monthly_refunds', { month_date: monthDateISO });
  if (!rpc.error && rpc.data) {
    return Number((rpc.data && rpc.data[0] && rpc.data[0].refunds_cents) || 0);
  }

  // Fallback: compute by querying iugu_invoices with status refunded using SP month bounds
  const ref = new Date(monthDateISO + 'T00:00:00Z');
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const toUtcFromSP = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd, 3, 0, 0));
  const start = toUtcFromSP(y, m, 1);
  const end = toUtcFromSP(y, m + 1, 1);

  const { data, error } = await supabase
    .from('iugu_invoices')
    .select('total_cents')
    .eq('status', 'refunded')
    .gte('paid_at', start.toISOString())
    .lt('paid_at', end.toISOString())
    .limit(100000);

  if (error) throw error;
  const sum = (data || []).reduce((acc, row) => acc + Number(row.total_cents || 0), 0);
  return -sum;
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Excluir mês corrente: começar a partir do mês anterior
  const now = new Date();
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const tasks = [];
  for (let i = 0; i < 12; i++) {
    const ref = new Date(firstMonth.getFullYear(), firstMonth.getMonth() - i, 1);
    const key = monthKey(ref);
    const iso = monthStartISO(ref);
    tasks.push(
      (async () => {
        const [receivedCents, refundsCents] = await Promise.all([
          getMonthlyReceived(supabase, iso),
          getMonthlyRefunds(supabase, iso),
        ]);
        const netCents = receivedCents + refundsCents;
        return { month: key, received_cents: receivedCents, refunds_cents: refundsCents, total_cents: netCents };
      })()
    );
  }

  const raw = await Promise.all(tasks);
  raw.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  const result = raw.map((r) => ({
    month: r.month,
    total_cents: r.total_cents,
    total_brl: toBRL(r.total_cents),
    received_cents: r.received_cents,
    refunds_cents: r.refunds_cents,
  }));

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}


