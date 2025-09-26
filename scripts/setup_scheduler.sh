#!/bin/bash

# Setup do agendador automático para sincronização Iugu-Supabase
# Este script configura cron jobs para execução automática

PROJECT_DIR="/Users/guilhermebarros/Documents/Cursor/Iugu - Node/iugu-node"
LOG_DIR="$PROJECT_DIR/logs"

# Criar diretório de logs se não existir
mkdir -p "$LOG_DIR"

echo "🔧 CONFIGURANDO AGENDADOR AUTOMÁTICO"
echo "====================================="

# Verificar se as variáveis de ambiente estão definidas
if [ -z "$IUGU_API_TOKEN" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Erro: Variáveis de ambiente não definidas"
    echo "Configure IUGU_API_TOKEN, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

# Criar arquivo de environment para cron
cat > "$PROJECT_DIR/.env" << EOF
IUGU_API_TOKEN=$IUGU_API_TOKEN
IUGU_API_BASE_URL=https://api.iugu.com/v1
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
EOF

# Criar script wrapper para cron
cat > "$PROJECT_DIR/scripts/cron_sync.sh" << 'EOF'
#!/bin/bash

# Script wrapper para execução via cron
PROJECT_DIR="/Users/guilhermebarros/Documents/Cursor/Iugu - Node/iugu-node"
LOG_DIR="$PROJECT_DIR/logs"

cd "$PROJECT_DIR"

# Carregar variáveis de ambiente
source .env

# Executar sincronização com log
echo "$(date): Starting hourly sync" >> "$LOG_DIR/sync.log"
node scripts/hourly_sync.js >> "$LOG_DIR/sync.log" 2>&1
SYNC_EXIT_CODE=$?

if [ $SYNC_EXIT_CODE -eq 0 ]; then
    echo "$(date): Sync completed successfully" >> "$LOG_DIR/sync.log"
else
    echo "$(date): Sync failed with exit code $SYNC_EXIT_CODE" >> "$LOG_DIR/sync.log"
fi

# Executar testes de confiabilidade a cada 6 horas (apenas nos horários 0, 6, 12, 18)
HOUR=$(date +%H)
if [ $((HOUR % 6)) -eq 0 ]; then
    echo "$(date): Starting reliability tests" >> "$LOG_DIR/tests.log"
    node scripts/data_reliability_tests.js >> "$LOG_DIR/tests.log" 2>&1
    TEST_EXIT_CODE=$?
    
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo "$(date): Tests completed successfully" >> "$LOG_DIR/tests.log"
    else
        echo "$(date): Tests failed with exit code $TEST_EXIT_CODE" >> "$LOG_DIR/tests.log"
    fi
fi

# Cleanup de logs antigos (manter apenas últimos 7 dias)
find "$LOG_DIR" -name "*.log" -type f -mtime +7 -delete

echo "$(date): Cron job completed" >> "$LOG_DIR/sync.log"
EOF

# Tornar o script executável
chmod +x "$PROJECT_DIR/scripts/cron_sync.sh"

# Adicionar entrada ao crontab
echo "📅 Configurando cron job para execução a cada hora..."

# Verificar se já existe entrada no crontab
if crontab -l 2>/dev/null | grep -q "iugu-node"; then
    echo "⚠️  Entrada já existe no crontab. Removendo entrada antiga..."
    crontab -l 2>/dev/null | grep -v "iugu-node" | crontab -
fi

# Adicionar nova entrada
(crontab -l 2>/dev/null; echo "# Iugu-Supabase Sync - executa a cada hora") | crontab -
(crontab -l 2>/dev/null; echo "0 * * * * cd $PROJECT_DIR && ./scripts/cron_sync.sh # iugu-node-sync") | crontab -

echo "✅ Cron job configurado com sucesso!"
echo ""
echo "📊 CONFIGURAÇÃO:"
echo "- Sincronização: A cada hora (0 min)"
echo "- Testes: A cada 6 horas (0h, 6h, 12h, 18h)"
echo "- Logs: $LOG_DIR/"
echo ""
echo "🔧 COMANDOS ÚTEIS:"
echo "- Ver crontab: crontab -l"
echo "- Logs sync: tail -f $LOG_DIR/sync.log"
echo "- Logs tests: tail -f $LOG_DIR/tests.log"
echo "- Parar cron: crontab -l | grep -v 'iugu-node' | crontab -"
echo ""
echo "▶️  PRÓXIMA EXECUÇÃO: $(date -d '+1 hour' '+%H:00 hoje')"
