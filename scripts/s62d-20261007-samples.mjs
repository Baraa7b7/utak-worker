// § 62 د (2026-10-07) — the sample PDFs of the quotation's tidy-up, each through its production generator
// (the company and its bank line from Odoo, then Gotenberg):
//
//   1  sq0002-preview   «👁️ معاينة PDF» of SQ-0002 as the worker serves it (previewSpecialQuotation): a draft
//   2  sq0002-issued    SQ-0002 as «📄 أصدر عرض السعر» would print it now (its lines read from Odoo; NOT issued:
//                       nothing is recorded, numbered or sent — the page alone is rendered)
//   3  qty-12           twelve lines by quantities, issued (sample data)
//   4  s00015-issued    the sale order S00015 as «إرسال واتساب (UTAK)» would print it (read from Odoo; not sent)
//   5  s00015-preview   its «👁️ معاينة PDF» (buildPreviewPdf)
//   6  invoice          a tax invoice (sample data): only its page-foot block and the page number's place changed
//   7  qty-27           twenty-seven lines: more than a sheet, «صفحة X من Y» on each
//
// READ-ONLY on Odoo: any request that is not a read is refused before it leaves; any graph.facebook.com
// request throws. Nothing is sent, nothing is uploaded, nothing is issued.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s62d-20261007-samples.mjs
//
// Out: scripts/artifacts/q62d-20261007-<key>.pdf (git-ignored), every page as PNG beside it, and
// scripts/artifacts/q62d-20261007-samples.json. Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg),
// pdfinfo / pdftotext / pdftoppm.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readCompanyInfoWithBank } from "../src/company.ts";
import { generateQuotationPDF, TEST_QUOTATION_DATA } from "../src/quotation.ts";
import { generateInvoicePDF } from "../src/invoice.ts";
import { previewSpecialQuotation, specialQuotationData } from "../src/special-quotation.ts";
import { finalsOf, readQuote } from "../src/special-quote.ts";
import { buildQuotationPDFDataFromSaleOrder } from "../src/sale-order-quotation.ts";
import { buildPreviewPdf } from "../src/quote-preview.ts";
import { resolveZatcaQr } from "../src/zatca-qr.ts";
import { call } from "../src/odoo.ts";

const READS = new Set(["read", "search_read", "search", "search_count", "fields_get", "name_search"]);
const realFetch = globalThis.fetch;
let odooReads = 0;
/** The page the generator handed the PDF service last (its index.html): the Arabic is read there — pdftotext cannot read it from the file. */
let lastPage = "";
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp send from a render check");
  if (url.includes("/forms/chromium/convert/html") && typeof init?.body?.getAll === "function") {
    const page = init.body.getAll("files").find((f) => f?.name === "index.html");
    if (page) lastPage = await page.text();
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m) {
    if (!READS.has(m[2])) throw new Error(`BLOCKED: ${m[1]}.${m[2]} is not a read`);
    odooReads++;
  }
  return realFetch(input, init);
};
const readEnv = (f) => Object.fromEntries(
  readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const kv = new Map();
const env = { ...readEnv(".env.sim-verify"), ...readEnv(".env.zatca-oneoff"), MSG_DEDUP: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } } };
delete env.META_ACCESS_TOKEN;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
const now = Date.now();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));

const company = await readCompanyInfoWithBank(env);
const legal = company.legalNameAr || company.nameAr;
console.log(`company: «${legal}» · CR ${company.cr} · VAT ${company.vat ? "yes" : "NONE"} · bank line ${company.bankLine ? "yes" : "none"}`);

// ---- SQ-0002 and S00015, read from Odoo (never written)
const SQ = 2;
const read = await readQuote(env, SQ);
if (!read) throw new Error("SQ-0002 is not there");
const q = { ...read, lines: read.lines.map((l) => ({ ...l, ...finalsOf(l, read.priceMode) })) };
await pause();
const [partner] = await call(env, "res.partner", "read", { ids: [q.partnerId], fields: ["id", "name", "phone", "x_whatsapp_number", "street", "city"] });
const customer = { name: String(partner?.name || q.partnerName), address: [partner?.street, partner?.city].filter(Boolean).join(", ") || "الرياض", phone: String(partner?.x_whatsapp_number || partner?.phone || "") };
await pause();
const [so15] = await call(env, "sale.order", "search_read", { domain: [["name", "=", "S00015"]], fields: ["id", "name", "state"], limit: 1 });
if (!so15) throw new Error("S00015 is not there");
console.log(`SQ-0002: ${q.lines.length} lines, mode ${q.priceMode}, layout ${q.layout}, quantities ${[...new Set(q.lines.map((l) => l.qty))].join("/")} · S00015 #${so15.id} (${so15.state})`);

