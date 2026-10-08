// § 68 (2026-10-08) — the employee's file: the papers and their ends, the month's summary, and the two texts
// the worker writes on the card («العهدة والمستحقات», «الأداء»).
//
//   [و1] the papers: which are asked of whom, «🗂️ اكتمال الأوراق ٪», what is missing — the same list as Odoo's
//   [و2] a paper's end: ONE message at 30 days, again at 7, once when it has ended — also while frozen
//   [و3] the month: the first day alone, once, each employee's line — not when the whole month was frozen
//   [و4] «العهدة والمستحقات»: the cash a collector collected, the journal's balance, where a handover lives
//   [و5] «الأداء»: a number when there is data, «لا بيانات بعد» when there is none
//   [و6] the two texts on the card: written when they change, and by «🔄 حدّث الأرقام»
//   [و7] the day's one run: from 08:10, once, whatever the freeze says
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s68-file.test.mts

import { readFileSync } from "node:fs";
import { OWNER, closeOwnerWindow, ctx, employee, failNext, graph, heldFor, odooLog, quiet, rows, seed, sentTo, setRiyadh, table, workSchedule } from "./wa-harness.mts";
import { ALL_WEEK, DRIVER, assert, done, fresh, rejected } from "./s46-kit.mts";

const worker = (await import("../src/index.ts")).default;
const EF = await import("../src/employee-file.ts");
const FZ = await import("../src/freeze.ts");
const LIB = await import("../scripts/lib/s68-odoo.mjs");

const HOOK = "s68-hook-secret-0123456789abcdef0123456789abcdef";
const D = "2026-10-08";
const KHALID = 811, KHALID_PHONE = "966500000811";   // a collector, 06:00–14:00
const SAEED = 812;                                   // a driver, the same hours
const OWNER_PID = 45;
const EMP = (pid: number) => 7000 + pid;
const TICK = "*/5 * * * *";
const cfg = () => table("x_pricing_config").get(1) as any;
const card = (pid: number) => table("hr.employee").get(EMP(pid)) as any;
const utc = (riyadh: string): string => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const at = (riyadh: string): number => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
const body = (b: any): string => String(b?.text?.body ?? b?.interactive?.body?.text ?? "");
const toOwner = () => sentTo(OWNER).map(body);

let ENV: any;
/** The harness's two (أحمد a buyer, سالم a collector), عمر (a driver, no attendance), خالد (a collector) and سعيد (a driver) on attendance, Baraa with the three roles: six cards. Every paper «ناقص». */
function world(riyadh: string): any {
  const env = fresh(riyadh);
  env.HOOK_SECRET = HOOK;
  const cal = workSchedule([0, 1, 2, 3, 4, 5, 6].map((d) => [d, 6, 14] as [number, number, number]), { name: "06–14" });
  seed("res.partner", { id: KHALID, name: "خالد", x_whatsapp_number: "+" + KHALID_PHONE });
  seed("res.partner", { id: SAEED, name: "سعيد", x_whatsapp_number: "+966500000812" });
  seed("res.partner", { id: OWNER_PID, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER });
  const jobC = seed("hr.job", { name: "محصّل", x_job_role_ids: [], x_default_calendar_id: false, x_job_attendance: false, sequence: 10, company_id: 1 });
  employee(KHALID, [73], { x_utak_attendance: true, resource_calendar_id: cal, job_id: jobC });
  employee(SAEED, [72], { x_utak_attendance: true, resource_calendar_id: cal });
  employee(OWNER_PID, [71, 72, 73], { name: "براء", x_utak_attendance: true, resource_calendar_id: workSchedule(ALL_WEEK, { name: "UTAK — أيام العمل" }) });
  for (const e of rows("hr.employee") as any[]) for (const d of EF.DOCS) e[d.state] = "missing";
  ENV = env;
  return env;
}
const staff = async () => (await import("../src/team-roster.ts")).loadRoster(ENV, Date.now());
const cards = async () => EF.readCards(ENV, await staff());

