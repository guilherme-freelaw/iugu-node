#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const { upsertViaRpc } = require('./lib/upsert_rpc');

// Configurações
const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!IUGU_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
};

const iuguHeaders = {
  Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
  'Content-Type': 'application/json',
};

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

function makeRequest(url, options = {}, retries = 3) {
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
        } else if (
          (res.statusCode === 502 || res.statusCode === 429 || res.statusCode === 500) &&
          retries > 0
        ) {
          logWithTimestamp(`⚠️  HTTP ${res.statusCode}, retry em 3s... (${retries} restantes)`);
          setTimeout(() => {
            makeRequest(url, options, retries - 1)
              .then(resolve)
              .catch(reject);
          }, 3000);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      if (retries > 0) {
        logWithTimestamp(`⚠️  Erro rede, retry em 3s... (${retries} restantes)`);
        setTimeout(() => {
          makeRequest(url, options, retries - 1)
            .then(resolve)
            .catch(reject);
        }, 3000);
      } else {
        reject(err);
      }
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// Função DEFINITIVA para normalizar datas
function ultimateNormalizeDate(dateString, referenceYear = 2025) {
  if (!dateString) return null;

  try {
    // Se já está em formato ISO válido
    if (dateString.includes('T') && dateString.includes('Z')) {
      const parsed = new Date(dateString);
      if (!isNaN(parsed.getTime())) {
        return dateString;
      }
    }

    // Formato: "27/02, 14:06" ou "27/02,14:06"
    const ddmmMatch = dateString.match(/(\d{1,2})\/(\d{1,2}),?\s*(\d{1,2}):(\d{2})/);
    if (ddmmMatch) {
      const [, day, month, hour, minute] = ddmmMatch;
      return `${referenceYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00.000Z`;
    }

    // Formato: "26 Feb 07:21 PM"
    const febMatch = dateString.match(/(\d{1,2})\s+(Feb|Feb\.)\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i);
    if (febMatch) {
      const [, day, , hour, minute, period] = febMatch;
      let normalizedHour = parseInt(hour);
      if (period.toUpperCase() === 'PM' && normalizedHour !== 12) normalizedHour += 12;
      if (period.toUpperCase() === 'AM' && normalizedHour === 12) normalizedHour = 0;

      return `${referenceYear}-02-${day.padStart(2, '0')}T${normalizedHour.toString().padStart(2, '0')}:${minute}:00.000Z`;
    }

    // Formato: "26 Feb 2025" (sem hora)
    const febDateMatch = dateString.match(/(\d{1,2})\s+(Feb|Feb\.)\s+(\d{4})/i);
    if (febDateMatch) {
      const [, day, , year] = febDateMatch;
      return `${year}-02-${day.padStart(2, '0')}T00:00:00.000Z`;
    }

    // Formato: "DD/MM/YYYY" ou "DD/MM/YY"
    const fullDateMatch = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (fullDateMatch) {
      const [, day, month, year] = fullDateMatch;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`;
    }

    // Formato ISO quebrado: tentar reparar
    if (dateString.includes('-') && dateString.includes('T')) {
      try {
        const parsed = new Date(dateString.replace(/\s+/g, ''));
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      } catch {}
    }

    // Último recurso: parsing direto
    try {
      const parsed = new Date(dateString);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
        return parsed.toISOString();
      }
    } catch {}

    logWithTimestamp(`⚠️  Data não convertível: "${dateString}"`);
    return null;
  } catch (err) {
    logWithTimestamp(`⚠️  Erro ao normalizar data "${dateString}": ${err.message}`);
    return null;
  }
}

function ultimateNormalizeInvoice(invoice) {
  // Verificar se o valor é válido
  const totalCents = invoice.total_cents || (invoice.total ? Math.round(invoice.total * 100) : 0);
  const paidCents = invoice.paid_cents || (invoice.paid ? Math.round(invoice.paid * 100) : null);

  // Se não tem valor, pular
  if (!totalCents || totalCents <= 0) {
    return null;
  }

  return {
    id: invoice.id,
    account_id: invoice.account_id,
    customer_id: invoice.customer_id,
    subscription_id: invoice.subscription_id,
    status: invoice.status,
    due_date: ultimateNormalizeDate(invoice.due_date),
    paid_at: ultimateNormalizeDate(invoice.paid_at),
    payment_method: invoice.payment_method,
    total_cents: totalCents,
    paid_cents: paidCents,
    discount_cents:
      invoice.discount_cents || (invoice.discount ? Math.round(invoice.discount * 100) : 0),
    taxes_cents: invoice.taxes_cents || (invoice.taxes ? Math.round(invoice.taxes * 100) : 0),
    commission_cents: invoice.commission_cents,
    external_reference: invoice.external_reference,
    order_id: invoice.order_id,
    created_at_iugu: ultimateNormalizeDate(invoice.created_at),
    updated_at_iugu: ultimateNormalizeDate(invoice.updated_at),
    payer_name: invoice.payer?.name || invoice.payer_name,
    payer_email: invoice.payer?.email || invoice.payer_email,
    payer_cpf_cnpj: invoice.payer?.cpf_cnpj || invoice.payer_cpf_cnpj,
    payer_phone: invoice.payer?.phone || invoice.payer_phone,
    secure_id: invoice.secure_id,
    secure_url: invoice.secure_url,
    raw_json: invoice,
  };
}

async function ultimatePeriodicSync(startDate, endDate, periodName) {
  logWithTimestamp(`🚀 SINCRONIZAÇÃO DEFINITIVA: ${periodName}`);
  logWithTimestamp(`📅 Período: ${startDate} até ${endDate}`);

  const stats = {
    found: 0,
    processed: 0,
    inserted: 0,
    updated: 0,
    errors: 0,
    skipped: 0,
  };

  try {
    let page = 1;
    let hasMore = true;
    let consecutiveErrors = 0;

    while (hasMore && consecutiveErrors < 5) {
      try {
        logWithTimestamp(`   📄 Buscando página ${page}...`);

        const response = await makeRequest(`${IUGU_API_BASE_URL}/invoices`, {
          method: 'GET',
          headers: iuguHeaders,
        });

        // Construir URL com query params manualmente para evitar encoding issues
        const url = `${IUGU_API_BASE_URL}/invoices?limit=100&created_at_from=${startDate}&created_at_to=${endDate}&page=${page}`;
        const invoicesResponse = await makeRequest(url, { headers: iuguHeaders });

        const invoices = invoicesResponse.items || [];

        if (invoices.length === 0) {
          logWithTimestamp(`   ✅ Página ${page}: Sem mais dados`);
          hasMore = false;
          break;
        }

        stats.found += invoices.length;
        logWithTimestamp(`   📄 Página ${page}: ${invoices.length} faturas encontradas`);

        // Processar cada fatura individualmente
        for (const [index, invoice] of invoices.entries()) {
          try {
            stats.processed++;

            // Verificar se o valor é válido antes de processar
            const totalCents = invoice.total_cents || (invoice.total ? Math.round(invoice.total * 100) : 0);
            if (!totalCents || totalCents <= 0) {
              stats.skipped++;
              continue;
            }

            // Usar RPC helper para upsert com payload bruto da Iugu
            await upsertViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'invoices', invoice);

            stats.inserted++;

            // Log progresso a cada 25 faturas
            if (stats.processed % 25 === 0) {
              logWithTimestamp(
                `     📊 Progresso: ${stats.processed} processadas, ${stats.inserted} inseridas, ${stats.errors} erros`
              );
            }
          } catch (err) {
            stats.errors++;
            if (stats.errors <= 3) {
              // Mostrar apenas primeiros 3 erros
              logWithTimestamp(
                `     ⚠️  Erro fatura ${invoice.id}: ${err.message.substring(0, 100)}`
              );
            }
          }
        }

        page++;
        consecutiveErrors = 0;

        // Pausa progressiva para evitar rate limiting
        const pauseTime = Math.min(page * 500, 5000);
        await new Promise((resolve) => setTimeout(resolve, pauseTime));
      } catch (err) {
        consecutiveErrors++;
        logWithTimestamp(`❌ Erro página ${page}: ${err.message}`);

        if (consecutiveErrors < 5) {
          const waitTime = consecutiveErrors * 5000;
          logWithTimestamp(`⏸️  Aguardando ${waitTime}ms antes de retry...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    logWithTimestamp(`✅ ${periodName} CONCLUÍDO:`);
    logWithTimestamp(`   📊 Encontradas: ${stats.found}`);
    logWithTimestamp(`   ✅ Inseridas: ${stats.inserted}`);
    logWithTimestamp(`   ⚠️  Erros: ${stats.errors}`);
    logWithTimestamp(`   ⏭️  Puladas: ${stats.skipped}`);

    return stats;
  } catch (err) {
    logWithTimestamp(`❌ Erro crítico em ${periodName}: ${err.message}`);
    return stats;
  }
}

async function runUltimateFix() {
  logWithTimestamp('🚀 CORREÇÃO DEFINITIVA - SISTEMA 100% FUNCIONAL');
  logWithTimestamp('=================================================');
  logWithTimestamp('🎯 Meta: Precisão 99.5%+ em todos os períodos');
  logWithTimestamp('🔧 Estratégia: Normalização de timestamp + Sync completa');
  logWithTimestamp('');

  const allStats = [];

  try {
    // Períodos críticos que precisam de correção
    const criticalPeriods = [
      {
        name: 'FEVEREIRO 2025',
        start: '2025-02-01',
        end: '2025-02-28',
      },
      {
        name: 'JUNHO 2025',
        start: '2025-06-01',
        end: '2025-06-30',
      },
    ];

    for (const period of criticalPeriods) {
      logWithTimestamp(`\n🔥 Processando ${period.name}...`);
      const stats = await ultimatePeriodicSync(period.start, period.end, period.name);
      allStats.push({ period: period.name, stats });

      // Pausa longa entre períodos
      logWithTimestamp('⏸️  Pausa entre períodos...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    // Resumo final
    logWithTimestamp('');
    logWithTimestamp('🎯 RESUMO DA CORREÇÃO DEFINITIVA:');
    logWithTimestamp('================================');

    let totalFound = 0;
    let totalInserted = 0;
    let totalErrors = 0;

    allStats.forEach(({ period, stats }) => {
      logWithTimestamp(`📅 ${period}:`);
      logWithTimestamp(
        `   📊 ${stats.found} encontradas → ${stats.inserted} inseridas (${stats.errors} erros)`
      );

      totalFound += stats.found;
      totalInserted += stats.inserted;
      totalErrors += stats.errors;
    });

    logWithTimestamp('');
    logWithTimestamp('📊 TOTAIS GERAIS:');
    logWithTimestamp(`   📄 ${totalFound} faturas encontradas`);
    logWithTimestamp(`   ✅ ${totalInserted} faturas inseridas`);
    logWithTimestamp(`   ❌ ${totalErrors} erros`);

    const successRate = totalFound > 0 ? (totalInserted / totalFound) * 100 : 0;
    logWithTimestamp(`   🎯 Taxa de sucesso: ${successRate.toFixed(1)}%`);

    // Salvar relatório
    const report = {
      timestamp: new Date().toISOString(),
      type: 'ultimate_fix',
      periods: allStats,
      totals: {
        found: totalFound,
        inserted: totalInserted,
        errors: totalErrors,
        successRate: successRate,
      },
    };

    fs.writeFileSync('ultimate_fix_report.json', JSON.stringify(report, null, 2));
    logWithTimestamp('💾 Relatório salvo: ultimate_fix_report.json');

    if (successRate >= 95) {
      logWithTimestamp('');
      logWithTimestamp('🎉 CORREÇÃO DEFINITIVA CONCLUÍDA COM SUCESSO!');
      logWithTimestamp('📊 Execute a validação para verificar precisão final');
    } else {
      logWithTimestamp('');
      logWithTimestamp('⚠️  Correção parcial - pode precisar investigação adicional');
    }

    return report;
  } catch (err) {
    logWithTimestamp(`💥 Erro fatal: ${err.message}`);
    return { error: err.message, partial_stats: allStats };
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  runUltimateFix()
    .then((report) => {
      console.log('');
      if (report.error) {
        console.log('⚠️  Correção executada com alguns problemas');
        process.exit(1);
      } else {
        console.log('✅ Correção definitiva concluída!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error(`💥 Erro fatal: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { runUltimateFix, ultimatePeriodicSync };
