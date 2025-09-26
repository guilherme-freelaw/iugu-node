-- Migration: 010_backfill_notify_index.sql
-- Purpose: add index to staging.iugu_batches.page for efficient selection

begin;

create index if not exists idx_staging_iugu_batches_page on staging.iugu_batches (page);

commit;


