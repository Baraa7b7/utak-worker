// UTAK — monthly payroll entry (manual, never a cron).
//
//   node scripts/payroll-monthly-entry.mjs 2026-09 [--dry-run]
//
// One posted journal entry per month in journal EXP «المصاريف»:
//   Dr 400003 Basic Salary       one line per employee («راتب 2026-09 — name»,
//                                 partner = the employee)
//   Cr 201004 Accrued - Salaries  the total
// Paying the salaries later is a separate entry that debits 201004 (see
// docs/EXPENSES.md).
//
// Employees = active res.partner with x_monthly_salary > 0 and not
// x_is_simulation. Team members (x_role_ids) without a salary are listed as
// warnings, not paid.
//
// Date = the month's last day or today (Asia/Riyadh), whichever is earlier —
// l10n_sa refuses to post a date after today. A month that has not started
// yet is refused.
//
// Idempotent: ref = UTAK-PAYROLL-YYYY-MM. Any non-cancelled entry with that
// ref → nothing is created. To redo a month: reset the entry to draft and
// cancel it in Odoo, then run again.
//
// Test mode (live verification only):
//   --test-partners=ID,ID  use exactly these partners, which MUST be
//                          x_is_simulation=true; ref gets the prefix
//                          SIM-TEST-<tag>- so it never blocks a real month
//   --tag=NAME             the SIM-TEST tag (default "run")
//
// Requires .env.sim-verify.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_API_KEY } = env;

const SALARY_CODE = "400003";
const ACCRUED_CODE = "201004";
const JOURNAL_CODE = "EXP";

