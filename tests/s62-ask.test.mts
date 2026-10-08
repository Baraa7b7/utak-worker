// § 62 ب (2026-10-07) — the price ask of «طلب أسعار خاص» and its replies.
//
//   • the form's JSON (scripts/lib/s62-price-flow.mjs) against what the worker sends
//   • the request's items alone, on pages by category; «طلب أسعار خاص — N صنف»; the role's line
//   • § 53: a «شراء» source reads the quantities, a «سوق» source reads none; nobody reads the customer
//   • inside the window the form, outside it utak_price_ask_flow_v2, neither → owed until he writes
//   • a reply is written on the request's lines alone — never on the day's prices — at any hour while
//     the request is not closed; a market observation is also a «خاص» offer row the day's readers skip
//   • Baraa's «📨 وصلت أسعار …», the one reminder after three hours, the late reply to a closed request
//   • the products made for a request are in none of the day's lists
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62-ask.test.mts

import { OWNER, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { assert, done, ownerTexts, rejected } from "./s46-kit.mts";
import {
  AHMED, AHMED_PHONE, DAY, GARLIC, LETTUCE, LINE, MADARAT, MADARAT_PHONE, MUSHROOM, OMAR, OMAR_PHONE, ORANGE, QUOTE, RAED, RAED_PHONE, RECIPIENT, lineOf, linesOf, quote, recipientOf, recipientsOf,
  request, utc, world, writes,
} from "./s62-kit.mts";

const ASK = await import("../src/special-ask.ts");
const SQ = await import("../src/special-quote.ts");
const FL = await import("../src/price-flow.ts");
const PS = await import("../src/price-sources.ts");
const EN = await import("../src/pricing-engine.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { CUSTOMER_PRICE_PURPOSES } = await import("../src/price-privacy.ts");
const LIB = await import("../scripts/lib/s62-price-flow.mjs");
const LIB52 = await import("../scripts/lib/s52-price-flow.mjs");
const worker = (await import("../src/index.ts")).default;

const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const tplTo = (d: string, name: string) => sentTo(d).filter((b: any) => b?.template?.name === name);
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map((b: any) => String(b.text?.body ?? ""));
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? b?.template?.components?.find((c: any) => c.sub_type === "flow")?.parameters?.[0]?.action?.flow_action_data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
/**
 * § 66 ز — a message as its recipient READS it: its JSON without the flow_token. The token is «sq1.<request>.<partner>.<18
 * random hex digits>» — and a search of the raw JSON for a quantity («494») or a price («3.33») matched that random part
 * about once in fifty runs (Omar's token «….603.33…» reads «3.33»): the test failed for no leak at all.
 */
const TOKEN_RE = /sq1\.\d+\.\d+\.[0-9a-f]+/g;
const seen = (b: unknown): string => JSON.stringify(b).replace(TOKEN_RE, "sq1.<token>");
const tokenOf = (b: any): string => par(b).flow_token ?? b?.template?.components?.find((c: any) => c.sub_type === "flow")?.parameters?.[0]?.action?.flow_token ?? "";
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>) => {
  openWindow(env, from, 0);
  return quiet(() => ASK.handleSpecialAskReply(env, { from: "+" + from, messageId: `wamid.Q${++wamid}`, flow: { token, values } }));
};
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const nfm = (values: Record<string, unknown>, token: string) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
const offers = () => rows("x_price_offer") as any[];
const unlock = (env: any, id: number) => env.MSG_DEDUP.store.delete(`btnlock:v1:spq_send:${id}`);
const dayModels = ["x_price_day", "x_price_day_line", "x_daily_price", "x_supplier_price_request_log"];

console.log("\n[ب2] the form at Meta is «أدخل الأسعار» with one «ملاحظة»");
{
  const flow = LIB.buildFlowJson();
  const v2 = LIB52.buildFlowJson();
  assert("its name, four pages of fifteen fields (sixty items), the first page the one a message opens", LIB.FLOW_NAME === "utak_price_ask_special_v1" && flow.screens.length === 4 && LIB.FLOW_SLOTS === 60 && LIB.FLOW_SLOTS === FL.PRICE_FLOW_SLOTS && LIB.FLOW_FIRST_SCREEN === FL.PRICE_FLOW_SCREEN);
  assert("its screens are titled «طلب أسعار خاص»", flow.screens.every((s: any) => s.title === "طلب أسعار خاص"));
  assert("the data keys are utak_price_ask_v2's, letter for letter (the template's button opens v2 with the same data)", JSON.stringify(Object.keys(flow.screens[0].data)) === JSON.stringify(Object.keys(v2.screens[0].data)) && Object.keys(flow.screens[0].data).length === 249);
  const submits = flow.screens.map((s: any) => { const kids = s.layout.children; const last = kids[kids.length - 1]; return last.type === "If" ? last.else : kids.slice(-2); });
  assert("«ملاحظة» sits on the page «إرسال» sits on, above it, on every page — optional, a text of up to 300 characters", submits.every((x: any[]) => x.length === 2 && x[0].type === "TextArea" && x[0].name === "remark" && x[0].required === false && x[0]["max-length"] === 300 && x[1].type === "Footer" && x[1].label === "إرسال"));
  assert("…its label within Meta's 20 characters and its helper within 80", [...LIB.REMARK_LABEL].length <= 20 && [...LIB.REMARK_HELP].length <= 80);
  assert("the reply carries every field up to its page, and the remark", submits.every((x: any[], k: number) => Object.keys(x[1]["on-click-action"].payload).length === (k + 1) * 15 + 1 && x[1]["on-click-action"].payload.remark === "${form.remark}"));
  assert("the worker reads that field", ASK.REMARK_FIELD === LIB.REMARK_FIELD && ASK.readRemark({ remark: "  السعر  للكرتون\n10 كيلو " }) === "السعر للكرتون 10 كيلو" && ASK.readRemark({}) === "" && ASK.readRemark({ remark: 5 }) === "");
  assert("no endpoint: the data goes with the message", JSON.stringify(flow).includes("data_exchange") === false && flow.version === "6.0");
  assert("the worker sends Meta's own id of it", /^\d{15,17}$/.test(ASK.SPECIAL_FLOW_ID) && ASK.SPECIAL_FLOW_ID !== FL.PRICE_FLOW_ID);
}

console.log("\n[ب2] the request's items on their pages");
{
  const env = world();
  const id = request();
  const q = (await quiet(() => SQ.readQuote(env, id)))!;
  const cats = await quiet(() => ASK.specialCategories(env, q.lines.map((l) => l.productId)));
  assert("a product's page: its category, else the category its reference names, else «أخرى»", cats.of.get(ORANGE) === 5 && cats.of.get(LETTUCE) === 7 && cats.of.get(GARLIC) === 6 && cats.of.get(1) === 6 && cats.of.get(2) === 6 && cats.of.get(MUSHROOM) === 0, JSON.stringify([...cats.of]));
  const placed = ASK.placeLines(q.lines, cats.of, cats.titles);
  assert("the pages: فواكه، خضار، ورقيات، أخرى — each with its lines in the request's order", JSON.stringify(placed.pages) === JSON.stringify(["فواكه", "خضار", "ورقيات", "أخرى"]) && JSON.stringify(placed.placed.map((x) => [x.slot, x.line.productName])) === JSON.stringify([[1, "برتقال"], [16, "ثوم"], [17, "طماطم"], [18, "خيار"], [31, "خس أمريكي"], [46, "فطر أبيض"]]), JSON.stringify(placed.placed.map((x) => [x.slot, x.line.productName])));
  assert("nothing is left without a field", placed.left.length === 0);
  // a category of more than fifteen takes a second page while one of the four is free
  const many = Array.from({ length: 20 }, (_, i) => ({ ...q.lines[0], id: 9000 + i, productId: 700 + i, productName: `فاكهة ${i + 1}` }));
  const of2 = new Map<number, number>(many.map((l) => [l.productId, 5]));
  const two = ASK.placeLines(many, of2, cats.titles);
  assert("twenty fruits: «فواكه (1 من 2)» with fifteen, «فواكه (2 من 2)» with five — all of them have a field", JSON.stringify(two.pages) === JSON.stringify(["فواكه (1 من 2)", "فواكه (2 من 2)"]) && two.placed.length === 20 && two.placed[15].slot === 16 && two.left.length === 0);
  const seventy = Array.from({ length: 70 }, (_, i) => ({ ...q.lines[0], id: 9500 + i, productId: 800 + i, productName: `صنف ${i + 1}` }));
  const over = ASK.placeLines(seventy, new Map(seventy.map((l) => [l.productId, 6])), cats.titles);
  assert("seventy items: sixty on the four pages, the ten left are named (never dropped silently)", over.placed.length === 60 && over.pages.length === 4 && over.left.length === 10 && over.left[0] === "صنف 61");
  assert("a slot's label is the item within Meta's twenty characters", ASK.specialSlotTexts({ productName: "[UTAK-FRT-003] برتقال أبو صرة مستورد فاخر", qty: 5, unit: "كيلو" }, "market").label.length <= 20 && ASK.specialSlotTexts({ productName: "[UTAK-FRT-003] برتقال", qty: 5, unit: "كيلو" }, "market").label === "برتقال");
  assert("the hint of a «شراء» source: the quantity and its unit; of a «سوق» source: «السعر بالريال», no quantity", ASK.specialSlotTexts({ productName: "برتقال", qty: 1464, unit: "كيلو" }, "purchase").hint === "الكمية: 1464 كيلو" && ASK.specialSlotTexts({ productName: "برتقال", qty: 1464, unit: "كيلو" }, "market").hint === "السعر بالريال");
  assert("a packaging other than the kilo («كرتون 18 كجم») is named to both, with what the price is for (the role's line says «بالكيلو»)", ASK.specialSlotTexts({ productName: "تفاح أحمر", qty: 12, unit: "كرتون 18 كجم" }, "purchase").hint === "الكمية: 12 كرتون 18 كجم · السعر لكل كرتون 18 كجم" && ASK.specialSlotTexts({ productName: "تفاح أحمر", qty: 12, unit: "كرتون 18 كجم" }, "market").hint === "السعر بالريال لكل كرتون 18 كجم" && !ASK.specialSlotTexts({ productName: "تفاح أحمر", qty: 12, unit: "كرتون 18 كجم" }, "market").hint.includes("12"));
  assert("the role's line: «سعرك بالكيلو بدون ضريبة.» / «سعر البيع في السوق بالكيلو شامل الضريبة.»", ASK.ROLE_LINE.purchase === "سعرك بالكيلو بدون ضريبة." && ASK.ROLE_LINE.market === "سعر البيع في السوق بالكيلو شامل الضريبة." && ASK.specialNote("purchase").startsWith(ASK.ROLE_LINE.purchase) && ASK.specialNote("market").startsWith(ASK.ROLE_LINE.market));
  assert("the title: «طلب أسعار خاص — N صنف»", ASK.specialTitle(27) === "طلب أسعار خاص — 27 صنف");
}

console.log("\n[ب1–ب4] «📨 أرسل طلب الأسعار»: each source by his window, and § 53's privacy");
let env = world();
let id = request();
{
  // numbers of ours on the lines, which no source may read
  Object.assign(lineOf(id, ORANGE), { x_purchase_price: 3.33, x_final_price: 7.77, x_obs: JSON.stringify({ purchase: {}, market: { [OMAR]: { p: 6.66, n: "عمر", at: 1 } } }) });
  openWindow(env, AHMED_PHONE); openWindow(env, OMAR_PHONE);      // Raed's window is closed
  const r = await quiet(() => ASK.sendSpecialAsk(env, id));
  assert("sent to the three sources of the request", r.action === "sent" && r.asks?.length === 3, JSON.stringify(r));
  const a = flowsTo(AHMED_PHONE), o = flowsTo(OMAR_PHONE), rt = tplTo(RAED_PHONE, "utak_price_ask_flow_v2");
  assert("Ahmed (window open): the special form itself, «أدخل الأسعار»", a.length === 1 && par(a[0]).flow_id === ASK.SPECIAL_FLOW_ID && par(a[0]).flow_cta === "أدخل الأسعار" && par(a[0]).flow_action === "navigate" && par(a[0]).flow_action_payload.screen === "PAGE_A");
  assert("Omar (window open): the special form too — as a «سوق» source of this request", o.length === 1 && par(o[0]).flow_id === ASK.SPECIAL_FLOW_ID);
  assert("Raed (window closed): the approved template utak_price_ask_flow_v2 with the day, its button carrying the same data and his token", rt.length === 1 && flowsTo(RAED_PHONE).length === 0 && rt[0].template.components.find((c: any) => c.type === "body").parameters[0].text === "3 أكتوبر 2026" && ASK.isSpecialAskToken(tokenOf(rt[0])) && Object.keys(dataOf(rt[0])).length === 249);
  assert("nothing is held for anyone, and nothing else went to them", [AHMED_PHONE, OMAR_PHONE, RAED_PHONE].every((d) => heldFor(env, d).length === 0 && sentTo(d).length === 1));
  const da = dataOf(a[0]), dr = dataOf(rt[0]), dom = dataOf(o[0]);
  assert("the title under each heading: «طلب أسعار خاص — 6 صنف»", da.sub === "طلب أسعار خاص — 6 صنف" && dr.sub === da.sub && dom.sub === da.sub);
  assert("the pages by category, «التالي» until the last one that has items", JSON.stringify([da.t1, da.t2, da.t3, da.t4]) === JSON.stringify(["فواكه", "خضار", "ورقيات", "أخرى"]) && da.m1 === true && da.m2 === true && da.m3 === true);
  assert("the request's items alone: six fields shown, the others hidden", [1, 16, 17, 18, 31, 46].every((n) => da[`v${n}`] === true) && Object.keys(da).filter((k) => /^v\d+$/.test(k) && da[k] === true).length === 6 && da.l1 === "برتقال" && da.l31 === "خس أمريكي");
  assert("the data keys are the form's own (every key Meta's JSON declares, no other)", JSON.stringify(Object.keys(da).sort()) === JSON.stringify(Object.keys(LIB.flowDataModel()).sort()));
  // § 53 — the role decides what a source reads
  assert("Ahmed «شراء»: «سعرك بالكيلو بدون ضريبة.», and each item's quantity in its hint", da.note.startsWith("سعرك بالكيلو بدون ضريبة.") && da.h1 === "الكمية: 1464 كيلو" && da.h31 === "الكمية: 494 كيلو" && da.h16 === "الكمية: 194 كيلو" && bodyOf(a[0]).includes("بكمياتها") && bodyOf(a[0]).includes("بدون ضريبة"));
  assert("Raed and Omar «سوق»: «سعر البيع في السوق بالكيلو شامل الضريبة.», and no quantity anywhere", [dr, dom].every((d) => d.note.startsWith("سعر البيع في السوق بالكيلو شامل الضريبة.") && [1, 16, 17, 18, 31, 46].every((n) => d[`h${n}`] === "السعر بالريال")) && [seen(rt[0]), seen(o[0])].every((j) => !/1464|494|194|الكمية/.test(j)) && bodyOf(o[0]).includes("شامل الضريبة"));
  const all = [a[0], o[0], rt[0]].map(seen);
  assert("nobody reads the customer's name or number", all.every((j) => !j.includes("مدارات") && !j.includes(MADARAT_PHONE) && !j.includes("شركة")));
  assert("nobody reads a price of ours: not the purchase price, not the final price, not another source's observation", all.every((j) => !/3\.33|7\.77|6\.66/.test(j)));
  // § 66 ز — the cause of this file's rare failure, pinned: a token whose random part reads «33…» (after Omar's «603.») or
  // «494…» is no price and no quantity — the raw JSON holds both strings, what the source reads holds neither
  const raw = JSON.stringify({ interactive: { action: { parameters: { flow_token: ASK.newSpecialToken(id, OMAR).replace(/[0-9a-f]+$/, "33494a7c1f000000ab") } } } });
  assert("a token's random digits are not what a source reads («….603.33494…» is no «3.33» and no «494»)", OMAR === 603 && /3\.33/.test(raw) && /494/.test(raw) && !/3\.33|494/.test(seen(JSON.parse(raw))) && [a[0], o[0]].every((b) => TOKEN_RE.test(JSON.stringify(b)) || (TOKEN_RE.lastIndex = 0, TOKEN_RE.test(JSON.stringify(b)))));
  assert("the greeting names the source himself, and nobody else", bodyOf(a[0]).startsWith("مرحبا أحمد 🌿") && bodyOf(o[0]).startsWith("مرحبا عمر 🌿") && !bodyOf(a[0]).includes("رائد"));
  // the request and its sources
  const q = quote(id);
  assert("the request: «أُرسل للمصادر», and when", q.x_state === "sent" && q.x_asked_at === utc(`${DAY} 14:00`));
  assert("each source: when he was asked and how («نموذج» / «قالب»)", recipientOf(id, AHMED).x_via === "نموذج" && recipientOf(id, OMAR).x_via === "نموذج" && recipientOf(id, RAED).x_via === "قالب" && recipientsOf(id).every((x) => x.x_asked_at === utc(`${DAY} 14:00`)));
  assert("Baraa reads who was asked and how — on WhatsApp and on the request", ownerTexts().some((t) => t.startsWith(`📨 طلب الأسعار الخاص ${SQ.quoteName(id)} (شركة مدارات للاغذية، 6 صنف): أحمد حسان (شراء: نموذج)، رائد (سوق: قالب)، عمر المجهلي (سوق: نموذج).`)) && String(q.x_last_result).startsWith("📨 طلب الأسعار: أحمد حسان (شراء: نموذج)"), ownerTexts().join(" | "));
  assert("Omar's card is as it was: no price source, no price role (a source of this request alone)", !table("res.partner").get(OMAR)!.x_price_source && table("hr.employee").get(7000 + OMAR)!.x_price_source === false && !writes().some((w) => w.model === "hr.employee" || (w.model === "res.partner" && Object.keys(w.body?.vals ?? {}).some((k) => k !== "x_wa_channel_id"))));
  assert("nothing of the day is read or written by the ask", !odooLog.some((l) => dayModels.includes(l.model) || l.model === "x_price_offer"));
  assert("the purposes: the ask and its reminder are operational, never a customer's price purpose, never the owner's alone", PURPOSES[ASK.SPECIAL_ASK_PURPOSE]?.kind === "operational" && PURPOSES[ASK.SPECIAL_NUDGE_PURPOSE]?.kind === "operational" && !CUSTOMER_PRICE_PURPOSES.has(ASK.SPECIAL_ASK_PURPOSE) && PURPOSES[ASK.SPECIAL_TEST_PURPOSE]?.kind === "operational");
  assert("the schema gate let every field through", rejected.length === 0, rejected.join(" | "));
  // a second press within the lock: nothing more
  const n = graph.length;
  const again = await quiet(() => ASK.sendSpecialAsk(env, id));
  assert("a second press a moment later sends nothing (the button's lock)", again.action === "busy" && graph.length === n);
}

console.log("\n[ب5] the replies: on the request's lines alone, at any hour");
{
  // the day's list is published while the request is open: nothing of it may move
  const dayId = seed("x_price_day", { x_date: DAY, x_state: "published", x_published_at: utc(`${DAY} 06:00`), x_name: `أسعار ${DAY}`, x_utak_simulation: false });
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: RAED, x_date: DAY, x_purchase_price: 0, x_market_price: 31, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false, x_source_message_id: "wamid.DAY" });
  const dayBefore = JSON.stringify(table("x_price_day").get(dayId));
  // the numbers the privacy checks planted are gone: the lines are as Baraa saved them
  Object.assign(lineOf(id, ORANGE), { x_purchase_price: 0, x_final_price: 0, x_obs: false });
  odooLog.length = 0;
  // Ahmed, through the webhook: orange 3, garlic 10, tomato 2.5, cucumber empty, lettuce not a number, mushroom 20, and a remark
  const ta = tokenOf(flowsTo(AHMED_PHONE)[0]);
  await say(env, AHMED_PHONE, nfm({ p1: "3", p16: "10", p17: "2.5", p18: "", p31: "abc", p46: "20", remark: "الفطر بالكرتون 2 كيلو" }, ta));
  assert("Ahmed's prices are on their lines as the purchase price", lineOf(id, ORANGE).x_purchase_price === 3 && lineOf(id, GARLIC).x_purchase_price === 10 && lineOf(id, 1).x_purchase_price === 2.5 && lineOf(id, MUSHROOM).x_purchase_price === 20, JSON.stringify(linesOf(id).map((l) => l.x_purchase_price)));
  assert("an empty field writes nothing; a field that is not a price writes nothing", !lineOf(id, 2).x_purchase_price && !lineOf(id, LETTUCE).x_purchase_price);
  assert("the numbers follow at once: «بدون خسارة» and «المقترح» of each priced line", lineOf(id, GARLIC).x_no_loss_price === 12.08 && lineOf(id, GARLIC).x_suggested_price === 13.5 && lineOf(id, ORANGE).x_no_loss_price === 3.62 && quote(id).x_missing_purchase === 2);
  assert("his row: answered, four items priced; his remark is on the request", recipientOf(id, AHMED).x_replied_at === utc(`${DAY} 14:00`) && recipientOf(id, AHMED).x_priced === 4 && quote(id).x_source_notes === "أحمد حسان (شراء): الفطر بالكرتون 2 كيلو");
  assert("Baraa: «📨 وصلت أسعار الشراء لطلب شركة مدارات للاغذية: 4 من 6 صنف», the source, his remark, the field that was not a price", ownerTexts().some((t) => t.startsWith("📨 وصلت أسعار الشراء لطلب شركة مدارات للاغذية: 4 من 6 صنف\n") && t.includes("المصدر: أحمد حسان") && t.includes("ملاحظته: الفطر بالكرتون 2 كيلو") && t.includes("خانات ليست سعراً: خس أمريكي")), ownerTexts().slice(-1)[0]);
  const ack = flowsTo(AHMED_PHONE).slice(-1)[0];
  assert("Ahmed reads back his own numbers, under «تعديل»", bodyOf(ack).startsWith("وصلت ✅ برتقال 3، ثوم 10، طماطم 2.5، فطر أبيض 20.") && bodyOf(ack).includes("⚠️ ما انحفظ (السعر رقم أكبر من صفر): خس أمريكي.") && par(ack).flow_cta === "تعديل" && dataOf(ack).i1 === "3" && dataOf(ack).i46 === "20" && dataOf(ack).i18 === "");
  assert("…and nothing of ours in it: no «المقترح», no market price, no customer", !/13\.5|3\.62|12\.08|مدارات|6\.66/.test(seen(ack)));
  // the day is untouched: no day's price, no refresh, no supplier log, no «آخر تسليم أسعار» on his card
  assert("no day's price is written: no x_daily_price row, nothing on x_price_day or its lines, no ask log", !odooLog.some((l) => dayModels.includes(l.model)) && rows("x_daily_price").length === 0 && JSON.stringify(table("x_price_day").get(dayId)) === dayBefore, JSON.stringify(odooLog.filter((l) => dayModels.includes(l.model)).map((l) => `${l.model}.${l.method}`)));
  assert("a purchase price is no market observation: no offer row for it, and his card is not stamped", offers().length === 1 && !odooLog.some((l) => l.model === "res.partner" && l.method === "write" && "x_last_price_submission" in (l.body?.vals ?? {})));
  assert("the day's own «وصلت أسعاره» mark is not set for him (the 05:00 reminder is the day's business)", !(await FL.pricesArrived(env, AHMED_PHONE, DAY)));
  // the token is read once
  const before = JSON.stringify(linesOf(id));
  const dup = await reply(env, AHMED_PHONE, ta, { p1: "99" });
  assert("the same form sent again: not written a second time, and he is told", dup.action === "duplicate" && JSON.stringify(linesOf(id)) === before && bodyOf(flowsTo(AHMED_PHONE).slice(-1)[0]) === ASK.SPECIAL_USED_TEXT);
  // a token of another number
  const stolen = await reply(env, OMAR_PHONE, tokenOf(rtOf()), { p1: "1" });
  assert("a token sent to another number: nothing is read from it", stolen.action === "unknown" && textsTo(OMAR_PHONE).slice(-1)[0] === ASK.SPECIAL_UNKNOWN_TEXT && JSON.stringify(linesOf(id)) === before);
  assert("a token that is no special token is not this module's", !ASK.isSpecialAskToken("pf1.20261003.30.abc") && ASK.isSpecialAskToken(ta) && (await ASK.readSpecialToken(env, "pf1.x")) === null);

  // Raed answers the template the NEXT day, after the day's publication: accepted (the request is open)
  setRiyadh("2026-10-04 09:30");
  const tr = tokenOf(rtOf());
  const rr = await reply(env, RAED_PHONE, tr, { p1: "4.5", p31: "9", p46: "24" });
  assert("Raed's reply a day later is taken: the request is not closed", rr.action === "saved" && rr.saved === 3);
  assert("his observations are on the lines with his name; one observation is its own median", lineOf(id, ORANGE).x_market_text === "4.5 (رائد 4.5)" && lineOf(id, ORANGE).x_market_median === 4.5 && lineOf(id, LETTUCE).x_market_median === 9 && lineOf(id, MUSHROOM).x_market_median === 24);
  assert("…a market observation never changes the purchase price", lineOf(id, ORANGE).x_purchase_price === 3 && !lineOf(id, LETTUCE).x_purchase_price);
  assert("«المقترح» follows the market: orange 4.5 (above 3.985), mushroom 26.75 («الأدنى المربح» 26.565 above the market 24)", lineOf(id, ORANGE).x_suggested_price === 4.5 && lineOf(id, MUSHROOM).x_suggested_price === 26.75, `${lineOf(id, ORANGE).x_suggested_price} ${lineOf(id, MUSHROOM).x_suggested_price}`);
  const special = offers().filter((x) => x.x_special === true);
  assert("each observation is also a row of «عروض المصادر», flagged «خاص» with the request and the unit", special.length === 3 && special.every((x) => x.x_special_quote_id === id && x.x_special_unit === "كيلو" && x.x_source_partner_id === RAED && x.x_date === "2026-10-04" && x.x_purchase_price === 0 && x.x_status === "valid" && String(x.x_raw_text).startsWith(`طلب أسعار خاص ${SQ.quoteName(id)}: `)) && special.find((x) => x.x_product_tmpl_id === ORANGE).x_market_price === 4.5 && special.find((x) => x.x_product_tmpl_id === ORANGE).x_packaging_id === ORANGE * 10);
  assert("…written in ONE create", odooLog.filter((l) => l.model === "x_price_offer" && l.method === "create").length === 1);
  assert("Baraa: «📨 وصلت أسعار السوق لطلب شركة مدارات للاغذية: 3 من 6 صنف»", ownerTexts().some((t) => t.startsWith("📨 وصلت أسعار السوق لطلب شركة مدارات للاغذية: 3 من 6 صنف\nالمصدر: رائد")));
  assert("Raed reads back his own three numbers and nothing else", (() => { const b = flowsTo(RAED_PHONE).slice(-1)[0]; return bodyOf(b).startsWith("وصلت ✅ برتقال 4.5، خس أمريكي 9، فطر أبيض 24.") && !/1464|494|الكمية|مدارات|3\.62|26\.75/.test(seen(b)); })());
  // Omar's second observation, a quarter of an hour later: the median of the two
  setRiyadh("2026-10-04 09:45");
  const ro = await reply(env, OMAR_PHONE, tokenOf(flowsTo(OMAR_PHONE)[0]), { p1: "5.5", p16: "15", p31: "8" });
  assert("Omar's observation joins Raed's: the median of the two (5), each with its source", ro.action === "saved" && lineOf(id, ORANGE).x_market_median === 5 && lineOf(id, ORANGE).x_market_text === "5 (رائد 4.5 · عمر 5.5)" && lineOf(id, GARLIC).x_market_text === "15 (عمر 15)", lineOf(id, ORANGE).x_market_text);
  assert("…«المقترح» of garlic takes the market (15, above 13.28)", lineOf(id, GARLIC).x_suggested_price === 15);
  // «تعديل»: a corrected price replaces his own, an emptied field keeps it
  const edit = flowsTo(OMAR_PHONE).slice(-1)[0];
  setRiyadh("2026-10-04 09:50");
  const re = await reply(env, OMAR_PHONE, tokenOf(edit), { p1: "6.5", p16: "", p31: "8" });
  assert("«تعديل»: his corrected price replaces his own observation (the median 5.5); the emptied field keeps what he sent", re.action === "saved" && lineOf(id, ORANGE).x_market_text === "5.5 (رائد 4.5 · عمر 6.5)" && lineOf(id, GARLIC).x_market_text === "15 (عمر 15)" && bodyOf(flowsTo(OMAR_PHONE).slice(-1)[0]).includes("⚠️ بقي السعر السابق: ثوم 15"));
  assert("…only the changed price is a new «خاص» row (three of his first form, one of the correction — the unchanged 8 is not written twice)", offers().filter((x) => x.x_special && x.x_source_partner_id === OMAR).length === 4 && offers().filter((x) => x.x_special && x.x_source_partner_id === OMAR && x.x_market_price === 6.5).length === 1 && offers().filter((x) => x.x_special && x.x_source_partner_id === OMAR && x.x_market_price === 8).length === 1);
  assert("…his row counts what he priced: three items", recipientOf(id, OMAR).x_priced === 3);
  // the day's readers leave the «خاص» rows out
  const sources = await quiet(() => PS.loadPriceSources(env));
  const dayOffers = await quiet(() => EN.readDayOffers(env, "2026-10-04", sources));
  assert("the engine's offers of that day hold none of them (Raed's «خاص» rows are no offer of the day)", dayOffers.length === 0 && offers().filter((x) => x.x_date === "2026-10-04").length >= 4, JSON.stringify(dayOffers));
  assert("…and the day they were read on keeps its own one offer", (await quiet(() => EN.readDayOffers(env, DAY, sources))).length === 1);
  assert("a «خاص» row is never the baseline of a day's outlier", (await quiet(() => PS.lastOfferValue(env, RAED, ORANGE, ORANGE * 10, "market"))) === null && (await quiet(() => PS.lastOfferValue(env, RAED, 1, 11, "market"))) === 31);
  assert("…nor «آخر سعر» of the daily form's hint", (await quiet(() => FL.lastPrices(env, { partnerId: RAED, supplier: false }, "market", [ORANGE, 1]))).size === 1);
  assert("…nor «أرسل أسعاره اليوم» of the 05:00 reminder: an answer to a special request is not his prices of the day", (await quiet(() => PS.hasOffersToday(env, RAED, "2026-10-04"))) === false && (await quiet(() => PS.hasOffersToday(env, RAED, DAY))) === true);
  {
    // an outlier of the day on the catalog's tomato: «آخر سعر» is his row before it, never a «خاص» row in between
    const { call } = await import("../src/odoo.ts");
    const { readMoved } = await import("../src/price-review.ts");
    seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: RAED, x_date: "2026-10-04", x_purchase_price: 0, x_market_price: 4, x_status: "valid", x_utak_simulation: false, x_special: true, x_special_quote_id: id, x_source_message_id: "wamid.SP" });
    seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: RAED, x_date: "2026-10-04", x_purchase_price: 0, x_market_price: 60, x_market_outlier: true, x_status: "outlier", x_utak_simulation: false, x_source_message_id: "wamid.OUT" });
    const moved = await quiet(() => readMoved((model, body) => call(env, model, "search_read", body), "2026-10-04", { id: 1, x_product_tmpl_id: 1, x_packaging_id: 11, x_market_price: 60, x_cost_price: 0, x_reason: "سعر شاذ: السوق" } as any));
    assert("…nor «آخر سعر» of a day's outlier in the review (31 ← 60, not the «خاص» 4)", moved.length === 1 && moved[0].kind === "market" && moved[0].last === 31 && moved[0].now === 60, JSON.stringify(moved));
  }
  assert("the day's list stayed as it was through all of it", JSON.stringify(table("x_price_day").get(dayId)) === dayBefore && rows("x_daily_price").length === 0 && rows("x_price_day_line").length === 0);
  assert("the schema gate let every field through", rejected.length === 0, rejected.join(" | "));
}
function rtOf(): any { return tplTo(RAED_PHONE, "utak_price_ask_flow_v2")[0]; }

