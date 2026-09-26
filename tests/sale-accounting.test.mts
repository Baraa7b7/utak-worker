// Unit tests for sale → accounting (2026-09-23).
//   1. Confirm: sale.order created from the daily order (service product,
//      sequence = x line id, no tax before the cutoff), confirmed, linked
//   2. Confirm twice / unlinked orphan: never a second sale.order
//   3. Full delivery: qty_delivered = ordered, invoice from the sale order
//      («delivered» wizard), posted with today's date, linked on x_invoice
//   4. Shortage: invoice bills the delivered lines only; the missing line
//      gets qty_delivered = 0 (stays un-invoiced on the sale order)
//   5. All lines short: no x_invoice, no account.move, sale order kept,
//      owner alerted
//   6. Idempotency: linked x_invoice → skip; a live unlinked invoice on the
//      sale order → refused; a second «delivered» tap → same x_invoice
//   7. Guards: line from another sale order / wrong total → invoice cancelled;
//      action_post refused → draft cancelled (no orphan)
//   8. VAT before / after the cutoff on the sale order and the invoice
//   9. Collection: partial → no send; completing → one send + x_invoice_sent_at;
//      a later collection → no second send; failed send releases the claim;
//      accounting not paid → no send
//  10. ACCOUNTING_SYNC off → no Odoo call
//
// Same no-framework style as tests/purchase-accounting.test.mts.

import {
  buildDeliveryLineCommands,
  buildSaleOrderLineCommands,
  dailyOrderOrigin,
  ensureSaleOrderForDailyOrder,
  evaluateSaleInvoiceLink,
  invoiceSaleOrderOnDelivery,
  saleLineDescription,
} from "../src/sale-accounting.ts";
import {
  createAndDispatchInvoiceForOrder,
  recordCollection,
} from "../src/invoice.ts";

// ---------- fetch mock ----------
interface CapturedRequest { url: string; body: any }
let captured: CapturedRequest[] = [];
let responder: (req: CapturedRequest) => any = () => true;
let graphHits = 0;
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) { graphHits++; throw new Error("BLOCKED WhatsApp in sale-accounting.test"); }
  let body: any = null;
  try { body = JSON.parse(init?.body ?? ""); } catch { body = null; }
  const req = { url, body };
  captured.push(req);
  const out = responder(req);
  if (out instanceof Response) return out;
  return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
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
function reset(): void { captured = []; responder = () => true; errors = []; }
const hits = (suffix: string) => captured.filter((c) => c.url.endsWith(suffix));
let errors: string[] = [];
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const e = console.error, w = console.warn, l = console.log;
  console.error = (...a: any[]) => { errors.push(a.map(String).join(" ")); };
  console.warn = (...a: any[]) => { errors.push(a.map(String).join(" ")); };
  console.log = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; }
}

const ACC = {
  69: { id: 69, code: "102011", account_type: "asset_receivable" },
  234: { id: 234, code: "500001", account_type: "income" },
  121: { id: 121, code: "201017", account_type: "liability_current" },
} as Record<number, { id: number; code: string; account_type: string }>;
const acc = (id: number) => [id, `${ACC[id].code} x`];
const TAX5 = { id: 5, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true };

/**
 * Stateful Odoo for one daily order. `xLines` = x_daily_order_line rows;
 * the sale order and the invoice are built from what the code writes.
 */
