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
  "fixtures-odoo-fields-20260926-s40.json",       // § 40: every model the engine reads or writes
  "fixtures-odoo-fields-20260926-s41.json",       // § 41: «مسجل في الضريبة», x_utak_simulation on the per-day models (last: it wins)
  "fixtures-odoo-fields-20260928-s44.json", // § 44: x_vat_status / x_legal_name / x_vat_ask_count on res.partner (the invoice reads them), the purchase side (last: it wins)
  "fixtures-odoo-fields-20261001-s49.json", // § 46 + § 47: the pricing board's fields on x_price_day / x_price_day_line, x_expected_cartons, product.template.x_utak_new, x_min_margin_pct, x_break_even / x_suggested_price, x_decision «profit» (last: it wins)
].map((f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")));
const REAL: Record<string, string[]> = Object.assign({}, ...FIX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FIX.map((f) => f._selections ?? {}));
// § 53 — the tenant's fields now for the models § 53 touched (x_market_uplift_pct, x_uplift_pct, the purpose customer_pay_remind_iban): read last, they win
{
  const f53 = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20261008-s68.json", import.meta.url), "utf8")); // § 59 (after § 58: the company's working days, the two purposes) — § 58 (after § 56: the screen's fields): the plan, the actual and the tabs on the day and its lines
  for (const m of ["x_pricing_config", "x_price_day", "x_price_day_line"]) REAL[m] = f53[m];
  for (const m of ["x_operating_cost", "hr.employee", "hr.job"]) REAL[m] = f53[m]; // § 61: the job and the employee of a cost line, the job's own fields
  for (const m of ["x_price_offer", "x_special_quote", "x_special_quote_line", "x_special_quote_recipient"]) REAL[m] = f53[m]; // § 62: «خاص» on a source's offer (the day's readers leave it out), the three models of a special request
  for (const m of ["res.partner", "x_daily_price"]) REAL[m] = f53[m]; // § 65: «حالة المورد» on the card (the 02:00 ask, the closed numbers, the market sources read it), the size and the origin on a daily price
  for (const m of ["x_daily_order", "x_daily_order_line"]) REAL[m] = f53[m]; // § 66: the request an order came from, and «سعر خاص» / «التعبئة» / «الشراء» on its line (the order readers ask for them)
  for (const m of ["x_team_attendance", "resource.calendar.leaves", "x_delivery_route", "x_delivery_stop"]) REAL[m] = f53[m]; // § 68: the attendance record (the exit, the minutes late, the source, the place), the kind of a time off
  SELECTIONS["x_team_attendance.x_status"] = f53._selections["x_team_attendance.x_status"]; // § 68: «إجازة»
  SELECTIONS["x_whatsapp_template.x_purpose"] = f53._selections["x_whatsapp_template.x_purpose"];
}
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
/** Ahmed (supplier) and Omar (employee) are the two sources, as on the tenant — both «مسجل في الضريبة» (§ 41 أ). */
function sources(): void {
  seed("res.partner", { id: AHMED, name: "أحمد حسان", supplier_rank: 5, x_whatsapp_number: "+" + AHMED_PHONE, x_supplied_product_ids: [1, 2], x_price_source: true, x_vat_registered: true });
  Object.assign(table("hr.employee").get(OMAR_EMP)!, { x_price_source: true, x_vat_registered: true });
}
const offers = () => rows("x_price_offer");
const item = (product: number, packaging: number, cost: number, market: number | null = null, qty: number | null = null) =>
  ({ product_id: product, packaging_id: packaging, cost_price: cost, market_price: market, available_qty: qty, actual_weight_kg: null, notes: null });
// § 51 — the ask goes as a WhatsApp Flow (a field per active item) when it can, as its text otherwise: either is «the ask»
const askTexts = (digits: string) => sentTo(digits).filter((b) => (b?.type === "text" && /أرسل أسعار السوق اليوم/.test(String(b.text?.body ?? ""))) || b?.interactive?.type === "flow");
/** § 51 — with no item «نشط للبيع» there is no form to offer: the ask goes (or waits) as its text, the path of before § 51. */
const setActive = (on: boolean) => { for (const id of [1, 2]) table("product.template").get(id)!.x_is_active_for_sale = on; };
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
  // § 65 — Ahmed is an APPROVED supplier with his items on his card: the 02:00 ask is his, so the 02:30 ask is not
  Object.assign(table("res.partner").get(AHMED)!, { x_supplier_state: "approved" });
  openWindow(env, DRIVER_PHONE, 30);
  let r = await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  assert("02:25: before the ask", r.action === "before" && askTexts(DRIVER_PHONE).length === 0, JSON.stringify(r));
  setRiyadh("2026-10-03 02:30");
  const P = await import("../src/prices.ts");
  const tick = await quiet(() => P.runPricesTick(env, Date.now()));
  assert("02:30, in the */5 prices tick: the ask inside his window (a Flow since § 51)", askTexts(DRIVER_PHONE).length === 1 && (tick.marketAsk as any)?.action === "ran", JSON.stringify(tick.marketAsk));
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
  // the live cron's env: its sends carry the job «team_attendance»; an earlier text to Omar in that job today
  const env = fresh("2026-10-03 02:30", { onAttendance: false }); sources();
  openWindow(env, DRIVER_PHONE, 30);
  const cronEnv = { ...env, AUTO_SEND_JOB: "team_attendance" };
  const { sendButtons, sendText } = await import("../src/meta.ts");
  await quiet(() => sendText(cronEnv, `+${DRIVER_PHONE}`, "نص آلي سابق اليوم", { purpose: "team_task" }));
  // § 51 — the ask is an interactive message now (the Flow): an earlier interactive one of that job, too
  await quiet(() => sendButtons(cronEnv, `+${DRIVER_PHONE}`, "أزرار آلية سابقة اليوم", [{ id: "x", title: "تم" }], { purpose: "team_task" }));
  const P = await import("../src/prices.ts");
  await quiet(() => P.runPricesTick(cronEnv, Date.now()));
  assert("in the */5 cron's own env: the ask goes (its own auto-send job, not a «duplicate» of another text)", askTexts(DRIVER_PHONE).length === 1,
    JSON.stringify(sentTo(DRIVER_PHONE).map((b) => b.text?.body ?? b.interactive?.type)));
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
  setActive(false);                                   // § 51 — no form to offer: the text alone is queued (the Flow in the queue: tests/s51.test.mts)
  await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  setActive(true);
  assert("outside his window: nothing sent, the ask waits in the team queue", askTexts(DRIVER_PHONE).length === 0 && queueOf(env, DRIVER_PHONE).every((i: any) => !i.flow)
    && queueOf(env, DRIVER_PHONE).some((i: any) => i.purpose === "market_price_ask" && i.ask_day === "2026-10-03"), JSON.stringify(queueOf(env, DRIVER_PHONE)));
  extractOut = { prices: [item(1, 11, 24)], unrecognized: [] };
  setRiyadh("2026-10-03 02:50");
  const early = await quiet(() => PS.tryMarketReply(env, omar, `+${DRIVER_PHONE}`, "طماطم 24", "wamid.O0"));
  assert("before the ask reached him: a message is not read as prices", early === null && offers().length === 0);
  setRiyadh("2026-10-03 03:00"); openWindow(env, DRIVER_PHONE, 0);
  await quiet(() => flushTeamQueue(env, `+${DRIVER_PHONE}`));
  assert("03:00, the queue flushed (his message / tap): the ask reaches him", askTexts(DRIVER_PHONE).length === 1 && askTexts(DRIVER_PHONE)[0].type === "text");
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
  seed("res.partner", { id: FAHD, name: "فهد من السوق", supplier_rank: 0, x_whatsapp_number: "+" + FAHD_PHONE, x_price_source: true, x_supplier_state: "approved" }); // § 65: the 02:30 ask reaches an «معتمد» source alone
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
// § 54 — § 40 ج's message per exception («استثناء في أسعار اليوم», its pexc_ buttons, «عدّل» + a typed price) is gone:
// none may go any more. The day is reviewed in ONE message with three buttons (src/price-review.ts).
const excMsgs = () => sentTo(OWNER).filter((b: any) => /استثناء في أسعار اليوم/.test(JSON.stringify(b)) || /pexc_/.test(JSON.stringify(b)));
const btnIds = (b: any) => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id);
const btnTitles = (b: any) => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.title);
const PRV = await import("../src/price-review.ts");
/** The day's review as it reached Baraa: the interactive message that carries «✅ نفّذ المقترح» (§ 55; «✅ اعتمد الكل كما هو» before). */
const reviewMsgs = () => sentTo(OWNER).filter((b: any) => b?.type === "interactive" && btnIds(b).some((id: string) => /^prv_a_\d+_\d+$/.test(id)));
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? "");
/** § 55 — the review's second line (what «ربحنا» is), and the item line of a row with neither a purchase nor a market price. */
const PROFIT_NOTE = "(الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل)";
const bareLine = (name: string) => `❌ ${name} — لا سعر سوق | لا سعر شراء ← لا تنشر`;
/** The review form («✏️ عدّل»; «✏️ مراجعة» before § 55) as it reached him: a WhatsApp Flow whose token is the review's. */
const formMsgs = () => sentTo(OWNER).filter((b: any) => b?.interactive?.type === "flow" && PRV.isReviewFormToken(String(b.interactive.action?.parameters?.flow_token ?? "")));
/** The last form sent: its token, and its items as the token keeps them (the reply is read against them). */
async function lastForm(env: any): Promise<{ token: string; rec: any; of: (lineId: number) => any }> {
  const token = String(formMsgs().at(-1)?.interactive?.action?.parameters?.flow_token ?? "");
  const rec = await PRV.readReviewFormToken(env, token);
  return { token, rec, of: (lineId: number) => rec?.items.find((i: any) => i.lineId === lineId) };
}
/** Baraa's «اعتمد» on the form: the nfm_reply as src/meta.ts hands it over (the token and the fields). */
let formReplies = 0;
const formReply = (env: any, token: string, values: Record<string, unknown>) =>
  PRV.handlePriceReviewReply(env, { from: OWNER, messageId: `wamid.PRV${++formReplies}`, flow: { token, values } } as any);
