// The team in the Employees app (2026-09-25, STATUS § 31).
//
//   [1] the working schedule: a work day, a weekly day off, the employee's
//       time off, a company time off (and the ones that do not apply), two
//       periods, a variable schedule;
//   [2] safety: no schedule, «مشمول بالتحضير» off, Odoo's default hours-only
//       schedule — nobody gets anything;
//   [3] after the shift / on a day off: the task waits for the next shift's
//       tap, ONE owner alert «مهمة لـ{الاسم} بعد دوامه» per task kind and day,
//       the queue lives until the next shift, a late tap after the end
//       releases nothing;
//   [4] Baraa's morning template: the fixed OWNER_WINDOW_OPEN_AT (06:00)
//       every day — the team's shifts, days off and time off do not move it
//       (STATUS § 32; it was the earliest shift − 15 min in § 31);
//   [5] routing and roles from hr.employee only (Work Contact number,
//       neighborhoods, an old partner role is not team);
//   [6] no place reads the old source (code scan + every Odoo call made);
//   [7] one roster read per 5 minutes, no N+1, dropped by the Odoo hook;
//   [8] ensureCustomerRoleId never duplicates, a new partner has no role;
//   [9] an archived number: kept, nothing sent, «رقم مؤرشف يطلب» once a day;
//   [10] a «شخصي» number: kept, nothing sent, no alert.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind the strict
// schema gate built from the tenant's real field lists (fields_get), the last
// one taken after scripts/team-20260925-hr-setup.mjs --apply
// (tests/fixtures-odoo-fields-20260925-team.json). No network, no WhatsApp.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/team-hr.test.mts

import { readdirSync, readFileSync } from "node:fs";
import {
  ctx, employee, graph, inbound, odooLog, order, OWNER, quiet, reset, rows, seed, sentTo, setRiyadh, signed, table, workSchedule,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const FX = ["./fixtures-odoo-fields-20260924.json", "./fixtures-odoo-fields-20260925-suppliers.json",
  "./fixtures-odoo-fields-20260925-attendance.json", "./fixtures-odoo-fields-20260925-review.json",
  "./fixtures-odoo-fields-20260925-team.json",
  // STATUS § 33 — x_wa_message.x_status: held / expired / skipped (the send gateway)
  "./fixtures-odoo-fields-20260925-gateway.json",
  // STATUS § 36 — the echo state and the template text fields
  "./fixtures-odoo-fields-20260925-s36.json"].map(load);
const REAL: Record<string, string[]> = Object.assign({}, ...FX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FX.map((f) => f._selections));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}

