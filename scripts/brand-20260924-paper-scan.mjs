// White-on-cream scan of every UTAK document (2026-09-24). Read-only on Odoo
// (readCompanyInfo only); nothing is created or posted, and any request to
// graph.facebook.com throws.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/brand-20260924-paper-scan.mjs [--tag=before|after] [--statements=<pdf>]
//
// Renders the seven documents through their production generators
// (Gotenberg) with the real company from Odoo (seal, signature, logo):
//   invoice (tax, with QR) · quotation · delivery note · receipt ·
//   purchase order · official doc (issued, every block type and tone) ·
//   financial statements (the newest scripts/artifacts/financial-statements-*.pdf,
//   or --statements=<pdf>; regenerate it first with `npm run statements`)
// then rasterizes every page at 100 dpi and lists every connected region of
// near-white pixels (R ≥ 250, G ≥ 250, B ≥ 248 — the paper #F7F5F0 is
// 247/245/240, so anti-aliased text and the paper itself never qualify).
// Regions under 6 px (≈ 1.5 mm²) are ignored as noise. It also reports whether
// the seal and signature images carry an alpha channel with transparent
// corners (an opaque image would paint its own background on the paper).
//
// Output: scripts/artifacts/brand-20260924-paper-<doc>-<tag>.pdf (git-ignored,
// they carry the seal) and brand-20260924-paper-scan-<tag>.json.
// Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg).

import { readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import sharp from "sharp";
import { readCompanyInfo } from "../src/company.ts";
import { generateInvoicePDF } from "../src/invoice.ts";
import { resolveZatcaQr } from "../src/zatca-qr.ts";
import { generateQuotationPDF, TEST_QUOTATION_DATA } from "../src/quotation.ts";
import { generateDeliveryNotePDF, TEST_DELIVERY_NOTE_DATA } from "../src/delivery-note.ts";
import { generateReceiptPDF, TEST_RECEIPT_DATA } from "../src/receipt.ts";
import { generatePurchaseOrderPDF, TEST_PURCHASE_ORDER_DATA } from "../src/purchase-order.ts";
import { generateOfficialDocPDF } from "../src/official-doc.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp send from a render check");
  return realFetch(input, init);
};
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const TAG = arg("tag") ?? "after";
const readEnv = (f) => Object.fromEntries(
  readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const env = { ...readEnv(".env.sim-verify"), ...readEnv(".env.zatca-oneoff") };
delete env.META_ACCESS_TOKEN;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
const company = await readCompanyInfo(env);

// ---------- embedded images: alpha ----------
async function alphaInfo(dataUri) {
  if (!dataUri) return null;
  const buf = Buffer.from(dataUri.split(",")[1], "base64");
  const img = sharp(buf);
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  const corners = [px(0, 0), px(info.width - 1, 0), px(0, info.height - 1), px(info.width - 1, info.height - 1)];
  let transparent = 0, opaqueWhite = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) transparent++;
    else if (data[i + 3] > 200 && data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 248) opaqueWhite++;
  }
  const n = data.length / 4;
  return { format: meta.format, width: meta.width, height: meta.height, hasAlpha: meta.hasAlpha, corners,
    transparentPct: +(100 * transparent / n).toFixed(1), opaqueWhitePct: +(100 * opaqueWhite / n).toFixed(2) };
}
const images = { stamp: await alphaInfo(company.stampImage), signature: await alphaInfo(company.signatureImage) };
console.log("seal:", JSON.stringify(images.stamp));
console.log("signature:", JSON.stringify(images.signature));

// ---------- the seven documents ----------
const customer = { name: "مطعم النخيل", contactPerson: "أ. محمد الشمري", address: "العليا، الرياض", phone: "+966 55 214 8830" };
const items = [
  { name: "طماطم شيري", pack: "كرتون ٨ كجم", qty: 6, price: 45, total: 270 },
  { name: "خيار بلدي", pack: "كرتون ٥ كجم", qty: 8, price: 28, total: 224 },
  { name: "خس آيسبرغ", pack: "كرتون ١٢ حبة", qty: 4, price: 55, total: 220 },
  { name: "ليمون بلدي", pack: "كرتون ١٠ كجم", qty: 5, price: 72, total: 360 },
];
const r2 = (n) => Math.round(n * 100) / 100;
const gross = r2(items.reduce((a, i) => a + i.total, 0));
const tax = r2(items.reduce((a, i) => a + r2((i.total * 15) / 115), 0));
const qr = resolveZatcaQr({ odooQr: false, expected: { vatNumber: company.vat, total: gross, vatTotal: tax },
  fallback: { sellerName: company.nameAr, issuedAtUtc: new Date("2026-10-01T07:15:00Z") } });
const invoiceData = { invoiceNumber: "UTAK-INV-20261001-001", invoiceDate: new Date("2026-10-01T12:00:00Z"), customer, items,
  subtotal: r2(gross - tax), discount: 0, vatAmount: tax, grandTotal: gross, issued: true, zatcaQr: { base64: qr.base64, fields: qr.fields, source: qr.source } };

