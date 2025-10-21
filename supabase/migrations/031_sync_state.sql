begin;
create table if not exists public.sync_state (
  resource text primary key,
  last_cursor timestamptz,
  updated_at timestamptz default now()
);
commit;
