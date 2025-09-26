-- Migration: Add RPC for daily invoice counts
-- Created: 2025-09-15
-- Purpose: Support temporal monitoring system

-- Function to get daily invoice counts
CREATE OR REPLACE FUNCTION get_daily_invoice_counts(
  start_date DATE,
  end_date DATE
)
RETURNS TABLE(
  date DATE,
  count BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT 
    DATE(created_at_iugu) as date,
    COUNT(*) as count
  FROM iugu_invoices 
  WHERE DATE(created_at_iugu) BETWEEN start_date AND end_date
  GROUP BY DATE(created_at_iugu)
  ORDER BY date;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_daily_invoice_counts(DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION get_daily_invoice_counts(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_invoice_counts(DATE, DATE) TO anon;
