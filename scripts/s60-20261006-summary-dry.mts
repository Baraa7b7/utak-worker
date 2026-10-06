// § 60 (2026-10-06) — the 21:30 summary as the worker would read it NOW from live Odoo, read-only:
// its figures, the four lines of «خلاصة اليوم» and «طلبوا اليوم وما كان متوفر» — with the worker's own
// code (src/owner-summary.ts readSummaryFigures, `keep` off: the day's actual is computed, not stored,
// and the day's screen is not written). Before a deploy: a field or a domain Odoo refuses shows here,
// not at 21:30.
//
// What may leave this process is checked before it leaves: Odoo's READ methods alone, to
// utakfresh.odoo.com alone. Any write, any other host (WhatsApp included) throws. No KV.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s60-20261006-summary-dry.mts
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const READS = new Set(["search_read", "read", "search", "search_count", "fields_get", "read_group"]);
const realFetch = globalThis.fetch;
const pause = (ms = 450) => new Promise((r) => setTimeout(r, ms));
let reads = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED (not Odoo): ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) throw new Error(`BLOCKED (a write): ${m[1]}.${m[2]}`);
  await pause(); // the rate limit is shared with the live worker
  reads++;
  return realFetch(input, init);
}) as typeof fetch;

const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  OWNER_WHATSAPP: "+966505154962", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async () => null, put: async () => {}, delete: async () => {} },
};
const OS = await import("../src/owner-summary.ts");
const f = await OS.readSummaryFigures(env, Date.now(), { keep: false });
console.log(OS.summaryText(f));
console.log("----");
console.log(`${reads} read(s), 0 writes; errors: ${f.errors.length ? f.errors.join(" | ") : "none"}`);
process.exit(f.errors.length ? 1 : 0);
