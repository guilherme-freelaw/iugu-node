'use strict';

const { createClient } = require('@supabase/supabase-js');

function toBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function monthBounds(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(Date.UTC(y, m, 1, 3, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 1, 3, 0, 0));
  return { start, end };
}
function isTestId(id) {
  if (!id) return false;
  const v = String(id).toLowerCase();
  return v === 'test_inv' || v.startsWith('test_') || v.includes('teste');
}
function normalizeMethod(s) {
  if (!s) return 'other';
  const v = String(s).toLowerCase();
  if (v.includes('pix')) return 'iugu_pix';
  if (v.includes('credit') || v.includes('card')) return 'iugu_credit_card';
  if (v.includes('slip') || v.includes('boleto')) return 'iugu_bank_slip';
  if (v === 'bank_slip') return 'iugu_bank_slip';
  return s; // keep original
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { start, end } = monthBounds(new Date());

  const { data: invRows, error: invErr } = await supabase
    .from('iugu_invoices')
    .select('id,status,paid_cents,total_cents,payment_method,paid_at,due_date')
    .gte('paid_at', start.toISOString())
    .lt('paid_at', end.toISOString())
    .limit(200000);
  if (invErr) throw invErr;

  const { data: dueRows, error: dueErr } = await supabase
    .from('iugu_invoices')
    .select('id,status,total_cents,payment_method,due_date')
    .gte('due_date', start.toISOString().slice(0, 10))
    .lt('due_date', end.toISOString().slice(0, 10))
    .limit(200000);
  if (dueErr) throw dueErr;

  const paid = (invRows || []).filter((r) => r.status && !isTestId(r.id));
  const due = (dueRows || []).filter((r) => !isTestId(r.id));

  let pixCash = 0,
    cardCash = 0,
    boletoCash = 0;
  for (const r of paid) {
    const m = normalizeMethod(r.payment_method);
    if (['paid', 'partially_paid'].includes(String(r.status))) {
      if (m === 'iugu_pix') pixCash += Number(r.paid_cents || 0);
      else if (m === 'iugu_credit_card') cardCash += Number(r.paid_cents || 0);
      else if (m === 'iugu_bank_slip') boletoCash += Number(r.paid_cents || 0);
    }
  }

  let boletoDue = 0; // competência
  for (const r of due) {
    const m = normalizeMethod(r.payment_method);
    if (!['canceled', 'expired', 'pending'].includes(String(r.status || ''))) {
      if (m === 'iugu_bank_slip') boletoDue += Number(r.total_cents || 0);
    }
  }

  // Charges pagos no mês
  const { data: charges, error: chErr } = await supabase
    .from('iugu_charges')
    .select('amount_cents,status,paid_at')
    .gte('paid_at', start.toISOString())
    .lt('paid_at', end.toISOString())
    .limit(100000);
  if (chErr) throw chErr;
  const chargesPaid = (charges || [])
    .filter((c) => ['paid', 'authorized', 'authorized_paid'].includes(String(c.status || '')))
    .reduce((a, b) => a + Number(b.amount_cents || 0), 0);

  const result = {
    month: start.toISOString().slice(0, 7),
    components: {
      pix_cash_cents: pixCash,
      card_cash_cents: cardCash,
      boleto_cash_cents: boletoCash,
      boleto_competency_cents: boletoDue,
      charges_paid_cents: chargesPaid,
    },
    pretty: {
      pix_cash_brl: toBRL(pixCash),
      card_cash_brl: toBRL(cardCash),
      boleto_cash_brl: toBRL(boletoCash),
      boleto_competency_brl: toBRL(boletoDue),
      charges_paid_brl: toBRL(chargesPaid),
    },
    hybrid_like_brl: toBRL(pixCash + cardCash + boletoDue),
  };

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