function mockOdoo(o: {
  orderId?: number;
  linkedSo?: number | false;
  orphans?: any[];
  xLines: Array<{ id: number; qty: number; price: number; name?: string; status?: string }>;
  soInvoiceIds?: number[];
  liveInvoices?: any[];
  postFails?: boolean;
  foreignSaleLine?: boolean;
  priceDrift?: number;
  xInvoices?: any[];
}) {
  const st = {
    soId: 0 as number,
    soLines: [] as any[],
    soState: "draft",
    invoiceIds: [...(o.soInvoiceIds ?? [])] as number[],
    move: null as any,
    linkedMove: 0,
    linkedSo: o.linkedSo || 0,
    wizard: 0,
  };
  const orderId = o.orderId ?? 77;
  const nextSoLineId = () => 900 + st.soLines.length;
  function applyCmds(cmds: any[]) {
    for (const [op, id, vals] of cmds) {
      if (op === 0) st.soLines.push({ id: nextSoLineId(), qty_delivered: 0, ...vals });
      if (op === 1) Object.assign(st.soLines.find((l) => l.id === id), vals);
    }
  }
  responder = (req) => {
    const u = req.url;
    const b = req.body ?? {};
    if (u.endsWith("/x_daily_order/read")) return [{
      id: orderId, x_customer_id: [48, "اختبار"], x_sale_order_id: st.linkedSo ? [st.linkedSo, "S1"] : false,
      x_line_ids: o.xLines.map((l) => l.id), x_delivery_neighborhood: false,
    }];
    if (u.endsWith("/x_daily_order_line/read")) return o.xLines.map((l) => ({
      id: l.id, x_product_tmpl_id: [100 + l.id, l.name ?? `صنف ${l.id}`], x_packaging_id: [7, "كرتون"],
      x_quantity: l.qty, x_unit_price: l.price, x_price_unit_manual: false, x_status: l.status ?? "pending",
    }));
    if (u.endsWith("/x_daily_order/write")) { if (b.vals?.x_sale_order_id) st.linkedSo = b.vals.x_sale_order_id; return true; }
    if (u.endsWith("/sale.order/search_read")) return o.orphans ?? [];
    if (u.endsWith("/product.product/search_read")) return [{ id: 950 }];
    if (u.endsWith("/res.company/read")) return [{ id: 1, account_sale_tax_id: [5, "15%"] }];
    if (u.endsWith("/account.tax/read")) return [TAX5];
    if (u.endsWith("/sale.order/create")) { st.soId = 301; applyCmds(b.vals_list[0].order_line); return [st.soId]; }
    if (u.endsWith("/sale.order/action_confirm")) { st.soState = "sale"; return true; }
    if (u.endsWith("/sale.order/read")) return [{
      id: st.soId || st.linkedSo, name: "S00301", state: st.soId || st.linkedSo ? (st.soState === "draft" && st.linkedSo ? "sale" : st.soState) : "draft",
      locked: false, picking_ids: [], invoice_ids: st.invoiceIds, order_line: st.soLines.map((l) => l.id),
    }];
    if (u.endsWith("/sale.order.line/read")) {
      const ids: number[] = b.ids;
      if (b.fields?.includes("order_id")) return ids.map((id) => ({ id, order_id: o.foreignSaleLine ? [999, "S999"] : [st.soId || st.linkedSo, "S"] }));
      return st.soLines.filter((l) => ids.includes(l.id)).map((l) => ({ id: l.id, sequence: l.sequence, product_uom_qty: l.product_uom_qty }));
    }
    if (u.endsWith("/sale.order/write")) { applyCmds(b.vals.order_line); return true; }
    if (u.endsWith("/sale.advance.payment.inv/create")) { st.wizard = 401; return [401]; }
    if (u.endsWith("/sale.advance.payment.inv/create_invoices")) {
      const billed = st.soLines.filter((l) => l.qty_delivered > 0);
      const taxed = billed.some((l) => l.tax_ids?.[0]?.[2]?.length);
      const gross = billed.reduce((a, l) => a + l.qty_delivered * l.price_unit, 0) + (o.priceDrift ?? 0);
      const tax = taxed ? Math.round(gross * 15 / 115 * 100) / 100 : 0;
      st.move = { id: 501, state: "draft", move_type: "out_invoice", amount_total: gross, amount_tax: tax, billed, taxed };
      st.invoiceIds.push(501);
      return { type: "ir.actions.act_window", res_model: "account.move", res_id: 501 };
    }
    if (u.endsWith("/account.move/search_read")) {
      if (o.liveInvoices) return o.liveInvoices;
      return st.move && st.move.state !== "cancel" ? [{ id: 501, state: st.move.state, move_type: "out_invoice", name: "INV/1" }] : [];
    }
    if (u.endsWith("/account.move/write")) { st.move.write = b.vals; return true; }
    if (u.endsWith("/account.move/action_post")) {
      if (o.postFails) return new Response(JSON.stringify({ name: "UserError", message: "future date" }), { status: 422 });
      st.move.state = "posted"; return true;
    }
    if (u.endsWith("/account.move/read")) return [{ id: 501, state: st.move.state, amount_total: st.move.amount_total, amount_tax: st.move.amount_tax }];
    if (u.endsWith("/account.move.line/search_read")) {
      if (b.domain?.some((d: any) => d[0] === "display_type")) {
        return st.move.billed.map((l: any, i: number) => ({ id: 700 + i, quantity: l.qty_delivered, price_unit: l.price_unit + (i === 0 ? (o.priceDrift ?? 0) : 0), display_type: "product", sale_line_ids: [l.id] }));
      }
      const net = st.move.amount_total - st.move.amount_tax;
      const rows: any[] = [
        { account_id: acc(234), debit: 0, credit: net, display_type: "product", tax_line_id: false },
        { account_id: acc(69), debit: st.move.amount_total, credit: 0, display_type: "payment_term", tax_line_id: false },
      ];
      if (st.move.amount_tax) rows.push({ account_id: acc(121), debit: 0, credit: st.move.amount_tax, display_type: "tax", tax_line_id: [5, "15%"] });
      return rows;
    }
    if (u.endsWith("/account.account/read")) return (b.ids as number[]).map((id) => ACC[id]);
    if (u.endsWith("/account.move/button_draft")) { st.move.state = "draft"; return true; }
    if (u.endsWith("/account.move/button_cancel")) { st.move.state = "cancel"; return true; }
    if (u.endsWith("/sale.order/action_cancel")) { st.soState = "cancel"; return true; }
    if (u.endsWith("/x_invoice/write")) { if (b.vals?.x_account_move_id) st.linkedMove = b.vals.x_account_move_id; return true; }
    if (u.endsWith("/x_invoice/search_read")) return o.xInvoices ?? [];
    if (u.endsWith("/res.partner/read")) return [{ id: 48, name: "اختبار", phone: false, x_whatsapp_number: false }];
    return true;
  };
  return st;
}

