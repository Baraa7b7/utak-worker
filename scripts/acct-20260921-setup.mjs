// UTAK — Accounting parallel-write setup, 2026-09-21
//
// Idempotent. Writes ONLY additive changes to Odoo. Never deletes an existing
// account/journal/field, never mutates rows that carry non-sim data. Snapshot
// is written to scripts/artifacts/acct-20260921-rollback.json for a follow-up
// rollback script — every created id lands there.
//
// Steps executed in order:
//   1. Verify account_type on 500001 (should be `income`) and 400001
//      (should be `expense_direct_cost`). If flipped, SWAP the category
//      mapping — never rewrite the account itself.
//   2. Ensure equity account "رأس المال المدفوع" (code 300010, type equity).
//   3. Ensure cash account "كاش السائق" (code 101007, type asset_cash).
//   4. Ensure cash journal CSHD "كاش السائق" pointing at that cash account.
//   5. Ensure field x_account_move_id (m2o → account.move) on x_invoice.
//   6. Ensure field x_account_payment_id (m2o → account.payment) on x_payment.
//
// Requires .env.sim-verify (ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: .env.sim-verify missing one of ODOO_URL/DB/LOGIN/API_KEY");
  process.exit(1);
}

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
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") {
      await session();
      return call(model, method, body);
    }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const rollbackPath = new URL("./artifacts/acct-20260921-rollback.json", import.meta.url).pathname;
function readRollback() {
  if (!existsSync(rollbackPath)) return { generated_at: new Date().toISOString(), created: {}, verified: {}, mutated: {} };
  try { return JSON.parse(readFileSync(rollbackPath, "utf8")); } catch { return { generated_at: new Date().toISOString(), created: {}, verified: {}, mutated: {} }; }
}
function writeRollback(json) {
  mkdirSync(dirname(rollbackPath), { recursive: true });
  writeFileSync(rollbackPath, JSON.stringify(json, null, 2) + "\n");
}

async function findAccountByCode(code) {
  const rows = await call("account.account", "search_read", {
    domain: [["code", "=", code]],
    fields: ["id", "code", "name", "account_type"],
    limit: 1,
  });
  return rows[0] || null;
}

async function findJournalByCode(code) {
  const rows = await call("account.journal", "search_read", {
    domain: [["code", "=", code]],
    fields: ["id", "code", "name", "type", "default_account_id"],
    limit: 1,
  });
  return rows[0] || null;
}

async function ensureAccount({ code, name, account_type }) {
  const existing = await findAccountByCode(code);
  if (existing) {
    console.log(`  account ${code} exists — id=${existing.id} type=${existing.account_type}`);
    return { id: existing.id, created: false, before: existing };
  }
  const ids = await call("account.account", "create", {
    vals_list: [{ code, name, account_type }],
  });
  console.log(`  created account ${code} (${name}, ${account_type}) → id=${ids[0]}`);
  return { id: ids[0], created: true };
}

async function ensureJournal({ code, name, type, default_account_id }) {
  const existing = await findJournalByCode(code);
  if (existing) {
    console.log(`  journal ${code} exists — id=${existing.id} type=${existing.type}`);
    return { id: existing.id, created: false, before: existing };
  }
  const vals = { code, name, type };
  if (default_account_id) vals.default_account_id = default_account_id;
  const ids = await call("account.journal", "create", { vals_list: [vals] });
  console.log(`  created journal ${code} (${name}, ${type}) → id=${ids[0]}`);
  return { id: ids[0], created: true };
}

async function ensureField({ modelName, fieldName, string, relation, ttype, onDelete }) {
  const existing = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", modelName], ["name", "=", fieldName]],
    fields: ["id", "name", "state", "ttype", "relation"],
    limit: 1,
  });
  if (existing.length > 0) {
    console.log(`  field ${modelName}.${fieldName} exists — id=${existing[0].id} (${existing[0].ttype} → ${existing[0].relation ?? ""})`);
    return { id: existing[0].id, created: false };
  }
  const modelRow = await call("ir.model", "search_read", {
    domain: [["model", "=", modelName]],
    fields: ["id"],
    limit: 1,
  });
  if (!modelRow.length) throw new Error(`ir.model row not found for ${modelName}`);
  const vals = {
    name: fieldName,
    field_description: string,
    model_id: modelRow[0].id,
    model: modelName,
    ttype,
    state: "manual",
  };
  if (ttype === "many2one") {
    vals.relation = relation;
    vals.on_delete = onDelete ?? "set null";
  }
  const ids = await call("ir.model.fields", "create", { vals_list: [vals] });
  console.log(`  created ${modelName}.${fieldName} → id=${ids[0]}`);
  return { id: ids[0], created: true };
}

