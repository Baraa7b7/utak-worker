// م5 (2026-09-25): the one Odoo write the late-supplier reminder needs.
//
//   1. the selection value `supplier_price_nudge` on x_whatsapp_template.x_purpose;
//   2. template #48 `utak_supplier_price_nudge` (APPROVED / UTILITY at Meta,
//      2 variables: supplier name + the time the prices are needed) set to it.
//
// Checks #48 against Meta first (GET only): APPROVED, UTILITY, 2 variables —
// otherwise nothing is written. Idempotent. The "before" is saved first.
// No WhatsApp send.
//
//   node scripts/wa-20260925-supplier-nudge-purpose.mjs [--dry-run]
//   node scripts/wa-20260925-supplier-nudge-purpose.mjs --rollback [--dry-run]
//
// Rollback: scripts/artifacts/wa-20260925-supplier-nudge-purpose-rollback.json
//   (#48 back to its old purpose; the selection value removed only if we added
//   it and no row uses it any more).

import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com") && (init?.method ?? "GET") !== "GET") throw new Error("BLOCKED: Graph is GET only");
  return realFetch(input, init);
};

const DRY = process.argv.includes("--dry-run");
const ROLLBACK = process.argv.includes("--rollback");
const RB = new URL("./artifacts/wa-20260925-supplier-nudge-purpose-rollback.json", import.meta.url).pathname;
const PURPOSE = "supplier_price_nudge";
const TEMPLATE_ID = 48;
const NAME = "utak_supplier_price_nudge";
const log = (...a) => console.log(...a);

const [field] = await call("ir.model.fields", "search_read", {
  domain: [["model", "=", "x_whatsapp_template"], ["name", "=", "x_purpose"]], fields: ["id", "ttype"],
});
if (!field || field.ttype !== "selection") throw new Error("x_purpose selection field not found");

if (ROLLBACK) {
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  log(`#${TEMPLATE_ID}: x_purpose ← ${rb.before.x_purpose}`);
  if (!DRY) await call("x_whatsapp_template", "write", { ids: [TEMPLATE_ID], vals: { x_purpose: rb.before.x_purpose } });
  if (rb.selectionCreated) {
    const used = await call("x_whatsapp_template", "search_count", { domain: [["x_purpose", "=", PURPOSE]] });
    if (used && !DRY) log(`keep selection ${PURPOSE}: ${used} row(s) still use it`);
    else { log(`remove selection ${PURPOSE} #${rb.selectionCreated}`); if (!DRY) await call("ir.model.fields.selection", "unlink", { ids: [rb.selectionCreated] }); }
  }
  log(DRY ? "dry-run: nothing written" : "rollback done");
  process.exit(0);
}

// Meta (GET): the template must be usable before a purpose points at it.
const r = await fetch(`https://graph.facebook.com/v22.0/2144001136512196/message_templates?name=${NAME}&fields=name,status,category,components`, {
  headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
});
const meta = (await r.json()).data?.find((t) => t.name === NAME);
const body = meta?.components?.find((c) => c.type === "BODY")?.text ?? "";
const vars = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
log(`Meta ${NAME}: ${meta?.status}/${meta?.category}, ${vars} variable(s) — «${body}»`);
if (meta?.status !== "APPROVED" || meta?.category !== "UTILITY" || vars !== 2) throw new Error("not APPROVED/UTILITY with 2 variables — nothing written");

const [row] = await call("x_whatsapp_template", "read", { ids: [TEMPLATE_ID], fields: ["id", "x_meta_template_id", "x_purpose", "x_param_count", "x_meta_status", "x_category"] });
if (row?.x_meta_template_id !== NAME) throw new Error(`#${TEMPLATE_ID} is not ${NAME}: ${JSON.stringify(row)}`);
const holders = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", PURPOSE]], fields: ["id", "x_meta_template_id"] }).catch(() => []);
log(`#${TEMPLATE_ID} now: purpose=${row.x_purpose}; other rows on ${PURPOSE}: ${holders.filter((h) => h.id !== TEMPLATE_ID).map((h) => `#${h.id}`).join(",") || "none"}`);
if (holders.some((h) => h.id !== TEMPLATE_ID)) throw new Error(`${PURPOSE} is already on another template — stop`);

const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/wa-20260925-supplier-nudge-purpose.mjs", createdAt: new Date().toISOString(), before: { x_purpose: row.x_purpose }, selectionCreated: null };
if (!DRY) writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");

const sel = await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", field.id], ["value", "=", PURPOSE]], fields: ["id"] });
if (sel.length) log(`= selection ${PURPOSE} exists #${sel[0].id}`);
else {
  log(`+ selection ${PURPOSE}`);
  if (!DRY) {
    const id = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: field.id, value: PURPOSE, name: "Supplier late-price reminder (05:00)" }] });
    rb.selectionCreated = Array.isArray(id) ? id[0] : id;
    writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
  }
}
if (row.x_purpose === PURPOSE) log(`= #${TEMPLATE_ID} already on ${PURPOSE}`);
else {
  log(`✎ #${TEMPLATE_ID} x_purpose: ${row.x_purpose} → ${PURPOSE}`);
  if (!DRY) await call("x_whatsapp_template", "write", { ids: [TEMPLATE_ID], vals: { x_purpose: PURPOSE, x_meta_status: meta.status, x_category: meta.category, x_param_count: vars } });
}
if (DRY) { log("dry-run: nothing written"); process.exit(0); }
const after = await call("x_whatsapp_template", "search_read", { domain: [["x_purpose", "=", PURPOSE]], fields: ["id", "x_meta_template_id", "x_meta_status", "x_param_count"] });
const ok = after.length === 1 && after[0].id === TEMPLATE_ID && after[0].x_param_count === 2;
log(`verify: ${JSON.stringify(after)} ${ok ? "✅" : "❌"}`);
if (!ok) process.exit(1);
