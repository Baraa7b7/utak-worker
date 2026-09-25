// Team attendance «بدء الدوام» + the late re-delivered inbound (2026-09-25, STATUS § 29).
//
//   • the template goes out at each member's shift time, never before, never
//     to a member without a time (00:00) or without a team role;
//   • no task reaches a member before today's tap (route, collection request,
//     purchase list, a text from them); after the tap they all arrive;
//   • +30: ONE reminder (same template) and one owner alert; +60: «غائب» and
//     one owner alert; a tap after +15 is «متأخر», after +60 «متأخر» + alert;
//   • Baraa: the same template daily through the owner guard's owner_window
//     purpose, at the roster's earliest shift − 15 min (STATUS § 30; with no
//     shift time, OWNER_WINDOW_OPEN_AT), never attendance/absence/alerts about him;
//   • re-running the job (same KV, wiped KV, two ticks at once) repeats nothing;
//   • (ب) a message Meta re-delivers after its 24h window gets no bot action.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind a strict schema
// gate built from the tenant's real field lists (fields_get:
// tests/fixtures-odoo-fields-20260924.json, …-20260925-suppliers.json and
// …-20260925-attendance.json, the last one taken after x_team_attendance and
// res.partner.x_shift_start were created): an unknown field, or a selection
// value the field does not have, is answered the way Odoo answers it (HTTP 500).
// No network, no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/attendance.test.mts

import { readFileSync } from "node:fs";
import { ctx, employee, graph, inbound, odooLog, OWNER, quiet, reset, rows, seed, sentTo, setRiyadh, signed, table, workSchedule } from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const F1 = load("./fixtures-odoo-fields-20260924.json");
const F2 = load("./fixtures-odoo-fields-20260925-suppliers.json");
const F3 = load("./fixtures-odoo-fields-20260925-attendance.json");
// 2026-09-25 (STATUS § 30) — the review fields on res.partner (x_contact_class …).
const F4 = load("./fixtures-odoo-fields-20260925-review.json");
// 2026-09-25 (STATUS § 31) — hr.employee, resource.calendar.*, x_team_attendance.x_employee_id
const F5 = load("./fixtures-odoo-fields-20260925-team.json");
const REAL: Record<string, string[]> = { ...F1, ...F2, ...F3, ...F4, ...F5 };
const SELECTIONS: Record<string, string[]> = { ...F1._selections, ...F2._selections, ...F3._selections, ...F4._selections, ...F5._selections };
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
let claudeCalls = 0;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    claudeCalls++;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ prices: [], unrecognized: [] }) }] }), { status: 200 });
  }
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
const att = await import("../src/attendance.ts");
const team = await import("../src/team.ts");
const invoice = await import("../src/invoice.ts");
const worker = (await import("../src/index.ts")).default;

// ---------------------------------------------------------------- data
const DAY = "2026-09-26";
// 2026-09-25 (STATUS § 31) — each is an hr.employee on the partner (its Work
// Contact), «مشمول بالتحضير» on, with a working schedule every day of the week.
const OMAR = 801, OMAR_PHONE = "966500000801";    // warehouse + driver + collector, 05:00–13:00
const NOTIME = 802, NOTIME_PHONE = "966500000802"; // driver, on attendance but no working schedule
const KHALID = 803, KHALID_PHONE = "966500000803"; // collector, 07:30–15:30
const NOROLE = 804, NOROLE_PHONE = "966500000804"; // a schedule (06:00) but no UTAK role → not on the roster
const EMP = (pid: number) => 7000 + pid;           // the employee of a partner (wa-harness employee())
const everyDay = (from: number, to: number) => workSchedule([0, 1, 2, 3, 4, 5, 6].map((d) => [d, from, to] as [number, number, number]));
const SUP = 805, SUP_PHONE = "966500000805";       // a supplier (ب)
const OWNER_PID = 806;
const SHIFT_TPL = "utak_shift_start_v2";

