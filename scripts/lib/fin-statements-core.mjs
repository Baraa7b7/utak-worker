// Financial statements core (2026-09-24). Pure functions over posted
// account.move.line rows, plus two read-only Odoo readers (the ledger, and
// Odoo's own reports for the cross-check). Nothing here writes to Odoo.
//
// Every figure comes from account.move.line of POSTED entries (parent_state
// = "posted"), grouped by account and account_type, within the period. All
// sums run in integer halalas; the result is in SAR with 2 decimals.
//
// Statements: trial balance, balance sheet (as at `to`), income statement
// (from..to), cash flows (indirect, from..to, reconciled to the cash
// accounts' opening and closing balances), changes in equity. The balance
// sheet and the cash reconciliation must hold exactly, or computeStatements
// throws StatementsError and no document is produced.

export class StatementsError extends Error {
  constructor(message, details) { super(message); this.name = "StatementsError"; this.details = details; }
}

export const OWNER_ACCOUNT_CODE = "201021";

// account_type → where it lands. Anything else (except off_balance) is refused.
const PL_TYPES = new Set(["income", "income_other", "expense", "expense_depreciation", "expense_other", "expense_direct_cost"]);
export const BS_GROUPS = {
  currentAssets: ["asset_cash", "asset_receivable", "asset_current", "asset_prepayments"],
  nonCurrentAssets: ["asset_fixed", "asset_non_current"],
  currentLiabilities: ["liability_payable", "liability_current", "liability_credit_card"],
  nonCurrentLiabilities: ["liability_non_current"],
  equity: ["equity"],
  retained: ["equity_unaffected"],
};
const BS_TYPES = new Set(Object.values(BS_GROUPS).flat());

