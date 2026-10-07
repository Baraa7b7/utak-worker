// § 64 [3] (2026-10-07) — § 62 د's leftovers.
//
//   [أ] the old fixed-token download of a sale order's quotation is GONE: 410, no content, whatever is sent
//   [ب] a sale order's line prints its pack in this order: «التعبئة» as text (x_pack_text) ← «العبوة»
//       (x_packaging_id) ← the product's default packaging; «📄 أصدر عرض السعر» copies the request's «التعبئة»
//   [ج] a change of «الأسعار في العرض» never rewrites a final price Baraa typed; a new automation of its own
//       recalculates the request when the mode or «شكل العرض» changes
//   [د] a long document's second sheet starts under the same top padding as the first — and the first sheet's
//       budget is what it was
//   [هـ] a used ticket is archived; the six tickets § 62 د's checks left are
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s64-leftovers.test.mts

import { ctx, graph, odooLog, quiet, seed, table } from "./wa-harness.mts";
import { assert, done, rejected } from "./s46-kit.mts";
import { DAY, GARLIC, LETTUCE, MADARAT, ORANGE, lineOf, quote, request, saleLines, saleOrders, world } from "./s62-kit.mts";
import * as KIT from "./s62-kit.mts";

const SOQ = await import("../src/sale-order-quotation.ts");
const QT = await import("../src/special-quotation.ts");
const SQ = await import("../src/special-quote.ts");
const Q = await import("../src/quotation.ts");
const PDF = await import("../src/pdf-template.ts");
const INV = await import("../src/invoice.ts");
// @ts-ignore — plain .mjs data
const L = await import("../scripts/lib/s64-odoo.mjs");
// @ts-ignore — plain .mjs data
const L62 = await import("../scripts/lib/s62-odoo.mjs");
const worker = (await import("../src/index.ts")).default;

const count = (s: string, part: string) => s.split(part).length - 1;
const writesOf = () => odooLog.filter((l) => ["create", "write", "unlink"].includes(l.method));
const COMPANY: any = { nameAr: "شركة يوتاك", nameEn: "UTAK", legalNameAr: "شركة يوتاك ذات مسؤولية محدودة", address: "الرياض", email: "care@utakfresh.com", phone: "0580040467", cr: "7055194869", vat: "315022736600003" };

// ================================================================ [أ]
console.log("\n[أ] GET /internal/sale-quotation-pdf is gone");
{
  const env = world(); env.SALE_PDF_DOWNLOAD_TOKEN = "DL";
  seed("sale.order", { id: 700, name: "S00700", partner_id: [MADARAT, "شركة مدارات للاغذية"], order_line: [], state: "draft", date_order: "2026-10-07 09:00:00" });
  odooLog.length = 0; graph.length = 0;
  const before = KIT.gotenberg;
  const hit = (path: string, init?: RequestInit) => quiet(() => worker.fetch(new Request(`https://w.test${path}`, init), env, ctx));
  const good = await hit("/internal/sale-quotation-pdf?id=700&token=DL");
  assert("with the right token and a real order: 410, and NO content", good.status === 410 && (await good.text()) === "" && good.headers.get("Cache-Control") === "no-store" && !good.headers.get("Content-Type")?.includes("pdf"));
  assert("…Odoo is not read for it and no PDF is built", odooLog.length === 0 && KIT.gotenberg === before && graph.length === 0);
  assert("with a wrong token, with none, and by POST: the same 410 (the path tells nothing of the token)", (await hit("/internal/sale-quotation-pdf?id=700&token=x")).status === 410 && (await hit("/internal/sale-quotation-pdf")).status === 410 && (await hit("/internal/sale-quotation-pdf?id=700&token=DL", { method: "POST" })).status === 410);
  assert("the two downloads that still have their buttons answer as before (a wrong token: 404, not 410)", (await hit("/internal/invoice-pdf?id=1&token=x")).status === 404 && (await hit("/internal/purchase-order-pdf?id=1&token=x")).status === 404);
  assert("in Odoo the button's view is switched off, by its id and its name (never deleted)", L.OLD_PDF_VIEW_ID === 2789 && L.OLD_PDF_VIEW_NAME === "sale.order.form.utak_pdf_button");
}

