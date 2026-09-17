// Item 4 (tonight 2026-09-17) — res.partner.x_wa_allowed field + partner
// tab visibility of the flag.
//
// Idempotent. Adds:
//   * res.partner.x_wa_allowed (boolean, default false, label "مسموح واتساب")
//   * inherited res.partner form view that surfaces the flag near the
//     WhatsApp fields (or in the "معلومات UTAK" area if a prior view
//     already created that container).

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

async function ensurePartnerViewAddition() {
  const name = "res.partner.form.utak_wa_allowed";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  const xml = await call("ir.model.data", "search_read", {
    domain: [
      ["module", "=", "base"],
      ["name", "=", "view_partner_form"],
      ["model", "=", "ir.ui.view"],
    ],
    fields: ["res_id"],
    limit: 1,
  });
  const baseId = xml[0]?.res_id;
  if (!baseId) throw new Error("base res.partner form not found");
  const arch = `
    <data>
      <xpath expr="//sheet" position="inside">
        <group string="UTAK — واتساب">
          <field name="x_wa_allowed"/>
        </group>
      </xpath>
    </data>`;
  if (existing[0]) {
    await call("ir.ui.view", "write", {
      ids: [existing[0].id],
      vals: { arch_base: arch, inherit_id: baseId, active: true },
    });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [{
      name,
      model: "res.partner",
      inherit_id: baseId,
      priority: 50,
      arch_base: arch,
    }],
  });
  return { id: ids[0], action: "created" };
}

async function main() {
  console.log("Item 4 migration — starting");
  const f = await ensureWaAllowedField();
  console.log("[res.partner.x_wa_allowed]", f);
  const v = await ensurePartnerViewAddition();
  console.log("[partner form view]", v);
  console.log("\n--- summary ---");
  console.log(JSON.stringify({ x_wa_allowed_field: f, partner_view: v }, null, 2));
}

main().catch((e) => {
  console.error("ITEM 4 MIGRATION FAILED:", e);
  process.exit(1);
});
