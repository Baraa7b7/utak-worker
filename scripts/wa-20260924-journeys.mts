// محاكاة رحلتي العميل والمستودع بعد إصلاح الثغرات الحرجة (2026-09-24).
// تعمل بالكامل داخل العملية: Odoo وهمي، وGraph ملتقط، وساعة الرياض ثابتة.
// لا شبكة، ولا واتساب، ولا كتابة في Odoo الحقيقي.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/wa-20260924-journeys.mts
//
// المخرج: scripts/artifacts/wa-20260924-journeys.md (نص كل رسالة خرجت، بالترتيب).
import { writeFileSync } from "node:fs";
import {
  CUST, CUST2, WH, ctx, graph, inbound, order, partnerOf, quiet, reset, rows, seed,
  setClaude, setRiyadh, signed, table,
} from "../tests/wa-harness.mts";

const { dispatch } = await import("../src/router.ts");
const team = await import("../src/team.ts");
const worker = (await import("../src/index.ts")).default;
const { kvLastInboundTs } = await import("../src/wa-inbox.ts");

const WHO: Record<string, string> = {
  "966500000001": "المالك", "966500000501": "العميل (مطعم الوادي)", "966500000502": "العميل 2 (بقالة النخيل)",
  "966500000601": "المستودع (أحمد)",
};
const out: string[] = [];
let seen = 0;
let clock = "";
function step(title: string): void { out.push(`\n### ${clock} — ${title}\n`); }
function flush(): void {
  for (; seen < graph.length; seen++) {
    const b = graph[seen];
    const who = WHO[b.to] ?? b.to;
    let text = "";
    if (b.type === "template") {
      const ps = (b.template.components ?? []).flatMap((c: any) => c.parameters ?? [])
        .map((p: any) => p.text ?? `payload=${p.payload}`);
      text = `قالب \`${b.template.name}\` — ${ps.map((p: string) => `«${p}»`).join("، ")}`;
    } else if (b.type === "interactive") {
      text = `${b.interactive.body.text.replace(/\n/g, " ⏎ ")} [أزرار: ${b.interactive.action.buttons.map((x: any) => `${x.reply.title} (${x.reply.id})`).join(" | ")}]`;
    } else if (b.type === "text") text = b.text.body.replace(/\n/g, " ⏎ ");
    else text = `[${b.type}]`;
    out.push(`- → **${who}**: ${text}`);
  }
}
const at = (t: string) => { clock = t; setRiyadh(t); };
const tap = (env: any, id: string, who: number) => quiet(() => dispatch(env, {
  msg: { messageId: `w${Math.random()}`, from: "+x", fromRaw: "x", profileName: "", text: "", timestamp: "", type: "button", buttonId: id } as any,
  intent: "other", senderType: "customer", partner: partnerOf(who),
}));
async function reply(env: any, to: string, r: any): Promise<void> {
  // what index.ts sendReply would send for a router reply
  const { sendButtons, sendText } = await import("../src/meta.ts");
  if (r?.buttons?.length) await quiet(() => sendButtons(env, to, r.bodyBeforeButtons ?? r.text ?? "", r.buttons));
  else if (r?.text) await quiet(() => sendText(env, to, r.text));
}

const env = reset();
const C1 = "+966500000501", C2 = "+966500000502";

out.push("# محاكاة الرحلات — 2026-09-24", "", "كل سطر رسالة خرجت فعلاً من الكود إلى Graph الملتقط، بالترتيب. الساعة بتوقيت الرياض.");

// ------------------------------------------------ العميل
out.push("\n## رحلة العميل");
at("2026-09-24 22:10"); step("العميل يكتب طلباً بعد الإقفال: «طماطم كرتون 3 وخيار جرم 2»");
setClaude([
  { product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 },
  { product_id: 2, product_name_raw: "خيار", packaging_id: 21, quantity: 2 },
]);
await reply(env, C1, await quiet(() => dispatch(env, {
  msg: { messageId: "m1", from: C1, fromRaw: "x", profileName: "", text: "طماطم كرتون 3 وخيار جرم 2", timestamp: "", type: "text" } as any,
  intent: "place_order", senderType: "customer", partner: partnerOf(CUST),
})));
flush();
out.push(`- الطلبات في Odoo قبل قرار العميل: ${rows("x_daily_order").length}`);

