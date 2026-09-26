// § 41 (2026-09-26) — the pre-launch fixes, parts أ to هـ, and the simulation's isolation.
//
//   [أ] the VAT inside the profit: from 2026-10-01 the unit profit, the
//       order's profit in the discount guard and the day's profit in the 21:30
//       coverage line are net of VAT — a registered source (x_vat_registered)
//       ÷ 1.15, an unregistered one sale ÷ 1.15 − purchase − waste; the
//       discount off before the division; nothing divided before the cutoff.
//   [ب] the daily «المحطات فارغ» alert is gone; the discount stays off while
//       «عدد المحطات اليومية المخطط» is empty.
//   [ج] the invoice at «تم التسليم» (م18): issued and sent at that moment
//       whatever was collected (all, part, nothing), its supply / issue time
//       and number from that moment's Riyadh day; collections record payments
//       on it; the rest stays due and م2 reminds it; one invoice per order (KV
//       claim + x_invoice_sent_at); no invoice for a simulation order.
//   [سعر] found building [ج]: an order's lines are priced at the ORDER's day
//       (the published price it was confirmed at), not the day the invoice is
//       issued (delivery, the next morning, often before 06:00's list).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind a strict schema
// gate built from the real field lists (fields_get on the tenant, read-only:
// tests/fixtures-odoo-fields-20260926-s41.json, after each part's --apply): an
// unknown field, or a selection value the field does not have, is answered the
// way Odoo answers it (HTTP 500). No network, no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s41.test.mts

import { readFileSync } from "node:fs";
import {
  OWNER, closeOwnerWindow, ctx as harnessCtx, employee, graph, heldFor, inbound, openWindow, quiet, reset, rows, seed, sentTo, setRiyadh,
  signed, table, workSchedule,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const FIX = [
  "fixtures-odoo-fields-20260924.json",
  "fixtures-odoo-fields-20260925-review.json",
  "fixtures-odoo-fields-20260925-team.json",
  "fixtures-odoo-fields-20260925-gateway.json",
  "fixtures-odoo-fields-20260925-s36.json",
  "fixtures-odoo-fields-20260925-s37.json",
  "fixtures-odoo-fields-20260926-b3.json",
  "fixtures-odoo-fields-20260926-s39.json",
  "fixtures-odoo-fields-20260926-s40.json",
  "fixtures-odoo-fields-20260926-s41.json",       // § 41: every model the parts read or write (last: it wins)
].map((f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")));
const REAL: Record<string, string[]> = Object.assign({}, ...FIX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FIX.map((f) => f._selections ?? {}));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
/** What the fake extractor (Claude) answers: {prices, unrecognized}. */
let extractOut: { prices: unknown[]; unrecognized: string[] } = { prices: [], unrecognized: [] };
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(extractOut) }] }), { status: 200 });
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
const CFG = await import("../src/config.ts");
const EN = await import("../src/pricing-engine.ts");
const PR = await import("../src/prices.ts");
const OP = await import("../src/order-pricing.ts");
const SUM = await import("../src/owner-summary.ts");
const { CUST: C1 } = await import("./wa-harness.mts");

// ---------------------------------------------------------------- data
const DRIVER = 603, DRIVER_PHONE = "966500000603";
const DRIVER_ROLE = 72;
const OMAR_EMP = 7000 + DRIVER;
const AHMED = 801, AHMED_PHONE = "966500000801";
/** Saturday–Thursday 02:00–12:00 (Odoo dayofweek: Monday 0 … Sunday 6; Friday 4 is off), as Omar's «UTAK — عمر». */
const SAT_THU: Array<[number, number, number]> = [[5, 2, 12], [6, 2, 12], [0, 2, 12], [1, 2, 12], [2, 2, 12], [3, 2, 12]];

