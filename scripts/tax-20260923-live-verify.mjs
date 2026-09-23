// UTAK — live VAT verification with EXPLICIT expectations, 2026-09-23.
// Same method as scripts/acct-20260921-live-verify.mjs: runs the REAL
// syncInvoiceToAccounting from src/accounting.ts (tax resolved from Odoo,
// price-included split, tax-line guard) and measures deltas on the GLOBAL
// posted ledger, so any unexpected account anywhere fails.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/tax-20260923-live-verify.mjs
//
// Safety:
//   • NO WhatsApp: any request to graph.facebook.com throws, env has no
//     OWNER_WHATSAPP (sendOwnerAlert returns before sending).
//   • Test partner 48 «اختبار محاسبة» only; x_* scaffold rows x_is_simulation=true.
//   • Default = reverse everything (credit notes dated like their invoice so
//     every VAT period nets to zero) and prove the ledger is back to baseline.
//
//   Cycle D: invoice dated 2026-10-05 (override: --d-date=YYYY-MM-DD), 1 × 115
//            tax-included
//            AR 102011 +115 · revenue 500001 −100 · VAT output 201017 −15
//            (debit − credit: the liability grows by a 15 credit) · nothing else
//     Odoo l10n_sa refuses to POST an invoice dated after today (Riyadh):
//     "ZATCA does not allow future-dated invoices". So while the D date is in
//     the future the script runs the SAME real code, expects Odoo's refusal,
//     proves the Worker cancels the draft and does not link it, and measures
//     the split on that move's own lines (posted ledger must not move). From
//     2026-10-01 run it with --d-date=<today> for the fully posted cycle.
//   Cycle E: invoice dated 2026-09-30, 1 × 50
//            AR 102011 +50 · revenue 500001 −50 · no tax line
//     2026-09-30 is also after today (2026-09-23), so the same refusal applies:
//     E is measured on its own (cancelled) lines, and E′ repeats it dated
//     today (also before the cutoff) fully posted, then reversed.
//   PDF:     the cycle-D move rendered through the real invoice template →
//            scripts/artifacts/tax-20260923-invoice-after-cutoff.pdf
//
// Exit code 1 on ANY mismatch.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  syncInvoiceToAccounting,
  computeInclusiveTotals,
  todayRiyadhYmd,
} from "../src/accounting.ts";
import { buildInvoicePDFDataFromAccountMove, generateInvoicePDF, renderInvoiceHTML } from "../src/invoice.ts";
import { readCompanyInfo } from "../src/company.ts";
import { call as workerCall } from "../src/odoo.ts";

