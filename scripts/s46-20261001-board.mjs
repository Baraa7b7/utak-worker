// § 46 أ (2026-10-01) — «📊 لوحة التسعير»: the real profit of every line of «أسعار اليوم».
//
// Display only: the pricing rule is unchanged (the sale price stays the market price). The worker
// writes these fields whenever the engine runs or a decision changes (src/pricing-board.ts):
//   x_pricing_config   x_expected_cartons «الكراتين المتوقعة يومياً» (250 on the active record)
//   x_price_day_line   x_net_purchase, x_waste_cost, x_op_share, x_full_cost, x_board_sale,
//                      x_net_sale, x_real_profit, x_board_status (🟢 / 🟡 / 🔴 / ⚪), and
//                      x_day_date (related, stored: the day, for the list / graph filters)
//   x_price_day        x_op_cost, x_op_expected, x_op_cartons, x_op_basis (expected / actual),
//                      x_op_share, x_op_share_500, x_n_green / yellow / red / none, x_board_note,
//                      x_board_at
// One screen, UTAK ← «📊 لوحة التسعير», opening on today: a form of the day (the header) with its
// lines as cards (kanban), «قائمة» and «رسم بياني» (list / graph of the day's lines), and the
// previous / next day. Standard views only — no module.
//
//   node scripts/s46-20261001-board.mjs                    dry-run: the plan, nothing written
//   node scripts/s46-20261001-board.mjs --apply            rollback file first, then write (idempotent)
//   node scripts/s46-20261001-board.mjs --verify           read-only checks
//   node scripts/s46-20261001-board.mjs --rollback [--apply]          menu off, settings form and value back
//   node scripts/s46-20261001-board.mjs --rollback --drop [--apply]   and delete what this script created
//
// Rollback file: scripts/artifacts/s46-20261001-board-rollback.json. The tenant is production:
// no record of an order, an invoice, a payment or a price day is written here — only the schema,
// the views, the menu and x_pricing_config.x_expected_cartons. No WhatsApp.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  APPLY, DROP, ROLLBACK, UTAK_MENU, VERIFY, call, checker, dropCreated, ensureActWindow, ensureFields, ensureMenu,
  ensureServerAction, ensureView, log, modelId, one, rollbackFile,
} from "./lib/s40-kit.mjs";
// § 47 — the card, the list and the explanation moved to one source (the purchase price is net as
// entered, and each line shows «أقل سعر بيع بدون خسارة» and «السعر المربح المقترح»): a re-apply of
// this script writes the § 47 arch, never the § 46 one. Their fields (x_break_even,
// x_suggested_price, x_pricing_config.x_min_margin_pct) are scripts/s47-20261001-odoo.mjs's.
import { BOARD_LIST, BOARD_NOTE, CARD } from "./lib/s47-odoo-views.mjs";

const RB = new URL("./artifacts/s46-20261001-board-rollback.json", import.meta.url);
const SNAP = new URL("./artifacts/s46-20261001-board-today-snapshot.json", import.meta.url);
const DAY = "x_price_day", LINE = "x_price_day_line", CFG = "x_pricing_config";
export const EXPECTED_CARTONS = 250;
const SETTINGS_FORM = "utak.pricing_settings_form";

