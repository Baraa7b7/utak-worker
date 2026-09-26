// Team member's deferred-message queue — KV `pending_loc:<number>`.
//
// 2026-09-17: sendDriverRoute stashed each stop's location here behind the
// «بدء الدوام» template, and the driver's first inbound flushed it (the
// function lived in index.ts as flushPendingLocations). 2026-09-24 (م11):
// delivery-note texts joined the queue. 2026-09-25 (STATUS § 29): the same
// queue holds every task that reaches a team member before today's «بدء
// الدوام» tap (attendance), including items that need buttons, and writes
// APPEND instead of overwriting, so a purchase list, a route and a collection
// request queued the same day all survive until the tap.

import type { Env } from "./config";
import { sendButtons, sendLocation, sendText } from "./meta";

// `purpose` (STATUS § 33): the gateway purpose the item is sent with after
// the tap; team_task when absent (items queued before § 33).
// STATUS § 38 (م8): `route_start` is not a message to the member — at the
// flush, the route it closes has reached the driver, so its first stop's
// customer gets «في الطريق» (src/out-for-delivery.ts).
export type TeamQueueItem =
  | { latitude: number; longitude: number; name?: string; address?: string; purpose?: string }
  | { text: string; buttons?: Array<{ id: string; title: string }>; purpose?: string }
  | { route_start: number; driver?: string };

/** Long enough for a task queued at 21:15 to wait for the next day's tap. */
export const TEAM_QUEUE_TTL = 36 * 60 * 60;

export function teamQueueKey(to: string): string {
  return `pending_loc:${to}`;
}

/** Append items to the member's queue (read-modify-write; KV is per-key last-write-wins). */
export async function enqueueTeamItems(env: Env, to: string, items: TeamQueueItem[], ttl = TEAM_QUEUE_TTL): Promise<void> {
  if (items.length === 0) return;
  const key = teamQueueKey(to);
  let cur: TeamQueueItem[] = [];
  try {
    const raw = await env.MSG_DEDUP.get(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) cur = parsed;
  } catch (e) {
    console.warn("[team-queue] existing queue unreadable — starting a new one", (e as Error)?.message);
  }
  await env.MSG_DEDUP.put(key, JSON.stringify([...cur, ...items]), { expirationTtl: ttl });
}

/**
 * Send and clear the queue. A corrupt payload is dropped after logging so a
 * bad row cannot brick the member's flow. Returns how many items went out.
 */
export async function flushTeamQueue(env: Env, to: string): Promise<number> {
  const key = teamQueueKey(to);
  const raw = await env.MSG_DEDUP.get(key);
  if (!raw) return 0;
  let items: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) items = parsed;
  } catch (e) {
    console.warn("[pending_loc] parse failed", (e as Error)?.message);
    await env.MSG_DEDUP.delete(key);
    return 0;
  }
  // Cleared before sending: a retry of the same inbound must not send twice.
  await env.MSG_DEDUP.delete(key);
  let sent = 0;
  for (const l of items) {
    if (typeof l?.route_start === "number") {
      try {
        const { notifyRouteStart } = await import("./out-for-delivery");
        await notifyRouteStart(env, l.route_start, typeof l.driver === "string" ? l.driver : undefined);
      } catch (e) {
        console.warn(`[pending_loc] «في الطريق» for route ${l.route_start} failed`, (e as Error)?.message);
      }
      continue;
    }
    const purpose = typeof l?.purpose === "string" && l.purpose ? l.purpose : "team_task";
    if (typeof l?.text === "string" && l.text) {
      const buttons = Array.isArray(l.buttons) ? (l.buttons as Array<{ id: string; title: string }>) : [];
      try {
        const r = buttons.length
          ? await sendButtons(env, to, l.text.slice(0, 1024), buttons, { purpose })
          : await sendText(env, to, l.text, { purpose });
        if (r.ok) sent++;
      } catch (e) {
        console.warn("[pending_loc] send failed", (e as Error)?.message);
      }
      continue;
    }
    if (typeof l?.latitude !== "number" || typeof l?.longitude !== "number") continue;
    try {
      const r = await sendLocation(env, to, l.latitude, l.longitude, l.name as string | undefined, l.address as string | undefined, { purpose });
      if (r.ok) sent++;
    } catch (e) {
      console.warn("[pending_loc] sendLocation failed", (e as Error)?.message);
    }
  }
  return sent;
}
