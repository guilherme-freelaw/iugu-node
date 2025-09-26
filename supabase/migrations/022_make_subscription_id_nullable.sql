-- Migration: 022_make_subscription_id_nullable.sql
-- Purpose: allow invoices without subscription_id to be inserted

begin;

-- Make subscription_id nullable and remove the foreign key constraint temporarily
alter table public.iugu_invoices 
alter column subscription_id drop not null;

-- Drop the foreign key constraint to allow invoices without existing subscriptions
alter table public.iugu_invoices 
drop constraint if exists iugu_invoices_subscription_id_fkey;

-- We'll recreate this constraint later after we populate subscriptions
-- For now, just add a note in the comments
comment on column public.iugu_invoices.subscription_id is 'References iugu_subscriptions.id when available. Foreign key constraint removed temporarily to allow invoice imports.';

commit;
