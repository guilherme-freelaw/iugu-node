#!/usr/bin/env bash
# ==============================================================================
# Deploy Supabase Migrations (030 & 031)
# ==============================================================================
# Este script realiza:
#   1) Link do projeto Supabase local com o projeto remoto
#   2) Push das migrations para o banco de dados remoto
#   3) Validação via PostgREST de que as mudanças foram aplicadas
#
# Pré-requisitos:
#   - Supabase CLI instalado: brew install supabase/tap/supabase
#   - Variáveis de ambiente configuradas (ver .env ou exportar manualmente)
#
# Uso:
#   export SUPABASE_ACCESS_TOKEN="<seu-token>"
#   export SUPABASE_PROJECT_REF="<seu-project-ref>"
#   export SUPABASE_URL="https://<project-ref>.supabase.co"
#   export SUPABASE_SERVICE_ROLE_KEY="<sua-service-role-key>"
#
#   ./scripts/deploy_supabase_migrations.sh
# ==============================================================================

set -e  # Exit on error

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ==============================================================================
# 1) Verificar variáveis de ambiente necessárias
# ==============================================================================
echo -e "${YELLOW}[1/4] Verificando variáveis de ambiente...${NC}"

MISSING_VARS=()

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  MISSING_VARS+=("SUPABASE_ACCESS_TOKEN")
fi

if [ -z "$SUPABASE_PROJECT_REF" ]; then
  MISSING_VARS+=("SUPABASE_PROJECT_REF")
fi

if [ -z "$SUPABASE_URL" ]; then
  MISSING_VARS+=("SUPABASE_URL")
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  MISSING_VARS+=("SUPABASE_SERVICE_ROLE_KEY")
fi

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
  echo -e "${RED}❌ Variáveis de ambiente faltando:${NC}"
  for var in "${MISSING_VARS[@]}"; do
    echo "   - $var"
  done
  echo ""
  echo "Configure-as antes de executar este script:"
  echo "  export SUPABASE_ACCESS_TOKEN=\"<seu-token>\""
  echo "  export SUPABASE_PROJECT_REF=\"<seu-project-ref>\""
  echo "  export SUPABASE_URL=\"https://<project-ref>.supabase.co\""
  echo "  export SUPABASE_SERVICE_ROLE_KEY=\"<sua-service-role-key>\""
  echo ""
  echo "Consulte o README_DEPLOY_MIGRATIONS.md para mais informações."
  exit 1
fi

echo -e "${GREEN}✓ Todas as variáveis de ambiente configuradas${NC}"

# ==============================================================================
# 2) Link do projeto Supabase
# ==============================================================================
echo -e "\n${YELLOW}[2/4] Linkando projeto Supabase (ref: $SUPABASE_PROJECT_REF)...${NC}"

supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo -e "${GREEN}✓ Projeto linkado com sucesso${NC}"

# ==============================================================================
# 3) Push das migrations
# ==============================================================================
echo -e "\n${YELLOW}[3/4] Aplicando migrations (030_postgrest_reload_after_ddl.sql, 031_sync_state.sql)...${NC}"

supabase db push

echo -e "${GREEN}✓ Migrations aplicadas com sucesso${NC}"

# ==============================================================================
# 4) Validação via PostgREST
# ==============================================================================
echo -e "\n${YELLOW}[4/4] Validando mudanças via PostgREST...${NC}"

# 4a) Verificar se iugu_invoices expõe a coluna raw_json
echo -e "\n  Testando GET /rest/v1/iugu_invoices (com raw_json)..."
RESPONSE_INVOICES=$(curl -s "$SUPABASE_URL/rest/v1/iugu_invoices?select=id,raw_json&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

echo "$RESPONSE_INVOICES" | jq . 2>/dev/null || echo "$RESPONSE_INVOICES"

if echo "$RESPONSE_INVOICES" | grep -q '"id"'; then
  echo -e "${GREEN}  ✓ iugu_invoices acessível via PostgREST${NC}"
else
  echo -e "${RED}  ⚠ Possível problema ao acessar iugu_invoices${NC}"
fi

# 4b) Verificar se a tabela sync_state foi criada e está acessível
echo -e "\n  Testando GET /rest/v1/sync_state..."
RESPONSE_SYNC_STATE=$(curl -s "$SUPABASE_URL/rest/v1/sync_state?select=resource,last_cursor,updated_at&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

echo "$RESPONSE_SYNC_STATE" | jq . 2>/dev/null || echo "$RESPONSE_SYNC_STATE"

if echo "$RESPONSE_SYNC_STATE" | grep -q '\['; then
  echo -e "${GREEN}  ✓ sync_state criada e acessível via PostgREST${NC}"
else
  echo -e "${RED}  ⚠ Possível problema ao acessar sync_state${NC}"
fi

# ==============================================================================
# Conclusão
# ==============================================================================
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Deploy concluído!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Próximos passos:"
echo "  - Verificar os logs do Supabase Dashboard para confirmar que as migrations foram aplicadas"
echo "  - Testar a inserção de dados na tabela sync_state manualmente se necessário"
echo ""
