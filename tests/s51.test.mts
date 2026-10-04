// § 51 (2026-10-04) — the price ask as a WhatsApp Flow: a numeric field per item «نشط للبيع».
//
//   [أ] the form: the Flow JSON at Meta against what the worker sends; the label and the hint of a
//       slot; 0 / 1 / 4 / 15 / 16 items (16 = the first fifteen and one alert to Baraa)
//   [ب] the ask: the interactive Flow inside the window, its UTILITY template outside it, and the ask
//       of before § 51 when the template is pending, refused or MARKETING — 02:00 (the supplier),
//       02:30 (the market source, the team queue), the 05:00 reminder; Omar's text
//   [ج] the reply (nfm_reply): read with no extractor, written by the source's role, the empty field,
//       the number's checks, the outlier, «تعديل», a token that is unknown / another number's /
//       of another day / after the publication / used twice
//   [د] the one trial to Baraa: his window, once a day, nothing written in Odoo
//   [هـ] the guide and the map
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s51.test.mts

import { readFileSync } from "node:fs";
import { OWNER, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setFail, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, cost, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

// the Meta template list (the sync's GET) and the extractor: neither is the harness's business here
let metaTemplates: any[] = [];
let claudeCalls = 0, metaListReads = 0;
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("/message_templates")) { metaListReads++; return new Response(JSON.stringify({ data: metaTemplates }), { status: 200 }); }
  if (url.includes("anthropic.com")) claudeCalls++;
  return kitFetch(input as any, init);
}) as typeof fetch;

const FL = await import("../src/price-flow.ts");
const PS = await import("../src/price-sources.ts");
const SUP = await import("../src/suppliers.ts");
const EN = await import("../src/pricing-engine.ts");
const META = await import("../src/meta.ts");
const GW = await import("../src/wa-gateway.ts");
const { flushTeamQueue } = await import("../src/team-queue.ts");
const { withAutoSendJob } = await import("../src/auto-send-guard.ts");
const { PURPOSES, categoryAllowed } = await import("../src/wa-purposes.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helper
const LIB = await import("../scripts/lib/s51-price-flow.mjs");

const TPL_ASK = "utak_supplier_ask_v2", TPL_NUDGE = "utak_supplier_price_nudge", TPL_FLOW = "utak_price_ask_flow_v2";
/** The supplier templates as on the tenant, and the Flow's template in the state given (null = no row). */
function templates(flow: [string, string] | null = null): void {
  const row = (purpose: string, name: string, n: number, status = "APPROVED", category = "UTILITY") =>
    seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: status, x_param_count: n, x_category: category });
  row("supplier_ask", TPL_ASK, 2);
  row("supplier_confirm", "utak_supplier_confirm_v1", 2);
  row("supplier_price_nudge", TPL_NUDGE, 2);
  if (flow) row("price_ask_flow", TPL_FLOW, 1, flow[0], flow[1]);
}
const world = (riyadh = `${DAY} 02:00`, flow: [string, string] | null = null): any => { const env = fresh(riyadh); cost(500); templates(flow); claudeCalls = 0; metaListReads = 0; metaTemplates = []; return env; };
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const tplTo = (d: string, name: string) => sentTo(d).filter((b: any) => b?.template?.name === name);
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? b?.template?.components?.find((c: any) => c.sub_type === "flow")?.parameters?.[0]?.action?.flow_token ?? "";
let wamid = 0;
/** A Flow's reply as the webhook hands it over: the inbound itself has just opened the number's window. */
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) => {
  openWindow(env, from, 0);
  return quiet(() => FL.handlePriceFlowReply(env, { from: "+" + from, messageId: `wamid.F${++wamid}`, flow: { token, values } }, undefined, now));
};
const nfm = (token: string, values: Record<string, unknown>) =>
  ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
const ahmedSrc = { partnerId: AHMED, name: "أحمد حسان", whatsapp: "+" + AHMED_PHONE, supplier: true, role: "purchase" as const };
const omarSrc = { partnerId: DRIVER, employeeId: OMAR_EMP, name: "عمر المجهلي", whatsapp: "+" + DRIVER_PHONE, supplier: false, role: "market" as const };
const dpRows = () => rows("x_daily_price") as any[];
const offerRows = () => rows("x_price_offer") as any[];
const askLogs = () => rows("x_supplier_price_request_log") as any[];
/** `n` active products in all (the world has four), each with a default packaging. */
function activeProducts(n: number): void {
  const all = [...table("product.template").keys()];
  for (const id of all.slice(n)) table("product.template").get(id)!.x_is_active_for_sale = false;
  for (let id = 5; id <= n; id++) {
    seed("product.template", { id, name: `صنف ${id}`, sale_ok: true, x_is_active_for_sale: true });
    seed("x_product_packaging", { id: id * 10 + 1, x_name: "كرتون", x_product_tmpl_id: id, x_is_default: true });
  }
}

// ================================================================ [أ] the form
console.log("\n[أ] utak_price_ask_v1 as it stays at Meta (§ 52 sends v2: tests/s52.test.mts): one screen, fifteen optional number fields, no endpoint");
{
  const json = LIB.buildFlowJson();
  const screen = json.screens[0];
  const inputs = screen.layout.children.filter((c: any) => c.type === "TextInput");
  const footer = screen.layout.children.find((c: any) => c.type === "Footer");
  assert("ONE screen, terminal, and no endpoint (no data_api_version, no routing_model): the data travels with the message", json.screens.length === 1 && screen.terminal === true && json.data_api_version === undefined && json.routing_model === undefined);
  assert("its screen and its fifteen slots, as published (a published Flow's JSON is frozen)", screen.id === "PRICES" && LIB.FLOW_SCREEN === "PRICES" && LIB.FLOW_SLOTS === 15 && inputs.length === 15, `${screen.id} ${inputs.length}`);
  assert("fifteen fields p1 … p15: numeric, optional, each with its label, hint, visibility and initial value from the data",
    inputs.every((c: any, i: number) => c.name === `p${i + 1}` && c["input-type"] === "number" && c.required === false
      && c.label === `\${data.l${i + 1}}` && c["helper-text"] === `\${data.h${i + 1}}` && c.visible === `\${data.v${i + 1}}` && c["init-value"] === `\${data.i${i + 1}}`));
  assert("the heading and the line above the fields come from the data (one Flow for «شراء» and «سوق»)", screen.layout.children[0].type === "TextHeading" && screen.layout.children[0].text === "${data.title}" && screen.layout.children[1].text === "${data.note}");
  assert("«إرسال» completes the Flow with the fifteen fields", footer?.label === "إرسال" && footer["on-click-action"].name === "complete"
    && JSON.stringify(Object.keys(footer["on-click-action"].payload)) === JSON.stringify(Array.from({ length: 15 }, (_, i) => `p${i + 1}`)) && footer["on-click-action"].payload.p7 === "${form.p7}");
  assert("62 data keys on its screen: the heading, the note, 15 × 4", Object.keys(screen.data).length === 62 && screen.data.title.type === "string" && screen.data.v15.type === "boolean" && screen.data.i15.type === "string");
  assert("the line above its fields says «الأسعار بدون ضريبة.» — and so does the worker's line for a purchase price (§ 52 ج: the line follows the role)",
    LIB.FLOW_NOTE === "الأسعار بدون ضريبة. اترك الخانة فاضية لو الصنف غير متوفر." && FL.flowNote("purchase") === LIB.FLOW_NOTE, FL.flowNote("purchase"));
  const t = LIB.templatePayload(FL.PRICE_FLOW_V1_ID);
  assert("its template (filed MARKETING by Meta, never used): UTILITY as submitted, ONE FLOW button «أدخل الأسعار» that navigates to its screen", t.name === "utak_price_ask_flow_v1" && t.category === "UTILITY" && LIB.FLOW_TEMPLATE.purpose === FL.PRICE_FLOW_PURPOSE
    && t.components[1].buttons.length === 1 && t.components[1].buttons[0].type === "FLOW" && t.components[1].buttons[0].text === FL.PRICE_FLOW_CTA && t.components[1].buttons[0].flow_id === "1086052444016554"
    && t.components[1].buttons[0].flow_action === "navigate" && t.components[1].buttons[0].navigate_screen === "PRICES", JSON.stringify(t.components[1]));
  assert("the text inside the window: the greeting, the role's noun, the day, and the role's VAT line", /^صباح الخير أحمد 🌿 طلب أسعار الشراء من يو تاك ليوم 5 أكتوبر 2026\. اضغط «أدخل الأسعار» وعبّ سعر كل صنف \(بدون ضريبة\)\.$/.test(FL.flowAskText("أحمد حسان", "purchase", "2026-10-05")), FL.flowAskText("أحمد حسان", "purchase", "2026-10-05"));
  assert("the noun follows the role: «أسعار الشراء» / «أسعار السوق»", /طلب أسعار السوق من يو تاك/.test(FL.flowAskText("عمر المجهلي", "market", DAY)) && /طلب أسعار الشراء من يو تاك/.test(FL.flowAskText("أحمد", "purchase", DAY)));
}