// Bilingual labels used by the renderers and the workbook.
export const L = {
  // statements
  bs: ["قائمة المركز المالي", "Statement of Financial Position"],
  is: ["قائمة الدخل", "Statement of Profit or Loss"],
  cf: ["قائمة التدفقات النقدية", "Statement of Cash Flows"],
  eq: ["قائمة التغيرات في حقوق الملكية", "Statement of Changes in Equity"],
  tb: ["ميزان المراجعة", "Trial Balance"],
  // balance sheet
  assets: ["الأصول", "Assets"],
  currentAssets: ["الأصول المتداولة", "Current assets"],
  nonCurrentAssets: ["الأصول غير المتداولة", "Non-current assets"],
  totalCurrentAssets: ["مجموع الأصول المتداولة", "Total current assets"],
  totalNonCurrentAssets: ["مجموع الأصول غير المتداولة", "Total non-current assets"],
  totalAssets: ["مجموع الأصول", "Total assets"],
  liabilities: ["الالتزامات", "Liabilities"],
  currentLiabilities: ["الالتزامات المتداولة", "Current liabilities"],
  nonCurrentLiabilities: ["الالتزامات غير المتداولة", "Non-current liabilities"],
  totalCurrentLiabilities: ["مجموع الالتزامات المتداولة", "Total current liabilities"],
  totalNonCurrentLiabilities: ["مجموع الالتزامات غير المتداولة", "Total non-current liabilities"],
  totalLiabilities: ["مجموع الالتزامات", "Total liabilities"],
  equity: ["حقوق الملكية", "Equity"],
  retainedPrior: ["أرباح (خسائر) مبقاة من فترات سابقة", "Retained earnings — prior periods"],
  periodResult: ["صافي نتيجة الفترة", "Net result for the period"],
  totalEquity: ["مجموع حقوق الملكية", "Total equity"],
  totalLE: ["مجموع الالتزامات وحقوق الملكية", "Total liabilities and equity"],
  // income statement
  revenue: ["الإيرادات", "Revenue"],
  totalRevenue: ["مجموع الإيرادات", "Total revenue"],
  cogs: ["تكلفة البضاعة المباعة", "Cost of goods sold"],
  totalCogs: ["مجموع تكلفة البضاعة المباعة", "Total cost of goods sold"],
  gross: ["مجمل الربح", "Gross profit"],
  otherIncome: ["إيرادات أخرى", "Other income"],
  expenses: ["المصاريف", "Expenses"],
  totalExpenses: ["مجموع المصاريف", "Total expenses"],
  net: ["صافي الربح (الخسارة)", "Net profit (loss)"],
  // cash flows
  operating: ["التدفقات النقدية من الأنشطة التشغيلية", "Cash flows from operating activities"],
  depreciation: ["الإهلاك والاستهلاك", "Depreciation and amortisation"],
  wc_asset_receivable: ["(الزيادة) النقص في الذمم المدينة", "(Increase) decrease in receivables"],
  wc_asset_current: ["(الزيادة) النقص في الأصول المتداولة الأخرى", "(Increase) decrease in other current assets"],
  wc_asset_prepayments: ["(الزيادة) النقص في المصروفات المدفوعة مقدماً", "(Increase) decrease in prepayments"],
  wc_liability_payable: ["الزيادة (النقص) في الذمم الدائنة", "Increase (decrease) in payables"],
  wc_liability_current: ["الزيادة (النقص) في الالتزامات المتداولة الأخرى", "Increase (decrease) in other current liabilities"],
  wc_liability_credit_card: ["الزيادة (النقص) في بطاقات الائتمان", "Increase (decrease) in credit cards"],
  netOperating: ["صافي النقد من الأنشطة التشغيلية", "Net cash from operating activities"],
  investing: ["التدفقات النقدية من الأنشطة الاستثمارية", "Cash flows from investing activities"],
  inv_fixed: ["(شراء) بيع الأصول الثابتة وغير المتداولة", "(Purchase) disposal of fixed and non-current assets"],
  netInvesting: ["صافي النقد من الأنشطة الاستثمارية", "Net cash from investing activities"],
  financing: ["التدفقات النقدية من الأنشطة التمويلية", "Cash flows from financing activities"],
  fin_equity: ["رأس المال المدفوع", "Paid-in capital"],
  fin_retained: ["حركات مباشرة على الأرباح المبقاة", "Direct movements in retained earnings"],
  fin_owner: ["جاري المالك", "Owner current account"],
  fin_non_current: ["الالتزامات غير المتداولة", "Non-current liabilities"],
  netFinancing: ["صافي النقد من الأنشطة التمويلية", "Net cash from financing activities"],
  netChange: ["صافي التغير في النقد وما في حكمه", "Net change in cash and cash equivalents"],
  openingCash: ["النقد وما في حكمه أول الفترة", "Cash and cash equivalents at beginning of period"],
  closingCash: ["النقد وما في حكمه آخر الفترة", "Cash and cash equivalents at end of period"],
  // equity changes
  paidIn: ["رأس المال المدفوع", "Paid-in capital"],
  retained: ["الأرباح المبقاة", "Retained earnings"],
  total: ["المجموع", "Total"],
  eqOpening: ["الرصيد أول الفترة", "Balance at beginning of period"],
  eqCapital: ["رأس المال المدفوع خلال الفترة", "Capital paid in during the period"],
  eqOther: ["حركات أخرى على حقوق الملكية", "Other movements in equity"],
  eqClosing: ["الرصيد آخر الفترة", "Balance at end of period"],
  // trial balance
  account: ["الحساب", "Account"],
  code: ["الرمز", "Code"],
  opening: ["الرصيد الافتتاحي", "Opening balance"],
  debit: ["مدين", "Debit"],
  credit: ["دائن", "Credit"],
  closingDr: ["الرصيد الختامي مدين", "Closing debit"],
  closingCr: ["الرصيد الختامي دائن", "Closing credit"],
};

const cents = (x) => Math.round(Number(x || 0) * 100);
const sar = (c) => (c === 0 ? 0 : c / 100); // never -0
const sumBy = (rows, f) => rows.reduce((a, r) => a + f(r), 0);

/**
 * accounts: [{ id, code, nameAr, nameEn, type }]
 * lines:    [{ account_id, date, debit, credit, parent_state }]   (account_id: id or [id, name])
 * Returns the five statements in SAR plus the per-account ledger.
 */
