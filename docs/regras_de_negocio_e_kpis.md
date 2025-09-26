## Regras de Negócio e KPIs

Documento de referência para consultas e validações. Baseado nos scripts finais do repositório (lógica de caixa com `paid_at` e uso de `taxes_cents`). Ajustes podem ser feitos conforme necessidade.

### Princípios Globais
- **Critério temporal padrão**: usar sempre `paid_at` (lógica de caixa) para qualquer métrica financeira. Sem fallback de datas.
- **Exceção**: contagem de faturas geradas usa `created_at_iugu` (competência de criação, não de pagamento).
- **Devoluções (refunds)**: considerar `status = 'refunded'` e janela por `paid_at` (data de execução do reembolso). Valor em `total_cents` (somar como negativo).
- **Taxas**: usar `taxes_cents` como campo canônico. O campo `commission_cents` é legado e não deve ser usado em novas consultas.
- **Valores monetários**: campos terminados em `_cents` representam centavos. Dividir por 100 para reais.
- **Exclusão de testes**: ignorar faturas de teste (ver seção Filtros Comuns).
- **Status nulo**: excluir registros com `status IS NULL` de métricas financeiras.

### Alinhamento com o dashboard (Iugu)
- **Recebimentos (mês atual / anterior)**: somatório de `paid_cents` de faturas com `status = 'paid'`, janelas por `paid_at`, excluindo testes e `status IS NULL`.
- **Volume diário**: idem acima agregado por dia de `paid_at`.
- **Refunds**: calcular em função específica e somar como valor negativo quando precisar compor receita líquida.
- **Saldo disponível / a receber / em trânsito / bloqueado**: provenientes de snapshots em `public.iugu_account_balances`.

### Objetos SQL criados
- Views: `kpi_daily_volume`, `kpi_total_subscribers`, `kpi_total_balance`, `kpi_daily_chargebacks`, `kpi_daily_in_transit_balance`.
- Funções: `get_current_balances()`, `get_monthly_received(date)`, `get_previous_month_received(date)`, `get_pending_fees()`, `get_monthly_refunds(date)`.

As views/funcs aplicam os filtros de exclusão de teste e usam `status = 'paid'` onde apropriado, conforme regras acima.

### Tabelas e Campos Relevantes
- **`iugu_invoices`**: `id`, `status`, `total_cents`, `paid_cents`, `taxes_cents`, `payment_method`, `subscription_id`, `paid_at`, `created_at_iugu`, `customer_id`.
- **`iugu_subscriptions`**: `id`, `customer_id`, `plan_id`, `active`, `suspended`, `raw_json`.

### Filtros Comuns (sempre aplicar)
- **Faturas de teste**: excluir quando qualquer uma das condições for verdadeira:
  - `id = 'test_inv'`
  - `id ILIKE 'test_%'`
  - `id ILIKE '%teste%'`
- **Status inválido**: excluir `status IS NULL` em métricas financeiras.

### KPIs Nucleares

#### 1) MRR (Monthly Recurring Revenue)
- **Definição**: soma do valor efetivamente pago em faturas de assinatura no período.
- **Critérios**:
  - `status = 'paid'`
  - `subscription_id IS NOT NULL`
  - janela por `paid_at`
  - excluir testes e `status IS NULL`
- **Versões**:
  - MRR bruto: `SUM(paid_cents)`
  - MRR líquido: `SUM(paid_cents) - SUM(taxes_cents)` nas mesmas faturas
- **SQL (paramétrico)**:
```sql
-- :start_date, :end_date no formato YYYY-MM-DD
WITH base AS (
  SELECT paid_cents, taxes_cents
  FROM iugu_invoices
  WHERE status = 'paid'
    AND subscription_id IS NOT NULL
    AND paid_at >= :start_date AND paid_at < :end_date
    AND status IS NOT NULL
    AND NOT (
      id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%'
    )
)
SELECT 
  COALESCE(SUM(paid_cents),0)/100 AS mrr_bruto,
  (COALESCE(SUM(paid_cents),0) - COALESCE(SUM(taxes_cents),0))/100 AS mrr_liquido,
  COALESCE(SUM(taxes_cents),0)/100 AS mrr_taxas
FROM base;
```

