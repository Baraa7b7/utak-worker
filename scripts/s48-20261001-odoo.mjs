// § 48 أ–د (2026-10-01) — the logic's side in Odoo: the fixed minimum profit a carton, the preview,
// the «—» display, and the price fixed for a decision.
//
// What the worker reads and writes from § 48 (src/pricing-engine.ts priceFloor, src/pricing-board.ts,
// src/prices.ts):
//   x_pricing_config   x_min_profit_sar «الربح الأدنى للكرتون (ريال)» (2 on the active record, 2 for
//                      a new one). x_min_margin_pct «الهامش الأدنى ٪» of § 47 stays on the record,
//                      leaves the settings form, is relabelled «قديم — لا يُستعمل», and no rule reads it.
//   x_price_day_line   x_preview_sale / x_preview_profit — the preview of a line without an approved
//                      price (at the suggested price), in fields of their own;
//                      x_manual_for — the decision «السعر المعدّل» was fixed for;
//                      x_market_show / x_sale_show / x_profit_show / x_manual_show / x_cost_show /
//                      x_even_show / x_suggested_show — computed (not stored) texts: the number, or
//                      «—» when the value does not exist (never 0.00).
// The screens of before § 48 say the new rule until scripts/s48-20261001-ui.mjs replaces them: the
// settings form (the new field in the place of the margin, the rule's sentence), «💰 أسعار اليوم»
// (the «—» columns, «معاينة», the explanation) and the board's explanation.
//
//   node scripts/s48-20261001-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s48-20261001-odoo.mjs --apply            rollback file first, then write (idempotent)
//   node scripts/s48-20261001-odoo.mjs --verify           read-only checks
//   node scripts/s48-20261001-odoo.mjs --rollback [--apply]          views, labels, helps back (the value 2 stays with its field)
//   node scripts/s48-20261001-odoo.mjs --rollback --drop [--apply]   and delete the fields / the default created here
//                                                                    (only after the worker's code is rolled back: it reads them)
//
// Rollback file: scripts/artifacts/s48-20261001-odoo-rollback.json. The tenant is production: no
// order, invoice, payment, price or price day is written here. No WhatsApp. Nothing deleted.
import {
  APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, log, modelId, one, rollbackFile,
} from "./lib/s40-kit.mjs";
import {
  BOARD_NOTE, CFG_FIELDS, DAY_COLUMNS, DAY_NOTE, DISPLAY_FIELDS, LINE_FIELDS, MARGIN_LABEL, MARGIN_LABEL_OLD, MIN_PROFIT_SAR, S47_BOARD_NOTE, S47_DAY_COLUMNS,
  S47_DAY_FORM_NOTE, S47_SETTINGS_NOTE, SETTINGS_NOTE, SUGGESTED_HELP,
} from "./lib/s48-odoo-views.mjs";

const RB = new URL("./artifacts/s48-20261001-odoo-rollback.json", import.meta.url);
const DAY = "x_price_day", LINE = "x_price_day_line", CFG = "x_pricing_config";
const ALL = { active_test: false };
const VIEW = { settings: "utak.pricing_settings_form", dayForm: "utak.price_day_form", boardForm: "utak.pricing_board_form" };
const SETTINGS_OLD = `<field name="x_min_margin_pct"/>`, SETTINGS_NEW = `<field name="x_min_profit_sar"/>`;

