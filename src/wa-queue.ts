// Held WhatsApp messages, per number — 2026-09-25 (STATUS § 33, the single gateway).
//
// A session message (text, buttons, location, document) addressed to a number
// whose 24h window is closed, with no usable UTILITY template for its purpose,
// is not sent: the gateway holds it here. The number's next inbound message or
// tap opens the window, and handleWebhook flushes the queue right away, oldest
// first (flushHeld in src/wa-gateway.ts).
//
//   • KV `wa_q:v1:<digits>` = QueueItem[] in creation order. The same message
//     (purpose + body) is held once: its id is a hash of both.
//   • Every item carries its purpose's expiry (src/wa-purposes.ts). An expired
//     item is dropped, never sent, and its x_wa_message row says so — at the
//     flush, or by sweepExpired (the */5 cron) when the number stays silent.
//   • `wa_q:v1:index` lists the numbers that have a queue, for the sweep
//     (KV list is not needed, and the test KV has none).
// KV is last-write-wins per key: two writers racing on one number can lose an
// item. The flush also stamps `wa_q_sent:v1:<digits>:<id>` before each send,
// so two flushes racing on the same queue never send one item twice.

import type { Env } from "./config";
import { fnv1a } from "./auto-send-guard";
import { waDigits } from "./wa-window";

export interface QueueItem {
  /** fnv1a(purpose + body) — the same message is held once per number. */
  id: string;
  purpose: string;
  /** Owner-guard purpose when it differs (owner_window). */
  guardPurpose?: string;
  /** The Meta session body without messaging_product / to. */
  body: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  important: boolean;
  /** The x_wa_message row (x_status = held) this item settles. */
  rowId?: number;
  /** Times Meta refused it with 131047 after a flush. */
  attempts: number;
  /** x_wa_message x_manual: the SIM_ALLOWLIST bypass of the Odoo send route. */
  manual?: boolean;
}

export const QUEUE_INDEX_KEY = "wa_q:v1:index";
/** A held item survives in KV this long past its expiry, so the sweep can log it. */
const KEEP_AFTER_EXPIRY_MS = 2 * 24 * 3600_000;
export const SENT_MARK_TTL = 26 * 3600;

export function queueKey(to: string): string {
  return `wa_q:v1:${waDigits(to)}`;
}
export function sentMarkKey(to: string, id: string): string {
  return `wa_q_sent:v1:${waDigits(to)}:${id}`;
}

export function queueItemId(purpose: string, body: Record<string, unknown>): string {
  return fnv1a(`${purpose}\u0000${JSON.stringify(body)}`);
}

export async function readQueue(env: Env, to: string): Promise<QueueItem[]> {
  try {
    const raw = await env.MSG_DEDUP.get(queueKey(to));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  } catch (e) {
    console.warn("[wa-queue] unreadable queue — treated as empty", (e as Error)?.message);
    return [];
  }
}

async function readIndex(env: Env): Promise<string[]> {
  try {
    const raw = await env.MSG_DEDUP.get(QUEUE_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function setIndexed(env: Env, digits: string, present: boolean): Promise<void> {
  const cur = await readIndex(env);
  const has = cur.includes(digits);
  if (has === present) return;
  const next = present ? [...cur, digits] : cur.filter((d) => d !== digits);
  try {
    await env.MSG_DEDUP.put(QUEUE_INDEX_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn("[wa-queue] index write failed", (e as Error)?.message);
  }
}

export async function writeQueue(env: Env, to: string, items: QueueItem[], now: number = Date.now()): Promise<void> {
  const digits = waDigits(to);
  if (items.length === 0) {
    try { await env.MSG_DEDUP.delete(queueKey(digits)); } catch { /* expires on its own */ }
    await setIndexed(env, digits, false);
    return;
  }
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  const until = Math.max(...sorted.map((i) => i.expiresAt)) + KEEP_AFTER_EXPIRY_MS;
  await env.MSG_DEDUP.put(queueKey(digits), JSON.stringify(sorted), {
    expirationTtl: Math.max(60, Math.ceil((until - now) / 1000)),
  });
  await setIndexed(env, digits, true);
}

/** Hold `item` for `to`. The same message already held → "duplicate", nothing written. */
export async function enqueueHeld(env: Env, to: string, item: QueueItem, now: number = Date.now()): Promise<"queued" | "duplicate"> {
  const cur = await readQueue(env, to);
  if (cur.some((i) => i.id === item.id)) return "duplicate";
  await writeQueue(env, to, [...cur, item], now);
  return "queued";
}

/** Every held item for `to`, oldest first, and the queue cleared (the flush owns them now). */
export async function takeQueue(env: Env, to: string): Promise<QueueItem[]> {
  const items = await readQueue(env, to);
  if (items.length === 0) return [];
  await writeQueue(env, to, []);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

/** Put items back (a flush that stopped half-way), keeping anything held meanwhile. */
export async function putBack(env: Env, to: string, items: QueueItem[], now: number = Date.now()): Promise<void> {
  if (items.length === 0) return;
  const cur = await readQueue(env, to);
  const ids = new Set(cur.map((i) => i.id));
  await writeQueue(env, to, [...cur, ...items.filter((i) => !ids.has(i.id))], now);
}

/** Numbers that currently have a queue (for the sweep). */
export async function queuedNumbers(env: Env): Promise<string[]> {
  return readIndex(env);
}
