// UTAK — تشخيص تكرار الرسائل الآلية (قراءة فقط)، 2026-09-23.
// يقرأ x_wa_message لآخر 14 يوماً ويجمّعها بالمستقبل + القالب/النص + الدقيقة،
// ويخرج كل حالة فيها رسالتان متطابقتان خلال 5 دقائق مع wamid لكل واحدة.
// لا يكتب شيئاً في Odoo ولا يرسل واتساب.
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_API_KEY } = env;
async function call(model, method, body) {
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ODOO_API_KEY}` },
    body: JSON.stringify(body),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${model}.${method} ${res.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

const since = new Date(Date.now() - 14 * 86400e3).toISOString().replace("T", " ").slice(0, 19);
const fieldsMeta = await call("x_wa_message", "fields_get", { attributes: ["type", "string"] });
const want = ["id", "create_date", "x_partner_id", "x_direction", "x_kind", "x_template_id", "x_body",
  "x_meta_message_id", "x_status", "x_source", "x_manual", "x_processed_at", "x_res_model", "x_res_id"];
const fields = want.filter((f) => f in fieldsMeta);
const rows = await call("x_wa_message", "search_read", {
  domain: [["create_date", ">=", since], ["x_direction", "=", "out"]],
  fields, order: "create_date asc, id asc", limit: 5000,
});
const partnerIds = [...new Set(rows.map((r) => r.x_partner_id && r.x_partner_id[0]).filter(Boolean))];
const partners = partnerIds.length ? await call("res.partner", "read", { ids: partnerIds, fields: ["id", "name", "x_whatsapp_number", "phone"] }) : [];
const pById = new Map(partners.map((p) => [p.id, p]));
const mask = (s) => { const d = String(s || "").replace(/\D/g, ""); return d ? "*".repeat(Math.max(0, d.length - 3)) + d.slice(-3) : "?"; };
const tpl = (r) => r.x_template_id ? r.x_template_id[1] : (String(r.x_body || "").match(/^📋 قالب: ([^ (]+)/)?.[1] ?? (String(r.x_body || "").match(/^\[(\w+)\]/)?.[1] ?? `text:${String(r.x_body || "").slice(0, 30)}`));

// زوجان متطابقان: نفس الشريك + نفس «القالب» + نفس النص، والفرق ≤ 5 دقائق
const toMs = (s) => Date.parse(s.replace(" ", "T") + "Z");
const groups = [];
const byKey = new Map();
for (const r of rows) {
  const pid = r.x_partner_id ? r.x_partner_id[0] : 0;
  const k = `${pid}|${tpl(r)}|${String(r.x_body || "").replace(/^\[\w+\] /, "").replace(/^📋 قالب: \S+ ?/, "").slice(0, 200)}`;
  const list = byKey.get(k) ?? [];
  list.push(r); byKey.set(k, list);
}
for (const [k, list] of byKey) {
  let cluster = [list[0]];
  const flush = () => { if (cluster.length > 1) groups.push({ key: k, rows: cluster }); };
  for (let i = 1; i < list.length; i++) {
    if (toMs(list[i].create_date) - toMs(cluster[0].create_date) <= 5 * 60e3) cluster.push(list[i]);
    else { flush(); cluster = [list[i]]; }
  }
  flush();
}
groups.sort((a, b) => a.rows[0].create_date.localeCompare(b.rows[0].create_date));
const out = groups.map((g) => {
  const r0 = g.rows[0];
  const p = r0.x_partner_id ? pById.get(r0.x_partner_id[0]) : null;
  const wamids = g.rows.map((r) => r.x_meta_message_id || null);
  const distinct = new Set(wamids.filter(Boolean));
  let verdict;
  if (distinct.size >= 2) verdict = "إرسال حقيقي مكرر (wamid مختلف)";
  else if (distinct.size === 1 && wamids.filter(Boolean).length >= 2) verdict = "تسجيل مكرر (نفس wamid)";
  else verdict = "تسجيل مكرر محتمل (wamid فارغ في صف أو أكثر)";
  return {
    date_utc: r0.create_date,
    partner: r0.x_partner_id ? `${r0.x_partner_id[0]}` : "-",
    phone: mask(p?.x_whatsapp_number || p?.phone),
    template: tpl(r0),
    count: g.rows.length,
    rows: g.rows.map((r) => ({ id: r.id, at: r.create_date, wamid: r.x_meta_message_id || null, source: r.x_source, status: r.x_status, body: String(r.x_body || "").slice(0, 60) })),
    verdict,
  };
});
const summary = { since, total_out: rows.length, dup_groups: out.length,
  with_wamid: rows.filter((r) => r.x_meta_message_id).length,
  without_wamid: rows.filter((r) => !r.x_meta_message_id).length };
console.log(JSON.stringify(summary, null, 2));
for (const g of out) {
  console.log(`\n${g.date_utc} | ${g.phone} (p${g.partner}) | ${g.template} | ×${g.count} | ${g.verdict}`);
  for (const r of g.rows) console.log(`   #${r.id} ${r.at} wamid=${r.wamid ?? "∅"} src=${r.source} st=${r.status} «${r.body}»`);
}
writeFileSync(new URL("./artifacts/dup-20260923-diag.json", import.meta.url), JSON.stringify({ summary, groups: out, fields }, null, 2));
