// § 61 د 1 (2026-10-06) — the one template of this order, as data.
//
// Pure: no network, no worker import. scripts/s61-20261006-templates.mjs submits it to Meta (ONCE),
// scripts/s61-20261006-odoo.mjs writes its row and purpose, tests/s61-*.test.mts check it against what
// the worker sends (the name, the purpose, the variables).
//
// ONE submission, UTILITY. Approved UTILITY → the worker uses it outside the new employee's window (the
// gateway sends a template only APPROVED and UTILITY). Filed MARKETING, refused or still pending →
// never used: Baraa gets the welcome's text to send himself. Never re-submitted.

/** [د 1] — the welcome of an employee who was given a job, outside his 24h window. */
export const TEAM_WELCOME = {
  name: "utak_team_welcome_v1",
  purpose: "team_welcome",
  purposeLabel: "ترحيب موظف جديد (للفريق)",
  label: "ترحيب موظف جديد — وظيفته وأول مهمة (للفريق)",
  language: "ar",
  // the order's text, letter for letter, and one closing sentence after the last variable (Meta refuses a
  // body that ends with a variable; the sentence is the worker's own promise: the tasks reach this chat)
  body: "مرحباً {{1}}، تم تسجيلك في فريق يو تاك بوظيفة {{2}}. أول مهمة تصلك {{3}}. مهامك وتحديثاتها تصلك في هذه المحادثة.",
  example: ["سالم", "سائق توصيل", "مع بداية دوامك يوم السبت الساعة 02:00"],
  params: 3,
  buttons: [],
  documentHeader: false,
};

export const S61_TEMPLATES = [TEAM_WELCOME];
