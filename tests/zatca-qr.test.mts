// Unit tests for the ZATCA Phase 1 QR + company seal (2026-09-24).
//   1. TLV from known values: exact bytes, per-tag length (UTF-8 bytes)
//   2. Real l10n_sa string from Odoo round-trips byte for byte
//   3. Length limits: empty / >255-byte values refused
//   4. resolveZatcaQr: l10n_sa preferred when it agrees, local otherwise
//   5. Builders: x_invoice before the cutoff → no QR; after → QR (l10n_sa);
//      account.move draft → not issued, no QR
//   6. Render: QR only on a tax invoice, printed values = decoded values
//   7. Seal: issued invoice / issued official doc carry it; draft / preview
//      and a doc with no image on file do not
//   8. 40-line invoice: every row present, seal block after the last row,
//      page box is min-height (grows) not a fixed 297mm
//
// Same no-framework style as tests/vat.test.mts.

import {
  decodeZatcaTlv,
  encodeZatcaTlv,
  formatZatcaAmount,
  formatZatcaTimestamp,
  parseZatcaQr,
  resolveZatcaQr,
  zatcaQrSvg,
} from "../src/zatca-qr.ts";
import {
  buildInvoicePDFDataFromAccountMove,
  buildInvoicePDFDataFromOdoo,
  renderInvoiceHTML,
  TEST_INVOICE_DATA,
  type InvoicePDFData,
} from "../src/invoice.ts";
import { renderOfficialDocHTML, type OfficialDocRecord } from "../src/official-doc.ts";
import { imageDataUri, type CompanyInfo } from "../src/company.ts";
import { isVatApplicable } from "../src/config.ts";
import { fitPageToMargins } from "../src/pdf-template.ts";

// ---------- fetch mock ----------
interface CapturedRequest { url: string; body: any }
let captured: CapturedRequest[] = [];
let responder: (req: CapturedRequest) => any = () => true;
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED WhatsApp in zatca-qr.test");
  let body: any = null;
  try { body = JSON.parse(init?.body ?? ""); } catch { body = null; }
  const req = { url, body };
  captured.push(req);
  return new Response(JSON.stringify(responder(req)), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof globalThis.fetch;

const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com",
  ODOO_DB: "utakfresh",
  ODOO_LOGIN: "admin@utakfresh.com",
  ODOO_API_KEY: "TEST_KEY",
  ACCOUNTING_SYNC: "true",
};

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(detail ? `${label} — ${detail}` : label); console.log(`  ✗ ${label}${detail ? "  (" + detail + ")" : ""}`); }
}
function reset(): void { captured = []; responder = () => true; }

const SELLER = "شركة يوتاك ذات مسؤولية محدودة";
const VAT_NO = "315022736600003";
// 1×1 transparent PNG — stands in for the real seal / signature.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// ---------- 1. TLV from known values ----------
console.log("\n[1] TLV from known values");
{
  const f = { sellerName: SELLER, vatNumber: VAT_NO, timestamp: "2026-10-01T12:07:57", total: "115.00", vatTotal: "15.00" };
  const b64 = encodeZatcaTlv(f);
  const raw = Buffer.from(b64, "base64");
  const recs = decodeZatcaTlv(b64);
  assert("5 records", recs.length === 5);
  assert("tags are 1..5 in order", recs.map((r) => r.tag).join(",") === "1,2,3,4,5");
  const nameBytes = Buffer.byteLength(SELLER, "utf8");
  assert(`tag 1 length = UTF-8 bytes of the name (${nameBytes}), not chars (${SELLER.length})`, recs[0].length === nameBytes && nameBytes !== SELLER.length);
  assert("tag 2 length 15", recs[1].length === 15);
  assert("tag 3 length 19", recs[2].length === 19);
  assert("tag 4 length 6", recs[3].length === 6);
  assert("tag 5 length 5", recs[4].length === 5);
  assert("byte 0 = tag 1, byte 1 = its length", raw[0] === 1 && raw[1] === nameBytes);
  assert("total bytes = Σ(2 + len)", raw.length === recs.reduce((a, r) => a + 2 + r.length, 0));
  assert("tag 2 bytes follow tag 1 value", raw[2 + nameBytes] === 2 && raw[3 + nameBytes] === 15);
  assert("values decode back", JSON.stringify(parseZatcaQr(b64)) === JSON.stringify(f));
  assert("ASCII sample: exact bytes", Buffer.from(encodeZatcaTlv({ sellerName: "AB", vatNumber: "3", timestamp: "T", total: "1.00", vatTotal: "0.15" }), "base64").toString("hex")
    === "0102414202013303015404" + "04312e3030" + "0504302e3135");
  assert("amount format: 2 decimals, no separators", formatZatcaAmount(1150) === "1150.00" && formatZatcaAmount(15.005) === "15.01" && formatZatcaAmount(-3.5) === "3.50");
  assert("timestamp: UTC → Riyadh wall clock", formatZatcaTimestamp(new Date("2026-09-30T21:00:00Z")) === "2026-10-01T00:00:00");
}

