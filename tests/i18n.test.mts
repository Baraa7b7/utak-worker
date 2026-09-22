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

// ---------- summary ----------
console.log(`\n${failed === 0 ? "OK" : "FAIL"} — ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
