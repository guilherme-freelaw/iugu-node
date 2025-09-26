'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date();
  const curr = today.toISOString().slice(0, 10);
  const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prev = prevDate.toISOString().slice(0, 10);

  const { data: d1, error: e1 } = await supabase.rpc('get_monthly_revenue_hybrid', {
    month_date: curr,
  });
  if (e1) throw e1;
  const { data: d2, error: e2 } = await supabase.rpc('get_monthly_revenue_hybrid', {
    month_date: prev,
  });
  if (e2) throw e2;

  const currCents = Number((d1 || [])[0]?.total_cents || 0);
  const prevCents = Number((d2 || [])[0]?.total_cents || 0);

  console.log(
    JSON.stringify(
      {
        current_month: {
          cents: currCents,
          brl: toBRL(currCents),
          details: (d1 || [])[0]?.details || {},
        },
        previous_month: {
          cents: prevCents,
          brl: toBRL(prevCents),
          details: (d2 || [])[0]?.details || {},
        },
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
