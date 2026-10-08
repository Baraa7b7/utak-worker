// § 67 أ (2026-10-08) — «🧊 وضع التجميد».
//
// One switch on the pricing settings («💲 التسعير ← ⚙️ الإعدادات», and the button of «📊 اليوم»): while it is on,
// NO automatic message leaves for anyone but Baraa.
//   • the scheduled jobs do not run at all (the price asks and their reminders, the 06:00 publication and the
//     customers' messages, the collection reminders, the team's «بدء الدوام», the day's own alerts to Baraa and
//     his 21:30 summary). Each one is recorded once, «🧊 مجمّد», in the WhatsApp messages' log, and is never
//     sent later;
//   • the gateway refuses every other automatic send to another number (src/wa-gateway.ts), recorded «مجمّد»
//     with its text and its recipient — nothing is held;
//   • what Baraa does by hand works as it always did: a message from the chat, a quotation, a supplier's
//     approval — every request Odoo's buttons make (`/odoo/hook/*`, `/internal/*`), and his own taps on WhatsApp;
//   • an incoming message is recorded in Odoo as always, and the bot answers nobody but Baraa: a customer gets
//     the settings' reply (once in six hours a number), and Baraa is told who wrote;
//   • the system's own alarms (Odoo not answering, a publication that failed) still reach him.
// «حتى تاريخ» is the last frozen day: the first tick after it turns the switch off in Odoo and tells Baraa.
// Odoo stamps «بدأ» / «انتهى» itself (automation #33): what was due while the switch was on is not sent after
// it is turned off — everything resumes from its next time (frozenAt).

import type { Env } from "./config";
import { CONFIG_MODEL } from "./operating-cost";
import { addDaysYmd, odooUtcMs, riyadhDateKey, riyadhDayMinuteMs, riyadhMinutes } from "./hours";
import { arabicDate, maskPhone } from "./wa-params";
import { waDigits } from "./wa-window";

export const FREEZE_FIELDS = ["id", "x_freeze_on", "x_freeze_until", "x_freeze_reply", "x_freeze_since", "x_freeze_ended_at"];
export const DEFAULT_FREEZE_REPLY = "نشكر تواصلك 🌿 استقبال الطلبات متوقف مؤقتاً ونرجع قريباً بإذن الله";
/** x_wa_message.x_status of what the freeze stepped over. */
export const FROZEN_STATUS = "frozen";
/**
 * The switch as the last fresh read left it, in KV: what a send and an incoming message read (no Odoo call on
 * their path — the settings are a pricing model, and a form's send must not read one). The every-5-minutes
 * tick and every cron read it fresh, so a change of the switch holds everywhere within five minutes.
 */
/** The customer's reply: once in this long for a number. */
export const FREEZE_REPLY_EVERY_MS = 6 * 3600_000;
export const FREEZE_REPLY_PURPOSE = "freeze_reply";
const CACHE_KEY = "freeze:v1";

export interface FreezeState {
  configId: number | null;
  /** «🧊 وضع التجميد» as the settings hold it. */
  switchOn: boolean;
  /** «حتى تاريخ»: the last frozen day (Riyadh), or null. */
  until: string | null;
  /** «بدأ التجميد» / «انتهى التجميد» (ms), stamped by Odoo. */
  since: number | null;
  endedAt: number | null;
  reply: string;
  readAt: number;
}
const OFF: FreezeState = { configId: null, switchOn: false, until: null, since: null, endedAt: null, reply: DEFAULT_FREEZE_REPLY, readAt: 0 };

/** The first moment after «حتى تاريخ» (00:00 Riyadh of the next day). */
export function untilEndMs(until: string): number {
  return riyadhDayMinuteMs(addDaysYmd(until, 1), 0);
}
/** Frozen at this moment: the switch is on and «حتى تاريخ» has not passed. */
export function isFrozenNow(s: FreezeState, now: number): boolean {
  return s.switchOn && (!s.until || now < untilEndMs(s.until));
}
/**
 * Was the system frozen at `ms` — of the freeze that is on now, or of the last one? What was due then is
 * not sent, also after the switch is turned off: «بلا إرسال متأخر لما فات».
 */
