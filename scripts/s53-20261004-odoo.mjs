// § 53 (2026-10-04) — what Odoo needs (scripts/lib/s53-odoo.mjs is the data):
//
//   ب   x_pricing_config.x_market_uplift_pct «زيادة على سعر السوق ٪» = 0 on the active record, in
//       «⚙️ الإعدادات» after «نسبة السعر الشاذ»; x_price_day_line.x_uplift_pct «زيادة السوق ٪».
//   د   res.partner.x_contact_name «اسم المسؤول» on the partner's card, and «محل عصير» among the
//       customer types.
//   هـ  x_whatsapp_template.x_purpose + «تذكير الدفع بالآيبان», and the row of utak_pay_remind_iban_v1
//       with its status and category as Meta has them (the last run of
//       scripts/s53-20261004-pay-remind.mjs, from its artifact).
//
//   node scripts/s53-20261004-odoo.mjs [ب] [د] [هـ]            dry-run: the plan, nothing written
//   node scripts/s53-20261004-odoo.mjs [ب] [د] [هـ] --apply    rollback file first, then write (idempotent)
//   node scripts/s53-20261004-odoo.mjs [ب] [د] [هـ] --verify   read-only checks (of the parts named)
//   node scripts/s53-20261004-odoo.mjs --rollback [--apply]     the settings form as it was, the uplift 0, the
//                                                               partner view off, the template row's purpose «other».
//                                                               ONLY after the worker's code is rolled back (it
//                                                               reads x_market_uplift_pct and writes x_uplift_pct).
//   node scripts/s53-20261004-odoo.mjs --rollback --drop [--apply]   and delete what was created here (the fields,
//                                                               the view, the two selection values, the row) — by
//                                                               Baraa's decision only.
// No part named = every part. Rollback file: scripts/artifacts/s53-20261004-odoo-rollback.json. The tenant is
// production. No WhatsApp send. No price, order, invoice or payment is written here.
import { existsSync, readFileSync } from "node:fs";
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, ensureView, log, modelId, one, rollbackFile } from "./lib/s40-kit.mjs";
import { CFG_FIELDS, CUSTOMER_TYPE_JUICE, LINE_FIELDS, PARTNER_FIELDS, PARTNER_FORM, PARTNER_VIEW, PARTNER_VIEW_SIBLING, SETTINGS_VIEW, UPLIFT_DEFAULT, UPLIFT_LABEL, settingsArch } from "./lib/s53-odoo.mjs";
import { PAY_REMIND_IBAN } from "./lib/s53-templates.mjs";

const RB = new URL("./artifacts/s53-20261004-odoo-rollback.json", import.meta.url);
const META = new URL("./artifacts/s53-20261004-pay-remind-meta.json", import.meta.url);
const PARTS = ["ب", "د", "هـ"];
const parts = PARTS.filter((p) => process.argv.includes(p));
const on = (p) => !parts.length || parts.includes(p);
const CFG = "x_pricing_config", LINE = "x_price_day_line", PARTNER = "res.partner", TPL = "x_whatsapp_template";
const ALL = { active_test: false };

