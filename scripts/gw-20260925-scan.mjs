// البوابة الموحّدة (STATUS § 33) — لقطة قراءة فقط لسجل الإرسال، 2026-09-25.
//
// تقرأ من Odoo: كل x_wa_message منذ 2026-09-11 (وارد وصادر)، والشركاء
// المعنيين، والقوالب بفئتها وحالتها، ورسائل Discuss الست التي لم تُحلَّل في
// § 29 (2011 و2024 و2029 و2030 و2114 و2130). ومن D1 (sim_outbound): كل الصفوف.
// لا كتابة في أي مكان، ولا Meta (أي طلب لغير odoo.com مرفوض).
//
//   node scripts/gw-20260925-scan.mjs
//
// المخرج: scripts/artifacts/gw-20260925-scan.json، يقرؤه
// scripts/gw-20260925-analyze.mts (تحليل الإخفاقات وإعادة التشغيل).

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.includes("odoo.com")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  const method = String(init?.method ?? "GET").toUpperCase();
  const body = String(init?.body ?? "");
  // JSON-2: every call is a POST; only read methods are allowed here.
  if (method === "POST" && !/\/(search_read|read|search_count|fields_get)$/.test(url)) {
    throw new Error(`BLOCKED write: ${url}`);
  }
  void body;
  return real(input, init);
})(globalThis.fetch);

const SINCE = "2026-09-11 00:00:00";
const OUT = new URL("./artifacts/gw-20260925-scan.json", import.meta.url).pathname;

const messages = await call("x_wa_message", "search_read", {
  domain: [["create_date", ">=", SINCE]],
  fields: [
    "id", "create_date", "x_partner_id", "x_direction", "x_kind", "x_status", "x_body",
    "x_meta_error", "x_source", "x_manual", "x_processed_at", "x_meta_message_id", "x_template_id",
  ],
  order: "id asc",
  limit: 5000,
});

const partnerIds = [...new Set(messages.map((m) => (m.x_partner_id ? m.x_partner_id[0] : 0)).filter(Boolean))];
const partners = partnerIds.length
  ? await call("res.partner", "search_read", {
      domain: [["id", "in", partnerIds], ["active", "in", [true, false]]],
      fields: ["id", "name", "x_whatsapp_number", "phone", "active", "customer_rank", "supplier_rank"],
      limit: 500,
    })
  : [];

const templates = await call("x_whatsapp_template", "search_read", {
  domain: [],
  fields: ["id", "x_meta_template_id", "x_language", "x_purpose", "x_meta_status", "x_category", "x_param_count"],
  order: "id asc",
  limit: 500,
});

const SIX = [2011, 2024, 2029, 2030, 2114, 2130];
const six = await call("mail.message", "search_read", {
  domain: [["id", "in", SIX]],
  fields: ["id", "date", "model", "res_id", "body", "author_id"],
  limit: 20,
});
const channelIds = [...new Set(six.map((m) => m.res_id))];
const channels = channelIds.length
  ? await call("discuss.channel", "search_read", {
      domain: [["id", "in", channelIds]],
      fields: ["id", "name"],
      limit: 50,
    })
  : [];
// Every message around the six in their channels (±2 hours), for context.
const around = [];
for (const m of six) {
  const t = Date.parse(m.date.replace(" ", "T") + "Z");
  const lo = new Date(t - 26 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
  const hi = new Date(t + 2 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
  const rows = await call("mail.message", "search_read", {
    domain: [["model", "=", "discuss.channel"], ["res_id", "=", m.res_id], ["date", ">=", lo], ["date", "<=", hi]],
    fields: ["id", "date", "body", "author_id", "message_type"],
    order: "id asc",
    limit: 100,
  });
  around.push({ for: m.id, rows });
}

function d1(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "utak-worker-sim-db", "--env", "sim", "--remote", "--json", "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out)[0].results;
}
const d1Rows = d1("SELECT id, run_id, ts_ms, to_number, msg_type, template_name, body_text, wamid FROM sim_outbound ORDER BY id");

// Every message in every WhatsApp inbox channel since SINCE: inbound mirrors,
// bot echoes («🤖 آلي»), failure lines («⚠️ ما انرسلت») and Baraa's replies.
const waChannels = await call("discuss.channel", "search_read", {
  domain: [["name", "ilike", "واتساب"]],
  fields: ["id", "name"],
  limit: 200,
});
const timeline = await call("mail.message", "search_read", {
  domain: [["model", "=", "discuss.channel"], ["res_id", "in", waChannels.map((c) => c.id)], ["date", ">=", SINCE]],
  fields: ["id", "date", "res_id", "body", "author_id", "message_type"],
  order: "id asc",
  limit: 5000,
});
const failedRows = await call("x_wa_message", "search_read", {
  domain: ["|", ["x_status", "=", "failed"], ["x_meta_error", "!=", false]],
  fields: ["id", "create_date", "write_date", "x_partner_id", "x_meta_message_id", "x_meta_error", "x_status", "x_kind", "x_body"],
  order: "id asc",
  limit: 500,
});

const snap = {
  at: new Date().toISOString(),
  since: SINCE,
  counts: { messages: messages.length, partners: partners.length, templates: templates.length, d1: d1Rows.length, waChannels: waChannels.length, timeline: timeline.length, failedRows: failedRows.length },
  messages,
  partners,
  templates,
  six,
  channels,
  around,
  d1: d1Rows,
  waChannels,
  timeline,
  failedRows,
};
writeFileSync(OUT, JSON.stringify(snap, null, 1));
console.log(JSON.stringify(snap.counts), "→", OUT);
