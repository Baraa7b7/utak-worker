// § 62 ج (2026-10-07) — the quotation of «طلب أسعار خاص».
//
//   • never with a line that has no final price: the lines are named, nothing is recorded or sent
//   • recorded in Odoo as an ordinary quotation of the customer (a draft sale.order), its number that
//     order's; issued again: the same order, brought up to date in place
//   • the PDF: each line with its unit, its final VAT-inclusive price and its total, the request's own
//     «صالح حتى» in place of the day's 06:00
//   • to the customer an attached file: inside his window the document; outside it the template
//     utak_quotation_pdf_v2 only when «صالح حتى» does not pass 06:00 of tomorrow; otherwise to Baraa
//   • «⬇️ PDF لي فقط»: to Baraa alone
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62-quotation.test.mts

import { OWNER, closeOwnerWindow, graph, heldFor, odooLog, openWindow, quiet, sentTo, table } from "./wa-harness.mts";
import { assert, done, ownerTexts, rejected } from "./s46-kit.mts";
import {
  AHMED, AHMED_PHONE, DAY, GARLIC, LETTUCE, MADARAT, MADARAT_PHONE, MUSHROOM, ORANGE, lineOf, quote, r2, request, saleLines, saleOrders, utc, world, writes,
} from "./s62-kit.mts";
import * as KIT from "./s62-kit.mts";

const QT = await import("../src/special-quotation.ts");
const SQ = await import("../src/special-quote.ts");
const Q = await import("../src/quotation.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { CUSTOMER_PRICE_PURPOSES } = await import("../src/price-privacy.ts");
const { sendText } = await import("../src/meta.ts");

const docsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "document");
const tplTo = (d: string, name: string) => sentTo(d).filter((b: any) => b?.template?.name === name);
const unlock = (env: any, id: number) => env.MSG_DEDUP.store.delete(`btnlock:v1:spq_issue:${id}`);
/** A request whose six lines carry a purchase price and a final price. */
function priced(extra: Record<string, unknown> = {}): number {
  const id = request(undefined, extra);
  for (const [p, buy, fin] of [[ORANGE, 3, 4.75], [LETTUCE, 6, 9], [GARLIC, 10, 14.25], [1, 2, 3], [MUSHROOM, 20, 27.5], [2, 2.5, 3.5]] as Array<[number, number, number]>) Object.assign(lineOf(id, p), { x_purchase_price: buy, x_final_price: fin });
  return id;
}
// 1464×4.75 + 494×9 + 194×14.25 + 33×3 + 12×27.5 + 9×3.5 = 6954 + 4446 + 2764.5 + 99 + 330 + 31.5 = 14625
const TOTAL = 14625;

console.log("\n[ج] the hours of a quotation");
{
  const now = Date.parse(`${DAY}T14:00:00+03:00`);
  assert("«صالح حتى» as the customer reads it: the Riyadh day and hour", QT.validUntilText("2026-10-04 20:59:59") === "4 أكتوبر 2026 الساعة 23:59" && QT.validUntilText("") === "" && QT.validUntilText("soon") === "");
  assert("06:00 of tomorrow (Riyadh) is the hour utak_quotation_pdf_v2 promises", QT.sixTomorrowMs(now) === Date.parse("2026-10-04T06:00:00+03:00"));
  assert("the template fits a validity up to that hour — and not a minute past it", QT.templateFits(utc("2026-10-04 06:00"), now) && QT.templateFits(utc(`${DAY} 20:00`), now) && !QT.templateFits("2026-10-04 03:00:01", now) && !QT.templateFits("2026-10-04 20:59:59", now));
  assert("…nor a validity already over, nor none", !QT.templateFits(utc(`${DAY} 13:00`), now) && !QT.templateFits("", now));
  assert("the customer's line: «مرفق عرض السعر رقم … صالح حتى …»", QT.customerCaption("S00041", "2026-10-04 20:59:59") === "مرفق عرض السعر رقم S00041 صالح حتى 4 أكتوبر 2026 الساعة 23:59" && QT.customerCaption("S00041", "") === "مرفق عرض السعر رقم S00041");
  assert("the purposes: the customer's is a price purpose (closed to a source or a supplier); Baraa's file is his alone", CUSTOMER_PRICE_PURPOSES.has("customer_quotation") && PURPOSES[QT.OWNER_SPECIAL_PURPOSE]?.kind === "operational");
  const env = world();
  const leak = await quiet(() => sendText(env, "+" + MADARAT_PHONE, "x", { purpose: QT.OWNER_SPECIAL_PURPOSE }));
  const own = await quiet(() => sendText(env, "+" + OWNER, "x", { purpose: QT.OWNER_SPECIAL_PURPOSE }));
  assert("«owner_special_quote»: refused for any other number (403), sent to Baraa's", leak.status === 403 && own.ok);
}

