// § 52 (2026-10-04) — the price form by category (Flow v2), the outside market source, the VAT line by
// role, the official template, and what § 51 left open.
//
//   [هـ] Flow v2: the JSON at Meta against what the worker sends — four pages of fifteen fields, the
//        categories that have items in order (فواكه، خضار، ورقيات، أخرى), «التالي» / «إرسال», 0 / 4 / 15 /
//        16 items in a category, empty categories, items of no category, the reply and «تعديل»
//   [ب]  رائد, an outside market source: never a customer (no partner made, no welcome, no customer
//        reply), 02:30 with no «بدء الدوام» to wait for, inside and outside his window
//   [ج]  the VAT line by role: the form, the free text, the reminder; the engine reads a market
//        observation as VAT-inclusive
//   [د]  utak_price_ask_flow_v2: UTILITY and approved → used outside the window by every source;
//        pending or MARKETING → never
//   [و]  the form after the old template (once a day), «ما قدرنا نقرأ الأسعار…» by role, the 05:00
//        reminder to the market sources
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s52.test.mts

import { readFileSync } from "node:fs";
import { OWNER, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, cost, done, fresh, ownerTexts, rejected, setExtract } from "./s46-kit.mts";

let metaTemplates: any[] = [];
let claudeCalls = 0, metaReads = 0, metaDown = false;
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("/message_templates")) { metaReads++; return metaDown ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ data: metaTemplates }), { status: 200 }); }
  if (url.includes("anthropic.com")) claudeCalls++;
  return kitFetch(input as any, init);
}) as typeof fetch;

const FL = await import("../src/price-flow.ts");
const PS = await import("../src/price-sources.ts");
const SUP = await import("../src/suppliers.ts");
const EN = await import("../src/pricing-engine.ts");
const PR = await import("../src/prices.ts");
const { flushTeamQueue } = await import("../src/team-queue.ts");
const { withAutoSendJob } = await import("../src/auto-send-guard.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s52-price-flow.mjs");
// @ts-ignore
const LIB1 = await import("../scripts/lib/s51-price-flow.mjs");

const TPL_ASK = "utak_supplier_ask_v2", TPL_NUDGE = "utak_supplier_price_nudge", TPL_FLOW = "utak_price_ask_flow_v2";
const RAED = 880, RAED_PHONE = "966550689078";
const MARKET_LINE = "اكتب السعر زي ما ينباع في السوق (شامل الضريبة).";
const PURCHASE_LINE = "الأسعار بدون ضريبة.";

