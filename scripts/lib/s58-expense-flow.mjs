// § 58 أ 4 (2026-10-05) — the owner's «تسجيل مصروف» form, its second version: utak_expense_v2.
//
// Baraa's decision on § 57: «رواتب وأجور» leaves the list of types — the salaries are recorded by their
// monthly entry (docs/EXPENSES.md § 4), and a salary typed here as well would be in the books twice.
// A published Flow's JSON is frozen (utak_expense_v1 #1084220070882916 keeps its eight types at Meta),
// so the list without it is a NEW Flow, and the worker sends this one (src/expense-form.ts
// EXPENSE_FLOW_ID). A reply of the old Flow that still names «salaries» is refused whole by the worker
// (src/expense-form.ts readExpenseValues), as any field it cannot read.
//
// Everything else IS utak_expense_v1 — scripts/lib/s57-expense-flow.mjs stays the record of what was
// published as v1, and this file builds v2 from it: the same screen (EXPENSE_A), the same data keys
// (t, n, pay, d), the same fields in the same order, the same labels, hints and payload; only the
// Flow's name and the choices of «نوع المصروف» differ. Pure: no network, no worker import.
import * as V1 from "./s57-expense-flow.mjs";

export * from "./s57-expense-flow.mjs";

export const EXPENSE_FLOW_NAME = "utak_expense_v2";
/** The type that left the list: the worker reads it from no Flow any more. */
export const REMOVED_TYPE = "salaries";
/** The seven types of v2, in v1's order: the id is what the worker reads. */
export const EXPENSE_TYPES = V1.EXPENSE_TYPES.filter((t) => t.id !== REMOVED_TYPE);

/** utak_expense_v1's JSON with the seven types in «نوع المصروف», and nothing else changed. */
export function buildExpenseFlowJson() {
  const flow = V1.buildExpenseFlowJson();
  const type = flow.screens[0].layout.children.find((c) => c.type === "Dropdown" && c.name === "type");
  if (!type) throw new Error("utak_expense_v2: the screen of v1 has no «نوع المصروف» list — stop");
  type["data-source"] = EXPENSE_TYPES;
  return flow;
}

/** The Flow of § 58 أ 4, as the Meta script walks it (the shape of scripts/lib/s55-flows.mjs FLOWS). */
export const FLOW = { key: "expense", name: EXPENSE_FLOW_NAME, build: buildExpenseFlowJson, first: V1.EXPENSE_SCREEN };

export const FLOW_CATEGORIES = ["OTHER"];
export const FLOWS = [FLOW];
