// Look for a UTAK icon (image) usable as the "UTAK بوت" partner avatar.

import { readFileSync, writeFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
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

// 1) Company logo (fallback)
const company = await call("res.company", "read", { ids: [1], fields: ["id", "name", "logo"] });
console.log("company:", company[0]?.name, "logo present:", !!company[0]?.logo);

// 2) Any menu icon under UTAK 529 subtree with a data icon
const menus = await call("ir.ui.menu", "search_read", {
  domain: [["parent_id", "child_of", 529]],
  fields: ["id", "name", "web_icon", "web_icon_data"],
});
console.log("menus with web_icon_data:", menus.filter((m) => m.web_icon_data).map((m) => ({ id: m.id, name: m.name, len: (m.web_icon_data || "").length })));

// 3) ir.attachment named "utak*"
const atts = await call("ir.attachment", "search_read", {
  domain: [["name", "ilike", "utak"]],
  fields: ["id", "name", "mimetype", "res_model", "res_id"],
  limit: 20,
});
console.log("utak attachments:", JSON.stringify(atts));

// 4) any existing partner named UTAK or a bot user
const utakPartners = await call("res.partner", "search_read", {
  domain: ["|", ["name", "ilike", "UTAK"], ["name", "ilike", "بوت"]],
  fields: ["id", "name", "image_128", "phone", "user_ids"],
});
console.log("utak/bot-like partners:");
for (const p of utakPartners) {
  console.log(`  #${p.id} ${p.name} image? ${!!p.image_128} phone=${p.phone} users=${JSON.stringify(p.user_ids)}`);
}
