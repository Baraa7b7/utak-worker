// Unit tests for the 2026-09-23 VAT activation (effective 2026-10-01 Riyadh).
//   1. Cutoff: isVatApplicable + Riyadh day boundary (UTC+3)
//   2. Price-included split: 115 → 100 + 15, halala rounding
//   3. Multi-line: invoice VAT = sum of per-line VAT
//   4. syncInvoiceToAccounting dated 2026-09-30 → tax_ids empty, no tax lookup
//   5. syncInvoiceToAccounting dated 2026-10-01 → company sale tax on every line
//   6. Guard: post-cutoff move without a tax line → cancelled, not linked
//   7. Post-cutoff with a tax-EXCLUDED sale tax → refused before any move
//   8. evaluateInvoiceGuard (pure): tax expectations both sides of the cutoff
//   9. Invoice PDF: tax-free shows no VAT row; tax invoice shows net / VAT /
//      gross + seller VAT + customer VAT (only when registered), no QR
//
// Same no-framework style as tests/accounting.test.mts.

import {
  buildInvoiceLineCommands,
  computeInclusiveTotals,
  evaluateInvoiceGuard,
  roundHalala,
  splitTaxInclusive,
  syncInvoiceToAccounting,
  todayRiyadhYmd,
} from "../src/accounting.ts";
import { isVatApplicable, VAT_EFFECTIVE_DATE_RIYADH } from "../src/config.ts";
import { renderInvoiceHTML, renderInvoiceTotalsHTML, TEST_INVOICE_DATA } from "../src/invoice.ts";

// ---------- fetch mock ----------
interface CapturedRequest { url: string; body: any }
let captured: CapturedRequest[] = [];
let responder: (req: CapturedRequest) => any = () => true;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED WhatsApp in vat.test");
  let body: any = null;
  try { body = JSON.parse(init?.body ?? ""); } catch { body = null; }
  const req = { url, body };
  captured.push(req);
  return new Response(JSON.stringify(responder(req)), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof globalThis.fetch;

// No OWNER_WHATSAPP → sendOwnerAlert returns before any send.
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com",
  ODOO_DB: "utakfresh",
  ODOO_LOGIN: "admin@utakfresh.com",
  ODOO_API_KEY: "TEST_KEY",
  ACCOUNTING_SYNC: "true",
};

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(detail ? `${label} — ${detail}` : label); console.log(`  ✗ ${label}${detail ? "  (" + detail + ")" : ""}`); }
}
function reset(): void { captured = []; responder = () => true; }
const hits = (suffix: string) => captured.filter((c) => c.url.endsWith(suffix));
const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const ACCOUNTS = [
  { id: 69, code: "102011", account_type: "asset_receivable" },
  { id: 70, code: "500001", account_type: "income" },
  { id: 121, code: "201017", account_type: "liability_current" },
];
const acc = (id: number) => [id, `${ACCOUNTS.find((a) => a.id === id)!.code} x`];
const SALE_TAX = { id: 5, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true };

/** Odoo mock for one invoice sync; `lines` = what account.move.line/search_read returns. */
function mockOdoo(o: { moveId: number; amountTotal: number; amountTax: number; lines: any[]; tax?: any }): void {
  responder = (req) => {
    const u = req.url;
    if (u.endsWith("/product.product/search_read")) return [];
    if (u.endsWith("/res.partner/read")) return [{ id: 48, property_payment_term_id: false }];
    if (u.endsWith("/res.company/read")) return [{ id: 1, account_sale_tax_id: [5, "15%"] }];
    if (u.endsWith("/account.tax/read")) return [o.tax ?? SALE_TAX];
    if (u.endsWith("/account.move/create")) return [o.moveId];
    if (u.endsWith("/account.move/action_post")) return true;
    if (u.endsWith("/account.move/read")) return [{ id: o.moveId, amount_total: o.amountTotal, amount_tax: o.amountTax, state: "posted" }];
    if (u.endsWith("/account.move.line/search_read")) return o.lines;
    if (u.endsWith("/account.account/read")) return ACCOUNTS;
    if (u.endsWith("/x_invoice/write")) return true;
    return true;
  };
}
const LINES_TAXED_115 = [
  { account_id: acc(69), debit: 115, credit: 0, display_type: "payment_term", tax_line_id: false },
  { account_id: acc(70), debit: 0, credit: 100, display_type: "product", tax_line_id: false },
  { account_id: acc(121), debit: 0, credit: 15, display_type: "tax", tax_line_id: [5, "15%"] },
];
const LINES_UNTAXED_115 = [
  { account_id: acc(69), debit: 115, credit: 0, display_type: "payment_term", tax_line_id: false },
  { account_id: acc(70), debit: 0, credit: 115, display_type: "product", tax_line_id: false },
];

