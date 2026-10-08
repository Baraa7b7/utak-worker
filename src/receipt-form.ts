// § 55 د (2026-10-05) — the buyer's receipt of the day's purchases as a WhatsApp Flow.
//
// Until § 55 the buyer (Omar: the team's `warehouse` role) closed the purchase
// list with one tap, «تم الشراء ✅»: the list was billed and owed exactly as it
// was ORDERED, whatever reached the car, and what he bought himself at the cash
// market was told apart, by «💵 دفعت لمورد». Now:
//
//   • The session forms of the purchase list (the 21:15 message's fallback, the
//     reminder's, the list sent again) carry «📥 استلام المشتريات» (prc_<list>)
//     in place of «تم الشراء ✅», and «استلام» / «استلام المشتريات» as a text
//     opens the form of his open list. The Meta template keeps its own quick
//     replies, and purchase_done_<list> does what it always did.
//   • The Flow (utak_receipt_v1; scripts/lib/s55-flows.mjs is its JSON) has two
//     screens and no endpoint: all the data goes with the message to the first.
//       RECEIPT_A «ما استلمته من الموردين»: a number field for each item of the
//         list — the first thirty — opened on the quantity ordered. Its hint:
//         the packaging, «المطلوب N», the supplier's name. NO price, cost or
//         profit of ours is in the form or in its message: § 53 keeps them from
//         an employee, and this form needs none.
//       RECEIPT_B «مشتريات السوق النقدي» (optional): five rows — the item (a
//         list of the active items), the quantity, the price he PAID for a
//         carton, the seller's name — and the tax invoice's photo. The price
//         here is his own: he types it (§ 53's exception), it goes to Baraa
//         under an owner's purpose, and it is echoed back to him alone.
//   • It goes to a `warehouse` member only, inside his 24h window only: an
//     interactive message, never a template, never held. A form that cannot go
//     (Meta refuses it, the roster cannot be read) is answered with «تم الشراء
//     ✅» as before § 55: the purchase is never blocked by the form.
//   • flow_token (rc1.…): one per send, kept in KV with the list, the items as
//     shown, the options of the rows and the number it was sent to. A reply is
//     read from it — never from the client's data — by that number, once, and
//     only while the list is open: a list already confirmed answers «مؤكدة من
//     قبل» and changes nothing.
//   • A quantity is a number ≥ 0 with at most two decimals (more than ordered is
//     taken, and reported). A cash row counts when its item is chosen; it then
//     needs a quantity, a price and a seller. ONE bad field refuses the WHOLE
//     form: nothing is written, one message names what to correct, and a fresh
//     form goes with it.
//   • «إرسال»: the received quantities go into the list's own JSON
//     (x_aggregated_items: `ordered_quantity` keeps what was ordered, written
//     once, and `total_quantity` becomes what was received), then the list is
//     confirmed by warehouseConfirmedPurchase under the lock of the «تم الشراء»
//     button — the routes, the purchase orders and vendor bills, the suppliers'
//     dues — so the bill and the due of each supplier are made from what was
//     RECEIVED with no new path. An item received 0 is on no bill and no due.
//     A confirmation that fails before the list is confirmed releases the token
//     and the lock (the same form can be sent again); one that fails after it
//     keeps the form — his cash rows, his photo — and Baraa is told.
//   • The cash rows become ONE pending supplier payment to «مشتريات السوق
//     النقدية» (createTeamPayment: cash, recorded by him, its note listing every
//     row), which Baraa approves in «💵 دفع الموردين» as he does every team
//     payment. No purchase order, no bill and no price row is made from them.
//   • The photo: the Flow's PhotoPicker. A photo in the reply is downloaded by
//     its media id and kept on the list by src/purchase-invoice.ts (the first
//     file on the list, any other as an attachment). None in the reply — or one
//     that could not be kept — opens the 60-minute window of «تم الشراء» with
//     its ask, so the photo follows as an ordinary message.
//   • He is told what was received against what was ordered, his cash rows and
//     their total, where the photo stands, and what «تم الشراء» answers today
//     (with «💵 دفعت لمورد» under it). Baraa gets ONE message when anything
//     differs or a cash row was entered, and nothing otherwise.
//   • The trial («🧪 تجربة», sendReceiptFormTest): to Baraa's own number, built
//     from the latest real purchase list, read-only. Its reply is answered with
//     what WOULD be done: nothing written, nothing confirmed, nothing downloaded.

import type { Env } from "./config";
import type { NormalizedMessage, PurchaseListItem, TeamMember } from "./types";
import type { RouterReply } from "./router";
import { call, getUnconfirmedPurchaseLists } from "./odoo";
import { buttonsContent, textContent } from "./meta";
import { gatewayDecision, isOwnerRecipient, sendViaGateway, type GwSession } from "./wa-gateway";
import { claimButton, finishButton, releaseButton, type ButtonClaim } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { arabicDate } from "./wa-params";
import { readWindow, waDigits } from "./wa-window";

/** utak_receipt_v1 at Meta (a published Flow's JSON is frozen). */
export const RECEIPT_FLOW_ID = "1581232703689366";
export const RECEIPT_FLOW_SCREEN = "RECEIPT_A";
export const RECEIPT_FLOW_CASH_SCREEN = "RECEIPT_B";
/** The quantity fields of RECEIPT_A, and the cash-market rows of RECEIPT_B. */
export const RECEIPT_FLOW_SLOTS = 30;
export const RECEIPT_CASH_ROWS = 5;
/** The photos one reply may carry (the Flow's max-uploaded-photos). */
export const RECEIPT_PHOTO_MAX = 1;
/** The gateway purpose of the form: the team's, inside the window only. */
export const RECEIPT_PURPOSE = "purchase_receipt_form";
/** The one trial to Baraa and its answers (allowed to the owner's number alone). */
export const RECEIPT_TEST_PURPOSE = "receipt_form_test";
/** What Baraa is told of a receipt: the team's note to him — an owner's purpose (src/wa-gateway.ts). */
export const RECEIPT_OWNER_PURPOSE = "owner_team_note";
/** The session button of the purchase list (Meta: a reply button's title holds 20 characters). */
export const RECEIPT_BUTTON_TITLE = "📥 استلام المشتريات";
export const RECEIPT_BUTTON_RE = /^prc_(\d+)$/;
export const receiptButton = (listId: number): { id: string; title: string } => ({ id: `prc_${listId}`, title: RECEIPT_BUTTON_TITLE });
/** The Flow's own button (Meta: 20 characters, no emoji). */
export const RECEIPT_CTA = "استلام المشتريات";
export const RECEIPT_TEST_MARK = "🧪 تجربة";
/** Meta's limits: a TextInput's label and helper text, an option's title, the options of a list, an interactive message's text. */
export const RECEIPT_LABEL_MAX = 20;
export const RECEIPT_HINT_MAX = 80;
export const RECEIPT_OPTION_MAX = 30;
export const RECEIPT_CATALOG_MAX = 200;
const BODY_MAX = 1024;
const TEXT_MAX = 3500;
/** The largest quantity a field takes (cartons), the largest price of a carton, and a seller's name. */
export const RECEIPT_QTY_MAX = 9999;
export const RECEIPT_PRICE_MAX = 100000;
export const RECEIPT_SELLER_MAX = 60;
/** An open list is looked for this far back (as the list sent again, src/team.ts). */
export const RECEIPT_OPEN_HOURS = 36;
const TOKEN_TTL = 36 * 60 * 60;
const DAY_TTL = 26 * 60 * 60;
const SIM_FIELD = "x_utak_simulation";

