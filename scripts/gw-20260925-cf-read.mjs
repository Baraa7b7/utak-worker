// Read-only Cloudflare API snapshot (STATUS § 33): prod and sim schedules, and
// the sim worker's plain-text vars. GET only; the wrangler OAuth token is read
// from its config and never printed.
//
//   node scripts/gw-20260925-cf-read.mjs <label>
//
// Out: scripts/artifacts/gw-20260925-cf-<label>.json
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const label = process.argv[2] || "snapshot";
const cfg = readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8");
const token = (/oauth_token\s*=\s*"([^"]+)"/.exec(cfg) || [])[1];
if (!token) throw new Error("no wrangler oauth_token — run `npx wrangler whoami` first");
const api = async (path) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!j.success) throw new Error(`${path}: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return j.result;
};
const accounts = await api("/accounts");
const account = accounts[0].id;
const sched = async (name) => ((await api(`/accounts/${account}/workers/scripts/${name}/schedules`)).schedules ?? []).map((s) => s.cron).sort();
const settings = await api(`/accounts/${account}/workers/scripts/utak-worker-sim/settings`);
const WANT = ["ACCOUNTING_SYNC", "SIM_ALLOWLIST", "PILOT_MODE", "SIMULATION_MODE", "OWNER_WINDOW_OPEN_AT"];
const simVars = Object.fromEntries((settings.bindings ?? []).filter((b) => b.type === "plain_text" && WANT.includes(b.name)).map((b) => [b.name, b.text]));
const out = { label, at: new Date().toISOString(), prodSchedules: await sched("utak-worker"), simSchedules: await sched("utak-worker-sim"), simVars };
writeFileSync(new URL(`./artifacts/gw-20260925-cf-${label}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
