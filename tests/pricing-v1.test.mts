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

// ================================================================ [ج]
const PR = await import("../src/prices.ts");
const EN = await import("../src/pricing-engine.ts");
const DAY = "2026-10-03";
/** A supplier's purchase price (x_daily_price, § 26). */
const dp = (product: number, packaging: number, supplier: number, p: number, o: { status?: string; date?: string } = {}) =>
  seed("x_daily_price", { x_product_tmpl_id: product, x_packaging_id: packaging, x_supplier_id: supplier, x_price_sar: p, x_date: o.date ?? DAY, x_extraction_status: o.status ?? "extracted" });
/** A source's offer (x_price_offer, § 40 ب). */
const po = (product: number, packaging: number, partner: number, o: { purchase?: number; market?: number; sim?: boolean; date?: string; mOut?: boolean; pOut?: boolean } = {}) =>
  seed("x_price_offer", {
    x_product_tmpl_id: product, x_packaging_id: packaging, x_source_partner_id: partner, x_date: o.date ?? DAY,
    x_purchase_price: o.purchase ?? 0, x_market_price: o.market ?? 0, x_purchase_outlier: !!o.pOut, x_market_outlier: !!o.mOut,
    x_status: o.pOut || o.mOut ? "outlier" : "valid", x_utak_simulation: !!o.sim,
  });
const dayOf = (d = DAY) => rows("x_price_day").find((r: any) => r.x_date === d);
const lineFor = (product: number, d = DAY) => rows("x_price_day_line").find((l: any) => l.x_day_id === dayOf(d)?.id && l.x_product_tmpl_id === product);
const ownerTexts = () => sentTo(OWNER).map((b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? ""));
const excMsgs = () => sentTo(OWNER).filter((b: any) => b?.type === "interactive" && /استثناء في أسعار اليوم/.test(String(b.interactive?.body?.text)));
const btnIds = (b: any) => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id);
const offer = (o: Partial<import("../src/pricing-engine.ts").EngineOffer>) =>
  ({ kind: "market", price: 0, outlier: false, partnerId: 1, sourceName: "م", productId: 1, packagingId: 11, model: "po", rowId: 1, ...o }) as any;
const ITEM = { productId: 1, productName: "طماطم", packagingId: 11, packagingName: "كرتون" };

console.log("\n[ج] the rule: lowest purchase, median market, sale = market, unit profit");
{
  assert("median: one observation is enough (24)", EN.median([24]) === 24);
  assert("median: odd count → the middle (22, 24, 30 → 24)", EN.median([30, 22, 24]) === 24);
  assert("median: even count → the mean of the two middle ones (22, 25 → 23.5)", EN.median([25, 22]) === 23.5);
  assert("median: none → null", EN.median([]) === null);
  const [l] = EN.computePricing([ITEM], [
    offer({ kind: "purchase", price: 22, partnerId: AHMED, sourceName: "أحمد حسان", model: "dp", rowId: 5 }),
    offer({ kind: "purchase", price: 20, partnerId: DRIVER, sourceName: "عمر", rowId: 3 }),
    offer({ kind: "market", price: 26, partnerId: DRIVER, rowId: 3 }),
    offer({ kind: "market", price: 24, partnerId: AHMED, rowId: 4 }),
    offer({ kind: "market", price: 30, partnerId: FAHD, rowId: 6 }),
  ], 5);
  assert("purchase = the lowest of any source (Omar's «شراء» 20 under Ahmed's 22)", l.purchase === 20 && l.purchaseOffer?.partnerId === DRIVER, JSON.stringify(l));
  assert("market = the median of three sources (24, 26, 30 → 26), 3 observations", l.market === 26 && l.marketCount === 3);
  assert("sale = the market price exactly (26)", l.sale === 26);
  assert("unit profit = 26 − 20 − 5 % × 20 = 5", l.unitProfit === 5 && l.exceptions.length === 0, JSON.stringify(l));
  const [x] = EN.computePricing([ITEM], [
    offer({ kind: "market", price: 20, rowId: 1 }), offer({ kind: "market", price: 28, rowId: 2 }),
    offer({ kind: "purchase", price: 21, partnerId: AHMED, model: "dp", rowId: 1 }),
  ], 5);
  assert("a source counts once: its latest row of the day (28 over 20)", x.market === 28 && x.marketCount === 1, JSON.stringify(x));
  assert("the product card's display margin: (26 − 20) ÷ 20 = 30 %", EN.displayMarginPct(20, 26) === 30 && EN.displayMarginPct(0, 26) === 0);
}

