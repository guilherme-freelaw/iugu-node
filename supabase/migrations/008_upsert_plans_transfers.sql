-- Migration: 008_upsert_plans_transfers.sql
-- Purpose: add RPCs to upsert plans and transfers

begin;

create or replace function public.upsert_plan_from_payload(payload jsonb)
returns void language plpgsql as $$
begin
  if payload is null then
    raise exception 'payload missing';
  end if;

  insert into public.iugu_plans (id, identifier, name, interval, interval_count, value_cents, currency, created_at_iugu, updated_at_iugu, raw_json)
  values (
    payload->>'id',
    payload->>'identifier',
    payload->>'name',
    payload->>'interval',
    nullif(payload->>'interval_count','')::int,
    nullif(payload->>'value_cents','')::int,
    payload->>'currency',
    nullif(payload->>'created_at','')::timestamptz,
    nullif(payload->>'updated_at','')::timestamptz,
    payload
  ) on conflict (id) do update set
    identifier = coalesce(excluded.identifier, public.iugu_plans.identifier),
    name = coalesce(excluded.name, public.iugu_plans.name),
    interval = coalesce(excluded.interval, public.iugu_plans.interval),
    interval_count = coalesce(excluded.interval_count, public.iugu_plans.interval_count),
    value_cents = coalesce(excluded.value_cents, public.iugu_plans.value_cents),
    currency = coalesce(excluded.currency, public.iugu_plans.currency),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json;
end;
$$;

create or replace function public.upsert_transfer_from_payload(payload jsonb)
returns void language plpgsql as $$
begin
  if payload is null then
    raise exception 'payload missing';
  end if;

  insert into public.iugu_transfers (id, account_id, amount_cents, status, created_at_iugu, updated_at_iugu, raw_json)
  values (
    payload->>'id',
    payload->>'account_id',
    nullif(payload->>'amount_cents','')::int,
    payload->>'status',
    nullif(payload->>'created_at','')::timestamptz,
    nullif(payload->>'updated_at','')::timestamptz,
    payload
  ) on conflict (id) do update set
    account_id = coalesce(excluded.account_id, public.iugu_transfers.account_id),
    amount_cents = coalesce(excluded.amount_cents, public.iugu_transfers.amount_cents),
    status = coalesce(excluded.status, public.iugu_transfers.status),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json;
end;
$$;

commit;


