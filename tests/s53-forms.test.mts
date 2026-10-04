// § 53 ج / د (2026-10-04) — the customer's two WhatsApp Flows: the order form and the registration.
//
//   [ج] utak_order_v1: the JSON at Meta against what the worker sends; the items of the VALID price
//       list (0 / 4 / 16), their names, packagings and prices; no list → no form; the list expired →
//       a new form, nothing written; «إرسال» → the order's lines at the list's prices and the
//       quotation with its three buttons; «تعديل» (the quantities again, an emptied field), «إلغاء»;
//       when it goes (the 06:00 prices, «اطلب», the first order message) and to whom it never goes
//       (a price source, a supplier, the team, Baraa); the token; the trial
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s53-forms.test.mts

import { readFileSync } from "node:fs";
import { CUST2, CUST2_PHONE, OWNER, ctx, graph, heldFor, inbound, openWindow, partnerOf, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, C1, C1_PHONE, DAY, DRIVER_PHONE, OMAR_EMP, assert, cost, done, fresh, ownerTexts, rejected, setExtract } from "./s46-kit.mts";

const OF = await import("../src/order-form.ts");
const PR = await import("../src/prices.ts");
const { dispatch } = await import("../src/router.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s53-flows.mjs");

const NEXT = "2026-10-04";   // DAY = 2026-10-03, a Saturday
const RAED = 880, RAED_PHONE = "966550689078";
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const ms = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

/** The tenant's world: no minimum order, the customer's district known, his window open, the three categories. */
function world(riyadh: string): any {
  const env = fresh(riyadh); cost(500); setExtract(null);
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  table("res.partner").get(C1)!.x_delivery_neighborhood = "العليا";
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 6;
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  seed("res.partner", { id: RAED, name: "رائد", phone: "+" + RAED_PHONE, x_whatsapp_number: "+" + RAED_PHONE, x_wa_allowed: true, x_price_source: true, x_price_role: "market", customer_rank: 0, supplier_rank: 0, x_contact_class: "supplier" });
  seed("x_whatsapp_template", { x_purpose: "customer_welcome", x_meta_template_id: "utak_welcome", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  openWindow(env, C1_PHONE);
  return env;
}
/** A published price day with these [product, packaging, price] lines (the four products of the world by default). */
function published(day: string, lines: Array<[number, number, number]> = [[1, 11, 31], [2, 21, 28.5], [3, 31, 19], [4, 41, 12]], at = `${day} 06:00`): number {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: `أسعار اليوم ${day}`, x_utak_simulation: false, x_published_at: utc(at) });
  lines.forEach(([p, k, price], i) => seed("x_price_day_line", { x_day_id: d, x_sequence: i + 1, x_product_tmpl_id: p, x_packaging_id: k, x_cost_price: 15, x_market_price: price, x_sale_price: price, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 20, x_utak_simulation: false }));
  return d;
}
/** `n` more products in category `cat`, published at `price` on day `d`. */
function more(d: number, n: number, cat: number | false, from: number, price = 10): void {
  for (let i = 0; i < n; i++) {
    const id = from + i;
    seed("product.template", { id, name: `صنف ${id}`, sale_ok: true, x_is_active_for_sale: true, categ_id: cat });
    seed("x_product_packaging", { id: id * 10 + 1, x_name: "كرتون", x_product_tmpl_id: id, x_is_default: true });
    seed("x_price_day_line", { x_day_id: d, x_sequence: 100 + i, x_product_tmpl_id: id, x_packaging_id: id * 10 + 1, x_cost_price: 5, x_market_price: price, x_sale_price: price, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 8, x_utak_simulation: false });
  }
}
const c1 = { partnerId: C1, name: "مطعم الوادي", whatsapp: "+" + C1_PHONE };
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const buttonsOf = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => String(x?.reply?.id ?? ""));
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map((b: any) => String(b.text?.body ?? ""));
const kinds = (d: string) => JSON.stringify(sentTo(d).map((b: any) => b.template?.name ?? b.interactive?.type ?? b.type));
const ordersOf = (customer = C1) => rows("x_daily_order").filter((o: any) => o.x_customer_id === customer) as any[];
const linesOf = (orderId: number) => rows("x_daily_order_line").filter((l: any) => l.x_order_id === orderId) as any[];
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => OF.handleOrderFormReply(env, { from: "+" + from, messageId: `wamid.F${++wamid}`, flow: { token, values } }, undefined, now));
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (t: string) => ({ type: "text", text: { body: t } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
let mid = 0;
const tap = (env: any, buttonId: string, who: number | null = C1) => quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, fromRaw: C1_PHONE, profileName: "", messageId: `t${++mid}`, type: "button", buttonId, text: "", timestamp: "0" } as any, intent: "other" as any, senderType: "customer", partner: who ? partnerOf(who) as any : null }));
/** ح8's 90-second lock on a quotation's button has expired. */
const unlock = (env: any, orderId: number, action = "edit_order") => env.MSG_DEDUP.store.delete(`btnlock:v1:order:${orderId}:${action}`);
const orderText = (env: any, t: string, items: unknown) => quiet(async () => {
  setExtract(items);
  try { return await dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: `m${++mid}`, type: "text", text: t, timestamp: "0" } as any, intent: "place_order" as any, senderType: "customer", partner: partnerOf(C1) as any }); } finally { setExtract(null); }
});

// ================================================================ [ج] the Flow at Meta
console.log("\n[ج] utak_order_v1 at Meta is the form the worker fills: four pages of fifteen optional number fields, no endpoint");
{
  const json = LIB.buildOrderFlowJson();
  const ids = json.screens.map((s: any) => s.id);
  const inputsOf = (s: any) => s.layout.children.filter((c: any) => c.type === "TextInput");
  assert("four pages ORDER_A … ORDER_D, the first the one the worker opens, and no endpoint: the data travels with the message",
    JSON.stringify(ids) === JSON.stringify(["ORDER_A", "ORDER_B", "ORDER_C", "ORDER_D"]) && LIB.ORDER_FIRST_SCREEN === OF.ORDER_FLOW_SCREEN && ids.length === OF.ORDER_FLOW_PAGES && json.data_api_version === undefined && LIB.ORDER_FLOW_NAME === "utak_order_v1");
  assert("the routes are stated, each page to the next", JSON.stringify(json.routing_model) === JSON.stringify({ ORDER_A: ["ORDER_B"], ORDER_B: ["ORDER_C"], ORDER_C: ["ORDER_D"], ORDER_D: [] }));
  assert("fifteen quantity fields a page, sixty in all — q1 … q60, numeric and optional", LIB.ORDER_PAGE_SLOTS === OF.ORDER_FLOW_PAGE_SLOTS && OF.ORDER_FLOW_SLOTS === 60
    && json.screens.every((s: any, k: number) => inputsOf(s).length === 15 && inputsOf(s).every((c: any, j: number) => c.name === `q${k * 15 + j + 1}` && c["input-type"] === "number" && c.required === false)));
  assert("each page: its category as the heading, then the price note and the delivery day above the fields",
    json.screens.every((s: any, k: number) => { const c = s.layout.children; const r = (key: string) => (k === 0 ? `\${data.${key}}` : `\${screen.ORDER_A.data.${key}}`);
      return c[0].type === "TextHeading" && c[0].text === r(`t${k + 1}`) && c[1].type === "TextBody" && c[1].text === r("note") && c[2].type === "TextBody" && c[2].text === r("del"); }));
  const foot = (k: number) => json.screens[k].layout.children.at(-1);
  assert("pages 1–3 end with «التالي» while a page follows, else «إرسال»; the last with «إرسال» alone",
    [0, 1, 2].every((k) => foot(k).type === "If" && foot(k).then[0].label === "التالي" && foot(k).then[0]["on-click-action"].next.name === ids[k + 1] && foot(k).else[0].label === "إرسال" && foot(k).else[0]["on-click-action"].name === "complete")
    && foot(3).type === "Footer" && foot(3).label === "إرسال");
  const sent = (k: number) => (k === 3 ? foot(3) : foot(k).else[0])["on-click-action"].payload;
  assert("«إرسال» on page k completes with every quantity up to that page", [0, 1, 2, 3].every((k) => Object.keys(sent(k)).length === (k + 1) * 15) && sent(0).q7 === "${form.q7}" && sent(2).q7 === "${screen.ORDER_A.form.q7}" && sent(3).q60 === "${form.q60}");
  const env = world(`${DAY} 10:00`); published(DAY);
  await quiet(() => OF.sendOrderForm(env, c1));
  const f = flowsTo(C1_PHONE)[0];
  const model = json.screens[0].data;
  assert("every key the worker sends is declared on the first page, and every declared key is sent (249), each of its declared type",
    JSON.stringify(Object.keys(dataOf(f)).sort()) === JSON.stringify(Object.keys(model).sort()) && Object.keys(dataOf(f)).length === 249 && Object.entries(dataOf(f)).every(([k, v]) => typeof v === (model[k].type === "boolean" ? "boolean" : "string")), String(Object.keys(dataOf(f)).length));
  assert("the message opens utak_order_v1 on its first page, with the data (navigate), under «اطلب الآن»", par(f).flow_id === OF.ORDER_FLOW_ID && par(f).flow_action === "navigate" && par(f).flow_action_payload.screen === "ORDER_A" && par(f).flow_cta === "اطلب الآن" && LIB.ORDER_CTA === OF.ORDER_FORM_CTA);
}

