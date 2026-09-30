// Financial statements → one bilingual HTML document (2026-09-24), printed by
// the same Gotenberg path as every UTAK PDF (src/pdf-template.ts::htmlToPDF).
// Every line: Arabic label on the right, the figure in the middle, English
// label on the left. Cover → five statements → approval line. The running
// header and the page numbers are Gotenberg header/footer templates, so they
// repeat on every page.

// Identity (2026-09-24): the same family as the invoice. Every colour, size,
// rule, the logo, the header block, the watermark and the legal footer come
// from src/pdf-template.ts — this file holds no colour value of its own
// (tests/fin-statements.test.mts checks that no hex literal is left here).

import {
  BRAND_COLORS, BRAND_FONT, BRAND_FONT_HREF, BRAND_RULES, BRAND_TYPE, BRAND_WATERMARK_STYLE, SEAL_SIZE_MM,
  escapeHTML as esc, formatDateArabic, renderBrandHeader, renderLegalFooterBar,
} from "../../src/pdf-template.ts";
import { L } from "./fin-statements-core.mjs";

export const SECTION_IDS = ["bs", "is", "cf", "eq", "tb", "approval"];

/** Gotenberg margins (inches) reserved for the running header and the page
 *  numbers. The cover fills exactly what is left, so its legal footer sits at
 *  the bottom of page 1. */
export const STATEMENTS_MARGINS = { top: "0.6", bottom: "0.45" };
export const SECTION_TITLES = {
  bs: L.bs, is: L.is, cf: L.cf, eq: L.eq, tb: L.tb,
  approval: ["اعتماد القوائم المالية", "Approval of the Financial Statements"],
};

/** Isolates an LTR run (ISO date, "a → b") inside Arabic text so the bidi
 *  algorithm never flips it: "2026-09-13" stays 2026-09-13. */
export const ltr = (s) => `\u2066${String(s).replace(/-/g, "\u2011")}\u2069`; // + non-breaking hyphens

