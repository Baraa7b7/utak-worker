// Legal-footer helper — turns a CompanyInfo into the flat LegalFooterInfo
// consumed by renderPDFShell. Part A only knows Arabic values; Part B adds
// an en/bi overlay on top of this helper.

import type { CompanyInfo } from "./company";
import type { LegalFooterInfo } from "./pdf-template";

export function toLegalFooterAr(company: CompanyInfo): LegalFooterInfo {
  return {
    name: company.nameAr,
    cr: company.cr,
    vat: company.vat,
    address: company.address,
    phone: company.phone,
    email: company.email,
  };
}
