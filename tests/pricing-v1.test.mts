// Pricing engine v1 (STATUS § 40, 2026-09-26).
//
//   [أ] the operating costs: daily_operating_cost(day) — daily as is, monthly ÷
//       the month's working days, yearly ÷ the year's, «من / إلى», working days
//       from the driver's schedule (hr.employee), simulation lines out; the
//       pricing settings (waste %, minimum order, planned stops).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind a strict schema
// gate built from the real field lists (fields_get on the tenant, read-only:
// tests/fixtures-odoo-fields-20260926-s40.json, after each part's --apply): an
// unknown field, or a selection value the field does not have, is answered the
// way Odoo answers it (HTTP 500). No network, no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/pricing-v1.test.mts

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
  "fixtures-odoo-fields-20260926-b3.json",
  "fixtures-odoo-fields-20260926-s39.json",
  "fixtures-odoo-fields-20260926-s40.json",       // § 40: every model the engine reads or writes (last: it wins)
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
let claudeCalls = 0;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    claudeCalls++;
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
const OC = await import("../src/operating-cost.ts");
const PS = await import("../src/price-sources.ts");
const SUP = await import("../src/suppliers.ts");
const { flushTeamQueue } = await import("../src/team-queue.ts");
const worker = (await import("../src/index.ts")).default;

// ---------------------------------------------------------------- data
const DRIVER = 603, DRIVER_PHONE = "966500000603";
const DRIVER_ROLE = 72;
/** Saturday–Thursday 02:00–12:00 (Odoo dayofweek: Monday 0 … Sunday 6; Friday 4 is off), as Omar's «UTAK — عمر». */
const SAT_THU: Array<[number, number, number]> = [[5, 2, 12], [6, 2, 12], [0, 2, 12], [1, 2, 12], [2, 2, 12], [3, 2, 12]];

function fresh(riyadh = "2026-10-03 10:00", o: { driver?: boolean; onAttendance?: boolean } = {}): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0;
  if (o.driver !== false) {
    seed("res.partner", { id: DRIVER, name: "عمر المجهلي", x_whatsapp_number: "+" + DRIVER_PHONE });
    const cal = workSchedule(SAT_THU, { name: "UTAK — عمر" });
    employee(DRIVER, [DRIVER_ROLE], { x_utak_attendance: o.onAttendance !== false, resource_calendar_id: cal });
  }
  extractOut = { prices: [], unrecognized: [] }; claudeCalls = 0;
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  // the active catalog: طماطم (فلين 11) and خيار (جرم 21); بطاطس (31) not for sale today
  Object.assign(table("product.template").get(1)!, { sale_ok: true, x_is_active_for_sale: true });
  Object.assign(table("product.template").get(2)!, { sale_ok: true, x_is_active_for_sale: true });
  seed("product.template", { id: 3, name: "بطاطس", sale_ok: true, x_is_active_for_sale: false });
  seed("x_product_packaging", { id: 31, x_name: "كرتون", x_product_tmpl_id: 3, x_is_default: true });
  table("x_product_packaging").get(11)!.x_is_default = true;
  table("x_product_packaging").get(21)!.x_is_default = true;
  seed("x_pricing_config", {
    id: 1, x_name: "UTAK Default Pricing (Launch)", x_is_active: true, x_active_from: "2026-08-29", x_active_to: false,
    x_operations_margin_percent: 15, x_profit_margin_percent: 20, x_waste_pct: 5, x_min_order_sar: 150, x_planned_stops: 0,
  });
  return env;
}
function cost(name: string, frequency: string, amount: number, from: string, to: string | false = false, extra: Record<string, unknown> = {}): number {
  return seed("x_operating_cost", { x_name: name, x_cost_type: "variable", x_frequency: frequency, x_amount: amount, x_date_from: from, x_date_to: to, x_utak_simulation: false, ...extra });
}

