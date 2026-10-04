// § 52 أ (2026-10-04) — the company's bank-transfer line (src/bank-line.ts):
//
//   للتحويل: شركة يوتاك — البنك السعودي الأول — IBAN SA59 4500 0000 1682 9572 3001
//
//   [أ] the line: its words, the IBAN in groups of four, the Saudi shape (24 characters, «SA» +
//       22 digits), ISO 13616 mod 97, the two names; no SWIFT
//   [ب] the read: the journal BNK1 → its bank_account_id → res.partner.bank (saas-19.4 names),
//       the cache (one Odoo read for the documents of ten minutes, «no line» never cached), and
//       every way there is NO line — each with one warning, none of them an exception
//   [ج] the tax invoice PDF (the production path, the HTML Gotenberg receives): the line under the
//       payment terms, the same Arabic line in ar / en / bi, the page untouched without it
//   [د] the quotation PDF: the customer's quotation, the manual one, the sale order's
//   [هـ] the free texts that ask for a payment or a collection: the customer's invoice, the
//       collector's request (sent, queued), the collectors' list, «تحويل 🏦» — and never a
//       template's variables; without an account, or with Odoo down, they go as they were
//   [و] one Odoo read for everything an invoice sets off
//   [ز] the schema: the worker's reads name fields this tenant has
//
// In-memory Odoo + captured Graph + captured Gotenberg (tests/wa-harness.mts, tests/s46-kit.mts).
// No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s52-iban.test.mts

import { readFileSync } from "node:fs";
import { COLL, COLL_PHONE, graph, odooLog, openWindow, order, quiet, rows, seed, sentTo, setRiyadh, table, workSchedule } from "./wa-harness.mts";
import { ALL_WEEK, C1, C1_PHONE, assert, done, fresh, rejected } from "./s46-kit.mts";

// Gotenberg (the HTML of every PDF) and an Odoo that answers 503 for one model: neither is the kit's business
const pdfs: string[] = [];
let odooDown = "", downAnswers = 0;
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.startsWith("https://gotenberg.test/")) {
    const file = (init?.body as FormData).getAll("files").find((f: any) => f?.name === "index.html") as Blob | undefined;
    pdfs.push(file ? await file.text() : "");
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
  }
  if (odooDown && url.includes(`/json/2/${odooDown}/`)) { downAnswers++; return new Response(JSON.stringify({ message: "Service Unavailable" }), { status: 503 }); }
  return kitFetch(input as any, init);
}) as typeof fetch;

const BL = await import("../src/bank-line.ts");
const CO = await import("../src/company.ts");
const PDF = await import("../src/pdf-template.ts");
const INV = await import("../src/invoice.ts");
const QUO = await import("../src/quotation.ts");
const SOQ = await import("../src/sale-order-quotation.ts");
const CP = await import("../src/collect-pay.ts");
const PC = await import("../src/payment-confirm.ts");
const CLAIM = await import("../src/pay-claim.ts");
const { teamQueueKey } = await import("../src/team-queue.ts");
const { call } = await import("../src/odoo.ts");

const LINE = "للتحويل: شركة يوتاك — البنك السعودي الأول — IBAN SA59 4500 0000 1682 9572 3001";
const IBAN = "SA5945000000168295723001";
const HOLDER = "شركة يوتاك", BANK = "البنك السعودي الأول";
const acct = (over: Record<string, unknown> = {}) => ({ holder: HOLDER, bank: BANK, iban: IBAN, ...over }) as any;
/** Valid by mod 97, wrong by length: 23 and 25 characters. */
const SHORT = "SA374500000016829572300", LONG = "SA85450000001682957230011";
/** Another valid Saudi IBAN (the account changed in Odoo). */
const IBAN2 = "SA0380000000608010167519";
/** Valid IBANs of other countries: Spain's has 24 characters too. */
const SPAIN = "ES9121000418450200051332", GERMANY = "DE89370400440532013000";

const NOW = "2026-10-04 09:00";
const JOURNAL = 13, ACCT = 9001;
const r2: string[] = [];
/**
 * The tenant's shape on 10-04: VAT on, the sale tax on the company, the cash journal, and the bank
 * journal BNK1 with the company's account (`{}`), with fields of it changed, without an account
 * (null), or no journal at all ("none").
 */
