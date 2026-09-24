import type { DocLang } from "./i18n";
import { metaFor } from "./i18n";

// v6 — Shared PDF template ("DNA") for all UTAK documents.
// Mirrors /tmp/utak-invoice-design/UTAK Invoice.dc.html 1:1 in visual output,
// but with no Claude-Design runtime (no <x-dc>, no <sc-for>, no {{ }}).
//
// Every UTAK PDF (invoice, quotation, receipt, delivery note, purchase order)
// must render through renderPDFShell so the brand stays a single source of truth.
//
// v7 (Part B, 2026-09-22) — language modes (ar / en / bi). "ar" preserves the
// exact byte-parity template from Part A; "en" and "bi" branch into the
// additive path with locale-aware font/dir/digits and Space Grotesk for
// English text. See src/i18n.ts for the resolver + copy dictionary.

// ============================================================================
// Brand constants — the visual DNA. Do not tweak these per-document.
// ============================================================================

export const BRAND_COLORS = {
  bgOuter: "#EDEAE3",     // page-container background (visible only in preview)
  bgPage: "#F7F5F0",      // the A4 sheet itself
  ink: "#1A1815",         // primary text
  inkMuted: "#6B6863",    // secondary text / labels
  primary: "#1E5A41",     // UTAK green — logo, watermark, grand total
  accent: "#E07B39",      // orange dot — used sparingly
  borderSoft: "#E8E4DE",  // row separators, footer divider
  borderStrong: "#1A1815", // table header rules, totals divider
  borderDashed: "#C9C4BC", // ZATCA QR placeholder box
  // ZATCA QR modules (2026-09-24): pure black, never a brand colour — tinting
  // the dark modules lowers the contrast a phone camera needs. The QR's
  // light background (and its quiet zone) is bgPage, so it sits on the paper
  // instead of printing as a white box.
  qrInk: "#000000",
} as const;

export const BRAND_FONT = "IBM Plex Sans Arabic";

// Typography + rules of the approved invoice, as tokens (2026-09-24). The
// invoice/quotation/receipt/… shell interpolates these exact values (its HTML
// is byte-identical to the literals it had), and the financial statements
// (scripts/lib/fin-statements-render.mjs) style themselves from the same
// objects, so the two families never drift apart.
export const BRAND_TYPE = {
  docTitle: { size: "32px", weight: 300 },                        // «فاتورة»
  sectionTitle: { size: "24px", weight: 300 },                    // a statement's title inside a multi-section doc
  brandName: { size: "24px", weight: 500, tracking: "0.02em" },   // «شركة يوتاك», primary green
  tagline: { size: "10px", weight: 400, tracking: "0.14em" },
  meta: { size: "13px", weight: 400 },                            // doc number, date, party lines
  label: { size: "10px", weight: 500, tracking: "0.2em" },        // «فاتورة إلى / BILL TO», «شروط الدفع»
  th: { size: "10px", weight: 500, tracking: "0.16em" },          // table column heads
  cell: { size: "12px", weight: 400 },                            // table rows, totals rows
  grandTotal: { size: "20px", weight: 500 },                      // primary green
  legal: { size: "8.5px", weight: 400, tracking: "0.06em", lineHeight: 1.6 },
  pagePadding: "20mm",
} as const;

export const BRAND_RULES = {
  header: `0.5px solid ${BRAND_COLORS.primary}`,      // under the header
  th: `0.5px solid ${BRAND_COLORS.borderStrong}`,     // above + below the column heads, totals divider
  row: `0.25px solid ${BRAND_COLORS.borderSoft}`,     // between rows, footer divider
} as const;

// The faint «UTAK» across the middle of every page (4 % green).
export const BRAND_WATERMARK_STYLE =
  `top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 160px; font-weight: 200; letter-spacing: 0.06em; color: ${BRAND_COLORS.primary}; opacity: 0.04; pointer-events: none; user-select: none; white-space: nowrap;`;

export const BRAND_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@200;300;400;500;600&display=swap";

// The UTAK mark on a TRANSPARENT background (2026-09-24). Source:
// Desktop/Utak/logos kit/svg/utak-icon-color.svg — the icon with its built-in
// safe area (viewBox 0 0 100 100, «لا تغيّر مسافة الأمان»). Until 09-24 the
// documents used utak-avatar-light.svg, whose first element is a #F7F5F0
// square: invisible on the cream invoice, a visible box on anything else.
// Same two colours, same geometry; vector, so sharp at any print size.
// Printed at 37.2 px with an 11.4 px margin: the glyph sits exactly where the
// avatar (scale 0.62 inside a 60 px square) put it.
export const UTAK_LOGO_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M25 16 v40 a25 25 0 0 0 50 0 V38.5" fill="none" stroke="${BRAND_COLORS.primary}" stroke-width="15" stroke-linecap="round"/><rect x="66.25" y="6" width="17.5" height="17.5" fill="${BRAND_COLORS.accent}"/></svg>`;
export const UTAK_LOGO_DATA_URL = "data:image/svg+xml;base64," + btoa(UTAK_LOGO_SVG);
export const UTAK_LOGO_IMG_STYLE = "width: 37.2px; height: 37.2px; margin: 11.4px; display: block;";


// Company info block that appears in the FROM slot by default.
// TODO: promote to env-driven config once ZATCA registration + CR + VAT numbers land.
export const BRAND_INFO = {
  nameAr: "شركة يوتاك",
  nameEn: "UTAK",
  tagline: "توزيع منتجات زراعية طازجة",
  address: "الرياض، المملكة العربية السعودية",
  email: "care@utak.com",
  phone: "+966 58 004 0467",
  cr: "",   // Commercial Registration — TBD
  vat: "",  // VAT number — TBD
} as const;

// ============================================================================
// Helpers
// ============================================================================

export function escapeHTML(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatMoney(n: number, lang: DocLang = "ar"): string {
  const rounded = Math.round(n * 100) / 100;
  const num = rounded.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // ar and bi keep the SAR word in Arabic ("ريال") on the same line the
  // Arabic side of the doc uses; en swaps to the ISO 4217 label "SAR"
  // before the number, matching Saudi-English invoice practice.
  if (lang === "en") return `SAR ${num}`;
  return `${num} ريال`;
}

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
export function toArabicNumerals(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]);
}

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

