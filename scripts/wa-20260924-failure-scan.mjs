// فحص سجل x_wa_message بحثاً عن كل فشل إرسال (قراءة فقط). 2026-09-24.
//   node --experimental-strip-types scripts/wa-20260924-failure-scan.mjs
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const rows = await call("x_wa_message", "search_read", {
  domain: ["|", ["x_status", "=", "failed"], ["x_meta_error", "!=", false]],
  fields: ["id", "create_date", "x_partner_id", "x_direction", "x_kind", "x_status", "x_body", "x_meta_error", "x_source", "x_manual"],
  order: "id asc",
  limit: 2000,
});
const total = await call("x_wa_message", "search_count", { domain: [["x_direction", "=", "out"]] });
const code = (e) => (/(\d{5,6})/.exec(String(e || "")) || [, "?"])[1];
const tpl = (b) => (/📋 قالب: ([A-Za-z0-9_]+)/.exec(String(b || "")) || [, null])[1];
const groups = {};
for (const r of rows) {
  const k = `${tpl(r.x_body) ?? r.x_kind}|${code(r.x_meta_error)}`;
  (groups[k] ??= { what: tpl(r.x_body) ?? r.x_kind, code: code(r.x_meta_error), n: 0, first: r.create_date, last: r.create_date, sample: String(r.x_meta_error || "").slice(0, 160), ids: [] });
  const g = groups[k]; g.n++; g.last = r.create_date; if (g.ids.length < 5) g.ids.push(r.id);
}
const out = { at: new Date().toISOString(), outboundRows: total, failedRows: rows.length, groups: Object.values(groups).sort((a, b) => b.n - a.n) };
writeFileSync(new URL("./artifacts/wa-20260924-failure-scan.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
