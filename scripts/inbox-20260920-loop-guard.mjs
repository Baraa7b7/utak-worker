// Inbox 2026-09-20 — loop-prevention proof.
//
// Creates one mail.message inside a real inbox channel with author_id =
// UTAK بوت (42). Since the automation domain excludes author_id=42, no
// webhook fires; and even if one did, evaluateInboxReplyMessage would
// reject it with skip="author is bot". Either way, no new outbound
// x_wa_message row should appear.
//
// Uses the existing channel 14 (partner 30 — أحمد حسان) because it is a
// real customer inbox with prior traffic. Cleans up its own mail.message
// after verifying the counters.

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

const TARGET_CHANNEL = 14;
const BOT_PARTNER = 42;
const TARGET_PARTNER = 30;

async function main() {
  // Baseline count of outbound x_wa_message rows for partner 30
  const beforeOut = await call("x_wa_message", "search_count", {
    domain: [["x_partner_id", "=", TARGET_PARTNER], ["x_direction", "=", "out"]],
  });
  const beforeMax = await call("mail.message", "search_read", {
    domain: [["model", "=", "discuss.channel"], ["res_id", "=", TARGET_CHANNEL]],
    fields: ["id"], order: "id desc", limit: 1,
  });
  const beforeMaxId = beforeMax[0]?.id ?? 0;
  console.log(`baseline: partner ${TARGET_PARTNER} out x_wa_message count = ${beforeOut}, max mail.message id in ch ${TARGET_CHANNEL} = ${beforeMaxId}`);

  // Post as UTAK بوت
  const created = await call("mail.message", "create", {
    vals_list: [{
      model: "discuss.channel",
      res_id: TARGET_CHANNEL,
      message_type: "comment",
      author_id: BOT_PARTNER,
      body: "<p>loop-guard test — this is a bot message; no send must fire.</p>",
    }],
  });
  const botMsgId = created[0];
  console.log(`created bot mail.message id=${botMsgId}`);

  // Wait for the webhook to have fired (or NOT fired, in the good case).
  console.log("waiting 15s for any webhook side-effects…");
  await new Promise((r) => setTimeout(r, 15000));

  // Re-check counters
  const afterOut = await call("x_wa_message", "search_count", {
    domain: [["x_partner_id", "=", TARGET_PARTNER], ["x_direction", "=", "out"]],
  });
  const newMessages = await call("mail.message", "search_read", {
    domain: [["model", "=", "discuss.channel"], ["res_id", "=", TARGET_CHANNEL], ["id", ">", beforeMaxId]],
    fields: ["id", "author_id", "body"],
    order: "id asc",
  });
  console.log(`\nafter: partner ${TARGET_PARTNER} out x_wa_message count = ${afterOut}`);
  console.log(`new mail.message rows in ch ${TARGET_CHANNEL}:`);
  for (const m of newMessages) console.log(`  #${m.id} author=${JSON.stringify(m.author_id)} body: ${String(m.body).slice(0, 80)}`);

  // Cleanup
  await call("mail.message", "unlink", { ids: [botMsgId] });
  console.log(`\ncleaned up ${botMsgId}`);

  // Verdict
  const diff = afterOut - beforeOut;
  const onlyOursNew =
    newMessages.length === 1 && newMessages[0].id === botMsgId;
  console.log("\n=== VERDICT ===");
  console.log(`  new outbound x_wa_message rows: ${diff} (expected 0)`);
  console.log(`  only our test message in channel: ${onlyOursNew} (expected true)`);
  if (diff === 0 && onlyOursNew) {
    console.log("  ✓ loop prevention CONFIRMED — bot message did not trigger a send");
  } else {
    console.log("  ✗ loop prevention FAILED — inspect the extras above");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
