// UTAK — fix the collection entry: set payment_account_id on the payment
// method lines of CSHD and BNK1, 2026-09-23.
//
// Why: with payment_account_id empty, Odoo 19 registers a payment WITHOUT a
// journal entry (move_id = false). That is exactly what PAY00001..00004
// show (canceled, no move). docs/STATUS.md § 2.
//
// Target mapping (never an income / expense account — the script refuses):
//   CSHD (19) inbound  line 5 → 101007 كاش السائق        (id 257, asset_cash)
//   CSHD (19) outbound line 6 → 101007 كاش السائق        (id 257, asset_cash)
//   BNK1 (13) inbound  line 3 → 101003 Outstanding Receipts (id 254, asset_current, reconcile)
//   BNK1 (13) outbound line 4 → 101004 Outstanding Payments (id 255, asset_current, reconcile)
// BNK1 uses the standard sa-chart Outstanding accounts so a transfer sits in
// 101003/101004 until the bank statement reconciles it into 101001.
// Outbound lines are fixed with the same logic now, ready for vendor bills.
//
// Idempotent: lines already on the target account are left alone.
// Rollback: the previous values are written to
//   scripts/artifacts/acct-20260923-payment-fix-rollback.json
// on the first run (never overwritten). Restore with:
//   node scripts/acct-20260923-payment-fix.mjs --rollback
//
// Requires .env.sim-verify. Writes only account.payment.method.line.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_API_KEY } = env;
async function call(model, method, body) {
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ODOO_API_KEY}` },
    body: JSON.stringify(body),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${model}.${method} HTTP ${res.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

const ROLLBACK = new URL("./artifacts/acct-20260923-payment-fix-rollback.json", import.meta.url);
const ALLOWED_TYPES = new Set(["asset_cash", "asset_current"]);

// journal code → { inbound: account code, outbound: account code }
const PLAN = {
  CSHD: { inbound: "101007", outbound: "101007" },
  BNK1: { inbound: "101003", outbound: "101004" },
};

async function accountByCode(code) {
  const [a] = await call("account.account", "search_read", {
    domain: [["code", "=", code]],
    fields: ["id", "code", "name", "account_type", "reconcile"],
    limit: 1,
  });
  if (!a) throw new Error(`account ${code} not found`);
  if (!ALLOWED_TYPES.has(a.account_type)) {
    throw new Error(`account ${code} is ${a.account_type} — refusing (only asset_cash / asset_current allowed)`);
  }
  return a;
}

async function readLines() {
  const journals = await call("account.journal", "search_read", {
    domain: [["code", "in", Object.keys(PLAN)]],
    fields: ["id", "code", "default_account_id"],
  });
  const lines = await call("account.payment.method.line", "search_read", {
    domain: [["journal_id", "in", journals.map((j) => j.id)]],
    fields: ["id", "name", "journal_id", "payment_type", "payment_account_id"],
    order: "id",
  });
  const codeById = new Map(journals.map((j) => [j.id, j.code]));
  return lines.map((l) => ({ ...l, journal_code: codeById.get(l.journal_id[0]) }));
}

async function main() {
  const mode = process.argv.includes("--rollback") ? "rollback" : "apply";
  console.log(`acct-20260923-payment-fix — ${new Date().toISOString()} — mode=${mode}`);
  const lines = await readLines();

  if (mode === "rollback") {
    if (!existsSync(ROLLBACK)) throw new Error("no rollback file — nothing to restore");
    const snap = JSON.parse(readFileSync(ROLLBACK, "utf8"));
    for (const s of snap.lines) {
      const prev = s.payment_account_id ? s.payment_account_id[0] : false;
      await call("account.payment.method.line", "write", { ids: [s.id], vals: { payment_account_id: prev } });
      console.log(`  restored line ${s.id} (${s.journal_code} ${s.payment_type}) → ${prev === false ? "empty" : prev}`);
    }
    return;
  }

  if (!existsSync(ROLLBACK)) {
    writeFileSync(ROLLBACK, JSON.stringify({ taken_at: new Date().toISOString(), lines }, null, 2));
    console.log(`  snapshot → ${ROLLBACK.pathname}`);
  } else {
    console.log("  snapshot exists — kept (first-run values)");
  }

  for (const l of lines) {
    const target = PLAN[l.journal_code]?.[l.payment_type];
    if (!target) { console.log(`  line ${l.id} ${l.journal_code} ${l.payment_type}: no plan — skip`); continue; }
    const acc = await accountByCode(target);
    const cur = l.payment_account_id ? l.payment_account_id[0] : null;
    if (cur === acc.id) {
      console.log(`  line ${l.id} ${l.journal_code} ${l.payment_type}: already ${acc.code} — skip`);
      continue;
    }
    await call("account.payment.method.line", "write", { ids: [l.id], vals: { payment_account_id: acc.id } });
    console.log(`  line ${l.id} ${l.journal_code} ${l.payment_type}: ${cur ?? "empty"} → ${acc.code} ${acc.name} (${acc.account_type})`);
  }

  // Verify
  const after = await readLines();
  let ok = true;
  for (const l of after) {
    const target = PLAN[l.journal_code]?.[l.payment_type];
    const got = l.payment_account_id ? l.payment_account_id[1] : "empty";
    const good = target && l.payment_account_id && String(l.payment_account_id[1]).startsWith(target);
    if (!good) ok = false;
    console.log(`  verify line ${l.id} ${l.journal_code} ${l.payment_type}: ${got} ${good ? "✓" : "✗"}`);
  }
  if (!ok) { console.error("VERIFY FAILED"); process.exit(1); }
  console.log("✅ all payment method lines point at the planned asset accounts");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
