// § 55 هـ (2026-10-05) — the custody handover at the end of the day: the cash the collector is
// expected to hold, what he handed over and how, and the difference that reaches Baraa.
//
//   [هـ1] utak_custody_v1: the JSON at Meta against what the worker sends — the keys, the types, the
//         components, Meta's limits
//   [هـ2] the triggers: the text and the button; the collector's role; another member; where the text
//         stands among the team's texts
//   [هـ3] the cash expected: cash only, his only, today only (a Riyadh day), no simulation
//   [هـ4] the handover: equal, short, over; what he reads and what Baraa reads; kept four days in KV
//   [هـ5] a second handover the same day: a correction that names the earlier figures
//   [هـ6] the figure moving between the form and the reply; collections that cannot be read again
//   [هـ7] bad values: the amount, the way
//   [هـ8] the tokens: another number, a second use, another day
//   [هـ9] nothing is written in Odoo and no entry is made; no purchase price, cost or profit
//   [هـ10] the trial to Baraa, its hook, and the two purposes
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s55-custody.test.mts

import { readFileSync } from "node:fs";
import { COLL, COLL_PHONE, OWNER, WH, WH_PHONE, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table, workSchedule } from "./wa-harness.mts";
import { ALL_WEEK, C1, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, done, dp, fresh, market, rejected, setExtract } from "./s46-kit.mts";

const CU = await import("../src/custody-form.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const { deliverCommandOrderId } = await import("../src/order-flow.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s55-flows.mjs");

const NEXT = "2026-10-04", PREV = "2026-10-02";   // DAY = 2026-10-03, a Saturday
const LABEL = "السبت 3 أكتوبر 2026";
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const ms = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const count = (s: string) => [...s].length;
const INV = 9001, INV_SIM = 9002, INV_SIM_ORDER = 9003, ORDER = 8001, ORDER_SIM = 8002;

/**
 * The tenant's shape: Omar is the driver, the buyer and the collector; سالم (#602) is another
 * collector; أحمد (#601) is a buyer only. One real invoice, one simulation invoice, and one real
 * invoice of a simulation order. The items have purchase prices — none of which this part may show.
 */
function world(riyadh = `${DAY} 14:00`): any {
  const env = fresh(riyadh); setExtract(null);
  table("hr.employee").get(OMAR_EMP)!.x_utak_role_ids = [71, 72, 73];
  seed("x_daily_order", { id: ORDER, x_customer_id: C1, x_state: "delivered", x_order_date: DAY, x_utak_simulation: false });
  seed("x_daily_order", { id: ORDER_SIM, x_customer_id: C1, x_state: "delivered", x_order_date: DAY, x_utak_simulation: true });
  seed("x_invoice", { id: INV, x_invoice_number: "INV-1", x_order_id: ORDER, x_total: 2000, x_status: "issued", x_utak_simulation: false });
  seed("x_invoice", { id: INV_SIM, x_invoice_number: "INV-2", x_order_id: ORDER, x_total: 500, x_status: "issued", x_utak_simulation: true });
  seed("x_invoice", { id: INV_SIM_ORDER, x_invoice_number: "INV-3", x_order_id: ORDER_SIM, x_total: 500, x_status: "issued", x_utak_simulation: false });
  dp(1, 11, 77.77); market(1, 11, 88.88);
  openWindow(env, DRIVER_PHONE); openWindow(env, WH_PHONE); openWindow(env, COLL_PHONE);
  return env;
}
/** A collection: cash, by Omar, on the real invoice — unless said otherwise. */
const pay = (riyadh: string, amount: number, extra: Record<string, unknown> = {}) =>
  seed("x_payment", { x_invoice_id: INV, x_amount: amount, x_method: "cash", x_collected_at: utc(riyadh), x_collected_by: DRIVER, x_utak_simulation: false, ...extra });
/** Omar's day: three cash collections (200 + 150.50 + 99.50 = 450), and everything that is NOT his cash of today. */
function day(): void {
  pay(`${DAY} 00:30`, 200);                                   // after midnight in Riyadh — the day before in UTC
  pay(`${DAY} 09:10`, 150.5);
  pay(`${DAY} 11:45`, 99.5);
  pay(`${DAY} 10:00`, 300, { x_method: "transfer" });          // a transfer is not cash in his hand
  pay(`${DAY} 10:05`, 61, { x_method: "pending" });
  pay(`${DAY} 10:10`, 70, { x_collected_by: COLL });           // another collector's
  pay(`${DAY} 10:15`, 19, { x_collected_by: false });          // nobody's
  pay(`${PREV} 23:30`, 40);                                    // last night
  pay(`${NEXT} 00:10`, 55);                                    // after midnight tonight
  pay(`${DAY} 10:20`, 33, { x_utak_simulation: true });        // a simulation payment
  pay(`${DAY} 10:25`, 44, { x_invoice_id: INV_SIM });          // of a simulation invoice
  pay(`${DAY} 10:30`, 22, { x_invoice_id: INV_SIM_ORDER });    // of a simulation order's invoice
}
const omar = { partnerId: DRIVER, name: "عمر المجهلي", whatsapp: "+" + DRIVER_PHONE };
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map(bodyOf);
const record = (env: any, d = DAY, who = DRIVER) => JSON.parse(env.MSG_DEDUP.store.get(CU.custodyKey(d, who)) ?? "null");
const start = (env: any, now?: number) => quiet(() => CU.startCustody(env, omar, undefined, now));
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => CU.handleCustodyReply(env, { from: "+" + from, messageId: `wamid.U${++wamid}`, flow: { token, values } }, undefined, now));
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (t: string) => ({ type: "text", text: { body: t } });
const button = (id: string, title = "x") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
/** The form, and its reply. */
async function hand(env: any, values: Record<string, unknown>): Promise<any> {
  await start(env);
  const f = flowsTo(DRIVER_PHONE).at(-1);
  return { f, r: await reply(env, DRIVER_PHONE, tokenOf(f), values) };
}
const odooWrites = () => odooLog.filter((c: any) => !/^(search_read|search|search_count|read|fields_get)$/.test(c.method));
/** The gateway's own record of a send (§ 36): its x_wa_message row, and the number's conversation in Discuss. */
const gatewayRecord = (c: any): boolean => (c.model === "x_wa_message" && c.method === "create") || /^discuss\.channel(\.member)?$/.test(c.model)
  || (c.model === "res.partner" && c.method === "write" && Object.keys(c.body?.vals ?? {}).join() === "x_wa_channel_id");
const NO_ENTRY = "لا قيد آلي: خروج المبلغ من يومية كاش السائق (CSHD) يُسجَّل يدوياً في Odoo.";

