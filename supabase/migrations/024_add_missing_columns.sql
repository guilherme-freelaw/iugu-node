-- Migration: Add missing columns to all tables for complete synchronization
-- Date: 2025-09-15
-- Description: Adds all missing columns identified for proper Iugu data synchronization

-- Add missing columns to iugu_invoices
ALTER TABLE public.iugu_invoices
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL',
ADD COLUMN IF NOT EXISTS payer_cpf TEXT,
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add missing columns to iugu_customers  
ALTER TABLE public.iugu_customers
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS number TEXT,
ADD COLUMN IF NOT EXISTS district TEXT,
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add missing columns to iugu_subscriptions
ALTER TABLE public.iugu_subscriptions
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS credits_based BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS credits_cycle INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS credits_min INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly';

-- Add missing columns to iugu_plans
ALTER TABLE public.iugu_plans
ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS interval_type TEXT DEFAULT 'months',
ADD COLUMN IF NOT EXISTS payable_with TEXT[] DEFAULT ARRAY['credit_card'],
ADD COLUMN IF NOT EXISTS max_cycles INTEGER;

-- Add missing columns to iugu_payment_methods
ALTER TABLE public.iugu_payment_methods
ADD COLUMN IF NOT EXISTS token TEXT,
ADD COLUMN IF NOT EXISTS display_number TEXT,
ADD COLUMN IF NOT EXISTS bin TEXT,
ADD COLUMN IF NOT EXISTS last_four_digits TEXT,
ADD COLUMN IF NOT EXISTS first_six_digits TEXT,
ADD COLUMN IF NOT EXISTS gateway TEXT,
ADD COLUMN IF NOT EXISTS gateway_id TEXT,
ADD COLUMN IF NOT EXISTS image TEXT,
ADD COLUMN IF NOT EXISTS test_card BOOLEAN DEFAULT false;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_iugu_invoices_currency ON public.iugu_invoices (currency);
CREATE INDEX IF NOT EXISTS idx_iugu_invoices_payment_method ON public.iugu_invoices (payment_method);
CREATE INDEX IF NOT EXISTS idx_iugu_subscriptions_active ON public.iugu_subscriptions (active);
CREATE INDEX IF NOT EXISTS idx_iugu_subscriptions_billing_cycle ON public.iugu_subscriptions (billing_cycle);
CREATE INDEX IF NOT EXISTS idx_iugu_plans_interval_type ON public.iugu_plans (interval_type);
CREATE INDEX IF NOT EXISTS idx_iugu_payment_methods_token ON public.iugu_payment_methods (token);

-- Update comments
COMMENT ON COLUMN public.iugu_invoices.currency IS 'Invoice currency (usually BRL)';
COMMENT ON COLUMN public.iugu_invoices.payer_cpf IS 'Payer CPF/CNPJ';
COMMENT ON COLUMN public.iugu_invoices.description IS 'Invoice description/notes';

COMMENT ON COLUMN public.iugu_customers.address IS 'Customer street address';
COMMENT ON COLUMN public.iugu_customers.number IS 'Address number';
COMMENT ON COLUMN public.iugu_customers.district IS 'Address district/neighborhood';
COMMENT ON COLUMN public.iugu_customers.city IS 'Customer city';
COMMENT ON COLUMN public.iugu_customers.state IS 'Customer state';
COMMENT ON COLUMN public.iugu_customers.country IS 'Customer country';
COMMENT ON COLUMN public.iugu_customers.notes IS 'Customer notes';

COMMENT ON COLUMN public.iugu_subscriptions.active IS 'Whether subscription is active';
COMMENT ON COLUMN public.iugu_subscriptions.credits_based IS 'Whether subscription is credits-based';
COMMENT ON COLUMN public.iugu_subscriptions.credits_cycle IS 'Credits per cycle';
COMMENT ON COLUMN public.iugu_subscriptions.credits_min IS 'Minimum credits required';
COMMENT ON COLUMN public.iugu_subscriptions.billing_cycle IS 'Billing cycle (monthly, yearly, etc.)';

COMMENT ON COLUMN public.iugu_plans.features IS 'Plan features as JSON array';
COMMENT ON COLUMN public.iugu_plans.interval_type IS 'Plan interval type (months, days, etc.)';
COMMENT ON COLUMN public.iugu_plans.payable_with IS 'Allowed payment methods';
COMMENT ON COLUMN public.iugu_plans.max_cycles IS 'Maximum billing cycles (null = unlimited)';

COMMENT ON COLUMN public.iugu_payment_methods.token IS 'Payment method token';
COMMENT ON COLUMN public.iugu_payment_methods.display_number IS 'Masked card number for display';
COMMENT ON COLUMN public.iugu_payment_methods.bin IS 'Card BIN (first 6 digits)';
COMMENT ON COLUMN public.iugu_payment_methods.last_four_digits IS 'Last 4 digits of card';
COMMENT ON COLUMN public.iugu_payment_methods.first_six_digits IS 'First 6 digits of card';
COMMENT ON COLUMN public.iugu_payment_methods.gateway IS 'Payment gateway used';
COMMENT ON COLUMN public.iugu_payment_methods.gateway_id IS 'Gateway-specific ID';
COMMENT ON COLUMN public.iugu_payment_methods.image IS 'Card brand image URL';
COMMENT ON COLUMN public.iugu_payment_methods.test_card IS 'Whether this is a test card';