#### 2) Receita Bruta
- **Definição**: soma de `paid_cents` de todas as faturas pagas no período (inclui taxas da Iugu).
- **Critérios**: `status = 'paid'`, janela por `paid_at`, excluir testes e status nulo.
- **SQL**:
```sql
SELECT COALESCE(SUM(paid_cents),0)/100 AS receita_bruta
FROM iugu_invoices
WHERE status = 'paid'
  AND paid_at >= :start_date AND paid_at < :end_date
  AND status IS NOT NULL
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');
```

#### 3) Taxas Iugu
- **Definição**: soma de `taxes_cents` associadas às faturas pagas no período.
- **Critérios**: `status = 'paid'`, janela por `paid_at`, excluir testes e status nulo.
- **SQL**:
```sql
SELECT COALESCE(SUM(taxes_cents),0)/100 AS taxas_iugu
FROM iugu_invoices
WHERE status = 'paid'
  AND paid_at >= :start_date AND paid_at < :end_date
  AND status IS NOT NULL
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');
```

#### 4) Devoluções (Refunds)
- **Definição**: soma negativa de `total_cents` das faturas com `status = 'refunded'` no período, por data de execução (`paid_at`).
- **SQL**:
```sql
WITH base AS (
  SELECT total_cents, taxes_cents
  FROM iugu_invoices
  WHERE status = 'refunded'
    AND paid_at >= :start_date AND paid_at < :end_date
    AND status IS NOT NULL
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
)
SELECT 
  -COALESCE(SUM(total_cents),0)/100 AS devolucoes,
  COALESCE(SUM(taxes_cents),0)/100 AS taxas_devolvidas;
```

#### 5) Receita Líquida
- **Definição**: receita após devoluções e taxas.
- **Fórmula**: `receita_liquida = receita_bruta + devolucoes - taxas_iugu + taxas_devolvidas`
- **Observação**: `devolucoes` já é negativa no cálculo acima.

#### 6) Receita por Método de Pagamento
- **Definição**: distribuição por `payment_method` (ex.: `iugu_pix`, `iugu_credit_card`, `iugu_bank_slip`).
- **Critérios**: `status = 'paid'`, janela por `paid_at`.
- **SQL**:
```sql
SELECT 
  payment_method,
  COALESCE(SUM(paid_cents),0)/100 AS valor_bruto,
  COALESCE(SUM(taxes_cents),0)/100 AS taxas
FROM iugu_invoices
WHERE status = 'paid'
  AND paid_at >= :start_date AND paid_at < :end_date
  AND status IS NOT NULL
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
GROUP BY payment_method
ORDER BY valor_bruto DESC;
```

#### 7) Faturas Geradas (Contagem)
- **Definição**: quantidade de faturas criadas no período (competência de criação).
- **Critério temporal**: `created_at_iugu`.
- **Versões**:
  - Total (todas as faturas criadas)
  - Válidas (exclui `status IS NULL` e testes)
- **SQL**:
```sql
-- Total
SELECT COUNT(*) AS faturas_total
FROM iugu_invoices
WHERE created_at_iugu >= :start_date AND created_at_iugu < :end_date
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');

-- Válidas
SELECT COUNT(*) AS faturas_validas
FROM iugu_invoices
WHERE created_at_iugu >= :start_date AND created_at_iugu < :end_date
  AND status IS NOT NULL
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');
```

### KPIs de Eficiência e Conversão

#### 8) Taxa de Conversão de Faturas (por criação)
- **Definição**: proporção de faturas com `status = 'paid'` sobre o total de faturas criadas no período (janela por `created_at_iugu`).
- **SQL**:
```sql
WITH base AS (
  SELECT status
  FROM iugu_invoices
  WHERE created_at_iugu >= :start_date AND created_at_iugu < :end_date
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
)
SELECT 
  (SUM((status = 'paid')::int)::decimal / NULLIF(COUNT(*),0)) * 100 AS conversao_pct,
  COUNT(*) AS total,
  SUM((status = 'paid')::int) AS pagas;
```

#### 9) Ticket Médio
- **Emitido (criação)**: `SUM(total_cents)/COUNT(*)` sobre faturas criadas no período (`created_at_iugu`).
- **Pago (caixa)**: `SUM(paid_cents)/COUNT(*)` sobre faturas pagas no período (`paid_at`).
- **SQL (exemplos)**:
```sql
-- Ticket médio emitido
SELECT (COALESCE(SUM(total_cents),0)::decimal / NULLIF(COUNT(*),0))/100 AS ticket_medio_emitido
FROM iugu_invoices
WHERE created_at_iugu >= :start_date AND created_at_iugu < :end_date
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');

-- Ticket médio pago
SELECT (COALESCE(SUM(paid_cents),0)::decimal / NULLIF(COUNT(*),0))/100 AS ticket_medio_pago
FROM iugu_invoices
WHERE status = 'paid'
  AND paid_at >= :start_date AND paid_at < :end_date
  AND status IS NOT NULL
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');
```

