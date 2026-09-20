// Inbox 2026-09-20 — point the two remaining prod-facing server actions
// (id=941 "Issue & Send Quotation", id=957 "Send Receipt Webhook") at the
// sim worker instead.
//
// The plan explicitly overrides the earlier "don't touch 941/957" rule so
// the sim harness can exercise the full quotation + receipt PDF paths
// end-to-end before merge.
//
// The two URLs need the SIM INTERNAL_WEBHOOK_SECRET. We cannot read the
// existing sim secret from wrangler, so this script REQUIRES the caller
// to have already:
//   1) generated a fresh 64-hex token and put it in ~/utak-internal-sim-token.txt
//   2) `cat ~/utak-internal-sim-token.txt | wrangler secret put
//      INTERNAL_WEBHOOK_SECRET --env sim`
//   3) `wrangler deploy --env sim`
// so that when 941/957 fire the sim worker accepts the new token.
//
// This script then:
//   a) Snapshots the pre-existing 941/957 URLs to
//      scripts/artifacts/inbox-20260920-redirect-actions-rollback.json.
//   b) Rewrites both URLs: origin → sim, token → contents of the file.
//   c) Sanity-check: origin now matches the sim host (no token printed).
//
// Rollback: apply the snapshot's pre_urls back with a follow-up write.
// scripts/inbox-20260920-redirect-actions-rollback.mjs does that.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

const SIM_ORIGIN = "https://utak-worker-sim.utak-business.workers.dev";

const tokenPath = join(homedir(), "utak-internal-sim-token.txt");
if (!existsSync(tokenPath)) {
  console.error(`STOP: ${tokenPath} not found. See script header for setup steps.`);
  process.exit(1);
}
const NEW_TOKEN = readFileSync(tokenPath, "utf8").trim();
if (!/^[0-9a-f]{64}$/i.test(NEW_TOKEN)) {
  console.error("STOP: token file content is not 64-hex; refusing to write.");
  process.exit(1);
}

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

const rbPath = new URL("./artifacts/inbox-20260920-redirect-actions-rollback.json", import.meta.url).pathname;
function saveRollback(o) {
  mkdirSync(dirname(rbPath), { recursive: true });
  writeFileSync(rbPath, JSON.stringify(o, null, 2) + "\n");
}

function maskToken(url) {
  return url.replace(/(token=)([^&]+)/, "$1***");
}

function rewriteUrl(oldUrl) {
  const u = new URL(oldUrl);
  const path = u.pathname;
  return `${SIM_ORIGIN}${path}?token=${NEW_TOKEN}`;
}

async function main() {
  // Read current URLs
  const rows = await call("ir.actions.server", "read", {
    ids: [941, 957],
    fields: ["id", "name", "state", "webhook_url"],
  });
  const snap = {
    generated_at: new Date().toISOString(),
    pre_urls: {},
  };
  console.log("BEFORE:");
  for (const r of rows) {
    snap.pre_urls[r.id] = r.webhook_url;
    console.log(`  #${r.id} ${r.name} → ${maskToken(r.webhook_url)}`);
  }

  saveRollback(snap);
  console.log(`\nrollback JSON written to ${rbPath}`);

  // Rewrite one at a time so a failure on the second still saves the first.
  for (const r of rows) {
    const newUrl = rewriteUrl(r.webhook_url);
    await call("ir.actions.server", "write", {
      ids: [r.id],
      vals: { webhook_url: newUrl },
    });
    console.log(`  #${r.id} → ${maskToken(newUrl)}`);
  }

  // Verify
  const after = await call("ir.actions.server", "read", {
    ids: [941, 957], fields: ["id", "webhook_url"],
  });
  console.log("\nAFTER:");
  for (const a of after) {
    const originOK = String(a.webhook_url ?? "").startsWith(SIM_ORIGIN);
    console.log(`  #${a.id} origin_is_sim=${originOK} url=${maskToken(a.webhook_url)}`);
    if (!originOK) throw new Error(`#${a.id} did not switch to sim origin`);
  }

  console.log("\nDone. Verify: fire one via `/internal/quotation-issue?token=…` or wait for Baraa's next issue click.");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
