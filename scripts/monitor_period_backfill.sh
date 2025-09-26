#!/bin/bash
# Monitor period backfill progress script
# Usage: ./scripts/monitor_period_backfill.sh

echo "🔍 PERIOD BACKFILL MONITOR"
echo "=========================="
echo "📅 $(date)"
echo ""

# Check if process is running
if pgrep -f "complete_backfill_by_periods.js" > /dev/null; then
    echo "✅ Process is running (PID: $(pgrep -f complete_backfill_by_periods.js))"
else
    echo "❌ Process is not running"
fi

echo ""
echo "📊 RECENT PROGRESS:"
echo "-------------------"
tail -15 period_backfill.log | grep -E "(📅|📊|📈|💾|✅)" || echo "No progress data yet"

echo ""
echo "📈 CURRENT DATABASE COUNT:"
echo "--------------------------"
curl -s "https://hewtomsegvpccldrcqjo.supabase.co/rest/v1/iugu_invoices?select=count" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld3RvbXNlZ3ZwY2NsZHJjcWpvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njc1MDY4MywiZXhwIjoyMDcyMzI2NjgzfQ.gi709n03kCxnAlaZEW8L_ifvDwCC60H9Va-1fporIHI" \
  -H "Prefer: count=exact" | jq -r '.[0].count | "📄 Total invoices in Supabase: \(. | tonumber | tostring)"' 2>/dev/null || echo "Could not fetch count"

echo ""
echo "🔧 COMMANDS:"
echo "------------"
echo "• Monitor progress: tail -f period_backfill.log"
echo "• Check this status: ./scripts/monitor_period_backfill.sh"
echo "• Stop process: pkill -f complete_backfill_by_periods.js"
echo ""

# Check for checkpoint file
if [ -f "period_backfill_checkpoint.json" ]; then
    echo "💾 CHECKPOINT INFO:"
    echo "------------------"
    cat period_backfill_checkpoint.json | jq -r '
        "📊 Processed: \(.totalProcessed // 0) invoices",
        "✅ Inserted: \(.totalInserted // 0) new",
        "🔄 Existed: \(.totalExisted // 0) duplicates", 
        "❌ Errors: \(.totalErrors // 0)",
        "📅 Current period: \(.currentPeriodIndex // 0)/69",
        "📅 Last period: \(.lastPeriod // "Unknown")",
        "📅 Last update: \(.timestamp // "Unknown")"
    ' 2>/dev/null || echo "Checkpoint file exists but could not parse"
else
    echo "💾 No checkpoint file found yet"
fi

echo ""