// ---- sample data: twelve and twenty-seven lines by quantities, «قبل الضريبة»
const names = ["برتقال", "ليمون", "تفاح أحمر", "تفاح أخضر", "موز", "عنب", "فراولة", "أناناس", "مانجو", "كيوي", "طماطم", "خيار", "فلفل رومي", "باذنجان", "كوسا", "جزر", "بطاطس", "بصل أحمر", "بصل أبيض", "ثوم", "خس أمريكي", "جرجير", "بقدونس", "كزبرة", "نعناع", "فطر أبيض", "بروكلي"];
const byQty = (n, number) => specialQuotationData({
  partnerId: 0, priceMode: "net", layout: "auto", validUntil: new Date(now + 24 * 3600_000).toISOString().slice(0, 19).replace("T", " "), alternatives: "",
  lines: names.slice(0, n).map((productName, i) => {
    const carton = i % 6 === 5, finalNet = carton ? 90 + i : round2(3 + i * 0.25);
    return { productName, unit: carton ? "كرتون 18 كجم" : "كيلو", qty: carton ? 2 + (i % 3) : 20 + i * 7, finalNet, finalPrice: round2(finalNet * 1.15), origin: i === 0 ? "جنوب أفريقيا" : "", size: i === 0 ? "66" : "" };
  }),
}, number, { name: "شركة العيّنة للأغذية", address: "الرياض", phone: "+966 50 000 0000" }, now);

// ---- the tax invoice (sample data, as scripts/s62c-20261007-from-samples.mjs)
const items = [
  { name: "طماطم شيري", pack: "كرتون ٨ كجم", qty: 6, price: 45, total: 270 },
  { name: "خيار بلدي", pack: "كرتون ٥ كجم", qty: 8, price: 28, total: 224 },
  { name: "خس آيسبرغ", pack: "كرتون ١٢ حبة", qty: 4, price: 55, total: 220 },
  { name: "ليمون بلدي", pack: "كرتون ١٠ كجم", qty: 5, price: 72, total: 360 },
];
const gross = round2(items.reduce((a, i) => a + i.total, 0));
const tax = round2(items.reduce((a, i) => a + round2((i.total * 15) / 115), 0));
const qr = resolveZatcaQr({ odooQr: false, expected: { vatNumber: company.vat, total: gross, vatTotal: tax }, fallback: { sellerName: company.nameAr, issuedAtUtc: new Date(now) } });
const invoice = {
  invoiceNumber: "INV-SAMPLE-3", invoiceDate: new Date(now), issuedAt: new Date(now),
  customer: { name: "مطعم العيّنة", contactPerson: "أ. محمد", address: "العليا، الرياض", phone: "+966 50 000 0000", vat: "300000000000003" },
  items, subtotal: round2(gross - tax), discount: 0, vatAmount: tax, grandTotal: gross, issued: true, zatcaQr: { base64: qr.base64, fields: qr.fields, source: qr.source },
};
void TEST_QUOTATION_DATA;

const so15data = await buildQuotationPDFDataFromSaleOrder(env, so15.id);
await pause();
const UNIT_HEADS = ["السعر قبل الضريبة", "ضريبة 15%", "السعر بعد الضريبة"];
const cases = [
  { key: "sq0002-preview", what: "SQ-0002 — معاينة (مسودة، أسعار الوحدة)", pdf: async () => { const r = await previewSpecialQuotation(env, SQ, now); if (!r || !("pdf" in r)) throw new Error(`preview: ${JSON.stringify(r)}`); return r.pdf; }, pages: 1, quotation: true, draft: true, unit: true, rows: q.lines.length },
  { key: "sq0002-issued", what: "SQ-0002 — الصادر (أسعار الوحدة)", pdf: () => generateQuotationPDF(specialQuotationData(q, q.quotationNumber || "S00016", customer, now), env), pages: 1, quotation: true, unit: true, rows: q.lines.length, number: q.quotationNumber || "S00016" },
  { key: "qty-12", what: "12 سطراً بالكميات — الصادر", pdf: () => generateQuotationPDF(byQty(12, "S-SAMPLE-12"), env), pages: 1, quotation: true, rows: 12, number: "S-SAMPLE-12", detail: "جنوب أفريقيا · مقاس 66" },
  { key: "s00015-issued", what: "S00015 من أمر البيع — كما يُرسل", pdf: () => generateQuotationPDF({ ...so15data, issued: true }, env), pages: 1, quotation: true, unit: so15data?.layout === "unit", rows: so15data?.items.length, number: "S00015", noItemWord: true },
  { key: "s00015-preview", what: "S00015 من أمر البيع — معاينة", pdf: async () => { const r = await buildPreviewPdf(env, "so", so15.id, now); if (!r || !("pdf" in r)) throw new Error(`preview: ${JSON.stringify(r)}`); return r.pdf; }, pages: 1, quotation: true, draft: true, unit: so15data?.layout === "unit", rows: so15data?.items.length, noItemWord: true },
  { key: "invoice", what: "فاتورة ضريبية", pdf: () => generateInvoicePDF(invoice, env), pages: 1, quotation: false },
  { key: "qty-27", what: "27 سطراً بالكميات — أكثر من صفحة", pdf: () => generateQuotationPDF(byQty(27, "S-SAMPLE-27"), env), pages: 2, quotation: true, rows: 27, number: "S-SAMPLE-27" },
];

