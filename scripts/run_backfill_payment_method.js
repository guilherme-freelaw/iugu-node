'use strict';

const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await supabase.rpc('backfill_payment_method_from_raw', {
      limit_rows: 20000,
    });
    if (error) throw error;
    const updated = Number((Array.isArray(data) ? data[0] : data) || 0);
    total += updated;
    console.log(`batch ${i + 1}: updated ${updated}`);
    if (!updated) break;
  }
  console.log(JSON.stringify({ updated_total: total }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
