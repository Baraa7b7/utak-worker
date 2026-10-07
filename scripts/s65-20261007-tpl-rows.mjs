// § 65 (2026-10-07) — the two templates of the suppliers' registry in Odoo: their purposes on
// x_whatsapp_template.x_purpose («supplier_invite», «supplier_checkin») and one row each, as Meta has it
// (scripts/artifacts/s65-20261007-templates-meta.json, written by scripts/s65-20261007-templates.mjs --status).
// The 05:00 sync keeps the status and the category of the rows current; the gateway sends a template only
// while its row is APPROVED and UTILITY.
//
//   node scripts/s65-20261007-tpl-rows.mjs                    dry-run: the plan, nothing written
//   node scripts/s65-20261007-tpl-rows.mjs --apply            the purposes and the rows (the rollback file first)
//   node scripts/s65-20261007-tpl-rows.mjs --verify           read-only checks
//   node scripts/s65-20261007-tpl-rows.mjs --rollback [--apply]   the rows' purpose back to «other» (nothing is deleted)
// Rollback file: scripts/artifacts/s65-20261007-tpl-rows-rollback.json. No WhatsApp send.
import { existsSync, readFileSync } from "node:fs";
import { APPLY, ROLLBACK, VERIFY, call, checker, log, rollbackFile } from "./lib/s40-kit.mjs";
import { S65_TEMPLATES } from "./lib/s65-flows.mjs";

const TPL_MODEL = "x_whatsapp_template";
const META = new URL("./artifacts/s65-20261007-templates-meta.json", import.meta.url).pathname;
const { rb, save } = rollbackFile(new URL("./artifacts/s65-20261007-tpl-rows-rollback.json", import.meta.url), "scripts/s65-20261007-tpl-rows.mjs");
const c = rb.created, b = rb.before;
const pause = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const nowOdoo = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const atMeta = (name) => (existsSync(META) ? JSON.parse(readFileSync(META, "utf8")).templates?.[name] ?? null : null);
const tplRows = async (name) => call(TPL_MODEL, "search_read", { domain: [["x_meta_template_id", "=", name], ["x_language", "=", "ar"]], fields: ["id", "x_purpose", "x_meta_status", "x_category", "x_param_count", "x_meta_id", "x_label_ar", "x_body_text"], limit: 2 });
const purposeFieldId = async () => (await call("ir.model.fields", "search_read", { domain: [["model", "=", TPL_MODEL], ["name", "=", "x_purpose"]], fields: ["id"], limit: 1 }))[0]?.id;
const selection = async (fid) => call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", fid]], fields: ["id", "value", "name", "sequence"], order: "sequence, id" });

if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  for (const t of S65_TEMPLATES) {
    const [row] = await tplRows(t.name);
    if (row && row.x_purpose === t.purpose) { log(`✎ ${TPL_MODEL} #${row.id} ${t.name}: x_purpose ${row.x_purpose} → other`); if (APPLY) await call(TPL_MODEL, "write", { ids: [row.id], vals: { x_purpose: "other" } }); }
    else log(`= ${t.name}: no row holds ${t.purpose}`);
    await pause();
  }
  log("the purposes and the rows stay (nothing is deleted)");
  process.exit(0);
}

if (VERIFY) {
  const { check, done } = checker();
  const tf = await call(TPL_MODEL, "fields_get", { attributes: ["type", "selection"] });
  for (const t of S65_TEMPLATES) {
    const meta = atMeta(t.name);
    check(`${TPL_MODEL}.x_purpose carries «${t.purposeLabel}» (${t.purpose})`, (tf.x_purpose?.selection ?? []).some((s) => s[0] === t.purpose && s[1] === t.purposeLabel), JSON.stringify((tf.x_purpose?.selection ?? []).slice(-3)));
    const rows = await tplRows(t.name);
    check(`one row of ${t.name} (ar) #${rows[0]?.id}, purpose ${t.purpose}, ${t.params} variable(s), Meta's id, and Meta's status as last read (${meta?.status}/${meta?.category})`, rows.length === 1 && rows[0].x_purpose === t.purpose && rows[0].x_param_count === t.params && rows[0].x_meta_id === meta?.id && rows[0].x_body_text === t.body && rows[0].x_meta_status === meta?.status && rows[0].x_category === meta?.category, JSON.stringify(rows));
    const holders = await call(TPL_MODEL, "search_read", { domain: [["x_purpose", "=", t.purpose]], fields: ["id", "x_meta_template_id"] });
    check(`…and no other row holds ${t.purpose}`, holders.length === 1, JSON.stringify(holders));
    await pause();
  }
  done();
}

