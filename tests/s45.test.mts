// § 45 — the launch night (2026-09-30).
//
//   [ب] Baraa's window for the night (src/owner-window.ts):
//       • 21:30 outside his window: utak_owner_daily_summary_v1 («ملخص عمليات
//         يو تاك ليوم {{1}}» + utak_v2_summary's three variables + «تم الاطلاع»)
//         once it is APPROVED / UTILITY, utak_v2_summary otherwise (as before);
//         inside his window the text, as before — unless the window closes
//         before tomorrow's 06:00: then template 1 first;
//       • his tap on «تم الاطلاع»: an inbound — the window opens, what is held
//         for him goes, one line «تم ✅، تنبيهات الليلة تصلك مباشرة»; no order,
//         no complaint;
//       • the day's price review while his window is closed (§ 54: ONE
//         message for the whole day, src/price-review.ts — it replaced a held
//         message per exception): nothing is held, the review is owed;
//         utak_owner_price_review_v1 with the count of the items waiting for
//         his decision, once per price day, only when usable (else the review
//         just stays owed); «عرض الاستثناءات» sends the review itself, built at
//         his tap, with its three buttons; it is owed until 06:00 of its day
//         (after it only on a day that was not published); his window open →
//         the review goes directly and no template.
//   [ج] Omar on seven days: a Friday line in his schedule makes Friday a
//       working day everywhere (the operating cost, «بدء الدوام», the purchase
//       list after Thursday's shift, the driver's follow-up) — no Friday
//       constant anywhere.
//   [س] schema: every Odoo request names real fields and values.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s45.test.mts

