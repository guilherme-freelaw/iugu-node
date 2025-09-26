#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configurações
const IUGU_API_TOKEN =
  process.env.IUGU_API_TOKEN || '9225D1D7C8065F541CDDD73D9B9AFD4BEF07F815ACA09519530DDD8568F0C0D2';
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

const iuguHeaders = {
  Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
  'Content-Type': 'application/json',
};

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

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - new Date(date);
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours >= 24) {
    const days = Math.floor(diffHours / 24);
    return `${days}d ${diffHours % 24}h atrás`;
  } else if (diffHours > 0) {
    return `${diffHours}h ${diffMinutes}m atrás`;
  } else {
    return `${diffMinutes}m atrás`;
  }
}

function parseIuguDate(dateString) {
  if (!dateString) return null;

  if (typeof dateString === 'string' && dateString.includes('T')) {
    return new Date(dateString);
  }

  if (typeof dateString === 'string') {
    const ddmmPattern = /^(\d{2})\/(\d{2}),\s*(\d{2}):(\d{2})$/;
    const ddmmMatch = dateString.match(ddmmPattern);
    if (ddmmMatch) {
      const [, day, month, hour, minute] = ddmmMatch;
      const currentYear = new Date().getFullYear();
      return new Date(
        `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:00Z`
      );
    }
  }

  try {
    return new Date(dateString);
  } catch (err) {
    return null;
  }
}

class EnhancedMonitoringDashboard {
  constructor() {
    this.status = {
      overall: 'healthy',
      dataFreshness: 'unknown',
      syncHealth: 'unknown',
      alerts: [],
    };
    this.metrics = {
      supabase: {},
      iugu: {},
      sync: {},
    };
  }

  async getSupabaseMetrics() {
    try {
      // Dados mais recentes no Supabase
      const invoicesQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,created_at_iugu,paid_at,updated_at_iugu,status&order=created_at_iugu.desc&limit=5`;
      const invoicesData = await makeRequest(invoicesQuery, {
        method: 'GET',
        headers: supabaseHeaders,
      });

      // Contagem total
      const countQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count`;
      const countData = await makeRequest(countQuery, {
        method: 'GET',
        headers: { ...supabaseHeaders, Prefer: 'count=exact' },
      });

      const latest = invoicesData[0];

      this.metrics.supabase = {
        totalInvoices: countData.length || 0,
        latestInvoice: latest
          ? {
              id: latest.id,
              created_at: latest.created_at_iugu,
              status: latest.status,
              timeAgo: latest.created_at_iugu ? formatTimeAgo(latest.created_at_iugu) : 'unknown',
            }
          : null,
        recentInvoices: invoicesData.slice(0, 3).map((inv) => ({
          id: inv.id.substring(0, 8) + '...',
          created_at: inv.created_at_iugu,
          status: inv.status,
          timeAgo: inv.created_at_iugu ? formatTimeAgo(inv.created_at_iugu) : 'unknown',
        })),
      };
    } catch (error) {
      this.status.alerts.push(`Erro ao acessar Supabase: ${error.message}`);
      this.metrics.supabase = { error: error.message };
    }
  }

  async getIuguMetrics() {
    try {
      // Faturas mais recentes na Iugu
      const invoicesUrl = `${IUGU_API_BASE_URL}/invoices?limit=5&sortBy=created_at&sortType=desc`;
      const invoicesData = await makeRequest(invoicesUrl, {
        method: 'GET',
        headers: iuguHeaders,
      });

      const latest = invoicesData.items?.[0];

      this.metrics.iugu = {
        totalInvoices: invoicesData.totalItems || 0,
        latestInvoice: latest
          ? {
              id: latest.id,
              created_at: latest.created_at,
              status: latest.status,
              timeAgo: latest.created_at
                ? formatTimeAgo(parseIuguDate(latest.created_at))
                : 'unknown',
            }
          : null,
        recentInvoices: (invoicesData.items || []).slice(0, 3).map((inv) => ({
          id: inv.id.substring(0, 8) + '...',
          created_at: inv.created_at,
          status: inv.status,
          timeAgo: inv.created_at ? formatTimeAgo(parseIuguDate(inv.created_at)) : 'unknown',
        })),
      };
    } catch (error) {
      this.status.alerts.push(`Erro ao acessar Iugu: ${error.message}`);
      this.metrics.iugu = { error: error.message };
    }
  }