// ==================== 1. cutoff ====================
console.log("\n[1] VAT cutoff — Riyadh invoice date");
assert("constant is 2026-10-01", VAT_EFFECTIVE_DATE_RIYADH === "2026-10-01");
assert("2026-09-30 → no VAT", isVatApplicable("2026-09-30") === false);
assert("2026-10-01 → VAT", isVatApplicable("2026-10-01") === true);
assert("2026-10-05 → VAT", isVatApplicable("2026-10-05") === true);
assert("2025-12-31 → no VAT", isVatApplicable("2025-12-31") === false);
{
  let threw = false;
  try { isVatApplicable("2026-10-1"); } catch { threw = true; }
  assert("malformed date throws (never silently tax-free)", threw);
}
// 2026-09-30 21:00 UTC is already 2026-10-01 00:00 in Riyadh.
assert("2026-09-30T20:59:59Z → Riyadh 2026-09-30 → no VAT",
  isVatApplicable(todayRiyadhYmd(new Date("2026-09-30T20:59:59Z"))) === false);
assert("2026-09-30T21:00:00Z → Riyadh 2026-10-01 → VAT",
  isVatApplicable(todayRiyadhYmd(new Date("2026-09-30T21:00:00Z"))) === true);

// ==================== 2. price-included split ====================
console.log("\n[2] splitTaxInclusive — price-included, halala rounding");
{
  const s = splitTaxInclusive(115, 15);
  assert("115 → net 100", s.net === 100, JSON.stringify(s));
  assert("115 → tax 15", s.tax === 15, JSON.stringify(s));
  const t = splitTaxInclusive(10, 15); // 10×15/115 = 1.3043…
  assert("10 → tax 1.30", t.tax === 1.3, JSON.stringify(t));
  assert("10 → net 8.70", t.net === 8.7, JSON.stringify(t));
  const u = splitTaxInclusive(100.5, 15); // 13.1087…
  assert("100.5 → tax 13.11 / net 87.39", u.tax === 13.11 && u.net === 87.39, JSON.stringify(u));
  const z = splitTaxInclusive(50, 0);
  assert("rate 0 → net = gross, tax 0", z.net === 50 && z.tax === 0);
  let allOk = true;
  for (let c = 1; c <= 20000; c += 7) {
    const g = c / 100;
    const r = splitTaxInclusive(g, 15);
    if (!twoDecimals(r.net) || !twoDecimals(r.tax) || roundHalala(r.net + r.tax) !== roundHalala(g)) { allOk = false; break; }
  }
  assert("0.01…200: net & tax have 2 decimals and net + tax = gross exactly", allOk);
  assert("roundHalala(1.005) = 1.01 (binary drift guarded)", roundHalala(1.005) === 1.01);
}

