// § 64 (2026-10-07) — the sample PDFs of § 62 د's leftovers, each through its production generator (the company
// and its bank line from Odoo, then Gotenberg):
//
//   1  s00016-preview   «👁️ معاينة PDF» of the sale order S00016 as the worker serves it (buildPreviewPdf): one sheet,
//                       each line's pack = «التعبئة» of SQ-0002's line (x_pack_text — after `--only=ui --apply`)
//   2  qty-27           twenty-seven lines: two sheets, the SECOND starting under the first's top padding (20 mm);
//                       the first sheet holding what it held (all twenty-seven lines)
//   3  qty-40           forty lines: the second sheet starts inside the table, under the same padding
//   4  sq0002-preview   «👁️ معاينة PDF» of SQ-0002: one sheet, as before
//
// READ-ONLY on Odoo: any request that is not a read is refused before it leaves; any graph.facebook.com request
// throws. Nothing is sent, nothing is uploaded, nothing is issued.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s64-20261007-samples.mjs
//
// Out: scripts/artifacts/q64-20261007-<key>.pdf (git-ignored), every page as PNG beside it, and
// scripts/artifacts/q64-20261007-samples.json. Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg),
// pdfinfo / pdftotext / pdftoppm, and python3 with PIL (the top of a sheet is measured on its picture).

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readCompanyInfoWithBank } from "../src/company.ts";
import { generateQuotationPDF } from "../src/quotation.ts";
import { previewSpecialQuotation, specialQuotationData } from "../src/special-quotation.ts";
import { readQuote } from "../src/special-quote.ts";
import { buildQuotationPDFDataFromSaleOrder } from "../src/sale-order-quotation.ts";
import { buildPreviewPdf } from "../src/quote-preview.ts";
import { call } from "../src/odoo.ts";

const READS = new Set(["read", "search_read", "search", "search_count", "fields_get", "name_search"]);
const realFetch = globalThis.fetch;
let lastPage = "";
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp send from a render check");
  if (url.includes("/forms/chromium/convert/html") && typeof init?.body?.getAll === "function") {
    const page = init.body.getAll("files").find((f) => f?.name === "index.html");
    if (page) lastPage = await page.text();
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && !READS.has(m[2])) throw new Error(`BLOCKED: ${m[1]}.${m[2]} is not a read`);
  return realFetch(input, init);
};
const readEnv = (f) => Object.fromEntries(readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const kv = new Map();
const env = { ...readEnv(".env.sim-verify"), ...readEnv(".env.zatca-oneoff"), MSG_DEDUP: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } } };
delete env.META_ACCESS_TOKEN;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
const now = Date.now();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));

const company = await readCompanyInfoWithBank(env);
console.log(`company: «${company.legalNameAr || company.nameAr}» · bank line ${company.bankLine ? "yes" : "none"}`);
const SQ = 2;
const q = await readQuote(env, SQ);
if (!q) throw new Error("SQ-0002 is not there");
await pause();
const [so16] = await call(env, "sale.order", "search_read", { domain: [["name", "=", "S00016"]], fields: ["id", "name", "state"], limit: 1 });
if (!so16) throw new Error("S00016 is not there");
const so16data = await buildQuotationPDFDataFromSaleOrder(env, so16.id);
await pause();
const packs = q.lines.map((l) => l.unit);
console.log(`SQ-0002: ${q.lines.length} lines, «التعبئة»: ${packs.join(" | ")}`);
console.log(`S00016 #${so16.id} (${so16.state}): ${so16data.items.length} lines, packs printed: ${so16data.items.map((i) => i.pack).join(" | ")}`);

const byQty = (n, number) => specialQuotationData({
  partnerId: 0, priceMode: "net", layout: "auto", validUntil: new Date(now + 24 * 3600_000).toISOString().slice(0, 19).replace("T", " "), alternatives: "",
  lines: Array.from({ length: n }, (_, i) => ({ productName: `صنف ${i + 1}`, unit: i % 6 === 5 ? "كرتون 18 كجم" : "كيلو", qty: 20 + i * 7, finalNet: round2(3 + i * 0.25), finalPrice: round2((3 + i * 0.25) * 1.15), origin: "", size: "" })),
}, number, { name: "شركة العيّنة للأغذية", address: "الرياض", phone: "+966 50 000 0000" }, now);

/** The first row of a sheet's picture that is not paper, in mm from its top (100 dpi), and the paper's colour at its corner. */
function topInk(png) {
  const out = execFileSync("python3", ["-c", `
from PIL import Image
import sys, json
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
paper = im.getpixel((3, 3))
def ink(y):
    return any(sum(abs(a - b) for a, b in zip(im.getpixel((x, y)), paper)) > 60 for x in range(0, w, 2))
first = next((y for y in range(h) if ink(y)), -1)
print(json.dumps({"first_px": first, "mm": round(first / (100 / 25.4), 1), "paper": "#%02x%02x%02x" % paper, "h": h}))
`, png], { encoding: "utf8" });
  return JSON.parse(out);
}

