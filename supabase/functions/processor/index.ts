// @ts-ignore: imported in runtime environments (Deno or Node)
import { createClient } from '@supabase/supabase-js';

// support running in Deno or Node (or test envs)
const deno = (globalThis as any).Deno;
const SUPABASE_URL = deno && deno.env && typeof deno.env.get === 'function'
  ? deno.env.get('SUPABASE_URL')
  : process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = deno && deno.env && typeof deno.env.get === 'function'
  ? deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  : process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Worker/processor that consumes events from iugu_webhook_events where process_status = 'pending'
export default async function processPendingEvents() {
  // claim a batch of pending events atomically via RPC
  const batchSize = 50;
  const { data: rows, error } = await supabase.rpc('claim_pending_events', { batch_size: batchSize });

  if (error) {
    console.error('claim pending events error', error.message ?? error);
    return;
  }

  for (const row of rows ?? []) {
    try {
      // basic processing switch
      const evt = row.payload;
      // normalize event payload: extract `data` when present
      const normalized = evt?.data ? evt.data : evt;
      switch (evt?.event_name ?? evt?.type) {
        case 'invoice.created':
        case 'invoice.status_changed':
        case 'invoice.payment_failed':
        case 'invoice.refund':
          // call upsert invoice normalizer
          await supabase.rpc('upsert_invoice_from_payload', { payload: normalized });
          // also upsert invoice items if present
          try {
            await supabase.rpc('upsert_invoice_items_from_payload', { payload: normalized });
          } catch (e) {
            // non-fatal
            console.warn('upsert invoice items failed', e.message ?? e);
          }
          break;
        case 'subscription.created':
        case 'subscription.renewed':
        case 'subscription.activated':
        case 'subscription.suspended':
        case 'subscription.expired':
        case 'subscription.changed':
          await supabase.rpc('upsert_subscription_from_payload', { payload: normalized });
          break;
        case 'customer.created':
        case 'customer.updated':
        case 'customer.deleted':
          await supabase.rpc('upsert_customer_from_payload', { payload: normalized });
          break;
        default:
          // fallback: try upsert based on presence of keys
          await supabase.rpc('upsert_generic_payload', { payload: row.payload });
      }

      await supabase.from('iugu_webhook_events').update({ process_status: 'success', processed_at: new Date().toISOString() }).eq('id', row.id);
    } catch (err) {
      console.error('process event error', err);
      await supabase.from('iugu_webhook_events').update({ process_status: 'failed', process_error: String(err) }).eq('id', row.id);
    }
  }
}

// if executed as a script in Deno, run once
if (import.meta.main) {
  processPendingEvents().then(() => console.log('done')).catch(err => console.error(err));
}