console.log("\n[ج] never with a line that has no final price");
{
  const env = world();
  const id = priced();
  lineOf(id, LETTUCE).x_final_price = 0; lineOf(id, MUSHROOM).x_final_price = 0;
  openWindow(env, MADARAT_PHONE);
  const r = await quiet(() => QT.issueSpecialQuotation(env, id));
  assert("refused, with the names of the lines that lack one", r.action === "refused" && r.detail === "أسطر بلا سعر نهائي: خس أمريكي، فطر أبيض", JSON.stringify(r));
  assert("nothing is recorded: no sale.order, no number, no PDF, the state as it was", saleOrders().length === 0 && KIT.gotenberg === 0 && r2.length === 0 && !quote(id).x_quotation_number && quote(id).x_state === "draft");
  assert("nothing reaches the customer", sentTo(MADARAT_PHONE).length === 0);
  assert("Baraa reads the names — on WhatsApp and on the request", ownerTexts().some((t) => t.startsWith(`🚫 عرض سعر الطلب الخاص ${SQ.quoteName(id)} (شركة مدارات للاغذية) لم يصدر: أسطر بلا سعر نهائي: خس أمريكي، فطر أبيض`)) && String(quote(id).x_last_result).startsWith("🚫 لم يصدر عرض السعر: أسطر بلا سعر نهائي: خس أمريكي، فطر أبيض"));
  assert("the same for «⬇️ PDF لي فقط»: no file with a line unpriced", (await quiet(async () => { unlock(env, id); return QT.issueSpecialQuotation(env, id, { ownerOnly: true }); })).action === "refused" && docsTo(OWNER).length === 0);
  // a line with a price and no quantity
  lineOf(id, LETTUCE).x_final_price = 9; lineOf(id, MUSHROOM).x_final_price = 27.5; lineOf(id, 2).x_qty = 0;
  unlock(env, id);
  const r2q = await quiet(() => QT.issueSpecialQuotation(env, id));
  assert("a line with no quantity is named too", r2q.action === "refused" && r2q.detail === "أسطر بلا كمية: خيار" && saleOrders().length === 0);
  assert("what is missing, as a list", JSON.stringify(QT.missingLines({ lines: [{ productName: "أ", finalPrice: 0, qty: 5 }, { productName: "ب", finalPrice: 3, qty: 0 }, { productName: "ج", finalPrice: 3, qty: 1 }] as any })) === JSON.stringify({ noPrice: ["أ"], noQty: ["ب"] }));
  for (const [extra, why] of [[{ x_utak_simulation: true }, "الطلب محاكاة"], [{ x_state: "closed" }, "الطلب مغلق"]] as Array<[Record<string, unknown>, string]>) {
    const rid = priced(extra);
    const rr = await quiet(() => QT.issueSpecialQuotation(env, rid));
    assert(`refused: ${why}`, rr.action === "refused" && rr.detail === why && saleOrders().length === 0);
  }
  assert("a request that is not there: said", (await quiet(() => QT.issueSpecialQuotation(env, 515151))).action === "not_found");
}

