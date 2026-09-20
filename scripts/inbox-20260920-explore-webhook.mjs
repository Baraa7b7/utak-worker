// Probe: how to fire an outgoing webhook from a base.automation on
// mail.message (Odoo 19 SaaS shape).

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
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

// ir.actions.server: valid states
const servFields = await call("ir.actions.server", "fields_get", {
  attributes: ["type", "string", "selection"],
});
console.log("ir.actions.server.state selection:", JSON.stringify(servFields.state?.selection));
console.log("keys of interest present:", Object.keys(servFields).filter((k) => /webhook|http|url/i.test(k)));

// Sample existing webhook server action if any
const whIds = await call("ir.actions.server", "search", {
  domain: [["state", "=", "webhook"]],
  limit: 5,
});
console.log("\nwebhook action ids:", JSON.stringify(whIds));
if (whIds.length > 0) {
  const existingWH = await call("ir.actions.server", "read", {
    ids: whIds.slice(0, 1),
    fields: ["id", "name", "state", "webhook_url", "webhook_field_ids", "webhook_sample_payload"],
  });
  console.log("existing webhook server action[0]:", JSON.stringify(existingWH, null, 2));
}

// If base.automation has action_server_ids field (or url_action_id)
const baFields = await call("base.automation", "fields_get", {
  attributes: ["type", "string", "relation"],
});
console.log("\nbase.automation url/webhook fields:", Object.keys(baFields).filter((k) => /webhook|url|hook|action/i.test(k)));
const baInteresting = ["action_server_ids", "webhook_uuid", "url"];
for (const k of baInteresting) {
  if (baFields[k]) console.log(k, ":", JSON.stringify(baFields[k]));
}

// Fields on the fresh model whose type == 'binary' + attachment_ids on mail.message
const mmFields = await call("mail.message", "fields_get", { attributes: ["type", "string", "relation", "compute", "readonly"] });
console.log("\nmail.message.attachment_ids:", JSON.stringify(mmFields.attachment_ids));
console.log("mail.message.body readonly:", JSON.stringify(mmFields.body));

// discuss.channel.member custom_notifications default & 'all'
console.log("\ncustom_notifications default: (checked earlier as 'mentions' typically) — inspecting field:", JSON.stringify((await call("discuss.channel.member","fields_get",{ attributes: ["default", "selection"] })).custom_notifications ));

// Is there an existing outgoing webhook trigger on base.automation?
// Try triggering webhook by state='webhook'
const baWebhookAutos = await call("base.automation", "search_read", {
  domain: [["trigger", "=", "on_webhook"]],
  fields: ["id", "name", "model_name", "trigger"],
  limit: 3,
});
console.log("\nexisting on_webhook automations:", JSON.stringify(baWebhookAutos));

// Bonus — how are Discuss messages sent via HTTP? Check message_post signature
const mmMethods = await call("mail.message", "fields_get", { attributes: ["string"] });
// (fields_get can't reflect methods; skip)

// Sample mail.message that landed for discuss.channel — see its author_id / message_type
const sampleMM = await call("mail.message", "search_read", {
  domain: [["model", "=", "discuss.channel"]],
  fields: ["id", "model", "res_id", "message_type", "author_id", "body", "date"],
  limit: 5,
  order: "id desc",
});
console.log("\nsample mail.message on discuss.channel:", JSON.stringify(sampleMM, null, 2));
