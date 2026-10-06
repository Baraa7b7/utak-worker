// § 60 (2026-10-06, Baraa's amendment) — what «📊 اليوم» and «📈 تاريخ الأسعار» gain in Odoo, as data: one
// source for scripts/s60-20261006-day.mjs (which writes it to the tenant), the worker's own filters
// (src/history-filters.ts makes the same rows for a new item) and tests/s60-ui.test.mts.
//
// «📊 اليوم» — ONE field more: x_brief_html «خلاصة اليوم», the box of four lines the worker writes,
// FIRST in «📍 اليوم», before the tiles. Nothing else of the form changes (§ 58's notebook and tabs, § 57's
// class and stylesheet stay); the older verifies read the screen through dayArch57Of (scripts/lib/s58-ui.mjs),
// which takes this field off first.
//
// «📈 تاريخ الأسعار» — a tool for analysis, not the day's reading:
//   • its own search view: «فيه سعر سوق» (x_market_price > 0), «فيه سعر شراء», «منشور» and «آخر 14 يوماً»,
//     each in a group of its own (two chosen filters narrow, never widen), and the group-bys;
//   • it opens on «فيه سعر سوق» and «آخر 14 يوماً» (the action's context), the real lines alone (its
//     domain, as § 58 wrote it): no day and no item without a value is drawn;
//   • a line chart, not stacked (§ 58's graph view, checked again); the pie is never the opening view;
//   • ONE saved filter an item active for sale, by its name, shared («المفضلة»): the chart on that item
//     alone, by the day. The script makes them for the items of today; the worker adds a new item's with
//     the day's computation.
// What Odoo does NOT allow here: the aggregate of a custom field is «sum» and ir.model.fields carries no
// column for it (saas~19.4) — so a price is never averaged by Odoo itself. Every opening above keeps a
// point ONE line (a day × an item), where the sum IS the value; folding days or items by hand still sums.
import { NOTEBOOK_OPEN } from "./s58-ui.mjs";

export const DAY_MODEL = "x_price_day";
export const LINE_MODEL = "x_price_day_line";
export const VIEW_DAY = "utak.price_day_form";

// ---------------------------------------------------------------- «خلاصة اليوم»
export const BRIEF_FIELD = "x_brief_html";
/** An HTML field as § 56's chart and § 58's four: Odoo's sanitizer on (tags and attributes), inline style kept. */
const HTML_FLAGS = { sanitize: true, sanitize_overridable: false, sanitize_tags: true, sanitize_attributes: true, sanitize_style: false, sanitize_form: true, strip_style: false, strip_classes: false };
export const SANITIZE_FLAGS = Object.keys(HTML_FLAGS);
export const BRIEF_FIELDS = [
  { name: BRIEF_FIELD, ttype: "html", field_description: "خلاصة اليوم", ...HTML_FLAGS,
    help: "أربعة أسطر بأرقام اليوم: ما يُنشر ومتوسط ربح الكرتون، وأمس مقابل هدفه وأكبر سبب للفرق، ومن كل كرتون كم لنا وأكبر بند، وأهم فرصتين. يكتبه الوركر مع كل حساب ومع ملخص 21:30 (HTML بلا سكربت)." },
];
const TILES_FROM = `<div class="row g-2 mb-2" name="utak_day_tiles">`;
/**
 * The field stands inside a div of its own: Odoo pads the FIRST html field of a notebook page (16px / 32px,
 * `.tab-pane > :first-child.o_field_html .o_readonly`), which would set the box in from the tiles under it.
 */
export const BRIEF_TAG = `<div name="utak_day_brief" class="mb-2"><field name="${BRIEF_FIELD}" readonly="1" nolabel="1"/></div>\n    `;
/** § 60's tag in either form it was ever written in (the bare field of the first apply, 2026-10-06 17:46). */
export const BRIEF_ANY = /<div name="utak_day_brief" class="mb-2"><field name="x_brief_html" readonly="1" nolabel="1"\/><\/div>\n    |<field name="x_brief_html" readonly="1" nolabel="1" class="mb-2"\/>\n    /;
const once = (arch, part) => arch.split(part).length === 2;

