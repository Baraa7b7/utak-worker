// Item 3b — pre-register the supplier_confirm x_whatsapp_template row on
// utakfresh.odoo.com so that once Meta approves the template (via
// Business Manager UI, following docs/supplier-confirm-template.md),
// the wa-template-sync pipeline can update this row in place and the
// existing `TMPL_SUPPLIER_CONFIRM = "supplier_confirm"` purpose in
// src/config.ts resolves. The Odoo model requires x_purpose at create
// time, so leaving the sync to create it after Meta approval fails
// (HTTP 422 — same bug that item2e fixed for four other templates).
//
// Template spec (final): body + 3 quick-reply buttons — full details in
// docs/supplier-confirm-template.md. Meta name chosen: utak_supplier_confirm_v1.
//
// Idempotent: skips if a row for the same (name, language) already
// exists. Passing --refresh updates x_purpose/x_language on the existing
// row without touching sync-managed fields.

import { readFileSync } from "node:fs";

const REFRESH = process.argv.includes("--refresh");

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

const META_NAME = "utak_supplier_confirm_v1";
const LANG      = "ar";
const PURPOSE   = "supplier_confirm";

const existing = await call("x_whatsapp_template", "search_read", {
  domain: [["x_meta_template_id", "=", META_NAME], ["x_language", "=", LANG]],
  fields: ["id","x_meta_template_id","x_language","x_purpose","x_meta_status"],
});

if (existing.length > 0) {
  const row = existing[0];
  console.log(`Row already exists: id=${row.id} purpose=${row.x_purpose} status=${row.x_meta_status}`);
  if (REFRESH) {
    await call("x_whatsapp_template", "write", {
      ids: [row.id], vals: { x_purpose: PURPOSE, x_language: LANG },
    });
    console.log(`  refreshed purpose+language`);
  }
  process.exit(0);
}

const ids = await call("x_whatsapp_template", "create", { vals_list: [{
  x_meta_template_id: META_NAME,
  x_language:         LANG,
  x_purpose:          PURPOSE,
  x_meta_status:      "PENDING_META",
  x_category:         "UTILITY",
  x_missing_in_meta:  true,
}]});
console.log(`Created row id=${ids[0]} for ${META_NAME}/${LANG} purpose=${PURPOSE}`);
console.log(`\nNext step: Baraa submits the template on Meta Business Manager.`);
console.log(`Spec + submission steps: docs/supplier-confirm-template.md`);
