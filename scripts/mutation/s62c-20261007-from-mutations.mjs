// Mutation check for § 62 ج (the fix, 2026-10-07) — «من» of every PDF is the company read from Odoo
// (src/doc-shell.ts fromPartyFor, and the five renderers that hand it to the shell), BRAND_INFO is
// the fallback with the right e-mail (src/pdf-template.ts), a quotation is addressed «إلى / TO»
// (src/quotation.ts, src/doc-shell.ts labelForTo), and the company's VAT number is printed once
// (src/pdf-template.ts, src/invoice.ts). Each mutation disables ONE guard, runs
// tests/s62c-from.test.mts, and must make it fail. The source is restored in `finally` after every
// run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ in place, so it never runs in the working tree.
//
//   node scripts/mutation/s62c-20261007-from-mutations.mjs [من احتياط إلى ضريبي بريد]     (no argument: every part)
//
// Out: scripts/artifacts/s62c-20261007-from-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s62c-from.test.mts";
const PT = "src/pdf-template.ts", DS = "src/doc-shell.ts", CO = "src/company.ts";
const QUO = "src/quotation.ts", INV = "src/invoice.ts", REC = "src/receipt.ts", PO = "src/purchase-order.ts", DN = "src/delivery-note.ts";
// the wrong address, never written whole in a file of the tree (tests/s62c-from.test.mts [و] scans for it)
const WRONG = "care@" + "utak.com";
const FROM = "    from: fromPartyFor(lang, company),";
const ONLY_ASKED = "    from: data.lang ? fromPartyFor(lang, company) : undefined,";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- من — the company read from Odoo
  ["من", "the quotation takes «من» from the company only when a language is asked", [[QUO, FROM, ONLY_ASKED]], T],
  ["من", "the receipt takes «من» from the company only when a language is asked", [[REC, FROM, ONLY_ASKED]], T],
  ["من", "the purchase order takes «من» from the company only when a language is asked", [[PO, FROM, ONLY_ASKED]], T],
  ["من", "the delivery note takes «من» from the company only when a language is asked", [[DN, FROM, ONLY_ASKED]], T],
  ["من", "the invoice takes «من» from the company only when a language is asked", [[INV,
    "    from: fromPartyFor(lang, company && !isTaxInvoice ? { ...company, vat: \"\" } : company),", ONLY_ASKED]], T],
  ["من", "«من» ignores the company's legal Arabic name", [[DS,
    "    name: company.legalNameAr || company.nameAr,\n    address: company.addressAr || company.address,", "    name: company.nameAr,\n    address: company.addressAr || company.address,"]], T],
  ["من", "«من» carries no address", [[DS,
    "    address: company.addressAr || company.address,\n    email: company.email,\n    phone: company.phone,\n    vat: company.vat,", "    email: company.email,\n    phone: company.phone,\n    vat: company.vat,"]], T],
  ["من", "«من» carries no e-mail", [[DS,
    "    email: company.email,\n    phone: company.phone,\n    vat: company.vat,\n    vatLabel: UI.vatLabel.ar,", "    phone: company.phone,\n    vat: company.vat,\n    vatLabel: UI.vatLabel.ar,"]], T],
  ["من", "«من» carries no phone", [[DS,
    "    phone: company.phone,\n    vat: company.vat,\n    vatLabel: UI.vatLabel.ar,", "    vat: company.vat,\n    vatLabel: UI.vatLabel.ar,"]], T],
  ["من", "the English «FROM» keeps the Arabic address", [[DS,
    "      address: company.addressEn || company.address,\n      email: company.email,", "      address: company.address,\n      email: company.email,"]], T],
  ["من", "the English «FROM» keeps the Arabic name", [[DS,
    "      name: company.legalNameEn || company.nameEn,\n      address: company.addressEn || company.address,", "      name: company.nameAr,\n      address: company.addressEn || company.address,"]], T],
  ["من", "a company with an empty field gets the fallback's value for it", [[DS,
    "    address: company.addressAr || company.address,\n    email: company.email,\n    phone: company.phone,\n    vat: company.vat,", "    address: company.addressAr || company.address || \"الرياض، المملكة العربية السعودية\",\n    email: company.email,\n    phone: company.phone,\n    vat: company.vat,"]], T],
  ["من", "the e-mail and the phone of «من» take two lines again (the block grows a line: a second page)", [[PT,
    "  const both = !!(party.email && party.phone);", "  const both = false;"]], T],
  ["من", "a party with a phone alone gets the joined line's dot", [[PT,
    "  const both = !!(party.email && party.phone);", "  const both = !!party.phone;"]], T],
  // ---------------------------------------------------------------- احتياط — BRAND_INFO
  ["احتياط", "the fallback's e-mail is the wrong one again", [[PT,
    "  email: \"care@utakfresh.com\",\n  phone: \"+966 58 004 0467\",\n  cr: \"\",", "  email: \"care@utak\" + \".com\",\n  phone: \"+966 58 004 0467\",\n  cr: \"\","]], T],
  ["احتياط", "the fallback prints no e-mail", [[PT,
    "    address: BRAND_INFO.address,\n    email: BRAND_INFO.email,\n    phone: BRAND_INFO.phone,", "    address: BRAND_INFO.address,\n    phone: BRAND_INFO.phone,"]], T],
  ["احتياط", "the fallback prints no address", [[PT,
    "    name: BRAND_INFO.nameAr,\n    address: BRAND_INFO.address,\n    email: BRAND_INFO.email,", "    name: BRAND_INFO.nameAr,\n    email: BRAND_INFO.email,"]], T],
  ["احتياط", "a VAT number lives in the code's constants", [[PT,
    "  vat: \"\",  // never here: the company's is read from Odoo", "  vat: \"315022736600003\","]], T],
  // ---------------------------------------------------------------- إلى — the quotation's customer block
  ["إلى", "a quotation is «فاتورة إلى» again", [[QUO,
    "    billToLabel: labelForTo(lang),", "    billToLabel: undefined,"]], T],
  ["إلى", "a quotation is «إلى / TO» only when a language is asked", [[QUO,
    "    billToLabel: labelForTo(lang),", "    billToLabel: data.lang ? labelForTo(lang) : undefined,"]], T],
  ["إلى", "the Arabic label of a quotation is the invoice's", [[DS,
    "  return \"إلى / TO\";", "  return \"فاتورة إلى / BILL TO\";"]], T],
  ["إلى", "the English label of a quotation is «BILL TO»", [[DS,
    "  if (lang === \"en\") return \"TO\";", "  if (lang === \"en\") return \"BILL TO\";"]], T],
  ["إلى", "the English label of a quotation is the Arabic pair", [[DS,
    "  if (lang === \"en\") return \"TO\";\n", ""]], T],
  ["إلى", "the Arabic template ignores the label it is handed", [[PT,
    "      ${renderParty(opts.billToLabel ?? \"فاتورة إلى / BILL TO\", opts.billTo, false)}\n      ${renderParty(opts.fromLabel ?? \"من / FROM\", from, true)}", "      ${renderParty(\"فاتورة إلى / BILL TO\", opts.billTo, false)}\n      ${renderParty(opts.fromLabel ?? \"من / FROM\", from, true)}"]], T],
  ["إلى", "the invoice's label becomes the quotation's", [[DS,
    "  if (lang === \"en\") return \"BILL TO\";\n  return \"فاتورة إلى / BILL TO\";", "  if (lang === \"en\") return \"TO\";\n  return \"إلى / TO\";"]], T],
  // ---------------------------------------------------------------- ضريبي — the VAT number once
  ["ضريبي", "«من» repeats the number the legal strip carries", [[PT,
    "  const from: PartyInfo = vatInStrip ? { ...fromGiven, vat: undefined } : fromGiven;", "  const from: PartyInfo = fromGiven;"]], T],
  ["ضريبي", "«من» never carries the number, strip or no strip", [[PT,
    "  const vatInStrip = !!(opts.legalFooterBar?.vat ?? \"\").trim();", "  const vatInStrip = true;"]], T],
  ["ضريبي", "a strip without the number counts as carrying it", [[PT,
    "  const vatInStrip = !!(opts.legalFooterBar?.vat ?? \"\").trim();", "  const vatInStrip = !!opts.legalFooterBar;"]], T],
  ["ضريبي", "the party of «من» carries no VAT number", [[DS,
    "    phone: company.phone,\n    vat: company.vat,\n    vatLabel: UI.vatLabel.ar,", "    phone: company.phone,\n    vatLabel: UI.vatLabel.ar,"]], T],
  ["ضريبي", "the VAT line reads in Arabic on an English page", [[PT,
    "${escapeHTML(party.vatLabel ?? \"الرقم الضريبي\")}: <bdi dir=\"ltr\">", "${escapeHTML(\"الرقم الضريبي\")}: <bdi dir=\"ltr\">"]], T],
  ["ضريبي", "the VAT line is printed for a party with no number", [[PT,
    "  const vat = (party.vat ?? \"\").trim();\n  if (!vat) return \"\";\n", "  const vat = (party.vat ?? \"\").trim();\n"]], T],
  ["ضريبي", "the VAT number is not kept in one left-to-right run", [[PT,
    "${escapeHTML(party.vatLabel ?? \"الرقم الضريبي\")}: <bdi dir=\"ltr\">${escapeHTML(vat)}</bdi></div>`;", "${escapeHTML(party.vatLabel ?? \"الرقم الضريبي\")}: ${escapeHTML(vat)}</div>`;"]], T],
  ["ضريبي", "an invoice before the VAT cutoff prints the number in «من»", [[INV,
    "    from: fromPartyFor(lang, company && !isTaxInvoice ? { ...company, vat: \"\" } : company),", FROM]], T],
  // ---------------------------------------------------------------- بريد — the wrong address
  ["بريد", "the wrong address is back in a file of src/", [[CO,
    "// Company info reader — single source of truth for every UTAK PDF footer.", `// Company info reader — single source of truth for every UTAK PDF footer. ${WRONG}`]], T],
];

const want = new Set(process.argv.slice(2));
const results = [];
for (const [part, name, edits, test] of M) {
  if (want.size && !want.has(part)) continue;
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`pattern found ${n}× in ${file}: ${find.slice(0, 80)}`);
      writeFileSync(path, cur.replace(find, replace));
    }
    let caught = false, out = "";
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ part, name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  [${part}] ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("../artifacts/s62c-20261007-from-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