// ================================================================ [ج] the items
console.log("\n[ج] the items: the published lines of the valid list — the name, «التعبئة · السعر X ر.س شامل الضريبة», a quantity");
{
  const env = world(`${DAY} 10:00`); published(DAY);
  const r = await quiet(() => OF.sendOrderForm(env, c1));
  const d = dataOf(flowsTo(C1_PHONE)[0]);
  assert("four items, all «خضار»: ONE page with four fields and «إرسال» on it", r.sent === true && d.t1 === "خضار" && d.m1 === false && [1, 2, 3, 4].every((n) => d[`v${n}`] === true) && d.v5 === false && d.t2 === "-", JSON.stringify([d.t1, d.m1, d.v4, d.v5]));
  assert("the field's label is the item's name; its hint the packaging and the list's price, VAT inside", d.l1 === "طماطم" && d.h1 === "كرتون · السعر 31 ر.س شامل الضريبة" && d.l2 === "خيار" && d.h2 === "جرم · السعر 28.50 ر.س شامل الضريبة", `${d.l1} | ${d.h1} | ${d.h2}`);
  assert("above the fields: «السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف.» and the delivery day by § 49's rule (ordered before 21:00: tomorrow morning)",
    d.note === "السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف." && /التوصيل: صباح الأحد 4 أكتوبر 2026، لو تأكد قبل الساعة 9:00 مساءً/.test(String(d.del)), String(d.del));
  assert("no quantity is written for him", [1, 2, 3, 4].every((n) => d[`i${n}`] === ""));
  assert("the purchase price, the market price and the suggested price of the lines are nowhere in the form (15, 20)", !/(?<![0-9.])(15|20)(?![0-9])/.test(Object.values(d).filter((v) => typeof v === "string").join("\n").replace(/2026|9:00/g, "")));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 22:00`); published(DAY);
  await quiet(() => OF.sendOrderForm(env, c1));
  assert("after 21:00 the delivery line says the morning after tomorrow", /التوصيل: صباح الاثنين 5 أكتوبر 2026 \(بعد بكرة\)/.test(String(dataOf(flowsTo(C1_PHONE)[0]).del)), String(dataOf(flowsTo(C1_PHONE)[0]).del));
}
{
  const env = world(`${DAY} 10:00`);
  const d = published(DAY, [[1, 11, 31]]);
  table("product.template").get(1)!.categ_id = 5;
  more(d, 16, 6, 300);
  more(d, 2, false, 400, 7);
  seed("x_price_day_line", { x_day_id: d, x_sequence: 900, x_product_tmpl_id: 2, x_packaging_id: 21, x_market_price: 30, x_sale_price: 0, x_status: "exception", x_excluded: true, x_utak_simulation: false });
  seed("x_price_day_line", { x_day_id: d, x_sequence: 901, x_product_tmpl_id: 3, x_packaging_id: 31, x_market_price: 30, x_sale_price: 30, x_status: "unpublished", x_excluded: true, x_utak_simulation: false });
  seed("x_price_day_line", { x_day_id: d, x_sequence: 902, x_product_tmpl_id: 4, x_packaging_id: 41, x_market_price: 0, x_sale_price: 0, x_status: "auto", x_excluded: false, x_utak_simulation: false });
  const items = await quiet(() => OF.orderFormItems(env, { dayId: d, day: DAY, publishedAtMs: null, validUntilMs: 0 }));
  assert("three categories: فواكه (1), خضار (16 → its first 15), أخرى (2) — a page each, in that order", JSON.stringify(items.pages) === JSON.stringify(["فواكه", "خضار", "أخرى"]) && items.items.filter((i: any) => i.slot <= 15).length === 1 && items.items.filter((i: any) => i.slot > 15 && i.slot <= 30).length === 15 && items.items.filter((i: any) => i.slot > 30).length === 2, JSON.stringify(items.pages));
  assert("the sixteenth of «خضار» has no field (it does not slide to the next page), and it is named", items.left.length === 1 && items.left[0] === "صنف 315" && items.over[0].title === "خضار" && items.over[0].total === 16 && items.total === 19);
  assert("a line that is an exception, left out or without a price (an approved line at 0) is not an item", !items.items.some((i: any) => i.productId === 2 || i.productId === 3 || i.productId === 4) && !items.items.some((i: any) => !(i.price > 0)));
  await quiet(() => OF.sendOrderForm(env, c1));
  const data = dataOf(flowsTo(C1_PHONE)[0]);
  assert("«التالي» on the first two pages, «إرسال» on the third", data.m1 === true && data.m2 === true && data.m3 === false && data.t3 === "أخرى" && data.t4 === "-");
  assert("Baraa is told once which items have no field", ownerTexts().filter((t) => /نموذج الطلب تتسع لـ 15 خانة/.test(t) && /صنف 315/.test(t)).length === 1);
  await quiet(() => OF.sendOrderForm(env, c1));
  assert("…and not at the next form of the same list", ownerTexts().filter((t) => /نموذج الطلب تتسع/.test(t)).length === 1);
}
{
  const env = world(`${DAY} 10:00`);
  const d = seed("x_price_day", { x_date: DAY, x_state: "published", x_utak_simulation: false, x_published_at: utc(`${DAY} 06:00`) });
  const r = await quiet(() => OF.sendOrderForm(env, c1));
  assert("a published list with no line (0 items): no form", r.sent === false && r.reason === "no_items" && flowsTo(C1_PHONE).length === 0 && d > 0, JSON.stringify(r));
  assert("a long name is cut to Meta's twenty characters; the hint keeps the packaging and the price", OF.orderSlotTexts("طماطم بلدي من مزارع القصيم الفاخرة", "كرتون 5 كيلو", 31.5, true).label.length === 20 && OF.orderSlotTexts("طماطم", "كرتون", 31.5, true).hint === "كرتون · السعر 31.50 ر.س شامل الضريبة" && OF.orderSlotTexts("[UTAK-VEG-001] طماطم", "", 31, false).label === "طماطم" && OF.orderSlotTexts("طماطم", "", 31, false).hint === "السعر 31 ر.س");
}

// ================================================================ [ج] no valid list
console.log("\n[ج] no valid list: no form — «الأسعار تتحدث…»");
{
  const env = world(`${NEXT} 07:00`); published(DAY);   // yesterday's list ended at 06:00, today's is not published
  const r = await quiet(() => OF.sendOrderForm(env, c1));
  assert("no form", r.sent === false && r.reason === "no_list" && flowsTo(C1_PHONE).length === 0, JSON.stringify(r));
  await say(env, C1_PHONE, text("اطلب"));
  assert("«اطلب»: he is told the prices are being updated and his written order is kept — and nothing else answers", flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).length === 1 && textsTo(C1_PHONE)[0] === OF.ORDER_FORM_NO_LIST_TEXT && /الأسعار تتحدث/.test(OF.ORDER_FORM_NO_LIST_TEXT), kinds(C1_PHONE));
}

// ================================================================ [ج] «إرسال»
console.log("\n[ج] «إرسال»: the quantities become his order at the list's prices, and the quotation follows as after «خلاص»");
{
  const env = world(`${DAY} 10:00`); published(DAY);
  await quiet(() => OF.sendOrderForm(env, c1));
  const token = tokenOf(flowsTo(C1_PHONE)[0]);
  graph.length = 0;
  await say(env, C1_PHONE, nfm(token, { q1: "3", q2: "", q3: "٢", q4: "0" }));
  const [o] = ordersOf();
  const l = linesOf(o.id);
  assert("one order of the ordering day, two lines: طماطم × 3 and بطاطس × 2 (an empty field and «0» are none)", ordersOf().length === 1 && l.length === 2 && l.find((x: any) => x.x_product_tmpl_id === 1)?.x_quantity === 3 && l.find((x: any) => x.x_product_tmpl_id === 3)?.x_quantity === 2, JSON.stringify(l.map((x: any) => [x.x_product_tmpl_id, x.x_quantity])));
  assert("its prices are frozen from the list (31 and 19), with the list's day on the order", l.find((x: any) => x.x_product_tmpl_id === 1)?.x_unit_price === 31 && l.find((x: any) => x.x_product_tmpl_id === 3)?.x_unit_price === 19 && o.x_price_date === DAY && o.x_order_date === DAY);
  assert("the order waits for his confirmation, with its quotation record", o.x_state === "waiting_confirmation" && rows("x_quotation").length === 1);
  const q = sentTo(C1_PHONE).filter((b: any) => b?.interactive?.type === "button");
  assert("he gets ONE message: the quotation with «تأكيد الطلب», «تعديل» and «إلغاء»", sentTo(C1_PHONE).length === 1 && q.length === 1 && JSON.stringify(buttonsOf(q[0])) === JSON.stringify([`confirm_order_${o.id}`, `edit_order_${o.id}`, `cancel_order_${o.id}`]), kinds(C1_PHONE));
  const b = bodyOf(q[0]);
  assert("…its lines with their amounts and the total: 3 × 31 = 93, 2 × 19 = 38, 131", /طماطم كرتون × 3 = 93 ر\.س/.test(b) && /بطاطس كرتون × 2 = 38 ر\.س/.test(b) && /المجموع: 131 ر\.س/.test(b), b);
  assert("…the delivery place and day, the VAT note and «السعر حسب أسعار اليوم…», as after «خلاص»", /التوصيل إلى: العليا/.test(b) && /التوصيل: صباح الأحد 4 أكتوبر 2026/.test(b) && /شاملة ضريبة القيمة المضافة/.test(b) && /السعر حسب أسعار اليوم، وأسعار بكرة ممكن تختلف\./.test(b));
  // confirm, as any quotation
  const c = await tap(env, `confirm_order_${o.id}`);
  assert("«تأكيد الطلب» confirms it as any quotation", /تم التأكيد/.test(String(c.text)) && table("x_daily_order").get(o.id)!.x_state === "confirmed", String(c.text));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج] the token: this number's, once, never the client's data");
{
  const env = world(`${DAY} 10:00`); published(DAY);
  openWindow(env, CUST2_PHONE);
  await quiet(() => OF.sendOrderForm(env, c1));
  const token = tokenOf(flowsTo(C1_PHONE)[0]);
  const other = await reply(env, CUST2_PHONE, token, { q1: "5" });
  assert("another number's reply with his token: nothing written, «هذا النموذج غير صالح…»", other.action === "unknown" && rows("x_daily_order").length === 0 && textsTo(CUST2_PHONE)[0] === OF.ORDER_FORM_UNKNOWN_TEXT);
  const none = await reply(env, C1_PHONE, "of1.20261003.501.deadbeef", { q1: "5" });
  assert("a token the worker never issued: nothing written", none.action === "unknown" && rows("x_daily_order").length === 0);
  const empty = await reply(env, C1_PHONE, token, { q1: "", q2: "" });
  assert("a form sent with no quantity: nothing written, he is told — and the form stays usable", empty.action === "empty" && rows("x_daily_order").length === 0 && textsTo(C1_PHONE).at(-1) === OF.ORDER_FORM_EMPTY_TEXT);
  const bad = await reply(env, C1_PHONE, token, { q1: "abc", q2: "-2", q9: "7", productId: 2, q3: "1.5" });
  assert("a field that is not a quantity is named; a slot the form did not carry (q9) is ignored; 1.5 cartons is a quantity", bad.action === "quoted" && linesOf(bad.orderId!).length === 1 && linesOf(bad.orderId!)[0].x_product_tmpl_id === 3 && linesOf(bad.orderId!)[0].x_quantity === 1.5 && /ما انحسبت[^\n]*طماطم، خيار/.test(bodyOf(sentTo(C1_PHONE).at(-1))), bodyOf(sentTo(C1_PHONE).at(-1)).slice(0, 160));
  const again = await reply(env, C1_PHONE, token, { q1: "9" });
  assert("the same token again: not written a second time", again.action === "duplicate" && ordersOf().length === 1 && linesOf(bad.orderId!).length === 1 && textsTo(C1_PHONE).at(-1) === OF.ORDER_FORM_USED_TEXT);
  assert("what a field holds", OF.parseOrderQty("3") === 3 && OF.parseOrderQty("٣") === 3 && OF.parseOrderQty(" 2,5 ") === 2.5 && OF.parseOrderQty("") === null && OF.parseOrderQty("0") === null && OF.parseOrderQty(undefined) === null && OF.parseOrderQty("-1") === "invalid" && OF.parseOrderQty("x") === "invalid" && OF.parseOrderQty("10000") === "invalid" && OF.parseOrderQty("9999") === 9999);
}

console.log("\n[ج] the list expired (a price is valid for one day): the old form writes nothing, a new one goes with the new prices");
{
  const env = world(`${DAY} 10:00`); published(DAY);
  await quiet(() => OF.sendOrderForm(env, c1));
  const token = tokenOf(flowsTo(C1_PHONE)[0]);
  // the next morning: yesterday's list ended at 06:00 and today's is published at other prices
  setRiyadh(`${NEXT} 08:00`); openWindow(env, C1_PHONE);
  published(NEXT, [[1, 11, 35], [2, 21, 30]]);
  graph.length = 0;
  const r = await reply(env, C1_PHONE, token, { q1: "3" });
  const f = flowsTo(C1_PHONE);
  assert("no order, no line, no quotation from the old form", r.action === "expired" && rows("x_daily_order").length === 0 && rows("x_quotation").length === 0);
  assert("a NEW form goes at once, saying why, with today's prices (35) and today's two items", f.length === 1 && bodyOf(f[0]) === OF.ORDER_FORM_EXPIRED_TEXT && dataOf(f[0]).h1 === "كرتون · السعر 35 ر.س شامل الضريبة" && dataOf(f[0]).v3 === false && tokenOf(f[0]) !== token, bodyOf(f[0]));
  const ok = await reply(env, C1_PHONE, tokenOf(f[0]), { q1: "3" });
  assert("…and ITS reply is taken at the new price", ok.action === "quoted" && linesOf(ok.orderId!)[0].x_unit_price === 35 && table("x_daily_order").get(ok.orderId!)!.x_price_date === NEXT);
}
{
  const env = world(`${DAY} 10:00`); published(DAY);
  await quiet(() => OF.sendOrderForm(env, c1));
  const token = tokenOf(flowsTo(C1_PHONE)[0]);
  setRiyadh(`${NEXT} 07:00`); openWindow(env, C1_PHONE);
  graph.length = 0;
  const r = await reply(env, C1_PHONE, token, { q1: "3" });
  assert("expired and no list valid yet: nothing written, no form — he is told the prices are being updated", r.action === "expired" && rows("x_daily_order").length === 0 && flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE)[0] === OF.ORDER_FORM_EXPIRED_NO_LIST_TEXT, kinds(C1_PHONE));
}

// ================================================================ [ج] «تعديل» and «إلغاء»
console.log("\n[ج] «تعديل» under a quotation the form made opens the form with the quantities sent");
{
  const env = world(`${DAY} 10:00`); published(DAY);
  await quiet(() => OF.sendOrderForm(env, c1));
  const first = await reply(env, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), { q1: "3", q3: "2" });
  const id = first.orderId!;
  graph.length = 0;
  const e = await tap(env, `edit_order_${id}`);
  const f = flowsTo(C1_PHONE);
  assert("the form again, under «عدّل الطلب», opened with 3 and 2 — and no text asking him to write the change", f.length === 1 && par(f[0]).flow_cta === OF.ORDER_FORM_EDIT_CTA && dataOf(f[0]).i1 === "3" && dataOf(f[0]).i3 === "2" && dataOf(f[0]).i2 === "" && !String(e.text ?? "").trim() && bodyOf(f[0]) === OF.orderFormEditText(id), JSON.stringify([e.text, dataOf(f[0]).i1, dataOf(f[0]).i3]));
  assert("the order is open again (draft)", table("x_daily_order").get(id)!.x_state === "draft");
  // more of one, a new item: the same order, its lines written
  const second = await reply(env, C1_PHONE, tokenOf(f[0]), { q1: "5", q3: "2", q2: "1" });
  const l = linesOf(id);
  assert("5 instead of 3 and a new item: the SAME order, three lines, a new quotation at the list's prices", second.action === "quoted" && second.orderId === id && ordersOf().length === 1 && l.length === 3 && l.find((x: any) => x.x_product_tmpl_id === 1).x_quantity === 5 && l.find((x: any) => x.x_product_tmpl_id === 2).x_unit_price === 28.5 && table("x_daily_order").get(id)!.x_state === "waiting_confirmation");
  assert("…its total 5 × 31 + 2 × 19 + 1 × 28.50 = 221.50", /المجموع: 221\.50 ر\.س/.test(bodyOf(sentTo(C1_PHONE).at(-1))), bodyOf(sentTo(C1_PHONE).at(-1)));
  // an emptied field: that item leaves the order — nothing is deleted
  graph.length = 0;
  unlock(env, id);
  await tap(env, `edit_order_${id}`);
  const before = rows("x_daily_order_line").length;
  const third = await reply(env, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), { q1: "5", q3: "", q2: "1" });
  assert("a field emptied in «تعديل»: the order is closed (cancelled, its lines kept) and a NEW order carries what remains", third.action === "quoted" && third.orderId !== id && table("x_daily_order").get(id)!.x_state === "cancelled" && linesOf(id).length === 3 && rows("x_daily_order_line").length === before + 2
    && linesOf(third.orderId!).length === 2 && !linesOf(third.orderId!).some((x: any) => x.x_product_tmpl_id === 3), JSON.stringify(linesOf(third.orderId!).map((x: any) => [x.x_product_tmpl_id, x.x_quantity])));
  assert("…he is told which order was closed and which is his now", new RegExp(`الطلب رقم #${id} أُغلق، وهذا طلبك رقم #${third.orderId}`).test(bodyOf(sentTo(C1_PHONE).at(-1))), bodyOf(sentTo(C1_PHONE).at(-1)).slice(0, 120));
  // «إلغاء»
  const c = await tap(env, `cancel_order_${third.orderId}`);
  assert("«إلغاء» cancels it as any quotation", /تم الإلغاء/.test(String(c.text)) && table("x_daily_order").get(third.orderId!)!.x_state === "cancelled");
}
{
  const env = world(`${DAY} 10:00`); published(DAY);
  await quiet(() => OF.sendOrderForm(env, c1));
  const first = await reply(env, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), { q1: "3" });
  graph.length = 0;
  await tap(env, `edit_order_${first.orderId}`);
  const gone = await reply(env, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), { q1: "" });
  assert("every field emptied: the order is cancelled, no new one", gone.action === "closed" && table("x_daily_order").get(first.orderId!)!.x_state === "cancelled" && ordersOf().length === 1 && /أُلغي طلبك/.test(textsTo(C1_PHONE).at(-1) ?? ""), textsTo(C1_PHONE).at(-1));
}
{
  const env = world(`${DAY} 10:00`); published(DAY);
  await orderText(env, "طماطم كرتون 3", [{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 }]);
  const k = await quiet(() => dispatch(env, { msg: { from: "+" + C1_PHONE, messageId: "m-kh", type: "text", text: "خلاص", timestamp: "0" } as any, intent: "request_quotation" as any, senderType: "customer", partner: partnerOf(C1) as any }));
  const id = ordersOf()[0].id;
  graph.length = 0;
  const e = await tap(env, `edit_order_${id}`);
  assert("«تعديل» under a quotation made by text and «خلاص» stays as it was: the text, no form", /الكوتيشن/.test(String(k.bodyBeforeButtons)) && /تفضّل، عدّل/.test(String(e.text)) && flowsTo(C1_PHONE).length === 0, String(e.text));
}
{
  const env = world(`${DAY} 10:00`); published(DAY);
  await quiet(() => OF.sendOrderForm(env, c1));
  const first = await reply(env, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), { q1: "3" });
  graph.length = 0;
  await tap(env, `edit_order_${first.orderId}`);
  const token = tokenOf(flowsTo(C1_PHONE)[0]);
  table("x_daily_order").get(first.orderId!)!.x_state = "confirmed";   // confirmed meanwhile (Baraa, in Odoo)
  const late = await reply(env, C1_PHONE, token, { q1: "9" });
  assert("the order moved on before the form came back: its lines are not touched", late.action === "closed" && linesOf(first.orderId!)[0].x_quantity === 3 && ordersOf().length === 1 && textsTo(C1_PHONE).at(-1) === OF.ORDER_FORM_CLOSED_TEXT(first.orderId!));
}

