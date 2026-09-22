// Company info reader — single source of truth for every UTAK PDF footer.
//
// Every document (invoice, quotation, sale-order quotation, receipt, delivery
// note, purchase order, official doc) renders the same legal-footer strip at
// the bottom of the page:
//   line 1: {name} · س.ت {CRN} · الرقم الضريبي {vat}
//   line 2: {address} · {phone} · {email}
// Values here are single-language (Arabic-style values as stored in Odoo);
// Part B (i18n) adds a bilingual overlay above this reader.

import type { Env } from "./config";
import { call } from "./odoo";

export interface CompanyInfo {
  nameAr: string;
  nameEn: string;
  address: string;
  email: string;
  phone: string;
  cr: string;    // Commercial Registration (CRN)
  vat: string;   // VAT number
  // Bilingual identity + address, populated from res.company custom fields
  // (x_legal_name_ar / x_legal_name_en / x_address_ar / x_address_en) when
  // they exist. Empty strings when the field is missing or blank; the
  // renderer falls back to the single-language values above.
  legalNameAr?: string;
  legalNameEn?: string;
  addressAr?: string;
  addressEn?: string;
}

export async function readCompanyInfo(env: Env): Promise<CompanyInfo> {
  // Every Odoo tenant has res.company id=1; UTAK is single-company. Fields
  // vary by installation — 19.4 SaaS without l10n_sa_edi has no built-in
  // `company_registry` or `mobile`. We probe ir.model.fields first, then
  // read only fields the tenant actually has. Missing fields collapse to
  // "", which the legal-footer renderer hides.
  //
  // CRN source of truth: the Saudi localization stores the commercial
  // registration on res.partner as an additional identification scheme.
  // When the Saudi localization is installed, the company's linked partner
  // exposes `l10n_sa_additional_identification_scheme` (selection) plus
  // `l10n_sa_additional_identification_number` (char). We accept the number
  // only when the scheme equals "CRN" — a different scheme means the value
  // is something else (national ID, iqama, ...) and would be wrong to show
  // as a CR. When the localization is not installed yet, both fields are
  // absent and CR simply drops from the footer.
  const BASE_FIELDS = ["id", "name", "vat", "street", "street2", "city", "country_id", "zip", "phone", "email", "partner_id"];
  const OPTIONAL_COMPANY_FIELDS = [
    "mobile", "company_registry",
    "x_legal_name_ar", "x_legal_name_en", "x_address_ar", "x_address_en",
  ];
  const availableRows = await call<Array<{ name: string }>>(env, "ir.model.fields", "search_read", {
    domain: [["model", "=", "res.company"], ["name", "in", OPTIONAL_COMPANY_FIELDS]],
    fields: ["name"],
  });
  const optionalPresent = new Set(availableRows.map((r) => r.name));
  const readFields = [...BASE_FIELDS, ...OPTIONAL_COMPANY_FIELDS.filter((f) => optionalPresent.has(f))];
  const rows = await call<Array<Record<string, unknown>>>(env, "res.company", "read", {
    ids: [1],
    fields: readFields,
  });
  const c = rows[0] ?? {};
  const readStr = (k: string): string => {
    const v = c[k];
    return typeof v === "string" ? v : v === false || v === null || v === undefined ? "" : String(v);
  };
  const countryPair = c.country_id;
  const countryName = Array.isArray(countryPair) && typeof countryPair[1] === "string" ? countryPair[1] : "";
  const addrParts = [readStr("street"), readStr("street2"), readStr("city"), countryName]
    .filter((p) => p && p.trim().length > 0);
  const mobile = readStr("mobile");
  // Standard Odoo `company_registry` on res.company is a legacy fallback for
  // tenants that filled it before Saudi localization existed. Preferred
  // source is the partner-level l10n_sa scheme below.
  let cr = readStr("company_registry");
  let email = readStr("email");
  const partnerPair = c.partner_id;
  const partnerId = Array.isArray(partnerPair) && typeof partnerPair[0] === "number" ? partnerPair[0] : 0;
  if (partnerId > 0) {
    const partnerOptFields = ["l10n_sa_additional_identification_scheme", "l10n_sa_additional_identification_number"];
    let partnerReadFields: string[] = ["email"];
    try {
      const partnerAvail = await call<Array<{ name: string }>>(env, "ir.model.fields", "search_read", {
        domain: [["model", "=", "res.partner"], ["name", "in", partnerOptFields]],
        fields: ["name"],
      });
      const partnerPresent = new Set(partnerAvail.map((r) => r.name));
      partnerReadFields = ["email", ...partnerOptFields.filter((f) => partnerPresent.has(f))];
    } catch {
      // Silent — probe failure leaves partnerReadFields as email-only.
    }
    try {
      const prows = await call<Array<Record<string, unknown>>>(env, "res.partner", "read", {
        ids: [partnerId],
        fields: partnerReadFields,
      });
      const p = prows[0] ?? {};
      if (!email && typeof p.email === "string") email = p.email;
      const scheme = p.l10n_sa_additional_identification_scheme;
      const number = p.l10n_sa_additional_identification_number;
      const numberStr = typeof number === "string" ? number.trim() : "";
      if (!cr && scheme === "CRN" && numberStr) cr = numberStr;
    } catch {
      // Silent — a permission error or a field-absent tenant just leaves
      // cr/email at their current values and the footer line drops.
    }
  }
  // Bilingual company fields (optional). Empty string means "not set".
  const legalNameAr = readStr("x_legal_name_ar");
  const legalNameEn = readStr("x_legal_name_en");
  const addressAr = readStr("x_address_ar");
  const addressEn = readStr("x_address_en");
  return {
    nameAr: readStr("name") || "UTAK — يو تاك",
    nameEn: "UTAK",
    address: addrParts.join("، "),
    email,
    phone: mobile || readStr("phone"),
    cr,
    vat: readStr("vat"),
    legalNameAr,
    legalNameEn,
    addressAr,
    addressEn,
  };
}
