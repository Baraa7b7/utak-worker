// Backfill plan for «مراجعة الأرقام» (2026-09-25, STATUS § 30) — pure, no I/O.
// Used by scripts/rev-20260925-backfill.mjs and tests/review.test.mts.
//
// Only a partner created automatically from WhatsApp is classified: active,
// customer_rank > 0, with a number and a WhatsApp conversation (x_wa_message
// or x_message_analysis). Known partners are never touched: Baraa's number,
// the team (the Work Contact of an hr.employee with «أدوار UTAK» — STATUS
// § 31), a supplier, or any order on the number (x_daily_order
// or sale.order, on any partner with that number, archived included). A
// partner that already has a class is left as it is. Every classified partner
// needs an explicit decision (intent + reason) read from its conversation.

export const NON_CUSTOMER = new Set(["wrong_number", "vendor_pitch", "personal", "spam"]);
export const INTENTS = new Set(["purchase", "wrong_number", "vendor_pitch", "personal", "spam", "unclear"]);
export const digits = (s) => String(s ?? "").replace(/\D/g, "");
export const maskNumber = (s) => {
  const d = digits(s);
  return d ? `${"•".repeat(Math.max(0, d.length - 4))}${d.slice(-4)}` : "-";
};

/**
 * @param {object} a
 * @param {Array<{id:number,name:string,active:boolean,phone?:string|false,x_whatsapp_number?:string|false,customer_rank:number,supplier_rank:number,x_contact_class?:string|false}>} a.partners
 * @param {Set<number>} a.teamPartnerIds         Work Contacts of the hr.employee with «أدوار UTAK»
 * @param {Set<string>} a.orderNumbers           digits of every number that has an order
 * @param {Map<number, Array<{body:string, at:string}>>} a.history  inbound texts per partner, oldest first
 * @param {string} a.ownerNumber
 * @param {Record<number, {intent:string, reason:string}>} a.decisions
 */
export function planBackfill({ partners, teamPartnerIds, orderNumbers, history, ownerNumber, decisions }) {
  const owner = digits(ownerNumber);
  const rows = [];
  for (const p of partners) {
    const num = digits(p.x_whatsapp_number || p.phone);
    const base = { id: p.id, name: p.name, number: maskNumber(num) };
    if (!p.active) { rows.push({ ...base, skip: "مؤرشف" }); continue; }
    if (!num) { rows.push({ ...base, skip: "بلا رقم" }); continue; }
    if (owner && num === owner) { rows.push({ ...base, skip: "معروف: رقم براء" }); continue; }
    if (teamPartnerIds.has(p.id)) { rows.push({ ...base, skip: "معروف: فريق (موظف له دور)" }); continue; }
    if ((p.supplier_rank ?? 0) > 0) { rows.push({ ...base, skip: "معروف: مورد" }); continue; }
    if (orderNumbers.has(num)) { rows.push({ ...base, skip: "معروف: له طلب على الرقم" }); continue; }
    if ((p.customer_rank ?? 0) <= 0) { rows.push({ ...base, skip: "لم يُنشأ من واتساب (ليس عميلاً)" }); continue; }
    const msgs = history.get(p.id) ?? [];
    if (!msgs.length) { rows.push({ ...base, skip: "لم يُنشأ من واتساب (لا محادثة)" }); continue; }
    if (p.x_contact_class) { rows.push({ ...base, skip: `مصنّف مسبقاً (${p.x_contact_class})` }); continue; }
    const d = decisions[p.id];
    if (!d || !INTENTS.has(d.intent) || !String(d.reason ?? "").trim()) {
      throw new Error(`partner ${p.id} «${p.name}» needs an explicit decision (intent + reason) from its conversation`);
    }
    const last = msgs[msgs.length - 1];
    rows.push({
      ...base,
      intent: d.intent,
      reason: d.reason,
      pending: d.intent !== "purchase",
      first: msgs[0].body,
      vals: {
        x_contact_class: "unreviewed",
        x_ai_intent: d.intent,
        x_ai_reason: d.reason,
        x_review_pending: d.intent !== "purchase",
        x_review_last_msg: String(last.body).replace(/\s+/g, " ").trim().slice(0, 200),
        x_review_last_at: last.at,
      },
    });
  }
  return rows;
}