console.log("\n[أ] a slot: «الصنف — التعبئة» as its label, «آخر سعر: X» as its hint");
{
  const a = FL.slotTexts("رمان كبير", "كرتون", 22);
  assert("«رمان كبير — كرتون» fits Meta's twenty characters: the label is the item and its packaging, the hint its last price", a.label === "رمان كبير — كرتون" && a.hint === "آخر سعر: 22", JSON.stringify(a));
  const b = FL.slotTexts("موز أمريكي", "كرتون · 14 كيلو", 44);
  assert("«موز أمريكي — كرتون · 14 كيلو» does not: the label keeps the product, and its packaging opens the hint", b.label === "موز أمريكي" && b.hint === "كرتون · 14 كيلو · آخر سعر: 44", JSON.stringify(b));
  assert("no last price: «لا سعر سابق» (the hint is never empty)", FL.slotTexts("رمان صغير", "كرتون", null).hint === "لا سعر سابق" && FL.slotTexts("موز أمريكي", "كرتون · 14 كيلو", null).hint === "كرتون · 14 كيلو · لا سعر سابق");
  const long = FL.slotTexts("طماطم بلدي حبة كبيرة درجة أولى", "صندوق بلاستيك مرتجع كبير جداً ".repeat(4), 7.5);
  assert("whatever the names: the label never passes 20 characters, the hint never 80", [...long.label].length === 20 && long.label.endsWith("…") && [...long.hint].length <= 80, JSON.stringify(long));
  assert("the product's code is not part of its name («[UTAK-FRT-012] رمان كبير»)", FL.slotTexts("[UTAK-FRT-012] رمان كبير", "كرتون", null).label === "رمان كبير — كرتون");
  assert("a price with halalas keeps them, a whole one has none", FL.slotTexts("رمان", "كرتون", 22.5).hint === "آخر سعر: 22.50" && FL.slotTexts("رمان", "كرتون", 22).hint === "آخر سعر: 22");
}

console.log("\n[أ] the items: every product «نشط للبيع» in the engine's order — 0, 1, 4, 15, 16");
{
  const env = world();
  activeProducts(0);
  assert("no active item: no form (nothing prepared, no token kept)", (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc))) === null && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("pflow:v1:")));
}
{
  const env = world();
  activeProducts(1);
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  assert("one item: one field shown, fourteen hidden", p.record.items.length === 1 && p.data.v1 === true && p.data.l1 === "طماطم — كرتون" && Array.from({ length: 14 }, (_, i) => p.data[`v${i + 2}`]).every((v) => v === false), JSON.stringify(p.record.items));
  assert("a hidden slot carries no item's text and no value", p.data.l2 === "-" && p.data.h2 === "-" && p.data.i2 === "");
}
{
  const env = world();
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 19, x_date: "2026-09-30", x_extraction_status: "extracted", x_source_message_id: "wamid.SENT" });
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 21, x_date: "2026-10-02", x_extraction_status: "extracted", x_source_message_id: "wamid.SENT" });
  seed("x_daily_price", { x_product_tmpl_id: 2, x_packaging_id: 21, x_supplier_id: AHMED, x_price_sar: 99, x_date: "2026-10-02", x_extraction_status: "extracted", x_utak_simulation: true, x_source_message_id: "wamid.SENT" });
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: DRIVER, x_date: "2026-10-02", x_purchase_price: 0, x_market_price: 30, x_status: "valid", x_utak_simulation: false, x_source_message_id: "wamid.SENT" });
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  assert("four items, in the engine's order, each with its product and its default packaging", p.record.items.map((i: any) => `${i.slot}:${i.productId}/${i.packagingId}`).join() === "1:1/11,2:2/21,3:3/31,4:4/41" && p.total === 4, JSON.stringify(p.record.items));
  assert("…four fields shown, eleven hidden; the heading is the role's", [1, 2, 3, 4].every((n) => p.data[`v${n}`] === true) && p.data.v5 === false && p.data.v15 === false && p.data.sub === "أسعار الشراء اليوم");
  assert("the hint is the source's OWN last price, the newest (21, not 19), never a simulation row's", p.data.h1 === "آخر سعر: 21" && p.data.h2 === "لا سعر سابق", `${p.data.h1} | ${p.data.h2}`);
  const m = (await quiet(() => FL.prepareFlowAsk(env, omarSrc)))!;
  assert("a «سوق» source: «أسعار السوق اليوم», and ITS last market observation (30) — not the supplier's price", m.data.sub === "أسعار السوق اليوم" && m.data.h1 === "آخر سعر: 30" && m.record.kind === "market", `${m.data.sub} | ${m.data.h1}`);
  assert("a token for every send: unique, and it names the day and the source", p.record.token !== m.record.token && p.record.token.startsWith(`pf1.${DAY.replace(/-/g, "")}.${AHMED}.`) && m.record.token.startsWith(`pf1.${DAY.replace(/-/g, "")}.${DRIVER}.`));
  const kept = await FL.readFlowToken(env, p.record.token);
  assert("…kept with the day, the number it goes to, and the item of every slot", kept?.day === DAY && kept.to === AHMED_PHONE && kept.partnerId === AHMED && kept.items.length === 4 && kept.items[2].productId === 3 && kept.items[2].packagingId === 31, JSON.stringify(kept));
}
{
  const env = world();
  activeProducts(15);
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  assert("fifteen items: every field shown, and no alert", p.record.items.length === 15 && p.data.v15 === true && p.total === 15 && ownerTexts().length === 0, ownerTexts().join(" | "));
}
{
  const env = world();
  activeProducts(16);
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  const alerts = ownerTexts().filter((t) => /نموذج الأسعار تتسع لـ 15 خانة/.test(t));
  assert("sixteen items: the first fifteen in the form…", p.record.items.length === 15 && p.total === 16 && p.record.items[14].productId === 15 && !p.record.items.some((i: any) => i.productId === 16));
  assert("…and Baraa told at once which one has no field", alerts.length === 1 && /فيها 16 صنفاً نشطاً للبيع/.test(alerts[0]) && /بلا خانة: صنف 16\./.test(alerts[0]), ownerTexts().join(" | "));
  await quiet(() => FL.prepareFlowAsk(env, omarSrc));
  assert("…once a day (the next ask of the day: no second alert)", ownerTexts().filter((t) => /نموذج الأسعار تتسع لـ 15 خانة/.test(t)).length === 1);
}

