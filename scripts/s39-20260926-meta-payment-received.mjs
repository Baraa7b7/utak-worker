// STATUS § 39 د (م10) — utak_payment_received at Meta, read only (GET), next to its Odoo row.
//
//   node scripts/s39-20260926-meta-payment-received.mjs [label]
//
// Meta: GET /message_templates?name=… only — no create, edit, delete or re-submit.
// Odoo: search_read only. Out: scripts/artifacts/s39-20260926-meta-payment-received-<label>.json
import { readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const label = process.argv[2] || "before";
const NAME = "utak_payment_received";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const V = "v22.0", WABA = "2144001136512196";
const url = `https://graph.facebook.com/${V}/${WABA}/message_templates?name=${NAME}&fields=id,name,language,status,category,previous_category,rejected_reason,quality_score,components`;
const r = await fetch(url, { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } });
const j = await r.json();
if (!r.ok) throw new Error(`Meta GET ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
const meta = (j.data ?? []).filter((t) => t.name === NAME);
const rows = await call("x_whatsapp_template", "search_read", {
  domain: [["x_meta_template_id", "=", NAME]],
  fields: ["id", "x_meta_template_id", "x_language", "x_meta_status", "x_category", "x_purpose", "x_param_count", "x_body_text"],
  context: { active_test: false },
});
const out = {
  label, at: new Date().toISOString(),
  meta: meta.map((t) => {
    const body = (t.components ?? []).find((c) => c.type === "BODY");
    return {
      id: t.id, language: t.language, status: t.status, category: t.category, previous_category: t.previous_category ?? null,
      rejected_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null, quality: t.quality_score?.score ?? null,
      body: body?.text ?? null, variables: (String(body?.text ?? "").match(/\{\{\d+\}\}/g) ?? []).length, example: body?.example?.body_text?.[0] ?? null,
      buttons: (t.components ?? []).filter((c) => c.type === "BUTTONS").flatMap((c) => c.buttons ?? []),
    };
  }),
  odoo: rows,
};
writeFileSync(new URL(`./artifacts/s39-20260926-meta-payment-received-${label}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