function templates(flow: [string, string] | null = null): void {
  const row = (purpose: string, name: string, n: number, status = "APPROVED", category = "UTILITY") =>
    seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: status, x_param_count: n, x_category: category });
  row("supplier_ask", TPL_ASK, 2);
  row("supplier_confirm", "utak_supplier_confirm_v1", 2);
  row("supplier_price_nudge", TPL_NUDGE, 2);
  if (flow) row("price_ask_flow", TPL_FLOW, 1, flow[0], flow[1]);
}
/** The tenant's categories, the four products as fruits (as the order's preview), Omar a «سوق» source, Ahmed «شراء». */
const world = (riyadh = `${DAY} 02:00`, flow: [string, string] | null = null, raed = false): any => {
  const env = fresh(riyadh); cost(500); templates(flow); claudeCalls = 0; metaReads = 0; metaDown = false; metaTemplates = []; setExtract(null);
  for (const [id, name] of [[1, "Goods"], [5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 5;
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  table("res.partner").get(AHMED)!.x_price_role = "purchase";
  if (raed) seedRaed();
  return env;
};
const seedRaed = () => seed("res.partner", { id: RAED, name: "رائد", phone: "+" + RAED_PHONE, x_whatsapp_number: "+" + RAED_PHONE, x_wa_allowed: true, x_price_source: true, x_price_role: "market", customer_rank: 0, supplier_rank: 0, x_contact_class: "supplier", x_vat_registered: true });
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const tplTo = (d: string, name: string) => sentTo(d).filter((b: any) => b?.template?.name === name);
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map((b: any) => String(b.text?.body ?? ""));
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? b?.template?.components?.find((c: any) => c.sub_type === "flow")?.parameters?.[0]?.action?.flow_action_data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? b?.template?.components?.find((c: any) => c.sub_type === "flow")?.parameters?.[0]?.action?.flow_token ?? "";
const kinds = (d: string) => JSON.stringify(sentTo(d).map((b: any) => b.template?.name ?? b.interactive?.type ?? b.type));
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) => {
  openWindow(env, from, 0);
  return quiet(() => FL.handlePriceFlowReply(env, { from: "+" + from, messageId: `wamid.S${++wamid}`, flow: { token, values } }, undefined, now));
};
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (body: string) => ({ type: "text", text: { body } });
const ahmedSrc = { partnerId: AHMED, name: "أحمد حسان", whatsapp: "+" + AHMED_PHONE, supplier: true, role: "purchase" as const };
const omarSrc = { partnerId: DRIVER, employeeId: OMAR_EMP, name: "عمر المجهلي", whatsapp: "+" + DRIVER_PHONE, supplier: false, role: "market" as const };
const raedSrc = { partnerId: RAED, employeeId: null, name: "رائد", whatsapp: "+" + RAED_PHONE, supplier: false, role: "market" as const };
const dpRows = () => rows("x_daily_price") as any[];
const offerRows = () => rows("x_price_offer") as any[];
/** `n` more active products in category `cat` (false = none), ids from `from`. */
function more(n: number, cat: number | false, from: number, name = "صنف"): void {
  for (let i = 0; i < n; i++) {
    const id = from + i;
    seed("product.template", { id, name: `${name} ${id}`, sale_ok: true, x_is_active_for_sale: true, categ_id: cat });
    seed("x_product_packaging", { id: id * 10 + 1, x_name: "كرتون", x_product_tmpl_id: id, x_is_default: true });
  }
}
const off = (...ids: number[]) => { for (const id of ids) table("product.template").get(id)!.x_is_active_for_sale = false; };

// ================================================================ [هـ] the Flow at Meta
console.log("\n[هـ] utak_price_ask_v2 at Meta is the form the worker fills: four pages of fifteen optional number fields, no endpoint");
{
  const json = LIB.buildFlowJson();
  const ids = json.screens.map((s: any) => s.id);
  const inputsOf = (s: any) => s.layout.children.filter((c: any) => c.type === "TextInput");
  assert("four pages PAGE_A … PAGE_D, the first the one the worker opens, and no endpoint (no data_api_version): the data travels with the message",
    JSON.stringify(ids) === JSON.stringify(["PAGE_A", "PAGE_B", "PAGE_C", "PAGE_D"]) && LIB.FLOW_FIRST_SCREEN === FL.PRICE_FLOW_SCREEN && ids.length === FL.PRICE_FLOW_PAGES && json.data_api_version === undefined, ids.join());
  assert("the routes are stated — each page to the next, forward only (the «التالي» footers sit inside an If, which Meta's own routing does not follow)",
    JSON.stringify(json.routing_model) === JSON.stringify({ PAGE_A: ["PAGE_B"], PAGE_B: ["PAGE_C"], PAGE_C: ["PAGE_D"], PAGE_D: [] }), JSON.stringify(json.routing_model));
  assert("fifteen fields a page, sixty in all — the worker's numbers", LIB.FLOW_PAGE_SLOTS === FL.PRICE_FLOW_PAGE_SLOTS && LIB.FLOW_SLOTS === FL.PRICE_FLOW_SLOTS && FL.PRICE_FLOW_SLOTS === 60 && json.screens.every((s: any) => inputsOf(s).length === 15));
  assert("the fields are p1 … p60 across the pages (1–15, 16–30, 31–45, 46–60): numeric and optional",
    json.screens.every((s: any, k: number) => inputsOf(s).every((c: any, j: number) => c.name === `p${k * 15 + j + 1}` && c["input-type"] === "number" && c.required === false)));
  assert("the first page reads its own data; the other pages read the first page's (the message carries all of it once)",
    inputsOf(json.screens[0])[0].label === "${data.l1}" && inputsOf(json.screens[0])[0]["helper-text"] === "${data.h1}" && inputsOf(json.screens[0])[0].visible === "${data.v1}" && inputsOf(json.screens[0])[0]["init-value"] === "${data.i1}"
    && inputsOf(json.screens[1])[0].label === "${screen.PAGE_A.data.l16}" && inputsOf(json.screens[3])[14].visible === "${screen.PAGE_A.data.v60}" && inputsOf(json.screens[2])[0]["init-value"] === "${screen.PAGE_A.data.i31}");
  assert("each page: its category as the heading, the role's noun under it, then the line above the fields",
    json.screens.every((s: any, k: number) => { const c = s.layout.children; const r = (key: string) => (k === 0 ? `\${data.${key}}` : `\${screen.PAGE_A.data.${key}}`);
      return c[0].type === "TextHeading" && c[0].text === r(`t${k + 1}`) && c[1].type === "TextSubheading" && c[1].text === r("sub") && c[2].type === "TextBody" && c[2].text === r("note"); }));
  const foot = (k: number) => json.screens[k].layout.children.at(-1);
  assert("pages 1–3 end with an If on «a page follows»: «التالي» to the next page, else «إرسال»",
    [0, 1, 2].every((k) => foot(k).type === "If" && foot(k).condition === (k === 0 ? "${data.m1}" : `\${screen.PAGE_A.data.m${k + 1}}`)
      && foot(k).then[0].type === "Footer" && foot(k).then[0].label === "التالي" && foot(k).then[0]["on-click-action"].name === "navigate" && foot(k).then[0]["on-click-action"].next.name === ids[k + 1]
      && foot(k).else[0].type === "Footer" && foot(k).else[0].label === "إرسال" && foot(k).else[0]["on-click-action"].name === "complete"), JSON.stringify(foot(0)).slice(0, 200));
  assert("the last page ends with «إرسال» alone", foot(3).type === "Footer" && foot(3).label === "إرسال" && foot(3)["on-click-action"].name === "complete");
  const sent = (k: number) => (k === 3 ? foot(3) : foot(k).else[0])["on-click-action"].payload;
  assert("«إرسال» on page k completes with every field up to that page: its own from its form, the earlier ones from their pages",
    [0, 1, 2, 3].every((k) => JSON.stringify(Object.keys(sent(k))) === JSON.stringify(Array.from({ length: (k + 1) * 15 }, (_, i) => `p${i + 1}`)))
    && sent(0).p7 === "${form.p7}" && sent(2).p7 === "${screen.PAGE_A.form.p7}" && sent(2).p20 === "${screen.PAGE_B.form.p20}" && sent(2).p40 === "${form.p40}" && sent(3).p60 === "${form.p60}", JSON.stringify(sent(1)).slice(0, 160));
  assert("every page can end the Flow (terminal): «إرسال» sits on the last page that has items, whichever it is", json.screens.every((s: any) => s.terminal === true && s.success === true));
  const env = world();
  const prep = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  const model = json.screens[0].data;
  assert("every key the worker sends is declared on the first page, and every declared key is sent (249: sub, note, 4 headings, 3 «a page follows», 60 × 4)",
    JSON.stringify(Object.keys(prep.data).sort()) === JSON.stringify(Object.keys(model).sort()) && Object.keys(prep.data).length === 249 && json.screens.slice(1).every((s: any) => Object.keys(s.data).length === 0), String(Object.keys(prep.data).length));
  assert("…each of its declared type (a string, or a boolean)", Object.entries(prep.data).every(([k, v]) => typeof v === (model[k].type === "boolean" ? "boolean" : "string")));
  assert("the message opens the v2 Flow on its first page, with the data (navigate)", par(prep.session.body).flow_id === "1123704886881420" && FL.PRICE_FLOW_ID === "1123704886881420" && par(prep.session.body).flow_action === "navigate" && par(prep.session.body).flow_action_payload.screen === "PAGE_A" && par(prep.session.body).flow_cta === "أدخل الأسعار");
  assert("v1 stays as it was published — its own name, its one screen, its id — and is no longer the Flow the worker sends", LIB1.FLOW_NAME === "utak_price_ask_v1" && LIB.FLOW_NAME === "utak_price_ask_v2" && LIB1.buildFlowJson().screens.length === 1 && FL.PRICE_FLOW_V1_ID === "1086052444016554" && FL.PRICE_FLOW_ID !== FL.PRICE_FLOW_V1_ID);
}

console.log("\n[هـ] the pages follow the categories: فواكه، خضار، ورقيات، then «أخرى» — an empty one takes no page");
{
  const env = world();
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 21, x_date: "2026-10-02", x_extraction_status: "extracted", x_source_message_id: "wamid.SENT" });
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  assert("today: four items, all fruits — ONE page «فواكه» with four fields, and «إرسال» on it (no page follows)",
    JSON.stringify(p.record.pages) === JSON.stringify(["فواكه"]) && p.data.t1 === "فواكه" && p.data.m1 === false && p.data.m2 === false && p.data.m3 === false && [1, 2, 3, 4].every((n) => p.data[`v${n}`] === true) && p.data.v5 === false && p.total === 4, JSON.stringify([p.record.pages, p.data.t1, p.data.m1]));
  assert("…the other pages are skipped: no heading, nothing shown on them", p.data.t2 === "-" && p.data.t3 === "-" && p.data.t4 === "-" && Array.from({ length: 45 }, (_, i) => p.data[`v${i + 16}`]).every((v) => v === false));
  assert("…the fields keep the rules of v1: «الصنف — التعبئة», the hint «آخر سعر», the engine's order", p.data.l1 === "طماطم — كرتون" && p.data.h1 === "آخر سعر: 21" && p.data.h2 === "لا سعر سابق" && p.record.items.map((i: any) => `${i.slot}:${i.productId}/${i.packagingId}`).join() === "1:1/11,2:2/21,3:3/31,4:4/41");
  assert("…under the heading: «أسعار الشراء اليوم»; the token is kept as a v2 token with its pages", p.data.sub === "أسعار الشراء اليوم" && (await FL.readFlowToken(env, p.record.token))?.v === 2 && JSON.stringify((await FL.readFlowToken(env, p.record.token))?.pages) === JSON.stringify(["فواكه"]));
  assert("no Odoo field outside the schema (product.template.categ_id, product.category)", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  table("product.category").get(5)!.name = "فواكه طازجة";
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  assert("the page's heading is the category's name as Odoo holds it", p.data.t1 === "فواكه طازجة", String(p.data.t1));
}
{
  const env = world();
  // 1 طماطم → خضار, 2 خيار → خضار, 3 بطاطس → no category, 4 بصل → «Goods» (not one of the three)
  table("product.template").get(1)!.categ_id = 6; table("product.template").get(2)!.categ_id = 6;
  table("product.template").get(3)!.categ_id = false; table("product.template").get(4)!.categ_id = 1;
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  assert("no fruit today: the first page is «خضار» (never an empty «فواكه»), then «أخرى» — two pages, «التالي» on the first and «إرسال» on the second",
    JSON.stringify(p.record.pages) === JSON.stringify(["خضار", "أخرى"]) && p.data.t1 === "خضار" && p.data.t2 === "أخرى" && p.data.m1 === true && p.data.m2 === false && p.data.t3 === "-", JSON.stringify(p.record.pages));
  assert("…each page's items take that page's slots: خضار 1–2, أخرى 16–17", p.record.items.map((i: any) => `${i.slot}:${i.productId}`).join() === "1:1,2:2,16:3,17:4" && p.data.v1 === true && p.data.v2 === true && p.data.v3 === false && p.data.v16 === true && p.data.v17 === true && p.data.v18 === false && p.data.l16 === "بطاطس — كرتون");
  assert("an item with no category, and one of a category that is none of the three: both under «أخرى»", p.record.items.filter((i: any) => i.slot > 15).map((i: any) => i.productId).join() === "3,4");
  // the reply of the second page
  await reply(env, AHMED_PHONE, p.record.token, { p1: "9", p16: "14.5", p17: "" });
  const d = dpRows();
  assert("a price typed on the second page (p16) is written on ITS item (بطاطس), the first page's on its own", d.length === 2 && d[0].x_product_tmpl_id === 1 && d[0].x_price_sar === 9 && d[1].x_product_tmpl_id === 3 && d[1].x_packaging_id === 31 && d[1].x_price_sar === 14.5, JSON.stringify(d.map((r) => [r.x_product_tmpl_id, r.x_price_sar])));
  const ack = flowsTo(AHMED_PHONE).at(-1);
  assert("«وصلت ✅ طماطم 9، بطاطس 14.50.» under «تعديل», which opens the SAME two pages with what was sent", bodyOf(ack) === "وصلت ✅ طماطم 9، بطاطس 14.50." && par(ack).flow_cta === "تعديل" && dataOf(ack).t1 === "خضار" && dataOf(ack).t2 === "أخرى" && dataOf(ack).m1 === true && dataOf(ack).i1 === "9" && dataOf(ack).i16 === "14.50" && dataOf(ack).i17 === "", bodyOf(ack));
}
{
  const env = world();
  seed("product.category", { id: 50, name: "حمضيات", parent_id: 5 });
  seed("product.category", { id: 70, name: "أعشاب", parent_id: 7 });
  table("product.template").get(1)!.categ_id = 70;   // ورقيات (child)
  table("product.template").get(2)!.categ_id = 6;    // خضار
  table("product.template").get(3)!.categ_id = 50;   // فواكه (child)
  table("product.template").get(4)!.categ_id = false;
  const p = (await quiet(() => FL.prepareFlowAsk(env, omarSrc)))!;
  assert("four pages, in the order فواكه، خضار، ورقيات، أخرى — whatever the products' own order; a child category counts as its root",
    JSON.stringify(p.record.pages) === JSON.stringify(["فواكه", "خضار", "ورقيات", "أخرى"]) && p.record.items.map((i: any) => `${i.slot}:${i.productId}`).join() === "1:3,16:2,31:1,46:4" && p.data.m1 === true && p.data.m2 === true && p.data.m3 === true, JSON.stringify(p.record.items.map((i: any) => [i.slot, i.productId])));
  await reply(env, DRIVER_PHONE, p.record.token, { p1: "11", p16: "12", p31: "13", p46: "14" });
  assert("a price from each of the four pages lands on its own item", offerRows().map((o) => `${o.x_product_tmpl_id}:${o.x_market_price}`).join() === "3:11,2:12,1:13,4:14", JSON.stringify(offerRows().map((o) => [o.x_product_tmpl_id, o.x_market_price])));
}
{
  const env = world();
  off(1, 2, 3, 4);
  assert("no active item at all: no form (nothing prepared, no token kept)", (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc))) === null && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("pflow:v1:")));
}
{
  const env = world();
  more(11, 5, 101);                                  // 4 + 11 = fifteen fruits
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  assert("fifteen items in a category: the page is full, every field shown, and no alert", p.record.items.length === 15 && p.data.v15 === true && p.data.m1 === false && p.total === 15 && ownerTexts().length === 0, ownerTexts().join(" | "));
}
{
  const env = world();
  more(12, 5, 101);                                  // sixteen fruits
  more(2, 6, 201, "خضرة");                           // and two vegetables
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  const alerts = () => ownerTexts().filter((t) => /تتسع لـ 15 خانة/.test(t));
  assert("sixteen items in a category: its first fifteen on its page — the sixteenth does NOT spill into the next page", p.record.items.filter((i: any) => i.slot <= 15).length === 15 && !p.record.items.some((i: any) => i.productId === 112) && p.record.items.filter((i: any) => i.slot > 15).map((i: any) => `${i.slot}:${i.productId}`).join() === "16:201,17:202" && p.total === 18, JSON.stringify(p.record.items.map((i: any) => [i.slot, i.productId]).slice(13)));
  assert("…and Baraa told at once which category is over and which item has no field", alerts().length === 1 && /«فواكه» فيها 16 صنفاً نشطاً للبيع/.test(alerts()[0]) && /بلا خانة: صنف 112\./.test(alerts()[0]) && !/خضرة/.test(alerts()[0]), ownerTexts().join(" | "));
  await quiet(() => FL.prepareFlowAsk(env, omarSrc));
  assert("…once a day (the next ask of the day: no second alert)", alerts().length === 1);
}
{
  const env = world();
  const failing = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => String((input as any)?.url ?? input).includes("/product.category/") ? new Response("{}", { status: 400 }) : failing(input as any, init)) as typeof fetch;
  openWindow(env, AHMED_PHONE, 60);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  globalThis.fetch = failing;
  assert("the categories cannot be read: no form with every item under «أخرى» — the ask of before goes in the same run", flowsTo(AHMED_PHONE).length === 0 && tplTo(AHMED_PHONE, TPL_ASK).length === 1, kinds(AHMED_PHONE));
}
{
  const env = world(`${DAY} 03:00`);
  // a token of utak_price_ask_v1 (sent before § 52): one page, no `pages`
  const token = "pf1.20261003.801.0011223344556677aa";
  env.MSG_DEDUP.store.set(FL.flowTokenKey(token), JSON.stringify({ v: 1, token, day: DAY, to: AHMED_PHONE, partnerId: AHMED, employeeId: null, name: "أحمد حسان", supplier: true, kind: "purchase", createdAt: Date.now(),
    items: [{ slot: 1, productId: 1, packagingId: 11, name: "طماطم", label: "طماطم — كرتون", hint: "آخر سعر: 21" }, { slot: 2, productId: 2, packagingId: 21, name: "خيار", label: "خيار — جرم", hint: "لا سعر سابق" }] }));
  const r = await reply(env, AHMED_PHONE, token, { p1: "20", p2: "8" });
  const ack = flowsTo(AHMED_PHONE).at(-1);
  assert("a v1 token answered after § 52 is still read (its fields are p1 … p15), and its «تعديل» opens the v2 Flow on one page", r.action === "saved" && dpRows().length === 2 && par(ack).flow_id === FL.PRICE_FLOW_ID && dataOf(ack).t1 === "الأصناف" && dataOf(ack).m1 === false && dataOf(ack).i2 === "8" && Object.keys(dataOf(ack)).length === 249, JSON.stringify([r, dataOf(ack).t1]));
}