// ================================================================ [ب] the ask
console.log("\n[ب] 02:00 — the supplier: the Flow inside his window, its template outside it, the ask of before otherwise");
{
  const env = world(`${DAY} 02:00`);
  table("res.partner").get(AHMED)!.x_price_role = "purchase";
  openWindow(env, AHMED_PHONE, 60);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  const f = flowsTo(AHMED_PHONE);
  assert("inside his 24h window: ONE interactive `flow` message, no template at all", f.length === 1 && sentTo(AHMED_PHONE).length === 1 && f[0].type === "interactive", JSON.stringify(sentTo(AHMED_PHONE).map((b: any) => b.template?.name ?? b.interactive?.type)));
  assert("…the Flow of Meta, opened on its screen with the data (navigate — no endpoint)", par(f[0]).flow_id === FL.PRICE_FLOW_ID && par(f[0]).flow_action === "navigate" && par(f[0]).flow_action_payload.screen === FL.PRICE_FLOW_SCREEN && par(f[0]).flow_message_version === "3" && f[0].interactive.action.name === "flow", JSON.stringify(par(f[0])).slice(0, 300));
  assert("…the button «أدخل الأسعار», and the ask's text above it", par(f[0]).flow_cta === "أدخل الأسعار" && bodyOf(f[0]) === FL.flowAskText("أحمد حسان", "purchase", DAY), bodyOf(f[0]));
  assert("…a field for EVERY active item (four), not only the two on his card", [1, 2, 3, 4].every((n) => dataOf(f[0])[`v${n}`] === true) && dataOf(f[0]).sub === "أسعار الشراء اليوم");
  assert("…the ask is logged as an ask (the 05:00 reminder and the reliability score read this log)", askLogs().length === 1 && askLogs()[0].x_supplier_id === AHMED && askLogs()[0].x_status === "sent", JSON.stringify(askLogs()));
  const rec = await FL.readFlowToken(env, tokenOf(f[0]));
  assert("…its token is kept for this number and this day", rec?.to === AHMED_PHONE && rec.day === DAY && rec.supplier === true && rec.kind === "purchase");
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  assert("the job run twice the same day: no second ask, no second log, and not the old template either", sentTo(AHMED_PHONE).length === 1 && askLogs().length === 1, JSON.stringify(sentTo(AHMED_PHONE).map((b: any) => b.template?.name ?? b.interactive?.type)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 02:00`, ["APPROVED", "UTILITY"]);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  const t = tplTo(AHMED_PHONE, TPL_FLOW);
  const comps = t[0]?.template?.components ?? [];
  const btn = comps.find((c: any) => c.type === "button");
  assert("outside his window, the template APPROVED and UTILITY: utak_price_ask_flow_v2, and not the old ask", t.length === 1 && sentTo(AHMED_PHONE).length === 1, JSON.stringify(sentTo(AHMED_PHONE).map((b: any) => b.template?.name ?? b.interactive?.type)));
  assert("…{{1}} the day, and nothing else", JSON.stringify(comps.find((c: any) => c.type === "body")?.parameters.map((p: any) => p.text)) === JSON.stringify(["3 أكتوبر 2026"]), JSON.stringify(comps));
  assert("…its FLOW button carries this send's token and the form's data", btn?.sub_type === "flow" && btn.index === "0" && btn.parameters[0].type === "action" && btn.parameters[0].action.flow_token.startsWith("pf1.") && btn.parameters[0].action.flow_action_data.v4 === true && btn.parameters[0].action.flow_action_data.sub === "أسعار الشراء اليوم", JSON.stringify(btn));
  assert("…logged as an ask", askLogs().length === 1);
}
{
  const env = world(`${DAY} 02:00`, ["APPROVED", "UTILITY"]);
  openWindow(env, AHMED_PHONE, 60);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  assert("inside his window the template is not used even when it is usable: the interactive message, with no template", flowsTo(AHMED_PHONE).length === 1 && sentTo(AHMED_PHONE).length === 1 && tplTo(AHMED_PHONE, TPL_FLOW).length === 0);
}
{
  const env = world(`${DAY} 02:00`);
  table("res.partner").get(AHMED)!.x_price_role = "market";
  openWindow(env, AHMED_PHONE, 60);
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  assert("the supplier's form follows «دور الأسعار» on his card: a «سوق» supplier is asked for «أسعار السوق اليوم»", dataOf(flowsTo(AHMED_PHONE)[0]).sub === "أسعار السوق اليوم" && /طلب أسعار السوق/.test(bodyOf(flowsTo(AHMED_PHONE)[0])), JSON.stringify(dataOf(flowsTo(AHMED_PHONE)[0]).sub));
}
for (const [label, state] of [["PENDING at Meta", ["PENDING", "UTILITY"]], ["REJECTED", ["REJECTED", "UTILITY"]], ["filed MARKETING by Meta (even APPROVED)", ["APPROVED", "MARKETING"]], ["not registered", null]] as Array<[string, [string, string] | null]>) {
  const env = world(`${DAY} 02:00`, state);
  metaTemplates = state ? [{ id: "1", name: TPL_FLOW, language: "ar", status: state[0], category: state[1], components: [] }] : [];
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  const old = tplTo(AHMED_PHONE, TPL_ASK);
  assert(`outside his window, the Flow's template ${label}: the ask of before goes in the same run (utak_supplier_ask_v2, his own list)`,
    old.length === 1 && sentTo(AHMED_PHONE).length === 1 && tplTo(AHMED_PHONE, TPL_FLOW).length === 0 && flowsTo(AHMED_PHONE).length === 0 && /طماطم، خيار/.test(JSON.stringify(old[0])) && askLogs().length === 1,
    JSON.stringify(sentTo(AHMED_PHONE).map((b: any) => b.template?.name ?? b.interactive?.type)));
  assert("…nothing held and no «skipped» line for the Flow, and no token left behind", heldFor(env, AHMED_PHONE).length === 0 && !(rows("x_wa_message") as any[]).some((r) => r.x_status === "skipped") && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("pflow:v1:")));
  assert(`…Meta's list is read again before the ask only while the row is PENDING (${label})`, metaListReads === (state?.[0] === "PENDING" ? 1 : 0), String(metaListReads));
}
{
  const env = world(`${DAY} 02:00`, ["PENDING", "UTILITY"]);
  metaTemplates = [{ id: "1071676795680561", name: TPL_FLOW, language: "ar", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: LIB.FLOW_TEMPLATE.body }, { type: "BUTTONS", buttons: [{ type: "FLOW", text: "أدخل الأسعار" }] }] }];
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob({ ...env, META_WABA_ID: "WABA" }, "ask_suppliers")));
  assert("PENDING in Odoo and approved at Meta during the evening: read again before the ask, and the Flow's template goes the same night", metaListReads === 1 && tplTo(AHMED_PHONE, TPL_FLOW).length === 1 && tplTo(AHMED_PHONE, TPL_ASK).length === 0,
    JSON.stringify(sentTo(AHMED_PHONE).map((b: any) => b.template?.name ?? b.interactive?.type)));
}
{
  const env = world(`${DAY} 02:00`, ["PENDING", "UTILITY"]);
  metaTemplates = [{ id: "1", name: TPL_FLOW, language: "ar", status: "APPROVED", category: "MARKETING", components: [] }];
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob({ ...env, META_WABA_ID: "WABA" }, "ask_suppliers")));
  assert("approved at Meta but moved to MARKETING: never used — the ask of before", tplTo(AHMED_PHONE, TPL_FLOW).length === 0 && tplTo(AHMED_PHONE, TPL_ASK).length === 1 && !categoryAllowed(FL.PRICE_FLOW_PURPOSE, "MARKETING"));
}
{
  const env = world(`${DAY} 02:00`, ["APPROVED", "UTILITY"]);
  setFail({ [TPL_FLOW]: 132000 });
  await quiet(() => SUP.askAllSuppliersForPrices(withAutoSendJob(env, "ask_suppliers")));
  assert("Meta refuses the Flow's template: the ask of before still goes in the same run (the Flow has its own purpose, so its refusal blocks nothing)",
    tplTo(AHMED_PHONE, TPL_FLOW).length === 1 && tplTo(AHMED_PHONE, TPL_ASK).length === 1 && askLogs().length === 1 && askLogs()[0].x_status === "sent", JSON.stringify(sentTo(AHMED_PHONE).map((b: any) => b.template?.name)));
  assert("…the refused Flow's token is dropped", ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("pflow:v1:")));
  setFail({});
}
{
  assert("the Flow ask is its own operational purpose (a MARKETING template can never carry it), and it is never held", PURPOSES[FL.PRICE_FLOW_PURPOSE]?.kind === "operational" && FL.PRICE_FLOW_PURPOSE !== "supplier_ask" && FL.PRICE_FLOW_PURPOSE !== "market_price_ask");
  const env = world(`${DAY} 02:00`);
  const r = await quiet(() => FL.sendFlowAsk(env, ahmedSrc));
  assert("neither the window nor the template: nothing sent, nothing held, the caller told why", r.via === null && r.duplicate === false && r.reason === "not_usable" && graph.length === 0 && heldFor(env, AHMED_PHONE).length === 0, JSON.stringify(r));
}