// ---------------------------------------------------------------- texts

export const RECEIPT_HEAD_A = "ما استلمته من الموردين";
export const RECEIPT_NOTE_A = "أكّد الكمية المستلمة لكل صنف: الخانة فيها المطلوب، عدّلها لو استلمت غيره، واكتب 0 لو ما استلمته.";
export const RECEIPT_HEAD_B = "مشتريات السوق النقدي";
export const RECEIPT_NOTE_B = "اختياري: اتركه فاضي لو ما اشتريت شي من السوق النقدي. لكل شراء: الصنف، والكمية، والسعر اللي دفعته للكرتون، واسم البائع. وصورة الفاتورة الضريبية تحت.";
export const RECEIPT_UNKNOWN_TEXT = "هذا النموذج غير صالح الآن، ولم يُسجَّل منه شيء. اكتب «استلام» ونرسل لك نموذج قائمة اليوم.";
export const RECEIPT_USED_TEXT = "هذا النموذج سبق إرساله ✅ ولم يُسجَّل مرة ثانية.";
/** A list already confirmed — the «تم الشراء» button's own answer. */
export const RECEIPT_DONE_TEXT = "القائمة مؤكدة من قبل ✅ والمسارات أُرسلت.";
export const RECEIPT_CANCELLED_TEXT = "هذه القائمة ملغاة، ولم يُسجَّل شيء.";
export const RECEIPT_NO_LIST_TEXT = "ما فيه قائمة شراء مفتوحة الآن 👍";
export const RECEIPT_NOT_ALLOWED_TEXT = "استلام المشتريات لفريق الشراء فقط.";
/** The form could not go: the list is still confirmed as before § 55. */
export const RECEIPT_FALLBACK_TEXT = "تعذّر فتح نموذج الاستلام الآن. لو استلمت كل شي كما في القائمة اضغط «تم الشراء ✅»، وإلا اكتب «استلام» بعد قليل.";
export const RECEIPT_PHOTO_SAVED_TEXT = "📸 صورة الفاتورة الضريبية وصلت مع النموذج ✅";
export const RECEIPT_PHOTO_FAILED_NOTE = "ما قدرت أحفظ صورة النموذج.";
export const RECEIPT_TEST_TAIL = "(تجربة: لم يُكتب شيء في Odoo، ولم تُؤكَّد القائمة، ولم تُنزَّل صورة)";
/** The list was confirmed, but what follows the confirmation (the routes, the bills) did not finish. */
export const RECEIPT_HALF_TEXT = "⚠️ القائمة تأكدت، لكن تعذّر إرسال المسارات الآن. وصل التنبيه لبراء.";
export const receiptHalfAlert = (listId: number, why: string): string =>
  `⚠️ قائمة الشراء #${listId}: سُجّل استلامها وتأكدت، لكن تعذّر إكمال ما بعد التأكيد (المسارات، وفواتير الموردين): ${why}. راجعها.`;
/** What «تم الشراء» answers today, word for word (src/router.ts). */
export const receiptRoutesLine = (routes: number, moved: number): string => `تمام 👍 تم إرسال المسارات لـ ${routes} سواق (${moved} توصيلة).`;

/** «استلام», «استلام المشتريات»: the whole message, nothing else in it. */
export function wantsReceiptForm(text: string): boolean {
  const t = String(text ?? "").trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[.!؟?،,\s]+$/g, "").replace(/\s+/g, " ");
  return /^استلام(?: المشتريات)?$/.test(t);
}
/** The buyer: the team's `warehouse` role. */
export function isReceiptMember(m: Pick<TeamMember, "x_role" | "x_role_codes">): boolean {
  return m.x_role === "warehouse" || !!m.x_role_codes?.includes("warehouse");
}
/** «استلام» from the buyer (any other member's «استلام» is an ordinary message). */
export const isReceiptCommand = (text: string, m: Pick<TeamMember, "x_role" | "x_role_codes">): boolean => wantsReceiptForm(text) && isReceiptMember(m);

const chars = (s: string): string[] => [...String(s ?? "")];
const cut = (s: string, max: number): string => { const c = chars(s); return c.length > max ? `${c.slice(0, max - 1).join("")}…` : c.join(""); };
const clean = (s: string): string => String(s ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
const round2 = (n: number): number => Math.round(Number(n) * 100) / 100;
/** 5 → «5», 2.50 → «2.5». */
const qty = (n: number): string => String(round2(n));
const itemsWord = (n: number): string => (n === 1 ? "صنف" : n === 2 ? "صنفان" : n >= 3 && n <= 10 ? "أصناف" : "صنفاً");
const counted = (n: number): string => (n === 1 ? "صنف واحد" : n === 2 ? "صنفان" : `${n} ${itemsWord(n)}`);
/** Halalas → "40.00". */
const money = (h: number): string => `${Math.floor(Math.round(h) / 100)}.${String(Math.round(h) % 100).padStart(2, "0")}`;
const halalas = (x: number): number => Math.round(Math.round(Number(x) * 1e6) / 1e4);
/** Names joined within a room: «أ، ب … و 3 أخرى». */
function namesWithin(names: string[], room: number): string {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    const next = out ? `${out}، ${names[i]}` : names[i];
    const left = names.length - (i + 1);
    if (i > 0 && next.length + (left ? ` … و ${left} أخرى`.length : 0) > room) return `${out} … و ${names.length - i} أخرى`;
    out = next;
  }
  return out;
}

// ---------------------------------------------------------------- the list and its items

/** A line of x_purchase_list.x_aggregated_items after a receipt: what was ordered beside what was received. */
export interface ReceivedListItem extends PurchaseListItem {
  /** The quantity as ordered, written once; from then on total_quantity is what was RECEIVED. */
  ordered_quantity?: number;
}
export interface ReceiptList {
  id: number;
  status: string;
  /** The list's day (Riyadh). */
  day: string;
  supplierId: number;
  items: ReceivedListItem[];
}
/** What was ordered of a line: kept apart once a receipt was written on it. */
export const orderedOf = (it: ReceivedListItem): number => round2(Number(it.ordered_quantity ?? it.total_quantity) || 0);
const itemKey = (productId: number, packagingId: number): string => `${productId}:${packagingId}`;
/** § 66 ج — a list's line by its item — and, for a special quotation's line, by that line alone (never told by another's quantity). */
const lineKey = (productId: number, packagingId: number, special?: number): string => `${itemKey(productId, packagingId)}${special ? `:sq${special}` : ""}`;
const itemName = (product: string, packaging: string): string => `${clean(product)}${clean(packaging) ? ` (${clean(packaging)})` : ""}`;

