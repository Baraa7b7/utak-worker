// UTAK — expenses + payroll setup, 2026-09-23.
//
// Makes the income statement complete: operating expenses are entered by
// hand in Odoo as vendor bills on ready expense accounts, and payroll is one
// monthly entry (scripts/payroll-monthly-entry.mjs). No hr_expense, no payroll
// module. This script only prepares Odoo.
//
// 1. Expense accounts, one per category (the sa chart already carries them;
//    a missing one is created with the next free 4000xx code):
//      رواتب وأجور          400003 Basic Salary
//      وقود ونقل            400077 Fuel
//      إيجار                400017 Warehouse Rent
//      اتصالات واشتراكات    400020 Telephone
//      صيانة                400042 Maintenance
//      رسوم حكومية وتراخيص  400032 Trade License Fees
//      مصاريف بنكية         400051 Other Bank Charges
//      مصاريف أخرى          400028 Others
// 2. «مستحقات موظفين» liability_current: 201004 Accrued - Salaries (created
//    as 201004 if missing).
// 3. Journal EXP «المصاريف» (type purchase, default account 400028 Others):
//    manual expense bills + the monthly payroll entry, kept apart from BILL
//    (whose default account is 400001 COGS — an expense line typed there
//    without an account would land in cost of goods).
// 4. Partner tag «مورد مصاريف» and one catch-all vendor «مصروفات نقدية
//    متنوعة» (no VAT number) for cash expenses without a tax invoice.
// 5. Salary field: res.partner.x_monthly_salary must exist (it does since
//    2026-09; if missing it is created, values left empty for Baraa).
//
// Idempotent: every step searches first. Snapshot of what was created:
// scripts/artifacts/acct-20260923-expense-setup-rollback.json
// Flags:
//   --dry-run   print the plan, write nothing
//   --rollback  undo what this script created (journal / partner archived
//               when Odoo refuses to delete because entries reference them)
//
// Requires .env.sim-verify.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

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
    // 429 = odoo.com rate limiter, the request never ran → safe for any method
    if (res.status === 429 && attempt < 6) {
      const ra = Number(res.headers.get("retry-after"));
      const wait = ra > 0 ? Math.min(ra * 1000, 15000) : 2000 * 2 ** Math.min(attempt, 4);
      console.log(`  … 429 on ${model}.${method}, retry in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${model}.${method} HTTP ${res.status}: ${t.slice(0, 400)}`);
    return JSON.parse(t);
  }
}

const ROLLBACK = new URL("./artifacts/acct-20260923-expense-setup-rollback.json", import.meta.url);
const DRY = process.argv.includes("--dry-run");
const MODE = process.argv.includes("--rollback") ? "rollback" : "apply";

export const CATEGORIES = [
  { key: "salaries",    ar: "رواتب وأجور",          code: "400003", name: "Basic Salary" },
  { key: "fuel",        ar: "وقود ونقل",            code: "400077", name: "Fuel" },
  { key: "rent",        ar: "إيجار",                code: "400017", name: "Warehouse Rent" },
  { key: "telecom",     ar: "اتصالات واشتراكات",    code: "400020", name: "Telephone" },
  { key: "maintenance", ar: "صيانة",                code: "400042", name: "Maintenance" },
  { key: "gov_fees",    ar: "رسوم حكومية وتراخيص",  code: "400032", name: "Trade License Fees" },
  { key: "bank_fees",   ar: "مصاريف بنكية",         code: "400051", name: "Other Bank Charges" },
  { key: "other",       ar: "مصاريف أخرى",          code: "400028", name: "Others" },
];
const ACCRUED = { code: "201004", name: "Accrued - Salaries", ar: "مستحقات موظفين" };
const JOURNAL = { code: "EXP", name: "المصاريف" };
const TAG_NAME = "مورد مصاريف";
const MISC_VENDOR = "مصروفات نقدية متنوعة";

function stop(msg) { console.error(`STOP: ${msg}`); process.exit(1); }

async function findAccount(code) {
  const [a] = await call("account.account", "search_read", {
    domain: [["code", "=", code]], fields: ["id", "code", "name", "account_type", "active"],
    context: { active_test: false }, limit: 1,
  });
  return a ?? null;
}

async function nextFreeCode(prefix, from) {
  for (let n = from; n < from + 200; n++) {
    const code = `${prefix}${String(n).padStart(3, "0")}`;
    if (!(await findAccount(code))) return code;
  }
  stop(`no free code under ${prefix}`);
}

