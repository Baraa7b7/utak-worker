// § 55 ج (2026-10-05) — the car's load: the morning's quantities, the evening's left and damaged, and
// what left the car against the day's deliveries.
//
//   [ج1] utak_carload_v1: the JSON at Meta against what the worker sends — every key declared, the
//        types, the components a page, Meta's limits
//   [ج2] the triggers: the text and the button; the driver's role; another member; where the text
//        stands among the team's texts
//   [ج3] the morning load, its replacement, the form sent again; an empty form
//   [ج4] the evening count; what Baraa reads: matching deliveries, and each kind of difference (short,
//        surplus, delivered and never loaded; an «unavailable» line, a simulation order, another day's
//        delivery left out); the deliveries unreadable; a second count; a load replaced meanwhile
//   [ج5] bad values: not a number, negative, three decimals; left + damaged above the loaded
//   [ج6] the tokens: another number, a second use, another day
//   [ج7] more than fifteen of a category, more than four pages, more than sixty items
//   [ج8] nothing is written in Odoo, and no price of any kind is read or sent
//   [ج9] the trial to Baraa, its hook, and the two purposes
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s55-car.test.mts

import { readFileSync } from "node:fs";
import { OWNER, WH, WH_PHONE, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table, workSchedule } from "./wa-harness.mts";
import { ALL_WEEK, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, deliveredAt, done, dp, fresh, market, rejected, setExtract } from "./s46-kit.mts";

const CL = await import("../src/car-load.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s55-flows.mjs");

const NEXT = "2026-10-04", PREV = "2026-10-02";   // DAY = 2026-10-03, a Saturday
const LABEL = "السبت 3 أكتوبر 2026";
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const ms = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const count = (s: string) => [...s].length;
const BANANA = 5, BANANA_PACK = 51;

/**
 * The tenant's shape: Omar is the driver, the buyer and the collector; أحمد (#601) is a buyer only.
 * Five active items: موز (فواكه), طماطم / خيار / بطاطس (خضار), بصل (no category → «أخرى»). Every item
 * has a purchase price, a market price and a published sale price — none of which this part may show.
 */
function world(riyadh = `${DAY} 05:00`): any {
  const env = fresh(riyadh); setExtract(null);
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  seed("product.template", { id: BANANA, name: "موز", sale_ok: true, x_is_active_for_sale: true, categ_id: 5 });
  seed("x_product_packaging", { id: BANANA_PACK, x_name: "كرتون", x_product_tmpl_id: BANANA, x_is_default: true });
  for (const id of [1, 2, 3]) table("product.template").get(id)!.categ_id = 6;
  table("hr.employee").get(OMAR_EMP)!.x_utak_role_ids = [71, 72, 73];
  const d = seed("x_price_day", { x_date: DAY, x_state: "published", x_name: `أسعار اليوم ${DAY}`, x_utak_simulation: false, x_published_at: utc(`${DAY} 06:00`) });
  ([[1, 11], [2, 21], [3, 31], [4, 41], [BANANA, BANANA_PACK]] as Array<[number, number]>).forEach(([p, k], i) => {
    dp(p, k, 77.77); market(p, k, 88.88);
    seed("x_price_day_line", { x_day_id: d, x_sequence: i + 1, x_product_tmpl_id: p, x_packaging_id: k, x_cost_price: 77.77, x_market_price: 88.88, x_sale_price: 99.99, x_status: "auto", x_excluded: false, x_suggested_price: 95.55, x_utak_simulation: false });
  });
  openWindow(env, DRIVER_PHONE); openWindow(env, WH_PHONE);
  return env;
}
const omar = { partnerId: DRIVER, name: "عمر المجهلي", whatsapp: "+" + DRIVER_PHONE };
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const buttonsOf = (b: any): Array<[string, string]> => (b?.interactive?.action?.buttons ?? []).map((x: any) => [String(x?.reply?.id ?? ""), String(x?.reply?.title ?? "")]);
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map(bodyOf);
const record = (env: any, day = DAY, driver = DRIVER) => JSON.parse(env.MSG_DEDUP.store.get(CL.carLoadKey(day, driver)) ?? "null");
const start = (env: any, moment: "morning" | "evening", now?: number) => quiet(() => CL.startCarLoad(env, omar, moment, undefined, now));
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => CL.handleCarLoadReply(env, { from: "+" + from, messageId: `wamid.C${++wamid}`, flow: { token, values } }, undefined, now));
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (t: string) => ({ type: "text", text: { body: t } });
const button = (id: string, title = "x") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
/** The morning form and its reply (slot → value). Slots: موز 1 · طماطم 16 · خيار 17 · بطاطس 18 · بصل 31. */
async function load(env: any, values: Record<string, unknown>): Promise<any> {
  await start(env, "morning");
  const f = flowsTo(DRIVER_PHONE).at(-1);
  return { f, r: await reply(env, DRIVER_PHONE, tokenOf(f), values) };
}
/** The evening form and its reply. */
async function countUp(env: any, values: Record<string, unknown>): Promise<any> {
  await start(env, "evening");
  const f = flowsTo(DRIVER_PHONE).at(-1);
  return { f, r: await reply(env, DRIVER_PHONE, tokenOf(f), values) };
}
/** The usual morning: موز 10, طماطم 20, بطاطس 5.5 — in the evening their slots are 1, 16 and 17. */
const usualLoad = (env: any) => load(env, { a1: "10", a16: "20", a17: "", a18: "5.5", a31: "" });
/** The usual evening: طماطم 2 left and 1 damaged, بطاطس half a carton left: dispatched 10 · 17 · 5. */
const usualCount = (env: any) => countUp(env, { a1: "", b1: "", a16: "2", b16: "1", a17: "0.5", b17: "" });
const delivery = (riyadh: string, product: number, packaging: number, qty: number, extra: Record<string, unknown> = {}, lineExtra: Record<string, unknown> = {}) =>
  deliveredAt(utc(riyadh), qty, extra, { x_product_tmpl_id: product, x_packaging_id: packaging, x_unit_price: 66.66, ...lineExtra });
/** Every write the worker made in Odoo (the reads set aside). */
const odooWrites = () => odooLog.filter((c: any) => !/^(search_read|search|search_count|read|fields_get)$/.test(c.method));
/** The gateway's own record of a send (§ 36): its x_wa_message row, and the number's conversation in Discuss (the channel, its member, its line, its link on the partner). */
const gatewayRecord = (c: any): boolean => (c.model === "x_wa_message" && c.method === "create") || /^discuss\.channel(\.member)?$/.test(c.model)
  || (c.model === "res.partner" && c.method === "write" && Object.keys(c.body?.vals ?? {}).join() === "x_wa_channel_id");