// ================================================================ [ج] the VAT line by role
console.log("\n[ج] the VAT line follows the role: «الأسعار بدون ضريبة.» for a purchase price, «اكتب السعر زي ما ينباع في السوق (شامل الضريبة).» for a market observation");
{
  const env = world(`${DAY} 02:00`, null, true);
  const a = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!, o = (await quiet(() => FL.prepareFlowAsk(env, omarSrc)))!, r = (await quiet(() => FL.prepareFlowAsk(env, raedSrc)))!;
  assert("the form — Ahmed («شراء»): «الأسعار بدون ضريبة. اترك الخانة فاضية لو الصنف غير متوفر.»", a.data.note === `${PURCHASE_LINE} اترك الخانة فاضية لو الصنف غير متوفر.` && !/شامل/.test(String(a.data.note)), String(a.data.note));
  assert("the form — Omar and Raed («سوق»): «اكتب السعر زي ما ينباع في السوق (شامل الضريبة). اترك الخانة فاضية…», and never «بدون ضريبة»",
    o.data.note === `${MARKET_LINE} اترك الخانة فاضية لو الصنف غير متوفر.` && r.data.note === o.data.note && !/بدون ضريبة/.test(String(o.data.note)) && o.data.sub === "أسعار السوق اليوم", String(o.data.note));
  assert("the ask above the button — «شراء»: «…وعبّ سعر كل صنف (بدون ضريبة).»; «سوق»: «…واكتب السعر زي ما ينباع في السوق (شامل الضريبة).»",
    /وعبّ سعر كل صنف \(بدون ضريبة\)\.$/.test(bodyOf(a.session.body)) && /واكتب السعر زي ما ينباع في السوق \(شامل الضريبة\)\.$/.test(bodyOf(o.session.body)) && !/بدون ضريبة/.test(bodyOf(r.session.body)) && /^صباح الخير رائد 🌿 طلب أسعار السوق من يو تاك/.test(bodyOf(r.session.body)), bodyOf(o.session.body));
  assert("the free-text ask — «سوق»: the market line, no «بدون ضريبة»; «شراء»: «بدون ضريبة», no «شامل»; no role (asked for market prices): the market line",
    PS.marketAskText("عمر المجهلي", "market").endsWith(MARKET_LINE) && !/بدون ضريبة/.test(PS.marketAskText("عمر", "market")) && /بدون ضريبة\.$/.test(PS.marketAskText("أحمد", "purchase")) && !/شامل/.test(PS.marketAskText("أحمد", "purchase")) && PS.marketAskText("رائد").endsWith(MARKET_LINE), PS.marketAskText("عمر المجهلي", "market"));
  assert("the reminder — «شراء»: «(بدون ضريبة)» in the form's text and in the free text; «سوق»: «ما وصلتنا أسعار السوق … (شامل الضريبة)»",
    /\(بدون ضريبة\)\.$/.test(FL.flowNudgeText("6:00 صباحاً", "purchase")) && FL.flowNudgeText("6:00 صباحاً") === FL.flowNudgeText("6:00 صباحاً", "purchase") && /الأسعار بدون ضريبة/.test(SUP.supplierNudgeText("6:00 صباحاً"))
    && /ما وصلتنا أسعار السوق اليوم للحين/.test(FL.flowNudgeText("6:00 صباحاً", "market")) && /زي ما ينباع في السوق \(شامل الضريبة\)\.$/.test(FL.flowNudgeText("6:00 صباحاً", "market")) && !/بدون ضريبة/.test(FL.flowNudgeText("6:00 صباحاً", "market")), FL.flowNudgeText("6:00 صباحاً", "market"));
  assert("one constant for each line, the same in the form and in the texts", FL.VAT_LINE.purchase === PURCHASE_LINE && FL.VAT_LINE.market === MARKET_LINE && PS.MARKET_VAT_LINE === MARKET_LINE && FL.flowNote("market").startsWith(MARKET_LINE) && FL.flowNote("purchase").startsWith(PURCHASE_LINE));
}
{
  // purchase 20 net, waste 5 % = 1, the carton's share 2, the minimum profit 2 → (25) × 1.15 = 28.75 → 29 (VAT inside)
  const ITEM = { productId: 1, productName: "طماطم", packagingId: 11, packagingName: "كرتون" };
  const offer = (o: any) => ({ outlier: false, sourceName: "x", productId: 1, packagingId: 11, model: "po", rowId: 1, ...o });
  const run = (marketPrice: number) => EN.computePricing([ITEM], [offer({ kind: "purchase", price: 20, partnerId: AHMED, model: "dp" }), offer({ kind: "market", price: marketPrice, partnerId: DRIVER, rowId: 2 })], 5, { ratePct: 15 }, { opShare: 2, minProfit: 2 })[0];
  // § 54 أ — the exception's line is «بدون خسارة» (23 × 1.15 = 26.45, VAT inside) and no longer the suggested price: below the
  // suggested price a line is automatic at its market price (rule 5), and «reaches the suggested price» shows in the proposed decision
  const at = run(29), under = run(28.5), loss = run(26);
  assert("the engine reads a market observation as VAT-INCLUSIVE: it is compared, as it is, with the VAT-inclusive suggested price (29 reaches 29; 28.5 does not — 28.5 × 1.15 would)",
    at.suggested === 29 && at.exceptions.length === 0 && at.sale === 29 && at.proposal.why === "above_suggested" && under.sale === 28.5 && under.proposal.why === "below_suggested" && under.exceptions.length === 0, JSON.stringify([at.suggested, at.exceptions, at.proposal, under.exceptions, under.proposal]));
  assert("…and with the VAT-inclusive «بدون خسارة» 26.45: a market of 26 is a loss, an exception «سعر السوق 26 أقل من سعر بدون خسارة 26.45» (26 × 1.15 = 29.90 would not be)",
    loss.breakEven === 26.45 && loss.sale === 26 && loss.exceptions.join() === "loss" && loss.reason === "سعر السوق 26 أقل من سعر بدون خسارة 26.45" && EN.lineVerdict(loss, null, 0).status === "exception", JSON.stringify([loss.breakEven, loss.exceptions, loss.reason]));
  assert("…and the profit takes the VAT out of it (29 ÷ 1.15 − 20 − 1 = 4.22), the purchase price net as it is", at.unitProfit === 4.22 && EN.vatProfit(29, 20, 5, 15).toFixed(4) === (29 / 1.15 - 21).toFixed(4), String(at.unitProfit));
}