console.log("\n[ب5] a reply to a closed request");
{
  quote(id).x_state = "closed";
  const before = JSON.stringify(linesOf(id));
  const nOffers = offers().length;
  // Ahmed corrects through «تعديل» after the request was closed
  const edit = flowsTo(AHMED_PHONE).filter((b: any) => par(b).flow_cta === "تعديل")[0];
  const r = await reply(env, AHMED_PHONE, tokenOf(edit), { p1: "2.75", remark: "نزل السعر" });
  assert("a late reply to a closed request writes nothing", r.action === "closed" && JSON.stringify(linesOf(id)) === before && offers().length === nOffers && quote(id).x_state === "closed");
  assert("the source is told the request is closed", textsTo(AHMED_PHONE).slice(-1)[0] === ASK.SPECIAL_CLOSED_TEXT);
  assert("Baraa is told what arrived and was not kept", ownerTexts().some((t) => t.startsWith(`⌛ رد أسعار الشراء من «أحمد حسان» وصل بعد إغلاق الطلب ${SQ.quoteName(id)} (شركة مدارات للاغذية) ولم يُحفظ: برتقال 2.75.`) && t.includes("ملاحظته: نزل السعر")));
  // the button on a closed request
  env.MSG_DEDUP.store.delete(`btnlock:v1:spq_send:${id}`);
  const n = graph.length;
  const s = await quiet(() => ASK.sendSpecialAsk(env, id));
  assert("«📨 أرسل طلب الأسعار» on a closed request: refused, nothing sent, and the request says why", s.action === "refused" && s.detail === "الطلب مغلق" && graph.length === n && String(quote(id).x_last_result).startsWith("🚫 لم يُرسل طلب الأسعار: الطلب مغلق"));
}

