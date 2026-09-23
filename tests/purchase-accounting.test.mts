// Unit tests for purchase → accounting (2026-09-23).
//   1. Unregistered supplier (after the cutoff) → no tax on any line, linked
//   2. Registered supplier after the cutoff: 115 tax-included → 100 + 15,
//      the included twin of the company purchase tax on the line
//   3. Registered supplier before the cutoff → no tax, no tax lookup
//   4. Idempotency: linked list → nothing created; unlinked live PO with the
//      list origin → nothing created, owner alerted
//   5. Guard: expected tax line missing → bill + PO cancelled, not linked
//   6. Guard: wrong account (income) → bill + PO cancelled, not linked
//   7. action_post refused → draft bill + PO cancelled, no orphan
//   8. Missing supplier / missing unit_price → nothing created
//   9. evaluateVendorBillGuard (pure) + tax twin resolution
//  10. prefillPurchasePrices: x_daily_price fill, unique supplier, edited price kept
//  11. ACCOUNTING_SYNC off → no Odoo call
//
// Same no-framework style as tests/vat.test.mts.

import {
  buildPurchaseOrderLineCommands,
  evaluateVendorBillGuard,
  purchaseListOrigin,
  resolveCompanyPurchaseTaxIncluded,
  supplierIsVatRegistered,
  syncPurchaseListToAccounting,
  validatePurchaseItems,
} from "../src/purchase-accounting.ts";
import { prefillPurchasePrices } from "../src/odoo.ts";

// ---------- fetch mock ----------
interface CapturedRequest { url: string; body: any }
let captured: CapturedRequest[] = [];
let responder: (req: CapturedRequest) => any = () => true;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED WhatsApp in purchase-accounting.test");
  let body: any = null;
  try { body = JSON.parse(init?.body ?? ""); } catch { body = null; }
  const req = { url, body };
  captured.push(req);
  return new Response(JSON.stringify(responder(req)), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof globalThis.fetch;

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
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const e = console.error, w = console.warn, l = console.log;
  console.error = () => {}; console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; }
}

const ACCOUNTS = [
  { id: 136, code: "400001", account_type: "expense_direct_cost" },
  { id: 106, code: "201002", account_type: "liability_payable" },
  { id: 100, code: "104041", account_type: "asset_current" },
  { id: 70, code: "500001", account_type: "income" },
];
const acc = (id: number) => [id, `${ACCOUNTS.find((a) => a.id === id)!.code} x`];
const TAX21 = { id: 21, amount: 15, amount_type: "percent", type_tax_use: "purchase", price_include: false, active: true, tax_group_id: [3, "VAT"] };
const TAX43 = { id: 43, amount: 15, amount_type: "percent", type_tax_use: "purchase", price_include: true, active: true, tax_group_id: [3, "VAT"] };

const LINES_TAXED_115 = [
  { account_id: acc(136), debit: 100, credit: 0, display_type: "product", tax_line_id: false },
  { account_id: acc(100), debit: 15, credit: 0, display_type: "tax", tax_line_id: [43, "15%"] },
  { account_id: acc(106), debit: 0, credit: 115, display_type: "payment_term", tax_line_id: false },
];
const LINES_UNTAXED_80 = [
  { account_id: acc(136), debit: 80, credit: 0, display_type: "product", tax_line_id: false },
  { account_id: acc(106), debit: 0, credit: 80, display_type: "payment_term", tax_line_id: false },
];

function item(price: number | null, qty = 1) {
  return { product_id: 105, product_name: "افوكادو", packaging_id: 47, packaging_name: "كرتون", total_quantity: qty, order_ids: [1], unit_price: price };
}

