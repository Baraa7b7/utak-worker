// The five «مراجعة الأرقام» buttons (2026-09-25, STATUS § 30): the Python the
// Odoo server actions run on the selected rows (`records`). One source for
// scripts/rev-20260925-odoo-setup.mjs (creates the actions) and
// tests/review.test.mts (runs the same code on in-memory rows).
//   عميل   → class customer, customer_rank at least 1
//   مورد   → class supplier, supplier_rank at least 1
//   فريق   → class team only (Baraa adds the roles by hand)
//   شخصي   → class personal (no automated message at all, see src/screening.ts)
//   أرشفة  → active = False only, never a delete (back from the «المؤرشفون» filter)
// Every button clears «ينتظر المراجعة».

export const REVIEW_BUTTONS = [
  { key: "customer", label: "عميل", code: `for rec in records:
    vals = {'x_contact_class': 'customer', 'x_review_pending': False}
    if rec.customer_rank < 1:
        vals['customer_rank'] = 1
    rec.write(vals)
` },
  { key: "supplier", label: "مورد", code: `for rec in records:
    vals = {'x_contact_class': 'supplier', 'x_review_pending': False}
    if rec.supplier_rank < 1:
        vals['supplier_rank'] = 1
    rec.write(vals)
` },
  { key: "team", label: "فريق", code: `records.write({'x_contact_class': 'team', 'x_review_pending': False})
` },
  { key: "personal", label: "شخصي", code: `records.write({'x_contact_class': 'personal', 'x_review_pending': False})
` },
  { key: "archive", label: "أرشفة", code: `records.write({'x_review_pending': False, 'active': False})
` },
];