import { readFileSync } from "node:fs";
import {
  OWNER, closeOwnerWindow, ctx, employee, heldFor, inbound, openWindow, quiet, reset, rows, seed, sentTo, setRiyadh, signed, table, workSchedule,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const FIX = [
  "fixtures-odoo-fields-20260924.json", "fixtures-odoo-fields-20260925-review.json", "fixtures-odoo-fields-20260925-team.json",
  "fixtures-odoo-fields-20260925-gateway.json", "fixtures-odoo-fields-20260925-s36.json", "fixtures-odoo-fields-20260925-s37.json",
  "fixtures-odoo-fields-20260926-b3.json", "fixtures-odoo-fields-20260926-s39.json", "fixtures-odoo-fields-20260926-s40.json",
  "fixtures-odoo-fields-20260926-s41.json", "fixtures-odoo-fields-20260927-s42.json", "fixtures-odoo-fields-20260928-s44.json",
  "fixtures-odoo-fields-20261001-s49.json", "fixtures-odoo-fields-20261005-s54.json", // § 46 + § 47: the pricing board's fields on x_price_day / x_price_day_line, x_expected_cartons, product.template.x_utak_new, x_min_margin_pct, x_break_even / x_suggested_price, x_decision «profit» (last: it wins)
].map((f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")));
const REAL: Record<string, string[]> = Object.assign({}, ...FIX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FIX.map((f) => f._selections ?? {}));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ intent: "other", confidence: 0.9 }) }] }), { status: 200 });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body && typeof init.body === "string") {
    const b = JSON.parse(init.body);
    const writes: Array<Record<string, unknown>> = [b.vals ?? {}, ...((b.vals_list ?? []) as Array<Record<string, unknown>>)];
    const names = [
      ...((b.domain ?? []) as unknown[]).filter(Array.isArray).map((t: any) => String(t[0])),
      ...(b.fields ?? []),
      ...writes.flatMap((v) => Object.keys(v)),
    ];
    const bad = names.filter((f: string) => !known(m[1], f));
    const badSel = writes.flatMap((v) => Object.entries(v))
      .filter(([k, val]) => SELECTIONS[`${m[1]}.${k}`] && val !== false && !SELECTIONS[`${m[1]}.${k}`].includes(String(val)))
      .map(([k, val]) => `${k}=${val}`);
    if (bad.length || badSel.length) {
      rejected.push(`${m[1]}.${m[2]}: ${[...bad, ...badSel].join(",")}`);
      const message = bad.length ? `Invalid field '${bad[0]}' on '${m[1]}'` : `Wrong value for ${badSel[0]}`;
      return new Response(JSON.stringify({ name: "builtins.ValueError", message, arguments: [message] }), { status: 500 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const { setOdooRetryHooksForTests } = await import("../src/odoo.ts");
setOdooRetryHooksForTests({ sleep: async () => {}, alert: async () => {} });
const { clearTemplateCache } = await import("../src/templates.ts");
const SUM = await import("../src/owner-summary.ts");
const PRV = await import("../src/price-review.ts");
const OW = await import("../src/owner-window.ts");
const GW = await import("../src/wa-gateway.ts");
const WIN = await import("../src/wa-window.ts");
const { textContent } = await import("../src/meta.ts");
const worker = (await import("../src/index.ts")).default;

// ---------------------------------------------------------------- helpers
const TODAY = "2026-10-01";
const ownerMsgs = () => sentTo(OWNER);
const tplName = (b: any) => b?.template?.name ?? null;
const tplParams = (b: any) => ((b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters ?? []).map((p: any) => p.text);
const tplPayloads = (b: any) => (b?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => `${c.index}:${c.parameters?.[0]?.payload}`);
const textOf = (b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? "");
/** A template row as the sync writes it (x_purpose «other»: never picked by a purpose lookup). */
function ownerTpl(name: string, status: string, category: string, params: number, body: string, buttons: string): number {
  return seed("x_whatsapp_template", {
    x_purpose: "other", x_meta_template_id: name, x_language: "ar", x_meta_status: status, x_param_count: params, x_category: category,
    x_body_text: body, x_buttons_text: buttons,
  });
}
const T1_BODY = "ملخص عمليات يو تاك ليوم {{1}}\n\nطلبات: {{2}}\nتوصيلات: {{3}}\nإجمالي: {{4}} ريال\n\nتفاصيل أكثر في لوحة القيادة.";
const T2_BODY = "أسعار يو تاك ليوم {{1}}: {{2}} صنف بانتظار قرارك قبل 06:00.";
const t1 = (status = "APPROVED", category = "UTILITY") => ownerTpl(OW.SUMMARY_TEMPLATE, status, category, 4, T1_BODY, "تم الاطلاع");
const t2 = (status = "APPROVED", category = "UTILITY") => ownerTpl(OW.PRICE_REVIEW_TEMPLATE, status, category, 2, T2_BODY, "عرض الاستثناءات");

function summaryEnv(riyadh = `${TODAY} 21:30`): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh); rejected.length = 0;
  seed("x_whatsapp_template", { x_purpose: "owner_summary", x_meta_template_id: "utak_v2_summary", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 3, x_category: "UTILITY",
    x_body_text: "ملخص اليوم جاهز\nطلبات: {{1}}\nتوصيلات: {{2}}\nإجمالي: {{3}} ريال\nتفاصيل أكثر في لوحة القيادة." });
  return env;
}
async function summary(env: any) {
  const r = await quiet(() => SUM.sendOwnerSummary(env));
  return { r, m: ownerMsgs() };
}

// ================================================================ [ب] the 21:30 summary
console.log("\n[ب] 21:30 outside his window: template 1 once APPROVED / UTILITY, utak_v2_summary otherwise");
{
  const env = summaryEnv(); closeOwnerWindow(env);
  const { r, m } = await summary(env);
  assert("no row for template 1 → utak_v2_summary (as before)", r.action === "template" && m.length === 1 && tplName(m[0]) === "utak_v2_summary", `${r.action} ${JSON.stringify(m)}`);
}
{
  const env = summaryEnv(); closeOwnerWindow(env); t1("PENDING");
  const { r, m } = await summary(env);
  assert("template 1 PENDING at Meta → utak_v2_summary", r.action === "template" && m.length === 1 && tplName(m[0]) === "utak_v2_summary", `${r.action} ${JSON.stringify(m)}`);
}
{
  const env = summaryEnv(); closeOwnerWindow(env); t1("APPROVED", "MARKETING");
  const { r, m } = await summary(env);
  assert("template 1 filed MARKETING → never used; utak_v2_summary", r.action === "template" && m.length === 1 && tplName(m[0]) === "utak_v2_summary", `${r.action} ${JSON.stringify(m)}`);
}
{
  const env = summaryEnv(); closeOwnerWindow(env); t1();
  const f = await quiet(() => SUM.readSummaryFigures(env));
  const want = SUM.summaryParams(f);
  const { r, m } = await summary(env);
  assert("APPROVED / UTILITY → utak_owner_daily_summary_v1, one message", r.action === "template" && m.length === 1 && tplName(m[0]) === OW.SUMMARY_TEMPLATE, `${r.action} ${JSON.stringify(m)}`);
  const p = tplParams(m[0]);
  assert("{{1}} the operations day «1 أكتوبر 2026», then utak_v2_summary's three variables in order",
    p.length === 4 && p[0] === "1 أكتوبر 2026" && p[1] === want[0] && p[2] === want[1] && p[3] === want[2], JSON.stringify(p));
  assert("its quick reply carries the «تم الاطلاع» payload (index 0)", JSON.stringify(tplPayloads(m[0])) === JSON.stringify([`0:${OW.SUMMARY_ACK_PAYLOAD}`]), JSON.stringify(tplPayloads(m[0])));
  const again = await quiet(() => SUM.sendOwnerSummary(env));
  assert("still once a day", again.action === "sent_before" && ownerMsgs().length === 1, again.action);
}

console.log("\n[ب] 21:30 inside his window: the text — template 1 first only when the window closes before 06:00");
{
  const env = summaryEnv(); t1();   // reset(): his window open for good
  const { r, m } = await summary(env);
  assert("window open past tomorrow's 06:00 → the text, as before", r.action === "session" && m.length === 1 && m[0].type === "text" && textOf(m[0]).startsWith("📊 ملخص اليوم"), `${r.action} ${JSON.stringify(m)}`);
}
{
  const env = summaryEnv(); t1();
  openWindow(env, OWNER, 13 * 60 + 30);   // he wrote at 08:00 → open until 07:50 tomorrow
  const { r, m } = await summary(env);
  assert("he wrote at 08:00 (open until 07:50 tomorrow) → the text", r.action === "session" && m[0]?.type === "text", `${r.action} ${JSON.stringify(m)}`);
}
{
  const env = summaryEnv(); t1();
  openWindow(env, OWNER, 20 * 60);        // he wrote at 01:30 → closes 01:20 tomorrow, before 06:00
  const { r, m } = await summary(env);
  assert("he wrote at 01:30 (closes 01:20 tomorrow) → template 1 in place of the text, with its button",
    r.action === "template" && m.length === 1 && tplName(m[0]) === OW.SUMMARY_TEMPLATE && tplPayloads(m[0]).length === 1, `${r.action} ${JSON.stringify(m)}`);
}
{
  const env = summaryEnv(); t1("PENDING");
  openWindow(env, OWNER, 20 * 60);
  const { r, m } = await summary(env);
  assert("…the same window, template 1 not approved → the text (as before)", r.action === "session" && m[0]?.type === "text", `${r.action} ${JSON.stringify(m)}`);
}

console.log("\n[ب] his tap on «تم الاطلاع»: the window opens, the held go, one line — never an order or a complaint");
{
  const env = summaryEnv(`${TODAY} 21:40`); closeOwnerWindow(env);
  await quiet(() => GW.sendViaGateway(env, { purpose: "owner_alert", to: OWNER, content: textContent("تنبيه محفوظ للتجربة") }));
  assert("(setup) an alert is held for him", heldFor(env, OWNER).length === 1 && ownerMsgs().length === 0, JSON.stringify(ownerMsgs()));
  const orders0 = rows("x_daily_order").length, complaints0 = rows("x_complaint").length;
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "button", button: { payload: OW.SUMMARY_ACK_PAYLOAD, text: "تم الاطلاع" } })), env, ctx));
  const w = await WIN.readWindow(env, OWNER);
  assert("his 24h window is open (until 21:30 tomorrow, Meta's timestamp)", w.open && w.closesAtMs > Date.now() + 23 * 3600_000, JSON.stringify(w));
  const texts = ownerMsgs().map(textOf);
  assert("the held alert went at once", texts.includes("تنبيه محفوظ للتجربة") && heldFor(env, OWNER).length === 0, JSON.stringify(texts));
  assert("one reply «تم ✅، تنبيهات الليلة تصلك مباشرة», after the flush", texts.at(-1) === "تم ✅، تنبيهات الليلة تصلك مباشرة" && texts.filter((t) => t === OW.SUMMARY_ACK_TEXT).length === 1, JSON.stringify(texts));
  assert("nothing else: no order, no complaint, two messages in all", rows("x_daily_order").length === orders0 && rows("x_complaint").length === complaints0 && ownerMsgs().length === 2, JSON.stringify(texts));
}

