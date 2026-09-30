// The single send gateway (STATUS § 33) — read-only analysis of the real send
// log, 2026-09-25. Reads scripts/artifacts/gw-20260925-scan.json (written by
// scripts/gw-20260925-scan.mjs from Odoo and D1; nothing else is contacted).
//
//   (1) every Meta refusal of the last 14 days (the «⚠️ ما انرسلت» lines in the
//       WhatsApp channels + failed x_wa_message rows): its cause, its path, and
//       whether the gateway would have prevented it;
//   (2) replay: every real send attempt of the last 7 days through the
//       gateway's decision (src/wa-gateway.ts rules, applied to the logged
//       attempt): how many Meta actually refused, and how many the gateway
//       would have sent as text, as a template, held, or skipped.
//
// The window at each attempt is rebuilt from the inbound rows' x_processed_at
// (Meta's timestamp since 09-20), 10-minute margin, per number. Categories are
// the templates' Meta categories as stored today (x_whatsapp_template).
//
//   node scripts/gw-20260925-analyze.mjs
//
// Out: scripts/artifacts/gw-20260925-analysis.{md,json}

import { readFileSync, writeFileSync } from "node:fs";

const snap = JSON.parse(readFileSync(new URL("./artifacts/gw-20260925-scan.json", import.meta.url), "utf8"));
const OWNER = "966505154962";
const DAY = 24 * 3600e3, MARGIN = 10 * 60e3;
const NOW = Date.parse(snap.at);
const SINCE14 = NOW - 14 * DAY, SINCE7 = NOW - 7 * DAY;
const odoo = (v) => (v ? Date.parse(String(v).replace(" ", "T") + "Z") : NaN);
const digits = (v) => String(v || "").replace(/\D/g, "");
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const riyadh = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

// ---- numbers
const partnerNum = new Map(snap.partners.map((p) => [p.id, digits(p.x_whatsapp_number || p.phone)]));
const channelNum = new Map(snap.waChannels.map((c) => [c.id, digits((/\+[\d ]+/.exec(c.name.replace(/[⁦⁩]/g, "")) || [""])[0])]));

// ---- templates: name → { purpose, category }
const TPL = new Map(snap.templates.map((t) => [t.x_meta_template_id, { purpose: t.x_purpose || "other", category: t.x_category || "?" }]));
const MARKETING_PURPOSES = new Set(["customer_feedback", "customer_inactive"]);
const LEGACY_PURPOSE = { utak_v2_inactive: "customer_inactive", utak_feedback: "customer_feedback", utak_v2_welcome: "customer_welcome",
  utak_supplier_daily_ask: "supplier_ask", utak_owner_alert: "owner_alert", utak_delivery_done: "customer_delivery_done" };

// ---- inbound Meta timestamps per number (x_processed_at on inbound rows)
const inbound = new Map();
for (const m of snap.messages) {
  if (m.x_direction !== "in" || !m.x_partner_id) continue;
  const n = partnerNum.get(m.x_partner_id[0]);
  const t = odoo(m.x_processed_at) || odoo(m.create_date);
  if (!n || !Number.isFinite(t)) continue;
  (inbound.get(n) ?? inbound.set(n, []).get(n)).push({ meta: t, arrived: odoo(m.create_date), body: m.x_body });
}
for (const list of inbound.values()) list.sort((a, b) => a.meta - b.meta);
function windowAt(n, t) {
  const list = inbound.get(n) ?? [];
  let last = 0;
  for (const i of list) if (i.meta <= t && i.arrived <= t) last = Math.max(last, i.meta);
  return { open: last > 0 && t < last + DAY - MARGIN, last };
}
function arrivedJustBefore(n, t, secs = 120) {
  return (inbound.get(n) ?? []).find((i) => i.arrived <= t && t - i.arrived <= secs * 1000) ?? null;
}

