'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  const v = Number(cents || 0) / 100;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const today = new Date().toISOString().slice(0, 10);

  const { data: thisMonth, error: e1 } = await supabase.rpc('get_monthly_received', {
    month_date: today,
  });
  if (e1) throw e1;
  const { data: prevMonth, error: e2 } = await supabase.rpc('get_previous_month_received', {
    ref_date: today,
  });
  if (e2) throw e2;

  const thisCents = (thisMonth && thisMonth[0] && thisMonth[0].total_cents) || 0;
  const prevCents = (prevMonth && prevMonth[0] && prevMonth[0].total_cents) || 0;

  console.log(
    JSON.stringify(
      {
        this_month_cents: Number(thisCents),
        this_month_brl: toBRL(thisCents),
        previous_month_cents: Number(prevCents),
        previous_month_brl: toBRL(prevCents),
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
