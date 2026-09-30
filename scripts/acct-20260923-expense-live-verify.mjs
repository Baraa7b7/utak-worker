// UTAK — expenses + payroll live verification, 2026-09-23.
//
// Shared tenant with prod: every posted line here is real, so everything is
// reversed at the end and the global posted ledger must be back to baseline.
// No WhatsApp: this script never calls graph.facebook.com, and the test
// partners carry no number, no role and x_wa_allowed=false.
//
//   م  payroll entry for two fake employees (60 + 40) via
//      scripts/payroll-monthly-entry.mjs --test-partners
//      → 400003 +100, 201004 −100, nothing else
//   ن  expense bill 50 from an unregistered vendor on 400077 Fuel, journal EXP
//      → 400077 +50, 201002 −50, no tax line
//   س  payroll twice for the same month (same tag) → exactly one entry
//
// Then: reverse every entry (same-date reversal, payable reconciled), check
// the ledger delta vs baseline is empty, archive the test partners.
// Report: scripts/artifacts/acct-20260923-expense-live-verify-<ts>.json
//
// Requires .env.sim-verify.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_API_KEY } = env;
async function call(model, method, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ODOO_API_KEY}` },
      body: JSON.stringify(body),
    });
    const t = await res.text();
    if (res.status === 429 && attempt < 6) {
      const wait = 2000 * 2 ** Math.min(attempt, 4);
      console.log(`  … 429 on ${model}.${method}, retry in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${model}.${method} HTTP ${res.status}: ${t.slice(0, 400)}`);
    return JSON.parse(t);
  }
}

const TODAY = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);
const RUN = String(Date.now()).slice(-6);
const report = { started_at: new Date().toISOString(), riyadh_today: TODAY, run: RUN, cycles: {}, created: { partners: [], moves: [], refunds: [] } };
let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
  return cond;
}

async function globalBalances() {
  const lines = await call("account.move.line", "search_read", {
    domain: [["parent_state", "=", "posted"]], fields: ["account_id", "debit", "credit"], limit: 5000,
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
function sameDelta(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) >= 0.005) return false;
  return true;
}

async function testPartner(name, vals = {}) {
  const [id] = await call("res.partner", "create", {
    vals_list: [{ name, x_is_simulation: true, x_wa_allowed: false, ...vals }],
  });
  report.created.partners.push(id);
  return id;
}

function runPayroll(partnerIds, tag) {
  const out = execFileSync("node", [
    new URL("./payroll-monthly-entry.mjs", import.meta.url).pathname, MONTH,
    `--test-partners=${partnerIds.join(",")}`, `--tag=${tag}`,
  ], { env: { ...process.env, PAYROLL_JSON: "1" }, encoding: "utf8" });
  process.stdout.write(out.split("\n").map((l) => `    | ${l}`).join("\n") + "\n");
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  return JSON.parse(line.slice(7));
}

async function moveLines(moveId) {
  return call("account.move.line", "search_read", {
    domain: [["move_id", "=", moveId]], fields: ["account_id", "debit", "credit", "tax_line_id", "display_type", "name", "partner_id"],
  });
}

async function cycleM(emps) {
  console.log("\n=== م: payroll 60 + 40 ===");
  const before = await globalBalances();
  const r = runPayroll(emps, `m${RUN}`);
  check("entry created", r.status === "created", JSON.stringify(r));
  if (r.move_id) report.created.moves.push(r.move_id);
  const d = delta(before, await globalBalances());
  const expected = { "400003": 100, "201004": -100 };
  check("400003 +100 / 201004 −100, no third account", sameDelta(d, expected), JSON.stringify(d));
  const [m] = await call("account.move", "read", { ids: [r.move_id], fields: ["name", "date", "journal_id", "ref", "state", "move_type"] });
  const ml = await moveLines(r.move_id);
  check("posted entry in EXP, dated today", m.state === "posted" && m.move_type === "entry" && m.journal_id[1].startsWith("المصاريف") && m.date === TODAY, `${m.name} ${m.journal_id[1]} ${m.date}`);
  check("one debit line per employee + one credit", ml.filter((l) => l.debit > 0).length === 2 && ml.filter((l) => l.credit > 0).length === 1);
  report.cycles["م"] = { expected, actual: d, move: m, lines: ml };
}

async function cycleN() {
  console.log("\n=== ن: expense bill 50 on 400077 Fuel, unregistered vendor ===");
  const vendor = await testPartner(`SIM-TEST مورد وقود غير مسجل ${RUN}`, { is_company: true, supplier_rank: 1 });
  const [fuel] = await call("account.account", "search_read", { domain: [["code", "=", "400077"]], fields: ["id"], limit: 1 });
  const [journal] = await call("account.journal", "search_read", { domain: [["code", "=", "EXP"]], fields: ["id"], limit: 1 });
  const before = await globalBalances();
  const [billId] = await call("account.move", "create", {
    vals_list: [{
      move_type: "in_invoice", journal_id: journal.id, partner_id: vendor, invoice_date: TODAY,
      ref: `SIM-TEST expense ن ${RUN}`,
      invoice_line_ids: [[0, 0, { name: "وقود (اختبار)", account_id: fuel.id, quantity: 1, price_unit: 50 }]],
    }],
  });
  report.created.moves.push(billId);
  // What Odoo pre-fills on a line typed without a tax (as in the UI):
  const [line] = await call("account.move.line", "search_read", {
    domain: [["move_id", "=", billId], ["display_type", "=", "product"]], fields: ["id", "tax_ids"],
  });
  const defaultTaxes = line.tax_ids.length
    ? await call("account.tax", "read", { ids: line.tax_ids, fields: ["name", "amount", "price_include"] }) : [];
  console.log(`  default tax Odoo put on the line: ${JSON.stringify(defaultTaxes.map((t) => t.name))}`);
  report.cycles["ن_default_tax"] = defaultTaxes;
  // No tax invoice → no input tax: clear it, as docs/EXPENSES.md tells Baraa to.
  await call("account.move", "write", { ids: [billId], vals: { invoice_line_ids: [[1, line.id, { tax_ids: [[6, 0, []]] }]] } });
  await call("account.move", "action_post", { ids: [billId] });
  const d = delta(before, await globalBalances());
  const expected = { "400077": 50, "201002": -50 };
  check("400077 +50 / 201002 −50", sameDelta(d, expected), JSON.stringify(d));
  const ml = await moveLines(billId);
  check("no tax line", !ml.some((l) => l.tax_line_id || l.display_type === "tax"));
  const [m] = await call("account.move", "read", { ids: [billId], fields: ["name", "state", "amount_tax", "amount_total", "journal_id"] });
  check("posted, tax 0, total 50", m.state === "posted" && m.amount_tax === 0 && m.amount_total === 50, `${m.name} tax ${m.amount_tax}`);
  report.cycles["ن"] = { expected, actual: d, move: m, lines: ml };
}

async function cycleS(emps) {
  console.log("\n=== س: payroll twice, same month ===");
  const tag = `s${RUN}`;
  const before = await globalBalances();
  const r1 = runPayroll(emps, tag);
  const r2 = runPayroll(emps, tag);
  if (r1.move_id) report.created.moves.push(r1.move_id);
  check("first run created", r1.status === "created");
  check("second run: exists, nothing created", r2.status === "exists" && r2.move_id === r1.move_id, JSON.stringify(r2));
  const same = await call("account.move", "search_count", { domain: [["ref", "=", `SIM-TEST-${tag}-UTAK-PAYROLL-${MONTH}`]] });
  check("exactly one entry with the ref", same === 1, String(same));
  const d = delta(before, await globalBalances());
  check("ledger moved once: 400003 +100 / 201004 −100", sameDelta(d, { "400003": 100, "201004": -100 }), JSON.stringify(d));
  report.cycles["س"] = { runs: [r1, r2], entries_with_ref: same, actual: d };
}

async function reverseAll() {
  console.log("\n=== Reverse everything ===");
  for (const id of report.created.moves) {
    const [src] = await call("account.move", "read", { ids: [id], fields: ["journal_id", "payment_state", "state", "date", "name", "move_type"] });
    if (src.state !== "posted" || src.payment_state === "reversed") { console.log(`  ${id} ${src.name}: ${src.state}/${src.payment_state} — skip`); continue; }
    const ctx = { active_model: "account.move", active_ids: [id], active_id: id };
    const [revId] = await call("account.move.reversal", "create", {
      vals_list: [{ journal_id: src.journal_id[0], reason: "acct-20260923 expense live-verify reversal", date: src.date }],
      context: ctx,
    });
    const res = await call("account.move.reversal", "reverse_moves", { ids: [revId], context: ctx });
    const refundId = res?.res_id;
    if (!refundId) throw new Error(`reverse_moves returned no res_id for ${id}`);
    const [cn] = await call("account.move", "read", { ids: [refundId], fields: ["state"] });
    if (cn.state === "draft") await call("account.move", "action_post", { ids: [refundId] });
    const ap = await call("account.move.line", "search_read", {
      domain: [["move_id", "in", [id, refundId]], ["account_id.account_type", "=", "liability_payable"], ["reconciled", "=", false]],
      fields: ["id"],
    });
    if (ap.length >= 2) await call("account.move.line", "reconcile", { ids: ap.map((l) => l.id) });
    report.created.refunds.push(refundId);
    const [c] = await call("account.move", "read", { ids: [refundId], fields: ["name", "date"] });
    console.log(`  ${id} ${src.name} → reversal ${refundId} ${c.name} (${c.date})`);
  }
}

async function main() {
  console.log(`expense live-verify — ${new Date().toISOString()} — Riyadh day ${TODAY}, run ${RUN}`);
  const baseline = await globalBalances();
  report.baseline = baseline;
  console.log(`  baseline (global posted): ${JSON.stringify(baseline)}`);
  let err = null;
  try {
    const e1 = await testPartner(`SIM-TEST موظف أ ${RUN}`, { x_monthly_salary: 60 });
    const e2 = await testPartner(`SIM-TEST موظف ب ${RUN}`, { x_monthly_salary: 40 });
    await cycleM([e1, e2]);
    await cycleN();
    await cycleS([e1, e2]);
  } catch (e) { err = e; console.error(`CYCLE ERROR: ${e.message}`); failures++; }
  report.before_reversal = delta(baseline, await globalBalances());
  console.log(`\n  ledger before reversal vs baseline: ${JSON.stringify(report.before_reversal)}`);
  await reverseAll();
  const after = await globalBalances();
  report.after_reversal = delta(baseline, after);
  check("after reversal: ledger back to baseline", Object.keys(report.after_reversal).length === 0, JSON.stringify(report.after_reversal));
  report.global_after = Object.fromEntries(Object.entries(after).filter(([, v]) => Math.abs(v) >= 0.005));
  console.log(`  global posted ledger after reversal (non-zero): ${JSON.stringify(report.global_after)}`);
  console.log("\n=== Cleanup ===");
  if (report.created.partners.length) {
    await call("res.partner", "write", { ids: report.created.partners, vals: { active: false } });
    console.log(`  test partners ${report.created.partners.join(",")} archived`);
  }
  report.failures = failures;
  report.error = err?.message ?? null;
  const out = new URL(`./artifacts/acct-20260923-expense-live-verify-${Date.now()}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`\n${failures ? `✗ ${failures} failure(s)` : "✓ all checks passed"} — report ${out.pathname}`);
  process.exit(failures ? 1 : 0);
}
await main();
