// § 59 أ (2026-10-06) — Baraa as a member of the team.
//
// Omar went to marketing, and until a driver is added every operating task is
// Baraa's: he holds «سائق», «شراء» and «محصّل» in «الموظفون» (hr.employee, his own
// partner as the Work Contact), and the tasks follow the roles to him through
// the team's own paths — the purchase list and «📥 استلام المشتريات», the route
// and «📦 سلّم وحصّل», the collection requests and the 18:00 list, «حمولة» and
// «عهدة», the end-of-shift reminders. Nothing is copied for him. Two things make
// that possible, and both follow the roles in Odoo (give the roles back to a
// driver and they are off again, with no deploy):
//
//   • the gateway's owner guard (src/wa-gateway.ts) lets the TEAM's purposes
//     below reach his number while — and only while — he holds a team role;
//     every other purpose stays refused for him as before, and the owner's own
//     purposes still reach no other number;
//   • a message of his is a member's (the team branch of the webhook) unless it
//     is one of his own — the price review's buttons, «✅ وصل» / «❌ ما وصل», a
//     complaint's decision, his expense, a delivery from the car — which are
//     answered where they always were.
//
// What stays his alone is in src/attendance.ts (§ 59 أ): one «بدء الدوام» a day,
// no attendance row, no reminder, no «غائب», no hold.

import type { Env } from "./config";
import type { NormalizedMessage } from "./types";
import { EXPENSE_BUTTON, EXPENSE_UNDO_PAYLOAD, expenseCommand } from "./expense-form";
import { deliverCommandOrderId } from "./order-flow";
import { isOwnerWindowPayload } from "./owner-window";

/**
 * The purposes of the team's tasks and of the answers to a member's own taps:
 * they reach Baraa's number while he holds a team role. «بدء الدوام» is not
 * here: his goes once a day under `owner_window`, never as a member's.
 */
export const OWNER_TEAM_PURPOSES: ReadonlySet<string> = new Set([
  // the buyer
  "purchase_list", "purchase_list_remind", "loading_done", "purchase_receipt_form",
  // the driver
  "driver_dispatch", "driver_stop", "driver_stop_location", "driver_delivery_note", "driver_collection", "driver_stops_left",
  "delivery_form", "car_load_form",
  // the collector
  "collection_request", "collection_amount_remind", "collection_summary", "collection_nothing", "pay_claim_notice", "custody_form",
  // any member
  "team_task", "shift_ack", "team_sp_decision", "commission", "bot_reply",
]);

/** Baraa holds a team role now (the roster, ≤ 5 minutes old). An unreadable roster reads as «no»: the guard stays shut. */
export async function ownerOnTeam(env: Env, nowMs: number = Date.now()): Promise<boolean> {
  try {
    const { loadRoster } = await import("./team-roster");
    const { ownerMember } = await import("./attendance");
    return !!ownerMember(env, await loadRoster(env, nowMs));
  } catch (e) {
    console.warn("[owner-team] the roster could not be read — a team purpose stays refused for the owner", (e as Error)?.message);
    return false;
  }
}

/** May this purpose reach Baraa's number as a member's? (The owner's own purposes are the gateway's list.) */
export async function teamPurposeForOwner(env: Env, purpose: string): Promise<boolean> {
  return OWNER_TEAM_PURPOSES.has(purpose) && (await ownerOnTeam(env));
}

/**
 * Is this message of Baraa's one of HIS OWN — answered by the owner's branch of
 * the webhook, whatever role he holds? Its buttons and commands, in that
 * branch's order. «بدء الدوام» is not: as a member, his tap also releases his tasks.
 */
/** § 67 و — «🔁 أعد طلب الأسعار» of the day's «مصدر لم يرسل» alert: rsk_<the day>. */
export const REASK_PAYLOAD = /^rsk_(\d{4}-\d{2}-\d{2})$/;

export function isOwnerOwnMessage(msg: Pick<NormalizedMessage, "type" | "text" | "buttonId">): boolean {
  const button = (msg.type === "interactive" || msg.type === "button") && msg.buttonId ? String(msg.buttonId) : "";
  if (button) {
    return isOwnerWindowPayload(button)                    // «تم الاطلاع» / «عرض الاستثناءات»
      || REASK_PAYLOAD.test(button)                         // § 67 و — «🔁 أعد طلب الأسعار» under the 04:30 alert
      || /^prvt?_[arn]_\d+_\d+$/.test(button)               // the day's price review
      || /^pexc_[mspe]_\d+$/.test(button)                   // a per-item exception of before § 54
      || /^aftest_(transfer|note)$/.test(button)            // the trial of the two buttons after an invoice
      || /^trn_(ok|no)_/.test(button)                       // «✅ وصل» / «❌ ما وصل»
      || /^cmp_(comp|credit|reject)_/.test(button)          // a complaint's decision
      || /^dlv_\d+$/.test(button)                           // «📦 سلّم وحصّل» (his own form)
      || /^delivered_\d+$/.test(button)                     // «تم التسليم ✅» from the car
      || button === EXPENSE_BUTTON || EXPENSE_UNDO_PAYLOAD.test(button);
  }
  if (msg.type !== "text") return false;
  const text = String(msg.text ?? "");
  return deliverCommandOrderId(text) !== null || expenseCommand(text);
}