// ================================================================ هـ1
console.log("\n[هـ1] utak_custody_v1 at Meta is the form the worker fills: one screen, no endpoint");
{
  const json = LIB.buildCustodyFlowJson();
  const s = json.screens[0], c = s.layout.children;
  assert("ONE screen, CUSTODY_A — the one the worker opens — terminal; Flow JSON 6.0; in the Meta script's list", json.screens.length === 1 && s.id === "CUSTODY_A" && LIB.CUSTODY_SCREEN === CU.CUSTODY_FLOW_SCREEN && s.terminal === true && s.success === true && json.version === "6.0"
    && LIB.CUSTODY_FLOW_NAME === "utak_custody_v1" && LIB.FLOWS.some((f: any) => f.key === "custody" && f.name === "utak_custody_v1" && f.build === LIB.buildCustodyFlowJson && f.first === "CUSTODY_A"));
  assert("no endpoint and no Form wrapper: no data_api_version, no data_exchange, no «Form» component", !("data_api_version" in json) && !JSON.stringify(json).includes("data_exchange") && LIB.screenComponents(s).every((x: any) => x.type !== "Form"));
  assert("six components (Meta allows fifty): the heading, the line, the amount, the way, the note, «إرسال»", LIB.screenComponents(s).length === 6 && LIB.screenComponents(s).length <= LIB.SCREEN_COMPONENTS_MAX
    && JSON.stringify(c.map((x: any) => x.type)) === JSON.stringify(["TextHeading", "TextBody", "TextInput", "RadioButtonsGroup", "TextInput", "Footer"]));
  assert("the heading and the line of the expected cash come from the data", c[0].text === "${data.t}" && c[1].text === "${data.exp}");
  assert("«المبلغ المسلَّم»: amt, a number, REQUIRED", c[2].name === "amt" && c[2].label === "المبلغ المسلَّم" && c[2]["input-type"] === "number" && c[2].required === true && count(c[2].label) <= 20 && count(c[2]["helper-text"]) <= 80);
  assert("«طريقة التسليم»: how, REQUIRED, two choices — bank «إيداع بنكي», owner «تسليم لبراء» — and nothing chosen for him", c[3].name === "how" && c[3].label === "طريقة التسليم" && c[3].required === true && !("init-value" in c[3]) && count(c[3].label) <= 30
    && JSON.stringify(c[3]["data-source"]) === JSON.stringify([{ id: "bank", title: "إيداع بنكي" }, { id: "owner", title: "تسليم لبراء" }]) && c[3]["data-source"].every((o: any) => count(o.title) <= 30));
  assert("…the worker reads the same two ids, under the same words", JSON.stringify(Object.entries(CU.CUSTODY_HOW)) === JSON.stringify(LIB.CUSTODY_HOW.map((o: any) => [o.id, o.title])));
  assert("«ملاحظة»: note, optional", c[4].name === "note" && c[4].label === "ملاحظة" && c[4].required === false && c[4]["input-type"] === "text" && count(c[4]["helper-text"]) <= 80);
  assert("«إرسال» completes with amt, how and note", c[5].label === "إرسال" && c[5]["on-click-action"].name === "complete" && JSON.stringify(c[5]["on-click-action"].payload) === JSON.stringify({ amt: "${form.amt}", how: "${form.how}", note: "${form.note}" }));
  assert("the screen declares two keys — t and exp — each with an example that is not empty", JSON.stringify(Object.keys(s.data).sort()) === JSON.stringify(["exp", "t"]) && Object.values(s.data).every((v: any) => v.type === "string" && typeof v.__example__ === "string" && v.__example__ !== ""));
  const env = world(); day();
  await start(env);
  const f = flowsTo(DRIVER_PHONE)[0], d = dataOf(f);
  assert("every key the worker sends is declared, and every declared key is sent — both strings, neither empty nor null", JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(s.data).sort()) && Object.values(d).every((v) => typeof v === "string" && v !== ""), JSON.stringify(d));
  assert("the heading within Meta's eighty characters, the line within a text's room", count(String(d.t)) <= 80 && count(String(d.exp)) <= 4096 && d.t === `تسليم العهدة — ${LABEL}`, String(d.t));
  assert("the message opens utak_custody_v1 on its screen with the data (navigate), under «سلّم العهدة»", par(f).flow_id === CU.CUSTODY_FLOW_ID && par(f).flow_action === "navigate" && par(f).flow_action_payload.screen === "CUSTODY_A" && par(f).flow_message_version === "3"
    && par(f).flow_cta === "سلّم العهدة" && count(par(f).flow_cta) <= 20 && count(CU.CUSTODY_BUTTON_TITLE) <= 20 && bodyOf(f).length <= 1024);
  assert("a heading longer than eighty characters is cut", count(CU.custodyData(DAY, { total: 1, count: 1 }, "م".repeat(90)).t) === 80 && CU.CUSTODY_HEADING_MAX === 80);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ2
