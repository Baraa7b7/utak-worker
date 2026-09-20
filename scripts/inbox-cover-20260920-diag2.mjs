// Follow-up diagnostic: what mail.message rows exist in Omar's channel 19,
// and any x_wa_message rows on any partner around 07:22 Riyadh (04:22 UTC).
import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
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

async function main() {
  console.log("== mail.message rows in channel 19 (Omar) ==");
  const msgs = await call("mail.message", "search_read", {
    domain: [["model", "=", "discuss.channel"], ["res_id", "=", 19]],
    fields: ["id", "author_id", "message_type", "body", "date", "create_date"],
    order: "id desc", limit: 20,
  });
  console.log(`count=${msgs.length}`);
  for (const m of msgs) {
    console.log(JSON.stringify({
      id: m.id, author: m.author_id, type: m.message_type,
      body: (m.body || "").replace(/<[^>]+>/g, "").slice(0, 80),
      date: m.date,
    }));
  }

  console.log("\n== all x_wa_message rows today ==");
  const today = "2026-09-20 00:00:00";
  const rows = await call("x_wa_message", "search_read", {
    domain: [["create_date", ">=", today]],
    fields: ["id", "x_partner_id", "x_direction", "x_status", "x_kind", "x_body", "x_meta_message_id", "create_date"],
    order: "id desc",
  });
  console.log(`count=${rows.length}`);
  for (const w of rows) {
    console.log(JSON.stringify({
      id: w.id, partner: w.x_partner_id, dir: w.x_direction, st: w.x_status,
      kind: w.x_kind, body: (w.x_body || "").slice(0, 40),
      wamid_tail: (w.x_meta_message_id || "").slice(-8),
      at: w.create_date,
    }));
  }

  console.log("\n== partner 41 (ماجد) — who and channel? ==");
  const p41 = await call("res.partner", "read", {
    ids: [41],
    fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_channel_id", "x_role_ids", "customer_rank", "supplier_rank", "x_wa_allowed"],
  });
  const r = p41[0];
  console.log(JSON.stringify({
    id: r.id, name: r.name,
    phone_tail: `…${(r.phone || "").slice(-4)}`,
    wa_tail: `…${(r.x_whatsapp_number || "").slice(-4)}`,
    x_wa_channel_id: r.x_wa_channel_id, x_role_ids: r.x_role_ids,
    customer_rank: r.customer_rank, supplier_rank: r.supplier_rank,
    x_wa_allowed: r.x_wa_allowed,
  }));

  console.log("\n== active discuss.channel with x_wa_partner_id set ==");
  const chs = await call("discuss.channel", "search_read", {
    domain: [["x_wa_partner_id", "!=", false]],
    fields: ["id", "name", "x_wa_partner_id"],
    order: "id desc", limit: 20,
  });
  console.log(`count=${chs.length}`);
  for (const c of chs) {
    console.log(JSON.stringify({ id: c.id, name: c.name, partner: c.x_wa_partner_id }));
  }

  console.log("\n== employee roles (x_employee_role) ==");
  const roles = await call("x_employee_role", "search_read", {
    domain: [], fields: ["id", "x_code", "x_name"],
  });
  console.log(JSON.stringify(roles));
}
main().catch(e => { console.error("[fatal]", e.stack || e.message || e); process.exit(1); });
