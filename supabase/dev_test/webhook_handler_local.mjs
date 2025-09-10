import http from 'http';
import crypto from 'crypto';

const PORT = process.env.WEBHOOK_LOCAL_PORT || 8888;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IUGU_WEBHOOK_SECRET = process.env.IUGU_WEBHOOK_SECRET || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run local webhook handler');
  process.exit(2);
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function insertEvent(evt, dedupeKey) {
  const body = {
    event_name: evt.event_name,
    entity_id: evt.data?.id ?? null,
    payload: evt,
    dedupe_key: dedupeKey,
    received_at: new Date().toISOString(),
    process_status: 'pending'
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/iugu_webhook_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify(body)
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

async function notify(dedupeKey) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/notify_iugu_webhook_event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ dedupe_key: dedupeKey })
  });
  return { ok: resp.ok, status: resp.status, text: await resp.text() };
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  let raw = '';
  for await (const chunk of req) raw += chunk;

  let evt;
  try {
    evt = JSON.parse(raw);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid json' }));
    return;
  }

  // validate signature if secret set
  const signature = req.headers['x-iugu-signature'] || req.headers['x-signature'];
  if (IUGU_WEBHOOK_SECRET) {
    const sig = sha256Hex(`${evt.event_name}|${evt.data?.id ?? ''}|${evt.timestamp ?? evt.created_at ?? ''}${IUGU_WEBHOOK_SECRET}`);
    // note: this is a simplified scheme for local testing; accept if header equals computed
    if (!signature || signature !== sig) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid signature' }));
      return;
    }
  }

  const dedupeKey = sha256Hex(`${evt.event_name}|${evt.data?.id ?? ''}|${evt.timestamp ?? evt.created_at ?? ''}`);
  try {
    const ins = await insertEvent(evt, dedupeKey);
    if (!ins.ok) {
      // if duplicate or bad, return 200 but include info
      res.writeHead(ins.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, detail: ins.text }));
      return;
    }

    // try notify
    try {
      await notify(dedupeKey);
    } catch (err) {
      console.warn('notify error', err);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => console.log('webhook handler local listening on', PORT));


