// § 57 هـ + ز (2026-10-05) — the fields and the views the complaint form and the supplier's
// registration need (scripts/lib/s57-odoo.mjs is the data):
//
//   1  x_complaint: x_kind, x_order_line_id, x_product_tmpl_id, x_affected_qty, x_photo, x_decision, x_decided_at
//   2  res.partner: x_cr_number «السجل التجاري»
//   3  three extension views: the complaint's form and list, the partner's form (after «VAT»)
//
//   node scripts/s57-20261005-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s57-20261005-odoo.mjs --apply            the three steps (the rollback file first)
//   node scripts/s57-20261005-odoo.mjs --verify           read-only checks
//   node scripts/s57-20261005-odoo.mjs --rollback [--apply]          the three views switched off. The fields stay (the worker writes them).
//   node scripts/s57-20261005-odoo.mjs --rollback --drop [--apply]   and delete the views and the fields — by Baraa's decision
//                                                         only, AFTER the worker's code is rolled back.
// Rollback file: scripts/artifacts/s57-20261005-odoo-rollback.json. The tenant is production. No
// WhatsApp send. No complaint, partner, invoice or payment is written here: fields and three views.
// APPLY THIS BEFORE THE WORKER'S CODE IS DEPLOYED: the forms' «إرسال» writes the fields.
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, ensureView, log, modelId, rollbackFile } from "./lib/s40-kit.mjs";
import { COMPLAINT_FIELDS, COMPLAINT_MODEL, DECISION_OPTIONS, KIND_OPTIONS, PARTNER_FIELDS, PARTNER_MODEL, VIEWS } from "./lib/s57-odoo.mjs";