console.log("\n[ب] 05:00 — the reminder carries the same button");
{
  const env = world(`${DAY} 05:00`);
  seed("x_supplier_price_request_log", { id: 900, x_supplier_id: AHMED, x_sent_at: "2026-10-02 23:00:05", x_status: "sent", x_replied_at: false });
  openWindow(env, AHMED_PHONE, 120);
  const r = await quiet(() => SUP.nudgeLateSuppliers(withAutoSendJob(env, "reliability_scores")));
  const f = flowsTo(AHMED_PHONE);
  assert("a silent supplier inside his window: the reminder's text over «أدخل الأسعار», once", r.nudged === 1 && f.length === 1 && sentTo(AHMED_PHONE).length === 1 && /^تذكير من يو تاك/.test(bodyOf(f[0])) && /قبل الساعة 6:00 صباحاً/.test(bodyOf(f[0])) && par(f[0]).flow_cta === "أدخل الأسعار" && dataOf(f[0]).v1 === true, bodyOf(f[0]));
  const again = await quiet(() => SUP.nudgeLateSuppliers(withAutoSendJob(env, "reliability_scores")));
  assert("…ONE reminder: a second run sends nothing", again.nudged === 0 && sentTo(AHMED_PHONE).length === 1);
}
{
  const env = world(`${DAY} 05:00`, ["APPROVED", "UTILITY"]);
  seed("x_supplier_price_request_log", { id: 900, x_supplier_id: AHMED, x_sent_at: "2026-10-02 23:00:05", x_status: "sent", x_replied_at: false });
  await quiet(() => SUP.nudgeLateSuppliers(withAutoSendJob(env, "reliability_scores")));
  assert("outside his window, the Flow's template usable: the reminder is that template (the same button)", tplTo(AHMED_PHONE, TPL_FLOW).length === 1 && tplTo(AHMED_PHONE, TPL_NUDGE).length === 0);
}
{
  const env = world(`${DAY} 05:00`, ["PENDING", "MARKETING"]);
  seed("x_supplier_price_request_log", { id: 900, x_supplier_id: AHMED, x_sent_at: "2026-10-02 23:00:05", x_status: "sent", x_replied_at: false });
  const r = await quiet(() => SUP.nudgeLateSuppliers(withAutoSendJob(env, "reliability_scores")));
  assert("outside his window with no usable Flow template: the reminder of before (utak_supplier_price_nudge)", r.nudged === 1 && tplTo(AHMED_PHONE, TPL_NUDGE).length === 1 && tplTo(AHMED_PHONE, TPL_FLOW).length === 0 && flowsTo(AHMED_PHONE).length === 0);
}

