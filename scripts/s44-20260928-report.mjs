// § 44 أ (2026-09-28) — the report for yesterday and today, READ ONLY:
// search_read / read on Odoo, GET on Cloudflare (KV keys and values, the
// GraphQL analytics of scheduled invocations). Every phone number is masked.
//
//   node scripts/s44-20260928-report.mjs [--since="2026-09-26 21:00:00"]
//
// The period starts 2026-09-27 00:00 Riyadh (= 2026-09-26 21:00 UTC) and runs
// until now. Out: scripts/artifacts/s44-20260928-report.json and .md.
//
// Who created what: the Odoo API key of both workers is Baraa's own user
// (uid 2, context_get), so create_uid does not tell his hand from the
// worker's. The report tells them apart by what the worker never writes:
//   · x_wa_message: x_manual / x_source = manual (his reply from Discuss);
//   · res.partner: a partner the worker creates from WhatsApp is «غير مراجَع»
//     with x_whatsapp_number; anything else created in the period is his;
//   · x_contact_class: the worker sets «customer» only on a real order (none
//     in the period, listed below), so a partner that became «عميل» in the
//     period (mail.tracking.value) was classified by him (📋 مراجعة الأرقام).
//   · orders, quotations, invoices, payments, routes, stops, purchase lists:
//     every record created in the period is listed with its partner.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { call } from "./lib/odoo-cli.mjs";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SINCE = arg("since", "2026-09-26 21:00:00");
const root = new URL("../", import.meta.url);
const toml = readFileSync(new URL("wrangler.toml", root), "utf8");
const envSimBlock = toml.slice(toml.indexOf("[env.sim.vars]"));
const tv = (src, k) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(src) ?? [])[1] ?? "";
const OWNER = tv(toml, "OWNER_WHATSAPP").replace(/\D/g, "");
const SIM_ALLOW = tv(envSimBlock, "SIM_ALLOWLIST").split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean);
const SIM_KV = "998122f32d7b46c2a45cf01acec3cb0e";

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const mask = (s) => { const d = digits(s); return d.length >= 7 ? `+${d.slice(0, 3)}…${d.slice(-4)}` : d ? `+…${d.slice(-4)}` : "—"; };
const riyadh = (odooUtc) => {
  const ms = Date.parse(String(odooUtc || "").replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? new Date(ms + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "";
};
const short = (s, n = 70) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const m2o = (v) => (Array.isArray(v) ? { id: v[0], name: v[1] } : null);

// ---------------------------------------------------------------- who is who
const employees = await call("hr.employee", "search_read", {
  domain: [], fields: ["id", "name", "work_contact_id", "x_whatsapp_contact_id", "active"], context: { active_test: false },
}).catch(async () => call("hr.employee", "search_read", { domain: [], fields: ["id", "name", "work_contact_id", "active"], context: { active_test: false } }));
const teamPartnerIds = new Set(employees.filter((e) => e.active).flatMap((e) => [e.work_contact_id?.[0], e.x_whatsapp_contact_id?.[0]]).filter(Boolean));
const AHMED = 30;
const OWNER_PARTNER = 45; // Baraa's WhatsApp partner (§ 32)

// ---------------------------------------------------------------- 1. inbound / 2. outbound
const rows = await call("x_wa_message", "search_read", {
  domain: [["create_date", ">=", SINCE]],
  fields: ["id", "create_date", "x_partner_id", "x_direction", "x_kind", "x_status", "x_source", "x_manual", "x_body", "x_meta_error", "x_template_id", "x_debug_payload", "x_utak_simulation"],
  order: "id asc",
});
const partnerIds = [...new Set(rows.map((r) => r.x_partner_id?.[0]).filter(Boolean))];
const partners = partnerIds.length ? await call("res.partner", "read", {
  ids: partnerIds, fields: ["id", "name", "x_whatsapp_number", "phone", "active", "x_contact_class", "x_review_pending", "x_ai_intent", "customer_rank", "supplier_rank", "x_wa_allowed"],
  context: { active_test: false },
}) : [];
const P = Object.fromEntries(partners.map((p) => [p.id, p]));
const numberOf = (pid) => digits(P[pid]?.x_whatsapp_number || P[pid]?.phone || "");
const purposeOf = (r) => { try { return JSON.parse(r.x_debug_payload || "{}").purpose ?? ""; } catch { return ""; } };
const gatewayOf = (r) => { try { return JSON.parse(r.x_debug_payload || "{}").gateway ?? ""; } catch { return ""; } };

const external = (pid) => pid && pid !== AHMED && pid !== OWNER_PARTNER && !teamPartnerIds.has(pid) && numberOf(pid) !== OWNER;
const inbound = rows.filter((r) => r.x_direction === "in" && external(r.x_partner_id?.[0]));
const out = rows.filter((r) => r.x_direction === "out");

const inboundReport = inbound.map((r) => {
  const pid = r.x_partner_id[0];
  const p = P[pid] ?? {};
  const t = Date.parse(r.create_date.replace(" ", "T") + "Z");
  // what sim did: the outbound rows to that partner within 10 minutes after, and Baraa's alerts naming him
  const replies = out.filter((o) => o.x_partner_id?.[0] === pid && Date.parse(o.create_date.replace(" ", "T") + "Z") >= t && Date.parse(o.create_date.replace(" ", "T") + "Z") - t < 10 * 60_000);
  const alerts = out.filter((o) => o.x_partner_id?.[0] === OWNER_PARTNER && Date.parse(o.create_date.replace(" ", "T") + "Z") >= t && Date.parse(o.create_date.replace(" ", "T") + "Z") - t < 10 * 60_000 && (String(o.x_body || "").includes(p.name || "\u0000") || String(o.x_body || "").includes(numberOf(pid).slice(-4))));
  // sim's gateway accepts a number in SIM_ALLOWLIST OR a partner with x_wa_allowed (a new
  // WhatsApp partner gets true by default, ir.default of item4)
  const inList = SIM_ALLOW.includes(numberOf(pid));
  let did;
  if (!p.active) did = "مؤرشف: حُفظ في صندوقه بلا رد";
  else if (p.x_contact_class === "personal") did = "شخصي: حُفظ بلا رد";
  else if (!inList && !p.x_wa_allowed) did = "خارج SIM_ALLOWLIST وx_wa_allowed مطفأ: حُفظ في صندوقه، والرد يرفضه sim";
  else did = inList ? "في SIM_ALLOWLIST: عولج كعميل" : "خارج SIM_ALLOWLIST لكن x_wa_allowed = true (افتراض الشريك الجديد): عولج كعميل وأُرسل له";
  return {
    wa_row: r.id, partner: `#${pid} ${p.name ?? "?"}`, number: mask(numberOf(pid)), riyadh: riyadh(r.create_date),
    kind: r.x_kind, text: short(r.x_body), class: p.x_contact_class || "—", reviewPending: !!p.x_review_pending, intent: p.x_ai_intent || "—",
    did, replies: replies.map((o) => `${riyadh(o.create_date).slice(11)} ${purposeOf(o) || o.x_kind} → ${o.x_status}${o.x_meta_error ? ` (${short(o.x_meta_error, 60)})` : ""}`),
    ownerAlerts: alerts.map((o) => `${riyadh(o.create_date).slice(11)} «${short(o.x_body, 60)}» → ${o.x_status}`),
    gotReply: replies.some((o) => ["sent", "delivered", "read"].includes(o.x_status)),
  };
});

const outboundReport = out.map((r) => {
  const pid = r.x_partner_id?.[0];
  const p = P[pid] ?? {};
  const who = pid === OWNER_PARTNER ? "براء" : pid === AHMED ? "أحمد (مورد)" : teamPartnerIds.has(pid) ? `فريق: ${p.name}` : `آخر: #${pid} ${p.name ?? "?"}`;
  return {
    wa_row: r.id, riyadh: riyadh(r.create_date), to: who, number: mask(numberOf(pid)), purpose: purposeOf(r) || (r.x_manual ? "يدوي" : "—"),
    kind: r.x_kind, template: r.x_template_id?.[1] ?? "", status: r.x_status, gateway: gatewayOf(r), manual: !!r.x_manual || r.x_source === "manual",
    text: short(r.x_body, 60), error: short(r.x_meta_error, 110),
  };
});
const failures = outboundReport.filter((o) => ["failed", "expired", "skipped"].includes(o.status));

// ---------------------------------------------------------------- 3. KV on sim (GET)
const cfg = readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, "utf8");
const cfToken = (/oauth_token\s*=\s*"([^"]+)"/.exec(cfg) || [])[1];
const cf = async (path) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${cfToken}` } });
  const j = await r.json();
  if (!j.success) throw new Error(`${path}: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return j.result;
};
const account = (await cf("/accounts"))[0].id;
const kvKeys = async (prefix) => {
  const outK = [];
  let cursor = "";
  do {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${SIM_KV}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${cursor}` : ""}`, { headers: { Authorization: `Bearer ${cfToken}` } });
    const j = await r.json();
    outK.push(...(j.result ?? []));
    cursor = j.result_info?.cursor ?? "";
  } while (cursor);
  return outK;
};
const kvGet = async (key) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${SIM_KV}/values/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${cfToken}` } });
  return r.status === 404 ? null : r.text();
};
const QUEUE_PREFIXES = ["wa_q:v1:", "team_q:", "pending_loc:", "cpay_open:", "cpay:v1:", "pending_neighborhood:", "late_order:", "cutoff_prompt:", "spay:", "sp_flow:"];
const kv = {};
for (const prefix of QUEUE_PREFIXES) {
  const keys = await kvKeys(prefix);
  kv[prefix] = [];
  for (const k of keys) {
    const raw = await kvGet(k.name);
    let items = null;
    try { items = JSON.parse(raw ?? "null"); } catch { items = raw; }
    const tail = k.name.slice(prefix.length);
    const entry = { key: prefix + (/^\+?\d{7,}$/.test(tail) ? mask(tail) : tail), expires: k.expiration ? new Date(k.expiration * 1000 + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : null };
    if (prefix === "wa_q:v1:" && Array.isArray(items?.items ?? items)) {
      entry.items = (items.items ?? items).map((it) => ({ purpose: it.purpose, kind: it.content?.kind ?? it.kind, until: it.expiresAt ? new Date(Date.parse(it.expiresAt) + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : null, text: short(it.content?.text ?? it.content?.body ?? it.text ?? "", 60) }));
    } else {
      entry.summary = short(typeof items === "string" ? items : JSON.stringify(items), 160).replace(/\d{9,}/g, (d) => mask(d));
    }
    kv[prefix].push(entry);
  }
}

const allKeys = await kvKeys("");
const kvPrefixes = {};
for (const k of allKeys) { const pfx = k.name.startsWith("wamid.") ? "wamid.* (dedup)" : k.name.replace(/[:_]?[+\d][\d:.\-T+]*$/, "").split(":").slice(0, 2).join(":"); kvPrefixes[pfx] = (kvPrefixes[pfx] ?? 0) + 1; }
const kvDetail = {};
for (const pfx of ["wa_rej:v1", "wa_send_fail", "wa_q:v1:index"]) {
  for (const k of allKeys.filter((x) => x.name.startsWith(pfx))) kvDetail[k.name.replace(/\d{9,}/g, (d) => mask(d))] = short(await kvGet(k.name), 200).replace(/\d{9,}/g, (d) => mask(d));
}

// ---------------------------------------------------------------- 4. created by Baraa in the period
const MODELS = [
  ["res.partner", ["id", "name", "create_date", "x_contact_class", "x_whatsapp_number", "customer_rank", "supplier_rank", "active"], null],
  ["x_daily_order", ["id", "x_name", "create_date", "x_customer_id", "x_state", "x_order_date", "x_created_via", "x_utak_simulation", "x_is_simulation"], "x_customer_id"],
  ["x_daily_order_line", ["id", "create_date", "x_order_id", "x_utak_simulation", "x_is_simulation"], null],
  ["x_quotation", ["id", "x_name", "create_date", "x_customer_id", "x_utak_simulation"], "x_customer_id"],
  ["x_invoice", ["id", "x_name", "create_date", "x_customer_id", "x_utak_simulation", "x_is_simulation"], "x_customer_id"],
  ["x_payment", ["id", "x_name", "create_date", "x_customer_id", "x_utak_simulation", "x_is_simulation"], "x_customer_id"],
  ["x_delivery_route", ["id", "x_name", "create_date", "x_utak_simulation", "x_is_simulation"], null],
  ["x_delivery_stop", ["id", "create_date", "x_order_id", "x_utak_simulation", "x_is_simulation"], null],
  ["x_purchase_list", ["id", "x_name", "create_date", "x_date", "x_utak_simulation", "x_is_simulation"], null],
];
const created = {};
for (const [model, fields] of MODELS) {
  let rs;
  try {
    rs = await call(model, "search_read", { domain: [["create_date", ">=", SINCE]], fields, context: { active_test: false } });
  } catch (e) {
    // a field this model lacks: read the ids and the dates only
    rs = await call(model, "search_read", { domain: [["create_date", ">=", SINCE]], fields: ["id", "create_date"], context: { active_test: false } });
  }
  created[model] = rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "x_whatsapp_number" ? mask(v) : k === "create_date" ? riyadh(v) : v])));
}
// a partner created from WhatsApp by the worker: its first inbound row is within a minute of its creation
for (const p of created["res.partner"]) {
  const first = rows.find((r) => r.x_partner_id?.[0] === p.id && r.x_direction === "in");
  p.createdBy = first && Math.abs(Date.parse(first.create_date.replace(" ", "T") + "Z") - Date.parse(String(p.create_date).replace(" ", "T") + ":00+03:00")) < 120_000
    ? `sim من واتساب (أول رسالة ${riyadh(first.create_date).slice(11)})` : "براء (لا رسالة واردة لحظة الإنشاء)";
}
const manualWa = rows.filter((r) => r.x_manual || r.x_source === "manual").map((r) => ({ wa_row: r.id, riyadh: riyadh(r.create_date), to: `#${r.x_partner_id?.[0]} ${r.x_partner_id?.[1] ?? ""}`, text: short(r.x_body, 60), status: r.x_status }));
// partners whose class changed in the period: mail.tracking.value is not reachable over JSON-2 on this
// tenant (404), so a class change is read from the partners written in the period (write_date) and their
// class now; the worker writes «customer» only on a real order (none in the period).
const classChanges = [];
const writtenPartners = (await call("res.partner", "search_read", {
  domain: [["write_date", ">=", SINCE]], fields: ["id", "name", "write_date", "x_contact_class", "x_review_pending", "x_ai_intent", "active", "customer_rank"], context: { active_test: false },
})).map((p) => ({ ...p, write_date: riyadh(p.write_date) }));

