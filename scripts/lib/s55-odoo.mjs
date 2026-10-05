// § 55 ب (2026-10-05) — what the delivery and collection form puts in Odoo, as data: one source for
// scripts/s55-20261005-odoo.mjs (which writes it to the tenant) and tests/s55-delivery.test.mts (which
// reads the pieces against what the worker writes, src/delivery-form.ts).
//
//   • x_daily_order_line: three fields the form's «إرسال» writes on a line that was NOT delivered in full —
//       x_ordered_qty     «الكمية المطلوبة»          what the customer ordered (x_quantity then holds the
//                                                     DELIVERED quantity, which the invoice bills)
//       x_return_qty      «المرتجع / غير المسلَّم»     ordered − delivered
//       x_return_reason   «سبب المرتجع»               damaged «تالف» / short «ناقص» / refused «رفضه العميل»
//     A line delivered in full keeps them empty. A line of which nothing was delivered is marked
//     «unavailable» (x_status, a value the line already has) with its quantity untouched.
//   • the order's form (x_daily_order.form — the view § 49 extended, scripts/lib/s49-ui.mjs): the three
//     fields as optional columns of the lines' list, right after «الكمية» — an extension view, as § 49's
//     own. The form's arch lives on the tenant, not in the repo: the script reads it and adds the columns
//     ONLY when the form lists its lines inline with an x_quantity column (linesListTag); otherwise the
//     views are left alone and the script says so.
// Nothing else: the note goes in x_daily_order.x_delivery_notes (a field the order already has), the
// invoice and the payment are the ones the worker already writes.

export const LINE_MODEL = "x_daily_order_line";
export const ORDER_MODEL = "x_daily_order";

/** [value, label] — the values are the ones src/delivery-form.ts writes (RETURN_REASONS). */
export const RETURN_REASON_OPTIONS = [["damaged", "تالف"], ["short", "ناقص"], ["refused", "رفضه العميل"]];
export const RETURN_REASON_SELECTION = `[${RETURN_REASON_OPTIONS.map(([v, l]) => `('${v}', '${l}')`).join(", ")}]`;
export const ORDERED_FIELD = "x_ordered_qty";
export const RETURN_QTY_FIELD = "x_return_qty";
export const RETURN_REASON_FIELD = "x_return_reason";
export const LINE_FIELDS = [
  { name: ORDERED_FIELD, ttype: "float", field_description: "الكمية المطلوبة",
    help: "ما طلبه العميل من الصنف حين سُلّم أقل منه (نموذج «📦 سلّم وحصّل»): «الكمية» عندها هي المسلَّمة فعلاً، وهي ما تُفوتَر. فارغ = سُلّم الصنف كاملاً." },
  { name: RETURN_QTY_FIELD, ttype: "float", field_description: "المرتجع / غير المسلَّم",
    help: "المطلوب ناقص المسلَّم، كما كتبه من سلّم الطلب في نموذج «📦 سلّم وحصّل». لا يدخل الفاتورة." },
  { name: RETURN_REASON_FIELD, ttype: "selection", selection: RETURN_REASON_SELECTION, field_description: "سبب المرتجع",
    help: "لماذا لم يُسلَّم ما في «المرتجع / غير المسلَّم»: تالف، أو ناقص، أو رفضه العميل." },
];

// ---------------------------------------------------------------- the order's form: the lines' columns
/** The order's form on the tenant (the parent of § 49's extension, scripts/lib/s49-ui.mjs PARENT_VIEW.orderForm). */
export const ORDER_FORM_VIEW = "x_daily_order.form";
export const ORDER_LINES_VIEW = "x_daily_order.form.utak_s55";
export const LINES_FIELD = "x_line_ids";
export const QTY_FIELD = "x_quantity";

/**
 * How the order's form lists its lines: "list" / "tree" when x_line_ids carries an inline list with an
 * x_quantity column (the columns can be added after it), else null — the lines are shown by another
 * view, and this script leaves the views alone.
 */
export function linesListTag(arch) {
  // x_line_ids' own body (the field is not self-closing), up to the end of its first inline list
  const body = new RegExp(`<field[^>]*\\bname="${LINES_FIELD}"[^>]*(?<!/)>\\s*<(list|tree)\\b[\\s\\S]*?</\\1>`).exec(String(arch ?? ""));
  if (!body) return null;
  return new RegExp(`<field[^>]*\\bname="${QTY_FIELD}"`).test(body[0]) ? body[1] : null;
}
/** The extension: the three fields as optional columns after «الكمية» (the quantities are the worker's; the reason may be corrected). */
export const orderLinesArch = (tag) => `<data>
  <xpath expr="//field[@name='${LINES_FIELD}']/${tag}/field[@name='${QTY_FIELD}']" position="after">
    <field name="${ORDERED_FIELD}" optional="show" readonly="1"/>
    <field name="${RETURN_QTY_FIELD}" optional="show" readonly="1"/>
    <field name="${RETURN_REASON_FIELD}" optional="show"/>
  </xpath>
</data>`;
/** The rendered form carries the three columns, in order, right after «الكمية». */
export function linesColumnsIn(arch) {
  return new RegExp(`name="${QTY_FIELD}"[^>]*/>\\s*<field[^>]*name="${ORDERED_FIELD}"[^>]*/>\\s*<field[^>]*name="${RETURN_QTY_FIELD}"[^>]*/>\\s*<field[^>]*name="${RETURN_REASON_FIELD}"`).test(String(arch ?? ""));
}
