// § 57 أ (2026-10-05) — «💲 التسعير» ← «📊 اليوم» as Baraa sees it in Odoo itself, as data. One source
// for scripts/s57-20261005-day.mjs (which writes it to the tenant), the verify of § 48 and § 56 (which
// read the arch after it) and tests/s57-day.test.mts.
//
// What he saw (his screenshot of 10-05, the record #54, a wide screen, dark): the form in the right half
// only, the left half empty; the table's cells cut («…50 (+2.43)») and its headings short; the chat
// bubbles over the table. Read from the tenant, not assumed:
//   • x_price_day carries NO chatter (is_mail_thread = false, no <chatter> in utak.price_day_form and
//     nothing inherits it). The half that stays empty is Odoo's own stylesheet:
//         .o_form_view .o_form_sheet_bg { max-width: 1400px }   .o_form_view .o_form_renderer { max-width: 2600px }
//     — on his 3008-pixel screen the sheet stops at 1400 and sits at the start (the right, in Arabic).
//   • the list is table-layout: fixed with a width Odoo computes for each column, every char cell
//     white-space: nowrap + text-overflow: ellipsis, every heading a .text-truncate span.
//   • the bubbles are .o-mail-ChatHub-bubbles, position: fixed at the bottom of the page's start side,
//     56 px wide and 316 px high with six of them (Discuss itself is not touched).
//
// No class of Odoo's lifts either limit, and a form's arch takes no stylesheet of its own — except a
// <style> element in the arch itself: the form's compiler copies it into the page as it is, so it lives
// exactly as long as this form is on the screen. Every rule is under the form's own class
// (utak_day_form, which Odoo puts on .o_form_view), so no other form, not even the line's own dialog,
// is touched:
//   1. the whole width: no max-width on the renderer and on the sheet's background;
//   2. the table: the browser's own column widths (table-layout: auto), every cell and every heading
//      wraps, nothing is clipped and nothing ends in «…»;
//   3. «المقترح (وربحه)»: the column is as narrow as its longest word, so «(+2.43)» always sits on a
//      line of its own under the price, in the same cell (the cell's text is not changed: the worker
//      still writes «71.50 (+2.43)», and a card on a phone still reads it on one line);
//   4. room under the last line, on a wide screen, as high as the bubbles can stack.
// A phone keeps § 56's cards (Odoo shows the kanban of mode="list,kanban" there): nothing of the table
// applies to it.
//
// And «متوسط ربح الكرتون» says what it counts: «متوسط ربح الكرتون (المنشور)» — the items that go out alone.
import { BODY_MARK } from "./s56-ui.mjs";

export const FORM_CLASS = "utak_day_form";
export const AVG_LABEL_56 = "متوسط ربح الكرتون";
export const AVG_LABEL = "متوسط ربح الكرتون (المنشور)";
/** The two fields' own labels (ir.model.fields), wherever Odoo shows a field by its name. */
export const FIELD_LABELS = { x_avg_profit: `${AVG_LABEL} — رقم`, x_avg_profit_show: AVG_LABEL };
/** Seven bubbles and the «…» under them (52 px each) and the page's own margin: the highest the stack gets. */
export const BOTTOM_ROOM_PX = 440;
export const TWO_LINE_COLUMN = "x_suggested_profit_show";

const FORM = `.${FORM_CLASS}`;
const TABLE = `${FORM} .o_field_widget[name="x_line_ids"] .o_list_table`;
/** The form's own stylesheet. Plain selectors only (no «>» and no «&»: it is XML text), every rule under the form's class. */
export const DAY_STYLE = [
  `${FORM} .o_form_renderer, ${FORM} .o_form_sheet_bg { max-width: none !important; }`,
  `@media (min-width: 768px) { ${FORM} .o_form_sheet { padding-bottom: ${BOTTOM_ROOM_PX}px !important; } }`,
  `${TABLE} { table-layout: auto !important; width: 100% !important; }`,
  `${TABLE} th, ${TABLE} td.o_data_cell { width: auto !important; max-width: none !important; white-space: normal !important; overflow: visible !important; text-overflow: clip !important; vertical-align: top; }`,
  `${TABLE} th .text-truncate { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }`,
  `${TABLE} th[data-name="${TWO_LINE_COLUMN}"], ${TABLE} td[name="${TWO_LINE_COLUMN}"] { width: 1px !important; }`,
].join("\n      ");
export const STYLE_TAG = `<style>
      ${DAY_STYLE}
    </style>`;

const FORM_OPEN_56 = `<form string="📊 اليوم" create="0" delete="0">`;
export const FORM_OPEN = `<form string="📊 اليوم" create="0" delete="0" class="${FORM_CLASS}">`;
const SHEET_OPEN = "<sheet>";
const TILE_56 = `<div>${AVG_LABEL_56}</div>`;
export const TILE = `<div>${AVG_LABEL}</div>`;
const once = (arch, part) => arch.split(part).length === 2;

/** The tenant's arch with § 57's class, stylesheet and label (an arch that already carries them is left as it is; one that is not § 56's stops the script). */
export function dayArch57(arch) {
  if (arch.includes(FORM_OPEN)) return arch;
  if (!arch.includes(BODY_MARK)) throw new Error("📊 اليوم: the form does not carry § 56's body — stop (the view was changed by hand?)");
  const sheet = arch.indexOf(SHEET_OPEN);
  if (!once(arch, FORM_OPEN_56) || !arch.startsWith(FORM_OPEN_56) || !once(arch, TILE_56) || sheet < arch.indexOf("</header>") || arch.includes("<style") || /<chatter|oe_chatter|message_ids/.test(arch)) {
    throw new Error("📊 اليوم: the form's opening tag, its sheet or the average's tile is not § 56's — stop (the view was changed by hand?)");
  }
  const at = sheet + SHEET_OPEN.length;
  return `${FORM_OPEN}${arch.slice(FORM_OPEN_56.length, at)}\n    ${STYLE_TAG}${arch.slice(at)}`.replace(TILE_56, TILE);
}
