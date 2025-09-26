#!/usr/bin/env node

const https = require('https');

// Configurações
const IUGU_API_TOKEN =
  process.env.IUGU_API_TOKEN || '9225D1D7C8065F541CDDD73D9B9AFD4BEF07F815ACA09519530DDD8568F0C0D2';
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';

const iuguHeaders = {
  Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
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

async function checkRecentActivity() {
  logWithTimestamp('🔍 VERIFICANDO ATIVIDADE RECENTE NA IUGU');
  console.log('===============================================');

  try {
    // Verificar faturas dos últimos dias
    const startDate = '2025-09-12';
    const endDate = '2025-09-15';

    logWithTimestamp(`📅 Buscando atividades entre ${startDate} e ${endDate}`);

    // 1. Verificar faturas criadas recentemente
    const invoicesUrl = `${IUGU_API_BASE_URL}/invoices?limit=100&created_at_from=${startDate}&created_at_to=${endDate}&sortBy=created_at&sortType=desc`;
    logWithTimestamp(`🔗 URL: ${invoicesUrl}`);

    const recentInvoices = await makeRequest(invoicesUrl, {
      method: 'GET',
      headers: iuguHeaders,
    });

    logWithTimestamp(
      `📊 Encontradas ${recentInvoices.totalItems || recentInvoices.items?.length || 0} faturas`
    );

    if (recentInvoices.items && recentInvoices.items.length > 0) {
      console.log('\n📋 FATURAS RECENTES (primeiras 10):');
      console.log('=====================================');

      recentInvoices.items.slice(0, 10).forEach((invoice, index) => {
        console.log(`${index + 1}. ID: ${invoice.id}`);
        console.log(`   📅 Criada: ${invoice.created_at}`);
        console.log(`   💰 Status: ${invoice.status}`);
        console.log(`   💵 Valor: R$ ${(invoice.total_cents / 100).toFixed(2)}`);
        if (invoice.paid_at) {
          console.log(`   ✅ Paga em: ${invoice.paid_at}`);
        }
        console.log('');
      });
    }

    // 2. Verificar faturas pagas recentemente
    const paidInvoicesUrl = `${IUGU_API_BASE_URL}/invoices?limit=50&status=paid&sortBy=paid_at&sortType=desc`;
    logWithTimestamp(`🔗 Buscando faturas pagas recentemente...`);

    const paidInvoices = await makeRequest(paidInvoicesUrl, {
      method: 'GET',
      headers: iuguHeaders,
    });

    console.log('\n💳 FATURAS PAGAS RECENTEMENTE (primeiras 5):');
    console.log('=============================================');

    if (paidInvoices.items && paidInvoices.items.length > 0) {
      paidInvoices.items.slice(0, 5).forEach((invoice, index) => {
        console.log(`${index + 1}. ID: ${invoice.id}`);
        console.log(`   💰 Paga em: ${invoice.paid_at}`);
        console.log(`   💵 Valor: R$ ${(invoice.total_cents / 100).toFixed(2)}`);
        console.log(`   📅 Criada: ${invoice.created_at}`);
        console.log('');
      });
    }

    // 3. Verificar clientes recentes
    const customersUrl = `${IUGU_API_BASE_URL}/customers?limit=20&created_at_from=${startDate}`;
    const recentCustomers = await makeRequest(customersUrl, {
      method: 'GET',
      headers: iuguHeaders,
    });

    logWithTimestamp(
      `👥 Encontrados ${recentCustomers.totalItems || recentCustomers.items?.length || 0} clientes novos`
    );

    // 4. Verificar assinaturas recentes
    const subscriptionsUrl = `${IUGU_API_BASE_URL}/subscriptions?limit=20&created_at_from=${startDate}`;
    const recentSubscriptions = await makeRequest(subscriptionsUrl, {
      method: 'GET',
      headers: iuguHeaders,
    });

    logWithTimestamp(
      `📋 Encontradas ${recentSubscriptions.totalItems || recentSubscriptions.items?.length || 0} assinaturas novas`
    );

    console.log('\n📊 RESUMO DA ATIVIDADE RECENTE:');
    console.log('===============================');
    console.log(
      `📄 Faturas criadas: ${recentInvoices.totalItems || recentInvoices.items?.length || 0}`
    );
    console.log(`💳 Faturas pagas: ${paidInvoices.totalItems || paidInvoices.items?.length || 0}`);
    console.log(
      `👥 Clientes novos: ${recentCustomers.totalItems || recentCustomers.items?.length || 0}`
    );
    console.log(
      `📋 Assinaturas novas: ${recentSubscriptions.totalItems || recentSubscriptions.items?.length || 0}`
    );

    logWithTimestamp('✅ Verificação concluída!');
  } catch (error) {
    logWithTimestamp(`❌ Erro: ${error.message}`);
    process.exit(1);
  }
}

checkRecentActivity();