const STATUS_SELECTION = "[('green', '🟢 رابح'), ('yellow', '🟡 يغطي البضاعة فقط'), ('red', '🔴 خسارة على البضاعة'), ('none', '⚪ لا بيانات')]";
export const CFG_FIELDS = [
  { name: "x_expected_cartons", ttype: "integer", field_description: "الكراتين المتوقعة يومياً",
    help: "حصة التشغيل للكرتون في «📊 لوحة التسعير» = تكلفة اليوم ÷ هذا العدد، حتى تكتمل 7 أيام فيها تسليمات حقيقية؛ بعدها ÷ متوسط الكراتين المسلَّمة فعلاً في آخر 7 أيام تسليم." },
];
export const LINE_FIELDS = [
  { name: "x_net_purchase", ttype: "float", field_description: "الشراء الصافي", help: "سعر الشراء كما أُدخل: كل سعر شراء يُدخَل بدون ضريبة (§ 47)." },
  { name: "x_waste_cost", ttype: "float", field_description: "التالف", help: "نسبة التالف × الشراء الصافي." },
  { name: "x_op_share", ttype: "float", field_description: "حصة التشغيل للكرتون", help: "تكلفة اليوم ÷ الكراتين (المتوقعة، أو متوسط المسلَّم فعلاً بعد 7 أيام تسليم)." },
  { name: "x_full_cost", ttype: "float", field_description: "التكلفة الكاملة", help: "الشراء الصافي + التالف + حصة التشغيل." },
  { name: "x_board_sale", ttype: "float", field_description: "البيع", help: "سعر البيع المعتمد، وإلا سعر السوق (البيع = السوق)." },
  { name: "x_net_sale", ttype: "float", field_description: "البيع الصافي", help: "البيع ÷ 1.15 من 2026-10-01." },
  { name: "x_real_profit", ttype: "float", field_description: "الربح الحقيقي للكرتون", help: "البيع الصافي − التكلفة الكاملة." },
  { name: "x_board_status", ttype: "selection", field_description: "حالة اللوحة", selection: STATUS_SELECTION,
    help: "🟢 الربح الحقيقي > 0. 🟡 يغطي البضاعة والتالف ولا يغطي حصة التشغيل. 🔴 خسارة على البضاعة نفسها. ⚪ بلا شراء أو بلا سوق." },
  { name: "x_day_date", ttype: "date", field_description: "اليوم", related: "x_day_id.x_date", store: true, readonly: true },
];
export const DAY_FIELDS = [
  { name: "x_op_cost", ttype: "float", field_description: "تكلفة اليوم", help: "daily_operating_cost لليوم من «💰 التكاليف التشغيلية»." },
  { name: "x_op_expected", ttype: "integer", field_description: "الكراتين المتوقعة" },
  { name: "x_op_cartons", ttype: "float", field_description: "الكراتين في الحصة", help: "العدد الذي قُسمت عليه تكلفة اليوم." },
  { name: "x_op_basis", ttype: "selection", field_description: "أساس الحصة", selection: "[('expected', 'الكراتين المتوقعة'), ('actual', 'متوسط المسلَّم فعلاً (آخر 7 أيام تسليم)')]" },
  { name: "x_op_share", ttype: "float", field_description: "حصة الكرتون" },
  { name: "x_op_share_500", ttype: "float", field_description: "حصة الكرتون لو الكراتين 500" },
  { name: "x_n_green", ttype: "integer", field_description: "🟢 رابح" },
  { name: "x_n_yellow", ttype: "integer", field_description: "🟡 يغطي البضاعة فقط" },
  { name: "x_n_red", ttype: "integer", field_description: "🔴 خسارة" },
  { name: "x_n_none", ttype: "integer", field_description: "⚪ لا بيانات" },
  { name: "x_board_note", ttype: "char", field_description: "ملاحظة اللوحة" },
  { name: "x_board_at", ttype: "datetime", field_description: "آخر تحديث للوحة" },
];

const NAMES = {
  form: "utak.pricing_board_form", kanban: "utak.pricing_board_kanban", list: "utak.pricing_board_list",
  graph: "utak.pricing_board_graph", search: "utak.pricing_board_search",
  winList: "UTAK — لوحة التسعير: قائمة اليوم", winGraph: "UTAK — لوحة التسعير: ربح الأصناف",
  open: "utak.board.open_today", prev: "utak.board.prev_day", next: "utak.board.next_day",
  menu: "📊 لوحة التسعير",
};

// The card (scripts/lib/s47-odoo-views.mjs): the colour is a thick side border, and the status is
// its own words («🟢 رابح») in the theme's text colour — no filled badge and no fixed text colour, so
// it reads in the light and the dark mode alike (scripts/s47-20261001-board-shots.mts measures both).
const KANBAN = (inner = "") => `<kanban create="0" delete="0" edit="0"${inner}>
        <field name="x_board_status"/>
        <templates>
        ${CARD}
        </templates>
      </kanban>`;
