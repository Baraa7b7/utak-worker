// Button idempotency — 2026-09-24 (WA-SCENARIOS ح8).
//
// Every tap is a new wamid, so seenBefore never stops a second tap. Buttons
// that move money or state (collection, delivered, purchase done, standing
// confirm, late order) claim a KV key before acting. The second tap finds the
// key and gets "تم هذا الإجراء مسبقاً" instead of a second payment, invoice or
// order.
//
// KV is not atomic. The claim writes a random token and reads it back: when
// two taps race in the same colo, the later write wins and only its request
// proceeds. Two colos within the propagation delay can still both pass, so
// the money path keeps a second net (recordCollection re-counts payments
// after creating one and alerts the owner on an overpayment).

import type { Env } from "./config";

export const ALREADY_DONE_TEXT = "تم هذا الإجراء مسبقاً ✅";

/** Default hold: record-scoped buttons are never legitimately tapped twice. */
export const BUTTON_LOCK_TTL = 7 * 24 * 60 * 60;

export type ButtonClaim =
  | { claimed: true; key: string; token: string }
  | { claimed: false; key: string; state: string };

export async function claimButton(
  env: Env,
  lockId: string,
  ttlSeconds: number = BUTTON_LOCK_TTL,
): Promise<ButtonClaim> {
  const key = `btnlock:v1:${lockId}`;
  try {
    const prev = await env.MSG_DEDUP.get(key);
    if (prev !== null) return { claimed: false, key, state: prev };
    const token = `run:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    await env.MSG_DEDUP.put(key, token, { expirationTtl: Math.max(60, ttlSeconds) });
    const back = await env.MSG_DEDUP.get(key);
    if (back !== null && back !== token) return { claimed: false, key, state: back };
    return { claimed: true, key, token };
  } catch (e) {
    // KV trouble fails open: the per-record state checks still apply.
    console.warn("[btn-lock] KV failed — proceeding", (e as Error)?.message);
    return { claimed: true, key, token: "kv-error" };
  }
}

/** Mark the claimed action finished (keeps the key so later taps are refused). */
export async function finishButton(env: Env, c: ButtonClaim, ttlSeconds: number = BUTTON_LOCK_TTL): Promise<void> {
  if (!c.claimed) return;
  try {
    await env.MSG_DEDUP.put(c.key, `done:${new Date().toISOString()}`, { expirationTtl: Math.max(60, ttlSeconds) });
  } catch { /* the running token still blocks repeats */ }
}

/** The action threw before doing anything irreversible — let a retry through. */
export async function releaseButton(env: Env, c: ButtonClaim): Promise<void> {
  if (!c.claimed) return;
  try { await env.MSG_DEDUP.delete(c.key); } catch { /* expires on its own */ }
}

/**
 * Claim, run, finish. A second tap (or a tap racing the first) returns
 * ALREADY_DONE_TEXT without running `fn`. If `fn` throws, the claim is
 * released and the error propagates.
 */
export async function withButtonLock(
  env: Env,
  lockId: string,
  fn: () => Promise<string>,
  ttlSeconds: number = BUTTON_LOCK_TTL,
): Promise<string> {
  const c = await claimButton(env, lockId, ttlSeconds);
  if (!c.claimed) {
    console.warn(`[btn-lock] repeat tap refused key=${c.key} state=${c.state.slice(0, 40)}`);
    return ALREADY_DONE_TEXT;
  }
  try {
    const out = await fn();
    await finishButton(env, c, ttlSeconds);
    return out;
  } catch (e) {
    await releaseButton(env, c);
    throw e;
  }
}
