// v6 — Shared PDF template ("DNA") for all UTAK documents.
// Mirrors /tmp/utak-invoice-design/UTAK Invoice.dc.html 1:1 in visual output,
// but with no Claude-Design runtime (no <x-dc>, no <sc-for>, no {{ }}).
//
// Every UTAK PDF (invoice, quotation, receipt, delivery note, purchase order)
// must render through renderPDFShell so the brand stays a single source of truth.

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
} as const;

export const BRAND_FONT = "IBM Plex Sans Arabic";

// Real UTAK avatar logo (light background variant), inlined as a data URI so
// Gotenberg never has to fetch it. Swap the base64 payload when the mark
// changes — source: Desktop/Utak/logos kit/svg/utak-avatar-light.svg
export const UTAK_LOGO_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI0Y3RjVGMCIvPjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDE5LDE5KSBzY2FsZSgwLjYyKSI+PHBhdGggZD0iTTI1IDE2IHY0MCBhMjUgMjUgMCAwIDAgNTAgMCBWMzguNSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMUU1QTQxIiBzdHJva2Utd2lkdGg9IjE1IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cmVjdCB4PSI2Ni4yNSIgeT0iNiIgd2lkdGg9IjE3LjUiIGhlaWdodD0iMTcuNSIgZmlsbD0iI0UwN0IzOSIvPjwvZz48L3N2Zz4=";

