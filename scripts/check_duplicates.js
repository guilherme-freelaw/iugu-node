#!/usr/bin/env node

const https = require('https');

function makeRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve({
                data: JSON.parse(data),
                headers: res.headers,
              });
            } catch (e) {
              resolve({
                data: data,
                headers: res.headers,
              });
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function checkDuplicates() {
  const baseUrl = 'https://hewtomsegvpccldrcqjo.supabase.co/rest/v1/iugu_invoices';
  const headers = {
    Authorization:
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI',
    apikey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI',
    Prefer: 'count=exact',
  };

  try {
    console.log('🔍 VERIFICAÇÃO DE DUPLICATAS');
    console.log('============================');

    // 1. Count total records
    console.log('📊 Contando registros totais...');
    const countResponse = await makeRequest(baseUrl + '?select=count', headers);
    const totalCount = parseInt(countResponse.headers['content-range'].split('/')[1]);
    console.log(`Total de registros: ${totalCount}`);

    // 2. Sample check for duplicates
    console.log('📋 Verificando amostra de 1000 registros...');
    const sampleResponse = await makeRequest(baseUrl + '?select=id&limit=1000', headers);
    const invoices = sampleResponse.data;

    const uniqueIds = new Set(invoices.map((inv) => inv.id));
    const sampleSize = invoices.length;
    const uniqueCount = uniqueIds.size;
    const duplicatesInSample = sampleSize - uniqueCount;

    console.log(`Amostra: ${sampleSize} registros`);
    console.log(`IDs únicos: ${uniqueCount}`);
    console.log(`Duplicatas: ${duplicatesInSample}`);

    // 3. Check for specific duplicates
    if (duplicatesInSample > 0) {
      console.log('❌ DUPLICATAS DETECTADAS!');

      // Find which IDs are duplicated
      const idCounts = {};
      invoices.forEach((inv) => {
        idCounts[inv.id] = (idCounts[inv.id] || 0) + 1;
      });

      const duplicatedIds = Object.entries(idCounts)
        .filter(([id, count]) => count > 1)
        .slice(0, 5); // Show first 5 duplicated IDs

      console.log('🔍 Primeiros IDs duplicados:');
      duplicatedIds.forEach(([id, count]) => {
        console.log(`  ID: ${id} (${count} vezes)`);
      });
    } else {
      console.log('✅ SEM DUPLICATAS na amostra!');
    }

    // 4. Check recent insertions for patterns
    console.log('📅 Verificando inserções recentes...');
    const recentResponse = await makeRequest(
      baseUrl + '?select=id,created_at&order=created_at.desc&limit=100',
      headers
    );
    const recentInvoices = recentResponse.data;

    const recentIds = new Set(recentInvoices.map((inv) => inv.id));
    const recentDuplicates = recentInvoices.length - recentIds.size;

    console.log(`Últimas 100 inserções: ${recentDuplicates} duplicatas`);

    // 5. Summary
    console.log('\n📋 RESUMO:');
    console.log('==========');
    console.log(`Total de registros: ${totalCount}`);
    console.log(`Duplicatas na amostra: ${duplicatesInSample}/${sampleSize}`);
    console.log(`Duplicatas recentes: ${recentDuplicates}/100`);

    if (duplicatesInSample === 0 && recentDuplicates === 0) {
      console.log('🎉 BANCO LIMPO - Sem duplicatas detectadas!');
      console.log('✅ O processo está funcionando corretamente!');
    } else {
      console.log('⚠️  ATENÇÃO - Duplicatas detectadas!');
      console.log('🔧 Revisar lógica de upsert necessária.');
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

checkDuplicates();