console.log("\n[هـ2] the triggers: «عهدة» / «تسليم العهدة» and the button, from a collector alone");
{
  assert("«عهدة» and «تسليم العهدة» are the command — as a phone types them too: «عهده», « تسليم  العهده. »", CU.custodyCommand("عهدة") && CU.custodyCommand("تسليم العهدة") && CU.custodyCommand("عهده") && CU.custodyCommand(" تسليم  العهده. ") && CU.custodyCommand("عُهدة"));
  assert("the WHOLE message: a sentence that holds the word is not the command", ["عهدة اليوم كم؟", "وين العهدة", "تسليم العهدة بكرة", "سلمت العهدة لبراء 450", "تسليم 12", "تسليم", "450", "", "العهدة"].every((t) => !CU.custodyCommand(t)));
  assert("«تسليم العهدة» is not «تسليم N» (the delivery on the spot), and «تسليم 12» is not the custody", deliverCommandOrderId("تسليم العهدة") === null && deliverCommandOrderId("تسليم 12") === 12 && !CU.custodyCommand("تسليم 12"));
  assert("the button: custody_start, «تسليم العهدة»", JSON.stringify(CU.custodyButton()) === JSON.stringify({ id: "custody_start", title: "تسليم العهدة" }) && CU.CUSTODY_BUTTON === "custody_start");
}
{
  const env = world(); day();
  const r = await say(env, DRIVER_PHONE, text("عهدة"));
  const f = flowsTo(DRIVER_PHONE);
  assert("«عهدة» from Omar (a collector) through the webhook → ONE message: the custody form", r.status === 200 && sentTo(DRIVER_PHONE).length === 1 && f.length === 1 && dataOf(f[0]).exp === "الكاش المتوقع معك اليوم: 450 ر.س — 3 تحصيلات", JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf)));
  assert("…its text: the day, the cash expected, and what to do", bodyOf(f[0]) === [`💵 تسليم العهدة — ${LABEL}`, "الكاش المتوقع معك اليوم: 450 ر.س — 3 تحصيلات", "اضغط «سلّم العهدة» واكتب المبلغ اللي سلّمته وطريقة التسليم، ثم «إرسال»."].join("\n"), bodyOf(f[0]));
  assert("…nothing went to Baraa, and nothing is held", sentTo(OWNER).length === 0 && heldFor(env, DRIVER_PHONE).length === 0);
  await say(env, DRIVER_PHONE, text("تسليم العهدة"));
  assert("«تسليم العهدة» → the form too (and no «ما لقينا الطلب»)", flowsTo(DRIVER_PHONE).length === 2 && sentTo(DRIVER_PHONE).length === 2);
  await say(env, DRIVER_PHONE, button("custody_start"));
  assert("the button custody_start → the form, and no «زر قديم» answer", flowsTo(DRIVER_PHONE).length === 3 && sentTo(DRIVER_PHONE).length === 3, JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf).slice(2)));
  // another collector gets HIS figure
  await say(env, COLL_PHONE, text("عهدة"));
  assert("«عهدة» from سالم (another collector): his own form, with HIS cash — 70 ر.س from one collection", flowsTo(COLL_PHONE).length === 1 && dataOf(flowsTo(COLL_PHONE)[0]).exp === "الكاش المتوقع معك اليوم: 70 ر.س — تحصيل واحد", String(dataOf(flowsTo(COLL_PHONE)[0]).exp));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a member without the collector role: the existing behaviour, word for word
  const env = world(); day();
  await say(env, WH_PHONE, text("عهدة"));
  assert("«عهدة» from a buyer who is no collector: no form — the team's usual answer", flowsTo(WH_PHONE).length === 0 && sentTo(WH_PHONE).length === 1 && bodyOf(sentTo(WH_PHONE)[0]).includes("استخدم الأزرار عشان نأكد الحالة"), JSON.stringify(sentTo(WH_PHONE).map(bodyOf)));
  await say(env, WH_PHONE, button("custody_start"));
  assert("the button from him: no form — the answer of a button the worker does not know", flowsTo(WH_PHONE).length === 0 && bodyOf(sentTo(WH_PHONE).at(-1)).startsWith("هذا الزر من رسالة قديمة"), bodyOf(sentTo(WH_PHONE).at(-1)));
  openWindow(env, C1_PHONE);
  await say(env, C1_PHONE, button("custody_start"));
  assert("the button from a customer's number: no form", sentTo(C1_PHONE).every((b: any) => b?.interactive?.type !== "flow"));
  assert("custodyText is false for a member without the role, and for any other text of a collector", (await quiet(() => CU.custodyText(env, { id: WH, name: "أحمد", x_whatsapp_number: "+" + WH_PHONE, x_role: "warehouse", x_role_codes: ["warehouse"] }, "عهدة", WH_PHONE))) === false
    && (await quiet(() => CU.custodyText(env, { id: DRIVER, name: "عمر", x_whatsapp_number: "+" + DRIVER_PHONE, x_role: "collector", x_role_codes: ["collector"] }, "مرحبا", DRIVER_PHONE))) === false && graph.every((b: any) => b.to !== DRIVER_PHONE));
  assert("the button for a collector's partner tapped from another number is not his", (await quiet(() => CU.handleCustodyButton(env, "custody_start", { id: DRIVER, name: "عمر", x_whatsapp_number: "+" + WH_PHONE }))) === null
    && (await quiet(() => CU.handleCustodyButton(env, "custody_start", null))) === null && (await quiet(() => CU.handleCustodyButton(env, "cload_e", { id: DRIVER, name: "عمر", x_whatsapp_number: "+" + DRIVER_PHONE }))) === null && flowsTo(DRIVER_PHONE).length === 0);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // where the text stands: after the collector's amount and a pending note, before the shift's hold
  const env = world(); day();
  env.MSG_DEDUP.store.set(`cpay_amount:v1:${DRIVER}`, JSON.stringify({ invoiceId: 987654, method: "cash", nonce: "abcd", at: Date.now() }));
  await say(env, DRIVER_PHONE, text("عهدة"));
  assert("while the collector's amount is awaited («مبلغ آخر»), «عهدة» is read as that amount's answer — no form", flowsTo(DRIVER_PHONE).length === 0 && sentTo(DRIVER_PHONE).length === 1 && bodyOf(sentTo(DRIVER_PHONE)[0]).includes("987654"), JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf)));
  env.MSG_DEDUP.store.set(`pending_collect_note:${DRIVER}`, String(INV));
  await say(env, DRIVER_PHONE, text("عهدة"));
  assert("after «ملاحظة 📝» on a collection, «عهدة» is the note he owes — it reaches Baraa as his note, no form", flowsTo(DRIVER_PHONE).length === 0 && bodyOf(sentTo(DRIVER_PHONE).at(-1)).startsWith("وصلت ملاحظتك لبراء") && sentTo(OWNER).some((b: any) => bodyOf(b).includes("عهدة")), JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf)));
  await say(env, DRIVER_PHONE, text("عهدة"));
  assert("…and with nothing pending the same word is the command", flowsTo(DRIVER_PHONE).length === 1);
  const src = srcOf("index.ts");
  const at = (s: string) => src.indexOf(s);
  assert("in the team's texts the command is tried after the supplier payment, the amount, «تسليم N» and the pending notes, and before the market reply and the shift's hold",
    [at("handlePayText(env, teamMember"), at("m.collectAmountReply(env"), at("deliverCommandOrderId(msg.text) !== null"), at("} else if (pendingCollectNote) {")].every((p) => p > 0 && p < at("m.custodyText(env, teamMember"))
    && at("m.custodyText(env, teamMember") < at("m.tryMarketReply(env") && at("m.custodyText(env, teamMember") < at("} else if (att.hold) {"));
}
{
  // on attendance, after the end of his shift (02:00–12:00): the end of the day is when the cash is handed over
  const env = world(`${DAY} 14:00`); day();
  Object.assign(table("hr.employee").get(OMAR_EMP)!, { x_utak_attendance: true, resource_calendar_id: workSchedule(ALL_WEEK, { name: "UTAK — عمر" }) });
  await say(env, DRIVER_PHONE, text("عهدة"));
  assert("two hours after his shift ended, «عهدة» still brings the form (not «دوامك انتهى»)", flowsTo(DRIVER_PHONE).length === 1 && sentTo(DRIVER_PHONE).length === 1, JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf)));
}
{
  // outside his window nothing goes and nothing is held
  const env = world(); day();
  env.MSG_DEDUP.store.delete(`wa_win:v1:${DRIVER_PHONE}`);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: DRIVER, x_processed_at: utc(`${PREV} 01:00`), x_status: "received" });
  const r = await start(env);
  assert("his 24h window closed: no form, no template, nothing held, no token kept", r.sent === false && r.reason === "window_closed" && sentTo(DRIVER_PHONE).length === 0 && heldFor(env, DRIVER_PHONE).length === 0
    && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("custody_t:")), JSON.stringify(r));
  // the collections cannot be read: no form with a made-up figure
  const env2 = world(); day();
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/json/2/x_payment/")) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "boom" }), { status: 500 });
    return real(input as any, init);
  }) as typeof fetch;
  let out: any;
  try { out = await start(env2); } finally { globalThis.fetch = real; }
  assert("the collections cannot be read when he asks: no form with a made-up figure — one line saying it could not go", out.sent === false && out.reason === "error" && flowsTo(DRIVER_PHONE).length === 0 && JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([CU.CUSTODY_FAILED_TEXT]));
}