/** A purchase list as the form needs it. The quantities and the names only: no price of its lines is read into the form. */
export async function readReceiptList(env: Env, listId: number): Promise<ReceiptList | null> {
  const [row] = await call<Array<{ id: number; x_status: string | false; x_date: string | false; x_supplier_id: [number, string] | false; x_aggregated_items: string | false }>>(env, "x_purchase_list", "read", {
    ids: [listId], fields: ["id", "x_status", "x_date", "x_supplier_id", "x_aggregated_items"],
  });
  if (!row) return null;
  let items: ReceivedListItem[] = [];
  try { items = typeof row.x_aggregated_items === "string" && row.x_aggregated_items ? JSON.parse(row.x_aggregated_items) : []; } catch { items = []; }
  return {
    id: row.id, status: String(row.x_status || ""), day: String(row.x_date || ""),
    supplierId: Array.isArray(row.x_supplier_id) ? row.x_supplier_id[0] : 0,
    // every line as it is: the list is written back whole, so none is ever dropped here
    items: Array.isArray(items) ? items : [],
  };
}

/**
 * The supplier of each line, by name — the attribution of its bill and its due (src/purchase-accounting.ts
 * planSupplierBills): «مشتريات السوق النقدية» for a line whose purchase the market won that day, else the
 * supplier the list took the item from, else the list's own. Names only: no price is read from it.
 */
async function supplierNames(env: Env, list: ReceiptList): Promise<(it: ReceivedListItem) => string> {
  let market = new Set<string>(), cashName = "";
  try {
    const { readMarketPlan } = await import("./supplier-pay");
    const { CASH_MARKET_NAME, winnerKey } = await import("./cash-market");
    const plan = list.day ? await readMarketPlan(env, list.day) : null;
    if (plan?.cashSupplierId) {
      // § 66 ج — a special quotation's line is never the market's: its price and its source are the quotation's
      market = new Set(list.items.filter((it) => !it.special_line && plan.winners.has(winnerKey(it.product_id, it.packaging_id))).map((it) => itemKey(it.product_id, it.packaging_id)));
      cashName = CASH_MARKET_NAME;
    }
  } catch (e) {
    console.warn("[receipt-form] the day's market lines could not be read — the list's own suppliers", (e as Error)?.message);
  }
  const idOf = (it: ReceivedListItem): number => Number(it.price_supplier_id ?? 0) || list.supplierId;
  const ids = [...new Set(list.items.map(idOf).filter((n) => n > 0))];
  let names = new Map<number, string>();
  try {
    if (ids.length) {
      const rows = await call<Array<{ id: number; name: string }>>(env, "res.partner", "read", { ids, fields: ["id", "name"], context: { active_test: false } });
      names = new Map(rows.map((r) => [r.id, clean(r.name)]));
    }
  } catch (e) {
    console.warn("[receipt-form] the suppliers' names could not be read — the hints go without them", (e as Error)?.message);
  }
  return (it) => (!it.special_line && market.has(itemKey(it.product_id, it.packaging_id)) ? cashName : names.get(idOf(it)) ?? "");
}

export interface ReceiptItem {
  slot: number;
  productId: number;
  packagingId: number;
  /** § 66 ج — the order line of a special quotation's item (its key in the list); none for any other. */
  special?: number;
  /** «طماطم (كرتون)», as the messages name a line. */
  name: string;
  label: string;
  hint: string;
  /** The quantity ordered: what the field opens with. */
  ordered: number;
  supplier: string;
}
/** A slot's label — the item's name — and its hint: «كرتون · المطلوب 5 · أحمد حسان». Names and quantities, never a price. */
export function receiptSlotTexts(product: string, packaging: string, ordered: number, supplier: string): { label: string; hint: string } {
  return {
    label: cut(clean(product), RECEIPT_LABEL_MAX),
    hint: cut([clean(packaging), `المطلوب ${qty(ordered)}`, clean(supplier)].filter(Boolean).join(" · "), RECEIPT_HINT_MAX),
  };
}
/** The first thirty lines of the list on their slots; the names of the rest (taken as ordered). */
export function receiptItems(items: ReceivedListItem[], supplierOf: (it: ReceivedListItem) => string = () => ""): { shown: ReceiptItem[]; rest: string[] } {
  const shown = items.slice(0, RECEIPT_FLOW_SLOTS).map((it, i) => {
    const ordered = orderedOf(it), supplier = supplierOf(it);
    return { slot: i + 1, productId: it.product_id, packagingId: it.packaging_id, ...(it.special_line ? { special: it.special_line } : {}), name: itemName(it.product_name, it.packaging_name), ...receiptSlotTexts(it.product_name, it.packaging_name, ordered, supplier), ordered, supplier };
  });
  return { shown, rest: items.slice(RECEIPT_FLOW_SLOTS).map((it) => itemName(it.product_name, it.packaging_name)) };
}

export interface ReceiptOption { id: string; title: string; name: string }
const option = (productId: number, packagingId: number, product: string, packaging: string): ReceiptOption =>
  ({ id: itemKey(productId, packagingId), title: cut(`${clean(product)}${clean(packaging) ? ` — ${clean(packaging)}` : ""}`, RECEIPT_OPTION_MAX), name: itemName(product, packaging) });
/**
 * The options of a cash row's list: the list's own lines first (what he most likely bought), then every
 * item «نشط للبيع» with its default packaging — up to Meta's two hundred. Names only.
 */
export async function receiptCatalog(env: Env, items: ReceivedListItem[]): Promise<ReceiptOption[]> {
  const out = new Map<string, ReceiptOption>();
  // § 66 ج — a special quotation's line is no option of a cash purchase: its packaging's name is not its item's
  for (const it of items) if (!it.special_line) out.set(itemKey(it.product_id, it.packaging_id), option(it.product_id, it.packaging_id, it.product_name, it.packaging_name));
  try {
    const { readActiveItems } = await import("./pricing-engine");
    for (const a of await readActiveItems(env, [])) {
      if (!out.has(itemKey(a.productId, a.packagingId))) out.set(itemKey(a.productId, a.packagingId), option(a.productId, a.packagingId, a.productName, a.packagingName));
    }
  } catch (e) {
    console.warn("[receipt-form] the active items could not be read — the list's own items alone", (e as Error)?.message);
  }
  return [...out.values()].slice(0, RECEIPT_CATALOG_MAX);
}

export type ReceiptFormData = Record<string, string | boolean | Array<{ id: string; title: string }>>;
/** The 125 keys of RECEIPT_A: the two headings and their lines, l / h / i / v of every slot, and the rows' options. */
export function receiptFormData(heads: { t1: string; n1: string; t2: string; n2: string }, items: ReceiptItem[], catalog: ReceiptOption[], init: Record<number, string> = {}): ReceiptFormData {
  const data: ReceiptFormData = { ...heads, items: catalog.map((o) => ({ id: o.id, title: o.title })) };
  for (let n = 1; n <= RECEIPT_FLOW_SLOTS; n++) {
    const it = items.find((x) => x.slot === n);
    data[`l${n}`] = it ? it.label : "-";
    data[`h${n}`] = it ? it.hint : "-";
    data[`i${n}`] = it ? init[n] ?? qty(it.ordered) : "";
    data[`v${n}`] = !!it;
  }
  return data;
}

/** The text above the Flow's button. The lines left out of the form are named: they are taken as ordered. */
export function receiptFormText(listId: number, day: string, shown: number, rest: string[], test = false): string {
  const head = `${test ? `${RECEIPT_TEST_MARK} — ` : ""}📥 استلام مشتريات${listId ? ` قائمة الشراء #${listId}` : ""}${day ? ` (${arabicDate(day)})` : ""}: ${counted(shown)}.`;
  const how = `اضغط «${RECEIPT_CTA}»: جنب كل صنف الكمية المطلوبة، عدّلها لو استلمت غيرها (0 لو ما استلمته). بعدها «التالي» لمشتريات السوق النقدي وصورة الفاتورة الضريبية، ثم «إرسال».`;
  if (!rest.length) return `${head}\n${how}`;
  const lead = `خارج النموذج (يتسع لـ ${RECEIPT_FLOW_SLOTS}): `, tail = " — تُسجَّل كما طُلبت.";
  return `${head}\n${how}\n${lead}${namesWithin(rest, BODY_MAX - head.length - how.length - lead.length - tail.length - 2)}${tail}`;
}

