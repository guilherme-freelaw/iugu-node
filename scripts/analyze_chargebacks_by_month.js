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
    Prefer: 'return=representation',
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

async function analyzeChargebacksByMonth() {
  logWithTimestamp('📊 Analisando chargebacks por mês...');

  try {
    // Buscar todos os chargebacks com detalhes
    logWithTimestamp('🔍 Buscando todos os chargebacks...');
    const allChargebacks = await makeSupabaseRequest(
      'iugu_chargebacks?select=*&order=created_at_iugu.desc'
    );

    logWithTimestamp(`📋 Total de chargebacks encontrados: ${allChargebacks.length}`);

    if (allChargebacks.length === 0) {
      logWithTimestamp('❌ Nenhum chargeback encontrado');
      return;
    }

    // Agrupar por mês
    const chargebacksByMonth = {};

    allChargebacks.forEach((chargeback) => {
      if (chargeback.created_at_iugu) {
        const date = new Date(chargeback.created_at_iugu);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!chargebacksByMonth[monthKey]) {
          chargebacksByMonth[monthKey] = [];
        }
        chargebacksByMonth[monthKey].push(chargeback);
      }
    });

    // Mostrar análise detalhada
    logWithTimestamp('📅 Análise por mês:');
    logWithTimestamp('═'.repeat(60));

    const sortedMonths = Object.keys(chargebacksByMonth).sort((a, b) => b.localeCompare(a));

    for (const monthKey of sortedMonths) {
      const chargebacks = chargebacksByMonth[monthKey];
      const [year, month] = monthKey.split('-');
      const monthNames = [
        'Jan',
        'Fev',
        'Mar',
        'Abr',
        'Mai',
        'Jun',
        'Jul',
        'Ago',
        'Set',
        'Out',
        'Nov',
        'Dez',
      ];
      const monthName = monthNames[parseInt(month) - 1];

      logWithTimestamp(`📆 ${monthName}/${year}: ${chargebacks.length} chargebacks`);

      chargebacks.forEach((cb, index) => {
        const date = new Date(cb.created_at_iugu);
        logWithTimestamp(
          `   ${index + 1}. ${date.toLocaleDateString('pt-BR')} - ID: ${cb.id.substring(0, 8)}...`
        );
        logWithTimestamp(
          `      Invoice: ${cb.invoice_id ? cb.invoice_id.substring(0, 8) + '...' : 'N/A'}`
        );
        logWithTimestamp(`      Amount: R$ ${(cb.amount_cents || 0) / 100}`);
      });
      logWithTimestamp('');
    }

    // Foco especial em setembro e agosto 2025
    logWithTimestamp('🎯 VERIFICAÇÃO ESPECÍFICA:');
    logWithTimestamp('═'.repeat(40));

    const september2025 = chargebacksByMonth['2025-09'] || [];
    const august2025 = chargebacksByMonth['2025-08'] || [];

    logWithTimestamp(`📊 SETEMBRO 2025: ${september2025.length} chargebacks`);
    if (september2025.length > 0) {
      september2025.forEach((cb, index) => {
        const date = new Date(cb.created_at_iugu);
        logWithTimestamp(
          `   ${index + 1}. ${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR')} - ${cb.id.substring(0, 12)}...`
        );
      });
    } else {
      logWithTimestamp('   ❌ Nenhum chargeback encontrado em setembro 2025');
    }

    logWithTimestamp('');
    logWithTimestamp(`📊 AGOSTO 2025: ${august2025.length} chargebacks`);
    if (august2025.length > 0) {
      august2025.forEach((cb, index) => {
        const date = new Date(cb.created_at_iugu);
        logWithTimestamp(
          `   ${index + 1}. ${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR')} - ${cb.id.substring(0, 12)}...`
        );
      });
    } else {
      logWithTimestamp('   ❌ Nenhum chargeback encontrado em agosto 2025');
    }

    // Verificar se há chargebacks mais recentes que podem estar faltando
    logWithTimestamp('');
    logWithTimestamp('🔍 VERIFICAÇÃO DE DADOS RECENTES:');
    logWithTimestamp('═'.repeat(40));

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

    logWithTimestamp(
      `📅 Mês atual (${currentMonth}): ${chargebacksByMonth[currentMonth]?.length || 0} chargebacks`
    );
    logWithTimestamp(
      `📅 Mês passado (${lastMonthKey}): ${chargebacksByMonth[lastMonthKey]?.length || 0} chargebacks`
    );

    // Comparar com expectativas do usuário
    logWithTimestamp('');
    logWithTimestamp('⚠️  COMPARAÇÃO COM EXPECTATIVAS:');
    logWithTimestamp('═'.repeat(40));
    logWithTimestamp(`   Expectativa SET/2025: 2 chargebacks`);
    logWithTimestamp(`   Encontrado SET/2025: ${september2025.length} chargebacks`);
    logWithTimestamp(`   Status: ${september2025.length === 2 ? '✅ CORRETO' : '❌ DIVERGÊNCIA'}`);
    logWithTimestamp('');
    logWithTimestamp(`   Expectativa AGO/2025: ~5 chargebacks`);
    logWithTimestamp(`   Encontrado AGO/2025: ${august2025.length} chargebacks`);
    logWithTimestamp(
      `   Status: ${august2025.length >= 4 && august2025.length <= 6 ? '✅ CORRETO' : '❌ DIVERGÊNCIA'}`
    );

    return {
      total: allChargebacks.length,
      byMonth: chargebacksByMonth,
      september2025: september2025.length,
      august2025: august2025.length,
      expectedSeptember: 2,
      expectedAugust: 5,
    };
  } catch (error) {
    logWithTimestamp(`❌ Erro na análise: ${error.message}`);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  analyzeChargebacksByMonth()
    .then((result) => {
      logWithTimestamp('✅ Análise de chargebacks por mês concluída!');
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = analyzeChargebacksByMonth;
