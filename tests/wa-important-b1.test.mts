// WA-SCENARIOS — important gaps, batch 1 (م2، م3، م19), 2026-09-24.
//
//   م2  the 08:00 payment reminder: a query Odoo actually accepts, a cap
//       (every PAY_REMIND_EVERY_DAYS, PAY_REMIND_MAX per debt), and a
//       reminded customer's «حولت» / receipt reaching the owner + collectors;
//   م3  the inactive nudge only for customers who ordered, and «إيقاف»;
//   م19 the feedback request at most once every FEEDBACK_EVERY_DAYS.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts), plus a strict
// schema gate built from the real field lists (fields_get on the tenant,
// 2026-09-24, tests/fixtures-odoo-fields-20260924.json): a domain, field
// list or write naming a field the model does not have is answered the way
// Odoo answers it (HTTP 500, «Invalid field»). No network, no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-important-b1.test.mts

import { readFileSync } from "node:fs";
import {
  COLL, CUST, CUST2, OWNER, ctx, inbound, ownerAlerts, quiet, reset, rows, seed, sentTo, setFail, setRiyadh, signed, table,
} from "./wa-harness.mts";

const CUST_PHONE = "966500000501", CUST2_PHONE = "966500000502", COLL_PHONE = "966500000602";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20260924.json", import.meta.url), "utf8"));
// 2026-09-25 (STATUS § 30) — the tenant now has the review fields on res.partner
// (x_contact_class …, read by the outreach tasks): the later fields_get joins.
const F_REVIEW = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20260925-review.json", import.meta.url), "utf8"));
// STATUS § 33 — x_wa_message.x_status: held / expired / skipped (the send gateway).
const F_GW = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20260925-gateway.json", import.meta.url), "utf8"));
const REAL: Record<string, string[]> = { ...FIXTURE, ...F_REVIEW, ...F_GW };
const SELECTIONS: Record<string, string[]> = { ...FIXTURE._selections, ...F_REVIEW._selections, ...F_GW._selections };
let optoutFieldExists = true;
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  // res.partner: the fixture keeps the custom fields and a few base ones.
  if (model === "res.partner" && !f.startsWith("x_")) return true;
  if (model === "res.partner" && f === "x_wa_marketing_optout") return optoutFieldExists;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body) {
    const b = JSON.parse(init.body);
    const names = [
      ...((b.domain ?? []) as unknown[]).filter(Array.isArray).map((t: any) => String(t[0])),
      ...(b.fields ?? []),
      ...Object.keys(b.vals ?? {}),
      ...((b.vals_list ?? []) as Array<Record<string, unknown>>).flatMap((v) => Object.keys(v)),
    ];
    const bad = names.filter((f: string) => !known(m[1], f));
    if (bad.length) {
      rejected.push(`${m[1]}.${m[2]}: ${bad.join(",")}`);
      const message = `Invalid field '${bad[0]}' on '${m[1]}'`;
      return new Response(JSON.stringify({ name: "builtins.ValueError", message, arguments: [message] }), { status: 500 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

/** KV that honours expirationTtl against the (fake) clock. */
class TtlKV {
  store = new Map<string, { v: string; exp: number }>();
  async get(k: string) { const r = this.store.get(k); if (!r) return null; if (r.exp && Date.now() >= r.exp) { this.store.delete(k); return null; } return r.v; }
  async put(k: string, v: string, o?: { expirationTtl?: number }) { this.store.set(k, { v, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); }
  async delete(k: string) { this.store.delete(k); }
}

const { setOdooRetryHooksForTests } = await import("../src/odoo.ts");
const odooExhausted: string[] = [];
setOdooRetryHooksForTests({ sleep: async () => {}, alert: async (_e: unknown, t: string) => { odooExhausted.push(t); } });
const { clearTemplateCache } = await import("../src/templates.ts");
const outreach = await import("../src/outreach.ts");
const { payRemindDecision, sendPaymentReminders, sendPostDeliveryFeedback, sendInactiveReengagement, runDailyOutreach,
  PAY_REMIND_EVERY_DAYS, PAY_REMIND_MAX, FEEDBACK_EVERY_DAYS } = outreach;
const { parseOptoutCommand, handleOptoutCommand, OPTOUT_CONFIRM_TEXT, RESUBSCRIBE_CONFIRM_TEXT, OPTOUT_PENDING_TEXT } = await import("../src/optout.ts");
const { isPaymentClaim, readPayRemindSent, PAY_CLAIM_REPLY, PAY_RECEIPT_REPLY } = await import("../src/pay-claim.ts");
const { kvLastInboundTs } = await import("../src/wa-inbox.ts");
const worker = (await import("../src/index.ts")).default;

const EXTRA_TPL: Array<[string, string, number, string]> = [
  ["customer_pay_remind", "utak_v2_pay_remind", 2, "UTILITY"],
  ["customer_feedback", "utak_feedback", 1, "MARKETING"],
  ["customer_inactive", "utak_v2_inactive", 1, "MARKETING"],
  ["customer_welcome", "utak_welcome", 2, "UTILITY"],
];
function fresh(riyadh: string): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  env.MSG_DEDUP = new TtlKV();
  // STATUS § 33 — Baraa's 24h window open (his daily 06:00 tap): alerts as text.
  env.MSG_DEDUP.store.set(`wa_win:v1:${OWNER}`, { v: JSON.stringify({ in: Date.UTC(2100, 0, 1) }), exp: 0 });
  EXTRA_TPL.forEach(([purpose, name, n, cat], i) => seed("x_whatsapp_template", {
    id: 950 + i, x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: n, x_category: cat,
  }));
  optoutFieldExists = true; rejected.length = 0; odooExhausted.length = 0;
  return env;
}
const tpl = (digits: string, name: string) => sentTo(digits).filter((b) => b?.template?.name === name);
const params = (b: any): string[] => b.template.components.find((c: any) => c.type === "body").parameters.map((p: any) => p.text);
const texts = (digits: string) => sentTo(digits).filter((b) => b?.type === "text").map((b) => String(b.text?.body ?? ""));
let ord = 0;
function invoice(customer: number, total: number, date: string, extra: Record<string, unknown> = {}): number {
  const o = seed("x_daily_order", { x_customer_id: customer, x_state: "delivered", x_order_date: date, x_name: `O${++ord}` });
  return seed("x_invoice", { x_invoice_number: `UTAK-INV-${ord}`, x_total: total, x_status: "issued", x_invoice_date: date, x_is_simulation: false, x_order_id: o, ...extra });
}
const say = (env: any, from: string, text: string) => quiet(() => worker.fetch(signed(inbound(from, { type: "text", text: { body: text } })), env, ctx));

// ================================================================ م2 — schema
console.log("\n[م2] the reminder query names only fields x_invoice has (it failed with HTTP 500 every day)");
{
  const OLD = { domain: ["x_status", "x_invoice_date"], fields: ["id", "x_customer_id", "x_total", "x_paid_amount"] };
  const oldBad = [...OLD.domain, ...OLD.fields].filter((f) => !known("x_invoice", f));
  assert("old query: x_customer_id / x_paid_amount are not fields of x_invoice", oldBad.join() === "x_customer_id,x_paid_amount", oldBad.join());
  assert("old query: statuses pending / partial are not in the selection (issued / paid / overdue)",
    ["pending", "partial"].every((v) => !SELECTIONS["x_invoice.x_status"].includes(v)));
  const env = fresh("2026-09-24 08:00");
  invoice(CUST, 100, "2026-09-20");
  const r = await quiet(() => sendPaymentReminders(env));
  assert("new query: no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
  assert("new query: the reminder is sent", r.sent === 1 && tpl(CUST_PHONE, "utak_v2_pay_remind").length === 1, JSON.stringify(r));
}

// ================================================================ م2 — amounts
console.log("\n[م2] one message per customer with the total still owed");
{
  const env = fresh("2026-09-24 08:00");
  const a = invoice(CUST, 100, "2026-09-18");
  seed("x_payment", { x_invoice_id: a, x_amount: 30 });
  invoice(CUST, 50, "2026-09-20", { x_status: "overdue" });
  invoice(CUST, 999, "2026-09-23");                              // 1 day old: not yet
  invoice(CUST, 777, "2026-09-18", { x_is_simulation: true });   // test invoice
  invoice(CUST, 555, "2026-09-18", { x_status: "paid" });
  invoice(CUST2, 200, "2026-09-19");
  seed("res.partner", { id: 503, name: "شريك مؤرشف", x_whatsapp_number: "+966500000503", customer_rank: 1, active: false });
  invoice(503, 80, "2026-09-18");
  const r = await quiet(() => sendPaymentReminders(env));
  const p1 = tpl(CUST_PHONE, "utak_v2_pay_remind").map(params);
  assert("CUST: one message, 100−30 + 50 = 120.00", p1.length === 1 && p1[0][1] === "120.00" && p1[0][0] === "مطعم الوادي", JSON.stringify(p1));
  assert("CUST2: 200.00", tpl(CUST2_PHONE, "utak_v2_pay_remind").map(params)[0]?.[1] === "200.00");
  assert("archived partner: nothing", sentTo("966500000503").length === 0);
  assert("report: sent 2, owing 3 (archived still owes)", r.sent === 2 && r.owing === 3, JSON.stringify(r));
}

// ================================================================ م2 — cap
console.log(`\n[م2] cap: every ${PAY_REMIND_EVERY_DAYS} days, ${PAY_REMIND_MAX} per debt, then the owner`);
{
  const d = (p: any, amount: number, day: string) => payRemindDecision(p, amount, day);
  const s0 = d(null, 100, "2026-09-24");
  assert("pure: first reminder goes", s0.send && s0.next.count === 1 && !s0.last);
  assert("pure: 2 days later — no", !d(s0.next, 100, "2026-09-26").send);
  const s1 = d(s0.next, 100, "2026-09-27");
  assert("pure: 3 days later — second", s1.send && s1.next.count === 2);
  const s2 = d(s1.next, 90, "2026-09-30");
  assert("pure: third is the last (partial payment keeps the cycle)", s2.send && s2.last && s2.next.count === 3);
  assert("pure: after the last — never again for this debt", !d(s2.next, 90, "2026-10-30").send);
  assert("pure: the debt grew (new overdue invoice) — new cycle", d(s2.next, 140, "2026-10-01").send);

  const env = fresh("2026-09-24 08:00");
  invoice(CUST, 100, "2026-09-18");
  const days = ["2026-09-24", "2026-09-24", "2026-09-25", "2026-09-27", "2026-09-29", "2026-09-30", "2026-10-03", "2026-10-06"];
  for (const day of days) { setRiyadh(`${day} 08:00`); await quiet(() => sendPaymentReminders(env)); }
  const sent = tpl(CUST_PHONE, "utak_v2_pay_remind").length;
  assert(`old gap closed: 8 runs over 12 days → ${PAY_REMIND_MAX} reminders (the old code meant: one every day)`, sent === PAY_REMIND_MAX, String(sent));
  const last = ownerAlerts().filter((a) => a.includes("الأخير"));
  assert("owner told once, after the last reminder", last.length === 1 && last[0].includes("100.00"), JSON.stringify(last));
}
{
  const env = fresh("2026-09-24 08:00");
  invoice(CUST, 100, "2026-09-18");
  setFail({ utak_v2_pay_remind: 131026 });
  await quiet(() => sendPaymentReminders(env));
  setFail({});
  // STATUS § 33 — Meta refused it: no automatic resend of this purpose to this number for 24h.
  await quiet(() => sendPaymentReminders(env));
  assert("a re-run the same day does not resend (24h after a refusal)", tpl(CUST_PHONE, "utak_v2_pay_remind").length === 1);
  setRiyadh("2026-09-25 08:00");
  await quiet(() => sendPaymentReminders(env));
  assert("a failed send does not use up a slot (retried next run)", tpl(CUST_PHONE, "utak_v2_pay_remind").length === 2);
  assert("… and it is the success that arms the «حولت» window", (await readPayRemindSent(env, CUST))?.amount === 100);
}

// ================================================================ م2 — «حولت»
console.log("\n[م2] a reminded customer's «حولت» / receipt reaches the owner and the collectors");
{
  assert("claim words (with shadda / hamza variants)", ["حوّلت", "حولت المبلغ", "تم التحويل", "دفعت امس", "سدّدت", "أرسلت المبلغ"].every(isPaymentClaim));
  assert("not a claim", !["ابي طماطم", "كم الحساب؟", "مرحبا"].some(isPaymentClaim));

  const env = fresh("2026-09-24 10:00");
  invoice(CUST, 100, "2026-09-18");
  setRiyadh("2026-09-24 08:00"); await quiet(() => sendPaymentReminders(env));
  setRiyadh("2026-09-24 10:00");
  await env.MSG_DEDUP.put(kvLastInboundTs(COLL), String(Date.now() - 3600e3)); // collector inside 24h
  await say(env, CUST_PHONE, "حوّلت المبلغ الحين");
  assert("customer: honest «المحصّل بيتأكد» reply", texts(CUST_PHONE).includes(PAY_CLAIM_REPLY), JSON.stringify(texts(CUST_PHONE)));
  const alerts = ownerAlerts().filter((a) => a.includes("يقول إنه حوّل"));
  assert("owner alerted with the amount and the text", alerts.length === 1 && alerts[0].includes("100.00") && alerts[0].includes("حوّلت المبلغ"), JSON.stringify(alerts));
  assert("collector inside the window: same note as text", texts(COLL_PHONE).some((t) => t.includes("يقول إنه حوّل")));
  assert("the classifier did not answer it too (one text only)", texts(CUST_PHONE).length === 1, JSON.stringify(texts(CUST_PHONE)));

  await env.MSG_DEDUP.delete(kvLastInboundTs(COLL));
  await quiet(() => worker.fetch(signed(inbound(CUST_PHONE, { type: "image", image: { id: "IMG9", mime_type: "image/jpeg" } })), env, ctx));
  assert("receipt image: «وصلنا الإيصال» instead of the generic media reply", texts(CUST_PHONE).includes(PAY_RECEIPT_REPLY) && !texts(CUST_PHONE).some((t) => t.includes("وصلتنا صورة")));
  assert("throttle: the receipt 1 min later does not ring the owner again", ownerAlerts().filter((a) => a.includes("يقول إنه حوّل")).length === 1);

  setRiyadh("2026-09-26 11:00"); // 51h after the reminder
  await quiet(() => worker.fetch(signed(inbound(CUST_PHONE, { type: "image", image: { id: "IMG10", mime_type: "image/jpeg" } })), env, ctx));
  assert("after 48h an image is ordinary media again (ح5 reply)", texts(CUST_PHONE).some((t) => t.includes("وصلتنا صورة")));
}
{
  const env = fresh("2026-09-24 10:00");
  await env.MSG_DEDUP.put(kvLastInboundTs(COLL), String(Date.now() - 3600e3));
  await say(env, CUST_PHONE, "حولت");
  assert("no reminder → «حولت» is an ordinary message (no claim reply, no alert)",
    !texts(CUST_PHONE).includes(PAY_CLAIM_REPLY) && !ownerAlerts().some((a) => a.includes("يقول إنه حوّل")));
}
{
  const env = fresh("2026-09-24 08:00");
  invoice(CUST, 100, "2026-09-18");
  await quiet(() => sendPaymentReminders(env));
  setRiyadh("2026-09-24 10:00");
  await say(env, CUST_PHONE, "دفعت");
  assert("collector outside the 24h window: no free text (#131047), the owner alert carries it",
    texts(COLL_PHONE).length === 0 && ownerAlerts().some((a) => a.includes("يقول إنه حوّل")));
}

// ================================================================ م2 — a failing task is not silent
console.log("\n[م2] a failing 08:00 task alerts the owner");
{
  const env = fresh("2026-09-24 08:00");
  invoice(CUST, 100, "2026-09-18");
  const saved = REAL.x_invoice; REAL.x_invoice = saved.filter((f) => f !== "x_invoice_date");
  const report: any = await quiet(() => runDailyOutreach(env));
  REAL.x_invoice = saved;
  assert("report carries the error", String(report.pay_remind?.error ?? "").includes("Invalid field"), JSON.stringify(report.pay_remind));
  assert("owner alerted: «تذكير الدفع» failed", ownerAlerts().some((a) => a.includes("تذكير الدفع") && a.includes("فشلت")), JSON.stringify(ownerAlerts()));
  assert("the other two tasks still ran", "sent" in report.feedback && "sent" in report.inactive);
}

// ================================================================ م3 — inactive
console.log("\n[م3] the inactive nudge only for customers who ordered and went quiet");
{
  const env = fresh("2026-09-24 08:00");
  seed("res.partner", { id: 511, name: "عميل جديد", x_whatsapp_number: "+966500000511", customer_rank: 1 }); // never ordered
  seed("res.partner", { id: 512, name: "عميل غائب", x_whatsapp_number: "+966500000512", customer_rank: 1 });
  seed("x_daily_order", { x_customer_id: 512, x_state: "delivered", x_order_date: "2026-09-01" });
  seed("res.partner", { id: 513, name: "عميل نشط", x_whatsapp_number: "+966500000513", customer_rank: 1 });
  seed("x_daily_order", { x_customer_id: 513, x_state: "delivered", x_order_date: "2026-09-01" });
  seed("x_daily_order", { x_customer_id: 513, x_state: "draft", x_order_date: "2026-09-20" });
  seed("res.partner", { id: 514, name: "طلب ملغى فقط", x_whatsapp_number: "+966500000514", customer_rank: 1 });
  seed("x_daily_order", { x_customer_id: 514, x_state: "cancelled", x_order_date: "2026-09-01" });
  seed("res.partner", { id: 515, name: "أوقف الرسائل", x_whatsapp_number: "+966500000515", customer_rank: 1, x_wa_marketing_optout: true });
  seed("x_daily_order", { x_customer_id: 515, x_state: "closed", x_order_date: "2026-09-02" });
  const r = await quiet(() => sendInactiveReengagement(env));
  assert("old gap closed: a customer who never ordered gets nothing", tpl("966500000511", "utak_v2_inactive").length === 0);
  assert("only a cancelled order: not a buyer, nothing", tpl("966500000514", "utak_v2_inactive").length === 0);
  assert("delivered 23 days ago, nothing since: nudged", tpl("966500000512", "utak_v2_inactive").length === 1);
  assert("ordered 4 days ago: nothing", tpl("966500000513", "utak_v2_inactive").length === 0);
  assert("opted out: nothing", tpl("966500000515", "utak_v2_inactive").length === 0);
  assert("report", r.sent === 1, JSON.stringify(r));
  setRiyadh("2026-10-10 08:00"); await quiet(() => sendInactiveReengagement(env));
  assert("once per 30 days", tpl("966500000512", "utak_v2_inactive").length === 1);
  setRiyadh("2026-10-25 08:00"); await quiet(() => sendInactiveReengagement(env));
  assert("… and again after 30 days", tpl("966500000512", "utak_v2_inactive").length === 2);
}

// ================================================================ م3 — «إيقاف»
console.log("\n[م3] «إيقاف» / «تشغيل» from the customer");
{
  const ok = ["إيقاف", "ايقاف", "إيقاف.", "  STOP ", "Stop", "إلغاء الاشتراك", "unsubscribe", "إيـقاف"].every((t) => parseOptoutCommand(t) === "optout");
  assert("opt-out words (hamza, case, tatweel, punctuation)", ok);
  assert("resubscribe words", parseOptoutCommand("تشغيل") === "resubscribe" && parseOptoutCommand("START") === "resubscribe");
  assert("longer messages are ordinary", ["ابي ايقاف الطلب", "stop the order", "توقف", ""].every((t) => parseOptoutCommand(t) === null));

  const env = fresh("2026-09-24 12:00");
  await say(env, CUST_PHONE, "إيقاف");
  assert("the flag is written on the partner", table("res.partner").get(CUST)?.x_wa_marketing_optout === true);
  assert("confirmation reply", texts(CUST_PHONE).includes(OPTOUT_CONFIRM_TEXT));
  seed("x_daily_order", { x_customer_id: CUST, x_state: "delivered", x_delivered_at: "2026-09-24 06:00:00", x_order_date: "2026-08-01" });
  setRiyadh("2026-09-25 08:00");
  await quiet(() => sendPostDeliveryFeedback(env));
  await quiet(() => sendInactiveReengagement(env));
  assert("opted out: neither feedback nor inactive", tpl(CUST_PHONE, "utak_feedback").length === 0 && tpl(CUST_PHONE, "utak_v2_inactive").length === 0);
  invoice(CUST, 100, "2026-09-18");
  await quiet(() => sendPaymentReminders(env));
  assert("… but the payment reminder (a service message) still goes", tpl(CUST_PHONE, "utak_v2_pay_remind").length === 1);
  await say(env, CUST_PHONE, "تشغيل");
  assert("«تشغيل» clears it", table("res.partner").get(CUST)?.x_wa_marketing_optout === false && texts(CUST_PHONE).includes(RESUBSCRIBE_CONFIRM_TEXT));
}
{
  const env = fresh("2026-09-24 12:00");
  const NEW = "966500000520";
  await say(env, NEW, "stop");
  const created = rows("res.partner").find((p) => String(p.x_whatsapp_number ?? "").includes(NEW));
  assert("a new number's first message «stop»: partner created and flagged", created?.x_wa_marketing_optout === true, JSON.stringify(created));
  assert("… and no welcome template sent to it", tpl(NEW, "utak_welcome").length === 0 && texts(NEW).includes(OPTOUT_CONFIRM_TEXT));
  await say(env, "966500000521", "مرحبا");
  assert("control: an ordinary first message still gets the welcome", tpl("966500000521", "utak_welcome").length === 1);
}
{
  const env = fresh("2026-09-24 12:00");
  optoutFieldExists = false;
  const reply = await quiet(() => handleOptoutCommand(env, { id: CUST, name: "مطعم الوادي" }, "إيقاف"));
  assert("field missing in Odoo: honest reply, not «تم»", reply === OPTOUT_PENDING_TEXT);
  assert("… and the owner is asked to set it by hand", ownerAlerts().some((a) => a.includes("طلب إيقاف") && a.includes("يدوياً")));
  seed("x_daily_order", { x_customer_id: CUST, x_state: "delivered", x_delivered_at: "2026-09-24 06:00:00", x_order_date: "2026-08-01" });
  setRiyadh("2026-09-25 08:00");
  const report: any = await quiet(() => runDailyOutreach(env));
  assert("fail closed: opt-outs unreadable → no marketing sent", tpl(CUST_PHONE, "utak_feedback").length === 0 && tpl(CUST_PHONE, "utak_v2_inactive").length === 0);
  assert("… and the owner hears about it", ownerAlerts().some((a) => a.includes("طلب التقييم") && a.includes("فشلت")), JSON.stringify(report.feedback));
}

// ================================================================ م19 — feedback
console.log(`\n[م19] feedback at most once every ${FEEDBACK_EVERY_DAYS} days`);
{
  const env = fresh("2026-09-24 08:00");
  const deliverYesterday = () => seed("x_daily_order", {
    x_customer_id: CUST, x_state: "delivered", x_order_date: "2026-01-01",
    x_delivered_at: new Date(Date.now() - 12 * 3600e3).toISOString().replace("T", " ").slice(0, 19),
  });
  const counts: number[] = [];
  for (let day = 24; day <= 31; day++) {
    setRiyadh(`2026-09-${day} 08:00`);
    deliverYesterday();
    await quiet(() => sendPostDeliveryFeedback(env));
    counts.push(tpl(CUST_PHONE, "utak_feedback").length);
  }
  assert("old gap closed: 8 daily deliveries → asked on day 1 and day 8 only (was 8)", counts.join() === "1,1,1,1,1,1,1,2", counts.join());
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

console.log(`\nwa-important-b1: ${passed} passed, ${failed} failed`);
if (odooExhausted.length) console.log("(odoo retry-exhausted alerts captured:", odooExhausted.length, ")");
if (failed) { console.log("FAILED:\n  - " + failures.join("\n  - ")); process.exit(1); }
