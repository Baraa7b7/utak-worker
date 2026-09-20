// Inbox 2026-09-20 — create the base.automation + ir.actions.server pair
// that fires the /odoo/hook/wa-inbox webhook whenever Baraa sends a Discuss
// message on a WhatsApp-inbox channel.
//
// Runs AFTER inbox-20260920-apply.mjs (the bot partner must exist) and
// AFTER the Worker has deployed to sim with the /odoo/hook/wa-inbox route.
//
// Token: reused from the existing ir.actions.server id=967 URL
// ("wa_message.send_webhook") so we do not need to print it. The sim
// worker's ODOO_HOOK_TOKEN is a single secret, so a shared value here is
// intentional.
//
// Idempotent by name (base.automation "wa_inbox.on_message" / server action
// "wa_inbox.reply_webhook").

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

const rollbackPath = new URL("./artifacts/inbox-20260920-rollback.json", import.meta.url).pathname;
function readRollback() {
  if (!existsSync(rollbackPath)) return { created: {}, mutated: {} };
  try { return JSON.parse(readFileSync(rollbackPath, "utf8")); } catch { return { created: {}, mutated: {} }; }
}
function writeRollback(json) {
  mkdirSync(dirname(rollbackPath), { recursive: true });
  writeFileSync(rollbackPath, JSON.stringify(json, null, 2) + "\n");
}

async function main() {
  const rb = readRollback();
  rb.created = rb.created ?? {};

  // 1. Bot partner id
  const bot = await call("res.partner", "search_read", {
    domain: [["name", "=", "UTAK بوت"]],
    fields: ["id"],
    limit: 1,
  });
  if (!bot.length) throw new Error("UTAK بوت partner not found — run inbox-20260920-apply.mjs first");
  const botId = bot[0].id;
  console.log(`UTAK بوت partner id=${botId}`);

  // 2. Reuse the existing ODOO_HOOK_TOKEN from server action 967's URL
  const src = await call("ir.actions.server", "read", { ids: [967], fields: ["webhook_url"] });
  const srcUrl = String(src[0]?.webhook_url ?? "");
  const tokMatch = srcUrl.match(/[?&]token=([^&]+)/);
  if (!tokMatch) throw new Error("could not extract token from server action 967");
  const originMatch = srcUrl.match(/^(https?:\/\/[^/]+)/);
  if (!originMatch) throw new Error("could not extract origin from server action 967");
  const origin = originMatch[1];
  const token = tokMatch[1];
  const webhookUrl = `${origin}/odoo/hook/wa-inbox?token=${token}`;
  console.log(`webhook target origin: ${origin}`);

  // 3. mail.message model id
  const mm = await call("ir.model", "search_read", {
    domain: [["model", "=", "mail.message"]],
    fields: ["id"],
    limit: 1,
  });
  if (!mm.length) throw new Error("ir.model row for mail.message missing");
  const mailMessageModelId = mm[0].id;

  // 4. Server action
  const existingSA = await call("ir.actions.server", "search_read", {
    domain: [["name", "=", "wa_inbox.reply_webhook"]],
    fields: ["id"],
    limit: 1,
  });
  let saId;
  if (existingSA.length > 0) {
    saId = existingSA[0].id;
    console.log(`server action exists (${saId}) — updating URL`);
    await call("ir.actions.server", "write", {
      ids: [saId],
      vals: { webhook_url: webhookUrl },
    });
  } else {
    const saCreated = await call("ir.actions.server", "create", {
      vals_list: [{
        name: "wa_inbox.reply_webhook",
        model_id: mailMessageModelId,
        state: "webhook",
        webhook_url: webhookUrl,
      }],
    });
    saId = saCreated[0];
    (rb.created.server_actions ??= []).push({ id: saId, name: "wa_inbox.reply_webhook" });
    console.log(`server action created id=${saId}`);
  }

  // 5. base.automation
  const existingBA = await call("base.automation", "search_read", {
    domain: [["name", "=", "wa_inbox.on_message"]],
    fields: ["id"],
    limit: 1,
  });
  const domainStr = JSON.stringify([
    ["model", "=", "discuss.channel"],
    ["message_type", "=", "comment"],
    ["author_id", "!=", botId],
  ]);
  if (existingBA.length > 0) {
    const baId = existingBA[0].id;
    console.log(`base.automation exists (${baId}) — updating`);
    await call("base.automation", "write", {
      ids: [baId],
      vals: {
        active: true,
        filter_domain: domainStr,
        action_server_ids: [[6, 0, [saId]]],
      },
    });
  } else {
    const baCreated = await call("base.automation", "create", {
      vals_list: [{
        name: "wa_inbox.on_message",
        model_id: mailMessageModelId,
        trigger: "on_create",
        active: true,
        filter_domain: domainStr,
        action_server_ids: [[6, 0, [saId]]],
      }],
    });
    (rb.created.automations ??= []).push({ id: baCreated[0], name: "wa_inbox.on_message" });
    console.log(`base.automation created id=${baCreated[0]}`);
  }

  writeRollback(rb);
  console.log("\nAutomation apply done.");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
