// Legal-footer helper — turns a CompanyInfo into the flat LegalFooterInfo
// consumed by renderPDFShell. When a bilingual company field is set (via
// res.company.x_legal_name_ar / _en / x_address_ar / _en) the English mirror
// carries into `nameEn` / `addressEn` on the strip; the byte-parity Arabic
// side always falls back to the single-language values.

import type { CompanyInfo } from "./company";
import type { LegalFooterInfo } from "./pdf-template";
import { UI } from "./i18n";

export function toLegalFooterAr(company: CompanyInfo): LegalFooterInfo {
  return {
    name: company.legalNameAr || company.nameAr,
    cr: company.cr,
    vat: company.vat,
    address: company.addressAr || company.address,
    phone: company.phone,
    email: company.email,
    nameEn: company.legalNameEn || company.nameEn,
    addressEn: company.addressEn || company.address,
    crLabelEn: UI.crLabel.en,
    vatLabelEn: UI.vatLabel.en,
  };
}
