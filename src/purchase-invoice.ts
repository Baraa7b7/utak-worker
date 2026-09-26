// § 41 هـ (2026-09-26) — the purchase tax invoice («فاتورة الشراء الضريبية»).
//
// Every purchase source is VAT-registered and invoices with a tax invoice, so
// the purchase VAT is recovered (§ 41 أ) — on the strength of that paper:
//   • right after «تم الشراء» (purchase_done), the member who tapped it (Omar,
//     the warehouse) gets one line inside his window — he just tapped, it is
//     open: «📸 أرسل صورة فاتورة الشراء الضريبية»;
//   • any image or document he sends within 60 minutes of the tap is attached
//     to that purchase list (x_purchase_list.x_tax_invoice + its file name and
//     x_tax_invoice_at; a second file in the same hour goes to the list as an
//     ir.attachment, nothing is overwritten), and he gets «وصلت الفاتورة ✅»;
//   • a confirmed purchase list still without it at 12:00 (Riyadh) → one line
//     to Baraa that day, naming the list(s).
// The field is also on the supplier payment (x_supplier_payment, filled by
// hand in Odoo). A simulation list (x_utak_simulation) is never chased.

import type { Env } from "./config";
import { call } from "./odoo";
import { claimButton, finishButton } from "./button-lock";
import { riyadhDateKey, riyadhDayMinuteMs, riyadhMinutes, toOdooUtc } from "./hours";
import { arabicDate } from "./wa-params";

export const PINV_WINDOW_MIN = 60;
/** 12:00 Riyadh: the day's check for a confirmed list without its purchase tax invoice. */
export const PINV_ALERT_MINUTE = 12 * 60;
export const PINV_ASK_TEXT = "📸 أرسل صورة فاتورة الشراء الضريبية";
export const PINV_ACK_TEXT = "وصلت الفاتورة ✅";
export const PINV_RETRY_TEXT = "ما وصلت الصورة كاملة، أرسلها مرة ثانية لو سمحت 🙏";
/** The every-5-minutes job that sends the 12:00 line (its own auto-send key, § 40). */
export const PINV_JOB = "purchase_invoice_check";
const MIN = 60_000;
const DAY_MS = 24 * 60 * MIN;
const SIM_FIELD = "x_utak_simulation";
const pendKey = (partnerId: number) => `pinv:v1:${partnerId}`;

interface Pending { listId: number; at: number }

/** «تم الشراء» was tapped by `partnerId` for `listId` at `nowMs`: his next 60 minutes of images / documents go to the list. */
export async function openPurchaseInvoiceWindow(env: Env, partnerId: number, listId: number, nowMs: number = Date.now()): Promise<void> {
  try {
    await env.MSG_DEDUP.put(pendKey(partnerId), JSON.stringify({ listId, at: nowMs } satisfies Pending), { expirationTtl: (PINV_WINDOW_MIN + 5) * 60 });
  } catch (e) {
    console.warn(`[pinv] window for list ${listId} not stored`, (e as Error)?.message);
  }
}