// ================================================================ [ب] the day's price review (§ 54)
const PDAY = "2026-10-02";
/** A draft price day with `n` items waiting for his decision (طماطم / خيار / بصل): a purchase price, no market price. */
function priceEnv(n: number, riyadh = `${PDAY} 04:00`): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh); rejected.length = 0;
  seed("product.template", { id: 3, name: "بصل" });
  seed("x_product_packaging", { id: 31, x_name: "كيس", x_product_tmpl_id: 3 });
  const day = seed("x_price_day", { x_date: PDAY, x_state: "draft", x_name: `أسعار ${PDAY}`, x_utak_simulation: false });
  [[1, 11], [2, 21], [3, 31]].slice(0, n).forEach(([p, k], i) => seed("x_price_day_line", {
    x_day_id: day, x_sequence: i + 1, x_product_tmpl_id: p, x_packaging_id: k, x_status: "exception", x_decision: false,
    x_cost_price: 20, x_market_price: 0, x_market_count: 0, x_unit_profit: 0, x_sale_price: 0, x_reason: "لا سعر سوق",
  }));
  return env;
}
/** § 54 — the day's review itself: ONE interactive message with every item (it replaced a message per exception). */
const dayReviews = () => ownerMsgs().filter((b: any) => b?.type === "interactive" && /مراجعة أسعار اليوم/.test(textOf(b)));
/** Template 2 (utak_owner_price_review_v1). */
const reviewMsgs = () => ownerMsgs().filter((b: any) => tplName(b) === OW.PRICE_REVIEW_TEMPLATE);
const buttonIds = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id);
/** § 54 — nothing is held for the review: it is «owed» (a KV mark of its day) and built at his next message. */
const owed = (env: any) => env.MSG_DEDUP.store.has(`prv_owed:v1:${PDAY}`);
const dayId = () => [...table("x_price_day").values()][0].id;
const notify = (env: any) => quiet(() => PRV.notifyPriceReviewMessage(env));
const tapReview = (env: any) => quiet(() => worker.fetch(signed(inbound(OWNER, { type: "button", button: { payload: OW.PRICE_REVIEW_PAYLOAD, text: "عرض الاستثناءات" } })), env, ctx));