// ---------------------------------------------------------------- fake Claude + active_test on res.partner
let SCREEN: unknown = { intent: "unclear", reason: "سبب" };
let CLASSIFY = "other";
const calls = { screen: 0, classify: 0 };
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    const sys = String(JSON.parse(init.body).system ?? "");
    let text = "أهلاً وسهلاً";
    if (sys.startsWith("You screen")) { calls.screen++; text = JSON.stringify(SCREEN); }
    else if (sys.startsWith("You classify")) { calls.classify++; text = JSON.stringify({ intent: CLASSIFY, confidence: 0.9 }); }
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
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
    // Odoo's active_test on res.partner (before the limit)
    if (m[1] === "res.partner" && ["search_read", "search", "search_count"].includes(m[2])) {
      const namesActive = JSON.stringify(b.domain ?? []).includes('"active"');
      if (!namesActive && b.context?.active_test !== false) {
        const live = (id: number) => table("res.partner").get(id)?.active !== false;
        if (m[2] === "search_count") {
          const found = await (await harnessFetch(url.replace("/search_count", "/search"), init)).json() as number[];
          return new Response(JSON.stringify(found.filter(live).length), { status: 200 });
        }
        const unlimited = await (await harnessFetch(input as any, { ...init, body: JSON.stringify({ ...b, limit: undefined }) })).json() as any[];
        const kept = unlimited.filter((r) => live(typeof r === "number" ? r : r.id));
        return new Response(JSON.stringify(b.limit ? kept.slice(0, b.limit) : kept), { status: 200 });
      }
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const { setOdooRetryHooksForTests } = await import("../src/odoo.ts");
setOdooRetryHooksForTests({ sleep: async () => {}, alert: async () => {} });
const odoo = await import("../src/odoo.ts");
const { clearTemplateCache } = await import("../src/templates.ts");
const att = await import("../src/attendance.ts");
const roster = await import("../src/team-roster.ts");
const team = await import("../src/team.ts");
const invoice = await import("../src/invoice.ts");
const worker = (await import("../src/index.ts")).default;

// ---------------------------------------------------------------- data (Riyadh: 2026-09-27 is a Sunday)
const SUN = "2026-09-27", MON = "2026-09-28", THU = "2026-10-01", FRI = "2026-10-02", SAT = "2026-10-03";
const OMAR = 801, OMAR_PHONE = "966500000801";     // warehouse + driver + collector, Sun–Thu 07:00–15:00
const KHALID = 803, KHALID_PHONE = "966500000803"; // collector, Sun–Thu 06:30–14:30
const OTHMAN = 811, OTHMAN_PHONE = "966500000811"; // «مدير» only, not on attendance
const EMP = (pid: number) => 7000 + pid;
const RES = (pid: number) => EMP(pid) + 100000;       // its resource.resource (wa-harness employee())
const SUN_THU = [6, 0, 1, 2, 3];                        // Odoo weekday: Monday 0 … Sunday 6
const sunThu = (from: number, to: number) => workSchedule(SUN_THU.map((d) => [d, from, to] as [number, number, number]));
const SHIFT_TPL = "utak_shift_start_v2";
let ENV: any;
const ttls = new Map<string, number>();

function fresh(riyadh = `${SUN} 05:00`, extra: Record<string, unknown> = {}): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0; calls.screen = 0; calls.classify = 0; ttls.clear();
  SCREEN = { intent: "unclear", reason: "سبب" }; CLASSIFY = "other";
  Object.assign(env, extra);
  const put = env.MSG_DEDUP.put.bind(env.MSG_DEDUP);
  env.MSG_DEDUP.put = async (k: string, v: string, o?: { expirationTtl?: number }) => { if (o?.expirationTtl) ttls.set(k, o.expirationTtl); return put(k, v); };
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  seed("x_employee_role", { id: 74, x_code: "admin" });
  seed("res.partner", { id: OMAR, name: "عمر المجهلي", x_whatsapp_number: "+" + OMAR_PHONE });
  seed("res.partner", { id: KHALID, name: "خالد", x_whatsapp_number: "+" + KHALID_PHONE });
  seed("res.partner", { id: OTHMAN, name: "عثمان عبدالوهاب", x_whatsapp_number: "+" + OTHMAN_PHONE, customer_rank: 1, x_contact_class: "team" });
  employee(OMAR, [71, 72, 73], { x_utak_attendance: true, resource_calendar_id: sunThu(7, 15), x_utak_neighborhood_ids: [1] });
  employee(KHALID, [73], { x_utak_attendance: true, resource_calendar_id: sunThu(6.5, 14.5) });
  employee(OTHMAN, [74]);
  seed("res.partner", { name: "UTAK بوت" });
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: SHIFT_TPL, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "driver_dispatch", x_meta_template_id: "utak_driver_dispatch", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 4, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "driver_stop", x_meta_template_id: "utak_driver_stop", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 5, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "customer_welcome", x_meta_template_id: "utak_welcome", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  return env;
}
const tick = async (at: string) => { setRiyadh(at); return quiet(() => att.runAttendanceTick(ENV)); };
const tpl = (digits: string, name = SHIFT_TPL) => sentTo(digits).filter((b) => b?.template?.name === name);
const texts = (digits: string) => sentTo(digits).filter((b) => b?.type === "text").map((b) => String(b.text?.body ?? ""));
const ownerSays = (needle: string) => sentTo(OWNER).filter((b) => JSON.stringify(b).includes(needle));
const attRow = (pid: number, day: string) => rows("x_team_attendance").find((r) => r.x_employee_id === EMP(pid) && r.x_date === day) as any;
const queue = (digits: string) => JSON.parse(ENV.MSG_DEDUP.store.get(`pending_loc:+${digits}`) ?? "[]") as any[];
const tap = (digits: string, at: string) => {
  setRiyadh(at);
  return quiet(() => worker.fetch(signed(inbound(digits, { type: "button", button: { payload: "shift_start", text: "بدء الدوام" } })), ENV, ctx));
};
const say = (digits: string, at: string, text: string, name = "x") => {
  setRiyadh(at);
  const p = inbound(digits, { type: "text", text: { body: text } });
  (p.entry[0].changes[0].value.contacts[0] as any).profile.name = name;
  return quiet(() => worker.fetch(signed(p), ENV, ctx));
};
const sendRaw = (digits: string, at: string, m: Record<string, unknown>) => {
  setRiyadh(at);
  return quiet(() => worker.fetch(signed(inbound(digits, m)), ENV, ctx));
};
const omarMember = () => ({ id: OMAR, employeeId: EMP(OMAR), name: "عمر المجهلي", x_whatsapp_number: "+" + OMAR_PHONE, x_role: "driver", x_role_codes: ["warehouse", "driver", "collector"] } as any);
const route = (id: number) => [{ order_id: id, customer_name: "مطعم الوادي", neighborhood: "العليا", latitude: 24.7, longitude: 46.6, line_summary: "طماطم × 3" }] as any;
const leave = (vals: Record<string, unknown>) => seed("resource.calendar.leaves", { name: "إجازة", count_as: "absence", company_id: 1, calendar_id: false, resource_id: false, ...vals });
/** Riyadh «YYYY-MM-DD HH:MM» → Odoo UTC «YYYY-MM-DD HH:MM:SS». */
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);