/** Odoo mock for one list sync. */
function mockOdoo(o: {
  listId?: number;
  supplier?: [number, string] | false;
  vat?: string | false;
  items?: any[];
  linkedPo?: number | false;
  orphans?: any[];
  poId?: number;
  billId?: number;
  amountTotal: number;
  amountTax: number;
  lines: any[];
  moveType?: string;
}): void {
  const poId = o.poId ?? 501;
  const billId = o.billId ?? 601;
  responder = (req) => {
    const u = req.url;
    if (u.endsWith("/x_purchase_list/read")) return [{
      id: o.listId ?? 7,
      x_supplier_id: o.supplier === undefined ? [90, "مورد"] : o.supplier,
      x_purchase_order_id: o.linkedPo ? [o.linkedPo, "P0001"] : false,
      x_account_move_id: false,
      x_aggregated_items: JSON.stringify(o.items ?? [item(115)]),
    }];
    if (u.endsWith("/purchase.order/search_read")) return o.orphans ?? [];
    if (u.endsWith("/product.product/search_read")) return [{ id: 900 }];
    if (u.endsWith("/res.partner/read")) return [{ id: 90, vat: o.vat ?? false }];
    if (u.endsWith("/res.company/read")) return [{ id: 1, account_purchase_tax_id: [21, "15%"] }];
    if (u.endsWith("/account.tax/read")) return [TAX21];
    if (u.endsWith("/account.tax/search_read")) return [TAX43];
    if (u.endsWith("/purchase.order/create")) return [poId];
    if (u.endsWith("/purchase.order/button_confirm")) return true;
    if (u.endsWith("/purchase.order/action_create_invoice")) return { res_model: "account.move", res_id: billId };
    if (u.endsWith("/purchase.order/read")) return [{ id: poId, state: "purchase", invoice_ids: [billId] }];
    if (u.endsWith("/account.move/write")) return true;
    if (u.endsWith("/account.move/action_post")) return true;
    if (u.endsWith("/account.move/read")) return [{ id: billId, state: "posted", move_type: o.moveType ?? "in_invoice", amount_total: o.amountTotal, amount_tax: o.amountTax }];
    if (u.endsWith("/account.move.line/search_read")) return o.lines;
    if (u.endsWith("/account.account/read")) return ACCOUNTS;
    return true;
  };
}
const poLines = () => hits("/purchase.order/create")[0]?.body?.vals_list?.[0]?.order_line ?? [];
const linked = () => hits("/x_purchase_list/write");

// ==================== 1. unregistered ====================
async function testUnregistered(): Promise<void> {
  console.log("\n[1] unregistered supplier after the cutoff → no tax");
  reset();
  mockOdoo({ vat: false, items: [item(80)], amountTotal: 80, amountTax: 0, lines: LINES_UNTAXED_80 });
  const r = await quiet(() => syncPurchaseListToAccounting(env, 7, { billDate: "2026-10-05" }));
  assert("linked", r?.purchaseOrderId === 501 && r?.moveId === 601, JSON.stringify(r));
  assert("PO line tax_ids = [[6,0,[]]]", JSON.stringify(poLines()[0]?.[2]?.tax_ids) === "[[6,0,[]]]");
  assert("PO line = service product 900, 1 × 80", poLines()[0]?.[2]?.product_id === 900 && poLines()[0]?.[2]?.price_unit === 80 && poLines()[0]?.[2]?.product_qty === 1);
  assert("PO origin = x_purchase_list/7", hits("/purchase.order/create")[0]?.body?.vals_list?.[0]?.origin === purchaseListOrigin(7));
  assert("no tax lookup", hits("/account.tax/read").length === 0 && hits("/account.tax/search_read").length === 0);
  assert("button_confirm called", hits("/purchase.order/button_confirm").length === 1);
  assert("bill dated 2026-10-05", hits("/account.move/write")[0]?.body?.vals?.invoice_date === "2026-10-05");
  assert("both fields linked", JSON.stringify(linked()[0]?.body?.vals) === JSON.stringify({ x_purchase_order_id: 501, x_account_move_id: 601 }));
  assert("nothing cancelled", hits("/button_cancel").length === 0);
}

// ==================== 2. registered after cutoff ====================
async function testRegisteredAfter(): Promise<void> {
  console.log("\n[2] registered supplier after the cutoff: 115 → 100 + 15");
  reset();
  mockOdoo({ vat: "399999999900003", amountTotal: 115, amountTax: 15, lines: LINES_TAXED_115 });
  const r = await quiet(() => syncPurchaseListToAccounting(env, 7, { billDate: "2026-10-01" }));
  assert("linked", r?.moveId === 601);
  assert("line carries the included twin 43", JSON.stringify(poLines()[0]?.[2]?.tax_ids) === "[[6,0,[43]]]");
  assert("price_unit stays the paid 115", poLines()[0]?.[2]?.price_unit === 115);
  assert("company tax read from Odoo", hits("/res.company/read").length === 1);
}