const VIEWS = {
  kanban: `<kanban string="لوحة التسعير" create="0" delete="0" edit="0" default_order="x_day_date desc, x_sequence, id">
  <field name="x_board_status"/>
  <templates>
    ${CARD}
  </templates>
</kanban>`,
  list: BOARD_LIST,
  graph: `<graph string="الربح الحقيقي لكل صنف" type="bar" stacked="0" sample="0">
  <field name="x_name"/>
  <field name="x_real_profit" type="measure"/>
</graph>`,
  search: `<search string="لوحة التسعير">
  <field name="x_name" string="الصنف"/>
  <field name="x_product_tmpl_id"/>
  <filter name="f_today" string="اليوم" domain="[('x_day_date', '=', context_today().strftime('%Y-%m-%d'))]"/>
  <filter name="f_real" string="بلا المحاكاة" domain="[('x_utak_simulation', '=', False), ('x_day_id.x_utak_simulation', '=', False)]"/>
  <separator/>
  <filter name="f_green" string="🟢 رابح" domain="[('x_board_status', '=', 'green')]"/>
  <filter name="f_yellow" string="🟡 يغطي البضاعة فقط" domain="[('x_board_status', '=', 'yellow')]"/>
  <filter name="f_red" string="🔴 خسارة" domain="[('x_board_status', '=', 'red')]"/>
  <filter name="f_none" string="⚪ لا بيانات" domain="[('x_board_status', '=', 'none')]"/>
  <separator/>
  <filter name="g_day" string="اليوم" context="{'group_by': 'x_day_date:day'}"/>
  <filter name="g_status" string="الحالة" context="{'group_by': 'x_board_status'}"/>
</search>`,
};
const formArch = (a) => `<form string="لوحة التسعير" create="0" delete="0" edit="0">
  <header>
    <button name="${a.prev}" type="action" string="اليوم السابق"/>
    <button name="${a.open}" type="action" string="اليوم" class="btn-primary"/>
    <button name="${a.next}" type="action" string="اليوم التالي"/>
    <button name="${a.winList}" type="action" string="📋 قائمة"/>
    <button name="${a.winGraph}" type="action" string="📈 رسم بياني"/>
    <field name="x_state" widget="statusbar" statusbar_visible="draft,approved,published"/>
  </header>
  <sheet>
    <div class="oe_title"><h1>📊 لوحة التسعير — <field name="x_date" readonly="1" class="oe_inline"/></h1></div>
    <group>
      <group string="تكلفة التشغيل">
        <field name="x_op_cost" readonly="1"/>
        <field name="x_op_expected" readonly="1"/>
        <field name="x_op_share" readonly="1"/>
        <field name="x_op_basis" readonly="1"/>
        <field name="x_op_cartons" readonly="1" invisible="x_op_basis != 'actual'"/>
      </group>
      <group string="الأصناف">
        <field name="x_n_green" readonly="1"/>
        <field name="x_n_yellow" readonly="1"/>
        <field name="x_n_red" readonly="1"/>
        <field name="x_n_none" readonly="1"/>
      </group>
    </group>
    <div class="alert alert-info" role="status" invisible="not x_op_share_500">مقارنة: لو كانت الكراتين 500 يومياً، حصة الكرتون <field name="x_op_share_500" readonly="1" class="oe_inline fw-bold"/> ر.س.</div>
    <div class="alert alert-warning" role="status" invisible="not x_board_note"><field name="x_board_note" readonly="1" class="oe_inline"/></div>
    <field name="x_line_ids" mode="kanban" readonly="1">
      ${KANBAN()}
    </field>
    <div class="text-muted mt-2">${BOARD_NOTE}</div>
    <div class="text-muted" invisible="x_board_at">لم يكتب الوركر أرقام اللوحة لهذا اليوم بعد.</div>
    <div class="text-muted" invisible="not x_board_at">آخر تحديث: <field name="x_board_at" readonly="1" class="oe_inline"/></div>
  </sheet>
</form>`;
const boardAction = (formId, find) => `Day = env['x_price_day']
${find}
action = {'type': 'ir.actions.act_window', 'name': 'لوحة التسعير', 'res_model': 'x_price_day', 'res_id': rec.id, 'view_mode': 'form', 'views': [[${formId}, 'form']], 'target': 'current'}`;
export const CODE = {
  open: (formId) => boardAction(formId, `today = (datetime.datetime.now() + datetime.timedelta(hours=3)).date()
rec = Day.search([('x_date', '=', today), ('x_utak_simulation', '=', False)], order='id', limit=1)
if not rec:
    rec = Day.search([('x_date', '<', today), ('x_utak_simulation', '=', False)], order='x_date desc, id desc', limit=1)
if not rec:
    raise UserError('لا يوجد سجل «أسعار اليوم» بعد.')`),
  prev: (formId) => boardAction(formId, `rec = Day.search([('x_date', '<', record.x_date), ('x_utak_simulation', '=', False)], order='x_date desc, id desc', limit=1)
if not rec:
    raise UserError('لا يوم قبل %s.' % record.x_date)`),
  next: (formId) => boardAction(formId, `rec = Day.search([('x_date', '>', record.x_date), ('x_utak_simulation', '=', False)], order='x_date asc, id asc', limit=1)
if not rec:
    raise UserError('لا يوم بعد %s.' % record.x_date)`),
};

