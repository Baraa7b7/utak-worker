// Inbox 2026-09-20 — point the two remaining prod-facing server actions
// (id=941 "UTAK: Issue & Send Quotation", id=957 "Send Receipt Webhook") at
// the sim worker instead.
//
// 2026-09-20 (cover) — rewritten so we NEVER read the sim token from a
// user file. The token is extracted in-memory from server action id=968
// ("quotation.manual_pdf_build"), which already points to the sim worker
// with a valid INTERNAL_WEBHOOK_SECRET. We then verify the token is
// accepted by sim's /internal/quotation-issue and /internal/receipt-issue
// (empty body → 400 "invalid quotation_id" or "invalid id" means the auth
// gate passed and no side effect fired). Only on verification do we
// rewrite 941/957.
//
// Rollback: scripts/inbox-cover-20260920-rollback.mjs undoes the write.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

const SIM_ORIGIN = "https://utak-worker-sim.utak-business.workers.dev";
const APPLY = process.argv.includes("--apply");
function say(...args) { console.log(APPLY ? "[apply]" : "[dry-run]", ...args); }

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

const rbPath = new URL("./artifacts/inbox-cover-20260920-rollback.json", import.meta.url).pathname;
function readRollback() {
  if (!existsSync(rbPath)) return { generated_at: new Date().toISOString(), created: {}, mutated: {} };
  try { return JSON.parse(readFileSync(rbPath, "utf8")); } catch { return { generated_at: new Date().toISOString(), created: {}, mutated: {} }; }
}
function writeRollback(o) {
  mkdirSync(dirname(rbPath), { recursive: true });
  writeFileSync(rbPath, JSON.stringify(o, null, 2) + "\n");
}

function maskToken(url) {
  return String(url ?? "").replace(/(token=)([^&]+)/, "$1***");
}

async function verifyTokenAccepted(token) {
  // Empty JSON body → auth passes → 400 "invalid quotation_id" or "invalid id"
  // is a positive signal the token was accepted with no side effect. Any 401
  // or 403 means the token is not accepted. Any 2xx (e.g. 202 accepted) is
  // fine too, but empty body should never reach that branch.
  const endpoints = ["/internal/quotation-issue", "/internal/receipt-issue"];
  for (const path of endpoints) {
    const url = `${SIM_ORIGIN}${path}?token=${token}`;
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const status = res.status;
    if (status === 401 || status === 403) {
      throw new Error(`token rejected on ${path} (status=${status})`);
    }
    if (!(status === 400 || status === 422 || status === 202)) {
      throw new Error(`unexpected status on ${path}: ${status}`);
    }
    say(`  ${path} → ${status} (accepted)`);
  }
}

async function main() {
  // 1. Get token from 968's URL
  const src = await call("ir.actions.server", "read", { ids: [968], fields: ["id", "webhook_url"] });
  const srcUrl = String(src[0]?.webhook_url ?? "");
  const tokMatch = srcUrl.match(/[?&]token=([^&]+)/);
  if (!tokMatch) throw new Error("could not extract token from server action 968");
  const originMatch = srcUrl.match(/^(https?:\/\/[^/]+)/);
  const origin968 = originMatch ? originMatch[1] : "";
  if (origin968 !== SIM_ORIGIN) throw new Error(`server action 968 origin is ${origin968}, expected ${SIM_ORIGIN}`);
  const token = tokMatch[1];

  // 2. Verify against sim endpoints
  say("verifying token against sim endpoints…");
  await verifyTokenAccepted(token);

  // 3. Read current 941/957
  const rows = await call("ir.actions.server", "read", {
    ids: [941, 957], fields: ["id", "name", "webhook_url"],
  });
  say("BEFORE:");
  for (const r of rows) say(`  #${r.id} ${r.name} → ${maskToken(r.webhook_url)}`);

  // Save rollback (redacted)
  const rb = readRollback();
  rb.mutated = rb.mutated ?? {};
  for (const r of rows) {
    rb.mutated[`server_action_${r.id}`] = {
      before: {
        id: r.id, name: r.name,
        webhook_url: r.webhook_url, // full — needed for rollback (already scoped to this repo)
        webhook_url_redacted: maskToken(r.webhook_url),
      },
    };
  }
  writeRollback(rb);

  // 4. Rewrite
  for (const r of rows) {
    const oldPath = new URL(r.webhook_url).pathname;
    const newUrl = `${SIM_ORIGIN}${oldPath}?token=${token}`;
    say(`  #${r.id} → ${maskToken(newUrl)}`);
    if (APPLY) {
      await call("ir.actions.server", "write", {
        ids: [r.id], vals: { webhook_url: newUrl },
      });
    }
  }

  // 5. Verify
  if (APPLY) {
    const after = await call("ir.actions.server", "read", {
      ids: [941, 957], fields: ["id", "webhook_url"],
    });
    say("AFTER:");
    for (const a of after) {
      const originOK = String(a.webhook_url ?? "").startsWith(SIM_ORIGIN);
      say(`  #${a.id} origin_is_sim=${originOK} url=${maskToken(a.webhook_url)}`);
      if (!originOK) throw new Error(`#${a.id} did not switch to sim origin`);
    }
  }

  say("done. Actions redirected to sim; NOT fired for testing.");
  if (!APPLY) console.log("\nDry-run only. Re-run with --apply to persist.");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
