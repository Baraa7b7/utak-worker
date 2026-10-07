// § 65 د (2026-10-07) — «➕ صنف إضافي»: up to five items a price source adds to
// a price form — the day's (purchase or market) or a special request's.
//
// After a source's price form is taken he is offered ONE more form
// (utak_price_extra_v1, one screen, five rows of five optional fields: the
// item, its price, its packaging, its size, its origin), inside his 24h window
// only. A row counts when it has a name and a price above zero; a row with a
// name and no readable price is named in the answer and not kept.
//
// Each kept row is an OBSERVATION — an x_price_offer row flagged «خاص» with
// «نوع العرض» = «صنف إضافي» — so it enters no list of the day, no median and no
// «أقل عرض» (every reader of the day leaves «خاص» out, § 62). The item is the
// catalog's when its typed name is one (by the normalized name), else the
// unlinked item with the text beside it, and Baraa's one message says so.
// The price is the price of the packaging he WROTE («وحدة السعر (خاص)»).

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import { call } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { readWindow, waDigits } from "./wa-window";
import { itemRefFor } from "./supplier-catalog";
import type { PriceKind } from "./price-sources";

/** utak_price_extra_v1 at Meta (a published Flow's JSON is frozen). */
export const EXTRA_FLOW_ID = "1124859043408270";
export const EXTRA_FLOW_SCREEN = "EXTRA";
export const EXTRA_PURPOSE = "price_extra_form";
export const EXTRA_TEST_PURPOSE = "price_flow_test";
export const EXTRA_CTA = "➕ صنف إضافي";
export const EXTRA_ROWS = 5;
export const EXTRA_KIND = "extra";
export const EXTRA_TOKEN_PREFIX = "px1.";
export const isExtraToken = (token: string): boolean => String(token ?? "").startsWith(EXTRA_TOKEN_PREFIX);
const TOKEN_TTL = 36 * 60 * 60;
const OFFER_MODEL = "x_price_offer";
const SIM_FIELD = "x_utak_simulation";
const TEST_MARK = "🧪 تجربة";

export const EXTRA_ASK_TEXT = `عندك صنف مو في القائمة؟ اضغط «${EXTRA_CTA}» واكتبه بسعره (اختياري، حتى خمسة أصناف).`;
export const EXTRA_NOTE: Readonly<Record<PriceKind, string>> = {
  purchase: "الأسعار بدون ضريبة، للتعبئة التي تكتبها. حتى خمسة أصناف مو في القائمة.",
  market: "اكتب السعر زي ما ينباع في السوق (شامل الضريبة)، للتعبئة التي تكتبها. حتى خمسة أصناف مو في القائمة.",
};
export const extraHeading = (kind: PriceKind, test = false): string => `${test ? `${TEST_MARK} — ` : ""}أصناف إضافية — ${kind === "purchase" ? "أسعار الشراء" : "أسعار السوق"}`;
export const EXTRA_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُحفظ منه شيء 🌿";
export const EXTRA_USED_TEXT = "هذه الأصناف وصلتنا من قبل ✅ ولم تُسجَّل مرة ثانية.";
export const EXTRA_EMPTY_TEXT = "وصل النموذج بلا أصناف: لم يُحفظ شيء 🌿";

