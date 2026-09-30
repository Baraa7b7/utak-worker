// Signature prep (2026-09-24): white-on-black source → black on transparent,
// cropped, ≥ 1500 px wide. Local only — nothing is sent to Odoo; upload with
//   node scripts/brand-20260924-stamp-setup.mjs --signature=<out>
//
//   node scripts/brand-20260924-signature-prep.mjs [--src=<png>] [--out=<png>]
//        [--low=48] [--high=200]
//
// Writes:
//   <out> (default: next to the source, signature-transparent.png — outside
//         the repo; the signature never goes into git)
//   scripts/artifacts/brand-20260924-signature-preview.png — the result over
//         white and over grey, to check the edges by eye (git-ignored)
//   scripts/artifacts/brand-20260924-signature-prep.json — sizes + checks

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import { DEFAULTS, prepSignature, checkTransparent, composite } from "./lib/signature-prep-core.mjs";

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const SRC = opt("src") ?? join(homedir(), "Desktop/Utak/ختم الشركة/signture.png");
const OUT = opt("out") ?? join(dirname(SRC), "signature-transparent.png");
const ART = new URL("./artifacts/", import.meta.url).pathname;
const o = { ...DEFAULTS };
if (opt("low")) o.low = Number(opt("low"));
if (opt("high")) o.high = Number(opt("high"));

const src = PNG.sync.read(readFileSync(SRC));
const { png, stats } = prepSignature(src, o);
const check = checkTransparent(png);
if (!check.ok) throw new Error(`signature is not clean black-on-transparent: ${JSON.stringify(check)}`);
if (png.width < 1500) throw new Error(`signature too narrow: ${png.width}px`);

const out = new PNG({ width: png.width, height: png.height, colorType: 6 });
png.data.copy(out.data);
writeFileSync(OUT, PNG.sync.write(out, { colorType: 6 }));

// Preview: over white, over light grey, over mid grey — stacked.
const GAP = 24;
const backs = [[255, 255, 255], [214, 214, 214], [128, 128, 128]];
const prev = new PNG({ width: png.width, height: backs.length * png.height + (backs.length - 1) * GAP });
prev.data.fill(255);
backs.forEach((rgb, k) => {
  const c = composite(png, rgb);
  c.data.copy(prev.data, k * (png.height + GAP) * png.width * 4);
});
const PREVIEW = join(ART, "brand-20260924-signature-preview.png");
writeFileSync(PREVIEW, PNG.sync.write(prev));

const report = { src: SRC, out: OUT, preview: PREVIEW, options: o, ...stats, transparentCheck: check };
writeFileSync(join(ART, "brand-20260924-signature-prep.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
