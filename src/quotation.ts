// UTAK Quotation — عرض سعر
// Uses the shared renderPDFShell for pixel-parity with the invoice.

import type { Env } from "./config";
import { isVatApplicable } from "./config";
import { arabicDate } from "./wa-params";
import {
  call,
  getLatestSalePrice,
  getOrderForInvoicing,
  resolvePackagingNames,
} from "./odoo";
import { textContent } from "./meta";
import { sendTemplateByPurpose, T, sendOwnerAlert } from "./templates";
import {
  BRAND_COLORS,
  computePageMetrics,
  escapeHTML,
  formatMoney,
  htmlToPDF,
  buildGotenbergFooterHtml,
  GOTENBERG_FOOTER_MARGIN,
  renderPDFShell,
  issuedSealHTML,
  signDocToken,
  uploadPDFToR2,
  type LegalFooterInfo,
  type PageMetrics,
  type PartyInfo,
} from "./pdf-template";
import { readCompanyInfo, type CompanyInfo } from "./company";
import { toLegalFooterAr } from "./legal-footer";
import { UI, resolveDocLang, type DocLang } from "./i18n";
import { formatDateEn, fromPartyFor, itemCellHTML, labelForBillTo, labelForFrom, labelForTerms, taglineFor, thanksLine } from "./doc-shell";

export interface QuotationLineItem {
  name: string;
  pack: string;
  qty: number;
  price: number;
  total: number;
  // Bilingual overlays (Part B). Empty falls back to Arabic only.
  name_en?: string;
  pack_en?: string;
}

export interface QuotationPriceWarning {
  product: string;
  source: string;
  age_days: number | null;
}

export interface QuotationPDFData {
  quotationNumber: string;
  quotationDate: Date;
  customer: {
    name: string;
    contactPerson?: string;
    address: string;
    phone: string;
  };
  items: QuotationLineItem[];
  subtotal: number;
  discount: number;
  vatAmount: number;
  grandTotal: number;
  /**
   * § 41 د — dated from the VAT cutoff (Riyadh): the quotation says «الأسعار
   * شاملة ضريبة القيمة المضافة» (its prices are the VAT-inclusive ones the
   * tax invoice will split). Absent before it: the page as it was.
   */
  vatInclusive?: boolean;
  // sim-harness (2026-09-13): loud-fail metadata. Never rendered into the
  // PDF — read by the dispatcher to gate sends and alert the owner.
  price_warnings: QuotationPriceWarning[];
  has_blocking_issue: boolean;
  // item3 (2026-09-17) — read from x_quotation.x_origin. Manual quotations
  // route through the same buildPDF / renderHTML / htmlToPDF / uploadToR2
  // helpers but the automatic template send is skipped. The internal-order
  // customer id + order id + missing product name(s) travel here so
  // createAndDispatchQuotationForRecord can build a manual-specific block
  // message ("صنف بلا سعر: ...") without re-reading Odoo.
  is_manual?: boolean;
  customer_id?: number;
  order_id?: number;
  missing_products?: string[];
  // Doc-level language. Not a tax invoice — so no Article 53 upgrade.
  lang?: DocLang;
  /** Issued document (numbered, sent / recorded). Only issued documents print
   *  the company seal + signature — never a preview or a draft. */
  issued?: boolean;
}

// 2026-09-19 — same-day validity. Old text was "٧ أيام". Since UTAK's cost is
// the daily supplier price, a 7-day quote is misleading; the new copy ties the
// quote to the day of issue and to that day's market prices.
const QUOTATION_FOOTER =
  "الأسعار سارية حتى ٩:٠٠ مساءً من تاريخ الإصدار، وتخضع لأسعار السوق اليومية";