function fresh(riyadh: string, o: { onAttendance?: boolean } = {}): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0;
  seed("res.partner", { id: DRIVER, name: "عمر المجهلي", x_whatsapp_number: "+" + DRIVER_PHONE });
  const cal = workSchedule(SAT_THU, { name: "UTAK — عمر" });
  employee(DRIVER, [DRIVER_ROLE], { x_utak_attendance: o.onAttendance !== false, resource_calendar_id: cal });
  extractOut = { prices: [], unrecognized: [] };
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  Object.assign(table("product.template").get(1)!, { sale_ok: true, x_is_active_for_sale: true });
  Object.assign(table("product.template").get(2)!, { sale_ok: true, x_is_active_for_sale: true });
  table("x_product_packaging").get(11)!.x_is_default = true;
  table("x_product_packaging").get(21)!.x_is_default = true;
  seed("x_pricing_config", {
    id: 1, x_name: "UTAK Default Pricing (Launch)", x_is_active: true, x_active_from: "2026-08-29", x_active_to: false,
    x_operations_margin_percent: 15, x_profit_margin_percent: 20, x_waste_pct: 5, x_min_order_sar: 150, x_planned_stops: 0,
  });
  return env;
}
/** Ahmed (supplier) and Omar (employee) are the two sources; «مسجل في الضريبة» as given (the tenant: both true). */
function sources(o: { ahmed?: boolean; omar?: boolean } = {}): void {
  seed("res.partner", { id: AHMED, name: "أحمد حسان", supplier_rank: 5, x_whatsapp_number: "+" + AHMED_PHONE, x_supplied_product_ids: [1, 2], x_price_source: true, x_vat_registered: o.ahmed ?? true });
  Object.assign(table("hr.employee").get(OMAR_EMP)!, { x_price_source: true, x_vat_registered: o.omar ?? true });
}
function cost(name: string, frequency: string, amount: number, from: string): number {
  return seed("x_operating_cost", { x_name: name, x_cost_type: "variable", x_frequency: frequency, x_amount: amount, x_date_from: from, x_date_to: false, x_utak_simulation: false });
}
const dp = (product: number, packaging: number, supplier: number, p: number, day: string) =>
  seed("x_daily_price", { x_product_tmpl_id: product, x_packaging_id: packaging, x_supplier_id: supplier, x_price_sar: p, x_date: day, x_extraction_status: "extracted" });
const po = (product: number, packaging: number, partner: number, day: string, o: { purchase?: number; market?: number } = {}) =>
  seed("x_price_offer", {
    x_product_tmpl_id: product, x_packaging_id: packaging, x_source_partner_id: partner, x_date: day,
    x_purchase_price: o.purchase ?? 0, x_market_price: o.market ?? 0, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false,
  });
const dayOf = (d: string) => rows("x_price_day").find((r: any) => r.x_date === d);
const lineFor = (product: number, d: string) => rows("x_price_day_line").find((l: any) => l.x_day_id === dayOf(d)?.id && l.x_product_tmpl_id === product);
const offer = (o: Partial<import("../src/pricing-engine.ts").EngineOffer>) =>
  ({ kind: "market", price: 0, outlier: false, partnerId: 1, sourceName: "م", productId: 1, packagingId: 11, model: "po", rowId: 1, ...o }) as any;
const ITEM = { productId: 1, productName: "طماطم", packagingId: 11, packagingName: "كرتون" };
/** The three tiers of the tenant, and the planned stops. */
function tiers(stops: number): void {
  seed("x_pricing_tier", { x_config_id: 1, x_sequence: 1, x_amount_from: 0, x_amount_to: 499.99, x_discount_pct: 0, x_active: true });
  seed("x_pricing_tier", { x_config_id: 1, x_sequence: 2, x_amount_from: 500, x_amount_to: 1000, x_discount_pct: 2, x_active: true });
  seed("x_pricing_tier", { x_config_id: 1, x_sequence: 3, x_amount_from: 1000.01, x_amount_to: 0, x_discount_pct: 3, x_active: true });
  table("x_pricing_config").get(1)!.x_planned_stops = stops;
}
/** A published line: tomato bought at `cost` from `source`, sold at `sale` (the engine's day). */
function publishedTomato(day: string, cost = 20, sale = 30, source: number = AHMED): void {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: `أسعار ${day}` });
  seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: cost, x_market_price: sale, x_sale_price: sale, x_supplier_id: source, x_status: "auto", x_excluded: false, x_blocked: false });
}
const line = (qty: number, unit = 30, product = 1, packaging = 11) => ({ productId: product, packagingId: packaging, qty, unit });

