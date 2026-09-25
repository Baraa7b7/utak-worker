// Shared in-memory harness for WhatsApp scenario tests and simulations
// (2026-09-24): fixed Riyadh clock, fake Odoo JSON-2, captured Graph, fake
// Claude. Nothing leaves the process. Used by tests/wa-critical.test.mts and
// scripts/wa-20260924-journeys.mts.
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------- clock
const RealDate = Date;
export let fixedNow: number | null = null;
export class FakeDate extends RealDate {
  constructor(...a: unknown[]) {
    // deno-lint-ignore no-explicit-any
    if (a.length === 0 && fixedNow !== null) super(fixedNow); else super(...(a as [any]));
  }
  static now(): number { return fixedNow ?? RealDate.now(); }
}
// deno-lint-ignore no-explicit-any
(globalThis as any).Date = FakeDate;
/** Riyadh wall clock "2026-09-24 22:00" → fixed now. */
export function setRiyadh(ymdHm: string): void {
  fixedNow = RealDate.parse(ymdHm.replace(" ", "T") + ":00+03:00");
}

// ---------------------------------------------------------------- fake Odoo
type Rec = Record<string, unknown> & { id: number };
const M2O: Record<string, string> = {
  x_customer_id: "res.partner", x_partner_id: "res.partner", x_supplier_id: "res.partner",
  x_product_tmpl_id: "product.template", x_packaging_id: "x_product_packaging",
  x_order_id: "x_daily_order", x_invoice_id: "x_invoice", x_standing_id: "x_standing_order",
  x_route_id: "x_delivery_route", x_sale_order_id: "sale.order", x_payment_id: "x_payment",
  x_template_id: "x_whatsapp_template", x_account_move_id: "account.move", x_driver_id: "res.partner",
  x_wa_channel_id: "discuss.channel", x_wa_partner_id: "res.partner",
  // 2026-09-25 (STATUS § 35) — «أسعار اليوم»
  x_day_id: "x_price_day", x_daily_price_id: "x_daily_price", x_default_price_id: "x_daily_price", x_approved_by: "res.users",
};
/**
 * 2026-09-25 (STATUS § 35) — a test may mirror a stored compute of the tenant
 * (e.g. x_price_day_line.x_sale_price): run after every create / write on the model.
 */
export const computes: Record<string, (r: Record<string, unknown>) => void> = {};
export const db = new Map<string, Map<number, Rec>>();
let nextId = 10000;
export const odooLog: Array<{ model: string; method: string; body: any }> = [];

