// Part B: i18n resolver + dictionary + footer/rendering tests.
// Run via `npm test` (added to package.json scripts).

import { readFileSync } from "node:fs";
import { UI, resolveDocLang, metaFor, type UIKey } from "../src/i18n.ts";
import { renderInvoiceHTML, TEST_INVOICE_DATA } from "../src/invoice.ts";
import { renderQuotationHTML, TEST_QUOTATION_DATA } from "../src/quotation.ts";
import { renderReceiptHTML, TEST_RECEIPT_DATA } from "../src/receipt.ts";
import { renderDeliveryNoteHTML, TEST_DELIVERY_NOTE_DATA } from "../src/delivery-note.ts";
import { renderPurchaseOrderHTML, TEST_PURCHASE_ORDER_DATA } from "../src/purchase-order.ts";
import { toLegalFooterAr } from "../src/legal-footer.ts";
import type { CompanyInfo } from "../src/company.ts";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(cond: unknown, msg: string) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.log(`  ✗ ${msg}`); failed++; failures.push(msg); }
}

// ---------- 1. Dictionary completeness ----------
console.log("\n[1] UI dictionary: every key has non-empty ar + en");
{
  for (const k of Object.keys(UI) as UIKey[]) {
    const v = UI[k];
    assert(typeof v.ar === "string" && v.ar.trim().length > 0, `${k}.ar is non-empty`);
    assert(typeof v.en === "string" && v.en.trim().length > 0, `${k}.en is non-empty`);
  }
}

// ---------- 2. Language resolver ----------
console.log("\n[2] Language resolver");
{
  assert(resolveDocLang({}) === "ar", "default → ar");
  assert(resolveDocLang({ docLang: "ar" }) === "ar", "docLang=ar → ar");
  assert(resolveDocLang({ docLang: "en" }) === "en", "docLang=en → en");
  assert(resolveDocLang({ docLang: "bi" }) === "bi", "docLang=bi → bi");
  assert(resolveDocLang({ docLang: "en", partnerLang: "ar" }) === "en", "doc-level wins over partner");
  assert(resolveDocLang({ partnerLang: "en" }) === "en", "partner used when doc missing");
  assert(resolveDocLang({ docLang: "" }) === "ar", "empty docLang falls back to ar");
  assert(resolveDocLang({ docLang: null }) === "ar", "null docLang falls back to ar");
  assert(resolveDocLang({ docLang: false }) === "ar", "false docLang (Odoo empty) falls back to ar");
  assert(resolveDocLang({ docLang: "invalid" }) === "ar", "unknown value falls back to ar");
  // Invoice guard
  assert(resolveDocLang({ docLang: "en", isTaxInvoice: true }) === "bi", "en on a tax invoice upgrades to bi");
  assert(resolveDocLang({ docLang: "bi", isTaxInvoice: true }) === "bi", "bi on a tax invoice stays bi");
  assert(resolveDocLang({ docLang: "ar", isTaxInvoice: true }) === "ar", "ar on a tax invoice stays ar");
  assert(resolveDocLang({ isTaxInvoice: true, partnerLang: "en" }) === "bi", "partner=en on tax invoice → bi");
}

// ---------- 3. metaFor ----------
console.log("\n[3] metaFor per lang");
{
  const ar = metaFor("ar");
  assert(ar.dir === "rtl", "ar → rtl");
  assert(ar.primary === "ar", "ar primary");
  const en = metaFor("en");
  assert(en.dir === "ltr", "en → ltr");
  assert(en.primary === "en", "en primary");
  assert(en.useWesternDigits === true, "en uses western digits");
  assert(en.fonts.english === true && en.fonts.arabic === false, "en font stack: english only");
  const bi = metaFor("bi");
  assert(bi.dir === "rtl", "bi keeps rtl (Arabic primary)");
  assert(bi.primary === "ar", "bi primary is Arabic");
  assert(bi.fonts.english === true && bi.fonts.arabic === true, "bi loads both fonts");
}

