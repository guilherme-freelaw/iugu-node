# BACKLOG - Projeto Iugu Node

Data de criação: 2025-09-01

Resumo
- Backlog living document para rastrear funcionalidades, tarefas e prioridades do projeto.
- Atualizar sempre após receber o PRD ou novas solicitações.

Status atual
- Conexão com Iugu: concluída (scripts de exemplo criados em `examples/list_customers.js`, `.env` configurado, `dotenv` instalado).

Tarefas prioritárias (To Do / In Progress / Done)

1) Integração: Conexão Iugu
- ID: backlog-2
- Status: Done
- Descrição: Implementar autenticação via API key, exemplo de listagem de customers, suporte a `.env` com `dotenv`.
- Arquivos relacionados: `examples/list_customers.js`, `.env`, `package.json` (dependência `dotenv`).

2) Criar scripts adicionais (To Do)
- ID: backlog-4
- Status: Pending
- Descrição: `examples/list_invoices.js`, `examples/get_customer.js`, `examples/save_customers_to_file.js`.
- Critério de aceite: scripts funcionais usando a mesma configuração `.env` e retornando JSON.

3) Testes de integração (To Do)
- ID: backlog-5
- Status: Pending
- Descrição: adicionar testes que validem as chamadas GET (mock ou integração dependendo do ambiente).

4) Segurança & Deployment (To Do)
- ID: backlog-6
- Status: Pending
- Descrição: instruções para armazenar chaves em CI (Secrets), exemplos com GitHub Actions, encrypt/decrypt local.

5) Receber PRD e dividir funcionalidades (To Do)
- ID: backlog-3
- Status: In Progress
- Descrição: após recebimento do PRD, quebrar requisitos em tarefas menores (UX, endpoints a consumir, regras de negócio, integração, testes) e priorizar.

Formato e processo
- Cada nova entrada deve conter: ID curto, Status (To Do / In Progress / Done), Descrição curta, Arquivos relacionados, Critério de aceite.
- Sempre atualizar o `BACKLOG.md` ao terminar uma tarefa e atualizar o `todo` interno do repo.

Como usar
- Para adicionar items: edite este arquivo e crie/atualize entradas no `todo` do projeto (seguir IDs).
- Após receber PRD: adicionar seção "PRD: <nome>" com resumo e tarefas derivadas.

Observações
- Não adicionar chaves no código fonte. Mantemos `.env` no `.gitignore`.
- Garantir que os exemplos sejam reutilizáveis em outros repositórios.

## PRD: Hub Iugu → Supabase (Freelaw) — v1.0

Data de referência: 2025-09-01

- **Resumo**: Implementar hub de dados read-only que espelha Iugu (clientes, assinaturas, faturas, itens, formas de pagamento e eventos) no Supabase para consultas rápidas, auditoria e relatórios.

- **Mapeamento com BACKLOG atual**:
  - **backlog-2**: Conexão com Iugu — Done
  - **backlog-4**: Criar scripts adicionais — Pending
  - **backlog-5**: Testes de integração — Pending
  - **backlog-6**: Segurança & Deployment — Pending
  - **backlog-3**: Receber PRD e dividir funcionalidades — In Progress

- **Tarefas novas (IDs internos)**:
  - `todo-ddl-migrations` — DDL migrations (public, staging, admin) [completed]
  - `todo-edge-functions` — Edge Functions (backfill, incremental, webhooks, upload, admin/replay) [in_progress]

Edge Functions - progresso:
 - Criados esboços iniciais (skeletons) das Edge Functions:
   - `supabase/functions/webhooks/index.ts`
   - `supabase/functions/backfill/index.ts`
   - `supabase/functions/incremental/index.ts`
   - `supabase/functions/upload_ingest/index.ts`
   - `supabase/functions/processor/index.ts`  -- worker/processor para normalização

Observação: o projeto Supabase já existe; quando for a hora de testar/deploy, fornecer `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
  - `todo-normalizers-upsert` — Normalizadores e upserts (customers, subscriptions, invoices) [completed]
  - `todo-staging-parser` — Parser CSV/XLSX e staging ingestion [pending]
  - `todo-admin-console` — Admin Next.js (Invoices, Subscriptions, Customers, Events/Jobs) [pending]
  - `todo-analytics-views` — Views/materialized para MRR, receita, churn, aging [pending]
  - `todo-observability` — Logs/metrics/health/dead-letter [pending]
  - `todo-security-rls` — RLS, secrets e roles [pending]
  - `todo-tests-qa` — Unit/integration/E2E tests [pending]
  - `todo-update-backlog` — Atualizar BACKLOG com PRD e DoD referências [pending]

- **Critério de aceite (referência PRD §19)**: Backfill completo; webhooks com idempotência; console com 4 telas + export; views analíticas entregues; observabilidade e segurança conforme PRD.

--
## Progresso automatizado

- Implementado: upsert RPCs e integração do processor para `customers`, `subscriptions`, `invoices`, `invoice_items`, `payment_methods`, `plans`, `transfers` (migrations `002`–`008`).
- Adicionados testes de integração em `test/integration/` cobrindo os fluxos acima.
- Scripts de dev/test adicionados em `supabase/dev_test/` para validação manual.

Próximo foco:

- `todo-edge-webhooks`: implementar handler idempotente e notificação ao processor (em progresso, handler aprimorado em `supabase/functions/webhooks/index.ts`).

--
Arquivo atualizado automaticamente pelo time de desenvolvimento (progresso automatizado).
