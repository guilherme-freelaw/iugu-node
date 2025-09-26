-- Migration: 011_grant_staging_permissions.sql
-- Purpose: grant service_role permissions to staging schema and tables

begin;

-- Grant usage on staging schema to service_role
grant usage on schema staging to service_role;

-- Grant all permissions on existing tables in staging to service_role
grant all on all tables in schema staging to service_role;

-- Grant all permissions on sequences in staging to service_role
grant all on all sequences in schema staging to service_role;

-- Set default privileges for future tables in staging
alter default privileges in schema staging grant all on tables to service_role;
alter default privileges in schema staging grant all on sequences to service_role;

commit;