function world(bank: Record<string, unknown> | null | "none" = {}, riyadh = NOW): any {
  const env = fresh(riyadh);
  Object.assign(env, {
    GOTENBERG_URL: "https://gotenberg.test", GOTENBERG_USER: "u", GOTENBERG_PASSWORD: "p", ADMIN_TOKEN: "ADM",
    INVOICES_BUCKET: { put: async (k: string) => { r2.push(k); return {}; }, head: async () => null, get: async () => null },
  });
  seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.company", { id: 1, name: HOLDER, vat: "315022736600003", account_sale_tax_id: [77, "15%"] });
  seed("account.journal", { id: 19, code: "CSHD", name: "كاش السائق", bank_account_id: false });
  if (bank === null) seed("account.journal", { id: JOURNAL, code: "BNK1", name: "البنك", bank_account_id: false });
  else if (bank !== "none") {
    seed("res.partner.bank", { id: ACCT, account_number: IBAN, holder_name: HOLDER, bank_name: BANK, bank_bic: "SABBSARI", active: true, partner_id: [1, HOLDER], ...bank });
    // a many2one as Odoo answers it: [id, display name]
    seed("account.journal", { id: JOURNAL, code: "BNK1", name: "البنك", bank_account_id: [ACCT, IBAN] });
  }
  pdfs.length = 0; r2.length = 0; odooDown = ""; downAnswers = 0;
  return env;
}
const journalReads = () => odooLog.filter((l) => l.model === "account.journal" && JSON.stringify(l.body?.domain ?? []).includes("BNK1"));
const bankReads = () => odooLog.filter((l) => l.model === "res.partner.bank");
const cached = (env: any): string | undefined => env.MSG_DEDUP.store.get(BL.BANK_LINE_KV_KEY);
/** Run with the console captured: what came back, and the [bank-line] warnings. */
async function warned<T>(fn: () => Promise<T>): Promise<{ out: T; warns: string[]; threw: string }> {
  const real = { warn: console.warn, error: console.error, log: console.log };
  const warns: string[] = [];
  console.warn = (...a: unknown[]) => { const s = a.map(String).join(" "); if (s.startsWith("[bank-line]")) warns.push(s); };
  console.error = () => {}; console.log = () => {};
  try { return { out: await fn(), warns, threw: "" }; }
  catch (e) { return { out: undefined as T, warns, threw: String((e as Error)?.message ?? e) }; }
  finally { Object.assign(console, real); }
}
const plain = (html: string) => html.replace(/<[^>]+>/g, "");
const bodyOf = (b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? "");
const COMPANY = { nameAr: HOLDER, nameEn: "UTAK", address: "الرياض", email: "care@utak.com", phone: "+966 58 004 0467", cr: "7051996651", vat: "315022736600003" };
const TERMS_AR = "الدفع خلال ٣٠ يوماً من تاريخ الفاتورة. تحويل بنكي أو نقداً عند التسليم.";
/** A delivered order of the customer: 3 × 20 = 60, «العليا». */
const delivered = () => order(C1, "delivered", "2026-10-04", 1, { x_delivery_neighborhood: "العليا" });
const invoices = () => rows("x_invoice") as any[];
const collector = { id: COLL, name: "سالم", whatsapp: "+" + COLL_PHONE };
const tpl = (purpose: string) => (rows("x_whatsapp_template") as any[]).find((r) => r.x_purpose === purpose);
const invoiceTextOf = (digits: string) => sentTo(digits).map(bodyOf).find((t) => /فاتورتك رقم/.test(t)) ?? "";
const requestOf = (digits: string) => sentTo(digits).find((b: any) => /طلب تحصيل/.test(bodyOf(b)) || b?.template?.name === "utak_collection_request");

// ================================================================ [أ] the line
console.log("\n[أ] the line: «للتحويل: <holder> — <bank> — IBAN <groups of four>»");
{
  assert("the line, to the letter", BL.formatBankLine(acct()) === LINE && LINE === `للتحويل: ${HOLDER} — ${BANK} — IBAN SA59 4500 0000 1682 9572 3001`, BL.formatBankLine(acct()));
  assert("the IBAN in groups of four: six groups, one space between", BL.groupIban(IBAN) === "SA59 4500 0000 1682 9572 3001" && BL.groupIban(IBAN).split(" ").every((g: string) => g.length === 4) && BL.groupIban(IBAN).split(" ").length === 6);
  assert("…and no space after the last group", !BL.groupIban(IBAN).endsWith(" ") && BL.groupIban("SA59450000001682957230").split(" ").at(-1) === "30");
  assert("stored with its spaces, a no-break space or in lower case: the same line", [`SA59 4500 0000 1682 9572 3001`, ` SA59 4500 0000 1682 9572 3001 `, IBAN.toLowerCase()].every((s) => BL.formatBankLine(acct({ iban: s })) === LINE));
  assert("the names are one line each (a line break in Odoo is a space)", BL.formatBankLine(acct({ holder: " شركة\nيوتاك ", bank: "البنك  السعودي الأول" })) === LINE);
  assert("no SWIFT, no BIC in the line", !/SWIFT|BIC|SABB/i.test(LINE));
}

console.log("\n[أ] ISO 13616: mod 97 must be 1");
{
  assert("the company's IBAN: mod 97 = 1", BL.ibanMod97(IBAN) === 1 && BL.isSaudiIban(IBAN));
  const oneOff = Array.from({ length: 22 }, (_, i) => IBAN.slice(0, 2 + i) + String((Number(IBAN[2 + i]) + 1) % 10) + IBAN.slice(3 + i));
  assert("ONE digit changed, anywhere of the 22: never a line", oneOff.length === 22 && oneOff.every((x) => x.length === 24 && x !== IBAN && BL.ibanMod97(x) !== 1 && !BL.isSaudiIban(x) && BL.formatBankLine(acct({ iban: x })) === ""),
    oneOff.filter((x) => BL.formatBankLine(acct({ iban: x })) !== "").join(","));
  assert("the last digit changed (…3002): no line", BL.formatBankLine(acct({ iban: "SA5945000000168295723002" })) === "");
  assert("two digits swapped (SA59 5400 …): no line", BL.formatBankLine(acct({ iban: "SA5954000000168295723001" })) === "");
  assert("a character that is no digit and no letter: −1, no line", BL.ibanMod97("SA59-5000000168295723001") === -1 && BL.formatBankLine(acct({ iban: "SA59-5000000168295723001" })) === "");
}

console.log("\n[أ] the Saudi shape: «SA» + 22 digits = 24 characters");
{
  assert("23 and 25 characters whose mod 97 IS 1: no line (the length is checked by itself)", BL.ibanMod97(SHORT) === 1 && BL.ibanMod97(LONG) === 1 && SHORT.length === 23 && LONG.length === 25
    && BL.formatBankLine(acct({ iban: SHORT })) === "" && BL.formatBankLine(acct({ iban: LONG })) === "");
  assert("the IBAN cut short, or with a digit added: no line", BL.formatBankLine(acct({ iban: IBAN.slice(0, 23) })) === "" && BL.formatBankLine(acct({ iban: IBAN + "0" })) === "");
  assert("a valid IBAN of another country, 24 characters too (Spain): no line", BL.ibanMod97(SPAIN) === 1 && SPAIN.length === 24 && BL.formatBankLine(acct({ iban: SPAIN })) === "");
  assert("…and Germany's: no line", BL.ibanMod97(GERMANY) === 1 && BL.formatBankLine(acct({ iban: GERMANY })) === "");
  assert("empty, false, a number: no line", [("" as unknown), false, null, undefined, 5945000000168295723001].every((v) => BL.formatBankLine(acct({ iban: v })) === ""));
  assert("the reason is said (for the log), not the IBAN", /24|22 digits/.test(BL.ibanProblem(SHORT)) && /mod 97/.test(BL.ibanProblem("SA5945000000168295723002")) && BL.ibanProblem(IBAN) === "" && !BL.ibanProblem("SA5945000000168295723002").includes("5945"));
}