/**
 * § 58's arch with the brief first in «📍 اليوم», before the tiles (an arch that already carries it is left
 * as it is; one whose first page does not open on the tiles stops the script).
 */
export function dayArch60(arch) {
  if (arch.includes(BRIEF_TAG)) return arch;
  arch = arch.replace(BRIEF_ANY, "");
  if (!once(arch, `${NOTEBOOK_OPEN}${TILES_FROM}`)) throw new Error("📊 اليوم: the form is not § 58's (its notebook's first page opening on the tiles) — stop (the view was changed by hand?)");
  return arch.replace(`${NOTEBOOK_OPEN}${TILES_FROM}`, `${NOTEBOOK_OPEN}${BRIEF_TAG}${TILES_FROM}`);
}
/** § 60's arch back to § 58's, byte for byte. */
export const dayArch58Of = (arch) => arch.replace(BRIEF_ANY, "");

// ---------------------------------------------------------------- «📈 تاريخ الأسعار»
export const HISTORY_ACTION = "UTAK — تاريخ الأسعار";
export const VIEW_HISTORY_SEARCH = "utak.price_history_search";
export const VIEW_HISTORY_GRAPH = "utak.price_history_graph";
/** Above the board's search view (90): it is never the model's default search view, only this action's. */
export const HISTORY_SEARCH_PRIORITY = 95;
export const HISTORY_DAYS = 14;
/** [name, label, domain] — a group each. */
export const HISTORY_FILTERS = [
  ["f_market", "فيه سعر سوق", "[('x_market_price', '>', 0)]"],
  ["f_purchase", "فيه سعر شراء", "[('x_cost_price', '>', 0)]"],
  ["f_published", "منشور", "[('x_sale_price', '>', 0), ('x_day_id.x_state', '=', 'published')]"],
  ["f_14", `آخر ${HISTORY_DAYS} يوماً`, `[('x_day_date', '>=', (context_today() - relativedelta(days=${HISTORY_DAYS - 1})).strftime('%Y-%m-%d'))]`],
];
/** What the action opens on. */
export const HISTORY_DEFAULTS = ["f_market", "f_14"];
export const HISTORY_CONTEXT = `{${HISTORY_DEFAULTS.map((f) => `'search_default_${f}': 1`).join(", ")}}`;
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const HISTORY_SEARCH_ARCH = `<search string="📈 تاريخ الأسعار">
  <field name="x_product_tmpl_id"/>
${HISTORY_FILTERS.map(([name, label, domain]) => `  <filter name="${name}" string="${label}" domain="${xml(domain)}"/>`).join("\n  <separator/>\n")}
  <separator/>
  <filter name="g_day" string="اليوم" context="{'group_by': 'x_day_date:day'}"/>
  <filter name="g_item" string="الصنف" context="{'group_by': 'x_product_tmpl_id'}"/>
</search>`;

// ---------------------------------------------------------------- a saved filter an item
/** The product's own name: the «[UTAK-…]» reference in front of it removed. */
export const plainName = (name) => String(name ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();
export const ITEM_FILTER_MEASURE = "x_market_price";
/**
 * The saved filter of one item of «📈 تاريخ الأسعار»: its lines that carry a market price, by the day, as a
 * line chart of the market price — shared with every user (no user: «المفضلة» of all). The action's own
 * domain (the real lines alone) still applies. `actionId`: «UTAK — تاريخ الأسعار».
 */
export function itemFilterVals(productId, name, actionId) {
  return {
    name: plainName(name), model_id: LINE_MODEL, action_id: actionId, user_ids: [[6, 0, []]], is_default: false, sort: "[]",
    domain: `[("x_product_tmpl_id", "=", ${productId}), ("x_market_price", ">", 0)]`,
    context: `{"group_by": ["x_day_date:day"], "graph_measure": "${ITEM_FILTER_MEASURE}", "graph_mode": "line", "graph_groupbys": ["x_day_date:day"], "graph_stacked": False}`,
  };
}
