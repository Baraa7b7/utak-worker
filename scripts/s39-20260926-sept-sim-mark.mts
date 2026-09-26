// STATUS § 39 أ (2026-09-26): September's test records marked «محاكاة», never deleted.
//
// § 38 put x_utak_simulation («محاكاة (تجربة)», boolean, default false) on the
// order, the invoice and the payment, and marked nothing. Its dry run showed
// what that costs: Baraa's 21:30 summary (م17) counted «المعلَّق 63.00» from the
// accounting / VAT test invoices of 09-21 and 09-23, and the driver follow-up
// (م12) would count route 3's stale stop (09-11) had it been inside 72 hours.
// Here the same flag goes on the route and its stops too (same way:
// ir.model.fields over JSON-2), and every record of the five models that meets
// at least ONE of these is marked (Baraa's rules, § 39 أ):
//
//   c1  x_is_simulation = true;
//   c2  its partner is on the sim team (a number of SIM_ALLOWLIST) or a test
//       partner (its name has «اختبار» or «test»). The partner: the order's
//       customer; the invoice's and the payment's through their order; the
//       route's driver; the stop's through its order;
//   c3  dated before 2026-10-01 and part of route 3 (the route, its stops,
//       their orders, invoices and payments) or of the invoices behind the
//       «المعلَّق 63.00» of § 38's dry run (issued / overdue, dated up to
//       2026-09-26, with an open balance), and their payments.
//
// A record that meets none is NOT marked: it is listed (model, id, partner,
// amount, date) for Baraa to decide. The worker needs no change: م12 / م8 / م17
// already leave out an order, invoice or payment carrying the flag (§ 38); the
// route / stop flag is for Odoo's own lists.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s39-20260926-sept-sim-mark.mts <step> [--apply]
//
// Steps, in this order:
//   backup          read-only: every row of the five models (all fields), the counts, account.move / account.payment
//                   → backups/s39-sept-mark-<ts>.json (git-ignored)
//   before [label]  read-only: who is marked and why, who is not, and the dry run of م17's summary and م12's stops
//                   (the functions of src/, Odoo reads only) → scripts/artifacts/s39-20260926-sept-mark-<label>.json
//   fields          x_utak_simulation on x_delivery_route and x_delivery_stop (the other three exist since § 38)
//   mark            the records: x_utak_simulation = true (needs a backup and the fields)
//   verify          read-only checks, and the dry run again («after»)
//   fixture         read-only: fields_get → tests/fixtures-odoo-fields-20260926-s39.json (strict schema gate)
//   rollback        [--apply] the flags this script set back to false; --drop also removes the two fields it created
//
// fields / mark / rollback are dry runs without --apply. Rollback file: scripts/artifacts/s39-20260926-sept-mark-rollback.json.
// No WhatsApp, no deletion of any row, no account.move / account.payment. Tenant shared with prod: prod's code
// (5c138821) never reads the flag. The one automation on these models (#1, x_payment on_create) does not fire on write.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const step = process.argv[2] ?? "";
const APPLY = process.argv.includes("--apply");
const DROP = process.argv.includes("--drop");
const ROOT = new URL("../", import.meta.url);
const RB = new URL("./artifacts/s39-20260926-sept-mark-rollback.json", import.meta.url);
const BACKUPS = new URL("../backups/", import.meta.url);
const log = (...a: unknown[]) => console.log(...a);

// Only Odoo: never Meta, Claude or Cloudflare (no WhatsApp in this task).
const realFetch = globalThis.fetch;
let readOnly = false;
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  if (readOnly && !READS.has(m[2])) throw new Error(`BLOCKED (dry run): ${m[1]}.${m[2]} is not a read`);
  return realFetch(input, init);
}) as typeof fetch;