const delivered = (lines: Array<{ id: number; qty: number; price: number }>) =>
  lines.map((l) => ({ lineId: l.id, description: saleLineDescription(`صنف ${l.id}`, "كرتون"), quantity: l.qty, priceUnit: l.price }));

// ---------- pure ----------
console.log("\n[pure] builders + link guard");
{
  const cmds = buildSaleOrderLineCommands(delivered([{ id: 11, qty: 2, price: 20 }, { id: 12, qty: 0, price: 5 }]), 950, []);
  assert("zero-qty line dropped", cmds.length === 1);
  assert("line: service product, sequence = x line id, tax pinned empty",
    cmds[0][2].product_id === 950 && cmds[0][2].sequence === 11 && JSON.stringify(cmds[0][2].tax_ids) === "[[6,0,[]]]");
  assert("origin key", dailyOrderOrigin(77) === "x_daily_order/77");
  const d = buildDeliveryLineCommands(
    [{ id: 900, sequence: 11, product_uom_qty: 2 }, { id: 901, sequence: 12, product_uom_qty: 1 }],
    delivered([{ id: 11, qty: 2, price: 20 }]), 950, [5],
  );
  assert("delivered line → qty_delivered + price + tax", d[0][0] === 1 && d[0][1] === 900 && d[0][2].qty_delivered === 2 && JSON.stringify(d[0][2].tax_ids) === "[[6,0,[5]]]");
  assert("ordered qty untouched when delivered ≤ ordered", !("product_uom_qty" in d[0][2]));
  assert("shortage line → qty_delivered 0, ordered kept", d[1][0] === 1 && d[1][1] === 901 && d[1][2].qty_delivered === 0 && !("product_uom_qty" in d[1][2]));
  const add = buildDeliveryLineCommands([], delivered([{ id: 13, qty: 3, price: 4 }]), 950, []);
  assert("delivered line missing on SO → added with qty_delivered", add[0][0] === 0 && add[0][2].sequence === 13 && add[0][2].qty_delivered === 3);

  const ok = evaluateSaleInvoiceLink({ saleOrderId: 301, lines: [{ quantity: 2, price_unit: 20, sale_order_ids: [301] }, { quantity: 1, price_unit: 20, sale_order_ids: [301] }], delivered: [{ quantity: 1, priceUnit: 20 }, { quantity: 2, priceUnit: 20 }], expectedTotal: 60 });
  assert("link guard ok (order-independent)", ok.ok, ok.reasons.join("; "));
  const foreign = evaluateSaleInvoiceLink({ saleOrderId: 301, lines: [{ quantity: 2, price_unit: 20, sale_order_ids: [999] }], delivered: [{ quantity: 2, priceUnit: 20 }], expectedTotal: 40 });
  assert("link guard: line of another sale order refused", !foreign.ok);
  const unlinked = evaluateSaleInvoiceLink({ saleOrderId: 301, lines: [{ quantity: 2, price_unit: 20, sale_order_ids: [] }], delivered: [{ quantity: 2, priceUnit: 20 }], expectedTotal: 40 });
  assert("link guard: line not from a sale order refused", !unlinked.ok);
  const qty = evaluateSaleInvoiceLink({ saleOrderId: 301, lines: [{ quantity: 3, price_unit: 20, sale_order_ids: [301] }], delivered: [{ quantity: 2, priceUnit: 20 }], expectedTotal: 40 });
  assert("link guard: ordered qty billed instead of delivered refused", !qty.ok);
}

