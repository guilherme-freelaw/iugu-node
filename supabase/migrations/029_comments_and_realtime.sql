-- Migration: 029_comments_and_realtime.sql
-- Purpose: add table/column descriptions and enable Realtime publication for core entities

begin;

-- =============================
-- TABLE AND COLUMN DESCRIPTIONS
-- =============================

-- Customers
comment on table public.iugu_customers is 'Iugu customers (clients/consumers). Primary entity linked to invoices, subscriptions and payment methods.';
comment on column public.iugu_customers.id               is 'Customer ID from Iugu';
comment on column public.iugu_customers.email            is 'Customer primary email';
comment on column public.iugu_customers.name             is 'Customer full name or business name';
comment on column public.iugu_customers.cpf_cnpj         is 'CPF/CNPJ document number (as sent by Iugu)';
comment on column public.iugu_customers.phone            is 'Customer phone number';
comment on column public.iugu_customers.custom_variables is 'Free-form key/value attributes from Iugu';
comment on column public.iugu_customers.created_at_iugu  is 'Timestamp when the customer was created in Iugu';
comment on column public.iugu_customers.updated_at_iugu  is 'Timestamp when the customer was last updated in Iugu';
comment on column public.iugu_customers.raw_json         is 'Raw payload as received from Iugu API/webhooks';
comment on column public.iugu_customers.created_at       is 'Row creation time in this database';
comment on column public.iugu_customers.updated_at       is 'Row update time in this database';

-- Plans
comment on table public.iugu_plans is 'Iugu subscription plans, including pricing and billing intervals.';
comment on column public.iugu_plans.id              is 'Plan unique ID in Iugu';
comment on column public.iugu_plans.identifier      is 'Human-friendly identifier used by Iugu';
comment on column public.iugu_plans.name            is 'Plan display name';
comment on column public.iugu_plans.interval        is 'Interval unit (e.g., months)';
comment on column public.iugu_plans.interval_count  is 'How many units per interval (e.g., 1 = monthly)';
comment on column public.iugu_plans.value_cents     is 'Plan price in cents';
comment on column public.iugu_plans.currency        is 'Currency code (default BRL)';
comment on column public.iugu_plans.created_at_iugu is 'Created timestamp in Iugu';
comment on column public.iugu_plans.updated_at_iugu is 'Updated timestamp in Iugu';
comment on column public.iugu_plans.raw_json        is 'Raw Iugu plan payload';

-- Subscriptions
comment on table public.iugu_subscriptions is 'Subscriptions connecting customers to plans, with lifecycle status and pricing.';
comment on column public.iugu_subscriptions.id               is 'Subscription ID in Iugu';
comment on column public.iugu_subscriptions.customer_id      is 'FK to iugu_customers.id';
comment on column public.iugu_subscriptions.plan_id          is 'FK to iugu_plans.id or plan identifier';
comment on column public.iugu_subscriptions.plan_identifier  is 'Plan identifier string (duplicated from Iugu)';
comment on column public.iugu_subscriptions.plan_name        is 'Plan name at subscription time';
comment on column public.iugu_subscriptions.status           is 'Subscription status (active, suspended, expired, etc.)';
comment on column public.iugu_subscriptions.suspended        is 'Whether the subscription is suspended';
comment on column public.iugu_subscriptions.credits          is 'Remaining credits if credits-based';
comment on column public.iugu_subscriptions.price_cents      is 'Recurring price in cents';
comment on column public.iugu_subscriptions.currency         is 'Currency code';
comment on column public.iugu_subscriptions.renews_at        is 'Next renewal date';
comment on column public.iugu_subscriptions.expires_at       is 'Expiration date if applicable';
comment on column public.iugu_subscriptions.created_at_iugu  is 'Created timestamp in Iugu';
comment on column public.iugu_subscriptions.updated_at_iugu  is 'Updated timestamp in Iugu';
comment on column public.iugu_subscriptions.raw_json         is 'Raw Iugu subscription payload';

-- Payment Methods
comment on table public.iugu_payment_methods is 'Customer payment methods (cards, pix, bank slip helpers).';
comment on column public.iugu_payment_methods.id          is 'Payment method ID in Iugu';
comment on column public.iugu_payment_methods.customer_id is 'FK to iugu_customers.id';
comment on column public.iugu_payment_methods.description is 'Human readable description';
comment on column public.iugu_payment_methods.brand       is 'Card brand or method family';
comment on column public.iugu_payment_methods.holder_name is 'Card holder name';
comment on column public.iugu_payment_methods.last4       is 'Last 4 digits for display';
comment on column public.iugu_payment_methods.is_default  is 'Whether this is the default method';
comment on column public.iugu_payment_methods.raw_json    is 'Raw Iugu payment method payload';
comment on column public.iugu_payment_methods.created_at  is 'Row creation time in this DB';

