import type { Env } from "./config";
import {
  createComplaint, findLatestOrderForCustomer,
  type ComplaintType, type ComplaintSeverity,
} from "./odoo-v6-append";
import { sendText } from "./meta";
import { sendOwnerAlert } from "./templates";

const COMPLAINT_KEYWORDS = [
  "ناقص","ناقصه","ناقصة","سيء","سيئه","سيئة","تأخر","تاخر","تأخرو","تأخرتوا",
  "خربان","خربانه","خربانة","رديء","رديئه","رديئة","زعلت","زعلان",
  "مو حلو","مو حلوه","مو زين","أسوأ","اسوأ","مقرف","خايس",
  "معفن","معفنه","تعفن","فاسد","فاسده","فاسدة","تالف","تالفه","تالفة",
  "مشكلة","مشكله","شكوى","شكوا","غاليه","غالي","سرقة","تعبني","محبطه","محبط",
  "ندمت","اعتذر منكم","سيئين","خذلتوني","خذلتونا","مو راضي","مو راضية"
];
export function looksLikeComplaint(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return COMPLAINT_KEYWORDS.some(k => t.includes(k));
}
export async function classifyComplaint(
  env: Env, text: string,
): Promise<{ type: ComplaintType; severity: ComplaintSeverity }> {
  const system = `أنت مصنّف شكاوى لشركة UTAK لتوزيع الخضار والفواكه بالجملة.
صنّف الشكوى إلى:
- type: quality | quantity | delay | staff_behavior | pricing | other
- severity: low | medium | high | critical
رد فقط بـ JSON صالح: {"type":"...","severity":"..."}`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL_CLASSIFY || "claude-haiku-4-5-20251001",
        max_tokens: 100, system,
        messages: [{ role: "user", content: text }],
      }),
    });
    const data = (await resp.json()) as any;
    const content = data?.content?.[0]?.text || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    const validTypes = ["quality","quantity","delay","staff_behavior","pricing","other"] as const;
    const validSev = ["low","medium","high","critical"] as const;
    const type: ComplaintType = validTypes.includes(parsed.type) ? parsed.type : "other";
    const severity: ComplaintSeverity = validSev.includes(parsed.severity) ? parsed.severity : "medium";
    return { type, severity };
  } catch { return { type: "other", severity: "medium" }; }
}
/**
 * § 57 هـ — a message Claude read as a complaint (no keyword above in it):
 * with an order delivered to him in the last seven days he gets the form
 * «عندي ملاحظة» (src/complaint-form.ts). This door never made a row and makes
 * none now: his words stay with the form and are written with its note when
 * he sends it. False — no such order, or a form that could not go: the caller
 * does what it did before.
 */
export async function answerComplaintWithForm(
  env: Env, customer: { id: number; name?: string }, from: string, text: string,
): Promise<boolean> {
  const { offerComplaintForm } = await import("./complaint-form");
  return (await offerComplaintForm(env, { partnerId: customer.id, name: customer.name || "", whatsapp: from }, { words: text })).sent;
}
/** § 57 هـ — the line Baraa's «شكوى جديدة» gains when the customer was sent the form. */
export const COMPLAINT_FORM_SENT_LINE = "📋 وصله نموذج «عندي ملاحظة»: حين يرسله تُكمَّل هذه الشكوى نفسها، ويصلك ملخصها بأزرار القرار.";
/**
 * A customer's complaint in words (a keyword above): the row from his words
 * and Baraa's «شكوى جديدة», as always.
 * § 57 هـ — `from` (his number): with an order delivered to him in the last
 * seven days the form «عندي ملاحظة» goes IN PLACE of the apology line, its
 * token holds this row, and its «إرسال» fills this same row; Baraa's alert
 * says the form was sent. No such order, a form already waiting for him, or
 * one that could not go: the apology line, exactly as before. A form that is
 * never sent back leaves the row and the alert as they are.
 */
export async function handleComplaint(
  env: Env, customerId: number, customerName: string, text: string, from?: string,
): Promise<string> {
  let made: { complaintId: number | null; type: ComplaintType; severity: ComplaintSeverity; orderId: number | null } | null = null;
  let failure: unknown = null;
  try {
    const [{ type, severity }, orderId] = await Promise.all([
      classifyComplaint(env, text),
      findLatestOrderForCustomer(env, customerId),
    ]);
    const complaintId = await createComplaint(env, {
      customerId, orderId: orderId || undefined, type, severity, text,
    });
    made = { complaintId, type, severity, orderId };
  } catch (e) {
    // the row could not be made: the form may still go, and its «إرسال» makes it then
    failure = e;
  }
  const { offerComplaintForm } = await import("./complaint-form");
  const formSent = (await offerComplaintForm(env, { partnerId: customerId, name: customerName, whatsapp: from ?? "" }, { words: text, complaintId: made?.complaintId ?? undefined })).sent;
  if (!made) {
    if (formSent) return "";
    throw failure;
  }
  const { complaintId, type, severity, orderId } = made;
  const owner = env.OWNER_WHATSAPP;
  if (owner) {
    const emoji = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" }[severity];
    const typeArabic = {
      quality: "جودة", quantity: "كمية", delay: "تأخير",
      staff_behavior: "سلوك موظف", pricing: "سعر", other: "أخرى"
    }[type];
    const notif = `${emoji} شكوى جديدة #${complaintId}
عميل: ${customerName}
النوع: ${typeArabic}
الرسالة: "${text.slice(0, 200)}"
${orderId ? `طلب مرتبط: #${orderId}` : ""}`;
    try { await sendOwnerAlert(env, formSent ? `${notif.trimEnd()}\n${COMPLAINT_FORM_SENT_LINE}` : notif); }
    catch (e) { console.error("[complaint] notify failed:", (e as Error).message); }
  }
  return formSent ? "" : "نعتذر عن الإزعاج 🙏 وصلنا ملاحظتك وسنتواصل معك خلال ساعة لحل المشكلة.";
}