// "٥ سبتمبر ٢٠٢٦ — 2026/09/05"
export function formatDateArabic(date: Date): string {
  const day = date.getDate();
  const month = ARABIC_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const iso = `${year}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  return `${toArabicNumerals(day)} ${month} ${toArabicNumerals(year)} — ${iso}`;
}

// Dashed 80×80 placeholder that says "ZATCA QR" — swapped for a real QR later.
export function generateZatcaQRPlaceholder(): string {
  return `<div style="width: 80px; height: 80px; border: 0.5px dashed ${BRAND_COLORS.borderDashed}; display: flex; align-items: center; justify-content: center; text-align: center;">
      <span style="font-size: 7px; font-weight: 400; color: ${BRAND_COLORS.borderDashed}; letter-spacing: 0.1em; line-height: 1.6;">ZATCA<br>QR</span>
    </div>`;
}

// Company seal over the authorized signature, bottom-left of the last page
// (2026-09-24). Seal at its physical 40 mm, slightly rotated and overlapping
// the signature like a hand-pressed stamp. Callers pass it ONLY for issued
// documents (an issued invoice, quotation, receipt, delivery note, purchase
// order, official doc) — drafts and previews never carry it. Either image
// may be missing: no signature on file → the seal alone; nothing on file →
// "" (no empty frame). Under a signature: the signatory's name and title,
// Arabic over English, below the seal so no ink covers the text.
export const SEAL_SIZE_MM = 40;
export const SIGNATORY = {
  ar: "البراء عبدالوهاب الوصابي — المدير العام",
  en: "Albaraa Abdulwahab Alwesabi — General Manager",
} as const;
const SIGNATORY_LINE_MM = 7;

export function renderSealSignatureBlock(
  images: { stamp?: string; signature?: string },
  opts: { marginTopMm?: number; raiseMm?: number; signatory?: { ar: string; en: string } | null } = {},
): string {
  // raiseMm: the seal rises that far above its box (absolute, so no layout
  // effect) — a pressed stamp over the gap above it. A negative margin was
  // tried first and Chromium's print fragmentation overlapped the next lines.
  const raise = opts.raiseMm ?? 0;
  const { stamp, signature } = images;
  if (!stamp && !signature) return "";
  const who = signature ? (opts.signatory === undefined ? SIGNATORY : opts.signatory) : null;
  const cap = who ? SIGNATORY_LINE_MM : 0;
  const sig = signature
    ? `<img data-utak="signature" src="${escapeHTML(signature)}" alt="التوقيع" style="position: absolute; left: 0; bottom: ${4 + cap}mm; width: 46mm; height: 22mm; object-fit: contain; object-position: left bottom;" />`
    : "";
  const seal = stamp
    ? `<img data-utak="stamp" src="${escapeHTML(stamp)}" alt="ختم الشركة" style="position: absolute; left: ${signature ? "22mm" : "0"}; top: ${-raise}mm; width: ${SEAL_SIZE_MM}mm; height: ${SEAL_SIZE_MM}mm; transform: rotate(-8deg); opacity: 0.92; mix-blend-mode: multiply;" />`
    : "";
  const caption = who
    ? `<div data-utak="signatory" style="position: absolute; left: 0; bottom: 0; height: ${cap}mm; display: flex; flex-direction: column; justify-content: flex-end; gap: 0.6mm; font-size: 7.5px; line-height: 1.25; color: ${BRAND_COLORS.inkMuted}; white-space: nowrap;">
        <div dir="rtl" style="text-align: left; font-weight: 500;">${escapeHTML(who.ar)}</div>
        <div dir="ltr" style="text-align: left; letter-spacing: 0.02em;">${escapeHTML(who.en)}</div>
      </div>`
    : "";
  // The seal is a circle: a small rotation keeps it inside its own 40 mm box.
  const width = stamp ? (signature ? 22 : 0) + SEAL_SIZE_MM : 50;
  return `<div class="utak-block" data-utak="seal-signature" style="display: flex; direction: ltr; justify-content: flex-start; margin-top: ${opts.marginTopMm ?? 8}mm;">
      <div style="position: relative; width: ${width}mm; height: ${SEAL_SIZE_MM - raise + cap}mm;">${sig}${seal}${caption}</div>
    </div>`;
}

/** The seal block for an ISSUED quotation / receipt / delivery note /
 *  purchase order (2026-09-24). Callers pass it with sealBesideTotals: it
 *  sits beside the totals, where the page is empty, so a one-page document
 *  stays one page. undefined for a preview or draft — which also keeps the
 *  byte-parity template. */
export function issuedSealHTML(
  issued: boolean | undefined,
  company?: { stampImage?: string; signatureImage?: string },
): string | undefined {
  if (!issued || !company) return undefined;
  return renderSealSignatureBlock({ stamp: company.stampImage, signature: company.signatureImage }, { marginTopMm: 0, raiseMm: 6 }) || undefined;
}

// ============================================================================
// Types
// ============================================================================

export interface PartyInfo {
  name: string;
  contactName?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface PageMetrics {
  gap: string;
  preTable: string;
  postTable: string;
  tailMin: string;
  thPad: string;
  rowHeight: string;
  dense: boolean;
}

export function computePageMetrics(itemCount: number): PageMetrics {
  const dense = itemCount > 12;
  return {
    dense,
    gap: dense ? "16px" : "24px",
    preTable: dense ? "20px" : "40px",
    postTable: dense ? "24px" : "40px",
    tailMin: dense ? "0px" : "40px",
    thPad: dense ? "6px 0" : "10px 0",
    rowHeight: dense
      ? Math.max(15, Math.floor(385 / Math.max(1, itemCount))) + "px"
      : "36px",
  };
}

// ============================================================================
// Sub-renderers (kept private — every doc goes through renderPDFShell)
// ============================================================================

function renderParty(label: string, party: PartyInfo, alignEnd: boolean): string {
  const align = alignEnd ? "text-align: left;" : "";
  return `<div style="display: flex; flex-direction: column; gap: 10px; ${align}">
      <div style="font-size: ${BRAND_TYPE.label.size}; font-weight: ${BRAND_TYPE.label.weight}; color: ${BRAND_COLORS.inkMuted}; letter-spacing: ${BRAND_TYPE.label.tracking};">${escapeHTML(label)}</div>
      <div style="display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 400;">
        <div>${escapeHTML(party.name)}</div>
        ${party.contactName ? `<div style="color: ${BRAND_COLORS.inkMuted};">${escapeHTML(party.contactName)}</div>` : ""}
        ${party.address ? `<div style="color: ${BRAND_COLORS.inkMuted};">${escapeHTML(party.address)}</div>` : ""}
        ${party.email ? `<div style="color: ${BRAND_COLORS.inkMuted}; direction: ltr;${alignEnd ? "" : " text-align: right;"}">${escapeHTML(party.email)}</div>` : ""}
        ${party.phone ? `<div style="color: ${BRAND_COLORS.inkMuted}; direction: ltr;${alignEnd ? "" : " text-align: right;"}">${escapeHTML(party.phone)}</div>` : ""}
      </div>
    </div>`;
}

/** The invoice header (logo, «شركة يوتاك», tagline · title, number, date),
 *  shared by every UTAK document and the financial statements' cover. */
export function renderBrandHeader(
  documentTitle: string,
  documentNumber: string,
  documentDate: Date,
  overrides?: { taglineOverride?: string; brandNameOverride?: string; documentDateStrOverride?: string },
): string {
  return renderHeader(documentTitle, documentNumber, documentDate, undefined, overrides);
}

function renderHeader(
  documentTitle: string,
  documentNumber: string,
  documentDate: Date,
  headerBadge?: HeaderBadge,
  overrides?: { taglineOverride?: string; brandNameOverride?: string; documentDateStrOverride?: string; forceLtrHeader?: boolean },
): string {
  const dateStr = overrides?.documentDateStrOverride ?? formatDateArabic(documentDate);
  const tagline = overrides?.taglineOverride ?? BRAND_INFO.tagline;
  const brandName = overrides?.brandNameOverride ?? BRAND_INFO.nameAr;
  // When rendered as an English document, the title reads left-to-right and
  // the date sits inside the ltr-primary flow. Byte-parity path leaves this
  // undefined and keeps the legacy `direction: rtl` markup exactly as before.
  const titleDir = overrides?.forceLtrHeader ? "ltr" : "rtl";
  const dateDir = overrides?.forceLtrHeader ? "ltr" : "rtl";
  const dateAlign = overrides?.forceLtrHeader ? "left" : "right";
  // The `headerBadge`-attached tail is a separate string so the byte-parity
  // path (legacy fixtures, no badge) reproduces the exact original template
  // without any extra whitespace.
  const badgeTail = headerBadge
    ? `
          <div style="margin-top: 4px;"><div style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 0.5px solid ${headerBadge.color}; background: ${headerBadge.bg}; color: ${headerBadge.color}; font-size: 10px; font-weight: 500; letter-spacing: 0.16em; direction: rtl;">${escapeHTML(headerBadge.text)}</div></div>`
    : "";
  return `<div style="position: relative; display: flex; align-items: flex-start; justify-content: space-between;">
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <img src="${UTAK_LOGO_DATA_URL}" style="${UTAK_LOGO_IMG_STYLE}" alt="UTAK" />
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: ${BRAND_TYPE.brandName.size}; font-weight: ${BRAND_TYPE.brandName.weight}; color: ${BRAND_COLORS.primary}; letter-spacing: ${BRAND_TYPE.brandName.tracking}; white-space: nowrap;">${escapeHTML(brandName)}</div>
          <div style="font-size: ${BRAND_TYPE.tagline.size}; font-weight: ${BRAND_TYPE.tagline.weight}; color: ${BRAND_COLORS.inkMuted}; letter-spacing: ${BRAND_TYPE.tagline.tracking};">${escapeHTML(tagline)}</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 10px; direction: ltr; text-align: left;">
        <div style="font-size: ${BRAND_TYPE.docTitle.size}; font-weight: ${BRAND_TYPE.docTitle.weight}; line-height: 1; direction: ${titleDir};">${escapeHTML(documentTitle)}</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 7px;">
            <span style="width: 4px; height: 4px; border-radius: 50%; background: ${BRAND_COLORS.accent}; display: inline-block;"></span>
            <span style="font-size: ${BRAND_TYPE.meta.size}; font-weight: ${BRAND_TYPE.meta.weight};">${escapeHTML(documentNumber)}</span>
          </div>
          <div style="font-size: ${BRAND_TYPE.meta.size}; font-weight: ${BRAND_TYPE.meta.weight}; color: ${BRAND_COLORS.inkMuted}; direction: ${dateDir}; text-align: ${dateAlign};">${escapeHTML(dateStr)}</div>${badgeTail}
        </div>
      </div>
    </div>`;
}