const ctx = rollbackFile(RB, "scripts/s53-20261004-odoo.mjs");
const { rb, save } = ctx;
rb.before.views ??= {};
const pause = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const nowOdoo = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "inherit_id", "active"], context: ALL }))[0];
const fieldId = async (model, name) => one("ir.model.fields", [["model", "=", model], ["name", "=", name]]);
const selection = async (fid) => call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", fid]], fields: ["id", "value", "name", "sequence"], order: "sequence, id" });
const activeConfig = async (fields) => {
  const today = riyadhToday();
  return (await call(CFG, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields, order: "x_active_from desc, id desc", limit: 1 }))[0];
};
const tplRows = async (name) => call(TPL, "search_read", {
  domain: [["x_meta_template_id", "=", name], ["x_language", "=", "ar"]],
  fields: ["id", "x_purpose", "x_meta_status", "x_category", "x_param_count", "x_meta_id", "x_label_ar", "x_body_text"], limit: 2,
});
function atMeta() {
  if (!existsSync(META)) return null;
  const t = JSON.parse(readFileSync(META, "utf8")).template;
  return t?.name === PAY_REMIND_IBAN.name ? t : null;
}
const T = PAY_REMIND_IBAN;

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before, c = rb.created;
  if (b.views.settings) { log(`view #${b.views.settings.id} ${SETTINGS_VIEW}: its arch back (${b.views.settings.arch.length} characters)`); if (APPLY) await call("ir.ui.view", "write", { ids: [b.views.settings.id], vals: { arch_base: b.views.settings.arch } }); }
  if (b.config) { log(`${CFG} #${b.config.id}: x_market_uplift_pct → ${UPLIFT_DEFAULT}`); if (APPLY && (await fieldId(CFG, "x_market_uplift_pct"))) await call(CFG, "write", { ids: [b.config.id], vals: { x_market_uplift_pct: UPLIFT_DEFAULT } }); }
  const pv = c.views?.partnerContact;
  if (pv) { log(`view #${pv} ${PARTNER_VIEW}: active = false${DROP ? " — dropped" : ""}`); if (APPLY) await call("ir.ui.view", "write", { ids: [pv], vals: { active: false } }); }
  const [row] = await tplRows(T.name);
  if (row) { log(`${TPL} #${row.id} ${T.name}: x_purpose ${row.x_purpose} → other${DROP && c.row ? " (then deleted: created here)" : ""}`); if (APPLY) await call(TPL, "write", { ids: [row.id], vals: { x_purpose: "other" } }); }
  if (DROP) {
    const used = c.juiceSelection ? await call(PARTNER, "search_count", { domain: [["x_customer_type", "=", CUSTOMER_TYPE_JUICE.value]], context: ALL }) : 0;
    if (used) { log(`✗ ${used} partner(s) carry «${CUSTOMER_TYPE_JUICE.name}»: nothing is dropped`); process.exit(1); }
    await dropCreated(rb, [[TPL, [c.row]], ["ir.ui.view", [pv]], ["ir.model.fields.selection", [c.purposeSelection, c.juiceSelection]], ["ir.model.fields", [...(c.fields ?? [])].reverse()]]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check: checkAll, done } = checker();
  // a part not named is not checked (--verify ب هـ); no part named = every part
  let part = "ب";
  const check = (name, cond, detail) => { if (on(part)) checkAll(`${part} — ${name}`, cond, detail); };
  const cf = await call(CFG, "fields_get", { attributes: ["type", "string"] });
  check(`${CFG}.x_market_uplift_pct float «${UPLIFT_LABEL}»`, cf.x_market_uplift_pct?.type === "float" && cf.x_market_uplift_pct?.string === UPLIFT_LABEL, JSON.stringify(cf.x_market_uplift_pct));
  const lf = await call(LINE, "fields_get", { attributes: ["type", "string"] });
  check(`${LINE}.x_uplift_pct float «زيادة السوق ٪»`, lf.x_uplift_pct?.type === "float" && lf.x_uplift_pct?.string === "زيادة السوق ٪", JSON.stringify(lf.x_uplift_pct));
  const cfg = await activeConfig(["id", "x_market_uplift_pct", "x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_outlier_ratio", "x_min_order_sar"]);
  check(`the active settings #${cfg?.id}: the uplift is ${UPLIFT_DEFAULT}`, cfg?.x_market_uplift_pct === UPLIFT_DEFAULT, JSON.stringify(cfg));
  if (rb.before.config) check("…and the other settings untouched (التالف، الربح الأدنى، الكراتين، نسبة الشاذ، الحد الأدنى)", ["x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_outlier_ratio", "x_min_order_sar"].every((f) => cfg?.[f] === rb.before.config[f]), JSON.stringify([cfg, rb.before.config]));
  await pause();
  const sv = await viewOf(SETTINGS_VIEW);
  const sArch = String((await call(CFG, "get_views", { views: [[sv?.id, "form"]] }))?.views?.form?.arch ?? "");
  check("«⚙️ الإعدادات» renders with «زيادة على سعر السوق ٪» right after «نسبة السعر الشاذ», every other setting still there", /name="x_outlier_ratio"[^>]*\/>\s*<field name="x_market_uplift_pct"/.test(sArch) && ["x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_min_order_sar", "x_planned_stops", "x_tier_ids", "x_cost_line_ids", "x_sources_note"].every((f) => sArch.includes(`name="${f}"`)), sArch.slice(0, 300));
  const [lock] = await call("base.automation", "read", { ids: [23], fields: ["trigger_field_ids", "active"] });
  const upliftField = await fieldId(LINE, "x_uplift_pct");
  check("the lock automation #23 does not watch the new line field", lock?.active === true && !!upliftField && !(lock.trigger_field_ids ?? []).includes(upliftField), JSON.stringify(lock));
  await pause();
  part = "د";
  const pf = await call(PARTNER, "fields_get", { attributes: ["type", "string", "selection"] });
  check(`${PARTNER}.x_contact_name char «اسم المسؤول»`, pf.x_contact_name?.type === "char" && pf.x_contact_name?.string === "اسم المسؤول", JSON.stringify(pf.x_contact_name));
  check(`«${CUSTOMER_TYPE_JUICE.name}» among the customer types, the five of before kept`, (pf.x_customer_type?.selection ?? []).some((s) => s[0] === CUSTOMER_TYPE_JUICE.value && s[1] === CUSTOMER_TYPE_JUICE.name) && ["grocery", "restaurant", "hotel", "cafe", "other"].every((v) => (pf.x_customer_type?.selection ?? []).some((s) => s[0] === v)), JSON.stringify(pf.x_customer_type?.selection));
  const card = String((await call(PARTNER, "get_views", { views: [[false, "form"]] }))?.views?.form?.arch ?? "");
  check("the partner's card renders with «اسم المسؤول», and § 44's fields beside the VAT number", ["x_contact_name", "vat", "x_vat_status", "x_legal_name"].every((n) => card.includes(`name="${n}"`)));
  await pause();
  part = "هـ";
  const tf = await call(TPL, "fields_get", { attributes: ["type", "selection"] });
  check(`${TPL}.x_purpose carries «${T.purposeLabel}» (${T.purpose})`, (tf.x_purpose?.selection ?? []).some((s) => s[0] === T.purpose && s[1] === T.purposeLabel), JSON.stringify((tf.x_purpose?.selection ?? []).slice(-3)));
  const meta = atMeta();
  const rows = await tplRows(T.name);
  check(`one row of ${T.name} (ar), purpose ${T.purpose}, ${T.params} variables`, rows.length === 1 && rows[0].x_purpose === T.purpose && rows[0].x_param_count === T.params, JSON.stringify(rows));
  check(`its status and category are Meta's at the last read (${meta?.status}/${meta?.category}, ${meta?.at})`, !!meta && rows[0]?.x_meta_status === meta.status && rows[0]?.x_category === meta.category && rows[0]?.x_meta_id === meta.id, JSON.stringify([rows[0]?.x_meta_status, rows[0]?.x_category, rows[0]?.x_meta_id]));
  check("its text is on the row", rows[0]?.x_body_text === T.body, rows[0]?.x_body_text);
  const holders = await call(TPL, "search_read", { domain: [["x_purpose", "=", T.purpose]], fields: ["id", "x_meta_template_id"] });
  check("no other template holds the purpose", holders.length === 1, JSON.stringify(holders));
  const old = await call(TPL, "search_read", { domain: [["x_purpose", "=", "customer_pay_remind"]], fields: ["id", "x_meta_template_id", "x_meta_status", "x_category", "x_param_count"] });
  check(`the reminder of before is untouched: ${T.replaces}, APPROVED, UTILITY, 2 variables`, old.length === 1 && old[0].x_meta_template_id === T.replaces && old[0].x_meta_status === "APPROVED" && old[0].x_category === "UTILITY" && old[0].x_param_count === 2, JSON.stringify(old));
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

if (on("ب")) {
  log("— ب: «زيادة على سعر السوق ٪»");
  await ensureFields(ctx, CFG, await modelId(CFG), CFG_FIELDS);
  await ensureFields(ctx, LINE, await modelId(LINE), LINE_FIELDS);
  await pause();
  const have = !!(await fieldId(CFG, "x_market_uplift_pct"));
  const cfg = await activeConfig(["id", "x_name", "x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_outlier_ratio", "x_min_order_sar", ...(have ? ["x_market_uplift_pct"] : [])]);
  if (!cfg) throw new Error("no active x_pricing_config — stop");
  if (have && cfg.x_market_uplift_pct === UPLIFT_DEFAULT) log(`= config #${cfg.id} (${cfg.x_name}): x_market_uplift_pct ${UPLIFT_DEFAULT}`);
  else {
    log(`✎ config #${cfg.id} (${cfg.x_name}): x_market_uplift_pct ${cfg.x_market_uplift_pct ?? "∅"} → ${UPLIFT_DEFAULT} (every other setting as it is)`);
    if (APPLY) { rb.before.config ??= { ...cfg }; save(); await call(CFG, "write", { ids: [cfg.id], vals: { x_market_uplift_pct: UPLIFT_DEFAULT } }); }
  }
  if (APPLY) { rb.before.config ??= { ...cfg }; save(); }
  const sv = await viewOf(SETTINGS_VIEW);
  if (!sv) throw new Error(`view ${SETTINGS_VIEW} not found — stop`);
  const want = settingsArch(sv.arch_db);
  if (want === sv.arch_db) log(`= view ${SETTINGS_VIEW} #${sv.id}`);
  else {
    log(`✎ view ${SETTINGS_VIEW} #${sv.id}: ${sv.arch_db.length} → ${want.length} characters («${UPLIFT_LABEL}» after «نسبة السعر الشاذ»)`);
    // the change itself, line by line (everything else in the arch is byte-for-byte what it was)
    const was = sv.arch_db.split("\n"), now = want.split("\n");
    const added = now.filter((l) => !was.includes(l)), removed = was.filter((l) => !now.includes(l));
    for (const l of removed) log(`    - ${l.trim()}`);
    for (const l of added) log(`    + ${l.trim()}`);
    const at = now.findIndex((l) => l.includes("x_market_uplift_pct"));
    log(`    context: ${now.slice(Math.max(0, at - 5), at + 3).map((l) => l.trim()).join(" | ")}`);
    if (APPLY) {
      if (!(await fieldId(CFG, "x_market_uplift_pct"))) throw new Error("the field does not exist yet — stop");
      rb.before.views.settings ??= { id: sv.id, arch: sv.arch_db }; save();
      await call("ir.ui.view", "write", { ids: [sv.id], vals: { arch_base: want } });
    }
  }
  await pause();
}

if (on("د")) {
  log("— د: «اسم المسؤول» and «محل عصير»");
  await ensureFields(ctx, PARTNER, await modelId(PARTNER), PARTNER_FIELDS);
  const typeField = await fieldId(PARTNER, "x_customer_type");
  if (!typeField) throw new Error(`${PARTNER}.x_customer_type not found — stop`);
  const types = await selection(typeField);
  const j = types.find((s) => s.value === CUSTOMER_TYPE_JUICE.value);
  if (j) log(`= ${PARTNER}.x_customer_type «${j.name}» #${j.id}`);
  else {
    log(`+ ${PARTNER}.x_customer_type: «${CUSTOMER_TYPE_JUICE.name}» (${CUSTOMER_TYPE_JUICE.value}) — now ${types.map((s) => `${s.value} «${s.name}»`).join(" / ")}`);
    if (APPLY) {
      const other = types.find((s) => s.value === "other");
      // before «أخرى»: the list reads grocery / restaurant / hotel / cafe / juice / other
      [rb.created.juiceSelection] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: typeField, value: CUSTOMER_TYPE_JUICE.value, name: CUSTOMER_TYPE_JUICE.name, sequence: other ? other.sequence : Math.max(0, ...types.map((s) => s.sequence)) + 1 }] });
      save(); log(`  → #${rb.created.juiceSelection}`);
    }
  }
  await pause();
  const sibling = await viewOf(PARTNER_VIEW_SIBLING);
  if (!sibling?.inherit_id) throw new Error(`view ${PARTNER_VIEW_SIBLING} (or its parent) not found — stop`);
  if (await fieldId(PARTNER, "x_contact_name")) {
    const id = await ensureView(ctx, "partnerContact", PARTNER_VIEW, { model: PARTNER, type: "form", inherit_id: sibling.inherit_id[0], mode: "extension", priority: 99, arch_base: PARTNER_FORM });
    const cur = id ? await viewOf(PARTNER_VIEW) : null;
    if (cur && cur.active === false) { log(`✎ view ${PARTNER_VIEW} #${cur.id}: on again`); if (APPLY) await call("ir.ui.view", "write", { ids: [cur.id], vals: { active: true } }); }
  } else log(`+ view ${PARTNER_VIEW} (after the field exists: --apply)`);
  await pause();
}

