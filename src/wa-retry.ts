// § 67 د (2026-10-08) — the messages Meta refused for a reason that passes by itself (131056, the pair's rate
// limit, and its like — src/meta-errors.ts): the SAME message is tried again, spaced 1 → 5 → 15 minutes, and
// the purpose is not blocked. An important alert to Baraa waits here after any refusal, every 15 minutes
// until it expires: it is never dropped.
//
// One KV key holds them all (they are rare). The two ticks send what is due (src/wa-gateway.ts runRetryQueue).

import type { Env } from "./config";
import { fnv1a } from "./auto-send-guard";

export interface RetryItem {
  /** fnv1a(number + purpose + body): the same message waits once. */
  id: string;
  to: string;
  purpose: string;
  guardPurpose?: string;
  /** The Meta body without messaging_product / to — a session message, or a template as it was sent. */
  body: Record<string, unknown>;
  /** The template's name when the body is one. */
  template?: string;
  createdAt: number;
  expiresAt: number;
  important: boolean;
  rowId?: number;
  manual?: boolean;
  /** Retries made so far (the send that was refused first is not one). */
  retries: number;
  nextAt: number;
  code: number | string | null;
}

export const RETRY_KEY = "wa_retry:v1";

export function retryItemId(to: string, purpose: string, body: Record<string, unknown>): string {
  return fnv1a(`${to}\u0000${purpose}\u0000${JSON.stringify(body)}`);
}

export async function readRetries(env: Env): Promise<RetryItem[]> {
  try {
    const raw = await env.MSG_DEDUP.get(RETRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RetryItem[]) : [];
  } catch (e) {
    console.warn("[wa-retry] unreadable queue — treated as empty", (e as Error)?.message);
    return [];
  }
}

export async function writeRetries(env: Env, items: RetryItem[]): Promise<void> {
  if (items.length === 0) {
    try { await env.MSG_DEDUP.delete(RETRY_KEY); } catch { /* expires on its own */ }
    return;
  }
  await env.MSG_DEDUP.put(RETRY_KEY, JSON.stringify(items), { expirationTtl: 3 * 24 * 3600 });
}

/** Queue `item` (the same message already waiting keeps its place, with the later time and count). */
export async function scheduleRetry(env: Env, item: RetryItem): Promise<void> {
  const cur = await readRetries(env);
  await writeRetries(env, [...cur.filter((i) => i.id !== item.id), item]);
}

/** Every item that is due, taken out of the queue (the caller sends them; a refused one is queued again). */
export async function takeDueRetries(env: Env, now: number): Promise<RetryItem[]> {
  const cur = await readRetries(env);
  const due = cur.filter((i) => i.nextAt <= now);
  if (due.length) await writeRetries(env, cur.filter((i) => i.nextAt > now));
  return due.sort((a, b) => a.nextAt - b.nextAt);
}
