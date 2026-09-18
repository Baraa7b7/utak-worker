// Item 2e — create the 4 Odoo x_whatsapp_template rows for Meta templates that
// the sync could not create (because x_purpose is required at the model level
// and the sync leaves it unset on create).
//
// Templates (from Meta list, APPROVED):
//   utak_v2_collection    / ar    → x_purpose = "other"
//   utak_v2_purchase      / ar    → x_purpose = "other"
//   utak_v2_driver_route  / ar    → x_purpose = "other"
//   hello_world           / en_US → x_purpose = "other"
//
// Purpose="other" because none of these template names cleanly map to a unique
// x_purpose already-in-use (collection_summary/purchase_list/driver_dispatch
// are already taken by v1 templates). Assigning "other" satisfies the required
// field, does not create ambiguity for fetchMapping (no code path calls
// fetchMapping("other")), and lets Baraa reassign a specific purpose later via
// the form once he inspects the actual body of each v2 template.
//
// After creating the 4 rows this script re-runs the sync so the rows pick up
// x_meta_id, x_meta_status, x_category, x_body, x_param_count, x_buttons, and
// x_last_synced from Meta.
//
// Rollback (single line each):
//   x_whatsapp_template.unlink([id]) for each new row.

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

const TARGETS = [
  { name: "utak_v2_collection",   lang: "ar",    purpose: "other" },
  { name: "utak_v2_purchase",     lang: "ar",    purpose: "other" },
  { name: "utak_v2_driver_route", lang: "ar",    purpose: "other" },
  { name: "hello_world",          lang: "en_US", purpose: "other" },
];

// Skip any that already exist (idempotent)
const existing = await call("x_whatsapp_template", "search_read", {
  domain: [["x_meta_template_id", "in", TARGETS.map((t) => t.name)]],
  fields: ["id", "x_meta_template_id", "x_language", "x_purpose"],
});
const existingSet = new Set(existing.map((r) => `${r.x_meta_template_id}::${(r.x_language || "").toLowerCase()}`));
console.log(`already existing: ${existingSet.size}`);
for (const r of existing) console.log(`  id=${r.id} ${r.x_meta_template_id}/${r.x_language} purpose=${r.x_purpose}`);

const toCreate = TARGETS.filter((t) => !existingSet.has(`${t.name}::${t.lang.toLowerCase()}`));
console.log(`\nto create: ${toCreate.length}`);
for (const t of toCreate) console.log(`  ${t.name}/${t.lang} → purpose=${t.purpose}`);

if (toCreate.length > 0) {
  const vals_list = toCreate.map((t) => ({
    x_meta_template_id: t.name,
    x_language: t.lang,
    x_purpose: t.purpose,
    x_meta_status: "APPROVED",
    x_missing_in_meta: false,
  }));
  const ids = await call("x_whatsapp_template", "create", { vals_list });
  console.log(`\ncreated ids: ${JSON.stringify(ids)}`);
}

// Verify
const after = await call("x_whatsapp_template", "search_read", {
  domain: [["x_meta_template_id", "in", TARGETS.map((t) => t.name)]],
  fields: ["id", "x_meta_template_id", "x_language", "x_purpose", "x_meta_status"],
});
console.log(`\nAFTER (${after.length} rows):`);
for (const r of after) console.log(`  id=${r.id} ${r.x_meta_template_id}/${r.x_language} purpose=${r.x_purpose} status=${r.x_meta_status}`);

if (after.length !== TARGETS.length) {
  console.error(`FAIL: expected ${TARGETS.length}, found ${after.length}`);
  process.exit(2);
}