// ================================================================ 1. the working schedule
console.log("\n[1] the working schedule: work day, weekly day off, time off, two periods, variable");
{
  ENV = fresh(`${SUN} 05:00`);
  const r0 = await tick(`${SUN} 06:25`);
  assert("Sunday 06:25: nothing yet", graph.length === 0 || tpl(OMAR_PHONE).length + tpl(KHALID_PHONE).length === 0, JSON.stringify(r0.members));
  await tick(`${SUN} 06:30`);
  assert("Sunday 06:30: خالد (first period 06:30) gets «بدء الدوام», عمر not yet", tpl(KHALID_PHONE).length === 1 && tpl(OMAR_PHONE).length === 0);
  const r = await tick(`${SUN} 07:00`);
  assert("Sunday 07:00: عمر gets it, the row carries x_employee_id", tpl(OMAR_PHONE).length === 1 && attRow(OMAR, SUN)?.x_shift_at === "2026-09-27 04:00:00", JSON.stringify(attRow(OMAR, SUN)));
  assert("report: shift 07:00–15:00 from the schedule", r.members.find((m: any) => m.partnerId === OMAR)?.shift === "07:00" && r.members.find((m: any) => m.partnerId === OMAR)?.end === "15:00", JSON.stringify(r.members));

  // weekly day off: Friday and Saturday have no line
  for (const day of [FRI, SAT]) {
    ENV = fresh(`${day} 00:00`);
    let rep: any;
    for (let min = 0; min < 24 * 60; min += 30) rep = await tick(`${day} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
    assert(`${day === FRI ? "Friday" : "Saturday"} (no schedule line): no template, no row, no absence all day, reported «day_off»`,
      tpl(OMAR_PHONE).length === 0 && tpl(KHALID_PHONE).length === 0 && rows("x_team_attendance").length === 0 && ownerSays("غائب").length === 0
      && [OMAR, KHALID].every((pid) => rep.members.find((m: any) => m.partnerId === pid)?.action === "day_off"), JSON.stringify(rep.members));
  }

  // the employee's own time off covering the shift start
  ENV = fresh(`${SUN} 05:00`);
  leave({ name: "إجازة عمر", resource_id: RES(OMAR), date_from: utc(`${SUN} 00:00`), date_to: utc(`${SUN} 23:59`) });
  for (const at of ["06:30", "07:00", "07:30", "08:00", "09:00"]) await tick(`${SUN} ${at}`);
  const rl = await tick(`${SUN} 10:00`);
  assert("عمر's time off: no template, no row, no absence; reported «leave»", tpl(OMAR_PHONE).length === 0 && !attRow(OMAR, SUN) && ownerSays("عمر المجهلي").length === 0 && rl.members.find((m: any) => m.partnerId === OMAR)?.action === "leave", JSON.stringify(rl.members));
  assert("…خالد works as usual that day (start 06:30, then his +30 reminder)", tpl(KHALID_PHONE).length === 2 && !!attRow(KHALID, SUN)?.x_sent_at);
  await tick(`${MON} 07:00`);
  assert("…and عمر is back the next day", tpl(OMAR_PHONE).length === 1);

  // a company-wide time off (no employee): nobody
  ENV = fresh(`${SUN} 05:00`);
  leave({ name: "اليوم الوطني", date_from: utc(`${SUN} 00:00`), date_to: utc(`${SUN} 23:59`) });
  for (const at of ["06:30", "07:00", "08:00", "09:00"]) await tick(`${SUN} ${at}`);
  assert("company time off: nobody gets «بدء الدوام», nobody absent", tpl(OMAR_PHONE).length === 0 && tpl(KHALID_PHONE).length === 0 && rows("x_team_attendance").length === 0);

  // time off that does not apply: another schedule, «working time», another company, partial after the start
  ENV = fresh(`${SUN} 05:00`);
  const other = workSchedule([[6, 8, 16]]);
  leave({ name: "جدول آخر", calendar_id: other, date_from: utc(`${SUN} 00:00`), date_to: utc(`${SUN} 23:59`) });
  leave({ name: "تدريب", count_as: "working_time", resource_id: RES(OMAR), date_from: utc(`${SUN} 00:00`), date_to: utc(`${SUN} 23:59`) });
  leave({ name: "شركة أخرى", company_id: 2, date_from: utc(`${SUN} 00:00`), date_to: utc(`${SUN} 23:59`) });
  leave({ name: "مشوار الظهر", resource_id: RES(OMAR), date_from: utc(`${SUN} 12:00`), date_to: utc(`${SUN} 15:00`) });
  await tick(`${SUN} 06:30`); await tick(`${SUN} 07:00`);
  assert("time off for another schedule / counted as work / another company / after the start: the template goes out", !!attRow(OMAR, SUN)?.x_sent_at && !!attRow(KHALID, SUN)?.x_sent_at && tpl(OMAR_PHONE).length === 1, JSON.stringify([attRow(OMAR, SUN), attRow(KHALID, SUN)]));

  // two periods: start of the first, end of the last
  ENV = fresh(`${SUN} 05:00`);
  table("hr.employee").get(EMP(OMAR))!.resource_calendar_id = workSchedule([[6, 13, 17], [6, 7, 11]]);
  const r2 = await tick(`${SUN} 07:00`);
  assert("two periods (07–11, 13–17): template at 07:00, shift ends 17:00", tpl(OMAR_PHONE).length === 1 && r2.members.find((m: any) => m.partnerId === OMAR)?.end === "17:00", JSON.stringify(r2.members.find((m: any) => m.partnerId === OMAR)));
  await tap(OMAR_PHONE, `${SUN} 07:05`);
  const midday = await att.attendanceHold(ENV, OMAR, Date.parse(`${SUN}T12:00:00+03:00`));
  const evening = await att.attendanceHold(ENV, OMAR, Date.parse(`${SUN}T17:00:00+03:00`));
  assert("the break (12:00) is inside the shift; 17:00 is after it", midday.hold === false && evening.hold === true && evening.phase === "after", JSON.stringify([midday, evening]));

  // a variable schedule, the way Odoo reads it (_filter_by_date): a dated line every 2 weeks
  const lines = [
    { calendarId: 9, type: "variable", dayofweek: "0", hourFrom: 8, hourTo: 12, durationBased: false, date: MON, recurrency: true, recurrencyType: "weeks", interval: 2, until: "9999-12-31", excluded: ["2026-10-26"] },
    { calendarId: 9, type: "variable", dayofweek: "3", hourFrom: 9, hourTo: 10, durationBased: false, date: THU, recurrency: false, recurrencyType: "weeks", interval: 1, until: THU, excluded: [] },
    { calendarId: 9, type: "variable", dayofweek: "0", hourFrom: 1, hourTo: 2, durationBased: false, date: null, recurrency: false, recurrencyType: "weeks", interval: 1, until: null, excluded: [] },
  ] as any[];
  const on = (d: string) => roster.linesOn(lines, 9, d).map((l: any) => l.hourFrom).join(",");
  assert("variable: every 2 weeks from Monday 09-28 (09-28 yes, 10-05 no, 10-12 yes), an excluded date no, a one-off date yes, a weekday line ignored",
    on(MON) === "8" && on("2026-10-05") === "" && on("2026-10-12") === "8" && on("2026-10-26") === "" && on(THU) === "9" && on("2026-09-21") === "",
    JSON.stringify([on(MON), on("2026-10-05"), on("2026-10-12"), on("2026-10-26"), on(THU)]));
  assert("Odoo weekday of the days used here: Sun 6, Mon 0, Fri 4, Sat 5", [SUN, MON, FRI, SAT].map(roster.odooWeekday).join() === "6,0,4,5");
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 2. safety
console.log("\n[2] safety: no schedule, «مشمول بالتحضير» off, Odoo's default hours-only schedule");
{
  ENV = fresh(`${SUN} 05:00`);
  const e = table("hr.employee").get(EMP(OMAR))!;
  e.resource_calendar_id = false;                                  // on attendance, no schedule
  table("hr.employee").get(EMP(KHALID))!.x_utak_attendance = false; // a schedule, attendance off
  for (let min = 5 * 60; min < 20 * 60; min += 15) await tick(`${SUN} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
  assert("no schedule / attendance off: no template all day, no row", tpl(OMAR_PHONE).length === 0 && tpl(KHALID_PHONE).length === 0 && rows("x_team_attendance").length === 0);
  const h1 = await att.attendanceHold(ENV, OMAR), h2 = await att.attendanceHold(ENV, KHALID);
  assert("…and their tasks are not held (the old behaviour)", !h1.hold && !h1.onAttendance && !h2.hold && !h2.onAttendance);

  // Odoo's default «40 hours/week»: duration lines, no clock time (hour_from = hour_to = 0)
  ENV = fresh(`${SUN} 00:00`);
  const def = seed("resource.calendar", { name: "40 hours/week", calendar_type: "fixed", company_id: 1 });
  for (const d of [0, 1, 2, 3, 4]) seed("resource.calendar.attendance", { calendar_id: def, dayofweek: String(d), hour_from: 0, hour_to: 0, duration_based: true, duration_hours: 8, day_period: "full_day", date: false, recurrency: false });
  seed("res.partner", { id: 821, name: "Emma Granger", phone: "(555)-768-6230" });
  employee(821, [], { resource_calendar_id: def });                                     // sample employee: no role
  table("hr.employee").get(EMP(OMAR))!.resource_calendar_id = def;                       // the default schedule, attendance on
  table("hr.employee").get(EMP(KHALID))!.resource_calendar_id = def;
  table("hr.employee").get(EMP(KHALID))!.x_utak_attendance = false;                       // the default schedule alone
  let rep: any;
  for (let min = 0; min < 24 * 60; min += 30) rep = await tick(`${MON} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
  assert("the default hours-only schedule sends nothing, even with attendance on (reported «no_clock_time»)",
    tpl(OMAR_PHONE).length === 0 && rows("x_team_attendance").length === 0 && rep.members.find((m: any) => m.partnerId === OMAR)?.action === "no_clock_time", JSON.stringify(rep.members));
  assert("the default schedule alone (attendance off) does not enroll anyone", tpl(KHALID_PHONE).length === 0 && rep.members.find((m: any) => m.partnerId === KHALID)?.action === "not_enrolled");
  assert("an employee without a UTAK role (Odoo's sample data) is not on the roster", !rep.members.some((m: any) => m.partnerId === 821));
  assert("Baraa's window: 06:00 (OWNER_WINDOW_OPEN_AT unset → the default)", rep.owner.at === "06:00" && rep.owner.source === "default");
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 3. after the shift
console.log("\n[3] after the shift: the task waits for the next shift, one owner alert");
{
  ENV = fresh(`${SUN} 06:00`);
  await tick(`${SUN} 07:00`);
  await tap(OMAR_PHONE, `${SUN} 07:03`);
  const n0 = sentTo(OMAR_PHONE).length;
  setRiyadh(`${SUN} 10:00`);
  await quiet(() => team.sendDriverRoute(ENV, omarMember(), route(1), 11));
  assert("in the shift (10:00): the route goes out now", sentTo(OMAR_PHONE).slice(n0).some((b) => b.type === "location"));
  // 16:00 — after 15:00
  const n1 = sentTo(OMAR_PHONE).length;
  setRiyadh(`${SUN} 16:00`);
  await quiet(() => team.sendDriverRoute(ENV, omarMember(), route(2), 12));
  assert("after the shift (16:00): nothing to عمر", sentTo(OMAR_PHONE).length === n1, JSON.stringify(sentTo(OMAR_PHONE).slice(n1)).slice(0, 200));
  assert("…the route is queued for the next shift", queue(OMAR_PHONE).some((q) => q.buttons?.[0]?.id === "delivered_2"));
  assert("…ONE owner alert «مهمة لـعمر المجهلي بعد دوامه: مسار التوصيل …» with the next shift", ownerSays("مهمة لـعمر المجهلي بعد دوامه: مسار التوصيل").length === 1 && ownerSays("الاثنين 07:00").length === 1, JSON.stringify(ownerSays("مهمة لـ")));
  const ttl = ttls.get(`pending_loc:+${OMAR_PHONE}`) ?? 0;
  const untilMon = (Date.parse(`${MON}T07:00:00+03:00`) - Date.parse(`${SUN}T16:00:00+03:00`)) / 1000;
  assert(`…the queue lives past the next shift start (${Math.round(ttl / 3600)} h ≥ ${Math.round(untilMon / 3600)} h + 36 h)`, ttl >= untilMon + 36 * 3600, String(ttl));
  setRiyadh(`${SUN} 16:30`);
  await quiet(() => team.sendDriverRoute(ENV, omarMember(), route(3), 13));
  assert("a second route the same evening: queued, no second alert", ownerSays("مسار التوصيل").length === 1 && queue(OMAR_PHONE).some((q) => q.buttons?.[0]?.id === "delivered_3"));
  // 18:00 summary and a collection request, 21:15 purchase list: other kinds, one alert each
  const oid = seed("x_daily_order", { x_customer_id: 501, x_delivery_neighborhood: "العليا", x_state: "delivered", x_order_date: SUN });
  seed("x_invoice", { x_invoice_number: "INV-88", x_total: 90, x_order_id: oid, x_status: "issued", x_is_simulation: false });
  setRiyadh(`${SUN} 18:00`);
  const sum = await quiet(() => invoice.sendDailyCollectionSummary(ENV));
  assert("18:00 summary after the shift: not sent to عمر nor خالد (his ended 14:30); a collector not on attendance still gets it",
    ["…0801", "…0803"].every((t) => sum.sends.find((s: any) => s.to === t)?.via === "none") && sum.sends.find((s: any) => s.to === "…0602")?.via === "template", JSON.stringify(sum));
  assert("…one alert per collector: «مهمة لـعمر المجهلي … ملخص التحصيل» and «مهمة لـخالد …»", ownerSays("مهمة لـعمر المجهلي بعد دوامه: ملخص التحصيل").length === 1 && ownerSays("مهمة لـخالد بعد دوامه: ملخص التحصيل").length === 1);
  order(501, "confirmed", SUN);
  setRiyadh(`${SUN} 21:15`);
  await quiet(() => team.aggregateAndDispatchToWarehouse(ENV));
  assert("21:15 purchase list after the shift: no template to عمر, one alert «قائمة الشراء»", tpl(OMAR_PHONE, "utak_purchase_list_v2").length === 0 && ownerSays("مهمة لـعمر المجهلي بعد دوامه: قائمة الشراء").length === 1);
  // STATUS § 33 — Baraa's window is open (his 06:00 tap): every alert goes as
  // text, and never as the MARKETING utak_owner_alert (outside his window they
  // wait for him instead: tests/wa-gateway.test.mts).
  const offAlerts = ownerSays("بعد دوامه");
  assert("each of the four «بعد دوامه» alerts went as text inside his window, none as utak_owner_alert",
    offAlerts.length === 4 && offAlerts.every((b) => b.type === "text"), JSON.stringify(offAlerts.map((b) => b.type)));
  // he writes after the shift
  await say(OMAR_PHONE, `${SUN} 21:30`, "مساء الخير");
  assert("a text after the shift: «دوامك اليوم انتهى …» and the queue stays", texts(OMAR_PHONE).at(-1)?.includes("دوامك اليوم انتهى") && queue(OMAR_PHONE).length > 0, JSON.stringify(texts(OMAR_PHONE).at(-1)));
  // a customer says he paid (21:40): عمر (collector) is inside his 24h window (he wrote at 21:30) but off shift
  const { notifyPaymentClaim } = await import("../src/pay-claim.ts");
  setRiyadh(`${SUN} 21:40`);
  const pc = await quiet(() => notifyPaymentClaim(ENV, { id: 501, name: "مطعم الوادي" }, { amount: 90, at: Date.now() } as any, "«حولت»"));
  assert("payment claim after the shift: the note is queued for عمر (not sent), one «بعد دوامه» alert",
    pc.collectors === 0 && queue(OMAR_PHONE).some((q) => String(q.text ?? "").includes("مطعم الوادي")) && ownerSays("مهمة لـعمر المجهلي بعد دوامه: تحقق من تحويل مطعم الوادي").length === 1, JSON.stringify(pc));
  // Monday: the template at 07:00, the tap releases everything
  await tick(`${MON} 07:00`);
  const n2 = sentTo(OMAR_PHONE).length;
  await tap(OMAR_PHONE, `${MON} 07:04`);
  const got = sentTo(OMAR_PHONE).slice(n2).map((b) => JSON.stringify(b));
  assert("Monday's tap: the two queued routes, the open purchase list, the unpaid list",
    got.some((b) => b.includes("delivered_2")) && got.some((b) => b.includes("delivered_3")) && got.some((b) => b.includes("purchase_done_")) && got.some((b) => b.includes("INV-88")), got.map((b) => b.slice(0, 60)).join(" | "));
  assert("…queue emptied", queue(OMAR_PHONE).length === 0);
  // STATUS § 33 — the payment-claim note no longer skips a collector outside
  // his 24h window (the gateway decides now): خالد, off shift, gets it queued
  // for his next shift like عمر, with its own «بعد دوامه» alert → 6 on Sunday.
  assert("…خالد's note waits for his next shift too", queue(KHALID_PHONE).some((q) => String(q.text ?? "").includes("مطعم الوادي")));
  assert("no alert repeats on Monday for Sunday's tasks", ownerSays("مهمة لـ").length === 6, String(ownerSays("مهمة لـ").length));

  // Thursday after the shift → the next shift is Sunday; Friday (day off) the same
  ENV = fresh(`${THU} 16:00`);
  await quiet(() => team.sendDriverRoute(ENV, omarMember(), route(4), 14));
  const thuTtl = ttls.get(`pending_loc:+${OMAR_PHONE}`) ?? 0;
  const untilSun = (Date.parse(`2026-10-04T07:00:00+03:00`) - Date.parse(`${THU}T16:00:00+03:00`)) / 1000;
  assert("Thursday 16:00: queued, alert names «الأحد 07:00», the queue lives past Sunday 07:00", sentTo(OMAR_PHONE).length === 0 && ownerSays("الأحد 07:00").length === 1 && thuTtl >= untilSun, `${thuTtl} vs ${untilSun}`);
  setRiyadh(`${FRI} 11:00`);
  await quiet(() => team.sendDriverRoute(ENV, omarMember(), route(5), 15));
  assert("Friday (day off): queued, a new day → one alert for it", sentTo(OMAR_PHONE).length === 0 && ownerSays("مسار التوصيل").length === 2 && queue(OMAR_PHONE).some((q) => q.buttons?.[0]?.id === "delivered_5"));
  await tap(OMAR_PHONE, `${FRI} 11:05`);
  assert("a tap on Friday: «اليوم ما عندك دوام» + the next shift, nothing released", texts(OMAR_PHONE).at(-1)?.includes("ما عندك دوام") && texts(OMAR_PHONE).at(-1)?.includes("الأحد 07:00") && queue(OMAR_PHONE).length > 0, JSON.stringify(texts(OMAR_PHONE)));

  // a tap after the end of the shift: recorded (late), nothing released
  ENV = fresh(`${MON} 06:00`);
  await tick(`${MON} 07:00`);
  setRiyadh(`${MON} 12:00`);
  await quiet(() => team.sendDriverRoute(ENV, omarMember(), route(6), 16)); // queued: not tapped yet (before)
  await tap(OMAR_PHONE, `${MON} 15:30`);
  assert("tap at 15:30 (shift 07:00–15:00): «متأخر», told the shift ended, the queue stays", attRow(OMAR, MON)?.x_status === "late" && texts(OMAR_PHONE).at(-1)?.includes("دوامك انتهى") && queue(OMAR_PHONE).length > 0, JSON.stringify([attRow(OMAR, MON), texts(OMAR_PHONE).at(-1)]));
  assert("…owner alert says the tasks wait for the next shift", ownerSays("دوامه انتهى فمهامه تصله مع دوامه القادم").length === 1);
  assert("a task held before the tap (12:00) raised no «بعد دوامه» alert", ownerSays("بعد دوامه").length === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 4. Baraa's morning template
console.log("\n[4] Baraa: the fixed OWNER_WINDOW_OPEN_AT (06:00), whatever the team's shifts (STATUS § 32)");
{
  const at = async (day: string, prep?: () => void) => {
    ENV = fresh(`${day} 00:00`, { OWNER_WINDOW_OPEN_AT: "06:00" }); prep?.();
    const out: string[] = [];
    for (let min = 4 * 60; min < 8 * 60; min += 5) {
      const hm = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
      const before = tpl(OWNER).length;
      const r = await tick(`${day} ${hm}`);
      if (tpl(OWNER).length > before) out.push(`${hm}/${r.owner.source}`);
    }
    return out.join();
  };
  const FIXED = "06:00/OWNER_WINDOW_OPEN_AT";
  assert("Sunday: عمر 07:00, خالد 06:30 → 06:00 (not 06:15), once", (await at(SUN)) === FIXED);
  assert("خالد on time off → 06:00 (not 06:45)", (await at(SUN, () => { leave({ resource_id: RES(KHALID), date_from: utc(`${SUN} 00:00`), date_to: utc(`${SUN} 23:59`) }); })) === FIXED);
  assert("Friday (nobody works) → 06:00", (await at(FRI)) === FIXED);
  assert("nobody on attendance → 06:00", (await at(SUN, () => { for (const p of [OMAR, KHALID]) table("hr.employee").get(EMP(p))!.x_utak_attendance = false; })) === FIXED);
  assert("عمر 04:00 (a dawn shift) → still 06:00 (not 03:45)", (await at(SUN, () => { table("hr.employee").get(EMP(OMAR))!.resource_calendar_id = sunThu(4, 12); })) === FIXED);
  assert("Baraa as an employee with a role and an earlier schedule does not move it", (await at(SUN, () => {
    seed("res.partner", { id: 806, name: "Bara.a", x_whatsapp_number: "+" + OWNER });
    employee(806, [71], { x_utak_attendance: true, resource_calendar_id: sunThu(4, 12) });
  })) === FIXED);
}

// ================================================================ 5. routing and roles from hr.employee
console.log("\n[5] routing and roles: hr.employee only");
{
  ENV = fresh(`${SUN} 08:00`);
  const codes = async (role: any) => (await odoo.getTeamMembersByRole(ENV, role)).map((m: any) => `${m.id}/${m.employeeId}`).join();
  // (the harness adds two employees: أحمد 601 warehouse, سالم 602 collector)
  assert("driver / warehouse / collector / admin from «أدوار UTAK», id = Work Contact",
    (await codes("driver")) === `${OMAR}/${EMP(OMAR)}`
    && (await codes("warehouse")).split(",").sort().join() === [`601/${EMP(601)}`, `${OMAR}/${EMP(OMAR)}`].sort().join()
    && (await codes("collector")).split(",").sort().join() === [`602/${EMP(602)}`, `${OMAR}/${EMP(OMAR)}`, `${KHALID}/${EMP(KHALID)}`].sort().join()
    && (await codes("admin")) === `${OTHMAN}/${EMP(OTHMAN)}`, [await codes("driver"), await codes("warehouse"), await codes("collector"), await codes("admin")].join(" | "));
  const drv = (await odoo.getTeamMembersByRole(ENV, "driver"))[0];
  assert("driver's neighborhoods come from the employee («أحياء التوصيل»)", JSON.stringify(drv?.x_neighborhoods) === "[1]");
  // an old partner role without an employee, an archived employee, a number only in «phone»
  seed("res.partner", { id: 830, name: "سواق قديم", x_whatsapp_number: "+966500000830", x_role_ids: [72], customer_rank: 1 });
  seed("res.partner", { id: 831, name: "موظف مؤرشف", x_whatsapp_number: "+966500000831" });
  employee(831, [72], { active: false });
  seed("res.partner", { id: 832, name: "رقم في الهاتف", phone: "+966500000832" });
  employee(832, [73]);
  // an employee whose only role is an archived «Customer» row: not team either
  seed("x_employee_role", { id: 5, x_name: "Customer", x_code: "customer", x_active: false });
  seed("res.partner", { id: 834, name: "دور مؤرشف", x_whatsapp_number: "+966500000834" });
  employee(834, [5]);
  await roster.invalidateRoster(ENV);
  assert("a partner with an old x_role_ids but no employee is not team", (await odoo.findTeamMemberByWhatsApp(ENV, "+966500000830")) === null);
  assert("an employee with only an archived «Customer» role is not team", (await odoo.findTeamMemberByWhatsApp(ENV, "+966500000834")) === null);
  assert("an archived employee is not team", (await odoo.findTeamMemberByWhatsApp(ENV, "+966500000831")) === null);
  assert("the number may be the Work Contact's phone", (await odoo.findTeamMemberByWhatsApp(ENV, "+966500000832"))?.id === 832);
  // the inbound route
  await say(OTHMAN_PHONE, `${SUN} 08:05`, "السلام عليكم", "عثمان");
  assert("عثمان (مدير only, customer_rank 1): the team branch — no welcome, no screening", texts(OTHMAN_PHONE).at(-1)?.includes("مرحبا عثمان عبدالوهاب") && tpl(OTHMAN_PHONE, "utak_welcome").length === 0 && calls.screen === 0, JSON.stringify(texts(OTHMAN_PHONE)));
  await say("966500000830", `${SUN} 08:06`, "مرحبا", "سواق قديم");
  assert("the old-role partner goes the customer way (not «استخدم الأزرار»)", !texts("966500000830").some((t) => t.includes("استخدم الأزرار")));
  // neighborhoods steer the route
  seed("x_neighborhood", { id: 1, x_name: "العليا" });
  seed("x_neighborhood", { id: 2, x_name: "النرجس" });
  seed("res.partner", { id: 833, name: "سواق النرجس", x_whatsapp_number: "+966500000833" });
  employee(833, [72], { x_utak_neighborhood_ids: [2] });
  await roster.invalidateRoster(ENV);
  const o1 = seed("x_daily_order", { x_customer_id: 501, x_delivery_neighborhood: "النرجس", x_state: "in_purchase", x_order_date: SUN });
  const o2 = seed("x_daily_order", { x_customer_id: 502, x_delivery_neighborhood: "العليا", x_state: "in_purchase", x_order_date: SUN });
  for (const o of [o1, o2]) seed("x_daily_order_line", { x_order_id: o, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 2, x_status: "purchased" });
  const routes = await quiet(() => odoo.buildAndCreateRoutesForDrivers(ENV, [o1, o2]));
  const whose = (oid: number) => routes.find((r: any) => r.stops.some((s: any) => s.order_id === oid))?.driver.id;
  assert("an order in النرجس → the driver of النرجس, العليا → عمر (neighborhoods from hr.employee)", whose(o1) === 833 && whose(o2) === OMAR, JSON.stringify(routes.map((r: any) => [r.driver.id, r.stops.map((s: any) => s.order_id)])));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 6. no place reads the old source
console.log("\n[6] the old source is not read: code scan + every Odoo call of this file");
{
  const OLD = /x_role_ids|x_shift_start|["']x_neighborhoods["']|getAttendanceTeam/;
  const hits: string[] = [];
  for (const f of readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts"))) {
    const code = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    code.split("\n").forEach((l, i) => { if (OLD.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 80)}`); });
  }
  assert("src/*.ts: no code reads x_role_ids / x_shift_start / x_neighborhoods", hits.length === 0, hits.join(" | "));
  const bad = odooLog.filter((l) => {
    const s = JSON.stringify(l.body ?? {});
    if (l.model === "res.partner" && /x_role_ids|x_shift_start|x_neighborhoods/.test(s)) return true;
    if (l.model === "x_team_attendance" && /"domain":[^\]]*x_partner_id/.test(s)) return true;
    return false;
  });
  // odooLog is reset by each fresh(): run one full scenario here
  ENV = fresh(`${SUN} 06:00`);
  await tick(`${SUN} 07:00`); await tap(OMAR_PHONE, `${SUN} 07:02`); await say(OMAR_PHONE, `${SUN} 07:10`, "تمام");
  setRiyadh(`${SUN} 16:00`); await quiet(() => team.sendDriverRoute(ENV, omarMember(), route(7), 17));
  await quiet(() => invoice.sendDailyCollectionSummary(ENV));
  await say("966500000877", `${SUN} 16:05`, "مرحبا", "جديد");
  const bad2 = odooLog.filter((l) => {
    const s = JSON.stringify(l.body ?? {});
    return (l.model === "res.partner" && /x_role_ids|x_shift_start|x_neighborhoods/.test(s)) || (l.model === "x_team_attendance" && /"domain".*x_partner_id/.test(s));
  });
  assert("a full day (tick, tap, text, route after the shift, 18:00, a new number): no Odoo call reads the old fields", bad.length === 0 && bad2.length === 0, JSON.stringify([...bad, ...bad2].slice(0, 2)));
}

