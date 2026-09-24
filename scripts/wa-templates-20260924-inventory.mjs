// جرد قوالب واتساب (قراءة فقط): Meta GET + Odoo search_read.
// لا يكتب شيئاً في Odoo ولا في Meta. المخرج: scripts/artifacts/wa-templates-20260924-inventory.json
import { readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const WABA = "2144001136512196";
const meta = [];
let url = `https://graph.facebook.com/v22.0/${WABA}/message_templates?limit=100&fields=id,name,language,status,category,components`;
while (url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } });
  if (!r.ok) throw new Error(`meta HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  meta.push(...(j.data ?? []));
  url = j.paging?.next ?? null;
}
const params = (s) => new Set((s.match(/\{\{\d+\}\}/g) ?? [])).size;
const metaRows = meta.map((t) => {
  const c = t.components ?? [];
  const body = c.find((x) => x.type === "BODY")?.text ?? "";
  const header = c.find((x) => x.type === "HEADER");
  const footer = c.find((x) => x.type === "FOOTER")?.text ?? "";
  const buttons = (c.find((x) => x.type === "BUTTONS")?.buttons ?? []).map((b) => `${b.type}:${b.text}`);
  return { name: t.name, language: t.language, status: t.status, category: t.category, id: t.id,
    params: params(body), header: header ? `${header.format}${header.text ? ":" + header.text : ""}` : "",
    body, footer, buttons };
}).sort((a, b) => a.name.localeCompare(b.name));

const odoo = await call("x_whatsapp_template", "search_read", {
  domain: [], limit: 500, order: "id",
  fields: ["id", "x_name", "x_meta_template_id", "x_language", "x_purpose", "x_label_ar", "x_param_count",
    "x_meta_status", "x_category", "x_missing_in_meta", "create_date", "write_date"],
});
const out = { at: new Date().toISOString(), meta: metaRows, odoo };
writeFileSync(new URL("./artifacts/wa-templates-20260924-inventory.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`meta=${metaRows.length} odoo=${odoo.length}`);
for (const m of metaRows) {
  const o = odoo.filter((r) => r.x_meta_template_id === m.name);
  console.log([m.name, m.status, m.category, m.language, `p=${m.params}`, m.header, `btn=${m.buttons.length}`,
    o.map((r) => `#${r.id} purpose=${r.x_purpose || "-"} pc=${r.x_param_count} label=${r.x_label_ar}`).join(" ; ") || "NO-ODOO"].join(" | "));
}
for (const r of odoo) if (!metaRows.some((m) => m.name === r.x_meta_template_id)) console.log("ODOO-ONLY", r);