// ---------------------------------------------------------------- flow_token

export interface ReceiptFormRecord {
  v: 1;
  token: string;
  /** The purchase list the form is for (0: a trial made from the active items). */
  listId: number;
  listDay: string;
  /** The number it was sent to (digits): the only one whose reply is read. */
  to: string;
  /** The member's Work Contact: the payment's «سجّلها» and the photo's window. */
  partnerId: number;
  name: string;
  /** The lines as the form showed them, and the names of the lines it had no field for. */
  items: ReceiptItem[];
  rest: string[];
  /** The options the cash rows offered: a row's item is read from here, never from the client's data. */
  catalog: ReceiptOption[];
  createdAt: number;
  /** The trial to Baraa: its reply writes nothing. */
  test?: boolean;
  usedAt?: number;
}
export const receiptFormKey = (token: string): string => `rcform:v1:${token}`;
export const isReceiptFormToken = (token: string): boolean => String(token ?? "").startsWith("rc1.");
export function newReceiptFormToken(day: string, listId: number): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `rc1.${String(day).replace(/-/g, "") || "0"}.${listId}.${rand}`;
}
export async function readReceiptFormToken(env: Env, token: string): Promise<ReceiptFormRecord | null> {
  if (!isReceiptFormToken(token)) return null;
  try {
    const raw = await env.MSG_DEDUP.get(receiptFormKey(token));
    const rec = raw ? (JSON.parse(raw) as ReceiptFormRecord) : null;
    return rec && rec.v === 1 && Array.isArray(rec.items) && Array.isArray(rec.catalog) ? rec : null;
  } catch { return null; }
}
async function writeReceiptFormToken(env: Env, rec: ReceiptFormRecord): Promise<void> {
  await env.MSG_DEDUP.put(receiptFormKey(rec.token), JSON.stringify(rec), { expirationTtl: TOKEN_TTL });
}

// ---------------------------------------------------------------- the send

export interface ReceiptWho { partnerId: number; name: string; whatsapp: string }
export interface ReceiptFormOpts {
  now?: number;
  /** The text above the button (a refused form's corrections). */
  body?: string;
  /** What the fields open with (slot → what he typed): a refused form sent again. */
  init?: Record<number, string>;
  /** The trial: the list it shows (read-only), under its own purpose. */
  test?: ReceiptList;
  ctx?: ExecutionContext;
}
export interface ReceiptFormResult { sent: boolean; reason?: string; token?: string; items?: number }

export function receiptFormSession(text: string, token: string, data: ReceiptFormData): GwSession {
  return {
    kind: "session",
    body: {
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: text.slice(0, BODY_MAX) },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: token,
            flow_id: RECEIPT_FLOW_ID,
            flow_cta: RECEIPT_CTA,
            flow_action: "navigate",
            flow_action_payload: { screen: RECEIPT_FLOW_SCREEN, data },
          },
        },
      },
    },
  };
}

/**
 * May this number get the receipt form? A `warehouse` member of the roster
 * alone — and a roster that cannot be read sends nothing.
 */
export async function receiptRecipientProblem(env: Env, digits: string): Promise<string> {
  try {
    const { loadRoster, memberByNumber } = await import("./team-roster");
    const m = memberByNumber(await loadRoster(env), digits);
    return m && m.codes.includes("warehouse") ? "" : "not_warehouse";
  } catch (e) {
    console.warn("[receipt-form] the roster could not be read — no form", (e as Error)?.message);
    return "unverified";
  }
}

/**
 * One receipt form of a purchase list: the interactive message, inside the
 * member's window only. Nothing is held and no template is used; a list that
 * is not open sends nothing.
 */
export async function sendReceiptForm(env: Env, who: ReceiptWho, listId: number, opts: ReceiptFormOpts = {}): Promise<ReceiptFormResult> {
  const to = waDigits(who.whatsapp);
  if (!to) return { sent: false, reason: "no_number" };
  const now = opts.now ?? Date.now();
  if (!opts.test) {
    const problem = await receiptRecipientProblem(env, to);
    if (problem) return { sent: false, reason: problem };
  }
  if (!(await readWindow(env, to, now)).open) return { sent: false, reason: "window_closed" };
  const list = opts.test ?? (await readReceiptList(env, listId));
  if (!list) return { sent: false, reason: "no_list" };
  // only an open list: one already confirmed (or cancelled) has nothing left to receive
  if (!opts.test && (list.status === "done" || list.status === "cancelled")) return { sent: false, reason: list.status };
  const { shown, rest } = receiptItems(list.items, await supplierNames(env, list));
  if (!shown.length) return { sent: false, reason: "no_items" };
  const catalog = await receiptCatalog(env, list.items);
  const rec: ReceiptFormRecord = {
    v: 1, token: newReceiptFormToken(list.day, list.id), listId: list.id, listDay: list.day, to, partnerId: who.partnerId, name: who.name,
    items: shown, rest, catalog, createdAt: now, ...(opts.test ? { test: true } : {}),
  };
  await writeReceiptFormToken(env, rec);
  const mark = opts.test ? `${RECEIPT_TEST_MARK} — ` : "";
  const data = receiptFormData({ t1: `${mark}${RECEIPT_HEAD_A}`, n1: RECEIPT_NOTE_A, t2: `${mark}${RECEIPT_HEAD_B}`, n2: RECEIPT_NOTE_B }, shown, catalog, opts.init ?? {});
  const res = await sendViaGateway(env, {
    purpose: opts.test ? RECEIPT_TEST_PURPOSE : RECEIPT_PURPOSE,
    to,
    content: receiptFormSession(opts.body ?? receiptFormText(list.id, list.day, shown.length, rest, !!opts.test), rec.token, data),
    noHold: true,
    noHoldReason: "نموذج استلام المشتريات يُرسل داخل نافذة 24 ساعة فقط",
    ctx: opts.ctx,
  });
  const d = gatewayDecision(res);
  if (d?.action !== "session") {
    try { await env.MSG_DEDUP.delete(receiptFormKey(rec.token)); } catch { /* expires on its own */ }
    return { sent: false, reason: d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "no_decision" };
  }
  return { sent: true, token: rec.token, items: shown.length };
}

// ---------------------------------------------------------------- when it goes

/** «تم الشراء ✅» as before § 55, under a line: a form that cannot go never blocks the purchase. */
const fallbackReply = (listId: number): RouterReply => ({ bodyBeforeButtons: RECEIPT_FALLBACK_TEXT, buttons: [{ id: `purchase_done_${listId}`, title: "تم الشراء ✅" }] });

/**
 * «📥 استلام المشتريات» (prc_<list>) from a purchase list's message: the form
 * of that list. A list already confirmed answers as the «تم الشراء» button
 * does. Never throws.
 */
