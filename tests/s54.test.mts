// § 54 (2026-10-05) — the day's prices reviewed by Baraa in ONE message.
//
//   [أ] the proposed decision: the six rules with the numbers of 2026-10-05 (the record #54), the
//       setting «لما يكون السوق أعلى من المقترح» with its two values, the uplift of § 53, an outlier,
//       no carton share; the engine's lines, the stored day, the publication's check
//   [ب] the one message: nothing before 04:00; one message with every item, its three buttons; 4, 20
//       and 40 items; once; «🔄 تحديث» and the older buttons; his window closed (nothing held, the
//       template, the review at his message); no message per exception, no «عدّل»
//   [ب2] the buttons: «اعتمد الكل», «لا تنشر اليوم», the old version, a second tap, another day
//   [ج] the form utak_owner_review_v1: its JSON at Meta against what the worker sends; the options and
//       the defaults; a manual price, a manual price below «بدون خسارة», «سعر يدوي» without a price;
//       the token; before and after 06:00
//   [د] no decision until 06:00: what is published by itself and what is not, and the 06:00 message
//   [هـ] the trial to Baraa: nothing written, nothing published
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s54.test.mts

import { readFileSync } from "node:fs";
import { CUST_PHONE, OWNER, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, cost, dayOf, done, dp, fresh, lineFor, market, rejected, setExtract } from "./s46-kit.mts";

const PE = await import("../src/pricing-engine.ts");
const PR = await import("../src/prices.ts");
const RV = await import("../src/price-review.ts");
const OC = await import("../src/operating-cost.ts");
const OW = await import("../src/owner-window.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s54-flows.mjs");
// @ts-ignore — plain .mjs helpers
const ODOO = await import("../scripts/lib/s54-odoo.mjs");

const ms = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const NAMES: Record<number, string> = { 1: "موز أمريكي", 2: "رمان وسط", 3: "رمان صغير", 4: "رمان كبير" };

/** The tenant on 2026-10-05: four active items, the day's cost 496.52 over 250 cartons (a share of 1.99), waste 5 %, a minimum profit of 2. */
function world(riyadh = `${DAY} 04:00`, o: { above?: string; uplift?: number } = {}): any {
  const env = fresh(riyadh); cost(496.52); setExtract(null);
  for (const [id, name] of Object.entries(NAMES)) table("product.template").get(Number(id))!.name = name;
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 5;
  const cfg = table("x_pricing_config").get(1)!;
  cfg.x_min_order_sar = 0;
  if (o.above) cfg.x_above_suggested = o.above;
  if (o.uplift) cfg.x_market_uplift_pct = o.uplift;
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  openWindow(env, C1_PHONE);                                  // the customer's list goes as text (not held)
  return env;
}
/** The prices of 2026-10-05: banana 55 / 70, pomegranate (medium) 15 / 20, (small) 12 / —, (large) 22 / 28. */
function prices(): void {
  dp(1, 11, 55); market(1, 11, 70);
  dp(2, 21, 15); market(2, 21, 20);
  dp(3, 31, 12);
  dp(4, 41, 22); market(4, 41, 28);
}
/** `n` more active items (purchase 10 → «بدون خسارة» 14.36, the suggested 17; market 16: published by themselves) in category `cat`. */
function more(n: number, cat: number | false, from: number): void {
  for (let i = 0; i < n; i++) {
    const id = from + i;
    seed("product.template", { id, name: `صنف ${id}`, sale_ok: true, x_is_active_for_sale: true, categ_id: cat });
    seed("x_product_packaging", { id: id * 10 + 1, x_name: "كرتون", x_product_tmpl_id: id, x_is_default: true });
    dp(id, id * 10 + 1, 10); market(id, id * 10 + 1, 16);
  }
}
const engine = (env: any, now?: number) => quiet(() => PR.refreshPriceDay(env, { force: true, ...(now ? { now } : {}) }));
const review = (env: any, now?: number) => quiet(() => RV.notifyPriceReviewMessage(env, now));
const owner = () => sentTo(OWNER);
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const buttonIds = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => String(x?.reply?.id ?? ""));
const buttonTitles = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => String(x?.reply?.title ?? ""));
const withButtons = () => owner().filter((b: any) => b?.interactive?.type === "button");
const texts = () => owner().filter((b: any) => b?.type === "text").map(bodyOf);
const flows = () => owner().filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const tplName = (b: any) => b?.template?.name ?? "";
const kinds = () => JSON.stringify(owner().map((b: any) => tplName(b) || b.interactive?.type || b.type));
const line = (p: number) => lineFor(p) as any;
const tap = (env: any, id: string, now?: number) => quiet(() => RV.handlePriceReviewButton(env, id, now));
let wamid = 0;
const formReply = (env: any, token: string, values: Record<string, unknown>, now?: number, from = OWNER) =>
  quiet(() => RV.handlePriceReviewReply(env, { from: "+" + from, messageId: `wamid.R${++wamid}`, flow: { token, values } }, undefined, now));