// ---------------------------------------------------------------- the rules
const SIM_FIELD = "x_utak_simulation";
const MODELS = ["x_daily_order", "x_invoice", "x_payment", "x_delivery_route", "x_delivery_stop"] as const;
type Model = (typeof MODELS)[number];
/** The models that get the field here (§ 38 created it on the other three: #20548, #20550, #20552). */
const NEW_FIELD_MODELS: Model[] = ["x_delivery_route", "x_delivery_stop"];
const FIELD = {
  name: SIM_FIELD, ttype: "boolean", field_description: "محاكاة (تجربة)",
  help: "سجل تجربة (STATUS § 39 أ): لا يدخل في متابعة السائق ولا ملخص اليوم ولا أي عدّ أو مجموع، ولا يُرسل عنه شيء. لا يُحذف.",
};
const CUTOFF = "2026-10-01";
const ROUTE_ID = 3;
/** The day of § 38's dry run («المعلَّق 63.00»): the pending up to this date, whatever the flag. */
const PENDING_DAY = "2026-09-26";
const PENDING_TOTAL = 63;
const TEST_NAME = /اختبار|test/i;
const FIXTURE_MODELS = [...MODELS, "x_wa_message", "x_whatsapp_template"];

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const m2o = (v: any): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** «2026-09-11 18:41:44» (UTC) → the Riyadh day. */
const riyadhDay = (utc: string | false) => (utc ? new Date(Date.parse(String(utc).replace(" ", "T") + "Z") + 3 * 3600_000).toISOString().slice(0, 10) : "");

function simAllowlist(): string[] {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const block = toml.split("[env.sim.vars]")[1].split(/\n\[/)[0];
  const m = /^SIM_ALLOWLIST\s*=\s*"([^"]*)"/m.exec(block);
  if (!m) throw new Error("no SIM_ALLOWLIST in [env.sim.vars] — stop");
  return m[1].split(",").map(digits).filter(Boolean);
}

const ctx = { active_test: false };
async function readAll() {
  const orders = await call("x_daily_order", "search_read", { domain: [], fields: ["id", "x_customer_id", "x_state", "x_order_date", "x_total_amount", "x_is_simulation", SIM_FIELD], order: "id asc", context: ctx }) as any[];
  const invoices = await call("x_invoice", "search_read", { domain: [], fields: ["id", "x_invoice_number", "x_order_id", "x_status", "x_invoice_date", "x_total", "x_is_simulation", SIM_FIELD], order: "id asc", context: ctx }) as any[];
  const payments = await call("x_payment", "search_read", { domain: [], fields: ["id", "x_invoice_id", "x_amount", "x_method", "x_collected_at", "x_collected_by", "x_is_simulation", SIM_FIELD], order: "id asc", context: ctx }) as any[];
  const hasRouteFlag = !!((await call("x_delivery_route", "fields_get", { attributes: ["type"] })) as any)[SIM_FIELD];
  const hasStopFlag = !!((await call("x_delivery_stop", "fields_get", { attributes: ["type"] })) as any)[SIM_FIELD];
  const routes = await call("x_delivery_route", "search_read", { domain: [], fields: ["id", "x_name", "x_date", "x_driver_id", "x_status", "x_dispatched_at", "x_is_simulation", ...(hasRouteFlag ? [SIM_FIELD] : [])], order: "id asc", context: ctx }) as any[];
  const stops = await call("x_delivery_stop", "search_read", { domain: [], fields: ["id", "x_route_id", "x_order_id", "x_status", "x_sequence", "x_is_simulation", ...(hasStopFlag ? [SIM_FIELD] : [])], order: "id asc", context: ctx }) as any[];
  const pids = [...new Set([...orders.map((o) => m2o(o.x_customer_id)), ...routes.map((r) => m2o(r.x_driver_id))].filter(Boolean))];
  const partners = await call("res.partner", "read", { ids: pids, fields: ["id", "name", "x_whatsapp_number"], context: ctx }) as any[];
  return { orders, invoices, payments, routes, stops, partners };
}

interface Row { model: Model; id: number; partner: string; amount: number | null; date: string; reasons: string[]; flagged: boolean }