// ================================================================ [أ]
console.log("\n[أ] the rule: (sale − purchase − waste) ÷ 1.15 registered, sale ÷ 1.15 − purchase − waste not; nothing before 10-01");
{
  assert("the rate: 09-30 → none, 10-01 → 15", CFG.profitVatRate("2026-09-30") === null && CFG.profitVatRate("2026-10-01") === 15 && CFG.PROFIT_VAT_RATE_PCT === 15);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  assert("before the cutoff: 24 − 20 − 5 % × 20 = 3, not divided", EN.vatProfit(24, 20, 5, null, true) === 3 && EN.vatProfit(24, 20, 5, null, false) === 3);
  assert("from the cutoff, registered: (24 − 20 − 1) ÷ 1.15 = 2.61", r2(EN.vatProfit(24, 20, 5, 15, true)) === 2.61);
  assert("from the cutoff, not registered: 24 ÷ 1.15 − 20 − 1 = −0.13", r2(EN.vatProfit(24, 20, 5, 15, false)) === -0.13);
  assert("waste = waste % × purchase (10 % of 40 = 4): (60 − 40 − 4) ÷ 1.15 = 13.91", r2(EN.vatProfit(60, 40, 10, 15, true)) === 13.91);
  const dp20 = offer({ kind: "purchase", price: 20, partnerId: AHMED, model: "dp", rowId: 5 });
  const m24 = offer({ kind: "market", price: 24, partnerId: DRIVER, rowId: 6 });
  const [pre] = EN.computePricing([ITEM], [dp20, m24], 5);
  assert("the engine without a VAT context (as before): 3, automatic", pre.unitProfit === 3 && pre.exceptions.length === 0, JSON.stringify(pre));
  const [reg] = EN.computePricing([ITEM], [dp20, m24], 5, { ratePct: 15, registered: () => true });
  assert("the engine, registered winner: 2.61, automatic", reg.unitProfit === 2.61 && reg.exceptions.length === 0, JSON.stringify(reg));
  const [un] = EN.computePricing([ITEM], [dp20, m24], 5, { ratePct: 15, registered: (p) => p !== AHMED });
  assert("the engine, unregistered winner: −0.13 → «ربح الوحدة ≤ 0 (-0.13)»", un.unitProfit === -0.13 && un.exceptions.join() === "no_profit" && un.reason === "ربح الوحدة ≤ 0 (-0.13)", JSON.stringify(un));
  const [who] = EN.computePricing([ITEM], [dp20, offer({ kind: "purchase", price: 19, partnerId: DRIVER, rowId: 7 }), m24], 5, { ratePct: 15, registered: (p) => p !== DRIVER });
  assert("the registration of the source that WON the purchase counts (Omar's 19 won, he is not registered): 24 ÷ 1.15 − 19 − 0.95 = 0.92",
    who.purchase === 19 && who.unitProfit === 0.92, JSON.stringify(who));
}

