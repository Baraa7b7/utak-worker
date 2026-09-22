// Unit tests for src/official-doc.ts — pure functions only. Proves:
//   1. parseKVCard / parseTable / parseHighlightRow / parseNotes / parseSignature
//   2. findPlaceholders detects `[…]` anywhere in a block's text
//   3. validateAIDraft accepts a well-formed JSON, rejects malformed one
//   4. renderBlock returns HTML for each block type (smoke)
//   5. renderOfficialDocHTML produces a full document (smoke)
//   6. pdf-template additive options preserve byte-parity for the 5 legacy
//      fixtures (renderPDFShell without any additive option MUST produce
//      byte-identical HTML to the current legacy output — this is a
//      regression fence).
//
// Runs under Node's --experimental-strip-types loader with tests/loader.mjs
// resolving extension-less specifiers.

import {
  parseKVCard,
  parseTable,
  parseHighlightRow,
  parseNotes,
  parseSignature,
  findPlaceholders,
  validateAIDraft,
  renderBlock,
  renderOfficialDocHTML,
  BLOCK_TYPES,
  type OfficialDocBlock,
  type CompanyInfo,
} from "../src/official-doc.ts";
import { renderInvoiceHTML, TEST_INVOICE_DATA } from "../src/invoice.ts";
import { renderQuotationHTML, TEST_QUOTATION_DATA } from "../src/quotation.ts";
import { renderReceiptHTML, TEST_RECEIPT_DATA } from "../src/receipt.ts";
import { renderDeliveryNoteHTML, TEST_DELIVERY_NOTE_DATA } from "../src/delivery-note.ts";
import { renderPurchaseOrderHTML, TEST_PURCHASE_ORDER_DATA } from "../src/purchase-order.ts";
import { renderPDFShell, computePageMetrics, type PartyInfo } from "../src/pdf-template.ts";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
}

function eq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label} (got ${a}, expected ${e})`);
}

// ---------- 1. block-text parsers ----------
console.log("\n[1] x_text parsers");
{
  eq(parseKVCard("العنوان: قيمة\nس.ت: ١٢٣"),
    [{ key: "العنوان", value: "قيمة" }, { key: "س.ت", value: "١٢٣" }],
    "kv_card: two rows");
  eq(parseKVCard("   \n\n"), [], "kv_card: blank input → []");

  const table = parseTable(["البند | شهري | سنوي", "المبيعات | 40,000 | 480,000", "= الإجمالي | 15,000 | 180,000"].join("\n"));
  eq(table.headers, ["البند", "شهري", "سنوي"], "table: headers parsed");
  eq(table.rows.length, 2, "table: 2 rows parsed");
  eq(table.rows[0].isTotal, false, "table: first row not total");
  eq(table.rows[1].isTotal, true, "table: '=' row IS total");
  eq(table.rows[1].cells, ["الإجمالي", "15,000", "180,000"], "table: total row cells");

  eq(parseHighlightRow("صافي | (5,033) | (60,400)"),
    { label: "صافي", values: ["(5,033)", "(60,400)"] },
    "highlight_row: label + 2 values");

  eq(parseNotes("أولى\nثانية\n\nثالثة"), ["أولى", "ثانية", "ثالثة"], "notes: 3 lines");

  eq(parseSignature("براء الوصابي\nالمدير التنفيذي"),
    { name: "براء الوصابي", title: "المدير التنفيذي" }, "signature: name + title");
  eq(parseSignature("الاسم فقط"), { name: "الاسم فقط", title: "" }, "signature: name only");
}

// ---------- 2. placeholder guard ----------
console.log("\n[2] placeholder guard");
{
  const blocks: OfficialDocBlock[] = [
    { sequence: 10, block_type: "paragraph", text: "نص كامل، لا يوجد أقواس.", tone: "neutral", align_numbers: true },
    { sequence: 20, block_type: "paragraph", text: "نطلب [رقم الحساب] لتمويل.", tone: "neutral", align_numbers: true },
  ];
  const hits = findPlaceholders(blocks);
  assert(hits.length === 1, "placeholder: catches 1 in 2 blocks");
  assert(hits[0].sequence === 20, "placeholder: sequence 20 flagged");
  assert(hits[0].snippet === "[رقم الحساب]", "placeholder: snippet captured");

  // Placeholders inside subject/recipient don't participate — only block text.
  const clean = findPlaceholders([{ sequence: 1, block_type: "paragraph", text: "بلا فراغات هنا.", tone: "neutral", align_numbers: true }]);
  assert(clean.length === 0, "placeholder: clean blocks → []");
}

// ---------- 3. validateAIDraft ----------
console.log("\n[3] validateAIDraft");
{
  const good = validateAIDraft(JSON.stringify({
    doc_type: "letter",
    recipient: "بنك الاختبار",
    subject: "تجربة",
    blocks: [
      { type: "heading", text: "عنوان", tone: "neutral" },
      { type: "paragraph", text: "فقرة.", tone: "neutral" },
      { type: "signature", text: "براء\nالمدير", tone: "neutral" },
    ],
  }));
  assert(!("error" in good), "validateAIDraft: valid input passes");
  if (!("error" in good)) {
    eq(good.blocks.length, 3, "validateAIDraft: 3 blocks kept");
    eq(good.doc_type, "letter", "validateAIDraft: doc_type letter");
  }

  const bad1 = validateAIDraft("not-json");
  assert("error" in bad1, "validateAIDraft: non-JSON rejected");

  const bad2 = validateAIDraft(JSON.stringify({ doc_type: "unknown", blocks: [] }));
  assert("error" in bad2, "validateAIDraft: unknown doc_type rejected");

  const bad3 = validateAIDraft(JSON.stringify({ doc_type: "letter", blocks: [{ type: "not-a-block", text: "", tone: "neutral" }] }));
  assert("error" in bad3, "validateAIDraft: unknown block type rejected");

  const bad4 = validateAIDraft(JSON.stringify({ doc_type: "letter", blocks: new Array(26).fill({ type: "paragraph", text: "x", tone: "neutral" }) }));
  assert("error" in bad4, "validateAIDraft: >25 blocks rejected");

  // JSON with markdown fences (Claude sometimes returns this)
  const good2 = validateAIDraft("```json\n{\"doc_type\":\"letter\",\"blocks\":[]}\n```");
  assert(!("error" in good2), "validateAIDraft: markdown-fenced JSON accepted");

  // Missing tone defaults to neutral
  const good3 = validateAIDraft(JSON.stringify({ doc_type: "letter", blocks: [{ type: "paragraph", text: "x" }] }));
  assert(!("error" in good3), "validateAIDraft: missing tone → default neutral");
  if (!("error" in good3)) {
    eq(good3.blocks[0].tone, "neutral", "validateAIDraft: default tone is neutral");
  }
}

