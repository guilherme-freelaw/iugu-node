import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const IUGU_API_TOKEN = Deno.env.get('IUGU_API_TOKEN_LIVE') || Deno.env.get('IUGU_API_TOKEN_TEST') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// POST /iugu/backfill { resource: 'customers'|'subscriptions'|'invoices', from?, to?, page? }
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: any;
  try { body = await req.json(); } catch (e) { return new Response('invalid json', { status: 400 }); }

  const resource = body?.resource;
  if (!resource) return new Response(JSON.stringify({ error: 'resource required' }), { status: 400 });

  // TODO: implement pagination against Iugu API, transform, and upsert into public.* tables

  return new Response(JSON.stringify({ ok: true, resource }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}