const RB = new URL("./artifacts/s57-20261005-odoo-rollback.json", import.meta.url);
const ALL = { active_test: false };
const ctx = rollbackFile(RB, "scripts/s57-20261005-odoo.mjs");
const { rb, save } = ctx;
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const viewOf = async (name, model) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name], ["model", "=", model]], fields: ["id", "arch_db", "model", "type", "active", "inherit_id", "mode"], order: "id", context: ALL }))[0];
const rendered = async (model, viewId, type) => String((await call(model, "get_views", { views: [[viewId, type]] }))?.views?.[type]?.arch ?? "");
const haveFields = async (model, defs) => {
  const have = new Set((await call("ir.model.fields", "search_read", { domain: [["model", "=", model], ["name", "in", defs.map((d) => d.name)]], fields: ["name"] })).map((r) => r.name));
  return defs.every((d) => have.has(d.name));
};

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const c = rb.created;
  const views = Object.entries(c.views ?? {}).filter(([, id]) => id);
  for (const [key, id] of views) log(`view #${id} ${VIEWS[key]?.name} (created): ${DROP ? "dropped" : "active = false"}`);
  if (!views.length) log("no view was created by this script");
  log(DROP ? `fields ${(c.fields ?? []).join(", ") || "-"} (created): dropped` : `fields ${(c.fields ?? []).join(", ") || "-"} (created): stay (the worker writes them; nothing is deleted)`);
  if (APPLY && !DROP) for (const [, id] of views) await call("ir.ui.view", "write", { ids: [id], vals: { active: false } });
  if (DROP) await dropCreated(rb, [["ir.ui.view", views.map(([, id]) => id)], ["ir.model.fields", [...(c.fields ?? [])].reverse()]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  for (const [model, defs] of [[COMPLAINT_MODEL, COMPLAINT_FIELDS], [PARTNER_MODEL, PARTNER_FIELDS]]) {
    const f = await call(model, "fields_get", { attributes: ["type", "string", "selection", "relation"] });
    check(`${model}: ${defs.map((d) => `${d.name} (${d.ttype})`).join(", ")}`, defs.every((d) => f[d.name]?.type === d.ttype && f[d.name].string === d.field_description && (!d.relation || f[d.name].relation === d.relation)), JSON.stringify(defs.map((d) => [d.name, f[d.name]])));
    if (model === COMPLAINT_MODEL) {
      check(`x_kind: ${KIND_OPTIONS.map((o) => `${o[0]} «${o[1]}»`).join(" / ")}`, JSON.stringify(f.x_kind?.selection) === JSON.stringify(KIND_OPTIONS), JSON.stringify(f.x_kind?.selection));
      check(`x_decision: ${DECISION_OPTIONS.map((o) => `${o[0]} «${o[1]}»`).join(" / ")}`, JSON.stringify(f.x_decision?.selection) === JSON.stringify(DECISION_OPTIONS), JSON.stringify(f.x_decision?.selection));
      check("the complaint still has what the worker already writes (x_customer_id, x_order_id, x_type, x_severity, x_message_text, x_status, x_resolution_note, x_resolved_at)", ["x_customer_id", "x_order_id", "x_type", "x_severity", "x_message_text", "x_status", "x_resolution_note", "x_resolved_at"].every((k) => f[k]) && ["resolved", "dismissed"].every((s) => (f.x_status?.selection ?? []).some((o) => o[0] === s)), JSON.stringify(f.x_status?.selection));
    } else {
      check("the partner still has the fields the supplier's registration writes beside it (vat, x_vat_registered, x_vat_status «registered», x_legal_name, x_iban, x_vat_ask_count)", ["vat", "x_vat_registered", "x_legal_name", "x_iban", "x_vat_ask_count"].every((k) => f[k]) && (f.x_vat_status?.selection ?? []).some((o) => o[0] === "registered"), JSON.stringify(f.x_vat_status?.selection));
    }
    await pause();
  }
  for (const [key, def] of Object.entries(VIEWS)) {
    const parent = await viewOf(def.parent, def.model);
    const ext = await viewOf(def.name, def.model);
    const arch = parent ? await rendered(def.model, parent.id, def.type) : "";
    check(`${def.parent} #${parent?.id} renders with ${def.shows.join(", ")} (the extension ${def.name} #${ext?.id}, active)`, !!ext?.active && ext.inherit_id?.[0] === parent?.id && ext.mode === "extension" && ext.arch_db === def.arch && def.shows.every((n) => arch.includes(`name="${n}"`)), `${key}: ${arch.slice(0, 160)}`);
    await pause();
  }
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

log(`— 1: the complaint's fields`);
await ensureFields(ctx, COMPLAINT_MODEL, await modelId(COMPLAINT_MODEL), COMPLAINT_FIELDS);
await pause();
log(`— 2: the partner's field`);
await ensureFields(ctx, PARTNER_MODEL, await modelId(PARTNER_MODEL), PARTNER_FIELDS);
await pause();

log(`— 3: the three extension views`);
for (const [key, def] of Object.entries(VIEWS)) {
  const parent = await viewOf(def.parent, def.model);
  if (!parent) throw new Error(`view ${def.parent} of ${def.model} not found — stop`);
  const have = await viewOf(def.name, def.model);
  if (have?.active && have.arch_db === def.arch) { log(`= view ${def.name} #${have.id}`); continue; }
  if (have) {
    // switched off by an earlier --rollback (or its arch differs): on again, with this arch
    log(`✎ view ${def.name} #${have.id}: active ${have.active} → true${have.arch_db === def.arch ? "" : ", its arch rewritten"}`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { active: true, arch_base: def.arch } });
    continue;
  }
  const ready = await haveFields(def.model, def.model === COMPLAINT_MODEL ? COMPLAINT_FIELDS : PARTNER_FIELDS);
  for (const l of def.arch.split("\n")) log(`    ${l}`);
  if (!ready && APPLY) throw new Error(`the fields of ${def.model} do not exist — stop`);
  if (!ready) { log(`+ view ${def.name} (dry-run: its fields do not exist yet; written with --apply)`); continue; }
  await ensureView(ctx, key, def.name, { model: def.model, type: def.type, inherit_id: parent.id, mode: "extension", priority: 99, arch_base: def.arch });
  await pause();
}
save();
log(APPLY ? "done — verify: node scripts/s57-20261005-odoo.mjs --verify" : "dry-run: nothing written");