async function ensureAccounts(snap) {
  console.log("\n[1] expense accounts");
  snap.accounts ??= {};
  for (const c of CATEGORIES) {
    const a = await findAccount(c.code);
    if (a) {
      if (a.account_type !== "expense") stop(`${c.code} is ${a.account_type}, expected expense`);
      if (!a.active) stop(`${c.code} is archived`);
      console.log(`  ${c.ar.padEnd(20)} → ${a.code} ${a.name} (id ${a.id}) — exists`);
      snap.accounts[c.key] ??= { id: a.id, code: a.code, created: false };
      continue;
    }
    const code = await nextFreeCode("400", 92);
    if (DRY) { console.log(`  ${c.ar} → WOULD create ${code} «${c.ar}» expense`); continue; }
    const [id] = await call("account.account", "create", { vals_list: [{ code, name: c.ar, account_type: "expense" }] });
    snap.accounts[c.key] = { id, code, created: true };
    console.log(`  ${c.ar} → created ${code} (id ${id})`);
  }

  console.log("\n[2] مستحقات موظفين");
  const acc = await findAccount(ACCRUED.code);
  if (acc) {
    if (acc.account_type !== "liability_current") stop(`${ACCRUED.code} is ${acc.account_type}, expected liability_current`);
    console.log(`  ${acc.code} ${acc.name} (id ${acc.id}) liability_current — exists`);
    snap.accounts.accrued_salaries ??= { id: acc.id, code: acc.code, created: false };
  } else if (DRY) {
    console.log(`  WOULD create ${ACCRUED.code} «${ACCRUED.ar}» liability_current`);
  } else {
    const [id] = await call("account.account", "create", {
      vals_list: [{ code: ACCRUED.code, name: ACCRUED.ar, account_type: "liability_current" }],
    });
    snap.accounts.accrued_salaries = { id, code: ACCRUED.code, created: true };
    console.log(`  created ${ACCRUED.code} (id ${id})`);
  }
}

async function ensureJournal(snap) {
  console.log("\n[3] journal EXP");
  const other = await findAccount("400028");
  const [j] = await call("account.journal", "search_read", {
    domain: [["code", "=", JOURNAL.code]], fields: ["id", "code", "name", "type", "default_account_id", "active"],
    context: { active_test: false }, limit: 1,
  });
  if (j) {
    if (j.type !== "purchase") stop(`journal ${JOURNAL.code} exists as ${j.type}`);
    if (!j.active) stop(`journal ${JOURNAL.code} is archived`);
    console.log(`  ${j.code} «${j.name}» (id ${j.id}) purchase, default → ${j.default_account_id?.[1]} — exists`);
    snap.journal ??= { id: j.id, created: false };
    return;
  }
  if (DRY) { console.log(`  WOULD create ${JOURNAL.code} «${JOURNAL.name}» purchase, default 400028`); return; }
  const [id] = await call("account.journal", "create", {
    vals_list: [{ code: JOURNAL.code, name: JOURNAL.name, type: "purchase", default_account_id: other.id }],
  });
  snap.journal = { id, created: true };
  console.log(`  created ${JOURNAL.code} (id ${id})`);
}

async function ensureVendorTag(snap) {
  console.log("\n[4] vendor tag + catch-all vendor");
  const [tag] = await call("res.partner.category", "search_read", {
    domain: [["name", "=", TAG_NAME]], fields: ["id"], context: { active_test: false }, limit: 1,
  });
  let tagId = tag?.id ?? null;
  if (tag) { console.log(`  tag «${TAG_NAME}» (id ${tag.id}) — exists`); snap.tag ??= { id: tag.id, created: false }; }
  else if (DRY) console.log(`  WOULD create tag «${TAG_NAME}»`);
  else {
    [tagId] = await call("res.partner.category", "create", { vals_list: [{ name: TAG_NAME }] });
    snap.tag = { id: tagId, created: true };
    console.log(`  created tag (id ${tagId})`);
  }

  const [v] = await call("res.partner", "search_read", {
    domain: [["name", "=", MISC_VENDOR]], fields: ["id", "vat", "category_id", "active"],
    context: { active_test: false }, limit: 1,
  });
  if (v) {
    if (v.vat) stop(`«${MISC_VENDOR}» carries a VAT number`);
    console.log(`  vendor «${MISC_VENDOR}» (id ${v.id}) — exists`);
    snap.misc_vendor ??= { id: v.id, created: false };
    return;
  }
  if (DRY) { console.log(`  WOULD create vendor «${MISC_VENDOR}» (company, no VAT, tag)`); return; }
  const [id] = await call("res.partner", "create", {
    vals_list: [{
      name: MISC_VENDOR, is_company: true, supplier_rank: 1, customer_rank: 0,
      category_id: tagId ? [[6, 0, [tagId]]] : [], x_wa_allowed: false,
      comment: "مورد عام لمصاريف نقدية بلا فاتورة ضريبية (وقود، مواقف، إصلاحات صغيرة). بلا ضريبة مدخلات.",
    }],
  });
  snap.misc_vendor = { id, created: true };
  console.log(`  created vendor (id ${id})`);
}

