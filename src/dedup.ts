// KV-backed message dedup. Meta retries delivery on 5xx or timeout,
// so the same messageId can arrive multiple times. We short-circuit repeats.

import type { Env } from "./config";
import { DEDUP_TTL_SECONDS } from "./config";

export async function seenBefore(env: Env, messageId: string): Promise<boolean> {
  const v = await env.MSG_DEDUP.get(messageId);
  return v !== null;
}

export async function markSeen(env: Env, messageId: string): Promise<void> {
  await env.MSG_DEDUP.put(messageId, String(Date.now()), {
    expirationTtl: DEDUP_TTL_SECONDS,
  });
}