// ==================== 3. multi-line ====================
console.log("\n[3] computeInclusiveTotals — multi-line invoice");
{
  const grosses = [115, 10, 33.33, 7.99, 100.5];
  const t = computeInclusiveTotals(grosses, 15);
  const sumLineTax = roundHalala(t.lines.reduce((a, l) => a + l.tax, 0));
  const sumLineNet = roundHalala(t.lines.reduce((a, l) => a + l.net, 0));
  assert("invoice tax = sum of line taxes", t.tax === sumLineTax, `${t.tax} vs ${sumLineTax}`);
  assert("subtotal = sum of line nets", t.subtotal === sumLineNet);
  assert("total = sum of grosses (customer pays the same)", t.total === roundHalala(grosses.reduce((a, b) => a + b, 0)), String(t.total));
  assert("subtotal + tax = total", roundHalala(t.subtotal + t.tax) === t.total);
  assert("line taxes 15 / 1.30 / 4.35 / 1.04 / 13.11", JSON.stringify(t.lines.map((l) => l.tax)) === JSON.stringify([15, 1.3, 4.35, 1.04, 13.11]), JSON.stringify(t.lines.map((l) => l.tax)));
  const none = computeInclusiveTotals(grosses, null);
  assert("no VAT → tax 0, subtotal = total", none.tax === 0 && none.subtotal === none.total);
  const cmds = buildInvoiceLineCommands([{ product_tmpl_id: 0, description: "x", quantity: 1, price_unit: 115 }], new Map(), [5]);
  assert("buildInvoiceLineCommands with tax → [[6,0,[5]]]", JSON.stringify((cmds[0][2] as any).tax_ids) === "[[6,0,[5]]]");
  assert("price_unit stays the gross 115", (cmds[0][2] as any).price_unit === 115);
}

// ==================== 4. sync before cutoff ====================
async function testBeforeCutoff(): Promise<void> {
  console.log("\n[4] syncInvoiceToAccounting dated 2026-09-30 — no tax");
  reset();
  mockOdoo({ moveId: 60, amountTotal: 50, amountTax: 0, lines: [
    { account_id: acc(69), debit: 50, credit: 0, display_type: "payment_term", tax_line_id: false },
    { account_id: acc(70), debit: 0, credit: 50, display_type: "product", tax_line_id: false },
  ] });
  const r = await syncInvoiceToAccounting(env, {
    invoiceId: 1, existingMoveId: null, invoiceNumber: "T-0930", customerPartnerId: 48,
    invoiceDate: "2026-09-30",
    lines: [{ product_tmpl_id: 0, description: "x", quantity: 1, price_unit: 50 }],
    expectedTotal: 50,
  });
  assert("linked (move 60)", r === 60);
  const create = hits("/account.move/create")[0];
  const lines = create?.body?.vals_list?.[0]?.invoice_line_ids ?? [];
  assert("invoice_date 2026-09-30 sent", create?.body?.vals_list?.[0]?.invoice_date === "2026-09-30");
  assert("tax_ids explicitly empty", JSON.stringify(lines[0]?.[2]?.tax_ids) === "[[6,0,[]]]", JSON.stringify(lines[0]?.[2]?.tax_ids));
  assert("no company / tax lookup before the cutoff", hits("/res.company/read").length === 0 && hits("/account.tax/read").length === 0);
}

