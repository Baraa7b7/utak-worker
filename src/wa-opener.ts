// «فتح المحادثة» — 2026-09-25 (STATUS § 34).
//
// A critical («مهمة») message (src/wa-purposes.ts `critical`) that the gateway
// has to hold — the number is outside its 24h window and the purpose has no
// usable UTILITY template — also sends the number ONE approved UTILITY
// template that invites a tap: «يوجد تحديث … اضغط «عرض التحديث» للتفاصيل».
// The tap (payload OPEN_PAYLOAD) is an inbound message: it opens the window,
// and the webhook flushes everything held for the number, in order
// (flushHeld). Nothing else changes: the expiry rules, the refusal policy and
// the queue are § 33's.
//
//   • The template follows the number's category, as the routing reads it
//     (team → supplier → customer; Baraa is OWNER_WHATSAPP):
//       customer → utak_update_customer  [account number, what]
//       team     → utak_update_team      [shift date,     what]
//       supplier → utak_update_supplier  [date,           what]
//       owner    → utak_update_owner     [date,           what]
//     looked up by x_purpose conv_open_<category>, so the gateway's rules
//     apply as to any template: APPROVED, UTILITY (a MARKETING or REJECTED
//     one is never used, and the messages stay held), not dropped today.
//   • No opener for an archived number, a «شخصي» one, one waiting for review
//     as not a customer (screening hold), or one that opted out (§ 23): the
//     held message waits for the number's own next message.
//   • At most once per number and Riyadh day (KV claim, read back). A template
//     Meta refused keeps the day's claim: no second try that day. One that is
//     still PENDING frees the claim and cools down an hour, so a later
//     approval counts today; one that is final and unusable (MARKETING,
//     REJECTED, none mapped) keeps the day's claim.
//   • Baraa: his fixed 06:00 «بدء الدوام» stays his daily opener
//     (attendance.ts); utak_update_owner is its backup only — on the 06:00
//     send itself when that template cannot go, and for an alert held later
//     in the day. Not in the half hour before 06:00 (the daily message is due).

import type { Env } from "./config";
import { gatewayDecision, isOwnerRecipient, sendViaGateway } from "./wa-gateway";
import { purposePolicy } from "./wa-purposes";
import { waDigits } from "./wa-window";
import { arabicDate, maskPhone } from "./wa-params";
import { riyadhDateKey, riyadhMinutes } from "./hours";

export type OpenerCategory = "customer" | "team" | "supplier" | "owner";

/** The quick reply's payload: «عرض التحديث». */
export const OPEN_PAYLOAD = "wa_update_open";
/** The tap found nothing held (it expired, or went with an earlier message). */
export const OPEN_NOTHING_TEXT = "ما فيه تحديث جديد الآن، وكل ما كان عندنا وصلك ✅";

export const OPENER_PURPOSE: Readonly<Record<OpenerCategory, string>> = {
  customer: "conv_open_customer",
  team: "conv_open_team",
  supplier: "conv_open_supplier",
  owner: "conv_open_owner",
};

/** The templates created for § 34 (scripts/s34-20260925-opener-templates.mjs). */
export const OPENER_TEMPLATE: Readonly<Record<OpenerCategory, string>> = {
  customer: "utak_update_customer",
  team: "utak_update_team",
  supplier: "utak_update_supplier",
  owner: "utak_update_owner",
};
export const OPENER_TEMPLATE_NAMES: ReadonlySet<string> = new Set(Object.values(OPENER_TEMPLATE));

export function isOpenerPurpose(purpose: string): boolean {
  return Object.values(OPENER_PURPOSE).includes(purpose);
}

/** Minutes before Baraa's daily 06:00 message during which no owner opener goes. */
export const OWNER_MORNING_QUIET_MIN = 30;
/** The template's status at Meta is not final yet (resolveTemplate's reason). */
export function awaitingMeta(reason: string): boolean {
  return /حالته (PENDING|IN_APPEAL|PAUSED)/.test(reason);
}
/** A pending template frees the day's claim and waits this long. */
const COOL_DOWN_SEC = 3600;
const DAY_KEY_TTL_SEC = 26 * 3600;

export function openerDayKey(to: string, now: number = Date.now()): string {
  return `wa_open:v1:${riyadhDateKey(new Date(now))}:${waDigits(to)}`;
}
export function openerCoolKey(to: string): string {
  return `wa_open_cool:v1:${waDigits(to)}`;
}

// ---------------------------------------------------------------- the category

export interface CategoryResult {
  category: OpenerCategory | null;
  /** Why (Arabic), for the log and the report. */
  reason: string;
  partnerId?: number;
}