// ================================================================ هـ3
console.log("\n[هـ3] the cash expected with him: his cash collections of the Riyadh day, and nothing else");
{
  const env = world(); day();
  const e = await quiet(() => CU.expectedCash(env, DRIVER, DAY));
  assert("Omar's day: 200 + 150.50 + 99.50 = 450 from three collections", e.total === 450 && e.count === 3, JSON.stringify(e));
  const only = async (extra: Record<string, unknown>, riyadh = `${DAY} 12:00`) => { const env2 = world(); pay(riyadh, 10, extra); return (await quiet(() => CU.expectedCash(env2, DRIVER, DAY))).total; };
  assert("cash only: a transfer of his today is not counted, his cash is", (await only({ x_method: "transfer" })) === 0 && (await only({ x_method: "pending" })) === 0 && (await only({})) === 10);
  assert("his only: another collector's cash, and cash with no collector, are not counted", (await only({ x_collected_by: COLL })) === 0 && (await only({ x_collected_by: false })) === 0);
  assert("today only, by Riyadh's clock: 23:30 last night and 00:10 tonight are not counted; 00:30 and 23:50 today are", (await only({}, `${PREV} 23:30`)) === 0 && (await only({}, `${NEXT} 00:10`)) === 0 && (await only({}, `${DAY} 00:30`)) === 10 && (await only({}, `${DAY} 23:50`)) === 10);
  assert("no simulation: a simulation payment, a payment of a simulation invoice, and one of a simulation order's invoice are not counted", (await only({ x_utak_simulation: true })) === 0 && (await only({ x_invoice_id: INV_SIM })) === 0 && (await only({ x_invoice_id: INV_SIM_ORDER })) === 0);
  const env3 = world(); day();
  const all = await quiet(() => CU.expectedCash(env3, null, DAY));
  assert("with no collector named (the trial): everyone's real cash of the day — 450 + 70 + 19 = 539 from five collections", all.total === 539 && all.count === 5, JSON.stringify(all));
  assert("the line: «الكاش المتوقع معك اليوم: 450 ر.س — 3 تحصيلات»; with none: «0 ر.س — لا تحصيلات»; halalas are kept: «450.50 ر.س»", CU.expectedLine({ total: 450, count: 3 }) === "الكاش المتوقع معك اليوم: 450 ر.س — 3 تحصيلات"
    && CU.expectedLine({ total: 0, count: 0 }) === "الكاش المتوقع معك اليوم: 0 ر.س — لا تحصيلات" && CU.expectedLine({ total: 450.5, count: 1 }) === "الكاش المتوقع معك اليوم: 450.50 ر.س — تحصيل واحد");
  assert("«تحصيل واحد», «تحصيلان», «3 تحصيلات» … «10 تحصيلات», «11 تحصيلاً»", JSON.stringify([0, 1, 2, 3, 10, 11, 25].map(CU.collectionsAr)) === JSON.stringify(["لا تحصيلات", "تحصيل واحد", "تحصيلان", "3 تحصيلات", "10 تحصيلات", "11 تحصيلاً", "25 تحصيلاً"]));
  const env4 = world();
  await start(env4);
  assert("a day with no cash collection: the form still goes, saying 0", dataOf(flowsTo(DRIVER_PHONE)[0]).exp === "الكاش المتوقع معك اليوم: 0 ر.س — لا تحصيلات");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ4
console.log("\n[هـ4] the handover: what he handed over against what he collected — equal, short, over");
{
  const env = world(); day();
  const puts: Array<[string, any]> = [];
  const put = env.MSG_DEDUP.put.bind(env.MSG_DEDUP);
  env.MSG_DEDUP.put = async (k: string, v: string, o?: any) => { puts.push([k, o]); return put(k, v); };
  await start(env);
  const f = flowsTo(DRIVER_PHONE)[0];
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { amt: "450", how: "bank", note: "" });
  assert("he handed over what he collected: the difference is 0", r.action === "handed" && r.expected === 450 && r.handed === 450 && r.diff === 0, JSON.stringify(r));
  assert("to him: «وصل ✅» with the same figures", JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([[
    `وصل ✅ تسليم العهدة — ${LABEL}`, "الكاش المتوقع: 450 ر.س (3 تحصيلات)", "المسلَّم فعلاً: 450 ر.س", "الطريقة: إيداع بنكي", "الفرق: مطابق", "وصلت لبراء.",
  ].join("\n")]), textsTo(DRIVER_PHONE).join("\n---\n"));
  assert("to Baraa, ALWAYS — also when it matches: the collector, the day, expected, handed over, how, «مطابق», and that NO entry is made", JSON.stringify(textsTo(OWNER)) === JSON.stringify([[
    `💵 تسليم العهدة — عمر المجهلي — ${LABEL}`, "الكاش المتوقع: 450 ر.س (3 تحصيلات)", "المسلَّم فعلاً: 450 ر.س", "الطريقة: إيداع بنكي", "الفرق: مطابق", NO_ENTRY,
  ].join("\n")]), textsTo(OWNER).join("\n---\n"));
  assert("…and to nobody else", graph.every((b: any) => b.to === DRIVER_PHONE || b.to === OWNER) && graph.length === 2);
  const rec = record(env);
  assert("the handover is kept per Riyadh day and collector: when, expected, how many collections, handed over, how, the difference", rec.v === 1 && rec.day === DAY && rec.collectorId === DRIVER && rec.collector === "عمر المجهلي" && rec.at === ms(`${DAY} 14:00`)
    && rec.expected === 450 && rec.count === 3 && rec.handed === 450 && rec.how === "bank" && rec.diff === 0 && rec.note === "" && rec.corrections === 0 && CU.custodyKey(DAY, DRIVER) === `custody:v1:${DAY}:${DRIVER}`, JSON.stringify(rec));
  assert("…kept four days in KV", CU.CUSTODY_KEEP_SEC === 4 * 24 * 3600 && puts.some(([k, o]) => k === CU.custodyKey(DAY, DRIVER) && o?.expirationTtl === 345600), JSON.stringify(puts.filter(([k]) => k.startsWith("custody:"))));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world(); day();
  graph.length = 0;
  const { r } = await hand(env, { amt: "400", how: "owner", note: "  خمسين ريال\nصرفتها بنزين  " });
  assert("he handed over LESS: «−50 ر.س (ناقص)» — to him…", r.action === "handed" && r.diff === -50 && textsTo(DRIVER_PHONE).at(-1) === [
    `وصل ✅ تسليم العهدة — ${LABEL}`, "الكاش المتوقع: 450 ر.س (3 تحصيلات)", "المسلَّم فعلاً: 400 ر.س", "الطريقة: تسليم لبراء", "الفرق: −50 ر.س (ناقص)", "وصلت لبراء.",
  ].join("\n"), textsTo(DRIVER_PHONE).at(-1));
  assert("…and to Baraa, with the collector's note on one line", JSON.stringify(textsTo(OWNER)) === JSON.stringify([[
    `💵 تسليم العهدة — عمر المجهلي — ${LABEL}`, "الكاش المتوقع: 450 ر.س (3 تحصيلات)", "المسلَّم فعلاً: 400 ر.س", "الطريقة: تسليم لبراء", "الفرق: −50 ر.س (ناقص)", "ملاحظته: خمسين ريال صرفتها بنزين", NO_ENTRY,
  ].join("\n")]), textsTo(OWNER).join("\n---\n"));
  assert("the note is kept with the handover", record(env).note === "خمسين ريال صرفتها بنزين" && record(env).how === "owner" && record(env).diff === -50);
}
{
  const env = world(); day();
  graph.length = 0;
  const { r } = await hand(env, { amt: "470.5", how: "bank" });
  assert("he handed over MORE: «+20.50 ر.س (زيادة)»", r.diff === 20.5 && textsTo(OWNER)[0].split("\n")[4] === "الفرق: +20.50 ر.س (زيادة)" && textsTo(OWNER)[0].split("\n")[2] === "المسلَّم فعلاً: 470.50 ر.س" && textsTo(DRIVER_PHONE).at(-1)!.includes("الفرق: +20.50 ر.س (زيادة)"), textsTo(OWNER)[0]);
  assert("the difference, pure: 0 → «مطابق»; the minus is U+2212; halalas kept; a rounding crumb is no difference", CU.differenceText(0) === "مطابق" && CU.differenceText(-50) === "−50 ر.س (ناقص)" && CU.differenceText(-50).charCodeAt(0) === 0x2212
    && CU.differenceText(20.5) === "+20.50 ر.س (زيادة)" && CU.differenceText(0.004) === "مطابق" && CU.differenceText(-0.01) === "−0.01 ر.س (ناقص)");
  const env2 = world(); day();
  const zero = await hand(env2, { amt: "0", how: "owner" });
  assert("«0» is an amount: nothing handed over of 450 → «−450 ر.س (ناقص)»", zero.r.action === "handed" && zero.r.diff === -450 && record(env2).handed === 0);
  assert("the amount as a phone writes it: «٤٥٠», «450,5», « 450 »", CU.parseCustodyAmount("٤٥٠") === 450 && CU.parseCustodyAmount("450,5") === 450.5 && CU.parseCustodyAmount(" 450 ") === 450 && CU.parseCustodyAmount("۴۵۰٫۲۵") === 450.25 && CU.parseCustodyAmount(450) === 450);
}

