import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run E2E tests');
  process.exit(2);
}

function startHandler() {
  const env = { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WEBHOOK_LOCAL_PORT: '8888' };
  const child = spawnSync('node', ['supabase/dev_test/webhook_handler_local.mjs'], { env, encoding: 'utf8', detached: true });
  return child;
}

async function sendWebhook() {
  const payload = { event_name: 'customer.created', data: { id: 'e2e-cust-1', email: 'e2e@example.com', name: 'E2E Test' }, timestamp: new Date().toISOString() };
  const resp = spawnSync('curl', ['-s', '-X', 'POST', 'http://localhost:8888/webhook', '-H', 'Content-Type: application/json', '-d', JSON.stringify(payload)], { encoding: 'utf8' });
  return { status: resp.status, stdout: resp.stdout, stderr: resp.stderr };
}

function runProcessor() {
  const env = { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return spawnSync('node', ['supabase/dev_test/insert_and_run_processor_node.mjs'], { env, encoding: 'utf8' });
}

async function queryCustomer() {
  const resp = spawnSync('curl', ['-s', '-X', 'GET', `${SUPABASE_URL}/rest/v1/iugu_customers?id=eq.e2e-cust-1`, '-H', `apikey: ${SUPABASE_SERVICE_ROLE_KEY}`, '-H', `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`], { encoding: 'utf8' });
  return { status: resp.status, stdout: resp.stdout };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('starting handler');
  const start = startHandler();
  // short wait for handler to be fully ready
  spawnSync('sleep', ['1.5']);
  console.log('sending webhook');
  const send = sendWebhook();
  console.log('send result', send.status, send.stdout);
  const proc = runProcessor();
  console.log('processor result', proc.status, proc.stdout);
  const q = queryCustomer();
  console.log('query customer', q.status, q.stdout);
}


