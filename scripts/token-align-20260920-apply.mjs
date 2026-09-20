// 2026-09-20 — Rewrite ir.actions.server (941, 957, 968) webhook_url to point
// at the sim Worker with the correct secret (INTERNAL_WEBHOOK_SECRET rotated
// today; 968 currently carries the HOOK token by mistake). Every other action
// stays untouched.
//
// Two rollback files are written BEFORE any write:
//   1. scripts/artifacts/token-align-20260920-rollback.json  (SAFE — tokens as ****xxxx)
//   2. ~/utak-token-align-rollback.json                      (FULL — mode 600, outside repo)
//
// The FULL file is the only place the previous URLs live; feed it to
// scripts/token-align-20260920-rollback.mjs to restore.
//
// Never prints a full token. Nothing else in Odoo is touched.

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

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

const SIM_HOST = "utak-worker-sim.utak-business.workers.dev";

function last4(s) { return typeof s === "string" && s ? s.slice(-4) : ""; }
function mask(s)  { return typeof s === "string" && s ? `****${s.slice(-4)}` : "****"; }
function maskUrl(u) {
  if (typeof u !== "string") return u;
  return u.replace(/(token=)([^&#]+)/g, (_, k, v) => `${k}${mask(v)}`);
}

async function main() {
  const stamp = new Date().toISOString();
  console.log(`Apply token alignment — ${stamp}`);
  console.log();

  // ---- Load tokens ----
  const internalPath = join(homedir(), "utak-internal-sim-token.txt");
  if (!existsSync(internalPath)) throw new Error(`${internalPath} missing — cannot apply`);
  const INTERNAL = readFileSync(internalPath, "utf8").trim();
  if (!INTERNAL) throw new Error("INTERNAL token file is empty");

  // Verify HOOK is still accepted on sim (bail if not).
  const act979 = (await call("ir.actions.server", "read", { ids: [979], fields: ["id", "name", "webhook_url"] }))[0];
  const m = /[?&]token=([^&#]+)/.exec(act979?.webhook_url || "");
  const HOOK = m ? decodeURIComponent(m[1]) : "";
  if (!HOOK) throw new Error("could not extract HOOK from action 979 (bail)");

  // Quick sanity probe: HOOK must NOT be 401 on /odoo/hook/wa-inbox.
  {
    const url = `https://${SIM_HOST}/odoo/hook/wa-inbox?token=${encodeURIComponent(HOOK)}`;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (r.status === 401 || r.status === 403) {
      throw new Error(`HOOK token from action 979 was rejected by sim (${r.status}); aborting.`);
    }
    console.log(`[sanity] HOOK last4=${last4(HOOK)} → sim /odoo/hook/wa-inbox status=${r.status} → accepted`);
  }
  console.log(`[sanity] INTERNAL last4=${last4(INTERNAL)} loaded`);
  console.log();

  // ---- Read current state of the actions we plan to touch ----
  const TARGET_IDS = [941, 957, 968];
  const before = await call("ir.actions.server", "read", {
    ids: TARGET_IDS,
    fields: ["id", "name", "state", "webhook_url"],
  });

  // Build the plan: what each action's new webhook_url should be.
  const plan = [];
  for (const r of before) {
    if (r.state !== "webhook") {
      throw new Error(`action ${r.id} is state=${r.state}; script only handles webhook. Abort.`);
    }
    let newPath;
    let neededToken;
    if (r.id === 941) { newPath = "/internal/quotation-issue";  neededToken = INTERNAL; }
    else if (r.id === 957) { newPath = "/internal/receipt-issue"; neededToken = INTERNAL; }
    else if (r.id === 968) { newPath = "/internal/quotation-issue"; neededToken = INTERNAL; }
    else throw new Error(`unexpected action id ${r.id}`);
    const newUrl = `https://${SIM_HOST}${newPath}?token=${encodeURIComponent(neededToken)}`;
    plan.push({ id: r.id, name: r.name, oldUrl: r.webhook_url || "", newUrl });
  }

  console.log("Plan:");
  for (const p of plan) {
    console.log(`  ${p.id} · ${p.name}`);
    console.log(`     old: ${maskUrl(p.oldUrl)}`);
    console.log(`     new: ${maskUrl(p.newUrl)}`);
  }
  console.log();

  // ---- Write rollback files BEFORE any writes ----
  const safePath = new URL("./artifacts/token-align-20260920-rollback.json", import.meta.url).pathname;
  const fullPath = join(homedir(), "utak-token-align-rollback.json");

  mkdirSync(dirname(safePath), { recursive: true });
  const safePayload = {
    generated_at: stamp,
    odoo_url: ODOO_URL,
    odoo_db: ODOO_DB,
    entries: plan.map((p) => ({
      id: p.id,
      name: p.name,
      before_url_masked: maskUrl(p.oldUrl),
      before_token_last4: last4((/[?&]token=([^&#]+)/.exec(p.oldUrl || "") || [])[1] || ""),
      after_url_masked: maskUrl(p.newUrl),
      after_token_last4: last4((/[?&]token=([^&#]+)/.exec(p.newUrl || "") || [])[1] || ""),
    })),
    note: "Full previous URLs live in ~/utak-token-align-rollback.json (mode 600).",
  };
  writeFileSync(safePath, JSON.stringify(safePayload, null, 2) + "\n");
  console.log(`[safe rollback]  ${safePath}`);

  const fullPayload = {
    generated_at: stamp,
    odoo_url: ODOO_URL,
    odoo_db: ODOO_DB,
    entries: plan.map((p) => ({
      id: p.id, name: p.name, before_url: p.oldUrl, after_url: p.newUrl,
    })),
  };
  writeFileSync(fullPath, JSON.stringify(fullPayload, null, 2) + "\n");
  chmodSync(fullPath, 0o600);
  console.log(`[full rollback]  ${fullPath} (mode 600)`);
  console.log();

  // ---- Apply ----
  for (const p of plan) {
    await call("ir.actions.server", "write", {
      ids: [p.id],
      vals: { webhook_url: p.newUrl },
    });
    console.log(`[write] ${p.id} → ${maskUrl(p.newUrl)}`);
  }
  console.log();

  // ---- Read back + verify each token is accepted on sim ----
  const after = await call("ir.actions.server", "read", {
    ids: TARGET_IDS,
    fields: ["id", "name", "webhook_url"],
  });
  console.log("Re-probe (empty body → expect 400, not 401):");
  const results = [];
  for (const r of after) {
    const u = new URL(r.webhook_url);
    const host = u.host;
    const path = u.pathname;
    const tok = u.searchParams.get("token") || "";
    const testUrl = r.webhook_url;
    const resp = await fetch(testUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const bodyText = (await resp.text().catch(() => "")).slice(0, 200);
    const accepted = resp.status !== 401 && resp.status !== 403;
    results.push({ id: r.id, host, path, tokLast4: last4(tok), status: resp.status, accepted, snippet: bodyText });
    console.log(
      `  ${r.id} host=${host} path=${path} tokLast4=${last4(tok)} status=${resp.status} accepted=${accepted}  ${bodyText}`
    );
  }
  console.log();

  const allOk = results.every((r) => r.accepted);
  if (!allOk) {
    console.error("SOMETHING WASN'T ACCEPTED — see above; leaving Odoo as-is (writes already applied).");
    console.error("Roll back with: node scripts/token-align-20260920-rollback.mjs --apply");
    process.exit(2);
  }
  console.log("All three actions accepted on sim.");
}
main().catch((e) => { console.error("APPLY FAILED:", e); process.exit(1); });
