// Visual + machine check of the ZATCA QR and the company seal (2026-09-24).
// Read-only on Odoo (readCompanyInfo only); no record is created, nothing is
// posted, and any request to graph.facebook.com throws.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/brand-20260924-render-samples.mjs
//
// Renders three invoices through the production path (generateInvoicePDF →
// Gotenberg, with the page-number footer), then for each PDF:
//   - rasterizes every page (pdftoppm, 300 dpi) and decodes the QR with jsQR
//   - checks the decoded TLV against the expected five fields
//   - checks the printed values (pdftotext) contain those same strings
//   - lists embedded images per page (pdfimages) → the seal's page
// Sample data only: Odoo refuses to post a future-dated (post-10-01)
// invoice, so the tax invoices carry a locally encoded QR (same encoder the
// worker falls back to, byte-identical to l10n_sa's — tests/zatca-qr).
//
// Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg).

import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { generateInvoicePDF } from "../src/invoice.ts";
import { resolveZatcaQr, parseZatcaQr } from "../src/zatca-qr.ts";
import { readCompanyInfo } from "../src/company.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp send from a render check");
  return realFetch(input, init);
};

const readEnv = (f) => Object.fromEntries(
  readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const env = { ...readEnv(".env.sim-verify"), ...readEnv(".env.zatca-oneoff") };
delete env.META_ACCESS_TOKEN;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
const company = await readCompanyInfo(env);
console.log(`company: ${company.nameAr} · VAT ${company.vat} · CR ${company.cr} · stamp ${company.stampImage ? Math.round(company.stampImage.length / 1024) + "KB" : "NONE"} · signature ${company.signatureImage ? "yes" : "none"}`);

const customer = { name: "مطعم النخيل", contactPerson: "أ. محمد الشمري", address: "العليا، الرياض", phone: "+966 55 214 8830" };
const round2 = (n) => Math.round(n * 100) / 100;
function taxSplit(items) {
  // Worker rule: VAT-inclusive prices, VAT per line = round(total × 15/115).
  const gross = round2(items.reduce((a, i) => a + i.total, 0));
  const tax = round2(items.reduce((a, i) => a + round2((i.total * 15) / 115), 0));
  return { gross, tax, net: round2(gross - tax) };
}
function qrFor(gross, tax, issuedAtUtc) {
  const q = resolveZatcaQr({ odooQr: false, expected: { vatNumber: company.vat, total: gross, vatTotal: tax }, fallback: { sellerName: company.nameAr, issuedAtUtc } });
  return { base64: q.base64, fields: q.fields, source: q.source };
}

const short = [
  { name: "طماطم شيري", pack: "كرتون ٨ كجم", qty: 6, price: 45, total: 270 },
  { name: "خيار بلدي", pack: "كرتون ٥ كجم", qty: 8, price: 28, total: 224 },
  { name: "خس آيسبرغ", pack: "كرتون ١٢ حبة", qty: 4, price: 55, total: 220 },
  { name: "ليمون بلدي", pack: "كرتون ١٠ كجم", qty: 5, price: 72, total: 360 },
];
const forty = Array.from({ length: 40 }, (_, i) => {
  const qty = 1 + (i % 5), price = 20 + i;
  return { name: `صنف ${i + 1} — خضار طازجة`, pack: i % 2 ? "كرتون" : "كيس ١٠ كجم", qty, price, total: qty * price };
});

const cases = [];
{
  const s = taxSplit(short);
  const qr = qrFor(s.gross, s.tax, new Date("2026-10-01T07:15:00Z"));
  cases.push({ file: "brand-20260924-invoice-tax-qr-seal.pdf", expectQr: qr.fields, expectPagesMin: 1, expectPagesMax: 1,
    data: { invoiceNumber: "UTAK-INV-20261001-001", invoiceDate: new Date("2026-10-01T12:00:00Z"), customer, items: short, subtotal: s.net, discount: 0, vatAmount: s.tax, grandTotal: s.gross, issued: true, zatcaQr: qr } });
}
{
  const s = taxSplit(forty);
  const qr = qrFor(s.gross, s.tax, new Date("2026-10-02T06:40:12Z"));
  cases.push({ file: "brand-20260924-invoice-40-items.pdf", expectQr: qr.fields, expectPagesMin: 2, expectPagesMax: 3, rows: 40,
    data: { invoiceNumber: "UTAK-INV-20261002-001", invoiceDate: new Date("2026-10-02T12:00:00Z"), customer, items: forty, subtotal: s.net, discount: 0, vatAmount: s.tax, grandTotal: s.gross, issued: true, zatcaQr: qr } });
}
{
  const gross = short.reduce((a, i) => a + i.total, 0);
  cases.push({ file: "brand-20260924-invoice-pre-cutoff-no-vat.pdf", expectQr: null, expectPagesMin: 1, expectPagesMax: 1,
    data: { invoiceNumber: "UTAK-INV-20260930-001", invoiceDate: new Date("2026-09-30T12:00:00Z"), customer, items: short, subtotal: gross, discount: 0, vatAmount: 0, grandTotal: gross, issued: true } });
}

let ok = true;
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const report = [];

for (const c of cases) {
  console.log(`\n${c.file}`);
  const pdf = await generateInvoicePDF(c.data, env);
  const path = OUT + c.file;
  writeFileSync(path, pdf);
  const pages = Number(execFileSync("pdfinfo", [path]).toString().match(/Pages:\s+(\d+)/)[1]);
  check(`pages ${pages} in [${c.expectPagesMin}, ${c.expectPagesMax}]`, pages >= c.expectPagesMin && pages <= c.expectPagesMax);

  // QR: scan every page
  const dir = mkdtempSync(join(tmpdir(), "utak-qr-"));
  execFileSync("pdftoppm", ["-r", "300", "-png", path, join(dir, "p")]);
  const found = [];
  for (const f of readdirSync(dir).sort()) {
    const png = PNG.sync.read(readFileSync(join(dir, f)));
    const hit = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    if (hit) found.push({ page: f, text: hit.data });
  }
  // pdftotext wraps RTL/LTR runs in bidi controls — strip them before matching.
  const text = execFileSync("pdftotext", ["-layout", path, "-"]).toString().replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  if (c.expectQr) {
    check("exactly one QR found", found.length === 1, found.map((x) => x.page).join(","));
    const decoded = found[0] ? parseZatcaQr(found[0].text) : null;
    check("scanned TLV decodes to 5 fields", decoded !== null);
    for (const k of ["sellerName", "vatNumber", "timestamp", "total", "vatTotal"]) {
      check(`scanned ${k} = expected «${c.expectQr[k]}»`, decoded?.[k] === c.expectQr[k], decoded ? `got «${decoded[k]}»` : "");
    }
    for (const k of ["vatNumber", "timestamp", "total", "vatTotal"]) {
      check(`printed on the PDF: ${k} ${c.expectQr[k]}`, text.includes(c.expectQr[k]));
    }
    report.push({ file: path, pages, qrPage: found[0]?.page, qrText: found[0]?.text, decoded });
  } else {
    check("no QR on a tax-free invoice", found.length === 0);
    check("no VAT row printed", !text.includes("15%") && !text.includes("١٥٪"));
    report.push({ file: path, pages, qrText: null });
  }
  if (c.rows) {
    const got = new Set((text.match(/صنف\s+—\s+(\d+)|صنف\s+(\d+)/g) ?? []).map((s) => s.match(/\d+/)[0]));
    check(`all ${c.rows} rows printed (pdftotext)`, got.size === c.rows, `got ${got.size}`);
  }
  // Seal: embedded raster images per page (logo + QR are vector)
  const imgs = execFileSync("pdfimages", ["-list", path]).toString().split("\n").slice(2).filter(Boolean)
    .map((l) => l.trim().split(/\s+/)).map((cols) => ({ page: Number(cols[0]), w: Number(cols[3]), h: Number(cols[4]), type: cols[2] }));
  const seal = imgs.filter((i) => i.type === "image" && i.w === 709 && i.h === 709);
  check("seal image embedded once", seal.length === 1, JSON.stringify(imgs));
  check("seal on the last page", seal[0]?.page === pages, `page ${seal[0]?.page} of ${pages}`);
  report[report.length - 1].sealPage = seal[0]?.page;
}

writeFileSync(OUT + "brand-20260924-render-samples.json", JSON.stringify(report, null, 2) + "\n");
console.log(`\n${ok ? "OK" : "FAIL"} — report: scripts/artifacts/brand-20260924-render-samples.json`);
if (!ok) process.exit(1);
