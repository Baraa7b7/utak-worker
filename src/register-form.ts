// § 53 د (2026-10-04) — the customer's registration as a WhatsApp Flow.
//
// The Flow (utak_register_v1, published at Meta; scripts/lib/s53-flows.mjs is
// its JSON) is one screen with no endpoint: the shop's name (required), its
// activity (a list), the person in charge, the legal name and the VAT number
// (both optional) and the district.
//
//   • For a NEW customer only — a partner created from REGISTER_NEW_SINCE_UTC
//     on. A customer of before (#31, #105) never gets it: his card is Baraa's.
//   • It goes INSIDE the 24h window only (an interactive message: no template,
//     nothing held), in place of the text questions:
//       – after a new customer's first purchase-like message (once);
//       – after his confirmed order, in place of § 44's «هل منشأتك مسجلة في
//         ضريبة القيمة المضافة؟» and its three text steps (src/vat-ask.ts: the
//         same count, at most three).
//   • The answers go to fields that exist: name (the shop), x_customer_type
//     (the activity), x_contact_name (the person in charge), x_legal_name, vat
//     and x_vat_status (§ 44), x_delivery_neighborhood and street (the
//     district). ONE write, when every field is valid.
//   • The VAT number is § 44's: 15 digits, the first and the last «3»
//     (parseVatNumber). A number that is not one saves NOTHING: the form opens
//     again with what he typed. With a number: «مسجّل» (a full tax invoice).
//     Without one: «غير مسجّل» — he was asked, and is not asked again.
//   • After it: the delivery location is asked by an ordinary WhatsApp message,
//     as today (no location on his card yet).
//   • flow_token: one per send, kept in KV with the partner; a reply is read
//     from it by the number it was sent to, once.
//   • The trial to Baraa («🧪 تجربة») writes nothing in Odoo.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import { call, getPartnerLocation } from "./odoo";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { parseVatNumber, vatStatusOf } from "./vat-ask";

/** utak_register_v1 at Meta (a published Flow's JSON is frozen). */
export const REGISTER_FLOW_ID = "1397273449266078";
export const REGISTER_FLOW_SCREEN = "REGISTER";
export const REGISTER_FORM_PURPOSE = "customer_register_form";
/** The one trial to Baraa and its answers (allowed to the owner's number alone). */
export const REGISTER_FORM_TEST_PURPOSE = "register_flow_test";
export const REGISTER_FORM_CTA = "سجّل محلك";
export const REGISTER_TEST_MARK = "🧪 تجربة";
/**
 * A customer created from this moment on (Odoo's create_date, UTC — 23:00
 * Riyadh of 2026-10-04, § 53's deployment) is «new». Every customer of before
 * (#31 أبو مكين, #105 بيت التمور) never gets the form.
 */
export const REGISTER_NEW_SINCE_UTC = "2026-10-04 20:00:00";
/** The activity's choices: the value is res.partner.x_customer_type's. */
export const REGISTER_ACTIVITIES: Readonly<Record<string, string>> = {
  grocery: "بقالة / تموينات", restaurant: "مطعم", juice: "محل عصير", hotel: "فندق / تموين", other: "أخرى",
};
export const REGISTER_FIELDS = ["shop", "contact", "legal", "vat", "district"] as const;
type Field = (typeof REGISTER_FIELDS)[number];
const TOKEN_TTL = 7 * 24 * 60 * 60;
const FIRST_TTL = 30 * 24 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;

// ---------------------------------------------------------------- texts

