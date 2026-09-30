// UTAK logo on a transparent background (2026-09-24).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/brand-20260924-logo-prep.mjs
//
// Before: every document printed utak-avatar-light.svg — the mark on a
// #F7F5F0 square (not transparent). The documents now embed the vector icon
// itself (src/pdf-template.ts::UTAK_LOGO_SVG, from the kit's
// utak-icon-color.svg): no background element, same geometry, same colours.
// No threshold is needed for a vector: the background is an element and is
// simply not there.
//
// This script:
//   1. checks UTAK_LOGO_SVG against the kit file (same path, same two fills)
//      and that it has no background element;
//   2. rasterises it with Chromium (Gotenberg screenshot, omitBackground) at
//      2048 px — the same engine that prints the PDFs, no colour conversion;
//   3. trims to the ink with a 24 px margin and writes a transparent PNG next
//      to the kit (outside the repo — no images in git):
//        ~/Desktop/Utak/logos kit/png/utak-icon-color-transparent.png
//   4. verifies: corners alpha 0, every opaque pixel is exactly #1E5A41 or
//      #E07B39, and writes a preview on cream / white / grey
//      (scripts/artifacts/brand-20260924-logo-preview.png, git-ignored) and a
//      report (scripts/artifacts/brand-20260924-logo-prep.json).
// Needs .env.zatca-oneoff (Gotenberg).

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { PNG } from "pngjs";
import { BRAND_COLORS, UTAK_LOGO_SVG, UTAK_LOGO_DATA_URL } from "../src/pdf-template.ts";
import { analyzeLogoPng, svgHasBackground } from "./lib/logo-core.mjs";

const KIT = `${homedir()}/Desktop/Utak/logos kit`;
const SRC_SVG = `${KIT}/svg/utak-icon-color.svg`;
const OLD_SVG = `${KIT}/svg/utak-avatar-light.svg`;
const OUT_PNG = `${KIT}/png/utak-icon-color-transparent.png`;
const ART = new URL("./artifacts/", import.meta.url).pathname;
const SIZE = 2048;
const MARGIN = 24;

const readEnv = (f) => Object.fromEntries(
  readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const env = readEnv(".env.zatca-oneoff");

// 1. source check
const norm = (s) => s.replace(/<g transform="translate\(0,0\) scale\(1\.0\)">|<\/g>/g, "").replace(/\s+/g, " ").trim();
const kit = readFileSync(SRC_SVG, "utf8");
if (norm(kit) !== norm(UTAK_LOGO_SVG)) throw new Error("UTAK_LOGO_SVG differs from the kit's utak-icon-color.svg");
const old = readFileSync(OLD_SVG, "utf8");
console.log(`before: ${OLD_SVG} — background element: ${svgHasBackground(old)}`);
console.log(`after:  UTAK_LOGO_SVG (= ${SRC_SVG}) — background element: ${svgHasBackground(UTAK_LOGO_SVG)}`);
if (svgHasBackground(UTAK_LOGO_SVG)) throw new Error("the document logo still has a background");

// 2. rasterise in Chromium, transparent
const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent}img{display:block;width:${SIZE}px;height:${SIZE}px}</style></head><body><img src="${UTAK_LOGO_DATA_URL}"></body></html>`;
const fd = new FormData();
fd.append("files", new Blob([html], { type: "text/html" }), "index.html");
fd.append("width", String(SIZE));
fd.append("height", String(SIZE));
fd.append("clip", "true");
fd.append("format", "png");
fd.append("omitBackground", "true");
const res = await fetch(`${env.GOTENBERG_URL}/forms/chromium/screenshot/html`, {
  method: "POST", body: fd,
  headers: { Authorization: "Basic " + btoa(`${env.GOTENBERG_USER}:${env.GOTENBERG_PASSWORD}`) },
});
if (!res.ok) throw new Error(`Gotenberg screenshot ${res.status}: ${await res.text()}`);
const raw = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
console.log(`raster: ${raw.width}×${raw.height}`);

// 3. trim to the ink + margin
let x0 = raw.width, y0 = raw.height, x1 = -1, y1 = -1;
for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
  if (raw.data[(y * raw.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
}
if (x1 < 0) throw new Error("empty raster");
const w = x1 - x0 + 1 + 2 * MARGIN, h = y1 - y0 + 1 + 2 * MARGIN;
const out = new PNG({ width: w, height: h });
out.data.fill(0);
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
  const s = (y * raw.width + x) * 4, d = ((y - y0 + MARGIN) * w + (x - x0 + MARGIN)) * 4;
  raw.data.copy(out.data, d, s, s + 4);
}
const bytes = PNG.sync.write(out);
writeFileSync(OUT_PNG, bytes);

// 4. verify + preview
const a = analyzeLogoPng(PNG.sync.read(bytes), [BRAND_COLORS.primary, BRAND_COLORS.accent]);
console.log(`png: ${OUT_PNG} — ${w}×${h}, ${bytes.length} bytes`);
console.log(`  corners alpha ${JSON.stringify(a.cornerAlpha)} · transparent ${(a.transparentShare * 100).toFixed(1)}% · opaque pixels off-brand ${a.opaqueOffBrand} of ${a.opaque} · colours ${JSON.stringify(a.opaqueColours)}`);
if (!a.transparent) throw new Error("PNG is not transparent at the corners");
if (a.opaqueOffBrand) throw new Error("opaque pixels outside the two brand colours");

const bgs = [BRAND_COLORS.bgPage, "#FFFFFF", "#9A9A9A"].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const pw = 600, scale = pw / w, ph = Math.round(h * scale);
const prev = new PNG({ width: pw * bgs.length, height: ph });
bgs.forEach((bg, k) => {
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const s = (Math.min(h - 1, Math.floor(y / scale)) * w + Math.min(w - 1, Math.floor(x / scale))) * 4;
    const al = out.data[s + 3] / 255, d = (y * prev.width + k * pw + x) * 4;
    for (let c = 0; c < 3; c++) prev.data[d + c] = Math.round(out.data[s + c] * al + bg[c] * (1 - al));
    prev.data[d + 3] = 255;
  }
});
const previewPath = `${ART}brand-20260924-logo-preview.png`;
writeFileSync(previewPath, PNG.sync.write(prev));
const report = { before: { file: OLD_SVG, background: svgHasBackground(old) }, after: { svg: SRC_SVG, background: false, png: OUT_PNG, width: w, height: h, bytes: bytes.length, ...a }, preview: previewPath };
writeFileSync(`${ART}brand-20260924-logo-prep.json`, JSON.stringify(report, null, 2) + "\n");
console.log(`preview: ${previewPath}`);
