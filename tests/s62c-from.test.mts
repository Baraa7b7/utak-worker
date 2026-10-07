// § 62 ج (the fix, 2026-10-07) — «من» of every PDF is the company read from Odoo, and a quotation is
// addressed «إلى / TO».
//
//   • «من» (the quotation in its three paths — the day's, the manual one, the special request's —
//     the invoice, the receipt, the purchase order, the delivery note): the company's legal name,
//     national address, e-mail and phone as src/company.ts reads them — in every language, the
//     Arabic default included (it was BRAND_INFO's constants there)
//   • BRAND_INFO is the fallback: what «من» prints only when no company reached the renderer; its
//     e-mail is care@utakfresh.com
//   • the customer's block of a quotation is «إلى / TO» (English: «TO»); the invoice, the receipt,
//     the purchase order and the delivery note keep «فاتورة إلى / BILL TO»
//   • the company's VAT number is printed once: «من» carries its line only when the legal strip of
//     the same page does not; an invoice before the VAT cutoff carries it nowhere
//   • the wrong address (care@ + utak.com) is in no file of src/, scripts/, docs/templates/ or tests/
//
// In-memory Odoo + captured Graph and Gotenberg (tests/wa-harness.mts, tests/s62-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62c-from.test.mts

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { quiet, sentTo, table } from "./wa-harness.mts";
import { assert, done } from "./s46-kit.mts";
import { GARLIC, LETTUCE, MADARAT_PHONE, MUSHROOM, ORANGE, lineOf, request, saleOrders, world } from "./s62-kit.mts";

const QT = await import("../src/special-quotation.ts");
const SQ = await import("../src/special-quote.ts");
const Q = await import("../src/quotation.ts");
const INV = await import("../src/invoice.ts");
const REC = await import("../src/receipt.ts");
const PO = await import("../src/purchase-order.ts");
const DN = await import("../src/delivery-note.ts");
const PT = await import("../src/pdf-template.ts");
const SHELL = await import("../src/doc-shell.ts");

const root = new URL("../", import.meta.url).pathname;
const WRONG = "care@" + "utak.com";
const VAT = "315022736600003";
const NAME = "شركة يوتاك ذات مسؤولية محدودة";
const ADDRESS = "8141 شارع الأمير محمد بن عبدالرحمن بن عبدالعزيز، حي السلي، الرياض 14273";
const ADDRESS_EN = "8141 Prince Mohammed Bin Abdulrahman Bin Abdulaziz St, As Sulay, Riyadh 14273";
const EMAIL = "care@utakfresh.com";
const PHONE = "+966 58 004 0467";
/** The company as readCompanyInfo returns it for the tenant. */
const COMPANY = {
  nameAr: NAME, nameEn: "UTAK", address: ADDRESS, addressAr: ADDRESS, addressEn: ADDRESS_EN, email: EMAIL, phone: PHONE,
  cr: "7051996651", vat: VAT, legalNameAr: "", legalNameEn: "UTAK Company",
};
/** The e-mail and the phone share one line of «من». */
const CONTACT = `${EMAIL} · ${PHONE}`;
const FALLBACK = ["شركة يوتاك", "الرياض، المملكة العربية السعودية", CONTACT];