// ================================================================ [ب]
console.log("\n[ب] the pack of a sale order's line: «التعبئة» ← «العبوة» ← the product's default");
{
  const env = world();
  seed("x_product_packaging", { id: 531, x_name: "كيس · 1 كيلو", x_product_tmpl_id: GARLIC, x_is_default: false, x_sequence: 20 });
  const P = (tmpl: number, name: string): [number, string] => [tmpl + 1000, name];
  // a variant's template as Odoo answers it: [id, name]
  for (const [tmpl, name] of [[ORANGE, "برتقال"], [GARLIC, "ثوم"], [LETTUCE, "خس أمريكي"]] as Array<[number, string]>) table("product.product").get(tmpl + 1000)!.product_tmpl_id = [tmpl, name];
  let lid = 9500;
  const line = (more: Record<string, unknown>) => seed("sale.order.line", { id: ++lid, order_id: 710, display_type: false, name: false, product_uom_qty: 1, price_unit: 115, price_subtotal: 100, price_tax: 15, price_total: 115, discount: 0, product_uom_id: [1, "Units"], x_price_unit_manual: 0, x_packaging_id: false, x_pack_text: false, x_item_origin: false, x_item_size: false, ...more });
  const ids = [
    line({ product_id: P(ORANGE, "برتقال"), x_pack_text: "18 كيلو" }),                                              // the text alone
    line({ product_id: P(GARLIC, "ثوم"), x_packaging_id: [531, "كيس · 1 كيلو"] }),                                   // «العبوة» alone
    line({ product_id: P(LETTUCE, "خس أمريكي") }),                                                                   // neither: the product's default
    line({ product_id: P(GARLIC, "ثوم"), x_packaging_id: [531, "كيس · 1 كيلو"], x_pack_text: "  14 كيلو -مخمر  " }), // both: the text
    line({ product_id: P(GARLIC, "ثوم"), x_packaging_id: [531, "كيس · 1 كيلو"], x_pack_text: "   " }),               // a text of spaces is none
    line({ product_id: P(ORANGE, "برتقال"), product_uom_qty: 0, price_unit: 99, x_pack_text: "صندوق 5 كيلو" }),      // an alternative
  ];
  seed("sale.order", { id: 710, name: "S00710", partner_id: [MADARAT, "شركة مدارات للاغذية"], order_line: ids, state: "draft", date_order: "2026-10-07 09:00:00", amount_untaxed: 500, amount_tax: 75, amount_total: 575 });
  odooLog.length = 0;
  const data = (await quiet(() => SOQ.buildQuotationPDFDataFromSaleOrder(env, 710)))!;
  const packs = data.items.map((i: any) => i.pack);
  assert("«التعبئة» as text is printed as written", packs[0] === "18 كيلو");
  assert("no text: «العبوة» chosen on the line", packs[1] === "كيس · 1 كيلو");
  assert("neither: the product's default packaging", packs[2] === "كرتون · 8 كيلو", JSON.stringify(packs));
  assert("both: the text stands before «العبوة», trimmed", packs[3] === "14 كيلو -مخمر");
  assert("a text of spaces alone is no text: «العبوة»", packs[4] === "كيس · 1 كيلو");
  assert("an alternative carries its text too", String(data.belowTable?.text).includes("برتقال · صندوق 5 كيلو — 99 ريال"));
  assert("the line's read asks for the field, and nothing is written", odooLog.some((l) => l.model === "sale.order.line" && (l.body.fields ?? []).includes("x_pack_text")) && writesOf().length === 0 && rejected.length === 0, rejected.join(" | "));
  const html = Q.renderQuotationHTML(data, COMPANY);
  assert("the page prints them (the issued quotation and its preview are this same page)", html.includes(">18 كيلو<") && html.includes("14 كيلو -مخمر") && html.includes("كيس · 1 كيلو"));
  assert("packTextOf: a string, trimmed; anything else none", SOQ.packTextOf({ x_pack_text: " كيلو " }) === "كيلو" && SOQ.packTextOf({ x_pack_text: false }) === "" && SOQ.packTextOf({}) === "");

  // «📄 أصدر عرض السعر» copies the request's «التعبئة» to the sale order's line
  for (const tmpl of [ORANGE, GARLIC, LETTUCE]) table("product.product").get(tmpl + 1000)!.product_tmpl_id = tmpl; // as the kit keeps them (its search matches the id)
  const id = request([[ORANGE, 1, { x_purchase_price: 100, x_final_price: 139.49, x_unit: "18 كيلو" }], [GARLIC, 1, { x_purchase_price: 10, x_final_price: 73.26, x_unit: "14 كيلو -مخمر" }], [LETTUCE, 1, { x_purchase_price: 5, x_final_price: 8, x_unit: false }]]);
  await quiet(() => SQ.recalcQuote(env, id));
  const q = (await quiet(() => SQ.readQuote(env, id)))!;
  const so = await quiet(() => QT.recordSaleQuotation(env, q));
  const texts = saleLines(so.id).sort((a, b) => a.sequence - b.sequence).map((l) => l.x_pack_text);
  assert("a new quotation's lines carry the request's «التعبئة» word for word (a line with none: the request's «كيلو»)", JSON.stringify(texts) === JSON.stringify(["18 كيلو", "14 كيلو -مخمر", "كيلو"]), JSON.stringify(texts));
  const fromOrder = (await quiet(() => SOQ.buildQuotationPDFDataFromSaleOrder(env, so.id)))!;
  const fromRequest = QT.specialQuotationData(q, so.number, { name: "x", address: "الرياض", phone: "" }, Date.now());
  assert("the sale order prints the SAME packs the special request's quotation prints", JSON.stringify(fromOrder.items.map((i: any) => i.pack)) === JSON.stringify(fromRequest.items.map((i: any) => i.pack)) && fromOrder.items[0].pack === "18 كيلو");
  // issued again after the request's «التعبئة» changed: the same order, its lines brought up to date
  lineOf(id, ORANGE).x_unit = "10 كيلو"; quote(id).x_sale_order_id = so.id;
  const again = await quiet(async () => QT.recordSaleQuotation(env, (await SQ.readQuote(env, id))!));
  assert("issued again: the same order, its line's «التعبئة» brought up to date", again.id === so.id && again.created === false && saleLines(so.id).find((l) => l.product_id === ORANGE + 1000)!.x_pack_text === "10 كيلو" && saleOrders().filter((o) => o.origin === SQ.quoteName(id)).length === 1);
  assert("in Odoo: the field «التعبئة» on a sale order's line, its column in the lines, and S00016's lines take SQ-0002's", L.SALE_LINE_FIELDS[0].name === "x_pack_text" && L.SALE_LINE_FIELDS[0].field_description === "التعبئة" && L.SALE_LINE_FIELDS[0].ttype === "char"
    && L.SALE_PACK_ARCH.includes(`<xpath expr="//list[@name='sol_list']/field[@name='x_packaging_id']" position="after">`) && L.SALE_PACK_ARCH.includes(`<field name="x_pack_text" optional="show"/>`) && L.PACK_FILL.sale === "S00016" && L.PACK_FILL.quote === 2);
}

