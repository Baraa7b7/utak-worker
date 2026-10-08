// § 68 (2026-10-08) — the trial of the attendance record, to Baraa's number alone (`/odoo/hook/s68-trial?op=…`):
//
//   op=in     «بدأت الدوام» on Baraa's OWN card: a row of today marked «محاكاة» (it enters no figure of the month,
//             and no reader of the day's attendance sees it), and the answer a member gets — with «🏁 انتهى دوامي»
//             under it. Once a day.
//   op=out    «انتهى دوامي» on that row: its exit, and the answer. The trial message's own button does the same.
//   op=state  nothing is sent or written: the trial's row of today as Odoo holds it.
//
// Baraa's own attendance is never recorded (§ 59 أ): this row is the trial's alone. Nobody else is reached.

import type { Env } from "./config";
import { call } from "./odoo";
import { ATT_MODEL, ENTRY_HINT, SHIFT_END_TITLE, SOURCE_WHATSAPP, durationAr, freeShift, hhmm, lateMinutes, ownerMember, statusForTap } from "./attendance";
import { odooUtcMs, odooUtcToRiyadhHHMM, riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM, toOdooUtc } from "./hours";
import { sendButtons, sendText } from "./meta";
import { dayPlan, loadRoster } from "./team-roster";
import { gatewayDecision } from "./wa-gateway";

export const S68_TRIAL_MARK = "🧪 تجربة";
export const S68_TRIAL_PURPOSE = "attendance_test";
/** The exit button of the trial's own message (a member's is `shift_end`). */
export const S68_TRIAL_END_PAYLOAD = "shift_end_test";
export const S68_TRIAL_NOTE = "تجربة § 68 (محاكاة: لا تُحسب)";
export const S68_TRIAL_FOOT = "(تجربة على بطاقتك: صف «محاكاة» في «👥 الموظفون ← الحضور» لا يدخل أرقام الشهر، ولم تصل رسالة لأحد غيرك)";
const FIELDS = ["id", "x_name", "x_date", "x_shift_at", "x_tapped_at", "x_out_at", "x_status", "x_late_min", "x_source", "x_note", "x_utak_simulation"];

export interface S68TrialResult { op: string; sent?: boolean; decision?: string; reason?: string; rowId?: number; row?: Record<string, unknown> | null }
type Row = { id: number; x_tapped_at: string | false; x_out_at: string | false; x_status: string | false } & Record<string, unknown>;

async function trialRow(env: Env, employeeId: number, day: string): Promise<Row | null> {
  const rows = await call<Row[]>(env, ATT_MODEL, "search_read", {
    domain: [["x_employee_id", "=", employeeId], ["x_date", "=", day], ["x_utak_simulation", "=", true]], fields: FIELDS, order: "id desc", limit: 1,
  });
  return rows[0] ?? null;
}
const sentOf = (r: Response): { sent: boolean; decision: string } => {
  const d = gatewayDecision(r);
  return { sent: d?.action === "session", decision: d?.action ?? `HTTP ${r.status}` };
};

export async function runS68Trial(env: Env, op: string, now: number = Date.now()): Promise<S68TrialResult> {
  const owner = String(env.OWNER_WHATSAPP ?? "");
  if (!owner) return { op, sent: false, reason: "no owner number" };
  const roster = await loadRoster(env, now);
  const me = ownerMember(env, roster);
  if (!me) return { op, sent: false, reason: "Baraa has no card with a role in «👥 الموظفون»" };
  const day = riyadhDateKey(new Date(now));
  const row = await trialRow(env, me.employeeId, day);
  if (op === "state") return { op, row };
  const at = riyadhHHMM(new Date(now));
  if (op === "in") {
    if (row) return { op, sent: false, rowId: row.id, reason: "the trial's entry was recorded today already" };
    const plan = dayPlan(roster, me, day);
    const startMin = plan.kind === "work" ? (plan.startMin as number) : (await freeShift(env, roster, me, day, now))?.startMin ?? null;
    const shiftMs = startMin === null ? null : riyadhDayMinuteMs(day, startMin);
    const status = shiftMs === null ? "present" : statusForTap(now, shiftMs);
    const [rowId] = await call<number[]>(env, ATT_MODEL, "create", { vals_list: [{
      x_name: `${S68_TRIAL_MARK} § 68 — ${me.name} · ${day}`, x_employee_id: me.employeeId, x_partner_id: me.partnerId || false, x_date: day,
      x_shift_at: shiftMs === null ? false : toOdooUtc(shiftMs), x_tapped_at: toOdooUtc(now), x_status: status,
      x_late_min: shiftMs === null ? 0 : lateMinutes(now, shiftMs), x_source: SOURCE_WHATSAPP, x_reminder_sent: false,
      x_note: S68_TRIAL_NOTE, x_utak_simulation: true,
    }] });
    const answer = status === "late" && startMin !== null ? `تم تسجيل حضورك الساعة ${at} ✅ (متأخر، دوامك ${hhmm(startMin)})` : `تم تسجيل حضورك الساعة ${at} ✅`;
    const r = await sendButtons(env, owner, `${S68_TRIAL_MARK} § 68 — ${answer}\n${ENTRY_HINT}\n${S68_TRIAL_FOOT}`, [{ id: S68_TRIAL_END_PAYLOAD, title: SHIFT_END_TITLE }], { purpose: S68_TRIAL_PURPOSE });
    return { op, rowId, ...sentOf(r) };
  }
  if (op === "out") {
    if (!row || !row.x_tapped_at) return { op, sent: false, reason: "no trial entry today (run op=in first)" };
    if (row.x_out_at) {
      const r = await sendText(env, owner, `${S68_TRIAL_MARK} § 68 — خروجك مسجّل من ${odooUtcToRiyadhHHMM(row.x_out_at)} ✅`, { purpose: S68_TRIAL_PURPOSE });
      return { op, rowId: row.id, reason: "the trial's exit was recorded already", ...sentOf(r) };
    }
    await call(env, ATT_MODEL, "write", { ids: [row.id], vals: { x_out_at: toOdooUtc(now) } });
    const minutes = Math.max(0, Math.floor((now - odooUtcMs(row.x_tapped_at)) / 60_000));
    const r = await sendText(env, owner, `${S68_TRIAL_MARK} § 68 — تم تسجيل خروجك الساعة ${at} ✅ — مدة دوامك ${durationAr(minutes)}.\n${S68_TRIAL_FOOT}`, { purpose: S68_TRIAL_PURPOSE });
    return { op, rowId: row.id, ...sentOf(r) };
  }
  return { op, sent: false, reason: "op is in, out or state" };
}
