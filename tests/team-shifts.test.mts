// The team's real working schedules, and Baraa's fixed morning time
// (2026-09-25, STATUS § 32).
//
// The schedules exactly as they are in Odoo (scripts/shift-20260925-odoo-setup.mjs):
//   «UTAK — عمر»    Saturday–Thursday 02:00–12:00, Friday no line
//   «UTAK — عثمان»  Saturday–Thursday 06:00–16:00, Friday no line
// both «مشمول بالتحضير», and Baraa's window template at the fixed
// OWNER_WINDOW_OPEN_AT (06:00) — no longer «the earliest shift − 15 min»
// (§ 31), which would have been 01:45 every working day.
//
//   [1] Saturday 26/09, nobody taps: the whole day, minute by minute, exactly;
//   [2] the dawn alerts (02:30 / 03:00) reach Baraa as text inside the 24h
//       window his tap on the previous day's 06:00 template opened; without
//       that tap, as the approved template;
//   [3] Friday 02/10: a weekly day off for both — nothing to them, no row, no
//       absence; a task waits for Saturday 02:00 with ONE owner alert; a tap
//       is answered «اليوم ما عندك دوام…»; Thursday after 12:00 also waits
//       for Saturday 02:00;
//   [4] Saturday 03/10: the tap releases what waited since Friday; عثمان late
//       at +20; a task after 12:00 waits for Sunday 02:00.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind the strict
// schema gate from the tenant's real field lists. No network, no WhatsApp.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/team-shifts.test.mts

import { readFileSync } from "node:fs";
import { closeOwnerWindow, ctx, employee, graph, heldFor, inbound, OWNER, quiet, reset, rows, seed, sentTo, setRiyadh, signed, workSchedule } from "./wa-harness.mts";

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
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ intent: "other", confidence: 0.9 }) }] }), { status: 200 });
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
const worker = (await import("../src/index.ts")).default;

// ---------------------------------------------------------------- data (Riyadh)
const FRI0 = "2026-09-25", SAT1 = "2026-09-26", SUN1 = "2026-09-27", THU = "2026-10-01", FRI = "2026-10-02", SAT2 = "2026-10-03";
const OMAR = 801, OMAR_PHONE = "966500000801";       // warehouse + driver + collector — «UTAK — عمر»
const OTHMAN = 811, OTHMAN_PHONE = "966500000811";   // «مدير» — «UTAK — عثمان»
const OWNER_PID = 806;
const EMP = (pid: number) => 7000 + pid;
const SAT_THU = [5, 6, 0, 1, 2, 3];                  // Odoo weekday: Monday 0 … Sunday 6; Friday (4) has no line
const schedule = (from: number, to: number, name: string) => workSchedule(SAT_THU.map((d) => [d, from, to] as [number, number, number]), { name });
const SHIFT_TPL = "utak_shift_start_v2";
let ENV: any;

