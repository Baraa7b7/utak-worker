// § 57 ز (2026-10-05) — the supplier's tax number, read from the pictures of his
// invoices; and his registration form when it could not be read.
//
// A supplier's bill carries 15% when his card holds a tax number
// (src/purchase-accounting.ts supplierIsVatRegistered reads res.partner.vat).
// Until now that number was typed by Baraa. Every picture of a supplier's
// invoice that reaches us is now read by Claude for the SELLER's number:
//
//   • Three arrivals. A picture a supplier sends (his own chat: it is his). The
//     purchase tax invoice of a purchase list — the receipt form's photo of § 55,
//     or the buyer's photo in the hour after «تم الشراء» (src/purchase-invoice.ts)
//     — whose suppliers are the list's. An expense's attachment
//     (src/expense-form.ts expensePhotoPosted): the bill's partner.
//   • WHO is never read for, before any download and any Claude call: a price
//     source that is not a supplier (رائد), a team member's own card, a card that
//     carries Baraa's own number, and «مشتريات السوق النقدية» (a bucket: it is
//     never given a number). A picture is read once (its media id, KV), with ONE
//     Claude call.
//   • Valid = 15 digits, the first and the last «3» (Arabic-Indic digits, spaces
//     and dashes tolerated) — and never UTAK's own number, which an invoice
//     prints as its buyer's.
//   • Whose it is, when the picture is not from his own chat: the supplier whose
//     card already holds the number read; else the one whose name is the
//     seller's name Claude read (either holds the other, normalised); with no
//     name read, the only supplier there is. A list's invoice may be a
//     cash-market seller's, an expense's vendor is whoever Baraa typed: a name
//     read that is nobody's writes NOTHING — and for a list's picture Baraa is
//     told, with the number, the name and the suppliers, while one of them still
//     has no number (when each has his own, it is another seller's invoice: the
//     buyer photographs one every day, and nothing is said).
//   • No number on his card + a valid one read: vat, «مسجل في الضريبة» and
//     «مسجّل» are written, and Baraa reads «سجّلنا الرقم الضريبي لـ … — فواتيره
//     من الآن عليها 15%». The same number: nothing at all. Another number: never
//     replaced — ONE alert with both (the same pair once a day).
//   • No number on his card and none read (Claude did not read the picture, or
//     the invoice shows no valid number): the registration form
//     (utak_supplier_register_v1; scripts/lib/s57-supplier-flow.mjs is its JSON),
//     ONCE EVER — res.partner.x_vat_ask_count becomes 1 when it went (Baraa sets
//     it back to 0 to have him asked again), and a card that says «غير مسجّل»
//     is never asked — inside his 24h window, as an interactive message: never a
//     template, never held by the gateway. His window closed: it is OWED (KV)
//     and goes with his first message. A supplier with no number of his own gets
//     none, and Baraa is told once. An expense's picture never sends it. A
//     picture that is not an invoice at all (a price list) sends nothing.
//   • The form: the official name, the commercial registration (ten digits), the
//     tax number (the same check), the tax certificate's photo, and the IBAN
//     (optional; § 52's check — one that fails is not kept and refuses nothing).
//     A field that is not valid refuses the form as a whole: one message with a
//     fresh form opened on what he typed (the same one ask), nothing written.
//     Accepted: ONE write on his card (x_legal_name, x_cr_number, the number by
//     the rule above, x_iban), the certificate as a note in his card's log, «وصل
//     ✅» to him and the summary to Baraa.
//   • The trial to Baraa («🧪 تجربة», once a day) writes nothing and reaches
//     nobody else.
//   • No price is read, kept or sent anywhere here.