// ================================================================ ج1
console.log("\n[ج1] utak_carload_v1 at Meta is the form the worker fills: four pages of fifteen slots, two number fields a slot, no endpoint");
{
  const json = LIB.buildCarloadFlowJson();
  const ids = json.screens.map((s: any) => s.id);
  const first = json.screens[0];
  const inputsOf = (s: any) => s.layout.children.filter((c: any) => c.type === "TextInput");
  assert("four pages LOAD_A … LOAD_D, the first the one the worker opens; Flow JSON 6.0; forward routes only; every page terminal",
    JSON.stringify(ids) === JSON.stringify(["LOAD_A", "LOAD_B", "LOAD_C", "LOAD_D"]) && LIB.CARLOAD_FIRST_SCREEN === CL.CARLOAD_FLOW_SCREEN && json.version === "6.0"
    && JSON.stringify(json.routing_model) === JSON.stringify({ LOAD_A: ["LOAD_B"], LOAD_B: ["LOAD_C"], LOAD_C: ["LOAD_D"], LOAD_D: [] }) && json.screens.every((s: any) => s.terminal && s.success));
  assert("the worker's constants are the Flow's: its pages, its slots, its name in the Meta script's list", CL.CARLOAD_FLOW_PAGES === LIB.CARLOAD_PAGES.length && CL.CARLOAD_FLOW_PAGE_SLOTS === LIB.CARLOAD_PAGE_SLOTS && CL.CARLOAD_FLOW_SLOTS === LIB.CARLOAD_SLOTS && LIB.CARLOAD_SLOTS === 60
    && LIB.CARLOAD_FLOW_NAME === "utak_carload_v1" && LIB.FLOWS.some((f: any) => f.key === "carload" && f.name === "utak_carload_v1" && f.build === LIB.buildCarloadFlowJson && f.first === "LOAD_A"));
  assert("no endpoint and no Form wrapper: no data_api_version, no data_exchange, no «Form» component", !("data_api_version" in json) && !JSON.stringify(json).includes("data_exchange") && json.screens.every((s: any) => LIB.screenComponents(s).every((c: any) => c.type !== "Form")));
  assert("every page within Meta's fifty components (15 × 2 + the heading + the line + the footers: 35, and 33 on the last)", json.screens.every((s: any) => LIB.screenComponents(s).length <= LIB.SCREEN_COMPONENTS_MAX) && LIB.screenComponents(first).length === 35 && LIB.screenComponents(json.screens[3]).length === 33,
    JSON.stringify(json.screens.map((s: any) => LIB.screenComponents(s).length)));
  assert("thirty number fields a page — a<n> then b<n> of each slot, both optional", json.screens.every((s: any, k: number) => inputsOf(s).length === 30
    && inputsOf(s).every((c: any, j: number) => c.name === `${j % 2 ? "b" : "a"}${k * 15 + Math.floor(j / 2) + 1}` && c["input-type"] === "number" && c.required === false)));
  const [a, b] = LIB.carloadSlot(1, 1), [a2, b2] = LIB.carloadSlot(2, 16);
  assert("a<n>: its label, its hint, whether it shows and what it opens with all come from the data", a.label === "${data.l1}" && a["helper-text"] === "${data.h1}" && a.visible === "${data.v1}" && a["init-value"] === "${data.i1}");
  assert("b<n>: its own label, shown by its OWN key (the evening alone), and what it opens with", b.label === "${data.g1}" && b.visible === "${data.w1}" && b["init-value"] === "${data.j1}" && !("helper-text" in b));
  assert("…on a later page they read the first page's data", a2.label === "${screen.LOAD_A.data.l16}" && b2.visible === "${screen.LOAD_A.data.w16}" && a2.name === "a16" && b2.name === "b16");
  assert("each page: its heading, then the one line of text, both from the data", json.screens.every((s: any, k: number) => { const c = s.layout.children; const r = (key: string) => (k === 0 ? `\${data.${key}}` : `\${screen.LOAD_A.data.${key}}`);
    return c[0].type === "TextHeading" && c[0].text === r(`t${k + 1}`) && c[1].type === "TextBody" && c[1].text === r("note"); }));
  const foot = (k: number) => json.screens[k].layout.children.at(-1);
  assert("pages 1–3 end with «التالي» while a page follows, else «إرسال» — a footer in BOTH branches; the last with «إرسال» alone",
    [0, 1, 2].every((k) => foot(k).type === "If" && foot(k).condition === (k === 0 ? "${data.m1}" : `\${screen.LOAD_A.data.m${k + 1}}`) && foot(k).then.length === 1 && foot(k).then[0].type === "Footer" && foot(k).then[0].label === "التالي"
      && foot(k).then[0]["on-click-action"].next.name === ids[k + 1] && foot(k).else.length === 1 && foot(k).else[0].type === "Footer" && foot(k).else[0].label === "إرسال" && foot(k).else[0]["on-click-action"].name === "complete")
    && foot(3).type === "Footer" && foot(3).label === "إرسال");
  const sent = (k: number) => (k === 3 ? foot(3) : foot(k).else[0])["on-click-action"].payload;
  assert("«إرسال» on page k completes with a<n> and b<n> of every page up to it", [0, 1, 2, 3].every((k) => Object.keys(sent(k)).length === (k + 1) * 30) && sent(0).a7 === "${form.a7}" && sent(0).b7 === "${form.b7}" && sent(2).b7 === "${screen.LOAD_A.form.b7}" && sent(3).a60 === "${form.a60}");
  assert("the first page declares 428 keys: note, t1–t4, m1–m3, and l / h / g / v / w / i / j of sixty slots", Object.keys(first.data).length === 428 && ["note", "t4", "m3", "l60", "h60", "g60", "v60", "w60", "i60", "j60"].every((k) => k in first.data) && !("m4" in first.data));
  assert("no example is null, and no text example is empty (an initial value alone may be)", Object.entries(first.data).every(([k, v]: [string, any]) => v.__example__ !== null && v.__example__ !== undefined && (/^[ij]\d+$/.test(k) || v.__example__ !== "")));

  for (const moment of ["morning", "evening"] as const) {
    const env = world();
    if (moment === "evening") { await usualLoad(env); setRiyadh(`${DAY} 13:00`); }
    await start(env, moment);
    const f = flowsTo(DRIVER_PHONE).at(-1), d = dataOf(f), model = first.data;
    assert(`${moment}: every key the worker sends is declared on the first page, and every declared key is sent (428), each of its declared type`,
      JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(model).sort()) && Object.keys(d).length === 428 && Object.entries(d).every(([k, v]) => typeof v === (model[k].type === "boolean" ? "boolean" : "string")), String(Object.keys(d).length));
    assert(`${moment}: nothing sent is null, and no text is empty — an unused slot's are «-»`, Object.entries(d).every(([k, v]) => v !== null && v !== undefined && (/^[ij]\d+$/.test(k) || v !== "")) && d.l60 === "-" && d.h60 === "-" && d.g60 === "-" && d.t4 === "-" && d.v60 === false && d.w60 === false);
    assert(`${moment}: the labels within twenty characters, the hints within eighty, the headings within eighty`, Array.from({ length: 60 }, (_, i) => i + 1).every((n) => count(String(d[`l${n}`])) <= 20 && count(String(d[`g${n}`])) <= 20 && count(String(d[`h${n}`])) <= 80)
      && [1, 2, 3, 4].every((k) => count(String(d[`t${k}`])) <= 80) && count(String(d.note)) <= 4096);
    assert(`${moment}: the message opens utak_carload_v1 on its first page with the data (navigate), under its own button`, par(f).flow_id === CL.CARLOAD_FLOW_ID && par(f).flow_action === "navigate" && par(f).flow_action_payload.screen === "LOAD_A" && par(f).flow_message_version === "3"
      && par(f).flow_cta === (moment === "morning" ? "سجّل الحمولة" : "سجّل الباقي والتالف") && count(par(f).flow_cta) <= 20 && bodyOf(f).length <= 1024, par(f).flow_cta);
  }
  assert("the buttons' titles are within Meta's twenty characters", [CL.CARLOAD_BUTTON_MORNING_TITLE, CL.CARLOAD_BUTTON_EVENING_TITLE, CL.CARLOAD_CTA_MORNING, CL.CARLOAD_CTA_EVENING].every((t) => count(t) <= 20));
  assert("a long name is cut to the label's twenty characters, and «تالف: …» too", count(CL.carLoadSlotTexts("evening", "طماطم بلدي درجة أولى ممتازة جداً", "كرتون", 3).label) === 20 && count(CL.carLoadSlotTexts("evening", "طماطم بلدي درجة أولى ممتازة جداً", "كرتون", 3).label2) === 20
    && CL.carLoadSlotTexts("evening", "طماطم بلدي درجة أولى ممتازة جداً", "كرتون", 3).label2.startsWith("تالف: طماطم"));
}