function fresh(riyadh = `${DAY} 04:00`, extra: Record<string, unknown> = {}): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  claudeCalls = 0; rejected.length = 0;
  Object.assign(env, extra);
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  seed("res.partner", { id: OMAR, name: "عمر المجهلي", x_whatsapp_number: "+" + OMAR_PHONE });
  seed("res.partner", { id: NOTIME, name: "سالم السواق", x_whatsapp_number: "+" + NOTIME_PHONE });
  seed("res.partner", { id: KHALID, name: "خالد", x_whatsapp_number: "+" + KHALID_PHONE });
  seed("res.partner", { id: NOROLE, name: "بلا دور", x_whatsapp_number: "+" + NOROLE_PHONE });
  seed("res.partner", { id: SUP, name: "مورد", supplier_rank: 1, x_whatsapp_number: "+" + SUP_PHONE, x_supplied_product_ids: [1] });
  // Baraa himself, WITH a role and a schedule: the roster must still leave him out.
  seed("res.partner", { id: OWNER_PID, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER });
  employee(OMAR, [71, 72, 73], { x_utak_attendance: true, resource_calendar_id: everyDay(5, 13) });
  employee(NOTIME, [72], { x_utak_attendance: true, resource_calendar_id: false });
  employee(KHALID, [73], { x_utak_attendance: true, resource_calendar_id: everyDay(7.5, 15.5) });
  employee(NOROLE, [], { x_utak_attendance: true, resource_calendar_id: everyDay(6, 14) });
  employee(OWNER_PID, [71], { x_utak_attendance: true, resource_calendar_id: everyDay(5, 13) });
  seed("res.partner", { name: "UTAK بوت" });
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: SHIFT_TPL, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "driver_dispatch", x_meta_template_id: "utak_driver_dispatch", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 4, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "driver_stop", x_meta_template_id: "utak_driver_stop", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 5, x_category: "UTILITY" });
  return env;
}
let ENV: any;
const tick = async (at: string) => { setRiyadh(at); return quiet(() => att.runAttendanceTick(ENV)); };
const tpl = (digits: string, name = SHIFT_TPL) => sentTo(digits).filter((b) => b?.template?.name === name);
const params = (b: any): string[] => (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
const payloads = (b: any): string[] => (b?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => c.parameters?.[0]?.payload);
const texts = (digits: string) => sentTo(digits).filter((b) => b?.type === "text").map((b) => String(b.text?.body ?? ""));
const ownerSays = (needle: string) => sentTo(OWNER).filter((b) => JSON.stringify(b).includes(needle));
const row = (pid: number) => rows("x_team_attendance").find((r) => r.x_employee_id === EMP(pid) && r.x_date === DAY) as any;
const tap = (digits: string, at: string, extra: Record<string, unknown> = {}) => {
  setRiyadh(at);
  return quiet(() => worker.fetch(signed(inbound(digits, { type: "button", button: { payload: "shift_start", text: "بدء الدوام" }, ...extra })), ENV, ctx));
};
const say = (digits: string, at: string, text: string, extra: Record<string, unknown> = {}) => {
  setRiyadh(at);
  return quiet(() => worker.fetch(signed(inbound(digits, { type: "text", text: { body: text }, ...extra })), ENV, ctx));
};
const secondsAgo = (h: number) => String(Math.floor(Date.now() / 1000) - h * 3600);

// ================================================================ 1. the time
console.log("\n[1] «بدء الدوام» at the shift time — not before, not without a time or a role");
{
  ENV = fresh();
  await tick(`${DAY} 00:05`);
  await tick(`${DAY} 04:55`);
  assert("before 05:00: nothing to anyone", tpl(OMAR_PHONE).length === 0 && rows("x_team_attendance").length === 0, JSON.stringify(graph.map((g) => g?.to)));
  const r = await tick(`${DAY} 05:00`);
  const t = tpl(OMAR_PHONE);
  assert("05:00: utak_shift_start_v2 to عمر, once", t.length === 1, String(t.length));
  assert("[{{1}} = name], button 0 payload shift_start", params(t[0]).join("|") === "عمر المجهلي" && payloads(t[0]).join("|") === "shift_start", JSON.stringify(t[0]?.template));
  const rw = row(OMAR);
  assert("Odoo row: employee (and the old partner link), date, shift 05:00 (02:00 UTC), sent at, no tap, no status",
    rw && rw.x_employee_id === EMP(OMAR) && rw.x_partner_id === OMAR && rw.x_shift_at === "2026-09-26 02:00:00" && rw.x_sent_at === "2026-09-26 02:00:00" && !rw.x_tapped_at && !rw.x_status && rw.x_reminder_sent === false, JSON.stringify(rw));
  assert("no working schedule → nothing, reported «no_calendar»", tpl(NOTIME_PHONE).length === 0 && r.members.find((m: any) => m.partnerId === NOTIME)?.action === "no_calendar", JSON.stringify(r.members));
  assert("schedule but no UTAK role → not on the roster at all", tpl(NOROLE_PHONE).length === 0 && !r.members.some((m: any) => m.partnerId === NOROLE));
  assert("خالد (07:30) not yet", tpl(KHALID_PHONE).length === 0 && r.members.find((m: any) => m.partnerId === KHALID)?.action === "before_shift");
  await tick(`${DAY} 07:30`);
  assert("07:30: خالد gets his", tpl(KHALID_PHONE).length === 1);
  await tick(`${DAY} 23:55`);
  assert("the whole day: the no-time member never gets it", tpl(NOTIME_PHONE).length === 0);
  // a deploy/outage past +30 does not send a start that late
  ENV = fresh();
  const late = await tick(`${DAY} 05:35`);
  assert("first tick only at +35: no start (window missed), reported", tpl(OMAR_PHONE).length === 0 && late.members.find((m: any) => m.partnerId === OMAR)?.action === "start_window_missed", JSON.stringify(late.members.find((m: any) => m.partnerId === OMAR)));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 2. no tasks before the tap
console.log("\n[2] no task before the tap; all of them after it");
{
  ENV = fresh(`${DAY} 04:00`);
  // A purchase list waiting for «تم الشراء», and an unpaid invoice.
  seed("x_purchase_list", { id: 950, x_status: "sent", x_date: DAY, x_notes: false, x_aggregated_items: JSON.stringify([{ product_name: "طماطم", packaging_name: "كرتون", total_quantity: 3 }]) });
  const oid = seed("x_daily_order", { x_customer_id: 501, x_delivery_neighborhood: "العليا", x_state: "delivered", x_order_date: DAY });
  seed("x_invoice", { x_invoice_number: "INV-77", x_total: 120, x_order_id: oid, x_status: "issued", x_is_simulation: false });
  const omar = { id: OMAR, name: "عمر المجهلي", x_whatsapp_number: "+" + OMAR_PHONE, x_role: "driver", x_role_codes: ["warehouse", "driver", "collector"] } as any;
  // 04:30 — before his shift: a route, a collection request, the 06:00 list follow-up.
  setRiyadh(`${DAY} 04:30`);
  await quiet(() => team.sendDriverRoute(ENV, omar, [
    { order_id: 1, customer_name: "مطعم الوادي", neighborhood: "العليا", latitude: 24.7, longitude: 46.6, line_summary: "طماطم × 3" },
    { order_id: 2, customer_name: "بقالة النخيل", neighborhood: "", map_url: "https://maps.example/2", line_summary: "خيار × 1" },
  ] as any, 1));
  await quiet(() => team.followUpUnconfirmedPurchaseLists(ENV));
  assert("route before the tap: nothing to عمر (no template, no location, no text)", sentTo(OMAR_PHONE).length === 0, JSON.stringify(sentTo(OMAR_PHONE)).slice(0, 200));
  const q = JSON.parse(ENV.MSG_DEDUP.store.get(`pending_loc:+${OMAR_PHONE}`) ?? "[]");
  assert("…queued in order: list, location, stop 1 buttons, map link, stop 2 buttons", q.length === 5 && typeof q[1].latitude === "number" && q[2].buttons?.[0]?.id === "delivered_1" && String(q[3].text).includes("maps.example") && q[4].buttons?.[1]?.id === "delivery_issue_2", JSON.stringify(q).slice(0, 300));
  assert("06:00 follow-up: no reminder to عمر; owner told he waits for «بدء الدوام»", tpl(OMAR_PHONE, "utak_purchase_list_v2").length === 0 && ownerSays("بانتظار «بدء الدوام»: عمر المجهلي").length === 1);
  // he writes before tapping
  await say(OMAR_PHONE, `${DAY} 04:40`, "صباح الخير");
  const early = texts(OMAR_PHONE);
  assert("a text before the tap: told when his shift starts, still no task, queue untouched", early.length === 1 && early[0].includes("05:00") && JSON.parse(ENV.MSG_DEDUP.store.get(`pending_loc:+${OMAR_PHONE}`) ?? "[]").length === 5, JSON.stringify(early));
  await tick(`${DAY} 05:00`);
  await say(OMAR_PHONE, `${DAY} 05:02`, "وصلت");
  assert("after the template, before the tap: «اضغط بدء الدوام»", texts(OMAR_PHONE).at(-1)?.includes("اضغط «بدء الدوام»"), JSON.stringify(texts(OMAR_PHONE)));
  // the tap releases everything
  const before = sentTo(OMAR_PHONE).length;
  await tap(OMAR_PHONE, `${DAY} 05:04`);
  const after = sentTo(OMAR_PHONE).slice(before);
  const bodies = after.map((b) => JSON.stringify(b));
  assert("tap: «تم تسجيل حضورك» first", String(after[0]?.text?.body ?? "").includes("تم تسجيل حضورك الساعة 05:04"), bodies[0]);
  assert("tap: the route list, the location, both stops with their buttons", bodies.some((b) => b.includes("مسارك اليوم")) && after.some((b) => b.type === "location") && bodies.some((b) => b.includes("delivered_1")) && bodies.some((b) => b.includes("delivery_issue_2")));
  assert("tap: warehouse → the open purchase list #950 with «تم الشراء»", bodies.some((b) => b.includes("قائمة الشراء #950") && b.includes("purchase_done_950")));
  assert("tap: collector → the unpaid list (INV-77)", bodies.some((b) => b.includes("INV-77")));
  assert("queue emptied", !ENV.MSG_DEDUP.store.has(`pending_loc:+${OMAR_PHONE}`));
  const rw = row(OMAR);
  assert("Odoo: tapped 05:04, «حاضر»", rw.x_tapped_at === "2026-09-26 02:04:00" && rw.x_status === "present", JSON.stringify(rw));
  // after the tap, tasks go straight out, and no second «بدء الدوام» template
  const n0 = sentTo(OMAR_PHONE).length;
  setRiyadh(`${DAY} 09:00`);
  await quiet(() => team.sendDriverRoute(ENV, omar, [{ order_id: 3, customer_name: "زبون", neighborhood: "", latitude: 24.8, longitude: 46.7, line_summary: "موز × 2" }] as any, 2));
  const later = sentTo(OMAR_PHONE).slice(n0);
  assert("after the tap: a new route goes out now, location inline, no extra «بدء الدوام»", later.some((b) => b.type === "location") && later.every((b) => b?.template?.name !== SHIFT_TPL), JSON.stringify(later.map((b) => b.type + ":" + (b.template?.name ?? ""))));
  // a collector held: the collection request is queued, with its buttons
  ENV = fresh(`${DAY} 06:00`);
  const held = await att.attendanceHold(ENV, KHALID);
  assert("خالد (07:30) at 06:00: held", held.hold === true && held.shift === "07:30" && held.sent === false, JSON.stringify(held));
  const noTimeHold = await att.attendanceHold(ENV, NOTIME);
  assert("member without a working schedule: never held (old behaviour)", noTimeHold.hold === false && noTimeHold.onAttendance === false);
  const summary = await quiet(() => invoice.sendDailyCollectionSummary(ENV));
  assert("18:00 summary to a held collector: nothing sent, reported «held»", sentTo(KHALID_PHONE).length === 0 && summary.sends.some((s: any) => s.reason === "held until «بدء الدوام»"), JSON.stringify(summary));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 3. +30 reminder, +60 absent, late
console.log("\n[3] +30: one reminder + one alert; +60: absent + one alert; late taps");
{
  ENV = fresh(`${DAY} 05:00`);
  await tick(`${DAY} 05:00`);
  await tick(`${DAY} 05:25`);
  assert("+25: still only the start", tpl(OMAR_PHONE).length === 1 && ownerSays("لم يسجّل حضوره").length === 0);
  await tick(`${DAY} 05:30`);
  assert("+30: the reminder (same template, same payload)", tpl(OMAR_PHONE).length === 2 && payloads(tpl(OMAR_PHONE)[1]).join() === "shift_start");
  assert("+30: owner alert «عمر المجهلي لم يسجّل حضوره»", ownerSays("عمر المجهلي لم يسجّل حضوره").length === 1, JSON.stringify(sentTo(OWNER)).slice(0, 300));
  assert("+30: x_reminder_sent", row(OMAR).x_reminder_sent === true);
  await tick(`${DAY} 05:35`); await tick(`${DAY} 05:40`); await tick(`${DAY} 05:55`);
  assert("+35…+55: no second reminder, no second alert", tpl(OMAR_PHONE).length === 2 && ownerSays("لم يسجّل حضوره").length === 1);
  assert("+55: not absent yet", !row(OMAR).x_status);
  await tick(`${DAY} 06:00`);
  assert("+60: «غائب» in Odoo", row(OMAR).x_status === "absent");
  assert("+60: one owner alert «سُجّل غائباً»", ownerSays("عمر المجهلي سُجّل غائباً").length === 1);
  await tick(`${DAY} 06:05`); await tick(`${DAY} 07:00`); await tick(`${DAY} 12:00`);
  assert("after: no more templates, alerts or writes", tpl(OMAR_PHONE).length === 2 && ownerSays("غائباً").length === 1 && ownerSays("لم يسجّل").length === 1);
  // tap after +60 → late, tasks, owner alert
  const before = sentTo(OMAR_PHONE).length;
  await tap(OMAR_PHONE, `${DAY} 06:15`);
  assert("tap at +75 after absent: «متأخر» (not absent), tapped 06:15", row(OMAR).x_status === "late" && row(OMAR).x_tapped_at === "2026-09-26 03:15:00", JSON.stringify(row(OMAR)));
  assert("…he is told «متأخر» and gets his tasks (none → «ما عندك مهام»)", sentTo(OMAR_PHONE).slice(before).some((b) => String(b.text?.body ?? "").includes("متأخر")) && texts(OMAR_PHONE).includes(att.NO_TASKS_TEXT));
  assert("…owner alert «سجّل حضوره متأخراً … بعد تسجيله غائباً»", ownerSays("عمر المجهلي سجّل حضوره متأخراً الساعة 06:15").length === 1 && ownerSays("بعد تسجيله غائباً").length === 1);
  const nT = texts(OMAR_PHONE).length;
  await tap(OMAR_PHONE, `${DAY} 06:20`);
  const again = texts(OMAR_PHONE).slice(nT);
  assert("second tap: «مسجّل من 06:15» (then his tasks again), no second alert, status and tap time kept", again[0]?.includes("مسجّل من 06:15") && ownerSays("سجّل حضوره متأخراً").length === 1 && row(OMAR).x_status === "late" && row(OMAR).x_tapped_at === "2026-09-26 03:15:00", JSON.stringify(again));

  // +20 → late (no alert); +10 → present; +15 exactly → present
  for (const [at, want] of [["05:10", "present"], ["05:15", "present"], ["05:20", "late"], ["05:59", "late"]] as const) {
    ENV = fresh(`${DAY} 05:00`);
    await tick(`${DAY} 05:00`);
    await tap(OMAR_PHONE, `${DAY} ${at}`);
    assert(`tap at ${at}: «${want}»${want === "late" ? ", no owner alert before +60" : ""}`, row(OMAR).x_status === want && ownerSays("متأخراً").length === 0, JSON.stringify(row(OMAR)));
  }
  // a tap on today's button uses Meta's tap time, not the arrival time
  ENV = fresh(`${DAY} 05:00`);
  await tick(`${DAY} 05:00`);
  setRiyadh(`${DAY} 05:40`);
  await tap(OMAR_PHONE, `${DAY} 05:40`, { timestamp: String(Math.floor(Date.parse(`${DAY}T05:12:00+03:00`) / 1000)) });
  assert("tap at 05:12 delivered 05:40: «حاضر» at 05:12", row(OMAR).x_status === "present" && row(OMAR).x_tapped_at === "2026-09-26 02:12:00", JSON.stringify(row(OMAR)));
  // a tap before today's template: nothing recorded, no task
  ENV = fresh(`${DAY} 04:00`);
  await tap(OMAR_PHONE, `${DAY} 04:10`);
  assert("tap before today's template: «دوامك اليوم يبدأ 05:00», no row", texts(OMAR_PHONE).at(-1)?.includes("دوامك اليوم يبدأ 05:00") && !row(OMAR));
  // a member without a working schedule taps a route's «بدء الدوام»: the 09-17 behaviour
  ENV = fresh(`${DAY} 10:00`);
  ENV.MSG_DEDUP.store.set(`pending_loc:+${NOTIME_PHONE}`, JSON.stringify([{ latitude: 24.7, longitude: 46.6, name: "#9" }]));
  await tap(NOTIME_PHONE, `${DAY} 10:00`);
  assert("no-time driver's tap: «تم بدء الدوام» + his locations, no attendance row", texts(NOTIME_PHONE).at(0)?.includes("تم بدء الدوام") && sentTo(NOTIME_PHONE).some((b) => b.type === "location") && rows("x_team_attendance").length === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 4. Baraa
console.log("\n[4] Baraa: the window template daily at the earliest shift − 15 min (عمر 05:00 → 04:45) — no attendance, no alerts about him");
{
  ENV = fresh(`${DAY} 04:00`);
  for (const at of ["04:00", "04:30", "04:40"]) await tick(`${DAY} ${at}`);
  assert("before 04:45: no window template to Baraa", tpl(OWNER).length === 0);
  await tick(`${DAY} 04:45`);
  const t = tpl(OWNER);
  assert("04:45 (عمر 05:00 − 15): utak_shift_start_v2 to Baraa [«براء»], payload shift_start", t.length === 1 && params(t[0]).join() === "براء" && payloads(t[0]).join() === "shift_start", JSON.stringify(t[0]?.template));
  for (const at of ["04:50", "05:10", "05:15", "06:00", "09:00", "23:55"]) await tick(`${DAY} ${at}`);
  assert("once a day: no second one", tpl(OWNER).length === 1);
  assert("never on the roster (even an employee with a role and 05:00): no row, no alert about him", !rows("x_team_attendance").some((r) => r.x_partner_id === OWNER_PID || r.x_employee_id === EMP(OWNER_PID)) && ownerSays("Bara.a").length === 0);
  await tap(OWNER, `${DAY} 04:55`);
  const ack = texts(OWNER).at(-1) ?? "";
  assert("his tap: one line «✅ تم. تنبيهات …», nothing recorded", ack.startsWith("✅ تم. تنبيهات يو تاك") && !rows("x_team_attendance").some((r) => r.x_partner_id === OWNER_PID), ack);
  await tick(`${DAY} 07:00`);
  // next day again
  await tick(`2026-09-27 04:45`);
  assert("next day 04:45: again, once", tpl(OWNER).length === 2);
  // nobody with a working schedule on the roster → OWNER_WINDOW_OPEN_AT, a fallback only
  ENV = fresh(`${DAY} 05:00`, { OWNER_WINDOW_OPEN_AT: "05:30" });
  for (const id of [OMAR, KHALID]) table("hr.employee").get(EMP(id))!.resource_calendar_id = false;
  await tick(`${DAY} 05:25`);
  await tick(`${DAY} 05:30`);
  assert("no working schedule anywhere: OWNER_WINDOW_OPEN_AT=05:30 → at 05:30", tpl(OWNER).length === 1);
  // the owner guard still refuses the purpose team_shift_start to Baraa
  const { sendTemplateByPurpose, T } = await import("../src/templates.ts");
  const blocked = await quiet(() => sendTemplateByPurpose(ENV, "+" + OWNER, T.TEAM_SHIFT_START, ["x"], [{ index: 0, payload: "shift_start" }]));
  assert("owner guard: team_shift_start alone is still blocked for Baraa (403)", blocked?.status === 403);
}

// ================================================================ 5. re-runs
console.log("\n[5] re-running the job repeats nothing");
{
  ENV = fresh(`${DAY} 05:00`);
  await tick(`${DAY} 05:00`); await tick(`${DAY} 05:00`); await tick(`${DAY} 05:00`);
  assert("same minute ×3: one start", tpl(OMAR_PHONE).length === 1 && rows("x_team_attendance").filter((r) => r.x_partner_id === OMAR).length === 1);
  ENV.MSG_DEDUP.store.clear();
  await tick(`${DAY} 05:05`);
  assert("KV wiped, next tick: still one start (Odoo x_sent_at)", tpl(OMAR_PHONE).length === 1);
  await Promise.all([tick(`${DAY} 05:30`), tick(`${DAY} 05:30`)]);
  assert("two +30 ticks at once: one reminder, one alert", tpl(OMAR_PHONE).length === 2 && ownerSays("لم يسجّل حضوره").length === 1, `${tpl(OMAR_PHONE).length} / ${ownerSays("لم يسجّل حضوره").length}`);
  ENV.MSG_DEDUP.store.clear();
  await tick(`${DAY} 05:45`);
  assert("KV wiped after the reminder: no second reminder or alert (x_reminder_sent)", tpl(OMAR_PHONE).length === 2 && ownerSays("لم يسجّل حضوره").length === 1);
  await Promise.all([tick(`${DAY} 06:00`), tick(`${DAY} 06:00`)]);
  ENV.MSG_DEDUP.store.clear();
  await tick(`${DAY} 06:10`);
  assert("absent: one alert across parallel ticks and a KV wipe (x_status)", ownerSays("سُجّل غائباً").length === 1 && row(OMAR).x_status === "absent");
  // start: two ticks at once
  ENV = fresh(`${DAY} 05:00`);
  await Promise.all([tick(`${DAY} 05:00`), tick(`${DAY} 05:00`)]);
  assert("two start ticks at once: one template, one row", tpl(OMAR_PHONE).length === 1 && rows("x_team_attendance").filter((r) => r.x_partner_id === OMAR).length === 1, `${tpl(OMAR_PHONE).length} / ${rows("x_team_attendance").length}`);
  // Baraa's window template, KV kept: once
  await tick(`${DAY} 04:45`); await tick(`${DAY} 04:45`);
  assert("Baraa ×2 at 04:45: once", tpl(OWNER).length === 1);
  // and the next day starts clean
  await tick(`2026-09-27 05:00`);
  assert("next day: a new start and a new row", tpl(OMAR_PHONE).length === 2 && rows("x_team_attendance").filter((r) => r.x_partner_id === OMAR).length === 2);
}

// ================================================================ 6. (ب) late re-delivered inbound
console.log("\n[6] (ب) a message Meta re-delivers after 24h: mirrored, no bot action");
{
  ENV = fresh(`${DAY} 10:00`);
  // control: a fresh text from a team member without a working schedule gets the bot's reply
  await say(NOTIME_PHONE, `${DAY} 10:00`, "صباح الورد");
  assert("fresh: the bot answers", texts(NOTIME_PHONE).length === 1, JSON.stringify(texts(NOTIME_PHONE)));
  await say(NOTIME_PHONE, `${DAY} 10:05`, "صباح الورد", { timestamp: secondsAgo(71) });
  assert("71h late: no reply", texts(NOTIME_PHONE).length === 1, JSON.stringify(texts(NOTIME_PHONE)));
  const notes = odooLog.filter((l) => l.model === "discuss.channel" && l.method === "message_post" && String(l.body?.body ?? "").includes("⏳"));
  assert("…a «⏳ … متأخرة 71 ساعة» note in his channel", notes.length === 1 && String(notes[0].body.body).includes("متأخرة 71 ساعة"), JSON.stringify(notes.map((n) => n.body.body)));
  assert("…still logged in x_wa_message as inbound", rows("x_wa_message").filter((r) => r.x_direction === "in" && r.x_body === "صباح الورد").length === 2);
  // a supplier: no Claude, no price, no «وصلتنا»
  claudeCalls = 0;
  await say(SUP_PHONE, `${DAY} 10:10`, "طماطم 25", { timestamp: secondsAgo(75) });
  assert("supplier, 75h late: no Claude call, no price row, nothing sent", claudeCalls === 0 && rows("x_daily_price").length === 0 && sentTo(SUP_PHONE).length === 0, `claude=${claudeCalls} prices=${rows("x_daily_price").length} sent=${sentTo(SUP_PHONE).length}`);
  await say(SUP_PHONE, `${DAY} 10:15`, "طماطم 25");
  assert("supplier, fresh: the extractor runs (control)", claudeCalls >= 1);
  // a late tap does not record attendance
  ENV = fresh(`${DAY} 05:00`);
  await tick(`${DAY} 05:00`);
  await tap(OMAR_PHONE, `2026-09-27 06:00`, { timestamp: String(Math.floor(Date.parse(`${DAY}T05:05:00+03:00`) / 1000)) });
  assert("a tap re-delivered 25h late: not recorded, no reply", !row(OMAR).x_tapped_at && texts(OMAR_PHONE).length === 0);
  assert("23h old is still inside the window: acted on", (await import("../src/wa-inbox.ts")).lateInboundHours(secondsAgo(23)) === null);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

console.log(`\nattendance: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