console.log("\n[أ] the two names: an empty one is no line (never half a line)");
{
  assert("no holder name: no line", BL.formatBankLine(acct({ holder: "" })) === "" && BL.formatBankLine(acct({ holder: "   " })) === "" && BL.formatBankLine(acct({ holder: false })) === "");
  assert("no bank name: no line", BL.formatBankLine(acct({ bank: "" })) === "" && BL.formatBankLine(acct({ bank: " \n " })) === "" && BL.formatBankLine(acct({ bank: false })) === "");
  assert("no account: no line", BL.formatBankLine(null) === "" && BL.formatBankLine(undefined) === "");
  assert("a text with the line: a blank line, then the line; without a line: the text as it is", BL.withBankLine("نص", LINE) === `نص\n\n${LINE}` && BL.withBankLine("نص", "") === "نص");
}

// ================================================================ [ب] the read
console.log("\n[ب] the read: the journal BNK1 → its bank account → res.partner.bank");
{
  const env = world();
  const a = await warned(() => BL.bankTransferLine(env));
  assert("the line of the account on the journal, with no warning", a.out === LINE && a.warns.length === 0 && a.threw === "", JSON.stringify(a));
  const j = journalReads()[0]?.body, b = bankReads()[0]?.body;
  assert("ONE read of account.journal by its code BNK1, asking for bank_account_id", journalReads().length === 1 && journalReads()[0].method === "search_read" && JSON.stringify(j.domain) === JSON.stringify([["code", "=", "BNK1"]]) && j.fields.includes("bank_account_id"), JSON.stringify(j));
  assert("ONE read of res.partner.bank by that id: account_number, holder_name, bank_name, active", bankReads().length === 1 && bankReads()[0].method === "read" && JSON.stringify(b.ids) === JSON.stringify([ACCT])
    && ["account_number", "holder_name", "bank_name", "active"].every((f) => b.fields.includes(f)), JSON.stringify(b));
  assert("the SWIFT is not even read (bank_bic is on the account in Odoo)", !b.fields.includes("bank_bic") && table("res.partner.bank").get(ACCT)!.bank_bic === "SABBSARI" && !/SABB/.test(a.out));
  assert("the cash journal's account is never read (BNK1 alone)", odooLog.filter((l) => l.model === "account.journal").length === 1);
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  table("account.journal").get(JOURNAL)!.bank_account_id = ACCT;
  assert("the many2one as a bare id: the same line", (await quiet(() => BL.bankTransferLine(env))) === LINE);
}

console.log("\n[ب] the cache: one Odoo read for the documents of ten minutes");
{
  const env = world();
  const first = await quiet(() => BL.bankTransferLine(env));
  const second = await quiet(() => BL.bankTransferLine(env));
  const third = await quiet(() => BL.bankTransferLine(env));
  assert("three documents, ONE read of the journal and ONE of the account", first === LINE && second === LINE && third === LINE && journalReads().length === 1 && bankReads().length === 1, `${journalReads().length}/${bankReads().length}`);
  assert("the account is in KV under bank_line:v1 (whatever the isolate)", BL.BANK_LINE_KV_KEY === "bank_line:v1" && JSON.parse(cached(env)!).iban === IBAN && JSON.parse(cached(env)!).holder === HOLDER, String(cached(env)));
  // the account changes in Odoo
  Object.assign(table("res.partner.bank").get(ACCT)!, { account_number: IBAN2, bank_name: "مصرف الراجحي" });
  setRiyadh("2026-10-04 09:09");
  assert("9 minutes later: still the cached account, no read", (await quiet(() => BL.bankTransferLine(env))) === LINE && journalReads().length === 1);
  setRiyadh("2026-10-04 09:10");
  const fresh10 = await quiet(() => BL.bankTransferLine(env));
  assert("10 minutes later: Odoo is read again, and the changed account shows", BL.BANK_LINE_TTL_SECONDS === 600 && journalReads().length === 2 && bankReads().length === 2
    && fresh10 === "للتحويل: شركة يوتاك — مصرف الراجحي — IBAN SA03 8000 0000 6080 1016 7519", fresh10);
  assert("…and is the cached one from then", (await quiet(() => BL.bankTransferLine(env))) === fresh10 && journalReads().length === 2);
}
{
  const env = world();
  await quiet(() => BL.bankTransferLine(env));
  // a cache entry that is not a valid account is never shown: Odoo is asked
  env.MSG_DEDUP.store.set(BL.BANK_LINE_KV_KEY, JSON.stringify({ holder: HOLDER, bank: BANK, iban: "SA5945000000168295723002", at: Date.now() }));
  const a = await quiet(() => BL.bankTransferLine(env));
  assert("a cached IBAN that fails the check is not shown: Odoo is read, the right line comes back", a === LINE && journalReads().length === 2 && !a.includes("3002"), a);
  env.MSG_DEDUP.store.set(BL.BANK_LINE_KV_KEY, "{not json");
  assert("a cache that cannot be parsed: Odoo is read", (await quiet(() => BL.bankTransferLine(env))) === LINE && journalReads().length === 3);
}
{
  const env = world();
  env.MSG_DEDUP = { get: async () => { throw new Error("KV down"); }, put: async () => { throw new Error("KV down"); }, delete: async () => {} };
  const a = await warned(() => BL.bankTransferLine(env));
  assert("KV down (no read, no write): the line still comes, from Odoo", a.out === LINE && a.threw === "" && a.warns.length === 0, JSON.stringify(a));
}