// Additive: rendered at the very bottom of the page (below the "شكراً"
// line) when `legalFooterBar` is passed. Empty fields drop so no orphan
// " · " ever shows on either end. Latin/number-heavy fields (phone, email)
// sit inside <bdi dir="ltr"> so they render left-to-right inside the RTL
// page. The 5 legacy documents never pass legalFooterBar without a company,
// so this function is never called with a nullish info.
//
// Layout by language:
//   ar (default) — 2 thin lines:
//     line 1: name  ·  س.ت CR  ·  الرقم الضريبي VAT
//     line 2: address  ·  phone  ·  email
//   en — 2 thin lines, English mirror if provided:
//     line 1: nameEn  ·  CR No. CR  ·  VAT No. VAT
//     line 2: addressEn  ·  phone  ·  email
//   bi — 3 thin lines:
//     line 1: name (ar)  ·  س.ت CR  ·  الرقم الضريبي VAT
//     line 2: nameEn      ·  CR No. CR  ·  VAT No. VAT
//     line 3: address (ar) ·  phone  ·  email
export function renderLegalFooterBar(info: LegalFooterInfo, lang: DocLang = "ar"): string {
  const lineStyle = `text-align: center; font-size: ${BRAND_TYPE.legal.size}; font-weight: ${BRAND_TYPE.legal.weight}; color: ${BRAND_COLORS.inkMuted}; letter-spacing: ${BRAND_TYPE.legal.tracking}; line-height: ${BRAND_TYPE.legal.lineHeight};`;
  const asBdi = (s: string) => `<bdi dir="ltr">${escapeHTML(s.trim())}</bdi>`;
  const parts: string[] = [`<div style="height: 8px;"></div>`];

  if (lang === "en") {
    const crLabel = info.crLabelEn ?? "CR No.";
    const vatLabel = info.vatLabelEn ?? "VAT No.";
    const line1: string[] = [];
    if (info.nameEn && info.nameEn.trim()) line1.push(escapeHTML(info.nameEn.trim()));
    else if (info.name && info.name.trim()) line1.push(escapeHTML(info.name.trim()));
    if (info.cr && info.cr.trim()) line1.push(`${crLabel} ${asBdi(info.cr)}`);
    if (info.vat && info.vat.trim()) line1.push(`${vatLabel} ${asBdi(info.vat)}`);
    const line2: string[] = [];
    if (info.addressEn && info.addressEn.trim()) line2.push(escapeHTML(info.addressEn.trim()));
    else if (info.address && info.address.trim()) line2.push(escapeHTML(info.address.trim()));
    if (info.phone && info.phone.trim()) line2.push(asBdi(info.phone));
    if (info.email && info.email.trim()) line2.push(asBdi(info.email));
    if (line1.length === 0 && line2.length === 0) return "";
    if (line1.length > 0) parts.push(`<div style="${lineStyle}">${line1.join(" · ")}</div>`);
    if (line2.length > 0) parts.push(`<div style="${lineStyle}">${line2.join(" · ")}</div>`);
    return parts.join("\n    ");
  }

  // ar and bi both share the first Arabic identity line.
  const line1: string[] = [];
  if (info.name && info.name.trim()) line1.push(escapeHTML(info.name.trim()));
  if (info.cr && info.cr.trim()) line1.push(`س.ت ${asBdi(info.cr)}`);
  if (info.vat && info.vat.trim()) line1.push(`الرقم الضريبي ${asBdi(info.vat)}`);

  // bi inserts an English mirror line between line1 and line2.
  let lineMid: string[] | null = null;
  if (lang === "bi") {
    const crLabel = info.crLabelEn ?? "CR No.";
    const vatLabel = info.vatLabelEn ?? "VAT No.";
    lineMid = [];
    if (info.nameEn && info.nameEn.trim()) lineMid.push(escapeHTML(info.nameEn.trim()));
    else if (info.name && info.name.trim()) lineMid.push(escapeHTML(info.name.trim()));
    if (info.cr && info.cr.trim()) lineMid.push(`${crLabel} ${asBdi(info.cr)}`);
    if (info.vat && info.vat.trim()) lineMid.push(`${vatLabel} ${asBdi(info.vat)}`);
  }

  const line2: string[] = [];
  if (info.address && info.address.trim()) line2.push(escapeHTML(info.address.trim()));
  if (info.phone && info.phone.trim()) line2.push(asBdi(info.phone));
  if (info.email && info.email.trim()) line2.push(asBdi(info.email));

  if (line1.length === 0 && (lineMid ?? []).length === 0 && line2.length === 0) return "";
  if (line1.length > 0) parts.push(`<div style="${lineStyle}">${line1.join(" · ")}</div>`);
  // The English mirror is an LTR line: inside the RTL page without dir it
  // printed «315022736600003 .UTAK Company · … VAT No» (2026-09-24).
  if (lineMid && lineMid.length > 0) parts.push(`<div dir="ltr" style="${lineStyle}">${lineMid.join(" · ")}</div>`);
  if (line2.length > 0) parts.push(`<div style="${lineStyle}">${line2.join(" · ")}</div>`);
  return parts.join("\n    ");
}