// ================================================================ 7. one read per 5 minutes, no N+1, the hook
console.log("\n[7] the roster: one read per 5 minutes, no N+1, dropped by the Odoo hook");
{
  ENV = fresh(`${SUN} 06:00`);
  for (let i = 0; i < 8; i++) {
    seed("res.partner", { id: 840 + i, name: `سواق ${i}`, x_whatsapp_number: `+9665000008${40 + i}` });
    employee(840 + i, [72], { x_utak_attendance: true, resource_calendar_id: sunThu(8, 16) });
  }
  const n = (model: string) => odooLog.filter((l) => l.model === model && l.method === "search_read").length;
  await tick(`${SUN} 06:30`);
  await odoo.findTeamMemberByWhatsApp(ENV, "+" + OMAR_PHONE);
  await odoo.getTeamMembersByRole(ENV, "collector");
  await att.attendanceHold(ENV, KHALID, Date.now());
  await tick(`${SUN} 06:34`);
  assert("11 employees, a tick, three lookups, a hold, a second tick in 5 minutes: ONE hr.employee read, one schedule-lines read, one time-off read",
    n("hr.employee") === 1 && n("resource.calendar.attendance") === 1 && n("resource.calendar.leaves") === 1, `${n("hr.employee")}/${n("resource.calendar.attendance")}/${n("resource.calendar.leaves")}`);
  const e = odooLog.find((l) => l.model === "hr.employee" && l.method === "search_read")!;
  assert("…only the fields needed", JSON.stringify(e.body.fields) === JSON.stringify(roster.EMPLOYEE_FIELDS), JSON.stringify(e.body.fields));
  await tick(`${SUN} 06:36`);
  assert("after 5 minutes: read again (the cache is ≤ 5 min)", n("hr.employee") === 2, String(n("hr.employee")));
  const hook = (token: string, body: unknown) => worker.fetch(new Request(`https://w.test/odoo/hook/team-roster?token=${token}`, { method: "POST", body: JSON.stringify(body) }), { ...ENV, ODOO_HOOK_TOKEN: "HOOK" }, ctx);
  assert("hook: a wrong token → 401", (await hook("x", { _model: "hr.employee", _id: 1 })).status === 401);
  assert("hook: another model → 400", (await hook("HOOK", { _model: "res.partner", _id: 1 })).status === 400);
  const ok = await hook("HOOK", { _model: "resource.calendar.leaves", _id: 3 });
  await odoo.findTeamMemberByWhatsApp(ENV, "+" + OMAR_PHONE);
  assert("hook: 202, and the next lookup reads Odoo again (the change is seen at once)", ok.status === 202 && n("hr.employee") === 3, `${ok.status} ${n("hr.employee")}`);
  // a change seen through the hook: a time off added in Odoo
  leave({ resource_id: RES(KHALID), date_from: utc(`${MON} 00:00`), date_to: utc(`${MON} 23:59`) });
  await hook("HOOK", { _model: "resource.calendar.leaves", _id: 99 });
  const r = await tick(`${MON} 06:30`);
  assert("…خالد's new time off applies on the next tick", r.members.find((m: any) => m.partnerId === KHALID)?.action === "leave" && tpl(KHALID_PHONE).length === 1 /* Sunday's only */, JSON.stringify(r.members.find((m: any) => m.partnerId === KHALID)));
}

