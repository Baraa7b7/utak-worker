// § 62 د (2026-10-07) — the quotation's page: «عرض سعر الوحدة», the rounding of «المقترح» before VAT, one sheet up
// to twelve lines, the foot of the page, and «المنشأ» / «المقاس».
//
//   أ  unit prices: on by itself for a special request whose every quantity is 1; «شكل العرض» overrides it; the
//      day's customer quotation never takes it. الصنف | العبوة | السعر قبل الضريبة | ضريبة 15% | السعر بعد الضريبة —
//      no quantity, no line total, no totals — and each line adds up to the halala
//   ب  by quantities: the page as it was
//   ج  «المقترح» in «قبل الضريبة»: up to the quarter on the price before VAT; «شاملة» as it was; a typed final
//      price is never changed
//   هـ one sheet up to twelve lines (issued and draft, unit and quantities); more flows on, numbered on each sheet
//   و  the foot: one unbreakable legal line, «الشروط والملاحظات», the transfer line under the legal name, one
//      alignment, an address that breaks after a comma; the other documents keep theirs, in one block
//   ح  «المنشأ» / «المقاس» under the item's name, and carried to the sale order when the quotation is issued
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62d-layout.test.mts

import { readFileSync } from "node:fs";
import { openWindow, quiet, sentTo } from "./wa-harness.mts";
import { assert, done, rejected } from "./s46-kit.mts";
import { GARLIC, LETTUCE, MADARAT_PHONE, MUSHROOM, ORANGE, lineOf, linesOf, quote, request, saleLines, saleOrders, world } from "./s62-kit.mts";

const QT = await import("../src/special-quotation.ts");
const SQ = await import("../src/special-quote.ts");
const MATH = await import("../src/special-quote-math.ts");
const Q = await import("../src/quotation.ts");
const PDF = await import("../src/pdf-template.ts");
const BANK = await import("../src/bank-line.ts");
const INV = await import("../src/invoice.ts");
const REC = await import("../src/receipt.ts");
const PO = await import("../src/purchase-order.ts");
const DN = await import("../src/delivery-note.ts");
const { UI } = await import("../src/i18n.ts");
const LIB = await import("../scripts/lib/s62d-odoo.mjs");
const LIB62 = await import("../scripts/lib/s62-odoo.mjs");
const { table } = await import("./wa-harness.mts");

