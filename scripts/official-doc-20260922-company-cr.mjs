// Additive: add x_company_registry to res.company (Odoo tenant is SHARED
// between sim and prod — everything here is additive-by-name, idempotent,
// and captured in scripts/artifacts/official-docs-created.json so the
// existing scripts/official-doc-rollback.mjs undoes it in reverse.
//
// Dry-run by default. Pass --apply to write.
//
// Baraa fills the value himself from the Odoo UI after this runs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
mkdirSync(dirname(rbPath), { recursive: true });
let rb = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rbPath)) { try { rb = JSON.parse(readFileSync(rbPath, "utf8")); } catch {} }
function record(op) { rb.operations.push(op); writeFileSync(rbPath, JSON.stringify(rb, null, 2) + "\n"); }
function say(...args) { console.log(APPLY ? "[apply]" : "[dry-run]", ...args); }

async function main() {
  // (1) resolve res.company model id
  const [companyModel] = await call("ir.model", "search_read", {
    domain: [["model", "=", "res.company"]], fields: ["id"], limit: 1,
  });
  if (!companyModel) throw new Error("res.company model missing (impossible)");
  const companyModelId = companyModel.id;
  say(`res.company model id=${companyModelId}`);

  // (2) x_company_registry field — idempotent by name
  const existingField = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "res.company"], ["name", "=", "x_company_registry"]],
    fields: ["id", "name", "ttype"], limit: 1,
  });
  let fieldId;
  if (existingField.length > 0) {
    fieldId = existingField[0].id;
    say(`field res.company.x_company_registry exists id=${fieldId}`);
  } else if (!APPLY) {
    say(`would create field res.company.x_company_registry (char)`);
    fieldId = -1;
  } else {
    const ids = await call("ir.model.fields", "create", {
      vals_list: [{
        model_id: companyModelId,
        name: "x_company_registry",
        state: "manual",
        ttype: "char",
        field_description: "رقم السجل التجاري",
        copied: false,
      }],
    });
    fieldId = Array.isArray(ids) ? ids[0] : ids;
    record({ ts: new Date().toISOString(), model: "ir.model.fields", id: fieldId, name: "res.company.x_company_registry", action: "create" });
    say(`created field res.company.x_company_registry id=${fieldId}`);
  }

  // (3) view inheritance — add x_company_registry after vat in the standard
  //     res.company form (base.view_company_form).
  const [baseFormMD] = await call("ir.model.data", "search_read", {
    domain: [["module", "=", "base"], ["name", "=", "view_company_form"]],
    fields: ["res_id"], limit: 1,
  });
  if (!baseFormMD) throw new Error("base.view_company_form not found");
  const baseFormId = baseFormMD.res_id;
  say(`base res.company form view id=${baseFormId}`);

  const viewName = "res.company.form.x_company_registry";
  const [existingView] = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", viewName]], fields: ["id"], limit: 1,
  });
  const viewArch = `<data>
  <xpath expr="//field[@name='vat']" position="after">
    <field name="x_company_registry" string="رقم السجل التجاري" placeholder="مثال: 1010000000"/>
  </xpath>
</data>`;
  if (existingView) {
    say(`view ${viewName} exists id=${existingView.id}`);
  } else if (!APPLY) {
    say(`would create view ${viewName} inheriting base.view_company_form`);
  } else {
    const ids = await call("ir.ui.view", "create", {
      vals_list: [{
        name: viewName,
        model: "res.company",
        type: "form",
        inherit_id: baseFormId,
        arch: viewArch,
      }],
    });
    const id = Array.isArray(ids) ? ids[0] : ids;
    record({ ts: new Date().toISOString(), model: "ir.ui.view", id, name: viewName, action: "create" });
    say(`created view ${viewName} id=${id}`);
  }

  if (!APPLY) {
    console.log("\nDry-run only. Rerun with --apply to actually write.");
  } else {
    console.log("\nDone. Baraa fills x_company_registry from the Odoo UI.");
  }
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
