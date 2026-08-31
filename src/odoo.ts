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

// ============================================================
// v3 — Suppliers, pricing, daily prices
// ============================================================

import type {
  PricingConfig,
  SupplierForAsk,
  SupplierLogRow,
  SupplierPriceItem,
  WhatsAppTemplateRow,
} from "./types";

const nowOdoo = (): string =>
  new Date().toISOString().replace("T", " ").slice(0, 19);

// ---- Pricing config (singleton pattern) ----
export async function getActivePricingConfig(env: Env): Promise<PricingConfig | null> {
  const rows = await call<PricingConfig[]>(env, "x_pricing_config", "search_read", {
    domain: [["x_is_active", "=", true]],
    fields: ["id", "x_operations_margin_percent", "x_profit_margin_percent"],
    order: "x_active_from desc, id desc",
    limit: 1,
  });
  return rows[0] ?? null;
}

// ---- Templates ----
export async function getTemplateByPurpose(
  env: Env,
  purpose: string,
): Promise<WhatsAppTemplateRow | null> {
  const rows = await call<WhatsAppTemplateRow[]>(env, "x_whatsapp_template", "search_read", {
    domain: [["x_purpose", "=", purpose]],
    fields: ["id", "x_meta_template_id", "x_language", "x_purpose"],
    limit: 1,
  });
  return rows[0] ?? null;
}

// ---- Suppliers to ask ----
export async function getActiveSuppliersForAsk(env: Env): Promise<SupplierForAsk[]> {
  return await call<SupplierForAsk[]>(env, "res.partner", "search_read", {
    domain: [
      ["supplier_rank", ">", 0],
      ["x_whatsapp_number", "!=", false],
      ["x_supplied_product_ids", "!=", false],
      ["active", "=", true],
    ],
    fields: ["id", "name", "x_whatsapp_number", "x_supplied_product_ids"],
    limit: 200,
  });
}

// ---- Supplier ask log ----
export async function createSupplierAskLog(env: Env, supplierId: number): Promise<number> {
  const ids = await call<number[]>(env, "x_supplier_price_request_log", "create", {
    vals_list: [{
      x_supplier_id: supplierId,
      x_sent_at: nowOdoo(),
      x_status: "sent",
    }],
  });
  return ids[0];
}