// ---------- 1/2 confirm ----------
console.log("\n[1] confirm → sale.order");
{
  reset();
  const st = mockOdoo({ xLines: [{ id: 11, qty: 2, price: 20 }, { id: 12, qty: 1, price: 20 }] });
  const r = await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-09-23" }));
  assert("sale.order created + linked", r?.saleOrderId === 301 && r.created && st.linkedSo === 301);
  const create = hits("/sale.order/create")[0]?.body?.vals_list?.[0];
  assert("origin + partner", create?.origin === "x_daily_order/77" && create?.partner_id === 48);
  assert("two lines, sequences 11/12, no tax before cutoff",
    create?.order_line?.length === 2 && create.order_line[0][2].sequence === 11 &&
    create.order_line.every((c: any) => JSON.stringify(c[2].tax_ids) === "[[6,0,[]]]"));
  assert("no tax lookup before cutoff", hits("/res.company/read").length === 0);
  assert("action_confirm called", hits("/sale.order/action_confirm").length === 1);

  reset();
  mockOdoo({ linkedSo: 301, xLines: [{ id: 11, qty: 2, price: 20 }] });
  const again = await quiet(() => ensureSaleOrderForDailyOrder(env, 77));
  assert("[2] confirm twice → same sale.order, no create", again?.saleOrderId === 301 && !again.created && hits("/sale.order/create").length === 0);

  reset();
  const st3 = mockOdoo({ orphans: [{ id: 305, name: "S00305", state: "sale" }], xLines: [{ id: 11, qty: 2, price: 20 }] });
  const adopt = await quiet(() => ensureSaleOrderForDailyOrder(env, 77));
  assert("[2] unlinked orphan adopted, no second create", adopt?.saleOrderId === 305 && st3.linkedSo === 305 && hits("/sale.order/create").length === 0);

  reset();
  mockOdoo({ xLines: [{ id: 11, qty: 2, price: 20 }] });
  const vat = await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-10-05" }));
  const vatCreate = hits("/sale.order/create")[0]?.body?.vals_list?.[0];
  assert("[8] confirm after cutoff → company sale tax 5 on lines", vat?.created === true && JSON.stringify(vatCreate?.order_line?.[0]?.[2]?.tax_ids) === "[[6,0,[5]]]");
}

