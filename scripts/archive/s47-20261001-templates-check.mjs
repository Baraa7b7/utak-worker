// § 47 أ (2026-10-01) — read-only: every WhatsApp template at Meta (GET message_templates, the token
// of .env.sim-verify, never printed) and in Odoo (x_whatsapp_template), searched for «شامل» and
// «ضريب»: a template approved by Meta is never changed or replaced here — its text is reported.
// And the texts of the templates that ask a supplier for prices, as they are.
//
//   node scripts/archive/s47-20261001-templates-check.mjs
//
// Out: scripts/artifacts/s47-20261001-templates-check.json
import { readFileSync, writeFileSync } from "node:fs";
import { call } from "../lib/odoo-cli.mjs";

const root = new URL("../../", import.meta.url);
const env = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const WABA = "2144001136512196";
const all = [];
let url = `https://graph.facebook.com/v22.0/${WABA}/message_templates?fields=name,status,category,language,components&limit=100`;
while (url) {
  const j = await (await fetch(url, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } })).json();
  if (j.error) throw new Error(`Meta: ${j.error.message}`);
  all.push(...(j.data ?? []));
  url = j.paging?.next ?? null;
}
const text = (t) => (t.components ?? []).map((c) => [c.text ?? "", ...(c.buttons ?? []).map((b) => b.text ?? "")].join(" ")).join("\n");
const hit = (s) => /شامل|ضريب|VAT|tax/i.test(s);
const meta = all.map((t) => ({ name: t.name, status: t.status, category: t.category, language: t.language, text: text(t) }));
const inclusive = meta.filter((t) => hit(t.text));
const asks = meta.filter((t) => /supplier_(ask|daily_ask|price_nudge)|market/.test(t.name));
console.log(`Meta: ${meta.length} قالباً · يذكر «شامل» أو «ضريب»: ${inclusive.length}`);
for (const t of inclusive) console.log(`  • ${t.name} (${t.status} / ${t.category}): ${t.text.replace(/\n/g, " ⏎ ")}`);
console.log("قوالب طلب الأسعار من المورد (نصها كما هو):");
for (const t of asks) console.log(`  • ${t.name} (${t.status} / ${t.category}): ${t.text.replace(/\n/g, " ⏎ ")}`);
const rows = await call("x_whatsapp_template", "search_read", { domain: [], fields: [], context: { active_test: false } });
const odooHits = rows.filter((r) => hit(JSON.stringify(r)));
console.log(`Odoo x_whatsapp_template: ${rows.length} صفاً · يذكر «شامل» أو «ضريب»: ${odooHits.length}`);
for (const r of odooHits) console.log(`  • #${r.id} ${r.x_meta_template_id}: ${String(r.x_body_text ?? "").replace(/\n/g, " ⏎ ")}`);
writeFileSync(new URL("scripts/artifacts/s47-20261001-templates-check.json", root), JSON.stringify({ at: new Date().toISOString(), metaCount: meta.length, inclusive, asks, odooCount: rows.length, odooHits: odooHits.map((r) => ({ id: r.id, name: r.x_meta_template_id, body: r.x_body_text })) }, null, 2) + "\n");