console.log("\n[ج] each exception: no purchase, no market, profit ≤ 0, an outlier (purchase or market)");
{
  const run = (offers: any[]) => EN.computePricing([ITEM], offers, 5)[0];
  const a = run([offer({ kind: "market", price: 24 })]);
  assert("(1) no purchase price → «لا سعر شراء»", a.exceptions.join() === "no_purchase" && a.reason === "لا سعر شراء", JSON.stringify(a));
  const b = run([offer({ kind: "purchase", price: 20, model: "dp" })]);
  assert("(2) no market price → «لا سعر سوق»", b.exceptions.join() === "no_market" && b.sale === null, JSON.stringify(b));
  const c = run([offer({ kind: "purchase", price: 20, model: "dp" }), offer({ kind: "market", price: 21 })]);
  assert("(3) 21 − 20 − 1 = 0 → «ربح الوحدة ≤ 0 (0)»", c.exceptions.join() === "no_profit" && c.unitProfit === 0 && c.reason === "ربح الوحدة ≤ 0 (0)", JSON.stringify(c));
  const c2 = run([offer({ kind: "purchase", price: 20, model: "dp" }), offer({ kind: "market", price: 21.05 })]);
  assert("…21.05 − 20 − 1 = 0.05 > 0 → automatic", c2.exceptions.length === 0 && c2.unitProfit === 0.05, JSON.stringify(c2));
  const d = run([offer({ kind: "purchase", price: 12, model: "dp", outlier: true }), offer({ kind: "market", price: 24 })]);
  assert("(4) the purchase price used is an outlier → «سعر شاذ: الشراء»", d.exceptions.join() === "outlier" && d.reason === "سعر شاذ: الشراء", JSON.stringify(d));
  const e = run([offer({ kind: "purchase", price: 20, model: "dp" }), offer({ kind: "market", price: 24, outlier: true }), offer({ kind: "market", price: 25, partnerId: 2 })]);
  assert("(4) a market observation is an outlier → «سعر شاذ: السوق»", e.exceptions.join() === "outlier" && e.reason === "سعر شاذ: السوق", JSON.stringify(e));
  const f = run([offer({ kind: "purchase", price: 20, model: "dp" }), offer({ kind: "purchase", price: 60, partnerId: 2, outlier: true }), offer({ kind: "market", price: 24 })]);
  assert("an outlier purchase NOT used (a higher one) → no exception", f.exceptions.length === 0 && f.purchase === 20, JSON.stringify(f));
  const g = run([]);
  assert("nothing at all → both reasons", g.reason === "لا سعر شراء، لا سعر سوق", g.reason);
}

