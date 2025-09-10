import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// POST /iugu/upload/ingest { filePath: string, type: 'subscriptions'|'customers' }
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: any;
  try { body = await req.json(); } catch (e) { return new Response('invalid json', { status: 400 }); }

  const filePath = body?.filePath;
  const type = body?.type;
  if (!filePath || !type) return new Response(JSON.stringify({ error: 'filePath and type required' }), { status: 400 });

  // TODO: read file from Storage bucket (iugu_uploads), parse CSV/XLSX, normalize headers, insert into staging.* tables

  return new Response(JSON.stringify({ ok: true, filePath, type }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}


