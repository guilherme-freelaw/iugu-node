#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function logWithTimestamp(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

function parseIuguDateFixed(dateString) {
  if (!dateString) return null;

  // Se já está em formato ISO, retorna
  if (typeof dateString === 'string' && dateString.includes('T')) {
    return dateString;
  }

  // Converte formatos da Iugu para ISO (versão corrigida)
  if (typeof dateString === 'string') {
    // Formato: "01/07, 13:02" -> "2025-07-01T13:02:00Z"
    const ddmmPattern = /^(\d{1,2})\/(\d{1,2}),\s*(\d{1,2}):(\d{2})$/;
    const ddmmMatch = dateString.match(ddmmPattern);
    if (ddmmMatch) {
      const [, day, month, hour, minute] = ddmmMatch;
      const currentYear = new Date().getFullYear();
      return `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00Z`;
    }

    // Formato: "26 Feb 10:20 PM" -> "2025-02-26T22:20:00Z"
    const monthNamePattern = /^(\d{1,2})\s+(\w{3})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i;
    const monthNameMatch = dateString.match(monthNamePattern);
    if (monthNameMatch) {
      const [, day, monthName, hour, minute, ampm] = monthNameMatch;
      const months = {
        jan: '01',
        feb: '02',
        mar: '03',
        apr: '04',
        may: '05',
        jun: '06',
        jul: '07',
        aug: '08',
        sep: '09',
        oct: '10',
        nov: '11',
        dec: '12',
      };
      const month = months[monthName.toLowerCase()];
      if (month) {
        let hour24 = parseInt(hour);
        if (ampm.toUpperCase() === 'PM' && hour24 !== 12) hour24 += 12;
        if (ampm.toUpperCase() === 'AM' && hour24 === 12) hour24 = 0;

        const currentYear = new Date().getFullYear();
        return `${currentYear}-${month}-${day.padStart(2, '0')}T${hour24.toString().padStart(2, '0')}:${minute}:00Z`;
      }
    }

    // Formato: "2025-09-13" -> "2025-09-13T00:00:00Z"
    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (dateOnlyPattern.test(dateString)) {
      return `${dateString}T00:00:00Z`;
    }
  }

  // Se não conseguir converter, tenta criar data válida ou retorna null
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;

    // Verificar se a data é válida e recente (não no passado distante)
    const year = date.getFullYear();
    if (year < 2020 || year > 2030) {
      logWithTimestamp(`⚠️ Data suspeita ignorada: ${dateString} -> ${year}`);
      return null;
    }

    return date.toISOString();
  } catch (err) {
    logWithTimestamp(`⚠️ Erro ao converter data: ${dateString}`);
    return null;
  }
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

async function updateChargebackDate(chargeback) {
  try {
    if (!chargeback.raw_json) {
      return false;
    }

    const raw =
      typeof chargeback.raw_json === 'string'
        ? JSON.parse(chargeback.raw_json)
        : chargeback.raw_json;

    // Extrair datas do raw_json
    const createdAt = parseIuguDateFixed(raw.created_at);
    const updatedAt = parseIuguDateFixed(raw.updated_at);
    const dueDate = parseIuguDateFixed(raw.due_date);

    // Verificar se temos pelo menos uma data válida
    if (!createdAt && !updatedAt && !dueDate) {
      return false;
    }

    // Preparar atualização
    const updateData = {};
    if (createdAt) updateData.created_at_iugu = createdAt;
    if (updatedAt) updateData.updated_at_iugu = updatedAt;
    if (dueDate) updateData.due_date = dueDate;

    // Atualizar no Supabase
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/iugu_chargebacks?id=eq.${chargeback.id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(updateData),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Update failed: ${response.status} - ${errorText}`);
    }

    return true;
  } catch (error) {
    logWithTimestamp(`❌ Erro ao atualizar ${chargeback.id}: ${error.message}`);
    return false;
  }
}

async function fixChargebackDates() {
  logWithTimestamp('🔧 Corrigindo datas dos chargebacks...');

  let totalProcessed = 0;
  let totalFixed = 0;
  let page = 0;
  const limit = 100;

  try {
    while (true) {
      const offset = page * limit;

      // Buscar chargebacks com problemas de data
      const chargebacks = await makeSupabaseRequest(
        `iugu_chargebacks?select=id,created_at_iugu,updated_at_iugu,due_date,raw_json&order=created_at.desc&limit=${limit}&offset=${offset}`
      );

      if (chargebacks.length === 0) {
        break;
      }

      logWithTimestamp(`📋 Processando página ${page + 1}: ${chargebacks.length} chargebacks`);

      for (const chargeback of chargebacks) {
        totalProcessed++;

        // Verificar se precisa de correção
        const hasInvalidDate =
          !chargeback.created_at_iugu ||
          chargeback.created_at_iugu.includes('2001') ||
          chargeback.created_at_iugu.includes('2000');

        if (hasInvalidDate && chargeback.raw_json) {
          const success = await updateChargebackDate(chargeback);
          if (success) {
            totalFixed++;
            if (totalFixed % 10 === 0) {
              logWithTimestamp(`   ✅ ${totalFixed} chargebacks corrigidos até agora...`);
            }
          }
        }
      }

      page++;

      // Limite de segurança
      if (page > 50) {
        logWithTimestamp('⚠️ Limite de páginas atingido (segurança)');
        break;
      }
    }

    logWithTimestamp('');
    logWithTimestamp('📊 RESUMO DA CORREÇÃO:');
    logWithTimestamp('═'.repeat(40));
    logWithTimestamp(`📋 Total processado: ${totalProcessed} chargebacks`);
    logWithTimestamp(`✅ Total corrigido: ${totalFixed} chargebacks`);
    logWithTimestamp(`📈 Taxa de correção: ${((totalFixed / totalProcessed) * 100).toFixed(1)}%`);
  } catch (error) {
    logWithTimestamp(`❌ Erro na correção: ${error.message}`);
  }

  return { totalProcessed, totalFixed };
}

// Executar se chamado diretamente
if (require.main === module) {
  fixChargebackDates()
    .then((results) => {
      logWithTimestamp(`✅ Correção concluída! ${results.totalFixed} chargebacks corrigidos.`);
      process.exit(0);
    })
    .catch((error) => {
      logWithTimestamp(`💥 Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { fixChargebackDates, parseIuguDateFixed };