console.log("\n[أ] the engine on the day: 09-30 not divided, 10-01 divided — registered and not");
for (const [day, ahmedReg, want, status] of [
  ["2026-09-30", true, 3, "auto"], ["2026-10-01", true, 2.61, "auto"], ["2026-10-01", false, -0.13, "exception"], ["2026-09-30", false, 3, "auto"],
] as Array<[string, boolean, number, string]>) {
  const env = fresh(`${day} 04:10`, { onAttendance: false }); sources({ ahmed: ahmedReg });
  dp(1, 11, AHMED, 20, day); po(1, 11, DRIVER, day, { market: 24 });
  const r = await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1, day)!;
  assert(`${day}, Ahmed ${ahmedReg ? "registered" : "not registered"}: x_unit_profit ${want}, ${status}`,
    r.action === "refreshed" && t.x_unit_profit === want && t.x_status === status && (status === "auto" ? t.x_sale_price === 24 : t.x_excluded === true), JSON.stringify(t));
}
{
  const env = fresh("2026-10-01 04:10", { onAttendance: false }); sources({ ahmed: true });
  dp(1, 11, AHMED, 20, "2026-10-01"); po(1, 11, DRIVER, "2026-10-01", { market: 24 });
  await quiet(() => PR.refreshPriceDay(env));
  assert("before: 2.61 automatic", lineFor(1, "2026-10-01")!.x_unit_profit === 2.61);
  table("res.partner").get(AHMED)!.x_vat_registered = false;
  await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1, "2026-10-01")!;
  assert("Baraa unticks «مسجل في الضريبة» on Ahmed: the next run recomputes (not «unchanged») → −0.13, an exception",
    t.x_unit_profit === -0.13 && t.x_status === "exception", JSON.stringify(t));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] the discount guard: the order's profit net of VAT, the discount off before the division");
{
  const env = fresh("2026-09-30 10:00"); sources(); tiers(3); publishedTomato("2026-09-30");
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-09-01");
  const d = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(20)], vatRate: async () => null }));
  assert("09-30: profit 20 × (30 − 20 − 1) = 180, after the 2 % (12) 168 ≥ 500 ÷ 3 = 166.67 → applied",
    d.applied && d.profitBefore === 180 && d.profitAfter === 168 && d.minProfit === 166.67, JSON.stringify(d));
}
{
  const env = fresh("2026-10-01 10:00"); sources(); tiers(3); publishedTomato("2026-10-01");
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-09-01");
  const d = await quiet(() => OP.orderDiscount(env, { day: "2026-10-01", lines: [line(20)], vatRate: async () => 15 }));
  assert("10-01, registered: profit 180 ÷ 1.15 = 156.52; the discount 2 % of the net 521.74 = 10.43",
    d.profitBefore === 156.52 && d.tierPct === 2, JSON.stringify(d));
  assert("…after it: (180 − 11.99 the customer's total drops by) ÷ 1.15 = 146.10 < 166.67 → no discount (the same order got one on 09-30)",
    !d.applied && d.profitAfter === 146.1 && d.amount === 0 && /أقل من 166.67/.test(d.reason), JSON.stringify(d));
  table("x_pricing_config").get(1)!.x_planned_stops = 10;
  const d2 = await quiet(() => OP.orderDiscount(env, { day: "2026-10-01", lines: [line(20)], vatRate: async () => 15 }));
  assert("10 planned stops (50): applied, 10.43, profit after 146.10", d2.applied && d2.amount === 10.43 && d2.profitAfter === 146.1, JSON.stringify(d2));
  table("res.partner").get(AHMED)!.x_vat_registered = false;
  const d3 = await quiet(() => OP.orderDiscount(env, { day: "2026-10-01", lines: [line(20)], vatRate: async () => 15 }));
  assert("Ahmed not registered: 20 × (30 ÷ 1.15 − 21) = 101.74, after the discount 91.31",
    d3.profitBefore === 101.74 && d3.profitAfter === 91.31, JSON.stringify(d3));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] 21:30 coverage: the day's profit net of VAT from 10-01 (the deliveries are invoiced today)");
function deliveredYesterday(day: string, yday: string, source: number): void {
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-09-01");
  publishedTomato(yday, 20, 30, source);
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: yday, x_created_via: "whatsapp" });
  seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 20, x_unit_price: 30, x_status: "delivered" });
  seed("x_invoice", { x_invoice_number: `UTAK-INV-${day.replace(/-/g, "")}-001`, x_order_id: id, x_invoice_date: day, x_status: "issued", x_subtotal: 600, x_tax_amount: 0, x_total: 600 });
}
{
  const env = fresh("2026-09-30 21:30"); sources(); deliveredYesterday("2026-09-30", "2026-09-29", AHMED);
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("09-30: 20 × 9 = 180, not divided → 36 %", f.coverage.profit === 180 && f.coverage.pct === 36, JSON.stringify(f.coverage));
}
{
  const env = fresh("2026-10-01 21:30"); sources(); deliveredYesterday("2026-10-01", "2026-09-30", AHMED);
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("10-01, registered: 180 ÷ 1.15 = 156.52 → 31 %", f.coverage.profit === 156.52 && f.coverage.pct === 31, JSON.stringify(f.coverage));
  assert("…«تغطية تكاليف اليوم: 31% (ربح 156.52 من 500.00)»", SUM.coverageLine(f.coverage) === "تغطية تكاليف اليوم: 31% (ربح 156.52 من 500.00)", SUM.coverageLine(f.coverage));
  table("res.partner").get(AHMED)!.x_vat_registered = false;
  const g = await quiet(() => SUM.readSummaryFigures(env));
  assert("10-01, not registered: 20 × (30 ÷ 1.15 − 21) = 101.74 → 20 %", g.coverage.profit === 101.74 && g.coverage.pct === 20, JSON.stringify(g.coverage));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب]
