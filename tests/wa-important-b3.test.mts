// WA-SCENARIOS — important gaps, batch 3 (م12، م8، م17), 2026-09-26 (STATUS § 38).
//
//   م12  the driver's end of shift, from his own working schedule: end − 30 min
//        his stops still without «تم التسليم» (one message, one line), end + 30
//        min one alert to Baraa with the order numbers; nothing when no stop is
//        left; no reminder and one alert with the reason for a driver without a
//        schedule, absent, or off today; a KV claim before every send;
//   م8   «في الطريق» (utak_out_for_delivery, [order, «السائق الاسم»]): the first
//        stop when the route goes out (or at the flush after «بدء الدوام»), each
//        next stop at «تم التسليم» on the one before it, in route order; «مشكلة»
//        stops the sequence, «تم التسليم» on it resumes; cancelled / delivered
//        skipped; nothing for a simulation order; the opted-out customer still
//        gets it; one message per order (KV claim + the x_wa_message record);
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind a strict schema
// gate built from the real field lists (fields_get on the tenant, the last one
// tests/fixtures-odoo-fields-20260926-b3.json, read after x_utak_simulation was
// added to x_daily_order / x_invoice / x_payment): an unknown field, or a
// selection value the field does not have, is answered the way Odoo answers it
// (HTTP 500). No network, no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-important-b3.test.mts

