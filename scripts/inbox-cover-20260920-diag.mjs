// Inbox 2026-09-20 (cover) — read-only diagnostic for Omar's incoming
// messages at 07:22 Riyadh and for the shape of x_wa_message /
// x_message_analysis / discuss.channel today. NO writes.
//
// Prints:
//   - Partner 9 record + duplicates on 545816832
//   - x_wa_message rows on partner 9 today (any)
//   - x_message_analysis rows on partner 9 today (any)
//   - discuss.channel where x_wa_partner_id=9
//   - x_wa_message fields (does x_source already exist?)
//   - existing views (ir.ui.view) targeting x_wa_message
//
// Every phone number is redacted to its last 4 digits before printing.

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

// Redact a phone-like string to its last 4 digits.
function tail(s) {
  const d = String(s ?? "").replace(/[^0-9]/g, "");
  return d ? `…${d.slice(-4)}` : "(none)";
}

function section(t) { console.log(`\n===== ${t} =====`); }

async function main() {
  section("A) partner 9 (Omar)");
  const p9 = await call("res.partner", "read", {
    ids: [9],
    fields: [
      "id", "name", "phone", "x_whatsapp_number", "customer_rank", "supplier_rank",
      "x_role_ids", "x_wa_channel_id", "x_wa_allowed", "active",
    ],
  });
  const r = p9[0] || null;
  if (r) {
    console.log(JSON.stringify({
      id: r.id,
      name: r.name,
      phone_tail: tail(r.phone),
      wa_tail: tail(r.x_whatsapp_number),
      customer_rank: r.customer_rank,
      supplier_rank: r.supplier_rank,
      x_role_ids: r.x_role_ids,
      x_wa_channel_id: r.x_wa_channel_id,
      x_wa_allowed: r.x_wa_allowed,
      active: r.active,
    }));
  } else {
    console.log("not found");
  }

  section("B) all partners on last-4 = 5816832 (dup scan)");
  // Search by ilike on last 4 digits of Omar's phone
  const dups = await call("res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "ilike", "5816832"], ["phone", "ilike", "5816832"]],
    fields: ["id", "name", "phone", "x_whatsapp_number", "customer_rank", "supplier_rank", "x_role_ids", "active"],
  });
  for (const d of dups) {
    console.log(JSON.stringify({
      id: d.id, name: d.name,
      phone_tail: tail(d.phone), wa_tail: tail(d.x_whatsapp_number),
      customer_rank: d.customer_rank, supplier_rank: d.supplier_rank,
      x_role_ids: d.x_role_ids, active: d.active,
    }));
  }

  section("C) x_wa_message rows on partner 9 (any)");
  const waMsgs = await call("x_wa_message", "search_read", {
    domain: [["x_partner_id", "=", 9]],
    fields: ["id", "x_partner_id", "x_direction", "x_kind", "x_status", "x_body", "x_meta_message_id", "x_manual", "create_date"],
    order: "id desc",
    limit: 20,
  });
  console.log(`count=${waMsgs.length}`);
  for (const w of waMsgs) {
    console.log(JSON.stringify({
      id: w.id, dir: w.x_direction, kind: w.x_kind, st: w.x_status,
      body: (w.x_body || "").slice(0, 60), wamid: w.x_meta_message_id,
      manual: w.x_manual, at: w.create_date,
    }));
  }

  section("D) x_wa_message today by any partner (2026-09-20 UTC)");
  const todayUtc = new Date();
  const yyyy = todayUtc.getUTCFullYear();
  const mm = String(todayUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(todayUtc.getUTCDate()).padStart(2, "0");
  const dayStart = `${yyyy}-${mm}-${dd} 00:00:00`;
  const todayMsgs = await call("x_wa_message", "search_read", {
    domain: [["create_date", ">=", dayStart]],
    fields: ["id", "x_partner_id", "x_direction", "x_kind", "x_meta_message_id", "create_date"],
    order: "create_date desc",
    limit: 30,
  });
  console.log(`count=${todayMsgs.length}`);
  for (const w of todayMsgs) {
    console.log(JSON.stringify({
      id: w.id, partner: w.x_partner_id, dir: w.x_direction, kind: w.x_kind,
      wamid: (w.x_meta_message_id || "").slice(-10), at: w.create_date,
    }));
  }

  section("E) x_message_analysis today");
  try {
    const anaToday = await call("x_message_analysis", "search_read", {
      domain: [["create_date", ">=", dayStart]],
      fields: ["id", "x_customer_id", "x_created_at", "create_date"],
      order: "id desc",
      limit: 30,
    });
    console.log(`count=${anaToday.length}`);
    for (const a of anaToday) {
      console.log(JSON.stringify({
        id: a.id, cust: a.x_customer_id, at: a.x_created_at || a.create_date,
      }));
    }
  } catch (e) {
    console.log("skip:", e.message);
  }

  section("F) discuss.channel where x_wa_partner_id=9");
  const chs = await call("discuss.channel", "search_read", {
    domain: [["x_wa_partner_id", "=", 9]],
    fields: ["id", "name", "channel_type", "x_wa_partner_id", "create_date"],
  });
  console.log(`count=${chs.length}`);
  console.log(JSON.stringify(chs, null, 2));

  section("G) x_wa_message.x_source present?");
  const waFields = await call("x_wa_message", "fields_get", {
    attributes: ["type", "string", "selection", "required"],
  });
  console.log("x_source:", JSON.stringify(waFields.x_source ?? "MISSING"));
  console.log("x_manual:", JSON.stringify(waFields.x_manual));
  console.log("x_direction:", JSON.stringify(waFields.x_direction));

  section("H) views for x_wa_message");
  const views = await call("ir.ui.view", "search_read", {
    domain: [["model", "=", "x_wa_message"]],
    fields: ["id", "name", "type", "priority", "inherit_id"],
  });
  console.log(JSON.stringify(views, null, 2));

  section("I) UTAK بوت (bot) partner");
  const bot = await call("res.partner", "search_read", {
    domain: [["name", "=", "UTAK بوت"]],
    fields: ["id", "name"],
    limit: 1,
  });
  console.log(JSON.stringify(bot));

  section("J) partner 10 (fake employee)");
  try {
    const p10 = await call("res.partner", "read", {
      ids: [10],
      fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_channel_id", "x_wa_allowed", "x_role_ids"],
    });
    const r = p10[0];
    if (r) {
      console.log(JSON.stringify({
        id: r.id, name: r.name,
        phone_tail: tail(r.phone), wa_tail: tail(r.x_whatsapp_number),
        x_wa_channel_id: r.x_wa_channel_id, x_wa_allowed: r.x_wa_allowed,
        x_role_ids: r.x_role_ids,
      }));
    } else {
      console.log("not found");
    }
  } catch (e) {
    console.log("skip:", e.message);
  }

  section("K) test-number partner (+966536251307)");
  const testP = await call("res.partner", "search_read", {
    domain: ["|", ["x_whatsapp_number", "ilike", "536251307"], ["phone", "ilike", "536251307"]],
    fields: ["id", "name", "phone", "x_whatsapp_number", "x_wa_channel_id", "x_wa_allowed", "x_role_ids"],
  });
  for (const p of testP) {
    console.log(JSON.stringify({
      id: p.id, name: p.name,
      phone_tail: tail(p.phone), wa_tail: tail(p.x_whatsapp_number),
      x_wa_channel_id: p.x_wa_channel_id, x_wa_allowed: p.x_wa_allowed,
      x_role_ids: p.x_role_ids,
    }));
  }

  section("L) server actions 941, 957, 968, 969, 970");
  const acts = await call("ir.actions.server", "search_read", {
    domain: [["id", "in", [941, 957, 968, 969, 970]]],
    fields: ["id", "name", "state", "webhook_url", "model_id"],
  });
  // Redact ?token=... value; print origin + path only.
  for (const a of acts) {
    const url = String(a.webhook_url ?? "");
    const origin = (url.match(/^(https?:\/\/[^/]+)/) || [])[1] || "";
    const path = url.replace(origin, "").split("?")[0];
    const hasToken = /[?&]token=/.test(url);
    console.log(JSON.stringify({
      id: a.id, name: a.name, state: a.state, origin, path, has_token: hasToken,
    }));
  }

  section("M) automation 12 + server action 979 shape");
  try {
    const ba = await call("base.automation", "read", {
      ids: [12], fields: ["id", "name", "active", "filter_domain", "action_server_ids"],
    });
    console.log("automation 12:", JSON.stringify(ba));
    const sa = await call("ir.actions.server", "read", {
      ids: [979], fields: ["id", "name", "state", "webhook_url"],
    });
    const url = String(sa[0]?.webhook_url ?? "");
    const origin = (url.match(/^(https?:\/\/[^/]+)/) || [])[1] || "";
    const path = url.replace(origin, "").split("?")[0];
    console.log("server action 979:", JSON.stringify({ id: sa[0]?.id, name: sa[0]?.name, state: sa[0]?.state, origin, path, has_token: /[?&]token=/.test(url) }));
  } catch (e) {
    console.log("skip:", e.message);
  }

  console.log("\nDone — no writes.");
}
main().catch((e) => { console.error("[fatal]", e.stack || e.message || e); process.exit(1); });