export async function openReceiptForm(env: Env, listId: number, who: ReceiptWho | null, ctx?: ExecutionContext, now: number = Date.now()): Promise<RouterReply> {
  if (!who?.partnerId || !waDigits(who.whatsapp)) return { text: RECEIPT_NOT_ALLOWED_TEXT };
  try {
    const r = await sendReceiptForm(env, who, listId, { now, ctx });
    if (r.sent) return { text: "" };
    console.warn(`[receipt-form] list=${listId} partner=${who.partnerId}: no form (${r.reason})`);
    if (r.reason === "not_warehouse") return { text: RECEIPT_NOT_ALLOWED_TEXT };
    if (r.reason === "done") return { text: RECEIPT_DONE_TEXT };
    if (r.reason === "cancelled") return { text: RECEIPT_CANCELLED_TEXT };
    if (r.reason === "no_list" || r.reason === "no_items") return { text: RECEIPT_NO_LIST_TEXT };
    return fallbackReply(listId);
  } catch (e) {
    console.warn(`[receipt-form] list=${listId}: the form could not be opened`, (e as Error)?.message);
    return fallbackReply(listId);
  }
}

/** The buyer's open list: sent, not confirmed, not a simulation — the most recent of the last 36 hours. */
export async function openReceiptListId(env: Env, now: number = Date.now()): Promise<number | null> {
  const ids = await getUnconfirmedPurchaseLists(env, riyadhDateKey(new Date(now - RECEIPT_OPEN_HOURS * 3600_000)));
  return ids.length ? Math.max(...ids) : null;
}

/** «استلام» / «استلام المشتريات» from the buyer: the form of his open list, or one line when none is open. Never throws. */
export async function answerReceiptAsk(env: Env, who: ReceiptWho, ctx?: ExecutionContext, now: number = Date.now()): Promise<RouterReply> {
  try {
    const listId = await openReceiptListId(env, now);
    return listId ? await openReceiptForm(env, listId, who, ctx, now) : { text: RECEIPT_NO_LIST_TEXT };
  } catch (e) {
    console.warn("[receipt-form] «استلام» could not be answered", (e as Error)?.message);
    return { text: RECEIPT_NO_LIST_TEXT };
  }
}

// ---------------------------------------------------------------- the reply

const digitsOf = (raw: unknown): string => String(raw ?? "")
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  .replace(/٫/g, ".")
  .replace(/\s+/g, "");
/** A number with at most two decimals, as typed («3», «2.5», «٢٫٥», «2,5»); null = nothing typed. */
function typedNumber(raw: unknown): number | null | "invalid" {
  let s = digitsOf(raw);
  if (s === "") return null;
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  return round2(Number(s));
}
/** A quantity received: a number ≥ 0 with at most two decimals. An empty field is not a quantity («0» says none of it arrived). */
export function parseReceivedQty(raw: unknown): number | "invalid" {
  const n = typedNumber(raw);
  return typeof n === "number" && n <= RECEIPT_QTY_MAX ? n : "invalid";
}
/** A cash row's quantity or price: above zero, at most two decimals; null = nothing typed. */
export function parseCashNumber(raw: unknown, max: number): number | null | "invalid" {
  const n = typedNumber(raw);
  if (n === null || n === "invalid") return n;
  return n > 0 && n <= max ? n : "invalid";
}

export interface ReceiptCashRow {
  row: number;
  /** The item's name, from the token's options. */
  name: string;
  productId: number;
  packagingId: number;
  quantity: number;
  /** What he paid for a carton: his own number. */
  price: number;
  seller: string;
}
export interface ReceiptPhoto { id: string; mime?: string; name?: string }
export interface ReceiptEntries {
  received: Array<{ item: ReceiptItem; quantity: number }>;
  /** A quantity field left empty, or holding something that is not a quantity: the form is refused. */
  badQty: ReceiptItem[];
  cash: ReceiptCashRow[];
  /** A row whose item is chosen and something else is missing or not a number: the form is refused. */
  badRows: Array<{ row: number; name: string; missing: string[] }>;
  /** A row with no item but something typed: not counted (a row is read by its item), and named — never lost in silence. */
  loose: Array<{ row: number; typed: string }>;
  photos: ReceiptPhoto[];
}
const CASH_QTY = "الكمية", CASH_PRICE = "السعر المدفوع", CASH_SELLER = "اسم البائع", CASH_ITEM = "صنف غير معروف";

/** The photos of the reply: the PhotoPicker's [{ id, mime_type, file_name, sha256 }] — the ids alone are used. */
export function readReceiptPhotos(raw: unknown): ReceiptPhoto[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string" && !!(p as { id: string }).id)
    .map((p) => ({ id: String(p.id), ...(typeof p.mime_type === "string" ? { mime: p.mime_type } : {}), ...(typeof p.file_name === "string" ? { name: p.file_name } : {}) }));
}

/** Each field against the token — its items and its options, never the client's data. */
export function readReceiptValues(rec: Pick<ReceiptFormRecord, "items" | "catalog">, values: Record<string, unknown>): ReceiptEntries {
  const out: ReceiptEntries = { received: [], badQty: [], cash: [], badRows: [], loose: [], photos: readReceiptPhotos(values.photo) };
  for (const item of rec.items) {
    const v = parseReceivedQty(values[`g${item.slot}`]);
    if (v === "invalid") out.badQty.push(item);
    else out.received.push({ item, quantity: v });
  }
  for (let k = 1; k <= RECEIPT_CASH_ROWS; k++) {
    const id = String(values[`ci${k}`] ?? "").trim();
    const seller = cut(String(values[`cs${k}`] ?? "").replace(/\s+/g, " ").trim(), RECEIPT_SELLER_MAX);
    const typed = [String(values[`cq${k}`] ?? "").trim(), String(values[`cp${k}`] ?? "").trim(), seller];
    if (!id) {
      // a row with no item is no row
      if (typed.some(Boolean)) out.loose.push({ row: k, typed: typed.filter(Boolean).join(" · ") });
      continue;
    }
    const opt = rec.catalog.find((o) => o.id === id);
    const quantity = parseCashNumber(values[`cq${k}`], RECEIPT_QTY_MAX), price = parseCashNumber(values[`cp${k}`], RECEIPT_PRICE_MAX);
    const missing = [!opt ? CASH_ITEM : "", typeof quantity === "number" ? "" : CASH_QTY, typeof price === "number" ? "" : CASH_PRICE, seller ? "" : CASH_SELLER].filter(Boolean);
    if (!opt || typeof quantity !== "number" || typeof price !== "number" || !seller) { out.badRows.push({ row: k, name: opt?.name ?? "", missing }); continue; }
    const [productId, packagingId] = id.split(":").map(Number);
    out.cash.push({ row: k, name: opt.name, productId, packagingId, quantity, price, seller });
  }
  return out;
}

/** What a refused form is answered with: what to correct, by name. */
export function receiptRefusalText(e: Pick<ReceiptEntries, "badQty" | "badRows" | "cash">, fresh: boolean): string {
  const lines = [
    "⚠️ ما سُجّل شيء من النموذج. صحّح التالي وأرسله من جديد:",
    e.badQty.length ? `• الكمية المستلمة لازم رقم (0 لو ما استلمت الصنف): ${namesWithin(e.badQty.map((i) => i.name), 400)}` : "",
    ...e.badRows.map((r) => `• سطر السوق ${r.row}${r.name ? ` (${r.name})` : ""}: ناقص ${r.missing.join("، ")}`),
    e.badRows.length ? "(السطر اللي فيه صنف لازم له كمية وسعر مدفوع أكبر من صفر واسم البائع)" : "",
    fresh ? `هذا نموذج جديد بالكميات اللي كتبتها${e.cash.length || e.badRows.length ? "، ومشتريات السوق النقدي تُكتب من جديد" : ""} 👇` : "اكتب «استلام» ونرسل لك نموذجاً جديداً.",
  ];
  return lines.filter(Boolean).join("\n");
}

