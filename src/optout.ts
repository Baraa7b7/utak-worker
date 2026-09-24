// ============================================================
// 2026-09-24 (م3) — marketing opt-out.
//
// A customer whose whole message is «إيقاف» / «stop» / «إلغاء الاشتراك» /
// «unsubscribe» stops the two MARKETING messages of the 08:00 outreach:
// the feedback request (utak_feedback) and the inactive nudge
// (utak_v2_inactive). «تشغيل» / «start» turns them back on. Orders,
// invoices, payment reminders and the standing-order reminder are service
// messages and are not affected.
//
// The flag lives on res.partner.x_wa_marketing_optout (boolean, created by
// scripts/wa-20260924-marketing-optout-field.mjs), so Baraa sees and edits it
// on the partner form next to «مسموح واتساب».
// ============================================================
import type { Env } from "./config";
import { call } from "./odoo";

export const OPTOUT_FIELD = "x_wa_marketing_optout";

/** Whole-message commands, compared after normalizeCommand. */
const OPTOUT_WORDS = new Set(["ايقاف", "stop", "الغاء الاشتراك", "unsubscribe"]);
const RESUBSCRIBE_WORDS = new Set(["تشغيل", "start"]);

export const OPTOUT_CONFIRM_TEXT =
  "تم إيقاف الرسائل التسويقية ✅ (طلب التقييم وتذكير الغياب). رسائل طلباتك وفواتيرك تستمر كالمعتاد، ولو حبيت ترجعها اكتب «تشغيل».";
export const RESUBSCRIBE_CONFIRM_TEXT =
  "رجّعنا لك الرسائل ✅ ولو حبيت توقفها مرة ثانية اكتب «إيقاف».";
export const OPTOUT_PENDING_TEXT =
  "وصلنا طلبك ✅ والفريق بيوقف الرسائل التسويقية يدوياً خلال اليوم.";
export const RESUBSCRIBE_PENDING_TEXT =
  "وصلنا طلبك ✅ والفريق بيرجّع لك الرسائل يدوياً خلال اليوم.";

/** Arabic-insensitive comparison: no diacritics / tatweel, bare alef, lower case. */
export function normalizeCommand(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/[.!؟?،,؛;:"'«»()\-–—_*~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** «إيقاف» → optout, «تشغيل» → resubscribe; anything longer is a normal message. */
export function parseOptoutCommand(text: string | null | undefined): "optout" | "resubscribe" | null {
  if (!text) return null;
  const t = normalizeCommand(text);
  if (OPTOUT_WORDS.has(t)) return "optout";
  if (RESUBSCRIBE_WORDS.has(t)) return "resubscribe";
  return null;
}

/**
 * The opted-out ids among `ids`. Throws when Odoo cannot answer (field
 * missing, rate limit after retries): the caller then skips its marketing
 * sends for the day rather than message someone who asked us to stop.
 */
export async function readMarketingOptouts(env: Env, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await call<Array<{ id: number }>>(env, "res.partner", "search_read", {
    domain: [["id", "in", ids], [OPTOUT_FIELD, "=", true]],
    fields: ["id"],
    limit: ids.length,
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * Handle «إيقاف» / «تشغيل» from a customer. Returns the reply text, or null
 * when the message is not a command. A failed Odoo write alerts the owner
 * and says so honestly instead of confirming.
 */
export async function handleOptoutCommand(
  env: Env,
  partner: { id: number; name: string },
  text: string | null | undefined,
): Promise<string | null> {
  const cmd = parseOptoutCommand(text);
  if (!cmd) return null;
  const optout = cmd === "optout";
  try {
    await call<boolean>(env, "res.partner", "write", { ids: [partner.id], vals: { [OPTOUT_FIELD]: optout } });
    console.log(`[optout] partner=${partner.id} ${OPTOUT_FIELD}=${optout}`);
    return optout ? OPTOUT_CONFIRM_TEXT : RESUBSCRIBE_CONFIRM_TEXT;
  } catch (e) {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env,
      `⚠️ العميل ${partner.name} (#${partner.id}) طلب ${optout ? "إيقاف" : "إعادة تشغيل"} الرسائل التسويقية، ولم يُسجَّل في Odoo: ${(e as Error).message.slice(0, 160)}. عدّل الحقل «إيقاف الرسائل التسويقية» على بطاقته يدوياً.`);
    return optout ? OPTOUT_PENDING_TEXT : RESUBSCRIBE_PENDING_TEXT;
  }
}