export function table(m: string): Map<number, Rec> {
  if (!db.has(m)) db.set(m, new Map());
  return db.get(m)!;
}
export function seed(m: string, rec: Record<string, unknown>): number {
  const id = (rec.id as number) ?? nextId++;
  table(m).set(id, { ...rec, id });
  return id;
}
function displayName(m: string, id: number): string {
  const r = table(m).get(id);
  return String(r?.name ?? r?.x_name ?? `${m},${id}`);
}
function fieldValue(m: string, r: Rec, f: string): unknown {
  if (m === "x_daily_order" && f === "x_line_ids") {
    return [...table("x_daily_order_line").values()].filter((l) => l.x_order_id === r.id).map((l) => l.id);
  }
  if (m === "x_standing_order" && f === "x_line_ids") {
    return [...table("x_standing_order_line").values()].filter((l) => l.x_standing_id === r.id).map((l) => l.id);
  }
  if (f === "x_role_ids.x_code") {
    return ((r.x_role_ids as number[]) ?? []).map((id) => table("x_employee_role").get(id)?.x_code);
  }
  // 2026-09-25 (STATUS § 31) — hr.employee: x_utak_whatsapp is computed from
  // the Work Contact (x_whatsapp_number, else phone), as on the tenant.
  if (m === "hr.employee" && f === "x_utak_whatsapp") {
    const c = table("res.partner").get(r.work_contact_id as number);
    return c?.x_whatsapp_number || c?.phone || false;
  }
  if (m === "resource.calendar.attendance" && f === "calendar_type") {
    return table("resource.calendar").get(r.calendar_id as number)?.calendar_type ?? "fixed";
  }
  // 2026-09-25 (STATUS § 35) — a dotted path through a known many2one (x_day_id.x_date).
  if (f.includes(".")) {
    const [head, ...rest] = f.split(".");
    const rel = M2O[head];
    const v = r[head];
    if (rel && typeof v === "number") {
      const t = table(rel).get(v);
      return t ? fieldValue(rel, t, rest.join(".")) : undefined;
    }
  }
  if (f === "active" && r.active === undefined) return true;
  if (f === "x_active" && r.x_active === undefined) return true;
  return r[f];
}
/** Odoo's active_test for the models whose archived rows matter here (STATUS § 31). */
const ACTIVE_FIELD: Record<string, string> = { "hr.employee": "active", "x_employee_role": "x_active" };
function activeOk(m: string, r: Rec, body: any): boolean {
  const f = ACTIVE_FIELD[m];
  if (!f || body?.context?.active_test === false) return true;
  if ((body?.domain ?? []).some((t: unknown) => Array.isArray(t) && t[0] === f)) return true;
  return fieldValue(m, r, f) !== false;
}
function readRec(m: string, r: Rec, fields?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { id: r.id };
  const fs = fields && fields.length ? fields : Object.keys(r);
  for (const f of fs) {
    const v = fieldValue(m, r, f);
    if (M2O[f] && typeof v === "number") out[f] = [v, displayName(M2O[f], v)];
    else out[f] = v === undefined ? false : v;
  }
  return out;
}
function match(m: string, r: Rec, dom: unknown[]): boolean {
  let i = 0;
  const one = (): boolean => {
    const t = dom[i++];
    if (t === "|") { const a = one(); const b = one(); return a || b; }
    if (t === "&") { const a = one(); const b = one(); return a && b; }
    const [f, op, val] = t as [string, string, unknown];
    const v = f === "id" ? r.id : fieldValue(m, r, f);
    if (Array.isArray(v)) {
      if (op === "=") return val === false ? v.length === 0 : v.includes(val);
      if (op === "!=") return val === false ? v.length > 0 : !v.includes(val);
    }
    switch (op) {
      case "=": return v === val || (val === false && (v === undefined || v === false));
      case "!=": return v !== val && !(val === false && (v === undefined || v === false));
      case ">": return Number(v ?? 0) > Number(val);
      case "in": return (val as unknown[]).includes(v);
      case "not in": return !(val as unknown[]).includes(v);
      case ">=": return String(v) >= String(val);
      case "<=": return String(v ?? "") <= String(val);
      case "<": return String(v ?? "") < String(val);
      case "ilike": return String(v ?? "").toLowerCase().includes(String(val).toLowerCase());
      default: return true;
    }
  };
  while (i < dom.length) if (!one()) return false;
  return true;
}
function odoo(model: string, method: string, body: any): unknown {
  odooLog.push({ model, method, body });
  const t = table(model);
  const all = () => [...t.values()];
  switch (method) {
    case "search_read": {
      let rows = all().filter((r) => activeOk(model, r, body) && match(model, r, body?.domain ?? []));
      if (String(body?.order ?? "").includes("desc")) rows = rows.reverse();
      if (body?.limit) rows = rows.slice(0, body.limit);
      return rows.map((r) => readRec(model, r, body?.fields));
    }
    case "search": return all().filter((r) => activeOk(model, r, body) && match(model, r, body?.domain ?? [])).map((r) => r.id);
    case "search_count": return all().filter((r) => activeOk(model, r, body) && match(model, r, body?.domain ?? [])).length;
    case "read": return (body?.ids ?? []).map((id: number) => t.get(id)).filter(Boolean).map((r: Rec) => readRec(model, r, body?.fields));
    case "create": {
      const list = body?.vals_list ?? (body?.values ? [body.values] : []);
      return list.map((v: Record<string, unknown>) => {
        const id = seed(model, { ...v });
        computes[model]?.(t.get(id)!);
        return id;
      });
    }
    case "write": {
      for (const id of body?.ids ?? []) { const r = t.get(id); if (r) { Object.assign(r, body.vals); computes[model]?.(r); } }
      return true;
    }
    case "unlink": for (const id of body?.ids ?? []) t.delete(id); return true;
    case "fields_get": return {};
    default: return true;
  }
}

// ---------------------------------------------------------------- fetch mock
export const graph: any[] = [];
/** template name → Meta error code to answer with (sync failure). */
export const failTemplates: Record<string, number> = {};
export const claudeItems: unknown[] = [];
export const OWNER = "966500000001";

globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const body = init?.body ? JSON.parse(init.body) : null;
  if (url.includes("graph.facebook.com")) {
    graph.push(body);
    const tpl = body?.template?.name;
    if (tpl && failTemplates[tpl]) {
      return new Response(JSON.stringify({ error: { message: `(#${failTemplates[tpl]}) Invalid parameter`, code: failTemplates[tpl] } }), { status: 400 });
    }
    return new Response(JSON.stringify({ messages: [{ id: `wamid.T${graph.length}` }] }), { status: 200 });
  }
  if (url.includes("anthropic.com")) {
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(claudeItems) }] }), { status: 200 });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m) return new Response(JSON.stringify(odoo(m[1], m[2], body)), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

// ---------------------------------------------------------------- env
export class KV {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async put(k: string, v: string) { this.store.set(k, v); }
  async delete(k: string) { this.store.delete(k); }
}
const fakeD1 = { prepare: () => ({ bind: () => ({ run: async () => ({}), all: async () => ({ results: [] }), first: async () => null }) }) };
export function makeEnv(): any {
  return {
    ODOO_URL: "https://odoo.test", ODOO_DB: "t", ODOO_LOGIN: "x", ODOO_API_KEY: "K",
    OWNER_WHATSAPP: "+" + OWNER,
    META_APP_SECRET: "SECRET", META_ACCESS_TOKEN: "T", META_PHONE_NUMBER_ID: "1", META_GRAPH_VERSION: "v22.0",
    ANTHROPIC_API_KEY: "A", CLAUDE_MODEL_REPLY: "m", CLAUDE_MODEL_CLASSIFY: "m",
    PILOT_MODE: "true",
    SIM_ALLOWLIST: "+9665",
    SIM_DB: fakeD1,
    MSG_DEDUP: new KV(),
    WORKER_ORIGIN: "https://w.test",
  };
}

// ---------------------------------------------------------------- data
export const CUST = 501, CUST_PHONE = "966500000501";
export const CUST2 = 502, CUST2_PHONE = "966500000502";
export const WH = 601, WH_PHONE = "966500000601";
export const COLL = 602, COLL_PHONE = "966500000602";
// [purpose, template, params, category]. 2026-09-25 (STATUS § 33) — utak_owner_alert
// is MARKETING at Meta, as on the tenant: the gateway never uses it for an alert.
const TPL: Array<[string, string, number, string?]> = [
  ["owner_alert", "utak_owner_alert", 1, "MARKETING"],
  ["purchase_list", "utak_purchase_list_v2", 4],
  ["collection_summary", "utak_collection_summary", 4],
  ["customer_order_update", "utak_order_update", 2],
  ["customer_delivery_done", "utak_delivered", 1],
  ["collection_request", "utak_collection_request", 4],
  ["customer_daily_remind", "utak_v2_daily_remind", 1],
];
export function reset(): any {
  db.clear(); nextId = 10000; odooLog.length = 0; graph.length = 0;
  for (const k of Object.keys(failTemplates)) delete failTemplates[k];
  claudeItems.length = 0;
  seed("res.partner", { id: CUST, name: "مطعم الوادي", x_whatsapp_number: "+" + CUST_PHONE, customer_rank: 1 });
  seed("res.partner", { id: CUST2, name: "بقالة النخيل", x_whatsapp_number: "+" + CUST2_PHONE, customer_rank: 1 });
  seed("x_employee_role", { id: 71, x_code: "warehouse" });
  seed("x_employee_role", { id: 72, x_code: "driver" });
  seed("x_employee_role", { id: 73, x_code: "collector" });
  // 2026-09-25 (STATUS § 31) — the team is hr.employee; the partner is its Work Contact.
  seed("res.partner", { id: WH, name: "أحمد", x_whatsapp_number: "+" + WH_PHONE });
  seed("res.partner", { id: COLL, name: "سالم", x_whatsapp_number: "+" + COLL_PHONE });
  employee(WH, [71]);
  employee(COLL, [73]);
  seed("product.template", { id: 1, name: "طماطم" });
  seed("product.template", { id: 2, name: "خيار" });
  seed("x_product_packaging", { id: 11, x_name: "كرتون", x_product_tmpl_id: 1 });
  seed("x_product_packaging", { id: 21, x_name: "جرم", x_product_tmpl_id: 2 });
  TPL.forEach(([purpose, name, n, cat], i) => seed("x_whatsapp_template", {
    id: 900 + i, x_purpose: purpose, x_meta_template_id: name, x_language: "ar",
    x_meta_status: "APPROVED", x_param_count: n, x_category: cat ?? "UTILITY",
  }));
  const env = makeEnv();
  // 2026-09-25 (STATUS § 33) — Baraa's 24h window is open, as after his daily
  // 06:00 «بدء الدوام» tap, whatever clock a test sets: his alerts go as text.
  // A test that needs it closed calls closeOwnerWindow(env).
  env.MSG_DEDUP.store.set(`wa_win:v1:${OWNER}`, JSON.stringify({ in: RealDate.UTC(2100, 0, 1) }));
  env.MSG_DEDUP.store.set("catalog:v2", JSON.stringify([
    { id: 1, name: "طماطم", packagings: [{ id: 11, name: "كرتون" }] },
    { id: 2, name: "خيار", packagings: [{ id: 21, name: "جرم" }] },
  ]));
  return env;
}
export function order(customer: number, state: string, date: string, lines = 1, extra: Record<string, unknown> = {}): number {
  const id = seed("x_daily_order", { x_customer_id: customer, x_state: state, x_order_date: date, x_created_via: "whatsapp", ...extra });
  for (let i = 0; i < lines; i++) seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 3, x_status: "pending" });
  return id;
}
/**
 * 2026-09-25 (STATUS § 31) — a team member: hr.employee on the partner (its
 * Work Contact) with «أدوار UTAK». Extra fields: x_utak_attendance,
 * resource_calendar_id, resource_id, x_utak_neighborhood_ids, name…
 */
