-- Migration: 014_fix_batch_processor_order.sql
-- Purpose: fix batch processor to insert customers/subscriptions before invoices

begin;

-- Fix batch processor to handle foreign key constraints properly
create or replace function public.process_next_iugu_batch()
returns int language plpgsql as $$
declare 
  b record; 
  inv jsonb;
  processed_count int := 0;
begin
  -- Select and lock next pending batch
  select id, page, payload into b 
  from staging.iugu_batches 
  where status = 'pending' 
  order by page limit 1 
  for update skip locked;
  
  if not found then
    return 0;
  end if;

  -- Mark as processing
  update staging.iugu_batches 
  set status = 'processing', processed_at = now() 
  where id = b.id;

  -- Process each invoice in the batch
  for inv in select * from jsonb_array_elements(b.payload) loop
    begin
      -- FIRST: Upsert related customer if present (required for foreign key)
      if inv ? 'customer_id' and inv->>'customer_id' is not null then
        -- Create a minimal customer record from invoice data
        perform public.upsert_customer_from_payload(
          jsonb_build_object(
            'id', inv->>'customer_id',
            'email', coalesce(inv->>'customer_email', inv->>'email', 'unknown@example.com'),
            'name', coalesce(inv->>'customer_name', inv->>'payer_name', 'Unknown Customer')
          )
        );
      end if;
      
      -- SECOND: Upsert related customer object if present (full data)
      if inv ? 'customer' and inv->'customer' ? 'id' then
        perform public.upsert_customer_from_payload(inv->'customer');
      end if;
      
      -- THIRD: Upsert related subscription if present  
      if inv ? 'subscription' and inv->'subscription' ? 'id' then
        perform public.upsert_subscription_from_payload(inv->'subscription');
      end if;
      
      -- FOURTH: Now upsert invoice (main entity) - dependencies should exist
      perform public.upsert_invoice_from_payload(inv);
      
      -- FIFTH: Upsert invoice items if present
      if inv ? 'items' and jsonb_array_length(inv->'items') > 0 then
        perform public.upsert_invoice_items_from_payload(inv->'items');
      end if;
      
      processed_count := processed_count + 1;
      
    exception when others then
      -- Log error but continue processing
      raise notice 'Error processing invoice %. Invoice: %, Error: %', 
        coalesce(inv->>'id', 'unknown'), 
        left(inv::text, 100),
        sqlerrm;
    end;
  end loop;

  -- Mark as completed
  update staging.iugu_batches 
  set status = 'done', processed_at = now() 
  where id = b.id;
  
  raise notice 'Processed batch % with % invoices', b.id, processed_count;
  return b.id;
end;
$$;

commit;
