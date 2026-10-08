// § 67 هـ (2026-10-08) — Baraa's alerts are merged, capped, and — the important ones — never lost.
//
// What happened at dawn on 2026-10-08: one Odoo refusal (HTTP 429) alerted Baraa; Meta's status callbacks of
// that alert looked their row up in Odoo, were refused too, and each one alerted again — 41 alerts in 65
// seconds, until Meta answered 131056 and the gateway of § 33 stopped the whole purpose for 24 hours. The
// throttle of before lived in one isolate's memory; the callbacks ran in many.
//
// Every alert to Baraa passes here (sendOwnerAlert in src/templates.ts), and the state is in KV:
//   • the same kind within 10 minutes is ONE message: the first goes at once (nothing important waits ten
//     minutes), and what repeats inside its window is kept and goes as one message at the window's end, each
//     alert on its line — nothing an alert said is lost;
//   • a «buffered» kind (Odoo not answering) sends nothing at once: one message at the window's end,
//     «⚠️ Odoo لم يستجب 11 مرة بين 03:00 و03:20 — آخر خطأ: …» — an alert about a failure never feeds it;
//   • alerts that are not important: six an hour, and the rest of that hour in one summary at its end;
//   • an important one («أسعار اليوم لم تُنشر», «🚚 طلب كبير», «✅ العميل يبدو موافقاً», «مصدر لم يرسل», Odoo
//     not answering) goes under the purpose `owner_critical`: the gateway never blocks it and never drops it
//     (src/wa-gateway.ts), and the cap does not count it.
// A kind is named by the caller, or read from the alert's first words (digits and what follows «:» / «—» left out).

import type { Env } from "./config";
import { fnv1a } from "./auto-send-guard";
import { riyadhHHMM } from "./hours";
import { gatewayDecision, sendViaGateway } from "./wa-gateway";

export const OWNER_ALERT_PURPOSE = "owner_alert";
export const OWNER_CRITICAL_PURPOSE = "owner_critical";
/** Alerts of one kind inside this long are one message. */
export const MERGE_WINDOW_MS = 10 * 60_000;
/** Alerts that are not important: this many an hour. */
export const HOURLY_CAP = 6;
const HOUR_MS = 3600_000;
const INDEX_KEY = "oa_idx:v1";
const kindKey = (h: string): string => `oa_k:v1:${h}`;
const hourOf = (now: number): number => Math.floor(now / HOUR_MS) * HOUR_MS;
const capKey = (hour: number): string => `oa_hr:v1:${hour}`;
const overKey = (hour: number): string => `oa_over:v1:${hour}`;
const OVER_PREFIX = "over:";

export interface OwnerAlertOpts {
  /** What merges with what. Default: read from the text's first words. */
  kind?: string;
  /** Important: never blocked, never dropped, not counted by the hourly cap. */
  critical?: boolean;
  /** Nothing goes at once: ONE message at the window's end, «title N مرة بين … و… — آخر خطأ: text». */
  buffer?: { title: string };
  now?: number;
}
export type OwnerAlertOutcome = "sent" | "merged" | "buffered" | "capped" | "failed";

interface KindRecord {
  kind: string;
  /** the window's start: the first alert of the kind */
  first: number;
  /** every alert of the kind in the window, the first included */
  count: number;
  /** those that were not sent */
  repeats: number;
  lastAt: number;
  lastText: string;
  /** the alerts that were not sent, as they were written (a buffered kind keeps the last one alone) */
  texts: string[];
  /** how many more were folded after `texts` was full */
  dropped: number;
  critical: boolean;
  title?: string;
}
/** What one merged message carries of the alerts it folds. */
export const MERGED_TEXT_LIMIT = 3000;
interface Overflow { n: number; items: string[] }