/** Every record of the five models with the rules it meets (none → not marked, listed for Baraa). */
async function classify() {
  const allow = new Set(simAllowlist());
  const d = await readAll();
  const P = new Map(d.partners.map((p) => [p.id, p]));
  const partnerWhy = (pid: number): string | null => {
    const p = P.get(pid);
    if (!p) return null;
    if (allow.has(digits(p.x_whatsapp_number))) return `c2: فريق sim (${p.name})`;
    if (TEST_NAME.test(String(p.name))) return `c2: شريك اختبار (${p.name})`;
    return null;
  };
  const pname = (pid: number) => (P.get(pid)?.name ?? (pid ? `#${pid}` : "-"));
  const O = new Map(d.orders.map((o) => [o.id, o]));
  const I = new Map(d.invoices.map((i) => [i.id, i]));
  const R = new Map(d.routes.map((r) => [r.id, r]));
  // route 3: the route, its stops, their orders, the orders' invoices and payments
  const route = R.get(ROUTE_ID);
  const r3Stops = d.stops.filter((s) => m2o(s.x_route_id) === ROUTE_ID);
  if (!route || route.x_date !== "2026-09-11" || r3Stops.length !== 1 || m2o(r3Stops[0].x_order_id) !== 5) {
    throw new Error(`route ${ROUTE_ID} is not § 38's (09-11, one stop for order 5): ${JSON.stringify({ route, r3Stops })} — stop`);
  }
  const r3Orders = new Set(r3Stops.map((s) => m2o(s.x_order_id)));
  const r3Invoices = new Set(d.invoices.filter((i) => r3Orders.has(m2o(i.x_order_id))).map((i) => i.id));
  // «المعلَّق 63.00»: issued / overdue up to PENDING_DAY with an open balance, whatever the flag (so it reads the same after the marks)
  const paid = new Map<number, number>();
  for (const p of d.payments) paid.set(m2o(p.x_invoice_id), (paid.get(m2o(p.x_invoice_id)) ?? 0) + (Number(p.x_amount) || 0));
  const pendingInv = d.invoices.filter((i) => ["issued", "overdue"].includes(i.x_status) && i.x_invoice_date && i.x_invoice_date <= PENDING_DAY)
    .map((i) => ({ id: i.id, open: round2((Number(i.x_total) || 0) - (paid.get(i.id) ?? 0)) }))
    .filter((x) => x.open > 0);
  const pendingSum = round2(pendingInv.reduce((s, x) => s + x.open, 0));
  if (pendingSum !== PENDING_TOTAL) throw new Error(`the pending up to ${PENDING_DAY} is ${pendingSum}, not § 38's ${PENDING_TOTAL} — stop`);
  const p63 = new Set(pendingInv.map((x) => x.id));
  const rows: Row[] = [];
  const add = (model: Model, rec: any, partnerId: number, amount: number | null, date: string, extra: string[]) => {
    const reasons: string[] = [];
    if (rec.x_is_simulation === true) reasons.push("c1: x_is_simulation");
    const pw = partnerWhy(partnerId);
    if (pw) reasons.push(pw);
    if (date && date < CUTOFF) reasons.push(...extra);
    rows.push({ model, id: rec.id, partner: pname(partnerId), amount, date, reasons, flagged: rec[SIM_FIELD] === true });
  };
  for (const o of d.orders) {
    add("x_daily_order", o, m2o(o.x_customer_id), Number(o.x_total_amount) || 0, o.x_order_date || "",
      r3Orders.has(o.id) ? [`c3: المسار ${ROUTE_ID}`] : []);
  }
  for (const i of d.invoices) {
    const c3 = [...(r3Invoices.has(i.id) ? [`c3: فاتورة المسار ${ROUTE_ID}`] : []), ...(p63.has(i.id) ? ["c3: من المعلَّق 63.00"] : [])];
    add("x_invoice", i, m2o(O.get(m2o(i.x_order_id))?.x_customer_id), Number(i.x_total) || 0, i.x_invoice_date || "", c3);
  }
  for (const p of d.payments) {
    const inv = I.get(m2o(p.x_invoice_id));
    const c3 = [...(r3Invoices.has(m2o(p.x_invoice_id)) ? [`c3: دفعة المسار ${ROUTE_ID}`] : []), ...(p63.has(m2o(p.x_invoice_id)) ? ["c3: دفعة من المعلَّق 63.00"] : [])];
    add("x_payment", p, m2o(O.get(m2o(inv?.x_order_id))?.x_customer_id), Number(p.x_amount) || 0, riyadhDay(p.x_collected_at), c3);
  }
  for (const r of d.routes) {
    add("x_delivery_route", r, m2o(r.x_driver_id), null, r.x_date || "", r.id === ROUTE_ID ? [`c3: المسار ${ROUTE_ID}`] : []);
  }
  for (const s of d.stops) {
    const r = R.get(m2o(s.x_route_id));
    add("x_delivery_stop", s, m2o(O.get(m2o(s.x_order_id))?.x_customer_id), null, r?.x_date || "", m2o(s.x_route_id) === ROUTE_ID ? [`c3: محطة المسار ${ROUTE_ID}`] : []);
  }
  const targets = Object.fromEntries(MODELS.map((m) => [m, rows.filter((r) => r.model === m && r.reasons.length).map((r) => r.id)])) as Record<Model, number[]>;
  const unmarked = rows.filter((r) => !r.reasons.length);
  return { rows, targets, unmarked, pending: { day: PENDING_DAY, total: pendingSum, invoices: pendingInv }, route3: { stops: r3Stops.map((s) => s.id), orders: [...r3Orders], invoices: [...r3Invoices] }, allowlist: [...allow] };
}