// ================================================================ [ج]
console.log("\n[ج] a typed final price survives a change of «الأسعار في العرض»");
{
  const env = world();
  // 11.00 typed with VAT → 9.57 before it, and 9.57 × 1.15 = 11.0055 → 11.01: about one price in eight moves a halala
  // on the way back (139.49 ↔ 121.30 is one that does not)
  const id = request([[ORANGE, 1, { x_purchase_price: 100, x_final_price: 139.49 }], [GARLIC, 1, { x_purchase_price: 6, x_final_price: 11 }], [LETTUCE, 1, { x_purchase_price: 5 }]], { x_price_mode: "gross" });
  await quiet(() => SQ.recalcQuote(env, id));
  assert("«شاملة الضريبة»: the price before VAT follows the typed one", lineOf(id, ORANGE).x_final_price === 139.49 && lineOf(id, ORANGE).x_final_net === 121.3 && lineOf(id, GARLIC).x_final_net === 9.57);
  quote(id).x_price_mode = "net";
  odooLog.length = 0;
  const r = (await quiet(() => SQ.recalcQuote(env, id)))!;
  const written = JSON.stringify(writesOf().map((l) => l.body.vals));
  assert("→ «قبل الضريبة»: the typed 11.00 is NOT rewritten to 11.01 (and 139.49 stays)", lineOf(id, GARLIC).x_final_price === 11 && lineOf(id, GARLIC).x_final_net === 9.57 && lineOf(id, ORANGE).x_final_price === 139.49 && lineOf(id, ORANGE).x_final_net === 121.3 && !written.includes("x_final_price") && !written.includes("x_final_net"), written);
  assert("…the request is recalculated all the same: «المقترح قبل الضريبة» of the new mode is written", r.wrote === true && written.includes("x_suggested_net") && lineOf(id, ORANGE).x_suggested_net > 0);
  quote(id).x_price_mode = "gross";
  await quiet(() => SQ.recalcQuote(env, id));
  assert("→ back to «شاملة الضريبة»: still 11.00 / 9.57", lineOf(id, GARLIC).x_final_price === 11 && lineOf(id, GARLIC).x_final_net === 9.57 && lineOf(id, ORANGE).x_final_price === 139.49);
  // in «قبل الضريبة» a price Baraa types moves the other, as before
  quote(id).x_price_mode = "net"; lineOf(id, ORANGE).x_final_net = 122;
  await quiet(() => SQ.recalcQuote(env, id));
  assert("«قبل الضريبة»: a NEW price typed before VAT moves the one with it (122 → 140.30)", lineOf(id, ORANGE).x_final_net === 122 && lineOf(id, ORANGE).x_final_price === 140.3);
  lineOf(id, GARLIC).x_final_net = 0;
  await quiet(() => SQ.recalcQuote(env, id));
  assert("…and a price cleared there clears the other (the line has no final price again)", lineOf(id, GARLIC).x_final_net === 0 && lineOf(id, GARLIC).x_final_price === 0);
  assert("a line with no final price gets none from a change of mode («اعتمد المقترح» alone gives one)", !(lineOf(id, LETTUCE).x_final_price > 0) && !(lineOf(id, LETTUCE).x_final_net > 0));
  assert("finalsOf: the pair that agrees is kept; one that does not follows the mode's own price", JSON.stringify(SQ.finalsOf({ finalPrice: 11, finalNet: 9.57 }, "net")) === JSON.stringify({ finalPrice: 11, finalNet: 9.57 }) && JSON.stringify(SQ.finalsOf({ finalPrice: 11, finalNet: 10 }, "net")) === JSON.stringify({ finalPrice: 11.5, finalNet: 10 })
    && JSON.stringify(SQ.finalsOf({ finalPrice: 0, finalNet: 9.57 }, "net")) === JSON.stringify({ finalPrice: 11.01, finalNet: 9.57 }) && JSON.stringify(SQ.finalsOf({ finalPrice: 11, finalNet: 999 }, "gross")) === JSON.stringify({ finalPrice: 11, finalNet: 9.57 }));
  // a price typed before VAT survives the other way round (its pair always agrees)
  const id2 = request([[ORANGE, 1, { x_purchase_price: 100, x_final_net: 121.31 }]], { x_price_mode: "net" });
  await quiet(() => SQ.recalcQuote(env, id2));
  quote(id2).x_price_mode = "gross";
  await quiet(() => SQ.recalcQuote(env, id2));
  assert("a price typed before VAT (121.31 → 139.51) survives the change to «شاملة الضريبة»", lineOf(id2, ORANGE).x_final_net === 121.31 && lineOf(id2, ORANGE).x_final_price === 139.51);
  // a change of «شكل العرض» alone: the same recalc, nothing of the prices written
  quote(id).x_layout = "qty"; odooLog.length = 0;
  await quiet(() => SQ.recalcQuote(env, id));
  assert("a change of «شكل العرض»: the recalculation writes no final price", !JSON.stringify(writesOf().map((l) => l.body.vals)).includes("x_final"));
  // Odoo's side
  assert("a NEW automation of its own: on a write of «الأسعار في العرض» or «شكل العرض» alone (§ 62's save automation is not changed)", L.MODE_AUTOMATION.name !== L62.AUTOMATION_NAME && L.MODE_AUTOMATION.trigger === "on_write" && L.MODE_AUTOMATION.model === "x_special_quote" && JSON.stringify(L.MODE_AUTOMATION.fields) === JSON.stringify(["x_price_mode", "x_layout"])
    && !L62.AUTOMATION_FIELDS.includes("x_price_mode") && !L62.AUTOMATION_FIELDS.includes("x_layout"));
  assert("its action presses § 62's own recalc webhook for the request — «🔄 احسب»'s — and carries no address or token of its own", L.MODE_ACTION.code.includes(`('name', '=', '${L62.HOOKS.recalc.name}')`) && L.RECALC_HOOK_ACTION === L62.HOOKS.recalc.name && L.MODE_ACTION.code.includes("active_id=rec.id") && L.MODE_ACTION.code.includes(".run()") && !/https?:|token/.test(L.MODE_ACTION.code));
}