// § 62 د — a quotation's address is printed in parts that break after a comma (inline blocks): one line of text, as it reads
const text = (html: string) => html.replace(/<span style="display: inline-block; max-width: 100%;">|<\/span>/g, "").replace(/<[^>]+>/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
/** The two blocks above the table: the label of each and its lines, as printed. */
function parties(html: string): { toLabel: string; to: string[]; fromLabel: string; from: string[] } {
  const start = html.indexOf(`grid-template-columns: 1fr 1fr; gap: 32px;">`);
  const row = html.slice(start, html.indexOf(`<div style="height: `, start));
  const [a, b] = row.split(`text-align: left;">`);
  const [toLabel, ...to] = text(a.slice(a.indexOf(">") + 1).replace(/<[^>]*$/, ""));
  const [fromLabel, ...from] = text(b);
  return { toLabel, to, fromLabel, from };
}
const count = (s: string, part: string) => s.split(part).length - 1;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// the three paths of a quotation, as data
const DAILY = Q.TEST_QUOTATION_DATA;
const MANUAL = { ...Q.TEST_QUOTATION_DATA, quotationNumber: "S00015", is_manual: true, customer_id: 31 };
const SPECIAL = QT.specialQuotationData({
  partnerId: 111, priceMode: "net", validUntil: "2026-10-08 20:59:59", alternatives: "ليمون: تركي بدل المصري",
  lines: [{ productName: "برتقال", unit: "كيلو", qty: 100, finalNet: 4, finalPrice: 4.6 }, { productName: "ثوم", unit: "كرتون 18 كجم", qty: 2, finalNet: 150, finalPrice: 172.5 }],
} as any, "S00016", { name: "شركة مدارات للاغذية", address: "الرياض", phone: "+966530032939" }, Date.parse("2026-10-07T16:00:00+03:00"));
const TAX_INVOICE = { ...INV.TEST_INVOICE_DATA, invoiceDate: new Date("2026-10-07T09:00:00Z"), vatAmount: 361.5 };
const OLD_INVOICE = { ...INV.TEST_INVOICE_DATA, vatAmount: 0 };

const QUOTATIONS: Array<[string, any]> = [["the day's quotation", DAILY], ["the manual quotation", MANUAL], ["the special request's quotation", SPECIAL]];
const BILLED: Array<[string, (d: any, c?: any) => string, any]> = [
  ["the invoice", INV.renderInvoiceHTML, TAX_INVOICE], ["the receipt", REC.renderReceiptHTML, REC.TEST_RECEIPT_DATA],
  ["the purchase order", PO.renderPurchaseOrderHTML, PO.TEST_PURCHASE_ORDER_DATA], ["the delivery note", DN.renderDeliveryNoteHTML, DN.TEST_DELIVERY_NOTE_DATA],
];
const EVERY: Array<[string, (d: any, c?: any) => string, any]> = [...QUOTATIONS.map(([n, d]) => [n, Q.renderQuotationHTML, d] as [string, (d: any, c?: any) => string, any]), ...BILLED];
const pages: string[] = [];

console.log("\n[أ] «من» is the company read from Odoo");
{
  for (const [name, render, data] of EVERY) {
    const html = render(data, COMPANY); pages.push(html);
    const p = parties(html);
    assert(`${name}: «من» = the company's name, national address, e-mail and phone — nothing else`, p.fromLabel === "من / FROM" && same(p.from, [NAME, ADDRESS, CONTACT]), JSON.stringify(p.from));
    assert(`${name}: the e-mail and the phone share ONE left-to-right line (the block is no taller than it was)`, html.includes(`direction: ltr;">${EMAIL} · ${PHONE}</div>`)
      // § 62 د — a quotation's legal strip is one line (name · س.ت · الرقم الضريبي): the e-mail is in «من» alone; the other documents' strip keeps its second line
      && count(html, EMAIL) === (html.includes('data-utak="legal-line"') ? 1 : 2) && p.from.length === 3);
    assert(`${name}: nothing of the fallback's address is on the page`, !html.includes(FALLBACK[1]));
    const en = render({ ...data, lang: "en", vatAmount: name === "the invoice" ? 0 : data.vatAmount }, COMPANY); pages.push(en);
    const pe = parties(en);
    assert(`${name} in English: «FROM» = the English legal name and address`, pe.fromLabel === "FROM" && same(pe.from, ["UTAK Company", ADDRESS_EN, CONTACT]), JSON.stringify(pe));
  }
  const legal = Q.renderQuotationHTML(DAILY, { ...COMPANY, legalNameAr: "شركة يوتاك (الاسم القانوني)" });
  assert("the legal Arabic name wins when the company carries one", parties(legal).from[0] === "شركة يوتاك (الاسم القانوني)");
  const bare = parties(Q.renderQuotationHTML(DAILY, { ...COMPANY, email: "", addressAr: "", address: "" }));
  assert("a company read with an empty field prints no line for it — never the fallback's", same(bare.from, [NAME, PHONE]), JSON.stringify(bare.from));
  const noPhone = parties(Q.renderQuotationHTML(DAILY, { ...COMPANY, phone: "" }));
  assert("…and with one of the two, the e-mail or the phone has its own line as it had", same(noPhone.from, [NAME, ADDRESS, EMAIL]), JSON.stringify(noPhone.from));
  const customer = parties(Q.renderQuotationHTML(DAILY, COMPANY)).to;
  assert("the customer's block is as it was: name, contact, address, phone — a line each", same(customer, [DAILY.customer.name, DAILY.customer.contactPerson, DAILY.customer.address, DAILY.customer.phone]), JSON.stringify(customer));
  assert("the party of «من», as data: per language, with the VAT number and its words", same(SHELL.fromPartyFor("ar", COMPANY as any), { name: NAME, address: ADDRESS, email: EMAIL, phone: PHONE, vat: VAT, vatLabel: "الرقم الضريبي" })
    && same(SHELL.fromPartyFor("en", COMPANY as any), { name: "UTAK Company", address: ADDRESS_EN, email: EMAIL, phone: PHONE, vat: VAT, vatLabel: "VAT No." })
    && same(SHELL.fromPartyFor("bi", COMPANY as any), SHELL.fromPartyFor("ar", COMPANY as any)) && SHELL.fromPartyFor("ar", undefined) === undefined);
  // every quotation is rendered by src/quotation.ts alone: the manual one and the special request's hand it their data
  const src = (f: string) => readFileSync(join(root, "src", f), "utf8");
  assert("the three paths of a quotation meet in one renderer", !src("sale-order-quotation.ts").includes("renderPDFShell(") && !src("special-quotation.ts").includes("renderPDFShell(")
    && count(src("quotation.ts"), "renderPDFShell({") === 1 && src("special-quotation.ts").includes("generateQuotationPDF(data, env)"));
}

console.log("\n[ب] the fallback: no company reached the renderer");
{
  for (const [name, render, data] of EVERY) {
    const html = render(data); pages.push(html);
    assert(`${name} without a company: «من» = the brand's constants`, same(parties(html).from, FALLBACK), JSON.stringify(parties(html).from));
  }
  assert("the fallback's e-mail is care@utakfresh.com; no CR and no VAT number live in the code", PT.BRAND_INFO.email === EMAIL && PT.BRAND_INFO.cr === "" && PT.BRAND_INFO.vat === "");
  assert("the brand beside the logo, the tagline and the watermark are as they were", PT.BRAND_INFO.nameAr === "شركة يوتاك" && PT.BRAND_INFO.nameEn === "UTAK" && PT.BRAND_INFO.tagline === "توزيع منتجات زراعية طازجة"
    && pages[0].includes(`>${PT.BRAND_INFO.nameEn}</div>`) && pages[0].includes(PT.BRAND_INFO.tagline));
}

console.log("\n[ج] «إلى / TO» on a quotation, «فاتورة إلى / BILL TO» on the rest");
{
  for (const [name, data] of QUOTATIONS) {
    for (const company of [COMPANY, undefined]) {
      const html = Q.renderQuotationHTML(data, company as any);
      const p = parties(html);
      assert(`${name}${company ? "" : " (no company)"}: the customer's block is «إلى / TO»`, p.toLabel === "إلى / TO" && p.to[0] === data.customer.name && !html.includes("فاتورة إلى") && !html.includes("BILL TO"), JSON.stringify(p));
    }
    const en = Q.renderQuotationHTML({ ...data, lang: "en" }, COMPANY);
    assert(`${name} in English: «TO»`, parties(en).toLabel === "TO" && !en.includes("BILL TO"));
    assert(`${name} in two languages: «إلى / TO»`, parties(Q.renderQuotationHTML({ ...data, lang: "bi" }, COMPANY)).toLabel === "إلى / TO");
    assert(`${name} asked in Arabic: «إلى / TO»`, parties(Q.renderQuotationHTML({ ...data, lang: "ar" }, COMPANY)).toLabel === "إلى / TO");
  }
  for (const [name, render, data] of BILLED) {
    for (const company of [COMPANY, undefined]) {
      const p = parties(render(data, company));
      assert(`${name}${company ? "" : " (no company)"}: «فاتورة إلى / BILL TO» as it was`, p.toLabel === "فاتورة إلى / BILL TO", p.toLabel);
    }
    assert(`${name} in English: «BILL TO» as it was`, parties(render({ ...data, lang: "en", vatAmount: name === "the invoice" ? 0 : data.vatAmount }, COMPANY)).toLabel === "BILL TO");
  }
  assert("the two labels, as words", SHELL.labelForTo("ar") === "إلى / TO" && SHELL.labelForTo("bi") === "إلى / TO" && SHELL.labelForTo("en") === "TO"
    && SHELL.labelForBillTo("ar") === "فاتورة إلى / BILL TO" && SHELL.labelForBillTo("en") === "BILL TO");
}

console.log("\n[د] the company's VAT number is printed once");
{
  for (const [name, data] of QUOTATIONS) {
    const html = Q.renderQuotationHTML(data, COMPANY);
    assert(`${name}: the number is on the page once — in the legal strip, not in «من»`, count(html, VAT) === 1 && html.includes(`الرقم الضريبي <bdi dir="ltr">${VAT}</bdi>`) && !parties(html).from.some((l) => l.includes(VAT) || l.includes("الرقم الضريبي")), String(count(html, VAT)));
  }
  for (const [name, render, data] of BILLED.slice(1)) assert(`${name}: once, in the legal strip`, count(render(data, COMPANY), VAT) === 1);
  const tax = INV.renderInvoiceHTML(TAX_INVOICE, COMPANY);
  assert("the tax invoice: «من» adds no third place (the seller's block and the legal strip, as before)", count(tax, VAT) === 2 && !parties(tax).from.some((l) => l.includes(VAT)), String(count(tax, VAT)));
  const old = INV.renderInvoiceHTML(OLD_INVOICE, COMPANY);
  assert("an invoice before the VAT cutoff: the number is nowhere — «من» included", count(old, VAT) === 0 && same(parties(old).from, [NAME, ADDRESS, CONTACT]));
  // the shell's own rule, with and without a strip
  const base = { documentTitle: "T", documentNumber: "N", documentDate: new Date(0), billTo: { name: "X" }, bodyHTML: "<p>b</p>", pageMetrics: PT.computePageMetrics(0), from: SHELL.fromPartyFor("ar", COMPANY as any) };
  const noStrip = PT.renderPDFShell(base);
  assert("a page with no legal strip: «من» carries «الرقم الضريبي: …», once", count(noStrip, VAT) === 1 && same(parties(noStrip).from, [NAME, ADDRESS, CONTACT, "الرقم الضريبي:", VAT]) && noStrip.includes(`الرقم الضريبي: <bdi dir="ltr">${VAT}</bdi>`), JSON.stringify(parties(noStrip).from));
  const stripNoVat = PT.renderPDFShell({ ...base, legalFooterBar: { name: NAME, cr: "7051996651", vat: "" } });
  assert("a strip without the number: «من» carries it, once", count(stripNoVat, VAT) === 1 && parties(stripNoVat).from.includes(VAT));
  const strip = PT.renderPDFShell({ ...base, legalFooterBar: { name: NAME, vat: VAT } });
  assert("a strip with the number: «من» does not repeat it", count(strip, VAT) === 1 && !parties(strip).from.includes(VAT) && same(parties(strip).from, [NAME, ADDRESS, CONTACT]));
  const stripEn = PT.renderPDFShell({ ...base, lang: "en", from: SHELL.fromPartyFor("en", COMPANY as any) });
  assert("in English the line reads «VAT No.: …»", stripEn.includes(`VAT No.: <bdi dir="ltr">${VAT}</bdi>`) && count(stripEn, VAT) === 1);
  const noVat = PT.renderPDFShell({ ...base, from: { ...base.from!, vat: "" } });
  assert("a party with no VAT number: no line, and the page is byte for byte the one without the field", !noVat.includes("الرقم الضريبي") && noVat === PT.renderPDFShell({ ...base, from: { name: NAME, address: ADDRESS, email: EMAIL, phone: PHONE } }));
}

console.log("\n[هـ] the production path: the special request's file, the company from Odoo");
{
  // what reaches the PDF service
  const sent: string[] = [];
  const kitFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.startsWith("https://gotenberg.test/")) for (const f of (init?.body as FormData).getAll("files") as File[]) if (f.name === "index.html") sent.push(await f.text());
    return kitFetch(input as any, init);
  }) as typeof fetch;
  const env = world();
  Object.assign(table("res.company").get(1)!, { name: NAME, street: "8141 شارع الأمير محمد بن عبدالرحمن بن عبدالعزيز", street2: "حي السلي", city: "الرياض", zip: "14273", phone: PHONE, email: EMAIL, country_id: false, partner_id: false });
  const id = request(undefined, { x_price_mode: "net" });
  for (const [p, buy, fin] of [[ORANGE, 3, 4.75], [LETTUCE, 6, 9], [GARLIC, 10, 14.25], [1, 2, 3], [MUSHROOM, 20, 27.5], [2, 2.5, 3.5]] as Array<[number, number, number]>) Object.assign(lineOf(id, p), { x_purchase_price: buy, x_final_net: fin });
  // § 62 د — «⬇️ PDF لي فقط» gave its place to «👁️ معاينة PDF»: the same page as a draft, nothing recorded
  const r = await quiet(() => QT.previewSpecialQuotation(env, id));
  assert("«👁️ معاينة PDF» built one file, and recorded nothing", !!r && "pdf" in r && sent.length === 1 && saleOrders().length === 0, JSON.stringify(r && "refused" in r ? r : null));
  const html = sent[0] ?? ""; pages.push(html);
  const p = parties(html);
  assert("its «من» is the company row of Odoo: name, address, e-mail, phone", p.fromLabel === "من / FROM" && same(p.from, [NAME, "8141 شارع الأمير محمد بن عبدالرحمن بن عبدالعزيز، حي السلي، الرياض", CONTACT]), JSON.stringify(p.from));
  assert("its customer block is «إلى / TO» with the customer's name", p.toLabel === "إلى / TO" && p.to[0] === "شركة مدارات للاغذية" && !html.includes("فاتورة إلى"), JSON.stringify(p));
  assert("the VAT number once, and the page is the one «قبل الضريبة»", count(html, VAT) === 1 && html.includes(QT.NET_SUBTOTAL_LABEL) && html.includes(QT.NET_VAT_LABEL));
  assert("nothing went to anyone", sentTo(MADARAT_PHONE).length === 0 && (await quiet(() => SQ.readQuote(env, id)))!.priceMode === "net");
  globalThis.fetch = kitFetch;
}

console.log("\n[و] the wrong address is gone");
{
  assert("no page rendered here carries it", pages.length > 20 && pages.every((h) => !h.includes(WRONG)), String(pages.length));
  // src/, scripts/ (its own files and lib/; artifacts/ and archive/ are records of what was), docs/templates/, tests/
  const walk = (dir: string, deep: boolean): string[] => !existsSync(dir) ? [] : readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? (deep ? walk(f, true) : []) : [f];
  });
  const files = [...walk(join(root, "src"), true), ...walk(join(root, "scripts"), false), ...walk(join(root, "scripts/lib"), true), ...walk(join(root, "scripts/mutation"), true), ...walk(join(root, "docs/templates"), true), ...walk(join(root, "tests"), false)]
    .filter((f) => /\.(ts|mts|mjs|js|json|html|md|toml)$/.test(f));
  const hits = files.filter((f) => readFileSync(f, "utf8").includes(WRONG)).map((f) => f.slice(root.length));
  assert("no file of src/, scripts/, docs/templates/ or tests/ carries it", files.length > 300 && hits.length === 0, hits.join(", ") || String(files.length));
}

done();