// ---------- 2. Real l10n_sa string (INV/2026/00015, read from Odoo 2026-09-24) ----------
console.log("\n[2] l10n_sa string round-trips");
{
  const odoo = "ATfYtNix2YPYqSDZitmIINiq2KfZgyDYsNin2Kog2YXYs9ik2YjZhNmK2Kkg2YXYrdiv2YjYr9ipAg8zMTUwMjI3MzY2MDAwMDMDEzIwMjYtMDktMjNUMTI6MDc6NTcEBTMwLjAwBQQwLjAw";
  const f = parseZatcaQr(odoo);
  assert("parses to 5 fields", f !== null);
  assert("confirmation 09:07:57 UTC printed as 12:07:57 Riyadh", f?.timestamp === "2026-09-23T12:07:57");
  assert("local encoder reproduces Odoo's bytes exactly", f !== null && encodeZatcaTlv(f) === odoo);
}

// ---------- 3. Length limits ----------
console.log("\n[3] Length limits");
{
  const base = { sellerName: "x", vatNumber: VAT_NO, timestamp: "2026-10-01T00:00:00", total: "1.00", vatTotal: "0.13" };
  let threw = "";
  try { encodeZatcaTlv({ ...base, sellerName: "ش".repeat(128) }); } catch (e) { threw = (e as Error).message; }
  assert("256-byte name refused", threw.includes("256 bytes"), threw);
  let ok = true;
  try { encodeZatcaTlv({ ...base, sellerName: "ش".repeat(127) + "x" }); } catch { ok = false; }
  assert("255-byte name accepted", ok);
  threw = "";
  try { encodeZatcaTlv({ ...base, vatNumber: "" }); } catch (e) { threw = (e as Error).message; }
  assert("empty VAT refused", threw.includes("tag 2 is empty"), threw);
  assert("truncated TLV → parse null", parseZatcaQr(Buffer.from([1, 5, 65]).toString("base64")) === null);
  assert("4-tag TLV → parse null", parseZatcaQr(Buffer.from([1, 1, 65, 2, 1, 66, 3, 1, 67, 4, 1, 68]).toString("base64")) === null);
}