// ==================== 5. sync from cutoff ====================
async function testFromCutoff(): Promise<void> {
  console.log("\n[5] syncInvoiceToAccounting dated 2026-10-01 — 15% price-included");
  reset();
  mockOdoo({ moveId: 61, amountTotal: 115, amountTax: 15, lines: LINES_TAXED_115 });
  const r = await syncInvoiceToAccounting(env, {
    invoiceId: 2, existingMoveId: null, invoiceNumber: "T-1001", customerPartnerId: 48,
    invoiceDate: "2026-10-01",
    lines: [{ product_tmpl_id: 0, description: "x", quantity: 1, price_unit: 115 }],
    expectedTotal: 115,
  });
  assert("linked (move 61)", r === 61);
  const lines = hits("/account.move/create")[0]?.body?.vals_list?.[0]?.invoice_line_ids ?? [];
  assert("tax id read from Odoo company (res.company/read)", hits("/res.company/read").length === 1);
  assert("line tax_ids = [5] (resolved, not hard-coded)", JSON.stringify(lines[0]?.[2]?.tax_ids) === "[[6,0,[5]]]", JSON.stringify(lines[0]?.[2]?.tax_ids));
  assert("price_unit sent as the gross 115", lines[0]?.[2]?.price_unit === 115);
  assert("no cancel", hits("/account.move/button_cancel").length === 0);
  assert("x_invoice linked", hits("/x_invoice/write")[0]?.body?.vals?.x_account_move_id === 61);

  // multi-line, Odoo returns per-line-rounded tax
  reset();
  const t = computeInclusiveTotals([115, 10, 33.33], 15);
  mockOdoo({ moveId: 62, amountTotal: t.total, amountTax: t.tax, lines: [
    { account_id: acc(69), debit: t.total, credit: 0, display_type: "payment_term", tax_line_id: false },
    { account_id: acc(70), debit: 0, credit: t.subtotal, display_type: "product", tax_line_id: false },
    { account_id: acc(121), debit: 0, credit: t.tax, display_type: "tax", tax_line_id: [5, "15%"] },
  ] });
  const r2 = await syncInvoiceToAccounting(env, {
    invoiceId: 3, existingMoveId: null, invoiceNumber: "T-1001-M", customerPartnerId: 48,
    invoiceDate: "2026-10-01",
    lines: [
      { product_tmpl_id: 0, description: "a", quantity: 1, price_unit: 115 },
      { product_tmpl_id: 0, description: "b", quantity: 2, price_unit: 5 },
      { product_tmpl_id: 0, description: "c", quantity: 1, price_unit: 33.33 },
    ],
    expectedTotal: t.total,
  });
  assert("multi-line: linked when Odoo tax = sum of line taxes", r2 === 62);
  const l2 = hits("/account.move/create")[0]?.body?.vals_list?.[0]?.invoice_line_ids ?? [];
  assert("multi-line: every line carries tax 5", l2.length === 3 && l2.every((c: any) => JSON.stringify(c[2].tax_ids) === "[[6,0,[5]]]"));
}

// ==================== 6. guard: no tax line after cutoff ====================
async function testGuardMissingTaxLine(): Promise<void> {
  console.log("\n[6] guard — post-cutoff move without a tax line → cancel, no link");
  reset();
  mockOdoo({ moveId: 63, amountTotal: 115, amountTax: 0, lines: LINES_UNTAXED_115 });
  const errs: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => { errs.push(a.map(String).join(" ")); };
  const r = await syncInvoiceToAccounting(env, {
    invoiceId: 4, existingMoveId: null, invoiceNumber: "T-1005-NOTAX", customerPartnerId: 48,
    invoiceDate: "2026-10-05",
    lines: [{ product_tmpl_id: 0, description: "x", quantity: 1, price_unit: 115 }],
    expectedTotal: 115,
  });
  console.error = origErr;
  assert("returns null", r === null);
  assert("move reset to draft", hits("/account.move/button_draft").some((c) => c.body?.ids?.[0] === 63));
  assert("move cancelled", hits("/account.move/button_cancel").some((c) => c.body?.ids?.[0] === 63));
  assert("x_invoice NOT linked", hits("/x_invoice/write").length === 0);
  assert("alert text names the missing tax line", errs.some((e) => e.includes("بلا سطر ضريبة")), errs.join(" | "));
}