// Company info block that appears in the FROM slot by default.
// TODO: promote to env-driven config once ZATCA registration + CR + VAT numbers land.
export const BRAND_INFO = {
  nameAr: "UTAK — يو تاك",
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

export function formatMoney(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return (
    rounded.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " ريال"
  );
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
      <div style="font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.2em;">${escapeHTML(label)}</div>
      <div style="display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 400;">
        <div>${escapeHTML(party.name)}</div>
        ${party.contactName ? `<div style="color: ${BRAND_COLORS.inkMuted};">${escapeHTML(party.contactName)}</div>` : ""}
        ${party.address ? `<div style="color: ${BRAND_COLORS.inkMuted};">${escapeHTML(party.address)}</div>` : ""}
        ${party.email ? `<div style="color: ${BRAND_COLORS.inkMuted}; direction: ltr;${alignEnd ? "" : " text-align: right;"}">${escapeHTML(party.email)}</div>` : ""}
        ${party.phone ? `<div style="color: ${BRAND_COLORS.inkMuted}; direction: ltr;${alignEnd ? "" : " text-align: right;"}">${escapeHTML(party.phone)}</div>` : ""}
      </div>
    </div>`;
}

function renderHeader(
  documentTitle: string,
  documentNumber: string,
  documentDate: Date,
  headerBadge?: HeaderBadge,
): string {
  const dateStr = formatDateArabic(documentDate);
  // The `headerBadge`-attached tail is a separate string so the byte-parity
  // path (legacy fixtures, no badge) reproduces the exact original template
  // without any extra whitespace.
  const badgeTail = headerBadge
    ? `
          <div style="margin-top: 4px;"><div style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 0.5px solid ${headerBadge.color}; background: ${headerBadge.bg}; color: ${headerBadge.color}; font-size: 10px; font-weight: 500; letter-spacing: 0.16em; direction: rtl;">${escapeHTML(headerBadge.text)}</div></div>`
    : "";
  return `<div style="position: relative; display: flex; align-items: flex-start; justify-content: space-between;">
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <img src="${UTAK_LOGO_DATA_URL}" style="width: 60px; height: 60px; display: block;" alt="UTAK" />
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 24px; font-weight: 500; color: ${BRAND_COLORS.primary}; letter-spacing: 0.02em; white-space: nowrap;">${escapeHTML(BRAND_INFO.nameAr)}</div>
          <div style="font-size: 10px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.14em;">${escapeHTML(BRAND_INFO.tagline)}</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 10px; direction: ltr; text-align: left;">
        <div style="font-size: 32px; font-weight: 300; line-height: 1; direction: rtl;">${escapeHTML(documentTitle)}</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 7px;">
            <span style="width: 4px; height: 4px; border-radius: 50%; background: ${BRAND_COLORS.accent}; display: inline-block;"></span>
            <span style="font-size: 13px; font-weight: 400;">${escapeHTML(documentNumber)}</span>
          </div>
          <div style="font-size: 13px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; direction: rtl; text-align: right;">${escapeHTML(dateStr)}</div>${badgeTail}
        </div>
      </div>
    </div>`;
}

// Additive: rendered at the very bottom of the page (below the "شكراً"
// line) when `legalFooterBar` is passed. Two thin lines — identity /
// contact — with empty fields dropped so no orphan " · " ever shows on
// either end. Latin/number-heavy fields (phone, email) sit inside <bdi
// dir="ltr"> so they render left-to-right inside the RTL page.
// The 5 legacy documents never pass legalFooterBar, so this function is
// never called for them.
function renderLegalFooterBar(info: LegalFooterInfo): string {
  const line1: string[] = [];
  if (info.name && info.name.trim()) line1.push(escapeHTML(info.name.trim()));
  if (info.cr && info.cr.trim()) line1.push(`س.ت <bdi dir="ltr">${escapeHTML(info.cr.trim())}</bdi>`);
  if (info.vat && info.vat.trim()) line1.push(`الرقم الضريبي <bdi dir="ltr">${escapeHTML(info.vat.trim())}</bdi>`);

  const line2: string[] = [];
  if (info.address && info.address.trim()) line2.push(escapeHTML(info.address.trim()));
  if (info.phone && info.phone.trim()) line2.push(`<bdi dir="ltr">${escapeHTML(info.phone.trim())}</bdi>`);
  if (info.email && info.email.trim()) line2.push(`<bdi dir="ltr">${escapeHTML(info.email.trim())}</bdi>`);

  if (line1.length === 0 && line2.length === 0) return "";
  const lineStyle = `text-align: center; font-size: 8.5px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.06em; line-height: 1.6;`;
  const parts: string[] = [`<div style="height: 8px;"></div>`];
  if (line1.length > 0) parts.push(`<div style="${lineStyle}">${line1.join(" · ")}</div>`);
  if (line2.length > 0) parts.push(`<div style="${lineStyle}">${line2.join(" · ")}</div>`);
  return parts.join("\n    ");
}

function renderFooter(footerNote: string, showZatcaQR: boolean): string {
  const qrCell = showZatcaQR
    ? generateZatcaQRPlaceholder()
    : `<div style="width: 80px;"></div>`; // reserve space so the grid layout stays symmetric
  return `<div style="position: relative;">
      <div style="height: 0; border-top: 0.25px solid ${BRAND_COLORS.borderSoft};"></div>
      <div style="height: 20px;"></div>
      <div style="display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: flex-start;">
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font-size: 10px; font-weight: 500; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.2em;">شروط الدفع</div>
          <div style="font-size: 10px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; line-height: 1.7; max-width: 62%;">${escapeHTML(footerNote)}</div>
        </div>
        ${qrCell}
      </div>
      <div style="height: 18px;"></div>
      <div style="text-align: center; font-size: 10px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.08em;">شكراً لثقتكم في ${escapeHTML(BRAND_INFO.nameAr)}</div>
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
  // Byte-parity gate. When every additive option is absent, we hit the
  // exact same template literal as before — no extra whitespace, no
  // dropped interpolations, no reshuffled sections. See tests/pdf-template
  // .test.mts::"legacy fixtures produce byte-identical HTML". Do NOT
  // touch this branch without regenerating the pixel-diff PNGs for the
  // five legacy fixtures.
  // -----------------------------------------------------------------
  const anyAdditive =
    opts.recipientLabel !== undefined ||
    opts.senderLabel !== undefined ||
    opts.hideBillTo === true ||
    opts.hideFrom === true ||
    opts.hideFooterNote === true ||
    opts.hideThanks === true ||
    opts.thanksOverride !== undefined ||
    opts.headerBadge !== undefined ||
    opts.legalFooterBar !== undefined ||
    opts.suppressPartiesRow === true ||
    opts.aboveBodyHTML !== undefined ||
    opts.belowBodyHTML !== undefined ||
    opts.multiPageBreaks === true;

  if (!anyAdditive) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@200;300;400;500;600&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: ${BRAND_COLORS.bgPage}; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 0; }
  @media print {
    html, body { background: ${BRAND_COLORS.bgPage}; }
    .utak-page { box-shadow: none !important; margin: 0 !important; break-after: page; }
    .utak-page:last-child { break-after: auto; }
  }
</style>
</head>
<body>
<div dir="rtl" style="font-family: '${BRAND_FONT}', 'Tajawal', sans-serif; font-feature-settings: 'tnum' 1; background: ${BRAND_COLORS.bgPage};">
  <div class="utak-page" style="position: relative; width: 210mm; height: 297mm; box-sizing: border-box; padding: 20mm; background: ${BRAND_COLORS.bgPage}; color: ${BRAND_COLORS.ink}; display: flex; flex-direction: column; overflow: hidden;">

    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 160px; font-weight: 200; letter-spacing: 0.06em; color: ${BRAND_COLORS.primary}; opacity: 0.04; pointer-events: none; user-select: none; white-space: nowrap;">${escapeHTML(BRAND_INFO.nameEn)}</div>

    ${renderHeader(opts.documentTitle, opts.documentNumber, opts.documentDate)}

    <div style="height: ${m.gap};"></div>
    <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.primary};"></div>
    <div style="height: ${m.gap};"></div>

    <div style="position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
      ${renderParty("فاتورة إلى / BILL TO", opts.billTo, false)}
      ${renderParty("من / FROM", from, true)}
    </div>

    <div style="height: ${m.preTable};"></div>

    ${opts.bodyHTML}

    <div style="height: ${m.postTable};"></div>

    ${opts.totalsHTML ?? ""}

    <div style="flex: 1; min-height: ${m.tailMin};"></div>

    ${renderFooter(footerNote, showZatcaQR)}
  </div>
</div>
</body>
</html>`;
  }

  // -----------------------------------------------------------------
  // Additive path — only reached when at least one new option was set.
  // Any output shape difference from the legacy path lives here.
  // -----------------------------------------------------------------
  const recipientLabel = opts.recipientLabel ?? "فاتورة إلى / BILL TO";
  const senderLabel = opts.senderLabel ?? "من / FROM";
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

  const footerBlock = opts.hideFooterNote
    ? ""
    : renderFooter(footerNote, showZatcaQR);
  const thanksLine = opts.hideThanks
    ? ""
    : opts.thanksOverride
      ? `<div style="text-align: center; font-size: 10px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; letter-spacing: 0.08em;">${escapeHTML(opts.thanksOverride)}</div>`
      : "";
  const legalBar = opts.legalFooterBar ? renderLegalFooterBar(opts.legalFooterBar) : "";
  const aboveBody = opts.aboveBodyHTML ?? "";
  const belowBody = opts.belowBodyHTML ?? "";

  // Multi-page mode drops the fixed height + overflow:hidden so Chromium
  // paginates naturally at @page boundaries. Single-page additive mode keeps
  // the legacy fixed A4 to stay pixel-close on the common case.
  const pageStyle = opts.multiPageBreaks
    ? `position: relative; width: 210mm; min-height: 297mm; box-sizing: border-box; padding: 20mm; background: ${BRAND_COLORS.bgPage}; color: ${BRAND_COLORS.ink}; display: flex; flex-direction: column;`
    : `position: relative; width: 210mm; height: 297mm; box-sizing: border-box; padding: 20mm; background: ${BRAND_COLORS.bgPage}; color: ${BRAND_COLORS.ink}; display: flex; flex-direction: column; overflow: hidden;`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@200;300;400;500;600&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: ${BRAND_COLORS.bgPage}; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 0; }
  @media print {
    html, body { background: ${BRAND_COLORS.bgPage}; }
    .utak-page { box-shadow: none !important; margin: 0 !important; break-after: page; }
    .utak-page:last-child { break-after: auto; }${opts.multiPageBreaks
      ? `
    thead { display: table-header-group; }
    tr, .utak-block { break-inside: avoid; page-break-inside: avoid; }
    p, li { orphans: 3; widows: 3; }`
      : ""}
  }