const cases = [
  { key: "s00016-preview", what: "S00016 من أمر البيع — معاينة بعبوات SQ-0002", pdf: async () => { const r = await buildPreviewPdf(env, "so", so16.id, now); if (!r || !("pdf" in r)) throw new Error(`preview: ${JSON.stringify(r)}`); return r.pdf; }, pages: 1, packs },
  { key: "qty-27", what: "27 سطراً — حشوة الصفحة الثانية", pdf: () => generateQuotationPDF(byQty(27, "S-SAMPLE-27"), env), pages: 2, rows: 27, firstSheetRows: 27 },
  { key: "qty-40", what: "40 سطراً — الصفحة الثانية تبدأ داخل الجدول", pdf: () => generateQuotationPDF(byQty(40, "S-SAMPLE-40"), env), pages: 2, rows: 40, firstSheetRows: 34 },
  { key: "sq0002-preview", what: "SQ-0002 — معاينة (صفحة واحدة)", pdf: async () => { const r = await previewSpecialQuotation(env, SQ, now); if (!r || !("pdf" in r)) throw new Error(`preview: ${JSON.stringify(r)}`); return r.pdf; }, pages: 1 },
];
let bad = 0;
const check = (name, cond, detail = "") => { if (!cond) bad++; console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : ` — ${detail}`}`); };
const report = [];
for (const c of cases) {
  lastPage = "";
  const pdf = await c.pdf();
  const path = `${OUT}q64-20261007-${c.key}.pdf`;
  writeFileSync(path, pdf);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path], { encoding: "utf8" }))[1]);
  execFileSync("pdftoppm", ["-png", "-r", "100", path, path.replace(/\.pdf$/, "")]);
  console.log(`${c.key} — ${c.what}: ${pages} page(s), ${pdf.length} bytes`);
  check(`${c.pages === 1 ? "one sheet" : `${c.pages} sheets`}`, pages === c.pages, String(pages));
  check("the page handed to the PDF service repeats its padding at every sheet, the room under its foot 6 mm", lastPage.includes("box-decoration-break: clone") && lastPage.includes(".utak-page > [data-utak=page-foot] { margin-bottom: 6mm !important; }"));
  const first = topInk(path.replace(/\.pdf$/, pages > 9 ? "-01.png" : "-1.png"));
  // the first sheet's first ink is the header, under the page's own 20 mm (its logo starts a little under the line)
  check(`sheet 1 starts under its 20 mm top padding (first ink at ${first.mm} mm), on paper ${first.paper}`, first.mm >= 19 && first.mm <= 26, JSON.stringify(first));
  if (pages > 1) {
    const second = topInk(path.replace(/\.pdf$/, "-2.png"));
    check(`sheet 2 starts under the SAME top padding (first ink at ${second.mm} mm — it was 0 mm), on the same paper`, second.mm >= 19 && second.mm <= 26 && second.paper === first.paper, JSON.stringify(second));
    // the first sheet holds what it held: its rows are counted by their quantities (20 + 7i — pdftotext reads no Arabic, and wraps a number in direction marks)
    const text1 = execFileSync("pdftotext", ["-f", "1", "-l", "1", "-layout", path, "-"], { encoding: "utf8" });
    const text2 = execFileSync("pdftotext", ["-f", "2", "-l", "2", "-layout", path, "-"], { encoding: "utf8" });
    const qtyOf = (i) => String(20 + i * 7);
    const on = (text) => Array.from({ length: c.rows }, (_, i) => i).filter((i) => new RegExp(`(^|[^0-9.,])${qtyOf(i)}([^0-9.,]|$)`, "m").test(text)).length;
    check(`sheet 1 holds ${c.firstSheetRows} of the ${c.rows} lines, as before § 64 (the rest on sheet 2: ${c.rows - c.firstSheetRows})`, on(text1) === c.firstSheetRows && on(text2) === c.rows - c.firstSheetRows, `${on(text1)} / ${on(text2)}`);
  }
  if (c.packs) {
    const cell = (t) => lastPage.includes(`>${t}<`);
    check(`each line prints SQ-0002's «التعبئة» (${c.packs.length}): ${c.packs.join(" | ")}`, c.packs.every(cell), `not printed: ${c.packs.filter((p) => !cell(p)).join(" | ") || "—"} (before \`--only=ui --apply\` the lines carry no «التعبئة» yet)`);
  }
  report.push({ key: c.key, what: c.what, file: `scripts/artifacts/q64-20261007-${c.key}.pdf`, pages, bytes: pdf.length });
  await pause(500);
}
writeFileSync(`${OUT}q64-20261007-samples.json`, JSON.stringify({ at: new Date().toISOString(), report }, null, 2) + "\n");
console.log(bad ? `\n✗ ${bad} check(s) failed` : "\nall checks passed");
process.exit(bad ? 1 : 0);
