// § 65 د (2026-10-07) — the price forms: «المقاس» and «المنشأ» beside every price, «➕ صنف إضافي», and who
// the daily asks reach.
//
//   [د1]  utak_price_ask_v3: v2 page for page, with the two fields — the JSON at Meta against the worker
//   [د2]  the ask: v3 inside the window with v2's data and is<n> / io<n>; the template outside it opens v2
//   [د3]  the reply: the size and the origin on the row (a supplier's daily price, a source's observation)
//   [د4]  «تعديل» opens with them; a form of v2 (the template) is still read
//   [د5]  utak_price_extra_v1 and its offer after a taken form
//   [د6]  the extra rows: observations outside the day's list, the catalog's item or the unlinked one
//   [د7]  the 02:30 market ask reaches every APPROVED «سوق» source — and no other
//   [د8]  the 02:00 purchase ask never reaches a supplier «بانتظار الاعتماد» or «موقوف»
//   [د9]  the trial: a market form whose rows are flagged «محاكاة»
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s65-prices.test.mts

import { readFileSync } from "node:fs";
import { OWNER, closeOwnerWindow, ctx, heldFor, inbound, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, cost, done, dp, fresh, market, ownerTexts, rejected } from "./s46-kit.mts";

const FL = await import("../src/price-flow.ts");
const EX = await import("../src/price-extra.ts");
const PS = await import("../src/price-sources.ts");
const SUP = await import("../src/suppliers.ts");
const CAT = await import("../src/supplier-catalog.ts");
const { getActiveSuppliersForAsk } = await import("../src/odoo.ts");
const { withAutoSendJob } = await import("../src/auto-send-guard.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const LIB = await import("../scripts/lib/s65-flows.mjs");
const LIB52 = await import("../scripts/lib/s52-price-flow.mjs");
const worker = (await import("../src/index.ts")).default;
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

const TPL_FLOW = "utak_price_ask_flow_v2";
const RAED = 109, RAED_PHONE = "966533330109";
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? b?.template?.components?.find((c: any) => c.sub_type === "flow")?.parameters?.[0]?.action?.flow_action_data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? b?.template?.components?.find((c: any) => c.sub_type === "flow")?.parameters?.[0]?.action?.flow_token ?? "";
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const priceFlows = (d: string) => flowsTo(d).filter((b: any) => par(b).flow_id === FL.PRICE_FLOW_ID);
const extraFlows = (d: string) => flowsTo(d).filter((b: any) => par(b).flow_id === EX.EXTRA_FLOW_ID);
const tplTo = (d: string, name: string) => sentTo(d).filter((b: any) => b?.template?.name === name);
const dpRows = () => rows("x_daily_price") as any[];
const offers = () => rows("x_price_offer") as any[];
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>) => {
  openWindow(env, from, 0);
  return quiet(() => FL.handlePriceFlowReply(env, { from: "+" + from, messageId: `wamid.P${++wamid}`, flow: { token, values } }));
};
const extraReply = (env: any, from: string, token: string, values: Record<string, unknown>) => {
  openWindow(env, from, 0);
  return quiet(() => EX.handleExtraReply(env, { from: "+" + from, messageId: `wamid.X${++wamid}`, flow: { token, values } }));
};
const ahmedSrc = { partnerId: AHMED, name: "أحمد حسان", whatsapp: "+" + AHMED_PHONE, supplier: true, role: "purchase" as const };
const omarSrc = { partnerId: DRIVER, employeeId: OMAR_EMP, name: "عمر المجهلي", whatsapp: "+" + DRIVER_PHONE, supplier: false, role: "market" as const };
function world(riyadh = `${DAY} 02:00`, flowTemplate = false): any {
  const env = fresh(riyadh); cost(500);
  const row = (purpose: string, name: string, n: number) => seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: n, x_category: "UTILITY" });
  row("supplier_ask", "utak_supplier_ask_v2", 2); row("supplier_confirm", "utak_supplier_confirm_v1", 2); row("supplier_price_nudge", "utak_supplier_price_nudge", 2);
  if (flowTemplate) row("price_ask_flow", TPL_FLOW, 1);
  Object.assign(table("product.template").get(4)!, { default_code: CAT.matchCatalog("بصل")!.code });
  seed("product.template", { id: 990, name: "صنف من مورد (غير مربوط)", default_code: CAT.UNLINKED_CODE, active: false });
  seed("x_product_packaging", { id: 991, x_name: "كما كُتب", x_product_tmpl_id: 990, x_is_default: true });
  return env;
}

