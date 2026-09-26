// Idempotency for automated WhatsApp sends — added 2026-09-23.
//
// Background (docs/STATUS.md § duplicates): from 2026-09-20 23:00 UTC every
// cron job ran twice — once on utak-worker-sim and once on the prod worker
// whose schedules had been re-registered by a deploy. Recipients got every
// automated message twice. The root cause was fixed by clearing the prod
// schedules; this module is the second line of defence so a repeated run
// of the same job (double trigger, manual /sim/trigger after the cron,
// Cloudflare's at-least-once scheduling) cannot send twice.
//
// Contract:
//   • Only sends made with env.AUTO_SEND_JOB set are guarded. scheduled()
//     and runSimJob() set it via withAutoSendJob(); request paths never do,
//     so bot replies and the Odoo manual send are untouched.
//   • Key = recipient digits + template name (or message type for
//     non-template sends) + Riyadh calendar day + job name. The job part
//     keeps distinct jobs apart: the owner receives utak_owner_alert from
//     the 06:00, 21:00 and 21:15 jobs on the same day, and each is legit.
//   • The key is written BEFORE the send, TTL 26h. A second attempt finds
//     it and is refused with a synthetic 409 (type SkippedDuplicate), which
//     every caller already treats as "not sent".
//   • KV is eventually consistent across regions; two runs in different
//     colos within seconds could both pass. That is why the root fix
//     (one scheduler) matters more than this guard.

import type { Env } from "./config";
import { riyadhDateKey } from "./hours";

export const AUTO_SEND_TTL_SECONDS = 26 * 60 * 60;
export const MANUAL_REPEAT_TTL_SECONDS = 60; // KV minimum TTL
export const SKIPPED_DUPLICATE_TYPE = "SkippedDuplicate";

/** Cron expression → job name (same names as /sim/trigger?job=). */
export const CRON_JOB: Readonly<Record<string, string>> = {
  "0 23 * * *": "ask_suppliers",
  "0 2 * * *": "reliability_scores",
  "0 3 * * *": "open_ordering",
  "0 18 * * *": "close_unconfirmed",
  "15 18 * * *": "aggregate_purchase",
  "0 15 * * *": "collection_summary",
  "0 14 * * *": "standing_reminders",
  "0 5 * * *": "daily_outreach",
  // 2026-09-24 (ح3) — 20:00 Riyadh reminder for unconfirmed orders. sim only.
  "0 17 * * *": "cutoff_reminder",
  // 2026-09-25 (STATUS § 29) — team attendance, every 5 minutes. Its sends
  // carry their own job names (shift_start / shift_remind / shift_absent /
  // owner_window), so the start and the reminder of the same template on the
  // same day are two different keys.
  "*/5 * * * *": "team_attendance",
  // 2026-09-26 (STATUS § 38, م12) — the driver's end-of-shift follow-up, every
  // 5 minutes two minutes after the attendance tick (src/driver-followup.ts). sim only.
  "2,7,12,17,22,27,32,37,42,47,52,57 * * * *": "driver_followup",
};

/** Shallow copy of env that marks every send inside the job as automated. */
export function withAutoSendJob(env: Env, job: string): Env {
  return { ...env, AUTO_SEND_JOB: job };
}

function digitsOf(to: string): string {
  return String(to ?? "").replace(/[^0-9]/g, "");
}

/** Template name for template sends, otherwise the Meta message type. */
export function sendKind(body: Record<string, unknown>): string {
  const b = body as { type?: string; template?: { name?: string } };
  if (b.type === "template") return `tpl:${b.template?.name ?? "?"}`;
  return `type:${b.type ?? "?"}`;
}

export function autoSendKey(
  to: string,
  body: Record<string, unknown>,
  job: string,
  now: Date = new Date(),
  discriminator?: string,
): string {
  const base = `autosend:v1:${riyadhDateKey(now)}:${digitsOf(to)}:${sendKind(body)}:${job}`;
  return discriminator ? `${base}:${discriminator}` : base;
}

export type ClaimResult = { claimed: true; key: string } | { claimed: false; key: string; firstAt: string };

/**
 * Claim the idempotency key for an automated send. Written before the
 * send; returns claimed=false when an earlier attempt already holds it.
 */
export async function claimAutoSend(
  env: Env,
  to: string,
  body: Record<string, unknown>,
  job: string,
  now: Date = new Date(),
): Promise<ClaimResult> {
  // 2026-09-24 — owner alerts are instant and unbatched: two DIFFERENT alerts
  // in the same job on the same day must both go out, so the owner's key
  // carries a content hash. A re-run of the job produces the same content
  // and is still refused.
  const owner = digitsOf(String(env.OWNER_WHATSAPP ?? ""));
  const disc = owner && digitsOf(to) === owner ? fnv1a(JSON.stringify(body)) : undefined;
  const key = autoSendKey(to, body, job, now, disc);
  const prev = await env.MSG_DEDUP.get(key);
  if (prev !== null) return { claimed: false, key, firstAt: prev };
  await env.MSG_DEDUP.put(key, now.toISOString(), { expirationTtl: AUTO_SEND_TTL_SECONDS });
  return { claimed: true, key };
}

export function skippedDuplicateResponse(key: string, firstAt: string): Response {
  return new Response(
    JSON.stringify({ error: { message: `skipped duplicate: ${key} (first at ${firstAt})`, type: SKIPPED_DUPLICATE_TYPE } }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

export async function isSkippedDuplicate(resp: Response | null | undefined): Promise<boolean> {
  if (!resp || resp.status !== 409) return false;
  try {
    const j = (await resp.clone().json()) as { error?: { type?: string } };
    return j?.error?.type === SKIPPED_DUPLICATE_TYPE;
  } catch {
    return false;
  }
}

/** Short stable hash (FNV-1a, hex) — enough to fingerprint a manual send. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Manual sends from Odoo are never blocked. This only reports whether an
 * identical manual send to the same recipient happened in the last minute
 * so the caller can log a warning. Records the current send as well.
 */
export async function noteManualSend(
  env: Env,
  to: string,
  body: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ repeated: boolean; key: string }> {
  const key = `manualsend:v1:${digitsOf(to)}:${fnv1a(JSON.stringify(body))}`;
  try {
    const prev = await env.MSG_DEDUP.get(key);
    await env.MSG_DEDUP.put(key, now.toISOString(), { expirationTtl: MANUAL_REPEAT_TTL_SECONDS });
    return { repeated: prev !== null, key };
  } catch {
    return { repeated: false, key };
  }
}