// ================================================================ [أ]
console.log("\n[أ] daily_operating_cost: the daily line as is, and «من / إلى»");
{
  const env = fresh();
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  const d1 = await quiet(() => OC.dailyOperatingCost(env, "2026-10-01"));
  assert("2026-10-01: 500 (the first day, «من» inclusive)", d1.total === 500, JSON.stringify(d1));
  const d0 = await quiet(() => OC.dailyOperatingCost(env, "2026-09-30"));
  assert("2026-09-30: 0 (before «من»)", d0.total === 0 && d0.items.length === 0, JSON.stringify(d0));
  const fri = await quiet(() => OC.dailyOperatingCost(env, "2026-10-02"));
  assert("a Friday (driver's day off): the daily line still counts (500)", fri.total === 500, JSON.stringify(fri));
  cost("إيجار مؤقت", "daily", 40, "2026-10-01", "2026-10-10");
  const d10 = await quiet(() => OC.dailyOperatingCost(env, "2026-10-10"));
  const d11 = await quiet(() => OC.dailyOperatingCost(env, "2026-10-11"));
  assert("«إلى» inclusive: 10-10 = 540, 10-11 = 500", d10.total === 540 && d11.total === 500, `${d10.total} ${d11.total}`);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] monthly ÷ the month's working days, yearly ÷ the year's (the driver's schedule)");
{
  const env = fresh();
  cost("صيانة", "monthly", 2600, "2026-01-01");
  const sat = await quiet(() => OC.dailyOperatingCost(env, "2026-10-03"));
  assert("October 2026 has 26 working days (Saturday–Thursday)", sat.monthWorkingDays === 26, JSON.stringify(sat));
  assert("monthly 2600 on a working day → 100", sat.total === 100 && sat.workingDay === true, JSON.stringify(sat));
  const fri = await quiet(() => OC.dailyOperatingCost(env, "2026-10-02"));
  assert("monthly on the driver's day off (Friday) → 0", fri.total === 0 && fri.workingDay === false, JSON.stringify(fri));
  const sep = await quiet(() => OC.dailyOperatingCost(env, "2026-09-26"));
  assert("September 2026 has 26 working days too (4 Fridays of 30)", sep.monthWorkingDays === 26 && sep.total === 100, JSON.stringify(sep));
  const feb = await quiet(() => OC.dailyOperatingCost(env, "2026-02-02"));
  assert("February 2026: 24 working days → 108.33", feb.monthWorkingDays === 24 && feb.total === 108.33, JSON.stringify(feb));
}
{
  const env = fresh();
  cost("تأمين السيارة", "yearly", 31300, "2026-01-01");
  const d = await quiet(() => OC.dailyOperatingCost(env, "2026-10-03"));
  assert("2026 has 313 working days; yearly 31300 → 100", d.yearWorkingDays === 313 && d.total === 100, JSON.stringify(d));
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  cost("صيانة", "monthly", 2600, "2026-01-01");
  const all = await quiet(() => OC.dailyOperatingCost(env, "2026-10-03"));
  assert("daily 500 + monthly 2600 + yearly 31300 on Saturday 10-03 = 700", all.total === 700 && all.items.length === 3, JSON.stringify(all));
  const allFri = await quiet(() => OC.dailyOperatingCost(env, "2026-10-02"));
  assert("… and on Friday 10-02 = 500 (the daily line only)", allFri.total === 500, JSON.stringify(allFri));
}
{
  const env = fresh();
  cost("صيانة", "monthly", 3000, "2026-10-15", "2026-10-20");
  const in1 = await quiet(() => OC.dailyOperatingCost(env, "2026-10-15"));
  const out1 = await quiet(() => OC.dailyOperatingCost(env, "2026-10-14"));
  const out2 = await quiet(() => OC.dailyOperatingCost(env, "2026-10-21"));
  assert("a monthly line with «من / إلى»: 3000 ÷ 26 inside, nothing outside", in1.total === 115.38 && out1.total === 0 && out2.total === 0,
    `${in1.total} ${out1.total} ${out2.total}`);
}

console.log("\n[أ] no driver schedule → «تعذّر» (null), never a guess; simulation lines out");
{
  const env = fresh("2026-10-03 10:00", { driver: false });
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  const d = await quiet(() => OC.dailyOperatingCost(env, "2026-10-03"));
  assert("daily lines only: no schedule needed (500)", d.total === 500, JSON.stringify(d));
  cost("صيانة", "monthly", 2600, "2026-01-01");
  const n = await quiet(() => OC.dailyOperatingCost(env, "2026-10-03"));
  assert("a monthly line and no driver schedule → total null with the reason", n.total === null && /جدول دوام للسائق/.test(n.reason ?? ""), JSON.stringify(n));
}
{
  const env = fresh();
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  cost("سطر تجربة", "daily", 999, "2026-10-01", false, { x_utak_simulation: true });
  const d = await quiet(() => OC.dailyOperatingCost(env, "2026-10-03"));
  assert("a line marked x_utak_simulation is left out (500, not 1499)", d.total === 500 && d.items.length === 1, JSON.stringify(d));
}
{
  const env = fresh("2026-10-03 10:00", { onAttendance: false });
  cost("صيانة", "monthly", 2600, "2026-01-01");
  const d = await quiet(() => OC.dailyOperatingCost(env, "2026-10-03"));
  assert("a driver not on attendance: his schedule read directly (100)", d.total === 100 && d.monthWorkingDays === 26, JSON.stringify(d));
}
{
  const env = fresh("2026-10-03 10:00", { driver: false });
  // a warehouse member with a Monday–Friday schedule: never the working days
  const cal = workSchedule([[0, 8, 16], [1, 8, 16], [2, 8, 16], [3, 8, 16], [4, 8, 16]]);
  seed("res.partner", { id: 604, name: "مستودع", x_whatsapp_number: "+966500000604" });
  employee(604, [71], { x_utak_attendance: true, resource_calendar_id: cal });
  cost("صيانة", "monthly", 2600, "2026-01-01");
  const d = await quiet(() => OC.dailyOperatingCost(env, "2026-10-03"));
  assert("only the driver's schedule counts (no driver → null)", d.total === null, JSON.stringify(d));
}

console.log("\n[أ] the pricing settings (the active x_pricing_config)");
{
  const env = fresh();
  const s = await quiet(() => OC.readPricingSettings(env, "2026-10-03"));
  assert("waste 5 %, minimum 150, planned stops empty → null", s?.wastePct === 5 && s?.minOrder === 150 && s?.plannedStops === null, JSON.stringify(s));
  table("x_pricing_config").get(1)!.x_planned_stops = 12;
  const s2 = await quiet(() => OC.readPricingSettings(env, "2026-10-03"));
  assert("planned stops 12 → 12", s2?.plannedStops === 12, JSON.stringify(s2));
  table("x_pricing_config").get(1)!.x_is_active = false;
  const s3 = await quiet(() => OC.readPricingSettings(env, "2026-10-03"));
  assert("no active record → null", s3 === null, JSON.stringify(s3));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب]
const AHMED = 801, AHMED_PHONE = "966500000801";
const OMAR_EMP = 7000 + DRIVER;
const FAHD = 830, FAHD_PHONE = "966500000830";
/** Ahmed (supplier) and Omar (employee) are the two sources, as on the tenant. */
function sources(): void {
  seed("res.partner", { id: AHMED, name: "أحمد حسان", supplier_rank: 5, x_whatsapp_number: "+" + AHMED_PHONE, x_supplied_product_ids: [1, 2], x_price_source: true });
  table("hr.employee").get(OMAR_EMP)!.x_price_source = true;
}
const offers = () => rows("x_price_offer");
const item = (product: number, packaging: number, cost: number, market: number | null = null, qty: number | null = null) =>
  ({ product_id: product, packaging_id: packaging, cost_price: cost, market_price: market, available_qty: qty, actual_weight_kg: null, notes: null });
const askTexts = (digits: string) => sentTo(digits).filter((b) => b?.type === "text" && /أرسل أسعار السوق اليوم/.test(String(b.text?.body ?? "")));
const queueOf = (env: any, digits: string) => JSON.parse(env.MSG_DEDUP.store.get(`pending_loc:+${digits}`) ?? "[]");
const omar = { partnerId: DRIVER, name: "عمر المجهلي" };

console.log("\n[ب] «سوق» / «شراء» beside the number: the kind comes from the message itself");
{
  const c = PS.classifyOffer;
  const j = (x: unknown) => JSON.stringify(x);
  let r = c({ cost_price: 20 }, "طماطم 20", "supplier");
  assert("supplier «طماطم 20» → purchase 20", r.purchase === 20 && r.market === undefined, j(r));
  r = c({ cost_price: 20, market_price: 24 }, "طماطم 20 السوق 24", "supplier");
  assert("supplier «طماطم 20 السوق 24» → purchase 20, market 24", r.purchase === 20 && r.market === 24, j(r));
  r = c({ cost_price: 24 }, "طماطم سوق 24", "supplier");
  assert("supplier «طماطم سوق 24» (the extractor said cost) → market 24, no purchase", r.market === 24 && r.purchase === undefined, j(r));
  r = c({ cost_price: 24 }, "طماطم 24 بالسوق", "supplier");
  assert("supplier «طماطم 24 بالسوق» → market", r.market === 24 && r.purchase === undefined, j(r));
  r = c({ cost_price: 20, market_price: 24 }, "طماطم 20 سوق 24", "supplier");
  assert("«20 سوق 24»: the keyword belongs to 24 → purchase 20, market 24", r.purchase === 20 && r.market === 24, j(r));
  r = c({ market_price: 24 }, "طماطم 24", "supplier");
  assert("supplier: labelled market by the extractor but no «سوق» beside it → a purchase price", r.purchase === 24 && r.market === undefined, j(r));
  r = c({ cost_price: 24 }, "طماطم ٢٤ السوق", "supplier");
  assert("Arabic-Indic digits: «٢٤ السوق» → market 24", r.market === 24, j(r));
  r = c({ cost_price: 25 }, "طماطم 20", "supplier");
  assert("a number not written in the message → nothing (م6)", r.purchase === undefined && r.market === undefined && r.dropped.length === 1, j(r));
  r = c({ cost_price: 24 }, "طماطم 24", "observer");
  assert("observer (Omar) «طماطم 24» → market 24", r.market === 24 && r.purchase === undefined, j(r));
  r = c({ cost_price: 20, market_price: 24 }, "طماطم 24 شراء 20", "observer");
  assert("observer «طماطم 24 شراء 20» → market 24, purchase 20", r.market === 24 && r.purchase === 20, j(r));
  r = c({ cost_price: 20 }, "طماطم الشراء 20", "observer");
  assert("observer «طماطم الشراء 20» → purchase 20 only", r.purchase === 20 && r.market === undefined, j(r));
  r = c({ cost_price: 24, available_qty: 30 }, "طماطم 24 متوفر 30", "observer");
  assert("the available quantity written → kept (30)", r.market === 24 && r.qty === 30, j(r));
  r = c({ cost_price: 24, available_qty: 40 }, "طماطم 24", "observer");
  assert("a quantity not written → dropped", r.market === 24 && r.qty === undefined && r.dropped.length === 1, j(r));
  const k = PS.checkOfferItems([item(3, 31, 18), item(1, 11, 24)], [{ id: 1 }], [{ id: 11, product_id: 1 }, { id: 31, product_id: 3 }], "بطاطس 18، طماطم 24", "observer");
  assert("a product outside the catalog → dropped «صنف لا يورّده», the catalog one kept", k.kept.length === 1 && k.kept[0].product_id === 1
    && k.dropped.length === 1 && k.dropped[0].reason === "صنف لا يورّده", j(k));
}

console.log("\n[ب] Ahmed (supplier): the § 26 flow as it is; «سوق» beside a number → a market observation");
{
  const env = fresh("2026-10-03 03:10"); sources();
  const sup = { ...table("res.partner").get(AHMED)!, id: AHMED } as any;
  extractOut = { prices: [item(1, 11, 20, 24)], unrecognized: [] };
  await quiet(() => SUP.handleSupplierReply(env, sup, "طماطم 20 السوق 24", "wamid.A1"));
  const dp = rows("x_daily_price");
  assert("his purchase price in x_daily_price (20), as § 26", dp.length === 1 && dp[0].x_price_sar === 20 && dp[0].x_supplier_id === AHMED, JSON.stringify(dp));
  const of = offers();
  assert("the market observation in x_price_offer (24), with his price row, today (Riyadh)",
    of.length === 1 && of[0].x_market_price === 24 && of[0].x_purchase_price === 0 && of[0].x_daily_price_id === dp[0].id
      && of[0].x_source_partner_id === AHMED && of[0].x_date === "2026-10-03" && of[0].x_status === "valid", JSON.stringify(of));
  extractOut = { prices: [item(2, 21, 30)], unrecognized: [] };
  await quiet(() => SUP.handleSupplierReply(env, sup, "خيار سوق 30", "wamid.A2"));
  assert("«خيار سوق 30»: no purchase price saved, one market observation", rows("x_daily_price").length === 1 && offers().length === 2 && offers()[1].x_market_price === 30,
    JSON.stringify({ dp: rows("x_daily_price").length, of: offers() }));
  extractOut = { prices: [item(2, 21, 26)], unrecognized: [] };
  await quiet(() => SUP.handleSupplierReply(env, sup, "خيار 26", "wamid.A3"));
  assert("«خيار 26» (no «سوق»): his purchase price only, no offer row (§ 26 unchanged)", rows("x_daily_price").length === 2 && offers().length === 2);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ب] Omar: 02:30 «أرسل أسعار السوق اليوم» through the gateway, once a day, never to a supplier");
{
  const env = fresh("2026-10-03 02:25", { onAttendance: false }); sources();
  openWindow(env, DRIVER_PHONE, 30);
  let r = await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  assert("02:25: before the ask", r.action === "before" && askTexts(DRIVER_PHONE).length === 0, JSON.stringify(r));
  setRiyadh("2026-10-03 02:30");
  const P = await import("../src/prices.ts");
  const tick = await quiet(() => P.runPricesTick(env, Date.now()));
  assert("02:30, in the */5 prices tick: the ask as text inside his window", askTexts(DRIVER_PHONE).length === 1 && (tick.marketAsk as any)?.action === "ran", JSON.stringify(tick.marketAsk));
  assert("Ahmed (a supplier: asked at 02:00) gets no market ask — not sent, not held, not in the run",
    askTexts(AHMED_PHONE).length === 0 && heldFor(env, AHMED_PHONE).length === 0 && ((tick.marketAsk as any)?.asks ?? []).every((a: any) => a.name !== "أحمد حسان"),
    JSON.stringify(tick.marketAsk));
  setRiyadh("2026-10-03 02:35");
  r = await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  assert("the next tick: no second ask (claimed)", askTexts(DRIVER_PHONE).length === 1 && (r.asks ?? [])[0]?.action === "claimed_before", JSON.stringify(r));
  const env2 = fresh("2026-10-03 06:00", { onAttendance: false }); sources();
  openWindow(env2, DRIVER_PHONE, 30);
  r = await quiet(() => PS.runMarketAsk(env2, Date.now(), 360));
  assert("from the publication time (06:00): no ask any more", r.action === "after" && askTexts(DRIVER_PHONE).length === 0, JSON.stringify(r));
}
{
  const env = fresh("2026-10-03 02:30", { onAttendance: false });   // Omar not flagged
  openWindow(env, DRIVER_PHONE, 30);
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  assert("an employee without «مصدر أسعار»: no ask", askTexts(DRIVER_PHONE).length === 0 && (r.asks ?? []).length === 0, JSON.stringify(r));
}

console.log("\n[ب] outside his window → the team queue; the 90 minutes start when the ask reaches him");
{
  const env = fresh("2026-10-03 02:30", { onAttendance: false }); sources();
  await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  assert("outside his window: nothing sent, the ask waits in the team queue", askTexts(DRIVER_PHONE).length === 0
    && queueOf(env, DRIVER_PHONE).some((i: any) => i.purpose === "market_price_ask" && i.ask_day === "2026-10-03"), JSON.stringify(queueOf(env, DRIVER_PHONE)));
  extractOut = { prices: [item(1, 11, 24)], unrecognized: [] };
  setRiyadh("2026-10-03 02:50");
  const early = await quiet(() => PS.tryMarketReply(env, omar, `+${DRIVER_PHONE}`, "طماطم 24", "wamid.O0"));
  assert("before the ask reached him: a message is not read as prices", early === null && offers().length === 0);
  setRiyadh("2026-10-03 03:00"); openWindow(env, DRIVER_PHONE, 0);
  await quiet(() => flushTeamQueue(env, `+${DRIVER_PHONE}`));
  assert("03:00, the queue flushed (his message / tap): the ask reaches him", askTexts(DRIVER_PHONE).length === 1);
  setRiyadh("2026-10-03 04:25");
  const rep = await quiet(() => PS.tryMarketReply(env, omar, `+${DRIVER_PHONE}`, "طماطم 24", "wamid.O1"));
  assert("his reply 85 minutes after: a market observation (24), and «وصلتنا أسعار السوق (1 صنف)»",
    rep === PS.marketAckText(1) && offers().length === 1 && offers()[0].x_market_price === 24 && offers()[0].x_purchase_price === 0
      && offers()[0].x_source_partner_id === DRIVER && offers()[0].x_source_employee_id === OMAR_EMP, JSON.stringify({ rep, of: offers() }));
  setRiyadh("2026-10-03 04:31");
  extractOut = { prices: [item(2, 21, 30)], unrecognized: [] };
  const late = await quiet(() => PS.tryMarketReply(env, omar, `+${DRIVER_PHONE}`, "خيار 30", "wamid.O2"));
  assert("91 minutes after: not read (an ordinary team message)", late === null && offers().length === 1);
}
{
  const env = fresh("2026-10-03 02:30"); sources();   // on attendance, «بدء الدوام» not tapped yet
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  assert("on attendance before his tap: queued for the tap, not sent", (r.asks ?? [])[0]?.action === "queued" && askTexts(DRIVER_PHONE).length === 0
    && queueOf(env, DRIVER_PHONE).length === 1, JSON.stringify(r));
  setRiyadh("2026-10-04 02:05"); openWindow(env, DRIVER_PHONE, 0);
  await quiet(() => flushTeamQueue(env, `+${DRIVER_PHONE}`));
  assert("flushed the next day: yesterday's ask dropped, not sent", askTexts(DRIVER_PHONE).length === 0);
}
{
  const env = fresh("2026-10-02 02:30"); sources();   // Friday: his day off
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  assert("his day off (Friday): no ask, nothing queued", (r.asks ?? [])[0]?.action === "off" && queueOf(env, DRIVER_PHONE).length === 0, JSON.stringify(r));
}

console.log("\n[ب] through /webhook: Omar's reply read with the same extractor and rules (م6)");
{
  const env = fresh("2026-10-03 02:30", { onAttendance: false }); sources();
  openWindow(env, DRIVER_PHONE, 10);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  setRiyadh("2026-10-03 02:50");
  extractOut = { prices: [item(1, 11, 20, 24)], unrecognized: [] };
  await quiet(() => worker.fetch(signed(inbound(DRIVER_PHONE, { type: "text", text: { body: "طماطم 24 شراء 20" } })), env, harnessCtx));
  const of = offers();
  assert("«طماطم 24 شراء 20» → one offer: market 24, purchase 20", of.length === 1 && of[0].x_market_price === 24 && of[0].x_purchase_price === 20, JSON.stringify(of));
  assert("his reply «وصلتنا أسعار السوق (1 صنف)»", sentTo(DRIVER_PHONE).some((b) => b?.type === "text" && String(b.text?.body) === PS.marketAckText(1)));
  assert("no x_daily_price row from Omar (not a supplier)", rows("x_daily_price").length === 0);
  extractOut = { prices: [], unrecognized: [] };
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(DRIVER_PHONE, { type: "text", text: { body: "تمام يا براء" } })), env, harnessCtx));
  assert("a message with no price inside the window: an ordinary team message (no offer, no «وصلتنا»)",
    offers().length === 1 && !sentTo(DRIVER_PHONE).some((b) => /وصلتنا/.test(JSON.stringify(b))) && sentTo(DRIVER_PHONE).some((b) => /مرحبا/.test(JSON.stringify(b))),
    JSON.stringify(sentTo(DRIVER_PHONE)).slice(0, 300));
  extractOut = { prices: [item(3, 31, 18)], unrecognized: [] };
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(DRIVER_PHONE, { type: "text", text: { body: "بطاطس 18" } })), env, harnessCtx));
  assert("a product outside the active catalog: not saved, an ordinary message", offers().length === 1 && !sentTo(DRIVER_PHONE).some((b) => /وصلتنا/.test(JSON.stringify(b))));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ب] the status: «شاذ» against the same source's last value; simulation rows never the reference");
{
  const env = fresh("2026-10-03 02:30", { onAttendance: false }); sources();
  seed("x_price_offer", { x_date: "2026-10-02", x_source_partner_id: DRIVER, x_product_tmpl_id: 1, x_packaging_id: 11, x_market_price: 10, x_purchase_price: 0, x_status: "valid", x_utak_simulation: false });
  openWindow(env, DRIVER_PHONE, 10);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  extractOut = { prices: [item(1, 11, 24)], unrecognized: [] };
  await quiet(() => PS.tryMarketReply(env, omar, `+${DRIVER_PHONE}`, "طماطم 24", "wamid.O3"));
  const o = offers().find((x: any) => x.x_date === "2026-10-03");
  assert("market 10 yesterday → 24 today (×2.4 ≥ 1.5): «شاذ», the market flagged", o?.x_status === "outlier" && o?.x_market_outlier === true && o?.x_purchase_outlier === false, JSON.stringify(o));
}
{
  const env = fresh("2026-10-03 02:30", { onAttendance: false }); sources();
  seed("x_price_offer", { x_date: "2026-10-02", x_source_partner_id: DRIVER, x_product_tmpl_id: 1, x_packaging_id: 11, x_market_price: 10, x_purchase_price: 0, x_status: "valid", x_utak_simulation: true });
  openWindow(env, DRIVER_PHONE, 10);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  extractOut = { prices: [item(1, 11, 24)], unrecognized: [] };
  await quiet(() => PS.tryMarketReply(env, omar, `+${DRIVER_PHONE}`, "طماطم 24", "wamid.O4"));
  const o = offers().find((x: any) => x.x_date === "2026-10-03");
  assert("the only earlier value is a simulation row → not the reference: «صالح»", o?.x_status === "valid", JSON.stringify(o));
}

