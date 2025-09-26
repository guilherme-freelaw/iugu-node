-- Migration: 015_add_core_missing_entities.sql
-- Purpose: add critical missing entities - transfers, charges, accounts

begin;

-- TRANSFERS: Transferências bancárias e saques
create table if not exists public.iugu_transfers (
  id                    text primary key,
  amount_cents          int not null,
  bank_code             text,
  bank_name             text,
  agency                text,
  agency_digit          text,
  account               text,
  account_digit         text,
  account_type          text,
  receiver_name         text,
  receiver_cpf_cnpj     text,
  status                text,
  type                  text,
  transfer_fee_cents    int,
  request_date          date,
  execution_date        date,
  execution_time        text,
  reference             text,
  external_reference    text,
  created_at_iugu       timestamptz,
  updated_at_iugu       timestamptz,
  raw_json              jsonb not null,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index if not exists idx_iugu_transfers_status on public.iugu_transfers (status);
create index if not exists idx_iugu_transfers_request_date on public.iugu_transfers (request_date);
create index if not exists idx_iugu_transfers_execution_date on public.iugu_transfers (execution_date);
create index if not exists idx_iugu_transfers_receiver_doc on public.iugu_transfers (receiver_cpf_cnpj);
create index if not exists idx_iugu_transfers_amount on public.iugu_transfers (amount_cents);

-- CHARGES: Cobranças diretas (avulsas, não recorrentes)
create table if not exists public.iugu_charges (
  id                    text primary key,
  account_id            text,
  customer_id           text references public.iugu_customers(id),
  invoice_id            text references public.iugu_invoices(id),
  method                text,
  token                 text,
  response_url          text,
  amount_cents          int not null,
  currency              text default 'BRL',
  description           text,
  email                 text,
  phone                 text,
  customer_name         text,
  status                text,
  paid_at               timestamptz,
  created_at_iugu       timestamptz,
  updated_at_iugu       timestamptz,
  raw_json              jsonb not null,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index if not exists idx_iugu_charges_customer on public.iugu_charges (customer_id);
create index if not exists idx_iugu_charges_invoice on public.iugu_charges (invoice_id);
create index if not exists idx_iugu_charges_status on public.iugu_charges (status);
create index if not exists idx_iugu_charges_paid_at on public.iugu_charges (paid_at);
create index if not exists idx_iugu_charges_amount on public.iugu_charges (amount_cents);
create index if not exists idx_iugu_charges_method on public.iugu_charges (method);

-- ACCOUNTS: Contas e subcontas da Iugu
create table if not exists public.iugu_accounts (
  id                    text primary key,
  name                  text,
  email                 text,
  cpf_cnpj              text,
  phone                 text,
  address_street        text,
  address_number        text,
  address_city          text,
  address_state         text,
  address_zip_code      text,
  address_district      text,
  address_complement    text,
  address_country       text,
  bank_code             text,
  bank_name             text,
  agency                text,
  agency_digit          text,
  account               text,
  account_digit         text,
  account_type          text,
  verified              boolean,
  commission_percent    decimal(5,2),
  balance_cents         int,
  frozen_balance_cents  int,
  commission_cents      int,
  auto_advance          boolean,
  advance_fee           decimal(5,2),
  configuration         jsonb,
  created_at_iugu       timestamptz,
  updated_at_iugu       timestamptz,
  raw_json              jsonb not null,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index if not exists idx_iugu_accounts_email on public.iugu_accounts (email);
create index if not exists idx_iugu_accounts_cpf_cnpj on public.iugu_accounts (cpf_cnpj);
create index if not exists idx_iugu_accounts_verified on public.iugu_accounts (verified);
create index if not exists idx_iugu_accounts_balance on public.iugu_accounts (balance_cents);

-- CHARGEBACKS: Estornos e disputas
create table if not exists public.iugu_chargebacks (
  id                    text primary key,
  invoice_id            text references public.iugu_invoices(id),
  amount_cents          int not null,
  currency              text default 'BRL',
  reason                text,
  reason_code           text,
  status                text,
  type                  text,
  due_date              date,
  created_at_iugu       timestamptz,
  updated_at_iugu       timestamptz,
  raw_json              jsonb not null,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index if not exists idx_iugu_chargebacks_invoice on public.iugu_chargebacks (invoice_id);
create index if not exists idx_iugu_chargebacks_status on public.iugu_chargebacks (status);
create index if not exists idx_iugu_chargebacks_due_date on public.iugu_chargebacks (due_date);
create index if not exists idx_iugu_chargebacks_amount on public.iugu_chargebacks (amount_cents);

-- Add staging tables for new entities
create table if not exists staging.iugu_transfers_export_raw (
  id            bigserial primary key,
  source_file   text,
  payload       jsonb not null,
  ingested_at   timestamptz default now()
);
create index if not exists gin_iugu_transfers_payload on staging.iugu_transfers_export_raw using gin (payload);

create table if not exists staging.iugu_charges_export_raw (
  id            bigserial primary key,
  source_file   text,
  payload       jsonb not null,
  ingested_at   timestamptz default now()
);
create index if not exists gin_iugu_charges_payload on staging.iugu_charges_export_raw using gin (payload);

create table if not exists staging.iugu_accounts_export_raw (
  id            bigserial primary key,
  source_file   text,
  payload       jsonb not null,
  ingested_at   timestamptz default now()
);
create index if not exists gin_iugu_accounts_payload on staging.iugu_accounts_export_raw using gin (payload);

commit;
