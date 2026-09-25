// Team attendance — «بدء الدوام» (2026-09-25, STATUS § 29).
//
// Locked decisions (Baraa, 2026-09-25):
//   • Every active partner with a team role (x_role_ids: driver / warehouse /
//     collector / admin) AND a shift time (res.partner.x_shift_start, Riyadh)
//     gets utak_shift_start_v2 (purpose team_shift_start, button «بدء الدوام»,
//     payload shift_start) at that time. No time → nothing is sent.
//   • Their tasks wait until they tap; after the tap they arrive as session
//     messages inside the 24h window the tap opened.
//   • +30 min without a tap: ONE reminder (the same template) and an owner
//     alert «{name} لم يسجّل حضوره».
//   • +60 min without a tap: status «غائب» in Odoo, and an owner alert.
//   • A tap before +60: «حاضر», or «متأخر» after +15. A tap after +60:
//     «متأخر» (not absent), the tasks, and an owner alert.
//   • Baraa: the same template every day only to open his 24h window, so
//     owner alerts reach him as text. No attendance, lateness or alerts about
//     him. 2026-09-25 (STATUS § 30): at the earliest shift start of the
//     roster minus 15 minutes, computed every day; with no shift time on the
//     roster, OWNER_WINDOW_OPEN_AT (default 06:00) — a fallback only.
//   • Nothing is sent twice to the same person on the same day, even if the
//     job runs again.
//
// Records: x_team_attendance (one row per member per Riyadh day): x_partner_id,
// x_date, x_shift_at, x_sent_at, x_tapped_at, x_status (present|late|absent),
// x_reminder_sent. Created by scripts/att-20260925-odoo-setup.mjs.
//
// Scheduling: ONE cron every 5 minutes (runAttendanceTick) handles whatever
// is due. Idempotency has two layers: a KV claim per (day, person, step)
// written before the step (button-lock's claim + read-back), and the Odoo row
// itself (x_sent_at / x_reminder_sent / x_status), so a lost KV key still
// cannot repeat a step that already happened. Template sends also pass the
// auto-send guard (distinct job names: shift_start / shift_remind / owner_window).

import type { Env } from "./config";
import { call, getAttendanceTeam, type AttendanceMember } from "./odoo";
import { sendOwnerAlert, sendTemplateByPurpose, T } from "./templates";
import { withAutoSendJob } from "./auto-send-guard";
import { claimButton, releaseButton } from "./button-lock";
import { odooUtcToRiyadhHHMM, riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM, toOdooUtc } from "./hours";
import { flushTeamQueue } from "./team-queue";
import { sendText } from "./meta";

export const ATT_MODEL = "x_team_attendance";
export const SHIFT_START_PAYLOAD = "shift_start";
export const LATE_AFTER_MIN = 15;
export const REMIND_AFTER_MIN = 30;
export const ABSENT_AFTER_MIN = 60;
export const OWNER_WINDOW_DEFAULT = "06:00";
/** fetchMeta's owner guard lets this purpose reach OWNER_WHATSAPP (the window-opening template only). */
export const OWNER_WINDOW_PURPOSE = "owner_window";
const OWNER_TEMPLATE_NAME = "براء";
const CLAIM_TTL = 2 * 24 * 60 * 60;
const MIN = 60_000;

export type AttStatus = "present" | "late" | "absent";
export interface AttRow {
  id: number;
  x_date: string;
  x_shift_at: string | false;
  x_sent_at: string | false;
  x_tapped_at: string | false;
  x_status: AttStatus | false;
  x_reminder_sent: boolean;
  x_partner_id: [number, string] | number | false;
}
const ROW_FIELDS = ["id", "x_partner_id", "x_date", "x_shift_at", "x_sent_at", "x_tapped_at", "x_status", "x_reminder_sent"];

