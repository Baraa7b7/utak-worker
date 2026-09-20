// Inbox smoke test (2026-09-20) — end-to-end without going through Meta.
//
// Verifies the parts we can automate:
//   1) Ensure a res.partner for +966536251307 exists (create it if new).
//   2) Ensure the Discuss channel exists via the same rules the Worker uses.
//   3) Simulate an inbound (mirror + x_wa_message direction=in).
//   4) Simulate Baraa's reply from Discuss by creating a mail.message with
//      author_id = Baraa's partner. If the automation is wired correctly,
//      Odoo fires the /odoo/hook/wa-inbox webhook; we poll x_wa_message for
//      the resulting outbound row.
//   5) Clean up: unlink the mail.message + x_wa_message rows we created,
//      plus the smoke channel (unless it existed before).
//
// The reply *actually sends* through Meta because sim = pilot mode; that
// is intentional and permitted for +966536251307 by the plan.

import { readFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

const TEST_PHONE = "+966536251307";
const TEST_DIGITS = "966536251307";
const OWNER_PHONE = "+966505154962";

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

function nowOdoo() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function main() {
  console.log("=== inbox smoke test ===");
  const state = { created: {} };

  // Baraa
  const baraa = await call("res.users", "search_read", {
    domain: [["login", "=", ODOO_LOGIN]],
    fields: ["id", "partner_id"],
    limit: 1,
  });
  const baraaPid = baraa[0].partner_id[0];
  console.log(`Baraa partner id=${baraaPid}`);

  // Bot
  const bot = await call("res.partner", "search_read", {
    domain: [["name", "=", "UTAK بوت"]],
    fields: ["id"],
    limit: 1,
  });
  const botPid = bot[0].id;
  console.log(`UTAK بوت partner id=${botPid}`);

  // Step 1: partner for test phone
  const existingP = await call("res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "ilike", TEST_DIGITS], ["phone", "ilike", TEST_DIGITS]],
    fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_allowed", "x_wa_channel_id"],
    limit: 1,
  });
  let partner;
  if (existingP.length > 0) {
    partner = existingP[0];
    console.log(`test partner exists id=${partner.id} name=${partner.name}`);
  } else {
    const created = await call("res.partner", "create", {
      vals_list: [{
        name: "smoke test (+966536251307)",
        phone: TEST_PHONE,
        x_whatsapp_number: TEST_PHONE,
        x_wa_allowed: true,
      }],
    });
    partner = (await call("res.partner", "read", {
      ids: [created[0]],
      fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_allowed", "x_wa_channel_id"],
    }))[0];
    state.created.testPartner = partner.id;
    console.log(`created test partner id=${partner.id}`);
  }
  const partnerPid = partner.id;

  // Step 2: channel
  let channelId;
  if (partner.x_wa_channel_id && Array.isArray(partner.x_wa_channel_id)) {
    channelId = partner.x_wa_channel_id[0];
    console.log(`channel exists id=${channelId}`);
  } else {
    const created = await call("discuss.channel", "create", {
      vals_list: [{
        name: `واتساب · ${partner.name}`,
        channel_type: "group",
        x_wa_partner_id: partnerPid,
      }],
    });
    channelId = created[0];
    state.created.channel = channelId;
    console.log(`created channel id=${channelId}`);
    // Add Baraa as a member (custom_notifications=all so he gets mobile pings)
    try {
      await call("discuss.channel.member", "create", {
        vals_list: [{
          channel_id: channelId,
          partner_id: baraaPid,
          custom_notifications: "all",
        }],
      });
    } catch (e) { console.warn("  member create fail:", e.message); }
    await call("res.partner", "write", { ids: [partnerPid], vals: { x_wa_channel_id: channelId } });
  }

  // Step 3: simulate inbound
  // (a) log x_wa_message direction=in (opens 24h window)
  const inWa = await call("x_wa_message", "create", {
    vals_list: [{
      x_partner_id: partnerPid,
      x_direction: "in",
      x_kind: "text",
      x_body: "اختبار الوارد المُحاكى — inbox smoke",
      x_status: "received",
      x_meta_message_id: `wamid.SMOKE.${Date.now()}`,
      x_processed_at: nowOdoo(),
    }],
  });
  state.created.waInboundId = inWa[0];
  console.log(`\n[in] x_wa_message id=${inWa[0]}`);
  // (b) mirror inbound mail.message (author = customer)
  const inMM = await call("mail.message", "create", {
    vals_list: [{
      model: "discuss.channel",
      res_id: channelId,
      message_type: "comment",
      author_id: partnerPid,
      body: "<p>اختبار الوارد المُحاكى — inbox smoke</p>",
    }],
  });
  state.created.mmInbound = inMM[0];
  console.log(`[in] mail.message id=${inMM[0]}`);
  // (c) location mock
  const inLocWa = await call("x_wa_message", "create", {
    vals_list: [{
      x_partner_id: partnerPid,
      x_direction: "in",
      x_kind: "text",
      x_body: "[location] 24.7136,46.6753",
      x_status: "received",
      x_meta_message_id: `wamid.SMOKE-loc.${Date.now()}`,
      x_processed_at: nowOdoo(),
    }],
  });
  state.created.waInboundLocId = inLocWa[0];
  const inLocMM = await call("mail.message", "create", {
    vals_list: [{
      model: "discuss.channel", res_id: channelId, message_type: "comment",
      author_id: partnerPid,
      body: `<p>📍 موقع مُحاكى</p><p><a href="https://maps.google.com/?q=24.7136,46.6753">https://maps.google.com/?q=24.7136,46.6753</a></p>`,
    }],
  });
  state.created.mmInboundLoc = inLocMM[0];
  console.log(`[in-loc] mail.message id=${inLocMM[0]}`);

  // Step 4: Baraa's reply — this should trigger the automation → webhook → send.
  const beforeOutCount = await call("x_wa_message", "search_count", {
    domain: [["x_partner_id", "=", partnerPid], ["x_direction", "=", "out"]],
  });
  const reply = await call("mail.message", "create", {
    vals_list: [{
      model: "discuss.channel",
      res_id: channelId,
      message_type: "comment",
      author_id: baraaPid,
      body: "<p>رد اختبار من صندوق واتساب داخل Odoo — smoke</p>",
    }],
  });
  state.created.mmReply = reply[0];
  console.log(`\n[reply] mail.message id=${reply[0]} (posting as Baraa)`);

  // Step 5: poll for a new outbound x_wa_message row
  const t0 = Date.now();
  let newOutId = null;
  while (Date.now() - t0 < 30000) {
    await new Promise((r) => setTimeout(r, 2000));
    const rows = await call("x_wa_message", "search_read", {
      domain: [
        ["x_partner_id", "=", partnerPid],
        ["x_direction", "=", "out"],
        ["x_res_model", "=", "mail.message"],
        ["x_res_id", "=", reply[0]],
      ],
      fields: ["id", "x_status", "x_body"],
      limit: 1,
    });
    if (rows.length > 0) {
      newOutId = rows[0].id;
      console.log(`[reply→sent] x_wa_message id=${rows[0].id} status=${rows[0].x_status}`);
      break;
    }
  }
  if (!newOutId) {
    console.log(`[reply] no new outbound x_wa_message after ${Math.round((Date.now() - t0) / 1000)}s`);
    // check for bot failure notice
    const failNotes = await call("mail.message", "search_read", {
      domain: [
        ["model", "=", "discuss.channel"],
        ["res_id", "=", channelId],
        ["author_id", "=", botPid],
      ],
      fields: ["id", "body", "date"], order: "id desc", limit: 3,
    });
    console.log("  latest bot messages in channel:", JSON.stringify(failNotes, null, 2));
  }

  // Step 6: cleanup
  console.log("\n=== cleanup ===");
  const cleanupMsgIds = [
    state.created.mmInbound,
    state.created.mmInboundLoc,
    state.created.mmReply,
  ].filter(Boolean);
  if (cleanupMsgIds.length) {
    console.log(`unlink mail.message: ${cleanupMsgIds.join(",")}`);
    try { await call("mail.message", "unlink", { ids: cleanupMsgIds }); }
    catch (e) { console.warn("  mail.message unlink:", e.message); }
  }
  const cleanupWaIds = [
    state.created.waInboundId,
    state.created.waInboundLocId,
    newOutId,
  ].filter(Boolean);
  if (cleanupWaIds.length) {
    console.log(`unlink x_wa_message: ${cleanupWaIds.join(",")}`);
    try { await call("x_wa_message", "unlink", { ids: cleanupWaIds }); }
    catch (e) { console.warn("  x_wa_message unlink:", e.message); }
  }
  console.log("\ndone.");
  return { newOutId };
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
