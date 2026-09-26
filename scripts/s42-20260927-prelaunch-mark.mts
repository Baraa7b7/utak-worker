// § 42 ج (2026-09-27) — the pre-launch cleanup: every operational record the
// sim / pilot worker stamped x_is_simulation = true and that is not yet marked
// «محاكاة (تجربة)» gets x_utak_simulation = true, never deleted (the § 39
// pattern: backup ← mark ← verify). Then the supplier-payment references of
// the simulation («SIM37-» before SP-…) and the SP sequence back to 0001.
//
// The models (operational only — never res.partner, hr.employee, the products
// or the templates): the order and its lines, the invoice, the payment, the
// route and the stop, the purchase list, the dues and their lines, the
// supplier payments, the price days and their lines, the daily prices, the
// offers, the attendance, x_wa_message. A model without x_is_simulation has no
// record this rule can select: it is listed (with its unmarked count) and left.
//
// The numbers (scan): the SP sequence (ir.sequence #21, its 2026 date range)
// is the only UTAK ir.sequence; the invoice's day serial leaves marked
// invoices out (a marked invoice of today or later with a plain UTAK-INV
// number would be repeated — each is listed); the quotation's day serial
// counts every record created that day (unchanged by a mark); the receipt
// (UTAK-R-…-<id % 999>) and the delivery note (DLV-…-<stop id>) come from the
// record's id. Odoo's own sequences (sale / purchase orders, the journals)
// serve the posted accounting and are listed, never touched.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s42-20260927-prelaunch-mark.mts <step> [--apply]
//
//   scan                read-only: what the rule selects per model, the SP payments and sequence, the
//                       invoices / quotations of today or later, the Odoo sequences, and the 31 numbers
//                       of § 27 (masked) → scripts/artifacts/s42-20260927-prelaunch-scan.json
//   backup              read-only: every selected record (all fields but binaries), the SP payments, the
//                       date range, account.move / account.payment counts → backups/s42-prelaunch-<ts>.json
//   mark [--apply]      the flags, the «SIM37-» prefixes, the SP date range to 1 (dry run without --apply;
//                       the rollback file is written before the first write)
//   verify              read-only: nothing left to mark; SP prefixed and next = SP-2026-0001; the 21:30
//                       summary (م17) of today zero; Ahmed 0 / 0 / 0; no due left; account.move 48 and
//                       account.payment 9
//   rollback [--apply]  the values this script changed, back (nothing deleted)
//
// A decided supplier payment is locked by base.automation #25 (utak.sp.lock,
// x_name among its watched fields): it is switched off for the renames only
// and on again in `finally`; verify checks it is on.
//
// Rollback file: scripts/artifacts/s42-20260927-prelaunch-mark-rollback.json. No WhatsApp, no deletion.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const step = process.argv[2] ?? "";
const APPLY = process.argv.includes("--apply");
const RB = new URL("./artifacts/s42-20260927-prelaunch-mark-rollback.json", import.meta.url);
const SCAN = new URL("./artifacts/s42-20260927-prelaunch-scan.json", import.meta.url);
const BACKUPS = new URL("../backups/", import.meta.url);
const log = (...a: unknown[]) => console.log(...a);
const SIM = "x_utak_simulation";
const IS = "x_is_simulation";
const SP_PREFIX = "SIM37-";
const SP_SEQUENCE = 21;
/** base.automation «utak.sp.lock»: a decided payment's watched fields (x_name among them) cannot be written. */
const SP_LOCK_AUTOMATION = 25;
const EXPECT_MOVES = 48, EXPECT_PAYMENTS = 9;
const AHMED = 30;
export const MODELS = [
  "x_daily_order", "x_daily_order_line", "x_invoice", "x_payment", "x_delivery_route", "x_delivery_stop",
  "x_purchase_list", "x_supplier_due", "x_supplier_due_line", "x_supplier_payment",
  "x_price_day", "x_price_day_line", "x_daily_price", "x_price_offer", "x_team_attendance", "x_wa_message",
];
const TODAY = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); // Riyadh

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/json/2/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  if (/\/(unlink|button_cancel|action_post|next_by_id|next_by_code|create)$/.test(url)) throw new Error(`BLOCKED: ${url.split("/").slice(-2).join(".")}`);
  return realFetch(input, init);
}) as typeof fetch;

