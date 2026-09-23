// UTAK — opening entry: paid-up capital 25,000 SAR deposited in the bank.
//
//   node scripts/acct-20260924-opening-capital.mjs [--dry-run]
//
// One posted journal entry in MISC, dated today (Asia/Riyadh — Odoo refuses a
// future date and the first deposit date is unknown):
//   Dr 101001 Bank (default account of BNK1, asset_cash)   25,000
//   Cr 300010 رأس المال المدفوع (equity)                    25,000
//
// Idempotent: ref = UTAK-OPENING-CAPITAL; any non-cancelled entry with that
// ref → nothing is created. Refused unless 300010 is equity and the BNK1
// account is asset_cash. After posting, a guard re-reads the entry (posted,
// two accounts, 25,000 each side) and cancels it if anything is off.
//
// This is a REAL entry (the Odoo tenant is shared with prod). It is not
// reversed. Snapshot: scripts/artifacts/acct-20260924-opening-capital.json
// (the state before + the created entry). Undoing it would be a reversal
// entry in Odoo by Baraa's explicit decision, never this script.
//
// Logic: scripts/lib/acct-close-core.mjs (tested in tests/acct-close.test.mts).

import { writeFileSync, existsSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { runOpening, todayRiyadh, OPENING_REF } from "./lib/acct-close-core.mjs";

const DRY = process.argv.includes("--dry-run");
const SNAP = new URL("./artifacts/acct-20260924-opening-capital.json", import.meta.url);

async function balanceSheet(asOf) {
  const accs = await call("account.account", "search_read", { domain: [], fields: ["id", "account_type"], context: { active_test: false } });
  const type = Object.fromEntries(accs.map((a) => [a.id, a.account_type]));
  const lines = await call("account.move.line", "search_read", {
    domain: [["parent_state", "=", "posted"], ["date", "<=", asOf]], fields: ["account_id", "debit", "credit"],
  });
  const t = { assets: 0, cash: 0, liabilities: 0, equity: 0, earnings: 0 };
  for (const l of lines) {
    const k = type[l.account_id[0]] ?? "";
    const b = l.debit - l.credit;
    if (k.startsWith("asset")) t.assets += b;
    if (k === "asset_cash") t.cash += b;
    if (k.startsWith("liability")) t.liabilities -= b;
    if (k === "equity" || k === "equity_unaffected") t.equity -= b;
    if (/^(income|expense)/.test(k)) t.earnings -= b;
  }
  for (const k in t) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

const date = todayRiyadh();
console.log(`opening capital → date ${date}, ref ${OPENING_REF}${DRY ? " (dry-run)" : ""}`);
const before = await balanceSheet(date);
const result = await runOpening(call, {
  date, dryRun: DRY,
  log: (p) => {
    console.log(`  journal ${p.journal}`);
    console.log(`  Dr ${p.bank.code} ${p.bank.name} (${p.bank.account_type})  ${p.amount.toFixed(2)}`);
    console.log(`  Cr ${p.equity.code} ${p.equity.name} (${p.equity.account_type})  ${p.amount.toFixed(2)}`);
  },
}).catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });

if (result.status === "refused") { console.error(`REFUSED: ${result.errors.join("; ")}`); process.exit(1); }
if (result.status === "exists") {
  console.log(`already exists: ${result.moves.map((m) => `${m.name} (id ${m.id}, ${m.state}, ${m.date})`).join("، ")} — nothing created`);
}
if (result.status === "dry-run") { console.log("dry-run — nothing written"); process.exit(0); }
const after = await balanceSheet(date);
console.log(`balance sheet ${date}: before ${JSON.stringify(before)}`);
console.log(`balance sheet ${date}: after  ${JSON.stringify(after)}`);
if (result.status === "created") {
  console.log(`posted: ${result.move.name} (id ${result.move.id}) ${result.move.date}`);
  for (const l of result.lines) console.log(`  ${l.account_id[1]}  Dr ${l.debit}  Cr ${l.credit}  «${l.name}»`);
  if (!existsSync(SNAP)) {
    writeFileSync(SNAP, JSON.stringify({
      created_at: new Date().toISOString(), ref: OPENING_REF, date,
      before: { opening_entries: [], balance_sheet: before },
      created: { move: result.move, lines: result.lines },
      after: { balance_sheet: after },
      rollback: "Not automatic. A real entry: undo only by an explicit reversal in Odoo (Accounting → the entry → Reverse), by Baraa's decision.",
    }, null, 2));
    console.log(`snapshot → ${SNAP.pathname}`);
  }
}
