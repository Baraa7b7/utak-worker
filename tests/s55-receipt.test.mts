// § 55 د (2026-10-05) — the buyer's receipt of the purchases as a WhatsApp Flow (utak_receipt_v1).
//
//   [د1] the Flow at Meta against what the worker sends: two screens, thirty quantity fields, five
//        cash-market rows, ONE PhotoPicker by Meta's rules, every data key declared with its type
//   [د2] the session button «📥 استلام المشتريات» in place of «تم الشراء ✅»; the Meta template untouched
//   [د3] who gets the form and when: the tap, «استلام», a member who is not the buyer, the window, the
//        roster, a list already confirmed, before «بدء الدوام»; a form that cannot go
//   [د4] everything received as ordered: exactly what «تم الشراء» does, and nothing to Baraa
//   [د5] a shortfall, a surplus and an item received 0: the list's JSON, the vendor bill plan and the
//        dues by the RECEIVED quantities; what he is told and what Baraa is told
//   [د6] cash-market rows: ONE pending payment with its note; an incomplete row; a row with no item
//   [د7] a bad quantity: the whole form refused, nothing written, a fresh form
//   [د8] the photo: in the reply (kept on the list), none (the 60-minute window and its ask), a download
//        that fails
//   [د9] the token: another number, a second use, a list already confirmed, the lock of «تم الشراء»
//   [د10] more than thirty items
//   [د11] «تم الشراء» (the template's payload) as before
//   [د12] privacy: no price of ours in the form or its message; his own prices to Baraa and to him alone
//   [د13] the trial to Baraa: nothing written, nothing confirmed, nothing downloaded
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s55-receipt.test.mts

import { readFileSync } from "node:fs";
import { COLL, CUST_PHONE, OWNER, WH, closeOwnerWindow, computes, graph, heldFor, inbound, odooLog, openWindow, partnerOf, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, C1, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, done, fresh, rejected, setExtract } from "./s46-kit.mts";

// the tax invoice's photo at Meta (GET the media, then its bytes): a known id answers, any other is not found
const MEDIA_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4]);
const mediaCalls: string[] = [];
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const mm = /graph\.facebook\.com\/[^/]+\/(RCPH_[A-Z0-9]+)$/.exec(url);
  if (mm) {
    mediaCalls.push(mm[1]);
    if (mm[1].startsWith("RCPH_BAD")) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    return new Response(JSON.stringify({ url: `https://media.test/${mm[1]}`, mime_type: "image/jpeg", file_size: MEDIA_BYTES.length }), { status: 200 });
  }
  if (url.startsWith("https://media.test/RCPH_")) return new Response(MEDIA_BYTES, { status: 200 });
  return kitFetch(input as any, init);
}) as typeof fetch;

const RC = await import("../src/receipt-form.ts");
const TEAM = await import("../src/team.ts");
const PI = await import("../src/purchase-invoice.ts");
const PA = await import("../src/purchase-accounting.ts");
const SP = await import("../src/supplier-pay.ts");
const META = await import("../src/meta.ts");
const { dispatch } = await import("../src/router.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s55-flows.mjs");

const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const count = (s: string) => [...String(s)].length;
const OMAR = DRIVER, OMAR_PHONE = DRIVER_PHONE;
const LIST_DAY = "2026-10-02";               // the list of the evening before: DAY (2026-10-03) is the morning he buys
const CASH = 104;
const MKT = "مشتريات السوق النقدية";
/** The list's lines: [product, packaging, name, packaging name, ordered, the list's purchase price]. */
const LINES: Array<[number, number, string, string, number, number]> = [
  [1, 11, "طماطم", "كرتون", 5, 17.35],
  [2, 21, "خيار", "جرم", 4, 23.45],
  [3, 31, "بطاطس", "كرتون", 3, 16.15],
  [4, 41, "بصل", "جرم", 2, 11.85],
];
let spSeq = 0;
// the tenant's on-create automation: a payment's reference
computes["x_supplier_payment"] = (r) => { if (!r.x_name) r.x_name = `SP-2026-${String(++spSeq).padStart(4, "0")}`; };

/** The tenant's morning: Omar is the buyer, the driver and the collector; Ahmed the supplier; «مشتريات السوق النقدية». */
function world(riyadh = `${DAY} 03:00`): any {
  const env = fresh(riyadh); setExtract(null);
  table("hr.employee").delete(7000 + WH); table("hr.employee").delete(7000 + COLL);
  table("hr.employee").get(OMAR_EMP)!.x_utak_role_ids = [71, 72, 73];
  seed("res.partner", { id: CASH, name: MKT, ref: "UTAK-CASH-MARKET", supplier_rank: 1 });
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  openWindow(env, OMAR_PHONE);
  return env;
}
/** A sent purchase list of LIST_DAY, an order behind it, and Ahmed's prices of that day for its lines (`unpriced`: products without one). */
function listOf(o: { lines?: typeof LINES; status?: string; unpriced?: number[]; extra?: Record<string, unknown> } = {}): number {
  const lines = o.lines ?? LINES;
  const order = seed("x_daily_order", { x_customer_id: C1, x_state: "in_purchase", x_order_date: LIST_DAY, x_created_via: "whatsapp", x_delivery_neighborhood: "العليا" });
  for (const [p, k, , , q] of lines.slice(0, 4)) seed("x_daily_order_line", { x_order_id: order, x_product_tmpl_id: p, x_packaging_id: k, x_quantity: q, x_unit_price: 33.33, x_status: "pending" });
  for (const [p, k, , , , price] of lines) {
    if (!(o.unpriced ?? []).includes(p)) seed("x_daily_price", { x_product_tmpl_id: p, x_packaging_id: k, x_supplier_id: AHMED, x_price_sar: price, x_date: LIST_DAY, x_extraction_status: "extracted" });
  }
  const items = lines.map(([p, k, name, pack, q, price]) => ({ product_id: p, product_name: name, packaging_id: k, packaging_name: pack, total_quantity: q, order_ids: [order], unit_price: price, price_supplier_id: AHMED }));
  return seed("x_purchase_list", { x_date: LIST_DAY, x_status: o.status ?? "sent", x_supplier_id: AHMED, x_aggregated_items: JSON.stringify(items), x_total_items_count: items.length, x_utak_simulation: false, ...(o.extra ?? {}) });
}
const listRow = (id: number) => table("x_purchase_list").get(id) as any;
const itemsOf = (id: number): any[] => JSON.parse(String(listRow(id).x_aggregated_items));
function collectingCtx(): any { const tasks: Promise<unknown>[] = []; return { tasks, waitUntil: (p: Promise<unknown>) => { tasks.push(p); }, passThroughOnException: () => {} }; }
/** An inbound message through the webhook, every background task awaited. */
async function hook(env: any, from: string, m: Record<string, unknown>): Promise<void> {
  const c = collectingCtx();
  await quiet(async () => { await worker.fetch(signed(inbound(from, m)), env, c); await Promise.all(c.tasks); });
}
const text = (t: string) => ({ type: "text", text: { body: t } });
const button = (id: string) => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } });
const quick = (payload: string) => ({ type: "button", button: { payload, text: "تم الشراء" } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const buttonIds = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => String(x?.reply?.id ?? ""));
const buttonTitles = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => String(x?.reply?.title ?? ""));
const textsTo = (d: string) => sentTo(d).map(bodyOf);
const ownerNotes = () => textsTo(OWNER).filter((t) => t.startsWith("📥 استلام مشتريات"));
const omar = { partnerId: OMAR, name: "عمر المجهلي", whatsapp: "+" + OMAR_PHONE };
/** The form of a list, sent to Omar: its token and its message. */
async function formOf(env: any, listId: number): Promise<{ token: string; msg: any }> {
  const n = flowsTo(OMAR_PHONE).length;
  await quiet(() => RC.sendReceiptForm(env, omar, listId));
  const msg = flowsTo(OMAR_PHONE)[n];
  return { token: tokenOf(msg), msg };
}
/** A reply's values: every quantity as ordered, then `over`. */
const asOrdered = (lines = LINES, over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ ...Object.fromEntries(lines.slice(0, 30).map((l, i) => [`g${i + 1}`, String(l[4])])), ...over });
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => RC.handleReceiptFormReply(env, { from: "+" + from, messageId: `wamid.RC${++wamid}`, flow: { token, values } }, undefined, now));
let mid = 0;
const tapAs = (env: any, buttonId: string, who: number) => quiet(() => dispatch(env, { msg: { from: "+" + OMAR_PHONE, fromRaw: OMAR_PHONE, profileName: "", messageId: `t${++mid}`, type: "button", buttonId, text: "", timestamp: "0" } as any, intent: "other" as any, senderType: "customer", partner: partnerOf(who) as any }));
const payments = () => rows("x_supplier_payment") as any[];
const dues = () => rows("x_supplier_due") as any[];
const dueLines = (dueId: number) => (rows("x_supplier_due_line") as any[]).filter((l) => l.x_due_id === dueId);
const purposeOf = (r: any): string => { try { return JSON.parse(String(r.x_debug_payload ?? "{}")).purpose ?? ""; } catch { return ""; } };
const listWrites = (id: number) => odooLog.filter((c: any) => c.model === "x_purchase_list" && c.method === "write" && (c.body?.ids ?? []).includes(id)).length;