// ================================================================ [ج] when it goes
console.log("\n[ج] «اطلب» / «أبي أطلب»: the form, and nothing else answers");
{
  assert("the words that ask for it — the whole message", ["اطلب", "أطلب", "أبي أطلب", "ابي اطلب", "أبغى أطلب", "ابغى اطلب", "بطلب", "أبي أطلب الآن", "اطلب."].every((t) => OF.wantsOrderForm(t)) && !["اطلب طماطم 3", "طلب", "أبي أطلب طماطم", "ما أطلب", "", "خلاص"].some((t) => OF.wantsOrderForm(t)));
  const env = world(`${DAY} 10:00`); published(DAY);
  await say(env, C1_PHONE, text("أبي أطلب"));
  const f = flowsTo(C1_PHONE);
  assert("one message: the form, under «اطلب الآن» — no classifier reply, no order made", sentTo(C1_PHONE).length === 1 && f.length === 1 && par(f[0]).flow_cta === "اطلب الآن" && rows("x_daily_order").length === 0 && /اضغط «اطلب الآن» واكتب عدد الكراتين/.test(bodyOf(f[0])), kinds(C1_PHONE));
  await say(env, C1_PHONE, text("اطلب"));
  assert("asked again: again (what he asks for is not capped)", flowsTo(C1_PHONE).length === 2);
  graph.length = 0;
  const b = await tap(env, "أبغى أطلب");
  assert("the welcome's «أبغى أطلب» button: the form, and no text", flowsTo(C1_PHONE).length === 1 && !String(b.text ?? "").trim());
}

