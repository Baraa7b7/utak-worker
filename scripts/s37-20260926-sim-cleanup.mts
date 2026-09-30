// STATUS § 37 ج (2026-09-26): § 37's trial marked «محاكاة», never deleted.
//
// The trial of § 37 (scripts/s37-20260925-live-trial.mts) left real rows in the
// shared Odoo tenant and in the sim worker's D1: purchase list #7, its due and
// three lines, the payments SP-2026-0001 … 0003 (0003 is «رصيد دائن» on the test
// supplier «براء - اختبار»), the seven x_wa_message rows of its messages, and
// their status calls / outbound captures in D1. From here on they are marked:
//
//   • Odoo: x_utak_simulation (boolean «محاكاة (تجربة)», default false) on
//     x_purchase_list, x_supplier_payment, x_supplier_due, x_supplier_due_line
//     and x_wa_message — created through ir.model.fields over the JSON-2 API,
//     as scripts/s37-20260925-odoo.mjs created § 37's own fields. Not
//     x_is_simulation: that one is on every row the sim / pilot worker creates.
//   • D1 (sim only; prod has none): is_simulation on wa_status_log and
//     sim_outbound — schema/is_simulation.sql, applied once with wrangler.
//
// Then nothing marked counts: the three computes on res.partner (due, approved
// paid, remaining) leave it out, the supplier's two tabs (one2many) do not
// list it, and the two menus open on «بلا المحاكاة». The worker's side
// (src/supplier-pay.ts, src/wa-gateway.ts) is in the same commit.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s37-20260926-sim-cleanup.mts <step> [--apply]
//
// Steps, in this order:
//   backup    read-only: every affected row, Odoo and D1, and the balances → backups/s37-sim-cleanup-<ts>.json (git-ignored)
//   balance   read-only: Ahmed's and «براء - اختبار»'s due / paid / remaining — Odoo's computes and the worker's supplierBalance
//   fields    the field on the five models; the computes, the two one2many, the two menus' filter (dry-run without --apply)
//   mark      the records: x_utak_simulation = true, D1 is_simulation = 1 (dry-run without --apply; needs a backup first)
//   verify    read-only checks
//   fixture   read-only: fields_get → tests/fixtures-odoo-fields-20260926-s37-sim.json
//   rollback  [--apply] flags back to false / 0, computes / domains / views / windows back as they were (the fields stay;
//             --drop removes them and the search view too)
//
// Rollback file: scripts/artifacts/s37-20260926-sim-cleanup-rollback.json. No WhatsApp, no deletion of any row, the SP
// sequence untouched. Tenant shared with prod.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { call } from "./lib/odoo-cli.mjs";
import { liveSimEnv } from "./lib/cf-live-env.mjs";
import {
  DUE_TOTAL_COMPUTE, DUE_TOTAL_DEPENDS, PAID_TOTAL_COMPUTE, PAID_TOTAL_DEPENDS, REMAINING_COMPUTE, REMAINING_DEPENDS, SIM_FIELD,
  SP_O2M_DOMAIN, SEQ_CODE,
} from "./lib/s37-odoo-code.mjs";

const step = process.argv[2] ?? "";
const APPLY = process.argv.includes("--apply");
const DROP = process.argv.includes("--drop");
const ROOT = new URL("../", import.meta.url);
const RB = new URL("./artifacts/s37-20260926-sim-cleanup-rollback.json", import.meta.url);
const BACKUPS = new URL("../backups/", import.meta.url);
const log = (...a: unknown[]) => console.log(...a);