const LEGAL = "شركة يوتاك ذات مسؤولية محدودة";
const ADDRESS = "8141 شارع الأمير محمد بن عبدالرحمن بن عبدالعزيز، حي السلي، الرياض 14273، الرقم الفرعي 4309";
const BANK_LINE = "للتحويل: شركة يوتاك — البنك السعودي الأول — IBAN SA59 4500 0000 1682 9572 3001";
const PX = "data:image/png;base64,iVBORw0KGgo=";
const COMPANY: any = {
  nameAr: "شركة يوتاك", nameEn: "UTAK", legalNameAr: LEGAL, legalNameEn: "UTAK Company", address: ADDRESS, addressAr: ADDRESS,
  email: "care@utakfresh.com", phone: "0580040467", cr: "7055194869", vat: "315022736600003", stampImage: PX, signatureImage: PX, bankLine: BANK_LINE,
};
const NOW = Date.parse("2026-10-07T17:00:00+03:00");
const CUSTOMER = { name: "شركة مدارات للاغذية", address: "الرياض", phone: "+966530032939" };
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const count = (s: string, part: string) => s.split(part).length - 1;
const heads = (html: string) => [...html.slice(html.indexOf("<thead>"), html.indexOf("</thead>")).matchAll(/<th [^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
const rowsOf = (html: string) => count(html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>")), "<tr style=");
const foot = (html: string) => html.slice(html.indexOf('data-utak="page-foot"'));
/** SQ-0002 as it stands: nine cartons, a quantity of 1 each, «شاملة الضريبة». [name, unit, final with VAT, final before it] */
const NINE: Array<[string, string, number, number]> = [["برتقال", "18 كيلو", 139.49, 121.3], ["موز أمريكي", "14 كيلو -مخمر", 73.26, 63.7], ["موز أمريكي", "14 كيلو -غير مخمر", 79.75, 69.35], ["افوكادو", "8 كيلو", 46.49, 40.43], ["تفاح أحمر", "18 كيلو", 186, 161.74], ["رمان صغير", "2 كيلو", 14.75, 12.83], ["رمان وسط", "4 كيلو", 20, 17.39], ["رمان كبير", "5 كيلو", 26.75, 23.26], ["تفاح", "18 كيلو-سكري", 133, 115.65]];
const quoteOf = (over: Record<string, unknown> = {}, lines = NINE, qty: (i: number) => number = () => 1): any => ({
  id: 2, partnerId: 111, partnerName: CUSTOMER.name, priceMode: "gross", layout: "auto", validUntil: "2026-10-08 20:59:59", alternatives: "",
  lines: lines.map(([productName, unit, finalPrice, finalNet], i) => ({ productName, unit, qty: qty(i), finalPrice, finalNet, origin: "", size: "" })), ...over,
});
const many = (n: number): typeof NINE => Array.from({ length: n }, (_, i) => NINE[i % NINE.length]);

// ============================================================================
console.log("\n[أ] «عرض سعر الوحدة»");
{
  const data = QT.specialQuotationData(quoteOf(), "S00016", CUSTOMER, NOW);
  assert("a special request whose every quantity is 1 prints unit prices by itself («تلقائي»)", data.layout === "unit" && QT.quotationLayout(quoteOf()) === "unit");
  assert("each line carries ONE unit's price before VAT, its VAT and the price with it — from «النهائي قبل الضريبة» and «النهائي (شامل)»",
    data.items.every((it, i) => it.net === NINE[i][3] && it.gross === NINE[i][2] && it.vat === Math.round((NINE[i][2] - NINE[i][3]) * 100) / 100));
  assert("…and before + VAT = with it, to the halala, on every line", data.items.every((it) => Math.round(((it.net ?? 0) + (it.vat ?? 0)) * 100) === Math.round((it.gross ?? 0) * 100)));
  // from their source, never recomputed: a line whose two prices are a halala apart from × 1.15 prints the two it holds
  const held = QT.specialQuotationData(quoteOf({}, [["برتقال", "18 كيلو", 100, 86.95]]), "S00016", CUSTOMER, NOW).items[0];
  assert("the page prints the two prices the request holds (86.95 and 100.00, VAT 13.05) — not 86.95 × 1.15 = 99.99, nor 100 ÷ 1.15 = 86.96", held.net === 86.95 && held.gross === 100 && held.vat === 13.05, JSON.stringify(held));
  const html = Q.renderQuotationHTML(data, COMPANY), t = text(html);
  assert("the columns: الصنف | العبوة | السعر قبل الضريبة | ضريبة 15% | السعر بعد الضريبة", JSON.stringify(heads(html)) === JSON.stringify(["الصنف", "العبوة", "السعر قبل الضريبة", "ضريبة 15%", "السعر بعد الضريبة"]), heads(html).join(" | "));
  assert("no quantity column and no line total", !t.includes(UI.colQty.ar) && !heads(html).includes(UI.colTotal.ar) && html.includes('data-utak="unit-prices"'));
  assert("no subtotal, no VAT row and no total under the table", !t.includes(UI.grandTotal.ar) && !t.includes(QT.NET_SUBTOTAL_LABEL) && !t.includes(UI.subtotal.ar) && !t.includes(QT.NET_VAT_LABEL) && !t.includes("719"));
  assert("the small line under the table: «الأسعار لكل وحدة كما في عمود العبوة»", count(html, 'data-utak="unit-note"') === 1 && t.includes("الأسعار لكل وحدة كما في عمود العبوة") && html.indexOf('data-utak="unit-note"') > html.indexOf("</table>"));
  assert("the first line as printed: 121.30 · 18.19 · 139.49", t.includes("برتقال 18 كيلو 121.30 ريال 18.19 ريال 139.49 ريال"), t.slice(t.indexOf("برتقال"), t.indexOf("برتقال") + 80));
  assert("nine lines, each once", rowsOf(html) === 9);
  assert("the seal, the signature, the closing line and the IBAN are as they were", html.includes('data-utak="stamp"') && html.includes('data-utak="signature"') && t.includes(QT.CLOSING_LINE) && t.includes("IBAN SA59 4500 0000 1682 9572 3001") && t.includes("العرض ساري حتى 8 أكتوبر 2026 الساعة 23:59"));
  assert("no «الأسعار شاملة ضريبة القيمة المضافة» on a page that prints both prices", !t.includes(QT.VAT_INCLUSIVE_NOTE) && QT.quotationNote("2026-10-08 20:59:59", "gross", "unit") === `العرض ساري حتى 8 أكتوبر 2026 الساعة 23:59. ${QT.CLOSING_LINE}`);

  // «تلقائي»: one line with another quantity is an order, not a price list
  const mixed = QT.specialQuotationData(quoteOf({}, NINE, (i) => (i === 4 ? 2 : 1)), "S00016", CUSTOMER, NOW);
  assert("«تلقائي» with one quantity that is not 1: by quantities, as before", mixed.layout === undefined && mixed.items.every((it) => it.net === undefined) && text(Q.renderQuotationHTML(mixed, COMPANY)).includes(UI.colQty.ar));
  assert("«تلقائي» with no line: by quantities (nothing to price)", QT.quotationLayout(quoteOf({ lines: [] })) === "qty");
  // «شكل العرض» overrides
  const forcedUnit = QT.specialQuotationData(quoteOf({ layout: "unit" }, NINE, () => 40), "S00016", CUSTOMER, NOW);
  assert("«أسعار الوحدة» with quantities of 40: unit prices all the same (the unit's two prices, not 40 ×)", forcedUnit.layout === "unit" && forcedUnit.items[0].net === 121.3 && forcedUnit.items[0].gross === 139.49 && !text(Q.renderQuotationHTML(forcedUnit, COMPANY)).includes(UI.colQty.ar));
  const forcedQty = QT.specialQuotationData(quoteOf({ layout: "qty" }), "S00016", CUSTOMER, NOW);
  assert("«بالكميات» with every quantity 1: quantities and totals", forcedQty.layout === undefined && text(Q.renderQuotationHTML(forcedQty, COMPANY)).includes(UI.colQty.ar) && text(Q.renderQuotationHTML(forcedQty, COMPANY)).includes(UI.grandTotal.ar));
  assert("an empty «شكل العرض» on a request is «تلقائي»; the three values are Odoo's", SQ.asLayout(false) === "auto" && SQ.asLayout(undefined) === "auto" && SQ.asLayout("unit") === "unit" && SQ.asLayout("qty") === "qty" && SQ.asLayout("x") === "auto"
    && JSON.stringify(LIB.LAYOUTS.map((x: string[]) => x[0])) === JSON.stringify(["auto", "unit", "qty"]) && LIB.QUOTE_FIELDS[0].name === "x_layout" && LIB.QUOTE_FIELDS[0].field_description === "شكل العرض");

  // the day's customer quotation never changes
  const ones = { ...Q.TEST_QUOTATION_DATA, items: Q.TEST_QUOTATION_DATA.items.map((it) => ({ ...it, qty: 1, total: it.price })) };
  const day = Q.renderQuotationHTML(ones, COMPANY);
  assert("the day's customer quotation with every quantity 1: quantities and totals still (the renderer never decides it)", JSON.stringify(heads(day)) === JSON.stringify(["الصنف", "العبوة", "الكمية", "السعر", "الإجمالي"]) && !day.includes('data-utak="unit-prices"') && text(day).includes(UI.grandTotal.ar));
  const src = readFileSync(new URL("../src/quotation.ts", import.meta.url), "utf8");
  const dayBuilder = src.slice(src.indexOf("export async function buildQuotationPDFDataFromOdoo("), src.indexOf("function round2("));
  assert("…and its builder (x_quotation) sets no layout at all", dayBuilder.length > 2000 && !dayBuilder.includes("layout"));
}

// ============================================================================
console.log("\n[ب] by quantities: the page as it was");
{
  const q = quoteOf({ priceMode: "net" }, NINE, (i) => 2 + i);
  const data = QT.specialQuotationData(q, "S00016", CUSTOMER, NOW);
  const html = Q.renderQuotationHTML(data, COMPANY), t = text(html);
  assert("الصنف | العبوة | الكمية | السعر | الإجمالي", JSON.stringify(heads(html)) === JSON.stringify(["الصنف", "العبوة", "الكمية", "السعر", "الإجمالي"]));
  const lines = Math.round(NINE.reduce((s, l, i) => s + Math.round((2 + i) * l[3] * 100) / 100, 0) * 100) / 100;
  assert("«قبل الضريبة»: the price before VAT, then «المجموع قبل الضريبة», «ضريبة القيمة المضافة 15%», «الإجمالي»", data.subtotal === lines && data.vatAmount === Math.round(lines * 15) / 100 && t.includes(QT.NET_SUBTOTAL_LABEL) && t.includes(QT.NET_VAT_LABEL) && t.includes(UI.grandTotal.ar) && !t.includes("الأسعار لكل وحدة"));
  assert("the seal beside the totals, and no unit note", html.includes('data-utak="seal-signature"') && !html.includes('data-utak="unit-note"'));
}

// ============================================================================
console.log("\n[ج] «المقترح» is rounded on the price the quotation prints");
{
  const net = MATH.suggestedFor(105, 0, 5, 10, "net"), gross = MATH.suggestedFor(105, 0, 5, 10, "gross");
  // 105 × 1.05 × 1.10 × 1.15 = 139.46625 with VAT, 121.275 before it
  assert("«قبل الضريبة»: 121.275 → up to the quarter before VAT = 121.50, and 139.73 with it (× 1.15 to the halala)", net.net === 121.5 && net.gross === MATH.grossOf(121.5) && net.gross === 139.73, JSON.stringify(net));
  assert("«شاملة الضريبة»: as it was — 139.50 with VAT (up to the quarter on it), 121.30 before", gross.gross === 139.5 && gross.net === 121.3 && gross.gross === MATH.suggestedPrice(105, 0, 5, 10), JSON.stringify(gross));
  assert("the price before VAT is a whole quarter in «قبل الضريبة» for every purchase price", [3, 10, 11, 15, 20, 35, 55, 60, 100, 140].every((buy) => Number.isInteger(MATH.suggestedFor(buy, 0, 5, 10, "net").net * 4)));
  assert("…never under «الأدنى المربح», and less than a quarter above it", [3, 10, 11, 15, 20, 35, 55, 60, 100, 140].every((buy) => { const floor = buy * 1.05 * 1.1, s = MATH.suggestedFor(buy, 0, 5, 10, "net").net; return s >= floor - 1e-9 && s - floor < 0.25; }));
  assert("the market above «الأدنى المربح» is what is rounded: 5.50 with VAT → 4.7826 → 5.00 before it, 5.75 with it", JSON.stringify(MATH.suggestedFor(3, 5.5, 5, 10, "net")) === JSON.stringify({ gross: 5.75, net: 5 }));
  assert("no purchase price: nothing is suggested in either mode", JSON.stringify(MATH.suggestedFor(0, 9, 5, 10, "net")) === '{"gross":0,"net":0}' && JSON.stringify(MATH.suggestedFor(0, 9, 5, 10, "gross")) === '{"gross":0,"net":0}');

  // on a request: the worker writes both numbers, and «اعتمد المقترح» takes the rounded one
  let env = world();
  let id = request([[ORANGE, 1, { x_purchase_price: 105, x_unit: "18 كيلو" }], [GARLIC, 1, { x_purchase_price: 10, x_final_net: 12.4 }]], { x_price_mode: "net" });
  await quiet(() => SQ.recalcQuote(env, id));
  assert("«قبل الضريبة»: «المقترح قبل الضريبة» 121.50 and «المقترح» 139.73 on the line", lineOf(id, ORANGE).x_suggested_net === 121.5 && lineOf(id, ORANGE).x_suggested_price === 139.73, JSON.stringify(lineOf(id, ORANGE)));
  assert("a final price that was typed is not touched: 12.40 before VAT stays (14.26 with it), though «المقترح» says 11.75", lineOf(id, GARLIC).x_final_net === 12.4 && lineOf(id, GARLIC).x_final_price === 14.26 && lineOf(id, GARLIC).x_suggested_net === 11.75);
  const r = await quiet(() => SQ.recalcQuote(env, id, { accept: true }));
  assert("«اعتمد المقترح للكل»: the line without a final price takes 121.50 before VAT and 139.73 with it; the typed one stays", r?.accepted === 1 && lineOf(id, ORANGE).x_final_net === 121.5 && lineOf(id, ORANGE).x_final_price === 139.73 && lineOf(id, GARLIC).x_final_net === 12.4);
  const again = await quiet(() => SQ.recalcQuote(env, id));
  assert("a second pass writes nothing (no loop with the save's automation)", again?.wrote === false);
  assert("the automation of the save does not watch a field the worker writes alone", !["x_suggested_net", "x_suggested_price", "x_final_net", "x_final_price"].some((f) => LIB62.AUTOMATION_FIELDS.includes(f)));

  env = world();
  id = request([[ORANGE, 1, { x_purchase_price: 105 }], [GARLIC, 1, { x_purchase_price: 10, x_final_price: 14 }]], { x_price_mode: "gross" });
  await quiet(() => SQ.recalcQuote(env, id, { accept: true }));
  assert("«شاملة الضريبة»: as it was — «المقترح» 139.50 (121.30 before VAT), accepted as 139.50; the typed 14.00 stays", lineOf(id, ORANGE).x_suggested_price === 139.5 && lineOf(id, ORANGE).x_suggested_net === 121.3 && lineOf(id, ORANGE).x_final_price === 139.5 && lineOf(id, ORANGE).x_final_net === 121.3 && lineOf(id, GARLIC).x_final_price === 14);
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ============================================================================
console.log("\n[هـ] one sheet up to twelve lines");
{
  const input = (rows: number, o: Record<string, unknown> = {}) => ({ rows, partyLines: 4, noteLines: 1, bankLine: true, ...o });
  const cases: Array<[string, Record<string, unknown>]> = [["unit, issued", { unit: true, sealed: true }], ["unit, draft", { unit: true }], ["quantities, issued", { sealed: true }], ["quantities, draft", {}]];
  for (const [name, o] of cases) {
    const bad: string[] = [];
    for (let rows = 1; rows <= Q.FIT_MAX_ROWS; rows++) {
      const m = Q.quotationPageMetrics(input(rows, o)), row = parseInt(m.rowHeight, 10);
      // the page at the row height it was given, its gaps closed, is inside the sheet
      if (!m.fit || row < 24 || row > 36 || Q.quotationPagePx(input(rows, o), row, 0) > Q.FIT_SHEET_PX) bad.push(`${rows}:${m.rowHeight}:${Q.quotationPagePx(input(rows, o), row, 0)}`);
    }
    assert(`${name}: 1 … 12 lines are budgeted inside the sheet (${Q.FIT_SHEET_PX} px), rows between 24 and 36 px`, bad.length === 0, bad.join(" "));
  }
  // the budget's numbers, as Chrome laid the blocks out (2026-10-07): header 121 + rule 1 + parties 111 + terms 101 + strip 22 = 356,
  // then the unit note 22, the seal's block 155 or the totals 118
  assert("what the page carries beside its table and its gaps: 533 (unit, issued), 378 (unit, draft), 511 (quantities, issued), 474 (quantities, draft)", Q.quotationFixedPx(input(9, { unit: true, sealed: true })) === 533 && Q.quotationFixedPx(input(9, { unit: true })) === 378 && Q.quotationFixedPx(input(9, { sealed: true })) === 511 && Q.quotationFixedPx(input(9)) === 474,
    [Q.quotationFixedPx(input(9, { unit: true, sealed: true })), Q.quotationFixedPx(input(9, { unit: true })), Q.quotationFixedPx(input(9, { sealed: true })), Q.quotationFixedPx(input(9))].join());
  assert("…and what more it may carry: a block under the table of two lines + 73, two group titles + 58, a second line of the note + 17, no transfer line − 22, a fifth party line + 24", Q.quotationFixedPx(input(9, { sealed: true, belowBlocks: 1, belowLines: 2 })) === 584 && Q.quotationFixedPx(input(9, { sealed: true, sectionRows: 2 })) === 569 && Q.quotationFixedPx(input(9, { sealed: true, noteLines: 2 })) === 528 && Q.quotationFixedPx(input(9, { sealed: true, bankLine: false })) === 489 && Q.quotationFixedPx(input(9, { sealed: true, partyLines: 5 })) === 535);
  const rowAt = (rows: number, o: Record<string, unknown>) => Q.quotationPageMetrics(input(rows, o)).rowHeight;
  assert("the row each page gets: issued unit prices 9 → 34 px, 12 → 25 px; issued quantities 10 → 33, 12 → 27; a draft's twelve 36 (unit) and 30 (quantities)", rowAt(9, { unit: true, sealed: true }) === "34px" && rowAt(12, { unit: true, sealed: true }) === "25px" && rowAt(10, { sealed: true }) === "33px" && rowAt(12, { sealed: true }) === "27px" && rowAt(12, { unit: true }) === "36px" && rowAt(12, {}) === "30px",
    [rowAt(9, { unit: true, sealed: true }), rowAt(12, { unit: true, sealed: true }), rowAt(10, { sealed: true }), rowAt(12, { sealed: true }), rowAt(12, { unit: true }), rowAt(12, {})].join());
  assert("the table's head keeps its padding with a roomy row and tightens under 30 px", Q.quotationPageMetrics(input(9, { unit: true, sealed: true })).thPad === "10px 0" && Q.quotationPageMetrics(input(12, { sealed: true })).thPad === "8px 0");
  assert("twelve issued unit-price lines at 25 px, gaps closed: 958 of the sheet's 985 px", Q.quotationPagePx(input(12, { unit: true, sealed: true }), 25, 0) === 958 && Q.FIT_SHEET_PX === 985 && Q.quotationPagePx(input(12, { unit: true, sealed: true }), 25, 1) === 958 + 2 * 12 + 26 + 28);
  assert("a row with a detail line is never under 25 px (its two lines), and takes the page's row when that is taller", Q.quotationPageMetrics(input(12, { unit: true, sealed: true, detailRows: 12 })).detailRowHeight === "25px" && Q.quotationPageMetrics(input(3, { sealed: true, detailRows: 1 })).detailRowHeight === "36px" && Q.quotationPageMetrics(input(13, { sealed: true })).detailRowHeight === "29px");
  assert("…its least holds when the page's rows are at theirs (24 px): 25 px; and on a dense page of twenty lines (19 px rows): 25 px", (() => {
    const tight = Q.quotationPageMetrics(input(12, { sealed: true, detailRows: 1, belowBlocks: 2, belowLines: 8 })), dense20 = Q.quotationPageMetrics(input(20, { sealed: true }));
    return tight.rowHeight === "24px" && tight.detailRowHeight === "25px" && dense20.fit === false && dense20.rowHeight === "19px" && dense20.detailRowHeight === "25px";
  })());
  assert("the budget is read from the page's own data: nine unit lines, issued, four party lines, a one-line note, the transfer line", JSON.stringify(Q.quotationFitInput(QT.specialQuotationData(quoteOf(), "S00016", CUSTOMER, NOW), COMPANY)) === JSON.stringify({ rows: 9, detailRows: 0, sectionRows: 0, unit: true, sealed: true, partyLines: 4, noteLines: 1, bankLine: true, belowBlocks: 0, belowLines: 0 }), JSON.stringify(Q.quotationFitInput(QT.specialQuotationData(quoteOf(), "S00016", CUSTOMER, NOW), COMPANY)));
  assert("…a draft is not sealed; details, alternatives and a company with no bank line are counted", (() => {
    const q = quoteOf({ alternatives: "أ\nب" }); q.lines[0].origin = "مصر"; q.lines[1].size = "5";
    const i = Q.quotationFitInput(QT.specialQuotationData(q, QT.DRAFT_NUMBER, CUSTOMER, NOW, { draft: true }), { ...COMPANY, bankLine: undefined });
    return i.sealed === false && i.detailRows === 2 && i.belowBlocks === 1 && i.belowLines === 2 && i.bankLine === false;
  })());
  assert("twelve lines each with a detail line under its name: inside the sheet too, issued", (() => { const i = input(12, { unit: true, sealed: true, detailRows: 12 }); const m = Q.quotationPageMetrics(i); return m.fit && Q.quotationPagePx(i, parseInt(m.rowHeight, 10), 0) <= Q.FIT_SHEET_PX; })());
  assert("few lines keep the roomy row (36 px); twelve take what the sheet leaves them", Q.quotationPageMetrics(input(3, { sealed: true })).rowHeight === "36px" && parseInt(Q.quotationPageMetrics(input(12, { sealed: true })).rowHeight, 10) < 36);
  assert("the sheet: 297 mm less the page's top (20 mm) and foot (6 mm) paddings and the page-number margin (0.4 in)", Q.FIT_SHEET_PX === Math.floor((297 - 26) * (96 / 25.4) - 0.4 * 96) && PDF.PAGE_FOOT_PADDING === "6mm" && PDF.GOTENBERG_FOOTER_MARGIN === "0.4");
  const m13 = Q.quotationPageMetrics(input(13, { sealed: true })), dense = PDF.computePageMetrics(13);
  assert("thirteen lines: the dense page as before — it flows over the sheets it needs", m13.fit === false && m13.rowHeight === dense.rowHeight && m13.gap === dense.gap && m13.preTable === dense.preTable && m13.gapMin === undefined);

  for (const [name, q, issued] of [["unit, issued", quoteOf({}, many(12)), true], ["unit, draft", quoteOf({}, many(12)), false], ["quantities, issued", quoteOf({ priceMode: "net" }, many(12), (i) => 2 + i), true], ["quantities, draft", quoteOf({ priceMode: "net" }, many(12), (i) => 2 + i), false]] as Array<[string, any, boolean]>) {
    const html = Q.renderQuotationHTML(QT.specialQuotationData(q, issued ? "S00016" : QT.DRAFT_NUMBER, CUSTOMER, NOW, issued ? {} : { draft: true }), COMPANY);
    assert(`twelve lines, ${name}: the page is told its sheet — its height is the sheet's, and its four gaps may give way`, /class="utak-page utak-fit" style="[^"]*min-height: 297mm; height: 297mm;/.test(html) && count(html, "min-height: 12px;") === 3 && count(html, "min-height: 14px;") === 1 && rowsOf(html) === 12);
  }
  const long = Q.renderQuotationHTML(QT.specialQuotationData(quoteOf({ priceMode: "net" }, many(13), (i) => 2 + i), "S00016", CUSTOMER, NOW), COMPANY);
  assert("thirteen lines: the page grows over its sheets (a minimum height, never a fixed one)", /class="utak-page" style="[^"]*min-height: 297mm; box-sizing/.test(long) && !long.includes("utak-fit") && rowsOf(long) === 13);
  assert("…and its seal is not raised above its block (a block that starts a sheet left the seal's top on the sheet before)", long.includes("top: 0mm; width: 40mm") && Q.renderQuotationHTML(QT.specialQuotationData(quoteOf(), "S00016", CUSTOMER, NOW), COMPANY).includes(`top: -${PDF.ISSUED_SEAL_RAISE_MM}mm; width: 40mm`));

  // what the PDF service is handed: the sheet's printable height, and the page number on every sheet
  const files: Record<string, string> = {};
  const kitFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.startsWith("https://gotenberg.test/")) { for (const f of (init?.body as FormData).getAll("files") as File[]) files[f.name] = await f.text(); files.marginBottom = String((init?.body as FormData).get("marginBottom")); }
    return kitFetch(input as any, init);
  }) as typeof fetch;
  const env = world();
  await quiet(() => Q.generateQuotationPDF(QT.specialQuotationData(quoteOf(), "S00016", CUSTOMER, NOW), env));
  globalThis.fetch = kitFetch;
  assert("the PDF service gets the page at the printable height: its sheet less the page-number margin, the foot padding 6 mm", files.marginBottom === "0.4" && files["index.html"].includes(".utak-page { min-height: calc(297mm - 0.4in) !important; } .utak-page.utak-fit { height: calc(297mm - 0.4in) !important; } .utak-page > [data-utak=page-foot] { margin-bottom: 6mm !important; }"));
  assert("«صفحة X من Y» is printed in that margin of EVERY sheet, centred («صفحة 1 من 1» on a single one)", files["footer.html"].includes('class="num pageNumber"') && files["footer.html"].includes('class="num totalPages"') && files["footer.html"].includes("صفحة") && files["footer.html"].includes("justify-content: center"));
  assert("a page with no margin reserved is left as it is", PDF.fitPageToMargins("<head></head>", {}) === "<head></head>");
}