</style>
</head>
<body>
<div dir="rtl" style="font-family: '${BRAND_FONT}', 'Tajawal', sans-serif; font-feature-settings: 'tnum' 1; background: ${BRAND_COLORS.bgPage};">
  <div class="utak-page" style="${pageStyle}">

    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 160px; font-weight: 200; letter-spacing: 0.06em; color: ${BRAND_COLORS.primary}; opacity: 0.04; pointer-events: none; user-select: none; white-space: nowrap;">${escapeHTML(BRAND_INFO.nameEn)}</div>

    ${renderHeader(opts.documentTitle, opts.documentNumber, opts.documentDate, opts.headerBadge)}

    <div style="height: ${m.gap};"></div>
    <div style="height: 0; border-top: 0.5px solid ${BRAND_COLORS.primary};"></div>
    <div style="height: ${m.gap};"></div>

    ${aboveBody}
    ${partiesRow}

    <div style="height: ${m.preTable};"></div>

    ${opts.bodyHTML}

    <div style="height: ${m.postTable};"></div>

    ${opts.totalsHTML ?? ""}

    ${belowBody}

    <div style="flex: 1; min-height: ${m.tailMin};"></div>

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

export async function htmlToPDF(html: string, env: GotenbergEnv): Promise<Uint8Array> {
  const gotenbergUrl = env.GOTENBERG_URL;
  const gotenbergUser = env.GOTENBERG_USER;
  const gotenbergPass = env.GOTENBERG_PASSWORD;

  if (!gotenbergUrl || !gotenbergUser || !gotenbergPass) {
    throw new Error("Gotenberg env vars missing: GOTENBERG_URL/USER/PASSWORD");
  }

  const formData = new FormData();
  formData.append("files", new Blob([html], { type: "text/html" }), "index.html");
  formData.append("paperWidth", "8.27");
  formData.append("paperHeight", "11.69");
  formData.append("marginTop", "0");
  formData.append("marginBottom", "0");
  formData.append("marginLeft", "0");
  formData.append("marginRight", "0");
  formData.append("printBackground", "true");
  formData.append("waitDelay", "2s");

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
