// Item 2a — rotate ODOO_HOOK_TOKEN across the 5 sim-facing ir.actions.server
// webhook URLs on utakfresh.odoo.com. Reads the new token from
// ~/utak-hook-token.txt (mode 600 file the caller must have written).
//
// The 2 prod-facing URLs (Send Receipt Webhook id=957, UTAK: Issue & Send
// Quotation id=941) are LEFT ALONE — those belong to the utak-worker prod
// deployment and rotate on the main branch, not sim.
//
// Run this AFTER `cat ~/utak-hook-token.txt | wrangler secret put
// ODOO_HOOK_TOKEN --env sim` + `wrangler deploy --env sim` so the sim
// worker already accepts the new token when the URLs flip.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: missing Odoo creds in .env.sim-verify");
  process.exit(1);
}

const tokenPath = join(homedir(), "utak-hook-token.txt");
let NEW_TOKEN = "";
try {
  NEW_TOKEN = readFileSync(tokenPath, "utf8").trim();
} catch (e) {
  console.error(`STOP: cannot read ${tokenPath}: ${e.message}`);
  process.exit(1);
}
if (!/^[0-9a-f]{64}$/i.test(NEW_TOKEN)) {
  console.error("STOP: token in file is not 64-hex; refusing to write");
  process.exit(1);
}

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY },
    }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error(`session auth failed status=${res.status}`);
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? String(text).slice(0,300)}`);
  }
  return parsed;
}

function swapToken(url) {
  const u = new URL(url);
  u.searchParams.set("token", NEW_TOKEN);
  return u.toString();
}

// Only the sim-facing rows. Prod rows are named for reference but excluded.
const SIM_ACTION_IDS = [968, 969, 970, 963, 967];
const PROD_ACTION_IDS = [957, 941];

const before = await call("ir.actions.server", "search_read", {
  domain: [["id", "in", [...SIM_ACTION_IDS, ...PROD_ACTION_IDS]]],
  fields: ["id", "name", "webhook_url"],
});
console.log("BEFORE:");
for (const r of before) {
  const isSim = SIM_ACTION_IDS.includes(r.id);
  const scheme = String(r.webhook_url).split("?")[0];
  console.log(`  id=${r.id} ${isSim ? "[SIM]" : "[PROD—skip]"} ${r.name} → ${scheme}`);
}

for (const id of SIM_ACTION_IDS) {
  const row = before.find((r) => r.id === id);
  if (!row) { console.warn(`skip id=${id} — not found`); continue; }
  const oldUrl = row.webhook_url;
  const newUrl = swapToken(oldUrl);
  await call("ir.actions.server", "write", { ids: [id], vals: { webhook_url: newUrl } });
  console.log(`updated id=${id}`);
}

const after = await call("ir.actions.server", "search_read", {
  domain: [["id", "in", SIM_ACTION_IDS]],
  fields: ["id", "name", "webhook_url"],
});
console.log("\nAFTER (sim URLs):");
for (const r of after) {
  const scheme = String(r.webhook_url).split("?")[0];
  const tok = new URL(r.webhook_url).searchParams.get("token") || "";
  const masked = tok ? `${tok.slice(0,6)}…${tok.slice(-4)}` : "(none)";
  console.log(`  id=${r.id} ${r.name} → ${scheme}?token=${masked}`);
}

const stillOldSim = after.filter((r) => new URL(r.webhook_url).searchParams.get("token") !== NEW_TOKEN);
if (stillOldSim.length) {
  console.error(`FAIL: ${stillOldSim.length} sim URL(s) did NOT rotate`);
  process.exit(2);
}
console.log("\nAll 5 sim URLs now carry the new token. Prod URLs untouched.");