// ================================================================ [د] the template
console.log("\n[د] utak_price_ask_flow_v2: one submission, UTILITY, no greeting and no emoji, a FLOW button «أدخل الأسعار»");
{
  const t = LIB.templatePayload(FL.PRICE_FLOW_ID);
  assert("the template the worker names, submitted UTILITY, in Arabic, with the Flow's purpose", t.name === "utak_price_ask_flow_v2" && t.name === FL.PRICE_FLOW_TEMPLATE && t.category === "UTILITY" && t.language === "ar" && LIB.FLOW_TEMPLATE.purpose === FL.PRICE_FLOW_PURPOSE);
  assert("its text, to the letter: «طلب تحديث الأسعار ليوم {{1}} حسب الاتفاق مع يو تاك. اضغط «أدخل الأسعار» وأدخل سعر كل صنف.»", t.components[0].text === "طلب تحديث الأسعار ليوم {{1}} حسب الاتفاق مع يو تاك. اضغط «أدخل الأسعار» وأدخل سعر كل صنف.", t.components[0].text);
  assert("…no greeting and no emoji in it, ONE variable (the day)", !/صباح|مرحب|أهلا|هلا|\p{Extended_Pictographic}/u.test(t.components[0].text) && (t.components[0].text.match(/\{\{\d\}\}/g) ?? []).length === 1 && JSON.stringify(t.components[0].example.body_text) === JSON.stringify([["5 أكتوبر 2026"]]) && JSON.stringify(FL.flowAskParams("2026-10-05")) === JSON.stringify(["5 أكتوبر 2026"]));
  assert("ONE FLOW button «أدخل الأسعار» that opens the v2 Flow on its first page", t.components[1].buttons.length === 1 && t.components[1].buttons[0].type === "FLOW" && t.components[1].buttons[0].text === "أدخل الأسعار" && t.components[1].buttons[0].flow_id === "1123704886881420" && t.components[1].buttons[0].flow_action === "navigate" && t.components[1].buttons[0].navigate_screen === "PAGE_A", JSON.stringify(t.components[1]));
}
for (const [label, state, usable] of [["APPROVED and UTILITY", ["APPROVED", "UTILITY"], true], ["PENDING (Meta has not decided)", ["PENDING", "UTILITY"], false], ["filed MARKETING by Meta, even APPROVED", ["APPROVED", "MARKETING"], false], ["PENDING and MARKETING", ["PENDING", "MARKETING"], false]] as Array<[string, [string, string], boolean]>) {
  const env = world(`${DAY} 02:00`, state, true);
  metaTemplates = [{ id: "943336198400535", name: TPL_FLOW, language: "ar", status: state[0], category: state[1], components: [] }];
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob({ ...env, META_WABA_ID: "WABA" }, "ask_suppliers")));
  // (read here, before Omar's 02:30 ask: a member's text that cannot go is «skipped» on its way to his team queue)
  const askedOfGateway = (rows("x_wa_message") as any[]).some((r) => r.x_status === "skipped") || [...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("pflow:v1:"));
  setRiyadh(`${DAY} 02:30`);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  const flowTpl = (d: string) => tplTo(d, TPL_FLOW).length, oldTpl = (d: string) => tplTo(d, TPL_ASK).length;
  if (usable) {
    assert(`the template ${label}: used outside the window for EVERY source — Ahmed 02:00, Omar and Raed 02:30 — instead of the old text template`, flowTpl(AHMED_PHONE) === 1 && flowTpl(DRIVER_PHONE) === 1 && flowTpl(RAED_PHONE) === 1 && oldTpl(AHMED_PHONE) === 0 && oldTpl(RAED_PHONE) === 0 && sentTo(RAED_PHONE).length === 1, [kinds(AHMED_PHONE), kinds(DRIVER_PHONE), kinds(RAED_PHONE)].join(" "));
    const c = tplTo(RAED_PHONE, TPL_FLOW)[0].template.components;
    assert("…its one variable is the day, and its button carries this send's token and the form's data", JSON.stringify(c.find((x: any) => x.type === "body").parameters.map((x: any) => x.text)) === JSON.stringify(["3 أكتوبر 2026"]) && tokenOf(tplTo(RAED_PHONE, TPL_FLOW)[0]).startsWith("pf1.") && dataOf(tplTo(RAED_PHONE, TPL_FLOW)[0]).sub === "أسعار السوق اليوم" && dataOf(tplTo(RAED_PHONE, TPL_FLOW)[0]).t1 === "فواكه", JSON.stringify(c).slice(0, 200));
    assert("…no form is owed to a source that got the form's own template", ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("pflow_owed:")));
  } else {
    assert(`the template ${label}: the gateway is not even asked for it (no «skipped» line in his conversation, no token left behind)`, askedOfGateway === false && heldFor(env, AHMED_PHONE).length === 0 && heldFor(env, RAED_PHONE).length === 0);
    assert(`the template ${label}: never used — Ahmed and Raed get utak_supplier_ask_v2, Omar's ask waits in his team queue`, flowTpl(AHMED_PHONE) === 0 && flowTpl(RAED_PHONE) === 0 && flowTpl(DRIVER_PHONE) === 0 && oldTpl(AHMED_PHONE) === 1 && oldTpl(RAED_PHONE) === 1 && sentTo(DRIVER_PHONE).length === 0, [kinds(AHMED_PHONE), kinds(DRIVER_PHONE), kinds(RAED_PHONE)].join(" "));
  }
}

