-- Migration: 016_upsert_missing_entities_rpcs.sql
-- Purpose: create upsert RPCs for transfers, charges, accounts, chargebacks

begin;

-- RPC to upsert transfers from API payloads
create or replace function public.upsert_transfer_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_id text;
begin
  v_id := payload->>'id';
  if v_id is null then
    raise exception 'transfer payload missing id';
  end if;

  insert into public.iugu_transfers (
    id, amount_cents, bank_code, bank_name, agency, agency_digit, account, account_digit,
    account_type, receiver_name, receiver_cpf_cnpj, status, type, transfer_fee_cents,
    request_date, execution_date, execution_time, reference, external_reference,
    created_at_iugu, updated_at_iugu, raw_json
  ) values (
    v_id,
    coalesce((payload->>'amount_cents')::int, (payload->>'amount')::int * 100),
    payload->>'bank_code',
    payload->>'bank_name',
    payload->>'agency',
    payload->>'agency_digit',
    payload->>'account',
    payload->>'account_digit',
    payload->>'account_type',
    payload->>'receiver_name',
    payload->>'receiver_cpf_cnpj',
    payload->>'status',
    payload->>'type',
    coalesce((payload->>'transfer_fee_cents')::int, (payload->>'transfer_fee')::int * 100),
    nullif(payload->>'request_date','')::date,
    nullif(payload->>'execution_date','')::date,
    payload->>'execution_time',
    payload->>'reference',
    payload->>'external_reference',
    nullif(payload->>'created_at','')::timestamptz,
    nullif(payload->>'updated_at','')::timestamptz,
    payload
  ) on conflict (id) do update set
    amount_cents = excluded.amount_cents,
    status = excluded.status,
    execution_date = coalesce(excluded.execution_date, public.iugu_transfers.execution_date),
    execution_time = coalesce(excluded.execution_time, public.iugu_transfers.execution_time),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json,
    updated_at = now();
end;
$$;

-- RPC to upsert charges from API payloads
create or replace function public.upsert_charge_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_id text;
begin
  v_id := payload->>'id';
  if v_id is null then
    raise exception 'charge payload missing id';
  end if;

  insert into public.iugu_charges (
    id, account_id, customer_id, invoice_id, method, token, response_url,
    amount_cents, currency, description, email, phone, customer_name,
    status, paid_at, created_at_iugu, updated_at_iugu, raw_json
  ) values (
    v_id,
    payload->>'account_id',
    payload->>'customer_id',
    payload->>'invoice_id',
    payload->>'method',
    payload->>'token',
    payload->>'response_url',
    coalesce((payload->>'amount_cents')::int, (payload->>'amount')::int * 100),
    coalesce(payload->>'currency', 'BRL'),
    payload->>'description',
    payload->>'email',
    payload->>'phone',
    payload->>'customer_name',
    payload->>'status',
    nullif(payload->>'paid_at','')::timestamptz,
    nullif(payload->>'created_at','')::timestamptz,
    nullif(payload->>'updated_at','')::timestamptz,
    payload
  ) on conflict (id) do update set
    status = excluded.status,
    paid_at = coalesce(excluded.paid_at, public.iugu_charges.paid_at),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json,
    updated_at = now();
end;
$$;

-- RPC to upsert accounts from API payloads
create or replace function public.upsert_account_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_id text;
begin
  v_id := payload->>'id';
  if v_id is null then
    raise exception 'account payload missing id';
  end if;

  insert into public.iugu_accounts (
    id, name, email, cpf_cnpj, phone,
    address_street, address_number, address_city, address_state, address_zip_code,
    address_district, address_complement, address_country,
    bank_code, bank_name, agency, agency_digit, account, account_digit, account_type,
    verified, commission_percent, balance_cents, frozen_balance_cents, commission_cents,
    auto_advance, advance_fee, configuration,
    created_at_iugu, updated_at_iugu, raw_json
  ) values (
    v_id,
    payload->>'name',
    payload->>'email',
    payload->>'cpf_cnpj',
    payload->>'phone',
    payload->>'address_street',
    payload->>'address_number',
    payload->>'address_city',
    payload->>'address_state',
    payload->>'address_zip_code',
    payload->>'address_district',
    payload->>'address_complement',
    payload->>'address_country',
    payload->>'bank_code',
    payload->>'bank_name',
    payload->>'agency',
    payload->>'agency_digit',
    payload->>'account',
    payload->>'account_digit',
    payload->>'account_type',
    coalesce((payload->>'verified')::boolean, false),
    (payload->>'commission_percent')::decimal(5,2),
    coalesce((payload->>'balance_cents')::int, (payload->>'balance')::int * 100),
    coalesce((payload->>'frozen_balance_cents')::int, (payload->>'frozen_balance')::int * 100),
    coalesce((payload->>'commission_cents')::int, (payload->>'commission')::int * 100),
    coalesce((payload->>'auto_advance')::boolean, false),
    (payload->>'advance_fee')::decimal(5,2),
    payload->'configuration',
    nullif(payload->>'created_at','')::timestamptz,
    nullif(payload->>'updated_at','')::timestamptz,
    payload
  ) on conflict (id) do update set
    name = coalesce(excluded.name, public.iugu_accounts.name),
    email = coalesce(excluded.email, public.iugu_accounts.email),
    verified = excluded.verified,
    balance_cents = excluded.balance_cents,
    frozen_balance_cents = excluded.frozen_balance_cents,
    commission_cents = excluded.commission_cents,
    configuration = coalesce(excluded.configuration, public.iugu_accounts.configuration),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json,
    updated_at = now();
end;
$$;

-- RPC to upsert chargebacks from API payloads
create or replace function public.upsert_chargeback_from_payload(payload jsonb)
returns void language plpgsql as $$
declare
  v_id text;
begin
  v_id := payload->>'id';
  if v_id is null then
    raise exception 'chargeback payload missing id';
  end if;

  insert into public.iugu_chargebacks (
    id, invoice_id, amount_cents, currency, reason, reason_code,
    status, type, due_date, created_at_iugu, updated_at_iugu, raw_json
  ) values (
    v_id,
    payload->>'invoice_id',
    coalesce((payload->>'amount_cents')::int, (payload->>'amount')::int * 100),
    coalesce(payload->>'currency', 'BRL'),
    payload->>'reason',
    payload->>'reason_code',
    payload->>'status',
    payload->>'type',
    nullif(payload->>'due_date','')::date,
    nullif(payload->>'created_at','')::timestamptz,
    nullif(payload->>'updated_at','')::timestamptz,
    payload
  ) on conflict (id) do update set
    status = excluded.status,
    due_date = coalesce(excluded.due_date, public.iugu_chargebacks.due_date),
    updated_at_iugu = excluded.updated_at_iugu,
    raw_json = excluded.raw_json,
    updated_at = now();
end;
$$;

commit;
