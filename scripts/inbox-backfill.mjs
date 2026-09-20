// Inbox backfill (2026-09-20) — mirror the full historical conversation
// (x_wa_message + x_message_analysis) into per-partner Discuss channels so
// the WhatsApp inbox starts with real context on day one.
//
// Idempotent by scripts/artifacts/inbox-backfill-map.json: every produced
// mail.message and created channel is recorded there, and reruns skip
// anything already present.
//
// Defaults to dry-run. Pass --apply to actually write.
//
// Filters:
//   * Owner partner (+966505154962) is always skipped.
//   * A source row without a resolvable partner is skipped with a warning.
//   * x_wa_message with x_direction=false is treated as 'out' per plan §6.
//
// No Meta send is triggered — every author is either UTAK بوت (for outbound
// rows) or the source partner (for inbound rows), so the base.automation
// filter never sees an internal user and never fires.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

const OWNER_DIGITS = "966505154962";

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

const mapPath = new URL("./artifacts/inbox-backfill-map.json", import.meta.url).pathname;
function readMap() {
  if (!existsSync(mapPath)) return { generated_at: new Date().toISOString(), channels_created: [], mail_messages: [] };
  try { return JSON.parse(readFileSync(mapPath, "utf8")); } catch { return { generated_at: new Date().toISOString(), channels_created: [], mail_messages: [] }; }
}
function writeMap(m) {
  mkdirSync(dirname(mapPath), { recursive: true });
  writeFileSync(mapPath, JSON.stringify(m, null, 2) + "\n");
}

const state = readMap();
state.channels_created = state.channels_created ?? [];
state.mail_messages = state.mail_messages ?? [];
const seenKey = new Set(state.mail_messages.map((r) => `${r.source_model}#${r.source_id}`));
const partnerChannelCache = new Map();
for (const r of state.channels_created) partnerChannelCache.set(r.partner_id, r.channel_id);

async function resolveBotPartnerId() {
  const rows = await call("res.partner", "search_read", {
    domain: [["name", "=", "UTAK بوت"]],
    fields: ["id"],
    limit: 1,
  });
  if (!rows.length) throw new Error("UTAK بوت partner missing — run inbox-20260920-apply.mjs first");
  return rows[0].id;
}
async function resolveBaraaPartnerId() {
  const rows = await call("res.users", "search_read", {
    domain: [["login", "=", ODOO_LOGIN]],
    fields: ["id", "partner_id"],
    limit: 1,
  });
  if (!rows.length || !rows[0].partner_id) throw new Error("baraa partner missing");
  return rows[0].partner_id[0];
}

async function ensureChannel(partnerId, partnerName, baraaId) {
  if (partnerChannelCache.has(partnerId)) return partnerChannelCache.get(partnerId);
  // Check existing link
  const rows = await call("res.partner", "read", { ids: [partnerId], fields: ["id", "x_wa_channel_id"] });
  const link = rows[0]?.x_wa_channel_id;
  if (link && Array.isArray(link) && typeof link[0] === "number") {
    partnerChannelCache.set(partnerId, link[0]);
    return link[0];
  }
  const displayName = (partnerName ?? "").trim() || `#${partnerId}`;
  console.log(`  create channel for partner ${partnerId} (${displayName})`);
  if (!APPLY) {
    partnerChannelCache.set(partnerId, -1); // dry-run sentinel
    return -1;
  }
  const created = await call("discuss.channel", "create", {
    vals_list: [{
      name: `واتساب · ${displayName}`,
      channel_type: "group",
      x_wa_partner_id: partnerId,
    }],
  });
  const channelId = created[0];
  try {
    await call("discuss.channel.member", "create", {
      vals_list: [{
        channel_id: channelId,
        partner_id: baraaId,
        custom_notifications: "all",
      }],
    });
  } catch (e) {
    console.warn(`  member create failed: ${e.message}`);
  }
  try {
    await call("res.partner", "write", { ids: [partnerId], vals: { x_wa_channel_id: channelId } });
  } catch (e) {
    console.warn(`  set x_wa_channel_id failed: ${e.message}`);
  }
  state.channels_created.push({ partner_id: partnerId, channel_id: channelId });
  partnerChannelCache.set(partnerId, channelId);
  return channelId;
}

function htmlEscape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function textToHtml(text) {
  return `<p>${htmlEscape(text).replace(/\n/g, "<br/>")}</p>`;
}

// Odoo datetime format: 'YYYY-MM-DD HH:MM:SS'
function toOdooDate(s) {
  if (!s) return null;
  // create_date and x_created_at are already 'YYYY-MM-DD HH:MM:SS'
  return String(s).slice(0, 19).replace("T", " ");
}

async function createMailMessage(vals) {
  if (!APPLY) return -1;
  // Odoo SaaS rate-limits create bursts; 400ms/call keeps us well under the wall
  // even during a warm run (the earlier 150ms tripped 429 mid-run).
  await new Promise((r) => setTimeout(r, 400));
  const ids = await call("mail.message", "create", { vals_list: [vals] });
  return ids[0];
}

// Persist the map after every N rows so a mid-run 429 does not lose ground.
function persistIf(counter, everyN = 5) {
  if (APPLY && counter % everyN === 0) writeMap(state);
}

