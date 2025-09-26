#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = 'https://hewtomsegvpccldrcqjo.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI';

function makeRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const fullHeaders = {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...headers,
    };

    const req = https.request(url, { method: 'GET', headers: fullHeaders }, (res) => {
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

async function debug2025Data() {
  console.log('🔍 DEBUG - ANÁLISE DOS DADOS 2025');
  console.log('==================================');

  try {
    // 1. Total geral 2025
    console.log('📊 TOTAIS GERAIS:');
    const total2025 = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&created_at_iugu=gte.2025-01-01&created_at_iugu=lt.2026-01-01`,
      { Prefer: 'count=exact' }
    );
    console.log(`Total de faturas 2025: ${total2025[0]?.count || 'N/A'}`);

    // 2. Faturas com dados completos
    const completeData = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&created_at_iugu=gte.2025-01-01&created_at_iugu=lt.2026-01-01&status=not.is.null&total_cents=not.is.null`,
      { Prefer: 'count=exact' }
    );
    console.log(`Com dados completos: ${completeData[0]?.count || 'N/A'}`);

    // 3. Faturas com dados incompletos
    const incompleteData = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=count&created_at_iugu=gte.2025-01-01&created_at_iugu=lt.2026-01-01&or=(status.is.null,total_cents.is.null)`,
      { Prefer: 'count=exact' }
    );
    console.log(`Com dados incompletos: ${incompleteData[0]?.count || 'N/A'}`);

    // 4. Amostra de dados completos
    console.log('\\n🔍 AMOSTRA DE DADOS COMPLETOS:');
    const sampleComplete = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=created_at_iugu,status,total_cents&created_at_iugu=gte.2025-01-01&created_at_iugu=lt.2026-01-01&status=not.is.null&total_cents=not.is.null&limit=10`
    );

    if (sampleComplete.length > 0) {
      sampleComplete.forEach((inv, i) => {
        const date = new Date(inv.created_at_iugu).toLocaleDateString('pt-BR');
        const value = (inv.total_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        console.log(`${i + 1}. ${date} | ${inv.status} | R$ ${value}`);
      });
    } else {
      console.log('Nenhuma fatura com dados completos encontrada!');
    }

    // 5. Amostra de dados incompletos
    console.log('\\n⚠️  AMOSTRA DE DADOS INCOMPLETOS:');
    const sampleIncomplete = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=created_at_iugu,status,total_cents,id&created_at_iugu=gte.2025-01-01&created_at_iugu=lt.2026-01-01&or=(status.is.null,total_cents.is.null)&limit=5`
    );

    sampleIncomplete.forEach((inv, i) => {
      const date = inv.created_at_iugu
        ? new Date(inv.created_at_iugu).toLocaleDateString('pt-BR')
        : 'N/A';
      console.log(
        `${i + 1}. ID: ${inv.id?.substring(0, 12)}... | Data: ${date} | Status: ${inv.status || 'NULL'} | Valor: ${inv.total_cents || 'NULL'}`
      );
    });

    // 6. Análise por mês (apenas dados completos)
    console.log('\\n📅 ANÁLISE POR MÊS (DADOS COMPLETOS):');
    const monthlyComplete = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=created_at_iugu,status,total_cents&created_at_iugu=gte.2025-01-01&created_at_iugu=lt.2026-01-01&status=not.is.null&total_cents=not.is.null&limit=2000`
    );

    const monthlyData = {};
    monthlyComplete.forEach((inv) => {
      const month = inv.created_at_iugu.substring(0, 7);
      if (!monthlyData[month]) {
        monthlyData[month] = { total: 0, paid: 0, revenue: 0 };
      }
      monthlyData[month].total++;
      if (inv.status === 'paid') {
        monthlyData[month].paid++;
        monthlyData[month].revenue += inv.total_cents || 0;
      }
    });

    Object.entries(monthlyData)
      .sort(([a], [b]) => b.localeCompare(a))
      .forEach(([month, data]) => {
        const revenue = (data.revenue / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        console.log(`${month}: ${data.total} faturas | ${data.paid} pagas | R$ ${revenue}`);
      });

    // 7. Análise do problema
    console.log('\\n🔧 DIAGNÓSTICO:');
    const totalComplete = Object.values(monthlyData).reduce((sum, data) => sum + data.total, 0);
    const totalIncomplete = incompleteData[0]?.count || 0;

    console.log(`📊 Faturas com dados COMPLETOS: ${totalComplete}`);
    console.log(`⚠️  Faturas com dados INCOMPLETOS: ${totalIncomplete}`);
    console.log(
      `📈 Percentual completo: ${((totalComplete / (totalComplete + totalIncomplete)) * 100).toFixed(1)}%`
    );

    if (totalIncomplete > totalComplete) {
      console.log('\\n❌ PROBLEMA IDENTIFICADO:');
      console.log('🔍 A maioria das faturas tem dados incompletos (status/total_cents nulos)');
      console.log('💡 CAUSA: Processo de importação ainda em andamento');
      console.log('✅ SOLUÇÃO: Aguardar conclusão do backfill para dados completos');
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

debug2025Data();