import { readFileSync } from "node:fs";
import {
  closeOwnerWindow, ctx, employee, graph, heldFor, openWindow, ownerAlerts, quiet, reset, seed, sentTo, setRiyadh, table, workSchedule,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const FIX = [
  "fixtures-odoo-fields-20260924.json",            // x_invoice, x_payment, x_daily_order, res.partner
  "fixtures-odoo-fields-20260925-review.json",     // res.partner review fields, x_daily_order_line …
  "fixtures-odoo-fields-20260925-team.json",       // hr.employee, resource.calendar*, x_team_attendance, x_employee_role
  "fixtures-odoo-fields-20260925-attendance.json", // x_delivery_route, x_delivery_stop, discuss.channel …
  "fixtures-odoo-fields-20260925-gateway.json",    // x_wa_message.x_status held / expired / skipped
  "fixtures-odoo-fields-20260925-s36.json",        // x_wa_message echo fields, template text
  "fixtures-odoo-fields-20260925-prices.json",     // x_price_day*, x_daily_price
  "fixtures-odoo-fields-20260926-b3.json",         // § 38: x_utak_simulation on the order / invoice / payment
].map((f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")));
const REAL: Record<string, string[]> = Object.assign({}, ...FIX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FIX.map((f) => f._selections ?? {}));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  // res.partner / product.template: the fixtures keep the custom fields and a few base ones.
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body) {
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
const drv = await import("../src/driver-followup.ts");
const ofd = await import("../src/out-for-delivery.ts");
const { dispatch } = await import("../src/router.ts");
const { sendDriverRoute } = await import("../src/team.ts");
const { flushTeamQueue } = await import("../src/team-queue.ts");
const { CRON_JOB } = await import("../src/auto-send-guard.ts");
const worker = (await import("../src/index.ts")).default;

// ---------------------------------------------------------------- data
const DRV = 603, DRV_PHONE = "966500000603";
const CUST3 = 503, CUST3_PHONE = "966500000503";
const CUST = 501, CUST2 = 502;
// Omar's schedule on the tenant: Saturday–Thursday 02:00–12:00 (Odoo: Monday 0 … Sunday 6; Friday 4 has no line).
const OMAR_DAYS: Array<[number, number, number]> = [[5, 2, 12], [6, 2, 12], [0, 2, 12], [1, 2, 12], [2, 2, 12], [3, 2, 12]];
const SAT = "2026-09-26", FRI = "2026-09-25", NEXT_FRI = "2026-10-02";
const texts = (digits: string) => sentTo(digits).filter((b) => b?.type === "text").map((b) => String(b.text?.body ?? ""));
const alerts = () => ownerAlerts().map((s) => JSON.parse(s)).map((b) => String(b?.text?.body ?? ""));

interface Fresh { env: any; emp: number; route: number; orders: number[]; stops: number[] }
/**
 * reset() + a driver (Work Contact DRV, «سائق», on attendance) with `schedule`,
 * today's attendance row (present unless given), a route dispatched last night
 * with three stops (in route order: مطعم الوادي، بقالة النخيل، مخبز السنبلة).
 */
function fresh(riyadh: string, o: { schedule?: Array<[number, number, number]> | null; attendance?: boolean; status?: string | null; day?: string } = {}): Fresh {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  seed("res.partner", { id: DRV, name: "عمر المجهلي", x_whatsapp_number: "+" + DRV_PHONE });
  seed("res.partner", { id: CUST3, name: "مخبز السنبلة", x_whatsapp_number: "+" + CUST3_PHONE, customer_rank: 1 });
  const cal = o.schedule === null ? false : workSchedule(o.schedule ?? OMAR_DAYS);
  const emp = employee(DRV, [72], { x_utak_attendance: o.attendance ?? true, resource_calendar_id: cal });
  const day = o.day ?? SAT;
  if (o.status !== null) {
    seed("x_team_attendance", { x_employee_id: emp, x_date: day, x_status: o.status ?? "present", x_sent_at: `${day} 00:00:00`, x_tapped_at: o.status === "absent" ? false : `${day} 00:01:00`, x_reminder_sent: false });
  }
  const route = seed("x_delivery_route", { x_driver_id: DRV, x_date: FRI, x_status: "dispatched", x_dispatched_at: `${FRI} 19:30:00`, x_total_stops: 3, x_stops_completed: 0 });
  const orders: number[] = [], stops: number[] = [];
  [CUST, CUST2, CUST3].forEach((c, i) => {
    const id = seed("x_daily_order", { x_customer_id: c, x_state: "in_delivery", x_order_date: FRI, x_created_via: "whatsapp", x_total_amount: 0 });
    orders.push(id);
    stops.push(seed("x_delivery_stop", { x_route_id: route, x_order_id: id, x_sequence: (i + 1) * 10, x_status: "pending" }));
  });
  openWindow(env, DRV_PHONE, 60); // the driver tapped «بدء الدوام» today
  return { env, emp, route, orders, stops };
}
const deliver = (f: Fresh, i: number) => {
  table("x_delivery_stop").get(f.stops[i])!.x_status = "delivered";
  table("x_daily_order").get(f.orders[i])!.x_state = "delivered";
};
async function tick(f: Fresh, riyadh: string) {
  setRiyadh(riyadh);
  return quiet(() => drv.runDriverFollowupTick(f.env));
}

// ================================================================ م12
console.log("\n[م12] end − 30 min: the driver's stops without «تم التسليم», once");
{
  const f = fresh(`${SAT} 11:25`);
  await tick(f, `${SAT} 11:25`);
  assert("before end − 30 (11:25): nothing", graph.length === 0, JSON.stringify(graph));
  await tick(f, `${SAT} 11:32`);
  const t = texts(DRV_PHONE);
  assert("new: 11:32 (Omar ends 12:00) → one message to the driver", t.length === 1, JSON.stringify(t));
  assert("it counts the stops left (3)", /3 محطات بلا «تم التسليم»/.test(t[0] ?? ""), t[0]);
  assert("one line: two names then «و 1 أخرى»", (t[0] ?? "").includes("مطعم الوادي، بقالة النخيل و 1 أخرى") && !(t[0] ?? "").includes("\n"), t[0]);
  assert("says the end of his shift (12:00)", (t[0] ?? "").includes("(12:00)"), t[0]);
  assert("nothing to Baraa at end − 30", alerts().length === 0, JSON.stringify(alerts()));
  await tick(f, `${SAT} 11:37`);
  deliver(f, 0);
  await tick(f, `${SAT} 11:57`);
  assert("once a day: later ticks before the end send nothing more (even when the stops change)", texts(DRV_PHONE).length === 1);
  assert("the claim is in KV", f.env.MSG_DEDUP.store.has(`btnlock:v1:drvf:${SAT}:e${f.emp}:remind`));
}
{
  const f = fresh(`${SAT} 11:32`);
  deliver(f, 0);
  await tick(f, `${SAT} 11:32`);
  const t = texts(DRV_PHONE)[0] ?? "";
  assert("a delivered stop is not counted: «محطتان»، two names", t.includes("محطتان بلا «تم التسليم»: بقالة النخيل ومخبز السنبلة"), t);
}
{
  const f = fresh(`${SAT} 11:32`);
  table("x_delivery_stop").get(f.stops[0])!.x_status = "delivered"; // «تم التسليم» on the stop, the order's write lost
  await tick(f, `${SAT} 11:32`);
  const t = texts(DRV_PHONE)[0] ?? "";
  assert("a stop marked delivered is not counted even if its order still reads in_delivery", t.includes("محطتان"), t);
}
{
  const f = fresh(`${SAT} 11:32`);
  closeOwnerWindow(f.env);
  f.env.MSG_DEDUP.store.delete(`wa_win:v1:${DRV_PHONE}`);
  await tick(f, `${SAT} 11:32`);
  const h = heldFor(f.env, DRV_PHONE);
  assert("driver's window closed: the reminder is held, valid only until the end of the shift (12:00)",
    h.length === 1 && h[0].purpose === "driver_stops_left" && h[0].expiresAt === Date.parse(`${SAT}T12:00:00+03:00`), JSON.stringify(h));
}

console.log("\n[م12] end + 30 min: one alert to Baraa with the order numbers and the driver");
{
  const f = fresh(`${SAT} 12:25`);
  deliver(f, 0);
  table("x_delivery_stop").get(f.stops[1])!.x_status = "issue";
  await tick(f, `${SAT} 12:25`);
  assert("before end + 30 (12:25): no alert", alerts().length === 0);
  await tick(f, `${SAT} 12:32`);
  const a = alerts();
  assert("new: 12:32 → one alert to Baraa", a.length === 1, JSON.stringify(a));
  assert("names the driver and the end of his shift", (a[0] ?? "").includes("عمر المجهلي") && (a[0] ?? "").includes("12:00"), a[0]);
  assert("lists the undelivered orders, «مشكلة» marked", (a[0] ?? "").includes(`#${f.orders[1]} (مشكلة)، #${f.orders[2]}`) && !(a[0] ?? "").includes(`#${f.orders[0]}`), a[0]);
  assert("nothing to the driver after his shift", texts(DRV_PHONE).length === 0);
  await tick(f, `${SAT} 12:37`);
  deliver(f, 2);
  await tick(f, `${SAT} 15:02`);
  assert("once a day: no second alert (even when the stops left change)", alerts().length === 1, JSON.stringify(alerts()));
}
{
  const f = fresh(`${SAT} 11:32`);
  [0, 1, 2].forEach((i) => deliver(f, i));
  for (const t of ["11:32", "11:52", "12:32", "12:57", "18:02"]) await tick(f, `${SAT} ${t}`);
  assert("no stop left = no message at all (driver or Baraa)", graph.length === 0, JSON.stringify(graph.map((g) => g?.text?.body)));
}
{
  const f = fresh(`${SAT} 12:32`);
  table("x_daily_order").get(f.orders[0])!.x_state = "cancelled";
  table("x_daily_order").get(f.orders[1])!.x_utak_simulation = true;
  // a stale route (09-11, as on the tenant) with a pending stop: older than 72 h
  const old = seed("x_delivery_route", { x_driver_id: DRV, x_date: "2026-09-11", x_status: "dispatched", x_dispatched_at: "2026-09-11 18:41:44" });
  const oo = seed("x_daily_order", { x_customer_id: CUST, x_state: "in_delivery", x_order_date: "2026-09-11" });
  seed("x_delivery_stop", { x_route_id: old, x_order_id: oo, x_sequence: 10, x_status: "pending" });
  await tick(f, `${SAT} 12:32`);
  const a = alerts()[0] ?? "";
  assert("cancelled, simulation (x_utak_simulation) and >72 h-old stops are left out", a.includes(`طلب واحد بلا «تم التسليم»: #${f.orders[2]}.`) && !a.includes(`#${oo}`), a);
}
{
  const f = fresh(`${SAT} 11:32`);
  [0, 1].forEach((i) => deliver(f, i));
  table("x_daily_order").get(f.orders[2])!.x_utak_simulation = true;
  for (const t of ["11:32", "12:32"]) await tick(f, `${SAT} ${t}`);
  assert("only simulation stops left = no message", graph.length === 0, JSON.stringify(graph.map((g) => g?.text?.body)));
}
{
  const f = fresh(`${SAT} 11:32`);
  f.env.MSG_DEDUP.store.set(`btnlock:v1:drvf:${SAT}:e${f.emp}:remind`, "run:earlier");
  f.env.MSG_DEDUP.store.set(`btnlock:v1:drvf:${SAT}:e${f.emp}:alert`, "run:earlier");
  for (const t of ["11:32", "12:32"]) await tick(f, `${SAT} ${t}`);
  assert("a claim taken before (a re-run after a restart) sends nothing", graph.length === 0);
}

console.log("\n[م12] the times come from the schedule, not fixed hours");
{
  const f = fresh(`${SAT} 11:32`, { schedule: [[5, 6, 16]] }); // 06:00–16:00 on Saturdays
  await tick(f, `${SAT} 11:32`);
  await tick(f, `${SAT} 12:32`);
  assert("a 06–16 schedule: nothing at 11:30 / 12:30", graph.length === 0);
  await tick(f, `${SAT} 15:32`);
  assert("its reminder at 15:30", texts(DRV_PHONE).length === 1 && texts(DRV_PHONE)[0].includes("(16:00)"), JSON.stringify(texts(DRV_PHONE)));
  await tick(f, `${SAT} 16:32`);
  assert("its alert at 16:30", alerts().length === 1 && alerts()[0].includes("16:00"), JSON.stringify(alerts()));
}
{
  const f = fresh(`${SAT} 11:59`);
  await tick(f, `${SAT} 11:59`);
  assert("a tick that missed 11:30 still reminds before the end (11:59)", texts(DRV_PHONE).length === 1);
  const g = fresh(`${SAT} 12:00`);
  await tick(g, `${SAT} 12:00`);
  assert("at the end of the shift the reminder is no longer sent", texts(DRV_PHONE).length === 0);
}

console.log("\n[م12] no reminder — one alert with the reason — for a driver without a schedule, absent, or off");
{
  const f = fresh(`${SAT} 11:32`, { schedule: null, status: null });
  for (const t of ["11:32", "12:32", "17:57"]) await tick(f, `${SAT} ${t}`);
  assert("no schedule: nothing before 18:00", graph.length === 0, JSON.stringify(graph.map((g) => g?.text?.body)));
  await tick(f, `${SAT} 18:02`);
  const a = alerts();
  assert("no schedule: one alert at 18:00 with the reason and the orders", a.length === 1 && a[0].includes("بلا جدول دوام في Odoo") && a[0].includes(`#${f.orders[0]}`), JSON.stringify(a));
  assert("no schedule: no reminder to the driver", texts(DRV_PHONE).length === 0);
  deliver(f, 0); // the list changes: another text, so only the claim can stop a second alert
  await tick(f, `${SAT} 18:07`);
  await tick(f, `${SAT} 21:02`);
  assert("no schedule: once (even when the stops left change)", alerts().length === 1, JSON.stringify(alerts()));
}
{
  const f = fresh(`${SAT} 18:02`, { attendance: false, status: null });
  await tick(f, `${SAT} 18:02`);
  assert("not on attendance: the reason says so", (alerts()[0] ?? "").includes("غير مشمول بالتحضير"), JSON.stringify(alerts()));
}
{
  const f = fresh(`${SAT} 11:32`, { status: "absent" });
  await tick(f, `${SAT} 11:32`);
  const a = alerts();
  assert("absent: no reminder to the driver", texts(DRV_PHONE).length === 0);
  assert("absent: one alert at end − 30 with «سُجّل غائباً اليوم» and the orders", a.length === 1 && a[0].includes("سُجّل غائباً اليوم") && a[0].includes("عمر المجهلي"), JSON.stringify(a));
  deliver(f, 0);
  await tick(f, `${SAT} 12:32`);
  assert("absent: no second alert at end + 30 (the same claim)", alerts().length === 1, JSON.stringify(alerts()));
}
{
  const f = fresh(`${NEXT_FRI} 11:32`, { day: NEXT_FRI });
  // his route of Thursday night, held over his day off
  table("x_delivery_route").get(f.route)!.x_dispatched_at = "2026-10-01 19:30:00";
  for (const t of ["11:32", "12:32"]) await tick(f, `${NEXT_FRI} ${t}`);
  assert("day off (Friday): no reminder, no end-of-shift alert", graph.length === 0);
  await tick(f, `${NEXT_FRI} 18:02`);
  assert("day off: one alert at 18:00 naming it", alerts().length === 1 && alerts()[0].includes("يوم راحته"), JSON.stringify(alerts()));
}
{
  const f = fresh(`${SAT} 18:02`, { schedule: null, status: null });
  [0, 1, 2].forEach((i) => deliver(f, i));
  await tick(f, `${SAT} 18:02`);
  assert("no schedule and no stop left: no alert", graph.length === 0);
}

console.log("\n[م12] wired: the sim cron, Riyadh time, sim only");
{
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const simBlock = toml.split("[env.sim.triggers]")[1].split("[env.sim.vars]")[0];
  assert("the cron is in [env.sim.triggers]", simBlock.includes(`"${drv.DRIVER_FOLLOWUP_CRON}"`));
  assert("prod crons stay []", /^\[triggers\]\s*\ncrons = \[\]/m.test(toml));
  assert("CRON_JOB names it driver_followup", CRON_JOB[drv.DRIVER_FOLLOWUP_CRON] === "driver_followup");
  const f = fresh(`${SAT} 11:32`);
  await quiet(() => worker.scheduled({ cron: drv.DRIVER_FOLLOWUP_CRON } as any, f.env, ctx));
  assert("scheduled() on that cron runs the follow-up", texts(DRV_PHONE).length === 1, JSON.stringify(graph.map((g) => g?.text?.body)));
  const g = fresh(`${SAT} 08:32`);
  setRiyadh(`${SAT} 08:32`);
  await quiet(() => worker.scheduled({ cron: drv.DRIVER_FOLLOWUP_CRON } as any, g.env, ctx));
  assert("08:32 Riyadh (05:32 UTC) is not the reminder time", graph.length === 0);
}

// ================================================================ م8
const CUST_PHONE = "966500000501", CUST2_PHONE = "966500000502";
const PHONES = [CUST_PHONE, CUST2_PHONE, CUST3_PHONE];
/** fresh() + the utak_out_for_delivery row (APPROVED / UTILITY, as at Meta). */
function freshOfd(riyadh = `${SAT} 06:10`, o: Parameters<typeof fresh>[1] = {}): Fresh {
  const f = fresh(riyadh, o);
  seed("x_whatsapp_template", { x_purpose: "customer_delivery_incoming", x_meta_template_id: "utak_out_for_delivery", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  return f;
}
const ofdTo = (digits: string) => sentTo(digits).filter((b) => b?.template?.name === "utak_out_for_delivery" || (b?.type === "text" && String(b.text?.body).includes("في الطريق إليك")));
const ofdCounts = () => PHONES.map((p) => ofdTo(p).length).join("");
const tplParams = (b: any): string[] => (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
const driverPartner = { id: DRV, name: "عمر المجهلي", x_whatsapp_number: "+" + DRV_PHONE };
const tap = (f: Fresh, id: string) => quiet(() => dispatch(f.env, { msg: { buttonId: id, type: "interactive", from: DRV_PHONE } as any, intent: "other", senderType: "customer", partner: driverPartner as any }));

console.log("\n[م8] the first stop when the route goes out; each next one at «تم التسليم» on the stop before it");
{
  const f = freshOfd();
  const r = await quiet(() => ofd.notifyRouteStart(f.env, f.route, "عمر المجهلي"));
  const b = ofdTo(CUST_PHONE);
  assert("new: the route's first stop gets «في الطريق», the others nothing", ofdCounts() === "100" && r.action === "sent", `${ofdCounts()} ${JSON.stringify(r)}`);
  assert("outside the window: utak_out_for_delivery", b[0]?.template?.name === "utak_out_for_delivery", JSON.stringify(b[0]));
  assert("its two variables: the order number, «السائق عمر المجهلي» (one line each)", tplParams(b[0]).join("|") === `${f.orders[0]}|السائق عمر المجهلي`, JSON.stringify(tplParams(b[0])));
  await tap(f, `delivered_${f.orders[0]}`);
  assert("«تم التسليم» on stop 1 → stop 2's customer, only", ofdCounts() === "110", ofdCounts());
  await tap(f, `delivered_${f.orders[0]}`);
  assert("a second tap on the same stop: nothing again", ofdCounts() === "110", ofdCounts());
  await tap(f, `delivered_${f.orders[1]}`);
  assert("«تم التسليم» on stop 2 → stop 3's customer", ofdCounts() === "111", ofdCounts());
  await tap(f, `delivered_${f.orders[2]}`);
  assert("the last stop: no one after it", ofdCounts() === "111", ofdCounts());
}
{
  const f = freshOfd();
  openWindow(f.env, CUST_PHONE, 30);
  await quiet(() => ofd.notifyRouteStart(f.env, f.route, "عمر المجهلي"));
  const b = ofdTo(CUST_PHONE)[0];
  assert("inside the customer's window: the text, not the template", b?.type === "text" && String(b.text.body).includes(`#${f.orders[0]}`) && String(b.text.body).includes("السائق عمر المجهلي"), JSON.stringify(b));
  assert("…one line", !String(b?.text?.body ?? "").includes("\n"));
}

console.log("\n[م8] «مشكلة» stops the sequence, «تم التسليم» on that stop resumes it");
{
  const f = freshOfd();
  await quiet(() => ofd.notifyRouteStart(f.env, f.route, "عمر المجهلي"));
  await tap(f, `delivered_${f.orders[0]}`);
  await tap(f, `delivery_issue_${f.orders[1]}`);
  assert("«مشكلة» on stop 2: nothing to stop 3", ofdCounts() === "110", ofdCounts());
  await tap(f, `delivered_${f.orders[1]}`);
  assert("then «تم التسليم» on stop 2: stop 3 gets it", ofdCounts() === "111", ofdCounts());
}
{
  const f = freshOfd();
  table("x_delivery_stop").get(f.stops[1])!.x_status = "issue"; // «مشكلة» tapped on stop 2 first
  await tap(f, `delivered_${f.orders[0]}`);
  assert("the next stop already «مشكلة»: the sequence waits there (no one notified)", ofdCounts() === "000", ofdCounts());
  const r = await quiet(() => ofd.notifyNextAfterDelivered(f.env, f.orders[0]));
  assert("…and says so", r.action === "issue_waits" && r.orderId === f.orders[1], JSON.stringify(r));
}

console.log("\n[م8] skipped: cancelled or delivered already; nothing for a simulation order");
{
  const f = freshOfd();
  table("x_daily_order").get(f.orders[1])!.x_state = "cancelled";
  await tap(f, `delivered_${f.orders[0]}`);
  assert("stop 2 cancelled: skipped, stop 3 gets it", ofdCounts() === "001", ofdCounts());
}
{
  const f = freshOfd();
  table("x_delivery_stop").get(f.stops[1])!.x_status = "delivered"; // delivered already (its order's write lost)
  await tap(f, `delivered_${f.orders[0]}`);
  assert("stop 2 delivered already: skipped, stop 3 gets it", ofdCounts() === "001", ofdCounts());
}
{
  const f = freshOfd();
  deliver(f, 0);
  const r = await quiet(() => ofd.notifyRouteStart(f.env, f.route, "عمر المجهلي"));
  assert("the route's first stop delivered already: the second gets it", ofdCounts() === "010" && r.skipped.join() === String(f.orders[0]), `${ofdCounts()} ${JSON.stringify(r)}`);
}
{
  const f = freshOfd();
  table("x_daily_order").get(f.orders[1])!.x_utak_simulation = true;
  await tap(f, `delivered_${f.orders[0]}`);
  assert("a simulation order (x_utak_simulation) gets nothing, and the one after it waits", ofdCounts() === "000", ofdCounts());
  await tap(f, `delivered_${f.orders[1]}`);
  assert("its «تم التسليم» moves on to stop 3", ofdCounts() === "001", ofdCounts());
  const g = freshOfd();
  table("x_daily_order").get(g.orders[0])!.x_utak_simulation = true;
  await quiet(() => ofd.notifyRouteStart(g.env, g.route, "عمر المجهلي"));
  assert("a simulation first stop: nothing at the route's start", ofdCounts() === "000" && graph.filter((x) => x?.template?.name === "utak_out_for_delivery").length === 0);
}
{
  const f = freshOfd();
  table("res.partner").get(CUST)!.x_wa_marketing_optout = true;
  await quiet(() => ofd.notifyRouteStart(f.env, f.route, "عمر المجهلي"));
  assert("a customer who stopped marketing messages still gets it (UTILITY)", ofdTo(CUST_PHONE).length === 1 && ofdTo(CUST_PHONE)[0].template?.name === "utak_out_for_delivery", JSON.stringify(sentTo(CUST_PHONE)));
}

console.log("\n[م8] one message per order: the KV claim, then the record");
{
  const f = freshOfd();
  f.env.MSG_DEDUP.store.set(`btnlock:v1:ofd:${f.orders[0]}`, "run:earlier");
  const r = await quiet(() => ofd.notifyRouteStart(f.env, f.route, "عمر المجهلي"));
  assert("claimed before (a re-run): nothing sent", ofdCounts() === "000" && r.action === "claimed", `${ofdCounts()} ${JSON.stringify(r)}`);
}
{
  const f = freshOfd();
  await quiet(() => ofd.notifyRouteStart(f.env, f.route, "عمر المجهلي"));
  const row = [...table("x_wa_message").values()].find((w) => String(w.x_debug_payload ?? "").includes("customer_delivery_incoming"));
  assert("the send is on record (x_wa_message, its purpose, the order number)", !!row && String(row.x_body).includes(String(f.orders[0])), JSON.stringify(row));
  f.env.MSG_DEDUP.store.delete(`btnlock:v1:ofd:${f.orders[0]}`); // the KV key lost
  const r = await quiet(() => ofd.notifyRouteStart(f.env, f.route, "عمر المجهلي"));
  assert("KV key lost: the record stops a second one", ofdCounts() === "100" && r.action === "already", `${ofdCounts()} ${JSON.stringify(r)}`);
}

console.log("\n[م8] wired to the route: sent now, or at the flush after «بدء الدوام»");
const routeStopsArg = (f: Fresh) => f.orders.map((id, i) => ({ order_id: id, customer_id: [CUST, CUST2, CUST3][i], customer_name: ["مطعم الوادي", "بقالة النخيل", "مخبز السنبلة"][i], customer_phone: "", neighborhood: "", sequence: (i + 1) * 10, line_summary: "طماطم كرتون × 3" }));
const drvMember = { id: DRV, name: "عمر المجهلي", x_whatsapp_number: "+" + DRV_PHONE, x_role: "driver", x_role_codes: ["driver"] } as any;
{
  const f = freshOfd(`${SAT} 06:10`); // tapped «بدء الدوام» at 03:01
  await quiet(() => sendDriverRoute(f.env, drvMember, routeStopsArg(f) as any, f.route));
  assert("route sent now (tapped today): the first stop's customer at once", ofdCounts() === "100", ofdCounts());
}
{
  const f = freshOfd(`${SAT} 02:10`, { status: "absent" });
  const att = table("x_team_attendance");
  for (const r of att.values()) Object.assign(r, { x_status: false, x_tapped_at: false }); // sent at 02:00, not tapped yet
  await quiet(() => sendDriverRoute(f.env, drvMember, routeStopsArg(f) as any, f.route));
  const q = JSON.parse(f.env.MSG_DEDUP.store.get(`pending_loc:+${DRV_PHONE}`) ?? "[]");
  assert("route held until «بدء الدوام»: no «في الطريق» yet", ofdCounts() === "000", ofdCounts());
  assert("…its marker closes the queued route", q.length > 0 && q[q.length - 1].route_start === f.route, JSON.stringify(q.slice(-1)));
  await quiet(() => flushTeamQueue(f.env, `+${DRV_PHONE}`));
  assert("the flush after the tap: the first stop's customer gets it", ofdCounts() === "100", ofdCounts());
}

// ================================================================ schema gate
console.log("\n[gate] every Odoo call used real fields and selection values");
assert("no field / value the tenant does not have", rejected.length === 0, rejected.slice(0, 5).join(" | "));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("failures:\n  " + failures.join("\n  "));
  process.exit(1);
}
