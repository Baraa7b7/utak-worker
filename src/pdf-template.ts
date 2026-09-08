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
): string {
  const dateStr = formatDateArabic(documentDate);
  return `<div style="position: relative; display: flex; align-items: flex-start; justify-content: space-between;">
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="width: 60px; height: 60px; border: 0.5px solid ${BRAND_COLORS.primary}; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${BRAND_COLORS.bgPage};">
          <span style="font-size: 24px; font-weight: 500; color: ${BRAND_COLORS.primary}; letter-spacing: 0.02em; line-height: 1;">U</span>
        </div>
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
          <div style="font-size: 13px; font-weight: 400; color: ${BRAND_COLORS.inkMuted}; direction: rtl; text-align: right;">${escapeHTML(dateStr)}</div>
        </div>
      </div>
    </div>`;
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
