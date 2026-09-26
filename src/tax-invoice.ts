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
