// § 59 د (2026-10-06) — every PDF reaches the customer as an ATTACHED FILE, never a link in a text.
//
//   [د1] the quotation: inside the window a document (UTAK-Q-….pdf) with its words as the caption;
//        outside it a template with a DOCUMENT header — utak_quotation_pdf_v2 once APPROVED and
//        UTILITY, else utak_quotation_pdf_v1; no template → the document waits for his window
//   [د2] the receipt: the words without a link, then the file (UTAK-R-….pdf); outside the window
//        utak_payment_received as it is, and the file with his first open window
//   [د3] «✅ وصل»: inside the window its one message, then a receipt's file a payment; outside it
//        utak_payment_received an invoice, as before § 58 — no 48-hour wait
//   [د4] no customer-facing text keeps «الملف: <link>» or «الإيصال: <link>»
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s59-files.test.mts

import { readFileSync, readdirSync } from "node:fs";
import { CUST2, CUST2_PHONE, OWNER, closeOwnerWindow, ctx, graph, heldFor, inbound, openWindow, order, quiet, rows, seed, sentTo, signed, table } from "./wa-harness.mts";
import { C1, C1_PHONE, assert, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.startsWith("https://gotenberg.test/")) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
  return kitFetch(input as any, init);
}) as typeof fetch;

const META = await import("../src/meta.ts");
const QUO = await import("../src/quotation.ts");
const PC = await import("../src/payment-confirm.ts");
const TR = await import("../src/transfer-form.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { clearTemplateCache } = await import("../src/templates.ts");
const LIB = await import("../scripts/lib/s59-templates.mjs");
const worker = (await import("../src/index.ts")).default;

const NOW = "2026-10-06 10:00";
const docsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "document").map((b: any) => b.document);
const tplTo = (d: string, name?: string) => sentTo(d).filter((b: any) => b?.type === "template" && (!name || b.template?.name === name));
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map((b: any) => String(b.text?.body ?? ""));
const bodyParams = (b: any): string[] => (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
const headerDoc = (b: any) => (b?.template?.components ?? []).find((c: any) => c.type === "header")?.parameters?.[0]?.document;
const hasLink = (s: string) => /https?:\/\//.test(s);
const say = (env: any, from: string, text: string) => quiet(() => worker.fetch(signed(inbound(from, { type: "text", text: { body: text } })), env, ctx));

function world(riyadh = NOW): any {
  const env = fresh(riyadh);
  Object.assign(env, {
    GOTENBERG_URL: "https://gotenberg.test", GOTENBERG_USER: "u", GOTENBERG_PASSWORD: "p", ADMIN_TOKEN: "ADM",
    INVOICES_BUCKET: { put: async () => ({}), head: async () => null, get: async () => null },
  });
  seed("res.company", { id: 1, name: "شركة يوتاك", vat: "315022736600003" });
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  return env;
}
const tplRow = (purpose: string, name: string, n: number, o: Record<string, unknown> = {}) => seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: n, x_category: "UTILITY", ...o });
const V1 = "utak_quotation_pdf_v1", V2 = LIB.QUOTATION_PDF_V2.name;
function quotation(): number {
  const o = order(C1, "waiting_confirmation", "2026-10-06", 1, { x_delivery_neighborhood: "العليا" });
  return seed("x_quotation", { x_quotation_number: "UTAK-Q-20261006-001", x_order_id: o, x_origin: "auto", create_date: "2026-10-06 06:00:00", x_sent_at: false });
}