// ---------------------------------------------------------------- time
/** x_shift_start (float hours) → minutes after midnight; 0 / empty / out of range → null (no time). */
export function shiftMinutes(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v >= 24) return null;
  return Math.round(v * 60);
}
/** 330 → «05:30». */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
/** «06:00» → 360; anything else → null. */
export function parseHHMM(s: unknown): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s ?? ""));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
/** Baraa's fallback window-opening time (wrangler var OWNER_WINDOW_OPEN_AT, default 06:00). */
export function ownerWindowMinutes(env: Env): number {
  return parseHHMM(env.OWNER_WINDOW_OPEN_AT) ?? (parseHHMM(OWNER_WINDOW_DEFAULT) as number);
}
/** Baraa's window opens this long before the earliest shift, so the +30 / +60 alerts reach him as text. */
export const OWNER_WINDOW_LEAD_MIN = 15;

/**
 * 2026-09-25 (STATUS § 30) — today's window-opening time: the earliest shift
 * start among the attendance roster (team role + shift time, never Baraa)
 * minus 15 minutes, not before 00:00. Nobody with a time → the fallback
 * (OWNER_WINDOW_OPEN_AT, default 06:00).
 */
export function ownerWindowPlan(env: Env, team: AttendanceMember[]): { minutes: number; source: "earliest_shift" | "fallback"; earliest: string | null } {
  const shifts = team
    .filter((m) => !isOwnerNumber(env, m.whatsapp) && m.whatsapp)
    .map((m) => shiftMinutes(m.shiftStart))
    .filter((v): v is number => v !== null);
  if (!shifts.length) return { minutes: ownerWindowMinutes(env), source: "fallback", earliest: null };
  const earliest = Math.min(...shifts);
  return { minutes: Math.max(0, earliest - OWNER_WINDOW_LEAD_MIN), source: "earliest_shift", earliest: hhmm(earliest) };
}
/** «حاضر» up to +15 min after the shift start, «متأخر» after. */
export function statusForTap(tapMs: number, shiftMs: number): "present" | "late" {
  return tapMs - shiftMs > LATE_AFTER_MIN * MIN ? "late" : "present";
}

const digits = (s: string) => String(s ?? "").replace(/\D/g, "");
const tail = (s: string) => "…" + digits(s).slice(-4);
function isOwnerNumber(env: Env, n: string): boolean {
  const o = digits(env.OWNER_WHATSAPP ?? "");
  return !!o && digits(n) === o;
}

// ---------------------------------------------------------------- Odoo rows
async function readRows(env: Env, day: string, partnerIds: number[]): Promise<Map<number, AttRow>> {
  const rows = await call<AttRow[]>(env, ATT_MODEL, "search_read", {
    domain: [["x_date", "=", day], ["x_partner_id", "in", partnerIds]],
    fields: ROW_FIELDS,
    order: "id asc",
  });
  const out = new Map<number, AttRow>();
  for (const r of rows) {
    const pid = Array.isArray(r.x_partner_id) ? r.x_partner_id[0] : Number(r.x_partner_id);
    if (!out.has(pid)) out.set(pid, r); // the first row of the day is authoritative
  }
  return out;
}
async function findRow(env: Env, partnerId: number, day: string): Promise<AttRow | null> {
  return (await readRows(env, day, [partnerId])).get(partnerId) ?? null;
}
async function writeRow(env: Env, id: number, vals: Record<string, unknown>): Promise<void> {
  await call(env, ATT_MODEL, "write", { ids: [id], vals });
}

// ---------------------------------------------------------------- the 5-minute tick
export interface TickMemberReport { id: number; name: string; to: string; shift: string | null; roles: string[]; action: string }
export interface TickReport { day: string; at: string; owner: { at: string; source: string; action: string }; members: TickMemberReport[] }

