// Inbox 2026-09-20 — read-only exploration for the WhatsApp Discuss inbox.
// Prints the answers required by section 0 of the plan (Odoo Worker user,
// discuss.channel shape, mail.message automation feasibility, Discuss action,
// voice metadata, x_wa_message direction).
//
// Everything is search_read / fields_get / read only. No writes.

import { readFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY },
    }),
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
    method: "POST",
    headers,
    body: JSON.stringify(body),
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

function section(title) {
  console.log(`\n===== ${title} =====`);
}

async function main() {
  section("A) Worker user (admin@utakfresh.com)");
  const users = await call("res.users", "search_read", {
    domain: [["login", "=", "admin@utakfresh.com"]],
    fields: ["id", "login", "name", "partner_id", "share"],
  });
  console.log(JSON.stringify(users, null, 2));

  section("B) Baraa's user candidate (name/email)");
  const baraaUsers = await call("res.users", "search_read", {
    domain: ["|", ["login", "ilike", "baraa"], ["name", "ilike", "baraa"]],
    fields: ["id", "login", "name", "partner_id", "share"],
  });
  console.log(JSON.stringify(baraaUsers, null, 2));

  section("C) discuss.channel fields (interactive)");
  const chFields = await call("discuss.channel", "fields_get", {
    attributes: ["type", "string", "required", "selection", "relation"],
  });
  const interestingChKeys = [
    "name", "channel_type", "group_public_id", "channel_partner_ids",
    "channel_member_ids", "description", "public", "avatar_128", "avatar_256",
    "image_128", "uuid", "is_member", "author_id", "message_ids",
  ];
  for (const k of interestingChKeys) {
    if (chFields[k]) console.log(k, ":", JSON.stringify(chFields[k]));
  }
  // channel_type selection
  console.log("channel_type selection:", JSON.stringify(chFields.channel_type?.selection));

  section("D) discuss.channel.member fields (mute/notification/pinned)");
  const memFields = await call("discuss.channel.member", "fields_get", {
    attributes: ["type", "string", "required", "selection"],
  });
  const memKeys = [
    "channel_id", "partner_id", "guest_id", "custom_notifications",
    "mute_until_dt", "is_pinned", "unpin_dt", "seen_message_id",
    "custom_channel_name", "message_unread_counter",
  ];
  for (const k of memKeys) {
    if (memFields[k]) console.log(k, ":", JSON.stringify(memFields[k]));
  }

  section("E) mail.message: automation candidate?");
  const mailModel = await call("ir.model", "search_read", {
    domain: [["model", "=", "mail.message"]],
    fields: ["id", "name", "model", "state", "transient"],
  });
  console.log("mail.message model row:", JSON.stringify(mailModel));
  // Does base.automation accept mail.message?
  const autoTriggerField = await call("base.automation", "fields_get", {
    attributes: ["type", "string", "selection"],
  });
  console.log("base.automation.trigger selection:", JSON.stringify(autoTriggerField.trigger?.selection));
  console.log("base.automation.model_id field:", JSON.stringify(autoTriggerField.model_id));
  // Any existing automation on mail.message?
  const existingAutos = await call("base.automation", "search_read", {
    domain: [["model_name", "=", "mail.message"]],
    fields: ["id", "name", "trigger", "active"],
  });
  console.log("existing automations on mail.message:", JSON.stringify(existingAutos));

  section("F) mail.message fields we'll need");
  const msgFields = await call("mail.message", "fields_get", {
    attributes: ["type", "string", "selection"],
  });
  const msgKeys = [
    "model", "res_id", "message_type", "author_id", "author_guest_id",
    "email_from", "body", "attachment_ids", "subject", "subtype_id",
    "date", "parent_id", "starred_partner_ids",
  ];
  for (const k of msgKeys) {
    if (msgFields[k]) console.log(k, ":", JSON.stringify(msgFields[k]));
  }

  section("G) Discuss action (menu → client action)");
  // Try Discuss main menu action
  const discussMenu = await call("ir.ui.menu", "search_read", {
    domain: [["name", "=", "Discuss"]],
    fields: ["id", "name", "action", "parent_id", "web_icon"],
  });
  console.log("Discuss root menu:", JSON.stringify(discussMenu));
  // Common Discuss action tag is 'discuss'
  const clientActions = await call("ir.actions.client", "search_read", {
    domain: ["|", ["tag", "=", "discuss"], ["tag", "=", "mail.discuss"]],
    fields: ["id", "name", "tag", "params"],
  });
  console.log("client actions (discuss tag):", JSON.stringify(clientActions));

  section("H) discuss.voice.metadata?");
  try {
    const voiceModel = await call("ir.model", "search_read", {
      domain: [["model", "=", "discuss.voice.metadata"]],
      fields: ["id", "model", "name", "transient"],
    });
    console.log("discuss.voice.metadata model:", JSON.stringify(voiceModel));
    if (voiceModel.length > 0) {
      const vf = await call("discuss.voice.metadata", "fields_get", {
        attributes: ["type", "string", "relation"],
      });
      console.log("discuss.voice.metadata fields:", JSON.stringify(vf, null, 2));
    }
  } catch (e) {
    console.log("discuss.voice.metadata probe error:", (e).message);
  }
  // fallback: does ir.attachment have a voice-marker field?
  const attFields = await call("ir.attachment", "fields_get", {
    attributes: ["type", "string"],
  });
  const attVoiceKeys = Object.keys(attFields).filter((k) => k.includes("voice"));
  console.log("ir.attachment voice-related field names:", attVoiceKeys);

  section("I) x_wa_message.x_direction present?");
  const waMsgFields = await call("x_wa_message", "fields_get", {
    attributes: ["type", "string", "selection", "required"],
  });
  console.log("x_direction:", JSON.stringify(waMsgFields.x_direction));
  console.log("x_status selection:", JSON.stringify(waMsgFields.x_status?.selection));
  console.log("x_kind selection:", JSON.stringify(waMsgFields.x_kind?.selection));

  section("J) UTAK menu 529");
  const utakMenu = await call("ir.ui.menu", "read", {
    ids: [529],
    fields: ["id", "name", "parent_id", "action", "web_icon"],
  });
  console.log("menu 529:", JSON.stringify(utakMenu));
  const childMenus = await call("ir.ui.menu", "search_read", {
    domain: [["parent_id", "=", 529]],
    fields: ["id", "name", "sequence", "action"],
    order: "sequence, id",
  });
  console.log("menu 529 children:", JSON.stringify(childMenus));

  section("K) cron 62 state");
  const c62 = await call("ir.cron", "read", {
    ids: [62],
    fields: ["id", "name", "active", "interval_number", "interval_type", "code"],
  });
  console.log("cron 62:", JSON.stringify(c62));

  section("L) discuss.channel.channel_type existing values sanity check");
  const sampleCh = await call("discuss.channel", "search_read", {
    domain: [],
    fields: ["id", "name", "channel_type", "group_public_id", "channel_member_ids"],
    limit: 5,
  });
  console.log(JSON.stringify(sampleCh, null, 2));

  section("M) Existing x_wa_message count + one sample");
  const waCount = await call("x_wa_message", "search_count", { domain: [] });
  console.log("count:", waCount);
  const sampleWa = await call("x_wa_message", "search_read", {
    domain: [],
    fields: ["id", "x_partner_id", "x_direction", "x_kind", "x_body", "x_status", "create_date"],
    limit: 3,
    order: "id desc",
  });
  console.log(JSON.stringify(sampleWa, null, 2));

  section("N) x_message_analysis (backfill source)");
  try {
    const anaFields = await call("x_message_analysis", "fields_get", {
      attributes: ["type", "string"],
    });
    console.log("fields:", Object.keys(anaFields).filter((k) => k.startsWith("x_")).join(", "));
    const count = await call("x_message_analysis", "search_count", { domain: [] });
    console.log("count:", count);
    const sample = await call("x_message_analysis", "search_read", {
      domain: [],
      fields: Object.keys(anaFields).filter((k) => k.startsWith("x_")).slice(0, 12).concat(["id", "create_date"]),
      limit: 2,
      order: "id desc",
    });
    console.log(JSON.stringify(sample, null, 2));
  } catch (e) {
    console.log("x_message_analysis error:", (e).message);
  }

  section("O) res.partner sample for +966536251307 & owner");
  const testPartner = await call("res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "ilike", "536251307"], ["phone", "ilike", "536251307"]],
    fields: ["id", "name", "x_whatsapp_number", "phone", "x_wa_allowed"],
  });
  console.log("test partner:", JSON.stringify(testPartner));
  const ownerPartner = await call("res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "ilike", "505154962"], ["phone", "ilike", "505154962"]],
    fields: ["id", "name", "x_whatsapp_number", "phone", "x_wa_allowed"],
  });
  console.log("owner partner:", JSON.stringify(ownerPartner));

  section("P) Existing UTAK-related fields on discuss.channel/res.partner (custom)");
  const chCustom = Object.keys(chFields).filter((k) => k.startsWith("x_"));
  console.log("discuss.channel x_ fields:", chCustom);
  const partnerFields = await call("res.partner", "fields_get", {
    attributes: ["type", "string", "relation"],
  });
  const pCustom = Object.keys(partnerFields).filter((k) => k.startsWith("x_"));
  console.log("res.partner x_ fields:", pCustom);

  section("Q) Existing ir.actions/menus around WhatsApp/inbox");
  const waMenus = await call("ir.ui.menu", "search_read", {
    domain: [["name", "ilike", "واتساب"]],
    fields: ["id", "name", "parent_id"],
  });
  console.log("menus containing 'واتساب':", JSON.stringify(waMenus));

  console.log("\nDone — no writes performed.");
}

main().catch((e) => {
  console.error("[fatal]", (e).stack ?? (e).message ?? e);
  process.exit(1);
});