// ---- send attempts (last 7 days): D1 (sim / pilot) + x_wa_message rows not in D1 (prod, manual)
const attempts = [];
const d1Wamids = new Set();
for (const r of snap.d1) {
  if (r.ts_ms < SINCE7) continue;
  d1Wamids.add(r.wamid);
  attempts.push({ src: `D1#${r.id}`, t: r.ts_ms, to: digits(r.to_number), type: r.msg_type, template: r.template_name || null, body: String(r.body_text || "").slice(0, 90), wamid: r.wamid });
}
const d1Near = (to, t, body) => attempts.some((a) => a.src.startsWith("D1") && a.to === to && Math.abs(a.t - t) < 20e3 && (!body || a.body.slice(0, 20) === body.slice(0, 20) || a.template));
for (const m of snap.messages) {
  if (m.x_direction !== "out") continue;
  const t = odoo(m.create_date);
  if (t < SINCE7) continue;
  const body = String(m.x_body || "");
  if (/^\[[a-z_]+\] /.test(body)) continue;                     // the old second log of one send (removed 09-23)
  if (m.x_meta_message_id && d1Wamids.has(m.x_meta_message_id)) continue;
  const to = m.x_partner_id ? partnerNum.get(m.x_partner_id[0]) : "";
  const template = (/📋 قالب: ([A-Za-z0-9_]+)/.exec(body) || [])[1] ?? null;
  if (to && d1Near(to, t, template ? null : body)) continue;
  attempts.push({ src: `XW#${m.id}`, t, to: to || "?", type: template ? "template" : m.x_kind, template, body: body.slice(0, 90), wamid: m.x_meta_message_id || null, row: m });
}
attempts.sort((a, b) => a.t - b.t);

// ---- refusals (the channel lines and the failed rows), with the known late reports
const failLines = snap.timeline
  .filter((m) => /ما انرسلت/.test(strip(m.body)) && odoo(m.date) >= SINCE14)
  .map((m) => {
    const text = strip(m.body);
    return { id: m.id, t: odoo(m.date), to: channelNum.get(m.res_id), code: (/(1\d{5})/.exec(text) || [, text.includes("انتهت نافذة") ? "window-refused" : "other"])[1], text };
  });
// Late / duplicate status reports, identified one by one (§ 33 a).
const LATE = {
  2011: { attempt: "XW#40", note: "late status (7h54m) for the 18:00 «لا توجد فواتير» text of 09-20" },
  2029: { attempt: "XW#41", note: "late status (11h34m) for the 18:00 «لا توجد فواتير» text of 09-20" },
  2024: { attempt: "XW#16", note: "late status (55h) for the manual quotation document S00005 of 09-18 (row 16, written 09-21 00:50:07)" },
  2030: { duplicate: 2011, note: "the same status as #2011 delivered again (no session send to him in between was outside the window)" },
  2114: { duplicate: 2029, note: "the same status as #2029 delivered again (no send to this number since)" },
  2130: { duplicate: 2127, note: "the same status as #2122/#2127 (09-21 18:00 texts) delivered again" },
};

function classify(att) {
  // purpose + kind
  const tpl = att.template ? (TPL.get(att.template) ?? { purpose: LEGACY_PURPOSE[att.template] ?? "other", category: "?" }) : null;
  const purpose = tpl ? (tpl.purpose !== "other" ? tpl.purpose : LEGACY_PURPOSE[att.template] ?? "other")
    : att.to === OWNER ? "owner_alert"
    : arrivedJustBefore(att.to, att.t) ? "bot_reply" : "operational_text";
  const win = windowAt(att.to, att.t);
  let decision;
  if (tpl) {
    const marketingPurpose = MARKETING_PURPOSES.has(purpose);
    if (tpl.category === "UTILITY" || (tpl.category === "MARKETING" && marketingPurpose)) decision = "template";
    else if (purpose === "owner_alert" || purpose === "customer_delivery_done") decision = win.open ? "text" : "held";
    else decision = "skipped"; // an operational purpose whose only template is MARKETING, no session alternative
  } else {
    decision = win.open ? "text" : "held";
  }
  return { purpose, category: tpl?.category ?? "-", window: win.open ? "open" : "closed", lastInbound: win.last ? riyadh(win.last) : "-", decision };
}

// actual outcome of each attempt — one refusal per attempt, one attempt per refusal:
//   1. a failed x_wa_message row carrying the attempt's wamid;
//   2. the known late reports (LATE);
//   3. each remaining channel line to the latest earlier attempt to that number
//      (within 60 s) whose type fits the code (131047 = free-form only;
//      131049 / 132018 = templates only) and that has no refusal yet.
const lateByAttempt = new Map(Object.entries(LATE).filter(([, v]) => v.attempt).map(([k, v]) => [v.attempt, Number(k)]));
for (const a of attempts) {
  Object.assign(a, classify(a));
  a.t_riyadh = riyadh(a.t);
  a.actual = "accepted";
  a.failLine = null;
  const row = a.row ?? snap.messages.find((m) => m.x_meta_message_id && m.x_meta_message_id === a.wamid);
  if (row?.x_status === "failed") {
    const err = String(row.x_meta_error || "");
    // a local refusal (allowlist), not Meta: the gateway refuses it the same way, before any window decision
    if (/SIM_ALLOWLIST/.test(err)) { a.actual = "blocked (allowlist)"; a.decision = "refused (allowlist)"; }
    else a.actual = `refused ${(/(1\d{5})/.exec(err) || [, "?"])[1]}`;
  }
  const late = lateByAttempt.get(a.src);
  if (late) { a.actual = "refused 131047"; a.failLine = late; }
}
const fits = (code, a) => (code === "131047" ? !a.template : code === "131049" || code === "132018" ? !!a.template : true);
for (const f of failLines.filter((f) => !LATE[f.id] && f.code !== "window-refused").sort((x, y) => x.t - y.t)) {
  const cand = attempts
    .filter((a) => a.to === f.to && a.t <= f.t + 2e3 && f.t - a.t <= 60e3 && fits(f.code, a) && a.failLine === null)
    .sort((x, y) => y.t - x.t);
  // an attempt already known refused with this code (its row) takes the line first
  const hit = cand.find((a) => a.actual === `refused ${f.code}`) ?? cand.find((a) => a.actual === "accepted");
  if (!hit) continue;
  hit.actual = `refused ${f.code}`;
  hit.failLine = f.id;
}