/** 1234.5 → "1,234.50"; negatives in brackets; zero printed as 0.00. */
export function money(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

const C = BRAND_COLORS;
const T = BRAND_TYPE;
const R = BRAND_RULES;
const AR = (pair) => esc(pair[0]);
const EN = (pair) => esc(pair[1]);

function row(label, amount, cls = "") {
  return `<tr class="${cls}"><td class="ar">${esc(label[0])}</td><td class="amt">${amount === null ? "" : money(amount)}</td><td class="en">${esc(label[1])}</td></tr>`;
}
const head = (label) => row(label, null, "head");
const accRow = (x) => row([x.nameAr, x.nameEn], x.amount, "sub");
const accRowCode = (x) => `<tr class="sub"><td class="ar">${esc(x.nameAr)} <span class="code">${esc(x.code)}</span></td><td class="amt">${money(x.amount)}</td><td class="en"><span class="code">${esc(x.code)}</span> ${esc(x.nameEn)}</td></tr>`;

function stTable(body) {
  return `<table class="st"><thead><tr class="colhead"><td class="ar">البيان</td><td class="amt">ريال سعودي<br><span class="en-inline">SAR</span></td><td class="en">Description</td></tr></thead><tbody>${body}</tbody></table>`;
}

function sectionHead(id, sub) {
  const t = SECTION_TITLES[id];
  return `<div class="sec-head" data-section="${id}"><div class="t-ar">${esc(t[0])}</div><div class="t-en">${esc(t[1])}</div></div>
  <div class="sec-sub"><div>${esc(sub[0])}</div><div class="ltr">${esc(sub[1])}</div></div>`;
}

function balanceSheet(bs) {
  let b = head(L.assets);
  b += head(L.currentAssets) + bs.currentAssets.map(accRowCode).join("") + row(L.totalCurrentAssets, bs.totalCurrentAssets, "total");
  b += head(L.nonCurrentAssets) + bs.nonCurrentAssets.map(accRowCode).join("") + row(L.totalNonCurrentAssets, bs.totalNonCurrentAssets, "total");
  b += row(L.totalAssets, bs.totalAssets, "grand");
  b += head(L.liabilities);
  b += head(L.currentLiabilities) + bs.currentLiabilities.map(accRowCode).join("") + row(L.totalCurrentLiabilities, bs.totalCurrentLiabilities, "total");
  b += head(L.nonCurrentLiabilities) + bs.nonCurrentLiabilities.map(accRowCode).join("") + row(L.totalNonCurrentLiabilities, bs.totalNonCurrentLiabilities, "total");
  b += row(L.totalLiabilities, bs.totalLiabilities, "total strong");
  b += head(L.equity) + bs.equity.map(accRowCode).join("") + bs.retainedAccounts.map(accRowCode).join("");
  b += row(L.retainedPrior, bs.retainedPrior, "sub") + row(L.periodResult, bs.periodResult, "sub");
  b += row(L.totalEquity, bs.totalEquity, "total strong");
  b += row(L.totalLE, bs.totalLiabilitiesAndEquity, "grand");
  return stTable(b);
}

function incomeStatement(is) {
  let b = head(L.revenue) + is.revenue.map(accRowCode).join("") + row(L.totalRevenue, is.totalRevenue, "total");
  b += head(L.cogs) + is.cogs.map(accRowCode).join("") + row(L.totalCogs, is.totalCogs, "total");
  b += row(L.gross, is.grossProfit, "total strong");
  if (is.otherIncome.length) b += head(L.otherIncome) + is.otherIncome.map(accRowCode).join("") + row(L.otherIncome, is.totalOtherIncome, "total");
  b += head(L.expenses) + is.expenses.map(accRowCode).join("") + row(L.totalExpenses, is.totalExpenses, "total");
  b += row(L.net, is.netResult, "grand");
  return stTable(b);
}

function cashFlow(cf) {
  let b = head(L.operating) + row(L.periodResult, cf.netResult, "sub") + row(L.depreciation, cf.depreciation, "sub");
  b += cf.workingCapital.map((x) => row(L[x.key], x.amount, "sub")).join("") + row(L.netOperating, cf.netOperating, "total");
  b += head(L.investing) + cf.investing.map((x) => row(L[x.key], x.amount, "sub")).join("") + row(L.netInvesting, cf.netInvesting, "total");
  b += head(L.financing) + cf.financing.map((x) => row(L[x.key], x.amount, "sub")).join("") + row(L.netFinancing, cf.netFinancing, "total");
  b += row(L.netChange, cf.netChange, "total strong");
  b += row(L.openingCash, cf.openingCash, "sub") + row(L.closingCash, cf.closingCash, "grand");
  return stTable(b);
}

function equityChanges(eq) {
  const r = (x, cls = "") => `<tr class="${cls}"><td class="ar">${AR(L[x.key])}</td><td class="amt">${money(x.paidIn)}</td><td class="amt">${money(x.retained)}</td><td class="amt">${money(x.total)}</td><td class="en">${EN(L[x.key])}</td></tr>`;
  const h = (p) => `<td class="amt">${AR(p)}<br><span class="en-inline">${EN(p)}</span></td>`;
  return `<table class="st eq"><thead><tr class="colhead"><td class="ar">البيان</td>${h(L.paidIn)}${h(L.retained)}${h(L.total)}<td class="en">Description</td></tr></thead>
    <tbody>${eq.rows.map((x) => r(x, "sub")).join("")}${r(eq.closing, "grand")}</tbody></table>
    <div class="note"><div>المبالغ بالريال السعودي.</div><div class="ltr">Amounts in Saudi Riyals.</div></div>`;
}

function trialBalance(tb) {
  const n = (v) => `<td class="amt">${money(v)}</td>`;
  const h = (p) => `<td class="amt">${AR(p)}<br><span class="en-inline">${EN(p)}</span></td>`;
  const rows = tb.rows.map((x) => `<tr><td class="ar">${esc(x.nameAr)}</td><td class="code-c">${esc(x.code)}</td>${n(x.opening)}${n(x.debit)}${n(x.credit)}${n(x.closingDr)}${n(x.closingCr)}<td class="en">${esc(x.nameEn)}</td></tr>`).join("");
  const t = tb.totals;
  return `<table class="st tb"><thead><tr class="colhead"><td class="ar">${AR(L.account)}</td><td class="code-c">${AR(L.code)}<br><span class="en-inline">${EN(L.code)}</span></td>${h(L.opening)}${h(L.debit)}${h(L.credit)}${h(L.closingDr)}${h(L.closingCr)}<td class="en">${EN(L.account)}</td></tr></thead>
    <tbody>${rows}<tr class="grand"><td class="ar">${AR(L.total)}</td><td></td>${n(t.opening)}${n(t.debit)}${n(t.credit)}${n(t.closingDr)}${n(t.closingCr)}<td class="en">${EN(L.total)}</td></tr></tbody></table>`;
}

function approval(meta) {
  return `<div class="disclaimer"><div>أعدّت إدارة الشركة هذه القوائم المالية من القيود المرحّلة في دفاترها المحاسبية، <b>ولم تُراجَع ولم تُفحَص من مراجع حسابات خارجي</b>.</div>
    <div class="ltr">These financial statements were prepared by management from the posted entries in the company's books. <b>They have not been audited or reviewed by an external auditor.</b></div></div>
  <table class="sign"><tbody>
    <tr><td class="ar">المحاسب القانوني</td><td class="line"></td><td class="en">Chartered Accountant</td></tr>
    <tr><td class="ar">رقم الترخيص</td><td class="line"></td><td class="en">Licence No.</td></tr>
    <tr><td class="ar">التوقيع</td><td class="line"></td><td class="en">Signature</td></tr>
    <tr><td class="ar">التاريخ</td><td class="line"></td><td class="en">Date</td></tr>
  </tbody></table>
  <div class="note"><div>صدرت بتاريخ ${esc(ltr(meta.issueDate))} من دفتر الأستاذ العام (Odoo)، القيود المرحّلة فقط.</div><div class="ltr">Issued on ${esc(meta.issueDate)} from the general ledger (Odoo), posted entries only.</div></div>`;
}

/** The invoice's legal strip, bilingual (three lines): name · C.R. · VAT,
 *  the English mirror, address · phone · email. */
function legalFooter(c) {
  return renderLegalFooterBar({
    name: c.nameAr, nameEn: c.nameEn, cr: c.cr, vat: c.vat,
    address: c.addressAr, addressEn: c.addressEn, phone: c.phone, email: c.email,
    crLabelEn: "CR No.", vatLabelEn: "VAT No.",
  }, "bi");
}

/** "2026-09-24" → the invoice's date line «٢٤ سبتمبر ٢٠٢٦ — 2026/09/24». */
const headerDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return formatDateArabic(new Date(y, m - 1, d));
};

