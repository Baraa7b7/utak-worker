// § 53 (2026-10-04) — price privacy by role, the optional uplift on the market price, and the pay
// reminder that carries the IBAN.
//
//   [أ]  who sees which price — every path that reaches رائد (an outside «سوق» source), عمر (an
//        employee: buyer, driver, collector, and a «سوق» source), أحمد (a supplier, «شراء») and Baraa:
//        the form and its hints, the texts, the reminders, the day's list, the quotation, the owner's
//        messages, the purchase list, the inbound routing. The forbidden numbers are distinctive
//        (21.37, 33.33, 34.44 …): a message is searched for them as it leaves.
//   [ب]  «زيادة على سعر السوق ٪»: 0 = today's behaviour to the letter; 3 % (30 → 30.90 → 31); the
//        rounding; the exception after the uplift; the publication's own check
//        § 54 (2026-10-05) — re-based on the proposed decision and the day's review in ONE message
//        (src/price-review.ts): the exception's line is «بدون خسارة» (26.45 for a purchase of 20), no
//        longer the suggested price (29), so the day's two exceptions are markets of 26 and 25 (they
//        were 28 and 27, automatic at the market price since § 54); what Baraa read in a message per
//        exception he reads in the review and its form, and «انشر بسعر السوق» is a choice of the form.
//        § 55 (2026-10-05) — the review made plain: an item's line is its purchase price with × 1.15
//        beside it («شراء 21.37 (24.58 شامل)»), its market price, «ربحنا» — the board's net of a
//        carton, made from the purchase price — and its decision; the form's item says the same on
//        its first line, the suggested price against the market on its second, and each choice
//        carries its own profit. Who reads them is unchanged: Baraa alone.
//   [هـ] utak_pay_remind_iban_v1: approved UTILITY → it replaces the reminder of before; pending,
//        refused or MARKETING → the reminder of before; an IBAN that is no longer the company's → never
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s53.test.mts

import { readFileSync } from "node:fs";
import { CUST, CUST2, CUST2_PHONE, CUST_PHONE, OWNER, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, cost, dayOf, done, fresh, lineFor, ownerTexts, rejected, setExtract } from "./s46-kit.mts";

const FL = await import("../src/price-flow.ts");
const PS = await import("../src/price-sources.ts");
const EN = await import("../src/pricing-engine.ts");
const PR = await import("../src/prices.ts");
const PP = await import("../src/price-privacy.ts");
const OC = await import("../src/operating-cost.ts");
const OUT = await import("../src/outreach.ts");
const TEAM = await import("../src/team.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const { textContent } = await import("../src/meta.ts");
const { clearTemplateCache } = await import("../src/templates.ts");
const worker = (await import("../src/index.ts")).default;
const PRV = await import("../src/price-review.ts");
// @ts-ignore — plain .mjs helpers
const ODOO = await import("../scripts/lib/s53-odoo.mjs");
// @ts-ignore
const TPL = await import("../scripts/lib/s53-templates.mjs");

const RAED = 880, RAED_PHONE = "966550689078";
/** Distinctive numbers: a message that carries one of them shows where it came from. */
const AHMED_PRICE = 21.37, OMAR_MARKET = 33.33, RAED_MARKET = 34.44, TYPED_IN_ODOO = 55.55, SALE_ON_ROW = 29.29;

const world = (riyadh = `${DAY} 02:30`): any => {
  const env = fresh(riyadh); cost(500); setExtract(null);
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 6;
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  Object.assign(table("res.partner").get(AHMED)!, { x_price_role: "purchase", customer_rank: 0, phone: "+" + AHMED_PHONE });
  seed("res.partner", { id: RAED, name: "رائد", phone: "+" + RAED_PHONE, x_whatsapp_number: "+" + RAED_PHONE, x_wa_allowed: true, x_price_source: true, x_price_role: "market", customer_rank: 0, supplier_rank: 0, x_contact_class: "supplier" });
  for (const [purpose, name, n] of [["supplier_ask", "utak_supplier_ask_v2", 2], ["supplier_confirm", "utak_supplier_confirm_v1", 2], ["supplier_price_nudge", "utak_supplier_price_nudge", 2], ["price_ask_flow", "utak_price_ask_flow_v2", 1], ["customer_welcome", "utak_welcome", 2]] as Array<[string, string, number]>) {
    seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: n, x_category: "UTILITY" });
  }
  return env;
};
/** What each source sent before (rows with his message's id), and a row typed in Odoo under each name (no message id). */
function history(): void {
  const day = "2026-10-02";
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: AHMED_PRICE, x_sale_price: SALE_ON_ROW, x_date: day, x_extraction_status: "flow", x_source_message_id: "wamid.A1" });
  seed("x_daily_price", { x_product_tmpl_id: 2, x_packaging_id: 21, x_supplier_id: AHMED, x_price_sar: TYPED_IN_ODOO, x_date: day, x_extraction_status: "confirmed", x_source_message_id: false });
  const offer = (partner: number, product: number, packaging: number, market: number, msg: string | false, emp: number | false = false) =>
    seed("x_price_offer", { x_product_tmpl_id: product, x_packaging_id: packaging, x_source_partner_id: partner, x_source_employee_id: emp, x_date: day, x_purchase_price: 0, x_market_price: market, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false, x_source_message_id: msg });
  offer(DRIVER, 1, 11, OMAR_MARKET, "wamid.O1", OMAR_EMP);
  offer(DRIVER, 2, 21, TYPED_IN_ODOO, false, OMAR_EMP);
  offer(RAED, 1, 11, RAED_MARKET, "wamid.R1");
  offer(RAED, 2, 21, TYPED_IN_ODOO, false);
}
const ahmedSrc = { partnerId: AHMED, name: "أحمد حسان", whatsapp: "+" + AHMED_PHONE, supplier: true, role: "purchase" as const };
const omarSrc = { partnerId: DRIVER, employeeId: OMAR_EMP, name: "عمر المجهلي", whatsapp: "+" + DRIVER_PHONE, supplier: false, role: "market" as const };
const raedSrc = { partnerId: RAED, employeeId: null, name: "رائد", whatsapp: "+" + RAED_PHONE, supplier: false, role: "market" as const };
/** Everything a recipient can read in a message: every text of it (the values, never the data's key names «h29», «p31»…). */
const leaves = (v: unknown): string[] => typeof v === "string" ? [v] : typeof v === "number" ? [String(v)] : v && typeof v === "object" ? Object.values(v as object).flatMap(leaves) : [];
const body = (b: any) => leaves(b).join("\n");
const allTo = (d: string) => sentTo(d).map(body).join("\n");
const has = (text: string, n: number) => new RegExp(`(?<![0-9.])${String(n).replace(".", "\\.")}(?![0-9])`).test(text);
const hints = (data: Record<string, unknown>) => Object.entries(data).filter(([k, v]) => /^h\d+$/.test(k) && v !== "-").map(([, v]) => String(v));
const tplTo = (d: string, name: string) => sentTo(d).filter((b: any) => b?.template?.name === name);
const params = (b: any): string[] => b.template.components.find((c: any) => c.type === "body").parameters.map((p: any) => p.text);
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (t: string) => ({ type: "text", text: { body: t } });
const gw = async (env: any, purpose: string, to: string, t = "اختبار") => gatewayDecision(await quiet(() => sendViaGateway(env, { purpose, to, content: textContent(t) })));
/** § 54 — the day's review as it reached Baraa (the last one): one interactive message, three buttons. */
const reviewsToOwner = () => sentTo(OWNER).filter((b: any) => b?.interactive?.type === "button" && /مراجعة أسعار اليوم/.test(String(b.interactive?.body?.text)));
const reviewBody = () => String(reviewsToOwner().at(-1)?.interactive?.body?.text ?? "");
/** «✏️ عدّل» tapped under it: the form (a Flow) as it was sent — each item's two lines (its numbers, its suggested price against the market) and choices, by name — and its answer. */
async function reviewForm(env: any) {
  const action = await quiet(() => PRV.handlePriceReviewButton(env, `prv_r_${dayOf().id}_1`));
  const sent = sentTo(OWNER).filter((b: any) => b?.interactive?.type === "flow");
  const p = sent.at(-1)?.interactive.action.parameters;
  const token = String(p?.flow_token ?? "");
  const rec = await PRV.readReviewFormToken(env, token);
  const data = (p?.flow_action_payload.data ?? {}) as Record<string, any>;
  const slot = (name: string): number => rec?.items.find((i: any) => i.name === name)?.slot ?? 0;
  return {
    action, sent, token, slot,
    info: (name: string) => String(data[`x${slot(name)}`] ?? ""),
    info2: (name: string) => String(data[`y${slot(name)}`] ?? ""),
    item: (name: string) => rec?.items.find((i: any) => i.name === name) as any,
    options: (name: string) => (data[`o${slot(name)}`] ?? []) as Array<{ id: string; title: string }>,
    answer: (values: Record<string, string>) => quiet(() => PRV.handlePriceReviewReply(env, { from: "+" + OWNER, messageId: `wamid.RV${Math.random()}`, flow: { token, values } })),
  };
}