const blk = (sequence, block_type, text, tone = "neutral") => ({ sequence, block_type, text, tone, align_numbers: true });
const officialRecord = {
  id: 1, name: "UTAK-L-2026-900", doc_type: "letter", recipient: "بنك الاختبار", recipient_label: "إلى", subject: "فحص الورق",
  date: new Date("2026-09-24T00:00:00Z"), status: "issued", ai_prompt: "", is_template: false, template_name: "",
  blocks: [
    blk(10, "heading", "عنوان القسم"),
    blk(20, "badge", "تنبيه", "warning"),
    blk(30, "paragraph", "فقرة تجريبية لفحص لون الورق تحت كل نوع من الكتل."),
    blk(40, "kv_card", "الاسم: شركة يوتاك\nالسجل: 7055194869", "success"),
    blk(50, "table", "البند | الكمية | المبلغ\nطماطم | 6 | 270\nالإجمالي | 6 | 270"),
    blk(60, "highlight_row", "الإجمالي | 1,074.00", "success"),
    blk(70, "notes", "ملاحظة أولى\nملاحظة ثانية", "warning"),
    blk(80, "signature", "براء الوصابي\nالمدير العام"),
    blk(90, "stamp", "شركة يوتاك"),
  ],
};

const docs = [
  ["invoice", () => generateInvoicePDF(invoiceData, env)],
  ["quotation", () => generateQuotationPDF({ ...TEST_QUOTATION_DATA, issued: true }, env)],
  ["delivery-note", () => generateDeliveryNotePDF({ ...TEST_DELIVERY_NOTE_DATA, issued: true }, env)],
  ["receipt", () => generateReceiptPDF({ ...TEST_RECEIPT_DATA, issued: true }, env)],
  ["purchase-order", () => generatePurchaseOrderPDF({ ...TEST_PURCHASE_ORDER_DATA, issued: true }, env)],
  ["official-doc", () => generateOfficialDocPDF({ record: officialRecord, company, isPreview: false }, env)],
];
const files = [];
for (const [key, gen] of docs) {
  const path = join(OUT, `brand-20260924-paper-${key}-${TAG}.pdf`);
  writeFileSync(path, await gen());
  files.push([key, path]);
}
const stmt = arg("statements") ?? readdirSync(OUT).filter((f) => /^financial-statements-.*\.pdf$/.test(f))
  .map((f) => join(OUT, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (stmt) files.push(["statements", stmt]);

// ---------- raster scan ----------
const DPI = 100;
const pxToMm = 25.4 / DPI;
function whiteRegions(png) {
  const { width: w, height: h, data } = png;
  const isWhite = (i) => data[i * 4] >= 250 && data[i * 4 + 1] >= 250 && data[i * 4 + 2] >= 248;
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !isWhite(s)) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const p = stack.pop(); const x = p % w, y = (p / w) | 0; area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        if (isWhite(q)) { seen[q] = 1; stack.push(q); }
      }
    }
    if (area >= 6) out.push({ xMm: +(minX * pxToMm).toFixed(1), yMm: +(minY * pxToMm).toFixed(1),
      wMm: +((maxX - minX + 1) * pxToMm).toFixed(1), hMm: +((maxY - minY + 1) * pxToMm).toFixed(1), px: area });
  }
  return out.sort((a, b) => b.px - a.px);
}
function paperSample(png) {
  // Median of a 5 mm patch at the page's left margin, mid-height.
  const { width: w, data } = png; const y0 = Math.round(png.height / 2), x0 = Math.round(5 / pxToMm);
  const vals = [];
  for (let y = y0; y < y0 + 10; y++) for (let x = x0; x < x0 + 10; x++) { const i = (y * w + x) * 4; vals.push(`${data[i]},${data[i + 1]},${data[i + 2]}`); }
  return vals.sort()[vals.length >> 1];
}
const report = { tag: TAG, images, docs: [] };
let total = 0;
for (const [key, path] of files) {
  const dir = mkdtempSync(join(tmpdir(), "utak-paper-"));
  execFileSync("pdftoppm", ["-r", String(DPI), "-png", path, join(dir, "p")]);
  const pages = [];
  for (const f of readdirSync(dir).sort()) {
    const png = PNG.sync.read(readFileSync(join(dir, f)));
    const regions = whiteRegions(png);
    pages.push({ page: pages.length + 1, paper: paperSample(png), whiteRegions: regions });
    total += regions.length;
  }
  report.docs.push({ doc: key, file: path, pages });
  const n = pages.reduce((a, p) => a + p.whiteRegions.length, 0);
  console.log(`\n${key}  (${pages.length} p, paper ${pages[0]?.paper})  → ${n} white region(s)`);
  for (const p of pages) for (const r of p.whiteRegions.slice(0, 8)) console.log(`   p${p.page}  x=${r.xMm}mm y=${r.yMm}mm  ${r.wMm}×${r.hMm}mm  (${r.px} px)`);
}
report.totalWhiteRegions = total;
writeFileSync(join(OUT, `brand-20260924-paper-scan-${TAG}.json`), JSON.stringify(report, null, 2) + "\n");
console.log(`\ntotal white regions: ${total} — report: scripts/artifacts/brand-20260924-paper-scan-${TAG}.json`);