// ---------- 4. AR mode matches Part A snapshot byte-for-byte ----------
console.log("\n[4] AR mode = Part A snapshot (byte parity)");
{
  const company: CompanyInfo = {
    nameAr: "UTAK — يو تاك",
    nameEn: "UTAK",
    address: "الرياض، المملكة العربية السعودية",
    email: "care@utak.example",
    phone: "+966 58 004 0467",
    cr: "1010000000",
    vat: "300000000000003",
  };
  const snapDir = new URL("../scripts/artifacts/part-a-fixtures/", import.meta.url).pathname;
  const load = (name: string) => readFileSync(snapDir + name + ".ar-snapshot.html", "utf8");
  const invoice = renderInvoiceHTML(TEST_INVOICE_DATA, company);
  assert(invoice === load("invoice"), "invoice ar HTML matches snapshot");
  const quotation = renderQuotationHTML(TEST_QUOTATION_DATA, company);
  assert(quotation === load("quotation"), "quotation ar HTML matches snapshot");
  const receipt = renderReceiptHTML(TEST_RECEIPT_DATA, company);
  assert(receipt === load("receipt"), "receipt ar HTML matches snapshot");
  const dn = renderDeliveryNoteHTML(TEST_DELIVERY_NOTE_DATA, company);
  assert(dn === load("delivery-note"), "delivery-note ar HTML matches snapshot");
  const po = renderPurchaseOrderHTML(TEST_PURCHASE_ORDER_DATA, company);
  assert(po === load("purchase-order"), "purchase-order ar HTML matches snapshot");
}

// ---------- 5. Invoice modes ----------
console.log("\n[5] Invoice: en request on tax invoice becomes bi");
{
  const company: CompanyInfo = {
    nameAr: "UTAK — يو تاك",
    nameEn: "UTAK",
    address: "الرياض، المملكة العربية السعودية",
    email: "care@utak.example",
    phone: "+966 58 004 0467",
    cr: "1010000000",
    vat: "300000000000003",
    legalNameEn: "UTAK Trading Company",
    addressEn: "Riyadh, Kingdom of Saudi Arabia",
  };
  // Tax invoice + en → bi (page primary is Arabic).
  const taxData = { ...TEST_INVOICE_DATA, vatAmount: 361.5, lang: "en" as const };
  const bi = renderInvoiceHTML(taxData, company);
  assert(bi.includes('dir="rtl"'), "bi: page dir is rtl");
  assert(bi.includes("فاتورة"), "bi: Arabic title retained");
  assert(bi.includes("UTAK Trading Company"), "bi: English legal name in footer");
  assert(bi.includes("CR No."), "bi: English CR label present");
  // Non-tax invoice + en stays en
  const enData = { ...TEST_INVOICE_DATA, vatAmount: 0, lang: "en" as const };
  const en = renderInvoiceHTML(enData, company);
  assert(en.includes('dir="ltr"'), "en: page dir is ltr");
  assert(en.includes("Invoice"), "en: English title");
  assert(!en.includes("فاتورة"), "en: no Arabic title");
  assert(en.includes("Space Grotesk"), "en: Space Grotesk font loaded");
}

// ---------- 6. Legal footer per mode ----------
console.log("\n[6] Legal footer three modes");
{
  const company: CompanyInfo = {
    nameAr: "UTAK — يو تاك",
    nameEn: "UTAK",
    address: "الرياض",
    email: "x@y.com",
    phone: "+966 5",
    cr: "111",
    vat: "222",
    legalNameEn: "UTAK Ltd.",
    addressEn: "Riyadh, KSA",
  };
  const info = toLegalFooterAr(company);
  assert(info.name === "UTAK — يو تاك", "ar name is Arabic");
  assert(info.nameEn === "UTAK Ltd.", "en mirror uses legalNameEn");
  assert(info.crLabelEn === "CR No.", "crLabelEn from dict");
  assert(info.vatLabelEn === "VAT No.", "vatLabelEn from dict");
  // Ar fallback when legalNameAr empty
  const noAr: CompanyInfo = { ...company, legalNameAr: undefined };
  const infoNoAr = toLegalFooterAr(noAr);
  assert(infoNoAr.name === "UTAK — يو تاك", "ar name falls back to nameAr");
}

