// § 57 هـ (2026-10-05) — the customer's «⚠️ عندي ملاحظة» (the complaint form): the form, its three
// doors, the ONE x_complaint row, and Baraa's «تعويض بالطلب القادم» / «إشعار دائن» / «رفض».
//
//   [هـ1]  utak_complaint_v1: the JSON at Meta against what the worker sends — the keys, the components,
//          Meta's limit on every text; the kinds and the decisions against Odoo's (scripts/lib/s57-odoo.mjs)
//   [هـ2]  his delivered orders: his, delivered in the last seven days, the newest first, «الطلب كله»,
//          the delivered lines — never a simulation's, never another customer's; sixty options at most
//   [هـ3]  the door of the words: «شكوى» / «مشكلة»; with nothing delivered in seven days, or a form that
//          cannot go, the complaint of before, word for word
//   [هـ4]  the door of Claude's «complaint» intent
//   [هـ5]  the door of the delivery's text: «⚠️ عندي ملاحظة», on the free text alone
//   [هـ6]  «إرسال»: ONE row with every field, the photo, the two messages
//   [هـ7]  what refuses the form as a whole, and the fresh form
//   [هـ8]  the token: the number it was sent to, once; a row that could not be made
//   [هـ9]  the three decisions: what each writes and says — and nothing else
//   [هـ10] a second tap, another number's tap, a complaint closed in Odoo, a tap that could not finish
//   [هـ11] the trial to Baraa, its hook, the purposes, privacy
//   [هـ12] the guide
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s57-complaint.test.mts

import { readFileSync } from "node:fs";
import { CUST2, CUST2_PHONE, OWNER, WH_PHONE, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED_PHONE, C1, C1_PHONE, DAY, assert, done, dp, fresh, market, rejected, setExtract } from "./s46-kit.mts";

// ---------------------------------------------------------------- Meta's media, Claude, and an Odoo that fails
const MEDIA_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4]);
const PHOTO_B64 = Buffer.from(MEDIA_BYTES).toString("base64");
const claudeCalls: any[] = [];
/** A model, or «model.method», whose calls fail (Odoo down for it). */
let odooDown = "";
/** x_complaint.create answers with no id. */
let emptyCreate = false;
let metaRefusesHeader = false, metaRefusesFlow = false, metaRefusesButtons = false;
/** What Meta refused (it never reaches the harness's `graph`). */
const refusedByMeta: any[] = [];
/** The media Meta was asked for. */
const mediaAsked: string[] = [];
let sendSeq = 0;
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const mm = /graph\.facebook\.com\/[^/]+\/(CMPPH_[A-Z0-9_]+)$/.exec(url);
  if (mm) {
    mediaAsked.push(mm[1]);
    if (mm[1].startsWith("CMPPH_BAD")) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    return new Response(JSON.stringify({ url: `https://media.test/${mm[1]}`, mime_type: "image/jpeg", file_size: MEDIA_BYTES.length }), { status: 200 });
  }
  if (url.startsWith("https://media.test/CMPPH_")) return new Response(MEDIA_BYTES, { status: 200 });
  if (url.includes("graph.facebook.com") && init?.body) {
    const b = JSON.parse(init.body);
    if ((metaRefusesHeader && b?.interactive?.header) || (metaRefusesFlow && b?.interactive?.type === "flow") || (metaRefusesButtons && b?.interactive?.type === "button")) {
      refusedByMeta.push(b);
      return new Response(JSON.stringify({ error: { message: "(#131009) Parameter value is not valid", code: 131009 } }), { status: 400 });
    }
    // a message id of its own for every send, as Meta gives: the tests here empty `graph` between steps,
    // and a repeated id would read as a send already recorded (§ 36)
    const res = await kitFetch(input as any, init);
    return res.ok ? new Response(JSON.stringify({ messages: [{ id: `wamid.C${++sendSeq}` }] }), { status: 200 }) : res;
  }
  if (url.includes("anthropic.com")) claudeCalls.push(JSON.parse(init.body));
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && odooDown && (odooDown === m[1] || odooDown === `${m[1]}.${m[2]}`)) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "boom" }), { status: 500 });
  if (m && emptyCreate && m[1] === "x_complaint" && m[2] === "create") return new Response("[]", { status: 200 });
  return kitFetch(input as any, init);
}) as typeof fetch;

const CF = await import("../src/complaint-form.ts");
const COMPLAINT = await import("../src/complaint.ts");
const ROUTER = await import("../src/router.ts");
const V6 = await import("../src/odoo-v6-append.ts");
const TEAM = await import("../src/team.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const { clearTemplateCache } = await import("../src/templates.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s57-complaint-flow.mjs");
// @ts-ignore — plain .mjs helpers
const ODOO = await import("../scripts/lib/s57-odoo.mjs");

const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const count = (s: string) => [...String(s)].length;
const NAME = "مطعم الوادي";
const O_NEW = 8003, O_MID = 8002, O_OLD = 8001, O_STALE = 8000, O_SIM_A = 8010, O_SIM_B = 8011, O_OTHER = 8020, O_OPEN = 8030, O_UNDATED = 8040;
const L_TOM = 4031, L_CUC = 4032, L_POT = 4021, L_ONI = 4022, L_ZERO = 4023, L_OLD = 4011, L_OTHER = 4051;

const ord = (id: number, customer: number, state: string, deliveredRiyadh: string | false, extra: Record<string, unknown> = {}) =>
  seed("x_daily_order", { id, x_customer_id: customer, x_state: state, x_order_date: DAY, x_delivered_at: deliveredRiyadh ? utc(deliveredRiyadh) : false, x_created_via: "whatsapp", x_utak_simulation: false, x_is_simulation: false, ...extra });
const line = (id: number, orderId: number, product: number, packaging: number, qty: number, extra: Record<string, unknown> = {}) =>
  seed("x_daily_order_line", { id, x_order_id: orderId, x_product_tmpl_id: product, x_packaging_id: packaging, x_quantity: qty, x_unit_price: 31.31, x_status: "purchased", ...extra });

/**
 * The customer's orders at 14:00 on 3 Oct — seeded out of order, as Odoo may hand them:
 *   8003  delivered 3 Oct 08:00           tomato × 3, cucumber × 5
 *   8002  delivered 1 Oct 01:30 (Riyadh)  potato × 2.5 — and an «unavailable» onion, and a line with nothing delivered
 *   8001  closed (paid), delivered 26 Sept 15:00 — one hour inside the seven days: tomato × 10
 *   8000  delivered 26 Sept 13:00 — one hour outside them
 *   8010 / 8011  flagged x_utak_simulation / x_is_simulation
 *   8030  still on its way (a delivery moment on it by mistake)
 *   8040  delivered, with no delivery moment on it
 * and 8020, another customer's, delivered yesterday.
 */
function world(riyadh = `${DAY} 14:00`): any {
  const env = fresh(riyadh); setExtract(null);
  claudeCalls.length = 0; mediaAsked.length = 0; refusedByMeta.length = 0; odooDown = ""; emptyCreate = false; metaRefusesHeader = false; metaRefusesFlow = false; metaRefusesButtons = false;
  ord(O_MID, C1, "delivered", "2026-10-01 01:30");
  line(L_ZERO, O_MID, 1, 11, 0); line(L_ONI, O_MID, 4, 41, 4, { x_status: "unavailable" }); line(L_POT, O_MID, 3, 31, 2.5);
  ord(O_SIM_A, C1, "delivered", "2026-10-02 10:00", { x_utak_simulation: true }); line(4041, O_SIM_A, 1, 11, 1);
  ord(O_NEW, C1, "delivered", `${DAY} 08:00`);
  line(L_CUC, O_NEW, 2, 21, 5); line(L_TOM, O_NEW, 1, 11, 3);
  ord(O_STALE, C1, "delivered", "2026-09-26 13:00"); line(4001, O_STALE, 1, 11, 7);
  ord(O_OTHER, CUST2, "delivered", "2026-10-02 09:00"); line(L_OTHER, O_OTHER, 2, 21, 6);
  ord(O_OLD, C1, "closed", "2026-09-26 15:00"); line(L_OLD, O_OLD, 1, 11, 10);
  ord(O_SIM_B, C1, "delivered", "2026-10-02 11:00", { x_is_simulation: true }); line(4042, O_SIM_B, 1, 11, 1);
  ord(O_OPEN, C1, "in_delivery", "2026-10-03 09:00"); line(4043, O_OPEN, 1, 11, 2);
  ord(O_UNDATED, C1, "delivered", false); line(4044, O_UNDATED, 1, 11, 2);
  // an item with a reference reads «[CUC-01] خيار» in a many2one
  table("product.template").get(2)!.name = "[CUC-01] خيار";
  // prices that must never be read or sent here
  dp(1, 11, 77.77); market(1, 11, 88.88);
  openWindow(env, C1_PHONE); openWindow(env, CUST2_PHONE);
  return env;
}
const c1 = { partnerId: C1, name: NAME, whatsapp: "+" + C1_PHONE };
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map(bodyOf);
const complaints = (): any[] => rows("x_complaint") as any[];
const tokens = (env: any): any[] => [...env.MSG_DEDUP.store.entries()].filter(([k]: [string]) => k.startsWith("complaint_t:v1:")).map(([, v]: [string, string]) => JSON.parse(v));
/** Baraa's notes: the button messages that carry the three decisions. */
const ownerNotes = () => sentTo(OWNER).filter((b: any) => b?.interactive?.type === "button" && /^cmp_comp_/.test(b.interactive.action.buttons[0]?.reply?.id ?? ""));
const buttonsOf = (b: any): Array<{ id: string; title: string }> => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply);
const photo = (id: string) => [{ id, mime_type: "image/jpeg", file_name: "note.jpg", sha256: "x" }];
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => CF.handleComplaintReply(env, { from: "+" + from, messageId: `wamid.CM${++wamid}`, flow: { token, values } }, undefined, now));
const tap = (env: any, id: string, from = OWNER) => quiet(() => CF.handleComplaintDecision(env, id, "+" + from));
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (t: string) => ({ type: "text", text: { body: t } });
const button = (id: string, title = "x") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
const good = { item: `${O_NEW}:${L_TOM}`, kind: "damaged", qty: "2", photo: photo("CMPPH_F1"), note: "الكرتون مهروس" };
/** The form sent to the customer, and its reply: a complaint. */
async function note(env: any, values: Record<string, unknown> = good, opts: Record<string, unknown> = {}): Promise<any> {
  const sent = await quiet(() => CF.sendComplaintForm(env, c1, opts));
  const f = flowsTo(C1_PHONE).at(-1);
  const r = await reply(env, C1_PHONE, tokenOf(f), values);
  return { sent, f, r, id: r.complaintId, row: complaints().at(-1) };
}
/** The gateway writes a send's record behind the send: wait for what is still on its way before counting writes. */
const settle = () => new Promise((r) => setTimeout(r, 20));
const odooWrites = () => odooLog.filter((c: any) => !/^(search_read|search|search_count|read|fields_get)$/.test(c.method));
/** The gateway's own record of a send (§ 36): its x_wa_message row, and the number's conversation in Discuss. */
const gatewayRecord = (c: any): boolean => (c.model === "x_wa_message" && c.method === "create") || /^discuss\.channel(\.member)?$/.test(c.model)
  || (c.model === "res.partner" && c.method === "write" && Object.keys(c.body?.vals ?? {}).join() === "x_wa_channel_id");
/** Everything a compensation, a credit note or a payment would touch. */
const books = () => JSON.stringify(["x_daily_order", "x_daily_order_line", "x_invoice", "x_payment", "account.move", "account.move.line", "account.payment", "sale.order"].map((t) => rows(t)));
const OLD_REPLY = "نعتذر عن الإزعاج 🙏 وصلنا ملاحظتك وسنتواصل معك خلال ساعة لحل المشكلة.";
const MANUAL = "التعويض والإشعار الدائن لا ينفّذهما النظام: الزر يسجّل قرارك ويبلّغ العميل فقط، والتنفيذ يدوي (الدليل: «الإشعار الدائن»).";

