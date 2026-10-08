// § 68 (2026-10-08) — the employee's file: his papers, what he holds, and what the data says of his work.
//
// The card in «👥 الموظفون» has six tabs. Odoo itself computes what it can from its own rows (the month's
// attendance figures, «🗂️ اكتمال الأوراق ٪», the time off and the cost lines as text); the worker does the rest:
//
//   • THE PAPERS' ENDS — once a day (the first tick from 08:10), ONE message to Baraa for every paper that ends
//     within 30 days, then again within 7 (and one when it has ended): «🗂️ أوراق تنتهي قريباً». A paper is told
//     once a step. It is one of the system's own alerts: the freeze does not stop it.
//   • THE MONTH — on the first day of a month, ONE message to Baraa: each employee's attendance of the month
//     that ended (present, late, absent, time off, hours) and his papers that are not complete. Not sent when
//     the WHOLE month was frozen.
//   • «العهدة والمستحقات» and «الأداء» — two texts on the card, written once a day and by «🔄 حدّث الأرقام»:
//     what a collector collected in cash (x_payment), the balance of the driver's cash journal (CSHD), and
//     where a handover lives (KV, four days — nothing of it is copied to Odoo); and four figures read from
//     what is really recorded — deliveries on time, damage, days to collect, the custody difference — each
//     a number when there is data and «لا بيانات بعد» when there is none. No figure is ever made up.
//
// The worker reads a paper's state and its end alone: never its number, never its attachment. No price,
// cost or profit is read here, and nothing is sent to anyone but Baraa.

import type { Env } from "./config";
import type { TeamRole } from "./types";
import { call } from "./odoo";
import { claimButton, finishButton, releaseButton } from "./button-lock";
import { addDaysYmd, odooUtcMs, riyadhDateKey, riyadhDayMinuteMs, riyadhMinutes, toOdooUtc } from "./hours";
import { dayPlan, loadRoster, type Roster, type RosterMember } from "./team-roster";
import { monthBounds } from "./operating-cost";

