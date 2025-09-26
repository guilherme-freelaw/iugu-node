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

async function debugChargebacks() {
  logWithTimestamp('🔍 Debug da sincronização de chargebacks...');

  try {
    // 1. Contar total de chargebacks
    const totalQuery = `${SUPABASE_URL}/rest/v1/iugu_chargebacks?select=count`;
    const totalResponse = await fetch(totalQuery, {
      method: 'HEAD',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'count=exact',
      },
    });

    const totalCount = totalResponse.headers.get('content-range')?.split('/')[1] || '0';
    logWithTimestamp(`📊 Total de chargebacks no Supabase: ${totalCount}`);

    // 2. Buscar chargebacks mais recentes
    const recentChargebacks = await makeSupabaseRequest(
      'iugu_chargebacks?order=created_at_iugu.desc&limit=10'
    );
    logWithTimestamp(`🕒 Últimos ${recentChargebacks.length} chargebacks:`);

    recentChargebacks.forEach((cb, i) => {
      const date = cb.created_at_iugu ? new Date(cb.created_at_iugu).toLocaleDateString() : 'N/A';
      logWithTimestamp(`   ${i + 1}. ID: ${cb.id} - Data: ${date} - Tipo: ${cb.type || 'N/A'}`);
    });

    // 3. Verificar chargebacks por tipo
    const typeCounts = await makeSupabaseRequest(
      'iugu_chargebacks?select=type,count&group_by=type'
    );
    logWithTimestamp(`🏷️ Chargebacks por tipo:`);
    typeCounts.forEach((type) => {
      logWithTimestamp(`   ${type.type || 'NULL'}: ${type.count} chargebacks`);
    });

    // 4. Verificar chargebacks de 2025
    const chargebacks2025 = await makeSupabaseRequest(
      'iugu_chargebacks?created_at_iugu=gte.2025-01-01&created_at_iugu=lt.2026-01-01&select=id,created_at_iugu,type&order=created_at_iugu.desc&limit=20'
    );
    logWithTimestamp(`📅 Chargebacks de 2025 (${chargebacks2025.length} encontrados):`);

    const monthCounts = {};
    chargebacks2025.forEach((cb) => {
      if (cb.created_at_iugu) {
        const month = new Date(cb.created_at_iugu).toISOString().substring(0, 7); // YYYY-MM
        monthCounts[month] = (monthCounts[month] || 0) + 1;
      }
    });

    Object.entries(monthCounts)
      .sort()
      .forEach(([month, count]) => {
        logWithTimestamp(`   ${month}: ${count} chargebacks`);
      });

    // 5. Verificar chargebacks criados recentemente (última hora)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentSynced = await makeSupabaseRequest(
      `iugu_chargebacks?created_at=gte.${oneHourAgo}&select=id,created_at_iugu,type,invoice_id&order=created_at.desc&limit=10`
    );

    logWithTimestamp(`🆕 Chargebacks sincronizados na última hora (${recentSynced.length}):`);
    recentSynced.forEach((cb, i) => {
      const iuguDate = cb.created_at_iugu
        ? new Date(cb.created_at_iugu).toLocaleDateString()
        : 'N/A';
      logWithTimestamp(`   ${i + 1}. ${cb.id} - Iugu Date: ${iuguDate} - Tipo: ${cb.type}`);
    });

    // 6. Verificar se há chargebacks com base em faturas
    const invoiceBasedChargebacks = await makeSupabaseRequest(
      'iugu_chargebacks?type=eq.invoice_based&select=id,created_at_iugu&order=created_at_iugu.desc&limit=5'
    );
    logWithTimestamp(`📄 Chargebacks baseados em faturas (${invoiceBasedChargebacks.length}):`);
    invoiceBasedChargebacks.forEach((cb) => {
      const date = cb.created_at_iugu ? new Date(cb.created_at_iugu).toLocaleDateString() : 'N/A';
      logWithTimestamp(`   ${cb.id} - Data: ${date}`);
    });

    // 7. Verificar problema de datas
    logWithTimestamp(`🔍 Investigando datas dos chargebacks de agosto e setembro...`);

    const augSepChargebacks = await makeSupabaseRequest(
      'iugu_chargebacks?created_at_iugu=gte.2025-08-01&created_at_iugu=lt.2025-10-01&select=id,created_at_iugu,type&order=created_at_iugu.desc'
    );

    logWithTimestamp(`📊 Chargebacks Ago/Set 2025: ${augSepChargebacks.length} encontrados`);

    if (augSepChargebacks.length > 0) {
      const august = augSepChargebacks.filter((cb) =>
        cb.created_at_iugu?.includes('2025-08')
      ).length;
      const september = augSepChargebacks.filter((cb) =>
        cb.created_at_iugu?.includes('2025-09')
      ).length;

      logWithTimestamp(`   📅 Agosto 2025: ${august} chargebacks`);
      logWithTimestamp(`   📅 Setembro 2025: ${september} chargebacks`);

      // Mostrar alguns exemplos
      if (august > 0) {
        logWithTimestamp(`   🔍 Exemplos de agosto:`);
        augSepChargebacks
          .filter((cb) => cb.created_at_iugu?.includes('2025-08'))
          .slice(0, 3)
          .forEach((cb) => {
            logWithTimestamp(`     ${cb.id} - ${cb.created_at_iugu}`);
          });
      }

      if (september > 0) {
        logWithTimestamp(`   🔍 Exemplos de setembro:`);
        augSepChargebacks
          .filter((cb) => cb.created_at_iugu?.includes('2025-09'))
          .slice(0, 3)
          .forEach((cb) => {
            logWithTimestamp(`     ${cb.id} - ${cb.created_at_iugu}`);
          });
      }
    }
  } catch (error) {
    logWithTimestamp(`❌ Erro no debug: ${error.message}`);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  debugChargebacks()
    .then(() => {
      logWithTimestamp('✅ Debug concluído!');
      process.exit(0);
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = debugChargebacks;