console.log("\n[ج] issued: an ordinary quotation in Odoo, its PDF, the file to the customer inside his window");
let env = world();
let id = priced();
{
  openWindow(env, MADARAT_PHONE);
  odooLog.length = 0;
  const r = await quiet(() => QT.issueSpecialQuotation(env, id));
  const so = saleOrders();
  assert("issued, to the customer inside his window", r.action === "issued" && r.to === "customer_session", JSON.stringify(r));
  assert("ONE draft sale.order of the customer, tied to the request, valid until the request's day", so.length === 1 && so[0].partner_id === MADARAT && so[0].state === "draft" && so[0].origin === SQ.quoteName(id) && so[0].validity_date === "2026-10-04", JSON.stringify(so));
  const sl = saleLines(so[0].id);
  assert("its six lines: the product's variant, the quantity, the final price", sl.length === 6 && sl[0].product_id === ORANGE + 1000 && sl[0].product_uom_qty === 1464 && sl[0].price_unit === 4.75 && sl[0].name === "برتقال" && sl[3].product_id === 1001 && sl[3].price_unit === 3, JSON.stringify(sl.slice(0, 1)));
  assert("the quotation's number is that order's (the manual quotation's numbering)", r.number === so[0].name && /^S\d{5}$/.test(String(r.number)) && quote(id).x_quotation_number === so[0].name);
  assert("the request: «صدر العرض», its order, its PDF's link, when", quote(id).x_state === "quoted" && quote(id).x_sale_order_id === so[0].id && String(quote(id).x_pdf_url).startsWith("https://w.test/quotation-pdf/") && quote(id).x_issued_at === utc(`${DAY} 14:00`));
  assert("ONE PDF built and kept under the quotation's number", KIT.gotenberg === 1 && r2.length === 1 && r2[0].includes(String(r.number)));
  const d = docsTo(MADARAT_PHONE);
  assert("the customer: ONE attached file named by the number, with «مرفق عرض السعر رقم … صالح حتى …» — no template, no link in a text", d.length === 1 && sentTo(MADARAT_PHONE).length === 1 && d[0].document.filename === `${r.number}.pdf` && d[0].document.caption === `مرفق عرض السعر رقم ${r.number} صالح حتى 4 أكتوبر 2026 الساعة 23:59` && d[0].document.link === quote(id).x_pdf_url);
  assert("Baraa reads that it went, with the total and the link", ownerTexts().some((t) => t.startsWith(`📄 صدر عرض السعر ${r.number} وأُرسل ملفه للعميل (داخل نافذته). الإجمالي ${TOTAL} ريال شامل الضريبة`) && t.includes("https://w.test/quotation-pdf/")) && String(quote(id).x_last_result).startsWith(`📄 صدر عرض السعر ${r.number} وأُرسل ملفه للعميل`));
  assert("no price of the day and no order of the day is touched", !odooLog.some((l) => ["x_price_day", "x_daily_price", "x_daily_order", "x_quotation", "x_invoice", "account.move"].includes(l.model)));
  assert("the schema gate let every field through", rejected.length === 0, rejected.join(" | "));
  // a second press a moment later
  const n = graph.length;
  assert("a second press a moment later does nothing (the button's lock)", (await quiet(() => QT.issueSpecialQuotation(env, id))).action === "busy" && graph.length === n && saleOrders().length === 1);
}

console.log("\n[ج] the PDF's data");
{
  const q = (await quiet(() => SQ.readQuote(env, id)))!;
  const data = QT.specialQuotationData(q, "S00041", { name: "شركة مدارات للاغذية", address: "الرياض", phone: "+" + MADARAT_PHONE }, Date.now());
  assert("each line: its name, its unit, its quantity, its final price, its total", data.items.length === 6 && JSON.stringify(data.items[0]) === JSON.stringify({ name: "برتقال", pack: "كيلو", qty: 1464, price: 4.75, total: 6954 }));
  assert("the totals: the grand total is the lines' (VAT inside), split as the tax invoice splits it", data.grandTotal === TOTAL && data.vatAmount === 1907.61 && data.subtotal === 12717.39 && data.discount === 0 && data.vatInclusive === true, JSON.stringify([data.grandTotal, data.vatAmount, data.subtotal]));
  assert("issued (the seal), manual, no missing price", data.issued === true && data.is_manual === true && data.has_blocking_issue === false && data.customer_id === MADARAT);
  const html = Q.renderQuotationHTML(data);
  assert("the page: the request's own validity, the VAT note — and not the day's «٦:٠٠ صباحاً»", html.includes("العرض ساري حتى 4 أكتوبر 2026 الساعة 23:59. الأسعار شاملة ضريبة القيمة المضافة") && !html.includes(Q.QUOTATION_FOOTER));
  assert("…every line's name and unit, the number, the customer", ["برتقال", "خس أمريكي", "فطر أبيض", "كيلو", "S00041", "شركة مدارات للاغذية"].every((x) => html.includes(x)));
  assert("…and nothing of our cost: no purchase price, no «بدون خسارة», no profit", !/(>|\s)3\.62(<|\s)|ربح|شراء|بدون خسارة/.test(html));
  const plain = Q.renderQuotationHTML({ ...data, footerNote: undefined });
  assert("a quotation without the override keeps the day's note as it was", plain.includes(Q.QUOTATION_FOOTER));
}

