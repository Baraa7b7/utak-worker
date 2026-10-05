// § 54 (2026-10-05) — what Odoo needs (scripts/lib/s54-odoo.mjs is the data):
//
//   أ   x_pricing_config.x_above_suggested «لما يكون السوق أعلى من المقترح» (بسعر السوق / بالمقترح)
//       = «بسعر السوق» on the active record, in «⚙️ الإعدادات» after «زيادة على سعر السوق ٪».
//   ب   the rule's sentence on «📊 اليوم», the board and «⚙️ الإعدادات»: § 54's rule in place of «سعر البيع
//       = سعر السوق متى بلغ المقترح، وغير ذلك استثناء».
//
//   node scripts/s54-20261005-odoo.mjs              dry-run: the plan, nothing written
//   node scripts/s54-20261005-odoo.mjs --apply      rollback file first, then write (idempotent)
//   node scripts/s54-20261005-odoo.mjs --verify     read-only checks
//   node scripts/s54-20261005-odoo.mjs --rollback [--apply]          the three forms as they were, the setting back to
//                                                    «بسعر السوق». ONLY after the worker's code is rolled
//                                                    back (it reads x_above_suggested).
//   node scripts/s54-20261005-odoo.mjs --rollback --drop [--apply]   and delete the field — by Baraa's decision only.
// Rollback file: scripts/artifacts/s54-20261005-odoo-rollback.json. The tenant is production. No
// WhatsApp send. No price, order, invoice or payment is written here.
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, log, modelId, one, rollbackFile } from "./lib/s40-kit.mjs";
import { ABOVE_DEFAULT, ABOVE_FIELD, ABOVE_LABEL, ABOVE_OPTIONS, CFG_FIELDS, NOTES, SETTINGS_VIEW, noteArch, settingsArch } from "./lib/s54-odoo.mjs";

const RB = new URL("./artifacts/s54-20261005-odoo-rollback.json", import.meta.url);
const CFG = "x_pricing_config";
const ALL = { active_test: false };
const OTHER = ["x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_outlier_ratio", "x_min_order_sar", "x_market_uplift_pct"];