console.log("\n[ج] the engine on the day: sources only, simulation out, nothing from yesterday, every active product");
{
  const env = fresh("2026-10-03 04:10", { onAttendance: false }); sources();
  seed("res.partner", { id: 850, name: "مورد غير معلَّم", supplier_rank: 1, x_whatsapp_number: "+966500000850" });
  dp(1, 11, AHMED, 20);
  dp(1, 11, 850, 15);                          // a supplier without «مصدر أسعار»
  po(1, 11, DRIVER, { market: 24 });
  po(1, 11, DRIVER, { market: 99, sim: true, purchase: 1 }); // simulation
  po(1, 11, DRIVER, { market: 40, date: "2026-10-02" });    // yesterday
  const r = await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1)!, c = lineFor(2)!;
  assert("the record built, one line per active product (tomato priced, cucumber not)", r.action === "refreshed" && rows("x_price_day_line").length === 2, JSON.stringify(r));
  assert("tomato: purchase 20 (the unflagged supplier's 15 ignored), market 24 (not the simulation 99, not yesterday's 40), sale 24, auto",
    t.x_cost_price === 20 && t.x_market_price === 24 && t.x_market_count === 1 && t.x_sale_price === 24 && t.x_unit_profit === 3 && t.x_status === "auto" && !t.x_excluded, JSON.stringify(t));
  assert("cucumber (no offer at all): its default packaging, an exception", c.x_packaging_id === 21 && c.x_status === "exception" && c.x_reason === "لا سعر شراء، لا سعر سوق", JSON.stringify(c));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] the exceptions to Baraa: from 04:00, one message per exception with its buttons, once");
{
  const env = fresh("2026-10-03 03:55", { onAttendance: false }); sources();
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 20.5 });  // tomato: profit ≤ 0, a market price
  dp(2, 21, AHMED, 30);                                       // cucumber: no market price
  await quiet(() => PR.refreshPriceDay(env));
  const early = await quiet(() => PR.notifyPriceExceptions(env));
  assert("03:55: nothing yet (Omar's window runs to 04:00)", early.action === "outside" && excMsgs().length === 0);
  setRiyadh("2026-10-03 04:00");
  const n1 = await quiet(() => PR.notifyPriceExceptions(env));
  const msgs = excMsgs();
  assert("04:00: one message per exception (2)", n1.action === "sent" && n1.sent === 2 && msgs.length === 2, JSON.stringify(n1));
  const tomatoMsg = msgs.find((b: any) => String(b.interactive.body.text).includes("طماطم"));
  const cucMsg = msgs.find((b: any) => String(b.interactive.body.text).includes("خيار"));
  const tl = lineFor(1)!, cl = lineFor(2)!;
  assert("with a market price: «اعتمد بسعر السوق» / «لا تنشر» / «عدّل»", JSON.stringify(btnIds(tomatoMsg)) === JSON.stringify([`pexc_m_${tl.id}`, `pexc_s_${tl.id}`, `pexc_e_${tl.id}`]), JSON.stringify(btnIds(tomatoMsg)));
  assert("without a market price: «لا تنشر» / «عدّل» only", JSON.stringify(btnIds(cucMsg)) === JSON.stringify([`pexc_s_${cl.id}`, `pexc_e_${cl.id}`]), JSON.stringify(btnIds(cucMsg)));
  assert("the message: product, purchase, market, profit, reason, the deadline",
    /طماطم \(كرتون\)/.test(tomatoMsg.interactive.body.text) && /الشراء: 20 · السوق: 20.50 · ربح الوحدة: -0.50/.test(tomatoMsg.interactive.body.text)
      && /السبب: ربح الوحدة ≤ 0 \(-0.50\)/.test(tomatoMsg.interactive.body.text) && /قرارك قبل 06:00/.test(tomatoMsg.interactive.body.text), tomatoMsg.interactive.body.text);
  setRiyadh("2026-10-03 04:05");
  const n2 = await quiet(() => PR.notifyPriceExceptions(env));
  assert("the next tick: no second message (KV guard per product and day)", n2.action === "notified_before" && excMsgs().length === 2, JSON.stringify(n2));
  setRiyadh("2026-10-03 06:00");
  assert("from the publication time: no exception message", (await quiet(() => PR.notifyPriceExceptions(env))).action === "outside");
}
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
  for (let i = 0; i < 9; i++) {
    const pid = 100 + i;
    seed("product.template", { id: pid, name: `صنف ${i + 1}`, sale_ok: true, x_is_active_for_sale: true });
    seed("x_product_packaging", { id: 1000 + i, x_name: "كرتون", x_product_tmpl_id: pid, x_is_default: true });
  }
  await quiet(() => PR.refreshPriceDay(env));   // 11 active products, no offer → 11 exceptions
  const n = await quiet(() => PR.notifyPriceExceptions(env));
  const t = ownerTexts().filter((x) => x.startsWith("⚠️ استثناءات أسعار اليوم"));
  assert("more than 8 exceptions (11): ONE message with the count and the review link, no per-item messages",
    n.action === "many" && n.count === 11 && t.length === 1 && /11 صنفاً/.test(t[0]) && /\/odoo\/(action-\d+|x_price_day)\/\d+/.test(t[0]) && excMsgs().length === 0, JSON.stringify({ n, t }));
  setRiyadh("2026-10-03 04:05");
  seed("product.template", { id: 120, name: "صنف جديد", sale_ok: true, x_is_active_for_sale: true });
  seed("x_product_packaging", { id: 1020, x_name: "كرتون", x_product_tmpl_id: 120, x_is_default: true });
  await quiet(() => PR.refreshPriceDay(env));
  const n2 = await quiet(() => PR.notifyPriceExceptions(env));
  assert("…a later exception on the same day: no second message", ownerTexts().filter((x) => x.startsWith("⚠️ استثناءات أسعار اليوم")).length === 1 && excMsgs().length === 0, JSON.stringify(n2));
}
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
  for (let i = 0; i < 6; i++) {
    seed("product.template", { id: 100 + i, name: `صنف ${i + 1}`, sale_ok: true, x_is_active_for_sale: true });
    seed("x_product_packaging", { id: 1000 + i, x_name: "كرتون", x_product_tmpl_id: 100 + i, x_is_default: true });
  }
  await quiet(() => PR.refreshPriceDay(env));   // exactly 8
  const n = await quiet(() => PR.notifyPriceExceptions(env));
  assert("exactly 8 exceptions: one message each (8), no count message", n.action === "sent" && excMsgs().length === 8 && !ownerTexts().some((x) => x.startsWith("⚠️ استثناءات أسعار اليوم")), JSON.stringify(n));
}