export interface ExtraRecord {
  v: 1;
  token: string;
  to: string;
  partnerId: number;
  employeeId: number | null;
  name: string;
  kind: PriceKind;
  day: string;
  /** A special request's form: its rows carry the request. */
  quoteId?: number;
  createdAt: number;
  /** The trial to Baraa: its rows are flagged «محاكاة». */
  test?: boolean;
  usedAt?: number;
}
export const extraKey = (token: string): string => `pxtra:v1:${token}`;
export function newExtraToken(partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${EXTRA_TOKEN_PREFIX}${partnerId}.${rand}`;
}
export async function readExtraToken(env: Env, token: string): Promise<ExtraRecord | null> {
  if (!isExtraToken(token)) return null;
  try {
    const rec = JSON.parse((await env.MSG_DEDUP.get(extraKey(token))) || "null") as ExtraRecord | null;
    return rec && rec.v === 1 && (rec.kind === "purchase" || rec.kind === "market") ? rec : null;
  } catch { return null; }
}

export function extraSession(text: string, token: string, data: Record<string, string>): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, 1024) },
        action: { name: "flow", parameters: { flow_message_version: "3", flow_token: token, flow_id: EXTRA_FLOW_ID, flow_cta: EXTRA_CTA, flow_action: "navigate", flow_action_payload: { screen: EXTRA_FLOW_SCREEN, data } } },
      },
    },
  };
}

export interface ExtraWho { partnerId: number; employeeId?: number | null; name: string; whatsapp: string; kind: PriceKind; day: string; quoteId?: number; test?: boolean }
/**
 * The offer of the extra form after a price form was taken: inside the source's window only, never
 * held, and never a reason for the price form's answer to fail (it never throws). True when it went.
 */
export async function offerExtraForm(env: Env, who: ExtraWho, ctx?: ExecutionContext, now: number = Date.now()): Promise<boolean> {
  try {
    const to = waDigits(who.whatsapp);
    if (!to || !(await readWindow(env, to, now)).open) return false;
    const rec: ExtraRecord = {
      v: 1, token: newExtraToken(who.partnerId), to, partnerId: who.partnerId, employeeId: who.employeeId ?? null, name: who.name, kind: who.kind, day: who.day, createdAt: now,
      ...(who.quoteId ? { quoteId: who.quoteId } : {}), ...(who.test ? { test: true } : {}),
    };
    await env.MSG_DEDUP.put(extraKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
    const res = await sendViaGateway(env, {
      purpose: who.test ? EXTRA_TEST_PURPOSE : EXTRA_PURPOSE, to,
      content: extraSession(`${who.test ? `${TEST_MARK} — ` : ""}${EXTRA_ASK_TEXT}`, rec.token, { t: extraHeading(who.kind, !!who.test), note: EXTRA_NOTE[who.kind] }),
      noHold: true, noHoldReason: "نموذج الصنف الإضافي يُرسل داخل نافذة 24 ساعة فقط", ctx,
    });
    if (gatewayDecision(res)?.action === "session") return true;
    try { await env.MSG_DEDUP.delete(extraKey(rec.token)); } catch { /* expires on its own */ }
    return false;
  } catch (e) {
    console.warn("[price-extra] the extra form could not be offered", (e as Error)?.message);
    return false;
  }
}

const clean = (v: unknown, max = 60): string => String(v ?? "").replace(/[‎‏⁦-⁩‪-‮]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
function priceOf(raw: unknown): number | null {
  let s = String(raw ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/٫/g, ".").replace(/\s+/g, "");
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n > 0 ? n : null;
}
export interface ExtraRow { name: string; price: number; pack: string; size: string; origin: string }
/** The form's rows: the ones with a name and a price above zero, and the names whose price cannot be read. */
export function readExtraRows(values: Record<string, unknown>): { rows: ExtraRow[]; invalid: string[] } {
  const rows: ExtraRow[] = [], invalid: string[] = [];
  for (let r = 1; r <= EXTRA_ROWS; r++) {
    const name = clean(values[`xn${r}`]);
    if (!name) continue;
    const price = priceOf(values[`xp${r}`]);
    if (price === null) { invalid.push(name); continue; }
    rows.push({ name, price, pack: clean(values[`xk${r}`], 40), size: clean(values[`xs${r}`], 30), origin: clean(values[`xo${r}`], 40) });
  }
  return { rows, invalid };
}

const money = (x: number): string => { const n = Math.round(Number(x) * 100) / 100; return Number.isInteger(n) ? String(n) : n.toFixed(2); };
export const extraLine = (r: ExtraRow): string => [`${r.name} ${money(r.price)}`, r.pack, r.size ? `مقاس ${r.size}` : "", r.origin].filter(Boolean).join(" · ");
export function extraAckText(saved: ExtraRow[], invalid: string[], test = false): string {
  const lines = [saved.length ? `${test ? `${TEST_MARK} — ` : ""}وصلت الأصناف الإضافية ✅ ${saved.map((r) => `${r.name} ${money(r.price)}`).join("، ")}.` : EXTRA_EMPTY_TEXT];
  if (invalid.length) lines.push(`⚠️ ما انحفظ (السعر رقم أكبر من صفر): ${invalid.join("، ")}.`);
  if (test && saved.length) lines.push("(تجربة: الصفوف معلّمة «محاكاة» ولا تُحسب في أي رقم)");
  return lines.join("\n");
}

/** The row one extra item writes. «خاص» keeps it out of every reader of the day. */
export function extraRowVals(rec: Pick<ExtraRecord, "partnerId" | "employeeId" | "name" | "kind" | "day" | "quoteId" | "test">, r: ExtraRow, ref: { productId: number; packagingId: number }, messageId: string): Record<string, unknown> {
  return {
    x_name: `${rec.day} · صنف إضافي · ${rec.name}`.slice(0, 120),
    x_date: rec.day,
    x_source_partner_id: rec.partnerId,
    x_source_employee_id: rec.employeeId || false,
    x_product_tmpl_id: ref.productId,
    x_packaging_id: ref.packagingId,
    x_purchase_price: rec.kind === "purchase" ? r.price : 0,
    x_market_price: rec.kind === "market" ? r.price : 0,
    x_available_qty: 0,
    x_status: "valid",
    x_source_message_id: messageId || false,
    x_raw_text: `صنف إضافي: ${extraLine(r)}`.slice(0, 2000),
    x_special: true,
    x_special_unit: r.pack || false,
    ...(rec.quoteId ? { x_special_quote_id: rec.quoteId } : {}),
    x_offer_kind: EXTRA_KIND,
    x_item_text: r.name,
    x_item_size: r.size || false,
    x_item_origin: r.origin || false,
    ...(rec.test ? { [SIM_FIELD]: true } : {}),
  };
}

export interface ExtraOutcome { action: "saved" | "empty" | "test" | "unknown" | "duplicate"; saved?: number; unlinked?: number }

/** A reply of the extra form (nfm_reply): read, checked against its token, written, answered. */
export async function handleExtraReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, now: number = Date.now()): Promise<ExtraOutcome> {
  const to = waDigits(msg.from);
  const owner = isOwnerRecipient(env, to);
  const say = async (text: string) => { await sendViaGateway(env, { purpose: owner ? EXTRA_TEST_PURPOSE : "bot_reply", to, content: textContent(text), ctx }); };
  const rec = await readExtraToken(env, msg.flow?.token ?? "");
  if (!rec || rec.to !== to) {
    console.warn(`[price-extra] reply with no token of this number from=${to.slice(-4)}`);
    await say(EXTRA_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const { rows, invalid } = readExtraRows(msg.flow?.values ?? {});
  if (!rows.length) { await say(extraAckText([], invalid)); return { action: "empty" }; }
  const claim = await claimButton(env, `pxtra_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) { await say(EXTRA_USED_TEXT); return { action: "duplicate" }; }
  const saved: ExtraRow[] = [], unlinked: string[] = [];
  try {
    for (const r of rows) {
      const ref = await itemRefFor(env, r.name);
      await call<number[]>(env, OFFER_MODEL, "create", { vals_list: [extraRowVals(rec, r, ref, msg.messageId)] });
      saved.push(r);
      if (!ref.linked) unlinked.push(r.name);
    }
    await env.MSG_DEDUP.put(extraKey(rec.token), JSON.stringify({ ...rec, usedAt: now }), { expirationTtl: TOKEN_TTL });
    await finishButton(env, claim, TOKEN_TTL);
  } catch (e) {
    // what was written stays; the token stays used only when every row was written
    if (!saved.length) { await releaseButton(env, claim); throw e; }
    await finishButton(env, claim, TOKEN_TTL);
    console.error("[price-extra] a row could not be written", (e as Error)?.message);
    invalid.push(...rows.slice(saved.length).map((r) => r.name));
  }
  await say(extraAckText(saved, invalid, !!rec.test));
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, [
      `${rec.test ? `${TEST_MARK} — ` : ""}➕ أصناف إضافية من «${rec.name}» (${rec.kind === "purchase" ? "شراء" : "سوق"}${rec.quoteId ? `، طلب خاص #${rec.quoteId}` : ""}) — خارج قائمة اليوم:`,
      ...saved.map((r) => `• ${extraLine(r)}`),
      unlinked.length ? `🆕 صنف من مورد (ليس في الكتالوج): ${unlinked.join("، ")} — اربطه أو أنشئه من «💲 التسعير ← 📥 عروض المصادر».` : "",
    ].filter(Boolean).join("\n"));
  } catch (e) {
    console.warn("[price-extra] the owner's line failed", (e as Error)?.message);
  }
  console.log(`[price-extra] partner=${rec.partnerId} kind=${rec.kind} saved=${saved.length} unlinked=${unlinked.length}${rec.test ? " (test)" : ""}`);
  return { action: rec.test ? "test" : "saved", saved: saved.length, unlinked: unlinked.length };
}
