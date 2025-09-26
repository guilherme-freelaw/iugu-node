'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getMonthBoundsSP(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const toUtcFromSP = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd, 3, 0, 0));
  return {
    start: toUtcFromSP(y, m, 1),
    end: toUtcFromSP(y, m + 1, 1),
    now: new Date(),
  };
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { start, now } = getMonthBoundsSP(new Date());

  // Data de "hoje" em São Paulo (como AAAA-MM-DD) para filtrar due_date já vencidos
  const todaySPDate = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Critérios:
  // - due_date dentro do mês corrente E menor que hoje (SP) => já venceu
  // - não paga até agora: (paid_at é nulo OU paid_at >= agora)
  // - status pendente/expirada/nulo (exclui canceladas e pagas)
  const query = supabase
    .from('iugu_invoices')
    .select('total_cents,status,paid_at,due_date,id', { head: false })
    .gte('due_date', start.toISOString().slice(0, 10))
    .lt('due_date', todaySPDate)
    .or(`paid_at.is.null,paid_at.gte.${now.toISOString()}`)
    .or('status.is.null,status.in.(pending,expired)')
    .not('id', 'eq', 'test_inv')
    .not('id', 'ilike', 'test_%')
    .not('id', 'ilike', '%teste%')
    .limit(100000);

  const { data, error } = await query;
  if (error) throw error;

  const totalCents = (data || []).reduce((acc, row) => acc + Number(row.total_cents || 0), 0);

  console.log(
    JSON.stringify(
      {
        month: `${start.toISOString().slice(0, 7)}`,
        unpaid_competency_cents: totalCents,
        unpaid_competency_brl: toBRL(totalCents),
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}