// ================================================================ د1
console.log("\n[د1] utak_receipt_v1 at Meta is the form the worker fills: two screens, no endpoint, one PhotoPicker");
{
  const json = LIB.buildReceiptFlowJson();
  const [a, b] = json.screens;
  const kidsA = a.layout.children, kidsB = b.layout.children;
  assert("Flow JSON 6.0, two screens RECEIPT_A → RECEIPT_B, the route stated, no endpoint", json.version === "6.0" && JSON.stringify(json.screens.map((s: any) => s.id)) === JSON.stringify(["RECEIPT_A", "RECEIPT_B"])
    && JSON.stringify(json.routing_model) === JSON.stringify({ RECEIPT_A: ["RECEIPT_B"], RECEIPT_B: [] }) && !("data_api_version" in json) && !JSON.stringify(json).includes("data_exchange") && LIB.RECEIPT_FLOW_NAME === "utak_receipt_v1");
  assert("the worker's constants are the Flow's: the first screen, the thirty slots, the five rows, the photos a reply carries, the button", RC.RECEIPT_FLOW_SCREEN === LIB.RECEIPT_FIRST_SCREEN && RC.RECEIPT_FLOW_CASH_SCREEN === LIB.RECEIPT_CASH_SCREEN
    && RC.RECEIPT_FLOW_SLOTS === LIB.RECEIPT_SLOTS && LIB.RECEIPT_SLOTS === 30 && RC.RECEIPT_CASH_ROWS === LIB.RECEIPT_CASH_ROWS && LIB.RECEIPT_CASH_ROWS === 5 && RC.RECEIPT_PHOTO_MAX === LIB.RECEIPT_PHOTO_MAX && RC.RECEIPT_CTA === LIB.RECEIPT_CTA && count(LIB.RECEIPT_CTA) <= 20);
  assert("its id is not pinned yet («0»: the Flow is created at Meta after the merge)", RC.RECEIPT_FLOW_ID === "0");
  assert("the components sit directly under SingleColumnLayout (no Form wrapper), within Meta's fifty a screen: 33 and 24", json.screens.every((s: any) => s.layout.type === "SingleColumnLayout" && !s.layout.children.some((c: any) => c.type === "Form") && LIB.screenComponents(s).length <= LIB.SCREEN_COMPONENTS_MAX)
    && kidsA.length === 33 && kidsB.length === 24, JSON.stringify([kidsA.length, kidsB.length]));
  assert("only the last screen ends the Flow", !a.terminal && b.terminal === true && b.success === true);
  const inputsA = kidsA.filter((c: any) => c.type === "TextInput");
  assert("RECEIPT_A: a heading, a line of text, thirty number fields g1 … g30, then «التالي» to RECEIPT_B", kidsA[0].type === "TextHeading" && kidsA[0].text === "${data.t1}" && kidsA[1].type === "TextBody" && kidsA[1].text === "${data.n1}"
    && inputsA.length === 30 && inputsA.every((c: any, i: number) => c.name === `g${i + 1}` && c["input-type"] === "number")
    && kidsA.at(-1).type === "Footer" && kidsA.at(-1).label === "التالي" && kidsA.at(-1)["on-click-action"].name === "navigate" && kidsA.at(-1)["on-click-action"].next.name === "RECEIPT_B");
  assert("…each field: the item's name, its hint, the quantity ordered as its opening value, shown — and required — by v<n>", inputsA.every((c: any, i: number) => c.label === `\${data.l${i + 1}}` && c["helper-text"] === `\${data.h${i + 1}}` && c["init-value"] === `\${data.i${i + 1}}` && c.visible === `\${data.v${i + 1}}` && c.required === `\${data.v${i + 1}}`));
  const rowsB = kidsB.slice(2, 22);
  assert("RECEIPT_B: a heading and a line (RECEIPT_A's data), FIVE rows of four fields — the item (a list), the quantity, the price paid, the seller", kidsB[0].type === "TextHeading" && kidsB[0].text === "${screen.RECEIPT_A.data.t2}" && kidsB[1].text === "${screen.RECEIPT_A.data.n2}"
    && [0, 1, 2, 3, 4].every((k) => JSON.stringify(rowsB.slice(k * 4, k * 4 + 4).map((c: any) => [c.type, c.name, c["input-type"] ?? ""])) === JSON.stringify([["Dropdown", `ci${k + 1}`, ""], ["TextInput", `cq${k + 1}`, "number"], ["TextInput", `cp${k + 1}`, "number"], ["TextInput", `cs${k + 1}`, "text"]])));
  assert("…none of them required (the screen is optional), and every row's list reads the same options", rowsB.every((c: any) => c.required === false) && rowsB.filter((c: any) => c.type === "Dropdown").every((c: any) => c["data-source"] === "${screen.RECEIPT_A.data.items}"));
  const pickers = LIB.screenComponents(b).filter((c: any) => c.type === "PhotoPicker");
  const picker = pickers[0];
  assert("ONE PhotoPicker `photo` on RECEIPT_B — a direct child, never inside If / Switch — and none on RECEIPT_A", pickers.length === 1 && kidsB[22] === picker && picker.name === "photo" && !LIB.screenComponents(a).some((c: any) => c.type === "PhotoPicker") && !JSON.stringify(json).includes('"If"') && !JSON.stringify(json).includes('"Switch"'));
  assert("…optional by min-uploaded-photos 0 (it has no `required`), max-uploaded-photos stated — the one constant (1) — and its texts within 80 and 300", !("required" in picker) && picker["min-uploaded-photos"] === 0 && picker["max-uploaded-photos"] === LIB.RECEIPT_PHOTO_MAX && LIB.RECEIPT_PHOTO_MAX === 1
    && picker.label === "صورة الفاتورة الضريبية" && count(picker.label) <= 80 && count(picker.description) <= 300 && !("init-value" in picker) && picker["max-file-size-kb"] === LIB.RECEIPT_PHOTO_MAX_KB, JSON.stringify(picker));
  const foot = kidsB.at(-1), pay = foot["on-click-action"].payload;
  assert("«إرسال» completes with every g<n> of RECEIPT_A, the five rows, and the photo: 51 keys", foot.type === "Footer" && foot.label === "إرسال" && foot["on-click-action"].name === "complete" && Object.keys(pay).length === 51
    && pay.g1 === "${screen.RECEIPT_A.form.g1}" && pay.g30 === "${screen.RECEIPT_A.form.g30}" && pay.ci1 === "${form.ci1}" && pay.cq5 === "${form.cq5}" && pay.cp3 === "${form.cp3}" && pay.cs5 === "${form.cs5}");
  assert("…the photo is a TOP-LEVEL string property of the `complete` payload, and in no `navigate` payload", pay.photo === "${form.photo}" && Object.values(pay).every((v) => typeof v === "string") && JSON.stringify(kidsA.at(-1)["on-click-action"].payload) === "{}");
  const statics = [...kidsA, ...kidsB].filter((c: any) => c.type === "TextInput" || c.type === "Dropdown");
  assert("every fixed label within Meta's twenty characters, every fixed helper within eighty; no empty text and no null anywhere", statics.every((c: any) => c.label.startsWith("${") || count(c.label) <= 20) && statics.every((c: any) => !c["helper-text"] || c["helper-text"].startsWith("${") || count(c["helper-text"]) <= 80)
    && !JSON.stringify(json).includes(":null") && statics.every((c: any) => c["helper-text"] !== ""), statics.filter((c: any) => !c.label.startsWith("${") && count(c.label) > 20).map((c: any) => c.label).join("|"));
  assert("the rows' lists are numbered — «الصنف 1» … «الصنف 5» — so a row is told from the next", JSON.stringify(rowsB.filter((c: any) => c.type === "Dropdown").map((c: any) => c.label)) === JSON.stringify(["الصنف 1", "الصنف 2", "الصنف 3", "الصنف 4", "الصنف 5"]));
  const model = a.data;
  assert("RECEIPT_A declares 125 keys — t1 n1 t2 n2, the rows' options, and l / h / i / v of thirty slots — and RECEIPT_B none", Object.keys(model).length === 125 && ["t1", "n1", "t2", "n2", "items", "l30", "h30", "i30", "v30"].every((k) => k in model) && Object.keys(b.data).length === 0);
  assert("§ 55's Flows are the review's and the receipt's", LIB.FLOWS.some((f: any) => f.key === "receipt" && f.name === "utak_receipt_v1" && f.first === "RECEIPT_A" && f.build === LIB.buildReceiptFlowJson) && LIB.FLOWS.some((f: any) => f.key === "review"));

  const env = world();
  const list = listOf();
  const { msg } = await formOf(env, list);
  const d = dataOf(msg);
  const typeOf = (v: unknown) => (Array.isArray(v) ? "array" : typeof v);
  assert("every key the worker sends is declared on RECEIPT_A, every declared key is sent, each of its declared type", JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(model).sort()) && Object.keys(d).every((k) => typeOf(d[k]) === model[k].type), Object.keys(d).filter((k) => !(k in model)).join(","));
  assert("the message opens utak_receipt_v1 on RECEIPT_A with the data (navigate), under «استلام المشتريات»", par(msg).flow_id === RC.RECEIPT_FLOW_ID && par(msg).flow_action === "navigate" && par(msg).flow_action_payload.screen === "RECEIPT_A" && par(msg).flow_cta === "استلام المشتريات" && par(msg).flow_message_version === "3");
  assert("what it sends obeys Meta's limits: labels ≤ 20, hints ≤ 80, option titles ≤ 30, at most 200 options, no null, no empty label or hint", [...Array(30)].every((_, i) => count(d[`l${i + 1}`]) <= 20 && count(d[`h${i + 1}`]) <= 80 && d[`l${i + 1}`] !== "" && d[`h${i + 1}`] !== "")
    && d.items.length <= 200 && d.items.every((o: any) => count(o.title) <= 30 && o.title && o.id) && !JSON.stringify(d).includes("null"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د2
console.log("\n[د2] the session button: «📥 استلام المشتريات» in place of «تم الشراء ✅»; the Meta template untouched");
{
  const b = TEAM.purchaseListButtons(7);
  assert("the session buttons of a purchase list: prc_7 «📥 استلام المشتريات», then «مشكلة ⚠️» as before", JSON.stringify(b) === JSON.stringify([{ id: "prc_7", title: "📥 استلام المشتريات" }, { id: "purchase_issue_7", title: "مشكلة ⚠️" }]));
  assert("…the title within a reply button's twenty characters, and the payload is the one the router reads", RC.RECEIPT_BUTTON_TITLE.length <= 20 && RC.RECEIPT_BUTTON_RE.test("prc_7") && !RC.RECEIPT_BUTTON_RE.test("prc_7x") && !RC.RECEIPT_BUTTON_RE.test("purchase_done_7"));
  // the list sent again (any message from the buyer, his «بدء الدوام»): a session message
  const env = world();
  const list = listOf();
  await quiet(() => TEAM.resendOpenPurchaseLists(env, "+" + OMAR_PHONE));
  const again = sentTo(OMAR_PHONE).at(-1);
  assert("the open list sent again carries «📥 استلام المشتريات» and «مشكلة ⚠️» — no «تم الشراء» button", JSON.stringify(buttonIds(again)) === JSON.stringify([`prc_${list}`, `purchase_issue_${list}`]) && JSON.stringify(buttonTitles(again)) === JSON.stringify(["📥 استلام المشتريات", "مشكلة ⚠️"]) && bodyOf(again).includes(`قائمة الشراء #${list}`), JSON.stringify(again?.interactive?.action));
  // the 06:00 reminder: the approved template first — its quick replies are Meta's own
  graph.length = 0;
  await quiet(() => TEAM.followUpUnconfirmedPurchaseLists(env));
  const tpl = sentTo(OMAR_PHONE).find((x: any) => x?.type === "template");
  const payloads = (tpl?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => c.parameters?.[0]?.payload);
  assert("the Meta template keeps its quick replies: purchase_done_<list> and purchase_issue_<list>", tpl?.template?.name === "utak_purchase_list_v2" && JSON.stringify(payloads) === JSON.stringify([`purchase_done_${list}`, `purchase_issue_${list}`]), JSON.stringify(tpl?.template));
  assert("…in the source too: both template options still carry purchase_done_<list>", srcOf("team.ts").split("payload: `purchase_done_${listId}`").length - 1 === 2);
  // no usable template: the reminder's session form
  const env2 = world();
  const list2 = listOf();
  for (const t of rows("x_whatsapp_template") as any[]) if (String(t.x_purpose).startsWith("purchase_list")) t.x_meta_status = "REJECTED";
  await quiet(() => TEAM.followUpUnconfirmedPurchaseLists(env2));
  const sess = sentTo(OMAR_PHONE).find((x: any) => x?.interactive?.type === "button");
  assert("with no usable template the reminder is the session message: the same two buttons, and its text names «📥 استلام المشتريات»", JSON.stringify(buttonIds(sess)) === JSON.stringify([`prc_${list2}`, `purchase_issue_${list2}`]) && bodyOf(sess).includes("اضغط «📥 استلام المشتريات» لما تخلّص") && !bodyOf(sess).includes('"تم الشراء"'), bodyOf(sess));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د3
console.log("\n[د3] who gets the form, and when");
{
  const env = world();
  const list = listOf();
  await hook(env, OMAR_PHONE, button(`prc_${list}`));
  const f = flowsTo(OMAR_PHONE);
  assert("the buyer taps «📥 استلام المشتريات» → ONE form, to him alone, and nothing else is answered", f.length === 1 && graph.filter((x: any) => x?.interactive?.type === "flow").every((x: any) => x.to === OMAR_PHONE) && sentTo(OMAR_PHONE).length === 1, JSON.stringify(sentTo(OMAR_PHONE).map(bodyOf)));
  const d = dataOf(f[0]);
  assert("its fields: the list's four items by name, each opened on the quantity ordered; the other slots hidden", JSON.stringify([1, 2, 3, 4].map((n) => [d[`l${n}`], d[`i${n}`], d[`v${n}`]])) === JSON.stringify([["طماطم", "5", true], ["خيار", "4", true], ["بطاطس", "3", true], ["بصل", "2", true]])
    && d.v5 === false && d.l5 === "-" && d.h5 === "-" && d.i5 === "" && d.v30 === false);
  assert("the hint: the packaging, «المطلوب N», and the supplier's name", d.h1 === "كرتون · المطلوب 5 · أحمد حسان" && d.h2 === "جرم · المطلوب 4 · أحمد حسان", `${d.h1} | ${d.h2}`);
  assert("the two headings and their lines", d.t1 === "ما استلمته من الموردين" && d.t2 === "مشتريات السوق النقدي" && d.n1 === RC.RECEIPT_NOTE_A && d.n2 === RC.RECEIPT_NOTE_B && /اختياري/.test(d.n2));
  assert("the rows' options: the list's own items first, then every other active item — id «product:packaging», the name with its packaging", JSON.stringify(d.items.slice(0, 4)) === JSON.stringify([{ id: "1:11", title: "طماطم — كرتون" }, { id: "2:21", title: "خيار — جرم" }, { id: "3:31", title: "بطاطس — كرتون" }, { id: "4:41", title: "بصل — جرم" }]) && d.items.length === 4, JSON.stringify(d.items));
  assert("the message: the list, its day, how many items, and what to do", bodyOf(f[0]).split("\n")[0] === `📥 استلام مشتريات قائمة الشراء #${list} (2 أكتوبر 2026): 4 أصناف.` && bodyOf(f[0]).includes("0 لو ما استلمته") && bodyOf(f[0]).includes("«إرسال»"), bodyOf(f[0]));
  const row = (rows("x_wa_message") as any[]).find((r) => String(r.x_body ?? "").includes("استلام مشتريات قائمة"));
  assert("it goes under the team's purpose purchase_receipt_form — operational, not important, not critical", purposeOf(row) === "purchase_receipt_form" && RC.RECEIPT_PURPOSE === "purchase_receipt_form" && PURPOSES.purchase_receipt_form?.kind === "operational" && !PURPOSES.purchase_receipt_form.important && !PURPOSES.purchase_receipt_form.critical, purposeOf(row));
  const rec = JSON.parse(env.MSG_DEDUP.store.get(RC.receiptFormKey(tokenOf(f[0]))));
  assert("its token (rc1.…) is kept with the list, the items as shown, the rows' options and the number it went to", RC.isReceiptFormToken(tokenOf(f[0])) && rec.listId === list && rec.to === OMAR_PHONE && rec.partnerId === OMAR && rec.items.length === 4 && rec.catalog.length === 4 && rec.items[0].ordered === 5 && !rec.test);
  assert("the tap alone changes nothing: the list is still open", listRow(list).x_status === "sent" && listWrites(list) === 0);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // Meta's limits on what the worker fills
  const long = RC.receiptSlotTexts("[UTAK-VEG-001] طماطم بلدي حمراء طازجة من مزارع القصيم", "كرتون كبير 10 كيلو", 12.5, "مؤسسة أحمد حسان للخضار والفواكه الطازجة بالجملة في سوق عتيقة المركزي بالرياض");
  assert("a long name is cut to Meta's twenty characters and a long hint to eighty; the product's code is dropped", count(long.label) === 20 && long.label.endsWith("…") && long.label.startsWith("طماطم بلدي") && count(long.hint) === 80 && long.hint.startsWith("كرتون كبير 10 كيلو · المطلوب 12.5 · مؤسسة"), `${long.label} | ${long.hint}`);
  assert("no supplier, or no packaging: the hint has no empty part", RC.receiptSlotTexts("خس", "كرتون", 2, "").hint === "كرتون · المطلوب 2" && RC.receiptSlotTexts("خس", "", 2, "أحمد").hint === "المطلوب 2 · أحمد");
  const env = world();
  seed("x_product_packaging", { id: 22, x_name: "فلين", x_product_tmpl_id: 2, x_is_default: false });      // a packaging that is not the default one
  for (let i = 0; i < 210; i++) { seed("product.template", { id: 500 + i, name: `صنف نشط ${i + 1}`, sale_ok: true, x_is_active_for_sale: true }); seed("x_product_packaging", { id: 5000 + i, x_name: "كرتون", x_product_tmpl_id: 500 + i, x_is_default: true }); }
  const cat = await quiet(() => RC.receiptCatalog(env, [
    { product_id: 2, product_name: "خيار", packaging_id: 22, packaging_name: "فلين", total_quantity: 3, order_ids: [] },
    { product_id: 1, product_name: "طماطم بلدي حمراء طازجة من مزارع القصيم", packaging_id: 11, packaging_name: "كرتون كبير", total_quantity: 2, order_ids: [] },
  ]));
  assert("the options: the list's own lines first — a packaging no active item offers among them — then the active items, never more than Meta's two hundred", cat.length === 200 && cat[0].id === "2:22" && cat[0].title === "خيار — فلين" && cat[1].id === "1:11" && cat[2].id === "2:21" && new Set(cat.map((o: any) => o.id)).size === 200, JSON.stringify(cat.slice(0, 3)));
  assert("a long option is cut to thirty characters — its full name kept for the messages", count(cat[1].title) === 30 && cat[1].title.endsWith("…") && cat[1].name === "طماطم بلدي حمراء طازجة من مزارع القصيم (كرتون كبير)");
}
{
  // «استلام» as a text
  const env = world();
  const older = listOf({ extra: { x_date: "2026-10-01" } });
  const list = listOf();
  await hook(env, OMAR_PHONE, text("استلام"));
  assert("«استلام» from the buyer → the form of his open list — the most recent one", flowsTo(OMAR_PHONE).length === 1 && JSON.parse(env.MSG_DEDUP.store.get(RC.receiptFormKey(tokenOf(flowsTo(OMAR_PHONE)[0])))).listId === list && list > older && sentTo(OMAR_PHONE).length === 1, JSON.stringify(textsTo(OMAR_PHONE)));
  await hook(env, OMAR_PHONE, text("استلام المشتريات"));
  assert("«استلام المشتريات» too", flowsTo(OMAR_PHONE).length === 2);
  assert("the whole message, nothing else in it: «استلام», «استلام المشتريات», «إستلام», «استلام.» — not «استلام الطلب», «ما استلمت», «استلام المشتريات بكرة»",
    ["استلام", "استلام المشتريات", "إستلام", "استلام.", "  استلام  المشتريات "].every(RC.wantsReceiptForm) && !["استلام الطلب", "ما استلمت", "استلام المشتريات بكرة", "تم الاستلام", ""].some(RC.wantsReceiptForm));
  // a list of more than 36 hours ago is not his open list
  const env2 = world();
  listOf({ extra: { x_date: "2026-09-30" } });
  await hook(env2, OMAR_PHONE, text("استلام"));
  assert("no list open (the only one is older than 36 hours): one line, no form", flowsTo(OMAR_PHONE).length === 0 && JSON.stringify(textsTo(OMAR_PHONE)) === JSON.stringify([RC.RECEIPT_NO_LIST_TEXT]), JSON.stringify(textsTo(OMAR_PHONE)));
  const env3 = world();
  listOf({ status: "done" });
  await hook(env3, OMAR_PHONE, text("استلام"));
  assert("a list already confirmed is not open: the same one line", flowsTo(OMAR_PHONE).length === 0 && textsTo(OMAR_PHONE).at(-1) === RC.RECEIPT_NO_LIST_TEXT);
}
{
  // not the buyer
  const env = world();
  table("hr.employee").get(OMAR_EMP)!.x_utak_role_ids = [72];                       // a driver only
  const list = listOf();
  await hook(env, OMAR_PHONE, button(`prc_${list}`));
  assert("a member who is not the buyer taps prc_<list>: no form, «استلام المشتريات لفريق الشراء فقط.»", flowsTo(OMAR_PHONE).length === 0 && textsTo(OMAR_PHONE).includes(RC.RECEIPT_NOT_ALLOWED_TEXT), JSON.stringify(textsTo(OMAR_PHONE)));
  graph.length = 0;
  await hook(env, OMAR_PHONE, text("استلام"));
  assert("…and his «استلام» is an ordinary message: no form, not the «لا قائمة» line", flowsTo(OMAR_PHONE).length === 0 && !textsTo(OMAR_PHONE).includes(RC.RECEIPT_NO_LIST_TEXT) && !RC.isReceiptCommand("استلام", { x_role: "driver", x_role_codes: ["driver"] }) && RC.isReceiptCommand("استلام", { x_role: "driver", x_role_codes: ["driver", "warehouse"] }));
  const direct = await quiet(() => RC.sendReceiptForm(env, omar, list));
  assert("sendReceiptForm itself refuses him (not_warehouse), and a customer's number", direct.sent === false && direct.reason === "not_warehouse" && (await quiet(() => RC.sendReceiptForm(env, { partnerId: C1, name: "x", whatsapp: "+" + CUST_PHONE }, list))).reason === "not_warehouse");
  // a customer who forges the payload
  openWindow(env, CUST_PHONE);
  const forged = await tapAs(env, `prc_${list}`, C1);
  assert("a customer's prc_<list> opens nothing", forged.text === RC.RECEIPT_NOT_ALLOWED_TEXT && flowsTo(CUST_PHONE).length === 0);
}
{
  const env = world();
  const list = listOf();
  env.MSG_DEDUP.store.delete(`wa_win:v1:${OMAR_PHONE}`);
  const r = await quiet(() => RC.sendReceiptForm(env, omar, list));
  assert("outside his 24h window: no form, no template, nothing held", r.sent === false && r.reason === "window_closed" && sentTo(OMAR_PHONE).length === 0 && heldFor(env, OMAR_PHONE).length === 0, JSON.stringify(r));
  // the gateway itself: a form addressed past the window check is skipped, never held, and its token is dropped
  openWindow(env, OMAR_PHONE);
  const realGet = env.MSG_DEDUP.get.bind(env.MSG_DEDUP);
  let closed = false;
  env.MSG_DEDUP.get = async (k: string) => (closed && k === `wa_win:v1:${OMAR_PHONE}` ? null : realGet(k));
  const realPut = env.MSG_DEDUP.put.bind(env.MSG_DEDUP);
  env.MSG_DEDUP.put = async (k: string, v: string) => { if (k.startsWith("rcform:v1:")) closed = true; return realPut(k, v); };   // the window closes after the form's own check
  const g = await quiet(() => RC.sendReceiptForm(env, omar, list));
  env.MSG_DEDUP.get = realGet; env.MSG_DEDUP.put = realPut;
  assert("…and at the gateway: skipped (noHold), nothing held, the token removed", g.sent === false && /^skipped/.test(String(g.reason)) && heldFor(env, OMAR_PHONE).length === 0 && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("rcform:v1:")), JSON.stringify(g));
}
{
  // a roster that cannot be read
  const env = world();
  const list = listOf();
  env.MSG_DEDUP.store.delete("team:roster:v1");
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => (String(typeof input === "string" ? input : (input as any)?.url).includes("/json/2/hr.employee/") ? new Response("{}", { status: 500 }) : real(input as any, init))) as typeof fetch;
  const r = await quiet(() => RC.sendReceiptForm(env, omar, list));
  const viaTap = await quiet(() => RC.openReceiptForm(env, list, omar));
  globalThis.fetch = real;
  assert("a roster that cannot be read sends no form (unverified): the tap is answered with «تم الشراء ✅» of before, not with a refusal", r.sent === false && r.reason === "unverified" && flowsTo(OMAR_PHONE).length === 0 && viaTap.bodyBeforeButtons === RC.RECEIPT_FALLBACK_TEXT && viaTap.buttons?.[0]?.id === `purchase_done_${list}`, JSON.stringify([r, viaTap]));
}
{
  // a list already confirmed, tapped from an old message
  const env = world();
  const list = listOf({ status: "done" });
  const r = await tapAs(env, `prc_${list}`, OMAR);
  assert("prc_<list> on a list already confirmed: «القائمة مؤكدة من قبل ✅ والمسارات أُرسلت.», no form", r.text === RC.RECEIPT_DONE_TEXT && flowsTo(OMAR_PHONE).length === 0, JSON.stringify(r));
  const gone = await tapAs(env, "prc_99999", OMAR);
  assert("a list that does not exist: one line, no form", gone.text === RC.RECEIPT_NO_LIST_TEXT);
}
{
  // a form that cannot go never blocks the purchase: «تم الشراء ✅» as before, under a line
  const env = world();
  const list = listOf();
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = String(typeof input === "string" ? input : (input as any)?.url);
    if (url.includes("graph.facebook.com") && init?.body && JSON.parse(init.body)?.interactive?.type === "flow") return new Response(JSON.stringify({ error: { message: "(#131009) Parameter value is not valid", code: 131009 } }), { status: 400 });
    return real(input as any, init);
  }) as typeof fetch;
  const r = await tapAs(env, `prc_${list}`, OMAR);
  globalThis.fetch = real;
  assert("Meta refuses the Flow (its id not pinned, say): he is answered with «تم الشراء ✅» of before § 55 — the purchase is never blocked", r.bodyBeforeButtons === RC.RECEIPT_FALLBACK_TEXT && JSON.stringify(r.buttons) === JSON.stringify([{ id: `purchase_done_${list}`, title: "تم الشراء ✅" }]) && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("rcform:v1:")), JSON.stringify(r));
}
{
  // his own report, not a task sent to him: it does not wait for «بدء الدوام» (as «تسليم 12» and the list's buttons do not)
  const env = world(`${DAY} 12:30`);                                                  // his shift (02:00–12:00) has ended
  Object.assign(table("hr.employee").get(OMAR_EMP)!, { x_utak_attendance: true });
  listOf();
  await hook(env, OMAR_PHONE, text("استلام"));
  assert("«استلام» after his shift, with no «بدء الدوام» tapped: the form still opens — a list is never left unconfirmed for it", flowsTo(OMAR_PHONE).length === 1, JSON.stringify(textsTo(OMAR_PHONE)));
}

