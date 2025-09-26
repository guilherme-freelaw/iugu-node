-- Helper RPCs for investigation (single-value SQL and JSON list). Use with care.
begin;

create or replace function public.run_sql_single_value(sql_text text)
returns table (value numeric)
language plpgsql security definer as $$
begin
  return query execute sql_text;
end;$$;

grant execute on function public.run_sql_single_value(text) to service_role;

commit;