export function computeStatements({ accounts, lines, from, to, ownerCode = OWNER_ACCOUNT_CODE }) {
  if (!(from <= to)) throw new StatementsError(`bad period ${from} → ${to}`);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const led = new Map(); // id → { acc, openC, drC, crC }
  let offBalance = 0;
  for (const l of lines) {
    if (l.parent_state !== "posted") continue; // drafts / cancelled never count
    if (l.date > to) continue;
    const id = Array.isArray(l.account_id) ? l.account_id[0] : l.account_id;
    const acc = byId.get(id);
    if (!acc) throw new StatementsError(`move line on unknown account ${id}`);
    if (acc.type === "off_balance") { offBalance += cents(l.debit) - cents(l.credit); continue; }
    if (!PL_TYPES.has(acc.type) && !BS_TYPES.has(acc.type)) throw new StatementsError(`unmapped account type ${acc.type} (${acc.code})`);
    const r = led.get(id) ?? { acc, openC: 0, drC: 0, crC: 0 };
    if (l.date < from) r.openC += cents(l.debit) - cents(l.credit);
    else { r.drC += cents(l.debit); r.crC += cents(l.credit); }
    led.set(id, r);
  }
  const rows = [...led.values()].map((r) => ({ ...r, closeC: r.openC + r.drC - r.crC, moveC: r.drC - r.crC }))
    .sort((a, b) => a.acc.code.localeCompare(b.acc.code));
  const ofTypes = (types) => rows.filter((r) => types.includes(r.acc.type));
  const isOwner = (r) => r.acc.code === ownerCode;

  // ---- trial balance
  const tb = {
    rows: rows.map((r) => ({
      id: r.acc.id, code: r.acc.code, nameAr: r.acc.nameAr, nameEn: r.acc.nameEn, type: r.acc.type,
      opening: sar(r.openC), debit: sar(r.drC), credit: sar(r.crC), closing: sar(r.closeC),
      closingDr: sar(Math.max(0, r.closeC)), closingCr: sar(Math.max(0, -r.closeC)),
    })),
  };
  const tbC = {
    opening: sumBy(rows, (r) => r.openC), debit: sumBy(rows, (r) => r.drC), credit: sumBy(rows, (r) => r.crC),
    closingDr: sumBy(rows, (r) => Math.max(0, r.closeC)), closingCr: sumBy(rows, (r) => Math.max(0, -r.closeC)),
  };
  tb.totals = Object.fromEntries(Object.entries(tbC).map(([k, v]) => [k, sar(v)]));
  if (tbC.debit !== tbC.credit || tbC.opening !== 0 || tbC.closingDr !== tbC.closingCr) {
    throw new StatementsError("trial balance does not balance", tb.totals);
  }
  if (offBalance !== 0) throw new StatementsError("off-balance lines do not net to zero", { offBalance: sar(offBalance) });

  // ---- income statement (period movements; income shown positive)
  const accLine = (r, sign) => ({ id: r.acc.id, code: r.acc.code, nameAr: r.acc.nameAr, nameEn: r.acc.nameEn, amountC: sign * r.moveC });
  const moved = (r) => r.drC !== 0 || r.crC !== 0;
  const revenue = ofTypes(["income"]).filter(moved).map((r) => accLine(r, -1));
  const cogs = ofTypes(["expense_direct_cost"]).filter(moved).map((r) => accLine(r, 1));
  const otherIncome = ofTypes(["income_other"]).filter(moved).map((r) => accLine(r, -1));
  const expenses = ofTypes(["expense", "expense_depreciation", "expense_other"]).filter(moved).map((r) => accLine(r, 1));
  const revC = sumBy(revenue, (x) => x.amountC), cogsC = sumBy(cogs, (x) => x.amountC);
  const oiC = sumBy(otherIncome, (x) => x.amountC), expC = sumBy(expenses, (x) => x.amountC);
  const grossC = revC - cogsC;
  const netC = grossC + oiC - expC;
  const plPeriodC = -sumBy(rows.filter((r) => PL_TYPES.has(r.acc.type)), (r) => r.moveC);
  if (plPeriodC !== netC) throw new StatementsError("income statement lines do not add up to the P&L movement", { netC, plPeriodC });

  // ---- balance sheet at `to` (assets positive; liabilities/equity positive)
  const bsLines = (types, sign, keep = () => false) => ofTypes(types).filter((r) => r.closeC !== 0 || moved(r) || r.openC !== 0 || keep(r))
    .map((r) => ({ id: r.acc.id, code: r.acc.code, nameAr: r.acc.nameAr, nameEn: r.acc.nameEn, amountC: sign * r.closeC }));
  const ca = bsLines(BS_GROUPS.currentAssets, 1);
  const nca = bsLines(BS_GROUPS.nonCurrentAssets, 1);
  const cl = bsLines(BS_GROUPS.currentLiabilities, -1);
  // The owner current account is always shown under current liabilities.
  const ownerAcc = accounts.find((a) => a.code === ownerCode);
  if (ownerAcc && !cl.some((x) => x.code === ownerCode)) cl.push({ id: ownerAcc.id, code: ownerAcc.code, nameAr: ownerAcc.nameAr, nameEn: ownerAcc.nameEn, amountC: 0 });
  cl.sort((a, b) => a.code.localeCompare(b.code));
  const ncl = bsLines(BS_GROUPS.nonCurrentLiabilities, -1);
  const eqAcc = bsLines(BS_GROUPS.equity, -1);
  const retAcc = bsLines(BS_GROUPS.retained, -1);
  const plOpenC = -sumBy(rows.filter((r) => PL_TYPES.has(r.acc.type)), (r) => r.openC);
  const T = (xs) => sumBy(xs, (x) => x.amountC);
  const caC = T(ca), ncaC = T(nca), clC = T(cl), nclC = T(ncl);
  const taC = caC + ncaC, tlC = clC + nclC;
  const teC = T(eqAcc) + T(retAcc) + plOpenC + netC;
  if (taC !== tlC + teC) {
    throw new StatementsError("balance sheet does not balance", { assets: sar(taC), liabilities: sar(tlC), equity: sar(teC), difference: sar(taC - tlC - teC) });
  }

  // ---- cash flows, indirect: every non-cash balance-sheet account's
  // movement, with the opposite sign, by activity.
  const d = (types, exclude = () => false) => -sumBy(rows.filter((r) => types.includes(r.acc.type) && !exclude(r)), (r) => r.moveC);
  const depC = sumBy(ofTypes(["expense_depreciation"]), (r) => r.moveC);
  const wc = ["asset_receivable", "asset_current", "asset_prepayments", "liability_payable", "liability_current", "liability_credit_card"]
    .map((t) => ({ key: `wc_${t}`, amountC: d([t], isOwner) }));
  const opC = netC + depC + T(wc);
  const invLines = [{ key: "inv_fixed", amountC: d(BS_GROUPS.nonCurrentAssets) - depC }];
  const invC = T(invLines);
  const ownerMoveC = -sumBy(rows.filter(isOwner), (r) => r.moveC);
  const finLines = [
    { key: "fin_equity", amountC: d(BS_GROUPS.equity) },
    { key: "fin_retained", amountC: d(BS_GROUPS.retained) },
    { key: "fin_owner", amountC: ownerMoveC },
    { key: "fin_non_current", amountC: d(BS_GROUPS.nonCurrentLiabilities, isOwner) },
  ];
  const finC = T(finLines);
  const cashRows = ofTypes(["asset_cash"]);
  const openCashC = sumBy(cashRows, (r) => r.openC), closeCashC = sumBy(cashRows, (r) => r.closeC);
  const netChangeC = opC + invC + finC;
  if (openCashC + netChangeC !== closeCashC) {
    throw new StatementsError("cash flow does not reconcile to the cash accounts", { opening: sar(openCashC), netChange: sar(netChangeC), closing: sar(closeCashC) });
  }

  // ---- changes in equity
  const eqOpenPaidC = -sumBy(ofTypes(BS_GROUPS.equity), (r) => r.openC);
  const eqOpenRetC = -sumBy(ofTypes(BS_GROUPS.retained), (r) => r.openC) + plOpenC;
  const capMoveC = d(BS_GROUPS.equity), retMoveC = d(BS_GROUPS.retained);
  const eqRows = [
    { key: "eqOpening", paidInC: eqOpenPaidC, retainedC: eqOpenRetC },
    { key: "eqCapital", paidInC: capMoveC, retainedC: 0 },
    { key: "eqOther", paidInC: 0, retainedC: retMoveC },
    { key: "periodResult", paidInC: 0, retainedC: netC },
  ];
  const eqClose = { key: "eqClosing", paidInC: T(eqAcc), retainedC: T(retAcc) + plOpenC + netC };
  if (sumBy(eqRows, (r) => r.paidInC) !== eqClose.paidInC || sumBy(eqRows, (r) => r.retainedC) !== eqClose.retainedC) {
    throw new StatementsError("changes in equity do not reconcile to the balance sheet");
  }

  const S = (xs) => xs.map(({ amountC, ...x }) => ({ ...x, amount: sar(amountC) }));
  const eqS = (r) => ({ key: r.key, paidIn: sar(r.paidInC), retained: sar(r.retainedC), total: sar(r.paidInC + r.retainedC) });
  return {
    period: { from, to },
    trialBalance: tb,
    incomeStatement: {
      revenue: S(revenue), totalRevenue: sar(revC),
      cogs: S(cogs), totalCogs: sar(cogsC),
      grossProfit: sar(grossC),
      otherIncome: S(otherIncome), totalOtherIncome: sar(oiC),
      expenses: S(expenses), totalExpenses: sar(expC),
      netResult: sar(netC),
    },
    balanceSheet: {
      asOf: to,
      currentAssets: S(ca), totalCurrentAssets: sar(caC),
      nonCurrentAssets: S(nca), totalNonCurrentAssets: sar(ncaC),
      totalAssets: sar(taC),
      currentLiabilities: S(cl), totalCurrentLiabilities: sar(clC),
      nonCurrentLiabilities: S(ncl), totalNonCurrentLiabilities: sar(nclC),
      totalLiabilities: sar(tlC),
      equity: S(eqAcc), retainedAccounts: S(retAcc), retainedPrior: sar(plOpenC), periodResult: sar(netC),
      totalEquity: sar(teC), totalLiabilitiesAndEquity: sar(tlC + teC),
      cash: sar(closeCashC),
      ownerCurrentAccount: sar(-sumBy(rows.filter(isOwner), (r) => r.closeC)),
    },
    cashFlow: {
      netResult: sar(netC), depreciation: sar(depC),
      workingCapital: wc.map(({ key, amountC }) => ({ key, amount: sar(amountC) })),
      netOperating: sar(opC),
      investing: invLines.map(({ key, amountC }) => ({ key, amount: sar(amountC) })), netInvesting: sar(invC),
      financing: finLines.map(({ key, amountC }) => ({ key, amount: sar(amountC) })), netFinancing: sar(finC),
      netChange: sar(netChangeC), openingCash: sar(openCashC), closingCash: sar(closeCashC),
    },
    equityChanges: { rows: eqRows.map(eqS), closing: eqS(eqClose) },
  };
}