console.log("\n[ب] «عدد المحطات اليومية المخطط» empty: no alert to Baraa, and still no discount");
{
  const env = fresh("2026-10-03 05:55"); sources(); tiers(0); publishedTomato("2026-10-03");
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-09-01");
  const ownerLines = () => sentTo(OWNER).map((b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? b?.template?.name ?? ""));
  for (const t of ["05:55", "06:00", "06:05", "09:00", "12:00", "18:00"]) {
    setRiyadh(`2026-10-03 ${t}`);
    const tick: any = await quiet(() => PR.runPricesTick(env, Date.now()));
    assert(`${t}: the prices tick has no «stops» step`, !("stops" in tick), JSON.stringify(Object.keys(tick)));
  }
  assert("no «المحطات» alert to Baraa all day", !ownerLines().some((x) => /عدد المحطات اليومية المخطط/.test(x)), JSON.stringify(ownerLines()));
  assert("…and no KV key of it (pricing_stops*)", ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.includes("pricing_stops")), [...env.MSG_DEDUP.store.keys()].join(","));
  setRiyadh("2026-10-04 06:00");
  await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("the next day neither", !ownerLines().some((x) => /عدد المحطات اليومية المخطط/.test(x)));
  setRiyadh("2026-10-03 10:00");
  const d = await quiet(() => OP.orderDiscount(env, { day: "2026-10-03", lines: [line(20)], vatRate: async () => 15 }));
  assert("the discount stays off while the field is empty (600 in the 2 % tier)", !d.applied && d.tierPct === 2 && d.amount === 0 && /فارغ/.test(d.reason), JSON.stringify(d));
  table("x_pricing_config").get(1)!.x_planned_stops = 10;
  const d2 = await quiet(() => OP.orderDiscount(env, { day: "2026-10-03", lines: [line(20)], vatRate: async () => 15 }));
  assert("filled (10): the discount comes back (10.43)", d2.applied && d2.amount === 10.43, JSON.stringify(d2));
  const src = ["order-pricing.ts", "prices.ts", "index.ts"].map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).join("\n");
  assert("no sender of it left in the code (checkPlannedStops, its text)", !/checkPlannedStops|STOPS_ALERT_TEXT|حتى يُعبَّأ/.test(src));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ج]
const INV = await import("../src/invoice.ts");
const { dispatch } = await import("../src/router.ts");
const OUT = await import("../src/outreach.ts");
const { ALREADY_DONE_TEXT } = await import("../src/button-lock.ts");
const { CUST_PHONE: C1_PHONE, COLL, partnerOf, openWindow: openWin } = await import("./wa-harness.mts");
const tapAs = (env: any, buttonId: string, who: number) =>
  quiet(() => dispatch(env, {
    msg: { messageId: `w${Math.random()}`, from: "+x", fromRaw: "x", profileName: "", text: "", timestamp: "", type: "button", buttonId },
    intent: "other", senderType: "customer", partner: partnerOf(who),
  }));
const replyOf = (r: any) => String(r?.text ?? r?.bodyBeforeButtons ?? "");
/** An order of `day` on its way (in_delivery, a stop), priced by the day's published tomato (30). */
function onTheWay(day: string, qty = 5, extra: Record<string, unknown> = {}): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: "in_delivery", x_order_date: day, x_created_via: "whatsapp", x_delivery_neighborhood: "العليا", ...extra });
  seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: qty, x_status: "pending" });
  seed("x_delivery_stop", { x_order_id: id, x_status: "pending" });
  return id;
}
const invoiceOf = (orderId: number) => rows("x_invoice").filter((i: any) => i.x_order_id === orderId);
/** The customer's invoice message (the text inside the window; a template otherwise). */
const invoiceSends = () => sentTo(C1_PHONE).filter((b: any) => /فاتورتك رقم/.test(String(b?.text?.body ?? "")) || /invoice/.test(String(b?.template?.name ?? "")));
/** The order's day and the delivery day both at 30 (the order-day pricing itself is tested in [سعر اليوم]). */
function deliveryEnv(riyadh: string, day: string): any {
  const env = fresh(riyadh); sources(); publishedTomato(day, 20, 30);
  const today = riyadh.slice(0, 10);
  if (today !== day) publishedTomato(today, 20, 30);
  openWin(env, C1_PHONE);
  return env;
}