// ============================================================================
console.log("\n[و] the foot of the page");
{
  const special = Q.renderQuotationHTML(QT.specialQuotationData(quoteOf(), "S00016", CUSTOMER, NOW), COMPANY);
  const paths: Array<[string, string]> = [
    ["the special request's quotation", special],
    ["the day's quotation", Q.renderQuotationHTML({ ...Q.TEST_QUOTATION_DATA, issued: true }, COMPANY)],
    ["the manual quotation (a sale order's)", Q.renderQuotationHTML({ ...Q.TEST_QUOTATION_DATA, quotationNumber: "S00015", is_manual: true, issued: true }, COMPANY)],
    ["a preview", Q.renderQuotationHTML(QT.specialQuotationData(quoteOf(), QT.DRAFT_NUMBER, CUSTOMER, NOW, { draft: true }), COMPANY)],
  ];
  for (const [name, html] of paths) {
    const f = foot(html), line = /data-utak="legal-line"[^>]*style="([^"]*)"[^>]*>(.*?)<\/div>/s.exec(html);
    assert(`${name}: the legal strip is ONE unbreakable line — «${LEGAL} · س.ت 7055194869 · الرقم الضريبي 315022736600003»`, !!line && line[1].includes("white-space: nowrap") && text(line[2]).trim() === `${LEGAL} · س.ت 7055194869 · الرقم الضريبي 315022736600003` && count(html, 'data-utak="legal-line"') === 1);
    assert(`${name}: no address, e-mail or phone in the strip (they are in «من», once)`, count(html, COMPANY.email) === 1 && count(html, COMPANY.phone) === 1 && !text(f).includes("شارع الأمير"));
    assert(`${name}: «الشروط والملاحظات», not «شروط الدفع»`, text(html).includes("الشروط والملاحظات") && !html.includes("شروط الدفع"));
    assert(`${name}: the transfer line under the company's legal name`, text(f).includes(`للتحويل: ${LEGAL} — البنك السعودي الأول — IBAN SA59 4500 0000 1682 9572 3001`) && !text(f).includes("للتحويل: شركة يوتاك —"));
    assert(`${name}: the terms and the transfer line on the table's width, on the start side (no narrow column, no QR cell)`, f.includes('data-utak="terms"') && !f.includes("max-width: 62%") && !f.includes("grid-template-columns: 1fr auto") && !f.includes("width: 80px"));
    const order = [f.indexOf("الشروط والملاحظات"), f.indexOf("للتحويل:"), f.indexOf("شكراً لثقتكم"), f.indexOf('data-utak="legal-line"')];
    assert(`${name}: the order — terms, transfer line, «شكراً لثقتكم…» centred, then the strip centred`, order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])) && /text-align: center;[^>]*>شكراً لثقتكم/.test(f) && /data-utak="legal-line" style="text-align: center;/.test(f), order.join());
    assert(`${name}: the terms, «شكراً …» and the strip are one block that never splits between sheets`, html.includes('<div class="utak-block" data-utak="page-foot">') && html.includes(".utak-block { break-inside: avoid; page-break-inside: avoid; }") && f.includes("</html>"));
    const from = html.slice(html.indexOf("من / FROM"), html.indexOf("<table"));
    assert(`${name}: «من»'s address breaks after a comma, never inside a name («حي السلي» is one piece)`, from.includes('<span style="display: inline-block; max-width: 100%;">حي السلي،</span>') && from.includes('<span style="display: inline-block; max-width: 100%;">8141 شارع الأمير محمد بن عبدالرحمن بن عبدالعزيز،</span>') && count(from, 'display: inline-block; max-width: 100%;">') === 4);
  }
  assert("a draft is never sealed, whatever else it is called (issued AND draft: «مسودة», no seal)", (() => { const h = Q.renderQuotationHTML({ ...QT.specialQuotationData(quoteOf(), QT.DRAFT_NUMBER, CUSTOMER, NOW), issued: true, draft: true }, COMPANY); return h.includes('data-utak="draft-mark"') && !h.includes('data-utak="stamp"') && !h.includes('data-utak="seal-signature"'); })());
  assert("the address' parts read as the address itself, in order", text(PDF.partyAddressHTML(ADDRESS)).trim() === ADDRESS && PDF.partyAddressHTML("الرياض") === '<span style="display: inline-block; max-width: 100%;">الرياض</span>' && PDF.partyAddressHTML("") === "");

  // the transfer line's holder
  assert("bankLineWithHolder: the holder alone changes — the bank and the IBAN are untouched", BANK.bankLineWithHolder(BANK_LINE, LEGAL) === `للتحويل: ${LEGAL} — البنك السعودي الأول — IBAN SA59 4500 0000 1682 9572 3001`);
  assert("…no legal name, no line, or a text that is not a transfer line: as it is", BANK.bankLineWithHolder(BANK_LINE, "") === BANK_LINE && BANK.bankLineWithHolder("", LEGAL) === "" && BANK.bankLineWithHolder(undefined, LEGAL) === "" && BANK.bankLineWithHolder("ادفع نقداً", LEGAL) === "ادفع نقداً" && BANK.bankLineWithHolder("للتحويل: أ — ب — رقم 12", LEGAL) === "للتحويل: أ — ب — رقم 12" && BANK.bankLineWithHolder("حساب: أ — ب — IBAN SA1", LEGAL) === "حساب: أ — ب — IBAN SA1");
  assert("a company with no legal name: its name (not the bank card's holder)", text(Q.renderQuotationHTML(Q.TEST_QUOTATION_DATA, { ...COMPANY, legalNameAr: "", nameAr: "مؤسسة يوتاك التجارية" })).includes("للتحويل: مؤسسة يوتاك التجارية — البنك السعودي الأول"));
  assert("no company read (the fallback page): no strip, «الشروط والملاحظات» and «شكراً لثقتكم في شركة يوتاك» still", (() => { const h = Q.renderQuotationHTML(Q.TEST_QUOTATION_DATA); return !h.includes('data-utak="legal-line"') && text(h).includes("الشروط والملاحظات") && text(h).includes("شكراً لثقتكم في شركة يوتاك"); })());
  assert("the English quotation: «TERMS & NOTES», an English strip line", (() => { const h = Q.renderQuotationHTML({ ...Q.TEST_QUOTATION_DATA, lang: "en" }, COMPANY); return h.includes("TERMS &amp; NOTES") && /data-utak="legal-line" dir="ltr"/.test(h) && text(h).includes("UTAK Company · CR No. 7055194869 · VAT No. 315022736600003"); })());

  // the other documents: their strip and their words as they were — only one block now, and the page number's place
  const TAX = { ...INV.TEST_INVOICE_DATA, invoiceDate: new Date("2026-10-07T09:00:00Z"), vatAmount: 361.5, issued: true };
  for (const [name, html] of [["the tax invoice", INV.renderInvoiceHTML(TAX, COMPANY)], ["the receipt", REC.renderReceiptHTML({ ...REC.TEST_RECEIPT_DATA, issued: true }, COMPANY)], ["the purchase order", PO.renderPurchaseOrderHTML({ ...PO.TEST_PURCHASE_ORDER_DATA, issued: true }, COMPANY)], ["the delivery note", DN.renderDeliveryNoteHTML({ ...DN.TEST_DELIVERY_NOTE_DATA, issued: true }, COMPANY)]] as Array<[string, string]>) {
    const f = foot(html);
    assert(`${name}: its strip keeps every line of it (the name, the register, the VAT number; the address, the phone, the e-mail)`, !html.includes('data-utak="legal-line"') && text(f).includes(`${LEGAL} · س.ت 7055194869 · الرقم الضريبي 315022736600003`) && text(f).includes("شارع الأمير") && f.includes(COMPANY.email) && f.includes(COMPANY.phone));
    assert(`${name}: the foot is one block that never splits between sheets, the strip inside it`, count(html, '<div class="utak-block" data-utak="page-foot">') === 1 && f.indexOf("شارع الأمير") > 0);
    assert(`${name}: nothing of the quotation's page reaches it (no «الشروط والملاحظات», its transfer line and its address as they were)`, !html.includes("الشروط والملاحظات") && !html.includes("utak-fit") && !html.includes("display: inline-block; max-width: 100%;") && !text(html).includes(`للتحويل: ${LEGAL}`));
  }
  assert("the invoice keeps «شروط الدفع» and its transfer line as the bank account names it", text(INV.renderInvoiceHTML(TAX, COMPANY)).includes("شروط الدفع") && text(INV.renderInvoiceHTML(TAX, COMPANY)).includes("للتحويل: شركة يوتاك — البنك السعودي الأول"));
}