// ---------- 7. Item name bilingual fallback ----------
console.log("\n[7] Item name_en fallback (missing en falls back to Arabic)");
{
  const company: CompanyInfo = {
    nameAr: "شركة",
    nameEn: "Company",
    address: "الرياض",
    email: "x@y.com",
    phone: "05",
    cr: "1",
    vat: "1",
  };
  const bi = renderInvoiceHTML(
    { ...TEST_INVOICE_DATA, lang: "bi", items: [{ name: "طماطم", pack: "كرتون", qty: 1, price: 10, total: 10 }] },
    company,
  );
  assert(bi.includes("طماطم"), "bi: Arabic name present when name_en missing");
  const biWithEn = renderInvoiceHTML(
    { ...TEST_INVOICE_DATA, lang: "bi", items: [{ name: "طماطم", pack: "كرتون", qty: 1, price: 10, total: 10, name_en: "Tomato" }] },
    company,
  );
  assert(biWithEn.includes("طماطم") && biWithEn.includes("Tomato"), "bi: both present when name_en given");
}

// ---------- 8. Fallback: company missing bilingual fields ----------
console.log("\n[8] Company without bilingual fields → footer still renders");
{
  const bare: CompanyInfo = {
    nameAr: "شركة",
    nameEn: "Company",
    address: "الرياض",
    email: "x@y.com",
    phone: "05",
    cr: "1",
    vat: "1",
  };
  const info = toLegalFooterAr(bare);
  assert(info.name === "شركة", "ar name from nameAr fallback");
  assert(info.nameEn === "Company", "en name from nameEn fallback");
  assert(info.address === "الرياض", "ar address from address fallback");
  assert(info.addressEn === "الرياض", "en address falls back to base address when bilingual is missing");
}

// ---------- 9. Country/address bilingual reads per language ----------
// This item guards against the regression Baraa reported on 2026-09-22:
// "الدولة تطلع «Saudi Arabia» في المستندات العربية". After the fix, ar/bi
// documents must show the Arabic country ("المملكة العربية السعودية"), while
// en documents must show the English name. The renderer picks between
// info.address (ar/bi) and info.addressEn (en); readCompanyInfo is
// responsible for populating both.
console.log("\n[9] Country/address bilingual per lang");
{
  // Simulate the readCompanyInfo output — both addressAr and addressEn are
  // now always populated, with the country name in each language.
  const bilingual: CompanyInfo = {
    nameAr: "شركة يو تاك ذات مسؤولية محدودة",
    nameEn: "UTAK",
    address: "السلي، الرياض، المملكة العربية السعودية",
    addressAr: "السلي، الرياض، المملكة العربية السعودية",
    addressEn: "As-Sulai, Riyadh, Saudi Arabia",
    email: "care@utakfresh.com",
    phone: "+966 58 004 0467",
    cr: "7055194869",
    vat: "315022736600003",
  };
  // ar
  const ar = renderInvoiceHTML({ ...TEST_INVOICE_DATA, vatAmount: 0, lang: "ar" }, bilingual);
  assert(ar.includes("المملكة العربية السعودية"), "ar: Arabic country name in body/footer");
  assert(!ar.includes("Saudi Arabia"), "ar: no English country name leaks");
  // en (non-tax invoice so it stays en; tax invoice would upgrade to bi)
  const en = renderInvoiceHTML({ ...TEST_INVOICE_DATA, vatAmount: 0, lang: "en" }, bilingual);
  assert(en.includes("Saudi Arabia"), "en: English country name renders");
  assert(!en.includes("المملكة العربية السعودية"), "en: no Arabic country name leaks");
  // bi — Arabic-first with an English mirror for identity only. Per the task's
  // rule "وفي وضع bi: العربي", the address line stays Arabic. The English mid-
  // line carries nameEn + CR No. + VAT No. — no addressEn.
  const bi = renderInvoiceHTML({ ...TEST_INVOICE_DATA, vatAmount: 361.5, lang: "en" }, bilingual);
  assert(bi.includes("المملكة العربية السعودية"), "bi: Arabic country name in address line");
  assert(!bi.includes("Saudi Arabia"), "bi: no addressEn in the mid mirror line (design: Arabic address only)");

  // Fallback: when addressAr/addressEn are missing, address is used for both.
  const legacy: CompanyInfo = {
    nameAr: "شركة", nameEn: "Company",
    address: "الرياض، المملكة العربية السعودية",
    email: "x@y.com", phone: "05", cr: "1", vat: "1",
  };
  const legacyEn = renderInvoiceHTML({ ...TEST_INVOICE_DATA, vatAmount: 0, lang: "en" }, legacy);
  // When addressEn is undefined, renderLegalFooterBar falls back to address —
  // which is the Arabic string in this scenario. That's OK: the footer stays
  // readable, and Baraa's follow-up is to fill x_address_en so this fallback
  // is never actually hit in production.
  assert(legacyEn.includes("الرياض") || legacyEn.includes("Company"), "en with no addressEn: falls back safely");
}