### Assinaturas

#### 10) Assinaturas Ativas (Snapshot por janela)
- **Objetivo**: responder perguntas como “quantas assinaturas ativas tínhamos em 2024-03?”.
- **Abordagem A - Proxy por caixa (recomendada sem histórico de eventos)**: contar assinaturas com pelo menos uma fatura paga na janela desejada.
- **Abordagem B - Snapshot por status (se houver histórico de eventos)**: considerar `iugu_subscriptions` com eventos/status válidos na data de corte (requer campos de histórico como `status` com data de mudança, `created_at_iugu` e idealmente `updated_at_iugu`/events).

SQL (Abordagem A - Proxy via faturas pagas no mês):
```sql
SELECT COUNT(DISTINCT subscription_id) AS assinaturas_ativas
FROM iugu_invoices
WHERE status = 'paid'
  AND subscription_id IS NOT NULL
  AND paid_at >= :start_date AND paid_at < :end_date
  AND status IS NOT NULL
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');
```

SQL (Abordagem B - Snapshot por status, se disponível):
```sql
-- Requer histórico confiável na própria tabela ou tabela de eventos.
-- Exemplo simplificado: assinaturas criadas até fim do mês, ativas e não suspensas.
SELECT COUNT(*) AS assinaturas_ativas
FROM iugu_subscriptions s
WHERE (s.created_at_iugu IS NULL OR s.created_at_iugu < :end_date)
  AND COALESCE(s.suspended, false) = false
  AND (s.status = 'active');
```

Limitações: a Abordagem A é proxy de atividade; a B exige histórico de mudanças de status. Recomenda-se implementar `subscription_events` para snapshots perfeitos por data.

#### 11) MRR Ativo (Snapshot)
- **Definição**: MRR esperado no fechamento (por assinatura ativa ao fim do período).
- **Proxy**: somar o último valor de fatura conhecida por assinatura até a data de corte.
```sql
WITH ultimas AS (
  SELECT subscription_id,
         MAX(paid_at) AS last_paid
  FROM iugu_invoices
  WHERE subscription_id IS NOT NULL
    AND paid_at < :end_date
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
  GROUP BY subscription_id
), base AS (
  SELECT i.subscription_id, i.paid_cents
  FROM iugu_invoices i
  JOIN ultimas u ON u.subscription_id = i.subscription_id AND i.paid_at = u.last_paid
)
SELECT COALESCE(SUM(paid_cents),0)/100 AS mrr_snapshot_bruto
FROM base;
```

### Churn

#### 12) Logo Churn (assinaturas)
- **Regra de negócio**: considerar churn quem (a) pediu para sair/cancelou formalmente, ou (b) está inadimplente há mais de 60 dias. Não confundir inadimplência temporária (< 60 dias) com churn.
- **Parâmetros**: `grace_days_for_churn = 60`.
- **Critério prático (proxy)**:
  - Base de assinaturas ativas no mês anterior (proxy: tiveram fatura paga no mês anterior).
  - No fechamento atual, marcar como churned se a assinatura:
    - estiver com `status = 'canceled'` (se disponível no snapshot), OU
    - tiver `max_days_overdue > grace_days_for_churn` considerando faturas não pagas até o fechamento.
- **Fórmula**: `logo_churn_rate = churned_subs / active_subs_prev_month`.
```sql
WITH prev AS (
  SELECT DISTINCT subscription_id
  FROM iugu_invoices
  WHERE status='paid' AND subscription_id IS NOT NULL
    AND paid_at >= :prev_start AND paid_at < :prev_end
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
), snapshot AS (
  SELECT s.id AS subscription_id,
         (s.status = 'canceled') AS canceled_flag
  FROM iugu_subscriptions s
  -- Snapshot no fim do mês corrente (aproximação: última imagem)
  -- Se houver tabela de eventos, substituir por status vigente em :curr_end
), overdue AS (
  SELECT subscription_id,
         MAX((:curr_end::date - due_date)::int) FILTER (
           WHERE due_date < :curr_end
             AND (paid_at IS NULL OR paid_at >= :curr_end)
         ) AS max_days_overdue
  FROM iugu_invoices
  WHERE subscription_id IS NOT NULL
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
  GROUP BY subscription_id
), churned AS (
  SELECT p.subscription_id
  FROM prev p
  LEFT JOIN snapshot sn USING (subscription_id)
  LEFT JOIN overdue od USING (subscription_id)
  WHERE COALESCE(sn.canceled_flag,false) = true
     OR COALESCE(od.max_days_overdue,0) > 60
)
SELECT 
  (SELECT COUNT(*) FROM churned)::decimal
  / NULLIF((SELECT COUNT(*) FROM prev),0) AS logo_churn_rate;
```