/** A world with a carton share (500 ÷ 250 cartons = 2.00) and a minimum profit of 2 riyals: the lines carry «بدون خسارة» and a suggested price. */
function withShare(): void {
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  Object.assign(table("x_pricing_config").get(1)!, { x_expected_cartons: 250, x_min_profit_sar: 2 });
}
const tap = (id: string, title: string) => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
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

console.log("\n[ج] each exception: no purchase, no market, profit ≤ 0, an outlier (purchase or market); § 54: a loss (below «بدون خسارة»)");
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
  // § 54 أ — with a carton share (2.00) the exception of a priced line is a LOSS: the market below «أقل سعر بيع بدون
  // خسارة» ((20 + 1 + 2) × 1.15 = 26.45). «below_profit» (the market below the suggested 29) is no longer an exception.
  const floored = (market: number) => EN.computePricing([ITEM], [offer({ kind: "purchase", price: 20, model: "dp" }), offer({ kind: "market", price: market })], 5, { ratePct: 15 }, { opShare: 2, minProfit: 2 })[0];
  const h = floored(26);
  assert("(5) with a carton share: market 26 < «بدون خسارة» 26.45 → «loss», «سعر السوق 26 أقل من سعر بدون خسارة 26.45»; proposed «لا تنشر», never automatic",
    h.exceptions.join() === "loss" && h.reason === "سعر السوق 26 أقل من سعر بدون خسارة 26.45" && h.breakEven === 26.45 && h.suggested === 29 && h.proposal.kind === "skip" && h.proposal.why === "loss" && !h.proposal.auto
      && EN.lineVerdict(h, null, 0).status === "exception", JSON.stringify(h));
  const k = floored(28);
  assert("…market 28, between «بدون خسارة» 26.45 and the suggested 29 → NOT an exception: proposed «بسعر السوق» 28, automatic",
    k.exceptions.length === 0 && k.reason === "" && k.proposal.kind === "market" && k.proposal.price === 28 && k.proposal.why === "below_suggested" && k.proposal.auto
      && EN.lineVerdict(k, null, 0).status === "auto" && EN.lineVerdict(k, null, 0).sale === 28, JSON.stringify(k));
  assert("…and the old exceptions are not automatic by their proposal either: no purchase «لا تنشر», no market (no suggested price here) «لا تنشر», an outlier ⚠️",
    a.proposal.kind === "skip" && a.proposal.why === "no_purchase" && !a.proposal.auto && b.proposal.why === "no_price" && !b.proposal.auto
      && d.proposal.outlier && d.proposal.kind === "market" && d.proposal.price === 24 && !d.proposal.auto && EN.lineVerdict(d, null, 0).status === "exception", JSON.stringify([a.proposal, b.proposal, d.proposal]));
}

console.log("\n[ج] the engine on the day: sources only, simulation out, nothing from yesterday, every active product");
{
  const env = fresh("2026-10-03 04:10", { onAttendance: false }); sources();
  seed("res.partner", { id: 850, name: "مورد غير معلَّم", supplier_rank: 1, x_whatsapp_number: "+966500000850" });
  dp(1, 11, AHMED, 20);
  dp(1, 11, 850, 15);                          // a supplier without «مصدر أسعار»
  po(1, 11, DRIVER, { market: 26 });
  po(1, 11, DRIVER, { market: 99, sim: true, purchase: 1 }); // simulation
  po(1, 11, DRIVER, { market: 40, date: "2026-10-02" });    // yesterday
  const r = await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1)!, c = lineFor(2)!;
  assert("the record built, one line per active product (tomato priced, cucumber not)", r.action === "refreshed" && rows("x_price_day_line").length === 2, JSON.stringify(r));
  // § 41 أ — from the cutoff the sale price is VAT-inclusive; § 47 أ — the purchase price is net, whoever the
  // source (Ahmed «مسجل في الضريبة» or not): 26 ÷ 1.15 − 20 − 1 = 1.61. (No carton share in this world: the rule
  // before § 47 — an exception when the unit profit ≤ 0; tests/s47.test.mts runs the suggested price.)
  assert("tomato: purchase 20 (the unflagged supplier's 15 ignored), market 26 (not the simulation 99, not yesterday's 40), sale 26, auto",
    t.x_cost_price === 20 && t.x_market_price === 26 && t.x_market_count === 1 && t.x_sale_price === 26 && t.x_unit_profit === 1.61 && t.x_status === "auto" && !t.x_excluded, JSON.stringify(t));
  assert("cucumber (no offer at all): its default packaging, an exception", c.x_packaging_id === 21 && c.x_status === "exception" && c.x_reason === "لا سعر شراء، لا سعر سوق", JSON.stringify(c));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// § 54 ب — until § 54 every exception reached Baraa as its own message with its own buttons (and more than 8 as a link