async function main() {
  const botId = await resolveBotPartnerId();
  const baraaId = await resolveBaraaPartnerId();
  console.log(`bot=${botId} baraa=${baraaId} apply=${APPLY}`);

  // --- x_wa_message ---
  console.log("\n[1] x_wa_message");
  const waRows = await call("x_wa_message", "search_read", {
    domain: [],
    fields: ["id", "x_partner_id", "x_direction", "x_kind", "x_body", "x_status", "x_processed_at", "x_meta_message_id", "create_date"],
    order: "create_date asc",
  });
  console.log(`  fetched ${waRows.length} rows`);
  const wStats = { total: 0, skipped: 0, imported: 0, byPartner: new Map() };
  for (const r of waRows) {
    wStats.total++;
    const key = `x_wa_message#${r.id}`;
    if (seenKey.has(key)) { wStats.skipped++; continue; }
    const partnerRef = r.x_partner_id;
    if (!partnerRef || !Array.isArray(partnerRef)) { console.warn(`  skip x_wa_message ${r.id}: no partner`); wStats.skipped++; continue; }
    const partnerId = partnerRef[0];
    const partnerName = partnerRef[1] || `#${partnerId}`;

    // owner filter
    try {
      const pRow = await call("res.partner", "read", { ids: [partnerId], fields: ["phone", "x_whatsapp_number"] });
      const digits = String(pRow[0]?.x_whatsapp_number || pRow[0]?.phone || "").replace(/[^0-9]/g, "");
      if (digits === OWNER_DIGITS) { console.log(`  skip x_wa_message ${r.id}: owner partner`); wStats.skipped++; continue; }
    } catch { /* ignore */ }

    const direction = r.x_direction || "out";
    const author = direction === "in" ? partnerId : botId;
    const body = r.x_body ? textToHtml(r.x_body) : `<p>[${r.x_kind || "text"}]</p>`;
    const dateStr = toOdooDate(r.x_processed_at || r.create_date);

    const channelId = await ensureChannel(partnerId, partnerName, baraaId);
    if (channelId < 0 && APPLY) { wStats.skipped++; continue; }
    const vals = {
      model: "discuss.channel",
      res_id: channelId,
      message_type: "comment",
      author_id: author,
      body,
    };
    if (dateStr) vals.date = dateStr;
    const mmId = await createMailMessage(vals);
    state.mail_messages.push({
      source_model: "x_wa_message",
      source_id: r.id,
      mail_message_id: mmId,
      partner_id: partnerId,
      direction,
    });
    seenKey.add(key);
    wStats.imported++;
    wStats.byPartner.set(partnerId, (wStats.byPartner.get(partnerId) ?? 0) + 1);
    persistIf(wStats.imported);
  }

  // --- x_message_analysis ---
  console.log("\n[2] x_message_analysis");
  const anaRows = await call("x_message_analysis", "search_read", {
    domain: [],
    fields: ["id", "x_customer_id", "x_message_text", "x_created_at", "create_date"],
    order: "x_created_at asc, id asc",
  });
  console.log(`  fetched ${anaRows.length} rows`);
  const aStats = { total: 0, skipped: 0, imported: 0, byPartner: new Map() };
  for (const r of anaRows) {
    aStats.total++;
    const key = `x_message_analysis#${r.id}`;
    if (seenKey.has(key)) { aStats.skipped++; continue; }
    const partnerRef = r.x_customer_id;
    if (!partnerRef || !Array.isArray(partnerRef)) { console.warn(`  skip x_message_analysis ${r.id}: no partner`); aStats.skipped++; continue; }
    const partnerId = partnerRef[0];
    const partnerName = partnerRef[1] || `#${partnerId}`;

    try {
      const pRow = await call("res.partner", "read", { ids: [partnerId], fields: ["phone", "x_whatsapp_number"] });
      const digits = String(pRow[0]?.x_whatsapp_number || pRow[0]?.phone || "").replace(/[^0-9]/g, "");
      if (digits === OWNER_DIGITS) { console.log(`  skip x_message_analysis ${r.id}: owner`); aStats.skipped++; continue; }
    } catch { /* ignore */ }

    const body = r.x_message_text ? textToHtml(r.x_message_text) : "<p>[رسالة فارغة]</p>";
    const dateStr = toOdooDate(r.x_created_at || r.create_date);

    const channelId = await ensureChannel(partnerId, partnerName, baraaId);
    if (channelId < 0 && APPLY) { aStats.skipped++; continue; }
    const vals = {
      model: "discuss.channel",
      res_id: channelId,
      message_type: "comment",
      author_id: partnerId,
      body,
    };
    if (dateStr) vals.date = dateStr;
    const mmId = await createMailMessage(vals);
    state.mail_messages.push({
      source_model: "x_message_analysis",
      source_id: r.id,
      mail_message_id: mmId,
      partner_id: partnerId,
      direction: "in",
    });
    seenKey.add(key);
    aStats.imported++;
    aStats.byPartner.set(partnerId, (aStats.byPartner.get(partnerId) ?? 0) + 1);
    persistIf(aStats.imported);
  }

  if (APPLY) writeMap(state);
  else console.log("\n(dry-run — no file written)");

  // Report
  console.log("\n=== SUMMARY ===");
  console.log(`x_wa_message      total=${wStats.total} imported=${wStats.imported} skipped=${wStats.skipped}`);
  for (const [pid, n] of wStats.byPartner) console.log(`  partner ${pid}: ${n}`);
  console.log(`x_message_analysis total=${aStats.total} imported=${aStats.imported} skipped=${aStats.skipped}`);
  for (const [pid, n] of aStats.byPartner) console.log(`  partner ${pid}: ${n}`);
  const total = new Map();
  for (const [pid, n] of wStats.byPartner) total.set(pid, (total.get(pid) ?? 0) + n);
  for (const [pid, n] of aStats.byPartner) total.set(pid, (total.get(pid) ?? 0) + n);
  console.log("\nMessages per partner (combined):");
  for (const [pid, n] of total) console.log(`  partner ${pid}: ${n}`);
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
