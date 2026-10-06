// § 61 (2026-10-06) — the jobs: an employee who was given one, an employee who
// left one, a job nobody holds, and the daily check of the data.
//
// The job is fixed and the employee changes (src/team-roster.ts: an employee's
// roles are his job's ∪ his card's). What this file adds follows the SAME
// roster, every five minutes, with no order and no deploy:
//
//   • in  — an active employee was given a job (or another one): Baraa gets
//     «👤 {الاسم} صار {الوظيفة}: الأدوار … · الجدول … · أول مهمة …» with the job's
//     «قائمة الاستلام», and the employee his welcome — a text inside his 24h
//     window, the template utak_team_welcome_v1 outside it (UTILITY only; when
//     it cannot go, Baraa gets its text to send himself);
//   • out — the job was taken off him, or he was archived: Baraa gets the job's
//     «قائمة التسليم» with what the system reads NOW (the day's cash with him and
//     his custody, the invoices to collect, his stops without «تم التسليم», the
//     purchase lists not received), and what was kept for him moves to another
//     holder of his roles — or to Baraa, in that same message. Nothing is
//     deleted, no entry is touched: this file writes nothing in Odoo;
//   • the 21:30 summary gains «وظيفة شاغرة: …» (a job with roles and no holder —
//     its tasks reach Baraa as before, none is lost) and ONE line of the data
//     check, only when it finds something: an employee with an operating role
//     and no WhatsApp number or no schedule, a held job without a cost line, a
//     cost line of an employee who is not active. Cost lines are never created
//     or changed here.
//
// The roster of the last tick is kept in KV (STAFF_KV). The first tick only
// keeps it: whoever holds a job when this code goes live is not «new».

import type { Env } from "./config";
import type { TeamRole } from "./types";
import { call } from "./odoo";
import { riyadhDateKey } from "./hours";
import { claimButton } from "./button-lock";
import { hhmm, shiftLabel } from "./attendance";
import { JOB_MODEL, loadRoster, nextShiftStart, type Roster, type RosterJob, type RosterMember } from "./team-roster";
import { enqueueTeamItems, teamQueueKey, type TeamQueueItem } from "./team-queue";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";
import { waDigits } from "./wa-window";
import { textContent } from "./meta";
import { sendOwnerAlert } from "./templates";

export const STAFF_KV = "staffing:v1";
/** The job name of the tick's own sends (src/auto-send-guard.ts): never the attendance tick's key. */
export const STAFFING_JOB = "staffing";
/** The welcome's purpose — its text inside the window, and the lookup of utak_team_welcome_v1 outside it. */
export const TEAM_WELCOME_PURPOSE = "team_welcome";
const CLAIM_TTL = 26 * 60 * 60;
const SIM_FIELD = "x_utak_simulation";
const COST_MODEL = "x_operating_cost";

/** The roles a task of the day follows. */
export const OPERATING_ROLES: readonly TeamRole[] = ["driver", "warehouse", "collector"];
/** The roles a message follows, as Baraa reads them («مدير» routes no message). */
export const MESSAGE_ROLE_AR: Readonly<Record<string, string>> = { driver: "سائق", warehouse: "شراء", collector: "محصّل", marketing: "تسويق" };
export const NO_MESSAGE_ROLES_TEXT = "بلا أدوار رسائل";
export const NO_SCHEDULE_TEXT = "بلا جدول";
/** «سائق + شراء + محصّل», or «بلا أدوار رسائل». */
export function rolesText(codes: readonly string[]): string {
  const names = codes.map((c) => MESSAGE_ROLE_AR[c]).filter(Boolean);
  return names.length ? names.join(" + ") : NO_MESSAGE_ROLES_TEXT;
}

// ---------------------------------------------------------------- the job's two lists