-- Invoices
comment on table public.iugu_invoices is 'Invoices issued by Iugu, with values, status and payment metadata.';
comment on column public.iugu_invoices.id                 is 'Invoice ID in Iugu';
comment on column public.iugu_invoices.account_id         is 'Account/Subaccount that owns the invoice';
comment on column public.iugu_invoices.customer_id        is 'FK to iugu_customers.id';
comment on column public.iugu_invoices.subscription_id    is 'FK to iugu_subscriptions.id';
comment on column public.iugu_invoices.status             is 'Invoice status (pending, paid, refunded, etc.)';
comment on column public.iugu_invoices.due_date           is 'Due date';
comment on column public.iugu_invoices.paid_at            is 'Payment timestamp';
comment on column public.iugu_invoices.payment_method     is 'Payment method label';
comment on column public.iugu_invoices.pix_end_to_end_id  is 'PIX E2E identifier if applicable';
comment on column public.iugu_invoices.installments       is 'Number of installments if credit card';
comment on column public.iugu_invoices.secure_url         is 'Secure payment URL';
comment on column public.iugu_invoices.bank_slip_url      is 'Bank slip URL';
comment on column public.iugu_invoices.pdf_url            is 'Invoice PDF URL';
comment on column public.iugu_invoices.total_cents        is 'Total amount in cents';
comment on column public.iugu_invoices.paid_cents         is 'Paid amount in cents';
comment on column public.iugu_invoices.discount_cents     is 'Discount amount in cents';
comment on column public.iugu_invoices.taxes_cents        is 'Taxes amount in cents';
comment on column public.iugu_invoices.external_reference is 'External reference for reconciliation';
comment on column public.iugu_invoices.order_id           is 'Order ID related to the invoice';
comment on column public.iugu_invoices.created_at_iugu    is 'Created timestamp in Iugu';
comment on column public.iugu_invoices.updated_at_iugu    is 'Updated timestamp in Iugu';
comment on column public.iugu_invoices.raw_json           is 'Raw Iugu invoice payload';

-- Invoice Items
comment on table public.iugu_invoice_items is 'Items that compose an invoice (descriptions, quantities and prices).';
comment on column public.iugu_invoice_items.id          is 'Surrogate key';
comment on column public.iugu_invoice_items.invoice_id  is 'FK to iugu_invoices.id';
comment on column public.iugu_invoice_items.description is 'Item description (product/service)';
comment on column public.iugu_invoice_items.quantity    is 'Item quantity';
comment on column public.iugu_invoice_items.price_cents is 'Unit price in cents';
comment on column public.iugu_invoice_items.raw_json    is 'Raw Iugu item payload';

-- Webhook Events Queue
comment on table public.iugu_webhook_events is 'Inbound Iugu webhook events, queued for processing by background worker.';
comment on column public.iugu_webhook_events.id             is 'Surrogate key';
comment on column public.iugu_webhook_events.event_name     is 'Event type/name from Iugu';
comment on column public.iugu_webhook_events.entity_id      is 'Primary entity id referenced by the event';
comment on column public.iugu_webhook_events.payload        is 'Raw payload as JSONB';
comment on column public.iugu_webhook_events.received_at    is 'When the event was received';
comment on column public.iugu_webhook_events.dedupe_key     is 'Unique key to prevent processing duplicates';
comment on column public.iugu_webhook_events.processed_at   is 'When processing finished';
comment on column public.iugu_webhook_events.process_status is 'Processing status: pending, processing, done, error';
comment on column public.iugu_webhook_events.process_error  is 'Error details if any';

-- Staging raw imports
comment on schema staging is 'Raw import area used for CSV/API payloads before normalization.';
comment on table staging.iugu_subscriptions_export_raw is 'Raw subscriptions export payloads (CSV/JSON), pre-processing.';
comment on column staging.iugu_subscriptions_export_raw.source_file is 'Original source path or filename';
comment on column staging.iugu_subscriptions_export_raw.payload     is 'Raw JSON payload';
comment on column staging.iugu_subscriptions_export_raw.ingested_at is 'Ingestion timestamp';

comment on table staging.iugu_customers_export_raw is 'Raw customers export payloads (CSV/JSON), pre-processing.';
comment on column staging.iugu_customers_export_raw.source_file is 'Original source path or filename';
comment on column staging.iugu_customers_export_raw.payload     is 'Raw JSON payload';
comment on column staging.iugu_customers_export_raw.ingested_at is 'Ingestion timestamp';

-- =============================
-- REALTIME PUBLICATION SETUP
-- =============================

-- Ensure replica identity for UPDATE/DELETE payloads to include old row keys
alter table if exists public.iugu_customers replica identity full;
alter table if exists public.iugu_plans replica identity full;
alter table if exists public.iugu_subscriptions replica identity full;
alter table if exists public.iugu_payment_methods replica identity full;
alter table if exists public.iugu_invoices replica identity full;
alter table if exists public.iugu_invoice_items replica identity full;
alter table if exists public.iugu_webhook_events replica identity full;
alter table if exists public.iugu_transfers replica identity full;
alter table if exists public.iugu_charges replica identity full;
alter table if exists public.iugu_accounts replica identity full;
alter table if exists public.iugu_chargebacks replica identity full;
alter table if exists public.iugu_account_balances replica identity full;

-- Create publication if not exists and add tables used by the application
create publication if not exists supabase_realtime;
alter publication supabase_realtime add table if not exists
  public.iugu_customers,
  public.iugu_plans,
  public.iugu_subscriptions,
  public.iugu_payment_methods,
  public.iugu_invoices,
  public.iugu_invoice_items,
  public.iugu_webhook_events,
  public.iugu_transfers,
  public.iugu_charges,
  public.iugu_accounts,
  public.iugu_chargebacks,
  public.iugu_account_balances;

commit;


