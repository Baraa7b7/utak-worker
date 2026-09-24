// Financial statements on the official paper (2026-09-24). READ-ONLY on
// Odoo: search_read / read / account.report getters only — nothing is
// created, written or posted. No WhatsApp: any graph.facebook.com request
// throws.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/financial-statements.mjs [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--dry-run]
//   (or: npm run statements -- [--from=…] [--to=…] [--dry-run])
//
// Period: default = the first fiscal year in Odoo (account.fiscal.year,
// 2026-09-13 → 2026-12-31: a short first year from the CR date, so there
// are no comparative columns).
//
// Steps:
//   1. Ledger: every posted account.move.line up to `to` + the chart of
//      accounts in Arabic and English (fin-statements-core::fetchLedger).
//   2. computeStatements: balance sheet, income statement, cash flows
//      (indirect), changes in equity, trial balance. If the balance sheet,
//      the trial balance, the cash reconciliation or the equity roll-forward
//      does not hold, it stops here: exit 1, no document.
//   3. Cross-check with Odoo's own Balance Sheet / Profit and Loss / Cash
//      Flow Statement / Trial Balance for the same dates. Every difference is
//      printed and saved; nothing is hidden.
//   4. --dry-run stops here (no Gotenberg, no files).
//   5. PDF through src/pdf-template.ts::htmlToPDF (Gotenberg): cover (name,
//      CR, VAT, national address, period, issue date, seal, contents), the
//      five statements, the approval line; running header + page numbers on
//      every page. Rendered twice: the second pass prints the real page
//      numbers in the contents.
//   6. xlsx with the same figures, one sheet per statement + the Odoo check.
//
// Output (scripts/artifacts/, git-ignored — the PDF carries the seal):
//   financial-statements-<from>_<to>.pdf / .xlsx / -check.json
// Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg).

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "./lib/odoo-cli.mjs";
import { computeStatements, compareWithOdoo, fetchLedger, fetchOdooReports, StatementsError, L } from "./lib/fin-statements-core.mjs";
import { renderStatementsHTML, statementsHeaderHtml, statementsFooterHtml, SECTION_IDS, SECTION_TITLES, ltr } from "./lib/fin-statements-render.mjs";
import { writeXlsx } from "./lib/xlsx-lite.mjs";
import { htmlToPDF } from "../src/pdf-template.ts";
import { readCompanyInfo } from "../src/company.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp from the statements script");
  return realFetch(input, init);
};

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DRY = args.includes("--dry-run");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// Locked data (CR certificate): the CR issue date is not stored in Odoo.
const CR_ISSUE_DATE = "2026-09-13";
const FALLBACK_FY = { date_from: "2026-09-13", date_to: "2026-12-31" };

