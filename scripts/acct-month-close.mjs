// UTAK — monthly close check + summary, optional period lock.
//
//   node scripts/acct-month-close.mjs YYYY-MM [--lock] [--dry-run] [--json]
//   node scripts/acct-month-close.mjs --restore-lock <snapshot.json>
//
// Without --lock: read-only. Lists what keeps the month from being clean
// (draft entries, draft invoices/bills, unmatched outstanding / suspense
// balances, an unbalanced ledger, UTAK orders / purchase lists / invoices /
// collections that never reached accounting, a missing payroll entry) and
// prints the month summary: revenue, cost of goods, gross profit, expenses,
// net profit, receivables, payables, cash and bank balances.
//
// With --lock: sets res.company.fiscalyear_lock_date (Odoo 19 «Global Lock
// Date», reversible) to the month's last day — only if the check has no
// finding, the month is over (Riyadh) and the lock is not already there.
// hard_lock_date (irreversible) is never touched. The previous lock values
// are saved first to scripts/artifacts/acct-month-close-YYYY-MM-lock-<ts>.json;
// --restore-lock writes them back.
// --dry-run with --lock says whether it would lock, and writes nothing.
//
// Logic: scripts/lib/acct-close-core.mjs (tested in tests/acct-close.test.mts).

import { readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";
import { runMonthClose, todayRiyadh, LOCK_FIELD } from "./lib/acct-close-core.mjs";

const args = process.argv.slice(2);
const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

if (args[0] === "--restore-lock") {
  const snap = JSON.parse(readFileSync(args[1], "utf8"));
  await call("res.company", "write", { ids: [snap.company_id], vals: { [LOCK_FIELD]: snap.before[LOCK_FIELD] || false } });
  const [c] = await call("res.company", "read", { ids: [snap.company_id], fields: [LOCK_FIELD] });
  console.log(`${LOCK_FIELD} restored → ${c[LOCK_FIELD] || "(none)"}`);
  process.exit(0);
}

const month = args.find((a) => /^\d{4}-\d{2}$/.test(a));
if (!month) { console.error("usage: node scripts/acct-month-close.mjs YYYY-MM [--lock] [--dry-run] [--json]"); process.exit(2); }
const lock = args.includes("--lock");
const dryRun = args.includes("--dry-run");

const r = await runMonthClose(call, {
  month, today: todayRiyadh(), lock, dryRun,
  beforeLock: async (company) => {
    const file = new URL(`./artifacts/acct-month-close-${month}-lock-${Date.now()}.json`, import.meta.url);
    writeFileSync(file, JSON.stringify({
      month, company_id: company.id, at: new Date().toISOString(),
      before: Object.fromEntries(Object.entries(company).filter(([k]) => k.endsWith("lock_date"))),
      rollback: `node scripts/acct-month-close.mjs --restore-lock ${file.pathname}`,
    }, null, 2));
    console.log(`lock snapshot → ${file.pathname}`);
  },
}).catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });

if (args.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }

const s = r.summary;
console.log(`\nإقفال ${month}  (${r.first} → ${r.last})  اليوم ${r.today}${dryRun ? "  [dry-run]" : ""}`);
console.log("\n── ملخص الشهر (قيود مرحّلة فقط)");
console.log(`  الإيراد                 ${fmt(s.revenue).padStart(14)}`);
console.log(`  تكلفة البضاعة           ${fmt(s.cogs).padStart(14)}`);
console.log(`  مجمل الربح              ${fmt(s.gross_profit).padStart(14)}`);
console.log(`  المصاريف                ${fmt(s.expenses).padStart(14)}`);
console.log(`  صافي الربح              ${fmt(s.net_profit).padStart(14)}`);
console.log(`\n── الأرصدة في ${r.last}`);
console.log(`  الذمم المدينة (لنا)     ${fmt(s.receivables).padStart(14)}`);
console.log(`  الذمم الدائنة (علينا)   ${fmt(s.payables).padStart(14)}`);
for (const a of s.cash) console.log(`  ${`${a.code} ${a.name}`.padEnd(24)}${fmt(a.balance).padStart(14)}`);
console.log(`  مجموع الكاش والبنك      ${fmt(s.cash_total).padStart(14)}`);
for (const a of s.outstanding) console.log(`  وسيط ${`${a.code} ${a.name}`.padEnd(19)}${fmt(a.balance).padStart(14)}`);
console.log(`  الميزان متوازن          ${s.ledger_balanced ? "نعم" : "لا"}`);

console.log(`\n── الفحص: ${r.findings.length ? `${r.findings.length} ملاحظة` : "نظيف ✓"}`);
for (const f of r.findings) {
  if (f.items.error) { console.log(`  ✗ ${f.ar}: تعذّر الفحص — ${f.items.error}`); continue; }
  console.log(`  ✗ ${f.ar} (${f.items.length})`);
  for (const it of f.items.slice(0, 10)) console.log(`      - ${it.name || it.display_name || ""}${it.id ? ` [id ${it.id}]` : ""}${it.date ? ` ${it.date}` : ""}`);
  if (f.items.length > 10) console.log(`      … و${f.items.length - 10} غيرها`);
}
console.log(`\n── القفل: ${LOCK_FIELD} الحالي ${r.currentLock || "(لا يوجد)"} — ${r.locked ? `أُقفل حتى ${r.last}` : r.decision.reason}`);
