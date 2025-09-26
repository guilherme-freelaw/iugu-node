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

class TemporalMonitor {
  constructor() {
    this.alerts = [];
    this.metrics = {
      dataFreshness: null,
      syncHealth: null,
      gapDetection: null,
      performanceMetrics: null,
    };
  }

  async analyzeDataFreshness() {
    logWithTimestamp('🕐 ANALISANDO FRESCOR DOS DADOS');

    try {
      // 1. Verificar dados mais recentes no Supabase
      const supabaseQuery = `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,created_at_iugu,paid_at,updated_at_iugu&order=created_at_iugu.desc&limit=5`;
      const supabaseData = await makeRequest(supabaseQuery, {
        method: 'GET',
        headers: supabaseHeaders,
      });

      // 2. Verificar dados mais recentes na Iugu
      const iuguQuery = `${IUGU_API_BASE_URL}/invoices?limit=5&sortBy=created_at&sortType=desc`;
      const iuguData = await makeRequest(iuguQuery, {
        method: 'GET',
        headers: iuguHeaders,
      });

      const supabaseLatest = supabaseData[0]?.created_at_iugu;
      const iuguLatest = iuguData.items?.[0]?.created_at;

      const freshness = {
        supabaseLatest,
        iuguLatest,
        gap: null,
        status: 'unknown',
      };

      if (supabaseLatest && iuguLatest) {
        const supabaseDate = new Date(supabaseLatest);
        const iuguDate = this.parseIuguDate(iuguLatest);

        if (iuguDate) {
          const gapMs = iuguDate - supabaseDate;
          const gapHours = gapMs / (1000 * 60 * 60);

          freshness.gap = gapHours;
          freshness.status = gapHours < 2 ? 'fresh' : gapHours < 24 ? 'stale' : 'critical';

          if (gapHours > 1) {
            this.alerts.push({
              type: 'DATA_FRESHNESS',
              severity: gapHours > 24 ? 'critical' : 'warning',
              message: `Dados com ${gapHours.toFixed(1)}h de atraso`,
              details: { gapHours, supabaseLatest, iuguLatest },
            });
          }
        }
      }

      this.metrics.dataFreshness = freshness;
      return freshness;
    } catch (error) {
      this.alerts.push({
        type: 'DATA_FRESHNESS_ERROR',
        severity: 'error',
        message: `Erro ao verificar frescor: ${error.message}`,
      });
      return null;
    }
  }