console.log("\n[د] approved today, filed MARKETING tomorrow: the template is read again from Meta before every night's ask");
{
  const env = world(`${DAY} 02:00`, ["APPROVED", "UTILITY"], true);
  metaTemplates = [{ id: "943336198400535", name: TPL_FLOW, language: "ar", status: "APPROVED", category: "MARKETING" }];
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob({ ...env, META_WABA_ID: "WABA" }, "ask_suppliers")));
  const row = (rows("x_whatsapp_template") as any[]).find((r) => r.x_meta_template_id === TPL_FLOW);
  assert("APPROVED and UTILITY in Odoo, moved to MARKETING at Meta since: ONE read of this template before the 02:00 ask, and its row corrected", metaReads === 1 && row.x_category === "MARKETING" && row.x_meta_status === "APPROVED", JSON.stringify([metaReads, row.x_category]));
  assert("…so it is not used that night: Ahmed gets utak_supplier_ask_v2, and the form is owed to him", tplTo(AHMED_PHONE, TPL_FLOW).length === 0 && tplTo(AHMED_PHONE, TPL_ASK).length === 1 && !!env.MSG_DEDUP.store.get(`pflow_owed:v1:${AHMED_PHONE}`), kinds(AHMED_PHONE));
  setRiyadh(`${DAY} 02:30`);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  assert("…nor at 02:30 for Raed (the old template), and Meta is not read a second time for it", tplTo(RAED_PHONE, TPL_FLOW).length === 0 && tplTo(RAED_PHONE, TPL_ASK).length === 1 && metaReads === 1, kinds(RAED_PHONE));
  assert("…only this template's row is written (no full sync at 02:00)", (rows("x_whatsapp_template") as any[]).filter((r) => r.x_last_synced).length === 1);
}
{
  const env = world(`${DAY} 02:00`, ["APPROVED", "UTILITY"]);
  metaTemplates = [{ id: "943336198400535", name: TPL_FLOW, language: "ar", status: "APPROVED", category: "UTILITY" }];
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob({ ...env, META_WABA_ID: "WABA" }, "ask_suppliers")));
  assert("still UTILITY at Meta: nothing written (no write is even asked of Odoo), and the template is used", metaReads === 1 && !(rows("x_whatsapp_template") as any[]).some((r) => r.x_last_synced) && !odooLog.some((l) => l.model === "x_whatsapp_template" && l.method === "write") && tplTo(AHMED_PHONE, TPL_FLOW).length === 1, kinds(AHMED_PHONE));
  const env2 = world(`${DAY} 02:00`, ["APPROVED", "UTILITY"]);
  metaDown = true;
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob({ ...env2, META_WABA_ID: "WABA" }, "ask_suppliers")));
  assert("Meta cannot be read: the row stays as Odoo holds it, and the ask still goes (by the template)", tplTo(AHMED_PHONE, TPL_FLOW).length === 1 && (rows("x_whatsapp_template") as any[]).find((r) => r.x_meta_template_id === TPL_FLOW).x_category === "UTILITY", kinds(AHMED_PHONE));
  metaDown = false;
  const env3 = world(`${DAY} 02:00`, ["APPROVED", "UTILITY"]);
  metaTemplates = [{ id: "1", name: `${TPL_FLOW}_old`, language: "ar", status: "REJECTED", category: "MARKETING" }];
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob({ ...env3, META_WABA_ID: "WABA" }, "ask_suppliers")));
  assert("another template whose name only contains this one's is not taken for it", (rows("x_whatsapp_template") as any[]).find((r) => r.x_meta_template_id === TPL_FLOW).x_meta_status === "APPROVED" && tplTo(AHMED_PHONE, TPL_FLOW).length === 1);
}