const ENTITIES: Readonly<Record<string, string>> = { "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const plain = (h: string): string => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&quot;|&#39;|&lt;|&gt;/g, (e) => ENTITIES[e]).replace(/\s+/g, " ").trim();
/** The points of a job's list, as Odoo keeps them (an HTML list; lines when it is not one). */
export function htmlPoints(html: unknown): string[] {
  const s = typeof html === "string" ? html : "";
  const items = [...s.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
  return (items.length ? items : s.split(/<\/p>|<br\s*\/?>|\n/i)).map(plain).filter(Boolean);
}
export interface JobLists { takeover: string[]; handover: string[] }
/** «قائمة الاستلام» and «قائمة التسليم» of a job. Throws on Odoo trouble. */
export async function readJobLists(env: Env, jobId: number): Promise<JobLists> {
  const [j] = await call<Array<{ x_takeover_list: string | false; x_handover_list: string | false }>>(env, JOB_MODEL, "read", {
    ids: [jobId], fields: ["x_takeover_list", "x_handover_list"], context: { active_test: false },
  });
  return { takeover: htmlPoints(j?.x_takeover_list), handover: htmlPoints(j?.x_handover_list) };
}
const bullets = (points: string[]): string[] => points.map((p) => `• ${p}`);

// ---------------------------------------------------------------- the first task

export type FirstTask = { kind: "shift"; day: string; startMin: number } | { kind: "purchase" | "route" | "collection" | "prices" | "none" };
/**
 * What reaches a new holder first: «بدء الدوام» at his next shift when he is on
 * attendance with a schedule that gives one, else the first task of his roles.
 */
export function firstTask(roster: Roster, m: RosterMember, nowMs: number): FirstTask {
  if (m.attendance) {
    const n = nextShiftStart(roster, m, nowMs);
    if (n) return { kind: "shift", day: n.day, startMin: n.startMin };
  }
  if (m.codes.includes("warehouse")) return { kind: "purchase" };
  if (m.codes.includes("driver")) return { kind: "route" };
  if (m.codes.includes("collector")) return { kind: "collection" };
  if (m.codes.includes("marketing")) return { kind: "prices" };
  return { kind: "none" };
}
/** …as Baraa reads it, after «أول مهمة». */
export function firstTaskForOwner(t: FirstTask): string {
  switch (t.kind) {
    case "shift": return `«بدء الدوام» ${shiftLabel(t.day, t.startMin)}`;
    case "purchase": return "قائمة الشراء 21:15";
    case "route": return "مسار التوصيل بعد الشراء";
    case "collection": return "أول طلب تحصيل";
    case "prices": return "قائمة الأسعار مع أول نشر";
    default: return "لا مهام آلية لهذه الوظيفة";
  }
}
/** …as the employee reads it, after «أول مهمة تصلك» (the welcome's third variable). */
export function firstTaskForMember(t: FirstTask): string {
  switch (t.kind) {
    case "shift": { const [weekday] = shiftLabel(t.day, t.startMin).split(" "); return `مع بداية دوامك يوم ${weekday} الساعة ${hhmm(t.startMin)}`; }
    case "purchase": return "مع قائمة الشراء الساعة 21:15";
    case "route": return "مع أول مسار توصيل";
    case "collection": return "مع أول طلب تحصيل";
    case "prices": return "مع أول نشر لقائمة الأسعار";
    default: return "من براء مباشرة";
  }
}

// ---------------------------------------------------------------- in: the welcome and Baraa's message

/** The three variables of utak_team_welcome_v1: the name, the job, when his first task comes. */
export function welcomeParams(name: string, jobName: string, first: FirstTask): [string, string, string] {
  return [name, jobName, firstTaskForMember(first)];
}
/** The welcome as a text: the template's body, letter for letter, with its variables. */
export function welcomeText(p: readonly [string, string, string]): string {
  return `مرحباً ${p[0]}، تم تسجيلك في فريق يو تاك بوظيفة ${p[1]}. أول مهمة تصلك ${p[2]}. مهامك وتحديثاتها تصلك في هذه المحادثة.`;
}
/** How the welcome went: his window, the template, not at all (Baraa sends it), no number, or Baraa himself. */
export type WelcomeFate = "session" | "template" | "not_sent" | "no_number" | "owner";
export const NO_NUMBER_WARNING = "⚠️ بلا رقم واتساب على جهة اتصاله: لن تصله أي مهمة حتى يُضاف.";
export const NO_SCHEDULE_WARNING = "⚠️ مشمول بالتحضير وبلا جدول دوام: لن يصله «بدء الدوام» حتى يُختار له جدول.";
export const NO_TAKEOVER_TEXT = "قائمة الاستلام: لم تُكتب على الوظيفة بعد.";
export const LIST_UNREAD_TEXT = "تعذّرت قراءتها الآن (افتح الوظيفة في Odoo).";
/** The line about the welcome at the end of Baraa's message ("" for Baraa himself). */
export function welcomeFateLine(fate: WelcomeFate, text: string): string {
  if (fate === "session") return "✉️ وصله ترحيبه في واتساب.";
  if (fate === "template") return "✉️ وصله ترحيبه بالقالب (نافذته مغلقة).";
  if (fate === "no_number") return "✉️ لا ترحيب: لا رقم له.";
  if (fate === "not_sent") return `✉️ ترحيبه لم يُرسل (نافذته مغلقة ولا قالب معتمد). أرسله له بنفسك:\n${text}`;
  return "";
}
export interface EntryShown { name: string; jobName: string; codes: readonly string[]; calendarName: string; attendance: boolean; whatsapp: string }
/** «👤 {الاسم} صار {الوظيفة}: الأدوار … · الجدول … · أول مهمة …», the takeover list, and how the welcome went. */
export function entryText(m: EntryShown, first: FirstTask, takeover: string[] | null, fate: WelcomeFate, welcome: string): string {
  return [
    `👤 ${m.name} صار ${m.jobName}: الأدوار ${rolesText(m.codes)} · الجدول ${m.calendarName || NO_SCHEDULE_TEXT} · أول مهمة ${firstTaskForOwner(first)}`,
    ...(m.whatsapp ? [] : [NO_NUMBER_WARNING]),
    ...(m.attendance && !m.calendarName ? [NO_SCHEDULE_WARNING] : []),
    ...(takeover === null ? [`قائمة الاستلام: ${LIST_UNREAD_TEXT}`] : takeover.length ? ["قائمة الاستلام:", ...bullets(takeover)] : [NO_TAKEOVER_TEXT]),
    ...[welcomeFateLine(fate, welcome)].filter(Boolean),
  ].join("\n");
}

const isOwner = (env: Env, n: string): boolean => {
  const o = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  return !!o && waDigits(n) === o;
};

/** The welcome to the employee: his window, else the template (APPROVED and UTILITY only — the gateway's rule), never held. */
export async function sendWelcome(env: Env, m: Pick<RosterMember, "whatsapp">, params: [string, string, string], ctx?: ExecutionContext): Promise<WelcomeFate> {
  if (!m.whatsapp) return "no_number";
  if (isOwner(env, m.whatsapp)) return "owner";
  try {
    const d = gatewayDecision(await sendViaGateway(env, {
      purpose: TEAM_WELCOME_PURPOSE, to: m.whatsapp, content: textContent(welcomeText(params)),
      fallback: [{ kind: "template", purpose: TEAM_WELCOME_PURPOSE, params: [...params] }],
      noHold: true, noHoldReason: "الترحيب يصل براء نصاً ليرسله بنفسه", ctx,
    }));
    return d?.action === "session" ? "session" : d?.action === "template" ? "template" : "not_sent";
  } catch (e) {
    console.warn("[staffing] the welcome could not be sent", (e as Error)?.message);
    return "not_sent";
  }
}

/** An employee was given a job: his welcome, then Baraa's message. Returns how the welcome went. */
export async function announceEntry(env: Env, roster: Roster, m: RosterMember, nowMs: number = Date.now(), ctx?: ExecutionContext): Promise<WelcomeFate> {
  const first = firstTask(roster, m, nowMs);
  const params = welcomeParams(m.name, m.jobName, first);
  let takeover: string[] | null = null;
  try { if (m.jobId) takeover = (await readJobLists(env, m.jobId)).takeover; } catch (e) { console.warn("[staffing] the takeover list could not be read", (e as Error)?.message); }
  const fate = await sendWelcome(env, m, params, ctx);
  await sendOwnerAlert(env, entryText(m, first, takeover, fate, welcomeText(params)));
  return fate;
}

// ---------------------------------------------------------------- out: what the system reads, and his kept tasks

/** An employee as the last tick saw him. */
export interface StaffSnap { id: number; name: string; partnerId: number; whatsapp: string; jobId: number | null; jobName: string; codes: TeamRole[] }
export const snapOf = (m: RosterMember): StaffSnap => ({ id: m.employeeId, name: m.name, partnerId: m.partnerId, whatsapp: m.whatsapp, jobId: m.jobId, jobName: m.jobName, codes: [...m.codes] });

export const NOTHING_OPEN_TEXT = "لا عهدة ولا تحصيل ولا مسار ولا قائمة شراء مفتوحة باسمه.";
const unread = (what: string): string => `${what}: تعذّرت قراءتها الآن.`;
/**
 * What the system reads now about the one who leaves, by the roles he held:
 * the day's cash with him and whether he handed it (anyone who delivers or
 * collects), the invoices still to collect (the collector), his stops without
 * «تم التسليم» (the driver), the purchase lists not received (the buyer).
 * Read-only; a read that fails is named, never guessed.
 */
export async function exitFacts(env: Env, who: StaffSnap, nowMs: number = Date.now()): Promise<string[]> {
  const out: string[] = [];
  const day = riyadhDateKey(new Date(nowMs));
  const has = (c: TeamRole) => who.codes.includes(c);
  if ((has("collector") || has("driver")) && who.partnerId) {
    try {
      const { expectedCash, money, collectionsAr, readCustody } = await import("./custody-form");
      const cash = await expectedCash(env, who.partnerId, day);
      const handed = await readCustody(env, day, who.partnerId).catch(() => null);
      if (cash.count > 0 || handed) {
        out.push(`كاش اليوم المتوقع معه: ${money(cash.total)} ر.س — ${collectionsAr(cash.count)} · ${handed ? `سلّم عهدة اليوم ${money(handed.handed)} ر.س` : "لم يسلّم عهدة اليوم"}`);
      }
    } catch (e) { out.push(unread("العهدة والكاش")); console.warn("[staffing] the cash could not be read", (e as Error)?.message); }
  }
  if (has("collector")) {
    try {
      const { getUnpaidInvoicesWithCustomer } = await import("./odoo");
      const { money } = await import("./custody-form");
      const open = await getUnpaidInvoicesWithCustomer(env);
      if (open.length) out.push(`فواتير غير محصّلة: ${open.length} بإجمالي ${money(open.reduce((s, i) => s + (Number(i.total) || 0), 0))} ر.س`);
    } catch (e) { out.push(unread("التحصيلات المفتوحة")); console.warn("[staffing] the open invoices could not be read", (e as Error)?.message); }
  }
  if (has("driver") && who.partnerId) {
    try {
      const { openStopsForDriver } = await import("./driver-followup");
      const stops = await openStopsForDriver(env, who.partnerId, nowMs - 36 * 60 * 60 * 1000);
      if (stops.length) out.push(`محطات بلا «تم التسليم»: ${stops.length} (${stops.slice(0, 5).map((s) => `#${s.orderId} ${s.customerName}`).join("، ")}${stops.length > 5 ? `، +${stops.length - 5}` : ""})`);
    } catch (e) { out.push(unread("المسار والتسليمات")); console.warn("[staffing] the open stops could not be read", (e as Error)?.message); }
  }
  if (has("warehouse")) {
    try {
      const { getUnconfirmedPurchaseLists } = await import("./odoo");
      const lists = await getUnconfirmedPurchaseLists(env, riyadhDateKey(new Date(nowMs - 36 * 60 * 60 * 1000)));
      if (lists.length) out.push(`قوائم شراء غير مستلمة: ${lists.map((id) => `#${id}`).join("، ")}`);
    } catch (e) { out.push(unread("قوائم الشراء")); console.warn("[staffing] the purchase lists could not be read", (e as Error)?.message); }
  }
  return out;
}

export interface QueueMove { count: number; to: string | null; texts: string[] }
const KEPT_SHOWN = 5;
/**
 * What was kept for him until his «بدء الدوام» (the team's queue, KV): to the
 * first other member who holds one of his roles — it reaches him as any kept
 * task does — else to Baraa, as texts in the message. `dry` only counts.
 */
export async function moveKeptTasks(env: Env, who: StaffSnap, roster: Roster, dry = false): Promise<QueueMove> {
  if (!who.whatsapp) return { count: 0, to: null, texts: [] };
  const key = teamQueueKey(who.whatsapp);
  let items: TeamQueueItem[] = [];
  try {
    const raw = await env.MSG_DEDUP.get(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) items = parsed;
  } catch (e) {
    console.warn("[staffing] the kept tasks could not be read", (e as Error)?.message);
  }
  if (!items.length) return { count: 0, to: null, texts: [] };
  const texts = items.map((i) => ("text" in i && typeof i.text === "string" ? i.text : "")).filter(Boolean);
  const other = roster.members.find((m) => m.employeeId !== who.id && m.whatsapp && m.partnerId && waDigits(m.whatsapp) !== waDigits(who.whatsapp) && who.codes.some((c) => m.codes.includes(c))) ?? null;
  if (dry) return { count: items.length, to: other?.name ?? null, texts };
  if (other) await enqueueTeamItems(env, other.whatsapp, items);
  // he left: nothing kept for him goes to his number any more
  await env.MSG_DEDUP.delete(key);
  return { count: items.length, to: other?.name ?? null, texts };
}
/** The message's lines about his kept tasks ([] when none). */
export function keptLines(q: QueueMove, dry = false): string[] {
  if (!q.count) return [];
  if (dry) return [`مهام محفوظة له الآن: ${q.count} (تجربة: لم تُنقل).`];
  if (q.to) return [`مهامه المحفوظة (${q.count}) انتقلت إلى ${q.to}: تصله مع مهامه.`];
  return [
    `مهام كانت محفوظة له ولم تصله (${q.count}) — لا حامل آخر لأدواره، فهي لك:`,
    ...q.texts.slice(0, KEPT_SHOWN).map((t) => `• ${t.replace(/\s+/g, " ").slice(0, 160)}`),
    ...(q.texts.length > KEPT_SHOWN ? [`• +${q.texts.length - KEPT_SHOWN} أخرى`] : []),
  ];
}

export type ExitWhy = "archived" | "job_removed" | "job_changed" | "trial";
export const NO_HANDOVER_TEXT = "قائمة التسليم: لم تُكتب على الوظيفة بعد.";
function whyText(why: ExitWhy, next: string): string {
  if (why === "archived") return "أُرشف الموظف";
  if (why === "job_changed") return `صار ${next}`;
  if (why === "trial") return "تجربة: لم يخرج أحد";
  return "أُزيلت الوظيفة عن بطاقته";
}
/** «📤 {الاسم} خرج من وظيفة {الوظيفة} (…)», the handover list, what the system reads, and his kept tasks. */
export function exitText(who: Pick<StaffSnap, "name" | "jobName">, why: ExitWhy, handover: string[] | null, facts: string[], kept: string[], nextJob = ""): string {
  return [
    `📤 ${who.name} خرج من وظيفة ${who.jobName} (${whyText(why, nextJob)}).`,
    ...(handover === null ? [`قائمة التسليم: ${LIST_UNREAD_TEXT}`] : handover.length ? ["قائمة التسليم:", ...bullets(handover)] : [NO_HANDOVER_TEXT]),
    "ما يقرؤه النظام الآن:",
    ...bullets(facts.length ? facts : [NOTHING_OPEN_TEXT]),
    ...kept,
  ].join("\n");
}

/** An employee left his job: the handover list with what the system reads, and his kept tasks moved. Nothing is written in Odoo. */
export async function announceExit(env: Env, roster: Roster, who: StaffSnap, why: ExitWhy, nowMs: number = Date.now(), nextJob = ""): Promise<QueueMove> {
  let handover: string[] | null = null;
  try { if (who.jobId) handover = (await readJobLists(env, who.jobId)).handover; } catch (e) { console.warn("[staffing] the handover list could not be read", (e as Error)?.message); }
  const facts = await exitFacts(env, who, nowMs);
  let moved: QueueMove = { count: 0, to: null, texts: [] };
  try { moved = await moveKeptTasks(env, who, roster); } catch (e) { console.warn("[staffing] the kept tasks could not be moved", (e as Error)?.message); }
  await sendOwnerAlert(env, exitText(who, why, handover, facts, keptLines(moved), nextJob));
  return moved;
}

// ---------------------------------------------------------------- the five-minute tick

export type StaffMove =
  | { kind: "in"; who: RosterMember }
  | { kind: "out"; who: StaffSnap; why: Exclude<ExitWhy, "trial" | "archived">; next: string }
  | { kind: "gone"; who: StaffSnap };
/**
 * Who entered a job and who left one between two ticks. A job changed is an
 * exit from the old one and an entry to the new one. An employee who is no
 * longer on the staff at all («gone») was archived, or lost his job with no
 * role left on his card.
 */
export function staffMoves(prev: StaffSnap[], roster: Roster): StaffMove[] {
  const out: StaffMove[] = [];
  const before = new Map(prev.map((p) => [p.id, p]));
  const now = new Map(roster.staff.map((m) => [m.employeeId, m]));
  for (const m of roster.staff) {
    const p = before.get(m.employeeId);
    if (p?.jobId && p.jobId !== m.jobId) out.push({ kind: "out", who: p, why: m.jobId ? "job_changed" : "job_removed", next: m.jobName });
    if (m.jobId && p?.jobId !== m.jobId) out.push({ kind: "in", who: m });
  }
  for (const p of prev) if (p.jobId && !now.has(p.id)) out.push({ kind: "gone", who: p });
  return out;
}

export interface StaffingReport { action: "baseline" | "none" | "moves" | "roster_unreadable" | "empty_roster"; moves: string[] }

/** Was this employee archived (true), or is he active without his job (false)? Null when Odoo cannot say. */
async function archived(env: Env, employeeId: number): Promise<boolean | null> {
  try {
    const [e] = await call<Array<{ active: boolean }>>(env, "hr.employee", "read", { ids: [employeeId], fields: ["active"], context: { active_test: false } });
    return e ? e.active === false : null;
  } catch { return null; }
}

/**
 * Every five minutes: the roster against the last tick's. The first tick only
 * keeps the roster. A roster that cannot be read — or that comes back empty
 * while people held jobs — changes nothing: nobody «left» for an Odoo hiccup.
 * Each move is announced once (its own claim), and never stops the others.
 */
export async function runStaffingTick(env: Env, nowMs: number = Date.now(), ctx?: ExecutionContext): Promise<StaffingReport> {
  let roster: Roster;
  try { roster = await loadRoster(env, nowMs); } catch (e) {
    console.warn("[staffing] the roster could not be read — nothing compared", (e as Error)?.message);
    return { action: "roster_unreadable", moves: [] };
  }
  const now = roster.staff.map(snapOf);
  let prev: StaffSnap[] | null = null;
  try {
    const raw = await env.MSG_DEDUP.get(STAFF_KV);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) prev = parsed as StaffSnap[];
  } catch { /* as the first tick */ }
  if (prev === null) {
    await env.MSG_DEDUP.put(STAFF_KV, JSON.stringify(now));
    return { action: "baseline", moves: [] };
  }
  if (now.length === 0 && prev.some((p) => p.jobId)) {
    console.warn("[staffing] the roster came back empty while jobs were held — nothing compared");
    return { action: "empty_roster", moves: [] };
  }
  const moves = staffMoves(prev, roster);
  // kept before any send: a tick that fails half-way never announces the same move twice
  if (JSON.stringify(now) !== JSON.stringify(prev)) await env.MSG_DEDUP.put(STAFF_KV, JSON.stringify(now));
  const done: string[] = [];
  const day = riyadhDateKey(new Date(nowMs));
  for (const mv of moves) {
    const id = mv.kind === "in" ? mv.who.employeeId : mv.who.id;
    const name = mv.who.name;
    try {
      const claim = await claimButton(env, `staffing:${day}:${mv.kind === "in" ? "in" : "out"}:e${id}:j${mv.who.jobId}`, CLAIM_TTL);
      if (!claim.claimed) { done.push(`${name}:${mv.kind}:claimed_before`); continue; }
      if (mv.kind === "in") done.push(`${name}:in:${await announceEntry(env, roster, mv.who, nowMs, ctx)}`);
      else if (mv.kind === "out") { await announceExit(env, roster, mv.who, mv.why, nowMs, mv.next); done.push(`${name}:out:${mv.why}`); }
      else {
        const why: ExitWhy = (await archived(env, id)) === false ? "job_removed" : "archived";
        await announceExit(env, roster, mv.who, why, nowMs);
        done.push(`${name}:out:${why}`);
      }
    } catch (e) {
      done.push(`${name}:${mv.kind}:failed`);
      console.error(`[staffing] ${name}: the move could not be announced`, (e as Error)?.message);
    }
  }
  return { action: moves.length ? "moves" : "none", moves: done };
}

// ---------------------------------------------------------------- the 21:30 summary: a vacant job, and the data check

/** A job with roles and no holder: its tasks reach Baraa as before (none is lost), and the summary names it. */
export function vacantJobs(roster: Pick<Roster, "jobs" | "staff">): RosterJob[] {
  return roster.jobs.filter((j) => j.codes.length > 0 && !roster.staff.some((m) => m.jobId === j.id));
}
/** «وظيفة شاغرة: سائق توصيل» ("" when none). */
export function vacancyLine(jobs: Array<Pick<RosterJob, "name">>): string {
  return jobs.length ? `وظيفة شاغرة: ${jobs.map((j) => j.name).join("، ")}` : "";
}

export interface DataFindings {
  /** Employees with an operating role and no WhatsApp number / no schedule. */
  noNumber: string[];
  noSchedule: string[];
  /** Held jobs without a cost line in force; cost lines in force of an employee who is not active. Null: the cost lines could not be read. */
  noCost: string[] | null;
  inactiveCost: string[] | null;
}
type M2O = [number, string] | false;
const m2oId = (v: M2O | number | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);

/** The daily check of the data (read-only; no cost line is ever created or changed here). */
export async function dataFindings(env: Env, roster: Roster, day: string): Promise<DataFindings> {
  const operating = roster.staff.filter((m) => m.codes.some((c) => OPERATING_ROLES.includes(c)));
  const f: DataFindings = {
    noNumber: operating.filter((m) => !m.whatsapp).map((m) => m.name),
    noSchedule: operating.filter((m) => !m.calendarId).map((m) => m.name),
    noCost: null, inactiveCost: null,
  };
  try {
    const lines = await call<Array<{ id: number; x_name: string | false; x_job_id: M2O; x_employee_id: M2O }>>(env, COST_MODEL, "search_read", {
      domain: [["x_date_from", "<=", day], "|", ["x_date_to", "=", false], ["x_date_to", ">=", day], [SIM_FIELD, "!=", true]],
      fields: ["id", "x_name", "x_job_id", "x_employee_id"], order: "id asc", limit: 500,
    });
    const jobsPaid = new Set(lines.map((l) => m2oId(l.x_job_id)).filter(Boolean));
    const employeesPaid = new Set(lines.map((l) => m2oId(l.x_employee_id)).filter(Boolean));
    f.noCost = roster.jobs
      .filter((j) => { const holders = roster.staff.filter((m) => m.jobId === j.id); return holders.length > 0 && !jobsPaid.has(j.id) && !holders.some((m) => employeesPaid.has(m.employeeId)); })
      .map((j) => j.name);
    const onStaff = new Set(roster.staff.map((m) => m.employeeId));
    const others = [...employeesPaid].filter((id) => !onStaff.has(id));
    const rows = others.length
      ? await call<Array<{ id: number; active: boolean }>>(env, "hr.employee", "read", { ids: others, fields: ["id", "active"], context: { active_test: false } })
      : [];
    const inactive = new Set(rows.filter((r) => r.active === false).map((r) => r.id));
    f.inactiveCost = lines.filter((l) => inactive.has(m2oId(l.x_employee_id))).map((l) => String(l.x_name || `#${l.id}`));
  } catch (e) {
    console.warn("[staffing] the cost lines could not be read for the data check", (e as Error)?.message);
  }
  return f;
}
export const DATA_CHECK_HEAD = "🧾 فحص البيانات:";
/** ONE line, only when the check found something ("" otherwise). */
export function dataCheckLine(f: DataFindings): string {
  const parts = [
    f.noNumber.length ? `بدور تشغيلي بلا رقم واتساب: ${f.noNumber.join("، ")}` : "",
    f.noSchedule.length ? `بدور تشغيلي بلا جدول دوام: ${f.noSchedule.join("، ")}` : "",
    f.noCost === null ? "بنود التكلفة: تعذّرت قراءتها" : f.noCost.length ? `وظيفة بلا بند تكلفة: ${f.noCost.join("، ")}` : "",
    f.inactiveCost?.length ? `بند تكلفة لموظف غير نشط: ${f.inactiveCost.join("، ")}` : "",
  ].filter(Boolean);
  return parts.length ? `${DATA_CHECK_HEAD} ${parts.join(" · ")}` : "";
}

/** The lines the 21:30 summary gains: the vacant jobs, then the data check — each only when it has something to say. Throws when the roster cannot be read. */
export async function staffingLines(env: Env, day: string, nowMs: number = Date.now()): Promise<string[]> {
  const roster = await loadRoster(env, nowMs);
  return [vacancyLine(vacantJobs(roster)), dataCheckLine(await dataFindings(env, roster, day))].filter(Boolean);
}