  async detectDataGaps() {
    logWithTimestamp('🔍 DETECTANDO LACUNAS NOS DADOS');

    try {
      // Verificar se há lacunas nos últimos 7 dias
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Contar dados por dia no Supabase
      const supabaseCountQuery = `${SUPABASE_URL}/rest/v1/rpc/get_daily_invoice_counts`;
      const supabaseCounts = await makeRequest(supabaseCountQuery, {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify({
          start_date: startDateStr,
          end_date: endDateStr,
        }),
      });

      // Verificar na Iugu para cada dia
      const gaps = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const nextDateStr = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        try {
          const iuguQuery = `${IUGU_API_BASE_URL}/invoices?created_at_from=${dateStr}&created_at_to=${nextDateStr}&limit=1`;
          const iuguData = await makeRequest(iuguQuery, {
            method: 'GET',
            headers: iuguHeaders,
          });

          const iuguCount = iuguData.totalItems || 0;
          const supabaseCount = supabaseCounts.find((c) => c.date === dateStr)?.count || 0;

          if (iuguCount > supabaseCount) {
            gaps.push({
              date: dateStr,
              iuguCount,
              supabaseCount,
              missing: iuguCount - supabaseCount,
            });
          }

          // Delay para não sobrecarregar a API
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          console.warn(`Erro ao verificar ${dateStr}: ${error.message}`);
        }
      }

      if (gaps.length > 0) {
        this.alerts.push({
          type: 'DATA_GAPS',
          severity: 'warning',
          message: `Encontradas ${gaps.length} lacunas nos dados`,
          details: gaps,
        });
      }

      this.metrics.gapDetection = { gaps, totalGaps: gaps.length };
      return gaps;
    } catch (error) {
      this.alerts.push({
        type: 'GAP_DETECTION_ERROR',
        severity: 'error',
        message: `Erro ao detectar lacunas: ${error.message}`,
      });
      return [];
    }
  }

  async checkSyncHealth() {
    logWithTimestamp('🔧 VERIFICANDO SAÚDE DA SINCRONIZAÇÃO');

    try {
      const syncLogPath = path.join(__dirname, '..', 'logs', 'sync.log');
      const syncHealth = {
        lastSync: null,
        syncInterval: null,
        errors: [],
        status: 'unknown',
      };

      if (fs.existsSync(syncLogPath)) {
        const logContent = fs.readFileSync(syncLogPath, 'utf8');
        const lines = logContent.split('\n').filter((line) => line.trim());

        // Encontrar última sincronização bem-sucedida
        const successLines = lines.filter((line) => line.includes('SYNC COMPLETED SUCCESSFULLY'));
        if (successLines.length > 0) {
          const lastSuccessLine = successLines[successLines.length - 1];
          const dateMatch = lastSuccessLine.match(
            /(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} [AP]M)/
          );
          if (dateMatch) {
            syncHealth.lastSync = new Date(dateMatch[1]);
            const timeSinceSync = (new Date() - syncHealth.lastSync) / (1000 * 60 * 60);
            syncHealth.syncInterval = timeSinceSync;
            syncHealth.status =
              timeSinceSync < 2 ? 'healthy' : timeSinceSync < 24 ? 'degraded' : 'critical';

            if (timeSinceSync > 2) {
              this.alerts.push({
                type: 'SYNC_DELAY',
                severity: timeSinceSync > 24 ? 'critical' : 'warning',
                message: `Última sincronização há ${timeSinceSync.toFixed(1)}h`,
                details: { lastSync: syncHealth.lastSync, intervalHours: timeSinceSync },
              });
            }
          }
        }

        // Encontrar erros recentes
        const errorLines = lines
          .filter(
            (line) =>
              line.includes('failed') ||
              line.includes('error') ||
              line.includes('Error') ||
              line.includes('invalid input syntax')
          )
          .slice(-10);

        syncHealth.errors = errorLines.map((line) => {
          const dateMatch = line.match(/(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} [AP]M)/);
          return {
            timestamp: dateMatch ? dateMatch[1] : 'unknown',
            message: line,
          };
        });

        if (syncHealth.errors.length > 0) {
          this.alerts.push({
            type: 'SYNC_ERRORS',
            severity: 'error',
            message: `${syncHealth.errors.length} erros recentes de sincronização`,
            details: syncHealth.errors,
          });
        }
      }

      this.metrics.syncHealth = syncHealth;
      return syncHealth;
    } catch (error) {
      this.alerts.push({
        type: 'SYNC_HEALTH_ERROR',
        severity: 'error',
        message: `Erro ao verificar saúde da sincronização: ${error.message}`,
      });
      return null;
    }
  }

  parseIuguDate(dateString) {
    if (!dateString) return null;

    // Se já está em formato ISO, retorna
    if (typeof dateString === 'string' && dateString.includes('T')) {
      return new Date(dateString);
    }

    // Converte formatos da Iugu para Date
    if (typeof dateString === 'string') {
      // Formato: "13/09, 13:49" -> Date
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

    // Fallback
    try {
      return new Date(dateString);
    } catch (err) {
      return null;
    }
  }

  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      alerts: this.alerts,
      metrics: this.metrics,
      summary: {
        totalAlerts: this.alerts.length,
        criticalAlerts: this.alerts.filter((a) => a.severity === 'critical').length,
        warningAlerts: this.alerts.filter((a) => a.severity === 'warning').length,
        errorAlerts: this.alerts.filter((a) => a.severity === 'error').length,
      },
    };

    // Determinar status geral
    if (report.summary.criticalAlerts > 0) {
      report.status = 'critical';
    } else if (report.summary.errorAlerts > 0) {
      report.status = 'error';
    } else if (report.summary.warningAlerts > 0) {
      report.status = 'warning';
    }

    return report;
  }

  async run() {
    logWithTimestamp('🕐 INICIANDO MONITORAMENTO TEMPORAL');
    console.log('=====================================');

    await this.analyzeDataFreshness();
    await this.checkSyncHealth();
    // await this.detectDataGaps(); // Comentado para não sobrecarregar

    const report = this.generateReport();

    console.log('\n📊 RELATÓRIO DE MONITORAMENTO TEMPORAL');
    console.log('======================================');
    console.log(`⏰ Status Geral: ${report.status.toUpperCase()}`);
    console.log(`🚨 Alertas: ${report.summary.totalAlerts} total`);
    console.log(`   🔴 Críticos: ${report.summary.criticalAlerts}`);
    console.log(`   🟡 Avisos: ${report.summary.warningAlerts}`);
    console.log(`   ⚫ Erros: ${report.summary.errorAlerts}`);

    if (this.metrics.dataFreshness) {
      console.log('\n📅 FRESCOR DOS DADOS:');
      console.log(`   Status: ${this.metrics.dataFreshness.status}`);
      if (this.metrics.dataFreshness.gap) {
        console.log(`   Defasagem: ${this.metrics.dataFreshness.gap.toFixed(1)}h`);
      }
    }

    if (this.metrics.syncHealth) {
      console.log('\n🔧 SAÚDE DA SINCRONIZAÇÃO:');
      console.log(`   Status: ${this.metrics.syncHealth.status}`);
      if (this.metrics.syncHealth.lastSync) {
        console.log(`   Última sincronização: ${formatTimeAgo(this.metrics.syncHealth.lastSync)}`);
      }
      if (this.metrics.syncHealth.errors.length > 0) {
        console.log(`   Erros recentes: ${this.metrics.syncHealth.errors.length}`);
      }
    }

    if (this.alerts.length > 0) {
      console.log('\n🚨 ALERTAS DETALHADOS:');
      this.alerts.forEach((alert, index) => {
        console.log(
          `${index + 1}. [${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`
        );
      });
    }

    // Salvar relatório
    const reportPath = path.join(__dirname, '..', 'logs', `temporal_report_${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Relatório salvo em: ${reportPath}`);

    logWithTimestamp('✅ Monitoramento temporal concluído!');

    return report;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const monitor = new TemporalMonitor();
  monitor.run().catch((error) => {
    console.error('❌ Erro no monitoramento:', error);
    process.exit(1);
  });
}

module.exports = TemporalMonitor;