// ================================================================ ج2
console.log("\n[ج2] the triggers: «حمولة» / «نهاية الحمولة» and the two buttons, from a driver alone");
{
  assert("«حمولة» and «حمولة السيارة» → the morning; «نهاية الحمولة» and «الباقي» → the evening", CL.carLoadCommand("حمولة") === "morning" && CL.carLoadCommand("حمولة السيارة") === "morning" && CL.carLoadCommand("نهاية الحمولة") === "evening" && CL.carLoadCommand("الباقي") === "evening");
  assert("as a phone types them: «حموله», « حمولة السياره. », «نهايه  الحموله», «الباقى»", CL.carLoadCommand("حموله") === "morning" && CL.carLoadCommand(" حمولة السياره. ") === "morning" && CL.carLoadCommand("نهايه  الحموله") === "evening" && CL.carLoadCommand("الباقى") === "evening");
  assert("the WHOLE message: a sentence that holds the word is not the command", [
    "حمولة اليوم كم؟", "وين الحمولة", "الباقي 5", "الباقي من الفاتورة", "نهاية الحمولة بكرة", "حمولة السيارة جاهزة", "تسليم 12", "450", "", "حمولتي", "باقي",
  ].every((t) => CL.carLoadCommand(t) === null));
  assert("the buttons: cload_m → the morning, cload_e → the evening, nothing else", CL.carLoadButtonMoment("cload_m") === "morning" && CL.carLoadButtonMoment("cload_e") === "evening" && CL.carLoadButtonMoment("cload_x") === null && CL.carLoadButtonMoment("") === null
    && JSON.stringify(CL.carLoadEveningButton()) === JSON.stringify({ id: "cload_e", title: "نهاية الحمولة" }) && JSON.stringify(CL.carLoadMorningButton()) === JSON.stringify({ id: "cload_m", title: "حمولة السيارة" }));
}
{
  const env = world();
  const r = await say(env, DRIVER_PHONE, text("حمولة"));
  const f = flowsTo(DRIVER_PHONE);
  assert("«حمولة» from Omar (a driver) through the webhook → ONE message: the morning form", r.status === 200 && sentTo(DRIVER_PHONE).length === 1 && f.length === 1 && String(dataOf(f[0]).t1).startsWith("حمولة الصباح — "), JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf)));
  assert("…its text: «🚚 حمولة السيارة — السبت 3 أكتوبر 2026» and what to do", bodyOf(f[0]) === `🚚 حمولة السيارة — ${LABEL}\nاضغط «سجّل الحمولة» واكتب الكمية المحمّلة جنب كل صنف، ثم «إرسال».`, bodyOf(f[0]));
  assert("…nothing went to Baraa, and nothing is held", sentTo(OWNER).length === 0 && heldFor(env, DRIVER_PHONE).length === 0);
  await say(env, DRIVER_PHONE, text("حمولة السيارة"));
  assert("«حمولة السيارة» → the morning form too", flowsTo(DRIVER_PHONE).length === 2);
  await say(env, DRIVER_PHONE, button("cload_m"));
  assert("the button cload_m → the morning form, and no «زر قديم» answer", flowsTo(DRIVER_PHONE).length === 3 && sentTo(DRIVER_PHONE).length === 3, JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf).slice(2)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a member without the driver role: the existing behaviour, word for word
  const env = world();
  await say(env, WH_PHONE, text("حمولة"));
  assert("«حمولة» from a buyer who is no driver: no form — the team's usual answer", flowsTo(WH_PHONE).length === 0 && sentTo(WH_PHONE).length === 1 && bodyOf(sentTo(WH_PHONE)[0]).includes("استخدم الأزرار عشان نأكد الحالة"), JSON.stringify(sentTo(WH_PHONE).map(bodyOf)));
  await say(env, WH_PHONE, text("نهاية الحمولة"));
  assert("«نهاية الحمولة» from him: no form either", flowsTo(WH_PHONE).length === 0 && sentTo(WH_PHONE).length === 2);
  await say(env, WH_PHONE, button("cload_m"));
  await say(env, WH_PHONE, button("cload_e"));
  assert("the buttons from him: no form — the answer of a button the worker does not know", flowsTo(WH_PHONE).length === 0 && sentTo(WH_PHONE).slice(-2).every((b: any) => bodyOf(b).startsWith("هذا الزر من رسالة قديمة")), JSON.stringify(sentTo(WH_PHONE).map(bodyOf).slice(-2)));
  openWindow(env, C1_PHONE);
  await say(env, C1_PHONE, button("cload_m"));
  assert("the button from a customer's number: no form", flowsTo(C1_PHONE).length === 0 && sentTo(C1_PHONE).every((b: any) => b?.interactive?.type !== "flow"));
  assert("carLoadText is false for a member without the role, and for any other text of a driver", (await quiet(() => CL.carLoadText(env, { id: WH, name: "أحمد", x_whatsapp_number: "+" + WH_PHONE, x_role: "warehouse", x_role_codes: ["warehouse"] }, "حمولة", WH_PHONE))) === false
    && (await quiet(() => CL.carLoadText(env, { id: DRIVER, name: "عمر", x_whatsapp_number: "+" + DRIVER_PHONE, x_role: "driver", x_role_codes: ["driver"] }, "مرحبا", DRIVER_PHONE))) === false && graph.every((b: any) => b.to !== DRIVER_PHONE));
  assert("the button for a driver's partner tapped from another number is not his", (await quiet(() => CL.handleCarLoadButton(env, "cload_m", { id: DRIVER, name: "عمر", x_whatsapp_number: "+" + WH_PHONE }))) === null
    && (await quiet(() => CL.handleCarLoadButton(env, "cload_m", null))) === null && flowsTo(DRIVER_PHONE).length === 0);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // where the text stands: after the collector's amount and a pending note, before the shift's hold
  const env = world();
  env.MSG_DEDUP.store.set(`cpay_amount:v1:${DRIVER}`, JSON.stringify({ invoiceId: 987654, method: "cash", nonce: "abcd", at: Date.now() }));
  await say(env, DRIVER_PHONE, text("الباقي"));
  assert("while the collector's amount is awaited («مبلغ آخر»), «الباقي» is read as that amount's answer — no form", flowsTo(DRIVER_PHONE).length === 0 && sentTo(DRIVER_PHONE).length === 1 && bodyOf(sentTo(DRIVER_PHONE)[0]).includes("987654"), JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf)));
  env.MSG_DEDUP.store.set(`pending_issue:${DRIVER}`, "4242");
  await say(env, DRIVER_PHONE, text("الباقي"));
  assert("after «فيه مشكلة ⚠️» on a stop, «الباقي» is the note he owes — recorded for Baraa, no form", flowsTo(DRIVER_PHONE).length === 0 && bodyOf(sentTo(DRIVER_PHONE).at(-1)) === "تم تسجيل المشكلة، براء بيراجعها 🙏" && sentTo(OWNER).some((b: any) => bodyOf(b).includes("الباقي")), JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf)));
  await say(env, DRIVER_PHONE, text("الباقي"));
  assert("…and with nothing pending the same word is the evening's command (no load yet: the line and the morning form)", flowsTo(DRIVER_PHONE).length === 1 && bodyOf(flowsTo(DRIVER_PHONE)[0]).startsWith(CL.CARLOAD_NO_LOAD_TEXT));
  const src = srcOf("index.ts");
  const at = (s: string) => src.indexOf(s);
  assert("in the team's texts the command is tried after the supplier payment, the amount, «تسليم N» and the pending notes, and before the market reply and the shift's hold",
    [at("m.handlePayText") < 0 ? at("handlePayText(env, teamMember") : at("handlePayText(env, teamMember"), at("m.collectAmountReply(env"), at("deliverCommandOrderId(msg.text) !== null"), at("} else if (pendingCollectNote) {")].every((p) => p > 0 && p < at("m.carLoadText(env, teamMember"))
    && at("m.carLoadText(env, teamMember") < at("m.tryMarketReply(env") && at("m.carLoadText(env, teamMember") < at("} else if (att.hold) {"));
}
{
  // on attendance, after the end of his shift (02:00–12:00): the evening's command is still answered
  const env = world(`${DAY} 05:00`);
  Object.assign(table("hr.employee").get(OMAR_EMP)!, { x_utak_attendance: true, resource_calendar_id: workSchedule(ALL_WEEK, { name: "UTAK — عمر" }) });
  await usualLoad(env);
  setRiyadh(`${DAY} 13:00`); openWindow(env, DRIVER_PHONE);
  const before = flowsTo(DRIVER_PHONE).length;
  await say(env, DRIVER_PHONE, text("نهاية الحمولة"));
  const f = flowsTo(DRIVER_PHONE).at(-1);
  assert("an hour after his shift ended, «نهاية الحمولة» still brings the evening form (not «دوامك انتهى»)", flowsTo(DRIVER_PHONE).length === before + 1 && String(dataOf(f).t1).startsWith("آخر اليوم — "), JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf).slice(-1)));
  await say(env, DRIVER_PHONE, button("cload_e"));
  assert("the button cload_e brings it too", flowsTo(DRIVER_PHONE).length === before + 2 && String(dataOf(flowsTo(DRIVER_PHONE).at(-1)).t1).startsWith("آخر اليوم — "));
}
{
  // outside his window nothing goes and nothing is held
  const env = world();
  env.MSG_DEDUP.store.delete(`wa_win:v1:${DRIVER_PHONE}`);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: DRIVER, x_processed_at: utc(`${PREV} 01:00`), x_status: "received" });
  const r = await start(env, "morning");
  assert("his 24h window closed: no form, no template, nothing held, no token kept", r.sent === false && r.reason === "window_closed" && sentTo(DRIVER_PHONE).length === 0 && heldFor(env, DRIVER_PHONE).length === 0
    && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("cload_t:")), JSON.stringify(r));
}

