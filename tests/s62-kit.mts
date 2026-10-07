// § 62 — the shared world of the tests of «طلب أسعار خاص» (tests/s62-*.test.mts).
//
// The tenant's shape: Ahmed (a supplier, «شراء»), Raed (an outside source, «سوق»), Omar (an employee,
// «تسويق» alone — no price source on his card), a customer with a request of six lines over three
// categories — two of them products that are NOT «نشط للبيع», created for the request.
//
// The fake Odoo keeps a one2many's rows in their own table: a write on the request with commands
// ([0, 0, vals] / [1, id, vals]) on x_line_ids / x_recipient_ids is applied to the rows' tables here,
// as Odoo applies it (the worker writes a request's lines and sources that way: one call).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.

import { computes, odooLog, seed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, DAY, DRIVER, DRIVER_PHONE, cost, fresh } from "./s46-kit.mts";

export { AHMED, AHMED_PHONE, DAY };
export const OMAR = DRIVER, OMAR_PHONE = DRIVER_PHONE;
export const RAED = 880, RAED_PHONE = "966550689078";
export const MADARAT = 890, MADARAT_PHONE = "966530032939";
export const MARKETING_ROLE = 74;
export const QUOTE = "x_special_quote", LINE = "x_special_quote_line", RECIPIENT = "x_special_quote_recipient";
/** The products of the request: [id, name, category id, reference, active for sale]. 1 and 2 are the kit's (active). */
export const ORANGE = 51, LETTUCE = 52, GARLIC = 53, MUSHROOM = 54;

const O2M: Record<string, string> = { x_line_ids: LINE, x_recipient_ids: RECIPIENT };
/** Odoo's one2many commands on a request, applied to the rows' own tables. */
computes[QUOTE] = (r) => {
  for (const [field, model] of Object.entries(O2M)) {
    const cmds = r[field];
    if (!Array.isArray(cmds)) continue;
    for (const c of cmds as unknown[][]) {
      if (c[0] === 0) seed(model, { x_quote_id: r.id, ...(c[2] as Record<string, unknown>) });
      else if (c[0] === 1) {
        // a row that is not there: Odoo raises (MissingError), and so does this
        const row = table(model).get(c[1] as number);
        if (!row) throw new Error(`MissingError: ${model}(${c[1]})`);
        Object.assign(row, c[2] as Record<string, unknown>);
      }
    }
    delete r[field];
  }
};

export const r2: string[] = [];
export let gotenberg = 0;
/** The PDF service answers 500 while this is set (a quotation's PDF that cannot be built). */
export const pdfDown = { on: false };
export const SALE_TAX = 77;
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.startsWith("https://gotenberg.test/")) {
    gotenberg++;
    return pdfDown.on ? new Response("down", { status: 500 }) : new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
  }
  return kitFetch(input as any, init);
}) as typeof fetch;