// ---- hard block on any Meta traffic ----
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error(`BLOCKED WhatsApp request in tax live-verify: ${url}`);
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
const fileEnv = { ...readEnvFile("../.env.zatca-oneoff"), ...readEnvFile("../.env.sim-verify") };
const env = {
  ODOO_URL: fileEnv.ODOO_URL,
  ODOO_DB: fileEnv.ODOO_DB,
  ODOO_LOGIN: fileEnv.ODOO_LOGIN,
  ODOO_API_KEY: fileEnv.ODOO_API_KEY,
  GOTENBERG_URL: fileEnv.GOTENBERG_URL,
  GOTENBERG_USER: fileEnv.GOTENBERG_USER,
  GOTENBERG_PASSWORD: fileEnv.GOTENBERG_PASSWORD,
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

const TEST_PARTNER_ID = 48;
const PRODUCT_TMPL_ID = 105; // افوكادو — active for sale, carries tax 5
const PDF_OUT = new URL("./artifacts/tax-20260923-invoice-after-cutoff.pdf", import.meta.url);
const report = { started_at: new Date().toISOString(), riyadh_today: todayRiyadhYmd(), cycles: {}, created: { invoices: [], x_orders: [], x_invoices: [], credit_notes: [] } };
let failures = 0;

const origError = console.error;
const accountingErrors = [];
console.error = (...a) => { const s = a.map(String).join(" "); if (s.includes("[accounting]")) accountingErrors.push(s); origError(...a); };

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

async function invoiceFor({ date, gross, tag, expectRefusal = false }) {
  const split = computeInclusiveTotals([gross], date >= "2026-10-01" ? 15 : null);
  const [xOrderId] = await call("x_daily_order", "create", {
    vals_list: [{ x_customer_id: TEST_PARTNER_ID, x_order_date: date, x_is_simulation: true }],
  });
  const number = `UTAK-VAT-${tag}-${Date.now()}`;
  const [xInvoiceId] = await call("x_invoice", "create", {
    vals_list: [{
      x_order_id: xOrderId, x_invoice_number: number, x_invoice_date: date,
      x_subtotal: split.subtotal, x_tax_amount: split.tax, x_total: split.total, x_status: "issued", x_is_simulation: true,
    }],
  });
  report.created.x_orders.push(xOrderId);
  report.created.x_invoices.push(xInvoiceId);
  const errsBefore = accountingErrors.length;
  const moveId = await syncInvoiceToAccounting(env, {
    invoiceId: xInvoiceId,
    existingMoveId: null,
    invoiceNumber: number,
    customerPartnerId: TEST_PARTNER_ID,
    invoiceDate: date,
    lines: [{ product_tmpl_id: PRODUCT_TMPL_ID, description: `افوكادو — اختبار ضريبة ${tag}`, quantity: 1, price_unit: gross }],
    expectedTotal: split.total,
  });
  if (expectRefusal) {
    const errs = accountingErrors.slice(errsBefore).join(" | ");
    check(`${tag}: sync returned null (Odoo refused to post a future date)`, moveId === null && errs.includes("future-dated"), errs.slice(0, 200));
    const [m] = await call("account.move", "search_read", { domain: [["ref", "=", number]], fields: ["id", "state", "name"], limit: 1 });
    check(`${tag}: the refused draft was cancelled by the Worker (no orphan)`, m?.state === "cancel", JSON.stringify(m));
    const [link] = await call("x_invoice", "read", { ids: [xInvoiceId], fields: ["x_account_move_id"] });
    check(`${tag}: x_invoice ${xInvoiceId} NOT linked`, !link?.x_account_move_id);
    report.created.cancelled_drafts = [...(report.created.cancelled_drafts ?? []), m?.id];
    return { xInvoiceId, moveId: m?.id ?? null, number, split, posted: false };
  }
  if (!moveId) throw new Error(`syncInvoiceToAccounting returned null for ${tag}: ${accountingErrors.slice(errsBefore).join(" | ") || "?"}`);
  report.created.invoices.push(moveId);
  const [link] = await call("x_invoice", "read", { ids: [xInvoiceId], fields: ["x_account_move_id"] });
  check(`${tag}: x_invoice ${xInvoiceId} linked to move ${moveId}`, link?.x_account_move_id?.[0] === moveId);
  return { xInvoiceId, moveId, number, split, posted: true };
}

/** Move-level delta (debit − credit per account code) from a move's own lines. */
function moveDelta(lines) {
  const d = {};
  for (const l of lines) {
    const code = String(l.account_id?.[1] ?? "?").split(" ")[0];
    d[code] = Math.round(((d[code] ?? 0) + (l.debit ?? 0) - (l.credit ?? 0)) * 100) / 100;
  }
  return Object.fromEntries(Object.entries(d).filter(([, v]) => Math.abs(v) >= 0.005));
}

async function moveFacts(moveId) {
  const [m] = await call("account.move", "read", {
    ids: [moveId],
    fields: ["name", "state", "invoice_date", "date", "amount_untaxed", "amount_tax", "amount_total", "payment_state"],
  });
  const lines = await call("account.move.line", "search_read", {
    domain: [["move_id", "=", moveId]],
    fields: ["account_id", "debit", "credit", "display_type", "tax_line_id", "tax_ids", "price_unit", "price_subtotal", "price_total"],
  });
  return { ...m, lines };
}

const D_DATE = (process.argv.find((a) => a.startsWith("--d-date=")) ?? "--d-date=2026-10-05").split("=")[1];

async function cycleD() {
  const future = D_DATE > report.riyadh_today;
  console.log(`\n=== Cycle D — invoice dated ${D_DATE}, 115 tax-included (${future ? "future date → Odoo refuses to post" : "posted"}) ===`);
  const before = await globalBalances();
  const inv = await invoiceFor({ date: D_DATE, gross: 115, tag: "D", expectRefusal: future });
  const after = await globalBalances();
  if (!inv.moveId) throw new Error("cycle D: no move found");
  const m = await moveFacts(inv.moveId);
  const taxLines = m.lines.filter((l) => l.display_type === "tax" || l.tax_line_id);
  const product = m.lines.find((l) => l.display_type === "product");
  console.log(`  move ${m.id} ${m.name || "(no number)"} ${m.state} date=${m.invoice_date} untaxed=${m.amount_untaxed} tax=${m.amount_tax} total=${m.amount_total}`);
  check(`D: ${future ? "cancelled draft" : "posted"}, dated ${D_DATE}`, m.state === (future ? "cancel" : "posted") && m.invoice_date === D_DATE);
  check("D: amount_untaxed 100 / amount_tax 15 / amount_total 115", m.amount_untaxed === 100 && m.amount_tax === 15 && m.amount_total === 115, `${m.amount_untaxed}/${m.amount_tax}/${m.amount_total}`);
  check("D: product line price_unit 115 (gross), subtotal 100, total 115", product?.price_unit === 115 && product?.price_subtotal === 100 && product?.price_total === 115, JSON.stringify(product && { pu: product.price_unit, ps: product.price_subtotal, pt: product.price_total }));
  check("D: exactly one tax line, credit 15 on 201017", taxLines.length === 1 && taxLines[0].credit === 15 && String(taxLines[0].account_id?.[1]).startsWith("201017"), JSON.stringify(taxLines.map((l) => [l.account_id?.[1], l.credit])));
  check("D: x_invoice split = 100 + 15", inv.split.subtotal === 100 && inv.split.tax === 15 && inv.split.total === 115);
  const expected = { "102011": 115, "500001": -100, "201017": -15 };
  if (future) {
    const own = moveDelta(m.lines);
    expectDelta("D split on the move's own lines (what posting will book)", own, expected);
    expectDelta("D posted ledger (must not move — nothing was posted)", delta(before, after), {});
    report.cycles.D = { mode: "future-date: post refused by Odoo, draft cancelled", expected, actual_move_lines: own, posted_ledger_delta: delta(before, after), move: m };
  } else {
    const d = delta(before, after);
    expectDelta("D balance (before reversal)", d, expected);
    report.cycles.D = { mode: "posted", expected, actual: d, move: m };
  }
  return inv;
}

async function cycleE(date, tag) {
  const future = date > report.riyadh_today;
  console.log(`\n=== Cycle ${tag} — invoice dated ${date}, 50 (before the cutoff; ${future ? "future date → Odoo refuses to post" : "posted"}) ===`);
  const before = await globalBalances();
  const inv = await invoiceFor({ date, gross: 50, tag, expectRefusal: future });
  const after = await globalBalances();
  if (!inv.moveId) throw new Error(`cycle ${tag}: no move found`);
  const m = await moveFacts(inv.moveId);
  const taxLines = m.lines.filter((l) => l.display_type === "tax" || l.tax_line_id);
  const product = m.lines.find((l) => l.display_type === "product");
  console.log(`  move ${m.id} ${m.name || "(no number)"} ${m.state} date=${m.invoice_date} untaxed=${m.amount_untaxed} tax=${m.amount_tax} total=${m.amount_total}`);
  check(`${tag}: ${future ? "cancelled draft" : "posted"}, dated ${date}`, m.state === (future ? "cancel" : "posted") && m.invoice_date === date);
  check(`${tag}: amount_tax 0, total 50`, m.amount_tax === 0 && m.amount_total === 50, `${m.amount_tax}/${m.amount_total}`);
  check(`${tag}: no tax line`, taxLines.length === 0);
  check(`${tag}: product line carries no tax (tax_ids empty despite product default 5)`, !!product && product.tax_ids.length === 0, JSON.stringify(product?.tax_ids));
  check(`${tag}: x_invoice split = 50 + 0`, inv.split.subtotal === 50 && inv.split.tax === 0);
  const expected = { "102011": 50, "500001": -50 };
  if (future) {
    const own = moveDelta(m.lines);
    expectDelta(`${tag} split on the move's own lines (what posting will book)`, own, expected);
    expectDelta(`${tag} posted ledger (must not move — nothing was posted)`, delta(before, after), {});
    report.cycles[tag] = { mode: "future-date: post refused by Odoo, draft cancelled", expected, actual_move_lines: own, posted_ledger_delta: delta(before, after), move: m };
  } else {
    const d = delta(before, after);
    expectDelta(`${tag} balance (before reversal)`, d, expected);
    report.cycles[tag] = { mode: "posted", expected, actual: d, move: m };
  }
  return inv;
}

async function pdfForD(inv) {
  console.log("\n=== PDF — cycle D through the real invoice template ===");
  const data = await buildInvoicePDFDataFromAccountMove(env, inv.moveId);
  if (!data) throw new Error("buildInvoicePDFDataFromAccountMove returned null");
  // The refused draft never got an Odoo number; show the x_invoice number the
  // customer PDF carries (buildInvoicePDFDataFromOdoo uses it too).
  if (!inv.posted) data.invoiceNumber = inv.number;
  const company = await readCompanyInfo(env);
  const html = renderInvoiceHTML(data, company);
  check("PDF data: subtotal 100 / VAT 15 / total 115", data.subtotal === 100 && data.vatAmount === 15 && data.grandTotal === 115, `${data.subtotal}/${data.vatAmount}/${data.grandTotal}`);
  check("PDF data: line shown tax-included (115)", data.items.length === 1 && data.items[0].total === 115, JSON.stringify(data.items));
  check("HTML: فاتورة ضريبية", html.includes("فاتورة ضريبية"));
  check("HTML: الإجمالي قبل الضريبة / ضريبة القيمة المضافة / الإجمالي شامل الضريبة",
    html.includes("الإجمالي قبل الضريبة") && html.includes("ضريبة القيمة المضافة (١٥٪)") && html.includes("الإجمالي شامل الضريبة"));
  check(`HTML: seller VAT ${company.vat}`, !!company.vat && html.includes("الرقم الضريبي للمنشأة") && html.includes(company.vat));
  check("HTML: test partner has no VAT → no customer VAT row", !html.includes("الرقم الضريبي للعميل"));
  check("HTML: no ZATCA QR", !html.includes("ZATCA<br>QR"));
  if (!env.GOTENBERG_URL) { check("Gotenberg configured (.env.zatca-oneoff)", false); return; }
  const bytes = await generateInvoicePDF(data, env);
  writeFileSync(PDF_OUT, bytes);
  check(`PDF written (${bytes.byteLength} bytes)`, bytes.byteLength > 5000 && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF");
  report.pdf = PDF_OUT.pathname;
  console.log(`  PDF → ${PDF_OUT.pathname}`);
}

async function reverseAll() {
  console.log("\n=== Reverse everything ===");
  for (const moveId of report.created.invoices) {
    const [src] = await call("account.move", "read", { ids: [moveId], fields: ["journal_id", "payment_state", "state", "date"] });
    if (src.payment_state === "reversed" || src.state === "cancel") { console.log(`  invoice ${moveId} already ${src.payment_state || src.state}`); continue; }
    const ctx = { active_model: "account.move", active_ids: [moveId], active_id: moveId };
    // Same date as the invoice: the credit note lands in the same VAT period.
    const [revId] = await call("account.move.reversal", "create", {
      vals_list: [{ journal_id: src.journal_id[0], reason: "tax-20260923 live-verify reversal", date: src.date }],
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
    const [i] = await call("account.move", "read", { ids: [moveId], fields: ["name", "state", "payment_state"] });
    const [c] = await call("account.move", "read", { ids: [creditId], fields: ["name", "date", "amount_tax", "amount_total"] });
    console.log(`  invoice ${moveId} ${i.name} → credit note ${creditId} ${c.name} (${c.date}, tax ${c.amount_tax}, total ${c.amount_total}); invoice now ${i.state}/${i.payment_state}`);
  }
}

// --reverse-only invoices=31,32 — resume an interrupted reversal.
async function reverseOnly() {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`${k}=`)) ?? "").split("=")[1] ?? "";
  report.created.invoices = arg("invoices").split(",").map(Number).filter((n) => n > 0);
  await reverseAll();
  const after = await globalBalances();
  report.after_reversal = after;
  const nonZero = Object.fromEntries(Object.entries(after).filter(([, v]) => Math.abs(v) >= 0.005));
  expectDelta("After reversal (global posted ledger, every account)", nonZero, {});
  writeFileSync(new URL(`./artifacts/tax-20260923-live-verify-reverse-${Date.now()}.json`, import.meta.url), JSON.stringify({ ...report, failures }, null, 2));
  if (failures > 0) { console.log(`❌ REVERSAL CHECK FAILED — ${failures}`); process.exit(1); }
  console.log("✅ ledger back to zero");
}

async function main() {
  if (process.argv.includes("--reverse-only")) return reverseOnly();
  console.log(`tax live-verify — ${new Date().toISOString()} — Riyadh day ${report.riyadh_today}`);
  const [p48] = await call("res.partner", "read", { ids: [TEST_PARTNER_ID], fields: ["name", "x_is_simulation", "vat"] });
  if (!p48 || p48.name !== "اختبار محاسبة") throw new Error(`partner 48 is not the test partner: ${JSON.stringify(p48)}`);
  console.log(`  test partner 48 «${p48.name}» vat=${p48.vat || "(none)"}`);

  const baseline = await globalBalances();
  report.baseline = baseline;
  console.log(`  baseline (global posted): ${JSON.stringify(baseline)}`);

  let cycleError = null;
  try {
    const invD = await cycleD();
    await pdfForD(invD);
    await cycleE("2026-09-30", "E");
    await cycleE(report.riyadh_today, "E′");
  } catch (e) {
    cycleError = e;
    failures++;
    console.log(`\n✗ cycle aborted: ${e.message}`);
  }
  report.before_reversal = await globalBalances();

  await reverseAll();
  const after = await globalBalances();
  report.after_reversal = after;
  expectDelta("After reversal vs baseline (all accounts back to baseline)", delta(baseline, after), {});
  const nonZero = Object.fromEntries(Object.entries(after).filter(([, v]) => Math.abs(v) >= 0.005));
  console.log(`  global posted ledger after reversal: ${JSON.stringify(nonZero)}`);
  check("global posted ledger is zero on every account", Object.keys(nonZero).length === 0, JSON.stringify(nonZero));

  report.accounting_errors = accountingErrors;
  report.failures = failures;
  report.finished_at = new Date().toISOString();
  const out = new URL(`./artifacts/tax-20260923-live-verify-${Date.now()}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nreport → ${out.pathname}`);
  console.log(`created: ${JSON.stringify(report.created)}`);
  if (cycleError || failures > 0) {
    console.log(`\n❌ VERIFY FAILED — ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\n✅ VERIFY PASSED — cycles D and E matched expectations and the ledger is back to zero");
}

main().catch((e) => { origError("VERIFY CRASHED:", e); process.exit(1); });
