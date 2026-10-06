// § 59 أ 3 (2026-10-06) — the proof of the cost guard: the operating cost of a day, as the worker's own
// code of THIS tree computes it from the tenant (src/operating-cost.ts dailyOperatingCost) — read
// before the roles move and after: 2026-10-06 = 641.23 both times.
//
// Read-only: any request that is not a read of utakfresh.odoo.com throws. No WhatsApp.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s59-20261006-cost.mts <label> [YYYY-MM-DD …]
//
// Out: scripts/artifacts/s59-20261006-cost.json (one entry a label: the total, the working days, where
// the working days came from, each line's share).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const OUT = new URL("scripts/artifacts/s59-20261006-cost.json", root);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const label = process.argv[2];
if (!label || label.startsWith("-")) { console.error("usage: … scripts/s59-20261006-cost.mts <label> [day …]"); process.exit(2); }
const days = process.argv.slice(3).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!days.length) days.push("2026-10-06");

const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
const pause = (ms = 500) => new Promise((r) => setTimeout(r, ms));
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED (not Odoo): ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) throw new Error(`BLOCKED (a write): ${m[1]}.${m[2]}`);
  await pause(); // the rate limit is shared with the live worker
  return realFetch(input, init);
}) as typeof fetch;

const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};

const { dailyOperatingCost } = await import("../src/operating-cost.ts");
const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { script: "scripts/s59-20261006-cost.mts", runs: {} };
const run: any = { at: new Date().toISOString(), days: {} };
for (const day of days) {
  const c: any = await dailyOperatingCost(env, day);
  run.days[day] = {
    total: c.total, workingDay: c.workingDay, monthWorkingDays: c.monthWorkingDays, yearWorkingDays: c.yearWorkingDays,
    workdaysFrom: c.driver, source: c.source ?? "driver", reason: c.reason ?? null,
    items: c.items.map((i: any) => ({ id: i.id, name: i.name, frequency: i.frequency, amount: i.amount, perDay: i.perDay === null ? null : Math.round(i.perDay * 10000) / 10000 })),
  };
  console.log(`${label} ${day}: total=${c.total === null ? `تعذّر (${c.reason})` : c.total.toFixed(2)} · working day ${c.workingDay} · month ${c.monthWorkingDays} · year ${c.yearWorkingDays} · working days from «${c.driver ?? "-"}» (${c.source ?? "driver"}) · ${c.items.length} lines`);
}
report.runs[label] = run;
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