let ok = true;
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const count = (s, part) => (part ? s.split(part).length - 1 : 0);
const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const report = [];
for (const c of cases) {
  const path = `${OUT}q62d-20261007-${c.key}.pdf`;
  console.log(`\n${c.what} → scripts/artifacts/q62d-20261007-${c.key}.pdf`);
  lastPage = "";
  const pdf = await c.pdf();
  writeFileSync(path, pdf);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path], { encoding: "utf8" }))[1]);
  // the file: its pages and its Latin text (numbers, the IBAN, the e-mail); the page handed to the PDF service: its Arabic
  const printed = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" }).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ");
  const page = textOf(lastPage);
  check(`${c.pages === 1 ? "one page" : `${c.pages} pages`}`, pages === c.pages, `${pages}`);
  check(`the file: the page number on every page (… ${pages})`, new RegExp(`\\b${pages}\\b[^0-9]{1,12}\\b${pages}\\b`).test(printed.slice(-200)));
  check("the file: the commercial register and the VAT number in the strip", printed.includes(company.cr) && printed.includes(company.vat));
  const foot = lastPage.slice(lastPage.indexOf('data-utak="page-foot"'));
  check("the terms, «شكراً …» and the legal strip are ONE block that never splits (page-foot, break-inside: avoid)", lastPage.includes('<div class="utak-block" data-utak="page-foot">') && foot.includes(company.vat) && foot.includes("شكراً لثقتكم"));
  if (c.quotation) {
    check("«الشروط والملاحظات», not «شروط الدفع»", page.includes("الشروط والملاحظات") && !page.includes("شروط الدفع"));
    check("the legal strip is one unbreakable line: the legal name · س.ت · الرقم الضريبي — no address, e-mail or phone in it", (() => {
      const line = /data-utak="legal-line"[^>]*style="([^"]*)"[^>]*>(.*?)<\/div>/s.exec(lastPage);
      const t = line ? textOf(line[2]).trim() : "";
      return !!line && line[1].includes("white-space: nowrap") && t === `${legal} · س.ت ${company.cr} · الرقم الضريبي ${company.vat}`;
    })());
    check("the transfer line carries the legal name", !company.bankLine || (page.includes(`للتحويل: ${legal} — `) && printed.includes("IBAN SA")), company.bankLine ? "" : "(no bank line)");
    check("the file: the e-mail and the phone once («من»), not again in the strip", count(printed, company.email) === 1 && count(printed, company.phone) === 1, `${count(printed, company.email)}/${count(printed, company.phone)}`);
    check(c.unit ? "unit prices: the three price columns, no «الكمية», no «الإجمالي», and the line under the table" : "by quantities: «الكمية» and «الإجمالي»",
      c.unit ? UNIT_HEADS.every((h) => page.includes(h)) && !page.includes("الكمية") && !page.includes("الإجمالي") && page.includes("الأسعار لكل وحدة كما في عمود العبوة")
        : page.includes("الكمية") && page.includes("الإجمالي") && !page.includes("الأسعار لكل وحدة"));
    check(c.draft ? "a draft: «مسودة» across the page and in the number's place, no seal, no signature, no order's number" : `issued: its number ${c.number}, the seal and the signature, and no «مسودة»`,
      c.draft ? lastPage.includes('data-utak="draft-mark"') && count(page, "مسودة") >= 3 && !lastPage.includes('data-utak="stamp"') && !lastPage.includes('data-utak="signature"') && !/S000\d\d/.test(printed)
        : printed.includes(c.number) && lastPage.includes('data-utak="stamp"') && lastPage.includes('data-utak="signature"') && !page.includes("مسودة"));
    if (c.noItemWord) check("no line is named «صنف»", !/>\s*صنف\s*</.test(lastPage));
    if (c.detail) check(`«${c.detail}» under its item`, page.includes(c.detail));
    if (c.rows) check(`${c.rows} lines in the table`, count(lastPage.slice(lastPage.indexOf("<tbody>"), lastPage.indexOf("</tbody>")), "<tr style=") === c.rows);
  }
  execFileSync("pdftoppm", ["-png", "-r", "100", path, path.replace(/\.pdf$/, "")]);
  report.push({ key: c.key, what: c.what, file: `scripts/artifacts/q62d-20261007-${c.key}.pdf`, pages, bytes: pdf.length, rows: c.rows ?? null });
  await pause(600);
}

writeFileSync(`${OUT}q62d-20261007-samples.json`, JSON.stringify({ at: new Date().toISOString(), odooReads, ok, report }, null, 2) + "\n");
console.log(`\n${ok ? "✓ all checks passed" : "✗ a check failed"} · Odoo: ${odooReads} reads, 0 writes`);
process.exit(ok ? 0 : 1);
