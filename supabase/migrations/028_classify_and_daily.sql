-- Migration: 028_classify_and_daily.sql
-- Purpose: classify payment methods with robust fallbacks and expose daily revenue by method

begin;

create or replace view public.invoice_payments_classified as
select
  i.id,
  (i.paid_at at time zone 'America/Sao_Paulo')::date as paid_date,
  case
    when (i.payment_method ilike '%pix%' or i.pix_end_to_end_id is not null) then 'pix'
    when (i.payment_method ilike '%credit%' or i.payment_method ilike '%card%' or i.secure_url is not null) then 'credit_card'
    when (i.payment_method ilike '%bank_slip%' or i.payment_method ilike '%boleto%' or i.bank_slip_url is not null) then 'bank_slip'
    else coalesce(nullif(i.payment_method, ''), 'other')
  end as method,
  coalesce(i.paid_cents, 0) as paid_cents
from public.iugu_invoices i
where coalesce(i.status,'') in ('paid','partially_paid')
  and i.paid_at is not null
  and not (i.id = 'test_inv' or i.id ilike 'test_%' or i.id ilike '%teste%');

comment on view public.invoice_payments_classified is 'Payments with robust method classification and paid_date normalized to America/Sao_Paulo';

create or replace view public.daily_revenue_by_method as
select paid_date, method, sum(paid_cents) as total_cents
from public.invoice_payments_classified
group by paid_date, method
order by paid_date, method;

grant select on public.invoice_payments_classified to service_role;
grant select on public.daily_revenue_by_method to service_role;

commit;