console.log("\n[ب] no line at all — one warning each, never an exception, nothing cached");
{
  const none = async (label: string, bank: Record<string, unknown> | null | "none", why: RegExp, before?: (env: any) => void) => {
    const env = world(bank);
    before?.(env);
    const a = await warned(() => BL.bankTransferLine(env));
    assert(`${label}: no line, ONE warning, no exception, nothing cached`, a.out === "" && a.threw === "" && a.warns.length === 1 && why.test(a.warns[0]) && cached(env) === undefined, JSON.stringify(a));
    return env;
  };
  await none("no journal BNK1", "none", /no journal BNK1/);
  await none("the journal has no bank account", null, /has no bank account/);
  await none("the journal points at an account that is gone", {}, /not found/, () => { table("res.partner.bank").delete(ACCT); });
  await none("the account is archived (active = false)", { active: false }, /archived/);
  await none("the holder's name is empty", { holder_name: false }, /holder/);
  await none("the bank's name is empty", { bank_name: "" }, /bank's name/);
  await none("the bank's name is spaces", { bank_name: "   " }, /bank's name/);
  await none("the account number is empty", { account_number: false }, /IBAN is empty/);
  await none("one digit of the IBAN is wrong", { account_number: "SA59 4500 0000 1682 9572 3002" }, /mod 97/);
  await none("the IBAN has 23 characters (mod 97 = 1)", { account_number: SHORT }, /not a Saudi one/);
  await none("the IBAN is another country's (24 characters, mod 97 = 1)", { account_number: SPAIN }, /not a Saudi one/);
  await none("a local account number, not an IBAN", { account_number: "168295723001" }, /not a Saudi one/);
  await none("Odoo does not answer for the journal", {}, /Odoo unreadable/, () => { odooDown = "account.journal"; });
  assert("…it was asked, and asked again as every Odoo read is (4 times), before giving up", downAnswers === 4 && bankReads().length === 0, String(downAnswers));
  await none("Odoo does not answer for the account", {}, /Odoo unreadable/, () => { odooDown = "res.partner.bank"; });
  assert("…the journal answered, the account did not", journalReads().length === 1 && downAnswers === 4, `${journalReads().length} ${downAnswers}`);
  const invalid = world({ account_number: "SA5945000000168295723002" });
  const w = await warned(() => BL.bankTransferLine(invalid));
  assert("the warning does not print the IBAN", w.warns.length === 1 && !/5945|3002/.test(w.warns[0]), w.warns[0]);
}
{
  // «no line» is not cached: the account created in Odoo shows on the next document
  const env = world(null);
  const a = await quiet(() => BL.bankTransferLine(env));
  seed("res.partner.bank", { id: ACCT, account_number: IBAN, holder_name: HOLDER, bank_name: BANK, active: true });
  table("account.journal").get(JOURNAL)!.bank_account_id = [ACCT, IBAN];
  const b = await quiet(() => BL.bankTransferLine(env));
  assert("no account, then Baraa creates it: the very next read shows the line", a === "" && b === LINE && journalReads().length === 2);
  // …and Odoo failing later does not show a stale-but-valid line beyond its ten minutes
  odooDown = "account.journal";
  assert("Odoo down inside the ten minutes: the cached line still shows", (await quiet(() => BL.bankTransferLine(env))) === LINE);
  setRiyadh("2026-10-04 09:11");
  assert("Odoo down after them: no line", (await quiet(() => BL.bankTransferLine(env))) === "");
}

console.log("\n[ب] the company of a document with payment terms");
{
  const env = world();
  const c = await quiet(() => CO.readCompanyInfoWithBank(env));
  const bare = await quiet(() => CO.readCompanyInfo(env));
  assert("readCompanyInfoWithBank: the company and its line", c.bankLine === LINE && c.nameAr === HOLDER && c.vat === "315022736600003");
  assert("readCompanyInfo itself is as it was (the receipt, the delivery note, the purchase order: no line)", !("bankLine" in bare) && bare.nameAr === HOLDER);
  const no = world(null);
  const d = await quiet(() => CO.readCompanyInfoWithBank(no));
  assert("no account: the company without the key (not an empty line)", !("bankLine" in d) && d.nameAr === HOLDER);
  const dn = world(); odooDown = "account.journal";
  const e = await warned(() => CO.readCompanyInfoWithBank(dn));
  assert("Odoo down for the journal: the company still comes back, without the line", e.threw === "" && e.out?.nameAr === HOLDER && !("bankLine" in (e.out ?? {})));
}

// ================================================================ [ج] the tax invoice PDF
console.log("\n[ج] the tax invoice PDF (the HTML Gotenberg receives at «تم التسليم»)");
{
  const env = world(); openWindow(env, C1_PHONE);
  const o = delivered();
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o));
  const html = pdfs[0] ?? "", text = plain(html);
  assert("the invoice is issued, its PDF generated and archived in R2", !!issued && invoices().length === 1 && pdfs.length === 1 && r2.length === 1 && r2[0] === `invoices/${issued!.number}.pdf`, JSON.stringify({ issued, pdfs: pdfs.length, r2 }));
  assert("it is a tax invoice (10-04): «فاتورة ضريبية مبسطة», VAT 15 %", text.includes("فاتورة ضريبية مبسطة") && invoices()[0].x_tax_amount > 0, text.slice(0, 200));
  assert("the line is on the page, to the letter", text.includes(LINE), text.slice(-900));
  assert("…once, in its own block", (html.match(/data-utak="bank-line"/g) ?? []).length === 1);
  const at = { terms: html.indexOf("شروط الدفع"), note: html.indexOf(TERMS_AR), line: html.indexOf('data-utak="bank-line"'), thanks: html.indexOf("شكراً لثقتكم"), legal: html.lastIndexOf("الرقم الضريبي") };
  assert("…where the payment terms are: under «شروط الدفع» and its note, above the thanks line and the legal strip", at.terms > 0 && at.terms < at.note && at.note < at.line && at.line < at.thanks && at.thanks < at.legal, JSON.stringify(at));
  assert("the IBAN is one left-to-right run that never breaks across two lines", html.includes('<bdi dir="ltr" style="white-space: nowrap;">IBAN SA59 4500 0000 1682 9572 3001</bdi>'));
  assert("the line is an RTL line of its own, in the terms' small type", /<div data-utak="bank-line" dir="rtl" style="font-size: 10px; [^"]*">للتحويل: شركة يوتاك — البنك السعودي الأول — <bdi/.test(html));
  assert("no SWIFT on the page", !/SWIFT|SABBSARI/.test(html));
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] the same Arabic line in every document language, and the page untouched without it");
{
  const co = { ...COMPANY, bankLine: LINE };
  const tax = { ...INV.TEST_INVOICE_DATA, vatAmount: 361.5, grandTotal: 2771.5, issued: true };
  const cases: Array<[string, any, string]> = [
    ["the Arabic template (no language asked)", INV.TEST_INVOICE_DATA, "ar"],
    ["a tax invoice, no language asked", tax, "ar"],
    ["lang ar", { ...tax, lang: "ar" }, "ar"],
    ["lang bi", { ...tax, lang: "bi" }, "bi"],
    ["lang en on a tax invoice (bilingual by law)", { ...tax, lang: "en" }, "bi"],
    ["lang en, not a tax invoice", { ...INV.TEST_INVOICE_DATA, lang: "en" }, "en"],
  ];
  for (const [label, data, lang] of cases) {
    const withLine = INV.renderInvoiceHTML(data, co), without = INV.renderInvoiceHTML(data, COMPANY);
    const row = `\n          ${PDF.renderBankLineHTML(LINE, lang as any)}`;
    assert(`${label}: the Arabic line, once`, plain(withLine).includes(LINE) && (withLine.match(/data-utak="bank-line"/g) ?? []).length === 1);
    assert(`${label}: without an account the page is byte for byte what it was`, !without.includes("bank-line") && !without.includes("IBAN") && withLine !== without && withLine.replace(row, "") === without);
  }
  const en = INV.renderInvoiceHTML({ ...INV.TEST_INVOICE_DATA, lang: "en" }, co);
  assert("the English page: «PAYMENT TERMS», and the line is not translated", en.includes("PAYMENT TERMS") && plain(en).includes(LINE) && !/Bank transfer:|For transfer/i.test(en));
  assert("…its line stays an RTL line, set to the page's start side", /<div data-utak="bank-line" dir="rtl" style="[^"]* text-align: left;">/.test(en));
  assert("an empty line is no line", PDF.renderBankLineHTML("") === "" && PDF.renderBankLineHTML(undefined) === "" && PDF.renderBankLineHTML("   ") === "" && !INV.renderInvoiceHTML(tax, { ...COMPANY, bankLine: "" }).includes("bank-line"));
  assert("the seal and the QR are where they were (an issued tax invoice with both)", (() => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const a = INV.renderInvoiceHTML(tax, { ...co, stampImage: png, signatureImage: png }), b = INV.renderInvoiceHTML(tax, { ...COMPANY, stampImage: png, signatureImage: png });
    return a.includes('data-utak="stamp"') && a.includes('data-utak="signature"') && a.replace(`\n          ${PDF.renderBankLineHTML(LINE, "ar")}`, "") === b;
  })());
}

