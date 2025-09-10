// Fetch subscriptions that had paid invoices in August 2025 and count how many are active.
// Usage: IUGU_API_TOKEN=... IUGU_API_BASE_URL=https://api.iugu.com/v1 node scripts/fetch_august_active_subs.js

const IUGU_API_TOKEN = process.env.IUGU_API_TOKEN;
const IUGU_API_BASE_URL = process.env.IUGU_API_BASE_URL || 'https://api.iugu.com/v1';
if (!IUGU_API_TOKEN) {
  console.error('Missing IUGU_API_TOKEN');
  process.exit(2);
}

const BASIC_AUTH = 'Basic ' + Buffer.from(IUGU_API_TOKEN + ':').toString('base64');
const AUG_START = new Date('2025-08-01T00:00:00Z');
const AUG_END = new Date('2025-08-31T23:59:59Z');

async function fetchInvoicesPage(page = 1) {
  const url = `${IUGU_API_BASE_URL}/invoices?page=${page}&per_page=100`;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: BASIC_AUTH }, timeout: 30000 });
      if (!res.ok) {
        const text = await res.text();
        if (res.status >= 500 && attempt < maxAttempts) {
          const waitMs = Math.min(5000, Math.pow(2, attempt) * 300);
          console.warn(`invoices fetch page ${page} failed (${res.status}), retrying in ${waitMs}ms (attempt ${attempt})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`invoices fetch failed (${res.status}): ${text}`);
      }

      const json = await res.json();
      // Iugu may return array or object with items
      if (Array.isArray(json)) return json;
      if (json.items) return json.items;
      return Array.isArray(json.data) ? json.data : [];
    } catch (err) {
      // network or other errors: retry with backoff
      if (attempt < maxAttempts) {
        const waitMs = Math.min(5000, Math.pow(2, attempt) * 300);
        console.warn(`invoices fetch page ${page} error, retrying in ${waitMs}ms (attempt ${attempt}):`, err.message || err);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      console.error(`invoices fetch page ${page} failed after ${maxAttempts} attempts:`, err.message || err);
      // return empty array to skip page and continue
      return [];
    }
  }
  return [];
}

function invoicePaidInAugust(inv) {
  if (!inv) return false;
  const paidAt = inv.paid_at || inv.paid_at_at || inv.paid_at_time || null;
  if (!paidAt) return false;
  const d = new Date(paidAt);
  return d >= AUG_START && d <= AUG_END;
}

async function fetchSubscription(id) {
  const url = `${IUGU_API_BASE_URL}/subscriptions/${id}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: BASIC_AUTH }, timeout: 20000 });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`subscription fetch ${id} failed (${res.status}): ${text}`);
        if (res.status >= 500) {
          // retry
          await new Promise(r => setTimeout(r, attempt * 500));
          continue;
        }
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn('subscription fetch error', err.message || err);
      await new Promise(r => setTimeout(r, attempt * 500));
    }
  }
  return null;
}

async function main() {
  console.log('Fetching invoices from Iugu and filtering paid in August 2025...');
  const subscriptionIds = new Set();
  let page = 1;
  const MAX_PAGES = parseInt(process.env.MAX_PAGES || '5000', 10);
  const PAUSE_MS = parseInt(process.env.PAUSE_MS || '1000', 10);
  // detect existing checkpoint pages to resume
  try {
    const fs = await import('node:fs');
    const files = fs.readdirSync('out').filter(f => f.startsWith('page_') && f.endsWith('.json'));
    if (files.length > 0 && !process.env.START_PAGE) {
      const nums = files.map(f => parseInt(f.replace('page_','').replace('.json',''),10)).filter(n => !isNaN(n));
      if (nums.length > 0) {
        const max = Math.max(...nums);
        page = Math.max(page, max + 1);
        console.log('resuming from checkpoint page', page);
      }
    }
  } catch (err) {
    // ignore if out dir missing
  }

  let pagesFetched = 0;
  while (true) {
    const invoices = await fetchInvoicesPage(page);
    if (!invoices || invoices.length === 0) break;
    for (const inv of invoices) {
      if (invoicePaidInAugust(inv)) {
        const sid = inv.subscription_id || (inv.subscription && inv.subscription.id) || null;
        if (sid) subscriptionIds.add(sid);
      }
    }
    pagesFetched++;
    console.log(`fetched page ${page} (${invoices.length} invoices)`);
    // save checkpoint page
    try {
      const fs = await import('node:fs');
      if (!fs.existsSync('out')) fs.mkdirSync('out');
      fs.writeFileSync(`out/page_${page}.json`, JSON.stringify(invoices));
    } catch (err) {
      console.warn('failed to write checkpoint', err.message || err);
    }
    if (invoices.length < 100) break;
    if (pagesFetched >= MAX_PAGES) {
      console.log(`reached MAX_PAGES=${MAX_PAGES}, stopping`);
      break;
    }
    page++;
    // polite pause to avoid overwhelming the API
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  console.log('unique subscription ids with paid invoices in August:', subscriptionIds.size);

  let activeCount = 0;
  const details = [];
  for (const sid of subscriptionIds) {
    const sub = await fetchSubscription(sid);
    const status = sub && sub.status ? String(sub.status).toLowerCase() : null;
    const isActive = status === 'active' || status === 'ativo' || status === 'activated';
    if (isActive) activeCount++;
    details.push({ id: sid, status: status, raw: sub });
  }

  const result = { month: '2025-08', total_subscriptions_with_paid_invoices: subscriptionIds.size, active_subscriptions_with_paid_invoices: activeCount };
  console.log(JSON.stringify(result, null, 2));
  // write details to file for inspection
  const fs = await import('node:fs');
  try {
    fs.writeFileSync('out/active_subs_august_details.json', JSON.stringify(details, null, 2));
    console.log('Details written to out/active_subs_august_details.json');
  } catch (err) {
    // ignore
  }
}

main().catch(err => { console.error('Error:', err.message || err); process.exit(1); });


