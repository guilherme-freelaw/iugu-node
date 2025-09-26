-- Migration: 025_dashboard_metrics.sql
-- Purpose: store account balance snapshots and expose KPI views/RPCs

begin;

-- 1) Balance snapshots to compute "Saldo disponível para saque" e "Saldo a receber"
create table if not exists public.iugu_account_balances (
  id              bigserial primary key,
  account_id      text,
  available_cents bigint not null default 0,
  receivable_cents bigint not null default 0,
  blocked_cents   bigint not null default 0,
  in_transit_cents bigint not null default 0,
  currency        text default 'BRL',
  captured_at     timestamptz not null default now()
);
create index if not exists idx_iugu_account_balances_account_time on public.iugu_account_balances (account_id, captured_at desc);

comment on table public.iugu_account_balances is 'Periodic snapshots of Iugu account balances for dashboard metrics';

-- 2) KPI view: daily volume (sum of paid invoices)
create or replace view public.kpi_daily_volume as
select
  date_trunc('day', (paid_at at time zone 'America/Sao_Paulo'))::date as day,
  sum(coalesce(paid_cents, 0)) as volume_cents,
  count(*) as total_invoices
from public.iugu_invoices
where status in ('paid','partially_paid')
  and paid_at is not null
  and status is not null
  and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%')
group by 1
order by 1;

comment on view public.kpi_daily_volume is 'Daily paid invoice volume and counts';

-- 3) KPI view: total subscribers (active subscriptions)
create or replace view public.kpi_total_subscribers as
select count(*)::bigint as total_subscribers
from public.iugu_subscriptions s
where coalesce(s.status, '') in ('active')
   or (s.expires_at is null or s.expires_at >= current_date);

-- 4) RPCs to expose dashboard aggregates quickly

-- a) current balances (latest snapshot)
create or replace function public.get_current_balances()
returns table (
  account_id text,
  available_cents bigint,
  receivable_cents bigint,
  blocked_cents bigint,
  in_transit_cents bigint,
  currency text,
  captured_at timestamptz
) language sql stable as $$
  select distinct on (account_id)
    account_id,
    available_cents,
    receivable_cents,
    blocked_cents,
    in_transit_cents,
    currency,
    captured_at
  from public.iugu_account_balances
  order by account_id, captured_at desc;
$$;

-- b) monthly received this month
create or replace function public.get_monthly_received(month_date date default date_trunc('month', now())::date)
returns table (
  total_cents numeric
) language sql stable as $$
  select coalesce(sum(paid_cents), 0)::numeric as total_cents
  from public.iugu_invoices
  where status in ('paid','partially_paid')
    and (paid_at at time zone 'America/Sao_Paulo') >= date_trunc('month', (month_date::timestamptz at time zone 'America/Sao_Paulo'))
    and (paid_at at time zone 'America/Sao_Paulo') < (date_trunc('month', (month_date::timestamptz at time zone 'America/Sao_Paulo')) + interval '1 month')
    and status is not null
    and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%');
$$;

-- c) monthly received previous month
create or replace function public.get_previous_month_received(ref_date date default now()::date)
returns table (
  total_cents numeric
) language sql stable as $$
  with bounds as (
    select date_trunc('month', ref_date) - interval '1 month' as start_dt,
           date_trunc('month', ref_date)                        as end_dt
  )
  select coalesce(sum(paid_cents), 0)::numeric as total_cents
  from public.iugu_invoices i
  cross join bounds b
  where i.status in ('paid','partially_paid')
    and (i.paid_at at time zone 'America/Sao_Paulo') >= (b.start_dt at time zone 'America/Sao_Paulo')
    and (i.paid_at at time zone 'America/Sao_Paulo') <  (b.end_dt   at time zone 'America/Sao_Paulo')
    and i.status is not null
    and not (i.id = 'test_inv' or i.id ilike 'test_%' or i.id ilike '%teste%');
$$;

-- d) pending fees (example placeholder: taxes_cents not yet charged)
create or replace function public.get_pending_fees()
returns table (
  total_cents numeric
) language sql stable as $$
  select coalesce(sum(taxes_cents), 0)::numeric from public.iugu_invoices where status in ('pending', 'partially_paid');
$$;

-- f) refunds no mês (negativo, por paid_at)
create or replace function public.get_monthly_refunds(month_date date default date_trunc('month', now())::date)
returns table (
  refunds_cents numeric
) language sql stable as $$
  select -coalesce(sum(total_cents),0)::numeric as refunds_cents
  from public.iugu_invoices
  where status = 'refunded'
    and paid_at >= date_trunc('month', month_date)
    and paid_at < (date_trunc('month', month_date) + interval '1 month')
    and status is not null
    and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%');
$$;

-- 5) Views diárias adicionais
-- a) Chargebacks por dia (valor disputado)
create or replace view public.kpi_daily_chargebacks as
select
  date_trunc('day', coalesce(disputed_at, created_at_iugu, now()))::date as day,
  sum(coalesce(amount_cents,0)) as amount_cents,
  count(*) as total
from public.iugu_chargebacks
group by 1
order by 1;

comment on view public.kpi_daily_chargebacks is 'Daily chargebacks using disputed_at or created_at_iugu';

-- b) Saldo em trânsito por dia (último snapshot do dia por conta)
create or replace view public.kpi_daily_in_transit_balance as
with ranked as (
  select
    account_id,
    captured_at::date as day,
    in_transit_cents,
    row_number() over (partition by account_id, captured_at::date order by captured_at desc) as rn
  from public.iugu_account_balances
)
select day, sum(in_transit_cents) as in_transit_cents
from ranked
where rn = 1
group by day
order by day;

-- e) total balance (sum of latest available + receivable)
create or replace view public.kpi_total_balance as
select
  sum(available_cents + receivable_cents)::bigint as total_cents
from public.get_current_balances();

grant select on public.kpi_daily_volume to service_role;
grant select on public.kpi_total_subscribers to service_role;
grant select on public.kpi_total_balance to service_role;
grant select on public.kpi_daily_chargebacks to service_role;
grant select on public.kpi_daily_in_transit_balance to service_role;
grant execute on function public.get_current_balances() to service_role;
grant execute on function public.get_monthly_received(date) to service_role;
grant execute on function public.get_previous_month_received(date) to service_role;
grant execute on function public.get_pending_fees() to service_role;
grant execute on function public.get_monthly_refunds(date) to service_role;

commit;


