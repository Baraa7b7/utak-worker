// § 62 د [ز] (2026-10-07) — the manual quotation of a sale order (src/sale-order-quotation.ts):
//
//   • the item's name is the first line of the line's description (trimmed, its «[ref]» dropped), else the
//     product's name; never «صنف»; a line with neither stops the quotation with its place
//   • the numbers are Odoo's (price_subtotal / price_tax / price_total, amount_*), with «شامل» or «قبل الضريبة»
//     by how the lines' taxes are set; no tax is created or changed (nothing is written at all)
//   • a note line is text under the table, a section line a group's title: neither is an item, neither blocks
//   • quantity 0 with a price is a «خيار بديل» outside the totals; quantity 0 with none is left out
//   • every quantity 1 → «عرض سعر الوحدة» from the line's own three numbers
//   • «المنشأ» / «المقاس» under the item's name
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62d-sale-order.test.mts

import { OWNER, ctx, odooLog, quiet, seed, sentTo, table } from "./wa-harness.mts";
import { assert, done, ownerTexts, rejected } from "./s46-kit.mts";
import { MADARAT, ORANGE, world } from "./s62-kit.mts";

const SOQ = await import("../src/sale-order-quotation.ts");
const Q = await import("../src/quotation.ts");
const { UI } = await import("../src/i18n.ts");
const worker = (await import("../src/index.ts")).default;

