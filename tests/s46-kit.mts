// § 46 — the shared kit of the § 46 tests (tests/s46-*.test.mts): the strict schema gate (every
// Odoo request must name fields and selection values the tenant has — the fixtures are read-only
// fields_get dumps), the assert / summary helpers, and the tenant-shaped world they all start from.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.

import { readFileSync } from "node:fs";
import { CUST, CUST_PHONE, OWNER, employee, reset, rows, seed, sentTo, setRiyadh, table, workSchedule } from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
export function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}
/** The last line of a test file: the counts, and exit 1 on any failure. */
export function done(): void {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log(failures.map((f) => `  ✗ ${f}`).join("\n")); process.exit(1); }
}

// ---------------------------------------------------------------- strict schema gate
export const FIX = [
  "fixtures-odoo-fields-20260924.json", "fixtures-odoo-fields-20260925-review.json", "fixtures-odoo-fields-20260925-team.json",
  "fixtures-odoo-fields-20260925-gateway.json", "fixtures-odoo-fields-20260925-s36.json", "fixtures-odoo-fields-20260925-s37.json",
  "fixtures-odoo-fields-20260926-b3.json", "fixtures-odoo-fields-20260926-s39.json", "fixtures-odoo-fields-20260926-s40.json",
  "fixtures-odoo-fields-20260926-s41.json", "fixtures-odoo-fields-20260927-s42.json", "fixtures-odoo-fields-20260928-s44.json",
  "fixtures-odoo-fields-20261001-s49.json",   // § 46 + § 47: the board's fields, x_expected_cartons, x_utak_new, x_break_even / x_suggested_price, x_decision «profit»; § 48: x_min_profit_sar, the preview, x_manual_for (last: it wins)
  "fixtures-odoo-fields-20261004-s51.json",   // § 51: x_extraction_status «flow», the price_ask_flow purpose (read last: it wins for the models both hold)
  "fixtures-odoo-fields-20261004-s52.json",   // § 52: account.journal and res.partner.bank (the transfer line), every model of § 51 again (read last: it wins)
  "fixtures-odoo-fields-20261004-s53.json",   // § 53: x_market_uplift_pct, x_uplift_pct, the purpose customer_pay_remind_iban, every model of § 52 again (read last: it wins)
  "fixtures-odoo-fields-20261005-s54.json",   // § 54: x_pricing_config.x_above_suggested «لما يكون السوق أعلى من المقترح», every model of § 53 again (read last: it wins)
  "fixtures-odoo-fields-20261005-s55.json",   // § 55: x_daily_order_line.x_ordered_qty / x_return_qty / x_return_reason (the delivery form), every model of § 54 again (read last: it wins)
].map((f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")));
const REAL: Record<string, string[]> = Object.assign({}, ...FIX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FIX.map((f) => f._selections ?? {}));
export const rejected: string[] = [];
/** What the extractor (Claude) answers: an order's items; null = the intent answer. */
let extractOut: unknown = null;
export function setExtract(v: unknown): void { extractOut = v; }
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(extractOut ?? { intent: "other", confidence: 0.9 }) }] }), { status: 200 });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body && typeof init.body === "string") {
    const b = JSON.parse(init.body);
    const writes: Array<Record<string, unknown>> = [b.vals ?? {}, ...((b.vals_list ?? []) as Array<Record<string, unknown>>)];
    const names = [
      ...((b.domain ?? []) as unknown[]).filter(Array.isArray).map((t: any) => String(t[0])),
      ...(b.fields ?? []),
      ...writes.flatMap((v) => Object.keys(v)),
    ];
    const bad = names.filter((f: string) => !known(m[1], f));
    const badSel = writes.flatMap((v) => Object.entries(v))
      .filter(([k, val]) => SELECTIONS[`${m[1]}.${k}`] && val !== false && !SELECTIONS[`${m[1]}.${k}`].includes(String(val)))
      .map(([k, val]) => `${k}=${val}`);
    if (bad.length || badSel.length) {
      rejected.push(`${m[1]}.${m[2]}: ${[...bad, ...badSel].join(",")}`);
      const message = bad.length ? `Invalid field '${bad[0]}' on '${m[1]}'` : `Wrong value for ${badSel[0]}`;
      return new Response(JSON.stringify({ name: "builtins.ValueError", message, arguments: [message] }), { status: 500 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const { setOdooRetryHooksForTests } = await import("../src/odoo.ts");
setOdooRetryHooksForTests({ sleep: async () => {}, alert: async () => {} });
const { clearTemplateCache } = await import("../src/templates.ts");

// ---------------------------------------------------------------- data
export const C1 = CUST, C1_PHONE = CUST_PHONE;
export const DRIVER = 603, DRIVER_PHONE = "966500000603";
export const AHMED = 801, AHMED_PHONE = "966500000801";
export const OMAR_EMP = 7000 + DRIVER;
export const DAY = "2026-10-03";
export const ALL_WEEK: Array<[number, number, number]> = [[5, 2, 12], [6, 2, 12], [0, 2, 12], [1, 2, 12], [2, 2, 12], [3, 2, 12], [4, 2, 12]];
export const ownerTexts = () => sentTo(OWNER).map((b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? ""));

/** The tenant's shape: Omar (driver, a source), Ahmed (supplier, a source), both «مسجل في الضريبة»; four active products. */
export function fresh(riyadh = `${DAY} 03:00`): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0;
  seed("res.partner", { id: DRIVER, name: "عمر المجهلي", x_whatsapp_number: "+" + DRIVER_PHONE });
  employee(DRIVER, [72], { x_utak_attendance: false, resource_calendar_id: workSchedule(ALL_WEEK, { name: "UTAK — عمر" }), x_price_source: true, x_vat_registered: true });
  seed("res.partner", { id: AHMED, name: "أحمد حسان", supplier_rank: 5, x_whatsapp_number: "+" + AHMED_PHONE, x_supplied_product_ids: [1, 2], x_price_source: true, x_vat_registered: true });
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  Object.assign(table("product.template").get(1)!, { sale_ok: true, x_is_active_for_sale: true });
  Object.assign(table("product.template").get(2)!, { sale_ok: true, x_is_active_for_sale: true });
  seed("product.template", { id: 3, name: "بطاطس", sale_ok: true, x_is_active_for_sale: true });
  seed("product.template", { id: 4, name: "بصل", sale_ok: true, x_is_active_for_sale: true });
  seed("x_product_packaging", { id: 31, x_name: "كرتون", x_product_tmpl_id: 3, x_is_default: true });
  seed("x_product_packaging", { id: 41, x_name: "جرم", x_product_tmpl_id: 4, x_is_default: true });
  table("x_product_packaging").get(11)!.x_is_default = true;
  table("x_product_packaging").get(21)!.x_is_default = true;
  seed("x_pricing_config", {
    id: 1, x_name: "UTAK Default Pricing (Launch)", x_is_active: true, x_active_from: "2026-08-29", x_active_to: false,
    x_operations_margin_percent: 15, x_profit_margin_percent: 20, x_waste_pct: 5, x_min_order_sar: 150, x_planned_stops: 0, x_expected_cartons: 250, x_min_margin_pct: 5, x_min_profit_sar: 2,
  });
  return env;
}
export const cost = (amount: number, from = "2026-09-01", extra: Record<string, unknown> = {}) =>
  seed("x_operating_cost", { x_name: "السيارة والسائق (شامل)", x_cost_type: "variable", x_frequency: "daily", x_amount: amount, x_date_from: from, x_date_to: false, x_utak_simulation: false, ...extra });
export const dp = (product: number, packaging: number, p: number, day = DAY) =>
  seed("x_daily_price", { x_product_tmpl_id: product, x_packaging_id: packaging, x_supplier_id: AHMED, x_price_sar: p, x_date: day, x_extraction_status: "extracted" });
export const market = (product: number, packaging: number, p: number, day = DAY) =>
  seed("x_price_offer", { x_product_tmpl_id: product, x_packaging_id: packaging, x_source_partner_id: DRIVER, x_date: day, x_purchase_price: 0, x_market_price: p, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false });
export const dayOf = (d = DAY) => rows("x_price_day").find((r: any) => r.x_date === d) as any;
export const lineFor = (product: number, d = DAY) => rows("x_price_day_line").find((l: any) => l.x_day_id === dayOf(d)?.id && l.x_product_tmpl_id === product) as any;
/** A real delivery: an order delivered at `utc` with one line of `qty` cartons. */
export function deliveredAt(utc: string, qty: number, extra: Record<string, unknown> = {}, lineExtra: Record<string, unknown> = {}): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: utc.slice(0, 10), x_delivered_at: utc, x_created_via: "whatsapp", ...extra });
  seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: qty, x_status: "delivered", ...lineExtra });
  return id;
}
/**
 * The four lines of the board's day: 🟢 tomato, 🔴 cucumber, 🟡 potato, ⚪ onion. § 47 أ — the purchase
 * prices are net of VAT as entered (nothing is divided by 1.15); with a share of 2.00 and a minimum
 * profit of 2 riyals a carton (§ 48 أ) the suggested prices are 29.00, 36.00 and 26.50.
 */
export function fourLines(): void {
  dp(1, 11, 20); market(1, 11, 34.5);     // 20 + waste 1 + share 2 = 23; net sale 30 → +7; market ≥ 28 → automatic
  dp(2, 21, 26); market(2, 21, 31.05);    // 26 + waste 1.30 > net sale 27 → a loss on the goods; § 54: market < «بدون خسارة» 33.70 → an exception
  dp(3, 31, 18); market(3, 31, 23);       // 18 + waste 0.90 = 18.90 ≤ net sale 20 < 20.90 with the share; § 54: market < «بدون خسارة» 24.04 → an exception
}

