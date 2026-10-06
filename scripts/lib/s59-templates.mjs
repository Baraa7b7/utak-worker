// § 59 (2026-10-06) — the two templates of this order, as data.
//
// Pure: no network, no worker import. scripts/s59-20261006-templates.mjs submits each to Meta (ONCE),
// scripts/s59-20261006-odoo.mjs writes their rows and purposes, tests/s59-*.test.mts check them
// against what the worker sends (the name, the purpose, the variables, the button's payload).
//
// ONE submission each, UTILITY. Approved UTILITY → the worker uses it (the gateway sends a template
// only APPROVED and UTILITY). Filed MARKETING, refused or still pending → never used:
//   • the team's «القائمة جاهزة»: the list waits in the member's queue until he writes;
//   • the quotation: utak_quotation_pdf_v1 stays.
// Never re-submitted.

/** [ب 2] — the marketing member's «قائمة الأسعار جاهزة» outside his 24h window, with «أرسل القائمة». */
export const TEAM_PRICES_READY = {
  name: "utak_team_prices_ready_v1",
  purpose: "team_prices_ready",
  purposeLabel: "قائمة أسعار اليوم جاهزة (للفريق)",
  label: "قائمة أسعار اليوم جاهزة — زر «أرسل القائمة» (للفريق)",
  language: "ar",
  body: "تحديث مهمة في يو تاك: قائمة أسعار يو تاك ليوم {{1}} جاهزة ضمن مهامك. اضغط «أرسل القائمة» لاستلامها في هذه المحادثة.",
  example: ["6 أكتوبر 2026"],
  params: 1,
  buttons: [{ type: "QUICK_REPLY", text: "أرسل القائمة" }],
  /** The quick reply's payload, as the worker sets it at send time (src/team-prices.ts). */
  payload: "team_prices_send",
  documentHeader: false,
};

/** [د 2] — the quotation as an attached PDF outside the customer's window: the wording of § 49 (valid until 06:00 of the next day). */
export const QUOTATION_PDF_V2 = {
  name: "utak_quotation_pdf_v2",
  purpose: "customer_quotation_pdf_v2",
  purposeLabel: "عرض السعر PDF (صالح حتى 6:00 صباحاً)",
  label: "عرض السعر PDF مرفقاً — الأسعار حتى 6:00 صباح اليوم التالي (للعميل)",
  language: "ar",
  body: "مرحباً {{1}}، مرفق عرض السعر رقم {{2}} من يو تاك بتاريخ {{3}}، بإجمالي {{4}} ريال. الأسعار سارية حتى الساعة 6:00 صباحاً من اليوم التالي، ولأي استفسار ردّ على هذه الرسالة.",
  example: ["مطعم الريف", "Q-2026-0012", "6 أكتوبر 2026", "450.00"],
  params: 4,
  buttons: [],
  documentHeader: true,
  /** The template it replaces once approved UTILITY (never touched here: it stays the fallback). */
  replaces: "utak_quotation_pdf_v1",
};

export const S59_TEMPLATES = [TEAM_PRICES_READY, QUOTATION_PDF_V2];

/** The POST /message_templates components, without the document header's handle (uploaded at submission). */
export function templateComponents(t, headerHandle = null) {
  const components = [];
  if (t.documentHeader) components.push({ type: "HEADER", format: "DOCUMENT", example: { header_handle: [headerHandle] } });
  components.push({ type: "BODY", text: t.body, example: { body_text: [t.example] } });
  if (t.buttons.length) components.push({ type: "BUTTONS", buttons: t.buttons });
  return components;
}

/** What is wrong with a template's text (Meta's own rules for a body): empty = fine. */
export function textProblems(t) {
  const out = [];
  const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (vars.length !== t.params || vars.some((v, i) => v !== i + 1)) out.push(`variables ${JSON.stringify(vars)} ≠ 1…${t.params}`);
  if (t.example.length !== t.params) out.push(`examples ${t.example.length} ≠ ${t.params}`);
  if (/^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*$/.test(t.body)) out.push("a variable at the start or the end of the body");
  if ([...t.body].length > 1024) out.push("body over 1024 characters");
  if (/\n{3,}|\t| {4,}/.test(t.body)) out.push("tabs, 4+ spaces or 3+ newlines");
  for (const b of t.buttons) if ([...b.text].length > 25) out.push(`button «${b.text}» over 25 characters`);
  return out;
}