console.log("\n[ج] «تم التسليم» with nothing collected: the invoice is issued and sent at that moment");
{
  const env = deliveryEnv("2026-09-27 08:40", "2026-09-26");
  const o = onTheWay("2026-09-26");
  const r = await tapAs(env, `delivered_${o}`, DRIVER);
  const [inv] = invoiceOf(o);
  assert("the driver's reply «تم التسليم ✅»", /تم التسليم ✅/.test(replyOf(r)), replyOf(r));
  assert("one x_invoice: 5 × 30 = 150, issued, no payment", invoiceOf(o).length === 1 && inv.x_total === 150 && inv.x_status === "issued" && rows("x_payment").length === 0, JSON.stringify(inv));
  assert("its supply / issue time = the moment of «تم التسليم» (x_issued_at 05:40 UTC = 08:40 Riyadh)", inv.x_issued_at === "2026-09-27 05:40:00", String(inv.x_issued_at));
  assert("its date = that Riyadh day (09-27), its number UTAK-INV-20260927-001", inv.x_invoice_date === "2026-09-27" && inv.x_invoice_number === "UTAK-INV-20260927-001", `${inv.x_invoice_date} ${inv.x_invoice_number}`);
  assert("the customer gets it now, once (x_invoice_sent_at + x_sent_to_customer_at set)", invoiceSends().length === 1 && !!inv.x_invoice_sent_at && !!inv.x_sent_to_customer_at, JSON.stringify(sentTo(C1_PHONE).map((b: any) => b?.text?.body ?? b?.template?.name)));
  assert("…a plain «فاتورة» before 10-01: no VAT line in the message", !/ضريبة/.test(String(invoiceSends()[0]?.text?.body ?? "")), String(invoiceSends()[0]?.text?.body));
  assert("the collector gets the collection request", sentTo("966500000602").length >= 1 || heldFor(env, "966500000602").length >= 1);
  setRiyadh("2026-09-30 08:00");
  const owed = await quiet(() => OUT.owedByCustomer(env));
  assert("nothing collected: the whole 150 stays due, and م2 (3 days later) reminds it", owed.get(C1)?.amount === 150 && owed.get(C1)?.invoices[0] === inv.x_invoice_number, JSON.stringify([...owed]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] a partial collection after it: a payment on the invoice, the rest due, no second invoice");
{
  const env = deliveryEnv("2026-09-27 09:00", "2026-09-26");
  const o = onTheWay("2026-09-26", 10);
  await tapAs(env, `delivered_${o}`, DRIVER);
  const [inv] = invoiceOf(o);
  const sent0 = invoiceSends().length;
  const p = await quiet(() => INV.recordCollection(env, { invoiceId: inv.id, method: "transfer", amount: 100 }));
  assert("the partial 100 of 300: a payment, the invoice still issued, the order not closed", p.paymentId !== null && !p.fullyPaid && table("x_invoice").get(inv.id)!.x_status === "issued" && table("x_daily_order").get(o)!.x_state === "delivered", JSON.stringify(p));
  assert("no invoice message from the collection (it went at delivery)", invoiceSends().length === sent0 && sent0 === 1);
  assert("…and no second x_invoice", invoiceOf(o).length === 1);
  setRiyadh("2026-09-30 08:00");
  const owed = await quiet(() => OUT.owedByCustomer(env));
  assert("the rest (200) stays due: م2 reminds 200", owed.get(C1)?.amount === 200, JSON.stringify([...owed]));
}

console.log("\n[ج] full collection after it: paid, the order closed, still one invoice message");
{
  const env = deliveryEnv("2026-09-27 09:00", "2026-09-26");
  const o = onTheWay("2026-09-26", 4);
  await tapAs(env, `delivered_${o}`, DRIVER);
  const [inv] = invoiceOf(o);
  const t = await tapAs(env, `collect_cash_${inv.id}`, COLL);
  assert("the collector's tap: «تم تسجيل التحصيل نقد»", /تم تسجيل التحصيل نقد/.test(replyOf(t)), replyOf(t));
  assert("paid 120, the order closed", table("x_invoice").get(inv.id)!.x_status === "paid" && table("x_daily_order").get(o)!.x_state === "closed" && rows("x_payment").length === 1 && rows("x_payment")[0].x_amount === 120);
  assert("one invoice message in all (at delivery)", invoiceSends().length === 1);
  setRiyadh("2026-09-30 08:00");
  assert("nothing due: م2 has nothing for the customer", !(await quiet(() => OUT.owedByCustomer(env))).has(C1));
}

console.log("\n[ج] one invoice per order: a second tap, a retry, a claim held, a sent one");
{
  const env = deliveryEnv("2026-09-27 09:00", "2026-09-26");
  const o = onTheWay("2026-09-26");
  await tapAs(env, `delivered_${o}`, DRIVER);
  const t2 = await tapAs(env, `delivered_${o}`, DRIVER);
  assert("a second «تم التسليم»: «تم مسبقاً», still one invoice, one message", replyOf(t2) === ALREADY_DONE_TEXT && invoiceOf(o).length === 1 && invoiceSends().length === 1, replyOf(t2));
  const again = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o));
  assert("the issue called again (a retry): the same x_invoice, nothing created or sent", again?.invoiceId === invoiceOf(o)[0].id && invoiceOf(o).length === 1 && invoiceSends().length === 1);
  env.MSG_DEDUP.store.delete(`btnlock:v1:invoice_issue:${o}`);
  const lost = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o));
  assert("the KV claim lost (expired, or KV down): the order's x_invoice alone stops a second one", lost?.invoiceId === invoiceOf(o)[0].id && invoiceOf(o).length === 1 && invoiceSends().length === 1);
  const o2 = onTheWay("2026-09-26");
  env.MSG_DEDUP.store.set(`btnlock:v1:invoice_issue:${o2}`, "run:1:x");
  const held = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o2));
  assert("another issue of the same order running (its KV claim): no invoice created", held === null && invoiceOf(o2).length === 0);
  env.MSG_DEDUP.store.delete(`btnlock:v1:invoice_issue:${o2}`);
  const ok2 = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o2));
  assert("…once it is gone: issued (UTAK-INV-20260927-002), and the claim kept «done»", ok2?.number === "UTAK-INV-20260927-002" && String(env.MSG_DEDUP.store.get(`btnlock:v1:invoice_issue:${o2}`)).startsWith("done:"), JSON.stringify(ok2));
  const inv = invoiceOf(o)[0];
  const n = invoiceSends().length;
  const r1 = await quiet(() => INV.sendIssuedInvoice(env, inv.id, inv.x_invoice_number, async () => { throw new Error("must not be called"); }));
  assert("x_invoice_sent_at set: the send is skipped («already_sent»)", r1 === "already_sent" && invoiceSends().length === n);
  table("x_invoice").get(inv.id)!.x_invoice_sent_at = false;
  const r2 = await quiet(() => INV.sendIssuedInvoice(env, inv.id, inv.x_invoice_number, async () => { throw new Error("meta down"); }));
  const alerts = sentTo(OWNER).map((b: any) => String(b?.text?.body ?? ""));
  assert("a failed send releases x_invoice_sent_at and alerts Baraa", r2 === "failed" && table("x_invoice").get(inv.id)!.x_invoice_sent_at === false && alerts.some((x) => /تعذّر إرسال الفاتورة للعميل عند التسليم/.test(x)), JSON.stringify(alerts));
}