// ---------- 3 full delivery ----------
console.log("\n[3] full delivery → invoice from the sale order");
{
  reset();
  const lines = [{ id: 11, qty: 2, price: 20 }, { id: 12, qty: 1, price: 20 }];
  const st = mockOdoo({ xLines: lines });
  await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-09-23" }));
  const r = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 61, existingMoveId: null, invoiceNumber: "UTAK-INV-T-001", orderId: 77, delivered: delivered(lines), expectedTotal: 60,
  }, { date: "2026-09-23" }));
  assert("linked x_invoice → move 501 from sale.order 301", r?.moveId === 501 && r.saleOrderId === 301 && st.linkedMove === 501, errors.join(" | "));
  assert("wizard = delivered on this sale order", hits("/sale.advance.payment.inv/create")[0]?.body?.vals_list?.[0]?.advance_payment_method === "delivered");
  assert("qty_delivered = ordered on every line", st.soLines.every((l) => l.qty_delivered === l.product_uom_qty));
  assert("invoice_date = delivery date, ref = x_invoice number", st.move.write?.invoice_date === "2026-09-23" && st.move.write?.ref === "UTAK-INV-T-001");
  assert("posted", st.move.state === "posted");
  assert("no standalone account.move/create", hits("/account.move/create").length === 0);
}

// ---------- 4 shortage ----------
console.log("\n[4] shortage → invoice bills delivered only");
{
  reset();
  const ordered = [{ id: 11, qty: 2, price: 20 }, { id: 12, qty: 1, price: 20 }];
  const st = mockOdoo({ xLines: ordered });
  await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-09-23" }));
  const r = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 62, existingMoveId: null, invoiceNumber: "UTAK-INV-T-002", orderId: 77, delivered: delivered([ordered[0]]), expectedTotal: 40,
  }, { date: "2026-09-23" }));
  assert("linked", r?.moveId === 501, errors.join(" | "));
  assert("invoice total 40", st.move.amount_total === 40);
  const short = st.soLines.find((l) => l.sequence === 12);
  assert("short line: ordered 1 kept, delivered 0 (20 un-invoiced)", short?.product_uom_qty === 1 && short?.qty_delivered === 0);
}

// ---------- 5 all short ----------
console.log("\n[5] every line short → no invoice, sale order kept, owner alerted");
{
  reset();
  const st = mockOdoo({ linkedSo: 301, xLines: [{ id: 11, qty: 2, price: 20, status: "unavailable" }, { id: 12, qty: 1, price: 20, status: "unavailable" }] });
  const r = await quiet(() => createAndDispatchInvoiceForOrder(env, 77));
  assert("no invoice returned", r === null);
  assert("no x_invoice created", hits("/x_invoice/create").length === 0);
  assert("no account.move / wizard", hits("/sale.advance.payment.inv/create").length === 0 && hits("/account.move/create").length === 0);
  assert("sale order not cancelled", hits("/sale.order/action_cancel").length === 0 && st.linkedSo === 301);
  assert("owner alert raised", errors.some((e) => e.includes("كل الأصناف ناقصة")));

  reset();
  mockOdoo({ linkedSo: 301, xLines: [{ id: 11, qty: 2, price: 20 }] });
  const none = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 63, existingMoveId: null, invoiceNumber: "X", orderId: 77, delivered: [], expectedTotal: 0,
  }));
  assert("invoiceSaleOrderOnDelivery with nothing delivered → null, no wizard", none === null && hits("/sale.advance.payment.inv/create").length === 0);
}