console.log("\n[ب] the day's review while his window is closed: nothing held, the review owed, template 2 with the count, once per price day");
{
  const env = priceEnv(3); closeOwnerWindow(env); t2();
  const r = await notify(env);
  assert("nothing is held and nothing is sent of the review itself (window closed): it is owed to him", r.action === "window_closed" && heldFor(env, OWNER).length === 0 && dayReviews().length === 0 && owed(env), JSON.stringify({ r, held: heldFor(env, OWNER).map((i: any) => i.purpose) }));
  assert("template 2 went once: «2 أكتوبر 2026», 3", r.review === "sent" && r.count === 3 && reviewMsgs().length === 1 && JSON.stringify(tplParams(reviewMsgs()[0])) === JSON.stringify(["2 أكتوبر 2026", "3"]), JSON.stringify({ r, m: ownerMsgs() }));
  assert("…with the «عرض الاستثناءات» payload", JSON.stringify(tplPayloads(reviewMsgs()[0])) === JSON.stringify([`0:${OW.PRICE_REVIEW_PAYLOAD}`]), JSON.stringify(tplPayloads(reviewMsgs()[0])));
  setRiyadh(`${PDAY} 04:05`);
  seed("product.template", { id: 4, name: "كوسا" }); seed("x_product_packaging", { id: 41, x_name: "كرتون", x_product_tmpl_id: 4 });
  seed("x_price_day_line", { x_day_id: dayId(), x_sequence: 4, x_product_tmpl_id: 4, x_packaging_id: 41, x_status: "exception", x_decision: false, x_cost_price: 20, x_market_price: 0, x_reason: "لا سعر سوق" });
  const again = await notify(env);
  assert("a later tick (a new item waiting too): no second template 2, still nothing held, the review still owed", again.action === "window_closed" && again.count === 4 && !again.review && reviewMsgs().length === 1 && ownerMsgs().length === 1 && heldFor(env, OWNER).length === 0 && owed(env), JSON.stringify(again));
  assert("the day's claim is in KV", env.MSG_DEDUP.store.has(`btnlock:v1:owner_price_review:${PDAY}`));
}
{
  const env = priceEnv(3); closeOwnerWindow(env); t2();
  const lines = rows("x_price_day_line");
  Object.assign(lines[0], { x_decision: "skip", x_status: "unpublished" });
  await notify(env);
  assert("the count is the items still waiting for his decision (one decided in Odoo → 2)", JSON.stringify(tplParams(reviewMsgs()[0])) === JSON.stringify(["2 أكتوبر 2026", "2"]), JSON.stringify(tplParams(reviewMsgs()[0])));
}
{
  const env = priceEnv(3); closeOwnerWindow(env); t2();
  // § 54 — خيار gets a market price above its «بدون خسارة»: the rule publishes it by itself, it does not wait for him
  Object.assign(rows("x_price_day_line")[1], { x_status: "auto", x_market_price: 30, x_market_count: 1, x_sale_price: 30, x_break_even: 26.45, x_suggested_price: 29, x_unit_profit: 5.09, x_reason: false });
  const r = await notify(env);
  assert("…and not the items the rule publishes without him (one automatic → 2 of the 3)", r.count === 2 && JSON.stringify(tplParams(reviewMsgs()[0])) === JSON.stringify(["2 أكتوبر 2026", "2"]), JSON.stringify({ r, p: reviewMsgs().map(tplParams) }));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2("PENDING");
  const r = await notify(env);
  assert("template 2 not approved → no template, nothing held: the review stays owed to his next message", reviewMsgs().length === 0 && heldFor(env, OWNER).length === 0 && ownerMsgs().length === 0 && owed(env), JSON.stringify({ r, m: ownerMsgs() }));
  assert("…decided before the gateway («not_usable»): no «skipped» row for it", r.review === "not_usable" && !rows("x_wa_message").some((w: any) => /owner_price_review/.test(String(w.x_debug_payload ?? ""))), JSON.stringify(r));
  assert("…and no claim taken (a later tick may still send it once approved)", !env.MSG_DEDUP.store.has(`btnlock:v1:owner_price_review:${PDAY}`));
  const row = [...table("x_whatsapp_template").values()].find((t: any) => t.x_meta_template_id === OW.PRICE_REVIEW_TEMPLATE)!;
  row.x_meta_status = "APPROVED";
  setRiyadh(`${PDAY} 04:05`);
  seed("x_price_day_line", { x_day_id: dayId(), x_sequence: 3, x_product_tmpl_id: 3, x_packaging_id: 31, x_status: "exception", x_decision: false, x_cost_price: 20, x_market_price: 0, x_reason: "لا سعر سوق" });
  await notify(env);
  assert("approved at 04:05 (one more item waiting meanwhile) → the next tick sends it, with all 3 waiting (not the 1 new)",
    reviewMsgs().length === 1 && tplParams(reviewMsgs()[0])[1] === "3", JSON.stringify(ownerMsgs().map(tplParams)));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2("APPROVED", "MARKETING");
  const r = await notify(env);
  assert("template 2 filed MARKETING → never used («not_usable», before the gateway); the review owed, nothing held", reviewMsgs().length === 0 && heldFor(env, OWNER).length === 0 && owed(env) && r.review === "not_usable", JSON.stringify(r));
}
{
  const env = priceEnv(2); t2();   // his window open
  const r = await notify(env);
  const [m] = dayReviews();
  assert("his window open → the review goes directly — ONE message with both items — and no template 2", r.action === "sent" && dayReviews().length === 1 && ownerMsgs().length === 1 && reviewMsgs().length === 0 && !r.review && /طماطم: شراء 20/.test(textOf(m)) && /خيار: شراء 20/.test(textOf(m)), JSON.stringify({ r, m: ownerMsgs().map((b: any) => tplName(b) ?? textOf(b)) }));
  assert("…with its three buttons («✅ اعتمد الكل كما هو» / «✏️ مراجعة» / «⛔ لا تنشر اليوم»), and nothing owed or held", JSON.stringify(buttonIds(m)) === JSON.stringify([`prv_a_${dayId()}_1`, `prv_r_${dayId()}_1`, `prv_n_${dayId()}_1`]) && !owed(env) && heldFor(env, OWNER).length === 0, JSON.stringify(buttonIds(m)));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2("PENDING");
  await notify(env);
  const row = [...table("x_whatsapp_template").values()].find((t: any) => t.x_meta_template_id === OW.PRICE_REVIEW_TEMPLATE)!;
  row.x_meta_status = "APPROVED";
  setRiyadh(`${PDAY} 04:05`);
  openWindow(env, OWNER, 1);   // his window open again before the next tick
  const r = await notify(env);
  assert("the review still owed but his window open → the tick sends the review itself, no template 2", r.action === "sent" && dayReviews().length === 1 && reviewMsgs().length === 0 && !owed(env) && heldFor(env, OWNER).length === 0, JSON.stringify({ r, m: ownerMsgs().map(tplName) }));
}
{
  const env = priceEnv(2); t2();   // his window open at 04:00: the review reaches him
  await notify(env);
  closeOwnerWindow(env);
  setRiyadh(`${PDAY} 04:05`);
  const r = await notify(env);
  assert("the review reached him before and nothing changed since → no template 2 (his window closed now), nothing owed", reviewMsgs().length === 0 && r.action === "sent_before" && dayReviews().length === 1 && !owed(env), JSON.stringify(r));
  // …then one more item waits for him (بصل), his window still closed: the updated review is owed, and template 2 goes
  setRiyadh(`${PDAY} 04:10`);
  seed("x_price_day_line", { x_day_id: dayId(), x_sequence: 3, x_product_tmpl_id: 3, x_packaging_id: 31, x_status: "exception", x_decision: false, x_cost_price: 20, x_market_price: 0, x_reason: "لا سعر سوق" });
  const more = await notify(env);
  assert("…a new item after the review reached him, his window closed → template 2 with ALL 3 waiting for his decision (not the 1 that is new), no second review, the update owed", more.action === "window_closed" && more.count === 3 && more.review === "sent" && reviewMsgs().length === 1 && JSON.stringify(tplParams(reviewMsgs()[0])) === JSON.stringify(["2 أكتوبر 2026", "3"]) && dayReviews().length === 1 && owed(env), JSON.stringify({ more, p: reviewMsgs().map(tplParams) }));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2();
  for (const t of [...table("x_whatsapp_template").values()]) if (t.x_purpose === "conv_open_owner") t.x_meta_status = "PENDING";
  seed("x_whatsapp_template", { x_purpose: "conv_open_owner", x_meta_template_id: "utak_update_owner", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "MARKETING" });
  await notify(env);
  assert("never utak_update_owner (conv_open_owner): template 2 only", reviewMsgs().length === 1 && !ownerMsgs().some((b: any) => tplName(b) === "utak_update_owner"), JSON.stringify(ownerMsgs().map(tplName)));
}

