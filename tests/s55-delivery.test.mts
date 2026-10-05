// § 55 ب (2026-10-05) — the delivery and the collection of an order as one WhatsApp Flow.
//
//   [ب1]  utak_delivery_v1: the JSON at Meta against what the worker sends (every key declared, the
//         types, at most fifty components, Meta's limits)
//   [ب2]  «📦 سلّم وحصّل» in place of «تم التسليم ✅»: the driver's stop (the session message and its
//         queued form), Baraa's confirmed order; the template driver_stop untouched
//   [ب3]  who gets the form (a team member of any role, Baraa) and who never does; inside the window
//         only; only an order that may be delivered
//   [ب4]  a full delivery paid cash         [ب5]  a part delivery (the invoice by the delivered quantities)
//   [ب6]  a line at zero                    [ب7]  nothing delivered
//   [ب8]  a transfer, «لم يدفع», a part payment, an amount above the invoice — and the collector's request
//   [ب9]  a field that cannot be read: the whole form refused, nothing written, a new form
//   [ب10] the token: another number, a second use, an order already delivered, lines that moved
//   [ب11] more than twenty lines            [ب12] no invoice came out; the delivery that failed
//   [ب13] the paths of before: «تم التسليم», «تسليم N», the collector's request
//   [ب14] privacy: sale prices alone        [ب15] Baraa's own form
//   [ب16] the trial                          [ب17] the purposes, the webhook's routes, Odoo's pieces
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s55-delivery.test.mts

import { readFileSync } from "node:fs";
import { COLL, COLL_PHONE, CUST2_PHONE, OWNER, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, partnerOf, quiet, rows, seed, sentTo, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, C1, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

const DF = await import("../src/delivery-form.ts");
const INV = await import("../src/invoice.ts");
const TEAM = await import("../src/team.ts");
const OFL = await import("../src/order-flow.ts");
const PP = await import("../src/price-privacy.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { dispatch } = await import("../src/router.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const { ALREADY_DONE_TEXT } = await import("../src/button-lock.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s55-flows.mjs");
// @ts-ignore — plain .mjs helpers
const ODOO = await import("../scripts/lib/s55-odoo.mjs");

const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const count = (s: unknown) => [...String(s)].length;

/** The tenant after 10-01: the sale tax, the driver's, the collector's and the customer's windows open. */
function world(riyadh = `${DAY} 09:00`): any {
  const env = fresh(riyadh);
  seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.company", { id: 1, name: "UTAK Company", vat: "300000000000003", account_sale_tax_id: [77, "15%"] });
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  for (const d of [DRIVER_PHONE, COLL_PHONE, C1_PHONE]) openWindow(env, d);
  return env;
}
type Line = [product: number, packaging: number, quantity: number, price: number];
const TWO: Line[] = [[1, 11, 3, 31], [2, 21, 2, 19]];   // طماطم كرتون × 3 at 31, خيار جرم × 2 at 19: 93 + 38 = 131
/** An order on its way (in_delivery, a stop), its lines priced as its quotation froze them. */
function onTheWay(lines: Line[] = TWO, extra: Record<string, unknown> = {}, stop = true): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: "in_delivery", x_order_date: DAY, x_price_date: DAY, x_created_via: "whatsapp", x_delivery_neighborhood: "العليا", x_utak_simulation: false, x_delivery_notes: false, ...extra });
  for (const [p, k, q, u] of lines) seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: p, x_packaging_id: k, x_quantity: q, x_unit_price: u, x_subtotal: q * u, x_status: "pending" });
  if (stop) seed("x_delivery_stop", { x_order_id: id, x_status: "pending", x_issue_note: false });
  return id;
}
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const buttonsOf = (b: any): Array<{ id: string; title: string }> => (b?.interactive?.action?.buttons ?? []).map((x: any) => ({ id: String(x?.reply?.id ?? ""), title: String(x?.reply?.title ?? "") }));
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map((b: any) => String(b.text?.body ?? ""));
const kinds = (d: string) => JSON.stringify(sentTo(d).map((b: any) => b.template?.name ?? b.interactive?.type ?? b.type));
const linesOf = (orderId: number) => rows("x_daily_order_line").filter((l: any) => l.x_order_id === orderId) as any[];
const lineOf = (orderId: number, product: number) => linesOf(orderId).find((l: any) => l.x_product_tmpl_id === product) as any;
const invoicesOf = (orderId: number) => rows("x_invoice").filter((i: any) => i.x_order_id === orderId) as any[];
const paymentsOf = (invoiceId: number) => rows("x_payment").filter((p: any) => p.x_invoice_id === invoiceId) as any[];
const stopOf = (orderId: number) => rows("x_delivery_stop").find((s: any) => s.x_order_id === orderId) as any;
const orderOf = (orderId: number) => table("x_daily_order").get(orderId) as any;
/** The collector's «طلب التحصيل» of an invoice (its cash button), sent or held for him. */
const asked = (env: any, invoiceId?: number) => [...sentTo(COLL_PHONE), ...heldFor(env, COLL_PHONE)].filter((b: any) => JSON.stringify(b).includes(invoiceId ? `collect_cash_${invoiceId}` : "collect_cash_")).length;
/** The purposes the gateway recorded, in the order of the sends. */
const purposes = (): string[] => odooLog.filter((c: any) => c.model === "x_wa_message" && c.method === "create").flatMap((c: any) => (c.body?.vals_list ?? []).map((v: any) => { try { return String(JSON.parse(String(v.x_debug_payload ?? "{}")).purpose ?? ""); } catch { return ""; } }));
let mid = 0;
const tapAs = (env: any, buttonId: string, who: number | null = DRIVER) => quiet(() => dispatch(env, { msg: { from: "+x", fromRaw: "x", profileName: "", messageId: `t${++mid}`, type: "button", buttonId, text: "", timestamp: "0" } as any, intent: "other", senderType: "customer", partner: who === null ? null : partnerOf(who) as any }));
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => DF.handleDeliveryFormReply(env, { from: "+" + from, messageId: `wamid.D${++mid}`, flow: { token, values } }, undefined, now));
const hook = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const button = (id: string, title = "x") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
/** What the Flow sends back for the order of two lines, as he left it: all delivered. The hidden slots answer with what they opened on. */
const FULL = (pay: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ q1: "3", r1: "none", q2: "2", r2: "none", q3: "0", r3: "none", pay, amt: "", note: "", ...more });
/** The form of an order, opened by the driver's tap: its token. */
async function formFor(env: any, orderId: number, who: number | null = DRIVER, phone = DRIVER_PHONE): Promise<string> {
  await tapAs(env, `dlv_${orderId}`, who);
  return tokenOf(flowsTo(phone).at(-1));
}
const lineWrites = () => odooLog.filter((c: any) => c.model === "x_daily_order_line" && c.method === "write").length;

// ================================================================ [ب1] the Flow at Meta
console.log("\n[ب1] utak_delivery_v1 at Meta is the form the worker fills: one screen, twenty lines of two components, no endpoint");
{
  const json = LIB.buildDeliveryFlowJson();
  const s = json.screens[0];
  const kids = s.layout.children as any[];
  const all = LIB.screenComponents(s) as any[];
  assert("ONE screen DELIVER_A — terminal, success — the one the worker opens, and no endpoint: the data travels with the message",
    json.screens.length === 1 && s.id === "DELIVER_A" && s.terminal === true && s.success === true && LIB.DELIVERY_SCREEN === DF.DELIVERY_FLOW_SCREEN && json.data_api_version === undefined && json.routing_model === undefined && json.version === "6.0" && LIB.DELIVERY_FLOW_NAME === "utak_delivery_v1");
  assert("it is one of § 55's Flows, as the Meta script walks them", LIB.FLOWS.some((f: any) => f.key === "delivery" && f.name === "utak_delivery_v1" && f.first === "DELIVER_A" && f.build === LIB.buildDeliveryFlowJson));
  assert("the components sit directly under SingleColumnLayout (no Form), forty-six of them — within Meta's fifty", s.layout.type === "SingleColumnLayout" && !all.some((c) => c.type === "Form") && all.length === 46 && all.length <= LIB.SCREEN_COMPONENTS_MAX && kids.length === 46, String(all.length));
  assert("a heading and one line of text above the fields", kids[0].type === "TextHeading" && kids[0].text === "${data.head}" && kids[1].type === "TextBody" && kids[1].text === "${data.how}");
  const q = kids.filter((c) => c.type === "TextInput" && /^q\d+$/.test(c.name));
  const r = kids.filter((c) => c.type === "Dropdown");
  assert("twenty quantity fields q1 … q20: numeric, the item's name as the label, its hint, opened on the ordered quantity", LIB.DELIVERY_SLOTS === DF.DELIVERY_FLOW_SLOTS && q.length === 20
    && q.every((c, i) => c.name === `q${i + 1}` && c["input-type"] === "number" && c.label === `\${data.l${i + 1}}` && c["helper-text"] === `\${data.h${i + 1}}` && c["init-value"] === `\${data.i${i + 1}}`));
  assert("…each shown — and required — by its own v<n>: a quantity is never left empty", q.every((c, i) => c.visible === `\${data.v${i + 1}}` && c.required === `\${data.v${i + 1}}`));
  assert("twenty lists r1 … r20 «السبب», each right under its quantity, with four fixed choices — لا نقص، تالف، ناقص، رفضه العميل — opened on «لا نقص», not required",
    r.length === 20 && r.every((c, i) => c.name === `r${i + 1}` && c.label === "السبب" && c.required === false && c["init-value"] === "none" && c.visible === `\${data.v${i + 1}}` && kids.indexOf(c) === kids.indexOf(q[i]) + 1
      && JSON.stringify(c["data-source"]) === JSON.stringify([{ id: "none", title: "لا نقص" }, { id: "damaged", title: "تالف" }, { id: "short", title: "ناقص" }, { id: "refused", title: "رفضه العميل" }])));
  const [pay, amt, note, foot] = kids.slice(-4);
  assert("then «طريقة الدفع»: required, كاش / تحويل / لم يدفع, nothing chosen for him", pay.type === "RadioButtonsGroup" && pay.name === "pay" && pay.required === true && pay["init-value"] === undefined && pay.label === "طريقة الدفع"
    && JSON.stringify(pay["data-source"]) === JSON.stringify([{ id: "cash", title: "كاش" }, { id: "transfer", title: "تحويل" }, { id: "unpaid", title: "لم يدفع" }]));
  assert("«المبلغ المستلم» (a number, optional) and «ملاحظة» (optional)", amt.type === "TextInput" && amt.name === "amt" && amt["input-type"] === "number" && amt.required === false && amt.label === "المبلغ المستلم" && note.type === "TextArea" && note.name === "note" && note.required === false && note.label === "ملاحظة");
  const payload = foot["on-click-action"].payload;
  assert("«إرسال» completes with q and r of the twenty slots, pay, amt and note — forty-three values", foot.type === "Footer" && foot.label === "إرسال" && foot["on-click-action"].name === "complete" && Object.keys(payload).length === 43
    && Array.from({ length: 20 }, (_, i) => i + 1).every((n) => payload[`q${n}`] === `\${form.q${n}}` && payload[`r${n}`] === `\${form.r${n}}`) && payload.pay === "${form.pay}" && payload.amt === "${form.amt}" && payload.note === "${form.note}");
  const fixed = all.flatMap((c) => [c.label, c["helper-text"], c.text, ...(Array.isArray(c["data-source"]) ? c["data-source"].flatMap((o: any) => [o.id, o.title]) : [])]).filter((v) => typeof v === "string" && !v.startsWith("${"));
  assert("Meta's limits on what is written in the JSON: a label of twenty characters (thirty on the radio group), a choice of thirty, a hint of eighty — and no empty string",
    fixed.every((v) => v.length > 0) && [...r, amt, note].every((c) => count(c.label) <= 20) && count(pay.label) <= 30 && [...r, pay].every((c) => c["data-source"].every((o: any) => count(o.title) <= 30)) && [amt, note].every((c) => count(c["helper-text"]) <= 80) && count(s.title) <= 30, JSON.stringify(fixed));
  assert("the worker's own words are the Flow's: the reasons it writes, the payments it reads, the button", JSON.stringify(Object.keys(DF.RETURN_REASONS)) === JSON.stringify(LIB.DELIVERY_REASONS.slice(1).map((o: any) => o.id)) && LIB.DELIVERY_REASONS.slice(1).every((o: any) => (DF.RETURN_REASONS as any)[o.id] === o.title)
    && JSON.stringify(Object.entries(DF.PAY_METHODS)) === JSON.stringify(LIB.DELIVERY_PAY_OPTIONS.map((o: any) => [o.id, o.title])) && LIB.DELIVERY_CTA === DF.DELIVERY_FORM_CTA && !/\p{Extended_Pictographic}/u.test(DF.DELIVERY_FORM_CTA) && count(DF.DELIVERY_FORM_CTA) <= 20);
  assert("its id at Meta: utak_delivery_v1 #1113882387786390", DF.DELIVERY_FLOW_ID === "1113882387786390");

  const env = world(); const o = onTheWay();
  await tapAs(env, `dlv_${o}`);
  const f = flowsTo(DRIVER_PHONE)[0];
  const d = dataOf(f), model = s.data;
  assert("every key the worker sends is declared on the screen, and every declared key is sent (82), each of its declared type",
    JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(model).sort()) && Object.keys(d).length === 82 && Object.entries(d).every(([k, v]) => typeof v === (model[k].type === "boolean" ? "boolean" : "string")), String(Object.keys(d).length));
  assert("no empty string and no null in the data: an unused slot carries «-» and «0»", Object.values(d).every((v) => v !== "" && v !== null && v !== undefined) && d.l3 === "-" && d.h3 === "-" && d.i3 === "0" && d.v3 === false && d.v20 === false);
  assert("every example of the data model is of its type, and none is empty but an unused slot's", Object.values(model).every((m: any) => typeof m.__example__ === (m.type === "boolean" ? "boolean" : "string") && m.__example__ !== ""));
  assert("the message opens utak_delivery_v1 on its screen, with the data (navigate), under «سلّم وحصّل»", par(f).flow_id === DF.DELIVERY_FLOW_ID && par(f).flow_action === "navigate" && par(f).flow_action_payload.screen === "DELIVER_A" && par(f).flow_cta === "سلّم وحصّل" && par(f).flow_message_version === "3" && tokenOf(f).startsWith("dv1."));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب2] the button
