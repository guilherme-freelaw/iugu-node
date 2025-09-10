-- Migration: 001_create_iugu_schema.sql
-- Created by: assistant
-- Purpose: create public and staging tables for Iugu data hub (MVP read-only)

-- SCHEMA: public (main normalized tables)
begin;

create table if not exists public.iugu_customers (
  id                text primary key,
  email             text not null,
  name              text,
  cpf_cnpj          text,
  phone             text,
  custom_variables  jsonb,
  created_at_iugu   timestamptz,
  updated_at_iugu   timestamptz,
  raw_json          jsonb not null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists idx_iugu_customers_email on public.iugu_customers (email);
create index if not exists idx_iugu_customers_cpf_cnpj on public.iugu_customers (cpf_cnpj);

create table if not exists public.iugu_plans (
  id                text primary key,
  identifier        text unique,
  name              text,
  interval          text,
  interval_count    int,
  value_cents       int,
  currency          text,
  created_at_iugu   timestamptz,
  updated_at_iugu   timestamptz,
  raw_json          jsonb not null
);

create table if not exists public.iugu_subscriptions (
  id                  text primary key,
  customer_id         text not null references public.iugu_customers(id),
  plan_id             text references public.iugu_plans(id),
  plan_identifier     text,
  plan_name           text,
  status              text,
  suspended           boolean,
  credits             int,
  price_cents         int,
  currency            text,
  renews_at           date,
  expires_at          date,
  created_at_iugu     timestamptz,
  updated_at_iugu     timestamptz,
  raw_json            jsonb not null
);
create index if not exists idx_iugu_subscriptions_customer on public.iugu_subscriptions (customer_id);
create index if not exists idx_iugu_subscriptions_status on public.iugu_subscriptions (status);
create index if not exists idx_iugu_subscriptions_updated on public.iugu_subscriptions (updated_at_iugu);
create index if not exists idx_iugu_subscriptions_expires on public.iugu_subscriptions (expires_at);

create table if not exists public.iugu_payment_methods (
  id                text primary key,
  customer_id       text not null references public.iugu_customers(id),
  description       text,
  brand             text,
  holder_name       text,
  last4             text,
  is_default        boolean,
  raw_json          jsonb not null,
  created_at        timestamptz default now()
);
create index if not exists idx_iugu_pm_customer on public.iugu_payment_methods (customer_id);

create table if not exists public.iugu_invoices (
  id                  text primary key,
  account_id          text,
  customer_id         text references public.iugu_customers(id),
  subscription_id     text references public.iugu_subscriptions(id),
  status              text,
  due_date            date,
  paid_at             timestamptz,
  payment_method      text,
  pix_end_to_end_id   text,
  installments        int,
  secure_url          text,
  bank_slip_url       text,
  pdf_url             text,
  total_cents         int,
  paid_cents          int,
  discount_cents      int,
  taxes_cents         int,
  external_reference  text,
  order_id            text,
  created_at_iugu     timestamptz,
  updated_at_iugu     timestamptz,
  raw_json            jsonb not null
);
create index if not exists idx_iugu_invoices_customer on public.iugu_invoices (customer_id);
create index if not exists idx_iugu_invoices_subscription on public.iugu_invoices (subscription_id);
create index if not exists idx_iugu_invoices_status on public.iugu_invoices (status);
create index if not exists idx_iugu_invoices_due on public.iugu_invoices (due_date);
create index if not exists idx_iugu_invoices_paid_at on public.iugu_invoices (paid_at);
create index if not exists idx_iugu_invoices_updated on public.iugu_invoices (updated_at_iugu);
create index if not exists idx_iugu_invoices_extref on public.iugu_invoices (external_reference);

create table if not exists public.iugu_invoice_items (
  id            bigserial primary key,
  invoice_id    text not null references public.iugu_invoices(id) on delete cascade,
  description   text,
  quantity      int,
  price_cents   int,
  raw_json      jsonb not null
);
create index if not exists idx_iugu_invoice_items_invoice on public.iugu_invoice_items (invoice_id);

create table if not exists public.iugu_webhook_events (
  id                bigserial primary key,
  event_name        text not null,
  entity_id         text,
  payload           jsonb not null,
  received_at       timestamptz default now(),
  dedupe_key        text unique,
  processed_at      timestamptz,
  process_status    text,
  process_error     text
);
create index if not exists idx_iugu_webhooks_event on public.iugu_webhook_events (event_name);
create index if not exists idx_iugu_webhooks_entity on public.iugu_webhook_events (entity_id);

-- SCHEMA: staging (raw exports)
create schema if not exists staging;

create table if not exists staging.iugu_subscriptions_export_raw (
  id            bigserial primary key,
  source_file   text,
  payload       jsonb not null,
  ingested_at   timestamptz default now()
);
create index if not exists gin_iugu_subs_export_payload on staging.iugu_subscriptions_export_raw using gin (payload);

create table if not exists staging.iugu_customers_export_raw (
  id            bigserial primary key,
  source_file   text,
  payload       jsonb not null,
  ingested_at   timestamptz default now()
);
create index if not exists gin_iugu_cust_export_payload on staging.iugu_customers_export_raw using gin (payload);

commit;