console.log("\n[ب4] neither the window nor the template: the form is owed until he writes");
{
  env = world();
  id = request();
  // Meta filed the template MARKETING: it is never used
  Object.assign((rows("x_whatsapp_template") as any[]).find((t) => t.x_purpose === "price_ask_flow"), { x_category: "MARKETING" });
  openWindow(env, AHMED_PHONE);
  const r = await quiet(() => ASK.sendSpecialAsk(env, id));
  assert("Raed and Omar (windows closed, no usable template): nothing sent, nothing held — owed", r.action === "sent" && sentTo(RAED_PHONE).length === 0 && sentTo(OMAR_PHONE).length === 0 && heldFor(env, RAED_PHONE).length === 0 && recipientOf(id, RAED).x_via === "محفوظ حتى يكتب" && recipientOf(id, OMAR).x_via === "محفوظ حتى يكتب", JSON.stringify(r.asks));
  assert("Baraa reads that they wait", ownerTexts().some((t) => t.includes("رائد (سوق: محفوظ حتى يكتب)") && t.includes("أحمد حسان (شراء: نموذج)")));
  // Omar writes anything: his window opens, and the form goes
  await say(env, OMAR_PHONE, { type: "text", text: { body: "السلام عليكم" } });
  const f = flowsTo(OMAR_PHONE).filter((b: any) => par(b).flow_id === ASK.SPECIAL_FLOW_ID);
  assert("Omar's next message: the form goes to him at once", f.length === 1 && dataOf(f[0]).sub === "طلب أسعار خاص — 6 صنف" && recipientOf(id, OMAR).x_via === "نموذج (بعد رسالته)" && !!recipientOf(id, OMAR).x_asked_at);
  await say(env, OMAR_PHONE, { type: "text", text: { body: "وصل؟" } });
  assert("…once: his next message brings no second form", flowsTo(OMAR_PHONE).filter((b: any) => par(b).flow_id === ASK.SPECIAL_FLOW_ID).length === 1);
  // Raed writes after the request was closed: nothing
  quote(id).x_state = "closed";
  await say(env, RAED_PHONE, { type: "text", text: { body: "مرحبا" } });
  assert("a form owed for a request that was closed meanwhile never goes", flowsTo(RAED_PHONE).length === 0);
  assert("a number that is owed nothing costs one KV read and no Odoo read", (await quiet(() => ASK.sendOwedSpecial(env, "966500000777"))) === false);
}