// ---------- 6 idempotency ----------
console.log("\n[6] idempotency");
{
  reset();
  mockOdoo({ linkedSo: 301, xLines: [{ id: 11, qty: 2, price: 20 }] });
  const r = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 61, existingMoveId: 501, invoiceNumber: "X", orderId: 77, delivered: delivered([{ id: 11, qty: 2, price: 20 }]), expectedTotal: 40,
  }));
  assert("linked x_invoice → skipped, no wizard", r?.skipped === true && r.moveId === 501 && hits("/sale.advance.payment.inv/create").length === 0);

  reset();
  mockOdoo({ linkedSo: 301, soInvoiceIds: [501], liveInvoices: [{ id: 501, name: "INV/1", state: "posted" }], xLines: [{ id: 11, qty: 2, price: 20 }] });
  const dup = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 64, existingMoveId: null, invoiceNumber: "X", orderId: 77, delivered: delivered([{ id: 11, qty: 2, price: 20 }]), expectedTotal: 40,
  }));
  assert("live unlinked invoice on the sale order → refused, no second", dup === null && hits("/sale.advance.payment.inv/create").length === 0);
  assert("…and it is NOT cancelled", hits("/account.move/button_cancel").length === 0);

  reset();
  mockOdoo({ linkedSo: 301, xLines: [{ id: 11, qty: 2, price: 20 }], xInvoices: [{ id: 61, x_invoice_number: "UTAK-INV-T-001", x_total: 40 }] });
  const tap2 = await quiet(() => createAndDispatchInvoiceForOrder(env, 77));
  assert("second «delivered» tap → same x_invoice, nothing created", tap2?.invoiceId === 61 && hits("/x_invoice/create").length === 0 && hits("/sale.advance.payment.inv/create").length === 0);
}

// ---------- 7 guards ----------
console.log("\n[7] guards");
{
  reset();
  const st = mockOdoo({ xLines: [{ id: 11, qty: 2, price: 20 }], foreignSaleLine: true });
  await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-09-23" }));
  const r = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 65, existingMoveId: null, invoiceNumber: "X", orderId: 77, delivered: delivered([{ id: 11, qty: 2, price: 20 }]), expectedTotal: 40,
  }, { date: "2026-09-23" }));
  assert("line of another sale order → null, invoice cancelled, not linked", r === null && st.move.state === "cancel" && !st.linkedMove);

  reset();
  const st2 = mockOdoo({ xLines: [{ id: 11, qty: 2, price: 20 }], priceDrift: 5 });
  await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-09-23" }));
  const r2 = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 66, existingMoveId: null, invoiceNumber: "X", orderId: 77, delivered: delivered([{ id: 11, qty: 2, price: 20 }]), expectedTotal: 40,
  }, { date: "2026-09-23" }));
  assert("total ≠ delivered × price → cancelled, not linked", r2 === null && st2.move.state === "cancel" && !st2.linkedMove);

  reset();
  const st3 = mockOdoo({ xLines: [{ id: 11, qty: 2, price: 20 }], postFails: true });
  await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-09-23" }));
  const r3 = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 67, existingMoveId: null, invoiceNumber: "X", orderId: 77, delivered: delivered([{ id: 11, qty: 2, price: 20 }]), expectedTotal: 40,
  }, { date: "2026-09-23" }));
  assert("action_post refused → draft cancelled (no orphan), not linked", r3 === null && st3.move.state === "cancel" && !st3.linkedMove);
  assert("owner alert on refusal", errors.some((e) => e.includes("رفض Odoo ترحيل الفاتورة")));
}

// ---------- 8 VAT ----------
console.log("\n[8] VAT before / after the cutoff");
{
  reset();
  const st = mockOdoo({ xLines: [{ id: 11, qty: 1, price: 115 }] });
  await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-09-30" }));
  const r = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 68, existingMoveId: null, invoiceNumber: "X", orderId: 77, delivered: delivered([{ id: 11, qty: 1, price: 115 }]), expectedTotal: 115,
  }, { date: "2026-10-05" }));
  assert("delivered after cutoff: SO lines re-pinned to tax 5", JSON.stringify(st.soLines[0].tax_ids) === "[[6,0,[5]]]");
  assert("invoice 115 = 100 + 15, guard ok, linked", r?.moveId === 501 && st.move.amount_tax === 15, errors.join(" | "));

  reset();
  const st2 = mockOdoo({ xLines: [{ id: 11, qty: 1, price: 50 }] });
  await quiet(() => ensureSaleOrderForDailyOrder(env, 77, { date: "2026-09-30" }));
  const r2 = await quiet(() => invoiceSaleOrderOnDelivery(env, {
    invoiceId: 69, existingMoveId: null, invoiceNumber: "X", orderId: 77, delivered: delivered([{ id: 11, qty: 1, price: 50 }]), expectedTotal: 50,
  }, { date: "2026-09-30" }));
  assert("delivered before cutoff: no tax, linked", r2?.moveId === 501 && st2.move.amount_tax === 0 && JSON.stringify(st2.soLines[0].tax_ids) === "[[6,0,[]]]");
}

