// § 57 ج (2026-10-05) — the bank journal BNK1 (#13) made ready for a statement uploaded by hand: SAB is
// not among the banks Odoo synchronises, so the weekly statement is a file (docs/OPERATING-DAY.md «كشف
// البنك الأسبوعي»).
//
//   1  account.journal #13: bank_statements_source «undefined» → «file_import» (manual / import).
//   2  account.reconcile.model is READ, nothing is written: this Odoo (saas~19.4) has no «invoice
//      matching» rule to switch on — the model has no rule_type any more (its fields: trigger manual /
//      auto_reconcile, match_journal_ids, match_label, match_amount), and a statement line is matched
//      with an invoice or a payment by the bank reconciliation itself. The two models the tenant
//      carries («Internal Transfers», «Bank Fees») are manual and cover every journal. No rule that
//      validates by itself exists and none is created.
//   3  what § 57 د relies on is checked, not changed: a payment registered on BNK1 goes to 101003
//      «Outstanding Receipts» (a reconcilable account), NOT to 101001 «Bank»; the statement line, when
//      uploaded, goes 101001 against 101002 «Bank Suspense Account», and matching it with the payment
//      replaces 101002 with 101003. The bank's balance (101001) moves once, with the statement.
//
// NOT touched: the statement line #1 «sab» 0.00 and the online link #1 (both made by the administrator
// on 10-05 at 14:16), any setting of the online synchronisation, any rule.
//
//   node scripts/s57-20261005-bank.mjs                       dry-run: the plan, nothing written
//   node scripts/s57-20261005-bank.mjs --apply               step 1 (the rollback file first)
//   node scripts/s57-20261005-bank.mjs --verify              read-only checks
//   node scripts/s57-20261005-bank.mjs --rollback [--apply]  the source back as it was
// Rollback file: scripts/artifacts/s57-20261005-bank-rollback.json. The tenant is production. No
// WhatsApp send. No entry, payment or statement line is written here: one selection on one journal.
import { APPLY, ROLLBACK, VERIFY, call, checker, log, rollbackFile } from "./lib/s40-kit.mjs";

