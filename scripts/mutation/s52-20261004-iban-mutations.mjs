// Mutation check for § 52 أ (2026-10-04) — the company's bank-transfer line (IBAN): each mutation
// disables ONE guard, runs tests/s52-iban.test.mts, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops the script.
//
// RUN IT IN A COPY OF THE TREE (scripts/mutation/s45-20260930-mutations-all.mjs does: `git archive HEAD`):
// a mutation edits src/ (and tests/s46-kit.mts) in place, so it never runs in the working tree.
//
//   node scripts/mutation/s52-20261004-iban-mutations.mjs [أ|ب|ج|د|هـ|ز …]     (no argument: every part)
//
// Out: scripts/artifacts/s52-20261004-iban-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s52-iban.test.mts";
const BL = "src/bank-line.ts";
const CO = "src/company.ts";
const PT = "src/pdf-template.ts";
const IN = "src/invoice.ts";
const QU = "src/quotation.ts";
const CP = "src/collect-pay.ts";
const KIT = "tests/s46-kit.mts";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- أ the line and its IBAN
  ["أ", "the mod 97 check is off", [[BL,
    "  if (ibanMod97(iban) !== 1) return \"the IBAN's check digits are wrong (mod 97)\";\n", ""]], T],
  ["أ", "mod 97 is taken without moving the first four characters to the end", [[BL,
    "const s = iban.slice(4) + iban.slice(0, 4);", "const s = iban;"]], T],
  ["أ", "the length check is off", [[BL,
    "iban.length !== SAUDI_IBAN_LENGTH || ", ""]], T],
  ["أ", "a Saudi IBAN has 23 characters", [[BL,
    "export const SAUDI_IBAN_LENGTH = 24;", "export const SAUDI_IBAN_LENGTH = 23;"]], T],
  ["أ", "any country's IBAN is shown", [[BL,
    "!/^SA\\d+$/.test(iban)", "false"]], T],
  ["أ", "the IBAN is shown in one block (no groups)", [[BL,
    "return iban.replace(/(.{4})(?=.)/g, \"$1 \");", "return iban;"]], T],
  ["أ", "the IBAN is shown in groups of five", [[BL,
    "/(.{4})(?=.)/g", "/(.{5})(?=.)/g"]], T],
  ["أ", "the spaces of the stored IBAN are kept", [[BL,
    "raw.replace(/\\s+/g, \"\").toUpperCase()", "raw.toUpperCase()"]], T],
  ["أ", "a lower-case IBAN is not read", [[BL,
    "raw.replace(/\\s+/g, \"\").toUpperCase()", "raw.replace(/\\s+/g, \"\")"]], T],
  ["أ", "an empty holder name gives half a line", [[BL,
    "  if (!oneLine(a.holder)) return \"the account holder's name is empty\";\n", ""]], T],
  ["أ", "an empty bank name gives half a line", [[BL,
    "  if (!oneLine(a.bank)) return \"the bank's name is empty\";\n", ""]], T],
  ["أ", "the line is written without checking the account", [[BL,
    "if (!a || bankAccountProblem(a)) return \"\";", "if (!a) return \"\";"]], T],
  ["أ", "the line does not say «IBAN»", [[BL,
    "— IBAN ${groupIban(", "— ${groupIban("]], T],
  ["أ", "the line has no holder name", [[BL,
    "`للتحويل: ${oneLine(a.holder)} — ${oneLine(a.bank)}", "`للتحويل: ${oneLine(a.bank)}"]], T],
  ["أ", "a text without a line gets two empty lines", [[BL,
    "return line ? `${text}\\n\\n${line}` : text;", "return `${text}\\n\\n${line}`;"]], T],
  // ---------------------------------------------------------------- ب the read and the cache
  ["ب", "the account is read from another journal", [[BL,
    "export const BANK_JOURNAL_CODE = \"BNK1\";", "export const BANK_JOURNAL_CODE = \"CSHD\";"]], T],
  ["ب", "an archived account is used", [[BL,
    "  if (row.active === false) return { why: `the bank account #${bankId} is archived` };\n", ""]], T],
  ["ب", "the account is read by the names of another Odoo (acc_number)", [[BL,
    "fields: [\"id\", \"account_number\", \"holder_name\", \"bank_name\", \"active\"]", "fields: [\"id\", \"acc_number\", \"holder_name\", \"bank_name\", \"active\"]"]], T],
  ["ب", "a failed read throws", [[BL,
    "    why = `Odoo unreadable (${(e as Error)?.message ?? e})`;\n", "    throw e;\n"]], T],
  ["ب", "no warning when there is no line", [[BL,
    "  console.warn(`[bank-line] no bank-transfer line: ${why}`);\n", ""]], T],
  ["ب", "the cache is never read (one Odoo read per document)", [[BL,
    "const hit = formatBankLine(await readCached(env, now));", "const hit = formatBankLine(null);"]], T],
  ["ب", "the cache is never written", [[BL,
    "          await env.MSG_DEDUP.put(BANK_LINE_KV_KEY, JSON.stringify(entry), { expirationTtl: BANK_LINE_TTL_SECONDS });\n", ""]], T],
  ["ب", "a cached account never expires", [[BL,
    " || now - c.at >= BANK_LINE_TTL_SECONDS * 1000", ""]], T],
  ["ب", "the company comes back without its line", [[CO,
    "  return bankLine ? { ...company, bankLine } : company;", "  return company;"]], T],
  ["ب", "no account gives the company an empty line", [[CO,
    "  return bankLine ? { ...company, bankLine } : company;", "  return { ...company, bankLine };"]], T],
  // ---------------------------------------------------------------- ج the tax invoice PDF
  ["ج", "the invoice's page does not take the line", [[IN,
    "under the payment terms (the same Arabic line in every language)\n    bankLine: company?.bankLine,", "under the payment terms (the same Arabic line in every language)"]], T],
  ["ج", "the invoice's PDF reads the company without its bank", [[IN,
    "  const company = await readCompanyInfoWithBank(env);\n  const html = renderInvoiceHTML(data, company);", "  const company = await (await import(\"./company\")).readCompanyInfo(env);\n  const html = renderInvoiceHTML(data, company);"]], T],
  ["ج", "the Arabic template drops the line", [[PT,
    "renderFooter(footerNote, showZatcaQR, undefined, undefined, undefined, renderBankLineHTML(opts.bankLine))", "renderFooter(footerNote, showZatcaQR)"]], T],
  ["ج", "the language template (ar / en / bi) drops the line", [[PT,
    "opts.footerSealHTML, renderBankLineHTML(opts.bankLine, lang));", "opts.footerSealHTML);"]], T],
  ["ج", "the IBAN may break across two lines", [[PT,
    "<bdi dir=\"ltr\" style=\"white-space: nowrap;\">", "<bdi dir=\"ltr\">"]], T],
  ["ج", "the line takes the page's direction", [[PT,
    "<div data-utak=\"bank-line\" dir=\"rtl\" style=", "<div data-utak=\"bank-line\" style="]], T],
  ["ج", "the line is right-aligned on the English page", [[PT,
    "${lang === \"en\" ? \" text-align: left;\" : \"\"}\">${escapeHTML(head)}", "\">${escapeHTML(head)}"]], T],
  ["ج", "a page without a line is not the page it was", [[PT,
    "const bankRow = bankLineHTML ? `\\n          ${bankLineHTML}` : \"\";", "const bankRow = `\\n          ${bankLineHTML}`;"]], T],
  // ---------------------------------------------------------------- د the quotation PDF
  ["د", "the quotation's page does not take the line", [[QU,
    "under the terms (the same Arabic line in every language)\n    bankLine: company?.bankLine,", "under the terms (the same Arabic line in every language)"]], T],
  ["د", "generateQuotationPDF reads the company without its bank", [[QU,
    "  const company = await readCompanyInfoWithBank(env);\n  const lang: DocLang", "  const company = await (await import(\"./company\")).readCompanyInfo(env);\n  const lang: DocLang"]], T],
  ["د", "the customer's quotation reads the company without its bank", [[QU,
    "html = renderQuotationHTML(data, await readCompanyInfoWithBank(env));", "html = renderQuotationHTML(data, await (await import(\"./company\")).readCompanyInfo(env));"]], T],
  // ---------------------------------------------------------------- هـ the free texts
  ["هـ", "the customer's invoice text is built without the line", [[IN,
    "a.subtotal, a.total, a.tax, a.bankLine);", "a.subtotal, a.total, a.tax);"]], T],
  ["هـ", "the customer's invoice text has no place for the line", [[IN,
    "    ...(bankLine ? [bankLine, ``] : []),\n", ""]], T],
  ["هـ", "the invoice at delivery sends its text without the line", [[IN,
    "    lines: pricedLines,\n    bankLine,\n  }));", "    lines: pricedLines,\n    bankLine: \"\",\n  }));"]], T],
  ["هـ", "the invoice sent again goes without the line", [[IN,
    "    bankLine: await bankTransferLine(env),\n", "    bankLine: \"\",\n"]], T],
  ["هـ", "the collector's request is built without the line", [[IN,
    "    total,\n    bankLine,\n  });", "    total,\n  });"]], T],
  ["هـ", "the collector's request has no place for the line", [[IN,
    "    ...(args.bankLine ? [args.bankLine] : []), ``,", "    ``,"]], T],
  ["هـ", "the 18:00 list as text goes without the line", [[IN,
    "const listText = withBankLine(s.text, await bankTransferLine(env));", "const listText = s.text;"]], T],
  ["هـ", "the list after «بدء الدوام» goes without the line", [[IN,
    "sendText(env, to, withBankLine(s.text, await bankTransferLine(env)), { purpose: \"collection_summary\" })", "sendText(env, to, s.text, { purpose: \"collection_summary\" })"]], T],
  ["هـ", "«تحويل 🏦» answers without the line", [[CP,
    "withBankLine(choiceText(p, remaining), bankLine)", "choiceText(p, remaining)"]], T],
  ["هـ", "«نقد 💵» carries the line too", [[CP,
    "method === \"transfer\" ? await bankTransferLine(env) : \"\"", "await bankTransferLine(env)"]], T],
  ["هـ", "the line goes into utak_collection_request's variables", [[IN,
    "        invoiceNumber,\n        String(total),\n      ],", "        invoiceNumber,\n        `${total} — ${bankLine}`,\n      ],"]], T],
  ["هـ", "the line goes into utak_invoice_pdf_v1's variables", [[IN,
    "params: [a.customerName || \"\", a.invoiceNumber, invoiceDate, String(a.total)],", "params: [a.customerName || \"\", a.invoiceNumber, invoiceDate, `${a.total} — ${a.bankLine}`],"]], T],
  ["هـ", "the line goes into utak_invoice_customer_v2's variables", [[IN,
    "params: [a.customerName || \"\", a.invoiceNumber, linesFormatted, String(a.total)],", "params: [a.customerName || \"\", a.invoiceNumber, linesFormatted, `${a.total} — ${a.bankLine}`],"]], T],
  ["هـ", "the line goes into utak_collection_summary's variables", [[IN,
    "T.COLLECTION_SUMMARY, s.params, [], undefined,", "T.COLLECTION_SUMMARY, [...s.params.slice(0, 3), `${s.params[3]} — ${listText}`], [], undefined,"]], T],
  // ---------------------------------------------------------------- ز the schema
  // § 53, § 54 and § 55 — their fixtures are read after § 52's and hold the two models as well: the four lines go
  ["ز", "the tests' gate does not load the § 52 fixture (the two models unchecked)", [[KIT,
    "  \"fixtures-odoo-fields-20261004-s52.json\",   // § 52:", "  // § 52:"], [KIT,
    "  \"fixtures-odoo-fields-20261004-s53.json\",   // § 53:", "  // § 53:"], [KIT,
    "  \"fixtures-odoo-fields-20261005-s54.json\",   // § 54:", "  // § 54:"], [KIT,
    "  \"fixtures-odoo-fields-20261005-s55.json\",   // § 55:", "  // § 55:"], [KIT,
    "  \"fixtures-odoo-fields-20261005-s56.json\",   // § 56:", "  // § 56:"], [KIT,
    "  \"fixtures-odoo-fields-20261005-s57.json\",   // § 57:", "  // § 57:"], [KIT,
    "  \"fixtures-odoo-fields-20261005-s58.json\",   // § 58:", "  // § 58:"]], T],
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
writeFileSync(new URL("../artifacts/s52-20261004-iban-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
process.exit(caught === results.length ? 0 : 1);
