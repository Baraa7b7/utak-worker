// Official-doc rollback (dry-run by default).
// Reads scripts/artifacts/official-docs-created.json and deletes every id
// in REVERSE creation order. Never runs unless invoked with --apply.
//
// Order matters:
//   1. menus (children first, then parent) — no FK to worry about, but
//      the parent needs its children gone.
//   2. window actions — no incoming refs.
//   3. views (form/list/search/block-list).
//   4. server actions (preview, issue, ai-draft).
//   5. ir.access rows (ir.access model, deletion via ir.model.access_ids write).
//   6. seed templates (x_official_doc rows + their blocks cascade).
//   7. x_official_doc + x_official_doc_block records not covered by seeds
//      (defensive — spec asks for user records to be manually deleted).
//   8. ir.model.fields.selection options (children first).
//   9. ir.model.fields (children first: x_block_ids many2one target then rest).
//  10. ir.model rows (x_official_doc_block then x_official_doc).
//
// Reads the JSON, groups by model, deletes in the reverse order the script
// wrote them. This script is safe to inspect — it prints every id it would
// touch before doing anything.

import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
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

const rbPath = new URL("./artifacts/official-docs-created.json", import.meta.url).pathname;
const rb = JSON.parse(readFileSync(rbPath, "utf8"));
const ops = rb.operations || [];

// The order below is INTENTIONAL — dependency-safe.
const DELETE_ORDER = [
  "ir.ui.menu",
  "ir.actions.act_window",
  "ir.ui.view",
  "ir.actions.server",
  "ir.access",
  "x_official_doc_block",
  "x_official_doc",
  "ir.model.fields.selection",
  "ir.model.fields",
  "ir.model",
];

function opsByModel(model) {
  return ops.filter((o) => o.model === model && o.action === "create").reverse();
}

async function unlinkOne(model, id, name) {
  if (!APPLY) {
    console.log(`  [dry-run] would unlink ${model}#${id} — ${name ?? ""}`);
    return;
  }
  try {
    await call(model, "unlink", { ids: [id] });
    console.log(`  unlinked ${model}#${id}`);
  } catch (e) {
    console.log(`  FAILED to unlink ${model}#${id}: ${(e).message.slice(0, 200)}`);
  }
}

async function main() {
  console.log(`Rollback plan for ${rbPath}`);
  console.log(`operations logged: ${ops.length}`);
  for (const model of DELETE_ORDER) {
    const rows = opsByModel(model);
    if (rows.length === 0) continue;
    console.log(`\n${model} (${rows.length} row${rows.length === 1 ? "" : "s"}):`);
    for (const row of rows) {
      // Bail out here on the two "many2one" fields that must be deleted
      // BEFORE their targets — irrelevant for our set today, but noted for
      // future changes.
      await unlinkOne(model, row.id, row.name);
    }
  }
  if (!APPLY) {
    console.log("\nDry-run only. Rerun with --apply to actually delete.");
    console.log("REMINDER: never run this without an explicit Baraa request.");
  }
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
