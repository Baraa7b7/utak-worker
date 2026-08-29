// Odoo JSON-2 API client.
// Every call: POST {ODOO_URL}/json/2/{model}/{method}  body = kwargs as JSON
// Auth: Bearer <ODOO_API_KEY>; on 401 falls back once to /web/session/authenticate.

import type { Env } from "./config";
import { CATALOG_CACHE_KEY, CATALOG_CACHE_TTL_SECONDS } from "./config";
import type {
  OdooPartner,
  CatalogProduct,
  CatalogPackaging,
  ExtractedOrderItem,
  OrderState,
} from "./types";

type AuthMode = "apikey" | "session";

let authMode: AuthMode = "apikey";
let sessionCookie: string | null = null;

async function authenticateSession(env: Env): Promise<void> {
  const res = await fetch(`${env.ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: {
        db: env.ODOO_DB,
        login: env.ODOO_LOGIN,
        password: env.ODOO_API_KEY,
      },
    }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/session_id=([^;]+)/);
  if (!match) {
    throw new Error(`odoo session auth failed: no session_id cookie (status ${res.status})`);
  }
  sessionCookie = `session_id=${match[1]}`;
  authMode = "session";
}

async function call<T = unknown>(
  env: Env,
  model: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${env.ODOO_URL}/json/2/${model}/${method}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authMode === "apikey") headers["Authorization"] = `Bearer ${env.ODOO_API_KEY}`;
  if (authMode === "session" && sessionCookie) headers["Cookie"] = sessionCookie;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    if (res.status === 401 && authMode === "apikey") {
      await authenticateSession(env);
      return call<T>(env, model, method, body);
    }
    // deno-lint-ignore no-explicit-any
    const p = parsed as any;
    const errName = p?.data?.name ?? `HTTP_${res.status}`;
    const errMsg = p?.data?.message ?? (typeof text === "string" ? text.slice(0, 200) : "");
    throw Object.assign(new Error(`odoo ${errName}: ${errMsg}`), { status: res.status });
  }

  return parsed as T;
}

// ============================================================
// v1 helpers (unchanged)
// ============================================================

export async function smokeTest(env: Env): Promise<{ ok: boolean; mode: AuthMode; error?: string }> {
  try {
    await call<number>(env, "res.partner", "search_count", { domain: [] });
    return { ok: true, mode: authMode };
  } catch (e) {
    const err = e as Error;
    return { ok: false, mode: authMode, error: err?.message ?? String(e) };
  }
}

export async function findCustomerByWhatsApp(env: Env, e164: string): Promise<OdooPartner | null> {
  const rows = await call<OdooPartner[]>(env, "res.partner", "search_read", {
    domain: [
      "&",
      ["customer_rank", ">", 0],
      "|",
      ["x_whatsapp_number", "=", e164],
      ["phone", "=", e164],
    ],
    fields: ["id", "name", "customer_rank", "x_whatsapp_number"],
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function findSupplierByWhatsApp(env: Env, e164: string): Promise<OdooPartner | null> {
  const rows = await call<OdooPartner[]>(env, "res.partner", "search_read", {
    domain: [
      ["supplier_rank", ">", 0],
      ["x_whatsapp_number", "=", e164],
    ],
    fields: ["id", "name", "supplier_rank", "x_whatsapp_number"],
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function createCustomer(env: Env, name: string, e164: string): Promise<number> {
  const ids = await call<number[]>(env, "res.partner", "create", {
    vals_list: [
      {
        name: name || e164,
        phone: e164,
        x_whatsapp_number: e164,
        customer_rank: 1,
      },
    ],
  });
  return ids[0];
}

export async function findOrCreateCustomer(
  env: Env,
  e164: string,
  profileName: string,
): Promise<OdooPartner> {
  const existing = await findCustomerByWhatsApp(env, e164);
  if (existing) return existing;
  const id = await createCustomer(env, profileName, e164);
  return {
    id,
    name: profileName || e164,
    customer_rank: 1,
    x_whatsapp_number: e164,
  };
}

// ============================================================
// v2 — Catalog (cached in KV for 1h)
// ============================================================

export async function fetchCatalog(env: Env): Promise<CatalogProduct[]> {
  // Try cache
  const cached = await env.MSG_DEDUP.get(CATALOG_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as CatalogProduct[];
    } catch {
      // fall through to fresh fetch
    }
  }

  // Fetch active products
  type ProdRow = { id: number; name: string; default_code?: string | false };
  const products = await call<ProdRow[]>(env, "product.template", "search_read", {
    domain: [["active", "=", true], ["sale_ok", "=", true]],
    fields: ["id", "name", "default_code"],
    limit: 500,
  });

  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);

  // Fetch all packagings for these products in one shot
  type PackRow = {
    id: number;
    x_name: string;
    x_product_tmpl_id: [number, string] | false;
    x_approx_weight_kg?: number | false;
    x_is_default?: boolean;
  };
  const packagings = await call<PackRow[]>(env, "x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "in", productIds]],
    fields: ["id", "x_name", "x_product_tmpl_id", "x_approx_weight_kg", "x_is_default"],
    limit: 1000,
  });

  // Index packagings by product id
  const byProduct = new Map<number, CatalogPackaging[]>();
  for (const pk of packagings) {
    if (!pk.x_product_tmpl_id) continue;
    const pid = pk.x_product_tmpl_id[0];
    const list = byProduct.get(pid) ?? [];
    list.push({
      id: pk.id,
      name: pk.x_name,
      approx_weight_kg: typeof pk.x_approx_weight_kg === "number" ? pk.x_approx_weight_kg : undefined,
      is_default: pk.x_is_default === true,
    });
    byProduct.set(pid, list);
  }

  const catalog: CatalogProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    default_code: typeof p.default_code === "string" ? p.default_code : undefined,
    packagings: byProduct.get(p.id) ?? [],
  }));

  // Cache
  await env.MSG_DEDUP.put(CATALOG_CACHE_KEY, JSON.stringify(catalog), {
    expirationTtl: CATALOG_CACHE_TTL_SECONDS,
  });

  return catalog;
}

// ============================================================
// v2 — Orders
// ============================================================

export async function findOrCreateTodayOrder(
  env: Env,
  customerId: number,
  neighborhood: string | undefined,
  sourceMessageId: string,
): Promise<{ id: number; created: boolean }> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Only find orders still open for editing (draft or waiting_confirmation).
  // If today's is already confirmed/closed, we start a new draft — customer wants a second order.
  type OrderRow = { id: number; x_state: OrderState };
  const rows = await call<OrderRow[]>(env, "x_daily_order", "search_read", {
    domain: [
      ["x_customer_id", "=", customerId],
      ["x_order_date", "=", today],
      ["x_state", "in", ["draft", "waiting_confirmation"]],
    ],
    fields: ["id", "x_state"],
    limit: 1,
    order: "id desc",
  });
  if (rows[0]) return { id: rows[0].id, created: false };

  const vals: Record<string, unknown> = {
    x_customer_id: customerId,
    x_order_date: today,
    x_state: "draft",
    x_created_via: "whatsapp",
    x_source_message_id: sourceMessageId,
  };
  if (neighborhood) vals.x_delivery_neighborhood = neighborhood;

  const ids = await call<number[]>(env, "x_daily_order", "create", { vals_list: [vals] });
  return { id: ids[0], created: true };
}

export async function addOrderLines(
  env: Env,
  orderId: number,
  items: ExtractedOrderItem[],
): Promise<number[]> {
  const valid = items.filter((it) => it.product_id > 0 && it.packaging_id > 0 && it.quantity > 0);
  if (valid.length === 0) return [];

  const vals = valid.map((it) => ({
    x_order_id: orderId,
    x_product_tmpl_id: it.product_id,
    x_packaging_id: it.packaging_id,
    x_quantity: it.quantity,
    x_status: "pending",
    x_notes: it.notes || "",
  }));

  return await call<number[]>(env, "x_daily_order_line", "create", { vals_list: vals });
}

export async function getOrderSummary(
  env: Env,
  orderId: number,
): Promise<{
  id: number;
  state: OrderState;
  lines: Array<{ product: string; packaging: string; qty: number }>;
} | null> {
  type OrderRow = {
    id: number;
    x_state: OrderState;
    x_line_ids: number[];
  };
  const orders = await call<OrderRow[]>(env, "x_daily_order", "read", {
    ids: [orderId],
    fields: ["id", "x_state", "x_line_ids"],
  });
  const order = orders[0];
  if (!order) return null;

  type LineRow = {
    id: number;
    x_product_tmpl_id: [number, string] | false;
    x_packaging_id: [number, string] | false;
    x_quantity: number;
  };
  const lines = order.x_line_ids.length
    ? await call<LineRow[]>(env, "x_daily_order_line", "read", {
        ids: order.x_line_ids,
        fields: ["x_product_tmpl_id", "x_packaging_id", "x_quantity"],
      })
    : [];

  return {
    id: order.id,
    state: order.x_state,
    lines: lines.map((l) => ({
      product: l.x_product_tmpl_id ? l.x_product_tmpl_id[1] : "?",
      packaging: l.x_packaging_id ? l.x_packaging_id[1] : "?",
      qty: l.x_quantity,
    })),
  };
}

export async function updateOrderState(
  env: Env,
  orderId: number,
  state: OrderState,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const vals: Record<string, unknown> = { x_state: state, ...extra };
  if (state === "confirmed" && !("x_confirmed_at" in vals)) {
    vals.x_confirmed_at = new Date().toISOString().replace("T", " ").slice(0, 19);
  }
  await call<boolean>(env, "x_daily_order", "write", { ids: [orderId], vals });
}

// ============================================================
// v2 — Quotation record (PDF generation is v2.5, done in Odoo)
// ============================================================

export async function createQuotationRecord(
  env: Env,
  orderId: number,
): Promise<{ id: number; number: string }> {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");

  // Simple daily sequence: count of quotations created today + 1
  const todayStart = now.toISOString().slice(0, 10) + " 00:00:00";
  const count = await call<number>(env, "x_quotation", "search_count", {
    domain: [["create_date", ">=", todayStart]],
  });
  const seq = String(count + 1).padStart(3, "0");
  const number = `UTAK-Q-${ymd}-${seq}`;

  const ids = await call<number[]>(env, "x_quotation", "create", {
    vals_list: [
      {
        x_order_id: orderId,
        x_quotation_number: number,
        x_customer_response: "pending",
        x_sent_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      },
    ],
  });
  return { id: ids[0], number };
}

// ============================================================
// v2 — Message analytics (silent logging)
// ============================================================

export async function logMessageAnalysis(
  env: Env,
  args: {
    customerId: number | null;
    text: string;
    intent: string;
    sentiment?: string;
    keywords?: string[];
    actionTaken?: string;
  },
): Promise<void> {
  const vals: Record<string, unknown> = {
    x_message_text: args.text.slice(0, 2000),
    x_intent: args.intent,
    x_created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    x_sentiment: args.sentiment ?? "neutral",
    x_keywords: JSON.stringify(args.keywords ?? []),
    x_action_taken: args.actionTaken ?? "",
  };
  if (args.customerId) vals.x_customer_id = args.customerId;

  // Fire-and-forget; swallow errors so analytics never breaks user flow.
  try {
    await call<number[]>(env, "x_message_analysis", "create", { vals_list: [vals] });
  } catch (e) {
    console.error("logMessageAnalysis failed", (e as Error)?.message);
  }
}