  async analyzeFreshness() {
    if (this.metrics.supabase.latestInvoice && this.metrics.iugu.latestInvoice) {
      const supabaseDate = new Date(this.metrics.supabase.latestInvoice.created_at);
      const iuguDate = parseIuguDate(this.metrics.iugu.latestInvoice.created_at);

      if (iuguDate) {
        const gapMs = iuguDate - supabaseDate;
        const gapHours = gapMs / (1000 * 60 * 60);

        this.metrics.sync = {
          gapHours: gapHours.toFixed(1),
          status: gapHours < 2 ? 'fresh' : gapHours < 24 ? 'stale' : 'critical',
          supabaseLatest: this.metrics.supabase.latestInvoice.timeAgo,
          iuguLatest: this.metrics.iugu.latestInvoice.timeAgo,
        };

        this.status.dataFreshness = this.metrics.sync.status;

        if (gapHours > 2) {
          this.status.alerts.push(`Dados com ${gapHours.toFixed(1)}h de atraso`);
        }
      }
    }
  }

  async checkSyncHealth() {
    try {
      const syncLogPath = path.join(__dirname, '..', 'logs', 'sync.log');

      if (fs.existsSync(syncLogPath)) {
        const logContent = fs.readFileSync(syncLogPath, 'utf8');
        const lines = logContent.split('\n').filter((line) => line.trim());

        // Última sincronização bem-sucedida
        const successLines = lines.filter((line) => line.includes('SYNC COMPLETED SUCCESSFULLY'));
        const errorLines = lines
          .filter(
            (line) => line.includes('failed') || line.includes('error') || line.includes('Error')
          )
          .slice(-5);

        let lastSync = null;
        if (successLines.length > 0) {
          const lastSuccessLine = successLines[successLines.length - 1];
          const dateMatch = lastSuccessLine.match(
            /(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} [AP]M)/
          );
          if (dateMatch) {
            lastSync = new Date(dateMatch[1]);
          }
        }

        this.metrics.sync.health = {
          lastSync: lastSync ? formatTimeAgo(lastSync) : 'unknown',
          recentErrors: errorLines.length,
          status:
            lastSync && (new Date() - lastSync) / (1000 * 60 * 60) < 2 ? 'healthy' : 'degraded',
        };

        this.status.syncHealth = this.metrics.sync.health.status;

        if (errorLines.length > 0) {
          this.status.alerts.push(`${errorLines.length} erros recentes de sincronização`);
        }
      }
    } catch (error) {
      this.status.alerts.push(`Erro ao verificar logs: ${error.message}`);
    }
  }

  async checkAutoRecovery() {
    // Verificar se há necessidade de recuperação automática
    if (this.metrics.sync && this.metrics.sync.gapHours > 2) {
      const recoveryPath = path.join(__dirname, 'recovery_sync.js');
      if (fs.existsSync(recoveryPath)) {
        this.status.alerts.push(
          `⚠️ RECOMENDAÇÃO: Executar 'node scripts/recovery_sync.js' para recuperar dados perdidos`
        );
      }
    }
  }

  determineOverallStatus() {
    if (this.status.alerts.some((alert) => alert.includes('critical') || alert.includes('Erro'))) {
      this.status.overall = 'critical';
    } else if (this.status.alerts.length > 0) {
      this.status.overall = 'warning';
    } else if (this.status.dataFreshness === 'fresh' && this.status.syncHealth === 'healthy') {
      this.status.overall = 'healthy';
    } else {
      this.status.overall = 'warning';
    }
  }

  displayDashboard() {
    const now = new Date().toLocaleString();

    console.clear();
    console.log('🕐 DASHBOARD DE MONITORAMENTO TEMPORAL IUGU-SUPABASE');
    console.log('====================================================');
    console.log(`📅 Atualizado em: ${now}`);
    console.log('');

    // Status Geral
    const statusIcon = {
      healthy: '✅',
      warning: '⚠️',
      critical: '🔴',
    }[this.status.overall];

    console.log(`${statusIcon} STATUS GERAL: ${this.status.overall.toUpperCase()}`);
    console.log('');

    // Métricas do Supabase
    console.log('📊 SUPABASE (Base de Dados)');
    console.log('----------------------------');
    if (this.metrics.supabase.latestInvoice) {
      console.log(`📄 Total de faturas: ${this.metrics.supabase.totalInvoices || 'N/A'}`);
      console.log(
        `🕐 Última fatura: ${this.metrics.supabase.latestInvoice.timeAgo} (${this.metrics.supabase.latestInvoice.status})`
      );
      console.log(`📋 Faturas recentes:`);
      this.metrics.supabase.recentInvoices.forEach((inv, i) => {
        console.log(`   ${i + 1}. ${inv.id}: ${inv.timeAgo} (${inv.status})`);
      });
    } else {
      console.log(`❌ Erro: ${this.metrics.supabase.error || 'Dados não disponíveis'}`);
    }
    console.log('');

    // Métricas da Iugu
    console.log('🌐 IUGU (API Externa)');
    console.log('---------------------');
    if (this.metrics.iugu.latestInvoice) {
      console.log(`📄 Total de faturas: ${this.metrics.iugu.totalInvoices || 'N/A'}`);
      console.log(
        `🕐 Última fatura: ${this.metrics.iugu.latestInvoice.timeAgo} (${this.metrics.iugu.latestInvoice.status})`
      );
      console.log(`📋 Faturas recentes:`);
      this.metrics.iugu.recentInvoices.forEach((inv, i) => {
        console.log(`   ${i + 1}. ${inv.id}: ${inv.timeAgo} (${inv.status})`);
      });
    } else {
      console.log(`❌ Erro: ${this.metrics.iugu.error || 'Dados não disponíveis'}`);
    }
    console.log('');

    // Análise de Sincronização
    console.log('🔄 SINCRONIZAÇÃO E FRESCOR DOS DADOS');
    console.log('------------------------------------');
    if (this.metrics.sync.gapHours !== undefined) {
      const icon =
        this.metrics.sync.status === 'fresh'
          ? '✅'
          : this.metrics.sync.status === 'stale'
            ? '⚠️'
            : '🔴';
      console.log(
        `${icon} Defasagem: ${this.metrics.sync.gapHours}h (${this.metrics.sync.status})`
      );
      console.log(`📊 Supabase: ${this.metrics.sync.supabaseLatest}`);
      console.log(`🌐 Iugu: ${this.metrics.sync.iuguLatest}`);
    }

    if (this.metrics.sync.health) {
      const healthIcon = this.metrics.sync.health.status === 'healthy' ? '✅' : '⚠️';
      console.log(`${healthIcon} Última sincronização: ${this.metrics.sync.health.lastSync}`);
      if (this.metrics.sync.health.recentErrors > 0) {
        console.log(`🚨 Erros recentes: ${this.metrics.sync.health.recentErrors}`);
      }
    }
    console.log('');

    // Alertas
    if (this.status.alerts.length > 0) {
      console.log('🚨 ALERTAS E RECOMENDAÇÕES');
      console.log('--------------------------');
      this.status.alerts.forEach((alert, i) => {
        console.log(`${i + 1}. ${alert}`);
      });
      console.log('');
    }

    // Instruções
    console.log('🛠️ COMANDOS ÚTEIS');
    console.log('-----------------');
    console.log('• Sincronização manual: node scripts/hourly_sync.js');
    console.log('• Recuperação de dados: node scripts/recovery_sync.js');
    console.log('• Testes de integridade: node scripts/data_reliability_tests.js');
    console.log('• Este dashboard: node scripts/enhanced_monitoring_dashboard.js');
    console.log('');

    console.log(`⚡ Dashboard atualizado automaticamente em: ${now}`);
  }

  async run() {
    await this.getSupabaseMetrics();
    await this.getIuguMetrics();
    await this.analyzeFreshness();
    await this.checkSyncHealth();
    await this.checkAutoRecovery();
    this.determineOverallStatus();
    this.displayDashboard();

    return this.status;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const dashboard = new EnhancedMonitoringDashboard();
  dashboard.run().catch((error) => {
    console.error('❌ Erro no dashboard:', error);
    process.exit(1);
  });
}

module.exports = EnhancedMonitoringDashboard;
