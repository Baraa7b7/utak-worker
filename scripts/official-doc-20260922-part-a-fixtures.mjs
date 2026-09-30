// Part A fixture generator — renders all six doc types (invoice, quotation,
// receipt, delivery-note, purchase-order, official-doc) twice: once with the
// company info absent (before / byte-parity baseline) and once with the
// company info present (after / current prod behavior with the legal footer).
//
// For each pair it writes:
//   - <doc>.no-company.html + .pdf + .png
//   - <doc>.with-company.html + .pdf + .png
//   - <doc>.diff.txt (line-level diff, expected to be confined to the
//     legal-footer strip block)
// PLUS an "ar-snapshot" copy of every with-company HTML, which becomes the
// byte-for-byte reference the Part B `mode=ar` output must match.
//
// Runs LOCAL only — imports src/*.ts under experimental-strip-types, calls
// the real Gotenberg endpoint for PDFs, then pdftoppm/sips for PNGs.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Reuse the project's TS loader so extension-less "./config" imports resolve.
register(new URL("../tests/loader.mjs", import.meta.url));

const {
  renderInvoiceHTML,
  TEST_INVOICE_DATA,
} = await import("../src/invoice.ts");
const {
  renderQuotationHTML,
  TEST_QUOTATION_DATA,
} = await import("../src/quotation.ts");
const {
  renderReceiptHTML,
  TEST_RECEIPT_DATA,
} = await import("../src/receipt.ts");
const {
  renderDeliveryNoteHTML,
  TEST_DELIVERY_NOTE_DATA,
} = await import("../src/delivery-note.ts");
const {
  renderPurchaseOrderHTML,
  TEST_PURCHASE_ORDER_DATA,
} = await import("../src/purchase-order.ts");
const {
  renderOfficialDocHTML,
} = await import("../src/official-doc.ts");

// Fixture CompanyInfo — vaguely realistic but NOT real data. The values
// exercise every field so the footer is fully populated in the with-company
// snapshot.
const FIXTURE_COMPANY = {
  nameAr: "UTAK — يو تاك",
  nameEn: "UTAK",
  address: "الرياض، المملكة العربية السعودية",
  email: "care@utak.example",
  phone: "+966 58 004 0467",
  cr: "1010000000",
  vat: "300000000000003",
};