console.log("\n[ج] the issue moment's Riyadh day: a delivery at 02:30 (23:30 UTC the day before)");
{
  const env = deliveryEnv("2026-10-01 02:30", "2026-09-30");
  seed("x_invoice", { x_invoice_number: "UTAK-INV-20261001-001", x_invoice_date: "2026-10-01", x_total: 1, x_status: "issued", x_utak_simulation: true });
  seed("x_invoice", { x_invoice_number: "UTAK-INV-20260930-004", x_invoice_date: "2026-09-30", x_total: 1, x_status: "issued" });
  seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.company", { id: 1, name: "شركة يوتاك ذات مسؤولية محدودة", vat: "315022736600003", account_sale_tax_id: [77, "15%"] });
  const o = onTheWay("2026-09-30");
  await tapAs(env, `delivered_${o}`, DRIVER);
  const [inv] = invoiceOf(o);
  assert("date 10-01 and number UTAK-INV-20261001-001: the Riyadh day (not the UTC 09-30), the serial without the simulation invoice of 10-01",
    inv.x_invoice_date === "2026-10-01" && inv.x_invoice_number === "UTAK-INV-20261001-001" && inv.x_issued_at === "2026-09-30 23:30:00", `${inv.x_invoice_date} ${inv.x_invoice_number} ${inv.x_issued_at}`);
  assert("…and VAT by that day: 150 = 130.43 + 19.57", inv.x_total === 150 && inv.x_tax_amount === 19.57 && inv.x_subtotal === 130.43, JSON.stringify(inv));
}

console.log("\n[ج] a simulation order: no invoice issued or sent");
{
  const env = deliveryEnv("2026-09-27 09:00", "2026-09-26");
  const o = onTheWay("2026-09-26", 5, { x_utak_simulation: true });
  const r = await tapAs(env, `delivered_${o}`, DRIVER);
  assert("delivered (the stop and the order), but no x_invoice and no invoice message", /تم التسليم/.test(replyOf(r)) && invoiceOf(o).length === 0 && invoiceSends().length === 0, replyOf(r));
  const direct = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o));
  assert("…and called directly: null", direct === null && invoiceOf(o).length === 0);
}

