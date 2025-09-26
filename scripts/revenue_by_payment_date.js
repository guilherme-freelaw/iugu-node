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

async function analyzeByPaymentDate() {
  console.log('📅 ANÁLISE POR DATA DE PAGAMENTO (CONCILIAÇÃO BANCÁRIA)');
  console.log('======================================================');
  console.log('🎯 Simulando critério da planilha: receita por mês de recebimento\n');

  try {
    // Buscar faturas com data de pagamento
    console.log('🔄 Buscando faturas com paid_at definido...');
    const paidInvoices = await makeRequest(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=paid_at,total_cents,paid_cents,status&status=eq.paid&paid_at=not.is.null&limit=5000`
    );

    console.log(`📊 Faturas pagas com data: ${paidInvoices.length}\n`);

    if (paidInvoices.length === 0) {
      console.log('❌ PROBLEMA: Nenhuma fatura tem paid_at preenchido!');
      console.log('💡 ISSO EXPLICA A DISCREPÂNCIA!');
      console.log('🔧 SOLUÇÃO: Sistema precisa capturar paid_at da API Iugu');
      return;
    }

    // Agrupar por mês de pagamento
    const revenueByPaymentMonth = {};

    paidInvoices.forEach((inv) => {
      const paymentDate = new Date(inv.paid_at);
      const month = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;

      if (!revenueByPaymentMonth[month]) {
        revenueByPaymentMonth[month] = {
          count: 0,
          totalRevenue: 0,
          paidRevenue: 0,
        };
      }

      revenueByPaymentMonth[month].count++;
      revenueByPaymentMonth[month].totalRevenue += inv.total_cents || 0;
      revenueByPaymentMonth[month].paidRevenue += inv.paid_cents || inv.total_cents || 0;
    });

    console.log('💰 RECEITA POR MÊS DE PAGAMENTO:');
    console.log('-'.repeat(60));

    Object.entries(revenueByPaymentMonth)
      .sort(([a], [b]) => b.localeCompare(a))
      .forEach(([month, data]) => {
        const revenue = (data.paidRevenue / 100).toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
        });
        console.log(`${month}: ${data.count} faturas | R$ ${revenue}`);
      });
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

analyzeByPaymentDate();
