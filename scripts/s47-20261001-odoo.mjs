// § 47 أ + ب (2026-10-01) — the purchase price is entered NET of VAT, and the profitable price.
//
// What the worker reads and writes from § 47 (src/pricing-engine.ts priceFloor, src/pricing-board.ts):
//   x_pricing_config   x_min_margin_pct «الهامش الأدنى ٪» (5 on the active record, 5 for a new one),
//                      beside «نسبة التالف» in «⚙️ إعدادات التسعير»
//   x_price_day_line   x_break_even «أقل سعر بيع بدون خسارة» = full cost × 1.15
//                      x_suggested_price «السعر المربح المقترح» = full cost × (1 + margin) × 1.15,
//                      rounded up to 0.5 riyal
//                      x_decision + «اعتمد بالسعر المربح» (profit)
// The screens: the board's card and list (+ the two numbers) and its explanation, «💰 أسعار اليوم»
// (+ «المربح المقترح» beside the market price) and the two forms' sentences about the rule; the
// help of «الشراء الصافي» (no ÷ 1.15 any more).
// The purchase tax of a NEW product: the on-create action (§ 46 ب) wrote «15% شامل (مشتريات)» (#43,
// price-included); a purchase price is net now, so it writes the company's own purchase tax
// (price-excluded «15%»), and the one product that § 46 moved to #43 (#113 «رمان مصري») goes back.
// The other products carry the company's tax already.
//
//   node scripts/s47-20261001-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s47-20261001-odoo.mjs --apply            rollback file first, then write (idempotent)
//   node scripts/s47-20261001-odoo.mjs --verify           read-only checks
//   node scripts/s47-20261001-odoo.mjs --rollback [--apply]          views, texts, help, action code, tax and value back
//   node scripts/s47-20261001-odoo.mjs --rollback --drop [--apply]   and delete the fields / selection value / default created here
//                                                                    (only after the worker's code is rolled back: it reads them)
//
// Rollback file: scripts/artifacts/s47-20261001-odoo-rollback.json. The tenant is production: no
// order, invoice, payment, price or price day is written here. No WhatsApp. Nothing deleted.
import {
  APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, log, modelId, one, rollbackFile,
} from "./lib/s40-kit.mjs";
import {
  BOARD_KANBAN, BOARD_LIST, BOARD_NOTE, CARD, DAY_FORM_ANCHOR, DAY_FORM_FIELD, DAY_FORM_NOTE, S46_BOARD_KANBAN, S46_BOARD_LIST, S46_BOARD_NOTE,
  S46_CARD, S46_DAY_FORM_NOTE, S46_SETTINGS_NOTE, SETTINGS_ANCHOR, SETTINGS_FIELD, SETTINGS_NOTE,
} from "./lib/s47-odoo-views.mjs";
import { NAMES as PRODUCT_NAMES } from "./lib/s46-odoo-code.mjs";

const RB = new URL("./artifacts/s47-20261001-odoo-rollback.json", import.meta.url);
const DAY = "x_price_day", LINE = "x_price_day_line", CFG = "x_pricing_config", TMPL = "product.template";
export const MIN_MARGIN_PCT = 5;
const ALL = { active_test: false };
const VIEW = { settings: "utak.pricing_settings_form", dayForm: "utak.price_day_form", boardForm: "utak.pricing_board_form", boardKanban: "utak.pricing_board_kanban", boardList: "utak.pricing_board_list" };
const PROFIT = { value: "profit", name: "اعتمد بالسعر المربح" };
const NET_PURCHASE_HELP = "سعر الشراء كما أُدخل: كل سعر شراء يُدخَل بدون ضريبة (§ 47).";