console.log("\n[د1] utak_price_ask_v3 at Meta against the worker");
{
  const flow = LIB.buildPriceFlowJson();
  const v2 = LIB52.buildFlowJson();
  assert("its name, v2's four pages of fifteen slots, and the id the worker sends is Meta's (v2's id stays for the template)", LIB.PRICE_FLOW_NAME === "utak_price_ask_v3" && JSON.stringify(flow.screens.map((s: any) => s.id)) === JSON.stringify(v2.screens.map((s: any) => s.id)) && LIB.PRICE_PAGE_SLOTS === FL.PRICE_FLOW_PAGE_SLOTS && LIB.PRICE_SLOTS === FL.PRICE_FLOW_SLOTS && srcOf("price-flow.ts").includes(`export const PRICE_FLOW_ID = "${FL.PRICE_FLOW_ID}"`) && FL.PRICE_FLOW_V2_ID === "1123704886881420" && FL.PRICE_FLOW_ID !== FL.PRICE_FLOW_V2_ID);
  const keys = Object.keys(flow.screens[0].data), v2keys = Object.keys(v2.screens[0].data);
  assert("its data: every key of v2, letter for letter, and is<n> / io<n> of the sixty slots — nothing else", v2keys.every((k) => keys.includes(k)) && keys.length === v2keys.length + 2 * 60 && keys.filter((k) => !v2keys.includes(k)).every((k) => /^i[so]\d+$/.test(k)));
  const slot1 = flow.screens[0].layout.children.filter((c: any) => /^[pso]1$/.test(c.name ?? ""));
  assert("under every price two OPTIONAL text fields: «المقاس» then «المنشأ», shown with their slot, opened with what «تعديل» carries", JSON.stringify(slot1.map((c: any) => c.name)) === JSON.stringify(["p1", "s1", "o1"]) && slot1[1].label === "المقاس" && slot1[2].label === "المنشأ" && slot1.slice(1).every((c: any) => c.required === false && c["input-type"] === "text" && c.visible === "${data.v1}") && slot1[1]["init-value"] === "${data.is1}" && slot1[2]["init-value"] === "${data.io1}" && /66/.test(slot1[1]["helper-text"]));
  assert("fifty components a page — Meta's limit — the title and the category in ONE heading", flow.screens.every((s: any) => LIB.screenComponents(s).length <= 50) && LIB.screenComponents(flow.screens[0]).length === 50 && flow.screens[0].layout.children[0].text === "`${data.sub} ' — ' ${data.t1}`" && flow.screens[1].layout.children[0].text === "`${screen.PAGE_A.data.sub} ' — ' ${screen.PAGE_A.data.t2}`");
  const submit = (k: number) => { const kids = flow.screens[k - 1].layout.children; const last = kids[kids.length - 1]; return (last.type === "If" ? last.else[0] : last)["on-click-action"].payload; };
  assert("«إرسال» on page k returns p, s and o of every slot up to it (a later page reads the earlier ones' forms)", Object.keys(submit(1)).length === 45 && Object.keys(submit(4)).length === 180 && submit(2).s1 === "${screen.PAGE_A.form.s1}" && submit(2).o16 === "${form.o16}" && JSON.stringify(LIB.SLOT_FIELDS) === JSON.stringify(["p", "s", "o"]));
  assert("the screens are titled «طلب أسعار» (the day's form and a special request's)", flow.screens.every((s: any) => s.title === "طلب أسعار"));
}

