// § 62 هـ (2026-10-07) — the three trials of «طلب أسعار خاص» to Baraa's own number.
//
// Each: his number alone, «🧪 تجربة», inside his window only, once a day; nothing written in Odoo,
// no source and no customer reached.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62-trials.test.mts

import { OWNER, closeOwnerWindow, ctx, graph, heldFor, openWindow, quiet, sentTo } from "./wa-harness.mts";
import { assert, done, rejected } from "./s46-kit.mts";
import { AHMED_PHONE, MADARAT_PHONE, OMAR_PHONE, RAED_PHONE, ORANGE, lineOf, linesOf, quote, r2, request, saleOrders, world, writes } from "./s62-kit.mts";
import * as KIT from "./s62-kit.mts";

const TR = await import("../src/s62-trials.ts");
const ASK = await import("../src/special-ask.ts");
const SQ = await import("../src/special-quote.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendText } = await import("../src/meta.ts");
const worker = (await import("../src/index.ts")).default;

const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const docsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "document");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const others = () => [AHMED_PHONE, RAED_PHONE, OMAR_PHONE, MADARAT_PHONE].reduce((n, d) => n + sentTo(d).length + heldFor(globalEnv, d).length, 0);
let globalEnv: any;
const post = (env: any, name: string, token = "HOOK-0123456789abcdef0123456789abcdef", id?: number) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/s62-trial?name=${name}&token=${token}${id ? `&id=${id}` : ""}`, { method: "POST" }), env, ctx));

console.log("\n[هـ] the trials are Baraa's alone");
{
  const env = globalEnv = world();
  assert("three names", JSON.stringify(TR.S62_TRIAL_NAMES) === JSON.stringify(["purchase", "market", "quotation"]));
  assert("their purpose is the gateway's, an hour long", PURPOSES[ASK.SPECIAL_TEST_PURPOSE]?.kind === "operational" && JSON.stringify(PURPOSES[ASK.SPECIAL_TEST_PURPOSE].ttl) === JSON.stringify({ hours: 1 }));
  const leak = await quiet(() => sendText(env, "+" + AHMED_PHONE, "x", { purpose: ASK.SPECIAL_TEST_PURPOSE }));
  const own = await quiet(() => sendText(env, "+" + OWNER, "x", { purpose: ASK.SPECIAL_TEST_PURPOSE }));
  assert("refused for any other number (403), sent to Baraa's", leak.status === 403 && own.ok);
  assert("an unknown name is no trial", (await TR.sendS62Trial(env, "xyz")).reason === "unknown_trial");
  assert("the hook: no token → 401; with it → the worker's answer", (await post(env, "purchase", "x")).status === 401);
  assert("no request to show: said, nothing sent", (await quiet(() => TR.sendS62Trial(env, "purchase"))).reason === "no_request" && sentTo(OWNER).length === 1);
  // a trial that did not go does not spend the day; and the request shown is the newest that is NOT closed
  const older = request(), newer = request();
  quote(newer).x_state = "closed";
  const shown = await quiet(() => TR.sendS62Trial(env, "purchase"));
  assert("…and the day's trial is not spent by it: it goes once there is a request", shown.sent === true);
  assert("the request shown is the newest one that is not closed", shown.quote === SQ.quoteName(older) && shown.quote !== SQ.quoteName(newer), JSON.stringify(shown));
}

console.log("\n[هـ1–2] the form as a «شراء» source reads it, and as a «سوق» source reads it");
{
  const env = globalEnv = world();
  const id = request();
  await quiet(() => SQ.recalcQuote(env, id));                    // its sources are on it, as after its first save
  const before = JSON.stringify([quote(id), linesOf(id)]);
  KIT.r2.length = 0;
  const res = await post(env, "purchase");
  const a = (await res.json()) as any;
  const f = flowsTo(OWNER);
  assert("purchase: ONE form to Baraa, the newest open request's", a.ok && a.sent === true && a.quote === SQ.quoteName(id) && a.items === 6 && f.length === 1 && par(f[0]).flow_id === ASK.SPECIAL_FLOW_ID, JSON.stringify(a));
  assert("…marked «🧪 تجربة» in its text and on every page's heading", bodyOf(f[0]).startsWith("🧪 تجربة — مرحبا أحمد 🌿") && dataOf(f[0]).t1 === "🧪 تجربة — فواكه" && dataOf(f[0]).t4 === "🧪 تجربة — أخرى");
  assert("…as Ahmed reads it: «طلب أسعار خاص — 6 صنف», «سعرك بالكيلو بدون ضريبة.», the quantities in the hints", dataOf(f[0]).sub === "طلب أسعار خاص — 6 صنف" && dataOf(f[0]).note.startsWith("سعرك بالكيلو بدون ضريبة.") && dataOf(f[0]).h1 === "الكمية: 1464 كيلو");
  const m = (await (await post(env, "market")).json()) as any;
  const f2 = flowsTo(OWNER)[1];
  assert("market: the same form as Raed reads it — «سعر البيع في السوق بالكيلو شامل الضريبة.», no quantity at all", m.sent === true && dataOf(f2).note.startsWith("سعر البيع في السوق بالكيلو شامل الضريبة.") && dataOf(f2).h1 === "السعر بالريال" && !/1464|الكمية/.test(JSON.stringify(f2)) && bodyOf(f2).startsWith("🧪 تجربة — مرحبا رائد 🌿"));
  assert("neither names the customer", flowsTo(OWNER).every((b: any) => !JSON.stringify(b).includes("مدارات")));
  assert("nothing reaches a source or the customer, nothing is held for them", others() === 0);
  assert("nothing is written in Odoo: the request, its lines and its sources as they were", JSON.stringify([quote(id), linesOf(id)]) === before && writes().filter((w) => w.model !== "res.partner").length === 1, JSON.stringify(writes().map((w) => `${w.model}.${w.method}`)));
  assert("once a day each", (await (await post(env, "purchase")).json() as any).reason === "already_today" && (await (await post(env, "market")).json() as any).reason === "already_today" && flowsTo(OWNER).length === 2);
  // his reply to a trial form: answered, nothing written
  const token = par(f[0]).flow_token;
  const rec = await ASK.readSpecialToken(env, token);
  assert("the trial's token says so", rec?.test === true && rec.to === OWNER && rec.kind === "purchase");
  const r = await quiet(() => ASK.handleSpecialAskReply(env, { from: "+" + OWNER, messageId: "wamid.TR1", flow: { token, values: { p1: "3", remark: "تجربة" } } }));
  assert("his reply: «🧪 تجربة — وصلت ✅ برتقال 3.» under «تعديل», and «لم يُكتب شيء»", r.action === "test" && bodyOf(flowsTo(OWNER).slice(-1)[0]).startsWith("🧪 تجربة — وصلت ✅ برتقال 3.") && bodyOf(flowsTo(OWNER).slice(-1)[0]).includes("(تجربة: لم يُكتب شيء في Odoo)"));
  assert("…nothing written: no price on the line, no offer row, no note, no «📨 وصلت»", !lineOf(id, ORANGE).x_purchase_price && !quote(id).x_source_notes && JSON.stringify([quote(id), linesOf(id)]) === before && !sentTo(OWNER).some((b: any) => bodyOf(b).startsWith("📨 وصلت")));
  // window closed: nothing, the day is not spent
  const env2 = globalEnv = world(); const id2 = request(); closeOwnerWindow(env2);
  const c = await quiet(() => TR.sendS62Trial(env2, "purchase", id2));
  assert("Baraa's window closed: nothing sent, nothing held, and the day's trial is not spent", c.sent === false && c.reason === "window_closed" && graph.length === 0 && heldFor(env2, OWNER).length === 0);
  openWindow(env2, OWNER);
  assert("…it goes once his window is open", (await quiet(() => TR.sendS62Trial(env2, "purchase", id2))).sent === true);
  assert("a request with no line: said", (await quiet(() => TR.sendS62Trial(env2, "market", request([])))).reason === "no_lines");
  assert("the schema gate let every field through", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[هـ3] the quotation's PDF with illustrative prices");
{
  const env = globalEnv = world();
  const id = request();
  lineOf(id, ORANGE).x_final_price = 4.75;                        // a real price of Baraa's: it must not be the one shown
  const before = JSON.stringify([quote(id), linesOf(id)]);
  const a = (await (await post(env, "quotation", "HOOK-0123456789abcdef0123456789abcdef", id)).json()) as any;
  const d = docsTo(OWNER);
  assert("ONE attached file to Baraa, named «SQ-TRIAL-…» — never a real quotation's number", a.sent === true && a.items === 6 && d.length === 1 && a.number === TR.trialQuotationNumber(id) && /^SQ-TRIAL-\d{4,}$/.test(a.number) && d[0].document.filename === `${a.number}.pdf`);
  assert("its caption says it is a trial with illustrative prices, and that nothing was recorded", d[0].document.caption.startsWith(`🧪 تجربة — هكذا يصل عرض سعر الطلب الخاص ${SQ.quoteName(id)}`) && d[0].document.caption.includes("الأسعار فيه توضيحية ومكتوب عليه «تجربة»") && d[0].document.caption.includes(TR.S62_TRIAL_TAIL));
  assert("no quotation is recorded: no sale.order, no number on the request, its state as it was", saleOrders().length === 0 && JSON.stringify([quote(id), linesOf(id)]) === before && writes().filter((w) => w.model !== "res.partner").length === 0);
  assert("the PDF was built once and kept under the trial's number", KIT.gotenberg === 1 && r2.length === 1 && r2[0].includes("SQ-TRIAL-"));
  const data = TR.trialQuotationData((await quiet(() => SQ.readQuote(env, id)))!, Date.now());
  assert("the PDF's lines carry the illustrative prices, never the request's own (4.75 is on the first line)", data.items.length === 6 && data.items[0].price === 5 && data.items[1].price === 6.25 && !data.items.some((i: any) => i.price === 4.75) && data.items[0].total === 1464 * 5);
  const netReq = request(undefined, { x_price_mode: "net" });
  const nd = TR.trialQuotationData((await quiet(() => SQ.readQuote(env, netReq)))!, Date.now());
  assert("a «قبل الضريبة» request's trial prints the illustrative prices before VAT, with the VAT under them", nd.items[0].price === 5 && nd.vatInclusive === false && nd.totals?.subtotalLabel === "المجموع قبل الضريبة" && nd.grandTotal > nd.subtotal);
  assert("…it is marked «تجربة» in the customer's name and in its note, and carries no seal (not issued)", data.customer.name === "🧪 تجربة — شركة مدارات للاغذية" && data.footerNote === TR.TRIAL_NOTE && data.issued === false && data.quotationNumber === TR.trialQuotationNumber(id));
  assert("the illustrative prices are plainly not real ones (5, 6.25, 7.5, …), whatever the line holds", TR.illustrativePrice(0) === 5 && TR.illustrativePrice(1) === 6.25 && TR.illustrativePrice(8) === 5 && TR.TRIAL_NOTE.includes("تجربة") && TR.TRIAL_NOTE.includes("توضيحية"));
  assert("nothing reaches the customer or a source", others() === 0);
  assert("once a day", (await (await post(env, "quotation", "HOOK-0123456789abcdef0123456789abcdef", id)).json() as any).reason === "already_today" && docsTo(OWNER).length === 1);
}

done();
