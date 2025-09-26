-- Migration: 009_backfill_staging_and_rpc.sql
-- Purpose: create staging batch table, checkpoint and RPCs for inserting and processing batches

begin;

create schema if not exists staging;

create table if not exists staging.iugu_batches (
  id serial primary key,
  page int,
  payload jsonb not null,
  status text default 'pending',
  created_at timestamptz default now(),
  processed_at timestamptz
);

create table if not exists staging.backfill_checkpoints (
  id serial primary key,
  last_page int default 0,
  updated_at timestamptz default now()
);

-- ensure a single checkpoint row exists
insert into staging.backfill_checkpoints (last_page, updated_at)
select 0, now()
where not exists (select 1 from staging.backfill_checkpoints);

-- RPC to insert a batch page into staging
create or replace function public.insert_iugu_batch(p_page int, p_payload jsonb)
returns int language plpgsql as $$
declare v_id int;
begin
  insert into staging.iugu_batches (page, payload) values (p_page, p_payload) returning id into v_id;
  update staging.backfill_checkpoints set last_page = greatest(coalesce(last_page,0), p_page), updated_at = now() where id = (select id from staging.backfill_checkpoints limit 1);
  return v_id;
end;
$$;

-- RPC to process next pending batch (idempotent per batch)
create or replace function public.process_next_iugu_batch()
returns int language plpgsql as $$
declare b record; inv jsonb;
begin
  select id, page, payload into b from staging.iugu_batches where status = 'pending' order by page limit 1 for update skip locked;
  if not found then
    return 0;
  end if;

  update staging.iugu_batches set status = 'processing', processed_at = null where id = b.id;

  for inv in select * from jsonb_array_elements(b.payload) loop
    begin
      perform public.upsert_invoice_from_payload(inv);
    exception when others then
      -- log and continue
      raise notice 'upsert_invoice error: %', sqlerrm;
    end;
  end loop;

  update staging.iugu_batches set status = 'done', processed_at = now() where id = b.id;
  return b.id;
end;
$$;

commit;


