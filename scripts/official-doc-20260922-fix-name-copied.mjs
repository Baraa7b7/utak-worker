// Set x_official_doc.x_name to copied=False so Duplicate() gives a fresh
// draft without the number.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
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

const rbPath = new URL("./artifacts/official-docs-created.json", import.meta.url).pathname;
mkdirSync(dirname(rbPath), { recursive: true });
let rb = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rbPath)) { try { rb = JSON.parse(readFileSync(rbPath, "utf8")); } catch {} }
function record(op) { rb.operations.push(op); writeFileSync(rbPath, JSON.stringify(rb, null, 2) + "\n"); }

const rows = await call("ir.model.fields", "search_read", {
  domain: [["model", "=", "x_official_doc"], ["name", "=", "x_name"]],
  fields: ["id", "copied"], limit: 1,
});
if (!rows[0]) throw new Error("x_name not found on x_official_doc");
const before = rows[0].copied;
console.log(`x_official_doc.x_name id=${rows[0].id} copied=${before}`);
if (before === false) {
  console.log("already false, nothing to do");
  process.exit(0);
}
record({ ts: new Date().toISOString(), model: "ir.model.fields", id: rows[0].id, name: "x_official_doc.x_name.copied", action: "write", before: { copied: before } });
await call("ir.model.fields", "write", { ids: [rows[0].id], vals: { copied: false } });
const after = await call("ir.model.fields", "read", { ids: [rows[0].id], fields: ["copied"] });
console.log(`after: copied=${after[0].copied}`);