// ================================================================ [أ] the form: the hint is his own number, or nothing
console.log("\n[أ] the price form — رائد (an outside source) is shown no price at all");
{
  const env = world(); history();
  odooLog.length = 0;
  const p = (await quiet(() => FL.prepareFlowAsk(env, raedSrc)))!;
  const priceReads = odooLog.filter((l: any) => l.model === "x_price_offer" || l.model === "x_daily_price").length;
  const all = body(p.data) + body(p.session.body);
  assert("his four fields carry «السعر بالريال» (or the packaging and it): no «آخر سعر», no «لا سعر سابق»",
    hints(p.data).length === 4 && hints(p.data).every((h) => h.endsWith(FL.NO_PRICE_HINT)) && !/آخر سعر|سعر سابق/.test(all), hints(p.data).join(" | "));
  assert("…not his own last number (34.44, sent in his own message), nor the one typed in Odoo under his name, nor Ahmed's, nor Omar's",
    ![RAED_MARKET, TYPED_IN_ODOO, AHMED_PRICE, OMAR_MARKET, SALE_ON_ROW].some((n) => has(all, n)), all.slice(0, 200));
  assert("no digit in any hint or label of his form", Object.entries(p.data).filter(([k]) => /^[hl]\d+$/.test(k)).every(([, v]) => !/[0-9٠-٩]/.test(String(v))));
  assert("…and no price row was read for it (nothing of x_price_offer / x_daily_price is asked for his hints)", FL.isOutsideSource(raedSrc) === true && priceReads === 0, String(priceReads));
  assert("the token keeps the same hints: «تعديل» opens the form with no price but what he typed", p.record.items.every((i: any) => !/[0-9٠-٩]/.test(i.hint)));
  assert("the line above the fields is the market's VAT line — a rule, not a price", String(p.data.note).startsWith("اكتب السعر زي ما ينباع في السوق (شامل الضريبة)."));
}

console.log("\n[أ] the price form — عمر (an employee, «سوق»): his own market number, the one he sent himself");
{
  const env = world(); history();
  const p = (await quiet(() => FL.prepareFlowAsk(env, omarSrc)))!;
  const all = body(p.data) + body(p.session.body);
  assert("طماطم: «آخر سعر: 33.33» — his own observation, from his own message", p.data.h1 === "آخر سعر: 33.33", String(p.data.h1));
  assert("خيار: «لا سعر سابق» — the row typed in Odoo under his name (55.55, no message of his) is not shown", p.data.h2 === FL.NO_LAST_PRICE && !has(all, TYPED_IN_ODOO), String(p.data.h2));
  assert("never Ahmed's purchase price (21.37), its fallback sale price (29.29), nor رائد's number (34.44)", ![AHMED_PRICE, SALE_ON_ROW, RAED_MARKET].some((n) => has(all, n)));
  assert("an employee is not an outside source", FL.isOutsideSource(omarSrc) === false);
}

console.log("\n[أ] the price form — أحمد (a supplier, «شراء»): his own prices alone");
{
  const env = world(); history();
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  const all = body(p.data) + body(p.session.body);
  assert("طماطم: «آخر سعر: 21.37» — the price he sent", p.data.h1 === "آخر سعر: 21.37", String(p.data.h1));
  assert("خيار: «لا سعر سابق» — a row typed in Odoo under his name is not shown back to him", p.data.h2 === FL.NO_LAST_PRICE && !has(all, TYPED_IN_ODOO), String(p.data.h2));
  assert("never the market (33.33, 34.44), nor the sale price kept on his own row (x_sale_price 29.29)", ![OMAR_MARKET, RAED_MARKET, SALE_ON_ROW].some((n) => has(all, n)));
  assert("the heading is «أسعار الشراء اليوم» and the line «الأسعار بدون ضريبة.»", p.data.sub === "أسعار الشراء اليوم" && String(p.data.note).startsWith("الأسعار بدون ضريبة."));
}

console.log("\n[أ] another source's last prices fill the hints of the trial to Baraa alone");
{
  const env = world(); history();
  const leak = (await quiet(() => FL.prepareFlowAsk(env, raedSrc, { hintsFrom: { partnerId: AHMED, supplier: true } })))!;
  assert("`hintsFrom` on an ask that is not the trial is ignored: رائد's form still carries no price", !has(body(leak.data), AHMED_PRICE) && hints(leak.data).every((h) => h.endsWith(FL.NO_PRICE_HINT)), hints(leak.data).join(" | "));
  const omar = (await quiet(() => FL.prepareFlowAsk(env, omarSrc, { hintsFrom: { partnerId: AHMED, supplier: true } })))!;
  assert("…and عمر's form still carries his own number, not Ahmed's", omar.data.h1 === "آخر سعر: 33.33" && !has(body(omar.data), AHMED_PRICE));
  openWindow(env, OWNER, 1);
  const t = await quiet(() => FL.sendFlowTest(env));
  const f = sentTo(OWNER).filter((b: any) => b?.interactive?.type === "flow");
  assert("the trial goes to Baraa's own number, with the purchase source's last price (he sees everything)", t.sent === true && f.length === 1 && body(f[0]).includes("آخر سعر: 21.37"), JSON.stringify(t));
  assert("…and to nobody else", [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE].every((d) => sentTo(d).length === 0));
}