function fresh(riyadh = `${SAT1} 00:00`, extra: Record<string, unknown> = {}): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0;
  Object.assign(env, { OWNER_WINDOW_OPEN_AT: "06:00" }, extra);   // [env.sim.vars] as committed
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  seed("x_employee_role", { id: 74, x_code: "admin" });
  seed("res.partner", { id: OMAR, name: "عمر المجهلي", x_whatsapp_number: "+" + OMAR_PHONE });
  seed("res.partner", { id: OTHMAN, name: "عثمان عبدالوهاب", x_whatsapp_number: "+" + OTHMAN_PHONE });
  // as in Odoo (partner 45): the only active partner on his number, customer_rank 1 — so his
  // tap lands on it, and the owner-alert window check reads the same partner.
  seed("res.partner", { id: OWNER_PID, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER, phone: "+" + OWNER, customer_rank: 1 });
  employee(OMAR, [71, 72, 73], { x_utak_attendance: true, resource_calendar_id: schedule(2, 12, "UTAK — عمر"), x_utak_neighborhood_ids: [1] });
  employee(OTHMAN, [74], { x_utak_attendance: true, resource_calendar_id: schedule(6, 16, "UTAK — عثمان") });
  seed("res.partner", { name: "UTAK بوت" });
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: SHIFT_TPL, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "driver_dispatch", x_meta_template_id: "utak_driver_dispatch", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 4, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "driver_stop", x_meta_template_id: "utak_driver_stop", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 5, x_category: "UTILITY" });
  return env;
}
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
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
const WHO: Record<string, string> = { [OMAR_PHONE]: "عمر", [OTHMAN_PHONE]: "عثمان", [OWNER]: "براء" };
const describe = (b: any): string => {
  if (b?.type === "template") {
    const p = (b.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((x: any) => x.text) ?? [];
    return b.template.name === "utak_owner_alert" ? `تنبيه(قالب): ${String(p.join(" ")).slice(0, 40)}` : `${b.template.name} [${p.join(" | ")}]`;
  }
  if (b?.type === "text") return `نص: ${String(b.text?.body ?? "").slice(0, 40)}`;
  return String(b?.type);
};
/** Tick every 5 minutes over [from, to) of `day`; each new send as «HH:MM who: what». */
async function day(d: string, from = 0, to = 24 * 60): Promise<string[]> {
  const out: string[] = [];
  for (let min = from; min < to; min += 5) {
    const n = graph.length;
    await tick(`${d} ${hm(min)}`);
    for (const b of graph.slice(n)) out.push(`${hm(min)} ${WHO[b?.to] ?? b?.to}: ${describe(b)}`);
  }
  return out;
}
const omarMember = () => ({ id: OMAR, employeeId: EMP(OMAR), name: "عمر المجهلي", x_whatsapp_number: "+" + OMAR_PHONE, x_role: "driver", x_role_codes: ["warehouse", "driver", "collector"] } as any);
const route = (id: number) => [{ order_id: id, customer_name: "مطعم الوادي", neighborhood: "العليا", latitude: 24.7, longitude: 46.6, line_summary: "طماطم × 3" }] as any;

// ================================================================ 1. Saturday 26/09, nobody taps
console.log("\n[1] Saturday 26/09 — عمر 02:00–12:00, عثمان 06:00–16:00, Baraa 06:00, nobody taps");
{
  ENV = fresh(`${SAT1} 00:00`);
  const t = await day(SAT1);
  const at = (s: string) => t.filter((x) => x.startsWith(s + " "));
  assert("nothing before 02:00 (no 01:45 window template, the § 31 rule)", t.every((x) => x >= "02:00"), t.join(" / "));
  assert("02:00 عمر: utak_shift_start_v2 [عمر المجهلي], alone", JSON.stringify(at("02:00")) === JSON.stringify(["02:00 عمر: utak_shift_start_v2 [عمر المجهلي]"]), JSON.stringify(at("02:00")));
  assert("02:30 عمر: the reminder (same template), and one alert to Baraa «عمر المجهلي لم يسجّل حضوره: دوامه 02:00»",
    at("02:30").length === 2 && at("02:30")[0] === "02:30 عمر: utak_shift_start_v2 [عمر المجهلي]" && at("02:30")[1].includes("براء") && ownerSays("عمر المجهلي لم يسجّل حضوره: دوامه 02:00").length === 1, JSON.stringify(at("02:30")));
  assert("03:00: one alert «عمر المجهلي سُجّل غائباً … (02:00)», nothing to عمر", at("03:00").length === 1 && ownerSays("عمر المجهلي سُجّل غائباً").length === 1 && ownerSays("(02:00)").length >= 1, JSON.stringify(at("03:00")));
  assert("06:00: Baraa's window template [براء] and عثمان's [عثمان عبدالوهاب], once each",
    at("06:00").includes("06:00 براء: utak_shift_start_v2 [براء]") && at("06:00").includes("06:00 عثمان: utak_shift_start_v2 [عثمان عبدالوهاب]") && at("06:00").length === 2, JSON.stringify(at("06:00")));
  assert("06:30 عثمان: the reminder, and one alert «عثمان عبدالوهاب لم يسجّل حضوره: دوامه 06:00»",
    at("06:30").length === 2 && at("06:30").includes("06:30 عثمان: utak_shift_start_v2 [عثمان عبدالوهاب]") && ownerSays("عثمان عبدالوهاب لم يسجّل حضوره: دوامه 06:00").length === 1, JSON.stringify(at("06:30")));
  assert("07:00: one alert «عثمان عبدالوهاب سُجّل غائباً»", at("07:00").length === 1 && ownerSays("عثمان عبدالوهاب سُجّل غائباً").length === 1, JSON.stringify(at("07:00")));
  assert("the whole day: exactly those 9 sends, nothing after 07:00", t.length === 9 && t.every((x) => x.slice(0, 5) <= "07:00"), t.join(" / "));
  assert("x_team_attendance: عمر absent, shift 02:00 (23:00 UTC the day before), reminder sent", attRow(OMAR, SAT1)?.x_status === "absent" && attRow(OMAR, SAT1)?.x_shift_at === "2026-09-25 23:00:00" && attRow(OMAR, SAT1)?.x_reminder_sent === true, JSON.stringify(attRow(OMAR, SAT1)));
  assert("x_team_attendance: عثمان absent, shift 06:00 (03:00 UTC)", attRow(OTHMAN, SAT1)?.x_status === "absent" && attRow(OTHMAN, SAT1)?.x_shift_at === "2026-09-26 03:00:00", JSON.stringify(attRow(OTHMAN, SAT1)));
  assert("no row and nothing for Baraa himself", !rows("x_team_attendance").some((r) => r.x_partner_id === OWNER_PID));
  const rep = await tick(`${SAT1} 12:00`);
  assert("the tick reports Baraa at 06:00 from OWNER_WINDOW_OPEN_AT", rep.owner.at === "06:00" && rep.owner.source === "OWNER_WINDOW_OPEN_AT", JSON.stringify(rep.owner));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 2. the dawn alerts and Baraa's window
console.log("\n[2] the dawn alerts reach Baraa as text inside the window his 06:00 tap opened the day before");
{
  // (a) he taps Friday's 06:00 template at 06:03 → the window lasts until Saturday 06:03
  //     (STATUS § 33: less the 10-minute margin — until 05:53)
  ENV = fresh(`${FRI0} 05:55`);
  closeOwnerWindow(ENV); // the harness opens it by default; here only his tap opens it
  await tick(`${FRI0} 05:55`);
  await tick(`${FRI0} 06:00`);
  assert("Friday 25/09 06:00: his window template (Friday is a day off for the team, Baraa still gets it)", tpl(OWNER).length === 1 && tpl(OMAR_PHONE).length === 0 && tpl(OTHMAN_PHONE).length === 0);
  await tap(OWNER, `${FRI0} 06:03`);
  assert("his tap: «✅ تم…», nothing recorded, no new partner for his number", (texts(OWNER).at(-1) ?? "").startsWith("✅ تم. تنبيهات يو تاك") && rows("x_team_attendance").length === 0
    && rows("res.partner").filter((r) => r.x_whatsapp_number === "+" + OWNER).length === 1);
  const n = sentTo(OWNER).length;
  for (const a of ["02:00", "02:30", "03:00"]) await tick(`${SAT1} ${a}`);
  const dawn = sentTo(OWNER).slice(n);
  assert("Saturday 02:30 and 03:00: two alerts, both as session text (inside the window, no marketing template)",
    dawn.length === 2 && dawn.every((b) => b.type === "text") && String(dawn[0].text?.body).includes("لم يسجّل حضوره") && String(dawn[1].text?.body).includes("سُجّل غائباً"), JSON.stringify(dawn.map(describe)));
  // (b) Saturday: the 06:00 template again, and a tap at 06:01 covers عثمان's 06:30 / 07:00 alerts too
  for (const a of ["05:55", "06:00"]) await tick(`${SAT1} ${a}`);
  assert("Saturday 06:00: his template again (once)", tpl(OWNER).length === 2);
  await tap(OWNER, `${SAT1} 06:01`);
  const m = sentTo(OWNER).length;
  for (const a of ["06:30", "07:00"]) await tick(`${SAT1} ${a}`);
  const morning = sentTo(OWNER).slice(m);
  assert("Saturday 06:30 and 07:00 (عثمان): text as well", morning.length === 2 && morning.every((b) => b.type === "text"), JSON.stringify(morning.map(describe)));
  // (c) no tap the day before → STATUS § 33: the dawn alerts wait for him (the
  //     MARKETING utak_owner_alert is never used), and his 06:00 tap brings them
  ENV = fresh(`${SAT1} 01:55`);
  closeOwnerWindow(ENV);
  for (const a of ["01:55", "02:00", "02:30", "03:00"]) await tick(`${SAT1} ${a}`);
  const cold = sentTo(OWNER);
  assert("without the tap: nothing to him at dawn — no utak_owner_alert, no free text Meta would drop",
    cold.length === 0, JSON.stringify(cold.map(describe)));
  const waiting = heldFor(ENV, OWNER);
  assert("…the two dawn alerts are held for him, in order", waiting.length === 2 && String(waiting[0].body?.text?.body).includes("لم يسجّل حضوره") && String(waiting[1].body?.text?.body).includes("سُجّل غائباً"), JSON.stringify(waiting.map((w: any) => w.body?.text?.body)));
  for (const a of ["05:55", "06:00"]) await tick(`${SAT1} ${a}`);
  await tap(OWNER, `${SAT1} 06:02`);
  const after = sentTo(OWNER).filter((b) => b.type === "text").map((b) => String(b.text?.body));
  assert("his 06:00 tap: the two held alerts first (oldest first), then «✅ تم»",
    after.length === 3 && after[0].includes("لم يسجّل حضوره") && after[1].includes("سُجّل غائباً") && after[2].startsWith("✅ تم"), JSON.stringify(after));
  assert("…and his queue is empty", heldFor(ENV, OWNER).length === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ 3. Friday 02/10 (and Thursday 01/10 after 12:00)
console.log("\n[3] Friday 02/10: a weekly day off for both; tasks wait for Saturday 02:00");
{
  ENV = fresh(`${THU} 11:55`);
  const h0 = await quiet(() => att.holdForTask(ENV, OMAR, { kind: "probe", label: "مهمة الخميس" }, Date.parse(`${THU}T11:55:00+03:00`)));
  assert("Thursday 11:55 (inside the shift, not tapped): held «before», no alert", h0.hold && h0.phase === "before" && ownerSays("بعد دوامه").length === 0, JSON.stringify(h0));
  setRiyadh(`${THU} 13:00`);
  const h1 = await quiet(() => att.holdForTask(ENV, OMAR, { kind: "probe", label: "مهمة الخميس" }));
  assert("Thursday 13:00 (after 12:00): held «after», next shift «السبت 02:00» (Friday skipped), one alert",
    h1.hold && h1.phase === "after" && h1.next === "السبت 02:00" && ownerSays("مهمة لـعمر المجهلي بعد دوامه: مهمة الخميس").length === 1 && ownerSays("(السبت 02:00)").length === 1, JSON.stringify(h1));
  const t = await day(FRI);
  assert("Friday: nothing to عمر or عثمان all day, no attendance row, no absence alert",
    tpl(OMAR_PHONE).length === 0 && tpl(OTHMAN_PHONE).length === 0 && !rows("x_team_attendance").some((r) => r.x_date === FRI) && ownerSays("غائباً").length === 0, t.join(" / "));
  assert("Friday: Baraa's window template at 06:00, the only send of the day", JSON.stringify(t) === JSON.stringify(["06:00 براء: utak_shift_start_v2 [براء]"]), t.join(" / "));
  const rep = await tick(`${FRI} 12:00`);
  assert("the tick reports both «day_off»", rep.members.filter((m: any) => m.partnerId === OMAR || m.partnerId === OTHMAN).every((m: any) => m.action === "day_off"), JSON.stringify(rep.members));
  // a route for عمر on Friday 10:00: queued with its stops, one alert with the next shift
  setRiyadh(`${FRI} 10:00`);
  await quiet(() => team.sendDriverRoute(ENV, omarMember(), route(3), 13));
  assert("Friday 10:00 route: not sent to عمر, queued (with the stop's button)", sentTo(OMAR_PHONE).length === 0 && queue(OMAR_PHONE).some((q) => q.buttons?.[0]?.id === "delivered_3"), JSON.stringify(queue(OMAR_PHONE)));
  assert("…one alert «مهمة لـعمر المجهلي بعد دوامه: مسار التوصيل … (السبت 02:00)»", ownerSays("مهمة لـعمر المجهلي بعد دوامه: مسار التوصيل").length === 1 && ownerSays("(السبت 02:00)").length === 2);
  await tap(OMAR_PHONE, `${FRI} 10:05`);
  assert("his tap on Friday: «اليوم ما عندك دوام حسب جدولك… (السبت 02:00)», no row, the queue stays",
    (texts(OMAR_PHONE).at(-1) ?? "").includes("ما عندك دوام") && (texts(OMAR_PHONE).at(-1) ?? "").includes("السبت 02:00") && !rows("x_team_attendance").some((r) => r.x_date === FRI) && queue(OMAR_PHONE).length > 0, JSON.stringify(texts(OMAR_PHONE)));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));

  // ============================================================== 4. Saturday 03/10
  console.log("\n[4] Saturday 03/10: the tap releases what waited; عثمان late at +20; after 12:00 waits for Sunday 02:00");
  const s = await day(SAT2, 0, 2 * 60 + 5);
  assert("Saturday 02:00: عمر's template", s.includes("02:00 عمر: utak_shift_start_v2 [عمر المجهلي]"), s.join(" / "));
  const before = sentTo(OMAR_PHONE).length;
  await tap(OMAR_PHONE, `${SAT2} 02:10`);
  assert("tap 02:10 (+10): «حاضر»", attRow(OMAR, SAT2)?.x_status === "present" && attRow(OMAR, SAT2)?.x_tapped_at === "2026-10-02 23:10:00", JSON.stringify(attRow(OMAR, SAT2)));
  const after = sentTo(OMAR_PHONE).slice(before);
  assert("…Friday's route reaches him now (the stop and its «delivered_3» button), the queue is empty",
    JSON.stringify(after).includes("مطعم الوادي") && JSON.stringify(after).includes("delivered_3") && queue(OMAR_PHONE).length === 0, JSON.stringify(after.map(describe)));
  const s2 = await day(SAT2, 2 * 60 + 5, 6 * 60 + 5);
  assert("no reminder or absence for عمر after his tap", !s2.some((x) => x.includes("عمر: utak_shift_start_v2")) && ownerSays("عمر المجهلي لم يسجّل").length === 0, s2.join(" / "));
  assert("06:00: Baraa's template and عثمان's", s2.includes("06:00 براء: utak_shift_start_v2 [براء]") && s2.includes("06:00 عثمان: utak_shift_start_v2 [عثمان عبدالوهاب]"), s2.join(" / "));
  await tap(OTHMAN_PHONE, `${SAT2} 06:20`);
  assert("عثمان taps 06:20 (+20): «متأخر», then «ما عندك مهام الآن» (مدير: no role tasks)",
    attRow(OTHMAN, SAT2)?.x_status === "late" && texts(OTHMAN_PHONE).some((x) => x.includes("متأخر")) && texts(OTHMAN_PHONE).some((x) => x.includes("ما عندك مهام الآن")), JSON.stringify(texts(OTHMAN_PHONE)));
  setRiyadh(`${SAT2} 12:30`);
  const h2 = await quiet(() => att.holdForTask(ENV, OMAR, { kind: "probe2", label: "مهمة السبت" }));
  assert("Saturday 12:30 (after 12:00): held «after», next «الأحد 02:00», one alert", h2.hold && h2.phase === "after" && h2.next === "الأحد 02:00" && ownerSays("مهمة لـعمر المجهلي بعد دوامه: مهمة السبت").length === 1, JSON.stringify(h2));
  const s3 = await day(SAT2, 6 * 60 + 5, 24 * 60);
  assert("the rest of Saturday: nothing more from the tick", s3.length === 0, s3.join(" / "));
  const sunday = await day(SUN1 === "2026-09-27" ? "2026-10-04" : SUN1, 0, 2 * 60 + 5);
  assert("Sunday 04/10 02:00: عمر's template again (a new day)", sunday.includes("02:00 عمر: utak_shift_start_v2 [عمر المجهلي]"), sunday.join(" / "));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

console.log(`\nteam-shifts: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