console.log("\n[ب1] what the button refuses, and who it asks on a second press");
{
  env = world();
  for (const [extra, why, lines] of [[{ x_utak_simulation: true }, "الطلب محاكاة", undefined], [{}, "لا أصناف في الطلب", []]] as Array<[Record<string, unknown>, string, any]>) {
    const rid = request(lines, extra);
    const r = await quiet(() => ASK.sendSpecialAsk(env, rid));
    assert(`refused: ${why} — nothing sent`, r.action === "refused" && r.detail === why && graph.filter((b: any) => b?.to !== OWNER).length === 0, JSON.stringify(r));
  }
  const none = request(undefined, { x_prepared: true, x_min_margin_pct: 10 });
  const r0 = await quiet(() => ASK.sendSpecialAsk(env, none));
  assert("refused: a prepared request whose sources Baraa removed — the worker adds none back", r0.action === "refused" && r0.detail === "لا مصادر في تبويب «المصادر»" && recipientsOf(none).length === 0);
  assert("a request that is not there: said", (await quiet(() => ASK.sendSpecialAsk(env, 777777))).action === "not_found");
  // a second press (the lock gone): only who has not answered
  id = request();
  for (const d of [AHMED_PHONE, OMAR_PHONE, RAED_PHONE]) openWindow(env, d);
  await quiet(() => ASK.sendSpecialAsk(env, id));
  await reply(env, AHMED_PHONE, tokenOf(flowsTo(AHMED_PHONE)[0]), { p1: "3" });
  unlock(env, id);
  const nA = sentTo(AHMED_PHONE).length, nR = flowsTo(RAED_PHONE).length;
  const again = await quiet(() => ASK.sendSpecialAsk(env, id));
  assert("a second press asks only who has not answered (Raed and Omar), never Ahmed again", again.action === "sent" && again.asks?.length === 2 && sentTo(AHMED_PHONE).length === nA && flowsTo(RAED_PHONE).length === nR + 1);
  for (const d of [OMAR_PHONE, RAED_PHONE]) await reply(env, d, tokenOf(flowsTo(d).slice(-1)[0]), { p1: "5" });
  unlock(env, id);
  const all = await quiet(() => ASK.sendSpecialAsk(env, id));
  assert("everyone answered: nothing to send, and the request says so", all.action === "refused" && all.detail === "كل المصادر ردّت");
  // a source without a number is named, the others are asked
  const id2 = request();
  table("res.partner").get(RAED)!.x_whatsapp_number = false; table("res.partner").get(RAED)!.phone = false;
  const r2 = await quiet(() => ASK.sendSpecialAsk(env, id2));
  assert("a source with no WhatsApp number: named to Baraa, the others still asked — the one before him and the one after", r2.action === "sent" && r2.asks?.length === 3 && r2.asks.find((a) => a.name === "رائد")?.via === "failed" && r2.asks.find((a) => a.name === "أحمد حسان")?.via === "session" && r2.asks.find((a) => a.name === "عمر المجهلي")?.via === "session" && String(recipientOf(id2, RAED).x_via).startsWith("تعذّر: بلا رقم واتساب") && !recipientOf(id2, RAED).x_asked_at && !!recipientOf(id2, OMAR).x_asked_at, JSON.stringify(r2.asks));
  // a line that left the request after the form went: its price is not written anywhere, and both are told
  const gone = lineOf(id2, GARLIC).id;
  table(LINE).delete(gone);
  const ra = await reply(env, AHMED_PHONE, tokenOf(flowsTo(AHMED_PHONE).slice(-1)[0]), { p1: "3", p16: "10" });
  assert("a price for a line removed since the ask is not written: the line that stayed takes its price, the other is named back to the source", ra.action === "saved" && ra.saved === 1 && lineOf(id2, ORANGE).x_purchase_price === 3 && !table(LINE).has(gone) && bodyOf(flowsTo(AHMED_PHONE).slice(-1)[0]).includes("⚠️ ما انحفظ: ثوم."));
  // § 67 هـ — the second «📨 وصلت أسعار الشراء …» within ten minutes waits in the window of its kind: its end sends it, whole
  await quiet(async () => (await import("../src/owner-alerts.ts")).flushOwnerAlerts(env, Date.now() + 11 * 60_000));
  assert("…and Baraa reads which line it was", ownerTexts().some((t) => t.includes("📨 وصلت أسعار الشراء لطلب شركة مدارات للاغذية: 1 من 6 صنف") && t.includes("أسطر حُذفت من الطلب بعد الإرسال: ثوم")));
  // a source's row Baraa removed after the ask: his prices are still written on the lines, and nothing breaks
  const omarRow = recipientOf(id2, OMAR).id;
  table(RECIPIENT).delete(omarRow);
  const rm = await reply(env, OMAR_PHONE, tokenOf(flowsTo(OMAR_PHONE).slice(-1)[0]), { p1: "5" });
  assert("a source whose row was removed from the request since the ask: his price is still on its line, and he is answered", rm.action === "saved" && lineOf(id2, ORANGE).x_market_text === "5 (عمر 5)" && bodyOf(flowsTo(OMAR_PHONE).slice(-1)[0]).startsWith("وصلت ✅ برتقال 5."), JSON.stringify(rm));
  // a request deleted in Odoo: the reply ends as a closed one's, nothing thrown
  const gone2 = request();
  for (const d of [AHMED_PHONE, OMAR_PHONE]) openWindow(env, d);
  await quiet(() => ASK.sendSpecialAsk(env, gone2));
  const tk = tokenOf(flowsTo(AHMED_PHONE).slice(-1)[0]);
  table(QUOTE).delete(gone2);
  const rg = await reply(env, AHMED_PHONE, tk, { p1: "3" });
  assert("a reply to a request that was deleted: nothing written, the source told it is closed", rg.action === "closed" && textsTo(AHMED_PHONE).slice(-1)[0] === ASK.SPECIAL_CLOSED_TEXT);
}