if (on("هـ")) {
  log("— هـ: the row of the pay reminder with the IBAN");
  const meta = atMeta();
  if (!meta) { log(`✗ no Meta status of ${T.name} — run scripts/s53-20261004-pay-remind.mjs --status first`); process.exit(1); }
  log(`Meta (read ${meta.at}): ${meta.name} #${meta.id} ${meta.status}/${meta.category}`);
  const purposeField = await fieldId(TPL, "x_purpose");
  const pu = await selection(purposeField);
  if (pu.some((s) => s.value === T.purpose)) log(`= ${TPL}.x_purpose «${T.purposeLabel}» #${pu.find((s) => s.value === T.purpose).id}`);
  else {
    log(`+ ${TPL}.x_purpose: «${T.purposeLabel}» (${T.purpose}) — ${pu.length} values now`);
    if (APPLY) {
      [rb.created.purposeSelection] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: purposeField, value: T.purpose, name: T.purposeLabel, sequence: Math.max(0, ...pu.map((s) => s.sequence)) + 1 }] });
      save(); log(`  → #${rb.created.purposeSelection}`);
    }
  }
  await pause();
  const rows = await tplRows(T.name);
  if (rows.length > 1) { log(`✗ ${rows.length} rows of ${T.name} — stop`); process.exit(1); }
  const want = { x_meta_id: meta.id, x_meta_status: meta.status, x_category: meta.category, x_param_count: T.params, x_body_text: T.body, x_purpose: T.purpose };
  const purposeReady = APPLY || pu.some((s) => s.value === T.purpose);
  if (!rows.length) {
    log(`+ ${TPL}: ${T.name} (ar) «${T.label}», purpose ${T.purpose}, ${meta.status}/${meta.category}`);
    if (APPLY) {
      [rb.created.row] = await call(TPL, "create", { vals_list: [{
        x_meta_template_id: T.name, x_language: T.language, ...want, x_body: T.body,
        x_label_ar: T.label, x_name: T.label, x_last_synced: nowOdoo(), x_missing_in_meta: false,
      }] }, { probe: [["x_meta_template_id", "=", T.name], ["x_language", "=", T.language]] });
      save(); log(`  → #${rb.created.row}`);
    }
  } else {
    const row = rows[0];
    const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => row[k] !== v));
    if (!Object.keys(diff).length) log(`= ${TPL} #${row.id} ${T.name}: ${row.x_meta_status}/${row.x_category}, purpose ${row.x_purpose}`);
    else {
      log(`✎ ${TPL} #${row.id}: ${Object.entries(diff).map(([k, v]) => `${k} ${JSON.stringify(row[k])} → ${JSON.stringify(v)}`).join(", ")}`);
      if (APPLY && purposeReady) { if (!rb.created.row) rb.before.rowPurpose ??= row.x_purpose || "other"; save(); await call(TPL, "write", { ids: [row.id], vals: diff }); }
    }
  }
}
save();
log(APPLY ? "done — verify: node scripts/s53-20261004-odoo.mjs --verify" : "dry-run: nothing written");