console.log("\n[ب2] «📦 سلّم وحصّل» takes the place of «تم التسليم ✅» under the stop and under Baraa's confirmed order; the template keeps its own");
const omar = { id: DRIVER, name: "عمر المجهلي", x_whatsapp_number: "+" + DRIVER_PHONE, x_role: "driver", x_role_codes: ["driver"] } as any;
const stops = (ids: number[]) => ids.map((id, i) => ({ order_id: id, customer_id: C1, customer_name: "مطعم الوادي", customer_phone: "", neighborhood: "العليا", sequence: i + 1, line_summary: "طماطم × 3" })) as any;
{
  assert("the button: dlv_<order>, «📦 سلّم وحصّل» — within a reply button's twenty characters", JSON.stringify(DF.deliveryButton(12)) === JSON.stringify({ id: "dlv_12", title: "📦 سلّم وحصّل" }) && DF.DELIVERY_BUTTON_TITLE.length <= 20 && DF.DELIVERY_BUTTON_RE.exec("dlv_12")?.[1] === "12" && !DF.DELIVERY_BUTTON_RE.test("dlv_12x") && !DF.DELIVERY_BUTTON_RE.test("delivered_12"));
  const env = world();
  await quiet(() => TEAM.sendDriverRoute(env, omar, stops([41]), 9));
  const stop = sentTo(DRIVER_PHONE).filter((b: any) => b?.interactive?.type === "button");
  assert("the stop's session message: «📦 سلّم وحصّل» then «فيه مشكلة ⚠️» — and no «تم التسليم» button", stop.length === 1 && JSON.stringify(buttonsOf(stop[0])) === JSON.stringify([{ id: "dlv_41", title: "📦 سلّم وحصّل" }, { id: "delivery_issue_41", title: "فيه مشكلة ⚠️" }]) && /توصيلة #41/.test(bodyOf(stop[0])), JSON.stringify(stop.map(buttonsOf)));
}
{
  const env = world();
  table("hr.employee").get(OMAR_EMP)!.x_utak_attendance = true;   // on attendance, «بدء الدوام» not tapped yet: the route waits for his tap
  await quiet(() => TEAM.sendDriverRoute(env, omar, stops([42]), 9));
  const q = JSON.parse(env.MSG_DEDUP.store.get(`pending_loc:+${DRIVER_PHONE}`) ?? "[]");
  const item = q.find((x: any) => Array.isArray(x.buttons));
  assert("the stop queued for his «بدء الدوام» carries the same two buttons", sentTo(DRIVER_PHONE).length === 0 && JSON.stringify(item?.buttons) === JSON.stringify([{ id: "dlv_42", title: "📦 سلّم وحصّل" }, { id: "delivery_issue_42", title: "فيه مشكلة ⚠️" }]), JSON.stringify(q).slice(0, 300));
}
{
  const env = world();
  env.MSG_DEDUP.store.delete(`wa_win:v1:${DRIVER_PHONE}`);        // his window closed: the template goes
  seed("x_whatsapp_template", { x_purpose: "driver_stop", x_meta_template_id: "utak_driver_stop", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 5, x_category: "UTILITY" });
  await quiet(() => TEAM.sendDriverRoute(env, omar, stops([43]), 9));
  const tpl = sentTo(DRIVER_PHONE).filter((b: any) => b?.template?.name === "utak_driver_stop");
  const payloads = JSON.stringify(tpl[0]?.template?.components ?? []);
  assert("the template driver_stop keeps its own quick replies: delivered_<order> and delivery_issue_<order> (their text is fixed at Meta)", tpl.length === 1 && payloads.includes('"delivered_43"') && payloads.includes('"delivery_issue_43"') && !payloads.includes("dlv_"), payloads);
}
{
  const env = world();
  const o = onTheWay(TWO, { x_state: "confirmed" }, false);
  await quiet(() => OFL.notifyOwnerConfirmed(env, o));
  const m = sentTo(OWNER).filter((b: any) => b?.interactive?.type === "button");
  assert("Baraa's confirmed order: ONE button, «📦 سلّم وحصّل»", m.length === 1 && JSON.stringify(buttonsOf(m[0])) === JSON.stringify([{ id: `dlv_${o}`, title: "📦 سلّم وحصّل" }]), JSON.stringify(m.map(buttonsOf)));
  assert("…its text names the button, and «تسليم N» for the whole order at once", bodyOf(m[0]).includes("اضغط «📦 سلّم وحصّل»") && bodyOf(m[0]).includes(`«تسليم ${o}»`) && !bodyOf(m[0]).includes("اضغط «تم التسليم»") && bodyOf(m[0]).includes("المجموع: 131 ر.س"), bodyOf(m[0]));
  assert("the code: «تم التسليم ✅» is no session button any more — the template's payloads alone carry delivered_", !/title: "تم التسليم ✅"/.test(srcOf("team.ts") + srcOf("order-flow.ts")) && (srcOf("team.ts").match(/delivered_\$\{/g) ?? []).length === 1 && /\{ index: 0, payload: `delivered_\$\{s\.order_id\}` \}/.test(srcOf("team.ts")) && !/delivered_\$\{/.test(srcOf("order-flow.ts")));
}

// ================================================================ [ب3] who, when, which order
console.log("\n[ب3] the form goes to the one who tapped — a team member of any role, or Baraa — inside his window only, for an order that may be delivered");
{
  const env = world(); const o = onTheWay();
  const t = await tapAs(env, `dlv_${o}`, DRIVER);
  const f = flowsTo(DRIVER_PHONE);
  assert("the driver's tap: ONE message, the form — and no text beside it", f.length === 1 && sentTo(DRIVER_PHONE).length === 1 && !String(t.text ?? "").trim(), kinds(DRIVER_PHONE));
  assert("…it names the order and the customer, and says what to do", bodyOf(f[0]) === `📦 تسليم الطلب #${o} — مطعم الوادي\nاضغط «سلّم وحصّل»: اكتب المسلَّم من كل صنف، وطريقة الدفع والمبلغ، ثم «إرسال».`, bodyOf(f[0]));
  const d = dataOf(f[0]);
  assert("the heading; each line's name, «التعبئة · المطلوب N · السعر X ر.س شامل الضريبة», and the ordered quantity in its field",
    d.head === `طلب #${o} — مطعم الوادي` && d.how === DF.DELIVERY_HOW_TEXT && d.l1 === "طماطم" && d.h1 === "كرتون · المطلوب 3 · السعر 31 ر.س شامل الضريبة" && d.i1 === "3" && d.v1 === true && d.l2 === "خيار" && d.h2 === "جرم · المطلوب 2 · السعر 19 ر.س شامل الضريبة" && d.i2 === "2" && d.v2 === true, JSON.stringify([d.head, d.l1, d.h1, d.i1, d.h2]));
  assert("it went under the team's purpose", purposes().includes("delivery_form") && !purposes().includes("owner_delivery_form"), purposes().join(","));
  const c = await tapAs(env, `dlv_${o}`, COLL);
  assert("a member of another role (the collector): the form too", flowsTo(COLL_PHONE).length === 1 && !String(c.text ?? "").trim());
  const x = await tapAs(env, `dlv_${o}`, C1);
  assert("a customer's number: nothing — no form, no text", sentTo(C1_PHONE).length === 0 && !String(x.text ?? "").trim() && !String(x.bodyBeforeButtons ?? "").trim());
  const who = await quiet(() => DF.deliveryWho(env, "+" + AHMED_PHONE));
  assert("who a number is: Baraa, a team member — or no one (a supplier, a customer, an unknown number)", who === null && (await quiet(() => DF.deliveryWho(env, "+" + CUST2_PHONE))) === null && (await quiet(() => DF.deliveryWho(env, "")) ) === null
    && JSON.stringify(await quiet(() => DF.deliveryWho(env, "+" + OWNER))) === JSON.stringify({ kind: "owner", partnerId: null, name: "براء", whatsapp: OWNER })
    && JSON.stringify(await quiet(() => DF.deliveryWho(env, "+" + DRIVER_PHONE))) === JSON.stringify({ kind: "team", partnerId: DRIVER, name: "عمر المجهلي", whatsapp: DRIVER_PHONE }));
  assert("the hint keeps Meta's limits on a long name and a line without a price", count(DF.deliverySlotTexts("طماطم بلدي من مزارع القصيم الفاخرة جداً", "كرتون 5 كيلو", 3, 31.5, true).label) === 20 && DF.deliverySlotTexts("[UTAK-VEG-001] طماطم", "", 1.5, 0, true).hint === "المطلوب 1.5 · بلا سعر" && DF.deliverySlotTexts("[UTAK-VEG-001] طماطم", "", 1.5, 0, true).label === "طماطم"
    && DF.deliverySlotTexts("طماطم", "كرتون", 3, 31.5, false).hint === "كرتون · المطلوب 3 · السعر 31.50 ر.س" && count(DF.deliverySlotTexts("ط", "عبوة ".repeat(30), 3, 31, true).hint) <= 80 && count(DF.deliveryHead(7, "م".repeat(120))) <= 80);
}
{
  const env = world(); const o = onTheWay();
  env.MSG_DEDUP.store.delete(`wa_win:v1:${DRIVER_PHONE}`);
  const r = await quiet(() => DF.sendDeliveryForm(env, o, { kind: "team", partnerId: DRIVER, name: "عمر", whatsapp: DRIVER_PHONE }));
  assert("his window closed: no form, nothing held, no template", r.sent === false && r.reason === "window_closed" && sentTo(DRIVER_PHONE).length === 0 && heldFor(env, DRIVER_PHONE).length === 0, JSON.stringify(r));
  const kv = [...env.MSG_DEDUP.store.keys()].filter((k: string) => k.startsWith("dform:v1:"));
  assert("…and no token is left behind", kv.length === 0, kv.join(","));
}
{
  const env = world();
  const done1 = onTheWay(TWO, { x_state: "delivered" }), draft = onTheWay(TWO, { x_state: "waiting_confirmation" }), gone = onTheWay(TWO, { x_state: "cancelled" });
  const a = await tapAs(env, `dlv_${done1}`), b = await tapAs(env, `dlv_${draft}`), c = await tapAs(env, `dlv_${gone}`), d = await tapAs(env, "dlv_999999").catch((e) => ({ text: `threw: ${(e as Error).message}` }));
  assert("an order already delivered: «تم هذا الإجراء مسبقاً … مسجّل مسلّماً», no form", a.text === `${ALREADY_DONE_TEXT} الطلب #${done1} مسجّل مسلّماً.` && flowsTo(DRIVER_PHONE).length === 0, String(a.text));
  assert("an order the customer has not confirmed, a cancelled one, an unknown one: no form — he is told why", /لم يؤكده العميل بعد/.test(String(b.text)) && /ملغى، فلا يُسلَّم/.test(String(c.text)) && /ما لقينا الطلب #999999/.test(String(d.text)) && flowsTo(DRIVER_PHONE).length === 0);
  const empty = onTheWay([]);
  const e = await tapAs(env, `dlv_${empty}`);
  assert("an order without a line: no form", /ما فيه أصناف تُسلَّم/.test(String(e.text)) && flowsTo(DRIVER_PHONE).length === 0, String(e.text));
}
{
  const env = world();
  const o = onTheWay([[1, 11, 3, 31], [2, 21, 0, 19], [3, 31, 2, 0], [4, 41, 1, 12]]);
  lineOf(o, 3).x_unit_price = false; lineOf(o, 3).x_price_unit_manual = 25;   // Baraa's own price on the line, no frozen one
  lineOf(o, 4).x_status = "unavailable";                                        // short at the purchase: the invoice leaves it out
  await tapAs(env, `dlv_${o}`);
  const d = dataOf(flowsTo(DRIVER_PHONE)[0]);
  assert("the form's lines are the ones the invoice will read: a line of quantity 0 and an «unavailable» one have no field", d.l1 === "طماطم" && d.l2 === "بطاطس" && d.v2 === true && d.v3 === false && !JSON.stringify(d).includes("خيار") && !JSON.stringify(d).includes("بصل"), JSON.stringify([d.l1, d.l2, d.l3]));
  assert("a line that carries Baraa's manual price alone shows it", d.h2 === "كرتون · المطلوب 2 · السعر 25 ر.س شامل الضريبة", String(d.h2));
}
{
  const env = world(); const o = onTheWay();
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/json/2/hr.employee/")) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "no", arguments: ["no"] }), { status: 403 });
    return real(input as any, init);
  }) as typeof fetch;
  let t: any;
  try { t = await tapAs(env, `dlv_${o}`); } finally { globalThis.fetch = real; }
  assert("the roster cannot be read: nobody is taken for a team member on a guess — no form, nothing sent", flowsTo(DRIVER_PHONE).length === 0 && sentTo(DRIVER_PHONE).length === 0 && !String(t?.text ?? "").trim(), JSON.stringify(t));
}
{
  const env = world(); const o = onTheWay();
  table("res.partner").get(DRIVER)!.supplier_rank = 1;             // a number that is a supplier's too
  const t = await tapAs(env, `dlv_${o}`);
  assert("a number that belongs to a supplier is refused the form by the gateway (it carries sale prices) — he is told to deliver with «تسليم N»", flowsTo(DRIVER_PHONE).length === 0 && t.text === DF.DELIVERY_FORM_NOT_SENT_TEXT(o) && t.text.includes(`«تسليم ${o}»`), String(t.text));
  assert("…and its token is gone", [...env.MSG_DEDUP.store.keys()].filter((k: string) => k.startsWith("dform:v1:")).length === 0);
}

// ================================================================ [ب4] a full delivery paid cash
console.log("\n[ب4] everything delivered, paid cash: the order delivered as «تم التسليم» does, one invoice, the cash in his custody — and nothing more to anyone");
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const w0 = lineWrites(), p0 = purposes().length;
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash"));
  const [inv] = invoicesOf(o);
  assert("his summary goes under the form's own purpose (sale prices: the gateway's price guard), never as an ordinary reply", purposes().slice(p0).filter((p) => p === "delivery_form").length === 1 && !purposes().slice(p0).includes("bot_reply") && !purposes().slice(p0).some((p) => p.startsWith("owner_")), purposes().slice(p0).join(","));
  assert("the order and its stop are delivered, with the moment of the delivery", r.action === "delivered" && orderOf(o).x_state === "closed" && !!orderOf(o).x_delivered_at && stopOf(o).x_status === "delivered", JSON.stringify([r, orderOf(o).x_state]));
  assert("no line was touched by the form: delivered in full writes nothing (the invoice path's own price write-back apart)", linesOf(o).every((l: any) => l.x_status === "pending" && l.x_ordered_qty === undefined && l.x_return_qty === undefined && l.x_return_reason === undefined) && lineOf(o, 1).x_quantity === 3 && lineOf(o, 2).x_quantity === 2
    && odooLog.filter((c: any) => c.model === "x_daily_order_line" && c.method === "write").slice(w0).every((c: any) => JSON.stringify(Object.keys(c.body.vals).sort()) === JSON.stringify(["x_subtotal", "x_unit_price"])));
  assert("ONE invoice by the invoice path: 3 × 31 + 2 × 19 = 131, a tax invoice of today", invoicesOf(o).length === 1 && inv.x_total === 131 && inv.x_tax_amount > 0 && inv.x_invoice_date === DAY, JSON.stringify(inv));
  const pay = paymentsOf(inv.id);
  assert("ONE payment by the collection's own function: cash, 131, collected by him — the invoice paid", pay.length === 1 && pay[0].x_method === "cash" && pay[0].x_amount === 131 && pay[0].x_collected_by === DRIVER && inv.x_status === "paid" && r.payment === "paid" && r.invoiceId === inv.id, JSON.stringify(pay));
  const mine = textsTo(DRIVER_PHONE);
  assert("he gets ONE summary: each line, the invoice, «كاش 131 ر.س ✅ في عهدتك», and the route's next step", mine.length === 1 && sentTo(DRIVER_PHONE).length === 1
    && mine[0] === [`📦 الطلب #${o} — مطعم الوادي`, "• طماطم كرتون: 3 من 3 ✅", "• خيار جرم: 2 من 2 ✅", `الفاتورة ${inv.x_invoice_number}: 131 ر.س (بالمسلَّم فقط)`, "كاش 131 ر.س ✅ في عهدتك", "تم التسليم ✅ — التوصيلة الجاية بانتظارك."].join("\n"), mine[0]);
  assert("the customer gets his invoice and «تم التوصيل», as at any delivery", sentTo(C1_PHONE).some((b: any) => JSON.stringify(b).includes(inv.x_invoice_number)) && sentTo(C1_PHONE).length >= 2, kinds(C1_PHONE));
  assert("the collector is asked for NOTHING: the money is already recorded", asked(env) === 0 && sentTo(COLL_PHONE).length === 0 && !inv.x_sent_to_collector_at, kinds(COLL_PHONE));
  assert("Baraa gets nothing new: delivered in full, paid in full", sentTo(OWNER).length === 0, JSON.stringify(ownerTexts()));
  const old = await tapAs(env, `delivered_${o}`);
  assert("it held the lock of «تم التسليم»: the old button on the same order answers «تم مسبقاً», no second invoice", old.text === ALREADY_DONE_TEXT && invoicesOf(o).length === 1 && paymentsOf(inv.id).length === 1, String(old.text));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب5] a part delivery
console.log("\n[ب5] a line delivered in part: its delivered quantity on the line, what was ordered beside it, and the invoice by the delivered quantities");
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "2", r1: "damaged", note: "كرتون مفتوح" }));
  const [inv] = invoicesOf(o);
  const l1 = lineOf(o, 1), l2 = lineOf(o, 2);
  assert("طماطم 2 of 3: x_quantity 2, «الكمية المطلوبة» 3, «المرتجع» 1, «سبب المرتجع» تالف — the line still billed", l1.x_quantity === 2 && l1.x_ordered_qty === 3 && l1.x_return_qty === 1 && l1.x_return_reason === "damaged" && l1.x_status === "pending", JSON.stringify(l1));
  assert("خيار delivered in full: not written", l2.x_quantity === 2 && l2.x_ordered_qty === undefined && l2.x_return_qty === undefined && l2.x_return_reason === undefined);
  assert("the invoice is by the delivered quantities alone: 2 × 31 + 2 × 19 = 100 — one invoice, issued by the invoice path", r.action === "delivered" && invoicesOf(o).length === 1 && inv.x_total === 100 && l1.x_subtotal === 62, JSON.stringify(inv));
  assert("the cash is the invoice's total (the field was left empty): 100, paid", paymentsOf(inv.id).length === 1 && paymentsOf(inv.id)[0].x_amount === 100 && inv.x_status === "paid" && asked(env) === 0);
  assert("the note is on the order («ملاحظات التسليم»), with who and when", /^\[09:00 عمر المجهلي\] كرتون مفتوح$/.test(String(orderOf(o).x_delivery_notes)), String(orderOf(o).x_delivery_notes));
  const mine = textsTo(DRIVER_PHONE)[0];
  assert("his summary names the shortfall and its reason, the invoice of 100, the cash and his note", mine.includes("• طماطم كرتون: 2 من 3 — لم يُسلَّم 1 (تالف)") && mine.includes("• خيار جرم: 2 من 2 ✅") && mine.includes(`الفاتورة ${inv.x_invoice_number}: 100 ر.س (بالمسلَّم فقط)`) && mine.includes("كاش 100 ر.س ✅ في عهدتك") && mine.includes("ملاحظتك: كرتون مفتوح"), mine);
  const told = ownerTexts();
  assert("Baraa gets ONE message: the item, the quantity, «تالف», and the note — no payment line (it is paid in full)", told.length === 1
    && told[0] === [`📦 تسليم الطلب #${o} — مطعم الوادي (عمر المجهلي)`, "• ناقص: طماطم كرتون 2 من 3 — تالف", "• ملاحظة: كرتون مفتوح"].join("\n"), told.join(" || "));
  assert("…under the team's note purpose (his alone, critical)", purposes().includes("owner_team_note"));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "1.5", r1: "none", q2: "٢" }));
  assert("a shortfall with no reason chosen is «ناقص»; 1.5 cartons and Arabic digits are quantities", r.action === "delivered" && lineOf(o, 1).x_quantity === 1.5 && lineOf(o, 1).x_return_qty === 1.5 && lineOf(o, 1).x_return_reason === "short" && invoicesOf(o)[0].x_total === 84.5 && /لم يُسلَّم 1\.5 \(ناقص\)/.test(textsTo(DRIVER_PHONE)[0]), JSON.stringify(lineOf(o, 1)));
}
{
  const env = world(); const o = onTheWay(TWO, { x_delivery_notes: "ملاحظة سابقة" });
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { note: "  يبغى   الفاتورة ورق  " }));
  assert("a note alone — delivered in full, paid in full: Baraa gets it, and nothing else in his message", r.action === "delivered" && ownerTexts().length === 1 && ownerTexts()[0] === [`📦 تسليم الطلب #${o} — مطعم الوادي (عمر المجهلي)`, "• ملاحظة: يبغى الفاتورة ورق"].join("\n"), ownerTexts().join(" || "));
  assert("…it is ADDED to the order's notes: what was there stays", orderOf(o).x_delivery_notes === "ملاحظة سابقة\n[09:00 عمر المجهلي] يبغى الفاتورة ورق", String(orderOf(o).x_delivery_notes));
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  const w0 = lineWrites();
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { r1: "damaged", r2: "refused", note: "" }));
  assert("a reason chosen on a line delivered in full is not a shortfall: nothing written, Baraa told nothing", r.action === "delivered" && lineOf(o, 1).x_return_reason === undefined && lineOf(o, 2).x_return_reason === undefined && invoicesOf(o)[0].x_total === 131 && ownerTexts().length === 0
    && odooLog.filter((c: any) => c.model === "x_daily_order_line" && c.method === "write").slice(w0).every((c: any) => !("x_return_reason" in c.body.vals)));
}