#### 13) Revenue Churn (MRR)
- **Definição (proxy)**: perda de MRR entre meses causada por churn (conforme regra acima) e downgrades.
- **Fórmula**: `revenue_churn_rate = MRR_lost / MRR_prev_month` considerando apenas assinaturas churned ou reduzidas.
```sql
WITH prev AS (
  SELECT subscription_id, SUM(paid_cents) AS mrr_prev
  FROM iugu_invoices
  WHERE status='paid' AND subscription_id IS NOT NULL
    AND paid_at >= :prev_start AND paid_at < :prev_end
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
  GROUP BY subscription_id
), curr AS (
  SELECT subscription_id, SUM(paid_cents) AS mrr_curr
  FROM iugu_invoices
  WHERE status='paid' AND subscription_id IS NOT NULL
    AND paid_at >= :curr_start AND paid_at < :curr_end
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
  GROUP BY subscription_id
), snapshot AS (
  SELECT s.id AS subscription_id,
         (s.status = 'canceled') AS canceled_flag
  FROM iugu_subscriptions s
), overdue AS (
  SELECT subscription_id,
         MAX((:curr_end::date - due_date)::int) FILTER (
           WHERE due_date < :curr_end
             AND (paid_at IS NULL OR paid_at >= :curr_end)
         ) AS max_days_overdue
  FROM iugu_invoices
  WHERE subscription_id IS NOT NULL
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
  GROUP BY subscription_id
), joined AS (
  SELECT p.subscription_id, p.mrr_prev, COALESCE(c.mrr_curr,0) AS mrr_curr,
         COALESCE(sn.canceled_flag,false) AS canceled_flag,
         COALESCE(od.max_days_overdue,0) AS max_days_overdue
  FROM prev p
  LEFT JOIN curr c USING (subscription_id)
  LEFT JOIN snapshot sn USING (subscription_id)
  LEFT JOIN overdue od USING (subscription_id)
)
SELECT 
  (SUM(
     CASE 
       WHEN canceled_flag = true OR max_days_overdue > 60 THEN mrr_prev
       WHEN mrr_curr < mrr_prev THEN (mrr_prev - mrr_curr)
       ELSE 0
     END
  )::decimal / NULLIF(SUM(mrr_prev),0)) AS revenue_churn_rate
FROM joined;
```

Observação: este proxy capta cancels e downgrades; upgrades não contam como churn (apenas reduções vs mês anterior).

### Inadimplência (Delinquency)

#### 14) Saldo em Atraso no Fechamento (AR Overdue EOM)
- **Definição**: somatório de faturas não pagas com `due_date < :end_date` e não liquidadas até a data de corte.
```sql
SELECT 
  COALESCE(SUM(total_cents),0)/100 AS saldo_em_atraso
FROM iugu_invoices
WHERE due_date < :end_date
  AND (paid_at IS NULL OR paid_at >= :end_date)
  AND (status IN ('pending','expired') OR status IS NULL)
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');
```