console.log("\n[ج] the first order message of the list's day: the text order as before, then the form with what he wrote");
{
  const env = world(`${DAY} 10:00`); published(DAY);
  setExtract({ intent: "place_order", confidence: 0.9 });
  const real = globalThis.fetch;
  let call = 0;
  // the classifier answers «place_order», then the extractor the items
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("anthropic.com")) {
      const out = call++ % 2 === 0 ? { intent: "place_order", confidence: 0.95 } : [{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 }];
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }), { status: 200 });
    }
    return real(input as any, init);
  }) as typeof fetch;
  await say(env, C1_PHONE, text("طماطم كرتون 3"));
  const got = sentTo(C1_PHONE);
  const f = flowsTo(C1_PHONE);
  assert("the reply of before first («بديت لك طلب جديد ✅ … اكتب خلاص»), then ONE form", got.length === 2 && /بديت لك طلب جديد/.test(bodyOf(got[0])) && /خلاص/.test(bodyOf(got[0])) && f.length === 1 && got[1] === f[0], kinds(C1_PHONE));
  assert("…opened with his 3 cartons, on his order", dataOf(f[0]).i1 === "3" && bodyOf(f[0]) === OF.ORDER_FORM_FOLLOW_TEXT && ordersOf().length === 1 && linesOf(ordersOf()[0].id).length === 1);
  await say(env, C1_PHONE, text("طماطم كرتون 3"));
  assert("a second order message the same day: the reply, and no second form", flowsTo(C1_PHONE).length === 1 && sentTo(C1_PHONE).length === 3, kinds(C1_PHONE));
  globalThis.fetch = real; setExtract(null);
  const written = ordersOf()[0].id;
  assert("his two messages left two lines of طماطم (3 and 3) on the order", linesOf(written).filter((x: any) => x.x_product_tmpl_id === 1).length === 2);
  const done1 = await reply(env, C1_PHONE, tokenOf(f[0]), { q1: "4", q2: "2" });
  const l = linesOf(done1.orderId!);
  assert("«إرسال»: the form is the whole order — طماطم is 4 (not 3 + 3, not 3 + 3 + 4) and خيار 2 — with its quotation", done1.action === "quoted" && JSON.stringify(l.map((x: any) => [x.x_product_tmpl_id, x.x_quantity]).sort()) === JSON.stringify([[1, 4], [2, 2]]) && table("x_daily_order").get(done1.orderId!)!.x_state === "waiting_confirmation", JSON.stringify(l.map((x: any) => [x.x_product_tmpl_id, x.x_quantity])));
  assert("…the order of two lines for one item could not be set in place (nothing is deleted): it is closed, and ONE open order remains", done1.orderId !== written && table("x_daily_order").get(written)!.x_state === "cancelled" && ordersOf().filter((o: any) => o.x_state !== "cancelled").length === 1);
}