console.log("\n[د2] the ask");
{
  const env = world();
  openWindow(env, AHMED_PHONE, 0);
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  assert("the interactive message opens v3 with v2's data and the two init keys of every slot", par(p.session.body).flow_id === FL.PRICE_FLOW_ID && JSON.stringify(par(p.session.body).flow_action_payload.data) === JSON.stringify(p.sessionData) && JSON.stringify(Object.keys(p.sessionData).sort()) === JSON.stringify(Object.keys(LIB.buildPriceFlowJson().screens[0].data).sort()) && p.sessionData.sub === "أسعار الشراء اليوم" && p.sessionData.is1 === "" && p.sessionData.io4 === "");
  assert("the template's data is v2's own — no key v2 does not declare", JSON.stringify(Object.keys(p.data).sort()) === JSON.stringify(Object.keys(LIB52.buildFlowJson().screens[0].data).sort()) && p.template.flow!.data === p.data && !("is1" in p.data));
  assert("the token stays a v2 token: a rolled-back worker still reads the reply of a form this one sent", p.record.v === 2 && (await FL.readFlowToken(env, p.record.token))?.v === 2);
  const env2 = world(`${DAY} 02:00`, true);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env2, "ask_suppliers")));
  const t = tplTo(AHMED_PHONE, TPL_FLOW);
  assert("outside his window the template is as it was: its button carries v2's data, without the two fields", t.length === 1 && dataOf(t[0]).sub === "أسعار الشراء اليوم" && dataOf(t[0]).v4 === true && !("is1" in dataOf(t[0])) && Object.keys(dataOf(t[0])).length === 249);
}

