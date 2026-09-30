// Part B fixture generator — every doc × every allowed language mode.
//
// Modes per doc:
//   invoice        : ar, bi   (and asserts en → bi via the tax-invoice guard)
//   quotation      : ar, en
//   receipt        : ar, en
//   delivery-note  : ar, en
//   purchase-order : ar, en
//   official-doc   : ar, en   (no bi for official docs)
//
// Also covers edge cases:
//   invoice bi with 15 items (dense)
//   item without name_en (bi mode) → Arabic-only fallback
//   company without bilingual fields → footer still valid
//   en official doc exceeding a page (many blocks) → the additive path
//     multi-page mode paginates naturally.
//
// Writes HTML + PDF + PNG per case to scripts/artifacts/part-b-fixtures/.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { register } from "node:module";

register(new URL("../tests/loader.mjs", import.meta.url));

const { renderInvoiceHTML, TEST_INVOICE_DATA } = await import("../src/invoice.ts");
const { renderQuotationHTML, TEST_QUOTATION_DATA } = await import("../src/quotation.ts");
const { renderReceiptHTML, TEST_RECEIPT_DATA } = await import("../src/receipt.ts");
const { renderDeliveryNoteHTML, TEST_DELIVERY_NOTE_DATA } = await import("../src/delivery-note.ts");
const { renderPurchaseOrderHTML, TEST_PURCHASE_ORDER_DATA } = await import("../src/purchase-order.ts");
const { renderOfficialDocHTML } = await import("../src/official-doc.ts");

const FIXTURE_COMPANY = {
  nameAr: "UTAK — يو تاك",
  nameEn: "UTAK",
  address: "الرياض، المملكة العربية السعودية",
  email: "care@utak.example",
  phone: "+966 58 004 0467",
  cr: "1010000000",
  vat: "300000000000003",
  legalNameAr: "شركة يو تاك للتجارة",
  legalNameEn: "UTAK Trading Company",
  addressAr: "الرياض، المملكة العربية السعودية",
  addressEn: "Riyadh, Kingdom of Saudi Arabia",
};
const COMPANY_BARE = {
  nameAr: "UTAK — يو تاك",
  nameEn: "UTAK",
  address: "الرياض",
  email: "care@utak.example",
  phone: "+966 58 004 0467",
  cr: "1010000000",
  vat: "300000000000003",
};

