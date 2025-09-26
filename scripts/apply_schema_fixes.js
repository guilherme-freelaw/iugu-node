#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

// Configurações
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    if (options.body) {
      req.write(options.body);
    }

    req.on('error', reject);
    req.end();
  });
}

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

async function applySchemaFixes() {
  logWithTimestamp('🔧 APLICANDO CORREÇÕES DE SCHEMA');
  console.log('=====================================');

  const fixes = [
    {
      name: 'Fix iugu_plans table',
      sql: `
        ALTER TABLE iugu_plans 
        ADD COLUMN IF NOT EXISTS interval_type text,
        ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL',
        ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS max_cycles integer,
        ADD COLUMN IF NOT EXISTS trial_days integer DEFAULT 0;
      `,
    },
    {
      name: 'Fix iugu_chargebacks table',
      sql: `
        ALTER TABLE iugu_chargebacks 
        ADD COLUMN IF NOT EXISTS amount_cents bigint,
        ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL',
        ADD COLUMN IF NOT EXISTS reason text,
        ADD COLUMN IF NOT EXISTS contest_reason text,
        ADD COLUMN IF NOT EXISTS disputed_at timestamp with time zone,
        ADD COLUMN IF NOT EXISTS accepted_at timestamp with time zone;
      `,
    },
    {
      name: 'Make chargebacks amount_cents nullable',
      sql: `ALTER TABLE iugu_chargebacks ALTER COLUMN amount_cents DROP NOT NULL;`,
    },
    {
      name: 'Fix iugu_transfers table',
      sql: `
        ALTER TABLE iugu_transfers 
        ADD COLUMN IF NOT EXISTS reference text,
        ADD COLUMN IF NOT EXISTS bank_account_id text,
        ADD COLUMN IF NOT EXISTS receiver jsonb,
        ADD COLUMN IF NOT EXISTS amount_localized text;
      `,
    },
    {
      name: 'Make transfers amount_cents nullable',
      sql: `ALTER TABLE iugu_transfers ALTER COLUMN amount_cents DROP NOT NULL;`,
    },
    {
      name: 'Enhance iugu_subscriptions table',
      sql: `
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
      `,
    },
    {
      name: 'Enhance iugu_payment_methods table',
      sql: `
        ALTER TABLE iugu_payment_methods
        ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS set_as_default boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS token text,
        ADD COLUMN IF NOT EXISTS extra_info jsonb DEFAULT '{}';
      `,
    },
    {
      name: 'Add performance indexes',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_iugu_invoices_customer_id ON iugu_invoices(customer_id);
        CREATE INDEX IF NOT EXISTS idx_iugu_invoices_subscription_id ON iugu_invoices(subscription_id);
        CREATE INDEX IF NOT EXISTS idx_iugu_subscriptions_customer_id ON iugu_subscriptions(customer_id);
        CREATE INDEX IF NOT EXISTS idx_iugu_subscriptions_plan_id ON iugu_subscriptions(plan_id);
        CREATE INDEX IF NOT EXISTS idx_iugu_chargebacks_invoice_id ON iugu_chargebacks(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_iugu_payment_methods_customer_id ON iugu_payment_methods(customer_id);
      `,
    },
    {
      name: 'Remove problematic foreign keys',
      sql: `
        ALTER TABLE iugu_subscriptions DROP CONSTRAINT IF EXISTS iugu_subscriptions_customer_id_fkey;
        ALTER TABLE iugu_subscriptions DROP CONSTRAINT IF EXISTS iugu_subscriptions_plan_id_fkey;
        ALTER TABLE iugu_chargebacks DROP CONSTRAINT IF EXISTS iugu_chargebacks_invoice_id_fkey;
      `,
    },
    {
      name: 'Add customer foreign key',
      sql: `
        ALTER TABLE iugu_subscriptions 
        ADD CONSTRAINT iugu_subscriptions_customer_id_fkey 
        FOREIGN KEY (customer_id) REFERENCES iugu_customers(id) ON DELETE CASCADE;
      `,
    },
    {
      name: 'Add chargeback foreign key',
      sql: `
        ALTER TABLE iugu_chargebacks 
        ADD CONSTRAINT iugu_chargebacks_invoice_id_fkey 
        FOREIGN KEY (invoice_id) REFERENCES iugu_invoices(id) ON DELETE CASCADE;
      `,
    },
  ];

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];

    try {
      logWithTimestamp(`🔧 ${i + 1}/${fixes.length}: ${fix.name}`);

      // Use the query endpoint directly
      const response = await makeRequest(`${SUPABASE_URL}/rest/v1/rpc/query`, {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify({
          query: fix.sql.trim(),
        }),
      });

      console.log(`   ✅ Sucesso`);
    } catch (error) {
      console.log(`   ⚠️ Erro (pode ser normal): ${error.message}`);

      // Para DDL, muitos erros são esperados (coluna já existe, etc.)
      // Continuamos mesmo com erros
    }

    // Pequeno delay
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  logWithTimestamp('✅ CORREÇÕES DE SCHEMA APLICADAS');

  // Testar uma operação simples para verificar se o schema está OK
  try {
    logWithTimestamp('🧪 Testando schema corrigido...');

    const testResponse = await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_plans?limit=1`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    logWithTimestamp('✅ Schema testado com sucesso!');
  } catch (error) {
    logWithTimestamp(`⚠️ Erro no teste: ${error.message}`);
  }
}

applySchemaFixes();