// ================================================================ ج3
console.log("\n[ج3] the morning: a field for every active item, by category; the load is kept, and replaced by a second one");
{
  const env = world();
  const puts: Array<[string, any]> = [];
  const put = env.MSG_DEDUP.put.bind(env.MSG_DEDUP);
  env.MSG_DEDUP.put = async (k: string, v: string, o?: any) => { puts.push([k, o]); return put(k, v); };
  await start(env, "morning");
  const f = flowsTo(DRIVER_PHONE)[0], d = dataOf(f);
  assert("three pages by category — «حمولة الصباح — فواكه», «— خضار», «— أخرى» — and «التالي» after the first two only", d.t1 === "حمولة الصباح — فواكه" && d.t2 === "حمولة الصباح — خضار" && d.t3 === "حمولة الصباح — أخرى" && d.t4 === "-" && d.m1 === true && d.m2 === true && d.m3 === false, JSON.stringify([d.t1, d.t2, d.t3, d.t4, d.m1, d.m2, d.m3]));
  assert("the five active items on their pages: موز (1) · طماطم, خيار, بطاطس (16–18) · بصل (31); every other slot hidden", JSON.stringify([1, 16, 17, 18, 31].map((n) => d[`l${n}`])) === JSON.stringify(["موز", "طماطم", "خيار", "بطاطس", "بصل"])
    && Array.from({ length: 60 }, (_, i) => i + 1).every((n) => d[`v${n}`] === [1, 16, 17, 18, 31].includes(n)), JSON.stringify([1, 16, 17, 18, 31].map((n) => d[`l${n}`])));
  assert("the hint is the packaging and what to write: «كرتون · الكمية المحمّلة», «جرم · الكمية المحمّلة»", d.h1 === "كرتون · الكمية المحمّلة" && d.h17 === "جرم · الكمية المحمّلة" && d.h31 === "جرم · الكمية المحمّلة", `${d.h1} | ${d.h17}`);
  assert("the line under the heading says an empty field is zero", d.note === "اكتب الكمية المحمّلة جنب كل صنف. الخانة الفاضية = صفر." && d.note === CL.CARLOAD_MORNING_NOTE);
  assert("the second field — «التالف» — is hidden on every slot in the morning, and nothing is written for him", Array.from({ length: 60 }, (_, i) => i + 1).every((n) => d[`w${n}`] === false && d[`i${n}`] === "" && d[`j${n}`] === ""));

  // ---- his reply
  graph.length = 0;
  const env3 = env;
  const r = await reply(env3, DRIVER_PHONE, tokenOf(f), { a1: "10", a16: "٢٠", a17: "", a18: "5,5", a31: "0" });
  const rec = record(env3);
  assert("«إرسال»: the load is kept — موز 10, طماطم 20, بطاطس 5.5 — and the empty field and the «0» are not in it", r.action === "loaded" && r.items === 3
    && JSON.stringify(rec.items.map((i: any) => [i.key, i.name, i.loaded, i.page])) === JSON.stringify([["5:51", "موز كرتون", 10, "فواكه"], ["1:11", "طماطم كرتون", 20, "خضار"], ["3:31", "بطاطس كرتون", 5.5, "خضار"]]), JSON.stringify(rec?.items));
  assert("…per Riyadh day and driver, with when it was sent; no count yet", rec.v === 1 && rec.day === DAY && rec.driverId === DRIVER && rec.driver === "عمر المجهلي" && rec.loadedAt === ms(`${DAY} 05:00`) && rec.count === undefined && rec.countedAt === undefined && CL.carLoadKey(DAY, DRIVER) === `cload:v1:${DAY}:${DRIVER}`);
  assert("…kept four days in KV", CL.CARLOAD_KEEP_SEC === 4 * 24 * 3600 && puts.some(([k, o]) => k === CL.carLoadKey(DAY, DRIVER) && o?.expirationTtl === 345600), JSON.stringify(puts.filter(([k]) => k.startsWith("cload:"))));
  const toHim = sentTo(DRIVER_PHONE);
  assert("to him: what he loaded, with «نهاية الحمولة» (cload_e) under it", toHim.length === 1 && bodyOf(toHim[0]) === [
    `✅ سُجّلت حمولة السيارة — ${LABEL}:`, "• موز كرتون × 10", "• طماطم كرتون × 20", "• بطاطس كرتون × 5.5", "المجموع: 35.5 · عدد الأصناف: 3", "آخر اليوم اضغط «نهاية الحمولة» واكتب الباقي والتالف.",
  ].join("\n") && JSON.stringify(buttonsOf(toHim[0])) === JSON.stringify([["cload_e", "نهاية الحمولة"]]), bodyOf(toHim[0]));
  assert("to Baraa: ONE line with the total loaded", sentTo(OWNER).length === 1 && bodyOf(sentTo(OWNER)[0]) === `🚚 حمولة السيارة — عمر المجهلي — ${LABEL}: المحمّل 35.5 · عدد الأصناف 3 · الساعة 05:00`, bodyOf(sentTo(OWNER)[0]));
  assert("…and to nobody else", graph.every((b: any) => b.to === DRIVER_PHONE || b.to === OWNER));

  // ---- the form again the same day: it opens with the load, and replaces it
  setRiyadh(`${DAY} 05:40`); graph.length = 0;
  await start(env3, "morning");
  const f2 = flowsTo(DRIVER_PHONE)[0], dd = dataOf(f2);
  assert("«حمولة» again: the form opens with the load on record (10 · 20 · 5.5), and says that sending it replaces it", dd.i1 === "10" && dd.i16 === "20" && dd.i18 === "5.5" && dd.i17 === "" && dd.i31 === ""
    && bodyOf(f2).split("\n")[2] === "حمولة اليوم المسجّلة (05:00) مكتوبة في الخانات: عدّلها ثم «إرسال»، وإرسالك يستبدلها.", bodyOf(f2));
  const r2 = await reply(env3, DRIVER_PHONE, tokenOf(f2), { a1: "10", a16: "25", a17: "4", a18: "", a31: "" });
  const rec2 = record(env3);
  assert("its reply REPLACES the load: طماطم 25, خيار 4 new, بطاطس gone", r2.action === "loaded" && JSON.stringify(rec2.items.map((i: any) => [i.name, i.loaded])) === JSON.stringify([["موز كرتون", 10], ["طماطم كرتون", 25], ["خيار جرم", 4]]) && rec2.loadedAt === ms(`${DAY} 05:40`), JSON.stringify(rec2.items));
  assert("…he is told it replaced the load of 05:00, and so is Baraa", bodyOf(sentTo(DRIVER_PHONE).at(-1)).includes("🔁 استبدلت الحمولة المسجّلة الساعة 05:00.") && bodyOf(sentTo(OWNER).at(-1)) === `🚚 حمولة السيارة — عمر المجهلي — ${LABEL}: المحمّل 39 · عدد الأصناف 3 · الساعة 05:40 (استبدلت حمولة الساعة 05:00)`, bodyOf(sentTo(OWNER).at(-1)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // an item that is not active, or not for sale, has no field
  const env = world();
  Object.assign(table("product.template").get(2)!, { x_is_active_for_sale: false });
  Object.assign(table("product.template").get(3)!, { sale_ok: false });
  seed("product.template", { id: 9, name: "مؤرشف", sale_ok: true, x_is_active_for_sale: true, active: false, categ_id: 6 });
  seed("x_product_packaging", { id: 91, x_name: "كرتون", x_product_tmpl_id: 9, x_is_default: true });
  await start(env, "morning");
  const d = dataOf(flowsTo(DRIVER_PHONE)[0]);
  assert("an item that is not active for sale, not for sale, or archived has no field", JSON.stringify(Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => d[`v${n}`]).map((n) => d[`l${n}`])) === JSON.stringify(["موز", "طماطم", "بصل"]), JSON.stringify(Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => d[`v${n}`]).map((n) => d[`l${n}`])));
}
{
  // an empty form keeps nothing, and its token stays usable
  const env = world();
  await start(env, "morning");
  const f = flowsTo(DRIVER_PHONE)[0];
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { a1: "", a16: "0", a17: " " });
  assert("a form with no quantity: nothing kept, one line, and nothing to Baraa", r.action === "empty" && record(env) === null && bodyOf(sentTo(DRIVER_PHONE).at(-1)) === CL.CARLOAD_EMPTY_TEXT && sentTo(OWNER).length === 0);
  const r2 = await reply(env, DRIVER_PHONE, tokenOf(f), { a1: "3" });
  assert("…the same form filled then is read", r2.action === "loaded" && record(env).items.length === 1);
  // no active item at all
  const env2 = world();
  for (const p of rows("product.template") as any[]) p.x_is_active_for_sale = false;
  const none = await start(env2, "morning");
  assert("no active item: no form, one line saying so", none.sent === false && none.reason === "no_items" && flowsTo(DRIVER_PHONE).length === 0 && bodyOf(sentTo(DRIVER_PHONE)[0]) === CL.CARLOAD_NO_ITEMS_TEXT);
  // the categories cannot be read: one page, nothing lost
  const stock = [{ productId: 1, packagingId: 11, product: "طماطم", packaging: "كرتون", page: "الأصناف", loaded: 0 }, { productId: 2, packagingId: 21, product: "[X] خيار", packaging: "جرم", page: "الأصناف", loaded: 0 }];
  const one = CL.carLoadPages("morning", stock);
  assert("carLoadPages, pure: the key is «product:packaging», the name «طماطم كرتون», a code in brackets is dropped from the name", JSON.stringify(one.items.map((i: any) => [i.slot, i.key, i.name, i.label])) === JSON.stringify([[1, "1:11", "طماطم كرتون", "طماطم"], [2, "2:21", "خيار جرم", "خيار"]]) && JSON.stringify(one.pages) === JSON.stringify(["الأصناف"]));
}