// ---- the gateway's memory of refusals, replayed in order: after a 131049 that
// template does not go to that number again that Riyadh day; after another
// Meta refusal an automatic purpose does not go to that number for 24h.
// (131047 cannot happen once the decision is «held»: a sent text had an open window.)
{
  const tplBlock = new Set(), purposeBlock = new Map();
  const dayOf = (t) => riyadh(t).slice(0, 10);
  for (const a of attempts) {
    const sendsNow = a.decision === "template" || a.decision === "text";
    if (!sendsNow) continue;
    if (a.template && tplBlock.has(`${a.to}|${a.template}|${dayOf(a.t)}`)) { a.decision = "skipped (131049 today)"; continue; }
    const pb = purposeBlock.get(`${a.to}|${a.purpose}`);
    if (pb && a.t - pb < DAY && a.purpose !== "bot_reply") { a.decision = "skipped (refused <24h)"; continue; }
    if (a.actual === "refused 131049" && a.template) tplBlock.add(`${a.to}|${a.template}|${dayOf(a.t)}`);
    else if (a.actual.startsWith("refused") && a.actual !== "refused 131047") purposeBlock.set(`${a.to}|${a.purpose}`, a.t);
  }
}

// ---- (1) the refusals of 14 days
function causeOf(f) {
  const lateInfo = LATE[f.id];
  if (lateInfo?.duplicate) return { cause: "a duplicate status delivery", path: "status webhook", gateway: `handled once (no second line): ${lateInfo.note}` };
  const a = lateInfo?.attempt ? attempts.find((x) => x.src === lateInfo.attempt) : attempts.find((x) => x.failLine === f.id);
  f.attempt = a?.src ?? null;
  const inb = a ? arrivedJustBefore(a.to, a.t) : null;
  if (f.code === "window-refused") return { cause: "Baraa's Discuss reply outside the window (refused, not sent)", path: "wa-inbox-reply", gateway: "held for the contact, sent at the next message" };
  if (f.code === "131049") {
    const tpl = a?.template ?? (f.to === OWNER ? "utak_owner_alert" : "utak_v2_inactive/utak_feedback");
    return f.to === OWNER || tpl === "utak_owner_alert"
      ? { cause: "Baraa's alert as the MARKETING utak_owner_alert (Meta's marketing cap)", path: "sendOwnerAlert", gateway: "never that template: text inside his window, held for his tap outside it" }
      : { cause: `marketing template ${tpl} dropped by Meta's marketing cap`, path: "08:00 outreach", gateway: "still sent (marketing purpose); after a 131049 not that template to that number again that day" };
  }
  if (f.code === "132018") return { cause: "template variables refused (multi-line list)", path: "18:00 collection summary", gateway: "sanitized since ح1; and after a refusal no text fallback (one attempt)" };
  if (f.code === "131047") {
    if (lateInfo?.attempt) return { cause: `free-form ${a?.type ?? "text"} outside the window — ${lateInfo.note}`, path: a?.type === "document" ? "manual x_wa_message send" : "18:00 «nothing to collect» text", gateway: "held (window closed by Meta's timestamp) — never sent" };
    if (inb && a && inb.meta < a.t - DAY) return { cause: `reply to a message Meta re-delivered ${Math.round((a.t - inb.meta) / 3600e3)}h late`, path: "bot reply (§ 29)", gateway: "held: the window is computed from Meta's timestamp, a late message does not open it" };
    if (a && /قائمة التحصيل|لا توجد فواتير/.test(a.body)) return { cause: "18:00 collection text outside the window (the template had just failed)", path: "18:00 collection summary text fallback", gateway: "no text after a refused template; outside the window it would be held" };
    return { cause: "free-form text outside the window", path: a ? `${a.purpose}` : "?", gateway: "held" };
  }
  return { cause: f.text.slice(0, 80), path: "?", gateway: "recorded; purpose blocked 24h for that number" };
}
const refusals = failLines.map((f) => ({ ...f, when: riyadh(f.t), ...causeOf(f) }));
const failedRows14 = snap.failedRows.filter((r) => odoo(r.create_date) >= SINCE14);

