import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IUGU_API_TOKEN = Deno.env.get("IUGU_API_TOKEN")!;
const IUGU_API_BASE_URL = Deno.env.get("IUGU_API_BASE_URL") ?? "https://api.iugu.com/v1";

type Resource = "invoices"|"customers"|"subscriptions"|"plans"|"transfers"|"charges"|"accounts"|"payment_methods"|"chargebacks";

const RESOURCE_TO_RPC: Record<Resource,string> = {
  invoices: "upsert_invoice_from_payload",
  customers: "upsert_customer_from_payload",
  subscriptions: "upsert_subscription_from_payload",
  plans: "upsert_plan_from_payload",
  transfers: "upsert_transfer_from_payload",
  charges: "upsert_charge_from_payload",
  accounts: "upsert_account_from_payload",
  payment_methods: "upsert_payment_method_from_payload",
  chargebacks: "upsert_chargeback_from_payload",
};

const RESOURCE_TO_ENDPOINT: Record<Resource,string> = {
  invoices: "/invoices",
  customers: "/customers",
  subscriptions: "/subscriptions",
  plans: "/plans",
  transfers: "/transfers",
  charges: "/charges",
  accounts: "/accounts",
  payment_methods: "/payment_methods",
  chargebacks: "/chargebacks",
};

async function fetchSyncState(resource: Resource): Promise<string | null> {
  const url = `${SUPABASE_URL}/rest/v1/sync_state?resource=eq.${encodeURIComponent(resource)}&select=last_cursor&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`sync_state fetch failed: ${res.status}`);
  const rows = await res.json() as Array<{ last_cursor: string | null }>;
  return rows[0]?.last_cursor ?? null;
}

async function upsertSyncState(resource: Resource, lastCursor: string) {
  const url = `${SUPABASE_URL}/rest/v1/sync_state`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ resource, last_cursor: lastCursor, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`sync_state upsert failed: ${res.status} ${t}`);
  }
}

function basicAuth(): string {
  return "Basic " + btoa(`${IUGU_API_TOKEN}:`);
}

async function fetchIuguUpdatedSince(resource: Resource, sinceIso: string): Promise<any[]> {
  const endpoint = RESOURCE_TO_ENDPOINT[resource];
  const perPage = 100;
  let page = 1;
  const out: any[] = [];

  // Paginação simples; filtra por updated_at >= sinceIso no cliente
  while (true) {
    const url = `${IUGU_API_BASE_URL}${endpoint}?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, {
      headers: { Authorization: basicAuth(), "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Iugu fetch failed: ${res.status} ${t}`);
    }
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;

    const filtered = items.filter((it: any) => {
      const u = it?.updated_at ?? it?.updated_at_iugu ?? it?.created_at ?? it?.created_at_iugu;
      if (!u) return true; // conservador: mantém se não houver campo
      return new Date(u).toISOString() >= sinceIso;
    });
    out.push(...filtered);

    if (items.length < perPage) break;
    page++;
    if (page > 1000) break; // guarda de segurança
  }

  return out;
}

async function upsertViaRpc(resource: Resource, payload: any) {
  const rpc = RESOURCE_TO_RPC[resource];
  const url = `${SUPABASE_URL}/rest/v1/rpc/${rpc}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`RPC ${rpc} failed: ${res.status} ${t}`);
  }
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const body = await req.json().catch(() => ({}));
    const resource = (body?.resource ?? "").toString() as Resource;
    const overrideCursor = body?.cursor as string | undefined;
    if (!resource || !(resource in RESOURCE_TO_ENDPOINT)) {
      return new Response(JSON.stringify({ error: "invalid resource" }), { status: 400 });
    }

    const startCursor = overrideCursor ?? (await fetchSyncState(resource)) ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const changes = await fetchIuguUpdatedSince(resource, startCursor);
    let applied = 0;
    let maxCursor = startCursor;

    for (const item of changes) {
      await upsertViaRpc(resource, item);
      // Atualiza cursor local se houver updated_at mais novo
      const u = item?.updated_at ?? item?.updated_at_iugu ?? item?.created_at ?? item?.created_at_iugu ?? new Date().toISOString();
      const uIso = new Date(u).toISOString();
      if (uIso > maxCursor) maxCursor = uIso;
      applied++;
    }

    if (applied > 0) {
      await upsertSyncState(resource, maxCursor);
    }

    return new Response(JSON.stringify({ resource, applied, cursor: maxCursor }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message || String(err) }), { status: 500 });
  }
}