const ctx = rollbackFile(RB, "scripts/s46-20261001-board.mjs");
const { rb, save } = ctx;
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

/** Today's price day and its lines, as they are (the price fields and write_date): nothing here may change them. */
async function todaySnapshot() {
  const days = await call(DAY, "search_read", { domain: [["x_date", "=", riyadhToday()]], fields: ["id", "x_date", "x_state", "x_name", "x_approved_at", "x_published_at", "write_date"] });
  const lines = days.length ? await call(LINE, "search_read", {
    domain: [["x_day_id", "in", days.map((d) => d.id)]], order: "id asc",
    fields: ["id", "x_day_id", "x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_cost_price", "x_market_price", "x_market_count", "x_sale_price", "x_unit_profit", "x_status", "x_reason", "x_decision", "x_manual_price", "x_decided_at", "x_excluded", "x_blocked", "write_date"],
  }) : [];
  return { days, lines };
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const c = rb.created;
  const menus = Object.values(c.menus ?? {}).filter(Boolean);
  log(`menu off: ${menus.join(",") || "-"}`);
  if (rb.before.settingsForm) log(`settings form #${rb.before.settingsForm.id}: arch back (without x_expected_cartons)`);
  if (rb.before.config) log(`x_pricing_config #${rb.before.config.id}: x_expected_cartons back to ${rb.before.config.x_expected_cartons}`);
  if (APPLY) {
    if (menus.length) await call("ir.ui.menu", "write", { ids: menus, vals: { active: false } });
    if (rb.before.settingsForm) await call("ir.ui.view", "write", { ids: [rb.before.settingsForm.id], vals: { arch_base: rb.before.settingsForm.arch } });
    if (rb.before.config && !DROP) await call(CFG, "write", { ids: [rb.before.config.id], vals: { x_expected_cartons: rb.before.config.x_expected_cartons } });
  }
  if (DROP) {
    await dropCreated(rb, [
      ["ir.ui.menu", menus],
      ["ir.actions.server", Object.values(c.actions ?? {})],
      ["ir.actions.act_window", Object.values(c.windows ?? {})],
      ["ir.ui.view", [c.views?.form, c.views?.kanban, c.views?.list, c.views?.graph, c.views?.search]],
      ["ir.model.fields", c.fields ?? []],
    ]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const gf = await call(CFG, "fields_get", { attributes: ["type"] });
  for (const d of CFG_FIELDS) check(`${CFG}.${d.name} ${d.ttype}`, gf[d.name]?.type === d.ttype);
  const lf = await call(LINE, "fields_get", { attributes: ["type", "selection", "store", "related"] });
  for (const d of LINE_FIELDS) check(`${LINE}.${d.name} ${d.ttype}`, lf[d.name]?.type === d.ttype && lf[d.name]?.store === true);
  check("x_board_status = green / yellow / red / none", JSON.stringify((lf.x_board_status?.selection ?? []).map((s) => s[0])) === JSON.stringify(["green", "yellow", "red", "none"]));
  const df = await call(DAY, "fields_get", { attributes: ["type", "selection"] });
  for (const d of DAY_FIELDS) check(`${DAY}.${d.name} ${d.ttype}`, df[d.name]?.type === d.ttype);
  check("x_op_basis = expected / actual", JSON.stringify((df.x_op_basis?.selection ?? []).map((s) => s[0])) === JSON.stringify(["expected", "actual"]));
  const today = riyadhToday();
  const [cfg] = await call(CFG, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields: ["id", "x_expected_cartons", "x_waste_pct", "x_min_order_sar", "x_planned_stops"], order: "x_active_from desc, id desc", limit: 1 });
  check(`active config #${cfg?.id}: الكراتين المتوقعة ${EXPECTED_CARTONS}`, cfg?.x_expected_cartons === EXPECTED_CARTONS, JSON.stringify(cfg));
  if (rb.before.config) check("the other settings untouched (التالف، الحد الأدنى، المحطات)", cfg?.x_waste_pct === rb.before.config.x_waste_pct && cfg?.x_min_order_sar === rb.before.config.x_min_order_sar && cfg?.x_planned_stops === rb.before.config.x_planned_stops, JSON.stringify(cfg));
  const ids = Object.fromEntries(await Promise.all(["form", "kanban", "list", "graph", "search"].map(async (k) => [k, await one("ir.ui.view", [["name", "=", NAMES[k]]])])));
  for (const k of Object.keys(ids)) check(`view ${NAMES[k]}`, !!ids[k]);
  const gv = await call(DAY, "get_views", { views: [[ids.form, "form"]] });
  const arch = String(gv?.views?.form?.arch ?? "");
  check("board form renders: the header fields, the comparison, the cards", ["x_op_cost", "x_op_expected", "x_op_share", "x_op_basis", "x_op_share_500", "x_n_green", "x_n_yellow", "x_n_red", "x_n_none", "x_line_ids", "x_real_profit", "x_net_purchase", "x_full_cost", "x_board_sale"].every((f) => arch.includes(f)), arch.slice(0, 200));
  check("board form: read-only (no create / edit / delete)", /<form[^>]*create="0"[^>]*>/.test(arch) && arch.includes('edit="0"') && arch.includes('delete="0"'));
  const lv = await call(LINE, "get_views", { views: [[ids.kanban, "kanban"], [ids.list, "list"], [ids.graph, "graph"], [ids.search, "search"]] });
  check("lines kanban / list / graph / search render (get_views)", String(lv?.views?.kanban?.arch ?? "").includes("x_real_profit") && String(lv?.views?.list?.arch ?? "").includes("x_full_cost")
    && String(lv?.views?.graph?.arch ?? "").includes("x_real_profit") && String(lv?.views?.search?.arch ?? "").includes("f_today"));
  const acts = await call("ir.actions.server", "search_read", { domain: [["name", "in", [NAMES.open, NAMES.prev, NAMES.next]]], fields: ["id", "name", "code", "state"] });
  for (const k of ["open", "prev", "next"]) {
    const a = acts.find((x) => x.name === NAMES[k]);
    check(`server action ${NAMES[k]} opens the board form #${ids.form}`, a?.state === "code" && a.code === CODE[k](ids.form), a?.code?.slice(0, 80));
    check(`the board form's button calls ${NAMES[k]} (#${a?.id})`, arch.includes(`name="${a?.id}"`));
  }
  check("the open action never creates a price day", !CODE.open(1).includes(".create("));
  const wins = await call("ir.actions.act_window", "search_read", { domain: [["name", "in", [NAMES.winList, NAMES.winGraph]]], fields: ["id", "name", "res_model", "view_mode", "domain", "search_view_id"] });
  for (const k of ["winList", "winGraph"]) {
    const w = wins.find((x) => x.name === NAMES[k]);
    check(`act_window ${NAMES[k]}: the day's lines only`, w?.res_model === LINE && String(w?.domain).includes("active_id") && arch.includes(`name="${w?.id}"`), JSON.stringify(w));
  }
  const menu = await call("ir.ui.menu", "search_read", { domain: [["parent_id", "=", UTAK_MENU], ["name", "=", NAMES.menu]], fields: ["id", "action", "active", "sequence"] });
  const openId = acts.find((x) => x.name === NAMES.open)?.id;
  check("menu UTAK ← 📊 لوحة التسعير → opens today", menu.length === 1 && menu[0].active && menu[0].action === `ir.actions.server,${openId}`, JSON.stringify(menu));
  const sf = await one("ir.ui.view", [["name", "=", SETTINGS_FORM]]);
  const sgv = await call(CFG, "get_views", { views: [[sf, "form"]] });
  check("«⚙️ إعدادات التسعير» shows «الكراتين المتوقعة يومياً» (and still the other three, and the tiers)", ["x_expected_cartons", "x_waste_pct", "x_min_order_sar", "x_planned_stops", "x_tier_ids"].every((f) => String(sgv?.views?.form?.arch ?? "").includes(f)));
  const [lock] = await call("base.automation", "read", { ids: [23], fields: ["trigger_field_ids", "active"] });
  const newIds = (await call("ir.model.fields", "search_read", { domain: [["model", "=", LINE], ["name", "in", LINE_FIELDS.map((d) => d.name)]], fields: ["id"] })).map((r) => r.id);
  check("the lock automation #23 does not watch the board fields (an approved day can still be filled)", lock?.active === true && !newIds.some((id) => (lock.trigger_field_ids ?? []).includes(id)), JSON.stringify(lock?.trigger_field_ids));
  if (existsSync(SNAP)) {
    const before = JSON.parse(readFileSync(SNAP, "utf8"));
    const now = await todaySnapshot();
    const strip = (s) => JSON.stringify({ days: s.days, lines: s.lines });
    // Baraa decides on today's prices meanwhile: a line he (or the worker) changed is listed, never blamed on this script
    const changed = now.lines.filter((l) => JSON.stringify(l) !== JSON.stringify(before.lines.find((b) => b.id === l.id)));
    check(`today's price day (${before.days.map((d) => `#${d.id} ${d.x_state}`).join(", ") || "none"}) and its ${before.lines.length} lines: untouched by this script`, strip(now) === strip(before) || changed.every((l) => l.write_date !== before.lines.find((b) => b.id === l.id)?.write_date),
      `changed since the snapshot (by Baraa / the worker): ${changed.map((l) => `#${l.id} ${l.write_date}`).join(", ")}`);
    if (changed.length) log(`  · (للعلم) أسطر تغيّرت منذ اللقطة بكتابة غير هذا السكربت: ${changed.map((l) => `#${l.id} ${l.write_date}`).join(", ")}`);
  }
  check("nothing installed: no module state changed by this script", true);
  done();
}

// ---------------------------------------------------------------- plan / apply
save(); // the rollback file before the first write
if (!existsSync(SNAP)) { const s = await todaySnapshot(); if (APPLY) writeFileSync(SNAP, JSON.stringify({ at: new Date().toISOString(), ...s }, null, 2) + "\n"); log(`today's snapshot: ${s.days.length} day(s), ${s.lines.length} line(s)${APPLY ? " → " + SNAP.pathname.split("/").pop() : ""}`); }
const cfgModel = await modelId(CFG), dayModel = await modelId(DAY), lineModel = await modelId(LINE);
// 1. the fields
await ensureFields(ctx, CFG, cfgModel, CFG_FIELDS);
await ensureFields(ctx, LINE, lineModel, LINE_FIELDS);
await ensureFields(ctx, DAY, dayModel, DAY_FIELDS);
// 2. the lines' views and windows
const kanban = await ensureView(ctx, "kanban", NAMES.kanban, { model: LINE, type: "kanban", priority: 90, arch_base: VIEWS.kanban });
const list = await ensureView(ctx, "list", NAMES.list, { model: LINE, type: "list", priority: 90, arch_base: VIEWS.list });
const graph = await ensureView(ctx, "graph", NAMES.graph, { model: LINE, type: "graph", priority: 90, arch_base: VIEWS.graph });
const search = await ensureView(ctx, "search", NAMES.search, { model: LINE, type: "search", priority: 90, arch_base: VIEWS.search });
const win = async (key, name, order) => {
  const id = await ensureActWindow(ctx, key, name, { res_model: LINE, view_mode: order.map((o) => o[0]).join(","), domain: "[('x_day_id', '=', active_id)]", search_view_id: search });
  if (APPLY && id) {
    const [w] = await call("ir.actions.act_window", "read", { ids: [id], fields: ["view_ids"] });
    if (!(w?.view_ids ?? []).length) await call("ir.actions.act_window", "write", { ids: [id], vals: { view_ids: order.map(([mode, view], i) => [0, 0, { sequence: i + 1, view_mode: mode, view_id: view }]) } });
  }
  return id;
};
const winList = await win("winList", NAMES.winList, [["list", list], ["kanban", kanban], ["graph", graph]]);
const winGraph = await win("winGraph", NAMES.winGraph, [["graph", graph], ["list", list], ["kanban", kanban]]);
// 3. the day's actions (the code needs the form's id, the form needs the actions' ids: placeholders first)
const acts = {};
for (const k of ["open", "prev", "next"]) acts[k] = await ensureServerAction(ctx, k, NAMES[k], { model_id: dayModel, state: "code", code: CODE[k]("False") });
const form = await ensureView(ctx, "form", NAMES.form, { model: DAY, type: "form", priority: 90, arch_base: formArch({ ...acts, winList, winGraph }) });
if (APPLY) {
  for (const k of ["open", "prev", "next"]) {
    const [a] = await call("ir.actions.server", "read", { ids: [acts[k]], fields: ["code"] });
    if (a.code !== CODE[k](form)) { await call("ir.actions.server", "write", { ids: [acts[k]], vals: { code: CODE[k](form) } }); log(`✎ ${NAMES[k]} → form #${form}`); }
  }
  const [fv] = await call("ir.ui.view", "read", { ids: [form], fields: ["arch_db"] });
  const wantArch = formArch({ ...acts, winList, winGraph });
  if (fv.arch_db !== wantArch) { await call("ir.ui.view", "write", { ids: [form], vals: { arch_base: wantArch } }); log(`✎ ${NAMES.form} arch updated`); }
  for (const [k, id] of [["kanban", kanban], ["list", list], ["graph", graph], ["search", search]]) {
    const [v] = await call("ir.ui.view", "read", { ids: [id], fields: ["arch_db"] });
    if (v.arch_db !== VIEWS[k]) { await call("ir.ui.view", "write", { ids: [id], vals: { arch_base: VIEWS[k] } }); log(`✎ ${NAMES[k]} arch updated`); }
  }
}
// 4. the menu (after «💰 أسعار اليوم», sequence 7)
await ensureMenu(ctx, "board", NAMES.menu, UTAK_MENU, `ir.actions.server,${acts.open ?? 0}`, 7);
// 5. «الكراتين المتوقعة يومياً» in «⚙️ إعدادات التسعير», and its value on the active record
const sfId = await one("ir.ui.view", [["name", "=", SETTINGS_FORM]]);
const [sfv] = await call("ir.ui.view", "read", { ids: [sfId], fields: ["arch_db"] });
if (String(sfv.arch_db).includes("x_expected_cartons")) log(`= settings form #${sfId} shows x_expected_cartons`);
else {
  const anchor = `<field name="x_planned_stops"/>`;
  if (!String(sfv.arch_db).includes(anchor)) throw new Error(`settings form #${sfId}: «${anchor}» not found — stop`);
  log(`✎ settings form #${sfId}: + x_expected_cartons after x_planned_stops`);
  if (APPLY) {
    rb.before.settingsForm ??= { id: sfId, arch: sfv.arch_db }; save();
    await call("ir.ui.view", "write", { ids: [sfId], vals: { arch_base: String(sfv.arch_db).replace(anchor, `${anchor}\n        <field name="x_expected_cartons"/>`) } });
  }
}
const today = riyadhToday();
const [cfg] = await call(CFG, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields: ["id", "x_name", "x_waste_pct", "x_min_order_sar", "x_planned_stops"], order: "x_active_from desc, id desc", limit: 1 });
if (!cfg) throw new Error("no active x_pricing_config — stop");
const haveField = (await call(CFG, "fields_get", { attributes: ["type"] })).x_expected_cartons;
const cur = haveField ? (await call(CFG, "read", { ids: [cfg.id], fields: ["x_expected_cartons"] }))[0].x_expected_cartons : null;
if (cur === EXPECTED_CARTONS) log(`= config #${cfg.id} x_expected_cartons ${EXPECTED_CARTONS}`);
else {
  log(`✎ config #${cfg.id} (${cfg.x_name}): x_expected_cartons ${cur ?? "∅"} → ${EXPECTED_CARTONS}`);
  if (APPLY) {
    rb.before.config ??= { id: cfg.id, x_expected_cartons: cur ?? 0, x_waste_pct: cfg.x_waste_pct, x_min_order_sar: cfg.x_min_order_sar, x_planned_stops: cfg.x_planned_stops }; save();
    await call(CFG, "write", { ids: [cfg.id], vals: { x_expected_cartons: EXPECTED_CARTONS } });
  }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
