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
  // Bilingual address strings, always populated: when x_address_ar/_en are
  // set they win; otherwise they're built from street/street2/city plus the
  // country name read in the matching Odoo lang context (ar_001 vs en_US).
  addressAr?: string;
  addressEn?: string;
  // Company seal + authorized signature (res.company x_stamp_image /
  // x_signature_image, 2026-09-24) as data: URIs, ready for <img src>.
  // Undefined when the field is missing or empty. Printed on ISSUED
  // documents only — never on a draft or preview.
  stampImage?: string;
  signatureImage?: string;
}

// Odoo BCP-47 codes for the active languages on this tenant. The pair is
// documented so readers can see the intent without a lookup: both must be
// activated in res.lang (they already are on utakfresh — confirmed by probe
// 2026-09-22).
export const LANG_AR = "ar_001";
export const LANG_EN = "en_US";

// Country-name fallback used when neither the ar_001 nor en_US context yields
// a translated country name. Saudi Arabia is the only country UTAK operates
// in today; extend the map if that changes.
const COUNTRY_NAME_FALLBACK: Record<string, { ar: string; en: string }> = {
  SA: { ar: "المملكة العربية السعودية", en: "Saudi Arabia" },
};

export async function readCompanyInfo(env: Env): Promise<CompanyInfo> {
  // Every Odoo tenant has res.company id=1; UTAK is single-company. Fields
  // vary by installation — 19.4 SaaS without l10n_sa_edi has no built-in
  // `company_registry` or `mobile`. We probe ir.model.fields first, then
  // read only fields the tenant actually has. Missing fields collapse to
  // "", which the legal-footer renderer hides.
  //
  // CRN source of truth (utakfresh on Odoo 19.4 SaaS): res.company /
  // res.partner both expose `additional_identifiers`, a JSON dict Odoo
  // renders behind the "Additional Identifiers" widget beside VAT. The
  // Saudi Commercial Registration Number stores under the key SA_CRN.
  // Other Saudi keys (SA_TIN, SA_MOMRAH, SA_MHRSD, SA_MISA, SA_NATIONAL_ID,
  // SA_GCC_ID, SA_IQAMA, SA_PASSPORT, SA_OTHER_ID, SA_NUMBER_700, DUNS) are
  // intentionally ignored — they are valid identifiers but wrong to render
  // as "س.ت" in the footer.
  const BASE_FIELDS = ["id", "name", "vat", "street", "street2", "city", "country_id", "zip", "phone", "email", "partner_id"];
  const OPTIONAL_COMPANY_FIELDS = [
    "mobile", "company_registry", "additional_identifiers",
    "x_legal_name_ar", "x_legal_name_en", "x_address_ar", "x_address_en",
    "x_stamp_image", "x_signature_image",
  ];
  const availableRows = await call<Array<{ name: string }>>(env, "ir.model.fields", "search_read", {
    domain: [["model", "=", "res.company"], ["name", "in", OPTIONAL_COMPANY_FIELDS]],
    fields: ["name"],
  });
  const optionalPresent = new Set(availableRows.map((r) => r.name));
  const readFields = [...BASE_FIELDS, ...OPTIONAL_COMPANY_FIELDS.filter((f) => optionalPresent.has(f))];

  // Read the company row twice — once in each lang context — so we get the
  // country_id translated to both languages in one round-trip pair. Every
  // other field is language-independent, but reading with a lang context is
  // still valid: Odoo returns the same string.
  // The two images are language-independent and large: only the ar read
  // fetches them.
  const IMAGE_FIELDS = new Set(["x_stamp_image", "x_signature_image"]);
  const [rowsAr, rowsEn] = await Promise.all([
    call<Array<Record<string, unknown>>>(env, "res.company", "read", {
      ids: [1], fields: readFields, context: { lang: LANG_AR },
    }),
    call<Array<Record<string, unknown>>>(env, "res.company", "read", {
      ids: [1], fields: readFields.filter((f) => !IMAGE_FIELDS.has(f)), context: { lang: LANG_EN },
    }),
  ]);
  const cAr = rowsAr[0] ?? {};
  const cEn = rowsEn[0] ?? {};
  // Every scalar (name, vat, street, phone…) is identical in both reads;
  // we anchor on the ar read so existing single-language `.address` output
  // keeps its shape. Only country_id differs.
  const c = cAr;
  const readStr = (k: string): string => {
    const v = c[k];
    return typeof v === "string" ? v : v === false || v === null || v === undefined ? "" : String(v);
  };
  const countryPairAr = cAr.country_id;
  const countryPairEn = cEn.country_id;
  const countryCode = (() => {
    // country_id is a many2one; ["id", "display_name"]. The 2-letter ISO
    // code isn't inline — we probe it once from res.country. Cache-free
    // because there's only one company and one read per document.
    return Array.isArray(countryPairAr) && typeof countryPairAr[0] === "number" ? countryPairAr[0] : 0;
  })();
  let countryNameAr = Array.isArray(countryPairAr) && typeof countryPairAr[1] === "string" ? countryPairAr[1] : "";
  let countryNameEn = Array.isArray(countryPairEn) && typeof countryPairEn[1] === "string" ? countryPairEn[1] : "";
  // Guard: if either read returned the English name in the Arabic context
  // (older Odoo without ar translation for res.country) we plug the gap
  // from COUNTRY_NAME_FALLBACK using the country's ISO code.
  if (countryCode > 0 && (!countryNameAr || /[A-Za-z]/.test(countryNameAr))) {
    try {
      const [country] = await call<Array<{ code: string }>>(env, "res.country", "read", {
        ids: [countryCode], fields: ["code"],
      });
      const iso = typeof country?.code === "string" ? country.code : "";
      const fb = COUNTRY_NAME_FALLBACK[iso];
      if (fb) {
        if (!countryNameAr || /[A-Za-z]/.test(countryNameAr)) countryNameAr = fb.ar;
        if (!countryNameEn) countryNameEn = fb.en;
      }
    } catch {
      // Silent — the fallback layer below still guarantees the footer prints
      // *some* country name, at worst the English one on both sides.
    }
  }
  if (!countryNameEn) countryNameEn = countryNameAr;
  if (!countryNameAr) countryNameAr = countryNameEn;

  const addrPartsAr = [readStr("street"), readStr("street2"), readStr("city"), countryNameAr]
    .filter((p) => p && p.trim().length > 0);
  const addrPartsEn = [readStr("street"), readStr("street2"), readStr("city"), countryNameEn]
    .filter((p) => p && p.trim().length > 0);
  const mobile = readStr("mobile");
  // Standard Odoo `company_registry` on res.company is a legacy fallback for
  // tenants that filled it before the additional_identifiers widget existed.
  let cr = readStr("company_registry");
  // additional_identifiers is `json` — the Odoo JSON-2 client returns the
  // dict already parsed, but sometimes returns a serialized string when the
  // field is empty. Coerce both to a plain object before reading SA_CRN.
  const additional = c.additional_identifiers;
  if (!cr && additional && typeof additional === "object" && !Array.isArray(additional)) {
    const rec = additional as Record<string, unknown>;
    const v = rec.SA_CRN;
    if (typeof v === "string" && v.trim()) cr = v.trim();
  } else if (!cr && typeof additional === "string" && additional.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(additional) as Record<string, unknown>;
      const v = parsed.SA_CRN;
      if (typeof v === "string" && v.trim()) cr = v.trim();
    } catch {
      // Ignore — malformed JSON leaves cr empty and the footer line drops.
    }
  }
  let email = readStr("email");
  const partnerPair = c.partner_id;
  const partnerId = Array.isArray(partnerPair) && typeof partnerPair[0] === "number" ? partnerPair[0] : 0;
  if (partnerId > 0) {
    // Partner is the fallback source for CR (in case Baraa entered it on the
    // partner row instead of the company row — the modal accepts both). We
    // also pick up email from the partner when the company row is blank.
    try {
      const partnerFields = ["email"];
      const partnerAvail = await call<Array<{ name: string }>>(env, "ir.model.fields", "search_read", {
        domain: [["model", "=", "res.partner"], ["name", "in", ["additional_identifiers"]]],
        fields: ["name"],
      });
      if (partnerAvail.some((r) => r.name === "additional_identifiers")) {
        partnerFields.push("additional_identifiers");
      }
      const prows = await call<Array<Record<string, unknown>>>(env, "res.partner", "read", {
        ids: [partnerId], fields: partnerFields,
      });
      const p = prows[0] ?? {};
      if (!email && typeof p.email === "string") email = p.email;
      const padd = p.additional_identifiers;
      if (!cr && padd && typeof padd === "object" && !Array.isArray(padd)) {
        const v = (padd as Record<string, unknown>).SA_CRN;
        if (typeof v === "string" && v.trim()) cr = v.trim();
      } else if (!cr && typeof padd === "string" && padd.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(padd) as Record<string, unknown>;
          const v = parsed.SA_CRN;
          if (typeof v === "string" && v.trim()) cr = v.trim();
        } catch {
          // Silent — partner-side JSON parse failure leaves cr as-is.
        }
      }
    } catch {
      // Silent — a partner ACL error or a field-absent tenant just leaves
      // cr/email at their current values and the footer line drops.
    }
  }
  // Bilingual company fields (optional). Empty string means "not set".
  const legalNameAr = readStr("x_legal_name_ar");
  const legalNameEn = readStr("x_legal_name_en");
  const addressArField = readStr("x_address_ar");
  const addressEnField = readStr("x_address_en");
  return {
    nameAr: readStr("name") || "شركة يوتاك",
    nameEn: "UTAK",
    // Legacy single-language address string. The national address in
    // x_address_ar wins when set (2026-09-24: building no., street, district,
    // city zip-additional); else street/street2/city + Arabic country name.
    address: addressArField || addrPartsAr.join("، "),
    email,
    phone: mobile || readStr("phone"),
    cr,
    vat: readStr("vat"),
    legalNameAr,
    legalNameEn,
    // Bilingual: prefer the custom field, else the composed string with the
    // matching-language country name. Always populated — the renderer is free
    // to pick whichever matches the doc's lang and to not fall back further.
    addressAr: addressArField || addrPartsAr.join("، "),
    addressEn: addressEnField || addrPartsEn.join(", "),
    stampImage: imageDataUri(c.x_stamp_image),
    signatureImage: imageDataUri(c.x_signature_image),
  };
}

// Odoo returns a binary field as bare base64. Sniff the type from the first
// bytes (PNG / JPEG / SVG / WebP); anything else is not printed.
export function imageDataUri(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const b64 = v.trim();
  const mime = b64.startsWith("iVBORw0KGgo") ? "image/png"
    : b64.startsWith("/9j/") ? "image/jpeg"
    : b64.startsWith("PHN2Zy") || b64.startsWith("PD94bWwg") ? "image/svg+xml"
    : b64.startsWith("UklGR") ? "image/webp"
    : "";
  return mime ? `data:${mime};base64,${b64}` : undefined;
}
