// § 51 (2026-10-04) — the price ask as a WhatsApp Flow: what Odoo needs for it.
//
//   x_daily_price.x_extraction_status   + «نموذج واتساب» (flow): a purchase price typed in the Flow, no
//                                         extractor (an outlier stays «pending», as § 26)
//   x_whatsapp_template.x_purpose       + «طلب الأسعار بالنموذج» (price_ask_flow)
//   x_whatsapp_template                 the row of utak_price_ask_flow_v1 (ar) with that purpose, its
//                                         status and category as Meta has them (the last --status of
//                                         scripts/s51-20261004-price-flow.mjs, read from its artifact), its
//                                         text and its button. A row the sync already made keeps its id.
// The worker's daily sync (05:00, and before the 02:00 ask while the row is PENDING) keeps the row's
// status and category; the gateway sends the template only while it is APPROVED and UTILITY.
//
//   node scripts/s51-20261004-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s51-20261004-odoo.mjs --apply            rollback file first, then write (idempotent;
//                                                         run again to copy Meta's status to the row)
//   node scripts/s51-20261004-odoo.mjs --verify           read-only checks
//   node scripts/s51-20261004-odoo.mjs --rollback [--apply]          the row's purpose off («other»): the
//                                                                    gateway no longer finds the template
//   node scripts/s51-20261004-odoo.mjs --rollback --drop [--apply]   and delete the two selection values and
//                                                                    the row created here (only after the
//                                                                    worker's code is rolled back, and no
//                                                                    x_daily_price row carries «flow»)
//
// Rollback file: scripts/artifacts/s51-20261004-odoo-rollback.json. The tenant is production: no price,
// order, invoice or payment is written here. No WhatsApp send. Nothing deleted without --drop.
import { existsSync, readFileSync } from "node:fs";
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, log, one, rollbackFile } from "./lib/s40-kit.mjs";
import { FLOW_TEMPLATE } from "./lib/s51-price-flow.mjs";

const RB = new URL("./artifacts/s51-20261004-odoo-rollback.json", import.meta.url);
const TPL = "x_whatsapp_template", DP = "x_daily_price";
const FLOW_STATUS = { value: "flow", name: "نموذج واتساب" };
const FLOW_PURPOSE = { value: FLOW_TEMPLATE.purpose, name: "طلب الأسعار بالنموذج" };
const META = new URL("./artifacts/s51-20261004-price-flow-meta.json", import.meta.url);

const { rb, save } = rollbackFile(RB, "scripts/s51-20261004-odoo.mjs");
const fieldId = async (m, f) => one("ir.model.fields", [["model", "=", m], ["name", "=", f]]);
const selection = async (fid) => call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", fid]], fields: ["id", "value", "name", "sequence"], order: "sequence, id" });
const rowOf = async () => (await call(TPL, "search_read", {
  domain: [["x_meta_template_id", "=", FLOW_TEMPLATE.name], ["x_language", "=", FLOW_TEMPLATE.language]],
  fields: ["id", "x_purpose", "x_meta_status", "x_category", "x_param_count", "x_meta_id", "x_label_ar", "x_body_text", "x_buttons_text"], limit: 2,
}));
const nowOdoo = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/**
 * The template as Meta has it: the last GET of scripts/s51-20261004-price-flow.mjs (--status), from
 * its artifact — this script talks to Odoo alone (scripts/lib/s40-kit.mjs blocks any other host).
 */