at("2026-09-24 22:11"); step("العميل يضغط «سجّله لبكرة» مرتين");
await reply(env, C1, await tap(env, `late_yes_${CUST}`, CUST));
await reply(env, C1, await tap(env, `late_yes_${CUST}`, CUST));
flush();
const lateOrder = rows("x_daily_order")[0];
out.push(`- Odoo: ${rows("x_daily_order").length} طلب، #${lateOrder.id} بتاريخ ${lateOrder.x_order_date} وحالة ${lateOrder.x_state}`);

at("2026-09-25 13:00"); step("طلب ثانٍ من العميل 2 بانتظار التأكيد، وتذكير 20:00");
const w2 = order(CUST2, "waiting_confirmation", "2026-09-25", 1);
env.MSG_DEDUP.store.set(kvLastInboundTs(CUST2), String(Date.now()));
at("2026-09-25 20:00");
await quiet(() => team.sendCutoffReminders(env));
flush();
at("2026-09-25 20:05"); step("العميل 2 يضغط «تأكيد الطلب»");
await reply(env, C2, await tap(env, `confirm_order_${w2}`, CUST2));
flush();
out.push(`- Odoo: الطلب #${w2} حالته ${table("x_daily_order").get(w2)!.x_state}`);

at("2026-09-25 21:15"); step("قائمة الشراء 21:15 (الطلب المسجّل لبكرة والطلب المؤكد)");
await quiet(() => team.aggregateAndDispatchToWarehouse(env));
flush();
out.push(`- Odoo: #${lateOrder.id} ← ${table("x_daily_order").get(lateOrder.id)!.x_state}، #${w2} ← ${table("x_daily_order").get(w2)!.x_state}`);

at("2026-09-25 21:30"); step("العميل يضغط «إلغاء» بعد الشراء");
await reply(env, C1, await tap(env, `cancel_order_${lateOrder.id}`, CUST));
flush();
out.push(`- Odoo: #${lateOrder.id} بقي ${table("x_daily_order").get(lateOrder.id)!.x_state}`);

at("2026-09-25 21:35"); step("العميل يرسل رسالة صوتية (webhook)");
await quiet(() => worker.fetch(signed(inbound("966500000501", { type: "audio", audio: { id: "VOICE1", mime_type: "audio/ogg", voice: true } })), env, ctx));
flush();

// ------------------------------------------------ المستودع
out.push("\n## رحلة المستودع");
const listId = rows("x_purchase_list")[0]?.id as number;
at("2026-09-25 21:40"); step("المستودع يضغط «مشكلة» من القالب (زر قالب = type button)");
await quiet(() => worker.fetch(signed(inbound("966500000601", { type: "button", button: { payload: `purchase_issue_${listId}`, text: "مشكلة" } })), env, ctx));
flush();
at("2026-09-25 21:42"); step("المستودع يكتب المشكلة");
await quiet(() => worker.fetch(signed(inbound("966500000601", { type: "text", text: { body: "الخيار غير متوفر في السوق الليلة" } })), env, ctx));
flush();
out.push(`- Odoo: x_notes على القائمة #${listId}: «${String(table("x_purchase_list").get(listId)!.x_notes).replace(/\n/g, " ⏎ ")}»`);
at("2026-09-26 06:00"); step("لم يُضغط «تم الشراء» — متابعة 06:00");
await quiet(() => team.followUpUnconfirmedPurchaseLists(env));
flush();
at("2026-09-26 06:05"); step("المستودع يرد برسالة: تصله القائمة كاملة بالأزرار");
await quiet(() => worker.fetch(signed(inbound("966500000601", { type: "text", text: { body: "تمام" } })), env, ctx));
flush();
void WH; void seed;

const failed = rows("x_wa_message").filter((r) => r.x_status === "failed").length;
out.push("", `**الخلاصة:** ${graph.length} رسالة ملتقطة، وفشل مسجّل في x_wa_message: ${failed}.`);
writeFileSync(new URL("./artifacts/wa-20260924-journeys.md", import.meta.url), out.join("\n") + "\n");
console.log(out.join("\n"));