console.log("\n[د3] the reply: the size and the origin on the row");
{
  const env = world();
  openWindow(env, AHMED_PHONE, 0);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  const token = tokenOf(priceFlows(AHMED_PHONE)[0]);
  setRiyadh(`${DAY} 03:10`);
  const r = await reply(env, AHMED_PHONE, token, { p1: "22", s1: " 66 ", o1: "مصر", p2: "", s2: "حجم بلا سعر", o2: "", p4: "9", s4: "", o4: "اليمن" });
  const d = dpRows();
  assert("Ahmed's purchase prices are daily prices as before — with «المقاس» and «المنشأ» he typed on each row", r.action === "saved" && d.length === 2 && d[0].x_price_sar === 22 && d[0].x_item_size === "66" && d[0].x_item_origin === "مصر" && d[1].x_price_sar === 9 && !d[1].x_item_size && d[1].x_item_origin === "اليمن" && d.every((x) => x.x_extraction_status === "flow"), JSON.stringify(d.map((x) => [x.x_price_sar, x.x_item_size, x.x_item_origin])));
  assert("a size without a price writes nothing (an empty price = not available today)", !d.some((x) => x.x_product_tmpl_id === 2));
  const ack = priceFlows(AHMED_PHONE).at(-1);
  assert("«وصلت ✅ طماطم 22 (66، مصر)، بصل 9 (اليمن).»", bodyOf(ack) === "وصلت ✅ طماطم 22 (66، مصر)، بصل 9 (اليمن)." && par(ack).flow_cta === "تعديل", bodyOf(ack));
  assert("the day's line reads his price as before (the two fields change no number)", (rows("x_price_day_line") as any[]).some((l) => l.x_product_tmpl_id === 1 && l.x_cost_price === 22));
  // a market source
  openWindow(env, DRIVER_PHONE, 0);
  const o = (await quiet(() => FL.sendFlowAsk(env, omarSrc)));
  await reply(env, DRIVER_PHONE, o.token!, { p1: "30", s1: "88", o1: "", p2: "12" });
  const mine = offers().filter((x) => x.x_source_partner_id === DRIVER);
  assert("a «سوق» source's observation carries them too; a price without them is written without", mine.length === 2 && mine[0].x_market_price === 30 && mine[0].x_item_size === "88" && !mine[0].x_item_origin && mine[1].x_market_price === 12 && !mine[1].x_item_size && mine.every((x) => !x.x_special && !x.x_offer_kind), JSON.stringify(mine));
  assert("a size or an origin is one line of forty characters at most", FL.slotText("  a\n b  ") === "a b" && FL.slotText("x".repeat(90)).length === 40 && FL.slotText(undefined) === "");
  assert("no Odoo field outside the tenant's schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[د4] «تعديل», and a form of v2");
{
  const env = world();
  openWindow(env, AHMED_PHONE, 0);
  const a = await quiet(() => FL.sendFlowAsk(env, ahmedSrc));
  setRiyadh(`${DAY} 03:10`);
  await reply(env, AHMED_PHONE, a.token!, { p1: "22", s1: "66", o1: "مصر", p4: "9" });
  const edit = priceFlows(AHMED_PHONE).at(-1);
  assert("«تعديل» opens the same form with the prices AND the size and the origin he sent", dataOf(edit).i1 === "22" && dataOf(edit).is1 === "66" && dataOf(edit).io1 === "مصر" && dataOf(edit).i4 === "9" && dataOf(edit).is4 === "" && dataOf(edit).is2 === "");
  await reply(env, AHMED_PHONE, tokenOf(edit), { p1: "23", s1: "66", o1: "مصر", p4: "" });
  const d = dpRows();
  assert("the edit writes a new row with them; the emptied price keeps the one sent before", d.length === 3 && d[2].x_price_sar === 23 && d[2].x_item_size === "66" && d[2].x_item_origin === "مصر" && bodyOf(priceFlows(AHMED_PHONE).at(-1)).includes("بقي السعر السابق: بصل 9"));
  // a v2 token (the template's form): no size, no origin
  const token = "pf1.20261003.801.00aa11bb22cc33dd44";
  env.MSG_DEDUP.store.set(FL.flowTokenKey(token), JSON.stringify({ v: 2, token, day: DAY, to: AHMED_PHONE, partnerId: AHMED, employeeId: null, name: "أحمد حسان", supplier: true, kind: "purchase", createdAt: Date.now(), pages: ["خضار"],
    items: [{ slot: 1, productId: 1, packagingId: 11, name: "طماطم", label: "طماطم — كرتون", hint: "-" }] }));
  const r = await reply(env, AHMED_PHONE, token, { p1: "20" });
  assert("a reply of v2 (the template's button) is read as before: the price, no size, no origin", r.action === "saved" && dpRows().at(-1).x_price_sar === 20 && !dpRows().at(-1).x_item_size && !dpRows().at(-1).x_item_origin);
}

console.log("\n[د5] utak_price_extra_v1, and its offer");
{
  const flow = LIB.buildExtraFlowJson();
  const s = flow.screens[0];
  const inputs = s.layout.children.filter((c: any) => c.type === "TextInput");
  assert("one screen, five rows of five optional fields — the item, its price, its packaging, its size, its origin", flow.screens.length === 1 && s.id === EX.EXTRA_FLOW_SCREEN && LIB.EXTRA_ROWS === EX.EXTRA_ROWS && inputs.length === 25 && inputs.every((c: any) => c.required === false) && JSON.stringify(inputs.slice(0, 5).map((c: any) => c.name)) === JSON.stringify(["xn1", "xp1", "xk1", "xs1", "xo1"]) && inputs[1]["input-type"] === "number");
  assert("the id the worker sends is Meta's; its data is the screen's data model; «إرسال» returns the 25 fields", /^\d{15,17}$/.test(EX.EXTRA_FLOW_ID) && srcOf("price-extra.ts").includes(`export const EXTRA_FLOW_ID = "${EX.EXTRA_FLOW_ID}"`) && JSON.stringify(Object.keys(s.data).sort()) === JSON.stringify(["note", "t"]) && Object.keys(s.layout.children.at(-1)["on-click-action"].payload).length === 25 && LIB.EXTRA_CTA === EX.EXTRA_CTA);
  assert("Meta's limits: under fifty components, twenty characters a label and the button", LIB.screenComponents(s).length <= 50 && inputs.every((c: any) => [...c.label].length <= 20) && [...EX.EXTRA_CTA].length <= 20);
  const env = world();
  openWindow(env, AHMED_PHONE, 0);
  const a = await quiet(() => FL.sendFlowAsk(env, ahmedSrc));
  setRiyadh(`${DAY} 03:10`);
  await reply(env, AHMED_PHONE, a.token!, { p1: "22" });
  const x = extraFlows(AHMED_PHONE);
  assert("after his form is taken: ONE offer of «➕ صنف إضافي», after the answer — the purchase line (بدون ضريبة)", x.length === 1 && sentTo(AHMED_PHONE).at(-1) === x[0] && par(x[0]).flow_cta === "➕ صنف إضافي" && par(x[0]).flow_token.startsWith("px1.") && dataOf(x[0]).t === "أصناف إضافية — أسعار الشراء" && String(dataOf(x[0]).note).startsWith("الأسعار بدون ضريبة") && bodyOf(x[0]) === EX.EXTRA_ASK_TEXT);
  await reply(env, AHMED_PHONE, tokenOf(priceFlows(AHMED_PHONE).at(-1)), { p1: "23" });
  assert("«تعديل» brings no second offer", extraFlows(AHMED_PHONE).length === 1);
  assert("the offer is a reply inside the window, never held", PURPOSES[EX.EXTRA_PURPOSE].kind === "reply" && heldFor(env, AHMED_PHONE).length === 0);
  // a market source reads the market's line
  openWindow(env, DRIVER_PHONE, 0);
  const o = await quiet(() => FL.sendFlowAsk(env, omarSrc));
  await reply(env, DRIVER_PHONE, o.token!, { p1: "30" });
  assert("a «سوق» source's offer says «شامل الضريبة»", dataOf(extraFlows(DRIVER_PHONE)[0]).t === "أصناف إضافية — أسعار السوق" && String(dataOf(extraFlows(DRIVER_PHONE)[0]).note).includes("شامل الضريبة"));
}

console.log("\n[د6] the extra rows");
{
  const env = world();
  openWindow(env, AHMED_PHONE, 0);
  const a = await quiet(() => FL.sendFlowAsk(env, ahmedSrc));
  setRiyadh(`${DAY} 03:10`);
  await reply(env, AHMED_PHONE, a.token!, { p1: "22" });
  const token = tokenOf(extraFlows(AHMED_PHONE)[0]);
  const read = EX.readExtraRows({ xn1: "البصل", xp1: "٧٫٥", xk1: "شوال 20 كجم", xs1: "وسط", xo1: "مصر", xn2: "فاكهة التنين", xp2: "40", xn3: "كمثرى", xp3: "غالي", xn4: "", xp4: "9" });
  assert("a row counts with a name and a price above zero; a name without a readable price is named, a price without a name is nothing", read.rows.length === 2 && read.rows[0].price === 7.5 && read.rows[0].pack === "شوال 20 كجم" && JSON.stringify(read.invalid) === JSON.stringify(["كمثرى"]));
  const before = { daily: dpRows().length, lines: JSON.stringify(rows("x_price_day_line")) };
  const r = await extraReply(env, AHMED_PHONE, token, { xn1: "البصل", xp1: "٧٫٥", xk1: "شوال 20 كجم", xs1: "وسط", xo1: "مصر", xn2: "فاكهة التنين", xp2: "40", xn3: "كمثرى", xp3: "غالي" });
  const x = offers().filter((o) => o.x_offer_kind === "extra");
  assert("two rows «صنف إضافي», his, today's — a purchase source's price is a purchase price", r.action === "saved" && r.saved === 2 && x.length === 2 && x.every((o) => o.x_source_partner_id === AHMED && o.x_date === DAY && o.x_market_price === 0) && x[0].x_purchase_price === 7.5 && x[1].x_purchase_price === 40);
  assert("…the catalog's item with its packaging (by the normalized name), the packaging he wrote, the size and the origin", x[0].x_product_tmpl_id === 4 && x[0].x_packaging_id === 41 && x[0].x_item_text === "البصل" && x[0].x_special_unit === "شوال 20 كجم" && x[0].x_item_size === "وسط" && x[0].x_item_origin === "مصر");
  assert("…an item the catalog does not name hangs on the unlinked item with his text", x[1].x_product_tmpl_id === 990 && x[1].x_packaging_id === 991 && x[1].x_item_text === "فاكهة التنين" && r.unlinked === 1);
  assert("…all flagged «خاص»: outside the day's list — no daily price, no line of the day changed, never «آخر سعر»", x.every((o) => o.x_special === true) && dpRows().length === before.daily && JSON.stringify(rows("x_price_day_line")) === before.lines && (await FL.lastPrices(env, { partnerId: AHMED, supplier: false }, "purchase", [4])).size === 0);
  assert("he is told what arrived and what did not", bodyOf(sentTo(AHMED_PHONE).at(-1)) === "وصلت الأصناف الإضافية ✅ البصل 7.50، فاكهة التنين 40.\n⚠️ ما انحفظ (السعر رقم أكبر من صفر): كمثرى.", bodyOf(sentTo(AHMED_PHONE).at(-1)));
  const o = ownerTexts().filter((t) => t.includes("أصناف إضافية"));
  assert("Baraa gets ONE message: the rows, «خارج قائمة اليوم», and «🆕 صنف من مورد» for the one not in the catalog", o.length === 1 && o[0].startsWith("➕ أصناف إضافية من «أحمد حسان» (شراء) — خارج قائمة اليوم:") && o[0].includes("• البصل 7.50 · شوال 20 كجم · مقاس وسط · مصر") && o[0].includes("🆕 صنف من مورد (ليس في الكتالوج): فاكهة التنين"), o.join("\n---\n"));
  const again = await extraReply(env, AHMED_PHONE, token, { xn1: "خيار", xp1: "5" });
  const other = await extraReply(env, DRIVER_PHONE, token, { xn1: "خيار", xp1: "5" });
  const empty = await extraReply(env, AHMED_PHONE, "px1.801.none", {});
  assert("the token is read once, by its number alone; a token nobody issued writes nothing", again.action === "duplicate" && other.action === "unknown" && empty.action === "unknown" && offers().filter((q) => q.x_offer_kind === "extra").length === 2);
  // a market source's extra is a market observation
  openWindow(env, DRIVER_PHONE, 0);
  await quiet(() => EX.offerExtraForm(env, { partnerId: DRIVER, employeeId: OMAR_EMP, name: "عمر المجهلي", whatsapp: DRIVER_PHONE, kind: "market", day: DAY }));
  await extraReply(env, DRIVER_PHONE, tokenOf(extraFlows(DRIVER_PHONE).at(-1)), { xn1: "بصل", xp1: "11" });
  const m = offers().at(-1);
  assert("a «سوق» source's extra item is a market observation, flagged «خاص» all the same", m.x_market_price === 11 && m.x_purchase_price === 0 && m.x_special === true && m.x_source_employee_id === OMAR_EMP);
  const none = await extraReply(env, DRIVER_PHONE, (await (async () => { await quiet(() => EX.offerExtraForm(env, { partnerId: DRIVER, name: "عمر", whatsapp: DRIVER_PHONE, kind: "market", day: DAY })); return tokenOf(extraFlows(DRIVER_PHONE).at(-1)); })()), {});
  assert("a form sent empty: nothing written, he is told so, and the token stays usable", none.action === "empty" && bodyOf(sentTo(DRIVER_PHONE).at(-1)) === EX.EXTRA_EMPTY_TEXT);
  assert("no Odoo field outside the tenant's schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[د7] the 02:30 market ask: every APPROVED «سوق» source");
{
  const env = world(`${DAY} 02:30`);
  const src = (id: number, phone: string, extra: Record<string, unknown>) => { seed("res.partner", { id, name: `مصدر ${id}`, x_whatsapp_number: "+" + phone, x_price_source: true, x_price_role: "market", supplier_rank: 0, customer_rank: 0, ...extra }); openWindow(env, phone, 0); };
  src(RAED, RAED_PHONE, { name: "رائد", x_supplier_state: "approved" });
  src(7601, "966533330001", { x_supplier_state: "approved" });
  src(7602, "966533330002", { x_supplier_state: "pending" });
  src(7603, "966533330003", { x_supplier_state: "suspended" });
  src(7604, "966533330004", {});
  src(7605, "966533330005", { x_supplier_state: "approved", supplier_rank: 2, x_supplied_product_ids: [] });
  src(7606, "966533330006", { x_supplier_state: "approved", supplier_rank: 2, x_supplied_product_ids: [1] });
  const targets = PS.marketTargets(await PS.loadPriceSources(env)).map((t: any) => t.partnerId);
  assert("the targets: Omar (a flagged employee, as before), Raed and every other approved «سوق» source — no fixed number", JSON.stringify(targets) === JSON.stringify([DRIVER, RAED, 7601, 7605]), JSON.stringify(targets));
  assert("…never a source «بانتظار الاعتماد», «موقوف» or with no state", ![7602, 7603, 7604].some((id) => targets.includes(id)));
  assert("…an approved «سوق» SUPPLIER is asked at 02:30 only when the 02:00 ask does not reach him (no «الأصناف التي يوفرها»)", targets.includes(7605) && !targets.includes(7606));
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 360));
  const asked = (r.asks ?? []).map((a: any) => a.name);
  assert("the run asks them, each by the market form, and nobody else", JSON.stringify(asked.sort()) === JSON.stringify(["رائد", "عمر المجهلي", "مصدر 7601", "مصدر 7605"].sort()) && priceFlows(RAED_PHONE).length === 1 && priceFlows("966533330001").length === 1 && dataOf(priceFlows("966533330001")[0]).sub === "أسعار السوق اليوم" && sentTo("966533330002").length === 0 && sentTo("966533330003").length === 0 && sentTo("966533330004").length === 0 && sentTo("966533330006").length === 0, JSON.stringify(r));
  // the median reads every observation of theirs, as before
  setRiyadh(`${DAY} 03:10`);
  await reply(env, RAED_PHONE, tokenOf(priceFlows(RAED_PHONE)[0]), { p1: "30" });
  await reply(env, "966533330001", tokenOf(priceFlows("966533330001")[0]), { p1: "34" });
  const line = (rows("x_price_day_line") as any[]).find((l) => l.x_product_tmpl_id === 1);
  assert("the market's median is made of every one of their observations, as it was (30 and 34 → 32)", !!line && line.x_market_price === 32 && line.x_market_count === 2, JSON.stringify(line && [line.x_market_price, line.x_market_count]));
}

