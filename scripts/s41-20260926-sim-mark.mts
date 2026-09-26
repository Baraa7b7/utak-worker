// § 41 و (2026-09-26) — the full-day simulation's records marked «محاكاة»,
// never deleted (the § 39 pattern: backup ← mark ← verify), and automation #1
// switched off for the run.
//
// Which records: EXACTLY the ones the run created — scripts/s41-full-day-sim.mts
// logs every Odoo create it makes (created.json of the run); the deployed
// worker's own activity during the run is not in that log. For each:
//   • x_utak_simulation = true where the model has it (every model the run
//     writes, since s41-20260926-odoo.mjs --part=iso);
//   • res.partner (the run's fake customers): also archived (active = false)
//     and x_wa_allowed = false — out of every customer list and broadcast;
//   • the numbers a real record could repeat: x_invoice.x_invoice_number,
//     x_quotation.x_quotation_number and x_payment.x_name (the receipt) get the
//     prefix «SIM41-» (the day's serial leaves simulation invoices out, so a
//     real 10-01 invoice would otherwise be UTAK-INV-20261001-001 again).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s41-20260926-sim-mark.mts <step> [<run>] [--apply]
//
//   automation off|on [--apply]   base.automation #1 (x_payment → the deployed worker's receipt) for the run
//   backup <run>                  read-only: every created record (all fields but binaries), account.move /
//                                 account.payment counts → backups/s41-sim-<run>-<ts>.json (git-ignored)
//   mark <run> [--apply]          the flags, the archive, the prefixes (dry run without --apply)
//   verify <run>                  read-only: every created record flagged; the 21:30 summaries of the simulated
//                                 days, the receivables (م2 and the 18:00 list) and Ahmed's supplier balance
//                                 back to the run's before.json; account.move / account.payment unchanged
//   rollback <run> [--apply]      the values this script changed, back (nothing deleted)
//
// Rollback file: scripts/artifacts/s41-20260926-sim-mark-rollback.json. No WhatsApp, no deletion.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const step = process.argv[2] ?? "";
const arg3 = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "";
const APPLY = process.argv.includes("--apply");
const RB = new URL("./artifacts/s41-20260926-sim-mark-rollback.json", import.meta.url);
const BACKUPS = new URL("../backups/", import.meta.url);
const log = (...a: unknown[]) => console.log(...a);
const SIM = "x_utak_simulation";
const PREFIX = "SIM41-";
const AUTOMATION_RECEIPT = 1;
const NUMBER_FIELD: Record<string, string> = { x_invoice: "x_invoice_number", x_quotation: "x_quotation_number", x_payment: "x_name" };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/json/2/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  if (/\/(unlink|button_cancel|action_post)$/.test(url)) throw new Error(`BLOCKED: ${url.split("/").slice(-2).join(".")}`);
  return realFetch(input, init);
}) as typeof fetch;