async function ensureSalaryField(snap) {
  console.log("\n[5] salary field");
  const [f] = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "res.partner"], ["name", "=", "x_monthly_salary"]], fields: ["id", "ttype", "state"], limit: 1,
  });
  if (f) {
    console.log(`  res.partner.x_monthly_salary (id ${f.id}, ${f.ttype}, ${f.state}) — exists`);
    snap.salary_field ??= { id: f.id, created: false };
  } else if (DRY) {
    console.log("  WOULD create res.partner.x_monthly_salary float — ⚠️ REPORT TO BARAA, values left empty");
  } else {
    const [model] = await call("ir.model", "search_read", { domain: [["model", "=", "res.partner"]], fields: ["id"], limit: 1 });
    const [id] = await call("ir.model.fields", "create", {
      vals_list: [{ model_id: model.id, name: "x_monthly_salary", ttype: "float", field_description: "الراتب الشهري", state: "manual" }],
    });
    snap.salary_field = { id, created: true };
    console.log(`  ⚠️ created res.partner.x_monthly_salary (id ${id}) — values empty, Baraa fills them`);
  }
  const team = await call("res.partner", "search_read", {
    domain: [["x_role_ids", "!=", false]], fields: ["id", "name", "x_monthly_salary", "x_is_simulation"],
  });
  let total = 0;
  for (const p of team) {
    total += p.x_is_simulation ? 0 : Number(p.x_monthly_salary || 0);
    console.log(`  team ${p.id} «${p.name}» salary=${p.x_monthly_salary || "—"}${p.x_is_simulation ? " (simulation)" : ""}`);
  }
  console.log(`  active team members: ${team.length}, salary total (non-simulation): ${total}`);
}

async function rollback() {
  if (!existsSync(ROLLBACK)) stop("no rollback snapshot");
  const snap = JSON.parse(readFileSync(ROLLBACK, "utf8"));
  const drop = async (model, id, label) => {
    if (DRY) { console.log(`  WOULD remove ${label} ${model} ${id}`); return; }
    try { await call(model, "unlink", { ids: [id] }); console.log(`  unlinked ${label} (${model} ${id})`); }
    catch (e) {
      await call(model, "write", { ids: [id], vals: { active: false } });
      console.log(`  archived ${label} (${model} ${id}) — unlink refused: ${e.message.slice(0, 120)}`);
    }
  };
  if (snap.misc_vendor?.created) await drop("res.partner", snap.misc_vendor.id, "vendor");
  if (snap.tag?.created) await drop("res.partner.category", snap.tag.id, "tag");
  if (snap.journal?.created) await drop("account.journal", snap.journal.id, "journal");
  for (const [k, a] of Object.entries(snap.accounts ?? {})) if (a.created) await drop("account.account", a.id, `account ${k}`);
  if (snap.salary_field?.created) await drop("ir.model.fields", snap.salary_field.id, "field");
  console.log("rollback done");
}

if (MODE === "rollback") {
  await rollback();
} else {
  const snap = existsSync(ROLLBACK) ? JSON.parse(readFileSync(ROLLBACK, "utf8")) : { created_at: new Date().toISOString() };
  const save = () => { if (!DRY) writeFileSync(ROLLBACK, JSON.stringify(snap, null, 2) + "\n"); };
  try {
    await ensureAccounts(snap); save();
    await ensureJournal(snap); save();
    await ensureVendorTag(snap); save();
    await ensureSalaryField(snap); save();
  } finally { save(); }
  console.log(`\n${DRY ? "dry-run — nothing written" : `done — snapshot ${ROLLBACK.pathname}`}`);
}
