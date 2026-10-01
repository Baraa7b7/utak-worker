// § 45 ج — dailyOperatingCost on the tenant, read only (every write and every non-Odoo call refused).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/archive/s45-20260930-cost-check.mts <label> [day …]
//
// Out: scripts/artifacts/s45-20260930-cost-<label>.json
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!url.startsWith(dotenv.ODOO_URL) || !m) throw new Error(`BLOCKED (read only): ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) throw new Error(`BLOCKED (read only): ${m[1]}.${m[2]}`);
  return realFetch(input, init);
}) as typeof fetch;
const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: dotenv.ODOO_URL, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN, ODOO_API_KEY: dotenv.ODOO_API_KEY,
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};
const OC = await import("../../src/operating-cost.ts");
const label = process.argv[2] ?? "check";
const days = process.argv.slice(3).length ? process.argv.slice(3) : ["2026-10-01", "2026-10-02"];
const out: Record<string, unknown> = {};
for (const d of days) {
  const c = await OC.dailyOperatingCost(env, d);
  out[d] = c;
  console.log(`${d}: total ${c.total} · working day ${c.workingDay} · month ${c.monthWorkingDays} · year ${c.yearWorkingDays}${c.reason ? ` · ${c.reason}` : ""}`);
  for (const i of c.items ?? []) console.log(`    ${JSON.stringify(i)}`);
}
writeFileSync(new URL(`scripts/artifacts/s45-20260930-cost-${label}.json`, root), JSON.stringify({ at: new Date().toISOString(), days: out }, null, 2) + "\n");
