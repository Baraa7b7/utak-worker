// § 62 ج (the fix, 2026-10-07) — three sample PDFs after «من» became the company read from Odoo and a
// quotation became «إلى / TO»: the special request's quotation «قبل الضريبة», the manual quotation, and
// the tax invoice. Each through its production generator (readCompanyInfoWithBank + Gotenberg), with
// sample data made here — no record of Odoo is read but the company and its bank journal.
//
// READ-ONLY on Odoo: any request that is not a read is refused before it leaves; any
// graph.facebook.com request throws. Nothing is sent, nothing is uploaded.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s62c-20261007-from-samples.mjs
//
// Out: scripts/artifacts/fix-from-20261007-{special-net,manual,invoice}.pdf (git-ignored), their first
// pages as PNG beside them, and scripts/artifacts/fix-from-20261007-samples.json.
// Checked on each: «من» = the company's name, national address, e-mail and phone; the wrong e-mail nowhere; the VAT
// number in «من» zero times (the legal strip carries it); «إلى / TO» on the two quotations and «فاتورة إلى /
// BILL TO» on the invoice.
// Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg), pdfinfo / pdftotext / pdftoppm.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readCompanyInfoWithBank } from "../src/company.ts";
import { generateQuotationPDF, renderQuotationHTML, TEST_QUOTATION_DATA } from "../src/quotation.ts";
import { generateInvoicePDF, renderInvoiceHTML } from "../src/invoice.ts";
import { specialQuotationData } from "../src/special-quotation.ts";
import { resolveZatcaQr } from "../src/zatca-qr.ts";

const READS = new Set(["read", "search_read", "search", "search_count", "fields_get", "name_search"]);
const realFetch = globalThis.fetch;
let odooReads = 0;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp send from a render check");
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
const WRONG = "care@" + "utak.com";
const now = Date.now();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const company = await readCompanyInfoWithBank(env);
const want = { name: company.legalNameAr || company.nameAr, address: company.addressAr || company.address, email: company.email, phone: company.phone, vat: company.vat };
console.log(`company: «${want.name}» · «${want.address}» · ${want.email} · ${want.phone} · VAT ${want.vat ? "yes" : "NONE"} · bank line ${company.bankLine ? "yes" : "none"}`);

// ---- 1. the special request's quotation, «قبل الضريبة»: 27 lines as a real request has, by the kilo and by the carton
const names = ["برتقال", "ليمون", "تفاح أحمر", "تفاح أخضر", "موز", "عنب", "فراولة", "أناناس", "مانجو", "كيوي", "طماطم", "خيار", "فلفل رومي", "باذنجان", "كوسا", "جزر", "بطاطس", "بصل أحمر", "بصل أبيض", "ثوم", "خس أمريكي", "جرجير", "بقدونس", "كزبرة", "نعناع", "فطر أبيض", "بروكلي"];
const special = specialQuotationData({
  partnerId: 0, priceMode: "net", validUntil: new Date(now + 24 * 3600_000).toISOString().slice(0, 19).replace("T", " "),
  alternatives: "الليمون: تركي بدل المصري بالسعر نفسه.\nالفطر: عبوة 250 جم بدل الكيلو عند الطلب.",
  lines: names.map((productName, i) => {
    const carton = i % 6 === 5, finalNet = carton ? 90 + i : round2(3 + i * 0.35);
    return { productName, unit: carton ? "كرتون 18 كجم" : "كيلو", qty: carton ? 2 + (i % 3) : 20 + i * 7, finalNet, finalPrice: round2(finalNet * 1.15) };
  }),
}, "S-SAMPLE-1", { name: "شركة العيّنة للأغذية", address: "الرياض", phone: "+966 50 000 0000" }, now);

// ---- 2. the manual quotation (a sale order's): the day's lines, VAT inside
const manual = { ...TEST_QUOTATION_DATA, quotationNumber: "S-SAMPLE-2", quotationDate: new Date(now), is_manual: true, vatInclusive: true, issued: true };

// ---- 3. the tax invoice: VAT-inclusive prices split as the worker splits them, its QR from the company's own number
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

