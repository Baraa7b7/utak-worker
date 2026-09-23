// UTAK — live verification of purchase → accounting, 2026-09-23.
// Same method as scripts/tax-20260923-live-verify.mjs: runs the REAL
// syncPurchaseListToAccounting from src/purchase-accounting.ts and measures
// deltas on the GLOBAL posted ledger, so any unexpected account fails.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/acct-20260923-purchase-live-verify.mjs
//
// Safety:
//   • NO WhatsApp: any request to graph.facebook.com throws, env has no
//     OWNER_WHATSAPP (sendOwnerAlert returns before sending).
//   • Two TEST suppliers only («[SIM] مورد اختبار شراء …», x_is_simulation),
//     archived at the end. Test x_purchase_list rows are x_is_simulation and
//     are unlinked at the end (they carry today's x_date, and the 21:15 cron
//     reuses a same-day list).
//   • Every date = today (Riyadh): l10n_sa refuses future-dated moves.
//   • Default = reverse every bill with a same-date credit note, reconcile
//     the payable, lock the POs, and prove the ledger is back to baseline.
//
//   Cycle و: supplier WITHOUT vat, list 1 × 80
//            400001 +80 · 201002 −80 · no tax line · nothing else
//   Cycle ز: supplier WITH vat, list 1 × 115 tax-included. VAT really starts
//            2026-10-01, so this cycle alone passes vatEffectiveDate = today
//            (a function argument, never an env/runtime switch) to post the
//            taxed bill today:
//            400001 +100 · 104041 VAT Input +15 · 201002 −115
//   Cycle ح: same list closed twice → one purchase.order, one bill
//            400001 +30 · 201002 −30
//   All:     purchase.order has no stock.picking
//
// Exit code 1 on ANY mismatch.

import { writeFileSync } from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import { syncPurchaseListToAccounting, purchaseListOrigin } from "../src/purchase-accounting.ts";
import { todayRiyadhYmd } from "../src/accounting.ts";
import { call as workerCall } from "../src/odoo.ts";

// ---- hard block on any Meta traffic ----
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error(`BLOCKED WhatsApp request in purchase live-verify: ${url}`);
  return realFetch(input, init);
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
const env = {
  ODOO_URL: fileEnv.ODOO_URL,
  ODOO_DB: fileEnv.ODOO_DB,
  ODOO_LOGIN: fileEnv.ODOO_LOGIN,
  ODOO_API_KEY: fileEnv.ODOO_API_KEY,
  ACCOUNTING_SYNC: "true",
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
// The Worker code itself calls Odoo through src/odoo.ts; give it the same
// 429 patience by retrying the whole sync once if it failed on a 429.
async function syncWithRetry(listId, opts) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = accErrors.length;
    const r = await syncPurchaseListToAccounting(env, listId, opts);
    const errs = accErrors.slice(before).join(" | ");
    if (r || !errs.includes("429")) return r;
    console.log(`  … sync hit 429, retry in ${10 * (attempt + 1)}s`);
    await new Promise((res) => setTimeout(res, 10000 * (attempt + 1)));
  }
  return null;
}

const TODAY = todayRiyadhYmd();
const SUP_PLAIN = "[SIM] مورد اختبار شراء — بلا رقم ضريبي";
const SUP_VAT = "[SIM] مورد اختبار شراء — مسجل ضريبياً";
const SUP_VAT_NO = "300000000000003";
const report = { started_at: new Date().toISOString(), riyadh_today: TODAY, cycles: {}, created: { suppliers: [], lists: [], purchase_orders: [], bills: [], refunds: [] } };
let failures = 0;

const accErrors = [];
const origError = console.error;
console.error = (...a) => { const s = a.map(String).join(" "); if (s.includes("[purchase-accounting]")) accErrors.push(s); origError(...a); };

function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
  return cond;
}