const ctx = rollbackFile(RB, "scripts/s48-20261001-odoo.mjs");
const { rb, save } = ctx;
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const fieldId = async (m, f) => one("ir.model.fields", [["model", "=", m], ["name", "=", f]]);
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db"], context: ALL }))[0];
const activeConfig = async (fields) => {
  const today = riyadhToday();
  return (await call(CFG, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields, order: "x_active_from desc, id desc", limit: 1 }))[0];
};
const pause = (ms = 800) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before;
  for (const [k, v] of Object.entries(b.views ?? {})) log(`view ${k} #${v.id}: arch back`);
  for (const f of b.fieldTexts ?? []) log(`field #${f.id} ${f.name}: label / help back`);
  if (APPLY) {
    for (const v of Object.values(b.views ?? {})) await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: v.arch } });
    for (const f of b.fieldTexts ?? []) await call("ir.model.fields", "write", { ids: [f.id], vals: f.vals });
  }
  if (DROP) await dropCreated(rb, [["ir.default", [rb.created.irDefault]], ["ir.model.fields", [...(rb.created.fields ?? [])].reverse()]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const gf = await call(CFG, "fields_get", { attributes: ["type", "string"] });
  check(`${CFG}.x_min_profit_sar float «الربح الأدنى للكرتون (ريال)»`, gf.x_min_profit_sar?.type === "float" && gf.x_min_profit_sar?.string === "الربح الأدنى للكرتون (ريال)", JSON.stringify(gf.x_min_profit_sar));
  check("«الهامش الأدنى ٪» is still a field (nothing deleted), relabelled «قديم — لا يُستعمل»", gf.x_min_margin_pct?.type === "float" && gf.x_min_margin_pct?.string === MARGIN_LABEL, JSON.stringify(gf.x_min_margin_pct));
  const lf = await call(LINE, "fields_get", { attributes: ["type", "string", "store", "help", "readonly"] });
  for (const d of LINE_FIELDS) check(`${LINE}.${d.name} ${d.ttype} «${d.field_description}»${d.compute ? ", computed, not stored" : ", stored"}`, lf[d.name]?.type === d.ttype && lf[d.name]?.string === d.field_description && lf[d.name]?.store === !d.compute, JSON.stringify(lf[d.name]));
  check("«السعر المربح المقترح»: its help is the § 48 formula", lf.x_suggested_price?.help === SUGGESTED_HELP, lf.x_suggested_price?.help);
  await pause();
  const cfg = await activeConfig(["id", "x_min_profit_sar", "x_min_margin_pct", "x_waste_pct", "x_min_order_sar", "x_planned_stops", "x_expected_cartons"]);
  check(`active config #${cfg?.id}: الربح الأدنى للكرتون ${MIN_PROFIT_SAR}`, cfg?.x_min_profit_sar === MIN_PROFIT_SAR, JSON.stringify(cfg));
  if (rb.before.config) check("the other settings untouched (التالف، الهامش القديم، الحد الأدنى، المحطات، الكراتين)", ["x_waste_pct", "x_min_margin_pct", "x_min_order_sar", "x_planned_stops", "x_expected_cartons"].every((f) => cfg?.[f] === rb.before.config[f]), JSON.stringify(cfg));
  const defs = await call("ir.default", "search_read", { domain: [["field_id", "=", await fieldId(CFG, "x_min_profit_sar")]], fields: ["id", "json_value", "user_id", "company_id"] });
  check("a new settings record starts with 2 (ir.default)", defs.length === 1 && Number(defs[0].json_value) === MIN_PROFIT_SAR && !defs[0].user_id, JSON.stringify(defs));
  // the computed texts, as Odoo computes them on the real lines of the last real day
  const [day] = await call(DAY, "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: ["id", "x_date"], order: "x_date desc, id desc", limit: 1 });
  const lines = await call(LINE, "search_read", { domain: [["x_day_id", "=", day.id]], fields: ["id", "x_name", "x_market_price", "x_sale_price", "x_real_profit", "x_preview_sale", "x_preview_profit", "x_manual_price", "x_cost_price", "x_break_even", "x_suggested_price", ...DISPLAY_FIELDS], order: "id asc" });
  const txt = (v) => (v ? Number(v).toFixed(2) : "—");
  const profit = (l) => (l.x_sale_price ? Number(l.x_real_profit).toFixed(2) : l.x_preview_sale ? `معاينة ${Number(l.x_preview_profit).toFixed(2)}` : "—");
  check(`the «—» texts on the ${lines.length} lines of day #${day.id} (${day.x_date}): the number, or «—» for a value that does not exist`,
    lines.length > 0 && lines.every((l) => l.x_market_show === txt(l.x_market_price) && l.x_sale_show === txt(l.x_sale_price) && l.x_manual_show === txt(l.x_manual_price) && l.x_cost_show === txt(l.x_cost_price) && l.x_even_show === txt(l.x_break_even) && l.x_suggested_show === txt(l.x_suggested_price) && l.x_profit_show === profit(l)),
    JSON.stringify(lines.map((l) => [l.id, l.x_market_show, l.x_sale_show, l.x_profit_show, l.x_manual_show])));
  for (const l of lines) log(`    #${l.id} ${l.x_name}: السوق ${l.x_market_show} · البيع ${l.x_sale_show} · الربح ${l.x_profit_show} · المعدّل ${l.x_manual_show} · الشراء ${l.x_cost_show} · بدون خسارة ${l.x_even_show} · المقترح ${l.x_suggested_show}`);
  await pause();
  // the screens, as Odoo renders them (get_views)
  const sf = await viewOf(VIEW.settings);
  const sArch = String((await call(CFG, "get_views", { views: [[sf.id, "form"]] }))?.views?.form?.arch ?? "");
  check("the settings form: «الربح الأدنى للكرتون» right after «نسبة التالف», «الهامش الأدنى ٪» not shown, the other fields and the tiers still there", /name="x_waste_pct"[^>]*\/>\s*<field name="x_min_profit_sar"/.test(sArch) && !sArch.includes("x_min_margin_pct") && ["x_min_order_sar", "x_planned_stops", "x_expected_cartons", "x_tier_ids"].every((f) => sArch.includes(f)));
  check("the settings form: the rule's sentence is § 48's (the fixed profit, the fallback = the suggested price)", sf.arch_db.includes(SETTINGS_NOTE) && !sf.arch_db.includes(S47_SETTINGS_NOTE));
  const df = await viewOf(VIEW.dayForm), bf = await viewOf(VIEW.boardForm);
  if (rb.before.views?.dayForm || df.arch_db.includes(DAY_COLUMNS)) {
    const dArch = String((await call(DAY, "get_views", { views: [[df.id, "form"]] }))?.views?.form?.arch ?? "");
    check("the day form renders the «—» columns and «معاينة» in italics; «قرار براء» and «السعر المعدّل» still editable", ["x_market_show", "x_sale_show", "x_profit_show", "x_even_show", "x_suggested_show"].every((f) => dArch.includes(`name="${f}"`)) && /name="x_profit_show"[^>]*decoration-it=/.test(dArch) && dArch.includes('name="x_decision"') && /name="x_manual_price"[^>]*invisible=/.test(dArch));
    check("the day form: the explanation is the real formula (the raw purchase, the waste, the carton share, the minimum profit, the rule, the preview)", ["الشراء خام", "التالف", "حصة الكرتون", "الربح الأدنى للكرتون", "سعر السوق متى بلغ المقترح", "معاينة"].every((t) => df.arch_db.includes(t)) && !df.arch_db.includes(S47_DAY_FORM_NOTE));
  } else log("  · the day form is the § 48 و screen (scripts/s48-20261001-ui.mjs checks it)");
  check("the board form's explanation no longer says «الهامش الأدنى ٪»", !bf.arch_db.includes("الهامش الأدنى") , bf.arch_db.slice(-400));
  // the lock of an approved / published day never watches the new fields
  const [lock] = await call("base.automation", "read", { ids: [23], fields: ["trigger_field_ids", "active"] });
  const newIds = [];
  for (const d of LINE_FIELDS) newIds.push(await fieldId(LINE, d.name));
  check("the lock automation #23 does not watch the new fields (an approved day's board and preview can still be written)", lock?.active === true && newIds.every((id) => id && !(lock.trigger_field_ids ?? []).includes(id)), JSON.stringify(lock?.trigger_field_ids));
  done();
}

// ---------------------------------------------------------------- plan / apply
save(); // the rollback file before the first write
rb.before.views ??= {}; rb.before.fieldTexts ??= [];
const cfgModel = await modelId(CFG), lineModel = await modelId(LINE);
// 1. the fields
await ensureFields(ctx, CFG, cfgModel, CFG_FIELDS);
await ensureFields(ctx, LINE, lineModel, LINE_FIELDS);
// 2. labels and helps: the margin is old, the suggested price's formula
const text = async (model, name, vals) => {
  const [f] = await call("ir.model.fields", "search_read", { domain: [["model", "=", model], ["name", "=", name]], fields: ["id", "field_description", "help"] });
  if (!f) throw new Error(`${model}.${name} not found — stop`);
  const diff = Object.fromEntries(Object.entries(vals).filter(([k, v]) => f[k] !== v));
  if (!Object.keys(diff).length) { log(`= ${model}.${name} label / help`); return; }
  log(`✎ ${model}.${name}: ${Object.entries(diff).map(([k, v]) => `${k} «${f[k] || ""}» → «${v}»`).join(" · ")}`);
  if (!APPLY) return;
  if (!rb.before.fieldTexts.some((x) => x.id === f.id)) { rb.before.fieldTexts.push({ id: f.id, name: `${model}.${name}`, vals: Object.fromEntries(Object.keys(diff).map((k) => [k, f[k]])) }); save(); }
  await call("ir.model.fields", "write", { ids: [f.id], vals: diff });
};
await text(CFG, "x_min_margin_pct", { field_description: MARGIN_LABEL, help: "لا يُستعمل في أي حساب من § 48: حلّ محله «الربح الأدنى للكرتون (ريال)». القيمة محفوظة كما هي." });
await text(LINE, "x_suggested_price", { help: SUGGESTED_HELP });
// 3. the views
const edit = async (key, name, change) => {
  const v = await viewOf(name);
  if (!v) throw new Error(`view ${name} not found — stop`);
  const want = change(v.arch_db);
  if (want === v.arch_db) { log(`= view ${name} #${v.id}`); return; }
  log(`✎ view ${name} #${v.id}: ${v.arch_db.length} → ${want.length} characters`);
  if (!APPLY) return;
  rb.before.views[key] ??= { id: v.id, arch: v.arch_db }; save();
  await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: want } });
};
const swap = (arch, from, to, what) => {
  if (arch.includes(to)) return arch;
  if (!arch.includes(from)) throw new Error(`${what}: the § 47 text was not found — stop (the view changed by hand?)`);
  return arch.replace(from, to);
};
await edit("settings", VIEW.settings, (a) => swap(swap(a, SETTINGS_OLD, SETTINGS_NEW, "settings form: x_min_margin_pct"), S47_SETTINGS_NOTE, SETTINGS_NOTE, "settings form: the note"));
await edit("dayForm", VIEW.dayForm, (a) => swap(swap(a, S47_DAY_COLUMNS, DAY_COLUMNS, "day form: the columns"), S47_DAY_FORM_NOTE, DAY_NOTE, "day form: the note"));
await edit("boardForm", VIEW.boardForm, (a) => swap(a, S47_BOARD_NOTE, BOARD_NOTE, "board form: the note"));
// 4. «الربح الأدنى للكرتون»: 2 on the active record, and for a new one
const have = "x_min_profit_sar" in (await call(CFG, "fields_get", { attributes: ["type"] }));
const cfg = await activeConfig(["id", "x_name", "x_waste_pct", "x_min_margin_pct", "x_min_order_sar", "x_planned_stops", "x_expected_cartons", ...(have ? ["x_min_profit_sar"] : [])]);
if (!cfg) throw new Error("no active x_pricing_config — stop");
if (cfg.x_min_profit_sar === MIN_PROFIT_SAR) log(`= config #${cfg.id} x_min_profit_sar ${MIN_PROFIT_SAR}`);
else {
  log(`✎ config #${cfg.id} (${cfg.x_name}): x_min_profit_sar ${cfg.x_min_profit_sar ?? "∅"} → ${MIN_PROFIT_SAR} (الهامش القديم ${cfg.x_min_margin_pct}٪ يبقى كما هو، بلا استعمال)`);
  if (APPLY) {
    rb.before.config ??= { id: cfg.id, x_min_profit_sar: cfg.x_min_profit_sar ?? 0, x_min_margin_pct: cfg.x_min_margin_pct, x_waste_pct: cfg.x_waste_pct, x_min_order_sar: cfg.x_min_order_sar, x_planned_stops: cfg.x_planned_stops, x_expected_cartons: cfg.x_expected_cartons }; save();
    await call(CFG, "write", { ids: [cfg.id], vals: { x_min_profit_sar: MIN_PROFIT_SAR } });
  }
}
const profitField = have ? await fieldId(CFG, "x_min_profit_sar") : null;
const defs = profitField ? await call("ir.default", "search_read", { domain: [["field_id", "=", profitField]], fields: ["id", "json_value"] }) : [];
if (defs.length) log(`= ir.default x_min_profit_sar = ${defs[0].json_value} #${defs[0].id}`);
else {
  log(`+ ir.default ${CFG}.x_min_profit_sar = ${MIN_PROFIT_SAR}`);
  if (APPLY) { [rb.created.irDefault] = await call("ir.default", "create", { vals_list: [{ field_id: await fieldId(CFG, "x_min_profit_sar"), json_value: String(MIN_PROFIT_SAR) }] }); save(); log(`  → #${rb.created.irDefault}`); }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
