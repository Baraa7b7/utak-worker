// Mutation check for § 58 أ 2 + أ 4 (2026-10-05) — Baraa's two decisions on the expense form of § 57:
// «رواتب وأجور» leaves the list (a new Flow, utak_expense_v2: scripts/lib/s58-expense-flow.mjs; the
// worker reads seven types and refuses the eighth of an old form by its own line), and «من جيب براء»
// is offered because BRA's outbound payment method posts to 201021 (scripts/lib/s58-odoo.mjs is what
// scripts/s58-20261005-odoo.mjs wrote on the tenant). Each mutation disables ONE rule, runs the test
// file, and must make it fail. The source is restored in `finally` after every run; a pattern that is
// not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s58-20261005-expense-mutations.mjs [الفلو الوركر القيد الدليل]     (no argument: every part)
//
// Out: scripts/artifacts/s58-20261005-expense-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s57-expense.test.mts";
const EF = "src/expense-form.ts";
const XA = "src/expense-accounting.ts";
const LIB = "scripts/lib/s58-expense-flow.mjs";
const OD = "scripts/lib/s58-odoo.mjs";
const IDS = "docs/ODOO-IDS.md";
const GUIDE = "docs/OPERATING-DAY.md";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- utak_expense_v2 at Meta
  ["الفلو", "utak_expense_v2 keeps «رواتب وأجور» in its list", [[LIB,
    "export const EXPENSE_TYPES = V1.EXPENSE_TYPES.filter((t) => t.id !== REMOVED_TYPE);", "export const EXPENSE_TYPES = V1.EXPENSE_TYPES;"]], T],
  ["الفلو", "another type leaves the list instead", [[LIB,
    "export const REMOVED_TYPE = \"salaries\";", "export const REMOVED_TYPE = \"rent\";"]], T],
  ["الفلو", "a second type leaves the list with it", [[LIB,
    ".filter((t) => t.id !== REMOVED_TYPE);", ".filter((t) => t.id !== REMOVED_TYPE && t.id !== \"other\");"]], T],
  ["الفلو", "the JSON sent to Meta still carries v1's eight types", [[LIB,
    "  type[\"data-source\"] = EXPENSE_TYPES;\n", ""]], T],
  ["الفلو", "the new Flow is exported under v1's name", [[LIB,
    "export const EXPENSE_FLOW_NAME = \"utak_expense_v2\";", "export const EXPENSE_FLOW_NAME = \"utak_expense_v1\";"]], T],
  ["الفلو", "the Meta script would walk v1 again beside v2", [[LIB,
    "export const FLOWS = [FLOW];", "export const FLOWS = [FLOW, V1.FLOW];"]], T],
  // ---------------------------------------------------------------- the worker
  ["الوركر", "the worker still records «رواتب وأجور» on 400003", [[XA,
    "  { id: \"rent\", title: \"إيجار\", code: \"400017\" },\n", "  { id: \"rent\", title: \"إيجار\", code: \"400017\" },\n  { id: \"salaries\" as ExpenseType, title: \"رواتب وأجور\", code: \"400003\" },\n"]], T],
  ["الوركر", "the worker names another type as the one that left", [[XA,
    "export const EXPENSE_REMOVED_TYPE = \"salaries\";", "export const EXPENSE_REMOVED_TYPE = \"wages\";"]], T],
  ["الوركر", "«رواتب وأجور» of an old form is refused without its own line", [[EF,
    "  if (!type) problems.push(values.type === EXPENSE_REMOVED_TYPE ? \"salaries\" : \"type\");", "  if (!type) problems.push(\"type\");"]], T],
  ["الوركر", "its line does not say the salaries have their monthly entry", [[EF,
    "الرواتب تُسجَّل بقيدها الشهري، وتسجيلها هنا يكرّرها. اختر نوعاً آخر.\",", "اختر نوعاً آخر.\","]], T],
  ["الوركر", "the worker still sends utak_expense_v1", [[EF,
    "export const EXPENSE_FLOW_ID = \"2207848546771736\";", "export const EXPENSE_FLOW_ID = \"1084220070882916\";"]], T],
  // ---------------------------------------------------------------- «من جيب براء» in Odoo
  ["القيد", "the Odoo script puts «من جيب براء» on 205001", [[OD,
    "export const POCKET_ACCOUNT_CODE = \"201021\";", "export const POCKET_ACCOUNT_CODE = \"205001\";"]], T],
  ["القيد", "the Odoo script sets the account on another journal than the one the worker reads", [[OD,
    "export const POCKET_JOURNAL_CODE = \"BRA\";", "export const POCKET_JOURNAL_CODE = \"EXP\";"]], T],
  ["القيد", "the Odoo script names 201021 as the account it leaves alone", [[OD,
    "export const POCKET_UNTOUCHED_CODE = \"205001\";", "export const POCKET_UNTOUCHED_CODE = \"201021\";"]], T],
  // ---------------------------------------------------------------- the documents
  ["الدليل", "the guide still lists «رواتب وأجور» among the form's types", [[GUIDE,
    "| نوع المصروف | وقود · صيانة السيارة · إيجار · كهرباء ومياه واتصالات", "| نوع المصروف | وقود · صيانة السيارة · إيجار · رواتب وأجور · كهرباء ومياه واتصالات"]], T],
  ["الدليل", "the guide does not say why «رواتب وأجور» left", [[GUIDE,
    "«رواتب وأجور» حُذف من قائمة النموذج في § 58 حتى لا يُسجَّل الراتب مرتين.", "لا تسجّله من النموذج."], [GUIDE,
    "— ومنه «رواتب وأجور» من نموذج قديم وصلك قبل § 58: يرجع نموذج جديد يقول إن الرواتب بقيدها الشهري —", ""]], T],
  ["الدليل", "the guide still says «من جيب براء» is hidden", [[GUIDE,
    "- خيار «من جيب براء» **معروض منذ § 58**:", "- خيار «من جيب براء» **مخفي**:"]], T],
  ["الدليل", "the table of accounts still has a row for «رواتب وأجور»", [[IDS,
    "| إيجار (`rent`) | 400017 | Warehouse Rent | #152 |\n", "| إيجار (`rent`) | 400017 | Warehouse Rent | #152 |\n| رواتب وأجور (`salaries`) | 400003 | Basic Salary | #138 |\n"]], T],
  ["الدليل", "docs/ODOO-IDS.md names utak_expense_v1 as the Flow the worker sends", [[IDS,
    "Flow `utak_expense_v2` #2207848546771736 (`EXPENSE_FLOW_ID`", "Flow `utak_expense_v1` #1084220070882916 (`EXPENSE_FLOW_ID`"]], T],
  ["الدليل", "docs/ODOO-IDS.md says BRA's outbound method posts to 205001", [[IDS,
    "ترحّل إلى **201021** «Owner Current Account» (#258، التزام متداول) منذ § 58", "ترحّل إلى **205001** منذ § 58"]], T],
];

const want = new Set(process.argv.slice(2));
const results = [];
for (const [part, name, edits, test] of M) {
  if (want.size && !want.has(part)) continue;
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`pattern found ${n}× in ${file}: ${find.slice(0, 80)}`);
      writeFileSync(path, cur.replace(find, replace));
    }
    let caught = false, out = "";
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ part, name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  [${part}] ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("../artifacts/s58-20261005-expense-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
