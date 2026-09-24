// Financial statements → one bilingual HTML document (2026-09-24), printed by
// the same Gotenberg path as every UTAK PDF (src/pdf-template.ts::htmlToPDF).
// Every line: Arabic label on the right, the figure in the middle, English
// label on the left. Cover → five statements → approval line. The running
// header and the page numbers are Gotenberg header/footer templates, so they
// repeat on every page.

import { BRAND_COLORS, BRAND_FONT, UTAK_LOGO_DATA_URL, escapeHTML as esc } from "../../src/pdf-template.ts";
import { L } from "./fin-statements-core.mjs";

export const SECTION_IDS = ["bs", "is", "cf", "eq", "tb", "approval"];
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

function cover(meta, pages) {
  const c = meta.company;
  // "2026-09-13", "14273-4309": one isolated LTR run with non-breaking
  // hyphens — never flipped by the bidi algorithm, never wrapped mid-number.
  const nb = (v) => String(v ?? "").replace(/\d+(?:-\d+)+/g, (m) => ltr(m));
  const idRow = (label, val, valEn) => `<tr><td class="ar">${esc(label[0])}</td><td class="val">${esc(nb(val))}${valEn ? `<div class="ltr">${esc(nb(valEn))}</div>` : ""}</td><td class="en">${esc(label[1])}</td></tr>`;
  const index = SECTION_IDS.map((id, i) => `<tr><td class="num">${i + 1}</td><td class="ar">${esc(SECTION_TITLES[id][0])}</td><td class="pg">${pages?.[id] ?? "…"}</td><td class="en">${esc(SECTION_TITLES[id][1])}</td></tr>`).join("");
  return `<div class="cover">
    <div class="brand"><img src="${UTAK_LOGO_DATA_URL}" alt="UTAK"/><div><div class="name-ar">${esc(c.nameAr)}</div><div class="name-en">${esc(c.nameEn)}</div></div></div>
    <div class="title"><div class="t-ar">القوائم المالية</div><div class="t-en">Financial Statements</div></div>
    <div class="period"><div>${esc(meta.periodAr)}</div><div class="ltr">${esc(meta.periodEn)}</div></div>
    ${meta.shortYear ? `<div class="short"><div>${esc(meta.shortYear[0])}</div><div class="ltr">${esc(meta.shortYear[1])}</div></div>` : ""}
    <table class="ident"><tbody>
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
      <table class="index"><thead><tr><td></td><td class="ar">المحتويات</td><td class="pg">صفحة<br><span class="en-inline">Page</span></td><td class="en">Contents</td></tr></thead><tbody>${index}</tbody></table>
      ${c.stampImage ? `<img class="stamp" data-utak="stamp" src="${esc(c.stampImage)}" alt="ختم الشركة"/>` : ""}
    </div>
  </div>`;
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
    ["approval", ["", ""], approval(meta)],
  ];
  const body = sections.map(([id, sub, html]) => `<section class="section ${id === "approval" ? "keep" : ""}">${sectionHead(id, sub)}${html}</section>`).join("\n");
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600&display=swap" rel="stylesheet">
<title>${esc(meta.company.nameAr)} — القوائم المالية ${esc(meta.from)} – ${esc(meta.to)}</title>
<style>
  /* No @page margin here: Chromium would let it override Gotenberg's
     marginTop/marginBottom, and the running header would sit on the text. */
  @page { size: A4; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: '${BRAND_FONT}', 'Tajawal', sans-serif; color: ${C.ink}; font-size: 10px; font-feature-settings: 'tnum' 1; }
  .doc { padding: 0 16mm; }
  .ltr { direction: ltr; text-align: left; }
  .section { break-before: page; padding-top: 2mm; }
  .section.keep { break-before: auto; break-inside: avoid; margin-top: 12mm; }
  .sec-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.8px solid ${C.primary}; padding-bottom: 2mm; }
  .sec-head .t-ar { font-size: 17px; font-weight: 600; color: ${C.primary}; }
  .sec-head .t-en { font-size: 15px; font-weight: 500; color: ${C.primary}; direction: ltr; }
  .sec-sub { display: flex; justify-content: space-between; color: ${C.inkMuted}; font-size: 9.5px; margin: 1.5mm 0 4mm; }
  table.st { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.st td { padding: 1.5mm 1mm; vertical-align: top; border-bottom: 0.25px solid ${C.borderSoft}; }
  table.st td.ar { text-align: right; width: 41%; }
  table.st td.en { text-align: left; direction: ltr; width: 41%; }
  table.st td.amt { text-align: center; direction: ltr; width: 18%; white-space: nowrap; }
  table.st.eq td.ar, table.st.eq td.en { width: 25%; }
  table.st.eq td.amt { width: 16.66%; }
  table.st.tb { font-size: 7.6px; }
  table.st.tb td { padding: 1.1mm 0.6mm; }
  table.st.tb td.ar, table.st.tb td.en { width: 20%; }
  table.st.tb td.amt { width: 10.4%; }
  table.st.tb td.code-c { width: 8%; text-align: center; direction: ltr; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  tr.colhead td { font-size: 8.5px; color: ${C.inkMuted}; font-weight: 500; border-bottom: 0.8px solid ${C.ink}; }
  .en-inline { direction: ltr; }
  tr.head td { font-weight: 600; color: ${C.primary}; padding-top: 3mm; border-bottom: none; }
  tr.sub td.ar { padding-right: 5mm; }
  tr.sub td.en { padding-left: 5mm; }
  tr.total td { font-weight: 600; border-top: 0.6px solid ${C.ink}; }
  tr.total.strong td { background: #F4F2EC; }
  tr.grand td { font-weight: 600; border-top: 0.8px solid ${C.ink}; border-bottom: 2.4px double ${C.ink}; color: ${C.ink}; }
  .code { color: ${C.inkMuted}; font-size: 8px; direction: ltr; unicode-bidi: isolate; }
  .note { display: flex; justify-content: space-between; color: ${C.inkMuted}; font-size: 8.5px; margin-top: 4mm; gap: 8mm; }
  .note > div { flex: 1; }
  .disclaimer { border: 0.6px solid ${C.primary}; padding: 4mm; display: flex; gap: 8mm; line-height: 1.7; font-size: 9.5px; }
  .disclaimer > div { flex: 1; }
  table.sign { width: 100%; border-collapse: collapse; margin-top: 8mm; }
  table.sign td { padding: 4mm 1mm 1mm; }
  table.sign td.ar { width: 22%; text-align: right; font-weight: 500; }
  table.sign td.en { width: 22%; text-align: left; direction: ltr; font-weight: 500; }
  table.sign td.line { border-bottom: 0.6px solid ${C.ink}; }
  .cover { padding-top: 6mm; }
  .cover .brand { display: flex; align-items: center; gap: 5mm; }
  .cover .brand img { width: 20mm; height: 20mm; }
  .cover .name-ar { font-size: 22px; font-weight: 600; color: ${C.primary}; }
  .cover .name-en { font-size: 14px; color: ${C.inkMuted}; direction: ltr; text-align: right; }
  .cover .title { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14mm; border-bottom: 1px solid ${C.primary}; padding-bottom: 3mm; }
  .cover .title .t-ar { font-size: 30px; font-weight: 300; }
  .cover .title .t-en { font-size: 26px; font-weight: 300; direction: ltr; }
  .cover .period { display: flex; justify-content: space-between; margin-top: 3mm; font-size: 11px; }
  .cover .short { display: flex; justify-content: space-between; gap: 8mm; margin-top: 3mm; font-size: 8.8px; color: ${C.inkMuted}; line-height: 1.6; }
  .cover .short > div { flex: 1; }
  table.ident { width: 100%; border-collapse: collapse; margin-top: 8mm; table-layout: fixed; }
  table.ident td { padding: 1.8mm 1mm; border-bottom: 0.25px solid ${C.borderSoft}; vertical-align: top; }
  table.ident td.ar { width: 22%; color: ${C.inkMuted}; text-align: right; }
  table.ident td.en { width: 22%; color: ${C.inkMuted}; text-align: left; direction: ltr; }
  table.ident td.val { text-align: center; font-weight: 500; }
  table.ident td.val .ltr { text-align: center; font-weight: 400; font-size: 9px; }
  .cover .lower { display: flex; align-items: flex-end; gap: 8mm; margin-top: 10mm; direction: rtl; }
  table.index { flex: 1; border-collapse: collapse; }
  table.index td { padding: 1.6mm 1mm; border-bottom: 0.25px solid ${C.borderSoft}; }
  table.index thead td { font-size: 8.5px; color: ${C.inkMuted}; border-bottom: 0.8px solid ${C.ink}; }
  table.index td.num { width: 6mm; color: ${C.accent}; text-align: center; }
  table.index td.ar { text-align: right; }
  table.index td.en { text-align: left; direction: ltr; }
  table.index td.pg { width: 14mm; text-align: center; direction: ltr; }
  .cover .stamp { width: 40mm; height: 40mm; transform: rotate(-8deg); opacity: 0.92; mix-blend-mode: multiply; }
</style>
</head>
<body><div class="doc">
${cover(meta, pages)}
${body}
</div></body></html>`;
}

/** Gotenberg header.html — company + statement name + period on every page. */
export function statementsHeaderHtml(meta) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; font-size: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .h { width: 100%; box-sizing: border-box; padding: 6mm 16mm 0; font-family: 'IBM Plex Sans Arabic', 'Tajawal', Arial, sans-serif; }
  .r { display: flex; justify-content: space-between; align-items: baseline; font-size: 8px; color: #1A1815; border-bottom: 0.6px solid #1E5A41; padding-bottom: 1.5mm; }
  .r .en { direction: ltr; }
  .m { color: #6B6863; font-size: 7.5px; direction: ltr; }
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
  .f { width: 100%; box-sizing: border-box; padding: 0 16mm 5mm; font-family: 'IBM Plex Sans Arabic', 'Tajawal', Arial, sans-serif; display: flex; justify-content: center; gap: 10px; font-size: 8px; color: #6B6863; }
  .n { direction: ltr; }
</style></head><body><div class="f">
  <span dir="rtl">صفحة <span class="n pageNumber"></span> من <span class="n totalPages"></span></span>
  <span class="n">·</span>
  <span class="n">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div></body></html>`;
}