console.log("\n[ج] the 18:00 list and م2 by x_utak_simulation: a sim / pilot invoice (x_is_simulation) is chased");
{
  const env = deliveryEnv("2026-09-27 09:00", "2026-09-26");
  const o = onTheWay("2026-09-26");
  await tapAs(env, `delivered_${o}`, DRIVER);
  const inv = invoiceOf(o)[0];
  inv.x_is_simulation = true;                                  // every invoice of the sim / pilot worker
  const { getUnpaidInvoicesWithCustomer } = await import("../src/odoo.ts");
  const list = await quiet(() => getUnpaidInvoicesWithCustomer(env));
  assert("the 18:00 collection list has it", list.some((x) => x.id === inv.id), JSON.stringify(list));
  inv.x_utak_simulation = true;
  const list2 = await quiet(() => getUnpaidInvoicesWithCustomer(env));
  setRiyadh("2026-09-30 08:00");
  assert("…marked x_utak_simulation: neither the list nor م2", !list2.some((x) => x.id === inv.id) && !(await quiet(() => OUT.owedByCustomer(env))).has(C1));
  const src = readFileSync(new URL("../src/invoice.ts", import.meta.url), "utf8");
  assert("the «after full collection» send is gone from the code", !/function sendInvoiceToCustomerIfPaid|deferred until fully collected|sendInvoiceToCustomerIfPaid\(/.test(src));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [سعر]
const Q = await import("../src/quotation.ts");
const { getLatestSalePrice } = await import("../src/odoo.ts");
console.log("\n[سعر] the invoice at 05:00 (before 06:00's list): the order's day's price, not a purchase price");
{
  const env = fresh("2026-09-27 05:00"); sources(); openWin(env, C1_PHONE);
  publishedTomato("2026-09-26", 20, 30);                       // the order's day: sold at 30
  dp(1, 11, AHMED, 20, "2026-09-27");                          // 02:00 today: Ahmed's PURCHASE price 20, nothing published yet
  const o = onTheWay("2026-09-26", 5);
  await tapAs(env, `delivered_${o}`, DRIVER);
  const [inv] = invoiceOf(o);
  assert("5 × 30 = 150 (the price it was confirmed at), not 5 × 20 (today's purchase price)", inv?.x_total === 150, JSON.stringify(inv));
  const lines = rows("x_daily_order_line").filter((l: any) => l.x_order_id === o);
  assert("…and 30 written back on the line", lines.every((l: any) => l.x_unit_price === 30), JSON.stringify(lines));
}
{
  const env = fresh("2026-09-27 08:00"); sources(); openWin(env, C1_PHONE);
  publishedTomato("2026-09-26", 20, 30);
  publishedTomato("2026-09-27", 22, 33);                       // today's list (06:00): 33
  const o = onTheWay("2026-09-26", 5);
  await tapAs(env, `delivered_${o}`, DRIVER);
  assert("after 06:00 with today's list at 33: still 5 × 30 = 150 (the quoted price)", invoiceOf(o)[0]?.x_total === 150, JSON.stringify(invoiceOf(o)[0]));
  const o2 = onTheWay("2026-09-26", 5);                        // not invoiced yet: no price written on its lines
  const q = seed("x_quotation", { x_quotation_number: "UTAK-Q-20260926-001", x_order_id: o2, x_origin: "auto", create_date: "2026-09-26 12:00:00" });
  const qd = await quiet(() => Q.buildQuotationPDFDataFromOdoo(env, q));
  assert("its quotation rebuilt today (lines without a written price): the order's day's 30 too, not today's 33", qd?.items[0]?.price === 30 && qd?.subtotal === 150, JSON.stringify(qd?.items));
  assert("today's own orders still get today's price (33)", (await quiet(() => getLatestSalePrice(env, 1, 11))).price === 33);
  dp(2, 21, AHMED, 40, "2026-09-28");
  const fut = await quiet(() => getLatestSalePrice(env, 2, 21, "2026-09-26"));
  assert("the stale fallback never takes a later day's price (09-28 for 09-26 → missing)", fut.price === 0 && fut.source === "missing", JSON.stringify(fut));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