console.log("\n[د8] the 02:00 purchase ask");
{
  const env = world();
  const sup = (id: number, phone: string, extra: Record<string, unknown>) => seed("res.partner", { id, name: `مورد ${id}`, supplier_rank: 1, x_whatsapp_number: "+" + phone, x_supplied_product_ids: [1], ...extra });
  sup(7701, "966544440001", { x_supplier_state: "pending" });
  sup(7702, "966544440002", { x_supplier_state: "suspended" });
  sup(7703, "966544440003", { x_supplier_state: "approved" });
  sup(7704, "966544440004", {});
  const ids = (await getActiveSuppliersForAsk(env)).map((s: any) => s.id).sort((a: number, b: number) => a - b);
  assert("a supplier «بانتظار الاعتماد» or «موقوف» is not asked; «معتمد» and one with no state yet are, as before", JSON.stringify(ids) === JSON.stringify([AHMED, 7703, 7704]), JSON.stringify(ids));
  seed("res.partner", { id: 7705, name: "سجّل من واتساب", supplier_rank: 0, x_whatsapp_number: "+966544440005", x_supplied_product_ids: [1, 2], x_supplier_state: "approved" });
  assert("a supplier of the registry with no supplier_rank is never asked at 02:00, approved or not (a registration does not make him a purchase source)", !(await getActiveSuppliersForAsk(env)).some((s: any) => s.id === 7705));
}

