// Inspect what fields base.automation and ir.actions.server accept.
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
  // fields_get on base.automation
  const baf = await call("base.automation", "fields_get", { attributes: ["type", "string", "selection", "required", "readonly", "help"] });
  console.log("base.automation fields:");
  for (const [k, v] of Object.entries(baf)) {
    if (["id","display_name","create_uid","create_date","write_uid","write_date"].includes(k)) continue;
    console.log(`  ${k} — ${v.type} — "${v.string || ""}"${v.selection ? ` sel=${JSON.stringify(v.selection)}` : ""}${v.required ? " REQ" : ""}${v.readonly ? " RO" : ""}`);
  }

  // Also inspect one existing base.automation record on any model to see how triggers/actions are wired.
  const sample = await call("base.automation", "search_read", {
    domain: [],
    fields: ["id","name","model_id","trigger","trigger_field_ids","filter_pre_domain","filter_domain","action_server_ids","active"],
    limit: 3,
  });
  console.log("\nsample base.automation rows:", JSON.stringify(sample, null, 2));

  // ir.actions.server fields (state='code' pattern)
  const iasf = await call("ir.actions.server", "fields_get", { attributes: ["type", "string", "selection", "required"] });
  console.log("\nir.actions.server key fields:");
  for (const k of ["name","model_id","state","code","usage","binding_model_id","binding_type","update_field_id","evaluation_type"]) {
    const v = iasf[k];
    if (!v) continue;
    console.log(`  ${k} — ${v.type} — "${v.string || ""}"${v.selection ? ` sel=${JSON.stringify(v.selection)}` : ""}${v.required ? " REQ" : ""}`);
  }
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