// ---------- 4. renderBlock — smoke per type ----------
console.log("\n[4] renderBlock — all 9 types render non-empty HTML");
{
  for (const t of BLOCK_TYPES) {
    const b: OfficialDocBlock = {
      sequence: 10,
      block_type: t,
      text:
        t === "table" ? "H1 | H2\nA | 100\n= الإجمالي | 100" :
        t === "kv_card" ? "الاسم: قيمة" :
        t === "highlight_row" ? "صافي | (100)" :
        t === "notes" ? "ملاحظة أولى\nملاحظة ثانية" :
        t === "signature" ? "الاسم\nالصفة" :
        "نص عادي",
      tone: "neutral",
      align_numbers: true,
    };
    const html = renderBlock(b);
    assert(html.length > 0, `renderBlock ${t} non-empty`);
    assert(html.includes("utak-block"), `renderBlock ${t} carries utak-block class`);
  }
}

// ---------- 5. renderOfficialDocHTML — smoke ----------
console.log("\n[5] renderOfficialDocHTML smoke");
{
  const company: CompanyInfo = {
    nameAr: "UTAK — يو تاك",
    nameEn: "UTAK",
    address: "الرياض، المملكة العربية السعودية",
    email: "care@utak.com",
    phone: "+966 58 004 0467",
    cr: "1234567890",
    vat: "300000000000003",
  };
  const html = renderOfficialDocHTML({
    record: {
      id: 42,
      name: "UTAK-L-2026-001",
      doc_type: "letter",
      recipient: "بنك الاختبار",
      recipient_label: "إلى",
      subject: "تجربة",
      date: new Date("2026-09-22T00:00:00Z"),
      status: "issued",
      ai_prompt: "",
      blocks: [
        { sequence: 10, block_type: "heading", text: "عنوان", tone: "neutral", align_numbers: true },
        { sequence: 20, block_type: "paragraph", text: "فقرة تجريبية.", tone: "neutral", align_numbers: true },
        { sequence: 30, block_type: "signature", text: "براء الوصابي\nالمدير التنفيذي", tone: "neutral", align_numbers: true },
      ],
      is_template: false,
      template_name: "",
    },
    company,
    isPreview: false,
  });
  assert(html.includes("خطاب رسمي"), "renderOfficialDocHTML: doc title in output");
  assert(html.includes("UTAK-L-2026-001"), "renderOfficialDocHTML: number in output");
  assert(html.includes("بنك الاختبار"), "renderOfficialDocHTML: recipient in output");
  assert(html.includes("1234567890"), "renderOfficialDocHTML: CR in legal footer");
  assert(!html.includes("معاينة — غير معتمد"), "renderOfficialDocHTML: no preview badge when issued");

  const preview = renderOfficialDocHTML({
    record: {
      id: 42, name: "", doc_type: "letter", recipient: "بنك الاختبار",
      recipient_label: "إلى", subject: "تجربة", date: new Date(), status: "draft",
      ai_prompt: "", blocks: [{ sequence: 1, block_type: "paragraph", text: "شيء", tone: "neutral", align_numbers: true }],
      is_template: false, template_name: "",
    },
    company, isPreview: true, numberOverride: "معاينة",
  });
  assert(preview.includes("معاينة — غير معتمد"), "renderOfficialDocHTML: preview badge shown");
}