console.log("\n[أ] the ask, the reminder, the answer and «ما قدرنا نقرأ…»: what reaches each of them");
{
  const env = world(`${DAY} 02:30`); history();
  for (const d of [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE]) openWindow(env, d, 5);
  for (const s of [raedSrc, omarSrc, ahmedSrc]) await quiet(() => FL.sendFlowAsk(env, s));
  const raed = allTo(RAED_PHONE), omar = allTo(DRIVER_PHONE), ahmed = allTo(AHMED_PHONE);
  assert("each got one form", [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE].every((d) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow").length === 1));
  assert("رائد: no purchase, market, sale or typed number of anyone", ![AHMED_PRICE, OMAR_MARKET, RAED_MARKET, TYPED_IN_ODOO, SALE_ON_ROW].some((n) => has(raed, n)));
  assert("عمر: his own 33.33 and nothing of Ahmed's or رائد's", has(omar, OMAR_MARKET) && ![AHMED_PRICE, RAED_MARKET, SALE_ON_ROW, TYPED_IN_ODOO].some((n) => has(omar, n)));
  assert("أحمد: his own 21.37 and nothing of the market's", has(ahmed, AHMED_PRICE) && ![OMAR_MARKET, RAED_MARKET, SALE_ON_ROW, TYPED_IN_ODOO].some((n) => has(ahmed, n)));
  // the answer to a form: what he typed, to him alone
  const token = sentTo(RAED_PHONE).find((b: any) => b?.interactive?.type === "flow").interactive.action.parameters.flow_token;
  graph.length = 0;
  await quiet(() => FL.handlePriceFlowReply(env, { from: "+" + RAED_PHONE, messageId: "wamid.R9", flow: { token, values: { p1: "36.36" } } }));
  const ack = allTo(RAED_PHONE);
  assert("رائد's answer «وصلت ✅ طماطم 36.36» carries the number he typed and no other price", has(ack, 36.36) && ![AHMED_PRICE, OMAR_MARKET, RAED_MARKET, SALE_ON_ROW].some((n) => has(ack, n)), ack.slice(0, 160));
  assert("…and it reached nobody else (the outlier or any note about it is Baraa's)", sentTo(DRIVER_PHONE).length === 0 && sentTo(AHMED_PHONE).length === 0);
  assert("the reminder's text names no price", !/[0-9٠-٩]{2}\.[0-9]/.test(FL.flowNudgeText("05:30", "market")) && !/[0-9]/.test(FL.flowNudgeText("", "market").replace("الساعة", "")));
  assert("«ما قدرنا نقرأ الأسعار…» to an outside source: no number at all, not even an example's", !/[0-9٠-٩]/.test(PS.marketUnreadText("market", true)) && !/[0-9٠-٩]/.test(PS.marketUnreadText(null, true)) && !/[0-9٠-٩]/.test(PS.marketUnreadText("purchase", true)) && !/شراء/.test(PS.marketUnreadText("market", true)));
  assert("…to عمر (an employee, «سوق») the text of § 52, with no «شراء»", PS.marketUnreadText("market") === PS.marketUnreadText("market", false) && !/شراء/.test(PS.marketUnreadText("market")));
}

console.log("\n[أ] رائد answers in text something that cannot be read: his reply shows no number");
{
  const env = world(`${DAY} 02:40`);
  openWindow(env, RAED_PHONE, 1);
  await quiet(() => PS.writeMarketAskMarker(env, RAED_PHONE, DAY, Date.now() - 60_000));
  setExtract({ prices: [] });
  const r = await quiet(() => PS.tryMarketReply(env, { partnerId: RAED, name: "رائد" }, "+" + RAED_PHONE, "رمان ١١", "wamid.RX"));
  assert("he is told to write the item's full name and its market price — with no example number", r === PS.marketUnreadText("market", true) && !!r && !/[0-9٠-٩]/.test(r), String(r));
  setExtract(null);
}

// ================================================================ [أ] the day's list and the quotation never reach a source or a supplier
console.log("\n[أ] the customers' price list: never a price source, never a supplier — by the partner and by the number");
{
  const env = world(`${DAY} 06:00`);
  // a second partner on رائد's number and one on Ahmed's, both customers nobody is holding (the state a failed lookup leaves behind)
  seed("res.partner", { id: 881, name: "رائد (عميل مكرر)", x_whatsapp_number: "+" + RAED_PHONE, customer_rank: 1, x_contact_class: "customer" });
  seed("res.partner", { id: 882, name: "أحمد (عميل مكرر)", x_whatsapp_number: "0" + AHMED_PHONE.slice(3), customer_rank: 1, x_contact_class: "customer" });
  // a supplier that also carries a customer rank, and a source flagged on a customer's own card
  Object.assign(table("res.partner").get(AHMED)!, { customer_rank: 2, x_contact_class: "customer" });
  seed("res.partner", { id: 883, name: "مصدر وعميل", x_whatsapp_number: "+966500000883", customer_rank: 1, x_price_source: true, x_contact_class: "customer" });
  const list = await quiet(() => PR.priceRecipients(env));
  assert("the two real customers are on the list", [CUST, CUST2].every((id) => list.some((r: any) => r.id === id)), JSON.stringify(list.map((r: any) => r.id)));
  assert("not رائد, not Ahmed, not the second partners on their numbers (0550… = +966550…), not a customer flagged «مصدر أسعار»",
    ![RAED, AHMED, 881, 882, 883].some((id) => list.some((r: any) => r.id === id)), JSON.stringify(list.map((r: any) => r.id)));
  assert("not عمر (the team, by the roster)", !list.some((r: any) => r.phone === "+" + DRIVER_PHONE));
  // the gateway, whoever addressed it
  for (const d of [RAED_PHONE, AHMED_PHONE]) openWindow(env, d, 1);
  openWindow(env, CUST_PHONE, 1);
  graph.length = 0;
  const toRaed = await gw(env, "customer_prices", "+" + RAED_PHONE, "• طماطم (كرتون): 31 ر.س");
  const toAhmed = await gw(env, "customer_quotation", "+" + AHMED_PHONE, "عرض السعر");
  const toAhmedLocal = await gw(env, "customer_quotation_pdf", "0" + AHMED_PHONE.slice(3), "عرض السعر");
  const toRaedForm = await gw(env, "customer_order_form", "+" + RAED_PHONE, "نموذج الطلب");
  assert("the gateway refuses the day's list, a quotation, its PDF and the order form to their numbers, their windows open", [toRaed, toAhmed, toAhmedLocal, toRaedForm].every((d) => d?.action === "refused" && /PricePrivacy/.test(String((d as any).reason))), JSON.stringify([toRaed, toAhmed, toAhmedLocal, toRaedForm]));
  assert("…nothing reached them", sentTo(RAED_PHONE).length === 0 && sentTo(AHMED_PHONE).length === 0 && heldFor(env, RAED_PHONE).length === 0 && heldFor(env, AHMED_PHONE).length === 0);
  assert("…Baraa is told once per number («🔒 حُجبت رسالة … عن مصدر أسعار / مورد»), with no price in it", ownerTexts().filter((t) => /🔒 حُجبت رسالة/.test(t)).length === 2 && ownerTexts().some((t) => /مصدر أسعار «رائد»/.test(t)) && ownerTexts().some((t) => /مورد «أحمد حسان»/.test(t)) && !ownerTexts().some((t) => /🔒/.test(t) && has(t, 31)), ownerTexts().join(" | "));
  const toCust = await gw(env, "customer_prices", "+" + CUST_PHONE, "• طماطم (كرتون): 31 ر.س");
  assert("a customer gets it as before", toCust?.action === "session" && sentTo(CUST_PHONE).length === 1, JSON.stringify(toCust));
  const toOmar = await gw(env, "customer_prices", "+" + DRIVER_PHONE, "• طماطم (كرتون): 31 ر.س");
  assert("عمر is not closed: the sale price is the one price he may see (he is simply not on the customers' list)", toOmar?.action !== "refused" || !/PricePrivacy/.test(String((toOmar as any).reason)), JSON.stringify(toOmar));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] the closed numbers unreadable at the publication: the partner's own flags still keep it off the list");
{
  const env = world(`${DAY} 06:00`);
  Object.assign(table("res.partner").get(AHMED)!, { customer_rank: 2, x_contact_class: "customer", x_price_source: false });
  seed("res.partner", { id: 883, name: "مصدر وعميل", x_whatsapp_number: "+966500000883", customer_rank: 1, x_price_source: true, x_contact_class: "customer" });
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/res.partner/search_read") && String(init?.body ?? "").includes('"|"')) return new Response("{}", { status: 500 });
    return real(input as any, init);
  }) as typeof fetch;
  const list = await quiet(() => PR.priceRecipients(env));
  globalThis.fetch = real;
  assert("a supplier with a customer rank (supplier_rank) and a customer flagged «مصدر أسعار» are left out; the customers stay", !list.some((r: any) => r.id === AHMED || r.id === 883) && [CUST, CUST2].every((id) => list.some((r: any) => r.id === id)), JSON.stringify(list.map((r: any) => r.id)));
}

console.log("\n[أ] a number that cannot be verified gets no price-bearing message (Odoo unreadable, nothing kept)");
{
  const env = world(`${DAY} 06:00`);
  openWindow(env, CUST_PHONE, 1);
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/res.partner/search_read") && String(init?.body ?? "").includes("x_price_source")) return new Response("{}", { status: 500 });
    return real(input as any, init);
  }) as typeof fetch;
  const d = await gw(env, "customer_prices", "+" + CUST_PHONE, "• طماطم (كرتون): 31 ر.س");
  globalThis.fetch = real;
  assert("refused, not guessed («PricePrivacyUnverified»)", d?.action === "refused" && /PricePrivacyUnverified/.test(String((d as any).reason)) && sentTo(CUST_PHONE).length === 0, JSON.stringify(d));
  const again = await gw(env, "customer_prices", "+" + CUST_PHONE, "• طماطم (كرتون): 31 ر.س");
  assert("…and the next send, Odoo back, goes (a failed read is not kept)", again?.action === "session" && sentTo(CUST_PHONE).length === 1, JSON.stringify(again));
  assert("the closed numbers are then kept five minutes: one read for the sends of those minutes", !!env.MSG_DEDUP.store.get(PP.CLOSED_KV_KEY) && PP.CLOSED_TTL_SECONDS === 300);
}

console.log("\n[أ] the closed numbers: every price source and supplier, by «x_whatsapp_number» and by «phone»");
{
  const env = world();
  seed("res.partner", { id: 884, name: "مورد برقم في الهاتف فقط", phone: "+966500000884", x_whatsapp_number: false, supplier_rank: 1 });
  const list = await quiet(() => PP.readClosedNumbers(env));
  assert("رائد is a «source», Ahmed a «supplier»; a supplier whose number sits in «phone» alone is there too", list.some((c: any) => c.id === RAED && c.kind === "source") && list.some((c: any) => c.id === AHMED && c.kind === "supplier") && list.some((c: any) => c.id === 884 && c.digits === "966500000884"), JSON.stringify(list));
  assert("عمر (an employee) and the customers are not closed", !list.some((c: any) => c.id === DRIVER || c.id === CUST || c.id === CUST2));
  assert("«0550689078», «966550689078» and «+966550689078» are one number", PP.sameNumber("0550689078", "+" + RAED_PHONE) && PP.sameNumber(RAED_PHONE, "+" + RAED_PHONE) && !PP.sameNumber("+966550689079", RAED_PHONE) && !PP.sameNumber("", RAED_PHONE));
  assert("what carries our sale prices to a customer: the day's list, the quotation (text and PDF), the order form — and (§ 55 ب) the team's delivery form", JSON.stringify([...PP.CUSTOMER_PRICE_PURPOSES].sort()) === JSON.stringify(["customer_order_form", "customer_prices", "customer_quotation", "customer_quotation_pdf", "delivery_form"]));
}

// ================================================================ [أ] what is Baraa's reaches Baraa alone
console.log("\n[أ] the owner's messages — the day's review with the purchase price and the market, his copy, his alerts — reach his number alone");
{
  const env = world(`${DAY} 04:10`);
  for (const d of [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE, CUST_PHONE]) openWindow(env, d, 1);
  // § 54 — owner_price_exception is the day's review now (its message, its form, their answers); price_review_test is its one trial
  const OWNER_PURPOSES = ["owner_alert", "owner_summary", "owner_window", "owner_team_note", "owner_prices", "owner_price_exception", "owner_price_review", "owner_order_confirmed", "conv_open_owner", "price_flow_test", "price_review_test"];
  const out: string[] = [];
  for (const p of OWNER_PURPOSES) for (const d of [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE, CUST_PHONE]) {
    const r = await gw(env, p, "+" + d, "الشراء (بدون ضريبة): 21.37 · السوق: 33.33 · ربح الوحدة: 5.96");
    if (r?.action !== "refused" || !/OwnerOnlyPurpose/.test(String((r as any).reason))) out.push(`${p}→${d}`);
  }
  assert("each of the owner's eleven purposes (the day's review and its trial among them) is refused for رائد, عمر, أحمد and a customer, their windows open", out.length === 0 && OWNER_PURPOSES.length === 11 && OWNER_PURPOSES.includes(PRV.REVIEW_PURPOSE) && OWNER_PURPOSES.includes(PRV.REVIEW_TEST_PURPOSE), out.join(" "));
  assert("…nothing sent, nothing held for them", [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE, CUST_PHONE].every((d) => sentTo(d).length === 0 && heldFor(env, d).length === 0));
  const mine = await gw(env, "owner_price_exception", "+" + OWNER, "الشراء (بدون ضريبة): 21.37");
  assert("to Baraa's own number they go as before", mine?.action === "session" && sentTo(OWNER).length === 1, JSON.stringify(mine));
}