#### 15) Aging por Faixa (0, 1-5, 6-10, 11-20, 21-30, 31-45, 46-60, >60 dias)
```sql
SELECT faixa,
       COALESCE(SUM(total_cents),0)/100 AS valor
FROM (
  SELECT 
    CASE 
      WHEN (:end_date::date - due_date) = 0 THEN '0'
      WHEN (:end_date::date - due_date) BETWEEN 1 AND 5 THEN '1-5'
      WHEN (:end_date::date - due_date) BETWEEN 6 AND 10 THEN '6-10'
      WHEN (:end_date::date - due_date) BETWEEN 11 AND 20 THEN '11-20'
      WHEN (:end_date::date - due_date) BETWEEN 21 AND 30 THEN '21-30'
      WHEN (:end_date::date - due_date) BETWEEN 31 AND 45 THEN '31-45'
      WHEN (:end_date::date - due_date) BETWEEN 46 AND 60 THEN '46-60'
      WHEN (:end_date::date - due_date) > 60 THEN '>60'
      ELSE '0'
    END AS faixa,
    total_cents
  FROM iugu_invoices
  WHERE due_date <= :end_date
    AND (paid_at IS NULL OR paid_at >= :end_date)
    AND (status IN ('pending','expired') OR status IS NULL)
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
) x
GROUP BY faixa
ORDER BY CASE faixa 
  WHEN '0' THEN 0
  WHEN '1-5' THEN 1 
  WHEN '6-10' THEN 2 
  WHEN '11-20' THEN 3 
  WHEN '21-30' THEN 4 
  WHEN '31-45' THEN 5 
  WHEN '46-60' THEN 6 
  WHEN '>60' THEN 7 
  ELSE 8 END;
```

#### 16) Atraso Médio de Pagamento (Paid)
- **Definição**: média de dias entre `paid_at` e `due_date` para faturas pagas no período de caixa.
```sql
SELECT AVG(EXTRACT(DAY FROM (paid_at::date - due_date::date))) AS atraso_medio_dias
FROM iugu_invoices
WHERE status='paid'
  AND paid_at >= :start_date AND paid_at < :end_date
  AND due_date IS NOT NULL
  AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%');
```

#### 17) Taxa de Cobrança do Mês (Collections Rate)
#### 18) Aging por Cliente (0, 1-5, 6-10, 11-20, 21-30, 31-45, 46-60, >60)
- **Definição**: quantos clientes estão inadimplentes por faixas específicas no fechamento.
- **Critério**: considerar, por cliente, o MAIOR atraso entre suas faturas vencidas e não pagas até `:end_date` e classificar nas faixas definidas (excluir testes).
```sql
WITH overdue AS (
  SELECT customer_id,
         MAX((:end_date::date - due_date)::int) FILTER (
           WHERE due_date <= :end_date
             AND (paid_at IS NULL OR paid_at >= :end_date)
             AND (status IN ('pending','expired') OR status IS NULL)
         ) AS max_days_overdue
  FROM iugu_invoices
  WHERE customer_id IS NOT NULL
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
  GROUP BY customer_id
), filtered AS (
  SELECT customer_id, max_days_overdue
  FROM overdue
  WHERE max_days_overdue IS NOT NULL AND max_days_overdue >= 0
), bucketed AS (
  SELECT 
    customer_id,
    CASE 
      WHEN max_days_overdue = 0 THEN '0'
      WHEN max_days_overdue BETWEEN 1 AND 5 THEN '1-5'
      WHEN max_days_overdue BETWEEN 6 AND 10 THEN '6-10'
      WHEN max_days_overdue BETWEEN 11 AND 20 THEN '11-20'
      WHEN max_days_overdue BETWEEN 21 AND 30 THEN '21-30'
      WHEN max_days_overdue BETWEEN 31 AND 45 THEN '31-45'
      WHEN max_days_overdue BETWEEN 46 AND 60 THEN '46-60'
      WHEN max_days_overdue > 60 THEN '>60'
      ELSE NULL
    END AS faixa
  FROM filtered
)
SELECT faixa,
       COUNT(*) AS clientes_inadimplentes
FROM bucketed
WHERE faixa IS NOT NULL
GROUP BY faixa
ORDER BY CASE faixa 
  WHEN '0' THEN 0
  WHEN '1-5' THEN 1 
  WHEN '6-10' THEN 2 
  WHEN '11-20' THEN 3 
  WHEN '21-30' THEN 4 
  WHEN '31-45' THEN 5 
  WHEN '46-60' THEN 6 
  WHEN '>60' THEN 7 
  ELSE 8 END;
```

