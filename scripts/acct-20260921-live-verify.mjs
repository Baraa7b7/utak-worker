// UTAK — Live accounting verification with EXPLICIT expectations.
// First version 2026-09-21; rewritten 2026-09-23 after the collection fix.
//
// Runs the REAL code: syncInvoiceToAccounting / syncPaymentToAccounting are
// imported from src/accounting.ts (not re-implemented here), so this proves
// the Worker path — wizard, payment id from the action, account-type guards.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/acct-20260921-live-verify.mjs
//
// Safety:
//   • NO WhatsApp: any request to graph.facebook.com throws, and env has no
//     OWNER_WHATSAPP (sendOwnerAlert returns before sending).
//   • Test partners only: 48 «اختبار محاسبة», plus «اختبار محاسبة ب» for the
//     ambiguity cycle (created x_is_simulation=true, archived at the end).
//   • Every x_* scaffold row is x_is_simulation=true.
//   • Default = reverse everything and prove the ledger is back to zero.
//     --keep leaves the cycles in place (NOT recommended: shared tenant).
//
// Expectations are measured as deltas on the GLOBAL posted ledger (every
// posted account.move.line), so an unexpected fourth account anywhere fails.
//
//   Cycle A (cash):     invoice 12, cash payment 9 on CSHD
//                       102011 +3 · 500001 −12 · 101007 +9 · nothing else
//   Cycle B (transfer): invoice 10, transfer 10 on BNK1
//                       102011 0 · 500001 −10 · 101003 +10 · invoice paid|in_payment
//   Cycle C (ambiguity): two invoices, same amount + day, different partners;
//                       one payment → linked to ITS invoice only
//   Reverse:            every account back to exactly its baseline
//
// Exit code 1 on ANY mismatch.

import { readFileSync, writeFileSync } from "node:fs";
import {
  syncInvoiceToAccounting,
  syncPaymentToAccounting,
  buildPaymentSearchDomain,
  todayRiyadhYmd,
} from "../src/accounting.ts";
import { call as workerCall } from "../src/odoo.ts";

// ---- hard block on any Meta traffic ----
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error(`BLOCKED WhatsApp request in live-verify: ${url}`);
  return realFetch(input, init);
};

const fileEnv = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
// Worker-shaped env: accounting on, NO owner number, no sim/pilot stamping.
const env = {
  ODOO_URL: fileEnv.ODOO_URL,
  ODOO_DB: fileEnv.ODOO_DB,
  ODOO_LOGIN: fileEnv.ODOO_LOGIN,
  ODOO_API_KEY: fileEnv.ODOO_API_KEY,
  ACCOUNTING_SYNC: "true",
};
// Odoo.com rate-limits bursts (HTTP 429). Retry with backoff so a long
// reversal never stops half-way and leaves the shared ledger unbalanced.
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

const KEEP = process.argv.includes("--keep");
const TODAY = todayRiyadhYmd();
const TEST_PARTNER_ID = 48;
const SECOND_PARTNER_NAME = "اختبار محاسبة ب";
const report = { started_at: new Date().toISOString(), today: TODAY, cycles: {}, created: { invoices: [], payments: [], x_orders: [], x_invoices: [], x_payments: [], credit_notes: [] } };
let failures = 0;

// Capture guard errors printed by accounting.ts so a silent null is loud here.
const origError = console.error;
const accountingErrors = [];
console.error = (...a) => { const s = a.map(String).join(" "); if (s.includes("[accounting]")) accountingErrors.push(s); origError(...a); };

function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
  return cond;
}

// ---- ledger ----
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

// ---- scaffolding (x_* rows, sim-marked) ----
async function ensureSecondPartner() {
  const rows = await call("res.partner", "search_read", {
    domain: [["name", "=", SECOND_PARTNER_NAME]],
    fields: ["id", "active"],
    limit: 1,
    context: { active_test: false },
  });
  if (rows[0]) {
    if (!rows[0].active) await call("res.partner", "write", { ids: [rows[0].id], vals: { active: true } });
    return rows[0].id;
  }
  const [id] = await call("res.partner", "create", {
    vals_list: [{ name: SECOND_PARTNER_NAME, customer_rank: 1, x_is_simulation: true }],
  });
  return id;
}