console.log("\n[أ] a real morning: the day's review (purchase, market, «ربحنا», the proposed decision — the suggested price against the market in its form) reaches Baraa and nobody else");
{
  const env = world(`${DAY} 04:10`);
  for (const d of [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE, CUST_PHONE]) openWindow(env, d, 1);
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: AHMED_PRICE, x_date: DAY, x_extraction_status: "flow", x_source_message_id: "wamid.A2" });
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: RAED, x_date: DAY, x_purchase_price: 0, x_market_price: 25.25, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false, x_source_message_id: "wamid.R2" });
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const n = await quiet(() => PRV.notifyPriceReviewMessage(env));
  const mine = ownerTexts().join("\n");
  // § 55 — the purchase with × 1.15 beside it: 21.37 × 1.15 = 24.5755 → 24.58 «شامل». «ربحنا» is made from the full cost of that purchase:
  // 21.37 + waste 5 % 1.07 + the carton share 2 = 24.44; at the market 25.25: 25.25 ÷ 1.15 = 21.96 − 24.44 = −2.48
  assert("Baraa reads it all, in ONE message: the purchase 21.37 (24.58 «شامل» beside it), the market 25.25, what a carton makes there («ربحنا» −2.48) and the proposed decision", n.action === "sent" && sentTo(OWNER).length === 1 && has(mine, AHMED_PRICE) && has(mine, 24.58) && has(mine, 25.25) && lineFor(1).x_cost_price === AHMED_PRICE && lineFor(1).x_full_cost === 24.44 && mine.split("\n").includes("❌ طماطم — شراء 21.37 (24.58 شامل) · سوق 25.25 | ربحنا بسعر السوق: −2.48 ← لا تنشر"), mine.slice(0, 300));
  const f = await reviewForm(env);
  // the suggested price (24.44 + 2) × 1.15 = 30.406 → 30.50: 5.25 above the market (5.25 ÷ 25.25 = 20.8 %), and 30.50 ÷ 1.15 = 26.52 − 24.44 = +2.08
  assert("…and in its form («✏️ عدّل») the same purchase price (21.37, 24.58 «شامل») on the item's first line, the suggested price against the market on its second, sent to his number", f.action === "form" && f.sent.length === 1 && f.info("طماطم") === "شراء 21.37 (24.58 شامل) · سوق 25.25 · ربحنا بسعر السوق: −2.48" && f.info2("طماطم") === "سعرنا المقترح 30.50 = أعلى من السوق بـ 5.25 (+20.8%)", `${f.info("طماطم")} | ${f.info2("طماطم")}`);
  assert("…each choice with its own profit, and «بدون خسارة» (28.11) on the line in Odoo and in the form's record", JSON.stringify(f.options("طماطم")) === JSON.stringify([{ id: "profit", title: "بالمقترح 30.50 (ربح +2.08)" }, { id: "market", title: "بسعر السوق 25.25 (ربح −2.48)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]) && lineFor(1).x_break_even === 28.11 && f.item("طماطم")?.breakEven === 28.11, JSON.stringify([f.options("طماطم"), f.item("طماطم")?.breakEven]));
  assert("رائد, عمر, أحمد and a customer were sent nothing by the engine's run, the review or its form", [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE, CUST_PHONE].every((d) => sentTo(d).length === 0 && heldFor(env, d).length === 0));
  // the same texts under the review's own purpose (or its trial's), addressed to anybody else: the review's body and — § 55 —
  // the first line of its form's item, which both carry the purchase price itself (and «ربحنا», made from it)
  const leaked: string[] = [];
  for (const p of [PRV.REVIEW_PURPOSE, PRV.REVIEW_TEST_PURPOSE]) for (const d of [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE, CUST_PHONE]) for (const [what, t] of [["review", reviewBody()], ["form", f.info("طماطم")]]) {
    const r = await gw(env, p, "+" + d, t);
    if (r?.action !== "refused" || !/OwnerOnlyPurpose/.test(String((r as any).reason))) leaked.push(`${p}:${what}→${d}`);
  }
  assert("the review's own text and its form's line (each carries the purchase 21.37), addressed with its purpose (or its trial's) to رائد, عمر, أحمد or a customer, are refused by the gateway («OwnerOnlyPurpose»): nothing sent, nothing held", has(reviewBody(), AHMED_PRICE) && has(reviewBody(), 24.58) && has(f.info("طماطم"), AHMED_PRICE) && leaked.length === 0 && [RAED_PHONE, DRIVER_PHONE, AHMED_PHONE, CUST_PHONE].every((d) => sentTo(d).length === 0 && heldFor(env, d).length === 0), leaked.join(" "));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [أ] عمر: the purchase list, the collection
console.log("\n[أ] عمر's purchase list names items and quantities — never the purchase price its rows carry");
{
  const items = [
    { product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 7, order_ids: [1], unit_price: AHMED_PRICE, price_supplier_id: AHMED },
    { product_id: 2, product_name: "خيار", packaging_id: 21, packaging_name: "جرم", total_quantity: 3, order_ids: [1], unit_price: 18.18, price_supplier_id: AHMED },
  ];
  const full = TEAM.renderPurchaseListMessage(items as any), line = TEAM.purchaseListLine(items as any);
  assert("the message: «1. طماطم — كرتون × 7» — no 21.37, no 18.18, no «ريال»", /1\. طماطم — كرتون × 7/.test(full) && ![AHMED_PRICE, 18.18].some((n) => has(full, n) || has(line, n)) && !/ريال|ر\.س|سعر/.test(full + line), full);
}

// ================================================================ [أ] the inbound: a source's or a supplier's number never enters the customer path
console.log("\n[أ] رائد writes while a customer partner sits on his number: no welcome, no customer reply, no quotation");
{
  const env = world(`${DAY} 10:00`);
  seed("res.partner", { id: 881, name: "رائد (عميل مكرر)", x_whatsapp_number: "+" + RAED_PHONE, customer_rank: 1, x_contact_class: "customer" });
  const before = rows("res.partner").length, orders = rows("x_daily_order").length;
  setExtract({ items: [{ product_id: 1, packaging_id: 11, quantity: 26, product_name_raw: "طماطم" }] });
  await say(env, RAED_PHONE, text("طماطم 26"));
  setExtract(null);
  const got = sentTo(RAED_PHONE);
  assert("he is answered «وصلتنا رسالتك في يو تاك…» — not the customer bot", got.length === 1 && got[0]?.text?.body === PS.OUTSIDE_SOURCE_ACK, JSON.stringify(got.map((b: any) => b.template?.name ?? b.text?.body ?? b.interactive?.type)));
  assert("no welcome template, no order, no quotation, no partner made", tplTo(RAED_PHONE, "utak_welcome").length === 0 && rows("x_daily_order").length === orders && rows("x_quotation").length === 0 && rows("res.partner").length === before);
  assert("Baraa gets one line with what he wrote", ownerTexts().some((t) => /رسالة من مصدر الأسعار «رائد»/.test(t)));
}

console.log("\n[أ] a supplier whose number the supplier lookup does not give (kept in «phone» alone): never a customer");
{
  const env = world(`${DAY} 10:00`);
  seed("res.partner", { id: 884, name: "مورد الهاتف", phone: "+966500000884", x_whatsapp_number: false, supplier_rank: 1 });
  const before = rows("res.partner").length;
  await say(env, "966500000884", text("السلام عليكم"));
  assert("no customer partner is made for his number, and no welcome reaches him", rows("res.partner").length === before && tplTo("966500000884", "utak_welcome").length === 0, JSON.stringify(sentTo("966500000884").map((b: any) => b.template?.name ?? b.text?.body)));
  assert("he is answered that the team will look at it", sentTo("966500000884").some((b: any) => b?.text?.body === PS.OUTSIDE_SOURCE_ACK));
}

console.log("\n[أ] Baraa's own number on a supplier partner (as «براء - اختبار» on the tenant): his messages stay the owner's");
{
  const env = world(`${DAY} 10:00`);
  seed("res.partner", { id: 885, name: "براء - اختبار", phone: "+" + OWNER, x_whatsapp_number: false, supplier_rank: 1 });
  await say(env, OWNER, text("السلام عليكم"));
  await say(env, OWNER, { type: "image", image: { id: "MEDIA-OWNER-1", mime_type: "image/jpeg", sha256: "x" } });
  assert("he is never answered as an outside source — a text or an image — and no line about «مصدر الأسعار» is raised", !sentTo(OWNER).some((b: any) => b?.text?.body === PS.OUTSIDE_SOURCE_ACK) && !ownerTexts().some((t) => /رسالة من مصدر الأسعار/.test(t)), JSON.stringify(sentTo(OWNER).map((b: any) => b.template?.name ?? b.text?.body)));
}

console.log("\n[أ] a new customer still gets his welcome and his partner (the check costs him nothing)");
{
  const env = world(`${DAY} 10:00`);
  const before = rows("res.partner").length;
  await say(env, "966500000777", text("السلام عليكم"));
  assert("a partner is made and the welcome goes", rows("res.partner").length === before + 1 && tplTo("966500000777", "utak_welcome").length === 1, JSON.stringify(sentTo("966500000777").map((b: any) => b.template?.name ?? b.text?.body)));
}

// ================================================================ [ب] the uplift
console.log("\n[ب] «زيادة على سعر السوق ٪»: the sale price of a market price");
{
  assert("the order's example: market 30, uplift 3 % → 30.90 → 31", EN.upliftedSale(30, 3) === 31);
  assert("0 = the market price as it is — nothing is rounded (28.75 stays 28.75, 31.05 stays 31.05)", EN.upliftedSale(28.75, 0) === 28.75 && EN.upliftedSale(31.05, 0) === 31.05 && EN.upliftedSale(30, 0) === 30);
  assert("an empty, a negative or an unreadable value is no uplift", [false, null, undefined, "", -3, NaN, "x"].every((v) => EN.upliftedSale(28.75, v) === 28.75 && EN.upliftOf(v) === 0));
  assert("up to the nearest half: 20 + 2.5 % = 20.50 stays 20.50; 20 + 2.6 % = 20.52 → 21; 40 + 1 % = 40.40 → 40.50", EN.upliftedSale(20, 2.5) === 20.5 && EN.upliftedSale(20, 2.6) === 21 && EN.upliftedSale(40, 1) === 40.5);
  assert("a float's noise does not push a price to the next half (10 + 5 % = 10.50 exactly)", EN.upliftedSale(10, 5) === 10.5 && EN.upliftedSale(100, 10) === 110);
  assert("never below the market price", [[17.3, 0.1], [22, 0.01], [9.99, 50]].every(([m, u]) => EN.upliftedSale(m, u) >= m));
}

// § 54 — two more lines (جزر 26, كوسا 25): markets under «بدون خسارة» 26.45, the exceptions of the rule since § 54 (28 and 27 were the exceptions before it)
const ITEMS = [{ productId: 1, productName: "طماطم", packagingId: 11, packagingName: "كرتون" }, { productId: 2, productName: "خيار", packagingId: 21, packagingName: "جرم" }, { productId: 3, productName: "بطاطس", packagingId: 31, packagingName: "كرتون" }, { productId: 4, productName: "بصل", packagingId: 41, packagingName: "جرم" },
  { productId: 5, productName: "جزر", packagingId: 51, packagingName: "كيس" }, { productId: 6, productName: "كوسا", packagingId: 61, packagingName: "كرتون" }];
const offer = (kind: "purchase" | "market", productId: number, packagingId: number, price: number, rowId: number) => ({ kind, price, outlier: false, partnerId: kind === "purchase" ? AHMED : DRIVER, sourceName: kind === "purchase" ? "أحمد" : "عمر", productId, packagingId, model: kind === "purchase" ? "dp" as const : "po" as const, rowId });
const OFFERS = [offer("purchase", 1, 11, 20, 1), offer("market", 1, 11, 30, 2), offer("purchase", 2, 21, 20, 3), offer("market", 2, 21, 28, 4), offer("purchase", 3, 31, 20, 5), offer("market", 3, 31, 27, 6), offer("market", 4, 41, 31.05, 7),
  offer("purchase", 5, 51, 20, 8), offer("market", 5, 51, 26, 9), offer("purchase", 6, 61, 20, 10), offer("market", 6, 61, 25, 11)];
const VAT = { ratePct: 15 }, FLOOR = { opShare: 2, minProfit: 2 };

console.log("\n[ب] the rule at 0 %: today's behaviour to the letter");
{
  const before = EN.computePricing(ITEMS, OFFERS, 5, VAT, FLOOR);
  const zero = EN.computePricing(ITEMS, OFFERS, 5, VAT, FLOOR, 0);
  assert("computePricing with an uplift of 0 gives every line exactly what it gives with no uplift named", JSON.stringify(zero) === JSON.stringify(before));
  assert("the sale price is the market price itself on every line (30, 28, 27, 31.05, 26, 25 — not rounded)", zero.every((l) => l.sale === l.market) && zero[3].sale === 31.05 && zero.length === 6);
  assert("the suggested price of a purchase of 20 is 29 and its «بدون خسارة» 26.45: market 30 is automatic; 28 and 27 (under the suggested price, above «بدون خسارة») are automatic at the market price too (§ 54: «أقل من المربح» before)", zero[0].exceptions.length === 0 && zero[0].suggested === 29 && zero[0].breakEven === 26.45
    && [1, 2].every((i) => zero[i].exceptions.length === 0 && zero[i].reason === "" && zero[i].proposal.why === "below_suggested" && EN.lineVerdict(zero[i], null, 0).status === "auto" && EN.lineVerdict(zero[i], null, 0).sale === zero[i].market), JSON.stringify(zero.map((l) => [l.reason, l.proposal])));
  assert("…26 and 25 are «أقل من سعر بدون خسارة», and the texts name the market price alone (no «بعد الزيادة»)", zero[4].exceptions.join() === "loss" && zero[4].reason === "سعر السوق 26 أقل من سعر بدون خسارة 26.45" && zero[5].reason === "سعر السوق 25 أقل من سعر بدون خسارة 26.45" && zero[3].reason === "لا سعر شراء"
    && EN.lineVerdict(zero[4], null, 0).status === "exception", JSON.stringify(zero.map((l) => l.reason)));
  assert("the unit profit is made from the market price: 30 ÷ 1.15 − 20 − 1 = 5.09", zero[0].unitProfit === 5.09 && EN.lineVerdict(zero[0], null, 0).sale === 30 && EN.lineVerdict(zero[1], "market", 0).sale === 28);
  assert("a stored line with no uplift on it sells at its market price (a day made before § 53)", EN.saleRule({ x_status: "auto", x_market_price: 31.05, x_manual_price: 0 }) === 31.05 && EN.saleRule({ x_status: "auto", x_market_price: 31.05, x_manual_price: 0, x_uplift_pct: false }) === 31.05 && EN.marketSale({ x_market_price: 28.75, x_uplift_pct: 0 }) === 28.75);
}

console.log("\n[ب] the rule at 3 %: the sale price, the comparison and the exception are made on the price after the uplift");
{
  const up = EN.computePricing(ITEMS, OFFERS, 5, VAT, FLOOR, 3);
  assert("market 30 → sale 31, automatic; the market observation itself is kept (30)", up[0].sale === 31 && up[0].market === 30 && up[0].upliftPct === 3 && up[0].exceptions.length === 0 && EN.lineVerdict(up[0], null, 0).sale === 31);
  assert("…its unit profit is made from 31: 31 ÷ 1.15 − 20 − 1 = 5.96", up[0].unitProfit === 5.96);
  const flat = EN.computePricing(ITEMS, OFFERS, 5, VAT, FLOOR);
  assert("market 28 → 28.84 → 29: it reaches the suggested 29 — under it at 0 %, at it at 3 % (automatic at both since § 54: at 28, then at 29)", up[1].sale === 29 && up[1].exceptions.length === 0 && up[1].proposal.why === "above_suggested" && flat[1].proposal.why === "below_suggested" && EN.lineVerdict(up[1], null, 0).status === "auto" && EN.lineVerdict(up[1], null, 0).sale === 29 && EN.lineVerdict(flat[1], null, 0).sale === 28);
  assert("market 27 → 27.81 → 28: still under 29 — automatic at the price after the uplift (28), not at the market's 27", up[2].sale === 28 && up[2].exceptions.length === 0 && up[2].proposal.why === "below_suggested" && EN.lineVerdict(up[2], null, 0).status === "auto" && EN.lineVerdict(up[2], null, 0).sale === 28, JSON.stringify(up[2].proposal));
  assert("market 26 → 26.78 → 27: it clears «بدون خسارة» 26.45 — an exception at 0 %, automatic at 3 %", up[4].sale === 27 && up[4].exceptions.length === 0 && EN.lineVerdict(up[4], null, 0).status === "auto" && EN.lineVerdict(up[4], null, 0).sale === 27 && flat[4].exceptions.join() === "loss" && EN.lineVerdict(flat[4], null, 0).status === "exception");
  assert("market 25 → 25.75 → 26: still under 26.45 — an exception, and its reason says both numbers", up[5].sale === 26 && up[5].exceptions.join() === "loss" && up[5].reason === "سعر السوق 25 بعد الزيادة 3٪ = 26 أقل من سعر بدون خسارة 26.45" && EN.lineVerdict(up[5], null, 0).status === "exception", up[5].reason);
  assert("«اعتمد بسعر السوق» on it approves the price after the uplift (26), «اعتمد بالسعر المربح» the suggested (29)", EN.lineVerdict(up[5], "market", 0).sale === 26 && EN.lineVerdict(up[5], "profit", 0).sale === 29 && EN.lineVerdict(up[2], "market", 0).sale === 28);
  assert("no purchase price: still an exception, its sale price the uplifted market (31.05 → 31.98 → 32)", up[3].exceptions.join() === "no_purchase" && up[3].sale === 32);
  assert("the suggested price does not move with the uplift (it is made from the purchase alone)", up.every((l, i) => l.suggested === EN.computePricing(ITEMS, OFFERS, 5, VAT, FLOOR)[i].suggested));
  assert("a stored line: auto → the market price after ITS uplift; a fixed price stays what Baraa fixed", EN.saleRule({ x_status: "auto", x_market_price: 30, x_manual_price: 0, x_uplift_pct: 3 }) === 31
    && EN.saleRule({ x_status: "manual", x_market_price: 30, x_manual_price: 0, x_decision: "market", x_uplift_pct: 3 }) === 31
    && EN.saleRule({ x_status: "manual", x_market_price: 30, x_manual_price: 33, x_decision: "edit", x_manual_for: "edit", x_uplift_pct: 3 }) === 33);
}

console.log("\n[ب] the setting: read from the active record («⚙️ الإعدادات»), 0 when empty");
{
  const env = world();
  assert("no value on the record: 0", (await quiet(() => OC.readPricingSettings(env, DAY)))?.marketUpliftPct === 0);
  table("x_pricing_config").get(1)!.x_market_uplift_pct = 3;
  assert("3 on the record: 3", (await quiet(() => OC.readPricingSettings(env, DAY)))?.marketUpliftPct === 3);
  table("x_pricing_config").get(1)!.x_market_uplift_pct = -5;
  assert("a negative value: 0", (await quiet(() => OC.readPricingSettings(env, DAY)))?.marketUpliftPct === 0);
  assert("no field rejected by the schema gate (x_market_uplift_pct is on the tenant)", rejected.length === 0, rejected.join(" | "));
}

const seedDay = (): void => {
  for (const [p, k, price] of [[1, 11, 20], [2, 21, 20], [3, 31, 20]] as Array<[number, number, number]>) seed("x_daily_price", { x_product_tmpl_id: p, x_packaging_id: k, x_supplier_id: AHMED, x_price_sar: price, x_date: DAY, x_extraction_status: "flow", x_source_message_id: "wamid.A" });
  // § 54 — خيار 26 and بطاطس 25 are under «بدون خسارة» 26.45 (they were 28 and 27: under the suggested 29, the exception's line before § 54)
  for (const [p, k, m] of [[1, 11, 30], [2, 21, 26], [3, 31, 25]] as Array<[number, number, number]>) seed("x_price_offer", { x_product_tmpl_id: p, x_packaging_id: k, x_source_partner_id: DRIVER, x_source_employee_id: OMAR_EMP, x_date: DAY, x_purchase_price: 0, x_market_price: m, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false, x_source_message_id: "wamid.O" });
};
const custPrices = (d: string) => sentTo(d).map((b: any) => String(b?.text?.body ?? "")).filter((t) => /أسعار يو تاك اليوم/.test(t)).join("\n");

console.log("\n[ب] a whole day at 0 %: the lines, the day's review and the published list carry the market price as it is");
{
  const env = world(`${DAY} 04:10`); seedDay();
  // share 500 ÷ 250 = 2: «بدون خسارة» 26.45, suggested 29
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const l1 = lineFor(1), l2 = lineFor(2), l3 = lineFor(3);
  assert("طماطم: automatic at the market price 30, «زيادة السوق ٪» 0", l1.x_status === "auto" && l1.x_sale_price === 30 && l1.x_market_price === 30 && !l1.x_uplift_pct, JSON.stringify([l1.x_status, l1.x_sale_price, l1.x_uplift_pct]));
  assert("خيار (26) and بطاطس (25): exceptions «سعر السوق … أقل من سعر بدون خسارة 26.45»", l2.x_status === "exception" && l2.x_reason === "سعر السوق 26 أقل من سعر بدون خسارة 26.45" && l3.x_status === "exception" && l3.x_reason === "سعر السوق 25 أقل من سعر بدون خسارة 26.45", JSON.stringify([l2.x_reason, l3.x_reason]));
  await quiet(() => PRV.notifyPriceReviewMessage(env));
  const t = reviewBody();
  // § 55 — the purchase 20 with × 1.15 beside it (23.00 «شامل»); «ربحنا» = the price ÷ 1.15 − the full cost (20 + 1 + 2 = 23): 30 → 26.09 − 23 = +3.09; 26 → 22.61 − 23 = −0.39; 25 → 21.74 − 23 = −1.26
  const tl = t.split("\n");
  assert("the review has no «بعد الزيادة» anywhere: each item its purchase, its market, «ربحنا» at that price and its proposed decision — a line an item", !/الزيادة/.test(t) && tl.includes("✅ طماطم — شراء 20 (23.00 شامل) · سوق 30 | ربحنا بسعر السوق: +3.09 ← انشر بـ 30") && tl.includes("❌ خيار — شراء 20 (23.00 شامل) · سوق 26 | ربحنا بسعر السوق: −0.39 ← لا تنشر") && tl.includes("❌ بطاطس — شراء 20 (23.00 شامل) · سوق 25 | ربحنا بسعر السوق: −1.26 ← لا تنشر") && tl.filter((x) => / ← /.test(x)).length === 4, t);
  assert("…and its three lines under the table say what each choice publishes — طماطم at the market price as it is (30), with or without his tap", JSON.stringify(tl.slice(-3)) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: طماطم 30", "وما ينتشر: خيار، بطاطس، بصل", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: طماطم 30"]), tl.slice(-3).join(" | "));
  const f = await reviewForm(env);
  // the suggested 29 against the market 26: 3 above it, 3 ÷ 26 = 11.5 %
  assert("«بسعر السوق» is offered at 26 in its form (with its profit, −0.39), whose two lines have no «بعد الزيادة» either", f.options("خيار").find((c) => c.id === "market")?.title === "بسعر السوق 26 (ربح −0.39)" && f.info("خيار") === "شراء 20 (23.00 شامل) · سوق 26 · ربحنا بسعر السوق: −0.39" && f.info2("خيار") === "سعرنا المقترح 29 = أعلى من السوق بـ 3 (+11.5%)", JSON.stringify([f.options("خيار"), f.info("خيار"), f.info2("خيار")]));
  const ok = await f.answer({ [`d${f.slot("خيار")}`]: "market" });
  const conf = ownerTexts().at(-1) ?? "";
  // the form's other items stay on the choice their list opened on: طماطم «بسعر السوق» 30 (+3.09) — the mean of the two published: (3.09 − 0.39) ÷ 2 = +1.35
  assert("…and approves 26: «• خيار — 26 ر.س (سعر السوق) · ربحنا −0.39», then «متوسط الربح للكرتون: +1.35»", ok.action === "decided" && conf.split("\n").includes("• خيار — 26 ر.س (سعر السوق) · ربحنا −0.39") && conf.split("\n").includes("متوسط الربح للكرتون: +1.35") && lineFor(2).x_decision === "market" && lineFor(2).x_sale_price === 26 && lineFor(2).x_manual_price === 26, conf);
  openWindow(env, CUST_PHONE, 1);
  table("x_price_day").get(dayOf().id)!.x_state = "approved";
  const pub = await quiet(() => PR.publishPriceDay(env, dayOf().id));
  assert("published (the publication's own check of each line's price passes)", pub.action === "published", JSON.stringify(pub));
  assert("the customer reads طماطم 30 and خيار 26", /طماطم \(كرتون\): 30 ر\.س/.test(custPrices(CUST_PHONE)) && /خيار \(جرم\): 26 ر\.س/.test(custPrices(CUST_PHONE)) && !/بطاطس/.test(custPrices(CUST_PHONE)), custPrices(CUST_PHONE));
}

console.log("\n[ب] the same day at 3 %");
{
  const env = world(`${DAY} 04:10`); seedDay();
  table("x_pricing_config").get(1)!.x_market_uplift_pct = 3;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const l1 = lineFor(1), l2 = lineFor(2), l3 = lineFor(3);
  assert("طماطم: automatic at 31 (30 → 30.90 → 31); the market stays 30 on the line, with its uplift 3", l1.x_status === "auto" && l1.x_sale_price === 31 && l1.x_market_price === 30 && l1.x_uplift_pct === 3, JSON.stringify([l1.x_status, l1.x_sale_price, l1.x_market_price, l1.x_uplift_pct]));
  assert("…its unit profit and its board are made from 31", l1.x_unit_profit === 5.96 && l1.x_board_sale === 31);
  assert("خيار: 26 → 27 clears «بدون خسارة» 26.45 — automatic at 27, no exception", l2.x_status === "auto" && l2.x_sale_price === 27 && l2.x_market_price === 26, JSON.stringify([l2.x_status, l2.x_sale_price]));
  assert("بطاطس: 25 → 26 < 26.45 — the exception, its reason with both numbers", l3.x_status === "exception" && l3.x_reason === "سعر السوق 25 بعد الزيادة 3٪ = 26 أقل من سعر بدون خسارة 26.45", String(l3.x_reason));
  await quiet(() => PRV.notifyPriceReviewMessage(env));
  const t = reviewBody();
  const f = await reviewForm(env);
  // § 55 — the purchase 20 (23.00 «شامل») first; «ربحنا» is made at the price after the uplift (the full cost 23): 31 → 26.96 − 23 = +3.96; 27 → 23.48 − 23 = +0.48; 26 → 22.61 − 23 = −0.39
  const tl = t.split("\n");
  assert("the review shows the market as it was observed (30, 26, 25) and the price it would publish «(بعد الزيادة 31)», with «ربحنا» at that price; the form, بطاطس «سوق 25 (بعد الزيادة 26)»", tl.includes("✅ طماطم — شراء 20 (23.00 شامل) · سوق 30 (بعد الزيادة 31) | ربحنا بسعر السوق: +3.96 ← انشر بـ 31") && tl.includes("✅ خيار — شراء 20 (23.00 شامل) · سوق 26 (بعد الزيادة 27) | ربحنا بسعر السوق: +0.48 ← انشر بـ 27") && tl.includes("❌ بطاطس — شراء 20 (23.00 شامل) · سوق 25 (بعد الزيادة 26) | ربحنا بسعر السوق: −0.39 ← لا تنشر")
    && f.info("بطاطس") === "شراء 20 (23.00 شامل) · سوق 25 (بعد الزيادة 26) · ربحنا بسعر السوق: −0.39", `${t}\n${f.info("بطاطس")}`);
  assert("…its three lines under the table name the prices after the uplift (طماطم 31, خيار 27), with or without his tap", JSON.stringify(tl.slice(-3)) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: طماطم 31، خيار 27", "وما ينتشر: بطاطس، بصل", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: طماطم 31، خيار 27"]), tl.slice(-3).join(" | "));
  // the suggested price is set against the market AS OBSERVED (25, before the uplift): 29 − 25 = 4, 4 ÷ 25 = 16 %
  assert("…and its second line compares the suggested 29 with the market as it was observed (25), not with the price after the uplift", f.info2("بطاطس") === "سعرنا المقترح 29 = أعلى من السوق بـ 4 (+16%)", f.info2("بطاطس"));
  const choice = f.options("بطاطس");
  // 29 ÷ 1.15 = 25.22 − 23 = +2.22
  assert("«بالمقترح» 29 and «بسعر السوق» 26 (the price after the uplift), each with its profit", choice.find((c) => c.id === "profit")?.title === "بالمقترح 29 (ربح +2.22)" && choice.find((c) => c.id === "market")?.title === "بسعر السوق 26 (ربح −0.39)", JSON.stringify(choice));
  const ok = await f.answer({ [`d${f.slot("بطاطس")}`]: "market" });
  const conf = ownerTexts().at(-1) ?? "";
  // the three published: طماطم 31 (+3.96), خيار 27 (+0.48), بطاطس 26 (−0.39) — their mean (3.96 + 0.48 − 0.39) ÷ 3 = +1.35
  assert("…«بسعر السوق» approves 26, the price after the uplift: «• بطاطس — 26 ر.س (سعر السوق) · ربحنا −0.39», then «متوسط الربح للكرتون: +1.35»", ok.action === "decided" && conf.split("\n").includes("• بطاطس — 26 ر.س (سعر السوق) · ربحنا −0.39") && conf.split("\n").includes("متوسط الربح للكرتون: +1.35") && lineFor(3).x_decision === "market" && lineFor(3).x_sale_price === 26, conf);
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("…and the engine's next run keeps it (26, «براء: اعتمد بسعر السوق»)", lineFor(3).x_sale_price === 26 && lineFor(3).x_status === "manual" && lineFor(3).x_reason === "براء: اعتمد بسعر السوق");
  openWindow(env, CUST_PHONE, 1);
  table("x_price_day").get(dayOf().id)!.x_state = "approved";
  const pub = await quiet(() => PR.publishPriceDay(env, dayOf().id));
  assert("published: each line's price is the rule's (31, 27, 26) — no «لا يطابق القاعدة»", pub.action === "published" && !ownerTexts().some((x) => /لا يطابق القاعدة/.test(x)), JSON.stringify(pub));
  assert("the customer reads طماطم 31, خيار 27 and بطاطس 26", /طماطم \(كرتون\): 31 ر\.س/.test(custPrices(CUST_PHONE)) && /خيار \(جرم\): 27 ر\.س/.test(custPrices(CUST_PHONE)) && /بطاطس \(كرتون\): 26 ر\.س/.test(custPrices(CUST_PHONE)), custPrices(CUST_PHONE));
  assert("no field rejected by the schema gate (x_uplift_pct is on the tenant)", rejected.length === 0, rejected.join(" | "));
}
{
  // the same day at 3 % with no decision at all: the automatic lines go out by the rule's own price, the loss stays out
  const env = world(`${DAY} 04:10`); seedDay();
  table("x_pricing_config").get(1)!.x_market_uplift_pct = 3;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  openWindow(env, CUST_PHONE, 1);
  table("x_price_day").get(dayOf().id)!.x_state = "approved";
  const pub = await quiet(() => PR.publishPriceDay(env, dayOf().id));
  assert("…published with no decision: the automatic lines pass the publication's own check at their price after the uplift (31, 27)", pub.action === "published" && !ownerTexts().some((x) => /لا يطابق القاعدة/.test(x)) && lineFor(1).x_status === "auto" && lineFor(2).x_status === "auto"
    && /طماطم \(كرتون\): 31 ر\.س/.test(custPrices(CUST_PHONE)) && /خيار \(جرم\): 27 ر\.س/.test(custPrices(CUST_PHONE)) && !/بطاطس/.test(custPrices(CUST_PHONE)), JSON.stringify(pub));
  assert("…and Baraa's one message names what stayed out and why — the loss on the price after the uplift (26 < 26.45)", ownerTexts().filter((x) => x.startsWith("📢 نُشرت أسعار")).length === 1 && ownerTexts().some((x) => x.includes("لم يُنشر (2): بطاطس (خسارة: السوق 26 أقل من 26.45، وبلا قرار)، بصل (لا سعر شراء).")) && !ownerTexts().some((x) => x.startsWith("⏰ لم يُنشر")), ownerTexts().join(" | ").slice(0, 400));
}

