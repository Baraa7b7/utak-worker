// § 58 ج + د (2026-10-05) — «💲 التسعير» ← «📊 اليوم» with its tabs, and «📈 تاريخ الأسعار», as data. One
// source for scripts/s58-20261005-day.mjs (which writes it to the tenant), the verify of § 48, § 56 and
// § 57 (which read the day's arch back through dayArch57Of) and tests/s58-ui.test.mts.
//
// The day's form (utak.price_day_form) keeps everything § 57 left — the header and its buttons, the
// form's class and stylesheet, the links, the banners, the title, the state and the publication time —
// and the rest of the sheet, from the tiles to «تقرير النشر», moves as it is into the FIRST page of a
// native notebook:
//   «📍 اليوم»           everything the screen showed (the tiles, the chart, the table, the day's
//                        details, «تقرير النشر»), with ONE addition: x_target_html («🎯 هدف اليوم» and
//                        yesterday against its target) right under the tiles;
//   «💧 وين يروح المال»  x_tab_money_html
//   «⭐ الأصناف»          x_tab_items_html
//   «🎯 الفرص والقادم»   x_tab_next_html
// Each tab is one HTML field the worker writes under § 56's rules (inline style, no <style>, Odoo's own
// colour classes, the field's sanitizer on), read-only here; an empty one says how it is built.
// One link more beside «⚙️ الإعدادات»: «📊 حلّل بنفسك», which opens «📈 تاريخ الأسعار».
//
// «📈 تاريخ الأسعار» is Odoo's own graph and pivot on x_price_day_line (no custom JS), the real lines
// only (neither the line nor its day marked x_utak_simulation): the market price, the sale price, the
// purchase price, the real profit and the carton's contribution, by the day and the item. Its menu sits
// under «💲 التسعير». (A cell «day × item» is one line; a total over days or items is Odoo's sum.)
//
// «⚙️ الإعدادات» gains «هدف الربح اليومي (ريال)» (x_daily_profit_target) under «الكراتين المتوقعة يومياً».
import { DAY_MODEL, LINE_MODEL, VIEW_DAY } from "./s56-ui.mjs";
import { FORM_OPEN } from "./s57-ui.mjs";
import { CONTRIBUTION_FIELD, HTML_FIELDS, PROFIT_TARGET_FIELD } from "./s58-odoo.mjs";

export { DAY_MODEL, LINE_MODEL, VIEW_DAY };
export const VIEW_SETTINGS = "utak.pricing_settings_form";
export const PRICING_MENU = 582;        // UTAK ← 💲 التسعير
export const SETTINGS_ACTION = 1027;    // the link «⚙️ الإعدادات» of the day's form

export const TARGET_FIELD = "x_target_html";
export const TODAY_TAB = { name: "utak_today", title: "📍 اليوم" };
/** The three new tabs, in the order's order: the page's name, its title, its field. */
export const TABS = [
  { name: "utak_money", title: "💧 وين يروح المال", field: "x_tab_money_html" },
  { name: "utak_items", title: "⭐ الأصناف", field: "x_tab_items_html" },
  { name: "utak_next", title: "🎯 الفرص والقادم", field: "x_tab_next_html" },
];
export const NOTEBOOK = "utak_day_tabs";
export const TAB_EMPTY_NOTE = "يُبنى مع أول حساب لليوم: اضغط «🔄 إعادة الحساب».";
export const HISTORY_BUTTON = "📊 حلّل بنفسك";

// ---------------------------------------------------------------- «📈 تاريخ الأسعار»
export const HISTORY_TITLE = "📈 تاريخ الأسعار";
export const HISTORY_ACTION = "UTAK — تاريخ الأسعار";
export const VIEW_HISTORY_GRAPH = "utak.price_history_graph";
export const VIEW_HISTORY_PIVOT = "utak.price_history_pivot";
/** The measures, in the order's order: the field and how Odoo names it. */
export const HISTORY_MEASURES = [
  ["x_market_price", "سعر السوق"], ["x_sale_price", "سعر البيع"], ["x_cost_price", "سعر الشراء"], ["x_real_profit", "الربح الحقيقي للكرتون"], [CONTRIBUTION_FIELD, "مساهمة الكرتون"],
];
export const HISTORY_DAY_FIELD = "x_day_date";
export const HISTORY_ITEM_FIELD = "x_product_tmpl_id";
/** The real lines alone: neither the line nor its day is a simulation's. */
export const HISTORY_DOMAIN = "[('x_utak_simulation', '=', False), ('x_day_id.x_utak_simulation', '=', False)]";
export const HISTORY_MENU_SEQUENCE = 25;   // after «📅 الأيام السابقة» (20), before «📥 عروض المصادر» (30)
export const HISTORY_GRAPH_ARCH = `<graph string="${HISTORY_TITLE}" type="line" stacked="0" sample="0">
  <field name="${HISTORY_DAY_FIELD}" interval="day"/>
  <field name="${HISTORY_ITEM_FIELD}"/>
  <field name="${HISTORY_MEASURES[0][0]}" type="measure"/>
</graph>`;
export const HISTORY_PIVOT_ARCH = `<pivot string="${HISTORY_TITLE}" sample="0">
  <field name="${HISTORY_ITEM_FIELD}" type="row"/>
  <field name="${HISTORY_DAY_FIELD}" interval="day" type="col"/>
${HISTORY_MEASURES.map(([f]) => `  <field name="${f}" type="measure"/>`).join("\n")}
</pivot>`;