// Only Odoo and Cloudflare: never Meta (no WhatsApp in this task).
globalThis.fetch = ((real) => (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!/^https:\/\/(utakfresh\.odoo\.com|api\.cloudflare\.com)\//.test(url)) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

// ---------------------------------------------------------------- what the trial left
const TAG = "🧪 تجربة § 37";
const LIST_ID = 7;
const REFS = ["SP-2026-0001", "SP-2026-0002", "SP-2026-0003"];
/** x_wa_message rows of the trial's messages (s37-20260925-live-trial-verify.json): Baraa 195–197, 200; Ahmed 198; Omar 199, 201. */
const WA_ROWS = [195, 196, 197, 198, 199, 200, 201];
const PARTNERS = [30, 7]; // أحمد حسان، براء - اختبار
const MODELS = ["x_purchase_list", "x_supplier_payment", "x_supplier_due", "x_supplier_due_line", "x_wa_message"] as const;
const FIELD = {
  name: SIM_FIELD, ttype: "boolean", field_description: "محاكاة (تجربة)",
  help: "سجل تجربة (STATUS § 37 ج): لا يدخل في مستحق المورد ولا المدفوع ولا المتبقي ولا «رصيد دائن»، ولا يُرسل إشعاره للمورد. لا يُحذف.",
};
const PARTNER_COMPUTES = [
  { name: "x_sp_due_total", compute: DUE_TOTAL_COMPUTE, depends: DUE_TOTAL_DEPENDS },
  { name: "x_sp_paid_total", compute: PAID_TOTAL_COMPUTE, depends: PAID_TOTAL_DEPENDS },
  { name: "x_sp_remaining", compute: REMAINING_COMPUTE, depends: REMAINING_DEPENDS },
];
const PARTNER_O2M = ["x_sp_due_ids", "x_sp_payment_ids"];
const FILTERS = `<separator/>
  <filter name="f_real" string="بلا المحاكاة" domain="[('${SIM_FIELD}', '=', False)]"/>
  <filter name="f_sim" string="محاكاة (تجربة)" domain="[('${SIM_FIELD}', '=', True)]"/>`;
const PAY_BANNER = `<field name="${SIM_FIELD}" invisible="1"/>
    <div class="alert alert-info" role="alert" invisible="not ${SIM_FIELD}">محاكاة (تجربة): هذه الدفعة لا تدخل في مستحق المورد ولا رصيده، ولا يُرسل عنها إشعار.</div>`;
const DUE_SEARCH = `<search string="مستحقات الموردين اليومية">
  <field name="x_supplier_id"/>
  <field name="x_purchase_list_id"/>
  <filter name="f_unpriced" string="فيها «بلا سعر»" domain="[('x_unpriced_count', '>', 0)]"/>
  ${FILTERS}
</search>`;
const NAMES = {
  payForm: "utak.supplier_payment_form", paySearch: "utak.supplier_payment_search", dueSearch: "utak.supplier_due_search",
  payments: "UTAK — دفعات الموردين", dues: "UTAK — مستحقات الموردين اليومية",
};
const PAY_CONTEXT = "{'search_default_f_pending': 1, 'search_default_f_real': 1}";
const DUE_CONTEXT = "{'search_default_f_real': 1}";

// ---------------------------------------------------------------- helpers
const one = async (model: string, domain: unknown[]) => ((await call(model, "search_read", { domain, fields: ["id"], limit: 2, context: { active_test: false } })) as any[])[0]?.id as number | undefined;
const fieldRow = async (model: string, name: string) => ((await call("ir.model.fields", "search_read", {
  domain: [["model", "=", model], ["name", "=", name]], fields: ["id", "ttype", "compute", "depends", "domain", "field_description"], limit: 1,
})) as any[])[0] ?? null;
const readRb = () => (existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s37-20260926-sim-cleanup.mts", createdAt: new Date().toISOString() });
const saveRb = (rb: any) => { if (APPLY) writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n"); };
const hasField = async (model: string) => !!(await call(model, "fields_get", { attributes: ["type"] }) as any)[SIM_FIELD];

/** The records, from the trial's own markers (x_is_simulation / the tag / the list) — stops on anything else. */
async function targets() {
  const [list] = await call("x_purchase_list", "read", { ids: [LIST_ID], fields: ["id", "x_name", "x_is_simulation", "x_status"] }) as any[];
  if (!list || list.x_is_simulation !== true || !String(list.x_name).startsWith(TAG)) throw new Error(`list #${LIST_ID} is not the § 37 trial list: ${JSON.stringify(list)} — stop`);
  const pays = await call("x_supplier_payment", "search_read", { domain: [["x_name", "in", REFS]], fields: ["id", "x_name", "x_trial_tag", "x_is_simulation"], order: "id asc" }) as any[];
  if (pays.length !== REFS.length || pays.some((p) => p.x_trial_tag !== TAG || p.x_is_simulation !== true)) throw new Error(`payments ${REFS.join(",")} are not all the § 37 trial's: ${JSON.stringify(pays)} — stop`);
  const dues = await call("x_supplier_due", "search_read", { domain: [["x_purchase_list_id", "=", LIST_ID]], fields: ["id", "x_is_simulation"], order: "id asc" }) as any[];
  const lines = dues.length ? await call("x_supplier_due_line", "search_read", { domain: [["x_due_id", "in", dues.map((d) => d.id)]], fields: ["id", "x_is_simulation"], order: "id asc" }) as any[] : [];
  if ([...dues, ...lines].some((r) => r.x_is_simulation !== true)) throw new Error("a due / line of list #7 is not x_is_simulation — stop");
  const wa = await call("x_wa_message", "read", { ids: WA_ROWS, fields: ["id", "x_body", "x_meta_message_id"] }) as any[];
  if (wa.length !== WA_ROWS.length || wa.some((w) => !String(w.x_body).startsWith(TAG))) throw new Error(`x_wa_message ${WA_ROWS.join(",")} are not all the trial's: ${JSON.stringify(wa.map((w) => [w.id, String(w.x_body).slice(0, 30)]))} — stop`);
  return {
    odoo: {
      x_purchase_list: [LIST_ID],
      x_supplier_payment: pays.map((p) => p.id),
      x_supplier_due: dues.map((d) => d.id),
      x_supplier_due_line: lines.map((l) => l.id),
      x_wa_message: WA_ROWS,
    } as Record<(typeof MODELS)[number], number[]>,
    wamids: wa.map((w) => String(w.x_meta_message_id || "")).filter(Boolean),
  };
}

async function d1Targets(env: any, wamids: string[]) {
  const q = async (sql: string, p: unknown[]) => (await env.SIM_DB.prepare(sql).bind(...p).all()).results as any[];
  const marks = wamids.map(() => "?").join(",");
  return {
    wa_status_log: (await q(`SELECT id FROM wa_status_log WHERE wamid IN (${marks}) OR row_id IN (${WA_ROWS.join(",")}) ORDER BY id`, wamids)).map((r) => r.id as number),
    sim_outbound: (await q(`SELECT id FROM sim_outbound WHERE wamid IN (${marks}) ORDER BY id`, wamids)).map((r) => r.id as number),
  };
}

/** Due / paid / remaining: Odoo's computes and the worker's supplierBalance (the deployed rule, from src/). */
async function balances(env: any) {
  const { supplierBalance, money } = await import("../src/supplier-pay.ts");
  const odoo = await call("res.partner", "read", { ids: PARTNERS, fields: ["id", "name", "x_sp_due_total", "x_sp_paid_total", "x_sp_remaining"], context: { active_test: false } }) as any[];
  const out: any[] = [];
  for (const p of odoo) {
    const b = await supplierBalance(env, p.id);
    out.push({
      id: p.id, name: p.name,
      odoo: { due: p.x_sp_due_total, paid: p.x_sp_paid_total, remaining: p.x_sp_remaining },
      worker: { due: money(b.dueH), paid: money(b.paidH), remaining: money(b.remainingH) },
    });
  }
  return out;
}
const printBalances = (b: any[]) => { for (const x of b) log(`  ${x.name} (#${x.id}) — Odoo: مستحق ${x.odoo.due} · مدفوع ${x.odoo.paid} · متبقٍ ${x.odoo.remaining} | الوركر: مستحق ${x.worker.due} · مدفوع ${x.worker.paid} · متبقٍ ${x.worker.remaining}`); };

async function counts() {
  const out: Record<string, number> = {};
  for (const m of MODELS) out[m] = await call(m, "search_count", { domain: [] }) as number;
  out["account.move"] = await call("account.move", "search_count", { domain: [] }) as number;
  out["account.payment"] = await call("account.payment", "search_count", { domain: [] }) as number;
  return out;
}
async function sequence() {
  const [s] = await call("ir.sequence", "search_read", { domain: [["code", "=", SEQ_CODE]], fields: ["id", "number_next_actual", "prefix", "use_date_range", "date_range_ids"], limit: 1 }) as any[];
  const ranges = s?.date_range_ids?.length ? await call("ir.sequence.date_range", "read", { ids: s.date_range_ids, fields: ["date_from", "date_to", "number_next_actual"] }) : [];
  return { id: s?.id, prefix: s?.prefix, number_next_actual: s?.number_next_actual, ranges };
}

// ================================================================ backup
if (step === "backup") {
  const env: any = await liveSimEnv();
  const t = await targets();
  const d1 = await d1Targets(env, t.wamids);
  const rows: Record<string, unknown> = {};
  for (const m of MODELS) {
    const f = await call(m, "fields_get", { attributes: ["type"] }) as Record<string, { type: string }>;
    const fields = Object.keys(f).filter((k) => f[k].type !== "binary" || k === "x_receipt");
    rows[m] = await call(m, "read", { ids: t.odoo[m], fields, context: { active_test: false } });
  }
  const q = async (sql: string, ids: number[]) => ids.length ? (await env.SIM_DB.prepare(`${sql} WHERE id IN (${ids.join(",")}) ORDER BY id`).all()).results : [];
  const out = {
    what: "STATUS § 37 ج — the § 37 trial's rows before they are marked «محاكاة» (nothing deleted). Odoo utakfresh.odoo.com + the sim worker's D1 utak-worker-sim-db.",
    at: new Date().toISOString(),
    ids: { odoo: t.odoo, d1 },
    odoo: rows,
    d1: {
      wa_status_log: await q("SELECT * FROM wa_status_log", d1.wa_status_log),
      sim_outbound: await q("SELECT * FROM sim_outbound", d1.sim_outbound),
    },
    partnerComputes: await call("ir.model.fields", "search_read", { domain: [["model", "=", "res.partner"], ["name", "in", [...PARTNER_COMPUTES.map((c) => c.name), ...PARTNER_O2M]]], fields: ["name", "compute", "depends", "domain"] }),
    balancesBefore: await balances(env),
    counts: await counts(),
    sequence: await sequence(),
  };
  mkdirSync(BACKUPS, { recursive: true });
  const ts = out.at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const file = new URL(`s37-sim-cleanup-${ts}.json`, BACKUPS);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  log(`backup → ${file.pathname.replace(ROOT.pathname, "")}`);
  log(`  Odoo: ${MODELS.map((m) => `${m} ${t.odoo[m].length}`).join(" · ")}`);
  log(`  D1: wa_status_log ${d1.wa_status_log.length} (${d1.wa_status_log.join(",")}) · sim_outbound ${d1.sim_outbound.length} (${d1.sim_outbound.join(",")})`);
  log(`  counts: ${JSON.stringify(out.counts)} · sequence: next ${out.sequence.number_next_actual} ${JSON.stringify(out.sequence.ranges)}`);
  log("  balances before:"); printBalances(out.balancesBefore);
  process.exit(0);
}

// ================================================================ balance
if (step === "balance") {
  const env: any = await liveSimEnv();
  const b = await balances(env);
  printBalances(b);
  writeFileSync(new URL(`./artifacts/s37-20260926-sim-cleanup-balance-${process.argv[3] ?? "now"}.json`, import.meta.url), JSON.stringify({ at: new Date().toISOString(), balances: b }, null, 2) + "\n");
  process.exit(0);
}

// ================================================================ fields
if (step === "fields") {
  const rb = readRb();
  rb.fields ??= {};
  rb.computesBefore ??= {};
  rb.o2mBefore ??= {};
  rb.views ??= {};
  rb.windows ??= {};
  // 1. the field on the five models
  for (const m of MODELS) {
    const have = await fieldRow(m, SIM_FIELD);
    if (have) { log(`= ${m}.${SIM_FIELD} #${have.id} (${have.ttype})`); continue; }
    log(`+ ${m}.${SIM_FIELD} (boolean «${FIELD.field_description}», default false)`);
    if (!APPLY) continue;
    const mid = await one("ir.model", [["model", "=", m]]);
    if (!mid) throw new Error(`no ir.model ${m} — stop`);
    const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: mid, ...FIELD }] }) as number[];
    rb.fields[m] = id; saveRb(rb);
  }
  // 2. the three computes on res.partner: leave x_utak_simulation out
  for (const c of PARTNER_COMPUTES) {
    const f = await fieldRow("res.partner", c.name);
    if (!f) throw new Error(`res.partner.${c.name} missing — run scripts/s37-20260925-odoo.mjs first`);
    if (f.compute?.trim() === c.compute.trim() && f.depends === c.depends) { log(`= res.partner.${c.name} compute without ${SIM_FIELD}`); continue; }
    log(`✎ res.partner.${c.name}: compute + depends «${c.depends}»`);
    if (!APPLY) continue;
    rb.computesBefore[c.name] ??= { id: f.id, compute: f.compute, depends: f.depends }; saveRb(rb);
    await call("ir.model.fields", "write", { ids: [f.id], vals: { compute: c.compute, depends: c.depends } });
  }
  // 3. the supplier's two tabs (one2many): without it
  for (const name of PARTNER_O2M) {
    const f = await fieldRow("res.partner", name);
    if (!f) throw new Error(`res.partner.${name} missing — stop`);
    if (f.domain === SP_O2M_DOMAIN) { log(`= res.partner.${name} domain ${SP_O2M_DOMAIN}`); continue; }
    log(`✎ res.partner.${name}: domain ${f.domain || "[]"} → ${SP_O2M_DOMAIN}`);
    if (!APPLY) continue;
    rb.o2mBefore[name] ??= { id: f.id, domain: f.domain || false }; saveRb(rb);
    await call("ir.model.fields", "write", { ids: [f.id], vals: { domain: SP_O2M_DOMAIN } });
  }
  // 4. the menus: «بلا المحاكاة» by default (and «محاكاة (تجربة)» to see them), the payment form's banner
  const view = async (name: string) => ((await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_base"], limit: 1 })) as any[])[0] ?? null;
  const paySearch = await view(NAMES.paySearch);
  if (!paySearch) throw new Error(`view ${NAMES.paySearch} missing — stop`);
  if (String(paySearch.arch_base).includes('name="f_real"')) log(`= ${NAMES.paySearch}: «بلا المحاكاة»`);
  else {
    log(`✎ ${NAMES.paySearch}: + «بلا المحاكاة» / «محاكاة (تجربة)»`);
    if (!String(paySearch.arch_base).includes("  <group>")) throw new Error(`${NAMES.paySearch}: no <group> to insert before — stop`);
    if (APPLY) {
      rb.views.paySearch ??= { id: paySearch.id, arch_base: paySearch.arch_base }; saveRb(rb);
      await call("ir.ui.view", "write", { ids: [paySearch.id], vals: { arch_base: String(paySearch.arch_base).replace("  <group>", `  ${FILTERS}\n  <group>`) } });
    }
  }
  const payForm = await view(NAMES.payForm);
  if (!payForm) throw new Error(`view ${NAMES.payForm} missing — stop`);
  if (String(payForm.arch_base).includes(SIM_FIELD)) log(`= ${NAMES.payForm}: the banner`);
  else {
    log(`✎ ${NAMES.payForm}: + the «محاكاة (تجربة)» banner`);
    if (APPLY) {
      rb.views.payForm ??= { id: payForm.id, arch_base: payForm.arch_base }; saveRb(rb);
      await call("ir.ui.view", "write", { ids: [payForm.id], vals: { arch_base: String(payForm.arch_base).replace("<sheet>", `<sheet>\n    ${PAY_BANNER}`) } });
    }
  }
  let dueSearchId = (await view(NAMES.dueSearch))?.id ?? rb.views.dueSearchCreated;
  if (dueSearchId) log(`= ${NAMES.dueSearch} #${dueSearchId}`);
  else {
    log(`+ ${NAMES.dueSearch}`);
    if (APPLY) { [dueSearchId] = await call("ir.ui.view", "create", { vals_list: [{ name: NAMES.dueSearch, model: "x_supplier_due", type: "search", arch_base: DUE_SEARCH }] }) as number[]; rb.views.dueSearchCreated = dueSearchId; saveRb(rb); }
  }
  const win = async (name: string) => ((await call("ir.actions.act_window", "search_read", { domain: [["name", "=", name]], fields: ["id", "context", "search_view_id"], limit: 1 })) as any[])[0] ?? null;
  const pw = await win(NAMES.payments), dw = await win(NAMES.dues);
  if (!pw || !dw) throw new Error("the § 37 windows are missing — stop");
  if (pw.context === PAY_CONTEXT) log(`= ${NAMES.payments}: ${PAY_CONTEXT}`);
  else {
    log(`✎ ${NAMES.payments}: context ${pw.context} → ${PAY_CONTEXT}`);
    if (APPLY) { rb.windows.payments ??= { id: pw.id, context: pw.context }; saveRb(rb); await call("ir.actions.act_window", "write", { ids: [pw.id], vals: { context: PAY_CONTEXT } }); }
  }
  if (dw.context === DUE_CONTEXT && dw.search_view_id && dw.search_view_id[0] === dueSearchId) log(`= ${NAMES.dues}: ${DUE_CONTEXT}, search view #${dueSearchId}`);
  else {
    log(`✎ ${NAMES.dues}: context ${dw.context} → ${DUE_CONTEXT}, search view → ${NAMES.dueSearch}`);
    if (APPLY) {
      rb.windows.dues ??= { id: dw.id, context: dw.context, search_view_id: dw.search_view_id ? dw.search_view_id[0] : false }; saveRb(rb);
      await call("ir.actions.act_window", "write", { ids: [dw.id], vals: { context: DUE_CONTEXT, search_view_id: dueSearchId } });
    }
  }
  log(APPLY ? "fields: applied" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ================================================================ mark
if (step === "mark") {
  const backups = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => f.startsWith("s37-sim-cleanup-")) : [];
  if (!backups.length) throw new Error("no backups/s37-sim-cleanup-*.json — run the backup step first");
  for (const m of MODELS) if (!(await hasField(m))) throw new Error(`${m}.${SIM_FIELD} missing — run the fields step first`);
  const env: any = await liveSimEnv();
  const cols = async (t: string) => ((await env.SIM_DB.prepare(`PRAGMA table_info(${t})`).all()).results as any[]).map((c) => c.name);
  for (const t of ["wa_status_log", "sim_outbound"]) if (!(await cols(t)).includes("is_simulation")) throw new Error(`D1 ${t}.is_simulation missing — apply schema/is_simulation.sql first`);
  const t = await targets();
  const d1 = await d1Targets(env, t.wamids);
  const rb = readRb();
  rb.marked ??= { odoo: {}, d1: {} };
  for (const m of MODELS) {
    const ids = t.odoo[m];
    const already = await call(m, "search_read", { domain: [["id", "in", ids], [SIM_FIELD, "=", true]], fields: ["id"] }) as any[];
    const todo = ids.filter((id) => !already.some((a) => a.id === id));
    log(`${todo.length ? "✎" : "="} ${m}: ${ids.join(",")} → ${SIM_FIELD} = true${todo.length ? ` (${todo.length} to write)` : ""}`);
    if (APPLY) { rb.marked.odoo[m] = ids; saveRb(rb); if (todo.length) await call(m, "write", { ids: todo, vals: { [SIM_FIELD]: true } }); }
  }
  for (const [table, ids] of Object.entries(d1)) {
    log(`✎ D1 ${table}: ${ids.join(",")} → is_simulation = 1`);
    if (APPLY && ids.length) { rb.marked.d1[table] = ids; saveRb(rb); await env.SIM_DB.prepare(`UPDATE ${table} SET is_simulation = 1 WHERE id IN (${ids.join(",")})`).run(); }
  }
  log(APPLY ? "mark: applied" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ================================================================ verify
if (step === "verify") {
  const env: any = await liveSimEnv();
  let ok = 0, bad = 0;
  const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name} ${detail}`); } };
  const rb = readRb();
  for (const m of MODELS) {
    const f = await fieldRow(m, SIM_FIELD);
    check(`${m}.${SIM_FIELD} boolean`, f?.ttype === "boolean");
  }
  const comp = await call("ir.model.fields", "search_read", { domain: [["model", "=", "res.partner"], ["name", "in", [...PARTNER_COMPUTES.map((c) => c.name), ...PARTNER_O2M]]], fields: ["name", "compute", "depends", "domain"] }) as any[];
  const by = Object.fromEntries(comp.map((c) => [c.name, c]));
  check(`the three computes leave ${SIM_FIELD} out (as in scripts/lib/s37-odoo-code.mjs)`, PARTNER_COMPUTES.every((c) => by[c.name]?.compute?.trim() === c.compute.trim() && by[c.name]?.depends === c.depends));
  check(`the supplier's two tabs: domain ${SP_O2M_DOMAIN}`, PARTNER_O2M.every((n) => by[n]?.domain === SP_O2M_DOMAIN));
  // the Python in python3 (stub records) against the worker's rule: simulation rows count nowhere
  const cases = [
    { dues: [[168, true], [216, false]], pays: [[150, "approved", true], [40, "rejected", true], [100, "approved", false], [30, "pending", false]] },
    { dues: [], pays: [[50, "approved", true]] },
    { dues: [[78, false], [90, false]], pays: [[136, "approved", false]] },
  ];
  const py = `
import json, sys
class L(list):
    def mapped(self, f):
        return [getattr(x, f) for x in self]
    def filtered(self, fn):
        return L([x for x in self if fn(x)])
class R:
    def __init__(self, **kw):
        self.__dict__.update(kw)
    def __setitem__(self, k, v):
        self.__dict__[k] = v
    def __getitem__(self, k):
        return self.__dict__[k]
out = []
for c in json.loads(sys.argv[1]):
    rec = R(x_sp_due_ids=L([R(x_amount=a, ${SIM_FIELD}=s) for a, s in c['dues']]), x_sp_payment_ids=L([R(x_amount=a, x_state=st, ${SIM_FIELD}=s) for a, st, s in c['pays']]))
    self = [rec]
${PARTNER_COMPUTES.map((c) => (by[c.name]?.compute ?? c.compute).split("\n").map((l: string) => "    " + l).join("\n")).join("\n")}
    out.append([rec['x_sp_due_total'], rec['x_sp_paid_total'], rec['x_sp_remaining']])
print(json.dumps(out))
`;
  const got = JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify(cases)], { encoding: "utf8" }));
  check("Odoo's computes in python3: 216/100/116 · 0/0/0 · 168/136/32 (simulation rows out)", JSON.stringify(got) === JSON.stringify([[216, 100, 116], [0, 0, 0], [168, 136, 32]]), JSON.stringify(got));
  const views = await call("ir.ui.view", "search_read", { domain: [["name", "in", [NAMES.paySearch, NAMES.payForm, NAMES.dueSearch]]], fields: ["name", "arch_base"] }) as any[];
  const vb = Object.fromEntries(views.map((v) => [v.name, String(v.arch_base)]));
  check("payments search: «بلا المحاكاة» and «محاكاة (تجربة)» after a separator", vb[NAMES.paySearch]?.includes('<separator/>') && vb[NAMES.paySearch]?.includes('name="f_real"') && vb[NAMES.paySearch]?.includes('name="f_sim"'));
  check("payment form: the banner", vb[NAMES.payForm]?.includes(`invisible="not ${SIM_FIELD}"`));
  check("dues search view", vb[NAMES.dueSearch]?.includes('name="f_real"'));
  const wins = await call("ir.actions.act_window", "search_read", { domain: [["name", "in", [NAMES.payments, NAMES.dues]]], fields: ["name", "context", "search_view_id"] }) as any[];
  const wb = Object.fromEntries(wins.map((w) => [w.name, w]));
  check(`«دفعات الموردين» opens on pending + «بلا المحاكاة»`, wb[NAMES.payments]?.context === PAY_CONTEXT);
  check(`«مستحقات الموردين اليومية» opens on «بلا المحاكاة»`, wb[NAMES.dues]?.context === DUE_CONTEXT && wb[NAMES.dues]?.search_view_id?.[1] === NAMES.dueSearch);
  // the marks: exactly the trial's rows, nothing else
  const t = await targets();
  for (const m of MODELS) {
    const flagged = (await call(m, "search_read", { domain: [[SIM_FIELD, "=", true]], fields: ["id"], order: "id asc" }) as any[]).map((r) => r.id);
    check(`${m}: marked = ${t.odoo[m].join(",")} (and nothing else)`, JSON.stringify(flagged) === JSON.stringify(t.odoo[m]), JSON.stringify(flagged));
  }
  const d1 = await d1Targets(env, t.wamids);
  for (const [table, ids] of Object.entries(d1)) {
    const flagged = ((await env.SIM_DB.prepare(`SELECT id FROM ${table} WHERE is_simulation = 1 ORDER BY id`).all()).results as any[]).map((r) => r.id);
    check(`D1 ${table}: marked = ${ids.join(",")} (and nothing else)`, JSON.stringify(flagged) === JSON.stringify(ids), JSON.stringify(flagged));
  }
  const [ahmed] = await call("res.partner", "read", { ids: [30], fields: ["x_sp_due_ids", "x_sp_payment_ids"] }) as any[];
  check("Ahmed's tabs list neither the trial's due nor its payments", (ahmed?.x_sp_due_ids ?? []).length === 0 && (ahmed?.x_sp_payment_ids ?? []).length === 0, JSON.stringify(ahmed));
  const b = await balances(env);
  check("balances after: Ahmed and «براء - اختبار» 0 / 0 / 0, Odoo = the worker", b.every((x) => x.odoo.due === 0 && x.odoo.paid === 0 && x.odoo.remaining === 0 && x.worker.due === "0.00" && x.worker.paid === "0.00" && x.worker.remaining === "0.00"), JSON.stringify(b));
  const backup = readdirSync(BACKUPS).filter((f) => f.startsWith("s37-sim-cleanup-")).sort().at(0);
  const before = backup ? JSON.parse(readFileSync(new URL(backup, BACKUPS), "utf8")) : null;
  const c = await counts();
  check("no row deleted, no accounting (counts as in the backup)", !!before && JSON.stringify(c) === JSON.stringify(before.counts), JSON.stringify({ now: c, before: before?.counts }));
  const s = await sequence();
  check("the SP sequence untouched", !!before && JSON.stringify(s) === JSON.stringify(before.sequence), JSON.stringify({ now: s, before: before?.sequence }));
  printBalances(b);
  log(`verify: ${ok}/${ok + bad}${rb.marked ? "" : " (not marked yet)"}`);
  process.exit(bad ? 1 : 0);
}

// ================================================================ fixture
if (step === "fixture") {
  // read-only: fields_get → tests/fixtures-odoo-fields-20260926-s37-sim.json (the strict schema gate after § 37 ج)
  const out: Record<string, any> = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only), after § 37 ج: every field of each model, ${SIM_FIELD} included.`, _selections: {} };
  for (const m of MODELS) {
    const f = await call(m, "fields_get", { attributes: ["type", "selection"] }) as Record<string, any>;
    out[m] = Object.keys(f).sort();
    for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s: any) => s[0]);
  }
  writeFileSync(new URL("../tests/fixtures-odoo-fields-20260926-s37-sim.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
  log(MODELS.map((m) => `${m}: ${out[m].length}${out[m].includes(SIM_FIELD) ? ` (+${SIM_FIELD})` : ""}`).join(", "));
  process.exit(0);
}

// ================================================================ rollback
if (step === "rollback") {
  const rb = readRb();
  const env: any = rb.marked?.d1 && Object.keys(rb.marked.d1).length ? await liveSimEnv() : null;
  for (const [m, ids] of Object.entries(rb.marked?.odoo ?? {}) as Array<[string, number[]]>) {
    log(`${m}: ${ids.join(",")} → ${SIM_FIELD} = false`);
    if (APPLY && ids.length) await call(m, "write", { ids, vals: { [SIM_FIELD]: false } });
  }
  for (const [table, ids] of Object.entries(rb.marked?.d1 ?? {}) as Array<[string, number[]]>) {
    log(`D1 ${table}: ${ids.join(",")} → is_simulation = 0`);
    if (APPLY && ids.length) await env.SIM_DB.prepare(`UPDATE ${table} SET is_simulation = 0 WHERE id IN (${ids.join(",")})`).run();
  }
  for (const [name, b] of Object.entries(rb.computesBefore ?? {}) as Array<[string, any]>) {
    log(`res.partner.${name}: compute / depends back («${b.depends}»)`);
    if (APPLY) await call("ir.model.fields", "write", { ids: [b.id], vals: { compute: b.compute, depends: b.depends } });
  }
  for (const [name, b] of Object.entries(rb.o2mBefore ?? {}) as Array<[string, any]>) {
    log(`res.partner.${name}: domain back (${b.domain || "[]"})`);
    if (APPLY) await call("ir.model.fields", "write", { ids: [b.id], vals: { domain: b.domain } });
  }
  for (const k of ["paySearch", "payForm"]) {
    const b = rb.views?.[k];
    if (!b) continue;
    log(`view #${b.id}: arch back`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [b.id], vals: { arch_base: b.arch_base } });
  }
  for (const k of ["payments", "dues"]) {
    const b = rb.windows?.[k];
    if (!b) continue;
    log(`window #${b.id}: context back${"search_view_id" in b ? ", search view back" : ""}`);
    if (APPLY) await call("ir.actions.act_window", "write", { ids: [b.id], vals: { context: b.context, ...("search_view_id" in b ? { search_view_id: b.search_view_id } : {}) } });
  }
  if (DROP) {
    const views = [rb.views?.dueSearchCreated].filter(Boolean);
    const fields = Object.values(rb.fields ?? {}) as number[];
    log(`drop: view ${views.join(",") || "-"}; fields ${fields.join(",") || "-"} (the flags go with them)`);
    if (APPLY) {
      if (views.length) await call("ir.ui.view", "unlink", { ids: views });
      if (fields.length) await call("ir.model.fields", "unlink", { ids: fields });
    }
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

console.log("steps: backup | balance [label] | fields [--apply] | mark [--apply] | verify | fixture | rollback [--apply] [--drop]");
process.exit(1);