// ================================================================ هـ5
console.log("\n[هـ5] a second handover the same day is a correction that names the earlier figures");
{
  const env = world(); day();
  await hand(env, { amt: "400", how: "bank" });
  setRiyadh(`${DAY} 15:30`); graph.length = 0;
  const { r } = await hand(env, { amt: "450", how: "owner", note: "لقيت الخمسين" });
  assert("the second handover is read (a fresh form, a fresh token)", r.action === "handed" && r.diff === 0, JSON.stringify(r));
  assert("to Baraa: a correction — the handover of 14:00, what it said, then the new figures", JSON.stringify(textsTo(OWNER)) === JSON.stringify([[
    `💵 تسليم العهدة — عمر المجهلي — ${LABEL}`,
    "🔁 تصحيح لتسليم سابق اليوم (14:00): المسلَّم 400 ر.س — إيداع بنكي — المتوقع 450 ر.س — الفرق −50 ر.س (ناقص)",
    "الكاش المتوقع: 450 ر.س (3 تحصيلات)", "المسلَّم فعلاً: 450 ر.س", "الطريقة: تسليم لبراء", "الفرق: مطابق", "ملاحظته: لقيت الخمسين", NO_ENTRY,
  ].join("\n")]), textsTo(OWNER).join("\n---\n"));
  assert("the day's record is the latest handover, and counts the one before it", record(env).handed === 450 && record(env).how === "owner" && record(env).at === ms(`${DAY} 15:30`) && record(env).corrections === 1);
  // the next day is a new handover, not a correction
  setRiyadh(`${NEXT} 14:00`); openWindow(env, DRIVER_PHONE); graph.length = 0;
  await hand(env, { amt: "55", how: "bank" });
  assert("the next day's handover is no correction (its expected cash: tonight's 55)", textsTo(OWNER).length === 1 && !textsTo(OWNER)[0].includes("تصحيح") && textsTo(OWNER)[0].includes("الكاش المتوقع: 55 ر.س (تحصيل واحد)") && record(env, NEXT).corrections === 0 && record(env, DAY).handed === 450, textsTo(OWNER)[0]);
}

