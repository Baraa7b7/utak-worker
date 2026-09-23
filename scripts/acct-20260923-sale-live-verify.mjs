// UTAK — live verification of sale order → invoice → collection, 2026-09-23.
// Runs the REAL Worker code (src/sale-accounting.ts + src/invoice.ts) against
// the shared Odoo tenant and measures deltas on the GLOBAL posted ledger, so
// any unexpected account fails.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/acct-20260923-sale-live-verify.mjs
//
// Safety:
//   • NO WhatsApp: any request to graph.facebook.com throws (and is counted);
//     env has no OWNER_WHATSAPP (sendOwnerAlert returns before sending); the
//     collector lookup (res.partner by role collector) is answered [] so the
//     issue path never even addresses a real collector; the customer is the
//     test partner 48 «اختبار محاسبة» (no WhatsApp number). The invoice send
//     of cycle ل goes through an injected counting sender.
//   • Every date = today (Riyadh): l10n_sa refuses future-dated moves.
//   • Default = reverse everything (payments cancelled, invoices credited +
//     reconciled), prove the ledger is back to baseline, cancel (or lock) the
//     test sale orders, delete the test x_* rows (no `active` field; left in
//     place they would reach the 18:00 collection summary and the 21:15
//     purchase list), archive partner 48.
//
//   Cycle ط: 2 lines = 60, nothing short → 102011 +60 · 500001 −60, SO fully invoiced
//   Cycle ي: 60 ordered, line of 20 short → 102011 +40 · 500001 −40, 20 un-invoiced on the SO
//   Cycle ك: confirm ×2 + deliver ×2 (+ a direct second invoice call)
//            → one sale.order, one x_invoice, one invoice; 102011 +30 · 500001 −30
//   Cycle ل: on ط's invoice collect 30 then 30 (cash) then try 10
//            → no send, ONE send, nothing; x_invoice_sent_at set once;
//              101007 +60 · 102011 −60
//   All:     stock.picking and stock.quant counts unchanged, SO picking_ids empty
//
// Exit code 1 on ANY mismatch.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { ensureSaleOrderForDailyOrder, invoiceSaleOrderOnDelivery, dailyOrderOrigin } from "../src/sale-accounting.ts";
import { createAndDispatchInvoiceForOrder, recordCollection } from "../src/invoice.ts";
import { todayRiyadhYmd } from "../src/accounting.ts";
import { call as workerCall } from "../src/odoo.ts";