console.log("\n[ج] with the 06:00 prices: «اطلب الآن» to a customer whose window is open, once");
{
  const env = world(`${DAY} 06:00`);
  const d = seed("x_price_day", { x_date: DAY, x_state: "approved", x_name: `أسعار اليوم ${DAY}`, x_utak_simulation: false, x_approved_at: utc(`${DAY} 05:59`) });
  for (const [p, k, price] of [[1, 11, 31], [2, 21, 28.5]] as Array<[number, number, number]>) seed("x_price_day_line", { x_day_id: d, x_sequence: p, x_product_tmpl_id: p, x_packaging_id: k, x_cost_price: 15, x_market_price: price, x_sale_price: price, x_status: "auto", x_excluded: false, x_blocked: false, x_suggested_price: 20, x_utak_simulation: false });
  const pub = await quiet(() => PR.publishPriceDay(env, d));
  const got = sentTo(C1_PHONE);
  assert("the customer in session: the list, then the form under «اطلب الآن»", pub.action === "published" && pub.forms === 1 && got.length === 2 && /أسعار يو تاك اليوم/.test(bodyOf(got[0])) && got[1]?.interactive?.type === "flow" && par(got[1]).flow_cta === "اطلب الآن" && bodyOf(got[1]) === OF.ORDER_FORM_PRICES_TEXT, kinds(C1_PHONE));
  assert("…with the published prices", dataOf(got[1]).h1 === "كرتون · السعر 31 ر.س شامل الضريبة" && dataOf(got[1]).v2 === true && dataOf(got[1]).v3 === false);
  assert("the customer whose window is closed: his list is held for his next message — no form, no template", flowsTo(CUST2_PHONE).length === 0 && sentTo(CUST2_PHONE).length === 0 && heldFor(env, CUST2_PHONE).length === 1 && !heldFor(env, CUST2_PHONE).some((h: any) => h.purpose === "customer_order_form"), JSON.stringify(heldFor(env, CUST2_PHONE).map((h: any) => h.purpose)));
  assert("the form is never held and never a template: nothing of its purpose waits anywhere", [C1_PHONE, CUST2_PHONE].every((x) => !heldFor(env, x).some((h: any) => h.purpose === "customer_order_form")) && !sentTo(C1_PHONE).some((b: any) => b.type === "template"));
  // his form's reply is taken (the day is published by then)
  const r = await reply(env, C1_PHONE, tokenOf(got[1]), { q1: "2" });
  assert("its reply is taken at the published price", r.action === "quoted" && linesOf(r.orderId!)[0].x_unit_price === 31);
  // his first order message later that day: no second form
  const after = await orderText(env, "خيار جرم 1", [{ product_id: 2, product_name_raw: "خيار", packaging_id: 21, quantity: 1 }]);
  assert("the reply to a text order names the form to follow", !!after.orderForm && after.orderForm.partnerId === C1);
  const auto = await quiet(() => OF.offerOrderForm(env, c1, { auto: true }));
  assert("…but it went with the 06:00 prices already: not a second time for this list", auto.sent === false && auto.reason === "sent_before", JSON.stringify(auto));
}

// ================================================================ [ج] to whom it never goes
console.log("\n[ج] never to a price source, a supplier, the team or Baraa");
{
  const env = world(`${DAY} 10:00`); published(DAY);
  for (const d of [RAED_PHONE, AHMED_PHONE, DRIVER_PHONE, OWNER]) openWindow(env, d, 1);
  const raed = await quiet(() => OF.sendOrderForm(env, { partnerId: RAED, name: "رائد", whatsapp: "+" + RAED_PHONE }));
  const ahmed = await quiet(() => OF.sendOrderForm(env, { partnerId: AHMED, name: "أحمد حسان", whatsapp: "+" + AHMED_PHONE }));
  const omar = await quiet(() => OF.sendOrderForm(env, { partnerId: 603, name: "عمر", whatsapp: "+" + DRIVER_PHONE }));
  const baraa = await quiet(() => OF.sendOrderForm(env, { partnerId: 1, name: "براء", whatsapp: "+" + OWNER }));
  assert("رائد (a price source) and أحمد (a supplier): refused by the gateway («PricePrivacy»), their windows open", !raed.sent && /PricePrivacy/.test(String(raed.reason)) && !ahmed.sent && /PricePrivacy/.test(String(ahmed.reason)), JSON.stringify([raed, ahmed]));
  assert("عمر (the team) and Baraa: not even prepared", omar.sent === false && omar.reason === "team" && baraa.sent === false && baraa.reason === "owner", JSON.stringify([omar, baraa]));
  assert("nothing reached any of them, and no token is left for them", [RAED_PHONE, AHMED_PHONE, DRIVER_PHONE].every((d) => sentTo(d).length === 0) && flowsTo(OWNER).length === 0 && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("oform:v1:")));
  // a source that writes «اطلب» is an outside source, not a customer
  await say(env, RAED_PHONE, text("اطلب"));
  assert("رائد writes «اطلب»: no form — the outside source's answer", flowsTo(RAED_PHONE).length === 0 && rows("x_daily_order").length === 0, kinds(RAED_PHONE));
  await say(env, AHMED_PHONE, text("اطلب"));
  await say(env, DRIVER_PHONE, text("اطلب"));
  assert("أحمد and عمر write «اطلب»: no form either", flowsTo(AHMED_PHONE).length === 0 && flowsTo(DRIVER_PHONE).length === 0 && rows("x_daily_order").length === 0);
  // the roster unreadable: nothing goes
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/hr.employee/")) return new Response("{}", { status: 500 });
    return real(input as any, init);
  }) as typeof fetch;
  env.MSG_DEDUP.store.forEach((_v: unknown, k: string) => { if (/roster/i.test(k)) env.MSG_DEDUP.store.delete(k); });
  const blind = await quiet(() => OF.sendOrderForm(env, c1));
  globalThis.fetch = real;
  assert("the roster cannot be read: no form (the team is never guessed to be a customer)", blind.sent === false && blind.reason === "unverified" && flowsTo(C1_PHONE).length === 0, JSON.stringify(blind));
  const closed = await quiet(() => OF.sendOrderForm(env, { ...c1, whatsapp: "+" + CUST2_PHONE }));
  assert("a customer whose window is closed: nothing — no template, nothing held", closed.sent === false && closed.reason === "window_closed" && sentTo(CUST2_PHONE).length === 0 && heldFor(env, CUST2_PHONE).length === 0, JSON.stringify(closed));
}

