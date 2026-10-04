// § 52 أ (2026-10-04) — the company's bank-transfer line:
//
//   للتحويل: شركة يوتاك — البنك السعودي الأول — IBAN SA59 4500 0000 1682 9572 3001
//
// = «للتحويل: <holder_name> — <bank_name> — IBAN <the IBAN in groups of four>». The same Arabic
// line whatever the document's language (ar / en / bi), and no SWIFT.
//
// Where it is read: the bank journal (account.journal, code BNK1) → its bank_account_id →
// res.partner.bank. This tenant is Odoo saas-19.4: account_number, holder_name, bank_name (a char),
// active — there is no acc_number, no acc_holder_name and no res.bank.
//
// Never a wrong or a partial IBAN: the line exists only when the journal has an ACTIVE account
// with a holder name, a bank name and a Saudi IBAN («SA» + 22 digits = 24 characters without its
// spaces) whose ISO 13616 check (mod 97) is 1. Anything else — no journal, no account, an archived
// account, an empty name, a bad IBAN, Odoo unreadable — gives "" (no line at all) and ONE
// console.warn; bankTransferLine never throws, so a document or a message goes without the line
// instead of failing.
//
// Cache: the account that gave a valid line stays in KV for BANK_LINE_TTL_SECONDS (one Odoo read
// for the documents and messages of those minutes, whatever the isolate). «No line» is not cached:
// the account created in Odoo shows on the next document. A cached account is checked again before
// it is shown (the same IBAN rules), and a KV that cannot be read or written is only a slower path.
//
// Where it shows: the terms block of the tax invoice and of the quotation (src/pdf-template.ts,
// through CompanyInfo.bankLine — src/company.ts readCompanyInfoWithBank), and the free texts that
// ask for a payment or a collection (src/invoice.ts, src/collect-pay.ts). Never a template's
// variables: the approved templates are as Meta has them.

import type { Env } from "./config";
import { call } from "./odoo";

export const BANK_JOURNAL_CODE = "BNK1";
export const BANK_LINE_KV_KEY = "bank_line:v1";
export const BANK_LINE_TTL_SECONDS = 10 * 60;
/** «SA» + two check digits + 20 digits. */
export const SAUDI_IBAN_LENGTH = 24;

export interface BankAccount {
  holder: string;
  bank: string;
  /** As stored in Odoo (with or without spaces). */
  iban: string;
}

/** The IBAN without its spaces, upper case. */
export function compactIban(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, "").toUpperCase() : "";
}

/**
 * ISO 13616: the first four characters go to the end, a letter counts as 10 … 35, and the number
 * is taken mod 97 — 1 for a valid IBAN. −1 for a character that is neither a digit nor A–Z.
 */
export function ibanMod97(iban: string): number {
  const s = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of s) {
    const v = ch >= "0" && ch <= "9" ? ch : ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : "";
    if (!v) return -1;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem;
}

/** Why a compact IBAN is not shown, or "" for a valid Saudi one. */
export function ibanProblem(iban: string): string {
  if (!iban) return "the IBAN is empty";
  if (iban.length !== SAUDI_IBAN_LENGTH || !/^SA\d+$/.test(iban)) return `the IBAN is not a Saudi one («SA» + 22 digits; it has ${iban.length} characters)`;
  if (ibanMod97(iban) !== 1) return "the IBAN's check digits are wrong (mod 97)";
  return "";
}

export function isSaudiIban(raw: unknown): boolean {
  return ibanProblem(compactIban(raw)) === "";
}

/** «SA59 4500 0000 1682 9572 3001». */
export function groupIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

const oneLine = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** Why this account gives no line, or "". */
export function bankAccountProblem(a: BankAccount | null | undefined): string {
  if (!a) return "no account";
  if (!oneLine(a.holder)) return "the account holder's name is empty";
  if (!oneLine(a.bank)) return "the bank's name is empty";
  return ibanProblem(compactIban(a.iban));
}

/** The line of a valid account, else "" (never a wrong or a partial IBAN). */
export function formatBankLine(a: BankAccount | null | undefined): string {
  if (!a || bankAccountProblem(a)) return "";
  return `للتحويل: ${oneLine(a.holder)} — ${oneLine(a.bank)} — IBAN ${groupIban(compactIban(a.iban))}`;
}

/** A free text with the line under it (a blank line between), or the text as it is when there is no line. */
export function withBankLine(text: string, line: string): string {
  return line ? `${text}\n\n${line}` : text;
}

type M2O = [number, string] | number | false | null | undefined;
const m2oId = (v: M2O): number => (Array.isArray(v) ? Number(v[0]) || 0 : typeof v === "number" ? v : 0);

/**
 * The company's account from Odoo (no cache): the journal BNK1's bank_account_id. Throws on Odoo
 * trouble; { why } when Odoo answered and there is no account to show.
 */
export async function readBankAccount(env: Env): Promise<{ account: BankAccount } | { why: string }> {
  const journals = await call<Array<{ id: number; bank_account_id: M2O }>>(env, "account.journal", "search_read", {
    domain: [["code", "=", BANK_JOURNAL_CODE]],
    fields: ["id", "bank_account_id"],
    limit: 1,
  });
  if (!journals.length) return { why: `no journal ${BANK_JOURNAL_CODE}` };
  const bankId = m2oId(journals[0].bank_account_id);
  if (!bankId) return { why: `the journal ${BANK_JOURNAL_CODE} has no bank account` };
  const [row] = await call<Array<{ id: number; account_number: string | false; holder_name: string | false; bank_name: string | false; active: boolean }>>(
    env, "res.partner.bank", "read", { ids: [bankId], fields: ["id", "account_number", "holder_name", "bank_name", "active"] },
  );
  if (!row) return { why: `the bank account #${bankId} is not found` };
  if (row.active === false) return { why: `the bank account #${bankId} is archived` };
  const account: BankAccount = { holder: oneLine(row.holder_name), bank: oneLine(row.bank_name), iban: compactIban(row.account_number) };
  const problem = bankAccountProblem(account);
  return problem ? { why: `the bank account #${bankId}: ${problem}` } : { account };
}

interface Cached extends BankAccount { at: number }

async function readCached(env: Env, now: number): Promise<BankAccount | null> {
  try {
    const raw = await env.MSG_DEDUP.get(BANK_LINE_KV_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (!(c.at > 0) || now - c.at >= BANK_LINE_TTL_SECONDS * 1000) return null;
    return c;
  } catch {
    return null; // an unreadable cache is a slower path, not a missing line
  }
}

/**
 * The line to show now, or "": from the cache, else from Odoo (and into the cache when valid).
 * Never throws; one console.warn when there is no line.
 */
export async function bankTransferLine(env: Env, now: number = Date.now()): Promise<string> {
  let why: string;
  try {
    const hit = formatBankLine(await readCached(env, now));
    if (hit) return hit;
    const r = await readBankAccount(env);
    if ("account" in r) {
      const line = formatBankLine(r.account);
      if (line) {
        try {
          const entry: Cached = { ...r.account, at: now };
          await env.MSG_DEDUP.put(BANK_LINE_KV_KEY, JSON.stringify(entry), { expirationTtl: BANK_LINE_TTL_SECONDS });
        } catch { /* the next document reads Odoo again */ }
        return line;
      }
      why = bankAccountProblem(r.account);
    } else {
      why = r.why;
    }
  } catch (e) {
    why = `Odoo unreadable (${(e as Error)?.message ?? e})`;
  }
  console.warn(`[bank-line] no bank-transfer line: ${why}`);
  return "";
}
