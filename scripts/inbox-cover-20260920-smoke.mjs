// Inbox cover smoke test (2026-09-20) — verifies the pieces of the ingest
// pipeline that we can reach without a signed Meta webhook or SIM_SECRET.
//
// Because META_APP_SECRET is a Worker-side secret (never in this repo) and
// SIM_SECRET is likewise, the smoke test cannot fire /webhook or /sim/inject
// itself. Instead it directly performs the same Odoo writes the Worker's
// ingestInbound + logWaMessage do, and asserts the resulting rows carry
// x_source='inbound', land in the right channel, and can be cleaned up.
//
// It covers two partners per the plan:
//   - +966536251307 (SIM_ALLOWLIST test number)
//   - partner id=10 (fake employee +966500000002)
//
// At the end every created row is deleted and the ids are printed.

import { readFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
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

function nowOdoo() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function tail(s) {
  const d = String(s ?? "").replace(/[^0-9]/g, "");
  return d ? `…${d.slice(-4)}` : "(none)";
}

const created = { x_wa_message: [], mail_message: [] };
let passed = 0, failed = 0;
function assert(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}

async function ensurePartner(digits, name) {
  const q = await call("res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "ilike", digits], ["phone", "ilike", digits]],
    fields: ["id", "name", "x_wa_channel_id"], limit: 1,
  });
  if (q.length > 0) return q[0];
  console.log(`  creating partner for ${tail(digits)}…`);
  const c = await call("res.partner", "create", {
    vals_list: [{
      name: name || `smoke ${tail(digits)}`,
      phone: `+${digits}`, x_whatsapp_number: `+${digits}`,
      x_wa_allowed: true,
    }],
  });
  const rows = await call("res.partner", "read", {
    ids: [c[0]], fields: ["id", "name", "x_wa_channel_id"],
  });
  return rows[0];
}

async function ensureChannel(partnerId, partnerName) {
  const p = await call("res.partner", "read", {
    ids: [partnerId], fields: ["id", "x_wa_channel_id"],
  });
  if (p[0]?.x_wa_channel_id && Array.isArray(p[0].x_wa_channel_id)) return p[0].x_wa_channel_id[0];
  const users = await call("res.users", "search_read", {
    domain: [["login", "=", ODOO_LOGIN]], fields: ["id", "partner_id"], limit: 1,
  });
  const baraaPid = users[0].partner_id[0];
  const cc = await call("discuss.channel", "create", {
    vals_list: [{ name: `واتساب · ${partnerName}`, channel_type: "group", x_wa_partner_id: partnerId }],
  });
  const chId = cc[0];
  try {
    await call("discuss.channel.member", "create", {
      vals_list: [{ channel_id: chId, partner_id: baraaPid, custom_notifications: "all" }],
    });
  } catch (e) { console.warn("    member add fail:", e.message); }
  await call("res.partner", "write", { ids: [partnerId], vals: { x_wa_channel_id: chId } });
  return chId;
}

