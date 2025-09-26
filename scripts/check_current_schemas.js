#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function logWithTimestamp(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

async function makeSupabaseRequest(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

async function getTableSchema(tableName) {
  try {
    logWithTimestamp(`🔍 Verificando schema da tabela ${tableName}...`);

    // Tentar fazer uma query limitada para ver os campos disponíveis
    const result = await makeSupabaseRequest(`${tableName}?limit=1`);

    if (result && result.length > 0) {
      const columns = Object.keys(result[0]);
      logWithTimestamp(`   ✅ Colunas encontradas: ${columns.join(', ')}`);
      return columns;
    } else {
      logWithTimestamp(`   ⚠️ Tabela vazia, tentando detectar colunas via erro...`);
      return [];
    }
  } catch (error) {
    logWithTimestamp(`   ❌ Erro ao verificar ${tableName}: ${error.message}`);
    return null;
  }
}

async function testFieldExists(tableName, fieldName, testValue = 'test') {
  try {
    const testData = { [fieldName]: testValue };
    await makeSupabaseRequest(tableName, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: testData,
    });
    return true;
  } catch (error) {
    if (error.message.includes(`Could not find the '${fieldName}' column`)) {
      return false;
    }
    // Outros erros (como foreign key, etc.) indicam que o campo existe
    return true;
  }
}

async function checkAllSchemas() {
  logWithTimestamp('🚀 Verificando schemas das tabelas Supabase...');
  logWithTimestamp('');

  const tables = [
    'iugu_invoices',
    'iugu_customers',
    'iugu_subscriptions',
    'iugu_plans',
    'iugu_chargebacks',
    'iugu_transfers',
    'iugu_payment_methods',
  ];

  const requiredFields = {
    iugu_invoices: [
      'currency',
      'payment_method',
      'payer_name',
      'payer_email',
      'payer_cpf',
      'description',
    ],
    iugu_customers: ['address', 'number', 'district', 'city', 'state', 'country', 'phone', 'notes'],
    iugu_subscriptions: [
      'active',
      'credits_based',
      'price_cents',
      'credits_cycle',
      'credits_min',
      'billing_cycle',
    ],
    iugu_plans: [
      'features',
      'interval',
      'interval_type',
      'value_cents',
      'payable_with',
      'max_cycles',
    ],
    iugu_chargebacks: ['raw_json'],
    iugu_transfers: [],
    iugu_payment_methods: [
      'customer_id',
      'description',
      'token',
      'brand',
      'holder_name',
      'display_number',
      'bin',
      'last_four_digits',
      'first_six_digits',
      'gateway',
      'gateway_id',
      'image',
      'test_card',
    ],
  };

  const missingFields = {};

  for (const table of tables) {
    logWithTimestamp(`📊 Analisando ${table}...`);

    // Verificar campos obrigatórios
    const fieldsToCheck = requiredFields[table] || [];
    const missing = [];

    for (const field of fieldsToCheck) {
      const exists = await testFieldExists(table, field);
      if (!exists) {
        missing.push(field);
        logWithTimestamp(`   ❌ Campo faltante: ${field}`);
      } else {
        logWithTimestamp(`   ✅ Campo existe: ${field}`);
      }
    }

    if (missing.length > 0) {
      missingFields[table] = missing;
    }

    logWithTimestamp('');
  }

  // Resumo final
  logWithTimestamp('📋 RESUMO DE CAMPOS FALTANTES:');
  logWithTimestamp('═'.repeat(50));

  if (Object.keys(missingFields).length === 0) {
    logWithTimestamp('🎉 Todos os campos necessários estão presentes!');
  } else {
    for (const [table, fields] of Object.entries(missingFields)) {
      logWithTimestamp(`❌ ${table}: ${fields.join(', ')}`);
    }
  }

  return missingFields;
}

// Executar se chamado diretamente
if (require.main === module) {
  checkAllSchemas()
    .then((missingFields) => {
      if (Object.keys(missingFields).length === 0) {
        logWithTimestamp('✅ Verificação de schema concluída - tudo OK!');
        process.exit(0);
      } else {
        logWithTimestamp('⚠️ Verificação de schema concluída - correções necessárias');
        process.exit(1);
      }
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = checkAllSchemas;