interface PartnerRow {
  id: number;
  active?: boolean;
  customer_rank?: number;
  supplier_rank?: number;
  x_contact_class?: string | false;
  x_review_pending?: boolean;
  x_ai_intent?: string | false;
  x_wa_marketing_optout?: boolean;
}

/**
 * The number's category for the opener, or null (no opener) with the reason.
 * Opted out (§ 23), archived, «شخصي» and a screening hold (§ 30) → null.
 */
export async function recipientCategory(env: Env, to: string): Promise<CategoryResult> {
  const digits = waDigits(to);
  if (!digits) return { category: null, reason: "بلا رقم" };
  if (isOwnerRecipient(env, digits)) return { category: "owner", reason: "المالك" };
  const e164 = `+${digits}`;
  const { call, findTeamMemberByWhatsApp } = await import("./odoo");
  const partners = await call<PartnerRow[]>(env, "res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "=", e164], ["phone", "=", e164]],
    fields: ["id", "active", "customer_rank", "supplier_rank", "x_contact_class", "x_review_pending", "x_ai_intent", "x_wa_marketing_optout"],
    context: { active_test: false },
    limit: 20,
  });
  if (partners.some((p) => p.x_wa_marketing_optout === true)) return { category: null, reason: "أوقف الرسائل (§ 23)" };
  const team = await findTeamMemberByWhatsApp(env, e164).catch(() => null);
  if (team) return { category: "team", reason: "فريق", partnerId: team.id };
  const active = partners.filter((p) => p.active !== false);
  if (partners.length > 0 && active.length === 0) return { category: null, reason: "مؤرشف" };
  if (active.length === 0) return { category: null, reason: "رقم بلا شريك" };
  if (active.some((p) => p.x_contact_class === "personal")) return { category: null, reason: "شخصي" };
  const supplier = active.find((p) => Number(p.supplier_rank ?? 0) > 0 || p.x_contact_class === "supplier");
  if (supplier) return { category: "supplier", reason: "مورد", partnerId: supplier.id };
  const { isCustomerAutomationHeld } = await import("./screening");
  const customer = active.find((p) => Number(p.customer_rank ?? 0) > 0 || !p.x_contact_class || p.x_contact_class === "customer" || p.x_contact_class === "unreviewed");
  if (!customer) return { category: null, reason: "بلا تصنيف يستقبل" };
  if (isCustomerAutomationHeld(customer)) return { category: null, reason: "ينتظر المراجعة أو محجوز عن الرسائل الآلية" };
  return { category: "customer", reason: "عميل", partnerId: customer.id };
}

// ---------------------------------------------------------------- the params

/** {{1}}: the customer's account number, else today's date (Riyadh). {{2}}: the update, two or three words. */
export function openerParams(category: OpenerCategory, heldPurpose: string, partnerId: number | undefined, now: number = Date.now()): string[] {
  const what = purposePolicy(heldPurpose)?.update ?? purposePolicy(heldPurpose)?.label ?? "تحديث";
  const ref = category === "customer" && partnerId ? String(partnerId) : arabicDate(riyadhDateKey(new Date(now)));
  return [ref, what];
}

/** The opener as a gateway template option (the 06:00 fallback uses it too). */
export function openerOption(category: OpenerCategory, params: string[]) {
  return {
    kind: "template" as const,
    purpose: OPENER_PURPOSE[category],
    params,
    buttons: [{ index: 0, payload: OPEN_PAYLOAD }],
  };
}

// ---------------------------------------------------------------- once a day

async function kvGet(env: Env, key: string): Promise<string | null> {
  try { return await env.MSG_DEDUP.get(key); } catch { return null; }
}

/** Claim today's opener for `to` (put, then read back: the later writer wins). */
async function claimDay(env: Env, to: string, now: number): Promise<{ claimed: boolean; token: string; state?: string }> {
  const key = openerDayKey(to, now);
  const prev = await kvGet(env, key);
  if (prev !== null) return { claimed: false, token: "", state: prev };
  const token = `run:${now}:${Math.random().toString(36).slice(2, 10)}`;
  try {
    await env.MSG_DEDUP.put(key, token, { expirationTtl: DAY_KEY_TTL_SEC });
    const back = await env.MSG_DEDUP.get(key);
    if (back !== null && back !== token) return { claimed: false, token, state: back };
  } catch (e) {
    console.warn("[opener] KV claim failed — not sending", (e as Error)?.message);
    return { claimed: false, token, state: "kv-error" };
  }
  return { claimed: true, token };
}

/** The 06:00 message used utak_update_owner: that is today's opener for Baraa. */
export async function markOpenerSentToday(env: Env, to: string, template: string, now: number = Date.now()): Promise<void> {
  try {
    await env.MSG_DEDUP.put(openerDayKey(to, now), `sent:${new Date(now).toISOString()}:${template}`, { expirationTtl: DAY_KEY_TTL_SEC });
  } catch { /* the gateway's own guards still apply */ }
}