console.log("\n[ج] Baraa's buttons, «عدّل» within 30 minutes, the lock");
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 20.5 });  // tomato: an exception with a market price
  dp(2, 21, AHMED, 30);                                       // cucumber: no market
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PR.notifyPriceExceptions(env));
  const tl = lineFor(1)!, cl = lineFor(2)!;
  const r1 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_m_${cl.id}`));
  assert("«اعتمد بسعر السوق» without a market price → refused, nothing written", /لا سعر سوق/.test(r1) && !lineFor(2)!.x_decision, r1);
  const r2 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_m_${tl.id}`));
  const t2 = lineFor(1)!;
  assert("«اعتمد بسعر السوق» → approved by hand at the market price (20.50)", /يُنشر بسعر السوق 20.50/.test(r2) && t2.x_decision === "market" && t2.x_status === "manual" && t2.x_sale_price === 20.5 && !t2.x_excluded && !!t2.x_decided_at, JSON.stringify({ r2, t2 }));
  const r3 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_s_${tl.id}`));
  assert("a second button on the same line → «القرار مسجّل مسبقاً», unchanged", /القرار مسجّل مسبقاً/.test(r3) && lineFor(1)!.x_decision === "market", r3);
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("the next refresh keeps his decision (manual, 20.50)", lineFor(1)!.x_status === "manual" && lineFor(1)!.x_sale_price === 20.5);
  // «عدّل»
  const e1 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_e_${cl.id}`));
  assert("«عدّل» → asks for the number, nothing written yet", /أرسل سعر البيع لـ خيار رقماً واحداً خلال 30 دقيقة/.test(e1) && !lineFor(2)!.x_decision, e1);
  setRiyadh("2026-10-03 04:10");
  const e2 = await quiet(() => PR.handlePriceEditReply(env, "خليه تمام"));
  assert("a reply without a number → asked again, nothing written", /رقماً موجباً واحداً/.test(String(e2)) && !lineFor(2)!.x_decision, String(e2));
  const e3 = await quiet(() => PR.handlePriceEditReply(env, "35 أو 36"));
  assert("two numbers → asked again", /رقماً موجباً واحداً/.test(String(e3)) && !lineFor(2)!.x_decision, String(e3));
  const e4 = await quiet(() => PR.handlePriceEditReply(env, "٣٥٫٥ ريال"));
  const c4 = lineFor(2)!;
  assert("«٣٥٫٥ ريال» within 30 minutes → the approved sale price 35.50", /يُنشر بـ 35.50/.test(String(e4)) && c4.x_decision === "edit" && c4.x_manual_price === 35.5 && c4.x_status === "manual" && c4.x_sale_price === 35.5, JSON.stringify({ e4, c4 }));
  assert("…and «عدّل» is used up: the next text is not a price", (await quiet(() => PR.handlePriceEditReply(env, "40"))) === null && lineFor(2)!.x_manual_price === 35.5);
}
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
  dp(2, 21, AHMED, 30);
  await quiet(() => PR.refreshPriceDay(env));
  const cl = lineFor(2)!;
  await quiet(() => PR.handlePriceExceptionButton(env, `pexc_e_${cl.id}`));
  setRiyadh("2026-10-03 04:31");
  assert("«عدّل» then a number after 30 minutes → not taken (null), nothing written", (await quiet(() => PR.handlePriceEditReply(env, "35"))) === null && !lineFor(2)!.x_decision);
  const s1 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_s_${cl.id}`));
  assert("«لا تنشر» → «لم يُنشر» with his reason", /لا يُنشر اليوم/.test(s1) && lineFor(2)!.x_status === "unpublished" && lineFor(2)!.x_reason === "براء: لا تنشر" && lineFor(2)!.x_excluded === true, s1);
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("…and the next refresh keeps it («لم يُنشر»)", lineFor(2)!.x_status === "unpublished" && lineFor(2)!.x_reason === "براء: لا تنشر", JSON.stringify(lineFor(2)));
}
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 20.5 });
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PR.notifyPriceExceptions(env));
  const tl = lineFor(1)!;
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `pexc_e_${tl.id}`, title: "عدّل" } } })), env, harnessCtx));
  assert("through /webhook: his tap on «عدّل» → the question, as text", ownerTexts().some((t) => /أرسل سعر البيع لـ طماطم/.test(t)), JSON.stringify(ownerTexts()));
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "text", text: { body: "23" } })), env, harnessCtx));
  assert("…his «23» → the line approved at 23, and the confirmation", lineFor(1)!.x_status === "manual" && lineFor(1)!.x_sale_price === 23 && ownerTexts().some((t) => /طماطم: يُنشر بـ 23/.test(t)), JSON.stringify(ownerTexts()));
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "text", text: { body: "مرحبا" } })), env, harnessCtx));
  assert("…any other text of his: nothing (the owner guard as before)", sentTo(OWNER).length === 0);
}

console.log("\n[ج] the publication time: automatic lines published, an exception without a decision not");
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
  seed("res.partner", { id: 891, name: "مطعم الوادي 2", customer_rank: 1, x_whatsapp_number: "+966500000891" });
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 24 });   // tomato: automatic at 24
  dp(2, 21, AHMED, 30);                                       // cucumber: an exception, no decision
  await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("04:00 tick: the record built, the exception sent to Baraa", !!dayOf() && excMsgs().length === 1);
  setRiyadh("2026-10-03 05:55");
  await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("05:55: nothing published yet (no wait for Baraa, but the time is 06:00)", dayOf()!.x_state === "draft");
  setRiyadh("2026-10-03 06:00");
  const t = await quiet(() => PR.runPricesTick(env, Date.now()));
  const d = dayOf()!;
  assert("06:00: approved by the worker and published (no Baraa in it)", (t.deadline as any)?.action === "auto_published" && d.x_state === "published" && !d.x_approved_by, JSON.stringify(t.deadline));
  const list = heldFor(env, "966500000891");
  assert("the customers' list: tomato at 24 only (the undecided cucumber left out)", list.length === 1 && /• طماطم \(كرتون\): 24 ر.س/.test(JSON.stringify(list[0])) && !/خيار/.test(JSON.stringify(list[0])), JSON.stringify(list).slice(0, 300));
  assert("the cucumber: «لم يُنشر» (استثناء بلا قرار)", lineFor(2)!.x_status === "unpublished" && /استثناء بلا قرار/.test(String(lineFor(2)!.x_reason)));
  assert("Baraa: one line with the count of the undecided", ownerTexts().filter((x) => x.startsWith("⏰ لم يُنشر اليوم 1 صنف")).length === 1, JSON.stringify(ownerTexts()));
  const late = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_s_${lineFor(2)!.id}`));
  assert("a tap after the publication → «فات موعد النشر», nothing written", /فات موعد نشر/.test(late) && !lineFor(2)!.x_decision, late);
  const p = await quiet(() => (import("../src/odoo.ts")).then((m) => m.getLatestSalePrice(env, 1, 11)));
  assert("the quotation / invoice price: today's published 24", p.price === 24 && p.source === "today", JSON.stringify(p));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] the publication time takes the last offers; the tick runs the engine only in its window");
{
  const env = fresh("2026-10-03 05:55", { onAttendance: false }); sources();
  seed("res.partner", { id: 891, name: "مطعم الوادي 2", customer_rank: 1, x_whatsapp_number: "+966500000891" });
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 24 });
  dp(2, 21, AHMED, 30);
  await quiet(() => PR.refreshPriceDay(env));
  setRiyadh("2026-10-03 05:58");
  po(2, 21, DRIVER, { market: 36 });                          // arrives after the last tick
  setRiyadh("2026-10-03 06:00");
  const r = await quiet(() => PR.checkPricesDeadline(env));
  assert("an observation of 05:58 counts at 06:00 (the engine's last word): cucumber published at 36",
    r.action === "auto_published" && lineFor(2)!.x_status === "auto" && /• خيار \(جرم\): 36 ر.س/.test(JSON.stringify(heldFor(env, "966500000891"))), JSON.stringify(r));
}
{
  const env = fresh("2026-10-03 01:30", { onAttendance: false }); sources();
  dp(1, 11, AHMED, 20);
  const a = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("01:30: the tick does not run the engine (before the 02:00 ask)", (a.refresh as any)?.action === "outside" && !dayOf(), JSON.stringify(a.refresh));
  setRiyadh("2026-10-03 12:00");
  const b = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("12:00: nor after the publication window", (b.refresh as any)?.action === "outside" && !dayOf(), JSON.stringify(b.refresh));
}

