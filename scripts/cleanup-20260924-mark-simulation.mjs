// Mark September's two leftover test records as simulation (2026-09-24), so
// the month-close check (scripts/lib/acct-close-core.mjs, which skips
// x_is_simulation=true) is clean. Nothing is deleted; only x_is_simulation is
// written. Idempotent; the "before" is saved first.
//
//   node scripts/cleanup-20260924-mark-simulation.mjs [--dry-run]
//   node scripts/cleanup-20260924-mark-simulation.mjs --rollback [--dry-run]
//
//   x_purchase_list 3   2026-09-11, done, no supplier, no vendor bill
//   x_payment 3 and 4   100 cash each, 2026-09-11, on UTAK invoice 2 (test
//                       customer 8 «براء - عميل اختبار», archived), no payment
//
// Automations: the only base.automation on these models is
// «UTAK: Issue & Send Receipt» on x_payment, trigger on_create — a write does
// not fire it. graph.facebook.com is blocked anyway.
//
// Rollback file: scripts/artifacts/cleanup-20260924-mark-simulation-rollback.json

import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp from the mark-simulation script");
  return realFetch(input, init);
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ROLLBACK = args.includes("--rollback");
const RB_PATH = new URL("./artifacts/cleanup-20260924-mark-simulation-rollback.json", import.meta.url).pathname;
const log = (...a) => console.log(...a);

// Each target is checked against what the 09-24 month-close report named, so
// a reused id never gets marked by mistake.
const TARGETS = [
  { model: "x_purchase_list", id: 3, fields: ["x_status", "x_date", "x_supplier_id", "x_account_move_id", "x_is_simulation"],
    expect: (r) => r.x_date === "2026-09-11" && r.x_status === "done" && !r.x_supplier_id && !r.x_account_move_id },
  { model: "x_payment", id: 3, fields: ["x_amount", "x_method", "x_collected_at", "x_invoice_id", "x_account_payment_id", "x_is_simulation"],
    expect: (r) => r.x_amount === 100 && r.x_method === "cash" && String(r.x_collected_at).startsWith("2026-09-11") && r.x_invoice_id?.[0] === 2 && !r.x_account_payment_id },
  { model: "x_payment", id: 4, fields: ["x_amount", "x_method", "x_collected_at", "x_invoice_id", "x_account_payment_id", "x_is_simulation"],
    expect: (r) => r.x_amount === 100 && r.x_method === "cash" && String(r.x_collected_at).startsWith("2026-09-11") && r.x_invoice_id?.[0] === 2 && !r.x_account_payment_id },
];

const readRb = () => (existsSync(RB_PATH) ? JSON.parse(readFileSync(RB_PATH, "utf8")) : null);
const saveRb = (rb) => { if (!DRY) writeFileSync(RB_PATH, JSON.stringify(rb, null, 2) + "\n"); };
const read = async (t) => (await call(t.model, "read", { ids: [t.id], fields: t.fields }))[0];

async function setup() {
  const rows = [];
  for (const t of TARGETS) {
    const r = await read(t);
    if (!r) throw new Error(`${t.model} ${t.id} not found`);
    if (!t.expect(r)) throw new Error(`${t.model} ${t.id} is not the record named by the month close: ${JSON.stringify(r)}`);
    rows.push([t, r]);
  }
  let rb = readRb();
  if (!rb) rb = { script: "scripts/cleanup-20260924-mark-simulation.mjs", createdAt: new Date().toISOString(), before: rows.map(([t, r]) => ({ model: t.model, ...r })), wrote: [] };
  saveRb(rb); // before any write
  for (const [t, r] of rows) {
    log(`${t.model} ${t.id}: x_is_simulation ${r.x_is_simulation} → true${r.x_is_simulation ? " (already)" : ""}`);
    if (r.x_is_simulation || DRY) continue;
    await call(t.model, "write", { ids: [t.id], vals: { x_is_simulation: true } });
    rb.wrote.push({ model: t.model, id: t.id });
    saveRb(rb);
  }
  if (DRY) { log("dry-run: nothing written"); return; }
  for (const t of TARGETS) {
    const r = await read(t);
    if (r.x_is_simulation !== true) throw new Error(`verify failed: ${t.model} ${t.id}`);
  }
  log("verify ✓ all three are x_is_simulation=true; nothing deleted");
}

async function rollback() {
  const rb = readRb();
  if (!rb) throw new Error(`no rollback file ${RB_PATH}`);
  for (const b of rb.before) {
    log(`${b.model} ${b.id}: x_is_simulation ← ${b.x_is_simulation}`);
    if (!DRY) await call(b.model, "write", { ids: [b.id], vals: { x_is_simulation: b.x_is_simulation } });
  }
  log(DRY ? "dry-run: nothing written" : "rollback done");
}

await (ROLLBACK ? rollback() : setup());