function atMeta() {
  if (!existsSync(META)) return null;
  const t = JSON.parse(readFileSync(META, "utf8")).template;
  return t?.name === FLOW_TEMPLATE.name ? t : null;
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before, c = rb.created;
  const [row] = await rowOf();
  if (row) log(`${TPL} #${row.id}: x_purpose ${row.x_purpose} → ${b.rowPurpose ?? "other"}${DROP && c.row ? " (then deleted: created here)" : ""}`);
  if (APPLY && row) await call(TPL, "write", { ids: [row.id], vals: { x_purpose: b.rowPurpose ?? "other" } });
  if (DROP) {
    const used = await call(DP, "search_count", { domain: [["x_extraction_status", "=", FLOW_STATUS.value]] });
    if (used) { log(`✗ ${used} x_daily_price row(s) carry «flow»: the selection value is not dropped`); process.exit(1); }
    await dropCreated(rb, [[TPL, [c.row]], ["ir.model.fields.selection", [c.purposeSelection, c.statusSelection]]]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const df = await call(DP, "fields_get", { attributes: ["type", "selection"] });
  check(`${DP}.x_extraction_status carries «${FLOW_STATUS.name}» (${FLOW_STATUS.value})`, (df.x_extraction_status?.selection ?? []).some((s) => s[0] === FLOW_STATUS.value && s[1] === FLOW_STATUS.name), JSON.stringify(df.x_extraction_status?.selection));
  check("…and keeps pending / extracted / confirmed / failed", ["pending", "extracted", "confirmed", "failed"].every((v) => (df.x_extraction_status?.selection ?? []).some((s) => s[0] === v)));
  const tf = await call(TPL, "fields_get", { attributes: ["type", "selection"] });
  check(`${TPL}.x_purpose carries «${FLOW_PURPOSE.name}» (${FLOW_PURPOSE.value})`, (tf.x_purpose?.selection ?? []).some((s) => s[0] === FLOW_PURPOSE.value && s[1] === FLOW_PURPOSE.name), JSON.stringify((tf.x_purpose?.selection ?? []).slice(-3)));
  const rows = await rowOf();
  const meta = atMeta();
  check(`one row of ${FLOW_TEMPLATE.name} (${FLOW_TEMPLATE.language}), purpose ${FLOW_PURPOSE.value}, 3 variables`, rows.length === 1 && rows[0].x_purpose === FLOW_PURPOSE.value && rows[0].x_param_count === 3, JSON.stringify(rows));
  check(`its status and category are Meta's at the last --status (${meta?.status}/${meta?.category}, ${meta?.at})`, !!meta && rows[0]?.x_meta_status === meta.status && rows[0]?.x_category === meta.category, JSON.stringify([rows[0]?.x_meta_status, rows[0]?.x_category]));
  check("its text and its button are on the row (the record shows the message, not its name)", rows[0]?.x_body_text === FLOW_TEMPLATE.body && rows[0]?.x_buttons_text === FLOW_TEMPLATE.button, JSON.stringify([rows[0]?.x_body_text, rows[0]?.x_buttons_text]));
  const others = await call(TPL, "search_read", { domain: [["x_purpose", "=", FLOW_PURPOSE.value]], fields: ["id", "x_meta_template_id"] });
  check("no other template holds the purpose", others.length === 1, JSON.stringify(others));
  const ask = await call(TPL, "search_read", { domain: [["x_purpose", "=", "supplier_ask"]], fields: ["id", "x_meta_template_id", "x_meta_status", "x_category"] });
  check("the ask of before is untouched: utak_supplier_ask_v2, APPROVED, UTILITY", ask.length === 1 && ask[0].x_meta_template_id === "utak_supplier_ask_v2" && ask[0].x_meta_status === "APPROVED" && ask[0].x_category === "UTILITY", JSON.stringify(ask));
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
// 1. «نموذج واتساب» among the extraction statuses
const statusField = await fieldId(DP, "x_extraction_status");
const st = await selection(statusField);
if (st.some((s) => s.value === FLOW_STATUS.value)) log(`= ${DP}.x_extraction_status «${FLOW_STATUS.name}» #${st.find((s) => s.value === FLOW_STATUS.value).id}`);
else {
  log(`+ ${DP}.x_extraction_status: «${FLOW_STATUS.name}» (${FLOW_STATUS.value}) after ${st.map((s) => s.value).join(" / ")}`);
  if (APPLY) {
    [rb.created.statusSelection] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: statusField, value: FLOW_STATUS.value, name: FLOW_STATUS.name, sequence: Math.max(0, ...st.map((s) => s.sequence)) + 1 }] });
    save(); log(`  → #${rb.created.statusSelection}`);
  }
}
// 2. the purpose
const purposeField = await fieldId(TPL, "x_purpose");
const pu = await selection(purposeField);
if (pu.some((s) => s.value === FLOW_PURPOSE.value)) log(`= ${TPL}.x_purpose «${FLOW_PURPOSE.name}» #${pu.find((s) => s.value === FLOW_PURPOSE.value).id}`);
else {
  log(`+ ${TPL}.x_purpose: «${FLOW_PURPOSE.name}» (${FLOW_PURPOSE.value}) — ${pu.length} values now`);
  if (APPLY) {
    [rb.created.purposeSelection] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: purposeField, value: FLOW_PURPOSE.value, name: FLOW_PURPOSE.name, sequence: Math.max(0, ...pu.map((s) => s.sequence)) + 1 }] });
    save(); log(`  → #${rb.created.purposeSelection}`);
  }
}
// 3. the template's row
const meta = atMeta();
if (!meta) { log(`✗ no Meta status of ${FLOW_TEMPLATE.name} — run scripts/s51-20261004-price-flow.mjs --status first`); process.exit(1); }
log(`Meta (read ${meta.at}): ${meta.name} #${meta.id} ${meta.status}/${meta.category}`);
const rows = await rowOf();
if (rows.length > 1) { log(`✗ ${rows.length} rows of ${FLOW_TEMPLATE.name} — stop`); process.exit(1); }
const want = { x_meta_id: meta.id, x_meta_status: meta.status, x_category: meta.category, x_param_count: 3, x_body_text: FLOW_TEMPLATE.body, x_buttons_text: FLOW_TEMPLATE.button, x_purpose: FLOW_PURPOSE.value };
if (!rows.length) {
  log(`+ ${TPL}: ${FLOW_TEMPLATE.name} (${FLOW_TEMPLATE.language}) «${FLOW_TEMPLATE.label}», purpose ${FLOW_PURPOSE.value}, ${meta.status}/${meta.category}`);
  if (APPLY) {
    [rb.created.row] = await call(TPL, "create", { vals_list: [{
      x_meta_template_id: FLOW_TEMPLATE.name, x_language: FLOW_TEMPLATE.language, ...want,
      x_body: FLOW_TEMPLATE.body, x_buttons: `[0] FLOW — ${FLOW_TEMPLATE.button}`,
      x_label_ar: FLOW_TEMPLATE.label, x_name: FLOW_TEMPLATE.label, x_last_synced: nowOdoo(), x_missing_in_meta: false,
    }] }, { probe: [["x_meta_template_id", "=", FLOW_TEMPLATE.name], ["x_language", "=", FLOW_TEMPLATE.language]] });
    save(); log(`  → #${rb.created.row}`);
  }
} else {
  const row = rows[0];
  const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => row[k] !== v));
  if (!Object.keys(diff).length) log(`= ${TPL} #${row.id} ${FLOW_TEMPLATE.name}: ${row.x_meta_status}/${row.x_category}, purpose ${row.x_purpose}`);
  else {
    log(`✎ ${TPL} #${row.id}: ${Object.entries(diff).map(([k, v]) => `${k} ${JSON.stringify(row[k])} → ${JSON.stringify(v)}`).join(", ")}`);
    if (APPLY) {
      if (!rb.created.row) rb.before.rowPurpose ??= row.x_purpose || "other";
      save();
      await call(TPL, "write", { ids: [row.id], vals: diff });
    }
  }
}
log(APPLY ? "done — verify: node scripts/s51-20261004-odoo.mjs --verify" : "dry-run: nothing written");
