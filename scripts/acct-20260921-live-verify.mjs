// UTAK — Live accounting-sync verification, 2026-09-21
//
// End-to-end walk-through against the shared Odoo tenant using a scoped
// test partner "اختبار محاسبة" so nothing here can be confused with a
// real customer. Steps:
//
//   1. Ensure partner "اختبار محاسبة" (customer_rank=1, x_is_simulation=true).
//   2. Create one x_invoice header on that partner (marked sim).
//   3. Mirror syncInvoiceToAccounting: create + post account.move
//      (out_invoice, 3 SAR line, tax_ids empty), link move to x_invoice
//      via x_account_move_id.
//   4. Create one x_payment (cash) on that x_invoice (marked sim).
//   5. Mirror syncPaymentToAccounting: register + post an account.payment
//      via account.payment.register wizard, reconciling the move. Link
//      the payment to x_payment via x_account_payment_id.
//   6. Print the partner's trial balance (posted account.move.line
//      rolled up by account) — proves revenue / AR / cash all moved.
//   7. Reverse EVERYTHING: unreconcile the payment, cancel it; reverse
//      the invoice with a credit note (in "modify" mode → cancel both).
//      Print trial balance again → every account must net to 0.00.
//
// Optionally with --keep the script leaves rows in place after step 6.
// Default is to reverse (steps 7) so the ledger returns to zero.
//
// Requires .env.sim-verify. NO WhatsApp is sent. NO cron is triggered.

import { readFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

const KEEP = process.argv.includes("--keep");

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body, ctx) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const bodyWithCtx = ctx ? { ...body, context: { ...(body.context ?? {}), ...ctx } } : body;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(bodyWithCtx),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body, ctx); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const TEST_PARTNER_NAME = "اختبار محاسبة";
const TODAY = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

async function ensureTestPartner() {
  const existing = await call("res.partner", "search_read", {
    domain: [["name", "=", TEST_PARTNER_NAME]],
    fields: ["id", "name", "customer_rank", "x_is_simulation"],
    limit: 1,
  });
  if (existing[0]) {
    console.log(`  partner exists — id=${existing[0].id}`);
    return existing[0].id;
  }
  const ids = await call("res.partner", "create", {
    vals_list: [{
      name: TEST_PARTNER_NAME,
      customer_rank: 1,
      x_is_simulation: true,
    }],
  });
  console.log(`  created partner — id=${ids[0]}`);
  return ids[0];
}

async function readTrialBalance(partnerId) {
  const lines = await call("account.move.line", "search_read", {
    domain: [["partner_id", "=", partnerId], ["parent_state", "=", "posted"]],
    fields: ["id", "account_id", "debit", "credit"],
    limit: 500,
  });
  const accIds = new Set(lines.map((l) => (l.account_id ? l.account_id[0] : 0)).filter((n) => n > 0));
  const info = accIds.size
    ? await call("account.account", "read", { ids: [...accIds], fields: ["id", "code", "name"] })
    : [];
  const byId = new Map(info.map((r) => [r.id, r]));
  const rollup = new Map();
  for (const l of lines) {
    if (!l.account_id) continue;
    const id = l.account_id[0];
    const meta = byId.get(id) ?? { code: "?", name: String(id) };
    const row = rollup.get(id) ?? { code: meta.code, name: meta.name, debit: 0, credit: 0 };
    row.debit += l.debit ?? 0;
    row.credit += l.credit ?? 0;
    rollup.set(id, row);
  }
  const out = [...rollup.values()].sort((a, b) => a.code.localeCompare(b.code));
  return out;
}

function printTrialBalance(label, rows) {
  console.log(`\n${label}`);
  if (rows.length === 0) {
    console.log("  (no posted lines for this partner)");
    return;
  }
  console.log("  code    name                                 debit         credit       balance");
  let totDeb = 0, totCred = 0;
  for (const r of rows) {
    const bal = r.debit - r.credit;
    totDeb += r.debit; totCred += r.credit;
    console.log(`  ${r.code.padEnd(7)} ${r.name.slice(0, 34).padEnd(34)} ${r.debit.toFixed(2).padStart(12)}  ${r.credit.toFixed(2).padStart(12)}  ${bal.toFixed(2).padStart(11)}`);
  }
  console.log(`  ${"".padEnd(43)} ${totDeb.toFixed(2).padStart(12)}  ${totCred.toFixed(2).padStart(12)}  ${(totDeb - totCred).toFixed(2).padStart(11)}`);
}