export async function runAttendanceTick(env: Env, nowMs: number = Date.now()): Promise<TickReport> {
  const day = riyadhDateKey(new Date(nowMs));
  // Baraa is never on the attendance roster, even if he gets a role one day.
  // A roster read that fails still opens his window, at the fallback time.
  let team: AttendanceMember[] = [];
  let teamError: unknown = null;
  try {
    team = (await getAttendanceTeam(env)).filter((m) => !isOwnerNumber(env, m.whatsapp));
  } catch (e) {
    teamError = e;
  }
  const plan = ownerWindowPlan(env, team);
  const report: TickReport = { day, at: riyadhHHMM(new Date(nowMs)), owner: { at: hhmm(plan.minutes), source: plan.source, action: "-" }, members: [] };
  try {
    report.owner.action = await ownerWindowStep(env, day, nowMs, plan.minutes);
  } catch (e) {
    report.owner.action = `error: ${(e as Error)?.message}`;
    console.error("[attendance] owner window failed", (e as Error)?.message);
  }
  if (teamError) throw teamError;
  const timed = team.filter((m) => shiftMinutes(m.shiftStart) !== null && m.whatsapp);
  const rows = timed.length ? await readRows(env, day, timed.map((m) => m.id)) : new Map<number, AttRow>();
  for (const m of team) {
    const min = shiftMinutes(m.shiftStart);
    const base = { id: m.id, name: m.name, to: tail(m.whatsapp), shift: min === null ? null : hhmm(min), roles: m.codes };
    if (min === null) { report.members.push({ ...base, action: "no_time" }); continue; }
    if (!m.whatsapp) { report.members.push({ ...base, action: "no_number" }); continue; }
    try {
      report.members.push({ ...base, action: await memberStep(env, m, day, min, rows.get(m.id) ?? null, nowMs) });
    } catch (e) {
      report.members.push({ ...base, action: `error: ${(e as Error)?.message}` });
      console.error(`[attendance] ${m.name} failed`, (e as Error)?.message);
    }
  }
  return report;
}

async function memberStep(env: Env, m: AttendanceMember, day: string, min: number, row: AttRow | null, nowMs: number): Promise<string> {
  const shiftMs = riyadhDayMinuteMs(day, min);
  const since = nowMs - shiftMs;
  if (since < 0) return "before_shift";
  if (row?.x_tapped_at) return `tapped:${row.x_status || "-"}`;
  if (!row?.x_sent_at) {
    if (row) return "start_not_sent";            // claimed earlier; the send failed or was refused
    if (since >= REMIND_AFTER_MIN * MIN) return "start_window_missed";
    return sendStart(env, m, day, shiftMs, nowMs);
  }
  if (since >= ABSENT_AFTER_MIN * MIN) return row.x_status ? `already:${row.x_status}` : markAbsent(env, m, day, min, row);
  if (since >= REMIND_AFTER_MIN * MIN) return row.x_reminder_sent ? "reminded" : sendReminder(env, m, day, min, row);
  return "waiting";
}

function shiftTemplate(env: Env, job: string, to: string, name: string) {
  return sendTemplateByPurpose(withAutoSendJob(env, job), to, T.TEAM_SHIFT_START, [name || ""],
    [{ index: 0, payload: SHIFT_START_PAYLOAD }]);
}

async function sendStart(env: Env, m: AttendanceMember, day: string, shiftMs: number, nowMs: number): Promise<string> {
  const claim = await claimButton(env, `att:${day}:${m.id}:start`, CLAIM_TTL);
  if (!claim.claimed) return "start_claimed";
  let rowId: number;
  try {
    const found = await findRow(env, m.id, day);
    if (found?.x_sent_at) return "start_sent_before";
    rowId = found?.id ?? (await call<number[]>(env, ATT_MODEL, "create", { vals_list: [{
      x_name: `${m.name} · ${day}`, x_partner_id: m.id, x_date: day, x_shift_at: toOdooUtc(shiftMs), x_reminder_sent: false,
    }] }))[0];
  } catch (e) {
    await releaseButton(env, claim); // nothing sent yet: the next tick may try again
    throw e;
  }
  const r = await shiftTemplate(env, "shift_start", m.whatsapp, m.name);
  if (!r) return "no_template";
  if (!r.ok) return `start_failed:${r.status}`;
  await writeRow(env, rowId, { x_sent_at: toOdooUtc(nowMs) });
  return "start_sent";
}

async function sendReminder(env: Env, m: AttendanceMember, day: string, min: number, row: AttRow): Promise<string> {
  const claim = await claimButton(env, `att:${day}:${m.id}:remind`, CLAIM_TTL);
  if (!claim.claimed) return "remind_claimed";
  const r = await shiftTemplate(env, "shift_remind", m.whatsapp, m.name);
  const ok = !!r?.ok;
  if (ok) await writeRow(env, row.id, { x_reminder_sent: true });
  await sendOwnerAlert(withAutoSendJob(env, "shift_remind"),
    `⏰ ${m.name} لم يسجّل حضوره: دوامه ${hhmm(min)}، ومضت ${REMIND_AFTER_MIN} دقيقة بلا ضغط «بدء الدوام».${ok ? " أُرسل له تذكير." : " تعذّر إرسال التذكير."}`);
  return ok ? "reminded_now" : "remind_failed";
}

