// Inbox 2026-09-20 — post-smoke cleanup.
//
// Removes:
//   * res.partner id=43 ("smoke test (+966536251307)") — created by the
//     smoke test, no external refs.
//   * discuss.channel id=5 (its inbox channel) — 0 messages after the
//     smoke test cleaned itself up.
//   * discuss.channel id=15 ("واتساب · TEMP-item3-customer") + its 1
//     mail.message (id=1933). Partner 34 (TEMP-item3-customer) is KEPT
//     because customer_rank=1 (a real customer row from item3 flows);
//     only the throwaway inbox channel is dropped.
//   * The scripts/artifacts/inbox-backfill-map.json entry that pointed
//     to mail.message 1933 is stripped so a future backfill rerun
//     does NOT think the row is already imported and skip its source.
//
// Snapshots the previous state to scripts/artifacts/inbox-20260920-cleanup-rollback.json.

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

const rbPath = new URL("./artifacts/inbox-20260920-cleanup-rollback.json", import.meta.url).pathname;
function writeSnap(o) {
  mkdirSync(dirname(rbPath), { recursive: true });
  writeFileSync(rbPath, JSON.stringify(o, null, 2) + "\n");
}
const mapPath = new URL("./artifacts/inbox-backfill-map.json", import.meta.url).pathname;
const applyRbPath = new URL("./artifacts/inbox-20260920-rollback.json", import.meta.url).pathname;

async function main() {
  const snap = { generated_at: new Date().toISOString(), before: {}, actions: [] };

  // Snapshot targets
  snap.before.partner_43 = (await call("res.partner", "read", { ids: [43], fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_channel_id", "x_wa_allowed", "customer_rank", "active"] }))[0];
  snap.before.partner_34 = (await call("res.partner", "read", { ids: [34], fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_channel_id", "customer_rank", "active"] }))[0];
  snap.before.channel_5 = (await call("discuss.channel", "read", { ids: [5], fields: ["id", "name", "channel_type", "x_wa_partner_id", "message_ids"] }))[0];
  snap.before.channel_15 = (await call("discuss.channel", "read", { ids: [15], fields: ["id", "name", "channel_type", "x_wa_partner_id", "message_ids"] }))[0];
  // Messages inside ch 15
  const msgs15 = await call("mail.message", "search_read", {
    domain: [["model", "=", "discuss.channel"], ["res_id", "=", 15]],
    fields: ["id", "author_id", "body", "date"],
  });
  snap.before.messages_ch15 = msgs15;
  console.log("snapshot saved: partner 43/34, channel 5/15, messages ch15 =", msgs15.length);

  // 1) Unlink messages in ch 5 (should be 0)
  const msgs5 = await call("mail.message", "search", {
    domain: [["model", "=", "discuss.channel"], ["res_id", "=", 5]],
  });
  if (msgs5.length > 0) {
    await call("mail.message", "unlink", { ids: msgs5 });
    snap.actions.push({ unlinked_messages_ch5: msgs5 });
    console.log(`  unlinked ${msgs5.length} mail.messages in ch 5:`, msgs5);
  }

  // 2) Unlink messages in ch 15
  const msg15Ids = msgs15.map((m) => m.id);
  if (msg15Ids.length > 0) {
    await call("mail.message", "unlink", { ids: msg15Ids });
    snap.actions.push({ unlinked_messages_ch15: msg15Ids });
    console.log(`  unlinked ${msg15Ids.length} mail.messages in ch 15:`, msg15Ids);
  }

  // 3) Clear x_wa_channel_id on partner 34, then unlink channel 15
  await call("res.partner", "write", { ids: [34], vals: { x_wa_channel_id: false } });
  snap.actions.push({ cleared_x_wa_channel_id: 34 });
  await call("discuss.channel", "unlink", { ids: [15] });
  snap.actions.push({ unlinked_channel: 15 });
  console.log("  cleared partner 34.x_wa_channel_id and unlinked channel 15");

  // 4) Unlink partner 43 (must clear its x_wa_channel_id first to avoid FK)
  await call("res.partner", "write", { ids: [43], vals: { x_wa_channel_id: false } });
  await call("discuss.channel", "unlink", { ids: [5] });
  snap.actions.push({ unlinked_channel: 5 });
  console.log("  unlinked channel 5");
  await call("res.partner", "unlink", { ids: [43] });
  snap.actions.push({ unlinked_partner: 43 });
  console.log("  unlinked partner 43");

  // 5) Prune the backfill map: drop entries where mail_message_id was in ch 15
  if (existsSync(mapPath)) {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    const before = (map.mail_messages ?? []).length;
    const dropped = (map.mail_messages ?? []).filter((r) => msg15Ids.includes(r.mail_message_id));
    map.mail_messages = (map.mail_messages ?? []).filter((r) => !msg15Ids.includes(r.mail_message_id));
    map.channels_created = (map.channels_created ?? []).filter((r) => r.channel_id !== 15);
    writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n");
    snap.actions.push({ backfill_map_pruned: { before, after: map.mail_messages.length, dropped } });
    console.log(`  backfill map: ${before} → ${map.mail_messages.length} entries (dropped ${dropped.length})`);
  }

  // 6) Also prune the apply rollback JSON: partner 43 is no longer this
  //    run's responsibility once we've unlinked it.
  if (existsSync(applyRbPath)) {
    const applyRb = JSON.parse(readFileSync(applyRbPath, "utf8"));
    if (applyRb.created?.partners) {
      const before = applyRb.created.partners.length;
      applyRb.created.partners = applyRb.created.partners.filter((p) => p.id !== 43);
      if (applyRb.created.partners.length < before) {
        writeFileSync(applyRbPath, JSON.stringify(applyRb, null, 2) + "\n");
        snap.actions.push({ apply_rollback_pruned_partner: 43 });
      }
    }
  }

  writeSnap(snap);
  console.log(`\ncleanup complete. rollback at ${rbPath}`);
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