// ---------------------------------------------------------------- 5. schedules on sim (GraphQL) + price days
const inv = [];
let cursorIso = SINCE.replace(" ", "T") + "Z";
for (let page = 0; page < 40; page++) {
  const q = `query($a:String!,$s:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsScheduled(limit:1000,filter:{datetime_gt:$s,scriptName:"utak-worker-sim"},orderBy:[datetime_ASC]){scriptName cron status datetime}}}}`;
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: { a: account, s: cursorIso } }) });
  const j = await r.json();
  if (j.errors) { inv.push({ error: JSON.stringify(j.errors).slice(0, 200) }); break; }
  const got = j.data?.viewer?.accounts?.[0]?.workersInvocationsScheduled ?? [];
  inv.push(...got);
  if (got.length < 1000) break;
  cursorIso = got[got.length - 1].datetime;
}
const byCron = {};
for (const i of inv.filter((x) => x.cron)) {
  const day = new Date(Date.parse(i.datetime) + 3 * 3600_000).toISOString().slice(0, 10);
  const k = `${i.cron}`;
  byCron[k] ??= {};
  byCron[k][day] ??= { runs: 0, statuses: {} };
  byCron[k][day].runs++;
  byCron[k][day].statuses[i.status] = (byCron[k][day].statuses[i.status] ?? 0) + 1;
}
const priceDays = await call("x_price_day", "search_read", {
  domain: [["x_date", "in", ["2026-09-27", "2026-09-28"]]], fields: ["id", "x_date", "x_state", "x_utak_simulation", "x_published_at", "x_line_ids"], context: { active_test: false },
}).catch(async () => call("x_price_day", "search_read", { domain: [["x_date", "in", ["2026-09-27", "2026-09-28"]]], fields: ["id", "x_date", "x_state"] }));