function cover(meta, pages) {
  const c = meta.company;
  // "2026-09-13", "14273-4309": one isolated LTR run with non-breaking
  // hyphens — never flipped by the bidi algorithm, never wrapped mid-number.
  const nb = (v) => String(v ?? "").replace(/\d+(?:-\d+)+/g, (m) => ltr(m));
  const idRow = (label, val, valEn) => `<tr><td class="ar">${esc(label[0])}</td><td class="val">${esc(nb(val))}${valEn ? `<div class="ltr">${esc(nb(valEn))}</div>` : ""}</td><td class="en">${esc(label[1])}</td></tr>`;
  const index = SECTION_IDS.map((id, i) => `<tr><td class="num">${i + 1}</td><td class="ar">${esc(SECTION_TITLES[id][0])}</td><td class="pg">${pages?.[id] ?? "…"}</td><td class="en">${esc(SECTION_TITLES[id][1])}</td></tr>`).join("");
  const header = renderBrandHeader("القوائم المالية", "Financial Statements", new Date(0), { documentDateStrOverride: headerDate(meta.issueDate) });
  return `<div class="cover">
    ${header}
    <div class="rule"></div>
    <div class="period"><div>${esc(meta.periodAr)}</div><div class="ltr">${esc(meta.periodEn)}</div></div>
    ${meta.shortYear ? `<div class="short"><div>${esc(meta.shortYear[0])}</div><div class="ltr">${esc(meta.shortYear[1])}</div></div>` : ""}
    <table class="ident"><thead><tr class="colhead"><td class="ar">بيانات المنشأة</td><td class="val"></td><td class="en">Entity details</td></tr></thead><tbody>
      ${idRow(["الاسم القانوني", "Legal name"], c.nameAr, c.nameEn)}
      ${c.legalFormAr || c.legalFormEn ? idRow(["نوع الكيان", "Legal form"], c.legalFormAr, c.legalFormEn) : ""}
      ${idRow(["السجل التجاري", "C.R. No."], c.cr)}
      ${idRow(["تاريخ صدور السجل", "C.R. issue date"], meta.crIssueDate)}
      ${idRow(["الرقم الضريبي", "VAT No."], c.vat)}
      ${idRow(["العنوان الوطني", "National address"], c.addressAr, c.addressEn)}
      ${idRow(["العنوان المختصر", "Short address"], c.shortAddress)}
      ${idRow(["الفترة", "Period"], ltr(`${meta.from} → ${meta.to}`))}
      ${idRow(["تاريخ الإصدار", "Issue date"], meta.issueDate)}
      ${idRow(["العملة", "Currency"], "ريال سعودي", "Saudi Riyal (SAR)")}
    </tbody></table>
    <div class="lower">
      <table class="index"><thead><tr class="colhead"><td class="num"></td><td class="ar">المحتويات</td><td class="pg">صفحة<br><span class="en-inline">Page</span></td><td class="en">Contents</td></tr></thead><tbody>${index}</tbody></table>
      ${c.stampImage ? `<img class="stamp" data-utak="stamp" src="${esc(c.stampImage)}" alt="ختم الشركة"/>` : ""}
    </div>
    <div class="fill"></div>
    <div class="legal" data-utak="legal-footer">${legalFooter(c)}</div>
  </div>
  `;
}

