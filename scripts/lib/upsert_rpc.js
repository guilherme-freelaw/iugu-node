'use strict';

const ENTITY_TO_RPC = {
  invoices: 'upsert_invoice_from_payload',
  customers: 'upsert_customer_from_payload',
  subscriptions: 'upsert_subscription_from_payload',
  plans: 'upsert_plan_from_payload',
  transfers: 'upsert_transfer_from_payload',
  payment_methods: 'upsert_payment_method_from_payload',
  charges: 'upsert_charge_from_payload',
  accounts: 'upsert_account_from_payload',
  chargebacks: 'upsert_chargeback_from_payload'
};

async function upsertViaRpc(supabaseUrl, serviceRoleKey, entity, payload) {
  const rpc = ENTITY_TO_RPC[entity];
  if (!rpc) throw new Error(`No RPC mapped for entity: ${entity}`);
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    },
    body: JSON.stringify({ payload })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RPC ${rpc} failed: ${res.status} ${text}`);
  }
  return res;
}

module.exports = { upsertViaRpc };
