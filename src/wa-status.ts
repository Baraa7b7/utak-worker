// Meta's delivery statuses never go down — 2026-09-25 (STATUS § 37 أ).
//
// Meta reports a message's fate in separate webhook calls (sent, delivered,
// read, or failed), and they do not always arrive in order: § 36 saw
// «delivered» then «sent» in the same second, which left x_wa_message #162
// «sent». Every place that writes a Meta status follows one order:
//
//     sent (1) < failed (2) < delivered (3) < read (4)
//
//   • a status lower than, or equal to, the row's is not written;
//   • «failed» is written over «sent» only. After «delivered» or «read» it is
//     not written, and the failure is not acted on either (no Discuss line,
//     no owner alert, no window / purpose block): it goes to the technical
//     log (x_debug_payload of the row, the D1 status log, wrangler tail);
//   • «delivered» / «read» after «failed» are written — Meta did deliver it —
//     so the result is the same whatever order the calls arrive in;
//   • a row in a state of the gateway's own (held, skipped, expired, queued…)
//     is not overwritten by a Meta status.
//
// The D1 status log (sim only — the prod worker has no D1): one row per
// status call with its verdict, table wa_status_log (schema/wa_status_log.sql).
// It is also what a row created after its statuses arrived reads (the send's
// row is written right after Meta's answer; a fast «delivered» can come first).

import type { Env } from "./config";

export type MetaStatus = "sent" | "delivered" | "read" | "failed";

export const META_STATUS_RANK: Readonly<Record<MetaStatus, number>> = { sent: 1, failed: 2, delivered: 3, read: 4 };

export function isMetaStatus(s: unknown): s is MetaStatus {
  return s === "sent" || s === "delivered" || s === "read" || s === "failed";
}

export type VerdictWhy =
  | "new"                    // the row had no status yet
  | "higher"                 // written
  | "same"                   // already that status
  | "lower"                  // a lower status after a higher one: not written
  | "failed_after_delivery"  // «failed» after delivered / read: not written, logged
  | "not_meta_state"         // the row is held / skipped / expired / queued …: not overwritten
  | "no_row";                // no x_wa_message row carries this wamid

export interface StatusVerdict {
  apply: boolean;
  why: VerdictWhy;
}

/** May `incoming` be written over the row's `current` x_status? */
export function statusVerdict(current: string | false | null | undefined, incoming: MetaStatus): StatusVerdict {
  const cur = String(current || "");
  if (!cur) return { apply: true, why: "new" };
  if (!isMetaStatus(cur)) return { apply: false, why: "not_meta_state" };
  if (cur === incoming) return { apply: false, why: "same" };
  if (META_STATUS_RANK[incoming] > META_STATUS_RANK[cur]) return { apply: true, why: "higher" };
  if (incoming === "failed") return { apply: false, why: "failed_after_delivery" };
  return { apply: false, why: "lower" };
}

/** The highest of a list of statuses (null when none is a Meta status). */
export function highestStatus(list: readonly unknown[]): MetaStatus | null {
  let best: MetaStatus | null = null;
  for (const s of list) {
    if (isMetaStatus(s) && (!best || META_STATUS_RANK[s] > META_STATUS_RANK[best])) best = s;
  }
  return best;
}

/**
 * The technical note on a row for a status that was not written because it
 * came after a higher one (x_debug_payload: JSON kept, last five notes).
 */
export function withIgnoredNote(debugPayload: string | false | null | undefined, note: Record<string, unknown>): string {
  const raw = String(debugPayload || "");
  let obj: Record<string, unknown>;
  try {
    const p = raw ? JSON.parse(raw) : {};
    obj = p && typeof p === "object" && !Array.isArray(p) ? p : { payload: p };
  } catch {
    obj = { payload: raw };
  }
  const prev = Array.isArray(obj.ignored_statuses) ? (obj.ignored_statuses as unknown[]) : [];
  obj.ignored_statuses = [...prev, note].slice(-5);
  return JSON.stringify(obj).slice(0, 4000);
}

// ------------------------------------------------------------------ the D1 status log

export interface StatusEvent {
  wamid: string;
  status: MetaStatus;
  recipient?: string;
  /** Meta's own timestamp (unix seconds), when the call carries one. */
  metaTs?: number | null;
  code?: number | null;
  rowId?: number | null;
  applied: boolean;
  verdict: VerdictWhy;
}

let tableMissingWarned = false;

/** One line in D1 wa_status_log. Best-effort: never throws, and no D1 (prod) → nothing. */
export async function logMetaStatus(env: Env, ev: StatusEvent): Promise<void> {
  if (!env.SIM_DB) return;
  try {
    await env.SIM_DB.prepare(
      `INSERT INTO wa_status_log (wamid, status, meta_ts, received_ms, recipient, error_code, row_id, applied, verdict)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ev.wamid, ev.status, ev.metaTs ?? null, Date.now(), ev.recipient ? String(ev.recipient) : null,
      typeof ev.code === "number" ? ev.code : null, ev.rowId ?? null, ev.applied ? 1 : 0, ev.verdict,
    ).run();
  } catch (e) {
    if (!tableMissingWarned) {
      tableMissingWarned = true;
      console.warn("[status] D1 wa_status_log not written (run schema/wa_status_log.sql)", (e as Error)?.message);
    }
  }
}

/** The highest status D1 logged for this wamid, or null (no D1, no line, or D1 unreadable). */
export async function highestLoggedStatus(env: Env, wamid: string): Promise<MetaStatus | null> {
  if (!env.SIM_DB || !wamid) return null;
  try {
    const { results } = await env.SIM_DB.prepare(`SELECT status FROM wa_status_log WHERE wamid = ?`).bind(wamid).all<{ status: string }>();
    return highestStatus((results ?? []).map((r) => r.status));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ one status call

/**
 * A sent / delivered / read status from Meta's webhook («failed» goes through
 * handleStatusFailure in src/wa-gateway.ts, which applies the same order).
 * Writes the row only when the status is higher; logs every call in D1; a row
 * that was «failed» and is now delivered gets its Discuss status line back.
 */
export async function applyMetaStatus(
  env: Env,
  ev: { wamid: string; status: Exclude<MetaStatus, "failed">; recipient?: string; metaTs?: number | null; errText?: string },
  ctx?: ExecutionContext,
): Promise<{ rowId: number | null; applied: boolean; verdict: VerdictWhy; previous: string }> {
  const { updateWaStatusByWamid } = await import("./wa-message-send");
  const row = await updateWaStatusByWamid(env, ev.wamid, ev.status, ev.errText);
  const verdict: VerdictWhy = row ? row.verdict : "no_row";
  const applied = row?.applied ?? false;
  await logMetaStatus(env, {
    wamid: ev.wamid, status: ev.status, recipient: ev.recipient, metaTs: ev.metaTs ?? null,
    rowId: row?.id ?? null, applied, verdict,
  });
  if (row && !applied && verdict !== "same") {
    console.log(`[status] wamid=${ev.wamid.slice(-10)} ${ev.status} not written over ${row.previous} (${verdict})`);
  }
  if (row && applied && row.previous === "failed") {
    const { recordStateChange } = await import("./wa-record");
    await recordStateChange(env, row.id, String(ev.recipient ?? ""), ctx);
  }
  return { rowId: row?.id ?? null, applied, verdict, previous: row?.previous ?? "" };
}
