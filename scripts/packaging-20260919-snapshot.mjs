// Snapshot of x_product_packaging BEFORE the packaging refactor
// (task: x_type + auto x_name + default-guard + list views + PDF unit).
//
// Reads every row on this tenant, writes:
//   scripts/artifacts/packaging-20260919-rollback.json
// which is what scripts/packaging-20260919-rollback.mjs consumes.
//
// Read-only. No writes to Odoo.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
  const rollbackPath = new URL("./artifacts/packaging-20260919-rollback.json", import.meta.url).pathname;
  const stamp = new Date().toISOString();
  console.log(`packaging snapshot — ${stamp}`);

  // Every existing packaging row, with every field we'll touch.
  const rows = await call("x_product_packaging", "search_read", {
    domain: [],
    fields: [
      "id",
      "x_name",
      "x_product_tmpl_id",
      "x_approx_weight_kg",
      "x_is_default",
      "x_sequence",
    ],
    order: "x_product_tmpl_id, x_sequence, id",
  });
  console.log(`rows: ${rows.length}`);

  // Also snapshot ANY existing x_type value if the field happens to exist —
  // the model has no such column today, but this is cheap insurance.
  let hasXType = false;
  try {
    const fields = await call("x_product_packaging", "fields_get", { attributes: ["type"] });
    hasXType = Boolean(fields?.x_type);
  } catch { /* fields_get shape may vary; ignore */ }

  // Grab the current "act 932" action so we know its res_model/view chain.
  const act932 = await call("ir.actions.act_window", "search_read", {
    domain: [["id", "=", 932]],
    fields: ["id", "name", "res_model", "view_ids", "view_mode", "domain", "context"],
  });

  // And the current product.template list view id (default).
  const productTmplList = await call("ir.ui.view", "search_read", {
    domain: [["model", "=", "product.template"], ["type", "=", "list"], ["mode", "=", "primary"]],
    fields: ["id", "name", "priority", "active"],
    order: "priority, id",
  });

  const before = {
    generated_at: stamp,
    x_type_existed_before: hasXType,
    rows,
    act_932: act932[0] ?? null,
    product_tmpl_list_views: productTmplList,
  };

  mkdirSync(dirname(rollbackPath), { recursive: true });
  writeFileSync(rollbackPath, JSON.stringify(before, null, 2) + "\n");
  console.log(`Rollback JSON written to: ${rollbackPath}`);

  // Group summary — helpful to eyeball what we're about to migrate.
  const byTmpl = new Map();
  for (const r of rows) {
    const key = r.x_product_tmpl_id ? `${r.x_product_tmpl_id[0]} ${r.x_product_tmpl_id[1]}` : "(no template)";
    if (!byTmpl.has(key)) byTmpl.set(key, []);
    byTmpl.get(key).push(r);
  }
  console.log(`\ntemplates covered: ${byTmpl.size}`);
  for (const [tmpl, list] of byTmpl) {
    const def = list.filter((r) => r.x_is_default).length;
    console.log(`  ${tmpl} — ${list.length} pkg (default=${def})`);
    for (const r of list) {
      console.log(`    #${r.id} name="${r.x_name}" weight=${r.x_approx_weight_kg} default=${r.x_is_default} seq=${r.x_sequence}`);
    }
  }
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
