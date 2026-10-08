// § 68 (2026-10-08) — the attendance record: the entry and the exit from WhatsApp, the minutes late, the
// absence after two hours, the time off's row, and the trial on Baraa's own card.
//
//   [ح1] the words: «بدأت الدوام» / «انتهى دوامي» — the whole message, any spelling of theirs
//   [ح2] the entry of a member on attendance: the words are the tap; «حاضر» / «متأخر» with its minutes; from WhatsApp
//   [ح3] the exit: the button under the entry's answer, or the words — once, on the open entry alone
//   [ح4] the place (optional): kept with the entry or the exit when it comes in the quarter of an hour after it
//   [ح5] a work day with no entry two hours after its start: «غائب», ONE alert for all — never while frozen
//   [ح6] a day of time off: its row «إجازة», once, nothing sent
//   [ح7] a member who is not on attendance: his entry is recorded all the same — late by his schedule, else the company's
//   [ح8] Baraa: nothing of his is recorded
//   [ح9] the trial: a simulation row on Baraa's card, to his number alone; it enters no figure
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s68-attendance.test.mts

import { OWNER, ctx, employee, graph, inbound, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table, workSchedule } from "./wa-harness.mts";
import { ALL_WEEK, DAY, DRIVER, DRIVER_PHONE, assert, done, fresh, rejected } from "./s46-kit.mts";

const worker = (await import("../src/index.ts")).default;
const ATT = await import("../src/attendance.ts");
const TR = await import("../src/s68-trial.ts");
const FZ = await import("../src/freeze.ts");
const OA = await import("../src/owner-alerts.ts");
const EF = await import("../src/employee-file.ts");

const HOOK = "s68-hook-secret-0123456789abcdef0123456789abcdef";
const NEXT = "2026-10-04", PREV = "2026-10-02";
const KHALID = 811, KHALID_PHONE = "966500000811";   // a collector on attendance, 06:00–14:00
const SAEED = 812, SAEED_PHONE = "966500000812";     // a driver on attendance, the same hours
const NOCAL = 813, NOCAL_PHONE = "966500000813";     // a buyer with no schedule and no attendance
const OWNER_PID = 45;
const EMP = (pid: number) => 7000 + pid;
const SHIFT_TPL = "utak_shift_start_v2";
const WEEK: Array<[number, number, number]> = [0, 1, 2, 3, 4, 5, 6].map((d) => [d, 6, 14]);
const cfg = () => table("x_pricing_config").get(1) as any;
const utc = (riyadh: string): string => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);

let ENV: any;
/** The tenant's world: عمر (a driver, NOT on attendance, 02:00–12:00), خالد and سعيد on attendance 06:00–14:00, Baraa with the three roles. */
function world(riyadh: string, o: { companyDays?: boolean } = {}): any {
  const env = fresh(riyadh);
  env.HOOK_SECRET = HOOK;
  const cal = workSchedule(WEEK, { name: "06–14" });
  seed("res.partner", { id: KHALID, name: "خالد", x_whatsapp_number: "+" + KHALID_PHONE });
  seed("res.partner", { id: SAEED, name: "سعيد", x_whatsapp_number: "+" + SAEED_PHONE });
  seed("res.partner", { id: NOCAL, name: "ماجد", x_whatsapp_number: "+" + NOCAL_PHONE });
  seed("res.partner", { id: OWNER_PID, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER });
  employee(KHALID, [73], { x_utak_attendance: true, resource_calendar_id: cal });
  employee(SAEED, [72], { x_utak_attendance: true, resource_calendar_id: cal });
  employee(NOCAL, [71], { x_utak_attendance: false, resource_calendar_id: false });
  const mine = workSchedule(ALL_WEEK, { name: "UTAK — أيام العمل" });
  employee(OWNER_PID, [71, 72, 73], { name: "براء", x_utak_attendance: true, resource_calendar_id: mine });
  if (o.companyDays) cfg().x_workdays_calendar_id = mine;
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: SHIFT_TPL, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  ENV = env;
  return env;
}
const tick = async (at: string) => { setRiyadh(at); return quiet(() => ATT.runAttendanceTick(ENV)); };
const send = (from: string, at: string, m: Record<string, unknown>) => { setRiyadh(at); return quiet(() => worker.fetch(signed(inbound(from, m)), ENV, ctx)); };
const say = (from: string, at: string, text: string) => send(from, at, { type: "text", text: { body: text } });
const press = (from: string, at: string, id: string) => send(from, at, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } });
const tapTemplate = (from: string, at: string) => send(from, at, { type: "button", button: { payload: "shift_start", text: "بدء الدوام" } });
const place = (from: string, at: string, latitude = 24.71, longitude = 46.67) => send(from, at, { type: "location", location: { latitude, longitude } });
const tpl = (digits: string) => sentTo(digits).filter((b) => b?.template?.name === SHIFT_TPL);
const body = (b: any): string => String(b?.text?.body ?? b?.interactive?.body?.text ?? "");
const buttons = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => `${x.reply?.id}|${x.reply?.title}`);
const last = (digits: string) => sentTo(digits).at(-1);
const said = (digits: string) => sentTo(digits).map(body);
const real = () => (rows("x_team_attendance") as any[]).filter((r) => r.x_utak_simulation !== true);
const row = (pid: number, day = DAY) => real().find((r) => r.x_employee_id === EMP(pid) && r.x_date === day);
const ownerSays = (needle: string) => sentTo(OWNER).filter((b) => body(b).includes(needle));

