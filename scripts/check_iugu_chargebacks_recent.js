#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL;

function logWithTimestamp(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

async function makeIuguRequest(endpoint, options = {}) {
  const url = `${IUGU_API_BASE_URL}${endpoint}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
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

async function checkIuguChargebacksRecent() {
  logWithTimestamp('🔍 Verificando chargebacks diretamente na API Iugu...');

  try {
    // Buscar chargebacks recentes (últimos meses)
    logWithTimestamp('📅 Buscando chargebacks dos últimos meses...');

    // API da Iugu para chargebacks
    const chargebacks = await makeIuguRequest('/chargebacks?limit=100');

    logWithTimestamp(`📋 Total de chargebacks na API Iugu: ${chargebacks.items?.length || 0}`);

    if (!chargebacks.items || chargebacks.items.length === 0) {
      logWithTimestamp('❌ Nenhum chargeback encontrado na API Iugu');
      return;
    }

    // Analisar por mês
    const chargebacksByMonth = {};

    chargebacks.items.forEach((chargeback) => {
      const createdAt = chargeback.created_at;
      if (createdAt) {
        // A data pode vir em diferentes formatos da Iugu
        let date;
        try {
          date = new Date(createdAt);
        } catch (error) {
          logWithTimestamp(`⚠️ Erro ao parsear data: ${createdAt}`);
          return;
        }

        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!chargebacksByMonth[monthKey]) {
          chargebacksByMonth[monthKey] = [];
        }
        chargebacksByMonth[monthKey].push(chargeback);
      }
    });

    // Mostrar análise por mês
    logWithTimestamp('📅 Chargebacks na API Iugu por mês:');
    logWithTimestamp('═'.repeat(50));

    const sortedMonths = Object.keys(chargebacksByMonth).sort((a, b) => b.localeCompare(a));

    for (const monthKey of sortedMonths) {
      const cbs = chargebacksByMonth[monthKey];
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

      logWithTimestamp(`📆 ${monthName}/${year}: ${cbs.length} chargebacks`);

      cbs.forEach((cb, index) => {
        const date = new Date(cb.created_at);
        logWithTimestamp(`   ${index + 1}. ${date.toLocaleDateString('pt-BR')} - ID: ${cb.id}`);
        logWithTimestamp(`      Invoice: ${cb.invoice_id || 'N/A'}`);
        logWithTimestamp(`      Amount: R$ ${(cb.amount_cents || 0) / 100}`);
        logWithTimestamp(`      Status: ${cb.status || 'N/A'}`);
        logWithTimestamp(`      Reason: ${cb.reason || 'N/A'}`);
      });
      logWithTimestamp('');
    }

    // Foco em setembro e agosto 2025
    const september2025 = chargebacksByMonth['2025-09'] || [];
    const august2025 = chargebacksByMonth['2025-08'] || [];

    logWithTimestamp('🎯 VERIFICAÇÃO NA API IUGU:');
    logWithTimestamp('═'.repeat(40));
    logWithTimestamp(`📊 SETEMBRO 2025 (API): ${september2025.length} chargebacks`);
    logWithTimestamp(`📊 AGOSTO 2025 (API): ${august2025.length} chargebacks`);

    if (september2025.length > 0 || august2025.length > 0) {
      logWithTimestamp('');
      logWithTimestamp('⚠️ DADOS FALTANDO NO SUPABASE!');
      logWithTimestamp('Os chargebacks estão na API Iugu mas não foram sincronizados.');
    }

    // Mostrar detalhes dos chargebacks mais recentes
    logWithTimestamp('');
    logWithTimestamp('📋 CHARGEBACKS MAIS RECENTES NA API:');
    logWithTimestamp('═'.repeat(40));

    const recentChargebacks = chargebacks.items
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);

    recentChargebacks.forEach((cb, index) => {
      const date = new Date(cb.created_at);
      logWithTimestamp(
        `${index + 1}. ${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR')}`
      );
      logWithTimestamp(`   ID: ${cb.id}`);
      logWithTimestamp(`   Invoice: ${cb.invoice_id || 'N/A'}`);
      logWithTimestamp(`   Amount: R$ ${(cb.amount_cents || 0) / 100}`);
      logWithTimestamp(`   Status: ${cb.status || 'N/A'}`);
      logWithTimestamp('');
    });

    return {
      total: chargebacks.items.length,
      byMonth: chargebacksByMonth,
      september2025: september2025.length,
      august2025: august2025.length,
    };
  } catch (error) {
    logWithTimestamp(`❌ Erro ao verificar chargebacks na API Iugu: ${error.message}`);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  checkIuguChargebacksRecent()
    .then((result) => {
      logWithTimestamp('✅ Verificação na API Iugu concluída!');
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = checkIuguChargebacksRecent;