// ==================== 3. registered before cutoff ====================
async function testRegisteredBefore(): Promise<void> {
  console.log("\n[3] registered supplier before the cutoff → no tax");
  reset();
  mockOdoo({ vat: "399999999900003", items: [item(115)], amountTotal: 115, amountTax: 0, lines: [
    { account_id: acc(136), debit: 115, credit: 0, display_type: "product", tax_line_id: false },
    { account_id: acc(106), debit: 0, credit: 115, display_type: "payment_term", tax_line_id: false },
  ] });
  const r = await quiet(() => syncPurchaseListToAccounting(env, 7, { billDate: "2026-09-30" }));
  assert("linked", r?.moveId === 601);
  assert("tax_ids empty", JSON.stringify(poLines()[0]?.[2]?.tax_ids) === "[[6,0,[]]]");
  assert("no tax lookup", hits("/res.company/read").length === 0);
}

// ==================== 4. idempotency ====================
async function testIdempotency(): Promise<void> {
  console.log("\n[4] idempotency");
  reset();
  mockOdoo({ linkedPo: 501, amountTotal: 0, amountTax: 0, lines: [] });
  const r = await quiet(() => syncPurchaseListToAccounting(env, 7, { billDate: "2026-09-23" }));
  assert("linked list → skipped", r?.skipped === true && r?.purchaseOrderId === 501);
  assert("no purchase.order created", hits("/purchase.order/create").length === 0);
  assert("no write", linked().length === 0 && hits("/account.move/write").length === 0);

  reset();
  mockOdoo({ orphans: [{ id: 499, name: "P00009", state: "purchase" }], amountTotal: 0, amountTax: 0, lines: [] });
  const r2 = await quiet(() => syncPurchaseListToAccounting(env, 7, { billDate: "2026-09-23" }));
  assert("unlinked live PO with the list origin → null", r2 === null);
  assert("no second purchase.order", hits("/purchase.order/create").length === 0);
  assert("orphan search keyed on origin", JSON.stringify(hits("/purchase.order/search_read")[0]?.body?.domain?.[0]) === JSON.stringify(["origin", "=", "x_purchase_list/7"]));
}

// ==================== 5. guard: missing tax line ====================
async function testGuardMissingTax(): Promise<void> {
  console.log("\n[5] guard — registered after cutoff but the bill has no tax line");
  reset();
  mockOdoo({ vat: "399999999900003", amountTotal: 115, amountTax: 0, lines: [
    { account_id: acc(136), debit: 115, credit: 0, display_type: "product", tax_line_id: false },
    { account_id: acc(106), debit: 0, credit: 115, display_type: "payment_term", tax_line_id: false },
  ] });
  const r = await quiet(() => syncPurchaseListToAccounting(env, 7, { billDate: "2026-10-02" }));
  assert("returns null", r === null);
  assert("bill 601 reset + cancelled", hits("/account.move/button_draft").some((c) => c.body?.ids?.[0] === 601) && hits("/account.move/button_cancel").some((c) => c.body?.ids?.[0] === 601));
  assert("PO 501 cancelled", hits("/purchase.order/button_cancel").some((c) => c.body?.ids?.[0] === 501));
  assert("not linked", linked().length === 0);
}

// ==================== 6. guard: wrong account ====================
async function testGuardWrongAccount(): Promise<void> {
  console.log("\n[6] guard — cost landed on an income account");
  reset();
  mockOdoo({ vat: false, items: [item(80)], amountTotal: 80, amountTax: 0, lines: [
    { account_id: acc(70), debit: 80, credit: 0, display_type: "product", tax_line_id: false },
    { account_id: acc(106), debit: 0, credit: 80, display_type: "payment_term", tax_line_id: false },
  ] });
  const r = await quiet(() => syncPurchaseListToAccounting(env, 7, { billDate: "2026-09-23" }));
  assert("returns null", r === null);
  assert("bill cancelled", hits("/account.move/button_cancel").length === 1);
  assert("PO cancelled", hits("/purchase.order/button_cancel").length === 1);
  assert("not linked", linked().length === 0);
}