console.log("\n[ج] no account, or Odoo down: the invoice goes, without the line");
{
  const env = world(null); openWindow(env, C1_PHONE);
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  assert("no account on the journal: the PDF is generated and archived, with no line and no IBAN", !!issued && pdfs.length === 1 && r2.length === 1 && !pdfs[0].includes("bank-line") && !pdfs[0].includes("IBAN") && pdfs[0].includes(TERMS_AR));
}
{
  const env = world({ account_number: "SA5945000000168295723002" }); openWindow(env, C1_PHONE);
  await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  assert("a wrong IBAN in Odoo: the PDF goes with NO IBAN at all (never a wrong one)", pdfs.length === 1 && r2.length === 1 && !pdfs[0].includes("IBAN") && !pdfs[0].includes("3002") && !invoiceTextOf(C1_PHONE).includes("IBAN"));
}
{
  const env = world(); openWindow(env, C1_PHONE); odooDown = "account.journal";
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  assert("Odoo down for the journal: the invoice is still issued, its PDF generated and archived", !!issued && invoices().length === 1 && pdfs.length === 1 && r2.length === 1 && !pdfs[0].includes("bank-line"), JSON.stringify({ issued, pdfs: pdfs.length, r2 }));
  assert("…and the customer still gets it", /فاتورتك رقم/.test(invoiceTextOf(C1_PHONE)) && !invoiceTextOf(C1_PHONE).includes("IBAN"));
  assert("…and the collector his request", !!requestOf(COLL_PHONE));
}

