# Mapeamento Completo - API Iugu → Supabase

## Endpoints Principais da API Iugu

### 🏢 **CORE ENTITIES**
- `GET /customers` → `iugu_customers` ✅
- `GET /invoices` → `iugu_invoices` ✅  
- `GET /subscriptions` → `iugu_subscriptions` ✅
- `GET /plans` → `iugu_plans` ✅
- `GET /customers/:id/payment_methods` → `iugu_payment_methods` ✅

### 💰 **FINANCIAL ENTITIES**
- `GET /transfers` → `iugu_transfers` ❌ (FALTANDO)
- `GET /charges` → `iugu_charges` ❌ (FALTANDO)
- `GET /payment_tokens` → `iugu_payment_tokens` ❌ (FALTANDO)
- `GET /marketplace` → `iugu_marketplace_transactions` ❌ (FALTANDO)
- `GET /anticipations` → `iugu_anticipations` ❌ (FALTANDO)

### 🏦 **ACCOUNT & VERIFICATION**
- `GET /accounts` → `iugu_accounts` ❌ (FALTANDO)
- `GET /bank_verification` → `iugu_bank_verification` ❌ (FALTANDO)
- `GET /chargebacks` → `iugu_chargebacks` ❌ (FALTANDO)

### 📋 **AUXILIARY ENTITIES**
- `GET /payment_requests` → `iugu_payment_requests` ❌ (FALTANDO)
- `GET /webhooks` → `iugu_webhook_subscriptions` ❌ (FALTANDO)

## Prioridades de Implementação

### **FASE 1 - Core Business (ALTA PRIORIDADE)**
1. `iugu_transfers` - Saques e transferências
2. `iugu_charges` - Cobranças diretas  
3. `iugu_accounts` - Informações da conta

### **FASE 2 - Financial Operations (MÉDIA PRIORIDADE)**
4. `iugu_payment_tokens` - Tokens de pagamento
5. `iugu_chargebacks` - Estornos
6. `iugu_anticipations` - Antecipações

### **FASE 3 - Advanced Features (BAIXA PRIORIDADE)**
7. `iugu_marketplace_transactions` - Marketplace
8. `iugu_bank_verification` - Verificações
9. `iugu_payment_requests` - Solicitações

## Status Atual
- ✅ **Implementado**: 7/15 entidades principais (47%)
- ❌ **Faltando**: 8/15 entidades principais (53%)
- 🎯 **Meta**: 100% das entidades mapeadas e sincronizadas
