// Test invoices out of the collection path (2026-09-24).
//
// The 18:00 collection summary listed 15 test invoices (UTAK-ACCT-TEST,
// UTAK-ACCT-*, UTAK-VAT-*; 555 SAR). This script inventories every unpaid
// x_invoice with a test prefix and every customer account.move carrying one,
// then makes sure each test x_invoice has x_is_simulation=true — the flag
// src/odoo.ts::getUnpaidInvoicesWithCustomer now filters on.
//
// Only x_invoice.x_is_simulation is ever written. account.move is read only:
// no move is posted, reversed, cancelled, edited or deleted. Nothing is
// deleted anywhere. Idempotent; the "before" is saved before any write.
//
//   node scripts/cleanup-20260924-test-invoices.mjs [--dry-run]
//   node scripts/cleanup-20260924-test-invoices.mjs --rollback [--dry-run]
//
// Out:      scripts/artifacts/cleanup-20260924-test-invoices.json (+ .md table)
// Rollback: scripts/artifacts/cleanup-20260924-test-invoices-rollback.json

import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp from the test-invoice cleanup");
  return realFetch(input, init);
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ROLLBACK = args.includes("--rollback");
const art = (f) => new URL(`./artifacts/${f}`, import.meta.url).pathname;
const RB_PATH = art("cleanup-20260924-test-invoices-rollback.json");
const OUT_JSON = art("cleanup-20260924-test-invoices.json");
const OUT_MD = art("cleanup-20260924-test-invoices.md");
const log = (...a) => console.log(...a);

/** Numbers the live-verify scripts gave their invoices («وما شابهها» included). */
export const TEST_NUMBER = /^(SIM-TEST\b|UTAK-ACCT-|UTAK-VAT-|UTAK-[A-Z]+-TEST-)/;
const COLLECTION_DOMAIN = [["x_status", "in", ["issued", "overdue"]], ["x_is_simulation", "!=", true]];

const readRb = () => (existsSync(RB_PATH) ? JSON.parse(readFileSync(RB_PATH, "utf8")) : null);

async function inventory() {
  const invs = await call("x_invoice", "search_read", {
    domain: [["x_status", "!=", "paid"]],
    fields: ["id", "x_invoice_number", "x_status", "x_total", "x_invoice_date", "x_order_id", "x_account_move_id",
      "x_payment_id", "x_is_simulation", "x_sent_to_collector_at", "x_sent_to_customer_at"],
    order: "id asc", limit: 1000,
  });
  const test = invs.filter((i) => TEST_NUMBER.test(String(i.x_invoice_number || "")));
  const other = invs.filter((i) => !TEST_NUMBER.test(String(i.x_invoice_number || "")));

  const orderIds = [...new Set(test.map((i) => i.x_order_id?.[0]).filter(Boolean))];
  const orders = orderIds.length ? await call("x_daily_order", "read", {
    ids: orderIds, fields: ["id", "x_customer_id", "x_state", "x_order_date", "x_is_simulation"],
  }) : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  // Every customer move: linked from a test x_invoice, or carrying a test ref.
  const moves = await call("account.move", "search_read", {
    domain: [["move_type", "in", ["out_invoice", "out_refund"]]],
    fields: ["id", "name", "ref", "move_type", "state", "payment_state", "amount_total", "amount_residual",
      "invoice_date", "partner_id", "reversed_entry_id", "reversal_move_ids"],
    order: "id asc", limit: 1000,
  });
  const moveMap = new Map(moves.map((m) => [m.id, m]));
  const testMoves = moves.filter((m) => /UTAK-ACCT-|UTAK-VAT-|SIM-TEST|live-verify|orphan cleanup/.test(String(m.ref || "")));

  const rows = test.map((i) => {
    const o = orderMap.get(i.x_order_id?.[0]);
    // UTAK-VAT-D/E: the move was created as a draft, then cancelled — the
    // x_invoice never got the link, so it is found by ref.
    const linked = Boolean(i.x_account_move_id);
    const m = linked ? moveMap.get(i.x_account_move_id[0])
      : moves.find((mv) => mv.move_type === "out_invoice" && mv.ref === i.x_invoice_number) ?? null;
    const reversal = m?.reversal_move_ids?.length ? moveMap.get(m.reversal_move_ids[0]) : null;
    return {
      id: i.id, number: i.x_invoice_number, status: i.x_status, total: i.x_total, date: i.x_invoice_date,
      customer: o?.x_customer_id ? o.x_customer_id[1] : null, customerId: o?.x_customer_id?.[0] ?? null,
      order: i.x_order_id?.[0] ?? null, orderState: o?.x_state ?? null, orderSim: o?.x_is_simulation ?? null,
      move: m ? { id: m.id, name: m.name, state: m.state, payment_state: m.payment_state, residual: m.amount_residual, linked } : null,
      reversedBy: reversal ? { id: reversal.id, name: reversal.name, state: reversal.state } : null,
      sentToCollector: i.x_sent_to_collector_at || null, sentToCustomer: i.x_sent_to_customer_at || null,
      x_is_simulation: i.x_is_simulation,
    };
  });
  return { rows, other, testMoves, openTestMoves: testMoves.filter((m) => m.state === "posted" && !["paid", "reversed", "in_payment"].includes(m.payment_state) && m.amount_residual > 0) };
}

function moveVerdict(r) {
  if (!r.move) return "لا قيد";
  if (r.move.payment_state === "reversed") return `نعم، بـ ${r.reversedBy?.name ?? ""}`.trim();
  if (r.move.state === "cancel") return "لا حاجة: ملغى قبل الترحيل (لم يُرحَّل أصلاً)";
  return `${r.move.state}/${r.move.payment_state} — متبقٍ ${r.move.residual}`;
}

