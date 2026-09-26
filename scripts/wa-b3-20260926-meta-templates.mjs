// الدفعة 3 (§ 38) — every UTAK template at Meta, read only (GET), next to its Odoo row.
//
//   node scripts/wa-b3-20260926-meta-templates.mjs <label>
//
// Meta: GET /message_templates only — no create, edit, delete or re-submit.
// Odoo: search_read only. Out: scripts/artifacts/wa-b3-20260926-meta-templates-<label>.json
import { readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const label = process.argv[2] || "snapshot";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const V = "v22.0", WABA = "2144001136512196";
const meta = [];
let url = `https://graph.facebook.com/${V}/${WABA}/message_templates?limit=100&fields=id,name,language,status,category,previous_category,rejected_reason,components`;
for (let page = 0; page < 20 && url; page++) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Meta GET ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  meta.push(...(j.data ?? []));
  url = j.paging?.next ?? null;
}
const rows = await call("x_whatsapp_template", "search_read", {
  domain: [],
  fields: ["id", "x_meta_template_id", "x_language", "x_meta_status", "x_category", "x_purpose", "x_missing_in_meta", "x_last_synced"],
  context: { active_test: false },
  limit: 500,
});
const byKey = new Map(rows.map((r) => [`${r.x_meta_template_id}::${String(r.x_language || "").toLowerCase()}`, r]));
const list = meta.map((t) => {
  const o = byKey.get(`${t.name}::${String(t.language || "").toLowerCase()}`) ?? null;
  const usable = t.status === "APPROVED" && t.category === "UTILITY";
  return {
    name: t.name, language: t.language, id: t.id, status: t.status, category: t.category,
    previous_category: t.previous_category ?? null, rejected_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
    usable_operational: usable,
    odoo: o ? { id: o.id, status: o.x_meta_status, category: o.x_category, purpose: o.x_purpose || null, in_sync: o.x_meta_status === t.status && o.x_category === t.category, last_synced: o.x_last_synced } : null,
    components: t.components,
  };
}).sort((a, b) => a.name.localeCompare(b.name));
const out = { label, at: new Date().toISOString(), fetched: meta.length, odooRows: rows.length, templates: list };
writeFileSync(new URL(`./artifacts/wa-b3-20260926-meta-templates-${label}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
for (const t of list) {
  console.log([t.name, t.language, t.status, t.category, t.previous_category ? `prev=${t.previous_category}` : "", t.usable_operational ? "USABLE" : "-",
    t.odoo ? `odoo#${t.odoo.id} ${t.odoo.status}/${t.odoo.category} purpose=${t.odoo.purpose} ${t.odoo.in_sync ? "sync" : "DIFF"}` : "odoo:none"].filter(Boolean).join(" | "));
}
console.log(`fetched ${meta.length}, odoo rows ${rows.length}`);