const report = {
  at: new Date().toISOString(), riyadhNow: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " "), since: SINCE, sinceRiyadh: riyadh(SINCE),
  counts: { waRows: rows.length, inboundExternal: inbound.length, outbound: out.length, outboundFailures: failures.length },
  inbound: inboundReport, outbound: outboundReport, failures, kv, kvPrefixes, kvDetail, created, manualWa, classChanges, writtenPartners,
  schedules: { invocations: inv.length, byCron }, priceDays,
};
writeFileSync(new URL("scripts/artifacts/s44-20260928-report.json", root), JSON.stringify(report, null, 2) + "\n");

// ---------------------------------------------------------------- markdown
const L = [];
L.push(`# § 44 أ — تقرير الأمس واليوم (قراءة فقط)`, "", `الفترة: ${report.sinceRiyadh} → ${report.riyadhNow} (الرياض). صفوف x_wa_message: ${rows.length}.`, "");
L.push(`## 1. الوارد من خارج الفريق وأحمد (${inbound.length})`, "", "| الوقت | الشريك | الرقم | النوع | النص | التصنيف | ما فعله sim | رد وصل؟ |", "|---|---|---|---|---|---|---|---|");
for (const i of inboundReport) L.push(`| ${i.riyadh} | ${i.partner} | ${i.number} | ${i.kind} | ${i.text} | ${i.class}${i.reviewPending ? " (ينتظر مراجعة)" : ""} | ${i.did}${i.replies.length ? "؛ " + i.replies.join("، ") : ""}${i.ownerAlerts.length ? "؛ تنبيه براء: " + i.ownerAlerts.join("، ") : ""} | ${i.gotReply ? "نعم" : "لا"} |`);
L.push("", `## 2. الصادر من sim (${out.length})`, "", "| الوقت | إلى | الغرض | النوع | الحالة | ملاحظة |", "|---|---|---|---|---|---|");
for (const o of outboundReport) L.push(`| ${o.riyadh} | ${o.to} | ${o.purpose} | ${o.kind}${o.template ? " «" + o.template + "»" : ""} | ${o.status}${o.gateway ? " (" + o.gateway + ")" : ""} | ${o.error || (o.manual ? "يدوي" : "")} |`);
L.push("", `## 3. طوابير KV على sim`, "");
for (const [p, es] of Object.entries(kv)) {
  L.push(`- \`${p}\`: ${es.length}`);
  for (const e of es) L.push(`  - ${e.key}${e.expires ? ` (تنتهي ${e.expires})` : ""}${e.items ? ": " + e.items.map((it) => `${it.purpose} حتى ${it.until} «${it.text}»`).join("؛ ") : e.summary ? ": " + e.summary : ""}`);
}
L.push(`- كل المفاتيح (${allKeys.length}) بالبادئة: ${Object.entries(kvPrefixes).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join("، ")}`);
for (const [k, v] of Object.entries(kvDetail)) L.push(`  - \`${k}\` = ${v}`);
L.push("", `## 4. ما أنشأه براء يدوياً`, "");
for (const [m, rs] of Object.entries(created)) L.push(`- \`${m}\`: ${rs.length}${rs.length ? " — " + rs.map((r) => JSON.stringify(r)).join("؛ ") : ""}`);
L.push(`- رسائل يدوية من Discuss: ${manualWa.length}${manualWa.length ? " — " + manualWa.map((m) => `${m.riyadh} ${m.to} «${m.text}» ${m.status}`).join("؛ ") : ""}`);
L.push("- التصنيف: mail.tracking.value غير متاح عبر JSON-2، فيُقرأ من الشركاء المعدَّلين في الفترة وتصنيفهم الآن (أدناه)؛ الوركر لا يكتب «عميل» إلا بطلب حقيقي، ولا طلب في الفترة");
L.push(`- شركاء عُدّلوا في الفترة: ${writtenPartners.map((p) => `#${p.id} ${p.name} (${p.write_date}، ${p.x_contact_class || "—"}${p.active ? "" : "، مؤرشف"})`).join("؛ ") || "لا أحد"}`);
L.push("", `## 5. الجدولة على sim (${inv.length} تشغيلاً)`, "", "| الموعد (UTC) | اليوم | التشغيلات | الحالات |", "|---|---|---|---|");
for (const [c, days] of Object.entries(byCron)) for (const [d, v] of Object.entries(days)) L.push(`| \`${c}\` | ${d} | ${v.runs} | ${Object.entries(v.statuses).map(([s, n]) => `${s} ${n}`).join("، ")} |`);
L.push("", `**أيام الأسعار:** ${priceDays.map((d) => `${d.x_date} = ${d.x_state}${d.x_utak_simulation ? " (محاكاة)" : ""}`).join("؛ ") || "لا سجل"}`);
writeFileSync(new URL("scripts/artifacts/s44-20260928-report.md", root), L.join("\n") + "\n");
console.log(L.join("\n"));