// ================================================================ ح1
console.log("\n[ح1] the words");
{
  for (const t of ["بدأت الدوام", "✅ بدأت الدوام", "بدات الدوام", "بَدَأْتُ الدَّوَام", "بدء الدوام", "  بدأت   الدوام. ", "بدأت دوامي", "بداية الدوام", "سجل حضوري"]) assert(`«${t}» is the entry`, ATT.shiftInCommand(t) && !ATT.shiftOutCommand(t));
  for (const t of ["انتهى دوامي", "🏁 انتهى دوامي", "انتهي دوامي", "انتهى الدوام", "نهاية الدوام", "خلصت دوامي", "تسجيل خروج"]) assert(`«${t}» is the exit`, ATT.shiftOutCommand(t) && !ATT.shiftInCommand(t));
  for (const t of ["بدأت الدوام يا شباب", "الدوام", "متى بدء الدوام؟ الساعة كم", "حمولة", "نهاية الحمولة", "انتهى", "انتهى دوامي بدري اليوم", "متى انتهى الدوام أمس", "خلاص", "", "عهدة"]) assert(`«${t}» is neither (only the whole message counts)`, !ATT.shiftInCommand(t) && !ATT.shiftOutCommand(t));
  assert("the minutes late: 0 up to a quarter of an hour, the whole minutes after it", ATT.lateMinutes(15 * 60_000, 0) === 0 && ATT.lateMinutes(16 * 60_000, 0) === 16 && ATT.lateMinutes(16 * 60_000 + 59_000, 0) === 16 && ATT.lateMinutes(-5 * 60_000, 0) === 0);
  assert("«غائب» is two hours after the start", ATT.ABSENT_AFTER_MIN === 120 && ATT.LATE_AFTER_MIN === 15 && ATT.REMIND_AFTER_MIN === 30);
  assert("the titles of the two buttons", ATT.SHIFT_START_TITLE === "✅ بدأت الدوام" && ATT.SHIFT_END_TITLE === "🏁 انتهى دوامي" && ATT.shiftEndButton().id === "shift_end" && ATT.shiftStartButton().id === "shift_start");
}

