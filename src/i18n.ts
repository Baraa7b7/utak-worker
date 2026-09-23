// UTAK i18n — every fixed piece of text every UTAK PDF ever renders.
// The dictionary is ar/en ONLY; bilingual (bi) is Arabic + English shown
// side-by-side at render time, so the strings themselves are ar+en pairs.
//
// KEEP IT COMPLETE: tests/i18n.test.mts asserts every key has both ar and en.
// Adding a key without both languages will fail CI.
//
// Language resolver rules (see resolveDocLang):
//   1. Explicit doc-level x_doc_lang wins.
//   2. Partner default (res.partner.x_doc_lang) is next.
//   3. "ar" is the ultimate fallback.
//   4. Tax-invoice guard: Saudi VAT executive regulation Article 53
//      requires the Arabic text of a tax invoice to appear on it. When the
//      resolved language of an invoice is "en", we upgrade it to "bi" so
//      the Arabic version is always present on tax invoices.

export type DocLang = "ar" | "en" | "bi";
export type UILang = "ar" | "en"; // dictionary keys

export interface UITextMap {
  ar: string;
  en: string;
}

const T = (ar: string, en: string): UITextMap => ({ ar, en });

export const UI = {
  // ---------------- doc titles ----------------
  invoice: T("فاتورة", "Invoice"),
  // 2026-09-23 — title of an invoice that carries VAT (dated on/after the
  // VAT cutoff). Tax-free invoices keep "فاتورة".
  taxInvoice: T("فاتورة ضريبية", "Tax Invoice"),
  quotation: T("عرض سعر", "Quotation"),
  receipt: T("إيصال دفع", "Payment Receipt"),
  deliveryNote: T("إذن تسليم", "Delivery Note"),
  purchaseOrder: T("أمر شراء", "Purchase Order"),
  officialLetter: T("خطاب رسمي", "Official Letter"),
  officialCertificate: T("شهادة", "Certificate"),
  officialAuthorization: T("تفويض", "Authorization"),
  officialStatement: T("قائمة", "Statement"),
  officialOther: T("مستند", "Document"),

  // ---------------- header ----------------
  tagline: T("توزيع منتجات زراعية طازجة", "Fresh Produce Distribution"),
  previewBadge: T("معاينة — غير معتمد", "PREVIEW — NOT CERTIFIED"),

  // ---------------- party labels ----------------
  billTo: T("فاتورة إلى", "BILL TO"),
  from: T("من", "FROM"),

  // ---------------- columns ----------------
  colItem: T("الصنف", "Item"),
  colPackaging: T("العبوة", "Packaging"),
  colQty: T("الكمية", "Qty"),
  colPrice: T("السعر", "Price"),
  colTotal: T("الإجمالي", "Total"),
  colOrderedQty: T("الكمية المطلوبة", "Qty Ordered"),
  colAgreedPrice: T("السعر المتفق", "Agreed Price"),
  colInvoiceNumber: T("رقم الفاتورة", "Invoice #"),
  colInvoiceDate: T("تاريخ الفاتورة", "Invoice Date"),
  colAmount: T("المبلغ", "Amount"),
  colPaymentMethod: T("طريقة الدفع", "Payment Method"),

  // ---------------- totals block ----------------
  subtotal: T("المجموع الفرعي", "Subtotal"),
  discount: T("الخصم", "Discount"),
  vat15: T("ضريبة القيمة المضافة (١٥٪)", "VAT (15%)"),
  grandTotal: T("الإجمالي", "Total"),
  // 2026-09-23 — tax-invoice totals (prices are VAT-inclusive).
  subtotalExclVat: T("الإجمالي قبل الضريبة", "Total excl. VAT"),
  grandTotalInclVat: T("الإجمالي شامل الضريبة", "Total incl. VAT"),
  sellerVatNo: T("الرقم الضريبي للمنشأة", "Seller VAT No."),
  buyerVatNo: T("الرقم الضريبي للعميل", "Customer VAT No."),
  totalReceived: T("إجمالي المستلم", "Total Received"),

  // ---------------- footer notes ----------------
  paymentTermsLabel: T("شروط الدفع", "Payment Terms"),
  invoicePaymentTerms: T(
    "الدفع خلال ٣٠ يوماً من تاريخ الفاتورة. تحويل بنكي أو نقداً عند التسليم.",
    "Payment due within 30 days of invoice date. Bank transfer or cash on delivery.",
  ),
  quotationValidity: T(
    "الأسعار سارية حتى ٩:٠٠ مساءً من تاريخ الإصدار، وتخضع لأسعار السوق اليومية",
    "Prices valid until 9:00 PM on the issue date and are subject to daily market prices",
  ),
  receiptConfirmation: T(
    "استلمنا منكم المبلغ المذكور أعلاه عن الفواتير المدرجة. شكراً لالتزامكم.",
    "The above amount has been received from you for the listed invoices. Thank you for your commitment.",
  ),
  deliveryNoteHint: T(
    "سيصلكم رابط لتوقيع الاستلام مع رسالة واتساب تأكيدية بعد إتمام التسليم.",
    "You will receive a signature link and a WhatsApp confirmation after delivery is completed.",
  ),
  poNote: T(
    "يُرجى التسليم في التاريخ المحدد. أي تعديل في الأسعار يتطلب موافقة مسبقة من UTAK.",
    "Please deliver on the specified date. Any price change requires UTAK's prior approval.",
  ),

  // ---------------- thanks ----------------
  thanksPrefix: T("شكراً لثقتكم في", "Thank you for trusting"),

  // ---------------- official-doc extras ----------------
  toLabel: T("إلى", "To"),
  subjectLabel: T("الموضوع", "Subject"),
  previewLabel: T("معاينة", "Preview"),
  signature: T("التوقيع", "Signature"),
  seal: T("الختم", "Seal"),
  date: T("التاريخ", "Date"),

  // ---------------- legal-footer labels ----------------
  crLabel: T("س.ت", "CR No."),
  vatLabel: T("الرقم الضريبي", "VAT No."),

  // ---------------- payment methods ----------------
  methodCash: T("نقد", "Cash"),
  methodBankTransfer: T("تحويل بنكي", "Bank Transfer"),
} as const;