function renderFooter(footerNote: string, showZatcaQR: boolean, termsLabel: string = "شروط الدفع", thanksTextOverride?: string, leftSlotHTML?: string): string {
  // The left cell of the terms row: the seal + signature on an issued doc
  // (bottom-left of the last page, no extra row), else the QR placeholder or
  // an 80px reserve that keeps the grid symmetric.
  const qrCell = leftSlotHTML
    ? leftSlotHTML
    : showZatcaQR
    ? generateZatcaQRPlaceholder()
    : `<div style="width: 80px;"></div>`;
  // Legacy Arabic default preserved for the byte-parity path (which never
  // passes thanksTextOverride).
  const thanks = thanksTextOverride ?? `شكراً لثقتكم في ${BRAND_INFO.nameAr}`;
  return `<div style="position: relative;">
      <div style="height: 0; border-top: ${BRAND_RULES.row};"></div>
      <div style="height: 20px;"></div>
      <div style="display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: flex-start;">
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font-size: ${BRAND_TYPE.label.size}; font-weight: ${BRAND_TYPE.label.weight}; color: ${BRAND_COLORS.inkMuted}; letter-spacing: ${BRAND_TYPE.label.tracking};">${escapeHTML(termsLabel)}</div>
          <div style="font-size: 10px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; line-height: 1.7; max-width: 62%;">${escapeHTML(footerNote)}</div>
        </div>
        ${qrCell}
      </div>
      <div style="height: 18px;"></div>
      <div style="text-align: center; font-size: 10px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.08em;">${escapeHTML(thanks)}</div>
    </div>`;
}

// ============================================================================
// Core renderer — every UTAK PDF passes through here.
// ============================================================================

export interface HeaderBadge {
  text: string;
  color: string;   // border + text
  bg: string;      // background wash
}

export interface LegalFooterInfo {
  name?: string;
  cr?: string;
  vat?: string;
  address?: string;
  phone?: string;
  email?: string;
  // Optional English mirrors — used when lang="en" (English-only mirror
  // instead of the Arabic values) or lang="bi" (extra middle line under
  // the Arabic identity line).
  nameEn?: string;
  addressEn?: string;
  // Optional English labels — filled from i18n. Byte-parity path (lang=ar)
  // never uses these. In "en" mode they replace "س.ت" / "الرقم الضريبي"; in
  // "bi" mode they appear on the middle line.
  crLabelEn?: string;
  vatLabelEn?: string;
}

