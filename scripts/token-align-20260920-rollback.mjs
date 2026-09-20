// 2026-09-20 — Restore ir.actions.server (941, 957, 968) webhook_url from the
// full-URL rollback file ~/utak-token-align-rollback.json (mode 600, kept
// outside the repo so tokens never enter git).
//
// Dry-run by default: prints the planned writes with tokens masked.
// Pass --apply to actually write.
//
// Never prints a full token.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = res.headers.get("set-cookie")?.match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const url = `${ODOO_URL}/json/2/${model}/${method}`;
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  if (auth.mode === "session") headers["Cookie"] = auth.cookie;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

function mask(s)  { return typeof s === "string" && s ? `****${s.slice(-4)}` : "****"; }
function maskUrl(u) {
  if (typeof u !== "string") return u;
  return u.replace(/(token=)([^&#]+)/g, (_, k, v) => `${k}${mask(v)}`);
}

async function main() {
  console.log(`Rollback — ${APPLY ? "APPLY" : "DRY-RUN"} — ${new Date().toISOString()}`);

  const path = join(homedir(), "utak-token-align-rollback.json");
  if (!existsSync(path)) {
    throw new Error(`rollback file missing: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.odoo_url !== ODOO_URL || raw.odoo_db !== ODOO_DB) {
    throw new Error(`rollback file was written against ${raw.odoo_url} db=${raw.odoo_db} — env mismatch, aborting`);
  }

  console.log(`Rollback source: ${path} (generated ${raw.generated_at})`);
  console.log();

  // Show current state alongside planned restore.
  const ids = raw.entries.map((e) => e.id);
  const current = await call("ir.actions.server", "read", {
    ids, fields: ["id", "name", "webhook_url"],
  });
  const byId = new Map(current.map((r) => [r.id, r]));

  console.log("Plan:");
  for (const e of raw.entries) {
    const now = byId.get(e.id);
    console.log(`  ${e.id} · ${e.name}`);
    console.log(`     now: ${maskUrl(now?.webhook_url || "")}`);
    console.log(`     to : ${maskUrl(e.before_url)}`);
  }
  console.log();

  if (!APPLY) {
    console.log("DRY-RUN: pass --apply to write.");
    return;
  }

  for (const e of raw.entries) {
    await call("ir.actions.server", "write", {
      ids: [e.id],
      vals: { webhook_url: e.before_url },
    });
    console.log(`[write] ${e.id} → ${maskUrl(e.before_url)}`);
  }
  console.log("\nRollback complete. Re-run scripts/token-align-20260920-inventory.mjs to confirm.");
}
main().catch((e) => { console.error("ROLLBACK FAILED:", e); process.exit(1); });