// ================================================================ [ب6] a line at zero
console.log("\n[ب6] a line of which nothing was delivered: «unavailable» — out of the invoice — with its quantity untouched");
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { q2: "0", r2: "refused" }));
  const [inv] = invoicesOf(o);
  const l2 = lineOf(o, 2);
  assert("خيار 0 of 2: the line is «unavailable», its quantity still 2, «المطلوبة» 2, «المرتجع» 2, «رفضه العميل»", l2.x_status === "unavailable" && l2.x_quantity === 2 && l2.x_ordered_qty === 2 && l2.x_return_qty === 2 && l2.x_return_reason === "refused", JSON.stringify(l2));
  assert("the invoice leaves it out: 3 × 31 = 93, paid cash", r.action === "delivered" && invoicesOf(o).length === 1 && inv.x_total === 93 && paymentsOf(inv.id)[0].x_amount === 93 && inv.x_status === "paid", JSON.stringify(inv));
  assert("his summary: «0 من 2 — لم يُسلَّم (رفضه العميل)»; Baraa: «لم يُسلَّم: خيار جرم × 2 — رفضه العميل»", textsTo(DRIVER_PHONE)[0].includes("• خيار جرم: 0 من 2 — لم يُسلَّم (رفضه العميل)") && ownerTexts().length === 1 && ownerTexts()[0].includes("• لم يُسلَّم: خيار جرم × 2 — رفضه العميل"), `${textsTo(DRIVER_PHONE)[0]} || ${ownerTexts()[0]}`);
  assert("no field rejected by the schema gate («unavailable» is a status the line has)", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب7] nothing delivered