async function invoiceFor(partnerId, amount, tag) {
  const [xOrderId] = await call("x_daily_order", "create", {
    vals_list: [{ x_customer_id: partnerId, x_order_date: TODAY, x_is_simulation: true }],
  });
  const number = `UTAK-ACCT-${tag}-${Date.now()}`;
  const [xInvoiceId] = await call("x_invoice", "create", {
    vals_list: [{
      x_order_id: xOrderId, x_invoice_number: number, x_invoice_date: TODAY,
      x_subtotal: amount, x_tax_amount: 0, x_total: amount, x_status: "issued", x_is_simulation: true,
    }],
  });
  report.created.x_orders.push(xOrderId);
  report.created.x_invoices.push(xInvoiceId);
  const moveId = await syncInvoiceToAccounting(env, {
    invoiceId: xInvoiceId,
    existingMoveId: null,
    invoiceNumber: number,
    customerPartnerId: partnerId,
    invoiceDate: TODAY,
    lines: [{ product_tmpl_id: 0, description: `خط اختبار ${tag}`, quantity: 1, price_unit: amount }],
    expectedTotal: amount,
  });
  if (!moveId) throw new Error(`syncInvoiceToAccounting returned null for ${tag}: ${accountingErrors.at(-1) ?? "?"}`);
  report.created.invoices.push(moveId);
  const [link] = await call("x_invoice", "read", { ids: [xInvoiceId], fields: ["x_account_move_id"] });
  check(`${tag}: x_invoice ${xInvoiceId} linked to move ${moveId}`, link?.x_account_move_id?.[0] === moveId);
  return { xInvoiceId, moveId, number };
}

async function payFor(inv, amount, method, tag) {
  const [xPaymentId] = await call("x_payment", "create", {
    vals_list: [{
      x_invoice_id: inv.xInvoiceId, x_amount: amount, x_method: method,
      x_collected_at: new Date().toISOString().replace("T", " ").slice(0, 19), x_is_simulation: true,
    }],
  });
  report.created.x_payments.push(xPaymentId);
  const errsBefore = accountingErrors.length;
  const paymentId = await syncPaymentToAccounting(env, {
    paymentId: xPaymentId,
    existingPaymentMoveId: null,
    invoiceMoveId: inv.moveId,
    invoiceNumber: inv.number,
    amount,
    method,
    paymentDate: TODAY,
  });
  if (!paymentId) throw new Error(`syncPaymentToAccounting returned null for ${tag}: ${accountingErrors.slice(errsBefore).join(" | ") || "?"}`);
  report.created.payments.push(paymentId);
  const [xp] = await call("x_payment", "read", { ids: [xPaymentId], fields: ["x_account_payment_id"] });
  check(`${tag}: x_payment ${xPaymentId} linked to account.payment ${paymentId}`, xp?.x_account_payment_id?.[0] === paymentId);
  return { xPaymentId, paymentId };
}

async function paymentFacts(paymentId) {
  const [p] = await call("account.payment", "read", {
    ids: [paymentId],
    fields: ["id", "name", "state", "move_id", "partner_id", "journal_id", "amount", "reconciled_invoice_ids", "outstanding_account_id"],
  });
  const [m] = p.move_id ? await call("account.move", "read", { ids: [p.move_id[0]], fields: ["state"] }) : [{ state: "" }];
  return { ...p, move_state: m.state };
}
async function invoiceState(moveId) {
  const [m] = await call("account.move", "read", { ids: [moveId], fields: ["name", "state", "payment_state", "amount_residual"] });
  return m;
}

// ---- cycles ----
async function cycleA() {
  console.log("\n=== Cycle A — cash: invoice 12, payment 9 on CSHD ===");
  const before = await globalBalances();
  const inv = await invoiceFor(TEST_PARTNER_ID, 12, "A");
  const pay = await payFor(inv, 9, "cash", "A");
  const after = await globalBalances();
  const f = await paymentFacts(pay.paymentId);
  const i = await invoiceState(inv.moveId);
  console.log(`  payment ${f.name} state=${f.state} move=${f.move_id?.[1]} (${f.move_state}) journal=${f.journal_id?.[1]}`);
  console.log(`  invoice ${i.name} payment_state=${i.payment_state} residual=${i.amount_residual}`);
  check("A: payment has a posted journal entry", !!f.move_id && f.move_state === "posted");
  check("A: journal is CSHD", String(f.journal_id?.[1] ?? "").includes("كاش السائق"));
  check("A: invoice partial, residual 3", i.payment_state === "partial" && Math.abs(i.amount_residual - 3) < 0.005, `${i.payment_state}/${i.amount_residual}`);
  const expected = { "102011": 3, "500001": -12, "101007": 9 };
  const d = delta(before, after);
  expectDelta("A balance (before reversal)", d, expected);
  report.cycles.A = { expected, actual: d, invoice: i, payment: f };
}