export function frozenAt(s: FreezeState, ms: number): boolean {
  const since = s.since ?? (s.switchOn ? 0 : null);
  if (since === null) return false;
  let end = s.switchOn ? Number.POSITIVE_INFINITY : (s.endedAt ?? since);
  if (s.until) end = Math.min(end, untilEndMs(s.until));
  return ms >= since && ms < end;
}

function stateOf(r: Record<string, unknown> | undefined, now: number): FreezeState {
  if (!r) return { ...OFF, readAt: now };
  const ms = (v: unknown): number | null => { const t = typeof v === "string" && v ? odooUtcMs(v) : NaN; return Number.isFinite(t) && t > 0 ? t : null; };
  const reply = typeof r.x_freeze_reply === "string" ? r.x_freeze_reply.trim() : "";
  return {
    configId: Number(r.id) || null,
    switchOn: r.x_freeze_on === true,
    until: typeof r.x_freeze_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.x_freeze_until) ? r.x_freeze_until : null,
    since: ms(r.x_freeze_since),
    endedAt: ms(r.x_freeze_ended_at),
    reply: reply || DEFAULT_FREEZE_REPLY,
    readAt: now,
  };
}

/**
 * The switch. `fresh` (the ticks, the crons, the trial): from the settings, and kept in KV. Otherwise the
 * last fresh read, from KV alone — with none on record, not frozen.
 * Odoo not answering never thaws a frozen system: the last state read stands. Never throws.
 */
export async function readFreeze(env: Env, now: number = Date.now(), opts: { fresh?: boolean } = {}): Promise<FreezeState> {
  let cached: FreezeState | null = null;
  try {
    const raw = await env.MSG_DEDUP.get(CACHE_KEY);
    cached = raw ? (JSON.parse(raw) as FreezeState) : null;
  } catch { cached = null; }
  if (!opts.fresh) return cached ?? { ...OFF, readAt: now };
  try {
    const { call } = await import("./odoo");
    const day = riyadhDateKey(new Date(now));
    const [r] = await call<Array<Record<string, unknown>>>(env, CONFIG_MODEL, "search_read", {
      domain: [["x_is_active", "=", true], ["x_active_from", "<=", day], "|", ["x_active_to", "=", false], ["x_active_to", ">=", day]],
      fields: FREEZE_FIELDS, order: "x_active_from desc, id desc", limit: 1,
    }, { quiet: true });
    const s = stateOf(r, now);
    try { await env.MSG_DEDUP.put(CACHE_KEY, JSON.stringify(s), { expirationTtl: 7 * 24 * 3600 }); } catch { /* read again next time */ }
    return s;
  } catch (e) {
    console.warn(`[freeze] the switch could not be read — ${cached ? "the last state stands" : "not frozen"}`, (e as Error)?.message);
    return cached ?? { ...OFF, readAt: now };
  }
}

/** Test hook / after a write of the switch: the next read asks Odoo. */
export async function forgetFreeze(env: Env): Promise<void> {
  try { await env.MSG_DEDUP.delete(CACHE_KEY); } catch { /* a minute at most */ }
}

export interface FreezeView {
  state: FreezeState;
  /** frozen now */
  on: boolean;
  /** what was due at `ms` fell inside the freeze: not sent, now or later */
  missed: (dueMs: number) => boolean;
  /** the same, for a minute of today (Riyadh) */
  missedToday: (minute: number) => boolean;
}
export async function freezeView(env: Env, now: number = Date.now(), opts: { fresh?: boolean } = {}): Promise<FreezeView> {
  const state = await readFreeze(env, now, opts);
  const day = riyadhDateKey(new Date(now));
  return {
    state,
    on: isFrozenNow(state, now),
    missed: (dueMs) => frozenAt(state, dueMs),
    missedToday: (minute) => frozenAt(state, riyadhDayMinuteMs(day, minute)),
  };
}

// ---------------------------------------------------------------- what Baraa does by hand