console.log("\n[ب7] nothing delivered at all: no delivery and no invoice — the stop's «مشكلة», Baraa's line, and the order stays to be delivered");
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const w0 = lineWrites();
  const r = await reply(env, DRIVER_PHONE, token, FULL("unpaid", { q1: "0", r1: "refused", q2: "0", r2: "none", note: "المحل مقفل" }));
  assert("no delivery, no invoice, no payment, no line written — the order is still on its way", r.action === "nothing" && orderOf(o).x_state === "in_delivery" && !orderOf(o).x_delivered_at && invoicesOf(o).length === 0 && rows("x_payment").length === 0 && lineWrites() === w0 && linesOf(o).every((l: any) => l.x_status === "pending"), JSON.stringify([r, orderOf(o).x_state]));
  const note = "لم يُسلَّم شيء (نموذج التسليم): طماطم كرتون × 3 — رفضه العميل؛ خيار جرم × 2 — ناقص · ملاحظة: المحل مقفل";
  assert("the stop is marked «مشكلة» with the reasons, as «فيه مشكلة» writes one — and the order's note keeps them", stopOf(o).x_status === "issue" && stopOf(o).x_issue_note === note && String(orderOf(o).x_delivery_notes).includes(note), String(stopOf(o).x_issue_note));
  assert("Baraa gets the line: the order, who, each item and why, the note", ownerTexts().length === 1
    && ownerTexts()[0] === [`⚠️ لم يُسلَّم الطلب #${o} — مطعم الوادي (عمر المجهلي)`, "• طماطم كرتون × 3 — رفضه العميل", "• خيار جرم × 2 — ناقص", "• ملاحظة: المحل مقفل", "لا تسليم ولا فاتورة. الطلب باقٍ للتسليم."].join("\n"), ownerTexts().join(" || "));
  assert("he is told nothing was recorded and the order stays", textsTo(DRIVER_PHONE).length === 1 && /لم يُسلَّم منه شيء، فلا تسليم ولا فاتورة ولا دفع/.test(textsTo(DRIVER_PHONE)[0]) && /الطلب باقٍ للتسليم/.test(textsTo(DRIVER_PHONE)[0]) && textsTo(DRIVER_PHONE)[0].includes("• طماطم كرتون: 0 من 3 — لم يُسلَّم (رفضه العميل)"), textsTo(DRIVER_PHONE)[0]);
  assert("the customer and the collector got nothing", sentTo(C1_PHONE).length === 0 && asked(env) === 0);
  assert("that form is used: its token is not read again", (await reply(env, DRIVER_PHONE, token, FULL("cash"))).action === "duplicate" && orderOf(o).x_state === "in_delivery" && invoicesOf(o).length === 0);
  // later the same day he delivers it: the button again, a new form
  const again = await formFor(env, o);
  const ok = await reply(env, DRIVER_PHONE, again, FULL("cash"));
  assert("the order stayed deliverable: the button gives a new form, and it delivers — 131, the stop «delivered»", again !== token && ok.action === "delivered" && invoicesOf(o)[0]?.x_total === 131 && stopOf(o).x_status === "delivered");
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "0", q2: "0", amt: "50" }));
  assert("nothing delivered but a payment reported: nothing recorded — Baraa's line carries it", rows("x_payment").length === 0 && ownerTexts()[0].includes("• بلّغ عن دفع ولم يُسجَّل: كاش 50 ر.س"), ownerTexts()[0]);
}

