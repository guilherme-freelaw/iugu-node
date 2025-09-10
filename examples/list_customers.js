require('dotenv').config();

// examples/list_customers.js
// Usa process.env.IUGU_API_KEY (NÃO cole a chave no código)
var iugu = require('iugu')(process.env.IUGU_API_KEY);

// Lista clientes
iugu.customers.list().then(function(customers){
  console.log(JSON.stringify(customers, null, 2));
}).catch(function(err){
  console.error('Erro:', err);
});