{
  // a day that publishes whole by itself (every line automatic: its market 30 above «بدون خسارة» 26.45) wakes nobody
  const env = priceEnv(2); closeOwnerWindow(env); t2();
  for (const l of rows("x_price_day_line")) Object.assign(l, { x_status: "auto", x_market_price: 30, x_market_count: 1, x_sale_price: 30, x_break_even: 26.45, x_suggested_price: 29, x_unit_profit: 5.09, x_reason: false });
  const r = await notify(env);
  assert("no item needs his decision (the whole day is automatic) → no template 2; the review is owed to his next message all the same", r.action === "window_closed" && r.count === 0 && !r.review && ownerMsgs().length === 0 && owed(env) && !env.MSG_DEDUP.store.has(`btnlock:v1:owner_price_review:${PDAY}`), JSON.stringify(r));
}
{
  const env = priceEnv(2); t2();   // his window open
  const open = await quiet(() => OW.notifyPriceReview(env, PDAY, 2));
  closeOwnerWindow(env);
  const zero = await quiet(() => OW.notifyPriceReview(env, PDAY, 0));
  assert("template 2 itself (notifyPriceReview): never with his window open, never for a count of 0 — and no claim taken by either", open === null && zero === null && ownerMsgs().length === 0 && !env.MSG_DEDUP.store.has(`btnlock:v1:owner_price_review:${PDAY}`), JSON.stringify([open, zero]));
}

