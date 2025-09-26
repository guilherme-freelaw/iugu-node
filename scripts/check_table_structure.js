#!/usr/bin/env node

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL;

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

async function checkStructure() {
  console.log('🔍 VERIFICANDO ESTRUTURA DA TABELA E API IUGU');
  console.log('============================================');

  try {
    // 1. Verificar campos existentes na tabela
    console.log('1. 📊 CAMPOS NA TABELA SUPABASE:');
    const sample = await makeRequest(`${SUPABASE_URL}/rest/v1/iugu_invoices?select=*&limit=1`, {
      headers: supabaseHeaders,
    });

    if (sample && sample.length > 0) {
      console.log('✅ Campos disponíveis:');
      Object.keys(sample[0]).forEach((field) => {
        console.log(`   • ${field}: ${typeof sample[0][field]} = ${sample[0][field]}`);
      });
    }

    // 2. Verificar API Iugu
    console.log('\n2. 🔌 VERIFICANDO API IUGU:');
    if (sample && sample.length > 0) {
      const invoiceId = sample[0].id;
      console.log(`📋 Consultando fatura ${invoiceId}...`);

      const iuguHeaders = {
        Authorization: `Basic ${Buffer.from(IUGU_API_TOKEN + ':').toString('base64')}`,
      };

      try {
        const iuguData = await makeRequest(`${IUGU_API_BASE_URL}/invoices/${invoiceId}`, {
          headers: iuguHeaders,
        });

        console.log('✅ Dados da API Iugu:');
        console.log('📄 Campos relacionados a taxas/valores:');
        Object.keys(iuguData).forEach((key) => {
          const value = iuguData[key];
          if (
            key.includes('tax') ||
            key.includes('fee') ||
            key.includes('commission') ||
            key.includes('rate') ||
            key.includes('discount') ||
            key.includes('total') ||
            key.includes('paid') ||
            key.includes('cents')
          ) {
            console.log(`   • ${key}: ${value} (${typeof value})`);
          }
        });

        console.log('\n🔍 TODOS OS CAMPOS DA API:');
        Object.keys(iuguData)
          .sort()
          .forEach((key) => {
            console.log(`   • ${key}: ${JSON.stringify(iuguData[key])}`);
          });
      } catch (apiErr) {
        console.log(`❌ Erro API Iugu: ${apiErr.message}`);
      }
    }
  } catch (err) {
    console.error(`❌ Erro: ${err.message}`);
  }
}

checkStructure()
  .then(() => {
    console.log('\n✅ Verificação concluída!');
    process.exit(0);
  })
  .catch((err) => {
    console.error(`💥 Erro: ${err.message}`);
    process.exit(1);
  });
