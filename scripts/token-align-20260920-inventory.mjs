// 2026-09-20 — Inventory pass: list every ir.actions.server that talks to the
// Worker via workers.dev, whether it's a real webhook (state='webhook') or a
// Python code action that hardcodes the URL. Also lists any base.automation
// that runs one of these actions. Read-only.
//
// Output is printed as a table and dumped to
//   scripts/artifacts/token-align-20260920-inventory.json
// Token values are NEVER printed — only the last 4 characters.

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

function last4(str) {
  if (typeof str !== "string" || !str) return "";
  return str.slice(-4);
}

// Parses a workers.dev-shaped URL, returns { host, path, tokenParam, tokenValue }.
// Returns null if there is no match at all.
function parseWorkerUrl(u) {
  if (typeof u !== "string" || !u) return null;
  const m = /https?:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/.exec(u);
  if (!m) return null;
  const host = m[1];
  const path = m[2] || "";
  const qs = m[3] || "";
  let tokenParam = "";
  let tokenValue = "";
  if (qs) {
    for (const kv of qs.split("&")) {
      const [k, v = ""] = kv.split("=");
      if (k === "token" || k === "t" || k === "auth" || k === "secret") {
        tokenParam = k;
        try { tokenValue = decodeURIComponent(v); } catch { tokenValue = v; }
        break;
      }
    }
  }
  return { host, path, tokenParam, tokenValue };
}

