-- Migration: 019_move_staging_to_public.sql
-- Purpose: move data from staging to public and process it there

begin;

-- First, let's create a simple function to count and process staging data
create or replace function public.process_staging_batches_direct()
returns table(
  batches_processed int,
  customers_inserted int,
  invoices_inserted int,
  errors_count int
) language plpgsql as $$
declare
  batch_rec record;
  inv jsonb;
  batches_count int := 0;
  customers_count int := 0;
  invoices_count int := 0;
  errors_count int := 0;
begin
  -- Process each pending batch
  for batch_rec in 
    select id, page, payload 
    from staging.iugu_batches 
    where status = 'pending' 
    order by page 
    limit 10  -- Process 10 batches at a time
  loop
    begin
      -- Mark batch as processing
      update staging.iugu_batches 
      set status = 'processing', processed_at = now() 
      where id = batch_rec.id;
      
      -- Process each invoice in the batch
      for inv in select * from jsonb_array_elements(batch_rec.payload) loop
        begin
          -- Insert customer first (if exists)
          if inv ? 'customer_id' and inv->>'customer_id' is not null then
            insert into public.iugu_customers (
              id, email, name, cpf_cnpj, phone, 
              created_at_iugu, updated_at_iugu, raw_json
            ) values (
              inv->>'customer_id',
              coalesce(inv->>'customer_email', inv->>'email', 'unknown@example.com'),
              coalesce(inv->>'customer_name', inv->>'payer_name', 'Unknown Customer'),
              inv->>'payer_cpf_cnpj',
              inv->>'payer_phone',
              nullif(inv->>'created_at','')::timestamptz,
              nullif(inv->>'updated_at','')::timestamptz,
              jsonb_build_object('id', inv->>'customer_id', 'source', 'invoice')
            ) on conflict (id) do update set
              email = coalesce(excluded.email, public.iugu_customers.email),
              name = coalesce(excluded.name, public.iugu_customers.name),
              updated_at_iugu = excluded.updated_at_iugu,
              raw_json = excluded.raw_json;
            
            customers_count := customers_count + 1;
          end if;
          
          -- Insert invoice
          insert into public.iugu_invoices (
            id, account_id, customer_id, subscription_id, status, 
            due_date, paid_at, payment_method, total_cents, paid_cents, 
            discount_cents, taxes_cents, external_reference, order_id,
            created_at_iugu, updated_at_iugu, raw_json
          ) values (
            inv->>'id',
            inv->>'account_id',
            inv->>'customer_id',
            inv->>'subscription_id',
            inv->>'status',
            nullif(inv->>'due_date','')::date,
            nullif(inv->>'paid_at','')::timestamptz,
            inv->>'payment_method',
            coalesce((inv->>'total_cents')::int, (inv->>'total')::numeric * 100),
            coalesce((inv->>'paid_cents')::int, (inv->>'paid')::numeric * 100),
            coalesce((inv->>'discount_cents')::int, (inv->>'discount')::numeric * 100),
            coalesce((inv->>'taxes_cents')::int, (inv->>'taxes')::numeric * 100),
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
          
          invoices_count := invoices_count + 1;
          
        exception when others then
          errors_count := errors_count + 1;
          raise notice 'Error processing invoice %: %', coalesce(inv->>'id', 'unknown'), sqlerrm;
        end;
      end loop;
      
      -- Mark batch as done
      update staging.iugu_batches 
      set status = 'done', processed_at = now() 
      where id = batch_rec.id;
      
      batches_count := batches_count + 1;
      
    exception when others then
      errors_count := errors_count + 1;
      raise notice 'Error processing batch %: %', batch_rec.id, sqlerrm;
    end;
  end loop;
  
  return query select batches_count, customers_count, invoices_count, errors_count;
end;
$$;

-- Also create a simple status check function
create or replace function public.check_staging_status()
returns table(
  total_batches int,
  pending_batches int,
  processing_batches int,
  done_batches int,
  total_customers int,
  total_invoices int
) language plpgsql as $$
begin
  return query
  select 
    (select count(*)::int from staging.iugu_batches),
    (select count(*)::int from staging.iugu_batches where status = 'pending'),
    (select count(*)::int from staging.iugu_batches where status = 'processing'),
    (select count(*)::int from staging.iugu_batches where status = 'done'),
    (select count(*)::int from public.iugu_customers),
    (select count(*)::int from public.iugu_invoices);
end;
$$;

commit;
