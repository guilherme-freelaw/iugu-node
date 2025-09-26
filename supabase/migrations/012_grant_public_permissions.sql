-- Migration: 012_grant_public_permissions.sql
-- Purpose: grant service_role permissions to public schema tables for PostgREST access

begin;

-- Grant usage on public schema to service_role (should already exist but ensuring)
grant usage on schema public to service_role;

-- Grant all permissions on existing tables in public to service_role
grant all on all tables in schema public to service_role;

-- Grant all permissions on sequences in public to service_role
grant all on all sequences in schema public to service_role;

-- Set default privileges for future tables in public
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Also grant to anon for read access (optional, for future API access)
grant select on all tables in schema public to anon;
alter default privileges in schema public grant select on tables to anon;

commit;