export const REGISTER_NOTE = "عبّ بيانات محلك مرة واحدة، ونجهّز طلباتك وفواتيرك عليها.";
/** After a new customer's first purchase-like message. */
export const REGISTER_FIRST_TEXT = `حياك في يو تاك 🌿 سجّل محلك مرة واحدة: اضغط «${REGISTER_FORM_CTA}» وعبّ بياناته (والرقم الضريبي لو المنشأة مسجلة في الضريبة).`;
/** After a confirmed order, in place of § 44's question. */
export const REGISTER_VAT_TEXT = `عشان تصدر فاتورتك باسم محلك: اضغط «${REGISTER_FORM_CTA}» وعبّ بياناته (والرقم الضريبي لو المنشأة مسجلة في الضريبة).`;
export const REGISTER_BAD_VAT_TEXT = "الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3 🙏 صحّحه، أو اترك خانته فاضية لو المنشأة غير مسجلة، ثم «إرسال». لم يُحفظ شيء بعد.";
export const REGISTER_NO_SHOP_TEXT = "اسم المحل مطلوب 🙏 اكتبه ثم «إرسال». لم يُحفظ شيء بعد.";
export const REGISTER_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُحفظ منه شيء 🌿";
export const REGISTER_USED_TEXT = "بيانات محلك وصلتنا من قبل ✅ ولم تُسجَّل مرة ثانية. لأي تعديل اكتب لنا هنا.";
export const REGISTER_LOCATION_ASK = "📍 أرسل موقع التوصيل: اضغط 📎 → موقع → إرسال موقعي الحالي (أو موقع محدد لو التوصيل لمكان ثاني).";
export const registerDoneText = (shop: string, askLocation: boolean): string =>
  [`تم تسجيل محلك ✅ ${shop}`, askLocation ? REGISTER_LOCATION_ASK : ""].filter(Boolean).join("\n");

