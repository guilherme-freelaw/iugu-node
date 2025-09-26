-- Migration: 021_fix_extract_function.sql
-- Purpose: fix extract function error in customer payment behavior view

begin;

-- Recreate the view with corrected extract function
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
    then (paid_at::date - due_date::date) end) as avg_payment_delay_days
from public.iugu_invoices 
where customer_id is not null
group by customer_id;

commit;