// ================================================================ هـ6
console.log("\n[هـ6] the expected cash is read again when he answers: the reply's figure is the one reported");
{
  const env = world(); day();
  await start(env);
  const f = flowsTo(DRIVER_PHONE)[0];
  assert("the form showed 450 from three collections", dataOf(f).exp === "الكاش المتوقع معك اليوم: 450 ر.س — 3 تحصيلات");
  pay(`${DAY} 14:20`, 50);                                    // one more collection before he fills the form
  setRiyadh(`${DAY} 14:40`); graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { amt: "450", how: "bank" });
  assert("a collection made after the form was sent counts: expected 500, so 450 is short by 50", r.expected === 500 && r.diff === -50 && record(env).expected === 500 && record(env).count === 4, JSON.stringify(r));
  assert("…and both messages say both figures: «500 ر.س (4 تحصيلات) — كان 450 ر.س (3 تحصيلات) لما أُرسل النموذج»", textsTo(OWNER)[0].split("\n")[1] === "الكاش المتوقع: 500 ر.س (4 تحصيلات) — كان 450 ر.س (3 تحصيلات) لما أُرسل النموذج"
    && textsTo(DRIVER_PHONE)[0].split("\n")[1] === "الكاش المتوقع: 500 ر.س (4 تحصيلات) — كان 450 ر.س (3 تحصيلات) لما أُرسل النموذج" && textsTo(OWNER)[0].includes("الفرق: −50 ر.س (ناقص)"), textsTo(OWNER)[0]);
  assert("a figure that did not move is written once", !CU.custodyLines({ expected: 450, count: 3, handed: 450, how: "bank" })[0].includes("كان") && CU.custodyLines({ expected: 450, count: 3, handed: 450, how: "bank" })[0] === "الكاش المتوقع: 450 ر.س (3 تحصيلات)");
}
{
  const env = world(); day();
  await start(env);
  const f = flowsTo(DRIVER_PHONE)[0];
  graph.length = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/json/2/x_payment/")) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "boom" }), { status: 500 });
    return real(input as any, init);
  }) as typeof fetch;
  let r: any;
  try { r = await reply(env, DRIVER_PHONE, tokenOf(f), { amt: "400", how: "bank" }); } finally { globalThis.fetch = real; }
  assert("the collections cannot be read again: the handover is still kept and reported, against the figure the form showed — and Baraa is told so", r.action === "handed" && r.expected === 450 && r.diff === -50 && record(env).handed === 400
    && JSON.stringify(textsTo(OWNER)) === JSON.stringify([[`💵 تسليم العهدة — عمر المجهلي — ${LABEL}`, "الكاش المتوقع: 450 ر.س (3 تحصيلات)", "المسلَّم فعلاً: 400 ر.س", "الطريقة: إيداع بنكي", "الفرق: −50 ر.س (ناقص)", "⚠️ تعذّرت قراءة التحصيلات الآن: المتوقع هو ما ظهر في النموذج.", NO_ENTRY].join("\n")]), textsTo(OWNER).join("\n---\n"));
}