async function globalBalances() {
  const lines = await call("account.move.line", "search_read", {
    domain: [["parent_state", "=", "posted"]],
    fields: ["account_id", "debit", "credit"],
    limit: 5000,
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
  const codes = new Set([...Object.keys(before), ...Object.keys(after)]);
  const d = {};
  for (const c of codes) {
    const v = Math.round(((after[c] ?? 0) - (before[c] ?? 0)) * 100) / 100;
    if (Math.abs(v) >= 0.005) d[c] = v;
  }
  return d;
}
function expectDelta(label, actual, expected) {
  console.log(`\n  ${label}`);
  console.log("    code      expected    actual");
  const codes = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  let ok = true;
  for (const c of codes) {
    const e = expected[c] ?? 0;
    const a = actual[c] ?? 0;
    const good = Math.abs(e - a) < 0.005;
    if (!good) ok = false;
    console.log(`    ${c.padEnd(8)} ${String(e).padStart(9)} ${String(a).padStart(9)}  ${good ? "✓" : "✗"}${expected[c] === undefined ? "  ← unexpected account" : ""}`);
  }
  check(`${label}: every account matches, no extra account`, ok);
  return ok;
}

async function ensureSupplier(name, vat) {
  const [ex] = await call("res.partner", "search_read", {
    domain: [["name", "=", name], ["active", "in", [true, false]]],
    fields: ["id", "active", "vat"],
    limit: 1,
  });
  if (ex) {
    await call("res.partner", "write", { ids: [ex.id], vals: { active: true, vat: vat || false, supplier_rank: 1, x_is_simulation: true } });
    report.created.suppliers.push(ex.id);
    return ex.id;
  }
  const [id] = await call("res.partner", "create", {
    vals_list: [{ name, vat: vat || false, supplier_rank: 1, is_company: true, x_is_simulation: true, country_id: 192 }],
  });
  report.created.suppliers.push(id);
  return id;
}

async function makeList(supplierId, unitPrice, qty = 1) {
  const items = [{
    product_id: 105, product_name: "افوكادو (اختبار شراء)", packaging_id: 47, packaging_name: "كرتون · 4 كيلو",
    total_quantity: qty, order_ids: [], unit_price: unitPrice, price_supplier_id: supplierId,
  }];
  const [id] = await call("x_purchase_list", "create", {
    vals_list: [{
      x_date: TODAY, x_status: "done", x_is_simulation: true, x_supplier_id: supplierId,
      x_aggregated_items: JSON.stringify(items), x_total_items_count: 1,
      x_notes: "acct-20260923-purchase-live-verify — اختبار، يُحذف آلياً",
    }],
  });
  report.created.lists.push(id);
  return id;
}

async function billFacts(billId) {
  const [m] = await call("account.move", "read", {
    ids: [billId],
    fields: ["name", "state", "move_type", "invoice_date", "amount_untaxed", "amount_tax", "amount_total", "payment_state", "partner_id"],
  });
  const lines = await call("account.move.line", "search_read", {
    domain: [["move_id", "=", billId]],
    fields: ["account_id", "debit", "credit", "display_type", "tax_line_id"],
  });
  return { m, lines };
}

async function poFacts(poId) {
  const [po] = await call("purchase.order", "read", {
    ids: [poId], fields: ["name", "state", "invoice_ids", "picking_ids", "incoming_picking_count", "origin", "amount_total"],
  });
  const pickings = await call("stock.picking", "search_count", { domain: [["origin", "=", po.name]] });
  return { po, pickings };
}

async function cycle(tag, { supplierId, unitPrice, qty = 1, opts = {}, expected, expectTaxLine, twice = false }) {
  console.log(`\n=== Cycle ${tag} ===`);
  const before = await globalBalances();
  const listId = await makeList(supplierId, unitPrice, qty);
  const r1 = await syncWithRetry(listId, { billDate: TODAY, ...opts });
  if (!r1) throw new Error(`cycle ${tag}: sync returned null — ${accErrors.slice(-1)[0] ?? "?"}`);
  report.created.purchase_orders.push(r1.purchaseOrderId);
  report.created.bills.push(r1.moveId);
  let r2 = null;
  if (twice) {
    r2 = await syncWithRetry(listId, { billDate: TODAY, ...opts });
    check(`${tag}: second close → skipped, same ids`, r2?.skipped === true && r2.purchaseOrderId === r1.purchaseOrderId && r2.moveId === r1.moveId, JSON.stringify(r2));
    const pos = await call("purchase.order", "search_read", { domain: [["origin", "=", purchaseListOrigin(listId)]], fields: ["id", "state"] });
    const bills = await call("account.move", "search_read", { domain: [["ref", "=", `PL-${listId}`], ["move_type", "=", "in_invoice"]], fields: ["id", "state"] });
    check(`${tag}: exactly one purchase.order for the list`, pos.length === 1, JSON.stringify(pos));
    check(`${tag}: exactly one vendor bill for the list`, bills.length === 1, JSON.stringify(bills));
  }
  const after = await globalBalances();
  const d = delta(before, after);
  const { m, lines } = await billFacts(r1.moveId);
  const { po, pickings } = await poFacts(r1.purchaseOrderId);
  const [link] = await call("x_purchase_list", "read", { ids: [listId], fields: ["x_purchase_order_id", "x_account_move_id"] });
  console.log(`  list ${listId} → ${po.name} (${r1.purchaseOrderId}, ${po.state}) → ${m.name} (${r1.moveId}, ${m.state}, ${m.invoice_date})`);
  check(`${tag}: both fields linked`, link?.x_purchase_order_id?.[0] === r1.purchaseOrderId && link?.x_account_move_id?.[0] === r1.moveId);
  check(`${tag}: bill in_invoice posted dated today`, m.move_type === "in_invoice" && m.state === "posted" && m.invoice_date === TODAY);
  check(`${tag}: no stock.picking`, (po.picking_ids ?? []).length === 0 && pickings === 0, `picking_ids=${po.picking_ids} origin-count=${pickings}`);
  const taxLines = lines.filter((l) => l.display_type === "tax" || l.tax_line_id);
  check(`${tag}: tax line ${expectTaxLine ? "present" : "absent"}`, expectTaxLine ? taxLines.length > 0 : taxLines.length === 0, `${taxLines.length} tax line(s), amount_tax=${m.amount_tax}`);
  expectDelta(`${tag} balance (before reversal)`, d, expected);
  report.cycles[tag] = {
    list: listId, po: { id: r1.purchaseOrderId, name: po.name, state: po.state }, bill: { id: r1.moveId, name: m.name, untaxed: m.amount_untaxed, tax: m.amount_tax, total: m.amount_total },
    expected, actual: d, second_run: r2,
  };
}

async function reverseAll() {
  console.log("\n=== Reverse everything ===");
  for (const billId of report.created.bills) {
    const [src] = await call("account.move", "read", { ids: [billId], fields: ["journal_id", "payment_state", "state", "date", "name"] });
    if (src.payment_state === "reversed" || src.state === "cancel") { console.log(`  bill ${billId} already ${src.payment_state || src.state}`); continue; }
    const ctx = { active_model: "account.move", active_ids: [billId], active_id: billId };
    const [revId] = await call("account.move.reversal", "create", {
      vals_list: [{ journal_id: src.journal_id[0], reason: "acct-20260923 purchase live-verify reversal", date: src.date }],
      context: ctx,
    });
    const res = await call("account.move.reversal", "reverse_moves", { ids: [revId], context: ctx });
    const refundId = res?.res_id;
    if (!refundId) throw new Error(`reverse_moves returned no res_id for bill ${billId}`);
    const [cn] = await call("account.move", "read", { ids: [refundId], fields: ["state"] });
    if (cn.state === "draft") await call("account.move", "action_post", { ids: [refundId] });
    const ap = await call("account.move.line", "search_read", {
      domain: [["move_id", "in", [billId, refundId]], ["account_id.account_type", "=", "liability_payable"], ["reconciled", "=", false]],
      fields: ["id"],
    });
    if (ap.length >= 2) await call("account.move.line", "reconcile", { ids: ap.map((l) => l.id) });
    report.created.refunds.push(refundId);
    const [b] = await call("account.move", "read", { ids: [billId], fields: ["name", "state", "payment_state"] });
    const [c] = await call("account.move", "read", { ids: [refundId], fields: ["name", "date", "amount_tax", "amount_total"] });
    console.log(`  bill ${billId} ${b.name} → refund ${refundId} ${c.name} (${c.date}, tax ${c.amount_tax}, total ${c.amount_total}); bill now ${b.state}/${b.payment_state}`);
  }
  for (const poId of report.created.purchase_orders) {
    try {
      await call("purchase.order", "button_cancel", { ids: [poId] });
    } catch (e) {
      // Odoo 19: a PO with a posted (even reversed) bill cannot be cancelled,
      // and button_done no longer exists — lock it so nothing re-bills it.
      try { await call("purchase.order", "button_lock", { ids: [poId] }); }
      catch (e2) { console.log(`  PO ${poId}: cancel refused (${e.message.slice(0, 80)}), lock refused (${e2.message.slice(0, 80)})`); }
    }
    const [po] = await call("purchase.order", "read", { ids: [poId], fields: ["name", "state", "locked"] }).catch(() => call("purchase.order", "read", { ids: [poId], fields: ["name", "state"] }));
    console.log(`  PO ${poId} ${po.name} → ${po.state}${po.locked !== undefined ? ` locked=${po.locked}` : ""}`);
  }
}

async function cleanup() {
  console.log("\n=== Cleanup test scaffolding ===");
  if (report.created.lists.length) {
    await call("x_purchase_list", "unlink", { ids: report.created.lists });
    console.log(`  x_purchase_list ${report.created.lists.join(",")} unlinked`);
  }
  if (report.created.suppliers.length) {
    await call("res.partner", "write", { ids: report.created.suppliers, vals: { active: false } });
    console.log(`  test suppliers ${report.created.suppliers.join(",")} archived`);
  }
}

async function main() {
  console.log(`purchase live-verify — ${new Date().toISOString()} — Riyadh day ${TODAY}`);
  const baseline = await globalBalances();
  report.baseline = baseline;
  console.log(`  baseline (global posted): ${JSON.stringify(baseline)}`);

  let cycleError = null;
  try {
    const plain = await ensureSupplier(SUP_PLAIN, false);
    const vat = await ensureSupplier(SUP_VAT, SUP_VAT_NO);
    console.log(`  test suppliers: ${plain} (no vat), ${vat} (vat ${SUP_VAT_NO})`);
    await cycle("و", { supplierId: plain, unitPrice: 80, expected: { "400001": 80, "201002": -80 }, expectTaxLine: false });
    await cycle("ز", { supplierId: vat, unitPrice: 115, opts: { vatEffectiveDate: TODAY }, expected: { "400001": 100, "104041": 15, "201002": -115 }, expectTaxLine: true });
    await cycle("ح", { supplierId: plain, unitPrice: 30, twice: true, expected: { "400001": 30, "201002": -30 }, expectTaxLine: false });
  } catch (e) {
    cycleError = e;
    failures++;
    console.log(`\n✗ cycle aborted: ${e.message}`);
  }
  report.before_reversal = await globalBalances();
  console.log(`\n  ledger before reversal: ${JSON.stringify(delta(baseline, report.before_reversal))}`);

  await reverseAll();
  const after = await globalBalances();
  report.after_reversal = after;
  expectDelta("After reversal vs baseline (all accounts back to baseline)", delta(baseline, after), {});
  const nonZero = Object.fromEntries(Object.entries(after).filter(([, v]) => Math.abs(v) >= 0.005));
  console.log(`  global posted ledger after reversal: ${JSON.stringify(nonZero)}`);
  check("global posted ledger is zero on every account", Object.keys(nonZero).length === 0, JSON.stringify(nonZero));

  await cleanup();

  report.accounting_errors = accErrors;
  report.failures = failures;
  report.finished_at = new Date().toISOString();
  const out = new URL(`./artifacts/acct-20260923-purchase-live-verify-${Date.now()}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nreport → ${out.pathname}`);
  console.log(`created: ${JSON.stringify(report.created)}`);
  if (cycleError || failures > 0) {
    console.log(`\n❌ VERIFY FAILED — ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ VERIFY PASSED — cycles و ز ح matched expectations and the ledger is back to zero");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