// ---------- 4. resolveZatcaQr ----------
console.log("\n[4] resolveZatcaQr");
{
  const good = encodeZatcaTlv({ sellerName: SELLER, vatNumber: VAT_NO, timestamp: "2026-10-01T12:00:00", total: "115.00", vatTotal: "15.00" });
  const fallback = { sellerName: SELLER, issuedAtUtc: new Date("2026-10-01T09:30:00Z") };
  const expected = { vatNumber: VAT_NO, total: 115, vatTotal: 15 };
  const a = resolveZatcaQr({ odooQr: good, expected, fallback });
  assert("agreeing l10n_sa string is used as-is", a.source === "l10n_sa" && a.base64 === good && !a.odooRejected);
  const b = resolveZatcaQr({ odooQr: good, expected: { ...expected, total: 116 }, fallback });
  assert("total mismatch → local", b.source === "local" && /total/.test(b.odooRejected ?? "") && b.fields.total === "116.00");
  const c = resolveZatcaQr({ odooQr: false, expected, fallback });
  assert("no Odoo string → local with Riyadh timestamp", c.source === "local" && c.fields.timestamp === "2026-10-01T12:30:00");
  assert("local TLV decodes to its fields", JSON.stringify(parseZatcaQr(c.base64)) === JSON.stringify(c.fields));
  const d = resolveZatcaQr({ odooQr: good, expected: { ...expected, vatNumber: "300000000000003" }, fallback });
  assert("VAT mismatch → local", d.source === "local" && /VAT/.test(d.odooRejected ?? ""));
  const svg = zatcaQrSvg(good, 30);
  assert("SVG 30mm with dark modules", svg.includes('width="30mm"') && svg.includes("<path d=\"M"));
}

// ---------- 5. Builders ----------
console.log("\n[5] Builders: cutoff, source, issued");
function mockXInvoice(o: { date: string; total: number; tax: number; subtotal: number; moveId: number | false; odooQr: string | false }): void {
  responder = (req) => {
    const u = req.url;
    if (u.endsWith("/x_invoice/read")) {
      if ((req.body?.fields ?? []).includes("x_account_move_id")) {
        return [{ id: 7, create_date: `${o.date} 06:00:00`, x_account_move_id: o.moveId ? [o.moveId, "INV/x"] : false }];
      }
      return [{ id: 7, x_invoice_number: "UTAK-INV-TEST-QR", x_total: o.total, x_subtotal: o.subtotal, x_tax_amount: o.tax, x_invoice_date: o.date, x_status: "issued", x_order_id: [3, "O"] }];
    }
    if (u.endsWith("/x_daily_order/read")) return [{ id: 3, x_customer_id: [48, "C"], x_delivery_neighborhood: "العليا", x_line_ids: [] }];
    if (u.endsWith("/res.partner/read")) return [{ id: 48, name: "عميل", phone: false, x_whatsapp_number: false, vat: false }];
    if (u.endsWith("/account.move/read")) return [{ id: o.moveId, state: "posted", l10n_sa_qr_code_str: o.odooQr, l10n_sa_confirmation_datetime: `${o.date} 06:05:00` }];
    if (u.endsWith("/res.company/read")) return [{ id: 1, name: SELLER, vat: VAT_NO }];
    return [];
  };
}
{
  reset();
  assert("2026-09-30 is before the cutoff", !isVatApplicable("2026-09-30"));
  mockXInvoice({ date: "2026-09-30", total: 50, tax: 0, subtotal: 50, moveId: 90, odooQr: "ignored" });
  const pre = await buildInvoicePDFDataFromOdoo(env, 7);
  assert("pre-cutoff x_invoice: no QR", pre !== null && pre.zatcaQr === undefined);
  assert("pre-cutoff: no account.move QR read", !captured.some((c) => c.url.endsWith("/account.move/read")));
  assert("x_invoice is issued", pre?.issued === true);

  reset();
  const odooQr = encodeZatcaTlv({ sellerName: SELLER, vatNumber: VAT_NO, timestamp: "2026-10-01T09:05:00", total: "115.00", vatTotal: "15.00" });
  mockXInvoice({ date: "2026-10-01", total: 115, tax: 15, subtotal: 100, moveId: 91, odooQr });
  const post = await buildInvoicePDFDataFromOdoo(env, 7);
  assert("post-cutoff x_invoice: QR from l10n_sa", post?.zatcaQr?.source === "l10n_sa" && post.zatcaQr.base64 === odooQr);

  reset();
  mockXInvoice({ date: "2026-10-01", total: 115, tax: 15, subtotal: 100, moveId: false, odooQr: false });
  const noMove = await buildInvoicePDFDataFromOdoo(env, 7);
  assert("post-cutoff without a move: local QR at create_date (Riyadh)", noMove?.zatcaQr?.source === "local" && noMove.zatcaQr.fields.timestamp === "2026-10-01T09:00:00");

  reset();
  responder = (req) => {
    const u = req.url;
    if (u.endsWith("/account.move/read")) {
      if ((req.body?.fields ?? []).includes("l10n_sa_qr_code_str")) return [{ id: 92, state: "draft", l10n_sa_qr_code_str: false, l10n_sa_confirmation_datetime: false }];
      return [{ id: 92, name: "/", invoice_date: "2026-10-01", date: "2026-10-01", partner_id: false, invoice_line_ids: [], amount_untaxed: 100, amount_tax: 15, amount_total: 115, move_type: "out_invoice", state: "draft", create_date: "2026-10-01 06:00:00" }];
    }
    return [];
  };
  const draft = await buildInvoicePDFDataFromAccountMove(env, 92);
  assert("draft account.move: not issued, no QR", draft?.issued === false && draft.zatcaQr === undefined);
}