const readEnv = (f) => Object.fromEntries(
  readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const env = { ...readEnv(".env.sim-verify"), ...(DRY ? {} : readEnv(".env.zatca-oneoff")) };
delete env.META_ACCESS_TOKEN;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
const riyadhToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

// ---- period
const fys = await call("account.fiscal.year", "search_read", { domain: [["company_id", "=", 1]], fields: ["name", "date_from", "date_to"], order: "date_from", limit: 1 });
const fy = fys[0] ?? FALLBACK_FY;
const from = opt("from") ?? fy.date_from;
const to = opt("to") ?? fy.date_to;
if (!ISO.test(from) || !ISO.test(to) || from > to) throw new Error(`bad period ${from} → ${to}`);
const issueDate = riyadhToday();
console.log(`period ${from} → ${to} (first fiscal year ${fy.date_from} → ${fy.date_to}) · issued ${issueDate}${DRY ? " · DRY RUN" : ""}`);

// ---- 1–2. ledger + statements
const ledger = await fetchLedger(call, { to });
let st;
try {
  st = computeStatements({ ...ledger, from, to });
} catch (e) {
  if (e instanceof StatementsError) {
    console.error(`✗ ${e.message}`, e.details ?? "");
    console.error("no document produced");
    process.exit(1);
  }
  throw e;
}
const bs = st.balanceSheet, is = st.incomeStatement, cf = st.cashFlow;
console.log(`posted lines ≤ ${to}: ${ledger.lines.length} · accounts in trial balance: ${st.trialBalance.rows.length}`);
console.log(`balance sheet: assets ${bs.totalAssets} = liabilities ${bs.totalLiabilities} + equity ${bs.totalEquity} ✓ (cash ${bs.cash}, owner current ${bs.ownerCurrentAccount})`);
console.log(`income: revenue ${is.totalRevenue} · COGS ${is.totalCogs} · gross ${is.grossProfit} · expenses ${is.totalExpenses} · net ${is.netResult}`);
console.log(`cash flow: operating ${cf.netOperating} · investing ${cf.netInvesting} · financing ${cf.netFinancing} · ${cf.openingCash} + ${cf.netChange} = ${cf.closingCash} ✓`);
console.log(`trial balance: debit ${st.trialBalance.totals.debit} = credit ${st.trialBalance.totals.credit} ✓`);

// ---- 3. Odoo cross-check
const odoo = await fetchOdooReports(call, { from, to });
const check = compareWithOdoo(st, odoo);
const compared = check.rows.filter((r) => r.match !== null);
console.log(`Odoo check: ${compared.filter((r) => r.match).length}/${compared.length} figures match · ${check.mismatches.length} mismatch(es) · ${check.informational.length} classification note(s)`);
for (const r of check.mismatches) console.log(`  ✗ ${r.statement} ${r.item}: ours ${r.ours} · Odoo ${r.odoo} · diff ${r.diff}`);
for (const r of check.informational) console.log(`  ⚠ ${r.statement} ${r.item}: ours ${r.ours} · Odoo ${r.odoo} — ${r.note}`);

if (DRY) {
  console.log("dry-run: no Gotenberg call, no file written");
  process.exit(0);
}

// ---- 5. PDF
const company = await readCompanyInfo(env);
const [extra] = await call("res.company", "read", { ids: [1], fields: ["x_sa_short_address"] });
const meta = {
  from, to, issueDate, crIssueDate: CR_ISSUE_DATE,
  periodAr: `للفترة من ${ltr(from)} إلى ${ltr(to)}`,
  periodEn: `For the period from ${from} to ${to}`,
  shortYear: from === fy.date_from
    ? [`الفترة المالية الأولى قصيرة: تبدأ من تاريخ صدور السجل التجاري ${ltr(fy.date_from)} وتنتهي في ${ltr(fy.date_to)}، ولذلك لا تُعرض أرقام مقارنة.`,
       `The first financial period is short: it starts on the C.R. issue date, ${fy.date_from}, and ends on ${fy.date_to}; no comparative figures are presented.`]
    : null,
  company: {
    nameAr: company.legalNameAr || company.nameAr,
    nameEn: company.legalNameEn || company.nameEn,
    cr: company.cr, vat: company.vat,
    addressAr: company.addressAr, addressEn: company.addressEn,
    shortAddress: extra?.x_sa_short_address || "",
    stampImage: company.stampImage,
  },
};
const pdfOpts = { headerHtml: statementsHeaderHtml(meta), footerHtml: statementsFooterHtml(), marginTop: "0.6", marginBottom: "0.45" };
const tmp = mkdtempSync(join(tmpdir(), "utak-fs-"));
const pageText = (file, p) => execFileSync("pdftotext", ["-f", String(p), "-l", String(p), "-layout", file, "-"], { encoding: "utf8" });
const pageCount = (file) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file], { encoding: "utf8" }))[1]);

// Pass 1 finds each section's page (by its English title, after the cover).
const pass1 = join(tmp, "pass1.pdf");
writeFileSync(pass1, await htmlToPDF(renderStatementsHTML(st, meta, null), env, pdfOpts));
const n1 = pageCount(pass1);
const pages = {};
for (let p = 2; p <= n1; p++) {
  const t = pageText(pass1, p);
  for (const id of SECTION_IDS) if (!pages[id] && t.includes(SECTION_TITLES[id][1])) pages[id] = p;
}
const missing = SECTION_IDS.filter((id) => !pages[id]);
if (missing.length) throw new Error(`section(s) not found in the PDF: ${missing.join(", ")}`);

const base = `financial-statements-${from}_${to}`;
const pdfPath = join(OUT, `${base}.pdf`);
writeFileSync(pdfPath, await htmlToPDF(renderStatementsHTML(st, meta, pages), env, pdfOpts));
const n = pageCount(pdfPath);