async function markAbsent(env: Env, m: AttendanceMember, day: string, min: number, row: AttRow): Promise<string> {
  const claim = await claimButton(env, `att:${day}:${m.id}:absent`, CLAIM_TTL);
  if (!claim.claimed) return "absent_claimed";
  const fresh = await findRow(env, m.id, day); // a tap may have landed since the tick read the rows
  if (fresh?.x_tapped_at || fresh?.x_status) return `tapped:${fresh.x_status || "-"}`;
  await writeRow(env, row.id, { x_status: "absent" });
  await sendOwnerAlert(withAutoSendJob(env, "shift_absent"),
    `❌ ${m.name} سُجّل غائباً اليوم: لم يضغط «بدء الدوام» خلال ${ABSENT_AFTER_MIN} دقيقة من دوامه (${hhmm(min)}).`);
  return "absent_now";
}

async function ownerWindowStep(env: Env, day: string, nowMs: number, windowMinutes: number): Promise<string> {
  const owner = env.OWNER_WHATSAPP;
  if (!owner) return "no_owner";
  const since = nowMs - riyadhDayMinuteMs(day, windowMinutes);
  if (since < 0) return "before";
  if (since >= REMIND_AFTER_MIN * MIN) return "passed";
  const claim = await claimButton(env, `att:${day}:owner:window`, CLAIM_TTL);
  if (!claim.claimed) return "sent_before";
  const r = await sendTemplateByPurpose(withAutoSendJob(env, OWNER_WINDOW_PURPOSE), owner, T.TEAM_SHIFT_START,
    [OWNER_TEMPLATE_NAME], [{ index: 0, payload: SHIFT_START_PAYLOAD }], undefined, { sendPurpose: OWNER_WINDOW_PURPOSE });
  if (!r) return "no_template";
  return r.ok ? "sent" : `failed:${r.status}`;
}

// ---------------------------------------------------------------- the tap
export type TapResult =
  | { kind: "not_on_attendance" }
  | { kind: "owner"; text: string }
  | { kind: "not_started"; text: string }
  | { kind: "first" | "again"; status: AttStatus; text: string };

/**
 * A team member tapped «بدء الدوام» (payload shift_start) at tapMs (Meta's
 * timestamp). Only a tap on today's template counts: before today's template
 * went out, nothing is recorded and no task is released.
 */
export async function recordShiftTap(env: Env, partnerId: number, tapMs: number): Promise<TapResult> {
  const [p] = await call<Array<{ id: number; name: string; x_shift_start: number | false; x_whatsapp_number: string | false }>>(env, "res.partner", "read", {
    ids: [partnerId], fields: ["id", "name", "x_shift_start", "x_whatsapp_number"],
  });
  // Baraa, even if he is given a team role one day: his tap only opens his window.
  if (p && isOwnerNumber(env, String(p.x_whatsapp_number || ""))) return { kind: "owner", text: ownerWindowAck(tapMs) };
  const min = shiftMinutes(p?.x_shift_start);
  if (!p || min === null) return { kind: "not_on_attendance" };
  const day = riyadhDateKey(new Date(tapMs));
  const shiftMs = riyadhDayMinuteMs(day, min);
  const row = await findRow(env, partnerId, day);
  if (!row || !row.x_sent_at) {
    return { kind: "not_started", text: `دوامك اليوم يبدأ ${hhmm(min)}، ووقتها يوصلك زر «بدء الدوام» ومعه مهامك.` };
  }
  const again = (r: AttRow): TapResult => ({
    kind: "again", status: (r.x_status || "present") as AttStatus,
    text: `دوامك اليوم مسجّل من ${odooUtcToRiyadhHHMM(r.x_tapped_at || undefined)} ✅`,
  });
  if (row.x_tapped_at) return again(row);
  const claim = await claimButton(env, `att:${day}:${partnerId}:tap`, CLAIM_TTL);
  if (!claim.claimed) return again({ ...row, x_tapped_at: toOdooUtc(tapMs) });
  const status = statusForTap(tapMs, shiftMs);
  const afterAbsent = row.x_status === "absent" || tapMs - shiftMs >= ABSENT_AFTER_MIN * MIN;
  await writeRow(env, row.id, { x_tapped_at: toOdooUtc(tapMs), x_status: status });
  const at = riyadhHHMM(new Date(tapMs));
  if (afterAbsent) {
    await sendOwnerAlert(env,
      `🕘 ${p.name} سجّل حضوره متأخراً الساعة ${at} (دوامه ${hhmm(min)})${row.x_status === "absent" ? " بعد تسجيله غائباً" : ""}، فسُجّل «متأخر» ووصلته مهامه.`);
  }
  return {
    kind: "first", status,
    text: status === "present" ? `تم تسجيل حضورك الساعة ${at} ✅` : `تم تسجيل حضورك الساعة ${at} ✅ (متأخر، دوامك ${hhmm(min)})`,
  };
}