// ---- Body: line-items table (same 5 columns as invoice) ----
export function renderQuotationBodyHTML(
  items: QuotationLineItem[],
  m?: PageMetrics,
  lang: DocLang = "ar",
): string {
  const metrics = m ?? computePageMetrics(items.length);
  const isAr = lang === "ar";
  const isEn = lang === "en";
  const dirEn = isEn ? "right" : "left";
  const rowsHtml = items
    .map(
      (item) => {
        const nameCell = isAr ? escapeHTML(item.name) : itemCellHTML(item.name, item.name_en, lang);
        const packCell = isAr ? escapeHTML(item.pack) : itemCellHTML(item.pack, item.pack_en, lang);
        return `
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${metrics.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCell}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${packCell}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;">${item.qty}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr; color: ${BRAND_COLORS.inkMuted};">${formatMoney(item.price, lang)}</td>
      <td style="height: ${metrics.rowHeight}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;">${formatMoney(item.total, lang)}</td>
    </tr>
  `;
      },
    )
    .join("");

  const L = (key: "colItem" | "colPackaging" | "colQty" | "colPrice" | "colTotal") =>
    isEn ? UI[key].en : UI[key].ar;
  const th = (label: string, w: string, alignEn = false) =>
    `<th style="width: ${w}; text-align: ${isEn ? (alignEn ? "right" : "left") : (alignEn ? "left" : "right")}; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; padding: ${metrics.thPad};">${escapeHTML(label)}</th>`;

  return `<table style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          ${th(L("colItem"), "40%")}
          ${th(L("colPackaging"), "20%")}
          ${th(L("colQty"), "10%", true)}
          ${th(L("colPrice"), "15%", true)}
          ${th(L("colTotal"), "15%", true)}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// ---- Totals: subtotal + discount + VAT 15% + grand total ----
export function renderQuotationTotalsHTML(
  subtotal: number,
  discount: number,
  vatAmount: number,
  grandTotal: number,
  lang: DocLang = "ar",
): string {
  const L = (key: "subtotal" | "discount" | "vat15" | "grandTotal") =>
    lang === "en" ? UI[key].en : UI[key].ar;
  return `<div style="position: relative; display: flex; justify-content: flex-end;">
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(L("subtotal"))}</span><span style="direction: ltr;">${formatMoney(subtotal, lang)}</span></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(L("discount"))}</span><span style="direction: ltr;">${formatMoney(discount, lang)}</span></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(L("vat15"))}</span><span style="direction: ltr;">${formatMoney(vatAmount, lang)}</span></div>
        <div style="height: 6px;"></div>
        <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.borderStrong};"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink};">${escapeHTML(L("grandTotal"))}</span><span style="font-size: 20px; font-weight: 500; color: ${BRAND_COLORS.primary}; direction: ltr;">${formatMoney(grandTotal, lang)}</span></div>
      </div>
    </div>`;
}

export function renderQuotationHTML(data: QuotationPDFData, company?: CompanyInfo): string {
  const pageMetrics = computePageMetrics(data.items.length);
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  const billTo: PartyInfo = {
    name: data.customer.name,
    contactName: data.customer.contactPerson,
    address: data.customer.address,
    phone: data.customer.phone,
  };
  const legalFooterBar: LegalFooterInfo | undefined = company
    ? toLegalFooterAr(company)
    : undefined;
  return renderPDFShell({
    documentTitle: lang === "en" ? UI.quotation.en : UI.quotation.ar,
    documentNumber: data.quotationNumber,
    documentDate: data.quotationDate,
    billTo,
    from: data.lang ? fromPartyFor(lang, company) : undefined,
    bodyHTML: renderQuotationBodyHTML(data.items, pageMetrics, lang),
    totalsHTML: renderQuotationTotalsHTML(
      data.subtotal,
      data.discount,
      data.vatAmount,
      data.grandTotal,
      lang,
    ),
    footerNote: lang === "en"
      ? (data.vatInclusive ? `${UI.quotationValidity.en} ${UI.vatInclusiveNote.en}.` : UI.quotationValidity.en)
      : (data.vatInclusive ? `${QUOTATION_FOOTER}. ${UI.vatInclusiveNote.ar}` : QUOTATION_FOOTER),
    showZatcaQR: false,
    legalFooterBar,
    pageMetrics,
    lang: data.lang ? lang : undefined,
    tagline: data.lang ? taglineFor(lang) : undefined,
    billToLabel: data.lang ? labelForBillTo(lang) : undefined,
    fromLabel: data.lang ? labelForFrom(lang) : undefined,
    termsLabel: data.lang ? labelForTerms(lang) : undefined,
    thanksLine: data.lang ? thanksLine(lang, company) : undefined,
    footerSealHTML: issuedSealHTML(data.issued, company),
    sealBesideTotals: true,
    documentDateStr: lang === "en" ? formatDateEn(data.quotationDate) : undefined,
  });
}

export async function generateQuotationPDF(
  data: QuotationPDFData,
  env: Env,
): Promise<Uint8Array> {
  const company = await readCompanyInfo(env);
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  return await htmlToPDF(renderQuotationHTML(data, company), env, {
    footerHtml: buildGotenbergFooterHtml(lang),
    marginBottom: GOTENBERG_FOOTER_MARGIN,
  });
}

export async function uploadQuotationToR2(
  env: Env,
  pdfBytes: Uint8Array,
  quotationNumber: string,
  workerOrigin: string,
): Promise<{ key: string; publicUrl: string; size: number }> {
  const result = await uploadPDFToR2(env, {
    pdfBytes,
    folder: "quotations",
    urlPrefix: "quotation-pdf",
    docNumber: quotationNumber,
    workerOrigin,
  });
  // URL-encode the {num} segment. The R2 key stays raw; the GET
  // /quotation-pdf/:num/:tok.pdf handler decodeURIComponent()s before
  // R2 lookup and HMAC verification. uploadPDFToR2 already required
  // ADMIN_TOKEN, so the non-null assertion is safe here.
  const token = await signDocToken(env.ADMIN_TOKEN!, quotationNumber);
  const publicUrl = `${workerOrigin}/quotation-pdf/${encodeURIComponent(quotationNumber)}/${token}.pdf`;
  return { ...result, publicUrl };
}

// ---- Build from a real Odoo x_quotation record ----
export async function buildQuotationPDFDataFromOdoo(
  env: Env,
  quotationId: number,
): Promise<QuotationPDFData | null> {
  type QuoRow = {
    id: number;
    x_quotation_number: string | false;
    x_order_id: [number, string] | false;
    x_sent_at: string | false;
    create_date: string | false;
    x_origin: string | false;
  };
  let rows: QuoRow[];
  try {
    rows = await call<QuoRow[]>(env, "x_quotation", "read", {
      ids: [quotationId],
      fields: [
        "id",
        "x_quotation_number",
        "x_order_id",
        "x_sent_at",
        "create_date",
        "x_origin",
      ],
    });
  } catch (e) {
    console.error(
      "[q-issue] step 1 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }
  const q = rows[0];
  if (!q) return null;
  if (!q.x_order_id) {
    throw new Error(`Quotation ${quotationId} has no linked order`);
  }
  // item3 (2026-09-17) — x_origin defaults to auto for existing rows.
  const isManual = q.x_origin === "manual";

  const order = await getOrderForInvoicing(env, q.x_order_id[0]);
  if (!order) {
    throw new Error(`Order ${q.x_order_id[0]} for quotation ${quotationId} not found`);
  }

  const packagingNames = await resolvePackagingNames(
    env,
    order.lines.map((l) => ({ packaging_id: l.packaging_id, product_id: l.product_id })),
  );

  let subtotal = 0;
  const items: QuotationLineItem[] = [];
  const price_warnings: QuotationPriceWarning[] = [];
  let has_blocking_issue = false;
  let lineIdx = -1;
  for (const l of order.lines) {
    lineIdx++;
    // item3 price priority (both auto and manual quotations):
    //   1) x_price_unit_manual on the line (>0), if set
    //   2) l.unit_price already cached on the Odoo line (>0)
    //   3) getLatestSalePrice fallback (may return "missing")
    // Manual quotations skip the daily-price catalog entirely — they accept
    // any product name — so a line without a manual override AND without a
    // cached unit_price AND without a recent sale price falls to has_blocking
    // with the Arabic reason "صنف بلا سعر: <name>".
    const manualUnit =
      typeof l.price_unit_manual === "number" && l.price_unit_manual > 0
        ? l.price_unit_manual
        : 0;
    let unit = manualUnit || (l.unit_price ?? 0);
    let source: "today" | "stale" | "missing" =
      manualUnit > 0 ? "today" : "today";
    let age_days: number | null = 0;
    if (!unit || unit <= 0) {
      // § 41 — the order's day's price (a quotation rebuilt later keeps it)
      const lookup = await getLatestSalePrice(env, l.product_id, l.packaging_id, order.order_date ?? undefined);
      unit = lookup.price;
      source = lookup.source;
      age_days = lookup.age_days;
    }
    if (source !== "today") {
      price_warnings.push({
        product: l.product_name || "صنف",
        source,
        age_days,
      });
      if (source === "missing") has_blocking_issue = true;
    }
    if (isManual && (!unit || unit <= 0)) {
      // Manual quotation explicit block: has_blocking_issue is already set
      // above when source=='missing', but a manual line that goes through
      // with unit=0 (e.g. the fallback lookup returned 0 without labeling it
      // "missing") is still an unusable quotation — trip the flag here too.
      has_blocking_issue = true;
    }
    const total = round2(unit * l.quantity);
    subtotal = round2(subtotal + total);
    items.push({
      name: l.product_name || "صنف",
      pack: packagingNames[lineIdx],
      qty: l.quantity,
      price: unit,
      total,
    });
  }

  if (typeof q.x_quotation_number !== "string" || !q.x_quotation_number) {
    throw new Error(`Missing x_quotation_number on record ${quotationId}`);
  }
  const number = q.x_quotation_number;

  const rawDate = (q.x_sent_at || q.create_date) as string | false;
  const quotationDate = rawDate ? new Date(String(rawDate).replace(" ", "T") + "Z") : new Date();

  const missing_products = price_warnings
    .filter((w) => w.source === "missing")
    .map((w) => w.product);
  // § 40 د — the quantity discount, before VAT, on the order's day (the
  // invoice computes it the same way): shown as its own line; the total is
  // what the invoice will ask (VAT-inclusive prices: the discount's VAT goes
  // with it). A quotation with a missing price gets none (it is not sent).
  let discount = 0;
  let grandTotal = subtotal;
  if (!has_blocking_issue && items.length) {
    try {
      const { orderDiscount, discountedTotals } = await import("./order-pricing");
      const day = order.order_date ?? new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
      let rate: number | null = null;
      const d = await orderDiscount(env, {
        day,
        lines: order.lines.map((l, i) => ({ productId: l.product_id, packagingId: l.packaging_id, qty: l.quantity, unit: items[i].price })),
        vatRate: async () => {
          const { resolveSaleTaxForDate } = await import("./accounting");
          rate = (await resolveSaleTaxForDate(env, day))?.rate ?? null;
          return rate;
        },
      });
      if (d.applied) {
        const { computeInclusiveTotals } = await import("./accounting");
        const t = discountedTotals(computeInclusiveTotals(items.map((it) => it.total), rate), d.amount, rate);
        grandTotal = t.total;
        discount = round2(subtotal - grandTotal);
      }
    } catch (e) {
      console.warn(`[quotation] ${quotationId}: discount check failed — none shown`, (e as Error).message);
    }
  }
  return {
    quotationNumber: number,
    quotationDate,
    ...(isVatApplicable(new Date(quotationDate.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10)) ? { vatInclusive: true } : {}),
    customer: {
      name: order.customer_name || "عميل",
      address: order.neighborhood || "الرياض",
      phone: order.customer_whatsapp || "",
    },
    items,
    subtotal,
    discount,
    vatAmount: 0,
    grandTotal,
    price_warnings,
    has_blocking_issue,
    is_manual: isManual,
    customer_id: order.customer_id,
    order_id: order.id,
    missing_products,
    // An x_quotation with its number is the issued quotation (the one sent to
    // the customer) → seal + signature. Previews override with issued:false.
    issued: true,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Verify a `/quotation-pdf/{num}/{tok}.pdf` signed token ----
export async function verifyQuotationToken(
  secret: string,
  quotationNumber: string,
  token: string,
): Promise<boolean> {
  const expected = await signDocToken(secret, quotationNumber);
  return expected === token;
}

// ---- Orchestrate: build → PDF → R2 → WhatsApp → mark sent ----
export interface QuotationDispatchResult {
  quotationId: number;
  number: string;
  pdfUrl: string;
  pdfSize: number;
  messageId: string | null;
  // sim-harness (2026-09-13): loud-fail signals. blocked=true means the
  // customer was NOT messaged and x_sent_at was NOT written.
  blocked?: boolean;
  blockReason?: string;
}

// sim-harness (2026-09-13): local owner-alert helper, mirrors suppliers.ts
// so quotation.ts stays free of a suppliers ↔ quotation import cycle.
/**
 * customer_quotation_pdf variables, in order — utak_quotation_pdf_v1 (2026-09-25):
 * «مرحباً {{1}}، مرفق عرض السعر رقم {{2}} من يو تاك بتاريخ {{3}}، بإجمالي {{4}} ريال …»
 * = [customer name, quotation number, Arabic date, grand total].
 */
export function quotationTemplateParams(
  data: { customer: { name?: string }; quotationNumber: string; grandTotal: number },
  quotationDate: string,
): string[] {
  return [data.customer.name || "", data.quotationNumber, quotationDate, String(data.grandTotal)];
}

async function alertOwner(env: Env, text: string): Promise<void> {
  try {
    await sendOwnerAlert(env, text);
  } catch (e) {
    console.error("[quotation alertOwner] failed", (e as Error)?.message);
  }
}

export async function createAndDispatchQuotationForRecord(
  env: Env,
  quotationId: number,
): Promise<QuotationDispatchResult | null> {
  let data: QuotationPDFData | null;
  try {
    data = await buildQuotationPDFDataFromOdoo(env, quotationId);
  } catch (e) {
    console.error(
      "[q-issue] step 2 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }
  if (!data) {
    console.warn(`[quotation] record ${quotationId} not found`);
    return null;
  }

  // sim-harness (2026-09-13): loud-fail gate. Any line with source="missing"
  // means we would have sent the customer a quotation with a 0-price row —
  // silently. Short-circuit before HTML/PDF/R2/send. Never write x_sent_at.
  //
  // item3 (2026-09-17): manual quotations use the same gate but report per
  // the tonight spec — "صنف بلا سعر: <name>" — so the reason surfaces
  // exactly at the point of edit.
  if (data.has_blocking_issue) {
    const missing = (data.missing_products && data.missing_products.length
      ? data.missing_products
      : data.price_warnings.filter((w) => w.source === "missing").map((w) => w.product));
    const reason = data.is_manual
      ? missing.map((n) => `صنف بلا سعر: ${n}`).join(" | ") || "صنف بلا سعر"
      : `missing prices: ${missing.join(", ") || "(unnamed)"}`;
    console.error(`[q-issue] BLOCKED quotationId=${quotationId} number=${data.quotationNumber} — ${reason}`);
    await alertOwner(
      env,
      [
        `🚫 كوتيشن ${data.quotationNumber} (id=${quotationId}) — ما أرسلناه للعميل`,
        data.is_manual ? `عرض يدوي: أصناف بلا سعر:` : `أصناف بدون سعر في x_daily_price:`,
        ...missing.map((n) => `• ${n}`),
        ``,
        data.is_manual
          ? `أدخل x_price_unit_manual على الأسطر ثم أعد الإرسال.`
          : `أدخل الأسعار ثم أعد الإصدار.`,
      ].join("\n"),
    );
    return {
      quotationId,
      number: data.quotationNumber,
      pdfUrl: "",
      pdfSize: 0,
      messageId: null,
      blocked: true,
      blockReason: reason,
    };
  }

  let html: string;
  try {
    // Company read here too (legal footer + seal), as generateQuotationPDF does.
    html = renderQuotationHTML(data, await readCompanyInfo(env));
  } catch (e) {
    console.error(
      "[q-issue] step 3 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }

  let pdfBytes: Uint8Array;
  try {
    const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
    pdfBytes = await htmlToPDF(html, env, {
      footerHtml: buildGotenbergFooterHtml(lang),
      marginBottom: GOTENBERG_FOOTER_MARGIN,
    });
  } catch (e) {
    console.error(
      "[q-issue] step 4 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }

  let uploaded: { key: string; publicUrl: string; size: number };
  try {
    uploaded = await uploadQuotationToR2(
      env,
      pdfBytes,
      data.quotationNumber,
      env.WORKER_ORIGIN,
    );
  } catch (e) {
    console.error(
      "[q-issue] step 5 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    throw e;
  }

  // item3 (2026-09-17) — manual quotations stop here. The auto-action still
  // runs (build → PDF → R2) so the "إصدار PDF" button on the manual form
  // has an up-to-date file behind it, but the customer WhatsApp send only
  // happens when Baraa explicitly clicks "إرسال واتساب", which fires
  // /internal/quotation-wa-send. x_sent_at MUST stay unset here — its sole
  // legitimate writer for a manual quotation is the queued x_wa_message's
  // send hook.
  if (data.is_manual) {
    console.log(
      `[q-issue] manual quotation ${data.quotationNumber} (id=${quotationId}) — PDF built and uploaded, send skipped`,
    );
    return {
      quotationId,
      number: data.quotationNumber,
      pdfUrl: uploaded.publicUrl,
      pdfSize: uploaded.size,
      messageId: null,
    };
  }

  const customerPhone = data.customer.phone;
  // ت5 (2026-09-24): «24 سبتمبر 2026» (Riyadh day, Arabic month, Latin digits).
  const quotationDate = arabicDate(
    new Date(data.quotationDate.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10),
  );

  let messageId: string | null = null;
  if (!customerPhone) {
    // sim-harness (2026-09-13): promote silent skip to explicit failure.
    // No customer phone → nobody sees the quotation. Alert Baraa, don't
    // write x_sent_at, return blocked.
    console.error(`[q-issue] BLOCKED quotationId=${quotationId} number=${data.quotationNumber} — no customer WhatsApp`);
    await alertOwner(
      env,
      [
        `🚫 كوتيشن ${data.quotationNumber} (id=${quotationId}) — ما أرسلناه للعميل`,
        `العميل "${data.customer.name}" بدون رقم واتساب في Odoo.`,
        `الملف جاهز: ${uploaded.publicUrl}`,
      ].join("\n"),
    );
    return {
      quotationId,
      number: data.quotationNumber,
      pdfUrl: uploaded.publicUrl,
      pdfSize: uploaded.size,
      messageId: null,
      blocked: true,
      blockReason: "no customer WhatsApp",
    };
  } else {
    try {
      // Plain text with the PDF link: the fallback while utak_quotation_pdf_v1
      // cannot go (unmapped, not approved); it needs the 24h window, and waits
      // for it in the gateway's queue otherwise (STATUS § 33).
      const body = [
        `📄 عرض السعر رقم ${data.quotationNumber}`,
        ``,
        `العميل: ${data.customer.name}`,
        `الإجمالي: ${data.grandTotal} ر.س`,
        ``,
        `الملف: ${uploaded.publicUrl}`,
        ``,
        `الأسعار سارية حتى ٩:٠٠ مساءً من تاريخ الإصدار، وتخضع لأسعار السوق اليومية. شكراً لتعاملكم مع UTAK 🌿`,
      ].join("\n");
      let resp: Response | null = null;
      try {
        resp = await sendTemplateByPurpose(
          env,
          customerPhone,
          T.CUSTOMER_QUOTATION_PDF,
          quotationTemplateParams(data, quotationDate),
          [],
          { type: "document", link: uploaded.publicUrl, filename: `${data.quotationNumber}.pdf` },
          { requestPurpose: "customer_quotation", fallback: [textContent(body)] },
        );
      } catch (e) {
        console.warn(`[quotation] send threw`, (e as Error).message);
      }

      if (resp?.ok) {
        try {
          const j = (await resp.json()) as { messages?: Array<{ id?: string }> };
          messageId = j?.messages?.[0]?.id ?? null;
        } catch {
          /* ignore parse error — Meta returned non-JSON */
        }
      }
    } catch (e) {
      console.error(
        "[q-issue] step 7 FAILED:",
        (e as Error).message,
        (e as Error).stack,
      );
      throw e;
    }
  }

  try {
    await call<boolean>(env, "x_quotation", "write", {
      ids: [quotationId],
      vals: { x_sent_at: nowOdoo() },
    });
  } catch (e) {
    console.error(
      "[q-issue] step 8 FAILED:",
      (e as Error).message,
      (e as Error).stack,
    );
    // Kept best-effort — a write-back failure must not undo a WhatsApp send
    // that already reached the customer. Prior behavior was warn-and-continue.
    console.warn(`[quotation] failed to update x_sent_at`, (e as Error).message);
  }

  // sim-harness (2026-09-13): non-blocking price warnings — the send already
  // went out, but the customer received a quotation priced from stale rows.
  // Notify the owner so a fresh price can be entered before the next round.
  if (data.price_warnings.length > 0) {
    const lines = data.price_warnings.map((w) => {
      const age = w.age_days === null ? "غير معروف" : `${w.age_days} يوم`;
      return `• ${w.product} — ${w.source} (${age})`;
    });
    await alertOwner(
      env,
      [
        `⚠️ كوتيشن ${data.quotationNumber} (id=${quotationId}) أُرسل بأسعار غير محدَّثة اليوم:`,
        ...lines,
      ].join("\n"),
    );
  }

  return {
    quotationId,
    number: data.quotationNumber,
    pdfUrl: uploaded.publicUrl,
    pdfSize: uploaded.size,
    messageId,
  };
}

function nowOdoo(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ---- Test data — 6 items, ~1500 SAR total ----
export const TEST_QUOTATION_DATA: QuotationPDFData = {
  quotationNumber: "QUO-2026-0032",
  quotationDate: new Date("2026-09-08T09:00:00Z"),
  customer: {
    name: "مطعم النخيل",
    contactPerson: "أ. محمد الشمري",
    address: "العليا، الرياض",
    phone: "+966 55 214 8830",
  },
  items: [
    { name: "طماطم شيري كرزية درجة أولى", pack: "كرتون ٨ كجم", qty: 5, price: 45, total: 225 },
    { name: "خيار بلدي", pack: "كرتون ٥ كجم", qty: 8, price: 28, total: 224 },
    { name: "خس آيسبرغ", pack: "كرتون ١٢ حبة", qty: 4, price: 55, total: 220 },
    { name: "بطاطس", pack: "كيس ٢٥ كجم", qty: 4, price: 68, total: 272 },
    { name: "ليمون بلدي", pack: "كرتون ١٠ كجم", qty: 4, price: 72, total: 288 },
    { name: "بقدونس طازج", pack: "ربطة × ٢٠", qty: 12, price: 24, total: 288 },
  ],
  subtotal: 1517,
  discount: 0,
  vatAmount: 0,
  grandTotal: 1517,
  price_warnings: [],
  has_blocking_issue: false,
};