const OUT_DIR = new URL("./artifacts/part-a-fixtures/", import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

// Gotenberg env: try .env.zatca-oneoff (populated), else skip PDF/PNG.
let gotenberg = null;
try {
  const zatcaPath = new URL("../.env.zatca-oneoff", import.meta.url);
  const zatca = Object.fromEntries(
    readFileSync(zatcaPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  if (zatca.GOTENBERG_URL && zatca.GOTENBERG_USER && zatca.GOTENBERG_PASSWORD) {
    gotenberg = zatca;
  }
} catch { /* env missing — skip PDF/PNG */ }

async function htmlToPdf(html) {
  if (!gotenberg) return null;
  const fd = new FormData();
  fd.append("files", new Blob([html], { type: "text/html" }), "index.html");
  fd.append("paperWidth", "8.27");
  fd.append("paperHeight", "11.69");
  fd.append("marginTop", "0");
  fd.append("marginBottom", "0");
  fd.append("marginLeft", "0");
  fd.append("marginRight", "0");
  fd.append("printBackground", "true");
  fd.append("waitDelay", "2s");
  const auth = "Basic " + Buffer.from(`${gotenberg.GOTENBERG_USER}:${gotenberg.GOTENBERG_PASSWORD}`).toString("base64");
  const res = await fetch(`${gotenberg.GOTENBERG_URL}/forms/chromium/convert/html`, {
    method: "POST",
    headers: { Authorization: auth },
    body: fd,
  });
  if (!res.ok) {
    console.log(`[gotenberg] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
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

// Anchor for the legal footer strip in the additive shell:
// "<div style=\"height: 8px;\"></div>\n    <div style=\"...\">line1</div>\n    <div style=\"...\">line2</div>"
const LEGAL_STRIP_ANCHOR = "8.5px";

function pinpointDiff(before, after) {
  // Line-by-line diff: return the first offset where they differ + a window.
  if (before === after) return { equal: true };
  let i = 0;
  while (i < Math.min(before.length, after.length) && before[i] === after[i]) i++;
  const beforeWin = before.slice(Math.max(0, i - 60), i + 200);
  const afterWin = after.slice(Math.max(0, i - 60), i + 200);
  return { equal: false, offset: i, beforeWin, afterWin };
}

async function processDoc(label, htmlNo, htmlWith, description) {
  console.log(`\n--- ${label} (${description}) ---`);
  const paths = {
    htmlNo: `${OUT_DIR}${label}.no-company.html`,
    htmlWith: `${OUT_DIR}${label}.with-company.html`,
    diffTxt: `${OUT_DIR}${label}.diff.txt`,
    pdfNo: `${OUT_DIR}${label}.no-company.pdf`,
    pdfWith: `${OUT_DIR}${label}.with-company.pdf`,
    pngNoPrefix: `${OUT_DIR}${label}.no-company`,
    pngWithPrefix: `${OUT_DIR}${label}.with-company`,
    arSnapshot: `${OUT_DIR}${label}.ar-snapshot.html`,
  };
  writeFileSync(paths.htmlNo, htmlNo);
  writeFileSync(paths.htmlWith, htmlWith);
  // The `with-company` HTML in Part A IS the mode=ar output Part B must
  // reproduce byte-for-byte.
  writeFileSync(paths.arSnapshot, htmlWith);

  const d = pinpointDiff(htmlNo, htmlWith);
  const diffTxt = d.equal
    ? "IDENTICAL — no change (unexpected for docs receiving the footer)"
    : `first difference at offset ${d.offset}\n\n--- before ---\n${d.beforeWin}\n\n--- after ---\n${d.afterWin}`;
  writeFileSync(paths.diffTxt, diffTxt);
  const containsAnchor = htmlWith.includes(LEGAL_STRIP_ANCHOR) && !htmlNo.includes(LEGAL_STRIP_ANCHOR);
  console.log(`  diff anchor '${LEGAL_STRIP_ANCHOR}' delta-only? ${containsAnchor ? "YES" : "NO — investigate"}`);

  // Confirm the whole delta consists of a single insertion + no removal.
  // Compare non-legal-footer segments byte-for-byte.
  const stripLegalBlock = (h) => {
    // Match: (optional leading whitespace) <div height:8px><div 8.5px>...</div> [1..3]
    // The block always begins with the 8px spacer inserted just above the strip.
    // Then normalize all whitespace-only line runs so the empty-interpolation
    // shape (`\n    \n    `) matches the shape after we strip the bar out.
    let stripped = h.replace(
      /\n\s*<div style="height: 8px;"><\/div>(?:\n\s*<div style="text-align: center; font-size: 8\.5px[^"]*"[^>]*>[\s\S]*?<\/div>){1,3}/g,
      "",
    );
    // Collapse any run of whitespace-only lines to a single \n.
    stripped = stripped.replace(/\n[ \t]*(?=\n)/g, "");
    return stripped;
  };
  const noStripped = stripLegalBlock(htmlNo);
  const withStripped = stripLegalBlock(htmlWith);
  const cleanEq = noStripped === withStripped;
  console.log(`  after removing legal-footer block, remainder equal? ${cleanEq ? "YES" : "NO"}`);
  if (!cleanEq) {
    // Locate first residual difference for the report.
    let j = 0;
    while (j < Math.min(noStripped.length, withStripped.length) && noStripped[j] === withStripped[j]) j++;
    writeFileSync(paths.diffTxt + ".residual",
      `residual diff at offset ${j}\n\n--- no-company (stripped) ---\n${noStripped.slice(Math.max(0, j - 60), j + 200)}\n\n--- with-company (stripped) ---\n${withStripped.slice(Math.max(0, j - 60), j + 200)}`);
  }

  if (gotenberg) {
    const pdfNo = await htmlToPdf(htmlNo);
    if (pdfNo) writeFileSync(paths.pdfNo, pdfNo);
    const pdfWith = await htmlToPdf(htmlWith);
    if (pdfWith) writeFileSync(paths.pdfWith, pdfWith);
    if (pdfNo) pdfToPng(paths.pdfNo, paths.pngNoPrefix);
    if (pdfWith) pdfToPng(paths.pdfWith, paths.pngWithPrefix);
    console.log(`  wrote ${label}.no-company.pdf and ${label}.with-company.pdf + PNGs`);
  } else {
    console.log("  [gotenberg not configured — skipping PDF/PNG]");
  }

  return { label, deltaOnlyInFooter: containsAnchor && cleanEq };
}

// Fixture #1: 13+ items — dense metrics kick in.
const denseItems = Array.from({ length: 15 }, (_, i) => ({
  name: `صنف اختبار ${i + 1}`,
  pack: "كرتون ٥ كجم",
  qty: 3 + (i % 4),
  price: 20 + i,
  total: (3 + (i % 4)) * (20 + i),
}));
const denseInvoiceData = {
  ...TEST_INVOICE_DATA,
  items: denseItems,
  subtotal: denseItems.reduce((a, b) => a + b.total, 0),
  discount: 0,
  vatAmount: 0,
  grandTotal: denseItems.reduce((a, b) => a + b.total, 0),
};

// Fixture #2: page-overflow items — 40 items to force a two-page invoice.
const overflowItems = Array.from({ length: 40 }, (_, i) => ({
  name: `صنف طويل ${i + 1} — ${"تفاصيل ".repeat(3)}`,
  pack: "كرتون",
  qty: 1 + i,
  price: 15 + (i % 30),
  total: (1 + i) * (15 + (i % 30)),
}));
const overflowInvoiceData = {
  ...TEST_INVOICE_DATA,
  items: overflowItems,
  subtotal: overflowItems.reduce((a, b) => a + b.total, 0),
  discount: 0,
  vatAmount: 0,
  grandTotal: overflowItems.reduce((a, b) => a + b.total, 0),
};

// Official-doc fixture record: use a minimal in-memory record.
const officialRecord = {
  id: 999,
  name: "UTAK-L-2026-999",
  doc_type: "letter",
  recipient: "بنك الاختبار",
  recipient_label: "إلى",
  subject: "طلب فتح حساب",
  date: new Date("2026-09-22T09:00:00Z"),
  status: "issued",
  ai_prompt: "",
  blocks: [
    { sequence: 10, block_type: "paragraph", text: "هذا نص تجريبي للاختبار.", tone: "neutral", align_numbers: false },
  ],
  is_template: false,
  template_name: "",
};

async function main() {
  const results = [];
  results.push(await processDoc(
    "invoice",
    renderInvoiceHTML(TEST_INVOICE_DATA),
    renderInvoiceHTML(TEST_INVOICE_DATA, FIXTURE_COMPANY),
    "5 items — standard",
  ));
  results.push(await processDoc(
    "invoice-dense",
    renderInvoiceHTML(denseInvoiceData),
    renderInvoiceHTML(denseInvoiceData, FIXTURE_COMPANY),
    "15 items — dense metrics",
  ));
  results.push(await processDoc(
    "invoice-overflow",
    renderInvoiceHTML(overflowInvoiceData),
    renderInvoiceHTML(overflowInvoiceData, FIXTURE_COMPANY),
    "40 items — page overflow",
  ));
  results.push(await processDoc(
    "quotation",
    renderQuotationHTML(TEST_QUOTATION_DATA),
    renderQuotationHTML(TEST_QUOTATION_DATA, FIXTURE_COMPANY),
    "standard",
  ));
  results.push(await processDoc(
    "receipt",
    renderReceiptHTML(TEST_RECEIPT_DATA),
    renderReceiptHTML(TEST_RECEIPT_DATA, FIXTURE_COMPANY),
    "standard",
  ));
  results.push(await processDoc(
    "delivery-note",
    renderDeliveryNoteHTML(TEST_DELIVERY_NOTE_DATA),
    renderDeliveryNoteHTML(TEST_DELIVERY_NOTE_DATA, FIXTURE_COMPANY),
    "standard",
  ));
  results.push(await processDoc(
    "purchase-order",
    renderPurchaseOrderHTML(TEST_PURCHASE_ORDER_DATA),
    renderPurchaseOrderHTML(TEST_PURCHASE_ORDER_DATA, FIXTURE_COMPANY),
    "standard",
  ));

  // Official doc — it already emits a legal footer via readCompanyInfo (in
  // Part A this file's diff shows no-company vs with-company as identical
  // when readCompanyInfo returns the empty defaults).
  results.push(await processDoc(
    "official-doc",
    renderOfficialDocHTML({ record: officialRecord, company: { nameAr: "", nameEn: "", address: "", email: "", phone: "", cr: "", vat: "" }, isPreview: false }),
    renderOfficialDocHTML({ record: officialRecord, company: FIXTURE_COMPANY, isPreview: false }),
    "letter with 1 block",
  ));

  console.log("\n=== Delta check summary ===");
  for (const r of results) {
    console.log(`  ${r.label}: delta confined to footer? ${r.deltaOnlyInFooter ? "YES" : "NO"}`);
  }
  const anyBad = results.some((r) => !r.deltaOnlyInFooter);
  if (anyBad) {
    console.log("\n!!! At least one doc has an unexpected delta. Inspect the .diff.txt files.");
    process.exit(2);
  }
  console.log("\nAll docs: delta confined to the legal-footer strip. ✅");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
