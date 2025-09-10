-- Migration: 004_claim_pending_events.sql
-- Purpose: atomically claim pending webhook events for processing

begin;

-- Claim up to batch_size pending events and mark them as processing, returning the rows
create or replace function public.claim_pending_events(batch_size int)
returns setof public.iugu_webhook_events language plpgsql as $$
begin
  return query
  with c as (
    select id
    from public.iugu_webhook_events
    where process_status = 'pending'
    order by received_at
    limit batch_size
    for update skip locked
  )
  update public.iugu_webhook_events w
  set process_status = 'processing', processed_at = null
  from c
  where w.id = c.id
  returning w.*;
end;
$$;

commit;