console.log("\n[ب] a price changed by hand in Odoo no longer matches the rule: not published");
{
  const env = world(`${DAY} 04:10`); seedDay();
  table("x_pricing_config").get(1)!.x_market_uplift_pct = 3;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  lineFor(1).x_sale_price = 30; // the market price, typed over the rule's 31
  table("x_price_day").get(dayOf().id)!.x_state = "approved";
  const pub = await quiet(() => PR.publishPriceDay(env, dayOf().id));
  assert("«mismatch», and Baraa is told which line (30≠31)", pub.action === "mismatch" && ownerTexts().some((x) => /لا يطابق القاعدة/.test(x) && /30≠31/.test(x)), JSON.stringify(pub));
}

console.log("\n[ب] the uplift changed during the night: the engine recomputes (it is one of its inputs)");
{
  const env = world(`${DAY} 04:10`); seedDay();
  await quiet(() => PR.refreshPriceDay(env));
  assert("at 0 %: 30", lineFor(1).x_sale_price === 30);
  table("x_pricing_config").get(1)!.x_market_uplift_pct = 3;
  const r = await quiet(() => PR.refreshPriceDay(env));
  assert("at 3 %, with no offer changed: the run is not «unchanged», and the line is 31", r.action === "refreshed" && lineFor(1).x_sale_price === 31, JSON.stringify(r.action));
}

