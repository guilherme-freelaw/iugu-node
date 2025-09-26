#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

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

async function getSystemStatus() {
  const status = {
    timestamp: new Date().toISOString(),
    database: {},
    sync: {},
    tests: {},
    alerts: [],
  };

  try {
    // Status do banco de dados
    const totalInvoices = await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_invoices?select=count`, {
      headers: { ...supabaseHeaders, Prefer: 'count=exact' },
    });

    const totalCustomers = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_customers?select=count`,
      {
        headers: { ...supabaseHeaders, Prefer: 'count=exact' },
      }
    );

    const recentInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&created_at_iugu=gte.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`,
      {
        headers: { ...supabaseHeaders, Prefer: 'count=exact' },
      }
    );

    status.database = {
      totalInvoices: totalInvoices[0]?.count || 0,
      totalCustomers: totalCustomers[0]?.count || 0,
      recentInvoices: recentInvoices[0]?.count || 0,
      status: 'online',
    };

    // Status da sincronização
    try {
      const syncCheckpoint = JSON.parse(fs.readFileSync('hourly_sync_checkpoint.json', 'utf8'));
      const lastSyncTime = new Date(syncCheckpoint.lastSync);
      const hoursSinceSync = (Date.now() - lastSyncTime.getTime()) / (1000 * 60 * 60);

      status.sync = {
        lastSync: syncCheckpoint.lastSync,
        hoursSinceSync: hoursSinceSync.toFixed(1),
        totalSynced: syncCheckpoint.totalSynced,
        lastRun: syncCheckpoint.lastRun,
        status: hoursSinceSync <= 2 ? 'healthy' : hoursSinceSync <= 6 ? 'warning' : 'error',
      };

      if (hoursSinceSync > 2) {
        status.alerts.push({
          type: 'warning',
          message: `Última sincronização há ${hoursSinceSync.toFixed(1)} horas`,
          severity: hoursSinceSync > 6 ? 'high' : 'medium',
        });
      }
    } catch (err) {
      status.sync = {
        status: 'unknown',
        error: 'Checkpoint file not found',
      };
      status.alerts.push({
        type: 'error',
        message: 'Arquivo de checkpoint da sincronização não encontrado',
        severity: 'high',
      });
    }

    // Status dos testes
    try {
      const testResults = JSON.parse(fs.readFileSync('data_reliability_report.json', 'utf8'));
      const testAge = (Date.now() - new Date(testResults.timestamp).getTime()) / (1000 * 60 * 60);

      status.tests = {
        lastRun: testResults.timestamp,
        hoursAgo: testAge.toFixed(1),
        summary: testResults.summary,
        successRate: ((testResults.summary.passed / testResults.summary.total) * 100).toFixed(1),
        status: testResults.summary.failed === 0 ? 'passing' : 'failing',
      };

      if (testResults.summary.failed > 0) {
        status.alerts.push({
          type: 'error',
          message: `${testResults.summary.failed} testes falhando`,
          severity: 'high',
        });
      }

      if (testAge > 12) {
        status.alerts.push({
          type: 'warning',
          message: `Testes não executados há ${testAge.toFixed(1)} horas`,
          severity: 'medium',
        });
      }
    } catch (err) {
      status.tests = {
        status: 'unknown',
        error: 'Test report not found',
      };
    }
  } catch (err) {
    status.alerts.push({
      type: 'error',
      message: `Erro ao acessar banco de dados: ${err.message}`,
      severity: 'critical',
    });
  }

  return status;
}

function formatStatus(status) {
  console.log('📊 DASHBOARD DE MONITORAMENTO IUGU-SUPABASE');
  console.log('============================================');
  console.log(`🕐 Atualizado em: ${new Date(status.timestamp).toLocaleString()}\n`);

  // Status do banco
  console.log('🗄️  BANCO DE DADOS:');
  console.log(`   📄 Faturas: ${status.database.totalInvoices?.toLocaleString() || 'N/A'}`);
  console.log(`   👥 Clientes: ${status.database.totalCustomers?.toLocaleString() || 'N/A'}`);
  console.log(
    `   🆕 Últimas 24h: ${status.database.recentInvoices?.toLocaleString() || 'N/A'} faturas`
  );

  // Status da sincronização
  console.log('\n🔄 SINCRONIZAÇÃO:');
  if (status.sync.status) {
    const syncEmoji =
      status.sync.status === 'healthy' ? '✅' : status.sync.status === 'warning' ? '⚠️' : '❌';
    console.log(`   ${syncEmoji} Status: ${status.sync.status.toUpperCase()}`);
    console.log(`   🕐 Última sync: ${status.sync.hoursSinceSync}h atrás`);
    console.log(`   📊 Total sincronizado: ${status.sync.totalSynced?.toLocaleString() || 'N/A'}`);

    if (status.sync.lastRun) {
      console.log(
        `   📈 Última execução: ${status.sync.lastRun.invoices || 0} faturas, ${status.sync.lastRun.customers || 0} clientes`
      );
    }
  }

  // Status dos testes
  console.log('\n🧪 TESTES DE CONFIABILIDADE:');
  if (status.tests.successRate) {
    const testEmoji = status.tests.status === 'passing' ? '✅' : '❌';
    console.log(`   ${testEmoji} Taxa de sucesso: ${status.tests.successRate}%`);
    console.log(
      `   📊 Testes: ${status.tests.summary.passed}✅ ${status.tests.summary.warnings}⚠️ ${status.tests.summary.failed}❌`
    );
    console.log(`   🕐 Última execução: ${status.tests.hoursAgo}h atrás`);
  } else {
    console.log('   ❓ Status desconhecido');
  }

  // Alertas
  console.log('\n🚨 ALERTAS:');
  if (status.alerts.length === 0) {
    console.log('   ✅ Nenhum alerta ativo');
  } else {
    status.alerts.forEach((alert) => {
      const emoji =
        alert.severity === 'critical'
          ? '🔥'
          : alert.severity === 'high'
            ? '❌'
            : alert.severity === 'medium'
              ? '⚠️'
              : 'ℹ️';
      console.log(`   ${emoji} ${alert.message}`);
    });
  }

  // Resumo geral
  const overallHealth =
    status.alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length === 0
      ? 'SAUDÁVEL'
      : 'ATENÇÃO NECESSÁRIA';
  const healthEmoji = overallHealth === 'SAUDÁVEL' ? '🟢' : '🟡';

  console.log(`\n${healthEmoji} SAÚDE GERAL DO SISTEMA: ${overallHealth}`);
}

async function generateDashboard() {
  try {
    const status = await getSystemStatus();
    formatStatus(status);

    // Salvar status para histórico
    const statusHistory = [];
    try {
      const existingHistory = JSON.parse(fs.readFileSync('monitoring_history.json', 'utf8'));
      statusHistory.push(...existingHistory);
    } catch (err) {
      // Arquivo não existe, começar novo histórico
    }

    statusHistory.push(status);

    // Manter apenas últimas 48 entradas (últimas 48 horas se executado de hora em hora)
    if (statusHistory.length > 48) {
      statusHistory.splice(0, statusHistory.length - 48);
    }

    fs.writeFileSync('monitoring_history.json', JSON.stringify(statusHistory, null, 2));

    return status;
  } catch (err) {
    console.error(`❌ Erro no dashboard: ${err.message}`);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  generateDashboard()
    .then((status) => {
      const hasAlerts = status.alerts.some(
        (a) => a.severity === 'critical' || a.severity === 'high'
      );
      process.exit(hasAlerts ? 1 : 0);
    })
    .catch((err) => {
      console.error(`💥 Fatal error: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { getSystemStatus, generateDashboard };