async function fieldsOf(model: string): Promise<Record<string, { type: string }>> {
  return call(model, "fields_get", { attributes: ["type"] });
}
async function selectable(model: string): Promise<{ hasIs: boolean; hasSim: boolean; ids: number[]; unmarkedNoRule: number | null }> {
  const f = await fieldsOf(model);
  const hasIs = IS in f, hasSim = SIM in f;
  if (!hasSim) return { hasIs, hasSim, ids: [], unmarkedNoRule: null };
  if (!hasIs) return { hasIs, hasSim, ids: [], unmarkedNoRule: await call(model, "search_count", { domain: [[SIM, "!=", true]] }) };
  const ids = await call<number[]>(model, "search", { domain: [[IS, "=", true], [SIM, "!=", true]], order: "id asc" });
  return { hasIs, hasSim, ids, unmarkedNoRule: null };
}
async function acctCounts() {
  return { moves: await call<number>("account.move", "search_count", { domain: [] }), payments: await call<number>("account.payment", "search_count", { domain: [] }) };
}
const mask = (n: string) => { const d = String(n || "").replace(/\D/g, ""); return d ? `+${d.slice(0, 3)}…${d.slice(-4)}` : ""; };
const readRb = () => (existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s42-20260927-prelaunch-mark.mts", createdAt: new Date().toISOString(), flags: {}, spNames: {}, dateRange: null });
const saveRb = (rb: any) => { if (APPLY) writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n"); };

// ---------------------------------------------------------------- scan
if (step === "scan") {
  const out: any = { at: new Date().toISOString(), today: TODAY, models: {}, sp: {}, numbers: {}, sequences: [], numbers31: [] };
  for (const m of MODELS) {
    const s = await selectable(m);
    out.models[m] = { hasIsSimulation: s.hasIs, hasUtakSimulation: s.hasSim, toMark: s.ids.length, ids: s.ids, unmarkedNoRule: s.unmarkedNoRule };
    log(`${m.padEnd(22)} ${s.hasIs ? `to mark ${s.ids.length}${s.ids.length ? ` (${s.ids.join(",")})` : ""}` : `no ${IS} — ${s.unmarkedNoRule} unmarked, left as they are`}`);
  }
  const sp = await call<any[]>("x_supplier_payment", "search_read", { domain: [], fields: ["id", "x_name", SIM, IS, "x_state"], order: "id asc" });
  const dr = await call<any[]>("ir.sequence.date_range", "search_read", { domain: [["sequence_id", "=", SP_SEQUENCE]], fields: ["id", "date_from", "date_to", "number_next_actual"] });
  out.sp = { payments: sp, dateRanges: dr, realPayments: sp.filter((p) => !p[SIM] && !p[IS]).map((p) => p.x_name) };
  log(`SP: ${sp.map((p) => `${p.x_name}${p[SIM] ? " (محاكاة)" : ""}`).join(", ")} · date range ${JSON.stringify(dr)}`);
  const inv = await call<any[]>("x_invoice", "search_read", { domain: [["x_invoice_date", ">=", TODAY]], fields: ["id", "x_invoice_number", "x_invoice_date", SIM], order: "id asc" });
  const q = await call<any[]>("x_quotation", "search_read", { domain: [["create_date", ">=", new Date(Date.parse(`${TODAY}T00:00:00+03:00`)).toISOString().replace("T", " ").slice(0, 19)]], fields: ["id", "x_quotation_number", SIM], order: "id asc" });
  out.numbers = {
    invoicesTodayOrLater: inv,
    invoiceRepeatRisk: inv.filter((i) => i[SIM] && /^UTAK-INV-\d{8}-\d{3}$/.test(String(i.x_invoice_number))).map((i) => i.x_invoice_number),
    quotationsToday: q,
  };
  log(`invoices dated ${TODAY}+: ${inv.length}, a marked one with a plain UTAK-INV number: ${out.numbers.invoiceRepeatRisk.length}; quotations created today (Riyadh): ${q.length}`);
  const seqs = await call<any[]>("ir.sequence", "search_read", { domain: [], fields: ["id", "name", "code", "prefix", "number_next_actual", "implementation", "use_date_range"], order: "id asc", limit: 300 });
  out.sequences = seqs;
  // the 31 numbers x_wa_allowed was switched off on (§ 27): read only, masked
  const rb27 = JSON.parse(readFileSync(new URL("./artifacts/sim-pure-20260925-wa-allowed-rollback.json", import.meta.url), "utf8"));
  const ids31: number[] = rb27.turned_off.map((r: any) => r.id);
  const ps = await call<any[]>("res.partner", "read", { ids: ids31, fields: ["id", "name", "x_whatsapp_number", "phone", "create_date", "active", "x_wa_allowed", "x_contact_class", "customer_rank", "supplier_rank"], context: { active_test: false } });
  for (const id of ids31) {
    const p = ps.find((x) => x.id === id);
    const [last] = await call<any[]>("x_wa_message", "search_read", { domain: [["x_partner_id", "=", id]], fields: ["id", "create_date", "x_direction", "x_kind"], order: "id desc", limit: 1 });
    out.numbers31.push({
      id, name: p?.name ?? "?", number: mask(p?.x_whatsapp_number || p?.phone || ""), created: p?.create_date ?? null, active: p?.active ?? null,
      x_wa_allowed: p?.x_wa_allowed ?? null, class: p?.x_contact_class || null,
      lastMessage: last ? { at: last.create_date, direction: last.x_direction, kind: last.x_kind } : null,
    });
  }
  writeFileSync(SCAN, JSON.stringify(out, null, 1) + "\n");
  log(`the 31 numbers: ${out.numbers31.length} (masked) → ${SCAN.pathname.split("/").slice(-1)[0]}`);
  process.exit(0);
}

// ---------------------------------------------------------------- backup
if (step === "backup") {
  const snap: any = { at: new Date().toISOString(), rows: {}, acct: await acctCounts() };
  for (const m of MODELS) {
    const s = await selectable(m);
    if (!s.ids.length) continue;
    const f = await fieldsOf(m);
    const fields = Object.keys(f).filter((k) => f[k].type !== "binary");
    snap.rows[m] = await call(m, "read", { ids: s.ids, fields });
  }
  snap.sp = await call("x_supplier_payment", "search_read", { domain: [], fields: ["id", "x_name", SIM, IS, "x_state", "x_supplier_id", "x_amount"], order: "id asc" });
  snap.dateRanges = await call("ir.sequence.date_range", "search_read", { domain: [["sequence_id", "=", SP_SEQUENCE]], fields: ["id", "date_from", "date_to", "number_next_actual"] });
  if (!existsSync(BACKUPS)) mkdirSync(BACKUPS, { recursive: true });
  const file = new URL(`s42-prelaunch-${snap.at.replace(/[-:]/g, "").slice(0, 15)}Z.json`, BACKUPS);
  writeFileSync(file, JSON.stringify(snap, null, 1) + "\n");
  log(`backup: ${Object.entries(snap.rows).map(([m, r]) => `${m} ${(r as unknown[]).length}`).join(", ") || "nothing selected"} · SP ${snap.sp.length} · acct ${JSON.stringify(snap.acct)} → backups/${file.pathname.split("/").pop()}`);
  process.exit(0);
}

// ---------------------------------------------------------------- mark
if (step === "mark") {
  const rb = readRb();
  const backups = existsSync(BACKUPS) ? (await import("node:fs")).readdirSync(BACKUPS).filter((f) => f.startsWith("s42-prelaunch-")) : [];
  if (APPLY && !backups.length) throw new Error("no backup yet — run the backup step first");
  for (const m of MODELS) {
    const s = await selectable(m);
    if (!s.ids.length) continue;
    log(`${m}: ${SIM} ← true on ${s.ids.length} (${s.ids.join(",")})`);
    rb.flags[m] = [...new Set([...(rb.flags[m] ?? []), ...s.ids])];
    saveRb(rb);
    if (APPLY) await call(m, "write", { ids: s.ids, vals: { [SIM]: true } });
  }
  const sp = await call<any[]>("x_supplier_payment", "search_read", { domain: [], fields: ["id", "x_name", SIM], order: "id asc" });
  const real = sp.filter((p) => !p[SIM]);
  const rename = sp.filter((x) => x[SIM] && /^SP-\d{4}-\d+$/.test(String(x.x_name)));
  if (rename.length) {
    // a decided payment is locked by automation #25 (utak.sp.lock, x_name watched):
    // off for these renames only, back on in `finally` (recorded in the rollback file)
    const [lock] = await call<any[]>("base.automation", "read", { ids: [SP_LOCK_AUTOMATION], fields: ["id", "name", "active"], context: { active_test: false } });
    log(`base.automation #${SP_LOCK_AUTOMATION} «${lock?.name}» (active ${lock?.active}): off for ${rename.length} rename(s), then on again`);
    rb.lockAutomation ??= { id: SP_LOCK_AUTOMATION, active: lock?.active === true };
    saveRb(rb);
    try {
      if (APPLY && lock?.active) await call("base.automation", "write", { ids: [SP_LOCK_AUTOMATION], vals: { active: false } });
      for (const p of rename) {
        log(`x_supplier_payment #${p.id}: ${p.x_name} → ${SP_PREFIX}${p.x_name}`);
        rb.spNames[p.id] = p.x_name;
        saveRb(rb);
        if (APPLY) await call("x_supplier_payment", "write", { ids: [p.id], vals: { x_name: `${SP_PREFIX}${p.x_name}` } });
      }
    } finally {
      if (APPLY && lock?.active) await call("base.automation", "write", { ids: [SP_LOCK_AUTOMATION], vals: { active: true } });
    }
  }
  if (real.length) {
    log(`⚠️ SP sequence NOT reset: real (unmarked) payments exist: ${real.map((p) => p.x_name).join(", ")}`);
  } else {
    const dr = await call<any[]>("ir.sequence.date_range", "search_read", { domain: [["sequence_id", "=", SP_SEQUENCE], ["date_from", "<=", TODAY], ["date_to", ">=", TODAY]], fields: ["id", "number_next_actual"] });
    for (const d of dr) {
      if (d.number_next_actual === 1) { log(`= SP date range #${d.id} already at 1`); continue; }
      log(`ir.sequence.date_range #${d.id} (SP ${TODAY.slice(0, 4)}): number_next_actual ${d.number_next_actual} → 1`);
      rb.dateRange ??= { id: d.id, number_next_actual: d.number_next_actual };
      saveRb(rb);
      if (APPLY) await call("ir.sequence.date_range", "write", { ids: [d.id], vals: { number_next_actual: 1 } });
    }
  }
  log(APPLY ? "mark done — run verify" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (step === "verify") {
  let ok = 0, bad = 0;
  const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name}${detail ? " — " + detail.slice(0, 400) : ""}`); } };
  const counts: Record<string, number> = {};
  for (const m of MODELS) {
    const s = await selectable(m);
    if (!s.hasIs) continue;
    counts[m] = s.ids.length;
  }
  check(`nothing left to mark (x_is_simulation without x_utak_simulation): ${JSON.stringify(counts)}`, Object.values(counts).every((n) => n === 0));
  const rb = readRb();
  for (const [m, ids] of Object.entries(rb.flags as Record<string, number[]>)) {
    const rows = await call<any[]>(m, "read", { ids, fields: ["id", SIM] });
    check(`${m}: the ${ids.length} marked still flagged`, rows.length === ids.length && rows.every((r) => r[SIM] === true));
  }
  const sp = await call<any[]>("x_supplier_payment", "search_read", { domain: [], fields: ["id", "x_name", SIM], order: "id asc" });
  check(`every simulation SP reference prefixed ${SP_PREFIX}: ${sp.map((p) => p.x_name).join(", ")}`, sp.filter((p) => p[SIM]).every((p) => String(p.x_name).startsWith(SP_PREFIX)));
  check("no SP-… reference left in use (the next real one cannot repeat one)", !sp.some((p) => /^SP-\d{4}-\d+$/.test(String(p.x_name))));
  const [lockA] = await call<any[]>("base.automation", "read", { ids: [SP_LOCK_AUTOMATION], fields: ["active"], context: { active_test: false } });
  check(`the SP lock (automation #${SP_LOCK_AUTOMATION}) is on again`, lockA?.active === true);
  const [seq] = await call<any[]>("ir.sequence", "read", { ids: [SP_SEQUENCE], fields: ["prefix", "padding", "use_date_range"] });
  const dr = await call<any[]>("ir.sequence.date_range", "search_read", { domain: [["sequence_id", "=", SP_SEQUENCE], ["date_from", "<=", TODAY], ["date_to", ">=", TODAY]], fields: ["id", "number_next_actual"] });
  check(`the next reference is SP-${TODAY.slice(0, 4)}-0001 (prefix ${seq?.prefix}, padding ${seq?.padding}, date range next ${dr[0]?.number_next_actual})`,
    seq?.prefix === "SP-%(range_year)s-" && seq?.padding === 4 && dr.length === 1 && dr[0].number_next_actual === 1);
  const f = await figures();
  for (const [day, s] of Object.entries(f.summaries) as Array<[string, any]>) {
    const zero = (s.tomorrow?.count ?? 0) === 0 && (s.deliveries?.delivered ?? 0) === 0 && (s.deliveries?.total ?? 0) === 0 && (s.collected ?? 0) === 0 && (s.pending ?? 0) === 0 && (s.coverage?.profit ?? 0) === 0;
    check(`the 21:30 summary (م17) of ${day}: zero (orders, deliveries, collected, pending, profit)`, zero && !s.errors?.length, JSON.stringify(s));
  }
  check(`Ahmed (#${AHMED}) 0 / 0 / 0 (Odoo computes and the worker's balance)`, f.ahmed.odoo.x_sp_due_total === 0 && f.ahmed.odoo.x_sp_paid_total === 0 && f.ahmed.odoo.x_sp_remaining === 0
    && f.ahmed.worker.dueH === 0 && f.ahmed.worker.paidH === 0 && f.ahmed.worker.remainingH === 0, JSON.stringify(f.ahmed));
  check(`no supplier due left (not simulation): ${f.dues.count} rows, ${f.dues.total} SAR`, f.dues.count === 0 && f.dues.total === 0);
  check(`nothing owed by customers (م2) and no unpaid invoice for 18:00: ${JSON.stringify({ owed: f.owed, unpaid: f.unpaid })}`, f.owed.length === 0 && f.unpaid.length === 0);
  const acct = await acctCounts();
  check(`account.move ${acct.moves} = ${EXPECT_MOVES}, account.payment ${acct.payments} = ${EXPECT_PAYMENTS} (unchanged)`, acct.moves === EXPECT_MOVES && acct.payments === EXPECT_PAYMENTS);
  log(`verify: ${ok}/${ok + bad}`);
  writeFileSync(new URL("./artifacts/s42-20260927-prelaunch-verify.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), ok, total: ok + bad, counts, figures: f, acct }, null, 1) + "\n");
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- rollback
if (step === "rollback") {
  const rb = readRb();
  for (const [m, ids] of Object.entries(rb.flags as Record<string, number[]>)) {
    log(`  ${m}: ${ids.length} flags back to false`);
    if (APPLY && ids.length) await call(m, "write", { ids, vals: { [SIM]: false } });
  }
  const names = Object.entries(rb.spNames as Record<string, string>);
  if (names.length) {
    log(`  base.automation #${SP_LOCK_AUTOMATION}: off for the renames, then on again`);
    try {
      if (APPLY) await call("base.automation", "write", { ids: [SP_LOCK_AUTOMATION], vals: { active: false } });
      for (const [id, name] of names) {
        log(`  x_supplier_payment #${id}: back to ${name}`);
        if (APPLY) await call("x_supplier_payment", "write", { ids: [Number(id)], vals: { x_name: name } });
      }
    } finally {
      if (APPLY && rb.lockAutomation?.active !== false) await call("base.automation", "write", { ids: [SP_LOCK_AUTOMATION], vals: { active: true } });
    }
  }
  if (rb.dateRange) {
    log(`  ir.sequence.date_range #${rb.dateRange.id}: number_next_actual back to ${rb.dateRange.number_next_actual}`);
    if (APPLY) await call("ir.sequence.date_range", "write", { ids: [rb.dateRange.id], vals: { number_next_actual: rb.dateRange.number_next_actual } });
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

log("steps: scan · backup · mark [--apply] · verify · rollback [--apply]");
process.exit(2);

// ---------------------------------------------------------------- the figures (src/, reads only)
async function figures(): Promise<any> {
  const dotenv = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const kv = new Map<string, string>();
  const env: any = {
    ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
    OWNER_WHATSAPP: "+966505154962", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
    MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
  };
  const SUM = await import("../src/owner-summary.ts");
  const OUTR = await import("../src/outreach.ts");
  const SPM = await import("../src/supplier-pay.ts");
  const { getUnpaidInvoicesWithCustomer } = await import("../src/odoo.ts");
  const out: any = { summaries: {} };
  const yesterday = new Date(Date.parse(`${TODAY}T12:00:00+03:00`) - 24 * 3600_000).toISOString().slice(0, 10);
  for (const d of [yesterday, TODAY]) {
    const s = await SUM.readSummaryFigures(env, Date.parse(`${d}T21:30:00+03:00`));
    out.summaries[d] = { tomorrow: s.tomorrow, deliveries: s.deliveries, collected: s.collected, pending: s.pending, coverage: s.coverage, errors: s.errors };
  }
  const [a] = await call<any[]>("res.partner", "read", { ids: [AHMED], fields: ["x_sp_due_total", "x_sp_paid_total", "x_sp_remaining"] });
  out.ahmed = { odoo: { x_sp_due_total: a.x_sp_due_total, x_sp_paid_total: a.x_sp_paid_total, x_sp_remaining: a.x_sp_remaining }, worker: await SPM.supplierBalance(env, AHMED) };
  const dues = await call<any[]>("x_supplier_due", "search_read", { domain: [[SIM, "!=", true]], fields: ["id", "x_amount"] });
  out.dues = { count: dues.length, total: dues.reduce((t, d) => t + (d.x_amount || 0), 0) };
  out.owed = [...(await OUTR.owedByCustomer(env)).entries()];
  out.unpaid = (await getUnpaidInvoicesWithCustomer(env)).map((i: any) => [i.id, i.total]);
  return out;
}