console.log("\n[ج] issued again: the same order, brought up to date in place");
{
  unlock(env, id);
  lineOf(id, ORANGE).x_final_price = 5;                               // a new price
  table(KIT.LINE).delete(lineOf(id, 2).id);                           // a line left the request
  const added = KIT.GARLIC;                                           // a second garlic line is a new line of its own
  const lid = [...table(KIT.LINE).values()].length;
  table(KIT.LINE).set(99001, { id: 99001, x_quote_id: id, x_sequence: 99, x_product_tmpl_id: added, x_qty: 6, x_unit: "كيلو", x_purchase_price: 10, x_final_price: 14 } as any);
  const before = saleOrders()[0];
  const first = saleLines(before.id).map((l) => l.id);
  const r = await quiet(() => QT.issueSpecialQuotation(env, id));
  const so = saleOrders();
  const sl = saleLines(so[0].id);
  assert("no second sale.order, the same number", r.action === "issued" && so.length === 1 && r.number === before.name);
  assert("the changed price is on its own line; nothing was deleted", sl.find((l) => l.product_id === ORANGE + 1000).price_unit === 5 && first.every((x) => sl.some((l) => l.id === x)) && !odooLog.some((l) => l.method === "unlink"));
  assert("the line that left the request: quantity 0 on the order (not deleted)", sl.find((l) => l.product_id === 1002).product_uom_qty === 0);
  assert("the new line is a new line of the order", sl.length === 7 && sl.filter((l) => l.product_id === GARLIC + 1000).length === 2 && sl.find((l) => l.product_uom_qty === 6)?.price_unit === 14);
  // the order was confirmed in Odoo: it is not touched, a new quotation is made
  so[0].state = "sale";
  unlock(env, id);
  const r3 = await quiet(() => QT.issueSpecialQuotation(env, id));
  assert("an order confirmed in Odoo is left as it is: a new quotation with its own number", r3.action === "issued" && saleOrders().length === 2 && r3.number !== before.name && quote(id).x_sale_order_id === saleOrders()[1].id && saleLines(so[0].id).length === 7);
  void lid;
}

console.log("\n[ج] outside the customer's window");
{
  // «صالح حتى» inside 06:00 of tomorrow: the template carries the file
  env = world();
  id = priced({ x_valid_until: utc("2026-10-04 06:00"), x_prepared: true, x_waste_pct: 5, x_min_margin_pct: 10 });
  let r = await quiet(() => QT.issueSpecialQuotation(env, id));
  const t = tplTo(MADARAT_PHONE, "utak_quotation_pdf_v2");
  assert("a validity up to 06:00 of tomorrow: utak_quotation_pdf_v2 with the file as its header", r.to === "customer_template" && t.length === 1 && sentTo(MADARAT_PHONE).length === 1 && t[0].template.components.find((c: any) => c.type === "header").parameters[0].document.filename === `${r.number}.pdf`);
  assert("…its four values: the customer, the number, the date, the total", JSON.stringify(t[0].template.components.find((c: any) => c.type === "body").parameters.map((p: any) => p.text)) === JSON.stringify(["شركة مدارات للاغذية", r.number, "3 أكتوبر 2026", String(TOTAL)]));
  assert("Baraa reads «بالقالب»", ownerTexts().some((x) => x.includes("وأُرسل ملفه للعميل (بالقالب)")));
  // «صالح حتى» past 06:00 of tomorrow: no template says that — the file reaches Baraa
  env = world();
  id = priced();                                                       // the default: the end of tomorrow
  r = await quiet(() => QT.issueSpecialQuotation(env, id));
  const own = docsTo(OWNER);
  assert("a validity past 06:00 of tomorrow, the window closed: NOTHING to the customer — no template, nothing held", r.action === "issued" && r.to === "owner_instead" && sentTo(MADARAT_PHONE).length === 0 && heldFor(env, MADARAT_PHONE).length === 0);
  assert("…the file reaches Baraa, and he is told why and to send it himself", own.length === 1 && own[0].document.filename === `${r.number}.pdf` && own[0].document.caption.includes("لم يُرسل للعميل: العميل خارج نافذة 24 ساعة، و«صالح حتى» يتجاوز 6:00 صباح الغد") && own[0].document.caption.includes("أرسله له بنفسك") && String(quote(id).x_last_result).includes("وصلك ملفه لترسله بنفسك"));
  assert("…the quotation is on record all the same", saleOrders().length === 1 && quote(id).x_state === "quoted" && quote(id).x_quotation_number === r.number);
  // the template not usable: the same
  env = world();
  Object.assign(([...table("x_whatsapp_template").values()] as any[]).find((x) => x.x_purpose === "customer_quotation_pdf_v2"), { x_category: "MARKETING" });
  id = priced({ x_valid_until: utc("2026-10-04 06:00"), x_prepared: true, x_waste_pct: 5, x_min_margin_pct: 10 });
  r = await quiet(() => QT.issueSpecialQuotation(env, id));
  assert("the template filed MARKETING: not used — the file reaches Baraa instead, nothing held for the customer", r.to === "owner_instead" && sentTo(MADARAT_PHONE).length === 0 && heldFor(env, MADARAT_PHONE).length === 0 && docsTo(OWNER).length === 1);
  // a customer with no number
  env = world();
  Object.assign(table("res.partner").get(MADARAT)!, { x_whatsapp_number: false, phone: false });
  id = priced();
  r = await quiet(() => QT.issueSpecialQuotation(env, id));
  assert("a customer with no WhatsApp number: the file reaches Baraa, and he is told", r.to === "owner_instead" && docsTo(OWNER)[0]?.document.caption.includes("العميل بلا رقم واتساب"));
}