// ================================================================ the file's name, the two purposes
console.log("\n[د] the file's name and its message");
{
  assert("the document's number is its file's name: UTAK-Q-….pdf, UTAK-INV-….pdf, UTAK-R-….pdf", META.pdfFileName("UTAK-Q-20261006-001") === "UTAK-Q-20261006-001.pdf" && META.pdfFileName("UTAK-INV-20261006-003") === "UTAK-INV-20261006-003.pdf" && META.pdfFileName("UTAK-R-20261006-012") === "UTAK-R-20261006-012.pdf");
  assert("«.pdf» once, no path, no space; an empty number still names a file", META.pdfFileName("UTAK-Q-1.pdf") === "UTAK-Q-1.pdf" && META.pdfFileName("a/b c") === "a-b-c.pdf" && META.pdfFileName("") === "UTAK.pdf");
  const d = META.documentContent("https://w.test/x.pdf", "UTAK-Q-1", "نص").body as any;
  assert("the session message: type document, the link, the file's name, the caption", d.type === "document" && d.document.link === "https://w.test/x.pdf" && d.document.filename === "UTAK-Q-1.pdf" && d.document.caption === "نص");
  assert("no caption: none sent; a long one is cut at Meta's 1024", !("caption" in (META.documentContent("l", "n").body as any).document) && (META.documentContent("l", "n", "ن".repeat(2000)).body as any).document.caption.length === 1024);
  assert("the two purposes are the gateway's: the v2 lookup, and the receipt's file (not important, a week)", PURPOSES[QUO.QUOTATION_PDF_V2_PURPOSE]?.kind === "operational" && PURPOSES[PC.RECEIPT_FILE_PURPOSE]?.important === false && JSON.stringify(PURPOSES[PC.RECEIPT_FILE_PURPOSE]?.ttl) === JSON.stringify({ hours: 168 }) && !PURPOSES[PC.RECEIPT_FILE_PURPOSE]?.critical);
  assert("the v2 template's data and the worker agree: the purpose, four variables, a DOCUMENT header, § 49's validity in its words", LIB.QUOTATION_PDF_V2.purpose === QUO.QUOTATION_PDF_V2_PURPOSE && LIB.QUOTATION_PDF_V2.params === 4 && LIB.QUOTATION_PDF_V2.documentHeader === true && LIB.QUOTATION_PDF_V2.body.includes("الأسعار سارية حتى الساعة 6:00 صباحاً من اليوم التالي") && !LIB.QUOTATION_PDF_V2.body.includes("إقفال الطلبات"));
}