// ---------- 6. Render: QR placement + printed = encoded ----------
console.log("\n[6] Render: QR only on tax invoices, printed values = QR values");
const company: CompanyInfo = {
  nameAr: SELLER, nameEn: "UTAK", address: "السلي، الرياض", email: "care@utak.example",
  phone: "+966 58 004 0467", cr: "7055194869", vat: VAT_NO,
  stampImage: `data:image/png;base64,${PNG_B64}`,
};
const qrFields = { sellerName: SELLER, vatNumber: VAT_NO, timestamp: "2026-10-01T12:07:57", total: "1150.00", vatTotal: "150.00" };
const taxData: InvoicePDFData = {
  ...TEST_INVOICE_DATA, subtotal: 1000, vatAmount: 150, grandTotal: 1150, issued: true,
  zatcaQr: { base64: encodeZatcaTlv(qrFields), fields: qrFields, source: "local" },
};
{
  const html = renderInvoiceHTML(taxData, company);
  assert("tax invoice has the QR block", html.includes('data-zatca="qr"'));
  const printed = (k: string) => html.match(new RegExp(`data-zatca="${k}"[^>]*>([^<]*)<`))?.[1];
  const decoded = parseZatcaQr(taxData.zatcaQr!.base64)!;
  assert("printed name = tag 1", printed("name") === decoded.sellerName, printed("name"));
  assert("printed VAT = tag 2", printed("vat") === decoded.vatNumber);
  assert("printed timestamp = tag 3", printed("timestamp") === decoded.timestamp);
  assert("printed total = tag 4", printed("total") === decoded.total);
  assert("printed tax = tag 5", printed("tax") === decoded.vatTotal);
  const qrAt = html.indexOf('data-zatca="qr"');
  assert("QR sits in the totals block (after the table)", qrAt > html.indexOf("</table>") && qrAt < html.indexOf("الإجمالي شامل الضريبة", qrAt + 1) + 5000);
  const noTax = renderInvoiceHTML({ ...taxData, vatAmount: 0, subtotal: 1150 }, company);
  assert("tax-free invoice: no QR even if one is attached", !noTax.includes('data-zatca="qr"') && !noTax.includes("<svg"));
}