export interface RenderPDFShellOptions {
  documentTitle: string;       // "فاتورة" | "عرض سعر" | "إيصال" | "إذن تسليم" | "أمر شراء"
  documentNumber: string;      // e.g. "INV-2026-0147"
  documentDate: Date;
  billTo: PartyInfo;
  from?: PartyInfo;            // defaults to BRAND_INFO
  bodyHTML: string;            // caller-owned body (table, lines, whatever the doc needs)
  totalsHTML?: string;         // optional totals block (invoice / quotation yes; delivery note no)
  footerNote?: string;         // "الدفع خلال ٣٠ يوماً..." — defaults per doc type
  showZatcaQR?: boolean;       // true for tax invoice; false for other docs
  pageMetrics: PageMetrics;
  /**
   * Language mode:
   *   - undefined or "ar" → byte-parity Arabic template (Part A snapshot).
   *   - "en"              → English shell (dir=ltr, Space Grotesk, western digits).
   *   - "bi"              → Arabic-first, English mirrors under item names
   *                          and a 3-line legal footer.
   * All labels/strings are localized by the caller through renderParty/
   * renderFooter/legalFooterBar arguments; the shell itself only decides
   * dir/font/date/watermark.
   */
  lang?: DocLang;
  /** Header tagline override; when undefined defaults to BRAND_INFO.tagline. */
  tagline?: string;
  /** Party-slot label overrides — for "من / FROM"-style bilingual labels. */
  billToLabel?: string;
  fromLabel?: string;
  /** Localized "شكراً" line; overrides thanksOverride behavior. */
  thanksLine?: string;
  /** Localized "شروط الدفع" heading in the terms block. */
  termsLabel?: string;
  /** Overriding date string (used by en to show "22 Sep 2026" instead of the
   *  Arabic-locale two-part string). */
  documentDateStr?: string;

  // -----------------------------------------------------------------
  // Additive, official-doc-only options. Every one is undefined for
  // invoice/quotation/receipt/delivery-note/purchase-order, and the
  // rendering paths below collapse to the pre-existing HTML byte-for-byte
  // when they are all left off. Do NOT surface any of these to the five
  // legacy documents without confirming pixel-parity again.
  // -----------------------------------------------------------------

  /** Replaces the "فاتورة إلى / BILL TO" label above the recipient block. */
  recipientLabel?: string;
  /** Replaces the "من / FROM" label above the sender block. */
  senderLabel?: string;
  /** When true, the bill-to slot is hidden and FROM spans the full row. */
  hideBillTo?: boolean;
  /** When true, the FROM slot is hidden and bill-to spans the full row. */
  hideFrom?: boolean;
  /** When true, the whole footer note + ZATCA row is skipped (official docs). */
  hideFooterNote?: boolean;
  /** When true, the "شكراً لثقتكم في UTAK" line is skipped. */
  hideThanks?: boolean;
  /** Custom "شكراً" replacement line — ignored when hideThanks=true. */
  thanksOverride?: string;
  /** Header badge (e.g. "معاينة — غير معتمد") rendered under the doc number. */
  headerBadge?: HeaderBadge;
  /** Legal footer strip rendered under the thanks line. Empty fields drop. */
  legalFooterBar?: LegalFooterInfo;
  /** Renders a full "body-only" shell — the parties-row is suppressed and the
   *  callers own the layout. Used by official-doc blocks. */
  suppressPartiesRow?: boolean;
  /** Extra HTML rendered ABOVE the parties-row (or above the body when the
   *  parties-row is suppressed). Used for a subject line, a to-line, etc. */
  aboveBodyHTML?: string;
  /** Extra HTML rendered directly below the body, before the tailMin filler,
   *  above the footer. Used for signatures + stamps — right after content,
   *  never anchored to the page bottom. */
  belowBodyHTML?: string;
  /** Seal + signature block (renderSealSignatureBlock) for an ISSUED doc.
   *  Sits in the left cell of the terms row — bottom-left of the last page —
   *  or, when the footer is hidden, right after the body. */
  footerSealHTML?: string;
  /** Put footerSealHTML beside the totals (same row, start side — the right
   *  of an RTL page, where the totals leave the width empty) instead of in
   *  the terms row. The row grows only by what the block is taller than the
   *  totals, so a 7-row quotation stays one page (2026-09-24). */
  sealBesideTotals?: boolean;
  /** When true, adds multi-page @media print rules (thead repetition,
   *  break-inside: avoid on tr/.utak-block, widows/orphans). Off by default
   *  so the 5 legacy documents render byte-identical HTML. */
  multiPageBreaks?: boolean;
}

const DEFAULT_FOOTER_NOTE =
  "الدفع خلال ٣٠ يوماً من تاريخ الفاتورة. تحويل بنكي أو نقداً عند التسليم.";