export const EMPLOYEE_MODEL = "hr.employee";
const ATT_MODEL = "x_team_attendance";
const SIM_FIELD = "x_utak_simulation";
const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
type M2O = [number, string] | false | null | undefined;
const m2oId = (v: M2O | number): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
/** 1250.5 → «1,250.50». */
export function money(x: number): string {
  return round2(Number(x) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------- the papers

export type DocState = "missing" | "progress" | "done" | "na";
export interface DocDef {
  key: string;
  title: string;
  /** «أخرى»: the field that names it — the paper counts when it is named. */
  name?: string;
  /** Odoo's own field where it has one, else an x_ field of § 68 (scripts/lib/s68-odoo.mjs holds the same list). */
  number: string;
  expiry: string;
  file: string;
  fileName: string;
  state: string;
  /** Asked of the holder of this role alone. */
  role?: TeamRole;
}
export const DOCS: readonly DocDef[] = [
  { key: "id", title: "الإقامة / الهوية", number: "identification_id", expiry: "x_doc_id_expiry", file: "id_card", fileName: "id_card_name", state: "x_doc_id_state" },
  { key: "passport", title: "جواز السفر", number: "passport_id", expiry: "passport_expiration_date", file: "x_doc_passport_file", fileName: "x_doc_passport_file_name", state: "x_doc_passport_state" },
  { key: "permit", title: "تصريح العمل", number: "permit_no", expiry: "work_permit_expiration_date", file: "has_work_permit", fileName: "work_permit_name", state: "x_doc_permit_state" },
  { key: "contract", title: "عقد العمل", number: "x_doc_contract_no", expiry: "contract_date_end", file: "x_doc_contract_file", fileName: "x_doc_contract_file_name", state: "x_doc_contract_state" },
  { key: "gosi", title: "التأمينات", number: "x_doc_gosi_no", expiry: "x_doc_gosi_expiry", file: "x_doc_gosi_file", fileName: "x_doc_gosi_file_name", state: "x_doc_gosi_state" },
  { key: "health", title: "الشهادة الصحية", number: "x_doc_health_no", expiry: "x_doc_health_expiry", file: "x_doc_health_file", fileName: "x_doc_health_file_name", state: "x_doc_health_state" },
  { key: "license", title: "رخصة القيادة", number: "x_doc_license_no", expiry: "x_doc_license_expiry", file: "driving_license", fileName: "driving_license_name", state: "x_doc_license_state", role: "driver" },
  { key: "other", title: "أخرى", name: "x_doc_other_name", number: "x_doc_other_no", expiry: "x_doc_other_expiry", file: "x_doc_other_file", fileName: "x_doc_other_file_name", state: "x_doc_other_state" },
];
/** What the worker reads of a card's papers: each one's state and end, and the name of «أخرى». Never a number, never a file. */
export const PAPER_FIELDS: readonly string[] = [...new Set(DOCS.flatMap((d) => [d.state, d.expiry, ...(d.name ? [d.name] : [])]))];

export interface Paper { key: string; title: string; state: "missing" | "progress" | "done"; expiry: string | null }
export type Card = { id: number } & Record<string, unknown>;

/**
 * The papers asked of this employee: the six of everyone, the driver's licence of a driver, «أخرى» when it is
 * named — and none that is «لا ينطبق». A state Odoo left empty is «ناقص».
 */
export function askedPapers(card: Record<string, unknown>, codes: readonly string[]): Paper[] {
  // «أخرى» is named by a text: Odoo's empty field is `false`, never a name
  const named = (d: DocDef): string => (d.name && typeof card[d.name] === "string" ? (card[d.name] as string).trim() : "");
  return DOCS
    .filter((d) => !d.role || codes.includes(d.role))
    .filter((d) => !d.name || named(d) !== "")
    .filter((d) => card[d.state] !== "na")
    .map((d) => ({
      key: d.key,
      title: d.name ? named(d) : d.title,
      state: card[d.state] === "done" ? "done" : card[d.state] === "progress" ? "progress" : "missing",
      expiry: typeof card[d.expiry] === "string" && /^\d{4}-\d{2}-\d{2}/.test(card[d.expiry] as string) ? (card[d.expiry] as string).slice(0, 10) : null,
    }));
}
/** «🗂️ اكتمال الأوراق ٪» — the complete ones of those asked (none asked: 100). The same figure Odoo stores on the card. */
export function papersPct(papers: Paper[]): number {
  return papers.length ? Math.floor((100 * papers.filter((p) => p.state === "done").length) / papers.length + 0.5) : 100;
}
/** «الإقامة / الهوية، جواز السفر (قيد الإجراء)» — the ones that are not complete; "" when all are. */
export function missingPapers(papers: Paper[]): string {
  return papers.filter((p) => p.state !== "done").map((p) => `${p.title}${p.state === "progress" ? " (قيد الإجراء)" : ""}`).join("، ");
}

/** The cards of the staff with their papers' fields. Throws on Odoo trouble. */
export async function readCards(env: Env, roster: Roster): Promise<Map<number, Card>> {
  const ids = roster.staff.map((m) => m.employeeId);
  const rows = ids.length ? await call<Card[]>(env, EMPLOYEE_MODEL, "search_read", { domain: [["id", "in", ids]], fields: ["id", ...PAPER_FIELDS], order: "id asc", limit: 200 }) : [];
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------------------------------------------------------------- the papers' ends

export type ExpiryStep = "30" | "7" | "expired";
export const EXPIRY_KIND = "docs_expiry";
export const EXPIRY_HEAD = "🗂️ أوراق تنتهي قريباً:";
const EXPIRY_KEEP = 120 * 24 * 3600;
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
/** The step a paper that ends on `expiry` is at today: within 30 days, within 7, ended — or null (further away). */
export function expiryStep(expiry: string, today: string): ExpiryStep | null {
  const left = daysBetween(today, expiry);
  if (left < 0) return "expired";
  if (left <= 7) return "7";
  if (left <= 30) return "30";
  return null;
}
export function expiryLine(name: string, title: string, expiry: string, today: string): string {
  const left = daysBetween(today, expiry);
  const when = left < 0 ? `انتهت ${expiry} (منذ ${-left} يوماً)` : left === 0 ? `تنتهي اليوم (${expiry})` : `تنتهي ${expiry} (بعد ${left} يوماً)`;
  return `• ${name} — ${title}: ${when}`;
}
const expiryKey = (employeeId: number, key: string, expiry: string, step: ExpiryStep): string => `doc_exp:v1:${employeeId}:${key}:${expiry}:${step}`;

export interface ExpiryReport { due: number; outcome: "none" | "sent" | "failed" }
/**
 * Every paper at a step it was not told at yet: ONE message to Baraa. A paper is marked told only when the
 * message was taken (sent, or kept for his window): one that failed is tried again the next day.
 */
export async function runPapersExpiry(env: Env, cards: Map<number, Card>, roster: Roster, now: number = Date.now()): Promise<ExpiryReport> {
  const today = riyadhDateKey(new Date(now));
  const due: Array<{ key: string; line: string }> = [];
  for (const m of roster.staff) {
    const card = cards.get(m.employeeId);
    if (!card) continue;
    for (const p of askedPapers(card, m.codes)) {
      if (!p.expiry) continue;
      const step = expiryStep(p.expiry, today);
      if (!step) continue;
      const key = expiryKey(m.employeeId, p.key, p.expiry, step);
      let told: string | null = null;
      try { told = await env.MSG_DEDUP.get(key); } catch { told = null; }
      if (!told) due.push({ key, line: expiryLine(m.name, p.title, p.expiry, today) });
    }
  }
  if (!due.length) return { due: 0, outcome: "none" };
  const { ownerAlert } = await import("./owner-alerts");
  const r = await ownerAlert(env, `${EXPIRY_HEAD}\n${due.map((d) => d.line).join("\n")}\nتُحدَّث من «👥 الموظفون ← الأوراق».`, { kind: EXPIRY_KIND, now });
  if (r.outcome === "failed") return { due: due.length, outcome: "failed" };
  for (const d of due) {
    try { await env.MSG_DEDUP.put(d.key, String(now), { expirationTtl: EXPIRY_KEEP }); } catch { /* told again tomorrow at worst */ }
  }
  return { due: due.length, outcome: "sent" };
}

// ---------------------------------------------------------------- the month

export const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
/** «2026-09» → «سبتمبر 2026». */
export const monthLabel = (ym: string): string => `${MONTHS_AR[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
export const MONTHLY_KIND = "staff_month";
export interface AttendanceRow { x_employee_id: M2O | number; x_status: string | false; x_late_min?: number | false; x_tapped_at?: string | false; x_out_at?: string | false }
export interface MonthFigures { rows: number; present: number; late: number; lateMin: number; absent: number; leave: number; hours: number }
/** One employee's month from his rows: «حاضر» counts the late days too; the hours are of the days with both times. */
export function monthFigures(rows: AttendanceRow[]): MonthFigures {
  const f: MonthFigures = { rows: rows.length, present: 0, late: 0, lateMin: 0, absent: 0, leave: 0, hours: 0 };
  for (const r of rows) {
    if (r.x_status === "present" || r.x_status === "late") f.present++;
    if (r.x_status === "late") { f.late++; f.lateMin += Number(r.x_late_min) || 0; }
    if (r.x_status === "absent") f.absent++;
    if (r.x_status === "leave") f.leave++;
    const a = r.x_tapped_at ? odooUtcMs(r.x_tapped_at) : NaN, b = r.x_out_at ? odooUtcMs(r.x_out_at) : NaN;
    if (b > a) f.hours += (b - a) / 3600_000;
  }
  f.hours = round2(f.hours);
  return f;
}
export const NO_ATTENDANCE_TEXT = "لا حضور مسجّل";
export function monthLine(who: { name: string; jobName: string }, f: MonthFigures, papers: Paper[]): string {
  const att = f.rows === 0
    ? NO_ATTENDANCE_TEXT
    : `حضر ${f.present} يوماً${f.late ? ` (منها ${f.late} متأخراً، ${f.lateMin} دقيقة)` : ""} · غاب ${f.absent} · إجازة ${f.leave} · ${f.hours} ساعة`;
  const missing = missingPapers(papers);
  return `• ${who.name}${who.jobName ? ` (${who.jobName})` : ""}: ${att} — الأوراق ${papersPct(papers)}٪${missing ? `، ناقص: ${missing}` : ""}`;
}
export const monthlyText = (ym: string, lines: string[]): string =>
  `📅 ملخص الفريق — ${monthLabel(ym)}:\n${lines.join("\n")}\nالتفاصيل في «👥 الموظفون» (تبويبا «الحضور» و«الأوراق»).`;

/** The attendance rows of the staff between two days (Riyadh), no simulation row. */
async function readAttendance(env: Env, employeeIds: number[], from: string, to: string): Promise<AttendanceRow[]> {
  if (!employeeIds.length) return [];
  return call<AttendanceRow[]>(env, ATT_MODEL, "search_read", {
    domain: [["x_employee_id", "in", employeeIds], ["x_date", ">=", from], ["x_date", "<=", to], [SIM_FIELD, "!=", true]],
    fields: ["id", "x_employee_id", "x_date", "x_status", "x_late_min", "x_tapped_at", "x_out_at"], order: "x_date asc, id asc", limit: 5000,
  });
}

export type MonthlyAction = "not_first" | "sent_before" | "frozen_month" | "no_staff" | "sent" | "failed";
/**
 * The first day of a month: the month that ended, one line an employee, ONE message to Baraa — once. Not sent
 * when the freeze covered that whole month (nothing ran in it). Throws on Odoo trouble (the claim is released).
 */
export async function runMonthlySummary(env: Env, cards: Map<number, Card>, roster: Roster, now: number = Date.now()): Promise<MonthlyAction> {
  const today = riyadhDateKey(new Date(now));
  if (today.slice(8, 10) !== "01") return "not_first";
  const [from, to] = monthBounds(addDaysYmd(today, -1));
  const ym = from.slice(0, 7);
  const claim = await claimButton(env, `staff_month:v1:${ym}`, 40 * 24 * 3600);
  if (!claim.claimed) return "sent_before";
  try {
    const { frozenAt, readFreeze } = await import("./freeze");
    const fz = await readFreeze(env, now);
    if (frozenAt(fz, riyadhDayMinuteMs(from, 0)) && frozenAt(fz, riyadhDayMinuteMs(today, 0) - 1)) {
      await finishButton(env, claim, 40 * 24 * 3600);
      return "frozen_month";
    }
    if (!roster.staff.length) { await finishButton(env, claim, 40 * 24 * 3600); return "no_staff"; }
    const rows = await readAttendance(env, roster.staff.map((m) => m.employeeId), from, to);
    const lines = roster.staff.map((m) => monthLine(m, monthFigures(rows.filter((r) => m2oId(r.x_employee_id) === m.employeeId)), askedPapers(cards.get(m.employeeId) ?? {}, m.codes)));
    const { ownerAlert } = await import("./owner-alerts");
    const r = await ownerAlert(env, monthlyText(ym, lines), { kind: MONTHLY_KIND, now });
    if (r.outcome === "failed") { await releaseButton(env, claim); return "failed"; }
    await finishButton(env, claim, 40 * 24 * 3600);
    return "sent";
  } catch (e) {
    await releaseButton(env, claim);
    throw e;
  }
}

// ---------------------------------------------------------------- «العهدة والمستحقات»

export const NO_DATA = "لا بيانات بعد";
export const NOT_COLLECTOR_TEXT = "العهدة النقدية: ليس محصّلاً — لا كاش يُحصَّل باسمه.";
export const CUSTODY_WHERE_TEXT = "• تسليم العهدة: يُسجَّل من نموذج «عهدة» في ذاكرة النظام (KV) أربعة أيام فقط — لا سجل دائم له في Odoo، وخروج المبلغ من يومية كاش السائق يُسجَّل يدوياً.";
export const NO_ADVANCES_TEXT = "السلف والخصومات: لا سجل لها في Odoo حالياً.";
export const NO_CASH_TEXT = "• لا تحصيل نقدي مسجّل باسمه بعد.";
export const JOURNAL_UNREAD_TEXT = "• رصيد يومية «كاش السائق» (CSHD): تعذّرت قراءته الآن.";
const collectionsAr = (n: number): string => (n === 1 ? "تحصيل واحد" : n === 2 ? "تحصيلان" : n >= 3 && n <= 10 ? `${n} تحصيلات` : `${n} تحصيلاً`);

export interface Cash { total: number; count: number }
export interface CustodyFacts { collector: boolean; month?: Cash; all?: Cash; journal?: number | null }
export function custodyText(f: CustodyFacts): string {
  if (!f.collector) return `${NOT_COLLECTOR_TEXT}\n${NO_ADVANCES_TEXT}`;
  const lines = ["العهدة النقدية (محصّل):"];
  if (!f.all || f.all.count === 0) lines.push(NO_CASH_TEXT);
  else {
    lines.push(`• كاش حصّله هذا الشهر: ${money(f.month?.total ?? 0)} ر.س — ${collectionsAr(f.month?.count ?? 0)}`);
    lines.push(`• كاش حصّله منذ البداية: ${money(f.all.total)} ر.س — ${collectionsAr(f.all.count)}`);
  }
  lines.push(f.journal === null || f.journal === undefined ? JOURNAL_UNREAD_TEXT : `• رصيد يومية «كاش السائق» (CSHD) في الدفاتر: ${money(f.journal)} ر.س — مشترك لكل المحصّلين: ما حُصّل نقداً ولم يُسجَّل خروجه بعد.`);
  lines.push(CUSTODY_WHERE_TEXT, NO_ADVANCES_TEXT);
  return lines.join("\n");
}

interface PayRow { id: number; x_amount: number | false; x_invoice_id: M2O; x_collected_at: string | false; x_method?: string | false }
/** The real payments a member collected (his Work Contact): no simulation row, nor a row of a simulation invoice or order. */
async function collectedBy(env: Env, partnerId: number, extra: unknown[] = []): Promise<PayRow[]> {
  const pays = await call<PayRow[]>(env, "x_payment", "search_read", {
    domain: [["x_collected_by", "=", partnerId], [SIM_FIELD, "!=", true], ...extra],
    fields: ["id", "x_amount", "x_invoice_id", "x_collected_at", "x_method"], order: "id asc", limit: 5000,
  });
  if (!pays.length) return [];
  const { simulationInvoices } = await import("./custody-form");
  const sim = await simulationInvoices(env, pays.map((p) => m2oId(p.x_invoice_id)));
  return pays.filter((p) => !sim.has(m2oId(p.x_invoice_id)));
}
const cashOf = (pays: PayRow[]): Cash => ({ total: round2(pays.reduce((s, p) => s + (Number(p.x_amount) || 0), 0)), count: pays.length });

/** The balance of the driver's cash journal (CSHD) in the books: its account's posted lines. Null when it cannot be read. */
export async function cashJournalBalance(env: Env): Promise<number | null> {
  try {
    const [j] = await call<Array<{ id: number; default_account_id: M2O }>>(env, "account.journal", "search_read", { domain: [["code", "=", "CSHD"]], fields: ["id", "default_account_id"], limit: 1 });
    const account = m2oId(j?.default_account_id);
    if (!account) return null;
    const lines = await call<Array<{ balance: number }>>(env, "account.move.line", "search_read", { domain: [["account_id", "=", account], ["parent_state", "=", "posted"]], fields: ["balance"], limit: 10000 });
    return round2(lines.reduce((s, l) => s + (Number(l.balance) || 0), 0));
  } catch (e) {
    console.warn("[employee-file] the cash journal could not be read", (e as Error)?.message);
    return null;
  }
}

async function custodyFacts(env: Env, m: RosterMember, now: number, journal: number | null): Promise<CustodyFacts> {
  if (!m.codes.includes("collector") || !m.partnerId) return { collector: false };
  const cash = (await collectedBy(env, m.partnerId, [["x_method", "=", "cash"]]));
  const [first] = monthBounds(riyadhDateKey(new Date(now)));
  const fromMs = riyadhDayMinuteMs(first, 0);
  return { collector: true, all: cashOf(cash), month: cashOf(cash.filter((p) => p.x_collected_at && odooUtcMs(p.x_collected_at) >= fromMs)), journal };
}

// ---------------------------------------------------------------- «الأداء»

export interface PerfFacts {
  driver: boolean;
  collector: boolean;
  /** delivered stops of his routes this month; `judged`: those with a shift end to hold them against */
  deliveries?: { delivered: number; judged: number; onTime: number };
  damage?: { lines: number; qty: number; notes: number };
  collection?: { invoices: number; avgDays: number };
  custody?: { handovers: number; diff: number };
}
export const NO_ROLE_PERF_TEXT = "لا مقياس يُحسب لأدوار هذه الوظيفة من البيانات القائمة (المقاييس للسائق والمحصّل).";
export const PERF_FOOT = "الأرقام من المسجَّل فعلاً هذا الشهر، بلا سجلات المحاكاة.";
export function perfText(ym: string, f: PerfFacts): string {
  const lines = [`الأداء — ${monthLabel(ym)} حتى اليوم:`];
  if (!f.driver && !f.collector) return `${lines[0]}\n${NO_ROLE_PERF_TEXT}`;
  if (f.driver) {
    const d = f.deliveries;
    lines.push(!d || d.delivered === 0 ? `• التسليمات في وقتها: ${NO_DATA}`
      : d.judged === 0 ? `• التسليمات في وقتها: ${d.delivered} تسليماً، ولا نهاية دوام تُقاس عليها`
      : `• التسليمات في وقتها: ${d.onTime} من ${d.judged} (${Math.round((100 * d.onTime) / d.judged)}٪) — قبل نهاية دوامه`);
    const g = f.damage;
    lines.push(!d || d.delivered === 0 || !g ? `• التالف المسجّل: ${NO_DATA}`
      : g.lines === 0 && g.notes === 0 ? "• التالف المسجّل على طلبات مساراته: لا شيء"
      : `• التالف المسجّل على طلبات مساراته: ${round2(g.qty)} في ${g.lines} سطراً، و${g.notes} ملاحظة «تالف»`);
  }
  if (f.collector) {
    const c = f.collection;
    lines.push(!c || c.invoices === 0 ? `• أيام التحصيل: ${NO_DATA}` : `• أيام التحصيل: ${c.avgDays} يوم في المتوسط (${c.invoices} فاتورة)`);
    const k = f.custody;
    lines.push(!k || k.handovers === 0 ? `• فرق العهدة: ${NO_DATA}` : `• فرق العهدة (آخر 4 أيام، من نموذج «عهدة»): ${k.diff > 0 ? "+" : k.diff < 0 ? "−" : ""}${money(Math.abs(k.diff))} ر.س في ${k.handovers} تسليماً`);
  }
  lines.push(PERF_FOOT);
  return lines.join("\n");
}

async function perfFacts(env: Env, roster: Roster, m: RosterMember, now: number): Promise<PerfFacts> {
  const today = riyadhDateKey(new Date(now));
  const [first] = monthBounds(today);
  const f: PerfFacts = { driver: m.codes.includes("driver"), collector: m.codes.includes("collector") };
  if (f.driver && m.partnerId) {
    const routes = await call<Array<{ id: number; x_date: string }>>(env, "x_delivery_route", "search_read", {
      domain: [["x_driver_id", "=", m.partnerId], ["x_date", ">=", first], ["x_date", "<=", today], [SIM_FIELD, "!=", true]], fields: ["id", "x_date"], limit: 400,
    });
    const dayOf = new Map(routes.map((r) => [r.id, r.x_date]));
    const stops = routes.length ? await call<Array<{ id: number; x_route_id: M2O; x_order_id: M2O; x_delivered_at: string | false }>>(env, "x_delivery_stop", "search_read", {
      domain: [["x_route_id", "in", routes.map((r) => r.id)], ["x_status", "=", "delivered"], [SIM_FIELD, "!=", true]], fields: ["id", "x_route_id", "x_order_id", "x_delivered_at"], limit: 5000,
    }) : [];
    const done = stops.filter((s) => s.x_delivered_at);
    f.deliveries = { delivered: done.length, judged: 0, onTime: 0 };
    const { freeShift } = await import("./attendance");
    const ends = new Map<string, number | null>();
    for (const s of done) {
      const day = dayOf.get(m2oId(s.x_route_id)) ?? "";
      if (!ends.has(day)) {
        const p = dayPlan(roster, m, day);
        const endMin = p.kind === "work" ? (p.endMin as number) : (await freeShift(env, roster, m, day, now).catch(() => null))?.endMin ?? null;
        ends.set(day, endMin === null ? null : riyadhDayMinuteMs(day, endMin));
      }
      const end = ends.get(day) ?? null;
      if (end === null) continue;
      f.deliveries.judged++;
      if (odooUtcMs(s.x_delivered_at as string) <= end) f.deliveries.onTime++;
    }
    const orders = [...new Set(done.map((s) => m2oId(s.x_order_id)).filter(Boolean))];
    if (orders.length) {
      const lines = await call<Array<{ id: number; x_return_qty: number | false }>>(env, "x_daily_order_line", "search_read", { domain: [["x_order_id", "in", orders], ["x_return_reason", "=", "damaged"]], fields: ["id", "x_return_qty"], limit: 5000 });
      const notes = await call<number>(env, "x_complaint", "search_count", { domain: [["x_order_id", "in", orders], ["x_kind", "=", "damaged"], ["x_is_simulation", "!=", true]] });
      f.damage = { lines: lines.length, qty: round2(lines.reduce((t, l) => t + (Number(l.x_return_qty) || 0), 0)), notes: Number(notes) || 0 };
    }
  }
  if (f.collector && m.partnerId) {
    const pays = (await collectedBy(env, m.partnerId, [["x_collected_at", ">=", toOdooUtc(riyadhDayMinuteMs(first, 0))]])).filter((p) => p.x_collected_at && m2oId(p.x_invoice_id));
    const invIds = [...new Set(pays.map((p) => m2oId(p.x_invoice_id)))];
    const invs = invIds.length ? await call<Array<{ id: number; x_issued_at: string | false }>>(env, "x_invoice", "read", { ids: invIds, fields: ["id", "x_issued_at"] }) : [];
    const issued = new Map(invs.filter((i) => i.x_issued_at).map((i) => [i.id, odooUtcMs(i.x_issued_at as string)]));
    // an invoice's days: from its issue to its LAST collection of the month
    const last = new Map<number, number>();
    for (const p of pays) { const id = m2oId(p.x_invoice_id), at = odooUtcMs(p.x_collected_at as string); if (issued.has(id) && at >= (last.get(id) ?? 0)) last.set(id, at); }
    const days = [...last].map(([id, at]) => Math.max(0, (at - (issued.get(id) as number)) / DAY_MS));
    f.collection = { invoices: days.length, avgDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : 0 };
    const { readCustody } = await import("./custody-form");
    let handovers = 0, diff = 0;
    for (let i = 0; i < 4; i++) { const rec = await readCustody(env, addDaysYmd(today, -i), m.partnerId); if (rec) { handovers++; diff += rec.diff; } }
    f.custody = { handovers, diff: round2(diff) };
  }
  return f;
}

// ---------------------------------------------------------------- the two texts on the card

export interface RefreshReport { staff: number; written: number[]; errors: string[] }
/**
 * «العهدة والمستحقات» and «الأداء» of every employee (or of one): computed from what is recorded, and written
 * on the card when a text changed — `stamp` (the button) always writes «آخر تحديث للأرقام». Never throws.
 */
export async function refreshEmployeeFile(env: Env, opts: { employeeId?: number; now?: number; stamp?: boolean } = {}): Promise<RefreshReport> {
  const now = opts.now ?? Date.now();
  const out: RefreshReport = { staff: 0, written: [], errors: [] };
  let roster: Roster;
  try { roster = await loadRoster(env, now); } catch (e) { out.errors.push(`roster: ${(e as Error)?.message}`); return out; }
  const staff = roster.staff.filter((m) => !opts.employeeId || m.employeeId === opts.employeeId);
  out.staff = staff.length;
  if (!staff.length) return out;
  const ym = riyadhDateKey(new Date(now)).slice(0, 7);
  let before = new Map<number, Card>();
  try {
    const rows = await call<Card[]>(env, EMPLOYEE_MODEL, "search_read", { domain: [["id", "in", staff.map((m) => m.employeeId)]], fields: ["id", "x_custody_text", "x_perf_text"], limit: 200 });
    before = new Map(rows.map((r) => [r.id, r]));
  } catch (e) { out.errors.push(`cards: ${(e as Error)?.message}`); return out; }
  const journal = staff.some((m) => m.codes.includes("collector")) ? await cashJournalBalance(env) : null;
  for (const m of staff) {
    try {
      const custody = custodyText(await custodyFacts(env, m, now, journal));
      const perf = perfText(ym, await perfFacts(env, roster, m, now));
      const cur = before.get(m.employeeId);
      const vals: Record<string, unknown> = {};
      if ((cur?.x_custody_text || "") !== custody) vals.x_custody_text = custody;
      if ((cur?.x_perf_text || "") !== perf) vals.x_perf_text = perf;
      if (!Object.keys(vals).length && !opts.stamp) continue;
      vals.x_file_at = toOdooUtc(now);
      await call(env, EMPLOYEE_MODEL, "write", { ids: [m.employeeId], vals });
      out.written.push(m.employeeId);
    } catch (e) {
      out.errors.push(`#${m.employeeId}: ${(e as Error)?.message}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the tick

/** The minute of the day (Riyadh) from which the day's one run goes: after the 08:00 jobs. */
export const FILE_TICK_MINUTE = 8 * 60 + 10;
export interface FileTick { action: "before" | "done_today" | "roster_unreadable" | "ran"; papers?: ExpiryReport | string; month?: MonthlyAction | string; refresh?: RefreshReport }
/**
 * Once a day, from 08:10: the papers' ends, the month (on the first), and the two texts of every card. It is
 * the system's own upkeep — every message here is Baraa's alone — so the freeze does not stop it. Never throws.
 */
export async function runEmployeeFileTick(env: Env, now: number = Date.now()): Promise<FileTick> {
  if (riyadhMinutes(new Date(now)) < FILE_TICK_MINUTE) return { action: "before" };
  const claim = await claimButton(env, `emp_file:v1:${riyadhDateKey(new Date(now))}`, 2 * 24 * 3600);
  if (!claim.claimed) return { action: "done_today" };
  let roster: Roster, cards: Map<number, Card>;
  try {
    roster = await loadRoster(env, now);
    cards = await readCards(env, roster);
  } catch (e) {
    await releaseButton(env, claim); // Odoo did not answer: the next tick tries again
    console.warn("[employee-file] the staff could not be read", (e as Error)?.message);
    return { action: "roster_unreadable" };
  }
  const out: FileTick = { action: "ran" };
  try { out.papers = await runPapersExpiry(env, cards, roster, now); } catch (e) { out.papers = `error: ${(e as Error)?.message}`; }
  try { out.month = await runMonthlySummary(env, cards, roster, now); } catch (e) { out.month = `error: ${(e as Error)?.message}`; }
  out.refresh = await refreshEmployeeFile(env, { now });
  await finishButton(env, claim, 2 * 24 * 3600);
  return out;
}
