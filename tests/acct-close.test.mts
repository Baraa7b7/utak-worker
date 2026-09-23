// Unit tests for the opening capital entry + monthly close (2026-09-24).
//   1. Opening: an existing UTAK-OPENING-CAPITAL entry → nothing created
//   2. Opening: first run creates + posts once; a second run finds it
//   3. Opening: 300010 not equity / bank account not asset_cash / BNK1 not
//      a bank journal → refused, no create
//   4. Opening: guard (wrong amount read back) → entry cancelled, throws
//   5. summarizeMonth on fake lines: revenue, COGS, gross, expenses, net,
//      AR/AP, cash, outstanding, lines of other months
//   6. evaluateLock: no --lock / findings / month not over / already locked
//   7. runMonthClose: without --lock no write; --lock with a finding → no
//      write; --lock on a clean ended month → one write of the last day,
//      snapshot hook called before it; --lock --dry-run → no write
//
// Same no-framework style as tests/vat.test.mts. No network: `call` is fake.

import {
  OPENING_REF,
  LOCK_FIELD,
  checkOpeningAccounts,
  evaluateLock,
  monthRange,
  riyadhDayStartUtc,
  runMonthClose,
  runOpening,
  summarizeMonth,
} from "../scripts/lib/acct-close-core.mjs";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}`); }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error("BLOCKED network in acct-close.test"); }) as typeof fetch;

type Call = { model: string; method: string; body: any };

// ---- fake Odoo for the opening entry
function openingOdoo(opts: {
  existing?: any[]; equityType?: string; bankType?: string; journalType?: string; readBackAmount?: number;
} = {}) {
  const log: Call[] = [];
  const moves: any[] = [...(opts.existing ?? [])];
  const amountBack = opts.readBackAmount;
  const call = async (model: string, method: string, body: any) => {
    log.push({ model, method, body });
    const key = `${model}.${method}`;
    if (key === "account.move.search_read") {
      const ref = body.domain.find((d: any) => d[0] === "ref")?.[2];
      return moves.filter((m) => m.ref === ref && m.state !== "cancel");
    }
    if (key === "account.account.search_read") return [{ id: 256, code: "300010", name: "رأس المال المدفوع", account_type: opts.equityType ?? "equity" }];
    if (key === "account.journal.search_read") {
      const code = body.domain[0][2];
      if (code === "BNK1") return [{ id: 13, code: "BNK1", type: opts.journalType ?? "bank", default_account_id: [247, "101001 Bank"] }];
      if (code === "MISC") return [{ id: 10, code: "MISC", type: "general" }];
      return [];
    }
    if (key === "account.account.read") return [{ id: 247, code: "101001", name: "Bank", account_type: opts.bankType ?? "asset_cash" }];
    if (key === "account.move.create") {
      const v = body.vals_list[0];
      const id = 100 + moves.length;
      moves.push({ id, name: false, state: "draft", date: v.date, ref: v.ref, lines: v.line_ids.map((l: any) => l[2]) });
      return [id];
    }
    if (key === "account.move.action_post") {
      const m = moves.find((x) => x.id === body.ids[0]); m.state = "posted"; m.name = "MISC/2026/09/0001"; return true;
    }
    if (key === "account.move.read") {
      const m = moves.find((x) => x.id === body.ids[0]); return [{ id: m.id, name: m.name, state: m.state, date: m.date }];
    }
    if (key === "account.move.line.search_read") {
      const m = moves.find((x) => x.id === body.domain[0][2]);
      return m.lines.map((l: any) => ({
        account_id: [l.account_id, ""], name: l.name,
        debit: l.debit ? (amountBack ?? l.debit) : 0, credit: l.credit,
      }));
    }
    if (key === "account.move.button_draft") return true;
    if (key === "account.move.button_cancel") { const m = moves.find((x) => x.id === body.ids[0]); m.state = "cancel"; return true; }
    throw new Error(`unexpected ${key}`);
  };
  return { call, log, moves };
}

async function testOpeningExists(): Promise<void> {
  console.log("\n[1] opening: existing entry → nothing created");
  const f = openingOdoo({ existing: [{ id: 61, name: "MISC/2026/09/0001", state: "posted", date: "2026-09-24", ref: OPENING_REF }] });
  const r = await runOpening(f.call, { date: "2026-09-24" });
  assert("status exists", r.status === "exists");
  assert("no create", !f.log.some((c) => c.method === "create"));
  assert("no post", !f.log.some((c) => c.method === "action_post"));
}

async function testOpeningOnce(): Promise<void> {
  console.log("\n[2] opening: created once, second run exists");
  const f = openingOdoo();
  const r1 = await runOpening(f.call, { date: "2026-09-24" });
  assert("first run created", r1.status === "created");
  const create = f.log.find((c) => c.method === "create")!;
  const v = create.body.vals_list[0];
  assert("journal MISC", v.journal_id === 10);
  assert("ref UTAK-OPENING-CAPITAL", v.ref === OPENING_REF);
  assert("date passed through", v.date === "2026-09-24");
  const [dr, cr] = v.line_ids.map((l: any) => l[2]);
  assert("Dr bank 25,000", dr.account_id === 247 && dr.debit === 25000 && dr.credit === 0);
  assert("Cr 300010 25,000", cr.account_id === 256 && cr.credit === 25000 && cr.debit === 0);
  assert("Arabic descriptions", /رأس المال/.test(dr.name) && /رأس المال/.test(cr.name));
  const r2 = await runOpening(f.call, { date: "2026-09-24" });
  assert("second run exists", r2.status === "exists");
  assert("exactly one create overall", f.log.filter((c) => c.method === "create").length === 1);
  const d = openingOdoo();
  const rd = await runOpening(d.call, { date: "2026-09-24", dryRun: true });
  assert("dry-run writes nothing", rd.status === "dry-run" && !d.log.some((c) => ["create", "action_post", "write"].includes(c.method)));
}

async function testOpeningRefused(): Promise<void> {
  console.log("\n[3] opening: wrong account types → refused");
  for (const [label, opts] of [
    ["300010 is income", { equityType: "income" }],
    ["300010 is liability_current", { equityType: "liability_current" }],
    ["bank account is asset_current", { bankType: "asset_current" }],
    ["bank account is expense", { bankType: "expense" }],
    ["BNK1 is a general journal", { journalType: "general" }],
  ] as const) {
    const f = openingOdoo(opts);
    const r = await runOpening(f.call, { date: "2026-09-24" });
    assert(`${label} → refused`, r.status === "refused" && r.errors.length >= 1);
    assert(`${label} → no create`, !f.log.some((c) => c.method === "create"));
  }
  assert("pure check ok on the right types", checkOpeningAccounts({
    bank: { code: "101001", account_type: "asset_cash" }, equity: { account_type: "equity" }, bankJournal: { type: "bank" },
  }).length === 0);
  assert("pure check: missing accounts", checkOpeningAccounts({ bank: null, equity: null, bankJournal: null }).length === 3);
}

async function testOpeningGuard(): Promise<void> {
  console.log("\n[4] opening: guard cancels a wrong entry");
  const f = openingOdoo({ readBackAmount: 2500 });
  let threw = false;
  try { await runOpening(f.call, { date: "2026-09-24" }); } catch (e) { threw = /guard failed/.test((e as Error).message); }
  assert("throws guard failed", threw);
  assert("entry cancelled", f.moves[0].state === "cancel");
}

// ---- month summary
const ACCOUNTS: Record<number, any> = {
  1: { code: "500001", name: "Sales", account_type: "income" },
  2: { code: "400001", name: "COGS", account_type: "expense_direct_cost" },
  3: { code: "400077", name: "Fuel", account_type: "expense" },
  4: { code: "102011", name: "AR", account_type: "asset_receivable" },
  5: { code: "201002", name: "AP", account_type: "liability_payable" },
  6: { code: "101001", name: "Bank", account_type: "asset_cash" },
  7: { code: "101007", name: "كاش السائق", account_type: "asset_cash" },
  8: { code: "300010", name: "Capital", account_type: "equity" },
  9: { code: "101003", name: "Outstanding Receipts", account_type: "asset_current" },
  10: { code: "201017", name: "VAT", account_type: "liability_current" },
  11: { code: "500010", name: "Other income", account_type: "income_other" },
};
const L = (account: number, debit: number, credit: number, date: string) => ({ account_id: [account, ""], debit, credit, date });
const FAKE_LINES = [
  // capital in August (balance only)
  L(6, 25000, 0, "2026-08-31"), L(8, 0, 25000, "2026-08-31"),
  // August sale — not September revenue
  L(4, 500, 0, "2026-08-20"), L(1, 0, 500, "2026-08-20"),
  // September: sale 1,150 incl. VAT → 1,000 revenue + 150 VAT
  L(4, 1150, 0, "2026-09-10"), L(1, 0, 1000, "2026-09-10"), L(10, 0, 150, "2026-09-10"),
  // cash collection 700 (driver cash) and 300 by transfer (outstanding)
  L(7, 700, 0, "2026-09-12"), L(4, 0, 700, "2026-09-12"),
  L(9, 300, 0, "2026-09-13"), L(4, 0, 300, "2026-09-13"),
  // vendor bill 600 cost of goods
  L(2, 600, 0, "2026-09-11"), L(5, 0, 600, "2026-09-11"),
  // fuel 50 paid from bank; refund of 20 on the sale (debit income)
  L(3, 50, 0, "2026-09-15"), L(6, 0, 50, "2026-09-15"),
  L(1, 20, 0, "2026-09-16"), L(4, 0, 20, "2026-09-16"),
  // other income 5
  L(6, 5, 0, "2026-09-17"), L(11, 0, 5, "2026-09-17"),
  // October — ignored
  L(4, 999, 0, "2026-10-01"), L(1, 0, 999, "2026-10-01"),
];

function testSummary(): void {
  console.log("\n[5] summarizeMonth on fake data");
  const s = summarizeMonth({ lines: FAKE_LINES, accounts: ACCOUNTS, first: "2026-09-01", last: "2026-09-30", outstandingIds: [9] });
  assert(`revenue 985 (1000 − 20 + 5) → ${s.revenue}`, s.revenue === 985);
  assert(`COGS 600 → ${s.cogs}`, s.cogs === 600);
  assert(`gross profit 385 → ${s.gross_profit}`, s.gross_profit === 385);
  assert(`expenses 50 → ${s.expenses}`, s.expenses === 50);
  assert(`net profit 335 → ${s.net_profit}`, s.net_profit === 335);
  assert(`receivables 630 (500 + 1150 − 700 − 300 − 20) → ${s.receivables}`, s.receivables === 630);
  assert(`payables 600 → ${s.payables}`, s.payables === 600);
  const bank = s.cash.find((a: any) => a.code === "101001");
  const drv = s.cash.find((a: any) => a.code === "101007");
  assert(`bank 24,955 → ${bank?.balance}`, bank?.balance === 24955);
  assert(`driver cash 700 → ${drv?.balance}`, drv?.balance === 700);
  assert(`cash total 25,655 → ${s.cash_total}`, s.cash_total === 25655);
  assert("outstanding 300", s.outstanding.length === 1 && s.outstanding[0].balance === 300);
  assert("ledger balanced", s.ledger_balanced === true);
  const unbalanced = summarizeMonth({ lines: [...FAKE_LINES, L(6, 1, 0, "2026-09-20")], accounts: ACCOUNTS, first: "2026-09-01", last: "2026-09-30" });
  assert("unbalanced ledger detected", unbalanced.ledger_balanced === false);
  const loss = summarizeMonth({ lines: [L(3, 80, 0, "2026-09-05"), L(6, 0, 80, "2026-09-05")], accounts: ACCOUNTS, first: "2026-09-01", last: "2026-09-30" });
  assert(`a month with only expenses → net −80 (${loss.net_profit})`, loss.net_profit === -80);
  assert("monthRange 2026-09", JSON.stringify(monthRange("2026-09")) === JSON.stringify({ first: "2026-09-01", last: "2026-09-30" }));
  assert("monthRange 2026-02", monthRange("2026-02")?.last === "2026-02-28");
  assert("monthRange rejects 2026-13", monthRange("2026-13") === null);
  assert("Riyadh day start = 21:00 UTC the day before", riyadhDayStartUtc("2026-09-01") === "2026-08-31 21:00:00");
}

function testEvaluateLock(): void {
  console.log("\n[6] evaluateLock");
  const base = { findings: [], last: "2026-09-30", today: "2026-10-02", currentLock: null };
  assert("no --lock → no lock", evaluateLock({ ...base, lockRequested: false }).lock === false);
  assert("findings → no lock", evaluateLock({ ...base, lockRequested: true, findings: [{ code: "x", items: [1] }] }).lock === false);
  assert("month not over → no lock", evaluateLock({ ...base, lockRequested: true, today: "2026-09-30" }).lock === false);
  assert("already locked → no lock", evaluateLock({ ...base, lockRequested: true, currentLock: "2026-09-30" }).lock === false);
  assert("clean + ended + --lock → lock", evaluateLock({ ...base, lockRequested: true, currentLock: "2026-08-31" }).lock === true);
}

// ---- fake Odoo for the month close
function closeOdoo(opts: { draft?: any[]; orphanOrders?: any[] } = {}) {
  const log: Call[] = [];
  const company: any = { id: 1, name: "UTAK", [LOCK_FIELD]: false, tax_lock_date: false, sale_lock_date: false, purchase_lock_date: false, hard_lock_date: false };
  const accList = Object.entries(ACCOUNTS).map(([id, a]) => ({ id: Number(id), ...a }));
  const call = async (model: string, method: string, body: any) => {
    log.push({ model, method, body });
    const key = `${model}.${method}`;
    if (key === "account.account.search_read") return accList;
    if (key === "account.payment.method.line.search_read") return [{ payment_account_id: [6, ""] }, { payment_account_id: [9, ""] }];
    if (key === "account.journal.search_read") return [{ suspense_account_id: [12, ""] }];
    if (key === "account.move.line.search_read") {
      if (body.domain.some((d: any) => d[0] === "account_id")) return []; // suspense
      // balanced lines only, outstanding cleared
      return FAKE_LINES.filter((l) => l.account_id[0] !== 9 && !(l.account_id[0] === 4 && l.credit === 300))
        .concat([L(6, 300, 0, "2026-09-13"), L(4, 0, 300, "2026-09-13")]);
    }
    if (key === "account.move.search_read") return opts.draft ?? [];
    if (key === "x_daily_order.search_read") {
      const saleCheck = body.domain.some((d: any) => d[0] === "x_sale_order_id" && d[2] === false);
      return saleCheck ? opts.orphanOrders ?? [] : [];
    }
    if (method === "search_read" && model.startsWith("x_")) return [];
    if (key === "res.partner.search_count") return 0;
    if (key === "account.move.search_count") return 0;
    if (key === "res.company.search_read") return [{ ...company }];
    if (key === "res.company.write") { Object.assign(company, body.vals); return true; }
    if (key === "res.company.read") return [{ id: 1, [LOCK_FIELD]: company[LOCK_FIELD] }];
    throw new Error(`unexpected ${key}`);
  };
  return { call, log, company };
}

async function testMonthClose(): Promise<void> {
  console.log("\n[7] runMonthClose and the lock");
  const writes = (log: Call[]) => log.filter((c) => ["write", "create", "unlink", "action_post"].includes(c.method));

  const a = closeOdoo();
  const ra = await runMonthClose(a.call, { month: "2026-09", today: "2026-10-02" });
  assert("clean month: no finding", ra.findings.length === 0);
  assert("clean month: net profit 335", ra.summary.net_profit === 335);
  assert("without --lock: no write at all", writes(a.log).length === 0 && !ra.locked);

  const b = closeOdoo({ draft: [{ id: 30, name: false, move_type: "out_invoice", date: "2026-09-20" }] });
  const rb = await runMonthClose(b.call, { month: "2026-09", today: "2026-10-02", lock: true });
  assert("draft invoice → finding draft_invoices", rb.findings.some((f: any) => f.code === "draft_invoices"));
  assert("--lock with a finding → no write", writes(b.log).length === 0 && !rb.locked);

  const c = closeOdoo({ orphanOrders: [{ id: 5, display_name: "ORD-5" }] });
  const rc = await runMonthClose(c.call, { month: "2026-09", today: "2026-10-02", lock: true });
  assert("delivered order without sale.order → finding", rc.findings.some((f: any) => f.code === "order_without_sale"));
  assert("--lock with a missing record → no write", writes(c.log).length === 0);

  const d = closeOdoo();
  const rd = await runMonthClose(d.call, { month: "2026-09", today: "2026-09-24", lock: true });
  assert("--lock before month end → no write", writes(d.log).length === 0 && /not over/.test(rd.decision.reason));

  const e = closeOdoo();
  let snapshotBeforeWrite = false;
  const re = await runMonthClose(e.call, {
    month: "2026-09", today: "2026-10-02", lock: true,
    beforeLock: async () => { snapshotBeforeWrite = !e.log.some((x) => x.method === "write"); },
  });
  const w = writes(e.log);
  assert("clean + ended + --lock → locked", re.locked === true);
  assert(`exactly one write: ${LOCK_FIELD} = 2026-09-30`, w.length === 1 && w[0].model === "res.company" && w[0].body.vals[LOCK_FIELD] === "2026-09-30" && Object.keys(w[0].body.vals).length === 1);
  assert("snapshot taken before the write", snapshotBeforeWrite);
  assert("hard_lock_date never written", !w.some((x) => "hard_lock_date" in x.body.vals));

  const f = closeOdoo();
  const rf = await runMonthClose(f.call, { month: "2026-09", today: "2026-10-02", lock: true, dryRun: true });
  assert("--lock --dry-run → would lock, no write", rf.decision.lock === true && !rf.locked && writes(f.log).length === 0);

  let threw = false;
  try { await runMonthClose(closeOdoo().call, { month: "2026-11", today: "2026-10-02" }); } catch { threw = true; }
  assert("a month not started is refused", threw);
}

async function main(): Promise<void> {
  try {
    await testOpeningExists();
    await testOpeningOnce();
    await testOpeningRefused();
    await testOpeningGuard();
    testSummary();
    testEvaluateLock();
    await testMonthClose();
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(`\nacct-close: ${passed} passed, ${failed} failed`);
  if (failed) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}
main();