// ================================================================ ح2
console.log("\n[ح2] the entry of a member on attendance");
{
  world(`${DAY} 05:00`);
  await say(KHALID_PHONE, `${DAY} 05:50`, "بدأت الدوام");
  assert("before today's «بدء الدوام» went: «دوامك اليوم يبدأ 06:00», nothing recorded", body(last(KHALID_PHONE)).includes("دوامك اليوم يبدأ 06:00") && !row(KHALID), JSON.stringify(said(KHALID_PHONE)));
  await tick(`${DAY} 06:00`);
  assert("06:00: his «بدء الدوام» (the template of before, its button unchanged)", tpl(KHALID_PHONE).length === 1 && row(KHALID)?.x_sent_at && !row(KHALID).x_tapped_at);
  await say(KHALID_PHONE, `${DAY} 06:05`, "صباح الخير");
  assert("a word before the entry: «اضغط بدء الدوام», with the button «✅ بدأت الدوام»", body(last(KHALID_PHONE)).includes("اضغط «بدء الدوام»") && buttons(last(KHALID_PHONE)).join() === "shift_start|✅ بدأت الدوام", JSON.stringify(last(KHALID_PHONE)));
  const n = sentTo(KHALID_PHONE).length;
  await say(KHALID_PHONE, `${DAY} 06:20`, "بدأت الدوام");
  const r = row(KHALID);
  assert("«بدأت الدوام» at 06:20 is the tap: «متأخر», 20 minutes, from WhatsApp, the entry at 06:20", r.x_status === "late" && r.x_late_min === 20 && r.x_source === "whatsapp" && r.x_tapped_at === utc(`${DAY} 06:20`), JSON.stringify(r));
  const answer = sentTo(KHALID_PHONE)[n];
  assert("the answer: «تم تسجيل حضورك الساعة 06:20 ✅ (متأخر، دوامك 06:00)», how to end the shift, and «🏁 انتهى دوامي» under it", body(answer).includes("تم تسجيل حضورك الساعة 06:20 ✅ (متأخر، دوامك 06:00)") && body(answer).includes(ATT.ENTRY_HINT) && buttons(answer).join() === "shift_end|🏁 انتهى دوامي", JSON.stringify(answer));
  assert("…then his tasks (none: «ما عندك مهام الآن»)", said(KHALID_PHONE).includes(ATT.NO_TASKS_TEXT));
  const m = sentTo(KHALID_PHONE).length;
  await say(KHALID_PHONE, `${DAY} 06:30`, "بدأت الدوام");
  assert("the words again: «دوامك اليوم مسجّل من 06:20», the row as it was", body(sentTo(KHALID_PHONE)[m]).includes("دوامك اليوم مسجّل من 06:20") && row(KHALID).x_tapped_at === utc(`${DAY} 06:20`) && real().filter((x) => x.x_employee_id === EMP(KHALID)).length === 1);
  // the session button of the hint, and the template's own
  world(`${DAY} 06:00`);
  await tick(`${DAY} 06:00`);
  await press(KHALID_PHONE, `${DAY} 06:10`, "shift_start");
  assert("«✅ بدأت الدوام» (the session button) at 06:10: «حاضر», 0 minutes", row(KHALID).x_status === "present" && row(KHALID).x_late_min === 0 && row(KHALID).x_source === "whatsapp");
  await tapTemplate(SAEED_PHONE, `${DAY} 06:15`);
  assert("the template's own «بدء الدوام» at 06:15: «حاضر» still (a quarter of an hour)", row(SAEED).x_status === "present" && row(SAEED).x_late_min === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ح3
console.log("\n[ح3] the exit");
{
  world(`${DAY} 06:00`);
  await tick(`${DAY} 06:00`);
  await say(KHALID_PHONE, `${DAY} 06:20`, "بدأت الدوام");
  const n = sentTo(KHALID_PHONE).length;
  await press(KHALID_PHONE, `${DAY} 14:05`, "shift_end");
  assert("«🏁 انتهى دوامي» at 14:05: the exit on his row", row(KHALID).x_out_at === utc(`${DAY} 14:05`) && row(KHALID).x_status === "late", JSON.stringify(row(KHALID)));
  assert("the answer: «تم تسجيل خروجك الساعة 14:05 ✅ — مدة دوامك 7 س 45 د.», and the place is welcome", body(sentTo(KHALID_PHONE)[n]) === `تم تسجيل خروجك الساعة 14:05 ✅ — مدة دوامك 7 س 45 د.\n${ATT.EXIT_HINT}` && sentTo(KHALID_PHONE).length === n + 1, JSON.stringify(said(KHALID_PHONE).slice(n)));
  await say(KHALID_PHONE, `${DAY} 14:30`, "انتهى دوامي");
  assert("again (the words): «خروجك مسجّل من 14:05», the exit as it was", body(last(KHALID_PHONE)) === "خروجك مسجّل من 14:05 ✅" && row(KHALID).x_out_at === utc(`${DAY} 14:05`));
  assert("nothing about it reaches Baraa", sentTo(OWNER).length === 0, JSON.stringify(sentTo(OWNER).map(body)));
  // no entry
  await say(SAEED_PHONE, `${DAY} 14:40`, "انتهى دوامي");
  assert("an exit with no entry: «ما عندك دخول مسجّل اليوم», nothing written", body(last(SAEED_PHONE)) === ATT.NO_ENTRY_TEXT && !row(SAEED)?.x_out_at && !row(SAEED)?.x_tapped_at);
  // a shift past midnight: yesterday's entry is still open
  world(`${DAY} 05:00`);
  seed("x_team_attendance", { x_name: "x", x_employee_id: EMP(KHALID), x_partner_id: KHALID, x_date: PREV, x_shift_at: utc(`${PREV} 22:00`), x_sent_at: utc(`${PREV} 22:00`), x_tapped_at: utc(`${PREV} 22:03`), x_status: "present", x_reminder_sent: false });
  await say(KHALID_PHONE, `${DAY} 05:10`, "انتهى دوامي");
  assert("yesterday's entry (22:03) still open at 05:10: the exit closes IT", row(KHALID, PREV).x_out_at === utc(`${DAY} 05:10`) && body(last(KHALID_PHONE)).includes("مدة دوامك 7 س 7 د") && !row(KHALID, DAY), JSON.stringify(row(KHALID, PREV)));
  world(`${DAY} 17:00`);
  seed("x_team_attendance", { x_name: "x", x_employee_id: EMP(KHALID), x_partner_id: KHALID, x_date: PREV, x_shift_at: utc(`${PREV} 06:00`), x_sent_at: utc(`${PREV} 06:00`), x_tapped_at: utc(`${PREV} 06:03`), x_status: "present", x_reminder_sent: false });
  await say(KHALID_PHONE, `${DAY} 17:10`, "انتهى دوامي");
  assert("an entry of yesterday morning (35 hours ago) is not closed today", !row(KHALID, PREV).x_out_at && body(last(KHALID_PHONE)) === ATT.NO_ENTRY_TEXT);
  // a simulation row is nobody's entry
  world(`${DAY} 09:00`);
  const simRow = seed("x_team_attendance", { x_name: "x", x_employee_id: EMP(KHALID), x_partner_id: KHALID, x_date: DAY, x_tapped_at: utc(`${DAY} 06:00`), x_status: "present", x_reminder_sent: false, x_utak_simulation: true });
  await say(KHALID_PHONE, `${DAY} 09:10`, "انتهى دوامي");
  assert("a simulation row is not an entry: no exit is written on it", !(table("x_team_attendance").get(simRow) as any).x_out_at && body(last(KHALID_PHONE)) === ATT.NO_ENTRY_TEXT);
  assert("the hours of an exit: 598 minutes read «9 س 58 د»", ATT.durationAr(598) === "9 س 58 د" && ATT.durationAr(45) === "0 س 45 د");
  // two exits at once
  world(`${DAY} 06:00`);
  await tick(`${DAY} 06:00`);
  await say(KHALID_PHONE, `${DAY} 06:01`, "بدأت الدوام");
  setRiyadh(`${DAY} 14:00`);
  const at = Date.now();
  const both = await quiet(() => Promise.all([ATT.recordShiftEnd(ENV, KHALID, at), ATT.recordShiftEnd(ENV, KHALID, at + 60_000)]));
  assert("two exits at once: one is written, the other is told «مسجّل»", both.filter((b: any) => b.kind === "done").length === 1 && both.filter((b: any) => b.kind === "again").length === 1, JSON.stringify(both.map((b: any) => b.kind)));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ح4
console.log("\n[ح4] the place");
{
  world(`${DAY} 06:00`);
  await tick(`${DAY} 06:00`);
  await say(KHALID_PHONE, `${DAY} 06:02`, "بدأت الدوام");
  await place(KHALID_PHONE, `${DAY} 06:10`, 24.7136, 46.6753);
  assert("a place 8 minutes after the entry: kept with it as a map link, and he is told", row(KHALID).x_in_map === "https://maps.google.com/?q=24.7136,46.6753" && body(last(KHALID_PHONE)) === ATT.placeSavedText("in") && !row(KHALID).x_out_map, JSON.stringify(row(KHALID)));
  const n = sentTo(KHALID_PHONE).length;
  await place(KHALID_PHONE, `${DAY} 06:12`, 25, 47);
  assert("a second place: not kept again (the entry's place stays), no «حُفظ»", row(KHALID).x_in_map === "https://maps.google.com/?q=24.7136,46.6753" && !sentTo(KHALID_PHONE).slice(n).some((b) => body(b).includes("حُفظ موقع")));
  await press(KHALID_PHONE, `${DAY} 14:00`, "shift_end");
  await place(KHALID_PHONE, `${DAY} 14:14`, 24.5, 46.5);
  assert("a place 14 minutes after the exit: kept with the exit", row(KHALID).x_out_map === "https://maps.google.com/?q=24.5,46.5" && body(last(KHALID_PHONE)) === ATT.placeSavedText("out"));
  // too late
  world(`${DAY} 06:00`);
  await tick(`${DAY} 06:00`);
  await say(SAEED_PHONE, `${DAY} 06:02`, "بدأت الدوام");
  await place(SAEED_PHONE, `${DAY} 06:18`, 24.7, 46.6);
  assert("a place 16 minutes after the entry: not kept (the quarter of an hour passed)", !row(SAEED).x_in_map && !said(SAEED_PHONE).some((t) => t.includes("حُفظ موقع")));
  setRiyadh(`${DAY} 09:00`);
  assert("a place with no entry before it: nothing", (await quiet(() => ATT.saveShiftPlace(ENV, KHALID_PHONE, { latitude: 1, longitude: 2 }))) === null);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ح5
console.log("\n[ح5] «غائب» after two hours — one alert, never while frozen");
{
  OA.setOwnerAlertShapingForTests(true);
  world(`${DAY} 06:00`);
  await tick(`${DAY} 06:00`);
  await tick(`${DAY} 06:30`);
  const reminded = sentTo(OWNER).length;
  for (const at of ["07:00", "07:30", "07:55"]) await tick(`${DAY} ${at}`);
  assert("+60 … +115: nobody is «غائب», nothing more is sent", !row(KHALID).x_status && !row(SAEED).x_status && sentTo(OWNER).length === reminded && tpl(KHALID_PHONE).length === 2);
  await tick(`${DAY} 08:00`);
  assert("+120: both are «غائب» in Odoo", row(KHALID).x_status === "absent" && row(SAEED).x_status === "absent");
  const alerts = ownerSays("غائب");
  assert("…and Baraa gets ONE alert naming both, with each one's hour", alerts.length === 1 && body(alerts[0]) === ATT.absentText([{ name: "خالد", shiftMin: 360 }, { name: "سعيد", shiftMin: 360 }]) && body(alerts[0]).includes("خالد (06:00)، سعيد (06:00)"), JSON.stringify(alerts.map(body)));
  await tick(`${DAY} 08:05`); await tick(`${DAY} 09:00`);
  assert("after it: no second alert, no more templates", ownerSays("غائب").length === 1 && tpl(KHALID_PHONE).length === 2);
  assert("one absent alone reads «… سُجّل غائباً اليوم: لم يسجّل دخوله خلال ساعتين من بداية دوامه (06:00).»", ATT.absentText([{ name: "خالد", shiftMin: 360 }]) === "❌ خالد سُجّل غائباً اليوم: لم يسجّل دخوله خلال ساعتين من بداية دوامه (06:00).");
  // the alerts of the kind inside ten minutes are one message more
  world(`${DAY} 06:00`);
  const later = workSchedule([0, 1, 2, 3, 4, 5, 6].map((d) => [d, 6 + 5 / 60, 14] as [number, number, number]), { name: "06:05–14" });
  table("hr.employee").get(EMP(SAEED))!.resource_calendar_id = later;
  for (const at of ["06:00", "06:05", "06:30", "06:35"]) await tick(`${DAY} ${at}`);
  const before = sentTo(OWNER).length;
  await tick(`${DAY} 08:00`);
  await tick(`${DAY} 08:05`);
  assert("another «غائب» five minutes after the first: folded behind it (one message so far)", row(KHALID).x_status === "absent" && row(SAEED).x_status === "absent" && sentTo(OWNER).slice(before).filter((b) => body(b).includes("غائب")).length === 1, JSON.stringify(sentTo(OWNER).slice(before).map(body)));
  setRiyadh(`${DAY} 08:12`);
  await quiet(() => OA.flushOwnerAlerts(ENV, Date.now()));
  const merged = sentTo(OWNER).slice(before).map(body);
  assert("…and its window ends with ONE message carrying the other", merged.length === 2 && merged[1].includes("من النوع نفسه") && merged[1].includes("سعيد سُجّل غائباً"), JSON.stringify(merged));
  OA.setOwnerAlertShapingForTests(false);
  // frozen
  world(`${DAY} 05:00`);
  Object.assign(cfg(), { x_freeze_on: true, x_freeze_since: utc(`${DAY} 01:00`) });
  setRiyadh(`${DAY} 05:55`);
  await quiet(() => FZ.readFreeze(ENV, Date.now(), { fresh: true }));
  for (const at of ["06:00", "06:30", "08:00", "09:00"]) await tick(`${DAY} ${at}`);
  assert("frozen: no «بدء الدوام», no row, no «غائب», no alert", tpl(KHALID_PHONE).length === 0 && real().length === 0 && sentTo(OWNER).length === 0);
  Object.assign(cfg(), { x_freeze_on: false, x_freeze_ended_at: utc(`${DAY} 09:30`) });
  setRiyadh(`${DAY} 09:35`);
  await quiet(() => FZ.readFreeze(ENV, Date.now(), { fresh: true }));
  await tick(`${DAY} 09:40`);
  assert("turned off at 09:30: the day whose start fell inside the freeze is not counted «غائب» after it", real().length === 0 && sentTo(OWNER).length === 0 && tpl(KHALID_PHONE).length === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ح6
console.log("\n[ح6] a day of time off");
{
  world(`${DAY} 05:00`);
  const res = (table("hr.employee").get(EMP(KHALID)) as any).resource_id;
  seed("resource.calendar.leaves", { name: "سفر", resource_id: res, calendar_id: false, company_id: 1, date_from: utc(`${DAY} 00:00`), date_to: utc(`${DAY} 23:59`), count_as: "absence", x_leave_type: "annual" });
  const early = await tick(`${DAY} 05:30`);
  assert("before the hour his shift would start: no row yet", !row(KHALID) && early.members.find((m: any) => m.partnerId === KHALID)?.action === "leave");
  const at6 = await tick(`${DAY} 06:00`);
  const r = row(KHALID);
  assert("06:00: his row «إجازة», with the time off's name, made by the system («يدوي»: Baraa entered the time off)", at6.members.find((m: any) => m.partnerId === KHALID)?.action === "leave_row" && r?.x_status === "leave" && r.x_note === "إجازة: سفر" && r.x_source === "manual" && r.x_shift_at === utc(`${DAY} 06:00`) && !r.x_sent_at && !r.x_tapped_at, JSON.stringify(r));
  for (const at of ["06:05", "06:30", "08:00", "10:00"]) await tick(`${DAY} ${at}`);
  assert("the rest of the day: one row, no template, no reminder, no «غائب», no alert about him", real().filter((x) => x.x_employee_id === EMP(KHALID)).length === 1 && row(KHALID).x_status === "leave" && tpl(KHALID_PHONE).length === 0 && ownerSays("خالد").length === 0);
  assert("…while سعيد, who is not off, is «غائب» at 08:00", row(SAEED).x_status === "absent");
  setRiyadh(`${DAY} 10:10`);
  await quiet(() => ENV.MSG_DEDUP.store.clear());
  openWindow(ENV, OWNER);
  await tick(`${DAY} 10:15`);
  assert("the KV wiped: still one row for the day", real().filter((x) => x.x_employee_id === EMP(KHALID) && x.x_date === DAY).length === 1);
  // frozen: the day of time off still has its row (it is the record of a fact, not a message)
  world(`${DAY} 05:00`);
  seed("resource.calendar.leaves", { name: "سفر", resource_id: (table("hr.employee").get(EMP(KHALID)) as any).resource_id, calendar_id: false, company_id: 1, date_from: utc(`${DAY} 00:00`), date_to: utc(`${DAY} 23:59`), count_as: "absence", x_leave_type: "sick" });
  Object.assign(cfg(), { x_freeze_on: true, x_freeze_since: utc(`${DAY} 01:00`) });
  setRiyadh(`${DAY} 05:55`);
  await quiet(() => FZ.readFreeze(ENV, Date.now(), { fresh: true }));
  for (const at of ["06:00", "08:00"]) await tick(`${DAY} ${at}`);
  assert("frozen: the time off's row is written all the same — and nobody is «غائب», nothing is sent", row(KHALID)?.x_status === "leave" && real().length === 1 && graph.filter((b: any) => b?.to).length === 0, JSON.stringify(real()));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ح7
console.log("\n[ح7] a member who is not on attendance");
{
  // عمر: «مشمول بالتحضير» off, his own schedule 02:00–12:00
  world(`${DAY} 02:00`);
  for (const at of ["02:00", "02:30", "04:00", "05:00"]) await tick(`${DAY} ${at}`);
  assert("no «بدء الدوام», no reminder and no «غائب» ever follow him", tpl(DRIVER_PHONE).length === 0 && !row(DRIVER) && ownerSays("عمر").length === 0);
  await say(DRIVER_PHONE, `${DAY} 05:10`, "بدأت الدوام");
  const r = row(DRIVER);
  assert("«بدأت الدوام» at 05:10: his row is made — «متأخر» 190 minutes by HIS schedule (02:00), from WhatsApp, no message ever sent to him before", r?.x_status === "late" && r.x_late_min === 190 && r.x_source === "whatsapp" && r.x_shift_at === utc(`${DAY} 02:00`) && !r.x_sent_at && r.x_tapped_at === utc(`${DAY} 05:10`), JSON.stringify(r));
  assert("the answer names his hours, with «🏁 انتهى دوامي»", body(last(DRIVER_PHONE)).includes("تم تسجيل حضورك الساعة 05:10 ✅ (متأخر، دوامك 02:00)") && buttons(last(DRIVER_PHONE)).join() === "shift_end|🏁 انتهى دوامي", JSON.stringify(last(DRIVER_PHONE)));
  await say(DRIVER_PHONE, `${DAY} 05:20`, "بدأت الدوام");
  assert("again: «مسجّل من 05:10», one row", body(last(DRIVER_PHONE)).includes("دوامك اليوم مسجّل من 05:10") && real().filter((x) => x.x_employee_id === EMP(DRIVER)).length === 1);
  await say(DRIVER_PHONE, `${DAY} 12:00`, "انتهى دوامي");
  assert("his exit: on that row", row(DRIVER).x_out_at === utc(`${DAY} 12:00`) && body(last(DRIVER_PHONE)).includes("مدة دوامك 6 س 50 د"));
  for (const at of ["12:05", "13:00"]) await tick(`${DAY} ${at}`);
  assert("the ticks leave his row alone", row(DRIVER).x_status === "late" && ownerSays("عمر").length === 0);
  // in time
  world(`${DAY} 02:00`);
  await say(DRIVER_PHONE, `${DAY} 02:10`, "بدأت الدوام");
  assert("at 02:10: «حاضر», 0 minutes", row(DRIVER).x_status === "present" && row(DRIVER).x_late_min === 0 && body(last(DRIVER_PHONE)).startsWith("تم تسجيل حضورك الساعة 02:10 ✅\n"));
  // no schedule of his own: the company's working days
  world(`${DAY} 02:00`, { companyDays: true });
  await say(NOCAL_PHONE, `${DAY} 02:40`, "بدأت الدوام");
  assert("no schedule of his own: late by «جدول أيام العمل» of the settings (02:00) — 40 minutes", row(NOCAL)?.x_status === "late" && row(NOCAL).x_late_min === 40 && row(NOCAL).x_shift_at === utc(`${DAY} 02:00`), JSON.stringify(row(NOCAL)));
  world(`${DAY} 02:00`);
  await say(NOCAL_PHONE, `${DAY} 09:40`, "بدأت الدوام");
  assert("no schedule anywhere: «حاضر», no shift hour, 0 minutes", row(NOCAL)?.x_status === "present" && row(NOCAL).x_late_min === 0 && !row(NOCAL).x_shift_at && body(last(NOCAL_PHONE)).startsWith("تم تسجيل حضورك الساعة 09:40 ✅"));
  // a day his own schedule gives no hours: a day off, never late
  world(`${DAY} 02:00`, { companyDays: true });
  const weekdays = workSchedule([[0, 8, 16], [1, 8, 16]], { name: "الاثنين والثلاثاء" });
  table("hr.employee").get(EMP(NOCAL))!.resource_calendar_id = weekdays;
  await say(NOCAL_PHONE, `${DAY} 11:00`, "بدأت الدوام");
  assert("his own schedule has hours, none today (Saturday): «حاضر», not measured by the company's", row(NOCAL)?.x_status === "present" && row(NOCAL).x_late_min === 0 && !row(NOCAL).x_shift_at, JSON.stringify(row(NOCAL)));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ح8
console.log("\n[ح8] Baraa");
{
  world(`${DAY} 02:00`);
  await say(OWNER, `${DAY} 02:05`, "بدأت الدوام");
  assert("his «بدأت الدوام» is his tap on the window message: «✅ تم…», nothing recorded", body(sentTo(OWNER)[0]).startsWith("✅ تم. تنبيهات يو تاك") && rows("x_team_attendance").length === 0, JSON.stringify(said(OWNER)));
  await say(OWNER, `${DAY} 12:05`, "انتهى دوامي");
  assert("his «انتهى دوامي»: «دوامك لا يُسجَّل», nothing recorded", body(last(OWNER)) === ATT.OWNER_NO_ATTENDANCE_TEXT && rows("x_team_attendance").length === 0);
  for (const at of ["02:10", "02:30", "04:00"]) await tick(`${DAY} ${at}`);
  assert("no row, no reminder and no «غائب» about him", rows("x_team_attendance").filter((r: any) => r.x_employee_id === EMP(OWNER_PID)).length === 0 && ownerSays("براء").length === 0);
}

// ================================================================ ح9
console.log("\n[ح9] the trial on Baraa's card");
{
  world(`${DAY} 02:00`);
  openWindow(ENV, OWNER);
  const hook = (op: string, token = HOOK) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/s68-trial?op=${op}&token=${token}`, { method: "POST" }), ENV, ctx));
  assert("a wrong token: 401, nothing made", (await hook("in", "nope")).status === 401 && rows("x_team_attendance").length === 0 && graph.filter((b: any) => b?.to).length === 0);
  setRiyadh(`${DAY} 02:25`);
  const a = await (await hook("in")).json() as any;
  const sim = (rows("x_team_attendance") as any[]).filter((r) => r.x_utak_simulation === true);
  assert("op=in: ONE row on Baraa's card, marked «محاكاة»: «متأخر» 25 minutes by his 02:00, from WhatsApp", a.ok && a.sent === true && sim.length === 1 && sim[0].x_employee_id === EMP(OWNER_PID) && sim[0].x_status === "late" && sim[0].x_late_min === 25 && sim[0].x_source === "whatsapp" && sim[0].x_note === TR.S68_TRIAL_NOTE && sim[0].x_tapped_at === utc(`${DAY} 02:25`), JSON.stringify({ a, sim }));
  const first = last(OWNER);
  assert("…he gets the answer a member gets, marked «🧪 تجربة», with «🏁 انتهى دوامي» (the trial's own button)", body(first).startsWith("🧪 تجربة § 68 — تم تسجيل حضورك الساعة 02:25 ✅ (متأخر، دوامك 02:00)") && body(first).includes(ATT.ENTRY_HINT) && body(first).includes(TR.S68_TRIAL_FOOT) && buttons(first).join() === "shift_end_test|🏁 انتهى دوامي", JSON.stringify(first));
  const b = await (await hook("in")).json() as any;
  assert("op=in again the same day: nothing more (one row, one message)", b.sent === false && String(b.reason).includes("already") && rows("x_team_attendance").length === 1 && sentTo(OWNER).length === 1);
  const st = await (await hook("state")).json() as any;
  assert("op=state: the row, nothing sent", st.row?.id === sim[0].id && st.row.x_utak_simulation === true && sentTo(OWNER).length === 1);
  await press(OWNER, `${DAY} 12:30`, TR.S68_TRIAL_END_PAYLOAD);
  assert("«🏁 انتهى دوامي» on the trial's message: the exit on the simulation row, and its answer", sim[0].x_out_at === utc(`${DAY} 12:30`) && body(last(OWNER)).startsWith("🧪 تجربة § 68 — تم تسجيل خروجك الساعة 12:30 ✅ — مدة دوامك 10 س 5 د."), JSON.stringify(said(OWNER)));
  const c = await (await hook("out")).json() as any;
  assert("op=out after it: «خروجك مسجّل من 12:30», the exit as it was", String(c.reason).includes("already") && sim[0].x_out_at === utc(`${DAY} 12:30`) && body(last(OWNER)).includes("خروجك مسجّل من 12:30"));
  assert("nobody but Baraa was reached", graph.filter((x: any) => x?.to && x.to !== OWNER).length === 0);
  // the row enters nothing
  const read = await quiet(() => ATT.attendanceStatus(ENV, EMP(OWNER_PID), DAY));
  assert("no reader of the day's attendance sees the row", read === null);
  const month = EF.monthFigures((rows("x_team_attendance") as any[]).filter((r) => r.x_utak_simulation !== true));
  assert("…and it enters no figure of the month", month.rows === 0 && month.present === 0);
  await say(OWNER, `${DAY} 12:40`, "انتهى دوامي");
  assert("his own words afterwards still record nothing of his", body(last(OWNER)) === ATT.OWNER_NO_ATTENDANCE_TEXT && rows("x_team_attendance").length === 1);
  // out with no entry; another number never gets the trial
  world(`${NEXT} 02:00`);
  openWindow(ENV, OWNER);
  const none = await (await hook("out")).json() as any;
  assert("op=out with no trial entry today: nothing written, nothing sent", none.sent === false && rows("x_team_attendance").length === 0 && sentTo(OWNER).length === 0);
  setRiyadh(`${NEXT} 02:10`);
  await hook("in");
  const open = (rows("x_team_attendance") as any[])[0];
  const n9 = graph.filter((x: any) => x?.to).length;
  await press(KHALID_PHONE, `${NEXT} 06:00`, TR.S68_TRIAL_END_PAYLOAD);
  assert("the trial's button from another number does nothing: the trial's row stays open, nothing is sent", rows("x_team_attendance").length === 1 && !open.x_out_at && graph.filter((x: any) => x?.to).length === n9);
  const GW = await import("../src/wa-gateway.ts");
  const refused = GW.gatewayDecision(await quiet(() => GW.sendViaGateway(ENV, { purpose: TR.S68_TRIAL_PURPOSE, to: "+" + KHALID_PHONE, content: { kind: "session", body: { type: "text", text: { body: "x" } } } })));
  assert("the trial's purpose reaches no other number, whatever sends it", refused?.action !== "session" && refused?.action !== "held" && sentTo(KHALID_PHONE).length === 0, JSON.stringify(refused));
  // frozen: the trial still reaches him
  world(`${DAY} 02:00`);
  openWindow(ENV, OWNER);
  Object.assign(cfg(), { x_freeze_on: true, x_freeze_since: utc(`${DAY} 01:00`) });
  await quiet(() => FZ.readFreeze(ENV, Date.now(), { fresh: true }));
  const f = await (await hook("in")).json() as any;
  assert("frozen: the trial goes all the same (Baraa's number alone)", f.sent === true && sentTo(OWNER).length === 1 && graph.filter((x: any) => x?.to && x.to !== OWNER).length === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

done();
