import type { Env } from "./config";
import {
  createComplaint, findLatestOrderForCustomer,
  type ComplaintType, type ComplaintSeverity,
} from "./odoo-v6-append";
import { sendText } from "./meta";

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
export async function handleComplaint(
  env: Env, customerId: number, customerName: string, text: string,
): Promise<string> {
  const [{ type, severity }, orderId] = await Promise.all([
    classifyComplaint(env, text),
    findLatestOrderForCustomer(env, customerId),
  ]);
  const complaintId = await createComplaint(env, {
    customerId, orderId: orderId || undefined, type, severity, text,
  });
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
    try { await sendText(env, owner, notif); }
    catch (e) { console.error("[complaint] notify failed:", (e as Error).message); }
  }
  return "نعتذر عن الإزعاج 🙏 وصلنا ملاحظتك وسنتواصل معك خلال ساعة لحل المشكلة.";
}