// ==================== 7. tax-excluded sale tax refused ====================
async function testTaxExcludedRefused(): Promise<void> {
  console.log("\n[7] post-cutoff with a tax-EXCLUDED sale tax → refused before any move");
  reset();
  mockOdoo({ moveId: 64, amountTotal: 132.25, amountTax: 17.25, lines: [], tax: { ...SALE_TAX, price_include: false } });
  const origErr = console.error;
  console.error = () => {};
  const r = await syncInvoiceToAccounting(env, {
    invoiceId: 5, existingMoveId: null, invoiceNumber: "T-1005-EXCL", customerPartnerId: 48,
    invoiceDate: "2026-10-05",
    lines: [{ product_tmpl_id: 0, description: "x", quantity: 1, price_unit: 115 }],
    expectedTotal: 115,
  });
  console.error = origErr;
  assert("returns null", r === null);
  assert("no account.move created", hits("/account.move/create").length === 0);
}

// ==================== 7b. post refused → no orphan draft ====================
async function testPostRefusedCancelsDraft(): Promise<void> {
  console.log("\n[7b] action_post refused by Odoo → draft cancelled, not linked");
  reset();
  mockOdoo({ moveId: 65, amountTotal: 115, amountTax: 15, lines: LINES_TAXED_115 });
  const inner = responder;
  responder = (req) => {
    if (req.url.endsWith("/account.move/action_post")) throw new Error("ZATCA does not allow future-dated invoices");
    return inner(req);
  };
  // The mock fetch turns a thrown responder into a rejected fetch.
  const origErr = console.error;
  console.error = () => {};
  const r = await syncInvoiceToAccounting(env, {
    invoiceId: 6, existingMoveId: null, invoiceNumber: "T-FUTURE", customerPartnerId: 48,
    invoiceDate: "2026-10-05",
    lines: [{ product_tmpl_id: 0, description: "x", quantity: 1, price_unit: 115 }],
    expectedTotal: 115,
  });
  console.error = origErr;
  assert("returns null", r === null);
  assert("draft move 65 cancelled", hits("/account.move/button_cancel").some((c) => c.body?.ids?.[0] === 65));
  assert("x_invoice NOT linked", hits("/x_invoice/write").length === 0);
}

// ==================== 8. pure guard ====================
function testPureGuard(): void {
  console.log("\n[8] evaluateInvoiceGuard — tax expectations");
  const taxedLines = [
    { account_code: "102011", account_type: "asset_receivable", debit: 115, credit: 0 },
    { account_code: "500001", account_type: "income", debit: 0, credit: 100 },
    { account_code: "201017", account_type: "liability_current", debit: 0, credit: 15, is_tax: true },
  ];
  const untaxedLines = [
    { account_code: "102011", account_type: "asset_receivable", debit: 50, credit: 0 },
    { account_code: "500001", account_type: "income", debit: 0, credit: 50 },
  ];
  const exp = (o: Partial<{ expectTax: boolean; expectedTax: number; amountTax: number; expectedTotal: number; amountTotal: number }>) =>
    ({ expectTax: true, expectedTax: 15, amountTax: 15, expectedTotal: 115, amountTotal: 115, ...o });
  assert("after cutoff, tax line 15 → ok", evaluateInvoiceGuard({ moveState: "posted", lines: taxedLines, tax: exp({}) }).ok);
  const noTax = evaluateInvoiceGuard({ moveState: "posted", lines: untaxedLines.map((l) => ({ ...l, debit: l.debit ? 115 : 0, credit: l.credit ? 115 : 0 })), tax: exp({ amountTax: 0 }) });
  assert("after cutoff, no tax line → rejected", !noTax.ok && noTax.reasons.some((x) => x.includes("بلا سطر ضريبة")), noTax.reasons.join("؛ "));
  assert("after cutoff, wrong tax amount → rejected", !evaluateInvoiceGuard({ moveState: "posted", lines: taxedLines, tax: exp({ expectedTax: 14.99 }) }).ok);
  assert("after cutoff, inflated total (tax-excluded) → rejected", !evaluateInvoiceGuard({ moveState: "posted", lines: taxedLines, tax: exp({ amountTotal: 132.25 }) }).ok);
  assert("before cutoff, no tax line → ok", evaluateInvoiceGuard({ moveState: "posted", lines: untaxedLines, tax: { expectTax: false, expectedTax: 0, amountTax: 0, expectedTotal: 50, amountTotal: 50 } }).ok);
  assert("before cutoff, a tax line → rejected", !evaluateInvoiceGuard({ moveState: "posted", lines: taxedLines, tax: { expectTax: false, expectedTax: 0, amountTax: 15, expectedTotal: 115, amountTotal: 115 } }).ok);
  assert("no tax expectation passed → legacy behaviour", evaluateInvoiceGuard({ moveState: "posted", lines: untaxedLines }).ok);
}

