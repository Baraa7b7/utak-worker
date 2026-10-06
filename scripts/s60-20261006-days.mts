// § 60 (2026-10-06) — the real days get what § 60 writes: on each line the carton's contribution
// (x_contribution, a measure of «📈 تاريخ الأسعار»), and on the day the chart with its break-even, its
// moves and its contributions, the day's plan (x_plan_*, x_target_cartons), «خلاصة اليوم» (x_brief_html),
// «🎯 الهدف مقابل الفعلي» (x_target_html) and the three tabs (text alone). The worker writes them with every run from § 60 on; a day it will
// not compute again (a day of before, or today's once it is published) would keep «يُبنى مع أول حساب
// لليوم» — so the worker's own function (src/day-screen.ts writeDayScreen, the code of this tree) makes
// them here from each day's lines AS THEY ARE STORED, the oldest day first.
//
// Nothing is computed again: no price, no status, no decision, no board number, no state. What may
// leave this process is checked before it leaves (a request outside this list throws):
//   reads; x_price_day_line.write of a real day's line with the screen's cells alone;
//   x_price_day.write of a real day with the screen's header, the plan, the target and the tabs alone.
//   Nothing but utakfresh.odoo.com is reachable: no WhatsApp. A dry run fakes every write.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s60-20261006-days.mts            dry-run
//   … --apply      the rollback file first, then the writes
//   … --verify     read-only: every real day's stored screen against what the worker makes of its lines now,
//                  the six HTML fields byte for byte (what Odoo's sanitizer stored is what was written),
//                  and each tab within its budget (1500 characters an item)
//   … --rollback [--apply]   the fields as they were before
//   … --only=55    one day's id (the others are read, not written)
//
// Out: scripts/artifacts/s60-20261006-days-rollback.json, and — for the last day — its six HTML fields as
// files (scripts/artifacts/s60-20261006-day-<field>.html) for scripts/s60-20261006-shots.mts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply"), VERIFY = process.argv.includes("--verify"), ROLLBACK = process.argv.includes("--rollback");
const ONLY = Number((process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7)) || 0;
const root = new URL("../", import.meta.url);
const RB = new URL("scripts/artifacts/s60-20261006-days-rollback.json", root);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const PR = await import("../src/prices.ts");
const DS = await import("../src/day-screen.ts");
const TABS = await import("../src/day-tabs.ts");
const DAY_FIELDS: string[] = [...PR.SCREEN_DAY_FIELDS, ...DS.INSIGHT_DAY_FIELDS];
const HTML_FIELDS = ["x_chart_html", "x_brief_html", "x_target_html", "x_tab_money_html", "x_tab_items_html", "x_tab_next_html"];
const LINE_OK = new Set<string>(PR.SCREEN_LINE_FIELDS), DAY_OK = new Set<string>(DAY_FIELDS);

