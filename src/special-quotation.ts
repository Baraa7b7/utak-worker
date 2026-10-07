// § 62 ج (2026-10-07) — the quotation of «طلب أسعار خاص».
//
// «📄 أصدر عرض السعر» issues the document. § 62 د: «⬇️ PDF لي فقط» (which issued it
// to Baraa alone) gave its place to «👁️ معاينة PDF» — previewSpecialQuotation: the
// same page as a DRAFT in the browser, with no number, no sale order, no seal, no
// change of the request and no message (src/quote-preview.ts serves it).
//
//   • Never with a line that has no final price (or no quantity): the request
//     is answered with the names of those lines, and nothing is recorded.
//   • It is recorded in Odoo as an ordinary quotation of the customer — a draft
//     sale.order with the request's lines at their final, VAT-inclusive prices
//     — and its number is that order's (the numbering of the manual quotation,
//     src/sale-order-quotation.ts). Issued again while that order is still a
//     quotation: the same order and number, its lines brought up to date (a
//     line that left the request gets quantity 0; nothing is deleted).
//   • The PDF is the manual quotation's (generateQuotationPDF): each line with
//     its unit, its final price and its total, «العرض ساري حتى …» from the
//     request's «صالح حتى», the bank-transfer line and the company's data.
//   • To the customer it is an ATTACHED FILE (§ 59 د): inside his 24h window
//     the document with «مرفق عرض السعر رقم … صالح حتى …»; outside it the
//     template utak_quotation_pdf_v2 ONLY when «صالح حتى» does not pass 06:00
//     of tomorrow (the template's own words promise that hour) — otherwise the
//     file reaches Baraa to send himself, and he is told so. Never held.
//   • § 62 د — «شكل العرض»: a request whose every quantity is 1 (or «أسعار الوحدة»)
//     prints ONE unit's price per line — before VAT, its VAT, with it — and no
//     quantity, no line total and no totals (quotationLayout).
//
// The customer's send goes under customer_quotation: the gateway refuses it for
// a price source's or a supplier's number (src/price-privacy.ts).

import type { Env } from "./config";
import { call } from "./odoo";
import { documentContent, pdfFileName } from "./meta";
import { gatewayDecision, sendViaGateway, type HeaderMedia } from "./wa-gateway";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { riyadhDateKey } from "./hours";
import { readWindow, waDigits } from "./wa-window";
import { arabicDate } from "./wa-params";
import { money, round2, VAT_FACTOR, VAT_RATE, type PriceMode } from "./special-quote-math";
import { QUOTE_MODEL, finalsOf, nowOdoo, quoteName, readQuote, recalcQuote, writeResult, type SpecialQuote } from "./special-quote";
import { itemDetail, type QuotationPDFData } from "./quotation";

export const OWNER_SPECIAL_PURPOSE = "owner_special_quote";
const ISSUE_LOCK_SECONDS = 90;
const RIYADH_MS = 3 * 3600_000;

type M2O = [number, string] | number | false | undefined;
const m2oId = (v: M2O): number => (Array.isArray(v) ? Number(v[0]) || 0 : Number(v) || 0);