// ================================================================ هـ1
console.log("\n[هـ1] utak_complaint_v1 at Meta is the form the worker fills: one screen, no endpoint");
{
  const json = LIB.buildComplaintFlowJson();
  const s = json.screens[0], c = s.layout.children, L = LIB.COMPLAINT_LIMITS;
  assert("ONE screen, COMPLAINT_A — the one the worker opens — terminal; Flow JSON 6.0; exported as FLOW for the Meta script", json.screens.length === 1 && s.id === "COMPLAINT_A" && LIB.COMPLAINT_SCREEN === CF.COMPLAINT_FLOW_SCREEN && s.terminal === true && s.success === true && json.version === "6.0"
    && LIB.FLOW.key === "complaint" && LIB.FLOW.name === "utak_complaint_v1" && LIB.FLOW.build === LIB.buildComplaintFlowJson && LIB.FLOW.first === "COMPLAINT_A");
  assert("no endpoint and no Form wrapper: no data_api_version, no data_exchange, no «Form» component", !("data_api_version" in json) && !JSON.stringify(json).includes("data_exchange") && LIB.screenComponents(s).every((x: any) => x.type !== "Form"));
  assert("eight components (Meta allows fifty): the heading, the line, the order and item, the kind, the quantity, the photo, the note, «إرسال»", LIB.screenComponents(s).length === 8 && 8 <= LIB.SCREEN_COMPONENTS_MAX
    && JSON.stringify(c.map((x: any) => x.type)) === JSON.stringify(["TextHeading", "TextBody", "Dropdown", "RadioButtonsGroup", "TextInput", "PhotoPicker", "TextArea", "Footer"]));
  assert("«الطلب والصنف»: item, ONE list for the order and its item, REQUIRED, its options from the data — nothing chosen for him", c[2].name === "item" && c[2].label === "الطلب والصنف" && c[2].required === true && c[2]["data-source"] === "${data.items}" && !("init-value" in c[2]) && count(c[2].label) <= L.dropdownLabel
    && c.filter((x: any) => x.type === "Dropdown").length === 1);
  assert("«نوع الملاحظة»: kind, REQUIRED, nothing chosen for him — the five kinds, each title within thirty characters", c[3].name === "kind" && c[3].label === "نوع الملاحظة" && c[3].required === true && !("init-value" in c[3]) && count(c[3].label) <= L.groupLabel
    && JSON.stringify(c[3]["data-source"]) === JSON.stringify([{ id: "damaged", title: "تالف" }, { id: "short", title: "ناقص" }, { id: "quality", title: "جودة" }, { id: "delay", title: "تأخير" }, { id: "other", title: "أخرى" }])
    && c[3]["data-source"].every((k: any) => count(k.title) <= L.optionTitle));
  assert("…the kinds are Odoo's own (x_complaint.x_kind), value and label", JSON.stringify(c[3]["data-source"].map((k: any) => [k.id, k.title])) === JSON.stringify(ODOO.KIND_OPTIONS) && JSON.stringify(Object.entries(CF.KIND_LABEL)) === JSON.stringify(ODOO.KIND_OPTIONS));
  assert("«الكمية المتأثرة»: qty, a number, OPTIONAL in the Flow (a delay has none), opened from the data", c[4].name === "qty" && c[4].label === "الكمية المتأثرة" && c[4]["input-type"] === "number" && c[4].required === false && c[4]["init-value"] === "${data.qty}" && count(c[4].label) <= L.inputLabel && count(c[4]["helper-text"]) <= L.inputHint && c[4]["helper-text"] !== "");
  assert("«صورة»: ONE PhotoPicker — optional in the Flow (the worker asks it of «تالف» and «جودة»), one photo at most, never pre-filled, not `required`", c[5].name === "photo" && c[5].label === "صورة" && c[5]["min-uploaded-photos"] === 0 && c[5]["max-uploaded-photos"] === 1 && c[5]["max-file-size-kb"] === 10240
    && !("required" in c[5]) && !("init-value" in c[5]) && c.filter((x: any) => x.type === "PhotoPicker").length === 1 && count(c[5].label) <= L.photoLabel && count(c[5].description) <= L.photoDescription && /إلزامية للتالف والجودة/.test(c[5].description));
  assert("«ملاحظة»: note, optional, opened from the data", c[6].name === "note" && c[6].label === "ملاحظة" && c[6].required === false && c[6]["init-value"] === "${data.note}" && count(c[6].label) <= L.inputLabel && count(c[6]["helper-text"]) <= L.inputHint);
  assert("«إرسال» completes with the five fields — the photo a top-level property of the payload, as Meta requires", c[7].label === "إرسال" && count(c[7].label) <= L.footer && c[7]["on-click-action"].name === "complete"
    && JSON.stringify(c[7]["on-click-action"].payload) === JSON.stringify({ item: "${form.item}", kind: "${form.kind}", qty: "${form.qty}", photo: "${form.photo}", note: "${form.note}" }));
  assert("the screen's title and the message's button are within Meta's thirty and twenty characters, and carry no emoji", count(s.title) <= L.screenTitle && count(LIB.COMPLAINT_CTA) <= L.cta && LIB.COMPLAINT_CTA === CF.COMPLAINT_CTA && !/\p{Extended_Pictographic}/u.test(LIB.COMPLAINT_CTA + s.title));
  assert("Meta's limits are the ones the test holds every text to", JSON.stringify(L) === JSON.stringify({ screenTitle: 30, heading: 80, body: 4096, footer: 35, inputLabel: 20, inputHint: 80, groupLabel: 30, dropdownLabel: 20, optionTitle: 30, optionDescription: 300, photoLabel: 80, photoDescription: 300, cta: 20, dropdownOptions: 200 }));
  assert("the screen declares five keys, each with an example within its limit", JSON.stringify(Object.keys(s.data).sort()) === JSON.stringify(["how", "items", "note", "qty", "t"]) && Object.values(s.data).every((v: any) => "__example__" in v)
    && s.data.items.type === "array" && s.data.items.__example__.every((x: any) => count(x.title) <= L.optionTitle && count(x.description) <= L.optionDescription && /^\d+:\d+$/.test(x.id)));
  const env = world();
  const r = await quiet(() => CF.sendComplaintForm(env, c1));
  const f = flowsTo(C1_PHONE)[0], d = dataOf(f);
  assert("every key the worker sends is declared, and every declared key is sent", r.sent === true && r.options === 7 && JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(s.data).sort()), JSON.stringify(d));
  assert("the heading and the line: within Meta's eighty and 4096 characters, neither empty", d.t === `عندي ملاحظة — ${NAME}` && count(d.t) <= L.heading && d.how === CF.COMPLAINT_HOW_TEXT && count(d.how) <= L.body && d.how !== "" && d.qty === "" && d.note === "");
  assert("every option: «order:line», a title within thirty characters, a description within three hundred", d.items.length === 7 && d.items.every((x: any) => /^\d+:\d+$/.test(x.id) && count(x.title) <= L.optionTitle && x.title !== "" && count(x.description) <= L.optionDescription && x.description !== ""), JSON.stringify(d.items));
  assert("the message opens utak_complaint_v1 on its screen with the data (navigate), under «عندي ملاحظة»", par(f).flow_id === CF.COMPLAINT_FLOW_ID && par(f).flow_action === "navigate" && par(f).flow_action_payload.screen === "COMPLAINT_A" && par(f).flow_message_version === "3"
    && par(f).flow_cta === "عندي ملاحظة" && bodyOf(f).length <= 1024);
  assert("…its text says what to do", bodyOf(f) === ["⚠️ عندي ملاحظة", `اضغط «عندي ملاحظة»: ${CF.COMPLAINT_HOW_TEXT}`].join("\n"), bodyOf(f));
  assert("the worker's limits are Meta's, and its sixty options the Flow's — far under a list's two hundred", CF.COMPLAINT_HEADING_MAX === L.heading && CF.COMPLAINT_OPTION_TITLE_MAX === L.optionTitle && CF.COMPLAINT_OPTION_DESCRIPTION_MAX === L.optionDescription
    && CF.COMPLAINT_OPTIONS_MAX === LIB.COMPLAINT_OPTIONS_MAX && LIB.COMPLAINT_OPTIONS_MAX === 60 && 60 <= L.dropdownOptions && CF.COMPLAINT_WHOLE_ID === LIB.COMPLAINT_WHOLE_ID && CF.COMPLAINT_WHOLE_TITLE === LIB.COMPLAINT_WHOLE_TITLE);
  assert("a name longer than the heading's eighty characters is cut", count(CF.complaintData({ ...c1, name: "م".repeat(90) }, []).t as string) === 80);
  assert("the kind → the older x_type is Odoo's map, and each is a value x_type has", JSON.stringify(CF.KIND_TO_TYPE) === JSON.stringify(ODOO.KIND_TO_TYPE) && Object.values(CF.KIND_TO_TYPE).every((t) => ["quality", "quantity", "delay", "staff_behavior", "pricing", "other"].includes(t as string)));
  assert("Baraa's three decisions are Odoo's own (x_complaint.x_decision), value and label — each title within a button's twenty characters", JSON.stringify(Object.values(CF.COMPLAINT_DECISIONS).map((x: any) => [x.value, x.title])) === JSON.stringify(ODOO.DECISION_OPTIONS)
    && JSON.stringify(Object.keys(CF.COMPLAINT_DECISIONS)) === JSON.stringify(["comp", "credit", "reject"]) && Object.values(CF.COMPLAINT_DECISIONS).every((x: any) => count(x.title) <= 20 && x.title.length <= 20));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ2
