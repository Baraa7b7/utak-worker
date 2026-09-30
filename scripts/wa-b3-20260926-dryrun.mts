// الدفعة 3 (STATUS § 38) — what the new jobs see on the tenant today, with
// nothing sent and nothing written (2026-09-26).
//
//   • Odoo: reads only. Any other method is refused (throws) — none is expected.
//   • Meta, Claude, Cloudflare: refused. No KV: the functions called here read
//     Odoo only (no claim, no send).
//   • م12: each driver on the roster, his day plan and his stops without
//     «تم التسليم» (the same query the 5-minute tick uses).
//   • م8: each open route, the stop «في الطريق» would go to next (read only).
//   • م17: the three figures of tonight's 21:30 summary, and its text.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-b3-20260926-dryrun.mts
//
// Out: scripts/artifacts/wa-b3-20260926-dryrun.json
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED (dry run): ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) throw new Error(`BLOCKED (dry run): ${m[1]}.${m[2]} is not a read`);
  return realFetch(input, init);
}) as typeof fetch;

const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  OWNER_WHATSAPP: "+966505154962", PILOT_MODE: "true", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};

const { fetchRoster, dayPlan } = await import("../src/team-roster.ts");
const drv = await import("../src/driver-followup.ts");
const sum = await import("../src/owner-summary.ts");
const { riyadhDateKey, riyadhDayMinuteMs, riyadhHHMM } = await import("../src/hours.ts");
const { call } = await import("../src/odoo.ts");

const now = Date.now();
const today = riyadhDateKey(new Date(now));
const roster = await fetchRoster(env, now);
const drivers = roster.members.filter((m) => m.codes.includes("driver"));
const m12 = [];
for (const m of drivers) {
  const plan = dayPlan(roster, m, today);
  const endMs = plan.kind === "work" ? riyadhDayMinuteMs(today, plan.endMin as number) : riyadhDayMinuteMs(today, drv.DRIVER_NO_SHIFT_CHECK_AT);
  const stops = await drv.openStopsForDriver(env, m.partnerId, endMs - drv.ROUTE_LOOKBACK_H * 3600_000);
  m12.push({
    employee: m.employeeId, partner: m.partnerId, name: m.name, plan: plan.kind,
    shift: plan.kind === "work" ? `${plan.startMin! / 60}:00–${plan.endMin! / 60}:00` : null,
    reminderAt: plan.kind === "work" ? riyadhHHMM(new Date(endMs - drv.REMIND_BEFORE_END_MIN * 60_000)) : null,
    alertAt: plan.kind === "work" ? riyadhHHMM(new Date(endMs + drv.ALERT_AFTER_END_MIN * 60_000)) : riyadhHHMM(new Date(endMs)),
    stopsWithoutDelivered: stops,
    wouldSend: stops.length ? (plan.kind === "work" ? "reminder to the driver, then Baraa's alert" : "Baraa's reason alert at 18:00") : "nothing (no stop left)",
  });
}
// م8: open routes and their next stop (read only)
const routes = await call<Array<{ id: number; x_date: string; x_driver_id: [number, string] | false; x_status: string }>>(env, "x_delivery_route", "search_read", {
  domain: [["x_status", "in", ["dispatched", "in_progress"]]], fields: ["id", "x_date", "x_driver_id", "x_status"], limit: 50,
});
const m8 = [];
for (const r of routes) {
  const stops = await call<Array<{ id: number; x_order_id: [number, string] | false; x_sequence: number; x_status: string }>>(env, "x_delivery_stop", "search_read", {
    domain: [["x_route_id", "=", r.id]], fields: ["id", "x_order_id", "x_sequence", "x_status"], limit: 100,
  });
  m8.push({ route: r.id, date: r.x_date, status: r.x_status, driver: r.x_driver_id ? r.x_driver_id[1] : null, stops: stops.map((s) => ({ order: s.x_order_id ? s.x_order_id[0] : null, seq: s.x_sequence, status: s.x_status })) });
}
const figures = await sum.readSummaryFigures(env, now);
const out = {
  at: new Date(now).toISOString(), today,
  m12, m8,
  m17: { figures, params: sum.summaryParams(figures), text: sum.summaryText(figures) },
};
writeFileSync(new URL("./artifacts/wa-b3-20260926-dryrun.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