const COMPANY: any = { nameAr: "شركة يوتاك", nameEn: "UTAK", legalNameAr: "شركة يوتاك ذات مسؤولية محدودة", address: "الرياض", email: "care@utakfresh.com", phone: "0580040467", cr: "7055194869", vat: "315022736600003", stampImage: "data:image/png;base64,iVBORw0KGgo=", signatureImage: "data:image/png;base64,iVBORw0KGgo=" };
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const count = (s: string, part: string) => s.split(part).length - 1;
const heads = (html: string) => [...html.slice(html.indexOf("<thead>"), html.indexOf("</thead>")).matchAll(/<th [^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
const CARTON: [number, string] = [31, "كرتون"], UNITS: [number, string] = [1, "Units"];
let lineId = 9000;
/** A sale order as Odoo holds it: its lines with Odoo's own computed numbers, and its amounts (their sums). */
function saleOrder(id: number, name: string, lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): number {
  const ids = lines.map((l) => seed("sale.order.line", { id: ++lineId, order_id: id, display_type: false, product_id: false, name: false, product_uom_qty: 1, price_unit: 0, price_subtotal: 0, price_tax: 0, price_total: 0, discount: 0, product_uom_id: CARTON, x_price_unit_manual: 0, x_packaging_id: false, x_item_origin: false, x_item_size: false, ...l }));
  const sum = (f: string) => Math.round(lines.reduce((s, l) => s + (Number(l[f]) || 0), 0) * 100) / 100;
  seed("sale.order", { id, name, partner_id: [MADARAT, "شركة مدارات للاغذية"], date_order: "2026-10-07 09:00:00", create_date: "2026-10-07 09:00:00", order_line: ids, state: "draft", amount_untaxed: sum("price_subtotal"), amount_tax: sum("price_tax"), amount_total: sum("price_total"), ...extra });
  return id;
}
/** A line whose price holds its 15 % VAT (the company's tax #5): Odoo's split of it. */
const incl = (name: string | false, price: number, qty = 1, more: Record<string, unknown> = {}) => {
  const total = Math.round(price * qty * 100) / 100, sub = Math.round((total / 1.15) * 100) / 100;
  return { name, price_unit: price, product_uom_qty: qty, price_total: total, price_subtotal: sub, price_tax: total - sub, ...more };
};
/** A line whose 15 % VAT is added on top of its price. */
const excl = (name: string | false, price: number, qty = 1, more: Record<string, unknown> = {}) => {
  const sub = Math.round(price * qty * 100) / 100, tax = Math.round(sub * 15) / 100;
  return { name, price_unit: price, product_uom_qty: qty, price_subtotal: sub, price_tax: tax, price_total: Math.round((sub + tax) * 100) / 100, ...more };
};
const build = (env: any, id: number) => quiet(() => SOQ.buildQuotationPDFDataFromSaleOrder(env, id));
const writesOf = () => odooLog.filter((l) => ["create", "write", "unlink"].includes(l.method));
/** The files queued for a sale order's customer (x_wa_message rows of the order; every other send is recorded there too). */
const queued = () => [...table("x_wa_message").values()].filter((m: any) => m.x_res_model === "sale.order");

// ============================================================================
console.log("\n[ز1] the item's name, and S00015 as it stands: nine cartons with no product, a quantity of 1 each");
{
  const env = world();
  // S00015: what Baraa typed in each line's description, spaces and line breaks as he left them
  const S15: Array<[string, number]> = [["برتقال (افريقي) 18 كيلو", 115], ["موز امريكي (مخمر) 14 كيلو \n", 62.5], ["افوكادو 8 كيلو ", 41.5], ["رمان وسط 4 كيلو ", 20.5], ["تفاح سكري 18 كيلو ", 110], ["تفاح احمر ", 152], ["موز امريكي (بدون تخمير ) 14 كيلو ", 68], ["رمان صغير 2كيلو ", 16.5], ["رمان كبير ", 26]];
  saleOrder(15, "S00015", S15.map(([name, price]) => incl(name, price)));
  odooLog.length = 0;
  const data = (await build(env, 15))!;
  assert("each item is named by the first line of its description, trimmed", JSON.stringify(data.items.map((x) => x.name)) === JSON.stringify(S15.map(([n]) => n.trim())), JSON.stringify(data.items.map((x) => x.name)));
  assert("no line is named «صنف», and nothing stops the quotation", !data.items.some((x) => x.name === "صنف") && data.has_blocking_issue === false && (data.problems ?? []).length === 0);
  assert("every quantity is 1: «عرض سعر الوحدة» by itself", data.layout === "unit");
  assert("each line's three numbers are Odoo's own: price_subtotal, price_tax, price_total (115 = 100 + 15; 62.50 = 54.35 + 8.15)", data.items[0].net === 100 && data.items[0].vat === 15 && data.items[0].gross === 115 && data.items[1].net === 54.35 && data.items[1].vat === 8.15 && data.items[1].gross === 62.5);
  assert("before + VAT = with it to the halala on every line", data.items.every((x) => Math.round(((x.net ?? 0) + (x.vat ?? 0)) * 100) === Math.round((x.gross ?? 0) * 100)));
  assert("a line with no product has no packaging of its own: its unit of measure names it («كرتون»)", data.items.every((x) => x.pack === "كرتون"));
  assert("the order's amounts are Odoo's: 532.18 + 79.82 = 612", data.subtotal === 532.18 && data.vatAmount === 79.82 && data.grandTotal === 612, JSON.stringify([data.subtotal, data.vatAmount, data.grandTotal]));
  assert("nothing is written to Odoo: no tax is created or changed, no line is touched", writesOf().length === 0 && odooLog.every((l) => l.model !== "account.tax"), JSON.stringify(writesOf().map((l) => `${l.model}.${l.method}`)));
  const html = Q.renderQuotationHTML({ ...data, issued: true }, COMPANY), t = text(html);
  assert("its page: the five unit-price columns, nine lines, no «صنف», no total", JSON.stringify(heads(html)) === JSON.stringify(["الصنف", "العبوة", "السعر قبل الضريبة", "ضريبة 15%", "السعر بعد الضريبة"]) && !/>\s*صنف\s*</.test(html) && !t.includes(UI.grandTotal.ar) && t.includes("برتقال (افريقي) 18 كيلو كرتون 100.00 ريال 15.00 ريال 115.00 ريال"), t.slice(t.indexOf("برتقال"), t.indexOf("برتقال") + 90));
  assert("no VAT sentence on a page that prints both prices; the day's validity note stays", data.vatInclusive === undefined && data.footerNote === undefined && t.includes(Q.QUOTATION_FOOTER));

  // a product's line: Odoo's «[ref] name» and the sale description under it
  seed("product.product", { id: ORANGE + 1000, product_tmpl_id: [ORANGE, "برتقال"], display_name: "برتقال" });
  saleOrder(20, "S00020", [
    incl("[UTAK-FRT-003] برتقال\nوصف البيع الطويل للصنف", 139.49, 1, { product_id: [ORANGE + 1000, "[UTAK-FRT-003] برتقال"], product_uom_id: UNITS, x_packaging_id: [ORANGE * 10, "كرتون · 8 كيلو"] }),
    incl(false, 80, 1, { product_id: [ORANGE + 1000, "[UTAK-FRT-003] برتقال"], product_uom_id: UNITS }),
    incl("  \n  برتقال أبو سرة — درجة أولى  \nسطر ثانٍ", 90, 1, { product_id: [ORANGE + 1000, "[UTAK-FRT-003] برتقال"], product_uom_id: UNITS }),
  ]);
  const d20 = (await build(env, 20))!;
  assert("a product's line: the description's first line without «[ref]»; with no description, the product's name; a written one wins", JSON.stringify(d20.items.map((x) => x.name)) === JSON.stringify(["برتقال", "برتقال", "برتقال أبو سرة — درجة أولى"]), JSON.stringify(d20.items.map((x) => x.name)));
  assert("a product's line keeps its packaging (the line's, else the product's default), never the generic unit", d20.items.every((x) => x.pack === "كرتون · 8 كيلو"));
  assert("firstDescriptionLine: blank lines skipped, the reference dropped, nothing for nothing", SOQ.firstDescriptionLine("\n\n [A-1] خيار \nx") === "خيار" && SOQ.firstDescriptionLine(false) === "" && SOQ.firstDescriptionLine("   ") === "" && SOQ.firstDescriptionLine(undefined) === "");
}

// ============================================================================
console.log("\n[ز2] a line with no product and no description stops the quotation, with its place");
{
  const env = world();
  saleOrder(21, "S00021", [incl("خيار", 30, 2), incl("طماطم", 20, 3), incl("  \n ", 50, 1), incl("جزر", 0, 4)]);
  const data = (await build(env, 21))!;
  assert("blocked: «السطر 3 بلا منتج ولا وصف …», and it is not printed as «صنف»", data.has_blocking_issue === true && (data.problems ?? []).some((p) => p.startsWith("السطر 3 بلا منتج ولا وصف")) && data.items.length === 3 && !data.items.some((x) => x.name === "صنف" || !x.name), JSON.stringify(data.problems));
  assert("a named line with no price is named too: «صنف بلا سعر: جزر»", (data.problems ?? []).includes("صنف بلا سعر: جزر") && JSON.stringify(data.missing_products) === JSON.stringify(["جزر"]));
  // the «إرسال واتساب» route tells Baraa why, in those words, and sends nothing
  const waits: Promise<unknown>[] = [];
  const res = await quiet(() => worker.fetch(new Request("https://w.test/internal/sale-quotation-wa-send?token=HOOK", { method: "POST", body: JSON.stringify({ _model: "sale.order", _id: 21 }) }), env, { ...ctx, waitUntil: (p: Promise<unknown>) => { waits.push(p); } } as any));
  await quiet(() => Promise.all(waits));
  assert("«إرسال واتساب (UTAK)» on it: accepted, nothing queued, and Baraa reads both reasons", res.status === 202 && queued().length === 0 && ownerTexts().some((x) => x.includes("S00021") && x.includes("السطر 3 بلا منتج ولا وصف") && x.includes("صنف بلا سعر: جزر")), ownerTexts().join(" / "));
  saleOrder(22, "S00022", [{ display_type: "line_note", name: "ملاحظة فقط" }]);
  const empty = (await build(env, 22))!;
  assert("an order with nothing to quote (a note alone) is not a quotation", empty.has_blocking_issue === true && (empty.problems ?? [])[0]?.startsWith("لا أصناف في أمر البيع") && empty.items.length === 0);
  void OWNER; void sentTo;
}

// ============================================================================
console.log("\n[ز3] by quantities: Odoo's numbers, «شامل» or «قبل الضريبة» by the lines' taxes");
{
  const env = world();
  saleOrder(30, "S00030", [incl("خيار", 28, 8), incl("طماطم", 45, 5)]);
  const data = (await build(env, 30))!;
  // 224 → 194.78 + 29.22; 225 → 195.65 + 29.35
  assert("a price that holds its tax: the unit as typed, the line's total Odoo's price_total", data.layout === undefined && data.items[0].price === 28 && data.items[0].total === 224 && data.items[1].price === 45 && data.items[1].total === 225);
  assert("the totals are the order's amounts: «المجموع قبل الضريبة» 390.43, «ضريبة القيمة المضافة 15%» 58.57, «الإجمالي» 449", data.subtotal === 390.43 && data.vatAmount === 58.57 && data.grandTotal === 449 && data.totals?.subtotalLabel === "المجموع قبل الضريبة" && data.totals?.vatLabel === "ضريبة القيمة المضافة 15%" && data.totals?.hideDiscount === true, JSON.stringify([data.subtotal, data.vatAmount, data.grandTotal]));
  const html = Q.renderQuotationHTML(data, COMPANY), t = text(html);
  assert("the page says «الأسعار شاملة ضريبة القيمة المضافة», and prints the three totals without a «الخصم» row", data.vatInclusive === true && t.includes(UI.vatInclusiveNote.ar) && t.includes("المجموع قبل الضريبة 390.43 ريال") && t.includes("ضريبة القيمة المضافة 15% 58.57 ريال") && t.includes("449.00 ريال") && !t.includes(UI.discount.ar));
  assert("…it was «ضريبة 0.00» and the total = the subtotal before", data.vatAmount > 0 && data.grandTotal !== data.subtotal);

  saleOrder(31, "S00031", [excl("خيار", 100, 2), excl("طماطم", 50, 3)]);
  const ex = (await build(env, 31))!;
  assert("a tax added on top: the line's total is Odoo's price_subtotal, and the totals 350 + 52.50 = 402.50", ex.items[0].price === 100 && ex.items[0].total === 200 && ex.items[1].total === 150 && ex.subtotal === 350 && ex.vatAmount === 52.5 && ex.grandTotal === 402.5);
  assert("…and the page says «الأسعار قبل ضريبة القيمة المضافة», never «شاملة»", ex.vatInclusive === undefined && ex.footerNote === `${Q.QUOTATION_FOOTER}. ${UI.vatExclusiveNote.ar}` && text(Q.renderQuotationHTML(ex, COMPANY)).includes("الأسعار قبل ضريبة القيمة المضافة") && !text(Q.renderQuotationHTML(ex, COMPANY)).includes(UI.vatInclusiveNote.ar));
  saleOrder(32, "S00032", [{ name: "خيار", price_unit: 10, product_uom_qty: 3, price_subtotal: 30, price_tax: 0, price_total: 30 }, { name: "طماطم", price_unit: 5, product_uom_qty: 2, price_subtotal: 10, price_tax: 0, price_total: 10 }]);
  const none = (await build(env, 32))!;
  assert("lines with no tax: neither sentence, «ضريبة القيمة المضافة» 0.00, the total 40", none.vatInclusive === undefined && none.footerNote === undefined && none.totals?.vatLabel === "ضريبة القيمة المضافة" && none.vatAmount === 0 && none.grandTotal === 40);
  saleOrder(33, "S00033", [incl("خيار", 23, 2), excl("طماطم", 50, 3)]);
  assert("lines of both kinds: no sentence claims one for all", (await build(env, 33))!.vatInclusive === undefined && (await build(env, 33))!.footerNote === undefined);
  // a discount on the line: the unit that multiplies out to Odoo's total
  saleOrder(34, "S00034", [{ name: "خيار", price_unit: 100, discount: 10, product_uom_qty: 2, price_total: 180, price_subtotal: 156.52, price_tax: 23.48 }]);
  const disc = (await build(env, 34))!;
  assert("a discounted line: the total is Odoo's (180), the unit 90 — never 100 × 2 = 200", disc.items[0].total === 180 && disc.items[0].price === 90 && disc.grandTotal === 180 && disc.vatInclusive === true);
  // a price Odoo does not hold on the line: the older fallback, read as VAT-inclusive, the totals the lines' sums
  saleOrder(35, "S00035", [{ name: "خيار", price_unit: 0, x_price_unit_manual: 23, product_uom_qty: 2 }]);
  const man = (await build(env, 35))!;
  assert("a line priced by «سعر يدوي للوحدة» alone: 23 × 2 = 46 with VAT, 40 before it, 6 of VAT (the lines' sums)", man.has_blocking_issue === false && man.items[0].price === 23 && man.items[0].total === 46 && man.subtotal === 40 && man.vatAmount === 6 && man.grandTotal === 46 && man.vatInclusive === true);
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ============================================================================
console.log("\n[ز4] notes, sections and alternatives");
{
  const env = world();
  saleOrder(40, "S00040", [
    { display_type: "line_section", name: "فواكه" },
    incl("برتقال 18 كيلو", 115, 2),
    incl("تفاح احمر", 152, 1),
    { display_type: "line_note", name: "التوصيل خلال يومين من التأكيد.\nالأسعار لا تشمل التحميل." },
    { display_type: "line_subsection", name: "خضار " },
    incl("خيار", 30, 4),
    incl("موز غير مخمر 14 كيلو", 68, 0, { x_item_origin: "الإكوادور" }),
    incl("رمان كرتون 2 كجم", 16.5, 0),
    incl("سطر محذوف", 0, 0),
    { display_type: "line_note", name: "   " },
  ]);
  const data = (await build(env, 40))!;
  assert("three items: a note and a section are not items, and neither stops the quotation (they have no price)", data.items.length === 3 && data.has_blocking_issue === false && JSON.stringify(data.items.map((x) => x.name)) === JSON.stringify(["برتقال 18 كيلو", "تفاح احمر", "خيار"]) && (data.problems ?? []).length === 0, JSON.stringify(data.problems));
  assert("the note is text under the table, its lines kept; an empty note is nothing", JSON.stringify(data.belowBlocks) === JSON.stringify([{ label: "ملاحظات", text: "التوصيل خلال يومين من التأكيد.\nالأسعار لا تشمل التحميل." }]));
  assert("a section (and a subsection) is a group's title above the item that follows it", JSON.stringify(data.sections) === JSON.stringify([{ before: 0, title: "فواكه" }, { before: 2, title: "خضار" }]));
  assert("quantity 0 with a price: «خيارات بديلة», one a line with its price (and its origin)", data.belowTable?.label === "خيارات بديلة" && data.belowTable.text === "موز غير مخمر 14 كيلو · كرتون · الإكوادور — 68 ريال\nرمان كرتون 2 كجم · كرتون — 16.5 ريال", data.belowTable?.text);
  assert("quantity 0 with no price: left out everywhere", !JSON.stringify(data).includes("سطر محذوف"));
  // 230 + 152 + 120 = 502: the alternatives' 84.50 are outside it
  assert("the alternatives are outside the totals: 502 with VAT (Odoo's amount), not 586.50", data.grandTotal === 502 && data.subtotal === 436.52 && data.vatAmount === 65.48);
  assert("with a quantity of 2 on a line: by quantities", data.layout === undefined);
  const html = Q.renderQuotationHTML(data, COMPANY), t = text(html);
  assert("the page: two group titles as rows of their own, across the five columns", count(html, '<tr data-utak="section"><td colspan="5"') === 2 && html.indexOf(">فواكه</td>") < html.indexOf("برتقال 18 كيلو") && html.indexOf(">خضار</td>") > html.indexOf("تفاح احمر") && html.indexOf(">خضار</td>") < html.indexOf(">خيار<"));
  assert("…«خيارات بديلة» then «ملاحظات» under the table, as written (line breaks kept, no HTML read)", t.includes("خيارات بديلة موز غير مخمر 14 كيلو · كرتون · الإكوادور — 68 ريال") && html.indexOf("خيارات بديلة") > html.indexOf("</table>") && html.indexOf("ملاحظات") > html.indexOf("خيارات بديلة") && html.includes("white-space: pre-wrap;\">التوصيل خلال يومين من التأكيد.\nالأسعار لا تشمل التحميل."));
  assert("three item rows in the table (the titles are not counted)", count(html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>")), "<tr style=") === 3);
  // every counted quantity 1, with a note and an alternative: unit prices, and the alternative still listed
  saleOrder(41, "S00041", [incl("برتقال", 115, 1, { x_item_origin: "جنوب أفريقيا", x_item_size: "66" }), incl("تفاح", 110, 1), incl("موز", 68, 0), { display_type: "line_note", name: "ملاحظة" }]);
  const unit = (await build(env, 41))!;
  const uh = Q.renderQuotationHTML(unit, COMPANY);
  assert("the counted lines alone decide the layout: two lines of 1 → unit prices, with the alternative and the note under them", unit.layout === "unit" && unit.items.length === 2 && unit.belowTable?.text === "موز · كرتون — 68 ريال" && unit.belowBlocks?.[0].text === "ملاحظة" && uh.includes('data-utak="unit-prices"'));
  assert("«المنشأ» and «المقاس» of a sale order's line print under its name: «جنوب أفريقيا · مقاس 66»", unit.items[0].detail === "جنوب أفريقيا · مقاس 66" && unit.items[1].detail === undefined && />برتقال<\/div><div data-utak="item-detail"[^>]*>جنوب أفريقيا · مقاس 66<\/div>/.test(uh) && count(uh, 'data-utak="item-detail"') === 1);
  assert("nothing was written to Odoo in the whole run of the builder", writesOf().filter((l) => l.model.startsWith("sale.") || l.model === "account.tax").length === 0);
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ============================================================================
console.log("\n[ز5] «إرسال واتساب (UTAK)» issues it as it did: numbered by the order, queued for the customer");
{
  const env = world();
  saleOrder(50, "S00050", [incl("برتقال", 115, 1), incl("تفاح", 110, 1)]);
  const pages: string[] = [];
  const kitFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.startsWith("https://gotenberg.test/")) for (const f of (init?.body as FormData).getAll("files") as File[]) if (f.name === "index.html") pages.push(await f.text());
    return kitFetch(input as any, init);
  }) as typeof fetch;
  const waits: Promise<unknown>[] = [];
  const res = await quiet(() => worker.fetch(new Request("https://w.test/internal/sale-quotation-wa-send?token=HOOK", { method: "POST", body: JSON.stringify({ _model: "sale.order", _id: 50 }) }), env, { ...ctx, waitUntil: (p: Promise<unknown>) => { waits.push(p); } } as any));
  await quiet(() => Promise.all(waits));
  globalThis.fetch = kitFetch;
  const msg = queued()[0] as any;
  assert("the file is queued for the customer under the order's own number — an issued page, never a draft (no «مسودة» on it)", res.status === 202 && pages.length === 1 && pages[0].includes("S00050") && !pages[0].includes("مسودة") && !pages[0].includes('data-utak="draft-mark"') && msg?.x_filename === "S00050.pdf" && msg.x_res_model === "sale.order" && msg.x_res_id === 50 && msg.x_status === "queued");
  assert("a unit-price quotation's message states no total: «أسعار الوحدة لـ 2 صنف»", msg.x_body === "عرض سعر S00050 — أسعار الوحدة لـ 2 صنف", msg?.x_body);
  assert("the order itself is not written by the send (its state, its lines, its taxes)", writesOf().filter((l) => l.model.startsWith("sale.") || l.model === "account.tax").length === 0);
}

done();