// ================================================================ و1
console.log("\n[و1] the papers");
{
  const strip = (d: any) => JSON.stringify(Object.fromEntries(Object.entries(d).sort()));
  assert("the worker's list of papers is Odoo's (scripts/lib/s68-odoo.mjs): the same eight, the same fields", EF.DOCS.length === 8 && EF.DOCS.map(strip).join("|") === LIB.DOCS.map(strip).join("|"));
  assert("Odoo's own fields are used where it has them — an x_ field only where it has none", EF.DOCS.find((d) => d.key === "id")!.number === "identification_id" && EF.DOCS.find((d) => d.key === "id")!.file === "id_card" && EF.DOCS.find((d) => d.key === "passport")!.expiry === "passport_expiration_date" && EF.DOCS.find((d) => d.key === "permit")!.expiry === "work_permit_expiration_date" && EF.DOCS.find((d) => d.key === "permit")!.file === "has_work_permit" && EF.DOCS.find((d) => d.key === "contract")!.expiry === "contract_date_end" && EF.DOCS.find((d) => d.key === "license")!.file === "driving_license");
  assert("the worker reads a paper's state and its end alone: no number, no attachment", EF.PAPER_FIELDS.every((f) => /_state$|expir|date_end$|^x_doc_other_name$/.test(f)) && !EF.PAPER_FIELDS.some((f) => /_no$|_id$|id_card|file|license$|permit$/.test(f)), EF.PAPER_FIELDS.join(", "));
  const all = Object.fromEntries(EF.DOCS.map((d) => [d.state, "missing"]));
  const titles = (c: any, codes: string[]) => EF.askedPapers(c, codes).map((p) => p.title).join("، ");
  assert("asked of everyone: six", titles(all, []) === "الإقامة / الهوية، جواز السفر، تصريح العمل، عقد العمل، التأمينات، الشهادة الصحية");
  assert("…and the driving licence of a driver alone", titles(all, ["driver"]).endsWith("الشهادة الصحية، رخصة القيادة") && !titles(all, ["collector", "warehouse"]).includes("رخصة"));
  assert("«أخرى» counts when it is named — under its own name", titles({ ...all, x_doc_other_name: " بطاقة السوق " }, []).endsWith("الشهادة الصحية، بطاقة السوق") && !titles({ ...all, x_doc_other_name: "  " }, []).includes("أخرى"));
  assert("…Odoo's empty name (false) is not a name", EF.askedPapers({ ...all, x_doc_other_name: false }, []).length === 6 && EF.askedPapers({ ...all, x_doc_other_name: false, x_doc_other_expiry: "2026-10-09" }, []).every((x) => x.key !== "other"));
  assert("«لا ينطبق» is asked of nobody", EF.askedPapers({ ...all, x_doc_permit_state: "na", x_doc_passport_state: "na" }, []).length === 4);
  assert("a state Odoo left empty is «ناقص»", EF.askedPapers({}, []).every((p) => p.state === "missing") && EF.askedPapers({ x_doc_id_state: false }, [])[0].state === "missing");
  const p = (states: string[]) => EF.askedPapers(Object.fromEntries(EF.DOCS.map((d, i) => [d.state, states[i] ?? "missing"])), []);
  assert("the percentage: complete of asked", EF.papersPct(p(["done", "done", "done"])) === 50 && EF.papersPct(p([])) === 0 && EF.papersPct(p(["done", "done", "done", "done", "done", "done"])) === 100);
  assert("…«قيد الإجراء» is not complete", EF.papersPct(p(["progress", "progress"])) === 0);
  assert("…none asked: 100", EF.papersPct([]) === 100 && EF.papersPct(p(["na", "na", "na", "na", "na", "na"])) === 100);
  const eight = (n: number) => EF.papersPct(EF.askedPapers(Object.fromEntries([...EF.DOCS.map((d, i) => [d.state, i < n ? "done" : "missing"]), ["x_doc_other_name", "x"]]), ["driver"]));
  assert("…a half rounds UP, as Odoo's own figure does (1 of 8 = 13, 3 of 8 = 38, 5 of 8 = 63)", eight(1) === 13 && eight(3) === 38 && eight(5) === 63 && eight(7) === 88 && LIB.DOCS_PCT_CODE.includes("+ 0.5)") && !LIB.DOCS_PCT_CODE.includes("round("));
  assert("what is missing, by name — «قيد الإجراء» said", EF.missingPapers(p(["done", "progress", "missing", "done", "done", "done"])) === "جواز السفر (قيد الإجراء)، تصريح العمل" && EF.missingPapers(p(["done", "done", "done", "done", "done", "done"])) === "");
  assert("a paper's end is read as a day", EF.askedPapers({ x_doc_id_expiry: "2026-11-07", passport_expiration_date: false }, [])[0].expiry === "2026-11-07" && EF.askedPapers({}, [])[1].expiry === null);
}