// ================================================================ هـ7
console.log("\n[هـ7] bad values refuse the form: nothing kept, one message, a fresh form");
{
  const p = CU.parseCustodyAmount;
  assert("an amount: a number ≥ 0 with at most two decimals — «0», «450», «450.5», «450.25»", p("0") === 0 && p("450") === 450 && p("450.5") === 450.5 && p("450.25") === 450.25);
  assert("anything else is not one: empty, a word, negative, three decimals, a sign, a unit", ["", " ", undefined, null, "abc", "-5", "−5", "450.255", "1,234", "+450", "450 ر.س", "4e2", "."].every((v) => p(v) === "invalid"));
  assert("the way: «bank» or «owner», nothing else", CU.parseCustodyHow("bank") === "bank" && CU.parseCustodyHow("owner") === "owner" && ["", undefined, null, "cash", "Bank", "إيداع بنكي", 1].every((v) => CU.parseCustodyHow(v) === "invalid"));
}
{
  const env = world(); day();
  await start(env);
  const f = flowsTo(DRIVER_PHONE)[0];
  graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { amt: "-5", how: "bank" });
  const again = flowsTo(DRIVER_PHONE);
  assert("a negative amount: refused — nothing kept, nothing to Baraa", r.action === "invalid" && JSON.stringify(r.problems) === JSON.stringify(["amt"]) && record(env) === null && sentTo(OWNER).length === 0, JSON.stringify(r));
  assert("…ONE message: it says what is wrong, and carries a fresh form with today's figure", sentTo(DRIVER_PHONE).length === 1 && again.length === 1 && bodyOf(again[0]) === ["⚠️ ما انحفظ شيء من النموذج:", "• المبلغ المسلَّم رقم (صفر أو أكثر) بخانتين عشريتين على الأكثر.", "عبّه من جديد ثم «إرسال» 👇"].join("\n")
    && tokenOf(again[0]) !== tokenOf(f) && dataOf(again[0]).exp === "الكاش المتوقع معك اليوم: 450 ر.س — 3 تحصيلات", bodyOf(again[0]));
  const old = await reply(env, DRIVER_PHONE, tokenOf(f), { amt: "450", how: "bank" });
  assert("…the refused form itself is spent", old.action === "duplicate" && record(env) === null);
  graph.length = 0;
  const noWay = await reply(env, DRIVER_PHONE, tokenOf(again[0]), { amt: "450" });
  assert("no way chosen: refused, naming the two ways", noWay.action === "invalid" && JSON.stringify(noWay.problems) === JSON.stringify(["how"]) && record(env) === null && bodyOf(flowsTo(DRIVER_PHONE)[0]).split("\n")[1] === "• اختر طريقة التسليم: «إيداع بنكي» أو «تسليم لبراء».", bodyOf(flowsTo(DRIVER_PHONE)[0]));
  const both = await reply(env, DRIVER_PHONE, tokenOf(flowsTo(DRIVER_PHONE)[0]), { amt: "450.255", how: "cash" });
  assert("both wrong: both are said; a way the form does not offer is not a way", both.action === "invalid" && JSON.stringify(both.problems) === JSON.stringify(["amt", "how"]) && bodyOf(flowsTo(DRIVER_PHONE).at(-1)).split("\n").length === 4 && record(env) === null);
  const empty = await reply(env, DRIVER_PHONE, tokenOf(flowsTo(DRIVER_PHONE).at(-1)), { amt: "", how: "bank" });
  assert("an empty amount is not zero: refused", empty.action === "invalid" && record(env) === null);
  const ok = await reply(env, DRIVER_PHONE, tokenOf(flowsTo(DRIVER_PHONE).at(-1)), { amt: "450", how: "bank" });
  assert("…and the fresh form, filled right, is kept", ok.action === "handed" && record(env).handed === 450 && sentTo(OWNER).length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ8
console.log("\n[هـ8] the token: the number it was sent to, the day it was sent, once");
{
  const env = world(); day();
  await start(env);
  const f = flowsTo(DRIVER_PHONE)[0], token = tokenOf(f);
  assert("the token is cu1.<day>.<collector>.<random>, kept with the number, the day and what the form showed", /^cu1\.20261003\.603\.[0-9a-f]{18}$/.test(token) && CU.isCustodyToken(token) && !CU.isCustodyToken("cl1.20261003.603.aa") && !CU.isCustodyToken("")
    && (() => { const t = JSON.parse(env.MSG_DEDUP.store.get(CU.custodyTokenKey(token))); return t.to === DRIVER_PHONE && t.day === DAY && t.collectorId === DRIVER && t.expected === 450 && t.count === 3; })());
  graph.length = 0;
  const other = await reply(env, COLL_PHONE, token, { amt: "450", how: "bank" });
  assert("the same token from ANOTHER number (another collector's): nothing read, nothing kept, one line to that number", other.action === "unknown" && record(env) === null && record(env, DAY, COLL) === null && JSON.stringify(textsTo(COLL_PHONE)) === JSON.stringify([CU.CUSTODY_UNKNOWN_TEXT]) && sentTo(OWNER).length === 0);
  const made = await reply(env, DRIVER_PHONE, "cu1.20261003.603.000000000000000000", { amt: "450", how: "bank" });
  assert("a token the worker never issued: nothing kept", made.action === "unknown" && record(env) === null);
  const ok = await reply(env, DRIVER_PHONE, token, { amt: "450", how: "bank" });
  graph.length = 0;
  const twice = await reply(env, DRIVER_PHONE, token, { amt: "100", how: "owner" });
  assert("a second use of the token: not kept again — the handover stays 450 — one line, nothing more to Baraa", ok.action === "handed" && twice.action === "duplicate" && record(env).handed === 450 && record(env).corrections === 0 && JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([CU.CUSTODY_USED_TEXT]) && sentTo(OWNER).length === 0);
}
{
  const env = world(`${DAY} 23:40`); day();
  await start(env);
  const f = flowsTo(DRIVER_PHONE)[0];
  setRiyadh(`${NEXT} 00:20`); graph.length = 0;
  const r = await reply(env, DRIVER_PHONE, tokenOf(f), { amt: "450", how: "bank" });
  assert("a form sent yesterday and filled after midnight: nothing kept on either day, one line, nothing to Baraa", r.action === "expired" && record(env, DAY) === null && record(env, NEXT) === null && JSON.stringify(textsTo(DRIVER_PHONE)) === JSON.stringify([CU.CUSTODY_EXPIRED_TEXT]) && sentTo(OWNER).length === 0);
  // through the webhook, by the token's prefix
  const env2 = world(); day();
  await say(env2, DRIVER_PHONE, text("عهدة"));
  const f2 = flowsTo(DRIVER_PHONE)[0];
  const res = await say(env2, DRIVER_PHONE, nfm(tokenOf(f2), { amt: "450", how: "bank", note: "" }));
  assert("the Flow's reply through the webhook is routed by its «cu1.» token: the handover is kept, and no price row is written from it", res.status === 200 && record(env2)?.handed === 450 && rows("x_daily_price").length === 1 && rows("x_price_offer").length === 1, JSON.stringify(record(env2)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ9
console.log("\n[هـ9] no accounting entry and no Odoo write; no purchase price, cost or profit anywhere");
{
  const env = world(); day();
  const tables = ["x_payment", "x_invoice", "x_daily_order", "x_daily_order_line", "account.move", "account.move.line", "account.payment", "account.bank.statement.line", "x_daily_price", "x_price_offer", "hr.employee", "product.template"];
  const before = JSON.stringify(tables.map((t) => rows(t)));
  odooLog.length = 0; graph.length = 0;
  await hand(env, { amt: "400", how: "bank", note: "ناقص خمسين" });
  await hand(env, { amt: "x", how: "bank" });
  await hand(env, { amt: "450", how: "owner" });
  const w = odooWrites();
  assert("a handover, a refused form and a correction: the ONLY writes in Odoo are the gateway's own record of each message (an x_wa_message row, and the number's conversation in Discuss)",
    w.length > 0 && w.every(gatewayRecord), JSON.stringify([...new Set(w.filter((c: any) => !gatewayRecord(c)).map((c: any) => `${c.model}.${c.method}`))]));
  assert("…one x_wa_message row a message sent, each naming its purpose", w.filter((c: any) => c.model === "x_wa_message").length === graph.length
    && rows("x_wa_message").every((m: any) => /"purpose":"(custody_form|owner_team_note)"/.test(String(m.x_debug_payload))), `${w.filter((c: any) => c.model === "x_wa_message").length} / ${graph.length}`);
  assert("NO accounting entry: no account.move, no account.payment, no statement line — and no payment, invoice or order row changed", !odooLog.some((c: any) => /^account\./.test(c.model)) && JSON.stringify(tables.map((t) => rows(t))) === before);
  assert("…and Baraa is told so in every handover's message", textsTo(OWNER).length === 2 && textsTo(OWNER).every((t: string) => t.split("\n").at(-1) === NO_ENTRY) && CU.CUSTODY_NO_ENTRY_TEXT === NO_ENTRY);
  assert("the handover lives in KV alone", record(env)?.handed === 450 && [...env.MSG_DEDUP.store.keys()].filter((k: string) => k.startsWith("custody:")).length === 1);
  // ---- his own collections, and nothing of the purchase side
  const reads = odooLog.filter((c: any) => /^(search_read|search|read)$/.test(c.method));
  const named = (c: any): string[] => [...(c.body?.fields ?? []), ...((c.body?.domain ?? []) as unknown[]).filter(Array.isArray).map((t: any) => String(t[0]))];
  assert("no purchase or pricing model is read (the purchase prices, the offers, the day's prices, the settings, the costs, the purchase lists, the supplier dues)", !reads.some((c: any) => /^(x_daily_price|x_price_offer|x_price_day|x_price_day_line|x_pricing_config|x_operating_cost|x_purchase_list|x_supplier_due|purchase\.|account\.)/.test(c.model)), JSON.stringify([...new Set(reads.map((c: any) => c.model))]));
  assert("of x_payment the worker asks the amount and its invoice alone; no field of a price, a cost, a profit or a margin is asked of Odoo", !reads.some((c: any) => named(c).some((f) => /price|cost|profit|margin|purchase/i.test(f)))
    && JSON.stringify([...new Set(reads.filter((c: any) => c.model === "x_payment").flatMap((c: any) => c.body.fields))].sort()) === JSON.stringify(["id", "x_amount", "x_invoice_id"]), JSON.stringify([...new Set(reads.flatMap(named))]));
  const everything = JSON.stringify(graph);
  assert("nothing sent carries a purchase price, a cost or a profit: not 77.77, 88.88, nor «شراء», «ربح», «تكلفة», «هامش»", graph.length >= 7 && !/77\.77|88\.88|شراء|ربح|تكلفة|هامش/.test(everything));
  const code = srcOf("custody-form.ts").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert("src/custody-form.ts names no price, cost or profit field, reaches no accounting model and makes no create / write call", !/x_[a-z_]*(price|cost|profit|margin)/i.test(code) && !/account\.(move|payment)|"create"|"write"|"unlink"/.test(code) && !/from "\.\/(accounting|pricing-engine|prices|sale-accounting|purchase-accounting)"/.test(code));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ10
console.log("\n[هـ10] the trial to Baraa, its hook, and the purposes");
{
  const env = world(`${DAY} 16:00`); day();
  closeOwnerWindow(env);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: 3, x_processed_at: utc(`${PREV} 01:00`), x_status: "received" });
  const shut = await quiet(() => CU.sendCustodyFormTest(env));
  assert("Baraa's window closed: the trial does not go, nothing is held, and the day is not spent", shut.sent === false && shut.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(shut));
  openWindow(env, OWNER);
  odooLog.length = 0;
  const t = await quiet(() => CU.sendCustodyFormTest(env));
  const f = flowsTo(OWNER)[0], d = dataOf(f);
  assert("the trial: ONE message, to Baraa's number alone, marked «🧪 تجربة» — showing today's real cash collections of everyone (539 ر.س from five)", t.sent === true && t.expected === 539 && t.count === 5 && graph.length === 1 && graph[0].to === OWNER
    && bodyOf(f).startsWith(`🧪 تجربة — 💵 تسليم العهدة — ${LABEL}`) && d.t === `🧪 تجربة — تسليم العهدة — ${LABEL}` && d.exp === "الكاش المتوقع معك اليوم: 539 ر.س — 5 تحصيلات", bodyOf(f));
  assert("…read-only: nothing written in Odoo but the message's own record", odooWrites().every(gatewayRecord));
  const again = await quiet(() => CU.sendCustodyFormTest(env));
  assert("a second trial the same day is refused", again.sent === false && again.reason === "already_today" && graph.length === 1);
  const r = await reply(env, OWNER, tokenOf(f), { amt: "500", how: "bank", note: "تجربة" });
  assert("his reply is answered with the figures, marked as a trial…", r.action === "test" && r.diff === -39 && bodyOf(sentTo(OWNER).at(-1)) === [
    `🧪 تجربة — وصل ✅ تسليم العهدة — ${LABEL}`, "الكاش المتوقع: 539 ر.س (5 تحصيلات)", "المسلَّم فعلاً: 500 ر.س", "الطريقة: إيداع بنكي", "الفرق: −39 ر.س (ناقص)", "(تجربة: لم يُحفظ شيء، ولم يُرسل تقرير)", "ملاحظتك: تجربة",
  ].join("\n"), bodyOf(sentTo(OWNER).at(-1)));
  assert("…and keeps NOTHING: no handover in KV, no write in Odoo but the message's own, nothing to anyone else, and no «تسليم العهدة — براء» report", ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("custody:"))
    && odooWrites().every(gatewayRecord) && graph.every((b: any) => b.to === OWNER) && graph.length === 2);
  const twice = await reply(env, OWNER, tokenOf(f), { amt: "1", how: "bank" });
  assert("the trial's token is read once too", twice.action === "duplicate");
  // the collections cannot be read: the trial shows 0
  setRiyadh(`${NEXT} 16:00`); openWindow(env, OWNER);
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("/json/2/x_payment/")) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "boom" }), { status: 500 });
    return real(input as any, init);
  }) as typeof fetch;
  let zero: any;
  try { zero = await quiet(() => CU.sendCustodyFormTest(env)); } finally { globalThis.fetch = real; }
  assert("the collections cannot be read: the trial still goes, showing 0", zero.sent === true && zero.expected === 0 && dataOf(flowsTo(OWNER).at(-1)).exp === "الكاش المتوقع معك اليوم: 0 ر.س — لا تحصيلات");
  // the hook
  const hookEnv = { ...env, ODOO_HOOK_TOKEN: "HOOK" };
  const post = (q: string, e: any = hookEnv) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/custody-form-test${q}`, { method: "POST" }), e, ctx));
  const no = await post("?token=nope"), none = await post(""), unset = await post("?token=", env);
  assert("POST /odoo/hook/custody-form-test without the hook's token: 401, nothing sent", no.status === 401 && none.status === 401 && unset.status === 401);
  const yes = await post("?token=HOOK");
  const body = await yes.json() as any;
  assert("…with it: the worker's own answer (today's trial already went)", yes.status === 200 && body.ok === true && body.sent === false && body.reason === "already_today", JSON.stringify(body));
  setRiyadh("2026-10-05 16:00"); openWindow(env, OWNER);
  const next = await (await post("?token=HOOK")).json() as any;
  assert("…and the next day it sends one", next.ok === true && next.sent === true && flowsTo(OWNER).length === 3, JSON.stringify(next));
  assert("the trial script knows the hook", /custody: "custody-form-test"/.test(readFileSync(new URL("../scripts/s55-20261005-trial.mjs", import.meta.url), "utf8")));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  assert("custody_form is the team's (operational, never critical); custody_form_test is the owner's trial; Baraa's report is his team's note", PURPOSES.custody_form?.kind === "operational" && !PURPOSES.custody_form.critical && PURPOSES.custody_form_test?.kind === "operational"
    && CU.CUSTODY_PURPOSE === "custody_form" && CU.CUSTODY_TEST_PURPOSE === "custody_form_test" && CU.CUSTODY_OWNER_PURPOSE === "owner_team_note" && CU.CUSTODY_ROLE === "collector");
  const x = { kind: "session" as const, body: { type: "text", text: { body: "x" } } };
  const toCollector = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: "custody_form_test", to: "+" + DRIVER_PHONE, content: x })));
  const toOwner = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: "custody_form", to: "+" + OWNER, content: x })));
  assert("the gateway refuses the trial's purpose to any number but Baraa's, and the collector's form to Baraa's", toCollector?.action === "refused" && toOwner?.action === "refused" && graph.length === 0, JSON.stringify([toCollector, toOwner]));
  const src = srcOf("custody-form.ts");
  assert("the form is never held: noHold on its send, and no template", /noHold: true,/.test(src) && !/kind: "template"/.test(src));
  const idx = srcOf("index.ts");
  assert("the Flow's reply is routed by its token before the price form's reader", idx.indexOf("isCustodyToken(msg.flow.token") > 0 && idx.indexOf("isCustodyToken(msg.flow.token") < idx.indexOf("handlePriceFlowReply(env, msg, ctx)"));
}

done();