// ================================================================ [د]
console.log("\n[د] the second sheet starts under the same top padding; the first sheet's budget is what it was");
{
  const rule = `.utak-page { -webkit-box-decoration-break: clone; box-decoration-break: clone; padding-bottom: 0 !important; }`;
  assert("the page's padding is repeated at every sheet it breaks onto (clone), and its BOTTOM padding is taken off it", PDF.PAGE_FLOW_CSS.startsWith(rule));
  assert("…that room is the margin under the page's foot block instead: 20 mm, the page's own padding", PDF.PAGE_FLOW_CSS.includes(`.utak-page > [data-utak=page-foot] { margin-bottom: 20mm; }`) && PDF.BRAND_TYPE.pagePadding === "20mm" && PDF.PAGE_FOOT_SELECTOR === ".utak-page > [data-utak=page-foot]");
  const plain = INV.renderInvoiceHTML(INV.TEST_INVOICE_DATA, { nameAr: "UTAK — يو تاك", nameEn: "UTAK", address: "الرياض", email: "a@b.c", phone: "+966", cr: "1", vat: "3" } as any);
  const long = Q.renderQuotationHTML({ ...Q.TEST_QUOTATION_DATA, items: Array.from({ length: 27 }, (_, i) => ({ name: `صنف ${i + 1}`, pack: "كيلو", qty: 2, price: 5, total: 10 })) }, COMPANY);
  const short = Q.renderQuotationHTML({ ...Q.TEST_QUOTATION_DATA, items: Array.from({ length: 12 }, (_, i) => ({ name: `صنف ${i + 1}`, pack: "كيلو", qty: 2, price: 5, total: 10 })) }, COMPANY);
  for (const [name, html] of [["a plain page (an invoice)", plain], ["a long quotation (27 lines)", long], ["a quotation of one sheet (12 lines)", short]] as Array<[string, string]>) {
    assert(`${name}: the rule is in its style, once`, count(html, PDF.PAGE_FLOW_CSS) === 1 && html.indexOf(PDF.PAGE_FLOW_CSS) < html.indexOf("</style>"));
    assert(`${name}: the page's own padding is the 20 mm it was (the first sheet starts where it did)`, /class="utak-page[^"]*" style="[^"]*padding: 20mm;/.test(html));
    const foot = html.indexOf('<div class="utak-block" data-utak="page-foot">');
    assert(`${name}: the foot block is the page's last child — the margin under it ends the page, as the padding did`, foot > 0 && count(html, 'data-utak="page-foot"') === 1 && /<\/div>\s*<\/div>\s*<\/div>\s*<\/body>/.test(html.slice(foot)) && !html.slice(foot).includes("utak-block\"", 30));
  }
  assert("a table's head still repeats on every sheet, under the padding", long.includes("thead { display: table-header-group; }"));
  const fitted = PDF.fitPageToMargins(long, { marginBottom: "0.4" });
  const FOOT6 = ".utak-page > [data-utak=page-foot] { margin-bottom: 6mm !important; }";
  assert("with the page-number margin reserved the room under the foot is 6 mm — said AFTER the page's own rule, so it wins", fitted.includes(FOOT6) && fitted.indexOf(FOOT6) > fitted.indexOf(PDF.PAGE_FLOW_CSS) && PDF.PAGE_FOOT_PADDING === "6mm" && !fitted.includes("padding-bottom: 6mm"));
  assert("no margin reserved: the page is left as it is", PDF.fitPageToMargins(long, {}) === long);
  // the first sheet's budget: the same sheet, the same twelve lines
  assert("the sheet a quotation is held against is what it was: 297 mm less 20 mm above, 6 mm under the foot and the page-number margin", Q.FIT_SHEET_PX === Math.floor((297 - 26) * (96 / 25.4) - 0.4 * 96));
  assert("twelve lines are still one sheet (the page is told its height), thirteen still flow", Q.quotationPageMetrics({ rows: 12 }).fit === true && Q.quotationPageMetrics({ rows: 13 }).fit === false && short.includes('class="utak-page utak-fit"') && !long.includes('class="utak-page utak-fit"'));
}

// ================================================================ [هـ]
console.log("\n[هـ] a used ticket is archived");
{
  assert("the ticket's «نشط»: a field of its own, off on the six tickets § 62 د's checks left", L.TICKET_FIELDS[0].name === "x_active" && L.TICKET_FIELDS[0].ttype === "boolean" && JSON.stringify(L.TICKETS_TO_ARCHIVE) === "[1,2,3,4,5,6]" && L.TICKET_MODEL === "x_preview_ticket");
  assert("the worker reads a ticket archived or not, and archives it with the write that burns it", (await import("node:fs")).readFileSync(new URL("../src/quote-preview.ts", import.meta.url), "utf8").includes(`vals: { x_used: true, x_active: false }`));
}
void DAY;

done();
