#!/bin/bash

# Script wrapper para execução via cron
PROJECT_DIR="/Users/guilhermebarros/Documents/Cursor/Iugu - Node/iugu-node"
LOG_DIR="$PROJECT_DIR/logs"

cd "$PROJECT_DIR"

# Carregar variáveis de ambiente
export IUGU_API_TOKEN=9225D1D7C8065F541CDDD73D9B9AFD4BEF07F815ACA09519530DDD8568F0C0D2
export IUGU_API_BASE_URL=https://api.iugu.com/v1
export SUPABASE_URL=https://hewtomsegvpccldrcqjo.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI

# Executar sincronização completa com log
echo "$(date): Starting complete hourly sync" >> "$LOG_DIR/sync.log"
node scripts/complete_hourly_sync.js >> "$LOG_DIR/sync.log" 2>&1
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
