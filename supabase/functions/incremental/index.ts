import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// POST /iugu/incremental { resource: 'subscriptions'|'invoices', cursor? }
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: any;
  try { body = await req.json(); } catch (e) { return new Response('invalid json', { status: 400 }); }

  const resource = body?.resource;
  if (!resource) return new Response(JSON.stringify({ error: 'resource required' }), { status: 400 });

  // TODO: implement updated_since logic and idempotent upserts

  return new Response(JSON.stringify({ ok: true, resource }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}


