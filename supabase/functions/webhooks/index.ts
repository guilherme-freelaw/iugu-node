import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// @ts-ignore runtime import
import { createClient } from 'npm:@supabase/supabase-js';

// support Deno or Node env
const denoEnv = (globalThis as any).Deno;
const SUPABASE_URL = denoEnv && denoEnv.env && typeof denoEnv.env.get === 'function'
  ? denoEnv.env.get('SUPABASE_URL')
  : process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = denoEnv && denoEnv.env && typeof denoEnv.env.get === 'function'
  ? denoEnv.env.get('SUPABASE_SERVICE_ROLE_KEY')
  : process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const IUGU_WEBHOOK_SECRET = denoEnv && denoEnv.env && typeof denoEnv.env.get === 'function'
  ? denoEnv.env.get('IUGU_WEBHOOK_SECRET')
  : process.env.IUGU_WEBHOOK_SECRET || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sha256Hex(input: string) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
}

async function validateSignature(rawBody: string, signatureHeader?: string) {
  if (!IUGU_WEBHOOK_SECRET) return true; // no secret configured
  if (!signatureHeader) return false;
  // assume HMAC-SHA256 hex
  try {
    const enc = new TextEncoder();
    const key = enc.encode(IUGU_WEBHOOK_SECRET);
    const msg = enc.encode(rawBody);
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
    return sigHex === signatureHeader;
  } catch (err) {
    console.warn('validateSignature error', err);
    return false;
  }
}

// Edge Function handler for Iugu webhooks (enqueue model)
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const rawBody = await req.text();

  // attempt parse but keep raw
  let evt: any;
  try {
    evt = JSON.parse(rawBody);
  } catch (err) {
    console.error('invalid-json', err);
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 });
  }

  const signatureHeader = req.headers.get('x-iugu-signature') || req.headers.get('x-signature') || null;
  const validSig = await validateSignature(rawBody, signatureHeader ?? undefined);
  if (!validSig) {
    console.warn('invalid-signature');
    return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401 });
  }

  const eventName = evt?.event_name ?? evt?.type ?? null;
  const entityId = evt?.data?.id ?? evt?.data?.invoice_id ?? evt?.data?.subscription_id ?? null;
  const ts = evt?.timestamp ?? evt?.created_at ?? Date.now().toString();

  const dedupeKey = await sha256Hex(`${eventName}|${entityId ?? ''}|${ts}`);

  try {
    const { error: insErr } = await supabase
      .from('iugu_webhook_events')
      .insert({
        event_name: eventName,
        entity_id: entityId,
        payload: evt,
        dedupe_key: dedupeKey,
        received_at: new Date().toISOString(),
        process_status: 'pending'
      });

    if (insErr) {
      // duplicate dedupe_key -> treat as OK
      console.warn('insert webhook event error', insErr.message ?? insErr);
      // return 200 for duplicates or client errors
      return new Response(JSON.stringify({ ok: false, error: insErr.message }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // notify processor via pg_notify channel (requires DB function to forward)
    try {
      await supabase.rpc('notify_iugu_webhook_event', { dedupe_key: dedupeKey });
    } catch (rpcErr) {
      // not fatal; processor may poll iugu_webhook_events
      console.warn('rpc notify failed', rpcErr.message ?? rpcErr);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('webhook-handler-error', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}