// ---------------------------------------------------------------------------
// Odoo readers (read-only)
// ---------------------------------------------------------------------------

/** Chart of accounts in both languages + every posted line up to `to`. */
export async function fetchLedger(call, { to, companyId = 1 }) {
  const fields = ["id", "code", "name", "account_type"];
  const [ar, en] = await Promise.all([
    call("account.account", "search_read", { domain: [], fields, context: { lang: "ar_001", active_test: false } }),
    call("account.account", "search_read", { domain: [], fields, context: { lang: "en_US", active_test: false } }),
  ]);
  const enById = new Map(en.map((a) => [a.id, a.name]));
  const accounts = ar.map((a) => ({ id: a.id, code: a.code, nameAr: a.name, nameEn: enById.get(a.id) || a.name, type: a.account_type }));
  const lines = [];
  for (let offset = 0; ; offset += 2000) {
    const page = await call("account.move.line", "search_read", {
      domain: [["parent_state", "=", "posted"], ["date", "<=", to], ["company_id", "=", companyId], ["display_type", "not in", ["line_section", "line_note"]]],
      fields: ["account_id", "date", "debit", "credit", "parent_state"],
      order: "date,id", limit: 2000, offset,
    });
    lines.push(...page);
    if (page.length < 2000) break;
  }
  return { accounts, lines };
}

