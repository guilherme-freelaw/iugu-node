-- Migration: 002_create_iugu_rpcs.sql
-- Purpose: create RPCs for notifying processor and upserting invoices/subscriptions

begin;

-- RPC helper: notify processor via pg_notify (expects a trigger to call it or direct rpc)
create or replace function public.notify_iugu_webhook_event(dedupe_key text)
returns void language plpgsql as $$
begin
  perform pg_notify('iugu_webhook_event_channel', dedupe_key);
end;
$$;

-- upsert invoice from JSON payload
create or replace function public.upsert_invoice_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_id text;
begin
  v_id := (payload->>'id')::text;
  if v_id is null then
    raise exception 'payload missing id';
  end if;

  insert into public.iugu_invoices (
    id, account_id, customer_id, subscription_id, status, due_date, paid_at, payment_method,
    pix_end_to_end_id, installments, secure_url, bank_slip_url, pdf_url, total_cents, paid_cents,
    discount_cents, taxes_cents, external_reference, order_id, created_at_iugu, updated_at_iugu, raw_json
  ) values (
    payload->>'id',
    payload->>'account_id',
    coalesce(payload->>'customer_id', payload->'customer'->>'id'),
    coalesce(payload->>'subscription_id', payload->'subscription'->>'id'),
    payload->>'status',
    nullif(payload->>'due_date','')::date,
    nullif(payload->>'paid_at','')::timestamptz,
    payload->>'payment_method',
    payload->>'pix_end_to_end_id',
    (payload->>'installments')::int,
    payload->>'secure_url',
    payload->>'bank_slip_url',
    payload->>'pdf_url',
    (payload->>'total_cents')::int,
    (payload->>'paid_cents')::int,
    (payload->>'discount_cents')::int,
    (payload->>'taxes_cents')::int,
    payload->>'external_reference',
    payload->>'order_id',
    nullif(payload->>'created_at','')::timestamptz,
    nullif(payload->>'updated_at','')::timestamptz,
    payload
  ) on conflict (id) do update set
    account_id = coalesce(excluded.account_id, public.iugu_invoices.account_id),
    customer_id = coalesce(excluded.customer_id, public.iugu_invoices.customer_id),
    subscription_id = coalesce(excluded.subscription_id, public.iugu_invoices.subscription_id),
    status = excluded.status,
    due_date = excluded.due_date,
    paid_at = excluded.paid_at,
    payment_method = excluded.payment_method,
    secure_url = excluded.secure_url,
    bank_slip_url = excluded.bank_slip_url,
    pdf_url = excluded.pdf_url,
    total_cents = coalesce(excluded.total_cents, public.iugu_invoices.total_cents),
    paid_cents = coalesce(excluded.paid_cents, public.iugu_invoices.paid_cents),
    discount_cents = coalesce(excluded.discount_cents, public.iugu_invoices.discount_cents),
    taxes_cents = coalesce(excluded.taxes_cents, public.iugu_invoices.taxes_cents),
    external_reference = coalesce(excluded.external_reference, public.iugu_invoices.external_reference),
    order_id = coalesce(excluded.order_id, public.iugu_invoices.order_id),
    created_at_iugu = coalesce(public.iugu_invoices.created_at_iugu, excluded.created_at_iugu),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json;
end;
$$;

-- upsert subscription from JSON payload
create or replace function public.upsert_subscription_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_id text;
begin
  v_id := (payload->>'id')::text;
  if v_id is null then
    raise exception 'payload missing id';
  end if;

  insert into public.iugu_subscriptions (
    id, customer_id, plan_id, plan_identifier, plan_name, status, suspended, credits, price_cents,
    currency, renews_at, expires_at, created_at_iugu, updated_at_iugu, raw_json
  ) values (
    payload->>'id',
    payload->>'customer_id',
    payload->>'plan_id',
    payload->>'plan_identifier',
    payload->>'plan_name',
    payload->>'status',
    (case when lower(payload->>'suspended') in ('true','1','sim','s','yes','y') then true else false end),
    (payload->>'credits')::int,
    (payload->>'price_cents')::int,
    payload->>'currency',
    nullif(payload->>'renews_at','')::date,
    nullif(payload->>'expires_at','')::date,
    nullif(payload->>'created_at','')::timestamptz,
    nullif(payload->>'updated_at','')::timestamptz,
    payload
  ) on conflict (id) do update set
    customer_id = coalesce(excluded.customer_id, public.iugu_subscriptions.customer_id),
    plan_id = coalesce(excluded.plan_id, public.iugu_subscriptions.plan_id),
    plan_identifier = coalesce(excluded.plan_identifier, public.iugu_subscriptions.plan_identifier),
    plan_name = coalesce(excluded.plan_name, public.iugu_subscriptions.plan_name),
    status = excluded.status,
    suspended = excluded.suspended,
    credits = coalesce(excluded.credits, public.iugu_subscriptions.credits),
    price_cents = coalesce(excluded.price_cents, public.iugu_subscriptions.price_cents),
    currency = coalesce(excluded.currency, public.iugu_subscriptions.currency),
    renews_at = excluded.renews_at,
    expires_at = excluded.expires_at,
    created_at_iugu = coalesce(public.iugu_subscriptions.created_at_iugu, excluded.created_at_iugu),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json;
end;
$$;

-- generic upsert placeholder (can be expanded)
create or replace function public.upsert_generic_payload(payload jsonb)
returns void language plpgsql as $$
begin
  -- simple no-op placeholder
  raise notice 'upsert_generic_payload called';
end;
$$;

commit;


