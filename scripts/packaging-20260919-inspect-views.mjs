// Read the specific views we'll touch so I know exactly what to inherit from.
// Read-only.

import { readFileSync } from "node:fs";
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

async function main() {
  const views = await call("ir.ui.view", "read", {
    ids: [359, 604, 605, 606, 2724, 563],
    fields: ["id", "name", "model", "type", "priority", "inherit_id", "arch", "active", "mode"],
  });
  for (const v of views) {
    console.log(`\n===== view #${v.id} name=${v.name} model=${v.model} type=${v.type} priority=${v.priority} mode=${v.mode} inherit_id=${JSON.stringify(v.inherit_id)}`);
    console.log(v.arch);
  }

  // Existing automation rules on x_product_packaging?
  const auto = await call("base.automation", "search_read", {
    domain: [["model_id.model", "=", "x_product_packaging"]],
    fields: ["id", "name", "trigger", "action_server_ids", "active"],
  }).catch((e) => ({ error: String(e) }));
  console.log("\nexisting base.automation on x_product_packaging:", JSON.stringify(auto, null, 2));

  // Check that x_product_packaging is a Studio model and figure out its ir.model id
  const model = await call("ir.model", "search_read", {
    domain: [["model", "=", "x_product_packaging"]],
    fields: ["id", "name", "model", "modules"],
  });
  console.log("\nir.model row:", JSON.stringify(model, null, 2));

  // ir.model.fields for x_product_packaging so we know if x_sequence, x_is_default etc. exist
  const fields = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "x_product_packaging"]],
    fields: ["id", "name", "ttype", "field_description", "state", "selection_ids", "required"],
    order: "name",
  });
  console.log("\nir.model.fields for x_product_packaging:");
  for (const f of fields) {
    console.log(`  ${f.name} — ${f.ttype} — "${f.field_description}" state=${f.state}`);
  }
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