// ==================== 7. action_post refused ====================
async function testPostRefused(): Promise<void> {
  console.log("\n[7] action_post refused → draft bill + PO cancelled, no orphan");
  reset();
  mockOdoo({ vat: false, items: [item(80)], amountTotal: 80, amountTax: 0, lines: LINES_UNTAXED_80 });
  const inner = responder;
  responder = (req) => {
    if (req.url.endsWith("/account.move/action_post")) throw new Error("ZATCA does not allow future-dated invoices");
    return inner(req);
  };
  const r = await quiet(() => syncPurchaseListToAccounting(env, 7, { billDate: "2026-09-23" }));
  assert("returns null", r === null);
  assert("draft bill 601 cancelled", hits("/account.move/button_cancel").some((c) => c.body?.ids?.[0] === 601));
  assert("PO 501 cancelled", hits("/purchase.order/button_cancel").some((c) => c.body?.ids?.[0] === 501));
  assert("not linked", linked().length === 0);
}

// ==================== 8. missing inputs ====================
async function testMissingInputs(): Promise<void> {
  console.log("\n[8] missing supplier / unit_price → nothing created");
  reset();
  mockOdoo({ supplier: false, amountTotal: 0, amountTax: 0, lines: [] });
  assert("no supplier → null", (await quiet(() => syncPurchaseListToAccounting(env, 7))) === null);
  assert("no PO", hits("/purchase.order/create").length === 0);
  reset();
  mockOdoo({ items: [item(null, 3)], amountTotal: 0, amountTax: 0, lines: [] });
  assert("no unit_price → null", (await quiet(() => syncPurchaseListToAccounting(env, 7))) === null);
  assert("no PO", hits("/purchase.order/create").length === 0);
  assert("validatePurchaseItems names the item", validatePurchaseItems([item(null) as any])[0]?.includes("افوكادو"));
  assert("validatePurchaseItems ok when priced", validatePurchaseItems([item(10) as any]).length === 0);
  assert("zero-qty items dropped from PO lines", buildPurchaseOrderLineCommands([item(10, 0) as any, item(5, 2) as any], 900, []).length === 1);
}

// ==================== 9. pure guard + tax twin ====================
async function testPure(): Promise<void> {
  console.log("\n[9] evaluateVendorBillGuard + tax twin");
  const g = (lines: any[], tax: any, extra: any = {}) => evaluateVendorBillGuard({ moveState: "posted", moveType: "in_invoice", lines, tax, ...extra });
  const taxed = [
    { account_code: "400001", account_type: "expense_direct_cost", debit: 100, credit: 0 },
    { account_code: "104041", account_type: "asset_current", debit: 15, credit: 0, is_tax: true },
    { account_code: "201002", account_type: "liability_payable", debit: 0, credit: 115 },
  ];
  const untaxed = [
    { account_code: "400001", account_type: "expense_direct_cost", debit: 80, credit: 0 },
    { account_code: "201002", account_type: "liability_payable", debit: 0, credit: 80 },
  ];
  const T = (o: any = {}) => ({ expectTax: true, expectedTax: 15, amountTax: 15, expectedTotal: 115, amountTotal: 115, ...o });
  const U = (o: any = {}) => ({ expectTax: false, expectedTax: 0, amountTax: 0, expectedTotal: 80, amountTotal: 80, ...o });
  assert("taxed 100/15/115 → ok", g(taxed, T()).ok);
  assert("untaxed 80/80 → ok", g(untaxed, U()).ok);
  assert("plain expense account also ok", g([{ ...untaxed[0], account_type: "expense" }, untaxed[1]], U()).ok);
  assert("expected tax missing → refused", !g(untaxed.map((l) => ({ ...l, debit: l.debit ? 115 : 0, credit: l.credit ? 115 : 0 })), T({ amountTax: 0 })).ok);
  assert("unexpected tax line → refused", !g(taxed, U({ expectedTotal: 115, amountTotal: 115, amountTax: 15 })).ok);
  assert("tax 14.99 ≠ 15 → refused", !g(taxed, T({ amountTax: 14.99 })).ok);
  assert("income account → refused", !g([{ ...untaxed[0], account_code: "500001", account_type: "income" }, untaxed[1]], U()).ok);
  assert("receivable instead of payable → refused", !g([untaxed[0], { ...untaxed[1], account_type: "asset_receivable" }], U()).ok);
  assert("unbalanced → refused", !g([untaxed[0], { ...untaxed[1], credit: 79 }], U()).ok);
  assert("total ≠ paid → refused", !g(untaxed, U({ amountTotal: 92 })).ok);
  assert("draft → refused", !g(untaxed, U(), { moveState: "draft" }).ok);
  assert("out_invoice → refused", !g(untaxed, U(), { moveType: "out_invoice" }).ok);
  assert("supplierIsVatRegistered", supplierIsVatRegistered("3999") && !supplierIsVatRegistered("  ") && !supplierIsVatRegistered(false));

  reset();
  responder = (req) => {
    if (req.url.endsWith("/res.company/read")) return [{ id: 1, account_purchase_tax_id: [21, "15%"] }];
    if (req.url.endsWith("/account.tax/read")) return [TAX21];
    if (req.url.endsWith("/account.tax/search_read")) return [TAX43];
    return true;
  };
  const t = await resolveCompanyPurchaseTaxIncluded(env);
  assert("excluded company tax 21 → included twin 43", t.id === 43 && t.rate === 15);
  const dom = JSON.stringify(hits("/account.tax/search_read")[0]?.body?.domain);
  assert("twin searched by rate + tax_included + group", dom.includes('"price_include_override","=","tax_included"') && dom.includes('"amount","=",15') && dom.includes('"tax_group_id","=",3'));
  reset();
  responder = (req) => {
    if (req.url.endsWith("/res.company/read")) return [{ id: 1, account_purchase_tax_id: [21, "15%"] }];
    if (req.url.endsWith("/account.tax/read")) return [TAX21];
    if (req.url.endsWith("/account.tax/search_read")) return [];
    return true;
  };
  let threw = false;
  try { await resolveCompanyPurchaseTaxIncluded(env); } catch { threw = true; }
  assert("no twin → throws (no silent tax-free bill)", threw);
}