// ================================================================ [د]
const OP = await import("../src/order-pricing.ts");
const Q = await import("../src/quotation.ts");
const INV = await import("../src/invoice.ts");
const { dispatch } = await import("../src/router.ts");
const TEAM = await import("../src/team.ts");
const { CUST: C1, CUST_PHONE: C1_PHONE } = await import("./wa-harness.mts");
/** The three tiers of the tenant, and the planned stops. */
function tiers(stops: number = 10): void {
  seed("x_pricing_tier", { x_config_id: 1, x_sequence: 1, x_amount_from: 0, x_amount_to: 499.99, x_discount_pct: 0, x_active: true });
  seed("x_pricing_tier", { x_config_id: 1, x_sequence: 2, x_amount_from: 500, x_amount_to: 1000, x_discount_pct: 2, x_active: true });
  seed("x_pricing_tier", { x_config_id: 1, x_sequence: 3, x_amount_from: 1000.01, x_amount_to: 0, x_discount_pct: 3, x_active: true });
  table("x_pricing_config").get(1)!.x_planned_stops = stops;
}
/** The company's sale tax (15 %, price-included), as on the tenant from 2026-10-01. */
function vat(): void {
  seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.company", { id: 1, name: "UTAK Company", vat: "300000000000003", account_sale_tax_id: [77, "15%"] });
}
/** Today's published line: tomato bought at 20, sold at 30 (the engine's day). */
function publishedTomato(day = DAY, cost = 20, sale = 30): void {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: `أسعار ${day}` });
  seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: cost, x_market_price: sale, x_sale_price: sale, x_status: "auto", x_excluded: false, x_blocked: false });
}
/** An order of the customer for `day` with its lines [product, packaging, qty]. */
function orderOf(day: string, lines: Array<[number, number, number]>, state = "waiting_confirmation"): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: state, x_order_date: day, x_created_via: "whatsapp", x_delivery_neighborhood: "العليا" });
  for (const [p, k, q] of lines) seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: p, x_packaging_id: k, x_quantity: q, x_status: "pending" });
  return id;
}
const line = (qty: number, unit = 30, product = 1, packaging = 11) => ({ productId: product, packagingId: packaging, qty, unit });
const noVat = async () => null;

console.log("\n[د] the tiers: 0–499.99 → 0 %, 500–1,000 → 2 %, above 1,000 → 3 %");
{
  const T3 = [{ id: 1, from: 0, to: 499.99, pct: 0 }, { id: 2, from: 500, to: 1000, pct: 2 }, { id: 3, from: 1000.01, to: null, pct: 3 }];
  const pct = (a: number) => OP.tierFor(a, T3)?.pct;
  assert("0 → 0 %, 499.99 → 0 %", pct(0) === 0 && pct(499.99) === 0);
  assert("500 → 2 %, 1,000 → 2 %", pct(500) === 2 && pct(1000) === 2);
  assert("1,000.01 → 3 %, 5,000 → 3 % (no ceiling)", pct(1000.01) === 3 && pct(5000) === 3);
  const env = fresh("2026-10-03 10:00"); tiers();
  const rows3 = await quiet(() => OP.readTiers(env, 1));
  assert("read from «⚙️ إعدادات التسعير» (active ones)", rows3.length === 3 && rows3[2].to === null, JSON.stringify(rows3));
  table("x_pricing_tier").get(rows("x_pricing_tier")[1].id)!.x_active = false;
  assert("an inactive tier is left out", (await quiet(() => OP.readTiers(env, 1))).length === 2);
}

