// UTAK Quotation — عرض سعر
// Uses the shared renderPDFShell for pixel-parity with the invoice.

import type { Env } from "./config";
import { isVatApplicable } from "./config";
import { arabicDate } from "./wa-params";
import {
  call,
  getOrderForInvoicing,
  resolvePackagingNames,
  unfrozenLinePrice,
} from "./odoo";
import { documentContent, pdfFileName } from "./meta";
import { T, sendOwnerAlert } from "./templates";
import { sendViaGateway, type HeaderMedia } from "./wa-gateway";
import { PRICE_NOTE } from "./order-flow";
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
import { readCompanyInfoWithBank, type CompanyInfo } from "./company";
import { bankLineWithHolder } from "./bank-line";
import { toLegalFooterAr } from "./legal-footer";
import { UI, resolveDocLang, type DocLang } from "./i18n";
import { formatDateEn, fromPartyFor, itemCellHTML, labelForFrom, labelForQuotationTerms, labelForTo, taglineFor, thanksLine } from "./doc-shell";

export interface QuotationLineItem {
  name: string;
  pack: string;
  qty: number;
  price: number;
  total: number;
  // Bilingual overlays (Part B). Empty falls back to Arabic only.
  name_en?: string;
  pack_en?: string;
  /**
   * § 62 د — ONE unit's price before VAT, its VAT and the price with it: what a unit-price quotation prints
   * (QuotationPDFData.layout = "unit"). Each from its source — never recomputed here — so net + vat = gross
   * to the halala.
   */
  net?: number;
  vat?: number;
  gross?: number;
  /** § 62 د — a small line under the item's name: «جنوب أفريقيا · مقاس 66» (itemDetail). */
  detail?: string;
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
  /**
   * § 62 ج — the note under the totals, in place of the day's «العرض ساري حتى
   * الساعة ٦:٠٠ صباحاً …»: a special request's quotation carries its own
   * «صالح حتى» (src/special-quotation.ts). Absent: the note as it was.
   */
  footerNote?: string;
  /**
   * § 62 ج (the addition) — a quotation whose prices are BEFORE VAT: the names of
   * its two totals («المجموع قبل الضريبة», «ضريبة القيمة المضافة 15%») and no
   * discount row. Absent: the totals as they were.
   */
  totals?: QuotationTotalsOptions;
  /** § 62 ج (the addition) — a block printed under the table as it is («خيارات بديلة»). Absent or empty: nothing. */
  belowTable?: { label: string; text: string };
  /**
   * § 62 د — «عرض سعر الوحدة»: the table is الصنف | العبوة | السعر قبل الضريبة | ضريبة 15% | السعر بعد الضريبة, with no
   * quantity, no line total and no totals under it, and «الأسعار لكل وحدة كما في عمود العبوة» below. Set by the
   * special request's builder and the sale order's (every quantity = 1, or the request's «شكل العرض»); the day's
   * customer quotation never sets it. Absent: the quotation by quantities, as it was.
   */
  layout?: "unit";
  /** § 62 د — a preview: «مسودة» across the page and in the number's place, no seal, no signature. */
  draft?: boolean;
  /** § 62 د — more blocks under the table, each as `belowTable` (a sale order's notes). */
  belowBlocks?: Array<{ label: string; text: string }>;
  /** § 62 د — a group's title printed above the item at index `before` (a sale order's section line). */
  sections?: Array<{ before: number; title: string }>;
  /** § 62 د — why the quotation cannot be issued, each a whole sentence («صنف بلا سعر: …», «السطر 3 بلا منتج ولا وصف»). */
  problems?: string[];
}
export interface QuotationTotalsOptions { subtotalLabel?: string; vatLabel?: string; hideDiscount?: boolean }

/** The block under the table: its label, then its text as it was typed (line breaks kept, nothing read as HTML). */
export function renderBelowTableHTML(b?: { label: string; text: string }): string {
  if (!b || !String(b.text ?? "").trim()) return "";
  return `<div style="position: relative; margin-top: 14px;">
      <div style="font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.16em; margin-bottom: 4px;">${escapeHTML(b.label)}</div>
      <div style="font-size: 11px; font-weight: 400; color: ${BRAND_COLORS.ink}; line-height: 1.8; white-space: pre-wrap;">${escapeHTML(String(b.text).trim())}</div>
    </div>`;
}