function markdown(inv, collectionAfter) {
  const L = [];
  L.push(`# فواتير الاختبار في مسار التحصيل — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "");
  L.push("| # | الرقم | العميل | المبلغ | التاريخ | الحالة | قيد محاسبي | القيد معكوس؟ | أُرسلت للمحصّل | x_is_simulation |", "|---|---|---|---|---|---|---|---|---|---|");
  inv.rows.forEach((r, k) => L.push(`| ${k + 1} | \`${r.number}\` | ${r.customer ?? "—"} | ${r.total} | ${r.date} | ${r.status} | ${r.move ? (r.move.state === "posted" ? `مرحّل ${r.move.name} (#${r.move.id})` : `مسودة ملغاة #${r.move.id}${r.move.linked ? "" : "، غير مربوطة"}`) : "لا"} | ${moveVerdict(r)} | ${r.sentToCollector ? "نعم" : "لا"} | ${r.x_is_simulation} |`));
  const sum = inv.rows.reduce((s, r) => s + r.total, 0);
  L.push("", `**المجموع:** ${inv.rows.length} فاتورة، ${Math.round(sum * 100) / 100} ر.س.`, "");
  L.push(`**account.move للعملاء بمرجع اختبار** (فواتير وإشعارات عكس، ومنها قيود SIM-TEST لتحقق المبيعات بلا x_invoice): ${inv.testMoves.length}، المفتوح منها (مرحّل وبمتبقٍ): ${inv.openTestMoves.length}. لم يُلمس أي قيد.`, "");
  L.push(`**ملخص التحصيل بعد الفلتر** (\`x_status in issued/overdue\` و\`x_is_simulation != true\`): ${collectionAfter.length} فاتورة${collectionAfter.length ? ": " + collectionAfter.map((c) => `\`${c.x_invoice_number}\``).join("، ") : ""}.`);
  return L.join("\n") + "\n";
}

async function setup() {
  const inv = await inventory();
  log(`test x_invoice unpaid: ${inv.rows.length} (${inv.rows.reduce((s, r) => s + r.total, 0)} SAR); other unpaid: ${inv.other.length}`);
  log(`customer moves with a test ref: ${inv.testMoves.length}; open among them: ${inv.openTestMoves.length}`);
  if (inv.openTestMoves.length) log("  ⚠ open test moves (NOT touched):", inv.openTestMoves.map((m) => `${m.id} ${m.name} ${m.payment_state} ${m.amount_residual}`).join("; "));

  let rb = readRb();
  if (!rb) {
    rb = { script: "scripts/cleanup-20260924-test-invoices.mjs", createdAt: new Date().toISOString(),
      before: inv.rows.map((r) => ({ model: "x_invoice", id: r.id, number: r.number, x_is_simulation: r.x_is_simulation })), wrote: [] };
    if (!DRY) writeFileSync(RB_PATH, JSON.stringify(rb, null, 2) + "\n");
  }
  for (const r of inv.rows) {
    log(`x_invoice ${r.id} ${r.number}: x_is_simulation ${r.x_is_simulation} → true${r.x_is_simulation ? " (already)" : ""}`);
    if (r.x_is_simulation || DRY) continue;
    await call("x_invoice", "write", { ids: [r.id], vals: { x_is_simulation: true } });
    rb.wrote.push({ model: "x_invoice", id: r.id });
    writeFileSync(RB_PATH, JSON.stringify(rb, null, 2) + "\n");
  }

  const after = await inventory();
  const collection = await call("x_invoice", "search_read", { domain: COLLECTION_DOMAIN, fields: ["id", "x_invoice_number", "x_total"], limit: 1000 });
  const leaked = collection.filter((c) => TEST_NUMBER.test(String(c.x_invoice_number || "")));
  const out = {
    at: new Date().toISOString(), dryRun: DRY,
    testInvoices: after.rows, total: after.rows.reduce((s, r) => s + r.total, 0),
    otherUnpaid: after.other.map((i) => ({ id: i.id, number: i.x_invoice_number, status: i.x_status, total: i.x_total, x_is_simulation: i.x_is_simulation })),
    testMoves: after.testMoves.map((m) => ({ id: m.id, name: m.name, ref: m.ref, type: m.move_type, state: m.state, payment_state: m.payment_state, residual: m.amount_residual })),
    openTestMoves: after.openTestMoves.length,
    collectionAfterFilter: collection, testInCollection: leaked.length,
    wrote: rb.wrote,
  };
  writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n");
  writeFileSync(OUT_MD, markdown(after, collection));
  if (!DRY && after.rows.some((r) => r.x_is_simulation !== true)) throw new Error("verify failed: a test invoice is still unmarked");
  if (!DRY && leaked.length) throw new Error(`verify failed: ${leaked.length} test invoice(s) still in the collection domain`);
  log(`collection domain after: ${collection.length} invoice(s); test among them: ${leaked.length}`);
  log(DRY ? "dry-run: nothing written" : `verify ✓ — wrote ${rb.wrote.length} flag(s); nothing deleted, no move touched`);
}

async function rollback() {
  const rb = readRb();
  if (!rb) throw new Error(`no rollback file ${RB_PATH}`);
  for (const b of rb.before) {
    log(`${b.model} ${b.id} ${b.number}: x_is_simulation ← ${b.x_is_simulation}`);
    if (!DRY) await call(b.model, "write", { ids: [b.id], vals: { x_is_simulation: b.x_is_simulation } });
  }
  log(DRY ? "dry-run: nothing written" : "rollback done");
}

await (ROLLBACK ? rollback() : setup());
