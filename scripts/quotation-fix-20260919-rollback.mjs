// 2026-09-19 — Rollback script for scripts/artifacts/quotation-fix-20260919-rollback.json
//
// Usage:
//   node scripts/quotation-fix-20260919-rollback.mjs             # dry-run (default, prints planned ops)
//   node scripts/quotation-fix-20260919-rollback.mjs --dry-run   # same
//
// Per the 2026-09-19 task constraint, THIS SCRIPT NEVER WRITES.
// To actually roll back, an operator reads the printed plan and executes
// each op by hand (via Odoo UI or a one-off REPL call). Left as dry-run
// because Odoo is a shared prod tenant and the rollback surface hasn't
// been reviewed for prod safety.

import { readFileSync } from "node:fs";

const artifact = JSON.parse(
  readFileSync(
    new URL(
      "./artifacts/quotation-fix-20260919-rollback.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function envFromFile() {
  const raw = readFileSync(
    "/Users/baraa7/utak-worker/.env.sim-verify",
    "utf8",
  );
  const out = {};
  for (const l of raw.split(/\r?\n/)) {
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i < 0) continue;
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}

const env = envFromFile();
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: missing Odoo creds in .env.sim-verify");
  process.exit(1);
}

let auth = { mode: "apikey", cookie: null };
async function ses() {
  const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY },
    }),
  });
  const m = (r.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const h = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") h["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else h["Cookie"] = auth.cookie;
  const r = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let p;
  try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(model, method, body); }
    throw new Error(`HTTP ${r.status} ${model}.${method}: ${p?.data?.message ?? String(t).slice(0, 300)}`);
  }
  return p;
}

console.log("---- QUOTATION-FIX ROLLBACK (DRY-RUN) ----");
console.log(`captured_at: ${artifact.captured_at}`);
console.log(`odoo: ${artifact.environment.odoo_url}`);
console.log(``);

// 1) Report bindings (record_id present → restore before value)
for (const op of artifact.planned_mutations) {
  if (op.model === "ir.actions.report") {
    console.log(`[plan] ir.actions.report[${op.record_id}].${op.field} : ${JSON.stringify(op.after)}  →  ${JSON.stringify(op.before)}`);
    const cur = await call("ir.actions.report", "read", {
      ids: [op.record_id],
      fields: [op.field],
    });
    console.log(`       observed now: ${JSON.stringify(cur[0]?.[op.field])}`);
  } else if (op.model === "res.company") {
    console.log(`[plan] res.company[${op.record_id}].${op.field} : ${JSON.stringify(op.after)}  →  ${JSON.stringify(op.before)}`);
    const cur = await call("res.company", "read", {
      ids: [op.record_id],
      fields: [op.field],
    });
    console.log(`       observed now: ${JSON.stringify(cur[0]?.[op.field])}`);
  } else if (op.model === "ir.actions.server") {
    const id = artifact.post_apply_ids?.server_action_id;
    if (!id) {
      console.log(`[plan] ir.actions.server: apply did not run yet — nothing to roll back`);
    } else {
      console.log(`[plan] ir.actions.server[${id}] unlink()`);
      const exists = await call("ir.actions.server", "search_count", { domain: [["id", "=", id]] });
      console.log(`       observed now: exists=${exists}`);
    }
  } else if (op.model === "ir.ui.view") {
    const id = artifact.post_apply_ids?.view_id;
    if (!id) {
      console.log(`[plan] ir.ui.view: apply did not run yet — nothing to roll back`);
    } else {
      console.log(`[plan] ir.ui.view[${id}] unlink()`);
      const exists = await call("ir.ui.view", "search_count", { domain: [["id", "=", id]] });
      console.log(`       observed now: exists=${exists}`);
    }
  }
}

console.log(``);
console.log(`Cloudflare rollback (not automated here):`);
console.log(`  wrangler secret delete SALE_PDF_DOWNLOAD_TOKEN --env sim   # if the Odoo button is being retired`);
console.log(``);
console.log(`This script is DRY-RUN by design. No writes were performed.`);
