// § 36 (ب) — every outbound WhatsApp message of a Riyadh day, in three sources:
//   1. D1 sim_outbound (every send that reached Meta from sim / pilot, and the
//      live trials run through scripts/lib/cf-live-env.mjs);
//   2. Odoo x_wa_message (direction «out»);
//   3. the number's Discuss channel «واتساب · الاسم · +الرقم» (bot-authored lines).
// Read only: D1 SELECT, Odoo search_read. Nothing is written or sent.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s36-20260925-reconcile.mts [YYYY-MM-DD] [label]
//
// Out: scripts/artifacts/s36-20260925-reconcile-<label>.{json,md}
import { writeFileSync } from "node:fs";
import { liveSimEnv } from "./lib/cf-live-env.mjs";
import { call } from "./lib/odoo-cli.mjs";

const day = process.argv[2] || "2026-09-25";
const label = process.argv[3] || "before";
const env: any = await liveSimEnv();
const startMs = Date.parse(`${day}T00:00:00+03:00`);
const endMs = startMs + 24 * 3600_000;
const odooTs = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const tail = (s: unknown) => `…${digits(s).slice(-4)}`;

// ---- 1. D1
const d1 = (await env.SIM_DB.prepare(
  "SELECT id, run_id, ts_ms, to_number, msg_type, template_name, variables_json, body_text, attachment, wamid, raw_request FROM sim_outbound WHERE ts_ms >= ? AND ts_ms < ? ORDER BY ts_ms",
).bind(startMs, endMs).all()).results as any[];

// ---- 2. x_wa_message (out), by create_date or processed_at in the day
// § 36: a row points at its Discuss line (x_echo_message_id) once the fields exist
const hasEcho = "x_echo_message_id" in (await call("x_wa_message", "fields_get", { attributes: ["type"] }));
const rows = await call("x_wa_message", "search_read", {
  domain: [["x_direction", "=", "out"], "|", "&", ["create_date", ">=", odooTs(startMs)], ["create_date", "<", odooTs(endMs)],
    "&", ["x_processed_at", ">=", odooTs(startMs)], ["x_processed_at", "<", odooTs(endMs)]],
  fields: ["id", "x_partner_id", "x_kind", "x_body", "x_status", "x_meta_message_id", "x_processed_at", "create_date", "x_source", "x_meta_error", "x_debug_payload", "x_template_id",
    ...(hasEcho ? ["x_echo_message_id", "x_backfilled"] : [])],
  order: "id asc",
  limit: 2000,
}) as any[];

