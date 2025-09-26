-- Migration: 027_competency_hybrid_and_pm_backfill.sql
-- Purpose: normalize payment_method, create competency-valid view and hybrid revenue function

begin;

-- 1) Backfill helper: try to fill payment_method from raw_json when null
create or replace function public.backfill_payment_method_from_raw(limit_rows int default 10000)
returns int language plpgsql as $$
declare
  updated_count int := 0;
begin
  update public.iugu_invoices i
  set payment_method = coalesce(
    i.payment_method,
    (i.raw_json->>'payment_method'),
    (i.raw_json->'payment_method'->>'method'),
    (i.raw_json->'payment'->>'method')
  )
  where i.payment_method is null
  and i.id in (
    select id from public.iugu_invoices where payment_method is null limit limit_rows
  );

  get diagnostics updated_count = row_count;
  return updated_count;
end$$;

grant execute on function public.backfill_payment_method_from_raw(int) to service_role;

-- 2) Competência válida (exclui canceled, expired, pending) + filtros de teste
create or replace view public.kpi_due_competency_valid as
select
  due_date::date as day,
  payment_method,
  sum(total_cents) as total_cents,
  count(*) as invoices
from public.iugu_invoices
where due_date is not null
  and coalesce(status,'') not in ('canceled','expired','pending')
  and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%')
group by 1,2
order by 1,2;

comment on view public.kpi_due_competency_valid is 'Competência por due_date excluindo canceled/expired/pending e testes';

-- 3) Receita híbrida: boleto por competência válida, pix/cartão por caixa
create or replace function public.get_monthly_revenue_hybrid(month_date date default date_trunc('month', now())::date)
returns table (
  total_cents numeric,
  details jsonb
) language plpgsql stable as $$
declare
  start_ts timestamptz := date_trunc('month', month_date);
  end_ts   timestamptz := date_trunc('month', month_date) + interval '1 month';
  boleto_cents numeric := 0;
  pix_cc_cents numeric := 0;
begin
  -- boleto por competência válida
  select coalesce(sum(total_cents),0) into boleto_cents
  from public.iugu_invoices
  where payment_method = 'iugu_bank_slip'
    and due_date >= start_ts::date and due_date < end_ts::date
    and coalesce(status,'') not in ('canceled','expired','pending')
    and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%');

  -- pix/cartão por caixa
  select coalesce(sum(paid_cents),0) into pix_cc_cents
  from public.iugu_invoices
  where payment_method in ('iugu_pix','iugu_credit_card')
    and (paid_at at time zone 'America/Sao_Paulo') >= (start_ts at time zone 'America/Sao_Paulo')
    and (paid_at at time zone 'America/Sao_Paulo') <  (end_ts   at time zone 'America/Sao_Paulo')
    and coalesce(status,'') in ('paid','partially_paid')
    and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%');

  return query
    select (boleto_cents + pix_cc_cents) as total_cents,
           jsonb_build_object(
             'boleto_competencia_cents', boleto_cents,
             'pix_cartao_caixa_cents', pix_cc_cents
           ) as details;
end$$;

grant select on public.kpi_due_competency_valid to service_role;
grant execute on function public.get_monthly_revenue_hybrid(date) to service_role;

commit;


