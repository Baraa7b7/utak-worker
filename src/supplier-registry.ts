// § 65 (2026-10-07) — the suppliers' registry: a supplier registers from WhatsApp,
// Baraa approves him in Odoo, and his card says what he is.
//
// A supplier is a res.partner that carries «حالة المورد» (x_supplier_state:
// بانتظار الاعتماد / معتمد / موقوف — scripts/lib/s65-odoo.mjs). supplier_rank is
// NOT touched here: the 02:00 purchase ask and the supplier's reply path stay
// Baraa's decision (the card's «مصدر أسعار» and «دور الأسعار», or a purchase).
//
//   • «تسجيل مورد» / «سجلني كمورد» / «أبي أكون مورد» from a number that is neither
//     a customer nor the team (and the «تسجيل مورد» button of the invitation
//     template) → the Flow utak_supplier_signup_v1 (SIGNUP: the general screen;
//     TYPE: what his type is asked), inside his 24h window only, never held.
//   • The reply: read by its token, by the number it was sent to, once. A form
//     without a trade name or a type is refused whole and opens again. A valid
//     one writes ONE card — the one of his number, else a new one — «بانتظار
//     الاعتماد» (a card that already carries a state keeps it), the items he
//     typed matched to the catalog by their normalized names (the unmatched
//     stay a text), the countries matched to Odoo's, a farmer's crops as «مواسم
//     المورد» rows. He is told «استلمنا طلبك»; Baraa gets one message.
//   • «📨 أرسل رابط التسجيل» (Odoo → /odoo/hook/supplier?op=invite): the Flow
//     inside the card's number's window; outside it the template
//     utak_supplier_invite_v1 while it is APPROVED and UTILITY; neither → the
//     invitation's text is written on the card and sent to Baraa to forward.
//   • «✅ اعتماد» (Odoo writes the state and the cadence, then op=welcome): the
//     first «التواصل القادم», and the welcome with the buttons of his type —
//     «📦 بضاعتي جاهزة», and «🚢 وصلت شحنة» first for an importer — inside his
//     window, held until it opens otherwise. «⛔ إيقاف» is Odoo's alone.
//
// Nothing here reads or writes a price.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import { call } from "./odoo";
import { buttonsContent, textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { normName, resolveItems, splitItems } from "./supplier-catalog";

/** utak_supplier_signup_v1 at Meta (a published Flow's JSON is frozen). */
export const SIGNUP_FLOW_ID = "1623451192902813";
export const SIGNUP_FLOW_SCREEN = "SIGNUP";
export const SIGNUP_PURPOSE = "supplier_signup_form";
export const SIGNUP_TEST_PURPOSE = "supplier_registry_test";
export const SUPPLIER_INVITE_PURPOSE = "supplier_invite";
export const SUPPLIER_WELCOME_PURPOSE = "supplier_welcome";
export const SUPPLIER_REPLY_PURPOSE = "supplier_registry_reply";
export const SIGNUP_CTA = "سجّل كمورد";
export const SUPPLIER_TEST_MARK = "🧪 تجربة";
export const SIGNUP_TOKEN_PREFIX = "sg1.";
export const isSignupToken = (token: string): boolean => String(token ?? "").startsWith(SIGNUP_TOKEN_PREFIX);
const TOKEN_TTL = 7 * 24 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
const SIM_FIELD = "x_utak_simulation";
export const STATE_FIELD = "x_supplier_state";
export const SEASON_MODEL = "x_supplier_season";

export type SupplierState = "pending" | "approved" | "suspended";
export const STATE_LABEL: Readonly<Record<SupplierState, string>> = { pending: "بانتظار الاعتماد", approved: "معتمد", suspended: "موقوف" };
export const asState = (v: unknown): SupplierState | null => (v === "pending" || v === "approved" || v === "suspended" ? v : null);
/** «نوع المورد» as the card keeps it; a supplier chooses among the first six («مورد مصاريف» is Baraa's alone). */
export const TYPE_LABEL: Readonly<Record<string, string>> = {
  farmer: "مزارع", importer: "مستورد", market_agent: "وكيل سوق مركزي", wholesaler: "تاجر جملة", distributor: "موزّع متخصص", other: "أخرى", expense: "مورد مصاريف",
};
export const SIGNUP_TYPES = ["farmer", "importer", "market_agent", "wholesaler", "distributor", "other"] as const;
export type SignupType = (typeof SIGNUP_TYPES)[number];
export const METHOD_LABEL: Readonly<Record<string, string>> = { delivers: "يوصّل بنفسه", pickup: "نستلم من عنده", market: "في السوق" };
export const PAY_LABEL: Readonly<Record<string, string>> = { cash: "نقد عند الاستلام", daily_transfer: "تحويل يومي", credit: "آجل" };
export const CATEGORY_LABEL: Readonly<Record<string, string>> = { fruit: "فواكه", veg: "خضار", leaf: "ورقيات", dates: "تمور", mushroom: "فطر", herbs: "أعشاب" };
export type Cadence = "daily" | "weekly" | "monthly" | "on_demand";
/** «إيقاع التواصل» of a type (Odoo's «✅ اعتماد» writes it when the card carries none): an expense supplier has none. */
export const CADENCE_BY_TYPE: Readonly<Record<string, Cadence>> = { market_agent: "daily", wholesaler: "daily", distributor: "weekly", importer: "weekly", farmer: "monthly", other: "on_demand" };
export const asCadence = (v: unknown): Cadence | null => (v === "daily" || v === "weekly" || v === "monthly" || v === "on_demand" ? v : null);
export const MONTH_NAMES = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"] as const;
const asMonth = (v: unknown): string => (/^(0[1-9]|1[0-2])$/.test(String(v ?? "")) ? String(v) : "");

// ---------------------------------------------------------------- texts

export const SIGNUP_HEADING = "تسجيل مورد لدى يو تاك";
export const SIGNUP_HOW = "عبّ بيانات نشاطك، ثم «التالي» لتفاصيل نوعك، ثم «إرسال». نراجع طلبك ونتواصل معك.";
export const SIGNUP_ASK_TEXT = `حياك في يو تاك 🌿 للتسجيل كمورد اضغط «${SIGNUP_CTA}» وعبّ بيانات نشاطك وأصنافك.`;
export const SIGNUP_DONE_TEXT = "استلمنا طلبك ✅ بنراجعه ونتواصل معك 🌿";
export const SIGNUP_UPDATED_TEXT = "وصلتنا بياناتك المحدّثة ✅ شكراً لك 🌿";
export const SIGNUP_BAD_TEXT = "الاسم التجاري ونوع النشاط مطلوبان 🙏 عبّهما ثم «إرسال». لم يُحفظ شيء بعد.";
export const SIGNUP_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُحفظ منه شيء 🌿 اكتب «تسجيل مورد» لنموذج جديد.";
export const SIGNUP_USED_TEXT = "طلب تسجيلك وصلنا من قبل ✅ ولم يُسجَّل مرة ثانية. لأي تعديل اكتب «تسجيل مورد».";
export const SIGNUP_PENDING_TEXT = "طلب تسجيلك عندنا قيد المراجعة 🌿 بنتواصل معك أول ما يُعتمد.";
/** The invitation, as the template says it (scripts/lib/s65-flows.mjs SUPPLIER_INVITE) — what Baraa forwards when it cannot go. */
export const INVITE_TEXT = "بخصوص تسجيلكم كمورد لدى يو تاك: لإكمال التسجيل اكتبوا «تسجيل مورد» في هذه المحادثة وأدخلوا بيانات النشاط والأصناف وطريقة التوريد. بعد المراجعة يصلكم تأكيد الاعتماد.";
export const OFFER_READY_BUTTON = { id: "sup_offer:ready", title: "📦 بضاعتي جاهزة" } as const;
export const OFFER_SHIP_BUTTON = { id: "sup_offer:ship", title: "🚢 وصلت شحنة" } as const;
/** The welcome's buttons by type: an importer's shipment first; an expense supplier has none. */
export function welcomeButtons(type: string): Array<{ id: string; title: string }> {
  if (type === "expense") return [];
  return type === "importer" ? [OFFER_SHIP_BUTTON, OFFER_READY_BUTTON] : [OFFER_READY_BUTTON];
}
const firstName = (name: string): string => String(name || "").trim().split(/\s+/)[0] ?? "";
export function welcomeText(name: string, type: string): string {
  const what = type === "importer" ? "أول ما توصلك شحنة اضغط «🚢 وصلت شحنة»، ولأي بضاعة جاهزة «📦 بضاعتي جاهزة»"
    : type === "expense" ? "نتواصل معك هنا عند الحاجة"
      : "أول ما تجهز عندك بضاعة اضغط «📦 بضاعتي جاهزة» واكتب الصنف والكمية والسعر";
  return `مرحبا ${firstName(name)} 🌿 تم اعتمادك مورداً لدى يو تاك ✅ ${what}.`;
}

// ---------------------------------------------------------------- the keyword

const plain = (text: string): string => String(text ?? "").replace(/[‎‏⁦-⁩‪-‮]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
const SIGNUP_RE = /^(تسجيل (كـ?)?مورد|سجلني (ك)?مورد|سجلوني (ك)?مورد|(ابي|ابغي|ابغا|اريد|ودي) (اكون|اصير|اسجل) (ك)?مورد( عندكم| معكم)?)$/;
/** «تسجيل مورد», «سجلني كمورد», «أبي أكون مورد» — the whole message, nothing more. */
export const isSignupKeyword = (text: string): boolean => SIGNUP_RE.test(plain(text));

// ---------------------------------------------------------------- the card

export interface SupplierCard {
  id: number;
  name: string;
  whatsapp: string;
  customerRank: number;
  supplierRank: number;
  contactClass: string;
  state: SupplierState | null;
  type: string;
  cadence: Cadence | null;
  contactName: string;
  location: string;
  suppliedIds: number[];
  simulation: boolean;
}
const CARD_FIELDS = ["id", "name", "x_whatsapp_number", "phone", "customer_rank", "supplier_rank", "x_contact_class", STATE_FIELD, "x_supplier_type", "x_contact_cadence", "x_contact_name", "x_supplier_location", "x_supplied_product_ids", SIM_FIELD];
type CardRow = Record<string, unknown>;
const toCard = (r: CardRow): SupplierCard => ({
  id: Number(r.id), name: String(r.name || ""), whatsapp: waDigits(String(r.x_whatsapp_number || r.phone || "")),
  customerRank: Number(r.customer_rank) || 0, supplierRank: Number(r.supplier_rank) || 0, contactClass: String(r.x_contact_class || ""),
  state: asState(r[STATE_FIELD]), type: String(r.x_supplier_type || ""), cadence: asCadence(r.x_contact_cadence),
  contactName: String(r.x_contact_name || ""), location: String(r.x_supplier_location || ""),
  suppliedIds: Array.isArray(r.x_supplied_product_ids) ? (r.x_supplied_product_ids as number[]) : [], simulation: r[SIM_FIELD] === true,
});
/** The card by its id; null when it is not there (searched, never `read`: a deleted card ends quietly). */
export async function readSupplierCard(env: Env, id: number): Promise<SupplierCard | null> {
  if (!(id > 0)) return null;
  const [r] = await call<CardRow[]>(env, "res.partner", "search_read", { domain: [["id", "=", id]], fields: CARD_FIELDS, limit: 1 });
  return r ? toCard(r) : null;
}
/** The card of a number («+9665…» as the card keeps it, in «واتساب» or «الهاتف»): a card with a state first. */
export async function findCardByNumber(env: Env, e164: string): Promise<SupplierCard | null> {
  const digits = waDigits(e164);
  if (!digits) return null;
  const forms = [...new Set([e164, `+${digits}`, digits])];
  const rows = await call<CardRow[]>(env, "res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "in", forms], ["phone", "in", forms]], fields: CARD_FIELDS, order: "id asc", limit: 10,
  });
  const cards = rows.map(toCard);
  return cards.find((c) => c.state) ?? cards.find((c) => c.supplierRank > 0) ?? cards[0] ?? null;
}
/** A registered customer's card: «تسجيل مورد» is not his to send (a number Baraa has not reviewed yet may). */
export const isCustomerCard = (c: Pick<SupplierCard, "contactClass" | "customerRank" | "state" | "supplierRank"> | null): boolean =>
  !!c && !c.state && !(c.supplierRank > 0) && (c.contactClass === "customer" || c.contactClass === "personal" || c.contactClass === "team" || (c.customerRank > 0 && c.contactClass !== "unreviewed" && c.contactClass !== "supplier"));

// ---------------------------------------------------------------- flow_token

export interface SignupRecord {
  v: 1;
  token: string;
  to: string;
  /** The card the form updates; 0 = none yet (a new one is made from the reply). */
  partnerId: number;
  createdAt: number;
  /** The trial to Baraa: its card is made flagged «محاكاة», with no number. */
  test?: boolean;
  usedAt?: number;
}
export const signupKey = (token: string): string => `supsg:v1:${token}`;
export function newSignupToken(partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${SIGNUP_TOKEN_PREFIX}${partnerId}.${rand}`;
}
export async function readSignupToken(env: Env, token: string): Promise<SignupRecord | null> {
  if (!isSignupToken(token)) return null;
  try {
    const rec = JSON.parse((await env.MSG_DEDUP.get(signupKey(token))) || "null") as SignupRecord | null;
    return rec && rec.v === 1 && typeof rec.partnerId === "number" ? rec : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- the send

export function signupData(init: { trade?: string; contact?: string; location?: string } = {}, test = false): Record<string, string> {
  const mark = test ? `${SUPPLIER_TEST_MARK} — ` : "";
  return { t: `${mark}${SIGNUP_HEADING}`, how: SIGNUP_HOW, i_trade: String(init.trade ?? ""), i_contact: String(init.contact ?? ""), i_location: String(init.location ?? "") };
}
export function signupSession(text: string, token: string, data: Record<string, string>): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, 1024) },
        action: { name: "flow", parameters: { flow_message_version: "3", flow_token: token, flow_id: SIGNUP_FLOW_ID, flow_cta: SIGNUP_CTA, flow_action: "navigate", flow_action_payload: { screen: SIGNUP_FLOW_SCREEN, data } } },
      },
    },
  };
}
export interface SignupSendResult { sent: boolean; reason?: string; token?: string }
/** One registration form: the interactive message, inside the number's window only. Nothing is held. */
export async function sendSignupForm(env: Env, who: { partnerId: number; whatsapp: string }, o: { now?: number; body?: string; init?: { trade?: string; contact?: string; location?: string }; test?: boolean; ctx?: ExecutionContext } = {}): Promise<SignupSendResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  const now = o.now ?? Date.now();
  if (!o.test && isOwnerRecipient(env, to)) return { sent: false, reason: "owner" };
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const rec: SignupRecord = { v: 1, token: newSignupToken(who.partnerId), to, partnerId: who.partnerId, createdAt: now, ...(o.test ? { test: true } : {}) };
  await env.MSG_DEDUP.put(signupKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
  const res = await sendViaGateway(env, {
    purpose: o.test ? SIGNUP_TEST_PURPOSE : SIGNUP_PURPOSE, to,
    content: signupSession(`${o.test ? `${SUPPLIER_TEST_MARK} — ` : ""}${o.body ?? SIGNUP_ASK_TEXT}`, rec.token, signupData(o.init, !!o.test)),
    noHold: true, noHoldReason: "نموذج تسجيل المورد يُرسل داخل نافذة 24 ساعة فقط", ctx: o.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(signupKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token };
}

// ---------------------------------------------------------------- the reply's fields

const clean = (v: unknown, max = 120): string => String(v ?? "").replace(/[‎‏⁦-⁩‪-‮]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const digitsOf = (v: unknown): number => {
  const s = String(v ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[^\d]/g, "");
  const n = s ? Number(s) : 0;
  return n > 0 && n <= 365 ? n : 0;
};
export interface Crop { name: string; from: string; to: string }
export interface SignupParsed {
  trade: string; contact: string; type: SignupType | ""; location: string; categories: string[]; items: string; origin: string;
  method: string; pay: string; payDays: number;
  /** A farmer's crops with their months («01» … «12»); the expected quantity. */
  crops: Crop[]; cropQty: string;
  /** What the type's block was asked, as lines for «تفاصيل التسجيل». */
  detail: string[];
  /** Every item he typed anywhere on the form (the general field, the type's own). */
  itemNames: string[];
  /** The countries he typed (the origin, an importer's countries). */
  originText: string;
  shop: string; minQty: string; leadTime: string;
  problems: Array<"trade" | "type">;
}
export const FARMER_CROPS = 3;
/** What the form holds, each field cleaned; a choice only when it is one of its list. */
export function parseSignupValues(raw: Record<string, unknown>): SignupParsed {
  const pick = (v: unknown, of: Readonly<Record<string, string>>): string => (Object.prototype.hasOwnProperty.call(of, String(v ?? "")) ? String(v) : "");
  const type = (SIGNUP_TYPES as readonly string[]).includes(String(raw.stype ?? "")) ? (String(raw.stype) as SignupType) : "";
  const trade = clean(raw.trade);
  const categories = (Array.isArray(raw.cats) ? raw.cats : []).map((c) => String(c)).filter((c) => Object.prototype.hasOwnProperty.call(CATEGORY_LABEL, c));
  const items = clean(raw.items, 600);
  const origin = clean(raw.origin, 80);
  const crops: Crop[] = [];
  const detail: string[] = [];
  let extraItems = "", extraOrigin = "", shop = "", minQty = "", leadTime = "", cropQty = "";
  if (type === "farmer") {
    for (let r = 1; r <= FARMER_CROPS; r++) {
      const name = clean(raw[`f_c${r}`], 60);
      if (!name) continue;
      const from = asMonth(raw[`f_a${r}`]);
      crops.push({ name, from, to: asMonth(raw[`f_b${r}`]) || from });
    }
    cropQty = clean(raw.f_qty, 80);
    extraItems = crops.map((c) => c.name).join("، ");
    for (const c of crops) detail.push(`المحصول: ${c.name}${c.from ? ` — من ${MONTH_NAMES[Number(c.from) - 1]} إلى ${MONTH_NAMES[Number(c.to) - 1]}` : ""}`);
    if (cropQty) detail.push(`الكمية المتوقعة: ${cropQty}`);
  } else if (type === "importer") {
    extraOrigin = clean(raw.i_countries, 120); minQty = clean(raw.i_min, 60);
    const ship = clean(raw.i_ship, 120);
    if (extraOrigin) detail.push(`بلدان الاستيراد: ${extraOrigin}`);
    if (ship) detail.push(`مواعيد الشحن: ${ship}`);
    if (minQty) detail.push(`أقل كمية: ${minQty}`);
  } else if (type === "market_agent" || type === "wholesaler") {
    const p = type === "market_agent" ? "a" : "w";
    shop = clean(raw[`${p}_shop`], 60); extraItems = clean(raw[`${p}_daily`], 600);
    if (shop) detail.push(`${type === "market_agent" ? "رقم المحل أو البسطة" : "المحل أو المستودع"}: ${shop}`);
    if (extraItems) detail.push(`الأصناف اليومية: ${extraItems}`);
  } else if (type === "distributor") {
    extraItems = clean(raw.d_items, 600); minQty = clean(raw.d_min, 60); leadTime = clean(raw.d_lead, 60);
    if (extraItems) detail.push(`أصنافه المتخصصة: ${extraItems}`);
    if (minQty) detail.push(`أقل كمية: ${minQty}`);
    if (leadTime) detail.push(`مدة التجهيز: ${leadTime}`);
  } else if (type === "other") {
    const note = clean(raw.o_note, 600);
    if (note) detail.push(`نبذة: ${note}`);
  }
  const problems: SignupParsed["problems"] = [];
  if (!trade || !/[\p{L}\p{N}]/u.test(trade)) problems.push("trade");
  if (!type) problems.push("type");
  return {
    trade, contact: clean(raw.contact), type, location: clean(raw.location), categories, items, origin,
    method: pick(raw.method, METHOD_LABEL), pay: pick(raw.pay, PAY_LABEL), payDays: digitsOf(raw.pay_days),
    crops, cropQty, detail, itemNames: splitItems([items, extraItems].filter(Boolean).join("، ")), originText: [origin, extraOrigin].filter(Boolean).join("، "),
    shop, minQty, leadTime, problems,
  };
}

/** Arabic country names as a supplier writes them → ISO code (Odoo's res.country.code). */
export const COUNTRY_CODES: Readonly<Record<string, string>> = {
  "السعوديه": "SA", "سعوديه": "SA", "المملكه": "SA", "محلي": "SA", "مصر": "EG", "اليمن": "YE", "يمن": "YE", "الهند": "IN", "هند": "IN", "جنوب افريقيا": "ZA", "تركيا": "TR",
  "الاردن": "JO", "اردن": "JO", "الاكوادور": "EC", "اكوادور": "EC", "الفلبين": "PH", "فلبين": "PH", "تشيلي": "CL", "امريكا": "US", "هولندا": "NL", "اسبانيا": "ES", "الصين": "CN", "صين": "CN",
  "كينيا": "KE", "لبنان": "LB", "سوريا": "SY", "المغرب": "MA", "مغرب": "MA", "باكستان": "PK", "ايران": "IR", "استراليا": "AU", "نيوزيلندا": "NZ", "ايطاليا": "IT", "فرنسا": "FR",
  "بيرو": "PE", "البرازيل": "BR", "برازيل": "BR", "الارجنتين": "AR", "ارجنتين": "AR", "اثيوبيا": "ET", "السودان": "SD", "سودان": "SD", "الامارات": "AE", "امارات": "AE", "عمان": "OM",
  "تايلاند": "TH", "فيتنام": "VN", "سريلانكا": "LK", "اوغندا": "UG", "تنزانيا": "TZ", "المكسيك": "MX", "مكسيك": "MX", "كولومبيا": "CO", "كوستاريكا": "CR", "غواتيمالا": "GT", "تونس": "TN",
  "العراق": "IQ", "عراق": "IQ", "الكويت": "KW", "كويت": "KW", "البحرين": "BH", "بحرين": "BH", "قطر": "QA",
};
const countryKey = (s: string): string => plain(s).replace(/[ة]/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
/** The ISO codes of the countries a text names (each once), by whole names between separators. */
export function countryCodes(text: string): string[] {
  const out: string[] = [];
  for (const part of String(text ?? "").split(/[،,;؛\n\/|+]+| و(?=\s)/)) {
    const code = COUNTRY_CODES[countryKey(part)];
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}
async function countryIds(env: Env, codes: string[]): Promise<number[]> {
  if (!codes.length) return [];
  const rows = await call<Array<{ id: number }>>(env, "res.country", "search_read", { domain: [["code", "in", codes]], fields: ["id"], limit: 60 });
  return rows.map((r) => r.id);
}

export const nowOdoo = (ms: number): string => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

/**
 * The card's fields a valid form writes. `card` = the card it updates (null: a new one). The name is
 * written on a new card and on one Baraa has not reviewed; a card that already is a supplier keeps its
 * name (the trade name is the first line of «تفاصيل التسجيل»), and a card that carries a state keeps it.
 */
export function signupVals(p: SignupParsed, card: Pick<SupplierCard, "state" | "supplierRank" | "name"> | null, productIds: number[], unmatched: string[], countries: number[], now: number): Record<string, unknown> {
  const known = !!card && (!!card.state || card.supplierRank > 0);
  const location = [p.location, p.shop].filter(Boolean).join(" — ");
  const detail = [...(known && p.trade && p.trade !== card?.name ? [`الاسم التجاري: ${p.trade}`] : []), ...(p.categories.length ? [`الفئات: ${p.categories.map((c) => CATEGORY_LABEL[c]).join("، ")}`] : []), ...p.detail];
  return {
    ...(known ? {} : { name: p.trade }),
    ...(card?.state ? {} : { [STATE_FIELD]: "pending" }),
    x_supplier_type: p.type,
    x_contact_class: "supplier",
    x_review_pending: false,
    ...(p.contact ? { x_contact_name: p.contact } : {}),
    ...(location ? { x_supplier_location: location } : {}),
    ...(p.method ? { x_supply_method: p.method } : {}),
    ...(p.pay ? { x_pay_terms: p.pay } : {}),
    ...(p.pay === "credit" && p.payDays ? { x_pay_days: p.payDays } : {}),
    ...(p.minQty ? { x_min_qty_text: p.minQty } : {}),
    ...(p.leadTime ? { x_lead_time_text: p.leadTime } : {}),
    ...(productIds.length ? { x_supplied_product_ids: productIds.map((id) => [4, id]) } : {}),
    x_supplier_items_text: unmatched.join("، ") || false,
    ...(countries.length ? { x_origin_country_ids: countries.map((id) => [4, id]) } : {}),
    ...(p.originText ? { x_origin_text: p.originText } : {}),
    x_supplier_detail: detail.join("\n") || false,
    x_supplier_registered_at: nowOdoo(now),
  };
}

/** Baraa's one message about a registration. */
export function signupOwnerText(p: SignupParsed, to: string, matched: string[], unmatched: string[], isNew: boolean, test = false): string {
  return [
    `${test ? `${SUPPLIER_TEST_MARK} — ` : ""}🧑‍🌾 ${isNew ? "مورد جديد بانتظار الاعتماد" : "مورد حدّث بياناته"}: ${p.trade} (+${to})`,
    `النوع: ${TYPE_LABEL[p.type] ?? "—"} · المسؤول: ${p.contact || "—"} · الموقع: ${[p.location, p.shop].filter(Boolean).join(" — ") || "—"}`,
    `الأصناف (${matched.length} من الكتالوج): ${matched.join("، ") || "—"}${unmatched.length ? `\nغير مطابق (بقي نصاً): ${unmatched.join("، ")}` : ""}`,
    `المنشأ: ${p.originText || "—"} · التوريد: ${METHOD_LABEL[p.method] ?? "—"} · الدفع: ${PAY_LABEL[p.pay] ?? "—"}${p.pay === "credit" && p.payDays ? ` ${p.payDays} يوم` : ""}`,
    ...p.detail,
    test ? "(تجربة: البطاقة معلّمة «محاكاة» ولا تُحسب في أي رقم)" : "اعتمده من «🛒 المشتريات ← 🧑‍🌾 الموردون» («✅ اعتماد»).",
  ].join("\n");
}

async function tellOwner(env: Env, text: string): Promise<void> {
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.warn("[supplier-registry] the owner's line failed", (e as Error)?.message);
  }
}

/** A farmer's crops as «مواسم المورد» rows: one per crop with its months, never a second row of the same crop and months. */
async function writeSeasons(env: Env, partnerId: number, p: SignupParsed, idOf: Map<string, number>, simulation: boolean): Promise<number> {
  const rows = p.crops.filter((c) => c.from);
  if (!rows.length) return 0;
  const have = await call<Array<{ x_item_text: string | false; x_month_from: string | false; x_month_to: string | false }>>(env, SEASON_MODEL, "search_read", {
    domain: [["x_partner_id", "=", partnerId]], fields: ["x_item_text", "x_month_from", "x_month_to"], limit: 200,
  });
  const seen = new Set(have.map((h) => `${normName(String(h.x_item_text || ""))}|${h.x_month_from}|${h.x_month_to}`));
  const vals = rows.filter((c) => !seen.has(`${normName(c.name)}|${c.from}|${c.to}`)).map((c) => ({
    x_name: `${c.name} · ${MONTH_NAMES[Number(c.from) - 1]}–${MONTH_NAMES[Number(c.to) - 1]}`, x_partner_id: partnerId, x_product_tmpl_id: idOf.get(normName(c.name)) || false, x_item_text: c.name,
    x_month_from: c.from, x_month_to: c.to, x_expected_qty: p.cropQty || false, ...(simulation ? { [SIM_FIELD]: true } : {}),
  }));
  if (vals.length) await call<number[]>(env, SEASON_MODEL, "create", { vals_list: vals });
  return vals.length;
}

export interface SignupOutcome { action: "saved" | "updated" | "invalid" | "test" | "unknown" | "duplicate"; partnerId?: number; problems?: string[] }

/** A reply of the registration form (nfm_reply): read, checked against its token, written on ONE card, answered. */
export async function handleSignupReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, now: number = Date.now()): Promise<SignupOutcome> {
  const to = waDigits(msg.from);
  const owner = isOwnerRecipient(env, to);
  const say = async (text: string) => { await sendViaGateway(env, { purpose: owner ? SIGNUP_TEST_PURPOSE : SUPPLIER_REPLY_PURPOSE, to, content: textContent(text), ctx }); };
  const rec = await readSignupToken(env, msg.flow?.token ?? "");
  if (!rec || rec.to !== to) {
    console.warn(`[supplier-registry] reply with no token of this number from=${to.slice(-4)}`);
    await say(SIGNUP_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  const p = parseSignupValues(msg.flow?.values ?? {});
  // a field that is not valid: nothing is written, the form opens again (the token stays usable)
  if (p.problems.length) {
    const again = await sendSignupForm(env, { partnerId: rec.partnerId, whatsapp: to }, { now, body: SIGNUP_BAD_TEXT, init: { trade: p.trade, contact: p.contact, location: p.location }, test: rec.test, ctx }).catch(() => ({ sent: false }));
    if (!again.sent) await say(SIGNUP_BAD_TEXT);
    return { action: "invalid", problems: p.problems };
  }
  const claim = await claimButton(env, `supsg_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed || rec.usedAt) {
    await say(SIGNUP_USED_TEXT);
    return { action: "duplicate" };
  }
  let partnerId = 0, isNew = false;
  let matchedNames: string[] = [], unmatched: string[] = [];
  try {
    const items = await resolveItems(env, p.itemNames);
    matchedNames = items.matched.map((m) => m.name); unmatched = items.unmatched;
    const idOf = new Map(items.matched.map((m) => [normName(m.text), m.productId]));
    const countries = await countryIds(env, countryCodes(p.originText)).catch(() => [] as number[]);
    // the trial never touches Baraa's own card: its card is a new one, flagged «محاكاة», with no number
    const card = rec.test ? null : (await readSupplierCard(env, rec.partnerId)) ?? (await findCardByNumber(env, msg.from));
    const vals = signupVals(p, card, items.matched.map((m) => m.productId), unmatched, countries, now);
    if (card) {
      partnerId = card.id; isNew = !card.state;
      // a number Baraa had not reviewed leaves the customers' path with its card
      await call<boolean>(env, "res.partner", "write", { ids: [card.id], vals: { ...vals, ...(isCustomerCard(card) || card.supplierRank > 0 || card.state ? {} : { customer_rank: 0 }) } });
    } else {
      isNew = true;
      [partnerId] = await call<number[]>(env, "res.partner", "create", { vals_list: [{
        ...vals, name: rec.test ? `${SUPPLIER_TEST_MARK} ${p.trade}` : p.trade, is_company: true, customer_rank: 0,
        ...(rec.test ? { [SIM_FIELD]: true } : { x_whatsapp_number: `+${to}`, x_wa_allowed: true }),
      }] });
    }
    await writeSeasons(env, partnerId, p, idOf, !!rec.test).catch((e) => console.warn("[supplier-registry] the seasons could not be written", (e as Error)?.message));
    await env.MSG_DEDUP.put(signupKey(rec.token), JSON.stringify({ ...rec, usedAt: now, partnerId }), { expirationTtl: TOKEN_TTL });
    await finishButton(env, claim, TOKEN_TTL);
    // the closed numbers are read again at the next send: this number is a supplier's from now on
    try { const { CLOSED_KV_KEY } = await import("./price-privacy"); await env.MSG_DEDUP.delete(CLOSED_KV_KEY); } catch { /* five minutes at most */ }
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
  await say(rec.test ? `${SUPPLIER_TEST_MARK} — ${SIGNUP_DONE_TEXT}\n(تجربة: بطاقة «${p.trade}» معلّمة «محاكاة»)` : isNew ? SIGNUP_DONE_TEXT : SIGNUP_UPDATED_TEXT);
  await tellOwner(env, signupOwnerText(p, to, matchedNames, unmatched, isNew, !!rec.test));
  console.log(`[supplier-registry] signup partner=${partnerId} type=${p.type} items=${matchedNames.length}+${unmatched.length}${rec.test ? " (test)" : ""}`);
  return { action: rec.test ? "test" : isNew ? "saved" : "updated", partnerId };
}

// ---------------------------------------------------------------- the keyword's answer

/**
 * «تسجيل مورد» from a number: the form, when the number may register — not the team, not a registered
 * customer. A supplier «بانتظار الاعتماد» or «معتمد» gets the form again (he updates his card). True when
 * the message was answered here (the caller stops routing it).
 */
export async function answerSignupKeyword(env: Env, msg: Pick<NormalizedMessage, "from" | "text">, who: { team: boolean }, ctx?: ExecutionContext, now: number = Date.now()): Promise<boolean> {
  if (!isSignupKeyword(msg.text) || who.team || isOwnerRecipient(env, msg.from)) return false;
  const card = await findCardByNumber(env, msg.from);
  if (isCustomerCard(card)) return false;
  if (card?.state === "suspended") return false;
  const r = await sendSignupForm(env, { partnerId: card?.id ?? 0, whatsapp: msg.from }, { now, init: { trade: card && (card.state || card.supplierRank > 0) ? card.name : "", contact: card?.contactName ?? "", location: card?.location ?? "" }, ctx });
  if (!r.sent) console.warn(`[supplier-registry] the form could not go to …${waDigits(msg.from).slice(-4)}: ${r.reason}`);
  return r.sent;
}

// ---------------------------------------------------------------- Odoo's buttons

export const SUPPLIER_HOOK_OPS = ["invite", "welcome"] as const;
export type SupplierHookOp = (typeof SUPPLIER_HOOK_OPS)[number];
export const isSupplierHookOp = (v: string): v is SupplierHookOp => (SUPPLIER_HOOK_OPS as readonly string[]).includes(v);
export interface SupplierHookOutcome { op: SupplierHookOp; id: number; action: string; detail?: string }

/** «آخر نتيجة» on the card: what the last button did, with its Riyadh time. Never throws. */
export async function writeCardResult(env: Env, id: number, text: string, more: Record<string, unknown> = {}, now: number = Date.now()): Promise<void> {
  const hm = new Date(now + 3 * 3600_000).toISOString().slice(11, 16);
  try {
    await call<boolean>(env, "res.partner", "write", { ids: [id], vals: { ...more, x_supplier_result: `${text} — ${hm}`.slice(0, 500) } });
  } catch (e) {
    console.warn(`[supplier-registry] ${id}: the result line could not be written`, (e as Error)?.message);
  }
}

/** The first «التواصل القادم» of a cadence, from a Riyadh day: the next Sunday, the first of the next month; none for the others. */
export function nextContactAfter(cadence: Cadence | null, day: string): string | null {
  const d = new Date(`${day}T00:00:00Z`);
  if (cadence === "weekly") { const add = (7 - d.getUTCDay()) % 7 || 7; return new Date(d.getTime() + add * 86400_000).toISOString().slice(0, 10); }
  if (cadence === "monthly") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return null;
}

/** «📨 أرسل رابط التسجيل»: the form inside the number's window, the template outside it, else the text for Baraa to forward. */
export async function inviteSupplier(env: Env, id: number, ctx?: ExecutionContext, now: number = Date.now()): Promise<SupplierHookOutcome> {
  const card = await readSupplierCard(env, id);
  if (!card) return { op: "invite", id, action: "not_found" };
  if (card.simulation) { await writeCardResult(env, id, "بطاقة محاكاة: لا يُرسل منها شيء", {}, now); return { op: "invite", id, action: "simulation" }; }
  if (!card.whatsapp) { await writeCardResult(env, id, "⚠️ اكتب رقم الواتساب في البطاقة أولاً (+9665…)", {}, now); return { op: "invite", id, action: "no_number" }; }
  if (isOwnerRecipient(env, card.whatsapp)) { await writeCardResult(env, id, "⚠️ هذا رقمك أنت: لا يُرسل له رابط التسجيل", {}, now); return { op: "invite", id, action: "owner" }; }
  const claim = await claimButton(env, `sup_invite:${id}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) { await writeCardResult(env, id, "سبق إرسال الرابط اليوم: لم يُرسل مرة ثانية", {}, now); return { op: "invite", id, action: "claimed_before" }; }
  const state = card.state ? {} : { [STATE_FIELD]: "pending", x_contact_class: "supplier", x_review_pending: false };
  try {
    const form = await sendSignupForm(env, { partnerId: id, whatsapp: card.whatsapp }, { now, init: { trade: card.name, contact: card.contactName, location: card.location }, ctx });
    if (form.sent) {
      await finishButton(env, claim, DAY_TTL);
      await writeCardResult(env, id, "📨 أُرسل نموذج التسجيل (داخل نافذته)", { ...state, x_supplier_invited_at: nowOdoo(now) }, now);
      return { op: "invite", id, action: "form" };
    }
    // outside his window: the template, only while Meta holds it APPROVED and UTILITY (the gateway's rule)
    const res = await sendViaGateway(env, { purpose: SUPPLIER_INVITE_PURPOSE, to: card.whatsapp, content: { kind: "template", purpose: SUPPLIER_INVITE_PURPOSE, params: [] }, noHold: true, noHoldReason: "رابط التسجيل يُرسله براء بنفسه", ctx });
    if (gatewayDecision(res)?.action === "template") {
      await finishButton(env, claim, DAY_TTL);
      await writeCardResult(env, id, "📨 أُرسل قالب الدعوة (نافذته مغلقة): ضغطته على «تسجيل مورد» تفتح له النموذج", { ...state, x_supplier_invited_at: nowOdoo(now) }, now);
      return { op: "invite", id, action: "template" };
    }
    await releaseButton(env, claim);
    await writeCardResult(env, id, `⚠️ لم يُرسل (نافذته مغلقة والقالب غير معتمد بعد). أرسل له هذا النص بنفسك: ${INVITE_TEXT}`, state, now);
    await tellOwner(env, `📨 رابط تسجيل المورد «${card.name}» (+${card.whatsapp}) لم يُرسل: نافذته مغلقة والقالب غير معتمد بعد. أرسل له هذا النص بنفسك:\n\n${INVITE_TEXT}`);
    return { op: "invite", id, action: "text_for_owner", detail: form.reason };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

/** After «✅ اعتماد»: the first «التواصل القادم», and the welcome with his type's buttons — held until his window opens. */
export async function welcomeSupplier(env: Env, id: number, ctx?: ExecutionContext, now: number = Date.now()): Promise<SupplierHookOutcome> {
  const card = await readSupplierCard(env, id);
  if (!card) return { op: "welcome", id, action: "not_found" };
  if (card.state !== "approved") return { op: "welcome", id, action: "not_approved" };
  const next = nextContactAfter(card.cadence, riyadhDateKey(new Date(now)));
  const more: Record<string, unknown> = next ? { x_next_contact: next } : {};
  if (card.simulation) { await writeCardResult(env, id, "✅ معتمد (بطاقة محاكاة: لا يُرسل منها شيء)", more, now); return { op: "welcome", id, action: "simulation" }; }
  if (!card.whatsapp || isOwnerRecipient(env, card.whatsapp)) { await writeCardResult(env, id, "✅ معتمد — بلا رقم واتساب: لم يُرسل ترحيب", more, now); return { op: "welcome", id, action: "no_number" }; }
  // one welcome per card: a second «✅ اعتماد» (after «⛔ إيقاف») does not send it again
  const claim = await claimButton(env, `sup_welcome:${id}`, 400 * 24 * 60 * 60);
  if (!claim.claimed) { await writeCardResult(env, id, "✅ معتمد — الترحيب أُرسل من قبل", more, now); return { op: "welcome", id, action: "claimed_before" }; }
  try {
    const buttons = welcomeButtons(card.type);
    const text = welcomeText(card.name, card.type);
    const res = await sendViaGateway(env, { purpose: SUPPLIER_WELCOME_PURPOSE, to: card.whatsapp, content: buttons.length ? buttonsContent(text, buttons) : textContent(text), ctx });
    const d = gatewayDecision(res);
    if (d?.action === "session" || d?.action === "held") {
      await finishButton(env, claim, 400 * 24 * 60 * 60);
      await writeCardResult(env, id, d.action === "session" ? "✅ معتمد — أُرسل الترحيب" : "✅ معتمد — الترحيب محفوظ حتى يكتب (نافذته مغلقة)", { ...more, x_supplier_welcomed_at: nowOdoo(now) }, now);
      return { op: "welcome", id, action: d.action === "session" ? "sent" : "held" };
    }
    await releaseButton(env, claim);
    await writeCardResult(env, id, "✅ معتمد — ⚠️ الترحيب لم يُرسل", more, now);
    return { op: "welcome", id, action: "not_sent", detail: d ? d.action : "no_decision" };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

/** A button of the supplier's card: Odoo → the worker. */
export async function handleSupplierHook(env: Env, id: number, op: SupplierHookOp, ctx?: ExecutionContext, now: number = Date.now()): Promise<SupplierHookOutcome> {
  return op === "invite" ? inviteSupplier(env, id, ctx, now) : welcomeSupplier(env, id, ctx, now);
}

// ---------------------------------------------------------------- the trial to Baraa

/** ONE registration form to Baraa's own number, marked «🧪 تجربة»: inside his window, once a day. Its card is flagged «محاكاة». */
export async function sendSignupTest(env: Env, now: number = Date.now()): Promise<SignupSendResult> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `supsg_test:${SIGNUP_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const r = await sendSignupForm(env, { partnerId: 0, whatsapp: owner }, { now, test: true });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
