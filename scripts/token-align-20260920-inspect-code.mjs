// 2026-09-20 — Dump the `code` field of code-type server actions so we can see
// EXACTLY how they build the URL and where the token literal lives. Prints
// tokens MASKED (all but last 4 chars). Read-only.

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

function mask(s) {
  if (typeof s !== "string" || s.length < 5) return "****";
  return `****${s.slice(-4)}`;
}
function maskCode(src) {
  if (typeof src !== "string") return "";
  // Mask any `token=<value>` inside a URL/query
  let out = src.replace(/(token=)([^\s"'`&]+)/g, (_, k, v) => `${k}${mask(v)}`);
  // Mask Python string bindings named token/TOKEN/Token
  out = out.replace(/\b(TOKEN|token|Token)\s*=\s*(['"])([^'"\n]+)(['"])/g,
    (_, name, q, v, q2) => `${name} = ${q}${mask(v)}${q2}`);
  return out;
}

async function main() {
  const ids = [971, 974, 975];
  const rows = await call("ir.actions.server", "read", {
    ids, fields: ["id", "name", "state", "code"],
  });
  for (const r of rows) {
    console.log(`----- action ${r.id} · ${r.name} (state=${r.state}) -----`);
    console.log(maskCode(r.code || "(empty)"));
    console.log();
  }
}
main().catch((e) => { console.error("INSPECT FAILED:", e); process.exit(1); });