// ================================================================ د1 — the quotation
console.log("\n[د1] the quotation: a document inside the window; a template with a DOCUMENT header outside it");
{
  // inside the window: the file itself
  let env = world(); openWindow(env, C1_PHONE);
  tplRow("customer_quotation_pdf", V1, 4); tplRow(QUO.QUOTATION_PDF_V2_PURPOSE, V2, 4);
  let r = await quiet(() => QUO.createAndDispatchQuotationForRecord(env, quotation()));
  let got = sentTo(C1_PHONE);
  const doc = got[0]?.document;
  assert("inside the window: ONE message, a document — no template although both are approved", !!r && !r.blocked && got.length === 1 && got[0].type === "document" && tplTo(C1_PHONE).length === 0, JSON.stringify(got).slice(0, 400));
  assert("…the file by its link, named UTAK-Q-20261006-001.pdf", doc?.link === r!.pdfUrl && /^https:\/\/w\.test\//.test(doc.link) && doc.filename === "UTAK-Q-20261006-001.pdf", JSON.stringify(doc));
  assert("…its words are the caption — the number, the customer, the total, the validity — with NO link", String(doc?.caption).startsWith("📄 عرض السعر رقم UTAK-Q-20261006-001") && doc.caption.includes("العميل: مطعم الوادي") && doc.caption.includes("الإجمالي: ") && doc.caption.includes("العرض ساري حتى الساعة") && !hasLink(doc.caption) && !doc.caption.includes("الملف:"), String(doc?.caption));
  assert("…the quotation is marked sent", !!table("x_quotation").get(r!.quotationId)!.x_sent_at);

  // outside the window, v2 approved and UTILITY: v2
  env = world(); tplRow("customer_quotation_pdf", V1, 4); tplRow(QUO.QUOTATION_PDF_V2_PURPOSE, V2, 4); clearTemplateCache();
  r = await quiet(() => QUO.createAndDispatchQuotationForRecord(env, quotation()));
  got = sentTo(C1_PHONE);
  assert("outside the window, v2 APPROVED and UTILITY: utak_quotation_pdf_v2, once — not v1, nothing held", got.length === 1 && got[0]?.template?.name === V2 && heldFor(env, C1_PHONE).length === 0, JSON.stringify(got).slice(0, 400));
  assert("…its header is the DOCUMENT (the link, UTAK-Q-….pdf) and its four variables [name, number, date, total]", headerDoc(got[0])?.link === r!.pdfUrl && headerDoc(got[0])?.filename === "UTAK-Q-20261006-001.pdf" && bodyParams(got[0]).length === 4 && bodyParams(got[0])[0] === "مطعم الوادي" && bodyParams(got[0])[1] === "UTAK-Q-20261006-001" && bodyParams(got[0])[2] === "6 أكتوبر 2026", JSON.stringify(got[0]?.template));

  // v2 not usable yet (PENDING), filed MARKETING, or not there: v1, as before
  for (const [label, v2] of [["PENDING", { x_meta_status: "PENDING" }], ["MARKETING", { x_category: "MARKETING" }], ["not at Meta", null]] as const) {
    env = world(); tplRow("customer_quotation_pdf", V1, 4); if (v2) tplRow(QUO.QUOTATION_PDF_V2_PURPOSE, V2, 4, v2); clearTemplateCache();
    r = await quiet(() => QUO.createAndDispatchQuotationForRecord(env, quotation()));
    got = sentTo(C1_PHONE);
    assert(`outside the window, v2 ${label}: utak_quotation_pdf_v1 with its DOCUMENT header, as before`, got.length === 1 && got[0]?.template?.name === V1 && headerDoc(got[0])?.filename === "UTAK-Q-20261006-001.pdf" && heldFor(env, C1_PHONE).length === 0, JSON.stringify(got).slice(0, 300));
  }
  // no template at all: the document waits for his window — and reaches him as a file when it opens
  env = world(); clearTemplateCache();
  r = await quiet(() => QUO.createAndDispatchQuotationForRecord(env, quotation()));
  const held = heldFor(env, C1_PHONE);
  assert("outside the window with no template: nothing sent — the DOCUMENT is held for him (no text with a link)", sentTo(C1_PHONE).length === 0 && held.length === 1 && held[0].body?.type === "document" && held[0].body.document.filename === "UTAK-Q-20261006-001.pdf" && !hasLink(String(held[0].body.document.caption)), JSON.stringify(held).slice(0, 400));
  graph.length = 0;
  await say(env, C1_PHONE, "السلام عليكم");
  assert("…his next message opens the window: the file goes, as a document", docsTo(C1_PHONE).length === 1 && docsTo(C1_PHONE)[0].filename === "UTAK-Q-20261006-001.pdf" && heldFor(env, C1_PHONE).length === 0, JSON.stringify(sentTo(C1_PHONE)).slice(0, 300));
  // a customer without a number: nothing to him; Baraa's alert keeps the link (links stay in Baraa's messages)
  env = world();
  table("res.partner").get(C1)!.x_whatsapp_number = false; table("res.partner").get(C1)!.phone = false;
  r = await quiet(() => QUO.createAndDispatchQuotationForRecord(env, quotation()));
  assert("no customer number: blocked, and Baraa's alert carries the file's link (his messages may)", r?.blocked === true && ownerTexts().some((t) => t.includes("الملف جاهز: https://w.test/")), ownerTexts().join(" | "));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ د2 — the receipt
console.log("\n[د2] the receipt: the words without a link, then the file");
{
  const RECEIPT = { number: "UTAK-R-20261006-007", url: "https://w.test/receipt-pdf/UTAK-R-20261006-007/abc.pdf", method: "نقد" };
  const paid = (customer = C1) => {
    const o = order(customer, "delivered", "2026-10-06", 1);
    const inv = seed("x_invoice", { x_invoice_number: "UTAK-INV-20261006-003", x_order_id: o, x_total: 60, x_status: "issued", x_invoice_date: "2026-10-06", x_utak_simulation: false, x_is_simulation: false });
    return seed("x_payment", { x_invoice_id: inv, x_amount: 60, x_method: "cash", x_utak_simulation: false });
  };
  assert("the text: the amount, the invoice, the receipt's number and the method — never its link", PC.payconfText({ amount: 60, invoiceNumber: "UTAK-INV-1", receipt: RECEIPT }) === "✅ استلمنا دفعتك بمبلغ 60 ريال على فاتورة UTAK-INV-1. شكراً لك\nرقم الإيصال: UTAK-R-20261006-007\nطريقة الدفع: نقد\nيو تاك 🌿");
  // inside the window
  let env = world(); openWindow(env, C1_PHONE);
  let c = await quiet(() => PC.confirmPaymentToCustomer(env, paid(), { receipt: RECEIPT }));
  let got = sentTo(C1_PHONE);
  assert("inside the window: the words (a text), then the receipt (a document) — in that order", c.action === "sent" && got.length === 2 && got[0].type === "text" && got[1].type === "document" && !hasLink(String(got[0].text.body)), JSON.stringify(got).slice(0, 400));
  assert("…the file by its link, named UTAK-R-20261006-007.pdf, captioned with its number", got[1].document.link === RECEIPT.url && got[1].document.filename === "UTAK-R-20261006-007.pdf" && got[1].document.caption === "إيصال الدفع رقم UTAK-R-20261006-007");
  assert("…the file has its own row in the messages' record (kind document), and it is not the payment's linked row", rows("x_wa_message").filter((m: any) => m.x_kind === "document").length === 1 && rows("x_wa_message").filter((m: any) => m.x_res_model === "x_payment").length === 1 && rows("x_wa_message").find((m: any) => m.x_kind === "document")!.x_res_model !== "x_payment", JSON.stringify(rows("x_wa_message").map((m: any) => [m.x_kind, m.x_res_model])));
  // outside the window: the template as it is, and the file with his first open window
  env = world(); tplRow("customer_payment_received", "utak_payment_received", 2); clearTemplateCache(); closeOwnerWindow(env);
  c = await quiet(() => PC.confirmPaymentToCustomer(env, paid(), { receipt: RECEIPT }));
  got = sentTo(C1_PHONE);
  const held = heldFor(env, C1_PHONE);
  assert("outside the window: utak_payment_received [amount, invoice] as it is — no header, no link", c.action === "sent" && got.length === 1 && got[0]?.template?.name === "utak_payment_received" && bodyParams(got[0]).join("|") === "60|UTAK-INV-20261006-003" && !headerDoc(got[0]) && !hasLink(JSON.stringify(got[0])), JSON.stringify(got).slice(0, 300));
  assert("…the receipt's FILE waits for his first open window (a week at most)", held.length === 1 && held[0].purpose === PC.RECEIPT_FILE_PURPOSE && held[0].body.type === "document" && held[0].body.document.filename === "UTAK-R-20261006-007.pdf" && held[0].expiresAt - Date.now() === 168 * 3600_000, JSON.stringify(held).slice(0, 300));
  assert("…Baraa is told nothing about a file that waits, and no «فتح المحادثة» goes for it", sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0 && tplTo(C1_PHONE).length === 1);
  graph.length = 0;
  await say(env, C1_PHONE, "شكراً");
  assert("…his next message: the receipt arrives as a file", docsTo(C1_PHONE).length === 1 && docsTo(C1_PHONE)[0].link === RECEIPT.url && heldFor(env, C1_PHONE).length === 0, JSON.stringify(sentTo(C1_PHONE)).slice(0, 300));
  // a receipt without a file: the words alone
  env = world(); openWindow(env, C1_PHONE);
  c = await quiet(() => PC.confirmPaymentToCustomer(env, paid(), { receipt: { number: "UTAK-R-1" } }));
  assert("a receipt without a file: the words alone, no empty document", c.action === "sent" && sentTo(C1_PHONE).length === 1 && docsTo(C1_PHONE).length === 0);
  assert("the file is never sent on its own for nothing: no number and no link → none", (await PC.sendReceiptFile(env, "+" + C1_PHONE, undefined)) === "none" && (await PC.sendReceiptFile(env, "", RECEIPT)) === "none");
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ د3 — «✅ وصل»
console.log("\n[د3] «✅ وصل»: its one message then the files inside the window; utak_payment_received an invoice outside it");
{
  const N_A = "UTAK-INV-20260928-001", N_B = "UTAK-INV-20260930-002";
  const rowsOf = () => [
    { invoiceId: 1, number: N_A, paymentId: seed("x_payment", { x_amount: 300, x_utak_simulation: false }), amount: 300, paid: true, receiptUrl: "https://w.test/r/a.pdf", receiptNumber: "UTAK-R-20261006-021" },
    { invoiceId: 2, number: N_B, paymentId: seed("x_payment", { x_amount: 200, x_utak_simulation: false }), amount: 200, paid: true, receiptUrl: "https://w.test/r/b.pdf", receiptNumber: "UTAK-R-20261006-022" },
  ];
  const ONE = `استلمنا تحويلك 500 ريال ✅ وسددنا: فاتورة ${N_A} (300 ريال)، فاتورة ${N_B} (200 ريال)`;
  assert("the one message carries no link, whatever its rows hold", TR.customerConfirmedText(500, rowsOf(), 0) === ONE && !hasLink(TR.customerConfirmedText(500, rowsOf(), 12.5)));
  // inside the window — utak_payment_received is approved and UTILITY, and still not used: the ONE text is his message
  let env = world(); tplRow("customer_payment_received", "utak_payment_received", 2); clearTemplateCache(); openWindow(env, C1_PHONE);
  let via = await quiet(() => TR.tellCustomerConfirmed(env, { to: "+" + C1_PHONE, amount: 500 }, rowsOf(), 0));
  let got = sentTo(C1_PHONE);
  assert("inside the window: the ONE text, then a receipt's file a payment — three messages, in order, and no template", via === "text" && tplTo(C1_PHONE).length === 0 && got.length === 3 && got[0].type === "text" && got[0].text.body === ONE && got[1].type === "document" && got[2].type === "document", JSON.stringify(got).slice(0, 500));
  assert("…each file by its own link and number", got[1].document.link === "https://w.test/r/a.pdf" && got[1].document.filename === "UTAK-R-20261006-021.pdf" && got[2].document.link === "https://w.test/r/b.pdf" && got[2].document.filename === "UTAK-R-20261006-022.pdf");
  assert("…Baraa's line", TR.customerToldLine("text", true) === "أُبلغ العميل برسالة واحدة، ومعها ملفات الإيصالات PDF." && TR.customerToldLine("text", false) === "أُبلغ العميل برسالة واحدة.");
  // outside the window: the template an invoice, at once
  env = world(); tplRow("customer_payment_received", "utak_payment_received", 2); clearTemplateCache();
  const two = rowsOf();
  via = await quiet(() => TR.tellCustomerConfirmed(env, { to: "+" + C1_PHONE, amount: 500 }, two, 0));
  got = sentTo(C1_PHONE);
  let held = heldFor(env, C1_PHONE);
  assert("outside the window: utak_payment_received for EACH invoice, now — [300, A] and [200, B]", via === "template" && got.length === 2 && got.every((b: any) => b?.template?.name === "utak_payment_received") && bodyParams(got[0]).join("|") === `300|${N_A}` && bodyParams(got[1]).join("|") === `200|${N_B}`, JSON.stringify(got).slice(0, 400));
  assert("…the one text is NOT kept waiting 48 hours: nothing of its purpose is held", !held.some((h: any) => h.purpose === "customer_transfer_decision"), JSON.stringify(held.map((h: any) => h.purpose)));
  assert("…the two receipts' files wait for his first open window", held.length === 2 && held.every((h: any) => h.purpose === PC.RECEIPT_FILE_PURPOSE && h.body.type === "document") && held[0].body.document.filename === "UTAK-R-20261006-021.pdf" && held[1].body.document.filename === "UTAK-R-20261006-022.pdf");
  assert("…each template's row is linked to its own payment (one confirmation a payment, as the receipt's)", two.every((r) => rows("x_wa_message").some((m: any) => m.x_res_model === "x_payment" && m.x_res_id === r.paymentId)), JSON.stringify(rows("x_wa_message").map((m: any) => [m.x_res_model, m.x_res_id])));
  assert("…Baraa's line says so", TR.customerToldLine("template", true) === "أُبلغ العميل بقالب «استلمنا دفعتك» لكل فاتورة (نافذته مغلقة)، وملفات الإيصالات تصله مع أول رسالة منه.");
  graph.length = 0;
  await say(env, C1_PHONE, "وصلت؟");
  assert("…his next message: the two files, and no second «استلمنا»", docsTo(C1_PHONE).length === 2 && !textsTo(C1_PHONE).some((t) => t.includes("استلمنا تحويلك")) && tplTo(C1_PHONE).length === 0, JSON.stringify(sentTo(C1_PHONE)).slice(0, 400));
  // outside the window and the template cannot go: the one text waits, as in § 58
  for (const [label, o] of [["MARKETING", { x_category: "MARKETING" }], ["not at Meta", null]] as const) {
    env = world(); if (o) tplRow("customer_payment_received", "utak_payment_received", 2, o); clearTemplateCache();
    via = await quiet(() => TR.tellCustomerConfirmed(env, { to: "+" + C1_PHONE, amount: 500 }, rowsOf(), 0));
    held = heldFor(env, C1_PHONE);
    assert(`outside the window, the template ${label}: nothing sent — the ONE text waits for him, then the two files`, via === "held" && sentTo(C1_PHONE).length === 0 && held.length === 3 && held[0].purpose === "customer_transfer_decision" && held[0].body.text.body === ONE && held[1].body.type === "document" && held[2].body.type === "document", JSON.stringify(held.map((h: any) => [h.purpose, h.body.type])));
  }
  assert("…Baraa's line for it", TR.customerToldLine("held", true) === "رسالة العميل الواحدة محفوظة حتى يراسل (نافذته مغلقة ولا قالب لها)، ومعها ملفات الإيصالات.");
  // nothing recorded on an invoice (all paid before): the one text, no template, no file
  env = world(); tplRow("customer_payment_received", "utak_payment_received", 2); clearTemplateCache(); openWindow(env, CUST2_PHONE);
  via = await quiet(() => TR.tellCustomerConfirmed(env, { to: "+" + CUST2_PHONE, amount: 500 }, [], 0));
  assert("no row: the one text alone («…مسدّدة من قبل»)", via === "text" && sentTo(CUST2_PHONE).length === 1 && textsTo(CUST2_PHONE)[0].includes("مسدّدة من قبل") && docsTo(CUST2_PHONE).length === 0);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ د4 — no link left in a customer's text
console.log("\n[د4] no customer-facing text keeps a PDF's link");
{
  const SRC = new URL("../src/", import.meta.url);
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  const code = (f: string) => readFileSync(new URL(f, SRC), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const withLink = files.filter((f) => /(الملف|الإيصال|الإيصالات|الفاتورة|عرض السعر): \$\{[^}]*(url|Url|pdf|link)/.test(code(f)));
  assert("«الملف: ${link}» / «الإيصال: ${link}» is written in no module", withLink.length === 0, withLink.join(","));
  assert("the receipt's text takes no link; the quotation's customer text is a caption", !/a\.receipt\?\.url\) lines\.push/.test(code("payment-confirm.ts")) && !/`الملف: \$\{uploaded\.publicUrl\}`/.test(code("quotation.ts")) && code("quotation.ts").includes("documentContent(uploaded.publicUrl, data.quotationNumber, caption)"));
  assert("what keeps a file's link is Baraa's alert alone («الملف جاهز: …», his number)", (code("quotation.ts").match(/الملف جاهز: \$\{uploaded\.publicUrl\}/g) ?? []).length === 1);
  assert("the invoice goes as a template with a DOCUMENT header first, as before (its send was not touched)", /header: \{ type: "document", link: a\.pdfUrl, filename: `\$\{a\.invoiceNumber\}\.pdf` \}/.test(code("invoice.ts")) && /const options: GwOption\[\] = \[\.\.\.\(pdfTemplate \? \[pdfTemplate\] : \[\]\), textTemplate, sessionInvoice\];/.test(code("invoice.ts")));
}

void [CUST2];
done();
