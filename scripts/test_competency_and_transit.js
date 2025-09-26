'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthBoundsSP(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const toUtcFromSP = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd, 3, 0, 0));
  return {
    start: toUtcFromSP(y, m, 1),
    end: toUtcFromSP(y, m + 1, 1),
  };
}

function isTestId(id) {
  if (!id) return false;
  const v = String(id).toLowerCase();
  return v === 'test_inv' || v.startsWith('test_') || v.includes('teste');
}

async function sumInvoicesCompetency(supabase, start, end) {
  const { data, error } = await supabase
    .from('iugu_invoices')
    .select('id,total_cents,due_date')
    .gte('due_date', start.toISOString().slice(0, 10))
    .lt('due_date', end.toISOString().slice(0, 10))
    .limit(100000);
  if (error) throw error;
  const rows = (data || []).filter((r) => !isTestId(r.id));
  return rows.reduce((acc, r) => acc + Number(r.total_cents || 0), 0);
}

async function getLatestSnapshotBefore(supabase, cutoffIso) {
  const { data, error } = await supabase
    .from('iugu_account_balances')
    .select('account_id,in_transit_cents,captured_at')
    .lt('captured_at', cutoffIso)
    .order('captured_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  // pick latest per account
  const byAcc = new Map();
  for (const row of data || []) {
    if (!byAcc.has(row.account_id)) byAcc.set(row.account_id, row);
  }
  let sum = 0;
  for (const r of byAcc.values()) sum += Number(r.in_transit_cents || 0);
  return sum;
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { start, end } = monthBoundsSP(new Date());

  // 1) Competência por due_date
  const compCents = await sumInvoicesCompetency(supabase, start, end);

  // Receita caixa do mês (já alinhada)
  const { data: recNow, error: rErr } = await supabase.rpc('get_monthly_received', {
    month_date: new Date().toISOString().slice(0, 10),
  });
  if (rErr) throw rErr;
  const recCents = Number(recNow?.[0]?.total_cents || 0);

  // 2) Variação positiva do in_transit (creditado no período)
  const startSnapSum = await getLatestSnapshotBefore(supabase, start.toISOString());
  const endSnapSum = await getLatestSnapshotBefore(supabase, end.toISOString());
  const transitCredited = Math.max(0, startSnapSum - endSnapSum);

  const scenarios = {
    competencia_due_date_cents: compCents,
    competencia_due_date_brl: toBRL(compCents),
    receita_caixa_mes_brl: toBRL(recCents),
    transit_creditado_cents: transitCredited,
    transit_creditado_brl: toBRL(transitCredited),
    caixa_mais_transit_brl: toBRL(recCents + transitCredited),
  };

  console.log(JSON.stringify(scenarios, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
