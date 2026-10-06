// § 61 و (2026-10-06) — the three trials of the jobs to Baraa's own number.
//
// Each one: his number alone (no other can be named), marked «🧪 تجربة», only
// while his 24h window is open (nothing held, no template), once a Riyadh day.
// Nothing is written in Odoo, no kept task is moved, no employee is created,
// and it reaches nobody but him.
//
//   entry     the message Baraa gets when an employee is given a job — for a
//             trial employee who is NOT saved anywhere, on the first vacant job
//             (its real «قائمة الاستلام», roles and default schedule)
//   welcome   the welcome as the employee gets it (the text of the template
//             utak_team_welcome_v1, letter for letter)
//   exit      the list Baraa gets when an employee leaves — with a REAL read of
//             Baraa's own card: his job's «قائمة التسليم», the day's cash, the
//             invoices to collect, his open stops, the purchase lists not received

import type { Env } from "./config";
import { textContent } from "./meta";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { loadRoster, type Roster, type RosterJob, type RosterMember } from "./team-roster";
import {
  entryText, exitFacts, exitText, firstTask, keptLines, moveKeptTasks, readJobLists, snapOf, vacantJobs, welcomeParams, welcomeText,
} from "./staffing";

export const S61_TRIAL_MARK = "🧪 تجربة";
export const STAFFING_TEST_PURPOSE = "staffing_test";
export const S61_TRIAL_TAIL = "(تجربة: لم يُكتب شيء في Odoo، ولم تُنقل مهمة، ولم تصل رسالة لأحد غيرك)";
export const S61_TRIAL_NAMES = ["entry", "welcome", "exit"] as const;
export const TRIAL_EMPLOYEE_NAME = "سالم";
export interface S61TrialResult { sent: boolean; reason?: string; job?: string; employee?: string }

const DAY_TTL = 26 * 60 * 60;

/** One trial's frame: his number, his open window, once a day; `send` says what went. */
async function once(env: Env, name: string, now: number, send: (owner: string) => Promise<S61TrialResult>): Promise<S61TrialResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `s61_trial:${name}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const r = await send(owner);
    if (r.sent) await finishButton(env, claim, DAY_TTL);
    else await releaseButton(env, claim);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
const went = async (env: Env, to: string, text: string): Promise<string> => {
  const d = gatewayDecision(await sendViaGateway(env, { purpose: STAFFING_TEST_PURPOSE, to, content: textContent(text), noHold: true, noHoldReason: "تجارب § 61 تُرسل داخل نافذة 24 ساعة فقط" }));
  return d?.action === "session" ? "" : d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision";
};

/** The job of the trial employee: the first vacant one, else the first job with roles. Null when Odoo holds none. */
export function trialJob(roster: Pick<Roster, "jobs" | "staff">): RosterJob | null {
  return vacantJobs(roster)[0] ?? roster.jobs.find((j) => j.codes.length > 0) ?? roster.jobs[0] ?? null;
}
/** The trial employee as the roster would read him on that job: never saved, and his number never written to. */
export function trialMember(job: RosterJob): RosterMember {
  return {
    employeeId: 0, partnerId: 0, name: TRIAL_EMPLOYEE_NAME, whatsapp: "+0000000000", codes: [...job.codes], attendance: job.attendance,
    calendarId: job.calendarId, calendarName: job.calendarName, resourceId: null, companyId: null, neighborhoods: [], jobId: job.id, jobName: job.name,
  };
}

export function entryTrialHead(jobName: string): string {
  return `${S61_TRIAL_MARK} — هكذا تصلك رسالة دخول موظف، لموظف تجريبي غير محفوظ على وظيفة «${jobName}» (قائمة الاستلام من الوظيفة نفسها في Odoo):`;
}
export const WELCOME_TRIAL_HEAD = `${S61_TRIAL_MARK} — هكذا يصل الموظف الجديد ترحيبه: نصاً داخل نافذته، وبالقالب نفسه خارجها.`;
export function exitTrialHead(name: string): string {
  return `${S61_TRIAL_MARK} — هكذا تصلك قائمة خروج موظف، بقراءة حقيقية لبطاقة ${name} الآن (لم يتغير شيء على البطاقة):`;
}

/** Baraa's message of an entry, for a trial employee who is saved nowhere. */
export async function sendEntryTrial(env: Env, now: number = Date.now()): Promise<S61TrialResult> {
  return once(env, "entry", now, async (owner) => {
    const roster = await loadRoster(env, now);
    const job = trialJob(roster);
    if (!job) return { sent: false, reason: "no_job" };
    const m = trialMember(job);
    const first = firstTask(roster, m, now);
    const takeover = (await readJobLists(env, job.id)).takeover;
    const body = entryText(m, first, takeover, "session", welcomeText(welcomeParams(m.name, m.jobName, first)));
    const why = await went(env, owner, [entryTrialHead(job.name), "", body, "", S61_TRIAL_TAIL].join("\n"));
    return why ? { sent: false, reason: why } : { sent: true, job: job.name, employee: m.name };
  });
}

/** The employee's welcome, as it reaches him. */
export async function sendWelcomeTrial(env: Env, now: number = Date.now()): Promise<S61TrialResult> {
  return once(env, "welcome", now, async (owner) => {
    const roster = await loadRoster(env, now);
    const job = trialJob(roster);
    if (!job) return { sent: false, reason: "no_job" };
    const m = trialMember(job);
    const text = welcomeText(welcomeParams(m.name, m.jobName, firstTask(roster, m, now)));
    const why = await went(env, owner, [WELCOME_TRIAL_HEAD, "", text, "", S61_TRIAL_TAIL].join("\n"));
    return why ? { sent: false, reason: why } : { sent: true, job: job.name, employee: m.name };
  });
}

/** Baraa's list of an exit, read for real from his own card (his job, the cash, the collections, the stops, the purchase lists). */
export async function sendExitTrial(env: Env, now: number = Date.now()): Promise<S61TrialResult> {
  return once(env, "exit", now, async (owner) => {
    const roster = await loadRoster(env, now);
    const me = roster.staff.find((m) => m.jobId && waDigits(m.whatsapp) === owner) ?? null;
    if (!me?.jobId) return { sent: false, reason: "owner_holds_no_job" };
    const who = snapOf(me);
    const handover = (await readJobLists(env, me.jobId)).handover;
    const facts = await exitFacts(env, who, now);
    const kept = keptLines(await moveKeptTasks(env, who, roster, true), true);
    const why = await went(env, owner, [exitTrialHead(me.name), "", exitText(who, "trial", handover, facts, kept), "", S61_TRIAL_TAIL].join("\n"));
    return why ? { sent: false, reason: why } : { sent: true, job: me.jobName, employee: me.name };
  });
}

/** One trial by its name (the hook's). */
export async function sendS61Trial(env: Env, name: string, now: number = Date.now()): Promise<S61TrialResult> {
  if (name === "entry") return sendEntryTrial(env, now);
  if (name === "welcome") return sendWelcomeTrial(env, now);
  if (name === "exit") return sendExitTrial(env, now);
  return { sent: false, reason: "unknown_trial" };
}