log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save();
const purposeField = await purposeFieldId();
if (!purposeField) throw new Error(`${TPL_MODEL}.x_purpose is not there — stop`);
let pu = await selection(purposeField);
c.purposes ??= {}; c.rows ??= {}; b.rowPurposes ??= {};
for (const t of S65_TEMPLATES) {
  const meta = atMeta(t.name);
  if (!meta?.id) { log(`✗ no Meta status of ${t.name} — run scripts/s65-20261007-templates.mjs --status first`); process.exit(1); }
  log(`Meta (read ${meta.readAt}): ${t.name} #${meta.id} ${meta.status}/${meta.category}`);
  const have = pu.find((s) => s.value === t.purpose);
  if (have) log(`= ${TPL_MODEL}.x_purpose «${have.name}» #${have.id}`);
  else {
    log(`+ ${TPL_MODEL}.x_purpose: «${t.purposeLabel}» (${t.purpose})`);
    if (APPLY) {
      [c.purposes[t.purpose]] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: purposeField, value: t.purpose, name: t.purposeLabel, sequence: Math.max(0, ...pu.map((s) => s.sequence)) + 1 }] });
      save(); log(`  → #${c.purposes[t.purpose]}`);
      pu = await selection(purposeField);
    }
  }
  await pause();
  const rows = await tplRows(t.name);
  if (rows.length > 1) { log(`✗ ${rows.length} rows of ${t.name} — stop`); process.exit(1); }
  const want = { x_meta_id: meta.id, x_meta_status: meta.status, x_category: meta.category, x_param_count: t.params, x_body_text: t.body, x_purpose: t.purpose };
  if (!rows.length) {
    log(`+ ${TPL_MODEL}: ${t.name} (ar) «${t.label}», purpose ${t.purpose}, ${meta.status}/${meta.category}`);
    if (APPLY) {
      [c.rows[t.name]] = await call(TPL_MODEL, "create", { vals_list: [{
        x_meta_template_id: t.name, x_language: t.language, ...want, x_body: t.body,
        x_label_ar: t.label, x_name: t.label, x_last_synced: nowOdoo(), x_missing_in_meta: false,
      }] }, { probe: [["x_meta_template_id", "=", t.name], ["x_language", "=", t.language]] });
      save(); log(`  → #${c.rows[t.name]}`);
    }
  } else {
    const row = rows[0];
    // the row follows Meta as the artifact last read it (run `s65-20261007-templates.mjs --status` first): the 05:00
    // sync writes the same two values, and the gateway sends a template only while they are APPROVED and UTILITY
    const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => row[k] !== v));
    if (!Object.keys(diff).length) log(`= ${TPL_MODEL} #${row.id} ${t.name}: ${row.x_meta_status}/${row.x_category}, purpose ${row.x_purpose}`);
    else {
      log(`✎ ${TPL_MODEL} #${row.id} ${t.name}: ${Object.entries(diff).map(([k, v]) => `${k} ${JSON.stringify(row[k])} → ${JSON.stringify(v)}`).join(", ")}`);
      if (APPLY) { if (!c.rows[t.name]) b.rowPurposes[t.name] ??= row.x_purpose || "other"; save(); await call(TPL_MODEL, "write", { ids: [row.id], vals: diff }); }
    }
  }
  await pause();
}
save();
log(APPLY ? "done — verify: node scripts/s65-20261007-tpl-rows.mjs --verify" : "dry-run: nothing written");