// ================================================================ د4
console.log("\n[د4] everything received as ordered: exactly what «تم الشراء» does, and nothing to Baraa");
{
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0;
  await hook(env, OMAR_PHONE, nfm(token, asOrdered()));
  const l = listRow(list);
  assert("the reply through the webhook: the list is confirmed (done, its time)", l.x_status === "done" && !!l.x_ahmad_confirmed_at, JSON.stringify({ s: l.x_status }));
  const items = itemsOf(list);
  assert("each line keeps `ordered_quantity`, and `total_quantity` is what was received — here the same", JSON.stringify(items.map((i) => [i.ordered_quantity, i.total_quantity])) === JSON.stringify([[5, 5], [4, 4], [3, 3], [2, 2]]));
  assert("…no other key of a line is touched: its price, its supplier, its orders", items.every((it, i) => it.unit_price === LINES[i][5] && it.price_supplier_id === AHMED && it.order_ids.length === 1 && it.product_name === LINES[i][2]) && l.x_total_items_count === 4);
  assert("the orders' lines are purchased and the driver's route went out, as «تم الشراء» does", (rows("x_daily_order_line") as any[]).every((x) => x.x_status === "purchased") && rows("x_delivery_route").length === 1 && textsTo(OMAR_PHONE).some((t) => t.includes("مسارك اليوم")));
  const due = dues().find((x) => x.x_supplier_id === AHMED);
  assert("Ahmed's due is built at once: 5 × 17.35 + 4 × 23.45 + 3 × 16.15 + 2 × 11.85 = 252.70", due?.x_amount === 252.7 && dueLines(due.id).length === 4, JSON.stringify(due));
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  assert("he is told, in ONE message: all as ordered, then what «تم الشراء» answers — the routes and the photo's ask", bodyOf(ans) === [
    `📥 سُجّل استلام قائمة الشراء #${list} (2 أكتوبر 2026):`,
    "كل الأصناف (4) استُلمت كما طُلبت ✅",
    "تمام 👍 تم إرسال المسارات لـ 1 سواق (1 توصيلة).",
    "📸 أرسل صورة فاتورة الشراء الضريبية",
  ].join("\n"), bodyOf(ans));
  assert("…with «💵 دفعت لمورد» under it", JSON.stringify(buttonIds(ans)) === JSON.stringify(["sp_pay_start"]) && buttonTitles(ans)[0] === "💵 دفعت لمورد");
  assert("Baraa hears nothing of a receipt with no difference and no cash row (the routes' alert is «تم الشراء»'s own)", ownerNotes().length === 0 && textsTo(OWNER).filter((t) => t.includes("تم إرسال المسارات")).length === 1 && payments().length === 0, JSON.stringify(textsTo(OWNER)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
  // the twin: the same list confirmed by the «تم الشراء» payload
  const env2 = world();
  const list2 = listOf();
  const old = await tapAs(env2, `purchase_done_${list2}`, OMAR);
  const due2 = dues().find((x) => x.x_supplier_id === AHMED);
  assert("the twin by «تم الشراء»: the same state, the same due, and its answer is the form's last two lines", listRow(list2).x_status === "done" && due2?.x_amount === 252.7 && old.bodyBeforeButtons === bodyOf(ans).split("\n").slice(-2).join("\n") && JSON.stringify(old.buttons) === JSON.stringify([{ id: "sp_pay_start", title: "💵 دفعت لمورد" }]), String(old.bodyBeforeButtons));
  assert("…«تم الشراء» writes no ordered_quantity: its list stays as ordered", itemsOf(list2).every((i) => !("ordered_quantity" in i)) && RC.receiptRoutesLine(1, 1) === String(old.bodyBeforeButtons).split("\n")[0]);
}

// ================================================================ د5
console.log("\n[د5] a shortfall, a surplus and an item received 0: the list, the vendor bill plan and the dues by what was RECEIVED");
{
  const env = world();
  const list = listOf({ unpriced: [3] });                    // Ahmed sent no price for the potato
  const { token } = await formOf(env, list);
  graph.length = 0;
  const r = await reply(env, OMAR_PHONE, token, { g1: "3", g2: "6", g3: "0", g4: "2" });
  assert("tomato 3 of 5, cucumber 6 of 4, potato 0 of 3, onion 2 of 2 → received", r.action === "received" && r.listId === list && listRow(list).x_status === "done", JSON.stringify(r));
  const items = itemsOf(list);
  assert("the list's JSON: ordered 5 · 4 · 3 · 2 kept, received 3 · 6 · 0 · 2 in total_quantity (more than ordered is taken)", JSON.stringify(items.map((i) => [i.ordered_quantity, i.total_quantity])) === JSON.stringify([[5, 3], [4, 6], [3, 0], [2, 2]]), JSON.stringify(items.map((i) => [i.ordered_quantity, i.total_quantity])));
  // the vendor bill: the existing plan, from the list as it now stands
  const plan = PA.planSupplierBills(PA.parsePurchaseListItems(listRow(list).x_aggregated_items), AHMED);
  const cmds = PA.buildPurchaseOrderLineCommands(plan.bills[0].items, 900, []);
  assert("the vendor bill plan: ONE bill, Ahmed's, of the RECEIVED quantities — 3, 6 and 2; the potato (0) is on no bill", plan.bills.length === 1 && plan.bills[0].supplierId === AHMED && plan.noSupplier.length === 0
    && JSON.stringify(cmds.map((c: any) => [c[2].name, c[2].product_qty, c[2].price_unit])) === JSON.stringify([["طماطم — كرتون", 3, 17.35], ["خيار — جرم", 6, 23.45], ["بصل — جرم", 2, 11.85]]), JSON.stringify(cmds));
  assert("…its amount: 3 × 17.35 + 6 × 23.45 + 2 × 11.85 = 216.45 (as ordered it was 252.70)", PA.computeNetTotals(plan.bills[0].items.map((it: any) => it.unit_price * it.total_quantity), null).total === 216.45 && PA.validatePurchaseItems(plan.bills[0].items).length === 0);
  // the dues: syncSupplierDues ran inside the confirmation
  const due = dues().find((x) => x.x_supplier_id === AHMED), L = due ? dueLines(due.id) : [];
  assert("Ahmed's due by what was received: 216.45, three lines — 3, 6, 2 — none «بلا سعر»", due?.x_amount === 216.45 && due?.x_unpriced_count === 0 && JSON.stringify(L.map((x) => [x.x_product_tmpl_id, x.x_quantity, x.x_subtotal])) === JSON.stringify([[1, 3, 52.05], [2, 6, 140.7], [4, 2, 23.7]]), JSON.stringify(L.map((x) => [x.x_product_tmpl_id, x.x_quantity, x.x_subtotal])));
  assert("the item received 0 is simply left out: no due line, and no «بلا سعر» alert for a line nobody is owed", !L.some((x) => x.x_product_tmpl_id === 3) && !textsTo(OWNER).some((t) => t.includes("بلا سعر")), JSON.stringify(textsTo(OWNER)));
  const pd = SP.planDues({ x_date: LIST_DAY, listSupplierId: AHMED }, [{ product_id: 3, product_name: "بطاطس", packaging_id: 31, packaging_name: "كرتون", total_quantity: 0, price_supplier_id: AHMED }, { product_id: 9, product_name: "خس", packaging_id: 91, packaging_name: "كرتون", total_quantity: 0 }], []);
  assert("planDues, pure: a quantity of 0 makes no due, no «بلا سعر» and no «بلا مورد»", pd.dues.length === 0 && pd.noSupplier.length === 0, JSON.stringify(pd));
  assert("the orders' lines stay as «تم الشراء» sets them (purchased): what is short at delivery is the delivery form's", (rows("x_daily_order_line") as any[]).every((x) => x.x_status === "purchased" && [5, 4, 3, 2].includes(x.x_quantity)));
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  assert("he is told each difference against what was ordered, and how many were as ordered", bodyOf(ans) === [
    `📥 سُجّل استلام قائمة الشراء #${list} (2 أكتوبر 2026):`,
    "• طماطم (كرتون): المطلوب 5 ← المستلم 3 (ناقص 2)",
    "• خيار (جرم): المطلوب 4 ← المستلم 6 (زيادة 2)",
    "• بطاطس (كرتون): المطلوب 3 ← المستلم 0 (لم يُستلم)",
    "• والباقي (صنف واحد) كما طُلب.",
    "تمام 👍 تم إرسال المسارات لـ 1 سواق (1 توصيلة).",
    "📸 أرسل صورة فاتورة الشراء الضريبية",
  ].join("\n"), bodyOf(ans));
  assert("Baraa gets ONE message: each difference — ordered → received — with its supplier, and that the bill and the due follow what was received", ownerNotes().length === 1 && ownerNotes()[0] === [
    `📥 استلام مشتريات — قائمة الشراء #${list} (2 أكتوبر 2026) من عمر المجهلي:`,
    "فروقات الاستلام:",
    "• طماطم (كرتون): المطلوب 5 ← المستلم 3 (ناقص 2) — أحمد حسان",
    "• خيار (جرم): المطلوب 4 ← المستلم 6 (زيادة 2) — أحمد حسان",
    "• بطاطس (كرتون): المطلوب 3 ← المستلم 0 (لم يُستلم) — أحمد حسان",
    "فاتورة كل مورد ومستحقه يُحسبان بالكميات المستلمة.",
  ].join("\n"), ownerNotes().join("\n---\n"));
  const note = (rows("x_wa_message") as any[]).find((x) => String(x.x_body ?? "").startsWith("📥 استلام مشتريات —"));
  assert("…under an owner's purpose (owner_team_note), to his number alone", purposeOf(note) === "owner_team_note" && RC.RECEIPT_OWNER_PURPOSE === "owner_team_note" && graph.filter((x: any) => bodyOf(x).startsWith("📥 استلام مشتريات —")).every((x: any) => x.to === OWNER));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // quantities as typed
  assert("a quantity: «3», «2.5», «٢٫٥», «2,5», «0» — a number ≥ 0 with at most two decimals", RC.parseReceivedQty("3") === 3 && RC.parseReceivedQty("2.5") === 2.5 && RC.parseReceivedQty("٢٫٥") === 2.5 && RC.parseReceivedQty("2,5") === 2.5 && RC.parseReceivedQty("0") === 0 && RC.parseReceivedQty(" 12 ") === 12 && RC.parseReceivedQty(7) === 7);
  assert("not a quantity: empty, a word, a sign, three decimals, more than 9999", ["", "  ", undefined, null, "كثير", "-2", "+2", "2.555", "1e3", "10000", "3 كراتين"].every((v) => RC.parseReceivedQty(v) === "invalid"));
  assert("a cash row's number is above zero: «0» is not one, nothing typed is nothing", RC.parseCashNumber("0", 9999) === "invalid" && RC.parseCashNumber("", 9999) === null && RC.parseCashNumber(undefined, 9999) === null && RC.parseCashNumber("21.5", 9999) === 21.5 && RC.parseCashNumber("21.555", 9999) === "invalid" && RC.parseCashNumber("100001", RC.RECEIPT_PRICE_MAX) === "invalid");
  // a list changed after the form was sent: read by the item, never by its place
  const got = RC.receivedLines([
    { product_id: 2, product_name: "خيار", packaging_id: 21, packaging_name: "جرم", total_quantity: 4, order_ids: [1] },
    { product_id: 8, product_name: "جزر", packaging_id: 81, packaging_name: "كيس", total_quantity: 7, order_ids: [2] },
    { product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 2, ordered_quantity: 5, order_ids: [1] },
  ] as any, [{ item: { slot: 1, productId: 1, packagingId: 11 } as any, quantity: 3 }, { item: { slot: 2, productId: 2, packagingId: 21 } as any, quantity: 4 }]);
  assert("a received quantity goes to its own item, wherever it now sits; a line the form never showed is taken as ordered", JSON.stringify(got.next.map((i: any) => [i.product_id, i.ordered_quantity, i.total_quantity])) === JSON.stringify([[2, 4, 4], [8, 7, 7], [1, 5, 3]]));
  assert("…and `ordered_quantity` is written ONCE: a list a receipt was already written on keeps what was ordered (5), not the earlier receipt (2)", got.lines[2].ordered === 5 && got.lines[2].received === 3 && RC.orderedOf({ total_quantity: 2, ordered_quantity: 5 } as any) === 5 && RC.orderedOf({ total_quantity: 2 } as any) === 2);
}

// ================================================================ د6
console.log("\n[د6] cash-market rows: ONE pending payment, its amount and its note; an incomplete row; a row with no item");
{
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0;
  const before = { po: rows("purchase.order").length, mv: rows("account.move").length, dp: rows("x_daily_price").length, po2: rows("x_price_offer").length };
  const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3", ci1: "1:11", cq1: "2", cp1: "21.5", cs1: "  أبو  فهد ", ci2: "3:31", cq2: "1", cp2: "18", cs2: "محل الريان", ci3: "", cq3: "", cp3: "", cs3: "" }));
  const p = payments();
  assert("two cash rows → ONE supplier payment, to «مشتريات السوق النقدية»: cash, from WhatsApp, pending, recorded by him", r.action === "received" && p.length === 1 && p[0].x_supplier_id === CASH && p[0].x_method === "cash" && p[0].x_channel === "whatsapp" && p[0].x_state === "pending" && p[0].x_recorded_by === OMAR && r.payment === p[0].x_name, JSON.stringify(p));
  assert("its amount: Σ quantity × price paid = 2 × 21.5 + 1 × 18 = 61.00", p[0].x_amount === 61 && RC.cashTotalH([{ quantity: 2, price: 21.5 }, { quantity: 1, price: 18 }] as any) === 6100);
  assert("its note lists every row — the item, the quantity, the price paid, the seller — and the total", p[0].x_note === [
    `مشتريات السوق النقدي — نموذج استلام قائمة الشراء #${list}:`,
    "• طماطم (كرتون) × 2 بسعر 21.5 = 43.00 ر.س — البائع: أبو فهد",
    "• بطاطس (كرتون) × 1 بسعر 18 = 18.00 ر.س — البائع: محل الريان",
    "المجموع: 61.00 ر.س",
  ].join("\n"), String(p[0].x_note));
  assert("…it carries the reply's own wamid (never recorded twice), and no receipt image", String(p[0].x_source_wamid).startsWith("wamid.RC") && !p[0].x_receipt);
  assert("no purchase order, no bill and no price row is made from the cash rows", rows("purchase.order").length === before.po && rows("account.move").length === before.mv && rows("x_daily_price").length === before.dp && rows("x_price_offer").length === before.po2);
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  assert("he is told his own rows, their total and the payment's reference", bodyOf(ans).split("\n").slice(1, -2).join("\n") === [
    "• طماطم (كرتون): المطلوب 5 ← المستلم 3 (ناقص 2)",
    "• والباقي (3 أصناف) كما طُلب.",
    "🛒 مشتريات السوق النقدي:",
    "• طماطم (كرتون) × 2 بسعر 21.5 = 43.00 ر.س — البائع: أبو فهد",
    "• بطاطس (كرتون) × 1 بسعر 18 = 18.00 ر.س — البائع: محل الريان",
    `المجموع: 61.00 ر.س — سُجّلت الدفعة ${p[0].x_name} بانتظار اعتماد براء.`,
  ].join("\n"), bodyOf(ans));
  assert("Baraa's ONE message: the difference, then the cash rows as entered, their total, and that the payment waits in «💵 دفع الموردين»", ownerNotes().length === 1 && ownerNotes()[0] === [
    `📥 استلام مشتريات — قائمة الشراء #${list} (2 أكتوبر 2026) من عمر المجهلي:`,
    "فروقات الاستلام:",
    "• طماطم (كرتون): المطلوب 5 ← المستلم 3 (ناقص 2) — أحمد حسان",
    "فاتورة كل مورد ومستحقه يُحسبان بالكميات المستلمة.",
    "🛒 مشتريات السوق النقدي (كما أدخلها):",
    "• طماطم (كرتون) × 2 بسعر 21.5 = 43.00 ر.س — البائع: أبو فهد",
    "• بطاطس (كرتون) × 1 بسعر 18 = 18.00 ر.س — البائع: محل الريان",
    `المجموع: 61.00 ر.س — الدفعة ${p[0].x_name} بانتظار اعتمادك في UTAK ← 💵 دفع الموردين.`,
  ].join("\n"), ownerNotes().join("\n---\n"));
  assert("…beside the payment's own alert, as for every team payment", textsTo(OWNER).some((t) => t.startsWith("💵 دفعة نقدية من عمر المجهلي بانتظار اعتمادك") && t.includes(`المورد: ${MKT}`) && t.includes("المبلغ: 61.00 ر.س")));
  assert("the cash rows are no line of the list: its JSON holds the four ordered items alone, and Ahmed's bill plan is untouched by them", itemsOf(list).length === 4 && PA.planSupplierBills(itemsOf(list), AHMED).bills.length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // cash rows alone (everything received as ordered): Baraa still hears
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  await reply(env, OMAR_PHONE, token, asOrdered(LINES, { ci1: "4:41", cq1: "1.5", cp1: "9.25", cs1: "بسطة السوق" }));
  assert("a cash row with no difference: the payment (1.5 × 9.25 = 13.88), and Baraa's message says all was received as ordered", payments().length === 1 && payments()[0].x_amount === 13.88 && ownerNotes().length === 1 && ownerNotes()[0].split("\n")[1] === "كل الأصناف استُلمت كما طُلبت." && ownerNotes()[0].includes("• بصل (جرم) × 1.5 بسعر 9.25 = 13.88 ر.س — البائع: بسطة السوق"), ownerNotes().join("|"));
}
{
  // createTeamPayment: the note is optional
  const env = world();
  const a = await quiet(() => SP.createTeamPayment(env, { supplierId: AHMED, amountH: 5000, member: { id: OMAR, name: "عمر المجهلي" } }));
  const b = await quiet(() => SP.createTeamPayment(env, { supplierId: AHMED, amountH: 5000, member: { id: OMAR, name: "عمر المجهلي" }, note: "ملاحظة" }));
  assert("createTeamPayment without a note writes none (as before § 55); with one, «ملاحظة»", !("x_note" in (table("x_supplier_payment").get(a.id) as any)) && (table("x_supplier_payment").get(b.id) as any).x_note === "ملاحظة");
}
{
  // an incomplete row refuses the WHOLE form
  for (const [name, over, missing] of [
    ["no quantity", { ci1: "1:11", cq1: "", cp1: "20", cs1: "أبو فهد" }, "الكمية"],
    ["a quantity of 0", { ci1: "1:11", cq1: "0", cp1: "20", cs1: "أبو فهد" }, "الكمية"],
    ["no price", { ci1: "1:11", cq1: "2", cp1: "", cs1: "أبو فهد" }, "السعر المدفوع"],
    ["a price that is not a number", { ci1: "1:11", cq1: "2", cp1: "عشرين", cs1: "أبو فهد" }, "السعر المدفوع"],
    ["no seller", { ci1: "1:11", cq1: "2", cp1: "20", cs1: "   " }, "اسم البائع"],
    ["an item the form never offered", { ci1: "77:771", cq1: "2", cp1: "20", cs1: "أبو فهد" }, "صنف غير معروف"],
  ] as Array<[string, Record<string, string>, string]>) {
    const env = world();
    const list = listOf();
    const { token } = await formOf(env, list);
    const w0 = listWrites(list);
    graph.length = 0;
    const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3", ...over }));
    const fresh = flowsTo(OMAR_PHONE).at(-1);
    assert(`a cash row with ${name}: the whole form is refused — nothing written, no payment, the list still open — and a fresh form names «${missing}»`, r.action === "refused" && listWrites(list) === w0 && listRow(list).x_status === "sent" && payments().length === 0 && dues().length === 0
      && flowsTo(OMAR_PHONE).length === 1 && bodyOf(fresh).includes("⚠️ ما سُجّل شيء من النموذج") && bodyOf(fresh).includes(`سطر السوق 1`) && bodyOf(fresh).includes(missing) && sentTo(OWNER).length === 0, bodyOf(fresh));
  }
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0;
  await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3", ci2: "2:21", cq2: "2", cp2: "", cs2: "" }));
  const fresh = flowsTo(OMAR_PHONE).at(-1);
  assert("the refusal, line for line: the row, its item, everything it lacks, the rule, and the fresh form", bodyOf(fresh) === [
    "⚠️ ما سُجّل شيء من النموذج. صحّح التالي وأرسله من جديد:",
    "• سطر السوق 2 (خيار (جرم)): ناقص السعر المدفوع، اسم البائع",
    "(السطر اللي فيه صنف لازم له كمية وسعر مدفوع أكبر من صفر واسم البائع)",
    "هذا نموذج جديد بالكميات اللي كتبتها، ومشتريات السوق النقدي تُكتب من جديد 👇",
  ].join("\n"), bodyOf(fresh));
  assert("…the fresh form opens with the quantities he had typed (3 for the tomato), on a new token", dataOf(fresh).i1 === "3" && dataOf(fresh).i2 === "4" && tokenOf(fresh) !== token && RC.isReceiptFormToken(tokenOf(fresh)));
  const ok = await reply(env, OMAR_PHONE, tokenOf(fresh), asOrdered(LINES, { g1: "3", ci2: "2:21", cq2: "2", cp2: "24", cs2: "أبو سعد" }));
  assert("…and corrected, it is taken: the list confirmed, the payment 48.00", ok.action === "received" && listRow(list).x_status === "done" && payments().length === 1 && payments()[0].x_amount === 48);
}
{
  // a row with no item is no row
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0;
  const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { ci1: "", cq1: "", cp1: "", cs1: "", cq2: "2", cp2: "20", cs2: "أبو فهد" }));
  assert("a row with no item is ignored — never a payment — and the form is taken", r.action === "received" && payments().length === 0 && listRow(list).x_status === "done", JSON.stringify(r));
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  assert("…but what he typed in it is not lost in silence: he is told, and so is Baraa", bodyOf(ans).includes("⚠️ سطر السوق 2 بلا صنف: ما انحسب (2 · 20 · أبو فهد). أرسله لبراء، أو سجّله من «💵 دفعت لمورد».") && ownerNotes().length === 1 && ownerNotes()[0].includes("⚠️ سطر السوق 2 بلا صنف: ما انحسب (2 · 20 · أبو فهد)."), bodyOf(ans));
  const e = RC.readReceiptValues({ items: [], catalog: [{ id: "1:11", title: "طماطم — كرتون", name: "طماطم (كرتون)" }] }, { ci1: "1:11", cq1: "2", cp1: "20", cs1: "أ", ci4: "1:11", cq4: "1", cp4: "22", cs4: "ب" });
  assert("the same item in two rows (two sellers) is two rows; an untouched row is nothing", e.cash.length === 2 && e.cash[1].row === 4 && e.loose.length === 0 && e.badRows.length === 0 && e.cash[0].productId === 1 && e.cash[0].packagingId === 11);
}
{
  // no «مشتريات السوق النقدية» partner: nothing is lost
  const env = world();
  table("res.partner").delete(CASH);
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0;
  const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { ci1: "1:11", cq1: "2", cp1: "20", cs1: "أبو فهد" }));
  assert("the cash-market supplier is missing: the list is confirmed, no payment is made up, and Baraa is told the rows and that the payment was NOT recorded", r.action === "received" && listRow(list).x_status === "done" && payments().length === 0
    && ownerNotes()[0].includes("• طماطم (كرتون) × 2 بسعر 20 = 40.00 ر.س — البائع: أبو فهد") && ownerNotes()[0].includes("⚠️ لم تُسجَّل دفعتها (لا شريك «مشتريات السوق النقدية»)") && textsTo(OMAR_PHONE).some((t) => t.includes("ما قدرت أسجّل دفعتها الآن")), ownerNotes().join("|"));
}