// to Odoo). Now the whole day is ONE message — a line per item with its proposed decision — and three buttons.
console.log("\n[ج] the day's review to Baraa (§ 54): from 04:00, ONE message with every item and three buttons, once");
{
  const env = fresh("2026-10-03 03:55", { onAttendance: false }); sources();
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 20.5 });  // tomato: profit ≤ 0, a market price
  dp(2, 21, AHMED, 30);                                       // cucumber: no market price
  await quiet(() => PR.refreshPriceDay(env));
  const early = await quiet(() => PRV.notifyPriceReviewMessage(env));
  assert("03:55: nothing yet (Omar's window runs to 04:00)", early.action === "outside" && sentTo(OWNER).length === 0, JSON.stringify(early));
  setRiyadh("2026-10-03 04:00");
  const n1 = await quiet(() => PRV.notifyPriceReviewMessage(env));
  const msgs = reviewMsgs();
  assert("04:00: ONE message for the two items waiting (never a message per item)",
    n1.action === "sent" && n1.ver === 1 && n1.count === 2 && msgs.length === 1 && sentTo(OWNER).length === 1 && excMsgs().length === 0, JSON.stringify(n1));
  const d = dayOf()!, body = bodyOf(msgs[0]);
  // § 55 — the same three actions and payloads, renamed («✅ اعتمد الكل كما هو» / «✏️ مراجعة» / «⛔ لا تنشر اليوم» before)
  assert("its three buttons — «✅ نفّذ المقترح» / «✏️ عدّل» / «⛔ لا تنشر شيء» — carry the day and the review's version",
    JSON.stringify(btnIds(msgs[0])) === JSON.stringify([`prv_a_${d.id}_1`, `prv_r_${d.id}_1`, `prv_n_${d.id}_1`])
      && JSON.stringify(btnTitles(msgs[0])) === JSON.stringify(["✅ نفّذ المقترح", "✏️ عدّل", "⛔ لا تنشر شيء"]), JSON.stringify(msgs[0]?.interactive?.action));
  // § 47 أ — the purchase is net: 20.50 ÷ 1.15 − 20 − 1 = −3.17 ≤ 0 (no carton share in this world: the rule before § 47) → a loss.
  // § 55 — the line shows that net («ربحنا», signed, two decimals) in place of «الفرق 0.50 (3%)» (the market against the purchase), its mark
  // first (it was «طماطم: شراء 20 · سوق 20.50 · الفرق 0.50 (3%) ← لا تنشر (خسارة)»). The purchase price stays on the line, and beside it the
  // same price × 1.15 («شامل», to set against the market, which includes the VAT): 20 × 1.15 = 23.00
  assert("with a market price: the item's line — its mark ❌, the purchase 20 and beside it × 1.15 («23.00 شامل»), the market, «ربحنا» at it with its sign (17.83 − 21 = −3.17; this world has no carton share, and the line says so) — and its proposed decision («لا تنشر»); no «الفرق»",
    body.split("\n").includes("❌ طماطم — شراء 20 (23.00 شامل) · سوق 20.50 | ربحنا بسعر السوق (بلا حصة التشغيل): −3.17 ← لا تنشر") && !/الفرق/.test(body)
      // every purchase price of the message has its «شامل» beside it, before the market
      && JSON.stringify(body.match(/شراء \d[^·|\n]*/g)) === JSON.stringify(["شراء 20 (23.00 شامل) ", "شراء 30 (34.50 شامل) "]), body);
  // cucumber's purchase: 30 × 1.15 = 34.50
  assert("without a market price: the purchase 30 («34.50 شامل»), «لا سعر سوق», no profit to show, and — no suggested price to publish at — «لا تنشر»",
    body.split("\n").includes("❌ خيار — شراء 30 (34.50 شامل) · لا سعر سوق ← لا تنشر"), body);
  // § 55 — «0 للنشر · 2 لا تنشر · 0 ⚠️» and «بلا قرارك حتى 06:00: لا يُنشر شيء.» are three lines that name the items
  assert("the message: the day, what «ربحنا» is, and three lines — what «نفّذ المقترح» publishes, what it does not, and what goes out at the deadline (06:00) with no tap",
    body === ["📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026", PROFIT_NOTE, "", "❌ طماطم — شراء 20 (23.00 شامل) · سوق 20.50 | ربحنا بسعر السوق (بلا حصة التشغيل): −3.17 ← لا تنشر", "❌ خيار — شراء 30 (34.50 شامل) · لا سعر سوق ← لا تنشر", "",
      "لو ضغطت «نفّذ المقترح» ينتشر: لا شيء", "وما ينتشر: طماطم، خيار", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء"].join("\n"), body);
  assert("…and the lines still wait for him in Odoo with the engine's reason (nothing decided by the message itself)",
    lineFor(1)!.x_status === "exception" && lineFor(1)!.x_reason === "ربح الوحدة ≤ 0 (-3.17)" && lineFor(2)!.x_status === "exception" && !lineFor(1)!.x_decision && !lineFor(2)!.x_decision, JSON.stringify([lineFor(1), lineFor(2)]));
  setRiyadh("2026-10-03 04:05");
  const n2 = await quiet(() => PRV.notifyPriceReviewMessage(env));
  assert("the next tick: no second message (nothing changed since the one he has)", n2.action === "sent_before" && n2.ver === 1 && sentTo(OWNER).length === 1, JSON.stringify(n2));
  setRiyadh("2026-10-03 06:00");
  assert("from the publication time: no review message", (await quiet(() => PRV.notifyPriceReviewMessage(env))).action === "outside" && sentTo(OWNER).length === 1);
}
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
  const names = ["طماطم", "خيار"];
  for (let i = 0; i < 9; i++) {
    const pid = 100 + i;
    seed("product.template", { id: pid, name: `صنف ${i + 1}`, sale_ok: true, x_is_active_for_sale: true });
    seed("x_product_packaging", { id: 1000 + i, x_name: "كرتون", x_product_tmpl_id: pid, x_is_default: true });
    names.push(`صنف ${i + 1}`);
  }
  await quiet(() => PR.refreshPriceDay(env));   // 11 active products, no offer → 11 lines waiting
  const n = await quiet(() => PRV.notifyPriceReviewMessage(env));
  const body = bodyOf(reviewMsgs()[0]);
  // § 55 — «0 للنشر · 11 لا تنشر · 0 ⚠️» is the three lines: nothing published by «نفّذ المقترح», the 11 by name, nothing at 06:00.
  // These 11 items have no purchase price, so «شراء X (Y شامل)» adds nothing to their lines and the body is as long as it was — the title 43 +
  // the note 51 + 11 lines (43–44 each: 483) + the three lines (36 + 85 + 46) + 17 line breaks = 761 ≤ 1024: still above the buttons.
  // The update below, with «صنف جديد»: its title 57 + the note 51 + «تغيّر: …» 16 + 12 lines 530 + the three lines (36 + 95 + 46) + 19 = 850.
  assert("more than 8 items waiting (11): still ONE message — every item on its own line with its decision, no link to Odoo, no per-item messages",
    n.action === "sent" && n.count === 11 && n.parts === 0 && sentTo(OWNER).length === 1 && reviewMsgs().length === 1 && excMsgs().length === 0
      && names.every((x) => body.split("\n").includes(bareLine(x))) && body.split("\n").filter((l) => l.startsWith("❌ ")).length === 11
      && body.endsWith(`\n\nلو ضغطت «نفّذ المقترح» ينتشر: لا شيء\nوما ينتشر: ${names.join("، ")}\nلو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء`) && !/\/odoo\//.test(body), JSON.stringify({ n, body }));
  setRiyadh("2026-10-03 04:05");
  seed("product.template", { id: 120, name: "صنف جديد", sale_ok: true, x_is_active_for_sale: true });
  seed("x_product_packaging", { id: 1020, x_name: "كرتون", x_product_tmpl_id: 120, x_is_default: true });
  await quiet(() => PR.refreshPriceDay(env));
  const n2 = await quiet(() => PRV.notifyPriceReviewMessage(env));
  const d = dayOf()!, upd = bodyOf(reviewMsgs()[1]);
  // § 54 ب — it was «no second message»: an item that starts waiting after the review was sent would never have reached him
  assert("…a later item on the same day: the review again, ONE message («🔄 تحديث», version 2) with the 12 items, naming what changed",
    n2.action === "sent" && n2.ver === 2 && n2.count === 12 && sentTo(OWNER).length === 2 && reviewMsgs().length === 2
      && upd.startsWith(`🔄 تحديث مراجعة أسعار اليوم (04:05) — السبت 3 أكتوبر 2026\n${PROFIT_NOTE}\nتغيّر: صنف جديد.\n\n`) && upd.split("\n").includes(bareLine("صنف جديد"))
      && names.every((x) => upd.split("\n").includes(bareLine(x))) && upd.split("\n").includes(`وما ينتشر: ${[...names, "صنف جديد"].join("، ")}`)
      && JSON.stringify(btnIds(reviewMsgs()[1])) === JSON.stringify([`prv_a_${d.id}_2`, `prv_r_${d.id}_2`, `prv_n_${d.id}_2`]), JSON.stringify({ n2, upd }));
  setRiyadh("2026-10-03 04:10");
  assert("…and once: the tick after it sends nothing", (await quiet(() => PRV.notifyPriceReviewMessage(env))).action === "sent_before" && sentTo(OWNER).length === 2);
  graph.length = 0;
  const stale = await quiet(() => PRV.handlePriceReviewButton(env, `prv_n_${d.id}_1`));
  assert("…the buttons of the older message no longer decide: one line says a newer review reached him, nothing written",
    stale === "stale" && ownerTexts().length === 1 && /نسخة أحدث من مراجعة أسعار اليوم \(04:05\)/.test(ownerTexts()[0]) && rows("x_price_day_line").every((l: any) => !l.x_decision), JSON.stringify({ stale, t: ownerTexts() }));
}
{
  // the shape of the ONE message follows its length, not a count of exceptions (it was: up to 8 a message each, more → a link).
  // § 55 — no item of these two worlds has a purchase price («شراء X (Y شامل)» is written with one only), so their lines are as long as they
  // were: 8 items = 605 characters (title 43 + note 51 + 8 lines 351 + the three lines 36 + 64 + 46 + 14 line breaks) ≤ 1024 — one message;
  // such a body passes 1024 at 16 items (15: 977, 16: 1031), and 40 is far over it — the table as text, then the buttons.
  const world = (extra: number) => {
    const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
    for (let i = 0; i < extra; i++) {
      seed("product.template", { id: 100 + i, name: `صنف ${i + 1}`, sale_ok: true, x_is_active_for_sale: true });
      seed("x_product_packaging", { id: 1000 + i, x_name: "كرتون", x_product_tmpl_id: 100 + i, x_is_default: true });
    }
    return env;
  };
  const env8 = world(6);
  await quiet(() => PR.refreshPriceDay(env8));   // exactly 8
  const n8 = await quiet(() => PRV.notifyPriceReviewMessage(env8));
  assert("exactly 8 items: the whole review above the three buttons, in one message (no text before it)",
    n8.action === "sent" && n8.count === 8 && n8.parts === 0 && sentTo(OWNER).length === 1 && reviewMsgs().length === 1 && excMsgs().length === 0
      && bodyOf(reviewMsgs()[0]).length <= PRV.INTERACTIVE_BODY_MAX && bodyOf(reviewMsgs()[0]).split("\n").includes(bareLine("صنف 6"))
      && bodyOf(reviewMsgs()[0]).endsWith("\nلو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء"), JSON.stringify({ n8, body: bodyOf(reviewMsgs()[0]) }));
  const env40 = world(38);
  await quiet(() => PR.refreshPriceDay(env40));  // 40: the table is longer than an interactive message's text (1024)
  const n40 = await quiet(() => PRV.notifyPriceReviewMessage(env40));
  const all = sentTo(OWNER), table40 = String(all[0]?.text?.body ?? ""), sum = bodyOf(all[1]);
  const names40 = ["طماطم", "خيار", ...Array.from({ length: 38 }, (_, i) => `صنف ${i + 1}`)];
  // § 55 — the three lines close the table's text BY NAME; under the buttons they are the summary, by number (it was «0 للنشر · 40 لا تنشر · 0 ⚠️»)
  assert("40 items: the table first as plain text (every item once), then the three buttons under its summary — one review, not 40 messages",
    n40.action === "sent" && n40.count === 40 && n40.parts === 1 && all.length === 2 && all[0].type === "text" && reviewMsgs().length === 1 && all[1] === reviewMsgs()[0]
      && table40.startsWith(`📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026\n${PROFIT_NOTE}\n\n`) && names40.map(bareLine).every((x) => table40.split(x).length === 2)
      && table40.endsWith(`\n\nلو ضغطت «نفّذ المقترح» ينتشر: لا شيء\nوما ينتشر: ${names40.join("، ")}\nلو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء`)
      && table40.length <= PR.PRICE_TEXT_LIMIT && sum.length <= PRV.INTERACTIVE_BODY_MAX
      && sum === ["📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026", "40 صنفاً في الجدول أعلاه.", "لو ضغطت «نفّذ المقترح» ينتشر: لا شيء", "وما ينتشر: 40 صنفاً", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء"].join("\n")
      && !sum.includes("صنف 1 —") && !sum.includes("طماطم"), JSON.stringify({ n40, sum, len: table40.length, tail: table40.slice(-500) }));
}

// § 54 ج — the per-item buttons (pexc_m / pexc_s / pexc_e) and «عدّل» + a price typed within 30 minutes are gone. A decision
// is taken from the review's three buttons, or item by item in its form («✏️ عدّل»; «✏️ مراجعة» before § 55); it lands in the same fields of the line.
console.log("\n[ج] Baraa's decision (§ 54): the form («✏️ عدّل») item by item — the line's own fields, the token read once");
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources(); withShare();
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 26 });    // tomato: full cost 20 + 1 + 2 = 23 → «بدون خسارة» 26.45: the market 26 is a loss
  dp(2, 21, AHMED, 30);                                       // cucumber: no market; suggested (30 + 1.5 + 2 + 2) × 1.15 = 40.83 → 41
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PRV.notifyPriceReviewMessage(env));
  const d = dayOf()!, tl = lineFor(1)!, cl = lineFor(2)!;
  assert("§ 54 أ — the exception's reason: «سعر السوق 26 أقل من سعر بدون خسارة 26.45» (it was «… أقل من السعر المربح 29»)",
    tl.x_status === "exception" && tl.x_reason === "سعر السوق 26 أقل من سعر بدون خسارة 26.45" && tl.x_break_even === 26.45 && tl.x_suggested_price === 29, JSON.stringify(tl));
  graph.length = 0;
  const f1 = await quiet(() => PRV.handlePriceReviewButton(env, `prv_r_${d.id}_1`));
  const form = await lastForm(env);
  const tomato = form.of(tl.id), cuc = form.of(cl.id);
  assert("«✏️ عدّل» → the form (a WhatsApp Flow), nothing written yet", f1 === "form" && sentTo(OWNER).length === 1 && formMsgs().length === 1 && !lineFor(1)!.x_decision && !lineFor(2)!.x_decision, JSON.stringify({ f1, sent: sentTo(OWNER).length }));
  // § 55 — every choice carries its own «ربح» (the net of a carton at that price) and no longer opens with «انشر»; the ids are § 54's.
  // tomato (full cost 23): at the suggested 29 → 25.22 − 23 = +2.22; at the market 26 → 22.61 − 23 = −0.39 (it was «انشر بالمقترح (29)» / «انشر بسعر السوق (26)»)
  assert("with a market price: «بالمقترح 29 (ربح +2.22)» / «بسعر السوق 26 (ربح −0.39)» / «لا تنشر» / «سعر يدوي», opened on the proposed «لا تنشر»",
    JSON.stringify(tomato?.options) === JSON.stringify([{ id: "profit", title: "بالمقترح 29 (ربح +2.22)" }, { id: "market", title: "بسعر السوق 26 (ربح −0.39)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }])
      && tomato?.selected === "skip", JSON.stringify(tomato));
  // cucumber (full cost 33.5): at the suggested 41 → 35.65 − 33.5 = +2.15 (it was «انشر بالمقترح (41)»)
  assert("without a market price: «بالمقترح 41 (ربح +2.15)» / «لا تنشر» / «سعر يدوي» only — no «بسعر السوق» — opened on the proposed «بالمقترح»",
    JSON.stringify(cuc?.options.map((o: any) => o.id)) === JSON.stringify(["profit", "skip", "manual"]) && cuc?.options[0].title === "بالمقترح 41 (ربح +2.15)" && cuc?.selected === "profit", JSON.stringify(cuc));
  graph.length = 0;
  const r1 = await quiet(() => formReply(env, form.token, { [`d${tomato.slot}`]: "market", [`d${cuc.slot}`]: "market" }));
  const t2 = lineFor(1)!, c2 = lineFor(2)!;
  assert("«بسعر السوق» without a market price is never taken: the item keeps the choice its list opened on (the suggested 41), no market price written",
    c2.x_decision === "profit" && c2.x_manual_for === "profit" && c2.x_manual_price === 41 && c2.x_status === "manual" && c2.x_sale_price === 41 && !c2.x_market_price, JSON.stringify(c2));
  assert("«بسعر السوق» → approved by hand at the market price (26), in the line's own decision fields",
    r1.action === "decided" && r1.written === 2 && t2.x_decision === "market" && t2.x_manual_for === "market" && t2.x_manual_price === 26 && t2.x_status === "manual" && t2.x_sale_price === 26
      && t2.x_reason === "براء: اعتمد بسعر السوق" && !t2.x_excluded && !!t2.x_decided_at, JSON.stringify({ r1, t2 }));
  const conf = ownerTexts();
  // § 55 — each published item ends with «ربحنا» at its price (his own choice of the market 26 loses 0.39), then the plain mean: (−0.39 + 2.15) ÷ 2 = +0.88
  assert("…and ONE confirmation: what will be published at 06:00, each at its price and with its profit, then «متوسط الربح للكرتون»",
    conf.length === 1 && conf[0] === "✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026.\nسيُنشر 06:00:\n• طماطم — 26 ر.س (سعر السوق) · ربحنا −0.39\n• خيار — 41 ر.س (المقترح) · ربحنا +2.15\nمتوسط الربح للكرتون: +0.88", JSON.stringify(conf));
  graph.length = 0;
  const r3 = await quiet(() => formReply(env, form.token, { [`d${tomato.slot}`]: "skip", [`d${cuc.slot}`]: "skip" }));
  assert("the same form sent a second time → «سبق اعتماده», unchanged (a token is read once)",
    r3.action === "duplicate" && JSON.stringify(ownerTexts()) === JSON.stringify([PRV.REVIEW_FORM_USED_TEXT]) && lineFor(1)!.x_decision === "market" && lineFor(2)!.x_decision === "profit", JSON.stringify({ r3, t: ownerTexts() }));
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("the next refresh keeps his decision (manual, 26)", lineFor(1)!.x_status === "manual" && lineFor(1)!.x_sale_price === 26 && lineFor(2)!.x_status === "manual" && lineFor(2)!.x_sale_price === 41);
  // «سعر يدوي» — the form's own price field took the place of the per-item «عدّل» of before § 54 and the number typed within 30 minutes
  setRiyadh("2026-10-03 04:10");
  graph.length = 0;
  const e1 = await quiet(() => PRV.handlePriceReviewButton(env, `prv_r_${d.id}_0`));
  const form2 = await lastForm(env);
  const tomato2 = form2.of(tl.id), cuc2 = form2.of(cl.id);
  assert("«✏️ عدّل» under the confirmation → a new form, opened on his own decisions; nothing written by opening it",
    e1 === "form" && form2.token !== form.token && tomato2?.selected === "market" && cuc2?.selected === "profit" && lineFor(2)!.x_manual_price === 41, JSON.stringify({ e1, tomato2, cuc2 }));
  const manual = (p: unknown) => PRV.readReviewValues(form2.rec, { [`d${cuc2.slot}`]: "manual", [`p${cuc2.slot}`]: p });
  assert("«سعر يدوي» without ONE number above zero («خليه تمام», «35 أو 36», 0, nothing) → nothing is read for the item",
    ["خليه تمام", "35 أو 36", "0", "", undefined].every((p) => { const e = manual(p); return e.noPrice.some((i: any) => i.lineId === cl.id) && !e.decisions.some((x: any) => x.lineId === cl.id); }));
  assert("a price typed beside another choice is not read («السعر اليدوي» counts with «سعر يدوي» alone)",
    PRV.readReviewValues(form2.rec, { [`d${cuc2.slot}`]: "profit", [`p${cuc2.slot}`]: "35" }).decisions.find((x: any) => x.lineId === cl.id)?.kind === "profit");
  graph.length = 0;
  const e4 = await quiet(() => formReply(env, form2.token, { [`d${cuc2.slot}`]: "manual", [`p${cuc2.slot}`]: "٣٥٫٥" }));
  const c4 = lineFor(2)!;
  assert("«سعر يدوي» «٣٥٫٥» → the approved sale price 35.50 (the tomato, left as it opened, is not written again)",
    e4.action === "decided" && e4.written === 1 && c4.x_decision === "edit" && c4.x_manual_for === "edit" && c4.x_manual_price === 35.5 && c4.x_status === "manual" && c4.x_sale_price === 35.5
      && c4.x_reason === "براء: سعر معدّل" && lineFor(1)!.x_decision === "market" && lineFor(1)!.x_sale_price === 26, JSON.stringify({ e4, c4 }));
  // 30 + 1.5 + 2 = 33.5 → «بدون خسارة» 38.53; § 55 — «ربحنا» at his 35.50: 30.87 − 33.5 = −2.63, and the mean with the tomato's −0.39: −1.51
  assert("…its confirmation: «• خيار — 35.50 ر.س (سعر يدوي) · ربحنا −2.63», the mean of the two («متوسط الربح للكرتون: −1.51»), and a ⚠️ line: his price is below «بدون خسارة» 38.53 (taken all the same)",
    ownerTexts().length === 1 && ownerTexts()[0].split("\n").includes("• خيار — 35.50 ر.س (سعر يدوي) · ربحنا −2.63") && ownerTexts()[0].split("\n").includes("• طماطم — 26 ر.س (سعر السوق) · ربحنا −0.39")
      && ownerTexts()[0].split("\n").includes("متوسط الربح للكرتون: −1.51") && ownerTexts()[0].split("\n").includes("⚠️ خيار: السعر اليدوي 35.50 أقل من سعر بدون خسارة 38.53."), JSON.stringify(ownerTexts()));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
console.log("\n[ج] Baraa's decision (§ 54): the three buttons, the lock");
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources(); withShare();
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 28 });    // tomato: «بدون خسارة» 26.45 ≤ 28 < the suggested 29
  dp(2, 21, AHMED, 30);                                       // cucumber: no market → proposed at the suggested 41, by his word alone
  await quiet(() => PR.refreshPriceDay(env));
  // § 54 أ — it was an exception («سعر السوق 28 أقل من السعر المربح 29») waiting for his choice
  assert("§ 54 أ — a market price between «بدون خسارة» (26.45) and the suggested price (29): automatic at the market price (28), no exception",
    lineFor(1)!.x_status === "auto" && lineFor(1)!.x_sale_price === 28 && !lineFor(1)!.x_excluded && !lineFor(1)!.x_reason && lineFor(2)!.x_status === "exception", JSON.stringify(lineFor(1)));
  await quiet(() => PRV.notifyPriceReviewMessage(env));
  const d = dayOf()!, body = bodyOf(reviewMsgs()[0]);
  // § 55 — «ربحنا» in place of «الفرق 8 (40%)»: tomato at the market 28 → 24.35 − 23 = +1.35; cucumber at the suggested 41 → 35.65 − 33.5 = +2.15.
  // Each line keeps its purchase price, with × 1.15 beside it: 20 → 23.00, 30 → 34.50.
  // «2 للنشر · 0 لا تنشر · 0 ⚠️» and «بلا قرارك حتى 06:00: يُنشر تلقائياً 1 …» are the three lines, by name and price
  assert("the review shows both — the automatic line too, each ✅ with its purchase price («… شامل» beside it) and its profit — and says what «نفّذ المقترح» publishes and what is published without him",
    body.split("\n").includes("✅ طماطم — شراء 20 (23.00 شامل) · سوق 28 | ربحنا بسعر السوق: +1.35 ← انشر بـ 28") && body.split("\n").includes("✅ خيار — شراء 30 (34.50 شامل) · لا سعر سوق | ربحنا بالمقترح 41: +2.15 ← انشر بـ 41")
      && body.endsWith("\n\nلو ضغطت «نفّذ المقترح» ينتشر: طماطم 28، خيار 41\nوما ينتشر: لا شيء\nلو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: طماطم 28"), body);
  graph.length = 0;
  const s1 = await quiet(() => PRV.handlePriceReviewButton(env, `prv_n_${d.id}_1`));
  const t1 = lineFor(1)!, c1 = lineFor(2)!;
  assert("«⛔ لا تنشر شيء» → «لم يُنشر» with his reason on every line (the automatic one too)",
    s1 === "none:2" && [t1, c1].every((l) => l.x_decision === "skip" && l.x_status === "unpublished" && l.x_reason === "براء: لا تنشر" && l.x_excluded === true && l.x_sale_price === 0 && !!l.x_decided_at), JSON.stringify({ s1, t1, c1 }));
  assert("…answered once: «⛔ لن تُنشر أسعار اليوم», with «✏️ عدّل» to take it back before 06:00",
    sentTo(OWNER).length === 1 && bodyOf(sentTo(OWNER)[0]).startsWith("⛔ لن تُنشر أسعار اليوم (2 ") && /سُجّل «لا تنشر» عليها كلها/.test(bodyOf(sentTo(OWNER)[0])) && /للتراجع قبل 06:00: «✏️ عدّل»\.$/.test(bodyOf(sentTo(OWNER)[0]))
      && JSON.stringify(btnIds(sentTo(OWNER)[0])) === JSON.stringify([`prv_r_${d.id}_0`]) && JSON.stringify(btnTitles(sentTo(OWNER)[0])) === JSON.stringify(["✏️ عدّل"]), JSON.stringify(sentTo(OWNER)));
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("…and the next refresh keeps it («لم يُنشر»)", [lineFor(1)!, lineFor(2)!].every((l) => l.x_status === "unpublished" && l.x_reason === "براء: لا تنشر" && l.x_sale_price === 0), JSON.stringify([lineFor(1), lineFor(2)]));
  graph.length = 0;
  const s2 = await quiet(() => PRV.handlePriceReviewButton(env, `prv_n_${d.id}_1`));
  assert("the same button a second time (a double tap) → «سُجّل قرارك من هذه الرسالة مسبقاً», nothing written again",
    s2 === "duplicate" && ownerTexts().length === 1 && /سُجّل قرارك من هذه الرسالة مسبقاً/.test(ownerTexts()[0]) && lineFor(1)!.x_decided_at === t1.x_decided_at, JSON.stringify({ s2, t: ownerTexts() }));
  graph.length = 0;
  const s3 = await quiet(() => PRV.handlePriceReviewButton(env, `prv_a_${d.id}_1`));
  assert("another button of the same message after it («✅ نفّذ المقترح») → his decision stands: «كان عليها قرار مسبق», unchanged",
    s3 === "all:0" && ownerTexts().length === 1 && /كل الأصناف كان عليها قرار مسبق: لم يتغير شيء/.test(ownerTexts()[0]) && lineFor(1)!.x_decision === "skip" && lineFor(2)!.x_decision === "skip", JSON.stringify({ s3, t: ownerTexts() }));
}
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources(); withShare();
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 28 });
  dp(2, 21, AHMED, 30);
  await quiet(() => PR.refreshPriceDay(env));
  await quiet(() => PRV.notifyPriceReviewMessage(env));
  const d = dayOf()!, tl = lineFor(1)!, cl = lineFor(2)!;
  const untouched = () => !lineFor(1)!.x_decision && lineFor(1)!.x_status === "auto" && lineFor(1)!.x_sale_price === 28 && !lineFor(2)!.x_decision && lineFor(2)!.x_status === "exception" && lineFor(2)!.x_sale_price === 0;
  // a per-item exception message of before § 54 may still sit in his chat
  for (const [id, title] of [[`pexc_e_${cl.id}`, "عدّل"], [`pexc_m_${tl.id}`, "اعتمد بسعر السوق"], [`pexc_p_${cl.id}`, "اعتمد بالسعر المربح"], [`pexc_s_${tl.id}`, "لا تنشر"]]) {
    graph.length = 0;
    await quiet(() => worker.fetch(signed(inbound(OWNER, tap(id, title))), env, harnessCtx));
    assert(`through /webhook: a tap on an old «${title}» (${id.slice(0, 6)}) decides nothing — one line, OLD_EXCEPTION_TEXT`,
      JSON.stringify(ownerTexts()) === JSON.stringify([PR.OLD_EXCEPTION_TEXT]) && untouched(), JSON.stringify({ t: ownerTexts(), l: [lineFor(1), lineFor(2)] }));
  }
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "text", text: { body: "23" } })), env, harnessCtx));
  assert("…his «23» after «عدّل» is not read as a price any more: nothing written, nothing sent", sentTo(OWNER).length === 0 && untouched(), JSON.stringify({ t: ownerTexts(), l: lineFor(2) }));
  await quiet(() => worker.fetch(signed(inbound(OWNER, tap(`prv_a_${d.id}_1`, "✅ نفّذ المقترح"))), env, harnessCtx));
  const t2 = lineFor(1)!, c2 = lineFor(2)!;
  assert("through /webhook: his tap on «✅ نفّذ المقترح» → every item takes the decision the message showed: tomato «market» 28, cucumber «profit» 41",
    t2.x_decision === "market" && t2.x_manual_for === "market" && t2.x_manual_price === 28 && t2.x_status === "manual" && t2.x_sale_price === 28
      && c2.x_decision === "profit" && c2.x_manual_for === "profit" && c2.x_manual_price === 41 && c2.x_status === "manual" && c2.x_sale_price === 41 && !c2.x_excluded && !!c2.x_decided_at, JSON.stringify([t2, c2]));
  // § 55 — each item with «ربحنا» (+1.35, +2.15: the review's own numbers), then their plain mean: (1.35 + 2.15) ÷ 2 = +1.75
  assert("…and the confirmation, once: «سيُنشر 06:00» with both — each with its profit — «متوسط الربح للكرتون: +1.75», and «✏️ عدّل» under it",
    sentTo(OWNER).length === 1 && bodyOf(sentTo(OWNER)[0]).startsWith("✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026.\nسيُنشر 06:00:\n• طماطم — 28 ر.س (سعر السوق) · ربحنا +1.35\n• خيار — 41 ر.س (المقترح) · ربحنا +2.15\nمتوسط الربح للكرتون: +1.75")
      && JSON.stringify(btnIds(sentTo(OWNER)[0])) === JSON.stringify([`prv_r_${d.id}_0`]) && JSON.stringify(btnTitles(sentTo(OWNER)[0])) === JSON.stringify(["✏️ عدّل"]), JSON.stringify(sentTo(OWNER)));
  graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "text", text: { body: "مرحبا" } })), env, harnessCtx));
  assert("…any other text of his: nothing (the owner guard as before)", sentTo(OWNER).length === 0);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] the publication time: automatic lines published, an exception without a decision not");
{
  const env = fresh("2026-10-03 04:00", { onAttendance: false }); sources();
  seed("res.partner", { id: 891, name: "مطعم الوادي 2", customer_rank: 1, x_whatsapp_number: "+966500000891" });
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 26 });   // tomato: automatic at 26 (26 ÷ 1.15 − 21 > 0)
  dp(2, 21, AHMED, 30);                                       // cucumber: an exception, no decision
  const t0 = await quiet(() => PR.runPricesTick(env, Date.now()));
  // § 54 ب — the tick's `exceptions` is `review`: ONE message with both items (it was a message for the cucumber alone);
  // its count is the items that need his decision (the cucumber: the automatic tomato is shown, not counted)
  // § 55 — tomato's «ربحنا» at the market 26 is the unit profit of this world (no carton share): 22.61 − 21 = +1.61 (it was «الفرق 6 (30%)»);
  // the purchase prices with × 1.15 beside them: 20 → 23.00, 30 → 34.50;
  // «بلا قرارك حتى 06:00: يُنشر تلقائياً 1 …» is the third of the three lines, by name and price
  assert("04:00 tick: the record built, the day's review sent to Baraa — one message, saying what 06:00 will do without him",
    !!dayOf() && (t0.review as any)?.action === "sent" && (t0.review as any)?.count === 1 && sentTo(OWNER).length === 1 && reviewMsgs().length === 1 && excMsgs().length === 0
      && bodyOf(reviewMsgs()[0]).split("\n").includes("✅ طماطم — شراء 20 (23.00 شامل) · سوق 26 | ربحنا بسعر السوق (بلا حصة التشغيل): +1.61 ← انشر بـ 26")
      && bodyOf(reviewMsgs()[0]).split("\n").includes("❌ خيار — شراء 30 (34.50 شامل) · لا سعر سوق ← لا تنشر")
      && bodyOf(reviewMsgs()[0]).endsWith("\n\nلو ضغطت «نفّذ المقترح» ينتشر: طماطم 26\nوما ينتشر: خيار\nلو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: طماطم 26"), JSON.stringify({ r: t0.review, b: ownerTexts() }));
  setRiyadh("2026-10-03 05:55");
  const t1 = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("05:55: nothing published yet (no wait for Baraa, but the time is 06:00), and no second review", dayOf()!.x_state === "draft" && (t1.review as any)?.action === "sent_before" && sentTo(OWNER).length === 1, JSON.stringify(t1.review));
  setRiyadh("2026-10-03 06:00");
  const t = await quiet(() => PR.runPricesTick(env, Date.now()));
  const d = dayOf()!;
  assert("06:00: approved by the worker and published (no Baraa in it)", (t.deadline as any)?.action === "auto_published" && d.x_state === "published" && !d.x_approved_by, JSON.stringify(t.deadline));
  const list = heldFor(env, "966500000891");
  assert("the customers' list: tomato at 26 only (the undecided cucumber left out)", list.length === 1 && /• طماطم \(كرتون\): 26 ر.س/.test(JSON.stringify(list[0])) && !/خيار/.test(JSON.stringify(list[0])), JSON.stringify(list).slice(0, 300));
  assert("the cucumber: «لم يُنشر» (استثناء بلا قرار)", lineFor(2)!.x_status === "unpublished" && /استثناء بلا قرار/.test(String(lineFor(2)!.x_reason)));
  // § 54 د — ONE message at 06:00: the publication's own copy names what stayed out and why (it was a second alert «⏰ لم يُنشر اليوم 1 صنف: استثناء بلا قرار…»)
  const pub = ownerTexts().filter((x) => x.startsWith("📢 نُشرت أسعار"));
  assert("Baraa: the publication's message names the undecided item and why — «لم يُنشر (1): خيار (بلا سعر سوق وبلا قرار)» — and no second alert",
    pub.length === 1 && pub[0].split("\n").includes("لم يُنشر (1): خيار (بلا سعر سوق وبلا قرار).") && pub[0].includes("• طماطم (كرتون): 26 ر.س") && !ownerTexts().some((x) => x.startsWith("⏰")), JSON.stringify(ownerTexts()));
  graph.length = 0;
  const late: string[] = [];
  for (const id of [`prv_a_${d.id}_1`, `prv_n_${d.id}_1`, `prv_r_${d.id}_1`]) late.push(await quiet(() => PRV.handlePriceReviewButton(env, id)));
  assert("a tap on the review's buttons after the publication → «نُشرت أسعار … فلا قرار عليها الآن», nothing written, no form",
    late.every((x) => x === "refused") && ownerTexts().length === 3 && ownerTexts().every((x) => /^نُشرت أسعار 3 أكتوبر 2026، فلا قرار عليها الآن/.test(x)) && formMsgs().length === 0
      && !lineFor(2)!.x_decision && !lineFor(1)!.x_decision && lineFor(2)!.x_status === "unpublished" && dayOf()!.x_state === "published", JSON.stringify({ late, t: ownerTexts() }));
  const p = await quiet(() => (import("../src/odoo.ts")).then((m) => m.getLatestSalePrice(env, 1, 11)));
  assert("the quotation / invoice price: today's published 26", p.price === 26 && p.source === "today", JSON.stringify(p));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] the publication time takes the last offers; the tick runs the engine only in its window");
{
  const env = fresh("2026-10-03 05:55", { onAttendance: false }); sources();
  seed("res.partner", { id: 891, name: "مطعم الوادي 2", customer_rank: 1, x_whatsapp_number: "+966500000891" });
  dp(1, 11, AHMED, 20); po(1, 11, DRIVER, { market: 26 });
  dp(2, 21, AHMED, 30);
  await quiet(() => PR.refreshPriceDay(env));
  setRiyadh("2026-10-03 05:58");
  po(2, 21, DRIVER, { market: 38 });                          // arrives after the last tick (38 ÷ 1.15 − 30 − 1.5 > 0)
  setRiyadh("2026-10-03 06:00");
  const r = await quiet(() => PR.checkPricesDeadline(env));
  assert("an observation of 05:58 counts at 06:00 (the engine's last word): cucumber published at 38",
    r.action === "auto_published" && lineFor(2)!.x_status === "auto" && /• خيار \(جرم\): 38 ر.س/.test(JSON.stringify(heldFor(env, "966500000891"))), JSON.stringify(r));
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
  // § 49 ب — a cancelled order is still not revived: its items start a NEW order, and it is that one the minimum speaks of
  const again = rows("x_daily_order").find((x: any) => x.x_customer_id === C1 && x.id !== o) as any;
  assert("ح4 first: a cancelled order below the minimum gets ح4's answer (it stays cancelled); the minimum is said of the new order its items start", /أُلغي/.test(String(r.text)) && table("x_daily_order").get(o)!.x_state === "cancelled" && String(r.text).includes(`#${again?.id}`) && /أقل طلب 150 ريال/.test(String(r.text)) && again?.x_state === "draft" && !r.buttons, JSON.stringify(r));
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

// § 41 ب (2026-09-26): «[د] planned stops empty: one alert a day to Baraa» was
// deleted with the alert itself; tests/s41.test.mts [ب] checks it is gone and
// the discount still stays off while the field is empty.

// ================================================================ [هـ]
const SUM = await import("../src/owner-summary.ts");
const YDAY = "2026-10-02";
/** Yesterday's order delivered this morning: its lines [product, packaging, qty, price written back by the invoice]. */
function delivered(lines: Array<[number, number, number, number]>, extra: Record<string, unknown> = {}): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: YDAY, x_created_via: "whatsapp", ...extra });
  for (const [p, k, q, u] of lines) seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: p, x_packaging_id: k, x_quantity: q, x_unit_price: u, x_status: "delivered" });
  return id;
}
function summaryEnv(): any {
  const env = fresh("2026-10-03 21:30");
  seed("x_whatsapp_template", { x_purpose: "owner_summary", x_meta_template_id: "utak_v2_summary", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 3, x_category: "UTILITY",
    x_body_text: "ملخص اليوم جاهز\nطلبات: {{1}}\nتوصيلات: {{2}}\nإجمالي: {{3}} ريال\nتفاصيل أكثر في لوحة القيادة." });
  cost("السيارة والسائق (شامل)", "daily", 500, "2026-10-01");
  publishedTomato(YDAY);                                      // yesterday: tomato bought at 20
  publishedTomato(DAY, 26, 32);                               // today's prices: not the delivered orders' day
  const o = delivered([[1, 11, 20, 30]]);                     // § 47 أ: 20 × (30 ÷ 1.15 − 20 − 1) = 101.74 (the purchase 20 is net)
  seed("x_invoice", { x_invoice_number: "UTAK-INV-20261003-001", x_order_id: o, x_invoice_date: DAY, x_status: "issued", x_subtotal: 521.74, x_tax_amount: 76.7, x_total: 588.01, x_discount: 10.43 });
  delivered([[1, 11, 50, 30]], { x_utak_simulation: true }); // simulation: out
  return env;
}
const summaryMsgs = () => sentTo(OWNER).filter((b: any) => b?.type === "text" && String(b.text?.body).startsWith("📊") || b?.template?.name === "utak_v2_summary");

