#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !IUGU_API_TOKEN) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const iuguHeaders = {
  Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
  'Content-Type': 'application/json',
};

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

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

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// Dados reais para validação (benchmark)
const BENCHMARK_DATA = {
  '2025-08': { revenue: 799490, invoices: 574 },
  '2025-07': { revenue: 784646, invoices: 562 },
  '2025-06': { revenue: 747538, invoices: 506 },
  '2025-05': { revenue: 749793, invoices: 517 },
};

class DataReliabilityTests {
  constructor() {
    this.results = {
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        warnings: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  addResult(testName, status, details, threshold = null, actual = null, expected = null) {
    const result = {
      test: testName,
      status, // 'PASS', 'FAIL', 'WARN'
      details,
      threshold,
      actual,
      expected,
      timestamp: new Date().toISOString(),
    };

    this.results.tests.push(result);
    this.results.summary.total++;
    this.results.summary[status.toLowerCase()]++;

    const statusEmoji = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    logWithTimestamp(`${statusEmoji} ${testName}: ${details}`);
  }

  async testDatabaseConnectivity() {
    try {
      const response = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&limit=1`,
        {
          headers: { ...supabaseHeaders, Prefer: 'count=exact' },
        }
      );

      const count = response[0]?.count;
      if (count > 0) {
        this.addResult(
          'Database Connectivity',
          'PASS',
          `Connected successfully. ${count.toLocaleString()} invoices found`
        );
      } else {
        this.addResult('Database Connectivity', 'FAIL', 'Database connected but no data found');
      }
    } catch (err) {
      this.addResult('Database Connectivity', 'FAIL', `Connection failed: ${err.message}`);
    }
  }

  async testDataCompleteness() {
    try {
      // Verificar dados obrigatórios
      const totalInvoices = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count`,
        {
          headers: { ...supabaseHeaders, Prefer: 'count=exact' },
        }
      );

      const withStatus = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&status=not.is.null`,
        {
          headers: { ...supabaseHeaders, Prefer: 'count=exact' },
        }
      );

      const withValues = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&total_cents=not.is.null`,
        {
          headers: { ...supabaseHeaders, Prefer: 'count=exact' },
        }
      );

      const total = totalInvoices[0]?.count || 0;
      const statusCount = withStatus[0]?.count || 0;
      const valueCount = withValues[0]?.count || 0;

      const statusRate = (statusCount / total) * 100;
      const valueRate = (valueCount / total) * 100;

      if (statusRate >= 95 && valueRate >= 95) {
        this.addResult(
          'Data Completeness',
          'PASS',
          `Status: ${statusRate.toFixed(1)}%, Values: ${valueRate.toFixed(1)}%`
        );
      } else if (statusRate >= 85 && valueRate >= 85) {
        this.addResult(
          'Data Completeness',
          'WARN',
          `Status: ${statusRate.toFixed(1)}%, Values: ${valueRate.toFixed(1)}% (below 95%)`
        );
      } else {
        this.addResult(
          'Data Completeness',
          'FAIL',
          `Status: ${statusRate.toFixed(1)}%, Values: ${valueRate.toFixed(1)}% (below 85%)`
        );
      }
    } catch (err) {
      this.addResult('Data Completeness', 'FAIL', `Test failed: ${err.message}`);
    }
  }