console.log("\n[ب] 02:30 — the market source: the Flow inside his window, the team queue before his tap");
{
  const env = world(`${DAY} 02:30`);
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  openWindow(env, DRIVER_PHONE, 20);
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  const f = flowsTo(DRIVER_PHONE);
  assert("Omar inside his window: ONE Flow titled «أسعار السوق اليوم», no text ask beside it", r.asks?.[0]?.action === "sent" && f.length === 1 && sentTo(DRIVER_PHONE).length === 1 && dataOf(f[0]).sub === "أسعار السوق اليوم" && /طلب أسعار السوق/.test(bodyOf(f[0])), JSON.stringify(sentTo(DRIVER_PHONE).map((b: any) => b.text?.body ?? b.interactive?.type)));
  const rec = await FL.readFlowToken(env, tokenOf(f[0]));
  assert("…its token: the employee, a «سوق» source that is no supplier", rec?.partnerId === DRIVER && rec.employeeId === OMAR_EMP && rec.kind === "market" && rec.supplier === false);
  assert("…the 90 minutes of a free-text reply start too (the text reply stays accepted)", await PS.awaitingMarketReply(env, DRIVER_PHONE, Date.now() + 60_000));
  assert("Ahmed (a supplier, asked at 02:00) is not in the 02:30 run", sentTo(AHMED_PHONE).length === 0);
}
{
  // the live cron's env: its sends carry the job «team_attendance»; an earlier interactive message to Omar in that job today
  const env = world(`${DAY} 02:30`);
  openWindow(env, DRIVER_PHONE, 20);
  const cronEnv = { ...env, AUTO_SEND_JOB: "team_attendance" };
  await quiet(() => META.sendButtons(cronEnv, `+${DRIVER_PHONE}`, "أزرار آلية سابقة اليوم", [{ id: "x", title: "تم" }], { purpose: "team_task" }));
  await quiet(() => PS.runMarketAsk(cronEnv, Date.now(), 6 * 60));
  assert("in the */5 cron's own env the Flow goes under the ask's own auto-send job (not a «duplicate» of another interactive message of that job)", flowsTo(DRIVER_PHONE).length === 1 && sentTo(DRIVER_PHONE).length === 2, JSON.stringify(sentTo(DRIVER_PHONE).map((b: any) => b.text?.body ?? b.interactive?.type)));
}
{
  const env = world(`${DAY} 02:30`, ["APPROVED", "UTILITY"]);
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  const t = tplTo(DRIVER_PHONE, TPL_FLOW);
  assert("outside his window with the template usable: the template, its form titled «أسعار السوق اليوم»", r.asks?.[0]?.action === "sent" && t.length === 1 && t[0].template.components.find((c: any) => c.sub_type === "flow").parameters[0].action.flow_action_data.sub === "أسعار السوق اليوم", JSON.stringify(r));
}
{
  const env = world(`${DAY} 02:30`, ["PENDING", "MARKETING"]);
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  const q = JSON.parse(env.MSG_DEDUP.store.get(`pending_loc:+${DRIVER_PHONE}`) ?? "[]");
  assert("outside his window with no usable template: nothing sent — the ask waits in his team queue, the Flow and its text together", r.asks?.[0]?.action === "queued" && sentTo(DRIVER_PHONE).length === 0 && q.length === 1 && q[0].purpose === "market_price_ask" && q[0].ask_day === DAY && q[0].flow?.interactive?.type === "flow" && /أرسل أسعار السوق اليوم/.test(q[0].text), JSON.stringify(q).slice(0, 300));
  setRiyadh(`${DAY} 03:00`); openWindow(env, DRIVER_PHONE, 0);
  await quiet(() => flushTeamQueue(env, `+${DRIVER_PHONE}`));
  assert("03:00, his tap flushes the queue: the Flow reaches him — once, and not its text as well", flowsTo(DRIVER_PHONE).length === 1 && sentTo(DRIVER_PHONE).length === 1 && par(flowsTo(DRIVER_PHONE)[0]).flow_token === par({ interactive: q[0].flow.interactive }).flow_token);
  assert("…and his 90 minutes start then", await PS.awaitingMarketReply(env, DRIVER_PHONE, Date.now() + 60_000));
}
{
  const env = world(`${DAY} 02:30`);
  table("hr.employee").get(OMAR_EMP)!.x_utak_attendance = true;
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  const q = JSON.parse(env.MSG_DEDUP.store.get(`pending_loc:+${DRIVER_PHONE}`) ?? "[]");
  assert("a member on attendance who has not tapped «بدء الدوام»: queued with the Flow, nothing sent", r.asks?.[0]?.action === "queued" && sentTo(DRIVER_PHONE).length === 0 && q[0]?.flow?.interactive?.type === "flow", JSON.stringify(r));
  setRiyadh("2026-10-04 03:00"); openWindow(env, DRIVER_PHONE, 0);
  await quiet(() => flushTeamQueue(env, `+${DRIVER_PHONE}`));
  assert("an ask of another day is dropped at the flush — neither its Flow nor its text", sentTo(DRIVER_PHONE).length === 0);
}
{
  const env = world(`${DAY} 02:30`);
  activeProducts(0);
  openWindow(env, DRIVER_PHONE, 20);
  await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  assert("no active item: no Flow — the text ask of before", flowsTo(DRIVER_PHONE).length === 0 && sentTo(DRIVER_PHONE).length === 1 && /أرسل أسعار السوق اليوم/.test(bodyOf(sentTo(DRIVER_PHONE)[0])));
  assert("Omar's text: «ولو معك سعر شراء اكتب «شراء» جنب رقمه…» is gone — no word of «شراء» in the ask of a source without a role", !/شراء/.test(PS.marketAskText("عمر المجهلي")) && /الصنف والتعبئة والسعر لكل صنف\. اكتب السعر زي ما ينباع في السوق \(شامل الضريبة\)\.$/.test(PS.marketAskText("عمر المجهلي")), PS.marketAskText("عمر المجهلي"));
}