// ================================================================ [ج] the trial
console.log("\n[ج] the one trial to Baraa: marked «🧪 تجربة», inside his window, once a day, no order created");
{
  const env = world(`${DAY} 23:30`); published(DAY);
  openWindow(env, OWNER, 1);
  const t = await quiet(() => OF.sendOrderFormTest(env));
  const f = flowsTo(OWNER);
  assert("one form to his own number, marked in its text and its heading", t.sent === true && f.length === 1 && bodyOf(f[0]).startsWith("🧪 تجربة") && String(dataOf(f[0]).t1).startsWith("🧪 تجربة") && dataOf(f[0]).h1 === "كرتون · السعر 31 ر.س شامل الضريبة", bodyOf(f[0]));
  const again = await quiet(() => OF.sendOrderFormTest(env));
  assert("a second trial the same day: not sent", again.sent === false && again.reason === "already_today" && flowsTo(OWNER).length === 1);
  graph.length = 0;
  await say(env, OWNER, nfm(tokenOf(f[0]), { q1: "3", q2: "2" }));
  const ans = sentTo(OWNER);
  assert("his reply is answered — «وصل طلبك: طماطم كرتون × 3، خيار جرم × 2. المجموع 150 ر.س» — and says it was a trial", ans.length === 1 && /🧪 تجربة — وصل طلبك: طماطم كرتون × 3، خيار جرم × 2\. المجموع 150 ر\.س/.test(bodyOf(ans[0])) && /لم يُنشأ طلب/.test(bodyOf(ans[0])), bodyOf(ans[0]));
  assert("NO order, no line, no quotation, no partner made", rows("x_daily_order").length === 0 && rows("x_daily_order_line").length === 0 && rows("x_quotation").length === 0);
}
{
  const env = world(`${NEXT} 23:30`); published(DAY);   // no list is valid tonight
  openWindow(env, OWNER, 1);
  const t = await quiet(() => OF.sendOrderFormTest(env));
  assert("no valid list tonight: the trial shows the last published list (it creates nothing)", t.sent === true && flowsTo(OWNER).length === 1 && dataOf(flowsTo(OWNER)[0]).l1 === "طماطم", JSON.stringify(t));
  const closedEnv = world(`${DAY} 23:30`); published(DAY);
  closedEnv.MSG_DEDUP.store.delete(`wa_win:v1:${OWNER}`);
  const c = await quiet(() => OF.sendOrderFormTest(closedEnv));
  assert("his window closed: no trial (nothing held, no template)", c.sent === false && c.reason === "window_closed" && sentTo(OWNER).length === 0);
}

// ================================================================ [ج] the map
console.log("\n[ج] the purposes and the code's own words");
{
  const purposes = (await import("../src/wa-purposes.ts")).PURPOSES;
  assert("customer_order_form is operational and carries our sale prices; order_flow_test is the owner's", purposes.customer_order_form?.kind === "operational" && purposes.order_flow_test?.kind === "operational" && (await import("../src/price-privacy.ts")).CUSTOMER_PRICE_PURPOSES.has(OF.ORDER_FORM_PURPOSE));
  const env = world(`${DAY} 10:00`);
  openWindow(env, C1_PHONE);
  const d = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: "order_flow_test", to: "+" + C1_PHONE, content: { kind: "session", body: { type: "text", text: { body: "x" } } } })));
  assert("the trial's purpose reaches Baraa's number alone", d?.action === "refused" && /OwnerOnlyPurpose/.test(String((d as any).reason)));
  assert("the Flow's id in the worker is the one Meta gave", /^\d{15,16}$/.test(OF.ORDER_FLOW_ID) && srcOf("order-form.ts").includes(`export const ORDER_FLOW_ID = "${OF.ORDER_FLOW_ID}"`));
}

// ================================================================ [د] the registration form
const RF = await import("../src/register-form.ts");
const VA = await import("../src/vat-ask.ts");
const NEWC = 520, NEWC_PHONE = "966500000520";
const VAT_OK = "310123456700003";
/** A NEW customer (created after § 53's deployment), his window open; the customer of before carries an older create_date. */
function regWorld(riyadh = `${DAY} 10:00`): any {
  const env = world(riyadh);
  Object.assign(table("res.partner").get(C1)!, { create_date: "2026-09-20 08:00:00", x_vat_status: "unknown", vat: false, x_vat_ask_count: 0 });
  seed("res.partner", { id: NEWC, name: "أبو فهد", x_whatsapp_number: "+" + NEWC_PHONE, customer_rank: 1, x_contact_class: "customer", create_date: "2026-10-05 07:00:00", x_vat_status: "unknown", vat: false, x_vat_ask_count: 0 });
  openWindow(env, NEWC_PHONE);
  return env;
}
const newc = { partnerId: NEWC, whatsapp: "+" + NEWC_PHONE };
const regFlows = (d: string) => flowsTo(d).filter((b: any) => par(b).flow_id === RF.REGISTER_FLOW_ID);
const orderFlows = (d: string) => flowsTo(d).filter((b: any) => par(b).flow_id === OF.ORDER_FLOW_ID);
const regReply = (env: any, from: string, token: string, values: Record<string, unknown>) =>
  quiet(() => RF.handleRegisterFormReply(env, { from: "+" + from, messageId: `wamid.G${++wamid}`, flow: { token, values } }));
const partner = (id: number) => table("res.partner").get(id)! as any;
const FULL = { shop: "عصائر الريان", activity: "juice", contact: "فهد العتيبي", legal: "مؤسسة الريان التجارية", vat: VAT_OK, district: "الملز" };
/** The classifier answers `intent`, then the extractor `items` (the webhook asks both for a text). */
function withClaude<T>(intent: string, items: unknown, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("anthropic.com")) return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(n++ % 2 === 0 ? { intent, confidence: 0.95 } : items) }] }), { status: 200 });
    return real(input as any, init);
  }) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = real; });
}
const TOMATO3 = [{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 }];