// ================================================================ [د] the quotation PDF
console.log("\n[د] the quotation PDF");
{
  const env = world(); openWindow(env, C1_PHONE);
  const o = order(C1, "quoted", "2026-10-04", 1, { x_delivery_neighborhood: "العليا" });
  const q = seed("x_quotation", { x_quotation_number: "UTAK-QUO-20261004-001", x_order_id: o, x_origin: "auto", create_date: "2026-10-04 06:00:00", x_sent_at: false });
  const r = await quiet(() => QUO.createAndDispatchQuotationForRecord(env, q));
  const html = pdfs[0] ?? "";
  assert("the customer's quotation: generated, archived, sent", !!r && !r.blocked && pdfs.length === 1 && r2[0] === "quotations/UTAK-QUO-20261004-001.pdf" && sentTo(C1_PHONE).length === 1, JSON.stringify({ r, r2 }));
  assert("the line is on the page, to the letter, once", plain(html).includes(LINE) && (html.match(/data-utak="bank-line"/g) ?? []).length === 1, plain(html).slice(-700));
  const at = { note: html.indexOf("العرض ساري حتى الساعة"), line: html.indexOf('data-utak="bank-line"'), thanks: html.indexOf("شكراً لثقتكم") };
  assert("…under the quotation's terms, above the thanks line", at.note > 0 && at.note < at.line && at.line < at.thanks, JSON.stringify(at));
  assert("the quotation's message is as it was (an offer, not a payment request): no line in it", /عرض السعر رقم/.test(bodyOf(sentTo(C1_PHONE)[0])) && !bodyOf(sentTo(C1_PHONE)[0]).includes("IBAN"));
  assert("no Odoo field outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  await quiet(() => QUO.generateQuotationPDF({ ...QUO.TEST_QUOTATION_DATA, issued: true }, env));
  assert("generateQuotationPDF (the manual quotation's PDF and preview routes): the line", pdfs.length === 1 && plain(pdfs[0]).includes(LINE));
  for (const lang of ["ar", "en", "bi"] as const) {
    const co = { ...COMPANY, bankLine: LINE }, data = { ...QUO.TEST_QUOTATION_DATA, lang };
    const withLine = QUO.renderQuotationHTML(data, co), without = QUO.renderQuotationHTML(data, COMPANY);
    assert(`a quotation in ${lang}: the same Arabic line, and the page untouched without it`, plain(withLine).includes(LINE) && !without.includes("bank-line")
      && withLine.replace(`\n          ${PDF.renderBankLineHTML(LINE, lang)}`, "") === without);
  }
  const legacy = QUO.renderQuotationHTML(QUO.TEST_QUOTATION_DATA, { ...COMPANY, bankLine: LINE });
  assert("the Arabic template (no language asked): the line", plain(legacy).includes(LINE) && legacy.replace(`\n          ${PDF.renderBankLineHTML(LINE)}`, "") === QUO.renderQuotationHTML(QUO.TEST_QUOTATION_DATA, COMPANY));
}
{
  // the sale order's quotation renders through the same template (src/sale-order-quotation.ts → generateQuotationPDF)
  const env = world();
  seed("product.product", { id: 501, product_tmpl_id: [1, "طماطم"], display_name: "طماطم" });
  seed("sale.order.line", { id: 801, product_id: [501, "طماطم"], product_uom_qty: 4, price_unit: 30, x_price_unit_manual: false, x_packaging_id: [11, "كرتون"] });
  seed("sale.order", { id: 42, name: "S00042", partner_id: [C1, "مطعم الوادي"], date_order: "2026-10-04 06:00:00", create_date: "2026-10-04 06:00:00", order_line: [801], state: "sent" });
  const data = await quiet(() => SOQ.buildQuotationPDFDataFromSaleOrder(env, 42));
  await quiet(() => QUO.generateQuotationPDF({ ...data!, issued: true }, env));
  assert("the sale order's quotation (S00042, 4 × 30): the line on its page too", !!data && data.grandTotal === 120 && pdfs.length === 1 && plain(pdfs[0]).includes("S00042") && plain(pdfs[0]).includes(LINE), JSON.stringify(data));
}
{
  const env = world(null);
  await quiet(() => QUO.generateQuotationPDF(QUO.TEST_QUOTATION_DATA, env));
  assert("no account: the quotation's PDF is generated, with no line and no IBAN", pdfs.length === 1 && !pdfs[0].includes("bank-line") && !pdfs[0].includes("IBAN") && pdfs[0].includes("العرض ساري حتى الساعة"));
  const dn = world(); odooDown = "res.partner.bank";
  const a = await warned(() => QUO.generateQuotationPDF(QUO.TEST_QUOTATION_DATA, dn));
  assert("Odoo down for the account: generated all the same, without the line", a.threw === "" && a.out instanceof Uint8Array && pdfs.length === 1 && !pdfs[0].includes("IBAN"), a.threw);
}

// ================================================================ [هـ] the free texts
console.log("\n[هـ] the customer's invoice as text (inside his window, no invoice template)");
{
  const env = world(); openWindow(env, C1_PHONE);
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  const t = invoiceTextOf(C1_PHONE);
  assert("the invoice text carries the line", t.includes(LINE), t);
  assert("…under the total, above the thanks, a blank line each side", t === [
    `🧾 فاتورتك رقم ${issued!.number}`, "", "• طماطم كرتون × 3 = 60 ر.س", "",
    "الإجمالي قبل الضريبة: 52.17 ر.س", "ضريبة القيمة المضافة 15%: 7.83 ر.س", "الإجمالي شامل الضريبة: 60 ر.س", "",
    LINE, "", "شكراً لتعاملكم مع UTAK 🌿"].join("\n"), t);
}
{
  const env = world(null); openWindow(env, C1_PHONE);
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  assert("no account: the invoice text exactly as it was", invoiceTextOf(C1_PHONE) === [
    `🧾 فاتورتك رقم ${issued!.number}`, "", "• طماطم كرتون × 3 = 60 ر.س", "",
    "الإجمالي قبل الضريبة: 52.17 ر.س", "ضريبة القيمة المضافة 15%: 7.83 ر.س", "الإجمالي شامل الضريبة: 60 ر.س", "",
    "شكراً لتعاملكم مع UTAK 🌿"].join("\n"), invoiceTextOf(C1_PHONE));
}
{
  // the invoice as a template (the approved ones): its variables are what they were
  const env = world();
  for (const [purpose, name] of [["customer_invoice_pdf", "utak_invoice_pdf_v1"], ["customer_invoice", "utak_invoice_customer_v2"]]) {
    seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 4, x_category: "UTILITY" });
  }
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  const b: any = sentTo(C1_PHONE).find((x: any) => x?.template);
  const params = (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
  assert("utak_invoice_pdf_v1 goes with its four variables: name, number, date, total", b?.template?.name === "utak_invoice_pdf_v1" && JSON.stringify(params) === JSON.stringify(["مطعم الوادي", issued!.number, "4 أكتوبر 2026", "60"]), JSON.stringify(params));
  assert("…no IBAN anywhere in the template message (the line is in the PDF it carries)", !JSON.stringify(b).includes("IBAN") && !JSON.stringify(b).includes("للتحويل") && plain(pdfs[0]).includes(LINE));
  table("x_whatsapp_template").delete(tpl("customer_invoice_pdf").id);
}
{
  const env = world();
  seed("x_whatsapp_template", { x_purpose: "customer_invoice", x_meta_template_id: "utak_invoice_customer_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 4, x_category: "UTILITY" });
  await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  const b: any = sentTo(C1_PHONE).find((x: any) => x?.template);
  const params = (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
  assert("utak_invoice_customer_v2 (the text template): four variables, no IBAN", b?.template?.name === "utak_invoice_customer_v2" && params.length === 4 && params[3] === "60" && !JSON.stringify(b).includes("IBAN"), JSON.stringify(params));
}
{
  // the re-send from Odoo reads the line itself
  const env = world(); openWindow(env, C1_PHONE);
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  graph.length = 0;
  await quiet(() => INV.sendInvoiceDocumentToCustomer(env, issued!.invoiceId));
  assert("the invoice sent again (the document route): its text carries the line", invoiceTextOf(C1_PHONE).includes(`\n\n${LINE}\n\nشكراً لتعاملكم مع UTAK 🌿`), invoiceTextOf(C1_PHONE));
}

console.log("\n[هـ] the collector's request: «💰 طلب تحصيل»");
{
  const env = world();
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  const b: any = requestOf(COLL_PHONE);
  const params = (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
  assert("as the approved template utak_collection_request: its four variables as they were", b?.template?.name === "utak_collection_request" && JSON.stringify(params) === JSON.stringify(["مطعم الوادي", "العليا", issued!.number, "60"]), JSON.stringify(params));
  assert("…and no IBAN anywhere in it", !JSON.stringify(b).includes("IBAN") && !JSON.stringify(b).includes("للتحويل"));
}
{
  // the template cannot go (not approved): the request as text with its buttons, inside his window
  const env = world(); tpl("collection_request").x_meta_status = "PAUSED"; openWindow(env, COLL_PHONE);
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  const b: any = requestOf(COLL_PHONE);
  assert("as text: the line under the amount, above «اختر طريقة التحصيل:»", bodyOf(b) === ["💰 طلب تحصيل", "", "العميل: مطعم الوادي (العليا)", `الفاتورة: ${issued!.number}`, "المبلغ: 60 ر.س", LINE, "", "اختر طريقة التحصيل:"].join("\n"), bodyOf(b));
  assert("…with its three buttons, and inside WhatsApp's 1024 characters", b?.interactive?.action?.buttons?.length === 3 && bodyOf(b).length < 1024);
}
{
  const env = world(null); tpl("collection_request").x_meta_status = "PAUSED"; openWindow(env, COLL_PHONE);
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  assert("no account: the request's text exactly as it was", bodyOf(requestOf(COLL_PHONE)) === ["💰 طلب تحصيل", "", "العميل: مطعم الوادي (العليا)", `الفاتورة: ${issued!.number}`, "المبلغ: 60 ر.س", "", "اختر طريقة التحصيل:"].join("\n"), bodyOf(requestOf(COLL_PHONE)));
}
{
  // before his «بدء الدوام»: the request waits in his queue, as text
  const env = world();
  Object.assign(table("hr.employee").get(7000 + COLL)!, { x_utak_attendance: true, resource_calendar_id: workSchedule(ALL_WEEK, { name: "UTAK — سالم" }) });
  await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  const queued = JSON.parse(env.MSG_DEDUP.store.get(teamQueueKey("+" + COLL_PHONE)) ?? "[]");
  assert("queued until his «بدء الدوام»: the queued text carries the line, and its buttons", sentTo(COLL_PHONE).length === 0 && queued.length === 1 && String(queued[0].text).includes(`المبلغ: 60 ر.س\n${LINE}\n\nاختر طريقة التحصيل:`) && queued[0].buttons.length === 3, JSON.stringify(queued));
}

console.log("\n[هـ] the collectors' list (18:00, and after «بدء الدوام»)");
{
  const env = world(); openWindow(env, C1_PHONE);
  await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  graph.length = 0;
  const rep = await quiet(() => INV.sendDailyCollectionSummary(env));
  const b: any = sentTo(COLL_PHONE)[0];
  const params = (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
  assert("as the approved template utak_collection_summary: four variables, no IBAN", rep.invoices === 1 && b?.template?.name === "utak_collection_summary" && params.length === 4 && params[2] === "60" && params[3] === "1" && !JSON.stringify(b).includes("IBAN"), JSON.stringify(b));
}
{
  const env = world(); openWindow(env, C1_PHONE);
  await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  tpl("collection_summary").x_meta_status = "PAUSED"; (await import("../src/templates.ts")).clearTemplateCache();
  openWindow(env, COLL_PHONE); graph.length = 0;
  await quiet(() => INV.sendDailyCollectionSummary(env));
  const t = bodyOf(sentTo(COLL_PHONE)[0]);
  assert("as text: the list, a blank line, the line", /^📋 قائمة التحصيل اليومية/.test(t) && t.endsWith(`اضغط زر التحصيل.\n\n${LINE}`), t);
  graph.length = 0;
  const n = await quiet(() => INV.sendCollectorBacklog(env, "+" + COLL_PHONE));
  assert("after «بدء الدوام» (the unpaid list as text): the line too", n === 1 && bodyOf(sentTo(COLL_PHONE)[0]).endsWith(`\n\n${LINE}`), bodyOf(sentTo(COLL_PHONE)[0]));
  const no = world(null); openWindow(no, C1_PHONE);
  await quiet(() => INV.createAndDispatchInvoiceForOrder(no, delivered()));
  openWindow(no, COLL_PHONE); graph.length = 0;
  await quiet(() => INV.sendCollectorBacklog(no, "+" + COLL_PHONE));
  assert("no account: the list's text as it was", bodyOf(sentTo(COLL_PHONE)[0]).endsWith("اضغط زر التحصيل.") && !bodyOf(sentTo(COLL_PHONE)[0]).includes("للتحويل"), bodyOf(sentTo(COLL_PHONE)[0]));
}

console.log("\n[هـ] «تحويل 🏦»: where the customer transfers to");
{
  const env = world(); openWindow(env, C1_PHONE);
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  const tr = await quiet(() => CP.askCollection(env, issued!.invoiceId, "transfer", collector));
  const pending = (await CP.readPending(env, issued!.invoiceId))!;
  assert("«تحويل 🏦»: the prompt, a blank line, the line — and its two buttons", tr.bodyBeforeButtons === `${CP.choiceText(pending, 60)}\n\n${LINE}` && tr.buttons?.length === 2 && /تحويل 🏦/.test(tr.bodyBeforeButtons ?? ""), String(tr.bodyBeforeButtons));
  const cash = await quiet(() => CP.askCollection(env, issued!.invoiceId, "cash", collector));
  assert("«نقد 💵»: no line", !String(cash.bodyBeforeButtons).includes("IBAN") && /نقد 💵/.test(String(cash.bodyBeforeButtons)) && cash.bodyBeforeButtons === CP.choiceText((await CP.readPending(env, issued!.invoiceId))!, 60));
  const no = world(null); openWindow(no, C1_PHONE);
  const i2 = await quiet(() => INV.createAndDispatchInvoiceForOrder(no, delivered()));
  const t2 = await quiet(() => CP.askCollection(no, i2!.invoiceId, "transfer", collector));
  assert("no account: the «تحويل» prompt as it was", t2.bodyBeforeButtons === CP.choiceText((await CP.readPending(no, i2!.invoiceId))!, 60) && t2.buttons?.length === 2);
  const dn = world(); openWindow(dn, C1_PHONE);
  const i3 = await quiet(() => INV.createAndDispatchInvoiceForOrder(dn, delivered()));
  dn.MSG_DEDUP.store.delete(BL.BANK_LINE_KV_KEY); odooDown = "account.journal";
  const t3 = await warned(() => CP.askCollection(dn, i3!.invoiceId, "transfer", collector));
  assert("Odoo down for the journal: the prompt still answers, without the line", t3.threw === "" && t3.out?.buttons?.length === 2 && !String(t3.out?.bodyBeforeButtons).includes("IBAN"), t3.threw);
}

console.log("\n[هـ] what does NOT carry the line: a receipt, an acknowledgement");
{
  const conf = PC.payconfText({ amount: 40, invoiceNumber: "UTAK-INV-20261004-001", remaining: 20, receipt: { number: "UTAK-RCP-1", method: "تحويل بنكي" } });
  assert("the payment confirmation (money arrived): no line", /استلمنا دفعتك/.test(conf) && !conf.includes("IBAN") && !conf.includes("للتحويل"));
  assert("the «وصلنا إشعار التحويل» replies: no line", !CLAIM.PAY_CLAIM_REPLY.includes("IBAN") && !CLAIM.PAY_RECEIPT_REPLY.includes("IBAN"));
  assert("«لا توجد فواتير معلّقة للتحصيل اليوم»: no line", !INV.NOTHING_TO_COLLECT_TEXT.includes("IBAN"));
}

// ================================================================ [و] one read
console.log("\n[و] one Odoo read for everything an invoice sets off");
{
  const env = world(); openWindow(env, C1_PHONE); tpl("collection_request").x_meta_status = "PAUSED"; openWindow(env, COLL_PHONE);
  const issued = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, delivered()));
  await quiet(() => CP.askCollection(env, issued!.invoiceId, "transfer", collector));
  await quiet(() => INV.sendCollectorBacklog(env, "+" + COLL_PHONE));
  await quiet(() => QUO.generateQuotationPDF(QUO.TEST_QUOTATION_DATA, env));
  await quiet(() => INV.sendInvoiceDocumentToCustomer(env, issued!.invoiceId));
  const shown = [plain(pdfs[0]), invoiceTextOf(C1_PHONE), bodyOf(requestOf(COLL_PHONE)), plain(pdfs[1])].filter((t) => t.includes(LINE)).length;
  assert("the invoice's PDF, its text, the collector's request, «تحويل», the list, a quotation, a re-send: the line in each, ONE read of the journal and ONE of the account",
    shown === 4 && pdfs.length >= 2 && journalReads().length === 1 && bankReads().length === 1, `${shown} shown, ${journalReads().length}/${bankReads().length} reads`);
}

// ================================================================ [ز] the schema
console.log("\n[ز] the schema: this tenant's field names (saas-19.4)");
{
  const fx = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20261004-s52.json", import.meta.url), "utf8"));
  assert("the fixture holds the two models with the fields the worker reads", fx["account.journal"].includes("bank_account_id") && fx["account.journal"].includes("code")
    && ["account_number", "holder_name", "bank_name", "active"].every((f) => fx["res.partner.bank"].includes(f)));
  assert("…and this tenant has no acc_number and no acc_holder_name", !fx["res.partner.bank"].includes("acc_number") && !fx["res.partner.bank"].includes("acc_holder_name") && !fx["res.partner.bank"].includes("bank_id"));
  const env = world();
  rejected.length = 0;
  const bad = await warned(() => call(env, "res.partner.bank", "read", { ids: [ACCT], fields: ["id", "acc_number"] }));
  assert("the gate knows the two models: a read of acc_number is refused as Odoo refuses it", /acc_number/.test(bad.threw) && rejected.length >= 1 && rejected.every((r) => r === "res.partner.bank.read: acc_number"), `${bad.threw} | ${rejected.join(",")}`);
  rejected.length = 0;
  const bad2 = await warned(() => call(env, "account.journal", "search_read", { domain: [["code", "=", "BNK1"]], fields: ["id", "bank_acc_number"] }));
  assert("…and of a journal field it does not have", /bank_acc_number/.test(bad2.threw) && rejected.length >= 1 && rejected.every((r) => r === "account.journal.search_read: bank_acc_number"), rejected.join(","));
  rejected.length = 0;
  const line = await quiet(() => BL.bankTransferLine(env));
  assert("the worker's own reads pass it", line === LINE && rejected.length === 0, rejected.join(" | "));
}

done();