export interface ReceivedLine { name: string; ordered: number; received: number; supplier: string }
const isDiff = (l: ReceivedLine): boolean => Math.abs(l.received - l.ordered) > 0.0001;
const diffNote = (l: ReceivedLine): string => (l.received === 0 ? "لم يُستلم" : l.received < l.ordered ? `ناقص ${qty(l.ordered - l.received)}` : `زيادة ${qty(l.received - l.ordered)}`);
/** «• طماطم (كرتون): المطلوب 5 ← المستلم 3 (ناقص 2)» — and the supplier's name for Baraa. */
export const receivedLineText = (l: ReceivedLine, withSupplier = false): string =>
  `• ${l.name}: المطلوب ${qty(l.ordered)} ← المستلم ${qty(l.received)} (${diffNote(l)})${withSupplier && l.supplier ? ` — ${l.supplier}` : ""}`;
const cashH = (r: ReceiptCashRow): number => halalas(r.quantity * r.price);
export const cashTotalH = (rows: ReceiptCashRow[]): number => rows.reduce((s, r) => s + cashH(r), 0);
/** «• طماطم (كرتون) × 2 بسعر 20 = 40.00 ر.س — البائع: أبو فهد»: his own numbers. */
export const cashRowText = (r: ReceiptCashRow): string => `• ${r.name} × ${qty(r.quantity)} بسعر ${qty(r.price)} = ${money(cashH(r))} ر.س — البائع: ${r.seller}`;
const looseText = (l: ReceiptEntries["loose"][number]): string => `⚠️ سطر السوق ${l.row} بلا صنف: ما انحسب (${l.typed}).`;

/** The note of the cash-market payment: every row as he entered it. */
export function cashPaymentNote(listId: number, rows: ReceiptCashRow[]): string {
  return [`مشتريات السوق النقدي — نموذج استلام قائمة الشراء #${listId}:`, ...rows.map(cashRowText), `المجموع: ${money(cashTotalH(rows))} ر.س`].join("\n");
}

/** The received quantities against the list as it stands now: a line of the form by its item, any other line as ordered. */
export function receivedLines(items: ReceivedListItem[], received: ReceiptEntries["received"], supplierOf: (it: ReceivedListItem) => string = () => ""): { next: ReceivedListItem[]; lines: ReceivedLine[] } {
  const got = new Map(received.map((r) => [lineKey(r.item.productId, r.item.packagingId, r.item.special), r.quantity]));
  const lines: ReceivedLine[] = [];
  const next = items.map((it) => {
    const ordered = orderedOf(it);
    const quantity = got.get(lineKey(it.product_id, it.packaging_id, it.special_line)) ?? ordered;
    lines.push({ name: itemName(it.product_name, it.packaging_name), ordered, received: quantity, supplier: supplierOf(it) });
    // what was ordered is written once; total_quantity is what the bill and the due are made from
    return { ...it, ordered_quantity: ordered, total_quantity: quantity };
  });
  return { next, lines };
}

export type CashOutcome = { ref: string } | { failed: string } | null;
export interface ReceiptSummary {
  listId: number;
  day: string;
  member: string;
  lines: ReceivedLine[];
  cash: ReceiptCashRow[];
  loose: ReceiptEntries["loose"];
  payment: CashOutcome;
}
const titled = (s: Pick<ReceiptSummary, "listId" | "day">): string => `${s.listId ? `قائمة الشراء #${s.listId}` : "القائمة"}${s.day ? ` (${arabicDate(s.day)})` : ""}`;
const paymentNote = (p: CashOutcome, to: "member" | "owner"): string => (!p ? "" : "ref" in p
  ? (to === "owner" ? ` — الدفعة ${p.ref} بانتظار اعتمادك في UTAK ← 💵 دفع الموردين.` : ` — سُجّلت الدفعة ${p.ref} بانتظار اعتماد براء.`)
  : (to === "owner" ? `\n⚠️ لم تُسجَّل دفعتها (${p.failed}): سجّلها من UTAK ← 💵 دفع الموردين.` : "\n⚠️ ما قدرت أسجّل دفعتها الآن، ووصلت تفاصيلها لبراء."));

/** What the buyer is told of his own form: each difference, his cash rows and their total. */
export function receiptMemberText(s: ReceiptSummary): string {
  const diffs = s.lines.filter(isDiff), same = s.lines.length - diffs.length;
  return [
    `📥 سُجّل استلام ${titled(s)}:`,
    ...(diffs.length ? [...diffs.map((l) => receivedLineText(l)), same ? `• والباقي (${counted(same)}) كما طُلب.` : ""] : [`كل الأصناف (${s.lines.length}) استُلمت كما طُلبت ✅`]),
    ...(s.cash.length ? ["🛒 مشتريات السوق النقدي:", ...s.cash.map(cashRowText), `المجموع: ${money(cashTotalH(s.cash))} ر.س${paymentNote(s.payment, "member")}`] : []),
    ...s.loose.map((l) => `${looseText(l)} أرسله لبراء، أو سجّله من «💵 دفعت لمورد».`),
  ].filter(Boolean).join("\n");
}

/** Does Baraa hear of this receipt? Only when something differs from the order, or the cash market was used. */
export const receiptNeedsOwner = (s: Pick<ReceiptSummary, "lines" | "cash" | "loose">): boolean => s.lines.some(isDiff) || s.cash.length > 0 || s.loose.length > 0;
/** Baraa's one message: each difference with its supplier, and the cash rows as the buyer entered them. */
export function receiptOwnerText(s: ReceiptSummary): string {
  const diffs = s.lines.filter(isDiff);
  return [
    `📥 استلام مشتريات — ${titled(s)} من ${s.member}:`,
    ...(diffs.length ? ["فروقات الاستلام:", ...diffs.map((l) => receivedLineText(l, true)), "فاتورة كل مورد ومستحقه يُحسبان بالكميات المستلمة."] : ["كل الأصناف استُلمت كما طُلبت."]),
    ...(s.cash.length ? ["🛒 مشتريات السوق النقدي (كما أدخلها):", ...s.cash.map(cashRowText), `المجموع: ${money(cashTotalH(s.cash))} ر.س${paymentNote(s.payment, "owner")}`] : []),
    ...s.loose.map(looseText),
  ].join("\n");
}

/** The received quantities into the list's own JSON (no other field of a line is touched). */
async function writeReceived(env: Env, list: ReceiptList, received: ReceiptEntries["received"]): Promise<ReceivedLine[]> {
  const { next, lines } = receivedLines(list.items, received, await supplierNames(env, list));
  await call(env, "x_purchase_list", "write", { ids: [list.id], vals: { x_aggregated_items: JSON.stringify(next) } });
  return lines;
}

