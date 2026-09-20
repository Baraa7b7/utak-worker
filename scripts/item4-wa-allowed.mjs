// Item 4 — res.partner.x_wa_allowed field + full UI surfacing
// (form + list + search) so «مسموح واتساب» is visible and searchable.
//
// Idempotent. Ensures:
//   * res.partner.x_wa_allowed (boolean, default false, label "مسموح واتساب")
//   * inherited form view — group above the notebook with x_whatsapp_number
//     and x_wa_allowed side-by-side, always visible (no invisible clause).
//   * inherited list view — column "مسموح واتساب" with optional="show".
//   * inherited search view — filter "مسموح واتساب" for x_wa_allowed = True.
//
// Arch kept intentionally simple: single xpath per view, no alert divs,
// no invisible expressions, no datetime filters — avoiding Odoo 19.4's
// silent-rollback trap when a compound arch fails half-way.

import { readFileSync } from "node:fs";

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
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") {
      await session();
      return call(model, method, body);
    }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${
      parsed?.data?.message ?? text.slice(0, 400)
    }`);
  }
  return parsed;
}

async function ensureWaAllowedField() {
  const modelRows = await call("ir.model", "search_read", {
    domain: [["model", "=", "res.partner"]],
    fields: ["id"],
    limit: 1,
  });
  const modelId = modelRows[0]?.id;
  if (!modelId) throw new Error("res.partner model not found");

  const existing = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "res.partner"], ["name", "=", "x_wa_allowed"]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) return { id: existing[0].id, action: "existed" };
  const ids = await call("ir.model.fields", "create", {
    vals_list: [{
      model_id: modelId,
      name: "x_wa_allowed",
      field_description: "مسموح واتساب",
      ttype: "boolean",
    }],
  });
  return { id: ids[0], action: "created" };
}

async function baseViewId(module, xmlName) {
  const rows = await call("ir.model.data", "search_read", {
    domain: [
      ["module", "=", module],
      ["name", "=", xmlName],
      ["model", "=", "ir.ui.view"],
    ],
    fields: ["res_id"],
    limit: 1,
  });
  const id = rows[0]?.res_id;
  if (!id) throw new Error(`base view ${module}.${xmlName} not found`);
  return id;
}

async function upsertView({ name, model, baseId, priority, arch }) {
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) {
    await call("ir.ui.view", "write", {
      ids: [existing[0].id],
      vals: { arch_base: arch, inherit_id: baseId, active: true, priority },
    });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [{ name, model, inherit_id: baseId, priority, arch_base: arch }],
  });
  return { id: ids[0], action: "created" };
}

async function ensurePartnerFormView() {
  const baseId = await baseViewId("base", "view_partner_form");
  // Place the WhatsApp block right ABOVE the notebook — a prominent spot
  // near the top of the sheet, always visible on every contact. Groups
  // x_whatsapp_number and x_wa_allowed together so they read as one unit.
  const arch = `<data>
  <xpath expr="//notebook" position="before">
    <group string="UTAK — واتساب" name="utak_wa_allowed_group">
      <field name="x_whatsapp_number"/>
      <field name="x_wa_allowed" widget="boolean_toggle"/>
    </group>
  </xpath>
</data>`;
  return upsertView({
    name: "res.partner.form.utak_wa_allowed",
    model: "res.partner",
    baseId,
    priority: 50,
    arch,
  });
}

async function ensurePartnerListView() {
  const baseId = await baseViewId("base", "view_partner_tree");
  const arch = `<data>
  <xpath expr="//field[@name='display_name']" position="after">
    <field name="x_wa_allowed" string="مسموح واتساب" widget="boolean_toggle" optional="show"/>
  </xpath>
</data>`;
  return upsertView({
    name: "res.partner.list.utak_wa_allowed",
    model: "res.partner",
    baseId,
    priority: 50,
    arch,
  });
}

async function ensurePartnerSearchView() {
  const baseId = await baseViewId("base", "view_res_partner_filter");
  const arch = `<data>
  <xpath expr="//search" position="inside">
    <separator/>
    <filter string="مسموح واتساب" name="filter_wa_allowed" domain="[('x_wa_allowed', '=', True)]"/>
  </xpath>
</data>`;
  return upsertView({
    name: "res.partner.search.utak_wa_allowed",
    model: "res.partner",
    baseId,
    priority: 50,
    arch,
  });
}

async function main() {
  console.log("Item 4 migration — starting");
  const f = await ensureWaAllowedField();
  console.log("[res.partner.x_wa_allowed]", f);
  const form = await ensurePartnerFormView();
  console.log("[partner form view]", form);
  const list = await ensurePartnerListView();
  console.log("[partner list view]", list);
  const search = await ensurePartnerSearchView();
  console.log("[partner search view]", search);
  console.log("\n--- summary ---");
  console.log(JSON.stringify({
    x_wa_allowed_field: f,
    partner_form_view: form,
    partner_list_view: list,
    partner_search_view: search,
  }, null, 2));
}

main().catch((e) => {
  console.error("ITEM 4 MIGRATION FAILED:", e);
  process.exit(1);
});
