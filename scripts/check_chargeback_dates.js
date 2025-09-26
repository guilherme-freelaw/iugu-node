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

async function checkChargebackDates() {
  logWithTimestamp('🔍 Verificando datas dos chargebacks...');

  try {
    // 1. Buscar amostra de chargebacks recentes
    const chargebacks = await makeSupabaseRequest(
      'iugu_chargebacks?select=id,created_at_iugu,updated_at_iugu,type,raw_json&order=created_at.desc&limit=5'
    );

    logWithTimestamp(`📋 Amostra de ${chargebacks.length} chargebacks:`);

    chargebacks.forEach((cb, i) => {
      logWithTimestamp(`\n${i + 1}. Chargeback: ${cb.id}`);
      logWithTimestamp(`   Tipo: ${cb.type}`);
      logWithTimestamp(`   created_at_iugu: ${cb.created_at_iugu || 'NULL'}`);
      logWithTimestamp(`   updated_at_iugu: ${cb.updated_at_iugu || 'NULL'}`);

      // Verificar se há data no raw_json
      if (cb.raw_json) {
        const raw = typeof cb.raw_json === 'string' ? JSON.parse(cb.raw_json) : cb.raw_json;
        logWithTimestamp(`   Data do raw_json:`);
        logWithTimestamp(`     created_at: ${raw.created_at || 'N/A'}`);
        logWithTimestamp(`     updated_at: ${raw.updated_at || 'N/A'}`);
        logWithTimestamp(`     due_date: ${raw.due_date || 'N/A'}`);
      }
    });

    // 2. Contar chargebacks com datas válidas vs NULL
    const withDates = await makeSupabaseRequest(
      'iugu_chargebacks?created_at_iugu=not.is.null&select=count'
    );
    const withoutDates = await makeSupabaseRequest(
      'iugu_chargebacks?created_at_iugu=is.null&select=count'
    );

    logWithTimestamp(`\n📊 Estatísticas de datas:`);
    logWithTimestamp(`   ✅ Com created_at_iugu: ${withDates.length} chargebacks`);
    logWithTimestamp(`   ❌ Sem created_at_iugu: ${withoutDates.length} chargebacks`);

    // 3. Verificar chargebacks por tipo
    const invoiceBased = await makeSupabaseRequest(
      'iugu_chargebacks?type=eq.invoice_based&select=id,created_at_iugu&limit=3'
    );
    const directChargebacks = await makeSupabaseRequest(
      'iugu_chargebacks?type=neq.invoice_based&type=not.is.null&select=id,created_at_iugu&limit=3'
    );

    logWithTimestamp(`\n🏷️ Chargebacks por tipo:`);
    logWithTimestamp(`   📄 Invoice-based (amostra):`);
    invoiceBased.forEach((cb) => {
      logWithTimestamp(`     ${cb.id}: ${cb.created_at_iugu || 'NULL'}`);
    });

    logWithTimestamp(`   ⚡ Diretos (amostra):`);
    directChargebacks.forEach((cb) => {
      logWithTimestamp(`     ${cb.id}: ${cb.created_at_iugu || 'NULL'}`);
    });

    // 4. Tentar encontrar chargebacks de 2025 verificando diferentes campos
    logWithTimestamp(`\n🔍 Procurando chargebacks de 2025...`);

    // Tentar por diferentes estratégias
    const strategies = [
      {
        name: 'created_at_iugu contém 2025',
        query: 'iugu_chargebacks?created_at_iugu=like.*2025*&select=id,created_at_iugu',
      },
      {
        name: 'raw_json contém 2025',
        query: 'iugu_chargebacks?raw_json=like.*2025*&select=id,raw_json&limit=3',
      },
    ];

    for (const strategy of strategies) {
      try {
        const results = await makeSupabaseRequest(strategy.query);
        logWithTimestamp(`   ${strategy.name}: ${results.length} encontrados`);

        if (results.length > 0 && results.length <= 3) {
          results.forEach((cb) => {
            if (cb.created_at_iugu) {
              logWithTimestamp(`     ${cb.id}: ${cb.created_at_iugu}`);
            } else if (cb.raw_json) {
              const raw = typeof cb.raw_json === 'string' ? JSON.parse(cb.raw_json) : cb.raw_json;
              logWithTimestamp(`     ${cb.id}: raw.created_at = ${raw.created_at || 'N/A'}`);
            }
          });
        }
      } catch (error) {
        logWithTimestamp(`   ${strategy.name}: Erro - ${error.message}`);
      }
    }

    // 5. Verificar os chargebacks mais recentemente inseridos
    logWithTimestamp(`\n🆕 Chargebacks inseridos recentemente:`);
    const recentlyInserted = await makeSupabaseRequest(
      'iugu_chargebacks?order=created_at.desc&limit=5&select=id,created_at,created_at_iugu,type'
    );

    recentlyInserted.forEach((cb, i) => {
      const supabaseDate = new Date(cb.created_at).toLocaleString();
      logWithTimestamp(`   ${i + 1}. ${cb.id} (${cb.type})`);
      logWithTimestamp(`      Inserido no Supabase: ${supabaseDate}`);
      logWithTimestamp(`      Data Iugu: ${cb.created_at_iugu || 'NULL'}`);
    });
  } catch (error) {
    logWithTimestamp(`❌ Erro: ${error.message}`);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  checkChargebackDates()
    .then(() => {
      logWithTimestamp('✅ Verificação concluída!');
      process.exit(0);
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = checkChargebackDates;