export function employee(partnerId: number, roleIds: number[], extra: Record<string, unknown> = {}): number {
  const p = table("res.partner").get(partnerId);
  const id = (extra.id as number) ?? 7000 + partnerId;
  return seed("hr.employee", {
    id, name: p?.name ?? `موظف ${partnerId}`, work_contact_id: partnerId, x_utak_role_ids: roleIds,
    x_utak_attendance: false, resource_calendar_id: false, resource_id: id + 100000, company_id: 1, x_utak_neighborhood_ids: [],
    ...extra,
  });
}
/**
 * A fixed working schedule: lines as [dayofweek (Odoo: Monday 0 … Sunday 6), from, to].
 * Returns the calendar id.
 */
export function workSchedule(lines: Array<[number, number, number]>, extra: Record<string, unknown> = {}): number {
  const cal = seed("resource.calendar", { name: "دوام", calendar_type: "fixed", company_id: 1, ...extra });
  for (const [d, from, to] of lines) {
    seed("resource.calendar.attendance", { calendar_id: cal, dayofweek: String(d), hour_from: from, hour_to: to, duration_based: false, date: false, recurrency: false });
  }
  return cal;
}
export function closeOwnerWindow(env: any): void {
  env.MSG_DEDUP.store.delete(`wa_win:v1:${OWNER}`);
}
/** The number wrote `minutesAgo` minutes ago (Meta's clock): its 24h window is open. */
export function openWindow(env: any, digits: string, minutesAgo = 1): void {
  const d = String(digits).replace(/\D/g, "");
  env.MSG_DEDUP.store.set(`wa_win:v1:${d}`, JSON.stringify({ in: (fixedNow ?? RealDate.now()) - minutesAgo * 60_000 }));
}
/** What the gateway holds for a number (STATUS § 33). */
export function heldFor(env: any, digits: string): any[] {
  return JSON.parse(env.MSG_DEDUP.store.get(`wa_q:v1:${String(digits).replace(/\D/g, "")}`) ?? "[]");
}
export const sentTo = (digits: string) => graph.filter((b) => b?.to === digits);
export const ownerAlerts = () => sentTo(OWNER).map((b) => JSON.stringify(b));
export const rows = (m: string) => [...table(m).values()];


export function setFail(map: Record<string, number>): void {
  for (const k of Object.keys(failTemplates)) delete failTemplates[k];
  Object.assign(failTemplates, map);
}
export function setClaude(items: unknown[]): void { claudeItems.length = 0; claudeItems.push(...items); }

const REAL = { warn: console.warn, error: console.error, log: console.log };
let quietDepth = 0;
/** Mute console while fn runs (safe under concurrency). */
export const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  if (quietDepth++ === 0) { console.warn = () => {}; console.error = () => {}; console.log = () => {}; }
  try { return await fn(); } finally {
    if (--quietDepth === 0) { console.warn = REAL.warn; console.error = REAL.error; console.log = REAL.log; }
  }
};
export function partnerOf(id: number) {
  const r = table("res.partner").get(id)!;
  return { id, name: String(r.name), x_whatsapp_number: String(r.x_whatsapp_number) };
}
export function signed(payload: unknown): Request {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", "SECRET").update(raw).digest("hex");
  return new Request("https://w.test/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": sig } });
}
export const ctx = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} } as any;
export function inbound(from: string, m: Record<string, unknown>) {
  return { entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: "x" } }], messages: [{ id: `wamid.IN${Math.random()}`, from, timestamp: String(Math.floor(Date.now() / 1000)), ...m }] } }] }] };
}
