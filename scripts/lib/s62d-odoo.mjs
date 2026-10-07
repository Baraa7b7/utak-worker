// § 62 د (2026-10-07) — the quotation's tidy-up, as data: one source for scripts/s62d-20261007-odoo.mjs
// (which writes it to the tenant) and tests/s62d-*.test.mts (which read the pieces against what the worker
// reads and writes — src/special-quote.ts, src/special-quotation.ts, src/sale-order-quotation.ts,
// src/quote-preview.ts).
//
//   • «شكل العرض» on a special request: تلقائي (unit prices when every line's quantity is 1) / أسعار الوحدة / بالكميات.
//   • «المنشأ» and «المقاس» on a special request's line and on a sale order's line (two optional columns): printed
//     as a small line under the item's name, and carried from the request to the sale order when it is issued.
//   • «المقترح قبل الضريبة» on a special request's line: «المقترح» as it is rounded while «الأسعار في العرض» is
//     «قبل الضريبة» (up to the quarter riyal on the price before VAT).
//   • «👁️ معاينة PDF» on both screens: a code action that makes a ONE-USE ticket (a row of x_preview_ticket: a
//     random uuid, the record, the moment) and opens the worker's /preview/t/<ticket>. The worker reads the
//     ticket back from Odoo, burns it, and answers with its own signed, short-lived link to the draft PDF.
//     No fixed secret is in the button, the action or the address bar.
//
// Odoo holds the data and the screen; every number and every PDF is the worker's.

import * as S62 from "./s62-odoo.mjs";

export const QUOTE_MODEL = S62.QUOTE_MODEL;
export const LINE_MODEL = S62.LINE_MODEL;
export const SALE_MODEL = "sale.order";
export const SALE_LINE_MODEL = "sale.order.line";
export const TICKET_MODEL = "x_preview_ticket";
export const TICKET_MODEL_NAME = "UTAK — تذكرة معاينة PDF";
export const TICKET_ORDER = "id desc";
export const PROD_HOST = S62.PROD_HOST;
export const PREVIEW_PATH = "/preview/t/";

/** «شكل العرض»: how the quotation prints. Empty on a request = «تلقائي». */
export const LAYOUTS = [["auto", "تلقائي"], ["unit", "أسعار الوحدة"], ["qty", "بالكميات"]];
const sel = (pairs) => `[${pairs.map(([k, v]) => `('${k}', '${v}')`).join(", ")}]`;

export const QUOTE_FIELDS = [
  { name: "x_layout", ttype: "selection", selection: sel(LAYOUTS), field_description: "شكل العرض", help: "تلقائي (الافتراضي): حين كمية كل سطر 1 يطبع العرض أسعار الوحدة (قبل الضريبة، الضريبة، بعد الضريبة) بلا كمية ولا مجموع؛ وغير ذلك بالكميات والمجموع. «أسعار الوحدة» و«بالكميات» يفرضان الشكل." },
];
const ORIGIN = { name: "x_item_origin", ttype: "char", field_description: "المنشأ", help: "اختياري: يُطبع سطراً صغيراً تحت اسم الصنف في عرض السعر (مثل: جنوب أفريقيا)." };
const SIZE = { name: "x_item_size", ttype: "char", field_description: "المقاس", help: "اختياري: يُطبع بعد المنشأ تحت اسم الصنف في عرض السعر (مثل: 66)." };
export const LINE_FIELDS = [
  ORIGIN, SIZE,
  { name: "x_suggested_net", ttype: "float", field_description: "المقترح قبل الضريبة", help: "حين «الأسعار في العرض» = قبل الضريبة: المقترح مدوَّراً لأعلى لأقرب ربع ريال على السعر قبل الضريبة (و«المقترح» = هو × 1.15). يكتبه الوركر." },
];
export const SALE_LINE_FIELDS = [ORIGIN, SIZE];
export const TICKET_FIELDS = [
  { name: "x_model", ttype: "char", field_description: "النموذج" },
  { name: "x_res_id", ttype: "integer", field_description: "رقم السجل" },
  { name: "x_used", ttype: "boolean", field_description: "استُعملت", help: "التذكرة تُستعمل مرة واحدة: يعلّمها الوركر عند أول فتح." },
];

