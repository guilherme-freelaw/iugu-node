#!/bin/bash
# Monitor backfill progress script
# Usage: ./scripts/monitor_backfill.sh

echo "🔍 BACKFILL MONITOR"
echo "==================="
echo "📅 $(date)"
echo ""

# Check if process is running
if pgrep -f "autonomous_complete_backfill.js" > /dev/null; then
    echo "✅ Process is running (PID: $(pgrep -f autonomous_complete_backfill.js))"
else
    echo "❌ Process is not running"
fi

echo ""
echo "📊 RECENT PROGRESS:"
echo "-------------------"
tail -10 backfill.log | grep -E "(📊|📈|💾|🔄)" || echo "No progress data yet"

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
echo "• Monitor progress: tail -f backfill.log"
echo "• Check this status: ./scripts/monitor_backfill.sh"
echo "• Stop process: pkill -f autonomous_complete_backfill.js"
echo ""

# Check for checkpoint file
if [ -f "autonomous_backfill_checkpoint.json" ]; then
    echo "💾 CHECKPOINT INFO:"
    echo "------------------"
    cat autonomous_backfill_checkpoint.json | jq -r '
        "📊 Processed: \(.totalProcessed // 0) invoices",
        "✅ Inserted: \(.totalInserted // 0) new",
        "🔄 Existed: \(.totalExisted // 0) duplicates", 
        "❌ Errors: \(.totalErrors // 0)",
        "📅 Last update: \(.timestamp // "Unknown")"
    ' 2>/dev/null || echo "Checkpoint file exists but could not parse"
else
    echo "💾 No checkpoint file found yet"
fi

echo ""