const CFG_FIELDS = [
  { name: "x_min_margin_pct", ttype: "float", field_description: "الهامش الأدنى ٪",
    help: "يُطبَّق على التكلفة الكاملة الصافية (الشراء + التالف + حصة الكرتون). «السعر المربح المقترح» = التكلفة الكاملة × (1 + هذه النسبة ÷ 100) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال. سعر السوق يُنشر تلقائياً متى بلغه، وإلا يصلك استثناء." },
];
const LINE_FIELDS = [
  { name: "x_break_even", ttype: "float", field_description: "أقل سعر بيع بدون خسارة", help: "التكلفة الكاملة × 1.15 (شامل الضريبة)." },
  { name: "x_suggested_price", ttype: "float", field_description: "السعر المربح المقترح", help: "التكلفة الكاملة × (1 + الهامش الأدنى ٪ ÷ 100) × 1.15، مقرَّباً لأعلى لأقرب نصف ريال (شامل الضريبة)." },
];

const ctx = rollbackFile(RB, "scripts/s47-20261001-odoo.mjs");
const { rb, save } = ctx;
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const fieldId = async (m, f) => one("ir.model.fields", [["model", "=", m], ["name", "=", f]]);
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db"], context: ALL }))[0];
const activeConfig = async (fields) => {
  const today = riyadhToday();
  return (await call(CFG, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields, order: "x_active_from desc, id desc", limit: 1 }))[0];
};
/** The company's purchase tax: it must be an active, price-excluded 15 % (a net price gets its VAT added). */
async function companyPurchaseTax() {
  const [co] = await call("res.company", "read", { ids: [1], fields: ["account_purchase_tax_id", "tax_calculation_rounding_method"] });
  const [t] = co?.account_purchase_tax_id ? await call("account.tax", "read", { ids: [co.account_purchase_tax_id[0]], fields: ["id", "name", "amount", "amount_type", "type_tax_use", "price_include", "active"] }) : [];
  return { tax: t ?? null, rounding: co?.tax_calculation_rounding_method ?? null };
}
const taxLine = (id) => `'supplier_taxes_id': [(6, 0, [${id}])],`;

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before, c = rb.created;
  for (const [k, v] of Object.entries(b.views ?? {})) log(`view ${k} #${v.id}: arch back`);
  if (b.netPurchaseHelp) log(`${LINE}.x_net_purchase help back`);
  if (b.createAction) log(`server action #${b.createAction.id}: code back (purchase tax of a new product)`);
  for (const [id, v] of Object.entries(b.productTax ?? {})) log(`product #${id}: supplier_taxes_id back to ${JSON.stringify(v)}`);
  if (b.config) log(`${CFG} #${b.config.id}: x_min_margin_pct back to ${b.config.x_min_margin_pct}${DROP ? " (dropped with the field)" : ""}`);
  if (APPLY) {
    for (const v of Object.values(b.views ?? {})) await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: v.arch } });
    if (b.netPurchaseHelp) await call("ir.model.fields", "write", { ids: [b.netPurchaseHelp.id], vals: { help: b.netPurchaseHelp.help } });
    if (b.createAction) await call("ir.actions.server", "write", { ids: [b.createAction.id], vals: { code: b.createAction.code } });
    for (const [id, v] of Object.entries(b.productTax ?? {})) await call(TMPL, "write", { ids: [Number(id)], vals: { supplier_taxes_id: [[6, 0, v]] } });
    if (b.config && !DROP) await call(CFG, "write", { ids: [b.config.id], vals: { x_min_margin_pct: b.config.x_min_margin_pct } });
  }
  if (DROP) await dropCreated(rb, [["ir.default", [c.irDefault]], ["ir.model.fields.selection", [c.selection]], ["ir.model.fields", c.fields ?? []]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const gf = await call(CFG, "fields_get", { attributes: ["type", "string"] });
  check(`${CFG}.x_min_margin_pct float «الهامش الأدنى ٪»`, gf.x_min_margin_pct?.type === "float" && gf.x_min_margin_pct?.string === "الهامش الأدنى ٪", JSON.stringify(gf.x_min_margin_pct));
  const lf = await call(LINE, "fields_get", { attributes: ["type", "string", "selection", "store", "help"] });
  for (const d of LINE_FIELDS) check(`${LINE}.${d.name} float «${d.field_description}», stored`, lf[d.name]?.type === "float" && lf[d.name]?.store === true && lf[d.name]?.string === d.field_description);
  check("x_decision = market / skip / edit / profit («اعتمد بالسعر المربح»)", JSON.stringify((lf.x_decision?.selection ?? []).map((s) => s[0])) === JSON.stringify(["market", "skip", "edit", "profit"]) && (lf.x_decision?.selection ?? []).some((s) => s[0] === "profit" && s[1] === PROFIT.name), JSON.stringify(lf.x_decision?.selection));
  check("«الشراء الصافي»: its help no longer divides by 1.15", lf.x_net_purchase?.help === NET_PURCHASE_HELP, lf.x_net_purchase?.help);
  const cfg = await activeConfig(["id", "x_min_margin_pct", "x_waste_pct", "x_min_order_sar", "x_planned_stops", "x_expected_cartons"]);
  check(`active config #${cfg?.id}: الهامش الأدنى ${MIN_MARGIN_PCT}٪`, cfg?.x_min_margin_pct === MIN_MARGIN_PCT, JSON.stringify(cfg));
  if (rb.before.config) check("the other settings untouched (التالف، الحد الأدنى، المحطات، الكراتين)", ["x_waste_pct", "x_min_order_sar", "x_planned_stops", "x_expected_cartons"].every((f) => cfg?.[f] === rb.before.config[f]), JSON.stringify(cfg));
  const fid = await fieldId(CFG, "x_min_margin_pct");
  const defs = await call("ir.default", "search_read", { domain: [["field_id", "=", fid]], fields: ["id", "json_value", "user_id", "company_id"] });
  check("a new settings record starts with 5 (ir.default)", defs.length === 1 && Number(defs[0].json_value) === MIN_MARGIN_PCT && !defs[0].user_id, JSON.stringify(defs));
  // the screens, as Odoo renders them (get_views)
  const sf = await viewOf(VIEW.settings);
  const sArch = String((await call(CFG, "get_views", { views: [[sf.id, "form"]] }))?.views?.form?.arch ?? "");
  check("«⚙️ إعدادات التسعير»: «الهامش الأدنى ٪» right after «نسبة التالف», and the other four and the tiers still there", /name="x_waste_pct"[^>]*\/>\s*<field name="x_min_margin_pct"/.test(sArch) && ["x_min_order_sar", "x_planned_stops", "x_expected_cartons", "x_tier_ids"].every((f) => sArch.includes(f)));
  check("«⚙️ إعدادات التسعير»: the rule's sentence (net purchase, the suggested price)", sf.arch_db.includes(SETTINGS_NOTE) && !sf.arch_db.includes(S46_SETTINGS_NOTE));
  const bf = await viewOf(VIEW.boardForm), bk = await viewOf(VIEW.boardKanban), bl = await viewOf(VIEW.boardList), df = await viewOf(VIEW.dayForm);
  const bArch = String((await call(DAY, "get_views", { views: [[bf.id, "form"]] }))?.views?.form?.arch ?? "");
  check("board form renders the card with «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح»", bArch.includes('name="x_break_even"') && bArch.includes('name="x_suggested_price"') && bArch.includes("أقل سعر بيع بدون خسارة") && bArch.includes("السعر المربح المقترح") && bf.arch_db.includes(CARD));
  check("board form: the explanation is § 47's (no ÷ 1.15 on the purchase)", bf.arch_db.includes(BOARD_NOTE) && !bf.arch_db.includes(S46_BOARD_NOTE));
  check("board form: still read-only, its five buttons and its header untouched", /<form[^>]*create="0"[^>]*>/.test(bArch) && bArch.includes('edit="0"') && (bf.arch_db.match(/<button /g) ?? []).length === 5 && ["x_op_cost", "x_op_expected", "x_op_share", "x_op_basis", "x_op_share_500", "x_n_green", "x_n_none"].every((f) => bArch.includes(f)));
  const lv = await call(LINE, "get_views", { views: [[bk.id, "kanban"], [bl.id, "list"]] });
  check("the board's kanban = scripts/lib/s47-odoo-views.mjs, and renders", bk.arch_db === BOARD_KANBAN && String(lv?.views?.kanban?.arch ?? "").includes('name="x_suggested_price"'));
  check("the board's list = scripts/lib/s47-odoo-views.mjs: the two columns after «التكلفة الكاملة», and renders", bl.arch_db === BOARD_LIST && /name="x_full_cost"[^>]*\/>\s*<field name="x_break_even"[^>]*\/>\s*<field name="x_suggested_price"/.test(String(lv?.views?.list?.arch ?? "")));
  const dArch = String((await call(DAY, "get_views", { views: [[df.id, "form"]] }))?.views?.form?.arch ?? "");
  check("«💰 أسعار اليوم»: «المربح المقترح» (read-only) beside the market price, the decision and the manual price still editable", /name="x_suggested_price"[^>]*readonly="1"/.test(dArch) && dArch.includes('name="x_decision"') && dArch.includes('name="x_manual_price"') && df.arch_db.includes(DAY_FORM_NOTE));
  // the lock of an approved / published day never watches the board's numbers
  const [lock] = await call("base.automation", "read", { ids: [23], fields: ["trigger_field_ids", "active"] });
  const newIds = [await fieldId(LINE, "x_break_even"), await fieldId(LINE, "x_suggested_price")];
  check("the lock automation #23 does not watch the two new fields (an approved day's board can still be written)", lock?.active === true && newIds.every((id) => id && !(lock.trigger_field_ids ?? []).includes(id)), JSON.stringify(lock?.trigger_field_ids));
  // the purchase tax
  const { tax, rounding } = await companyPurchaseTax();
  check(`the company's purchase tax #${tax?.id} «${tax?.name}»: active, 15 %, added on the price (price_include = false)`, tax?.active === true && tax.amount === 15 && tax.amount_type === "percent" && tax.type_tax_use === "purchase" && tax.price_include === false, JSON.stringify(tax));
  check("tax rounding: per line (what the worker's guard mirrors)", rounding === "round_per_line", String(rounding));
  const [act] = await call("ir.actions.server", "search_read", { domain: [["name", "=", PRODUCT_NAMES.onCreateAction]], fields: ["id", "code"] });
  check(`a new product gets the company's purchase tax #${tax?.id} (the on-create action's code)`, String(act?.code ?? "").includes(taxLine(tax?.id)) && !/'supplier_taxes_id': \[\(6, 0, \[43\]\)\]/.test(String(act?.code ?? "")), String(act?.code ?? "").split("\n").find((l) => l.includes("supplier_taxes_id")));
  const included = await call("account.tax", "search_read", { domain: [["type_tax_use", "=", "purchase"], ["price_include_override", "=", "tax_included"], ["amount", "=", 15]], fields: ["id", "name"] });
  const onIncluded = included.length ? await call(TMPL, "search_read", { domain: [["supplier_taxes_id", "in", included.map((t) => t.id)]], fields: ["id", "name"], context: ALL }) : [];
  check(`no product carries a price-included purchase tax (${included.map((t) => `#${t.id} ${t.name}`).join(", ") || "none"})`, onIncluded.length === 0, JSON.stringify(onIncluded));
  for (const [id, v] of Object.entries(rb.before.productTax ?? {})) {
    const [p] = await call(TMPL, "read", { ids: [Number(id)], fields: ["name", "supplier_taxes_id", "default_code", "x_is_active_for_sale", "x_utak_new"] });
    check(`#${id} «${p?.name}»: purchase tax ${JSON.stringify(v)} → [${tax?.id}], nothing else touched (no reference, not for sale, no alert flag)`, JSON.stringify(p?.supplier_taxes_id) === JSON.stringify([tax?.id]) && p.x_is_active_for_sale === false && p.x_utak_new !== true, JSON.stringify(p));
  }
  done();
}

// ---------------------------------------------------------------- plan / apply
save(); // the rollback file before the first write
rb.before.views ??= {};
const cfgModel = await modelId(CFG), lineModel = await modelId(LINE);
// 1. the fields
await ensureFields(ctx, CFG, cfgModel, CFG_FIELDS);
await ensureFields(ctx, LINE, lineModel, LINE_FIELDS);
// 2. «اعتمد بالسعر المربح» in «قرار براء»
const decisionField = await fieldId(LINE, "x_decision");
const sel = await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", decisionField]], fields: ["id", "value", "name", "sequence"], order: "sequence, id" });
if (sel.some((s) => s.value === PROFIT.value)) log(`= x_decision «${PROFIT.name}» #${sel.find((s) => s.value === PROFIT.value).id}`);
else {
  log(`+ x_decision: «${PROFIT.name}» (${PROFIT.value}) after ${sel.map((s) => s.value).join(" / ")}`);
  if (APPLY) {
    [rb.created.selection] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: decisionField, value: PROFIT.value, name: PROFIT.name, sequence: Math.max(0, ...sel.map((s) => s.sequence)) + 1 }] });
    save(); log(`  → #${rb.created.selection}`);
  }
}
// 3. the help of «الشراء الصافي»
const [np] = await call("ir.model.fields", "search_read", { domain: [["model", "=", LINE], ["name", "=", "x_net_purchase"]], fields: ["id", "help"] });
if (np.help === NET_PURCHASE_HELP) log("= x_net_purchase help");
else {
  log(`✎ x_net_purchase help: «${np.help}» → «${NET_PURCHASE_HELP}»`);
  if (APPLY) { rb.before.netPurchaseHelp ??= { id: np.id, help: np.help }; save(); await call("ir.model.fields", "write", { ids: [np.id], vals: { help: NET_PURCHASE_HELP } }); }
}
// 4. the views: each from its § 46 shape to § 47's (its arch before is kept)
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
  if (!arch.includes(from)) throw new Error(`${what}: the § 46 text was not found — stop (the view changed by hand?)`);
  return arch.replace(from, to);
};
await edit("settings", VIEW.settings, (a) => swap(swap(a, SETTINGS_ANCHOR, SETTINGS_FIELD, "settings form: x_waste_pct"), S46_SETTINGS_NOTE, SETTINGS_NOTE, "settings form: the note"));
await edit("boardKanban", VIEW.boardKanban, (a) => { if (a !== S46_BOARD_KANBAN && a !== BOARD_KANBAN) throw new Error("board kanban: neither the § 46 arch nor § 47's — stop"); return BOARD_KANBAN; });
await edit("boardList", VIEW.boardList, (a) => { if (a !== S46_BOARD_LIST && a !== BOARD_LIST) throw new Error("board list: neither the § 46 arch nor § 47's — stop"); return BOARD_LIST; });
await edit("boardForm", VIEW.boardForm, (a) => swap(swap(a, S46_CARD, CARD, "board form: the card"), S46_BOARD_NOTE, BOARD_NOTE, "board form: the note"));
await edit("dayForm", VIEW.dayForm, (a) => swap(swap(a, DAY_FORM_ANCHOR, DAY_FORM_FIELD, "day form: x_market_count"), S46_DAY_FORM_NOTE, DAY_FORM_NOTE, "day form: the note"));
// 5. «الهامش الأدنى ٪»: 5 on the active record, and for a new one
const haveMargin = "x_min_margin_pct" in (await call(CFG, "fields_get", { attributes: ["type"] }));
const cfg = await activeConfig(["id", "x_name", "x_waste_pct", "x_min_order_sar", "x_planned_stops", "x_expected_cartons", ...(haveMargin ? ["x_min_margin_pct"] : [])]);
if (!cfg) throw new Error("no active x_pricing_config — stop");
if (cfg.x_min_margin_pct === MIN_MARGIN_PCT) log(`= config #${cfg.id} x_min_margin_pct ${MIN_MARGIN_PCT}`);
else {
  log(`✎ config #${cfg.id} (${cfg.x_name}): x_min_margin_pct ${cfg.x_min_margin_pct ?? "∅"} → ${MIN_MARGIN_PCT}`);
  if (APPLY) {
    rb.before.config ??= { id: cfg.id, x_min_margin_pct: cfg.x_min_margin_pct ?? 0, x_waste_pct: cfg.x_waste_pct, x_min_order_sar: cfg.x_min_order_sar, x_planned_stops: cfg.x_planned_stops, x_expected_cartons: cfg.x_expected_cartons }; save();
    await call(CFG, "write", { ids: [cfg.id], vals: { x_min_margin_pct: MIN_MARGIN_PCT } });
  }
}
const marginField = haveMargin ? await fieldId(CFG, "x_min_margin_pct") : null;
const defs = marginField ? await call("ir.default", "search_read", { domain: [["field_id", "=", marginField]], fields: ["id", "json_value"] }) : [];
if (defs.length) log(`= ir.default x_min_margin_pct = ${defs[0].json_value} #${defs[0].id}`);
else {
  log(`+ ir.default ${CFG}.x_min_margin_pct = ${MIN_MARGIN_PCT}`);
  if (APPLY) { [rb.created.irDefault] = await call("ir.default", "create", { vals_list: [{ field_id: marginField, json_value: String(MIN_MARGIN_PCT) }] }); save(); log(`  → #${rb.created.irDefault}`); }
}
// 6. the purchase tax of a new product, and of the product § 46 moved to the price-included one
const { tax, rounding } = await companyPurchaseTax();
log(`ضريبة الشراء للشركة: #${tax?.id} «${tax?.name}» ${tax?.amount}% · price_include=${tax?.price_include} · التقريب ${rounding}`);
if (!tax || !tax.active || tax.amount !== 15 || tax.amount_type !== "percent" || tax.type_tax_use !== "purchase" || tax.price_include) throw new Error(`the company's purchase tax is not an active price-excluded 15%: ${JSON.stringify(tax)} — stop`);
const [act] = await call("ir.actions.server", "search_read", { domain: [["name", "=", PRODUCT_NAMES.onCreateAction]], fields: ["id", "code"] });
if (!act) throw new Error(`server action ${PRODUCT_NAMES.onCreateAction} not found — stop`);
const curTax = /'supplier_taxes_id': \[\(6, 0, \[(\d+)\]\)\],/.exec(act.code);
if (!curTax) throw new Error("the on-create action has no supplier_taxes_id line — stop");
if (Number(curTax[1]) === tax.id) log(`= on-create action #${act.id}: the purchase tax of a new product is #${tax.id}`);
else {
  log(`✎ on-create action #${act.id}: the purchase tax of a new product #${curTax[1]} → #${tax.id}`);
  if (APPLY) { rb.before.createAction ??= { id: act.id, code: act.code }; save(); await call("ir.actions.server", "write", { ids: [act.id], vals: { code: act.code.replace(curTax[0], taxLine(tax.id)) } }); }
}
const included = await call("account.tax", "search_read", { domain: [["type_tax_use", "=", "purchase"], ["price_include_override", "=", "tax_included"], ["amount", "=", 15]], fields: ["id", "name"] });
const onIncluded = included.length ? await call(TMPL, "search_read", { domain: [["supplier_taxes_id", "in", included.map((t) => t.id)]], fields: ["id", "name", "supplier_taxes_id"], order: "id asc", context: ALL }) : [];
if (!onIncluded.length) log("= no product carries a price-included purchase tax");
rb.before.productTax ??= {};
for (const p of onIncluded) {
  log(`✎ product #${p.id} «${p.name}»: supplier_taxes_id ${JSON.stringify(p.supplier_taxes_id)} → [${tax.id}]`);
  if (!APPLY) continue;
  rb.before.productTax[p.id] ??= p.supplier_taxes_id; save();
  // one write, the tax alone: the on-create action is NOT run on it again (it would raise the new-product flag)
  await call(TMPL, "write", { ids: [p.id], vals: { supplier_taxes_id: [[6, 0, [tax.id]]] } });
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