// ================================================================ [ب8] the payment
console.log("\n[ب8] the payment on the invoice just issued — a transfer, «لم يدفع», a part, an amount above it — and the collector's request");
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("transfer"));
  const [inv] = invoicesOf(o);
  assert("«تحويل»: a transfer of 131 on the invoice (the bank: it waits for its reconciliation in Odoo), collected by him", r.payment === "paid" && paymentsOf(inv.id).length === 1 && paymentsOf(inv.id)[0].x_method === "transfer" && paymentsOf(inv.id)[0].x_amount === 131 && paymentsOf(inv.id)[0].x_collected_by === DRIVER && inv.x_status === "paid", JSON.stringify(paymentsOf(inv.id)));
  assert("he is told «تحويل 131 ر.س — ينتظر المطابقة البنكية» — and not «في عهدتك»", textsTo(DRIVER_PHONE)[0].includes("تحويل 131 ر.س — ينتظر المطابقة البنكية") && !textsTo(DRIVER_PHONE)[0].includes("في عهدتك"), textsTo(DRIVER_PHONE)[0]);
  assert("paid in full: no collection request, nothing to Baraa", asked(env) === 0 && sentTo(OWNER).length === 0);
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("unpaid", { amt: "131" }));
  const [inv] = invoicesOf(o);
  assert("«لم يدفع»: the invoice is issued and stays due — no payment, whatever «المبلغ المستلم» holds", r.action === "delivered" && r.payment === "unpaid" && inv.x_total === 131 && inv.x_status === "issued" && rows("x_payment").length === 0 && orderOf(o).x_state === "delivered", JSON.stringify(inv));
  assert("he is told «لم يدفع: 131 ر.س مستحق»", textsTo(DRIVER_PHONE)[0].includes("لم يدفع: 131 ر.س مستحق"), textsTo(DRIVER_PHONE)[0]);
  assert("Baraa gets the line: unpaid, the amount due, the invoice", ownerTexts().length === 1 && ownerTexts()[0] === [`📦 تسليم الطلب #${o} — مطعم الوادي (عمر المجهلي)`, `• لم يدفع: 131 ر.س مستحق — الفاتورة ${inv.x_invoice_number}`].join("\n"), ownerTexts().join(" || "));
  assert("the collector's «طلب التحصيل» goes, as at any delivery", asked(env, inv.id) === 1 && !!inv.x_sent_to_collector_at, kinds(COLL_PHONE));
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { amt: "100" }));
  const [inv] = invoicesOf(o);
  assert("a part payment: 100 of 131 recorded, the invoice still issued, the order not closed", r.payment === "part" && paymentsOf(inv.id).length === 1 && paymentsOf(inv.id)[0].x_amount === 100 && inv.x_status === "issued" && orderOf(o).x_state === "delivered", JSON.stringify(paymentsOf(inv.id)));
  assert("he is told what is in his custody and what stays due: «كاش 100 ر.س ✅ في عهدتك — الباقي 31 ر.س مستحق»", textsTo(DRIVER_PHONE)[0].includes("كاش 100 ر.س ✅ في عهدتك — الباقي 31 ر.س مستحق"), textsTo(DRIVER_PHONE)[0]);
  assert("Baraa gets the line: «دفع جزئي: كاش 100 ر.س من 131 ر.س، والباقي 31 ر.س مستحق»", ownerTexts().length === 1 && ownerTexts()[0].includes(`• دفع جزئي: كاش 100 ر.س من 131 ر.س، والباقي 31 ر.س مستحق — الفاتورة ${inv.x_invoice_number}`), ownerTexts()[0]);
  assert("something stays due: the collector's request goes", asked(env, inv.id) === 1);
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("transfer", { amt: "200" }));
  const [inv] = invoicesOf(o);
  assert("an amount above the invoice (200 on 131): NOTHING recorded — it is not cut down to the balance", r.action === "delivered" && r.payment === "over" && rows("x_payment").length === 0 && inv.x_status === "issued" && inv.x_total === 131, JSON.stringify(rows("x_payment")));
  assert("he is told: 200 is more than what is due, nothing recorded, the whole invoice is due", /⚠️ تحويل 200 ر\.س أكبر من المتبقي على الفاتورة \(131 ر\.س\): لم يُسجَّل دفع/.test(textsTo(DRIVER_PHONE)[0]) && /ووصل براء/.test(textsTo(DRIVER_PHONE)[0]), textsTo(DRIVER_PHONE)[0]);
  assert("Baraa gets the line with what was reported", ownerTexts().length === 1 && ownerTexts()[0].includes(`• بلّغ تحويل 200 ر.س وهو أكبر من المتبقي (131 ر.س): لم يُسجَّل دفع — الفاتورة ${inv.x_invoice_number}`), ownerTexts()[0]);
  assert("the invoice is due: the collector's request goes", asked(env, inv.id) === 1);
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب9] a field that cannot be read
console.log("\n[ب9] one field that cannot be read: the WHOLE form is refused — nothing written, the field named, a new form");
{
  assert("what a quantity field holds: a number from 0 to the ordered quantity, two decimals at most — empty is not a quantity",
    DF.parseDeliveredQty("3", 3) === 3 && DF.parseDeliveredQty("0", 3) === 0 && DF.parseDeliveredQty("٢", 3) === 2 && DF.parseDeliveredQty(" 2,5 ", 3) === 2.5 && DF.parseDeliveredQty("1.25", 3) === 1.25 && DF.parseDeliveredQty(2, 3) === 2
    && DF.parseDeliveredQty("", 3) === "invalid" && DF.parseDeliveredQty(undefined, 3) === "invalid" && DF.parseDeliveredQty(null, 3) === "invalid" && DF.parseDeliveredQty("abc", 3) === "invalid" && DF.parseDeliveredQty("-1", 3) === "invalid"
    && DF.parseDeliveredQty("3.01", 3) === "invalid" && DF.parseDeliveredQty("4", 3) === "invalid" && DF.parseDeliveredQty("1.234", 3) === "invalid" && DF.parseDeliveredQty("1e1", 30) === "invalid" && DF.parseDeliveredQty("2 كرتون", 3) === "invalid");
  assert("what «المبلغ المستلم» holds: empty = the whole invoice; else a number above zero, two decimals at most", DF.parsePaidAmount("") === null && DF.parsePaidAmount(undefined) === null && DF.parsePaidAmount("100") === 100 && DF.parsePaidAmount("١٠٠٫٥") === 100.5 && DF.parsePaidAmount("99.99") === 99.99
    && DF.parsePaidAmount("0") === "invalid" && DF.parsePaidAmount("-5") === "invalid" && DF.parsePaidAmount("abc") === "invalid" && DF.parsePaidAmount("1.999") === "invalid" && DF.parsePaidAmount("1000001") === "invalid");
}
for (const [what, values, named] of [
  ["more than was ordered (5 of 3)", { q1: "5" }, "الكمية المسلَّمة رقم من 0 إلى المطلوب: طماطم كرتون (المطلوب 3)"],
  ["an empty quantity", { q1: "" }, "الكمية المسلَّمة رقم من 0 إلى المطلوب: طماطم كرتون (المطلوب 3)"],
  ["a quantity that is not a number, and a negative one", { q1: "ثلاثة", q2: "-1" }, "الكمية المسلَّمة رقم من 0 إلى المطلوب: طماطم كرتون (المطلوب 3)، خيار جرم (المطلوب 2)"],
  ["a quantity field that did not come back at all", { q2: undefined }, "الكمية المسلَّمة رقم من 0 إلى المطلوب: خيار جرم (المطلوب 2)"],
  ["no payment chosen", { pay: "" }, "اختر «طريقة الدفع»: كاش / تحويل / لم يدفع"],
  ["a payment that is not one of the three", { pay: "credit" }, "اختر «طريقة الدفع»: كاش / تحويل / لم يدفع"],
  ["an amount of zero with «كاش»", { amt: "0" }, "«المبلغ المستلم» رقم أكبر من صفر — أو اتركه فاضي لقيمة الفاتورة كاملة"],
  ["an amount that is not a number", { amt: "مية" }, "«المبلغ المستلم» رقم أكبر من صفر — أو اتركه فاضي لقيمة الفاتورة كاملة"],
] as Array<[string, Record<string, unknown>, string]>) {
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const w0 = odooLog.filter((c: any) => c.method === "write" || c.method === "create").filter((c: any) => !["x_wa_message", "mail.message", "discuss.channel"].includes(c.model)).length;
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", values));
  const w1 = odooLog.filter((c: any) => c.method === "write" || c.method === "create").filter((c: any) => !["x_wa_message", "mail.message", "discuss.channel"].includes(c.model)).length;
  const f = flowsTo(DRIVER_PHONE);
  assert(`${what}: refused — nothing written in Odoo, the order as it was, no invoice`, r.action === "refused" && w1 === w0 && orderOf(o).x_state === "in_delivery" && lineOf(o, 1).x_quantity === 3 && invoicesOf(o).length === 0 && rows("x_payment").length === 0 && stopOf(o).x_status === "pending", JSON.stringify(r));
  assert(`…ONE message names the field, and it is a NEW form (another token), opened as the first was`, sentTo(DRIVER_PHONE).length === 1 && f.length === 1 && bodyOf(f[0]) === [`⚠️ لم يُسجَّل شيء من نموذج الطلب #${o}:`, `• ${named}`, "هذا نموذج جديد، عبّه من جديد 👇"].join("\n") && tokenOf(f[0]) !== token && dataOf(f[0]).i1 === "3" && dataOf(f[0]).i2 === "2", bodyOf(f[0]));
  assert("…Baraa, the customer and the collector got nothing", sentTo(OWNER).length === 0 && sentTo(C1_PHONE).length === 0 && asked(env) === 0);
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  const bad = await reply(env, DRIVER_PHONE, token, FULL("", { q1: "9", amt: "x" }));
  assert("several fields at once: each is named (the amount is not read without a payment)", bad.action === "refused" && bodyOf(flowsTo(DRIVER_PHONE)[0]).includes("• الكمية المسلَّمة رقم من 0 إلى المطلوب: طماطم كرتون (المطلوب 3)") && bodyOf(flowsTo(DRIVER_PHONE)[0]).includes("• اختر «طريقة الدفع»") && !bodyOf(flowsTo(DRIVER_PHONE)[0]).includes("المبلغ المستلم"), bodyOf(flowsTo(DRIVER_PHONE)[0]));
  const ok = await reply(env, DRIVER_PHONE, tokenOf(flowsTo(DRIVER_PHONE)[0]), FULL("unpaid", { amt: "مية", q9: "7", r9: "damaged", lineId: 1 }));
  assert("the new form is taken; «المبلغ المستلم» is not read with «لم يدفع»; a slot the form did not carry is ignored", ok.action === "delivered" && ok.payment === "unpaid" && invoicesOf(o)[0].x_total === 131 && rows("x_payment").length === 0);
  const late = await reply(env, DRIVER_PHONE, token, FULL("cash"));
  assert("the refused form itself, sent again after the delivery: the order is delivered — «مسجّل مسلّماً», nothing more", late.action === "closed" && textsTo(DRIVER_PHONE).at(-1) === `${ALREADY_DONE_TEXT} الطلب #${o} مسجّل مسلّماً.` && rows("x_payment").length === 0 && invoicesOf(o).length === 1);
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب10] the token
console.log("\n[ب10] the token: the number it was sent to, once, while the order may still be delivered — never the client's data");
{
  const env = world(); const o = onTheWay();
  openWindow(env, CUST2_PHONE);
  const token = await formFor(env, o);
  graph.length = 0;
  const other = await reply(env, COLL_PHONE, token, FULL("cash"));
  assert("another number's reply with his token (a team member's too): nothing written, «هذا النموذج غير صالح…»", other.action === "unknown" && orderOf(o).x_state === "in_delivery" && invoicesOf(o).length === 0 && textsTo(COLL_PHONE)[0] === DF.DELIVERY_FORM_UNKNOWN_TEXT, JSON.stringify(other));
  const none = await reply(env, DRIVER_PHONE, `dv1.${o}.deadbeefdeadbeef00`, FULL("cash"));
  assert("a token the worker never issued: nothing written", none.action === "unknown" && orderOf(o).x_state === "in_delivery" && invoicesOf(o).length === 0);
  assert("the token: «dv1.» and the order, kept in KV with the lines as shown, the number and who he is", DF.isDeliveryFormToken(token) && token.startsWith(`dv1.${o}.`) && !DF.isDeliveryFormToken("of1.x") && !DF.isDeliveryFormToken("pr1.x"));
  const rec = JSON.parse(env.MSG_DEDUP.store.get(DF.deliveryFormKey(token)));
  assert("…its record", rec.orderId === o && rec.to === DRIVER_PHONE && rec.who.kind === "team" && rec.who.partnerId === DRIVER && rec.lines.length === 2 && rec.lines[0].lineId === lineOf(o, 1).id && rec.lines[0].ordered === 3 && rec.lines[0].price === 31 && rec.lines[0].name === "طماطم كرتون" && rec.lines[0].slot === 1, JSON.stringify(rec).slice(0, 300));
  const first = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "2" }));
  const again = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "1" }));
  assert("the same token again: the order is delivered — not delivered, invoiced or paid a second time", first.action === "delivered" && again.action === "closed" && invoicesOf(o).length === 1 && invoicesOf(o)[0].x_total === 100 && rows("x_payment").length === 1 && lineOf(o, 1).x_quantity === 2, JSON.stringify(again));
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  await tapAs(env, `delivered_${o}`);                               // «تم التسليم» from an older message, meanwhile
  graph.length = 0;
  const w0 = lineWrites();
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "1", r1: "damaged" }));
  assert("an order delivered before the form came back: «تم هذا الإجراء مسبقاً … مسجّل مسلّماً» — no line written, no payment, one invoice", r.action === "closed" && textsTo(DRIVER_PHONE)[0] === `${ALREADY_DONE_TEXT} الطلب #${o} مسجّل مسلّماً.` && lineWrites() === w0 && lineOf(o, 1).x_quantity === 3 && invoicesOf(o).length === 1 && invoicesOf(o)[0].x_total === 131 && rows("x_payment").length === 0, JSON.stringify(r));
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  env.MSG_DEDUP.store.set(`btnlock:v1:delivered:${o}`, "run:1:x");  // «تم التسليم» is running on the same order right now
  graph.length = 0;
  const w0 = lineWrites();
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "1" }));
  assert("the delivery lock is held by another tap: nothing written, «تم هذا الإجراء مسبقاً» — and his form is not used up", r.action === "locked" && lineWrites() === w0 && lineOf(o, 1).x_quantity === 3 && invoicesOf(o).length === 0 && textsTo(DRIVER_PHONE)[0] === ALREADY_DONE_TEXT && !env.MSG_DEDUP.store.has(`btnlock:v1:dform_use:${token}`), JSON.stringify(r));
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  lineOf(o, 1).x_quantity = 5;                                      // Baraa changed the order in Odoo after the form was sent
  graph.length = 0;
  const w0 = lineWrites();
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash"));
  const f = flowsTo(DRIVER_PHONE);
  assert("the order's lines moved since the form: nothing written — a new form with the lines as they are now", r.action === "changed" && lineWrites() === w0 && orderOf(o).x_state === "in_delivery" && invoicesOf(o).length === 0 && f.length === 1 && bodyOf(f[0]) === DF.DELIVERY_CHANGED_TEXT(o) && dataOf(f[0]).i1 === "5" && dataOf(f[0]).h1.includes("المطلوب 5"), JSON.stringify(r));
  seed("x_daily_order_line", { x_order_id: o, x_product_tmpl_id: 3, x_packaging_id: 31, x_quantity: 1, x_unit_price: 10, x_status: "pending" });
  const r2 = await reply(env, DRIVER_PHONE, tokenOf(f[0]), FULL("cash", { q1: "5" }));
  assert("…a line added after it: the same", r2.action === "changed" && invoicesOf(o).length === 0 && dataOf(flowsTo(DRIVER_PHONE).at(-1)).l3 === "بطاطس");
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب11] more than twenty lines
console.log("\n[ب11] an order of more than twenty lines: the first twenty in the form, the rest delivered in full and named");
{
  const env = world();
  for (let i = 0; i < 22; i++) {
    seed("product.template", { id: 500 + i, name: `صنف ${i + 1}`, sale_ok: true, x_is_active_for_sale: true });
    seed("x_product_packaging", { id: 5000 + i, x_name: "كرتون", x_product_tmpl_id: 500 + i, x_is_default: true });
  }
  const o = onTheWay(Array.from({ length: 22 }, (_, i) => [500 + i, 5000 + i, 2, 10] as Line));
  await tapAs(env, `dlv_${o}`);
  const f = flowsTo(DRIVER_PHONE)[0], d = dataOf(f);
  assert("twenty fields, all shown — the twenty-first and the twenty-second have none", d.v20 === true && d.l20 === "صنف 20" && d.l1 === "صنف 1" && Object.keys(d).length === 82 && !JSON.stringify(d).includes("صنف 21"));
  assert("the message names what is outside the form and says it is delivered in full", bodyOf(f).split("\n").at(-1) === "خارج النموذج (يتسع لـ 20 صنفاً) وتُسجَّل مسلَّمة كاملة: صنف 21 كرتون × 2، صنف 22 كرتون × 2.", bodyOf(f));
  graph.length = 0;
  const values: Record<string, unknown> = { pay: "cash", amt: "", note: "" };
  for (let n = 1; n <= 20; n++) { values[`q${n}`] = n === 1 ? "0" : "2"; values[`r${n}`] = n === 1 ? "damaged" : "none"; }
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), values);
  const [inv] = invoicesOf(o);
  assert("delivered: the first line out (تالف), the other nineteen and the two outside the form in full — 21 × 2 × 10 = 420", r.action === "delivered" && inv.x_total === 420 && lineOf(o, 500).x_status === "unavailable" && lineOf(o, 520).x_quantity === 2 && lineOf(o, 521).x_ordered_qty === undefined && paymentsOf(inv.id)[0].x_amount === 420, JSON.stringify(inv));
  assert("his summary says so", textsTo(DRIVER_PHONE)[0].includes("• وخارج النموذج، مسلَّمة كاملة: صنف 21 كرتون × 2، صنف 22 كرتون × 2"), textsTo(DRIVER_PHONE)[0].slice(-200));
  const env2 = world(); const o2 = onTheWay(Array.from({ length: 21 }, (_, i) => [500 + i, 5000 + i, 2, 10] as Line));
  for (let i = 0; i < 21; i++) { seed("product.template", { id: 500 + i, name: `صنف ${i + 1}` }); seed("x_product_packaging", { id: 5000 + i, x_name: "كرتون", x_product_tmpl_id: 500 + i }); }
  const t2 = await formFor(env2, o2);
  for (let n = 1; n <= 20; n++) values[`q${n}`] = "0";
  const r2 = await reply(env2, DRIVER_PHONE, t2, values);
  assert("every field at zero but a line outside the form: it IS a delivery (that line is delivered in full) — 2 × 10 = 20", r2.action === "delivered" && invoicesOf(o2)[0]?.x_total === 20, JSON.stringify(r2));
}