/** The cash rows: ONE pending payment to «مشتريات السوق النقدية», recorded by him, its note listing every row. Never throws. */
async function recordCashRows(env: Env, rec: ReceiptFormRecord, rows: ReceiptCashRow[], wamid: string): Promise<CashOutcome> {
  if (!rows.length) return null;
  try {
    const { findCashMarketSupplier, CASH_MARKET_NAME } = await import("./cash-market");
    const cash = await findCashMarketSupplier(env);
    if (!cash) return { failed: `لا شريك «${CASH_MARKET_NAME}»` };
    const { createTeamPayment } = await import("./supplier-pay");
    const p = await createTeamPayment(env, { supplierId: cash.id, amountH: cashTotalH(rows), member: { id: rec.partnerId, name: rec.name }, note: cashPaymentNote(rec.listId, rows), wamid });
    return { ref: p.ref };
  } catch (e) {
    console.error(`[receipt-form] list=${rec.listId}: the cash-market payment failed`, (e as Error)?.message);
    return { failed: "تعذّر الحفظ في Odoo" };
  }
}

/** A photo of the reply as it was downloaded: § 57 ز reads its seller's tax number once the buyer is answered. */
interface KeptPhoto { id: string; file: { base64: string; mime: string } }
/**
 * The tax invoice's photo(s) of the reply: each downloaded by its media id and
 * kept on the list. None in the reply, or one that could not be kept: the
 * 60-minute window of «تم الشراء» is opened, and its ask follows. Never throws.
 */
async function keepPhotos(env: Env, rec: ReceiptFormRecord, photos: ReceiptPhoto[], nowMs: number): Promise<{ saved: number; awaited: boolean; kept: KeptPhoto[] }> {
  // as many as the Flow's picker takes, never more
  const wanted = photos.slice(0, Math.max(1, RECEIPT_PHOTO_MAX));
  let saved = 0;
  const kept: KeptPhoto[] = [];
  for (const p of wanted) {
    try {
      const { downloadMedia } = await import("./supplier-pay");
      const file = await downloadMedia(env, p.id);
      if (!file) continue;
      const { storePurchaseInvoiceFile } = await import("./purchase-invoice");
      if (await storePurchaseInvoiceFile(env, rec.listId, file, { nowMs })) saved++;
      kept.push({ id: p.id, file });
    } catch (e) {
      console.warn(`[receipt-form] list=${rec.listId}: the form's photo was not kept`, (e as Error)?.message);
    }
  }
  const awaited = saved < Math.max(1, wanted.length);
  if (awaited) {
    const { openPurchaseInvoiceWindow } = await import("./purchase-invoice");
    await openPurchaseInvoiceWindow(env, rec.partnerId, rec.listId, nowMs);
  }
  return { saved, awaited, kept };
}

/** A long text on line boundaries, within a text message's room. */
function parts(text: string, room: number = TEXT_MAX): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > room) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${line}` : line.slice(0, room);
  }
  if (cur) out.push(cur);
  return out;
}

export interface ReceiptOutcome {
  action: "received" | "refused" | "test" | "unknown" | "duplicate" | "done_before" | "cancelled";
  listId?: number;
  payment?: string;
  photos?: number;
}

/** A reply of the receipt form (nfm_reply): read by its token, checked whole, written on the list, confirmed, answered. */
export async function handleReceiptFormReply(env: Env, msg: Pick<NormalizedMessage, "from" | "messageId" | "flow">, ctx?: ExecutionContext, nowMs: number = Date.now()): Promise<ReceiptOutcome> {
  const to = waDigits(msg.from);
  const owner = isOwnerRecipient(env, to);
  const say = async (content: GwSession): Promise<void> => { await sendViaGateway(env, { purpose: owner ? RECEIPT_TEST_PURPOSE : "bot_reply", to, content, ctx }); };
  const rec = await readReceiptFormToken(env, msg.flow?.token ?? "");
  // an unknown token, or one sent to another number: nothing is read from it
  if (!rec || rec.to !== to) {
    console.warn(`[receipt-form] reply with no token of this number from=${to.slice(-4)}`);
    await say(textContent(RECEIPT_UNKNOWN_TEXT));
    return { action: "unknown" };
  }
  const who: ReceiptWho = { partnerId: rec.partnerId, name: rec.name, whatsapp: to };
  const entries = readReceiptValues(rec, msg.flow?.values ?? {});
  const bad = entries.badQty.length > 0 || entries.badRows.length > 0;
  if (rec.test) {
    await say(textContent(receiptTestAnswer(rec, entries)));
    return { action: "test", listId: rec.listId };
  }
  // a token is read once
  const use = await claimButton(env, `rcform_use:${rec.token}`, TOKEN_TTL);
  if (!use.claimed || rec.usedAt) {
    console.warn(`[receipt-form] repeated token list=${rec.listId} — not written again`);
    await say(textContent(RECEIPT_USED_TEXT));
    return { action: "duplicate", listId: rec.listId };
  }
  let lock: ButtonClaim | null = null;
  let lines: ReceivedLine[] = [];
  let routes = 0, moved = 0;
  let halfDone = "";
  try {
    const list = await readReceiptList(env, rec.listId);
    // only while the list is open: one already confirmed (or cancelled) is not touched
    if (!list || list.status === "done" || list.status === "cancelled") {
      await releaseButton(env, use);
      console.warn(`[receipt-form] list=${rec.listId} is ${list?.status ?? "gone"} — nothing written`);
      await say(textContent(!list ? RECEIPT_UNKNOWN_TEXT : list.status === "done" ? RECEIPT_DONE_TEXT : RECEIPT_CANCELLED_TEXT));
      return { action: !list ? "unknown" : list.status === "done" ? "done_before" : "cancelled", listId: rec.listId };
    }
    // ONE bad field refuses the whole form: nothing is written, and a fresh form goes with what to correct
    if (bad) {
      await releaseButton(env, use);
      console.warn(`[receipt-form] list=${rec.listId} refused: ${entries.badQty.length} quantity field(s), ${entries.badRows.length} cash row(s) — nothing written`);
      const init: Record<number, string> = Object.fromEntries(entries.received.map((r) => [r.item.slot, qty(r.quantity)]));
      const again = await sendReceiptForm(env, who, rec.listId, { now: nowMs, init, body: receiptRefusalText(entries, true), ctx }).catch(() => ({ sent: false }));
      if (!again.sent) await say(textContent(receiptRefusalText(entries, false)));
      return { action: "refused", listId: rec.listId };
    }
    // the lock of the «تم الشراء» button: one confirmation a list, whichever way it comes
    lock = await claimButton(env, `purchase_done:${rec.listId}`);
    if (!lock.claimed) {
      await releaseButton(env, use);
      console.warn(`[receipt-form] list=${rec.listId} is being confirmed by another tap — nothing written`);
      await say(textContent(RECEIPT_DONE_TEXT));
      return { action: "done_before", listId: rec.listId };
    }
    lines = await writeReceived(env, list, entries.received);
    // exactly what the «تم الشراء» tap does, once: the routes, the purchase orders and bills, the dues
    const { warehouseConfirmedPurchase } = await import("./team");
    try {
      const done = await warehouseConfirmedPurchase(env, rec.listId);
      routes = done.routesDispatched; moved = done.ordersMoved;
    } catch (e) {
      // It failed part-way. The list not confirmed: nothing is done yet — the locks go, and the same form
      // can be sent again. Confirmed (the failure came after it): the form is not lost — his cash rows and
      // his photo are still kept below, and Baraa is told what did not finish.
      const after = await readReceiptList(env, rec.listId).catch(() => null);
      if (after?.status !== "done") throw e;
      halfDone = (e as Error)?.message || "خطأ غير معروف";
      console.error(`[receipt-form] list=${rec.listId} confirmed, but the confirmation did not finish`, halfDone);
    }
    await finishButton(env, lock);
    await finishButton(env, use, TOKEN_TTL);
  } catch (e) {
    if (lock) await releaseButton(env, lock);
    await releaseButton(env, use);
    throw e;
  }
  try { await writeReceiptFormToken(env, { ...rec, usedAt: nowMs }); } catch { /* the claim holds */ }
  await env.MSG_DEDUP.delete(`pending_purchase_issue:${rec.partnerId}`).catch(() => {});
  // from here the list is confirmed: nothing below may lose what he entered
  const payment = await recordCashRows(env, rec, entries.cash, msg.messageId);
  const photo = await keepPhotos(env, rec, entries.photos, nowMs);
  const summary: ReceiptSummary = { listId: rec.listId, day: rec.listDay, member: rec.name, lines, cash: entries.cash, loose: entries.loose, payment };
  try {
    const { PINV_ASK_TEXT } = await import("./purchase-invoice");
    const { startButton } = await import("./supplier-pay");
    const photoLine = !photo.awaited ? RECEIPT_PHOTO_SAVED_TEXT : entries.photos.length ? `${RECEIPT_PHOTO_FAILED_NOTE} ${PINV_ASK_TEXT}` : PINV_ASK_TEXT;
    const detail = receiptMemberText(summary), tail = `${halfDone ? RECEIPT_HALF_TEXT : receiptRoutesLine(routes, moved)}\n${photoLine}`;
    if (detail.length + tail.length + 1 > BODY_MAX) {
      // longer than an interactive message's text: what was received as plain text, then the answer of «تم الشراء» with its button
      for (const p of parts(detail)) await say(textContent(p));
      await say(buttonsContent(tail, [startButton()]));
    } else await say(buttonsContent(`${detail}\n${tail}`, [startButton()]));
  } catch (e) {
    console.warn(`[receipt-form] list=${rec.listId}: the buyer's answer failed`, (e as Error)?.message);
  }
  if (receiptNeedsOwner(summary)) {
    const { sendOwnerMessage } = await import("./templates");
    for (const p of parts(receiptOwnerText(summary))) await sendOwnerMessage(env, p, RECEIPT_OWNER_PURPOSE);
  }
  if (halfDone) {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, receiptHalfAlert(rec.listId, halfDone));
  }
  // § 57 ز — the invoice just kept on the list: its seller's tax number is read for his card, after every
  // answer above (a reading takes seconds, never throws, and no price is read from it)
  for (const k of photo.kept) await (await import("./supplier-vat")).readListInvoice(env, rec.listId, { id: k.id }, k.file, ctx);
  console.log(`[receipt-form] list=${rec.listId} received by partner=${rec.partnerId}: ${lines.filter(isDiff).length} difference(s), ${entries.cash.length} cash row(s), photo ${photo.saved}/${entries.photos.length}`);
  return { action: "received", listId: rec.listId, ...(payment && "ref" in payment ? { payment: payment.ref } : {}), photos: photo.saved };
}