const acctIdOf = (lineId) => { const m = /~account\.account~(\d+)$/.exec(lineId); return m ? Number(m[1]) : null; };

async function odooReport(call, reportId, from, to, mode) {
  const date = mode === "single" ? { date_to: to, mode: "single", filter: "custom" } : { date_from: from, date_to: to, mode: "range", filter: "custom" };
  const options = await call("account.report", "get_options", { ids: [reportId], previous_options: { date, unfold_all: true, all_entries: false } });
  const info = await call("account.report", "get_report_information", { ids: [reportId], options });
  return { options, lines: info.lines };
}

/** Odoo's own Balance Sheet / P&L / Cash Flow / Trial Balance for the same period. */
export async function fetchOdooReports(call, { from, to }) {
  const reps = await call("account.report", "search_read", { domain: [["root_report_id", "=", false], ["name", "in", ["Balance Sheet", "Profit and Loss", "Cash Flow Statement", "Trial Balance"]]], fields: ["id", "name"] });
  const idOf = (n) => reps.find((r) => r.name === n)?.id;
  const out = {};
  for (const [key, name, mode] of [["bs", "Balance Sheet", "single"], ["pl", "Profit and Loss", "range"], ["cf", "Cash Flow Statement", "range"], ["tb", "Trial Balance", "range"]]) {
    const id = idOf(name);
    if (!id) { out[key] = null; continue; }
    const { options, lines } = await odooReport(call, id, from, to, mode);
    const codes = {}, accounts = {}, named = {};
    for (const l of lines) {
      const vals = l.columns.map((c) => (typeof c.no_format === "number" ? c.no_format : 0));
      if (l.code) codes[l.code] = vals;
      const a = acctIdOf(l.id);
      if (a) (accounts[a] ??= []).push({ parent: l.parent_id ?? "", vals });
      const tail = /\|([a-z_]+)~~$/.exec(l.id);
      if (tail) named[tail[1]] = vals;
    }
    out[key] = { reportId: id, name, date: options.date, columns: options.columns.map((c) => c.expression_label), codes, accounts, named };
  }
  return out;
}

