// Meta's 24h customer-service window, per WhatsApp number — 2026-09-25
// (STATUS § 33, the single gateway).
//
// The window opens with the number's last inbound message or button tap, by
// Meta's own timestamp (the webhook's `timestamp`, never the time it reached
// us): Meta re-delivered messages 71 and 75 hours late on 09-20/21 (§ 29), and
// an arrival time would have opened a window Meta had long closed. So:
//   • a message older than 24h by Meta's clock does not open it;
//   • it counts as closed WINDOW_MARGIN_MS (10 minutes) before its real end —
//     a send never races the closing minute;
//   • a 131047 from Meta closes it at once (markWindowClosed), until an inbound
//     newer than that refusal.
//
// Source: KV `wa_win:v1:<digits>` = { in: Meta ms of the last inbound,
// closed?: ms of the last 131047 }, written by handleWebhook for every
// inbound. When the key is missing (never written, or expired) the window is
// read from Odoo, Meta timestamps only: the legacy per-partner KV
// `wa_inbox:last_in_ts:<partner>` (ingestInbound, Meta's timestamp) and the
// inbound x_wa_message rows' x_processed_at (logWaMessage stores Meta's
// timestamp there for inbound). Arrival times (create_date, mail.message
// dates) are never read.

import type { Env } from "./config";

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const WINDOW_MARGIN_MS = 10 * 60 * 1000;

export interface WindowRecord {
  /** Meta's timestamp (ms) of the number's newest inbound. 0 = none known. */
  in: number;
  /** When Meta last refused a session message with 131047 (ms). */
  closed?: number;
}

export interface WindowState {
  open: boolean;
  lastInboundMs: number;
  /** The moment we stop treating it as open (real end − margin); 0 when none. */
  closesAtMs: number;
  closedByMeta: boolean;
  source: "kv" | "odoo" | "none";
}

export function waDigits(to: string): string {
  return String(to ?? "").replace(/[^0-9]/g, "");
}

export function kvWindowKey(to: string): string {
  return `wa_win:v1:${waDigits(to)}`;
}

export function evaluateWindow(rec: WindowRecord | null, now: number = Date.now(), source: WindowState["source"] = "kv"): WindowState {
  const lastIn = rec && Number.isFinite(rec.in) && rec.in > 0 ? rec.in : 0;
  const closedByMeta = !!rec?.closed && rec.closed >= lastIn;
  const closesAtMs = lastIn ? lastIn + WINDOW_MS - WINDOW_MARGIN_MS : 0;
  return {
    open: lastIn > 0 && !closedByMeta && now < closesAtMs,
    lastInboundMs: lastIn,
    closesAtMs,
    closedByMeta,
    source: lastIn || rec?.closed ? source : "none",
  };
}

async function readRecord(env: Env, to: string): Promise<WindowRecord | null> {
  try {
    const raw = await env.MSG_DEDUP.get(kvWindowKey(to));
    if (!raw) return null;
    const j = JSON.parse(raw) as WindowRecord;
    return { in: Number(j?.in) || 0, closed: Number(j?.closed) || undefined };
  } catch (e) {
    console.warn("[wa-window] KV read failed", (e as Error)?.message);
    return null;
  }
}

async function writeRecord(env: Env, to: string, rec: WindowRecord, now: number): Promise<void> {
  // Kept an hour past the window's end, so a late 131047 still finds it.
  const until = Math.max(rec.in || 0, rec.closed || 0) + WINDOW_MS + 3600_000;
  const ttl = Math.max(60, Math.ceil((until - now) / 1000));
  try {
    await env.MSG_DEDUP.put(kvWindowKey(to), JSON.stringify(rec), { expirationTtl: ttl });
  } catch (e) {
    console.warn("[wa-window] KV write failed", (e as Error)?.message);
  }
}

/**
 * An inbound message or tap from `from`, stamped `metaTsMs` by Meta. Opens (or
 * extends) the window unless the message is already older than 24h. Returns
 * the window after it.
 */
export async function noteInbound(env: Env, from: string, metaTsMs: number | null, now: number = Date.now()): Promise<WindowState> {
  const cur = await readRecord(env, from);
  if (!metaTsMs || !Number.isFinite(metaTsMs) || now - metaTsMs >= WINDOW_MS || metaTsMs - now > 5 * 60_000) {
    // late (or unusable) — the window stays as it was
    return evaluateWindow(cur, now);
  }
  const rec: WindowRecord = { in: Math.max(cur?.in || 0, metaTsMs) };
  if (cur?.closed && cur.closed >= metaTsMs) rec.closed = cur.closed;
  await writeRecord(env, from, rec, now);
  return evaluateWindow(rec, now);
}

/** Meta refused a session message to `to` with 131047: the window is closed now. */
export async function markWindowClosed(env: Env, to: string, atMs: number = Date.now()): Promise<void> {
  const cur = await readRecord(env, to);
  await writeRecord(env, to, { in: cur?.in || 0, closed: atMs }, atMs);
}

function odooMs(v: unknown): number {
  if (typeof v !== "string" || !v) return 0;
  const t = Date.parse(v.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
}

/** The newest inbound for `to` known to Odoo, by Meta's timestamps only. */
async function lastInboundFromOdoo(env: Env, to: string): Promise<number> {
  const digits = waDigits(to);
  if (!digits) return 0;
  const e164 = `+${digits}`;
  const { call } = await import("./odoo");
  const partners = await call<Array<{ id: number }>>(env, "res.partner", "search_read", {
    domain: ["|", "|", ["x_whatsapp_number", "=", e164], ["phone_sanitized", "=", e164], ["phone", "=", e164]],
    fields: ["id"],
    context: { active_test: false },
    limit: 20,
  });
  const ids = partners.map((p) => p.id).filter(Boolean);
  if (ids.length === 0) return 0;
  let latest = 0;
  for (const id of ids) {
    try {
      const raw = await env.MSG_DEDUP.get(`wa_inbox:last_in_ts:${id}`);
      const t = Number(raw);
      if (Number.isFinite(t) && t > latest) latest = t;
    } catch { /* no evidence */ }
  }
  const rows = await call<Array<{ x_processed_at: string | false }>>(env, "x_wa_message", "search_read", {
    domain: [["x_partner_id", "in", ids], ["x_direction", "=", "in"], ["x_processed_at", "!=", false]],
    fields: ["x_processed_at"],
    order: "x_processed_at desc",
    limit: 10,
  });
  for (const r of rows) latest = Math.max(latest, odooMs(r.x_processed_at));
  return latest;
}

/**
 * The number's window now. KV first; without a KV record, Odoo (Meta
 * timestamps only). An Odoo failure reads as «no evidence» → closed: a held
 * message waits for the next inbound, a text outside the window would be lost.
 */
export async function readWindow(env: Env, to: string, now: number = Date.now()): Promise<WindowState> {
  const rec = await readRecord(env, to);
  if (rec) return evaluateWindow(rec, now, "kv");
  try {
    const t = await lastInboundFromOdoo(env, to);
    return evaluateWindow({ in: t }, now, "odoo");
  } catch (e) {
    console.warn("[wa-window] Odoo read failed — window read as closed", (e as Error)?.message);
    return evaluateWindow(null, now);
  }
}
