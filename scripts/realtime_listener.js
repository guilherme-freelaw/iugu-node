#!/usr/bin/env node

/*
 Minimal realtime listener to verify Supabase realtime events locally.
 Usage:
   node -r dotenv/config scripts/realtime_listener.js iugu_invoices
   node -r dotenv/config scripts/realtime_listener.js iugu_subscriptions
*/

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment.');
  process.exit(1);
}

const table = process.argv[2] || 'iugu_invoices';

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: {
      params: {
        eventsPerSecond: 5,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log(`[realtime] Subscribing to changes on table ${table}...`);

  const channel = supabase
    .channel(`realtime:${table}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        const { eventType, old, new: newRow } = payload;
        const id = newRow?.id || old?.id || '(no id)';
        console.log(`[${new Date().toISOString()}] ${table} ${eventType} id=${id}`);
        console.dir(payload, { depth: 3 });
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[realtime] Subscribed to ${table}. Trigger an insert/update/delete to see events.`);
      }
    });

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n[realtime] Unsubscribing...');
    await supabase.removeChannel(channel);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Realtime listener error:', err.message || err);
  process.exit(1);
});