console.log("\n[ب6] one reminder after three hours, inside the window only");
{
  env = world(`${DAY} 10:00`);
  id = request();
  for (const d of [AHMED_PHONE, OMAR_PHONE, RAED_PHONE]) openWindow(env, d);
  await quiet(() => ASK.sendSpecialAsk(env, id));
  await reply(env, AHMED_PHONE, tokenOf(flowsTo(AHMED_PHONE)[0]), { p1: "3" });
  assert("the reminder waits three hours after the ask", ASK.NUDGE_AFTER_MS === 3 * 3600_000 && (await ASK.readNudges(env)).length === 2 && (await ASK.readNudges(env)).every((n) => n.due === Date.now() + ASK.NUDGE_AFTER_MS));
  setRiyadh(`${DAY} 12:55`);
  odooLog.length = 0;
  assert("before the three hours: nothing, and no Odoo read at all", (await quiet(() => ASK.runSpecialNudgeTick(env))).length === 0 && odooLog.length === 0);
  setRiyadh(`${DAY} 13:01`);
  env.MSG_DEDUP.store.delete(`wa_win:v1:${RAED_PHONE}`);      // Raed's window closed meanwhile
  const nO = flowsTo(OMAR_PHONE).length;
  const t = await quiet(() => ASK.runSpecialNudgeTick(env));
  const nudge = flowsTo(OMAR_PHONE).slice(-1)[0];
  assert("Omar (no answer, window open): ONE reminder with the form again", t.find((x) => x.recipientId === recipientOf(id, OMAR).id)?.action === "sent" && flowsTo(OMAR_PHONE).length === nO + 1 && bodyOf(nudge).startsWith("تذكير من يو تاك: طلب الأسعار الخاص (6 صنف)") && bodyOf(nudge).includes("سعر السوق بالكيلو شامل الضريبة") && recipientOf(id, OMAR).x_reminded_at === utc(`${DAY} 13:01`));
  assert("…a «سوق» source's reminder shows no quantity either", !/1464|الكمية|مدارات/.test(seen(nudge)));
  assert("Raed (window closed): no reminder, no template, nothing held", t.find((x) => x.recipientId === recipientOf(id, RAED).id)?.action === "window_closed" && tplTo(RAED_PHONE, "utak_price_ask_flow_v2").length === 0 && heldFor(env, RAED_PHONE).length === 0 && !recipientOf(id, RAED).x_reminded_at);
  assert("Ahmed answered: no reminder for him (his was dropped with his reply)", !t.some((x) => x.recipientId === recipientOf(id, AHMED).id) && flowsTo(AHMED_PHONE).every((b: any) => !bodyOf(b).startsWith("تذكير")));
  setRiyadh(`${DAY} 18:00`);
  openWindow(env, RAED_PHONE);
  assert("it is tried once: later ticks send nothing more, to nobody", (await quiet(() => ASK.runSpecialNudgeTick(env))).length === 0 && flowsTo(OMAR_PHONE).length === nO + 1 && flowsTo(RAED_PHONE).every((b: any) => !bodyOf(b).startsWith("تذكير")) && (await ASK.readNudges(env)).length === 0);
  // a closed request's reminder never goes
  const id2 = request();
  for (const d of [AHMED_PHONE, OMAR_PHONE, RAED_PHONE]) openWindow(env, d);
  await quiet(() => ASK.sendSpecialAsk(env, id2));
  quote(id2).x_state = "closed";
  setRiyadh(`${DAY} 21:30`);
  const n = graph.length;
  const t2 = await quiet(() => ASK.runSpecialNudgeTick(env));
  assert("a request closed before the three hours: no reminder to anyone", t2.length === 3 && t2.every((x) => x.action === "closed") && graph.length === n);
}