console.log("\n[ب] «عرض الاستثناءات»: his tap sends the review itself, built then, with its buttons; owed until 06:00, not after on a day still to be published");
{
  const env = priceEnv(2, `${PDAY} 04:00`); closeOwnerWindow(env); t2();
  await notify(env);
  setRiyadh(`${PDAY} 05:55`);
  const lines = rows("x_price_day_line");
  Object.assign(lines[0], { x_cost_price: 22 });   // the day moved after the template went: the review is built at his tap, not at 04:00
  await tapReview(env);
  const rv = dayReviews();
  assert("05:55: ONE review with both items and the three buttons (prv_a / prv_r / prv_n of the day)", rv.length === 1 && /خيار: شراء 20/.test(textOf(rv[0])) && JSON.stringify(buttonIds(rv[0])) === JSON.stringify([`prv_a_${dayId()}_1`, `prv_r_${dayId()}_1`, `prv_n_${dayId()}_1`]), JSON.stringify(rv.map((b: any) => [textOf(b), buttonIds(b)])));
  assert("…built at his tap from the day as it is then (طماطم's purchase 22, changed at 05:55 — not the 20 of 04:00)", /طماطم: شراء 22/.test(textOf(rv[0])) && !/طماطم: شراء 20/.test(textOf(rv[0])), textOf(rv[0]));
  assert("…no extra line (the review was the answer), nothing held, nothing owed any more", heldFor(env, OWNER).length === 0 && !owed(env) && !ownerMsgs().some((b: any) => textOf(b) === OW.PRICE_REVIEW_NOTHING_TEXT) && ownerMsgs().length === 2, JSON.stringify(ownerMsgs().map((b: any) => tplName(b) ?? textOf(b))));
  await tapReview(env);
  assert("a second tap, nothing waiting → one line saying so, and no second review", ownerMsgs().filter((b: any) => textOf(b) === OW.PRICE_REVIEW_NOTHING_TEXT).length === 1 && dayReviews().length === 1, JSON.stringify(ownerMsgs().map(textOf)));
  assert("no order and no complaint from either tap", rows("x_daily_order").length === 0 && rows("x_complaint").length === 0);
}
{
  const env = priceEnv(2, `${PDAY} 04:00`); closeOwnerWindow(env); t2();
  await notify(env);
  assert("the owed review is a mark of its day in KV, not a held message with an expiry", owed(env) && heldFor(env, OWNER).length === 0);
  setRiyadh(`${PDAY} 06:00`);
  await tapReview(env);
  assert("at 06:00 on a day still draft (the publication decides now): no review sent, the line says nothing is waiting", dayReviews().length === 0 && ownerMsgs().some((b: any) => textOf(b) === OW.PRICE_REVIEW_NOTHING_TEXT), JSON.stringify(ownerMsgs().map(textOf)));
}
{
  // the day is marked «missed» by hand here; the same path through the real 06:00 tick (the review's step before the
  // deadline's, on a day still «مسودة») is covered in tests/s54.test.mts.
  const env = priceEnv(2, `${PDAY} 04:00`); closeOwnerWindow(env); t2();
  await notify(env);
  [...table("x_price_day").values()][0].x_state = "missed";   // 06:00 passed with nothing approved
  setRiyadh(`${PDAY} 06:10`);
  await tapReview(env);
  const rv = dayReviews();
  assert("after 06:00 on a day that was NOT published and whose review never reached him: his tap sends it, saying an approval publishes at once", rv.length === 1 && /فات موعد 06:00 ولم تُنشر أسعار اليوم: اعتمادك الآن ينشر فوراً\./.test(textOf(rv[0])) && buttonIds(rv[0]).length === 3 && !ownerMsgs().some((b: any) => textOf(b) === OW.PRICE_REVIEW_NOTHING_TEXT), JSON.stringify(ownerMsgs().map(textOf)));
}

console.log("\n[ب] the owner guard lets template 2 through; the purpose is known");
{
  const { purposePolicy } = await import("../src/wa-purposes.ts");
  assert("owner_price_review is a known operational purpose", purposePolicy(OW.PRICE_REVIEW_PURPOSE)?.kind === "operational");
  const env = priceEnv(1); closeOwnerWindow(env); const id = t2();
  const row = table("x_whatsapp_template").get(id)!;
  const r = await quiet(() => GW.sendViaGateway(env, { purpose: OW.PRICE_REVIEW_PURPOSE, to: OWNER, content: { kind: "template", row: row as any, params: ["2 أكتوبر 2026", "1"] }, noHold: true }));
  assert("the owner guard lets owner_price_review through", GW.gatewayDecision(r)?.action === "template", JSON.stringify(GW.gatewayDecision(r)));
}

// ================================================================ [ج] Omar on seven days
const OC = await import("../src/operating-cost.ts");
const ATT = await import("../src/attendance.ts");
const ROS = await import("../src/team-roster.ts");
const DRVF = await import("../src/driver-followup.ts");
const DRV = 603, DRV_PHONE = "966500000603";
const THU = "2026-10-01", FRI = "2026-10-02";
/** «UTAK — عمر» on the tenant before § 45: Saturday–Thursday 02:00–12:00 (Odoo: Monday 0 … Sunday 6). */
const SAT_THU: Array<[number, number, number]> = [[5, 2, 12], [6, 2, 12], [0, 2, 12], [1, 2, 12], [2, 2, 12], [3, 2, 12]];
/** … and since § 45 ج: the same plus Friday (4) 02:00–12:00. */
const SEVEN: Array<[number, number, number]> = [...SAT_THU, [4, 2, 12]];
function omarEnv(riyadh: string, schedule = SEVEN): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh); rejected.length = 0;
  seed("res.partner", { id: DRV, name: "عمر المجهلي", x_whatsapp_number: "+" + DRV_PHONE });
  const cal = workSchedule(schedule, { name: "UTAK — عمر" });
  employee(DRV, [71, 72, 73], { x_utak_attendance: true, resource_calendar_id: cal });
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: "utak_shift_start_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  return env;
}
/** The real cost lines of 10-01 (x_operating_cost #2–#11, § 44 / 09-30): 7 monthly = 10335, yearly 11000, daily 83 + 50. */
function realCosts(): void {
  const line = (name: string, f: string, amount: number) => seed("x_operating_cost", { x_name: name, x_cost_type: "variable", x_frequency: f, x_amount: amount, x_date_from: "2026-10-01", x_date_to: false, x_utak_simulation: false });
  line("إيجار الباص المبرد", "monthly", 5000); line("الديزل", "monthly", 1000); line("راتب عمر", "monthly", 4000);
  line("تأمينات عمر (أخطار مهنية 2%)", "monthly", 80); line("اشتراك Odoo", "monthly", 80); line("Claude API", "monthly", 75);
  line("الرصيد والاتصالات", "monthly", 100); line("تجديد هوية/إقامة عمر", "yearly", 11000);
  line("رسوم دخول السوق", "daily", 83); line("العربية", "daily", 50);
}