async function main() {
  console.log(`acct-20260921 setup — ${new Date().toISOString()} — DB=${ODOO_DB}`);
  const rollback = readRollback();

  // ------ 1. Verify 500001 (income) and 400001 (expense_direct_cost) ------
  console.log("\n[1] verify 500001 / 400001 account_type");
  const acc500001 = await findAccountByCode("500001");
  const acc400001 = await findAccountByCode("400001");
  console.log(`  500001: ${acc500001 ? `${acc500001.name} (${acc500001.account_type})` : "MISSING"}`);
  console.log(`  400001: ${acc400001 ? `${acc400001.name} (${acc400001.account_type})` : "MISSING"}`);
  rollback.verified.account_500001 = acc500001 || null;
  rollback.verified.account_400001 = acc400001 || null;

  // Category mapping check — only swap categories if the *account* codes are
  // sane but were wired backwards on the category. We NEVER rewrite the
  // account_type field on the account itself.
  const cats = await call("product.category", "search_read", {
    domain: [],
    fields: ["id", "name",
      "property_account_income_categ_id",
      "property_account_expense_categ_id"],
    order: "id asc",
  });
  const catFix = [];
  for (const c of cats) {
    const inc = Array.isArray(c.property_account_income_categ_id) ? c.property_account_income_categ_id[0] : null;
    const exp = Array.isArray(c.property_account_expense_categ_id) ? c.property_account_expense_categ_id[0] : null;
    const incType = acc500001?.id === inc ? "income-ok" : (acc400001?.id === inc ? "SWAP" : "other");
    const expType = acc400001?.id === exp ? "expense-ok" : (acc500001?.id === exp ? "SWAP" : "other");
    console.log(`  category ${c.id} ${c.name}: income=${inc} (${incType}) expense=${exp} (${expType})`);
    if (incType === "SWAP" && expType === "SWAP") {
      catFix.push({ id: c.id, name: c.name, before: { income: inc, expense: exp } });
    }
  }
  rollback.verified.categories = cats;
  if (catFix.length > 0) {
    if (!acc500001 || !acc400001) {
      throw new Error("category swap needed but 500001/400001 not found");
    }
    console.log(`  swapping ${catFix.length} categories (income↔expense)`);
    for (const c of catFix) {
      await call("product.category", "write", {
        ids: [c.id],
        vals: {
          property_account_income_categ_id: acc500001.id,
          property_account_expense_categ_id: acc400001.id,
        },
      });
      console.log(`    swapped category ${c.id} ${c.name}`);
    }
    rollback.mutated.categories_swapped = catFix;
  } else {
    console.log("  no category swap needed");
  }

  // ------ 2. Equity account "رأس المال المدفوع" ------
  console.log("\n[2] ensure equity account 300010 رأس المال المدفوع");
  const equityAcc = await ensureAccount({
    code: "300010",
    name: "رأس المال المدفوع",
    account_type: "equity",
  });
  if (equityAcc.created) (rollback.created.accounts ??= []).push({ id: equityAcc.id, code: "300010", name: "رأس المال المدفوع" });
  rollback.equity_account_id = equityAcc.id;

  // ------ 3. Cash account for driver cash ------
  console.log("\n[3] ensure cash account 101007 كاش السائق");
  const cashAcc = await ensureAccount({
    code: "101007",
    name: "كاش السائق",
    account_type: "asset_cash",
  });
  if (cashAcc.created) (rollback.created.accounts ??= []).push({ id: cashAcc.id, code: "101007", name: "كاش السائق" });
  rollback.driver_cash_account_id = cashAcc.id;

  // ------ 4. Cash journal CSHD ------
  console.log("\n[4] ensure cash journal CSHD كاش السائق");
  const cshdJournal = await ensureJournal({
    code: "CSHD",
    name: "كاش السائق",
    type: "cash",
    default_account_id: cashAcc.id,
  });
  if (cshdJournal.created) (rollback.created.journals ??= []).push({ id: cshdJournal.id, code: "CSHD", name: "كاش السائق" });
  rollback.cshd_journal_id = cshdJournal.id;

  // Look up the BNK1 journal id too so the report has both anchors.
  const bnk1 = await findJournalByCode("BNK1");
  rollback.bnk1_journal_id = bnk1?.id ?? null;
  console.log(`  BNK1 (bank) → id=${bnk1?.id ?? "MISSING"}`);

  // ------ 5. x_account_move_id on x_invoice ------
  console.log("\n[5] ensure field x_account_move_id on x_invoice");
  const f5 = await ensureField({
    modelName: "x_invoice",
    fieldName: "x_account_move_id",
    string: "قيد الفاتورة (account.move)",
    relation: "account.move",
    ttype: "many2one",
    onDelete: "set null",
  });
  if (f5.created) (rollback.created.fields ??= []).push({ id: f5.id, model: "x_invoice", name: "x_account_move_id" });

  // ------ 6. x_account_payment_id on x_payment ------
  console.log("\n[6] ensure field x_account_payment_id on x_payment");
  const f6 = await ensureField({
    modelName: "x_payment",
    fieldName: "x_account_payment_id",
    string: "قيد الدفعة (account.payment)",
    relation: "account.payment",
    ttype: "many2one",
    onDelete: "set null",
  });
  if (f6.created) (rollback.created.fields ??= []).push({ id: f6.id, model: "x_payment", name: "x_account_payment_id" });

  // Persist rollback
  writeRollback(rollback);
  console.log(`\nrollback snapshot: ${rollbackPath}`);
  console.log("\n== summary ==");
  console.log(`equity account 300010 id = ${rollback.equity_account_id}`);
  console.log(`driver cash account 101007 id = ${rollback.driver_cash_account_id}`);
  console.log(`CSHD journal id = ${rollback.cshd_journal_id}`);
  console.log(`BNK1 journal id = ${rollback.bnk1_journal_id}`);
  console.log(`x_invoice.x_account_move_id id = ${f5.id}`);
  console.log(`x_payment.x_account_payment_id id = ${f6.id}`);
  console.log(`\nrun again: python-style idempotent — reruns should print all "exists — skip".`);
}

main().catch((e) => { console.error("SETUP FAILED:", e); process.exit(1); });