/** Odoo's UTC «YYYY-MM-DD HH:MM:SS» → ms; NaN when it is not one. */
export const odooMs = (s: string): number => Date.parse(`${String(s || "").replace(" ", "T")}Z`);
/** «8 أكتوبر 2026 الساعة 23:59» (Riyadh). Empty when the request carries none. */
export function validUntilText(validUntil: string): string {
  const ms = odooMs(validUntil);
  if (!Number.isFinite(ms)) return "";
  const r = new Date(ms + RIYADH_MS).toISOString();
  return `${arabicDate(r.slice(0, 10))} الساعة ${r.slice(11, 16)}`;
}
/** 06:00 (Riyadh) of the day after `now`: the hour utak_quotation_pdf_v2's words promise. */
export function sixTomorrowMs(now: number): number {
  return Date.parse(`${riyadhDateKey(new Date(now + 24 * 3600_000))}T06:00:00+03:00`);
}
/** Outside the window the template may carry the file only when «صالح حتى» does not pass 06:00 of tomorrow. */
export function templateFits(validUntil: string, now: number): boolean {
  const ms = odooMs(validUntil);
  return Number.isFinite(ms) && ms > now && ms <= sixTomorrowMs(now);
}
/** The line the customer reads with the file. */
export const customerCaption = (number: string, validUntil: string): string => {
  const until = validUntilText(validUntil);
  return `مرفق عرض السعر رقم ${number}${until ? ` صالح حتى ${until}` : ""}`;
};
/** The closing line of every special quotation (the addition to § 62 ج). */
export const CLOSING_LINE = "الأسعار المذكورة هي أسعار اليوم، وقد تتغير في الأيام التالية تبعاً لتغيرات أسعار السوق. يُرجى تأكيد الطلب لتثبيت الأسعار.";
export const VAT_INCLUSIVE_NOTE = "الأسعار شاملة ضريبة القيمة المضافة.";
/** The names of a before-VAT quotation's totals. */
export const NET_SUBTOTAL_LABEL = "المجموع قبل الضريبة";
export const NET_VAT_LABEL = "ضريبة القيمة المضافة 15%";
export const ALTERNATIVES_LABEL = "خيارات بديلة";
/**
 * The quotation's note under its totals: the request's own validity (not the
 * day's 06:00), «الأسعار شاملة …» only when its prices are, and the closing
 * line last.
 */
export const quotationNote = (validUntil: string, mode: PriceMode = "gross", layout: "unit" | "qty" = "qty"): string => {
  const until = validUntilText(validUntil);
  // a unit-price quotation prints each price before the VAT and with it: no «الأسعار شاملة …» to add
  return `${until ? `العرض ساري حتى ${until}. ` : ""}${mode === "gross" && layout !== "unit" ? `${VAT_INCLUSIVE_NOTE} ` : ""}${CLOSING_LINE}`;
};
/** § 62 د — what stands in a preview's number place. */
export const DRAFT_NUMBER = "مسودة";
/**
 * § 62 د — «شكل العرض»: «أسعار الوحدة» and «بالكميات» as chosen; «تلقائي» is unit prices when the request has
 * lines and the quantity of every one of them is 1 (a price list, not an order), else by quantities.
 */
export function quotationLayout(q: Pick<SpecialQuote, "layout" | "lines">): "unit" | "qty" {
  if (q.layout === "unit" || q.layout === "qty") return q.layout;
  return q.lines.length > 0 && q.lines.every((l) => l.qty === 1) ? "unit" : "qty";
}

/** The lines a quotation cannot be issued with: no final price, or no quantity. */
export function missingLines(q: Pick<SpecialQuote, "lines">): { noPrice: string[]; noQty: string[] } {
  return {
    noPrice: q.lines.filter((l) => !(l.finalPrice > 0)).map((l) => l.productName || "صنف"),
    noQty: q.lines.filter((l) => l.finalPrice > 0 && !(l.qty > 0)).map((l) => l.productName || "صنف"),
  };
}

export interface QuotationCustomer { name: string; address: string; phone: string }
/**
 * The PDF's data, by «الأسعار في العرض»:
 *   • «قبل الضريبة» (the default): each line at its final price BEFORE VAT (the
 *     one Baraa typed; the VAT-inclusive final ÷ 1.15), then «المجموع قبل
 *     الضريبة», «ضريبة القيمة المضافة 15%» on it and «الإجمالي» — every number
 *     made of the printed ones, so the page adds up to the halala;
 *   • «شاملة الضريبة»: each line at its VAT-inclusive final price, the total
 *     split as the tax invoice will split it.
 * Under the table «خيارات بديلة» as typed; the closing line ends the note.
 */