/** The tenant: the three sources, the customer, the products and their categories; the day's cost 600; the waste 5 %. */
export function world(riyadh = `${DAY} 14:00`): any {
  const env = fresh(riyadh); cost(600);
  Object.assign(env, { UTAK_WA_NUMBER: "+966580000467", GOTENBERG_URL: "https://gotenberg.test", GOTENBERG_USER: "u", GOTENBERG_PASSWORD: "p", ADMIN_TOKEN: "ADM", ODOO_HOOK_TOKEN: "HOOK",
    INVOICES_BUCKET: { put: async (k: string) => { r2.push(k); return {}; }, head: async () => null, get: async () => null } });
  seed("res.company", { id: 1, name: "شركة يوتاك", vat: "315022736600003", account_sale_tax_id: [SALE_TAX, "15%"] });
  seed("account.tax", { id: SALE_TAX, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  // Ahmed «شراء» (a supplier), Raed «سوق» (neither a supplier nor an employee), Omar «تسويق» alone
  Object.assign(table("res.partner").get(AHMED)!, { x_price_role: "purchase", customer_rank: 0, phone: "+" + AHMED_PHONE });
  seed("res.partner", { id: RAED, name: "رائد", phone: "+" + RAED_PHONE, x_whatsapp_number: "+" + RAED_PHONE, x_price_source: true, x_price_role: "market", customer_rank: 0, supplier_rank: 0 });
  seed("x_employee_role", { id: MARKETING_ROLE, x_code: "marketing", x_name: "تسويق", x_active: true });
  Object.assign(table("hr.employee").get(7000 + OMAR)!, { x_utak_role_ids: [MARKETING_ROLE], x_price_source: false, x_price_role: false });
  seed("res.partner", { id: MADARAT, name: "شركة مدارات للاغذية", phone: "+" + MADARAT_PHONE, x_whatsapp_number: "+" + MADARAT_PHONE, customer_rank: 1, supplier_rank: 0 });
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  // the catalog's own two (active for sale, no category on the card: their reference names it), and four made for the request
  Object.assign(table("product.template").get(1)!, { categ_id: false, default_code: "UTAK-VEG-001" });
  Object.assign(table("product.template").get(2)!, { categ_id: false, default_code: "UTAK-VEG-002" });
  for (const [id, name, categ, ref] of [[ORANGE, "برتقال", 5, "UTAK-FRT-003"], [LETTUCE, "خس أمريكي", 7, "UTAK-LEAF-008"], [GARLIC, "ثوم", 6, "UTAK-VEG-010"], [MUSHROOM, "فطر أبيض", false, false]] as Array<[number, string, number | false, string | false]>) {
    seed("product.template", { id, name, categ_id: categ, default_code: ref, sale_ok: true, x_is_active_for_sale: false, active: true });
    seed("x_product_packaging", { id: id * 10, x_name: "كرتون · 8 كيلو", x_product_tmpl_id: id, x_is_default: true, x_sequence: 10 });
    seed("product.product", { id: id + 1000, product_tmpl_id: id });
  }
  for (const id of [1, 2]) seed("product.product", { id: id + 1000, product_tmpl_id: id });
  seed("x_whatsapp_template", { x_purpose: "price_ask_flow", x_meta_template_id: "utak_price_ask_flow_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  seed("x_whatsapp_template", { x_purpose: "customer_quotation_pdf_v2", x_meta_template_id: "utak_quotation_pdf_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 4, x_category: "UTILITY" });
  gotenberg = 0; r2.length = 0; odooLog.length = 0; pdfDown.on = false;
  return env;
}

/**
 * A request as Baraa saves it from Odoo: the customer and its lines, nothing prepared. Returns its id.
 * «الأسعار في العرض» is «شاملة الضريبة» here unless `extra` says otherwise (the final price typed is the
 * VAT-inclusive one, as § 62 أ's formulas read it); the tenant's own default, «قبل الضريبة», is what a
 * request with NO mode gets when the worker prepares it (`x_price_mode: false`).
 */
export function request(lines: Array<[number, number, Record<string, unknown>?]> = [[ORANGE, 1464], [LETTUCE, 494], [GARLIC, 194], [1, 33], [MUSHROOM, 12], [2, 9]], extra: Record<string, unknown> = {}): number {
  const id = seed(QUOTE, { x_name: false, x_partner_id: MADARAT, x_state: "draft", x_utak_simulation: false, x_price_mode: "gross", ...extra });
  lines.forEach(([product, qty, more], i) => seed(LINE, { x_quote_id: id, x_sequence: (i + 1) * 10, x_product_tmpl_id: product, x_qty: qty, x_unit: "كيلو", ...(more ?? {}) }));
  return id;
}
export const quote = (id: number) => table(QUOTE).get(id) as Record<string, any>;
export const linesOf = (id: number) => [...table(LINE).values()].filter((l) => l.x_quote_id === id) as Array<Record<string, any>>;
export const lineOf = (id: number, product: number) => linesOf(id).find((l) => l.x_product_tmpl_id === product) as Record<string, any>;
export const recipientsOf = (id: number) => [...table(RECIPIENT).values()].filter((r) => r.x_quote_id === id) as Array<Record<string, any>>;
export const recipientOf = (id: number, partner: number) => recipientsOf(id).find((r) => r.x_partner_id === partner) as Record<string, any>;
/** Every write the worker made (the message log and the inbox aside). */
export const writes = () => odooLog.filter((l) => ["create", "write", "unlink"].includes(l.method) && l.model !== "x_wa_message" && !l.model.startsWith("discuss.") && l.model !== "mail.message");
export const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);

/** Odoo's sale.order as the worker meets it: a number on creation, and its lines as rows of their own (commands applied). */
let soSeq = 40;
computes["sale.order"] = (r) => {
  if (!r.name) { r.name = `S${String(++soSeq).padStart(5, "0")}`; r.state = r.state ?? "draft"; }
  const cmds = r.order_line;
  if (!Array.isArray(cmds) || !cmds.some((c) => Array.isArray(c))) return;
  const keep: number[] = (r._lines as number[]) ?? [];
  for (const c of cmds as unknown[][]) {
    if (c[0] === 0) keep.push(seed("sale.order.line", { order_id: r.id, ...(c[2] as Record<string, unknown>) }));
    else if (c[0] === 1) Object.assign(table("sale.order.line").get(c[1] as number) ?? {}, c[2] as Record<string, unknown>);
  }
  r._lines = keep; r.order_line = [...keep];
};
export const saleOrders = () => [...table("sale.order").values()] as Array<Record<string, any>>;
export const saleLines = (orderId: number) => [...table("sale.order.line").values()].filter((l) => l.order_id === orderId) as Array<Record<string, any>>;