// ---- (2) the replay summary
const last7 = attempts;
const count = (arr, k) => arr.reduce((m, a) => ((m[a[k]] = (m[a[k]] ?? 0) + 1), m), {});
const refused7 = last7.filter((a) => a.actual.startsWith("refused"));
const summary = {
  attempts: last7.length,
  actual: count(last7, "actual"),
  gateway: count(last7, "decision"),
  refusedByGateway: count(refused7, "decision"),
  byPurpose: Object.fromEntries(Object.entries(last7.reduce((m, a) => {
    (m[a.purpose] ??= {})[a.decision] = ((m[a.purpose] ??= {})[a.decision] ?? 0) + 1;
    return m;
  }, {}))),
};

// numbers are masked to their last four digits in the committed output
const mask = (n) => (n ? `…${String(n).replace(/\D/g, "").slice(-4)}` : n);
const masked = (o) => ({ ...o, to: mask(o.to), ...(o.body ? { body: String(o.body).replace(/\+?\d{9,15}/g, (d) => mask(d)) } : {}) });
const out = {
  at: snap.at,
  since14: riyadh(SINCE14), since7: riyadh(SINCE7),
  refusals14: { lines: refusals.length, byCode: count(refusals, "code"), rows: failedRows14.length, list: refusals.map(masked) },
  replay7: { summary, refused: refused7.map(({ row, ...a }) => masked(a)), attempts: last7.map(({ row, ...a }) => masked(a)) },
};
writeFileSync(new URL("./artifacts/gw-20260925-analysis.json", import.meta.url), JSON.stringify(out, null, 1));

const DECISIONS = ["text", "template", "held", "skipped", "skipped (131049 today)", "skipped (refused <24h)", "refused (allowlist)"];
const md = [
  `# تحليل الإرسال — البوابة الموحّدة (STATUS § 33)`,
  ``,
  `اللقطة: ${snap.at} (قراءة فقط). أسطر الرفض منذ ${out.since14}، والمحاولات منذ ${out.since7} (الرياض).`,
  ``,
  `## (1) رفض Meta في 14 يوماً: ${refusals.length} سطراً في القنوات`,
  ``,
  `| # | الوقت | الرقم | الرمز | المحاولة | السبب | المسار | البوابة |`,
  `|---|---|---|---|---|---|---|---|`,
  ...refusals.map((r) => `| ${r.id} | ${r.when} | …${String(r.to).slice(-4)} | ${r.code} | ${r.attempt ?? "-"} | ${r.cause} | ${r.path} | ${r.gateway} |`),
  ``,
  `## (2) إعادة التشغيل: ${last7.length} محاولة إرسال في 7 أيام`,
  ``,
  `- الفعلي: ${Object.entries(summary.actual).map(([k, v]) => `${k} = ${v}`).join("، ")}`,
  `- البوابة: ${Object.entries(summary.gateway).map(([k, v]) => `${k} = ${v}`).join("، ")}`,
  `- المرفوض فعلاً عند البوابة: ${Object.entries(summary.refusedByGateway).map(([k, v]) => `${k} = ${v}`).join("، ")}`,
  ``,
  `| الغرض | ${DECISIONS.join(" | ")} |`,
  `|${DECISIONS.map(() => "---").join("|")}|---|`,
  ...Object.entries(summary.byPurpose).map(([p, v]) => `| ${p} | ${DECISIONS.map((k) => v[k] ?? 0).join(" | ")} |`),
  ``,
  `### المرفوض فعلاً في 7 أيام، وقرار البوابة فيه`,
  ``,
  `| المصدر | الوقت | الرقم | النوع | الغرض | النافذة (آخر وارد) | الفعلي | البوابة |`,
  `|---|---|---|---|---|---|---|---|`,
  ...refused7.map((a) => `| ${a.src} | ${a.t_riyadh} | …${a.to.slice(-4)} | ${a.template ?? a.type} | ${a.purpose} | ${a.window} (${a.lastInbound}) | ${a.actual} | ${a.decision} |`),
  ``,
].join("\n");
writeFileSync(new URL("./artifacts/gw-20260925-analysis.md", import.meta.url), md);
console.log(JSON.stringify({ refusals14: out.refusals14.byCode, replay7: summary }, null, 1));