export function specialQuotationData(q: SpecialQuote, number: string, customer: QuotationCustomer, now: number, opts: { issued?: boolean; draft?: boolean } = {}): QuotationPDFData {
  const net = q.priceMode === "net";
  const unit = quotationLayout(q) === "unit";
  const items = q.lines.map((l) => {
    const price = net ? l.finalNet : l.finalPrice;
    const detail = itemDetail(l.origin, l.size);
    return {
      name: l.productName || "صنف", pack: l.unit, qty: l.qty, price, total: round2(l.qty * price),
      // § 62 د — one unit's two final prices as the request holds them, and the VAT between them: they add up to the halala
      ...(unit ? { net: l.finalNet, vat: round2(l.finalPrice - l.finalNet), gross: l.finalPrice } : {}),
      ...(detail ? { detail } : {}),
    };
  });
  const lines = round2(items.reduce((s, i) => s + i.total, 0));
  const vatAmount = net ? round2(lines * VAT_RATE) : round2(lines - lines / VAT_FACTOR);
  const grandTotal = net ? round2(lines + vatAmount) : lines;
  return {
    quotationNumber: number, quotationDate: new Date(now), customer, items,
    subtotal: net ? lines : round2(lines - vatAmount), discount: 0, vatAmount, grandTotal, vatInclusive: !net,
    price_warnings: [], has_blocking_issue: false, is_manual: true, customer_id: q.partnerId,
    footerNote: quotationNote(q.validUntil, q.priceMode, unit ? "unit" : "qty"), issued: opts.draft ? false : opts.issued ?? true,
    ...(unit ? { layout: "unit" as const } : {}),
    ...(opts.draft ? { draft: true } : {}),
    ...(net ? { totals: { subtotalLabel: NET_SUBTOTAL_LABEL, vatLabel: NET_VAT_LABEL, hideDiscount: true } } : {}),
    ...(q.alternatives ? { belowTable: { label: ALTERNATIVES_LABEL, text: q.alternatives } } : {}),
  };
}

/**
 * The request as an ordinary quotation of the customer in Odoo: a draft
 * sale.order. Returns its id and its number. Throws on Odoo trouble (nothing is
 * sent with a quotation that is not on record).
 */
export async function recordSaleQuotation(env: Env, q: SpecialQuote, now: number = Date.now()): Promise<{ id: number; number: string; created: boolean }> {
  const tmplIds = [...new Set(q.lines.map((l) => l.productId).filter((id) => id > 0))];
  const variants = await call<Array<{ id: number; product_tmpl_id: M2O }>>(env, "product.product", "search_read", {
    domain: [["product_tmpl_id", "in", tmplIds]], fields: ["id", "product_tmpl_id"], order: "id asc", limit: 500, context: { active_test: false },
  });
  const variantOf = new Map<number, number>();
  for (const v of variants) if (!variantOf.has(m2oId(v.product_tmpl_id))) variantOf.set(m2oId(v.product_tmpl_id), v.id);
  const lost = q.lines.filter((l) => !variantOf.has(l.productId)).map((l) => l.productName);
  if (lost.length) throw new Error(`لا منتج في Odoo للصنف: ${lost.join("، ")}`);
  const validMs = odooMs(q.validUntil);
  const head: Record<string, unknown> = { origin: quoteName(q.id), ...(Number.isFinite(validMs) ? { validity_date: riyadhDateKey(new Date(validMs)) } : {}) };
  // the final price is VAT-inclusive: the company's own price-included sale tax, named on every line (as the day's orders do)
  let taxIds: number[] | null = null;
  try {
    const { resolveSaleTaxForDate } = await import("./accounting");
    const tax = await resolveSaleTaxForDate(env, riyadhDateKey(new Date(now)));
    taxIds = tax ? [tax.id] : null;
  } catch (e) {
    console.warn(`[special-quotation] ${q.id}: the sale tax could not be resolved — the product's own taxes apply`, (e as Error)?.message);
  }
  const lineVals = (l: SpecialQuote["lines"][number]) => ({
    product_id: variantOf.get(l.productId)!, name: l.productName || "صنف", product_uom_qty: l.qty, price_unit: l.finalPrice, sequence: l.sequence || 10,
    // § 62 د — «المنشأ» and «المقاس» go with the line (emptied when the request's are)
    x_item_origin: l.origin || false, x_item_size: l.size || false,
    // § 64 — and «التعبئة» as the request writes it: the sale order prints the same words (src/sale-order-quotation.ts)
    x_pack_text: l.unit || false,
    ...(taxIds ? { tax_ids: [[6, 0, taxIds]] } : {}),
  });

  if (q.saleOrderId) {
    // searched, not read: an order deleted in Odoo is simply not there (a new quotation is made)
    const [so] = await call<Array<{ id: number; name: string; state: string; order_line: number[] }>>(env, "sale.order", "search_read", { domain: [["id", "=", q.saleOrderId]], fields: ["id", "name", "state", "order_line"], limit: 1 });
    // still a quotation: the same order, its lines brought up to date in place
    if (so && (so.state === "draft" || so.state === "sent")) {
      const old = so.order_line?.length ? await call<Array<{ id: number; product_id: M2O }>>(env, "sale.order.line", "read", { ids: so.order_line, fields: ["id", "product_id"] }) : [];
      const free = [...old];
      const commands: unknown[] = [];
      for (const l of q.lines) {
        const i = free.findIndex((o) => m2oId(o.product_id) === variantOf.get(l.productId));
        if (i >= 0) commands.push([1, free.splice(i, 1)[0].id, lineVals(l)]);
        else commands.push([0, 0, lineVals(l)]);
      }
      // a line that left the request: quantity 0 (nothing is deleted) — and price 0: on a sale order a line with
      // no quantity and a price is a «خيار بديل» (src/sale-order-quotation.ts), which a removed line is not
      for (const o of free) commands.push([1, o.id, { product_uom_qty: 0, price_unit: 0 }]);
      await call<boolean>(env, "sale.order", "write", { ids: [so.id], vals: { ...head, order_line: commands } });
      return { id: so.id, number: String(so.name), created: false };
    }
  }
  // a create Odoo may have run before a 5xx is probed for, never sent twice (src/odoo.ts)
  const [id] = await call<number[]>(env, "sale.order", "create", { vals_list: [{ partner_id: q.partnerId, ...head, order_line: q.lines.map((l) => [0, 0, lineVals(l)]) }] },
    { probe: [["origin", "=", quoteName(q.id)], ["partner_id", "=", q.partnerId], ["state", "=", "draft"], ["id", ">", q.saleOrderId || 0]] });
  const [made] = await call<Array<{ id: number; name: string }>>(env, "sale.order", "read", { ids: [id], fields: ["id", "name"] });
  return { id, number: String(made?.name || `S-${id}`), created: true };
}

