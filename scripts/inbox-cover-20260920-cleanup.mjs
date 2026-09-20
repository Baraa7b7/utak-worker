// Cleanup for the smoke test: unlink the test partner we created for
// +966536251307 plus its discuss channel. Idempotent — safe to run twice.
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
  // Find any smoke-labeled partner still around for +966536251307.
  const smokes = await call("res.partner", "search_read", {
    domain: [["name", "ilike", "smoke test (+966536251307)"]],
    fields: ["id", "name", "x_wa_channel_id"],
  });
  console.log(`smoke partners found: ${smokes.length}`);
  const chIds = [];
  for (const p of smokes) {
    if (Array.isArray(p.x_wa_channel_id)) chIds.push(p.x_wa_channel_id[0]);
    console.log(`  will unlink partner id=${p.id} channel=${p.x_wa_channel_id?.[0] ?? "-"}`);
  }
  // Unlink partners; Odoo may refuse if referenced. Fall back to archive.
  for (const p of smokes) {
    try { await call("res.partner", "unlink", { ids: [p.id] }); console.log(`  unlinked partner ${p.id}`); }
    catch (e) {
      console.log(`  archive partner ${p.id} (${e.message.slice(0, 80)})`);
      try { await call("res.partner", "write", { ids: [p.id], vals: { active: false } }); } catch (_) {}
    }
  }
  if (chIds.length) {
    try { await call("discuss.channel", "unlink", { ids: chIds }); console.log(`  unlinked channels ${chIds.join(",")}`); }
    catch (e) { console.log(`  channel unlink failed: ${e.message.slice(0, 100)}`); }
  }
  console.log("done.");
}
main().catch(e => { console.error("[fatal]", e.stack || e.message || e); process.exit(1); });
