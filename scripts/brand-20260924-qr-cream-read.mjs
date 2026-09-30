// Read-back proof of the ZATCA QR on cream paper (2026-09-24). Read-only on
// Odoo (readCompanyInfo only); nothing is created or posted, and any request
// to graph.facebook.com throws.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/brand-20260924-qr-cream-read.mjs [--before=<pdf>]
//
// Renders a tax invoice through the production path (generateInvoicePDF →
// Gotenberg), then decodes its QR with jsQR from:
//   1. colour page at 300 dpi
//   2. greyscale page at 300 dpi               (an ordinary office printer)
//   3. greyscale page at 150 dpi               (a low-resolution print/scan)
//   4. 150 dpi greyscale, blurred + JPEG q=55  (a phone camera, harsher than asked)
// Each decoded text must equal the encoded base64 character for character,
// and its TLV must give the five expected fields. With --before=<pdf> (the
// same invoice rendered by the white-box code, from brand-20260924-paper-scan
// --tag=before) the old QR is decoded too and must be the identical text.
// Also samples the QR's light modules: they must be the paper colour, not white.
// Any failed read exits 1: the white background then has to come back.
//
// Output (scripts/artifacts/, git-ignored — the invoice carries the seal):
//   brand-20260924-qr-cream-invoice.pdf, brand-20260924-qr-cream-zoom.png
//   (the QR area at 600 dpi next to the old white box when --before is given),
//   brand-20260924-qr-cream-read.json
// Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg).

