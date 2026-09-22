// Read the webhook_url from an existing quotation Server Action (id=968 or 941)
// so we can reuse the same INTERNAL_WEBHOOK_SECRET token for the new
// /internal/official-doc/* endpoints. Prints ONLY host+path (no token).
//
// The script never writes the token to any file; the setup script that
// creates the new Server Actions reads it live from the same source at
// apply time.

import { readFileSync } from "node:fs";

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
    throw new Error(`HTTP ${res.status} ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 300)}`);
  }
  return parsed;
}

const rows = await call("ir.actions.server", "read", {
  ids: [968, 941, 969, 970, 957],
  fields: ["id", "name", "state", "webhook_url", "model_id"],
});

for (const r of rows) {
  const raw = String(r.webhook_url ?? "");
  let host = "(no url)";
  let path = "(no url)";
  let hasToken = false;
  try {
    const u = new URL(raw);
    host = u.origin;
    path = u.pathname;
    hasToken = u.searchParams.has("token");
  } catch { /* ignore */ }
  console.log(`#${r.id} ${r.name} state=${r.state} model=${r.model_id?.[1] ?? ""} → ${host}${path}  token_present=${hasToken}`);
}