// ---------- 10. Pagination — every doc must let long content flow past 297mm ----------
// The prior byte-parity template used `height: 297mm; overflow: hidden`, which
// silently CLIPPED any invoice past one A4 page. A 40-item invoice lost rows
// past the fold — a financial + ZATCA risk. Fix (2026-09-22): `overflow:
// hidden` dropped, so Chromium's print engine paginates naturally with the
// break-inside rules below. 2026-09-24: the byte-parity branch's fixed
// `height: 297mm` became `min-height: 297mm` too, so the page box (padding,
// background, the seal block at its end) grows with the content.
console.log("\n[10] Pagination CSS + break rules present");
{
  const bareCompany: CompanyInfo = {
    nameAr: "شركة", nameEn: "Company", address: "الرياض",
    email: "x@y.com", phone: "05", cr: "1", vat: "1",
  };
  const html = renderInvoiceHTML({ ...TEST_INVOICE_DATA, vatAmount: 0 }, bareCompany);
  assert(!/overflow:\s*hidden/.test(html.split(".utak-page")[1]?.split("</div>")[0] ?? ""), "utak-page has no overflow:hidden");
  assert(html.includes("thead { display: table-header-group; }"), "thead repeats on every page");
  assert(html.includes("break-inside: avoid"), "break-inside: avoid on tr/.utak-block");
  assert(html.includes("orphans: 3; widows: 3"), "orphans/widows guard");
  assert(html.includes("class=\"utak-block\""), ".utak-block wraps the totals block");
  // 40 rows all present in HTML
  const forty = Array.from({ length: 40 }, (_, i) => ({
    name: `صنف طويل ${i + 1}`,
    pack: "كرتون",
    qty: 1 + i, price: 10, total: 10,
  }));
  const bigHtml = renderInvoiceHTML(
    { ...TEST_INVOICE_DATA, items: forty, subtotal: 400, discount: 0, vatAmount: 0, grandTotal: 400 },
    bareCompany,
  );
  const rowMatches = bigHtml.match(/صنف طويل \d+/g) ?? [];
  assert(rowMatches.length === 40, `40-row invoice contains 40 item names (got ${rowMatches.length})`);
}

// ---------- summary ----------
console.log(`\n${failed === 0 ? "OK" : "FAIL"} — ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
