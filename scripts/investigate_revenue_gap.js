'use strict';

const { createClient } = require('@supabase/supabase-js');

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchRows(supabase, sql) {
  const { data, error } = await supabase.rpc('exec_sql_as_json', { sql_text: sql });
  if (error) throw error;
  return data;
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  // Hipóteses:
  // H1: incluir partially_paid aumenta para o valor do painel
  // H2: considerar total_cents em vez de paid_cents
  // H3: incluir refunds como positivo
  // H4: timezone influencia janela
  // H5: filtros de teste diferentes

  const startStr = toDateStr(start);
  const endStr = toDateStr(end);

  const queries = {
    paid_only: `select sum(paid_cents)::bigint as cents from iugu_invoices
      where status = 'paid' and paid_at >= '${startStr}' and paid_at < '${endStr}'
        and status is not null
        and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%')`,
    paid_partial: `select sum(paid_cents)::bigint as cents from iugu_invoices
      where status in ('paid','partially_paid') and paid_at >= '${startStr}' and paid_at < '${endStr}'
        and status is not null
        and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%')`,
    total_cents_paid: `select sum(total_cents)::bigint as cents from iugu_invoices
      where status = 'paid' and paid_at >= '${startStr}' and paid_at < '${endStr}'
        and status is not null
        and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%')`,
    include_refunds_positive: `select (coalesce(sum(paid_cents) filter (where status in ('paid','partially_paid')),0)
        + coalesce(sum(total_cents) filter (where status='refunded'),0))::bigint as cents
      from iugu_invoices
      where paid_at >= '${startStr}' and paid_at < '${endStr}'
        and status is not null
        and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%')`,
    tz_pt_br: `select sum(paid_cents)::bigint as cents from iugu_invoices
      where status in ('paid','partially_paid')
        and (paid_at at time zone 'America/Sao_Paulo') >= '${startStr}'::date
        and (paid_at at time zone 'America/Sao_Paulo') <  '${endStr}'::date
        and status is not null
        and not (id = 'test_inv' or id ilike 'test_%' or id ilike '%teste%')`,
  };

  // Executa sem função nativa de exec_sql; usa PostgREST RPC opcional se existir. Caso não exista, faz consultas diretas mínimas com filters
  async function runDirect(queryKey) {
    const q = queries[queryKey];
    const { data, error } = await supabase.rpc('run_sql_single_value', { sql_text: q });
    if (error) throw error;
    return Number(data?.value || 0);
  }

  const results = {};
  for (const key of Object.keys(queries)) {
    try {
      results[key] = await runDirect(key);
    } catch (e) {
      results[key] = null;
    }
  }

  console.log(JSON.stringify({ period: { start: startStr, end: endStr }, results }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
