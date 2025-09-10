-- Migration: 006_fix_upsert_customers_payload.sql
-- Purpose: make upsert_customer_from_payload accept multiple webhook payload shapes

begin;

create or replace function public.upsert_customer_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_id text;
  cust jsonb;
  v_email text;
begin
  -- normalize incoming payload to a customer JSON object
  if payload ? 'customer' then
    cust := payload->'customer';
  elsif payload ? 'data' then
    cust := payload->'data';
  elsif payload ? 'id' then
    cust := payload; -- already the customer object
  else
    -- nothing we can do
    raise exception 'payload does not contain a recognizable customer object';
  end if;

  v_id := cust->>'id';
  if v_id is null then
    raise exception 'customer payload missing id';
  end if;

  v_email := cust->>'email';
  -- Avoid null insertion into NOT NULL email column by using empty string if absent
  if v_email is null then
    v_email := '';
  end if;

  insert into public.iugu_customers (id, email, name, cpf_cnpj, phone, custom_variables, created_at_iugu, updated_at_iugu, raw_json)
  values (
    v_id,
    v_email,
    cust->>'name',
    cust->>'cpf_cnpj',
    cust->>'phone',
    cust->'custom_variables',
    nullif(cust->>'created_at','')::timestamptz,
    nullif(cust->>'updated_at','')::timestamptz,
    cust
  ) on conflict (id) do update set
    email = coalesce(excluded.email, public.iugu_customers.email),
    name = coalesce(excluded.name, public.iugu_customers.name),
    cpf_cnpj = coalesce(excluded.cpf_cnpj, public.iugu_customers.cpf_cnpj),
    phone = coalesce(excluded.phone, public.iugu_customers.phone),
    custom_variables = coalesce(excluded.custom_variables, public.iugu_customers.custom_variables),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json;

end;
$$;

commit;