function printClassification(c: Awaited<ReturnType<typeof classify>>) {
  for (const m of MODELS) {
    const rs = c.rows.filter((r) => r.model === m);
    log(`\n${m}: ${c.targets[m].length} of ${rs.length} meet a rule`);
    for (const r of rs) log(`  ${r.reasons.length ? "✎" : "·"} #${r.id} ${r.date} ${r.partner}${r.amount !== null ? ` ${r.amount.toFixed(2)}` : ""} — ${r.reasons.join(" · ") || "لا قاعدة: لا يُوسم (قرار براء)"}${r.flagged ? " [موسوم]" : ""}`);
  }
  log(`\npending up to ${c.pending.day}: ${c.pending.total.toFixed(2)} from invoices ${c.pending.invoices.map((x) => `#${x.id} (${x.open})`).join(", ")}`);
  log(`not marked (for Baraa): ${c.unmarked.length ? c.unmarked.map((r) => `${r.model} #${r.id}`).join(", ") : "none"}`);
}

// ---------------------------------------------------------------- the dry run of م17 / م12 (src/, Odoo reads only)
async function dryRun() {
  const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", ROOT), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const kv = new Map<string, string>();
  const env: any = {
    ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
    OWNER_WHATSAPP: "+966505154962", PILOT_MODE: "true", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
    MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
  };
  readOnly = true;
  try {
    const { fetchRoster, dayPlan } = await import("../src/team-roster.ts");
    const drv = await import("../src/driver-followup.ts");
    const sum = await import("../src/owner-summary.ts");
    const { riyadhDateKey, riyadhDayMinuteMs } = await import("../src/hours.ts");
    const now = Date.now();
    const today = riyadhDateKey(new Date(now));
    const roster = await fetchRoster(env, now);
    const m12 = [];
    for (const m of roster.members.filter((x: any) => x.codes.includes("driver"))) {
      const plan = dayPlan(roster, m, today);
      const ref = plan.kind === "work" ? riyadhDayMinuteMs(today, plan.endMin as number) : riyadhDayMinuteMs(today, drv.DRIVER_NO_SHIFT_CHECK_AT);
      const inWindow = await drv.openStopsForDriver(env, m.partnerId, ref - drv.ROUTE_LOOKBACK_H * 3600_000);
      const ever = await drv.openStopsForDriver(env, m.partnerId, 0);
      m12.push({ employee: m.employeeId, name: m.name, plan: plan.kind, stopsIn72h: inWindow.map((s: any) => `#${s.orderId}`), stopsAnyAge: ever.map((s: any) => `#${s.orderId} (route ${s.routeId})`) });
    }
    const figures = await sum.readSummaryFigures(env, now);
    return { at: new Date(now).toISOString(), today, m17: { figures, params: sum.summaryParams(figures) }, m12 };
  } finally {
    readOnly = false;
  }
}

const readRb = () => (existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s39-20260926-sept-sim-mark.mts", createdAt: new Date().toISOString() });
const saveRb = (rb: any) => { if (APPLY) writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n"); };
const fieldRow = async (model: string) => ((await call("ir.model.fields", "search_read", {
  domain: [["model", "=", model], ["name", "=", SIM_FIELD]], fields: ["id", "ttype", "store"], limit: 1,
})) as any[])[0] ?? null;
async function counts() {
  const out: Record<string, number> = {};
  for (const m of [...MODELS, "account.move", "account.payment"]) out[m] = await call(m, "search_count", { domain: [] }) as number;
  return out;
}

// ================================================================ backup
if (step === "backup") {
  const out: any = { what: "STATUS § 39 أ — the five models before September's test records are marked «محاكاة» (nothing deleted). Odoo utakfresh.odoo.com.", at: new Date().toISOString(), rows: {}, counts: await counts() };
  for (const m of MODELS) {
    const f = await call(m, "fields_get", { attributes: ["type"] }) as Record<string, { type: string }>;
    out.rows[m] = await call(m, "search_read", { domain: [], fields: Object.keys(f).filter((k) => f[k].type !== "binary"), order: "id asc", context: ctx });
  }
  mkdirSync(BACKUPS, { recursive: true });
  const ts = out.at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const file = new URL(`s39-sept-mark-${ts}.json`, BACKUPS);
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  log(`backup → ${file.pathname.replace(ROOT.pathname, "")}`);
  log(`  rows: ${MODELS.map((m) => `${m} ${out.rows[m].length}`).join(" · ")}`);
  log(`  counts: ${JSON.stringify(out.counts)}`);
  process.exit(0);
}

// ================================================================ before (read-only)
if (step === "before") {
  const label = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "before";
  const c = await classify();
  printClassification(c);
  const dr = await dryRun();
  log(`\nم17: ${dr.m17.params.join(" | ")}`);
  for (const x of dr.m12) log(`م12: ${x.name} (${x.plan}) — 72 ساعة: ${x.stopsIn72h.join("، ") || "لا محطة"} · أي عمر: ${x.stopsAnyAge.join("، ") || "لا محطة"}`);
  writeFileSync(new URL(`./artifacts/s39-20260926-sept-mark-${label}.json`, import.meta.url), JSON.stringify({ label, classification: c, dryRun: dr }, null, 2) + "\n");
  log(`→ scripts/artifacts/s39-20260926-sept-mark-${label}.json`);
  process.exit(0);
}

// ================================================================ fields
if (step === "fields") {
  const rb = readRb();
  rb.fields ??= {};
  for (const m of MODELS) {
    const have = await fieldRow(m);
    if (have) { log(`= ${m}.${SIM_FIELD} #${have.id} (${have.ttype})`); continue; }
    if (!NEW_FIELD_MODELS.includes(m)) throw new Error(`${m}.${SIM_FIELD} missing — § 38 created it (scripts/wa-b3-20260926-odoo.mjs); stop`);
    log(`+ ${m}.${SIM_FIELD} (boolean «${FIELD.field_description}», default false)`);
    if (!APPLY) continue;
    if (!rb.countsBefore) { rb.countsBefore = await counts(); saveRb(rb); }
    const [mid] = await call("ir.model", "search", { domain: [["model", "=", m]], limit: 1 }) as number[];
    if (!mid) throw new Error(`no ir.model ${m} — stop`);
    const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: mid, ...FIELD }] }) as number[];
    rb.fields[m] = id; saveRb(rb);
    log(`  created #${id}`);
  }
  log(APPLY ? "fields: applied" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ================================================================ mark
if (step === "mark") {
  const backups = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => f.startsWith("s39-sept-mark-")) : [];
  if (!backups.length) throw new Error("no backups/s39-sept-mark-*.json — run the backup step first");
  for (const m of MODELS) if (!(await fieldRow(m))) throw new Error(`${m}.${SIM_FIELD} missing — run the fields step first`);
  const c = await classify();
  const rb = readRb();
  rb.marked ??= {};
  rb.reasons ??= {};
  for (const m of MODELS) {
    const ids = c.targets[m];
    const todo = c.rows.filter((r) => r.model === m && r.reasons.length && !r.flagged).map((r) => r.id);
    log(`${todo.length ? "✎" : "="} ${m}: ${ids.join(",") || "-"} → ${SIM_FIELD} = true${todo.length ? ` (${todo.length} to write)` : ""}`);
    if (APPLY && todo.length) {
      // only what this script flips from false is its to roll back
      rb.marked[m] = [...new Set([...(rb.marked[m] ?? []), ...todo])];
      rb.reasons[m] = Object.fromEntries(c.rows.filter((r) => r.model === m && todo.includes(r.id)).map((r) => [r.id, r.reasons]));
      saveRb(rb);
      await call(m, "write", { ids: todo, vals: { [SIM_FIELD]: true } });
    }
  }
  log(`not marked (for Baraa): ${c.unmarked.length ? c.unmarked.map((r) => `${r.model} #${r.id} ${r.partner} ${r.amount ?? ""} ${r.date}`).join("; ") : "none"}`);
  log(APPLY ? "mark: applied" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ================================================================ verify
if (step === "verify") {
  let ok = 0, bad = 0;
  const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
  const rb = readRb();
  for (const m of MODELS) {
    const f = await fieldRow(m);
    check(`${m}.${SIM_FIELD} exists, boolean, stored`, f && f.ttype === "boolean" && f.store !== false, JSON.stringify(f));
  }
  const c = await classify();
  for (const m of MODELS) {
    const flagged = (await call(m, "search_read", { domain: [[SIM_FIELD, "=", true]], fields: ["id"], order: "id asc", context: ctx }) as any[]).map((r) => r.id);
    check(`${m}: marked = the records that meet a rule (${c.targets[m].length}), and nothing else`, JSON.stringify(flagged) === JSON.stringify(c.targets[m]), JSON.stringify({ flagged, targets: c.targets[m] }));
  }
  check("every record not marked is listed for Baraa", c.rows.filter((r) => !r.reasons.length).length === c.unmarked.length);
  const backup = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => f.startsWith("s39-sept-mark-")).sort().at(0) : undefined;
  const before = backup ? JSON.parse(readFileSync(new URL(backup, BACKUPS), "utf8")) : null;
  const now = await counts();
  check("no row deleted or added, no accounting touched (counts as in the backup)", !!before && JSON.stringify(now) === JSON.stringify(before.counts), JSON.stringify({ now, before: before?.counts }));
  if (before) {
    // nothing but the flag changed on any row
    let diffs = 0;
    for (const m of MODELS) {
      const cur = await call(m, "search_read", { domain: [], fields: Object.keys(before.rows[m][0] ?? {}).filter((k) => k !== SIM_FIELD && k !== "write_date" && k !== "write_uid" && k !== "__last_update" && k !== "display_name"), order: "id asc", context: ctx }) as any[];
      for (const r of cur) {
        const b = before.rows[m].find((x: any) => x.id === r.id);
        for (const k of Object.keys(r)) if (JSON.stringify(r[k]) !== JSON.stringify(b?.[k])) { diffs++; if (diffs <= 5) log(`    diff ${m} #${r.id} ${k}: ${JSON.stringify(b?.[k])} → ${JSON.stringify(r[k])}`); }
      }
    }
    check("no other field changed on any row (only the flag)", diffs === 0, `${diffs} diffs`);
  }
  const dr = await dryRun();
  check("م17 after: «المعلَّق» no longer counts September's test invoices (0.00)", dr.m17.figures.pending === 0, JSON.stringify(dr.m17.figures));
  check("م12 after: no stop without «تم التسليم» on any route, of any age", dr.m12.every((x: any) => x.stopsAnyAge.length === 0), JSON.stringify(dr.m12));
  writeFileSync(new URL("./artifacts/s39-20260926-sept-mark-after.json", import.meta.url), JSON.stringify({ label: "after", classification: c, dryRun: dr }, null, 2) + "\n");
  log(`\nم17: ${dr.m17.params.join(" | ")}`);
  for (const x of dr.m12) log(`م12: ${x.name} (${x.plan}) — 72 ساعة: ${x.stopsIn72h.join("، ") || "لا محطة"} · أي عمر: ${x.stopsAnyAge.join("، ") || "لا محطة"}`);
  log(`verify: ${ok}/${ok + bad}${rb.marked ? "" : " (not marked yet)"}`);
  process.exit(bad ? 1 : 0);
}

// ================================================================ fixture
if (step === "fixture") {
  const out: Record<string, any> = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only), after § 39 أ: every field of each model, ${SIM_FIELD} on the route and the stop included.`, _selections: {} };
  for (const m of FIXTURE_MODELS) {
    const f = await call(m, "fields_get", { attributes: ["type", "selection"] }) as Record<string, any>;
    out[m] = Object.keys(f).sort();
    for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s: any) => s[0]);
  }
  writeFileSync(new URL("../tests/fixtures-odoo-fields-20260926-s39.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
  log(FIXTURE_MODELS.map((m) => `${m}: ${out[m].length}${out[m].includes(SIM_FIELD) ? " (sim)" : ""}`).join(", "));
  process.exit(0);
}

// ================================================================ rollback
if (step === "rollback") {
  const rb = readRb();
  for (const [m, ids] of Object.entries(rb.marked ?? {}) as Array<[string, number[]]>) {
    log(`${m}: ${ids.join(",")} → ${SIM_FIELD} = false`);
    if (APPLY && ids.length) await call(m, "write", { ids, vals: { [SIM_FIELD]: false } });
  }
  if (DROP) {
    const ids = Object.values(rb.fields ?? {}) as number[];
    log(`drop: ir.model.fields ${ids.join(",") || "-"} (${Object.keys(rb.fields ?? {}).join(", ")}; the flags go with them)`);
    if (APPLY && ids.length) await call("ir.model.fields", "unlink", { ids });
  }
  if (APPLY) { rb.rolledBackAt = new Date().toISOString(); writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n"); }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

console.log("steps: backup | before [label] | fields [--apply] | mark [--apply] | verify | fixture | rollback [--apply] [--drop]");
process.exit(1);
