// § 46 أ (2026-10-01) — the board of one price day, from the tenant: what «📊 لوحة التسعير» shows
// (or would show) for it, computed by the worker's own code (src/prices.ts rewriteBoard) from the
// day's stored lines.
//
//   • default: read-only. Odoo: reads only (any other method throws). Nothing sent, KV in memory.
//   • --apply: writes the board's fields of that day — and ONLY those: a write to any other model,
//     or carrying any other field, throws before it leaves. The rollback file (the previous values
//     of every line and of the header) is written first. The day's prices, its state and Baraa's
//     decisions are never in a write.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s46-20261001-board-day.mts [--day=YYYY-MM-DD] [--apply]
//
// Out: scripts/artifacts/s46-20261001-board-day-<day>.json (and …-rollback.json with --apply)
import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const BOARD_LINE = new Set(["x_net_purchase", "x_waste_cost", "x_op_share", "x_full_cost", "x_board_sale", "x_net_sale", "x_real_profit", "x_board_status"]);
const BOARD_DAY = /^x_(op_cost|op_expected|op_cartons|op_basis|op_share|op_share_500|n_green|n_yellow|n_red|n_none|board_note|board_at)$/;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) {
    const keys = Object.keys(JSON.parse(init?.body ?? "{}").vals ?? { "?": 1 });
    const ok = APPLY && m[2] === "write" && ((m[1] === "x_price_day_line" && keys.every((k) => BOARD_LINE.has(k))) || (m[1] === "x_price_day" && keys.every((k) => BOARD_DAY.test(k))));
    if (!ok) throw new Error(`BLOCKED: ${m[1]}.${m[2]} ${keys.join(",")}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  OWNER_WHATSAPP: "+966505154962", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};
const PR = await import("../src/prices.ts");
const { call } = await import("../src/odoo.ts");
const { riyadhDateKey } = await import("../src/hours.ts");
const { dailyOperatingCost, readPricingSettings } = await import("../src/operating-cost.ts");
const { deliveredCartons } = await import("../src/pricing-board.ts");

const day = (process.argv.find((a) => a.startsWith("--day=")) ?? `--day=${riyadhDateKey()}`).slice(6);
const [rec] = await call<Array<{ id: number; x_date: string; x_state: string; x_name: string }>>(env, "x_price_day", "search_read", {
  domain: [["x_date", "=", day], ["x_utak_simulation", "!=", true]], fields: ["id", "x_date", "x_state", "x_name"], order: "id asc", limit: 1,
});
if (!rec) { console.log(`لا سجل «أسعار اليوم» لـ ${day}.`); process.exit(1); }
const money = (n: unknown) => (Number(n) || 0).toFixed(2);
const ICON: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴", none: "⚪" };
const cost = await dailyOperatingCost(env, day);
const settings = await readPricingSettings(env, day);
const actual = await deliveredCartons(env, day);
const dry = await PR.rewriteBoard(env, rec.id, { dry: true, force: true });
const h = dry.header as Record<string, any>;
console.log(`📊 لوحة التسعير — ${day} (السجل #${rec.id}، ${rec.x_state})`);
console.log(`تكلفة اليوم: ${money(h.x_op_cost)} (${cost.items.map((i) => `${i.name} ${i.perDay === null ? "تعذّر" : money(i.perDay)}`).join(" + ") || "لا بنود"})`);
console.log(`الكراتين المتوقعة: ${settings?.expectedCartons ?? "فارغ"} · أيام فيها تسليمات حقيقية قبل ${day}: ${actual.days}${actual.average !== null ? `، ومتوسط آخر 7: ${actual.average}` : ""}`);
console.log(`حصة الكرتون: ${money(h.x_op_share)} (الأساس: ${h.x_op_basis === "actual" ? `متوسط المسلَّم فعلاً ${h.x_op_cartons}` : `الكراتين المتوقعة ${h.x_op_cartons}`}) · لو كانت الكراتين 500: ${money(h.x_op_share_500)}`);
console.log(`الأصناف: 🟢 ${h.x_n_green} · 🟡 ${h.x_n_yellow} · 🔴 ${h.x_n_red} · ⚪ ${h.x_n_none}${h.x_board_note ? ` · ${h.x_board_note}` : ""}`);
for (const v of dry.values as Array<Record<string, any>>) {
  console.log(`${ICON[v.x_board_status]} ${v.name}: الشراء ${money(v.purchase)} ← الصافي ${money(v.x_net_purchase)} · التالف ${money(v.x_waste_cost)} · الحصة ${money(v.x_op_share)} · التكلفة الكاملة ${money(v.x_full_cost)} · البيع ${money(v.x_board_sale)} ← الصافي ${money(v.x_net_sale)} · الربح الحقيقي ${money(v.x_real_profit)}`);
}
const out = { at: new Date().toISOString(), day, dayId: rec.id, state: rec.x_state, cost, expectedCartons: settings?.expectedCartons ?? null, actual, header: h, lines: dry.values, applied: false as boolean };
if (APPLY) {
  const fields = [...BOARD_LINE];
  const before = {
    day: (await call<any[]>(env, "x_price_day", "read", { ids: [rec.id], fields: ["x_op_cost", "x_op_expected", "x_op_cartons", "x_op_basis", "x_op_share", "x_op_share_500", "x_n_green", "x_n_yellow", "x_n_red", "x_n_none", "x_board_note", "x_board_at"] }))[0],
    lines: await call<any[]>(env, "x_price_day_line", "search_read", { domain: [["x_day_id", "=", rec.id]], fields: ["id", ...fields], order: "id asc" }),
  };
  writeFileSync(new URL(`scripts/artifacts/s46-20261001-board-day-${day}-rollback.json`, root), JSON.stringify({ at: new Date().toISOString(), day, dayId: rec.id, before }, null, 2) + "\n");
  const w = await PR.rewriteBoard(env, rec.id, { force: true });
  out.applied = true;
  console.log(`\nكُتبت اللوحة: ${w.updated} سطراً من ${w.lines} ورأس اليوم (حقول اللوحة وحدها).`);
} else console.log("\nقراءة فقط: لم يُكتب شيء (--apply يكتب حقول اللوحة لهذا اليوم وحدها).");
writeFileSync(new URL(`scripts/artifacts/s46-20261001-board-day-${day}.json`, root), JSON.stringify(out, null, 2) + "\n");