#### 19) Lista detalhada de inadimplentes (por cliente)
- **Objetivo**: listar clientes, maior atraso e valor total vencido não liquidado até o fechamento.
```sql
WITH open_overdue AS (
  SELECT customer_id,
         due_date,
         total_cents
  FROM iugu_invoices
  WHERE due_date < :end_date
    AND (paid_at IS NULL OR paid_at >= :end_date)
    AND (status IN ('pending','expired') OR status IS NULL)
    AND customer_id IS NOT NULL
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
)
SELECT customer_id,
       MAX((:end_date::date - due_date)::int) AS max_days_overdue,
       COALESCE(SUM(total_cents),0)/100 AS total_vencido
FROM open_overdue
GROUP BY customer_id
ORDER BY max_days_overdue DESC, total_vencido DESC
LIMIT 100;
```
- **Definição (proxy)**: valor pago no mês relativo às faturas com vencimento no próprio mês.
```sql
WITH due_in_month AS (
  SELECT id, total_cents
  FROM iugu_invoices
  WHERE due_date >= :start_date AND due_date < :end_date
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
), paid_in_month AS (
  SELECT id, paid_cents
  FROM iugu_invoices
  WHERE status='paid' AND paid_at >= :start_date AND paid_at < :end_date
    AND NOT (id = 'test_inv' OR id ILIKE 'test_%' OR id ILIKE '%teste%')
)
SELECT 
  (SELECT COALESCE(SUM(paid_cents),0) FROM paid_in_month)::decimal
  / NULLIF((SELECT COALESCE(SUM(total_cents),0) FROM due_in_month),0) AS collections_rate;
```

### Glossário
- **status**: 'paid', 'pending', 'canceled', 'refunded', etc. Evitar `NULL` em métricas financeiras.
- **payment_method**: priorizar códigos `iugu_pix`, `iugu_credit_card`, `iugu_bank_slip`. Padronizar valores nulos/variantes antes de agrupar.
- **paid_cents**: valor efetivamente pago (caixa).
- **total_cents**: valor total da fatura.
- **taxes_cents**: taxas da Iugu associadas à transação (canônico). `commission_cents` é legado.
- **paid_at**: data/hora de liquidação (caixa). Usada para receitas e refunds.
- **created_at_iugu**: data/hora de criação. Usada para contagem de faturas e análises de conversão por coorte de emissão.

### Checklist para Consultas
- Aplicar janela por `paid_at` para receitas, MRR, taxes e refunds.
- Usar `created_at_iugu` somente para contagem de faturas e conversão por coorte de criação.
- Excluir faturas de teste e `status IS NULL` quando aplicável.
- Preferir `taxes_cents` para qualquer cálculo de taxas.
- Em distribuições por método, normalizar `payment_method` previamente.

### Dúvidas/Decisões Pendentes (personalizar)
- Confirmar se relatórios executivos devem usar MRR bruto ou líquido.
- Confirmar se devoluções parciais existem e como refletir em `total_cents` e `taxes_cents`.
- Definir regra de cálculo de MRR Ativo (snapshot) e fontes de preço de plano.


### Conciliação e Auditoria (API x CSV)

- **Verdade canônica (produção)**: Views baseadas na API são a fonte oficial.
  - `public.invoice_payments_classified`: classifica método robustamente usando `payment_method`, `pix_end_to_end_id`, `secure_url`, `bank_slip_url` e normaliza `paid_at` para `America/Sao_Paulo`.
  - `public.daily_revenue_by_method`: agrega `paid_cents` por dia e método com `status IN ('paid','partially_paid')`, excluindo testes.
- **CSV como auditoria**: usar relatórios de "Faturas — Pagamento" apenas para conferência.
  - Heurística de método (CSV):
    - **boleto**: se tiver "Nosso Número" ou linha digitável.
    - **pix**: se "Adquirente" contiver "pix".
    - **cartão**: se "Adquirente" existir e não for pix.
    - fallback: coluna "Paga com" quando necessário.
  - Datas: ler "Data do pagamento"; quando houver discrepância sistemática por fuso/evento, testar deslocamentos D±1 apenas na auditoria.
- **Tolerância de reconciliação**: aceitar diferenças quando |API − CSV| ≤ 1% do total do dia ou ≤ R$ 1.000 (o que for maior). Acima disso, abrir amostra.
- **Procedimento diário**:
  1) Consolidar API por dia e método via `daily_revenue_by_method`.
  2) Consolidar CSV por dia e método usando as heurísticas acima.
  3) Comparar; se delta > tolerância, gerar amostras:
     - `scripts/sample_deltas.js --date=YYYY-MM-DD --method=pix|credit_card|bank_slip` para listar top itens de cada lado.
  4) Classificar causa provável (ex.: boletos com critério de baixa diferente, timezone, linhas CSV com método impreciso).
- **Relatórios versionados**: salvar saídas em `docs/reports/` (mensal e diário com/sem offset) para trilha de auditoria.
- **Decisão operacional**: dashboards e KPIs sempre usam a API (caixa por `paid_at`); divergências do CSV são documentadas com amostra e motivo.


