// § 46 ب (2026-10-01) — the Python that Odoo runs when a product is created (and when its category
// is set later), shared by the setup script (scripts/s46-20261001-product-setup.mjs writes it) and
// the tests (tests/s46.test.mts runs it in python3 against stub records). Changing a string here
// changes nothing in Odoo until the setup script is re-applied (its --verify compares the stored
// code with this file).
//
// The rule, for every product.template that is not a service and not one of the accounting
// intermediaries (UTAK-SALE… / UTAK-PUR…):
//   • a reference when it has none, by its category (the category itself or a parent):
//     فواكه → UTAK-FRT-###, خضار → UTAK-VEG-###, ورقيات → UTAK-LEAF-###, continuing from the highest
//     number in use (archived products included). No such category → no reference. A reference
//     typed by hand is never changed;
//   • on creation only: the sale tax and the purchase tax, the type / storable / unit / purchase
//     method / invoice policy of the existing produce, «نشط للبيع» = false, the flag the worker
//     reads to alert Baraa once (x_utak_new), and a default packaging «كرتون» (8 kg, a temporary
//     weight; base.automation #8 names it «كرتون · 8 كيلو»).
// The supplier is never linked here.

/** The category names that give a reference, and the prefix of each. */
export const REF_PREFIX = { "فواكه": "UTAK-FRT-", "خضار": "UTAK-VEG-", "ورقيات": "UTAK-LEAF-" };
export const NEW_FLAG = "x_utak_new";
/** The temporary weight of the default carton (Baraa's alert lists it while it is still this). */
export const TEMP_CARTON_KG = 8;

const prefixDict = `{${Object.entries(REF_PREFIX).map(([k, v]) => `'${k}': '${v}'`).join(", ")}}`;

// The reference of `rec` by its category, into `ref` ('' = none). Indented by `pad`.
const refBlock = (pad) => `prefix = ''
c = rec.categ_id
while c and not prefix:
    prefix = PREFIXES.get((c.name or '').strip(), '')
    c = c.parent_id
ref = ''
if prefix:
    top = 0
    for other in Tmpl.search([('default_code', '=like', prefix + '%')]):
        tail = (other.default_code or '')[len(prefix):]
        if tail.isdigit() and int(tail) > top:
            top = int(tail)
    ref = prefix + str(top + 1).zfill(3)`.split("\n").map((l) => pad + l).join("\n");

/**
 * The on-create code. `d`: the tenant's values, read by the setup script —
 * { saleTax, purchaseTax, type, storable, uom, purchaseMethod, invoicePolicy }.
 */
export const onCreateCode = (d) => `PREFIXES = ${prefixDict}
Tmpl = env['product.template'].with_context(active_test=False)
Pack = env['x_product_packaging']
for rec in records:
    code = (rec.default_code or '').strip()
    if rec.type == 'service' or code.startswith('UTAK-SALE') or code.startswith('UTAK-PUR'):
        continue
    vals = {
        'x_is_active_for_sale': False,
        '${NEW_FLAG}': True,
        'taxes_id': [(6, 0, [${d.saleTax}])],
        'supplier_taxes_id': [(6, 0, [${d.purchaseTax}])],
        'type': '${d.type}',
        'is_storable': ${d.storable ? "True" : "False"},
        'uom_id': ${d.uom},
        'purchase_method': '${d.purchaseMethod}',
        'invoice_policy': '${d.invoicePolicy}',
    }
    if not code:
${refBlock("        ")}
        if ref:
            vals['default_code'] = ref
    rec.write(vals)
    if not Pack.search_count([('x_product_tmpl_id', '=', rec.id)]):
        Pack.create({'x_product_tmpl_id': rec.id, 'x_type': 'carton', 'x_approx_weight_kg': ${TEMP_CARTON_KG}, 'x_is_default': True, 'x_sequence': 10})`;

/** The on-write code (the category was set or changed): the reference only, and only when it is empty. */
export const ON_CATEGORY_CODE = `PREFIXES = ${prefixDict}
Tmpl = env['product.template'].with_context(active_test=False)
for rec in records:
    code = (rec.default_code or '').strip()
    if code or rec.type == 'service':
        continue
${refBlock("    ")}
    if ref:
        rec.write({'default_code': ref})`;

export const NAMES = {
  onCreateAction: "utak.product.setup_on_create",
  onCategoryAction: "utak.product.ref_on_category",
  onCreateAutomation: "utak.product.setup (on_create)",
  onCategoryAutomation: "utak.product.ref ← categ_id (on_write)",
};
