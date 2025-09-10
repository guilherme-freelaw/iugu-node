import assert from 'assert';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run integration tests');
  process.exit(2);
}

const headers = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

async function insertEvent(payload) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/iugu_webhook_events`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
  assert(resp.ok, 'insert event failed');
  const json = await resp.json();
  return json[0];
}

async function claimAndProcessOnce() {
  // call the node script that does claim and processing
  const { spawnSync } = await import('child_process');
  const env = { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  const res = spawnSync('node', ['supabase/dev_test/insert_and_run_processor_node.mjs'], { env, encoding: 'utf8' });
  return res;
}

export default async function testProcessor() {
  const payload = {
    event_name: 'customer.created',
    data: { id: 'int-test-cust-1', email: 'int-test@example.com', name: 'Integration Test' },
    timestamp: new Date().toISOString()
  };

  const row = await insertEvent({ event_name: payload.event_name, entity_id: payload.data.id, payload, dedupe_key: 'int-test-' + Date.now(), received_at: new Date().toISOString(), process_status: 'pending' });
  console.log('inserted', row.id);

  const res = await claimAndProcessOnce();
  console.log('process stdout:', res.stdout);
  console.log('process stderr:', res.stderr);
  assert(res.status === 0, 'processor exited with error');
}

import { fileURLToPath } from 'url';

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  testProcessor().then(() => console.log('ok')).catch(err => { console.error(err); process.exit(1); });
}