// ---------- 9 collection (§ 41 ج: the invoice went out at «تم التسليم», collection sends none) ----------
console.log("\n[9] collection → payments on the invoice, no invoice send (it went at delivery, § 41 ج)");
{
  const inv: any = { id: 61, x_invoice_number: "UTAK-INV-T-001", x_total: 60, x_subtotal: 60, x_tax_amount: 0, x_invoice_date: "2026-09-23", x_status: "issued", x_order_id: [77, "O"], x_invoice_sent_at: "2026-09-23 06:00:00", x_account_move_id: false };
  const payments: any[] = [];
  reset();
  responder = (req) => {
    const u = req.url; const b = req.body ?? {};
    if (u.endsWith("/x_invoice/read")) return [{ ...inv }];
    if (u.endsWith("/x_invoice/write")) { Object.assign(inv, b.vals); return true; }
    if (u.endsWith("/x_payment/search_read")) return payments.map((p) => ({ ...p }));
    if (u.endsWith("/x_payment/create")) { const id = 800 + payments.length; payments.push({ id, x_amount: b.vals_list[0].x_amount }); return [id]; }
    if (u.endsWith("/x_daily_order/write")) return true;
    if (u.endsWith("/x_daily_order/read")) return [{ id: 77, x_customer_id: [48, "اختبار"] }];
    if (u.endsWith("/res.partner/read")) return [{ id: 48, phone: false, x_whatsapp_number: false }];
    return true;
  };
  const p1 = await quiet(() => recordCollection(env, { invoiceId: 61, method: "cash", amount: 30 }));
  assert("partial 30/60: not fully paid, still issued", !p1.fullyPaid && inv.x_status === "issued" && p1.paymentId === 800);
  assert("partial: order not closed", !captured.some((c) => c.url.endsWith("/x_daily_order/write")));
  const p2 = await quiet(() => recordCollection(env, { invoiceId: 61, method: "cash" }));
  assert("second collection = remaining 30, paid", payments[1]?.x_amount === 30 && p2.fullyPaid && inv.x_status === "paid");
  const p3 = await quiet(() => recordCollection(env, { invoiceId: 61, method: "cash", amount: 10 }));
  assert("extra collection after paid: no payment", p3.paymentId === null && payments.length === 2);
  assert("x_invoice_sent_at untouched by the collections (set at delivery)", inv.x_invoice_sent_at === "2026-09-23 06:00:00");
  assert("no outcome «send» on a collection any more", !("send" in p1) && !("send" in p2));
  assert("no request reached graph.facebook.com", graphHits === 0, `graphHits=${graphHits}`);
}

// ---------- 10 flag off ----------
console.log("\n[10] ACCOUNTING_SYNC off");
{
  reset();
  const off = { ...env, ACCOUNTING_SYNC: "false" };
  const a = await quiet(() => ensureSaleOrderForDailyOrder(off, 77));
  const b = await quiet(() => invoiceSaleOrderOnDelivery(off, { invoiceId: 1, existingMoveId: null, invoiceNumber: "X", orderId: 77, delivered: delivered([{ id: 11, qty: 1, price: 1 }]), expectedTotal: 1 }));
  assert("no Odoo call, null", a === null && b === null && captured.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.map((f) => ` - ${f}`).join("\n")); process.exit(1); }