console.log("\n[د] the discount: before VAT, and the guard (profit after it ≥ daily cost ÷ planned stops)");
{
  const env = fresh("2026-09-30 10:00"); tiers(10); publishedTomato("2026-09-30");
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-09-01");
  const d = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(20)], vatRate: noVat }));
  assert("600 before the VAT cutoff: 2 % of 600 = 12, applied (profit 180 − 12 = 168 ≥ 500 ÷ 10)", d.applied && d.pct === 2 && d.amount === 12 && d.profitBefore === 180 && d.profitAfter === 168 && d.minProfit === 50, JSON.stringify(d));
  const d0 = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(16)], vatRate: noVat }));
  assert("480 (tier 0 %): no discount", !d0.applied && d0.amount === 0 && d0.tierPct === 0, JSON.stringify(d0));
  const d3 = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(40)], vatRate: noVat }));
  assert("1,200 → 3 % = 36", d3.applied && d3.pct === 3 && d3.amount === 36, JSON.stringify(d3));
  table("x_pricing_config").get(1)!.x_planned_stops = 1;
  const g = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(20)], vatRate: noVat }));
  assert("the guard: 1 planned stop → the order must keep 500; 168 < 500 → no discount, with the reason",
    !g.applied && g.amount === 0 && g.minProfit === 500 && /أقل من 500/.test(g.reason), JSON.stringify(g));
  table("x_pricing_config").get(1)!.x_planned_stops = 0;
  const e = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(20)], vatRate: noVat }));
  assert("planned stops empty → no discount at all", !e.applied && /فارغ/.test(e.reason), JSON.stringify(e));
  table("x_pricing_config").get(1)!.x_planned_stops = 10;
  const m = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(20), line(1, 50, 2, 21)], vatRate: noVat }));
  assert("a line without the day's purchase price → no discount (never a guess)", !m.applied && /سعر شراء/.test(m.reason), JSON.stringify(m));
  cost("صيانة", "monthly", 2600, "2026-09-01");
  table("hr.employee").get(OMAR_EMP)!.resource_calendar_id = false;
  const c = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(20)], vatRate: noVat }));
  assert("the day's cost unreadable (a monthly line, no driver schedule) → no discount", !c.applied && /تكلفة اليوم لا تُقرأ/.test(c.reason), JSON.stringify(c));
}
{
  const env = fresh("2026-10-03 10:00"); tiers(10); publishedTomato();
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  const d = await quiet(() => OP.orderDiscount(env, { day: DAY, lines: [line(20)], vatRate: async () => 15 }));
  assert("from 10-01 (VAT 15 % in the price): 2 % of the net 521.74 = 10.43", d.applied && d.amount === 10.43, JSON.stringify(d));
  const t = OP.discountedTotals({ subtotal: 521.74, tax: 78.26, total: 600, lines: [] }, 10.43, 15);
  assert("the totals: net 521.74, discount 10.43, VAT on 511.31 = 76.70, total 588.01", t.subtotal === 521.74 && t.discount === 10.43 && t.tax === 76.7 && t.total === 588.01, JSON.stringify(t));
  const n = OP.discountedTotals({ subtotal: 600, tax: 0, total: 600, lines: [] }, 12, null);
  assert("before the cutoff: 600 − 12 = 588, no VAT", n.total === 588 && n.tax === 0);
}

{
  const env = fresh("2026-09-30 10:00"); tiers(10); publishedTomato("2026-09-30");
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-09-01");
  env.ACCOUNTING_SYNC = "true";
  const a = await quiet(() => OP.orderDiscount(env, { day: "2026-09-30", lines: [line(20)], vatRate: noVat }));
  assert("ACCOUNTING_SYNC on: no discount (the sale order has no discount line yet)", !a.applied && /ACCOUNTING_SYNC/.test(a.reason), JSON.stringify(a));
}