async function cycleB() {
  console.log("\n=== Cycle B — transfer: invoice 10, payment 10 on BNK1 ===");
  const before = await globalBalances();
  const inv = await invoiceFor(TEST_PARTNER_ID, 10, "B");
  const pay = await payFor(inv, 10, "transfer", "B");
  const after = await globalBalances();
  const f = await paymentFacts(pay.paymentId);
  const i = await invoiceState(inv.moveId);
  console.log(`  payment ${f.name} state=${f.state} move=${f.move_id?.[1]} (${f.move_state}) journal=${f.journal_id?.[1]}`);
  console.log(`  invoice ${i.name} payment_state=${i.payment_state} residual=${i.amount_residual}`);
  check("B: payment has a posted journal entry", !!f.move_id && f.move_state === "posted");
  check("B: invoice paid or in_payment", i.payment_state === "paid" || i.payment_state === "in_payment", i.payment_state);
  const expected = { "500001": -10, "101003": 10 };
  const d = delta(before, after);
  expectDelta("B balance (before reversal)", d, expected);
  report.cycles.B = { expected: { ...expected, "102011": 0 }, actual: d, invoice: i, payment: f };
}

async function cycleC(partner2) {
  console.log("\n=== Cycle C — ambiguity: two partners, same amount, same day, one payment ===");
  const before = await globalBalances();
  const inv48 = await invoiceFor(TEST_PARTNER_ID, 7, "C48");
  const invB = await invoiceFor(partner2, 7, "CB");
  // Pay the one created FIRST — a newest-first search without a partner
  // filter would be the one to go wrong here.
  const pay = await payFor(inv48, 7, "cash", "C");
  const f = await paymentFacts(pay.paymentId);
  const i48 = await invoiceState(inv48.moveId);
  const iB = await invoiceState(invB.moveId);
  const after = await globalBalances();
  console.log(`  payment ${f.name} partner=${f.partner_id?.[0]} reconciled_invoice_ids=${JSON.stringify(f.reconciled_invoice_ids)}`);
  console.log(`  invoice 48 ${i48.name} ${i48.payment_state} · invoice B ${iB.name} ${iB.payment_state}`);
  check("C: payment partner is 48", f.partner_id?.[0] === TEST_PARTNER_ID);
  check("C: payment reconciles exactly invoice 48", JSON.stringify(f.reconciled_invoice_ids) === JSON.stringify([inv48.moveId]), JSON.stringify(f.reconciled_invoice_ids));
  check("C: invoice 48 paid/in_payment", i48.payment_state === "paid" || i48.payment_state === "in_payment", i48.payment_state);
  check("C: partner-B invoice untouched (not_paid)", iB.payment_state === "not_paid", iB.payment_state);
  // The fallback domain, live: filtered by partner B it must find nothing.
  const [journal] = await call("account.journal", "search_read", { domain: [["code", "=", "CSHD"]], fields: ["id"], limit: 1 });
  const forB = await call("account.payment", "search_read", {
    domain: buildPaymentSearchDomain({ partnerId: partner2, amount: 7, journalId: journal.id, date: TODAY }),
    fields: ["id"],
  });
  const for48 = await call("account.payment", "search_read", {
    domain: [...buildPaymentSearchDomain({ partnerId: TEST_PARTNER_ID, amount: 7, journalId: journal.id, date: TODAY }), ["state", "!=", "canceled"]],
    fields: ["id"],
  });
  check("C: fallback domain for partner B finds no payment", forB.length === 0, JSON.stringify(forB));
  check("C: fallback domain for partner 48 finds exactly this payment", for48.length === 1 && for48[0].id === pay.paymentId, JSON.stringify(for48));
  const expected = { "102011": 7, "500001": -14, "101007": 7 };
  expectDelta("C balance (before reversal)", delta(before, after), expected);
  report.cycles.C = { expected, actual: delta(before, after), payment: f, invoice48: i48, invoiceB: iB };
}