// ================================================================ د7
console.log("\n[د7] a bad quantity: the WHOLE form is refused — nothing written — and a fresh form goes");
{
  for (const [name, over] of [["an empty field", { g2: "" }], ["a word", { g2: "كثير" }], ["a negative number", { g2: "-1" }], ["three decimals", { g2: "1.234" }], ["a missing field", { g2: undefined }]] as Array<[string, Record<string, unknown>]>) {
    const env = world();
    const list = listOf();
    const { token } = await formOf(env, list);
    const w0 = listWrites(list);
    graph.length = 0;
    const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3", ...over, ci1: "1:11", cq1: "2", cp1: "20", cs1: "أبو فهد" }));
    assert(`${name} in a quantity: refused whole — the list untouched and open, no line purchased, no due, no payment (its good cash row included), no route`, r.action === "refused" && listWrites(list) === w0 && listRow(list).x_status === "sent" && itemsOf(list).every((i) => !("ordered_quantity" in i))
      && (rows("x_daily_order_line") as any[]).every((x) => x.x_status === "pending") && dues().length === 0 && payments().length === 0 && rows("x_delivery_route").length === 0 && sentTo(OWNER).length === 0, JSON.stringify(r));
  }
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0;
  await reply(env, OMAR_PHONE, token, { g1: "3", g2: "", g3: "صفر", g4: "2" });
  const fresh = flowsTo(OMAR_PHONE);
  assert("ONE message: it names the fields, and it is the fresh form itself", sentTo(OMAR_PHONE).length === 1 && fresh.length === 1 && bodyOf(fresh[0]) === [
    "⚠️ ما سُجّل شيء من النموذج. صحّح التالي وأرسله من جديد:",
    "• الكمية المستلمة لازم رقم (0 لو ما استلمت الصنف): خيار (جرم)، بطاطس (كرتون)",
    "هذا نموذج جديد بالكميات اللي كتبتها 👇",
  ].join("\n"), bodyOf(fresh[0]));
  assert("…opened with what he typed where it was a quantity, and the ordered quantity where it was not", JSON.stringify([1, 2, 3, 4].map((n) => dataOf(fresh[0])[`i${n}`])) === JSON.stringify(["3", "4", "3", "2"]));
  // the refused token is not spent: the same form corrected is still read
  const again = await reply(env, OMAR_PHONE, token, { g1: "3", g2: "4", g3: "0", g4: "2" });
  assert("a refused form spends nothing: sent again corrected (the same token), it is taken", again.action === "received" && listRow(list).x_status === "done");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د8
console.log("\n[د8] the photo: in the reply → kept on the list; none → the 60-minute window and its ask; a download that fails → the same");
{
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0; mediaCalls.length = 0;
  const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { photo: [{ file_name: "IMG_2031.jpg", mime_type: "image/jpeg", sha256: "ab12", id: "RCPH_A1" }] }));
  const l = listRow(list);
  assert("a photo in the reply is downloaded by its media id and kept on the list: x_tax_invoice, its name, its time", r.action === "received" && r.photos === 1 && JSON.stringify(mediaCalls) === JSON.stringify(["RCPH_A1"]) && l.x_tax_invoice === Buffer.from(MEDIA_BYTES).toString("base64")
    && l.x_tax_invoice_filename === `فاتورة-شراء-${LIST_DAY}-${list}.jpg` && l.x_tax_invoice_at === "2026-10-03 00:00:00", JSON.stringify({ n: l.x_tax_invoice_filename, at: l.x_tax_invoice_at, mediaCalls }));
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  assert("he is told it arrived, and is NOT asked for it again; no 60-minute window is opened", bodyOf(ans).split("\n").at(-1) === RC.RECEIPT_PHOTO_SAVED_TEXT && !bodyOf(ans).includes(PI.PINV_ASK_TEXT) && !env.MSG_DEDUP.store.has(`pinv:v1:${OMAR}`), bodyOf(ans));
  setRiyadh(`${DAY} 12:00`);
  assert("…and the 12:00 check finds its invoice: no line to Baraa", (await quiet(() => PI.checkPurchaseInvoices(env))).action === "none");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // no photo in the reply: the path of «تم الشراء»
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0; mediaCalls.length = 0;
  await reply(env, OMAR_PHONE, token, asOrdered(LINES, { photo: [] }));
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  const pend = JSON.parse(env.MSG_DEDUP.store.get(`pinv:v1:${OMAR}`) ?? "null");
  assert("no photo in the reply: nothing is downloaded, the 60-minute window of «تم الشراء» is opened for this list, and its ask is the last line", mediaCalls.length === 0 && pend?.listId === list && bodyOf(ans).split("\n").at(-1) === PI.PINV_ASK_TEXT && !listRow(list).x_tax_invoice, bodyOf(ans));
  setRiyadh(`${DAY} 03:30`);
  await hook(env, OMAR_PHONE, { type: "image", image: { id: "RCPH_B1", mime_type: "image/jpeg" } });
  assert("…the photo he then sends as an ordinary message, 30 minutes later, is kept on the list, and he gets «وصلت الفاتورة ✅»", !!listRow(list).x_tax_invoice && /\.jpg$/.test(String(listRow(list).x_tax_invoice_filename)) && textsTo(OMAR_PHONE).includes(PI.PINV_ACK_TEXT), JSON.stringify(textsTo(OMAR_PHONE).slice(-2)));
  setRiyadh(`${DAY} 03:45`);
  await hook(env, OMAR_PHONE, { type: "image", image: { id: "RCPH_B2", mime_type: "image/jpeg" } });
  assert("…a second one in the hour: an attachment of the list, the first not overwritten (the window's own storage, unchanged)", (rows("ir.attachment") as any[]).filter((a) => a.res_model === "x_purchase_list" && a.res_id === list).length === 1);
}
{
  // a download that fails is never a lost form
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0; mediaCalls.length = 0;
  const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3", photo: [{ file_name: "x.jpg", mime_type: "image/jpeg", sha256: "cd", id: "RCPH_BAD1" }] }));
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  assert("the download fails: the form is still taken whole (the list confirmed, 3 received), nothing is on the list as its invoice", r.action === "received" && r.photos === 0 && mediaCalls.length === 1 && listRow(list).x_status === "done" && itemsOf(list)[0].total_quantity === 3 && !listRow(list).x_tax_invoice);
  assert("…the same fallback: the window is opened, and he is asked to send the photo as a message", JSON.parse(env.MSG_DEDUP.store.get(`pinv:v1:${OMAR}`) ?? "null")?.listId === list && bodyOf(ans).split("\n").at(-1) === `${RC.RECEIPT_PHOTO_FAILED_NOTE} ${PI.PINV_ASK_TEXT}`, bodyOf(ans));
}
{
  // more files than the picker takes: the constant decides, never the client
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  graph.length = 0; mediaCalls.length = 0;
  const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { photo: [{ id: "RCPH_M1", mime_type: "image/jpeg" }, { id: "RCPH_M2", mime_type: "image/jpeg" }] }));
  assert("a reply with more photos than the Flow's picker takes (1): the first alone is downloaded and kept", r.photos === 1 && JSON.stringify(mediaCalls) === JSON.stringify(["RCPH_M1"]) && !!listRow(list).x_tax_invoice && (rows("ir.attachment") as any[]).filter((a) => a.res_model === "x_purchase_list").length === 0, JSON.stringify(mediaCalls));
}
{
  // the list already has an invoice (added by hand): the form's photo is an attachment
  const env = world();
  const list = listOf({ extra: { x_tax_invoice_filename: "يدوي.pdf", x_tax_invoice_at: "2026-10-02 20:00:00" } });
  const { token } = await formOf(env, list);
  await reply(env, OMAR_PHONE, token, asOrdered(LINES, { photo: [{ id: "RCPH_C1", mime_type: "image/jpeg", file_name: "a.jpg", sha256: "x" }] }));
  const att = (rows("ir.attachment") as any[]).filter((a) => a.res_model === "x_purchase_list" && a.res_id === list);
  assert("a list that already holds an invoice keeps it: the form's photo is added as an attachment, nothing overwritten", att.length === 1 && att[0].mimetype === "image/jpeg" && listRow(list).x_tax_invoice_filename === "يدوي.pdf");
  assert("the picker's value as Meta sends it: a list of files — the ids alone are used; anything else is no photo", JSON.stringify(RC.readReceiptPhotos([{ file_name: "a.jpg", mime_type: "image/jpeg", sha256: "s", id: "M1" }, { id: "" }, "x", null])) === JSON.stringify([{ id: "M1", mime: "image/jpeg", name: "a.jpg" }])
    && RC.readReceiptPhotos(undefined).length === 0 && RC.readReceiptPhotos("").length === 0 && RC.readReceiptPhotos([]).length === 0 && RC.readReceiptPhotos({ id: "M2" }).length === 1);
  const flow = META.parseFlowReply({ response_json: JSON.stringify({ g1: "5", cs1: "أبو فهد", photo: [{ id: "M1", file_name: "a.jpg" }], flow_token: "rc1.x" }) });
  assert("the reply's inbox line shows the photo as «📎 صورة», never «[object Object]»", META.flowReplyText(flow) === "📝 رد النموذج: 5 · أبو فهد · 📎 صورة" && Array.isArray(flow.values.photo) && flow.token === "rc1.x", META.flowReplyText(flow));
}

