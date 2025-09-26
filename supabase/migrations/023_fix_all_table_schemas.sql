-- Migration: Fix all table schemas to match Iugu API data structure
-- This ensures all entities can be properly connected with foreign keys

-- 1. Fix iugu_plans table (add missing columns)
ALTER TABLE iugu_plans 
ADD COLUMN IF NOT EXISTS interval_type text,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL',
ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS max_cycles integer,
ADD COLUMN IF NOT EXISTS trial_days integer DEFAULT 0;

-- 2. Fix iugu_chargebacks table (add missing columns)
ALTER TABLE iugu_chargebacks 
ADD COLUMN IF NOT EXISTS amount_cents bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL',
ADD COLUMN IF NOT EXISTS reason text,
ADD COLUMN IF NOT EXISTS contest_reason text,
ADD COLUMN IF NOT EXISTS disputed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS accepted_at timestamp with time zone;

-- Make amount_cents nullable temporarily for existing data
ALTER TABLE iugu_chargebacks ALTER COLUMN amount_cents DROP NOT NULL;

-- 3. Fix iugu_transfers table (add missing columns and fix structure)
ALTER TABLE iugu_transfers 
ADD COLUMN IF NOT EXISTS reference text,
ADD COLUMN IF NOT EXISTS bank_account_id text,
ADD COLUMN IF NOT EXISTS receiver jsonb,
ADD COLUMN IF NOT EXISTS amount_localized text;

-- Make amount_cents nullable temporarily for existing data  
ALTER TABLE iugu_transfers ALTER COLUMN amount_cents DROP NOT NULL;

-- 4. Enhance iugu_subscriptions table
ALTER TABLE iugu_subscriptions
ADD COLUMN IF NOT EXISTS price_cents bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL',
ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS credits_based boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS credits_cycle_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS credits_min integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS customer_name text,
ADD COLUMN IF NOT EXISTS customer_email text,
ADD COLUMN IF NOT EXISTS plan_name text,
ADD COLUMN IF NOT EXISTS billing_address jsonb,
ADD COLUMN IF NOT EXISTS payment_method_id text;

-- 5. Enhance iugu_payment_methods table
ALTER TABLE iugu_payment_methods
ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS set_as_default boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS token text,
ADD COLUMN IF NOT EXISTS extra_info jsonb DEFAULT '{}';

-- 6. Add indexes for better performance on foreign key relationships
CREATE INDEX IF NOT EXISTS idx_iugu_invoices_customer_id ON iugu_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_iugu_invoices_subscription_id ON iugu_invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_iugu_subscriptions_customer_id ON iugu_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_iugu_subscriptions_plan_id ON iugu_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_iugu_chargebacks_invoice_id ON iugu_chargebacks(invoice_id);
CREATE INDEX IF NOT EXISTS idx_iugu_payment_methods_customer_id ON iugu_payment_methods(customer_id);

-- 7. Update foreign key constraints to ensure referential integrity
-- Remove existing foreign key constraints that might be problematic
ALTER TABLE iugu_subscriptions DROP CONSTRAINT IF EXISTS iugu_subscriptions_customer_id_fkey;
ALTER TABLE iugu_subscriptions DROP CONSTRAINT IF EXISTS iugu_subscriptions_plan_id_fkey;
ALTER TABLE iugu_chargebacks DROP CONSTRAINT IF EXISTS iugu_chargebacks_invoice_id_fkey;

-- Add proper foreign key constraints with ON DELETE CASCADE for data integrity
ALTER TABLE iugu_subscriptions 
ADD CONSTRAINT iugu_subscriptions_customer_id_fkey 
FOREIGN KEY (customer_id) REFERENCES iugu_customers(id) ON DELETE CASCADE;

-- For plan_id, we'll use a different approach since plan_id might be identifier string
-- We'll add this constraint after we populate the plans

ALTER TABLE iugu_chargebacks 
ADD CONSTRAINT iugu_chargebacks_invoice_id_fkey 
FOREIGN KEY (invoice_id) REFERENCES iugu_invoices(id) ON DELETE CASCADE;

-- 8. Create a function to safely add plan foreign key after plans are populated
CREATE OR REPLACE FUNCTION add_plan_foreign_key()
RETURNS void AS $$
BEGIN
    -- Only add the foreign key if we have plans in the table
    IF (SELECT COUNT(*) FROM iugu_plans) > 0 THEN
        ALTER TABLE iugu_subscriptions 
        ADD CONSTRAINT iugu_subscriptions_plan_id_fkey 
        FOREIGN KEY (plan_id) REFERENCES iugu_plans(identifier) ON DELETE SET NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 9. Add comments for documentation
COMMENT ON TABLE iugu_plans IS 'Iugu subscription plans with billing intervals and pricing';
COMMENT ON TABLE iugu_subscriptions IS 'Active and inactive subscriptions linked to customers and plans';
COMMENT ON TABLE iugu_chargebacks IS 'Chargeback disputes linked to invoices';
COMMENT ON TABLE iugu_transfers IS 'Financial transfers and withdrawal requests';
COMMENT ON TABLE iugu_payment_methods IS 'Customer payment methods (cards, bank accounts, etc.)';

-- 10. Create a view for connected data relationships
CREATE OR REPLACE VIEW iugu_subscription_details AS
SELECT 
    s.id as subscription_id,
    s.customer_id,
    c.name as customer_name,
    c.email as customer_email,
    s.plan_id,
    p.name as plan_name,
    p.value_cents as plan_value_cents,
    p.interval,
    p.interval_type,
    s.suspended,
    s.created_at_iugu as subscription_created_at,
    s.expires_at
FROM iugu_subscriptions s
LEFT JOIN iugu_customers c ON s.customer_id = c.id
LEFT JOIN iugu_plans p ON s.plan_id = p.identifier;

COMMENT ON VIEW iugu_subscription_details IS 'Unified view of subscriptions with customer and plan details';

-- Grant permissions
GRANT SELECT ON iugu_subscription_details TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