// Verify the printed document.
const perPage = Array.from({ length: n }, (_, i) => pageText(pdfPath, i + 1));
const imgs = execFileSync("pdfimages", ["-list", pdfPath], { encoding: "utf8" }).split("\n").slice(2).filter(Boolean).map((l) => Number(l.trim().split(/\s+/)[0]));
const verify = {
  pages: n,
  samePagesAsPass1: n === n1,
  sectionPages: pages,
  headerOnEveryPage: perPage.every((t) => t.includes("Financial Statements") && t.includes(`${from} → ${to}`)),
  pageNumberOnEveryPage: perPage.every((t, i) => t.includes(`Page ${i + 1} of ${n}`)),
  stampOnCover: imgs.includes(1),
  approvalLine: perPage.some((t) => t.includes("Chartered Accountant")) && perPage.some((t) => t.includes("not been audited")),
  figuresPrinted: [bs.totalAssets, bs.totalEquity, cf.closingCash].every((v) => perPage.join("\n").includes(v.toLocaleString("en-US", { minimumFractionDigits: 2 }))),
};
console.log(`pdf: ${pdfPath}`);
console.log(`  ${JSON.stringify(verify)}`);

// ---- 6. xlsx
const T = (pair, s = "bold") => [{ v: pair[0], s }, null, { v: pair[1], s }];
const R = (pair, v, s) => [pair[0], { v, s: s ?? "money" }, pair[1]];
const acc = (x) => [`${x.nameAr} (${x.code})`, x.amount, `${x.code} ${x.nameEn}`];
const W = [48, 18, 48];
const sheetBS = [T(L.bs, "head"), [`كما في ${to}`, null, `As at ${to}`], [],
  T(L.currentAssets), ...bs.currentAssets.map(acc), R(L.totalCurrentAssets, bs.totalCurrentAssets, "boldMoney"),
  T(L.nonCurrentAssets), ...bs.nonCurrentAssets.map(acc), R(L.totalNonCurrentAssets, bs.totalNonCurrentAssets, "boldMoney"),
  R(L.totalAssets, bs.totalAssets, "boldMoney"), [],
  T(L.currentLiabilities), ...bs.currentLiabilities.map(acc), R(L.totalCurrentLiabilities, bs.totalCurrentLiabilities, "boldMoney"),
  T(L.nonCurrentLiabilities), ...bs.nonCurrentLiabilities.map(acc), R(L.totalNonCurrentLiabilities, bs.totalNonCurrentLiabilities, "boldMoney"),
  R(L.totalLiabilities, bs.totalLiabilities, "boldMoney"), [],
  T(L.equity), ...bs.equity.map(acc), ...bs.retainedAccounts.map(acc), R(L.retainedPrior, bs.retainedPrior), R(L.periodResult, bs.periodResult),
  R(L.totalEquity, bs.totalEquity, "boldMoney"), R(L.totalLE, bs.totalLiabilitiesAndEquity, "boldMoney")];
const sheetIS = [T(L.is, "head"), [meta.periodAr, null, meta.periodEn], [],
  T(L.revenue), ...is.revenue.map(acc), R(L.totalRevenue, is.totalRevenue, "boldMoney"),
  T(L.cogs), ...is.cogs.map(acc), R(L.totalCogs, is.totalCogs, "boldMoney"), R(L.gross, is.grossProfit, "boldMoney"),
  T(L.otherIncome), ...is.otherIncome.map(acc), R(L.otherIncome, is.totalOtherIncome, "boldMoney"),
  T(L.expenses), ...is.expenses.map(acc), R(L.totalExpenses, is.totalExpenses, "boldMoney"), R(L.net, is.netResult, "boldMoney")];
const sheetCF = [T(L.cf, "head"), [`${meta.periodAr} — الطريقة غير المباشرة`, null, `${meta.periodEn} — indirect method`], [],
  T(L.operating), R(L.periodResult, cf.netResult), R(L.depreciation, cf.depreciation), ...cf.workingCapital.map((x) => R(L[x.key], x.amount)), R(L.netOperating, cf.netOperating, "boldMoney"),
  T(L.investing), ...cf.investing.map((x) => R(L[x.key], x.amount)), R(L.netInvesting, cf.netInvesting, "boldMoney"),
  T(L.financing), ...cf.financing.map((x) => R(L[x.key], x.amount)), R(L.netFinancing, cf.netFinancing, "boldMoney"),
  R(L.netChange, cf.netChange, "boldMoney"), R(L.openingCash, cf.openingCash), R(L.closingCash, cf.closingCash, "boldMoney")];