// ---- 3. Discuss: every WhatsApp channel, the bot's lines of the day
const channels = await call("discuss.channel", "search_read", {
  domain: [["x_wa_partner_id", "!=", false]], fields: ["id", "name", "x_wa_partner_id"], context: { active_test: false }, limit: 500,
}) as any[];
const partnerIds = [...new Set(channels.map((c) => c.x_wa_partner_id[0]))];
const partners = await call("res.partner", "read", { ids: partnerIds, fields: ["id", "name", "x_whatsapp_number", "phone", "phone_sanitized"], context: { active_test: false } }) as any[];
const numOfPartner = new Map(partners.map((p) => [p.id, digits(p.x_whatsapp_number || p.phone_sanitized || p.phone)]));
const numOfChannel = new Map(channels.map((c) => [c.id, numOfPartner.get(c.x_wa_partner_id[0]) ?? ""]));
const [bot] = await call("res.partner", "search_read", { domain: [["name", "=", "UTAK بوت"]], fields: ["id"], limit: 1 }) as any[];
const msgs = await call("mail.message", "search_read", {
  domain: [["model", "=", "discuss.channel"], ["res_id", "in", channels.map((c) => c.id)], ["date", ">=", odooTs(startMs)], ["date", "<", odooTs(endMs)]],
  fields: ["id", "res_id", "author_id", "body", "date", "message_type"],
  order: "id asc",
  limit: 5000,
}) as any[];
const botMsgs = msgs.filter((m) => m.author_id && m.author_id[0] === bot.id);
const plain = (html: string) => String(html || "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

// ---- partner → number for x_wa_message rows
const rowPartnerIds = [...new Set(rows.filter((r) => r.x_partner_id).map((r) => r.x_partner_id[0]))].filter((id) => !numOfPartner.has(id));
if (rowPartnerIds.length) {
  for (const p of await call("res.partner", "read", { ids: rowPartnerIds, fields: ["id", "x_whatsapp_number", "phone", "phone_sanitized"], context: { active_test: false } }) as any[]) {
    numOfPartner.set(p.id, digits(p.x_whatsapp_number || p.phone_sanitized || p.phone));
  }
}

// ---- text of a D1 row as the gateway's old echo wrote it, and a match key
function d1Text(r: any): string {
  const raw = (() => { try { return JSON.parse(r.raw_request); } catch { return {}; } })();
  if (r.msg_type === "text") return raw.text?.body ?? r.body_text ?? "";
  if (r.msg_type === "interactive") return raw.interactive?.body?.text ?? r.body_text ?? "";
  if (r.msg_type === "template") return `📋 قالب: ${r.template_name}${r.body_text ? ` (${String(r.body_text).split(" | ").join("، ")})` : ""}`;
  if (r.msg_type === "location") return `📍 ${r.body_text ?? ""}`;
  if (r.msg_type === "document") return `📎 ${raw.document?.filename ?? ""}`;
  return `[${r.msg_type}]`;
}
const norm = (s: string) => String(s || "").replace(/\s+/g, " ").replace(/[‎‏⁦-⁩]/g, "").trim();
const key = (s: string) => norm(s).slice(0, 60);
const delivered = (r: any) => { try { return JSON.parse(r.raw_request).__delivered !== false; } catch { return true; } };

const usedRows = new Set<number>();
const usedMsgs = new Set<number>();
const out: any[] = [];
for (const r of d1) {
  const num = digits(r.to_number);
  const text = d1Text(r);
  const row = rows.find((x) => !usedRows.has(x.id) && r.wamid && x.x_meta_message_id === r.wamid)
    ?? rows.find((x) => !usedRows.has(x.id) && !x.x_meta_message_id && x.x_partner_id && numOfPartner.get(x.x_partner_id[0]) === num
      && Math.abs(Date.parse(x.create_date.replace(" ", "T") + "Z") - r.ts_ms) < 180_000 && key(x.x_body) === key(text));
  if (row) usedRows.add(row.id);
  const chIds = channels.filter((c) => numOfChannel.get(c.id) === num).map((c) => c.id);
  const linked = row?.x_echo_message_id ? botMsgs.find((m) => m.id === row.x_echo_message_id && chIds.includes(m.res_id)) : undefined;
  const msg = linked ?? botMsgs.find((m) => !usedMsgs.has(m.id) && chIds.includes(m.res_id)
    && Math.abs(Date.parse(m.date.replace(" ", "T") + "Z") - r.ts_ms) < 300_000
    && (plain(m.body).includes(norm(text).slice(0, 40)) || norm(plain(m.body)).includes(norm(text).slice(0, 40))));
  if (msg) usedMsgs.add(msg.id);
  out.push({
    d1: r.id, at: new Date(r.ts_ms).toISOString(), to: tail(num), num, type: r.msg_type, template: r.template_name, wamid: r.wamid,
    delivered: delivered(r), text: text.slice(0, 160),
    row: row ? { id: row.id, status: row.x_status, source: row.x_source, backfilled: row.x_backfilled === true } : null,
    echo: msg ? { id: msg.id, channel: msg.res_id } : null,
    channels: chIds,
  });
}
// rows with no D1 counterpart (held / skipped / expired / blocked or Odoo-only sends)
const rowsOnly = rows.filter((x) => !usedRows.has(x.id)).map((x) => ({
  id: x.id, status: x.x_status, kind: x.x_kind, source: x.x_source, partner: x.x_partner_id, to: x.x_partner_id ? tail(numOfPartner.get(x.x_partner_id[0])) : "(none)",
  created: x.create_date, wamid: x.x_meta_message_id || null, body: String(x.x_body || "").slice(0, 120), err: String(x.x_meta_error || "").slice(0, 160),
}));
const echoesOnly = botMsgs.filter((m) => !usedMsgs.has(m.id)).map((m) => ({ id: m.id, channel: m.res_id, to: tail(numOfChannel.get(m.res_id)), date: m.date, text: plain(m.body).slice(0, 140) }));

const byNumber: Record<string, any> = {};
for (const o of out) {
  const b = (byNumber[o.to] ??= { sent: 0, noRow: 0, noEcho: 0, noChannel: 0 });
  b.sent++;
  if (!o.row) b.noRow++;
  if (!o.channels.length) b.noChannel++;
  else if (!o.echo) b.noEcho++;
}
const report = { day, label, at: new Date().toISOString(), window: [new Date(startMs).toISOString(), new Date(endMs).toISOString()], counts: { d1: d1.length, rows: rows.length, botEchoes: botMsgs.length }, byNumber, sends: out, rowsOnly, echoesOnly };
writeFileSync(new URL(`./artifacts/s36-20260925-reconcile-${label}.json`, import.meta.url), JSON.stringify(report, null, 2) + "\n");
const md = [
  `# § 36 reconcile ${day} (${label}) — ${report.at}`,
  "", `D1 ${d1.length} · x_wa_message out ${rows.length} · bot lines in WhatsApp channels ${botMsgs.length}`, "",
  "| D1 | UTC | إلى | النوع | النص | صف | صدى |", "|---|---|---|---|---|---|---|",
  ...out.map((o) => `| ${o.d1} | ${o.at.slice(11, 19)} | ${o.to} | ${o.type}${o.template ? ` ${o.template}` : ""} | ${o.text.replace(/\n/g, " ").replace(/\|/g, "¦").slice(0, 70)} | ${o.row ? `#${o.row.id} ${o.row.status}` : "✗"} | ${o.echo ? `#${o.echo.id}` : o.channels.length ? "✗" : "بلا قناة"} |`),
  "", "## صفوف بلا D1", "", ...rowsOnly.map((r) => `- #${r.id} ${r.status} ${r.to} ${r.created} — ${r.body.replace(/\n/g, " ").slice(0, 80)}${r.err ? ` — ${r.err.slice(0, 80)}` : ""}`),
  "", "## أسطر البوت بلا D1", "", ...echoesOnly.map((m) => `- #${m.id} ch${m.channel} ${m.to} ${m.date} — ${m.text.replace(/\n/g, " ").slice(0, 90)}`),
].join("\n");
writeFileSync(new URL(`./artifacts/s36-20260925-reconcile-${label}.md`, import.meta.url), md + "\n");
console.log(md);
console.log(JSON.stringify(byNumber, null, 1));