export interface IssueResult {
  action: "issued" | "refused" | "busy" | "not_found";
  detail?: string;
  number?: string;
  /** How the file went: to the customer (inside his window / by the template), or to Baraa (the customer could not be reached). */
  to?: "customer_session" | "customer_template" | "owner_instead";
  pdfUrl?: string;
}

async function ownerText(env: Env, text: string): Promise<void> {
  try {
    const { sendOwnerAlert } = await import("./templates");
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.error("[special-quotation] owner alert failed", (e as Error)?.message);
  }
}
/** The file to Baraa's own number: the document inside his window, held for it otherwise (the link is in the text either way). */
async function fileToOwner(env: Env, url: string, number: string, caption: string, ctx?: ExecutionContext): Promise<void> {
  const owner = waDigits(String(env.OWNER_WHATSAPP ?? ""));
  if (!owner) return;
  try {
    await sendViaGateway(env, { purpose: OWNER_SPECIAL_PURPOSE, to: owner, content: documentContent(url, number, caption), ctx });
  } catch (e) {
    console.warn("[special-quotation] the file to the owner failed", (e as Error)?.message);
  }
}

/** The customer's block of the quotation, from his card. */
async function readCustomer(env: Env, q: Pick<SpecialQuote, "partnerId" | "partnerName">): Promise<QuotationCustomer> {
  const [partner] = await call<Array<{ id: number; name: string | false; phone: string | false; x_whatsapp_number: string | false; street: string | false; city: string | false }>>(env, "res.partner", "read", {
    ids: [q.partnerId], fields: ["id", "name", "phone", "x_whatsapp_number", "street", "city"],
  });
  return {
    name: String(partner?.name || q.partnerName || "عميل"),
    address: [partner?.street, partner?.city].filter((p): p is string => typeof p === "string" && p.length > 0).join(", ") || "الرياض",
    phone: String(partner?.x_whatsapp_number || partner?.phone || ""),
  };
}