export type UIKey = keyof typeof UI;

// Look up a string. For "bi" callers pull each language explicitly:
//   const ar = t("colItem", "ar"); const en = t("colItem", "en");
export function t(key: UIKey, lang: UILang): string {
  return UI[key][lang];
}

// ============================================================================
// Language resolver
// ============================================================================

export interface ResolveArgs {
  // Doc-level x_doc_lang / x_lang value ("ar" | "en" | "bi" | undefined).
  docLang?: string | null | false;
  // Partner-level x_doc_lang ("ar" | "en" | undefined).
  partnerLang?: string | null | false;
  // Whether this is a tax invoice — enables the Article-53 upgrade.
  isTaxInvoice?: boolean;
}

const VALID: readonly DocLang[] = ["ar", "en", "bi"] as const;

function normalize(v: unknown): DocLang | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  return (VALID as readonly string[]).includes(s) ? (s as DocLang) : null;
}

export function resolveDocLang(args: ResolveArgs): DocLang {
  const docL = normalize(args.docLang);
  const partnerL = normalize(args.partnerLang);
  let picked: DocLang = docL ?? partnerL ?? "ar";
  // KSA VAT Executive Regulation, Article 53: a tax invoice must be issued
  // in Arabic. A pure-English tax invoice is non-compliant, so we upgrade
  // "en" to "bi" (bilingual keeps the Arabic on the page).
  if (args.isTaxInvoice && picked === "en") picked = "bi";
  return picked;
}

// Direction/text metadata per resolved language. Renderers use this to swap
// dir, font, and numeral system.
export interface LangMeta {
  primary: UILang;      // the leading language for RTL/LTR direction
  dir: "rtl" | "ltr";
  useWesternDigits: boolean;
  // Fonts. The Arabic set stays IBM Plex Sans Arabic; Space Grotesk covers
  // English. bi mode loads both.
  fonts: {
    arabic: boolean;
    english: boolean;
  };
}

export function metaFor(lang: DocLang): LangMeta {
  if (lang === "ar") return { primary: "ar", dir: "rtl", useWesternDigits: false, fonts: { arabic: true, english: false } };
  if (lang === "en") return { primary: "en", dir: "ltr", useWesternDigits: true, fonts: { arabic: false, english: true } };
  // bi: Arabic primary, both fonts loaded.
  return { primary: "ar", dir: "rtl", useWesternDigits: false, fonts: { arabic: true, english: true } };
}