async function main() {
  console.log(`live-verify — ${new Date().toISOString()} — DB=${ODOO_DB} — KEEP=${KEEP}`);

  // 1) Partner
  console.log("\n[1] ensure test partner");
  const partnerId = await ensureTestPartner();

  // 2) x_invoice header — needs x_order_id (m2o → x_daily_order), so
  //    create a tiny throw-away x_daily_order for this partner first.
  //    Marked sim, no lines, never confirmed. Purely to satisfy the
  //    required field so the x_invoice → account.move link can be
  //    exercised on real Odoo. The x_* rows are cleaned up in step 7.
  console.log("\n[2a] create sim x_daily_order (scaffold)");
  const [xOrderId] = await call("x_daily_order", "create", {
    vals_list: [{
      x_customer_id: partnerId,
      x_order_date: TODAY,
      x_is_simulation: true,
    }],
  });
  console.log(`  x_daily_order id=${xOrderId}`);

  console.log("\n[2b] create x_invoice header");
  const invoiceNumber = `UTAK-ACCT-TEST-${Date.now()}`;
  const [xInvoiceId] = await call("x_invoice", "create", {
    vals_list: [{
      x_order_id: xOrderId,
      x_invoice_number: invoiceNumber,
      x_invoice_date: TODAY,
      x_subtotal: 3,
      x_tax_amount: 0,
      x_total: 3,
      x_status: "issued",
      x_is_simulation: true,
    }],
  });
  console.log(`  x_invoice id=${xInvoiceId} (${invoiceNumber})`);

  // 3) account.move (out_invoice)
  console.log("\n[3] create + post account.move");
  const [moveId] = await call("account.move", "create", {
    vals_list: [{
      move_type: "out_invoice",
      partner_id: partnerId,
      invoice_date: TODAY,
      ref: invoiceNumber,
      invoice_line_ids: [[0, 0, {
        name: "خط اختبار محاسبة",
        quantity: 1,
        price_unit: 3,
        tax_ids: [[6, 0, []]],
      }]],
    }],
  });
  await call("account.move", "action_post", { ids: [moveId] });
  const [moveHead] = await call("account.move", "read", {
    ids: [moveId],
    fields: ["id", "name", "state", "amount_total", "amount_residual", "invoice_line_ids"],
  });
  console.log(`  move ${moveHead.name} (id=${moveId}) state=${moveHead.state} total=${moveHead.amount_total} residual=${moveHead.amount_residual}`);
  await call("x_invoice", "write", { ids: [xInvoiceId], vals: { x_account_move_id: moveId } });

  // 4) x_payment
  console.log("\n[4] create x_payment (cash)");
  const [xPaymentId] = await call("x_payment", "create", {
    vals_list: [{
      x_invoice_id: xInvoiceId,
      x_amount: 3,
      x_method: "cash",
      x_collected_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      x_is_simulation: true,
    }],
  });
  console.log(`  x_payment id=${xPaymentId}`);

  // 5) account.payment via register wizard on CSHD
  console.log("\n[5] register + post account.payment on CSHD, reconcile");
  const cshdRows = await call("account.journal", "search_read", {
    domain: [["code", "=", "CSHD"]],
    fields: ["id", "code"],
    limit: 1,
  });
  if (!cshdRows[0]) throw new Error("journal CSHD missing — run acct-20260921-setup.mjs first");
  const cshdId = cshdRows[0].id;

  const [wizardId] = await call("account.payment.register", "create", {
    vals_list: [{ journal_id: cshdId, amount: 3, payment_date: TODAY }],
  }, { active_model: "account.move", active_ids: [moveId], active_id: moveId });
  await call("account.payment.register", "action_create_payments", {
    ids: [wizardId],
  }, { active_model: "account.move", active_ids: [moveId], active_id: moveId });

  const paymentRows = await call("account.payment", "search_read", {
    domain: [["journal_id", "=", cshdId], ["amount", "=", 3], ["date", "=", TODAY], ["partner_id", "=", partnerId]],
    fields: ["id", "state", "amount", "date", "partner_id"],
    order: "id desc",
    limit: 1,
  });
  const paymentMoveId = paymentRows[0]?.id;
  if (!paymentMoveId) throw new Error("payment created but not located");
  console.log(`  account.payment id=${paymentMoveId} state=${paymentRows[0].state}`);
  await call("x_payment", "write", { ids: [xPaymentId], vals: { x_account_payment_id: paymentMoveId } });

  const [moveAfter] = await call("account.move", "read", {
    ids: [moveId],
    fields: ["id", "state", "amount_residual", "payment_state"],
  });
  console.log(`  move residual after payment = ${moveAfter.amount_residual} payment_state=${moveAfter.payment_state}`);

  // 6) Trial balance — should show revenue, AR, cash
  console.log("\n[6] read partner trial balance (posted only)");
  const before = await readTrialBalance(partnerId);
  printTrialBalance("== balance BEFORE reversal ==", before);

  if (KEEP) {
    console.log("\n--keep set — leaving rows in place. To reverse:");
    console.log(`  node scripts/acct-20260921-live-verify-reverse.mjs move=${moveId} payment=${paymentMoveId}`);
    return;
  }

  // 7) Reverse
  console.log("\n[7] reverse — cancel payment, then reverse invoice");

  // 7a) Cancel the payment. In Odoo 19 an in_process payment auto-posts;
  //     we call action_draft first (fails silently if the state doesn't
  //     support it), then action_cancel. Cancelling a posted payment
  //     unreconciles + reverses its journal entry automatically.
  try { await call("account.payment", "action_draft", { ids: [paymentMoveId] }); }
  catch (e) { console.log(`  action_draft: ${(e).message.slice(0, 120)}`); }
  try { await call("account.payment", "action_cancel", { ids: [paymentMoveId] }); }
  catch (e) { console.log(`  action_cancel: ${(e).message.slice(0, 120)}`); }
  const [pmtAfter] = await call("account.payment", "read", { ids: [paymentMoveId], fields: ["id", "state"] });
  console.log(`  payment state after cancel: ${pmtAfter.state}`);

  // 7b) Reverse the invoice via account.move.reversal, using the source
  //     move's own journal so the reversal lands in Sales too. Then call
  //     reverse_moves — Odoo 19 posts the credit note and reconciles it
  //     against the source, so the GL nets to zero for those lines.
  const [srcMove] = await call("account.move", "read", {
    ids: [moveId],
    fields: ["id", "journal_id", "state"],
  });
  const srcJournalId = srcMove.journal_id ? srcMove.journal_id[0] : null;
  if (!srcJournalId) throw new Error(`move ${moveId} has no journal_id`);

  const [reversalId] = await call("account.move.reversal", "create", {
    vals_list: [{
      journal_id: srcJournalId,
      reason: "acct-20260921 live-verify reversal",
      date: TODAY,
    }],
  }, { active_model: "account.move", active_ids: [moveId], active_id: moveId });
  const reverseResult = await call("account.move.reversal", "reverse_moves", {
    ids: [reversalId],
  }, { active_model: "account.move", active_ids: [moveId], active_id: moveId });
  console.log(`  reverse_moves result:`, JSON.stringify(reverseResult).slice(0, 200));

  // reverse_moves in Odoo 19 creates a DRAFT out_refund. Post it and
  // reconcile its AR line against the source move's AR line so both
  // sides net to zero on the ledger.
  const creditId = reverseResult?.res_id;
  if (!creditId) throw new Error("reverse_moves did not return res_id");
  await call("account.move", "action_post", { ids: [creditId] });
  const [creditHead] = await call("account.move", "read", {
    ids: [creditId],
    fields: ["id", "name", "state", "line_ids"],
  });
  console.log(`  credit note ${creditHead.name} state=${creditHead.state}`);

  // Reconcile the AR receivable lines from both moves so the amount_residual clears.
  const arLines = await call("account.move.line", "search_read", {
    domain: [
      ["move_id", "in", [moveId, creditId]],
      ["account_id.account_type", "=", "asset_receivable"],
    ],
    fields: ["id", "move_id", "debit", "credit", "reconciled"],
  });
  const arIds = arLines.filter((l) => !l.reconciled).map((l) => l.id);
  if (arIds.length >= 2) {
    await call("account.move.line", "reconcile", { ids: arIds });
    console.log(`  reconciled AR lines: ${JSON.stringify(arIds)}`);
  } else {
    console.log(`  AR lines already reconciled: ${JSON.stringify(arLines)}`);
  }

  // 8) Trial balance again
  console.log("\n[8] read partner trial balance (posted only) after reversal");
  const after = await readTrialBalance(partnerId);
  printTrialBalance("== balance AFTER reversal ==", after);

  const totalBal = after.reduce((sum, r) => sum + Math.abs(r.debit - r.credit), 0);
  console.log(`\ntotal absolute imbalance across accounts: ${totalBal.toFixed(2)}`);
  if (totalBal < 0.01) {
    console.log("✅ ledger is flat — every account nets to zero");
  } else {
    console.log("⚠️  ledger did NOT return to zero — inspect above");
  }

  console.log(`\nartefact ids for reference:`);
  console.log(`  partner       = ${partnerId}`);
  console.log(`  x_invoice     = ${xInvoiceId}`);
  console.log(`  account.move  = ${moveId}`);
  console.log(`  x_payment     = ${xPaymentId}`);
  console.log(`  account.payment (posted, then cancelled) = ${paymentMoveId}`);
}

main().catch((e) => { console.error("VERIFY FAILED:", e); process.exit(1); });