// ================================================================ ج4
console.log("\n[ج4] the evening: what is left and what is damaged; dispatched = loaded − left − damaged, against the day's deliveries");
{
  // no load on record
  const env = world(`${DAY} 13:00`);
  const r = await start(env, "evening");
  const f = flowsTo(DRIVER_PHONE)[0];
  assert("«نهاية الحمولة» with no load today: ONE message — the line saying so, above the MORNING form", r.sent === true && sentTo(DRIVER_PHONE).length === 1 && bodyOf(f).split("\n")[0] === "ما فيه حمولة مسجّلة اليوم. سجّل حمولة الصباح أولاً 👇" && dataOf(f).t1 === "حمولة الصباح — فواكه" && par(f).flow_cta === "سجّل الحمولة", bodyOf(f));
  // yesterday's load is not today's
  const env2 = world(`${PREV} 05:00`);
  await usualLoad(env2);
  setRiyadh(`${DAY} 13:00`); openWindow(env2, DRIVER_PHONE); graph.length = 0;
  await start(env2, "evening");
  assert("a load of yesterday is not today's: the same line and the morning form", bodyOf(flowsTo(DRIVER_PHONE)[0]).startsWith(CL.CARLOAD_NO_LOAD_TEXT) && record(env2, PREV) !== null && record(env2, DAY) === null);
}
{
  // ---- matching deliveries
  const env = world();
  await usualLoad(env);
  delivery(`${DAY} 08:10`, BANANA, BANANA_PACK, 10);
  delivery(`${DAY} 08:40`, 1, 11, 10);
  delivery(`${DAY} 10:05`, 1, 11, 7, { x_state: "closed" });
  delivery(`${DAY} 11:00`, 3, 31, 5);
  setRiyadh(`${DAY} 13:00`); graph.length = 0;
  await start(env, "evening");
  const f = flowsTo(DRIVER_PHONE)[0], d = dataOf(f);
  assert("the evening form holds the items LOADED this morning, by category: موز (1) · طماطم, بطاطس (16, 17) — not خيار, not بصل", d.t1 === "آخر اليوم — فواكه" && d.t2 === "آخر اليوم — خضار" && d.t3 === "-" && d.m1 === true && d.m2 === false
    && JSON.stringify(Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => d[`v${n}`]).map((n) => [n, d[`l${n}`]])) === JSON.stringify([[1, "موز"], [16, "طماطم"], [17, "بطاطس"]]), JSON.stringify([d.t1, d.t2, d.l1, d.l16, d.l17]));
  assert("its first field is «الباقي», naming what was loaded: «الباقي في السيارة · المحمّل 20 كرتون»", d.h1 === "الباقي في السيارة · المحمّل 10 كرتون" && d.h16 === "الباقي في السيارة · المحمّل 20 كرتون" && d.h17 === "الباقي في السيارة · المحمّل 5.5 كرتون", `${d.h16} | ${d.h17}`);
  assert("its second field is shown on those slots alone: «تالف: طماطم»", d.g16 === "تالف: طماطم" && d.g1 === "تالف: موز" && Array.from({ length: 60 }, (_, i) => i + 1).every((n) => d[`w${n}`] === [1, 16, 17].includes(n)));
  assert("the line under the heading, and the message's text", d.note === "لكل صنف: الباقي في السيارة، وتحته التالف. الخانة الفاضية = صفر." && bodyOf(f) === `🚚 نهاية الحمولة — ${LABEL}\nاضغط «سجّل الباقي والتالف» واكتب لكل صنف الباقي في السيارة والتالف، ثم «إرسال».`, bodyOf(f));
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { a1: "", b1: "", a16: "2", b16: "1", a17: "0.5", b17: "" });
  const rec = record(env);
  assert("«إرسال»: the count is kept beside the load — left and damaged of each item, and when", r.action === "counted" && r.items === 3 && r.differences === 0 && rec.countedAt === ms(`${DAY} 13:00`) && rec.loadedAt === ms(`${DAY} 05:00`)
    && JSON.stringify(rec.count) === JSON.stringify([{ key: "5:51", left: 0, damaged: 0 }, { key: "1:11", left: 2, damaged: 1 }, { key: "3:31", left: 0.5, damaged: 0 }]), JSON.stringify(rec.count));
  assert("to him: every item — loaded, left, damaged, dispatched — and the totals", JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([[
    `✅ سُجّل الباقي والتالف — ${LABEL}:`,
    "• موز كرتون: المحمّل 10 · الباقي 0 · التالف 0 · المنصرف 10",
    "• طماطم كرتون: المحمّل 20 · الباقي 2 · التالف 1 · المنصرف 17",
    "• بطاطس كرتون: المحمّل 5.5 · الباقي 0.5 · التالف 0 · المنصرف 5",
    "المجموع: المحمّل 35.5 · الباقي 2.5 · التالف 1 · المنصرف 32",
    "وصل الملخص لبراء ✅",
  ].join("\n")]), textsTo(DRIVER_PHONE).join("\n---\n"));
  assert("to Baraa, when what left the car is what was delivered: «✅ مطابقة للتسليمات» with the totals, then the damaged items", JSON.stringify(textsTo(OWNER)) === JSON.stringify([[
    `🚚 حمولة السيارة — عمر المجهلي — ${LABEL}`,
    "✅ مطابقة للتسليمات",
    "المجموع: المحمّل 35.5 · المسلَّم 32 · الباقي 2.5 · التالف 1",
    "التالف: طماطم كرتون 1",
  ].join("\n")]), textsTo(OWNER).join("\n---\n"));
  assert("the driver is shown no comparison with the deliveries", !textsTo(DRIVER_PHONE).join("\n").includes("المسلَّم") && !textsTo(DRIVER_PHONE).join("\n").includes("الفرق"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // ---- every kind of difference
  const env = world();
  await usualLoad(env);
  delivery(`${DAY} 08:10`, BANANA, BANANA_PACK, 8);                                  // short: 10 left the car, 8 delivered
  delivery(`${DAY} 08:40`, 1, 11, 12);
  delivery(`${DAY} 10:05`, 1, 11, 7);                                                // surplus: 17 left the car, 19 delivered
  delivery(`${DAY} 11:00`, 3, 31, 5);                                                // as dispatched
  delivery(`${DAY} 11:30`, 4, 41, 3);                                                // delivered and never loaded
  delivery(`${DAY} 09:00`, BANANA, BANANA_PACK, 4, {}, { x_status: "unavailable" });   // a line that was not delivered
  delivery(`${DAY} 09:10`, BANANA, BANANA_PACK, 6, { x_utak_simulation: true });       // a simulation order
  delivery(`${DAY} 09:20`, BANANA, BANANA_PACK, 9, {}, { x_utak_simulation: true });   // a simulation line
  delivery(`${PREV} 23:30`, BANANA, BANANA_PACK, 5);                                 // yesterday night (Riyadh) — the same UTC day as this morning
  delivery(`${NEXT} 00:10`, BANANA, BANANA_PACK, 2);                                 // after midnight
  delivery(`${DAY} 12:00`, BANANA, BANANA_PACK, 11, { x_state: "in_delivery" });       // not delivered yet
  delivery(`${DAY} 12:10`, BANANA, BANANA_PACK, 13, { x_state: "cancelled" });
  setRiyadh(`${DAY} 13:00`); graph.length = 0;
  const { r } = await usualCount(env);
  assert("three items differ", r.action === "counted" && r.differences === 3, JSON.stringify(r));
  assert("to Baraa: a line for every item that differs — loaded, left, damaged, dispatched, delivered, the difference with its sign — then the totals and the damaged", JSON.stringify(textsTo(OWNER)) === JSON.stringify([[
    `🚚 حمولة السيارة — عمر المجهلي — ${LABEL}`,
    "⚠️ فرق في 3 من الأصناف (الفرق = المنصرف − المسلَّم):",
    "• موز كرتون: المحمّل 10 · الباقي 0 · التالف 0 · المنصرف 10 · المسلَّم 8 · الفرق +2",
    "• طماطم كرتون: المحمّل 20 · الباقي 2 · التالف 1 · المنصرف 17 · المسلَّم 19 · الفرق −2",
    "• بصل جرم: لم يُحمَّل · المسلَّم 3 · الفرق −3",
    "المجموع: المحمّل 35.5 · المسلَّم 35 · الباقي 2.5 · التالف 1",
    "التالف: طماطم كرتون 1",
  ].join("\n")]), textsTo(OWNER).join("\n---\n"));
  const got = await quiet(() => CL.deliveredOn(env, DAY));
  assert("the day's deliveries, by product and packaging: موز 8 · طماطم 19 · بطاطس 5 · بصل 3 — the «unavailable» line, the simulation order and line, another day's and an order not delivered left out",
    JSON.stringify([...got].sort()) === JSON.stringify([["1:11", { name: "طماطم كرتون", qty: 19 }], ["3:31", { name: "بطاطس كرتون", qty: 5 }], ["4:41", { name: "بصل جرم", qty: 3 }], ["5:51", { name: "موز كرتون", qty: 8 }]]), JSON.stringify([...got]));
  assert("a Riyadh day runs from 21:00 UTC of the day before: 00:30 and 23:50 Riyadh are in it, 23:30 the night before and 00:10 after are not", await (async () => {
    delivery(`${DAY} 00:30`, 2, 21, 1); delivery(`${DAY} 23:50`, 2, 21, 2);
    return (await quiet(() => CL.deliveredOn(env, DAY))).get("2:21")?.qty === 3 && (await quiet(() => CL.deliveredOn(env, PREV))).get("5:51")?.qty === 5 && (await quiet(() => CL.deliveredOn(env, NEXT))).get("5:51")?.qty === 2;
  })());
  assert("the minus is U+2212, the plus is written, zero has no sign", CL.signedQty(2) === "+2" && CL.signedQty(-3) === "−3" && CL.signedQty(-3).charCodeAt(0) === 0x2212 && CL.signedQty(0) === "0" && CL.signedQty(-0.5) === "−0.5" && CL.signedQty(1.256) === "+1.26" && CL.signedQty(-0.001) === "0");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // the count, pure
  const rec: any = { v: 1, day: DAY, driverId: DRIVER, driver: "عمر", loadedAt: 1, items: [
    { key: "1:11", productId: 1, packagingId: 11, name: "طماطم كرتون", product: "طماطم", packaging: "كرتون", page: "خضار", loaded: 20 },
    { key: "2:21", productId: 2, packagingId: 21, name: "خيار جرم", product: "خيار", packaging: "جرم", page: "خضار", loaded: 6 },
  ], countedAt: 2, count: [{ key: "1:11", left: 2, damaged: 1 }, { key: "2:21", left: 0, damaged: 0.25 }] };
  const del = new Map([["1:11", { name: "طماطم كرتون", qty: 17 }], ["2:21", { name: "خيار جرم", qty: 5.5 }], ["9:91", { name: "ليمون كيس", qty: 1 }]]);
  const out = CL.carLoadRows(rec, del);
  assert("dispatched = loaded − left − damaged (17, 5.75); the difference = dispatched − delivered (0, +0.25); delivered and never loaded: −1",
    JSON.stringify(out.map((x: any) => [x.name, x.dispatched, x.delivered, x.diff])) === JSON.stringify([["طماطم كرتون", 17, 17, 0], ["خيار جرم", 5.75, 5.5, 0.25], ["ليمون كيس", 0, 1, -1]]), JSON.stringify(out));
  assert("no count yet: nothing is left and nothing damaged — everything loaded is dispatched", CL.carLoadRows({ ...rec, count: undefined }, new Map()).every((x: any) => x.left === 0 && x.damaged === 0 && x.dispatched === x.loaded && x.diff === x.loaded));
  const t = CL.ownerCountText(rec, del).join("\n").split("\n");
  assert("Baraa's lines of it: the item that matches is not listed; a fraction keeps its decimals («+0.25»)", t.length === 6 && t[1] === "⚠️ فرق في 2 من الأصناف (الفرق = المنصرف − المسلَّم):" && t[2] === "• خيار جرم: المحمّل 6 · الباقي 0 · التالف 0.25 · المنصرف 5.75 · المسلَّم 5.5 · الفرق +0.25"
    && t[3] === "• ليمون كيس: لم يُحمَّل · المسلَّم 1 · الفرق −1" && t[4] === "المجموع: المحمّل 26 · المسلَّم 23.5 · الباقي 2 · التالف 1.25" && t[5] === "التالف: طماطم كرتون 1، خيار جرم 0.25", t.join("\n"));
  const clean = CL.ownerCountText({ ...rec, count: [{ key: "1:11", left: 3, damaged: 0 }, { key: "2:21", left: 0.5, damaged: 0 }] }, new Map([["1:11", { name: "طماطم كرتون", qty: 17 }], ["2:21", { name: "خيار جرم", qty: 5.5 }]])).join("\n").split("\n");
  assert("nothing damaged: no «التالف:» line under «✅ مطابقة للتسليمات»", clean.length === 3 && clean[1] === "✅ مطابقة للتسليمات" && clean[2] === "المجموع: المحمّل 26 · المسلَّم 22.5 · الباقي 3.5 · التالف 0", clean.join("\n"));
  // a long day: Baraa's message is cut between lines, never inside one
  const many: any = { ...rec, items: Array.from({ length: 60 }, (_, i) => ({ key: `${i + 100}:1`, productId: i + 100, packagingId: 1, name: `صنف طويل الاسم رقم ${i + 100} كرتون`, product: "x", packaging: "كرتون", page: "خضار", loaded: 10 })), count: [] };
  const parts = CL.ownerCountText(many, new Map());
  assert("sixty items that all differ: more than one message, each within a text message's room, every item once", parts.length > 1 && parts.every((p: string) => p.length <= 3500) && many.items.every((i: any) => parts.join("\n").split(`• ${i.name}:`).length === 2), JSON.stringify(parts.map((p: string) => p.length)));
  assert("textParts cuts between lines and loses none", CL.textParts(["a", "bb", "ccc"], 5).join("|") === "a\nbb|ccc" && CL.textParts([], 5).length === 0);
}
{
  // the deliveries cannot be read: Baraa is still told
  const env = world();
  await usualLoad(env);
  setRiyadh(`${DAY} 13:00`); graph.length = 0;
  await start(env, "evening");
  const f = flowsTo(DRIVER_PHONE)[0];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/json/2/x_daily_order/")) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "boom" }), { status: 500 });
    return real(input as any, init);
  }) as typeof fetch;
  let r: any;
  try { r = await reply(env, DRIVER_PHONE, tokenOf(f), { a16: "2", b16: "1", a17: "0.5" }); } finally { globalThis.fetch = real; }
  assert("Odoo does not answer for the deliveries: the count is kept, he is answered, and Baraa is told it was not compared", r.action === "counted" && r.differences === null && record(env).count.length === 3 && textsTo(DRIVER_PHONE).length === 1
    && JSON.stringify(textsTo(OWNER)) === JSON.stringify([[`🚚 حمولة السيارة — عمر المجهلي — ${LABEL}`, "⚠️ تعذّرت قراءة تسليمات اليوم من Odoo، فلم تُقارن الحمولة بها.", "المجموع: المحمّل 35.5 · الباقي 2.5 · التالف 1 · المنصرف 32", "التالف: طماطم كرتون 1"].join("\n")]), textsTo(OWNER).join("\n---\n"));
}
{
  // a second count the same day is a correction; the load no longer changes
  const env = world();
  await usualLoad(env);
  delivery(`${DAY} 08:10`, BANANA, BANANA_PACK, 10); delivery(`${DAY} 08:40`, 1, 11, 17); delivery(`${DAY} 11:00`, 3, 31, 5);
  setRiyadh(`${DAY} 13:00`);
  await usualCount(env);
  setRiyadh(`${DAY} 13:30`); graph.length = 0;
  await start(env, "evening");
  const f = flowsTo(DRIVER_PHONE)[0], d = dataOf(f);
  assert("«نهاية الحمولة» again: the form opens with the count on record (طماطم 2 and 1, بطاطس 0.5), and says that sending it replaces it", d.i16 === "2" && d.j16 === "1" && d.i17 === "0.5" && d.j17 === "" && d.i1 === "" && bodyOf(f).split("\n")[2] === "الباقي والتالف المسجّلان (13:00) مكتوبان في الخانات: إرسالك يستبدلهما.", bodyOf(f));
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { a16: "3", b16: "1", a17: "0.5" });
  assert("its reply replaces the count (طماطم: 3 left), and tells him so", r.action === "counted" && record(env).count[1].left === 3 && record(env).countedAt === ms(`${DAY} 13:30`) && textsTo(DRIVER_PHONE)[0].includes("🔁 استبدل العدّ المسجّل الساعة 13:00."), textsTo(DRIVER_PHONE)[0]);
  assert("…and Baraa reads a correction: the count of 13:00 is replaced, طماطم now differs by −1", textsTo(OWNER).length === 1 && textsTo(OWNER)[0].split("\n")[1] === "🔁 تصحيح: هذا العدّ يستبدل عدّ الساعة 13:00."
    && textsTo(OWNER)[0].includes("• طماطم كرتون: المحمّل 20 · الباقي 3 · التالف 1 · المنصرف 16 · المسلَّم 17 · الفرق −1"), textsTo(OWNER)[0]);
  // after the count the morning's load is closed
  graph.length = 0;
  const again = await start(env, "morning");
  assert("«حمولة» after the evening count: no form — one line, the load no longer changes", again.sent === false && again.reason === "closed" && flowsTo(DRIVER_PHONE).length === 0 && JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([CL.CARLOAD_CLOSED_TEXT]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a morning form still in his chat, sent after the count: refused with the one line
  const env = world();
  await start(env, "morning");
  const spare = flowsTo(DRIVER_PHONE)[0];
  await usualLoad(env);
  setRiyadh(`${DAY} 13:00`);
  await usualCount(env);
  const before = JSON.stringify(record(env));
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(spare), { a1: "99" });
  assert("a morning form sent after the evening count is refused with one line, and the day's record does not move", r.action === "closed" && JSON.stringify(record(env)) === before && JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([CL.CARLOAD_CLOSED_TEXT]) && sentTo(OWNER).length === 0, JSON.stringify(r));
}
{
  // the load replaced after the evening form was sent: that form's numbers are not this load's
  const env = world();
  await usualLoad(env);
  setRiyadh(`${DAY} 12:00`);
  await start(env, "evening");
  const stale = flowsTo(DRIVER_PHONE).at(-1);
  setRiyadh(`${DAY} 12:10`);
  await load(env, { a1: "10", a16: "30" });
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(stale), { a16: "2" });
  const f = flowsTo(DRIVER_PHONE)[0];
  assert("an evening form made from a load that was replaced since: nothing kept, and a fresh evening form of the load as it is now (طماطم 30)", r.action === "stale" && record(env).count === undefined && sentTo(DRIVER_PHONE).length === 1 && bodyOf(f).split("\n")[0] === CL.CARLOAD_STALE_TEXT
    && dataOf(f).h16 === "الباقي في السيارة · المحمّل 30 كرتون" && sentTo(OWNER).length === 0, JSON.stringify([r, bodyOf(f)]));
  const ok = await reply(env, DRIVER_PHONE, tokenOf(f), { a16: "2" });
  assert("…that one is read", ok.action === "counted" && record(env).count.find((c: any) => c.key === "1:11").left === 2);
}

