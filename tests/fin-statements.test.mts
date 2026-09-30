// Financial statements, signature prep, seal on the four documents
// (2026-09-24).
//   1. Known fake ledger → balance sheet balances, net result, gross profit,
//      expenses by account, indirect cash flow reconciles, equity roll-forward,
//      owner current account is a liability (capital stays as posted)
//   2. A period with no movement → zeros, no error
//   3. Unposted (draft / cancelled) lines never reach a figure
//   4. An unbalanced ledger → StatementsError, nothing returned
//   5. compareWithOdoo: equal figures match; a different one is listed
//   6. Signature prep: white-on-black (+ blue edge) → black on transparent,
//      ≥ 1500 px, clean corners; the real processed file too when present
//   7. Quotation / delivery note / receipt / purchase order: issued → seal,
//      signature and signatory line beside the totals; draft → none of it
//   8. Statements HTML: five statements + approval line; xlsx is a zip with
//      one sheet per statement
//   9. Logo (2026-09-24): the document logo has no background (the old
//      avatar had a cream square), every document prints it, and the
//      transparent PNG is transparent with brand-only opaque pixels
//  10. Identity: the statements are styled only from pdf-template's tokens
//      (no hex literal in the renderer), on the cream paper, with the
//      invoice's header, logo, watermark, table rules and legal footer
//
// Same no-framework style as tests/acct-close.test.mts. No network.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { computeStatements, compareWithOdoo, StatementsError } from "../scripts/lib/fin-statements-core.mjs";
import { renderStatementsHTML, money, ltr } from "../scripts/lib/fin-statements-render.mjs";
import { xlsxBuffer } from "../scripts/lib/xlsx-lite.mjs";
import { prepSignature, checkTransparent } from "../scripts/lib/signature-prep-core.mjs";
import { renderQuotationHTML, TEST_QUOTATION_DATA } from "../src/quotation.ts";
import { renderDeliveryNoteHTML, TEST_DELIVERY_NOTE_DATA } from "../src/delivery-note.ts";
import { renderReceiptHTML, TEST_RECEIPT_DATA } from "../src/receipt.ts";
import { renderPurchaseOrderHTML, TEST_PURCHASE_ORDER_DATA } from "../src/purchase-order.ts";
import { SIGNATORY, BRAND_COLORS, BRAND_RULES, BRAND_TYPE, BRAND_WATERMARK_STYLE, UTAK_LOGO_SVG, UTAK_LOGO_DATA_URL, UTAK_LOGO_IMG_STYLE, renderBrandHeader } from "../src/pdf-template.ts";
import { renderInvoiceHTML, TEST_INVOICE_DATA } from "../src/invoice.ts";
import { svgHasBackground, analyzeLogoPng } from "../scripts/lib/logo-core.mjs";
import type { CompanyInfo } from "../src/company.ts";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}`); }
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error("BLOCKED network in fin-statements.test"); }) as typeof fetch;

// ---- chart of accounts (types as in Odoo)
const A = (id: number, code: string, nameEn: string, type: string) => ({ id, code, nameAr: `ح ${code}`, nameEn, type });
const accounts = [
  A(1, "101001", "Bank", "asset_cash"),
  A(2, "102011", "Accounts Receivable", "asset_receivable"),
  A(3, "100110", "Vehicles", "asset_fixed"),
  A(4, "100111", "Accumulated depreciation", "asset_fixed"),
  A(5, "201002", "Payables", "liability_payable"),
  A(6, "201017", "VAT Output", "liability_current"),
  A(7, "201021", "Owner Current Account", "liability_current"),
  A(8, "300010", "Paid-in Capital", "equity"),
  A(9, "999999", "Undistributed Profits/Losses", "equity_unaffected"),
  A(10, "500001", "Sales", "income"),
  A(11, "400001", "COGS", "expense_direct_cost"),
  A(12, "400077", "Fuel", "expense"),
  A(13, "401007", "Depreciation - vehicles", "expense_depreciation"),
];
let seq = 0;
const move = (date: string, state: string, ...legs: Array<[number, number, number]>) =>
  legs.map(([account_id, debit, credit]) => ({ id: ++seq, account_id: [account_id, "x"], date, debit, credit, parent_state: state }));
const FROM = "2026-09-13", TO = "2026-12-31";
const ledger = [
  ...move("2026-09-24", "posted", [1, 25000, 0], [8, 0, 25000]),            // capital
  ...move("2026-10-02", "posted", [2, 1150, 0], [10, 0, 1000], [6, 0, 150]), // sale incl. VAT
  ...move("2026-10-02", "posted", [11, 600, 0], [5, 0, 600]),                // COGS on credit
  ...move("2026-10-05", "posted", [12, 200, 0], [7, 0, 200]),                // fuel paid by the owner personally
  ...move("2026-10-10", "posted", [3, 1000, 0], [1, 0, 1000]),               // vehicle from the bank
  ...move("2026-10-31", "posted", [13, 50, 0], [4, 0, 50]),                  // depreciation
  ...move("2026-11-01", "posted", [1, 500, 0], [2, 0, 500]),                 // collection
  ...move("2026-11-02", "draft", [2, 9999, 0], [10, 0, 9999]),               // draft sale: never counts
  ...move("2026-11-03", "cancel", [12, 777, 0], [1, 0, 777]),                // cancelled: never counts
];

console.log("\n[1] known ledger → statements");
const st = computeStatements({ accounts, lines: ledger, from: FROM, to: TO });
const bs = st.balanceSheet, is = st.incomeStatement, cf = st.cashFlow;
assert("revenue 1,000 (VAT not revenue)", is.totalRevenue === 1000);
assert("COGS 600", is.totalCogs === 600);
assert("gross profit 400", is.grossProfit === 400);
assert("expenses 250, by account (fuel 200, depreciation 50)", is.totalExpenses === 250 && is.expenses.map((x: any) => `${x.code}:${x.amount}`).join(",") === "400077:200,401007:50");
assert("net result 150", is.netResult === 150);
assert("total assets 26,100 (bank 24,500 + AR 650 + vehicle net 950)", bs.totalAssets === 26100);
assert("current assets 25,150, non-current 950", bs.totalCurrentAssets === 25150 && bs.totalNonCurrentAssets === 950);
assert("current liabilities 950 (payables 600, VAT 150, owner 200)", bs.totalCurrentLiabilities === 950);
assert("owner current account is a liability: 200", bs.ownerCurrentAccount === 200 && bs.currentLiabilities.some((x: any) => x.code === "201021" && x.amount === 200));
assert("paid-in capital stays 25,000 (owner payment not in capital)", bs.equity.length === 1 && bs.equity[0].amount === 25000);
assert("equity 25,150 = capital + result", bs.totalEquity === 25150 && bs.periodResult === 150);
assert("balance sheet balances", bs.totalAssets === bs.totalLiabilitiesAndEquity);
assert("cash flow: operating 300 (150 + 50 − 650 + 600 + 150)", cf.netOperating === 300);
assert("cash flow: investing −1,000 (vehicle, depreciation added back)", cf.netInvesting === -1000);
assert("cash flow: financing 25,200 (capital + owner)", cf.netFinancing === 25200);
assert("cash flow reconciles: 0 + 24,500 = 24,500 = bank", cf.openingCash === 0 && cf.netChange === 24500 && cf.closingCash === 24500 && bs.cash === 24500);
assert("equity changes: capital 25,000 + result 150 = 25,150", st.equityChanges.closing.total === 25150 && st.equityChanges.rows.find((r: any) => r.key === "eqCapital").paidIn === 25000);
assert("trial balance: debit = credit", st.trialBalance.totals.debit === st.trialBalance.totals.credit && st.trialBalance.totals.debit === 28500);

console.log("\n[1b] opening balances (period starting later)");
const st2 = computeStatements({ accounts, lines: ledger, from: "2026-11-01", to: TO });
assert("opening cash = bank before 11-01 (24,000)", st2.cashFlow.openingCash === 24000 && st2.cashFlow.closingCash === 24500);
assert("prior result carried as retained (150), period result 0", st2.balanceSheet.retainedPrior === 150 && st2.incomeStatement.netResult === 0);
assert("still balances", st2.balanceSheet.totalAssets === st2.balanceSheet.totalLiabilitiesAndEquity);

console.log("\n[2] a period with no movement → zeros");
let st0: any = null, err0: unknown = null;
try { st0 = computeStatements({ accounts, lines: [], from: FROM, to: "2026-09-20" }); } catch (e) { err0 = e; }
assert("no error", err0 === null && st0 !== null);
assert("all totals zero", st0 && [st0.balanceSheet.totalAssets, st0.balanceSheet.totalEquity, st0.incomeStatement.netResult, st0.cashFlow.closingCash, st0.trialBalance.totals.debit].every((v: number) => v === 0));
assert("zeros are 0, never -0", st0 && Object.is(st0.balanceSheet.totalLiabilities, 0) && Object.is(st0.cashFlow.netChange, 0));
assert("owner account still listed at 0", st0 && st0.balanceSheet.currentLiabilities.some((x: any) => x.code === "201021" && x.amount === 0));
const html0 = renderStatementsHTML(st0, { from: FROM, to: "2026-09-20", issueDate: "2026-09-24", crIssueDate: FROM, periodAr: "x", periodEn: "x", shortYear: null, company: { nameAr: "ش", nameEn: "U", cr: "1", vat: "3", addressAr: "", addressEn: "", shortAddress: "" } }, null);
assert("zero period renders (0.00 printed)", html0.includes(">0.00<"));

console.log("\n[3] unposted lines never count");
const onlyUnposted = ledger.filter((l) => l.parent_state !== "posted");
const stU = computeStatements({ accounts, lines: onlyUnposted, from: FROM, to: TO });
assert("draft + cancelled only → zero revenue, zero expenses, zero cash", stU.incomeStatement.totalRevenue === 0 && stU.incomeStatement.totalExpenses === 0 && stU.cashFlow.closingCash === 0);
assert("the 9,999 draft sale is not in revenue", is.totalRevenue !== 10999);
assert("lines after `to` ignored", computeStatements({ accounts, lines: ledger, from: FROM, to: "2026-09-30" }).incomeStatement.totalRevenue === 0);

console.log("\n[4] unbalanced → refused");
const broken = [...ledger, ...move("2026-10-20", "posted", [1, 100, 0])]; // one-legged
let e4: any = null;
try { computeStatements({ accounts, lines: broken, from: FROM, to: TO }); } catch (e) { e4 = e; }
assert("throws StatementsError", e4 instanceof StatementsError);
let e5: any = null;
try { computeStatements({ accounts: [...accounts, A(99, "999", "Weird", "some_new_type")], lines: [...ledger, ...move("2026-10-21", "posted", [99, 1, 0], [1, 0, 1])], from: FROM, to: TO }); } catch (e) { e5 = e; }
assert("unknown account type refused", e5 instanceof StatementsError && /unmapped/.test(e5.message));

console.log("\n[5] Odoo cross-check");
const fakeOdoo = {
  bs: { codes: { TA: [26100], CA: [25150], BA: [24500], REC: [650], CAS: [0], PRE: [0], FA: [950], PNCA: [0], L: [950], CL: [950], NL: [0], EQ: [25150], EAR: [150], LE: [26100] }, accounts: {}, named: {} },
  pl: { codes: { REV: [1000], COS: [600], GRP: [400], OIN: [0], EXP: [200], OEXP: [50], NEP: [999] }, accounts: {}, named: {} },
  cf: null, tb: null,
};
const cmp = compareWithOdoo(st, fakeOdoo);
assert("equal figures match", cmp.rows.find((r: any) => r.item.startsWith("Total assets")).match === true);
assert("expenses compared as EXP + OEXP", cmp.rows.find((r: any) => r.item.startsWith("Expenses")).match === true);
assert("a different net profit is listed as a mismatch", cmp.mismatches.some((r: any) => r.item.startsWith("Net profit") && r.diff === -849));

console.log("\n[6] signature prep");
{
  const w = 900, h = 300;
  const img = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  for (let p = 0; p < w * h; p++) { img.data[p * 4] = 12; img.data[p * 4 + 1] = 12; img.data[p * 4 + 2] = 12; img.data[p * 4 + 3] = 255; }
  const put = (x: number, y: number, rgb: number[]) => { const i = (y * w + x) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; };
  for (let x = 100; x < 800; x++) for (let t = -4; t <= 4; t++) put(x, Math.round(150 + 60 * Math.sin(x / 60)) + t, [255, 255, 255]); // white stroke
  for (let x = 0; x < w; x++) { put(x, h - 1, [28, 95, 188]); put(x, h - 2, [28, 95, 188]); } // blue window edge
  put(450, 20, [255, 255, 255]); put(451, 20, [255, 255, 255]); // a 2-px speck
  const { png, stats } = prepSignature(img);
  const chk = checkTransparent(png);
  assert("≥ 1500 px wide", png.width >= 1500);
  assert("transparent corners, >50% clear, ink is pure black", chk.ok && chk.coloured === 0);
  assert("blue edge and speck removed (crop hugs the stroke)", stats.crop.y > 50 && stats.crop.y + stats.crop.height < h - 20 && stats.specksDropped === 1);
  const real = join(homedir(), "Desktop/Utak/ختم الشركة/signature-transparent.png");
  if (existsSync(real)) {
    const r = PNG.sync.read(readFileSync(real));
    assert("processed file: RGBA, ≥ 1500 px, transparent", r.width >= 1500 && checkTransparent(r).ok);
  } else console.log("  · processed signature file not on this machine — skipped");
}

console.log("\n[7] seal + signature on the four documents");
const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const company: CompanyInfo = {
  nameAr: "شركة يوتاك", nameEn: "UTAK", address: "الرياض", email: "e", phone: "p", cr: "7055194869", vat: "315022736600003",
  stampImage: `data:image/png;base64,${PX}`, signatureImage: `data:image/png;base64,${PX}`,
};
const docs: Array<[string, (d: any, c?: CompanyInfo) => string, any]> = [
  ["quotation", renderQuotationHTML, TEST_QUOTATION_DATA],
  ["delivery note", renderDeliveryNoteHTML, TEST_DELIVERY_NOTE_DATA],
  ["receipt", renderReceiptHTML, TEST_RECEIPT_DATA],
  ["purchase order", renderPurchaseOrderHTML, TEST_PURCHASE_ORDER_DATA],
];
for (const [name, render, data] of docs) {
  const issued = render({ ...data, issued: true }, company);
  const draft = render({ ...data, issued: false }, company);
  const plain = render(data, company);
  assert(`${name}: issued → seal + signature + signatory (ar, en)`, issued.includes('data-utak="stamp"') && issued.includes('data-utak="signature"') && issued.includes(SIGNATORY.ar) && issued.includes(SIGNATORY.en));
  assert(`${name}: seal sits beside the totals, not in the terms row`, issued.indexOf('data-utak="seal-signature"') < issued.indexOf("grid-template-columns: 1fr auto"));
  assert(`${name}: draft → no seal, no signature, no signatory`, !draft.includes('data-utak="seal-signature"') && !draft.includes(SIGNATORY.en));
  assert(`${name}: issued unset → no seal`, !plain.includes('data-utak="seal-signature"'));
}
assert("no company images → no block, no empty frame", !renderQuotationHTML({ ...TEST_QUOTATION_DATA, issued: true }, { ...company, stampImage: undefined, signatureImage: undefined }).includes('data-utak="seal-signature"'));

console.log("\n[8] statements HTML + xlsx");
const meta = { from: FROM, to: TO, issueDate: "2026-09-24", crIssueDate: FROM, periodAr: "p", periodEn: "p", shortYear: ["قصيرة", "short"], company: { nameAr: "شركة يوتاك", nameEn: "UTAK", cr: "7055194869", vat: "315022736600003", addressAr: "8141 شارع", addressEn: "8141 St", shortAddress: "RQYA8141" } };
const html = renderStatementsHTML(st, meta, { bs: 2, is: 3, cf: 4, eq: 5, tb: 6, approval: 6 });
for (const t of ["Statement of Financial Position", "Statement of Profit or Loss", "Statement of Cash Flows", "Statement of Changes in Equity", "Trial Balance", "Chartered Accountant", "المحاسب القانوني", "not been audited", "RQYA8141", "7055194869"]) {
  assert(`html has «${t}»`, html.includes(t));
}
assert("figures printed with brackets for negatives", money(-1000) === "(1,000.00)" && money(0) === "0.00" && html.includes("(1,000.00)"));
assert("ISO dates isolated LTR in Arabic text", ltr("2026-09-13").startsWith("⁦") && ltr("2026-09-13").endsWith("⁩"));
const xb = xlsxBuffer([{ name: "BS", rtl: true, widths: [10, 10], rows: [["a", 1], [{ v: "b", s: "bold" }, { v: 2.5, s: "boldMoney" }]] }, { name: "TB", rows: [["x"]] }]);
const xs = xb.toString("latin1");
assert("xlsx is a zip with workbook, styles and two sheets", xb.readUInt32LE(0) === 0x04034b50 && xs.includes("xl/workbook.xml") && xs.includes("xl/styles.xml") && xs.includes("xl/worksheets/sheet2.xml"));

console.log("\n[9] logo on a transparent background");
const OLD_AVATAR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#F7F5F0"/><g transform="translate(19,19) scale(0.62)"><path d="M25 16 v40 a25 25 0 0 0 50 0 V38.5" fill="none" stroke="#1E5A41" stroke-width="15" stroke-linecap="round"/><rect x="66.25" y="6" width="17.5" height="17.5" fill="#E07B39"/></g></svg>';
assert("detector: the old avatar HAS a background square", svgHasBackground(OLD_AVATAR));
assert("document logo has no background element", !svgHasBackground(UTAK_LOGO_SVG));
assert("document logo keeps the two brand colours", UTAK_LOGO_SVG.includes(`stroke="${BRAND_COLORS.primary}"`) && UTAK_LOGO_SVG.includes(`fill="${BRAND_COLORS.accent}"`) && (UTAK_LOGO_SVG.match(/fill="#/g) ?? []).length === 1);
assert("data URL decodes to the SVG", Buffer.from(UTAK_LOGO_DATA_URL.split(",")[1], "base64").toString("utf8") === UTAK_LOGO_SVG);
const oldUrl = "data:image/svg+xml;base64," + Buffer.from(OLD_AVATAR).toString("base64");
const logoDocs: Array<[string, string]> = [
  ["invoice", renderInvoiceHTML(TEST_INVOICE_DATA)], ["quotation", renderQuotationHTML(TEST_QUOTATION_DATA)],
  ["delivery note", renderDeliveryNoteHTML(TEST_DELIVERY_NOTE_DATA)], ["receipt", renderReceiptHTML(TEST_RECEIPT_DATA)],
  ["purchase order", renderPurchaseOrderHTML(TEST_PURCHASE_ORDER_DATA)],
];
for (const [name, h] of logoDocs) assert(`${name}: transparent logo, never the old avatar`, h.includes(UTAK_LOGO_DATA_URL) && !h.includes(oldUrl));
const logoPng = join(homedir(), "Desktop/Utak/logos kit/png/utak-icon-color-transparent.png");
if (existsSync(logoPng)) {
  const a = analyzeLogoPng(PNG.sync.read(readFileSync(logoPng)), [BRAND_COLORS.primary, BRAND_COLORS.accent]);
  assert("transparent PNG: corners alpha 0, >40% clear", a.transparent && a.transparentShare > 0.4);
  assert("transparent PNG: every opaque pixel is #1E5A41 or #E07B39", a.opaque > 0 && a.opaqueOffBrand === 0);
} else console.log("  · transparent logo PNG not on this machine — skipped");

console.log("\n[10] statements share the invoice identity");
const renderSrc = readFileSync(new URL("../scripts/lib/fin-statements-render.mjs", import.meta.url), "utf8");
assert("renderer holds no hex colour of its own", !/#[0-9A-Fa-f]{3,8}\b/.test(renderSrc));
assert("renderer imports the tokens from pdf-template", /BRAND_COLORS[\s\S]*BRAND_RULES[\s\S]*BRAND_TYPE[\s\S]*from "..\/..\/src\/pdf-template.ts"/.test(renderSrc));
const inv = renderInvoiceHTML(TEST_INVOICE_DATA);
const idMeta = { ...meta, company: { ...meta.company, nameEn: "UTAK Company", legalFormAr: "شركة ذات مسؤولية محدودة (شخص واحد)", legalFormEn: "Limited Liability Company (One Person)", phone: "0580040467", email: "care@utakfresh.com" } };
const sh = renderStatementsHTML(st, idMeta, null);
assert("cream paper: page + @page background = bgPage, as the invoice", sh.includes(`html, body { margin: 0; padding: 0; background: ${BRAND_COLORS.bgPage}; }`) && /@page \{[^}]*background: #F7F5F0/.test(sh) && inv.includes(`background: ${BRAND_COLORS.bgPage}`));
assert("no white background anywhere in the statements", !/background:\s*(#fff\b|#ffffff|white)/i.test(sh));
assert("same logo tag as the invoice", sh.includes(`<img src="${UTAK_LOGO_DATA_URL}" style="${UTAK_LOGO_IMG_STYLE}" alt="UTAK" />`) && inv.includes(`<img src="${UTAK_LOGO_DATA_URL}" style="${UTAK_LOGO_IMG_STYLE}" alt="UTAK" />`));
const brandBlock = renderBrandHeader("x", "y", new Date(0)).match(/<div style="font-size: 24px[^>]*>/)?.[0] ?? "";
assert("same header block (brand name style)", brandBlock.length > 0 && sh.includes(brandBlock) && inv.includes(brandBlock));
assert("same watermark", sh.includes(BRAND_WATERMARK_STYLE) && inv.includes(BRAND_WATERMARK_STYLE));
assert("same table rules (column heads, rows)", sh.includes(`border-top: ${BRAND_RULES.th}; border-bottom: ${BRAND_RULES.th}`) && inv.includes(`border-top: ${BRAND_RULES.th}; border-bottom: ${BRAND_RULES.th}`) && sh.includes(BRAND_RULES.row) && inv.includes(BRAND_RULES.row));
assert("same column-head type (size, weight, tracking)", sh.includes(`font-size: ${BRAND_TYPE.th.size}; font-weight: ${BRAND_TYPE.th.weight}; letter-spacing: ${BRAND_TYPE.th.tracking}`) && inv.includes(`font-size: ${BRAND_TYPE.th.size}; font-weight: ${BRAND_TYPE.th.weight}; color: ${BRAND_COLORS.inkMuted}; letter-spacing: ${BRAND_TYPE.th.tracking}`));
const legalStyle = `font-size: ${BRAND_TYPE.legal.size}; font-weight: ${BRAND_TYPE.legal.weight}; color: ${BRAND_COLORS.inkMuted}; letter-spacing: ${BRAND_TYPE.legal.tracking}; line-height: ${BRAND_TYPE.legal.lineHeight};`;
assert("same legal footer on the cover and after the approval", (sh.match(/data-utak="legal-footer"/g) ?? []).length === 2 && sh.includes(legalStyle) && renderInvoiceHTML(TEST_INVOICE_DATA, company).includes(legalStyle));
assert("legal footer: English mirror line is LTR", sh.includes(`<div dir="ltr" style="text-align: center; ${legalStyle}">UTAK Company`));
assert("cover: legal form ar + en, English legal name", sh.includes("شركة ذات مسؤولية محدودة (شخص واحد)") && sh.includes("Limited Liability Company (One Person)") && sh.includes("UTAK Company"));
assert("still: ISO dates isolated, page numbers bilingual", sh.includes(ltr("2026-09-13")) && renderSrc.includes("Page <span class=\"pageNumber\"></span> of"));

globalThis.fetch = originalFetch;
console.log(`\nfin-statements: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILURES:\n  " + failures.join("\n  ")); process.exit(1); }
console.log(`OK — ${passed} passed, 0 failed`);