// ============================================================================
console.log("\n[ح] «المنشأ» and «المقاس»");
{
  assert("«جنوب أفريقيا · مقاس 66»: the origin, then the size", Q.itemDetail("جنوب أفريقيا", "66") === "جنوب أفريقيا · مقاس 66");
  assert("one of the two, a size already worded, blanks and Odoo's false", Q.itemDetail("مصر", "") === "مصر" && Q.itemDetail("", "72") === "مقاس 72" && Q.itemDetail(false, "مقاس 5") === "مقاس 5" && Q.itemDetail("  ", false) === "" && Q.itemDetail(undefined, null) === "" && Q.itemDetail("تركيا", "Size L") === "تركيا · Size L");
  const q = quoteOf();
  q.lines[0].origin = "جنوب أفريقيا"; q.lines[0].size = "66"; q.lines[4].origin = "إيطاليا";
  for (const [name, data] of [["unit prices", QT.specialQuotationData(q, "S00016", CUSTOMER, NOW)], ["by quantities", QT.specialQuotationData({ ...q, layout: "qty" }, "S00016", CUSTOMER, NOW)]] as Array<[string, any]>) {
    const html = Q.renderQuotationHTML(data, COMPANY);
    assert(`${name}: a small line under the item's name for the lines that carry one — and for no other`, count(html, 'data-utak="item-detail"') === 2 && />برتقال<\/div><div data-utak="item-detail"[^>]*>جنوب أفريقيا · مقاس 66<\/div>/.test(html) && />تفاح أحمر<\/div><div data-utak="item-detail"[^>]*>إيطاليا<\/div>/.test(html));
    assert(`${name}: the detail is small and muted (9 px), the name above it`, /data-utak="item-detail" style="font-size: 9px;/.test(html) && data.items[0].detail === "جنوب أفريقيا · مقاس 66" && data.items[1].detail === undefined);
  }
  assert("a request with neither on any line: no detail line at all", !Q.renderQuotationHTML(QT.specialQuotationData(quoteOf(), "S00016", CUSTOMER, NOW), COMPANY).includes("item-detail"));
  assert("Odoo: two text fields «المنشأ» and «المقاس» on the request's line and on the sale order's line, optional columns on both screens",
    ["x_item_origin", "x_item_size"].every((n) => LIB.LINE_FIELDS.some((f: any) => f.name === n && f.ttype === "char") && LIB.SALE_LINE_FIELDS.some((f: any) => f.name === n && f.ttype === "char"))
    && LIB.LINE_FIELDS.find((f: any) => f.name === "x_item_origin").field_description === "المنشأ" && LIB.LINE_FIELDS.find((f: any) => f.name === "x_item_size").field_description === "المقاس"
    && LIB.formArch({ send: 1, accept: 2, recalc: 3, issue: 4, pdf: 5, close: 6, reopen: 7, preview: 8 }).includes('<field name="x_item_origin" optional="show"/>\n            <field name="x_item_size" optional="show"/>')
    && LIB.saleExtArch(9).includes('<field name="x_item_origin" optional="show"/>\n    <field name="x_item_size" optional="show"/>'));

  // from the request to the sale order when the quotation is issued
  const env = world();
  const id = request([[ORANGE, 1, { x_purchase_price: 100, x_final_price: 139.49, x_unit: "18 كيلو", x_item_origin: "جنوب أفريقيا", x_item_size: "66" }], [GARLIC, 1, { x_purchase_price: 10, x_final_price: 14.25 }], [LETTUCE, 1, { x_purchase_price: 5, x_final_price: 8 }]]);
  openWindow(env, MADARAT_PHONE);
  const read = (await quiet(() => SQ.readQuote(env, id)))!;
  assert("the worker reads them with the line (and «شكل العرض» with the request)", read.lines[0].origin === "جنوب أفريقيا" && read.lines[0].size === "66" && read.lines[1].origin === "" && read.layout === "auto");
  assert("«شكل العرض» chosen on the screen is what the worker reads: «أسعار الوحدة» with quantities of 40, «بالكميات» with quantities of 1", await quiet(async () => {
    const u = request([[ORANGE, 40, { x_final_price: 139.49 }]], { x_layout: "unit" }), q2 = request([[ORANGE, 1, { x_final_price: 139.49 }]], { x_layout: "qty" });
    const a = (await SQ.readQuote(env, u))!, b = (await SQ.readQuote(env, q2))!;
    return a.layout === "unit" && QT.quotationLayout(a) === "unit" && b.layout === "qty" && QT.quotationLayout(b) === "qty";
  }));
  const r = await quiet(() => QT.issueSpecialQuotation(env, id));
  const so = saleOrders()[0];
  const sl = saleLines(so.id);
  assert("issued: the sale order's line carries «المنشأ» and «المقاس»; a line without them carries none", r.action === "issued" && sl.length === 3 && sl[0].x_item_origin === "جنوب أفريقيا" && sl[0].x_item_size === "66" && sl[1].x_item_origin === false && sl[1].x_item_size === false, JSON.stringify(sl.map((l) => [l.x_item_origin, l.x_item_size])));
  assert("a unit-price quotation says no total to Baraa or to the request: «أسعار الوحدة لـ 3 صنف (بلا إجمالي)»", String(quote(id).x_last_result).includes("أسعار الوحدة لـ 3 صنف (بلا إجمالي)") && !String(quote(id).x_last_result).includes("الإجمالي "), String(quote(id).x_last_result));
  assert("its file reached the customer inside his window", sentTo(MADARAT_PHONE).filter((b: any) => b?.type === "document").length === 1);
  // issued again with the size changed and one line gone
  Object.assign(lineOf(id, ORANGE), { x_item_size: "72", x_item_origin: false });
  const gone = lineOf(id, LETTUCE).id;
  table("x_special_quote_line").delete(gone);
  env.MSG_DEDUP.store.delete(`btnlock:v1:spq_issue:${id}`);
  await quiet(() => QT.issueSpecialQuotation(env, id));
  const sl2 = saleLines(so.id);
  assert("issued again: the same order, its line brought up to date («المقاس» 72, «المنشأ» emptied)", saleOrders().length === 1 && sl2[0].x_item_size === "72" && sl2[0].x_item_origin === false);
  assert("a line that left the request: quantity 0 AND price 0 on the order (never an «alternative» of its quotation), nothing deleted", sl2.length === 3 && sl2[2].product_uom_qty === 0 && sl2[2].price_unit === 0, JSON.stringify(sl2[2]));
  assert("outside his window a unit-price quotation never goes by the template (its words state a total): the file reaches Baraa", await quiet(async () => {
    const e = world(); const q2 = request([[ORANGE, 1, { x_purchase_price: 100, x_final_price: 139.49 }]], { x_valid_until: "2026-10-03 20:00:00" });
    const out = await QT.issueSpecialQuotation(e, q2);
    return out.to === "owner_instead" && String(out.detail).includes("عرض أسعار الوحدة بلا إجمالي") && sentTo(MADARAT_PHONE).length === 0;
  }));
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
  void linesOf; void MUSHROOM;
}

done();