// ================================================================ ج5
console.log("\n[ج5] bad values refuse the whole form: nothing kept, one message naming the field, a fresh form");
{
  const p = CL.parseLoadQty;
  assert("a field left empty is 0", p("") === 0 && p("  ") === 0 && p(undefined) === 0 && p(null) === 0 && p("0") === 0);
  assert("a quantity: «12», «2.5», «2,5», «٢٫٥», «۱۲», «0.25»", p("12") === 12 && p("2.5") === 2.5 && p("2,5") === 2.5 && p("٢٫٥") === 2.5 && p("۱۲") === 12 && p("0.25") === 0.25 && p(7) === 7);
  assert("not a number, negative, or more than two decimals: refused", ["abc", "12كرتون", "-3", "−3", "1.234", "1,234", "2.", ".5", "1e3", "3 4x", "+5"].every((v) => p(v) === "invalid"));
  assert("above the largest quantity a field takes (9999): refused", p("9999") === 9999 && p("10000") === "invalid" && CL.CARLOAD_QTY_MAX === 9999);
}
{
  const env = world();
  await start(env, "morning");
  const f = flowsTo(DRIVER_PHONE)[0];
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { a1: "10", a16: "-3", a17: "1.234", a18: "5" });
  const again = flowsTo(DRIVER_PHONE);
  assert("a negative quantity and one with three decimals: the WHOLE form is refused — nothing kept, nothing to Baraa", r.action === "invalid" && record(env) === null && sentTo(OWNER).length === 0, JSON.stringify(r));
  assert("…ONE message: it names the two fields, and carries a fresh form", sentTo(DRIVER_PHONE).length === 1 && again.length === 1 && bodyOf(again[0]) === [
    "⚠️ ما انحفظ شيء من النموذج:", "• قيمة غير صحيحة في: طماطم، خيار — اكتب رقماً (صفر أو أكثر) بخانتين عشريتين على الأكثر.", "صحّح الخانات ثم «إرسال» 👇",
  ].join("\n") && tokenOf(again[0]) !== tokenOf(f), bodyOf(again[0]));
  assert("…the fresh form opens with what he wrote in the fields that were right (موز 10, بطاطس 5), the wrong ones empty", dataOf(again[0]).i1 === "10" && dataOf(again[0]).i18 === "5" && dataOf(again[0]).i16 === "" && dataOf(again[0]).i17 === "" && dataOf(again[0]).t1 === "حمولة الصباح — فواكه");
  const old = await reply(env, DRIVER_PHONE, tokenOf(f), { a1: "10" });
  assert("…the refused form itself is spent", old.action === "duplicate" && record(env) === null);
  const ok = await reply(env, DRIVER_PHONE, tokenOf(again[0]), { a1: "10", a16: "3", a18: "5" });
  assert("…and the fresh one, corrected, is kept", ok.action === "loaded" && record(env).items.length === 3);
}
{
  const env = world();
  await usualLoad(env);
  setRiyadh(`${DAY} 13:00`);
  await start(env, "evening");
  const f = flowsTo(DRIVER_PHONE).at(-1);
  graph.length = 0;
  // طماطم: 15 left + 6 damaged of 20 loaded; بطاطس: exactly what was loaded — allowed
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { a1: "", a16: "15", b16: "6", a17: "5.5", b17: "" });
  const again = flowsTo(DRIVER_PHONE);
  assert("left + damaged above what was loaded: the whole form is refused — no count kept, nothing to Baraa", r.action === "invalid" && record(env).count === undefined && sentTo(OWNER).length === 0, JSON.stringify(r));
  assert("…ONE message naming the item and what was loaded, with a fresh form opened on what he wrote", sentTo(DRIVER_PHONE).length === 1 && bodyOf(again[0]) === ["⚠️ ما انحفظ شيء من النموذج:", "• الباقي + التالف أكثر من المحمّل في: طماطم كرتون (المحمّل 20).", "صحّح الخانات ثم «إرسال» 👇"].join("\n")
    && dataOf(again[0]).i16 === "15" && dataOf(again[0]).j16 === "6" && dataOf(again[0]).i17 === "5.5" && dataOf(again[0]).h16 === "الباقي في السيارة · المحمّل 20 كرتون", bodyOf(again[0]));
  const bad = await reply(env, DRIVER_PHONE, tokenOf(again[0]), { a16: "2", b16: "x", a17: "0.5" });
  assert("a «التالف» that is not a number is named by its own label: «تالف: طماطم»", bad.action === "invalid" && record(env).count === undefined && bodyOf(flowsTo(DRIVER_PHONE).at(-1)).includes("• قيمة غير صحيحة في: تالف: طماطم — "), bodyOf(flowsTo(DRIVER_PHONE).at(-1)));
  const ok = await reply(env, DRIVER_PHONE, tokenOf(flowsTo(DRIVER_PHONE).at(-1)), { a16: "15", b16: "5", a17: "5.5" });
  assert("left + damaged EQUAL to what was loaded is a count (nothing left the car)", ok.action === "counted" && JSON.stringify(record(env).count.slice(1)) === JSON.stringify([{ key: "1:11", left: 15, damaged: 5 }, { key: "3:31", left: 5.5, damaged: 0 }]));
  assert("readCarLoadValues reads the token's items, never a slot the form did not show", CL.readCarLoadValues({ moment: "morning", items: CL.carLoadPages("morning", [{ productId: 1, packagingId: 11, product: "طماطم", packaging: "كرتون", page: "خضار", loaded: 0 }]).items }, { a1: "4", a2: "9", b1: "7" }).read.map((x: any) => [x.item.key, x.a, x.b]).join() === "1:11,4,0");
}

