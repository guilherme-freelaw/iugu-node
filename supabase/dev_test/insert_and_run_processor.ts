import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function insertTestEvent() {
  const payload = {
    event_name: 'customer.created',
    data: {
      id: 'test-cust-123',
      email: 'test@example.com',
      name: 'Test Customer',
      cpf_cnpj: '00000000000',
      phone: '11999999999'
    },
    timestamp: new Date().toISOString()
  };

  const dedupe_key = 'dev-test-' + Math.random().toString(36).slice(2);

  const { error } = await supabase.from('iugu_webhook_events').insert({
    event_name: payload.event_name,
    entity_id: payload.data.id,
    payload: payload,
    dedupe_key: dedupe_key,
    received_at: new Date().toISOString(),
    process_status: 'pending'
  });

  if (error) {
    console.error('insert test event error', error);
    return false;
  }

  console.log('inserted test event', dedupe_key);
  return true;
}

async function runProcessorOnce() {
  // import processor module dynamically
  const proc = await import('../functions/processor/index.ts');
  if (proc && typeof proc.default === 'function') {
    await proc.default();
    console.log('processor run complete');
  } else {
    console.error('processor module not found or invalid');
  }
}

if (import.meta.main) {
  insertTestEvent()
    .then(ok => ok ? runProcessorOnce() : Promise.reject('insert failed'))
    .catch(err => console.error(err));
}