const eqRow = (x, s = "money") => [L[x.key][0], { v: x.paidIn, s }, { v: x.retained, s }, { v: x.total, s }, L[x.key][1]];
const sheetEQ = [[{ v: L.eq[0], s: "head" }, null, null, null, { v: L.eq[1], s: "head" }], [meta.periodAr, null, null, null, meta.periodEn], [],
  [{ v: "البيان", s: "bold" }, { v: `${L.paidIn[0]} / ${L.paidIn[1]}`, s: "bold" }, { v: `${L.retained[0]} / ${L.retained[1]}`, s: "bold" }, { v: `${L.total[0]} / ${L.total[1]}`, s: "bold" }, { v: "Description", s: "bold" }],
  ...st.equityChanges.rows.map((x) => eqRow(x)), eqRow(st.equityChanges.closing, "boldMoney")];
const tbHead = ["الحساب", "Code", "Opening / الافتتاحي", "Debit / مدين", "Credit / دائن", "Closing Dr / ختامي مدين", "Closing Cr / ختامي دائن", "Account"].map((v) => ({ v, s: "bold" }));
const sheetTB = [[{ v: L.tb[0], s: "head" }, null, null, null, null, null, null, { v: L.tb[1], s: "head" }], [meta.periodAr, null, null, null, null, null, null, meta.periodEn], [], tbHead,
  ...st.trialBalance.rows.map((x) => [x.nameAr, x.code, x.opening, x.debit, x.credit, x.closingDr, x.closingCr, x.nameEn]),
  [{ v: "المجموع", s: "bold" }, null, ...["opening", "debit", "credit", "closingDr", "closingCr"].map((k) => ({ v: st.trialBalance.totals[k], s: "boldMoney" })), { v: "Total", s: "bold" }]];
const sheetCheck = [[{ v: "مطابقة تقارير Odoo / Odoo reports check", s: "head" }], [],
  ["statement", "item", "ours", "odoo", "diff", "match", "note"].map((v) => ({ v, s: "bold" })),
  ...check.rows.map((r) => [r.statement, r.item, r.ours, r.odoo, r.diff, r.match === null ? "—" : r.match ? "✓" : "✗", r.note])];
const sheetInfo = [[{ v: meta.company.nameAr, s: "head" }, null, { v: meta.company.nameEn, s: "head" }],
  ["السجل التجاري", meta.company.cr, "C.R. No."], ["تاريخ صدور السجل", CR_ISSUE_DATE, "C.R. issue date"], ["الرقم الضريبي", meta.company.vat, "VAT No."],
  ["العنوان الوطني", meta.company.addressAr, "National address"], ["", meta.company.addressEn, ""], ["العنوان المختصر", meta.company.shortAddress, "Short address"],
  ["الفترة", `${from} → ${to}`, "Period"], ["تاريخ الإصدار", issueDate, "Issue date"], ["العملة", "SAR", "Currency"],
  ["المصدر", "account.move.line — القيود المرحّلة فقط / posted entries only", "Source"],
  ...(meta.shortYear ? [[meta.shortYear[0], null, meta.shortYear[1]]] : []),
  ["غير مراجعة من مراجع خارجي", null, "Not audited or reviewed by an external auditor"]];
const xlsxPath = join(OUT, `${base}.xlsx`);
writeXlsx(xlsxPath, [
  { name: "Info معلومات", rtl: true, widths: [30, 60, 30], rows: sheetInfo },
  { name: "BS المركز المالي", rtl: true, widths: W, rows: sheetBS },
  { name: "IS الدخل", rtl: true, widths: W, rows: sheetIS },
  { name: "CF التدفقات", rtl: true, widths: W, rows: sheetCF },
  { name: "EQ حقوق الملكية", rtl: true, widths: [34, 20, 20, 20, 34], rows: sheetEQ },
  { name: "TB ميزان المراجعة", rtl: true, widths: [32, 10, 16, 16, 16, 18, 18, 32], rows: sheetTB },
  { name: "Odoo check", rtl: false, widths: [8, 40, 14, 14, 10, 7, 60], rows: sheetCheck },
]);
console.log(`xlsx: ${xlsxPath}`);

const checkPath = join(OUT, `${base}-check.json`);
writeFileSync(checkPath, JSON.stringify({ period: { from, to }, issueDate, statements: st, odooCheck: check, verify }, null, 2) + "\n");
console.log(`check: ${checkPath}`);
