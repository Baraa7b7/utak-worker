// § 66 و (2026-10-08) — the suppliers' check-in template, said again as a UTILITY message.
//
// utak_supplier_checkin_v1 («تحديث دوري للمورد المعتمد … بضاعة جاهزة أو شحنة جديدة …») was filed MARKETING by Meta
// after its approval, so the worker never uses it. v2 is worded as utak_price_ask_flow_v2 is (APPROVED, UTILITY):
// a request for an update of availability and price, for a named day, under the supply agreement — no «دوري», no
// offer, no greeting, no emoji. Its one variable is the DAY (v1's was the supplier's name).
// ONE submission. Filed MARKETING again, refused or pending → never used and never re-submitted.
export const CHECKIN_BUTTON = "عرض مورد";
export const SUPPLIER_CHECKIN_V2 = {
  name: "utak_supplier_checkin_v2",
  replaces: "utak_supplier_checkin_v1",
  purpose: "supplier_checkin",
  purposeLabel: "تواصل دوري مع مورد معتمد (للموردين)",
  label: "طلب تحديث التوفر والسعر من مورد معتمد — بزر «عرض مورد» (للموردين)",
  language: "ar",
  body: "طلب تحديث التوفر والأسعار ليوم {{1}} حسب اتفاق التوريد مع يو تاك. اضغط «عرض مورد» وأدخل الصنف والكمية المتوفرة وسعرها.",
  example: ["8 أكتوبر 2026"],
  params: 1,
  buttons: [{ type: "QUICK_REPLY", text: CHECKIN_BUTTON }],
  documentHeader: false,
};
export const S66_TEMPLATES = [SUPPLIER_CHECKIN_V2];