// ================================================================ د9
console.log("\n[د9] the token: another number, a second use, a list already confirmed, the lock of «تم الشراء»");
{
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  const w0 = listWrites(list);
  graph.length = 0;
  openWindow(env, CUST_PHONE);
  const other = await reply(env, CUST_PHONE, token, asOrdered(LINES, { g1: "0" }));
  assert("the token from another number: nothing is read from it — the list untouched — and that number is told the form is not valid", other.action === "unknown" && listWrites(list) === w0 && listRow(list).x_status === "sent" && JSON.stringify(textsTo(CUST_PHONE)) === JSON.stringify([RC.RECEIPT_UNKNOWN_TEXT]));
  const made = await reply(env, OMAR_PHONE, "rc1.20261002.1.deadbeefdeadbeef00", asOrdered());
  const notOurs = await reply(env, OMAR_PHONE, "of1.20261002.1.deadbeefdeadbeef00", asOrdered());
  assert("a token that was never issued (or another form's): unknown, nothing written", made.action === "unknown" && notOurs.action === "unknown" && listWrites(list) === w0 && !RC.isReceiptFormToken("of1.x") && !RC.isReceiptFormToken("pr1.x") && RC.isReceiptFormToken("rc1.x"));
  const first = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3", ci1: "1:11", cq1: "2", cp1: "20", cs1: "أبو فهد" }));
  const w1 = listWrites(list), n = sentTo(OMAR_PHONE).length;
  const second = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "1", ci1: "1:11", cq1: "9", cp1: "20", cs1: "أبو فهد" }));
  assert("a second use of the same token: «سبق إرساله» — nothing written again, no second payment, no second route", first.action === "received" && second.action === "duplicate" && listWrites(list) === w1 && itemsOf(list)[0].total_quantity === 3 && payments().length === 1 && rows("x_delivery_route").length === 1
    && JSON.stringify(textsTo(OMAR_PHONE).slice(n)) === JSON.stringify([RC.RECEIPT_USED_TEXT]), JSON.stringify(textsTo(OMAR_PHONE).slice(n)));
  assert("…the record says when it was used", !!JSON.parse(env.MSG_DEDUP.store.get(RC.receiptFormKey(token))).usedAt);
}
{
  // two forms of the same list (the button tapped twice): the second one finds the list confirmed
  const env = world();
  const list = listOf();
  const a = await formOf(env, list), b = await formOf(env, list);
  await reply(env, OMAR_PHONE, a.token, asOrdered(LINES, { g1: "3" }));
  env.MSG_DEDUP.store.delete(`btnlock:v1:purchase_done:${list}`);           // even with the button's lock gone (7 days later)
  const w1 = listWrites(list), n = sentTo(OMAR_PHONE).length, routes = rows("x_delivery_route").length;
  const late = await reply(env, OMAR_PHONE, b.token, asOrdered(LINES, { g1: "0", g2: "0", ci1: "1:11", cq1: "2", cp1: "20", cs1: "أبو فهد" }));
  assert("a list already confirmed answers «القائمة مؤكدة من قبل» and changes nothing: no write, no payment, no route, nothing to Baraa", late.action === "done_before" && listWrites(list) === w1 && itemsOf(list)[0].total_quantity === 3 && itemsOf(list)[1].total_quantity === 4 && payments().length === 0 && rows("x_delivery_route").length === routes
    && JSON.stringify(textsTo(OMAR_PHONE).slice(n)) === JSON.stringify([RC.RECEIPT_DONE_TEXT]) && ownerNotes().length === 1, JSON.stringify(late));
}
{
  // confirmed by the template's «تم الشراء» first: the form after it changes nothing
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  await hook(env, OMAR_PHONE, quick(`purchase_done_${list}`));
  const w1 = listWrites(list);
  const late = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "0" }));
  assert("«تم الشراء» from the template, then the form: «مؤكدة من قبل», the list stays as ordered", listRow(list).x_status === "done" && late.action === "done_before" && listWrites(list) === w1 && itemsOf(list)[0].total_quantity === 5);
}
{
  // the same lock as the «تم الشراء» button: a confirmation in flight (the lock held, the list not yet done)
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  env.MSG_DEDUP.store.set(`btnlock:v1:purchase_done:${list}`, "run:1:abc");
  const w0 = listWrites(list);
  const r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3" }));
  assert("the lock of «تم الشراء» is held by another tap: the form writes nothing and confirms nothing", r.action === "done_before" && listWrites(list) === w0 && listRow(list).x_status === "sent" && rows("x_delivery_route").length === 0, JSON.stringify(r));
  // …and the form takes that same lock: a «تم الشراء» tap after it is «تم مسبقاً»
  const env2 = world();
  const list2 = listOf();
  const f2 = await formOf(env2, list2);
  await reply(env2, OMAR_PHONE, f2.token, asOrdered());
  const tap = await tapAs(env2, `purchase_done_${list2}`, OMAR);
  assert("the form holds that lock itself: «تم الشراء» tapped after it does nothing again (one route, one confirmation)", String(env2.MSG_DEDUP.store.get(`btnlock:v1:purchase_done:${list2}`)).startsWith("done:") && /مسبقاً/.test(String(tap.bodyBeforeButtons)) && rows("x_delivery_route").length === 1, String(tap.bodyBeforeButtons));
}
{
  // a cancelled list
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  listRow(list).x_status = "cancelled";
  const r = await reply(env, OMAR_PHONE, token, asOrdered());
  assert("a list cancelled meanwhile: nothing written, he is told", r.action === "cancelled" && listRow(list).x_status === "cancelled" && textsTo(OMAR_PHONE).at(-1) === RC.RECEIPT_CANCELLED_TEXT);
}
{
  // Odoo fails in the middle of the confirmation: the locks are released, and the form can be sent again
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  const real = globalThis.fetch;
  let fail = true;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = String(typeof input === "string" ? input : (input as any)?.url);
    if (fail && url.endsWith("/json/2/x_purchase_list/write") && String(init?.body ?? "").includes('"x_status":"done"')) return new Response(JSON.stringify({ name: "odoo.exceptions.UserError", message: "locked" }), { status: 422 });
    return real(input as any, init);
  }) as typeof fetch;
  let threw = false;
  try { await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3" })); } catch { threw = true; }
  fail = false; globalThis.fetch = real;
  assert("the confirmation fails in Odoo: the error surfaces, and neither the token nor the list's lock stays taken", threw && listRow(list).x_status === "sent" && !env.MSG_DEDUP.store.has(`btnlock:v1:purchase_done:${list}`) && !env.MSG_DEDUP.store.has(`btnlock:v1:rcform_use:${token}`));
  const again = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "2" }));
  assert("…the same form sent again is taken, and what was ORDERED is still 5 (written once), received 2", again.action === "received" && JSON.stringify([itemsOf(list)[0].ordered_quantity, itemsOf(list)[0].total_quantity]) === JSON.stringify([5, 2]) && textsTo(OMAR_PHONE).some((t) => t.includes("• طماطم (كرتون): المطلوب 5 ← المستلم 2 (ناقص 3)")));
}
{
  // …and a failure AFTER the list was confirmed (the routes cannot be built): the form is not lost
  const env = world();
  const list = listOf();
  const { token } = await formOf(env, list);
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = String(typeof input === "string" ? input : (input as any)?.url);
    if (url.endsWith("/json/2/x_neighborhood/search_read")) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "no access" }), { status: 403 });
    return real(input as any, init);
  }) as typeof fetch;
  graph.length = 0; mediaCalls.length = 0;
  let r: any;
  try { r = await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g1: "3", ci1: "1:11", cq1: "2", cp1: "20", cs1: "أبو فهد", photo: [{ id: "RCPH_H1", mime_type: "image/jpeg" }] })); } catch { r = { action: "threw" }; }
  globalThis.fetch = real;
  assert("the list was confirmed and THEN the confirmation failed: the form is still taken — what was received, the cash payment, the photo — never lost", r.action === "received" && listRow(list).x_status === "done" && itemsOf(list)[0].total_quantity === 3 && payments().length === 1 && payments()[0].x_amount === 40 && !!listRow(list).x_tax_invoice, JSON.stringify(r));
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  assert("…he is told so in place of the routes' line — never «المسارات لـ 0 سواق»", bodyOf(ans).split("\n").slice(-2).join("\n") === `${RC.RECEIPT_HALF_TEXT}\n${RC.RECEIPT_PHOTO_SAVED_TEXT}` && !bodyOf(ans).includes("سواق"), bodyOf(ans));
  assert("…and Baraa gets the receipt's message and ONE alert that what follows the confirmation did not finish", ownerNotes().length === 1 && textsTo(OWNER).filter((t) => t.startsWith(`⚠️ قائمة الشراء #${list}: سُجّل استلامها وتأكدت، لكن تعذّر إكمال ما بعد التأكيد`)).length === 1, JSON.stringify(textsTo(OWNER)));
  const second = await reply(env, OMAR_PHONE, token, asOrdered());
  assert("…the token is spent and the list's lock kept: nothing can be written again", second.action === "duplicate" && String(env.MSG_DEDUP.store.get(`btnlock:v1:purchase_done:${list}`)).startsWith("done:") && itemsOf(list)[0].total_quantity === 3);
}