/** A request Odoo's buttons made, or a message of Baraa's own: the sends inside it are his, not the system's. */
export function withOwnerAct(env: Env, how: string): Env {
  return { ...env, OWNER_ACT: how };
}
/** The routes Odoo's buttons and automations call. */
export function isOwnerActPath(pathname: string): boolean {
  return pathname.startsWith("/odoo/hook/") || pathname.startsWith("/internal/");
}

/**
 * The gateway's question: is this send to another number stopped by the freeze? The reason, or null.
 * A manual message, a send inside one of Baraa's own acts and the freeze's reply are never stopped.
 */
export async function frozenSend(env: Env, req: { purpose: string; manual?: boolean }, kind: string | undefined, now: number = Date.now()): Promise<string | null> {
  if (req.manual || kind === "manual" || env.OWNER_ACT || req.purpose === FREEZE_REPLY_PURPOSE) return null;
  const s = await readFreeze(env, now);
  if (!isFrozenNow(s, now)) return null;
  return `🧊 مجمّد: وضع التجميد مُشغَّل${s.until ? ` حتى ${arabicDate(s.until)}` : ""}، ولا رسالة آلية تخرج لغير براء. لا تُرسل لاحقاً`;
}

// ---------------------------------------------------------------- the scheduled jobs

/** The crons that do not run at all while frozen. The 05:00 one keeps its template sync; the two ticks keep their upkeep. */
export const FROZEN_CRONS: ReadonlySet<string> = new Set([
  "0 23 * * *",   // 02:00 the price ask
  "0 3 * * *",    // 06:00 the publication, «صباح الخير», the purchase follow-up
  "0 5 * * *",    // 08:00 the feedback, the payment reminders, the absence
  "0 14 * * *",   // 17:00 the standing orders
  "0 15 * * *",   // 18:00 the collection summary
  "0 17 * * *",   // 20:00 the unconfirmed orders' reminder
  "0 18 * * *",   // 21:00 their close
  "15 18 * * *",  // 21:15 the purchase list and the routes
  "30 18 * * *",  // 21:30 Baraa's summary
  "2,7,12,17,22,27,32,37,42,47,52,57 * * * *", // the driver's end of shift
]);
/** /sim/trigger's job names of the same crons (and the jobs inside the 05:00 one that the freeze stops). */
export const FROZEN_JOB_NAMES: ReadonlySet<string> = new Set([
  "ask_suppliers", "open_ordering", "daily_outreach", "standing_reminders", "collection_summary", "cutoff_reminder",
  "close_unconfirmed", "aggregate_purchase", "owner_summary", "driver_followup", "team_attendance",
  "supplier_nudge", "supplier_noprice_alert", "purchase_followup", "reliability_scores",
]);

/** What the freeze steps over in a day, with the minute (Riyadh) each is due: one «مجمّد» line each, once a day. */
export const FROZEN_JOBS: ReadonlyArray<{ key: string; minute: number; label: string }> = [
  { key: "ask_suppliers", minute: 2 * 60, label: "طلب أسعار الشراء من الموردين (02:00)" },
  { key: "shift_start", minute: 2 * 60, label: "رسائل دوام الفريق: «بدء الدوام» وتذكيره والغياب" },
  { key: "market_ask", minute: 2 * 60 + 30, label: "طلب أسعار السوق من المصادر (02:30)" },
  { key: "price_review", minute: 4 * 60, label: "مراجعة أسعار اليوم لبراء (04:00)" },
  { key: "sources_missing", minute: 4 * 60 + 30, label: "تنبيه «مصدر لم يرسل» (04:30)" },
  { key: "price_nudge", minute: 5 * 60, label: "تذكير الموردين ومصادر السوق بالأسعار (05:00)" },
  { key: "publish", minute: 6 * 60, label: "نشر أسعار اليوم ورسائل العملاء و«صباح الخير» (06:00)" },
  { key: "daily_outreach", minute: 8 * 60, label: "التقييم وتذكير الدفع وتذكير الغياب (08:00)" },
  { key: "standing_reminders", minute: 17 * 60, label: "تذكير الطلب المعتاد (17:00)" },
  { key: "collection_summary", minute: 18 * 60, label: "ملخص التحصيل (18:00)" },
  { key: "cutoff_reminder", minute: 20 * 60, label: "تذكير الطلبات غير المؤكدة (20:00)" },
  { key: "close_unconfirmed", minute: 21 * 60, label: "إقفال الطلبات غير المؤكدة (21:00)" },
  { key: "aggregate_purchase", minute: 21 * 60 + 15, label: "قائمة الشراء والمسارات (21:15)" },
  { key: "owner_summary", minute: 21 * 60 + 30, label: "ملخص اليوم لبراء (21:30)" },
];
export const frozenJobText = (label: string): string => `🧊 مجمّد — ${label}: لم يُرسل لأحد ولن يُرسل لاحقاً.`;
const jobKey = (day: string, key: string): string => `frz_job:v1:${day}:${key}`;