// ---------- 7. Seal ----------
console.log("\n[7] Seal + signature: issued only");
{
  const issued = renderInvoiceHTML(taxData, company);
  assert("issued invoice: seal image present", issued.includes('data-utak="stamp"'));
  assert("seal printed at 40mm", /data-utak="stamp"[^>]*width: 40mm; height: 40mm/.test(issued));
  assert("invoice seal sits in the terms row (bottom-left), not a row of its own", issued.indexOf('data-utak="seal-signature"') > issued.indexOf("شروط الدفع") && issued.indexOf('data-utak="seal-signature"') < issued.indexOf("شكراً لثقتكم"));
  assert("no negative margin on the seal block", !/seal-signature"[^>]*margin-top: -/.test(issued));
  assert("seal slightly rotated", /data-utak="stamp"[^>]*rotate\(-8deg\)/.test(issued));
  assert("no signature on file → no signature img", !issued.includes('data-utak="signature"'));
  const both = renderInvoiceHTML(taxData, { ...company, signatureImage: `data:image/png;base64,${PNG_B64}` });
  assert("with signature: signature drawn first, seal overlaps it", both.indexOf('data-utak="signature"') > 0 && both.indexOf('data-utak="signature"') < both.indexOf('data-utak="stamp"'));
  assert("block is bottom-left (ltr, flex-start)", /data-utak="seal-signature" style="display: flex; direction: ltr; justify-content: flex-start;/.test(both));
  const notIssued = renderInvoiceHTML({ ...taxData, issued: false }, company);
  assert("draft invoice: no seal", !notIssued.includes('data-utak="stamp"'));
  const noImage = renderInvoiceHTML(taxData, { ...company, stampImage: undefined });
  assert("nothing on file: no empty frame", !noImage.includes("seal-signature"));

  const rec: OfficialDocRecord = {
    id: 1, name: "UTAK-L-2026-009", doc_type: "letter", recipient: "بنك", recipient_label: "", subject: "إفادة",
    date: new Date("2026-09-24T09:00:00Z"), status: "issued", ai_prompt: "", is_template: false, template_name: "",
    blocks: [
      { sequence: 1, block_type: "paragraph", text: "نص", tone: "neutral", align_numbers: false },
      { sequence: 2, block_type: "stamp", text: "الختم", tone: "neutral", align_numbers: false },
    ],
  };
  const docIssued = renderOfficialDocHTML({ record: rec, company, isPreview: false });
  const docPreview = renderOfficialDocHTML({ record: { ...rec, status: "draft" }, company, isPreview: true, numberOverride: "معاينة" });
  assert("issued official doc: real seal", docIssued.includes('data-utak="stamp"'));
  assert("issued official doc: dashed placeholder ring dropped", !docIssued.includes("border-radius: 55px"));
  assert("preview official doc: no seal", !docPreview.includes('data-utak="stamp"'));
  assert("preview official doc: keeps the placeholder ring", docPreview.includes("border-radius: 55px"));
  assert("imageDataUri sniffs PNG / SVG / junk", imageDataUri(PNG_B64)?.startsWith("data:image/png;base64,") === true
    && imageDataUri("PHN2ZyB4bWxucz0i")?.startsWith("data:image/svg+xml") === true && imageDataUri("AAAA") === undefined && imageDataUri(false) === undefined);
}

// ---------- 8. 40-line invoice ----------
console.log("\n[8] 40-line invoice flows, seal last");
{
  const items = Array.from({ length: 40 }, (_, i) => ({ name: `صنف رقم ${i + 1}`, pack: "كرتون", qty: 1, price: 28.75, total: 28.75 }));
  const html = renderInvoiceHTML({ ...taxData, items, subtotal: 1000, vatAmount: 150, grandTotal: 1150 }, company);
  const rows = html.match(/صنف رقم \d+/g) ?? [];
  assert("all 40 rows rendered", rows.length === 40);
  assert("seal after the last row", html.indexOf('data-utak="stamp"') > html.indexOf("صنف رقم 40"));
  assert("page box grows (min-height), no fixed 297mm height", /class="utak-page" style="[^"]*min-height: 297mm/.test(html) && !/class="utak-page" style="[^"]*[^-]height: 297mm/.test(html));
  const fitted = fitPageToMargins(html, { marginBottom: "0.4" });
  assert("Gotenberg footer margin: page box shrinks to printable height", fitted.includes(".utak-page { min-height: calc(297mm - 0.4in) !important; }</style>\n</head>"));
  assert("no margins: HTML untouched", fitPageToMargins(html) === html && fitPageToMargins(html, { marginBottom: "0" }) === html);
  const legacy = renderInvoiceHTML(TEST_INVOICE_DATA);
  assert("byte-parity template also min-height", /class="utak-page" style="[^"]*min-height: 297mm/.test(legacy) && !/[^-]height: 297mm/.test(legacy));
}

// ---------- summary ----------
console.log(`\n${failed === 0 ? "OK" : "FAIL"} — ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