export function renderStatementsHTML(st, meta, pages) {
  const periodSub = [`للفترة من ${ltr(meta.from)} إلى ${ltr(meta.to)}`, `For the period from ${meta.from} to ${meta.to}`];
  const asOf = [`كما في ${ltr(meta.to)}`, `As at ${meta.to}`];
  const sections = [
    ["bs", asOf, balanceSheet(st.balanceSheet)],
    ["is", periodSub, incomeStatement(st.incomeStatement)],
    ["cf", [`${periodSub[0]} — الطريقة غير المباشرة`, `${periodSub[1]} — indirect method`], cashFlow(st.cashFlow)],
    ["eq", periodSub, equityChanges(st.equityChanges)],
    ["tb", periodSub, trialBalance(st.trialBalance)],
    ["approval", ["", ""], approval(meta) + `<div class="legal end" data-utak="legal-footer">${legalFooter(meta.company)}</div>`],
  ];
  const body = sections.map(([id, sub, html]) => `<section class="section ${id === "approval" ? "keep" : ""}">${sectionHead(id, sub)}${html}</section>`).join("\n");
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<link href="${BRAND_FONT_HREF}" rel="stylesheet">
<title>${esc(meta.company.nameAr)} — القوائم المالية ${esc(meta.from)} – ${esc(meta.to)}</title>
<style>
  /* @page margin = exactly Gotenberg's marginTop/marginBottom (a different
     value would override them and the running header would sit on the text).
     The @page background paints the margin strips too, so the whole sheet is
     the brand paper, as on the invoice. */
  @page { size: A4; margin: ${STATEMENTS_MARGINS.top}in 0 ${STATEMENTS_MARGINS.bottom}in; background: ${C.bgPage}; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${C.bgPage}; }
  body { font-family: '${BRAND_FONT}', 'Tajawal', sans-serif; color: ${C.ink}; font-size: ${T.cell.size}; font-weight: ${T.cell.weight}; font-feature-settings: 'tnum' 1; }
  .wm { position: fixed; ${BRAND_WATERMARK_STYLE} }
  .doc { padding: 0 ${T.pagePadding}; }
  .ltr { direction: ltr; text-align: left; }
  .section { break-before: page; padding-top: 2mm; }
  .section.keep { break-before: auto; break-inside: avoid; margin-top: 12mm; }
  .sec-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: ${R.header}; padding-bottom: 4mm; }
  .sec-head .t-ar, .sec-head .t-en { font-size: ${T.sectionTitle.size}; font-weight: ${T.sectionTitle.weight}; line-height: 1; color: ${C.ink}; }
  .sec-head .t-en { direction: ltr; }
  .sec-sub { display: flex; justify-content: space-between; color: ${C.inkMuted}; font-size: ${T.meta.size}; font-weight: ${T.meta.weight}; margin: 3mm 0 5mm; }
  .sec-sub > div:first-child::before, .cover .period > div:first-child::before { content: ""; display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: ${C.accent}; margin-left: 7px; vertical-align: middle; }
  table.st { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.st td { padding: 1.3mm 1mm; vertical-align: top; border-bottom: ${R.row}; }
  table.st td.ar { text-align: right; width: 41%; }
  table.st td.en { text-align: left; direction: ltr; width: 41%; }
  table.st td.amt { text-align: center; direction: ltr; width: 18%; white-space: nowrap; }
  table.st.eq td.ar, table.st.eq td.en { width: 25%; }
  table.st.eq td.amt { width: 16.66%; }
  table.st.tb { font-size: ${T.legal.size}; }
  table.st.tb td { padding: 1.1mm 0.6mm; }
  table.st.tb td.ar, table.st.tb td.en { width: 20%; }
  table.st.tb td.amt { width: 10.4%; }
  table.st.tb td.code-c { width: 8%; text-align: center; direction: ltr; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  tr.colhead td { font-size: ${T.th.size}; font-weight: ${T.th.weight}; letter-spacing: ${T.th.tracking}; color: ${C.inkMuted}; border-top: ${R.th}; border-bottom: ${R.th}; padding-top: 2.2mm; padding-bottom: 2.2mm; }
  .en-inline { direction: ltr; }
  tr.head td { font-weight: ${T.brandName.weight}; color: ${C.primary}; padding-top: 3.5mm; border-bottom: none; }
  tr.sub td.ar { padding-right: 5mm; }
  tr.sub td.en { padding-left: 5mm; }
  tr.sub td { color: ${C.ink}; }
  tr.total td { font-weight: ${T.brandName.weight}; border-top: ${R.th}; }
  tr.total.strong td { background: ${C.bgOuter}; }
  tr.grand td { font-weight: ${T.grandTotal.weight}; border-top: ${R.th}; border-bottom: 1.6px double ${C.borderStrong}; }
  tr.grand td.amt { color: ${C.primary}; }
  .code { color: ${C.inkMuted}; font-size: ${T.legal.size}; direction: ltr; unicode-bidi: isolate; }
  .note { display: flex; justify-content: space-between; color: ${C.inkMuted}; font-size: ${T.label.size}; margin-top: 4mm; gap: 8mm; }
  .note > div { flex: 1; }
  .disclaimer { border: ${R.header}; padding: 4mm; display: flex; gap: 8mm; line-height: 1.7; font-size: ${T.label.size}; color: ${C.ink}; }
  .disclaimer > div { flex: 1; }
  table.sign { width: 100%; border-collapse: collapse; margin-top: 8mm; }
  table.sign td { padding: 4mm 1mm 1mm; }
  table.sign td.ar { width: 22%; text-align: right; font-size: ${T.label.size}; font-weight: ${T.label.weight}; color: ${C.inkMuted}; }
  table.sign td.en { width: 22%; text-align: left; direction: ltr; font-size: ${T.label.size}; font-weight: ${T.label.weight}; color: ${C.inkMuted}; }
  table.sign td.line { border-bottom: ${R.th}; }
  .cover { display: flex; flex-direction: column; min-height: calc(297mm - ${Number(STATEMENTS_MARGINS.top) + Number(STATEMENTS_MARGINS.bottom)}in - 4mm); padding-top: 2mm; }
  .cover .rule { height: 0; border-top: ${R.header}; margin: 16px 0; }
  .cover .period { display: flex; justify-content: space-between; font-size: ${T.meta.size}; font-weight: ${T.meta.weight}; }
  .cover .short { display: flex; justify-content: space-between; gap: 8mm; margin-top: 3mm; font-size: ${T.legal.size}; color: ${C.inkMuted}; line-height: 1.7; }
  .cover .short > div { flex: 1; }
  table.ident { width: 100%; border-collapse: collapse; margin-top: 5mm; table-layout: fixed; }
  table.ident td { padding: 1.2mm 1mm; border-bottom: ${R.row}; vertical-align: top; }
  table.ident td.ar { width: 22%; color: ${C.inkMuted}; text-align: right; }
  table.ident td.en { width: 22%; color: ${C.inkMuted}; text-align: left; direction: ltr; }
  table.ident td.val { text-align: center; }
  table.ident td.val .ltr { text-align: center; color: ${C.inkMuted}; }
  table.ident tr.colhead td.val { border-top: ${R.th}; }
  .cover .lower { display: flex; align-items: flex-end; gap: 8mm; margin-top: 6mm; direction: rtl; }
  table.index { flex: 1; border-collapse: collapse; }
  table.index td { padding: 1.1mm 1mm; border-bottom: ${R.row}; }
  table.index td.num { width: 6mm; color: ${C.accent}; text-align: center; }
  table.index td.ar { text-align: right; }
  table.index td.en { text-align: left; direction: ltr; }
  table.index td.pg { width: 14mm; text-align: center; direction: ltr; }
  .cover .stamp { width: ${SEAL_SIZE_MM}mm; height: ${SEAL_SIZE_MM}mm; transform: rotate(-8deg); opacity: 0.92; mix-blend-mode: multiply; }
  .cover .fill { flex: 1; min-height: 4mm; }
  .legal.end { margin-top: 14mm; }
</style>
</head>
<body><div class="wm" aria-hidden="true">UTAK</div><div class="doc">
${cover(meta, pages)}
${body}
</div></body></html>`;
}

/** Gotenberg header.html — company + statement name + period on every page.
 *  Header templates cannot load web fonts; sizes and colours are the tokens. */
export function statementsHeaderHtml(meta) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; font-size: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .h { width: 100%; box-sizing: border-box; padding: 6mm ${T.pagePadding} 0; font-family: '${BRAND_FONT}', 'Tajawal', Arial, sans-serif; }
  .r { display: flex; justify-content: space-between; align-items: baseline; font-size: 8px; color: ${C.ink}; border-bottom: ${R.header}; padding-bottom: 1.5mm; }
  .r .en { direction: ltr; }
  .m { color: ${C.inkMuted}; font-size: 7.5px; direction: ltr; }
</style></head><body><div class="h"><div class="r">
  <span dir="rtl">${esc(meta.company.nameAr)} · القوائم المالية</span>
  <span class="m">${esc(meta.from)} → ${esc(meta.to)} · C.R. ${esc(meta.company.cr)}</span>
  <span class="en">${esc(meta.company.nameEn)} · Financial Statements</span>
</div></div></body></html>`;
}

/** Gotenberg footer.html — «صفحة X من Y · Page X of Y» on every page. */
export function statementsFooterHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; font-size: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .f { width: 100%; box-sizing: border-box; padding: 0 ${T.pagePadding} 5mm; font-family: '${BRAND_FONT}', 'Tajawal', Arial, sans-serif; display: flex; justify-content: center; gap: 10px; font-size: 8px; letter-spacing: 0.08em; color: ${C.inkMuted}; }
  .n { direction: ltr; }
</style></head><body><div class="f">
  <span dir="rtl">صفحة <span class="n pageNumber"></span> من <span class="n totalPages"></span></span>
  <span class="n">·</span>
  <span class="n">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div></body></html>`;
}
