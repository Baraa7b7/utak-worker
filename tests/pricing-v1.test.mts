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
import { employee, quiet, reset, seed, setRiyadh, table, workSchedule } from "./wa-harness.mts";

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
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