// ================================================================ [ج] the reply
console.log("\n[ج] the reply: Meta's nfm_reply, read with no extractor");
{
  const msgs = META.parseWebhook(inbound(AHMED_PHONE, nfm("pf1.x", { p1: "22", p2: "", p4: "22.5" })));
  assert("nfm_reply → the token and the fields as sent; one inbox line with the values", msgs.length === 1 && msgs[0].type === "interactive" && msgs[0].flow?.token === "pf1.x" && msgs[0].flow.values.p1 === "22" && msgs[0].flow.values.p4 === "22.5" && !("flow_token" in msgs[0].flow.values) && msgs[0].text === "📝 رد النموذج: 22 · 22.5", JSON.stringify(msgs[0]));
  const bad = META.parseWebhook(inbound(AHMED_PHONE, { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { response_json: "{not json" } } }));
  assert("an unreadable response_json: an empty token (which no Flow accepts), never a crash", bad[0].flow?.token === "" && Object.keys(bad[0].flow!.values).length === 0 && /بلا قيم/.test(bad[0].text));
  assert("a button tap is still a button tap (no flow on it)", META.parseWebhook(inbound(AHMED_PHONE, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "x", title: "ت" } } }))[0].flow === undefined);
  assert("a field: a number above zero, in any digits; empty = not available; anything else is not a price",
    FL.parseFlowNumber("22") === 22 && FL.parseFlowNumber(" ٢٢٫٥ ") === 22.5 && FL.parseFlowNumber("22,5") === 22.5 && FL.parseFlowNumber(18) === 18 && FL.parseFlowNumber("") === null && FL.parseFlowNumber("   ") === null && FL.parseFlowNumber(undefined) === null
    && FL.parseFlowNumber("0") === "invalid" && FL.parseFlowNumber("-4") === "invalid" && FL.parseFlowNumber("abc") === "invalid" && FL.parseFlowNumber("22.456") === 22.46);
}
{
  const env = world(`${DAY} 02:00`);
  table("res.partner").get(AHMED)!.x_price_role = "purchase";
  openWindow(env, AHMED_PHONE, 60);
  await quiet(() => SUP.askAllSuppliersForPrices(env));
  const token = tokenOf(flowsTo(AHMED_PHONE)[0]);
  setRiyadh(`${DAY} 03:10`);
  await quiet(() => worker.fetch(signed(inbound(AHMED_PHONE, nfm(token, { p1: "22", p2: "", p3: "", p4: "٢٢٫٥" }))), env, ctx));
  const d = dpRows();
  assert("Ahmed («شراء») sends 22 for the first item and 22.5 for the fourth: two purchase rows, each on its slot's product and packaging", d.length === 2 && d[0].x_supplier_id === AHMED && d[0].x_product_tmpl_id === 1 && d[0].x_packaging_id === 11 && d[0].x_price_sar === 22 && d[1].x_product_tmpl_id === 4 && d[1].x_packaging_id === 41 && d[1].x_price_sar === 22.5 && d.every((r) => r.x_date === DAY), JSON.stringify(d));
  assert("…extraction status «flow», the form's line as the raw reply, the message id on the row", d.every((r) => r.x_extraction_status === "flow" && /^نموذج واتساب: /.test(r.x_raw_reply) && /^wamid\./.test(r.x_source_message_id)), JSON.stringify(d.map((r) => [r.x_extraction_status, r.x_raw_reply])));
  // (the row as it was CREATED: the engine re-syncs the fallback afterwards, and would hide a row created without one)
  const created = odooLog.filter((l) => l.model === "x_daily_price" && l.method === "create").map((l) => l.body.vals_list[0]);
  assert("…the fallback sale price is «السعر المربح المقترح» of the purchase price, written with the row as a text reply's is", created.length === 2 && created[0].x_sale_price === Math.ceil(((22 + 22 * 0.05 + 2 + 2) * 1.15) * 2) / 2 && created[0].x_sale_price > 22 && created[1].x_sale_price > 22.5, JSON.stringify(created.map((c) => c.x_sale_price)));
  assert("an empty field = not available today: nothing written for it", !d.some((r) => r.x_product_tmpl_id === 2 || r.x_product_tmpl_id === 3) && offerRows().length === 0);
  assert("no extractor: Claude is never called for a Flow's reply", claudeCalls === 0, String(claudeCalls));
  assert("…the ask is answered: its log «parsed» with the count, as a text reply marks it", askLogs()[0].x_status === "parsed" && askLogs()[0].x_prices_received_count === 2 && !!askLogs()[0].x_replied_at, JSON.stringify(askLogs()[0]));
  assert("…and «💰 أسعار اليوم» follows at once (the day's lines carry his purchase)", (rows("x_price_day_line") as any[]).some((l) => l.x_product_tmpl_id === 1 && l.x_cost_price === 22));
  const ack = flowsTo(AHMED_PHONE).at(-1);
  assert("the answer at once: «وصلت ✅ طماطم 22، بصل 22.50.»", bodyOf(ack) === "وصلت ✅ طماطم 22، بصل 22.50." && sentTo(AHMED_PHONE).length === 2, bodyOf(ack));
  assert("…under «تعديل», which opens the SAME form with what was sent — on a new token", par(ack).flow_cta === "تعديل" && par(ack).flow_id === FL.PRICE_FLOW_ID && dataOf(ack).i1 === "22" && dataOf(ack).i4 === "22.50" && dataOf(ack).i2 === "" && dataOf(ack).l1 === "طماطم — كرتون" && tokenOf(ack) !== token && tokenOf(ack).startsWith("pf1."), JSON.stringify(dataOf(ack)).slice(0, 200));
  assert("no Odoo field or value outside the schema (the «flow» status is the tenant's)", rejected.length === 0, rejected.join(" | "));
  // Meta delivers the same reply again: handled once
  const same = signed(inbound(AHMED_PHONE, nfm(token, { p1: "30" })));
  const body = await same.clone().text();
  await quiet(() => worker.fetch(same, env, ctx));
  await quiet(() => worker.fetch(new Request("https://w.test/webhook", { method: "POST", body, headers: same.headers }), env, ctx));
  assert("the token again (the same form sent twice): not written a second time, and he is told to use «تعديل»", dpRows().length === 2 && bodyOf(sentTo(AHMED_PHONE).at(-1)) === FL.FLOW_USED_TEXT && par(sentTo(AHMED_PHONE).at(-1)).flow_cta === "تعديل" && sentTo(AHMED_PHONE).length === 3, `${dpRows().length} ${sentTo(AHMED_PHONE).length}`);
  // «تعديل» (an older ask of his that he never answered sits in the log)
  seed("x_supplier_price_request_log", { id: 950, x_supplier_id: AHMED, x_sent_at: "2026-10-01 23:00:05", x_status: "sent", x_replied_at: false });
  setRiyadh(`${DAY} 03:30`);
  const edit = tokenOf(ack);
  await reply(env, AHMED_PHONE, edit, { p1: "24", p4: "" });
  const after = dpRows();
  assert("«تعديل» → 24 for the first item: a new row; the newest of the source is the one the engine reads", after.length === 3 && after[2].x_price_sar === 24 && after[2].x_extraction_status === "flow"
    && EN.latestPerSource(await EN.readDayOffers(env, DAY, await PS.loadPriceSources(env))).filter((o: any) => o.productId === 1 && o.kind === "purchase").map((o: any) => o.price).join() === "24", JSON.stringify(after.map((r) => r.x_price_sar)));
  const ack2 = sentTo(AHMED_PHONE).at(-1);
  assert("…a field emptied in the edit cancels nothing: he is told the price sent before stays, and so is Baraa", /وصلت ✅ طماطم 24\./.test(bodyOf(ack2)) && /بقي السعر السابق: بصل 22\.50/.test(bodyOf(ack2)) && dataOf(ack2).i4 === "22.50" && dataOf(ack2).i1 === "24"
    && ownerTexts().some((t) => /أفرغ في تعديل نموذج الأسعار/.test(t) && /بصل \(كان 22\.50\)/.test(t)), bodyOf(ack2));
  assert("…the edit answers no ask: today's log keeps its count, and an older unanswered ask stays unanswered", askLogs().length === 2 && askLogs().find((l) => l.id !== 950).x_prices_received_count === 2 && askLogs().find((l) => l.id === 950).x_status === "sent" && !askLogs().find((l) => l.id === 950).x_replied_at, JSON.stringify(askLogs()));
}
{
  const env = world(`${DAY} 03:00`);
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  const p = (await quiet(() => FL.prepareFlowAsk(env, omarSrc)))!;
  await reply(env, DRIVER_PHONE, p.record.token, { p1: "34.5", p2: "31", p3: "", p4: "" });
  const o = offerRows();
  assert("Omar («سوق»): market observations (x_price_offer), on the employee, no purchase price and no x_daily_price row", o.length === 2 && dpRows().length === 0 && o[0].x_market_price === 34.5 && o[0].x_purchase_price === 0 && o[0].x_source_partner_id === DRIVER && o[0].x_source_employee_id === OMAR_EMP && o[0].x_product_tmpl_id === 1 && o[0].x_packaging_id === 11 && o[1].x_market_price === 31 && o[1].x_product_tmpl_id === 2 && o.every((r) => r.x_date === DAY && r.x_status === "valid"), JSON.stringify(o));
  assert("…answered «وصلت ✅ طماطم 34.50، خيار 31.» under «تعديل»", bodyOf(sentTo(DRIVER_PHONE).at(-1)) === "وصلت ✅ طماطم 34.50، خيار 31." && par(sentTo(DRIVER_PHONE).at(-1)).flow_cta === "تعديل", bodyOf(sentTo(DRIVER_PHONE).at(-1)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(`${DAY} 03:00`);
  const buyer = { partnerId: DRIVER, employeeId: OMAR_EMP, name: "عمر المجهلي", whatsapp: "+" + DRIVER_PHONE, supplier: false, role: "purchase" as const };
  const p = (await quiet(() => FL.prepareFlowAsk(env, buyer)))!;
  await reply(env, DRIVER_PHONE, p.record.token, { p1: "20" });
  assert("a «شراء» source that is no supplier: a purchase OFFER (x_price_offer.x_purchase_price), no market price", offerRows().length === 1 && offerRows()[0].x_purchase_price === 20 && offerRows()[0].x_market_price === 0 && dpRows().length === 0, JSON.stringify(offerRows()));
  const env2 = world(`${DAY} 03:00`);
  const sm = { ...ahmedSrc, role: "market" as const };
  const p2 = (await quiet(() => FL.prepareFlowAsk(env2, sm)))!;
  await reply(env2, AHMED_PHONE, p2.record.token, { p1: "20" });
  assert("a supplier whose role is «سوق»: a market observation, not a purchase row", offerRows().length === 1 && offerRows()[0].x_market_price === 20 && offerRows()[0].x_purchase_price === 0 && dpRows().length === 0, JSON.stringify([offerRows(), dpRows()]));
  const env3 = world(`${DAY} 03:00`);
  const p3 = (await quiet(() => FL.prepareFlowAsk(env3, { ...ahmedSrc, role: null })))!;
  const p4 = (await quiet(() => FL.prepareFlowAsk(env3, { ...omarSrc, role: null })))!;
  assert("no role: a supplier's numbers are purchase prices, any other source's market observations", p3.record.kind === "purchase" && p3.data.sub === "أسعار الشراء اليوم" && p4.record.kind === "market" && p4.data.sub === "أسعار السوق اليوم");
}
{
  const env = world(`${DAY} 03:00`);
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 20, x_date: "2026-10-02", x_extraction_status: "extracted" });
  seed("x_supplier_price_request_log", { id: 900, x_supplier_id: AHMED, x_sent_at: "2026-10-02 23:00:05", x_status: "sent", x_replied_at: false });
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  await reply(env, AHMED_PHONE, p.record.token, { p1: "40", p2: "0", p3: "abc", p4: "18" });
  const today = dpRows().filter((r) => r.x_date === DAY);
  assert("the same checks as a text reply — an outlier (20 → 40) is saved and used, marked «pending», and Baraa hears of it at once", today.length === 2 && today[0].x_price_sar === 40 && today[0].x_extraction_status === "pending" && today[1].x_extraction_status === "flow"
    && ownerTexts().some((t) => /سعر شاذ من المورد "أحمد حسان"/.test(t) && /آخر سعر: 20/.test(t) && /\+100%/.test(t)), JSON.stringify(today.map((r) => [r.x_price_sar, r.x_extraction_status])));
  assert("a number that is not above zero is never written, and he is told which", !today.some((r) => r.x_product_tmpl_id === 2 || r.x_product_tmpl_id === 3) && /⚠️ ما انحفظ \(السعر رقم أكبر من صفر\): خيار، بطاطس\./.test(bodyOf(sentTo(AHMED_PHONE).at(-1))) && askLogs()[0].x_prices_received_count === 2, bodyOf(sentTo(AHMED_PHONE).at(-1)));
  const env2 = world(`${DAY} 03:00`);
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: DRIVER, x_date: "2026-10-02", x_purchase_price: 0, x_market_price: 20, x_status: "valid", x_utak_simulation: false });
  const m = (await quiet(() => FL.prepareFlowAsk(env2, omarSrc)))!;
  await reply(env2, DRIVER_PHONE, m.record.token, { p1: "40" });
  assert("a market outlier: the offer row is «شاذ», as a text reply's", offerRows().filter((r) => r.x_date === DAY).length === 1 && offerRows().find((r) => r.x_date === DAY).x_status === "outlier" && offerRows().find((r) => r.x_date === DAY).x_market_outlier === true);
}
{
  const env = world(`${DAY} 03:00`);
  seed("x_supplier_price_request_log", { id: 900, x_supplier_id: AHMED, x_sent_at: "2026-10-02 23:00:05", x_status: "sent", x_replied_at: false });
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  const r = await reply(env, AHMED_PHONE, p.record.token, { p1: "", p2: "" });
  assert("every field empty: nothing written, the ask is answered («replied», 0), and he is told no price was recorded", r.action === "saved" && r.saved === 0 && dpRows().length === 0 && offerRows().length === 0 && askLogs()[0].x_status === "replied" && askLogs()[0].x_prices_received_count === 0 && /^وصلت ✅ بدون أسعار/.test(bodyOf(sentTo(AHMED_PHONE).at(-1))), bodyOf(sentTo(AHMED_PHONE).at(-1)));
}