console.log("\n[د] the quotation and the invoice: a discount line, the tax invoice template as it is");
{
  const env = fresh("2026-10-03 10:00"); tiers(10); publishedTomato(); vat();
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  const o = orderOf(DAY, [[1, 11, 20]]);
  const q = seed("x_quotation", { x_quotation_number: "UTAK-Q-20261003-001", x_order_id: o, x_origin: "auto", create_date: "2026-10-03 07:00:00" });
  const qd = await quiet(() => Q.buildQuotationPDFDataFromOdoo(env, q));
  assert("the quotation: 600, a discount line 12 (10.43 + its VAT), total 588.01 — the invoice's total", qd?.subtotal === 600 && qd?.discount === 11.99 && qd?.grandTotal === 588.01, JSON.stringify({ s: qd?.subtotal, d: qd?.discount, t: qd?.grandTotal }));
  const html = Q.renderQuotationHTML(qd!);
  assert("…rendered: the «الخصم» row carries it", /11\.99/.test(html));
  Object.assign(table("x_daily_order").get(o)!, { x_state: "delivered" });
  const r = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o));
  const inv = table("x_invoice").get(r!.invoiceId)!;
  assert("the invoice: net 521.74, VAT 76.70, total 588.01, x_discount 10.43 (2 %)", inv.x_subtotal === 521.74 && inv.x_tax_amount === 76.7 && inv.x_total === 588.01 && inv.x_discount === 10.43 && inv.x_discount_pct === 2, JSON.stringify(inv));
  const pdf = await quiet(() => INV.buildInvoicePDFDataFromOdoo(env, r!.invoiceId));
  assert("…its PDF data: the discount 10.43 before the VAT row (the § 23 tax invoice layout)", pdf?.discount === 10.43 && pdf?.vatAmount === 76.7 && pdf?.grandTotal === 588.01 && pdf?.subtotal === 521.74, JSON.stringify({ d: pdf?.discount, v: pdf?.vatAmount, t: pdf?.grandTotal }));
  const held = JSON.stringify(heldFor(env, C1_PHONE));
  assert("…the customer's text: «خصم الكمية: 10.43 ر.س» between the net and the VAT", /الإجمالي قبل الضريبة: 521.74 ر.س\\nخصم الكمية: 10.43 ر.س\\nضريبة القيمة المضافة 15%: 76.7 ر.س/.test(held), held.slice(0, 400));
  assert("an invoice without a discount: 0 on its PDF (subtotal + VAT = total)", INV.invoiceDiscount({ subtotal: 521.74, tax: 78.26, total: 600 }) === 0);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fresh("2026-10-03 10:00"); tiers(0); publishedTomato(); vat();
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  const o = orderOf(DAY, [[1, 11, 20]], "delivered");
  const r = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o));
  const inv = table("x_invoice").get(r!.invoiceId)!;
  assert("planned stops empty: the invoice without discount (600 = 521.74 + 78.26), no x_discount written", inv.x_total === 600 && inv.x_tax_amount === 78.26 && inv.x_discount === undefined, JSON.stringify(inv));
}

