// Drop the interim res.company.x_company_registry field + its view.
//
// Why: Saudi localization stores the commercial-registration number on
// res.partner as an additional identification scheme (CRN). That is now
// the single source of truth read by readCompanyInfo(). The interim
// x_company_registry (created 2026-09-22 06:14) is no longer needed and
// is being retired so no one edits it by mistake.
//
// Safety:
//   1. Read the current value of x_company_registry FIRST. If populated,
//      bail out — the operator (Baraa) should migrate it to the l10n_sa
//      slot on the company's partner before we remove the field.
//   2. Remove the view (#2807) BEFORE the field (#20230), so the view's
//      arch parse never fails.
//   3. Update scripts/artifacts/official-docs-created.json + this same
//      rollback script's audit trail — the delete steps become no-ops on
//      later runs of the rollback (they cannot re-create the field).
//
// Idempotent: rerunning after a successful delete prints "already absent"
// and exits 0.

import { readFileSync, writeFileSync } from "node:fs";

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

const FIELD_ID = 20230;
const VIEW_ID = 2807;

async function main() {
  // 1) Confirm the field exists and read its value.
  const fields = await call("ir.model.fields", "search_read", {
    domain: [["id", "=", FIELD_ID]],
    fields: ["id", "model", "name"],
  });
  if (fields.length === 0) {
    console.log(`[skip] field #${FIELD_ID} already absent`);
  } else {
    const f = fields[0];
    if (f.model !== "res.company" || f.name !== "x_company_registry") {
      throw new Error(`field #${FIELD_ID} identity mismatch: ${f.model}.${f.name}`);
    }
    // Read the current stored value across ALL rows (single-company tenant,
    // still safe to scan any row that has it set).
    const rows = await call("res.company", "search_read", {
      domain: [],
      fields: ["id", "name", "x_company_registry"],
    });
    const populated = rows.filter((r) => {
      const v = r.x_company_registry;
      return v && v !== false && (typeof v !== "string" || v.trim().length > 0);
    });
    console.log(`x_company_registry: ${rows.length} row(s) inspected, ${populated.length} populated`);
    if (populated.length > 0) {
      console.log("!!! ABORT: x_company_registry has a value — migrate it first");
      for (const r of populated) console.log(`   company#${r.id} ${r.name} — <populated>`);
      process.exit(2);
    }
  }

  // 2) Verify the view still exists (for clean logs).
  const views = await call("ir.ui.view", "search_read", {
    domain: [["id", "=", VIEW_ID]],
    fields: ["id", "name", "model"],
  });
  if (views.length === 0) {
    console.log(`[skip] view #${VIEW_ID} already absent`);
  } else {
    console.log(`view #${VIEW_ID} present: ${views[0].name}`);
  }

  if (!APPLY) {
    console.log("\nDry-run only. Rerun with --apply to actually delete.");
    return;
  }

  // 3) Delete view first, then field.
  if (views.length > 0) {
    await call("ir.ui.view", "unlink", { ids: [VIEW_ID] });
    console.log(`unlinked view #${VIEW_ID}`);
  }
  if (fields.length > 0) {
    await call("ir.model.fields", "unlink", { ids: [FIELD_ID] });
    console.log(`unlinked field #${FIELD_ID}`);
  }

  // 4) Update artifacts JSON — mark both ops as deleted so the rollback
  //    script doesn't try to unlink them again.
  const rbPath = new URL("./artifacts/official-docs-created.json", import.meta.url).pathname;
  const rb = JSON.parse(readFileSync(rbPath, "utf8"));
  const dropped = new Set([FIELD_ID + ":ir.model.fields", VIEW_ID + ":ir.ui.view"]);
  const kept = [];
  let removed = 0;
  for (const op of rb.operations || []) {
    const key = `${op.id}:${op.model}`;
    if (dropped.has(key)) {
      removed++;
      continue;
    }
    kept.push(op);
  }
  rb.operations = kept;
  rb.deleted_20260922 = (rb.deleted_20260922 || []).concat([
    { model: "ir.model.fields", id: FIELD_ID, name: "res.company.x_company_registry", reason: "superseded by l10n_sa CRN on partner" },
    { model: "ir.ui.view", id: VIEW_ID, name: "res.company.form.x_company_registry", reason: "superseded" },
  ]);
  writeFileSync(rbPath, JSON.stringify(rb, null, 2));
  console.log(`removed ${removed} entries from ${rbPath}`);
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