// ================================================================ ج6
console.log("\n[ج6] the token: the number it was sent to, the day it was sent, once");
{
  const env = world();
  await start(env, "morning");
  const f = flowsTo(DRIVER_PHONE)[0], token = tokenOf(f);
  assert("the token is cl1.<day>.<driver>.<random>, kept with the number, the day and the item of every slot", /^cl1\.20261003\.603\.[0-9a-f]{18}$/.test(token) && CL.isCarLoadToken(token) && !CL.isCarLoadToken("of1.20261003.603.aa") && !CL.isCarLoadToken("")
    && (() => { const t = JSON.parse(env.MSG_DEDUP.store.get(CL.carLoadTokenKey(token))); return t.to === DRIVER_PHONE && t.day === DAY && t.moment === "morning" && t.driverId === DRIVER && t.items.length === 5; })());
  graph.length = 0;
  const other = await reply(env, WH_PHONE, token, { a1: "10" });
  assert("the same token from ANOTHER number: nothing read, nothing kept, one line to that number", other.action === "unknown" && record(env) === null && record(env, DAY, WH) === null && JSON.stringify(textsTo(WH_PHONE)) === JSON.stringify([CL.CARLOAD_UNKNOWN_TEXT]) && sentTo(OWNER).length === 0);
  const made = await reply(env, DRIVER_PHONE, "cl1.20261003.603.000000000000000000", { a1: "10" });
  assert("a token the worker never issued: nothing kept", made.action === "unknown" && record(env) === null);
  const ok = await reply(env, DRIVER_PHONE, token, { a1: "10" });
  graph.length = 0;
  const twice = await reply(env, DRIVER_PHONE, token, { a1: "50" });
  assert("a second use of the token: not kept again — the load stays 10 — one line, nothing more to Baraa", ok.action === "loaded" && twice.action === "duplicate" && record(env).items[0].loaded === 10 && JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([CL.CARLOAD_USED_TEXT]) && sentTo(OWNER).length === 0);
}
{
  const env = world(`${DAY} 23:40`);
  await start(env, "morning");
  const f = flowsTo(DRIVER_PHONE)[0];
  setRiyadh(`${NEXT} 00:20`); graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { a1: "10" });
  assert("a form sent yesterday and filled after midnight: nothing kept on either day, one line", r.action === "expired" && record(env, DAY) === null && record(env, NEXT) === null && JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([CL.CARLOAD_EXPIRED_TEXT]));
  // through the webhook, by the token's prefix
  const env2 = world();
  await say(env2, DRIVER_PHONE, text("حمولة"));
  const f2 = flowsTo(DRIVER_PHONE)[0];
  const res = await say(env2, DRIVER_PHONE, nfm(tokenOf(f2), { a1: "10", a16: "20" }));
  assert("the Flow's reply through the webhook is routed by its «cl1.» token: the load is kept, and no price row is written from it", res.status === 200 && record(env2)?.items.length === 2 && rows("x_daily_price").length === 5 && rows("x_price_offer").length === 5, JSON.stringify(record(env2)?.items));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ ج7
console.log("\n[ج7] more than fifteen of a category, more than four pages, more than sixty items");
{
  const mk = (n: number, page: string, from: number): any[] => Array.from({ length: n }, (_, i) => ({ productId: from + i, packagingId: 1, product: `صنف ${from + i}`, packaging: "كرتون", page, loaded: 0 }));
  const a = CL.carLoadPages("morning", [...mk(16, "فواكه", 100), ...mk(3, "خضار", 200)]);
  assert("sixteen fruits: fifteen on «فواكه», one on «فواكه (2)», then «خضار» on the third page", JSON.stringify(a.pages) === JSON.stringify(["فواكه", "فواكه (2)", "خضار"]) && JSON.stringify(a.items.map((i: any) => i.slot)) === JSON.stringify([...Array.from({ length: 16 }, (_, i) => i + 1), 31, 32, 33]) && a.left.length === 0, JSON.stringify(a.pages));
  const d = CL.carLoadData("morning", a.pages, a.items);
  assert("…«التالي» after the first two pages only; the headings carry the moment", d.m1 === true && d.m2 === true && d.m3 === false && d.t2 === "حمولة الصباح — فواكه (2)" && d.v16 === true && d.v17 === false && d.v31 === true);
  assert("a heading longer than Meta's eighty characters is cut", count(String(CL.carLoadData("morning", ["فئة ".repeat(30)], a.items).t1)) === 80 && CL.CARLOAD_HEADING_MAX === 80);
  const b = CL.carLoadPages("morning", [...mk(20, "فواكه", 100), ...mk(25, "خضار", 200), ...mk(8, "ورقيات", 300)]);
  assert("fifty-three items whose categories would take five pages: they run on, fifteen a page — every one has a field — each page headed by the categories it holds",
    b.items.length === 53 && b.left.length === 0 && JSON.stringify(b.pages) === JSON.stringify(["فواكه", "فواكه · خضار", "خضار", "ورقيات"]) && JSON.stringify(b.items.map((i: any) => i.slot)) === JSON.stringify(Array.from({ length: 53 }, (_, i) => i + 1))
    && b.items[19].name === "صنف 119 كرتون" && b.items[20].name === "صنف 200 كرتون", JSON.stringify(b.pages));
  const c = CL.carLoadPages("morning", [...mk(50, "خضار", 100), ...mk(20, "أخرى", 400)]);
  assert("seventy items: the first SIXTY have a field, the ten after them are left", c.items.length === 60 && c.left.length === 10 && c.pages.length === 4 && c.items.at(-1).name === "صنف 409 كرتون" && c.left[0] === "صنف 410 كرتون" && c.left.at(-1) === "صنف 419 كرتون", JSON.stringify([c.items.length, c.left]));
  assert("the names beyond the form are listed within their room: the first that fit, then how many more", CL.namesLine(["أ", "ب", "ج"], 100) === "أ، ب، ج" && CL.namesLine(["أأأأ", "بببب", "جججج"], 10) === "أأأأ، بببب و1 غيرها" && CL.namesLine(["طويل جداً"], 3) === "و1 غيرها");
}
{
  const env = world();
  for (let i = 0; i < 65; i++) {
    seed("product.template", { id: 100 + i, name: `صنف ${100 + i}`, sale_ok: true, x_is_active_for_sale: true, categ_id: 6 });
    seed("x_product_packaging", { id: (100 + i) * 10 + 1, x_name: "كرتون", x_product_tmpl_id: 100 + i, x_is_default: true });
  }
  const r = await start(env, "morning");
  const f = flowsTo(DRIVER_PHONE)[0], d = dataOf(f);
  assert("seventy active items: sixty fields on four pages, «التالي» on the first three", r.sent === true && r.items === 60 && Array.from({ length: 60 }, (_, i) => i + 1).every((n) => d[`v${n}`] === true) && d.m1 === true && d.m2 === true && d.m3 === true && d.t1 === "حمولة الصباح — فواكه · خضار" && d.t4 === "حمولة الصباح — خضار", JSON.stringify([r, d.t1, d.t4]));
  assert("…the ten left out are named in the message, within its 1024 characters", bodyOf(f).split("\n").at(-1)!.startsWith("خارج النموذج (يتسع لـ 60): صنف 156 كرتون، ") && bodyOf(f).split("\n").at(-1)!.endsWith("بصل جرم. اكتبها لبراء نصاً.") && bodyOf(f).length <= 1024, bodyOf(f));
  // every field filled: the confirmation is longer than an interactive message's text
  graph.length = 0;
  const all = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`a${i + 1}`, String(i + 1)]));
  const out = await reply(env, DRIVER_PHONE, tokenOf(f), all);
  const toHim = sentTo(DRIVER_PHONE);
  assert("sixty items loaded: the list goes as text, then the short message with the button — nothing cut, nothing lost", out.action === "loaded" && out.items === 60 && toHim.length === 2 && toHim[0].type === "text" && bodyOf(toHim[0]).split("\n").length === 61
    && bodyOf(toHim[1]) === [`✅ سُجّلت حمولة السيارة — ${LABEL} (التفاصيل أعلاه).`, "المجموع: 1830 · عدد الأصناف: 60", "آخر اليوم اضغط «نهاية الحمولة» واكتب الباقي والتالف."].join("\n") && JSON.stringify(buttonsOf(toHim[1])) === JSON.stringify([["cload_e", "نهاية الحمولة"]]), bodyOf(toHim[1]));
  setRiyadh(`${DAY} 13:00`); graph.length = 0;
  await start(env, "evening");
  const e = dataOf(flowsTo(DRIVER_PHONE)[0]);
  assert("…and the evening form holds the sixty of them, both fields shown", Array.from({ length: 60 }, (_, i) => i + 1).every((n) => e[`v${n}`] === true && e[`w${n}`] === true) && Object.keys(e).length === 428);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ ج8