// ---------------------------------------------------------------- the day's form
const TILES_FROM = `<div class="row g-2 mb-2" name="utak_day_tiles">`;
const APPROVED_FROM = `<div class="text-muted mb-3" invisible="not (x_state in ('draft', 'missed'))" name="utak_approved_note">`;
const SETTINGS_LINK = `<button name="${SETTINGS_ACTION}" type="action" string="⚙️ الإعدادات" class="btn btn-link px-2"/>`;
const SHEET_END = "</sheet>\n</form>";

export const historyLink = (actionId) => `\n      <button name="${actionId}" type="action" string="${HISTORY_BUTTON}" class="btn btn-link px-2"/>`;
export const NOTEBOOK_OPEN = `<notebook name="${NOTEBOOK}">\n    <page string="${TODAY_TAB.title}" name="${TODAY_TAB.name}">\n    `;
export const TARGET_TAG = `<field name="${TARGET_FIELD}" readonly="1" nolabel="1" class="mb-3"/>\n    `;
export const tabPage = (t) => `    <page string="${t.title}" name="${t.name}">
      <field name="${t.field}" readonly="1" nolabel="1"/>
      <div class="text-muted" invisible="${t.field}">${TAB_EMPTY_NOTE}</div>
    </page>\n`;
export const NOTEBOOK_CLOSE = `  </page>\n${TABS.map(tabPage).join("")}    </notebook>\n  `;
const once = (arch, part) => arch.split(part).length === 2;

/**
 * The tenant's arch with § 58's notebook, target and link (an arch that already carries them is left as
 * it is; one that is not § 57's — its class, its tiles, the note under them, the link «⚙️ الإعدادات», one
 * sheet's end, no notebook — stops the script). `historyAction`: the id of «📈 تاريخ الأسعار».
 */
export function dayArch58(arch, historyAction) {
  if (arch.includes(`<notebook name="${NOTEBOOK}">`)) return arch;
  if (!Number.isInteger(historyAction) || historyAction <= 0) throw new Error("📊 اليوم: the action of «📈 تاريخ الأسعار» is not known — stop");
  if (!arch.startsWith(FORM_OPEN) || !once(arch, TILES_FROM) || !once(arch, APPROVED_FROM) || !once(arch, SETTINGS_LINK) || !arch.endsWith(SHEET_END) || arch.includes("<notebook")
    || arch.indexOf(TILES_FROM) > arch.indexOf(APPROVED_FROM) || arch.indexOf(SETTINGS_LINK) > arch.indexOf(TILES_FROM)) {
    throw new Error("📊 اليوم: the form is not § 57's (its class, its tiles, the note under them, the settings' link, the sheet's end) — stop (the view was changed by hand?)");
  }
  const end = arch.length - SHEET_END.length;
  return [
    arch.slice(0, arch.indexOf(SETTINGS_LINK) + SETTINGS_LINK.length), historyLink(historyAction),
    arch.slice(arch.indexOf(SETTINGS_LINK) + SETTINGS_LINK.length, arch.indexOf(TILES_FROM)), NOTEBOOK_OPEN,
    arch.slice(arch.indexOf(TILES_FROM), arch.indexOf(APPROVED_FROM)), TARGET_TAG,
    arch.slice(arch.indexOf(APPROVED_FROM), end), NOTEBOOK_CLOSE, SHEET_END,
  ].join("");
}
/** § 58's arch back to § 57's, byte for byte (an arch without § 58's notebook is returned as it is): what the older verifies compare. */
export function dayArch57Of(arch) {
  if (!arch.includes(`<notebook name="${NOTEBOOK}">`)) return arch;
  const link = new RegExp(`\\n      <button name="\\d+" type="action" string="${HISTORY_BUTTON}" class="btn btn-link px-2"/>`);
  const out = arch.replace(link, "").replace(NOTEBOOK_OPEN, "").replace(TARGET_TAG, "").replace(`${NOTEBOOK_CLOSE}${SHEET_END}`, SHEET_END);
  if (out.includes("<notebook") || out.includes(TARGET_FIELD) || out.includes(HISTORY_BUTTON) || TABS.some((t) => out.includes(t.field))) throw new Error("📊 اليوم: § 58's parts could not be taken off the form — stop (the view was changed by hand?)");
  return out;
}

// ---------------------------------------------------------------- «⚙️ الإعدادات»
const CARTONS_TAG = `<field name="x_expected_cartons"/>`;
export const PROFIT_TARGET_TAG = `\n        <field name="${PROFIT_TARGET_FIELD}"/>`;
/** The settings' form with «هدف الربح اليومي» under «الكراتين المتوقعة يومياً» (already there: left as it is). */
export function settingsArch58(arch) {
  if (arch.includes(`name="${PROFIT_TARGET_FIELD}"`)) return arch;
  if (!once(arch, CARTONS_TAG)) throw new Error("⚙️ الإعدادات: «الكراتين المتوقعة يومياً» was not found once in the form — stop");
  return arch.replace(CARTONS_TAG, `${CARTONS_TAG}${PROFIT_TARGET_TAG}`);
}
export const settingsArch57Of = (arch) => arch.replace(PROFIT_TARGET_TAG, "");

/** Every field the day's form names for the first time in § 58. */
export const NEW_DAY_FIELDS = [TARGET_FIELD, ...TABS.map((t) => t.field)];
export const HTML_FIELD_NAMES = HTML_FIELDS.map((f) => f.name);