export const BNK1 = 13;
const SOURCE = "file_import";
const BANK = "101001", SUSPENSE = "101002", OUTSTANDING_IN = "101003", OUTSTANDING_OUT = "101004";
const IMPORT_MODULES = ["account_accountant", "account_bank_statement_import", "account_bank_statement_import_csv", "base_import"];
const RB = new URL("./artifacts/s57-20261005-bank-rollback.json", import.meta.url);
const ALL = { active_test: false };
const { rb, save } = rollbackFile(RB, "scripts/s57-20261005-bank.mjs");
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const journal = async () => (await call("account.journal", "read", { ids: [BNK1], fields: ["id", "name", "code", "type", "bank_statements_source", "default_account_id", "suspense_account_id", "bank_account_id", "inbound_payment_method_line_ids", "outbound_payment_method_line_ids", "account_online_link_id", "account_online_account_id"] }))[0];
const code = (m2o) => String(m2o?.[1] ?? "").split(" ")[0];

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const was = rb.before.journal;
  log(was ? `account.journal #${BNK1}: bank_statements_source back to «${was.bank_statements_source}»` : `account.journal #${BNK1}: not changed by this script`);
  if (APPLY && was) await call("account.journal", "write", { ids: [BNK1], vals: { bank_statements_source: was.bank_statements_source } });
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const j = await journal();
  check(`BNK1 #${j?.id} «${j?.name}»: its statements come from a file (bank_statements_source «${j?.bank_statements_source}»)`, j?.code === "BNK1" && j.type === "bank" && j.bank_statements_source === SOURCE, JSON.stringify(j));
  check(`…its accounts as they were: the bank ${code(j.default_account_id)}, the suspense ${code(j.suspense_account_id)}, the company's account #${j.bank_account_id?.[0]} (the IBAN of § 52)`, code(j.default_account_id) === BANK && code(j.suspense_account_id) === SUSPENSE && j.bank_account_id?.[0] === 1, JSON.stringify([j.default_account_id, j.suspense_account_id, j.bank_account_id]));
  check("…and no online synchronisation on it (not touched)", !j.account_online_link_id && !j.account_online_account_id, JSON.stringify([j.account_online_link_id, j.account_online_account_id]));
  await pause();
  const lines = await call("account.payment.method.line", "search_read", { domain: [["journal_id", "=", BNK1]], fields: ["id", "payment_type", "payment_account_id"] });
  const accounts = await call("account.account", "search_read", { domain: [["code", "in", [BANK, SUSPENSE, OUTSTANDING_IN, OUTSTANDING_OUT]]], fields: ["id", "code", "account_type", "reconcile"] });
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a]));
  const inbound = lines.filter((l) => l.payment_type === "inbound"), outbound = lines.filter((l) => l.payment_type === "outbound");
  check(`a payment received on BNK1 goes to ${OUTSTANDING_IN} «Outstanding Receipts», not to the bank's own account: it waits there for its statement line (one inbound method, #${inbound[0]?.id})`, inbound.length === 1 && code(inbound[0].payment_account_id) === OUTSTANDING_IN && outbound.length === 1 && code(outbound[0].payment_account_id) === OUTSTANDING_OUT, JSON.stringify(lines));
  check(`…${OUTSTANDING_IN} and ${OUTSTANDING_OUT} can be reconciled (so the statement line is matched with the payment), ${BANK} is the cash account and ${SUSPENSE} is not: the bank's balance moves once, with the statement`, acc[OUTSTANDING_IN]?.reconcile === true && acc[OUTSTANDING_OUT]?.reconcile === true && acc[BANK]?.account_type === "asset_cash" && acc[SUSPENSE]?.account_type === "asset_current" && acc[OUTSTANDING_IN].account_type === "asset_current", JSON.stringify(accounts));
  await pause();
  const fields = await call("account.reconcile.model", "fields_get", { attributes: ["type", "selection"] });
  const models = await call("account.reconcile.model", "search_read", { domain: [], fields: ["id", "name", "active", "trigger", "match_journal_ids", "can_be_proposed"], context: ALL });
  check("this Odoo has no «invoice matching» rule to switch on: account.reconcile.model carries no rule_type (a statement line is matched with an invoice or a payment by the reconciliation itself)", !("rule_type" in fields) && JSON.stringify(fields.trigger?.selection?.map((s) => s[0])) === JSON.stringify(["manual", "auto_reconcile"]), JSON.stringify(Object.keys(fields).filter((k) => /rule|trigger|match/.test(k))));
  check(`the ${models.length} models the tenant carries (${models.map((m) => `#${m.id} «${m.name}»`).join(", ")}) are manual and leave no journal out — BNK1 is covered; none validates by itself, and none was created`, models.length === 2 && models.every((m) => m.trigger === "manual" && (m.match_journal_ids.length === 0 || m.match_journal_ids.includes(BNK1))) && models.every((m) => [3, 4].includes(m.id)), JSON.stringify(models));
  await pause();
  const mods = await call("ir.module.module", "search_read", { domain: [["name", "in", IMPORT_MODULES]], fields: ["name", "state"] });
  check(`the upload of a file is installed (${IMPORT_MODULES.join(", ")})`, IMPORT_MODULES.every((n) => mods.some((m) => m.name === n && m.state === "installed")), JSON.stringify(mods));
  await pause();
  const st = await call("account.bank.statement.line", "search_read", { domain: [["journal_id", "=", BNK1]], fields: ["id", "date", "payment_ref", "amount", "is_reconciled"], order: "id", context: ALL });
  const links = await call("account.online.link", "search_read", { domain: [], fields: ["id", "state"], context: ALL });
  check(`left as they are: the statement line #1 «sab» 0.00 of 2026-10-05, and the online link #1 «disconnected» (${st.length} line(s), ${links.length} link(s))`, st.some((l) => l.id === 1 && l.payment_ref === "sab" && l.amount === 0 && l.date === "2026-10-05") && links.length === 1 && links[0].id === 1 && links[0].state === "disconnected", JSON.stringify([st, links]));
  if (rb.before.journal) check(`before this script the source was «${rb.before.journal.bank_statements_source}» (the rollback file)`, rb.before.journal.bank_statements_source === "undefined");
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write
const j = await journal();
if (!j || j.code !== "BNK1" || j.type !== "bank") throw new Error(`account.journal #${BNK1} is not the bank journal BNK1 — stop`);
log(`— 1: BNK1 #${BNK1} «${j.name}» — where its statements come from`);
if (j.bank_statements_source === SOURCE) log(`= account.journal #${BNK1} bank_statements_source «${SOURCE}»`);
else if (j.bank_statements_source !== "undefined") throw new Error(`BNK1's source is «${j.bank_statements_source}», neither «undefined» nor «${SOURCE}» — stop (someone set it: not ours to change)`);
else {
  log(`✎ account.journal #${BNK1} bank_statements_source: «${j.bank_statements_source}» → «${SOURCE}»`);
  if (APPLY) {
    rb.before.journal ??= { id: BNK1, bank_statements_source: j.bank_statements_source }; save();
    await call("account.journal", "write", { ids: [BNK1], vals: { bank_statements_source: SOURCE } });
  }
}
log("— 2: account.reconcile.model — read only (see --verify): nothing to switch on in this Odoo, no rule created");
save();
log(APPLY ? "done — verify: node scripts/s57-20261005-bank.mjs --verify" : "dry-run: nothing written");