async function readPending(env: Env, partnerId: number): Promise<Pending | null> {
  try {
    const raw = await env.MSG_DEDUP.get(pendKey(partnerId));
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch { return null; }
}

/**
 * An image / document from a team member: the purchase tax invoice when it
 * arrives within 60 minutes of his «تم الشراء». Null = not one (the old
 * behaviour for team media stands).
 */
export async function handlePurchaseInvoiceMedia(
  env: Env,
  partnerId: number,
  media: { id: string; mime_type?: string; filename?: string },
  nowMs: number = Date.now(),
): Promise<string | null> {
  const p = await readPending(env, partnerId);
  if (!p) return null;
  if (nowMs - p.at > PINV_WINDOW_MIN * MIN) {
    console.log(`[pinv] partner ${partnerId}: media ${Math.round((nowMs - p.at) / MIN)} min after «تم الشراء» (list ${p.listId}) — not attached`);
    return null;
  }
  const { downloadMedia } = await import("./supplier-pay");
  const file = await downloadMedia(env, media.id);
  if (!file) return PINV_RETRY_TEXT;
  const ext = /pdf/.test(file.mime) ? "pdf" : /png/.test(file.mime) ? "png" : "jpg";
  const [list] = await call<Array<{ id: number; x_date: string | false; x_tax_invoice_filename: string | false; x_tax_invoice_at: string | false }>>(env, "x_purchase_list", "read", {
    ids: [p.listId], fields: ["id", "x_date", "x_tax_invoice_filename", "x_tax_invoice_at"],
  });
  if (!list) return null;
  const filename = media.filename || `فاتورة-شراء-${list.x_date || riyadhDateKey(new Date(nowMs))}-${p.listId}.${ext}`;
  if (!list.x_tax_invoice_filename && !list.x_tax_invoice_at) {
    await call(env, "x_purchase_list", "write", {
      ids: [p.listId], vals: { x_tax_invoice: file.base64, x_tax_invoice_filename: filename, x_tax_invoice_at: toOdooUtc(nowMs) },
    });
  } else {
    // a second page / file in the same hour: kept on the list, never overwriting the first
    await call<number[]>(env, "ir.attachment", "create", {
      vals_list: [{ name: filename, raw: file.base64, mimetype: file.mime, res_model: "x_purchase_list", res_id: p.listId }],
    });
  }
  console.log(`[pinv] list ${p.listId}: purchase tax invoice from partner ${partnerId} (${filename})`);
  return PINV_ACK_TEXT;
}

export const pinvAlertText = (lists: Array<{ id: number; date: string }>): string =>
  `⚠️ ${lists.length === 1 ? "قائمة الشراء" : "قوائم الشراء"} ${lists.map((l) => `#${l.id} (${arabicDate(l.date)})`).join("، ")} مؤكدة بلا فاتورة شراء ضريبية مرفقة حتى 12:00. اطلبها من المستودع أو أرفقها في UTAK ← 🛒 المشتريات ← قوائم الشراء.`;

/**
 * From 12:00 Riyadh, once a day: the purchase lists confirmed («تم الشراء»)
 * in the 24 hours before today's 12:00, not simulation, still without their
 * purchase tax invoice → one line to Baraa naming them. None → nothing.
 */
export async function checkPurchaseInvoices(env: Env, nowMs: number = Date.now()): Promise<{ action: string; lists?: number[] }> {
  const day = riyadhDateKey(new Date(nowMs));
  if (riyadhMinutes(new Date(nowMs)) < PINV_ALERT_MINUTE) return { action: "before" };
  const doneKey = `pinv_checked:v1:${day}`;
  try { if (await env.MSG_DEDUP.get(doneKey)) return { action: "checked" }; } catch { /* read Odoo */ }
  const noon = riyadhDayMinuteMs(day, PINV_ALERT_MINUTE);
  const lists = await call<Array<{ id: number; x_date: string | false }>>(env, "x_purchase_list", "search_read", {
    domain: [
      ["x_status", "=", "done"],
      ["x_ahmad_confirmed_at", ">=", toOdooUtc(noon - DAY_MS)],
      ["x_ahmad_confirmed_at", "<", toOdooUtc(noon)],
      [SIM_FIELD, "!=", true],
      ["x_tax_invoice_filename", "=", false],
      ["x_tax_invoice_at", "=", false],
    ],
    fields: ["id", "x_date"], order: "id asc", limit: 20,
  });
  const markDone = async () => { try { await env.MSG_DEDUP.put(doneKey, "1", { expirationTtl: 26 * 3600 }); } catch { /* the claim holds */ } };
  if (!lists.length) { await markDone(); return { action: "none" }; }
  const claim = await claimButton(env, `pinv_alert:${day}`, 26 * 3600);
  if (!claim.claimed) return { action: "alerted_before" };
  const { sendOwnerAlert } = await import("./templates");
  await sendOwnerAlert(env, pinvAlertText(lists.map((l) => ({ id: l.id, date: String(l.x_date || day) }))));
  await finishButton(env, claim, 26 * 3600);
  await markDone();
  return { action: "alerted", lists: lists.map((l) => l.id) };
}