const ctx = rollbackFile(RB, "scripts/s54-20261005-odoo.mjs");
const { rb, save } = ctx;
rb.before.views ??= {};
const pause = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "active"], context: ALL }))[0];
const fieldId = async (model, name) => one("ir.model.fields", [["model", "=", model], ["name", "=", name]]);
const activeConfig = async (fields) => {
  const today = riyadhToday();
  return (await call(CFG, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields, order: "x_active_from desc, id desc", limit: 1 }))[0];
};

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before, c = rb.created;
  for (const [name, v] of Object.entries(b.views)) { log(`view #${v.id} ${name}: its arch back (${v.arch.length} characters)`); if (APPLY) await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: v.arch } }); }
  if (b.config) { log(`${CFG} #${b.config.id}: ${ABOVE_FIELD} → ${ABOVE_DEFAULT}`); if (APPLY && (await fieldId(CFG, ABOVE_FIELD))) await call(CFG, "write", { ids: [b.config.id], vals: { [ABOVE_FIELD]: ABOVE_DEFAULT } }); }
  if (DROP) await dropCreated(rb, [["ir.model.fields", [...(c.fields ?? [])].reverse()]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const cf = await call(CFG, "fields_get", { attributes: ["type", "string", "selection"] });
  const f = cf[ABOVE_FIELD];
  check(`${CFG}.${ABOVE_FIELD} selection «${ABOVE_LABEL}»: ${ABOVE_OPTIONS.map((o) => o[1]).join(" / ")}`,
    f?.type === "selection" && f.string === ABOVE_LABEL && JSON.stringify(f.selection) === JSON.stringify(ABOVE_OPTIONS), JSON.stringify(f));
  const cfg = await activeConfig(["id", ABOVE_FIELD, ...OTHER]);
  check(`the active settings #${cfg?.id}: «${ABOVE_LABEL}» = ${ABOVE_DEFAULT}`, cfg?.[ABOVE_FIELD] === ABOVE_DEFAULT, JSON.stringify(cfg));
  if (rb.before.config) check("…and the other settings untouched (التالف، الربح الأدنى، الكراتين، نسبة الشاذ، الحد الأدنى، زيادة السوق)", OTHER.every((k) => cfg?.[k] === rb.before.config[k]), JSON.stringify([cfg, rb.before.config]));
  await pause();
  const sv = await viewOf(SETTINGS_VIEW);
  const arch = String((await call(CFG, "get_views", { views: [[sv?.id, "form"]] }))?.views?.form?.arch ?? "");
  check(`«⚙️ الإعدادات» renders with «${ABOVE_LABEL}» right after «زيادة على سعر السوق ٪», every other setting still there`,
    new RegExp(`name="x_market_uplift_pct"[^>]*/>\\s*<field name="${ABOVE_FIELD}"`).test(arch)
      && ["x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_min_order_sar", "x_planned_stops", "x_outlier_ratio", "x_tier_ids", "x_cost_line_ids", "x_sources_note"].every((n) => arch.includes(`name="${n}"`)), arch.slice(0, 300));
  for (const [name, was, now] of NOTES) {
    await pause();
    const v = await viewOf(name);
    const rendered = String((await call(v?.model, "get_views", { views: [[v?.id, "form"]] }))?.views?.form?.arch ?? "");
    check(`${name} #${v?.id} renders with § 54's rule, and no longer says «متى بلغ … استثناء»`, rendered.includes(now) && !rendered.includes(was) && !/متى بلغ/.test(rendered), rendered.slice(0, 200));
  }
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

log(`— أ: «${ABOVE_LABEL}»`);
await ensureFields(ctx, CFG, await modelId(CFG), CFG_FIELDS);
await pause();
const have = !!(await fieldId(CFG, ABOVE_FIELD));
const cfg = await activeConfig(["id", "x_name", ...OTHER, ...(have ? [ABOVE_FIELD] : [])]);
if (!cfg) throw new Error("no active x_pricing_config — stop");
if (have && cfg[ABOVE_FIELD] === ABOVE_DEFAULT) log(`= config #${cfg.id} (${cfg.x_name}): ${ABOVE_FIELD} ${ABOVE_DEFAULT}`);
else {
  log(`✎ config #${cfg.id} (${cfg.x_name}): ${ABOVE_FIELD} ${cfg[ABOVE_FIELD] ?? "∅"} → ${ABOVE_DEFAULT} (every other setting as it is)`);
  if (APPLY) { rb.before.config ??= { ...cfg }; save(); await call(CFG, "write", { ids: [cfg.id], vals: { [ABOVE_FIELD]: ABOVE_DEFAULT } }); }
}
if (APPLY) { rb.before.config ??= { ...cfg }; save(); }
const sv = await viewOf(SETTINGS_VIEW);
if (!sv) throw new Error(`view ${SETTINGS_VIEW} not found — stop`);
const settingsNote = NOTES.find((n) => n[0] === SETTINGS_VIEW);
const want = noteArch(settingsArch(sv.arch_db), settingsNote[1], settingsNote[2]);
if (want === sv.arch_db) log(`= view ${SETTINGS_VIEW} #${sv.id}`);
else {
  log(`✎ view ${SETTINGS_VIEW} #${sv.id}: ${sv.arch_db.length} → ${want.length} characters («${ABOVE_LABEL}» after «زيادة على سعر السوق ٪», and the rule's sentence)`);
  // the change itself, line by line (everything else in the arch is byte-for-byte what it was)
  const was = sv.arch_db.split("\n"), now = want.split("\n");
  for (const l of was.filter((x) => !now.includes(x))) log(`    - ${l.trim()}`);
  for (const l of now.filter((x) => !was.includes(x))) log(`    + ${l.trim()}`);
  const at = now.findIndex((l) => l.includes(ABOVE_FIELD));
  log(`    context: ${now.slice(Math.max(0, at - 4), at + 3).map((l) => l.trim()).join(" | ")}`);
  if (APPLY) {
    if (!(await fieldId(CFG, ABOVE_FIELD))) throw new Error("the field does not exist yet — stop");
    rb.before.views[SETTINGS_VIEW] ??= { id: sv.id, arch: sv.arch_db }; save();
    await call("ir.ui.view", "write", { ids: [sv.id], vals: { arch_base: want } });
  }
}
log("— ب: the rule's sentence on the screens");
for (const [name, was, now] of NOTES.filter((n) => n[0] !== SETTINGS_VIEW)) {
  await pause();
  const v = await viewOf(name);
  if (!v) throw new Error(`view ${name} not found — stop`);
  const arch = noteArch(v.arch_db, was, now);
  if (arch === v.arch_db) { log(`= view ${name} #${v.id}`); continue; }
  log(`✎ view ${name} #${v.id}: ${v.arch_db.length} → ${arch.length} characters`);
  log(`    - ${was}`);
  log(`    + ${now}`);
  if (APPLY) {
    rb.before.views[name] ??= { id: v.id, arch: v.arch_db }; save();
    await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: arch } });
  }
}
save();
log(APPLY ? "done — verify: node scripts/s54-20261005-odoo.mjs --verify" : "dry-run: nothing written");