console.log("\n[هـ] the products made for a request are in none of the day's lists");
{
  env = world(`${DAY} 02:00`);
  id = request();
  for (const d of [AHMED_PHONE, OMAR_PHONE, RAED_PHONE]) openWindow(env, d);
  await quiet(() => ASK.sendSpecialAsk(env, id));
  await reply(env, AHMED_PHONE, tokenOf(flowsTo(AHMED_PHONE)[0]), { p1: "3", p31: "6", p16: "10", p46: "20" });
  await reply(env, RAED_PHONE, tokenOf(flowsTo(RAED_PHONE)[0]), { p1: "4.5", p31: "9" });
  const special = [ORANGE, LETTUCE, GARLIC, MUSHROOM];
  assert("they are not «نشط للبيع», before and after the request's prices arrived", special.every((p) => table("product.template").get(p)!.x_is_active_for_sale === false) && !writes().some((w) => w.model === "product.template"));
  const active = await quiet(() => EN.readActiveItems(env, []));
  assert("the engine's items of the day: the catalog's active four, none of the request's", active.length === 4 && !active.some((i) => special.includes(i.productId)), JSON.stringify(active.map((i) => i.productId)));
  const daily = await quiet(() => FL.flowItems(env, { partnerId: AHMED, supplier: true }, "purchase"));
  assert("the daily «أدخل الأسعار» (02:00 / 02:30): none of them has a field", daily.total === 4 && !daily.items.some((i) => special.includes(i.productId)));
  const cat = await quiet(() => PS.activeCatalog(env));
  assert("the catalog a source's text reply is matched against: none of them", !cat.products.some((p) => special.includes(p.id)));
  const sources = await quiet(() => PS.loadPriceSources(env));
  assert("the day's offers: none of the request's observations", (await quiet(() => EN.readDayOffers(env, DAY, sources))).length === 0 && offers().filter((x) => x.x_special).length === 2);
  assert("the customer was sent nothing by the ask or the replies", sentTo(MADARAT_PHONE).length === 0);
  void MADARAT; void QUOTE;
}

done();