const cases = [
  { key: "special-net", what: "عرض سعر خاص — قبل الضريبة", gen: generateQuotationPDF, render: renderQuotationHTML, data: special, to: "إلى / TO", vatOnPage: 1 },
  { key: "manual", what: "عرض سعر يدوي", gen: generateQuotationPDF, render: renderQuotationHTML, data: manual, to: "إلى / TO", vatOnPage: 1 },
  { key: "invoice", what: "فاتورة ضريبية", gen: generateInvoicePDF, render: renderInvoiceHTML, data: invoice, to: "فاتورة إلى / BILL TO", vatOnPage: 2 },
];

let ok = true;
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const text = (html) => html.replace(/<[^>]+>/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
function parties(html) {
  const start = html.indexOf(`grid-template-columns: 1fr 1fr; gap: 32px;">`);
  const row = html.slice(start, html.indexOf(`<div style="height: `, start));
  const [a, b] = row.split(`text-align: left;">`);
  const [toLabel, ...to] = text(a.slice(a.indexOf(">") + 1).replace(/<[^>]*$/, ""));
  const [fromLabel, ...from] = text(b);
  return { toLabel, to, fromLabel, from };
}
const count = (s, part) => (part ? s.split(part).length - 1 : 0);
const report = [];

for (const c of cases) {
  const path = `${OUT}fix-from-20261007-${c.key}.pdf`;
  console.log(`\n${c.what} → scripts/artifacts/fix-from-20261007-${c.key}.pdf`);
  // the page the generator hands the PDF service (the same call it makes), then the file itself
  const html = c.render(c.data, company);
  const p = parties(html);
  check("«من» = the company's name, national address, e-mail, phone — nothing else", JSON.stringify(p.from) === JSON.stringify([want.name, want.address, `${want.email} · ${want.phone}`]) && p.fromLabel === "من / FROM", JSON.stringify(p.from));
  check(`the customer's block is «${c.to}»`, p.toLabel === c.to && p.to[0] === c.data.customer.name, p.toLabel);
  check("the right e-mail, and the wrong one nowhere", want.email === "care@utakfresh.com" && !html.includes(WRONG), want.email);
  check(`the VAT number: not in «من», ${c.vatOnPage}× on the page (${c.vatOnPage === 1 ? "the legal strip" : "the seller's block and the legal strip, as before"})`, !!want.vat && !p.from.some((l) => l.includes(want.vat)) && count(html, want.vat) === c.vatOnPage, String(count(html, want.vat)));
  const pdf = await c.gen(c.data, env);
  writeFileSync(path, pdf);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path], { encoding: "utf8" }))[1]);
  const printed = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" }).replace(/[‎‏‪-‮⁦-⁩]/g, "");
  check("the file: the e-mail and the phone are printed, the wrong e-mail is not", printed.includes(want.email) && printed.includes(want.phone) && !printed.includes(WRONG));
  check(`the file: the VAT number ${c.vatOnPage}× (${pages} page${pages > 1 ? "s" : ""})`, count(printed, want.vat) === c.vatOnPage, String(count(printed, want.vat)));
  // the labels are letter-spaced on the page («T O», «B I L L  T O»): read without the spaces
  const tight = printed.replace(/\s+/g, "");
  check(`the file: «${c.to.split(" / ")[1]}» is printed${c.key === "invoice" ? "" : ", «BILL TO» is not"}`, c.key === "invoice" ? tight.includes("BILLTO") : /(^|[^L])TO\//.test(tight) && !tight.includes("BILLTO"));
  execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", "-singlefile", path, path.replace(/\.pdf$/, "")]);
  report.push({ key: c.key, file: `scripts/artifacts/fix-from-20261007-${c.key}.pdf`, pages, bytes: pdf.length, from: p.from, toLabel: p.toLabel, vatOnPage: count(html, want.vat) });
}

writeFileSync(`${OUT}fix-from-20261007-samples.json`, JSON.stringify({ at: new Date().toISOString(), odooReads, ok, report }, null, 2) + "\n");
console.log(`\n${ok ? "✓ all checks passed" : "✗ a check failed"} · Odoo: ${odooReads} reads, 0 writes`);
process.exit(ok ? 0 : 1);