console.log("\n[ج] the operating cost: a Friday line makes October 31 working days and 2026 365 — the cost lines unchanged");
{
  const env = omarEnv(`${THU} 10:00`); realCosts();
  const thu = await quiet(() => OC.dailyOperatingCost(env, THU));
  const fri = await quiet(() => OC.dailyOperatingCost(env, FRI));
  assert("Thursday 10-01: 496.52 (10335 ÷ 31 + 11000 ÷ 365 + 133), October 31 days, 2026 365", thu.total === 496.52 && thu.monthWorkingDays === 31 && thu.yearWorkingDays === 365, JSON.stringify({ t: thu.total, m: thu.monthWorkingDays, y: thu.yearWorkingDays }));
  assert("Friday 10-02: a working day, the same 496.52", fri.workingDay === true && fri.total === 496.52, JSON.stringify({ t: fri.total, w: fri.workingDay }));
  const env6 = omarEnv(`${THU} 10:00`, SAT_THU); realCosts();
  const thu6 = await quiet(() => OC.dailyOperatingCost(env6, THU));
  const fri6 = await quiet(() => OC.dailyOperatingCost(env6, FRI));
  assert("(before § 45, Saturday–Thursday: 565.64 on Thursday, 133 on Friday — the schedule alone makes the difference)", thu6.total === 565.64 && fri6.total === 133 && fri6.workingDay === false, `${thu6.total} ${fri6.total}`);
}

console.log("\n[ج] Friday is a working day for Omar everywhere: his plan, «بدء الدوام» 02:00, the list after Thursday's shift");
{
  const env = omarEnv(`${FRI} 00:00`);
  const roster = await quiet(() => ROS.fetchRoster(env));
  const m = ROS.memberByPartner(roster, DRV)!;
  const p = ROS.dayPlan(roster, m, FRI);
  assert("Friday 10-02: «يوم عمل» 02:00–12:00", p.kind === "work" && p.startMin === 120 && p.endMin === 720, JSON.stringify(p));
  assert("…not a day off (the driver's follow-up reads the same plan)", !DRVF.isOffToday(p));
}
{
  const env = omarEnv(`${FRI} 02:00`); closeOwnerWindow(env);
  await quiet(() => ATT.runAttendanceTick(env));
  const s = sentTo(DRV_PHONE).filter((b: any) => tplName(b) === "utak_shift_start_v2");
  assert("Friday 02:00: «بدء الدوام» (utak_shift_start_v2) to Omar", s.length === 1, JSON.stringify(sentTo(DRV_PHONE)));
}
{
  const env = omarEnv(`${THU} 21:15`); closeOwnerWindow(env); openWindow(env, OWNER);
  const h = await quiet(() => ATT.holdForTask(env, DRV, { kind: "purchase_list", label: "قائمة الشراء" }));
  const a = ownerMsgs().map(textOf).find((t) => t.includes("بعد دوامه")) ?? "";
  assert("Thursday 21:15, the purchase list: held after his shift until «الجمعة 02:00» (not Saturday)", h.hold && h.phase === "after" && h.next === "الجمعة 02:00", JSON.stringify(h));
  assert("…and Baraa's one alert names Friday 02:00", a.includes("(الجمعة 02:00)") && !a.includes("السبت"), a);
  const env6 = omarEnv(`${THU} 21:15`, SAT_THU);
  const h6 = await quiet(() => ATT.holdForTask(env6, DRV, { kind: "purchase_list", label: "قائمة الشراء" }));
  assert("(before § 45: «السبت 02:00»)", h6.next === "السبت 02:00", JSON.stringify(h6));
}