// ================================================================ 8. «Customer» roles
console.log("\n[8] ensureCustomerRoleId never duplicates; a new partner gets no role");
{
  ENV = fresh(`${SUN} 10:00`);
  seed("x_employee_role", { id: 5, x_name: "Customer", x_code: "customer", x_active: false });
  seed("x_employee_role", { id: 6, x_name: "Customer", x_code: "customer", x_active: false });
  const creates = () => odooLog.filter((l) => l.model === "x_employee_role" && l.method === "create").length;
  const a = [await odoo.ensureCustomerRoleId(ENV), await odoo.ensureCustomerRoleId(ENV), await odoo.ensureCustomerRoleId(ENV)];
  assert("archived «Customer» rows exist: the oldest (5) every time, no new row", a.join() === "5,5,5" && creates() === 0, `${a} / ${creates()}`);
  for (const id of [5, 6]) table("x_employee_role").delete(id);
  const b = [await odoo.ensureCustomerRoleId(ENV), await odoo.ensureCustomerRoleId(ENV)];
  assert("no «customer» row at all: created once, then found", b[0] === b[1] && b[0] !== null && creates() === 1, `${b} / ${creates()}`);
  const before = odooLog.length;
  await say("966500000870", `${SUN} 10:05`, "مرحبا", "زبون جديد");
  const pc = odooLog.slice(before).filter((l) => l.model === "res.partner" && l.method === "create");
  assert("a new WhatsApp number: one partner, «غير مراجَع», no x_role_ids", pc.length === 1 && pc[0].body.vals_list[0].x_contact_class === "unreviewed" && !("x_role_ids" in pc[0].body.vals_list[0]), JSON.stringify(pc.map((l) => l.body)));
  assert("…and no «customer» role lookup or create on the way", !odooLog.slice(before).some((l) => l.model === "x_employee_role" && (l.method === "create" || JSON.stringify(l.body).includes("customer"))));
}