console.log("\n[ج8] nothing is written in Odoo, and no price of any kind is read or sent");
{
  const env = world();
  delivery(`${DAY} 08:10`, BANANA, BANANA_PACK, 8); delivery(`${DAY} 08:40`, 1, 11, 19); delivery(`${DAY} 11:30`, 4, 41, 3);
  const tables = ["x_daily_order", "x_daily_order_line", "x_payment", "x_invoice", "x_price_day", "x_price_day_line", "x_daily_price", "x_price_offer", "product.template", "x_product_packaging", "hr.employee", "account.move", "account.payment"];
  const before = JSON.stringify(tables.map((t) => rows(t)));
  odooLog.length = 0; graph.length = 0;
  await usualLoad(env);
  await load(env, { a1: "10", a16: "20", a18: "5.5" });
  await load(env, { a1: "x" });
  setRiyadh(`${DAY} 13:00`);
  await usualCount(env);
  await countUp(env, { a16: "99" });
  await usualCount(env);
  const w = odooWrites();
  assert("a whole day — the load, its replacement, a refused form, the count, a refused count, a correction: the ONLY writes in Odoo are the gateway's own record of each message (an x_wa_message row, and the number's conversation in Discuss)",
    w.length > 0 && w.every(gatewayRecord), JSON.stringify([...new Set(w.filter((c: any) => !gatewayRecord(c)).map((c: any) => `${c.model}.${c.method}`))]));
  assert("…one x_wa_message row a message sent, each naming its purpose", w.filter((c: any) => c.model === "x_wa_message").length === graph.length
    && rows("x_wa_message").every((m: any) => /"purpose":"(car_load_form|owner_team_note)"/.test(String(m.x_debug_payload))), `${w.filter((c: any) => c.model === "x_wa_message").length} / ${graph.length}`);
  assert("…no order, line, payment, invoice, price, product, employee or accounting row changed, and none was created", JSON.stringify(tables.map((t) => rows(t))) === before);
  assert("the day's record lives in KV alone", record(env)?.count?.length === 3 && [...env.MSG_DEDUP.store.keys()].filter((k: string) => k.startsWith("cload:")).length === 1);
  // ---- no price
  const reads = odooLog.filter((c: any) => /^(search_read|search|read)$/.test(c.method));
  const named = (c: any): string[] => [...(c.body?.fields ?? []), ...((c.body?.domain ?? []) as unknown[]).filter(Array.isArray).map((t: any) => String(t[0]))];
  assert("no price model is read (the day's prices, the purchase prices, the offers, the settings, the costs, the invoices, the payments)", !reads.some((c: any) => /^(x_price_day|x_price_day_line|x_daily_price|x_price_offer|x_pricing_config|x_operating_cost|x_invoice|x_payment|x_quotation|sale\.order|account\.)/.test(c.model)), JSON.stringify([...new Set(reads.map((c: any) => c.model))]));
  assert("no field of a price, a cost, an amount or a total is asked of Odoo", !reads.some((c: any) => named(c).some((f) => /price|cost|amount|total|subtotal|profit|margin|discount/i.test(f))), JSON.stringify([...new Set(reads.flatMap(named))]));
  const everything = JSON.stringify(graph);
  assert("nothing sent — the forms' data, the messages to him and to Baraa — carries a price: not 77.77 (purchase), 88.88 (market), 99.99 (sale), 95.55 (suggested), 66.66 (the order line's), nor «ر.س», «سعر», «ربح», «ريال»",
    graph.length >= 12 && !/77\.77|88\.88|99\.99|95\.55|66\.66|ر\.س|سعر|ربح|ريال|تكلفة/.test(everything));
  const code = srcOf("car-load.ts").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert("src/car-load.ts names no price field and imports no pricing of a line (the active items' list alone)", !/x_[a-z_]*(price|cost|amount|total|profit|margin)/i.test(code) && !/getLatestSalePrice|validPriceList|readLines|quoteOrder|profitAt|fmtSar|money\(/.test(code)
    && /import \{ readActiveItems \} from "\.\/pricing-engine";/.test(code));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ ج9
console.log("\n[ج9] the trial to Baraa, its hook, and the purposes");
{
  const env = world(`${DAY} 10:00`);
  closeOwnerWindow(env);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: 3, x_processed_at: utc(`${PREV} 01:00`), x_status: "received" });
  const shut = await quiet(() => CL.sendCarLoadFormTest(env));
  assert("Baraa's window closed: the trial does not go, nothing is held, and the day is not spent", shut.sent === false && shut.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(shut));
  openWindow(env, OWNER);
  const t = await quiet(() => CL.sendCarLoadFormTest(env));
  const f = flowsTo(OWNER)[0], d = dataOf(f);
  assert("the trial: ONE message, to Baraa's number alone — the morning form over the active items, marked «🧪 تجربة»", t.sent === true && t.items === 5 && graph.length === 1 && graph[0].to === OWNER && bodyOf(f).startsWith(`🧪 تجربة — 🚚 حمولة السيارة — ${LABEL}`) && d.t1 === "🧪 تجربة — حمولة الصباح — فواكه" && d.l16 === "طماطم" && d.w16 === false, bodyOf(f));
  const again = await quiet(() => CL.sendCarLoadFormTest(env));
  assert("a second trial the same day is refused", again.sent === false && again.reason === "already_today" && graph.length === 1);
  const kvBefore = [...env.MSG_DEDUP.store.keys()].filter((k: string) => k.startsWith("cload:")).length;
  odooLog.length = 0;
  const r = await reply(env, OWNER, tokenOf(f), { a1: "10", a16: "20" });
  assert("his reply is answered with what would be kept, marked as a trial…", r.action === "test" && r.items === 2 && bodyOf(sentTo(OWNER).at(-1)) === [
    `🧪 تجربة — ✅ سُجّلت حمولة السيارة — ${LABEL}:`, "• موز كرتون × 10", "• طماطم كرتون × 20", "المجموع: 30 · عدد الأصناف: 2", "(تجربة: لم يُحفظ شيء)",
  ].join("\n") && buttonsOf(sentTo(OWNER).at(-1)).length === 0, bodyOf(sentTo(OWNER).at(-1)));
  assert("…and keeps NOTHING: no day's record, no write in Odoo but the message's own, nothing to anyone else", [...env.MSG_DEDUP.store.keys()].filter((k: string) => k.startsWith("cload:")).length === kvBefore && kvBefore === 0
    && odooWrites().every((c: any) => c.model === "x_wa_message") && graph.every((b: any) => b.to === OWNER));
  const twice = await reply(env, OWNER, tokenOf(f), { a1: "10" });
  assert("the trial's token is read once too", twice.action === "duplicate");
  // the hook
  const hookEnv = { ...env, ODOO_HOOK_TOKEN: "HOOK" };
  const post = (q: string, e: any = hookEnv) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/carload-form-test${q}`, { method: "POST" }), e, ctx));
  const no = await post("?token=nope"), none = await post(""), unset = await post("?token=", env);
  assert("POST /odoo/hook/carload-form-test without the hook's token: 401, nothing sent", no.status === 401 && none.status === 401 && unset.status === 401);
  const yes = await post("?token=HOOK");
  const body = await yes.json() as any;
  assert("…with it: the worker's own answer (today's trial already went)", yes.status === 200 && body.ok === true && body.sent === false && body.reason === "already_today", JSON.stringify(body));
  setRiyadh(`${NEXT} 10:00`); openWindow(env, OWNER);
  const next = await (await post("?token=HOOK")).json() as any;
  assert("…and the next day it sends one", next.ok === true && next.sent === true && flowsTo(OWNER).length === 2, JSON.stringify(next));
  assert("the trial script knows the hook", /carload: "carload-form-test"/.test(readFileSync(new URL("../scripts/s55-20261005-trial.mjs", import.meta.url), "utf8")));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  assert("car_load_form is the team's (operational, never critical); car_load_form_test is the owner's trial", PURPOSES.car_load_form?.kind === "operational" && !PURPOSES.car_load_form.critical && PURPOSES.car_load_form_test?.kind === "operational"
    && CL.CARLOAD_PURPOSE === "car_load_form" && CL.CARLOAD_TEST_PURPOSE === "car_load_form_test" && CL.CARLOAD_OWNER_PURPOSE === "owner_team_note" && CL.CARLOAD_ROLE === "driver");
  const x = { kind: "session" as const, body: { type: "text", text: { body: "x" } } };
  const toDriver = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: "car_load_form_test", to: "+" + DRIVER_PHONE, content: x })));
  const toOwner = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: "car_load_form", to: "+" + OWNER, content: x })));
  assert("the gateway refuses the trial's purpose to any number but Baraa's, and the driver's form to Baraa's", toDriver?.action === "refused" && toOwner?.action === "refused" && graph.length === 0, JSON.stringify([toDriver, toOwner]));
  const src = srcOf("car-load.ts");
  assert("the form is never held: noHold on its send, and no template", /noHold: true,/.test(src) && !/kind: "template"/.test(src));
  // the form's reply never reaches the price form's reader
  const idx = srcOf("index.ts");
  assert("the Flow's reply is routed by its token before the price form's reader", idx.indexOf("isCarLoadToken(msg.flow.token") > 0 && idx.indexOf("isCarLoadToken(msg.flow.token") < idx.indexOf("handlePriceFlowReply(env, msg, ctx)"));
}

assert("its id at Meta: utak_carload_v1 #1128570570118160", CL.CARLOAD_FLOW_ID === "1128570570118160");
done();
