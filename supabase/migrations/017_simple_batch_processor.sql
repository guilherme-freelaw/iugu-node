-- Migration: 017_simple_batch_processor.sql
-- Purpose: create a simplified batch processor that works reliably

begin;

-- Simple batch processor focused on invoices only (most important data)
create or replace function public.process_batch_simple()
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
      -- Create customer first if needed
      if inv ? 'customer_id' and inv->>'customer_id' is not null then
        insert into public.iugu_customers (id, email, name, raw_json, created_at, updated_at)
        values (
          inv->>'customer_id',
          coalesce(inv->>'customer_email', inv->>'email', 'unknown@example.com'),
          coalesce(inv->>'customer_name', inv->>'payer_name', 'Unknown Customer'),
          jsonb_build_object('id', inv->>'customer_id'),
          now(),
          now()
        ) on conflict (id) do nothing;
      end if;
      
      -- Insert invoice
      insert into public.iugu_invoices (
        id, account_id, customer_id, subscription_id, status, due_date, paid_at,
        payment_method, total_cents, paid_cents, discount_cents, taxes_cents,
        external_reference, order_id, created_at_iugu, updated_at_iugu, raw_json
      ) values (
        inv->>'id',
        inv->>'account_id',
        inv->>'customer_id',
        inv->>'subscription_id',
        inv->>'status',
        nullif(inv->>'due_date','')::date,
        nullif(inv->>'paid_at','')::timestamptz,
        inv->>'payment_method',
        coalesce((inv->>'total_cents')::int, (inv->>'total')::int * 100),
        coalesce((inv->>'paid_cents')::int, (inv->>'paid')::int * 100),
        coalesce((inv->>'discount_cents')::int, (inv->>'discount')::int * 100),
        coalesce((inv->>'taxes_cents')::int, (inv->>'taxes')::int * 100),
        inv->>'external_reference',
        inv->>'order_id',
        nullif(inv->>'created_at','')::timestamptz,
        nullif(inv->>'updated_at','')::timestamptz,
        inv
      ) on conflict (id) do update set
        status = excluded.status,
        paid_at = coalesce(excluded.paid_at, public.iugu_invoices.paid_at),
        updated_at_iugu = excluded.updated_at_iugu,
        raw_json = excluded.raw_json;
      
      processed_count := processed_count + 1;
      
    exception when others then
      -- Log error but continue
      raise notice 'Error processing invoice %: %', coalesce(inv->>'id', 'unknown'), sqlerrm;
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