const clean = (v: unknown, max = 120): string => String(v ?? "").replace(/[‎‏⁦-⁩‪-‮]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

// ---------------------------------------------------------------- the reply's fields

export interface RegisterValues { shop: string; activity: string; contact: string; legal: string; vat: string; district: string }
export interface RegisterParsed {
  values: RegisterValues;
  /** The VAT number as § 44 reads it; "" when none was typed. */
  vat: string;
  problems: Array<"shop" | "vat">;
}
/** What the form holds, each field cleaned; the activity only when it is one of the list's. */
export function parseRegisterValues(raw: Record<string, unknown>): RegisterParsed {
  const activity = String(raw.activity ?? "").trim();
  const values: RegisterValues = {
    shop: clean(raw.shop), activity: Object.prototype.hasOwnProperty.call(REGISTER_ACTIVITIES, activity) ? activity : "",
    contact: clean(raw.contact), legal: clean(raw.legal), vat: clean(raw.vat, 40), district: clean(raw.district, 60),
  };
  const problems: RegisterParsed["problems"] = [];
  if (!values.shop || !/[\p{L}\p{N}]/u.test(values.shop)) problems.push("shop");
  const vat = values.vat ? parseVatNumber(values.vat) : "";
  if (vat === null) problems.push("vat");
  return { values, vat: vat ?? "", problems };
}

/** The partner's fields a valid form writes (ONE write). */
export function registerVals(p: RegisterParsed): Record<string, unknown> {
  const v = p.values;
  return {
    name: v.shop,
    ...(v.activity ? { x_customer_type: v.activity } : {}),
    ...(v.contact ? { x_contact_name: v.contact } : {}),
    ...(v.legal ? { x_legal_name: v.legal } : {}),
    ...(v.district ? { x_delivery_neighborhood: v.district, street: v.district } : {}),
    // § 44 — with a number: «مسجّل»; without one he was asked and answered: «غير مسجّل», not asked again
    ...(p.vat ? { vat: p.vat, x_vat_status: "registered" } : { x_vat_status: "not_registered" }),
  };
}

// ---------------------------------------------------------------- flow_token

export interface RegisterRecord {
  v: 1;
  token: string;
  to: string;
  partnerId: number;
  createdAt: number;
  test?: boolean;
  usedAt?: number;
}
export const registerFormKey = (token: string): string => `rform:v1:${token}`;
export const isRegisterFormToken = (token: string): boolean => String(token ?? "").startsWith("rg1.");
export function newRegisterToken(partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `rg1.${partnerId}.${rand}`;
}
export async function readRegisterToken(env: Env, token: string): Promise<RegisterRecord | null> {
  if (!isRegisterFormToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(registerFormKey(token));
    const rec = raw ? (JSON.parse(raw) as RegisterRecord) : null;
    return rec && rec.v === 1 && typeof rec.partnerId === "number" ? rec : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- the send

/** The screen's data: the line above the fields, and each text field's initial value. */
export function registerFormData(note: string, init: Partial<RegisterValues> = {}): Record<string, string> {
  const data: Record<string, string> = { note };
  for (const f of REGISTER_FIELDS) data[`i_${f}`] = String(init[f as Field] ?? "");
  return data;
}
export function registerFormSession(text: string, token: string, data: Record<string, string>): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, 1024) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: REGISTER_FLOW_ID,
            flow_cta: REGISTER_FORM_CTA,
            flow_action: "navigate",
            flow_action_payload: { screen: REGISTER_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

export interface RegisterWho { partnerId: number; whatsapp: string }
export interface RegisterResult { sent: boolean; reason?: string; token?: string }

/** One registration form: the interactive message, inside the number's window only. Nothing is held. */
export async function sendRegisterForm(env: Env, who: RegisterWho, o: { now?: number; body?: string; init?: Partial<RegisterValues>; test?: boolean; ctx?: ExecutionContext } = {}): Promise<RegisterResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  const now = o.now ?? Date.now();
  if (!o.test && isOwnerRecipient(env, to)) return { sent: false, reason: "owner" };
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const rec: RegisterRecord = { v: 1, token: newRegisterToken(who.partnerId), to, partnerId: who.partnerId, createdAt: now, ...(o.test ? { test: true } : {}) };
  await env.MSG_DEDUP.put(registerFormKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
  const mark = o.test ? `${REGISTER_TEST_MARK} — ` : "";
  const res = await sendViaGateway(env, {
    purpose: o.test ? REGISTER_FORM_TEST_PURPOSE : REGISTER_FORM_PURPOSE,
    to,
    content: registerFormSession(`${mark}${o.body ?? REGISTER_FIRST_TEXT}`, rec.token, registerFormData(`${mark}${REGISTER_NOTE}`, o.init)),
    noHold: true,
    noHoldReason: "نموذج التسجيل يُرسل داخل نافذة 24 ساعة فقط",
    ctx: o.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(registerFormKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token };
}

// ---------------------------------------------------------------- who gets it

export interface RegisterState { isNew: boolean; registered: boolean; name: string }
/**
 * Is this partner a NEW customer still to register? «New»: created from
 * REGISTER_NEW_SINCE_UTC on. «Registered»: his VAT status is known («مسجّل» /
 * «غير مسجّل» — the form always sets it), or a VAT number sits on his card.
 */
export async function readRegisterState(env: Env, partnerId: number): Promise<RegisterState | null> {
  const [p] = await call<Array<{ id: number; name: string; create_date: string | false; vat: string | false; x_vat_status: string | false }>>(
    env, "res.partner", "read", { ids: [partnerId], fields: ["id", "name", "create_date", "vat", "x_vat_status"] },
  );
  if (!p) return null;
  return {
    isNew: typeof p.create_date === "string" && p.create_date >= REGISTER_NEW_SINCE_UTC,
    registered: vatStatusOf(p) !== "unknown" || (typeof p.vat === "string" && p.vat.trim() !== ""),
    name: String(p.name || ""),
  };
}

const firstKey = (partnerId: number): string => `rform_first:v1:${partnerId}`;
/**
 * A new customer's first purchase-like message: is the form due now? Once per
 * partner (the answer is kept, so a customer of before costs one read in thirty
 * days). Never throws: a partner that cannot be read gets no form.
 */
export async function registerFormDue(env: Env, partnerId: number): Promise<boolean> {
  if (!partnerId) return false;
  try {
    if (await env.MSG_DEDUP.get(firstKey(partnerId))) return false;
    const st = await readRegisterState(env, partnerId);
    if (!st) return false;
    if (!st.isNew || st.registered) {
      await env.MSG_DEDUP.put(firstKey(partnerId), st.isNew ? "registered" : "before", { expirationTtl: FIRST_TTL });
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[register-form] partner ${partnerId} could not be read — no form`, (e as Error)?.message);
    return false;
  }
}

/** The form after a new customer's first purchase-like message; remembered when it went. Never throws. */
export async function sendFirstRegisterForm(env: Env, who: RegisterWho, ctx?: ExecutionContext, now: number = Date.now()): Promise<RegisterResult> {
  try {
    const r = await sendRegisterForm(env, who, { now, body: REGISTER_FIRST_TEXT, ctx });
    if (r.sent) await env.MSG_DEDUP.put(firstKey(who.partnerId), "sent", { expirationTtl: FIRST_TTL });
    return r;
  } catch (e) {
    console.warn(`[register-form] the first form to partner ${who.partnerId} failed`, (e as Error)?.message);
    return { sent: false, reason: "error" };
  }
}

// ---------------------------------------------------------------- the reply

export interface RegisterOutcome { action: "saved" | "invalid" | "test" | "unknown" | "duplicate"; problems?: string[] }

/** A reply of the registration form (nfm_reply): read, checked against its token, written on the partner's card, answered. */
export async function handleRegisterFormReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, now: number = Date.now()): Promise<RegisterOutcome> {
  const to = waDigits(msg.from);
  const owner = isOwnerRecipient(env, to);
  const say = async (text: string) => { await sendViaGateway(env, { purpose: owner ? REGISTER_FORM_TEST_PURPOSE : "bot_reply", to, content: textContent(text), ctx }); };
  const rec = await readRegisterToken(env, msg.flow?.token ?? "");
  if (!rec || rec.to !== to) {
    console.warn(`[register-form] reply with no token of this number from=${to.slice(-4)}`);
    await say(REGISTER_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const parsed = parseRegisterValues(msg.flow?.values ?? {});
  const v = parsed.values;
  if (rec.test) {
    const lines = [
      `${REGISTER_TEST_MARK} — وصلت بيانات المحل:`,
      `اسم المحل: ${v.shop || "—"} · النشاط: ${REGISTER_ACTIVITIES[v.activity] ?? "—"} · المسؤول: ${v.contact || "—"}`,
      `الاسم النظامي: ${v.legal || "—"} · الرقم الضريبي: ${v.vat ? (parsed.vat ? parsed.vat : `${v.vat} (غير صحيح: 15 رقماً يبدأ وينتهي بـ 3)`) : "—"} · الحي: ${v.district || "—"}`,
      "(تجربة: لم يُكتب شيء في Odoo)",
    ];
    await say(lines.join("\n"));
    return { action: "test", problems: parsed.problems };
  }
  // a field that is not valid: nothing is written, the form opens again with what he typed (the token stays usable)
  if (parsed.problems.length) {
    const body = parsed.problems.includes("shop") ? REGISTER_NO_SHOP_TEXT : REGISTER_BAD_VAT_TEXT;
    const again = await sendRegisterForm(env, { partnerId: rec.partnerId, whatsapp: to }, { now, body, init: v, ctx }).catch(() => ({ sent: false }));
    if (!again.sent) await say(body);
    return { action: "invalid", problems: parsed.problems };
  }
  const claim = await claimButton(env, `rform_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    await say(REGISTER_USED_TEXT);
    return { action: "duplicate" };
  }
  try {
    await call(env, "res.partner", "write", { ids: [rec.partnerId], vals: registerVals(parsed) });
    await env.MSG_DEDUP.put(registerFormKey(rec.token), JSON.stringify({ ...rec, usedAt: now }), { expirationTtl: TOKEN_TTL });
    await finishButton(env, claim, TOKEN_TTL);
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
  try { await env.MSG_DEDUP.put(firstKey(rec.partnerId), "registered", { expirationTtl: FIRST_TTL }); } catch { /* the card says it */ }
  // the delivery location, by an ordinary message, as today — unless his card carries one
  const hasLocation = !!(await getPartnerLocation(env, rec.partnerId).catch(() => null));
  await say(registerDoneText(v.shop, !hasLocation));
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, [
      `📝 عميل سجّل محله من النموذج: ${v.shop} (+${to})`,
      `النشاط: ${REGISTER_ACTIVITIES[v.activity] ?? "—"} · المسؤول: ${v.contact || "—"} · الحي: ${v.district || "—"}`,
      parsed.vat ? `مسجّل في الضريبة: ${parsed.vat}${v.legal ? ` · ${v.legal}` : ""}` : `غير مسجّل في الضريبة (ترك الرقم فاضياً)${v.legal ? ` · الاسم النظامي: ${v.legal}` : ""}`,
    ].join("\n"));
  } catch (e) {
    console.warn("[register-form] the owner's line failed", (e as Error)?.message);
  }
  console.log(`[register-form] partner=${rec.partnerId} saved (vat ${parsed.vat ? "yes" : "no"})`);
  return { action: "saved" };
}

// ---------------------------------------------------------------- the trial to Baraa

/** ONE registration form to Baraa's own number, marked «🧪 تجربة»: inside his window, once a day. His reply writes nothing in Odoo. */
export async function sendRegisterFormTest(env: Env, now: number = Date.now()): Promise<RegisterResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `rform_test:${REGISTER_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const r = await sendRegisterForm(env, { partnerId: 0, whatsapp: owner }, { now, test: true });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