// ================================================================ [ب12] no invoice; a delivery that failed
console.log("\n[ب12] no invoice came out: no payment is recorded, he is told, and Baraa's line carries what he reported");
{
  const env = world(); const o = onTheWay([[1, 11, 3, 31], [2, 21, 2, 0]]);   // خيار without a price: the zero-price guard holds the invoice
  const token = await formFor(env, o);
  assert("a line without a price says so in its hint", dataOf(flowsTo(DRIVER_PHONE)[0]).h2 === "جرم · المطلوب 2 · بلا سعر");
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("cash", { amt: "100" }));
  assert("the order is delivered, no invoice is issued (held for the price), and NO payment is recorded", r.action === "delivered" && r.payment === "no_invoice" && orderOf(o).x_state === "delivered" && invoicesOf(o).length === 0 && rows("x_payment").length === 0, JSON.stringify(r));
  assert("he is told: no invoice now, nothing recorded — and that Baraa has what he reported", /⚠️ لم تصدر فاتورة الآن، فلم يُسجَّل دفع \(كاش 100 ر\.س\)\. وصل براء ما بلّغته\./.test(textsTo(DRIVER_PHONE)[0]) && !textsTo(DRIVER_PHONE)[0].includes("الفاتورة UTAK"), textsTo(DRIVER_PHONE)[0]);
  assert("Baraa's line carries the method and the amount: nothing is lost", ownerTexts().some((t) => t.startsWith(`📦 تسليم الطلب #${o} — مطعم الوادي (عمر المجهلي)`) && t.includes("• لم تصدر فاتورة، فلم يُسجَّل دفع. بلّغ: كاش 100 ر.س")), ownerTexts().join(" || "));
}
{
  const env = world(); const o = onTheWay(TWO, { x_utak_simulation: true });   // a simulation order: the invoice path issues nothing
  const token = await formFor(env, o);
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, token, FULL("transfer"));
  assert("a simulation order: delivered, no invoice, no payment — Baraa's line says «تحويل (المبلغ كامل)»", r.payment === "no_invoice" && invoicesOf(o).length === 0 && rows("x_payment").length === 0 && ownerTexts().some((t) => t.includes("• لم تصدر فاتورة، فلم يُسجَّل دفع. بلّغ: تحويل (المبلغ كامل)")), ownerTexts().join(" || "));
}
console.log("\n[ب12] the delivery itself failed after the lines were written: they are put back, and his form is not used up");
{
  const env = world(); const o = onTheWay();
  lineOf(o, 2).x_status = "purchased";                             // bought at the market: its status before the form
  const token = await formFor(env, o);
  graph.length = 0;
  // Odoo refuses the stop's write (the first write of «تم التسليم»): deliverOrder throws
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.endsWith("/json/2/x_delivery_stop/write")) return new Response(JSON.stringify({ name: "odoo.exceptions.UserError", message: "boom", arguments: ["boom"] }), { status: 400 });
    return real(input as any, init);
  }) as typeof fetch;
  let r: any;
  try { r = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "1", r1: "damaged", q2: "0", r2: "refused", note: "كرتون مفتوح" })); } finally { globalThis.fetch = real; }
  const l1 = lineOf(o, 1), l2 = lineOf(o, 2);
  assert("he is told it did not complete — the error is his answer, not a silence", r.action === "error" && textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === DF.DELIVERY_FORM_ERROR_TEXT(o), JSON.stringify(r));
  assert("the lines are as they were ordered: the quantity back, the «unavailable» line at the status it had («purchased»), the return fields cleared", l1.x_quantity === 3 && l1.x_status === "pending" && !l1.x_ordered_qty && !l1.x_return_qty && !l1.x_return_reason && l2.x_status === "purchased" && l2.x_quantity === 2 && !l2.x_ordered_qty && !l2.x_return_qty && !l2.x_return_reason && orderOf(o).x_state === "in_delivery" && invoicesOf(o).length === 0, JSON.stringify([l1, l2]));
  assert("both locks are released: the same form may be sent again, and «تم التسليم» is free", !env.MSG_DEDUP.store.has(`btnlock:v1:dform_use:${token}`) && !env.MSG_DEDUP.store.has(`btnlock:v1:delivered:${o}`));
  assert("…and his note is not on the order yet: nothing was delivered", !orderOf(o).x_delivery_notes && sentTo(OWNER).length === 0, String(orderOf(o).x_delivery_notes));
  const ok = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "1", r1: "damaged", q2: "0", r2: "refused", note: "كرتون مفتوح" }));
  assert("…sent again once Odoo answers: delivered — 1 × 31 = 31 — and the note is written once", ok.action === "delivered" && invoicesOf(o)[0].x_total === 31 && lineOf(o, 1).x_quantity === 1 && lineOf(o, 1).x_ordered_qty === 3 && lineOf(o, 2).x_status === "unavailable" && orderOf(o).x_delivery_notes === "[09:00 عمر المجهلي] كرتون مفتوح", String(orderOf(o).x_delivery_notes));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  graph.length = 0;
  // the order is cancelled in Odoo at the very moment the form is taken (after its checks, as its first line is written)
  const real = globalThis.fetch;
  let flipped = false;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (!flipped && url.endsWith("/json/2/x_daily_order_line/write")) { flipped = true; orderOf(o).x_state = "cancelled"; }
    return real(input as any, init);
  }) as typeof fetch;
  let r: any;
  try { r = await reply(env, DRIVER_PHONE, token, FULL("cash", { q1: "1", r1: "damaged", q2: "0", r2: "refused" })); } finally { globalThis.fetch = real; }
  assert("«تم التسليم» itself refuses the order (cancelled meanwhile): he gets its answer, nothing is delivered or issued", flipped && r.action === "not_delivered" && textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === `الطلب #${o} ملغى، فلا يُسلَّم.` && orderOf(o).x_state === "cancelled" && invoicesOf(o).length === 0 && sentTo(OWNER).length === 0, JSON.stringify(r));
  assert("…the lines are put back, and both locks are released", lineOf(o, 1).x_quantity === 3 && !lineOf(o, 1).x_return_qty && lineOf(o, 2).x_status === "pending" && !lineOf(o, 2).x_return_reason && !env.MSG_DEDUP.store.has(`btnlock:v1:dform_use:${token}`) && !env.MSG_DEDUP.store.has(`btnlock:v1:delivered:${o}`), JSON.stringify(linesOf(o)));
}

console.log("\n[ب12] the delivery is done but his summary cannot be sent: it stays done, and his form stays used");
{
  const env = world(); const o = onTheWay();
  const token = await formFor(env, o);
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("graph.facebook.com") && JSON.parse(String(init?.body ?? "{}")).to === DRIVER_PHONE) throw new Error("network down");
    return real(input as any, init);
  }) as typeof fetch;
  let r: any;
  try { r = await reply(env, DRIVER_PHONE, token, FULL("cash")).catch((e) => ({ action: `threw: ${(e as Error).message}` })); } finally { globalThis.fetch = real; }
  assert("an answer that does not go is not an error of the delivery: delivered, invoiced, paid — and both locks stay taken", r.action === "delivered" && orderOf(o).x_state === "closed" && invoicesOf(o).length === 1 && rows("x_payment").length === 1
    && String(env.MSG_DEDUP.store.get(`btnlock:v1:dform_use:${token}`)).startsWith("done:") && String(env.MSG_DEDUP.store.get(`btnlock:v1:delivered:${o}`)).startsWith("done:"), JSON.stringify(r));
  const again = await reply(env, DRIVER_PHONE, token, FULL("cash"));
  assert("…the same form sent again: «مسجّل مسلّماً» — no second invoice, no second payment", again.action === "closed" && invoicesOf(o).length === 1 && rows("x_payment").length === 1 && textsTo(DRIVER_PHONE).at(-1) === `${ALREADY_DONE_TEXT} الطلب #${o} مسجّل مسلّماً.`);
}

// ================================================================ [ب13] the paths of before
console.log("\n[ب13] the paths of before are as they were: «تم التسليم» of an older message, «تسليم N», the collector's request");
{
  const env = world(); const o = onTheWay();
  const w0 = lineWrites();
  const r = await tapAs(env, `delivered_${o}`);
  const [inv] = invoicesOf(o);
  assert("«تم التسليم ✅» (delivered_<order>) still delivers the whole order at once: 131, no payment, no line of the form's written", r.text === "تم التسليم ✅ — التوصيلة الجاية بانتظارك." && orderOf(o).x_state === "delivered" && inv.x_total === 131 && inv.x_status === "issued" && rows("x_payment").length === 0
    && odooLog.filter((c: any) => c.model === "x_daily_order_line" && c.method === "write").slice(w0).every((c: any) => !("x_quantity" in c.body.vals) && !("x_return_qty" in c.body.vals)), String(r.text));
  assert("…and the collector's «طلب التحصيل» goes, once", asked(env, inv.id) === 1 && !!inv.x_sent_to_collector_at, kinds(COLL_PHONE));
  assert("…no form, and nothing to Baraa", flowsTo(DRIVER_PHONE).length === 0 && sentTo(OWNER).length === 0);
}
{
  const env = world(); const o = onTheWay();
  await hook(env, DRIVER_PHONE, { type: "text", text: { body: `تسليم ${o}` } });
  assert("the text «تسليم N» from the driver: the whole order delivered, its collection request sent — no form", orderOf(o).x_state === "delivered" && invoicesOf(o)[0]?.x_total === 131 && asked(env, invoicesOf(o)[0].id) === 1 && flowsTo(DRIVER_PHONE).length === 0 && textsTo(DRIVER_PHONE).some((t) => /تم التسليم ✅/.test(t)), kinds(DRIVER_PHONE));
}
{
  const env = world(); const o = onTheWay(TWO, { x_state: "delivered" });
  const a = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o));
  assert("the invoice path called as before (no option): the collector's request goes", !!a && asked(env, a!.invoiceId) === 1 && !!invoicesOf(o)[0].x_sent_to_collector_at);
  const o2 = onTheWay(TWO, { x_state: "delivered" });
  let seen: any = null, calls2 = 0, customerHadIt = false, askedBefore = -1;
  const b = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o2, { settle: async (inv: any) => {
    seen = inv; calls2++;
    customerHadIt = !!(table("x_invoice").get(inv.invoiceId) as any)?.x_sent_to_customer_at;
    askedBefore = asked(env, inv.invoiceId);
    return false;
  } }));
  assert("its option: called ONCE with the invoice just issued — after the customer has it, before the collector is asked; «not settled» → the request goes", !!b && calls2 === 1 && seen?.invoiceId === b!.invoiceId && seen.total === 131 && seen.number === invoicesOf(o2)[0].x_invoice_number && customerHadIt && askedBefore === 0 && asked(env, b!.invoiceId) === 1, JSON.stringify([seen, customerHadIt, askedBefore]));
  const o3 = onTheWay(TWO, { x_state: "delivered" });
  const c = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o3, { settle: async () => true }));
  assert("…«settled in full» → no request; the invoice is returned all the same", !!c && c!.total === 131 && asked(env, c!.invoiceId) === 0 && !invoicesOf(o3)[0].x_sent_to_collector_at);
  const o4 = onTheWay(TWO, { x_state: "delivered" });
  const d = await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o4, { settle: async () => { throw new Error("boom"); } })).catch(() => null);
  assert("…an option that throws is «not settled»: the invoice stands and the request goes", !!d && invoicesOf(o4).length === 1 && asked(env, d!.invoiceId) === 1);
  let calls = 0;
  await quiet(() => INV.createAndDispatchInvoiceForOrder(env, o4, { settle: async () => { calls++; return true; } }));
  assert("…an invoice that exists already is not settled a second time", calls === 0 && invoicesOf(o4).length === 1);
}