export async function getSupplierPendingLog(
  env: Env,
  supplierId: number,
): Promise<SupplierLogRow | null> {
  const rows = await call<SupplierLogRow[]>(env, "x_supplier_price_request_log", "search_read", {
    domain: [
      ["x_supplier_id", "=", supplierId],
      ["x_replied_at", "=", false],
    ],
    fields: ["id", "x_supplier_id", "x_sent_at", "x_replied_at", "x_status"],
    order: "x_sent_at desc",
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function updateSupplierLog(
  env: Env,
  logId: number,
  vals: Record<string, unknown>,
): Promise<void> {
  await call<boolean>(env, "x_supplier_price_request_log", "write", {
    ids: [logId],
    vals,
  });
}

export async function getRecentSupplierLogs(
  env: Env,
  hours: number,
): Promise<SupplierLogRow[]> {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);
  return await call<SupplierLogRow[]>(env, "x_supplier_price_request_log", "search_read", {
    domain: [["x_sent_at", ">=", cutoff]],
    fields: [
      "id",
      "x_supplier_id",
      "x_sent_at",
      "x_replied_at",
      "x_prices_received_count",
      "x_status",
    ],
    order: "x_sent_at desc",
    limit: 500,
  });
}

// ---- Daily prices ----
export async function createDailyPrice(
  env: Env,
  vals: {
    supplier_id: number;
    product_id: number;
    packaging_id: number;
    cost_price: number;
    sale_price: number;
    actual_weight_kg: number | null;
    source_message_id: string;
    raw_reply: string;
  },
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const record: Record<string, unknown> = {
    x_supplier_id: vals.supplier_id,
    x_product_tmpl_id: vals.product_id,
    x_packaging_id: vals.packaging_id,
    x_date: today,
    x_price_sar: vals.cost_price,
    x_sale_price: vals.sale_price,
    x_source_message_id: vals.source_message_id,
    x_raw_reply: vals.raw_reply.slice(0, 2000),
    x_extraction_status: "extracted",
  };
  if (typeof vals.actual_weight_kg === "number") {
    record.x_actual_weight_kg = vals.actual_weight_kg;
  }
  const ids = await call<number[]>(env, "x_daily_price", "create", { vals_list: [record] });
  return ids[0];
}

// ---- Partner fields ----
export async function writePartner(
  env: Env,
  partnerId: number,
  vals: Record<string, unknown>,
): Promise<void> {
  await call<boolean>(env, "res.partner", "write", { ids: [partnerId], vals });
}

// Load the products a supplier is registered to supply, plus their packagings.
// Used to give Sonnet a tight catalog when parsing a supplier's price reply.
export async function fetchSupplierCatalog(
  env: Env,
  productIds: number[],
): Promise<{
  products: Array<{ id: number; name: string }>;
  packagings: Array<{
    id: number;
    name: string;
    product_id: number;
    is_default: boolean;
  }>;
}> {
  if (!productIds.length) return { products: [], packagings: [] };

  type ProdRow = { id: number; name: string };
  const products = await call<ProdRow[]>(env, "product.template", "search_read", {
    domain: [["id", "in", productIds]],
    fields: ["id", "name"],
    limit: 500,
  });

  type PackRow = {
    id: number;
    x_name: string;
    x_product_tmpl_id: [number, string] | false;
    x_is_default?: boolean;
  };
  const packagings = await call<PackRow[]>(env, "x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "in", productIds]],
    fields: ["id", "x_name", "x_product_tmpl_id", "x_is_default"],
    limit: 1000,
  });

  return {
    products,
    packagings: packagings
      .filter((pk) => Array.isArray(pk.x_product_tmpl_id))
      .map((pk) => ({
        id: pk.id,
        name: pk.x_name,
        product_id: (pk.x_product_tmpl_id as [number, string])[0],
        is_default: pk.x_is_default === true,
      })),
  };
}

export async function getPartnerNames(
  env: Env,
  ids: number[],
): Promise<Array<{ id: number; name: string }>> {
  if (!ids.length) return [];
  return await call<Array<{ id: number; name: string }>>(env, "res.partner", "read", {
    ids,
    fields: ["id", "name"],
  });
}

// v3: lazy-load supplier-only fields we don't put on the base OdooPartner shape
export async function readPartnerSupplierFields(
  env: Env,
  partnerId: number,
): Promise<{ x_supplied_product_ids: number[]; x_whatsapp_number: string } | null> {
  type Row = {
    id: number;
    x_supplied_product_ids: number[];
    x_whatsapp_number: string | false;
  };
  const rows = await call<Row[]>(env, "res.partner", "read", {
    ids: [partnerId],
    fields: ["id", "x_supplied_product_ids", "x_whatsapp_number"],
  });
  const r = rows[0];
  if (!r) return null;
  return {
    x_supplied_product_ids: Array.isArray(r.x_supplied_product_ids)
      ? r.x_supplied_product_ids
      : [],
    x_whatsapp_number: typeof r.x_whatsapp_number === "string" ? r.x_whatsapp_number : "",
  };
}

// ============================================================
// v4 — team orchestration (purchase list, delivery routes, collection)
// ============================================================

import type {
  TeamMember,
  TeamRole,
  ConfirmedLine,
  PurchaseListItem,
  RouteStop,
} from "./types";

// ---- Team members (drivers / collector / warehouse) by role ----
export async function getTeamMembersByRole(
  env: Env,
  role: TeamRole,
): Promise<TeamMember[]> {
  const rows = await call<Array<{
    id: number;
    name: string;
    x_whatsapp_number: string | false;
    x_role: string | false;
    x_neighborhoods: number[] | false;
  }>>(env, "res.partner", "search_read", {
    domain: [["x_role", "=", role], ["active", "=", true]],
    fields: ["id", "name", "x_whatsapp_number", "x_role", "x_neighborhoods"],
    limit: 50,
  });
  return rows
    .filter((r) => typeof r.x_whatsapp_number === "string" && r.x_whatsapp_number.length > 3)
    .map((r) => ({
      id: r.id,
      name: r.name,
      x_whatsapp_number: r.x_whatsapp_number as string,
      x_role: role,
      x_neighborhoods: Array.isArray(r.x_neighborhoods) ? r.x_neighborhoods : [],
    }));
}

export async function findTeamMemberByWhatsApp(
  env: Env,
  e164: string,
): Promise<TeamMember | null> {
  const rows = await call<Array<{
    id: number;
    name: string;
    x_whatsapp_number: string | false;
    x_role: string | false;
    x_neighborhoods: number[] | false;
  }>>(env, "res.partner", "search_read", {
    domain: [
      "|",
      ["x_whatsapp_number", "=", e164],
      ["phone", "=", e164],
      ["x_role", "in", ["driver", "collector", "warehouse"]],
      ["active", "=", true],
    ],
    fields: ["id", "name", "x_whatsapp_number", "x_role", "x_neighborhoods"],
    limit: 1,
  });
  const r = rows[0];
  if (!r || typeof r.x_role !== "string") return null;
  return {
    id: r.id,
    name: r.name,
    x_whatsapp_number: typeof r.x_whatsapp_number === "string" ? r.x_whatsapp_number : e164,
    x_role: r.x_role as TeamRole,
    x_neighborhoods: Array.isArray(r.x_neighborhoods) ? r.x_neighborhoods : [],
  };
}

// ---- Riyadh calendar date helper (kept local to avoid circular import) ----
function riyadhToday(): string {
  const now = new Date();
  const riyadh = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return riyadh.toISOString().slice(0, 10);
}

// ---- 21:00 cutoff: cancel every waiting_confirmation from today ----
export async function cancelStaleWaitingOrders(env: Env): Promise<number[]> {
  const today = riyadhToday();
  const orders = await call<Array<{ id: number }>>(env, "x_daily_order", "search_read", {
    domain: [
      ["x_order_date", "=", today],
      ["x_state", "=", "waiting_confirmation"],
    ],
    fields: ["id"],
    limit: 500,
  });
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  await call(env, "x_daily_order", "write", { ids, vals: { x_state: "cancelled" } });
  return ids;
}

// ---- Pull today's confirmed lines for aggregation ----
export async function getConfirmedLinesForToday(env: Env): Promise<ConfirmedLine[]> {
  const today = riyadhToday();
  const orders = await call<Array<{
    id: number;
    x_customer_id: [number, string] | false;
    x_delivery_neighborhood: string | false;
  }>>(env, "x_daily_order", "search_read", {
    domain: [["x_order_date", "=", today], ["x_state", "=", "confirmed"]],
    fields: ["id", "x_customer_id", "x_delivery_neighborhood"],
    limit: 500,
  });
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const lines = await call<Array<{
    id: number;
    x_order_id: [number, string] | false;
    x_product_tmpl_id: [number, string] | false;
    x_packaging_id: [number, string] | false;
    x_quantity: number;
    x_status: string | false;
  }>>(env, "x_daily_order_line", "search_read", {
    domain: [["x_order_id", "in", orderIds], ["x_status", "in", ["pending", "purchased"]]],
    fields: ["id", "x_order_id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_status"],
    limit: 5000,
  });

  return lines
    .filter((l) => Array.isArray(l.x_order_id) && Array.isArray(l.x_product_tmpl_id) && Array.isArray(l.x_packaging_id))
    .map((l) => {
      const orderId = (l.x_order_id as [number, string])[0];
      const order = orderMap.get(orderId)!;
      const cust = order.x_customer_id as [number, string] | false;
      const prod = l.x_product_tmpl_id as [number, string];
      const pk = l.x_packaging_id as [number, string];
      return {
        order_id: orderId,
        customer_id: cust ? cust[0] : 0,
        customer_name: cust ? cust[1] : "",
        neighborhood: typeof order.x_delivery_neighborhood === "string" ? order.x_delivery_neighborhood : "",
        product_id: prod[0],
        product_name: prod[1],
        packaging_id: pk[0],
        packaging_name: pk[1],
        quantity: l.x_quantity,
      };
    });
}

// ---- Aggregate confirmed lines by (product, packaging) ----
export function aggregatePurchaseList(lines: ConfirmedLine[]): PurchaseListItem[] {
  const map = new Map<string, PurchaseListItem>();
  for (const l of lines) {
    const key = `${l.product_id}::${l.packaging_id}`;
    const cur = map.get(key);
    if (cur) {
      cur.total_quantity += l.quantity;
      if (!cur.order_ids.includes(l.order_id)) cur.order_ids.push(l.order_id);
    } else {
      map.set(key, {
        product_id: l.product_id,
        product_name: l.product_name,
        packaging_id: l.packaging_id,
        packaging_name: l.packaging_name,
        total_quantity: l.quantity,
        order_ids: [l.order_id],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total_quantity - a.total_quantity);
}

// ---- Create the daily x_purchase_list record ----
export async function createPurchaseListRecord(
  env: Env,
  items: PurchaseListItem[],
): Promise<number> {
  const today = riyadhToday();
  // If one exists for today (idempotency), return it
  const existing = await call<Array<{ id: number }>>(env, "x_purchase_list", "search_read", {
    domain: [["x_date", "=", today]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) {
    await call(env, "x_purchase_list", "write", {
      ids: [existing[0].id],
      vals: {
        x_aggregated_items: JSON.stringify(items),
        x_total_items_count: items.length,
      },
    });
    return existing[0].id;
  }

  const ids = await call<number[]>(env, "x_purchase_list", "create", {
    vals_list: [{
      x_date: today,
      x_status: "draft",
      x_aggregated_items: JSON.stringify(items),
      x_total_items_count: items.length,
    }],
  });
  return ids[0];
}

export async function markPurchaseListSent(env: Env, id: number): Promise<void> {
  await call(env, "x_purchase_list", "write", {
    ids: [id],
    vals: { x_status: "sent", x_sent_to_ahmad_at: nowOdoo() },
  });
}

export async function markPurchaseListDone(env: Env, id: number): Promise<void> {
  await call(env, "x_purchase_list", "write", {
    ids: [id],
    vals: { x_status: "done", x_ahmad_confirmed_at: nowOdoo() },
  });
  // Bump each confirmed line to purchased + each order to in_purchase
  const today = riyadhToday();
  const orders = await call<Array<{ id: number }>>(env, "x_daily_order", "search_read", {
    domain: [["x_order_date", "=", today], ["x_state", "=", "confirmed"]],
    fields: ["id"],
    limit: 500,
  });
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id);
    await call(env, "x_daily_order", "write", {
      ids,
      vals: { x_state: "in_purchase" },
    });
    // Also flip lines pending → purchased
    const lines = await call<Array<{ id: number }>>(env, "x_daily_order_line", "search_read", {
      domain: [["x_order_id", "in", ids], ["x_status", "=", "pending"]],
      fields: ["id"],
      limit: 5000,
    });
    if (lines.length > 0) {
      await call(env, "x_daily_order_line", "write", {
        ids: lines.map((l) => l.id),
        vals: { x_status: "purchased" },
      });
    }
  }
}

export async function getLatestPurchaseListToday(env: Env): Promise<number | null> {
  const today = riyadhToday();
  const rows = await call<Array<{ id: number }>>(env, "x_purchase_list", "search_read", {
    domain: [["x_date", "=", today]],
    fields: ["id"],
    limit: 1,
    order: "id desc",
  });
  return rows[0]?.id ?? null;
}

// ---- Build route stops for one driver from all confirmed lines ----
// Simple assignment: if driver has neighborhoods set, pick orders whose
// x_delivery_neighborhood matches one of them; otherwise round-robin split.
export async function buildAndCreateRoutesForDrivers(
  env: Env,
): Promise<Array<{ routeId: number; driver: TeamMember; stops: RouteStop[] }>> {
  const drivers = await getTeamMembersByRole(env, "driver");
  if (drivers.length === 0) return [];

  const today = riyadhToday();
  const orders = await call<Array<{
    id: number;
    x_customer_id: [number, string] | false;
    x_delivery_neighborhood: string | false;
  }>>(env, "x_daily_order", "search_read", {
    domain: [["x_order_date", "=", today], ["x_state", "=", "in_purchase"]],
    fields: ["id", "x_customer_id", "x_delivery_neighborhood"],
    limit: 500,
  });
  if (orders.length === 0) return [];

  // Fetch neighborhood names once, so we can match strings against ids
  const neighRows = await call<Array<{ id: number; x_name: string }>>(
    env,
    "x_neighborhood",
    "search_read",
    { domain: [], fields: ["id", "x_name"], limit: 500 },
  );
  const neighNameToId = new Map(neighRows.map((n) => [n.x_name.trim(), n.id]));

  // Fetch customer phones
  const custIds = orders
    .map((o) => (Array.isArray(o.x_customer_id) ? (o.x_customer_id as [number, string])[0] : 0))
    .filter((n) => n > 0);
  const customers = await call<Array<{ id: number; phone: string | false; x_whatsapp_number: string | false }>>(
    env,
    "res.partner",
    "search_read",
    { domain: [["id", "in", custIds]], fields: ["id", "phone", "x_whatsapp_number"], limit: 500 },
  );
  const custPhoneMap = new Map<number, string>();
  for (const c of customers) {
    const phone = typeof c.x_whatsapp_number === "string" ? c.x_whatsapp_number
                : typeof c.phone === "string" ? c.phone : "";
    custPhoneMap.set(c.id, phone);
  }

  // Fetch order lines for line summaries
  const orderIds = orders.map((o) => o.id);
  const lines = await call<Array<{
    x_order_id: [number, string] | false;
    x_product_tmpl_id: [number, string] | false;
    x_packaging_id: [number, string] | false;
    x_quantity: number;
  }>>(env, "x_daily_order_line", "search_read", {
    domain: [["x_order_id", "in", orderIds], ["x_status", "=", "purchased"]],
    fields: ["x_order_id", "x_product_tmpl_id", "x_packaging_id", "x_quantity"],
    limit: 5000,
  });
  const summaryByOrder = new Map<number, string[]>();
  for (const l of lines) {
    if (!Array.isArray(l.x_order_id) || !Array.isArray(l.x_product_tmpl_id) || !Array.isArray(l.x_packaging_id)) continue;
    const oid = (l.x_order_id as [number, string])[0];
    const pname = (l.x_product_tmpl_id as [number, string])[1];
    const pkname = (l.x_packaging_id as [number, string])[1];
    const arr = summaryByOrder.get(oid) ?? [];
    arr.push(`${pname} ${pkname} × ${l.x_quantity}`);
    summaryByOrder.set(oid, arr);
  }

  // Assign each order to a driver
  const driverAssignments = new Map<number, RouteStop[]>();
  for (const d of drivers) driverAssignments.set(d.id, []);

  let roundRobinIdx = 0;
  for (const o of orders) {
    if (!Array.isArray(o.x_customer_id)) continue;
    const custId = (o.x_customer_id as [number, string])[0];
    const custName = (o.x_customer_id as [number, string])[1];
    const neighName = typeof o.x_delivery_neighborhood === "string" ? o.x_delivery_neighborhood.trim() : "";
    const neighId = neighName ? neighNameToId.get(neighName) : undefined;

    let chosenDriver = drivers.find(
      (d) => neighId && d.x_neighborhoods && d.x_neighborhoods.includes(neighId),
    );
    if (!chosenDriver) {
      chosenDriver = drivers[roundRobinIdx % drivers.length];
      roundRobinIdx++;
    }

    const stops = driverAssignments.get(chosenDriver.id)!;
    stops.push({
      order_id: o.id,
      customer_id: custId,
      customer_name: custName,
      customer_phone: custPhoneMap.get(custId) ?? "",
      neighborhood: neighName,
      sequence: (stops.length + 1) * 10,
      line_summary: (summaryByOrder.get(o.id) ?? []).join("، "),
    });
  }

  // Persist routes + stops in Odoo
  const results: Array<{ routeId: number; driver: TeamMember; stops: RouteStop[] }> = [];
  for (const d of drivers) {
    const stops = driverAssignments.get(d.id) ?? [];
    if (stops.length === 0) continue;

    const routeIds = await call<number[]>(env, "x_delivery_route", "create", {
      vals_list: [{
        x_date: today,
        x_driver_id: d.id,
        x_status: "dispatched",
        x_dispatched_at: nowOdoo(),
        x_total_stops: stops.length,
        x_stops_completed: 0,
      }],
    });
    const routeId = routeIds[0];

    await call<number[]>(env, "x_delivery_stop", "create", {
      vals_list: stops.map((s) => ({
        x_route_id: routeId,
        x_order_id: s.order_id,
        x_sequence: s.sequence,
        x_status: "pending",
      })),
    });

    // Flip contributing orders to in_delivery
    await call(env, "x_daily_order", "write", {
      ids: stops.map((s) => s.order_id),
      vals: { x_state: "in_delivery" },
    });

    results.push({ routeId, driver: d, stops });
  }
  return results;
}

// ---- Mark a single stop delivered ----
export async function markStopDelivered(
  env: Env,
  orderId: number,
): Promise<{ routeId: number | null; allDone: boolean }> {
  const stops = await call<Array<{ id: number; x_route_id: [number, string] | false; x_status: string }>>(
    env,
    "x_delivery_stop",
    "search_read",
    { domain: [["x_order_id", "=", orderId]], fields: ["id", "x_route_id", "x_status"], limit: 5, order: "id desc" },
  );
  const stop = stops[0];
  if (!stop) return { routeId: null, allDone: false };

  await call(env, "x_delivery_stop", "write", {
    ids: [stop.id],
    vals: { x_status: "delivered", x_delivered_at: nowOdoo() },
  });
  await call(env, "x_daily_order", "write", {
    ids: [orderId],
    vals: { x_state: "delivered", x_delivered_at: nowOdoo() },
  });

  const routeId = Array.isArray(stop.x_route_id) ? (stop.x_route_id as [number, string])[0] : null;
  if (!routeId) return { routeId: null, allDone: false };

  // Recount route progress
  const routeStops = await call<Array<{ x_status: string }>>(env, "x_delivery_stop", "search_read", {
    domain: [["x_route_id", "=", routeId]],
    fields: ["x_status"],
    limit: 500,
  });
  const done = routeStops.filter((s) => s.x_status === "delivered" || s.x_status === "issue").length;
  const total = routeStops.length;

  await call(env, "x_delivery_route", "write", {
    ids: [routeId],
    vals: {
      x_stops_completed: done,
      x_status: done === total ? "completed" : "in_progress",
      x_completed_at: done === total ? nowOdoo() : false,
    },
  });

  return { routeId, allDone: done === total };
}

// ---- Mark a single stop as issue (driver reports problem) ----
export async function markStopIssue(
  env: Env,
  orderId: number,
  note: string,
): Promise<number | null> {
  const stops = await call<Array<{ id: number; x_route_id: [number, string] | false }>>(
    env,
    "x_delivery_stop",
    "search_read",
    { domain: [["x_order_id", "=", orderId]], fields: ["id", "x_route_id"], limit: 5, order: "id desc" },
  );
  const stop = stops[0];
  if (!stop) return null;

  await call(env, "x_delivery_stop", "write", {
    ids: [stop.id],
    vals: { x_status: "issue", x_issue_note: note, x_delivered_at: nowOdoo() },
  });
  return Array.isArray(stop.x_route_id) ? (stop.x_route_id as [number, string])[0] : null;
}

// ---- v4: lightweight customer lookup for delivery notifications ----
export async function getOrderCustomer(
  env: Env,
  orderId: number,
): Promise<{ id: number; name: string; phone: string } | null> {
  const rows = await call<Array<{ id: number; x_customer_id: [number, string] | false }>>(
    env,
    "x_daily_order",
    "search_read",
    { domain: [["id", "=", orderId]], fields: ["id", "x_customer_id"], limit: 1 },
  );
  const row = rows[0];
  if (!row || !Array.isArray(row.x_customer_id)) return null;
  const custId = (row.x_customer_id as [number, string])[0];
  const partners = await call<Array<{ id: number; name: string; phone: string | false; x_whatsapp_number: string | false }>>(
    env,
    "res.partner",
    "search_read",
    { domain: [["id", "=", custId]], fields: ["id", "name", "phone", "x_whatsapp_number"], limit: 1 },
  );
  const p = partners[0];
  if (!p) return null;
  const phone = typeof p.x_whatsapp_number === "string" ? p.x_whatsapp_number
              : typeof p.phone === "string" ? p.phone : "";
  return { id: p.id, name: p.name, phone };
}
// ============================================================
// v5 — Invoice & Payment helpers
// Append these to the END of src/odoo.ts (before the final closing).
// They rely on the private `call<T>` helper already defined in odoo.ts.
// ============================================================

// ---- Read order + lines shape needed by invoice.ts ----
export async function getOrderForInvoicing(
  env: Env,
  orderId: number,
): Promise<{
  id: number;
  customer_id: number;
  customer_name: string;
  customer_whatsapp: string;
  neighborhood: string;
  lines: Array<{
    id: number;
    product_id: number;
    product_name: string;
    packaging_id: number;
    packaging_name: string;
    quantity: number;
    unit_price: number | null;
  }>;
} | null> {
  type OrderRow = {
    id: number;
    x_customer_id: [number, string] | false;
    x_delivery_neighborhood: string | false;
    x_line_ids: number[];
  };
  const orders = await call<OrderRow[]>(env, "x_daily_order", "read", {
    ids: [orderId],
    fields: ["id", "x_customer_id", "x_delivery_neighborhood", "x_line_ids"],
  });
  const order = orders[0];
  if (!order || !order.x_customer_id) return null;

  // Fetch customer whatsapp
  type PartnerRow = { id: number; name: string; phone: string | false; x_whatsapp_number: string | false };
  const [partner] = await call<PartnerRow[]>(env, "res.partner", "read", {
    ids: [order.x_customer_id[0]],
    fields: ["id", "name", "phone", "x_whatsapp_number"],
  });
  const wa = partner?.x_whatsapp_number || partner?.phone || "";

  // Fetch lines with prices
  type LineRow = {
    id: number;
    x_product_tmpl_id: [number, string] | false;
    x_packaging_id: [number, string] | false;
    x_quantity: number;
    x_unit_price: number | false;
    x_status: string;
  };
  const lines = order.x_line_ids.length
    ? await call<LineRow[]>(env, "x_daily_order_line", "read", {
        ids: order.x_line_ids,
        fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_unit_price", "x_status"],
      })
    : [];

  // Exclude unavailable lines (customer didn't get them)
  const usable = lines.filter((l) => l.x_status !== "unavailable");

  return {
    id: order.id,
    customer_id: order.x_customer_id[0],
    customer_name: partner?.name ?? "عميل",
    customer_whatsapp: wa || "",
    neighborhood: order.x_delivery_neighborhood || "",
    lines: usable.map((l) => ({
      id: l.id,
      product_id: l.x_product_tmpl_id ? l.x_product_tmpl_id[0] : 0,
      product_name: l.x_product_tmpl_id ? l.x_product_tmpl_id[1] : "?",
      packaging_id: l.x_packaging_id ? l.x_packaging_id[0] : 0,
      packaging_name: l.x_packaging_id ? l.x_packaging_id[1] : "",
      quantity: l.x_quantity,
      unit_price: typeof l.x_unit_price === "number" && l.x_unit_price > 0 ? l.x_unit_price : null,
    })),
  };
}

// ---- Look up today's sale price (fallback to any recent price) ----
export async function getLatestSalePrice(
  env: Env,
  productId: number,
  packagingId: number,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  type Row = { x_sale_price: number | false; x_price_sar: number | false };
  // Prefer today's confirmed/extracted price
  const rows = await call<Row[]>(env, "x_daily_price", "search_read", {
    domain: [
      ["x_product_tmpl_id", "=", productId],
      ["x_packaging_id", "=", packagingId],
      ["x_date", "=", today],
    ],
    fields: ["x_sale_price", "x_price_sar"],
    order: "id desc",
    limit: 1,
  });
  if (rows[0]) {
    if (typeof rows[0].x_sale_price === "number" && rows[0].x_sale_price > 0) return rows[0].x_sale_price;
    if (typeof rows[0].x_price_sar === "number" && rows[0].x_price_sar > 0) return rows[0].x_price_sar;
  }
  // Fallback: most recent price ever
  const fallback = await call<Row[]>(env, "x_daily_price", "search_read", {
    domain: [
      ["x_product_tmpl_id", "=", productId],
      ["x_packaging_id", "=", packagingId],
    ],
    fields: ["x_sale_price", "x_price_sar"],
    order: "x_date desc, id desc",
    limit: 1,
  });
  if (fallback[0]) {
    if (typeof fallback[0].x_sale_price === "number" && fallback[0].x_sale_price > 0) return fallback[0].x_sale_price;
    if (typeof fallback[0].x_price_sar === "number" && fallback[0].x_price_sar > 0) return fallback[0].x_price_sar;
  }
  return 0;
}

// ---- Invoice CRUD ----
export async function getInvoiceCountToday(env: Env): Promise<number> {
  const today = new Date().toISOString().slice(0, 10) + " 00:00:00";
  return await call<number>(env, "x_invoice", "search_count", {
    domain: [["create_date", ">=", today]],
  });
}

export async function createInvoiceRecord(
  env: Env,
  vals: {
    orderId: number;
    invoiceNumber: string;
    subtotal: number;
    tax: number;
    total: number;
  },
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const ids = await call<number[]>(env, "x_invoice", "create", {
    vals_list: [{
      x_order_id: vals.orderId,
      x_invoice_number: vals.invoiceNumber,
      x_invoice_date: today,
      x_subtotal: vals.subtotal,
      x_tax_amount: vals.tax,
      x_total: vals.total,
      x_status: "issued",
    }],
  });
  return ids[0];
}

export async function writeInvoice(
  env: Env,
  invoiceId: number,
  vals: Record<string, unknown>,
): Promise<void> {
  await call<boolean>(env, "x_invoice", "write", { ids: [invoiceId], vals });
}

export async function getInvoiceById(
  env: Env,
  invoiceId: number,
): Promise<{
  id: number;
  number: string;
  total: number;
  status: string;
  orderId: number | null;
} | null> {
  type Row = {
    id: number;
    x_invoice_number: string;
    x_total: number;
    x_status: string;
    x_order_id: [number, string] | false;
  };
  const rows = await call<Row[]>(env, "x_invoice", "read", {
    ids: [invoiceId],
    fields: ["id", "x_invoice_number", "x_total", "x_status", "x_order_id"],
  });
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    number: r.x_invoice_number,
    total: r.x_total,
    status: r.x_status,
    orderId: r.x_order_id ? r.x_order_id[0] : null,
  };
}

// ---- Payment ----
export async function createPaymentRecord(
  env: Env,
  vals: {
    invoiceId: number;
    amount: number;
    method: "cash" | "transfer";
    collectedBy?: number;
  },
): Promise<number> {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const record: Record<string, unknown> = {
    x_invoice_id: vals.invoiceId,
    x_amount: vals.amount,
    x_method: vals.method,
    x_collected_at: now,
  };
  if (vals.collectedBy) record.x_collected_by = vals.collectedBy;
  const ids = await call<number[]>(env, "x_payment", "create", { vals_list: [record] });
  return ids[0];
}

// ---- Line unit price write-back ----
export async function writeOrderLineUnitPrice(
  env: Env,
  lines: Array<{ lineId: number; unit: number; subtotal: number }>,
): Promise<void> {
  for (const l of lines) {
    await call<boolean>(env, "x_daily_order_line", "write", {
      ids: [l.lineId],
      vals: { x_unit_price: l.unit, x_subtotal: l.subtotal },
    });
  }
}

// ---- Customer WhatsApp lookup by order id ----
export async function getOrderCustomerWhatsapp(
  env: Env,
  orderId: number,
): Promise<string | null> {
  type OrderRow = { id: number; x_customer_id: [number, string] | false };
  const [order] = await call<OrderRow[]>(env, "x_daily_order", "read", {
    ids: [orderId],
    fields: ["id", "x_customer_id"],
  });
  if (!order?.x_customer_id) return null;
  type Row = { id: number; phone: string | false; x_whatsapp_number: string | false };
  const [p] = await call<Row[]>(env, "res.partner", "read", {
    ids: [order.x_customer_id[0]],
    fields: ["id", "phone", "x_whatsapp_number"],
  });
  return p?.x_whatsapp_number || p?.phone || null;
}

// ---- Collectors (team members with x_role=collector) ----
export async function getCollectorTeamMembers(
  env: Env,
): Promise<Array<{ id: number; name: string; whatsapp: string }>> {
  type Row = { id: number; name: string; phone: string | false; x_whatsapp_number: string | false };
  const rows = await call<Row[]>(env, "res.partner", "search_read", {
    domain: [
      ["x_role", "=", "collector"],
      ["active", "=", true],
    ],
    fields: ["id", "name", "phone", "x_whatsapp_number"],
    limit: 50,
  });
  return rows
    .map((r) => ({ id: r.id, name: r.name, whatsapp: r.x_whatsapp_number || r.phone || "" }))
    .filter((r) => r.whatsapp);
}

// ---- Unpaid invoices for the 18:00 collection summary ----
export async function getUnpaidInvoicesWithCustomer(
  env: Env,
): Promise<Array<{
  id: number;
  number: string;
  total: number;
  customer_name: string;
  neighborhood: string;
}>> {
  type InvRow = {
    id: number;
    x_invoice_number: string;
    x_total: number;
    x_order_id: [number, string] | false;
  };
  const invs = await call<InvRow[]>(env, "x_invoice", "search_read", {
    domain: [["x_status", "in", ["issued", "overdue"]]],
    fields: ["id", "x_invoice_number", "x_total", "x_order_id"],
    order: "x_invoice_date asc, id asc",
    limit: 200,
  });
  if (invs.length === 0) return [];

  const orderIds = invs.map((i) => (i.x_order_id ? i.x_order_id[0] : 0)).filter(Boolean);
  type OrderRow = { id: number; x_customer_id: [number, string] | false; x_delivery_neighborhood: string | false };
  const orders = orderIds.length
    ? await call<OrderRow[]>(env, "x_daily_order", "read", {
        ids: orderIds,
        fields: ["id", "x_customer_id", "x_delivery_neighborhood"],
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  return invs.map((i) => {
    const oid = i.x_order_id ? i.x_order_id[0] : 0;
    const o = orderMap.get(oid);
    return {
      id: i.id,
      number: i.x_invoice_number,
      total: i.x_total,
      customer_name: o?.x_customer_id ? o.x_customer_id[1] : "عميل",
      neighborhood: o?.x_delivery_neighborhood || "",
    };
  });
}
