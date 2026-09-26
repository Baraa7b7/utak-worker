// § 37 — the Python that Odoo runs for «💵 دفع الموردين», shared by the setup
// script (scripts/s37-20260925-odoo.mjs writes it) and the tests
// (tests/supplier-pay.test.mts runs it in python3 against stub records).
// Changing a string here changes nothing in Odoo until the setup script is
// re-applied (its --verify compares the computes with what Odoo stores).

export const SEQ_CODE = "utak.supplier.payment";

/**
 * § 37 ج (2026-09-26) — a trial's record («محاكاة (تجربة)», default false) on
 * the list, the payment, the due and its line: counted nowhere (written by
 * scripts/s37-20260926-sim-cleanup.mts). Not x_is_simulation, which every row
 * the sim / pilot worker creates carries.
 */
export const SIM_FIELD = "x_utak_simulation";
/** The supplier's two tabs (x_sp_due_ids, x_sp_payment_ids) list no simulation row. */
export const SP_O2M_DOMAIN = `[('${SIM_FIELD}', '=', False)]`;

export const DUE_TOTAL_COMPUTE = `for record in self:
    record['x_sp_due_total'] = round(sum(record.x_sp_due_ids.filtered(lambda d: not d.${SIM_FIELD}).mapped('x_amount')), 2)`;
export const PAID_TOTAL_COMPUTE = `for record in self:
    record['x_sp_paid_total'] = round(sum(record.x_sp_payment_ids.filtered(lambda p: p.x_state == 'approved' and not p.${SIM_FIELD}).mapped('x_amount')), 2)`;
export const REMAINING_COMPUTE = `for record in self:
    due = sum(record.x_sp_due_ids.filtered(lambda d: not d.${SIM_FIELD}).mapped('x_amount'))
    paid = sum(record.x_sp_payment_ids.filtered(lambda p: p.x_state == 'approved' and not p.${SIM_FIELD}).mapped('x_amount'))
    record['x_sp_remaining'] = round(due - paid, 2)`;
export const DUE_TOTAL_DEPENDS = `x_sp_due_ids.x_amount,x_sp_due_ids.${SIM_FIELD}`;
export const PAID_TOTAL_DEPENDS = `x_sp_payment_ids.x_amount,x_sp_payment_ids.x_state,x_sp_payment_ids.${SIM_FIELD}`;
export const REMAINING_DEPENDS = `x_sp_due_ids.x_amount,x_sp_due_ids.${SIM_FIELD},x_sp_payment_ids.x_amount,x_sp_payment_ids.x_state,x_sp_payment_ids.${SIM_FIELD}`;

/** The payment fields the lock watches once it is approved or rejected (the worker's own fields stay writable). */
export const LOCK_WATCH = ["x_name", "x_supplier_id", "x_date", "x_amount", "x_method", "x_recorded_by", "x_channel", "x_state", "x_receipt_filename", "x_note", "x_reject_reason", "x_decided_by", "x_decided_at"];

export const CODE = {
  onCreate: `now = datetime.datetime.now()
today = (now + datetime.timedelta(hours=3)).date()
for rec in records:
    if (rec.x_amount or 0.0) <= 0:
        raise UserError('المبلغ يجب أن يكون أكبر من صفر.')
    vals = {'x_amount': round(rec.x_amount, 2)}
    if not rec.x_name or rec.x_name in ('/', 'New'):
        vals['x_name'] = env['ir.sequence'].sudo().next_by_code('${SEQ_CODE}') or '/'
    if not rec.x_date:
        vals['x_date'] = today
    if rec.x_channel == 'whatsapp':
        if not rec.x_state:
            vals['x_state'] = 'pending'
    else:
        vals.update({'x_channel': 'odoo', 'x_state': 'approved', 'x_decided_by': env.user.id, 'x_decided_at': now})
        if not rec.x_recorded_by:
            vals['x_recorded_by'] = env.user.partner_id.id
    rec.write(vals)`,
  approve: `now = datetime.datetime.now()
for rec in records:
    if rec.x_state != 'pending':
        raise UserError('لا تُعتمد إلا دفعة «بانتظار الاعتماد».')
    if (rec.x_amount or 0.0) <= 0:
        raise UserError('المبلغ يجب أن يكون أكبر من صفر.')
    rec.write({'x_state': 'approved', 'x_amount': round(rec.x_amount, 2), 'x_decided_by': env.user.id, 'x_decided_at': now})`,
  reject: `now = datetime.datetime.now()
for rec in records:
    if rec.x_state != 'pending':
        raise UserError('لا تُرفض إلا دفعة «بانتظار الاعتماد».')
    if not (rec.x_reject_reason or '').strip():
        raise UserError('اكتب «سبب الرفض» أولاً، ثم اضغط «رفض».')
    rec.write({'x_state': 'rejected', 'x_decided_by': env.user.id, 'x_decided_at': now})`,
  lock: `raise UserError('دفعة المورد معتمدة أو مرفوضة ومقفلة، فلا تُعدَّل: %s' % '، '.join(records.mapped('x_name')))`,
  noUnlink: `raise UserError('دفعة المورد المعتمدة أو المرفوضة لا تُحذف: %s' % '، '.join(records.mapped('x_name')))`,
};