console.log("\n[د9] the trial");
{
  const T = await import("../src/s65-trials.ts");
  const env = world(`${DAY} 10:00`);
  seed("res.partner", { id: 45, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER });
  const t = await quiet(() => T.sendS65Trial(env, "market"));
  const f = priceFlows(OWNER);
  assert("one market form to Baraa's own number, marked «🧪 تجربة» — and once a day", t.sent === true && f.length === 1 && bodyOf(f[0]).startsWith("🧪 تجربة") && dataOf(f[0]).sub === "أسعار السوق اليوم" && (await quiet(() => T.sendS65Trial(env, "market"))).reason === "already_today");
  const n = { daily: dpRows().length, lines: rows("x_price_day_line").length, days: rows("x_price_day").length };
  const r = await reply(env, OWNER, tokenOf(f[0]), { p1: "31", s1: "66", o1: "مصر" });
  const row = offers().at(-1);
  assert("its reply IS written — a market observation with the size and the origin — flagged «محاكاة»", r.action === "test" && row.x_utak_simulation === true && row.x_market_price === 31 && row.x_item_size === "66" && row.x_item_origin === "مصر" && row.x_source_partner_id === 45, JSON.stringify(row));
  assert("…and counted in no number: no day is made or refreshed for it", dpRows().length === n.daily && rows("x_price_day_line").length === n.lines && rows("x_price_day").length === n.days);
  assert("…the answer says so", bodyOf(priceFlows(OWNER).at(-1)).includes("محاكاة") && bodyOf(priceFlows(OWNER).at(-1)).startsWith("🧪 تجربة — وصلت ✅ طماطم 31 (66، مصر)."));
  const x = extraFlows(OWNER);
  assert("«➕ صنف إضافي» follows, marked «🧪 تجربة»", x.length === 1 && bodyOf(x[0]).startsWith("🧪 تجربة") && String(dataOf(x[0]).t).startsWith("🧪 تجربة"));
  await extraReply(env, OWNER, tokenOf(x[0]), { xn1: "بصل", xp1: "12", xk1: "كيلو" });
  assert("…and its row is flagged «محاكاة» as well", offers().at(-1).x_offer_kind === "extra" && offers().at(-1).x_utak_simulation === true && offers().at(-1).x_special === true);
  // the trial of before (§ 51) still writes nothing and offers no extra
  const env2 = world(`${DAY} 10:00`);
  await quiet(() => FL.sendFlowTest(env2));
  const n2 = offers().length;
  await reply(env2, OWNER, tokenOf(priceFlows(OWNER)[0]), { p1: "25" });
  assert("§ 51's own trial is as it was: nothing written, no extra form", offers().length === n2 && dpRows().length === 0 && extraFlows(OWNER).length === 0 && bodyOf(priceFlows(OWNER).at(-1)).includes("لم يُكتب شيء في Odoo"));
  const env3 = world(`${DAY} 10:00`);
  closeOwnerWindow(env3);
  assert("a closed window burns no attempt", (await quiet(() => T.sendS65Trial(env3, "market"))).reason === "window_closed" && sentTo(OWNER).length === 0 && ![...env3.MSG_DEDUP.store.keys()].some((k: string) => k.includes("pflow_test_sim")));
  // through the webhook, the three tokens of § 65 are routed by their prefix
  const env4 = world(`${DAY} 10:00`);
  openWindow(env4, AHMED_PHONE, 0);
  await quiet(() => EX.offerExtraForm(env4, { partnerId: AHMED, name: "أحمد حسان", whatsapp: AHMED_PHONE, kind: "purchase", day: DAY }));
  await quiet(() => worker.fetch(signed(inbound(AHMED_PHONE, { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ xn1: "بصل", xp1: "6", flow_token: tokenOf(extraFlows(AHMED_PHONE)[0]) }) } } })), env4, ctx));
  assert("a reply of the extra form through the webhook is read by its token (never as a price form)", offers().filter((o) => o.x_offer_kind === "extra").length === 1 && dpRows().length === 0 && bodyOf(sentTo(AHMED_PHONE).at(-1)).startsWith("وصلت الأصناف الإضافية ✅ بصل 6."));
  void dp; void market;
  assert("no Odoo field outside the tenant's schema", rejected.length === 0, rejected.join(" | "));
}

done();