export function renderPDFShell(opts: RenderPDFShellOptions): string {
  const from: PartyInfo = opts.from ?? {
    name: BRAND_INFO.nameAr,
    address: BRAND_INFO.address,
    email: BRAND_INFO.email,
    phone: BRAND_INFO.phone,
  };
  const showZatcaQR = opts.showZatcaQR ?? true;
  const footerNote = opts.footerNote ?? DEFAULT_FOOTER_NOTE;
  const m = opts.pageMetrics;

  // -----------------------------------------------------------------
  // Byte-parity gate. When every "structural" additive option is absent
  // we hit the same template literal as before — no extra whitespace, no
  // dropped interpolations, no reshuffled sections. See tests/pdf-template
  // .test.mts::"legacy fixtures produce byte-identical HTML". Do NOT
  // touch this branch without regenerating the pixel-diff PNGs for the
  // five legacy fixtures.
  //
  // legalFooterBar is intentionally NOT part of anyAdditive: it appends a
  // thin strip AT THE END of the layout below the "شكراً" line and
  // otherwise touches nothing. Rendering it here keeps every doc's HTML
  // diff before/after Part A confined to that one additive strip — nothing
  // else changes shape.
  // -----------------------------------------------------------------
  const langNonAr = opts.lang !== undefined && opts.lang !== "ar";
  const anyAdditive =
    opts.recipientLabel !== undefined ||
    opts.senderLabel !== undefined ||
    opts.hideBillTo === true ||
    opts.hideFrom === true ||
    opts.hideFooterNote === true ||
    opts.hideThanks === true ||
    opts.thanksOverride !== undefined ||
    opts.headerBadge !== undefined ||
    opts.suppressPartiesRow === true ||
    opts.aboveBodyHTML !== undefined ||
    opts.belowBodyHTML !== undefined ||
    opts.footerSealHTML !== undefined ||
    opts.multiPageBreaks === true ||
    langNonAr;

  if (!anyAdditive) {
    // 2026-09-22 (item 4): pagination fix — the previous byte-parity template
    // used `height: 297mm; overflow: hidden`, which silently CLIPPED any
    // content beyond one A4 page. A 40-item invoice lost rows past the fold —
    // a financial + ZATCA compliance risk. The fixed height is gone; a
    // `min-height: 297mm` keeps the single-page look identical while letting
    // long content flow across pages. The pagination rules below make
    // Chromium's print engine (Gotenberg's Chromium backend) split cleanly:
    //   - thead re-renders at the top of every page (display: table-header-group)
    //   - tr rows never split mid-row
    //   - .utak-block wrappers (totals + terms + QR) stay together
    //   - orphans/widows keep isolated lines away from page bottoms
    // Legal footer stays inline at end-of-content (last page). The per-page
    // legal footer + page numbering rides on Gotenberg's own footerHtml when
    // generateXPDF passes it; the raw HTML here is deliberately the same.
    const legalBarByteParity = opts.legalFooterBar
      ? "\n    " + renderLegalFooterBar(opts.legalFooterBar, "ar")
      : "";
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${BRAND_FONT_HREF}" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: ${BRAND_COLORS.bgPage}; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 0; background: ${BRAND_COLORS.bgPage}; }
  @media print {
    html, body { background: ${BRAND_COLORS.bgPage}; }
    .utak-page { box-shadow: none !important; margin: 0 !important; break-after: page; }
    .utak-page:last-child { break-after: auto; }
    thead { display: table-header-group; }
    tr, .utak-block { break-inside: avoid; page-break-inside: avoid; }
    p, li { orphans: 3; widows: 3; }
  }
</style>
</head>
<body>
<div dir="rtl" style="font-family: '${BRAND_FONT}', 'Tajawal', sans-serif; font-feature-settings: 'tnum' 1; background: ${BRAND_COLORS.bgPage};">
  <div class="utak-page" style="position: relative; width: 210mm; min-height: 297mm; box-sizing: border-box; padding: ${BRAND_TYPE.pagePadding}; background: ${BRAND_COLORS.bgPage}; color: ${BRAND_COLORS.ink}; display: flex; flex-direction: column;">

    <div style="position: absolute; ${BRAND_WATERMARK_STYLE}">${escapeHTML(BRAND_INFO.nameEn)}</div>

    ${renderHeader(opts.documentTitle, opts.documentNumber, opts.documentDate)}

    <div style="height: ${m.gap};"></div>
    <div style="height: 0; border-top: ${BRAND_RULES.header};"></div>
    <div style="height: ${m.gap};"></div>

    <div style="position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
      ${renderParty("فاتورة إلى / BILL TO", opts.billTo, false)}
      ${renderParty("من / FROM", from, true)}
    </div>

    <div style="height: ${m.preTable};"></div>

    ${opts.bodyHTML}

    <div style="height: ${m.postTable};"></div>

    <div class="utak-block">${opts.totalsHTML ?? ""}</div>

    <div style="flex: 1; min-height: ${m.tailMin};"></div>

    ${renderFooter(footerNote, showZatcaQR)}${legalBarByteParity}
  </div>
</div>
</body>
</html>`;
  }

  // -----------------------------------------------------------------
  // Additive path — only reached when at least one new option was set.
  // Any output shape difference from the legacy path lives here.
  // -----------------------------------------------------------------
  const lang: DocLang = opts.lang ?? "ar";
  const langMeta = metaFor(lang);
  const recipientLabel = opts.recipientLabel ?? opts.billToLabel ?? "فاتورة إلى / BILL TO";
  const senderLabel = opts.senderLabel ?? opts.fromLabel ?? "من / FROM";
  const hideBillTo = opts.hideBillTo === true;
  const hideFrom = opts.hideFrom === true;

  let partiesRow = "";
  if (!opts.suppressPartiesRow) {
    if (hideBillTo && hideFrom) {
      partiesRow = "";
    } else if (hideBillTo) {
      partiesRow = `<div style="position: relative; display: grid; grid-template-columns: 1fr; gap: 32px;">
      ${renderParty(senderLabel, from, true)}
    </div>`;
    } else if (hideFrom) {
      partiesRow = `<div style="position: relative; display: grid; grid-template-columns: 1fr; gap: 32px;">
      ${renderParty(recipientLabel, opts.billTo, false)}
    </div>`;
    } else {
      partiesRow = `<div style="position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
      ${renderParty(recipientLabel, opts.billTo, false)}
      ${renderParty(senderLabel, from, true)}
    </div>`;
    }
  }

  const termsLabel = opts.termsLabel ?? "شروط الدفع";
  // renderFooter's built-in thanks: when hideThanks=true we blank it out to
  // preserve the legacy behavior (no thanks line inside the footer block);
  // when opts.thanksLine is set (localized replacement) we route it into
  // renderFooter so it sits at the same position, not below the whole block.
  const inlineThanks = opts.hideThanks ? "" : opts.thanksLine;
  const sealBeside = !!(opts.sealBesideTotals && opts.footerSealHTML && !opts.hideFooterNote);
  const footerBlock = opts.hideFooterNote
    ? ""
    : renderFooter(footerNote, showZatcaQR, termsLabel, inlineThanks, sealBeside ? undefined : opts.footerSealHTML);
  // One grid cell holding both: the totals keep their full width (content
  // sits on the end side), the seal block sits on the start side, bottoms
  // aligned. Height = the taller of the two.
  const totalsRow = sealBeside
    ? `<div class="utak-block" style="display: grid;">
      <div style="grid-area: 1 / 1; justify-self: start; align-self: end;">${opts.footerSealHTML}</div>
      <div style="grid-area: 1 / 1;">${opts.totalsHTML ?? ""}</div>
    </div>`
    : opts.totalsHTML ? `<div class="utak-block">${opts.totalsHTML}</div>` : "";
  // The old thanksOverride hook was an ADDITIONAL line below the footer;
  // preserved as-is when set for older callers (official-doc's issue path).
  const thanksLine = opts.hideThanks
    ? ""
    : opts.thanksOverride && !opts.thanksLine
      ? `<div style="text-align: center; font-size: 10px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.08em;">${escapeHTML(opts.thanksOverride)}</div>`
      : "";
  const legalBar = opts.legalFooterBar ? renderLegalFooterBar(opts.legalFooterBar, lang) : "";
  const aboveBody = opts.aboveBodyHTML ?? "";
  const belowBody = (opts.belowBodyHTML ?? "") + (opts.hideFooterNote && opts.footerSealHTML ? opts.footerSealHTML : "");
  // With a seal block the minimum gap above the footer (tailMin) goes: the
  // 40 mm block already separates body and footer, and keeping both pushed a
  // 7-row quotation's legal footer onto a second page (2026-09-24).

  // 2026-09-22 (item 4): pagination is now the default for every doc,
  // matching the byte-parity path above. `overflow: hidden` was silently
  // clipping content on long invoices/quotations regardless of lang, so
  // both branches now use `min-height: 297mm` and drop the fixed height.
  // multiPageBreaks becomes purely an escape hatch — retained for callers
  // that already pass it, but the CSS below no longer differs by default.
  const pageStyle = `position: relative; width: 210mm; min-height: 297mm; box-sizing: border-box; padding: ${BRAND_TYPE.pagePadding}; background: ${BRAND_COLORS.bgPage}; color: ${BRAND_COLORS.ink}; display: flex; flex-direction: column;`;

  // Font stack per language mode. Arabic and Space Grotesk are loaded from
  // Google Fonts; the bilingual mode loads both. The `lang` attribute on
  // <html> lets Chromium pick the right script for each glyph.
  const fontFamilies: string[] = [];
  if (langMeta.fonts.english) fontFamilies.push("'Space Grotesk'");
  if (langMeta.fonts.arabic) fontFamilies.push(`'${BRAND_FONT}'`);
  fontFamilies.push("'Tajawal'", "sans-serif");
  const fontStack = fontFamilies.join(", ");
  const fontImports = [
    langMeta.fonts.arabic ? `family=IBM+Plex+Sans+Arabic:wght@200;300;400;500;600` : "",
    langMeta.fonts.english ? `family=Space+Grotesk:wght@300;400;500;600` : "",
  ].filter(Boolean).join("&");
  const fontHref = `https://fonts.googleapis.com/css2?${fontImports}&display=swap`;
  return `<!DOCTYPE html>
<html lang="${langMeta.primary}" dir="${langMeta.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontHref}" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: ${BRAND_COLORS.bgPage}; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 0; background: ${BRAND_COLORS.bgPage}; }
  @media print {
    html, body { background: ${BRAND_COLORS.bgPage}; }
    .utak-page { box-shadow: none !important; margin: 0 !important; break-after: page; }
    .utak-page:last-child { break-after: auto; }
    thead { display: table-header-group; }
    tr, .utak-block { break-inside: avoid; page-break-inside: avoid; }
    p, li { orphans: 3; widows: 3; }
  }
</style>
</head>
<body>
<div dir="${langMeta.dir}" style="font-family: ${fontStack}; font-feature-settings: 'tnum' 1; background: ${BRAND_COLORS.bgPage};">
  <div class="utak-page" style="${pageStyle}">

    <div style="position: absolute; ${BRAND_WATERMARK_STYLE}">${escapeHTML(BRAND_INFO.nameEn)}</div>

    ${renderHeader(opts.documentTitle, opts.documentNumber, opts.documentDate, opts.headerBadge, { taglineOverride: opts.tagline, documentDateStrOverride: opts.documentDateStr, forceLtrHeader: lang === "en" })}

    <div style="height: ${m.gap};"></div>
    <div style="height: 0; border-top: ${BRAND_RULES.header};"></div>
    <div style="height: ${m.gap};"></div>

    ${aboveBody}
    ${partiesRow}

    <div style="height: ${m.preTable};"></div>

    ${opts.bodyHTML}

    <div style="height: ${m.postTable};"></div>

    ${totalsRow}

    ${belowBody}

    <div style="flex: 1; min-height: ${opts.footerSealHTML ? "0px" : m.tailMin};"></div>

    ${footerBlock}
    ${thanksLine}
    ${legalBar}
  </div>
</div>
</body>
</html>`;
}

// ============================================================================
// Shared PDF rendering helper — every doc goes through Gotenberg the same way.
// ============================================================================

export interface GotenbergEnv {
  GOTENBERG_URL?: string;
  GOTENBERG_USER?: string;
  GOTENBERG_PASSWORD?: string;
}

export interface HtmlToPdfOptions {
  /**
   * Additional HTML rendered by Chromium as the top-of-page header on EVERY
   * printed page (Gotenberg's `header.html` file). When present, the caller
   * must also set `marginTop` large enough to reserve room (in inches).
   * Chromium substitutes `.pageNumber` / `.totalPages` / `.date` / `.title`
   * text content on each page. Scripts inside header/footer do not execute.
   */
  headerHtml?: string;
  /**
   * Additional HTML rendered by Chromium as the bottom-of-page footer on
   * EVERY printed page (Gotenberg's `footer.html` file). This is how UTAK
   * carries the legal-footer strip + "صفحة X من Y" pagination across every
   * page of multi-page invoices/quotations. Requires a matching
   * `marginBottom` reservation.
   */
  footerHtml?: string;
  /** Inches. Reserved top margin — must fit `headerHtml`. */
  marginTop?: string;
  /** Inches. Reserved bottom margin — must fit `footerHtml`. */
  marginBottom?: string;
}

/**
 * `.utak-page` is min-height 297mm = a full A4 sheet. When Gotenberg reserves
 * a top/bottom margin (the "صفحة X من Y" footer), the printable area is
 * shorter, and a full-height box pushes its last lines (legal footer) onto a
 * blank second page. Shrink the minimum to the printable height; content
 * longer than that still flows onto more pages. Zero margins → unchanged.
 */
export function fitPageToMargins(html: string, options?: HtmlToPdfOptions): string {
  const reserved = Number(options?.marginTop ?? 0) + Number(options?.marginBottom ?? 0);
  if (!(reserved > 0)) return html;
  return html.replace(
    "</head>",
    `<style>.utak-page { min-height: calc(297mm - ${reserved}in) !important; }</style>\n</head>`,
  );
}

export async function htmlToPDF(
  html: string,
  env: GotenbergEnv,
  options?: HtmlToPdfOptions,
): Promise<Uint8Array> {
  const gotenbergUrl = env.GOTENBERG_URL;
  const gotenbergUser = env.GOTENBERG_USER;
  const gotenbergPass = env.GOTENBERG_PASSWORD;

  if (!gotenbergUrl || !gotenbergUser || !gotenbergPass) {
    throw new Error("Gotenberg env vars missing: GOTENBERG_URL/USER/PASSWORD");
  }

  const formData = new FormData();
  formData.append("files", new Blob([fitPageToMargins(html, options)], { type: "text/html" }), "index.html");
  formData.append("paperWidth", "8.27");
  formData.append("paperHeight", "11.69");
  formData.append("marginTop", options?.marginTop ?? "0");
  formData.append("marginBottom", options?.marginBottom ?? "0");
  formData.append("marginLeft", "0");
  formData.append("marginRight", "0");
  formData.append("printBackground", "true");
  formData.append("waitDelay", "2s");
  if (options?.headerHtml) {
    formData.append("files", new Blob([options.headerHtml], { type: "text/html" }), "header.html");
  }
  if (options?.footerHtml) {
    formData.append("files", new Blob([options.footerHtml], { type: "text/html" }), "footer.html");
  }

  const auth = "Basic " + btoa(`${gotenbergUser}:${gotenbergPass}`);
  const response = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, {
    method: "POST",
    headers: { Authorization: auth },
    body: formData,
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gotenberg ${response.status}: ${errText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Builds the Gotenberg `footer.html` — a small HTML doc rendered by Chromium
 * in the reserved bottom margin of EVERY printed page. UTAK uses it for the
 * "صفحة X من Y" pagination strip; the legal-footer strip stays inline at the
 * end of the document content (last page only) to keep single-page fixtures
 * pixel-close to their Part A baseline.
 *
 * The `.pageNumber` and `.totalPages` classes are the two reserved slots
 * Chromium substitutes on each page — the only way to render page numbers
 * in a headless-Chromium PDF pipeline. Scripts inside header/footer HTML
 * are never executed, and Google Fonts URLs are not fetched here either,
 * so the footer uses only system-safe font stacks.
 *
 * Height: ~10mm — a single line of 8pt text with padding. Callers must
 * reserve `marginBottom: 0.4in` (~10mm) to leave room without cropping.
 */
export function buildGotenbergFooterHtml(lang: DocLang = "ar"): string {
  const asEsc = (s: string) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const dir = lang === "en" ? "ltr" : "rtl";
  const pageLabel = lang === "en" ? "Page" : "صفحة";
  const ofLabel = lang === "en" ? "of" : "من";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; font-size: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .utak-gotenberg-footer { width: 100%; box-sizing: border-box; padding: 0 20mm 4mm 20mm; direction: ${dir}; font-family: 'IBM Plex Sans Arabic', 'Tajawal', Arial, sans-serif; }
  .utak-gotenberg-footer .paginate { display: flex; justify-content: center; align-items: baseline; gap: 4px; font-size: 8px; color: #6B6863; letter-spacing: 0.08em; }
  .utak-gotenberg-footer .paginate .num { direction: ltr; }
</style>
</head>
<body>
<div class="utak-gotenberg-footer">
  <div class="paginate"><span>${asEsc(pageLabel)}</span><span class="num pageNumber"></span><span>${asEsc(ofLabel)}</span><span class="num totalPages"></span></div>
</div>
</body>
</html>`;
}

/** Recommended bottom-margin size (inches) when `buildGotenbergFooterHtml`
 *  is passed to htmlToPDF. ~10mm covers the single-line page-number strip
 *  with a hair of breathing room. */
export const GOTENBERG_FOOTER_MARGIN = "0.4";

// HMAC-SHA256 signed token — same shape used for invoice R2 URLs.
export async function signDocToken(secret: string, docId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(docId));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export interface R2BucketLike {
  put(
    key: string,
    value: Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
}

export interface UploadPDFEnv {
  ADMIN_TOKEN?: string;
  INVOICES_BUCKET: R2BucketLike;
}

/**
 * Uploads a PDF to R2 under `${folder}/${docNumber}.pdf` and returns a signed URL
 * shaped `/${urlPrefix}/${docNumber}/${token}.pdf` on `workerOrigin`.
 * A serve endpoint for non-invoice `urlPrefix` values may not exist yet —
 * the URL is future-facing; the R2 object itself is written immediately.
 */
export async function uploadPDFToR2(
  env: UploadPDFEnv,
  args: {
    pdfBytes: Uint8Array;
    folder: string;      // e.g. "quotations"
    urlPrefix: string;   // e.g. "quotation-pdf"
    docNumber: string;
    workerOrigin: string;
  },
): Promise<{ key: string; publicUrl: string; size: number }> {
  if (!env.ADMIN_TOKEN) {
    throw new Error("ADMIN_TOKEN missing — required to sign PDF URLs");
  }
  const key = `${args.folder}/${args.docNumber}.pdf`;
  await env.INVOICES_BUCKET.put(key, args.pdfBytes, {
    httpMetadata: {
      contentType: "application/pdf",
      contentDisposition: `inline; filename="${args.docNumber}.pdf"`,
    },
    customMetadata: {
      docNumber: args.docNumber,
      uploadedAt: new Date().toISOString(),
    },
  });
  const token = await signDocToken(env.ADMIN_TOKEN, args.docNumber);
  const publicUrl = `${args.workerOrigin}/${args.urlPrefix}/${args.docNumber}/${token}.pdf`;
  return { key, publicUrl, size: args.pdfBytes.byteLength };
}