console.log("\n[هـ] 21:30: today's profit ÷ today's operating cost — inside Baraa's window a fourth line");
{
  const env = summaryEnv();
  const f = await quiet(() => SUM.readSummaryFigures(env));
  // § 41 أ — 10-03 is after the cutoff; § 47 أ — the purchase is net: 20 × (30 ÷ 1.15 − 21) = 101.74, less the
  // discount as the customer saw it (600 − 588.01 = 11.99) ÷ 1.15 = 10.43 → 91.31 (it was (180 − 11.99) ÷ 1.15 = 146.10)
  assert("profit 20 × (30 ÷ 1.15 − 21) − the invoice's discount 11.99 ÷ 1.15 = 91.31 (the simulation order out); cost 500; 18%",
    f.coverage.profit === 91.31 && f.coverage.cost === 500 && f.coverage.pct === 18, JSON.stringify(f.coverage));
  const r = await quiet(() => SUM.sendOwnerSummary(env));
  const t = String(summaryMsgs()[0]?.text?.body ?? "");
  const lines = t.split("\n");
  // § 60 — after it the four lines of «خلاصة اليوم» (this world's price day carries a sale price alone — no board, no cost — and its order no delivery time)
  assert("the text: a fourth line «تغطية تكاليف اليوم: 18% (ربح 91.31 من 500.00)»", r.action === "session" && lines.length === 10 && lines[4] === "تغطية تكاليف اليوم: 18% (ربح 91.31 من 500.00)", t);
  assert("…and § 60's four lines after it: one item published with no profit computed, no real sale of the day, no carton to split, no opportunity", lines.slice(5, 9).join(" | ") === "✅ نُشر اليوم 1 من 1 صنف — متوسط ربح الكرتون غير محسوب | 🎯 اليوم: لا مبيعات حقيقية بعد | 💧 لا صنف يُنشر اليوم بسعر وشراء | ➡️ لا فرصة ظاهرة اليوم", t);
  assert("…the three lines before it as they were", lines[3].startsWith("تحصيل اليوم:") && lines[2].startsWith("توصيلات اليوم: 1 مسلَّمة من 1"), t);
  // § 61 — and the data check's one line last: this world's two operating members carry no schedule (no job, so no vacancy line)
  assert("…and § 61's data check last: the two operating members without a schedule, by name", lines[9] === "🧾 فحص البيانات: بدور تشغيلي بلا جدول دوام: أحمد، سالم", lines[9]);
}
{
  const env = summaryEnv();
  closeOwnerWindow(env);
  const r = await quiet(() => SUM.sendOwnerSummary(env));
  const m = summaryMsgs()[0];
  const p = (m?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((x: any) => x.text) ?? [];
  assert("outside his window: utak_v2_summary with its three variables as they are", r.action === "template" && p.length === 3, JSON.stringify(p));
  assert("…the coverage at the end of {{3}}, on the same line (its «ريال» follows)",
    p[2] === "المحصَّل اليوم 0.00 والمعلَّق 588.01 · تغطية التكاليف 18% بربح 91.31 من 500.00" && !/[\n\t]/.test(p[2]), p[2]);
  const own = SUM.summaryParams(await quiet(() => SUM.readSummaryFigures(env)));
  assert("…one line at the source too (not left to the gateway's cleanup)", own.every((x) => !/[\n\t]/.test(x)) && own[2].endsWith("· تغطية التكاليف 18% بربح 91.31 من 500.00"), JSON.stringify(own));
}

{
  const env = summaryEnv();
  cost("صيانة", "monthly", 2600, "2026-01-01");               // Saturday: 100 of it today (Friday, yesterday: 0)
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("today's cost (Saturday 10-03: 500 + 2600 ÷ 26 = 600), not yesterday's (Friday: 500) → 15%", f.coverage.cost === 600 && f.coverage.pct === 15, JSON.stringify(f.coverage));
}

{
  const env = summaryEnv();
  const o = delivered([[1, 11, 2, 30]]);
  seed("x_daily_order_line", { x_order_id: o, x_product_tmpl_id: 2, x_packaging_id: 21, x_quantity: 3, x_unit_price: false, x_status: "unavailable" });
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("a line short at delivery («unavailable») is not in the profit: 22 × (30 ÷ 1.15 − 21) − 11.99 ÷ 1.15 = 101.49", f.coverage.profit === 101.49, JSON.stringify(f.coverage));
}

console.log("\n[هـ] a figure that cannot be read: «تعذّر», never a guess");
{
  const env = summaryEnv();
  const o = delivered([[1, 11, 2, 30]]);
  seed("x_daily_order_line", { x_order_id: o, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 3, x_unit_price: false, x_status: "delivered" });
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("a delivered line without a sale price → profit «تعذّر»", f.coverage.profit === null && f.coverage.pct === null, JSON.stringify(f.coverage));
}
{
  const env = summaryEnv();
  delivered([[2, 21, 3, 40]]);                                // cucumber: no purchase price yesterday
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("a delivered line without its day's purchase price → profit and coverage «تعذّر»", f.coverage.profit === null && f.coverage.pct === null && f.coverage.cost === 500, JSON.stringify(f.coverage));
  assert("…«تغطية تكاليف اليوم: تعذّر (ربح تعذّر من 500.00)»", SUM.coverageLine(f.coverage) === "تغطية تكاليف اليوم: تعذّر (ربح تعذّر من 500.00)", SUM.coverageLine(f.coverage));
}
{
  const env = summaryEnv();
  cost("صيانة", "monthly", 2600, "2026-01-01");
  table("hr.employee").get(OMAR_EMP)!.resource_calendar_id = false;
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("the day's cost unreadable (a monthly line, no driver schedule) → «تعذّر (ربح 91.31 من تعذّر)»",
    f.coverage.cost === null && f.coverage.pct === null && SUM.coverageLine(f.coverage) === "تغطية تكاليف اليوم: تعذّر (ربح 91.31 من تعذّر)", JSON.stringify(f.coverage));
}
{
  const env = summaryEnv();
  rows("x_operating_cost").forEach((r: any) => { r.x_date_from = "2026-12-01"; });
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("no cost line in force today (0): the coverage «تعذّر», the figures shown", f.coverage.cost === 0 && f.coverage.pct === null && SUM.coverageLine(f.coverage) === "تغطية تكاليف اليوم: تعذّر (ربح 91.31 من 0.00)", JSON.stringify(f.coverage));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