/**
 * «👁️ معاينة PDF»: a random ticket for THIS record (the database's own uuid), kept as a row the worker reads
 * back, then the worker's address with the ticket alone. Nothing of the record is written.
 */
export const previewCode = (model) => `env.cr.execute("SELECT gen_random_uuid()::text")
ticket = env.cr.fetchone()[0]
env['${TICKET_MODEL}'].create({'x_name': ticket, 'x_model': '${model}', 'x_res_id': record.id})
action = {
    'type': 'ir.actions.act_url',
    'url': 'https://${PROD_HOST}${PREVIEW_PATH}' + ticket,
    'target': 'new',
}`;
export const PREVIEW_ACTIONS = {
  quote: { name: "utak.special_quote.preview", model: QUOTE_MODEL, code: previewCode(QUOTE_MODEL) },
  sale: { name: "utak.sale_order.preview", model: SALE_MODEL, code: previewCode(SALE_MODEL) },
};
export const PREVIEW_BUTTON = "👁️ معاينة PDF";

// ---------------------------------------------------------------- the special request's screen
export const VIEW_FORM = S62.VIEW_FORM;
export const ACTION_NAME = S62.ACTION_NAME;
export const ACTION_CONTEXT = "{'default_x_state': 'draft', 'default_x_min_margin_pct': 10, 'default_x_price_mode': 'net', 'default_x_layout': 'auto'}";
/** The columns of a line after § 62 د (the optional ones that are shown included). */
export const LINE_COLUMNS = ["x_product_tmpl_id", "x_qty", "x_unit", "x_item_origin", "x_item_size", "x_purchase_price", "x_market_text", "x_no_loss_price", "x_suggested_price", "x_suggested_net", "x_final_price", "x_final_net", "x_profit"];

/** One exact replacement in § 62's arch: a piece that is not there once stops the script (the arch of § 62 changed). */
function swap(arch, find, put) {
  if (arch.split(find).length !== 2) throw new Error(`s62d: «${find.slice(0, 60)}» is not in the form of § 62 exactly once`);
  return arch.replace(find, put);
}
/**
 * The form of § 62 with § 62 د's four changes. `a` = § 62's seven action ids and `preview` (the code action above):
 * «⬇️ PDF لي فقط» (the webhook that ISSUED the quotation to Baraa alone) gives its place to «👁️ معاينة PDF».
 */
export function formArch(a) {
  let arch = S62.formArch(a);
  arch = swap(arch, `<button name="${a.pdf}" type="action" string="⬇️ PDF لي فقط" invisible="x_state == 'closed'"/>`, `<button name="${a.preview}" type="action" string="${PREVIEW_BUTTON}"/>`);
  arch = swap(arch, `<field name="x_price_mode" required="1"/>`, `<field name="x_price_mode" required="1"/>\n        <field name="x_layout" placeholder="تلقائي"/>`);
  arch = swap(arch, `<field name="x_unit" string="التعبئة"/>`, `<field name="x_unit" string="التعبئة"/>\n            <field name="x_item_origin" optional="show"/>\n            <field name="x_item_size" optional="show"/>`);
  arch = swap(arch, `<field name="x_suggested_price" readonly="1"/>`, `<field name="x_suggested_price" readonly="1"/>\n            <field name="x_suggested_net" readonly="1" optional="show"/>`);
  return arch;
}

// ---------------------------------------------------------------- the sale order's screen
export const SALE_FORM_PARENT = "sale.order.form";
export const VIEW_SALE_EXT = "utak.sale.order.form.preview_origin_size";
export const SALE_EXT_PRIORITY = 45; // after «العبوة» (utak.sale.order.form.packaging_col, 25) and the two UTAK buttons (16, 40)
export const saleExtArch = (previewId) => `<data>
  <xpath expr="//header" position="inside">
    <button name="${previewId}" string="${PREVIEW_BUTTON}" type="action" class="btn-secondary"/>
  </xpath>
  <xpath expr="//list[@name='sol_list']/field[@name='x_packaging_id']" position="after">
    <field name="x_item_origin" optional="show"/>
    <field name="x_item_size" optional="show"/>
  </xpath>
</data>`;
