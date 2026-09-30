// Visual + machine check of the seal + signature on the quotation, delivery
// note, receipt and purchase order (2026-09-24). Read-only on Odoo
// (readCompanyInfo); any graph.facebook.com request throws.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//        scripts/brand-20260924-render-docs.mjs
//
// For each document, through its production generator (Gotenberg, page-number
// footer) with the built-in test data and the real company from Odoo:
//   issued copy → scripts/artifacts/brand-20260924-<doc>-issued.pdf (git-ignored)
//     one page; seal (709 px) + signature (≥ 1500 px) embedded on it; the
//     signatory's name and title printed
//   draft copy  → temp only: one page, no seal, no signature, no name line
// Needs .env.sim-verify (Odoo) and .env.zatca-oneoff (Gotenberg).

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCompanyInfo } from "../src/company.ts";
import { generateQuotationPDF, TEST_QUOTATION_DATA } from "../src/quotation.ts";
import { generateDeliveryNotePDF, TEST_DELIVERY_NOTE_DATA } from "../src/delivery-note.ts";
import { generateReceiptPDF, TEST_RECEIPT_DATA } from "../src/receipt.ts";
import { generatePurchaseOrderPDF, TEST_PURCHASE_ORDER_DATA } from "../src/purchase-order.ts";
import { SIGNATORY } from "../src/pdf-template.ts";

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
const TMP = mkdtempSync(join(tmpdir(), "utak-docs-"));

const company = await readCompanyInfo(env);
console.log(`company: ${company.nameAr} · stamp ${company.stampImage ? "yes" : "NONE"} · signature ${company.signatureImage ? "yes" : "NONE"} · address «${company.address}»`);

const docs = [
  { key: "quotation", gen: generateQuotationPDF, data: TEST_QUOTATION_DATA },
  { key: "delivery-note", gen: generateDeliveryNotePDF, data: TEST_DELIVERY_NOTE_DATA },
  { key: "receipt", gen: generateReceiptPDF, data: TEST_RECEIPT_DATA },
  { key: "purchase-order", gen: generatePurchaseOrderPDF, data: TEST_PURCHASE_ORDER_DATA },
];

let ok = true;
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const inspect = (path) => {
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path], { encoding: "utf8" }))[1]);
  const imgs = execFileSync("pdfimages", ["-list", path], { encoding: "utf8" }).split("\n").slice(2).filter(Boolean)
    .map((l) => l.trim().split(/\s+/)).map((c) => ({ page: Number(c[0]), type: c[2], w: Number(c[3]), h: Number(c[4]) }))
    .filter((i) => i.type === "image");
  const text = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" }).replace(/[‎‏‪-‮⁦-⁩]/g, "");
  return { pages, imgs, text };
};
const report = [];
for (const d of docs) {
  console.log(`\n${d.key}`);
  const issuedPath = join(OUT, `brand-20260924-${d.key}-issued.pdf`);
  writeFileSync(issuedPath, await d.gen({ ...d.data, issued: true }, env));
  const draftPath = join(TMP, `${d.key}-draft.pdf`);
  writeFileSync(draftPath, await d.gen({ ...d.data, issued: false }, env));
  const a = inspect(issuedPath), b = inspect(draftPath);
  const stamp = a.imgs.filter((i) => i.w === 709 && i.h === 709);
  const sig = a.imgs.filter((i) => i.w >= 1500 && i.w !== 709);
  check("issued: one page", a.pages === 1, `${a.pages}`);
  check("issued: seal embedded on page 1", stamp.length === 1 && stamp[0].page === 1, JSON.stringify(a.imgs));
  check("issued: signature embedded on page 1", sig.length === 1 && sig[0].page === 1);
  check("issued: signatory name + title (English)", a.text.includes(SIGNATORY.en));
  check("issued: signatory title (Arabic)", a.text.includes("المدير العام") || a.text.includes("العام المدير"));
  check("draft: one page", b.pages === 1, `${b.pages}`);
  check("draft: no seal, no signature", b.imgs.length === 0, JSON.stringify(b.imgs));
  check("draft: no signatory line", !b.text.includes(SIGNATORY.en));
  report.push({ doc: d.key, issued: { file: issuedPath, pages: a.pages, images: a.imgs }, draft: { pages: b.pages, images: b.imgs } });
}
writeFileSync(join(OUT, "brand-20260924-render-docs.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`\n${ok ? "OK" : "FAIL"} — report: scripts/artifacts/brand-20260924-render-docs.json`);
if (!ok) process.exit(1);
