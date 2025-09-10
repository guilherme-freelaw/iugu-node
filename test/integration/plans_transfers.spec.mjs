import { spawnSync } from 'child_process';

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

async function insertEvent(body) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/iugu_webhook_events`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error('insert failed ' + resp.status + ' ' + await resp.text());
  return (await resp.json())[0];
}

function runProcessor() {
  const env = { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return spawnSync('node', ['supabase/dev_test/insert_and_run_processor_node.mjs'], { env, encoding: 'utf8' });
}

async function testPlan() {
  const payload = {
    event_name: 'plan.created',
    data: { id: 'plan-test-1', identifier: 'basic', name: 'Basic Plan', value_cents: 5000 },
    timestamp: new Date().toISOString()
  };
  const row = await insertEvent({ event_name: payload.event_name, entity_id: payload.data.id, payload, dedupe_key: 'plan-' + Date.now(), received_at: new Date().toISOString(), process_status: 'pending' });
  console.log('inserted plan event', row.id);
  const proc = runProcessor();
  console.log('processor stdout', proc.stdout);
  console.log('processor stderr', proc.stderr);
  if (proc.status !== 0) throw new Error('processor failed');
}

async function testTransfer() {
  const payload = {
    event_name: 'transfer.created',
    data: { id: 'transfer-test-1', account_id: 'acct-1', amount_cents: 1500, status: 'paid' },
    timestamp: new Date().toISOString()
  };
  const row = await insertEvent({ event_name: payload.event_name, entity_id: payload.data.id, payload, dedupe_key: 'transfer-' + Date.now(), received_at: new Date().toISOString(), process_status: 'pending' });
  console.log('inserted transfer event', row.id);
  const proc = runProcessor();
  console.log('processor stdout', proc.stdout);
  console.log('processor stderr', proc.stderr);
  if (proc.status !== 0) throw new Error('processor failed');
}

async function runAll() {
  await testPlan();
  await testTransfer();
  console.log('ok');
}

import { fileURLToPath } from 'url';
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runAll().catch(err => { console.error(err); process.exit(1); });
}


