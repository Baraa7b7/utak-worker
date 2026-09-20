// Item 2e (refine) — now that the sync backfilled the 4 rows with their real
// Meta bodies, reassign x_purpose to the specific value each template's body
// actually describes (was set to "other" as a placeholder that satisfied the
// required-field constraint).
//
// Body evidence (verified via sync):
//   id=42 utak_v2_collection    "كشف التحصيل جاهز يا …"  → collection_summary
//   id=43 utak_v2_purchase      "قائمة مشتريات اليوم …"  → purchase_list
//   id=44 utak_v2_driver_route  "مسارك جاهز …"            → driver_dispatch
//   id=45 hello_world           Meta demo template        → other  (kept)
//
// Note: the v1 templates already own these three purposes
//   id=5  utak_purchase_list_v2   → purchase_list
//   id=7  utak_driver_dispatch    → driver_dispatch
//   id=11 utak_collection_summary → collection_summary
// fetchMapping uses limit=1 and picks the lower id, so the v1 templates
// still win at send-time. The v2 rows are semantically labeled and ready
// for Baraa to demote a v1 (change to "other") whenever he wants v2 to
// take over.
//
// Rollback: write x_purpose back to "other" on the 3 refined rows.

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
async function ses() {
  const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (r.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(m, met, b) {
  const h = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") h["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else h["Cookie"] = auth.cookie;
  const r = await fetch(`${ODOO_URL}/json/2/${m}/${met}`, {
    method: "POST", headers: h, body: JSON.stringify(b),
  });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(m, met, b); }
    throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message ?? String(t).slice(0,300)}`);
  }
  return p;
}

const REFINE = [
  { id: 42, name: "utak_v2_collection",   purpose: "collection_summary" },
  { id: 43, name: "utak_v2_purchase",     purpose: "purchase_list"      },
  { id: 44, name: "utak_v2_driver_route", purpose: "driver_dispatch"    },
];

for (const t of REFINE) {
  await call("x_whatsapp_template", "write", {
    ids: [t.id],
    vals: { x_purpose: t.purpose },
  });
  console.log(`refined id=${t.id} ${t.name} → x_purpose=${t.purpose}`);
}

// Verify
const rows = await call("x_whatsapp_template", "search_read", {
  domain: [["id", "in", [42, 43, 44, 45]]],
  fields: ["id", "x_meta_template_id", "x_language", "x_purpose"],
});
console.log("\nAFTER:");
for (const r of rows) console.log(`  id=${r.id} ${r.x_meta_template_id}/${r.x_language} purpose=${r.x_purpose}`);

// Show which template wins for each purpose (fetchMapping simulation: limit 1)
for (const purpose of ["collection_summary", "purchase_list", "driver_dispatch"]) {
  const win = await call("x_whatsapp_template", "search_read", {
    domain: [["x_purpose", "=", purpose]],
    fields: ["id", "x_meta_template_id", "x_language"],
    limit: 1,
  });
  console.log(`\nfetchMapping('${purpose}') → ${win.length ? `id=${win[0].id} name=${win[0].x_meta_template_id}` : "none"}`);
}