import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jsQR from "jsqr";
import sharp from "sharp";
import { readCompanyInfo } from "../src/company.ts";
import { generateInvoicePDF } from "../src/invoice.ts";
import { resolveZatcaQr, parseZatcaQr } from "../src/zatca-qr.ts";
import { BRAND_COLORS } from "../src/pdf-template.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp send from a render check");
  return realFetch(input, init);
};
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const readEnv = (f) => Object.fromEntries(
  readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const env = { ...readEnv(".env.sim-verify"), ...readEnv(".env.zatca-oneoff") };
delete env.META_ACCESS_TOKEN;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
const TMP = mkdtempSync(join(tmpdir(), "utak-qrread-"));
const company = await readCompanyInfo(env);

// Same invoice as brand-20260924-paper-scan (so --before is comparable).
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
const expected = qr.base64;
const pdfPath = join(OUT, "brand-20260924-qr-cream-invoice.pdf");
writeFileSync(pdfPath, await generateInvoicePDF({ invoiceNumber: "UTAK-INV-20261001-001", invoiceDate: new Date("2026-10-01T12:00:00Z"),
  customer, items, subtotal: r2(gross - tax), discount: 0, vatAmount: tax, grandTotal: gross, issued: true,
  zatcaQr: { base64: qr.base64, fields: qr.fields, source: qr.source } }, env));

let ok = true;
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const raster = (pdf, dpi, name, gray) => {
  execFileSync("pdftoppm", ["-r", String(dpi), ...(gray ? ["-gray"] : []), "-png", "-f", "1", "-l", "1", "-singlefile", pdf, join(TMP, name)]);
  return join(TMP, `${name}.png`);
};
async function decode(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}
const firstDiff = (a, b) => { if (a === null) return "no read"; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `first difference at char ${i}`; return "identical"; };

const reads = [];
async function readCase(label, file) {
  const text = await decode(file);
  const f = text ? parseZatcaQr(text) : null;
  console.log(`\n${label}`);
  check("QR decoded", text !== null);
  check(`text = encoded base64, character for character (${expected.length} chars)`, text === expected, firstDiff(text, expected));
  check("TLV → the five expected fields", JSON.stringify(f) === JSON.stringify(qr.fields));
  if (f) console.log(`    ${f.sellerName} | ${f.vatNumber} | ${f.timestamp} | ${f.total} | ${f.vatTotal}`);
  reads.push({ case: label, text, equalsExpected: text === expected, fields: f });
}

const color300 = raster(pdfPath, 300, "color300", false);
const gray300 = raster(pdfPath, 300, "gray300", true);
const gray150 = raster(pdfPath, 150, "gray150", true);
const phone = join(TMP, "phone.jpg");
await sharp(gray150).blur(0.8).jpeg({ quality: 55 }).toFile(phone);
await readCase("1. colour, 300 dpi", color300);
await readCase("2. greyscale, 300 dpi (printer)", gray300);
await readCase("3. greyscale, 150 dpi (low-res print / scan)", gray150);
await readCase("4. greyscale 150 dpi + blur 0.8 + JPEG q55 (phone camera)", phone);

// Light modules = paper. The QR box is found from its dark modules at 300 dpi.
{
  const { data, info } = await sharp(color300).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(await sharp(color300).ensureAlpha().raw().toBuffer()), info.width, info.height);
  const L = code.location;
  // Quiet zone: 2 modules outside the top-left finder, and the centre of the
  // finder's inner light ring (module 1,1 from its corner).
  const mod = Math.hypot(L.topRightFinderPattern.x - L.topLeftFinderPattern.x, L.topRightFinderPattern.y - L.topLeftFinderPattern.y) / (code.version * 4 + 17 - 7);
  const px = (x, y) => { const i = (Math.round(y) * info.width + Math.round(x)) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const quiet = px(L.topLeftCorner.x - 2 * mod, L.topLeftCorner.y - 2 * mod);
  const ring = px(L.topLeftCorner.x + 1.5 * mod, L.topLeftCorner.y + 1.5 * mod);
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
  console.log(`\nlight modules`);
  check(`quiet zone = paper ${BRAND_COLORS.bgPage}`, hex(quiet) === BRAND_COLORS.bgPage, hex(quiet));
  check(`light module inside the code = paper ${BRAND_COLORS.bgPage}`, hex(ring) === BRAND_COLORS.bgPage, hex(ring));
  check("neither is white", hex(quiet) !== "#FFFFFF" && hex(ring) !== "#FFFFFF");
  reads.push({ lightModules: { quietZone: hex(quiet), insideCode: hex(ring) } });

  // Zoom: the QR area at 600 dpi (≈ 36 mm square around the 30 mm code).
  const zoomOf = async (pdf, name) => {
    const r = 600 / 300;
    const x = Math.round((L.topLeftCorner.x - 8 * mod) * r), y = Math.round((L.topLeftCorner.y - 8 * mod) * r);
    const side = Math.round((L.topRightCorner.x - L.topLeftCorner.x + 16 * mod) * r);
    execFileSync("pdftoppm", ["-r", "600", "-png", "-f", "1", "-l", "1", "-singlefile", "-x", String(x), "-y", String(y), "-W", String(side), "-H", String(side), pdf, join(TMP, name)]);
    return join(TMP, `${name}.png`);
  };
  const after = await zoomOf(pdfPath, "zoom-after");
  const before = arg("before") ? await zoomOf(arg("before"), "zoom-before") : null;
  const zoomPath = join(OUT, "brand-20260924-qr-cream-zoom.png");
  if (before) {
    const meta = await sharp(after).metadata();
    await sharp({ create: { width: meta.width * 2 + 40, height: meta.height, channels: 3, background: BRAND_COLORS.bgOuter } })
      .composite([{ input: before, left: 0, top: 0 }, { input: after, left: meta.width + 40, top: 0 }]).png().toFile(zoomPath);
    console.log(`  zoom: before (left, white box) | after (right, cream) → ${zoomPath}`);
  } else {
    await sharp(after).png().toFile(zoomPath);
  }
}

if (arg("before")) {
  const oldText = await decode(raster(arg("before"), 300, "before300", false));
  console.log("\nbefore (white-box QR, same invoice)");
  check("old QR text = new QR text (TLV unchanged)", oldText === expected, firstDiff(oldText, expected));
  reads.push({ case: "before (white box), colour 300 dpi", text: oldText, equalsExpected: oldText === expected });
}

writeFileSync(join(OUT, "brand-20260924-qr-cream-read.json"), JSON.stringify({ pdf: pdfPath, expected, fields: qr.fields, reads, ok }, null, 2) + "\n");
console.log(`\n${ok ? "OK" : "FAIL — restore the white QR background"} — report: scripts/artifacts/brand-20260924-qr-cream-read.json`);
if (!ok) process.exit(1);