console.log("\n[ج] the driver's follow-up on Friday: 11:30 and 12:30, no «راحة» alert");
{
  const env = omarEnv(`${FRI} 11:20`);
  const emp = [...table("hr.employee").values()].find((e: any) => e.work_contact_id === DRV)!.id;
  seed("x_team_attendance", { x_employee_id: emp, x_date: FRI, x_status: "present", x_sent_at: `${THU} 23:00:00`, x_tapped_at: `${THU} 23:01:00`, x_reminder_sent: false });
  const route = seed("x_delivery_route", { x_driver_id: DRV, x_date: THU, x_status: "dispatched", x_dispatched_at: `${THU} 19:30:00`, x_total_stops: 1, x_stops_completed: 0 });
  const order = seed("x_daily_order", { x_customer_id: 501, x_state: "in_delivery", x_order_date: THU, x_created_via: "whatsapp", x_total_amount: 0 });
  seed("x_delivery_stop", { x_route_id: route, x_order_id: order, x_sequence: 10, x_status: "pending" });
  openWindow(env, DRV_PHONE, 60);
  const tick = async (hm: string) => { setRiyadh(`${FRI} ${hm}`); return quiet(() => DRVF.runDriverFollowupTick(env)); };
  await tick("11:27");
  assert("11:27: nothing yet", sentTo(DRV_PHONE).length === 0 && ownerMsgs().length === 0);
  await tick("11:32");
  assert("11:32 (end − 30): the reminder to Omar with his open stop", sentTo(DRV_PHONE).filter((b: any) => b.type === "text").length === 1, JSON.stringify(sentTo(DRV_PHONE)));
  await tick("12:32");
  const al = ownerMsgs().map(textOf);
  assert("12:32 (end + 30): Baraa's end-of-shift alert", al.length === 1 && al[0].includes("عمر المجهلي"), JSON.stringify(al));
  await tick("18:02");
  assert("18:00: no «يوم راحته» / «إجازة» alert (Friday is his working day)", !ownerMsgs().map(textOf).some((t) => /راحته|إجازة/.test(t)) && ownerMsgs().length === 1, JSON.stringify(ownerMsgs().map(textOf)));
}

// ================================================================ [هـ] the windows at the cutover
console.log("\n[هـ] the 24h windows move with the cutover: sim's KV → prod's KV, merged, nothing lost");
{
  const NOW = Date.parse("2026-09-30T22:40:00+03:00");
  const H = 3600_000;
  const m1 = WIN.mergeWindowRecords({ in: NOW - 2 * H }, null);
  assert("sim only → the same record", JSON.stringify(m1) === JSON.stringify({ in: NOW - 2 * H }), JSON.stringify(m1));
  const m2 = WIN.mergeWindowRecords({ in: NOW - 2 * H }, { in: NOW - 60_000 });
  assert("prod has a newer inbound (after step 1) → the newer one kept", m2?.in === NOW - 60_000, JSON.stringify(m2));
  const m3 = WIN.mergeWindowRecords({ in: NOW - 60_000 }, { in: NOW - 30 * H });
  assert("prod's stale key → sim's newer inbound kept", m3?.in === NOW - 60_000, JSON.stringify(m3));
  const m4 = WIN.mergeWindowRecords({ in: NOW - 2 * H, closed: NOW - H }, null);
  assert("a 131047 after the last inbound stays: the copy never reopens a window Meta closed", m4?.closed === NOW - H && !WIN.evaluateWindow(m4, NOW).open, JSON.stringify(m4));
  const m5 = WIN.mergeWindowRecords({ in: NOW - 2 * H, closed: NOW - H }, { in: NOW - 60_000 });
  assert("…and a newer inbound on prod reopens it (Meta's rule)", WIN.evaluateWindow(m5, NOW).open, JSON.stringify(m5));
  assert("the key lives an hour past the window's end", WIN.windowRecordUntil({ in: NOW }) === NOW + 25 * H);
  const cut = readFileSync(new URL("../scripts/cutover-prod.mts", import.meta.url), "utf8");
  const i1 = cut.indexOf("// 1. Meta\ntry {"), i2 = cut.indexOf("// 2. Odoo\ntry {"), i2b = cut.indexOf("// 2ب. § 45 هـ — the windows"), i3 = cut.indexOf("// 3. sim crons → []");
  assert("the cutover: Meta ← Odoo ← the windows ← sim [] (the order of § 45 ز)", i1 > 0 && i1 < i2 && i2 < i2b && i2b < i3, `${i1} ${i2} ${i2b} ${i3}`);
  assert("…the windows step copies wa_win:v1:* from sim's KV into prod's, merged and read back", cut.includes('const WIN_PREFIX = "wa_win:v1:";') && cut.includes("mergeWindowRecords(sim, parseWin(prodBefore))")
    && cut.includes("await kvPut(PROD_KV, w.key, JSON.stringify(w.merged), w.until);") && cut.includes("prod KV window key(s) not as written"));
  assert("…and a failure rolls it back with the steps before it", cut.includes('completed.includes("2ب") ? rb.s2b : null') && cut.includes('read("step2b-windows-rollback.json")'));
  // § 45 ز — wrangler deploy renews the OAuth token: never a cached one (the 18:36 run's step 4 and its rollback)
  assert("the Cloudflare token is read on every call, never cached", /const cfToken = \(\): string =>/.test(cut) && !/Bearer \$\{cfToken\}[^(]/.test(cut) && (cut.match(/Bearer \$\{cfToken\(\)\}/g) ?? []).length >= 6);
  assert("a re-mark verify that fails with no ✗ is tried again, and stderr's tail is kept", cut.includes("re-mark verify failed with no ✗") && cut.includes("const errTail = "));
  const win = readFileSync(new URL("../src/wa-window.ts", import.meta.url), "utf8");
  assert("the gateway's window source is the worker's own KV first (why the copy is needed)", /Source: KV `wa_win:v1:<digits>`/.test(win) && win.includes("const rec = await readRecord(env, to);\n  if (rec) return evaluateWindow(rec, now, \"kv\");"));
}

// ================================================================ schema gate
console.log("\n[س] every Odoo call used real fields and selection values");
assert("no field / value the tenant does not have", rejected.length === 0, rejected.slice(0, 5).join(" | "));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