// ================================================================ 9. archived
console.log("\n[9] an archived number: kept, nothing sent, «رقم مؤرشف يطلب» once a day");
{
  ENV = fresh(`${SUN} 10:00`);
  const A = seed("res.partner", { id: 850, name: "مؤرشف قديم", x_whatsapp_number: "+966500000850", phone: "+966500000850", customer_rank: 1, active: false });
  const n0 = rows("res.partner").length;
  SCREEN = { intent: "purchase", reason: "يطلب طماطم" };
  await say("966500000850", `${SUN} 10:01`, "أبغى 3 كراتين طماطم", "مؤرشف قديم");
  await say("966500000850", `${SUN} 10:20`, "وكم سعر الخيار؟", "مؤرشف قديم");
  assert("no new partner, nothing sent to him (no welcome, no reply)", rows("res.partner").length === n0 && sentTo("966500000850").length === 0);
  assert("both messages kept on the archived partner (x_wa_message)", rows("x_wa_message").filter((m: any) => m.x_partner_id === A && m.x_direction === "in").length === 2);
  assert("«طلب أو استفسار شراء» → ONE owner alert «رقم مؤرشف يطلب: مؤرشف قديم» for the day", ownerSays("رقم مؤرشف يطلب: مؤرشف قديم").length === 1, JSON.stringify(ownerSays("مؤرشف")));
  assert("…no review / class field written on the archived partner", !odooLog.some((l) => l.model === "res.partner" && l.method === "write" && l.body.ids?.includes(A) && /x_ai_|x_review_|x_contact_class|active/.test(JSON.stringify(l.body.vals))));
  await say("966500000850", `${MON} 09:00`, "أبغى أطلب", "مؤرشف قديم");
  assert("the next day: one more", ownerSays("رقم مؤرشف يطلب").length === 2);
  SCREEN = { intent: "personal", reason: "سلام" };
  await say("966500000850", `${MON} 11:00`, "كيف الحال", "مؤرشف قديم");
  const calls0 = calls.screen;
  await sendRaw("966500000850", `${MON} 11:05`, { type: "image", image: { id: "M9", mime_type: "image/jpeg" } });
  assert("not a purchase / an image: no alert, the image is not classified, nothing sent", ownerSays("رقم مؤرشف يطلب").length === 2 && calls.screen === calls0 && sentTo("966500000850").length === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 10. personal
console.log("\n[10] a «شخصي» number: kept, nothing sent, no alert");
{
  ENV = fresh(`${SUN} 10:00`);
  // numbers outside the sim allowlist (+9665…), so the «رقم جديد راسل» alert would fire for a stranger
  const P = seed("res.partner", { id: 860, name: "صديق", x_whatsapp_number: "+967700000860", phone: "+967700000860", customer_rank: 1, x_contact_class: "personal" });
  await say("967700000860", `${SUN} 10:01`, "هلا والله", "صديق");
  await say("967700000860", `${SUN} 10:02`, "إيقاف", "صديق");
  await sendRaw("967700000860", `${SUN} 10:03`, { type: "image", image: { id: "M10", mime_type: "image/jpeg" } });
  await sendRaw("967700000860", `${SUN} 10:04`, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "want_order", title: "أبغى أطلب" } } });
  assert("text, «إيقاف», image, button: nothing sent to him", sentTo("967700000860").length === 0, JSON.stringify(sentTo("967700000860")).slice(0, 200));
  assert("…no owner alert at all", sentTo(OWNER).length === 0, JSON.stringify(sentTo(OWNER)).slice(0, 300));
  assert("…kept on his partner", rows("x_wa_message").filter((m: any) => m.x_partner_id === P && m.x_direction === "in").length === 4);
  // «شخصي» with no customer rank: no duplicate partner
  seed("res.partner", { id: 861, name: "قريب", x_whatsapp_number: "+967700000861", customer_rank: 0, x_contact_class: "personal" });
  const n0 = rows("res.partner").length;
  await say("967700000861", `${SUN} 10:10`, "مرحبا", "قريب");
  assert("«شخصي» without a customer rank: no new partner, nothing sent, no alert", rows("res.partner").length === n0 && sentTo("967700000861").length === 0 && sentTo(OWNER).length === 0);
  // control: an unknown number outside the allowlist does raise «رقم جديد راسل»
  await say("967700000862", `${SUN} 10:20`, "مرحبا", "غريب");
  assert("control: a stranger outside the allowlist raises «رقم جديد راسل»", ownerSays("رقم جديد راسل").length === 1);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

console.log(`\nteam-hr: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
