-- Migration: 007_upsert_invoice_items_payment_methods.sql
-- Purpose: add RPCs to upsert invoice items and payment methods from payloads

begin;

-- upsert invoice items: delete-existing-and-insert (idempotent)
create or replace function public.upsert_invoice_items_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_invoice_id text;
  item jsonb;
begin
  v_invoice_id := payload->>'id';
  if v_invoice_id is null then
    raise exception 'payload missing id';
  end if;

  -- replace existing items for the invoice
  delete from public.iugu_invoice_items where invoice_id = v_invoice_id;

  if payload ? 'items' then
    for item in select jsonb_array_elements(payload->'items') loop
      insert into public.iugu_invoice_items (invoice_id, description, quantity, price_cents, raw_json)
      values (
        v_invoice_id,
        item->>'description',
        nullif(item->>'quantity','')::int,
        nullif(item->>'price_cents','')::int,
        item
      );
    end loop;
  end if;
end;
$$;

-- upsert payment method from various webhook payload shapes
create or replace function public.upsert_payment_method_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  pm jsonb;
  v_id text;
begin
  if payload ? 'payment_method' then
    pm := payload->'payment_method';
  elsif payload ? 'data' then
    pm := payload->'data';
  elsif payload ? 'id' then
    pm := payload;
  else
    raise exception 'payload does not contain a recognizable payment method object';
  end if;

  v_id := pm->>'id';
  if v_id is null then
    raise exception 'payment method payload missing id';
  end if;

  insert into public.iugu_payment_methods (id, customer_id, description, brand, holder_name, last4, is_default, raw_json, created_at)
  values (
    v_id,
    coalesce(pm->>'customer_id', pm->>'customer'),
    pm->>'description',
    pm->>'brand',
    pm->>'holder_name',
    pm->>'last4',
    (case when lower(coalesce(pm->>'is_default','false')) in ('true','1','sim','s','yes','y') then true else false end),
    pm,
    nullif(pm->>'created_at','')::timestamptz
  ) on conflict (id) do update set
    customer_id = coalesce(excluded.customer_id, public.iugu_payment_methods.customer_id),
    description = coalesce(excluded.description, public.iugu_payment_methods.description),
    brand = coalesce(excluded.brand, public.iugu_payment_methods.brand),
    holder_name = coalesce(excluded.holder_name, public.iugu_payment_methods.holder_name),
    last4 = coalesce(excluded.last4, public.iugu_payment_methods.last4),
    is_default = excluded.is_default,
    raw_json = excluded.raw_json;
end;
$$;

commit;