// Best-effort scan for workers.dev URLs and a token literal in Python `code`
// server actions. Looks for the first workers.dev URL and, if a `token=` query
// param is present, extracts its value from the same URL string; otherwise
// looks for a nearby `token = "..."` or `TOKEN = "..."` binding.
function scanCodeForWorker(code) {
  if (typeof code !== "string" || !code) return null;
  const urlMatch = /https?:\/\/[^\s"'`)]+workers\.dev[^\s"'`)]*/.exec(code);
  if (!urlMatch) return null;
  const parsed = parseWorkerUrl(urlMatch[0]);
  if (!parsed) return null;

  if (!parsed.tokenValue) {
    // Try to spot a nearby literal Python string assignment for a token var.
    // Only takes it if it's used with the URL (defensive: same code block).
    const m2 = /\b(?:TOKEN|token|Token)\s*=\s*(['"])([^'"\n]+)\1/.exec(code);
    if (m2) {
      parsed.tokenParam = parsed.tokenParam || "(from code var)";
      parsed.tokenValue = m2[2];
    }
  }
  return parsed;
}

async function main() {
  const stamp = new Date().toISOString();
  console.log(`Inventory pass — ${stamp}`);
  console.log(`Odoo: ${ODOO_URL} db=${ODOO_DB}`);
  console.log();

  // 1) Every ir.actions.server that is either a webhook or has workers.dev
  //    hardcoded in its code. `state` values worth looking at: 'webhook',
  //    'code'. Also fetch usage_ids so we know if a base.automation runs it.
  const webhookRows = await call("ir.actions.server", "search_read", {
    domain: [["state", "=", "webhook"]],
    fields: ["id", "name", "state", "webhook_url", "model_id", "usage"],
    order: "id",
  });
  const codeRows = await call("ir.actions.server", "search_read", {
    domain: [["state", "=", "code"], ["code", "ilike", "workers.dev"]],
    fields: ["id", "name", "state", "code", "model_id", "usage"],
    order: "id",
  });

  // 2) base.automation rows that trigger any of these actions.
  const allActionIds = [...webhookRows, ...codeRows].map((r) => r.id);
  let automations = [];
  if (allActionIds.length) {
    try {
      automations = await call("base.automation", "search_read", {
        domain: [["action_server_ids", "in", allActionIds]],
        fields: ["id", "name", "active", "model_name", "trigger", "action_server_ids"],
        order: "id",
      });
    } catch (e) {
      // Some Odoo builds use action_server_id instead of action_server_ids
      try {
        automations = await call("base.automation", "search_read", {
          domain: [["action_server_id", "in", allActionIds]],
          fields: ["id", "name", "active", "model_name", "trigger", "action_server_id"],
          order: "id",
        });
      } catch {
        console.warn("[warn] could not list base.automation → skipping cross-ref");
      }
    }
  }
  const actionIdToAutomations = new Map();
  for (const a of automations) {
    const ids = a.action_server_ids || (a.action_server_id ? [a.action_server_id] : []);
    for (const id of ids) {
      if (!actionIdToAutomations.has(id)) actionIdToAutomations.set(id, []);
      actionIdToAutomations.get(id).push({
        id: a.id, name: a.name, active: a.active, model: a.model_name, trigger: a.trigger,
      });
    }
  }

  // 3) Build normalized rows.
  const rows = [];
  for (const r of webhookRows) {
    const parsed = parseWorkerUrl(r.webhook_url || "");
    const auto = actionIdToAutomations.get(r.id) || [];
    rows.push({
      id: r.id,
      name: r.name,
      state: r.state,
      model: r.model_id ? r.model_id[1] : "",
      host: parsed?.host || "",
      path: parsed?.path || "",
      tokenParam: parsed?.tokenParam || "",
      tokenLast4: last4(parsed?.tokenValue || ""),
      workerUrl_raw: r.webhook_url || "",  // KEPT INTERNAL ONLY — printed nowhere, JSON only via last4
      automations: auto,
    });
  }
  for (const r of codeRows) {
    const parsed = scanCodeForWorker(r.code || "");
    const auto = actionIdToAutomations.get(r.id) || [];
    rows.push({
      id: r.id,
      name: r.name,
      state: r.state,
      model: r.model_id ? r.model_id[1] : "",
      host: parsed?.host || "",
      path: parsed?.path || "",
      tokenParam: parsed?.tokenParam || "",
      tokenLast4: last4(parsed?.tokenValue || ""),
      code_raw: r.code || "",  // KEPT INTERNAL ONLY
      automations: auto,
    });
  }

  rows.sort((a, b) => a.id - b.id);

  // Console table with safe columns only.
  console.log("id  | state    | host                                                 | path                                    | tokenLast4 | name");
  console.log("----+----------+------------------------------------------------------+-----------------------------------------+------------+-----");
  for (const r of rows) {
    console.log(
      String(r.id).padStart(3),
      "|", (r.state || "").padEnd(8),
      "|", (r.host || "-").padEnd(52).slice(0, 52),
      "|", (r.path || "-").padEnd(39).slice(0, 39),
      "|", (r.tokenLast4 || "-").padEnd(10),
      "|", r.name,
    );
  }

  // 4) Also list what we expected: 941 957 963 967 968 969 970 971 974 975 979
  const expected = [941, 957, 963, 967, 968, 969, 970, 971, 974, 975, 979];
  const found = new Set(rows.map((r) => r.id));
  const missing = expected.filter((id) => !found.has(id));
  const extras  = rows.map((r) => r.id).filter((id) => !expected.includes(id));
  console.log();
  console.log("Expected but missing:", missing.length ? missing.join(", ") : "(none)");
  console.log("Extra (unexpected)   :", extras.length ? extras.join(", ") : "(none)");

  // 5) Dump full JSON (with the raw fields), mode 600, to artifacts.
  const outPath = new URL("./artifacts/token-align-20260920-inventory.json", import.meta.url).pathname;
  mkdirSync(dirname(outPath), { recursive: true });
  const publicJson = rows.map((r) => ({
    id: r.id, name: r.name, state: r.state, model: r.model,
    host: r.host, path: r.path, tokenParam: r.tokenParam, tokenLast4: r.tokenLast4,
    automations: r.automations,
  }));
  writeFileSync(outPath, JSON.stringify({
    generated_at: stamp,
    odoo_url: ODOO_URL,
    odoo_db: ODOO_DB,
    expected, missing, extras,
    rows: publicJson,
  }, null, 2) + "\n");
  console.log(`\nSAFE JSON written to ${outPath} (no full tokens).`);
}
main().catch((e) => { console.error("INVENTORY FAILED:", e); process.exit(1); });
