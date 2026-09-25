// WhatsApp send-failure accounting — 2026-09-24 (WA-SCENARIOS ح6).
//
// Before: a Meta refusal left one "⚠️ ما انرسلت" line in the recipient's
// Discuss channel, a text fallback was treated as success, and nobody told
// the owner. Now every failure — synchronous (Meta answered 4xx/5xx) or
// asynchronous (a `failed` status webhook, e.g. 131047 outside the 24h
// window), or a refused template variable (a code bug) — goes through
// recordSendFailure, which:
//   1. bumps a per-Riyadh-day KV counter, read by /health (sendFailures);
//   2. writes (or, for an async failure, relies on) an x_wa_message row with
//      x_status='failed' and the Meta code in x_meta_error;
//   3. alerts the owner on the FIRST failure of each template per Riyadh day
//      (template name, Meta code, recipient masked to its last four digits).
// A failure addressed to the owner is only logged and counted: alerting
// through the owner channel about the owner channel would recurse.
// Never throws.

import type { Env } from "./config";
import { riyadhDateKey } from "./hours";
import { maskPhone } from "./wa-params";

const COUNT_PREFIX = "wa_send_fail:";
const ALERT_PREFIX = "wa_send_fail_alert:";
const COUNT_TTL = 8 * 24 * 60 * 60;
const ALERT_TTL = 26 * 60 * 60;

export interface SendFailure {
  to: string;
  /** Template name (utak_…) or "text" / "interactive" / … for session sends. */
  what: string;
  code: number | string | null;
  message: string;
  phase: "sync" | "async" | "code";
  /** Present when the send already has an x_wa_message row (async). */
  hasRow?: boolean;
  /** Echo text for the new x_wa_message row (sync / code). */
  body?: string;
  wamid?: string;
}

function isOwner(env: Env, to: string): boolean {
  const o = String(env.OWNER_WHATSAPP ?? "").replace(/[^0-9]/g, "");
  return o.length > 0 && String(to ?? "").replace(/[^0-9]/g, "") === o;
}

/** What a Meta message body is: its template name, or its message type. */
export function sendWhat(body: Record<string, unknown>): string {
  const b = body as { type?: string; template?: { name?: string } };
  return b.type === "template" ? String(b.template?.name ?? "template") : String(b.type ?? "unknown");
}

/**
 * The template of a logged send: "📋 قالب: utak_x (…)" in rows written before
 * § 36, else {"template":"utak_x"} in x_debug_payload (§ 36: the text is what
 * the recipient read, the name stays technical).
 */
export function templateFromEcho(echo: string | null | undefined, debugPayload?: string | null): string | null {
  const m = /📋 قالب: ([A-Za-z0-9_]+)/.exec(String(echo ?? ""));
  if (m) return m[1];
  try {
    const t = JSON.parse(String(debugPayload ?? ""))?.template;
    return typeof t === "string" && t ? t : null;
  } catch {
    return null;
  }
}

export async function recordSendFailure(env: Env, f: SendFailure): Promise<void> {
  const errText = `${f.phase === "code" ? "code" : "Meta"} ${f.code ?? "?"}: ${String(f.message ?? "").slice(0, 300)}`;
  console.error(`[send-fail] phase=${f.phase} what=${f.what} code=${f.code ?? "?"} to=${maskPhone(f.to)} ${String(f.message ?? "").slice(0, 160)}`);
  const day = riyadhDateKey();

  // 1) counter
  try {
    const key = `${COUNT_PREFIX}${day}`;
    const prev = Number.parseInt((await env.MSG_DEDUP.get(key)) ?? "0", 10);
    await env.MSG_DEDUP.put(key, String((Number.isFinite(prev) && prev > 0 ? prev : 0) + 1), { expirationTtl: COUNT_TTL });
  } catch (e) {
    console.warn("[send-fail] counter failed", (e as Error)?.message);
  }

  // 2) x_wa_message row with x_status='failed'
  if (!f.hasRow) {
    try {
      // § 36 — on the number's partner, Baraa's included (his channel shows it too).
      const { partnerForNumber } = await import("./wa-record");
      const partnerId = (await partnerForNumber(env, String(f.to ?? "")))?.id ?? null;
      const { createWaMessageRow } = await import("./wa-message-send");
      await createWaMessageRow(env, {
        partnerId,
        direction: "out",
        kind: f.what.startsWith("utak_") || f.what === "template" ? "template" : "text",
        // § 36 — the text the recipient would have read; a template's name only in x_debug_payload
        body: f.body ?? `[${f.what.startsWith("utak_") ? "template" : f.what}]`,
        debugPayload: f.what.startsWith("utak_") ? JSON.stringify({ template: f.what }) : undefined,
        source: "auto",
        status: "failed",
        metaError: errText,
        metaMessageId: f.wamid,
      });
    } catch (e) {
      console.warn("[send-fail] x_wa_message row failed", (e as Error)?.message);
    }
  }

  // 3) owner alert, first failure of this template today
  if (isOwner(env, f.to)) return;
  try {
    const key = `${ALERT_PREFIX}${day}:${f.what}`;
    if (await env.MSG_DEDUP.get(key)) return;
    await env.MSG_DEDUP.put(key, new Date().toISOString(), { expirationTtl: ALERT_TTL });
    const kind = f.what.startsWith("utak_") ? `القالب: ${f.what}` : `رسالة ${f.what === "text" ? "نصية" : f.what}`;
    const phase = f.phase === "code" ? "رُفض قبل الإرسال (خطأ برمجي في المتغيرات)"
      : f.phase === "async" ? "رفضه Meta بعد القبول" : "رفضه Meta";
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(
      env,
      `⚠️ فشل إرسال واتساب — ${kind}، الرمز ${f.code ?? "?"}، المستقبل ${maskPhone(f.to)}. ${phase}: ${String(f.message ?? "").slice(0, 160)}. أول فشل لهذا القالب اليوم؛ التفاصيل في سجل رسائل واتساب.`,
    );
  } catch (e) {
    console.warn("[send-fail] owner alert failed", (e as Error)?.message);
  }
}

/** Last N Riyadh days of failure counts — /health. */
export async function readRecentSendFailures(
  env: Env,
  days = 7,
  now: Date = new Date(),
): Promise<{ date: string; count: number }[]> {
  const out: { date: string; count: number }[] = [];
  for (let i = 0; i < days; i++) {
    const key = riyadhDateKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
    let count = 0;
    try {
      const n = Number.parseInt((await env.MSG_DEDUP.get(`${COUNT_PREFIX}${key}`)) ?? "0", 10);
      count = Number.isFinite(n) && n > 0 ? n : 0;
    } catch { /* counted as 0 */ }
    out.push({ date: key, count });
  }
  return out;
}