console.log("\n[د] utak_register_v1 at Meta is the form the worker fills: one screen, no endpoint");
{
  const json = LIB.buildRegisterFlowJson();
  const kids = json.screens[0].layout.children;
  const inputs = kids.filter((c: any) => c.type === "TextInput");
  const drop = kids.find((c: any) => c.type === "Dropdown");
  assert("one screen REGISTER, terminal, and no endpoint", json.screens.length === 1 && json.screens[0].id === RF.REGISTER_FLOW_SCREEN && json.screens[0].terminal === true && json.data_api_version === undefined && LIB.REGISTER_FLOW_NAME === "utak_register_v1");
  assert("its fields in order: اسم المحل (required), النشاط, اسم المسؤول, الاسم النظامي, الرقم الضريبي, الحي", JSON.stringify(kids.filter((c: any) => c.type === "TextInput" || c.type === "Dropdown").map((c: any) => [c.name, c.label, c.required])) === JSON.stringify([["shop", "اسم المحل", true], ["activity", "النشاط", false], ["contact", "اسم المسؤول", false], ["legal", "الاسم النظامي", false], ["vat", "الرقم الضريبي", false], ["district", "الحي", false]]));
  assert("the legal name and the VAT number say they are optional, and the VAT number its rule", /اختياري/.test(inputs.find((c: any) => c.name === "legal")["helper-text"]) && /اختياري — 15 رقماً يبدأ وينتهي بـ 3/.test(inputs.find((c: any) => c.name === "vat")["helper-text"]) && inputs.find((c: any) => c.name === "vat")["input-type"] === "number");
  assert("every label holds in Meta's twenty characters", kids.every((c: any) => !c.label || [...c.label].length <= 20));
  assert("the activity's choices: بقالة / تموينات, مطعم, محل عصير, فندق / تموين, أخرى — the worker's, each a customer type of the tenant", JSON.stringify(drop["data-source"].map((o: any) => o.title)) === JSON.stringify(["بقالة / تموينات", "مطعم", "محل عصير", "فندق / تموين", "أخرى"])
    && JSON.stringify(Object.fromEntries(drop["data-source"].map((o: any) => [o.id, o.title]))) === JSON.stringify(RF.REGISTER_ACTIVITIES)
    && drop["data-source"].every((o: any) => JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20261004-s53.json", import.meta.url), "utf8"))._selections["res.partner.x_customer_type"].includes(o.id)));
  assert("«إرسال» completes with the six fields", kids.at(-1).type === "Footer" && kids.at(-1).label === "إرسال" && JSON.stringify(Object.keys(kids.at(-1)["on-click-action"].payload)) === JSON.stringify(["shop", "activity", "contact", "legal", "vat", "district"]));
  assert("every key the worker sends is declared on the screen, and every declared key is sent", JSON.stringify(Object.keys(RF.registerFormData("x")).sort()) === JSON.stringify(Object.keys(json.screens[0].data).sort()) && Object.values(RF.registerFormData("x", { shop: "أ" })).every((v) => typeof v === "string"));
}

console.log("\n[د] the VAT number is § 44's: 15 digits, the first and the last «3»");
{
  const ok = (vat: string) => RF.parseRegisterValues({ shop: "محل", vat });
  assert("a valid number, in Western or Arabic digits, with spaces", ok(VAT_OK).vat === VAT_OK && ok("٣١٠١٢٣٤٥٦٧٠٠٠٠٣").vat === VAT_OK && ok(" 3101 2345 6700 003 ").vat === VAT_OK && ok(VAT_OK).problems.length === 0);
  assert("14 or 16 digits, a first or a last digit that is not 3, letters: refused", ["31012345670003", "3101234567000033", "210123456700003", "310123456700004", "31012345670000A", "abc"].every((v) => ok(v).problems.join() === "vat" && ok(v).vat === ""));
  assert("no number at all is no problem (the field is optional)", ok("").problems.length === 0 && ok("").vat === "" && ok("   ").problems.length === 0);
  assert("the same rule as the text question's (src/vat-ask.ts parseVatNumber)", VA.parseVatNumber(VAT_OK) === VAT_OK && VA.parseVatNumber("310123456700004") === null);
  assert("the shop's name is required; an activity that is not in the list is none", RF.parseRegisterValues({ shop: "  " }).problems.join() === "shop" && RF.parseRegisterValues({ shop: "محل", activity: "bakery" }).values.activity === "" && RF.parseRegisterValues({ shop: "محل", activity: "juice" }).values.activity === "juice");
  assert("with a number: «مسجّل»; without: «غير مسجّل» and no number written", RF.registerVals(RF.parseRegisterValues(FULL)).x_vat_status === "registered" && RF.registerVals(RF.parseRegisterValues(FULL)).vat === VAT_OK && RF.registerVals(RF.parseRegisterValues({ shop: "محل" })).x_vat_status === "not_registered" && !("vat" in RF.registerVals(RF.parseRegisterValues({ shop: "محل" }))));
}

console.log("\n[د] a NEW customer's first purchase-like message: his reply, then the registration form — once");
{
  const env = regWorld(); published(DAY);
  await withClaude("place_order", TOMATO3, () => say(env, NEWC_PHONE, text("طماطم كرتون 3")));
  const got = sentTo(NEWC_PHONE);
  const f = regFlows(NEWC_PHONE);
  assert("the reply of before, then ONE form under «سجّل محلك»", got.length === 2 && /بديت لك طلب جديد/.test(bodyOf(got[0])) && f.length === 1 && got[1] === f[0] && par(f[0]).flow_cta === "سجّل محلك" && par(f[0]).flow_action_payload.screen === "REGISTER" && bodyOf(f[0]) === RF.REGISTER_FIRST_TEXT, kinds(NEWC_PHONE));
  assert("…one form at a time: the order form waits for his next message", orderFlows(NEWC_PHONE).length === 0);
  assert("the form opens empty, with its line above the fields", dataOf(f[0]).note === RF.REGISTER_NOTE && dataOf(f[0]).i_shop === "" && dataOf(f[0]).i_vat === "");
  await withClaude("place_order", TOMATO3, () => say(env, NEWC_PHONE, text("طماطم كرتون 3")));
  assert("his second order message: no second registration form (the order form follows now)", regFlows(NEWC_PHONE).length === 1 && orderFlows(NEWC_PHONE).length === 1, kinds(NEWC_PHONE));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}
{
  const env = regWorld(); published(DAY);
  await withClaude("greeting", [], () => say(env, NEWC_PHONE, text("السلام عليكم")));
  assert("a greeting is not a purchase: no form yet", regFlows(NEWC_PHONE).length === 0 && sentTo(NEWC_PHONE).length === 1, kinds(NEWC_PHONE));
}

console.log("\n[د] a customer of before (#31, #105: created before § 53) never gets it");
{
  const env = regWorld(); published(DAY);
  await withClaude("place_order", TOMATO3, () => say(env, C1_PHONE, text("طماطم كرتون 3")));
  assert("his first order message: the reply and the order form — no registration form", regFlows(C1_PHONE).length === 0 && orderFlows(C1_PHONE).length === 1, kinds(C1_PHONE));
  assert("…and it is remembered: his next messages cost no read", env.MSG_DEDUP.store.get(`rform_first:v1:${C1}`) === "before" && (await quiet(() => RF.registerFormDue(env, C1))) === false);
  const st = await quiet(() => RF.readRegisterState(env, C1));
  assert("he is not «new» (created 2026-09-20); a customer created 2026-10-05 is", st?.isNew === false && (await quiet(() => RF.readRegisterState(env, NEWC)))?.isNew === true && RF.REGISTER_NEW_SINCE_UTC === "2026-10-04 20:00:00");
  // his confirmed order: § 44's question, as before
  const ask = await quiet(() => VA.maybeAskVat(env, C1, 1));
  assert("after his confirmed order he is asked § 44's question in text, with «نعم» / «لا» — not the form", !!ask && !ask.registerForm && (ask.buttons ?? []).length === 2 && /ضريبة القيمة المضافة/.test(String(ask.bodyBeforeButtons)), JSON.stringify(ask));
}

console.log("\n[د] a NEW customer's confirmed order: the form in place of § 44's question");
{
  const env = regWorld(); published(DAY);
  table("res.partner").get(NEWC)!.x_delivery_neighborhood = "الملز";
  const order = seed("x_daily_order", { x_customer_id: NEWC, x_state: "waiting_confirmation", x_order_date: DAY, x_price_date: DAY, x_created_via: "whatsapp", x_delivery_neighborhood: "الملز" });
  seed("x_daily_order_line", { x_order_id: order, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 3, x_unit_price: 31, x_status: "pending" });
  await say(env, NEWC_PHONE, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `confirm_order_${order}`, title: "تأكيد الطلب ✅" } } });
  const got = sentTo(NEWC_PHONE);
  const f = regFlows(NEWC_PHONE);
  assert("the confirmation, then the registration form — and no «هل منشأتك مسجلة…» question", table("x_daily_order").get(order)!.x_state === "confirmed" && /تم التأكيد/.test(bodyOf(got[0])) && f.length === 1 && bodyOf(f[0]) === RF.REGISTER_VAT_TEXT && !got.some((b: any) => /هل منشأتك مسجلة/.test(bodyOf(b))), kinds(NEWC_PHONE));
  assert("it counts as an ask (1 of 3), and no text step is opened", partner(NEWC).x_vat_ask_count === 1 && !env.MSG_DEDUP.store.get(VA.vatKey(NEWC)));
  partner(NEWC).x_vat_ask_count = 3;
  assert("after three asks: nothing more", (await quiet(() => VA.maybeAskVat(env, NEWC, 999))) === null);
}