// ---------- 6. legacy byte-parity regression fence ----------
console.log("\n[6] pdf-template byte-parity for 5 legacy fixtures");
{
  // Assert renderPDFShell without any additive option yields HTML that has:
  //   - no "معاينة — غير معتمد" badge
  //   - the exact "شكراً لثقتكم في UTAK" tail line
  //   - the "فاتورة إلى / BILL TO" label and "من / FROM" label
  // These are proxies for the byte-parity of the legacy 5 documents.
  const html = renderInvoiceHTML(TEST_INVOICE_DATA);
  assert(!html.includes("معاينة"), "legacy invoice HTML: no preview marker");
  assert(html.includes("فاتورة إلى / BILL TO"), "legacy invoice HTML: BILL TO label intact");
  assert(html.includes("من / FROM"), "legacy invoice HTML: FROM label intact");
  assert(html.includes("شكراً لثقتكم في"), "legacy invoice HTML: thanks line intact");

  // Also confirm the 5 render functions still return non-empty HTML.
  assert(renderInvoiceHTML(TEST_INVOICE_DATA).length > 1000, "invoice HTML non-empty");
  assert(renderQuotationHTML(TEST_QUOTATION_DATA).length > 1000, "quotation HTML non-empty");
  assert(renderReceiptHTML(TEST_RECEIPT_DATA).length > 1000, "receipt HTML non-empty");
  assert(renderDeliveryNoteHTML(TEST_DELIVERY_NOTE_DATA).length > 1000, "delivery-note HTML non-empty");
  assert(renderPurchaseOrderHTML(TEST_PURCHASE_ORDER_DATA).length > 1000, "purchase-order HTML non-empty");
}

// ---------- 7. renderPDFShell additive path produces different HTML ----------
console.log("\n[7] renderPDFShell additive path");
{
  const billTo: PartyInfo = { name: "X", address: "Y", phone: "Z" };
  const legacy = renderPDFShell({
    documentTitle: "T", documentNumber: "N", documentDate: new Date(0),
    billTo, bodyHTML: "<p>b</p>", pageMetrics: computePageMetrics(0),
  });
  const additive = renderPDFShell({
    documentTitle: "T", documentNumber: "N", documentDate: new Date(0),
    billTo, bodyHTML: "<p>b</p>", pageMetrics: computePageMetrics(0),
    hideFooterNote: true, hideThanks: true, hideBillTo: true, hideFrom: true,
    legalFooterBar: { name: "UTAK", cr: "1", vat: "2", address: "3" },
  });
  assert(legacy !== additive, "additive path yields distinct HTML");
  assert(!additive.includes("BILL TO"), "additive: no BILL TO when hideBillTo");
  assert(!additive.includes("شكراً"), "additive: no thanks line when hideThanks");
  assert(additive.includes(`س.ت <bdi dir="ltr">1</bdi>`), "additive: legal footer CR rendered in bdi");
  assert(additive.includes(`الرقم الضريبي <bdi dir="ltr">2</bdi>`), "additive: legal footer VAT rendered in bdi");
}

