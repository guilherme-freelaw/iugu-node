#!/usr/bin/env node

/**
 * 🔄 VERIFICAÇÃO DE ATUALIZAÇÃO DOS DADOS
 * ======================================
 *
 * Verificar se os dados estão 100% atualizados:
 * 1. Data da última importação
 * 2. Dados mais recentes no Supabase
 * 3. Comparação com API Iugu atual
 * 4. Status da sincronização automática
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

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

    req.on('error', reject);
    req.end();
  });
}

function isTestInvoice(invoice) {
  return (
    invoice.id === 'test_inv' || /^test_/i.test(invoice.id || '') || /teste/i.test(invoice.id || '')
  );
}

async function checkDataFreshness() {
  console.log('🔄 VERIFICAÇÃO DE ATUALIZAÇÃO DOS DADOS');
  console.log('======================================');
  console.log(`📅 Verificação em: ${new Date().toLocaleString('pt-BR')}`);
  console.log('');

  try {
    // 1. VERIFICAR DADOS MAIS RECENTES NO SUPABASE
    console.log('1. 📊 DADOS MAIS RECENTES NO SUPABASE');
    console.log('====================================');

    // Faturas mais recentes por created_at_iugu
    const recentByCreation = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,created_at_iugu,updated_at_iugu,status,paid_at&created_at_iugu=not.is.null&order=created_at_iugu.desc&limit=5`,
      { headers: supabaseHeaders }
    );

    // Faturas mais recentes por paid_at
    const recentByPayment = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,created_at_iugu,updated_at_iugu,status,paid_at&paid_at=not.is.null&order=paid_at.desc&limit=5`,
      { headers: supabaseHeaders }
    );

    // Faturas mais recentes por updated_at_iugu
    const recentByUpdate = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,created_at_iugu,updated_at_iugu,status,paid_at&updated_at_iugu=not.is.null&order=updated_at_iugu.desc&limit=5`,
      { headers: supabaseHeaders }
    );

    console.log('🕐 FATURAS MAIS RECENTES POR CRIAÇÃO:');
    if (recentByCreation && recentByCreation.length > 0) {
      recentByCreation.forEach((inv, i) => {
        const created = new Date(inv.created_at_iugu);
        const hoursAgo = Math.round((Date.now() - created.getTime()) / (1000 * 60 * 60));
        console.log(
          `   ${i + 1}. ${inv.id}: ${inv.created_at_iugu} (${hoursAgo}h atrás) - Status: ${inv.status}`
        );
      });
    } else {
      console.log('   ❌ Nenhuma fatura com created_at_iugu encontrada');
    }

    console.log('\n💰 FATURAS MAIS RECENTES POR PAGAMENTO:');
    if (recentByPayment && recentByPayment.length > 0) {
      recentByPayment.forEach((inv, i) => {
        const paid = new Date(inv.paid_at);
        const hoursAgo = Math.round((Date.now() - paid.getTime()) / (1000 * 60 * 60));
        console.log(
          `   ${i + 1}. ${inv.id}: ${inv.paid_at} (${hoursAgo}h atrás) - Status: ${inv.status}`
        );
      });
    } else {
      console.log('   ❌ Nenhuma fatura com paid_at encontrada');
    }

    console.log('\n🔄 FATURAS MAIS RECENTES POR ATUALIZAÇÃO:');
    if (recentByUpdate && recentByUpdate.length > 0) {
      recentByUpdate.forEach((inv, i) => {
        const updated = new Date(inv.updated_at_iugu);
        const hoursAgo = Math.round((Date.now() - updated.getTime()) / (1000 * 60 * 60));
        console.log(
          `   ${i + 1}. ${inv.id}: ${inv.updated_at_iugu} (${hoursAgo}h atrás) - Status: ${inv.status}`
        );
      });
    } else {
      console.log('   ❌ Nenhuma fatura com updated_at_iugu encontrada');
    }

    // 2. VERIFICAR TOTAL DE DADOS
    console.log('\n2. 📈 ESTATÍSTICAS GERAIS DOS DADOS');
    console.log('==================================');

    const totalInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id&limit=10000`,
      { headers: supabaseHeaders }
    );

    const paidInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id&status=eq.paid&limit=5000`,
      { headers: supabaseHeaders }
    );

    const todayInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id&created_at_iugu=gte.${new Date().toISOString().split('T')[0]}&limit=100`,
      { headers: supabaseHeaders }
    );

    const todayPaid = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id&status=eq.paid&paid_at=gte.${new Date().toISOString().split('T')[0]}&limit=100`,
      { headers: supabaseHeaders }
    );

    console.log(`📊 Total de faturas: ${totalInvoices ? totalInvoices.length : 0}`);
    console.log(`💰 Faturas pagas: ${paidInvoices ? paidInvoices.length : 0}`);
    console.log(`🆕 Faturas criadas hoje: ${todayInvoices ? todayInvoices.length : 0}`);
    console.log(`💳 Faturas pagas hoje: ${todayPaid ? todayPaid.length : 0}`);

    // 3. VERIFICAR SINCRONIZAÇÃO AUTOMÁTICA
    console.log('\n3. 🔄 STATUS DA SINCRONIZAÇÃO AUTOMÁTICA');
    console.log('=======================================');

    // Verificar se existem scripts de sincronização
    const fs = require('fs');
    const path = require('path');

    const syncScripts = [
      'scripts/hourly_sync.js',
      'scripts/data_reliability_tests.js',
      'scripts/monitoring_dashboard.js',
    ];

    console.log('📁 SCRIPTS DE SINCRONIZAÇÃO:');
    syncScripts.forEach((script) => {
      const exists = fs.existsSync(script);
      console.log(`   ${exists ? '✅' : '❌'} ${script}`);
    });

    // Verificar logs de sincronização se existirem
    const logDir = './logs';
    if (fs.existsSync(logDir)) {
      console.log('\n📋 LOGS DE SINCRONIZAÇÃO:');
      try {
        const logFiles = fs.readdirSync(logDir);
        logFiles.slice(0, 3).forEach((file) => {
          console.log(`   📄 ${file}`);
        });
      } catch (err) {
        console.log('   ❌ Erro ao ler logs');
      }
    } else {
      console.log('\n📋 LOGS DE SINCRONIZAÇÃO: Não encontrados');
    }

    // 4. ANÁLISE DE DEFASAGEM
    console.log('\n4. ⏰ ANÁLISE DE DEFASAGEM');
    console.log('=========================');

    let maxCreatedHours = 0;
    let maxPaidHours = 0;
    let maxUpdatedHours = 0;

    if (recentByCreation && recentByCreation.length > 0) {
      const mostRecentCreated = new Date(recentByCreation[0].created_at_iugu);
      maxCreatedHours = Math.round((Date.now() - mostRecentCreated.getTime()) / (1000 * 60 * 60));
    }

    if (recentByPayment && recentByPayment.length > 0) {
      const mostRecentPaid = new Date(recentByPayment[0].paid_at);
      maxPaidHours = Math.round((Date.now() - mostRecentPaid.getTime()) / (1000 * 60 * 60));
    }

    if (recentByUpdate && recentByUpdate.length > 0) {
      const mostRecentUpdated = new Date(recentByUpdate[0].updated_at_iugu);
      maxUpdatedHours = Math.round((Date.now() - mostRecentUpdated.getTime()) / (1000 * 60 * 60));
    }

    console.log(`🕐 Última criação: ${maxCreatedHours}h atrás`);
    console.log(`💰 Último pagamento: ${maxPaidHours}h atrás`);
    console.log(`🔄 Última atualização: ${maxUpdatedHours}h atrás`);

    // 5. AVALIAÇÃO FINAL
    console.log('\n5. 🎯 AVALIAÇÃO FINAL DA ATUALIZAÇÃO');
    console.log('===================================');

    let dataFreshness = 'EXCELENTE';
    let recommendations = [];

    if (maxCreatedHours > 24) {
      dataFreshness = 'DESATUALIZADA';
      recommendations.push('Executar sincronização de dados novos');
    } else if (maxCreatedHours > 6) {
      dataFreshness = 'PARCIALMENTE ATUALIZADA';
      recommendations.push('Verificar sincronização automática');
    }

    if (maxPaidHours > 48) {
      dataFreshness = 'DESATUALIZADA';
      recommendations.push('Sincronizar dados de pagamento');
    }

    if ((todayInvoices?.length || 0) === 0 && new Date().getHours() > 12) {
      dataFreshness = 'SUSPEITA';
      recommendations.push('Verificar se há atividade hoje na Iugu');
    }

    console.log(`📊 STATUS GERAL: ${dataFreshness}`);

    if (dataFreshness === 'EXCELENTE') {
      console.log('✅ Dados estão atualizados e prontos para uso');
    } else {
      console.log('⚠️ RECOMENDAÇÕES:');
      recommendations.forEach((rec, i) => {
        console.log(`   ${i + 1}. ${rec}`);
      });
    }

    // 6. INSTRUÇÕES PARA ATUALIZAÇÃO
    if (dataFreshness !== 'EXCELENTE') {
      console.log('\n6. 🔄 INSTRUÇÕES PARA ATUALIZAÇÃO');
      console.log('=================================');
      console.log('Para atualizar os dados, execute:');
      console.log('');
      console.log('# Sincronização manual rápida:');
      console.log('SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/hourly_sync.js');
      console.log('');
      console.log('# Ou usar um dos scripts existentes para buscar dados específicos');
    }

    return {
      status: dataFreshness,
      hoursOld: Math.max(maxCreatedHours, maxPaidHours),
      totalInvoices: totalInvoices?.length || 0,
      paidInvoices: paidInvoices?.length || 0,
      todayActivity: (todayInvoices?.length || 0) + (todayPaid?.length || 0),
    };
  } catch (err) {
    console.error(`❌ Erro na verificação: ${err.message}`);
    return { status: 'ERRO', error: err.message };
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  checkDataFreshness()
    .then((result) => {
      console.log('\n✅ Verificação de atualização concluída!');
      process.exit(result.status === 'EXCELENTE' ? 0 : 1);
    })
    .catch((err) => {
      console.error(`💥 Erro: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { checkDataFreshness };