// ---- reversal ----
async function reverseAll() {
  console.log("\n=== Reverse everything ===");
  for (const pid of report.created.payments) {
    const [cur] = await call("account.payment", "read", { ids: [pid], fields: ["state"] });
    if (cur?.state === "canceled") { console.log(`  payment ${pid} already cancelled`); continue; }
    try { await call("account.payment", "action_draft", { ids: [pid] }); } catch (e) { console.log(`  payment ${pid} action_draft: ${e.message.slice(0, 120)}`); }
    try { await call("account.payment", "action_cancel", { ids: [pid] }); } catch (e) { console.log(`  payment ${pid} action_cancel: ${e.message.slice(0, 120)}`); }
    const [p] = await call("account.payment", "read", { ids: [pid], fields: ["state", "move_id"] });
    check(`payment ${pid} cancelled`, p.state === "canceled", `${p.state} move=${JSON.stringify(p.move_id)}`);
  }
  for (const moveId of report.created.invoices) {
    const [src] = await call("account.move", "read", { ids: [moveId], fields: ["journal_id", "payment_state", "state"] });
    if (src.payment_state === "reversed" || src.state === "cancel") {
      console.log(`  invoice ${moveId} already ${src.payment_state || src.state}`);
      continue;
    }
    const ctx = { active_model: "account.move", active_ids: [moveId], active_id: moveId };
    const [revId] = await call("account.move.reversal", "create", {
      vals_list: [{ journal_id: src.journal_id[0], reason: "acct-20260923 live-verify reversal", date: TODAY }],
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
    report.created.credit_notes.push(creditId);
    const i = await invoiceState(moveId);
    console.log(`  invoice ${moveId} → credit note ${creditId}; invoice now ${i.state}/${i.payment_state}`);
  }
}

// --reverse-only payments=6,7 invoices=17,19 [partner2=51]
// Resumes a reversal that was interrupted (e.g. by a 429) and proves the
// global ledger is back to zero on the accounts the cycles touched.
async function reverseOnly() {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`${k}=`)) ?? "").split("=")[1] ?? "";
  const ids = (k) => arg(k).split(",").map(Number).filter((n) => n > 0);
  report.created.payments = ids("payments");
  report.created.invoices = ids("invoices");
  console.log(`reverse-only — payments=${report.created.payments} invoices=${report.created.invoices}`);
  await reverseAll();
  const after = await globalBalances();
  report.after_reversal = after;
  const nonZero = Object.fromEntries(Object.entries(after).filter(([, v]) => Math.abs(v) >= 0.005));
  expectDelta("After reversal (global posted ledger, every account)", nonZero, {});
  const p2 = Number(arg("partner2"));
  if (p2 > 0) { await call("res.partner", "write", { ids: [p2], vals: { active: false } }); console.log(`  archived partner ${p2}`); }
  const out = new URL(`./artifacts/acct-20260923-live-verify-reverse-${Date.now()}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify({ ...report, failures }, null, 2));
  console.log(`report → ${out.pathname}`);
  if (failures > 0) { console.log(`❌ REVERSAL CHECK FAILED — ${failures}`); process.exit(1); }
  console.log("✅ ledger back to zero");
}

async function main() {
  if (process.argv.includes("--reverse-only")) return reverseOnly();
  console.log(`live-verify — ${new Date().toISOString()} — Riyadh day ${TODAY} — KEEP=${KEEP}`);
  const [p48] = await call("res.partner", "read", { ids: [TEST_PARTNER_ID], fields: ["name", "x_is_simulation"] });
  if (!p48 || p48.name !== "اختبار محاسبة") throw new Error(`partner 48 is not the test partner: ${JSON.stringify(p48)}`);
  const partner2 = await ensureSecondPartner();
  console.log(`  test partners: 48 «${p48.name}», ${partner2} «${SECOND_PARTNER_NAME}»`);

  const baseline = await globalBalances();
  report.baseline = baseline;
  console.log(`  baseline (global posted): ${JSON.stringify(baseline)}`);

  let cycleError = null;
  try {
    await cycleA();
    await cycleB();
    await cycleC(partner2);
  } catch (e) {
    cycleError = e;
    failures++;
    console.log(`\n✗ cycle aborted: ${e.message}`);
  }
  report.before_reversal = await globalBalances();

  if (KEEP) {
    console.log("\n--keep: leaving rows in place.");
  } else {
    await reverseAll();
    const after = await globalBalances();
    report.after_reversal = after;
    expectDelta("After reversal vs baseline (all accounts back to baseline)", delta(baseline, after), {});
    await call("res.partner", "write", { ids: [partner2], vals: { active: false } });
    console.log(`  archived partner ${partner2}`);
  }

  report.accounting_errors = accountingErrors;
  report.failures = failures;
  report.finished_at = new Date().toISOString();
  const out = new URL(`./artifacts/acct-20260923-live-verify-${Date.now()}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nreport → ${out.pathname}`);
  console.log(`created: ${JSON.stringify(report.created)}`);
  if (cycleError || failures > 0) {
    console.log(`\n❌ VERIFY FAILED — ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ VERIFY PASSED — all three cycles matched expectations and the ledger is back to baseline");
}

main().catch((e) => { origError("VERIFY CRASHED:", e); process.exit(1); });
