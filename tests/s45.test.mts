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
//       • price exceptions held while his window is closed:
//         utak_owner_price_review_v1 with the undecided count, once per price
//         day, only when usable (else held as before); «عرض الاستثناءات» sends
//         the held exceptions with their buttons; they stay deliverable until
//         06:00 of their day, not before.
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
const PR = await import("../src/prices.ts");
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

// ================================================================ [ب] the price exceptions
const PDAY = "2026-10-02";
/** A draft price day with `n` undecided exceptions (طماطم / خيار / بصل), no market price. */
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
const excMsgs = () => ownerMsgs().filter((b: any) => b?.type === "interactive" && /استثناء في أسعار اليوم/.test(textOf(b)));
const reviewMsgs = () => ownerMsgs().filter((b: any) => tplName(b) === OW.PRICE_REVIEW_TEMPLATE);
const heldExc = (env: any) => heldFor(env, OWNER).filter((i: any) => i.purpose === "owner_price_exception");

console.log("\n[ب] exceptions while his window is closed: template 2 with the count, once per price day");
{
  const env = priceEnv(3); closeOwnerWindow(env); t2();
  const r = await quiet(() => PR.notifyPriceExceptions(env));
  assert("the three exceptions are held (window closed)", heldExc(env).length === 3 && excMsgs().length === 0, JSON.stringify(heldFor(env, OWNER).map((i: any) => i.purpose)));
  assert("template 2 went once: «2 أكتوبر 2026», 3", r.review === "sent" && reviewMsgs().length === 1 && JSON.stringify(tplParams(reviewMsgs()[0])) === JSON.stringify(["2 أكتوبر 2026", "3"]), JSON.stringify({ r, m: ownerMsgs() }));
  assert("…with the «عرض الاستثناءات» payload", JSON.stringify(tplPayloads(reviewMsgs()[0])) === JSON.stringify([`0:${OW.PRICE_REVIEW_PAYLOAD}`]), JSON.stringify(tplPayloads(reviewMsgs()[0])));
  setRiyadh(`${PDAY} 04:05`);
  const table2 = table("x_price_day_line");
  seed("product.template", { id: 4, name: "كوسا" }); seed("x_product_packaging", { id: 41, x_name: "كرتون", x_product_tmpl_id: 4 });
  seed("x_price_day_line", { x_day_id: [...table("x_price_day").values()][0].id, x_sequence: 4, x_product_tmpl_id: 4, x_packaging_id: 41, x_status: "exception", x_decision: false, x_cost_price: 20, x_market_price: 0, x_reason: "لا سعر سوق" });
  void table2;
  await quiet(() => PR.notifyPriceExceptions(env));
  assert("a later tick (a new exception held too): no second template 2", reviewMsgs().length === 1 && heldExc(env).length === 4, JSON.stringify(reviewMsgs().length));
  assert("the day's claim is in KV", env.MSG_DEDUP.store.has(`btnlock:v1:owner_price_review:${PDAY}`));
}
{
  const env = priceEnv(3); closeOwnerWindow(env); t2();
  const lines = rows("x_price_day_line");
  Object.assign(lines[0], { x_decision: "skip", x_status: "unpublished" });
  await quiet(() => PR.notifyPriceExceptions(env));
  assert("the count is the undecided exceptions (one decided in Odoo → 2)", JSON.stringify(tplParams(reviewMsgs()[0])) === JSON.stringify(["2 أكتوبر 2026", "2"]), JSON.stringify(tplParams(reviewMsgs()[0])));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2("PENDING");
  const r = await quiet(() => PR.notifyPriceExceptions(env));
  assert("template 2 not approved → no template, the exceptions held as before", reviewMsgs().length === 0 && heldExc(env).length === 2 && ownerMsgs().length === 0, JSON.stringify({ r, m: ownerMsgs() }));
  assert("…decided before the gateway («not_usable»): no «skipped» row for it", r.review === "not_usable" && !rows("x_wa_message").some((w: any) => /owner_price_review/.test(String(w.x_debug_payload ?? ""))), JSON.stringify(r));
  assert("…and no claim taken (a later tick may still send it once approved)", !env.MSG_DEDUP.store.has(`btnlock:v1:owner_price_review:${PDAY}`));
  const row = [...table("x_whatsapp_template").values()].find((t: any) => t.x_meta_template_id === OW.PRICE_REVIEW_TEMPLATE)!;
  row.x_meta_status = "APPROVED";
  setRiyadh(`${PDAY} 04:05`);
  seed("product.template", { id: 3, name: "بصل" }); seed("x_product_packaging", { id: 31, x_name: "كيس", x_product_tmpl_id: 3 });
  seed("x_price_day_line", { x_day_id: [...table("x_price_day").values()][0].id, x_sequence: 3, x_product_tmpl_id: 3, x_packaging_id: 31, x_status: "exception", x_decision: false, x_cost_price: 20, x_market_price: 0, x_reason: "لا سعر سوق" });
  await quiet(() => PR.notifyPriceExceptions(env));
  assert("approved at 04:05 (one more exception meanwhile) → the next tick sends it, with all 3 undecided (not the 1 new)",
    reviewMsgs().length === 1 && tplParams(reviewMsgs()[0])[1] === "3", JSON.stringify(ownerMsgs().map(tplParams)));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2("APPROVED", "MARKETING");
  const r = await quiet(() => PR.notifyPriceExceptions(env));
  assert("template 2 filed MARKETING → never used («not_usable», before the gateway)", reviewMsgs().length === 0 && heldExc(env).length === 2 && r.review === "not_usable", JSON.stringify(r));
}
{
  const env = priceEnv(2); t2();   // his window open
  const r = await quiet(() => PR.notifyPriceExceptions(env));
  assert("his window open → the exceptions go directly, no template 2", excMsgs().length === 2 && reviewMsgs().length === 0 && !r.review, JSON.stringify({ r, m: ownerMsgs().map(tplName) }));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2("PENDING");
  await quiet(() => PR.notifyPriceExceptions(env));
  const row = [...table("x_whatsapp_template").values()].find((t: any) => t.x_meta_template_id === OW.PRICE_REVIEW_TEMPLATE)!;
  row.x_meta_status = "APPROVED";
  setRiyadh(`${PDAY} 04:05`);
  openWindow(env, OWNER, 1);   // his window open again, the held not flushed yet
  await quiet(() => PR.notifyPriceExceptions(env));
  assert("exceptions still held but his window open → no template 2", heldExc(env).length === 2 && reviewMsgs().length === 0, JSON.stringify(ownerMsgs().map(tplName)));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2();
  env.MSG_DEDUP.store.set(`btnlock:v1:pexc:${PDAY}:1:11`, "done"); env.MSG_DEDUP.store.set(`btnlock:v1:pexc:${PDAY}:2:21`, "done");
  const r = await quiet(() => PR.notifyPriceExceptions(env));
  assert("nothing held for him (notified before, already delivered) → no template 2", reviewMsgs().length === 0 && r.action === "notified_before", JSON.stringify(r));
}
{
  const env = priceEnv(2); closeOwnerWindow(env); t2();
  for (const t of [...table("x_whatsapp_template").values()]) if (t.x_purpose === "conv_open_owner") t.x_meta_status = "PENDING";
  seed("x_whatsapp_template", { x_purpose: "conv_open_owner", x_meta_template_id: "utak_update_owner", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "MARKETING" });
  await quiet(() => PR.notifyPriceExceptions(env));
  assert("never utak_update_owner (conv_open_owner): template 2 only", reviewMsgs().length === 1 && !ownerMsgs().some((b: any) => tplName(b) === "utak_update_owner"), JSON.stringify(ownerMsgs().map(tplName)));
}

