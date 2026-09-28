// § 41 د (2026-09-26) — the tax invoice from 2026-10-01 (the issue date,
// Riyadh — VAT_EFFECTIVE_DATE_RIYADH; the order's date does not count).
//
// Prices are VAT-inclusive: the total is exactly what the customer pays at
// the market price (Σ price × qty, less the quantity discount). The printed
// breakdown:
//   • each line: net unit price = price ÷ 1.15, the quantity, net line total =
//     line total ÷ 1.15 (two decimals each);
//   • net subtotal = Σ the printed net lines; the discount (before VAT) when
//     there is one; VAT 15 %; the total including VAT;
//   • VAT = total × 15 ÷ 115, two decimals. Where the printed net lines do not
//     add up to (total − VAT) by a halala of rounding, that difference is
//     carried by the VAT line, never by the total — so
//     net subtotal − discount + VAT = total, exactly.
// Title: «فاتورة ضريبية» when the customer has a VAT number (printed), else
// «فاتورة ضريبية مبسطة». Before the cutoff: «فاتورة», no VAT anywhere.

const round2 = (n: number): number => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;

export interface TaxLine { unit: number; qty: number; gross: number }
export interface TaxBreakdown {
  lines: Array<{ unitNet: number; net: number }>;
  /** Σ the printed net lines (before the discount). */
  subtotal: number;
  discount: number;
  /** The VAT printed (and in the QR): total − (subtotal − discount). */
  tax: number;
  /** round2(total × rate ÷ (100 + rate)). */
  nominalTax: number;
  /** tax − nominalTax: the rounding the VAT line carries (a halala or so). */
  adjustment: number;
  total: number;
}

/** The printed breakdown of a tax invoice from its lines (VAT-inclusive), its total and its discount (before VAT). */
export function taxInvoiceBreakdown(lines: TaxLine[], total: number, discount: number, ratePct: number): TaxBreakdown {
  const d = 1 + ratePct / 100;
  const out = lines.map((l) => ({ unitNet: round2(l.unit / d), net: round2(l.gross / d) }));
  const subtotal = round2(out.reduce((s, l) => s + l.net, 0));
  const disc = round2(discount > 0 ? discount : 0);
  const t = round2(total);
  const nominalTax = round2((t * ratePct) / (100 + ratePct));
  const tax = round2(t - (subtotal - disc));
  return { lines: out, subtotal, discount: disc, tax, nominalTax, adjustment: round2(tax - nominalTax), total: t };
}

/** § 44 د — the partner fields the full tax invoice reads (res.partner). */
export const BUYER_TAX_FIELDS = ["id", "vat", "x_vat_status", "x_legal_name", "street", "city"] as const;
export interface BuyerTax { vat: string; legalName?: string; address?: string }
/**
 * § 44 د — the buyer of a full tax invoice, or null (a simplified one): a VAT
 * number on his card and a status that is not «غير مسجّل» — «مسجّل» (the
 * WhatsApp questions, or Baraa on the card), or «غير معروف» / empty with a
 * number Baraa typed on the card (§ 41's rule). Printed: the establishment's
 * official name (x_legal_name, else the customer's name), its VAT number and
 * its address (street, city).
 */
export function buyerTaxInfo(p: {
  vat?: string | false | null; x_vat_status?: string | false | null; x_legal_name?: string | false | null;
  street?: string | false | null; city?: string | false | null;
} | null | undefined): BuyerTax | null {
  const vat = typeof p?.vat === "string" ? p.vat.trim() : "";
  if (!vat || p?.x_vat_status === "not_registered") return null;
  const legalName = typeof p?.x_legal_name === "string" && p.x_legal_name.trim() ? p.x_legal_name.trim() : undefined;
  const address = [p?.street, p?.city].map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).join("، ") || undefined;
  return { vat, ...(legalName ? { legalName } : {}), ...(address ? { address } : {}) };
}

/** «فاتورة ضريبية» with a registered customer (a VAT number), else «فاتورة ضريبية مبسطة». */
export function taxInvoiceKind(customerVat: string | undefined | null): "tax" | "simplified" {
  return typeof customerVat === "string" && customerVat.trim() ? "tax" : "simplified";
}

/** The issue date and time, Riyadh (UTC+3): «2026/10/01 08:40». */
export function riyadhDateTime(utc: Date): string {
  const r = new Date(utc.getTime() + 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${r.getUTCFullYear()}/${p(r.getUTCMonth() + 1)}/${p(r.getUTCDate())} ${p(r.getUTCHours())}:${p(r.getUTCMinutes())}`;
}