/** The kind of an alert, from its first words: digits out, and whatever follows «:», «—», a bracket or a quote. */
export function alertKind(text: string): string {
  const line = String(text ?? "").split("\n")[0];
  const head = line.split(/[:—(«"“]/)[0].replace(/[0-9٠-٩]+/g, "#").replace(/\s+/g, " ").trim();
  return (head.length >= 3 ? head : line.replace(/[0-9٠-٩]+/g, "#").replace(/\s+/g, " ").trim()).slice(0, 48) || "تنبيه";
}

async function get<T>(env: Env, key: string): Promise<T | null> {
  try { const raw = await env.MSG_DEDUP.get(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
async function put(env: Env, key: string, v: unknown, ttlSec = 3 * 3600): Promise<void> {
  try { await env.MSG_DEDUP.put(key, JSON.stringify(v), { expirationTtl: ttlSec }); } catch (e) { console.warn(`[owner-alerts] KV write ${key.split(":")[0]} failed`, (e as Error)?.message); }
}
async function del(env: Env, key: string): Promise<void> {
  try { await env.MSG_DEDUP.delete(key); } catch { /* expires on its own */ }
}
async function indexAdd(env: Env, id: string, at: number): Promise<void> {
  const idx = (await get<Record<string, number>>(env, INDEX_KEY)) ?? {};
  if (idx[id] === at) return;
  idx[id] = at;
  await put(env, INDEX_KEY, idx, 26 * 3600);
}

async function deliver(env: Env, text: string, critical: boolean): Promise<Response | null> {
  const owner = env.OWNER_WHATSAPP;
  if (!owner) return null;
  try {
    return await sendViaGateway(env, {
      purpose: critical ? OWNER_CRITICAL_PURPOSE : OWNER_ALERT_PURPOSE,
      to: owner,
      content: { kind: "session", body: { type: "text", text: { body: String(text ?? "") } } },
    });
  } catch (e) {
    console.warn("[owner-alert] gateway send failed", (e as Error)?.message);
    return null;
  }
}

const span = (r: KindRecord): string => `بين ${riyadhHHMM(new Date(r.first))} و${riyadhHHMM(new Date(r.lastAt))}`;
/** The ONE message a window ends with. */
export function mergedText(r: KindRecord): string {
  if (r.title) {
    return r.count > 1
      ? `${r.title} ${r.count} مرة ${span(r)} — آخر خطأ: ${r.lastText}`
      : `${r.title} (${riyadhHHMM(new Date(r.first))}) — ${r.lastText}`;
  }
  const more = r.dropped > 0 ? `\n… و${r.dropped} غيرها` : "";
  return `🔁 ${r.repeats} ${r.repeats === 1 ? "تنبيه آخر" : "تنبيهات أخرى"} من النوع نفسه ${span(r)}:\n${r.texts.map((t) => `• ${t}`).join("\n")}${more}`;
}
/** One more alert folded into the window. */
function fold(r: KindRecord, text: string, now: number): void {
  r.count++; r.repeats++; r.lastAt = now; r.lastText = String(text);
  if (r.title) return;
  if (r.texts.join("\n").length + String(text).length <= MERGED_TEXT_LIMIT) r.texts.push(String(text));
  else r.dropped++;
}

/** Is there room in this hour for one more alert that is not important? Takes the place when there is. */
async function takeHourSlot(env: Env, now: number): Promise<boolean> {
  const key = capKey(hourOf(now));
  let n = 0;
  try { n = Number.parseInt((await env.MSG_DEDUP.get(key)) ?? "0", 10) || 0; } catch { n = 0; }
  if (n >= HOURLY_CAP) return false;
  try { await env.MSG_DEDUP.put(key, String(n + 1), { expirationTtl: 2 * 3600 }); } catch { /* the cap is best-effort */ }
  return true;
}
async function overflow(env: Env, text: string, now: number): Promise<void> {
  const hour = hourOf(now);
  const o = (await get<Overflow>(env, overKey(hour))) ?? { n: 0, items: [] };
  o.n++;
  if (o.items.length < 12) o.items.push(String(text).replace(/\s+/g, " ").slice(0, 160));
  await put(env, overKey(hour), o);
  await indexAdd(env, `${OVER_PREFIX}${hour}`, hour);
}

/** A window that ended: its one message (when something repeated in it, or nothing went at its start). */
async function closeKind(env: Env, h: string, r: KindRecord, now: number): Promise<boolean> {
  await del(env, kindKey(h));
  if (r.repeats <= 0) return false;
  const text = mergedText(r);
  if (!r.critical && !(await takeHourSlot(env, now))) { await overflow(env, text, now); return false; }
  await deliver(env, text, r.critical);
  return true;
}

/**
 * One alert to Baraa. Returns what became of it; `response` is the gateway's when it was sent now.
 * Never throws.
 */
export async function ownerAlert(env: Env, text: string, opts: OwnerAlertOpts = {}): Promise<{ outcome: OwnerAlertOutcome; response?: Response | null }> {
  const now = opts.now ?? Date.now();
  const critical = opts.critical === true;
  try {
    const kind = opts.kind ?? alertKind(text);
    const h = fnv1a(kind);
    const rec = await get<KindRecord>(env, kindKey(h));
    if (rec && Math.abs(now - rec.first) < MERGE_WINDOW_MS) {
      fold(rec, text, now);
      rec.critical = rec.critical || critical;
      await put(env, kindKey(h), rec);
      return { outcome: "merged" };
    }
    if (rec) await closeKind(env, h, rec, now); // its window ended and the tick has not come yet
    const fresh: KindRecord = { kind, first: now, count: 1, repeats: 0, lastAt: now, lastText: String(text), texts: [], dropped: 0, critical, title: opts.buffer?.title };
    if (opts.buffer) {
      fresh.repeats = 1;
      await put(env, kindKey(h), fresh);
      await indexAdd(env, h, now);
      return { outcome: "buffered" };
    }
    if (!critical && !(await takeHourSlot(env, now))) {
      await overflow(env, text, now);
      return { outcome: "capped" };
    }
    await put(env, kindKey(h), fresh);
    await indexAdd(env, h, now);
  } catch (e) {
    // the bookkeeping failed: the alert itself still goes
    console.warn("[owner-alerts] merge state failed — sent as it is", (e as Error)?.message);
  }
  const response = await deliver(env, text, critical);
  // nothing went and nothing waits for his window: the kind's window is not open — the next alert of the kind
  // is a first one again, not a line folded behind a message that never left
  if (!taken(response)) {
    try { await del(env, kindKey(fnv1a(opts.kind ?? alertKind(text)))); } catch { /* it ends in ten minutes */ }
    return { outcome: "failed", response };
  }
  return { outcome: "sent", response };
}

/** Did the gateway take it — sent now, or held for his window (or for its retry)? */
function taken(response: Response | null): boolean {
  const a = gatewayDecision(response)?.action;
  return a === "session" || a === "template" || a === "held";
}

/**
 * The ticks: every window that ended sends its one message, and an hour that ended sends the summary of what
 * went over its cap. Never throws.
 */
export async function flushOwnerAlerts(env: Env, now: number = Date.now()): Promise<{ merged: number; summaries: number }> {
  const out = { merged: 0, summaries: 0 };
  try {
    const idx = (await get<Record<string, number>>(env, INDEX_KEY)) ?? {};
    const keep: Record<string, number> = {};
    for (const [id, at] of Object.entries(idx)) {
      if (id.startsWith(OVER_PREFIX)) {
        const hour = Number(id.slice(OVER_PREFIX.length));
        if (now < hour + HOUR_MS) { keep[id] = at; continue; }
        const o = await get<Overflow>(env, overKey(hour));
        await del(env, overKey(hour));
        if (o && o.n > 0) {
          const more = o.n > o.items.length ? `\n… و${o.n - o.items.length} غيرها` : "";
          await deliver(env, `📋 ${o.n} تنبيهات أخرى بين ${riyadhHHMM(new Date(hour))} و${riyadhHHMM(new Date(hour + HOUR_MS))} لم تُرسل منفردة (الحد ${HOURLY_CAP} في الساعة):\n${o.items.map((t) => `• ${t}`).join("\n")}${more}`, false);
          out.summaries++;
        }
        continue;
      }
      const rec = await get<KindRecord>(env, kindKey(id));
      if (!rec) continue;
      if (Math.abs(now - rec.first) < MERGE_WINDOW_MS) { keep[id] = at; continue; }
      if (await closeKind(env, id, rec, now)) out.merged++;
    }
    // an hour's overflow written by closeKind above joins the index it was added to
    const after = (await get<Record<string, number>>(env, INDEX_KEY)) ?? {};
    for (const [id, at] of Object.entries(after)) if (!(id in idx)) keep[id] = at;
    if (Object.keys(keep).length) await put(env, INDEX_KEY, keep, 26 * 3600);
    else if (Object.keys(idx).length) await del(env, INDEX_KEY);
  } catch (e) {
    console.warn("[owner-alerts] flush failed", (e as Error)?.message);
  }
  return out;
}