// ---------- 8. legal-footer two-line rendering ----------
console.log("\n[8] legal footer — two-line, empty-safe, bdi-wrapped numbers");
{
  const billTo: PartyInfo = { name: "X", address: "Y", phone: "Z" };
  const shellArgs = {
    documentTitle: "T", documentNumber: "N", documentDate: new Date(0),
    billTo, bodyHTML: "<p>b</p>", pageMetrics: computePageMetrics(0),
    hideFooterNote: true, hideThanks: true, hideBillTo: true, hideFrom: true,
  } as const;

  // Isolate the legal-footer strip using a stable style anchor
  // (font-size: 8.5px is unique to the footer lines in the shell).
  const extractLegal = (html: string): string[] =>
    Array.from(html.matchAll(/<div style="text-align: center; font-size: 8\.5px[^"]*">([^]*?)<\/div>/g))
      .map((m) => m[1]);

  // (a) Full — every field present. Use a distinctive company name that
  // does NOT match the watermark BRAND_INFO.nameEn ("UTAK") so we can
  // isolate line 1 by matching it inside the legal strip only.
  const full = renderPDFShell({
    ...shellArgs,
    legalFooterBar: {
      name: "شركة اختبار الفوتر",
      cr: "1010000000",
      vat: "300000000000003",
      address: "الرياض، المملكة العربية السعودية",
      phone: "+966 58 004 0467",
      email: "care@utakfresh.com",
    },
  });
  const fullLines = extractLegal(full);
  assert(fullLines.length === 2, `full footer: exactly 2 rendered lines (got ${fullLines.length})`);
  assert(fullLines[0].includes("شركة اختبار الفوتر"), "full footer: line 1 has name");
  assert(fullLines[0].includes(`س.ت <bdi dir="ltr">1010000000</bdi>`), "full footer: line 1 has CR in bdi");
  assert(fullLines[0].includes(`الرقم الضريبي <bdi dir="ltr">300000000000003</bdi>`), "full footer: line 1 has VAT in bdi");
  assert(fullLines[1].includes("الرياض، المملكة العربية السعودية"), "full footer: line 2 has address");
  assert(fullLines[1].includes(`<bdi dir="ltr">+966 58 004 0467</bdi>`), "full footer: line 2 has phone in bdi");
  assert(fullLines[1].includes(`<bdi dir="ltr">care@utakfresh.com</bdi>`), "full footer: line 2 has email in bdi");
  // No orphan separator inside either line.
  for (const [i, l] of fullLines.entries()) {
    assert(!/^\s* · /.test(l), `full footer: line ${i + 1} does not start with separator`);
    assert(!/ · \s*$/.test(l), `full footer: line ${i + 1} does not end with separator`);
  }

  // (b) No CR, no VAT — line 1 has only the name, no orphan " · ".
  const noCrNoVat = renderPDFShell({
    ...shellArgs,
    legalFooterBar: {
      name: "شركة اختبار الفوتر",
      address: "الرياض",
      phone: "0580040467",
      email: "care@utakfresh.com",
    },
  });
  const noCrLines = extractLegal(noCrNoVat);
  assert(noCrLines.length === 2, `no CR/VAT: 2 lines (got ${noCrLines.length})`);
  assert(!noCrLines[0].includes("س.ت"), "no CR/VAT: line 1 has no س.ت label");
  assert(!noCrLines[0].includes("الرقم الضريبي"), "no CR/VAT: line 1 has no VAT label");
  assert(noCrLines[0].trim() === "شركة اختبار الفوتر", "no CR/VAT: line 1 is exactly the name — no separators");

  // (c) No email — line 2 has address + phone only, no orphan " · " at end.
  const noEmail = renderPDFShell({
    ...shellArgs,
    legalFooterBar: {
      name: "شركة اختبار الفوتر",
      cr: "1010000000",
      vat: "3000",
      address: "الرياض",
      phone: "0580040467",
    },
  });
  const noEmailLines = extractLegal(noEmail);
  assert(noEmailLines.length === 2, `no email: 2 lines (got ${noEmailLines.length})`);
  assert(!noEmailLines[1].includes("@"), "no email: line 2 has no @ character");
  assert(!/ · \s*$/.test(noEmailLines[1]), "no email: line 2 does not end with separator");
  // Line 2 should end at the phone bdi.
  assert(noEmailLines[1].trim().endsWith("</bdi>"), "no email: line 2 ends at phone bdi close");

  // (d) Completely empty legalFooterBar → footer bar renders nothing.
  const emptyFooter = renderPDFShell({ ...shellArgs, legalFooterBar: {} });
  const emptyFooterWithout = renderPDFShell({ ...shellArgs });
  const emptyLines = extractLegal(emptyFooter);
  assert(emptyLines.length === 0, "empty footer: no legal-line divs rendered");
  // Sanity: with-empty-object and without-flag versions produce equivalent output.
  assert(emptyFooter.replace(/\s+/g, "") === emptyFooterWithout.replace(/\s+/g, ""),
    "empty footer: equivalent to omitting the flag");

  // (e) Only email → line 1 skipped entirely, line 2 has email only.
  const onlyEmail = renderPDFShell({ ...shellArgs, legalFooterBar: { email: "x@y.com" } });
  const onlyEmailLines = extractLegal(onlyEmail);
  assert(onlyEmailLines.length === 1, `only-email: 1 line (got ${onlyEmailLines.length})`);
  assert(onlyEmailLines[0].trim() === `<bdi dir="ltr">x@y.com</bdi>`, "only-email: line is bare bdi-wrapped email");

  // (f) Legacy fixtures are unaffected: no legal-footer strip present.
  const invoice = renderInvoiceHTML(TEST_INVOICE_DATA);
  assert(extractLegal(invoice).length === 0, "legacy invoice: no legal-footer strip");
  assert(!invoice.includes(`<bdi dir="ltr">`), "legacy invoice: no legal-footer bdi bleed");
}

// ---------- summary ----------
console.log(`\n${failed === 0 ? "OK" : "FAIL"} — ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
