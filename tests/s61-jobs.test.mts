// § 61 (2026-10-06) — the jobs: the job is fixed and the employee changes.
//
//   [ب1] an employee's roles = his job's ∪ his card's — and the three of the team hold, letter for
//        letter, what they held before the jobs existed: with the jobs assigned, and with their cards emptied
//   [ب2] the schedule: the card's when one was chosen there, else the job's default; attendance: either
//   [ب3] everything that followed the roles follows these (the tasks, the gateway's guard for Baraa), within
//        the roster's five minutes
//   [ب4] the cost guard: 641.23 for 2026-10-06 before and after
//   [ب5] a job nobody holds: its tasks reach Baraa as before, and the 21:30 summary names it
//   [د1] in: Baraa's «👤 … صار …» with the takeover list, and the employee's welcome (his window, the template
//        outside it — UTILITY only — else its text to Baraa)
//   [د2] out: the handover list with what the system reads, and his kept tasks moved; nothing written in Odoo
//   [د3] the daily data check: one line, only when it finds something; no cost line created or changed
//   [و]  the three trials: Baraa's number alone, once a day, nothing written and nothing moved
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s61-jobs.test.mts

import { readFileSync } from "node:fs";
import { COLL, OWNER, WH, WH_PHONE, closeOwnerWindow, ctx, employee, heldFor, job, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, table, workSchedule } from "./wa-harness.mts";
import { ALL_WEEK, C1, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, cost, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

const TR = await import("../src/team-roster.ts");
const ST = await import("../src/staffing.ts");
const TRIAL = await import("../src/s61-trials.ts");
const OC = await import("../src/operating-cost.ts");
const OT = await import("../src/owner-team.ts");
const SUM = await import("../src/owner-summary.ts");
const TQ = await import("../src/team-queue.ts");
const PUR = await import("../src/wa-purposes.ts");
const { withAutoSendJob } = await import("../src/auto-send-guard.ts");
const { getTeamMembersByRole, findTeamMemberByWhatsApp } = await import("../src/odoo.ts");
const { sendText } = await import("../src/meta.ts");
const worker = (await import("../src/index.ts")).default;
const { TEAM_WELCOME } = await import("../scripts/lib/s61-templates.mjs");
const JOBS61 = await import("../scripts/lib/s61-odoo.mjs");

const OWNER_PID = 45, OWNER_EMP = 7000 + OWNER_PID;
const OTHMAN = 15, OTHMAN_EMP = 7000 + OTHMAN, OTHMAN_PHONE = "966500000015";
const NEW = 700, NEW_EMP = 7000 + NEW, NEW_PHONE = "966500000700";
const WAREHOUSE = 71, DRIVER_ROLE = 72, COLLECTOR = 73, MARKETING = 74, ADMIN = 75;
const D6 = "2026-10-06";
const body = (b: any): string => String(b?.text?.body ?? b?.interactive?.body?.text ?? "");
const textsTo = (digits: string) => sentTo(digits).filter((b) => b?.type === "text").map(body);
const tplName = (b: any): string => String(b?.template?.name ?? "");
const tplParams = (b: any): string[] => ((b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters ?? []).map((p: any) => String(p.text ?? ""));
const emp = (id: number) => table("hr.employee").get(id) as any;
const config = () => table("x_pricing_config").get(1) as any;
const drop = (env: any) => { env.MSG_DEDUP.store.delete(TR.ROSTER_KV); env.MSG_DEDUP.store.delete(TR.ROLES_KV); };
const tick = (env: any, at = Date.now()) => quiet(() => ST.runStaffingTick(withAutoSendJob(env, ST.STAFFING_JOB), at));
const writes = () => odooLog.filter((l) => ["create", "write", "unlink"].includes(l.method) && !["x_wa_message", "discuss.channel", "discuss.channel.member", "mail.message", "res.partner"].includes(l.model));
const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;

/** The tenant's cost lines in force on 2026-10-06 (641.23 with 31 working days). */
function tenantCosts(): void {
  cost(500, "2026-10-06", { x_name: "دينة مؤقتة" });
  cost(83, "2026-10-01", { x_name: "رسوم دخول السوق" });
  cost(50, "2026-10-01", { x_name: "العربية" });
  for (const [name, amount] of [["اشتراك Odoo", 80], ["Claude API", 75], ["الرصيد والاتصالات", 100]] as const) cost(amount, "2026-10-01", { x_name: name, x_frequency: "monthly", x_cost_type: "fixed" });
}
interface World { env: any; cal: number; calOthman: number; calOmar: number; cal40: number }
/** The tenant after § 59, before the jobs: Baraa سائق + شراء + محصّل, Omar تسويق, Othman مدير — on their cards. */
function before61(riyadh = `${D6} 22:00`): World {
  const env = fresh(riyadh);
  env.ODOO_HOOK_TOKEN = "HOOK";
  seed("x_employee_role", { id: MARKETING, x_code: "marketing", x_name: "تسويق", x_active: true });
  seed("x_employee_role", { id: ADMIN, x_code: "admin", x_name: "مدير", x_active: true });
  emp(7000 + WH).x_utak_role_ids = [];
  emp(7000 + COLL).x_utak_role_ids = [];
  const cal = workSchedule(ALL_WEEK, { name: "UTAK — أيام العمل" });
  const calOthman = workSchedule([[5, 6, 16], [6, 6, 16], [0, 6, 16], [1, 6, 16], [2, 6, 16], [3, 6, 16]], { name: "UTAK — عثمان" });
  const calOmar = emp(OMAR_EMP).resource_calendar_id as number;
  // Odoo's own default schedule: on the company, and on every new card; duration lines, no clock time
  const cal40 = seed("resource.calendar", { name: "40 hours/week", calendar_type: "fixed", company_id: 1 });
  for (const d of [0, 1, 2, 3, 4]) seed("resource.calendar.attendance", { calendar_id: cal40, dayofweek: String(d), hour_from: 0, hour_to: 0, duration_based: true, date: false, recurrency: false });
  seed("res.company", { id: 1, name: "يوتاك", resource_calendar_id: cal40 });
  config().x_workdays_calendar_id = cal;
  seed("res.partner", { id: OWNER_PID, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER, customer_rank: 1 });
  employee(OWNER_PID, [WAREHOUSE, DRIVER_ROLE, COLLECTOR], { name: "براء", x_utak_attendance: true, resource_calendar_id: cal });
  Object.assign(emp(OMAR_EMP), { x_utak_role_ids: [MARKETING], x_utak_attendance: false, x_price_source: false, x_price_role: "market" });
  seed("res.partner", { id: OTHMAN, name: "عثمان عبدالوهاب", x_whatsapp_number: "+" + OTHMAN_PHONE });
  employee(OTHMAN, [ADMIN], { name: "عثمان عبدالوهاب", x_utak_attendance: true, resource_calendar_id: calOthman });
  seed("x_whatsapp_template", { x_purpose: TEAM_WELCOME.purpose, x_meta_template_id: TEAM_WELCOME.name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: TEAM_WELCOME.params, x_category: "UTILITY" });
  drop(env);
  return { env, cal, calOthman, calOmar, cal40 };
}
interface Jobs { operations: number; marketing: number; coordinator: number; driver: number }
const TAKEOVER = ["رقم واتسابه على جهة اتصاله.", "مفاتيح المركبة ووثائقها إن وُجدت."];
const HANDOVER = ["العهدة والكاش: يسلّم كل ما معه.", "مفاتيح المركبة ووثائقها."];
/** What scripts/s61-20261006-odoo.mjs writes BEFORE the code: the four jobs, and each holder's job (the cards untouched). */
function base61(w: World): Jobs {
  const texts = { x_takeover_list: ul(TAKEOVER), x_handover_list: ul(HANDOVER) };
  const j: Jobs = {
    operations: job("مندوب تشغيل", [WAREHOUSE, DRIVER_ROLE, COLLECTOR], { sequence: 10, x_default_calendar_id: w.cal, x_job_attendance: true, ...texts }),
    marketing: job("مندوب تسويق", [MARKETING], { sequence: 20, x_default_calendar_id: w.calOmar, ...texts }),
    coordinator: job("منسق عمليات", [ADMIN], { sequence: 30, x_default_calendar_id: w.calOthman, ...texts }),
    driver: job("سائق توصيل", [DRIVER_ROLE], { sequence: 40, x_default_calendar_id: w.cal, x_job_attendance: true, ...texts }),
  };
  emp(OWNER_EMP).job_id = j.operations;
  emp(OMAR_EMP).job_id = j.marketing;
  emp(OTHMAN_EMP).job_id = j.coordinator;
  drop(w.env);
  return j;
}
/** …and WITH the deploy (--only=cards): the three cards emptied of what their job carries. */
function cards61(w: World): void {
  for (const id of [OWNER_EMP, OMAR_EMP, OTHMAN_EMP]) emp(id).x_utak_role_ids = [];
  drop(w.env);
}
function after61(riyadh = `${D6} 22:00`): World & { jobs: Jobs } {
  const w = before61(riyadh);
  const jobs = base61(w);
  cards61(w);
  return { ...w, jobs };
}
/** The team as every path of the worker follows it (what scripts/s61-20261006-roles.mts compares on the tenant). */
async function team(env: any): Promise<string> {
  const r = await quiet(() => TR.fetchRoster(env));
  return JSON.stringify([...r.members].sort((a: any, b: any) => a.employeeId - b.employeeId).map((m: any) => {
    const p = TR.dayPlan(r, m, D6);
    return [m.employeeId, m.name, m.partnerId, m.whatsapp, m.codes, m.attendance, m.calendarId, m.neighborhoods, p.kind, p.startMin ?? null, p.endMin ?? null];
  }));
}
/** A new employee as Baraa makes him in «الموظفون»: his contact with his number, the card Odoo fills (its default schedule), and his job. */
function hire(w: World, jobId: number | false, extra: Record<string, unknown> = {}, number: string | false = "+" + NEW_PHONE): void {
  seed("res.partner", { id: NEW, name: "سالم الحربي", x_whatsapp_number: number });
  employee(NEW, [], { name: "سالم الحربي", resource_calendar_id: w.cal40, job_id: jobId, ...extra });
}

// ================================================================ ب1 — the roles of the three, before and after
console.log("\n[ب1] the effective roles: the job's ∪ the card's — the three of the team hold what they held, letter for letter");
{
  const w = before61();
  const before = await team(w.env);
  const b = JSON.parse(before);
  assert("before the jobs: Baraa شراء + سائق + محصّل on attendance, Omar تسويق off it, Othman مدير on it", b.length === 3
    && JSON.stringify(b.map((m: any) => [m[1], m[4], m[5]])) === JSON.stringify([["عثمان عبدالوهاب", ["admin"], true], ["براء", ["warehouse", "driver", "collector"], true], ["عمر المجهلي", ["marketing"], false]]), before);
  const jobs = base61(w);
  const assigned = await team(w.env);
  assert("the jobs assigned, the cards as they were (Odoo before the code's deploy): the same team, letter for letter", assigned === before, assigned);
  cards61(w);
  const emptied = await team(w.env);
  assert("the three cards emptied of what their job carries: the same team again, letter for letter", emptied === before, emptied);
  assert("…and the cards ARE empty: every role of the three comes from the job", [OWNER_EMP, OMAR_EMP, OTHMAN_EMP].every((id) => emp(id).x_utak_role_ids.length === 0));
  const r = await quiet(() => TR.fetchRoster(w.env));
  const named = [...r.members].sort((a: any, b: any) => a.employeeId - b.employeeId).map((m: any) => [m.name, m.jobId, m.jobName]);
  assert("the roster names each one's job", JSON.stringify(named) === JSON.stringify([["عثمان عبدالوهاب", jobs.coordinator, "منسق عمليات"], ["براء", jobs.operations, "مندوب تشغيل"], ["عمر المجهلي", jobs.marketing, "مندوب تسويق"]]), JSON.stringify(named));
  assert("…and the four jobs with what each gives, in their order", JSON.stringify(r.jobs.map((j: any) => [j.name, j.codes, j.attendance, j.calendarId])) === JSON.stringify([["مندوب تشغيل", ["warehouse", "driver", "collector"], true, w.cal], ["مندوب تسويق", ["marketing"], false, w.calOmar], ["منسق عمليات", ["admin"], false, w.calOthman], ["سائق توصيل", ["driver"], true, w.cal]]), JSON.stringify(r.jobs));

  // an additional role on the card is added to the job's — the job's first, no role twice
  emp(OMAR_EMP).x_utak_role_ids = [COLLECTOR, MARKETING]; drop(w.env);
  const omar = (await quiet(() => TR.fetchRoster(w.env))).members.find((m: any) => m.employeeId === OMAR_EMP) as any;
  assert("«أدوار إضافية» on the card: Omar's job gives تسويق, his card adds محصّل (the job's first, none twice)", JSON.stringify(omar.codes) === JSON.stringify(["marketing", "collector"]), JSON.stringify(omar.codes));
  assert("pure: effectiveCodes(job, card) = the job's then what the card adds", JSON.stringify(TR.effectiveCodes(["driver"], ["collector", "driver"])) === JSON.stringify(["driver", "collector"]) && TR.effectiveCodes([], []).length === 0);
  assert("…the collector's tasks follow it: Omar is among «محصّل» now, with Baraa", JSON.stringify((await quiet(() => getTeamMembersByRole(w.env, "collector"))).map((m: any) => m.name).sort()) === JSON.stringify(["براء", "عمر المجهلي"].sort()));
  emp(OMAR_EMP).x_utak_role_ids = []; drop(w.env);

  // a card's role alone, with no job: as before § 61
  emp(7000 + WH).x_utak_role_ids = [WAREHOUSE]; drop(w.env);
  const wh = (await quiet(() => TR.fetchRoster(w.env))).members.find((m: any) => m.employeeId === 7000 + WH) as any;
  assert("an employee with a role on his card and no job is on the team as before", !!wh && JSON.stringify(wh.codes) === JSON.stringify(["warehouse"]) && wh.jobId === null && wh.jobName === "");
  emp(7000 + WH).x_utak_role_ids = []; drop(w.env);

  // an archived job gives nothing
  table("hr.job").get(jobs.marketing)!.active = false; drop(w.env);
  const gone = await quiet(() => TR.fetchRoster(w.env));
  assert("an archived job gives its holder nothing: Omar (an empty card) is off the team, and the job off the list", !gone.members.some((m: any) => m.employeeId === OMAR_EMP) && !gone.jobs.some((j: any) => j.id === jobs.marketing) && !gone.staff.some((m: any) => m.employeeId === OMAR_EMP));
  table("hr.job").get(jobs.marketing)!.active = true; drop(w.env);
  assert("the schema gate saw no field or value the tenant does not have", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ ب2 — the schedule and the attendance
console.log("\n[ب2] the schedule: the card's when chosen, else the job's default; «مشمول بالتحضير»: the card or the job");
{
  const w = after61();
  hire(w, w.jobs.driver); drop(w.env);
  let r = await quiet(() => TR.fetchRoster(w.env));
  let m = r.members.find((x: any) => x.employeeId === NEW_EMP) as any;
  assert("a new card (Odoo's default «40 hours/week» on it) + the job «سائق توصيل»: the job's roles", !!m && JSON.stringify(m.codes) === JSON.stringify(["driver"]) && m.jobName === "سائق توصيل");
  assert("…the job's default schedule, not Odoo's default on the card", m.calendarId === w.cal && m.calendarName === "UTAK — أيام العمل", JSON.stringify([m.calendarId, m.calendarName]));
  assert("…and on attendance by the job alone (the card's flag is off)", m.attendance === true && emp(NEW_EMP).x_utak_attendance === false);
  const plan = TR.dayPlan(r, m, "2026-10-07");
  assert("…so his «بدء الدوام» is due at the job's hour: 02:00–12:00", plan.kind === "work" && plan.startMin === 120 && plan.endMin === 720, JSON.stringify(plan));
  assert("pure: no schedule on the card → the job's; the company's default on the card → the job's; a chosen one → the card's; no job's default → the card's",
    TR.effectiveCalendar({ id: null, name: "" }, { id: 5, name: "j" }, 1).id === 5 && TR.effectiveCalendar({ id: 1, name: "c" }, { id: 5, name: "j" }, 1).id === 5
    && TR.effectiveCalendar({ id: 3, name: "c" }, { id: 5, name: "j" }, 1).id === 3 && TR.effectiveCalendar({ id: 1, name: "c" }, { id: null, name: "" }, 1).id === 1 && TR.effectiveCalendar({ id: 1, name: "c" }, null, 1).id === 1);

  // a schedule Baraa chose on the card wins the job's
  emp(NEW_EMP).resource_calendar_id = w.calOthman; drop(w.env);
  r = await quiet(() => TR.fetchRoster(w.env));
  m = r.members.find((x: any) => x.employeeId === NEW_EMP) as any;
  assert("a schedule chosen on the card wins the job's default (06:00–16:00)", m.calendarId === w.calOthman && TR.dayPlan(r, m, "2026-10-07").startMin === 360);

  // attendance: the card OR the job
  const coord = r.members.find((x: any) => x.employeeId === OTHMAN_EMP) as any;
  assert("Othman: his job says «لا», his card says «نعم» → on attendance, on his own schedule (as before)", coord.attendance === true && coord.calendarId === w.calOthman && table("hr.job").get(w.jobs.coordinator)!.x_job_attendance === false);
  const omar = r.members.find((x: any) => x.employeeId === OMAR_EMP) as any;
  assert("Omar: neither says «نعم» → off attendance", omar.attendance === false);

  // a holder of a job without roles is on the staff, not on the team
  const plainJob = job("محاسب", [], { sequence: 50 });
  emp(NEW_EMP).job_id = plainJob; drop(w.env);
  r = await quiet(() => TR.fetchRoster(w.env));
  assert("a job without roles: its holder is on the staff (his entry and exit are announced), not on the team (no task follows him)", r.staff.some((x: any) => x.employeeId === NEW_EMP && x.jobId === plainJob) && !r.members.some((x: any) => x.employeeId === NEW_EMP)
    && (await quiet(() => findTeamMemberByWhatsApp(w.env, "+" + NEW_PHONE))) === null);
  assert("the schema gate saw no field or value the tenant does not have", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ ب3 — what follows the roles
console.log("\n[ب3] everything that followed the roles follows the effective ones, within the roster's five minutes");
{
  const w = after61();
  const names = async (role: string) => (await quiet(() => getTeamMembersByRole(w.env, role as any))).map((m: any) => m.name);
  assert("the buyer, the driver and the collector are Baraa (his card is empty: the job's roles)", JSON.stringify([await names("warehouse"), await names("driver"), await names("collector")]) === JSON.stringify([["براء"], ["براء"], ["براء"]]));
  assert("the marketing member is Omar", JSON.stringify(await names("marketing")) === JSON.stringify(["عمر المجهلي"]));
  assert("the gateway's guard: Baraa holds a team role (the job's) → a team purpose may reach his number", (await quiet(() => OT.ownerOnTeam(w.env))) === true && (await quiet(() => OT.teamPurposeForOwner(w.env, "purchase_list"))) === true);
  const sent = await quiet(() => sendText(w.env, "+" + OWNER, "قائمة الشراء", { purpose: "purchase_list" }));
  assert("…a purchase list to his number goes (200)", sent.ok === true && textsTo(OWNER).includes("قائمة الشراء"), String(sent.status));

  // the job is taken off Baraa: within five minutes nothing of the team reaches him
  emp(OWNER_EMP).job_id = false;
  assert("the roster is cached: inside five minutes the old one still answers", JSON.stringify(await names("warehouse")) === JSON.stringify(["براء"]));
  setRiyadh(`${D6} 22:06`);
  assert("after five minutes (no hook, no deploy): Baraa holds nothing", JSON.stringify(await names("warehouse")) === "[]" && (await quiet(() => OT.ownerOnTeam(w.env))) === false);
  const refused = await quiet(() => sendText(w.env, "+" + OWNER, "قائمة الشراء 2", { purpose: "purchase_list" }));
  assert("…and a team purpose to his number is refused again", refused.ok === false && !textsTo(OWNER).includes("قائمة الشراء 2"), String(refused.status));

  // a new driver takes the vacant job: the driver's tasks are his, at once after the roster's reload
  hire(w, w.jobs.driver); drop(w.env);
  assert("a new employee on «سائق توصيل»: the driver is him", JSON.stringify(await names("driver")) === JSON.stringify(["سالم الحربي"]) && (await quiet(() => findTeamMemberByWhatsApp(w.env, "+" + NEW_PHONE)))?.x_role === "driver");

  // a roster cached by the code of before § 61 (no jobs, no staff) is not read as this one
  const old = { loadedAt: Date.now(), members: [], lines: [], leaves: [] };
  w.env.MSG_DEDUP.store.set(TR.ROSTER_KV, JSON.stringify(old));
  assert("a roster cached by the code of before (no jobs, no staff) is read again from Odoo", (await quiet(() => TR.loadRoster(w.env))).members.length === 3);
  assert("the schema gate saw no field or value the tenant does not have", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ ب4 — the cost guard
console.log("\n[ب4] the cost of 2026-10-06 = 641.23 before the jobs and after: the working days are the company's");
{
  const w = before61(`${D6} 09:00`); tenantCosts();
  const b = await quiet(() => OC.dailyOperatingCost(w.env, D6));
  assert("before the jobs: 641.23 (500 + 83 + 50 + 255 ÷ 31), from «UTAK — أيام العمل»", b.total === 641.23 && b.monthWorkingDays === 31 && b.source === "company" && b.driver === "UTAK — أيام العمل", JSON.stringify([b.total, b.monthWorkingDays, b.source, b.driver]));
  base61(w);
  const a1 = await quiet(() => OC.dailyOperatingCost(w.env, D6));
  cards61(w);
  const a2 = await quiet(() => OC.dailyOperatingCost(w.env, D6));
  assert("the jobs assigned: 641.23; the cards emptied: 641.23", a1.total === 641.23 && a2.total === 641.23 && a2.monthWorkingDays === 31 && a2.source === "company", JSON.stringify([a1.total, a2.total]));
  assert("…each line's share as before", JSON.stringify(a2.items.map((i: any) => i.perDay)) === JSON.stringify(b.items.map((i: any) => i.perDay)));
  // whoever holds the driver's job, and whatever its default schedule
  table("hr.job").get((rows("hr.job").find((j: any) => j.name === "سائق توصيل") as any).id)!.x_default_calendar_id = w.calOthman;
  hire(w, (rows("hr.job").find((j: any) => j.name === "سائق توصيل") as any).id); drop(w.env);
  const a3 = await quiet(() => OC.dailyOperatingCost(w.env, D6));
  assert("a new driver on a job with a 6-day schedule: still 641.23 (the cost never follows a job's schedule)", a3.total === 641.23 && a3.monthWorkingDays === 31, JSON.stringify([a3.total, a3.monthWorkingDays]));
  assert("no cost line was created or changed by any of it", !odooLog.some((l) => l.model === "x_operating_cost" && l.method !== "search_read"));
}

// ================================================================ ب5 — a job nobody holds
console.log("\n[ب5] a job nobody holds: its tasks reach Baraa as before, and the 21:30 summary names it");
{
  const w = after61();
  const r = await quiet(() => TR.loadRoster(w.env));
  assert("«سائق توصيل» is vacant (roles, no holder): «وظيفة شاغرة: سائق توصيل»", JSON.stringify(ST.vacantJobs(r).map((j: any) => j.name)) === JSON.stringify(["سائق توصيل"]) && ST.vacancyLine(ST.vacantJobs(r)) === "وظيفة شاغرة: سائق توصيل");
  assert("pure: two vacant jobs are joined, none gives no line", ST.vacancyLine([{ name: "أ" }, { name: "ب" }]) === "وظيفة شاغرة: أ، ب" && ST.vacancyLine([]) === "");
  job("محاسب", [], { sequence: 50 }); drop(w.env);
  assert("a job without roles is not «شاغرة» (no task follows it)", JSON.stringify(ST.vacantJobs(await quiet(() => TR.loadRoster(w.env))).map((j: any) => j.name)) === JSON.stringify(["سائق توصيل"]));
  const lines = await quiet(() => ST.staffingLines(w.env, D6));
  assert("the summary's lines: the vacancy first", lines[0] === "وظيفة شاغرة: سائق توصيل", JSON.stringify(lines));
  const f = await quiet(() => SUM.readSummaryFigures(w.env));
  const text = SUM.summaryText(f).split("\n");
  assert("the 21:30 summary carries it after «خلاصة اليوم», as its own line", JSON.stringify(f.staffing) === JSON.stringify(lines) && text.includes("وظيفة شاغرة: سائق توصيل") && text.indexOf("وظيفة شاغرة: سائق توصيل") > text.findIndex((l) => l.startsWith("➡️")), text.join(" | "));
  assert("…and the follow-up text after a template carries it too", SUM.insightFollowUp(f).split("\n").includes("وظيفة شاغرة: سائق توصيل"));

  // the role's tasks: Baraa holds «سائق» by his own job, so the driver's tasks are his
  assert("the vacant job's role is still held (Baraa's job carries «سائق»): the driver's tasks reach him", (await quiet(() => getTeamMembersByRole(w.env, "driver"))).map((m: any) => m.name).join() === "براء");
  // nobody holds «شراء» at all: 21:15 tells Baraa, as it always did
  emp(OWNER_EMP).job_id = false; drop(w.env);
  seed("x_daily_order", { id: 9001, x_customer_id: C1, x_state: "confirmed", x_order_date: D6, x_created_via: "whatsapp", x_utak_simulation: false });
  seed("x_daily_order_line", { x_order_id: 9001, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 3, x_unit_price: 20, x_status: "pending" });
  const { aggregateAndDispatchToWarehouse } = await import("../src/team.ts");
  await quiet(() => aggregateAndDispatchToWarehouse(w.env));
  assert("a role with no holder at all («شراء»): the list is made and Baraa is told, as before — no task is lost", ownerTexts().some((t) => t.includes("ما يوجد موظف مستودع") && t.includes("القائمة أنشئت")) && rows("x_purchase_list").length === 1, ownerTexts().join(" | "));
  const vac = ST.vacantJobs(await quiet(() => TR.loadRoster(w.env))).map((j: any) => j.name);
  assert("…and both jobs are named vacant now", JSON.stringify(vac) === JSON.stringify(["مندوب تشغيل", "سائق توصيل"]), JSON.stringify(vac));
}

// ================================================================ د1 — in
console.log("\n[د1] an employee is given a job: Baraa's «👤 … صار …» with the takeover list, and the employee's welcome");
{
  // the first tick only keeps the roster: whoever holds a job when the code goes live is not new
  const w = after61(`${D6} 22:00`);
  let t = await tick(w.env);
  assert("the first tick: the roster kept, nothing announced (the three hold their jobs already)", t.action === "baseline" && sentTo(OWNER).length === 0 && sentTo(DRIVER_PHONE).length === 0 && sentTo(OTHMAN_PHONE).length === 0 && !!w.env.MSG_DEDUP.store.get(ST.STAFF_KV));
  t = await tick(w.env);
  assert("the next tick with nothing changed: nothing", t.action === "none" && sentTo(OWNER).length === 0);
  const baseline = w.env.MSG_DEDUP.store.get(ST.STAFF_KV);

  // Baraa adds an employee and picks his job; his window is closed (he never wrote): the template
  hire(w, w.jobs.driver);
  t = await tick(w.env);
  assert("inside the roster's five minutes (no hook): not seen yet", t.action === "none" && sentTo(NEW_PHONE).length === 0);
  setRiyadh(`${D6} 22:06`);
  t = await tick(w.env);
  const own = ownerTexts();
  assert("after them: one move, announced", t.action === "moves" && JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:in:template"]), JSON.stringify(t));
  assert("Baraa: «👤 سالم الحربي صار سائق توصيل: الأدوار سائق · الجدول UTAK — أيام العمل · أول مهمة «بدء الدوام» الأربعاء 02:00»", own.length === 1 && own[0].split("\n")[0] === "👤 سالم الحربي صار سائق توصيل: الأدوار سائق · الجدول UTAK — أيام العمل · أول مهمة «بدء الدوام» الأربعاء 02:00", own[0]);
  assert("…then the job's «قائمة الاستلام», point by point", own[0].split("\n").slice(1, 4).join("\n") === ["قائمة الاستلام:", ...TAKEOVER.map((p) => `• ${p}`)].join("\n"), own[0]);
  assert("…and how the welcome went: by the template (his window is closed)", own[0].split("\n")[4] === "✉️ وصله ترحيبه بالقالب (نافذته مغلقة)." && own[0].split("\n").length === 5, own[0]);
  const got = sentTo(NEW_PHONE);
  assert("the employee: the template utak_team_welcome_v1 with its three variables — his name, his job, when his first task comes", got.length === 1 && tplName(got[0]) === "utak_team_welcome_v1"
    && JSON.stringify(tplParams(got[0])) === JSON.stringify(["سالم الحربي", "سائق توصيل", "مع بداية دوامك يوم الأربعاء الساعة 02:00"]), JSON.stringify(got));
  assert("…nothing is held for him, and nobody else got anything", heldFor(w.env, NEW_PHONE).length === 0 && sentTo(DRIVER_PHONE).length === 0 && sentTo(OTHMAN_PHONE).length === 0);
  t = await tick(w.env);
  assert("the next tick: nothing again (announced once)", t.action === "none" && ownerTexts().length === 1 && sentTo(NEW_PHONE).length === 1);
  // the kept roster lost (a KV write that failed after the sends): the move's own claim stops a second announcement
  w.env.MSG_DEDUP.store.set(ST.STAFF_KV, baseline);
  t = await tick(w.env);
  assert("the kept roster lost: the same entry is not announced twice that day", JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:in:claimed_before"]) && ownerTexts().length === 1 && sentTo(NEW_PHONE).length === 1, JSON.stringify(t));
  assert("nothing was written in Odoo by any tick (no employee, no job, no cost line)", writes().length === 0, JSON.stringify(writes().map((l) => `${l.model}.${l.method}`)));
  assert("the welcome's text IS the template's body with its variables (scripts/lib/s61-templates.mjs)",
    ST.welcomeText(["سالم", "سائق توصيل", "مع أول مسار توصيل"]) === TEAM_WELCOME.body.replace("{{1}}", "سالم").replace("{{2}}", "سائق توصيل").replace("{{3}}", "مع أول مسار توصيل")
    && TEAM_WELCOME.purpose === ST.TEAM_WELCOME_PURPOSE && TEAM_WELCOME.params === 3 && TEAM_WELCOME.name === "utak_team_welcome_v1" && !!PUR.PURPOSES[ST.TEAM_WELCOME_PURPOSE]);
  assert("the schema gate saw no field or value the tenant does not have", rejected.length === 0, rejected.join(" | "));
}
{
  // his window is open: the welcome as a text
  const w = after61(); await tick(w.env);
  hire(w, w.jobs.driver); openWindow(w.env, NEW_PHONE); drop(w.env);
  const t = await tick(w.env);
  const got = sentTo(NEW_PHONE);
  assert("his window open: the welcome as a text, the template's words", JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:in:session"]) && got.length === 1 && got[0].type === "text"
    && body(got[0]) === "مرحباً سالم الحربي، تم تسجيلك في فريق يو تاك بوظيفة سائق توصيل. أول مهمة تصلك مع بداية دوامك يوم الأربعاء الساعة 02:00. مهامك وتحديثاتها تصلك في هذه المحادثة.", JSON.stringify(got));
  assert("…and Baraa reads «✉️ وصله ترحيبه في واتساب.»", ownerTexts()[0].split("\n").at(-1) === "✉️ وصله ترحيبه في واتساب.");
}
for (const [label, patch] of [["filed MARKETING", { x_category: "MARKETING" }], ["still pending", { x_meta_status: "PENDING" }], ["refused", { x_meta_status: "REJECTED" }]] as const) {
  const w = after61(); await tick(w.env);
  Object.assign(rows("x_whatsapp_template").find((r: any) => r.x_purpose === "team_welcome") as any, patch);
  hire(w, w.jobs.driver); drop(w.env);
  const t = await tick(w.env);
  const own = ownerTexts()[0] ?? "";
  assert(`the template ${label}: never used — nothing sent to the employee, nothing held for him`, JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:in:not_sent"]) && sentTo(NEW_PHONE).length === 0 && heldFor(w.env, NEW_PHONE).length === 0, JSON.stringify(t) + JSON.stringify(sentTo(NEW_PHONE)));
  assert(`the template ${label}: Baraa gets the welcome's text to send himself`, own.includes("✉️ ترحيبه لم يُرسل (نافذته مغلقة ولا قالب معتمد). أرسله له بنفسك:\nمرحباً سالم الحربي، تم تسجيلك في فريق يو تاك بوظيفة سائق توصيل."), own);
}
{
  // no number on his contact; and a job with attendance and no schedule anywhere
  const w = after61(); await tick(w.env);
  table("hr.job").get(w.jobs.driver)!.x_default_calendar_id = false;
  hire(w, w.jobs.driver, { resource_calendar_id: false }, false); drop(w.env);
  const t = await tick(w.env);
  const own = ownerTexts()[0] ?? "";
  assert("no number: no welcome, and Baraa is warned", JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:in:no_number"]) && own.includes(ST.NO_NUMBER_WARNING) && own.includes("✉️ لا ترحيب: لا رقم له."), own);
  assert("…on attendance with no schedule: warned too, «الجدول بلا جدول», and the first task is his role's", own.includes(ST.NO_SCHEDULE_WARNING) && own.split("\n")[0] === "👤 سالم الحربي صار سائق توصيل: الأدوار سائق · الجدول بلا جدول · أول مهمة مسار التوصيل بعد الشراء", own);
}
{
  // Baraa himself is given a job: his message, no welcome to himself; a job without a takeover list says so
  const w = after61();
  emp(OWNER_EMP).job_id = false; drop(w.env);
  await tick(w.env);
  table("hr.job").get(w.jobs.operations)!.x_takeover_list = false;
  emp(OWNER_EMP).job_id = w.jobs.operations; drop(w.env);
  const t = await tick(w.env);
  const own = ownerTexts();
  assert("Baraa takes a job: his one message, no welcome to himself", JSON.stringify(t.moves) === JSON.stringify(["براء:in:owner"]) && own.length === 1 && !sentTo(OWNER).some((b) => tplName(b) === "utak_team_welcome_v1") && !own[0].includes("✉️"), own.join(" | "));
  assert("…«الأدوار سائق + شراء + محصّل» in Baraa's words, and a job without the list says it is not written", own[0].split("\n")[0].startsWith("👤 براء صار مندوب تشغيل: الأدوار شراء + سائق + محصّل · الجدول UTAK — أيام العمل · أول مهمة «بدء الدوام» ") && own[0].includes(ST.NO_TAKEOVER_TEXT), own[0]);
  assert("pure: the roles as Baraa reads them — «مدير» routes no message", ST.rolesText(["driver", "warehouse", "collector"]) === "سائق + شراء + محصّل" && ST.rolesText(["admin"]) === "بلا أدوار رسائل" && ST.rolesText([]) === "بلا أدوار رسائل" && ST.rolesText(["marketing"]) === "تسويق");
  assert("pure: the first task by role when there is no shift to wait for", ST.firstTaskForOwner({ kind: "purchase" }) === "قائمة الشراء 21:15" && ST.firstTaskForMember({ kind: "purchase" }) === "مع قائمة الشراء الساعة 21:15"
    && ST.firstTaskForOwner({ kind: "prices" }) === "قائمة الأسعار مع أول نشر" && ST.firstTaskForMember({ kind: "prices" }) === "مع أول نشر لقائمة الأسعار"
    && ST.firstTaskForOwner({ kind: "collection" }) === "أول طلب تحصيل" && ST.firstTaskForMember({ kind: "collection" }) === "مع أول طلب تحصيل"
    && ST.firstTaskForMember({ kind: "route" }) === "مع أول مسار توصيل" && ST.firstTaskForOwner({ kind: "none" }) === "لا مهام آلية لهذه الوظيفة" && ST.firstTaskForMember({ kind: "none" }) === "من براء مباشرة");
  const r = await quiet(() => TR.loadRoster(w.env));
  const mk = r.members.find((m: any) => m.employeeId === OMAR_EMP) as any;
  assert("…a marketing member off attendance: the price list with the first publication", ST.firstTask(r, mk, Date.now()).kind === "prices");
  assert("pure: the points of a list — an HTML list, paragraphs, or lines; tags and entities out", JSON.stringify(ST.htmlPoints("<ul><li><p>أ &amp; ب</p></li><li>ج&nbsp;د</li></ul>")) === JSON.stringify(["أ & ب", "ج د"])
    && JSON.stringify(ST.htmlPoints("<p>أ</p><p>ب</p>")) === JSON.stringify(["أ", "ب"]) && ST.htmlPoints(false).length === 0 && ST.htmlPoints("<p><br></p>").length === 0);
}
{
  // the pulse itself runs it (index.ts «*/5»), under its own send job
  const w = after61(); await tick(w.env);
  hire(w, w.jobs.driver); drop(w.env);
  await quiet(() => worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() } as any, w.env, ctx));
  assert("the five-minute pulse announces the entry (Baraa's message and the employee's template)", ownerTexts().some((t) => t.startsWith("👤 سالم الحربي صار سائق توصيل")) && sentTo(NEW_PHONE).some((b) => tplName(b) === "utak_team_welcome_v1"), ownerTexts().join(" | "));
}

// ================================================================ د2 — out
console.log("\n[د2] an employee leaves his job: the handover list with what the system reads, and his kept tasks");
function leaverWorld(): World & { jobs: Jobs } {
  const w = after61(`${D6} 22:00`);
  // a second holder of «مندوب تشغيل»: the one who will leave
  hire(w, w.jobs.operations);
  drop(w.env);
  return w;
}
/** What Odoo holds about him: 450 cash collected today, an open invoice, a stop not delivered, a purchase list not received. */
function openWork(): void {
  const utc = "2026-10-06 08:00:00"; // 11:00 Riyadh, today
  const o1 = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: "2026-10-05", x_created_via: "whatsapp", x_utak_simulation: false });
  const paid = seed("x_invoice", { x_order_id: o1, x_status: "paid", x_total: 450, x_invoice_number: "INV-1", x_invoice_date: D6, x_utak_simulation: false });
  seed("x_payment", { x_method: "cash", x_amount: 450, x_collected_at: utc, x_collected_by: NEW, x_invoice_id: paid, x_utak_simulation: false });
  const o2 = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: "2026-10-05", x_created_via: "whatsapp", x_utak_simulation: false });
  seed("x_invoice", { x_order_id: o2, x_status: "issued", x_total: 600, x_invoice_number: "INV-2", x_invoice_date: D6, x_utak_simulation: false });
  seed("x_invoice", { x_order_id: o2, x_status: "issued", x_total: 150.5, x_invoice_number: "INV-3", x_invoice_date: D6, x_utak_simulation: false });
  const o3 = seed("x_daily_order", { id: 9100, x_customer_id: C1, x_state: "in_delivery", x_order_date: "2026-10-05", x_created_via: "whatsapp", x_utak_simulation: false });
  const route = seed("x_delivery_route", { x_driver_id: NEW, x_dispatched_at: utc, x_status: "dispatched" });
  seed("x_delivery_stop", { x_route_id: route, x_order_id: o3, x_sequence: 1, x_status: "pending" });
  seed("x_purchase_list", { id: 9200, x_status: "sent", x_date: D6, x_utak_simulation: false });
  // simulation rows never count
  seed("x_purchase_list", { id: 9201, x_status: "sent", x_date: D6, x_utak_simulation: true });
  seed("x_invoice", { x_order_id: o2, x_status: "issued", x_total: 999, x_invoice_number: "SIM", x_invoice_date: D6, x_utak_simulation: true });
}
{
  const w = leaverWorld(); await tick(w.env);
  openWork();
  await quiet(() => TQ.enqueueTeamItems(w.env, "+" + NEW_PHONE, [{ text: "🛒 قائمة الشراء #9200 — 3 أصناف", purpose: "purchase_list" }, { latitude: 24.7, longitude: 46.6, name: "محطة" }]));
  const before = writes().length;
  // Baraa takes the job off his card
  emp(NEW_EMP).job_id = false; drop(w.env);
  const t = await tick(w.env);
  const own = ownerTexts();
  const lines = (own[0] ?? "").split("\n");
  assert("the job taken off his card: one move, announced to Baraa alone", t.action === "moves" && JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:out:job_removed"]) && own.length === 1 && sentTo(NEW_PHONE).length === 0, JSON.stringify(t) + own.join(" | "));
  assert("«📤 سالم الحربي خرج من وظيفة مندوب تشغيل (أُزيلت الوظيفة عن بطاقته).»", lines[0] === "📤 سالم الحربي خرج من وظيفة مندوب تشغيل (أُزيلت الوظيفة عن بطاقته).", lines[0]);
  assert("…the job's «قائمة التسليم», point by point", lines.slice(1, 4).join("\n") === ["قائمة التسليم:", ...HANDOVER.map((p) => `• ${p}`)].join("\n"), own[0]);
  assert("…then what the system reads now: the day's cash with him, not handed over", lines[4] === "ما يقرؤه النظام الآن:" && lines[5] === "• كاش اليوم المتوقع معه: 450 ر.س — تحصيل واحد · لم يسلّم عهدة اليوم", lines.slice(4, 6).join(" | "));
  assert("…the invoices still to collect (the simulation one out)", lines[6] === "• فواتير غير محصّلة: 2 بإجمالي 750.50 ر.س", lines[6]);
  assert("…his stop without «تم التسليم», by order and customer", lines[7].startsWith("• محطات بلا «تم التسليم»: 1 (#9100 "), lines[7]);
  assert("…the purchase list not received (the simulation one out)", lines[8] === "• قوائم شراء غير مستلمة: #9200", lines[8]);
  assert("…and his kept tasks moved to the other holder of his roles (Baraa, a member by his own job)", lines[9] === "مهامه المحفوظة (2) انتقلت إلى براء: تصله مع مهامه." && lines.length === 10, lines.slice(9).join(" | "));
  const moved = JSON.parse(w.env.MSG_DEDUP.store.get(TQ.teamQueueKey("+" + OWNER)) ?? "[]");
  assert("…they are in Baraa's queue now, both, as they were kept; and nothing is kept for the one who left", moved.length === 2 && moved[0].text === "🛒 قائمة الشراء #9200 — 3 أصناف" && moved[1].latitude === 24.7 && !w.env.MSG_DEDUP.store.get(TQ.teamQueueKey("+" + NEW_PHONE)));
  assert("nothing was written in Odoo: no delete, no entry touched", writes().length === before, JSON.stringify(writes().slice(before).map((l) => `${l.model}.${l.method}`)));
  const again = await tick(w.env);
  assert("the next tick: nothing again", again.action === "none" && ownerTexts().length === 1);
  assert("the schema gate saw no field or value the tenant does not have", rejected.length === 0, rejected.join(" | "));
}
{
  // archived; nobody else holds his roles; he handed today's custody over
  const w = leaverWorld();
  emp(OWNER_EMP).job_id = false; drop(w.env);    // Baraa holds no role: no other holder
  await tick(w.env);
  openWork();
  w.env.MSG_DEDUP.store.set(`custody:v1:${D6}:${NEW}`, JSON.stringify({ v: 1, day: D6, collectorId: NEW, collector: "سالم الحربي", at: Date.now(), expected: 450, count: 1, handed: 400, how: "owner", note: "", diff: -50, corrections: 0 }));
  await quiet(() => TQ.enqueueTeamItems(w.env, "+" + NEW_PHONE, [{ text: "طلب تحصيل: فاتورة INV-2\nالمبلغ 600" }, { latitude: 1, longitude: 2 }]));
  emp(NEW_EMP).active = false; drop(w.env);
  const t = await tick(w.env);
  const lines = (ownerTexts()[0] ?? "").split("\n");
  assert("archived: «(أُرشف الموظف)»", JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:out:archived"]) && lines[0] === "📤 سالم الحربي خرج من وظيفة مندوب تشغيل (أُرشف الموظف).", lines[0]);
  assert("…the custody he handed today is read: «سلّم عهدة اليوم 400 ر.س»", lines[5] === "• كاش اليوم المتوقع معه: 450 ر.س — تحصيل واحد · سلّم عهدة اليوم 400 ر.س", lines[5]);
  assert("…nobody else holds his roles: what was kept for him reaches Baraa in this message, as texts", lines[9] === "مهام كانت محفوظة له ولم تصله (2) — لا حامل آخر لأدواره، فهي لك:" && lines[10] === "• طلب تحصيل: فاتورة INV-2 المبلغ 600" && lines.length === 11, lines.slice(9).join(" | "));
  assert("…and nothing stays kept for an archived number", !w.env.MSG_DEDUP.store.get(TQ.teamQueueKey("+" + NEW_PHONE)));
  assert("the employee is archived, not deleted (Odoo untouched by the worker)", emp(NEW_EMP).active === false && writes().length === 0);
}
{
  // a driver alone leaves: only what his role touches is read
  const w = after61();
  hire(w, w.jobs.driver); drop(w.env);
  await tick(w.env);
  openWork();
  emp(NEW_EMP).job_id = false; drop(w.env);
  await tick(w.env);
  const text = ownerTexts()[0] ?? "";
  assert("a driver alone leaves «سائق توصيل»: his cash and his stops are read", text.startsWith("📤 سالم الحربي خرج من وظيفة سائق توصيل (أُزيلت الوظيفة عن بطاقته).") && text.includes("• كاش اليوم المتوقع معه: 450 ر.س") && text.includes("• محطات بلا «تم التسليم»: 1 "), text);
  assert("…not the invoices to collect nor the purchase lists: roles he never held", !text.includes("فواتير غير محصّلة") && !text.includes("قوائم شراء"), text);
}
{
  // the job is taken off him but his card still carries a role: he is still on the team, and what was kept for him stays his
  const w = leaverWorld(); await tick(w.env);
  await quiet(() => TQ.enqueueTeamItems(w.env, "+" + NEW_PHONE, [{ text: "قائمة الشراء المحفوظة" }]));
  Object.assign(emp(NEW_EMP), { job_id: false, x_utak_role_ids: [WAREHOUSE] }); drop(w.env);
  const t = await tick(w.env);
  const text = ownerTexts()[0] ?? "";
  assert("his job off, a role still on his card: the exit is announced, his kept task is NOT moved", JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:out:job_removed"]) && text.split("\n").at(-1) === "مهامه المحفوظة (1) باقية له: ما زال يحمل أدواراً."
    && JSON.parse(w.env.MSG_DEDUP.store.get(TQ.teamQueueKey("+" + NEW_PHONE)) ?? "[]").length === 1 && !w.env.MSG_DEDUP.store.get(TQ.teamQueueKey("+" + OWNER)), text);
}
{
  // nothing open about him; a job changed is an exit and an entry
  const w = leaverWorld(); await tick(w.env);
  emp(NEW_EMP).job_id = w.jobs.driver; drop(w.env);
  const t = await tick(w.env);
  const own = ownerTexts();
  assert("his job changed: an exit from the old one and an entry to the new one", JSON.stringify(t.moves) === JSON.stringify(["سالم الحربي:out:job_changed", "سالم الحربي:in:template"]) && own.length === 2, JSON.stringify(t));
  assert("…«(صار سائق توصيل)», and with nothing open about him the system says so", own[0].split("\n")[0] === "📤 سالم الحربي خرج من وظيفة مندوب تشغيل (صار سائق توصيل)." && own[0].includes(`• ${ST.NOTHING_OPEN_TEXT}`) && !own[0].includes("مهام"), own[0]);
  assert("…then «👤 سالم الحربي صار سائق توصيل: الأدوار سائق …», and his welcome for the new job", own[1].startsWith("👤 سالم الحربي صار سائق توصيل: الأدوار سائق · ") && tplParams(sentTo(NEW_PHONE)[0])[1] === "سائق توصيل", own[1]);
}
{
  // an Odoo hiccup is never an exit
  const w = leaverWorld(); await tick(w.env);
  const kept = w.env.MSG_DEDUP.store.get(ST.STAFF_KV);
  const real = globalThis.fetch;
  drop(w.env);
  globalThis.fetch = (async (input: any, init?: any) => (String(typeof input === "string" ? input : input?.url).includes("/json/2/hr.") ? new Response("down", { status: 500 }) : real(input, init))) as typeof fetch;
  const t = await tick(w.env);
  globalThis.fetch = real;
  assert("the roster cannot be read: nothing compared, nobody «left», the kept roster as it was", t.action === "roster_unreadable" && ownerTexts().length === 0 && w.env.MSG_DEDUP.store.get(ST.STAFF_KV) === kept, JSON.stringify(t));
  // every employee gone from the answer at once: not believed
  for (const e of rows("hr.employee") as any[]) e.active = false;
  drop(w.env);
  const t2 = await tick(w.env);
  assert("the roster comes back EMPTY while jobs were held: nothing compared, nothing announced", t2.action === "empty_roster" && ownerTexts().length === 0 && w.env.MSG_DEDUP.store.get(ST.STAFF_KV) === kept, JSON.stringify(t2));
  assert("pure: who moved between two rosters — a new holder, a job taken off, a holder gone", (() => {
    const r: any = { staff: [{ employeeId: 1, name: "أ", jobId: 5, jobName: "و", codes: [] }, { employeeId: 2, name: "ب", jobId: null, jobName: "", codes: ["driver"] }], jobs: [] };
    const prev: any = [{ id: 2, name: "ب", jobId: 7, jobName: "ق", codes: [] }, { id: 3, name: "ج", jobId: 7, jobName: "ق", codes: [] }, { id: 4, name: "د", jobId: null, jobName: "", codes: ["driver"] }];
    const mv = ST.staffMoves(prev, r).map((m: any) => `${m.kind}:${m.who.name}${m.why ? `:${m.why}` : ""}`);
    return JSON.stringify(mv) === JSON.stringify(["in:أ", "out:ب:job_removed", "gone:ج"]);
  })());
}

// ================================================================ د3 — the daily data check
console.log("\n[د3] the daily data check: one line in the 21:30 summary, only when it finds something");
{
  const w = after61(); tenantCosts();
  let r = await quiet(() => TR.loadRoster(w.env));
  let f = await quiet(() => ST.dataFindings(w.env, r, D6));
  assert("the three held jobs have no cost line tied to them: named, in the jobs' order", JSON.stringify(f.noCost) === JSON.stringify(["مندوب تشغيل", "مندوب تسويق", "منسق عمليات"]) && f.noNumber.length === 0 && f.noSchedule.length === 0 && f.inactiveCost?.length === 0, JSON.stringify(f));
  assert("…one line: «🧾 فحص البيانات: وظيفة بلا بند تكلفة: مندوب تشغيل، مندوب تسويق، منسق عمليات»", ST.dataCheckLine(f) === "🧾 فحص البيانات: وظيفة بلا بند تكلفة: مندوب تشغيل، مندوب تسويق، منسق عمليات", ST.dataCheckLine(f));
  // Baraa ties the lines: one to the job, one to the employee; a closed line and a simulation line do not count
  const dyna = (rows("x_operating_cost").find((c: any) => c.x_name === "دينة مؤقتة") as any);
  dyna.x_job_id = w.jobs.operations;
  cost(4000, "2026-10-01", { x_name: "راتب عمر", x_frequency: "monthly", x_employee_id: OMAR_EMP });
  cost(3000, "2026-09-01", { x_name: "راتب قديم", x_frequency: "monthly", x_job_id: w.jobs.coordinator, x_date_to: "2026-10-05" });
  cost(3000, "2026-10-01", { x_name: "راتب محاكاة", x_frequency: "monthly", x_job_id: w.jobs.coordinator, x_utak_simulation: true });
  f = await quiet(() => ST.dataFindings(w.env, r, D6));
  assert("a line tied to the job, or to its holder, covers the job; a closed line and a simulation line do not", JSON.stringify(f.noCost) === JSON.stringify(["منسق عمليات"]), JSON.stringify(f.noCost));
  cost(3000, "2026-10-01", { x_name: "راتب عثمان", x_frequency: "monthly", x_job_id: w.jobs.coordinator });
  f = await quiet(() => ST.dataFindings(w.env, r, D6));
  assert("every held job covered, numbers and schedules there: nothing found → NO line", f.noCost?.length === 0 && ST.dataCheckLine(f) === "" && JSON.stringify(await quiet(() => ST.staffingLines(w.env, D6))) === JSON.stringify(["وظيفة شاغرة: سائق توصيل"]));
  assert("a vacant job needs no cost line", !f.noCost?.includes("سائق توصيل"));

  // a cost line of an employee who is not active
  seed("res.partner", { id: 720, name: "خالد", x_whatsapp_number: "+966500000720" });
  const left = employee(720, [], { name: "خالد", active: false });
  cost(2500, "2026-10-01", { x_name: "راتب خالد", x_frequency: "monthly", x_employee_id: left });
  // …and one of an ACTIVE employee who holds no job and no role: he is not «غير نشط»
  seed("res.partner", { id: 740, name: "نايف", x_whatsapp_number: "+966500000740" });
  cost(2000, "2026-10-01", { x_name: "راتب نايف", x_frequency: "monthly", x_employee_id: employee(740, [], { name: "نايف" }) });
  f = await quiet(() => ST.dataFindings(w.env, r, D6));
  assert("a cost line in force of an archived employee: «بند تكلفة لموظف غير نشط: راتب خالد»", JSON.stringify(f.inactiveCost) === JSON.stringify(["راتب خالد"]) && ST.dataCheckLine(f) === "🧾 فحص البيانات: بند تكلفة لموظف غير نشط: راتب خالد", ST.dataCheckLine(f));

  // an operating role without a number, and without a schedule
  hire(w, w.jobs.driver, { resource_calendar_id: false }, false);
  table("hr.job").get(w.jobs.driver)!.x_default_calendar_id = false;
  // a marketing member with no number and no schedule at all: not an operating role, so not checked
  seed("res.partner", { id: 730, name: "ماجد", x_whatsapp_number: false });
  employee(730, [MARKETING], { name: "ماجد", resource_calendar_id: false });
  drop(w.env);
  r = await quiet(() => TR.loadRoster(w.env));
  f = await quiet(() => ST.dataFindings(w.env, r, D6));
  assert("an operating role with no WhatsApp number, and with no schedule (card or job): named; a marketing member is not checked", JSON.stringify(f.noNumber) === JSON.stringify(["سالم الحربي"]) && JSON.stringify(f.noSchedule) === JSON.stringify(["سالم الحربي"]), JSON.stringify(f));
  const line = ST.dataCheckLine(f);
  assert("all of it in ONE line, in the order's order", line === "🧾 فحص البيانات: بدور تشغيلي بلا رقم واتساب: سالم الحربي · بدور تشغيلي بلا جدول دوام: سالم الحربي · وظيفة بلا بند تكلفة: سائق توصيل · بند تكلفة لموظف غير نشط: راتب خالد", line);
  const fig = await quiet(() => SUM.readSummaryFigures(w.env));
  const text = SUM.summaryText(fig).split("\n");
  assert("the 21:30 summary carries it last, after the vacancy line (none now: the driver's job is held)", text.at(-1) === line && !text.some((l) => l.startsWith("وظيفة شاغرة")) && JSON.stringify(fig.staffing) === JSON.stringify([line]), text.slice(-2).join(" | "));
  assert("no cost line was created or changed by the check (read only)", !odooLog.some((l) => l.model === "x_operating_cost" && l.method !== "search_read") && writes().length === 0);

  // the cost lines cannot be read: said, never guessed; the roster cannot be read: the summary goes without the lines
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => (String(typeof input === "string" ? input : input?.url).includes("/json/2/x_operating_cost/") ? new Response("down", { status: 500 }) : real(input, init))) as typeof fetch;
  f = await quiet(() => ST.dataFindings(w.env, r, D6));
  globalThis.fetch = real;
  assert("the cost lines cannot be read: «بنود التكلفة: تعذّرت قراءتها», the rest as found", f.noCost === null && ST.dataCheckLine(f).includes("بنود التكلفة: تعذّرت قراءتها") && ST.dataCheckLine(f).includes("بلا رقم واتساب: سالم الحربي"), ST.dataCheckLine(f));
  drop(w.env);
  globalThis.fetch = (async (input: any, init?: any) => (String(typeof input === "string" ? input : input?.url).includes("/json/2/hr.job/") ? new Response("down", { status: 500 }) : real(input, init))) as typeof fetch;
  const fig2 = await quiet(() => SUM.readSummaryFigures(w.env));
  globalThis.fetch = real;
  assert("the roster cannot be read: the summary goes without the two lines, and names what failed", fig2.staffing.length === 0 && fig2.errors.some((e: string) => e.startsWith("staffing:")) && !SUM.summaryText(fig2).includes("فحص البيانات"), JSON.stringify(fig2.errors));
  assert("the schema gate saw no field or value the tenant does not have", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ و — the three trials
console.log("\n[و] the three trials: Baraa's number alone, «🧪 تجربة», once a day, nothing written and nothing moved");
{
  const w = after61(`${D6} 23:00`);
  openWindow(w.env, OWNER);
  openWork();
  seed("x_payment", { x_method: "cash", x_amount: 120, x_collected_at: "2026-10-06 09:00:00", x_collected_by: OWNER_PID, x_invoice_id: (rows("x_invoice")[0] as any).id, x_utak_simulation: false });
  await quiet(() => TQ.enqueueTeamItems(w.env, "+" + OWNER, [{ text: "مهمة محفوظة" }]));
  const queue = w.env.MSG_DEDUP.store.get(TQ.teamQueueKey("+" + OWNER));
  const staffKv = w.env.MSG_DEDUP.store.get(ST.STAFF_KV);
  const employees = rows("hr.employee").length, partners = rows("res.partner").length;
  const e = await quiet(() => TRIAL.sendS61Trial(w.env, "entry"));
  let t = textsTo(OWNER);
  assert("entry: one text to Baraa, marked «🧪 تجربة», for a trial employee on the vacant job", e.sent === true && e.job === "سائق توصيل" && t.length === 1 && t[0].startsWith("🧪 تجربة — هكذا تصلك رسالة دخول موظف، لموظف تجريبي غير محفوظ على وظيفة «سائق توصيل»"), t[0]);
  assert("…the message itself, as the tick builds it: the job's roles, schedule, first task and its real takeover list", t[0].includes("\n👤 سالم صار سائق توصيل: الأدوار سائق · الجدول UTAK — أيام العمل · أول مهمة «بدء الدوام» الأربعاء 02:00\nقائمة الاستلام:\n• رقم واتسابه على جهة اتصاله.\n") && t[0].endsWith(TRIAL.S61_TRIAL_TAIL), t[0]);
  assert("…no employee was created, and no template went to anyone", rows("hr.employee").length === employees && rows("res.partner").length === partners && sentTo(OWNER).every((b) => b.type === "text") && sentTo("0000000000").length === 0);
  const wl = await quiet(() => TRIAL.sendS61Trial(w.env, "welcome"));
  t = textsTo(OWNER);
  assert("welcome: the employee's welcome as he gets it — the template's words with his name, his job and his first task", wl.sent === true && t.length === 2 && t[1].startsWith(TRIAL.WELCOME_TRIAL_HEAD)
    && t[1].includes("\nمرحباً سالم، تم تسجيلك في فريق يو تاك بوظيفة سائق توصيل. أول مهمة تصلك مع بداية دوامك يوم الأربعاء الساعة 02:00. مهامك وتحديثاتها تصلك في هذه المحادثة.\n") && t[1].endsWith(TRIAL.S61_TRIAL_TAIL), t[1]);
  const x = await quiet(() => TRIAL.sendS61Trial(w.env, "exit"));
  t = textsTo(OWNER);
  const lines = (t[2] ?? "").split("\n");
  assert("exit: a real read of Baraa's own card — his job's handover list", x.sent === true && x.employee === "براء" && x.job === "مندوب تشغيل" && lines[0] === "🧪 تجربة — هكذا تصلك قائمة خروج موظف، بقراءة حقيقية لبطاقة براء الآن (لم يتغير شيء على البطاقة):"
    && lines[2] === "📤 براء خرج من وظيفة مندوب تشغيل (تجربة: لم يخرج أحد)." && lines[3] === "قائمة التسليم:" && lines[4] === `• ${HANDOVER[0]}`, lines.slice(0, 5).join(" | "));
  assert("…what the system reads about him now (his cash of today, the open invoices, the purchase list)", t[2].includes("• كاش اليوم المتوقع معه: 120 ر.س — تحصيل واحد · لم يسلّم عهدة اليوم") && t[2].includes("• فواتير غير محصّلة: 2 بإجمالي 750.50 ر.س") && t[2].includes("• قوائم شراء غير مستلمة: #9200"), t[2]);
  assert("…his kept task counted, NOT moved", t[2].includes("مهام محفوظة له الآن: 1 (تجربة: لم تُنقل).") && w.env.MSG_DEDUP.store.get(TQ.teamQueueKey("+" + OWNER)) === queue);
  assert("nothing was written in Odoo, the tick's kept roster untouched, and nobody but Baraa was reached", writes().length === 0 && w.env.MSG_DEDUP.store.get(ST.STAFF_KV) === staffKv && sentTo(DRIVER_PHONE).length + sentTo(OTHMAN_PHONE).length + sentTo(WH_PHONE).length === 0);
  const again = await Promise.all(["entry", "welcome", "exit"].map((n) => quiet(() => TRIAL.sendS61Trial(w.env, n))));
  assert("each one once a day: a second ask sends nothing", again.every((r: any) => r.sent === false && r.reason === "already_today") && textsTo(OWNER).length === 3);
  assert("an unknown trial sends nothing", (await quiet(() => TRIAL.sendS61Trial(w.env, "other"))).reason === "unknown_trial");
  // the hook
  const no = await quiet(() => worker.fetch(new Request("https://w/odoo/hook/s61-trial?name=entry&token=wrong", { method: "POST" }), w.env, ctx));
  assert("the hook without the token: 401, nothing sent", no.status === 401 && textsTo(OWNER).length === 3);
  setRiyadh("2026-10-07 23:30"); openWindow(w.env, OWNER);
  const ok = await quiet(() => worker.fetch(new Request(`https://w/odoo/hook/s61-trial?name=welcome&token=${w.env.ODOO_HOOK_TOKEN}`, { method: "POST" }), w.env, ctx));
  const okBody: any = await ok.json();
  assert("the hook with it (the next day): the trial goes", ok.status === 200 && okBody.ok === true && okBody.sent === true && textsTo(OWNER).length === 4, JSON.stringify(okBody));
  assert("the schema gate saw no field or value the tenant does not have", rejected.length === 0, rejected.join(" | "));
}
{
  const w = after61(`${D6} 23:00`);
  closeOwnerWindow(w.env);
  const r = await quiet(() => TRIAL.sendS61Trial(w.env, "entry"));
  assert("his window closed: no trial is sent, none is held", r.sent === false && r.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(w.env, OWNER).length === 0);
  openWindow(w.env, OWNER);
  emp(OWNER_EMP).job_id = false; drop(w.env);
  const x = await quiet(() => TRIAL.sendS61Trial(w.env, "exit"));
  assert("the exit trial when Baraa holds no job: nothing to read, nothing sent", x.sent === false && x.reason === "owner_holds_no_job" && sentTo(OWNER).length === 0);
  assert("the trials' purpose reaches Baraa's number alone", (await quiet(() => sendText(w.env, "+" + DRIVER_PHONE, "x", { purpose: TRIAL.STAFFING_TEST_PURPOSE }))).ok === false && sentTo(DRIVER_PHONE).length === 0);
}

// ================================================================ the data of the Odoo script and the guide
console.log("\n[ج] the four jobs of scripts/lib/s61-odoo.mjs, and the guide");
{
  const J = JOBS61.JOBS as any[];
  assert("the four jobs of the order, with their roles, attendance and holder", JSON.stringify(J.map((j) => [j.name, j.roles, j.attendance, j.holder])) === JSON.stringify([
    ["مندوب تشغيل", ["driver", "warehouse", "collector"], true, 6], ["مندوب تسويق", ["marketing"], false, 4], ["منسق عمليات", ["admin"], false, 5], ["سائق توصيل", ["driver"], true, null]]));
  assert("…each carries its five texts as points and its documents; every text starts from the profit's equation in the KPIs", J.every((j) => [j.responsibilities, j.day, j.kpis, j.takeover, j.handover].every((l: string[]) => l.length >= 3) && j.docs.split("\n").length >= 4 && j.kpis[0] === "معادلة الربح: الكمية × مساهمة الكرتون − التشغيل."));
  assert("…the operating job's KPIs are the order's four, the marketing's four, the coordinator's three", ["التسليم في وقته", "التالف والمرتجع", "التحصيل وأيامه", "فرق العهدة"].every((k) => J[0].kpis.some((x: string) => x.startsWith(k)))
    && ["محلات زارها", "عملاء جدد", "أول طلب", "الطلب المتكرر"].every((k) => J[1].kpis.some((x: string) => x.startsWith(k))) && ["طلبات بلا متابعة", "شكاوى مغلقة", "بيانات ناقصة"].every((k) => J[2].kpis.some((x: string) => x.startsWith(k))));
  assert("…the operating job's handover names the custody and the cash, the vehicle's keys and papers, the open collections and the route", ["العهدة والكاش", "مفاتيح المركبة ووثائقها", "التحصيلات المفتوحة", "المسار"].every((k) => J[0].handover.some((x: string) => x.startsWith(k))));
  assert("…no salary number anywhere in the data (the money fields stay Baraa's)", !JSON.stringify(J).match(/x_salary|x_fixed_costs/) && JOBS61.JOB_FIELDS.filter((f: any) => f.ttype === "float").length === 3);
  const c = JOBS61.jobContent(J[0]);
  assert("…the lists go to Odoo as HTML points the worker reads back, point for point", JSON.stringify(ST.htmlPoints(c.x_takeover_list)) === JSON.stringify(J[0].takeover) && JSON.stringify(ST.htmlPoints(c.x_handover_list)) === JSON.stringify(J[0].handover));
  assert("the card's field keeps its name; its title is «أدوار إضافية (خارج الوظيفة)»", JOBS61.CARD_ROLES_FIELD === "x_utak_role_ids" && JOBS61.CARD_ROLES_LABEL === "أدوار إضافية (خارج الوظيفة)" && (TR.EMPLOYEE_FIELDS as readonly string[]).includes("x_utak_role_ids") && (TR.EMPLOYEE_FIELDS as readonly string[]).includes("job_id"));
  assert("the worker reads on the job exactly the fields the script creates", (TR.JOB_FIELDS as readonly string[]).filter((f) => f.startsWith("x_")).every((f) => JOBS61.JOB_FIELDS.some((d: any) => d.name === f)) && ["x_takeover_list", "x_handover_list"].every((f) => JOBS61.JOB_FIELDS.some((d: any) => d.name === f && d.ttype === "html")));

  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  const sec = guide.slice(guide.indexOf("## الوظائف (§ 61)"));
  const part = sec.slice(0, sec.indexOf("\n## ", 5) > 0 ? sec.indexOf("\n## ", 5) : undefined);
  assert("the guide has the section «الوظائف (§ 61)»", guide.includes("## الوظائف (§ 61)"));
  assert("…how to add an employee in three steps: his contact with his number, his card, his job", /ثلاث خطوات/.test(part) && part.includes("جهة اتصال") && part.includes("«الوظيفة»") && part.includes("خمس دقائق"));
  assert("…that he must not be given a schedule or a role for the job to work, and what an additional role is", part.includes("أدوار إضافية (خارج الوظيفة)") && part.includes("40 hours/week"));
  assert("…how an employee leaves: take the job off his card or archive him, and what reaches Baraa", part.includes("أرشف") && part.includes("**قائمة التسليم** بنقاطها") && part.includes("📤") && part.includes("لا حذف"));
  assert("…the vacant job and the data check in the 21:30 summary, and that no cost line is made by the system", part.includes("وظيفة شاغرة") && part.includes("🧾 فحص البيانات") && part.includes("بند تكلفة") && part.includes("لا ينشئ"));
  assert("…and the four jobs by name", ["مندوب تشغيل", "مندوب تسويق", "منسق عمليات", "سائق توصيل"].every((n) => part.includes(n)));
}

done();