// ================================================================ و2
console.log("\n[و2] a paper's end");
{
  assert("the step: more than 30 days — none; 30…8 — «30»; 7…0 — «7»; passed — «expired»", EF.expiryStep("2026-11-08", D) === null && EF.expiryStep("2026-11-07", D) === "30" && EF.expiryStep("2026-10-16", D) === "30" && EF.expiryStep("2026-10-15", D) === "7" && EF.expiryStep(D, D) === "7" && EF.expiryStep("2026-10-07", D) === "expired");
  assert("the line says when", EF.expiryLine("خالد", "جواز السفر", "2026-11-07", D) === "• خالد — جواز السفر: تنتهي 2026-11-07 (بعد 30 يوماً)" && EF.expiryLine("خالد", "جواز السفر", D, D).includes("تنتهي اليوم") && EF.expiryLine("خالد", "جواز السفر", "2026-10-05", D).includes("انتهت 2026-10-05 (منذ 3 يوماً)"));
  world(`${D} 08:10`);
  Object.assign(card(KHALID), { x_doc_id_expiry: "2026-11-07", x_doc_id_state: "done", passport_expiration_date: "2027-06-01", x_doc_gosi_expiry: "2026-10-20", x_doc_gosi_state: "na" });
  Object.assign(card(SAEED), { x_doc_license_expiry: "2026-10-12", x_doc_health_expiry: "2026-10-01" });
  Object.assign(card(DRIVER), { x_doc_other_expiry: "2026-10-09" }); // «أخرى» is not named: not asked
  const run = async (riyadh: string) => { setRiyadh(riyadh); return quiet(async () => EF.runPapersExpiry(ENV, await cards(), await staff(), Date.now())); };
  const r1 = await run(`${D} 08:10`);
  const msg = toOwner();
  assert("three papers at a step: ONE message to Baraa, a line each", r1.due === 3 && r1.outcome === "sent" && msg.length === 1 && msg[0].startsWith(EF.EXPIRY_HEAD) && msg[0].split("\n").filter((l) => l.startsWith("• ")).length === 3, JSON.stringify(msg));
  assert("…a complete paper that ends in 30 days is told; one months away is not; «لا ينطبق» is not; an unnamed «أخرى» is not", msg[0].includes("• خالد — الإقامة / الهوية: تنتهي 2026-11-07 (بعد 30 يوماً)") && !msg[0].includes("جواز") && !msg[0].includes("التأمينات") && !msg[0].includes("عمر"));
  assert("…the driver's licence in 4 days, and a certificate that ended a week ago", msg[0].includes("• سعيد — رخصة القيادة: تنتهي 2026-10-12 (بعد 4 يوماً)") && msg[0].includes("• سعيد — الشهادة الصحية: انتهت 2026-10-01 (منذ 7 يوماً)"));
  const r2 = await run("2026-10-09 08:10");
  assert("the next day: nothing again (each paper is told once a step)", r2.due === 0 && r2.outcome === "none" && toOwner().length === 1);
  const r2b = await run("2026-10-13 08:10");
  assert("the licence told at 7 days ends: told once more, «انتهت» — the certificate that had ended already is not repeated", r2b.due === 1 && toOwner().length === 2 && toOwner()[1].includes("• سعيد — رخصة القيادة: انتهت 2026-10-12 (منذ 1 يوماً)") && !toOwner()[1].includes("الشهادة الصحية"), JSON.stringify(toOwner()[1]));
  const r3 = await run("2026-10-31 08:10");
  assert("when the 30-day paper is 7 days away: told again, alone", r3.due === 1 && toOwner().length === 3 && toOwner()[2].includes("خالد — الإقامة / الهوية: تنتهي 2026-11-07 (بعد 7 يوماً)") && !toOwner()[2].includes("سعيد"), JSON.stringify(toOwner()[2]));
  const r4 = await run("2026-11-08 08:10");
  assert("when it has ended: told once more («انتهت»), then never", r4.due === 1 && toOwner()[3].includes("خالد — الإقامة / الهوية: انتهت 2026-11-07") && (await run("2026-11-09 08:10")).due === 0 && (await run("2026-12-01 08:10")).due === 0 && toOwner().length === 4, JSON.stringify(toOwner().slice(3)));
  // a new end (the paper was renewed): its own steps
  card(KHALID).x_doc_id_expiry = "2027-01-05";
  assert("a renewed paper starts again: its new end is told at its own 30 days", (await run("2026-12-20 08:10")).due === 1 && toOwner().at(-1)!.includes("تنتهي 2027-01-05"));
  // a message Meta refused is tried again
  world(`${D} 08:10`);
  card(KHALID).passport_expiration_date = "2026-10-20";
  failNext.push({ to: OWNER, code: 131000 });
  const f1 = await run(`${D} 08:10`);
  const f2 = await run("2026-10-09 08:10");
  assert("a message that did not leave is not «told»: the paper is in the next day's message, then never again", f1.outcome === "failed" && f1.due === 1 && f2.outcome === "sent" && f2.due === 1 && toOwner().at(-1)!.includes("خالد — جواز السفر: تنتهي 2026-10-20 (بعد 11 يوماً)") && (await run("2026-10-10 08:10")).due === 0, JSON.stringify({ f1, f2, sent: toOwner() }));
  // outside his window: kept for it (one of his alerts), and marked told
  world(`${D} 08:10`);
  closeOwnerWindow(ENV);
  card(KHALID).passport_expiration_date = "2026-10-20";
  const h1 = await run(`${D} 08:10`);
  assert("his window is closed: the message waits for it (it is not lost), and is not repeated tomorrow", h1.outcome === "sent" && sentTo(OWNER).length === 0 && heldFor(ENV, OWNER).length === 1 && (await run("2026-10-09 08:10")).due === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ و3
console.log("\n[و3] the month");
{
  const f = EF.monthFigures([
    { x_employee_id: 1, x_status: "present", x_tapped_at: "2026-09-01 03:00:00", x_out_at: "2026-09-01 11:30:00" },
    { x_employee_id: 1, x_status: "late", x_late_min: 20, x_tapped_at: "2026-09-02 03:20:00", x_out_at: "2026-09-02 11:00:00" },
    { x_employee_id: 1, x_status: "late", x_late_min: 45, x_tapped_at: "2026-09-03 03:45:00", x_out_at: false },
    { x_employee_id: 1, x_status: "absent" }, { x_employee_id: 1, x_status: "leave" }, { x_employee_id: 1, x_status: false },
  ]);
  assert("an employee's month: present 3 (the late days among them), late 2 with 65 minutes, absent 1, time off 1", f.rows === 6 && f.present === 3 && f.late === 2 && f.lateMin === 65 && f.absent === 1 && f.leave === 1, JSON.stringify(f));
  assert("…the hours are of the days with an entry AND an exit: 8.5 + 7.67", f.hours === 16.17, String(f.hours));
  assert("the line", EF.monthLine({ name: "خالد", jobName: "محصّل" }, f, EF.askedPapers({ x_doc_id_state: "done" }, [])) === "• خالد (محصّل): حضر 3 يوماً (منها 2 متأخراً، 65 دقيقة) · غاب 1 · إجازة 1 · 16.17 ساعة — الأوراق 17٪، ناقص: جواز السفر، تصريح العمل، عقد العمل، التأمينات، الشهادة الصحية");
  assert("…no row at all: «لا حضور مسجّل»; every paper complete: no «ناقص»", EF.monthLine({ name: "براء", jobName: "" }, EF.monthFigures([]), []) === "• براء: لا حضور مسجّل — الأوراق 100٪");
  assert("«سبتمبر 2026»", EF.monthLabel("2026-09") === "سبتمبر 2026" && EF.monthLabel("2027-01") === "يناير 2027");

  world("2026-10-01 08:10");
  const A = (pid: number, day: string, status: string, extra: Record<string, unknown> = {}) => seed("x_team_attendance", { x_name: "x", x_employee_id: EMP(pid), x_partner_id: pid, x_date: day, x_status: status, x_reminder_sent: false, ...extra });
  A(KHALID, "2026-09-10", "present", { x_tapped_at: utc("2026-09-10 06:02"), x_out_at: utc("2026-09-10 14:02") });
  A(KHALID, "2026-09-11", "late", { x_late_min: 30, x_tapped_at: utc("2026-09-11 06:30") });
  A(KHALID, "2026-09-12", "absent");
  A(KHALID, "2026-09-13", "present", { x_utak_simulation: true });     // a simulation row: never counted
  A(KHALID, "2026-08-31", "absent");                                   // the month before
  A(KHALID, "2026-10-01", "absent");                                   // the new month
  A(SAEED, "2026-09-30", "leave");
  card(KHALID).x_doc_id_state = "done";
  const run = async (riyadh: string) => { setRiyadh(riyadh); return quiet(async () => EF.runMonthlySummary(ENV, await cards(), await staff(), Date.now())); };
  assert("not the first of the month: nothing", (await run("2026-10-02 08:10")) === "not_first" && (await run("2026-09-30 08:10")) === "not_first" && sentTo(OWNER).length === 0);
  const sent = await run("2026-10-01 08:10");
  const text = toOwner()[0] ?? "";
  assert("the first: ONE message — «📅 ملخص الفريق — سبتمبر 2026», a line for each of the six", sent === "sent" && toOwner().length === 1 && text.startsWith("📅 ملخص الفريق — سبتمبر 2026:") && text.split("\n").filter((l) => l.startsWith("• ")).length === 6, text);
  assert("…خالد: September's rows alone, without the simulation one", text.includes("• خالد (محصّل): حضر 2 يوماً (منها 1 متأخراً، 30 دقيقة) · غاب 1 · إجازة 0 · 8 ساعة — الأوراق 17٪، ناقص: جواز السفر"), text);
  assert("…سعيد's time off, and his driver's licence among what is missing", text.includes("• سعيد: حضر 0 يوماً · غاب 0 · إجازة 1 · 0 ساعة — الأوراق 0٪") && /سعيد:.*رخصة القيادة/.test(text));
  assert("…and who has no row: «لا حضور مسجّل» (Baraa, عمر)", text.includes("• براء: لا حضور مسجّل") && text.includes("• عمر المجهلي: لا حضور مسجّل"));
  assert("once: a second run the same day sends nothing", (await run("2026-10-01 09:00")) === "sent_before" && toOwner().length === 1);
  // the freeze
  world("2026-10-01 08:10");
  Object.assign(cfg(), { x_freeze_on: true, x_freeze_since: utc("2026-08-20 10:00") });
  setRiyadh("2026-10-01 08:05");
  await quiet(() => FZ.readFreeze(ENV, Date.now(), { fresh: true }));
  assert("the whole month was frozen: no summary", (await run("2026-10-01 08:10")) === "frozen_month" && sentTo(OWNER).length === 0);
  world("2026-10-01 08:10");
  Object.assign(cfg(), { x_freeze_on: true, x_freeze_since: utc("2026-09-20 10:00") });
  setRiyadh("2026-10-01 08:05");
  await quiet(() => FZ.readFreeze(ENV, Date.now(), { fresh: true }));
  assert("frozen since the 20th (still on): the month is told — the freeze does not stop the summary", (await run("2026-10-01 08:10")) === "sent" && toOwner().length === 1);
  world("2026-10-01 08:10");
  Object.assign(cfg(), { x_freeze_on: false, x_freeze_since: utc("2026-08-20 10:00"), x_freeze_ended_at: utc("2026-09-30 22:00") });
  setRiyadh("2026-10-01 08:05");
  await quiet(() => FZ.readFreeze(ENV, Date.now(), { fresh: true }));
  assert("a freeze that ended on the month's last evening: the month had a day of work — told", (await run("2026-10-01 08:10")) === "sent");
  // a send that failed is tried again
  world("2026-10-01 08:10");
  failNext.push({ to: OWNER, code: 131000 });
  assert("a message that did not leave: tried again at the next run, then «sent before»", (await run("2026-10-01 08:10")) === "failed" && (await run("2026-10-01 08:15")) === "sent" && (await run("2026-10-01 08:20")) === "sent_before");
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ و4
console.log("\n[و4] «العهدة والمستحقات»");
{
  assert("not a collector: said so, and no advances are on record", EF.custodyText({ collector: false }) === `${EF.NOT_COLLECTOR_TEXT}\n${EF.NO_ADVANCES_TEXT}`);
  const none = EF.custodyText({ collector: true, all: { total: 0, count: 0 }, month: { total: 0, count: 0 }, journal: 0 });
  assert("a collector with no cash yet: said so; the journal's balance; where a handover lives (KV, four days); no advances", none.includes(EF.NO_CASH_TEXT) && none.includes("رصيد يومية «كاش السائق» (CSHD) في الدفاتر: 0.00 ر.س") && none.includes(EF.CUSTODY_WHERE_TEXT) && none.endsWith(EF.NO_ADVANCES_TEXT) && EF.CUSTODY_WHERE_TEXT.includes("(KV) أربعة أيام فقط") && EF.CUSTODY_WHERE_TEXT.includes("لا سجل دائم له في Odoo"));
  const some = EF.custodyText({ collector: true, all: { total: 1250.5, count: 9 }, month: { total: 450, count: 3 }, journal: 300 });
  assert("with cash: this month and since the start, with their counts", some.includes("• كاش حصّله هذا الشهر: 450.00 ر.س — 3 تحصيلات") && some.includes("• كاش حصّله منذ البداية: 1,250.50 ر.س — 9 تحصيلات") && some.includes("300.00 ر.س"));
  assert("the journal unread: said so, never a 0", EF.custodyText({ collector: true, all: { total: 5, count: 1 }, month: { total: 5, count: 1 }, journal: null }).includes(EF.JOURNAL_UNREAD_TEXT));

  world(`${D} 09:00`);
  const inv = (extra: Record<string, unknown> = {}) => seed("x_invoice", { x_name: "INV", x_order_id: false, x_issued_at: utc("2026-10-02 10:00"), ...extra });
  const pay = (by: number, amount: number, when: string, extra: Record<string, unknown> = {}) => seed("x_payment", { x_name: "P", x_method: "cash", x_amount: amount, x_collected_by: by, x_collected_at: utc(when), x_invoice_id: inv(), ...extra });
  pay(KHALID, 200, "2026-10-03 11:00"); pay(KHALID, 250.5, "2026-10-07 11:00"); pay(KHALID, 800, "2026-09-20 11:00");
  pay(KHALID, 999, "2026-10-05 11:00", { x_utak_simulation: true });                                   // a simulation payment
  pay(KHALID, 777, "2026-10-05 12:00", { x_invoice_id: inv({ x_utak_simulation: true }) });            // a payment of a simulation invoice
  pay(KHALID, 300, "2026-10-06 11:00", { x_method: "transfer" });                                      // not cash
  pay(OWNER_PID, 60, "2026-10-06 11:00");
  const acc = seed("account.account", { name: "كاش السائق", code: "101007" });
  seed("account.journal", { name: "كاش السائق", code: "CSHD", type: "cash", default_account_id: acc });
  for (const [balance, state] of [[1250.5, "posted"], [-900, "posted"], [5000, "draft"]] as const) seed("account.move.line", { account_id: acc, balance, parent_state: state });
  seed("account.move.line", { account_id: acc + 999, balance: 4444, parent_state: "posted" });
  assert("the journal's balance: its account's posted lines alone", (await quiet(() => EF.cashJournalBalance(ENV))) === 350.5);
  const r = await quiet(() => EF.refreshEmployeeFile(ENV, { now: at(`${D} 09:00`) }));
  const k = String(card(KHALID).x_custody_text);
  assert("خالد's card: 450.50 this month in 2, 1,250.50 since the start in 3 — no simulation row, no payment of a simulation invoice, no transfer", r.errors.length === 0 && k.includes("• كاش حصّله هذا الشهر: 450.50 ر.س — تحصيلان") && k.includes("• كاش حصّله منذ البداية: 1,250.50 ر.س — 3 تحصيلات"), k);
  assert("…the journal's balance (350.50) and the two fixed lines", k.includes("في الدفاتر: 350.50 ر.س") && k.includes(EF.CUSTODY_WHERE_TEXT) && k.endsWith(EF.NO_ADVANCES_TEXT));
  assert("سعيد (a driver, not a collector): «ليس محصّلاً»", String(card(SAEED).x_custody_text) === `${EF.NOT_COLLECTOR_TEXT}\n${EF.NO_ADVANCES_TEXT}`);
  assert("Baraa (a collector too): his own 60.00", String(card(OWNER_PID).x_custody_text).includes("منذ البداية: 60.00 ر.س — تحصيل واحد"));
  assert("nothing of a handover is copied to Odoo: no figure of the KV record is in the text", !/تسليم.*\d+\.\d{2}/.test(k.split("\n").find((l) => l.includes("تسليم العهدة")) ?? ""));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ و5
console.log("\n[و5] «الأداء»");
{
  const head = "الأداء — أكتوبر 2026 حتى اليوم:";
  assert("no driver's and no collector's role: no figure is made up", EF.perfText("2026-10", { driver: false, collector: false }) === `${head}\n${EF.NO_ROLE_PERF_TEXT}`);
  const empty = EF.perfText("2026-10", { driver: true, collector: true, deliveries: { delivered: 0, judged: 0, onTime: 0 }, collection: { invoices: 0, avgDays: 0 }, custody: { handovers: 0, diff: 0 } });
  assert("no data: «لا بيانات بعد» on each of the four", empty.split("\n").filter((l) => l.endsWith(`: ${EF.NO_DATA}`)).length === 4 && empty.includes("• التسليمات في وقتها: لا بيانات بعد") && empty.includes("• التالف المسجّل: لا بيانات بعد") && empty.includes("• أيام التحصيل: لا بيانات بعد") && empty.includes("• فرق العهدة: لا بيانات بعد") && empty.endsWith(EF.PERF_FOOT), empty);
  const full = EF.perfText("2026-10", { driver: true, collector: true, deliveries: { delivered: 21, judged: 20, onTime: 18 }, damage: { lines: 2, qty: 3.5, notes: 1 }, collection: { invoices: 4, avgDays: 2.5 }, custody: { handovers: 2, diff: -50 } });
  assert("with data: the numbers", full.includes("• التسليمات في وقتها: 18 من 20 (90٪) — قبل نهاية دوامه") && full.includes("• التالف المسجّل على طلبات مساراته: 3.5 في 2 سطراً، و1 ملاحظة «تالف»") && full.includes("• أيام التحصيل: 2.5 يوم في المتوسط (4 فاتورة)") && full.includes("• فرق العهدة (آخر 4 أيام، من نموذج «عهدة»): −50.00 ر.س في 2 تسليماً"), full);
  assert("deliveries with no damage on record: «لا شيء» — that is data, not «لا بيانات»", EF.perfText("2026-10", { driver: true, collector: false, deliveries: { delivered: 5, judged: 5, onTime: 5 }, damage: { lines: 0, qty: 0, notes: 0 } }).includes("• التالف المسجّل على طلبات مساراته: لا شيء"));
  assert("a driver alone gets the driver's two lines; a collector alone the collector's two", !EF.perfText("2026-10", { driver: true, collector: false }).includes("أيام التحصيل") && !EF.perfText("2026-10", { driver: false, collector: true }).includes("التسليمات"));

  world(`${D} 09:00`);
  let r = await quiet(() => EF.refreshEmployeeFile(ENV, { now: at(`${D} 09:00`) }));
  assert("the tenant today (no real delivery, no payment): every figure is «لا بيانات بعد»", r.errors.length === 0 && String(card(SAEED).x_perf_text).includes("• التسليمات في وقتها: لا بيانات بعد") && String(card(SAEED).x_perf_text).includes("• التالف المسجّل: لا بيانات بعد") && String(card(KHALID).x_perf_text).includes("• أيام التحصيل: لا بيانات بعد") && String(card(KHALID).x_perf_text).includes("• فرق العهدة: لا بيانات بعد"), String(card(SAEED).x_perf_text));
  assert("…and عمر (marketing in the tenant; here a driver with no route): no number either", !/\d+ من \d+/.test(String(card(DRIVER).x_perf_text)));
  // سعيد's routes: 06:00–14:00
  const order = (extra: Record<string, unknown> = {}) => seed("x_daily_order", { x_customer_id: 501, x_state: "delivered", x_order_date: "2026-10-05", ...extra });
  const o1 = order(), o2 = order(), o3 = order(), o4 = order();
  const route = (day: string, extra: Record<string, unknown> = {}) => seed("x_delivery_route", { x_driver_id: SAEED, x_date: day, x_status: "completed", ...extra });
  const stop = (rt: number, o: number, when: string | false, extra: Record<string, unknown> = {}) => seed("x_delivery_stop", { x_route_id: rt, x_order_id: o, x_status: when ? "delivered" : "pending", x_delivered_at: when ? utc(when) : false, ...extra });
  const r1 = route("2026-10-05"), r2 = route("2026-10-06");
  stop(r1, o1, "2026-10-05 09:00"); stop(r1, o2, "2026-10-05 13:59"); stop(r2, o3, "2026-10-06 14:30"); stop(r2, o4, false);
  stop(route("2026-10-07", { x_utak_simulation: true }), order(), "2026-10-07 09:00");   // a simulation route
  stop(route("2026-09-29"), order(), "2026-09-29 20:00");                                // last month
  seed("x_daily_order_line", { x_order_id: o1, x_product_tmpl_id: 1, x_quantity: 5, x_return_qty: 2, x_return_reason: "damaged" });
  seed("x_daily_order_line", { x_order_id: o3, x_product_tmpl_id: 1, x_quantity: 5, x_return_qty: 1.5, x_return_reason: "damaged" });
  seed("x_daily_order_line", { x_order_id: o2, x_product_tmpl_id: 1, x_quantity: 5, x_return_qty: 4, x_return_reason: "refused" });
  seed("x_complaint", { x_name: "c", x_order_id: o2, x_kind: "damaged", x_customer_id: 501 });
  seed("x_complaint", { x_name: "c", x_order_id: o2, x_kind: "damaged", x_customer_id: 501, x_is_simulation: true });
  seed("x_complaint", { x_name: "c", x_order_id: o1, x_kind: "short", x_customer_id: 501 });
  r = await quiet(() => EF.refreshEmployeeFile(ENV, { now: at(`${D} 09:00`), employeeId: EMP(SAEED) }));
  const s = String(card(SAEED).x_perf_text);
  assert("سعيد: 2 of his 3 deliveries of the month before the end of his shift (14:00) — the simulation route and last month's are not his figure", r.written.join() === String(EMP(SAEED)) && s.includes("• التسليمات في وقتها: 2 من 3 (67٪) — قبل نهاية دوامه"), s);
  assert("…the damage on those orders: 3.5 in 2 lines and one «تالف» note (a refusal is not damage; a simulation note is not counted)", s.includes("• التالف المسجّل على طلبات مساراته: 3.5 في 2 سطراً، و1 ملاحظة «تالف»"), s);
  // خالد's collections
  const inv = (issued: string, extra: Record<string, unknown> = {}) => seed("x_invoice", { x_name: "INV", x_order_id: false, x_issued_at: utc(issued), ...extra });
  const i1 = inv("2026-10-01 10:00"), i2 = inv("2026-10-03 10:00");
  const pay = (i: number, when: string, extra: Record<string, unknown> = {}) => seed("x_payment", { x_name: "P", x_method: "cash", x_amount: 100, x_collected_by: KHALID, x_collected_at: utc(when), x_invoice_id: i, ...extra });
  pay(i1, "2026-10-02 10:00"); pay(i1, "2026-10-04 10:00"); pay(i2, "2026-10-04 10:00");
  pay(inv("2026-10-01 10:00", { x_utak_simulation: true }), "2026-10-08 08:00");
  ENV.MSG_DEDUP.store.set(`custody:v1:${D}:${KHALID}`, JSON.stringify({ v: 1, day: D, collectorId: KHALID, collector: "خالد", at: 1, expected: 300, count: 3, handed: 250, how: "owner", note: "", diff: -50, corrections: 0 }));
  ENV.MSG_DEDUP.store.set(`custody:v1:2026-10-06:${KHALID}`, JSON.stringify({ v: 1, day: "2026-10-06", collectorId: KHALID, collector: "خالد", at: 1, expected: 100, count: 1, handed: 120, how: "bank", note: "", diff: 20, corrections: 0 }));
  ENV.MSG_DEDUP.store.set(`custody:v1:2026-10-03:${KHALID}`, JSON.stringify({ v: 1, day: "2026-10-03", collectorId: KHALID, collector: "خالد", at: 1, expected: 100, count: 1, handed: 0, how: "bank", note: "", diff: -100, corrections: 0 }));
  await quiet(() => EF.refreshEmployeeFile(ENV, { now: at(`${D} 09:00`), employeeId: EMP(KHALID) }));
  const kp = String(card(KHALID).x_perf_text);
  assert("خالد: an invoice's days run to its LAST collection — (3 + 1) ÷ 2 = 2 days over 2 invoices, no simulation invoice", kp.includes("• أيام التحصيل: 2 يوم في المتوسط (2 فاتورة)"), kp);
  assert("…the custody difference of the last four days: −50 + 20 in 2 handovers (the one five days ago is out)", kp.includes("• فرق العهدة (آخر 4 أيام، من نموذج «عهدة»): −30.00 ر.س في 2 تسليماً"), kp);
  assert("…and no driver's line on a collector's card", !kp.includes("التسليمات"));
  await quiet(() => EF.refreshEmployeeFile(ENV, { now: at(`${D} 09:00`) }));
  assert("another driver's routes are nobody else's figure: عمر and Baraa (drivers too) still read «لا بيانات بعد»", String(card(DRIVER).x_perf_text).includes("• التسليمات في وقتها: لا بيانات بعد") && String(card(OWNER_PID).x_perf_text).includes("• التسليمات في وقتها: لا بيانات بعد") && String(card(OWNER_PID).x_perf_text).includes("• أيام التحصيل: لا بيانات بعد"));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ و6
console.log("\n[و6] the two texts on the card");
{
  world(`${D} 09:00`);
  const writes = () => odooLog.filter((l) => l.model === "hr.employee" && l.method === "write").length;
  const r1 = await quiet(() => EF.refreshEmployeeFile(ENV, { now: at(`${D} 09:00`) }));
  assert("the first run writes the two texts and the hour on every card", r1.staff === 6 && r1.written.length === 6 && r1.errors.length === 0 && (rows("hr.employee") as any[]).every((e) => e.x_custody_text && e.x_perf_text && e.x_file_at === utc(`${D} 09:00`)), JSON.stringify(r1));
  assert("no cash journal to read (none here): «تعذّرت قراءته», never a balance of 0", String(card(KHALID).x_custody_text).includes(EF.JOURNAL_UNREAD_TEXT) && !String(card(KHALID).x_custody_text).includes("في الدفاتر"));
  const w = writes();
  const r2 = await quiet(() => EF.refreshEmployeeFile(ENV, { now: at(`${D} 09:30`) }));
  assert("nothing changed: nothing is written (the card's automations are not woken for nothing)", r2.written.length === 0 && writes() === w && card(KHALID).x_file_at === utc(`${D} 09:00`));
  seed("x_payment", { x_name: "P", x_method: "cash", x_amount: 75, x_collected_by: KHALID, x_collected_at: utc(`${D} 09:40`), x_invoice_id: seed("x_invoice", { x_name: "I", x_order_id: false }) });
  const r3 = await quiet(() => EF.refreshEmployeeFile(ENV, { now: at(`${D} 10:00`) }));
  assert("one card changed: it alone is written, with the new hour", r3.written.join() === String(EMP(KHALID)) && card(KHALID).x_file_at === utc(`${D} 10:00`) && String(card(KHALID).x_custody_text).includes("75.00") && card(SAEED).x_file_at === utc(`${D} 09:00`));
  // the button
  const post = (query: string, payload: unknown = { _model: "hr.employee", _id: EMP(SAEED) }) => { setRiyadh(`${D} 11:00`); return quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/employee-file${query}`, { method: "POST", body: JSON.stringify(payload) }), ENV, ctx)); };
  assert("«🔄 حدّث الأرقام»: a wrong token gets 401", (await post("?op=refresh&token=nope")).status === 401 && (await post("?op=refresh")).status === 401);
  assert("…another op, another model, no id: 400, nothing written", (await post(`?op=other&token=${HOOK}`)).status === 400 && (await post(`?op=refresh&token=${HOOK}`, { _model: "res.partner", _id: 5 })).status === 400 && (await post(`?op=refresh&token=${HOOK}`, { _model: "hr.employee" })).status === 400 && card(SAEED).x_file_at === utc(`${D} 09:00`));
  const ok = await post(`?op=refresh&token=${HOOK}`);
  const j = await ok.json() as any;
  assert("…the button on سعيد's card: his card alone, and the hour is written even when no text changed", ok.status === 200 && j.ok === true && j.staff === 1 && j.written.join() === String(EMP(SAEED)) && card(SAEED).x_file_at === utc(`${D} 11:00`) && card(KHALID).x_file_at === utc(`${D} 10:00`), JSON.stringify(j));
  assert("nothing was sent to anyone by any of it", graph.filter((b: any) => b?.to).length === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ و7
console.log("\n[و7] the day's one run");
{
  world(`${D} 08:05`);
  card(KHALID).passport_expiration_date = "2026-10-20";
  const run = async (riyadh: string) => { setRiyadh(riyadh); return quiet(() => EF.runEmployeeFileTick(ENV, Date.now())); };
  assert("before 08:10: nothing", (await run(`${D} 08:05`)).action === "before" && sentTo(OWNER).length === 0 && !card(KHALID).x_perf_text && EF.FILE_TICK_MINUTE === 490);
  const a = await run(`${D} 08:10`);
  assert("08:10: the papers' message, no summary (not the first), and the cards written", a.action === "ran" && (a.papers as any).outcome === "sent" && a.month === "not_first" && a.refresh!.written.length === 6 && toOwner().length === 1 && !!card(KHALID).x_perf_text, JSON.stringify(a));
  assert("the next ticks of the day: nothing more", (await run(`${D} 08:15`)).action === "done_today" && (await run(`${D} 21:00`)).action === "done_today" && toOwner().length === 1);
  assert("the next day: it runs again (and the paper told yesterday is not told again)", (await run("2026-10-09 08:10")).action === "ran" && toOwner().length === 1);
  // the cron itself, frozen
  world("2026-10-01 08:05");
  Object.assign(cfg(), { x_freeze_on: true, x_freeze_since: utc("2026-09-20 10:00") });
  card(KHALID).passport_expiration_date = "2026-10-20";
  setRiyadh("2026-10-01 08:10");
  await quiet(() => worker.scheduled({ cron: TICK } as any, ENV, ctx));
  const got = toOwner();
  assert("frozen, the */5 tick at 08:10 on the first: the papers' message AND the month's still reach Baraa (the system's own alerts), and the cards are written", got.some((t) => t.startsWith(EF.EXPIRY_HEAD)) && got.some((t) => t.startsWith("📅 ملخص الفريق — سبتمبر 2026")) && !!card(SAEED).x_custody_text, JSON.stringify(got));
  assert("…and nobody else is reached", graph.filter((b: any) => b?.to && b.to !== OWNER).length === 0);
  const n = sentTo(OWNER).length;
  setRiyadh("2026-10-01 08:15");
  await quiet(() => worker.scheduled({ cron: TICK } as any, ENV, ctx));
  assert("the next tick: nothing more of it", sentTo(OWNER).slice(n).filter((b) => /^(🗂️|📅)/.test(body(b))).length === 0);
  // Odoo not answering: the day's run is not spent
  world(`${D} 08:10`);
  const realFetch = globalThis.fetch;
  let down = true;
  globalThis.fetch = ((input: any, init: any) => (down && String(input?.url ?? input).includes("/hr.employee/") ? Promise.resolve(new Response("{}", { status: 503 })) : realFetch(input, init))) as typeof fetch;
  try {
    ENV.MSG_DEDUP.store.delete("team:roster:v1");
    const off = await run(`${D} 08:10`);
    down = false;
    const on = await run(`${D} 08:15`);
    assert("Odoo did not answer at 08:10: the run is tried again at the next tick", off.action === "roster_unreadable" && on.action === "ran", JSON.stringify([off.action, on.action]));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

done();
