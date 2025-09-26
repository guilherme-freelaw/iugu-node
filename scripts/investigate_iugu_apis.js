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
        try {
          const result = {
            statusCode: res.statusCode,
            data: JSON.parse(data),
            headers: res.headers,
          };
          resolve(result);
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data: data,
            headers: res.headers,
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        statusCode: 0,
        error: error.message,
      });
    });

    req.end();
  });
}

function logWithTimestamp(message) {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] ${message}`);
}

async function testIuguAPI(endpoint, description) {
  logWithTimestamp(`🔍 Testando: ${description}`);

  try {
    const url = `${IUGU_API_BASE_URL}${endpoint}`;
    console.log(`   URL: ${url}`);

    const result = await makeRequest(url, {
      method: 'GET',
      headers: iuguHeaders,
    });

    if (result.error) {
      console.log(`   ❌ ERRO: ${result.error}`);
      return false;
    }

    if (result.statusCode === 200) {
      const hasItems =
        result.data?.items || result.data?.length > 0 || Object.keys(result.data || {}).length > 0;
      const count =
        result.data?.items?.length || (Array.isArray(result.data) ? result.data.length : 'N/A');

      console.log(`   ✅ OK (${result.statusCode}) - ${count} registros`);

      if (result.data?.items && result.data.items.length > 0) {
        console.log(
          `   📝 Exemplo:`,
          JSON.stringify(result.data.items[0], null, 2).substring(0, 200) + '...'
        );
      }

      return true;
    } else {
      console.log(`   ❌ ERRO: HTTP ${result.statusCode}`);
      console.log(`   📄 Resposta: ${JSON.stringify(result.data).substring(0, 200)}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ EXCEÇÃO: ${error.message}`);
    return false;
  }
}

async function investigateIuguAPIs() {
  logWithTimestamp('🔍 INVESTIGAÇÃO DAS APIs DA IUGU');
  console.log('=======================================');

  const endpoints = [
    // Testados e funcionando
    ['/invoices?limit=5', 'Faturas (funcionando)'],
    ['/customers?limit=5', 'Clientes (funcionando)'],

    // Problemáticos
    ['/plans', 'Planos (problemático)'],
    ['/plans?limit=10', 'Planos com limit'],
    ['/subscriptions?limit=5', 'Assinaturas (funcionando mas com foreign key issues)'],

    // Para testar
    ['/charge', 'Charges (404 na tentativa anterior)'],
    ['/charges', 'Charges (plural)'],
    ['/charges?limit=5', 'Charges com limit'],
    ['/transfers', 'Transferências (vazio na tentativa anterior)'],
    ['/transfers?limit=5', 'Transferências com limit'],

    // Outras possibilidades
    ['/payment_methods', 'Métodos de pagamento (direto)'],
    ['/accounts', 'Contas'],
    ['/marketplace', 'Marketplace'],
    ['/events', 'Eventos'],
    ['/webhook_endpoints', 'Webhook endpoints'],

    // APIs menos comuns mas possíveis
    ['/financial_info', 'Informações financeiras'],
    ['/bank_verification', 'Verificação bancária'],
    ['/withdraw_requests', 'Solicitações de saque'],
    ['/chargebacks', 'Chargebacks'],
    ['/pix', 'PIX'],
  ];

  const results = {};

  for (const [endpoint, description] of endpoints) {
    const success = await testIuguAPI(endpoint, description);
    results[endpoint] = success;

    // Pequeno delay para não sobrecarregar
    await new Promise((resolve) => setTimeout(resolve, 300));
    console.log('');
  }

  console.log('\n📊 RESUMO DOS TESTES:');
  console.log('====================');

  const working = [];
  const failing = [];

  Object.entries(results).forEach(([endpoint, success]) => {
    if (success) {
      working.push(endpoint);
    } else {
      failing.push(endpoint);
    }
  });

  console.log('\n✅ APIs FUNCIONANDO:');
  working.forEach((endpoint) => console.log(`   ${endpoint}`));

  console.log('\n❌ APIs COM PROBLEMA:');
  failing.forEach((endpoint) => console.log(`   ${endpoint}`));

  console.log('\n💡 RECOMENDAÇÕES:');
  console.log('=================');
  console.log('1. Focar nas APIs que funcionam');
  console.log('2. Para planos: extrair plan_id das assinaturas e buscar individualmente');
  console.log('3. Para charges: usar informações das faturas (charges estão dentro das invoices)');
  console.log('4. Para métodos de pagamento: buscar por cliente individual');
  console.log('5. Implementar extração de dados a partir das entidades que funcionam');

  logWithTimestamp('✅ Investigação concluída!');
}

investigateIuguAPIs();