export type PreviewResult = { pdf: Uint8Array; name: string } | { refused: string } | null;
/**
 * § 62 د — «👁️ معاينة PDF»: the quotation as it would be issued now, as a DRAFT. Reads the request and the
 * customer; WRITES NOTHING (no recalculation is saved, no sale order, no number, no state, no «آخر نتيجة») and
 * sends nothing. Refused with its reason for what issuing refuses (a line with no final price or no quantity);
 * null when the request is not there.
 */
export async function previewSpecialQuotation(env: Env, quoteId: number, now: number = Date.now()): Promise<PreviewResult> {
  const read = await readQuote(env, quoteId);
  if (!read) return null;
  // the two final prices of every line as a save would leave them (the typed one, and the other following it)
  const q: SpecialQuote = { ...read, lines: read.lines.map((l) => ({ ...l, ...finalsOf(l, read.priceMode) })) };
  if (!q.partnerId) return { refused: "لا عميل على الطلب" };
  if (!q.lines.length) return { refused: "لا أصناف في الطلب" };
  const miss = missingLines(q);
  if (miss.noPrice.length) return { refused: `أسطر بلا سعر نهائي: ${miss.noPrice.join("، ")}` };
  if (miss.noQty.length) return { refused: `أسطر بلا كمية: ${miss.noQty.join("، ")}` };
  const data = specialQuotationData(q, DRAFT_NUMBER, await readCustomer(env, q), now, { draft: true });
  const { generateQuotationPDF } = await import("./quotation");
  return { pdf: await generateQuotationPDF(data, env), name: quoteName(quoteId) };
}

/**
 * Issue the request's quotation: recorded in Odoo, its PDF built and kept, the
 * file sent — to the customer, or (a customer who cannot be reached by the
 * rules above) to Baraa.
 */