console.log("\n[ب] a new source = «مصدر أسعار» ticked, no code (a partner who is not a supplier)");
{
  const env = fresh("2026-10-03 02:30", { onAttendance: false }); sources();
  seed("res.partner", { id: FAHD, name: "فهد من السوق", supplier_rank: 0, x_whatsapp_number: "+" + FAHD_PHONE, x_price_source: true });
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  const fahd = (r.asks ?? []).find((a) => a.name === "فهد من السوق");
  assert("his window closed: the ask held by the gateway until he writes", fahd?.action === "held" && heldFor(env, FAHD_PHONE).length === 1, JSON.stringify(r));
  setRiyadh("2026-10-03 03:00");
  extractOut = { prices: [item(1, 11, 23)], unrecognized: [] };
  const first = await quiet(() => PS.tryMarketReply(env, { partnerId: FAHD, name: "فهد من السوق" }, `+${FAHD_PHONE}`, "طماطم 23", "wamid.F1"));
  assert("his next message delivers it (the flush): that message — even with a price — is not read as prices", first === null && offers().length === 0);
  const second = await quiet(() => PS.tryMarketReply(env, { partnerId: FAHD, name: "فهد من السوق" }, `+${FAHD_PHONE}`, "طماطم 23", "wamid.F2"));
  assert("his reply after it: a market observation (23)", second === PS.marketAckText(1) && offers().length === 1 && offers()[0].x_source_partner_id === FAHD && offers()[0].x_market_price === 23, JSON.stringify(offers()));
  table("res.partner").get(FAHD)!.x_price_source = false;
  extractOut = { prices: [item(2, 21, 31)], unrecognized: [] };
  const third = await quiet(() => PS.tryMarketReply(env, { partnerId: FAHD, name: "فهد من السوق" }, `+${FAHD_PHONE}`, "خيار 31", "wamid.F3"));
  assert("the flag cleared: his messages are not read as prices any more", third === null && offers().length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