/**
 * Every job of today whose time has come while frozen gets its ONE «مجمّد» row (x_wa_message, no recipient).
 * A row Odoo refused is tried again at the next tick. Never throws.
 */
export async function noteFrozenJobs(env: Env, s: FreezeState, now: number = Date.now()): Promise<string[]> {
  const day = riyadhDateKey(new Date(now));
  const m = riyadhMinutes(new Date(now));
  const noted: string[] = [];
  for (const j of FROZEN_JOBS) {
    if (j.minute > m || !frozenAt(s, riyadhDayMinuteMs(day, j.minute))) continue;
    try {
      if (await env.MSG_DEDUP.get(jobKey(day, j.key))) continue;
      const { createWaMessageRow } = await import("./wa-message-send");
      const id = await createWaMessageRow(env, { partnerId: null, direction: "out", kind: "text", body: frozenJobText(j.label), source: "auto", status: FROZEN_STATUS });
      if (!id) continue;
      await env.MSG_DEDUP.put(jobKey(day, j.key), String(id), { expirationTtl: 2 * 24 * 3600 });
      noted.push(j.key);
    } catch (e) {
      console.warn(`[freeze] the «مجمّد» row of ${j.key} failed`, (e as Error)?.message);
    }
  }
  return noted;
}

/** A job the freeze stops was started by hand (/sim/trigger): its «مجمّد» row, once a day. Returns what was written. */
export async function noteFrozenRun(env: Env, job: string, now: number = Date.now()): Promise<string> {
  const label = FROZEN_JOBS.find((j) => j.key === job)?.label ?? job;
  const key = jobKey(riyadhDateKey(new Date(now)), `run:${job}`);
  try {
    if (await env.MSG_DEDUP.get(key)) return "recorded before";
    const { createWaMessageRow } = await import("./wa-message-send");
    const id = await createWaMessageRow(env, { partnerId: null, direction: "out", kind: "text", body: frozenJobText(`${label} — تشغيل يدوي`), source: "auto", status: FROZEN_STATUS });
    if (!id) return "the row was not written";
    await env.MSG_DEDUP.put(key, String(id), { expirationTtl: 2 * 24 * 3600 });
    return `x_wa_message #${id}`;
  } catch (e) {
    return `the row failed: ${(e as Error)?.message}`;
  }
}

export const freezeEndedText = (until: string): string =>
  `🧊 انتهى وضع التجميد (كان حتى ${arabicDate(until)}): أُطفئ وحده، والنظام يعود للعمل من الموعد التالي. لم يُرسل شيء مما فات أثناء التجميد.`;

export interface FreezeTick { on: boolean; action: "off" | "frozen" | "ended"; noted?: string[]; detail?: string }
/**
 * The every-5-minutes tick, with the switch read fresh: «حتى تاريخ» has passed → the switch is turned off in
 * Odoo and Baraa is told once; frozen → the «مجمّد» rows of the jobs whose time has come. Never throws.
 */
