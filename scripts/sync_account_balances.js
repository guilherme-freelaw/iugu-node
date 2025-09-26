'use strict';

// Sync Iugu account balances to Supabase: writes snapshot into public.iugu_account_balances

const Iugu = require('../lib/iugu');
const { createClient } = require('@supabase/supabase-js');

async function fetchIuguAccountViaSdk(client, accountId) {
  return await client.accounts.retrieve(accountId);
}

async function fetchIuguAccountViaRest(baseUrl, token, accountId) {
  const url = `${baseUrl.replace(/\/$/, '')}/accounts/${encodeURIComponent(accountId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(token + ':').toString('base64')}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Iugu REST error ${res.status}: ${text}`);
  }
  return await res.json();
}

function normalizeBalanceFromAccount(account, fallbackAccountId) {
  const balances = account && (account.balance || account.balances || account);
  // known shapes: { available, balance, receivable, transfer_pending, blocked }
  const toCents = (v) => {
    if (v == null) return 0;
    if (typeof v === 'number') return Math.round(v * 100);
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  return {
    available_cents: toCents(balances.available || balances.balance),
    receivable_cents: toCents(balances.receivable),
    blocked_cents: toCents(balances.blocked),
    in_transit_cents: toCents(balances.transfer_pending || balances.in_transit),
    currency: account.currency || 'BRL',
    account_id: account.id || account.account_id || fallbackAccountId || null,
  };
}

async function upsertBalanceSnapshot(supabase, snapshot) {
  const { error } = await supabase.from('iugu_account_balances').insert({
    account_id: snapshot.account_id,
    available_cents: snapshot.available_cents,
    receivable_cents: snapshot.receivable_cents,
    blocked_cents: snapshot.blocked_cents,
    in_transit_cents: snapshot.in_transit_cents,
    currency: snapshot.currency,
  });
  if (error) throw error;
}

async function resolveAccountId(supabase, explicitId) {
  if (explicitId) return explicitId;
  // Try from iugu_accounts
  let { data, error } = await supabase.from('iugu_accounts').select('id').limit(1);
  if (!error && data && data.length && data[0].id) return data[0].id;
  // Fallback from invoices
  ({ data, error } = await supabase
    .from('iugu_invoices')
    .select('account_id')
    .not('account_id', 'is', null)
    .limit(1));
  if (!error && data && data.length && data[0].account_id) return data[0].account_id;
  throw new Error(
    'Unable to resolve Iugu account id. Set IUGU_ACCOUNT_ID env or ensure iugu_accounts/iugu_invoices has data.'
  );
}

async function main() {
  const IUGU_API_KEY = process.env.IUGU_API_KEY || process.env.IUGU_API_TOKEN;
  const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const IUGU_ACCOUNT_ID_ENV =
    process.env.IUGU_ACCOUNT_ID || process.env.IUGU_ACCOUNT || process.env.IUGU_ACCOUNT_IDENTIFIER;
  if (!IUGU_API_KEY) throw new Error('Missing IUGU_API_KEY or IUGU_API_TOKEN');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase envs');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const IUGU_ACCOUNT_ID = await resolveAccountId(supabase, IUGU_ACCOUNT_ID_ENV);

  let account;
  try {
    const iugu = new Iugu(IUGU_API_KEY);
    account = await fetchIuguAccountViaSdk(iugu, IUGU_ACCOUNT_ID);
  } catch (err) {
    // Fallback para REST se o SDK falhar
    account = await fetchIuguAccountViaRest(IUGU_API_BASE_URL, IUGU_API_KEY, IUGU_ACCOUNT_ID);
  }
  const snapshot = normalizeBalanceFromAccount(account, IUGU_ACCOUNT_ID);
  await upsertBalanceSnapshot(supabase, snapshot);
  console.log('Balance snapshot inserted', {
    account_id: snapshot.account_id,
    available_cents: snapshot.available_cents,
    receivable_cents: snapshot.receivable_cents,
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { main };