console.log("\n[ب] «عرض الاستثناءات»: the held exceptions go with their buttons; kept until 06:00, not before");
{
  const env = priceEnv(2, `${PDAY} 04:00`); closeOwnerWindow(env); t2();
  await quiet(() => PR.notifyPriceExceptions(env));
  setRiyadh(`${PDAY} 05:55`);
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "button", button: { payload: OW.PRICE_REVIEW_PAYLOAD, text: "عرض الاستثناءات" } })), env, ctx));
  const ex = excMsgs();
  const ids = ex.map((b: any) => (b.interactive.action.buttons ?? []).map((x: any) => x.reply.id).join(","));
  const lines = rows("x_price_day_line");
  assert("05:55: both held exceptions sent, each with «لا تنشر» / «عدّل»", ex.length === 2 && ids.includes(`pexc_s_${lines[0].id},pexc_e_${lines[0].id}`) && ids.includes(`pexc_s_${lines[1].id},pexc_e_${lines[1].id}`), JSON.stringify(ids));
  assert("…no extra line (the flush was the answer), nothing held", heldFor(env, OWNER).length === 0 && !ownerMsgs().some((b: any) => textOf(b) === OW.PRICE_REVIEW_NOTHING_TEXT), JSON.stringify(ownerMsgs().map(textOf)));
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "button", button: { payload: OW.PRICE_REVIEW_PAYLOAD, text: "عرض الاستثناءات" } })), env, ctx));
  assert("a second tap, nothing waiting → one line saying so", ownerMsgs().filter((b: any) => textOf(b) === OW.PRICE_REVIEW_NOTHING_TEXT).length === 1, JSON.stringify(ownerMsgs().map(textOf)));
  assert("no order and no complaint from either tap", rows("x_daily_order").length === 0 && rows("x_complaint").length === 0);
}
{
  const env = priceEnv(2, `${PDAY} 04:00`); closeOwnerWindow(env); t2();
  await quiet(() => PR.notifyPriceExceptions(env));
  const exp = heldExc(env).map((i: any) => i.expiresAt);
  const six = Date.parse(`${PDAY}T06:00:00+03:00`);
  assert("a held exception expires at 06:00 of its day exactly", exp.length === 2 && exp.every((e: number) => e === six), JSON.stringify(exp.map((e: number) => new Date(e).toISOString())));
  setRiyadh(`${PDAY} 06:00`);
  await quiet(() => worker.fetch(signed(inbound(OWNER, { type: "button", button: { payload: OW.PRICE_REVIEW_PAYLOAD, text: "عرض الاستثناءات" } })), env, ctx));
  assert("at 06:00 they are stale: not sent (the line says nothing is waiting)", excMsgs().length === 0 && ownerMsgs().some((b: any) => textOf(b) === OW.PRICE_REVIEW_NOTHING_TEXT), JSON.stringify(ownerMsgs().map(textOf)));
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

// ================================================================ schema gate
console.log("\n[س] every Odoo call used real fields and selection values");
assert("no field / value the tenant does not have", rejected.length === 0, rejected.slice(0, 5).join(" | "));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
