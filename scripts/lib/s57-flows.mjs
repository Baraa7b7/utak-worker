// § 57 ح (2026-10-05) — the four WhatsApp Flows of § 57, in one list for scripts/s57-20261005-flows.mjs
// (which creates and publishes them at Meta) and for the tests that hold every text of every Flow
// against Meta's limits. Each Flow's JSON is built in its own file, next to the labels and ids its
// worker module shares:
//
//   transfer   utak_transfer_v1            the customer's «إشعار تحويل»            scripts/lib/s57-transfer-flow.mjs   src/transfer-form.ts
//   complaint  utak_complaint_v1           the customer's «⚠️ عندي ملاحظة»         scripts/lib/s57-complaint-flow.mjs  src/complaint-form.ts
//   expense    utak_expense_v1             Baraa's «🧾 تسجيل مصروف»                scripts/lib/s57-expense-flow.mjs    src/expense-form.ts
//   supplier   utak_supplier_register_v1   the supplier's registration             scripts/lib/s57-supplier-flow.mjs   src/supplier-vat.ts
//
// None has an endpoint (flow_action navigate, the initial values with the message), and no template is
// made for any of them: each goes inside its recipient's 24h window only.
import { FLOW as TRANSFER } from "./s57-transfer-flow.mjs";
import { FLOW as COMPLAINT } from "./s57-complaint-flow.mjs";
import { FLOW as EXPENSE } from "./s57-expense-flow.mjs";
import { FLOW as SUPPLIER } from "./s57-supplier-flow.mjs";

export const FLOW_CATEGORIES = ["OTHER"];
export const FLOWS = [TRANSFER, COMPLAINT, EXPENSE, SUPPLIER];