export async function runFreezeTick(env: Env, now: number = Date.now()): Promise<FreezeTick> {
  const s = await readFreeze(env, now, { fresh: true });
  if (!s.switchOn) return { on: false, action: "off" };
  if (!isFrozenNow(s, now) && s.until && s.configId) {
    try {
      const { call } = await import("./odoo");
      await call(env, CONFIG_MODEL, "write", { ids: [s.configId], vals: { x_freeze_on: false, x_freeze_until: false } });
      await forgetFreeze(env);
      const { sendOwnerAlert } = await import("./templates");
      await sendOwnerAlert(env, freezeEndedText(s.until), { kind: "freeze_ended", critical: true });
      return { on: false, action: "ended", detail: s.until };
    } catch (e) {
      console.error("[freeze] the switch could not be turned off after «حتى تاريخ»", (e as Error)?.message);
      return { on: false, action: "ended", detail: `error: ${(e as Error)?.message}` };
    }
  }
  return { on: true, action: "frozen", noted: await noteFrozenJobs(env, s, now) };
}

// ---------------------------------------------------------------- an incoming message while frozen

export type FrozenSender = "customer" | "team" | "supplier" | "source";
const WHO: Record<FrozenSender, string> = { customer: "عميل", team: "الفريق", supplier: "مورد", source: "مصدر أسعار" };
const replyKey = (digits: string): string => `frz_reply:v1:${waDigits(digits)}`;
export const frozenInboundAlert = (who: FrozenSender, name: string, from: string, what: string, replied: boolean): string =>
  `🧊 رسالة أثناء التجميد من ${WHO[who]} «${name || "بلا اسم"}» (${maskPhone(from)}): «${what}»${who === "customer" ? (replied ? " — وصله رد التجميد." : " — وصله رد التجميد قبل قليل، فلم يتكرر.") : " — لم يُرَدّ عليه."} المحادثة في «💬 المحادثات».`;

/**
 * A message from anyone but Baraa while frozen (it is in the inbox already): the bot does not act on it.
 * A customer gets the settings' reply, once in six hours; Baraa is told who wrote and what. True = frozen,
 * the caller stops here. Never throws (a failure here must not let the bot answer).
 */
export async function frozenInbound(
  env: Env,
  m: { from: string; name: string; who: FrozenSender; what: string; partnerId?: number },
  ctx?: ExecutionContext,
  now: number = Date.now(),
): Promise<boolean> {
  const s = await readFreeze(env, now);
  if (!isFrozenNow(s, now)) return false;
  let replied = false;
  let accepted = false;
  try {
    if (m.who === "customer") {
      // § 66 — an answer to a quotation Baraa sent by hand is not an attempt to order: his alert, no reply
      if (m.partnerId && m.what) {
        const { looksLikeAcceptance, noticeAcceptance } = await import("./special-accept");
        if (looksLikeAcceptance(m.what)) accepted = (await noticeAcceptance(env, { id: m.partnerId, name: m.name }, now)).some((n) => n.action !== "not_delivered");
      }
      if (!accepted) {
        const last = Number(await env.MSG_DEDUP.get(replyKey(m.from))) || 0;
        if (!(last > 0 && Math.abs(now - last) < FREEZE_REPLY_EVERY_MS)) {
          await env.MSG_DEDUP.put(replyKey(m.from), String(now), { expirationTtl: 24 * 3600 });
          const { sendText } = await import("./meta");
          await sendText(env, m.from, s.reply, { ctx, purpose: FREEZE_REPLY_PURPOSE });
          replied = true;
        }
      }
    }
    if (!accepted) {
      const { sendOwnerAlert } = await import("./templates");
      await sendOwnerAlert(env, frozenInboundAlert(m.who, m.name, m.from, m.what.replace(/\s+/g, " ").slice(0, 200), replied), { kind: "freeze_inbound" });
    }
  } catch (e) {
    console.warn("[freeze] the incoming message's reply or alert failed", (e as Error)?.message);
  }
  console.log(`[freeze] inbound from=${maskPhone(m.from)} who=${m.who} skip=bot replied=${replied} accepted=${accepted}`);
  return true;
}
