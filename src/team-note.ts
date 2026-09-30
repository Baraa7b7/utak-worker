// The collector's and the driver's notes to Baraa — 2026-09-25 (STATUS § 34).
//
// A note Omar records on a delivery («فيه مشكلة ⚠️» on a stop, then his text)
// or on a collection («ملاحظة 📝» on the collection request or after a
// collection, then his text) reaches Baraa as a critical («مهمة») message,
// purpose owner_team_note, with the customer's name and the order: inside his
// window as text; outside it held, with utak_update_owner once that day
// (src/wa-opener.ts). The note is kept in Odoo too: on the delivery stop
// (x_issue_note, as before) or on the invoice's latest payment (x_notes).
// Notes addressed to the customer are not part of this.

import type { Env } from "./config";
import { call, getOrderCustomer, markStopIssue } from "./odoo";
import { sendOwnerMessage, T } from "./templates";
import { riyadhHHMM } from "./hours";

/** The collection note button: `collect_note_<x_invoice id>`. */
export const COLLECT_NOTE_RE = /^collect_note_(\d+)$/;
export const COLLECT_NOTE_BUTTON_TITLE = "ملاحظة 📝";
export function collectNoteButton(invoiceId: number): { id: string; title: string } {
  return { id: `collect_note_${invoiceId}`, title: COLLECT_NOTE_BUTTON_TITLE };
}
/** KV: the collector's next text is the note for this invoice. */
export function pendingCollectNoteKey(partnerId: number): string {
  return `pending_collect_note:${partnerId}`;
}
export const PENDING_NOTE_TTL = 3 * 60 * 60;
export const COLLECT_NOTE_PROMPT = "تمام، اكتب ملاحظتك على هذا التحصيل في رسالة واحدة، وتوصل لبراء مع اسم العميل ورقم الطلب.";
export const TEAM_NOTE_ACK = "وصلت ملاحظتك لبراء ✅ مع اسم العميل ورقم الطلب.";

export interface TeamNote {
  kind: "delivery" | "collection";
  memberName: string;
  text: string;
  /** delivery: the order of the stop */
  orderId?: number;
  /** collection: the x_invoice */
  invoiceId?: number;
}

export interface TeamNoteResult {
  /** What Baraa receives. */
  message: string;
  customerName: string;
  orderId: number | null;
  /** Where the note was written in Odoo. */
  savedOn: string | null;
}

/** Record the note in Odoo and send it to Baraa. Never throws on the send. */
export async function recordTeamNote(env: Env, note: TeamNote): Promise<TeamNoteResult> {
  const text = String(note.text ?? "").trim();
  let customerName = "-";
  let orderId: number | null = note.orderId ?? null;
  let savedOn: string | null = null;
  let invoiceNumber = "";

  if (note.kind === "delivery" && orderId) {
    try {
      await markStopIssue(env, orderId, text);
      savedOn = "x_delivery_stop.x_issue_note";
    } catch (e) {
      console.warn("[team-note] stop issue write failed", (e as Error)?.message);
    }
  }
  if (note.kind === "collection" && note.invoiceId) {
    try {
      const [inv] = await call<Array<{ id: number; x_invoice_number: string | false; x_order_id: [number, string] | false }>>(
        env, "x_invoice", "read", { ids: [note.invoiceId], fields: ["id", "x_invoice_number", "x_order_id"] });
      invoiceNumber = typeof inv?.x_invoice_number === "string" ? inv.x_invoice_number : `#${note.invoiceId}`;
      if (Array.isArray(inv?.x_order_id)) orderId = inv.x_order_id[0];
    } catch (e) {
      console.warn("[team-note] invoice read failed", (e as Error)?.message);
    }
    try {
      const [pay] = await call<Array<{ id: number; x_notes: string | false }>>(env, "x_payment", "search_read", {
        domain: [["x_invoice_id", "=", note.invoiceId]], fields: ["id", "x_notes"], order: "id desc", limit: 1,
      });
      if (pay) {
        const line = `[${riyadhHHMM(new Date())} ${note.memberName}] ${text}`;
        const next = (typeof pay.x_notes === "string" && pay.x_notes ? `${pay.x_notes}\n` : "") + line;
        await call(env, "x_payment", "write", { ids: [pay.id], vals: { x_notes: next.slice(-4000) } });
        savedOn = `x_payment #${pay.id}.x_notes`;
      }
    } catch (e) {
      console.warn("[team-note] payment note write failed", (e as Error)?.message);
    }
  }
  if (orderId) {
    try {
      customerName = (await getOrderCustomer(env, orderId))?.name || "-";
    } catch (e) {
      console.warn("[team-note] customer read failed", (e as Error)?.message);
    }
  }

  const head = note.kind === "delivery" ? `⚠️ ملاحظة توصيل من ${note.memberName}` : `📝 ملاحظة تحصيل من ${note.memberName}`;
  const ref = note.kind === "collection"
    ? `الطلب: ${orderId ? `#${orderId}` : "-"} · الفاتورة: ${invoiceNumber || "-"}`
    : `الطلب: ${orderId ? `#${orderId}` : "-"}`;
  const tail = note.kind === "collection" ? (savedOn ? `سُجّلت على الدفعة في Odoo.` : `لا دفعة مسجّلة لهذه الفاتورة بعد.`) : "";
  const message = [head, `العميل: ${customerName}`, ref, `الملاحظة: ${text}`, tail].filter(Boolean).join("\n");
  await sendOwnerMessage(env, message, T.OWNER_TEAM_NOTE);
  console.log(`[team-note] ${note.kind} from ${note.memberName} order=${orderId ?? "-"} saved=${savedOn ?? "-"}`);
  return { message, customerName, orderId, savedOn };
}
