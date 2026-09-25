// عقد الأغراض: عدد المتغيرات التي يرسلها الكود لكل غرض (T.* و TMPL_*)، ومرجع الاستدعاء.
// null = لا يوجد مستدعٍ في الكود. يُستخدم في سكربت الترحيل والتحقق.
// byTemplate (2026-09-25): غرض ينتقل بين قالبين بعدد متغيرات مختلف — الكود يرسل حسب اسم القالب.
export const CONTRACT = {
  supplier_ask:               { params: 2, where: "src/suppliers.ts:143 (supplierAskParams)", used: true,
                                byTemplate: { utak_supplier_daily_ask: 1 } },
  supplier_confirm:           { params: 2, where: "src/suppliers.ts:300", used: true },
  // 2026-09-25 (م5) — utak_supplier_price_nudge (#48): [supplier name, «6:00 صباحاً»].
  supplier_price_nudge:       { params: 2, where: "src/suppliers.ts:538 (nudgeLateSuppliers)", used: true },
  purchase_list:              { params: 4, where: "src/team.ts:91", used: true },
  loading_done:               { params: null, where: "—", used: false },
  driver_dispatch:            { params: 4, where: "src/team.ts:198", used: true },
  driver_stop:                { params: 5, where: "src/team.ts:262", used: true },
  driver_collection:          { params: null, where: "—", used: false },
  collection_request:         { params: 4, where: "src/invoice.ts:247", used: true },
  collection_summary:         { params: 4, where: "src/invoice.ts:630", used: true },
  commission:                 { params: null, where: "—", used: false },
  owner_summary:              { params: null, where: "—", used: false },
  // STATUS § 34 — sendOwnerAlert has no template option any more (text, held outside his window).
  owner_alert:                { params: 1, where: "src/templates.ts (sendOwnerAlert — no template since § 34)", used: false,
                                byTemplate: { utak_owner_alert_v3: 2 } },
  team_shift_start:           { params: 1, where: "src/team.ts:410", used: true },
  customer_welcome:           { params: 2, where: "src/index.ts:1988 (welcomeParams)", used: true },
  customer_daily_remind:      { params: 1, where: "src/standing.ts:27", used: true },
  customer_order_confirm:     { params: null, where: "—", used: false },
  customer_delivery_incoming: { params: null, where: "—", used: false },
  customer_delivery_done:     { params: 1, where: "src/team.ts:317", used: true },
  customer_invoice:           { params: 4, where: "src/invoice.ts:312", used: true },
  customer_invoice_pdf:       { params: 4, where: "src/invoice.ts:298", used: true },
  customer_quotation_pdf:     { params: 4, where: "src/quotation.ts:590 (quotationTemplateParams)", used: true },
  customer_pay_remind:        { params: 2, where: "src/outreach.ts:191", used: true },
  customer_inactive:          { params: 1, where: "src/outreach.ts:113", used: true },
  customer_feedback:          { params: 1, where: "src/outreach.ts:48", used: true },
  // 2026-09-24 (ح3) — utak_order_update (#64): 20:00 reminder + 21:00 cancel notice outside the 24h window.
  customer_order_update:      { params: 2, where: "src/team.ts notifyOrderCustomer", used: true },
  // 2026-09-25 — utak_order_confirm_remind_v1 (ح3) and utak_purchase_list_remind_v1 (ح7); until the
  // purpose is mapped the code falls back to customer_order_update / purchase_list.
  customer_order_remind:      { params: 2, where: "src/team.ts:79 (notifyOrderCustomer remind)", used: true },
  purchase_list_remind:       { params: 2, where: "src/team.ts:335 (sendPurchaseListReminder, purchaseRemindParams)", used: true,
                                byTemplate: { utak_purchase_list_remind_v2: 3 } },
  // 2026-09-25 (STATUS § 34) — utak_payment_received (#56): [amount, invoice number], the
  // receipt outside the customer's window; and «فتح المحادثة» per category (#82–#85):
  // [account number or date, the update in two or three words] + «عرض التحديث».
  customer_payment_received:  { params: 2, where: "src/receipt.ts (sendReceiptToCustomer)", used: true },
  // the collector's / driver's note to Baraa: text only (held outside his window), no template
  owner_team_note:            { params: null, where: "src/team-note.ts (recordTeamNote, text only)", used: false },
  conv_open_customer:         { params: 2, where: "src/wa-opener.ts (openerParams)", used: true },
  conv_open_team:             { params: 2, where: "src/wa-opener.ts (openerParams)", used: true },
  conv_open_supplier:         { params: 2, where: "src/wa-opener.ts (openerParams)", used: true },
  conv_open_owner:            { params: 2, where: "src/wa-opener.ts (openerParams, attendance.ts 06:00 backup)", used: true },
};

/** Variables the code sends for `purpose` when it resolves to `templateName`. */
export function contractParams(purpose, templateName) {
  const c = CONTRACT[purpose];
  if (!c) return null;
  return c.byTemplate?.[templateName] ?? c.params;
}
