// § 44 د (2026-09-28) — the full tax invoice on a real PDF (Gotenberg), read back.
// Read-only on Odoo (readCompanyInfo); graph.facebook.com blocked; nothing is
// created. Two sample invoices of 10-01 through the production renderer
// (generateInvoicePDF): the customer before the save («غير معروف» → simplified,
// the order's name and district) and after it («مسجّل» → full: the
// establishment's official name, its VAT number, its address — buyerTaxInfo,
// the same mapping as buildInvoicePDFDataFromOdoo). pdftotext reads each back.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s44-20260928-invoice-pdf.mts
//
// Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg). Out: scripts/artifacts/s44-sim/*.pdf + invoice-pdf.json
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp from a render check");
  return realFetch(input, init);
}) as typeof fetch;
const readEnv = (f: string) => Object.fromEntries(readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const env: any = { ...readEnv(".env.sim-verify"), ...readEnv(".env.zatca-oneoff") };
delete env.META_ACCESS_TOKEN;
const { generateInvoicePDF } = await import("../src/invoice.ts");
const { buyerTaxInfo, taxInvoiceBreakdown } = await import("../src/tax-invoice.ts");
const { resolveZatcaQr } = await import("../src/zatca-qr.ts");
const { readCompanyInfo } = await import("../src/company.ts");
const company = await readCompanyInfo(env);
const OUT = new URL("./artifacts/s44-sim/", import.meta.url).pathname;
const BIDI = new RegExp("[" + [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => String.fromCharCode(c)).join("") + "]", "g");

const order = { customer_name: "مطعم الوادي", neighborhood: "العليا", phone: "+966 50 000 0501" };
const items = [{ name: "رمان وسط", pack: "كرتون", qty: 10, price: 19, total: 190 }];
const b = taxInvoiceBreakdown(items.map((i) => ({ unit: i.price, qty: i.qty, gross: i.total })), 190, 0, 15);
const netItems = items.map((it, i) => ({ ...it, price: b.lines[i].unitNet, total: b.lines[i].net }));
const issuedAt = new Date("2026-10-01T02:30:00Z");
const qr = resolveZatcaQr({ odooQr: false, expected: { vatNumber: company.vat, total: 190, vatTotal: b.tax }, fallback: { sellerName: company.nameAr, issuedAtUtc: issuedAt } });
const partners = {
  before: { vat: false, x_vat_status: "unknown", x_legal_name: false, street: false, city: false },
  after: { vat: "310123456700003", x_vat_status: "registered", x_legal_name: "مؤسسة الوادي للتموين", street: "RRRD2929 الملز", city: "الرياض" },
};
const report: any = { at: new Date().toISOString(), cases: [] };
let ok = true;
const check = (label: string, cond: unknown, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; return !!cond; };
for (const [key, p] of Object.entries(partners)) {
  const buyer = buyerTaxInfo(p as any);
  const data: any = {
    issued: true, issuedAt, zatcaQr: { base64: qr.base64, fields: qr.fields, source: qr.source },
    invoiceNumber: `UTAK-INV-20261001-00${key === "before" ? 1 : 2}`, invoiceDate: new Date("2026-10-01T12:00:00Z"),
    customer: { name: buyer?.legalName || order.customer_name, address: buyer?.address || order.neighborhood, phone: order.phone, ...(buyer ? { vat: buyer.vat } : {}) },
    items: netItems, subtotal: b.subtotal, discount: 0, vatAmount: b.tax, grandTotal: 190,
  };
  const file = `invoice-vat-${key}-save.pdf`;
  console.log(`\n${file}`);
  const pdf = await generateInvoicePDF(data, env);
  writeFileSync(OUT + file, pdf);
  const text = execFileSync("pdftotext", ["-layout", OUT + file, "-"]).toString().replace(BIDI, "");
  // pdftotext splits the ر ligatures of this font («ضريبية» → «رضيبية», «شركة» → «رشكة»): read back as printed
  const flat = text.replace(/\s+/g, " ").replace(/رضيبية/g, "ضريبية").replace(/رشكة/g, "شركة");
  const checks: Record<string, boolean> = {};
  if (key === "before") {
    checks.simplified = check("«فاتورة ضريبية مبسطة»", flat.includes("فاتورة ضريبية مبسطة"));
    checks.orderName = check("the order's customer name «مطعم الوادي»", flat.includes("مطعم الوادي"));
    checks.district = check("the district «العليا»", flat.includes("العليا"));
    checks.noBuyerVat = check("no buyer VAT number", !flat.includes("310123456700003"));
  } else {
    checks.full = check("«فاتورة ضريبية» (not «مبسطة»)", flat.includes("فاتورة ضريبية") && !flat.includes("فاتورة ضريبية مبسطة"));
    checks.legalName = check("the establishment's official name «مؤسسة الوادي للتموين»", flat.includes("مؤسسة الوادي للتموين"));
    checks.vat = check("its VAT number 310123456700003", flat.includes("310123456700003"));
    checks.address = check("its address «RRRD2929 الملز، الرياض»", flat.includes("RRRD2929") && flat.includes("الملز") , (/.{0,30}RRRD2929.{0,30}/.exec(flat) ?? [""])[0]);
  }
  checks.sellerVat = check("the seller's VAT number", flat.includes(String(company.vat)));
  report.cases.push({ file: `scripts/artifacts/s44-sim/${file}`, checks });
}
report.ok = ok;
writeFileSync(OUT + "invoice-pdf.json", JSON.stringify(report, null, 2) + "\n");
console.log(ok ? "\nall checks passed" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
