// § 55.1 (2026-10-05) — `npm test`: every test file, one process each, in the order of the old
// `&&` chain of package.json, stopping at the first file that fails (as the chain did). The test
// files are not touched and print what they always printed; this only decides what reaches stdout:
//
//   npm test                     one line per file «name: N ✓ / M ✗», every «✗» with its details, a total
//   VERBOSE=1 npm test           everything each file prints, as before, then the total
//   npm test -- s55 s55-receipt  those files only (a name, or tests/<name>.test.mts)
//
// N is the count of «✓» lines a file printed (tests/quiet.mjs): the same count as before § 55.1.
// A file's output goes to a temp file, not a pipe: a test that ends with process.exit() loses nothing.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quiet } from "./quiet.mjs";

// A new test file is added here (at the end): a file of tests/ that is not listed is named on every run.
const FILES = [
  "sim-isolation", "wa-inbox", "inbox-cover", "sig-alert", "wa-template-sync", "wa-template-purpose",
  "accounting", "official-doc", "i18n", "auto-send-guard", "vat", "purchase-accounting", "sale-accounting",
  "odoo-retry", "acct-close", "zatca-qr", "fin-statements", "wa-critical", "wa-templates-new-eight",
  "collection-sim", "wa-important-b1", "inbox-title", "wa-important-b2", "sim-pure", "inbox-dark-voice",
  "attendance", "review", "team-hr", "team-shifts", "wa-gateway", "wa-opener", "prices", "wa-record",
  "wa-status", "supplier-pay", "wa-important-b3", "wa-important-b4", "pricing-v1", "s41", "s42", "s44", "s45",
  "s46-board", "s46-product", "s46-zero-price", "s46-post-launch", "s47", "s48", "s49", "s49-sources", "s49-ui",
  "s51", "s52", "s52-iban", "s53", "s53-forms", "s54", "s55", "s55-receipt", "s55-car", "s55-custody",
  "s55-delivery", "s56", "s57-day", "s57-bank", "s57-expense", "s57-transfer", "s57-complaint", "s57-supplier-vat",
  "s58-ui", "s58-transfers",
  "s59-team", "s59-prices", "s59-available", "s59-files", "s59-trials",
  "s60-unavailable", "s60-screen", "s60-target", "s60-tabs", "s60-summary", "s60-history", "s60-trial",
  "s61-jobs",
  "s62-math", "s62-quote", "s62-ask", "s62-quotation", "s62-trials",
  "s62c-from",
  "s62d-layout", "s62d-sale-order", "s62d-preview",
  "s64-chats", "s64-history", "s64-leftovers",
  "s65-registry", "s65-offer", "s65-prices", "s65-outreach",
  "s66-accept", "s66-order", "s66-scenario",
  "s67-freeze", "s67-gateway", "s67-sources",
  "s68-hook", "s68-attendance", "s68-file",
];

const root = new URL("../", import.meta.url).pathname;
const VERBOSE = process.env.VERBOSE === "1";
const nameOf = (a) => a.replace(/^(\.\/)?tests\//, "").replace(/\.test\.mts$/, "");
const asked = process.argv.slice(2).map(nameOf);
const missing = asked.filter((n) => !existsSync(join(root, "tests", `${n}.test.mts`)));
if (missing.length) { console.log(`✗ no such test file: ${missing.map((n) => `tests/${n}.test.mts`).join(", ")}`); process.exit(2); }
const files = asked.length ? asked : FILES;

const dir = mkdtempSync(join(tmpdir(), "utak-test-"));
let pass = 0, fail = 0, ran = 0, code = 0;
try {
  for (const name of files) {
    const out = join(dir, `${name}.out`);
    const fd = openSync(out, "w");
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", `tests/${name}.test.mts`], { cwd: root, stdio: ["ignore", fd, fd] });
    closeSync(fd);
    const rc = r.status ?? 1;
    const text = readFileSync(out, "utf8");
    const q = quiet(text, { rc });
    ran++; pass += q.pass; fail += q.fail;
    if (VERBOSE) process.stdout.write(text);
    else {
      if (q.kept.length && (rc !== 0 || q.fail)) console.log(q.kept.join("\n"));
      console.log(`${name}: ${q.pass} ✓ / ${q.fail} ✗${rc !== 0 ? `  (${r.signal ? `killed by ${r.signal}` : `exit ${rc}`}${q.crashed ? ", it did not finish" : ""})` : ""}`);
    }
    if (rc !== 0) { code = rc; break; }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (code && ran < files.length) console.log(`stopped at the first failing file: ${files.length - ran} of ${files.length} not run`);
if (!asked.length) {
  const unlisted = readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.mts")).map(nameOf).filter((n) => !FILES.includes(n));
  if (unlisted.length) console.log(`⚠ not in the list of tests/run.mjs (not run): ${unlisted.map((n) => `tests/${n}.test.mts`).join(", ")}`);
}
console.log(`${VERBOSE ? "\n" : ""}TOTAL ${ran} file${ran === 1 ? "" : "s"}: ${pass} ✓ / ${fail} ✗`);
process.exit(code);
