// § 65 ج (2026-10-07) — «عرض مورد»: «📦 بضاعتي جاهزة» / «🚢 وصلت شحنة».
//
//   [ج1]  utak_supplier_offer_v1: the JSON at Meta against what the worker sends and reads
//   [ج2]  what opens the form, and for whom: an APPROVED supplier alone, inside his window
//   [ج3]  the form's fields: what is read, what refuses the whole form
//   [ج4]  «إرسال»: ONE x_price_offer row «عرض مورد», flagged «خاص» — outside every reader of the day
//   [ج5]  «صنف آخر»: the catalog's item, else the unlinked item and «🆕 صنف من مورد»
//   [ج6]  the token: his number alone, once; a supplier stopped since
//   [ج7]  the webhook, and the trial
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s65-offer.test.mts

import { readFileSync } from "node:fs";
import { OWNER, closeOwnerWindow, ctx, heldFor, inbound, openWindow, quiet, rows, seed, sentTo, signed, table } from "./wa-harness.mts";
import { AHMED, DAY, assert, done, dp, fresh, market, ownerTexts, rejected } from "./s46-kit.mts";

const OFF = await import("../src/supplier-offer.ts");
const REG = await import("../src/supplier-registry.ts");
const CAT = await import("../src/supplier-catalog.ts");
const FL = await import("../src/price-flow.ts");
const PS = await import("../src/price-sources.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { CUSTOMER_PRICE_PURPOSES } = await import("../src/price-privacy.ts");
const LIB = await import("../scripts/lib/s65-flows.mjs");
const worker = (await import("../src/index.ts")).default;
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

const FARM = 7500, FARM_PHONE = "966522220001", OTHER = "966522220002";
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const offers = () => rows("x_price_offer") as any[];
let wamid = 0;
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const reply = (env: any, from: string, token: string, values: Record<string, unknown>) => {
  openWindow(env, from, 0);
  return quiet(() => OFF.handleOfferReply(env, { from: "+" + from, messageId: `wamid.O${++wamid}`, flow: { token, values } }));
};
/** The tenant's shape, an approved farmer who supplies طماطم and خيار, and the unlinked item. */
function world(riyadh = `${DAY} 10:00`): any {
  const env = fresh(riyadh);
  Object.assign(table("product.template").get(1)!, { default_code: CAT.matchCatalog("طماطم")!.code });
  Object.assign(table("product.template").get(2)!, { default_code: CAT.matchCatalog("خيار")!.code });
  Object.assign(table("product.template").get(4)!, { default_code: CAT.matchCatalog("بصل")!.code });
  seed("product.template", { id: 990, name: "صنف من مورد (غير مربوط)", default_code: CAT.UNLINKED_CODE, active: false });
  seed("x_product_packaging", { id: 991, x_name: "كما كُتب", x_product_tmpl_id: 990, x_is_default: true });
  seed("res.partner", { id: FARM, name: "مزرعة الخير", x_whatsapp_number: "+" + FARM_PHONE, x_supplier_state: "approved", x_supplier_type: "farmer", x_supplied_product_ids: [1, 2] });
  openWindow(env, FARM_PHONE, 0);
  return env;
}
const VALID = { item: "1", other: "", qty: "200", price: "35", pack: "كرتون 10 كجم", size: "66", origin: "القصيم", from: "2026-10-04", until: "2026-10-08", note: "قطفة أولى" };
const form = async (env: any, what: "ready" | "ship" = "ready") => (await quiet(() => OFF.sendOfferForm(env, { partnerId: FARM, name: "مزرعة الخير", whatsapp: "+" + FARM_PHONE, suppliedIds: [1, 2] }, what))).token!;

console.log("\n[ج1] utak_supplier_offer_v1 at Meta against the worker");
{
  const flow = LIB.buildOfferFlowJson();
  const s = flow.screens[0];
  assert("one screen, and the id the worker sends is Meta's", flow.screens.length === 1 && s.id === OFF.OFFER_FLOW_SCREEN && s.terminal === true && /^\d{15,17}$/.test(OFF.OFFER_FLOW_ID) && srcOf("supplier-offer.ts").includes(`export const OFFER_FLOW_ID = "${OFF.OFFER_FLOW_ID}"`));
  assert("the data the worker sends is the screen's data model, key for key", JSON.stringify(Object.keys(OFF.offerData("ready", [], DAY)).sort()) === JSON.stringify(Object.keys(s.data).sort()));
  const kids = s.layout.children.filter((c: any) => c.name);
  assert("its fields, in order: the item, «صنف آخر», the quantity, the price, the packaging, the size, the origin, ready from / until, a note", JSON.stringify(kids.map((c: any) => c.name)) === JSON.stringify(LIB.OFFER_FIELDS) && JSON.stringify(Object.keys(s.layout.children.at(-1)["on-click-action"].payload)) === JSON.stringify(LIB.OFFER_FIELDS));
  assert("the item, the quantity, the price and the packaging are required; the rest is optional", JSON.stringify(kids.filter((c: any) => c.required === true).map((c: any) => c.name)) === JSON.stringify(["item", "qty", "price", "pack"]));
  assert("the item is a list the worker sends (his items), and «صنف آخر» is its last choice", kids[0].type === "Dropdown" && kids[0]["data-source"] === "${data.items}" && OFF.offerOptions([{ id: 1, name: "طماطم" }]).at(-1)!.id === LIB.OFFER_OTHER_ID && LIB.OFFER_OTHER_TITLE === OFF.OFFER_OTHER_TITLE);
  assert("Meta's limits: a list of two hundred at most, thirty characters a choice, twenty a label", OFF.offerOptions(Array.from({ length: 400 }, (_, i) => ({ id: i + 1, name: "صنف باسم طويل جداً يتجاوز الثلاثين حرفاً بكثير" }))).length === 200 && OFF.offerOptions([{ id: 1, name: "صنف باسم طويل جداً يتجاوز الثلاثين حرفاً بكثير" }]).every((o) => [...o.title].length <= 30) && kids.every((c: any) => [...c.label].length <= 20) && [...OFF.OFFER_CTA].length <= 20);
  assert("the check-in template's button «عرض مورد» is one of the words that open the form", LIB.SUPPLIER_CHECKIN.buttons[0].text === LIB.CHECKIN_BUTTON && OFF.offerTrigger({ text: LIB.CHECKIN_BUTTON }) === "ready");
}

console.log("\n[ج2] what opens the form, and for whom");
{
  assert("the welcome's two buttons by their ids, their texts typed, and «عرض مورد»", OFF.offerTrigger({ text: "x", buttonId: "sup_offer:ready" }) === "ready" && OFF.offerTrigger({ text: "x", buttonId: "sup_offer:ship" }) === "ship" && OFF.offerTrigger({ text: "📦 بضاعتي جاهزة" }) === "ready" && OFF.offerTrigger({ text: "🚢 وصلت شحنة" }) === "ship" && OFF.offerTrigger({ text: "بضاعتي جاهزه" }) === "ready" && OFF.offerTrigger({ text: "عرض مورد" }) === "ready");
  assert("any other message opens nothing", ["عندي بضاعة", "وصلت", "جاهزة", "", "عرض"].every((t) => OFF.offerTrigger({ text: t }) === null));
  const env = world();
  const a = await quiet(() => OFF.answerOfferTrigger(env, { from: "+" + FARM_PHONE, text: "📦 بضاعتي جاهزة", buttonId: "sup_offer:ready" }, { team: false }));
  const f = flowsTo(FARM_PHONE);
  assert("an approved supplier's tap: the form, with HIS items and «صنف آخر», opened on today", a === true && f.length === 1 && par(f[0]).flow_id === OFF.OFFER_FLOW_ID && par(f[0]).flow_cta === "عرض مورد" && JSON.stringify(dataOf(f[0]).items.map((x: any) => `${x.id}:${x.title}`).sort()) === JSON.stringify(["1:طماطم", "2:خيار", `other:${OFF.OFFER_OTHER_TITLE}`]) && dataOf(f[0]).items.at(-1).id === "other" && dataOf(f[0]).d === DAY && dataOf(f[0]).t === "📦 بضاعتي جاهزة", JSON.stringify(dataOf(f[0])));
  await quiet(() => OFF.answerOfferTrigger(env, { from: "+" + FARM_PHONE, text: "🚢 وصلت شحنة" }, { team: false }));
  assert("«🚢 وصلت شحنة»: the same form under its own heading", dataOf(flowsTo(FARM_PHONE).at(-1)).t === "🚢 وصلت شحنة" && String(dataOf(flowsTo(FARM_PHONE).at(-1)).how).includes("الشحنة"));
  seed("res.partner", { id: 7501, name: "بانتظار", x_whatsapp_number: "+" + OTHER, x_supplier_state: "pending" });
  openWindow(env, OTHER, 0);
  const p = await quiet(() => OFF.answerOfferTrigger(env, { from: "+" + OTHER, text: "بضاعتي جاهزة" }, { team: false }));
  assert("a supplier «بانتظار الاعتماد»: no form — he is told his registration is under review", p === true && flowsTo(OTHER).length === 0 && bodyOf(sentTo(OTHER).at(-1)) === REG.SIGNUP_PENDING_TEXT);
  table("res.partner").get(7501)!.x_supplier_state = "suspended";
  const n = sentTo(OTHER).length;
  const s = await quiet(() => OFF.answerOfferTrigger(env, { from: "+" + OTHER, text: "بضاعتي جاهزة" }, { team: false }));
  assert("a supplier «موقوف»: nothing at all", s === true && sentTo(OTHER).length === n);
  const c = await quiet(() => OFF.answerOfferTrigger(env, { from: "+966500000501", text: "بضاعتي جاهزة" }, { team: false }));
  const t = await quiet(() => OFF.answerOfferTrigger(env, { from: "+" + FARM_PHONE, text: "بضاعتي جاهزة" }, { team: true }));
  assert("a number that is no supplier of the registry, and a team member: not answered here", c === false && t === false);
  const env2 = fresh(`${DAY} 10:00`);
  seed("res.partner", { id: FARM, name: "مزرعة الخير", x_whatsapp_number: "+" + FARM_PHONE, x_supplier_state: "approved", x_supplied_product_ids: [1] });
  const closed = await quiet(() => OFF.sendOfferForm(env2, { partnerId: FARM, name: "مزرعة الخير", whatsapp: "+" + FARM_PHONE, suppliedIds: [1] }, "ready"));
  assert("outside his window nothing is sent and nothing is held", closed.sent === false && closed.reason === "window_closed" && sentTo(FARM_PHONE).length === 0 && heldFor(env2, FARM_PHONE).length === 0);
  assert("the offer form is a reply, and no purpose of the registry is a customers' price purpose", PURPOSES[OFF.OFFER_FORM_PURPOSE].kind === "reply" && ![OFF.OFFER_FORM_PURPOSE, REG.SUPPLIER_REPLY_PURPOSE, REG.SIGNUP_PURPOSE, "supplier_checkin", "supplier_welcome"].some((p2) => CUSTOMER_PRICE_PURPOSES.has(p2)));
}

console.log("\n[ج3] the form's fields");
{
  const rec = { items: [{ id: 1, name: "طماطم" }, { id: 2, name: "خيار" }] };
  const p = OFF.parseOfferValues(rec, VALID);
  assert("a valid form: his item, 200, 35, the packaging, the size, the origin, the two dates, the note", p.problems.length === 0 && p.productId === 1 && p.itemText === "طماطم" && p.qty === 200 && p.price === 35 && p.pack === "كرتون 10 كجم" && p.size === "66" && p.origin === "القصيم" && p.from === "2026-10-04" && p.until === "2026-10-08" && p.note === "قطفة أولى");
  assert("Arabic digits and «٫» are read: «٢٠٠» and «٣٥٫٥»", OFF.offerNumber("٢٠٠") === 200 && OFF.offerNumber("٣٥٫٥") === 35.5 && OFF.offerNumber("12,5") === 12.5);
  assert("zero, a negative, a word: not a number", [0, "0", "-3", "كثير", "", null, "1.2.3"].every((v) => OFF.offerNumber(v) === null));
  assert("each of the four required fields refuses the form when it cannot be read", ["item", "qty", "price", "pack"].every((k) => JSON.stringify(OFF.parseOfferValues(rec, { ...VALID, [k]: k === "item" ? "77" : "" }).problems) === JSON.stringify([k])));
  assert("the item is read against the token's list — an id that is not of his list is refused; «صنف آخر» needs its text", OFF.parseOfferValues(rec, { ...VALID, item: "3" }).problems.includes("item") && OFF.parseOfferValues(rec, { ...VALID, item: "other", other: "" }).problems.includes("item") && OFF.parseOfferValues(rec, { ...VALID, item: "other", other: "كمثرى" }).itemText === "كمثرى");
  assert("a date: «YYYY-MM-DD», or milliseconds as an older client sends them; «حتى» before «من» is dropped", OFF.offerDate("2026-10-04") === "2026-10-04" && OFF.offerDate(String(Date.UTC(2026, 9, 4, 0, 0))) === "2026-10-04" && OFF.offerDate("غداً") === "" && OFF.parseOfferValues(rec, { ...VALID, until: "2026-10-01" }).until === "");
  assert("«طماطم — 200 × كرتون 10 كجم بسعر 35 · مقاس 66 · القصيم · جاهز من 2026-10-04 حتى 2026-10-08»", OFF.offerLine(p) === "طماطم — 200 × كرتون 10 كجم بسعر 35 · مقاس 66 · القصيم · جاهز من 2026-10-04 حتى 2026-10-08");
}

console.log("\n[ج4] «إرسال»: one row outside the day");
{
  const env = world();
  dp(1, 11, 20); market(1, 11, 30);
  const before = { daily: JSON.stringify(rows("x_daily_price")), day: JSON.stringify(rows("x_price_day")) };
  const token = await form(env);
  const n = offers().length;
  const r = await reply(env, FARM_PHONE, token, VALID);
  const row = offers().find((o) => o.x_offer_kind === "supplier_offer");
  assert("ONE x_price_offer row: his, today's, «عرض مورد»", r.action === "saved" && offers().length === n + 1 && row.x_source_partner_id === FARM && row.x_date === DAY && row.x_offer_kind === OFF.OFFER_KIND && r.rowId === row.id);
  assert("…the item and its packaging, the price as a purchase price, the quantity available", row.x_product_tmpl_id === 1 && row.x_packaging_id === 11 && row.x_purchase_price === 35 && row.x_market_price === 0 && row.x_available_qty === 200);
  assert("…the packaging he WROTE is the price's unit, with the size, the origin, ready from / until and his note", row.x_special_unit === "كرتون 10 كجم" && row.x_item_size === "66" && row.x_item_origin === "القصيم" && row.x_ready_from === "2026-10-04" && row.x_ready_until === "2026-10-08" && row.x_offer_note === "قطفة أولى" && row.x_item_text === "طماطم");
  assert("…flagged «خاص»: the flag every reader of the day leaves out", row.x_special === true && PS.SPECIAL_FIELD === "x_special");
  assert("…never «آخر سعر» of a price form, and never the baseline of an outlier", (await FL.lastPrices(env, { partnerId: FARM, supplier: false }, "purchase", [1])).size === 0 && (await PS.lastOfferValue(env, FARM, 1, 11, "purchase")) === null);
  assert("the day is not touched: no daily price, no price day, no line", JSON.stringify(rows("x_daily_price")) === before.daily && JSON.stringify(rows("x_price_day")) === before.day);
  assert("he is told his offer arrived — with what he sent, and no price of ours", bodyOf(sentTo(FARM_PHONE).at(-1)).startsWith("وصل عرضك ✅ طماطم — 200 × كرتون 10 كجم بسعر 35") && !/30|20 ريال/.test(bodyOf(sentTo(FARM_PHONE).at(-1))));
  const o = ownerTexts().filter((t) => t.includes("عرض مورد"));
  assert("Baraa gets ONE message «📦 عرض مورد من «مزرعة الخير»» with the offer, his note and where it is", o.length === 1 && o[0].startsWith("📦 عرض مورد من «مزرعة الخير»\nطماطم — 200 × كرتون 10 كجم بسعر 35") && o[0].includes("ملاحظته: قطفة أولى") && o[0].includes("«🛒 المشتريات ← 📥 عروض الموردين»") && !ownerTexts().some((t) => t.includes("🆕")), o.join("\n---\n"));
  assert("«آخر سعر/عرض» on his card says it", String(table("res.partner").get(FARM)!.x_last_offer_text).startsWith("طماطم — 200 × كرتون 10 كجم بسعر 35") && String(table("res.partner").get(FARM)!.x_last_offer_text).endsWith(`— ${DAY}`));
  // the day's engine, with the offer in the table: its numbers are those of before the offer
  const EN = await import("../src/pricing-engine.ts");
  const P = await import("../src/prices.ts");
  await quiet(() => P.refreshPriceDay(env, { now: Date.now() }));
  const line = (rows("x_price_day_line") as any[]).find((l) => l.x_product_tmpl_id === 1);
  assert("the day's line of the item reads the supplier's 20 and the market's 30 — the offer's 35 is nowhere in it", !!line && line.x_cost_price === 20 && line.x_market_price === 30 && typeof EN.readActiveItems === "function", JSON.stringify(line));
  // a shipment
  const ship = await form(env, "ship");
  await reply(env, FARM_PHONE, ship, { ...VALID, item: "2", size: "", origin: "مصر", from: "", until: "", note: "" });
  assert("«🚢 وصلت شحنة»: Baraa's message says so", ownerTexts().some((t) => t.startsWith("🚢 وصلت شحنة من «مزرعة الخير»\nخيار — 200")));
  assert("no Odoo field outside the tenant's schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[ج5] «صنف آخر»");
{
  const env = world();
  const t1 = await form(env);
  const r1 = await reply(env, FARM_PHONE, t1, { ...VALID, item: "other", other: "البصل" });
  const row1 = offers().at(-1);
  assert("an item the catalog names (by its normalized name): its product and its packaging, and «📦 عرض مورد»", r1.linked === true && row1.x_product_tmpl_id === 4 && row1.x_packaging_id === 41 && row1.x_item_text === "البصل" && ownerTexts().at(-1)!.startsWith("📦 عرض مورد"));
  const t2 = await form(env);
  const r2 = await reply(env, FARM_PHONE, t2, { ...VALID, item: "other", other: "فاكهة التنين الحمراء" });
  const row2 = offers().at(-1);
  assert("an item the catalog does not name: the row hangs on the unlinked item, with his text beside it", r2.action === "saved" && r2.linked === false && row2.x_product_tmpl_id === 990 && row2.x_packaging_id === 991 && row2.x_item_text === "فاكهة التنين الحمراء" && row2.x_special === true && row2.x_offer_kind === "supplier_offer");
  const last = ownerTexts().at(-1)!;
  assert("…and Baraa's ONE message is «🆕 صنف من مورد»: the text, the offer, and to link it or create it", last.startsWith("🆕 صنف من مورد — «مزرعة الخير» عرض صنفاً ليس في الكتالوج: «فاكهة التنين الحمراء»") && last.includes("اربطه بصنف من الكتالوج أو أنشئه") && ownerTexts().filter((t) => t.includes("فاكهة التنين")).length === 1, last);
  assert("no product is created: the catalog is Baraa's", (rows("product.template") as any[]).length === 5);
}

console.log("\n[ج6] the token, and a supplier stopped since");
{
  const env = world();
  const token = await form(env);
  const n = offers().length;
  const other = await reply(env, OTHER, token, VALID);
  assert("a token sent to another number: nothing written, «غير صالح»", other.action === "unknown" && offers().length === n && bodyOf(sentTo(OTHER).at(-1)) === OFF.OFFER_UNKNOWN_TEXT);
  const bad = await reply(env, FARM_PHONE, token, { ...VALID, price: "0" });
  assert("a price that is not above zero: the WHOLE form is refused — nothing written, Baraa told nothing", bad.action === "invalid" && offers().length === n && bodyOf(sentTo(FARM_PHONE).at(-1)) === OFF.OFFER_BAD_TEXT && !ownerTexts().some((t) => t.includes("عرض مورد")));
  const ok = await reply(env, FARM_PHONE, token, VALID);
  const again = await reply(env, FARM_PHONE, token, VALID);
  assert("the token is read once: the second «إرسال» writes nothing and says so", ok.action === "saved" && again.action === "duplicate" && offers().length === n + 1 && bodyOf(sentTo(FARM_PHONE).at(-1)) === OFF.OFFER_USED_TEXT);
  const t2 = await form(env);
  table("res.partner").get(FARM)!.x_supplier_state = "suspended";
  const stopped = await reply(env, FARM_PHONE, t2, VALID);
  assert("a supplier «موقوف» since the form went: nothing is written", stopped.action === "not_approved" && offers().length === n + 1 && bodyOf(sentTo(FARM_PHONE).at(-1)) === OFF.OFFER_NOT_APPROVED_TEXT);
}

console.log("\n[ج7] the webhook, and the trial");
{
  const env = world();
  await say(env, FARM_PHONE, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "sup_offer:ready", title: "📦 بضاعتي جاهزة" } } });
  const f = flowsTo(FARM_PHONE);
  assert("the welcome's button through the webhook: the offer form, and nothing else", f.length === 1 && par(f[0]).flow_id === OFF.OFFER_FLOW_ID && sentTo(FARM_PHONE).length === 1, JSON.stringify(sentTo(FARM_PHONE).map((b: any) => b?.interactive?.type ?? b?.type)));
  await say(env, FARM_PHONE, { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...VALID, flow_token: par(f[0]).flow_token }) } } });
  assert("its reply through the webhook is read by its token: one row «عرض مورد»", offers().filter((o) => o.x_offer_kind === "supplier_offer").length === 1 && bodyOf(sentTo(FARM_PHONE).at(-1)).startsWith("وصل عرضك ✅"));
  await say(env, FARM_PHONE, { type: "text", text: { body: "عرض مورد" } });
  assert("«عرض مورد» typed (the check-in's button): the form again", flowsTo(FARM_PHONE).length === 2);
  // the trial
  const T = await import("../src/s65-trials.ts");
  const env2 = world();
  seed("res.partner", { id: 45, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER });
  const t = await quiet(() => T.sendS65Trial(env2, "offer"));
  const tf = flowsTo(OWNER);
  assert("the trial: one form to Baraa's own number, marked «🧪 تجربة» — and once a day", t.sent === true && tf.length === 1 && bodyOf(tf[0]).startsWith("🧪 تجربة") && String(dataOf(tf[0]).t).startsWith("🧪 تجربة") && (await quiet(() => T.sendS65Trial(env2, "offer"))).reason === "already_today");
  const tr = await reply(env2, OWNER, par(tf[0]).flow_token, { ...VALID, item: "other", other: "طماطم" });
  const row = offers().at(-1);
  assert("its row is flagged «محاكاة» (and «خاص»): read by no number", tr.action === "test" && row.x_utak_simulation === true && row.x_special === true && row.x_source_partner_id === 45 && bodyOf(sentTo(OWNER).filter((b: any) => b.type === "text").find((b: any) => bodyOf(b).includes("وصل عرضك"))).includes("محاكاة"), JSON.stringify(row));
  assert("…and Baraa's own card is not given an offer line", !table("res.partner").get(45)!.x_last_offer_text);
  const env3 = world();
  closeOwnerWindow(env3);
  assert("a closed window burns no attempt", (await quiet(() => T.sendS65Trial(env3, "offer"))).reason === "window_closed" && sentTo(OWNER).length === 0 && ![...env3.MSG_DEDUP.store.keys()].some((k: string) => k.includes("supso_test")));
  assert("no Odoo field outside the tenant's schema", rejected.length === 0, rejected.join(" | "));
}

done();
