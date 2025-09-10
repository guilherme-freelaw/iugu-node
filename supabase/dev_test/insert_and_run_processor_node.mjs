import crypto from 'crypto';
import { fileURLToPath } from 'url';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const headers = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function insertTestEvent() {
  const payload = {
    event_name: 'customer.created',
    data: {
      id: 'test-cust-node-123',
      email: 'test-node@example.com',
      name: 'Test Node Customer',
      cpf_cnpj: '00000000000',
      phone: '11999999999'
    },
    timestamp: new Date().toISOString()
  };

  const dedupe_key = 'dev-test-' + Math.random().toString(36).slice(2);

  const body = {
    event_name: payload.event_name,
    entity_id: payload.data.id,
    payload: payload,
    dedupe_key: dedupe_key,
    received_at: new Date().toISOString(),
    process_status: 'pending'
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/iugu_webhook_events`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  console.log('insertTestEvent status', resp.status);
  const text = await resp.text();
  if (!resp.ok) {
    console.error('insert event failed', resp.status, text);
    return null;
  }

  console.log('Inserted test event', text);
  return dedupe_key;
}

async function claimPending(batchSize = 50) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_pending_events`, {
    method: 'POST',
    headers: { ...headers },
    body: JSON.stringify({ batch_size: batchSize })
  });

  console.log('claimPending status', resp.status);

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('claim rpc failed: ' + resp.status + ' ' + text);
  }

  const rows = await resp.json();
  return rows;
}

async function callUpsertRpc(rpcName, payload) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: { ...headers },
    body: JSON.stringify({ payload })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`rpc ${rpcName} failed: ${resp.status} ${text}`);
  }

  return await resp.text();
}

async function markEvent(id, status, errorMsg) {
  const body = { process_status: status };
  if (status === 'success') body.processed_at = new Date().toISOString();
  if (errorMsg) body.process_error = String(errorMsg).slice(0, 2000);

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/iugu_webhook_events?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error('failed to mark event', id, resp.status, text);
  }
}

async function processLoopOnce() {
  const rows = await claimPending(50);
  console.log('claimed', rows.length, 'rows');

  for (const row of rows) {
    try {
      const evt = row.payload;
      const eventName = evt?.event_name ?? evt?.type ?? null;
      // normalize payload: many webhook shapes wrap the entity inside `data`
      const normalizedPayload = evt?.data ? evt.data : evt;

      switch (eventName) {
        case 'customer.created':
        case 'customer.updated':
        case 'customer.deleted':
          await callUpsertRpc('upsert_customer_from_payload', normalizedPayload);
          break;
        case 'invoice.created':
        case 'invoice.status_changed':
        case 'invoice.payment_failed':
        case 'invoice.refund':
          await callUpsertRpc('upsert_invoice_from_payload', normalizedPayload);
          break;
        case 'subscription.created':
        case 'subscription.renewed':
        case 'subscription.activated':
        case 'subscription.suspended':
        case 'subscription.expired':
        case 'subscription.changed':
          await callUpsertRpc('upsert_subscription_from_payload', normalizedPayload);
          break;
        default:
          await callUpsertRpc('upsert_generic_payload', normalizedPayload);
      }

      await markEvent(row.id, 'success');
      console.log('processed event id', row.id);
    } catch (err) {
      console.error('process error for id', row.id, err.message || err);
      await markEvent(row.id, 'failed', err.message || String(err));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      await insertTestEvent();
      await processLoopOnce();
      console.log('done');
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}


