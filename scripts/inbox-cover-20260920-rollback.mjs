// Rollback for inbox-cover-20260920-apply.mjs. Reads
// scripts/artifacts/inbox-cover-20260920-rollback.json and undoes only what
// that apply script wrote. Dry-run by default; pass --apply to persist.
//
// Actions:
//   - unlink each created ir.ui.view (list/form/search inherit)
//   - unlink each created ir.model.fields row (x_source)
//   - undo server-actions 941/957 origin change if recorded
// The backfill of existing rows is NOT reverted — every row simply loses its
// x_source when the field is removed, which restores the original state.

import { readFileSync, existsSync } from "node:fs";
const APPLY = process.argv.includes("--apply");
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

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

function say(...args) { console.log(APPLY ? "[apply]" : "[dry-run]", ...args); }

async function main() {
  const rbPath = new URL("./artifacts/inbox-cover-20260920-rollback.json", import.meta.url).pathname;
  if (!existsSync(rbPath)) {
    console.error("rollback file not found:", rbPath);
    process.exit(1);
  }
  const rb = JSON.parse(readFileSync(rbPath, "utf8"));

  // Views first
  for (const v of rb.created?.views ?? []) {
    say(`unlink view id=${v.id} (${v.name})`);
    if (APPLY) await call("ir.ui.view", "unlink", { ids: [v.id] });
  }

  // Fields
  for (const f of rb.created?.fields ?? []) {
    say(`unlink field id=${f.id} (${f.model}.${f.name})`);
    if (APPLY) await call("ir.model.fields", "unlink", { ids: [f.id] });
  }

  // Server-actions revert (if we mutated any)
  for (const key of Object.keys(rb.mutated ?? {})) {
    if (!key.startsWith("server_action_")) continue;
    const entry = rb.mutated[key];
    if (!entry?.before?.id) continue;
    say(`revert server action id=${entry.before.id} → ${entry.before.webhook_url_redacted}`);
    if (APPLY && entry.before.webhook_url) {
      await call("ir.actions.server", "write", {
        ids: [entry.before.id], vals: { webhook_url: entry.before.webhook_url },
      });
    }
  }

  say("done");
  if (!APPLY) console.log("Dry-run only. Re-run with --apply to persist.");
}
main().catch(e => { console.error("[fatal]", e.stack || e.message || e); process.exit(1); });