console.log("\n[ب] Odoo: the field in «⚙️ الإعدادات», right after «نسبة السعر الشاذ», 0 by default");
{
  const arch = `<group string="التسعير اليومي">\n        <field name="x_waste_pct"/>\n        <field name="x_outlier_ratio"/>\n      </group>`;
  const out = ODOO.settingsArch(arch);
  assert("the field is added once, after «نسبة السعر الشاذ», and the rest of the form is untouched", /<field name="x_outlier_ratio"\/>\s*<field name="x_market_uplift_pct"\/>/.test(out) && out.replace(/\n\s*<field name="x_market_uplift_pct"\/>/, "") === arch && ODOO.settingsArch(out) === out);
  let threw = false; try { ODOO.settingsArch("<form/>"); } catch { threw = true; }
  assert("a form without «نسبة السعر الشاذ» stops the script (never a guess)", threw);
  assert("its label and its default", ODOO.UPLIFT_LABEL === "زيادة على سعر السوق ٪" && ODOO.UPLIFT_DEFAULT === 0 && ODOO.CFG_FIELDS[0].name === "x_market_uplift_pct" && ODOO.CFG_FIELDS[0].ttype === "float" && ODOO.LINE_FIELDS[0].name === "x_uplift_pct");
}

// ================================================================ [هـ] the pay reminder with the IBAN
const IBAN = "SA5945000000168295723001";
function payWorld(tpl: [string, string] | null, bank: Record<string, unknown> | null = {}): any {
  const env = fresh(`${DAY} 08:00`);
  clearTemplateCache();
  seed("x_whatsapp_template", { x_purpose: "customer_pay_remind", x_meta_template_id: "utak_pay_remind_v3", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  if (tpl) seed("x_whatsapp_template", { x_purpose: "customer_pay_remind_iban", x_meta_template_id: "utak_pay_remind_iban_v1", x_language: "ar", x_meta_status: tpl[0], x_param_count: 3, x_category: tpl[1] });
  if (bank === null) seed("account.journal", { id: 13, code: "BNK1", name: "البنك", bank_account_id: false });
  else {
    seed("res.partner.bank", { id: 1, account_number: IBAN, holder_name: "شركة يوتاك", bank_name: "البنك السعودي الأول", active: true, partner_id: [1, "شركة يوتاك"], ...bank });
    seed("account.journal", { id: 13, code: "BNK1", name: "البنك", bank_account_id: [1, IBAN] });
  }
  return env;
}
let ord = 0;
function invoice(customer: number, total: number, date: string, extra: Record<string, unknown> = {}): number {
  const o = seed("x_daily_order", { x_customer_id: customer, x_state: "delivered", x_order_date: date, x_name: `O${++ord}` });
  return seed("x_invoice", { x_invoice_number: `INV-2026-00${ord}`, x_total: total, x_status: "issued", x_invoice_date: date, x_utak_simulation: false, x_order_id: o, ...extra });
}
const NEW = "utak_pay_remind_iban_v1", OLD = "utak_pay_remind_v3";

console.log("\n[هـ] the template: one submission, UTILITY, no greeting and no emoji, the IBAN in its fixed text");
{
  const t = TPL.PAY_REMIND_IBAN, pay = TPL.payRemindPayload();
  assert("the order's text, to the letter", t.body === "تذكير بالفاتورة رقم {{1}} بمبلغ {{2}} ر.س، المستحقة بتاريخ {{3}}. للتحويل: شركة يوتاك — البنك السعودي الأول — IBAN SA59 4500 0000 1682 9572 3001.");
  assert("its name, its purpose and its three variables are the worker's", t.name === OUT.PAY_REMIND_IBAN_TEMPLATE && t.name === NEW && t.purpose === "customer_pay_remind_iban" && t.params === 3 && (t.body.match(/\{\{\d\}\}/g) ?? []).length === 3);
  assert("submitted UTILITY, in Arabic, a body alone (no header, no button), an example for each variable", pay.category === "UTILITY" && pay.language === "ar" && pay.components.length === 1 && pay.components[0].type === "BODY" && pay.components[0].example.body_text[0].length === 3);
  assert("no greeting and no emoji", !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t.body) && !/أهلا|مرحبا|السلام|عزيز|صباح|مساء/.test(t.body));
  assert("the transfer line in it is the worker's own (§ 52 أ), with a full stop after it", t.body.endsWith(`${TPL.IBAN_LINE}.`) && TPL.IBAN_LINE === OUT.PAY_REMIND_IBAN_LINE);
  assert("the reminder of before is the row that holds customer_pay_remind today", t.replaces === OLD);
}

console.log("\n[هـ] approved and UTILITY: it takes the place of the reminder of before");
{
  const env = payWorld(["APPROVED", "UTILITY"]);
  invoice(CUST, 450, "2026-09-28");
  const r = await quiet(() => OUT.sendPaymentReminders(env));
  const got = tplTo(CUST_PHONE, NEW);
  assert("one reminder, by utak_pay_remind_iban_v1 — and not by the template of before", r.sent === 1 && got.length === 1 && tplTo(CUST_PHONE, OLD).length === 0, JSON.stringify(sentTo(CUST_PHONE).map((b: any) => b.template?.name)));
  assert("{{1}} the invoice number, {{2}} the amount still owed, {{3}} its due date (the invoice's date + 30 days: 28 October 2026)", JSON.stringify(params(got[0])) === JSON.stringify(["INV-2026-001", "450.00", "28 أكتوبر 2026"]), JSON.stringify(params(got[0])));
  assert("no IBAN travels as a variable (it is the template's fixed text)", !params(got[0]).some((p) => /SA\d|IBAN/.test(p)));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[هـ] several invoices: still one reminder per customer — the numbers, the total, the oldest due date");
{
  const env = payWorld(["APPROVED", "UTILITY"]);
  const a = invoice(CUST, 100, "2026-09-25");
  seed("x_payment", { x_invoice_id: a, x_amount: 30 });
  invoice(CUST, 50, "2026-09-20", { x_status: "overdue" });
  invoice(CUST, 999, "2026-10-02");   // one day old: not yet
  invoice(CUST2, 200, "2026-09-29");
  const r = await quiet(() => OUT.sendPaymentReminders(env));
  const p = params(tplTo(CUST_PHONE, NEW)[0]);
  assert("the customer of two invoices: both numbers, 70 + 50 = 120.00, due 20 October (the older invoice's)", r.sent === 2 && tplTo(CUST_PHONE, NEW).length === 1 && /INV-2026-00\d، INV-2026-00\d/.test(p[0]) && p[1] === "120.00" && p[2] === "20 أكتوبر 2026", JSON.stringify(p));
  assert("the other customer: his own invoice, 200.00, due 29 October", JSON.stringify(params(tplTo(CUST2_PHONE, NEW)[0]).slice(1)) === JSON.stringify(["200.00", "29 أكتوبر 2026"]));
  assert("the cap of before is kept: a second run the same day sends nothing", (await quiet(() => OUT.sendPaymentReminders(env))).sent === 0 && tplTo(CUST_PHONE, NEW).length === 1);
}

console.log("\n[هـ] pending, refused, filed MARKETING, or no row at all: the reminder of before, in the same run");
for (const [label, tpl] of [["PENDING", ["PENDING", "UTILITY"]], ["REJECTED", ["REJECTED", "UTILITY"]], ["APPROVED but MARKETING", ["APPROVED", "MARKETING"]], ["PAUSED", ["PAUSED", "UTILITY"]], ["no row", null]] as Array<[string, [string, string] | null]>) {
  const env = payWorld(tpl);
  invoice(CUST, 450, "2026-09-28");
  const r = await quiet(() => OUT.sendPaymentReminders(env));
  const old = tplTo(CUST_PHONE, OLD);
  assert(`${label}: utak_pay_remind_v3 with [the customer's name, the amount] — never the new template`, r.sent === 1 && old.length === 1 && tplTo(CUST_PHONE, NEW).length === 0 && JSON.stringify(params(old[0])) === JSON.stringify(["مطعم الوادي", "450.00"]), JSON.stringify(sentTo(CUST_PHONE).map((b: any) => b.template?.name)));
}

console.log("\n[هـ] the IBAN in the template's text must still be the company's account");
for (const [label, bank] of [["another IBAN on the journal", { account_number: "SA0380000000608010167519" }], ["the account archived", { active: false }], ["another holder name", { holder_name: "مؤسسة أخرى" }], ["no account on the journal", null]] as Array<[string, Record<string, unknown> | null]>) {
  const env = payWorld(["APPROVED", "UTILITY"], bank);
  invoice(CUST, 450, "2026-09-28");
  const r = await quiet(() => OUT.sendPaymentReminders(env));
  assert(`${label}: the reminder of before goes — a reminder never carries an IBAN that is not the company's now`, r.sent === 1 && tplTo(CUST_PHONE, OLD).length === 1 && tplTo(CUST_PHONE, NEW).length === 0, JSON.stringify(sentTo(CUST_PHONE).map((b: any) => b.template?.name)));
}
{
  assert("the due date follows the invoice's printed terms (30 days)", OUT.INVOICE_DUE_DAYS === 30 && OUT.invoiceDueDate("2026-09-28") === "2026-10-28" && OUT.invoiceDueDate("2026-12-15") === "2027-01-14");
  assert("a debt with no invoice date takes the reminder of before", OUT.ibanRemindParams({ amount: 10, invoices: ["INV-1"], firstDate: "" }) === null && OUT.ibanRemindParams({ amount: 10, invoices: [], firstDate: "2026-09-28" }) === null);
  const purposes = (await import("../src/wa-purposes.ts")).PURPOSES;
  assert("the new template's lookup purpose is known to the gateway, operational (UTILITY only)", purposes.customer_pay_remind_iban?.kind === "operational" && (await import("../src/templates.ts")).T.CUSTOMER_PAY_REMIND_IBAN === "customer_pay_remind_iban");
  const labels = JSON.parse(readFileSync(new URL("../src/wa-template-labels.json", import.meta.url), "utf8"));
  assert("its Arabic name for Odoo", labels.utak_pay_remind_iban_v1 === TPL.PAY_REMIND_IBAN.label);
}

done();