// ================================================================ [ب14] privacy
console.log("\n[ب14] § 53: the form and every message of it carry the SALE price alone — no purchase price, cost, suggested price or profit is read or sent");
{
  const env = world();
  // the day's purchase side of the two items: numbers found nowhere else in this world
  const day = seed("x_price_day", { x_date: DAY, x_state: "published", x_utak_simulation: false, x_published_at: "2026-10-03 03:00:00" });
  seed("x_price_day_line", { x_day_id: day, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 17.77, x_market_price: 33.33, x_sale_price: 31, x_suggested_price: 23.45, x_break_even: 21.21, x_status: "auto", x_excluded: false });
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 16.66, x_date: DAY, x_extraction_status: "extracted" });
  const o = onTheWay();
  const n0 = odooLog.length;
  await tapAs(env, `dlv_${o}`);
  const sendReads = odooLog.slice(n0).filter((c: any) => !["x_wa_message", "mail.message", "discuss.channel", "ir.actions.server"].includes(c.model));
  const fieldsRead = (cs: any[]) => [...new Set(cs.flatMap((c: any) => [...(c.body?.fields ?? []), ...((c.body?.domain ?? []) as unknown[]).filter(Array.isArray).map((t: any) => String(t[0]))]))];
  const SECRET = /cost|purchase|suggest|break_even|profit|margin|market|x_price_sar/;
  const PRICE_SIDE = /^(x_price_|x_daily_price|x_pricing_|x_operating_cost|x_purchase_|x_supplier_|purchase\.|account\.|product\.)/;
  assert("building the form reads the order, its lines and its customer (and who tapped) — no model of the pricing or the purchase side at all",
    sendReads.some((c: any) => c.model === "x_daily_order_line") && sendReads.some((c: any) => c.model === "x_daily_order") && !sendReads.some((c: any) => PRICE_SIDE.test(c.model)) && PRICE_SIDE.test("x_price_day_line") && PRICE_SIDE.test("x_daily_price"), JSON.stringify([...new Set(sendReads.map((c: any) => c.model))]));
  assert("…of a line it reads the product, the packaging, the quantity, the status and the SALE price fields — nothing of the purchase side", JSON.stringify(fieldsRead(sendReads.filter((c: any) => c.model === "x_daily_order_line")).sort()) === JSON.stringify(["id", "x_packaging_id", "x_price_unit_manual", "x_product_tmpl_id", "x_quantity", "x_status", "x_unit_price"]) && !fieldsRead(sendReads).some((f) => SECRET.test(f)), JSON.stringify(fieldsRead(sendReads)));
  const f = flowsTo(DRIVER_PHONE)[0];
  const SECRETS = /17\.77|33\.33|23\.45|21\.21|16\.66/;
  assert("the form's data and its message carry 31 and 19 (the sale prices) and none of the purchase side's numbers", !SECRETS.test(JSON.stringify(f)) && JSON.stringify(dataOf(f)).includes("السعر 31 ر.س") && !/شراء|تكلفة|ربح|المقترح/.test(JSON.stringify(f)));
  const rec = env.MSG_DEDUP.store.get(DF.deliveryFormKey(tokenOf(f)));
  assert("…nor does the token's record", !SECRETS.test(rec) && !/cost|purchase|profit|suggest/i.test(rec));
  graph.length = 0;
  await reply(env, DRIVER_PHONE, tokenOf(f), FULL("cash", { q1: "2", r1: "damaged", amt: "50", note: "ملاحظة" }));
  const everything = JSON.stringify(graph);
  assert("the reply's messages — his summary, Baraa's line, the customer's invoice, the collector's request — carry none of them, and no word of the purchase side", graph.length >= 4 && !SECRETS.test(everything) && !/شراء|تكلفة|ربح|المقترح/.test(textsTo(DRIVER_PHONE).join("\n") + ownerTexts().join("\n")), String(graph.length));
  assert("the module itself names no field of the purchase side, and no accounting model: the invoice and the payment are the existing paths'", !/x_cost|x_purchase|x_suggested|x_break_even|x_market|x_profit|x_price_sar|x_daily_price|x_price_day|x_price_offer/.test(srcOf("delivery-form.ts")) && !/account\.(move|payment|journal)|syncPaymentToAccounting|createInvoiceRecord|createPaymentRecord/.test(srcOf("delivery-form.ts"))
    && /await import\("\.\/router"\)/.test(srcOf("delivery-form.ts")) && /recordCollection\(env, \{ invoiceId: inv\.invoiceId, method, amount, collectedBy, exact: true \}\)/.test(srcOf("delivery-form.ts")));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [ب15] Baraa's own form
console.log("\n[ب15] Baraa delivers from the car: the form under his own purpose, the delivery on the spot, and the summary alone");
{
  const env = world();
  const o = onTheWay(TWO, { x_state: "confirmed" }, false);         // confirmed, on no route: no stop
  await hook(env, OWNER, button(`dlv_${o}`, "📦 سلّم وحصّل"));
  const f = flowsTo(OWNER);
  assert("his tap on «📦 سلّم وحصّل»: the form, to him — and no text beside it", f.length === 1 && sentTo(OWNER).length === 1 && dataOf(f[0]).head === `طلب #${o} — مطعم الوادي` && dataOf(f[0]).h1 === "كرتون · المطلوب 3 · السعر 31 ر.س شامل الضريبة", kinds(OWNER));
  assert("…under the owner's purpose, never the team's", purposes().includes("owner_delivery_form") && !purposes().includes("delivery_form"), purposes().join(","));
  const rec = JSON.parse(env.MSG_DEDUP.store.get(DF.deliveryFormKey(tokenOf(f[0]))));
  assert("…its token is his: no collector's partner", rec.who.kind === "owner" && rec.who.partnerId === null && rec.to === OWNER);
  graph.length = 0;
  await hook(env, OWNER, nfm(tokenOf(f[0]), FULL("cash", { q2: "1", r2: "short", amt: "100", note: "باقي الحساب بكرة" })));
  const [inv] = invoicesOf(o);
  const od = orderOf(o);
  assert("the reply through the webhook: delivered on the spot («تسليم فوري»), the invoice by the delivered quantities — 93 + 19 = 112", od.x_state === "delivered" && od.x_immediate_delivery === true && inv?.x_total === 112 && lineOf(o, 2).x_quantity === 1 && lineOf(o, 2).x_ordered_qty === 2 && lineOf(o, 2).x_return_reason === "short", JSON.stringify([od.x_state, inv]));
  assert("the cash he took is recorded on it — 100 of 112 — with no collector named", paymentsOf(inv.id).length === 1 && paymentsOf(inv.id)[0].x_amount === 100 && paymentsOf(inv.id)[0].x_method === "cash" && !paymentsOf(inv.id)[0].x_collected_by && inv.x_status === "issued");
  const mine = textsTo(OWNER);
  assert("he gets the summary ALONE — one message, no second «تسليم الطلب» line-group to himself", sentTo(OWNER).length === 1 && mine.length === 1 && mine[0].startsWith(`📦 الطلب #${o} — مطعم الوادي\n`) && !mine.some((t) => t.startsWith("📦 تسليم الطلب")), mine.join(" || "));
  assert("…it says the cash is recorded in the collector's custody, what stays due, and «سُلّم فوراً»", mine[0].includes("• خيار جرم: 1 من 2 — لم يُسلَّم 1 (ناقص)") && mine[0].includes(`الفاتورة ${inv.x_invoice_number}: 112 ر.س`) && mine[0].includes("كاش 100 ر.س ✅ سُجّل في عهدة المحصّل — الباقي 12 ر.س مستحق") && !mine[0].includes("في عهدتك") && !mine[0].includes("وصل براء") && mine[0].includes("سُلّم فوراً"), mine[0]);
  assert("something stays due: the collector's request goes", asked(env, inv.id) === 1);
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  const o = onTheWay(TWO, { x_state: "confirmed" }, false);
  await hook(env, OWNER, button(`dlv_${o}`));
  const token = tokenOf(flowsTo(OWNER)[0]);
  graph.length = 0;
  const r = await reply(env, OWNER, token, FULL("unpaid", { q1: "0", r1: "refused", q2: "0", r2: "refused" }));
  assert("nothing delivered by Baraa himself: ONE message to him — no second line to himself — and the order stays confirmed", r.action === "nothing" && sentTo(OWNER).length === 1 && /لم يُسلَّم منه شيء/.test(textsTo(OWNER)[0]) && !/وصلت براء/.test(textsTo(OWNER)[0]) && orderOf(o).x_state === "confirmed" && invoicesOf(o).length === 0 && /رفضه العميل/.test(String(orderOf(o).x_delivery_notes)), textsTo(OWNER).join(" || "));
}
{
  const env = world(); const o = onTheWay(TWO, { x_state: "delivered" });
  await hook(env, OWNER, button(`dlv_${o}`));
  assert("his tap on an order already delivered: one line says so, no form", flowsTo(OWNER).length === 0 && textsTo(OWNER).length === 1 && textsTo(OWNER)[0] === `${ALREADY_DONE_TEXT} الطلب #${o} مسجّل مسلّماً.`, kinds(OWNER));
}