// Same retry policy as src/odoo.ts::call: 429 is re-sent for every method
// (the odoo.com rate limiter answered, Odoo never ran it); 5xx / network is
// re-sent only for reads, and for the entry create only after a probe by
// ref finds nothing. 4xx (incl. 422 = posting refused) is never retried.
const READS = new Set(["search_read", "read", "search", "search_count"]);
async function call(model, method, body, { probe } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res, t;
    try {
      res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ODOO_API_KEY}` },
        body: JSON.stringify(body),
      });
      t = await res.text();
    } catch (e) {
      res = null; t = String(e?.message ?? e);
    }
    if (res?.ok) return JSON.parse(t);
    const status = res?.status ?? 0;
    const ambiguous = status === 0 || status >= 500;
    const canRetry = status === 429 || (ambiguous && (READS.has(method) || (method === "create" && probe)));
    if (!canRetry || attempt >= 3) throw new Error(`${model}.${method} HTTP ${status}: ${t.slice(0, 400)}`);
    const ra = Number(res?.headers?.get("retry-after"));
    const wait = ra > 0 ? Math.min(ra * 1000, 15000) : Math.round(1000 * 2 ** attempt * (0.5 + Math.random() / 2));
    console.log(`  … HTTP ${status || "network"} on ${model}.${method}, retry in ${(wait / 1000).toFixed(1)}s`);
    await new Promise((r) => setTimeout(r, wait));
    if (ambiguous && method === "create" && probe) {
      const found = await call(model, "search", { domain: probe, limit: 2 });
      if (found.length) { console.log(`  … probe found ${found.join(",")} — not creating again`); return [found[0]]; }
    }
  }
}

function todayRiyadh(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
export function payrollDate(month, today) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (`${month}-01` > today) return null;
  return last < today ? last : today;
}
function round2(n) { return Math.round(n * 100) / 100; }

const args = process.argv.slice(2);
const month = args.find((a) => /^\d{4}-\d{2}$/.test(a));
const DRY = args.includes("--dry-run");
const testArg = args.find((a) => a.startsWith("--test-partners="));
const tag = (args.find((a) => a.startsWith("--tag=")) ?? "--tag=run").slice(6);
if (!month || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12) {
  console.error("usage: node scripts/payroll-monthly-entry.mjs YYYY-MM [--dry-run]");
  process.exit(2);
}
const today = todayRiyadh();
const date = payrollDate(month, today);
if (!date) { console.error(`STOP: ${month} has not started yet (today ${today}, Riyadh)`); process.exit(1); }
const ref = `${testArg ? `SIM-TEST-${tag}-` : ""}UTAK-PAYROLL-${month}`;

async function account(code) {
  const [a] = await call("account.account", "search_read", { domain: [["code", "=", code]], fields: ["id", "code", "name", "account_type"], limit: 1 });
  if (!a) throw new Error(`account ${code} missing — run scripts/acct-20260923-expense-setup.mjs`);
  return a;
}

async function main() {
  console.log(`payroll ${month} → date ${date}, ref ${ref}${DRY ? " (dry-run)" : ""}`);
  const [salary, accrued] = [await account(SALARY_CODE), await account(ACCRUED_CODE)];
  if (salary.account_type !== "expense") throw new Error(`${SALARY_CODE} is ${salary.account_type}`);
  if (accrued.account_type !== "liability_current") throw new Error(`${ACCRUED_CODE} is ${accrued.account_type}`);
  const [journal] = await call("account.journal", "search_read", { domain: [["code", "=", JOURNAL_CODE]], fields: ["id", "code"], limit: 1 });
  if (!journal) throw new Error(`journal ${JOURNAL_CODE} missing — run scripts/acct-20260923-expense-setup.mjs`);

  const existing = await call("account.move", "search_read", {
    domain: [["ref", "=", ref], ["state", "!=", "cancel"]], fields: ["id", "name", "state", "date"], limit: 5,
  });
  if (existing.length) {
    console.log(`already exists: ${existing.map((m) => `${m.name} (id ${m.id}, ${m.state}, ${m.date})`).join("، ")} — nothing created`);
    return { status: "exists", move_id: existing[0].id };
  }

  let employees;
  if (testArg) {
    const ids = testArg.slice(16).split(",").map(Number).filter(Boolean);
    employees = await call("res.partner", "read", { ids, fields: ["id", "name", "x_monthly_salary", "x_is_simulation"] });
    const real = employees.filter((p) => !p.x_is_simulation);
    if (real.length) throw new Error(`--test-partners must be x_is_simulation=true: ${real.map((p) => p.id).join(",")}`);
  } else {
    employees = await call("res.partner", "search_read", {
      domain: [["active", "=", true], ["x_monthly_salary", ">", 0], ["x_is_simulation", "!=", true]],
      fields: ["id", "name", "x_monthly_salary"], order: "name",
    });
    const team = await call("res.partner", "search_read", {
      domain: [["active", "=", true], ["x_role_ids", "!=", false], ["x_is_simulation", "!=", true]],
      fields: ["id", "name", "x_role_ids", "x_monthly_salary"],
    });
    for (const p of team) {
      if (Array.isArray(p.x_role_ids) && p.x_role_ids.length && !(Number(p.x_monthly_salary) > 0)) {
        console.log(`  ⚠️ ${p.name} (id ${p.id}) has a team role but no x_monthly_salary — not included`);
      }
    }
  }
  employees = employees.filter((p) => Number(p.x_monthly_salary) > 0);
  if (!employees.length) { console.log("no employee with x_monthly_salary > 0 — nothing to post"); return { status: "empty" }; }

  const total = round2(employees.reduce((s, p) => s + Number(p.x_monthly_salary), 0));
  const lines = employees.map((p) => [0, 0, {
    account_id: salary.id, partner_id: p.id, name: `راتب ${month} — ${p.name}`,
    debit: round2(Number(p.x_monthly_salary)), credit: 0,
  }]);
  lines.push([0, 0, { account_id: accrued.id, name: `مستحقات رواتب ${month}`, debit: 0, credit: total }]);
  for (const p of employees) console.log(`  Dr ${SALARY_CODE}  ${round2(Number(p.x_monthly_salary)).toFixed(2).padStart(10)}  ${p.name}`);
  console.log(`  Cr ${ACCRUED_CODE}  ${total.toFixed(2).padStart(10)}  total (${employees.length})`);
  if (DRY) { console.log("dry-run — nothing written"); return { status: "dry-run", total }; }

  const [moveId] = await call("account.move", "create", {
    vals_list: [{ move_type: "entry", journal_id: journal.id, date, ref, line_ids: lines }],
  }, { probe: [["ref", "=", ref], ["state", "!=", "cancel"]] });
  try {
    await call("account.move", "action_post", { ids: [moveId] });
  } catch (e) {
    // no orphan draft: a draft entry has no number yet, delete it
    try { await call("account.move", "unlink", { ids: [moveId] }); }
    catch { await call("account.move", "button_cancel", { ids: [moveId] }).catch(() => {}); }
    throw new Error(`posting refused, draft ${moveId} removed: ${e.message}`);
  }

  // guard: posted, exactly two accounts, balanced on the total
  const [head] = await call("account.move", "read", { ids: [moveId], fields: ["name", "state", "date"] });
  const ml = await call("account.move.line", "search_read", {
    domain: [["move_id", "=", moveId]], fields: ["account_id", "debit", "credit"],
  });
  const accounts = new Set(ml.map((l) => l.account_id[0]));
  const dr = round2(ml.filter((l) => l.account_id[0] === salary.id).reduce((s, l) => s + l.debit - l.credit, 0));
  const cr = round2(ml.filter((l) => l.account_id[0] === accrued.id).reduce((s, l) => s + l.credit - l.debit, 0));
  const ok = head.state === "posted" && accounts.size === 2 && dr === total && cr === total;
  console.log(`${ok ? "posted" : "⚠️ GUARD FAILED"}: ${head.name} (id ${moveId}) ${head.date} — ${SALARY_CODE} +${dr} / ${ACCRUED_CODE} −${cr}`);
  if (!ok) {
    await call("account.move", "button_draft", { ids: [moveId] }).catch(() => {});
    await call("account.move", "button_cancel", { ids: [moveId] }).catch(() => {});
    throw new Error(`guard failed on ${moveId} — entry cancelled`);
  }
  return { status: "created", move_id: moveId, name: head.name, total };
}

const result = await main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
if (process.env.PAYROLL_JSON) console.log(`RESULT ${JSON.stringify(result)}`);