const hook = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const button = (id: string, title = "") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
const lineWrites = () => odooLog.filter((c: any) => c.model === "x_price_day_line" && (c.method === "write" || c.method === "create")).length;
const dayWrites = () => odooLog.filter((c: any) => c.model === "x_price_day" && c.method === "write" && "x_state" in (c.body?.vals ?? {})).length;
const T2 = () => seed("x_whatsapp_template", { x_purpose: "other", x_meta_template_id: OW.PRICE_REVIEW_TEMPLATE, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY", x_body_text: "أسعار يو تاك ليوم {{1}}: {{2}} صنف بانتظار قرارك قبل 06:00.", x_buttons_text: "عرض الاستثناءات" });

// ================================================================ أ
console.log("\n[أ] the proposed decision: one rule, in order, with the numbers of 2026-10-05");
{
  const P = (purchase: number | null, sale: number | null, breakEven: number | null, suggested: number | null, o: { outlier?: boolean; above?: any; unitProfit?: number | null } = {}) =>
    PE.proposeDecision({ purchase, sale, breakEven, suggested, unitProfit: o.unitProfit ?? null, outlier: !!o.outlier }, o.above);
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  // the floors of the four purchase prices, as the table of the order gives them
  const floor = (purchase: number) => PE.priceFloor({ purchase, wastePct: 5, opShare: 1.99, vatRatePct: 15, minProfit: 2 })!;
  assert("the floors of 10-05: banana 68.70 / 71.50, medium 20.40 / 23, small 16.78 / 19.50, large 28.85 / 31.50",
    eq([55, 15, 12, 22].map((p) => [floor(p).breakEven, floor(p).suggested]), [[68.7, 71.5], [20.4, 23], [16.78, 19.5], [28.85, 31.5]]), JSON.stringify([55, 15, 12, 22].map(floor)));
  assert("rule 1 — no purchase price → «لا تنشر», never by itself", eq(P(null, 70, null, null), { kind: "skip", price: 0, why: "no_purchase", outlier: false, auto: false }), JSON.stringify(P(null, 70, null, null)));
  assert("rule 3 — no market price → «انشر بالمقترح» 19.50 (small pomegranate), and it waits for Baraa", eq(P(12, null, 16.78, 19.5), { kind: "profit", price: 19.5, why: "no_market", outlier: false, auto: false }), JSON.stringify(P(12, null, 16.78, 19.5)));
  assert("rule 4 — market 20 below «بدون خسارة» 20.40 → «لا تنشر (خسارة)» (medium pomegranate)", eq(P(15, 20, 20.4, 23), { kind: "skip", price: 0, why: "loss", outlier: false, auto: false }), JSON.stringify(P(15, 20, 20.4, 23)));
  assert("rule 4 — market 28 below 28.85 → «لا تنشر (خسارة)» (large pomegranate)", P(22, 28, 28.85, 31.5).kind === "skip" && P(22, 28, 28.85, 31.5).why === "loss");
  assert("rule 5 — «بدون خسارة» 68.70 ≤ market 70 < the suggested 71.50 → «انشر بسعر السوق» 70, by itself (banana)", eq(P(55, 70, 68.7, 71.5), { kind: "market", price: 70, why: "below_suggested", outlier: false, auto: true }), JSON.stringify(P(55, 70, 68.7, 71.5)));
  assert("rule 5 at the edge: market = «بدون خسارة» exactly is no loss", P(15, 20.4, 20.4, 23).kind === "market" && P(15, 20.39, 20.4, 23).kind === "skip");
  assert("rule 6 — market 75 ≥ the suggested 71.50, the default setting → «انشر بسعر السوق» 75, by itself", eq(P(55, 75, 68.7, 71.5), { kind: "market", price: 75, why: "above_suggested", outlier: false, auto: true }), JSON.stringify(P(55, 75, 68.7, 71.5)));
  assert("rule 6 — the setting «بالمقترح» → «انشر بالمقترح» 71.50 (cheaper than the market), by itself", eq(P(55, 75, 68.7, 71.5, { above: "suggested" }), { kind: "profit", price: 71.5, why: "above_suggested", outlier: false, auto: true }), JSON.stringify(P(55, 75, 68.7, 71.5, { above: "suggested" })));
  assert("rule 6 at the edge: market = the suggested price is «أعلى من المقترح» (the setting decides, the price is the same)", P(55, 71.5, 68.7, 71.5).why === "above_suggested" && P(55, 71.5, 68.7, 71.5, { above: "suggested" }).price === 71.5 && P(55, 71.49, 68.7, 71.5, { above: "suggested" }).kind === "market");
  assert("the setting does not touch rule 5: below the suggested price it is the market price whatever it says", eq(P(55, 70, 68.7, 71.5, { above: "suggested" }), P(55, 70, 68.7, 71.5)));
  assert("rule 2 — an outlier: the same decision, marked ⚠️, never by itself", eq(P(55, 70, 68.7, 71.5, { outlier: true }), { kind: "market", price: 70, why: "below_suggested", outlier: true, auto: false })
    && P(15, 20, 20.4, 23, { outlier: true }).kind === "skip" && P(15, 20, 20.4, 23, { outlier: true }).outlier === true);
  assert("…also above the suggested price, by either value of the setting: the decision of rule 6, ⚠️, not by itself", eq(P(55, 75, 68.7, 71.5, { outlier: true }), { kind: "market", price: 75, why: "above_suggested", outlier: true, auto: false })
    && eq(P(55, 75, 68.7, 71.5, { outlier: true, above: "suggested" }), { kind: "profit", price: 71.5, why: "above_suggested", outlier: true, auto: false }));
  assert("no carton share (no «بدون خسارة», no suggested price): a market price is published unless the unit profit is not above zero; none → «لا تنشر»",
    P(20, 26, null, null, { unitProfit: 1.6 }).kind === "market" && P(20, 26, null, null, { unitProfit: 1.6 }).auto === true && P(20, 21, null, null, { unitProfit: -0.74 }).why === "loss" && eq(P(20, null, null, null), { kind: "skip", price: 0, why: "no_price", outlier: false, auto: false }));
  assert("the setting as the rule reads it: «suggested» alone changes it (empty, false, anything else = «بسعر السوق»)",
    PE.aboveSuggestedOf("suggested") === "suggested" && [undefined, false, "", "market", "x", 1].every((v) => PE.aboveSuggestedOf(v) === "market") && PE.ABOVE_SUGGESTED_DEFAULT === "market");

  // ---- the engine's lines
  const items = [1, 2, 3, 4].map((id) => ({ productId: id, productName: NAMES[id], packagingId: id * 10 + 1, packagingName: "كرتون" }));
  const offer = (kind: "purchase" | "market", productId: number, price: number, outlier = false) => ({ kind, price, outlier, partnerId: kind === "purchase" ? 30 : 4, sourceName: kind === "purchase" ? "أحمد" : "عمر", productId, packagingId: productId * 10 + 1, model: kind === "purchase" ? "dp" as const : "po" as const, rowId: productId * 10 + (kind === "purchase" ? 1 : 2) });
  const offers = [offer("purchase", 1, 55), offer("market", 1, 70), offer("purchase", 2, 15), offer("market", 2, 20), offer("purchase", 3, 12), offer("purchase", 4, 22), offer("market", 4, 28)];
  const F = { opShare: 1.99, minProfit: 2 }, V = { ratePct: 15 };
  const plan = PE.computePricing(items, offers, 5, V, F);
  const want = [["market", 70, true], ["skip", 0, false], ["profit", 19.5, false], ["skip", 0, false]];
  assert("the engine, the default setting: banana the market 70 · medium «لا تنشر» · small the suggested 19.50 · large «لا تنشر»", eq(plan.map((l) => [l.proposal.kind, l.proposal.price, l.proposal.auto]), want), JSON.stringify(plan.map((l) => l.proposal)));
  assert("…an exception = a line that is not published by itself: medium and large «loss», small «no_market», banana none", eq(plan.map((l) => l.exceptions), [[], ["loss"], ["no_market"], ["loss"]]), JSON.stringify(plan.map((l) => l.exceptions)));
  assert("…the reason of a loss names both numbers: «سعر السوق 20 أقل من سعر بدون خسارة 20.40»", plan[1].reason === "سعر السوق 20 أقل من سعر بدون خسارة 20.40" && plan[3].reason === "سعر السوق 28 أقل من سعر بدون خسارة 28.85", plan[1].reason);
  assert("…and no line is «أقل من السعر المربح» any more (the rule of § 47 between «بدون خسارة» and the suggested price is gone)", !plan.some((l) => /السعر المربح/.test(l.reason)) && !srcOf("pricing-engine.ts").includes('"below_profit"'));
  const verdicts = plan.map((l) => PE.lineVerdict(l, null, 0));
  assert("…the verdict without a decision: banana «تلقائي» at 70, the three others «استثناء»", eq(verdicts.map((v) => [v.status, v.sale]), [["auto", 70], ["exception", 0], ["exception", 0], ["exception", 0]]), JSON.stringify(verdicts));
  // the uplift of § 53: every comparison on the price after it
  const up = PE.computePricing(items, offers, 5, V, F, 3);
  assert("with «زيادة على سعر السوق» 3 %: banana 70 → 72.50 ≥ the suggested 71.50 → rule 6, «بسعر السوق» 72.50", up[0].sale === 72.5 && eq([up[0].proposal.kind, up[0].proposal.price, up[0].proposal.why], ["market", 72.5, "above_suggested"]), JSON.stringify(up[0].proposal));
  assert("…medium 20 → 21 ≥ 20.40: no loss any more, the market price after the uplift (rule 5)", up[1].sale === 21 && eq([up[1].proposal.kind, up[1].proposal.price, up[1].proposal.auto], ["market", 21, true]), JSON.stringify(up[1].proposal));
  assert("…large 28 → 29 ≥ 28.85: the market price 29; small (no market) the suggested price, untouched", eq([up[3].proposal.kind, up[3].proposal.price], ["market", 29]) && eq([up[2].proposal.kind, up[2].proposal.price], ["profit", 19.5]));
  const upS = PE.computePricing(items, offers, 5, V, F, 3, "suggested");
  assert("…and with the setting «بالمقترح»: banana at the suggested 71.50 (the market after the uplift is above it), medium still at 21", eq([upS[0].proposal.kind, upS[0].proposal.price, upS[0].proposal.auto], ["profit", 71.5, true]) && upS[1].proposal.price === 21, JSON.stringify(upS[0].proposal));
  const vS = PE.lineVerdict(upS[0], null, 0);
  assert("…its verdict: «تلقائي» at 71.50, and the line says why it sells below the market", vS.status === "auto" && vS.sale === 71.5 && vS.reason === "السوق 72.50 أعلى من المقترح 71.50: يُنشر بالمقترح (الإعدادات)", JSON.stringify(vS));
  const out = PE.computePricing(items, [offer("purchase", 1, 55), offer("market", 1, 70, true)], 5, V, F);
  assert("an outlier market price: the proposal of the rule (the market 70), ⚠️, an exception — not published by itself", out[0].proposal.kind === "market" && out[0].proposal.outlier && !out[0].proposal.auto && out[0].exceptions.includes("outlier") && PE.lineVerdict(out[0], null, 0).status === "exception");
  assert("Baraa's decision still wins over the rule: «لا تنشر» on the banana, «اعتمد بالسعر المربح» on a loss", PE.lineVerdict(plan[0], "skip", 0).status === "unpublished" && eq([PE.lineVerdict(plan[1], "profit", 0).status, PE.lineVerdict(plan[1], "profit", 0).sale], ["manual", 23]));

  // ---- the publication's check of a stored line
  const stored = (o: Record<string, unknown>) => ({ x_status: "auto", x_market_price: 75, x_manual_price: 0, x_suggested_price: 71.5, x_uplift_pct: 0, x_sale_price: 75, ...o }) as any;
  assert("an automatic line at the market price passes the publication's check", PE.saleMatchesRule(stored({})));
  assert("…at the suggested price too, while the market reaches it (rule 6, «بالمقترح»)", PE.saleMatchesRule(stored({ x_sale_price: 71.5 })));
  assert("…but not at the suggested price when the market is below it, and never at any other number", !PE.saleMatchesRule(stored({ x_market_price: 70, x_sale_price: 71.5 })) && !PE.saleMatchesRule(stored({ x_sale_price: 73 })) && !PE.saleMatchesRule(stored({ x_sale_price: 0 })));
  assert("…and a line Baraa decided is checked by its own rule alone (no suggested price slipped in)", PE.saleMatchesRule(stored({ x_status: "manual", x_decision: "edit", x_manual_price: 60, x_sale_price: 60 })) && !PE.saleMatchesRule(stored({ x_status: "manual", x_decision: "market", x_manual_price: 0, x_sale_price: 71.5 })));
}

console.log("\n[أ] the stored day: the engine writes the rule on the lines, and the setting is read from «⚙️ الإعدادات»");
{
  const env = world(); prices();
  const s = await OC.readPricingSettings(env, DAY);
  assert("the setting empty on the record → «بسعر السوق»", s?.aboveSuggested === "market", JSON.stringify(s));
  await engine(env);
  const st = [1, 2, 3, 4].map((p) => [line(p).x_status, line(p).x_sale_price, line(p).x_break_even, line(p).x_suggested_price]);
  assert("the day of 10-05: banana «تلقائي» 70, medium / small / large «استثناء» — with the floors of the order's table",
    JSON.stringify(st) === JSON.stringify([["auto", 70, 68.7, 71.5], ["exception", 0, 20.4, 23], ["exception", 0, 16.78, 19.5], ["exception", 0, 28.85, 31.5]]), JSON.stringify(st));
  assert("…the loss lines say «سعر السوق 20 أقل من سعر بدون خسارة 20.40», the small one «لا سعر سوق»", line(2).x_reason === "سعر السوق 20 أقل من سعر بدون خسارة 20.40" && line(3).x_reason === "لا سعر سوق", JSON.stringify([line(2).x_reason, line(3).x_reason]));
  const rows4 = RV.reviewRows(await PR.readLines(env, dayOf().id), "market");
  assert("the review's rows, from the stored lines: the same four proposals as the engine", JSON.stringify(rows4.map((r) => [r.name, r.proposal.kind, r.proposal.price])) === JSON.stringify([["موز أمريكي", "market", 70], ["رمان وسط", "skip", 0], ["رمان صغير", "profit", 19.5], ["رمان كبير", "skip", 0]]), JSON.stringify(rows4.map((r) => r.proposal)));
}
{
  // market above the suggested price, by the two values of the setting
  const env = world(`${DAY} 04:00`); dp(1, 11, 55); market(1, 11, 75);
  await engine(env);
  assert("market 75 above the suggested 71.50, «بسعر السوق»: «تلقائي» at 75", line(1).x_status === "auto" && line(1).x_sale_price === 75 && !line(1).x_reason, JSON.stringify(line(1)));
  table("x_pricing_config").get(1)!.x_above_suggested = "suggested";
  const again = await quiet(() => PR.refreshPriceDay(env, {}));
  assert("the setting changed in «⚙️ الإعدادات» → the next run recomputes by itself (it is in the inputs' fingerprint)", again.action === "refreshed", JSON.stringify(again));
  assert("…«بالمقترح»: «تلقائي» at 71.50, the reason on the line, the market price kept beside it", line(1).x_status === "auto" && line(1).x_sale_price === 71.5 && line(1).x_market_price === 75 && line(1).x_reason === "السوق 75 أعلى من المقترح 71.50: يُنشر بالمقترح (الإعدادات)", JSON.stringify(line(1)));
  assert("…and the setting read: «suggested»", (await OC.readPricingSettings(env, DAY))?.aboveSuggested === "suggested");
  await review(env);
  assert("…the review proposes it by the same setting: «موز أمريكي: شراء 55 · سوق 75 · الفرق 20 (36%) ← انشر بالمقترح 71.50»", bodyOf(owner().at(-1)).includes("موز أمريكي: شراء 55 · سوق 75 · الفرق 20 (36%) ← انشر بالمقترح 71.50"), bodyOf(owner().at(-1)));
  setRiyadh(`${DAY} 06:00`);
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  assert("…at 06:00 it is published at 71.50 (the publication's check takes the suggested price of an automatic line)", dl.action === "auto_published" && dl.publish?.action === "published" && dayOf().x_state === "published" && line(1).x_sale_price === 71.5, JSON.stringify(dl));
  assert("…the customers' list carries 71.50", sentTo(C1_PHONE).some((b: any) => /موز أمريكي \(كرتون\): 71\.50 ر\.س/.test(bodyOf(b))), JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
}

// ================================================================ ب
console.log("\n[ب] ONE message with every item, from 04:00, with three buttons");
{
  const env = world(`${DAY} 03:55`); prices();
  await engine(env);
  const early = await review(env);
  assert("03:55 → nothing yet", early.action === "outside" && owner().length === 0, JSON.stringify(early));
  setRiyadh(`${DAY} 04:00`);
  const r = await review(env);
  assert("04:00 → the review is sent: version 1, three rows waiting", r.action === "sent" && r.ver === 1 && r.count === 3 && r.parts === 0, JSON.stringify(r));
  assert("ONE message to Baraa — interactive, with buttons — and nothing else (four items are not four messages)", owner().length === 1 && withButtons().length === 1, kinds());
  const body = bodyOf(owner()[0]);
  const L = body.split("\n");
  assert("its title: «📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026»", L[0] === "📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026", L[0]);
  assert("the banana's line, as the order writes it: «موز أمريكي: شراء 55 · سوق 70 · الفرق 15 (27%) ← انشر بسعر السوق 70»", L.includes("موز أمريكي: شراء 55 · سوق 70 · الفرق 15 (27%) ← انشر بسعر السوق 70"), body);
  assert("medium pomegranate: the difference 5 (33%), «لا تنشر (خسارة)»", L.includes("رمان وسط: شراء 15 · سوق 20 · الفرق 5 (33%) ← لا تنشر (خسارة)"), body);
  assert("small pomegranate, no market price: «سوق —», no difference, «انشر بالمقترح 19.50»", L.includes("رمان صغير: شراء 12 · سوق — ← انشر بالمقترح 19.50"), body);
  assert("large pomegranate: the difference 6 (27%), «لا تنشر (خسارة)»", L.includes("رمان كبير: شراء 22 · سوق 28 · الفرق 6 (27%) ← لا تنشر (خسارة)"), body);
  assert("the summary «2 للنشر · 2 لا تنشر · 0 ⚠️», and what happens with no decision (one item by itself)", L.includes("2 للنشر · 2 لا تنشر · 0 ⚠️") && /بلا قرارك حتى 06:00: يُنشر تلقائياً 1 /.test(body), body);
  assert("one category: no heading line", !body.includes("— فواكه —"), body);
  assert("the three buttons, in order: «✅ اعتمد الكل كما هو», «✏️ مراجعة», «⛔ لا تنشر اليوم»", JSON.stringify(buttonTitles(owner()[0])) === JSON.stringify(["✅ اعتمد الكل كما هو", "✏️ مراجعة", "⛔ لا تنشر اليوم"]), JSON.stringify(buttonTitles(owner()[0])));
  assert("…their ids carry the day and the version", JSON.stringify(buttonIds(owner()[0])) === JSON.stringify([`prv_a_${dayOf().id}_1`, `prv_r_${dayOf().id}_1`, `prv_n_${dayOf().id}_1`]), JSON.stringify(buttonIds(owner()[0])));
  assert("…each title within Meta's twenty characters (three buttons at most)", [RV.REVIEW_BUTTON_ALL, RV.REVIEW_BUTTON_FORM, RV.REVIEW_BUTTON_NONE, RV.REVIEW_BUTTON_EDIT].every((t) => t.length <= 20 && [...t].length <= 20) && buttonTitles(owner()[0]).length === 3);
  assert("nothing is held for him, and nothing went to anyone else", heldFor(env, OWNER).length === 0 && graph.every((b: any) => b.to === OWNER), JSON.stringify(graph.map((b: any) => b.to)));
  const again = await review(env);
  setRiyadh(`${DAY} 04:05`);
  const tick = await quiet(() => PR.runPricesTick(env));
  assert("the next ticks: nothing new (once)", again.action === "sent_before" && (tick.review as any)?.action === "sent_before" && owner().length === 1, JSON.stringify([again, tick.review]));
  assert("the tick calls it «review» (the message per exception is gone from it)", "review" in tick && !("exceptions" in tick));
  // a waiting row changes → the review again, as an update
  market(2, 21, 24);                                         // the source's newer price (its latest row counts): 24 ≥ the suggested 23
  setRiyadh(`${DAY} 05:10`);
  await quiet(() => PR.refreshPriceDay(env, {}));
  const upd = await review(env);
  assert("a new market price (medium: 24) changes a waiting row → the review again, version 2", upd.action === "sent" && upd.ver === 2 && owner().length === 2, JSON.stringify(upd));
  const b2 = bodyOf(owner()[1]);
  assert("…titled «🔄 تحديث مراجعة أسعار اليوم (05:10)», naming what changed, with the new line", b2.startsWith("🔄 تحديث مراجعة أسعار اليوم (05:10) — السبت 3 أكتوبر 2026") && b2.includes("تغيّر: رمان وسط.") && b2.includes("رمان وسط: شراء 15 · سوق 24 · الفرق 9 (60%) ← انشر بسعر السوق 24") && b2.includes("3 للنشر · 1 لا تنشر · 0 ⚠️"), b2);
  assert("…its buttons carry version 2", buttonIds(owner()[1])[0] === `prv_a_${dayOf().id}_2`);
  const before = lineWrites();
  const stale = await tap(env, `prv_a_${dayOf().id}_1`);
  assert("«اعتمد الكل» on the OLDER message decides nothing: one line says a newer version came (05:10)", stale === "stale" && lineWrites() === before && [1, 2, 3, 4].every((p) => !line(p).x_decision) && /نسخة أحدث من مراجعة أسعار اليوم \(05:10\)/.test(texts().at(-1) ?? ""), JSON.stringify([stale, texts().at(-1)]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

{
  // only a draft day is reviewed before 06:00; after it, only a review that never reached him
  const env = world(`${DAY} 04:30`); prices();
  await engine(env);
  dayOf().x_state = "published";                              // published early from Odoo («نشر المعتمد الآن»)
  const r = await review(env);
  assert("a day already published before 06:00: no review", r.action === "no_draft" && owner().length === 0, JSON.stringify(r));
  const env2 = world(); dp(3, 31, 12);
  await engine(env2); await review(env2);                     // delivered at 04:00
  setRiyadh(`${DAY} 06:00`); await quiet(() => PR.checkPricesDeadline(env2));
  const n = withButtons().length;
  market(3, 31, 25); setRiyadh(`${DAY} 06:30`);
  await quiet(() => PR.refreshPriceDay(env2, { force: true }));
  const late = await review(env2);
  assert("after 06:00 a review that DID reach him is not sent again, whatever changed (his buttons still publish)", dayOf().x_state === "missed" && late.action === "outside" && withButtons().length === n, JSON.stringify(late));
  // from the cron (AUTO_SEND_JOB set): an attempt that did not go is tried again at the next tick
  const cron = world(); prices(); cron.AUTO_SEND_JOB = "team_attendance";
  await engine(cron);
  const one = await review(cron);
  cron.MSG_DEDUP.store.delete(RV.snapshotKey(dayOf().id));     // as when Meta failed the first attempt: no snapshot kept,
  cron.MSG_DEDUP.store.delete(`btnlock:v1:prv_send:${dayOf().id}:1`);   // and the version's claim released
  const two = await review(cron);
  assert("the review is not under the cron's auto-send key: the same review goes again after a failed attempt", one.action === "sent" && two.action === "sent" && withButtons().length === 2, JSON.stringify([one, two]));
  const env3 = world(); prices();
  await engine(env3); await review(env3);
  closeOwnerWindow(env3);
  await tap(env3, `prv_n_${dayOf().id}_1`);
  assert("an answer of the review is never held either (his window closed again: it is simply not sent)", heldFor(env3, OWNER).length === 0 && line(1).x_decision === "skip");
}

console.log("\n[ب] the length of the message: 4, 20 and 40 items");
{
  const day = "2026-10-03", dl = "06:00";
  const mk = (n: number): any[] => Array.from({ length: n }, (_, i) => ({
    lineId: i + 1, productId: i + 1, name: `صنف طويل الاسم رقم ${i + 1}`, purchase: 55, market: 70, sale: 70, upliftPct: 0, breakEven: 68.7, suggested: 71.5,
    proposal: { kind: "market", price: 70, why: "below_suggested", outlier: false, auto: true }, decision: null, decidedPrice: 0,
  }));
  const groups = (n: number) => [{ title: "فواكه", rows: mk(n).slice(0, Math.ceil(n / 2)) }, { title: "خضار", rows: mk(n).slice(Math.ceil(n / 2)) }];
  const t4 = RV.buildReviewTexts(day, groups(4), dl);
  assert("4 items: the whole review above the buttons — no separate text", t4.texts.length === 0 && t4.body.length <= 1024 && mk(4).every((r) => t4.body.includes(`${r.name}: شراء`)), String(t4.body.length));
  assert("…two categories: a heading line each («— فواكه —», «— خضار —»), in the forms' order", t4.body.indexOf("— فواكه —") > 0 && t4.body.indexOf("— خضار —") > t4.body.indexOf("— فواكه —"), t4.body);
  const t20 = RV.buildReviewTexts(day, groups(20), dl);
  assert("20 items do not fit an interactive message's text (1024): the table goes first as plain text, whole", t20.texts.length === 1 && t20.texts[0].length <= PR.PRICE_TEXT_LIMIT && mk(20).every((r) => t20.texts.join("\n").split("\n").filter((l) => l.startsWith(`${r.name}: `)).length === 1), JSON.stringify(t20.texts.map((t) => t.length)));
  assert("…then the buttons under the summary «20 للنشر · 0 لا تنشر · 0 ⚠️» — no item line in it, within 1024", t20.body.length <= 1024 && t20.body.includes("20 للنشر · 0 لا تنشر · 0 ⚠️") && !t20.body.includes("شراء 55") && t20.body.includes("20 صنفاً في الجدول أعلاه."), t20.body);
  const t40 = RV.buildReviewTexts(day, groups(40), dl);
  assert("40 items: every line once, each part within a text message's room, the buttons' text within 1024", t40.texts.every((t) => t.length <= PR.PRICE_TEXT_LIMIT) && t40.body.length <= 1024
    && mk(40).every((r) => t40.texts.join("\n").split("\n").filter((l) => l.startsWith(`${r.name}: `)).length === 1) && t40.body.includes("40 للنشر · 0 لا تنشر · 0 ⚠️"), JSON.stringify(t40.texts.map((t) => t.length)));
  const tight = RV.buildReviewTexts(day, groups(40), dl, {}, 1024, 900);
  assert("a table longer than one text message is cut on line boundaries, «(1/4)» … and nothing is lost", tight.texts.length > 1 && tight.texts.every((t, i) => t.split("\n")[0].endsWith(`(${i + 1}/${tight.texts.length})`) && t.length <= 900)
    && mk(40).every((r) => tight.texts.join("\n").split("\n").filter((l) => l.startsWith(`${r.name}: `)).length === 1), JSON.stringify(tight.texts.map((t) => t.length)));
  const mixed = mk(3); mixed[1].proposal = { kind: "skip", price: 0, why: "loss", outlier: false, auto: false }; mixed[2].proposal = { kind: "profit", price: 19.5, why: "no_market", outlier: true, auto: false };
  assert("the counts: «2 للنشر · 1 لا تنشر · 1 ⚠️», one of them by itself", RV.countsLine(RV.reviewCounts(mixed)) === "2 للنشر · 1 لا تنشر · 1 ⚠️" && RV.reviewCounts(mixed).auto === 1, JSON.stringify(RV.reviewCounts(mixed)));
  assert("an outlier's line is marked: «⚠️ انشر بالمقترح 19.50 (سعر شاذ)»", RV.proposalText(mixed[2]) === "⚠️ انشر بالمقترح 19.50 (سعر شاذ)", RV.proposalText(mixed[2]));
  assert("no purchase price: «شراء —» and «لا تنشر (لا سعر شراء)»", RV.reviewLine({ ...mk(1)[0], name: "خس", purchase: 0, proposal: { kind: "skip", price: 0, why: "no_purchase", outlier: false, auto: false } }) === "خس: شراء — · سوق 70 ← لا تنشر (لا سعر شراء)");
  assert("with an uplift the decision names the price after it: «انشر بسعر السوق 72.50 (بعد الزيادة 3٪)»", RV.proposalText({ ...mk(1)[0], sale: 72.5, upliftPct: 3, proposal: { kind: "market", price: 72.5, why: "above_suggested", outlier: false, auto: true } }) === "انشر بسعر السوق 72.50 (بعد الزيادة 3٪)");
  assert("…and «الفرق» stays the market as observed minus the purchase (70 − 55), whatever the uplift", RV.reviewLine({ ...mk(1)[0], name: "موز", sale: 72.5, upliftPct: 3, proposal: { kind: "market", price: 72.5, why: "above_suggested", outlier: false, auto: true } }) === "موز: شراء 55 · سوق 70 · الفرق 15 (27%) ← انشر بسعر السوق 72.50 (بعد الزيادة 3٪)");
  assert("the form's choices: no «انشر بالمقترح» without a suggested price (no purchase price), no «انشر بسعر السوق» without a market price", JSON.stringify(RV.reviewOptions({ ...mk(1)[0], purchase: 0, breakEven: 0, suggested: 0 }).map((o) => o.id)) === JSON.stringify(["market", "skip", "manual"])
    && JSON.stringify(RV.reviewOptions({ ...mk(1)[0], market: 0, sale: 0 }).map((o) => o.id)) === JSON.stringify(["profit", "skip", "manual"]));
  assert("nothing by itself: «بلا قرارك حتى 06:00: لا يُنشر شيء.»", RV.autoLine({ publish: 1, skip: 0, warn: 0, auto: 0 }, dl) === "بلا قرارك حتى 06:00: لا يُنشر شيء.");
}
{
  // 20 real lines through the engine and the gateway
  const env = world(); prices(); more(8, 6, 100); more(8, false, 200);
  await engine(env);
  const r = await review(env);
  assert("20 items on the day: the table as ONE text, then ONE message with the buttons — two messages, not twenty", r.action === "sent" && r.parts === 1 && owner().length === 2 && owner()[0].type === "text" && withButtons().length === 1 && owner()[1] === withButtons()[0], kinds());
  const table20 = bodyOf(owner()[0]);
  assert("…by category: «— فواكه —» (the four), «— خضار —» (eight), «— أخرى —» (eight)", table20.indexOf("— فواكه —") < table20.indexOf("موز أمريكي: ") && table20.indexOf("— خضار —") < table20.indexOf("صنف 100: ") && table20.indexOf("— أخرى —") < table20.indexOf("صنف 200: ") && table20.indexOf("— خضار —") > table20.indexOf("رمان كبير: "), table20);
  assert("…the buttons' text: «18 للنشر · 2 لا تنشر · 0 ⚠️», seventeen by themselves", bodyOf(owner()[1]).includes("18 للنشر · 2 لا تنشر · 0 ⚠️") && /يُنشر تلقائياً 17 /.test(bodyOf(owner()[1])), bodyOf(owner()[1]));
}

console.log("\n[ب] his window closed at 04:00: nothing held, the template, and the review at his first message");
{
  const env = world(); prices(); T2(); closeOwnerWindow(env);
  await engine(env);
  const r = await review(env);
  assert("window closed → no review sent, and nothing held for him", r.action === "window_closed" && withButtons().length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify([r, kinds()]));
  assert("utak_owner_price_review_v1 went once, with the day and the three items waiting", r.review === "sent" && owner().length === 1 && tplName(owner()[0]) === OW.PRICE_REVIEW_TEMPLATE
    && JSON.stringify(((owner()[0].template.components ?? []).find((c: any) => c.type === "body")?.parameters ?? []).map((p: any) => p.text)) === JSON.stringify(["3 أكتوبر 2026", "3"]), JSON.stringify(owner()[0]));
  setRiyadh(`${DAY} 04:05`);
  const r2 = await review(env);
  assert("the next tick: still closed, no second template", r2.action === "window_closed" && owner().length === 1, JSON.stringify(r2));
  // he taps «عرض الاستثناءات»: the inbound opens his window, and the review is built now
  setRiyadh(`${DAY} 05:20`);
  await hook(env, OWNER, { type: "button", button: { payload: OW.PRICE_REVIEW_PAYLOAD, text: "عرض الاستثناءات" } });
  assert("his tap: the review itself arrives (built then), with its three buttons", withButtons().length === 1 && bodyOf(withButtons()[0]).startsWith("📋 مراجعة أسعار اليوم") && buttonIds(withButtons()[0])[0] === `prv_a_${dayOf().id}_1`, kinds());
  assert("…and no «لا مراجعة أسعار بانتظارك» line: the review was the answer", !texts().includes(OW.PRICE_REVIEW_NOTHING_TEXT) && owner().length === 2, kinds());
  await hook(env, OWNER, { type: "button", button: { payload: OW.PRICE_REVIEW_PAYLOAD, text: "عرض الاستثناءات" } });
  assert("a second tap, nothing owed: one line saying so, and no second review", texts().filter((t) => t === OW.PRICE_REVIEW_NOTHING_TEXT).length === 1 && withButtons().length === 1, kinds());
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // never seen until after 06:00 on a day that was not published: it still arrives, and says an approval publishes at once
  const env = world(); dp(3, 31, 12); closeOwnerWindow(env);                // one item, no market price: nothing publishes by itself
  await engine(env);
  const first = await review(env);                            // the template is not usable yet: nothing went, the review is owed
  setRiyadh(`${DAY} 06:00`);
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  T2(); setRiyadh(`${DAY} 06:05`);
  const after = await review(env);
  assert("the template «… بانتظار قرارك قبل 06:00» is never sent after 06:00 (usable only now, the review still owed)", first.review === "not_usable" && after.action === "window_closed" && !after.review && !owner().some((b: any) => tplName(b) === OW.PRICE_REVIEW_TEMPLATE), JSON.stringify([first, after]));
  setRiyadh(`${DAY} 06:40`);
  await hook(env, OWNER, { type: "text", text: { body: "صباح الخير" } });
  const late = withButtons().at(-1);
  assert("06:00 passed with nothing published («فات الموعد»), then his first message at 06:40: the review arrives", dl.action === "missed" && !!late && bodyOf(late).startsWith("📋 مراجعة أسعار اليوم"), JSON.stringify([dl.action, kinds()]));
  assert("…saying «فات موعد 06:00 ولم تُنشر أسعار اليوم: اعتمادك الآن ينشر فوراً.»", bodyOf(late).includes("فات موعد 06:00 ولم تُنشر أسعار اليوم: اعتمادك الآن ينشر فوراً."), bodyOf(late));
}

{
  // the same through the real ticks: at 06:00 the review's step runs BEFORE the deadline's, on a day still «مسودة»
  const env = world(); dp(3, 31, 12); closeOwnerWindow(env);
  await quiet(() => PR.runPricesTick(env));                   // 04:00: his window closed — the review is owed
  setRiyadh(`${DAY} 06:00`);
  const t6 = await quiet(() => PR.runPricesTick(env));
  assert("the 06:00 tick: the review's step finds the day still a draft and keeps the review owed; the deadline then marks «فات الموعد»", (t6.review as any)?.action === "outside" && (t6.deadline as any)?.action === "missed" && dayOf().x_state === "missed" && env.MSG_DEDUP.store.has(`prv_owed:v1:${DAY}`), JSON.stringify([t6.review, t6.deadline]));
  setRiyadh(`${DAY} 06:10`);
  await hook(env, OWNER, { type: "text", text: { body: "السلام عليكم" } });
  assert("…so his first message at 06:10 brings the review, saying an approval publishes at once", withButtons().length === 1 && bodyOf(withButtons()[0]).includes("اعتمادك الآن ينشر فوراً.") && !env.MSG_DEDUP.store.has(`prv_owed:v1:${DAY}`), kinds());
  // …and a day published at 06:00 owes nothing any more
  const env2 = world(); prices(); closeOwnerWindow(env2);
  await quiet(() => PR.runPricesTick(env2));
  setRiyadh(`${DAY} 06:00`); await quiet(() => PR.runPricesTick(env2));
  setRiyadh(`${DAY} 06:05`); await quiet(() => PR.runPricesTick(env2));
  assert("a day published at 06:00 (the banana by itself): the review owed is dropped at the next tick — nothing left to review", dayOf().x_state === "published" && !env2.MSG_DEDUP.store.has(`prv_owed:v1:${DAY}`) && withButtons().length === 0);
}

console.log("\n[ب] the message per exception and «عدّل» are gone");
{
  const env = world(); prices();
  await engine(env); await review(env);
  setRiyadh(`${DAY} 04:05`); await quiet(() => PR.runPricesTick(env));
  setRiyadh(`${DAY} 04:10`); await quiet(() => PR.runPricesTick(env));
  assert("three exceptions on the day, and still ONE message: none of «⚠️ استثناء في أسعار اليوم», no pexc_ button, no list of choices", owner().length === 1
    && !owner().some((b: any) => /استثناء في أسعار اليوم/.test(bodyOf(b)) || b?.interactive?.type === "list" || buttonIds(b).some((id) => id.startsWith("pexc_"))), kinds());
  const P = PR as any;
  assert("src/prices.ts no longer has the exception messages or «عدّل»", ["notifyPriceExceptions", "exceptionText", "exceptionChoices", "handlePriceExceptionButton", "handlePriceEditReply", "EDIT_REPLY_MIN", "EXCEPTIONS_MANY"].every((n) => P[n] === undefined)
    && !/أرسل سعر البيع|pexc_edit|pexc_e_/.test(srcOf("prices.ts") + srcOf("price-review.ts") + srcOf("index.ts")));
  // an old message of before § 54 may still sit in his chat
  const before = lineWrites();
  await hook(env, OWNER, button(`pexc_p_${line(3).id}`, "اعتمد بالسعر المربح"));
  assert("a tap on an OLD exception's choice decides nothing: one line says where decisions are taken now", lineWrites() === before && !line(3).x_decision && texts().at(-1) === PR.OLD_EXCEPTION_TEXT, JSON.stringify(texts().at(-1)));
  await hook(env, OWNER, button(`pexc_e_${line(3).id}`, "عدّل"));
  const n = owner().length;
  await hook(env, OWNER, { type: "text", text: { body: "21" } });
  assert("«عدّل» asks for no price, and a number typed by him is no price: nothing written, nothing answered", !texts().some((t) => /خلال 30 دقيقة/.test(t)) && owner().length === n && lineWrites() === before && !line(3).x_decision, JSON.stringify(texts().slice(-2)));
}

// ================================================================ ب2
console.log("\n[ب] «✅ اعتمد الكل كما هو»");
{
  const env = world(); prices();
  await engine(env); await review(env);
  const id = dayOf().id;
  setRiyadh(`${DAY} 04:20`);
  await hook(env, OWNER, button(`prv_a_${id}_1`, "✅ اعتمد الكل كما هو"));
  const d = [1, 2, 3, 4].map((p) => [line(p).x_decision, line(p).x_status, line(p).x_sale_price, line(p).x_manual_price || 0, line(p).x_manual_for || "", line(p).x_excluded]);
  assert("through the webhook: every row takes its proposed decision, in the line's own decision fields", JSON.stringify(d) === JSON.stringify([["market", "manual", 70, 70, "market", false], ["skip", "unpublished", 0, 0, "", true], ["profit", "manual", 19.5, 19.5, "profit", false], ["skip", "unpublished", 0, 0, "", true]]), JSON.stringify(d));
  assert("…with the time of the decision and the reason «📊 اليوم» shows", [1, 2, 3, 4].every((p) => !!line(p).x_decided_at) && line(1).x_reason === "براء: اعتمد بسعر السوق" && line(2).x_reason === "براء: لا تنشر" && line(3).x_reason === "براء: اعتمد بالسعر المربح", JSON.stringify([line(1).x_reason, line(3).x_reason]));
  const conf = bodyOf(owner().at(-1));
  assert("ONE confirmation: «سيُنشر 06:00:» with the items and their prices", owner().length === 2 && conf.split("\n")[0] === "✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026." && conf.includes("سيُنشر 06:00:") && conf.includes("• موز أمريكي — 70 ر.س (سعر السوق)") && conf.includes("• رمان صغير — 19.50 ر.س (المقترح)"), conf);
  assert("…and what will not be: «لا يُنشر: رمان وسط، رمان كبير.»", conf.includes("لا يُنشر: رمان وسط، رمان كبير."), conf);
  assert("…with «✏️ تعديل» under it (the form again)", JSON.stringify(buttonIds(owner().at(-1))) === JSON.stringify([`prv_r_${id}_0`]) && buttonTitles(owner().at(-1))[0] === "✏️ تعديل");
  assert("the day is still a draft: nothing published before 06:00", dayOf().x_state === "draft" && sentTo(C1_PHONE).length === 0);
  const w = lineWrites();
  const twice = await tap(env, `prv_a_${id}_1`);
  assert("a second tap: «سُجّل قرارك من هذه الرسالة مسبقاً ✅», nothing written again", twice === "duplicate" && lineWrites() === w && texts().at(-1) === "سُجّل قرارك من هذه الرسالة مسبقاً ✅", JSON.stringify([twice, texts().at(-1)]));
  // the engine keeps his prices
  market(1, 11, 60);                                          // the source's newer price: the market is 60 now, a loss
  await quiet(() => PR.refreshPriceDay(env, {}));
  assert("a market price that moves after his approval does not move what he approved (70)", line(1).x_status === "manual" && line(1).x_sale_price === 70 && line(1).x_market_price === 60, JSON.stringify(line(1)));
  const none = await review(env);
  assert("…and no new review: nothing waits for a decision", none.action === "decided" && withButtons().length === 2, JSON.stringify(none));
  setRiyadh(`${DAY} 06:00`);
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  const list = sentTo(C1_PHONE).map(bodyOf).join("\n");
  assert("06:00: published — the banana at 70 and the small pomegranate at 19.50, and not the two he left out", dl.action === "auto_published" && dayOf().x_state === "published" && /موز أمريكي \(كرتون\): 70 ر\.س/.test(list) && /رمان صغير \(كرتون\): 19\.50 ر\.س/.test(list) && !/رمان وسط|رمان كبير/.test(list), list);
  const late = await tap(env, `prv_n_${id}_1`);
  assert("after the publication no decision: «نُشرت أسعار 3 أكتوبر 2026، فلا قرار عليها الآن»", late === "refused" && /^نُشرت أسعار 3 أكتوبر 2026، فلا قرار عليها الآن/.test(texts().at(-1) ?? "") && line(1).x_decision === "market", JSON.stringify([late, texts().at(-1)]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a decision Baraa already took in Odoo stays; «اعتمد الكل» fills the rest
  const env = world(); prices();
  await engine(env);
  Object.assign(line(2), { x_decision: "profit" });           // «قرار براء» chosen in «📊 اليوم»
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  await review(env);
  assert("a line he decided in Odoo shows as «✅ قرارك: انشر بالمقترح 23» in the review", bodyOf(owner()[0]).includes("رمان وسط: شراء 15 · سوق 20 · الفرق 5 (33%) ← ✅ قرارك: انشر بالمقترح 23") && bodyOf(owner()[0]).includes("3 للنشر · 1 لا تنشر · 0 ⚠️"), bodyOf(owner()[0]));
  await tap(env, `prv_a_${dayOf().id}_1`);
  assert("«اعتمد الكل» leaves his own decision as it is and decides the three others", line(2).x_decision === "profit" && line(2).x_sale_price === 23 && line(1).x_decision === "market" && line(3).x_decision === "profit" && line(4).x_decision === "skip", JSON.stringify([1, 2, 3, 4].map((p) => line(p).x_decision)));
  const env2 = world(`${DAY} 04:00`); prices();
  await engine(env2); await review(env2);
  const yesterday = seed("x_price_day", { x_date: "2026-10-02", x_state: "missed", x_name: "أسعار اليوم 2026-10-02", x_utak_simulation: false });
  const w = lineWrites();
  const old = await tap(env2, `prv_a_${yesterday}_1`);
  assert("a button of ANOTHER day's review decides nothing and publishes nothing: «هذه مراجعة أسعار 2 أكتوبر 2026، لا أسعار اليوم»", old === "refused" && lineWrites() === w && /^هذه مراجعة أسعار 2 أكتوبر 2026، لا أسعار اليوم/.test(texts().at(-1) ?? "") && table("x_price_day").get(yesterday)!.x_state === "missed", JSON.stringify([old, texts().at(-1)]));
  assert("a payload that is not the review's is not handled", (await tap(env2, "prv_x_1_1")) === "" && (await tap(env2, `pexc_m_${line(1).id}`)) === "" && RV.REVIEW_PAYLOAD.test(`prv_a_${dayOf().id}_1`) && RV.REVIEW_PAYLOAD.test("prvt_r_5_1"));
}

{
  // an item that left the active catalog after the review was sent takes no decision
  const env = world(); prices();
  await engine(env); await review(env);
  table("product.template").get(1)!.x_is_active_for_sale = false;
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const left3 = RV.reviewRows(await PR.readLines(env, dayOf().id), "market");
  assert("an item that left the active catalog is no row of the review", left3.length === 3 && !left3.some((r) => r.name === "موز أمريكي"), JSON.stringify(left3.map((r) => r.name)));
  await tap(env, `prv_a_${dayOf().id}_1`);
  assert("the banana left the catalog after 04:00: «اعتمد الكل» does not decide it (it would be published)", line(1).x_reason === PR.OUT_OF_CATALOG_REASON && !line(1).x_decision && line(1).x_status === "unpublished" && line(3).x_decision === "profit", JSON.stringify(line(1)));
  // a day being published takes no decision
  const env2 = world(); prices();
  await engine(env2); await review(env2);
  dayOf().x_state = "approved";
  const w = lineWrites();
  const r = await tap(env2, `prv_a_${dayOf().id}_1`);
  assert("a day already approved (its publication under way): no decision — «معتمدة ويجري نشرها الآن»", r === "refused" && lineWrites() === w && /معتمدة ويجري نشرها الآن، فلا قرار عليها/.test(texts().at(-1) ?? ""), JSON.stringify([r, texts().at(-1)]));
  // 06:01, the deadline's tick has not closed the day yet: an approval is already «after the time»
  const env3 = world(); dp(3, 31, 12);
  await engine(env3); await review(env3);
  setRiyadh(`${DAY} 06:01`);
  await tap(env3, `prv_a_${dayOf().id}_1`);
  assert("06:01 on a day still «مسودة»: «اعتمد الكل» publishes at once (the time has passed)", dayOf().x_state === "published" && /رمان صغير \(كرتون\): 19\.50/.test(sentTo(C1_PHONE).map(bodyOf).join("\n")) && (texts().at(-1) ?? "").includes("نُشر الآن (بعد موعد 06:00"), JSON.stringify([dayOf().x_state, texts().at(-1)]));
}

console.log("\n[ب] «⛔ لا تنشر اليوم»");
{
  const env = world(); prices();
  await engine(env); await review(env);
  const id = dayOf().id;
  const r = await tap(env, `prv_n_${id}_1`);
  assert("«لا تنشر» on every row — the banana too, which would have gone out by itself", r === "none:4" && [1, 2, 3, 4].every((p) => line(p).x_decision === "skip" && line(p).x_status === "unpublished" && line(p).x_sale_price === 0 && line(p).x_excluded === true), JSON.stringify([r, [1, 2, 3, 4].map((p) => line(p).x_decision)]));
  const said = bodyOf(owner().at(-1));
  assert("one line: «⛔ لن تُنشر أسعار اليوم (4 أصناف)…», how to undo before 06:00, and «✏️ تعديل»", said.startsWith("⛔ لن تُنشر أسعار اليوم (4 أصناف): سُجّل «لا تنشر» عليها كلها.") && RV.itemsWord(1) === "صنف" && RV.itemsWord(2) === "صنفاً" && RV.itemsWord(10) === "أصناف" && RV.itemsWord(11) === "صنفاً" && said.includes("للتراجع قبل 06:00: «✏️ تعديل».") && buttonIds(owner().at(-1))[0] === `prv_r_${id}_0`, said);
  setRiyadh(`${DAY} 06:00`);
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  assert("06:00: nothing published, no customer message, the day «فات الموعد»", dl.action === "missed" && dayOf().x_state === "missed" && sentTo(C1_PHONE).length === 0, JSON.stringify(dl));
  assert("…and Baraa is told it was his decision — no alarm, no list: «⛔ أسعار اليوم (3 أكتوبر 2026) لم تُنشر بقرارك («لا تنشر»). لا تُعاد أسعار أمس.»", texts().at(-1) === "⛔ أسعار اليوم (3 أكتوبر 2026) لم تُنشر بقرارك («لا تنشر»). لا تُعاد أسعار أمس.", texts().at(-1));
}

// ================================================================ ج
console.log("\n[ج] utak_owner_review_v1: the Flow at Meta against what the worker sends");
{
  const j = LIB.buildReviewFlowJson();
  const first = j.screens[0];
  assert("Flow JSON 6.0, four pages REVIEW_A … REVIEW_D of fifteen items, no endpoint (no data_exchange, no data_api_version)", j.version === "6.0" && JSON.stringify(j.screens.map((s: any) => s.id)) === JSON.stringify(["REVIEW_A", "REVIEW_B", "REVIEW_C", "REVIEW_D"]) && !JSON.stringify(j).includes("data_exchange") && !("data_api_version" in j));
  assert("the worker's constants are the Flow's: the first screen, the pages, the slots", RV.REVIEW_FLOW_SCREEN === LIB.REVIEW_FIRST_SCREEN && RV.REVIEW_FLOW_PAGES === LIB.REVIEW_PAGES.length && RV.REVIEW_FLOW_PAGE_SLOTS === LIB.REVIEW_PAGE_SLOTS && RV.REVIEW_FLOW_SLOTS === LIB.REVIEW_SLOTS && RV.REVIEW_FLOW_CTA === LIB.REVIEW_CTA);
  assert("every screen within Meta's fifty components (a heading, three for each item, the footers)", j.screens.every((s: any) => LIB.screenComponents(s).length <= LIB.SCREEN_COMPONENTS_MAX) && LIB.screenComponents(first).length === 49, JSON.stringify(j.screens.map((s: any) => LIB.screenComponents(s).length)));
  const slot1 = first.layout.children.slice(1, 4);
  assert("an item is three components: its numbers (text), its decision (a list opened on «s»), «السعر اليدوي» (a number)", JSON.stringify(slot1.map((c: any) => c.type)) === JSON.stringify(["TextCaption", "Dropdown", "TextInput"])
    && slot1[0].text === "${data.x1}" && slot1[1].name === "d1" && slot1[1]["data-source"] === "${data.o1}" && slot1[1]["init-value"] === "${data.s1}" && slot1[1].label === "${data.l1}"
    && slot1[2].name === "p1" && slot1[2]["input-type"] === "number" && slot1[2].required === false && slot1[2]["init-value"] === "${data.i1}" && slot1.every((c: any) => c.visible === "${data.v1}"), JSON.stringify(slot1));
  assert("the list must be answered while it is shown (no empty choice), and only then", slot1[1].required === "${data.v1}");
  assert("the later pages read the first page's data, and «اعتمد» carries d and p of every page up to its own", j.screens[1].layout.children[1].text === "${screen.REVIEW_A.data.x16}"
    && JSON.stringify(Object.keys(LIB.screenComponents(j.screens[1]).find((c: any) => c.type === "Footer" && c["on-click-action"].name === "complete")["on-click-action"].payload)) === JSON.stringify(Array.from({ length: 30 }, (_, i) => [`d${i + 1}`, `p${i + 1}`]).flat()));
  assert("the last button is «اعتمد», the others «التالي» or «اعتمد» by m<k>", LIB.REVIEW_SUBMIT_LABEL === "اعتمد" && first.layout.children.at(-1).type === "If" && first.layout.children.at(-1).condition === "${data.m1}" && j.screens[3].layout.children.at(-1).label === "اعتمد");
  // what the worker sends, against the model
  const rowsOf = (n: number): any[] => Array.from({ length: n }, (_, i) => ({ lineId: 500 + i, productId: 900 + i, name: `صنف ${i + 1}`, purchase: 10, market: 14, sale: 14, upliftPct: 0, breakEven: 13.6, suggested: 16, proposal: { kind: "market", price: 14, why: "below_suggested", outlier: false, auto: true }, decision: null, decidedPrice: 0 }));
  const built = RV.reviewFormItems([{ title: "فواكه", rows: rowsOf(4) }]);
  const data = RV.reviewFormData(built.pages, built.items);
  assert("the data the worker sends has exactly the keys of the Flow's first page (367), each of its type", JSON.stringify(Object.keys(data).sort()) === JSON.stringify(Object.keys(first.data).sort()) && Object.keys(data).length === 367
    && Object.entries(first.data).every(([k, m]: [string, any]) => (m.type === "array" ? Array.isArray(data[k]) : typeof data[k] === m.type)), String(Object.keys(data).length));
  assert("four items on one page: «اعتمد» on it (m1 false), the other slots hidden with one harmless option", data.t1 === "فواكه" && data.m1 === false && data.v4 === true && data.v5 === false && JSON.stringify(data.o5) === JSON.stringify([{ id: "skip", title: "-" }]) && data.s5 === "skip" && data.l5 === "-");
  const g16 = RV.reviewFormItems([{ title: "فواكه", rows: rowsOf(16) }, { title: "خضار", rows: rowsOf(3) }]);
  assert("a category of sixteen continues on the next page («فواكه (2)»), then the next category: nothing is dropped", JSON.stringify(g16.pages) === JSON.stringify(["فواكه", "فواكه (2)", "خضار"]) && g16.items.length === 19 && g16.items[15].slot === 16 && g16.items[16].slot === 31 && g16.left.length === 0, JSON.stringify(g16.pages));
  const d16 = RV.reviewFormData(g16.pages, g16.items);
  assert("…«التالي» after pages one and two, «اعتمد» on the third", d16.m1 === true && d16.m2 === true && d16.m3 === false && d16.t3 === "خضار" && d16.t4 === "-");
  const g70 = RV.reviewFormItems([{ title: "أخرى", rows: rowsOf(70) }]);
  assert("more than sixty items: the first sixty in the form, the ten others named (they keep the proposed decision)", g70.items.length === 60 && g70.left.length === 10 && g70.left[0] === "صنف 61" && RV.reviewFormText("2026-10-03", 60, g70.left).includes("خارج النموذج (يتسع لـ 60): صنف 61،"));
  assert("the labels and titles within Meta's limits (20 for a list's label, 30 for an option)", built.items.every((i: any) => [...i.label].length <= 20 && i.options.every((o: any) => [...o.title].length <= 30))
    && [...RV.reviewFormItems([{ title: "x", rows: [{ ...rowsOf(1)[0], name: "رمان يمني فاخر درجة أولى كبير جداً" }] }]).items[0].label].length === 20);
  assert("the option ids are the Flow's four, and the decisions' own words", JSON.stringify(LIB.REVIEW_OPTION_IDS) === JSON.stringify(["profit", "market", "skip", "manual"]));
}

console.log("\n[ج] «✏️ مراجعة»: the form opens on the proposed decisions");
{
  const env = world(); prices();
  await engine(env); await review(env);
  const id = dayOf().id;
  const r = await tap(env, `prv_r_${id}_1`);
  assert("«✏️ مراجعة» → one Flow message to Baraa (utak_owner_review_v1, navigate to REVIEW_A, all the data with it)", r === "form" && flows().length === 1 && par(flows()[0]).flow_id === RV.REVIEW_FLOW_ID && par(flows()[0]).flow_action === "navigate" && par(flows()[0]).flow_action_payload.screen === "REVIEW_A" && par(flows()[0]).flow_cta === "راجع الأسعار", JSON.stringify(par(flows()[0])).slice(0, 200));
  const d = dataOf(flows()[0]);
  assert("the page «فواكه», four items, «اعتمد» on it", d.t1 === "فواكه" && d.m1 === false && [1, 2, 3, 4].every((n) => d[`v${n}`] === true) && d.v5 === false && JSON.stringify([1, 2, 3, 4].map((n) => d[`l${n}`])) === JSON.stringify(["موز أمريكي", "رمان وسط", "رمان صغير", "رمان كبير"]));
  assert("the banana's line: «شراء 55 · سوق 70 · الفرق 15 · بدون خسارة 68.70 · مقترح 71.50»", d.x1 === "شراء 55 · سوق 70 · الفرق 15 · بدون خسارة 68.70 · مقترح 71.50", d.x1);
  assert("…and the small pomegranate's, without a market price: «شراء 12 · سوق — · الفرق — · بدون خسارة 16.78 · مقترح 19.50»", d.x3 === "شراء 12 · سوق — · الفرق — · بدون خسارة 16.78 · مقترح 19.50", d.x3);
  assert("the banana's choices: «انشر بالمقترح (71.50)», «انشر بسعر السوق (70)», «لا تنشر», «سعر يدوي»", JSON.stringify(d.o1) === JSON.stringify([{ id: "profit", title: "انشر بالمقترح (71.50)" }, { id: "market", title: "انشر بسعر السوق (70)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]), JSON.stringify(d.o1));
  assert("«انشر بسعر السوق» is offered only with a market price: not for the small pomegranate", JSON.stringify(d.o3.map((o: any) => o.id)) === JSON.stringify(["profit", "skip", "manual"]), JSON.stringify(d.o3));
  assert("each list opens on the proposed decision: the market, «لا تنشر», the suggested, «لا تنشر»", JSON.stringify([1, 2, 3, 4].map((n) => d[`s${n}`])) === JSON.stringify(["market", "skip", "profit", "skip"]) && [1, 2, 3, 4].every((n) => d[`i${n}`] === ""), JSON.stringify([1, 2, 3, 4].map((n) => d[`s${n}`])));
  const token = tokenOf(flows()[0]);
  assert("the token is the review's («pr1.20261003.…»), kept in KV with the day and the items", RV.isReviewFormToken(token) && token.startsWith("pr1.20261003.") && (await RV.readReviewFormToken(env, token))?.dayId === id && (await RV.readReviewFormToken(env, token))?.items.length === 4);
  // «اعتمد» with nothing changed = the proposed decisions; a list left untouched may come back without a value
  setRiyadh(`${DAY} 04:30`);
  await hook(env, OWNER, nfm(token, { d1: "market", d2: "skip", p1: "", p2: "" }));
  const dec = [1, 2, 3, 4].map((p) => [line(p).x_decision, line(p).x_sale_price]);
  assert("«اعتمد» with nothing changed (through the webhook): the four proposed decisions — a list that came back without a value keeps the one it opened on", JSON.stringify(dec) === JSON.stringify([["market", 70], ["skip", 0], ["profit", 19.5], ["skip", 0]]), JSON.stringify(dec));
  const conf = bodyOf(owner().at(-1));
  assert("the confirmation: «سيُنشر 06:00:» the banana 70 and the small pomegranate 19.50, «لا يُنشر: رمان وسط، رمان كبير.», and «✏️ تعديل»", conf.includes("سيُنشر 06:00:") && conf.includes("• موز أمريكي — 70 ر.س (سعر السوق)") && conf.includes("• رمان صغير — 19.50 ر.س (المقترح)") && conf.includes("لا يُنشر: رمان وسط، رمان كبير.") && buttonIds(owner().at(-1))[0] === `prv_r_${id}_0`, conf);
  const w = lineWrites();
  const again = await formReply(env, token, { d1: "skip", d2: "skip", d3: "skip", d4: "skip" });
  assert("the same form sent again: «هذا النموذج سبق اعتماده ✅», nothing written", again.action === "duplicate" && lineWrites() === w && line(1).x_decision === "market" && texts().at(-1) === RV.REVIEW_FORM_USED_TEXT, JSON.stringify(again));
  // «✏️ تعديل»: the form again, opened on what he decided
  await tap(env, `prv_r_${id}_0`);
  const d2 = dataOf(flows().at(-1));
  assert("«✏️ تعديل» → the form again, each list on HIS decision now", flows().length === 2 && JSON.stringify([1, 2, 3, 4].map((n) => d2[`s${n}`])) === JSON.stringify(["market", "skip", "profit", "skip"]) && tokenOf(flows().at(-1)) !== token);
  // a manual price, a manual price below «بدون خسارة», «سعر يدوي» without a price, a change of mind
  const t2 = tokenOf(flows().at(-1));
  const res = await formReply(env, t2, { d1: "profit", p1: "99", d2: "manual", p2: "19", d3: "manual", p3: "", d4: "manual", p4: "٣٠٫٥" });
  assert("the banana moved to «انشر بالمقترح»: 71.50 — and «السعر اليدوي» typed beside it is NOT read (it is read with «سعر يدوي» alone)", line(1).x_decision === "profit" && line(1).x_sale_price === 71.5 && line(1).x_manual_for === "profit", JSON.stringify(line(1)));
  assert("«سعر يدوي» 19 on the medium pomegranate — below «بدون خسارة» 20.40 — is taken", line(2).x_decision === "edit" && line(2).x_sale_price === 19 && line(2).x_manual_price === 19 && line(2).x_manual_for === "edit" && line(2).x_status === "manual" && line(2).x_reason === "براء: سعر معدّل", JSON.stringify(line(2)));
  assert("«سعر يدوي» ٣٠٫٥ (Arabic digits) on the large one: 30.50", line(4).x_decision === "edit" && line(4).x_sale_price === 30.5, JSON.stringify(line(4)));
  assert("«سعر يدوي» without a price: nothing written for it — the small pomegranate stays as he had it (the suggested 19.50)", res.action === "decided" && res.written === 3 && line(3).x_decision === "profit" && line(3).x_sale_price === 19.5, JSON.stringify([res, line(3)]));
  const c2 = bodyOf(owner().at(-1));
  assert("the confirmation lists the four prices: 71.50 (المقترح), 19 and 30.50 (سعر يدوي), 19.50", c2.includes("• موز أمريكي — 71.50 ر.س (المقترح)") && c2.includes("• رمان وسط — 19 ر.س (سعر يدوي)") && c2.includes("• رمان كبير — 30.50 ر.س (سعر يدوي)") && c2.includes("• رمان صغير — 19.50 ر.س (المقترح)") && !c2.includes("لا يُنشر:"), c2);
  assert("…with the ⚠️ line of the manual price below «بدون خسارة» — and none for 30.50, which is above 28.85", c2.includes("⚠️ رمان وسط: السعر اليدوي 19 أقل من سعر بدون خسارة 20.40.") && !/⚠️ رمان كبير/.test(c2), c2);
  assert("…and the ⚠️ line of what was not counted: «اخترت «سعر يدوي» بلا سعر أكبر من صفر»: رمان صغير", /⚠️ ما انحسب \(اخترت «سعر يدوي» بلا سعر أكبر من صفر\): رمان صغير — بقي على حاله\./.test(c2), c2);
  // «✏️ تعديل» once more: the lists on HIS decisions, the manual prices in their fields; «اعتمد» with nothing changed writes nothing
  await tap(env, `prv_r_${id}_0`);
  const d3 = dataOf(flows().at(-1)), t3 = tokenOf(flows().at(-1));
  assert("«✏️ تعديل» after his changes: each list on his decision («سعر يدوي» where he typed one), «السعر اليدوي» filled with 19 and 30.50", JSON.stringify([1, 2, 3, 4].map((n) => d3[`s${n}`])) === JSON.stringify(["profit", "manual", "profit", "manual"]) && JSON.stringify([1, 2, 3, 4].map((n) => d3[`i${n}`])) === JSON.stringify(["", "19", "", "30.50"]), JSON.stringify([1, 2, 3, 4].map((n) => [d3[`s${n}`], d3[`i${n}`]])));
  const w3 = lineWrites();
  const same = await formReply(env, t3, { d1: "profit", d2: "manual", p2: "19", d3: "profit", d4: "manual", p4: "30.50" });
  assert("…«اعتمد» with nothing changed: no line written again, and the confirmation still comes", same.action === "decided" && same.written === 0 && lineWrites() === w3 && bodyOf(owner().at(-1)).includes("سيُنشر 06:00:"), JSON.stringify(same));
  await tap(env, `prv_r_${id}_0`);
  const t4 = tokenOf(flows().at(-1));
  setRiyadh(`${DAY} 06:00`);
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  const list = sentTo(C1_PHONE).map(bodyOf).join("\n");
  const w4 = lineWrites();
  const afterPub = await formReply(env, t4, { d1: "skip", d2: "skip", d3: "skip", d4: "skip" });
  assert("a form opened before 06:00 and sent after the publication: nothing written — «نُشرت أسعار …، فلا قرار عليها الآن»", afterPub.action === "refused" && lineWrites() === w4 && line(1).x_decision === "profit" && /^نُشرت أسعار 3 أكتوبر 2026، فلا قرار عليها الآن/.test(texts().at(-1) ?? ""), JSON.stringify(afterPub));
  assert("06:00: the four published at his prices (71.50, 19, 19.50, 30.50)", dl.publish?.action === "published" && /موز أمريكي \(كرتون\): 71\.50/.test(list) && /رمان وسط \(جرم\): 19 ر/.test(list) && /رمان صغير \(كرتون\): 19\.50/.test(list) && /رمان كبير \(جرم\): 30\.50/.test(list), list);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // the reply is read from the token alone
  const env = world(); prices();
  await engine(env); await review(env);
  await tap(env, `prv_r_${dayOf().id}_1`);
  const token = tokenOf(flows()[0]);
  const rec = (await RV.readReviewFormToken(env, token))!;
  const v = RV.readReviewValues(rec, { d1: "manual", p1: "60", d2: "market", d3: "market", d4: "bogus", p4: "5", d9: "profit", lineId: 999 });
  assert("an option the item was not offered («market» for the small pomegranate), or one that does not exist, is not taken: the option the list opened on", JSON.stringify(v.decisions.map((x) => [x.item.slot, x.kind, x.price])) === JSON.stringify([[1, "edit", 60], [2, "market", 20], [3, "profit", 19.5], [4, "skip", 0]]), JSON.stringify(v.decisions.map((x) => [x.item.slot, x.kind, x.price])));
  assert("…the prices of «انشر بالمقترح» / «انشر بسعر السوق» are the token's — what the form showed — and a slot that is not in the form is ignored", v.decisions.length === 4 && v.decisions.every((x) => rec.items.some((i) => i.lineId === x.lineId)));
  assert("«سعر يدوي» with 0, a negative number or text: no price", RV.readReviewValues(rec, { d1: "manual", p1: "0", d2: "manual", p2: "-4", d3: "manual", p3: "عشرين" }).noPrice.length === 3);
  const w = lineWrites();
  openWindow(env, C1_PHONE);
  const other = await formReply(env, token, { d1: "skip" }, undefined, C1_PHONE);
  assert("a reply from ANOTHER number with Baraa's token: nothing read, nothing written, and that number is told nothing", other.action === "unknown" && lineWrites() === w && sentTo(C1_PHONE).length === 0, JSON.stringify(other));
  const bad = await formReply(env, "pr1.20261003.deadbeef", { d1: "skip" });
  assert("an unknown token from Baraa: «هذا النموذج غير صالح الآن…», nothing written", bad.action === "unknown" && lineWrites() === w && texts().at(-1) === RV.REVIEW_FORM_UNKNOWN_TEXT);
  assert("the three kinds of form are told apart by their tokens (pr1. / of1. / the price form)", RV.isReviewFormToken("pr1.x") && !RV.isReviewFormToken("of1.20261003.5.x") && !RV.isReviewFormToken("pf1.x") && !RV.isReviewFormToken(""));
}

console.log("\n[ج] after 06:00: an approval publishes at once, by the path of «نشر المعتمد الآن»");
{
  const env = world(); dp(2, 21, 15); market(2, 21, 20); dp(3, 31, 12);    // a loss and a line without a market price: nothing by itself
  await engine(env); await review(env);
  const id = dayOf().id;
  setRiyadh(`${DAY} 06:00`);
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  const alert = texts().at(-1) ?? "";
  assert("06:00 with no decision: nothing published, «فات الموعد», and the alert names each item and why", dl.action === "missed" && dayOf().x_state === "missed" && sentTo(C1_PHONE).length === 0
    && alert.includes("لم يُنشر (4):") && alert.includes("رمان وسط (خسارة: السوق 20 أقل من 20.40، وبلا قرار)") && alert.includes("رمان صغير (بلا سعر سوق وبلا قرار)") && alert.includes("موز أمريكي (لا سعر شراء)"), alert);
  assert("…and how to publish now: the review's buttons, or «نشر المعتمد الآن»", alert.includes("«✅ اعتمد الكل» أو «✏️ مراجعة» من رسالة المراجعة ينشر فوراً") && alert.includes("«نشر المعتمد الآن»") && alert.includes("لا تُعاد أسعار أمس."), alert);
  setRiyadh(`${DAY} 06:30`);
  await tap(env, `prv_r_${id}_1`);
  const token = tokenOf(flows().at(-1));
  const r = await formReply(env, token, { d1: "skip", d2: "manual", p2: "21", d3: "profit", d4: "skip" });
  assert("06:30, «اعتمد» in the form: the decisions written, the day approved and published at once", r.action === "late" && dayOf().x_state === "published" && !!dayOf().x_published_at && line(2).x_sale_price === 21 && line(3).x_sale_price === 19.5, JSON.stringify([r, dayOf().x_state]));
  const list = sentTo(C1_PHONE).map(bodyOf).join("\n");
  assert("…the customers get the list now: the medium pomegranate at 21, the small one at 19.50", /رمان وسط \(جرم\): 21 ر\.س/.test(list) && /رمان صغير \(كرتون\): 19\.50 ر\.س/.test(list), list);
  const conf = texts().at(-1) ?? "";
  assert("…and the confirmation says so: «نُشر الآن (بعد موعد 06:00، بمسار «نشر المعتمد الآن»):» with the two prices", conf.includes("نُشر الآن (بعد موعد 06:00، بمسار «نشر المعتمد الآن»):") && conf.includes("• رمان وسط — 21 ر.س (سعر يدوي)") && conf.includes("• رمان صغير — 19.50 ر.س (المقترح)") && !conf.includes("سيُنشر"), conf);
  assert("…without «✏️ تعديل» (a published day takes no decision)", !buttonIds(owner().at(-1)).length);
  assert("the record's report names the late approval from WhatsApp", /اعتماد براء من واتساب بعد الموعد/.test(String(dayOf().x_publish_report)), String(dayOf().x_publish_report));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // «اعتمد الكل» after 06:00, and a late approval with nothing to publish
  const env = world(); dp(3, 31, 12);
  await engine(env); await review(env);
  setRiyadh(`${DAY} 06:00`); await quiet(() => PR.checkPricesDeadline(env));
  setRiyadh(`${DAY} 07:30`);
  const r = await tap(env, `prv_a_${dayOf().id}_1`);
  assert("«اعتمد الكل» at 07:30 on a day that was not published: the small pomegranate published at once at 19.50", r === "all:4" && dayOf().x_state === "published" && /رمان صغير \(كرتون\): 19\.50/.test(sentTo(C1_PHONE).map(bodyOf).join("\n")) && (texts().at(-1) ?? "").includes("نُشر الآن (بعد موعد 06:00"), JSON.stringify([r, texts().at(-1)]));
  const env2 = world(); dp(2, 21, 15); market(2, 21, 20);
  await engine(env2); await review(env2);
  setRiyadh(`${DAY} 06:00`); await quiet(() => PR.checkPricesDeadline(env2));
  setRiyadh(`${DAY} 06:20`);
  const states = dayWrites();
  await tap(env2, `prv_a_${dayOf().id}_1`);                    // every proposal is «لا تنشر»
  assert("a late «اعتمد الكل» with nothing to publish: no approval, no customer message — «فات موعد 06:00، ولا صنف للنشر: لم يُنشر شيء.»", dayOf().x_state === "missed" && dayWrites() === states && sentTo(C1_PHONE).length === 0 && bodyOf(owner().at(-1)).includes("فات موعد 06:00، ولا صنف للنشر: لم يُنشر شيء."), bodyOf(owner().at(-1)));
}

// ================================================================ د
console.log("\n[د] no decision until 06:00");
{
  const env = world(); prices();
  dp(5, 51, 30); market(5, 51, 45);                           // an item priced well, but its market price an outlier
  seed("product.template", { id: 5, name: "تفاح", sale_ok: true, x_is_active_for_sale: true, categ_id: 5 });
  seed("x_product_packaging", { id: 51, x_name: "كرتون", x_product_tmpl_id: 5, x_is_default: true });
  (rows("x_price_offer").find((o: any) => o.x_product_tmpl_id === 5) as any).x_market_outlier = true;
  await engine(env); await review(env);
  assert("the review marks the outlier ⚠️: «تفاح: … ← ⚠️ انشر بسعر السوق 45 (سعر شاذ)», «3 للنشر · 2 لا تنشر · 1 ⚠️», one by itself", bodyOf(owner()[0]).includes("تفاح: شراء 30 · سوق 45 · الفرق 15 (50%) ← ⚠️ انشر بسعر السوق 45 (سعر شاذ)") && bodyOf(owner()[0]).includes("3 للنشر · 2 لا تنشر · 1 ⚠️") && /يُنشر تلقائياً 1 /.test(bodyOf(owner()[0])), bodyOf(owner()[0]));
  setRiyadh(`${DAY} 06:00`);
  const n = owner().length;
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  const list = sentTo(C1_PHONE).map(bodyOf).join("\n");
  assert("06:00, no decision: published by itself — the banana alone, at the market price 70 (rule 5)", dl.action === "auto_published" && dl.publish?.items === 1 && /موز أمريكي \(كرتون\): 70 ر\.س/.test(list), JSON.stringify(dl.publish));
  assert("…not published: no market price (small), a loss (medium, large), the outlier (apple)", !/رمان|تفاح/.test(list) && [2, 3, 4, 5].every((p) => line(p).x_status === "unpublished" && line(p).x_sale_price === 0), JSON.stringify([2, 3, 4, 5].map((p) => line(p).x_status)));
  const mine = owner().slice(n).map(bodyOf);
  assert("ONE message to Baraa at 06:00: what was published (his copy of the list)…", mine.length === 1 && mine[0].startsWith("📢 نُشرت أسعار السبت 3 أكتوبر 2026. الأصناف: 1، والعملاء: 2.") && /موز أمريكي \(كرتون\): 70 ر\.س/.test(mine[0]), JSON.stringify(mine));
  assert("…and what was not, each with its reason", mine[0].includes("لم يُنشر (4): رمان وسط (خسارة: السوق 20 أقل من 20.40، وبلا قرار)، رمان صغير (بلا سعر سوق وبلا قرار)، رمان كبير (خسارة: السوق 28 أقل من 28.85، وبلا قرار)، تفاح (سعر شاذ وبلا قرار)."), mine[0]);
  assert("…no second line «⏰ لم يُنشر اليوم N…» (it is in the one message)", !owner().some((b: any) => /⏰ لم يُنشر اليوم/.test(bodyOf(b))));
  const P = PR as any;
  assert("the reasons, one by one: his «لا تنشر», no purchase, no market, a loss, an outlier", P.unpublishedWhy({ x_decision: "skip" }) === "قرارك: لا تنشر" && P.unpublishedWhy({ x_cost_price: 0, x_market_price: 9 }) === "لا سعر شراء" && P.unpublishedWhy({ x_cost_price: 5, x_market_price: 0 }) === "بلا سعر سوق وبلا قرار"
    && P.unpublishedWhy({ x_cost_price: 15, x_market_price: 20, x_break_even: 20.4 }) === "خسارة: السوق 20 أقل من 20.40، وبلا قرار" && P.unpublishedWhy({ x_cost_price: 30, x_market_price: 45, x_break_even: 38, x_is_outlier: true }) === "سعر شاذ وبلا قرار");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ
console.log("\n[هـ] the trial to Baraa: «🧪 تجربة», today's data, nothing written, nothing published");
{
  const env = world(`${DAY} 09:00`); prices();
  // the day as it stands after a real morning: published, the banana alone
  await engine(env, ms(`${DAY} 04:00`));
  setRiyadh(`${DAY} 06:00`); await quiet(() => PR.checkPricesDeadline(env));
  setRiyadh(`${DAY} 09:00`);
  line(4).x_decision = "skip";                                // a decision he took today does not show in the trial: the day as at 04:00
  const n = owner().length, cust = sentTo(C1_PHONE).length, w = lineWrites(), s = dayWrites(), g0 = graph.length;
  const t = await quiet(() => RV.sendPriceReviewTest(env));
  const msg = owner().at(-1);
  assert("one message to Baraa alone, titled «🧪 تجربة — 📋 مراجعة أسعار اليوم …», with the day's four lines as at 04:00", t.sent && t.items === 4 && owner().length === n + 1 && bodyOf(msg).startsWith("🧪 تجربة — 📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026")
    && bodyOf(msg).includes("موز أمريكي: شراء 55 · سوق 70 · الفرق 15 (27%) ← انشر بسعر السوق 70") && bodyOf(msg).includes("رمان صغير: شراء 12 · سوق — ← انشر بالمقترح 19.50") && bodyOf(msg).includes("2 للنشر · 2 لا تنشر · 0 ⚠️") && bodyOf(msg).includes("رمان كبير: شراء 22 · سوق 28 · الفرق 6 (27%) ← لا تنشر (خسارة)") && !bodyOf(msg).includes("قرارك:"), bodyOf(msg));
  assert("…its buttons are the trial's (prvt_…)", buttonIds(msg).every((id) => id.startsWith("prvt_")) && buttonIds(msg).length === 3, JSON.stringify(buttonIds(msg)));
  await hook(env, OWNER, button(buttonIds(msg)[0], "✅ اعتمد الكل كما هو"));
  const a = texts().at(-1) ?? "";
  assert("«اعتمد الكل» in the trial: what would be published, marked, and «(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)»", a.startsWith("🧪 تجربة — ✅ سُجّلت قراراتك") && a.includes("• موز أمريكي — 70 ر.س (سعر السوق)") && a.includes("• رمان صغير — 19.50 ر.س (المقترح)") && a.endsWith("(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)"), a);
  await hook(env, OWNER, button(buttonIds(msg)[1], "✏️ مراجعة"));
  const f = flows().at(-1);
  assert("«مراجعة» in the trial: the form, its page marked «🧪 تجربة — فواكه», the lists on the proposed decisions", !!f && dataOf(f).t1 === "🧪 تجربة — فواكه" && JSON.stringify([1, 2, 3, 4].map((k) => dataOf(f)[`s${k}`])) === JSON.stringify(["market", "skip", "profit", "skip"]) && bodyOf(f).startsWith("🧪 تجربة — ✏️ مراجعة أسعار"), JSON.stringify(dataOf(f).t1));
  await hook(env, OWNER, nfm(tokenOf(f), { d1: "market", d2: "manual", p2: "19", d3: "profit", d4: "skip" }));
  const fr = texts().at(-1) ?? "";
  assert("its «اعتمد»: the decisions read back — with the ⚠️ of a manual price below «بدون خسارة» — and nothing written", fr.startsWith("🧪 تجربة — وصلت قراراتك") && fr.includes("• رمان وسط — 19 ر.س (سعر يدوي) ⚠️ أقل من سعر بدون خسارة 20.40") && fr.includes("• رمان كبير — لا تنشر") && fr.endsWith("(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)"), fr);
  await hook(env, OWNER, button(buttonIds(msg)[2], "⛔ لا تنشر اليوم"));
  assert("«لا تنشر اليوم» in the trial: «كان سيُسجَّل «لا تنشر» على 4 أصناف»", /^🧪 تجربة — ⛔ كان سيُسجَّل «لا تنشر» على 4 أصناف/.test(texts().at(-1) ?? ""), texts().at(-1));
  assert("NOTHING was written on a line or on the day, and no customer got anything", lineWrites() === w && dayWrites() === s && sentTo(C1_PHONE).length === cust && line(2).x_status === "unpublished" && !line(2).x_decision && line(4).x_decision === "skip" && dayOf().x_state === "published");
  assert("the five messages of the trial (the review, three answers, the form) went to Baraa's number alone", graph.length === g0 + 5 && graph.slice(g0).every((b: any) => b.to === OWNER), JSON.stringify(graph.slice(g0).map((b: any) => b.to)));
  const second = await quiet(() => RV.sendPriceReviewTest(env));
  assert("once a day", second.sent === false && second.reason === "already_today", JSON.stringify(second));
  const closed = world(`${DAY} 09:00`); prices(); await engine(closed, ms(`${DAY} 04:00`)); closeOwnerWindow(closed);
  const c = await quiet(() => RV.sendPriceReviewTest(closed));
  assert("his window closed: no trial (nothing held), and the day's claim released", c.sent === false && c.reason === "window_closed" && owner().length === 0 && heldFor(closed, OWNER).length === 0);
  const res = await worker.fetch(new Request("https://w.test/odoo/hook/price-review-test", { method: "POST" }), closed, ctx);
  assert("the trial's route asks for the hook's token", res.status === 401);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[و] the review is Baraa's alone, and what § 54 puts in Odoo");
{
  const env = world(); openWindow(env, C1_PHONE); openWindow(env, DRIVER_PHONE); openWindow(env, AHMED_PHONE);
  for (const purpose of [RV.REVIEW_PURPOSE, RV.REVIEW_TEST_PURPOSE]) {
    for (const to of [C1_PHONE, DRIVER_PHONE, AHMED_PHONE]) {
      const d = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose, to: "+" + to, content: { kind: "session", body: { type: "text", text: { body: "شراء 55 · سوق 70" } } } })));
      assert(`${purpose} to ${to === C1_PHONE ? "a customer" : to === DRIVER_PHONE ? "Omar" : "Ahmed"}: refused by the gateway (the owner's alone)`, d?.action === "refused" && /OwnerOnlyPurpose/.test((d as any).reason), JSON.stringify(d));
    }
  }
  assert("nothing reached any of them", [C1_PHONE, DRIVER_PHONE, AHMED_PHONE].every((n) => sentTo(n).length === 0));
  assert("the purposes are known to the gateway: the review is not critical and is never opened by a template of its own", PURPOSES[RV.REVIEW_PURPOSE]?.label === "مراجعة أسعار اليوم" && !PURPOSES[RV.REVIEW_PURPOSE]?.critical && PURPOSES[RV.REVIEW_TEST_PURPOSE]?.kind === "operational");
  void DRIVER; void AHMED; void CUST_PHONE;
  // Odoo
  assert("Odoo: one new field — x_pricing_config.x_above_suggested, a selection «بسعر السوق» / «بالمقترح», «بسعر السوق» by default", ODOO.CFG_FIELDS.length === 1 && ODOO.CFG_FIELDS[0].name === "x_above_suggested" && ODOO.CFG_FIELDS[0].ttype === "selection"
    && ODOO.CFG_FIELDS[0].field_description === "لما يكون السوق أعلى من المقترح" && ODOO.ABOVE_SELECTION === "[('market', 'بسعر السوق'), ('suggested', 'بالمقترح')]" && ODOO.ABOVE_DEFAULT === PE.ABOVE_SUGGESTED_DEFAULT);
  const fx = JSON.parse(readFileSync(new URL("./fixtures-odoo-fields-20261005-s54.json", import.meta.url), "utf8"));
  assert("…its values are the ones the worker reads, and the schema gate knows the field", JSON.stringify(fx._selections["x_pricing_config.x_above_suggested"]) === JSON.stringify(ODOO.ABOVE_OPTIONS.map((o: string[]) => o[0])) && fx.x_pricing_config.includes("x_above_suggested"));
  const arch = `<form>\n        <field name="x_outlier_ratio"/>\n        <field name="x_market_uplift_pct"/>\n      <field name="x_min_order_sar"/>\n</form>`;
  const out = ODOO.settingsArch(arch);
  assert("«⚙️ الإعدادات»: the setting right after «زيادة على سعر السوق ٪», nothing else touched, and a second run changes nothing", /name="x_market_uplift_pct"\/>\n\s+<field name="x_above_suggested"\/>/.test(out) && out.replace(/\n\s+<field name="x_above_suggested"\/>/, "") === arch && ODOO.settingsArch(out) === out);
  let threw = false; try { ODOO.settingsArch("<form/>"); } catch { threw = true; }
  assert("…a form without «زيادة على سعر السوق ٪» stops the script (nothing guessed)", threw);
  const dayNote = `<div class="text-muted mb-2">الشراء خام بدون ضريبة. ${ODOO.NOTES[0][1]} «معاينة» = …</div>`;
  const noted = ODOO.noteArch(dayNote, ODOO.NOTES[0][1], ODOO.NOTES[0][2]);
  assert("the rule's sentence on the three screens («📊 اليوم», the board, «⚙️ الإعدادات») is § 54's: no «متى بلغ … استثناء», the rest of the note kept, a second run changes nothing", ODOO.NOTES.length === 3 && ODOO.NOTES.every((n: string[]) => /متى بلغ/.test(n[1]) && !/متى بلغ/.test(n[2]) && /يُنشر تلقائياً بسعر السوق/.test(n[2]) && /«لما يكون السوق أعلى من المقترح»/.test(n[2]) && /ولا يُنشر بلا قرار/.test(n[2]))
    && noted.startsWith('<div class="text-muted mb-2">الشراء خام بدون ضريبة. القاعدة: سوق بين «بدون خسارة» والمقترح') && noted.endsWith(" «معاينة» = …</div>") && ODOO.noteArch(noted, ODOO.NOTES[0][1], ODOO.NOTES[0][2]) === noted);
  let stopped = false; try { ODOO.noteArch("<form/>", ODOO.NOTES[0][1], ODOO.NOTES[0][2]); } catch { stopped = true; }
  assert("…a screen whose note was changed by hand stops the script", stopped);
  assert("decisions use the fields the line already has: no new field on x_price_day_line", !srcOf("price-review.ts").includes("x_proposal") && Object.keys(RV.decisionVals("edit", 21, 0)).every((k) => fx.x_price_day_line.includes(k)) && Object.keys(RV.decisionVals("skip", 0, 0)).every((k) => fx.x_price_day_line.includes(k)));
}

done();