// ==================== 10. prefill ====================
async function testPrefill(): Promise<void> {
  console.log("\n[10] prefillPurchasePrices");
  reset();
  responder = (req) => {
    if (req.url.endsWith("/x_daily_price/search_read")) return [
      { x_product_tmpl_id: [105, "a"], x_packaging_id: [47, "k"], x_supplier_id: [30, "أحمد"], x_price_sar: 45 },
      { x_product_tmpl_id: [105, "a"], x_packaging_id: [47, "k"], x_supplier_id: [30, "أحمد"], x_price_sar: 40 },
      { x_product_tmpl_id: [97, "b"], x_packaging_id: [33, "k"], x_supplier_id: [30, "أحمد"], x_price_sar: 44 },
    ];
    return true;
  };
  const base = [
    { product_id: 105, product_name: "افوكادو", packaging_id: 47, packaging_name: "كرتون", total_quantity: 2, order_ids: [1] },
    { product_id: 97, product_name: "موز", packaging_id: 33, packaging_name: "كرتون", total_quantity: 1, order_ids: [1] },
    { product_id: 71, product_name: "طماطم", packaging_id: 1, packaging_name: "فلين", total_quantity: 3, order_ids: [2] },
  ];
  const r = await prefillPurchasePrices(env as any, base, "2026-09-23");
  assert("latest price wins (45)", r.items[0].unit_price === 45);
  assert("second item 44", r.items[1].unit_price === 44);
  assert("unpriced item → null", r.items[2].unit_price === null);
  assert("unique supplier → 30", r.supplierId === 30);
  assert("queried by today's date", JSON.stringify(hits("/x_daily_price/search_read")[0]?.body?.domain).includes('"x_date","=","2026-09-23"'));
  const r2 = await prefillPurchasePrices(env as any, base, "2026-09-23", [{ ...base[0], unit_price: 50, price_supplier_id: 30 }]);
  assert("edited unit_price kept on re-run", r2.items[0].unit_price === 50);
}

// ==================== 11. flag off ====================
async function testFlagOff(): Promise<void> {
  console.log("\n[11] ACCOUNTING_SYNC off → no Odoo call");
  reset();
  const r = await syncPurchaseListToAccounting({ ...env, ACCOUNTING_SYNC: "false" }, 7);
  assert("returns null", r === null);
  assert("no request", captured.length === 0);
}

async function main(): Promise<void> {
  try {
    await testUnregistered();
    await testRegisteredAfter();
    await testRegisteredBefore();
    await testIdempotency();
    await testGuardMissingTax();
    await testGuardWrongAccount();
    await testPostRefused();
    await testMissingInputs();
    await testPure();
    await testPrefill();
    await testFlagOff();
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(`\npurchase-accounting: ${passed} passed, ${failed} failed`);
  if (failed) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}
main();