/** Every comparable figure, ours vs Odoo's. Differences are listed, never hidden. */
export function compareWithOdoo(st, odoo, tol = 0.005) {
  const rows = [];
  const add = (statement, item, ours, theirs, note) => {
    const has = typeof theirs === "number";
    rows.push({ statement, item, ours, odoo: has ? theirs : null, diff: has ? Math.round((ours - theirs) * 100) / 100 : null, match: has ? Math.abs(ours - theirs) < tol : null, note: note ?? (has ? "" : "not in Odoo report") });
  };
  const c = (rep, code, i = 0) => rep?.codes?.[code]?.[i];
  const bs = st.balanceSheet, is = st.incomeStatement, cf = st.cashFlow;
  if (odoo.bs) {
    const cashC = st.trialBalance.rows.filter((r) => r.type === "asset_cash").reduce((a, r) => a + r.closing, 0);
    const byType = (ts, sign = 1) => sign * st.trialBalance.rows.filter((r) => ts.includes(r.type)).reduce((a, r) => a + r.closing, 0);
    add("bs", "Total assets (TA)", bs.totalAssets, c(odoo.bs, "TA"));
    add("bs", "Current assets (CA)", bs.totalCurrentAssets, c(odoo.bs, "CA"));
    add("bs", "Bank and cash (BA)", Math.round(cashC * 100) / 100, c(odoo.bs, "BA"));
    add("bs", "Receivables (REC)", byType(["asset_receivable"]), c(odoo.bs, "REC"));
    add("bs", "Other current assets (CAS)", byType(["asset_current"]), c(odoo.bs, "CAS"));
    add("bs", "Prepayments (PRE)", byType(["asset_prepayments"]), c(odoo.bs, "PRE"));
    add("bs", "Fixed assets (FA)", byType(["asset_fixed"]), c(odoo.bs, "FA"));
    add("bs", "Non-current assets (PNCA)", byType(["asset_non_current"]), c(odoo.bs, "PNCA"));
    add("bs", "Total liabilities (L)", bs.totalLiabilities, c(odoo.bs, "L"));
    add("bs", "Current liabilities (CL)", bs.totalCurrentLiabilities, c(odoo.bs, "CL"));
    add("bs", "Non-current liabilities (NL)", bs.totalNonCurrentLiabilities, c(odoo.bs, "NL"));
    add("bs", "Owner current account 201021", bs.ownerCurrentAccount, undefined, "separate line here; inside CL1 in Odoo");
    add("bs", "Total equity (EQ)", bs.totalEquity, c(odoo.bs, "EQ"));
    add("bs", "Earnings: prior + period (EAR)", Math.round((bs.retainedPrior + bs.periodResult + bs.retainedAccounts.reduce((a, x) => a + x.amount, 0)) * 100) / 100, c(odoo.bs, "EAR"));
    add("bs", "Liabilities + equity (LE)", bs.totalLiabilitiesAndEquity, c(odoo.bs, "LE"));
    for (const r of st.trialBalance.rows.filter((x) => !PL_TYPES.has(x.type))) {
      const hits = odoo.bs.accounts[r.id];
      const sign = r.type.startsWith("asset") ? 1 : -1;
      add("bs", `${r.code} ${r.nameEn}`, Math.round(sign * r.closing * 100) / 100, hits ? hits.reduce((a, h) => a + h.vals[0], 0) : (r.closing === 0 ? 0 : undefined), hits ? "" : r.closing === 0 ? "zero — Odoo hides it" : undefined);
    }
  }
  if (odoo.pl) {
    add("is", "Revenue (REV)", is.totalRevenue, c(odoo.pl, "REV"));
    add("is", "Cost of revenue (COS)", is.totalCogs, c(odoo.pl, "COS"));
    add("is", "Gross profit (GRP)", is.grossProfit, c(odoo.pl, "GRP"));
    add("is", "Other income (OIN)", is.totalOtherIncome, c(odoo.pl, "OIN"));
    const oexp = (c(odoo.pl, "EXP") ?? 0) + (c(odoo.pl, "OEXP") ?? 0);
    add("is", "Expenses (EXP + OEXP)", is.totalExpenses, odoo.pl.codes.EXP ? oexp : undefined);
    add("is", "Net profit (NEP)", is.netResult, c(odoo.pl, "NEP"));
    for (const x of [...is.revenue, ...is.cogs, ...is.otherIncome, ...is.expenses]) {
      const hits = odoo.pl.accounts[x.id];
      const v = hits ? hits.reduce((a, h) => a + h.vals[0], 0) : undefined;
      // Odoo's P&L lines: income as -sum, costs/expenses as sum — both positive, like ours.
      add("is", `${x.code} ${x.nameEn}`, x.amount, v === undefined ? undefined : Math.round(v * 100) / 100, hits ? "" : undefined);
    }
  }
  if (odoo.cf) {
    const n = odoo.cf.named;
    add("cf", "Opening cash", cf.openingCash, n.opening_balance?.[0]);
    add("cf", "Net change in cash", cf.netChange, n.net_increase?.[0]);
    add("cf", "Closing cash", cf.closingCash, n.closing_balance?.[0]);
    const method = "Odoo uses the direct method and its own activity tags; section totals are shown for reference";
    add("cf", "Operating (ours indirect)", cf.netOperating, n.operating_activities?.[0], method);
    add("cf", "Investing", cf.netInvesting, n.investing_activities?.[0], method);
    add("cf", "Financing", cf.netFinancing, n.financing_activities?.[0], method);
    add("cf", "Odoo: unclassified activities", 0, n.unclassified_activities?.[0], method);
  }
  if (odoo.tb) {
    for (const r of st.trialBalance.rows) {
      const v = odoo.tb.accounts[r.id]?.[0]?.vals;
      add("tb", `${r.code} opening`, r.opening, v?.[0]);
      add("tb", `${r.code} debit`, r.debit, v?.[1]);
      add("tb", `${r.code} credit`, r.credit, v?.[2]);
      add("tb", `${r.code} closing`, r.closing, v?.[3]);
    }
    const t = odoo.tb.codes.TB;
    add("tb", "Total debit", st.trialBalance.totals.debit, t?.[1]);
    add("tb", "Total credit", st.trialBalance.totals.credit, t?.[2]);
    const ours = new Set(st.trialBalance.rows.map((r) => r.id));
    for (const [id, hits] of Object.entries(odoo.tb.accounts)) {
      if (!ours.has(Number(id))) add("tb", `account ${id} only in Odoo`, 0, hits[0].vals[3], "account missing from ours");
    }
  }
  // "Cash flow method" rows are informational; the rest must match.
  const mismatches = rows.filter((r) => r.match === false && !r.note);
  return { rows, mismatches, informational: rows.filter((r) => r.match === false && r.note) };
}