// ==================== 9. PDF ====================
function testPdf(): void {
  console.log("\n[9] invoice PDF — tax-free vs tax invoice");
  const company: any = {
    nameAr: "UTAK — يو تاك", nameEn: "UTAK", address: "الرياض", email: "x@y", phone: "05",
    cr: "", vat: "315022736600003",
  };
  const legacy = renderInvoiceHTML({ ...TEST_INVOICE_DATA, vatAmount: 0 }, company);
  assert("tax-free: no VAT row", !legacy.includes("ضريبة القيمة المضافة (١٥٪)"));
  assert("tax-free: title stays فاتورة (not ضريبية)", !legacy.includes("فاتورة ضريبية"));
  assert("tax-free: no 'before VAT' / 'incl. VAT' labels", !legacy.includes("قبل الضريبة") && !legacy.includes("شامل الضريبة"));
  assert("tax-free: no customer VAT label", !legacy.includes("الرقم الضريبي للعميل"));

  const gross = 115;
  const s = splitTaxInclusive(gross, 15);
  const base = {
    ...TEST_INVOICE_DATA,
    items: [{ name: "طماطم", pack: "كرتون", qty: 1, price: 115, total: 115 }],
    subtotal: s.net, vatAmount: s.tax, grandTotal: gross,
  };
  const taxed = renderInvoiceHTML({ ...base, customer: { ...base.customer, vat: "300000000000003" } }, company);
  assert("tax: title فاتورة ضريبية", taxed.includes("فاتورة ضريبية"));
  assert("tax: total before VAT 100.00", taxed.includes("الإجمالي قبل الضريبة") && taxed.includes("100.00 ريال"));
  assert("tax: VAT 15% row 15.00", taxed.includes("ضريبة القيمة المضافة (١٥٪)") && taxed.includes("15.00 ريال"));
  assert("tax: total incl. VAT 115.00", taxed.includes("الإجمالي شامل الضريبة") && taxed.includes("115.00 ريال"));
  assert("tax: seller VAT number from company", taxed.includes("الرقم الضريبي للمنشأة") && taxed.includes("315022736600003"));
  assert("tax: customer VAT number when registered", taxed.includes("الرقم الضريبي للعميل") && taxed.includes("300000000000003"));
  assert("tax: no ZATCA QR placeholder", !taxed.includes("ZATCA<br>QR"));
  const noBuyer = renderInvoiceHTML(base, company);
  assert("tax: customer without VAT → no customer VAT row", !noBuyer.includes("الرقم الضريبي للعميل"));
  const en = renderInvoiceTotalsHTML(100, 0, 15, 115, "en", { seller: "315022736600003" });
  assert("en labels: Total excl. VAT / VAT (15%) / Total incl. VAT / Seller VAT No.",
    en.includes("Total excl. VAT") && en.includes("VAT (15%)") && en.includes("Total incl. VAT") && en.includes("Seller VAT No."));
}

async function main(): Promise<void> {
  try {
    await testBeforeCutoff();
    await testFromCutoff();
    await testGuardMissingTaxLine();
    await testTaxExcludedRefused();
    await testPostRefusedCancelsDraft();
    testPureGuard();
    testPdf();
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("test runner crashed", e); process.exit(1); });
