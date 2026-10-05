// § 56 (2026-10-05) — the real days computed before § 56 get their screen: the table's cells on each
// line, the four numbers and the chart on the day. The worker writes them with every run from § 56 on;
// a day it will not compute again (a day of before, or today's after the engine's hours) would show
// empty columns on «📊 اليوم» — so the worker's own function (src/day-screen.ts writeDayScreen, the code
// of this tree) makes them here from each day's lines AS THEY ARE STORED.
//
// Nothing is computed again: no price, no status, no decision, no board number, no state. What may
// leave this process is checked before it leaves (a request outside this list throws):
//   reads; x_price_day_line.write of a real day's line with the screen's six cells alone;
//   x_price_day.write of a real day with the four numbers and the chart alone.
//   Nothing but utakfresh.odoo.com is reachable: no WhatsApp. A dry run fakes every write.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s56-20261005-days.mts            dry-run
//   … --apply      the rollback file first, then the writes
//   … --verify     read-only: every real day's stored screen against what the worker makes of its lines now,
//                  the chart byte for byte (what Odoo's sanitizer stored is what was written)
//   … --rollback [--apply]   the fields as they were before (empty)
//
// Out: scripts/artifacts/s56-20261005-days-rollback.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply"), VERIFY = process.argv.includes("--verify"), ROLLBACK = process.argv.includes("--rollback");
const root = new URL("../", import.meta.url);
const RB = new URL("scripts/artifacts/s56-20261005-days-rollback.json", root);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const PR = await import("../src/prices.ts");
const LINE_OK = new Set<string>(PR.SCREEN_LINE_FIELDS), DAY_OK = new Set<string>(PR.SCREEN_DAY_FIELDS);

// ---------------------------------------------------------------- the gate on every request
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
let dayIds = new Set<number>(), lineIds = new Set<number>();
const writes: string[] = [];
const realFetch = globalThis.fetch;
const pause = (ms = 500) => new Promise((r) => setTimeout(r, ms));
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

const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  OWNER_WHATSAPP: "+966505154962", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};
const { call } = await import("../src/odoo.ts");
const DS = await import("../src/day-screen.ts");

const days = await call<any[]>(env, "x_price_day", "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: ["id", "x_date", "x_state", ...PR.SCREEN_DAY_FIELDS], order: "x_date asc, id asc", limit: 400 });
dayIds = new Set(days.map((d) => d.id));
const lines = await call<any[]>(env, "x_price_day_line", "search_read", { domain: [["x_day_id", "in", [...dayIds]]], fields: ["id", "x_day_id", ...PR.SCREEN_LINE_FIELDS], order: "x_day_id asc, x_sequence asc, id asc", limit: 5000 });
lineIds = new Set(lines.map((l) => l.id));
console.log(`${days.length} real day(s) (${days[0]?.x_date} → ${days[days.length - 1]?.x_date}), ${lines.length} line(s)`);

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  if (!existsSync(RB)) throw new Error("no rollback file: nothing was applied by this script");
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  for (const d of rb.before.days) { console.log(`day #${d.id}: the four numbers and the chart as they were`); const { id, ...vals } = d; await call(env, "x_price_day", "write", { ids: [id], vals }); }
  for (const l of rb.before.lines) { const { id, ...vals } = l; await call(env, "x_price_day_line", "write", { ids: [id], vals }); }
  console.log(`${rb.before.lines.length} line(s): their six cells as they were`);
  console.log(APPLY ? `rollback done (${writes.length} writes)` : `dry-run: nothing written (${writes.length} writes planned; add --apply)`);
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  let ok = 0, bad = 0;
  const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; console.log(`  ✓ ${name}`); } else { bad++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
  for (const d of days) {
    const r = await DS.writeDayScreen(env, d.id, { dry: true });
    const stored = String(d.x_chart_html || ""), made = String(r.header.x_chart_html);
    const at = [...made].findIndex((c, i) => c !== stored[i]);
    check(`#${d.id} ${d.x_date} («${d.x_state}», ${r.lines} lines): every line's cells are the ones the worker makes of it now`, r.updated === 0, `${r.updated} line(s) differ`);
    check(`…its numbers: للنشر ${d.x_n_publish} · لا تنشر ${d.x_n_skip} · ⚠️ ${d.x_n_warn} · متوسط ربح الكرتون ${d.x_avg_profit_show}`, ["x_n_publish", "x_n_skip", "x_n_warn", "x_avg_profit_show"].every((k) => d[k] === r.header[k]) && Math.abs(d.x_avg_profit - Number(r.header.x_avg_profit)) < 0.0001, JSON.stringify(Object.fromEntries(Object.entries(r.header).filter(([k]) => k !== "x_chart_html"))));
    check(`…its chart is stored byte for byte as written (${stored.length} characters): Odoo's sanitizer changed nothing`, stored === made, at < 0 ? `stored ${stored.length} / made ${made.length}` : `first difference at ${at}: stored «${stored.slice(Math.max(0, at - 30), at + 50)}» / made «${made.slice(Math.max(0, at - 30), at + 50)}»`);
  }
  console.log(`verify: ${ok}/${ok + bad}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- apply (dry by default)
console.log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
if (APPLY && !existsSync(RB)) {
  // the rollback file before the first write: the fields as they are now
  writeFileSync(RB, JSON.stringify({ script: "scripts/s56-20261005-days.mts", createdAt: new Date().toISOString(), before: {
    days: days.map((d) => Object.fromEntries(["id", ...PR.SCREEN_DAY_FIELDS].map((k) => [k, d[k]]))),
    lines: lines.map((l) => Object.fromEntries(["id", ...PR.SCREEN_LINE_FIELDS].map((k) => [k, l[k]]))),
  } }, null, 1) + "\n");
}
let planned = 0;
for (const d of days) {
  const r = await DS.writeDayScreen(env, d.id, { dry: !APPLY });
  const h = r.header;
  planned += r.updated + 1;
  console.log(`${r.updated || d.x_chart_html !== h.x_chart_html ? "✎" : "="} #${d.id} ${d.x_date} «${d.x_state}»: ${r.updated}/${r.lines} line(s) · للنشر ${h.x_n_publish} · لا تنشر ${h.x_n_skip} · ⚠️ ${h.x_n_warn} · متوسط ربح الكرتون ${String(h.x_avg_profit_show).replace("\u200e", "")} · chart ${String(h.x_chart_html).length} characters`);
  for (const [i, v] of r.values.entries()) console.log(`      ${r.rows.find((x: any) => x.lineId === lines.filter((l) => (Array.isArray(l.x_day_id) ? l.x_day_id[0] : l.x_day_id) === d.id)[i]?.id)?.name ?? "—"}: شامل ${v.x_cost_vat_show} · ربحنا بسعر السوق ${v.x_market_profit_show} · المقترح ${v.x_suggested_profit_show} · الفرق ${v.x_gap_show} · ${v.x_outcome_show}`.replace(/\u200e/g, ""));
}
console.log(APPLY ? `done: ${writes.length} writes — verify: … scripts/s56-20261005-days.mts --verify` : `dry-run: nothing written (${planned} writes planned: the lines that differ, and each day)`);