export async function issueSpecialQuotation(env: Env, quoteId: number, opts: { now?: number; ctx?: ExecutionContext } = {}): Promise<IssueResult> {
  const now = opts.now ?? Date.now();
  const lock = await claimButton(env, `spq_issue:${quoteId}`, ISSUE_LOCK_SECONDS);
  if (!lock.claimed) return { action: "busy", detail: "pressed a moment ago" };
  try {
    if (!(await recalcQuote(env, quoteId, { now }))) { await releaseButton(env, lock); return { action: "not_found" }; }
    const q = (await readQuote(env, quoteId))!;
    const refuse = async (why: string, tell = false): Promise<IssueResult> => {
      await writeResult(env, quoteId, `🚫 لم يصدر عرض السعر: ${why}`, now);
      if (tell) await ownerText(env, `🚫 عرض سعر الطلب الخاص ${quoteName(quoteId)} (${q.partnerName || "—"}) لم يصدر: ${why}`);
      await releaseButton(env, lock);
      return { action: "refused", detail: why };
    };
    if (q.simulation) return refuse("الطلب محاكاة");
    if (q.state === "closed") return refuse("الطلب مغلق");
    if (!q.partnerId) return refuse("لا عميل على الطلب");
    if (!q.lines.length) return refuse("لا أصناف في الطلب");
    const miss = missingLines(q);
    if (miss.noPrice.length) return refuse(`أسطر بلا سعر نهائي: ${miss.noPrice.join("، ")}`, true);
    if (miss.noQty.length) return refuse(`أسطر بلا كمية: ${miss.noQty.join("، ")}`, true);

    const so = await recordSaleQuotation(env, q, now);
    // on the request at once: a PDF that fails after this never leaves an order nobody points at (the next press finds it)
    await call<boolean>(env, QUOTE_MODEL, "write", { ids: [quoteId], vals: { x_sale_order_id: so.id, x_quotation_number: so.number } });
    const customer = await readCustomer(env, q);
    const phone = customer.phone;
    const data = specialQuotationData(q, so.number, customer, now);
    const { generateQuotationPDF, uploadQuotationToR2, quotationTemplateParams, QUOTATION_PDF_V2_PURPOSE } = await import("./quotation");
    const pdf = await generateQuotationPDF(data, env);
    const uploaded = await uploadQuotationToR2(env, pdf, so.number, env.WORKER_ORIGIN);
    await call<boolean>(env, QUOTE_MODEL, "write", { ids: [quoteId], vals: { x_pdf_url: uploaded.publicUrl, x_issued_at: nowOdoo(now), x_state: "quoted" } });

    const caption = customerCaption(so.number, q.validUntil);
    // § 62 د — a unit-price quotation has no total: the sum of one unit of every line means nothing
    const unit = data.layout === "unit";
    const total = unit ? `أسعار الوحدة لـ ${data.items.length} صنف (بلا إجمالي)` : `الإجمالي ${money(data.grandTotal)} ريال شامل الضريبة${q.priceMode === "net" ? ` (${money(data.subtotal)} قبلها)` : ""}`;
    const ownerCaption = (why: string): string => [`📄 عرض السعر رقم ${so.number} — ${customer.name}`, total, why, uploaded.publicUrl].join("\n");
    let to: IssueResult["to"];
    let line: string;
    {
      const digits = waDigits(phone);
      const open = digits ? (await readWindow(env, digits, now)).open : false;
      // the template's words carry «بإجمالي … ريال»: never for a unit-price quotation, which has none
      const fits = !unit && templateFits(q.validUntil, now);
      let sent: "session" | "template" | null = null;
      let why = !digits ? "العميل بلا رقم واتساب" : "";
      if (digits && (open || fits)) {
        const header: HeaderMedia = { type: "document", link: uploaded.publicUrl, filename: pdfFileName(so.number) };
        const d = gatewayDecision(await sendViaGateway(env, {
          purpose: "customer_quotation", to: digits, content: documentContent(uploaded.publicUrl, so.number, caption),
          // the template's words say «سارية حتى الساعة 6:00 صباحاً من اليوم التالي»: only a validity inside that hour
          fallback: fits ? [{ kind: "template", purpose: QUOTATION_PDF_V2_PURPOSE, params: quotationTemplateParams(data, arabicDate(riyadhDateKey(new Date(now)))), header }] : [],
          noHold: true, noHoldReason: "عرض سعر الطلب الخاص لا يُحفظ: يصل براء ليرسله بنفسه", link: { model: QUOTE_MODEL, id: quoteId }, ctx: opts.ctx,
        }));
        if (d?.action === "session" || d?.action === "template") sent = d.action;
        else why = d ? `${d.action}${"reason" in d ? `: ${d.reason}` : ""}` : "لم يُرسل";
      } else if (digits) {
        why = unit
          ? "العميل خارج نافذة 24 ساعة، وقالب عرض السعر يذكر إجمالياً وعرض أسعار الوحدة بلا إجمالي"
          : "العميل خارج نافذة 24 ساعة، و«صالح حتى» يتجاوز 6:00 صباح الغد فلا يصلح له قالب عرض السعر";
      }
      if (sent) {
        to = sent === "session" ? "customer_session" : "customer_template";
        line = `📄 صدر عرض السعر ${so.number} وأُرسل ملفه للعميل (${sent === "session" ? "داخل نافذته" : "بالقالب"}). ${total}`;
        await ownerText(env, `${line}\n${uploaded.publicUrl}`);
      } else {
        to = "owner_instead";
        await fileToOwner(env, uploaded.publicUrl, so.number, ownerCaption(`لم يُرسل للعميل: ${why}. أرسله له بنفسك.`), opts.ctx);
        line = `📄 صدر عرض السعر ${so.number} ولم يُرسل للعميل (${why}): وصلك ملفه لترسله بنفسك. ${total}`;
      }
    }
    await writeResult(env, quoteId, line, now);
    await finishButton(env, lock, ISSUE_LOCK_SECONDS);
    return { action: "issued", number: so.number, to, pdfUrl: uploaded.publicUrl, detail: line };
  } catch (e) {
    await releaseButton(env, lock);
    const why = (e as Error)?.message ?? String(e);
    await writeResult(env, quoteId, `🚫 تعذّر إصدار عرض السعر: ${why.slice(0, 200)}`, now);
    await ownerText(env, `🚫 تعذّر إصدار عرض سعر الطلب الخاص ${quoteName(quoteId)}: ${why.slice(0, 300)}`);
    throw e;
  }
}
