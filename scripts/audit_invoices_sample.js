#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar definidos no .env');
  process.exit(1);
}

async function getInvoicesForAudit() {
  console.log('📊 Buscando faturas para auditoria...\n');

  try {
    // 1. Buscar as últimas 50 faturas ordenadas por data de criação
    console.log('1️⃣ Buscando últimas 50 faturas...');
    const invoicesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/iugu_invoices?select=*&order=created_at_iugu.desc&limit=50`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        }
      }
    );

    if (!invoicesRes.ok) {
      const error = await invoicesRes.text();
      throw new Error(`Erro ao buscar faturas: ${invoicesRes.status} - ${error}`);
    }

    const allInvoices = await invoicesRes.json();
    console.log(`   ✅ ${allInvoices.length} faturas encontradas\n`);

    if (allInvoices.length === 0) {
      console.log('⚠️ Nenhuma fatura encontrada no banco de dados.');
      return;
    }

    // 2. Selecionar 10 faturas aleatórias (ou menos se houver menos de 10)
    const sampleSize = Math.min(10, allInvoices.length);
    const shuffled = [...allInvoices].sort(() => 0.5 - Math.random());
    const selectedInvoices = shuffled.slice(0, sampleSize);

    console.log(`2️⃣ Selecionadas ${sampleSize} faturas para auditoria\n`);

    // 3. Buscar dados dos clientes para as faturas selecionadas
    console.log('3️⃣ Buscando dados dos clientes...\n');

    const customerIds = [...new Set(selectedInvoices.map(inv => inv.customer_id).filter(Boolean))];

    let customersMap = {};
    if (customerIds.length > 0) {
      const customersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/iugu_customers?select=*&id=in.(${customerIds.join(',')})`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          }
        }
      );

      if (customersRes.ok) {
        const customers = await customersRes.json();
        customersMap = customers.reduce((acc, customer) => {
          acc[customer.id] = customer;
          return acc;
        }, {});
        console.log(`   ✅ ${customers.length} clientes encontrados\n`);
      }
    }

    // 4. Formatar e exibir resultados para auditoria
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('                     📋 RELATÓRIO DE AUDITORIA DE FATURAS');
    console.log('═══════════════════════════════════════════════════════════════════════\n');

    selectedInvoices.forEach((invoice, index) => {
      const customer = customersMap[invoice.customer_id] || {};
      const totalBRL = (invoice.total_cents || 0) / 100;
      const paidBRL = (invoice.paid_cents || 0) / 100;

      console.log(`┌─ FATURA ${index + 1} de ${sampleSize} ` + '─'.repeat(60));
      console.log(`│`);
      console.log(`│ 🆔 ID da Fatura: ${invoice.id || 'N/A'}`);
      console.log(`│ 📅 Data de Criação (Iugu): ${invoice.created_at_iugu || 'N/A'}`);
      console.log(`│ 📅 Data de Vencimento: ${invoice.due_date || 'N/A'}`);
      console.log(`│ 📅 Data de Pagamento: ${invoice.paid_at || 'N/A'}`);
      console.log(`│ 📊 Status: ${invoice.status || 'N/A'}`);
      console.log(`│ 💳 Método de Pagamento: ${invoice.payment_method || 'N/A'}`);
      console.log(`│`);
      console.log(`│ 💰 VALORES:`);
      console.log(`│    • Total: R$ ${totalBRL.toFixed(2)}`);
      console.log(`│    • Pago: R$ ${paidBRL.toFixed(2)}`);
      console.log(`│    • Total (centavos): ${invoice.total_cents || 0}`);
      console.log(`│    • Pago (centavos): ${invoice.paid_cents || 0}`);
      console.log(`│`);
      console.log(`│ 👤 CLIENTE:`);
      console.log(`│    • ID: ${invoice.customer_id || 'N/A'}`);
      console.log(`│    • Nome: ${customer.name || 'N/A'}`);
      console.log(`│    • Email: ${customer.email || 'N/A'}`);
      console.log(`│    • CPF/CNPJ: ${customer.cpf_cnpj || 'N/A'}`);

      if (invoice.raw_json && invoice.raw_json.items && Array.isArray(invoice.raw_json.items) && invoice.raw_json.items.length > 0) {
        console.log(`│`);
        console.log(`│ 📦 ITENS (${invoice.raw_json.items.length}):`);
        invoice.raw_json.items.forEach((item, idx) => {
          const itemValue = (item.price_cents || 0) / 100;
          console.log(`│    ${idx + 1}. ${item.description || 'Sem descrição'}`);
          console.log(`│       Qtd: ${item.quantity || 1} x R$ ${itemValue.toFixed(2)}`);
        });
      }

      if (invoice.raw_json && invoice.raw_json.payer) {
        console.log(`│`);
        console.log(`│ 💳 PAGADOR:`);
        console.log(`│    • Nome: ${invoice.raw_json.payer.name || 'N/A'}`);
        console.log(`│    • CPF/CNPJ: ${invoice.raw_json.payer.cpf_cnpj || 'N/A'}`);
      }

      if (invoice.subscription_id) {
        console.log(`│`);
        console.log(`│ 🔄 Assinatura: ${invoice.subscription_id}`);
      }

      if (invoice.external_reference || invoice.order_id) {
        console.log(`│`);
        console.log(`│ 🔗 REFERÊNCIAS EXTERNAS:`);
        if (invoice.external_reference) console.log(`│    • Ref Externa: ${invoice.external_reference}`);
        if (invoice.order_id) console.log(`│    • Order ID: ${invoice.order_id}`);
      }

      console.log(`│`);
      console.log(`└${'─'.repeat(75)}\n`);
    });

    // 5. Resumo estatístico
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('                         📈 RESUMO ESTATÍSTICO');
    console.log('═══════════════════════════════════════════════════════════════════════\n');

    const totalSum = selectedInvoices.reduce((sum, inv) => sum + (inv.total_cents || 0), 0) / 100;
    const paidSum = selectedInvoices.reduce((sum, inv) => sum + (inv.paid_cents || 0), 0) / 100;

    const statusCounts = selectedInvoices.reduce((acc, inv) => {
      const status = inv.status || 'undefined';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    console.log(`💰 Valor Total da Amostra: R$ ${totalSum.toFixed(2)}`);
    console.log(`💵 Valor Pago da Amostra: R$ ${paidSum.toFixed(2)}`);
    console.log(`📊 Distribuição por Status:`);
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   • ${status}: ${count} fatura(s)`);
    });

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(`✅ Relatório de auditoria gerado com sucesso!`);
    console.log(`📅 Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
    console.log('═══════════════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Erro ao gerar relatório de auditoria:', error.message);
    process.exit(1);
  }
}

getInvoicesForAudit().catch(console.error);