// ================================================================ د10
console.log("\n[د10] a list of more than thirty items: thirty in the form, the rest taken as ordered and named");
{
  const env = world();
  const many: typeof LINES = Array.from({ length: 33 }, (_, i) => [200 + i, 2000 + i, `صنف ${i + 1}`, "كرتون", i + 1, 10 + i] as [number, number, string, string, number, number]);
  for (const [p, k, name] of many) { seed("product.template", { id: p, name, sale_ok: true, x_is_active_for_sale: true }); seed("x_product_packaging", { id: k, x_name: "كرتون", x_product_tmpl_id: p, x_is_default: true }); }
  const list = listOf({ lines: many });
  const { token, msg } = await formOf(env, list);
  const d = dataOf(msg);
  assert("thirty fields are filled — the list's first thirty — and none is left for the other three", [...Array(30)].every((_, i) => d[`v${i + 1}`] === true && d[`l${i + 1}`] === `صنف ${i + 1}` && d[`i${i + 1}`] === String(i + 1)) && !("l31" in d) && JSON.parse(env.MSG_DEDUP.store.get(RC.receiptFormKey(token))).rest.length === 3);
  assert("the message that carries the form names them, and says they are taken as ordered", bodyOf(msg).split("\n").at(-1) === "خارج النموذج (يتسع لـ 30): صنف 31 (كرتون)، صنف 32 (كرتون)، صنف 33 (كرتون) — تُسجَّل كما طُلبت." && bodyOf(msg).split("\n")[0].endsWith(": 30 صنفاً.") && bodyOf(msg).length <= 1024, bodyOf(msg).split("\n").at(-1));
  assert("the rows' options hold every item of the list (37 with the four active ones), within Meta's two hundred", d.items.length === 37 && d.items[32].id === "232:2032" && d.items.slice(33).map((o: any) => o.id).join() === "1:11,2:21,3:31,4:41");
  graph.length = 0;
  const r = await reply(env, OMAR_PHONE, token, asOrdered(many, { g1: "0", g30: "40" }));
  const items = itemsOf(list);
  assert("the reply: the thirty as received, the three beyond the form as ordered — and each keeps its ordered_quantity", r.action === "received" && items.length === 33 && items[0].total_quantity === 0 && items[29].total_quantity === 40 && JSON.stringify(items.slice(30).map((i: any) => [i.ordered_quantity, i.total_quantity])) === JSON.stringify([[31, 31], [32, 32], [33, 33]]));
  assert("he is told the two differences and that the other 31 were as ordered", textsTo(OMAR_PHONE).some((t) => t.includes("• صنف 1 (كرتون): المطلوب 1 ← المستلم 0 (لم يُستلم)") && t.includes("• صنف 30 (كرتون): المطلوب 30 ← المستلم 40 (زيادة 10)") && t.includes("• والباقي (31 صنفاً) كما طُلب.")));
  const text60 = RC.receiptFormText(9, LIST_DAY, 30, Array.from({ length: 60 }, (_, i) => `صنف طويل الاسم جداً رقم ${i + 31} (كرتون)`));
  assert("a very long list of names is cut within the message's 1024 characters, and says how many more", text60.length <= 1024 && /… و \d+ أخرى — تُسجَّل كما طُلبت\.$/.test(text60), String(text60.length));
  // a receipt longer than an interactive message's text: the differences as plain text, then «تم الشراء»'s answer with its button
  const env2 = world();
  for (const [p, k, name] of many) { seed("product.template", { id: p, name, sale_ok: true, x_is_active_for_sale: true }); seed("x_product_packaging", { id: k, x_name: "كرتون", x_product_tmpl_id: p, x_is_default: true }); }
  const list2 = listOf({ lines: many });
  const f2 = await formOf(env2, list2);
  graph.length = 0;
  await reply(env2, OMAR_PHONE, f2.token, Object.fromEntries(many.slice(0, 30).map((_, i) => [`g${i + 1}`, "0"])));
  const out = sentTo(OMAR_PHONE).filter((b: any) => !bodyOf(b).includes("مسارك") && !bodyOf(b).includes("توصيلة #") && b.type !== "location");
  const detail = out.find((b: any) => b.type === "text" && bodyOf(b).startsWith("📥 سُجّل استلام")), tail = out.find((b: any) => b?.interactive?.type === "button" && bodyOf(b).startsWith("تمام 👍"));
  assert("thirty differences do not fit 1024: they go as plain text — every one — then the routes' line and the photo's ask with «💵 دفعت لمورد»", !!detail && bodyOf(detail).split("\n").filter((x) => x.startsWith("• صنف ")).length === 30 && !!tail && bodyOf(tail) === `تمام 👍 تم إرسال المسارات لـ 1 سواق (1 توصيلة).\n${PI.PINV_ASK_TEXT}` && buttonIds(tail)[0] === "sp_pay_start" && bodyOf(tail).length <= 1024, JSON.stringify(out.map((b: any) => bodyOf(b).slice(0, 40))));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د11
console.log("\n[د11] «تم الشراء» — the template's payload, and an old message's button — as before");
{
  const env = world();
  const list = listOf();
  graph.length = 0;
  await hook(env, OMAR_PHONE, quick(`purchase_done_${list}`));
  const ans = sentTo(OMAR_PHONE).filter((b: any) => b?.interactive?.type === "button").at(-1);
  assert("the template's «تم الشراء»: the list confirmed AS ORDERED — no ordered_quantity, every quantity as it was — with no form", listRow(list).x_status === "done" && itemsOf(list).every((it, i) => it.total_quantity === LINES[i][4] && !("ordered_quantity" in it)) && flowsTo(OMAR_PHONE).length === 0);
  assert("…its answer: the routes, the photo's ask, «💵 دفعت لمورد» — and the 60-minute window", bodyOf(ans) === `تمام 👍 تم إرسال المسارات لـ 1 سواق (1 توصيلة).\n${PI.PINV_ASK_TEXT}` && buttonIds(ans)[0] === "sp_pay_start" && JSON.parse(env.MSG_DEDUP.store.get(`pinv:v1:${OMAR}`) ?? "null")?.listId === list, bodyOf(ans));
  assert("…Ahmed's due as ordered (252.70), and nothing of a receipt to Baraa", dues().find((x) => x.x_supplier_id === AHMED)?.x_amount === 252.7 && ownerNotes().length === 0);
  const n = sentTo(OMAR_PHONE).length;
  await hook(env, OMAR_PHONE, button(`purchase_done_${list}`));
  assert("an old session message's «تم الشراء ✅» (purchase_done_<list>) still answers: here «تم مسبقاً»", textsTo(OMAR_PHONE).slice(n).some((t) => /مسبقاً/.test(t)) && rows("x_delivery_route").length === 1, JSON.stringify(textsTo(OMAR_PHONE).slice(n)));
  assert("the router still reads purchase_done_<list> and purchase_issue_<list>", /\^purchase_done_\(\\d\+\)\$/.test(srcOf("router.ts")) && /\^purchase_issue_\(\\d\+\)\$/.test(srcOf("router.ts")));
  // «مشكلة ⚠️» unchanged
  const env2 = world();
  const list2 = listOf();
  await hook(env2, OMAR_PHONE, button(`purchase_issue_${list2}`));
  assert("«مشكلة ⚠️» is unchanged: he is asked to write it, and Baraa is told", textsTo(OMAR_PHONE).some((t) => t.includes("اكتب المشكلة بالتفصيل")) && textsTo(OWNER).some((t) => t.includes(`قائمة الشراء #${list2}`) && t.includes("ضغط «مشكلة»")) && listRow(list2).x_status === "sent");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د12
console.log("\n[د12] privacy: no price of ours in the form or its message; his own prices to Baraa (an owner's purpose) and back to him alone");
{
  const env = world();
  // «أسعار اليوم» of the list's day: a cost, a market price, a suggested price, a sale price and a profit for every line — and the tomato's purchase won by Omar's own market offer
  const day = seed("x_price_day", { x_date: LIST_DAY, x_state: "published", x_name: `أسعار اليوم ${LIST_DAY}`, x_utak_simulation: false });
  LINES.forEach(([p, k], i) => seed("x_price_day_line", { x_day_id: day, x_sequence: i + 1, x_product_tmpl_id: p, x_packaging_id: k, x_cost_price: 17.35 + i, x_market_price: 27.65 + i, x_suggested_price: 29.5 + i, x_sale_price: 31.75 + i, x_full_cost: 19.95 + i, x_real_profit: 4.15 + i,
    x_supplier_id: i === 0 ? OMAR : AHMED, x_source_price: i === 0 ? 19.75 : 0, x_status: "auto", x_excluded: false, x_utak_simulation: false }));
  const list = listOf();
  const { token, msg } = await formOf(env, list);
  const sent = JSON.stringify(msg);
  const OURS = ["17.35", "23.45", "16.15", "11.85", "19.75", "27.65", "28.65", "29.5", "30.5", "31.75", "32.75", "19.95", "20.95", "4.15", "5.15", "18.35", "33.33"];
  assert("the form's data and the message that carries it hold none of our numbers: no purchase price, cost, market price, suggested price, sale price or profit", OURS.every((n) => !new RegExp(`(?<![0-9.])${n.replace(".", "\\.")}(?![0-9])`).test(sent.replace(/2026|#\d+|rc1\.[0-9a-f.]+/g, ""))), OURS.filter((n) => sent.includes(n)).join(","));
  assert("…no word of a price either: «سعر», «ر.س», «ربح», «تكلفة» are only in the cash screen's own line about what HE paid", !/ر\.س|ربح|تكلفة|مقترح/.test(sent) && sent.split("سعر").length - 1 === 1 && dataOf(msg).n2.includes("السعر اللي دفعته"));
  assert("the hint of a line the market won that day names «مشتريات السوق النقدية» — the supplier its bill is made for — and still no price", dataOf(msg).h1 === `كرتون · المطلوب 5 · ${MKT}` && dataOf(msg).h2 === "جرم · المطلوب 4 · أحمد حسان");
  assert("the token's record (never sent) holds no price either", OURS.slice(0, 5).every((n) => !String(env.MSG_DEDUP.store.get(RC.receiptFormKey(token))).includes(n)));
  const code = srcOf("receipt-form.ts").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const NAMES = /unit_price|x_price_sar|x_cost_price|x_sale_price|x_suggested_price|x_market_price|x_source_price|x_full_cost|x_break_even|profit/gi;
  assert("the module names no price field of ours — unit_price, x_price_sar, x_cost_price, x_sale_price, x_suggested_price, x_market_price, x_source_price, a profit — and reads no winner's price of the day's market lines", (code.match(NAMES) ?? []).length === 0 && !/winners\.get\(/.test(code) && /winners\.has\(/.test(code), (code.match(NAMES) ?? []).join(","));
  graph.length = 0;
  await reply(env, OMAR_PHONE, token, asOrdered(LINES, { g2: "1", ci1: "2:21", cq1: "3", cp1: "24.4", cs1: "أبو فهد" }));
  const withPrice = graph.filter((b: any) => /24\.4|73\.20/.test(JSON.stringify(b)));
  assert("the only prices in this part are the ones he typed (24.4, total 73.20): they reach Baraa and himself, nobody else", withPrice.length >= 2 && withPrice.every((b: any) => b.to === OWNER || b.to === OMAR_PHONE) && withPrice.some((b: any) => b.to === OWNER) && withPrice.some((b: any) => b.to === OMAR_PHONE), JSON.stringify(withPrice.map((b: any) => b.to)));
  const priced = (rows("x_wa_message") as any[]).filter((r) => /24\.4|73\.20/.test(String(r.x_body ?? "")));
  assert("…to Baraa under an owner's purpose (owner_team_note, and the payment's own owner_alert), to him as the bot's reply", priced.length >= 3 && priced.every((r) => ["owner_team_note", "owner_alert", "bot_reply"].includes(purposeOf(r))) && priced.some((r) => purposeOf(r) === "owner_team_note"), JSON.stringify(priced.map(purposeOf)));
  assert("none of our numbers is in anything this reply sent — to him, to Baraa, to anyone", OURS.every((n) => !graph.some((b: any) => new RegExp(`(?<![0-9.])${n.replace(".", "\\.")}(?![0-9])`).test(bodyOf(b).replace(/2026|#\d+/g, "")))), OURS.filter((n) => graph.some((b: any) => bodyOf(b).includes(n))).join(","));
  // an owner's purpose is refused to anybody else, the buyer included; the team's purpose is not an owner's
  const d1 = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: RC.RECEIPT_OWNER_PURPOSE, to: "+" + OMAR_PHONE, content: { kind: "session", body: { type: "text", text: { body: "x" } } } })));
  const d2 = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: RC.RECEIPT_TEST_PURPOSE, to: "+" + OMAR_PHONE, content: { kind: "session", body: { type: "text", text: { body: "x" } } } })));
  const d3 = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: RC.RECEIPT_PURPOSE, to: "+" + OWNER, content: { kind: "session", body: { type: "text", text: { body: "x" } } } })));
  assert("the gateway: Baraa's message and the trial are refused to any other number (the buyer's too), and the team's form is refused to Baraa's", d1?.action === "refused" && d2?.action === "refused" && d3?.action === "refused" && PURPOSES.receipt_form_test?.kind === "operational", JSON.stringify([d1, d2, d3]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د13
console.log("\n[د13] the trial to Baraa: the form itself, marked — nothing written, nothing confirmed, nothing downloaded");
{
  const env = world(`${DAY} 10:00`);
  seed("x_purchase_list", { x_date: LIST_DAY, x_status: "done", x_supplier_id: AHMED, x_aggregated_items: JSON.stringify([{ product_id: 9, product_name: "محاكاة", packaging_id: 91, packaging_name: "كرتون", total_quantity: 9, order_ids: [] }]), x_utak_simulation: true });
  const list = listOf();                                                                                                   // the latest real list — still OPEN: a reply that were written would confirm it
  seed("x_purchase_list", { x_date: DAY, x_status: "draft", x_aggregated_items: "[]", x_utak_simulation: false });          // newer, with no item: passed over
  seed("x_purchase_list", { x_date: DAY, x_status: "sent", x_supplier_id: AHMED, x_aggregated_items: JSON.stringify([{ product_id: 9, product_name: "محاكاة", packaging_id: 91, packaging_name: "كرتون", total_quantity: 9, order_ids: [] }]), x_utak_simulation: true });
  const log0 = odooLog.length;
  const t = await quiet(() => RC.sendReceiptFormTest(env));
  const f = flowsTo(OWNER);
  assert("ONE form, to Baraa's own number and nobody else", t.sent === true && t.listId === list && f.length === 1 && graph.every((b: any) => b.to === OWNER), JSON.stringify(t));
  assert("marked «🧪 تجربة» in its message and on both screens, built from the latest real list that has items (never a simulation one)", bodyOf(f[0]).startsWith(`🧪 تجربة — 📥 استلام مشتريات قائمة الشراء #${list} (2 أكتوبر 2026): 4 أصناف.`) && dataOf(f[0]).t1 === "🧪 تجربة — ما استلمته من الموردين" && dataOf(f[0]).t2 === "🧪 تجربة — مشتريات السوق النقدي"
    && dataOf(f[0]).l1 === "طماطم" && dataOf(f[0]).i1 === "5" && !JSON.stringify(dataOf(f[0])).includes("محاكاة"), bodyOf(f[0]));
  assert("it goes under receipt_form_test, which reaches his number alone", purposeOf((rows("x_wa_message") as any[]).find((r) => String(r.x_body ?? "").startsWith("🧪 تجربة — 📥"))) === "receipt_form_test" && RC.RECEIPT_TEST_PURPOSE === "receipt_form_test");
  assert("reading only: not one write or create in Odoo but the send's own record", odooLog.slice(log0).filter((c: any) => (c.method === "write" || c.method === "create") && c.model !== "x_wa_message" && c.model !== "mail.message").length === 0, JSON.stringify(odooLog.slice(log0).filter((c: any) => c.method === "write" || c.method === "create").map((c: any) => c.model)));
  const again = await quiet(() => RC.sendReceiptFormTest(env));
  assert("a second trial the same day is refused", again.sent === false && again.reason === "already_today" && flowsTo(OWNER).length === 1, JSON.stringify(again));
  // his reply
  const log1 = odooLog.length; mediaCalls.length = 0;
  const before = JSON.stringify(listRow(list));
  await hook(env, OWNER, nfm(tokenOf(f[0]), asOrdered(LINES, { g1: "3", ci1: "2:21", cq1: "2", cp1: "24", cs1: "أبو فهد", photo: [{ id: "RCPH_T1", mime_type: "image/jpeg", file_name: "t.jpg", sha256: "s" }] })));
  const ans = textsTo(OWNER).at(-1)!;
  assert("his reply is answered with what WOULD be done: the difference, the cash row and its total, the photo, the confirmation", ans === [
    `🧪 تجربة — 📥 كان سيُسجَّل استلام قائمة الشراء #${list} (2 أكتوبر 2026):`,
    "• طماطم (كرتون): المطلوب 5 ← المستلم 3 (ناقص 2)",
    "• والباقي (3 أصناف) كما طُلب.",
    "🛒 مشتريات السوق النقدي:",
    "• خيار (جرم) × 2 بسعر 24 = 48.00 ر.س — البائع: أبو فهد",
    "المجموع: 48.00 ر.س",
    "وكانت ستُسجَّل دفعة نقدية واحدة لـ «مشتريات السوق النقدية» بانتظار اعتمادك في 💵 دفع الموردين.",
    "📸 مع النموذج صورة: كانت ستُحفظ على قائمة الشراء.",
    "ثم تُؤكَّد القائمة كما يفعل «تم الشراء»: المسارات، وفاتورة كل مورد ومستحقه بالكميات المستلمة.",
    "(تجربة: لم يُكتب شيء في Odoo، ولم تُؤكَّد القائمة، ولم تُنزَّل صورة)",
  ].join("\n"), ans);
  assert("…and nothing is written, confirmed or downloaded: the list as it was, no payment, no due, no route, no media fetched", JSON.stringify(listRow(list)) === before && payments().length === 0 && dues().length === 0 && rows("x_delivery_route").length === 0 && mediaCalls.length === 0
    && odooLog.slice(log1).filter((c: any) => (c.method === "write" || c.method === "create") && !["x_wa_message", "mail.message", "discuss.channel", "discuss.channel.member", "x_message_analysis", "ir.attachment", "res.partner"].includes(c.model)).length === 0, JSON.stringify(odooLog.slice(log1).filter((c: any) => c.method === "write" || c.method === "create").map((c: any) => c.model)));
  // a bad field on the trial
  await hook(env, OWNER, nfm(tokenOf(f[0]), asOrdered(LINES, { g2: "" })));
  assert("a trial reply that would be refused says so, and still writes nothing", textsTo(OWNER).at(-1)!.startsWith("🧪 تجربة — كان النموذج سيُرفض كاملاً") && textsTo(OWNER).at(-1)!.includes("خيار (جرم)") && textsTo(OWNER).at(-1)!.endsWith(RC.RECEIPT_TEST_TAIL) && JSON.stringify(listRow(list)) === before);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // no purchase list on the tenant yet: the active items at a quantity of 1
  const env = world(`${DAY} 10:00`);
  const t: any = await quiet(() => RC.sendReceiptFormTest(env)).catch((e) => ({ sent: false, reason: String(e) }));
  const f = flowsTo(OWNER)[0];
  assert("with no real list the trial shows the active items, each at a quantity of 1", t.sent === true && t.listId === 0 && !!f && bodyOf(f).startsWith("🧪 تجربة — 📥 استلام مشتريات (3 أكتوبر 2026): 4 أصناف.") && [1, 2, 3, 4].every((n) => dataOf(f)[`i${n}`] === "1" && dataOf(f)[`v${n}`] === true) && /المطلوب 1$/.test(dataOf(f).h1), bodyOf(f));
  // his window closed: nothing, and nothing held
  const env2 = world(`${DAY} 10:00`);
  listOf();
  closeOwnerWindow(env2);
  const closed = await quiet(() => RC.sendReceiptFormTest(env2));
  assert("his window closed: no trial, nothing held, and the day is not spent", closed.sent === false && closed.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env2, OWNER).length === 0 && ![...env2.MSG_DEDUP.store.keys()].some((k: string) => k.includes("rcform_test")));
  // the hook
  const env3 = world(`${DAY} 10:00`);
  listOf();
  env3.ODOO_HOOK_TOKEN = "HOOK";
  const no = await quiet(() => worker.fetch(new Request("https://w.test/odoo/hook/receipt-form-test?token=WRONG", { method: "POST" }), env3, collectingCtx()));
  const yes = await quiet(() => worker.fetch(new Request("https://w.test/odoo/hook/receipt-form-test?token=HOOK", { method: "POST" }), env3, collectingCtx()));
  const body: any = await yes.json().catch(() => ({}));
  assert("POST /odoo/hook/receipt-form-test: refused without the hook's token, and with it the trial goes", no.status === 401 && yes.status === 200 && body.ok === true && body.sent === true && flowsTo(OWNER).length === 1, JSON.stringify(body));
  const trial = readFileSync(new URL("../scripts/s55-20261005-trial.mjs", import.meta.url), "utf8");
  assert("the trial script knows it: receipt → receipt-form-test", /receipt: "receipt-form-test"/.test(trial));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

done();
