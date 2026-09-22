// Helpers used by every doc renderer to package the shell arguments once
// per language. Each renderer builds its own body/totals HTML but leans on
// this file for the "top of the page" concerns — title, tagline, party
// labels, date format, thanks line, terms label, legal-footer strip.

import type { CompanyInfo } from "./company";
import { UI, metaFor, type DocLang, type UILang } from "./i18n";
import type { LegalFooterInfo } from "./pdf-template";

// English month names for the "22 Sep 2026" date format used by lang=en / bi.
const EN_MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function formatDateEn(d: Date): string {
  return `${d.getDate()} ${EN_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// The party-label logic: ar shows the legacy "فاتورة إلى / BILL TO" pair
// exactly as before (byte-parity path); en shows "BILL TO"/"FROM" only; bi
// shows the ar/en pair "فاتورة إلى / BILL TO" (same as legacy but rendered
// through the additive path).
export function labelForBillTo(lang: DocLang): string {
  if (lang === "en") return "BILL TO";
  return "فاتورة إلى / BILL TO";
}
export function labelForFrom(lang: DocLang): string {
  if (lang === "en") return "FROM";
  return "من / FROM";
}
export function labelForRecipient(lang: DocLang): string {
  // Same rule as billTo, but for the recipient label above delivery notes,
  // receipts, POs: ar shows "فاتورة إلى / BILL TO" too.
  return labelForBillTo(lang);
}
export function labelForSender(lang: DocLang): string {
  return labelForFrom(lang);
}

// Terms-block label ("شروط الدفع"). Same rule as party labels — ar keeps
// the legacy pair, en switches to English, bi keeps the Arabic label.
export function labelForTerms(lang: DocLang): string {
  if (lang === "en") return "PAYMENT TERMS";
  return "شروط الدفع";
}

// Thanks line: "شكراً لثقتكم في {name}" — localizes both the wording and the
// company name (Arabic vs English).
export function thanksLine(lang: DocLang, company: CompanyInfo | undefined): string {
  const nameAr = company?.nameAr || "UTAK — يو تاك";
  const nameEn = company?.nameEn || "UTAK";
  if (lang === "en") return `${UI.thanksPrefix.en} ${nameEn}`;
  if (lang === "bi") return `${UI.thanksPrefix.ar} ${nameAr}`;
  // ar
  return `${UI.thanksPrefix.ar} ${nameAr}`;
}

// Header tagline. bi keeps the Arabic form (page primary language is ar).
export function taglineFor(lang: DocLang): string {
  if (lang === "en") return UI.tagline.en;
  return UI.tagline.ar;
}

// Localize the LegalFooterInfo — filling English mirrors from CompanyInfo
// (bilingual company fields will come from Baraa; empty ones fall back).
export function legalFooterFor(company: CompanyInfo, lang: DocLang, bilingualCompany?: BilingualCompany): LegalFooterInfo {
  const nameEn = bilingualCompany?.nameEn || company.nameEn;
  const addressEn = bilingualCompany?.addressEn || company.address;
  const nameAr = bilingualCompany?.nameAr || company.nameAr;
  const addressAr = bilingualCompany?.addressAr || company.address;
  const info: LegalFooterInfo = {
    name: nameAr,
    cr: company.cr,
    vat: company.vat,
    address: addressAr,
    phone: company.phone,
    email: company.email,
    nameEn,
    addressEn,
    crLabelEn: UI.crLabel.en,
    vatLabelEn: UI.vatLabel.en,
  };
  return info;
}

// Bilingual company fields, filled by readCompanyInfo when the res.company
// x_legal_name_ar / _en and x_address_ar / _en fields exist.
export interface BilingualCompany {
  nameAr?: string;
  nameEn?: string;
  addressAr?: string;
  addressEn?: string;
}

// Item-cell rendering — Arabic on top, English underneath in a smaller
// muted font. When name_en is empty we return just the Arabic name (same
// output as ar mode). For lang=en we swap: English on top, Arabic falls
// back only when English is missing.
export function itemCellHTML(nameAr: string, nameEn: string | undefined, lang: DocLang): string {
  const escAr = escape(nameAr);
  const escEn = nameEn ? escape(nameEn) : "";
  if (lang === "en") {
    // English-first display; fall back to Arabic when name_en is empty.
    if (escEn) return escEn;
    return escAr;
  }
  if (lang === "bi" && escEn) {
    return `${escAr}<div style="font-size: 10px; color: #6B6863; font-weight: 400; margin-top: 2px;">${escEn}</div>`;
  }
  // ar (or bi with empty en) — legacy shape, byte-parity path in Part A.
  return escAr;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Convenience: turn a lang into the label the shell/renderers use to pick
// which UI copy variant to emit. bi renders the Arabic copy on top with an
// English mirror; en renders English only.
export function primaryUILang(lang: DocLang): UILang {
  return metaFor(lang).primary;
}

// Party used for the "FROM" slot on every doc — company identity block.
// en → prefers the bilingual English legal name/address; bi/ar → Arabic.
// Undefined return means "use the shell's default (BRAND_INFO)".
export function fromPartyFor(lang: DocLang, company: CompanyInfo | undefined): { name: string; address?: string; email?: string; phone?: string } | undefined {
  if (!company) return undefined;
  if (lang === "en") {
    return {
      name: company.legalNameEn || company.nameEn,
      address: company.addressEn || company.address,
      email: company.email,
      phone: company.phone,
    };
  }
  // ar and bi: leading Arabic identity.
  return {
    name: company.legalNameAr || company.nameAr,
    address: company.addressAr || company.address,
    email: company.email,
    phone: company.phone,
  };
}
