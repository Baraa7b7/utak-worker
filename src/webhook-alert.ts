// Signature-failure alerting (2026-09-21).
//
// Silent-outage insurance: the 2026-09-11 → 2026-09-21 blackout ran ten days
// undetected because every POST /webhook was returning 401 for a
// META_APP_SECRET mismatch with no log line, no exception and no operator
// signal. This module makes sure it can never happen again — the *first*
// signature rejection of any Riyadh calendar day sends a WhatsApp alert to
// Baraa, and every subsequent failure that day increments a KV counter
// exposed on /health so the situation stays visible even if the alert send
// itself fails.
//
// Design notes:
//   • The 401 response is NEVER blocked on this module. The caller schedules
//     handleSignatureFailure via ctx.waitUntil so the bad-signature response
//     returns immediately, and any thrown error stays inside this file.
//   • Alerts route through sendText with purpose="owner_alert", the one
//     purpose the owner-guard in meta.ts permits toward OWNER_WHATSAPP. If
//     the guard ever changes and blocks that purpose (a 403
//     OwnerGuardBlocked / AllowlistBlocked from fetchMeta), we retry once
//     through a direct Graph POST that skips fetchMeta entirely — the
//     bypass is scoped to this alert path only.
//   • Meta's own errors (24-hour re-engagement window closed, etc.) are
//     logged and swallowed — we already recorded the failure in KV, so the
//     operator picks it up via /health.
//   • Secrets never appear in logs. We print body length, whether the
//     header was present, and the first 8 characters of the signature the
//     caller sent — nothing more.

import type { Env } from "./config";
import { isRecipientAllowed, isTestMode, runtimeMode } from "./config";
import { riyadhDateKey } from "./hours";

const SIG_FAIL_KEY_PREFIX = "wa_sig_fail:";
const SIG_FAIL_ALERT_KEY_PREFIX = "wa_sig_fail_alert:";
const SIG_FAIL_TTL_SECONDS = 7 * 24 * 60 * 60;
const SIG_FAIL_ALERT_TTL_SECONDS = 24 * 60 * 60;

export type SignatureFailureReason =
  | "missing_header"
  | "bad_prefix"
  | "hmac_mismatch";

export function classifySignatureFailure(
  sigHeader: string | null,
): SignatureFailureReason {
  if (!sigHeader) return "missing_header";
  if (!sigHeader.startsWith("sha256=")) return "bad_prefix";
  return "hmac_mismatch";
}

// The one entry point the /webhook handler calls when verifySignature has
// already returned false. Never throws — a KV or Meta failure is logged and
// the caller keeps flowing.
export async function handleSignatureFailure(
  env: Env,
  args: {
    rawBodyLength: number;
    signatureHeader: string | null;
    reason?: SignatureFailureReason;
    now?: Date;
  },
): Promise<void> {
  const now = args.now ?? new Date();
  const reason = args.reason ?? classifySignatureFailure(args.signatureHeader);
  const sigPrefix = args.signatureHeader
    ? sanitizeSigPrefix(args.signatureHeader)
    : "(none)";
  const hasHeader = args.signatureHeader !== null;

  console.warn(
    `[wa-sig-fail] reason=${reason} body_len=${args.rawBodyLength} ` +
      `has_header=${hasHeader} sig_prefix=${sigPrefix}`,
  );

  const dateKey = riyadhDateKey(now);
  const count = await incrementDailyCounter(env, dateKey);

  const alertKey = `${SIG_FAIL_ALERT_KEY_PREFIX}${dateKey}`;
  const shouldAlert = await claimAlertSlot(env, alertKey);
  if (!shouldAlert) return;

  const mode = runtimeMode(env).mode;
  const riyadhTime = formatRiyadhTime(now);
  const text =
    `⚠️ UTAK: رفض توقيع webhook\n` +
    `البيئة: ${mode}\n` +
    `الوقت: ${riyadhTime} (الرياض)\n` +
    `عدد الرفض اليوم: ${count}\n` +
    `السبب: ${reason}`;

  await deliverOwnerAlert(env, text).catch((e) =>
    console.warn(
      `[wa-sig-fail] alert dispatch threw: ${(e as Error)?.message ?? e}`,
    ),
  );
}

// Read the last N Riyadh calendar days of counters. Used by /health.
export async function readRecentSignatureFailures(
  env: Env,
  days = 7,
  now: Date = new Date(),
): Promise<{ date: string; count: number }[]> {
  const out: { date: string; count: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = riyadhDateKey(d);
    let count = 0;
    try {
      const raw = await env.MSG_DEDUP.get(`${SIG_FAIL_KEY_PREFIX}${key}`);
      const n = raw ? Number.parseInt(raw, 10) : 0;
      count = Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
      console.warn(
        `[wa-sig-fail] read ${key} failed: ${(e as Error)?.message ?? e}`,
      );
    }
    out.push({ date: key, count });
  }
  return out;
}