console.log("\n[هـ2] his delivered orders: his, in the last seven days, the newest first — never a simulation's, never another's");
{
  const env = world();
  const now = Date.now();
  const got = await quiet(() => CF.deliveredOrders(env, { partnerId: C1, sinceMs: now - 7 * 24 * 3600_000 }));
  assert("three orders, the NEWEST first whatever order Odoo hands them in: 8003 (3 Oct), 8002 (1 Oct), 8001 (26 Sept, closed)", JSON.stringify(got.map((o: any) => o.id)) === JSON.stringify([O_NEW, O_MID, O_OLD]), JSON.stringify(got.map((o: any) => o.id)));
  assert("…each with its Riyadh delivery day — 01:30 on 1 Oct is 30 Sept in UTC, and still 1 Oct", JSON.stringify(got.map((o: any) => o.day)) === JSON.stringify(["2026-10-03", "2026-10-01", "2026-09-26"]) && got[0].customerId === C1 && got[0].customer === NAME);
  assert("its lines in the order's own line order (by id), each with its item, packaging and DELIVERED quantity", JSON.stringify(got[0].lines) === JSON.stringify([{ id: L_TOM, productId: 1, product: "طماطم", packaging: "كرتون", quantity: 3 }, { id: L_CUC, productId: 2, product: "خيار", packaging: "جرم", quantity: 5 }]), JSON.stringify(got[0].lines));
  assert("a line he did not get is not listed: «unavailable», or nothing delivered of it", JSON.stringify(got[1].lines.map((l: any) => l.id)) === JSON.stringify([L_POT]) && got[1].lines[0].quantity === 2.5);
  assert("one hour inside the seven days is in (8001), one hour outside is not (8000)", got.some((o: any) => o.id === O_OLD) && !got.some((o: any) => o.id === O_STALE) && CF.COMPLAINT_DAYS === 7);
  assert("never a simulation's, by either flag (8010 x_utak_simulation, 8011 x_is_simulation)", !got.some((o: any) => o.id === O_SIM_A || o.id === O_SIM_B));
  assert("never another customer's (8020), nor an order still on its way (8030), nor one with no delivery moment (8040)", !got.some((o: any) => o.id === O_OTHER || o.id === O_OPEN || o.id === O_UNDATED));
  assert("an item's reference «[CUC-01]» is not part of its name", got[0].lines[1].product === "خيار");
  const d = dataOf((await quiet(() => CF.sendComplaintForm(env, c1)), flowsTo(C1_PHONE)[0]));
  assert("the list: under each order «الطلب كله» first (order:0), then a line an item", JSON.stringify(d.items.map((x: any) => x.id)) === JSON.stringify([`${O_NEW}:0`, `${O_NEW}:${L_TOM}`, `${O_NEW}:${L_CUC}`, `${O_MID}:0`, `${O_MID}:${L_POT}`, `${O_OLD}:0`, `${O_OLD}:${L_OLD}`]), JSON.stringify(d.items.map((x: any) => x.id)));
  assert("the titles: «#order · الطلب كله» and «#order · the item»", JSON.stringify(d.items.map((x: any) => x.title)) === JSON.stringify(["#8003 · الطلب كله", "#8003 · طماطم", "#8003 · خيار", "#8002 · الطلب كله", "#8002 · بطاطس", "#8001 · الطلب كله", "#8001 · طماطم"]), JSON.stringify(d.items.map((x: any) => x.title)));
  assert("an item's description: its whole name and packaging, the order, the delivery day, the quantity", d.items[1].description === "طماطم (كرتون) — الطلب #8003 — سُلّم 3 أكتوبر 2026 — الكمية 3" && d.items[4].description === "بطاطس (كرتون) — الطلب #8002 — سُلّم 1 أكتوبر 2026 — الكمية 2.5", d.items[4].description);
  assert("«الطلب كله»'s description: the order, the day, how many items, and what it is for", d.items[0].description === "الطلب #8003 — سُلّم 3 أكتوبر 2026 — عدد الأصناف 2 — لملاحظة ليست على صنف بعينه (مثل التأخير)", d.items[0].description);
  assert("no price of ours is in the list: not a sale price, not a purchase price", !/ر\.س|سعر|31\.31|77\.77|88\.88/.test(JSON.stringify(d.items.map((x: any) => [x.title, x.description]))));
  const tok = tokens(env).at(-1);
  assert("the orders the form listed stay with its token, with the number it was sent to", tok.to === C1_PHONE && tok.partnerId === C1 && JSON.stringify(tok.orders.map((o: any) => o.id)) === JSON.stringify([O_NEW, O_MID, O_OLD]) && tok.orders[0].lines.length === 2 && !("words" in tok) && !("test" in tok));
  // a long item name: the order's number is never the part that is cut
  const long = CF.complaintOptions([{ id: 123456, day: DAY, customerId: 1, customer: "", lines: [{ id: 9, productId: 1, product: "طماطم عنقودية مستوردة درجة أولى للمطاعم", packaging: "كرتون 5 كجم", quantity: 1 }] }]);
  assert("a name too long for a title is cut — never the order's number; the whole name is in the description", long[1].title.startsWith("#123456 · طماطم عنقودية") && long[1].title.endsWith("…") && count(long[1].title) === 30 && long[1].description.startsWith("طماطم عنقودية مستوردة درجة أولى للمطاعم (كرتون 5 كجم) — "), long[1].title);
  const wide = CF.complaintOptions([{ id: 7, day: DAY, customerId: 1, customer: "ع".repeat(400), lines: [{ id: 9, productId: 1, product: "ص".repeat(400), packaging: "", quantity: 1 }] }], { withCustomer: true });
  assert("a description is cut to Meta's three hundred characters: an item's, and «الطلب كله»'s", count(wide[0].description) === 300 && count(wide[1].description) === 300 && wide[0].description.endsWith("…") && wide[1].description.endsWith("…"), `${count(wide[0].description)} ${count(wide[1].description)}`);
  assert("an item with no packaging is named alone", CF.itemName({ product: "نعناع", packaging: "" }) === "نعناع" && CF.itemName({ product: "نعناع", packaging: "ربطة" }) === "نعناع (ربطة)");
  // sixty options: whole orders, the newest first
  const big = (id: number, n: number) => ({ id, day: DAY, customerId: C1, customer: NAME, lines: Array.from({ length: n }, (_, k) => ({ id: id * 100 + k, productId: 1, product: `صنف ${k}`, packaging: "", quantity: 1 })) });
  const fit = CF.offeredOrders([big(1, 29), big(2, 29), big(3, 1), big(4, 0)]);
  assert("sixty options at most: 30 + 30 fill it — the third order, and every older one, is left out WHOLE", JSON.stringify(fit.map((o: any) => o.id)) === JSON.stringify([1, 2]) && CF.complaintOptions(fit).length === 60);
  assert("…an order that fits is in (30 + 29 + 1)", CF.complaintOptions(CF.offeredOrders([big(1, 29), big(2, 28), big(3, 0), big(4, 5)])).length === 60 && CF.offeredOrders([big(1, 29), big(2, 28), big(3, 0), big(4, 5)]).length === 3);
  const huge = CF.offeredOrders([big(1, 80), big(2, 1)]);
  assert("the newest order alone is cut to fit, so a form always lists something: «الطلب كله» and its first 59 lines", huge.length === 1 && huge[0].lines.length === 59 && CF.complaintOptions(huge).length === 60 && huge[0].lines[58].id === 158);
  assert("no orders: nothing offered", CF.offeredOrders([]).length === 0);
  assert("an order that does not fit ends the list: a smaller, OLDER one is not put in its place", JSON.stringify(CF.offeredOrders([big(1, 29), big(2, 28), big(3, 5), big(4, 0)]).map((o: any) => o.id)) === JSON.stringify([1, 2]));
  graph.length = 0;
  const many = await quiet(() => CF.sendComplaintForm(env, c1, { orders: [big(1, 80), big(2, 1)] }));
  assert("the form itself lists sixty options at most, and its token holds exactly the orders it listed", many.sent === true && many.options === 60 && dataOf(flowsTo(C1_PHONE)[0]).items.length === 60 && tokens(env).at(-1).orders.length === 1 && tokens(env).at(-1).orders[0].lines.length === 59);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ3
console.log("\n[هـ3] the door of the words: «شكوى» / «مشكلة» from a customer with an order delivered in seven days");
for (const word of ["عندي شكوى", "فيه مشكلة في الطلب", "الطماطم تالفة اليوم"]) {
  const env = world();
  const r = await say(env, C1_PHONE, text(word));
  const f = flowsTo(C1_PHONE);
  assert(`«${word}» through the webhook → ONE message: his complaint form, with his three orders`, r.status === 200 && sentTo(C1_PHONE).length === 1 && f.length === 1 && dataOf(f[0]).items.length === 7, JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  assert("…NO complaint row yet, nothing to Baraa, not «وصلنا ملاحظتك», nothing held", complaints().length === 0 && sentTo(OWNER).length === 0 && !textsTo(C1_PHONE).includes(OLD_REPLY) && heldFor(env, C1_PHONE).length === 0 && graph.every((b: any) => b === null || b.to === C1_PHONE));
  assert("…his own words stay with the form's token, and its text opens with an apology", tokens(env).at(-1).words === word && bodyOf(f[0]) === [CF.COMPLAINT_SORRY_TEXT, `اضغط «عندي ملاحظة»: ${CF.COMPLAINT_HOW_TEXT}`].join("\n"), bodyOf(f[0]));
}
{
  assert("the words are the ones the path already knew — «شكوى» and «مشكلة» among them", ["شكوى", "عندي مشكلة", "تالف", "ناقص"].every(COMPLAINT.looksLikeComplaint) && !COMPLAINT.looksLikeComplaint("أبي 3 كرتون طماطم") && !COMPLAINT.looksLikeComplaint(""));
  const src = srcOf("router.ts");
  assert("the form is asked at the keyword's own place in the router, before the complaint of before", src.indexOf("if (await answerComplaintWithForm(env, partner, msg.from, msg.text)) {") > src.indexOf("looksLikeComplaint(msg.text)") && src.indexOf("if (await answerComplaintWithForm(env, partner, msg.from, msg.text)) {") < src.indexOf("const reply = await handleComplaint(env, partner.id, partner.name || \"\", msg.text);"));
}
{
  // nothing delivered in the last seven days: what the path did before, word for word
  const env = world();
  for (const id of [O_NEW, O_MID, O_OLD]) table("x_daily_order").get(id)!.x_delivered_at = utc("2026-09-20 10:00");
  setExtract({ type: "quality", severity: "high" });
  await say(env, C1_PHONE, text("عندي شكوى على الخيار"));
  const row = complaints()[0];
  assert("nothing delivered in seven days: NO form — «نعتذر عن الإزعاج… وصلنا ملاحظتك», as before", flowsTo(C1_PHONE).length === 0 && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([OLD_REPLY]), JSON.stringify(textsTo(C1_PHONE)));
  assert("…the complaint is made from his text as before: Claude's type and severity, his latest order, none of the form's fields", complaints().length === 1 && row.x_customer_id === C1 && row.x_type === "quality" && row.x_severity === "high" && row.x_message_text === "عندي شكوى على الخيار" && row.x_status === "new" && row.x_order_id === O_UNDATED
    && !("x_kind" in row) && !("x_order_line_id" in row) && !("x_product_tmpl_id" in row) && !("x_affected_qty" in row) && !("x_photo" in row), JSON.stringify(row));
  assert("…and Baraa gets «شكوى جديدة» as before — with no decision button", sentTo(OWNER).length === 1 && bodyOf(sentTo(OWNER)[0]).startsWith(`🟠 شكوى جديدة #${row.id}\nعميل: ${NAME}\nالنوع: جودة\nالرسالة: "عندي شكوى على الخيار"`) && sentTo(OWNER)[0].type === "text", bodyOf(sentTo(OWNER)[0]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // the form cannot go (Meta refuses it): the complaint of before
  const env = world();
  metaRefusesFlow = true;
  await say(env, C1_PHONE, text("عندي شكوى"));
  metaRefusesFlow = false;
  assert("a form Meta refuses: the complaint of before — the row from his text, «وصلنا ملاحظتك», Baraa told", complaints().length === 1 && complaints()[0].x_message_text === "عندي شكوى" && textsTo(C1_PHONE).includes(OLD_REPLY) && sentTo(OWNER).some((b: any) => bodyOf(b).includes("شكوى جديدة")) && tokens(env).length === 0);
  // Odoo fails while his orders are read: the same
  const env2 = world();
  odooDown = "x_daily_order_line";
  const offered = await quiet(() => CF.offerComplaintForm(env2, c1));
  odooDown = "";
  assert("his orders cannot be read: offerComplaintForm says so and never throws", offered.sent === false && offered.reason === "error" && flowsTo(C1_PHONE).length === 0);
  await assertThrows("…while sendComplaintForm itself throws (its caller decides)", async () => { odooDown = "x_daily_order_line"; try { await quiet(() => CF.sendComplaintForm(env2, c1)); } finally { odooDown = ""; } });
}
{
  // outside his window; a price source's or a supplier's number
  const env = world();
  env.MSG_DEDUP.store.delete(`wa_win:v1:${C1_PHONE}`);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: C1, x_processed_at: utc("2026-10-01 01:00"), x_status: "received" });
  const shut = await quiet(() => CF.sendComplaintForm(env, c1));
  assert("outside his 24h window the form does not go: nothing sent, nothing held, no token kept", shut.sent === false && shut.reason === "window_closed" && sentTo(C1_PHONE).length === 0 && heldFor(env, C1_PHONE).length === 0 && tokens(env).length === 0);
  // his window was open when the form was built, and closed by the time it is sent
  const late = world();
  openWindow(late, C1_PHONE, 25 * 60);
  const lateSend = await quiet(() => CF.sendComplaintForm(late, c1, { now: Date.now() - 2 * 3600_000 }));
  assert("a window that closes before the send: the form is NOT held for him (noHold) — and its token is not kept", lateSend.sent === false && /^skipped/.test(String(lateSend.reason)) && sentTo(C1_PHONE).length === 0 && heldFor(late, C1_PHONE).length === 0 && tokens(late).length === 0, JSON.stringify(lateSend));
  const env2 = world();
  openWindow(env2, AHMED_PHONE);
  const closed = await quiet(() => CF.sendComplaintForm(env2, { partnerId: C1, name: NAME, whatsapp: "+" + AHMED_PHONE }));
  assert("a supplier's (a price source's) number never gets this customer form, whatever partner the caller names", closed.sent === false && closed.reason === "closed_number" && sentTo(AHMED_PHONE).length === 0);
  assert("no number: nothing", (await quiet(() => CF.sendComplaintForm(env2, { partnerId: C1, name: NAME, whatsapp: "" }))).reason === "no_number");
  const other = await quiet(() => CF.sendComplaintForm(env2, { partnerId: CUST2, name: "بقالة النخيل", whatsapp: "+" + CUST2_PHONE }));
  assert("another customer's form lists HIS order alone", other.sent === true && JSON.stringify(dataOf(flowsTo(CUST2_PHONE)[0]).items.map((x: any) => x.id)) === JSON.stringify([`${O_OTHER}:0`, `${O_OTHER}:${L_OTHER}`]));
  table("x_daily_order").get(O_OTHER)!.x_delivered_at = utc("2026-09-20 10:00");
  graph.length = 0;
  const none = await quiet(() => CF.sendComplaintForm(env2, { partnerId: CUST2, name: "بقالة النخيل", whatsapp: "+" + CUST2_PHONE }));
  assert("a customer with nothing delivered in the last seven days: no form, no token kept, and it says why", none.sent === false && none.reason === "no_delivered_order" && graph.length === 0 && tokens(env2).length === 1);
}

// ================================================================ هـ4
console.log("\n[هـ4] the door of Claude's reading: a message with no keyword that the classifier calls a complaint");
{
  const env = world();
  setExtract({ intent: "complaint", confidence: 0.9 });
  const word = "الطلب اليوم ما عجبني أبداً";
  await say(env, C1_PHONE, text(word));
  assert("no keyword of ours in it, Claude says «complaint» → ONE message: the form, his words with its token — no row, nothing to Baraa", !COMPLAINT.looksLikeComplaint(word) && sentTo(C1_PHONE).length === 1 && flowsTo(C1_PHONE).length === 1 && tokens(env).at(-1).words === word && complaints().length === 0 && sentTo(OWNER).length === 0, JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  // nothing delivered in seven days: the composed reply of before — and, as before, no row
  const env2 = world();
  for (const id of [O_NEW, O_MID, O_OLD]) table("x_daily_order").get(id)!.x_delivered_at = utc("2026-09-20 10:00");
  setExtract({ intent: "complaint", confidence: 0.9 });
  await say(env2, C1_PHONE, text(word));
  assert("…with nothing delivered in seven days: Claude's composed reply as before — no form, and no row (this door never made one)", flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).length === 1 && complaints().length === 0);
  // another intent is not this door
  const env3 = world();
  setExtract({ intent: "greeting", confidence: 0.9 });
  await say(env3, C1_PHONE, text("السلام عليكم"));
  assert("a greeting is answered as a greeting: no form", flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).some((t: string) => t.includes("حياك الله")));
  const env4 = world();
  setExtract({ intent: "complaint", confidence: 0.9 });
  const asked = (senderType: string) => quiet(() => ROUTER.dispatch(env4, { msg: { from: C1_PHONE, messageId: "wamid.R1", type: "text", text: word, profileName: "" } as any, intent: "complaint", senderType: senderType as any, partner: { id: C1, name: NAME, x_whatsapp_number: "+" + C1_PHONE } }));
  const notCustomer = await asked("supplier");
  assert("a sender that is not a customer gets no form from this door: the composed reply", flowsTo(C1_PHONE).length === 0 && typeof notCustomer.text === "string" && notCustomer.text !== "");
  const isCustomer = await asked("customer");
  assert("…the same call for a customer: the form, and an empty reply (nothing more is sent)", flowsTo(C1_PHONE).length === 1 && isCustomer.text === "");
  const src = srcOf("router.ts");
  assert("the intent's door is a customer's alone, at the router's own «complaint» place", src.includes("if (intent === \"complaint\" && senderType === \"customer\" && partner?.id && msg.text && (await answerComplaintWithForm(env, partner, msg.from, msg.text))) {"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ5
console.log("\n[هـ5] the door of the delivery: «⚠️ عندي ملاحظة» under its free text, never on a template");
{
  const env = world();
  // the delivery's template is not usable: the free text goes
  for (const t of rows("x_whatsapp_template") as any[]) if (t.x_purpose === "customer_delivery_done") t.x_meta_status = "REJECTED";
  clearTemplateCache();
  await quiet(() => TEAM.notifyCustomerDelivered(env, "+" + C1_PHONE, NAME, O_NEW));
  const m = sentTo(C1_PHONE)[0];
  assert("«تم توصيل طلبك» as a free text is a button message: its text as it was, and ONE button — complaint_start «⚠️ عندي ملاحظة»", sentTo(C1_PHONE).length === 1 && m?.interactive?.type === "button" && bodyOf(m) === `مرحبا ${NAME} 🌿\nتم توصيل طلبك رقم #${O_NEW}. الفاتورة النهائية بتوصلك قريباً.\nشكراً لثقتك في UTAK.`
    && JSON.stringify(m.interactive.action.buttons) === JSON.stringify([{ type: "reply", reply: { id: "complaint_start", title: "⚠️ عندي ملاحظة" } }]), JSON.stringify(m));
  assert("the button's title is within Meta's twenty characters, and its id is the one the router reads", count(CF.COMPLAINT_BUTTON_TITLE) <= 20 && CF.COMPLAINT_BUTTON_TITLE.length <= 20 && CF.COMPLAINT_BUTTON === "complaint_start" && JSON.stringify(CF.complaintStartButton()) === JSON.stringify({ id: "complaint_start", title: "⚠️ عندي ملاحظة" }) && bodyOf(m).length <= 1024);
  graph.length = 0;
  await say(env, C1_PHONE, button("complaint_start", "⚠️ عندي ملاحظة"));
  assert("tapping it → ONE message: the form with his orders — no row, no words with it", sentTo(C1_PHONE).length === 1 && flowsTo(C1_PHONE).length === 1 && dataOf(flowsTo(C1_PHONE)[0]).items.length === 7 && bodyOf(flowsTo(C1_PHONE)[0]).startsWith("⚠️ عندي ملاحظة\n") && !("words" in tokens(env).at(-1)) && complaints().length === 0, JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
}
{
  // an approved UTILITY template goes first, as before: no button on it
  const env = world();
  await quiet(() => TEAM.notifyCustomerDelivered(env, "+" + C1_PHONE, NAME, O_NEW));
  const t = sentTo(C1_PHONE)[0];
  assert("with the approved delivery template the message goes by it — and carries no complaint button", sentTo(C1_PHONE).length === 1 && t?.template?.name === "utak_delivered" && !JSON.stringify(t).includes("complaint_start"), JSON.stringify(t));
  assert("the template itself is given no button: it is on the session option alone", srcOf("team.ts").includes("{ fallback: [buttonsContent(msg, [complaintStartButton()])] });") && !/payload: `?complaint/.test(srcOf("team.ts")));
}
{
  const env = world();
  for (const id of [O_NEW, O_MID, O_OLD]) table("x_daily_order").get(id)!.x_delivered_at = utc("2026-09-20 10:00");
  await say(env, C1_PHONE, button("complaint_start"));
  assert("the button with nothing delivered in seven days: one line asking him to write it — no form, no row", flowsTo(C1_PHONE).length === 0 && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([CF.COMPLAINT_WRITE_TEXT]) && complaints().length === 0, JSON.stringify(textsTo(C1_PHONE)));
  const env2 = world();
  metaRefusesFlow = true;
  await say(env2, C1_PHONE, button("complaint_start"));
  metaRefusesFlow = false;
  assert("the button when the form cannot go: the same line", textsTo(C1_PHONE).includes(CF.COMPLAINT_WRITE_TEXT) && complaints().length === 0);
  assert("answerComplaintButton with no partner: the same line, nothing read", (await quiet(() => CF.answerComplaintButton(env2, null))).text === CF.COMPLAINT_WRITE_TEXT && (await quiet(() => CF.answerComplaintButton(env2, { id: C1, name: NAME, x_whatsapp_number: false }))).text === CF.COMPLAINT_WRITE_TEXT);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ6
console.log("\n[هـ6] «إرسال»: ONE complaint on record with every field, the customer answered, Baraa told with the photo");
{
  const env = world();
  await say(env, C1_PHONE, text("عندي شكوى على الطماطم"));
  const f = flowsTo(C1_PHONE)[0];
  const before = books();
  graph.length = 0; odooLog.length = 0;
  const res = await say(env, C1_PHONE, nfm(tokenOf(f), good));
  await settle();
  const row = complaints()[0], id = row?.id;
  assert("the reply through the webhook → ONE x_complaint row", res.status === 200 && complaints().length === 1, String(complaints().length));
  assert("…the customer, the order, the line and its item", row.x_customer_id === C1 && row.x_order_id === O_NEW && row.x_order_line_id === L_TOM && row.x_product_tmpl_id === 1, JSON.stringify(row));
  assert("…the kind, and the older x_type it maps to (تالف → quality)", row.x_kind === "damaged" && row.x_type === "quality");
  assert("…the affected quantity as a number, severity «medium», status «new», created now", row.x_affected_qty === 2 && row.x_severity === "medium" && row.x_status === "new" && row.x_created_at === utc(`${DAY} 14:00`));
  assert("…his note, then what he wrote before the form", row.x_message_text === "الكرتون مهروس\nرسالته قبل النموذج: «عندي شكوى على الطماطم»", row.x_message_text);
  assert("…the photo, downloaded from Meta, as base64 in x_photo", row.x_photo === PHOTO_B64 && JSON.stringify(mediaAsked) === JSON.stringify(["CMPPH_F1"]));
  assert("…and nothing but these fields (the pilot worker's own flag aside)", JSON.stringify(Object.keys(row).sort()) === JSON.stringify(["id", "x_affected_qty", "x_created_at", "x_customer_id", "x_is_simulation", "x_kind", "x_message_text", "x_order_id", "x_order_line_id", "x_photo", "x_product_tmpl_id", "x_severity", "x_status", "x_type"]), Object.keys(row).sort().join());
  assert("the customer reads exactly «وصلت ملاحظتك رقم #… ونرد عليك اليوم»", JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([`وصلت ملاحظتك رقم #${id} ونرد عليك اليوم`]) && CF.complaintReceivedText(41) === "وصلت ملاحظتك رقم #41 ونرد عليك اليوم", JSON.stringify(textsTo(C1_PHONE)));
  const n = ownerNotes()[0];
  assert("Baraa gets ONE message: the summary — the customer, the order and its day, the item and what was delivered of it, the kind, the quantity, his note and his words — and the manual line", sentTo(OWNER).length === 1 && bodyOf(n) === [
    `⚠️ ملاحظة عميل #${id} — ${NAME}`, `الطلب: #${O_NEW} — سُلّم 3 أكتوبر 2026`, "الصنف: طماطم (كرتون) — المسلَّم 3", "النوع: تالف", "الكمية المتأثرة: 2",
    "ملاحظته: الكرتون مهروس", "رسالته: «عندي شكوى على الطماطم»", MANUAL, "قرارك؟ 👇",
  ].join("\n"), bodyOf(n));
  assert("…the manual line says the compensation and the credit note are NOT made by the system, and points at the guide", CF.COMPLAINT_MANUAL_TEXT === MANUAL && /لا ينفّذهما النظام/.test(MANUAL) && /يدوي/.test(MANUAL) && MANUAL.includes("«الإشعار الدائن»") && !MANUAL.includes("\n"));
  assert("…with the photo as its header (the media Meta already holds)", n.interactive.header?.type === "image" && n.interactive.header.image.id === "CMPPH_F1");
  assert("…and three buttons: cmp_comp_ «تعويض بالطلب القادم», cmp_credit_ «إشعار دائن», cmp_reject_ «رفض»", JSON.stringify(buttonsOf(n)) === JSON.stringify([{ id: `cmp_comp_${id}`, title: "تعويض بالطلب القادم" }, { id: `cmp_credit_${id}`, title: "إشعار دائن" }, { id: `cmp_reject_${id}`, title: "رفض" }])
    && buttonsOf(n).every((b) => CF.COMPLAINT_DECISION_RE.test(b.id) && count(b.title) <= 20) && count(bodyOf(n)) <= 1024);
  assert("nothing else is written: the row, and the messages' own records — no order line, no invoice, no payment, no entry", odooWrites().filter((c: any) => !gatewayRecord(c)).length === 1 && odooWrites().filter((c: any) => !gatewayRecord(c))[0].model === "x_complaint" && books() === before, JSON.stringify(odooWrites().filter((c: any) => !gatewayRecord(c)).map((c: any) => `${c.model}.${c.method}`)));
  assert("the form's token is marked used", typeof tokens(env)[0].usedAt === "number");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // the order as a whole, a delay: no line, no item, no quantity, no photo
  const env = world();
  const { r, row, id } = await note(env, { item: `${O_MID}:0`, kind: "delay", qty: "", note: "وصل الظهر" });
  assert("«الطلب كله» + «تأخير» with no quantity and no photo: recorded — the order alone, x_type «delay»", r.action === "recorded" && row.x_order_id === O_MID && row.x_kind === "delay" && row.x_type === "delay" && row.x_message_text === "وصل الظهر"
    && !("x_order_line_id" in row) && !("x_product_tmpl_id" in row) && !("x_affected_qty" in row) && !("x_photo" in row) && mediaAsked.length === 0, JSON.stringify(row));
  const n = ownerNotes()[0];
  assert("…Baraa reads «الطلب كله», «لم تُذكر», and no header", bodyOf(n) === [`⚠️ ملاحظة عميل #${id} — ${NAME}`, `الطلب: #${O_MID} — سُلّم 1 أكتوبر 2026`, "الصنف: الطلب كله", "النوع: تأخير", "الكمية المتأثرة: لم تُذكر", "ملاحظته: وصل الظهر", MANUAL, "قرارك؟ 👇"].join("\n") && !("header" in n.interactive), bodyOf(n));
}
{
  // each kind → its x_type; a quantity with decimals; «ناقص» needs no photo
  const env = world();
  const short = await note(env, { item: `${O_MID}:${L_POT}`, kind: "short", qty: "0.5", note: "" });
  assert("«ناقص» on an item with its quantity and no photo: recorded — x_type «quantity», 0.5, an empty note", short.r.action === "recorded" && short.row.x_kind === "short" && short.row.x_type === "quantity" && short.row.x_affected_qty === 0.5 && short.row.x_order_line_id === L_POT && short.row.x_product_tmpl_id === 3 && short.row.x_message_text === "" && !("x_photo" in short.row));
  const quality = await note(env, { item: `${O_NEW}:${L_CUC}`, kind: "quality", qty: "5", photo: photo("CMPPH_F2"), note: "ذابل" });
  assert("«جودة» with the whole delivered quantity (5 of 5) and a photo: recorded — x_type «quality»", quality.r.action === "recorded" && quality.row.x_kind === "quality" && quality.row.x_type === "quality" && quality.row.x_affected_qty === 5 && quality.row.x_photo === PHOTO_B64);
  const other = await note(env, { item: `${O_NEW}:${L_TOM}`, kind: "other", note: "السائق ما رد" });
  assert("«أخرى» on an item with no quantity: recorded — x_type «other», the item kept", other.r.action === "recorded" && other.row.x_type === "other" && other.row.x_order_line_id === L_TOM && !("x_affected_qty" in other.row));
  const whole = await note(env, { item: `${O_NEW}:0`, kind: "damaged", qty: "4", photo: photo("CMPPH_F3"), note: "" });
  assert("«تالف» on the order as a whole: its quantity is taken as written (no line to hold it to)", whole.r.action === "recorded" && whole.row.x_affected_qty === 4 && !("x_order_line_id" in whole.row));
  const bare = await note(env, { item: `${O_NEW}:0`, kind: "quality", photo: photo("CMPPH_F4"), note: "x".repeat(700) });
  assert("«جودة» on the order as a whole with NO quantity: recorded (a quantity is asked of an item alone) — and a note is kept to five hundred characters", bare.r.action === "recorded" && !("x_affected_qty" in bare.row) && count(bare.row.x_message_text) === 500 && bare.row.x_message_text.endsWith("…") && CF.COMPLAINT_NOTE_MAX === 500, JSON.stringify(bare.r));
  const delayed = await note(env, { item: `${O_NEW}:${L_CUC}`, kind: "delay", note: "" });
  assert("«تأخير» on an item with no quantity and no photo: recorded", delayed.r.action === "recorded" && delayed.row.x_kind === "delay" && delayed.row.x_order_line_id === L_CUC && !("x_affected_qty" in delayed.row) && !("x_photo" in delayed.row));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a photo that cannot be downloaded does not lose the complaint
  const env = world();
  const { r, row, id } = await note(env, { ...good, photo: photo("CMPPH_BAD1") });
  const n = ownerNotes()[0];
  assert("a photo Meta cannot hand over: the complaint is recorded WITHOUT it — and the customer is answered", r.action === "recorded" && complaints().length === 1 && !("x_photo" in row) && row.x_kind === "damaged" && textsTo(C1_PHONE).includes(`وصلت ملاحظتك رقم #${id} ونرد عليك اليوم`));
  assert("…Baraa's message says so, and carries no header", bodyOf(n).split("\n").at(-3) === CF.COMPLAINT_PHOTO_LOST_TEXT && bodyOf(n).endsWith(`${MANUAL}\nقرارك؟ 👇`) && !("header" in n.interactive) && sentTo(OWNER).length === 1, bodyOf(n));
  // Meta refuses the photo as a header: the same note again without it
  const env2 = world();
  metaRefusesHeader = true;
  const second = await note(env2);
  metaRefusesHeader = false;
  const again = ownerNotes();
  assert("Meta refuses the photo as a header: ONE note reaches Baraa, without it, saying where the photo is — the buttons as they were", again.length === 1 && !("header" in again[0].interactive) && bodyOf(again[0]).endsWith(`قرارك؟ 👇\n${CF.COMPLAINT_NO_IMAGE_TEXT}`) && buttonsOf(again[0])[2].id === `cmp_reject_${second.id}` && second.row.x_photo === PHOTO_B64 && count(bodyOf(again[0])) <= 1024, bodyOf(again[0]));
  // a note with no photo that Meta refuses is not sent a second time «without its photo»
  const env3 = world();
  metaRefusesButtons = true;
  const refusedNote = await note(env3, { item: `${O_MID}:0`, kind: "delay", note: "" });
  metaRefusesButtons = false;
  assert("a note with NO photo that Meta refuses: ONE attempt — it is not sent again «without the photo»", refusedNote.r.action === "recorded" && refusedByMeta.length === 1 && !JSON.stringify(refusedByMeta).includes(CF.COMPLAINT_NO_IMAGE_TEXT) && complaints().length === 1, String(refusedByMeta.length));
  // the longest summary still ends with the manual line and the question
  const longest = CF.ownerComplaintText({ id: 999999, name: "م".repeat(200), order: { id: 999999, day: "2026-09-30", customerId: 1, customer: "", lines: [] }, line: { id: 1, productId: 1, product: "ص".repeat(200), packaging: "ك".repeat(50), quantity: 9999.99 }, kind: "quality", qty: 9999.99, note: "ن".repeat(500), words: "ر".repeat(4000), photoLost: true });
  assert("the longest summary — every free part at its largest — stays within a button message's 1024 characters, the manual line and the question whole", count(`${longest}\n${CF.COMPLAINT_NO_IMAGE_TEXT}`) <= 1024 && longest.endsWith(`${CF.COMPLAINT_PHOTO_LOST_TEXT}\n${MANUAL}\nقرارك؟ 👇`), String(count(longest)));
  assert("complaintMessageText: the note alone, the words alone, both", CF.complaintMessageText("أ", "") === "أ" && CF.complaintMessageText("", "ب") === "رسالته قبل النموذج: «ب»" && CF.complaintMessageText("أ", "ب") === "أ\nرسالته قبل النموذج: «ب»" && CF.complaintMessageText("", undefined) === "");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ7
console.log("\n[هـ7] a field that cannot be read: the form is refused as a whole — one message with a fresh form, nothing written");
{
  const cases: Array<[string, Record<string, unknown>, string[], string]> = [
    ["no order or item chosen", { ...good, item: "" }, ["item"], CF.COMPLAINT_BAD_ITEM_TEXT],
    ["an order that was not listed (another customer's)", { ...good, item: `${O_OTHER}:${L_OTHER}` }, ["item"], CF.COMPLAINT_BAD_ITEM_TEXT],
    ["another customer's order as a whole", { ...good, item: `${O_OTHER}:0` }, ["item"], CF.COMPLAINT_BAD_ITEM_TEXT],
    ["a line of another order under his own", { ...good, item: `${O_NEW}:${L_POT}` }, ["item"], CF.COMPLAINT_BAD_ITEM_TEXT],
    ["a line that was not delivered (unavailable)", { ...good, item: `${O_MID}:${L_ONI}` }, ["item"], CF.COMPLAINT_BAD_ITEM_TEXT],
    ["an order older than seven days", { ...good, item: `${O_STALE}:0` }, ["item"], CF.COMPLAINT_BAD_ITEM_TEXT],
    ["a simulation's order", { ...good, item: `${O_SIM_A}:0` }, ["item"], CF.COMPLAINT_BAD_ITEM_TEXT],
    ["an id that is no option's", { ...good, item: "8003" }, ["item"], CF.COMPLAINT_BAD_ITEM_TEXT],
    ["a kind that is not one of the five", { ...good, kind: "pricing" }, ["kind"], CF.COMPLAINT_BAD_KIND_TEXT],
    ["no kind", { ...good, kind: undefined }, ["kind"], CF.COMPLAINT_BAD_KIND_TEXT],
    ["a quantity that is not a number", { ...good, qty: "كرتونين" }, ["qty"], CF.COMPLAINT_BAD_QTY_TEXT],
    ["a quantity of zero", { ...good, qty: "0" }, ["qty"], CF.COMPLAINT_BAD_QTY_TEXT],
    ["a negative quantity", { ...good, qty: "-1" }, ["qty"], CF.COMPLAINT_BAD_QTY_TEXT],
    ["a quantity with three decimals", { ...good, qty: "1.255" }, ["qty"], CF.COMPLAINT_BAD_QTY_TEXT],
    ["more than was delivered of the item (3.5 of 3)", { ...good, qty: "3.5" }, ["over"], "الكمية المتأثرة (3.5) أكثر من المسلَّم من الصنف (3)."],
    ["«تالف» on an item with no quantity", { ...good, qty: "" }, ["need_qty"], CF.COMPLAINT_NEED_QTY_TEXT],
    ["«ناقص» on an item with no quantity", { ...good, kind: "short", qty: undefined, photo: [] }, ["need_qty"], CF.COMPLAINT_NEED_QTY_TEXT],
    ["«جودة» on an item with no quantity", { ...good, kind: "quality", qty: "  " }, ["need_qty"], CF.COMPLAINT_NEED_QTY_TEXT],
    ["«تالف» with no photo", { ...good, photo: [] }, ["photo"], CF.COMPLAINT_NO_PHOTO_TEXT],
    ["«جودة» with no photo", { ...good, kind: "quality", photo: undefined }, ["photo"], CF.COMPLAINT_NO_PHOTO_TEXT],
    ["«تالف» on the order as a whole with no photo", { item: `${O_NEW}:0`, kind: "damaged", note: "" }, ["photo"], CF.COMPLAINT_NO_PHOTO_TEXT],
    ["everything wrong at once", { item: "x", kind: "y", qty: "z", note: "" }, ["item", "kind", "qty"], CF.COMPLAINT_BAD_KIND_TEXT],
  ];
  for (const [name, values, problems, reason] of cases) {
    const env = world();
    await quiet(() => CF.sendComplaintForm(env, c1));
    const f = flowsTo(C1_PHONE)[0];
    graph.length = 0; odooLog.length = 0;
    const r = await reply(env, C1_PHONE, tokenOf(f), values);
    await settle();
    const fresh2 = flowsTo(C1_PHONE);
    assert(`${name}: refused as a whole (${problems.join(",")}) — nothing written, nothing to Baraa, ONE message: a fresh form that says why`, r.action === "invalid" && JSON.stringify(r.problems) === JSON.stringify(problems) && complaints().length === 0 && sentTo(OWNER).length === 0 && odooWrites().every(gatewayRecord)
      && sentTo(C1_PHONE).length === 1 && fresh2.length === 1 && bodyOf(fresh2[0]).startsWith("⚠️ ما انحفظت ملاحظتك:\n") && bodyOf(fresh2[0]).includes(`• ${reason}`) && bodyOf(fresh2[0]).endsWith("عبّ النموذج من جديد ثم «إرسال» 👇") && count(bodyOf(fresh2[0])) <= 1024 && mediaAsked.length === 0, `${r.action} ${JSON.stringify(r.problems)} | ${bodyOf(fresh2[0])}`);
  }
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  await say(env, C1_PHONE, text("عندي شكوى"));
  const f = flowsTo(C1_PHONE)[0];
  graph.length = 0; odooLog.length = 0;
  const r = await reply(env, C1_PHONE, tokenOf(f), { ...good, qty: "2.5", photo: [], note: "  مهروس\nكله  " });
  const fresh2 = flowsTo(C1_PHONE)[0], d = dataOf(fresh2), tok = tokens(env).find((t: any) => t.token === tokenOf(fresh2));
  assert("the fresh form lists the SAME orders and opens the two texts on what he wrote — the note as one line", r.action === "invalid" && d.items.length === 7 && d.qty === "2.5" && d.note === "مهروس كله" && d.t === `عندي ملاحظة — ${NAME}`, JSON.stringify([d.qty, d.note]));
  assert("…its orders come from the first form's token: Odoo is not read again", !odooLog.some((c: any) => c.model === "x_daily_order" || c.model === "x_daily_order_line") && tokenOf(fresh2) !== tokenOf(f) && JSON.stringify(tok.orders.map((o: any) => o.id)) === JSON.stringify([O_NEW, O_MID, O_OLD]));
  assert("…and his words of before the form go on to the fresh one", tok.words === "عندي شكوى");
  const ok = await reply(env, C1_PHONE, tokenOf(fresh2), { ...good, qty: "2.5" });
  assert("the fresh form, corrected, is recorded — with those words", ok.action === "recorded" && complaints().length === 1 && complaints()[0].x_affected_qty === 2.5 && complaints()[0].x_message_text.endsWith("رسالته قبل النموذج: «عندي شكوى»"));
  // a quantity that was not a number opens empty
  const env2 = world();
  await quiet(() => CF.sendComplaintForm(env2, c1));
  await reply(env2, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), { ...good, qty: "كثير" });
  assert("a quantity that was not a number opens empty on the fresh form; one that was too large opens as he wrote it", dataOf(flowsTo(C1_PHONE).at(-1)).qty === "");
  await reply(env2, C1_PHONE, tokenOf(flowsTo(C1_PHONE).at(-1)), { ...good, qty: "9" });
  assert("…(9 of 3 delivered → «9»)", dataOf(flowsTo(C1_PHONE).at(-1)).qty === "9" && bodyOf(flowsTo(C1_PHONE).at(-1)).includes("• الكمية المتأثرة (9) أكثر من المسلَّم من الصنف (3)."));
  // the fresh form cannot go: the reasons as a text
  const env3 = world();
  await quiet(() => CF.sendComplaintForm(env3, c1));
  const f3 = flowsTo(C1_PHONE)[0];
  graph.length = 0;
  metaRefusesFlow = true;
  const r3 = await reply(env3, C1_PHONE, tokenOf(f3), { ...good, photo: [] });
  metaRefusesFlow = false;
  assert("when the fresh form cannot go the reasons reach him as a text", r3.action === "invalid" && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([["⚠️ ما انحفظت ملاحظتك:", `• ${CF.COMPLAINT_NO_PHOTO_TEXT}`, "عبّ النموذج من جديد ثم «إرسال» 👇"].join("\n")]), JSON.stringify(textsTo(C1_PHONE)));
  assert("the fields, one by one: a quantity as Arabic digits and a decimal comma; an empty field is no quantity", CF.parseAffectedQty("٢٫٥") === 2.5 && CF.parseAffectedQty("2,5") === 2.5 && CF.parseAffectedQty(3) === 3 && CF.parseAffectedQty("") === null && CF.parseAffectedQty(undefined) === null && CF.parseAffectedQty(null) === null
    && CF.parseAffectedQty("0") === "invalid" && CF.parseAffectedQty("1e3") === "invalid" && CF.parseAffectedQty({}) === "invalid");
  assert("…a kind is one of the five ids, nothing else", ["damaged", "short", "quality", "delay", "other"].every((k) => CF.parseComplaintKind(k) === k) && ["", "تالف", "toString", "constructor", null, undefined, 3, ["damaged"]].every((k) => CF.parseComplaintKind(k) === "invalid"));
  const orders = tokens(env)[0].orders;
  assert("…an option is read against the listed orders alone: «8003:0» the order, «8003:4031» its line, anything else nothing", CF.chosenItem(`${O_NEW}:0`, orders)?.line === null && CF.chosenItem(`${O_NEW}:${L_TOM}`, orders)?.line?.id === L_TOM && CF.chosenItem(`${O_NEW}:${L_TOM}`, orders)?.order.id === O_NEW
    && [`${O_NEW}`, `${O_NEW}:`, `:${L_TOM}`, `${O_NEW}:${L_TOM}:1`, ` ${O_NEW}:0`, `0${O_NEW}:0`, `${O_NEW}:0${L_TOM}`, 8003, null, undefined, [`${O_NEW}:0`]].every((v) => CF.chosenItem(v, orders) === null));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ8
console.log("\n[هـ8] the token: read by the number it was sent to, once — and a row that could not be made");
{
  const env = world();
  await quiet(() => CF.sendComplaintForm(env, c1));
  const tok = tokenOf(flowsTo(C1_PHONE)[0]);
  assert("a token: cp1.<partner>.<random>, kept in KV with the number", CF.isComplaintToken(tok) && /^cp1\.\d+\.[a-f0-9]{18}$/.test(tok) && env.MSG_DEDUP.store.has(CF.complaintTokenKey(tok)) && !CF.isComplaintToken("tr1.1.x") && !CF.isComplaintToken(""));
  graph.length = 0;
  const other = await reply(env, CUST2_PHONE, tok, good);
  assert("the same token from ANOTHER number: nothing is read from it — one line, no row", other.action === "unknown" && complaints().length === 0 && JSON.stringify(textsTo(CUST2_PHONE)) === JSON.stringify([CF.COMPLAINT_UNKNOWN_TEXT]) && sentTo(OWNER).length === 0);
  const unknown = await reply(env, C1_PHONE, "cp1.501.000000000000000000", good), foreign = await reply(env, C1_PHONE, "tr1.501.abc", good);
  assert("a token the worker does not hold, or another form's: the same line, no row", unknown.action === "unknown" && foreign.action === "unknown" && complaints().length === 0);
  const first = await reply(env, C1_PHONE, tok, good);
  graph.length = 0;
  const second = await reply(env, C1_PHONE, tok, { ...good, kind: "quality" });
  assert("the same token a second time: «سبق إرساله» — ONE row, nothing more to Baraa", first.action === "recorded" && second.action === "duplicate" && complaints().length === 1 && complaints()[0].x_kind === "damaged" && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([CF.COMPLAINT_USED_TEXT]) && sentTo(OWNER).length === 0);
  // the lock lost but the token marked used: still a second time
  env.MSG_DEDUP.store.delete(`btnlock:v1:complaint_use:${tok}`);
  const third = await reply(env, C1_PHONE, tok, good);
  assert("the lock lost but the token marked used: still «سبق إرساله»", third.action === "duplicate" && complaints().length === 1);
  // a reply while the first is still being read (the lock is held, the token not marked yet)
  const race = world();
  await quiet(() => CF.sendComplaintForm(race, c1));
  const raceTok = tokenOf(flowsTo(C1_PHONE)[0]);
  race.MSG_DEDUP.store.set(`btnlock:v1:complaint_use:${raceTok}`, "run:1:abc");
  const racing = await reply(race, C1_PHONE, raceTok, good);
  assert("a reply while the first is still being read: «سبق إرساله», no row", racing.action === "duplicate" && complaints().length === 0 && textsTo(C1_PHONE).includes(CF.COMPLAINT_USED_TEXT));
  // a refused form's token is spent too
  const env2 = world();
  await quiet(() => CF.sendComplaintForm(env2, c1));
  const t2 = tokenOf(flowsTo(C1_PHONE)[0]);
  await reply(env2, C1_PHONE, t2, { ...good, photo: [] });
  const reuse = await reply(env2, C1_PHONE, t2, good);
  assert("a refused form's token is spent: the corrected values go by the FRESH form", reuse.action === "duplicate" && complaints().length === 0);
  env2.MSG_DEDUP.store.delete(`btnlock:v1:complaint_use:${t2}`);
  const reuse2 = await reply(env2, C1_PHONE, t2, good);
  assert("…it is MARKED used, not only locked: with its lock lost it is still «سبق إرساله»", reuse2.action === "duplicate" && complaints().length === 0 && typeof tokens(env2).find((t: any) => t.token === t2).usedAt === "number");
}
{
  // Odoo cannot make the row: the token is his to send again
  const env = world();
  await quiet(() => CF.sendComplaintForm(env, c1));
  const tok = tokenOf(flowsTo(C1_PHONE)[0]);
  graph.length = 0;
  odooDown = "x_complaint.create";
  const failed = await reply(env, C1_PHONE, tok, good);
  odooDown = "";
  assert("Odoo fails on the row: nothing recorded, he is asked to send again, Baraa is told nothing — and it never throws", failed.action === "error" && complaints().length === 0 && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([CF.COMPLAINT_RETRY_TEXT]) && sentTo(OWNER).length === 0);
  emptyCreate = true;
  graph.length = 0;
  const empty = await reply(env, C1_PHONE, tok, good);
  emptyCreate = false;
  assert("Odoo answers with no id: the same — no «وصلت ملاحظتك رقم #undefined»", empty.action === "error" && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([CF.COMPLAINT_RETRY_TEXT]) && sentTo(OWNER).length === 0);
  graph.length = 0;
  const again = await reply(env, C1_PHONE, tok, good);
  assert("…the SAME form sent again is recorded: its token was not spent", again.action === "recorded" && complaints().length === 1 && textsTo(C1_PHONE)[0] === `وصلت ملاحظتك رقم #${again.complaintId} ونرد عليك اليوم` && ownerNotes().length === 1);
  const idx = srcOf("index.ts");
  assert("the reply is read in the webhook's Flow chain, right after the registration form's", idx.indexOf("(await import(\"./complaint-form\")).isComplaintToken(msg.flow.token ?? \"\")") > idx.indexOf("isRegisterFormToken(msg.flow.token ?? \"\")") && idx.indexOf("(await import(\"./complaint-form\")).isComplaintToken(msg.flow.token ?? \"\")") < idx.indexOf("(await import(\"./car-load\")).isCarLoadToken(msg.flow.token ?? \"\")"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ9
console.log("\n[هـ9] Baraa's three decisions: what each writes on the complaint and says to the customer — and nothing else");
{
  const expected: Array<[string, string, string, string, boolean, string, string]> = [
    ["comp", "compensate_next", "تعويض بالطلب القادم", "investigating", false, "نعوّضك عنها مع طلبك القادم ✅ ونعتذر منك.", "⚠️ التعويض لا يُضاف آلياً: أضفه بنفسك لطلبه القادم، ثم أغلق الملاحظة في Odoo."],
    ["credit", "credit_note", "إشعار دائن", "investigating", false, "نخصم قيمتها من حسابك بإشعار دائن ✅ ونعتذر منك.", "⚠️ الإشعار الدائن لا يصدر آلياً: أصدره يدوياً من Odoo (الدليل: «الإشعار الدائن»)، ثم أغلق الملاحظة."],
    ["reject", "rejected", "رفض", "dismissed", true, "راجعناها وما قدرنا نعتمدها. لو عندك توضيح أو صورة ثانية أرسلها لنا.", "أُغلقت الملاحظة في Odoo (مرفوضة)."],
  ];
  for (const [key, value, title, status, closes, said, after] of expected) {
    const env = world();
    const { id } = await note(env);
    setRiyadh(`${DAY} 16:20`); openWindow(env, C1_PHONE);
    const before = books();
    graph.length = 0; odooLog.length = 0;
    const r = await tap(env, `cmp_${key}_${id}`);
    await settle();
    const row = complaints()[0];
    const writes = odooWrites().filter((c: any) => !gatewayRecord(c));
    const customerText = `ملاحظتك رقم #${id}: ${said}`;
    assert(`«${title}»: x_decision «${value}», its moment, and x_status «${status}»`, r?.action === "decided" && r.decision === value && row.x_decision === value && row.x_decided_at === utc(`${DAY} 16:20`) && row.x_status === status, JSON.stringify([row.x_decision, row.x_decided_at, row.x_status]));
    assert(`…a line in x_resolution_note${closes ? "" : " that says the rest is done by hand"}`, row.x_resolution_note === `${DAY} 16:20 — قرار براء من واتساب: ${title}${closes ? "" : " (التنفيذ يدوي)"}`, row.x_resolution_note);
    assert(closes ? "…a refusal closes it: x_resolved_at is its moment" : "…it is NOT closed: no x_resolved_at — Baraa closes it in Odoo when the manual step is done", closes ? row.x_resolved_at === utc(`${DAY} 16:20`) : !("x_resolved_at" in row));
    assert("…ONE write, on the complaint alone, of these fields alone — no order line, no credit note, no payment", writes.length === 1 && writes[0].model === "x_complaint" && writes[0].method === "write" && JSON.stringify(writes[0].body.ids) === JSON.stringify([id])
      && JSON.stringify(Object.keys(writes[0].body.vals).sort()) === JSON.stringify(["x_decided_at", "x_decision", "x_resolution_note", "x_status", ...(closes ? ["x_resolved_at"] : [])].sort()) && books() === before, JSON.stringify(writes.map((c: any) => [c.model, c.method, Object.keys(c.body.vals ?? {})])));
    assert("…the customer reads ONE fixed text, to the letter", JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([customerText]) && CF.complaintDecisionText(value as any, id) === customerText && sentTo(C1_PHONE).length === 1, JSON.stringify(textsTo(C1_PHONE)));
    assert("…Baraa reads what was recorded, what the customer was told, and what is still his to do by hand", JSON.stringify(textsTo(OWNER)) === JSON.stringify([[`✅ سُجّل قرارك على الملاحظة #${id} (${NAME}): ${title}.`, `أُبلغ العميل: «${customerText}»`, after].join("\n")]) && CF.COMPLAINT_AFTER_TEXT[value as "rejected"] === after, textsTo(OWNER).join("|"));
    assert("…the rest of the row is as the customer sent it", row.x_kind === "damaged" && row.x_order_id === O_NEW && row.x_order_line_id === L_TOM && row.x_affected_qty === 2 && row.x_photo === PHOTO_B64 && row.x_message_text === "الكرتون مهروس" && row.x_severity === "medium");
  }
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a note already on the complaint is kept: the decision's line goes under it
  const env = world();
  const { id } = await note(env);
  complaints()[0].x_resolution_note = "اتصلت بالعميل";
  await tap(env, `cmp_credit_${id}`);
  assert("a resolution note already there is kept: the decision's line goes under it", complaints()[0].x_resolution_note === `اتصلت بالعميل\n${DAY} 14:00 — قرار براء من واتساب: إشعار دائن (التنفيذ يدوي)`, complaints()[0].x_resolution_note);
  assert("writeComplaintDecision writes a refusal's two moments as one, and no other decision's", /if \(args\.decision === "rejected"\) vals\.x_resolved_at = at;/.test(srcOf("odoo-v6-append.ts")) && CF.resolutionLine("rejected", Date.now()) === `${DAY} 14:00 — قرار براء من واتساب: رفض`);
}
{
  // the customer's window closed when Baraa decides: his line waits for him
  const env = world();
  const { id } = await note(env);
  env.MSG_DEDUP.store.delete(`wa_win:v1:${C1_PHONE}`);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: C1, x_processed_at: utc("2026-10-01 01:00"), x_status: "received" });
  graph.length = 0;
  const r = await tap(env, `cmp_comp_${id}`);
  const held = heldFor(env, C1_PHONE);
  assert("the customer's window closed when Baraa taps: the decision is recorded and his line is HELD for him (48h), no template", r?.action === "decided" && complaints()[0].x_decision === "compensate_next" && sentTo(C1_PHONE).length === 0 && held.length === 1 && held[0].purpose === "customer_complaint_decision"
    && held[0].body.text.body === CF.complaintDecisionText("compensate_next", id) && held[0].expiresAt - held[0].createdAt === 48 * 3600_000, JSON.stringify(held));
  // the customer's number is his card's: the WhatsApp number, else the phone
  const env2 = world();
  const two = await note(env2);
  Object.assign(table("res.partner").get(C1)!, { x_whatsapp_number: false, phone: "+" + C1_PHONE });
  graph.length = 0;
  await tap(env2, `cmp_reject_${two.id}`);
  assert("a card with a phone and no WhatsApp number: the decision's text goes to the phone", textsTo(C1_PHONE).includes(CF.complaintDecisionText("rejected", two.id)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ10
console.log("\n[هـ10] a second tap on ANY of the three: «سبق تسجيله», and nothing is written; the buttons are Baraa's alone");
{
  const env = world();
  const { id } = await note(env);
  await tap(env, `cmp_comp_${id}`);
  const before = JSON.stringify(complaints());
  for (const second of ["comp", "credit", "reject"]) {
    graph.length = 0; odooLog.length = 0;
    const r = await tap(env, `cmp_${second}_${id}`);
    await settle();
    assert(`«تعويض بالطلب القادم» then cmp_${second}_: «سبق تسجيله» — nothing written, nothing to the customer`, r?.action === "duplicate" && JSON.stringify(complaints()) === before && sentTo(C1_PHONE).length === 0 && odooWrites().every(gatewayRecord)
      && JSON.stringify(textsTo(OWNER)) === JSON.stringify([`سبق تسجيله: «تعويض بالطلب القادم» الساعة 14:00 — الملاحظة #${id}، ${NAME}`]), textsTo(OWNER).join("|"));
  }
  // the lock lost but the complaint decided: still a second tap
  env.MSG_DEDUP.store.delete(`btnlock:v1:complaint_decide:${id}`);
  graph.length = 0;
  const late = await tap(env, `cmp_reject_${id}`);
  assert("the lock lost but the complaint carries its decision: still «سبق تسجيله» — it is NOT turned into a refusal", late?.action === "duplicate" && complaints()[0].x_decision === "compensate_next" && complaints()[0].x_status === "investigating" && textsTo(OWNER)[0].startsWith("سبق تسجيله: «تعويض بالطلب القادم»") && sentTo(C1_PHONE).length === 0);
  // a refusal, then a tap: a refused complaint is «dismissed» — still «سبق تسجيله», naming the refusal
  const env2 = world();
  const two = await note(env2);
  await tap(env2, `cmp_reject_${two.id}`);
  graph.length = 0;
  const after = await tap(env2, `cmp_credit_${two.id}`);
  assert("«رفض» then «إشعار دائن»: «سبق تسجيله: «رفض»…» — nothing is credited", after?.action === "duplicate" && complaints()[0].x_decision === "rejected" && textsTo(OWNER)[0].startsWith("سبق تسجيله: «رفض» الساعة 14:00"));
  // a tap while the first is still running (the lock is held, nothing decided yet)
  const env3 = world();
  const three = await note(env3);
  env3.MSG_DEDUP.store.set(`btnlock:v1:complaint_decide:${three.id}`, "run:1:abc");
  graph.length = 0;
  const racing = await tap(env3, `cmp_comp_${three.id}`);
  assert("a tap while the first is still running: «سبق تسجيله», nothing written", racing?.action === "duplicate" && JSON.stringify(textsTo(OWNER)) === JSON.stringify(["سبق تسجيله"]) && !("x_decision" in complaints()[0]) && sentTo(C1_PHONE).length === 0);
  assert("ONE lock for the three buttons", (srcOf("complaint-form.ts").match(/claimButton\(env, `complaint_decide:\$\{id\}`\)/g) ?? []).length === 1 && CF.COMPLAINT_ALREADY_TEXT === "سبق تسجيله");
}
{
  // another number's tap
  const env = world();
  const { id } = await note(env);
  const before = JSON.stringify(complaints());
  graph.length = 0;
  const customer = await tap(env, `cmp_comp_${id}`, C1_PHONE), team = await tap(env, `cmp_credit_${id}`, WH_PHONE), no = await tap(env, `cmp_reject_${id}`, C1_PHONE);
  assert("a tap from the customer's number, or a team member's: NOT theirs (null) — nothing written, nothing sent, the complaint still undecided", customer === null && team === null && no === null && JSON.stringify(complaints()) === before && graph.length === 0 && !("x_decision" in complaints()[0]));
  await say(env, C1_PHONE, button(`cmp_comp_${id}`, "تعويض بالطلب القادم"));
  assert("…through the webhook the customer gets the answer of a button the worker does not know — and nothing is decided", JSON.stringify(complaints()) === before && !textsTo(C1_PHONE).some((t: string) => t.startsWith("ملاحظتك رقم")) && textsTo(C1_PHONE).some((t: string) => t.includes("من رسالة قديمة")) && sentTo(OWNER).length === 0, JSON.stringify(textsTo(C1_PHONE)));
  graph.length = 0;
  const res = await say(env, OWNER, button(`cmp_credit_${id}`, "إشعار دائن"));
  assert("Baraa's own tap through the webhook records it, and the customer reads his text", res.status === 200 && complaints()[0].x_decision === "credit_note" && textsTo(C1_PHONE).includes(CF.complaintDecisionText("credit_note", id)) && textsTo(OWNER).some((t: string) => t.startsWith(`✅ سُجّل قرارك على الملاحظة #${id}`)));
  graph.length = 0;
  const gone = await tap(env, "cmp_comp_424242");
  assert("a complaint that is not in Odoo: one line, nothing written", gone?.action === "unknown" && JSON.stringify(textsTo(OWNER)) === JSON.stringify(["الملاحظة #424242 غير موجودة في Odoo: لم يُسجَّل شيء."]) && complaints().length === 1);
  assert("an id that is no complaint's button is not this module's", (await tap(env, "cmp_comp_x")) === null && (await tap(env, `cmp_maybe_${id}`)) === null && (await tap(env, `cmp_comp_${id}_1`)) === null && (await tap(env, "trn_ok_0000000000")) === null && CF.COMPLAINT_DECISION_RE.test(`cmp_reject_${id}`));
  const idx = srcOf("index.ts");
  assert("the three buttons are read in Baraa's own branch of the webhook alone", idx.indexOf("/^cmp_(comp|credit|reject)_/.test(msg.buttonId") > idx.indexOf("// ---- owner-guard (inbound) ----") && idx.indexOf("/^cmp_(comp|credit|reject)_/.test(msg.buttonId") < idx.indexOf("// § 52 ب — an outside price source (رائد): its prices within 90 minutes") && !/cmp_/.test(srcOf("router.ts")));
}
{
  // a complaint closed by hand in Odoo takes no decision from WhatsApp
  for (const status of ["resolved", "dismissed"]) {
    const env = world();
    const { id } = await note(env);
    complaints()[0].x_status = status;
    const before = JSON.stringify(complaints());
    graph.length = 0; odooLog.length = 0;
    const r = await tap(env, `cmp_comp_${id}`);
    await settle();
    assert(`a complaint Baraa closed in Odoo («${status}», no decision from WhatsApp): the tap writes nothing and tells the customer nothing`, r?.action === "closed" && JSON.stringify(complaints()) === before && sentTo(C1_PHONE).length === 0 && odooWrites().every(gatewayRecord)
      && JSON.stringify(textsTo(OWNER)) === JSON.stringify([`الملاحظة #${id} مغلقة في Odoo: لم يُسجَّل قرار، ولم يُبلَّغ العميل.`]), textsTo(OWNER).join("|"));
    // reopened in Odoo: the buttons work again (a closed tap kept no lock)
    complaints()[0].x_status = "new";
    const reopened = await tap(env, `cmp_comp_${id}`);
    assert(`…reopened in Odoo, the same button records the decision («${status}» kept no lock)`, reopened?.action === "decided" && complaints()[0].x_decision === "compensate_next");
  }
}
{
  // a tap that could not finish: released, and the next one records it
  const env = world();
  const { id } = await note(env);
  odooDown = "x_complaint.write";
  graph.length = 0;
  const r = await tap(env, `cmp_credit_${id}`);
  odooDown = "";
  assert("Odoo fails on the decision's write: the tap says so, nothing is decided, the customer is told nothing — and it never throws", r?.action === "error" && JSON.stringify(textsTo(OWNER)) === JSON.stringify([CF.COMPLAINT_DECISION_RETRY_TEXT]) && !("x_decision" in complaints()[0]) && sentTo(C1_PHONE).length === 0);
  graph.length = 0;
  const again = await tap(env, `cmp_credit_${id}`);
  assert("…the next tap records it: the first kept no lock", again?.action === "decided" && complaints()[0].x_decision === "credit_note" && textsTo(C1_PHONE).includes(CF.complaintDecisionText("credit_note", id)));
  // Odoo fails while the complaint is read: the same line, no lock taken
  const env2 = world();
  const two = await note(env2);
  odooDown = "x_complaint.search_read";
  graph.length = 0;
  const unread = await tap(env2, `cmp_comp_${two.id}`);
  odooDown = "";
  assert("Odoo fails while the complaint is read: the same line — no lock is left behind", unread?.action === "error" && JSON.stringify(textsTo(OWNER)) === JSON.stringify([CF.COMPLAINT_DECISION_RETRY_TEXT]) && !env2.MSG_DEDUP.store.has(`btnlock:v1:complaint_decide:${two.id}`));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ11
console.log("\n[هـ11] the trial to Baraa, its hook, the purposes, and what the form never shows");
{
  const env = world(`${DAY} 16:00`);
  closeOwnerWindow(env);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: 3, x_processed_at: utc("2026-10-01 01:00"), x_status: "received" });
  const shut = await quiet(() => CF.sendComplaintFormTest(env));
  assert("Baraa's window closed: the trial does not go, nothing is held, and the day is not spent", shut.sent === false && shut.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(shut));
  openWindow(env, OWNER);
  // the latest real delivery of anyone: another customer's, an hour ago
  ord(8500, CUST2, "delivered", `${DAY} 15:00`); line(4501, 8500, 2, 21, 6); line(4502, 8500, 1, 11, 2);
  const before = books();
  odooLog.length = 0;
  const t = await quiet(() => CF.sendComplaintFormTest(env));
  await settle();
  const f = flowsTo(OWNER)[0], d = dataOf(f);
  assert("the trial: ONE message, to Baraa's number alone, marked «🧪 تجربة», under the trial's purpose", t.sent === true && graph.filter(Boolean).length === 1 && graph.filter(Boolean)[0].to === OWNER && bodyOf(f).startsWith("🧪 تجربة — ⚠️ عندي ملاحظة") && d.t === "🧪 تجربة — عندي ملاحظة — براء"
    && rows("x_wa_message").every((m: any) => !/"purpose":"customer_complaint_form"/.test(String(m.x_debug_payload))), bodyOf(f));
  assert("…listing the LATEST real delivered order of anyone (read-only), naming its customer — and saying so", JSON.stringify(d.items.map((x: any) => x.id)) === JSON.stringify(["8500:0", "8500:4501", "8500:4502"]) && d.items.every((x: any) => x.description.includes("بقالة النخيل")) && bodyOf(f).endsWith(CF.COMPLAINT_TEST_REAL_TEXT), JSON.stringify(d.items));
  assert("…read-only: nothing written in Odoo but the message's own record", odooWrites().every(gatewayRecord) && books() === before && complaints().length === 0);
  const again = await quiet(() => CF.sendComplaintFormTest(env));
  assert("a second trial the same day is refused", again.sent === false && again.reason === "already_today" && flowsTo(OWNER).length === 1);
  graph.length = 0; odooLog.length = 0; mediaAsked.length = 0;
  const bad = await reply(env, OWNER, tokenOf(f), { item: "8500:4502", kind: "damaged", qty: "3", photo: [], note: "" });
  assert("the trial refuses as the customer's form does — a fresh trial form, marked", bad.action === "invalid" && JSON.stringify(bad.problems) === JSON.stringify(["over", "photo"]) && flowsTo(OWNER).length === 1 && bodyOf(flowsTo(OWNER)[0]).startsWith("🧪 تجربة — ⚠️ ما انحفظت ملاحظتك:") && dataOf(flowsTo(OWNER)[0]).items.length === 3 && dataOf(flowsTo(OWNER)[0]).t.startsWith("🧪 تجربة — "));
  const r = await reply(env, OWNER, tokenOf(flowsTo(OWNER)[0]), { item: "8500:4502", kind: "damaged", qty: "1", photo: photo("CMPPH_T1"), note: "تجربة" });
  await settle();
  assert("his «إرسال» is answered with what WOULD have been recorded", r.action === "test" && bodyOf(sentTo(OWNER).at(-1)) === [
    "🧪 تجربة — وصلت الملاحظة ✅", "لو كانت ملاحظة عميل لسُجّلت شكوى في Odoo:", "• الطلب #8500 — سُلّم 3 أكتوبر 2026", "• الصنف: طماطم (كرتون)", "• النوع: تالف", "• الكمية المتأثرة: 1",
    "📸 صورة النموذج كانت ستُحفظ مع الملاحظة.", "ملاحظتك: تجربة", "وكان سيصلك ملخصها بأزرار «تعويض بالطلب القادم» و«إشعار دائن» و«رفض».", "(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)",
  ].join("\n"), bodyOf(sentTo(OWNER).at(-1)));
  assert("…and writes NOTHING: no complaint, nothing downloaded from Meta — and reaches nobody else, with no decision button", complaints().length === 0 && books() === before && odooWrites().every(gatewayRecord) && mediaAsked.length === 0 && graph.filter(Boolean).every((b: any) => b.to === OWNER) && ownerNotes().length === 0);
  const trialTok = tokenOf(flowsTo(OWNER)[0]);
  const twice = await reply(env, OWNER, trialTok, good);
  env.MSG_DEDUP.store.delete(`btnlock:v1:complaint_use:${trialTok}`);
  const thrice = await reply(env, OWNER, trialTok, good);
  assert("the trial's token is read once too — marked used, not only locked", twice.action === "duplicate" && thrice.action === "duplicate" && complaints().length === 0);
  // nothing real was ever delivered: the latest order flagged as a simulation
  setRiyadh("2026-10-04 16:00"); openWindow(env, OWNER);
  for (const o of rows("x_daily_order") as any[]) if (!o.x_utak_simulation && !o.x_is_simulation) o.x_state = "cancelled";
  graph.length = 0;
  const s = await quiet(() => CF.sendComplaintFormTest(env));
  const sd = dataOf(flowsTo(OWNER)[0]);
  assert("nothing real was delivered: the latest order flagged as a SIMULATION, and the message says so", s.sent === true && JSON.stringify(sd.items.map((x: any) => x.id)) === JSON.stringify([`${O_SIM_B}:0`, `${O_SIM_B}:4042`]) && bodyOf(flowsTo(OWNER)[0]).endsWith(CF.COMPLAINT_TEST_SIM_TEXT), JSON.stringify(sd.items));
  // nothing at all: a sample, said to be one
  setRiyadh("2026-10-05 16:00"); openWindow(env, OWNER);
  for (const o of rows("x_daily_order") as any[]) o.x_state = "cancelled";
  graph.length = 0;
  const e = await quiet(() => CF.sendComplaintFormTest(env));
  const ed = dataOf(flowsTo(OWNER)[0]);
  assert("nothing delivered at all: a SAMPLE order, each option saying it is one, and the message says so", e.sent === true && ed.items.length === 3 && ed.items.every((x: any) => x.description.includes("عيّنة للتجربة، ليست طلباً")) && ed.items[1].title === "#1 · عيّنة 1" && bodyOf(flowsTo(OWNER)[0]).endsWith(CF.COMPLAINT_TEST_SAMPLE_TEXT), JSON.stringify(ed.items));
  const sample = await reply(env, OWNER, tokenOf(flowsTo(OWNER)[0]), { item: "1:2", kind: "short", qty: "2", note: "" });
  assert("the sample's trial is answered from the rows it showed (none of them is in Odoo)", sample.action === "test" && bodyOf(sentTo(OWNER).at(-1)).includes("• الصنف: عيّنة 2 (كرتون)") && bodyOf(sentTo(OWNER).at(-1)).includes("• النوع: ناقص") && !bodyOf(sentTo(OWNER).at(-1)).includes("📸") && complaints().length === 0, bodyOf(sentTo(OWNER).at(-1)));
  // Odoo down while the trial reads: a sample still goes
  setRiyadh("2026-10-06 16:00"); openWindow(env, OWNER);
  graph.length = 0;
  odooDown = "x_daily_order";
  const down = await quiet(() => CF.sendComplaintFormTest(env));
  odooDown = "";
  assert("his orders cannot be read: the trial still goes, on the sample", down.sent === true && bodyOf(flowsTo(OWNER)[0]).endsWith(CF.COMPLAINT_TEST_SAMPLE_TEXT));
  // the hook
  const hookEnv = { ...env, ODOO_HOOK_TOKEN: "HOOK" };
  const post = (q: string, e2: any = hookEnv) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/complaint-form-test${q}`, { method: "POST" }), e2, ctx));
  const no = await post("?token=nope"), none = await post(""), unset = await post("?token=", env);
  assert("POST /odoo/hook/complaint-form-test without the hook's token: 401, nothing sent", no.status === 401 && none.status === 401 && unset.status === 401 && flowsTo(OWNER).length === 1);
  const body = await (await post("?token=HOOK")).json() as any;
  assert("…with it: the worker's own answer (today's trial already went)", body.ok === true && body.sent === false && body.reason === "already_today", JSON.stringify(body));
  setRiyadh("2026-10-07 16:00"); openWindow(env, OWNER);
  const next = await (await post("?token=HOOK")).json() as any;
  assert("…and the next day it sends one", next.ok === true && next.sent === true && flowsTo(OWNER).length === 2, JSON.stringify(next));
  const idx = srcOf("index.ts");
  assert("the hook stands right before the custody form's", idx.indexOf("url.pathname === \"/odoo/hook/complaint-form-test\"") > 0 && idx.indexOf("url.pathname === \"/odoo/hook/complaint-form-test\"") < idx.indexOf("url.pathname === \"/odoo/hook/custody-form-test\"") && idx.indexOf("url.pathname === \"/odoo/hook/complaint-form-test\"") > idx.indexOf("url.pathname === \"/odoo/hook/carload-form-test\""));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  assert("the four purposes: the form, the decision (important, 48h) and Baraa's note are replies (one refusal never stops the next), the trial his own", PURPOSES.customer_complaint_form?.kind === "reply" && PURPOSES.customer_complaint_decision?.kind === "reply" && PURPOSES.customer_complaint_decision.important === true
    && JSON.stringify(PURPOSES.customer_complaint_decision.ttl) === JSON.stringify({ hours: 48 }) && PURPOSES.owner_complaint_notice?.kind === "reply" && PURPOSES.complaint_form_test?.kind === "operational"
    && CF.COMPLAINT_PURPOSE === "customer_complaint_form" && CF.COMPLAINT_DECISION_PURPOSE === "customer_complaint_decision" && CF.COMPLAINT_OWNER_PURPOSE === "owner_complaint_notice" && CF.COMPLAINT_TEST_PURPOSE === "complaint_form_test");
  const x = { kind: "session" as const, body: { type: "text", text: { body: "x" } } };
  const d = async (purpose: string, to: string) => gatewayDecision(await quiet(() => sendViaGateway(env, { purpose, to: "+" + to, content: x })))?.action;
  assert("the gateway refuses Baraa's note and the trial to any number but his, and the customer's two purposes to his", (await d("owner_complaint_notice", C1_PHONE)) === "refused" && (await d("complaint_form_test", C1_PHONE)) === "refused" && (await d("customer_complaint_form", OWNER)) === "refused" && (await d("customer_complaint_decision", OWNER)) === "refused"
    && (await d("owner_complaint_notice", OWNER)) === "session" && (await d("customer_complaint_form", C1_PHONE)) === "session" && (await d("complaint_form_test", OWNER)) === "session");
  // privacy: no price of ours, either side
  odooLog.length = 0; graph.length = 0;
  const { id } = await note(env, good, { words: "عندي شكوى" });
  await tap(env, `cmp_comp_${id}`);
  const reads = odooLog.filter((c: any) => /^(search_read|search|read)$/.test(c.method));
  assert("no purchase or pricing model is read, and no price field of an order line", !reads.some((c: any) => /^(x_daily_price|x_price_offer|x_price_day|x_price_day_line|x_pricing_config|x_operating_cost|x_purchase_list|x_supplier_due|x_invoice|x_payment|purchase\.)/.test(c.model))
    && reads.some((c: any) => c.model === "x_daily_order_line") && !reads.some((c: any) => /^x_daily_order/.test(c.model) && (c.body?.fields ?? []).some((f: string) => /price|subtotal|total/.test(f))), JSON.stringify([...new Set(reads.map((c: any) => c.model))]));
  assert("nothing sent carries a price, a cost or a profit: not 77.77, 88.88, nor «ر.س», «سعر», «شراء», «ربح», «تكلفة»", graph.filter(Boolean).length >= 5 && !/77\.77|88\.88|ر\.س|سعر|شراء|ربح|تكلفة|هامش/.test(JSON.stringify(graph)));
  const code = srcOf("complaint-form.ts").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert("src/complaint-form.ts names no price, cost or profit field and no pricing module", !/x_[a-z_]*(price|cost|profit|margin|subtotal)/i.test(code) && !/from "\.\/(pricing-engine|prices|price-review|purchase-accounting|operating-cost|invoice|accounting)"/.test(code));
  assert("its id at Meta is a constant the tests never read the value of", typeof CF.COMPLAINT_FLOW_ID === "string" && /export const COMPLAINT_FLOW_ID = "\d+";/.test(srcOf("complaint-form.ts")));
  assert("the complaint is still made by createComplaint in src/odoo-v6-append.ts — the form writes x_complaint nowhere else", !/"x_complaint"/.test(code) && /createComplaint\(env, \{/.test(code) && typeof V6.createComplaint === "function" && typeof V6.writeComplaintDecision === "function");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ12
console.log("\n[هـ12] the guide: the team's page on the complaint form");
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  const at = guide.indexOf("## نموذج «عندي ملاحظة» — الشكوى (§ 57)"), section = guide.slice(at, guide.indexOf("\n## ", at + 5));
  assert("OPERATING-DAY carries «نموذج «عندي ملاحظة»», once, right before «نماذج التشغيل الأربعة»", at > 0 && guide.split("## نموذج «عندي ملاحظة»").length === 2 && guide.indexOf("\n## ", at + 5) === guide.indexOf("\n## نماذج التشغيل الأربعة (§ 55)") && at > guide.indexOf("## نموذج تسجيل العميل (§ 53)"), String(at));
  assert("…the three doors: «شكوى» or «مشكلة», a message read as a complaint, the button under «تم توصيل طلبك»", section.includes("«شكوى»") && section.includes("«مشكلة»") && /يفهمها النظام شكوى/.test(section) && section.includes("«⚠️ عندي ملاحظة»") && section.includes("«تم توصيل طلبك»") && /لا يظهر على قالب/.test(section));
  assert("…seven days, the one list, the five kinds", /خلال آخر 7 أيام/.test(section) && section.includes("«الطلب كله»") && section.includes("تالف / ناقص / جودة / تأخير / أخرى") && /60 خياراً/.test(section));
  assert("…what the customer reads, to the letter, at each step", section.includes("«وصلت ملاحظتك رقم #N ونرد عليك اليوم»") && (["compensate_next", "credit_note", "rejected"] as const).every((v) => section.includes(`«${CF.complaintDecisionText(v, 7).replace("#7", "#N")}»`)));
  assert("…Baraa's three buttons, the second tap, and that nothing else is written", Object.values(CF.COMPLAINT_DECISIONS).every((x: any) => section.includes(`**«${x.title}»**`)) && section.includes("«سبق تسجيله»") && section.includes("**لا يُكتب غير ذلك**"));
  assert("…that the compensation and the credit note stay manual, pointing at «الإشعار الدائن»", section.includes("**التعويض والإشعار الدائن لا ينفّذهما النظام**") && section.includes("**أضف التعويض بنفسك**") && section.includes("**أصدر الإشعار الدائن يدوياً**") && section.includes("«الإشعار الدائن»") && guide.includes("\n## الإشعار الدائن (مرتجع / تالف بعد التسليم)"));
  assert("…what refuses the form, the photo that could not be downloaded, and who never gets it", /يُرفض النموذج كله/.test(section) && section.includes("**بلا صورة والنوع تالف أو جودة**") && /تُسجَّل بلا صورة/.test(section) && /مصدر أسعار/.test(section) && /ولا أي سعر/.test(section));
  assert("…that no complaint is made when the form goes, and the complaint of before when it cannot", section.includes("**لا تُسجَّل شكوى عند خروج النموذج**") && /يبقى الرد كما كان/.test(section));
  assert("…and the trial", /«🧪 تجربة»/.test(section) && /لا يكتب شيئاً في Odoo/.test(section));
}

done();

async function assertThrows(name: string, fn: () => Promise<unknown>): Promise<void> {
  let threw = false;
  try { await fn(); } catch { threw = true; }
  assert(name, threw);
}
