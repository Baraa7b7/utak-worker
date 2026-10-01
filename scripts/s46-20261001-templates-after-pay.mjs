// § 46 هـ-4 (2026-10-01) — read-only: the outbound WhatsApp rows of today (Riyadh) in x_wa_message,
// the 131042 refusals (Meta: the WhatsApp Business account's payment problem), and the first
// template Meta accepted after Baraa's payment (05:20 Riyadh). search_read only; numbers masked.
//
//   node scripts/s46-20261001-templates-after-pay.mjs [--since=HH:MM]
//
// Out: scripts/artifacts/s46-20261001-templates-after-pay.json
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const SINCE = (process.argv.find((a) => a.startsWith("--since=")) ?? "--since=05:20").slice(8);
const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const riyadh = (utc) => new Date(Date.parse(String(utc).replace(" ", "T") + "Z") + 3 * 3600_000).toISOString().slice(5, 16).replace("T", " ");
const fromUtc = new Date(Date.parse(`${day}T00:00:00Z`) - 3 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
const sinceUtc = new Date(Date.parse(`${day}T${SINCE}:00Z`) - 3 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
const f = await call("x_wa_message", "fields_get", { attributes: ["type"] });
const want = ["id", "create_date", "x_direction", "x_kind", "x_status", "x_meta_error", "x_partner_id", "x_source", "x_debug_payload", "x_purpose", "x_body", "x_meta_message_id", "x_utak_simulation"].filter((k) => k in f);
const rows = await call("x_wa_message", "search_read", { domain: [["create_date", ">=", fromUtc], ["x_direction", "=", "out"]], fields: want, order: "id asc", limit: 2000 });
const tpl = (r) => { try { return JSON.parse(r.x_debug_payload || "{}").template ?? null; } catch { return null; } };
const view = rows.map((r) => ({
  id: r.id, at: riyadh(r.create_date), kind: r.x_kind, status: r.x_status, template: tpl(r), purpose: r.x_purpose || null,
  partner: Array.isArray(r.x_partner_id) ? `#${r.x_partner_id[0]} ${r.x_partner_id[1]}` : null, error: r.x_meta_error ? String(r.x_meta_error).slice(0, 140) : null,
  afterPay: r.create_date >= sinceUtc,
}));
for (const v of view) console.log(`#${v.id} ${v.at} ${v.kind}${v.template ? ` ${v.template}` : ""} → ${v.status}${v.purpose ? ` [${v.purpose}]` : ""} · ${v.partner ?? "-"}${v.error ? ` · ${v.error}` : ""}`);
const templates = view.filter((v) => v.kind === "template" || v.template);
const ok = (v) => ["sent", "delivered", "read"].includes(v.status);
const refused = view.filter((v) => /131042/.test(v.error ?? ""));
const after = templates.filter((v) => v.afterPay);
const firstOk = after.find(ok) ?? null;
const out = { day, since: SINCE, outbound: view.length, templates: templates.length, refused131042: refused.length, firstRefusal: refused[0] ?? null, lastRefusal: refused.at(-1) ?? null, templatesAfterPay: after.length, firstAcceptedAfterPay: firstOk, rows: view };
console.log(`\nاليوم ${day}: صادر ${view.length}، قوالب ${templates.length}، مرفوض 131042: ${refused.length}${refused.length ? ` (أولها ${refused[0].at}، وآخرها ${refused.at(-1).at})` : ""}`);
console.log(`بعد ${SINCE}: قوالب ${after.length}${firstOk ? ` — أول قالب نجح: ${firstOk.template ?? "?"} الساعة ${firstOk.at} (${firstOk.status})` : " — لا قالب أُرسل ونجح بعد"}`);
writeFileSync(new URL("./artifacts/s46-20261001-templates-after-pay.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
