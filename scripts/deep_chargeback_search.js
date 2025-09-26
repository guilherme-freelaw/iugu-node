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

async function deepChargebackSearch() {
  logWithTimestamp('🔍 Busca aprofundada de chargebacks na API Iugu...');

  try {
    // 1. Buscar com diferentes parâmetros
    logWithTimestamp('📅 1. Buscando chargebacks com diferentes filtros...');

    const searches = [
      { name: 'Padrão (limit=100)', params: '?limit=100' },
      { name: 'Todos (limit=1000)', params: '?limit=1000' },
      {
        name: 'Agosto 2025',
        params: '?created_at_from=2025-08-01&created_at_to=2025-08-31&limit=100',
      },
      {
        name: 'Setembro 2025',
        params: '?created_at_from=2025-09-01&created_at_to=2025-09-30&limit=100',
      },
      { name: 'Últimos 3 meses', params: '?created_at_from=2025-07-01&limit=100' },
    ];

    const allResults = {};

    for (const search of searches) {
      try {
        logWithTimestamp(`   🔎 ${search.name}...`);
        const result = await makeIuguRequest(`/chargebacks${search.params}`);
        allResults[search.name] = result;
        logWithTimestamp(`      Encontrados: ${result.items?.length || 0} chargebacks`);

        if (result.items && result.items.length > 0) {
          result.items.forEach((cb, index) => {
            if (index < 3) {
              // Mostrar apenas os 3 primeiros de cada busca
              const date = new Date(cb.created_at);
              logWithTimestamp(
                `         ${index + 1}. ${date.toLocaleDateString('pt-BR')} - ${cb.id.substring(0, 8)}...`
              );
            }
          });
        }
        logWithTimestamp('');
      } catch (error) {
        logWithTimestamp(`      ❌ Erro: ${error.message}`);
      }
    }

    // 2. Verificar parâmetros de paginação
    logWithTimestamp('📄 2. Verificando informações de paginação...');
    const defaultResult = allResults['Padrão (limit=100)'];
    if (defaultResult) {
      logWithTimestamp(`   Total items: ${defaultResult.totalItems || 'N/A'}`);
      logWithTimestamp(`   Items retornados: ${defaultResult.items?.length || 0}`);
      logWithTimestamp(`   Página atual: ${defaultResult.facets?.current_page || 'N/A'}`);
      logWithTimestamp(`   Total páginas: ${defaultResult.facets?.total_pages || 'N/A'}`);
    }

    // 3. Buscar por status específicos
    logWithTimestamp('📊 3. Buscando por diferentes status...');
    const statusList = ['pending', 'accepted', 'declined', 'accepted_automatically'];

    for (const status of statusList) {
      try {
        logWithTimestamp(`   🏷️ Status: ${status}...`);
        const result = await makeIuguRequest(`/chargebacks?status=${status}&limit=100`);
        logWithTimestamp(`      Encontrados: ${result.items?.length || 0} chargebacks`);
      } catch (error) {
        logWithTimestamp(`      ❌ Erro: ${error.message}`);
      }
    }

    // 4. Verificar se existem faturas com status 'chargeback' em agosto/setembro
    logWithTimestamp('📋 4. Verificando faturas com status chargeback...');

    try {
      const invoicesAug = await makeIuguRequest(
        '/invoices?status=chargeback&created_at_from=2025-08-01&created_at_to=2025-08-31&limit=100'
      );
      const invoicesSep = await makeIuguRequest(
        '/invoices?status=chargeback&created_at_from=2025-09-01&created_at_to=2025-09-30&limit=100'
      );

      logWithTimestamp(`   Faturas com chargeback em AGO/2025: ${invoicesAug.items?.length || 0}`);
      logWithTimestamp(`   Faturas com chargeback em SET/2025: ${invoicesSep.items?.length || 0}`);

      if (invoicesAug.items?.length > 0) {
        logWithTimestamp('   📄 Faturas AGO/2025:');
        invoicesAug.items.forEach((inv, index) => {
          const date = new Date(inv.created_at);
          logWithTimestamp(
            `      ${index + 1}. ${date.toLocaleDateString('pt-BR')} - ${inv.id} - R$ ${(inv.total_cents || 0) / 100}`
          );
        });
      }

      if (invoicesSep.items?.length > 0) {
        logWithTimestamp('   📄 Faturas SET/2025:');
        invoicesSep.items.forEach((inv, index) => {
          const date = new Date(inv.created_at);
          logWithTimestamp(
            `      ${index + 1}. ${date.toLocaleDateString('pt-BR')} - ${inv.id} - R$ ${(inv.total_cents || 0) / 100}`
          );
        });
      }
    } catch (error) {
      logWithTimestamp(`   ❌ Erro ao buscar faturas: ${error.message}`);
    }

    // 5. Resumo final
    logWithTimestamp('');
    logWithTimestamp('📈 RESUMO DA BUSCA APROFUNDADA:');
    logWithTimestamp('═'.repeat(50));

    const augustResult = allResults['Agosto 2025'];
    const septemberResult = allResults['Setembro 2025'];

    logWithTimestamp(`🗓️ Agosto 2025: ${augustResult?.items?.length || 0} chargebacks`);
    logWithTimestamp(`🗓️ Setembro 2025: ${septemberResult?.items?.length || 0} chargebacks`);
    logWithTimestamp(`📊 Total geral: ${defaultResult?.items?.length || 0} chargebacks`);

    if ((augustResult?.items?.length || 0) === 0 && (septemberResult?.items?.length || 0) === 0) {
      logWithTimestamp('');
      logWithTimestamp('🤔 HIPÓTESES PARA A DIVERGÊNCIA:');
      logWithTimestamp('   1. Os chargebacks podem estar em outro endpoint/status');
      logWithTimestamp('   2. Podem ter sido resolvidos rapidamente');
      logWithTimestamp('   3. Os dados podem vir de relatórios específicos do painel');
      logWithTimestamp('   4. Pode haver delay na API vs painel administrativo');
    }

    return allResults;
  } catch (error) {
    logWithTimestamp(`❌ Erro na busca aprofundada: ${error.message}`);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  deepChargebackSearch()
    .then((result) => {
      logWithTimestamp('✅ Busca aprofundada concluída!');
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = deepChargebackSearch;