import type { Env } from "./config";
import { SYSTEM_PROMPT_READ_SUPPLIER_INVOICE } from "./config";
import type { NormalizedMessage } from "./types";
import { call } from "./odoo";
import { canReadDocument, readDocumentJson } from "./claude";
import { textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { arabicDate } from "./wa-params";
import { parseVatNumber } from "./vat-ask";
import { compactIban, groupIban, ibanProblem } from "./bank-line";
import { CASH_MARKET_REF } from "./cash-market";
import { loadRoster, memberByPartner, type Roster } from "./team-roster";
import { readReceiptPhotos } from "./receipt-form";

/** utak_supplier_register_v1 at Meta (filled in once the Flow is created; a published Flow's JSON is frozen). */
export const SUPPLIER_REGISTER_FLOW_ID = "0";
export const SUPPLIER_REGISTER_FLOW_SCREEN = "SUPPLIER_REGISTER";
/** The form, and the answers to the supplier's own «إرسال». */
export const SUPPLIER_REGISTER_PURPOSE = "supplier_register_form";
/** The one trial to Baraa and its answers (his number alone). */
export const SUPPLIER_REGISTER_TEST_PURPOSE = "supplier_register_form_test";
export const SUPPLIER_REGISTER_CTA = "سجّل بياناتك";
export const SUPPLIER_REGISTER_TITLE = "تسجيل بيانات المورد";
export const SUPPLIER_REGISTER_TEST_MARK = "🧪 تجربة";
/** A Saudi commercial registration. */
export const SUPPLIER_CR_DIGITS = 10;
/** Meta's limits: a heading, a message's body. */
export const SUPPLIER_HEADING_MAX = 80;
export const SUPPLIER_BODY_MAX = 1024;
/** A name shorter than this, normalised, matches nothing (two letters are in every name). */
export const SUPPLIER_NAME_MIN = 3;
const TOKEN_TTL = 7 * 24 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
/** A picture is not read twice, and the form waits for his next message, this long. */
const MEDIA_TTL = 30 * 24 * 60 * 60;
/** Two pictures of one supplier being read at once: the minutes in which only the first may send his form (his card's count holds after them). */
const ASK_LOCK_TTL = 10 * 60;
/** Baraa is told once that a supplier has no number to send the form to. */
const ONCE_TTL = 365 * 24 * 60 * 60;

// ---------------------------------------------------------------- texts

/** Where Baraa finds the picture. */
export const WHERE_CHAT = "محادثة المورد في واتساب";
export const whereList = (listId: number): string => `قائمة الشراء #${listId}`;
export const whereExpense = (moveId: number): string => `مرفق المصروف (القيد #${moveId})`;
/** «فاتورة INV-7», or «فاتورة صورة 5 أكتوبر 2026» for an invoice whose number was not read. */
export const fromInvoice = (invoice: string, day: string): string => `فاتورة ${invoice || `صورة ${arabicDate(day)}`}`;
export const FROM_FORM = "نموذج التسجيل";
/** Baraa's line, word for word: the number is on the card, and his bills add 15% from now on. */
export const vatRegisteredText = (name: string, vat: string, from: string): string => `سجّلنا الرقم الضريبي لـ ${name}: ${vat} من ${from} — فواتيره من الآن عليها 15%`;
export function vatMismatchText(name: string, have: string, read: string, from: string, where = ""): string {
  return [
    `⚠️ رقم ضريبي لا يطابق المسجّل — ${name}`,
    `المسجّل في بطاقته: ${have}`,
    `من ${from}: ${read}`,
    ...(where ? [`الصورة: ${where}`] : []),
    "لم يُستبدل شيء. راجع بطاقة المورد في Odoo.",
  ].join("\n");
}
export function vatUnmatchedText(vat: string, nameRead: string, suppliers: string[], from: string, where: string): string {
  return [
    `⚠️ رقم ضريبي من فاتورة لم نعرف موردها — ${where}`,
    `الرقم المقروء: ${vat} (${from})`,
    `اسم البائع المقروء: ${nameRead || "لم يُقرأ"}`,
    `الموردون: ${suppliers.join("، ")}`,
    "لم يُكتب شيء. إن كان الرقم لأحدهم فاكتبه في بطاقته في Odoo.",
  ].join("\n");
}
export const vatNoNumberText = (name: string, where: string): string =>
  `ℹ️ لم يُقرأ رقم ضريبي من فاتورة ${name} (${where})، وليس له رقم واتساب نرسل له نموذج التسجيل. اكتب رقمه الضريبي في بطاقته في Odoo إن كان مسجّلاً.`;

export const SUPPLIER_REGISTER_HOW_TEXT = "عبّ بيانات منشأتك مرة واحدة، وأرفق صورة شهادة الضريبة، ثم «إرسال».";
export const SUPPLIER_REGISTER_ASK_TEXT = `📝 ${SUPPLIER_REGISTER_TITLE}\nما قدرنا نقرأ الرقم الضريبي من فاتورتك. اضغط «${SUPPLIER_REGISTER_CTA}» وعبّ: الاسم الرسمي، والسجل التجاري، والرقم الضريبي، وصورة شهادة الضريبة (والآيبان لو تحب). مرة واحدة فقط.`;
export const SUPPLIER_REGISTER_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُحفظ منه شيء.";
export const SUPPLIER_REGISTER_USED_TEXT = "بياناتك وصلتنا من قبل ✅ ولم تُسجَّل مرة ثانية. لأي تعديل اكتب لنا هنا.";
export const SUPPLIER_BAD_LEGAL_TEXT = "الاسم الرسمي مطلوب: اسم المنشأة كما في السجل التجاري.";
export const SUPPLIER_BAD_CR_TEXT = `السجل التجاري ${SUPPLIER_CR_DIGITS} أرقام.`;
export const SUPPLIER_BAD_VAT_TEXT = "الرقم الضريبي 15 رقماً يبدأ بـ 3 وينتهي بـ 3.";
export const SUPPLIER_NO_PHOTO_TEXT = "أرفق صورة شهادة الضريبة في النموذج.";
export const SUPPLIER_BAD_IBAN_TEXT = "⚠️ الآيبان اللي كتبته غير صحيح ولم نحفظه (SA ثم 22 رقماً). أرسله لنا هنا لو حبيت.";
export const SUPPLIER_OTHER_NUMBER_TEXT = "⚠️ الرقم الضريبي اللي كتبته غير المسجّل عندنا: بنراجعه ونرجع لك.";
export const SUPPLIER_CERT_FAILED_TEXT = "⚠️ صورة شهادة الضريبة ما انحفظت: أرسلها لنا هنا لو سمحت.";
/** The supplier the trial's form is headed with, and its «الاسم الرسمي» opens on — as a real one opens on his card's name. */
export const SUPPLIER_TRIAL_NAME = "مورد للتجربة";
export const SUPPLIER_TRIAL_NOTE ="(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)";

const chars = (s: string): string[] => [...String(s ?? "")];
function cut(s: string, max: number): string {
  const c = chars(s);
  return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join("");
}
/** One line, without the invisible direction marks WhatsApp copies. */
const clean = (v: unknown, max = 120): string =>
  (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
const westernDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

// ---------------------------------------------------------------- the rule

/**
 * A tax number, or null: 15 digits, the first and the last «3» — § 44's rule
 * (parseVatNumber), with the dashes a printed number is grouped by removed.
 * The ONE check of a number read from a picture and of one typed in the form.
 */
export function validVat(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  return parseVatNumber(String(raw).replace(/\p{Pd}/gu, ""));
}
/** The digits of what a card holds as its tax number (Baraa may have typed it grouped). */
const cardDigits = (vat: string): string => westernDigits(vat).replace(/\D/g, "");
/** A Saudi commercial registration: ten digits, nothing else. */
export function parseCr(raw: unknown): string | null {
  const s = westernDigits(clean(raw, 40)).replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${SUPPLIER_CR_DIGITS}}$`).test(s) ? s : null;
}
/** «الآيبان» as typed: "" when left empty, the compact IBAN when § 52's check passes (SA, 24 characters, mod 97), null when it does not. */
export function parseSupplierIban(raw: unknown): string | null {
  const typed = compactIban(westernDigits(clean(raw, 60)));
  if (!typed) return "";
  return ibanProblem(typed) ? null : typed;
}
/** A name as it is compared: letters and digits only (no space, no mark), no stretching, one spelling of the letters written two ways. */
export function normalName(s: string): string {
  return String(s ?? "").normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
}
/** «مؤسسة أحمد حسان للخضار» is «أحمد حسان»: one name holds the other. */
export function sameSupplierName(a: string, b: string): boolean {
  const x = normalName(a), y = normalName(b);
  return x.length >= SUPPLIER_NAME_MIN && y.length >= SUPPLIER_NAME_MIN && (x.includes(y) || y.includes(x));
}

// ---------------------------------------------------------------- the picture, read

export type InvoiceReading =
  /** The seller's number, as a tax number is. */
  | { status: "valid"; vat: string; name: string; invoice: string }
  /** An invoice whose seller's number was not read as one. */
  | { status: "invalid"; name: string; invoice: string }
  /** Not read at all: Claude did not answer, or not with the object asked for. */
  | { status: "failed" }
  /** Read, and it is not an invoice: nothing follows from it. */
  | { status: "not_invoice" };

/** Claude's answer, decided. `ownVat`: UTAK's own number — the buyer's on every invoice of a supplier, never his. */
export function decideReading(j: Record<string, unknown> | null, ownVat = ""): InvoiceReading {
  if (!j || typeof j.is_invoice !== "boolean") return { status: "failed" };
  if (!j.is_invoice) return { status: "not_invoice" };
  const name = clean(j.supplier_name), invoice = clean(j.invoice_number, 40);
  const vat = validVat(j.vat);
  return vat && vat !== ownVat ? { status: "valid", vat, name, invoice } : { status: "invalid", name, invoice };
}
/** ONE image or PDF read by Claude for its seller's tax number. Never throws: an unread picture is «failed». */
export async function readInvoiceVat(env: Env, file: { base64: string; mime: string }, ownVat = ""): Promise<InvoiceReading> {
  const ask = `Read the attached file and answer with the JSON object.${ownVat ? ` UTAK's own VAT number is ${ownVat}: it is the buyer's, never the answer.` : ""}`;
  return decideReading(await readDocumentJson(env, file, SYSTEM_PROMPT_READ_SUPPLIER_INVOICE, ask), ownVat);
}

// ---------------------------------------------------------------- his card

interface Card {
  id: number;
  name: string;
  legal: string;
  /** The tax number on his card, "" when it has none. */
  vat: string;
  /** How many times he was asked (the form went): one is all there is. */
  asked: number;
  notRegistered: boolean;
  supplier: boolean;
  source: boolean;
  whatsapp: string;
  ref: string;
}
const CARD_FIELDS = ["id", "name", "vat", "ref", "supplier_rank", "x_price_source", "x_whatsapp_number", "x_legal_name", "x_vat_status", "x_vat_ask_count"];
/** The cards of these partners, by id — the ones there are: an id of no card (a line with no supplier of its own) gives none. Throws on Odoo trouble. */
async function readCards(env: Env, ids: number[]): Promise<Card[]> {
  type P = { id: number; name: string | false; vat: string | false; ref: string | false; supplier_rank: number | false; x_price_source: boolean; x_whatsapp_number: string | false; x_legal_name: string | false; x_vat_status: string | false; x_vat_ask_count: number | false };
  const rows = await call<P[]>(env, "res.partner", "search_read", { domain: [["id", "in", ids]], fields: CARD_FIELDS, order: "id asc", limit: 100 });
  return rows.map((p) => ({
    id: p.id, name: clean(p.name), legal: clean(p.x_legal_name), vat: clean(p.vat, 40),
    asked: Number(p.x_vat_ask_count) || 0, notRegistered: p.x_vat_status === "not_registered",
    supplier: (Number(p.supplier_rank) || 0) > 0, source: p.x_price_source === true,
    whatsapp: String(p.x_whatsapp_number || ""), ref: String(p.ref || ""),
  }));
}
/** Is this card one a picture is never read for? */
function isOut(env: Env, c: Card, roster: Roster): boolean {
  // a price source that is not a supplier (رائد): no reading, and nothing is ever sent to him from here
  if (c.source && !c.supplier) return true;
  // a team member's own card: what he photographs is a supplier's invoice, not his
  if (memberByPartner(roster, c.id)) return true;
  // a card that carries Baraa's own number is never a supplier here
  if (isOwnerRecipient(env, c.whatsapp)) return true;
  // «مشتريات السوق النقدية»: a bucket for many sellers — it is never given one seller's number
  return c.ref === CASH_MARKET_REF;
}
/** UTAK's own tax number ("" when its card has none): never a supplier's. Throws on Odoo trouble. */
async function companyVat(env: Env): Promise<string> {
  const [c] = await call<Array<{ id: number; vat: string | false }>>(env, "res.company", "search_read", { domain: [], fields: ["id", "vat"], order: "id asc", limit: 1 });
  return validVat(c?.vat || "") ?? "";
}
/** What a valid number writes on a card that has none. */
const registeredVals = (vat: string): Record<string, unknown> => ({ vat, x_vat_registered: true, x_vat_status: "registered" });

async function tellOwner(env: Env, text: string): Promise<void> {
  const { sendOwnerAlert } = await import("./templates");
  await sendOwnerAlert(env, text);
}

// ---------------------------------------------------------------- a picture arrives

export interface VatOutcome {
  action:
    | "out" | "seen" | "no_file" | "not_picture" | "not_invoice" | "unmatched"
    | "registered" | "same" | "mismatch" | "unread"
    | "form_sent" | "form_owed" | "asked_before" | "no_number" | "form_failed" | "error";
  partnerId?: number;
  vat?: string;
}
export interface InvoicePicture {
  /** His own chat; a purchase list's tax invoice; an expense's attachment. */
  kind: "chat" | "list" | "expense";
  /** The partners it may be an invoice of. */
  partnerIds: number[];
  media: { id: string };
  /** The file, when the caller has just downloaded it. */
  file?: { base64: string; mime: string } | null;
  /** Where Baraa finds the picture. */
  where: string;
  ctx?: ExecutionContext;
}

/**
 * The supplier a picture is an invoice of, among those it may be: the one whose
 * card already holds the number read, under whatever name it is printed; else
 * the one named by the seller's name read; with none read, the only one there is.
 */
function whose(cards: Card[], vat: string, nameRead: string): Card | null {
  const holder = vat ? cards.find((c) => cardDigits(c.vat) === vat) : undefined;
  if (holder) return holder;
  if (!nameRead) return cards.length === 1 ? cards[0] : null;
  const named = cards.filter((c) => sameSupplierName(c.name, nameRead) || sameSupplierName(c.legal, nameRead));
  return named.length === 1 ? named[0] : null;
}

/**
 * ONE picture of a supplier's invoice: read once, and what follows from the
 * number on it. Never throws — whatever fails here, the picture's own path (the
 * list, the expense, the supplier's «وصلتنا») has already been answered.
 */
export async function readSupplierInvoice(env: Env, p: InvoicePicture): Promise<VatOutcome> {
  try {
    const now = Date.now();
    const roster = await loadRoster(env);
    const cards = (await readCards(env, p.partnerIds)).filter((c) => !isOut(env, c, roster));
    // nobody it may be read for: no download, no Claude call
    if (!cards.length) return { action: "out" };
    const ownVat = await companyVat(env);
    const claim = await claimButton(env, `svat_media:${p.media.id}`, MEDIA_TTL);
    if (!claim.claimed) return { action: "seen" };
    let file = p.file ?? null;
    if (!file) {
      const { downloadMedia } = await import("./supplier-pay");
      file = await downloadMedia(env, p.media.id);
    }
    // not fetched: nothing was read, and nothing says the picture «could not be read»
    if (!file) { await releaseButton(env, claim); return { action: "no_file" }; }
    await finishButton(env, claim, MEDIA_TTL);
    // a voice note, a sheet: not a picture of anything
    if (!canReadDocument(file.mime)) return { action: "not_picture" };
    const reading = await readInvoiceVat(env, file, ownVat);
    if (reading.status === "not_invoice") return { action: "not_invoice" };
    // his own chat: the picture is his. Any other: the number when a card holds it, else the seller's name, when one was read
    const card = p.kind === "chat" ? cards[0] : whose(cards, reading.status === "valid" ? reading.vat : "", reading.status === "failed" ? "" : reading.name);
    const from = fromInvoice(reading.status === "failed" ? "" : reading.invoice, riyadhDateKey(new Date(now)));
    if (!card) {
      // a list's picture with a number that is nobody's for sure (a cash-market seller's, or one of several suppliers): Baraa's
      // to decide — while a supplier of the list still has no number. When each has his own, it is another seller's: nothing to say
      if (reading.status === "valid" && p.kind === "list" && cards.some((c) => !c.vat)) {
        const told = await claimButton(env, `svat_unmatched:${reading.vat}:${p.where}`, DAY_TTL);
        if (told.claimed) { await tellOwner(env, vatUnmatchedText(reading.vat, reading.name, cards.map((c) => c.name), from, p.where)); await finishButton(env, told, DAY_TTL); }
      }
      console.log(`[supplier-vat] ${p.where}: ${reading.status} — no single supplier among ${cards.map((c) => c.id).join(",")}; nothing written`);
      return { action: "unmatched" };
    }
    if (reading.status === "valid") return await applyNumber(env, card, reading.vat, from, p.where);
    // nothing read to set beside a number he has; and an expense's vendor — whoever Baraa typed — is never sent a form
    if (card.vat || p.kind === "expense") return { action: "unread", partnerId: card.id };
    return await offerRegisterForm(env, card, { now, ctx: p.ctx, where: p.where });
  } catch (e) {
    console.warn(`[supplier-vat] ${p.where}: the picture was not handled`, (e as Error)?.message);
    return { action: "error" };
  }
}

/** A valid number against his card: written when it has none, nothing when it is the same, never replaced when it is another. */
async function applyNumber(env: Env, card: Card, vat: string, from: string, where: string): Promise<VatOutcome> {
  if (!card.vat) {
    await call(env, "res.partner", "write", { ids: [card.id], vals: registeredVals(vat) });
    console.log(`[supplier-vat] partner=${card.id}: tax number written from ${where}`);
    await tellOwner(env, vatRegisteredText(card.name, vat, from));
    return { action: "registered", partnerId: card.id, vat };
  }
  if (cardDigits(card.vat) === vat) return { action: "same", partnerId: card.id, vat };
  // the same pair, once a day: every page of the same invoice would say it again
  const told = await claimButton(env, `svat_mismatch:${card.id}:${cardDigits(card.vat)}:${vat}`, DAY_TTL);
  if (told.claimed) { await tellOwner(env, vatMismatchText(card.name, card.vat, vat, from, where)); await finishButton(env, told, DAY_TTL); }
  console.warn(`[supplier-vat] partner=${card.id}: a number read from ${where} is not his card's — not replaced`);
  return { action: "mismatch", partnerId: card.id, vat };
}

// ---------------------------------------------------------------- the three arrivals

/** The suppliers of a purchase list: its own, and each line's. None for a list that is gone or a simulation's. Throws on Odoo trouble. */
async function listSuppliers(env: Env, listId: number): Promise<number[]> {
  const [row] = await call<Array<{ id: number; x_supplier_id: [number, string] | false; x_aggregated_items: string | false; x_utak_simulation?: boolean }>>(env, "x_purchase_list", "read", {
    ids: [listId], fields: ["id", "x_supplier_id", "x_aggregated_items", "x_utak_simulation"],
  });
  // a simulation's list is test data: nothing real is written from its picture
  if (!row || row.x_utak_simulation === true) return [];
  let lines: number[] = [];
  // lines that cannot be read name no supplier: the list's own is still its supplier
  try { lines = (JSON.parse(String(row.x_aggregated_items || "[]")) as Array<{ price_supplier_id?: number | null }>).map((it) => Number(it?.price_supplier_id) || 0); } catch { lines = []; }
  return [Array.isArray(row.x_supplier_id) ? row.x_supplier_id[0] : 0, ...lines];
}
/** The purchase tax invoice just kept on a purchase list (the receipt form's photo; the buyer's photo after «تم الشراء»). Never throws. */
export async function readListInvoice(env: Env, listId: number, media: { id: string }, file: { base64: string; mime: string }, ctx?: ExecutionContext): Promise<VatOutcome> {
  let partnerIds: number[];
  try { partnerIds = await listSuppliers(env, listId); } catch (e) {
    console.warn(`[supplier-vat] list ${listId}: its suppliers could not be read`, (e as Error)?.message);
    return { action: "error" };
  }
  return readSupplierInvoice(env, { kind: "list", partnerIds, media, file, where: whereList(listId), ctx });
}
/** An expense's attachment, once its bill stands (src/expense-form.ts expensePhotoPosted): the bill's partner. Never throws. */
export async function readExpenseInvoice(env: Env, a: { partnerId: number; moveId: number; mediaId: string; mime: string }): Promise<VatOutcome> {
  return readSupplierInvoice(env, { kind: "expense", partnerIds: [a.partnerId], media: { id: a.mediaId }, where: whereExpense(a.moveId) });
}
/**
 * An image or a document a supplier sent: an invoice of his, maybe. Then the
 * form owed to him, when it still is — this picture may be the one that makes
 * it needless. Never throws.
 */
export async function supplierSentPicture(env: Env, supplier: { id: number }, from: string, media: { id: string }, ctx?: ExecutionContext): Promise<VatOutcome> {
  const out = await readSupplierInvoice(env, { kind: "chat", partnerIds: [supplier.id], media, where: WHERE_CHAT, ctx });
  await sendOwedSupplierRegisterForm(env, from, ctx);
  return out;
}

// ---------------------------------------------------------------- the form, once ever

export const supplierOwedKey = (digits: string): string => `svat_owed:v1:${digits}`;
/** A form that waits for its supplier's next message: whose it is, and the picture it is owed for. */
interface SupplierOwed { partnerId: number; where: string }

/**
 * The registration form for a supplier whose number was not read and whose
 * card has none: once ever, to his own number, inside his window — else owed
 * until his next message. Throws on Odoo trouble.
 */
async function offerRegisterForm(env: Env, card: Card, o: { now: number; ctx?: ExecutionContext; where: string }): Promise<VatOutcome> {
  // his card says he was asked, or that he is not registered: he is not asked again
  if (card.asked >= 1 || card.notRegistered) return { action: "asked_before", partnerId: card.id };
  const to = waDigits(card.whatsapp);
  if (!to) {
    const told = await claimButton(env, `svat_nonumber:${card.id}`, ONCE_TTL);
    if (told.claimed) { await tellOwner(env, vatNoNumberText(card.name, o.where)); await finishButton(env, told, ONCE_TTL); }
    return { action: "no_number", partnerId: card.id };
  }
  // two pictures of his read at the same moment both find a count of 0: one form, whichever asks first
  const once = await claimButton(env, `svat_form:${card.id}`, ASK_LOCK_TTL);
  if (!once.claimed) return { action: "asked_before", partnerId: card.id };
  const r = await sendSupplierRegisterForm(env, { partnerId: card.id, name: card.name, whatsapp: to }, { now: o.now, ctx: o.ctx, init: { legal: card.legal || card.name } });
  if (!r.sent) {
    await releaseButton(env, once);
    // anything but his window (Meta refused the form, …) is not retried with every message of his
    if (r.reason !== "window_closed") return { action: "form_failed", partnerId: card.id };
    // no template and nothing held by the gateway: it waits here for his first message
    await env.MSG_DEDUP.put(supplierOwedKey(to), JSON.stringify({ partnerId: card.id, where: o.where } satisfies SupplierOwed), { expirationTtl: MEDIA_TTL });
    return { action: "form_owed", partnerId: card.id };
  }
  await finishButton(env, once, ASK_LOCK_TTL);
  // the durable «once ever»: his card says it from now on (Baraa sets it back to 0 to have him asked again)
  try { await call(env, "res.partner", "write", { ids: [card.id], vals: { x_vat_ask_count: 1 } }); } catch (e) {
    console.warn(`[supplier-vat] partner=${card.id}: the form went, its count was not written`, (e as Error)?.message);
  }
  console.log(`[supplier-vat] partner=${card.id}: the registration form went (${o.where})`);
  return { action: "form_sent", partnerId: card.id };
}

/**
 * A supplier's message: the form owed to him goes now — unless his card got a
 * number since (an invoice read, Baraa's hand) or says he was asked. True when
 * it went. Never throws.
 */
export async function sendOwedSupplierRegisterForm(env: Env, from: string, ctx?: ExecutionContext, now: number = Date.now()): Promise<boolean> {
  const key = supplierOwedKey(waDigits(from));
  try {
    const raw = await env.MSG_DEDUP.get(key);
    const owed = raw ? (JSON.parse(raw) as SupplierOwed) : null;
    if (!owed) return false;
    const [card] = await readCards(env, [owed.partnerId]);
    // a number on his card since: nothing is owed any more
    const r: VatOutcome = card?.vat === "" ? await offerRegisterForm(env, card, { now, ctx, where: owed.where }) : { action: "same" };
    // still owed only when his window closed again
    if (r.action !== "form_owed") await env.MSG_DEDUP.delete(key);
    return r.action === "form_sent";
  } catch (e) {
    console.warn("[supplier-vat] the owed form failed", (e as Error)?.message);
    return false;
  }
}

// ---------------------------------------------------------------- flow_token

export interface SupplierToken {
  v: 1;
  token: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  partnerId: number;
  name: string;
  createdAt: number;
  /** The trial to Baraa: its reply writes nothing. */
  test?: boolean;
}
export const supplierTokenKey = (token: string): string => `sreg_t:v1:${token}`;
/** How the webhook knows a Flow's reply is this form's. */
export const isSupplierRegisterToken = (token: string): boolean => String(token ?? "").startsWith("sr1.");
export function newSupplierToken(partnerId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sr1.${partnerId}.${rand}`;
}
/** The token as it was kept when the form went; null for one that was never ours, or is gone. */
export async function readSupplierToken(env: Env, token: string): Promise<SupplierToken | null> {
  try {
    const raw = await env.MSG_DEDUP.get(supplierTokenKey(token));
    return raw ? (JSON.parse(raw) as SupplierToken) : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- the send

export interface SupplierWho { partnerId: number; name: string; whatsapp: string }
/** What the text fields open with: his card's name, or what he typed on a form that was refused. */
export interface SupplierInit { legal?: string; cr?: string; vat?: string; iban?: string }
export interface SupplierFormOpts {
  now?: number;
  /** The text above the button (a refusal's reasons): else the form's own. */
  body?: string;
  init?: SupplierInit;
  test?: boolean;
  ctx?: ExecutionContext;
}
export interface SupplierFormResult { sent: boolean; reason?: string; token?: string }

/** The screen's six keys. */
export function supplierFormData(who: Pick<SupplierWho, "name">, o: Pick<SupplierFormOpts, "init" | "test"> = {}): Record<string, string> {
  const mark = o.test ? `${SUPPLIER_REGISTER_TEST_MARK} — ` : "";
  return {
    t: cut(`${mark}${SUPPLIER_REGISTER_TITLE} — ${who.name}`, SUPPLIER_HEADING_MAX),
    how: SUPPLIER_REGISTER_HOW_TEXT,
    i_legal: o.init?.legal ?? "", i_cr: o.init?.cr ?? "", i_vat: o.init?.vat ?? "", i_iban: o.init?.iban ?? "",
  };
}
export function supplierFormSession(text: string, token: string, data: Record<string, string>): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: cut(text, SUPPLIER_BODY_MAX) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: SUPPLIER_REGISTER_FLOW_ID,
            flow_cta: SUPPLIER_REGISTER_CTA,
            flow_action: "navigate",
            flow_action_payload: { screen: SUPPLIER_REGISTER_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

/**
 * One registration form: the interactive message, inside the number's window
 * only. Nothing is held and no template is used; what could not go says why.
 * Who may get it, and how often, is the caller's (offerRegisterForm; a
 * refusal's fresh form; the trial).
 */
export async function sendSupplierRegisterForm(env: Env, who: SupplierWho, opts: SupplierFormOpts = {}): Promise<SupplierFormResult> {
  const to = waDigits(who.whatsapp);
  const now = opts.now ?? Date.now();
  // no number is no window either
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const rec: SupplierToken = { v: 1, token: newSupplierToken(who.partnerId), to, partnerId: who.partnerId, name: who.name, createdAt: now, ...(opts.test ? { test: true } : {}) };
  await env.MSG_DEDUP.put(supplierTokenKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
  const mark = opts.test ? `${SUPPLIER_REGISTER_TEST_MARK} — ` : "";
  const res = await sendViaGateway(env, {
    purpose: opts.test ? SUPPLIER_REGISTER_TEST_PURPOSE : SUPPLIER_REGISTER_PURPOSE,
    to,
    content: supplierFormSession(`${mark}${opts.body ?? SUPPLIER_REGISTER_ASK_TEXT}`, rec.token, supplierFormData(who, opts)),
    noHold: true,
    noHoldReason: "نموذج تسجيل المورد يُرسل داخل نافذة 24 ساعة فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(supplierTokenKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token };
}

// ---------------------------------------------------------------- «إرسال»

export type SupplierProblem = "legal" | "cr" | "vat" | "photo";
export interface SupplierValues {
  legal: string;
  /** "" when it is not ten digits. */
  cr: string;
  /** "" when it is not a tax number. */
  vat: string;
  /** "" left empty, null typed and not valid. */
  iban: string | null;
  photo: { id: string; mime?: string } | null;
  /** What he typed, as the fresh form of a refusal opens on it. */
  typed: Required<SupplierInit>;
  problems: SupplierProblem[];
}
/** The reply's fields, each by its one check. */
export function readSupplierValues(values: Record<string, unknown>): SupplierValues {
  const typed = { legal: clean(values.legal), cr: clean(values.cr, 40), vat: clean(values.vat, 40), iban: clean(values.iban, 60) };
  const cr = parseCr(values.cr), vat = validVat(typed.vat);
  const [photo] = readReceiptPhotos(values.photo);
  const problems: SupplierProblem[] = [
    ...(/\p{L}/u.test(typed.legal) ? [] : ["legal" as const]), ...(cr ? [] : ["cr" as const]), ...(vat ? [] : ["vat" as const]), ...(photo ? [] : ["photo" as const]),
  ];
  return { legal: typed.legal, cr: cr ?? "", vat: vat ?? "", iban: parseSupplierIban(values.iban), photo: photo ?? null, typed, problems };
}
const PROBLEM_TEXT: Record<SupplierProblem, string> = { legal: SUPPLIER_BAD_LEGAL_TEXT, cr: SUPPLIER_BAD_CR_TEXT, vat: SUPPLIER_BAD_VAT_TEXT, photo: SUPPLIER_NO_PHOTO_TEXT };
export const supplierRefusalText = (problems: SupplierProblem[]): string =>
  ["⚠️ ما انحفظ شيء من النموذج:", ...problems.map((p) => `• ${PROBLEM_TEXT[p]}`), "عبّه من جديد ثم «إرسال» 👇"].join("\n");

/** His card's tax number against the form's: none yet, the same, or another. */
type NumberCase = "new" | "same" | "other";
/** «وصل ✅» to the supplier: what was kept, and what was not. */
export function supplierDoneText(f: SupplierValues, o: { number: NumberCase; certificate: boolean }): string {
  return [
    "وصل ✅ سجّلنا بيانات منشأتك:",
    `• الاسم الرسمي: ${f.legal}`,
    `• السجل التجاري: ${f.cr}`,
    o.number === "other" ? SUPPLIER_OTHER_NUMBER_TEXT : `• الرقم الضريبي: ${f.vat}`,
    o.certificate ? "• صورة شهادة الضريبة ✅" : SUPPLIER_CERT_FAILED_TEXT,
    ...(f.iban ? [`• الآيبان: ${groupIban(f.iban)}`] : f.iban === null ? [SUPPLIER_BAD_IBAN_TEXT] : []),
  ].join("\n");
}
/** Baraa's summary of a form that was kept: the number first — his own line when it was written. */
export function supplierOwnerText(name: string, f: SupplierValues, o: { number: NumberCase; have: string; certificate: boolean }): string {
  return [
    o.number === "new" ? vatRegisteredText(name, f.vat, FROM_FORM)
      : o.number === "same" ? `📝 المورد ${name} عبّى نموذج التسجيل. رقمه الضريبي ${f.vat} يطابق المسجّل في بطاقته.`
      : vatMismatchText(name, o.have, f.vat, FROM_FORM),
    `📝 من النموذج: الاسم الرسمي «${f.legal}» · السجل التجاري ${f.cr}`,
    o.certificate ? "📎 صورة شهادة الضريبة في سجل بطاقته في Odoo." : "⚠️ تعذّر حفظ صورة شهادة الضريبة: اطلبها منه.",
    ...(f.iban ? [`الآيبان: ${groupIban(f.iban)}`] : f.iban === null ? [`⚠️ الآيبان اللي كتبه غير صحيح ولم يُحفظ: ${f.typed.iban}`] : []),
  ].join("\n");
}
/** What a trial's «إرسال» would have written, had it been a supplier's. */
export function supplierTrialText(f: SupplierValues): string {
  return [
    `${SUPPLIER_REGISTER_TEST_MARK} — وصل نموذج تسجيل المورد ✅`,
    "لو كان من مورد بلا رقم ضريبي لكُتب على بطاقته:",
    `• الاسم الرسمي: ${f.legal}`,
    `• السجل التجاري: ${f.cr}`,
    `• الرقم الضريبي: ${f.vat} («مسجّل»، وفواتيره من بعدها عليها 15%)`,
    ...(f.iban ? [`• الآيبان: ${groupIban(f.iban)}`] : f.iban === null ? [`• الآيبان «${f.typed.iban}» غير صحيح: ما كان سيُحفظ، ولا يُرفض النموذج بسببه.`] : []),
    "📸 صورة شهادة الضريبة كانت ستُرفق في سجل بطاقته.",
    SUPPLIER_TRIAL_NOTE,
  ].join("\n");
}

/** The line kept in his card's log with the certificate. */
export const certificateLogLine = (f: Pick<SupplierValues, "legal" | "cr" | "vat">): string =>
  `شهادة ضريبة القيمة المضافة من نموذج تسجيل المورد: ${f.legal} — السجل التجاري ${f.cr} — الرقم الضريبي ${f.vat}.`;
/** The certificate's photo as ONE note with the file in his card's log. False when it was not kept: his card is written whatever happens to the picture. */
async function keepCertificate(env: Env, partnerId: number, f: SupplierValues): Promise<boolean> {
  const { downloadMedia } = await import("./supplier-pay");
  const file = await downloadMedia(env, f.photo?.id ?? "");
  if (!file) return false;
  const ext = /pdf/i.test(file.mime) ? "pdf" : /png/i.test(file.mime) ? "png" : "jpg";
  try {
    const att = await call<number[]>(env, "ir.attachment", "create", { vals_list: [{ name: `شهادة-الضريبة-${partnerId}.${ext}`, raw: file.base64, mimetype: file.mime, res_model: "res.partner", res_id: partnerId }] });
    // an internal note: it is the team's record, not a message to the card's followers
    await call(env, "res.partner", "message_post", { ids: [partnerId], body: certificateLogLine(f), message_type: "comment", subtype_xmlid: "mail.mt_note", attachment_ids: att });
    return true;
  } catch (e) {
    console.warn(`[supplier-vat] partner=${partnerId}: the certificate was not kept`, (e as Error)?.message);
    return false;
  }
}

export interface SupplierRegisterOutcome {
  action: "saved" | "invalid" | "test" | "unknown" | "duplicate";
  partnerId?: number;
  number?: NumberCase;
  problems?: SupplierProblem[];
}

/** A reply of the registration form (nfm_reply): read, checked against its token, written on his card, answered. */
export async function handleSupplierRegisterReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<SupplierRegisterOutcome> {
  const to = waDigits(msg.from);
  const purpose = isOwnerRecipient(env, to) ? SUPPLIER_REGISTER_TEST_PURPOSE : SUPPLIER_REGISTER_PURPOSE;
  const say = async (text: string): Promise<void> => { await sendViaGateway(env, { purpose, to, content: textContent(text), ctx }); };
  const rec = await readSupplierToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[supplier-vat] reply with no token of this number from=${to.slice(-4)}`);
    await say(SUPPLIER_REGISTER_UNKNOWN_TEXT);
    return { action: "unknown" };
  }
  // a token is read once
  const claim = await claimButton(env, `sreg_use:${rec.token}`, TOKEN_TTL);
  if (!claim.claimed) {
    console.warn(`[supplier-vat] repeated token partner=${rec.partnerId} — not written again`);
    await say(SUPPLIER_REGISTER_USED_TEXT);
    return { action: "duplicate" };
  }
  try {
    const f = readSupplierValues(msg.flow?.values ?? {});
    // ONE bad field refuses the whole form: nothing is written, and a fresh form — the same one ask — opens on what he typed
    if (f.problems.length) {
      await finishButton(env, claim, TOKEN_TTL);
      const text = supplierRefusalText(f.problems);
      const again = await sendSupplierRegisterForm(env, { partnerId: rec.partnerId, name: rec.name, whatsapp: to }, { now: nowMs, ctx, body: text, init: f.typed, test: rec.test }).catch(() => ({ sent: false }));
      if (!again.sent) await say(text);
      return { action: "invalid", problems: f.problems };
    }
    if (rec.test) {
      await finishButton(env, claim, TOKEN_TTL);
      await say(supplierTrialText(f));
      return { action: "test" };
    }
    const [card] = await readCards(env, [rec.partnerId]);
    // the number, by the rule of a number read from a picture: written on a card that has none, never replaced
    const number: NumberCase = !card.vat ? "new" : cardDigits(card.vat) === f.vat ? "same" : "other";
    await call(env, "res.partner", "write", {
      ids: [card.id],
      vals: { x_legal_name: f.legal, x_cr_number: f.cr, ...(number === "new" ? registeredVals(f.vat) : {}), ...(f.iban ? { x_iban: f.iban } : {}) },
    });
    await finishButton(env, claim, TOKEN_TTL);
    const certificate = await keepCertificate(env, card.id, f);
    await say(supplierDoneText(f, { number, certificate }));
    await tellOwner(env, supplierOwnerText(card.name, f, { number, have: card.vat, certificate }));
    console.log(`[supplier-vat] partner=${card.id}: registration form kept (number ${number}, iban ${f.iban ? "kept" : f.iban === null ? "not valid" : "none"}, certificate ${certificate ? "kept" : "NOT kept"})`);
    return { action: "saved", partnerId: card.id, number };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- the trial to Baraa

/**
 * ONE registration form to Baraa's own number, marked «🧪 تجربة»: only while
 * his window is open (nothing held), once a day. His «إرسال» is answered with
 * what would have been written: nothing is, and nobody else is told.
 */
export async function sendSupplierRegisterFormTest(env: Env, now: number = Date.now()): Promise<SupplierFormResult> {
  const claim = await claimButton(env, `sreg_test:${SUPPLIER_REGISTER_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    // no owner's number, or his window closed: the form does not go (sendSupplierRegisterForm), and the day's trial is not spent
    const r = await sendSupplierRegisterForm(env, { partnerId: 0, name: SUPPLIER_TRIAL_NAME, whatsapp: String(env.OWNER_WHATSAPP ?? "") }, { now, test: true, init: { legal: SUPPLIER_TRIAL_NAME } });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return r;
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