// ================================================================ [ب] رائد
console.log("\n[ب] رائد — an outside market source: 02:30 with Omar, and no «بدء الدوام» to wait for");
{
  const env = world(`${DAY} 02:30`, null, true);
  table("hr.employee").get(OMAR_EMP)!.x_utak_attendance = true;       // Omar has not tapped «بدء الدوام»
  openWindow(env, RAED_PHONE, 30);
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  const f = flowsTo(RAED_PHONE);
  assert("02:30, inside his window: the form reaches Raed at once — while Omar's waits in his team queue for his tap", r.asks?.find((a: any) => a.name === "رائد")?.action === "sent" && r.asks?.find((a: any) => a.name === "عمر المجهلي")?.action === "queued" && f.length === 1 && sentTo(RAED_PHONE).length === 1 && sentTo(DRIVER_PHONE).length === 0 && !env.MSG_DEDUP.store.get(`pending_loc:+${RAED_PHONE}`), JSON.stringify(r.asks));
  assert("…«أسعار السوق اليوم», the market VAT line, today's items on their page", dataOf(f[0]).sub === "أسعار السوق اليوم" && String(dataOf(f[0]).note).startsWith(MARKET_LINE) && dataOf(f[0]).t1 === "فواكه" && dataOf(f[0]).v4 === true && /^صباح الخير رائد 🌿 طلب أسعار السوق/.test(bodyOf(f[0])));
  const rec = await FL.readFlowToken(env, tokenOf(f[0]));
  assert("…its token: a «سوق» source that is neither a supplier nor an employee", rec?.partnerId === RAED && rec.employeeId === null && rec.kind === "market" && rec.supplier === false && rec.to === RAED_PHONE);
  await reply(env, RAED_PHONE, tokenOf(f[0]), { p1: "31", p2: "12.5" });
  const o = offerRows();
  assert("his numbers are market observations: x_price_offer rows on his partner, no purchase price, no x_daily_price row, no employee", o.length === 2 && o.every((x) => x.x_source_partner_id === RAED && x.x_purchase_price === 0 && !x.x_source_employee_id) && o[0].x_market_price === 31 && o[1].x_market_price === 12.5 && dpRows().length === 0, JSON.stringify(o.map((x) => [x.x_market_price, x.x_purchase_price])));
  assert("…and the engine counts him among the «سوق» sources (none of his rows enters «أقل عرض»)", PS.marketOnlyPartners(await PS.loadPriceSources(env)).has(RAED) && (await EN.readDayOffers(env, DAY, await PS.loadPriceSources(env))).filter((x: any) => x.partnerId === RAED).every((x: any) => x.kind === "market"));
  await quiet(() => PS.runMarketAsk(env, Date.now() + 5 * 60_000, 6 * 60));
  assert("the tick again: no second ask", sentTo(RAED_PHONE).filter((b: any) => par(b).flow_cta === "أدخل الأسعار").length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 02:30`, ["PENDING", "MARKETING"], true);
  const partners = rows("res.partner").length;
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  const t = tplTo(RAED_PHONE, TPL_ASK);
  const params = t[0]?.template?.components?.find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
  assert("outside his window, no usable Flow template: utak_supplier_ask_v2 at 02:30 — sent, not held, not queued", r.asks?.find((a: any) => a.name === "رائد")?.action === "sent" && t.length === 1 && sentTo(RAED_PHONE).length === 1 && heldFor(env, RAED_PHONE).length === 0 && !env.MSG_DEDUP.store.get(`pending_loc:+${RAED_PHONE}`), kinds(RAED_PHONE));
  assert("…with his name and TODAY's items (every product «نشط للبيع»)", params[0] === "رائد" && params[1] === "طماطم، خيار، بطاطس، بصل", JSON.stringify(params));
  assert("…no welcome, no opener, nothing else to his number; and no partner made", sentTo(RAED_PHONE).every((b: any) => b.template?.name === TPL_ASK) && rows("res.partner").length === partners);
  // he answers the template in text, within 90 minutes
  setRiyadh(`${DAY} 02:50`);
  setExtract({ prices: [{ product_id: 1, packaging_id: 11, cost_price: 20, market_price: 30, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  await say(env, RAED_PHONE, text("طماطم 30 شراء 20"));
  setExtract(null);
  const o = offerRows();
  assert("his text reply is read as market observations — «شراء» beside a number changes nothing for a «سوق» source", o.length === 1 && o[0].x_source_partner_id === RAED && o[0].x_market_price === 30 && o[0].x_purchase_price === 0 && dpRows().length === 0, JSON.stringify(o));
  assert("…answered «وصلتنا أسعار السوق (1 صنف)», and — his prices arrived — no form on top of it", textsTo(RAED_PHONE).some((x) => /^وصلتنا أسعار السوق \(1 صنف\)/.test(x)) && flowsTo(RAED_PHONE).length === 0, kinds(RAED_PHONE));
  assert("…still no customer partner for his number, no welcome template, no quotation", rows("res.partner").length === partners && !sentTo(RAED_PHONE).some((b: any) => /welcome|quotation|order/.test(String(b.template?.name ?? ""))) && rows("x_daily_order").length === 0);
}
{
  const env = world(`${DAY} 02:30`, null, true);
  for (const r of rows("x_whatsapp_template") as any[]) if (r.x_meta_template_id === TPL_ASK) r.x_meta_status = "PENDING";
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  const held = heldFor(env, RAED_PHONE);
  assert("outside his window and the old template cannot go either (not approved): it is not held and no form is owed — his ask is the text of before, kept by the gateway until he writes", r.asks?.find((a: any) => a.name === "رائد")?.action === "held" && sentTo(RAED_PHONE).length === 0 && held.length === 1 && held[0].purpose === "market_price_ask" && !env.MSG_DEDUP.store.get(`pflow_owed:v1:${RAED_PHONE}`), JSON.stringify([r.asks, held.map((h: any) => h.purpose)]));
}
{
  const env = world(`${DAY} 14:00`, null, true);
  const partners = rows("res.partner").length;
  await say(env, RAED_PHONE, text("السلام عليكم، أبغى كرتون طماطم"));
  assert("any other message from him (it reads like an order): NOT a customer — no partner made, no welcome, no quotation, no classifier", rows("res.partner").length === partners && rows("x_daily_order").length === 0 && rows("x_quotation").length === 0 && claudeCalls === 0 && !sentTo(RAED_PHONE).some((b: any) => b.template), kinds(RAED_PHONE));
  assert("…«وصلتنا رسالتك في يو تاك، والفريق بيراجعها ويرد عليك 🌿», and one line to Baraa with what he wrote", textsTo(RAED_PHONE).length === 1 && textsTo(RAED_PHONE)[0] === PS.OUTSIDE_SOURCE_ACK && ownerTexts().filter((t) => /رسالة من مصدر الأسعار «رائد»/.test(t) && /أبغى كرتون طماطم/.test(t)).length === 1, JSON.stringify([textsTo(RAED_PHONE), ownerTexts()]));
  assert("…his message lands on HIS partner's conversation", (rows("x_wa_message") as any[]).some((m) => m.x_source === "inbound" && (m.x_partner_id === RAED || m.x_partner_id?.[0] === RAED)), JSON.stringify((rows("x_wa_message") as any[]).map((m) => [m.x_source, m.x_partner_id])));
  await say(env, RAED_PHONE, { type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg" } });
  assert("a voice note from him: the same acknowledgement, never the customer's media reply", textsTo(RAED_PHONE).length === 2 && textsTo(RAED_PHONE)[1] === PS.OUTSIDE_SOURCE_ACK && rows("res.partner").length === partners, JSON.stringify(textsTo(RAED_PHONE)));
}
{
  const env = world(`${DAY} 14:00`, null, true);
  seed("res.partner", { id: 881, name: "عميل ومصدر", x_whatsapp_number: "+966500000881", x_price_source: true, customer_rank: 1, supplier_rank: 0 });
  table("res.partner").get(AHMED)!.customer_rank = 0;                 // as Odoo holds it: a supplier's customer rank is 0, not empty
  assert("an outside source is a flagged partner that is neither a supplier nor a customer: Raed is; Ahmed (a supplier) and a customer who is also a source are not; an unknown number is not",
    (await PS.findOutsideSource(env, "+" + RAED_PHONE))?.id === RAED && (await PS.findOutsideSource(env, "+" + AHMED_PHONE)) === null && (await PS.findOutsideSource(env, "+966500000881")) === null && (await PS.findOutsideSource(env, "+966500009999")) === null);
  table("res.partner").get(RAED)!.x_price_source = false;
  assert("…and only while «مصدر أسعار» is ticked", (await PS.findOutsideSource(env, "+" + RAED_PHONE)) === null);
}

// ================================================================ [و] what § 51 left open
console.log("\n[و] asked by the old text template, then any message: the form at once — his window has just opened — once a day");
{
  const env = world(`${DAY} 02:00`);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  assert("02:00, Ahmed outside his window and no usable Flow template: the old template — and the form is owed to him", tplTo(AHMED_PHONE, TPL_ASK).length === 1 && flowsTo(AHMED_PHONE).length === 0 && !!env.MSG_DEDUP.store.get(`pflow_owed:v1:${AHMED_PHONE}`));
  setRiyadh(`${DAY} 03:10`);
  await say(env, AHMED_PHONE, text("هلا"));
  const f = flowsTo(AHMED_PHONE);
  assert("03:10, he writes «هلا» (no price in it): the form reaches him at once, as a plain message — «أسعار الشراء اليوم», «بدون ضريبة», his four items", f.length === 1 && par(f[0]).flow_cta === "أدخل الأسعار" && dataOf(f[0]).sub === "أسعار الشراء اليوم" && String(dataOf(f[0]).note).startsWith(PURCHASE_LINE) && dataOf(f[0]).v4 === true && /^صباح الخير أحمد 🌿 طلب أسعار الشراء/.test(bodyOf(f[0])), kinds(AHMED_PHONE));
  assert("…no second ask is logged (the form answers the 02:00 ask)", (rows("x_supplier_price_request_log") as any[]).length === 1);
  await say(env, AHMED_PHONE, text("طيب"));
  await say(env, AHMED_PHONE, { type: "button", button: { payload: "supplier_thanks", text: "شكراً" } });
  assert("…ONCE a day: his next message and a button tap bring no second form", flowsTo(AHMED_PHONE).length === 1 && !env.MSG_DEDUP.store.get(`pflow_owed:v1:${AHMED_PHONE}`), kinds(AHMED_PHONE));
  await reply(env, AHMED_PHONE, tokenOf(f[0]), { p1: "22" });
  assert("…and the form he got is a real one: its reply is written", dpRows().length === 1 && dpRows()[0].x_price_sar === 22 && dpRows()[0].x_extraction_status === "flow");
}
{
  const env = world(`${DAY} 02:00`);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  setRiyadh(`${DAY} 03:10`);
  await say(env, AHMED_PHONE, { type: "button", button: { payload: "supplier_thanks", text: "شكراً" } });
  assert("a button tap opens his window too: the form goes", flowsTo(AHMED_PHONE).length === 1, kinds(AHMED_PHONE));
  const env2 = world(`${DAY} 02:00`);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env2, "ask_suppliers")));
  setRiyadh(`${DAY} 03:10`);
  await say(env2, AHMED_PHONE, { type: "audio", audio: { id: "MEDIA2", mime_type: "audio/ogg" } });
  assert("…and so does a voice note (nothing is read from it): «وصلتنا رسالتك», then the form", flowsTo(AHMED_PHONE).length === 1 && textsTo(AHMED_PHONE).some((x) => /وصلتنا رسالتك/.test(x)), kinds(AHMED_PHONE));
}
{
  const env = world(`${DAY} 02:00`);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  setRiyadh(`${DAY} 03:10`);
  setExtract({ prices: [{ product_id: 1, packaging_id: 11, cost_price: 22, market_price: null, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  await say(env, AHMED_PHONE, text("طماطم كرتون 22"));
  setExtract(null);
  assert("he answers the old template with his prices in text: they are kept — and no form is sent on top of them", dpRows().length === 1 && dpRows()[0].x_price_sar === 22 && flowsTo(AHMED_PHONE).length === 0 && !env.MSG_DEDUP.store.get(`pflow_owed:v1:${AHMED_PHONE}`), kinds(AHMED_PHONE));
  await say(env, AHMED_PHONE, text("هلا"));
  assert("…nor with a later message that day", flowsTo(AHMED_PHONE).length === 0);
}
{
  const env = world(`${DAY} 02:00`);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  seed("x_price_day", { x_date: DAY, x_state: "published", x_published_at: "2026-10-03 03:00:00", x_utak_simulation: false });
  setRiyadh(`${DAY} 06:30`);
  await say(env, AHMED_PHONE, text("هلا"));
  assert("after the day's publication the form is no longer owed (its reply would be refused)", flowsTo(AHMED_PHONE).length === 0 && !env.MSG_DEDUP.store.get(`pflow_owed:v1:${AHMED_PHONE}`));
  const env2 = world(`${DAY} 02:00`);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env2, "ask_suppliers")));
  setRiyadh("2026-10-04 09:00");
  await say(env2, AHMED_PHONE, text("هلا"));
  assert("…nor on another day", flowsTo(AHMED_PHONE).length === 0);
}
{
  const env = world(`${DAY} 02:00`);
  openWindow(env, AHMED_PHONE, 60);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  setRiyadh(`${DAY} 03:10`);
  await say(env, AHMED_PHONE, text("هلا"));
  assert("a source that got the FORM at 02:00 is owed nothing: his message brings no second one", flowsTo(AHMED_PHONE).length === 1 && !env.MSG_DEDUP.store.get(`pflow_owed:v1:${AHMED_PHONE}`));
}
{
  const env = world(`${DAY} 02:30`, null, true);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  setRiyadh(`${DAY} 04:30`);                                           // past the 90 minutes of a text reply
  await say(env, RAED_PHONE, text("تمام"));
  const f = flowsTo(RAED_PHONE);
  assert("Raed, asked by the old template at 02:30, writes «تمام»: the form at once — «أسعار السوق اليوم», the market VAT line — and nothing else", f.length === 1 && dataOf(f[0]).sub === "أسعار السوق اليوم" && String(dataOf(f[0]).note).startsWith(MARKET_LINE) && textsTo(RAED_PHONE).length === 0 && ownerTexts().filter((t) => /رسالة من مصدر الأسعار/.test(t)).length === 0, kinds(RAED_PHONE));
  await say(env, RAED_PHONE, text("وصل"));
  assert("…once: his next message is acknowledged, with no second form", flowsTo(RAED_PHONE).length === 1 && textsTo(RAED_PHONE).length === 1 && textsTo(RAED_PHONE)[0] === PS.OUTSIDE_SOURCE_ACK);
}

console.log("\n[و] «ما قدرنا نقرأ الأسعار…» by role");
{
  assert("a «سوق» source: its example is a market price, the market VAT line, and no word of «شراء»", !/شراء/.test(PS.marketUnreadText("market")) && /مثل «رمان كبير 26»\./.test(PS.marketUnreadText("market")) && /سعر السوق/.test(PS.marketUnreadText("market")) && PS.marketUnreadText("market").endsWith(MARKET_LINE), PS.marketUnreadText("market"));
  assert("a «شراء» source: a purchase price, «بدون ضريبة»", /سعر الشراء، مثل «رمان كبير 22»/.test(PS.marketUnreadText("purchase")) && /الأسعار بدون ضريبة\.$/.test(PS.marketUnreadText("purchase")) && !/شامل/.test(PS.marketUnreadText("purchase")));
  assert("no role: the text of before (the keyword rule still reads «شراء» beside a number)", PS.marketUnreadText(null) === PS.MARKET_UNREAD_TEXT && PS.marketUnreadText() === PS.MARKET_UNREAD_TEXT && /شراء 22/.test(PS.MARKET_UNREAD_TEXT));
  const env = world(`${DAY} 02:30`);
  openWindow(env, DRIVER_PHONE, 20);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  setRiyadh(`${DAY} 02:40`);
  setExtract({ prices: [], unrecognized: ["رمان"] });
  const r = await quiet(() => PS.handleMarketReply(env, { partnerId: DRIVER, employeeId: OMAR_EMP, name: "عمر المجهلي", digits: DRIVER_PHONE, role: "market" }, "رمان ١١", "wamid.U1"));
  const n = await quiet(() => PS.handleMarketReply(env, { partnerId: DRIVER, employeeId: OMAR_EMP, name: "عمر المجهلي", digits: DRIVER_PHONE, role: null }, "رمان ١١", "wamid.U2"));
  setExtract(null);
  assert("Omar («سوق») sends a line nothing can be read from: he is answered the «سوق» text — no «شراء 22» in it", r?.saved === 0 && r.reply === PS.marketUnreadText("market") && !/شراء/.test(r.reply) && n?.reply === PS.MARKET_UNREAD_TEXT, String(r?.reply));
}

console.log("\n[و] 05:00 — the reminder to the market sources that sent no price");
{
  const env = world(`${DAY} 02:30`, null, true);
  openWindow(env, DRIVER_PHONE, 20); openWindow(env, RAED_PHONE, 20);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  setRiyadh(`${DAY} 04:55`);
  assert("before 05:00: nothing", (await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60))).action === "before" && sentTo(DRIVER_PHONE).length === 1);
  setRiyadh(`${DAY} 05:00`);
  const r = await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60));
  const fo = flowsTo(DRIVER_PHONE), fr = flowsTo(RAED_PHONE);
  assert("05:00, Omar and Raed inside their windows and silent: ONE reminder each, as the form — «تذكير من يو تاك: ما وصلتنا أسعار السوق اليوم…», the market VAT line, «أدخل الأسعار»",
    r.action === "ran" && r.nudges?.every((n: any) => n.action === "flow") && fo.length === 2 && fr.length === 2 && /^تذكير من يو تاك: ما وصلتنا أسعار السوق اليوم للحين، نحتاجها قبل الساعة 6:00 صباحاً/.test(bodyOf(fo[1])) && bodyOf(fr[1]).endsWith(MARKET_LINE) && par(fr[1]).flow_cta === "أدخل الأسعار" && dataOf(fr[1]).v4 === true, JSON.stringify(r.nudges));
  setRiyadh(`${DAY} 05:05`);
  const reads = odooLog.length, sends = graph.length;
  const again = await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60));
  assert("…the tick again: no second reminder — and nothing asked of the gateway or read about their offers for it", again.nudges?.every((n: any) => n.action === "claimed_before") && flowsTo(DRIVER_PHONE).length === 2 && flowsTo(RAED_PHONE).length === 2 && graph.length === sends
    && !odooLog.slice(reads).some((l) => l.model === "x_price_offer" || l.model === "x_wa_message"), JSON.stringify(odooLog.slice(reads).map((l) => `${l.model}.${l.method}`)));
  assert("…a text reply within 90 minutes of the reminder is read as prices", await PS.awaitingMarketReply(env, RAED_PHONE, Date.now() + 60_000));
  setRiyadh(`${DAY} 06:00`);
  assert("from the publication time on: nothing", (await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60))).action === "after");
  assert("Ahmed (a supplier: his own 05:00 reminder) is not in this run", sentTo(AHMED_PHONE).length === 0);
}
{
  const env = world(`${DAY} 02:30`, null, true);
  openWindow(env, DRIVER_PHONE, 20); openWindow(env, RAED_PHONE, 20);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  await reply(env, DRIVER_PHONE, tokenOf(flowsTo(DRIVER_PHONE)[0]), { p1: "30" });                 // Omar by the form
  seed("x_price_offer", { x_product_tmpl_id: 2, x_packaging_id: 21, x_source_partner_id: RAED, x_date: DAY, x_purchase_price: 0, x_market_price: 12, x_status: "valid", x_utak_simulation: false });   // Raed in Odoo
  setRiyadh(`${DAY} 05:00`);
  const before = [sentTo(DRIVER_PHONE).length, sentTo(RAED_PHONE).length];
  const r = await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60));
  assert("a source that already sent a price today (by the form, or an offer row of the day) is not reminded", r.nudges?.every((n: any) => n.action === "replied") && sentTo(DRIVER_PHONE).length === before[0] && sentTo(RAED_PHONE).length === before[1], JSON.stringify(r.nudges));
}
{
  const env = world(`${DAY} 02:30`, ["APPROVED", "MARKETING"], true);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  setRiyadh(`${DAY} 05:00`);
  const r = await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60));
  assert("outside their windows, no usable Flow template (the 02:30 rule): utak_supplier_ask_v2 with today's items — Raed's second (02:30 and 05:00), and Omar's reminder",
    r.nudges?.every((n: any) => n.action === "old_template") && tplTo(RAED_PHONE, TPL_ASK).length === 2 && tplTo(DRIVER_PHONE, TPL_ASK).length === 1 && flowsTo(RAED_PHONE).length === 0 && /طماطم، خيار، بطاطس، بصل/.test(JSON.stringify(tplTo(DRIVER_PHONE, TPL_ASK)[0])), JSON.stringify(r.nudges) + kinds(DRIVER_PHONE));
  assert("…the form is owed to Raed (it goes with his first message); Omar's already waits in his team queue", !!env.MSG_DEDUP.store.get(`pflow_owed:v1:${RAED_PHONE}`) && !env.MSG_DEDUP.store.get(`pflow_owed:v1:${DRIVER_PHONE}`) && JSON.parse(env.MSG_DEDUP.store.get(`pending_loc:+${DRIVER_PHONE}`) ?? "[]")[0]?.flow?.interactive?.type === "flow");
}
{
  const env = world(`${DAY} 02:30`, ["APPROVED", "UTILITY"], true);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  setRiyadh(`${DAY} 05:00`);
  const r = await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60));
  assert("outside their windows with the template APPROVED and UTILITY: the reminder is that template (the same button), not the old one", r.nudges?.every((n: any) => n.action === "template") && tplTo(RAED_PHONE, TPL_FLOW).length === 2 && tplTo(RAED_PHONE, TPL_ASK).length === 0, JSON.stringify(r.nudges) + kinds(RAED_PHONE));
}
{
  // Sunday 2026-10-04: Omar's schedule gives him the day off
  const env = world("2026-10-04 05:00", null, true);
  const emp = table("hr.employee").get(OMAR_EMP)!;
  emp.x_utak_attendance = true;
  for (const a of rows("resource.calendar.attendance") as any[]) if (a.calendar_id === emp.resource_calendar_id && a.dayofweek === "6") table("resource.calendar.attendance").delete(a.id);
  openWindow(env, DRIVER_PHONE, 20); openWindow(env, RAED_PHONE, 20);
  const r = await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60));
  assert("an employee on his day off is not reminded (he was not asked either); the outside source is", r.nudges?.find((n: any) => n.name === "عمر المجهلي")?.action === "off" && sentTo(DRIVER_PHONE).length === 0 && r.nudges?.find((n: any) => n.name === "رائد")?.action === "flow" && flowsTo(RAED_PHONE).length === 1, JSON.stringify(r.nudges));
}
{
  const env = world(`${DAY} 02:30`);
  table("hr.employee").get(OMAR_EMP)!.x_utak_attendance = true;       // not tapped: his 02:30 ask is queued
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  setRiyadh(`${DAY} 05:00`); openWindow(env, DRIVER_PHONE, 60 * 20);
  const r = await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60));
  assert("Omar has not tapped «بدء الدوام» by 05:00 and his window is open: the reminder's form reaches him", r.nudges?.[0]?.action === "flow" && flowsTo(DRIVER_PHONE).length === 1, JSON.stringify(r.nudges));
  await reply(env, DRIVER_PHONE, tokenOf(flowsTo(DRIVER_PHONE)[0]), { p1: "30" });
  setRiyadh(`${DAY} 05:40`); openWindow(env, DRIVER_PHONE, 0);
  const before = sentTo(DRIVER_PHONE).length;
  await quiet(() => flushTeamQueue(env, `+${DRIVER_PHONE}`));
  assert("…he answers it, then taps: the 02:30 ask that waited in his queue is dropped — no form on top of prices that arrived", sentTo(DRIVER_PHONE).length === before && offerRows().length === 1, kinds(DRIVER_PHONE));
}
{
  const env = world(`${DAY} 05:00`, null, true);
  openWindow(env, DRIVER_PHONE, 20); openWindow(env, RAED_PHONE, 20);
  const t = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("the every-5-minutes tick runs the reminder (after the 02:30 ask of the same tick)", (t.marketNudge as any)?.action === "ran" && (t.marketAsk as any)?.action === "ran", JSON.stringify([t.marketAsk, t.marketNudge]));
}

console.log("\n[ز] the one trial to Baraa is of the v2 Flow");
{
  const env = world(`${DAY} 23:00`);
  // utak_price_ask_v1's trial went out earlier the same day (§ 51, 20:51): its key is not this Flow's
  env.MSG_DEDUP.store.set(`btnlock:v1:pflow_test:${DAY}`, "done:2026-10-03T17:51:00.000Z");
  const r = await quiet(() => FL.sendFlowTest(env));
  const f = flowsTo(OWNER);
  assert("the v1 trial of the same day does not use up the v2 trial: ONE form to Baraa's number, to nobody else", r.sent === true && f.length === 1 && graph.length === 1 && graph[0].to === OWNER, JSON.stringify(r));
  assert("…the v2 Flow, its heading and its text starting with «🧪 تجربة», today's items on their page", par(f[0]).flow_id === FL.PRICE_FLOW_ID && par(f[0]).flow_action_payload.screen === "PAGE_A" && String(dataOf(f[0]).t1) === "🧪 تجربة — فواكه" && bodyOf(f[0]).startsWith("🧪 تجربة") && dataOf(f[0]).v4 === true && dataOf(f[0]).m1 === false, `${dataOf(f[0]).t1} | ${bodyOf(f[0])}`);
  const before = JSON.stringify([dpRows(), offerRows(), rows("x_supplier_price_request_log"), rows("x_price_day")]);
  await say(env, OWNER, { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ p1: "22", flow_token: tokenOf(f[0]) }) } } });
  assert("…his reply writes NOTHING in Odoo, and is answered as a trial", JSON.stringify([dpRows(), offerRows(), rows("x_supplier_price_request_log"), rows("x_price_day")]) === before && /^🧪 تجربة — وصلت ✅ طماطم 22\./.test(bodyOf(sentTo(OWNER).at(-1))), bodyOf(sentTo(OWNER).at(-1)));
  assert("…a second trial of v2 the same day: nothing sent", (await quiet(() => FL.sendFlowTest(env))).reason === "already_today");
}

// ================================================================ the guide and the map
console.log("\n[ز] the guide and the map");
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  assert("OPERATING-DAY: the form's pages by category — «فواكه», «خضار», «ورقيات», «أخرى», «التالي» and «إرسال»", /صفحة لكل فئة/.test(guide) && /فواكه، ثم خضار، ثم ورقيات، ثم «أخرى»/.test(guide) && /«التالي»/.test(guide));
  assert("OPERATING-DAY: Raed, the outside market source, at 02:30 with no «بدء الدوام»", /رائد/.test(guide) && /لا ينتظر «بدء الدوام»/.test(guide));
  assert("OPERATING-DAY: the VAT line of each role", guide.includes(PURCHASE_LINE) && guide.includes(MARKET_LINE));
  assert("OPERATING-DAY: the form after the old template, and the 05:00 reminder to the market sources", /يصله النموذج فوراً/.test(guide) && /تذكير مصادر السوق/.test(guide));
  assert("OPERATING-DAY: the template of the form — utak_price_ask_flow_v2", /utak_price_ask_flow_v2/.test(guide));
  const claude = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
  assert("CLAUDE.md: the v2 Flow and its template by their numbers", /utak_price_ask_v2/.test(claude) && /1123704886881420/.test(claude) && /utak_price_ask_flow_v2/.test(claude));
}

done();
