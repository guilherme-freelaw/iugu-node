-- Migration: 005_upsert_customers.sql
-- Purpose: add RPC to upsert customers from webhook payloads

begin;

create or replace function public.upsert_customer_from_payload(payload jsonb)
returns void language plpgsql as $$
begin
  if not (payload ? 'id' or payload ? 'customer') then
    raise exception 'payload missing id or customer object';
  end if;

  -- determine customer object
  if payload ? 'customer' then
    insert into public.iugu_customers (id, email, name, cpf_cnpj, phone, custom_variables, created_at_iugu, updated_at_iugu, raw_json)
    values (
      payload->'customer'->>'id',
      payload->'customer'->>'email',
      payload->'customer'->>'name',
      payload->'customer'->>'cpf_cnpj',
      payload->'customer'->>'phone',
      payload->'customer'->'custom_variables',
      nullif(payload->'customer'->>'created_at','')::timestamptz,
      nullif(payload->'customer'->>'updated_at','')::timestamptz,
      payload->'customer'
    ) on conflict (id) do update set
      email = coalesce(excluded.email, public.iugu_customers.email),
      name = coalesce(excluded.name, public.iugu_customers.name),
      cpf_cnpj = coalesce(excluded.cpf_cnpj, public.iugu_customers.cpf_cnpj),
      phone = coalesce(excluded.phone, public.iugu_customers.phone),
      custom_variables = coalesce(excluded.custom_variables, public.iugu_customers.custom_variables),
      updated_at_iugu = excluded.updated_at_iugu,
      raw_json = excluded.raw_json;
  else
    insert into public.iugu_customers (id, raw_json)
    values (payload->>'id', payload)
    on conflict (id) do update set raw_json = excluded.raw_json;
  end if;
end;
$$;

commit;