// ================================================================ [ب16] the trial
console.log("\n[ب16] the trial to Baraa: his number alone, his window open, once a day — and its reply writes nothing, delivers nothing, records nothing");
{
  const env = world(`${DAY} 14:00`);
  env.ODOO_HOOK_TOKEN = "HOOK";
  const call = (token: string) => quiet(async () => { const r = await worker.fetch(new Request(`https://w.test/odoo/hook/delivery-form-test?token=${token}`, { method: "POST" }), env, ctx); return { status: r.status, body: await r.json() as any }; });
  const bad = await call("nope");
  assert("the hook without Odoo's token: 401, nothing sent", bad.status === 401 && sentTo(OWNER).length === 0);
  const none = await call("HOOK");
  assert("no order to show: nothing sent, and the day's trial is not used up", none.body.sent === false && none.body.reason === "no_order" && sentTo(OWNER).length === 0, JSON.stringify(none.body));
  const real = onTheWay(TWO, { x_state: "delivered" });            // the latest real order — already delivered: read only
  onTheWay([[3, 31, 9, 99]], { x_utak_simulation: true });          // a newer simulation order, and a newer one without a line: neither is shown
  onTheWay([]);
  const n0 = odooLog.length;
  const sent = await call("HOOK");
  const f = flowsTo(OWNER);
  assert("ONE form to Baraa, marked «🧪 تجربة», from the latest real order that has lines", sent.status === 200 && sent.body.sent === true && sent.body.orderId === real && f.length === 1 && sentTo(OWNER).length === 1 && bodyOf(f[0]).startsWith(`🧪 تجربة — 📦 تسليم الطلب #${real} — مطعم الوادي`) && dataOf(f[0]).head === `🧪 تجربة — طلب #${real} — مطعم الوادي` && dataOf(f[0]).l1 === "طماطم" && dataOf(f[0]).v3 === false, JSON.stringify(sent.body));
  assert("…under the trial's own purpose, and nothing was written to build it", purposes().at(-1) === "delivery_form_test" && odooLog.slice(n0).every((c: any) => !["write", "create", "unlink"].includes(c.method) || ["x_wa_message", "mail.message", "discuss.channel"].includes(c.model)));
  const twice = await call("HOOK");
  assert("a second call the same day: nothing", twice.body.sent === false && twice.body.reason === "already_today" && flowsTo(OWNER).length === 1);
  graph.length = 0;
  const w0 = odooLog.filter((c: any) => ["write", "create", "unlink"].includes(c.method) && !["x_wa_message", "mail.message", "discuss.channel"].includes(c.model)).length;
  const r = await reply(env, OWNER, tokenOf(f[0]), FULL("cash", { q1: "2", r1: "damaged", amt: "50", note: "جرّبت" }));
  const w1 = odooLog.filter((c: any) => ["write", "create", "unlink"].includes(c.method) && !["x_wa_message", "mail.message", "discuss.channel"].includes(c.model)).length;
  const t = textsTo(OWNER);
  assert("his reply: ONE answer saying what WOULD be done", r.action === "test" && t.length === 1 && sentTo(OWNER).length === 1 && t[0].startsWith(`🧪 تجربة — وصل نموذج تسليم الطلب #${real} (مطعم الوادي):`) && t[0].includes("• طماطم كرتون: 2 من 3 — لم يُسلَّم 1 (تالف)") && t[0].includes("الدفع: كاش 50 ر.س") && t[0].includes("كان سيُسجَّل التسليم") && t[0].endsWith("(تجربة: لم يُسلَّم شيء، ولم تصدر فاتورة، ولم يُسجَّل دفع)"), t[0]);
  assert("…and NOTHING is written: no line, no order, no stop, no invoice, no payment — and no one else got a message", w1 === w0 && lineOf(real, 1).x_quantity === 3 && invoicesOf(real).length === 0 && rows("x_payment").length === 0 && graph.every((b: any) => b.to === OWNER));
  const badTrial = await reply(env, OWNER, tokenOf(f[0]), FULL("", { q1: "9" }));
  assert("a trial reply that cannot be read: answered so, still nothing written", badTrial.action === "test" && textsTo(OWNER).at(-1)!.startsWith("🧪 تجربة — ⚠️ لم يُسجَّل شيء") && textsTo(OWNER).at(-1)!.includes("طماطم كرتون (المطلوب 3)") && invoicesOf(real).length === 0);
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  // the tenant has no real order with a line yet: the trial is built from the latest order marked as a simulation
  const env = world(`${DAY} 14:00`);
  onTheWay([[3, 31, 9, 99]], { x_utak_simulation: true });          // an older simulation order
  onTheWay([]);                                                     // the only real order has no line: nothing to show of it
  const sim = onTheWay(TWO, { x_utak_simulation: true, x_state: "delivered" });
  const n0 = odooLog.length;
  const r = await quiet(() => DF.sendDeliveryFormTest(env));
  const f = flowsTo(OWNER);
  assert("no real order has a line: ONE form to Baraa from the latest order marked as a simulation, marked «🧪 تجربة», under the trial's purpose", r.sent === true && r.orderId === sim && f.length === 1 && sentTo(OWNER).length === 1
    && bodyOf(f[0]).startsWith(`🧪 تجربة — 📦 تسليم الطلب #${sim} — مطعم الوادي`) && dataOf(f[0]).head === `🧪 تجربة — طلب #${sim} — مطعم الوادي` && dataOf(f[0]).l1 === "طماطم" && dataOf(f[0]).i1 === "3" && dataOf(f[0]).v3 === false && purposes().at(-1) === "delivery_form_test", JSON.stringify(r));
  assert("…and nothing was written to build it", odooLog.slice(n0).every((c: any) => !["write", "create", "unlink"].includes(c.method) || ["x_wa_message", "mail.message", "discuss.channel"].includes(c.model)));
  graph.length = 0;
  const writes = () => odooLog.filter((c: any) => ["write", "create", "unlink"].includes(c.method) && !["x_wa_message", "mail.message", "discuss.channel"].includes(c.model)).length;
  const w0 = writes();
  const a = await reply(env, OWNER, tokenOf(f[0]), FULL("cash", { q1: "2", r1: "damaged" }));
  assert("its reply: the trial's answer — NOTHING written on the simulation order, no invoice, no payment, and no one else got a message", a.action === "test" && writes() === w0 && lineOf(sim, 1).x_quantity === 3 && orderOf(sim).x_state === "delivered" && invoicesOf(sim).length === 0 && rows("x_payment").length === 0
    && textsTo(OWNER).length === 1 && textsTo(OWNER)[0].endsWith("(تجربة: لم يُسلَّم شيء، ولم تصدر فاتورة، ولم يُسجَّل دفع)") && graph.every((b: any) => b.to === OWNER));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 14:00`); onTheWay();
  closeOwnerWindow(env);
  const n0 = odooLog.length;
  const r = await quiet(() => DF.sendDeliveryFormTest(env));
  assert("his window closed: no trial — nothing held, no template, and not one order is read for it", r.sent === false && r.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0 && !odooLog.slice(n0).some((c: any) => c.model === "x_daily_order" || c.model === "x_daily_order_line"));
  const noOwner = await quiet(() => DF.sendDeliveryFormTest({ ...env, OWNER_WHATSAPP: "" }));
  assert("no owner number: no trial", noOwner.sent === false && noOwner.reason === "no_owner");
}

// ================================================================ [ب17] the purposes, the routes, Odoo
console.log("\n[ب17] the purposes, the webhook's routes, and what Odoo is asked for");
{
  assert("delivery_form is the team's and carries sale prices; it and owner_delivery_form are replies (each answers his own tap), the trial is operational", PURPOSES.delivery_form?.kind === "reply" && PURPOSES.owner_delivery_form?.kind === "reply" && PURPOSES.delivery_form_test?.kind === "operational"
    && PP.CUSTOMER_PRICE_PURPOSES.has(DF.DELIVERY_FORM_PURPOSE) && !PP.CUSTOMER_PRICE_PURPOSES.has(DF.OWNER_DELIVERY_FORM_PURPOSE) && DF.DELIVERY_FORM_PURPOSE === "delivery_form" && DF.OWNER_DELIVERY_FORM_PURPOSE === "owner_delivery_form" && DF.DELIVERY_FORM_TEST_PURPOSE === "delivery_form_test");
  {
    const env = world(); const o = onTheWay();
    // Meta refused one message of the form to him an hour ago (undeliverable): an automatic purpose would be stopped for 24h
    for (const p of ["delivery_form", "owner_delivery_form"]) for (const d of [DRIVER_PHONE, OWNER]) env.MSG_DEDUP.store.set(`wa_blk_p:v1:${d}:${p}`, JSON.stringify({ code: 131026, at: "2026-10-03T05:00:00.000Z" }));
    await tapAs(env, `dlv_${o}`);
    await hook(env, OWNER, button(`dlv_${o}`));
    assert("a message Meta refused earlier does not stop the next form for 24h — to the driver or to Baraa: the delivery goes through it", flowsTo(DRIVER_PHONE).length === 1 && flowsTo(OWNER).length === 1, `${kinds(DRIVER_PHONE)} ${kinds(OWNER)}`);
  }
  const env = world();
  const text = { kind: "session" as const, body: { type: "text", text: { body: "x" } } };
  const dec = async (purpose: string, to: string) => gatewayDecision(await quiet(() => sendViaGateway(env, { purpose, to: "+" + to, content: text }))) as any;
  const a = await dec("owner_delivery_form", DRIVER_PHONE), b = await dec("delivery_form_test", DRIVER_PHONE), c = await dec("delivery_form", OWNER);
  assert("the owner's two purposes are refused to any other number, and the team's is refused to Baraa's", a?.action === "refused" && /OwnerOnlyPurpose/.test(a.reason) && b?.action === "refused" && /OwnerOnlyPurpose/.test(b.reason) && c?.action === "refused" && /OwnerGuardBlocked/.test(c.reason), JSON.stringify([a, b, c]));
  const d = await dec("owner_delivery_form", OWNER), e = await dec("delivery_form_test", OWNER), f = await dec("delivery_form", DRIVER_PHONE), g = await dec("delivery_form", AHMED_PHONE);
  assert("…each goes to its own: Baraa's two to Baraa, the team's to a member — and never to a supplier's number", d?.action === "session" && e?.action === "session" && f?.action === "session" && g?.action === "refused" && /PricePrivacy/.test(g.reason), JSON.stringify([d, e, f, g]));
}
{
  const env = world(); const o = onTheWay();
  await hook(env, DRIVER_PHONE, button(`dlv_${o}`, "📦 سلّم وحصّل"));
  const f = flowsTo(DRIVER_PHONE);
  assert("the driver's tap through the webhook: the form — and no «زر قديم» answer", f.length === 1 && sentTo(DRIVER_PHONE).length === 1, kinds(DRIVER_PHONE));
  graph.length = 0;
  await hook(env, DRIVER_PHONE, nfm(tokenOf(f[0]), FULL("cash", { q1: "2", r1: "refused" })));
  assert("his «إرسال» through the webhook is the delivery form's reply, not the price form's: delivered — 62 + 38 = 100, paid cash", orderOf(o).x_state === "closed" && invoicesOf(o)[0]?.x_total === 100 && paymentsOf(invoicesOf(o)[0].id)[0]?.x_collected_by === DRIVER && textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0].includes("رفضه العميل") && rows("x_price_offer").length === 0, kinds(DRIVER_PHONE));
  await hook(env, C1_PHONE, button(`dlv_${o}`));
  assert("a customer who sends the button's id gets no form", flowsTo(C1_PHONE).length === 0);
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  const fx = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20261005-s55.json", import.meta.url), "utf8"));
  const names = ODOO.LINE_FIELDS.map((f: any) => f.name);
  assert("the Odoo script creates the three fields the worker writes — and no other — on the order's line", ODOO.LINE_MODEL === "x_daily_order_line" && JSON.stringify(names) === JSON.stringify(["x_ordered_qty", "x_return_qty", "x_return_reason"]) && names.every((n: string) => srcOf("delivery-form.ts").includes(n))
    && JSON.stringify(ODOO.LINE_FIELDS.map((f: any) => [f.ttype, f.field_description])) === JSON.stringify([["float", "الكمية المطلوبة"], ["float", "المرتجع / غير المسلَّم"], ["selection", "سبب المرتجع"]]));
  assert("«سبب المرتجع»: the worker's three reasons, with their Arabic labels", JSON.stringify(ODOO.RETURN_REASON_OPTIONS) === JSON.stringify(Object.entries(DF.RETURN_REASONS)) && ODOO.RETURN_REASON_SELECTION === "[('damaged', 'تالف'), ('short', 'ناقص'), ('refused', 'رفضه العميل')]");
  assert("the schema gate knows the three fields and the reasons (the fixture read last), and «unavailable» and «ملاحظات التسليم» were there before", names.every((n: string) => fx.x_daily_order_line.includes(n)) && JSON.stringify(fx._selections["x_daily_order_line.x_return_reason"]) === JSON.stringify(Object.keys(DF.RETURN_REASONS))
    && fx._selections["x_daily_order_line.x_status"].includes("unavailable") && fx.x_daily_order.includes("x_delivery_notes") && /fixtures-odoo-fields-20261005-s55\.json",\s+\/\/ § 55[^\n]*\n(?:\s+"fixtures-odoo-fields-[^\n]*\n)*\]\.map/.test(readFileSync(new URL("./s46-kit.mts", import.meta.url), "utf8")));
  const form = `<form><sheet><group><field name="x_order_date"/></group><field name="x_line_ids"><list editable="bottom"><field name="x_product_tmpl_id"/><field name="x_quantity"/><field name="x_unit_price"/></list></field></sheet></form>`;
  assert("the order's form: the columns are added only when it lists its lines inline with «الكمية»", ODOO.linesListTag(form) === "list" && ODOO.linesListTag(form.replace(/list/g, "tree")) === "tree" && ODOO.linesListTag(`<form><field name="x_line_ids"/></form>`) === null && ODOO.linesListTag(form.replace(`<field name="x_quantity"/>`, "")) === null && ODOO.linesListTag("") === null);
  const arch = ODOO.orderLinesArch("list");
  assert("…as optional columns right after it, by an extension view of the order's own form (as § 49's)", arch.includes(`//field[@name='x_line_ids']/list/field[@name='x_quantity']" position="after"`) && (arch.match(/optional="show"/g) ?? []).length === 3 && ODOO.ORDER_FORM_VIEW === "x_daily_order.form" && ODOO.ORDER_LINES_VIEW === "x_daily_order.form.utak_s55"
    && ODOO.linesColumnsIn(form.replace(`<field name="x_quantity"/>`, `<field name="x_quantity"/>${arch.split("\n").slice(2, 5).join("")}`)) && !ODOO.linesColumnsIn(form));
  const script = readFileSync(new URL("../scripts/s55-20261005-odoo.mjs", import.meta.url), "utf8");
  assert("the script: dry by default, the rollback file before the first write, --verify, a rollback that deletes nothing without --drop", /save\(\); \/\/ the rollback file before the first write/.test(script) && /if \(VERIFY\)/.test(script) && /if \(ROLLBACK\)/.test(script) && /vals: \{ active: false \}/.test(script) && /if \(DROP\) await dropCreated/.test(script) && /s55-20261005-odoo-rollback\.json/.test(script) && !/"unlink"/.test(script));
  const trial = readFileSync(new URL("../scripts/s55-20261005-trial.mjs", import.meta.url), "utf8");
  assert("the trial script knows the form's hook", /delivery: "delivery-form-test"/.test(trial) && /url\.pathname === "\/odoo\/hook\/delivery-form-test"/.test(srcOf("index.ts")));
}

done();