const OUT_DIR = new URL("./artifacts/part-b-fixtures/", import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

let gotenberg = null;
try {
  const zatcaPath = new URL("../.env.zatca-oneoff", import.meta.url);
  const zatca = Object.fromEntries(
    readFileSync(zatcaPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  if (zatca.GOTENBERG_URL && zatca.GOTENBERG_USER && zatca.GOTENBERG_PASSWORD) gotenberg = zatca;
} catch {}

async function htmlToPdf(html) {
  if (!gotenberg) return null;
  const fd = new FormData();
  fd.append("files", new Blob([html], { type: "text/html" }), "index.html");
  fd.append("paperWidth", "8.27");
  fd.append("paperHeight", "11.69");
  fd.append("marginTop", "0"); fd.append("marginBottom", "0");
  fd.append("marginLeft", "0"); fd.append("marginRight", "0");
  fd.append("printBackground", "true");
  fd.append("waitDelay", "2s");
  const auth = "Basic " + Buffer.from(`${gotenberg.GOTENBERG_USER}:${gotenberg.GOTENBERG_PASSWORD}`).toString("base64");
  const res = await fetch(`${gotenberg.GOTENBERG_URL}/forms/chromium/convert/html`, {
    method: "POST", headers: { Authorization: auth }, body: fd,
  });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

function pdfToPng(pdfPath, pngPrefix) {
  if (spawnSync("which", ["pdftoppm"]).status === 0) {
    execFileSync("pdftoppm", ["-r", "120", "-png", pdfPath, pngPrefix], { stdio: "inherit" });
    return "pdftoppm";
  }
  if (spawnSync("which", ["sips"]).status === 0) {
    execFileSync("sips", ["-s", "format", "png", pdfPath, "--out", `${pngPrefix}-1.png`], { stdio: "inherit" });
    return "sips";
  }
  return null;
}

async function render(label, html) {
  const htmlPath = `${OUT_DIR}${label}.html`;
  writeFileSync(htmlPath, html);
  if (gotenberg) {
    const pdf = await htmlToPdf(html);
    if (pdf) {
      const pdfPath = `${OUT_DIR}${label}.pdf`;
      writeFileSync(pdfPath, pdf);
      pdfToPng(pdfPath, `${OUT_DIR}${label}`);
    }
  }
  console.log(`  wrote ${label}`);
  return html;
}

const denseItems = Array.from({ length: 15 }, (_, i) => ({
  name: `صنف اختبار ${i + 1}`,
  name_en: `Test Item ${i + 1}`,
  pack: "كرتون · 5 كيلو",
  pack_en: "Carton · 5 kg",
  qty: 3 + (i % 4),
  price: 20 + i,
  total: (3 + (i % 4)) * (20 + i),
}));

// Sample bilingual invoice items for a normal invoice.
function withBilingual(items) {
  const map = {
    "طماطم شيري كرزية درجة أولى": "Cherry Tomatoes (Grade 1)",
    "خيار بلدي": "Local Cucumber",
    "خس آيسبرغ": "Iceberg Lettuce",
    "بطاطس": "Potato",
    "ليمون بلدي": "Local Lemon",
    "بقدونس طازج": "Fresh Parsley",
    "جزر": "Carrot",
    "فلفل رومي ملون": "Colored Bell Pepper",
  };
  const packMap = {
    "كرتون ٨ كجم": "Carton · 8 kg",
    "كرتون ٥ كجم": "Carton · 5 kg",
    "كرتون ١٢ حبة": "Carton · 12 units",
    "كيس ٢٥ كجم": "Bag · 25 kg",
    "كرتون ١٠ كجم": "Carton · 10 kg",
    "ربطة × ٢٠": "Bundle × 20",
    "كيس ١٠ كجم": "Bag · 10 kg",
  };
  return items.map((i) => ({ ...i, name_en: map[i.name] ?? "", pack_en: packMap[i.pack] ?? "" }));
}

async function main() {
  console.log("=== Part B fixtures ===");

  // ---------- Invoice ----------
  console.log("\ninvoice");
  const invAr = { ...TEST_INVOICE_DATA, items: withBilingual(TEST_INVOICE_DATA.items) };
  await render("invoice-ar", renderInvoiceHTML(invAr, FIXTURE_COMPANY));
  const invBi = { ...invAr, lang: "bi" };
  await render("invoice-bi", renderInvoiceHTML(invBi, FIXTURE_COMPANY));
  // Article 53 guard: passing lang="en" on a tax invoice must still produce bi.
  const invEnTax = { ...invAr, lang: "en", vatAmount: 361.5 };
  const enTaxHtml = renderInvoiceHTML(invEnTax, FIXTURE_COMPANY);
  const enTaxIsRTL = enTaxHtml.includes('dir="rtl"');
  await render("invoice-en-tax-forced-to-bi", enTaxHtml);
  console.log(`  en tax invoice forced to bi? ${enTaxIsRTL ? "YES" : "NO — investigate"}`);
  // Non-tax en works fine
  const invEnNoTax = { ...invAr, lang: "en", vatAmount: 0 };
  await render("invoice-en-nontax", renderInvoiceHTML(invEnNoTax, FIXTURE_COMPANY));
  // Dense bi
  await render("invoice-bi-dense", renderInvoiceHTML({ ...invAr, lang: "bi", items: denseItems, subtotal: denseItems.reduce((a, b) => a + b.total, 0), discount: 0, vatAmount: 0, grandTotal: denseItems.reduce((a, b) => a + b.total, 0) }, FIXTURE_COMPANY));
  // Fallback: item without name_en
  await render("invoice-bi-fallback-missing-name_en", renderInvoiceHTML({ ...TEST_INVOICE_DATA, lang: "bi" }, FIXTURE_COMPANY));
  // Fallback: bare company (no bilingual)
  await render("invoice-en-bare-company", renderInvoiceHTML({ ...invAr, lang: "en", vatAmount: 0 }, COMPANY_BARE));

  // ---------- Quotation ----------
  console.log("\nquotation");
  const qAr = { ...TEST_QUOTATION_DATA, items: withBilingual(TEST_QUOTATION_DATA.items) };
  await render("quotation-ar", renderQuotationHTML(qAr, FIXTURE_COMPANY));
  await render("quotation-en", renderQuotationHTML({ ...qAr, lang: "en" }, FIXTURE_COMPANY));

  // ---------- Receipt ----------
  console.log("\nreceipt");
  await render("receipt-ar", renderReceiptHTML(TEST_RECEIPT_DATA, FIXTURE_COMPANY));
  await render("receipt-en", renderReceiptHTML({ ...TEST_RECEIPT_DATA, lang: "en" }, FIXTURE_COMPANY));

  // ---------- Delivery note ----------
  console.log("\ndelivery-note");
  const dnAr = { ...TEST_DELIVERY_NOTE_DATA, items: withBilingual(TEST_DELIVERY_NOTE_DATA.items) };
  await render("delivery-note-ar", renderDeliveryNoteHTML(dnAr, FIXTURE_COMPANY));
  await render("delivery-note-en", renderDeliveryNoteHTML({ ...dnAr, lang: "en" }, FIXTURE_COMPANY));

  // ---------- Purchase order ----------
  console.log("\npurchase-order");
  const poAr = { ...TEST_PURCHASE_ORDER_DATA, items: withBilingual(TEST_PURCHASE_ORDER_DATA.items) };
  await render("purchase-order-ar", renderPurchaseOrderHTML(poAr, FIXTURE_COMPANY));
  await render("purchase-order-en", renderPurchaseOrderHTML({ ...poAr, lang: "en" }, FIXTURE_COMPANY));

  // ---------- Official doc ----------
  console.log("\nofficial-doc");
  const bank = {
    id: 1, name: "UTAK-L-2026-500",
    doc_type: "letter",
    recipient: "Riyad Bank", recipient_label: "To", subject: "Bank Account Opening",
    date: new Date("2026-09-22"), status: "issued", ai_prompt: "",
    blocks: [
      { sequence: 10, block_type: "heading", text: "Official Letter", tone: "neutral", align_numbers: true },
      { sequence: 20, block_type: "paragraph", text: "Dear Sir/Madam, this is a test document.", tone: "neutral", align_numbers: true },
      { sequence: 30, block_type: "signature", text: "Baraa Alwesabi\nManaging Director", tone: "neutral", align_numbers: true },
    ],
    is_template: false, template_name: "", lang: "en",
  };
  await render("official-doc-en-letter", renderOfficialDocHTML({ record: bank, company: FIXTURE_COMPANY, isPreview: false }));

  // A long English official doc → overflows one page (multiPageBreaks handles it).
  const longBlocks = [];
  for (let i = 1; i <= 20; i++) {
    longBlocks.push({ sequence: i * 10, block_type: "paragraph",
      text: `Paragraph ${i}: ${"content ".repeat(60)}`,
      tone: "neutral", align_numbers: true });
  }
  const longDoc = {
    id: 2, name: "UTAK-L-2026-501",
    doc_type: "letter",
    recipient: "Test Bank", recipient_label: "To", subject: "Long Document Test",
    date: new Date("2026-09-22"), status: "issued", ai_prompt: "",
    blocks: longBlocks, is_template: false, template_name: "", lang: "en",
  };
  await render("official-doc-en-long", renderOfficialDocHTML({ record: longDoc, company: FIXTURE_COMPANY, isPreview: false }));

  // ar official doc (parity with Part A)
  const arDoc = {
    id: 3, name: "UTAK-L-2026-502",
    doc_type: "letter",
    recipient: "بنك الاختبار", recipient_label: "إلى", subject: "خطاب اختبار",
    date: new Date("2026-09-22"), status: "issued", ai_prompt: "",
    blocks: [
      { sequence: 10, block_type: "heading", text: "خطاب رسمي", tone: "neutral", align_numbers: true },
      { sequence: 20, block_type: "paragraph", text: "هذا نص تجريبي.", tone: "neutral", align_numbers: true },
    ],
    is_template: false, template_name: "", lang: "ar",
  };
  await render("official-doc-ar-letter", renderOfficialDocHTML({ record: arDoc, company: FIXTURE_COMPANY, isPreview: false }));

  console.log("\nDone.");
}

main().catch((e) => { console.error("[fatal]", e.stack ?? e.message ?? e); process.exit(1); });