console.log("\n[ج] the token: this number's, this day's, before the publication, once");
{
  const env = world(`${DAY} 03:00`);
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  const unknown = await reply(env, AHMED_PHONE, "pf1.20261003.801.deadbeef", { p1: "22" });
  assert("a token nobody issued: nothing written, «غير صالح»", unknown.action === "unknown" && dpRows().length === 0 && bodyOf(sentTo(AHMED_PHONE).at(-1)) === FL.FLOW_UNKNOWN_TEXT);
  const other = await reply(env, DRIVER_PHONE, p.record.token, { p1: "22" });
  assert("a token sent to another number: nothing written (the items are never taken from the client)", other.action === "unknown" && dpRows().length === 0 && offerRows().length === 0 && bodyOf(sentTo(DRIVER_PHONE).at(-1)) === FL.FLOW_UNKNOWN_TEXT);
  assert("…and the token is still good for its own number", (await reply(env, AHMED_PHONE, p.record.token, { p1: "22" })).action === "saved" && dpRows().length === 1);
}
{
  const env = world(`${DAY} 03:00`);
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  setRiyadh("2026-10-04 00:05");
  const r = await reply(env, AHMED_PHONE, p.record.token, { p1: "22" });
  assert("yesterday's form answered today: expired — nothing written, he is told, and Baraa gets the numbers", r.action === "expired" && r.why === "day" && dpRows().length === 0 && bodyOf(sentTo(AHMED_PHONE).at(-1)) === FL.flowExpiredText("day")
    && ownerTexts().some((t) => /رد نموذج الأسعار من «أحمد حسان»/.test(t) && /طماطم 22/.test(t)), JSON.stringify(ownerTexts()));
}
{
  const env = world(`${DAY} 05:30`);
  const p = (await quiet(() => FL.prepareFlowAsk(env, omarSrc)))!;
  seed("x_price_day", { x_date: DAY, x_state: "published", x_published_at: "2026-10-03 03:00:00", x_utak_simulation: false });
  setRiyadh(`${DAY} 06:20`);
  const r = await reply(env, DRIVER_PHONE, p.record.token, { p1: "30" });
  assert("after that day's publication: not accepted — nothing written, «أسعار اليوم نُشرت»", r.action === "expired" && r.why === "published" && offerRows().length === 0 && bodyOf(sentTo(DRIVER_PHONE).at(-1)) === FL.flowExpiredText("published") && ownerTexts().some((t) => /بعد نشر أسعار اليوم/.test(t)));
  const env2 = world(`${DAY} 05:30`);
  const q = (await quiet(() => FL.prepareFlowAsk(env2, omarSrc)))!;
  seed("x_price_day", { x_date: DAY, x_state: "missed", x_published_at: false, x_utak_simulation: false });
  setRiyadh(`${DAY} 06:20`);
  assert("a day that was NOT published (missed) still takes the reply the same day", (await reply(env2, DRIVER_PHONE, q.record.token, { p1: "30" })).action === "saved" && offerRows().length === 1);
}
{
  const env = world(`${DAY} 03:00`);
  const p = (await quiet(() => FL.prepareFlowAsk(env, ahmedSrc)))!;
  await reply(env, AHMED_PHONE, p.record.token, { p1: "22" });
  const again = await reply(env, AHMED_PHONE, p.record.token, { p1: "23" });
  const last = sentTo(AHMED_PHONE).at(-1);
  assert("the same token a second time: not written again; «سبق إرساله», with «تعديل» opening what the first reply carried", again.action === "duplicate" && dpRows().length === 1 && dpRows()[0].x_price_sar === 22 && bodyOf(last) === FL.FLOW_USED_TEXT && par(last).flow_cta === "تعديل" && dataOf(last).i1 === "22");
  const kept = await FL.readFlowToken(env, p.record.token);
  assert("…the token remembers it was used and with what", !!kept?.usedAt && kept.values?.[1] === 22);
}

