// § 53 هـ (2026-10-04) — the pay reminder that carries the company's IBAN, as data.
//
// Pure: no network, no worker import. scripts/s53-20261004-meta.mjs submits it to Meta (ONCE),
// scripts/s53-20261004-odoo.mjs writes its row, tests/s53.test.mts checks it against what the worker
// sends (src/outreach.ts: the template's name, its purpose, its three variables, the transfer line).
//
// ONE submission, UTILITY, no greeting and no emoji. Approved UTILITY → it takes the place of
// the reminder's template of before in the 08:00 reminder (the row that holds customer_pay_remind:
// utak_pay_remind_v3 since § 25 — the order names its ancestor utak_v2_pay_remind, retired to
// «other»). Filed MARKETING, refused or still pending → never used: the template of before stays (the gateway sends a template only APPROVED and UTILITY). Never re-submitted.

/** The transfer line of § 52 أ, as the worker builds it from the account on the bank journal BNK1. */
export const IBAN_LINE = "للتحويل: شركة يوتاك — البنك السعودي الأول — IBAN SA59 4500 0000 1682 9572 3001";

export const PAY_REMIND_IBAN = {
  name: "utak_pay_remind_iban_v1",
  purpose: "customer_pay_remind_iban",
  purposeLabel: "تذكير الدفع بالآيبان",
  label: "تذكير دفع بالفاتورة والآيبان (للعميل)",
  language: "ar",
  body: `تذكير بالفاتورة رقم {{1}} بمبلغ {{2}} ر.س، المستحقة بتاريخ {{3}}. ${IBAN_LINE}.`,
  example: ["INV-2026-0012", "450.00", "4 نوفمبر 2026"],
  params: 3,
  /** The template it replaces in the 08:00 reminder once approved UTILITY (never touched here). */
  replaces: "utak_pay_remind_v3",
};

/** The POST /message_templates payload. */
export function payRemindPayload() {
  const t = PAY_REMIND_IBAN;
  return {
    name: t.name,
    language: t.language,
    category: "UTILITY",
    components: [{ type: "BODY", text: t.body, example: { body_text: [t.example] } }],
  };
}