// ---------------------------------------------------------------- send

export type OpenerOutcome =
  | "sent"            // the template went to Meta
  | "already_today"   // an opener went (or was claimed) today
  | "cooldown"        // the template could not be used in the last hour
  | "no_category"     // archived / personal / opted out / held / unknown
  | "owner_morning"   // Baraa's 06:00 message is due within half an hour
  | "not_critical"    // the held purpose is not «مهمة»
  | "unusable"        // no usable template (pending, rejected, marketing, allowlist …)
  | "rejected"        // Meta refused the template
  | "error";

export interface OpenerResult {
  outcome: OpenerOutcome;
  category?: OpenerCategory;
  template?: string;
  detail?: string;
}

/**
 * A critical message for `to` was just held: send its category's opener,
 * unless one went today. Never throws, never holds, never retries.
 */
export async function sendOpenerForHeld(
  env: Env,
  to: string,
  heldPurpose: string,
  opts: { ctx?: ExecutionContext; now?: number } = {},
): Promise<OpenerResult> {
  const now = opts.now ?? Date.now();
  try {
    if (!purposePolicy(heldPurpose)?.critical) return { outcome: "not_critical" };
    const cat = await recipientCategory(env, to);
    if (!cat.category) {
      console.log(`[opener] none to=${maskPhone(to)} purpose=${heldPurpose} — ${cat.reason}`);
      return { outcome: "no_category", detail: cat.reason };
    }
    const category = cat.category;
    if (category === "owner") {
      const { ownerWindowPlan } = await import("./attendance");
      const openAt = ownerWindowPlan(env).minutes;
      const m = riyadhMinutes(new Date(now));
      const until = openAt - m;
      if (until >= 0 && until <= OWNER_MORNING_QUIET_MIN) {
        console.log(`[opener] owner — the ${String(Math.floor(openAt / 60)).padStart(2, "0")}:${String(openAt % 60).padStart(2, "0")} message is due in ${until} min, no opener`);
        return { outcome: "owner_morning", category };
      }
    }
    const today = await kvGet(env, openerDayKey(to, now));
    if (today !== null) return { outcome: "already_today", category, detail: today };
    if (await kvGet(env, openerCoolKey(to))) return { outcome: "cooldown", category };
    const claim = await claimDay(env, to, now);
    if (!claim.claimed) return { outcome: "already_today", category, detail: claim.state };

    const params = openerParams(category, heldPurpose, cat.partnerId, now);
    const resp = await sendViaGateway(env, {
      purpose: OPENER_PURPOSE[category],
      to,
      content: openerOption(category, params),
      ctx: opts.ctx,
    });
    const d = gatewayDecision(resp);
    if (d?.action === "template") {
      await markOpenerSentToday(env, to, d.template, now);
      console.log(`[opener] sent ${d.template} to=${maskPhone(to)} for=${heldPurpose} params=${JSON.stringify(params)}`);
      return { outcome: "sent", category, template: d.template };
    }
    if (d?.action === "rejected") {
      // The claim stays: no second opener after a refusal (§ 33 refusal policy).
      console.warn(`[opener] Meta refused ${d.template ?? "?"} to=${maskPhone(to)} code=${d.code}`);
      return { outcome: "rejected", category, template: d.template, detail: String(d.code) };
    }
    const why = d && "reason" in d ? d.reason : `HTTP ${resp.status}`;
    // Pending at Meta (it may be approved later today): free the day and cool
    // down an hour. Final (MARKETING, REJECTED, no template): the day's one
    // attempt stays spent — one «skipped» row a day, not one an hour.
    if (awaitingMeta(why)) {
      try {
        await env.MSG_DEDUP.delete(openerDayKey(to, now));
        await env.MSG_DEDUP.put(openerCoolKey(to), `${new Date(now).toISOString()} ${why}`.slice(0, 500), { expirationTtl: COOL_DOWN_SEC });
      } catch { /* expires on its own */ }
    } else {
      try {
        await env.MSG_DEDUP.put(openerDayKey(to, now), `unusable:${new Date(now).toISOString()}:${why}`.slice(0, 500), { expirationTtl: DAY_KEY_TTL_SEC });
      } catch { /* the claim token still blocks today */ }
    }
    console.warn(`[opener] not sent to=${maskPhone(to)} category=${category} — ${why}`);
    return { outcome: "unusable", category, detail: why };
  } catch (e) {
    console.warn("[opener] failed", (e as Error)?.message);
    return { outcome: "error", detail: (e as Error)?.message };
  }
}