// 2026-09-19 — same-day validity. Old text was "٧ أيام". Since UTAK's cost is
// the daily supplier price, a 7-day quote is misleading; the new copy ties the
// quote to the day of issue and to that day's market prices.
// § 49 ب (2026-10-01) — the fixed note of every quotation, and the validity of
// its price list: until 06:00 of the day after it (it was «حتى ٩:٠٠ مساءً»).
export const QUOTATION_FOOTER =
  `${PRICE_NOTE} العرض ساري حتى الساعة ٦:٠٠ صباحاً من اليوم التالي لأسعاره`;

// ---- Body: line-items table (same 5 columns as invoice) ----
export function renderQuotationBodyHTML(
  items: QuotationLineItem[],
  m?: PageMetrics,
  lang: DocLang = "ar",
  sections?: QuotationPDFData["sections"],
): string {
  const metrics = m ?? computePageMetrics(items.length);
  const isAr = lang === "ar";
  const isEn = lang === "en";
  const dirEn = isEn ? "right" : "left";
  const rowsHtml = items
    .map(
      (item, index) => {
        const nameCell = withItemDetail(isAr ? escapeHTML(item.name) : itemCellHTML(item.name, item.name_en, lang), item.detail);
        const packCell = isAr ? escapeHTML(item.pack) : itemCellHTML(item.pack, item.pack_en, lang);
        const rowH = rowHeightOf(metrics, item);
        return `${sectionRowsHTML(sections, index, 5, isEn)}
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${rowH}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCell}</td>
      <td style="height: ${rowH}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0;">${packCell}</td>
      <td style="height: ${rowH}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;">${item.qty}</td>
      <td style="height: ${rowH}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr; color: ${BRAND_COLORS.inkMuted};">${formatMoney(item.price, lang)}</td>
      <td style="height: ${rowH}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;">${formatMoney(item.total, lang)}</td>
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

/** § 62 د — «جنوب أفريقيا · مقاس 66»: the origin, then the size (with «مقاس» before a bare one). "" when neither is filled. */
export function itemDetail(origin?: string | false | null, size?: string | false | null): string {
  const o = String(origin || "").trim(), z = String(size || "").trim();
  return [o, z ? (/مقاس|size/i.test(z) ? z : `مقاس ${z}`) : ""].filter(Boolean).join(" · ");
}
/** A row's height: the page's, or — for a row that carries a detail line — the page's height for such a row. */
function rowHeightOf(metrics: PageMetrics, item: QuotationLineItem): string {
  const tall = (metrics as Partial<QuotationMetrics>).detailRowHeight;
  return tall && String(item.detail ?? "").trim() ? tall : metrics.rowHeight;
}
/** The small line under an item's name. Nothing without a detail. */
export function itemDetailHTML(detail?: string): string {
  const d = String(detail ?? "").trim();
  return d ? `<div data-utak="item-detail" style="font-size: 9px; font-weight: 400; line-height: 1.25; color: ${BRAND_COLORS.inkMuted}; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(d)}</div>` : "";
}
/**
 * The name cell: the name as it was when the item has no detail; with one, the name on a tight line of its own
 * and the detail under it (the two together stand in a DETAIL_ROW_MIN_PX row).
 */
function withItemDetail(nameHTML: string, detail?: string): string {
  const d = itemDetailHTML(detail);
  return d ? `<div style="line-height: 1.3; overflow: hidden; text-overflow: ellipsis;">${nameHTML}</div>${d}` : nameHTML;
}
/** The titles of the groups that start at this item (a sale order's section lines): rows of their own, across the table. */
function sectionRowsHTML(sections: QuotationPDFData["sections"], index: number, columns: number, isEn: boolean): string {
  return (sections ?? []).filter((x) => x.before === index && String(x.title ?? "").trim()).map((x) => `
    <tr data-utak="section"><td colspan="${columns}" style="height: ${SECTION_ROW_PX}px; vertical-align: bottom; text-align: ${isEn ? "left" : "right"}; font-size: 11px; font-weight: 500; color: ${BRAND_COLORS.primary}; padding: 0 0 4px 0;">${escapeHTML(String(x.title).trim())}</td></tr>`).join("");
}

// ---- § 62 د: the unit-price table — no quantity, no line total ----
export const UNIT_COLUMNS = ["colItem", "colPackaging", "colPriceNet", "colVat15", "colPriceGross"] as const;
export function renderUnitPriceBodyHTML(
  items: QuotationLineItem[],
  m?: PageMetrics,
  lang: DocLang = "ar",
  sections?: QuotationPDFData["sections"],
): string {
  const metrics = m ?? computePageMetrics(items.length);
  const isAr = lang === "ar";
  const isEn = lang === "en";
  const dirEn = isEn ? "right" : "left";
  const money = (n: number | undefined, rowH: string, muted = false) =>
    `<td style="height: ${rowH}; text-align: ${dirEn}; font-size: 12px; font-weight: 400; direction: ltr;${muted ? ` color: ${BRAND_COLORS.inkMuted};` : ""}">${formatMoney(n ?? 0, lang)}</td>`;
  const rowsHtml = items.map((item, index) => {
    const nameCell = withItemDetail(isAr ? escapeHTML(item.name) : itemCellHTML(item.name, item.name_en, lang), item.detail);
    const packCell = isAr ? escapeHTML(item.pack) : itemCellHTML(item.pack, item.pack_en, lang);
    const rowH = rowHeightOf(metrics, item);
    return `${sectionRowsHTML(sections, index, 5, isEn)}
    <tr style="border-bottom: 0.25px solid ${BRAND_COLORS.borderSoft};">
      <td style="height: ${rowH}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCell}</td>
      <td style="height: ${rowH}; text-align: ${isEn ? "left" : "right"}; font-size: 12px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; padding: 0 12px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${packCell}</td>
      ${money(item.net, rowH)}
      ${money(item.vat, rowH, true)}
      ${money(item.gross, rowH)}
    </tr>
  `;
  }).join("");
  const th = (key: (typeof UNIT_COLUMNS)[number], w: string, alignEn = false) =>
    `<th style="width: ${w}; text-align: ${isEn ? (alignEn ? "right" : "left") : (alignEn ? "left" : "right")}; font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.04em; white-space: nowrap; padding: ${metrics.thPad};">${escapeHTML(isEn ? UI[key].en : UI[key].ar)}</th>`;
  return `<table data-utak="unit-prices" style="position: relative; width: 100%; border-collapse: collapse; table-layout: fixed;">
      <thead>
        <tr style="border-top: 0.5px solid ${BRAND_COLORS.borderStrong}; border-bottom: 0.5px solid ${BRAND_COLORS.borderStrong};">
          ${th("colItem", "30%")}
          ${th("colPackaging", "20%")}
          ${th("colPriceNet", "18%", true)}
          ${th("colVat15", "13%", true)}
          ${th("colPriceGross", "19%", true)}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div data-utak="unit-note" style="position: relative; margin-top: 8px; font-size: 9.5px; font-weight: 400; color: ${BRAND_COLORS.inkMuted};">${escapeHTML(isEn ? UI.unitPricesNote.en : UI.unitPricesNote.ar)}</div>`;
}

// ---- § 62 د: one page up to twelve lines ----
//
// The quotation outgrew its sheet block by block («من» became the company's national address, then the
// bank-transfer line, «خيارات بديلة», the seal's row): every gap and every row kept the height it was given when
// the page was half empty, so nine rows already ran 155 px past the sheet. Now the page is told its sheet
// (RenderPDFShellOptions.fitOnePage: the gaps give way first), and the rows take the height this budget leaves
// them — from 36 px down to the least a row reads well at. More than twelve rows: the dense page as before,
// flowing over as many sheets as it needs with «صفحة X من Y» on each.
export const FIT_MAX_ROWS = 12;
const ROW_MAX_PX = 36, ROW_MIN_PX = 24, DETAIL_ROW_MIN_PX = 25;
/** What a printed row is taller than its cell's `height` by: the number cells' own padding and the rule under the row. */
const ROW_EXTRA_PX = 3;
/** Kept free of the budget: a line that wraps where the estimate said it would not. */
const FIT_RESERVE_PX = 6;
export const SECTION_ROW_PX = 28;
/** What the sheet gives the page's content once the page-number margin and the page's own paddings are taken (px at 96 dpi). */
export const FIT_SHEET_PX = Math.floor((297 - 20 - 6) * (96 / 25.4) - Number(GOTENBERG_FOOTER_MARGIN) * 96);
export interface QuotationFitInput {
  rows: number;
  /** Rows that carry a detail line under the name. */
  detailRows?: number;
  sectionRows?: number;
  unit?: boolean;
  /** An issued quotation: the seal's block beside the totals. */
  sealed?: boolean;
  /** The lines of the taller party block (name, contact, address lines, phone). */
  partyLines?: number;
  /** The lines of the note under «الشروط والملاحظات», and whether a bank-transfer line follows it. */
  noteLines?: number;
  bankLine?: boolean;
  /** The blocks under the table and all their lines together. */
  belowBlocks?: number;
  belowLines?: number;
}
/**
 * The height of everything on the page but the table (its head and its rows) and the four gaps, in px, by what
 * the page carries — each number as Chrome lays the block out (measured 2026-10-07): the header 121; a party
 * block of four lines 111; the totals 118, or the seal's block beside them 155; the terms block 101 with a
 * one-line note and the bank-transfer line; the legal strip 22.
 */
export function quotationFixedPx(i: QuotationFitInput): number {
  const header = 121, rule = 1;
  const partyLines = Math.max(3, i.partyLines ?? 4);
  const parties = 20 + partyLines * 19 + (partyLines - 1) * 5;
  const unitNote = i.unit ? 22 : 0;
  const below = (i.belowBlocks ?? 0) * 33 + (i.belowLines ?? 0) * 20;
  const totals = i.sealed ? 155 : i.unit ? 0 : 118;
  const foot = 14 + 15 + 5 + Math.max(1, i.noteLines ?? 1) * 17 + (i.bankLine ? 22 : 0) + 12 + 16;
  const strip = 8 + 14;
  return header + rule + parties + unitNote + below + totals + foot + strip + (i.sectionRows ?? 0) * (SECTION_ROW_PX + 1);
}
/** The table's head: its text line and its padding above and below. */
const theadPx = (pad: number): number => 17 + 2 * pad;
const thPadFor = (row: number): number => (row >= 30 ? 10 : 8);
export const FIT_GAPS = { gap: [12, 24], preTable: [14, 40], postTable: [12, 40] } as const;
/** How far open (0 … 1) the gaps are when the rows' height is chosen. */
const FIT_GAPS_OPEN = 0.25;
/** The page's whole height at a row height and a gaps' opening: what quotationPageMetrics holds against the sheet. */
export function quotationPagePx(i: QuotationFitInput, rowPx: number, open: number): number {
  return quotationFixedPx(i) + tablePx(i, rowPx) + gapsPx(open) + FIT_RESERVE_PX;
}
const gapsPx = (t: number): number => 2 * (FIT_GAPS.gap[0] + t * (FIT_GAPS.gap[1] - FIT_GAPS.gap[0])) + (FIT_GAPS.preTable[0] + t * (FIT_GAPS.preTable[1] - FIT_GAPS.preTable[0])) + (FIT_GAPS.postTable[0] + t * (FIT_GAPS.postTable[1] - FIT_GAPS.postTable[0]));
/** What the table takes at `h` px a row: its head, and each row with its extra (a row with a detail line is never under DETAIL_ROW_MIN_PX). */
const tablePx = (i: QuotationFitInput, h: number): number =>
  theadPx(thPadFor(h)) + (i.rows - (i.detailRows ?? 0)) * (h + ROW_EXTRA_PX) + (i.detailRows ?? 0) * (Math.max(h, DETAIL_ROW_MIN_PX) + ROW_EXTRA_PX);
export interface QuotationMetrics extends PageMetrics {
  /** The page is told its sheet (twelve rows or fewer). */
  fit: boolean;
  /** The height of a row that carries a detail line. */
  detailRowHeight: string;
}
export function quotationPageMetrics(i: QuotationFitInput): QuotationMetrics {
  if (i.rows > FIT_MAX_ROWS) {
    const m = computePageMetrics(i.rows);
    return { ...m, fit: false, detailRowHeight: `${Math.max(parseInt(m.rowHeight, 10) || 0, DETAIL_ROW_MIN_PX)}px` };
  }
  const fixed = quotationFixedPx(i);
  // the tallest row the sheet holds with its gaps a quarter open; else with them closed; else the least row (the gaps close, and what is left flows on)
  let row = ROW_MIN_PX;
  for (const t of [FIT_GAPS_OPEN, 0]) {
    let found = 0;
    for (let h = ROW_MAX_PX; h >= ROW_MIN_PX; h--) if (fixed + tablePx(i, h) + gapsPx(t) + FIT_RESERVE_PX <= FIT_SHEET_PX) { found = h; break; }
    if (found) { row = found; break; }
  }
  return {
    dense: false, fit: true,
    gap: `${FIT_GAPS.gap[1]}px`, gapMin: `${FIT_GAPS.gap[0]}px`,
    preTable: `${FIT_GAPS.preTable[1]}px`, preTableMin: `${FIT_GAPS.preTable[0]}px`,
    postTable: `${FIT_GAPS.postTable[1]}px`, postTableMin: `${FIT_GAPS.postTable[0]}px`,
    tailMin: "0px",
    thPad: `${thPadFor(row)}px 0`,
    rowHeight: `${row}px`,
    detailRowHeight: `${Math.max(row, DETAIL_ROW_MIN_PX)}px`,
  };
}
/** How many lines a text takes at `perLine` characters (its own line breaks kept). At least one. */
export function estimateLines(text: string | undefined, perLine: number): number {
  return String(text ?? "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.trim().length / perLine)), 0);
}
/** The page's budget from the data it will print. */
export function quotationFitInput(data: QuotationPDFData, company?: CompanyInfo): QuotationFitInput {
  const from = fromPartyFor(resolveDocLang({ docLang: data.lang, isTaxInvoice: false }), company);
  // a party's column holds about 48 characters a line, the terms block about 160 (measured; FIT_RESERVE_PX and the gaps take a miss)
  const toLines = 1 + (data.customer.contactPerson ? 1 : 0) + estimateLines(data.customer.address, 48) + (data.customer.phone ? 1 : 0);
  const fromLines = from ? 1 + estimateLines(from.address, 48) + (from.email || from.phone ? 1 : 0) : 4;
  const blocks = [data.belowTable, ...(data.belowBlocks ?? [])].filter((b): b is { label: string; text: string } => !!b && !!String(b.text ?? "").trim());
  const note = data.footerNote ?? QUOTATION_FOOTER;
  return {
    rows: data.items.length,
    detailRows: data.items.filter((x) => String(x.detail ?? "").trim()).length,
    sectionRows: (data.sections ?? []).filter((x) => String(x.title ?? "").trim()).length,
    unit: data.layout === "unit",
    sealed: !!(data.issued && !data.draft && company),
    partyLines: Math.max(toLines, fromLines),
    noteLines: estimateLines(note, 160),
    bankLine: !!company?.bankLine,
    belowBlocks: blocks.length,
    belowLines: blocks.reduce((n, b) => n + estimateLines(b.text, 110), 0),
  };
}

// ---- Totals: subtotal + discount + VAT 15% + grand total ----
export function renderQuotationTotalsHTML(
  subtotal: number,
  discount: number,
  vatAmount: number,
  grandTotal: number,
  lang: DocLang = "ar",
  opts: QuotationTotalsOptions = {},
): string {
  const L = (key: "subtotal" | "discount" | "vat15" | "grandTotal") =>
    lang === "en" ? UI[key].en : UI[key].ar;
  const discountRow = opts.hideDiscount ? "" : `
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(L("discount"))}</span><span style="direction: ltr;">${formatMoney(discount, lang)}</span></div>`;
  return `<div style="position: relative; display: flex; justify-content: flex-end;">
      <div style="width: 40%; display: flex; flex-direction: column; gap: 9px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(opts.subtotalLabel ?? L("subtotal"))}</span><span style="direction: ltr;">${formatMoney(subtotal, lang)}</span></div>${discountRow}
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: ${BRAND_COLORS.inkMuted};"><span>${escapeHTML(opts.vatLabel ?? L("vat15"))}</span><span style="direction: ltr;">${formatMoney(vatAmount, lang)}</span></div>
        <div style="height: 6px;"></div>
        <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.borderStrong};"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 8px;"><span style="font-size: 12px; font-weight: 500; color: ${BRAND_COLORS.ink};">${escapeHTML(L("grandTotal"))}</span><span style="font-size: 20px; font-weight: 500; color: ${BRAND_COLORS.primary}; direction: ltr;">${formatMoney(grandTotal, lang)}</span></div>
      </div>
    </div>`;
}

export function renderQuotationHTML(data: QuotationPDFData, company?: CompanyInfo): string {
  // § 62 د — the page's budget: one sheet up to twelve lines (quotationPageMetrics)
  const pageMetrics = quotationPageMetrics(quotationFitInput(data, company));
  const lang: DocLang = resolveDocLang({ docLang: data.lang, isTaxInvoice: false });
  const unit = data.layout === "unit";
  const table = unit
    ? renderUnitPriceBodyHTML(data.items, pageMetrics, lang, data.sections)
    : renderQuotationBodyHTML(data.items, pageMetrics, lang, data.sections);
  const below = renderBelowTableHTML(data.belowTable) + (data.belowBlocks ?? []).map((b) => renderBelowTableHTML(b)).join("");
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
    // § 62 ج (fix) — «من» is the company read from Odoo in every language (BRAND_INFO only without one)
    from: fromPartyFor(lang, company),
    bodyHTML: table + below,
    // a unit-price quotation states no total: each line is one unit's price, and their sum means nothing
    totalsHTML: unit ? undefined : renderQuotationTotalsHTML(
      data.subtotal,
      data.discount,
      data.vatAmount,
      data.grandTotal,
      lang,
      data.totals,
    ),
    footerNote: data.footerNote ?? (lang === "en"
      ? (data.vatInclusive ? `${UI.quotationValidity.en} ${UI.vatInclusiveNote.en}.` : UI.quotationValidity.en)
      : (data.vatInclusive ? `${QUOTATION_FOOTER}. ${UI.vatInclusiveNote.ar}` : QUOTATION_FOOTER)),
    // § 52 أ — «للتحويل: … — IBAN …» under the terms (the same Arabic line in every language);
    // § 62 د — the account's holder written as the company's legal name (res.company), not the bank card's short one
    bankLine: bankLineWithHolder(company?.bankLine, company?.legalNameAr || company?.nameAr),
    showZatcaQR: false,
    legalFooterBar,
    pageMetrics,
    lang: data.lang ? lang : undefined,
    tagline: data.lang ? taglineFor(lang) : undefined,
    // § 62 ج (fix) — a quotation is addressed «إلى / TO», not «فاتورة إلى» (every path: the day's, the manual, the special request's)
    billToLabel: labelForTo(lang),
    fromLabel: data.lang ? labelForFrom(lang) : undefined,
    // § 62 د — «الشروط والملاحظات» on the table's width, the strip one line, the parties' addresses breaking after a comma
    termsLabel: labelForQuotationTerms(lang),
    wideTerms: true,
    legalOneLine: true,
    partyAddressByParts: true,
    fitOnePage: pageMetrics.fit,
    thanksLine: data.lang ? thanksLine(lang, company) : undefined,
    // a preview is a draft to the eye: the word across the page and under the number's place, and never a seal
    draftMark: data.draft ? (lang === "en" ? UI.draft.en : UI.draft.ar) : undefined,
    headerBadge: data.draft ? { text: lang === "en" ? UI.draftBadge.en : UI.draftBadge.ar, color: BRAND_COLORS.accent, bg: "rgba(224, 123, 57, 0.08)" } : undefined,
    // on a page of more than one sheet the seal is not raised above its block: raised, a block that starts a
    // sheet left the seal's top on the sheet before it
    footerSealHTML: issuedSealHTML(data.issued && !data.draft, company, pageMetrics.fit ? undefined : 0),
    sealBesideTotals: true,
    documentDateStr: lang === "en" ? formatDateEn(data.quotationDate) : undefined,
  });
}

export async function generateQuotationPDF(
  data: QuotationPDFData,
  env: Env,
): Promise<Uint8Array> {
  // § 52 أ — with the bank-transfer line (its read never throws: the quotation goes without it)
  const company = await readCompanyInfoWithBank(env);
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
      // § 49 ب — an order priced from a valid list has no price but its frozen ones
      const lookup = await unfrozenLinePrice(env, order, l.product_id, l.packaging_id);
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
      // § 49 ب — the price list's day when the order carries one: its purchase costs are that day's
      const day = order.price_date ?? order.order_date ?? new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
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
/** § 59 د — the lookup purpose of utak_quotation_pdf_v2 (the file outside the window, § 49's validity in its words). */
export const QUOTATION_PDF_V2_PURPOSE = "customer_quotation_pdf_v2";

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
  // § 46 ج — this is the zero-price guard's second net: the router does not
  // create the quotation at all for such an order (src/zero-price.ts); here a
  // quotation created in Odoo, or one whose price disappeared, is still blocked,
  // and the alert names the order.
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
        `🚫 كوتيشن ${data.quotationNumber} (id=${quotationId})${data.order_id ? `، الطلب #${data.order_id}` : ""} — ما أرسلناه للعميل`,
        data.is_manual ? `عرض يدوي: أصناف بلا سعر:` : `أصناف بسعر صفر أو بلا سعر:`,
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
    // Company read here too (legal footer + seal, and § 52 أ the bank-transfer line), as generateQuotationPDF does.
    html = renderQuotationHTML(data, await readCompanyInfoWithBank(env));
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
      // § 59 د — the quotation reaches the customer as an ATTACHED FILE (UTAK-Q-….pdf), never a link:
      //   • inside his 24h window: the document itself, these words as its caption;
      //   • outside it: a template with a DOCUMENT header — utak_quotation_pdf_v2 («سارية حتى الساعة
      //     6:00 صباحاً من اليوم التالي») once Meta holds it APPROVED and UTILITY, else
      //     utak_quotation_pdf_v1 as before;
      //   • no template can go: the document waits for his window in the gateway's queue (§ 33).
      const caption = [
        `📄 عرض السعر رقم ${data.quotationNumber}`,
        ``,
        `العميل: ${data.customer.name}`,
        `الإجمالي: ${data.grandTotal} ر.س`,
        ``,
        `${QUOTATION_FOOTER}. شكراً لتعاملكم مع UTAK 🌿`,
      ].join("\n");
      const header: HeaderMedia = { type: "document", link: uploaded.publicUrl, filename: pdfFileName(data.quotationNumber) };
      const params = quotationTemplateParams(data, quotationDate);
      let resp: Response | null = null;
      try {
        resp = await sendViaGateway(env, {
          purpose: "customer_quotation",
          to: customerPhone,
          content: documentContent(uploaded.publicUrl, data.quotationNumber, caption),
          fallback: [
            { kind: "template", purpose: QUOTATION_PDF_V2_PURPOSE, params, header },
            { kind: "template", purpose: T.CUSTOMER_QUOTATION_PDF, params, header },
          ],
        });
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