// ---- hard block on any Meta traffic + keep real collectors out ----
let graphHits = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) { graphHits++; throw new Error(`BLOCKED WhatsApp request in sale live-verify: ${url}`); }
  if (url.endsWith("/res.partner/search_read") && String(init?.body ?? "").includes("x_role_ids.x_code")) {
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  // Odoo.com rate limit: the first run (2026-09-23) was cut in cycle ك by
  // HTTP 429 inside the Worker code itself (which does not retry). Back off
  // transparently here so the cycles measure logic, not the rate limit.
  for (let attempt = 0; ; attempt++) {
    const res = await realFetch(input, init);
    if (res.status !== 429 || attempt >= 6 || !url.includes("/json/2/")) return res;
    const wait = 3000 * 2 ** Math.min(attempt, 4);
    console.log(`  … Odoo 429 (${url.split("/json/2/")[1]}), back off ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
};

const readEnvFile = (rel) => {
  const u = new URL(rel, import.meta.url);
  if (!existsSync(u)) return {};
  return Object.fromEntries(
    readFileSync(u, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
};
const fileEnv = readEnvFile("../.env.sim-verify");
const r2 = new Map();
const env = {
  ODOO_URL: fileEnv.ODOO_URL,
  ODOO_DB: fileEnv.ODOO_DB,
  ODOO_LOGIN: fileEnv.ODOO_LOGIN,
  ODOO_API_KEY: fileEnv.ODOO_API_KEY,
  ACCOUNTING_SYNC: "true",
  WORKER_ORIGIN: "https://sim-verify.invalid",
  INVOICES_BUCKET: {
    async put(k, v) { r2.set(k, v); },
    async head(k) { return r2.has(k) ? {} : null; },
  },
};
async function call(model, method, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await workerCall(env, model, method, body);
    } catch (e) {
      if (e?.status === 429 && attempt < 8) {
        const wait = 2000 * 2 ** Math.min(attempt, 4);
        console.log(`  … 429 on ${model}.${method}, retry in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

const TODAY = todayRiyadhYmd();
const CUSTOMER = 48;
const report = {
  started_at: new Date().toISOString(), riyadh_today: TODAY, cycles: {},
  created: { orders: [], lines: [], x_invoices: [], x_payments: [], sale_orders: [], invoices: [], payments: [], credit_notes: [] },
};
let failures = 0;
const accErrors = [];
const origError = console.error;
console.error = (...a) => { const s = a.map(String).join(" "); if (s.includes("accounting]") || s.includes("[invoice")) accErrors.push(s); origError(...a); };

function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
  return cond;
}

async function globalBalances() {
  const lines = await call("account.move.line", "search_read", {
    domain: [["parent_state", "=", "posted"]], fields: ["account_id", "debit", "credit"], limit: 10000,
  });
  const out = {};
  for (const l of lines) {
    if (!l.account_id) continue;
    const code = String(l.account_id[1]).split(" ")[0];
    out[code] = Math.round(((out[code] ?? 0) + (l.debit ?? 0) - (l.credit ?? 0)) * 100) / 100;
  }
  return out;
}
function delta(before, after) {
  const d = {};
  for (const c of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const v = Math.round(((after[c] ?? 0) - (before[c] ?? 0)) * 100) / 100;
    if (Math.abs(v) >= 0.005) d[c] = v;
  }
  return d;
}
function expectDelta(label, actual, expected) {
  console.log(`\n  ${label}`);
  console.log("    code      expected    actual");
  let ok = true;
  for (const c of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    const e = expected[c] ?? 0, a = actual[c] ?? 0, good = Math.abs(e - a) < 0.005;
    if (!good) ok = false;
    console.log(`    ${c.padEnd(8)} ${String(e).padStart(9)} ${String(a).padStart(9)}  ${good ? "✓" : "✗"}${expected[c] === undefined ? "  ← unexpected account" : ""}`);
  }
  check(`${label}: every account matches, no extra account`, ok);
  return ok;
}
async function stockCounts() {
  return {
    picking: await call("stock.picking", "search_count", { domain: [] }),
    quant: await call("stock.quant", "search_count", { domain: [] }),
  };
}

async function pickProducts() {
  const rows = await call("x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "!=", false]], fields: ["id", "x_product_tmpl_id"], order: "id", limit: 50,
  });
  const seen = new Set(); const out = [];
  for (const r of rows) {
    if (seen.has(r.x_product_tmpl_id[0])) continue;
    seen.add(r.x_product_tmpl_id[0]);
    out.push({ product: r.x_product_tmpl_id[0], packaging: r.id });
    if (out.length === 2) break;
  }
  if (out.length < 2) throw new Error("need two products with packaging");
  return out;
}

async function makeOrder(tag, lines) {
  const [id] = await call("x_daily_order", "create", {
    vals_list: [{
      x_customer_id: CUSTOMER, x_order_date: TODAY, x_state: "confirmed", x_created_via: "manual",
      x_is_simulation: true, x_delivery_notes: `acct-20260923-sale-live-verify ${tag} — اختبار، يُحذف آلياً`,
    }],
  });
  report.created.orders.push(id);
  const lineIds = await call("x_daily_order_line", "create", {
    vals_list: lines.map((l) => ({
      x_order_id: id, x_product_tmpl_id: l.product, x_packaging_id: l.packaging, x_quantity: l.qty,
      x_unit_price: l.price, x_status: "pending", x_is_simulation: true,
    })),
  });
  report.created.lines.push(...lineIds);
  return { id, lineIds };
}

async function soFacts(soId) {
  const [so] = await call("sale.order", "read", {
    ids: [soId], fields: ["id", "name", "state", "picking_ids", "invoice_ids", "amount_total", "invoice_status", "order_line"],
  });
  const lines = await call("sale.order.line", "read", {
    ids: so.order_line, fields: ["id", "sequence", "product_uom_qty", "qty_delivered", "qty_invoiced", "price_unit", "price_total"],
  });
  const invoices = so.invoice_ids.length
    ? await call("account.move", "search_read", { domain: [["id", "in", so.invoice_ids], ["state", "!=", "cancel"]], fields: ["id", "name", "state", "amount_total", "payment_state", "move_type"] })
    : [];
  const invoiced = Math.round(lines.reduce((a, l) => a + l.qty_invoiced * l.price_unit, 0) * 100) / 100;
  return { so, lines, invoices, invoiced, uninvoiced: Math.round((so.amount_total - invoiced) * 100) / 100 };
}
async function xInvoiceOf(orderId) {
  return call("x_invoice", "search_read", {
    domain: [["x_order_id", "=", orderId]],
    fields: ["id", "x_invoice_number", "x_total", "x_status", "x_account_move_id", "x_invoice_sent_at", "x_sent_to_customer_at"],
  });
}
async function track(orderId) {
  const [o] = await call("x_daily_order", "read", { ids: [orderId], fields: ["x_sale_order_id"] });
  const soId = o?.x_sale_order_id ? o.x_sale_order_id[0] : null;
  if (soId && !report.created.sale_orders.includes(soId)) report.created.sale_orders.push(soId);
  for (const x of await xInvoiceOf(orderId)) {
    if (!report.created.x_invoices.includes(x.id)) report.created.x_invoices.push(x.id);
    const m = x.x_account_move_id ? x.x_account_move_id[0] : null;
    if (m && !report.created.invoices.includes(m)) report.created.invoices.push(m);
  }
  return soId;
}

// ---------------------------------------------------------------- cycles
async function cycleT(p, baseline) {
  console.log("\n=== Cycle ط: 60, nothing short ===");
  const before = await globalBalances();
  const { id } = await makeOrder("ط", [
    { ...p[0], qty: 2, price: 20 },
    { ...p[1], qty: 1, price: 20 },
  ]);
  const ens = await ensureSaleOrderForDailyOrder(env, id);
  check("sale.order created on confirm", !!ens?.created, JSON.stringify(ens));
  const inv = await createAndDispatchInvoiceForOrder(env, id);
  const soId = await track(id);
  const f = await soFacts(soId);
  const [x] = await xInvoiceOf(id);
  check("x_invoice total 60", inv?.total === 60 && x?.x_total === 60, JSON.stringify(inv));
  check("x_invoice linked to the SO invoice", x?.x_account_move_id && f.invoices.length === 1 && x.x_account_move_id[0] === f.invoices[0].id);
  check("SO confirmed, no picking", f.so.state === "sale" && f.so.picking_ids.length === 0);
  check("SO fully invoiced (60 of 60)", f.invoiced === 60 && f.uninvoiced === 0 && f.so.invoice_status === "invoiced", `invoiced=${f.invoiced} status=${f.so.invoice_status}`);
  check("customer NOT sent at issue (deferred)", !x.x_invoice_sent_at && !x.x_sent_to_customer_at);
  const d = delta(before, await globalBalances());
  expectDelta("ط balance", d, { "102011": 60, "500001": -60 });
  report.cycles["ط"] = { order: id, sale_order: soId, x_invoice: x.id, invoice: f.invoices[0], so_lines: f.lines, delta: d };
  return { orderId: id, xInvoiceId: x.id, moveId: f.invoices[0]?.id };
}

async function cycleY(p) {
  console.log("\n=== Cycle ي: 60 ordered, 40 delivered ===");
  const before = await globalBalances();
  const { id, lineIds } = await makeOrder("ي", [
    { ...p[0], qty: 2, price: 20 },
    { ...p[1], qty: 1, price: 20 },
  ]);
  await ensureSaleOrderForDailyOrder(env, id);
  await call("x_daily_order_line", "write", { ids: [lineIds[1]], vals: { x_status: "unavailable" } });
  const inv = await createAndDispatchInvoiceForOrder(env, id);
  const soId = await track(id);
  const f = await soFacts(soId);
  const [x] = await xInvoiceOf(id);
  check("x_invoice total 40", inv?.total === 40 && x?.x_total === 40);
  check("invoice 40 linked", f.invoices.length === 1 && f.invoices[0].amount_total === 40 && x.x_account_move_id?.[0] === f.invoices[0].id);
  check("SO keeps ordered 60", f.so.amount_total === 60);
  const shortLine = f.lines.find((l) => l.sequence === lineIds[1]);
  check("short line: ordered 1, delivered 0, invoiced 0", shortLine?.product_uom_qty === 1 && shortLine.qty_delivered === 0 && shortLine.qty_invoiced === 0);
  check("20 un-invoiced on the SO", f.uninvoiced === 20, `uninvoiced=${f.uninvoiced}`);
  const d = delta(before, await globalBalances());
  expectDelta("ي balance", d, { "102011": 40, "500001": -40 });
  report.cycles["ي"] = { order: id, sale_order: soId, x_invoice: x.id, invoice: f.invoices[0], so_lines: f.lines, uninvoiced: f.uninvoiced, delta: d };
}

async function cycleK(p) {
  console.log("\n=== Cycle ك: confirm ×2 + deliver ×2 ===");
  const before = await globalBalances();
  const { id, lineIds } = await makeOrder("ك", [{ ...p[0], qty: 1, price: 30 }]);
  const a = await ensureSaleOrderForDailyOrder(env, id);
  await track(id);
  const b = await ensureSaleOrderForDailyOrder(env, id);
  check("confirm twice → same sale.order", a?.saleOrderId && a.saleOrderId === b?.saleOrderId && a.created && !b.created);
  const i1 = await createAndDispatchInvoiceForOrder(env, id);
  await track(id);
  const i2 = await createAndDispatchInvoiceForOrder(env, id);
  check("deliver twice → same x_invoice", i1?.invoiceId && i1.invoiceId === i2?.invoiceId);
  // A direct second call with no link on hand (as after a crash): refused.
  const again = await invoiceSaleOrderOnDelivery(env, {
    invoiceId: i1.invoiceId, existingMoveId: null, invoiceNumber: i1.number, orderId: id,
    delivered: [{ lineId: lineIds[0], description: "x", quantity: 1, priceUnit: 30 }], expectedTotal: 30,
  });
  check("direct second invoice call → refused (null)", again === null);
  const soId = await track(id);
  const sos = await call("sale.order", "search_read", { domain: [["origin", "=", dailyOrderOrigin(id)]], fields: ["id"] });
  const f = await soFacts(soId);
  const xs = await xInvoiceOf(id);
  check("exactly one sale.order", sos.length === 1, JSON.stringify(sos));
  check("exactly one x_invoice", xs.length === 1);
  check("exactly one live invoice on the SO", f.invoices.length === 1);
  const d = delta(before, await globalBalances());
  expectDelta("ك balance", d, { "102011": 30, "500001": -30 });
  report.cycles["ك"] = { order: id, sale_order: soId, sale_orders_by_origin: sos.length, x_invoices: xs.length, invoices: f.invoices, delta: d };
}

async function cycleL(t) {
  console.log("\n=== Cycle ل: collect 30 + 30 (+10) on ط ===");
  const sends = [];
  const deps = { send: async (_e, invoiceId) => { sends.push({ invoiceId, at: new Date().toISOString() }); } };
  const before = await globalBalances();
  const p1 = await recordCollection(env, { invoiceId: t.xInvoiceId, method: "cash", amount: 30 }, deps);
  const [x1] = await call("x_invoice", "read", { ids: [t.xInvoiceId], fields: ["x_status", "x_invoice_sent_at"] });
  const [m1] = await call("account.move", "read", { ids: [t.moveId], fields: ["payment_state", "amount_residual"] });
  check("after 30: partial, no send", !p1.fullyPaid && sends.length === 0 && !x1.x_invoice_sent_at && x1.x_status === "issued", `${m1.payment_state} residual=${m1.amount_residual}`);
  check("after 30: invoice partial in accounting", m1.payment_state === "partial" && m1.amount_residual === 30);
  const p2 = await recordCollection(env, { invoiceId: t.xInvoiceId, method: "cash" }, deps);
  const [x2] = await call("x_invoice", "read", { ids: [t.xInvoiceId], fields: ["x_status", "x_invoice_sent_at"] });
  const [m2] = await call("account.move", "read", { ids: [t.moveId], fields: ["payment_state", "amount_residual"] });
  check("after 60: paid, ONE send, x_invoice_sent_at set", p2.fullyPaid && p2.send === "sent" && sends.length === 1 && !!x2.x_invoice_sent_at && x2.x_status === "paid", `send=${p2.send}`);
  check("after 60: invoice paid in accounting", m2.payment_state === "paid" && m2.amount_residual === 0, m2.payment_state);
  const p3 = await recordCollection(env, { invoiceId: t.xInvoiceId, method: "cash", amount: 10 }, deps);
  const [x3] = await call("x_invoice", "read", { ids: [t.xInvoiceId], fields: ["x_invoice_sent_at"] });
  check("extra 10: refused (already paid), no second send, sent_at unchanged", p3.paymentId === null && sends.length === 1 && x3.x_invoice_sent_at === x2.x_invoice_sent_at);
  const xp = await call("x_payment", "search_read", { domain: [["x_invoice_id", "=", t.xInvoiceId]], fields: ["id", "x_amount", "x_account_payment_id"] });
  report.created.x_payments.push(...xp.map((p) => p.id));
  report.created.payments.push(...xp.map((p) => p.x_account_payment_id?.[0]).filter(Boolean));
  check("two x_payment (30 + 30), both twinned", xp.length === 2 && xp.every((p) => p.x_amount === 30 && p.x_account_payment_id));
  const d = delta(before, await globalBalances());
  expectDelta("ل balance", d, { "101007": 60, "102011": -60 });
  report.cycles["ل"] = { x_invoice: t.xInvoiceId, sends, sent_at: x2.x_invoice_sent_at, payments: xp, delta: d, outcomes: [p1.text, p2.text, p3.text] };
}

// ---------------------------------------------------------------- reversal + cleanup
async function reverseAll() {
  console.log("\n=== Reverse everything ===");
  for (const pid of report.created.payments) {
    const [cur] = await call("account.payment", "read", { ids: [pid], fields: ["state"] });
    if (cur?.state === "canceled") continue;
    try { await call("account.payment", "action_draft", { ids: [pid] }); } catch (e) { console.log(`  payment ${pid} action_draft: ${e.message.slice(0, 120)}`); }
    try { await call("account.payment", "action_cancel", { ids: [pid] }); } catch (e) { console.log(`  payment ${pid} action_cancel: ${e.message.slice(0, 120)}`); }
    const [p] = await call("account.payment", "read", { ids: [pid], fields: ["state"] });
    check(`payment ${pid} cancelled`, p.state === "canceled", p.state);
  }
  for (const moveId of report.created.invoices) {
    const [src] = await call("account.move", "read", { ids: [moveId], fields: ["journal_id", "payment_state", "state", "ref"] });
    if (src.payment_state === "reversed" || src.state === "cancel") continue;
    const ctx = { active_model: "account.move", active_ids: [moveId], active_id: moveId };
    const [revId] = await call("account.move.reversal", "create", {
      vals_list: [{ journal_id: src.journal_id[0], reason: "acct-20260923 sale live-verify reversal", date: TODAY }],
      context: ctx,
    });
    const res = await call("account.move.reversal", "reverse_moves", { ids: [revId], context: ctx });
    const creditId = res?.res_id;
    if (!creditId) throw new Error(`reverse_moves returned no res_id for move ${moveId}`);
    const [cn] = await call("account.move", "read", { ids: [creditId], fields: ["state"] });
    if (cn.state === "draft") await call("account.move", "action_post", { ids: [creditId] });
    const ar = await call("account.move.line", "search_read", {
      domain: [["move_id", "in", [moveId, creditId]], ["account_id.account_type", "=", "asset_receivable"], ["reconciled", "=", false]],
      fields: ["id"],
    });
    if (ar.length >= 2) await call("account.move.line", "reconcile", { ids: ar.map((l) => l.id) });
    // The x_invoice numbers are freed below; tag the refs so a later real
    // invoice reusing a number is never confused with this test.
    await call("account.move", "write", { ids: [moveId, creditId], vals: { ref: `SIM-TEST ${src.ref ?? ""}`.trim() } });
    report.created.credit_notes.push(creditId);
    const [i] = await call("account.move", "read", { ids: [moveId], fields: ["payment_state"] });
    console.log(`  invoice ${moveId} → credit note ${creditId}; invoice now ${i.payment_state}`);
  }
}

async function cleanup() {
  console.log("\n=== Cleanup ===");
  const step = async (label, fn) => { try { await fn(); } catch (e) { check(`cleanup: ${label}`, false, e.message.slice(0, 160)); } };
  const orders = report.created.orders;
  // Everything reachable from the test orders, tracked or not (a cycle that
  // throws half-way must not leave rows behind).
  const sos = orders.length
    ? await call("sale.order", "search_read", { domain: [["origin", "in", orders.map(dailyOrderOrigin)]], fields: ["id"] })
    : [];
  const soIds = [...new Set([...report.created.sale_orders, ...sos.map((r) => r.id)])];
  report.sale_order_final = [];
  for (const soId of soIds) {
    await step(`sale.order ${soId}`, async () => {
      let how = "cancel";
      try { await call("sale.order", "action_cancel", { ids: [soId], context: { disable_cancel_warning: true } }); }
      catch (e) {
        how = `lock (cancel refused: ${e.message.slice(0, 80)})`;
        await call("sale.order", "action_lock", { ids: [soId] });
      }
      const [so] = await call("sale.order", "read", { ids: [soId], fields: ["name", "state", "locked"] });
      report.sale_order_final.push({ id: soId, ...so, how });
      console.log(`  sale.order ${soId} ${so.name}: ${so.state} locked=${so.locked} (${how})`);
    });
  }
  const xInv = orders.length
    ? (await call("x_invoice", "search_read", { domain: [["x_order_id", "in", orders]], fields: ["id"] })).map((r) => r.id)
    : [];
  const xPay = xInv.length
    ? (await call("x_payment", "search_read", { domain: [["x_invoice_id", "in", xInv]], fields: ["id"] })).map((r) => r.id)
    : [];
  const xLines = orders.length
    ? (await call("x_daily_order_line", "search_read", { domain: [["x_order_id", "in", orders]], fields: ["id"] })).map((r) => r.id)
    : [];
  report.deleted = { x_payment: xPay, x_invoice: xInv, x_daily_order_line: xLines, x_daily_order: orders };
  if (xInv.length) await step("x_invoice unlink payment", () => call("x_invoice", "write", { ids: xInv, vals: { x_payment_id: false } }));
  for (const [model, ids] of [["x_payment", xPay], ["x_invoice", xInv], ["x_daily_order_line", xLines], ["x_daily_order", orders]]) {
    if (!ids.length) continue;
    await step(`${model} unlink`, async () => { await call(model, "unlink", { ids }); console.log(`  ${model}: ${ids.length} unlinked`); });
  }
  await step("archive partner", async () => {
    await call("res.partner", "write", { ids: [CUSTOMER], vals: { active: false } });
    console.log(`  partner ${CUSTOMER} archived`);
  });
}

async function main() {
  const baseline = await globalBalances();
  const stock0 = await stockCounts();
  report.baseline = baseline;
  report.stock_before = stock0;
  console.log(`today (Riyadh) ${TODAY}; stock before: ${JSON.stringify(stock0)}`);
  await call("res.partner", "write", { ids: [CUSTOMER], vals: { active: true } });
  const p = await pickProducts();
  let t;
  try {
    t = await cycleT(p, baseline);
    await cycleY(p);
    await cycleK(p);
    await cycleL(t);
    const stock1 = await stockCounts();
    report.stock_after_cycles = stock1;
    check("stock.picking unchanged", stock1.picking === stock0.picking, `${stock0.picking} → ${stock1.picking}`);
    check("stock.quant unchanged", stock1.quant === stock0.quant, `${stock0.quant} → ${stock1.quant}`);
    report.before_reversal = delta(baseline, await globalBalances());
    expectDelta("All cycles vs baseline (before reversal)", report.before_reversal, { "101007": 60, "102011": 70, "500001": -130 });
  } finally {
    await reverseAll();
    const after = await globalBalances();
    report.after_reversal_vs_baseline = delta(baseline, after);
    expectDelta("After reversal vs baseline", report.after_reversal_vs_baseline, {});
    const nonZero = Object.fromEntries(Object.entries(after).filter(([, v]) => Math.abs(v) >= 0.005));
    report.global_after = nonZero;
    expectDelta("Global posted ledger after reversal (every account zero)", nonZero, {});
    await cleanup();
    const stock2 = await stockCounts();
    report.stock_after_cleanup = stock2;
    check("stock unchanged after cleanup", stock2.picking === stock0.picking && stock2.quant === stock0.quant);
    check("no request reached graph.facebook.com", graphHits === 0, `graphHits=${graphHits}`);
    report.graph_hits = graphHits;
    report.accounting_errors = accErrors;
    report.failures = failures;
    const out = new URL(`./artifacts/acct-20260923-sale-live-verify-${Date.now()}.json`, import.meta.url);
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nreport → ${out.pathname}`);
    console.log(failures ? `\n✗ ${failures} failure(s)` : "\n✓ all checks passed");
    process.exitCode = failures ? 1 : 0;
  }
}
await main();
