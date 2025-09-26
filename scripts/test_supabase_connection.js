#!/usr/bin/env node

const dotenv = require('dotenv');
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  console.log('URL:', SUPABASE_URL || '(missing)');
  const key = SUPABASE_SERVICE_ROLE_KEY || '';
  console.log('KEY_PREFIX:', key ? key.slice(0, 20) : '(missing)');
  console.log('KEY_LEN:', key.length);
  if (!SUPABASE_URL || !key) {
    console.log('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const url = `${SUPABASE_URL}/rest/v1/iugu_plans?select=id&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
      },
    });
    console.log('HTTP', res.status);
    const body = await res.text();
    console.log('Body', body);
  } catch (e) {
    console.error('ERR', e.message);
    process.exit(1);
  }
}

main();