// ================================================================ [د] the trial
console.log("\n[د] the one trial to Baraa: inside his window, once a day, nothing written in Odoo");
{
  const env = world(`${DAY} 23:00`, ["APPROVED", "UTILITY"]);
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 21, x_date: "2026-10-02", x_extraction_status: "extracted", x_source_message_id: "wamid.SENT" });
  const hook = { ...env, ODOO_HOOK_TOKEN: "HOOK" };
  const denied = await quiet(() => worker.fetch(new Request("https://w.test/odoo/hook/price-flow-test?token=nope", { method: "POST" }), hook, ctx));
  assert("the trial route needs the hook token", denied.status === 401 && graph.length === 0);
  const res = await quiet(() => worker.fetch(new Request("https://w.test/odoo/hook/price-flow-test?token=HOOK", { method: "POST" }), hook, ctx));
  const out = await res.json() as any;
  const f = flowsTo(OWNER);
  assert("his window open: ONE Flow to Baraa's number — to nobody else, and never a template", out.sent === true && f.length === 1 && graph.length === 1 && graph[0].to === OWNER, JSON.stringify(out));
  assert("…marked «🧪 تجربة» in its heading and its text, with today's items and the purchase source's last prices", String(dataOf(f[0]).t1).startsWith("🧪 تجربة") && bodyOf(f[0]).startsWith("🧪 تجربة") && dataOf(f[0]).v4 === true && dataOf(f[0]).h1 === "آخر سعر: 21", `${dataOf(f[0]).t1} | ${dataOf(f[0]).h1}`);
  const second = await (await quiet(() => worker.fetch(new Request("https://w.test/odoo/hook/price-flow-test?token=HOOK", { method: "POST" }), hook, ctx))).json() as any;
  assert("a second call the same day: nothing sent", second.sent === false && second.reason === "already_today" && graph.length === 1, JSON.stringify(second));
  const before = JSON.stringify([dpRows(), offerRows(), askLogs(), rows("x_price_day")]);
  await quiet(() => worker.fetch(signed(inbound(OWNER, nfm(tokenOf(f[0]), { p1: "22", p4: "22.5" }))), env, ctx));
  const ack = sentTo(OWNER).at(-1);
  assert("Baraa's trial reply: NOTHING written in Odoo (no price, no offer, no log, no price day)", JSON.stringify([dpRows(), offerRows(), askLogs(), rows("x_price_day")]) === before);
  assert("…answered as a real one, marked as a trial, with «تعديل»", /^🧪 تجربة — وصلت ✅ طماطم 22، بصل 22\.50\.\n\(تجربة: لم يُكتب شيء في Odoo\)$/.test(bodyOf(ack)) && par(ack).flow_cta === "تعديل" && String(dataOf(ack).t1).startsWith("🧪 تجربة"), bodyOf(ack));
  await reply(env, OWNER, tokenOf(ack), { p1: "25" });
  assert("…«تعديل» on the trial is a trial too", JSON.stringify([dpRows(), offerRows(), askLogs(), rows("x_price_day")]) === before && /^🧪 تجربة — وصلت ✅ طماطم 25\./.test(bodyOf(sentTo(OWNER).at(-1))));
}
{
  const env = world(`${DAY} 23:00`, ["APPROVED", "UTILITY"]);
  closeOwnerWindow(env);
  const r = await quiet(() => FL.sendFlowTest(env));
  assert("his window closed: nothing sent (no template, nothing held) — reported", r.sent === false && r.reason === "window_closed" && graph.length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(r));
  const g = await quiet(() => GW.sendViaGateway(env, { purpose: FL.PRICE_FLOW_PURPOSE, to: OWNER, content: META.textContent("x") }));
  assert("the real ask can never reach Baraa's number (the owner guard takes the trial's purpose alone)", GW.gatewayDecision(g)?.action === "refused" && graph.length === 0);
}

// ================================================================ [هـ] the guide and the map
console.log("\n[هـ] the guide and the map");
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  assert("OPERATING-DAY: the price ask is a form — «أدخل الأسعار», a field per item, «تعديل»", /زر \*\*«أدخل الأسعار»\*\*/.test(guide) && /\*\*خانة لكل صنف «نشط للبيع»\*\* في Odoo وقت الإرسال/.test(guide) && /زر \*\*«تعديل»\*\* يفتح النموذج نفسه/.test(guide));
  assert("OPERATING-DAY: what happens while the template is not approved (the old ask goes)", /utak_price_ask_flow_v1/.test(guide) && /utak_supplier_ask_v2/.test(guide));
  const claude = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
  assert("CLAUDE.md: the map names src/price-flow.ts", /`price-flow\.ts`/.test(claude));
}

done();
