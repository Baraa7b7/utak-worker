// Inbox 2026-09-20 — schema and setup writes for the WhatsApp Discuss inbox.
//
// Order:
//   1. Snapshot the current state of the moving pieces to a rollback JSON
//      at scripts/artifacts/inbox-20260920-rollback.json.
//   2. Create field x_wa_channel_id on res.partner (m2o → discuss.channel).
//   3. Create field x_wa_partner_id on discuss.channel (m2o → res.partner).
//   4. Create res.partner "UTAK بوت" (no user, no phone, image = menu 529 icon).
//   5. Create menu "💬 المحادثات" under UTAK menu 529 (sequence 5, action = Discuss client action 110).
//   6. Set cron 62 (WhatsApp : Send In Queue Messages) active = false.
//
// Idempotent by name lookup: reruns skip anything already present.
// The base.automation on mail.message is created by
// inbox-20260920-apply-automation.mjs AFTER the Worker deploys the
// /odoo/hook/wa-inbox route.

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
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    if (res.status === 401 && auth.mode === "apikey") {
      await session();
      return call(model, method, body);
    }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const rollbackPath = new URL("./artifacts/inbox-20260920-rollback.json", import.meta.url).pathname;

function readRollback() {
  if (!existsSync(rollbackPath)) return { generated_at: new Date().toISOString(), created: {}, mutated: {} };
  try { return JSON.parse(readFileSync(rollbackPath, "utf8")); } catch { return { generated_at: new Date().toISOString(), created: {}, mutated: {} }; }
}
function writeRollback(json) {
  mkdirSync(dirname(rollbackPath), { recursive: true });
  writeFileSync(rollbackPath, JSON.stringify(json, null, 2) + "\n");
}

async function ensureField({ modelName, fieldName, string, relation, ttype, onDelete }) {
  const existing = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", modelName], ["name", "=", fieldName]],
    fields: ["id", "name", "state"],
    limit: 1,
  });
  if (existing.length > 0) {
    console.log(`  field ${modelName}.${fieldName} exists (id=${existing[0].id}) — skip`);
    return { id: existing[0].id, created: false };
  }
  const modelRow = await call("ir.model", "search_read", {
    domain: [["model", "=", modelName]],
    fields: ["id"],
    limit: 1,
  });
  if (!modelRow.length) throw new Error(`ir.model row not found for ${modelName}`);
  const vals = {
    name: fieldName,
    field_description: string,
    model_id: modelRow[0].id,
    model: modelName,
    ttype,
    state: "manual",
  };
  if (ttype === "many2one") {
    vals.relation = relation;
    vals.on_delete = onDelete ?? "set null";
  }
  const ids = await call("ir.model.fields", "create", { vals_list: [vals] });
  console.log(`  created ${modelName}.${fieldName} → id=${ids[0]}`);
  return { id: ids[0], created: true };
}

async function main() {
  console.log("inbox-20260920 apply — start");

  // ------ 1. Snapshot ------
  const rollback = readRollback();
  rollback.generated_at = rollback.generated_at ?? new Date().toISOString();
  rollback.created = rollback.created ?? {};
  rollback.mutated = rollback.mutated ?? {};

  // Snapshot cron 62 BEFORE any changes
  const cron62Before = await call("ir.cron", "read", {
    ids: [62],
    fields: ["id", "name", "active"],
  });
  if (!rollback.mutated.cron_62) rollback.mutated.cron_62 = { before: cron62Before[0] };
  console.log(`  snapshot cron 62 active=${cron62Before[0].active}`);

  // ------ 2. Field: res.partner.x_wa_channel_id ------
  console.log("[2] creating x_wa_channel_id on res.partner");
  const f1 = await ensureField({
    modelName: "res.partner",
    fieldName: "x_wa_channel_id",
    string: "محادثة واتساب",
    relation: "discuss.channel",
    ttype: "many2one",
    onDelete: "set null",
  });
  if (f1.created) (rollback.created.fields ??= []).push({ id: f1.id, model: "res.partner", name: "x_wa_channel_id" });

  // ------ 3. Field: discuss.channel.x_wa_partner_id ------
  console.log("[3] creating x_wa_partner_id on discuss.channel");
  const f2 = await ensureField({
    modelName: "discuss.channel",
    fieldName: "x_wa_partner_id",
    string: "جهة الواتساب",
    relation: "res.partner",
    ttype: "many2one",
    onDelete: "set null",
  });
  if (f2.created) (rollback.created.fields ??= []).push({ id: f2.id, model: "discuss.channel", name: "x_wa_partner_id" });

  // ------ 4. UTAK بوت partner ------
  console.log("[4] creating UTAK بوت partner");
  const existingBot = await call("res.partner", "search_read", {
    domain: [["name", "=", "UTAK بوت"]],
    fields: ["id"],
    limit: 1,
  });
  let botId;
  if (existingBot.length > 0) {
    botId = existingBot[0].id;
    console.log(`  UTAK بوت exists — id=${botId}`);
  } else {
    // Copy the UTAK menu icon (menu 529 web_icon_data) to the bot's image_128
    const menu529 = await call("ir.ui.menu", "read", { ids: [529], fields: ["web_icon_data"] });
    const iconB64 = menu529[0]?.web_icon_data || false;
    const created = await call("res.partner", "create", {
      vals_list: [{
        name: "UTAK بوت",
        image_1920: iconB64, // sets 1920/1024/512/256/128 downscales automatically
        active: true,
      }],
    });
    botId = created[0];
    console.log(`  created UTAK بوت → id=${botId}`);
    (rollback.created.partners ??= []).push({ id: botId, name: "UTAK بوت" });
  }
  rollback.utak_bot_partner_id = botId;

  // ------ 5. Menu "💬 المحادثات" under 529 ------
  console.log("[5] creating menu 💬 المحادثات");
  const existingMenu = await call("ir.ui.menu", "search_read", {
    domain: [["name", "=", "💬 المحادثات"], ["parent_id", "=", 529]],
    fields: ["id", "name"],
    limit: 1,
  });
  let menuId;
  if (existingMenu.length > 0) {
    menuId = existingMenu[0].id;
    console.log(`  menu exists — id=${menuId}`);
  } else {
    // Point at the Discuss client action, id 110
    const created = await call("ir.ui.menu", "create", {
      vals_list: [{
        name: "💬 المحادثات",
        parent_id: 529,
        sequence: 5,
        action: "ir.actions.client,110",
      }],
    });
    menuId = created[0];
    console.log(`  created menu → id=${menuId}`);
    (rollback.created.menus ??= []).push({ id: menuId, name: "💬 المحادثات", parent_id: 529 });
  }

  // ------ 6. Cron 62 off ------
  console.log("[6] disabling cron 62");
  if (cron62Before[0].active === true) {
    await call("ir.cron", "write", { ids: [62], vals: { active: false } });
    rollback.mutated.cron_62.applied_at = new Date().toISOString();
    rollback.mutated.cron_62.after = { active: false };
    console.log("  cron 62 → active=false");
  } else {
    console.log("  cron 62 already inactive — skip");
  }

  writeRollback(rollback);
  console.log(`\nDone. Rollback JSON at ${rollbackPath}`);
  console.log("Bot partner id:", botId);
  console.log("Menu id:", menuId);
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
