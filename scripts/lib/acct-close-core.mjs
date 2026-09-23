// UTAK — opening capital entry + monthly close, shared core (2026-09-24).
//
// Pure logic and Odoo orchestration with an injected `call(model, method,
// body, opts)`, so tests/acct-close.test.mts runs it against a fake Odoo.
// The CLI wrappers are scripts/acct-20260924-opening-capital.mjs and
// scripts/acct-month-close.mjs.

export const OPENING_REF = "UTAK-OPENING-CAPITAL";
export const OPENING_AMOUNT = 25000;
export const EQUITY_CODE = "300010";
export const BANK_JOURNAL_CODE = "BNK1";
export const OPENING_JOURNAL_CODE = "MISC";
// Global Lock Date on res.company (Odoo 19). Reversible, unlike hard_lock_date,
// which this code never touches.
export const LOCK_FIELD = "fiscalyear_lock_date";

const INCOME = new Set(["income", "income_other"]);
const COGS = new Set(["expense_direct_cost"]);
const OPEX = new Set(["expense", "expense_depreciation"]);
const INVOICE_TYPES = ["out_invoice", "out_refund", "in_invoice", "in_refund", "out_receipt", "in_receipt"];

export function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

export function todayRiyadh(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month ?? "")) return null;
  const [y, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return { first: `${month}-01`, last: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

// Odoo datetimes are UTC; a Riyadh day starts at 21:00 UTC the day before.
export function riyadhDayStartUtc(day) {
  return new Date(Date.parse(`${day}T00:00:00+03:00`)).toISOString().slice(0, 19).replace("T", " ");
}
function nextDay(day) { return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); }

// ---------------------------------------------------------------- opening

/** Returns the reasons the opening entry must not be created ([] = ok). */
export function checkOpeningAccounts({ bank, equity, bankJournal }) {
  const errors = [];
  if (!equity) errors.push(`account ${EQUITY_CODE} missing`);
  else if (equity.account_type !== "equity") errors.push(`${EQUITY_CODE} is ${equity.account_type}, expected equity`);
  if (!bankJournal) errors.push(`journal ${BANK_JOURNAL_CODE} missing`);
  else if (bankJournal.type !== "bank") errors.push(`journal ${BANK_JOURNAL_CODE} is ${bankJournal.type}, expected bank`);
  if (!bank) errors.push(`${BANK_JOURNAL_CODE} has no default account`);
  else if (bank.account_type !== "asset_cash") errors.push(`bank account ${bank.code} is ${bank.account_type}, expected asset_cash`);
  return errors;
}

export function buildOpeningLines(bankId, equityId, amount = OPENING_AMOUNT) {
  return [
    [0, 0, { account_id: bankId, name: "إيداع رأس المال المدفوع في حساب البنك", debit: amount, credit: 0 }],
    [0, 0, { account_id: equityId, name: "رأس المال المدفوع — مساهمة الشركاء", debit: 0, credit: amount }],
  ];
}

/**
 * Creates and posts the opening capital entry once.
 *   → { status: "exists" | "refused" | "dry-run" | "created", ... }
 */
export async function runOpening(call, { date, dryRun = false, amount = OPENING_AMOUNT, log = () => {} }) {
  const existing = await call("account.move", "search_read", {
    domain: [["ref", "=", OPENING_REF], ["state", "!=", "cancel"]],
    fields: ["id", "name", "state", "date"], limit: 5,
  });
  if (existing.length) return { status: "exists", moves: existing };

  const [equity] = await call("account.account", "search_read", {
    domain: [["code", "=", EQUITY_CODE]], fields: ["id", "code", "name", "account_type"], limit: 1,
  });
  const [bankJournal] = await call("account.journal", "search_read", {
    domain: [["code", "=", BANK_JOURNAL_CODE]], fields: ["id", "code", "type", "default_account_id"], limit: 1,
  });
  let bank = null;
  if (bankJournal?.default_account_id) {
    [bank] = await call("account.account", "read", {
      ids: [bankJournal.default_account_id[0]], fields: ["id", "code", "name", "account_type"],
    });
  }
  const errors = checkOpeningAccounts({ bank, equity, bankJournal });
  if (errors.length) return { status: "refused", errors };

  const [journal] = await call("account.journal", "search_read", {
    domain: [["code", "=", OPENING_JOURNAL_CODE]], fields: ["id", "code", "type"], limit: 1,
  });
  if (!journal) return { status: "refused", errors: [`journal ${OPENING_JOURNAL_CODE} missing`] };

  const lines = buildOpeningLines(bank.id, equity.id, amount);
  const plan = { journal: journal.code, date, ref: OPENING_REF, bank, equity, amount };
  log(plan);
  if (dryRun) return { status: "dry-run", plan };

  const [moveId] = await call("account.move", "create", {
    vals_list: [{
      move_type: "entry", journal_id: journal.id, date, ref: OPENING_REF,
      narration: `القيد الافتتاحي: رأس المال المدفوع ${amount.toLocaleString("en-US")} ريال مودع في البنك (${BANK_JOURNAL_CODE}).`,
      line_ids: lines,
    }],
  }, { probe: [["ref", "=", OPENING_REF], ["state", "!=", "cancel"]] });
  try {
    await call("account.move", "action_post", { ids: [moveId] });
  } catch (e) {
    try { await call("account.move", "unlink", { ids: [moveId] }); }
    catch { await call("account.move", "button_cancel", { ids: [moveId] }).catch(() => {}); }
    throw new Error(`posting refused, draft ${moveId} removed: ${e.message}`);
  }

  // guard: posted, exactly the two accounts, each side = amount
  const [head] = await call("account.move", "read", { ids: [moveId], fields: ["id", "name", "state", "date"] });
  const ml = await call("account.move.line", "search_read", {
    domain: [["move_id", "=", moveId]], fields: ["account_id", "debit", "credit", "name"],
  });
  const accounts = new Set(ml.map((l) => l.account_id[0]));
  const dr = round2(ml.filter((l) => l.account_id[0] === bank.id).reduce((s, l) => s + l.debit - l.credit, 0));
  const cr = round2(ml.filter((l) => l.account_id[0] === equity.id).reduce((s, l) => s + l.credit - l.debit, 0));
  const ok = head.state === "posted" && accounts.size === 2 && dr === amount && cr === amount;
  if (!ok) {
    await call("account.move", "button_draft", { ids: [moveId] }).catch(() => {});
    await call("account.move", "button_cancel", { ids: [moveId] }).catch(() => {});
    throw new Error(`guard failed on ${moveId} (state ${head.state}, dr ${dr}, cr ${cr}) — entry cancelled`);
  }
  return { status: "created", move: head, lines: ml, plan };
}

// ------------------------------------------------------------ month close

/**
 * lines: posted account.move.line rows {account_id:[id], debit, credit, date}
 * up to the month's last day. accounts: {id → {code, name, account_type}}.
 */
export function summarizeMonth({ lines, accounts, first, last, outstandingIds = [] }) {
  const bal = (l) => l.debit - l.credit;
  let revenue = 0, cogs = 0, opex = 0, ar = 0, ap = 0, dr = 0, cr = 0;
  const liquid = new Map(Object.entries(accounts).filter(([, a]) => a.account_type === "asset_cash").map(([id]) => [Number(id), 0]));
  const outstanding = new Map(outstandingIds.filter((id) => accounts[id]).map((id) => [id, 0]));
  for (const l of lines) {
    if (l.date > last) continue;
    const id = Array.isArray(l.account_id) ? l.account_id[0] : l.account_id;
    const a = accounts[id];
    if (!a) continue;
    dr += l.debit; cr += l.credit;
    const inMonth = l.date >= first;
    if (inMonth && INCOME.has(a.account_type)) revenue -= bal(l);
    if (inMonth && COGS.has(a.account_type)) cogs += bal(l);
    if (inMonth && OPEX.has(a.account_type)) opex += bal(l);
    if (a.account_type === "asset_receivable") ar += bal(l);
    if (a.account_type === "liability_payable") ap -= bal(l);
    if (a.account_type === "asset_cash") liquid.set(id, (liquid.get(id) ?? 0) + bal(l));
    if (outstandingIds.includes(id)) outstanding.set(id, (outstanding.get(id) ?? 0) + bal(l));
  }
  const gross = revenue - cogs;
  const view = (m) => [...m].map(([id, v]) => ({ id, code: accounts[id].code, name: accounts[id].name, balance: round2(v) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    revenue: round2(revenue),
    cogs: round2(cogs),
    gross_profit: round2(gross),
    expenses: round2(opex),
    net_profit: round2(gross - opex),
    receivables: round2(ar),
    payables: round2(ap),
    cash: view(liquid),
    cash_total: round2([...liquid.values()].reduce((s, v) => s + v, 0)),
    outstanding: view(outstanding),
    ledger_balanced: round2(dr) === round2(cr),
  };
}

/** May the month be locked? Locks only on --lock, a clean check and an ended month. */
export function evaluateLock({ lockRequested, findings, last, today, currentLock }) {
  if (!lockRequested) return { lock: false, reason: "no --lock: nothing locked" };
  if (findings.length) return { lock: false, reason: `${findings.length} finding(s): month not clean` };
  if (!(last < today)) return { lock: false, reason: `month not over (last day ${last}, today ${today})` };
  if (currentLock && currentLock >= last) return { lock: false, reason: `already locked up to ${currentLock}` };
  return { lock: true, reason: `set ${LOCK_FIELD} ${currentLock || "(none)"} → ${last}` };
}

// UTAK records: x_name is often empty, so each check names its own label.
async function records(call, model, domain, fields, label) {
  try {
    const rows = await call(model, "search_read", { domain, fields: ["id", ...fields], limit: 50 });
    return rows.map((r) => ({ id: r.id, display_name: label(r) }));
  } catch (e) { return { error: e.message }; }
}
const m2o = (v) => (Array.isArray(v) ? v[1] || `#${v[0]}` : "—");

/** Read-only checks. Returns [{code, ar, items}] — empty = clean month. */
export async function collectFindings(call, { first, last, month, summary, outstandingIds, suspenseIds, accounts }) {
  const findings = [];
  const add = (code, ar, items) => { if (items?.error || items?.length) findings.push({ code, ar, items }); };

  const drafts = await call("account.move", "search_read", {
    domain: [["state", "=", "draft"], ["date", ">=", first], ["date", "<=", last]],
    fields: ["id", "name", "move_type", "date", "ref", "amount_total"], limit: 200,
  });
  add("unposted_entries", "قيود يومية غير مرحّلة", drafts.filter((m) => !INVOICE_TYPES.includes(m.move_type)));
  add("draft_invoices", "فواتير أو فواتير موردين مسودة", drafts.filter((m) => INVOICE_TYPES.includes(m.move_type)));

  if (!summary.ledger_balanced) add("ledger_unbalanced", "الميزان العام غير متوازن", [{ id: 0, display_name: "مجموع المدين ≠ مجموع الدائن" }]);
  add("outstanding_unmatched", "مبالغ في حسابات الوسيط لم تُطابق مع كشف البنك",
    summary.outstanding.filter((a) => a.balance !== 0).map((a) => ({ id: a.id, display_name: `${a.code} ${a.name}: ${a.balance}` })));
  if (suspenseIds.length) {
    const sus = await call("account.move.line", "search_read", {
      domain: [["account_id", "in", suspenseIds], ["parent_state", "=", "posted"], ["date", "<=", last]],
      fields: ["debit", "credit", "account_id"], limit: 1000,
    });
    const b = round2(sus.reduce((s, l) => s + l.debit - l.credit, 0));
    if (b !== 0) add("suspense_balance", "رصيد في حساب البنك المعلّق", [{ id: suspenseIds[0], display_name: `${b}` }]);
  }

  // UTAK records of the month that never reached accounting (simulation excluded)
  const real = ["x_is_simulation", "!=", true];
  add("order_without_sale", "طلبات مسلّمة بلا أمر بيع", await records(call, "x_daily_order", [
    real, ["x_state", "in", ["delivered", "closed"]], ["x_order_date", ">=", first], ["x_order_date", "<=", last], ["x_sale_order_id", "=", false],
  ], ["x_order_date", "x_customer_id", "x_total_amount"], (r) => `طلب ${r.id} ${r.x_order_date} — ${m2o(r.x_customer_id)} — ${r.x_total_amount}`));
  add("sale_not_invoiced", "أوامر بيع مسلّمة لم تُفوتر", await records(call, "x_daily_order", [
    real, ["x_state", "in", ["delivered", "closed"]], ["x_order_date", ">=", first], ["x_order_date", "<=", last],
    ["x_sale_order_id", "!=", false], ["x_sale_order_id.invoice_status", "=", "to invoice"],
  ], ["x_order_date", "x_sale_order_id"], (r) => `طلب ${r.id} ${r.x_order_date} — ${m2o(r.x_sale_order_id)}`));
  add("purchase_without_bill", "قوائم شراء مغلقة بلا فاتورة مورد", await records(call, "x_purchase_list", [
    real, ["x_status", "=", "done"], ["x_date", ">=", first], ["x_date", "<=", last], ["x_account_move_id", "=", false],
  ], ["x_date", "x_supplier_id", "x_total_items_count"], (r) => `قائمة ${r.id} ${r.x_date} — المورد ${m2o(r.x_supplier_id)} — ${r.x_total_items_count} صنف`));
  add("invoice_without_move", "فواتير UTAK بلا قيد محاسبي", await records(call, "x_invoice", [
    real, ["x_invoice_date", ">=", first], ["x_invoice_date", "<=", last], ["x_account_move_id", "=", false],
  ], ["x_invoice_number", "x_invoice_date", "x_total"], (r) => `${r.x_invoice_number || `فاتورة ${r.id}`} ${r.x_invoice_date} — ${r.x_total}`));
  add("collection_without_payment", "تحصيلات بلا دفعة محاسبية", await records(call, "x_payment", [
    real, ["x_method", "in", ["cash", "transfer"]], ["x_collected_at", ">=", riyadhDayStartUtc(first)], ["x_collected_at", "<", riyadhDayStartUtc(nextDay(last))],
    ["x_account_payment_id", "=", false],
  ], ["x_amount", "x_method", "x_collected_at", "x_collected_by", "x_invoice_id"],
  (r) => `تحصيل ${r.id} ${r.x_collected_at} UTC — ${r.x_amount} ${r.x_method} — بواسطة ${m2o(r.x_collected_by)} — فاتورة UTAK ${Array.isArray(r.x_invoice_id) ? r.x_invoice_id[0] : "—"}`));

  // payroll: salaried employees but no UTAK-PAYROLL-<month> entry
  const salaried = await call("res.partner", "search_count", {
    domain: [["active", "=", true], ["x_monthly_salary", ">", 0], real],
  });
  if (salaried) {
    const pay = await call("account.move", "search_count", { domain: [["ref", "=", `UTAK-PAYROLL-${month}`], ["state", "=", "posted"]] });
    if (!pay) add("payroll_missing", "موظفون لهم راتب ولا قيد رواتب للشهر", [{ id: 0, display_name: `${salaried} موظف` }]);
  }
  return findings;
}

/**
 * Month close. Read-only unless lock=true and evaluateLock allows it; the
 * previous lock values are returned so the caller can snapshot them first.
 */
export async function runMonthClose(call, { month, today, lock = false, dryRun = false, beforeLock = async () => {} }) {
  const range = monthRange(month);
  if (!range) throw new Error(`bad month ${month} (YYYY-MM)`);
  const { first, last } = range;
  if (first > today) throw new Error(`${month} has not started (today ${today})`);

  const accList = await call("account.account", "search_read", {
    domain: [], fields: ["id", "code", "name", "account_type"], context: { active_test: false },
  });
  const accounts = Object.fromEntries(accList.map((a) => [a.id, a]));
  const pml = await call("account.payment.method.line", "search_read", {
    domain: [["payment_account_id", "!=", false]], fields: ["payment_account_id"],
  });
  const outstandingIds = [...new Set(pml.map((l) => l.payment_account_id[0]))]
    .filter((id) => accounts[id]?.account_type !== "asset_cash");
  const journals = await call("account.journal", "search_read", {
    domain: [["type", "in", ["bank", "cash"]]], fields: ["suspense_account_id"],
  });
  const suspenseIds = [...new Set(journals.filter((j) => j.suspense_account_id).map((j) => j.suspense_account_id[0]))];

  const lines = await call("account.move.line", "search_read", {
    domain: [["parent_state", "=", "posted"], ["date", "<=", last]],
    fields: ["account_id", "debit", "credit", "date"],
  });
  const summary = summarizeMonth({ lines, accounts, first, last, outstandingIds });
  const findings = await collectFindings(call, { first, last, month, summary, outstandingIds, suspenseIds, accounts });

  const [company] = await call("res.company", "search_read", {
    domain: [], fields: ["id", "name", LOCK_FIELD, "tax_lock_date", "sale_lock_date", "purchase_lock_date", "hard_lock_date"], limit: 1,
  });
  const currentLock = company[LOCK_FIELD] || null;
  const decision = evaluateLock({ lockRequested: lock, findings, last, today, currentLock });
  let locked = false;
  if (decision.lock && !dryRun) {
    await beforeLock(company);
    await call("res.company", "write", { ids: [company.id], vals: { [LOCK_FIELD]: last } });
    const [after] = await call("res.company", "read", { ids: [company.id], fields: [LOCK_FIELD] });
    if (after[LOCK_FIELD] !== last) throw new Error(`lock write not applied: ${after[LOCK_FIELD]}`);
    locked = true;
  }
  return { month, first, last, today, summary, findings, company, currentLock, decision, locked, dryRun };
}