console.log("\n[د] «إرسال»: ONE write on his card, in the fields that exist");
{
  const env = regWorld();
  await quiet(() => RF.sendRegisterForm(env, newc));
  const token = tokenOf(regFlows(NEWC_PHONE)[0]);
  graph.length = 0;
  const before = JSON.stringify(partner(NEWC));
  await say(env, NEWC_PHONE, nfm(token, FULL));
  const p = partner(NEWC);
  assert("the shop's name is his name; the activity, the person in charge, the legal name and the district on their fields", p.name === "عصائر الريان" && p.x_customer_type === "juice" && p.x_contact_name === "فهد العتيبي" && p.x_legal_name === "مؤسسة الريان التجارية" && p.x_delivery_neighborhood === "الملز" && p.street === "الملز", JSON.stringify([p.name, p.x_customer_type, p.x_contact_name, p.x_legal_name, p.x_delivery_neighborhood, p.street]));
  assert("the VAT number and «مسجّل» (§ 44's fields)", p.vat === VAT_OK && p.x_vat_status === "registered" && before !== JSON.stringify(p));
  const texts = textsTo(NEWC_PHONE);
  assert("he is told, and asked for the delivery location by an ordinary message, as today", texts.length === 1 && texts[0].startsWith("تم تسجيل محلك ✅ عصائر الريان") && texts[0].includes(RF.REGISTER_LOCATION_ASK), texts[0]);
  assert("Baraa gets one line: the shop, the activity, the person, the district, the VAT number", ownerTexts().some((t) => /عميل سجّل محله من النموذج: عصائر الريان/.test(t) && /محل عصير/.test(t) && /فهد العتيبي/.test(t) && /الملز/.test(t) && t.includes(VAT_OK)));
  assert("after it he is not asked about the VAT again (text or form)", (await quiet(() => VA.maybeAskVat(env, NEWC, 5))) === null && (await quiet(() => RF.registerFormDue(env, NEWC))) === false);
  // the location, as today
  graph.length = 0;
  await say(env, NEWC_PHONE, { type: "location", location: { latitude: 24.69, longitude: 46.72, name: "الملز" } });
  assert("his location message is saved as today", /حفظنا موقعك للتوصيل/.test(textsTo(NEWC_PHONE)[0] ?? "") && Number(p.x_delivery_latitude) === 24.69, textsTo(NEWC_PHONE)[0]);
  // the same token again
  graph.length = 0;
  const again = await regReply(env, NEWC_PHONE, token, { ...FULL, shop: "اسم آخر" });
  assert("the same form again: not written a second time", again.action === "duplicate" && partner(NEWC).name === "عصائر الريان" && textsTo(NEWC_PHONE)[0] === RF.REGISTER_USED_TEXT);
  assert("no field rejected by the schema gate (x_contact_name and «juice» are on the tenant)", rejected.length === 0, rejected.join(" | "));
}
{
  const env = regWorld();
  await quiet(() => RF.sendRegisterForm(env, newc));
  const r = await regReply(env, NEWC_PHONE, tokenOf(regFlows(NEWC_PHONE)[0]), { shop: "بقالة السلام", activity: "grocery", contact: "", legal: "", vat: "", district: "" });
  const p = partner(NEWC);
  assert("only the shop's name and its activity, no VAT number: «غير مسجّل», no number, nothing else touched", r.action === "saved" && p.name === "بقالة السلام" && p.x_customer_type === "grocery" && p.x_vat_status === "not_registered" && !p.vat && !p.x_contact_name && !p.x_legal_name && !p.street);
  assert("…and he is not asked again", (await quiet(() => VA.maybeAskVat(env, NEWC, 5))) === null);
}

console.log("\n[د] a VAT number that is not one: nothing is written, the form opens again with what he typed");
{
  const env = regWorld();
  await quiet(() => RF.sendRegisterForm(env, newc));
  const token = tokenOf(regFlows(NEWC_PHONE)[0]);
  graph.length = 0;
  const bad = await regReply(env, NEWC_PHONE, token, { ...FULL, vat: "310123456700004" });
  const f = regFlows(NEWC_PHONE);
  const p = partner(NEWC);
  assert("nothing on his card (not the name, not the activity)", bad.action === "invalid" && bad.problems?.join() === "vat" && p.name === "أبو فهد" && !p.x_customer_type && !p.vat && p.x_vat_status === "unknown");
  assert("the form again, saying why, with every text he typed (the wrong number too)", f.length === 1 && bodyOf(f[0]) === RF.REGISTER_BAD_VAT_TEXT && dataOf(f[0]).i_shop === "عصائر الريان" && dataOf(f[0]).i_vat === "310123456700004" && dataOf(f[0]).i_district === "الملز" && dataOf(f[0]).i_contact === "فهد العتيبي");
  const ok = await regReply(env, NEWC_PHONE, tokenOf(f[0]), FULL);
  assert("corrected: saved", ok.action === "saved" && partner(NEWC).vat === VAT_OK && partner(NEWC).x_vat_status === "registered");
  const env2 = regWorld();
  await quiet(() => RF.sendRegisterForm(env2, newc));
  const noShop = await regReply(env2, NEWC_PHONE, tokenOf(regFlows(NEWC_PHONE)[0]), { ...FULL, shop: "  " });
  assert("no shop name: nothing written, the form again", noShop.action === "invalid" && noShop.problems?.join() === "shop" && partner(NEWC).name === "أبو فهد" && bodyOf(regFlows(NEWC_PHONE).at(-1)) === RF.REGISTER_NO_SHOP_TEXT);
}

console.log("\n[د] the token is this number's; the form is never held, never a template, never Baraa's");
{
  const env = regWorld();
  await quiet(() => RF.sendRegisterForm(env, newc));
  const token = tokenOf(regFlows(NEWC_PHONE)[0]);
  const other = await regReply(env, C1_PHONE, token, FULL);
  assert("another number's reply with his token: nothing written", other.action === "unknown" && partner(NEWC).name === "أبو فهد" && partner(C1).name === "مطعم الوادي" && textsTo(C1_PHONE).at(-1) === RF.REGISTER_UNKNOWN_TEXT);
  const closed = await quiet(() => RF.sendRegisterForm(env, { partnerId: CUST2, whatsapp: "+" + CUST2_PHONE }));
  assert("a window that is closed: nothing sent, nothing held, no template", closed.sent === false && closed.reason === "window_closed" && sentTo(CUST2_PHONE).length === 0 && heldFor(env, CUST2_PHONE).length === 0);
  openWindow(env, OWNER, 1);
  const mine = await quiet(() => RF.sendRegisterForm(env, { partnerId: 1, whatsapp: "+" + OWNER }));
  assert("Baraa's number is never a customer to register", mine.sent === false && mine.reason === "owner" && flowsTo(OWNER).length === 0);
  const d = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: "register_flow_test", to: "+" + NEWC_PHONE, content: { kind: "session", body: { type: "text", text: { body: "x" } } } })));
  assert("the trial's purpose reaches Baraa's number alone", d?.action === "refused" && /OwnerOnlyPurpose/.test(String((d as any).reason)));
}

console.log("\n[د] the one trial to Baraa: marked «🧪 تجربة», once a day, nothing written in Odoo");
{
  const env = regWorld(`${DAY} 23:30`);
  openWindow(env, OWNER, 1);
  const t = await quiet(() => RF.sendRegisterFormTest(env));
  const f = flowsTo(OWNER);
  assert("one form to his own number, marked in its text and in the line above the fields", t.sent === true && f.length === 1 && bodyOf(f[0]).startsWith("🧪 تجربة") && String(dataOf(f[0]).note).startsWith("🧪 تجربة") && par(f[0]).flow_id === RF.REGISTER_FLOW_ID);
  assert("a second trial the same day: not sent", (await quiet(() => RF.sendRegisterFormTest(env))).reason === "already_today" && flowsTo(OWNER).length === 1);
  graph.length = 0;
  await say(env, OWNER, nfm(tokenOf(f[0]), { ...FULL, vat: "123" }));
  const ans = textsTo(OWNER);
  assert("his reply is answered with what he typed — and that the VAT number is not one", ans.length === 1 && ans[0].startsWith("🧪 تجربة — وصلت بيانات المحل") && /عصائر الريان/.test(ans[0]) && /محل عصير/.test(ans[0]) && /123 \(غير صحيح/.test(ans[0]) && /لم يُكتب شيء في Odoo/.test(ans[0]), ans[0]);
  assert("NOTHING of the form is written in Odoo: no partner carries the shop's name, an activity, a person in charge, a legal name or a VAT number", !(rows("res.partner") as any[]).some((r) => r.name === "عصائر الريان" || r.x_customer_type || r.x_contact_name || r.x_legal_name || r.vat || r.x_vat_status === "registered" || r.x_vat_status === "not_registered"));
}
{
  const purposes = (await import("../src/wa-purposes.ts")).PURPOSES;
  assert("customer_register_form and register_flow_test are known to the gateway", purposes.customer_register_form?.kind === "operational" && purposes.register_flow_test?.kind === "operational");
  assert("the Flow's id in the worker is the one Meta gave", /^\d{15,16}$/.test(RF.REGISTER_FLOW_ID) && RF.REGISTER_FLOW_ID !== OF.ORDER_FLOW_ID && srcOf("register-form.ts").includes(`export const REGISTER_FLOW_ID = "${RF.REGISTER_FLOW_ID}"`));
}

done();