console.log("\n[ج] § 53: a quotation never reaches a price source or a supplier");
{
  env = world();
  id = priced({ x_partner_id: AHMED });                                // the «customer» is a supplier's card
  openWindow(env, AHMED_PHONE);
  const r = await quiet(() => QT.issueSpecialQuotation(env, id));
  assert("the gateway refuses it for a supplier's number, whatever the request names: the file goes to Baraa", r.action === "issued" && r.to === "owner_instead" && sentTo(AHMED_PHONE).length === 0 && docsTo(OWNER).length === 1 && docsTo(OWNER)[0].document.caption.includes("لم يُرسل للعميل"));
}

console.log("\n[ج] «⬇️ PDF لي فقط»");
{
  env = world();
  id = priced();
  openWindow(env, MADARAT_PHONE);
  const r = await quiet(() => QT.issueSpecialQuotation(env, id, { ownerOnly: true }));
  const own = docsTo(OWNER);
  assert("the file to Baraa alone — nothing to the customer though his window is open", r.action === "issued" && r.to === "owner_only" && sentTo(MADARAT_PHONE).length === 0 && own.length === 1 && own[0].document.filename === `${r.number}.pdf`);
  assert("…its caption: the number, the customer, the total, «لم يُرسل للعميل», the link", own[0].document.caption.startsWith(`📄 عرض السعر رقم ${r.number} — شركة مدارات للاغذية\nالإجمالي ${TOTAL} ريال شامل الضريبة\nلك وحدك: لم يُرسل للعميل.`) && own[0].document.caption.includes("https://w.test/quotation-pdf/"));
  assert("it is the issued quotation: on record, numbered, the request «صدر العرض»", saleOrders().length === 1 && quote(id).x_state === "quoted" && String(quote(id).x_last_result).startsWith(`⬇️ صدر عرض السعر ${r.number} ووصلك ملفه وحدك`));
  // then «أصدر»: the same order and number, now to the customer
  unlock(env, id);
  const r2q = await quiet(() => QT.issueSpecialQuotation(env, id));
  assert("«📄 أصدر عرض السعر» after it: the same order and number, the file to the customer", r2q.to === "customer_session" && r2q.number === r.number && saleOrders().length === 1 && docsTo(MADARAT_PHONE).length === 1);
  // Baraa's own window closed: his file waits for it
  env = world();
  id = priced();
  closeOwnerWindow(env);
  await quiet(() => QT.issueSpecialQuotation(env, id, { ownerOnly: true }));
  assert("Baraa's window closed: his file waits for his next message (held for his number alone)", docsTo(OWNER).length === 0 && heldFor(env, OWNER).some((h: any) => JSON.stringify(h).includes("quotation-pdf")) && sentTo(MADARAT_PHONE).length === 0 && heldFor(env, MADARAT_PHONE).length === 0);
  assert("the hook's two ops are these two buttons", (await quiet(async () => { const e = world(); const q = priced(); openWindow(e, MADARAT_PHONE); const a = await SQ.handleSpecialQuoteHook(e, q, "pdf"); const sent = sentTo(MADARAT_PHONE).length; e.MSG_DEDUP.store.delete(`btnlock:v1:spq_issue:${q}`); const b = await SQ.handleSpecialQuoteHook(e, q, "issue"); return a.action === "issued" && sent === 0 && b.action === "issued" && sentTo(MADARAT_PHONE).length === 1; })));
  void writes; void DAY;
}

done();
