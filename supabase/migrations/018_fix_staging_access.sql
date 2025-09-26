-- Migration: 018_fix_staging_access.sql
-- Purpose: ensure staging schema is accessible via PostgREST

begin;

-- Grant usage on staging schema to service_role and anon
grant usage on schema staging to service_role, anon;

-- Grant all permissions on staging tables to service_role
grant all on all tables in schema staging to service_role;

-- Grant select permissions on staging tables to anon (for reading)
grant select on all tables in schema staging to anon;

-- Ensure PostgREST can see staging schema
alter default privileges in schema staging grant all on tables to service_role;
alter default privileges in schema staging grant select on tables to anon;

-- Grant sequences too
grant all on all sequences in schema staging to service_role;
grant usage on all sequences in schema staging to anon;
alter default privileges in schema staging grant all on sequences to service_role;
alter default privileges in schema staging grant usage on sequences to anon;

commit;
