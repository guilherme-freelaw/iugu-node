'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getMonthISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthStartISO(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
  // Use only the date part (YYYY-MM-DD)
  return new Date(d).toISOString().slice(0, 10);
}

async function fetchMonthlyReceivedCents(supabase, monthDateISO) {
  const { data, error } = await supabase.rpc('get_monthly_received', {
    month_date: monthDateISO,
  });
  if (error) throw error;
  const cents = Number((data && data[0] && data[0].total_cents) || 0);
  return cents;
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Configure your environment or .env file.'
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const results = [];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = getMonthISO(ref);
    const monthDateISO = getMonthStartISO(ref);
    // eslint-disable-next-line no-await-in-loop
    const cents = await fetchMonthlyReceivedCents(supabase, monthDateISO);
    results.push({ month: monthKey, total_cents: cents, total_brl: toBRL(cents) });
  }

  results.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}


