# Deploy de Migrations Supabase

Este guia explica como aplicar as migrations `030_postgrest_reload_after_ddl.sql` e `031_sync_state.sql` ao seu projeto Supabase.

## Pré-requisitos

### 1. Instalar Supabase CLI

```bash
brew install supabase/tap/supabase
```

Ou siga as instruções em [docs.supabase.com](https://supabase.com/docs/guides/cli).

### 2. Obter credenciais do Supabase

Você precisará de 4 valores do seu projeto Supabase:

| Variável | Onde encontrar |
|----------|----------------|
| `SUPABASE_ACCESS_TOKEN` | Dashboard → Account → Access Tokens → [Generate new token] |
| `SUPABASE_PROJECT_REF` | Dashboard → Project Settings → General → Reference ID |
| `SUPABASE_URL` | Dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Project Settings → API → service_role key (secret) |

## Uso

### Opção 1: Exportar variáveis de ambiente

```bash
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export SUPABASE_PROJECT_REF="abcdefghijklmnop"
export SUPABASE_URL="https://abcdefghijklmnop.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Executar script
chmod +x scripts/deploy_supabase_migrations.sh
./scripts/deploy_supabase_migrations.sh
```

### Opção 2: Usar arquivo .env

1. Copie `.env.example` para `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edite `.env` e preencha as credenciais do Supabase:
   ```bash
   SUPABASE_URL=https://seu-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
   ```

3. Adicione as variáveis de deploy (não incluídas no `.env.example`):
   ```bash
   echo "SUPABASE_ACCESS_TOKEN=seu-access-token" >> .env
   echo "SUPABASE_PROJECT_REF=seu-project-ref" >> .env
   ```

4. Carregue as variáveis e execute o script:
   ```bash
   source .env
   chmod +x scripts/deploy_supabase_migrations.sh
   ./scripts/deploy_supabase_migrations.sh
   ```

## O que o script faz

O script `deploy_supabase_migrations.sh` executa os seguintes passos:

1. **Verificação de variáveis**: Confirma que todas as credenciais necessárias estão configuradas
2. **Link do projeto**: Conecta o CLI local ao projeto remoto Supabase
3. **Push de migrations**: Aplica as migrations `030` e `031` ao banco de dados
4. **Validação**: Testa via PostgREST se as mudanças foram aplicadas corretamente:
   - Verifica se `iugu_invoices.raw_json` está acessível
   - Verifica se a tabela `sync_state` foi criada

## Migrations incluídas

### 030_postgrest_reload_after_ddl.sql
Força o PostgREST a recarregar o schema após mudanças DDL, garantindo que novas colunas/tabelas sejam imediatamente visíveis via API REST.

### 031_sync_state.sql
Cria a tabela `sync_state` para rastrear o estado de sincronização de diferentes recursos:

```sql
create table if not exists public.sync_state (
  resource text primary key,
  last_cursor timestamptz,
  updated_at timestamptz default now()
);
```

## Troubleshooting

### Erro: "Variáveis de ambiente faltando"
Certifique-se de ter exportado todas as 4 variáveis necessárias antes de executar o script.

### Erro: "supabase: command not found"
Instale o Supabase CLI com `brew install supabase/tap/supabase`.

### Erro ao validar via PostgREST
- Verifique se o `SUPABASE_URL` está correto e acessível
- Confirme que `SUPABASE_SERVICE_ROLE_KEY` tem permissões adequadas
- Aguarde alguns segundos após o push para o PostgREST recarregar o schema

### Migration já aplicada anteriormente
O Supabase CLI detecta automaticamente migrations já aplicadas e as ignora. É seguro executar o script múltiplas vezes.

## Segurança

⚠️ **IMPORTANTE**:
- **NUNCA** commite o arquivo `.env` com credenciais reais
- Mantenha `SUPABASE_SERVICE_ROLE_KEY` secreto (acesso total ao banco)
- Use `SUPABASE_ACCESS_TOKEN` pessoal (não compartilhe)
- Se credenciais forem expostas, rotacione-as imediatamente no Dashboard

## Próximos passos

Após aplicar as migrations com sucesso:

1. Confirme no Supabase Dashboard → Database que `sync_state` foi criada
2. Teste a inserção de dados na tabela:
   ```sql
   INSERT INTO sync_state (resource, last_cursor)
   VALUES ('invoices', NOW());
   ```
3. Verifique que o PostgREST expõe os dados via REST:
   ```bash
   curl "$SUPABASE_URL/rest/v1/sync_state?select=*" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
   ```

---

Para mais informações, consulte a [documentação oficial do Supabase CLI](https://supabase.com/docs/guides/cli).