console.log("\n[د] the minimum order (150, before the discount): no confirm button below it, the order stays open");
{
  const env = fresh("2026-10-03 10:00"); publishedTomato();
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";   // no location question first
  const o = orderOf(DAY, [[1, 11, 4]], "draft");          // 4 × 30 = 120
  const partner = { id: C1, name: "مطعم الوادي", x_whatsapp_number: "+" + C1_PHONE } as any;
  const m = await quiet(() => OP.orderMinimum(env, o));
  assert("120 < 150 → below", m.below && m.total === 120 && m.min === 150, JSON.stringify(m));
  const r1 = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "w1", type: "text", text: "خلاص", timestamp: "0" } as any, intent: "request_quotation", senderType: "customer", partner }));
  assert("«خلاص» → «أقل طلب 150 ريال، أضف أصنافاً ليكتمل», no buttons, no quotation", String(r1.text).startsWith("أقل طلب 150 ريال، أضف أصنافاً ليكتمل") && !r1.buttons
    && rows("x_quotation").length === 0 && table("x_daily_order").get(o)!.x_state === "draft", JSON.stringify(r1));
  Object.assign(table("x_daily_order").get(o)!, { x_state: "waiting_confirmation" });
  const r2 = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "w2", type: "interactive", buttonId: `confirm_order_${o}`, timestamp: "0" } as any, intent: "other", senderType: "customer", partner }));
  assert("an old «تأكيد الطلب» tap below it → not confirmed, the same text; the order back to draft (open)", /أقل طلب 150 ريال/.test(String(r2.text)) && table("x_daily_order").get(o)!.x_state === "draft", JSON.stringify(r2));
  seed("x_daily_order_line", { x_order_id: o, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 1, x_status: "pending" });   // 150
  const r3 = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "w3", type: "text", text: "خلاص", timestamp: "0" } as any, intent: "request_quotation", senderType: "customer", partner }));
  assert("completed to 150 → the quotation with its confirm button", (r3.buttons ?? []).some((b: any) => b.id === `confirm_order_${o}`) && rows("x_quotation").length === 1, JSON.stringify(r3));
  env.MSG_DEDUP.store.delete(`btnlock:v1:order:${o}:confirm_order`);   // ح8's 90-second tap lock has expired (the harness KV keeps keys)
  const r4 = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "w4", type: "interactive", buttonId: `confirm_order_${o}`, timestamp: "0" } as any, intent: "other", senderType: "customer", partner }));
  assert("…and «تأكيد الطلب» confirms it", /تم التأكيد/.test(String(r4.text)) && table("x_daily_order").get(o)!.x_state === "confirmed", JSON.stringify(r4));
}
{
  const env = fresh("2026-10-03 10:00"); publishedTomato();
  const partner = { id: C1, name: "مطعم الوادي", x_whatsapp_number: "+" + C1_PHONE } as any;
  const o = orderOf(DAY, [[1, 11, 2]], "cancelled");      // 60, cancelled
  const r = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "w5", type: "interactive", buttonId: `confirm_order_${o}`, timestamp: "0" } as any, intent: "other", senderType: "customer", partner }));
  assert("ح4 first: a cancelled order below the minimum gets ح4's answer, not the minimum", /ملغى/.test(String(r.text)) && !/أقل طلب/.test(String(r.text)), JSON.stringify(r));
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  const o2 = orderOf(DAY, [[1, 11, 1]], "waiting_confirmation");
  const r2 = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "w6", type: "interactive", buttonId: `confirm_order_${o2}`, timestamp: "0" } as any, intent: "other", senderType: "customer", partner }));
  assert("no minimum set (0) → 30 confirms", table("x_daily_order").get(o2)!.x_state === "confirmed", JSON.stringify(r2));
}
{
  const env = fresh("2026-10-03 20:00"); publishedTomato();
  openWindow(env, C1_PHONE, 30);
  const small = orderOf(DAY, [[1, 11, 4]], "waiting_confirmation");   // 120
  await quiet(() => TEAM.sendCutoffReminders(env));
  const msgs = sentTo(C1_PHONE);
  assert("ح3 20:00, an order below the minimum: the reminder says so, without a confirm button",
    msgs.length === 1 && msgs[0].type === "text" && /طلبك رقم #\d+: أقل طلب 150 ريال، أضف أصنافاً ليكتمل قبل الساعة 9:00 مساءً/.test(msgs[0].text.body), JSON.stringify(msgs));
  table("x_daily_order").get(small)!.x_state = "cancelled";
  const big = orderOf(DAY, [[1, 11, 6]], "waiting_confirmation");     // 180
  graph.length = 0;
  await quiet(() => TEAM.sendCutoffReminders(env));
  assert("…an order at or above it: ح3's reminder with «تأكيد الطلب» as before", sentTo(C1_PHONE).some((b: any) => b.type === "interactive" && (b.interactive?.action?.buttons ?? []).some((x: any) => x.reply.id === `confirm_order_${big}`)));
}
{
  const env = fresh("2026-10-03 20:30"); publishedTomato();
  const o = orderOf(DAY, [[1, 11, 4]], "waiting_confirmation");
  env.MSG_DEDUP.store.set(`cutoff_prompt:${C1}`, String(o));
  await quiet(() => worker.fetch(signed(inbound(C1_PHONE, { type: "text", text: { body: "تمام" } })), env, harnessCtx));
  assert("the reply to ح3's template below the minimum: the text, no confirm button", sentTo(C1_PHONE).some((b: any) => b.type === "text" && /أقل طلب 150 ريال/.test(b.text.body))
    && !sentTo(C1_PHONE).some((b: any) => b.type === "interactive"), JSON.stringify(sentTo(C1_PHONE)).slice(0, 300));
}

{
  const env = fresh("2026-10-03 10:00"); publishedTomato();
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  env.MSG_DEDUP.store.set(`ordering_open_${DAY}`, "true");
  extractOut = [{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 4 }] as any;
  const partner = { id: C1, name: "مطعم الوادي", x_whatsapp_number: "+" + C1_PHONE } as any;
  const r = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "w7", type: "text", text: "طماطم كرتون 4 خلاص", timestamp: "0" } as any, intent: "place_order", senderType: "customer", partner }));
  const o = rows("x_daily_order").find((x: any) => x.x_customer_id === C1 && x.x_order_date === DAY);
  assert("«طماطم كرتون 4 خلاص» (120): the items recorded, «أقل طلب 150 …», no quotation, no button, the order open",
    /أضفنا لطلبك|بديت لك طلب جديد/.test(String(r.text)) && /أقل طلب 150 ريال، أضف أصنافاً ليكتمل/.test(String(r.text)) && !r.buttons
      && rows("x_quotation").length === 0 && o?.x_state === "draft", JSON.stringify(r));
}

console.log("\n[د] planned stops empty: one alert a day to Baraa while a tier gives a discount");
{
  const env = fresh("2026-10-03 05:55"); tiers(0);
  const stopsAlerts = () => ownerTexts().filter((x) => x === OP.STOPS_ALERT_TEXT).length;
  assert("05:55: not yet", (await quiet(() => OP.checkPlannedStops(env, Date.now(), 360))).action === "before" && stopsAlerts() === 0);
  setRiyadh("2026-10-03 06:00");
  const P6 = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("06:00 (the prices tick): one alert", (P6.stops as any)?.action === "alerted" && stopsAlerts() === 1, JSON.stringify(P6.stops));
  setRiyadh("2026-10-03 06:05");
  await quiet(() => OP.checkPlannedStops(env, Date.now(), 360));
  assert("the same day again: no second alert", stopsAlerts() === 1);
  setRiyadh("2026-10-04 06:00");
  await quiet(() => OP.checkPlannedStops(env, Date.now(), 360));
  assert("the next day, still empty: one more", stopsAlerts() === 2);
  const env2 = fresh("2026-10-03 06:00"); tiers(12);
  assert("stops filled (12): no alert", (await quiet(() => OP.checkPlannedStops(env2, Date.now(), 360))).action === "set" && stopsAlerts() === 0);
  const env3 = fresh("2026-10-03 06:00");
  assert("no tier gives a discount: no alert", (await quiet(() => OP.checkPlannedStops(env3, Date.now(), 360))).action === "no_discount" && stopsAlerts() === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
