-- Migration: 003_fix_upsert_subscription.sql
-- Purpose: improve upsert_subscription_from_payload to ensure customer and plan exist

begin;

create or replace function public.upsert_subscription_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_id text;
begin
  v_id := (payload->>'id')::text;
  if v_id is null then
    raise exception 'payload missing id';
  end if;

  -- upsert customer if payload contains customer object
  if payload ? 'customer' then
    insert into public.iugu_customers (id, email, name, raw_json, created_at_iugu, updated_at_iugu)
    values (
      payload->'customer'->>'id',
      payload->'customer'->>'email',
      payload->'customer'->>'name',
      payload->'customer',
      nullif(payload->'customer'->>'created_at','')::timestamptz,
      nullif(payload->'customer'->>'updated_at','')::timestamptz
    )
    on conflict (id) do update
      set email = coalesce(excluded.email, public.iugu_customers.email),
          name = coalesce(excluded.name, public.iugu_customers.name),
          raw_json = excluded.raw_json;
  end if;

  -- upsert plan if payload contains plan object or insert minimal plan if plan_id provided
  if payload ? 'plan' then
    insert into public.iugu_plans (id, identifier, name, value_cents, currency, raw_json, created_at_iugu, updated_at_iugu)
    values (
      payload->'plan'->>'id',
      payload->'plan'->>'identifier',
      payload->'plan'->>'name',
      nullif(payload->'plan'->>'value_cents','')::int,
      payload->'plan'->>'currency',
      payload->'plan',
      nullif(payload->'plan'->>'created_at','')::timestamptz,
      nullif(payload->'plan'->>'updated_at','')::timestamptz
    )
    on conflict (id) do update
      set identifier = coalesce(excluded.identifier, public.iugu_plans.identifier),
          name = coalesce(excluded.name, public.iugu_plans.name),
          value_cents = coalesce(excluded.value_cents, public.iugu_plans.value_cents),
          currency = coalesce(excluded.currency, public.iugu_plans.currency),
          raw_json = excluded.raw_json;
  elsif payload->>'plan_id' is not null then
    insert into public.iugu_plans (id, identifier, name, raw_json)
    values (payload->>'plan_id', payload->>'plan_identifier', payload->>'plan_name', jsonb_build_object('inferred_from','subscription_payload'))
    on conflict (id) do nothing;
  end if;

  -- now upsert subscription
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

commit;