  async testDuplicateData() {
    try {
      // Verificar duplicatas por ID
      const allIds = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id&limit=1000`,
        {
          headers: supabaseHeaders,
        }
      );

      const idSet = new Set();
      let duplicates = 0;

      allIds.forEach((invoice) => {
        if (idSet.has(invoice.id)) {
          duplicates++;
        } else {
          idSet.add(invoice.id);
        }
      });

      if (duplicates === 0) {
        this.addResult(
          'Duplicate Detection',
          'PASS',
          `No duplicates found in sample of ${allIds.length} records`
        );
      } else {
        this.addResult(
          'Duplicate Detection',
          'FAIL',
          `${duplicates} duplicates found in sample of ${allIds.length} records`
        );
      }
    } catch (err) {
      this.addResult('Duplicate Detection', 'FAIL', `Test failed: ${err.message}`);
    }
  }

  async testRevenueAccuracy() {
    try {
      for (const [period, benchmark] of Object.entries(BENCHMARK_DATA)) {
        // Buscar dados do período
        const invoices = await makeRequest(
          `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_cents,total_cents&status=eq.paid&paid_at=gte.${period}-01&paid_at=lt.${period.slice(0, 4)}-${String(parseInt(period.slice(-2)) + 1).padStart(2, '0')}-01&limit=1000`,
          { headers: supabaseHeaders }
        );

        const actualRevenue =
          invoices.reduce((sum, inv) => sum + (inv.paid_cents || inv.total_cents || 0), 0) / 100;
        const expectedRevenue = benchmark.revenue;
        const difference = Math.abs(actualRevenue - expectedRevenue);
        const accuracyPercent = 100 - (difference / expectedRevenue) * 100;

        if (accuracyPercent >= 98) {
          this.addResult(
            `Revenue Accuracy ${period}`,
            'PASS',
            `${accuracyPercent.toFixed(1)}% accurate (R$ ${actualRevenue.toLocaleString()} vs R$ ${expectedRevenue.toLocaleString()})`,
            98,
            accuracyPercent,
            expectedRevenue
          );
        } else if (accuracyPercent >= 95) {
          this.addResult(
            `Revenue Accuracy ${period}`,
            'WARN',
            `${accuracyPercent.toFixed(1)}% accurate (below 98%)`,
            98,
            accuracyPercent,
            expectedRevenue
          );
        } else {
          this.addResult(
            `Revenue Accuracy ${period}`,
            'FAIL',
            `${accuracyPercent.toFixed(1)}% accurate (below 95%)`,
            95,
            accuracyPercent,
            expectedRevenue
          );
        }
      }
    } catch (err) {
      this.addResult('Revenue Accuracy', 'FAIL', `Test failed: ${err.message}`);
    }
  }

  async testDataFreshness() {
    try {
      // Verificar se temos dados recentes (últimas 2 horas)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const recentInvoices = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&created_at_iugu=gte.${twoHoursAgo}`,
        { headers: { ...supabaseHeaders, Prefer: 'count=exact' } }
      );

      const recentCount = recentInvoices[0]?.count || 0;

      if (recentCount > 0) {
        this.addResult('Data Freshness', 'PASS', `${recentCount} invoices created in last 2 hours`);
      } else {
        // Verificar se existe checkpoint de sync recente
        try {
          const checkpoint = JSON.parse(fs.readFileSync('hourly_sync_checkpoint.json', 'utf8'));
          const lastSync = new Date(checkpoint.lastSync);
          const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);

          if (hoursSinceSync <= 2) {
            this.addResult(
              'Data Freshness',
              'PASS',
              `Last sync ${hoursSinceSync.toFixed(1)} hours ago`
            );
          } else {
            this.addResult(
              'Data Freshness',
              'WARN',
              `Last sync ${hoursSinceSync.toFixed(1)} hours ago (>2h)`
            );
          }
        } catch {
          this.addResult('Data Freshness', 'WARN', 'No recent data and no sync checkpoint found');
        }
      }
    } catch (err) {
      this.addResult('Data Freshness', 'FAIL', `Test failed: ${err.message}`);
    }
  }

  async testApiConnectivity() {
    try {
      const response = await makeRequest(`${IUGU_API_BASE_URL}/invoices?limit=1`, {
        headers: iuguHeaders,
      });

      if (response && response.items) {
        this.addResult('Iugu API Connectivity', 'PASS', 'API accessible and responding correctly');
      } else {
        this.addResult('Iugu API Connectivity', 'WARN', 'API responding but unexpected format');
      }
    } catch (err) {
      this.addResult('Iugu API Connectivity', 'FAIL', `API connection failed: ${err.message}`);
    }
  }

  async testDataTypes() {
    try {
      // Verificar tipos de dados críticos
      const sample = await makeRequest(
        `${SUPABASE_URL}/rest/v1/iugu_invoices?select=id,total_cents,status,created_at_iugu&limit=100`,
        {
          headers: supabaseHeaders,
        }
      );

      let validTypes = 0;
      let invalidTypes = 0;

      sample.forEach((invoice) => {
        // Verificar se total_cents é número
        if (typeof invoice.total_cents === 'number' || invoice.total_cents === null) {
          validTypes++;
        } else {
          invalidTypes++;
        }

        // Verificar se created_at_iugu é string válida de data
        if (
          typeof invoice.created_at_iugu === 'string' &&
          !isNaN(Date.parse(invoice.created_at_iugu))
        ) {
          validTypes++;
        } else {
          invalidTypes++;
        }
      });

      const typeAccuracy = (validTypes / (validTypes + invalidTypes)) * 100;

      if (typeAccuracy >= 98) {
        this.addResult(
          'Data Types',
          'PASS',
          `${typeAccuracy.toFixed(1)}% of fields have correct types`
        );
      } else if (typeAccuracy >= 95) {
        this.addResult(
          'Data Types',
          'WARN',
          `${typeAccuracy.toFixed(1)}% type accuracy (below 98%)`
        );
      } else {
        this.addResult(
          'Data Types',
          'FAIL',
          `${typeAccuracy.toFixed(1)}% type accuracy (below 95%)`
        );
      }
    } catch (err) {
      this.addResult('Data Types', 'FAIL', `Test failed: ${err.message}`);
    }
  }

  async runAllTests() {
    logWithTimestamp('🧪 STARTING DATA RELIABILITY TESTS');
    logWithTimestamp('==================================');

    await this.testDatabaseConnectivity();
    await this.testApiConnectivity();
    await this.testDataCompleteness();
    await this.testDuplicateData();
    await this.testDataTypes();
    await this.testDataFreshness();
    await this.testRevenueAccuracy();

    // Salvar resultados
    fs.writeFileSync('data_reliability_report.json', JSON.stringify(this.results, null, 2));

    // Resumo final
    logWithTimestamp('');
    logWithTimestamp('📊 TEST SUMMARY');
    logWithTimestamp('===============');
    logWithTimestamp(`✅ Passed: ${this.results.summary.passed}`);
    logWithTimestamp(`⚠️  Warnings: ${this.results.summary.warnings}`);
    logWithTimestamp(`❌ Failed: ${this.results.summary.failed}`);
    logWithTimestamp(`📊 Total: ${this.results.summary.total}`);

    const successRate = (this.results.summary.passed / this.results.summary.total) * 100;
    logWithTimestamp(`🎯 Success Rate: ${successRate.toFixed(1)}%`);

    if (successRate >= 90) {
      logWithTimestamp('🎉 SYSTEM RELIABILITY: EXCELLENT');
    } else if (successRate >= 80) {
      logWithTimestamp('⚠️  SYSTEM RELIABILITY: GOOD (some issues)');
    } else {
      logWithTimestamp('❌ SYSTEM RELIABILITY: POOR (needs attention)');
    }

    return this.results;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const tests = new DataReliabilityTests();
  tests
    .runAllTests()
    .then((results) => {
      const hasFailures = results.summary.failed > 0;
      process.exit(hasFailures ? 1 : 0);
    })
    .catch((err) => {
      logWithTimestamp(`💥 Fatal error: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { DataReliabilityTests };