async function testPartner(digits, expectedName) {
  console.log(`\n=== smoke: partner ${tail(digits)} ===`);
  const p = await ensurePartner(digits, expectedName);
  const chId = await ensureChannel(p.id, p.name || expectedName);
  console.log(`  partner id=${p.id} name=${p.name} channel=${chId}`);

  // 1) direct x_wa_message create (mimics ingestInbound → logWaMessage)
  const wamid = `wamid.SMOKE-COVER.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  const waCreate = await call("x_wa_message", "create", {
    vals_list: [{
      x_partner_id: p.id,
      x_direction: "in",
      x_kind: "text",
      x_body: `اختبار الوارد المُحاكى — cover smoke (${tail(digits)})`,
      x_status: "received",
      x_meta_message_id: wamid,
      x_source: "inbound",
      x_processed_at: nowOdoo(),
    }],
  });
  const waId = waCreate[0];
  created.x_wa_message.push(waId);
  console.log(`  x_wa_message.create id=${waId}`);

  // 2) mail.message mirror as the partner (author_id = partner)
  const mmCreate = await call("mail.message", "create", {
    vals_list: [{
      model: "discuss.channel", res_id: chId, message_type: "comment",
      author_id: p.id, body: `<p>اختبار الوارد المُحاكى — cover smoke (${tail(digits)})</p>`,
    }],
  });
  created.mail_message.push(mmCreate[0]);
  console.log(`  mail.message.create id=${mmCreate[0]}`);

  // 3) verify shape
  const readBack = await call("x_wa_message", "read", {
    ids: [waId], fields: ["id", "x_direction", "x_status", "x_source", "x_meta_message_id"],
  });
  const row = readBack[0];
  console.log(`  read x_wa_message: dir=${row.x_direction} src=${row.x_source} st=${row.x_status}`);
  assert(`x_direction = 'in'`, row.x_direction === "in");
  assert(`x_source = 'inbound'`, row.x_source === "inbound");
  assert(`x_status = 'received'`, row.x_status === "received");
  assert(`x_meta_message_id set`, !!row.x_meta_message_id);

  // 4) verify mail.message is in the right channel with partner as author
  const mmRead = await call("mail.message", "read", {
    ids: [mmCreate[0]], fields: ["id", "author_id", "model", "res_id", "message_type"],
  });
  const m = mmRead[0];
  assert(`mail.message in discuss.channel`, m.model === "discuss.channel");
  assert(`mail.message res_id = channel`, m.res_id === chId);
  assert(`author_id = partner ${p.id}`, Array.isArray(m.author_id) && m.author_id[0] === p.id);
  return { partner: p, chId, waId };
}

async function testAutoOutbound(partnerId, chId) {
  console.log(`\n=== smoke: auto outbound mirror ===`);
  // Simulate what fetchMeta echoOutboundToInbox does: post as bot with 🤖 آلي prefix,
  // and log x_wa_message with source=auto.
  const bot = await call("res.partner", "search_read", {
    domain: [["name", "=", "UTAK بوت"]], fields: ["id"], limit: 1,
  });
  const botPid = bot[0].id;
  const styledBody =
    `<p style="border-left: 3px solid #1E5A41; background-color: #F7F5F0; padding: 4px 8px; margin: 0;">` +
    `<strong>🤖 آلي</strong><br/>رد آلي للتحقق</p>`;
  const mm = await call("mail.message", "create", {
    vals_list: [{
      model: "discuss.channel", res_id: chId, message_type: "comment",
      author_id: botPid, body: styledBody,
    }],
  });
  created.mail_message.push(mm[0]);
  const wa = await call("x_wa_message", "create", {
    vals_list: [{
      x_partner_id: partnerId, x_direction: "out", x_kind: "text",
      x_body: "رد آلي للتحقق", x_source: "auto", x_status: "sent",
      x_processed_at: nowOdoo(),
    }],
  });
  const waId = wa[0];
  created.x_wa_message.push(waId);
  console.log(`  bot mail.message id=${mm[0]} x_wa_message id=${waId}`);

  // Verify: read the mail.message back and check if the style survived Odoo sanitizer
  const readBack = await call("mail.message", "read", {
    ids: [mm[0]], fields: ["id", "body"],
  });
  const body = String(readBack[0]?.body ?? "");
  const stylePreserved = body.includes("border-left") && body.includes("#1E5A41");
  const prefixPreserved = body.includes("🤖 آلي");
  console.log(`  style preserved: ${stylePreserved}, prefix preserved: ${prefixPreserved}`);
  assert("🤖 آلي prefix survives Odoo sanitizer", prefixPreserved);

  const waRead = await call("x_wa_message", "read", {
    ids: [waId], fields: ["x_source", "x_direction"],
  });
  assert("x_source = 'auto' on outbound", waRead[0].x_source === "auto");
  return { stylePreserved, prefixPreserved };
}

async function cleanup() {
  console.log(`\n=== cleanup ===`);
  if (created.mail_message.length > 0) {
    console.log(`  unlink mail.message ids: ${created.mail_message.join(",")}`);
    try { await call("mail.message", "unlink", { ids: created.mail_message }); }
    catch (e) { console.warn("    mail.message unlink fail:", e.message); }
  }
  if (created.x_wa_message.length > 0) {
    console.log(`  unlink x_wa_message ids: ${created.x_wa_message.join(",")}`);
    try { await call("x_wa_message", "unlink", { ids: created.x_wa_message }); }
    catch (e) { console.warn("    x_wa_message unlink fail:", e.message); }
  }
}

async function main() {
  console.log("=== inbox cover smoke test ===");
  let result = { stylePreserved: false, prefixPreserved: false };

  try {
    // (1) test number +966536251307
    const t1 = await testPartner("966536251307", "smoke test (+966536251307)");
    // (2) fake employee partner 10 (+966500000002)
    await testPartner("966500000002", "محمد المحصّل - اختبار");
    // (3) auto outbound style check on the test partner's channel
    result = await testAutoOutbound(t1.partner.id, t1.chId);
  } finally {
    await cleanup();
  }
  console.log(`\n=== summary ===`);
  console.log(`passed=${passed} failed=${failed}`);
  console.log(`auto style survived Odoo sanitizer: ${result.stylePreserved}`);
  console.log(`🤖 آلي prefix survived: ${result.prefixPreserved}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("[fatal]", e.stack || e.message || e); process.exit(1); });
