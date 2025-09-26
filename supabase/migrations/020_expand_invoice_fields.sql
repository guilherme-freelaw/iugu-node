-- Migration: 020_expand_invoice_fields.sql
-- Purpose: expand invoice table with more detailed fields from Iugu API

begin;

-- Add more fields to invoices table for richer data
alter table public.iugu_invoices 
add column if not exists payer_name text,
add column if not exists payer_email text,
add column if not exists payer_cpf_cnpj text,
add column if not exists payer_phone text,
add column if not exists secure_id text,
add column if not exists secure_url text,
add column if not exists notification_url text,
add column if not exists return_url text,
add column if not exists expired_url text,
add column if not exists financial_return_date date,
add column if not exists installments integer,
add column if not exists credit_card_brand text,
add column if not exists credit_card_last_4 text,
add column if not exists early_payment_discount boolean default false,
add column if not exists early_payment_discounts jsonb,
add column if not exists late_payment_fine jsonb,
add column if not exists commission_cents integer,
add column if not exists bank_slip jsonb,
add column if not exists pix jsonb,
add column if not exists logs jsonb,
add column if not exists custom_variables jsonb;

-- Create indexes for commonly queried fields
create index if not exists idx_iugu_invoices_payer_email on public.iugu_invoices(payer_email);
create index if not exists idx_iugu_invoices_payer_cpf_cnpj on public.iugu_invoices(payer_cpf_cnpj);
create index if not exists idx_iugu_invoices_payment_method on public.iugu_invoices(payment_method);
create index if not exists idx_iugu_invoices_financial_return_date on public.iugu_invoices(financial_return_date);
create index if not exists idx_iugu_invoices_installments on public.iugu_invoices(installments);
create index if not exists idx_iugu_invoices_credit_card_brand on public.iugu_invoices(credit_card_brand);

-- Create a view for invoice analytics
create or replace view public.invoice_analytics as
select 
  date_trunc('month', created_at_iugu) as month,
  status,
  payment_method,
  count(*) as invoice_count,
  sum(total_cents) as total_revenue_cents,
  sum(paid_cents) as total_paid_cents,
  sum(case when status = 'paid' then total_cents else 0 end) as paid_revenue_cents,
  avg(total_cents) as avg_invoice_cents,
  count(distinct customer_id) as unique_customers,
  count(case when installments > 1 then 1 end) as installment_invoices,
  count(case when early_payment_discount then 1 end) as early_discount_invoices
from public.iugu_invoices 
where created_at_iugu is not null
group by 
  date_trunc('month', created_at_iugu),
  status,
  payment_method
order by month desc, status, payment_method;

-- Create a view for customer payment behavior
create or replace view public.customer_payment_behavior as
select 
  customer_id,
  count(*) as total_invoices,
  count(case when status = 'paid' then 1 end) as paid_invoices,
  count(case when status = 'pending' then 1 end) as pending_invoices,
  count(case when status = 'expired' then 1 end) as expired_invoices,
  sum(total_cents) as total_billed_cents,
  sum(paid_cents) as total_paid_cents,
  avg(total_cents) as avg_invoice_cents,
  min(created_at_iugu) as first_invoice_date,
  max(created_at_iugu) as last_invoice_date,
  mode() within group (order by payment_method) as preferred_payment_method,
  avg(case when paid_at is not null and due_date is not null 
    then extract(days from paid_at::date - due_date::date) end) as avg_payment_delay_days
from public.iugu_invoices 
where customer_id is not null
group by customer_id;

-- Create function to get invoice statistics
create or replace function public.get_invoice_stats(
  start_date date default null,
  end_date date default null
)
returns table(
  total_invoices bigint,
  paid_invoices bigint,
  pending_invoices bigint,
  expired_invoices bigint,
  total_revenue_cents bigint,
  paid_revenue_cents bigint,
  avg_invoice_value_cents numeric,
  unique_customers bigint,
  payment_methods jsonb
) language plpgsql as $$
begin
  return query
  select 
    count(*) as total_invoices,
    count(case when status = 'paid' then 1 end) as paid_invoices,
    count(case when status = 'pending' then 1 end) as pending_invoices,
    count(case when status = 'expired' then 1 end) as expired_invoices,
    sum(total_cents) as total_revenue_cents,
    sum(case when status = 'paid' then total_cents else 0 end) as paid_revenue_cents,
    avg(total_cents) as avg_invoice_value_cents,
    count(distinct customer_id) as unique_customers,
    jsonb_object_agg(payment_method, method_count) as payment_methods
  from public.iugu_invoices i
  left join (
    select payment_method, count(*) as method_count
    from public.iugu_invoices 
    where (start_date is null or created_at_iugu::date >= start_date)
      and (end_date is null or created_at_iugu::date <= end_date)
      and payment_method is not null
    group by payment_method
  ) pm on true
  where (start_date is null or i.created_at_iugu::date >= start_date)
    and (end_date is null or i.created_at_iugu::date <= end_date);
end;
$$;

commit;
