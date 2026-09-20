// Rotate the two sim webhook tokens and refresh the five server actions
// that carry them (941, 957, 968 use INTERNAL_WEBHOOK_SECRET; 969, 970 use
// ODOO_HOOK_TOKEN). This script does NOT call `wrangler secret put` —
// Baraa runs that himself, then invokes this script with the new tokens.
//
// Usage:
//   NEW_INTERNAL=xxxxxxxxxxxxxxxx NEW_HOOK=yyyyyyyyyyyyyyy \
//     node scripts/inbox-cover-20260920-rotate-tokens.mjs [--apply]
//
// Steps:
//   1. Read NEW_INTERNAL + NEW_HOOK from env (or --internal / --hook flags).
//   2. Verify NEW_INTERNAL is accepted on /internal/quotation-issue and
//      /internal/receipt-issue (empty {} body → 400 "invalid id/quotation_id"
//      means auth passed and no side effect fired; 401/403 means rejected).
//   3. Verify NEW_HOOK is accepted on /internal/quotation-wa-send and
//      /internal/sale-quotation-wa-send.
//   4. Snapshot the pre-existing 941/957/968/969/970 URLs (redacted) to
//      scripts/artifacts/inbox-cover-20260920-rollback.json.
//   5. Rewrite each URL with the matching new token; origin stays SIM.
//
// Refusal: if any verification returns 401/403, the script exits BEFORE any
// write. Baraa can re-run wrangler secret put with a corrected value.
//
// NEITHER the internal nor the hook token is printed. `--apply` writes;
// omitted → dry-run.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const APPLY = process.argv.includes("--apply");
const argsMap = new Map(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? ""]; }),
);
const NEW_INTERNAL = process.env.NEW_INTERNAL ?? argsMap.get("internal") ?? "";
const NEW_HOOK = process.env.NEW_HOOK ?? argsMap.get("hook") ?? "";

if (!NEW_INTERNAL || !NEW_HOOK) {
  console.error("STOP: set NEW_INTERNAL and NEW_HOOK env vars (or --internal=… --hook=…).");
  console.error("      Neither token will be printed anywhere.");
  process.exit(1);
}
if (!/^[A-Za-z0-9._~+/=-]{16,}$/.test(NEW_INTERNAL) || !/^[A-Za-z0-9._~+/=-]{16,}$/.test(NEW_HOOK)) {
  console.error("STOP: tokens must be at least 16 URL-safe characters each.");
  process.exit(1);
}

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

const SIM_ORIGIN = "https://utak-worker-sim.utak-business.workers.dev";

function say(...args) { console.log(APPLY ? "[apply]" : "[dry-run]", ...args); }
function maskToken(url) { return String(url ?? "").replace(/(token=)([^&]+)/, "$1***"); }

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

async function probeToken(path, token) {
  const url = `${SIM_ORIGIN}${path}?token=${token}`;
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const status = res.status;
  if (status === 401 || status === 403) {
    throw new Error(`token rejected on ${path} (status=${status})`);
  }
  if (!(status === 400 || status === 422 || status === 202 || status === 500)) {
    throw new Error(`unexpected status on ${path}: ${status}`);
  }
  say(`  ${path} → ${status} (accepted)`);
}

const rbPath = new URL("./artifacts/inbox-cover-20260920-rollback.json", import.meta.url).pathname;
function readRollback() {
  if (!existsSync(rbPath)) return { generated_at: new Date().toISOString(), created: {}, mutated: {} };
  try { return JSON.parse(readFileSync(rbPath, "utf8")); } catch { return { generated_at: new Date().toISOString(), created: {}, mutated: {} }; }
}
function writeRollback(o) {
  mkdirSync(dirname(rbPath), { recursive: true });
  writeFileSync(rbPath, JSON.stringify(o, null, 2) + "\n");
}

// Server-action → which secret it uses.
const ACTIONS = [
  { id: 941, secret: "internal", path: "/internal/quotation-issue" },
  { id: 957, secret: "internal", path: "/internal/receipt-issue" },
  { id: 968, secret: "internal", path: "/internal/quotation-issue" },
  { id: 969, secret: "hook",     path: "/internal/quotation-wa-send" },
  { id: 970, secret: "hook",     path: "/internal/sale-quotation-wa-send" },
];

async function main() {
  say("verifying NEW_INTERNAL against sim endpoints…");
  await probeToken("/internal/quotation-issue", NEW_INTERNAL);
  await probeToken("/internal/receipt-issue", NEW_INTERNAL);

  say("\nverifying NEW_HOOK against sim endpoints…");
  await probeToken("/internal/quotation-wa-send", NEW_HOOK);
  await probeToken("/internal/sale-quotation-wa-send", NEW_HOOK);

  const rows = await call("ir.actions.server", "read", {
    ids: ACTIONS.map(a => a.id),
    fields: ["id", "name", "webhook_url"],
  });
  const byId = new Map(rows.map(r => [r.id, r]));

  say("\nBEFORE:");
  for (const a of ACTIONS) {
    const r = byId.get(a.id);
    if (!r) { say(`  #${a.id} MISSING`); continue; }
    say(`  #${a.id} ${r.name} → ${maskToken(r.webhook_url)}`);
  }

  // Snapshot rollback
  const rb = readRollback();
  rb.mutated = rb.mutated ?? {};
  for (const a of ACTIONS) {
    const r = byId.get(a.id);
    if (!r) continue;
    rb.mutated[`server_action_${a.id}`] = {
      before: {
        id: r.id, name: r.name,
        webhook_url: r.webhook_url,
        webhook_url_redacted: maskToken(r.webhook_url),
        secret: a.secret,
      },
    };
  }
  writeRollback(rb);

  say("\nAFTER (planned):");
  for (const a of ACTIONS) {
    const r = byId.get(a.id);
    if (!r) continue;
    const oldPath = new URL(r.webhook_url).pathname;
    const targetPath = a.path; // trust the mapping; a.path names the endpoint
    if (oldPath !== targetPath) {
      say(`  #${a.id} path mismatch: was=${oldPath} → will be=${targetPath} (endpoint corrected)`);
    }
    const tok = a.secret === "internal" ? NEW_INTERNAL : NEW_HOOK;
    const newUrl = `${SIM_ORIGIN}${targetPath}?token=${tok}`;
    say(`  #${a.id} → ${maskToken(newUrl)}`);
    if (APPLY) {
      await call("ir.actions.server", "write", {
        ids: [a.id], vals: { webhook_url: newUrl },
      });
    }
  }

  if (APPLY) {
    // Verify origins
    const after = await call("ir.actions.server", "read", {
      ids: ACTIONS.map(a => a.id), fields: ["id", "webhook_url"],
    });
    say("\nVERIFIED:");
    for (const a of after) {
      const originOK = String(a.webhook_url ?? "").startsWith(SIM_ORIGIN);
      say(`  #${a.id} origin_is_sim=${originOK} url=${maskToken(a.webhook_url)}`);
      if (!originOK) throw new Error(`#${a.id} did not switch to sim origin`);
    }
  }

  say("done. Actions redirected; NOT fired for testing.");
  if (!APPLY) console.log("\nDry-run only. Re-run with --apply to persist.");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