// ---------------------------------------------------------------- the gate
export interface Hold { hold: boolean; onAttendance: boolean; shift?: string; sent?: boolean }

/**
 * Must a task for this member wait for today's «بدء الدوام» tap? Only a member
 * with a shift time who has not tapped today is held. Any Odoo trouble answers
 * «not held» — the task goes out as it did before attendance existed.
 */
export async function attendanceHold(env: Env, partnerId: number, nowMs: number = Date.now()): Promise<Hold> {
  try {
    const [p] = await call<Array<{ id: number; x_shift_start: number | false; x_whatsapp_number: string | false }>>(env, "res.partner", "read", {
      ids: [partnerId], fields: ["id", "x_shift_start", "x_whatsapp_number"],
    });
    const min = shiftMinutes(p?.x_shift_start);
    if (!p || min === null || isOwnerNumber(env, String(p.x_whatsapp_number || ""))) return { hold: false, onAttendance: false };
    const row = await findRow(env, partnerId, riyadhDateKey(new Date(nowMs)));
    if (row?.x_tapped_at) return { hold: false, onAttendance: true, shift: hhmm(min), sent: true };
    return { hold: true, onAttendance: true, shift: hhmm(min), sent: !!row?.x_sent_at };
  } catch (e) {
    console.warn(`[attendance] hold check failed for ${partnerId} — not holding`, (e as Error)?.message);
    return { hold: false, onAttendance: false };
  }
}

/** What a held member is told when they write before tapping. */
export function holdText(h: Hold): string {
  return h.sent
    ? "اضغط «بدء الدوام» في رسالة اليوم، وبعدها توصلك مهامك هنا."
    : `دوامك اليوم يبدأ ${h.shift}، ووقتها يوصلك زر «بدء الدوام» ومعه مهامك.`;
}

export const NO_TASKS_TEXT = "ما عندك مهام الآن. أول ما تجهز توصلك هنا 👍";

/**
 * After the tap: everything queued for the member, then what Odoo says is
 * open for their roles (the warehouse's purchase lists without «تم الشراء»,
 * the collector's unpaid invoices). Returns how many messages went out.
 */
export async function deliverTasksOnTap(env: Env, member: { x_role?: string; x_role_codes?: string[] }, to: string): Promise<number> {
  const codes = new Set([member.x_role, ...(member.x_role_codes ?? [])].filter(Boolean));
  let n = await flushTeamQueue(env, to);
  if (codes.has("warehouse")) {
    const { resendOpenPurchaseLists } = await import("./team");
    n += await resendOpenPurchaseLists(env, to).catch(() => 0);
  }
  if (codes.has("collector")) {
    const { sendCollectorBacklog } = await import("./invoice");
    n += await sendCollectorBacklog(env, to).catch(() => 0);
  }
  if (n === 0) await sendText(env, to, NO_TASKS_TEXT);
  return n;
}

/** Owner tapped «بدء الدوام» on the window-opening template: one line, nothing recorded. */
export function ownerWindowAck(nowMs: number = Date.now()): string {
  return `✅ تم. تنبيهات يو تاك توصلك هنا نصاً حتى ${riyadhHHMM(new Date(nowMs + 24 * 60 * MIN))} بكرة.`;
}