async function incrementDailyCounter(env: Env, dateKey: string): Promise<number> {
  const key = `${SIG_FAIL_KEY_PREFIX}${dateKey}`;
  try {
    const raw = await env.MSG_DEDUP.get(key);
    const prev = raw ? Number.parseInt(raw, 10) : 0;
    const next = (Number.isFinite(prev) && prev > 0 ? prev : 0) + 1;
    await env.MSG_DEDUP.put(key, String(next), {
      expirationTtl: SIG_FAIL_TTL_SECONDS,
    });
    return next;
  } catch (e) {
    console.warn(
      `[wa-sig-fail] counter update failed: ${(e as Error)?.message ?? e}`,
    );
    return 1;
  }
}

// Returns true if this call was the first to write the debounce marker for
// the given key — i.e. this caller owns today's alert slot. A KV failure
// yields false so we err on the side of silence rather than flooding the
// owner with alerts.
async function claimAlertSlot(env: Env, alertKey: string): Promise<boolean> {
  try {
    const existing = await env.MSG_DEDUP.get(alertKey);
    if (existing) return false;
    await env.MSG_DEDUP.put(alertKey, "1", {
      expirationTtl: SIG_FAIL_ALERT_TTL_SECONDS,
    });
    return true;
  } catch (e) {
    console.warn(
      `[wa-sig-fail] debounce KV failed, suppressing alert: ${(e as Error)?.message ?? e}`,
    );
    return false;
  }
}

async function deliverOwnerAlert(env: Env, text: string): Promise<void> {
  const owner = String(env.OWNER_WHATSAPP ?? "").trim();
  if (!owner) {
    console.warn("[wa-sig-fail] OWNER_WHATSAPP unset — skipping alert");
    return;
  }

  // Primary path: through fetchMeta with the owner_alert purpose the
  // owner-guard already permits. In sim mode this yields a synthetic 200 +
  // fake wamid and the alert is captured in D1 like any other outbound;
  // that is fine — Baraa reads sim traffic in the Discuss mirror too.
  const { sendText } = await import("./meta");
  const resp = await sendText(env, owner, text, { purpose: "owner_alert" });
  if (resp.ok) return;

  let bodyText = "";
  try {
    bodyText = await resp.clone().text();
  } catch {
    /* ignore */
  }

  const guardBlocked =
    resp.status === 403 &&
    (bodyText.includes("OwnerGuardBlocked") ||
      bodyText.includes("AllowlistBlocked"));

  if (guardBlocked) {
    console.warn(
      `[wa-sig-fail] owner-guard blocked alert (status=${resp.status}) — using direct bypass`,
    );
    await sendOwnerDirect(env, owner, text);
    return;
  }

  // Meta itself rejected the send (24-hour window closed, template needed,
  // etc.). The KV counter has already been incremented, so the operator
  // still has a trail via /health. Log and let it go — never throw.
  console.warn(
    `[wa-sig-fail] alert send blocked by Meta status=${resp.status} body=${bodyText.slice(0, 200)}`,
  );
}

async function sendOwnerDirect(env: Env, owner: string, text: string): Promise<void> {
  // 2026-09-25 (STATUS § 27) — the one POST to Graph outside fetchMeta. In
  // sim / pilot it still honours SIM_ALLOWLIST, so no send on a test worker
  // skips the list.
  if (isTestMode(env) && !isRecipientAllowed(env, owner)) {
    console.warn("[wa-sig-fail] direct alert skipped — owner not in SIM_ALLOWLIST");
    return;
  }
  try {
    const url = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;
    const to = owner.replace(/^\+/, "");
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });
    if (!resp.ok) {
      let body = "";
      try {
        body = await resp.text();
      } catch {
        /* ignore */
      }
      console.warn(
        `[wa-sig-fail] direct alert Meta status=${resp.status} body=${body.slice(0, 200)}`,
      );
    }
  } catch (e) {
    console.warn(
      `[wa-sig-fail] direct alert threw: ${(e as Error)?.message ?? e}`,
    );
  }
}

function sanitizeSigPrefix(header: string): string {
  const raw = header.startsWith("sha256=") ? header.slice(7) : header;
  const cleaned = raw.replace(/[^a-fA-F0-9]/g, "");
  return cleaned.slice(0, 8) || "(empty)";
}

function formatRiyadhTime(now: Date): string {
  const riyadh = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const iso = riyadh.toISOString();
  // "2026-09-21T14:07:32.000Z" → "2026-09-21 14:07"
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