// ---------------------------------------------------------------- the trial to Baraa

/** The trial's answer: what the form WOULD do — nothing is written, confirmed or downloaded. */
export function receiptTestAnswer(rec: ReceiptFormRecord, e: ReceiptEntries): string {
  if (e.badQty.length || e.badRows.length) {
    return [`${RECEIPT_TEST_MARK} — كان النموذج سيُرفض كاملاً، ويصل نموذج جديد:`, receiptRefusalText(e, false).split("\n").slice(1, -1).join("\n"), RECEIPT_TEST_TAIL].join("\n");
  }
  // the lines the form had no field for are taken as ordered: never a difference
  const lines: ReceivedLine[] = [
    ...e.received.map((r) => ({ name: r.item.name, ordered: r.item.ordered, received: r.quantity, supplier: r.item.supplier })),
    ...rec.rest.map((name) => ({ name, ordered: 1, received: 1, supplier: "" })),
  ];
  const s: ReceiptSummary = { listId: rec.listId, day: rec.listDay, member: rec.name, lines, cash: e.cash, loose: e.loose, payment: null };
  return [
    `${RECEIPT_TEST_MARK} — ${receiptMemberText(s).replace("📥 سُجّل استلام", "📥 كان سيُسجَّل استلام")}`,
    e.cash.length ? "وكانت ستُسجَّل دفعة نقدية واحدة لـ «مشتريات السوق النقدية» بانتظار اعتمادك في 💵 دفع الموردين." : "",
    e.photos.length ? "📸 مع النموذج صورة: كانت ستُحفظ على قائمة الشراء." : "📸 بلا صورة: كان سيُطلب إرسالها رسالة عادية خلال 60 دقيقة.",
    "ثم تُؤكَّد القائمة كما يفعل «تم الشراء»: المسارات، وفاتورة كل مورد ومستحقه بالكميات المستلمة.",
    RECEIPT_TEST_TAIL,
  ].filter(Boolean).join("\n");
}

/**
 * ONE receipt form to Baraa's own number, marked «🧪 تجربة»: only while his
 * window is open (nothing held), once a day. Its items are the latest real
 * purchase list's (read-only); with none, the active items at a quantity of 1.
 * His reply is answered and writes nothing.
 */
export async function sendReceiptFormTest(env: Env, now: number = Date.now()): Promise<ReceiptFormResult & { listId?: number }> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return { sent: false, reason: "no_owner" };
  if (!(await readWindow(env, owner, now)).open) return { sent: false, reason: "window_closed" };
  const claim = await claimButton(env, `rcform_test:${RECEIPT_FLOW_ID}:${riyadhDateKey(new Date(now))}`, DAY_TTL);
  if (!claim.claimed) return { sent: false, reason: "already_today" };
  try {
    const lists = await call<Array<{ id: number }>>(env, "x_purchase_list", "search_read", {
      domain: [[SIM_FIELD, "!=", true]], fields: ["id"], order: "id desc", limit: 5,
    });
    let test: ReceiptList | null = null;
    for (const l of lists) {
      const list = await readReceiptList(env, l.id);
      if (list?.items.length) { test = list; break; }
    }
    if (!test) {
      // no real list yet: the active items show the form (a trial writes nothing)
      const { readActiveItems } = await import("./pricing-engine");
      const items = (await readActiveItems(env, [])).map((a) => ({ product_id: a.productId, product_name: a.productName, packaging_id: a.packagingId, packaging_name: a.packagingName, total_quantity: 1, order_ids: [] }));
      test = { id: 0, status: "sent", day: riyadhDateKey(new Date(now)), supplierId: 0, items };
    }
    if (!test.items.length) { await releaseButton(env, claim); return { sent: false, reason: "no_items" }; }
    const r = await sendReceiptForm(env, { partnerId: 0, name: "براء", whatsapp: owner }, test.id, { now, test });
    if (!r.sent) { await releaseButton(env, claim); return r; }
    await finishButton(env, claim, DAY_TTL);
    return { ...r, listId: test.id };
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}