const readRb = () => (existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s41-20260926-sim-mark.mts", createdAt: new Date().toISOString(), runs: {} });
const saveRb = (rb: any) => { if (APPLY) writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n"); };
function runDir(run: string): URL {
  if (!run) throw new Error("the run id (scripts/artifacts/s41-sim/<run>/) is required");
  return new URL(`./artifacts/s41-sim/${run}/`, import.meta.url);
}
function createdOf(run: string): Map<string, number[]> {
  const c = JSON.parse(readFileSync(new URL("created.json", runDir(run)), "utf8"));
  if (c.mode !== "live") throw new Error(`run ${run} is ${c.mode}: nothing on the tenant to mark`);
  const by = new Map<string, number[]>();
  for (const e of c.created as Array<{ model: string; ids: number[] }>) by.set(e.model, [...new Set([...(by.get(e.model) ?? []), ...e.ids.filter((n) => Number.isFinite(n) && n > 0)])]);
  return by;
}
async function hasField(model: string, field: string): Promise<boolean> {
  return (await call("ir.model.fields", "search_count", { domain: [["model", "=", model], ["name", "=", field]] })) > 0;
}
async function acctCounts() {
  return {
    moves: await call("account.move", "search_count", { domain: [] }),
    payments: await call("account.payment", "search_count", { domain: [] }),
  };
}

// ---------------------------------------------------------------- automation #1
if (step === "automation") {
  const want = arg3 === "on";
  if (!["on", "off"].includes(arg3)) throw new Error("automation on|off");
  const [a] = await call("base.automation", "read", { ids: [AUTOMATION_RECEIPT], fields: ["id", "name", "active"], context: { active_test: false } });
  log(`automation #${AUTOMATION_RECEIPT} «${a?.name}»: active ${a?.active} → ${want}`);
  if (a?.active === want) { log("= nothing to do"); process.exit(0); }
  if (!APPLY) { log("dry-run: nothing written (add --apply)"); process.exit(0); }
  const rb = readRb();
  rb.automation ??= { before: a?.active, changes: [] };
  rb.automation.changes.push({ at: new Date().toISOString(), to: want });
  saveRb(rb);
  await call("base.automation", "write", { ids: [AUTOMATION_RECEIPT], vals: { active: want } });
  const [b] = await call("base.automation", "read", { ids: [AUTOMATION_RECEIPT], fields: ["active"], context: { active_test: false } });
  log(`✓ automation #${AUTOMATION_RECEIPT} active = ${b?.active}`);
  process.exit(b?.active === want ? 0 : 1);
}

// ---------------------------------------------------------------- backup
if (step === "backup") {
  const by = createdOf(arg3);
  const out: Record<string, unknown> = { run: arg3, at: new Date().toISOString(), acct: await acctCounts(), records: {} };
  for (const [model, ids] of by) {
    const f = await call(model, "fields_get", { attributes: ["type", "store"] }).catch(() => ({}));
    const fields = Object.keys(f).filter((k) => (f as any)[k].store !== false && !["binary", "html"].includes((f as any)[k].type) && !/^(message_|activity_|__)/.test(k));
    (out.records as any)[model] = ids.length ? await call(model, "read", { ids, fields, context: { active_test: false } }).catch((e: Error) => `unreadable: ${e.message.slice(0, 120)}`) : [];
    log(`  ${model}: ${ids.length}`);
  }
  mkdirSync(BACKUPS, { recursive: true });
  const path = new URL(`s41-sim-${arg3}-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z.json`, BACKUPS);
  writeFileSync(path, JSON.stringify(out) + "\n");
  log(`backup → ${path.pathname}`);
  process.exit(0);
}

// ---------------------------------------------------------------- mark
if (step === "mark") {
  const by = createdOf(arg3);
  const rb = readRb();
  const r = (rb.runs[arg3] ??= { flags: {}, partners: {}, numbers: {} });
  let n = 0;
  for (const [model, ids] of by) {
    if (!ids.length) continue;
    if (!(await hasField(model, SIM))) { log(`  - ${model}: ${ids.length} (no ${SIM} — left as they are)`); continue; }
    const rows = await call<any[]>(model, "read", { ids, fields: ["id", SIM, ...(NUMBER_FIELD[model] ? [NUMBER_FIELD[model]] : []), ...(model === "res.partner" ? ["active", "x_wa_allowed"] : [])], context: { active_test: false } });
    const todo = rows.filter((x) => x[SIM] !== true);
    log(`  ${model}: ${rows.length} created, ${todo.length} to flag`);
    if (APPLY && todo.length) {
      r.flags[model] = [...new Set([...(r.flags[model] ?? []), ...todo.map((x) => x.id)])]; saveRb(rb);
      await call(model, "write", { ids: todo.map((x) => x.id), vals: { [SIM]: true } });
      n += todo.length;
    }
    if (model === "res.partner") {
      for (const p of rows.filter((x) => x.active !== false || x.x_wa_allowed !== false)) {
        log(`    partner #${p.id}: archive, x_wa_allowed false`);
        if (!APPLY) continue;
        r.partners[p.id] ??= { active: p.active, x_wa_allowed: p.x_wa_allowed }; saveRb(rb);
        await call("res.partner", "write", { ids: [p.id], vals: { active: false, x_wa_allowed: false } });
      }
    }
    const nf = NUMBER_FIELD[model];
    if (nf) {
      for (const x of rows.filter((y) => typeof y[nf] === "string" && y[nf] && !String(y[nf]).startsWith(PREFIX))) {
        log(`    ${model} #${x.id}: ${x[nf]} → ${PREFIX}${x[nf]}`);
        if (!APPLY) continue;
        r.numbers[`${model}:${x.id}`] ??= x[nf]; saveRb(rb);
        await call(model, "write", { ids: [x.id], vals: { [nf]: `${PREFIX}${x[nf]}` } });
      }
    }
  }
  log(APPLY ? `marked ${n}` : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (step === "verify") {
  const by = createdOf(arg3);
  let ok = 0, bad = 0;
  const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name}${detail ? " — " + detail.slice(0, 400) : ""}`); } };
  for (const [model, ids] of by) {
    if (!ids.length || !(await hasField(model, SIM))) continue;
    const rows = await call<any[]>(model, "read", { ids, fields: ["id", SIM], context: { active_test: false } });
    check(`${model}: ${rows.length}/${ids.length} flagged`, rows.length === ids.length && rows.every((x) => x[SIM] === true), JSON.stringify(rows.filter((x) => x[SIM] !== true).map((x) => x.id)));
  }
  const partners = by.get("res.partner") ?? [];
  if (partners.length) {
    const ps = await call<any[]>("res.partner", "read", { ids: partners, fields: ["id", "active", "x_wa_allowed", "x_whatsapp_number"], context: { active_test: false } });
    check(`the run's partners (${ps.length}) archived, x_wa_allowed off, all fake numbers`, ps.every((p) => p.active === false && p.x_wa_allowed === false && String(p.x_whatsapp_number).startsWith("+96650000410")), JSON.stringify(ps));
  }
  for (const [model, nf] of Object.entries(NUMBER_FIELD)) {
    const ids = by.get(model) ?? [];
    if (!ids.length) continue;
    const rows = await call<any[]>(model, "read", { ids, fields: ["id", nf] });
    check(`${model}: every number prefixed ${PREFIX}`, rows.every((x) => !x[nf] || String(x[nf]).startsWith(PREFIX)), JSON.stringify(rows.slice(0, 5)));
  }
  const before = JSON.parse(readFileSync(new URL("before.json", runDir(arg3)), "utf8"));
  const after = await baselineNow();
  for (const k of Object.keys(before)) {
    check(`back as before: ${k}`, JSON.stringify(before[k]) === JSON.stringify(after[k]), `before ${JSON.stringify(before[k])} · after ${JSON.stringify(after[k])}`);
  }
  const bk = JSON.parse(readFileSync(new URL("before.json", runDir(arg3)), "utf8"));
  void bk;
  const acct = await acctCounts();
  const backups = existsSync(BACKUPS) ? (await import("node:fs")).readdirSync(BACKUPS).filter((f) => f.startsWith(`s41-sim-${arg3}-`)).sort() : [];
  if (backups.length) {
    const b = JSON.parse(readFileSync(new URL(backups[backups.length - 1], BACKUPS), "utf8"));
    check(`account.move / account.payment unchanged (${acct.moves} / ${acct.payments})`, b.acct.moves === acct.moves && b.acct.payments === acct.payments, `${JSON.stringify(b.acct)} → ${JSON.stringify(acct)}`);
  }
  const [a1] = await call("base.automation", "read", { ids: [AUTOMATION_RECEIPT], fields: ["active"], context: { active_test: false } });
  check("automation #1 back on", a1?.active === true);
  log(`verify: ${ok}/${ok + bad}`);
  writeFileSync(new URL("verify.json", runDir(arg3)), JSON.stringify({ at: new Date().toISOString(), ok, total: ok + bad, after }, null, 1));
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- rollback
if (step === "rollback") {
  const rb = readRb();
  const r = rb.runs?.[arg3];
  if (!r) { log(`nothing recorded for ${arg3}`); process.exit(0); }
  for (const [model, ids] of Object.entries(r.flags as Record<string, number[]>)) {
    log(`  ${model}: ${ids.length} flags back to false`);
    if (APPLY && ids.length) await call(model, "write", { ids, vals: { [SIM]: false } });
  }
  for (const [id, v] of Object.entries(r.partners as Record<string, any>)) {
    log(`  partner #${id}: active ${v.active}, x_wa_allowed ${v.x_wa_allowed}`);
    if (APPLY) await call("res.partner", "write", { ids: [Number(id)], vals: v });
  }
  for (const [key, v] of Object.entries(r.numbers as Record<string, string>)) {
    const [model, id] = key.split(":");
    log(`  ${model} #${id}: back to ${v}`);
    if (APPLY) await call(model, "write", { ids: [Number(id)], vals: { [NUMBER_FIELD[model]]: v } });
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

log("steps: automation on|off · backup <run> · mark <run> · verify <run> · rollback <run> [--apply]");
process.exit(2);

// ---------------------------------------------------------------- the figures the run must leave as they were (src/, reads only)
async function baselineNow(): Promise<Record<string, unknown>> {
  const dotenv = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const kv = new Map<string, string>();
  const env: any = {
    ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
    OWNER_WHATSAPP: "+966505154962", PILOT_MODE: "true", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
    MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
  };
  const RealDate = Date;
  let fixed = 0;
  class D extends RealDate { constructor(...a: unknown[]) { if (a.length === 0) super(fixed); else super(...(a as [any])); } static now() { return fixed; } }
  (globalThis as any).Date = D;
  const SUM = await import("../src/owner-summary.ts");
  const OUTR = await import("../src/outreach.ts");
  const { getUnpaidInvoicesWithCustomer } = await import("../src/odoo.ts");
  const out: Record<string, unknown> = {};
  for (const d of ["2026-09-27", "2026-09-28", "2026-10-01"]) {
    fixed = RealDate.parse(`${d}T21:30:00+03:00`);
    const f = await SUM.readSummaryFigures(env);
    out[`summary_${d}`] = { tomorrow: f.tomorrow, deliveries: f.deliveries, collected: f.collected, pending: f.pending, coverage: f.coverage };
  }
  fixed = RealDate.parse("2026-10-04T08:00:00+03:00");
  out.owed = [...(await OUTR.owedByCustomer(env)).entries()];
  out.unpaid = (await getUnpaidInvoicesWithCustomer(env)).map((i) => [i.id, i.total]);
  const [a] = await call("res.partner", "read", { ids: [30], fields: ["x_sp_due_total", "x_sp_paid_total", "x_sp_remaining"] });
  out.ahmed = a;
  (globalThis as any).Date = RealDate;
  return out;
}
