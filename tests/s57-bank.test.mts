// § 57 ج (2026-10-05) — the bank journal BNK1 made ready for a statement uploaded by hand
// (scripts/s57-20261005-bank.mjs), and the team's guide «كشف البنك الأسبوعي».
//
//   [1] the script writes ONE selection on ONE journal, by the protocol, and stops on a source it does
//       not know; it creates no reconciliation rule and touches nothing of the online synchronisation
//   [2] the guide: where the statement comes from, where it is uploaded, the columns the first time,
//       the matching — and that a transfer registered from WhatsApp is not counted twice
//
// No Odoo, no network, no send: the script and the guide are text.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s57-bank.test.mts

import { readFileSync } from "node:fs";
import { assert, done } from "./s46-kit.mts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const script = read("scripts/s57-20261005-bank.mjs");
const guide = read("docs/OPERATING-DAY.md");

// ================================================================ [1] the script
{
  const writes = [...script.matchAll(/call\("([\w.]+)", "(write|create|unlink)"/g)].map((m) => `${m[1]}.${m[2]}`);
  assert("it writes the bank journal alone — once to set the source, once to put it back — and creates or deletes nothing", JSON.stringify(writes) === JSON.stringify(["account.journal.write", "account.journal.write"]) && script.includes("export const BNK1 = 13;") && (script.match(/ids: \[BNK1\], vals: \{ bank_statements_source:/g) ?? []).length === 2, JSON.stringify(writes));
  assert("the source becomes «file_import» (manual / import), from «undefined» only: any other value stops the script", script.includes(`const SOURCE = "file_import";`) && script.includes(`else if (j.bank_statements_source !== "undefined") throw new Error(`) && script.includes(`if (!j || j.code !== "BNK1" || j.type !== "bank") throw new Error(`));
  assert("the rollback file is written before the write, with the value of before", script.indexOf("rb.before.journal ??= { id: BNK1, bank_statements_source: j.bank_statements_source }; save();") > 0 && script.indexOf("rb.before.journal ??= { id: BNK1, bank_statements_source: j.bank_statements_source }; save();") < script.lastIndexOf(`await call("account.journal", "write", { ids: [BNK1], vals: { bank_statements_source: SOURCE } });`));
  assert("the reconciliation models are read, never written; the statement line #1 and the online link #1 are read, never written", !/call\("account\.reconcile\.model", "(write|create|unlink)"/.test(script) && !/call\("account\.(bank\.statement\.line|online\.link)", "(write|create|unlink)"/.test(script) && /call\("account\.reconcile\.model", "search_read"/.test(script));
  assert("the verify proves what § 57 د relies on: a payment on BNK1 waits in 101003 (reconcilable), the statement goes 101001 against 101002", ["101001", "101002", "101003", "101004"].every((c) => script.includes(`"${c}"`)) && script.includes("acc[OUTSTANDING_IN]?.reconcile === true") && script.includes(`code(inbound[0].payment_account_id) === OUTSTANDING_IN`) && script.includes(`code(j.suspense_account_id) === SUSPENSE`));
}

// ================================================================ [2] the guide
{
  const at = guide.indexOf("## كشف البنك الأسبوعي (§ 57)"), section = guide.slice(at, guide.indexOf("\n## ", at + 5));
  assert("OPERATING-DAY carries «كشف البنك الأسبوعي», once", at > 0 && guide.split("## كشف البنك الأسبوعي").length === 2 && section.length > 900, String(section.length));
  assert("…the statement from SAB's business application (Excel or CSV), by hand: SAB is not synchronised", /من تطبيق ساب للأعمال/.test(section) && /Excel أو CSV/.test(section) && /يُرفع باليد/.test(section) && /«يدوي \/ استيراد»/.test(section));
  assert("…uploaded from المحاسبة ← لوحة المحاسبة ← بطاقة Bank ← «رفع»", section.includes("**المحاسبة ← لوحة المحاسبة ← بطاقة Bank ← «رفع»**"));
  assert("…the first time: the columns; then the matching; the first statement starts on the day the account was opened", /أول مرة فقط — ربط الأعمدة/.test(section) && /\*\*المطابقة:\*\*/.test(section) && section.includes("**أول كشف يبدأ من يوم فتح الحساب**") && section.indexOf("ربط الأعمدة") < section.indexOf("**المطابقة:**"));
  assert("…a transfer registered with «✅ وصل» waits in 101003 and is proposed to its statement line: the amount is not counted twice", /101003/.test(section) && section.includes("**المبلغ لا يُحسب مرتين:**") && /رصيد البنك \(101001\) يتحرك مرة واحدة، من الكشف/.test(section) && /«✅ وصل»/.test(section));
  assert("…no matching validates by itself, and the online synchronisation is not to be touched", section.includes("**لا مطابقة تعتمد نفسها:**") && section.includes("**لا تلمس «المزامنة عبر الإنترنت»**") && /«sab» بمبلغ 0\.00/.test(section));
}

done();
