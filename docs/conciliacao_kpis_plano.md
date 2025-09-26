## Plano de Conciliação de KPIs e Regras de Negócio

Este documento descreve como validaremos, conciliaremos e monitoraremos os números financeiros e operacionais obtidos da Iugu no data lake (Supabase). O objetivo é ter confiança de que as consultas refletem as regras de negócio acordadas e que divergências sejam detectadas cedo.

### Objetivos
- Garantir consistência entre: receita caixa, competência, refunds, taxas, assinaturas, faturas, clientes e saldos (available/receivable).
- Formalizar regras de negócio e janelas temporais por KPI.
- Implantar checagens automatizadas (CI/Actions) com relatórios mensais e alertas.

### Fontes Principais
- Tabelas: `iugu_invoices`, `iugu_subscriptions`, `iugu_customers`, `iugu_chargebacks`, `iugu_transfers`, `iugu_account_balances`.
- Views e RPCs: `kpi_daily_volume`, `kpi_total_subscribers`, `kpi_total_balance`, `kpi_daily_chargebacks`, `kpi_daily_in_transit_balance`, `get_current_balances`, `get_monthly_received`, `get_previous_month_received`, `get_monthly_refunds`.

### Regras Temporais
- Caixa (receita recebida): janela por `paid_at` em timezone America/Sao_Paulo, `status in ('paid','partially_paid')`.
- Competência (emissão/vencimento): janela por `due_date` (ou `created_at_iugu` quando aplicável a contagens).
- Refunds: `status='refunded'` por `paid_at` (valor negativo = `-total_cents`).
- Exclusão de testes: ids `test_inv`, `test_%`, `%teste%`.

### Hipóteses e Decisões Pendentes
- Painel pode usar competência para boletos e caixa para pix/cartão (regra híbrida).
- Competência “válida” deve excluir `status in ('canceled','expired','pending')`?
- Normalizar `payment_method` nulo a partir de `raw_json`/itens.

### Roadmap de Conciliação
1) Normalização de dados
   - Backfill de `payment_method` em `iugu_invoices` quando nulo.
   - Padronização de códigos (`iugu_pix`, `iugu_credit_card`, `iugu_bank_slip`).
2) Views/Funcs canônicas
   - `kpi_due_competency_valid`: soma de `total_cents` em `due_date` excluindo canceladas/expiradas/pending e testes.
   - `get_monthly_revenue_hybrid(month_date)`: boleto por competência válida; pix/cartão por caixa.
3) Reconciliações mensais (últimos 6-12 meses)
   - Comparar: caixa, competência válida, híbrido, refunds, taxas.
   - Saldos: `available` e `receivable` (snapshots) vs fluxos líquidos no período.
   - Contagens: assinaturas, faturas, clientes por mês e coortes.
4) Alertas e Relatórios
   - GitHub Actions roda mensalmente: gera JSON/CSV e publica no repositório ou envia Slack/email.
   - Tolerâncias: divergências > 1% ou > R$1.000 disparam alerta.

### Checks Específicos (Fórmulas)
- Receita caixa do mês: `sum(paid_cents)` com filtros.
- Receita competência válida do mês: `sum(total_cents where valid_status)` em `due_date`.
- Receita híbrida do mês: `sum(total_cents boleto em due_date válido) + sum(paid_cents pix/cartão em paid_at)`.
- Net após taxas e refunds: `receita_caixa - taxes + refunds_negativos`.
- Saldos: último snapshot do mês por conta para `available/receivable` e variação de `in_transit`.

### Entregáveis
- Migrações SQL com views e funções.
- Scripts Node para validação e reconciliação (já criados: validate_kpis, analyze_method, list_due_not_paid, monthly_reconciliation).
- Relato de divergências e hipóteses confirmadas no README desta pasta.

### Progresso
- [x] Views/RPCs base para caixa e saldos
- [x] Views diárias de chargebacks e in_transit
- [x] Scripts de validação e reconciliação 6 meses
- [ ] Backfill e normalização de `payment_method`
- [ ] View de competência válida
- [ ] Função de receita híbrida
- [ ] Relatório automatizado (Actions)