// ---------------------------------------------------------------- the gate on every request
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
let dayIds = new Set<number>(), lineIds = new Set<number>();
const writes: string[] = [];
const realFetch = globalThis.fetch;
const pause = (ms = 450) => new Promise((r) => setTimeout(r, ms));
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED (not Odoo): ${url.slice(0, 60)}`);
  await pause(); // the rate limit is shared with the live worker
  if (!READS.has(m[2])) {
    const b = JSON.parse(init?.body ?? "{}");
    const keys = Object.keys(b.vals ?? {});
    const ok = m[2] === "write" && keys.length > 0 && Array.isArray(b.ids) && (
      (m[1] === "x_price_day_line" && b.ids.every((id: number) => lineIds.has(id)) && keys.every((k) => LINE_OK.has(k)))
      || (m[1] === "x_price_day" && b.ids.every((id: number) => dayIds.has(id)) && keys.every((k) => DAY_OK.has(k))));
    if (!ok) throw new Error(`BLOCKED: ${m[1]}.${m[2]} ${JSON.stringify(b.ids ?? "")} ${keys.join(",")}`);
    writes.push(`${m[1]}.write ${JSON.stringify(b.ids)} ${keys.join(",")}`);
    // a dry run (and --verify, --rollback without --apply) never writes: the answer Odoo would give is faked
    if (!APPLY || VERIFY) return new Response(JSON.stringify(true), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

// no KV between the days: every day reads its own inputs from Odoo
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  OWNER_WHATSAPP: "+966505154962", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async () => null, put: async () => {}, delete: async () => {} },
};
const { call } = await import("../src/odoo.ts");

const all = await call<any[]>(env, "x_price_day", "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: ["id", "x_date", "x_state", ...DAY_FIELDS], order: "x_date asc, id asc", limit: 400 });
const days = ONLY ? all.filter((d) => d.id === ONLY) : all;
dayIds = new Set(days.map((d) => d.id));
const lines = await call<any[]>(env, "x_price_day_line", "search_read", { domain: [["x_day_id", "in", [...dayIds]]], fields: ["id", "x_day_id", ...PR.SCREEN_LINE_FIELDS], order: "x_day_id asc, x_sequence asc, id asc", limit: 5000 });
lineIds = new Set(lines.map((l) => l.id));
console.log(`${days.length} real day(s) (${days[0]?.x_date} → ${days[days.length - 1]?.x_date}), ${lines.length} line(s)`);

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  if (!existsSync(RB)) throw new Error("no rollback file: nothing was applied by this script");
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  for (const d of rb.before.days) { console.log(`day #${d.id}: its header, its plan, its target and its tabs as they were`); const { id, ...vals } = d; await call(env, "x_price_day", "write", { ids: [id], vals }); }
  for (const l of rb.before.lines) { const { id, ...vals } = l; await call(env, "x_price_day_line", "write", { ids: [id], vals }); }
  console.log(`${rb.before.lines.length} line(s): their cells as they were`);
  console.log(APPLY ? `rollback done (${writes.length} writes)` : `dry-run: nothing written (${writes.length} writes planned; add --apply)`);
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  let ok = 0, bad = 0;
  const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; console.log(`  ✓ ${name}`); } else { bad++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
  for (const d of days) {
    const r = await DS.writeDayScreen(env, d.id, { dry: true, force: true });
    check(`#${d.id} ${d.x_date} («${d.x_state}», ${r.lines} lines): every line's cells are the ones the worker makes of it now`, r.updated === 0, `${r.updated} line(s) differ`);
    check(`…its plan: هامش ${d.x_plan_margin} · تالف ${d.x_plan_waste} · مساهمة ${d.x_plan_contribution} (${d.x_plan_basis || "—"}) · هدف الربح ${d.x_profit_target} · الهدف ${d.x_target_cartons} كرتون`,
      ["x_plan_margin", "x_plan_waste", "x_plan_contribution", "x_profit_target", "x_target_cartons"].every((k) => Math.abs((Number(d[k]) || 0) - Number((r.header as any)[k])) < 0.0001) && (d.x_plan_basis || "") === (r.header as any).x_plan_basis, JSON.stringify(DS.INSIGHT_DAY_FIELDS.slice(0, 6).map((k: string) => [d[k], (r.header as any)[k]])));
    for (const f of HTML_FIELDS) {
      const stored = String(d[f] || ""), made = String((r.header as any)[f] ?? "");
      const at = [...made].findIndex((c, i) => c !== stored[i]);
      check(`…${f} is stored byte for byte as written (${stored.length} characters): Odoo's sanitizer changed nothing`, stored === made && stored.length > 0, at < 0 ? `stored ${stored.length} / made ${made.length}` : `first difference at ${at}: stored «${stored.slice(Math.max(0, at - 30), at + 50)}» / made «${made.slice(Math.max(0, at - 30), at + 50)}»`);
    }
    const budget = TABS.TAB_ITEM_BUDGET * Math.max(1, r.rows.length);
    check(`…each tab within its budget (${TABS.TAB_ITEM_BUDGET} × ${Math.max(1, r.rows.length)} = ${budget}): ${HTML_FIELDS.slice(3).map((f) => String(d[f] || "").length).join(" / ")}`, HTML_FIELDS.slice(3).every((f) => String(d[f] || "").length <= budget));
  }
  console.log(`verify: ${ok}/${ok + bad}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- apply (dry by default)
console.log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
if (APPLY) {
  // the rollback file before the first write: the fields as they are now — a day or a line already in it keeps what it held first
  const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/s60-20261006-days.mts", createdAt: new Date().toISOString(), before: { days: [], lines: [] } };
  const haveDays = new Set(rb.before.days.map((d: any) => d.id)), haveLines = new Set(rb.before.lines.map((l: any) => l.id));
  rb.before.days.push(...days.filter((d) => !haveDays.has(d.id)).map((d) => Object.fromEntries(["id", ...DAY_FIELDS].map((k) => [k, d[k]]))));
  rb.before.lines.push(...lines.filter((l) => !haveLines.has(l.id)).map((l) => Object.fromEntries(["id", ...PR.SCREEN_LINE_FIELDS].map((k) => [k, l[k]]))));
  writeFileSync(RB, JSON.stringify(rb, null, 1) + "\n");
}
let planned = 0;
for (const d of days) {
  const r = await DS.writeDayScreen(env, d.id, { dry: !APPLY, force: true });
  const h = r.header as any;
  planned += r.updated + 1;
  console.log(`✎ #${d.id} ${d.x_date} «${d.x_state}»: ${r.updated}/${r.lines} line(s) · مساهمة ${r.values.map((v: any) => v.x_contribution).join(" / ")} · الخطة: هامش ${h.x_plan_margin} تالف ${h.x_plan_waste} مساهمة ${h.x_plan_contribution} (${h.x_plan_basis}) → الهدف ${h.x_target_cartons} · HTML: chart ${String(h.x_chart_html).length} brief ${String(h.x_brief_html).length} target ${String(h.x_target_html).length} money ${String(h.x_tab_money_html).length} items ${String(h.x_tab_items_html).length} next ${String(h.x_tab_next_html).length}`);
  if (d === days[days.length - 1]) for (const f of HTML_FIELDS) writeFileSync(new URL(`scripts/artifacts/s60-20261006-day-${f}.html`, root), `${h[f]}\n`);
}
console.log(APPLY ? `done: ${writes.length} writes — verify: … scripts/s60-20261006-days.mts --verify` : `dry-run: nothing written (${planned} writes planned: the lines that differ, and each day)`);
