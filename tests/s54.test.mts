// § 54 (2026-10-05) — the day's prices reviewed by Baraa in ONE message.
//
//   [أ] the proposed decision: the six rules with the numbers of 2026-10-05 (the record #54), the
//       setting «لما يكون السوق أعلى من المقترح» with its two values, the uplift of § 53, an outlier,
//       no carton share; the engine's lines, the stored day, the publication's check
//   [ب] the one message: nothing before 04:00; one message with every item, its three buttons; 4, 20
//       and 40 items; once; «🔄 تحديث» and the older buttons; his window closed (nothing held, the
//       template, the review at his message); no message per exception, no «عدّل» of before § 54
//   [ب2] the buttons: «نفّذ المقترح», «لا تنشر شيء», the old version, a second tap, another day
//   [ج] the form utak_owner_review_v2: its JSON at Meta against what the worker sends; the options and
//       the defaults; a manual price, a manual price below «بدون خسارة», «سعر يدوي» without a price;
//       the token; before and after 06:00
//   [د] no decision until 06:00: what is published by itself and what is not, and the 06:00 message
//   [هـ] the trial to Baraa: nothing written, nothing published
//
// § 55 أ (2026-10-05) — the same review, made plain: the texts below are § 55's (src/price-review.ts).
// Who gets it, when, the versions, the snapshot, what each button does, the decisions written and the
// publication are § 54's, unchanged. What reads differently:
//   • an item's line: its mark first (✅ ❌ ⚠️ 🔻), the purchase price with the same price × 1.15 beside it
//     («شامل», always two decimals: 55 → 63.25, 15 → 17.25, 12 → 13.80, 22 → 25.30), the market, no «الفرق»,
//     «ربحنا» signed —
//     «✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70» — and under an outlier what moved;
//   • «ربحنا» = the board's net of a carton: round2(price ÷ 1.15) − the full cost. In this world (a
//     share of 1.99, waste 5 %) the full cost = purchase × 1.05 + 1.99: banana 59.74, medium 17.74,
//     small 14.59, large 25.09 — every profit below is worked out from that by hand;
//   • three lines say what each choice does, in place of «N للنشر · M لا تنشر · K ⚠️» and «بلا قرارك…»;
//   • the buttons «✅ نفّذ المقترح», «✏️ عدّل», «⛔ لا تنشر شيء»;
//   • the form utak_owner_review_v2 (six pages of ten, two lines an item, every choice with its profit;
//     scripts/lib/s55-flows.mjs) — v1 (scripts/lib/s54-flows.mjs) stays at Meta and is no longer sent;
//   • the confirmation: every published item with «ربحنا», then «متوسط الربح للكرتون».
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
// @ts-ignore — plain .mjs helpers (§ 55: utak_owner_review_v2, the Flow the worker sends)
const LIB = await import("../scripts/lib/s55-flows.mjs");
// @ts-ignore — plain .mjs helpers (§ 54: utak_owner_review_v1, frozen at Meta and no longer sent)
const LIB1 = await import("../scripts/lib/s54-flows.mjs");
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
  const rows4 = RV.reviewRows(await PR.readLines(env, dayOf().id), "market", DAY);
  assert("the review's rows, from the stored lines: the same four proposals as the engine", JSON.stringify(rows4.map((r) => [r.name, r.proposal.kind, r.proposal.price])) === JSON.stringify([["موز أمريكي", "market", 70], ["رمان وسط", "skip", 0], ["رمان صغير", "profit", 19.5], ["رمان كبير", "skip", 0]]), JSON.stringify(rows4.map((r) => r.proposal)));
  // § 55 — «ربحنا»: the board's net of a carton, from the line's stored full cost (purchase × 1.05 + the share 1.99) and the day's VAT rate
  assert("…each row carries the line's full cost (59.74, 17.74, 14.59, 25.09) and the day's VAT rate (15)", JSON.stringify(rows4.map((r) => [r.fullCost, r.vatPct])) === JSON.stringify([[59.74, 15], [17.74, 15], [14.59, 15], [25.09, 15]]) && JSON.stringify(rows4.map((r) => r.fullCost)) === JSON.stringify([1, 2, 3, 4].map((p) => line(p).x_full_cost)), JSON.stringify(rows4.map((r) => [r.fullCost, r.vatPct])));
  assert("«ربحنا» = round2(price ÷ 1.15) − the full cost: banana at 70 +1.13, medium at 20 −0.35, small at 19.50 +2.37, large at 28 −0.74 and at 31.50 +2.30",
    JSON.stringify([RV.profitAt(rows4[0], 70), RV.profitAt(rows4[1], 20), RV.profitAt(rows4[2], 19.5), RV.profitAt(rows4[3], 28), RV.profitAt(rows4[3], 31.5)]) === JSON.stringify([1.13, -0.35, 2.37, -0.74, 2.3]), JSON.stringify([RV.profitAt(rows4[0], 70), RV.profitAt(rows4[1], 20), RV.profitAt(rows4[2], 19.5), RV.profitAt(rows4[3], 28), RV.profitAt(rows4[3], 31.5)]));
  assert("…it is the board's own number: the banana's «ربح حقيقي» on its line (published by itself at 70) is the same +1.13", line(1).x_real_profit === 1.13 && RV.profitAt(rows4[0], 70) === line(1).x_real_profit, JSON.stringify([line(1).x_net_sale, line(1).x_full_cost, line(1).x_real_profit]));
  assert("…always signed, two decimals, a real minus sign (U+2212): «+1.13», «−0.74», «0.00» — and none without a purchase price, a full cost or a price", RV.signed(1.13) === "+1.13" && RV.signed(-0.74) === "\u22120.74" && RV.signed(-0.74) === "−0.74" && RV.signed(2.3) === "+2.30" && RV.signed(0) === "0.00"
    && RV.profitAt({ purchase: 0, fullCost: 59.74, vatPct: 15 }, 70) === null && RV.profitAt({ purchase: 55, fullCost: 0, vatPct: 15 }, 70) === null && RV.profitAt(rows4[0], 0) === null, JSON.stringify([RV.signed(1.13), RV.signed(-0.74), RV.signed(0)]));
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
  // § 55 — «ربحنا» at the price it is published at: 71.50 ÷ 1.15 = 62.17, − 59.74 = +2.43
  assert("…the review proposes it by the same setting: «✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 75 | ربحنا بالمقترح 71.50: +2.43 ← انشر بـ 71.50»", bodyOf(owner().at(-1)).split("\n").includes("✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 75 | ربحنا بالمقترح 71.50: +2.43 ← انشر بـ 71.50"), bodyOf(owner().at(-1)));
  assert("…and says it goes out by itself at that price: «لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 71.50»", bodyOf(owner().at(-1)).split("\n").at(-1) === "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 71.50", bodyOf(owner().at(-1)));
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
  assert("its second line says what «ربحنا» is: «(الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل)»", L[1] === "(الربح = صافي الكرتون بعد الضريبة والتالف والتشغيل)" && RV.PROFIT_NOTE === L[1] && L[2] === "", JSON.stringify(L.slice(0, 3)));
  // § 55 — the mark first, the market, «ربحنا» signed, the decision: 70 ÷ 1.15 = 60.87, − 59.74 = +1.13
  assert("the banana's line, as the order writes it: «✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70»", L[3] === "✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70", body);
  assert("medium pomegranate, a loss at the market price (17.39 − 17.74): «❌ … ربحنا بسعر السوق: −0.35 ← لا تنشر»", L[4] === "❌ رمان وسط — شراء 15 (17.25 شامل) · سوق 20 | ربحنا بسعر السوق: −0.35 ← لا تنشر", body);
  assert("small pomegranate, no market price: «لا سعر سوق», the profit at the suggested price (16.96 − 14.59), «انشر بـ 19.50»", L[5] === "✅ رمان صغير — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50", body);
  assert("large pomegranate, a loss at the market price (24.35 − 25.09): «❌ … ربحنا بسعر السوق: −0.74 ← لا تنشر»", L[6] === "❌ رمان كبير — شراء 22 (25.30 شامل) · سوق 28 | ربحنا بسعر السوق: −0.74 ← لا تنشر", body);
  // the purchase as entered (net of VAT) and × 1.15 beside it: 55 → 63.25, 15 → 17.25, 12 → 13.80, 22 → 25.30
  assert("the purchase price is on every line, before the market, with the same price × 1.15 beside it («شامل», two decimals) — still no «الفرق», and no summary of counts", [["55", "63.25"], ["15", "17.25"], ["12", "13.80"], ["22", "25.30"]].every(([p, v], i) => L[3 + i].split(" — ")[1].startsWith(`شراء ${p} (${v} شامل) · `))
    && !/الفرق|للنشر ·|بلا قرارك/.test(body), body);
  assert("three lines under the table say what each choice does: what «نفّذ المقترح» publishes, what it does not, and what goes out at 6 with no tap (the banana alone)", L.length === 11 && L[7] === ""
    && L[8] === "لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان صغير 19.50" && L[9] === "وما ينتشر: رمان وسط، رمان كبير" && L[10] === "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 70", JSON.stringify(L.slice(7)));
  assert("one category: no heading line", !body.includes("— فواكه —"), body);
  assert("the three buttons, in order: «✅ نفّذ المقترح», «✏️ عدّل», «⛔ لا تنشر شيء»", JSON.stringify(buttonTitles(owner()[0])) === JSON.stringify(["✅ نفّذ المقترح", "✏️ عدّل", "⛔ لا تنشر شيء"])
    && JSON.stringify([RV.REVIEW_BUTTON_ALL, RV.REVIEW_BUTTON_FORM, RV.REVIEW_BUTTON_NONE, RV.REVIEW_BUTTON_EDIT]) === JSON.stringify(["✅ نفّذ المقترح", "✏️ عدّل", "⛔ لا تنشر شيء", "✏️ عدّل"]), JSON.stringify(buttonTitles(owner()[0])));
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
  const L2 = b2.split("\n");
  // 24 ÷ 1.15 = 20.87, − 17.74 = +3.13
  assert("…titled «🔄 تحديث مراجعة أسعار اليوم (05:10)», naming what changed, with the new line", L2[0] === "🔄 تحديث مراجعة أسعار اليوم (05:10) — السبت 3 أكتوبر 2026" && L2[1] === RV.PROFIT_NOTE && L2[2] === "تغيّر: رمان وسط." && L2[3] === ""
    && L2[5] === "✅ رمان وسط — شراء 15 (17.25 شامل) · سوق 24 | ربحنا بسعر السوق: +3.13 ← انشر بـ 24", b2);
  assert("…and its three lines follow the new numbers: three published by «نفّذ المقترح», the large one not, two by themselves", JSON.stringify(L2.slice(-3)) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان وسط 24، رمان صغير 19.50", "وما ينتشر: رمان كبير", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 70، رمان وسط 24"]), JSON.stringify(L2.slice(-3)));
  assert("…its buttons carry version 2", buttonIds(owner()[1])[0] === `prv_a_${dayOf().id}_2`);
  const before = lineWrites();
  const stale = await tap(env, `prv_a_${dayOf().id}_1`);
  assert("«نفّذ المقترح» on the OLDER message decides nothing: one line says a newer version came (05:10)", stale === "stale" && lineWrites() === before && [1, 2, 3, 4].every((p) => !line(p).x_decision) && /نسخة أحدث من مراجعة أسعار اليوم \(05:10\)/.test(texts().at(-1) ?? ""), JSON.stringify([stale, texts().at(-1)]));
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
  const day = "2026-10-03", dl = 6 * 60, title = "📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026";
  // purchase 55 → the full cost 59.74 (55 + waste 2.75 + the share 1.99); at the market price 70: 60.87 − 59.74 = +1.13
  const mk = (n: number): any[] => Array.from({ length: n }, (_, i) => ({
    lineId: i + 1, productId: i + 1, name: `صنف طويل الاسم رقم ${i + 1}`, purchase: 55, market: 70, sale: 70, upliftPct: 0, breakEven: 68.7, suggested: 71.5,
    proposal: { kind: "market", price: 70, why: "below_suggested", outlier: false, auto: true }, decision: null, decidedPrice: 0, fullCost: 59.74, vatPct: 15,
  }));
  const itemLine = (r: any) => `✅ ${r.name} — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70`;
  /** The item's line is in the text exactly once, whole. */
  const once = (text: string, r: any) => text.split("\n").filter((l) => l === itemLine(r)).length === 1;
  const named = (n: number) => mk(n).map((r) => `${r.name} 70`).join("، ");
  const groups = (n: number) => [{ title: "فواكه", rows: mk(n).slice(0, Math.ceil(n / 2)) }, { title: "خضار", rows: mk(n).slice(Math.ceil(n / 2)) }];
  const t4 = RV.buildReviewTexts(day, groups(4), dl);
  assert("4 items: the whole review above the buttons — no separate text", t4.texts.length === 0 && t4.body.length <= 1024 && mk(4).every((r) => once(t4.body, r)), String(t4.body.length));
  assert("…two categories: a heading line each («— فواكه —», «— خضار —»), in the forms' order", t4.body.indexOf("— فواكه —") > 0 && t4.body.indexOf("— خضار —") > t4.body.indexOf("— فواكه —"), t4.body);
  assert("…and under the table the three lines, with the items' names and prices", JSON.stringify(t4.body.split("\n").slice(-4)) === JSON.stringify(["", `لو ضغطت «نفّذ المقترح» ينتشر: ${named(4)}`, "وما ينتشر: لا شيء", `لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: ${named(4)}`]), t4.body);
  const t20 = RV.buildReviewTexts(day, groups(20), dl);
  assert("20 items do not fit an interactive message's text (1024): the table goes first as plain text, whole", t20.texts.length === 1 && t20.texts[0].length <= PR.PRICE_TEXT_LIMIT && mk(20).every((r) => once(t20.texts.join("\n"), r)), JSON.stringify(t20.texts.map((t) => t.length)));
  assert("…that text opens with the title and the note of «ربحنا», and closes with the three lines WITH the items' names (a blank line before them)", t20.texts[0].split("\n")[0] === title && t20.texts[0].split("\n")[1] === RV.PROFIT_NOTE
    && JSON.stringify(t20.texts[0].split("\n").slice(-4)) === JSON.stringify(["", `لو ضغطت «نفّذ المقترح» ينتشر: ${named(20)}`, "وما ينتشر: لا شيء", `لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: ${named(20)}`]), t20.texts[0].split("\n").slice(-4).join(" ⏎ "));
  assert("…then the buttons under «20 صنفاً في الجدول أعلاه.» and the three lines by number — no item line in it, within 1024", t20.body.length <= 1024 && !/ربحنا|سوق 70/.test(t20.body)
    && t20.body === [title, "20 صنفاً في الجدول أعلاه.", "لو ضغطت «نفّذ المقترح» ينتشر: 20 صنفاً", "وما ينتشر: لا شيء", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: 20 صنفاً"].join("\n"), t20.body);
  const t40 = RV.buildReviewTexts(day, groups(40), dl);
  assert("40 items: every line once, each part within a text message's room, the buttons' text within 1024", t40.texts.every((t) => t.length <= PR.PRICE_TEXT_LIMIT) && t40.body.length <= 1024
    && mk(40).every((r) => once(t40.texts.join("\n"), r)) && t40.body.split("\n")[1] === "40 صنفاً في الجدول أعلاه." && t40.body.split("\n")[2] === "لو ضغطت «نفّذ المقترح» ينتشر: 40 صنفاً" && t40.body.split("\n")[4] === "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: 40 صنفاً", JSON.stringify(t40.texts.map((t) => t.length)));
  const tight = RV.buildReviewTexts(day, groups(40), dl, {}, 1024, 900);
  assert("a table longer than one text message is cut on line boundaries, «(1/4)» … and nothing is lost", tight.texts.length > 1 && tight.texts.every((t, i) => t.split("\n")[0].endsWith(`(${i + 1}/${tight.texts.length})`) && t.length <= 900)
    && mk(40).every((r) => once(tight.texts.join("\n"), r)), JSON.stringify(tight.texts.map((t) => t.length)));
  assert("…the three lines by name are cut after their commas, never inside an item: every «name price» whole, twice (what the button publishes, what goes out by itself)", mk(40).every((r) => tight.texts.join("\n").split("\n").filter((l) => !l.startsWith("✅ ")).join("\n").split(`${r.name} 70`).length - 1 === 2)
    && JSON.stringify(RV.wrapList("أ، ب، ج", 4)) === JSON.stringify(["أ،", "ب، ج"]) && JSON.stringify(RV.wrapList("أ، ب، ج", 20)) === JSON.stringify(["أ، ب، ج"]), JSON.stringify(RV.wrapList("أ، ب، ج", 4)));
  assert("…the note of «ربحنا» is on the first part alone", tight.texts[0].split("\n")[1] === RV.PROFIT_NOTE && tight.texts.slice(1).every((t) => !t.includes(RV.PROFIT_NOTE)));
  // § 55 — the counts are no line of the message any more: three lines say what each choice does
  const mixed = mk(3); mixed[1].proposal = { kind: "skip", price: 0, why: "loss", outlier: false, auto: false };
  // the third: a small pomegranate (purchase 12 → the full cost 14.59, no market price), an outlier
  mixed[2] = { ...mixed[2], purchase: 12, market: 0, sale: 0, breakEven: 16.78, suggested: 19.5, fullCost: 14.59, proposal: { kind: "profit", price: 19.5, why: "no_market", outlier: true, auto: false } };
  assert("the counts: two published, one not, one ⚠️, one of them by itself", JSON.stringify(RV.reviewCounts(mixed)) === JSON.stringify({ publish: 2, skip: 1, warn: 1, auto: 1 }), JSON.stringify(RV.reviewCounts(mixed)));
  assert("…as the three lines say them, by name — and by number under a table sent as text («صنفان», «صنف واحد»)", JSON.stringify(RV.choiceLines(mixed, dl)) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: صنف طويل الاسم رقم 1 70، صنف طويل الاسم رقم 3 19.50", "وما ينتشر: صنف طويل الاسم رقم 2", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: صنف طويل الاسم رقم 1 70"])
    && JSON.stringify(RV.choiceLines(mixed, dl, { compact: true })) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: صنفان", "وما ينتشر: صنف واحد", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: صنف واحد"]), JSON.stringify(RV.choiceLines(mixed, dl)));
  assert("an outlier's line opens with ⚠️ (16.96 − 14.59 = +2.37), and a second line under it says a price moved — «عن آخر سعر» while the earlier one is not known", RV.rowMark(mixed[2]) === "⚠️"
    && JSON.stringify(RV.reviewItemLines(mixed[2])) === JSON.stringify(["⚠️ صنف طويل الاسم رقم 3 — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50", "⚠️ سعر الشراء تغيّر كثير عن آخر سعر، تأكد منه"]), JSON.stringify(RV.reviewItemLines(mixed[2])));
  assert("…with the two numbers when the earlier price is known: «⚠️ سعر الشراء تغيّر كثير (8 ← 12)، تأكد منه»; a market outlier: «⚠️ سعر السوق تغيّر كثير (30 ← 45)، تأكد منه»; both: a line each",
    JSON.stringify(RV.movedLines({ ...mixed[2], moved: [{ kind: "purchase", last: 8, now: 12 }] })) === JSON.stringify(["⚠️ سعر الشراء تغيّر كثير (8 ← 12)، تأكد منه"])
    && JSON.stringify(RV.movedLines({ ...mixed[2], moved: [{ kind: "market", last: 30, now: 45 }] })) === JSON.stringify(["⚠️ سعر السوق تغيّر كثير (30 ← 45)، تأكد منه"])
    && JSON.stringify(RV.movedLines({ ...mixed[2], moved: [{ kind: "purchase", last: 8, now: 12 }, { kind: "market", last: 0, now: 45 }] })) === JSON.stringify(["⚠️ سعر الشراء تغيّر كثير (8 ← 12)، تأكد منه", "⚠️ سعر السوق تغيّر كثير عن آخر سعر، تأكد منه"]));
  assert("…in the message the second line stays under its item (the next item after it)", RV.buildReviewTexts(day, [{ title: "فواكه", rows: [{ ...mixed[2], moved: [{ kind: "purchase", last: 8, now: 12 }] }, mixed[0]] }], dl).body.split("\n").slice(3, 6).join("\n")
    === ["⚠️ صنف طويل الاسم رقم 3 — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50", "⚠️ سعر الشراء تغيّر كثير (8 ← 12)، تأكد منه", itemLine(mixed[0])].join("\n"));
  assert("…and an outlier Baraa already decided waits for nothing: its own mark, «قرارك: …», no second line", JSON.stringify(RV.reviewItemLines({ ...mixed[2], decision: "profit", decidedPrice: 19.5, moved: [{ kind: "purchase", last: 8, now: 12 }] })) === JSON.stringify(["✅ صنف طويل الاسم رقم 3 — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← قرارك: انشر بـ 19.50"]));
  // whole halalas, half up: 22 × 1.15 = 25.30, 20 → 23.00, 21.37 → 24.5755 → 24.58, 20.50 → 23.575 → 23.58
  assert("the purchase price as entered and × 1.15 beside it, always with two decimals: «شراء 22 (25.30 شامل)», «شراء 20 (23.00 شامل)», «شراء 21.37 (24.58 شامل)», «شراء 20.50 (23.58 شامل)» — and nothing without a purchase price",
    RV.purchaseText({ purchase: 22 }) === "شراء 22 (25.30 شامل)" && RV.purchaseText({ purchase: 20 }) === "شراء 20 (23.00 شامل)" && RV.purchaseText({ purchase: 21.37 }) === "شراء 21.37 (24.58 شامل)" && RV.purchaseText({ purchase: 20.5 }) === "شراء 20.50 (23.58 شامل)"
    && RV.purchaseText({ purchase: 55 }) === "شراء 55 (63.25 شامل)" && RV.purchaseText({ purchase: 10 }) === "شراء 10 (11.50 شامل)" && RV.purchaseText({ purchase: 0 }) === "", JSON.stringify([22, 20, 21.37, 20.5, 0].map((purchase) => RV.purchaseText({ purchase }))));
  assert("no purchase price: nothing is written for it before the market, «لا سعر شراء» in place of the profit, ❌ and «لا تنشر»", RV.reviewLine({ ...mk(1)[0], name: "خس", purchase: 0, fullCost: 0, proposal: { kind: "skip", price: 0, why: "no_purchase", outlier: false, auto: false } }) === "❌ خس — سوق 70 | لا سعر شراء ← لا تنشر");
  assert("a purchase price with neither a market price nor a suggested one: the two prices alone, no profit — «❌ X — شراء 55 (63.25 شامل) · لا سعر سوق ← لا تنشر»", RV.reviewLine({ ...mk(1)[0], name: "X", market: 0, sale: 0, breakEven: 0, suggested: 0, proposal: { kind: "skip", price: 0, why: "no_price", outlier: false, auto: false } }) === "❌ X — شراء 55 (63.25 شامل) · لا سعر سوق ← لا تنشر",
    RV.reviewLine({ ...mk(1)[0], name: "X", market: 0, sale: 0, breakEven: 0, suggested: 0, proposal: { kind: "skip", price: 0, why: "no_price", outlier: false, auto: false } }));
  const lifted = { ...mk(1)[0], name: "موز", sale: 72.5, upliftPct: 3, proposal: { kind: "market", price: 72.5, why: "above_suggested", outlier: false, auto: true } };
  assert("with an uplift the decision names the price after it: «انشر بـ 72.50»", RV.decisionText(lifted) === "انشر بـ 72.50", RV.decisionText(lifted));
  // 72.50 ÷ 1.15 = 63.04, − 59.74 = +3.30
  assert("…the line keeps the market as observed (70) with the price after the uplift beside it, and «ربحنا» is at the price it is published at (72.50)", RV.reviewLine(lifted) === "✅ موز — شراء 55 (63.25 شامل) · سوق 70 (بعد الزيادة 72.50) | ربحنا بسعر السوق: +3.30 ← انشر بـ 72.50", RV.reviewLine(lifted));
  // a row Baraa decided: «قرارك: …», and the profit at HIS price — 72 ÷ 1.15 = 62.61 → +2.87; 68 → 59.13 → −0.61; 68.70 («بدون خسارة») → 59.74 → 0.00
  const mine = (decision: string, decidedPrice: number) => RV.reviewLine({ ...mk(1)[0], name: "موز", decision, decidedPrice });
  assert("a row Baraa already decided: «← قرارك: انشر بـ 70», «← قرارك: لا تنشر» (❌, the profit he leaves at the market price), a manual price «ربحنا بسعرك 72: +2.87»",
    mine("market", 70) === "✅ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← قرارك: انشر بـ 70" && mine("skip", 0) === "❌ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← قرارك: لا تنشر" && mine("edit", 72) === "✅ موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعرك 72: +2.87 ← قرارك: انشر بـ 72", JSON.stringify([mine("market", 70), mine("skip", 0), mine("edit", 72)]));
  assert("the marks: ✅ published with a profit above zero, 🔻 published with none (his price below «بدون خسارة», or at it exactly: 0.00), ❌ not published, ⚠️ an outlier still waiting",
    mine("edit", 68) === "🔻 موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعرك 68: −0.61 ← قرارك: انشر بـ 68" && mine("edit", 68.7) === "🔻 موز — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعرك 68.70: 0.00 ← قرارك: انشر بـ 68.70"
    && JSON.stringify([mk(1)[0], mixed[1], mixed[2]].map(RV.rowMark)) === JSON.stringify(["✅", "❌", "⚠️"]), JSON.stringify([mine("edit", 68), mine("edit", 68.7)]));
  assert("a row without its full cost (a snapshot of before § 55): the profit is simply left out of the line", RV.reviewLine({ ...mk(1)[0], name: "موز", fullCost: undefined, vatPct: undefined }) === "✅ موز — شراء 55 (63.25 شامل) · سوق 70 ← انشر بـ 70", RV.reviewLine({ ...mk(1)[0], name: "موز", fullCost: undefined, vatPct: undefined }));
  assert("the form's choices: no «بالمقترح» without a suggested price (no purchase price), no «بسعر السوق» without a market price", JSON.stringify(RV.reviewOptions({ ...mk(1)[0], purchase: 0, fullCost: 0, breakEven: 0, suggested: 0 }).map((o) => o.id)) === JSON.stringify(["market", "skip", "manual"])
    && JSON.stringify(RV.reviewOptions({ ...mk(1)[0], market: 0, sale: 0 }).map((o) => o.id)) === JSON.stringify(["profit", "skip", "manual"]));
  assert("nothing by itself: «لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء»; nothing to publish, nothing left out: «لا شيء» too", RV.choiceLines([mixed[2]], dl)[2] === "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء"
    && RV.choiceLines([mixed[1]], dl)[0] === "لو ضغطت «نفّذ المقترح» ينتشر: لا شيء" && RV.choiceLines(mk(1), dl)[1] === "وما ينتشر: لا شيء" && RV.choiceLines([mixed[2]], dl, { compact: true })[2] === "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء", JSON.stringify(RV.choiceLines([mixed[2]], dl)));
  assert("the publication time as he reads it: «الساعة 6» of 06:00, «الساعة 06:30» of 06:30", RV.clockAr(360) === "الساعة 6" && RV.clockAr(390) === "الساعة 06:30" && RV.choiceLines(mk(1), 390)[2] === "لو ما ضغطت شي، الساعة 06:30 ينتشر تلقائياً: صنف طويل الاسم رقم 1 70", RV.choiceLines(mk(1), 390)[2]);
  assert("after the publication time on a day that was not published the third line says a tap publishes at once — the two others stay", JSON.stringify(RV.choiceLines(mixed, dl, { late: true })) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: صنف طويل الاسم رقم 1 70، صنف طويل الاسم رقم 3 19.50", "وما ينتشر: صنف طويل الاسم رقم 2", "فات موعد الساعة 6 وما انتشرت أسعار اليوم: ضغطك «نفّذ المقترح» الآن ينشر فوراً."]), JSON.stringify(RV.choiceLines(mixed, dl, { late: true })));
  const R = RV as any;
  assert("the summary of § 54 is gone from the code: no «N للنشر · M لا تنشر · K ⚠️», no «بلا قرارك حتى…», no «الفرق»", ["countsLine", "autoLine", "proposalText"].every((n) => R[n] === undefined) && !/للنشر ·|بلا قرارك حتى|· الفرق \$\{/.test(srcOf("price-review.ts").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")));
}
{
  // 20 real lines through the engine and the gateway
  const env = world(); prices(); more(8, 6, 100); more(8, false, 200);
  await engine(env);
  const r = await review(env);
  assert("20 items on the day: the table as ONE text, then ONE message with the buttons — two messages, not twenty", r.action === "sent" && r.parts === 1 && owner().length === 2 && owner()[0].type === "text" && withButtons().length === 1 && owner()[1] === withButtons()[0], kinds());
  const table20 = bodyOf(owner()[0]);
  const at = (lead: string) => table20.indexOf(`\n${lead}`);
  assert("…by category: «— فواكه —» (the four), «— خضار —» (eight), «— أخرى —» (eight)", at("— فواكه —") > 0 && at("— فواكه —") < at("✅ موز أمريكي — ") && at("— خضار —") < at("✅ صنف 100 — ") && at("— أخرى —") < at("✅ صنف 200 — ") && at("— خضار —") > at("❌ رمان كبير — "), table20);
  // purchase 10 → the full cost 12.49 (10 + 0.50 + 1.99); at the market price 16: 13.91 − 12.49 = +1.42
  assert("…each of the sixteen others on its line: «✅ صنف 100 — شراء 10 (11.50 شامل) · سوق 16 | ربحنا بسعر السوق: +1.42 ← انشر بـ 16»", [...Array.from({ length: 8 }, (_, i) => 100 + i), ...Array.from({ length: 8 }, (_, i) => 200 + i)].every((id) => table20.split("\n").filter((l) => l === `✅ صنف ${id} — شراء 10 (11.50 شامل) · سوق 16 | ربحنا بسعر السوق: +1.42 ← انشر بـ 16`).length === 1), table20);
  const others = [...Array.from({ length: 8 }, (_, i) => `صنف ${100 + i} 16`), ...Array.from({ length: 8 }, (_, i) => `صنف ${200 + i} 16`)].join("، ");
  assert("…and the same text closes with the three lines by name: eighteen published by «نفّذ المقترح», the two losses not, seventeen by themselves (the small pomegranate waits for him)", JSON.stringify(table20.split("\n").slice(-4))
    === JSON.stringify(["", `لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان صغير 19.50، ${others}`, "وما ينتشر: رمان وسط، رمان كبير", `لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 70، ${others}`]), table20.split("\n").slice(-3).join(" ⏎ "));
  assert("…the buttons' text: «20 صنفاً في الجدول أعلاه.», then the three lines by number — eighteen, two, seventeen by themselves", bodyOf(owner()[1]) === ["📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026", "20 صنفاً في الجدول أعلاه.", "لو ضغطت «نفّذ المقترح» ينتشر: 18 صنفاً", "وما ينتشر: صنفان", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: 17 صنفاً"].join("\n"), bodyOf(owner()[1]));
}

console.log("\n[ب] an outlier still waiting: under its line, the price before and the price now (§ 55)");
{
  // Ahmed's banana: 30 two days ago, 22 yesterday, 55 today — kept and marked for review (x_extraction_status «pending», § 26)
  const env = world(); dp(1, 11, 30, "2026-10-01"); dp(1, 11, 22, "2026-10-02"); prices();
  (rows("x_daily_price").find((r: any) => r.x_product_tmpl_id === 1 && r.x_date === DAY) as any).x_extraction_status = "pending";
  await engine(env);
  assert("the engine marks the banana's line «سعر شاذ: الشراء»: the rule's decision (the market 70) is kept, but not by itself", line(1).x_is_outlier === true && line(1).x_reason === "سعر شاذ: الشراء" && line(1).x_status === "exception", JSON.stringify([line(1).x_is_outlier, line(1).x_reason, line(1).x_status]));
  const r = await review(env);
  const L = bodyOf(owner()[0]).split("\n");
  assert("⚠️ opens its line, and under it: «⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه» — Ahmed's price before this one, and today's", r.action === "sent" && r.count === 4 && L[3] === "⚠️ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70" && L[4] === "⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه"
    && L[5] === "❌ رمان وسط — شراء 15 (17.25 شامل) · سوق 20 | ربحنا بسعر السوق: −0.35 ← لا تنشر", bodyOf(owner()[0]));
  assert("…«نفّذ المقترح» would publish it at 70, and nothing goes out by itself (an outlier waits for him)", JSON.stringify(L.slice(-3)) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان صغير 19.50", "وما ينتشر: رمان وسط، رمان كبير", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: لا شيء"]), JSON.stringify(L.slice(-3)));
  const waiting = await RV.dayReviewRows(env, dayOf());
  assert("the two numbers are read for the outlier alone: the same supplier's last row before this one (22, not the older 30) and this one (55)", JSON.stringify(waiting.map((x) => x.moved ?? null)) === JSON.stringify([[{ kind: "purchase", last: 22, now: 55 }], null, null, null]), JSON.stringify(waiting.map((x) => x.moved ?? null)));
  await tap(env, `prv_r_${dayOf().id}_1`);
  assert("the form says it first on the item's line: «⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه · شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13»", dataOf(flows()[0]).x1 === "⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه · شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13" && dataOf(flows()[0]).s1 === "market", dataOf(flows()[0]).x1);
  await tap(env, `prv_a_${dayOf().id}_1`);
  const decided = (await RV.dayReviewRows(env, dayOf()))[0];
  assert("once he approved it, it waits for nothing: ✅, «قرارك: انشر بـ 70», no second line", line(1).x_decision === "market" && line(1).x_sale_price === 70 && !decided.moved && JSON.stringify(RV.reviewItemLines(decided)) === JSON.stringify(["✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← قرارك: انشر بـ 70"]), JSON.stringify(RV.reviewItemLines(decided)));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
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
  assert("…saying, in place of what goes out by itself: «فات موعد الساعة 6 وما انتشرت أسعار اليوم: ضغطك «نفّذ المقترح» الآن ينشر فوراً.»", JSON.stringify(bodyOf(late).split("\n").slice(-3))
    === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: رمان صغير 19.50", "وما ينتشر: موز أمريكي، رمان وسط، رمان كبير", "فات موعد الساعة 6 وما انتشرت أسعار اليوم: ضغطك «نفّذ المقترح» الآن ينشر فوراً."]) && !bodyOf(late).includes("ينتشر تلقائياً"), bodyOf(late));
  assert("…an item with no purchase price reads «❌ موز أمريكي — لا سعر سوق | لا سعر شراء ← لا تنشر»", bodyOf(late).split("\n").includes("❌ موز أمريكي — لا سعر سوق | لا سعر شراء ← لا تنشر") && bodyOf(late).split("\n").includes("✅ رمان صغير — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50"), bodyOf(late));
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
  assert("…so his first message at 06:10 brings the review, saying a tap on «نفّذ المقترح» publishes at once", withButtons().length === 1 && bodyOf(withButtons()[0]).split("\n").at(-1) === "فات موعد الساعة 6 وما انتشرت أسعار اليوم: ضغطك «نفّذ المقترح» الآن ينشر فوراً." && !env.MSG_DEDUP.store.has(`prv_owed:v1:${DAY}`), kinds());
  // …and a day published at 06:00 owes nothing any more
  const env2 = world(); prices(); closeOwnerWindow(env2);
  await quiet(() => PR.runPricesTick(env2));
  setRiyadh(`${DAY} 06:00`); await quiet(() => PR.runPricesTick(env2));
  setRiyadh(`${DAY} 06:05`); await quiet(() => PR.runPricesTick(env2));
  assert("a day published at 06:00 (the banana by itself): the review owed is dropped at the next tick — nothing left to review", dayOf().x_state === "published" && !env2.MSG_DEDUP.store.has(`prv_owed:v1:${DAY}`) && withButtons().length === 0);
}

console.log("\n[ب] the message per exception and its «عدّل» (a price typed within 30 minutes) are gone");
{
  const env = world(); prices();
  await engine(env); await review(env);
  setRiyadh(`${DAY} 04:05`); await quiet(() => PR.runPricesTick(env));
  setRiyadh(`${DAY} 04:10`); await quiet(() => PR.runPricesTick(env));
  assert("three exceptions on the day, and still ONE message: none of «⚠️ استثناء في أسعار اليوم», no pexc_ button, no list of choices", owner().length === 1
    && !owner().some((b: any) => /استثناء في أسعار اليوم/.test(bodyOf(b)) || b?.interactive?.type === "list" || buttonIds(b).some((id) => id.startsWith("pexc_"))), kinds());
  const P = PR as any;
  assert("src/prices.ts no longer has the exception messages or their «عدّل»", ["notifyPriceExceptions", "exceptionText", "exceptionChoices", "handlePriceExceptionButton", "handlePriceEditReply", "EDIT_REPLY_MIN", "EXCEPTIONS_MANY"].every((n) => P[n] === undefined)
    && !/أرسل سعر البيع|pexc_edit|pexc_e_/.test(srcOf("prices.ts") + srcOf("price-review.ts") + srcOf("index.ts")));
  // an old message of before § 54 may still sit in his chat
  const before = lineWrites();
  await hook(env, OWNER, button(`pexc_p_${line(3).id}`, "اعتمد بالسعر المربح"));
  assert("a tap on an OLD exception's choice decides nothing: one line says where decisions are taken now — by the buttons' names of today (✅ نفّذ المقترح / ✏️ عدّل)", lineWrites() === before && !line(3).x_decision && texts().at(-1) === PR.OLD_EXCEPTION_TEXT
    && PR.OLD_EXCEPTION_TEXT.startsWith("هذه رسالة استثناء قديمة، ولم يُسجَّل منها شيء. قرارات الأسعار صارت من رسالة «مراجعة أسعار اليوم» الواحدة (✅ نفّذ المقترح / ✏️ عدّل)، أو من "), JSON.stringify(texts().at(-1)));
  await hook(env, OWNER, button(`pexc_e_${line(3).id}`, "عدّل"));
  const n = owner().length;
  await hook(env, OWNER, { type: "text", text: { body: "21" } });
  assert("the old «عدّل» asks for no price, and a number typed by him is no price: nothing written, nothing answered", !texts().some((t) => /خلال 30 دقيقة/.test(t)) && owner().length === n && lineWrites() === before && !line(3).x_decision, JSON.stringify(texts().slice(-2)));
}

// ================================================================ ب2
console.log("\n[ب] «✅ نفّذ المقترح»");
{
  const env = world(); prices();
  await engine(env); await review(env);
  const id = dayOf().id;
  setRiyadh(`${DAY} 04:20`);
  await hook(env, OWNER, button(`prv_a_${id}_1`, "✅ نفّذ المقترح"));
  const d = [1, 2, 3, 4].map((p) => [line(p).x_decision, line(p).x_status, line(p).x_sale_price, line(p).x_manual_price || 0, line(p).x_manual_for || "", line(p).x_excluded]);
  assert("through the webhook: every row takes its proposed decision, in the line's own decision fields", JSON.stringify(d) === JSON.stringify([["market", "manual", 70, 70, "market", false], ["skip", "unpublished", 0, 0, "", true], ["profit", "manual", 19.5, 19.5, "profit", false], ["skip", "unpublished", 0, 0, "", true]]), JSON.stringify(d));
  assert("…with the time of the decision and the reason «📊 اليوم» shows", [1, 2, 3, 4].every((p) => !!line(p).x_decided_at) && line(1).x_reason === "براء: اعتمد بسعر السوق" && line(2).x_reason === "براء: لا تنشر" && line(3).x_reason === "براء: اعتمد بالسعر المربح", JSON.stringify([line(1).x_reason, line(3).x_reason]));
  const conf = bodyOf(owner().at(-1));
  const C = conf.split("\n");
  assert("ONE confirmation: «سيُنشر 06:00:» with the items, their prices and — § 55 — «ربحنا» of each", owner().length === 2 && C[0] === "✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026." && C[1] === "سيُنشر 06:00:"
    && C[2] === "• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13" && C[3] === "• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37", conf);
  // the plain mean of the published items' profits: (1.13 + 2.37) ÷ 2
  assert("…after the items one line: «متوسط الربح للكرتون: +1.75»", C[4] === "متوسط الربح للكرتون: +1.75", conf);
  assert("…and what will not be: «لا يُنشر: رمان وسط، رمان كبير.» — the last line", C[5] === "لا يُنشر: رمان وسط، رمان كبير." && C.length === 6, conf);
  assert("…with «✏️ عدّل» under it (the form again)", JSON.stringify(buttonIds(owner().at(-1))) === JSON.stringify([`prv_r_${id}_0`]) && buttonTitles(owner().at(-1))[0] === "✏️ عدّل");
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
  // a decision Baraa already took in Odoo stays; «نفّذ المقترح» fills the rest
  const env = world(); prices();
  await engine(env);
  Object.assign(line(2), { x_decision: "profit" });           // «قرار براء» chosen in «📊 اليوم»
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  await review(env);
  // his price 23 ÷ 1.15 = 20.00, − 17.74 = +2.26
  assert("a line he decided in Odoo shows as «← قرارك: انشر بـ 23» in the review, with the profit at HIS price", bodyOf(owner()[0]).split("\n").includes("✅ رمان وسط — شراء 15 (17.25 شامل) · سوق 20 | ربحنا بالمقترح 23: +2.26 ← قرارك: انشر بـ 23"), bodyOf(owner()[0]));
  assert("…and the three lines count it as published — by the button, and at 6 with no tap (his decision stands by itself)", JSON.stringify(bodyOf(owner()[0]).split("\n").slice(-3)) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان وسط 23، رمان صغير 19.50", "وما ينتشر: رمان كبير", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 70، رمان وسط 23"]), bodyOf(owner()[0]));
  await tap(env, `prv_a_${dayOf().id}_1`);
  assert("«نفّذ المقترح» leaves his own decision as it is and decides the three others", line(2).x_decision === "profit" && line(2).x_sale_price === 23 && line(1).x_decision === "market" && line(3).x_decision === "profit" && line(4).x_decision === "skip", JSON.stringify([1, 2, 3, 4].map((p) => line(p).x_decision)));
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
  const left3 = RV.reviewRows(await PR.readLines(env, dayOf().id), "market", DAY);
  assert("an item that left the active catalog is no row of the review", left3.length === 3 && !left3.some((r) => r.name === "موز أمريكي"), JSON.stringify(left3.map((r) => r.name)));
  await tap(env, `prv_a_${dayOf().id}_1`);
  assert("the banana left the catalog after 04:00: «نفّذ المقترح» does not decide it (it would be published)", line(1).x_reason === PR.OUT_OF_CATALOG_REASON && !line(1).x_decision && line(1).x_status === "unpublished" && line(3).x_decision === "profit", JSON.stringify(line(1)));
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
  assert("06:01 on a day still «مسودة»: «نفّذ المقترح» publishes at once (the time has passed)", dayOf().x_state === "published" && /رمان صغير \(كرتون\): 19\.50/.test(sentTo(C1_PHONE).map(bodyOf).join("\n")) && (texts().at(-1) ?? "").includes("نُشر الآن (بعد موعد 06:00"), JSON.stringify([dayOf().x_state, texts().at(-1)]));
}

console.log("\n[ب] «⛔ لا تنشر شيء»");
{
  const env = world(); prices();
  await engine(env); await review(env);
  const id = dayOf().id;
  const r = await tap(env, `prv_n_${id}_1`);
  assert("«لا تنشر» on every row — the banana too, which would have gone out by itself", r === "none:4" && [1, 2, 3, 4].every((p) => line(p).x_decision === "skip" && line(p).x_status === "unpublished" && line(p).x_sale_price === 0 && line(p).x_excluded === true), JSON.stringify([r, [1, 2, 3, 4].map((p) => line(p).x_decision)]));
  const said = bodyOf(owner().at(-1));
  assert("one line: «⛔ لن تُنشر أسعار اليوم (4 أصناف)…», how to undo before 06:00, and «✏️ عدّل»", said === "⛔ لن تُنشر أسعار اليوم (4 أصناف): سُجّل «لا تنشر» عليها كلها. للتراجع قبل 06:00: «✏️ عدّل»." && RV.itemsWord(1) === "صنف" && RV.itemsWord(2) === "صنفاً" && RV.itemsWord(10) === "أصناف" && RV.itemsWord(11) === "صنفاً"
    && buttonIds(owner().at(-1))[0] === `prv_r_${id}_0` && buttonTitles(owner().at(-1))[0] === "✏️ عدّل", said);
  setRiyadh(`${DAY} 06:00`);
  const dl = await quiet(() => PR.checkPricesDeadline(env));
  assert("06:00: nothing published, no customer message, the day «فات الموعد»", dl.action === "missed" && dayOf().x_state === "missed" && sentTo(C1_PHONE).length === 0, JSON.stringify(dl));
  assert("…and Baraa is told it was his decision — no alarm, no list: «⛔ أسعار اليوم (3 أكتوبر 2026) لم تُنشر بقرارك («لا تنشر»). لا تُعاد أسعار أمس.»", texts().at(-1) === "⛔ أسعار اليوم (3 أكتوبر 2026) لم تُنشر بقرارك («لا تنشر»). لا تُعاد أسعار أمس.", texts().at(-1));
}

// ================================================================ ج
console.log("\n[ج] utak_owner_review_v2: the Flow at Meta against what the worker sends");
{
  const j = LIB.buildReviewFlowJson();
  const first = j.screens[0];
  assert("Flow JSON 6.0, six pages REVIEW_A … REVIEW_F of ten items, no endpoint (no data_exchange, no data_api_version)", j.version === "6.0" && LIB.REVIEW_FLOW_NAME === "utak_owner_review_v2" && JSON.stringify(j.screens.map((s: any) => s.id)) === JSON.stringify(["REVIEW_A", "REVIEW_B", "REVIEW_C", "REVIEW_D", "REVIEW_E", "REVIEW_F"]) && LIB.REVIEW_PAGE_SLOTS === 10 && !JSON.stringify(j).includes("data_exchange") && !("data_api_version" in j));
  assert("the worker's constants are the Flow's: the first screen, the pages (6), the slots (10 a page, 60), the button «عدّل الأسعار» — and the Flow it sends is #1135227635856887", RV.REVIEW_FLOW_SCREEN === LIB.REVIEW_FIRST_SCREEN && RV.REVIEW_FLOW_PAGES === LIB.REVIEW_PAGES.length && RV.REVIEW_FLOW_PAGE_SLOTS === LIB.REVIEW_PAGE_SLOTS && RV.REVIEW_FLOW_SLOTS === LIB.REVIEW_SLOTS && RV.REVIEW_FLOW_CTA === LIB.REVIEW_CTA
    && RV.REVIEW_FLOW_PAGES === 6 && RV.REVIEW_FLOW_PAGE_SLOTS === 10 && RV.REVIEW_FLOW_SLOTS === 60 && RV.REVIEW_FLOW_CTA === "عدّل الأسعار" && RV.REVIEW_FLOW_ID === "1135227635856887", JSON.stringify([RV.REVIEW_FLOW_ID, RV.REVIEW_FLOW_PAGES, RV.REVIEW_FLOW_PAGE_SLOTS, RV.REVIEW_FLOW_CTA]));
  assert("every screen within Meta's fifty components (a heading, four for each item, the footers)", j.screens.every((s: any) => LIB.screenComponents(s).length <= LIB.SCREEN_COMPONENTS_MAX) && LIB.screenComponents(first).length === 44 && LIB.screenComponents(j.screens[5]).length === 42, JSON.stringify(j.screens.map((s: any) => LIB.screenComponents(s).length)));
  const slot1 = first.layout.children.slice(1, 5);
  assert("an item is four components: its two lines (text), its decision (a list opened on «s»), «السعر اليدوي» (a number)", JSON.stringify(slot1.map((c: any) => c.type)) === JSON.stringify(["TextCaption", "TextCaption", "Dropdown", "TextInput"])
    && slot1[0].text === "${data.x1}" && slot1[1].text === "${data.y1}" && slot1[2].name === "d1" && slot1[2]["data-source"] === "${data.o1}" && slot1[2]["init-value"] === "${data.s1}" && slot1[2].label === "${data.l1}"
    && slot1[3].name === "p1" && slot1[3]["input-type"] === "number" && slot1[3].required === false && slot1[3]["init-value"] === "${data.i1}" && slot1.every((c: any) => c.visible === "${data.v1}")
    && JSON.stringify(slot1) === JSON.stringify(LIB.reviewSlot(1, 1)) && first.layout.children[5].text === "${data.x2}", JSON.stringify(slot1));
  assert("the list must be answered while it is shown (no empty choice), and only then", slot1[2].required === "${data.v1}");
  assert("the later pages read the first page's data, and «اعتمد» carries d and p of every page up to its own", j.screens[1].layout.children[1].text === "${screen.REVIEW_A.data.x11}" && j.screens[1].layout.children[2].text === "${screen.REVIEW_A.data.y11}"
    && JSON.stringify(Object.keys(LIB.screenComponents(j.screens[1]).find((c: any) => c.type === "Footer" && c["on-click-action"].name === "complete")["on-click-action"].payload)) === JSON.stringify(Array.from({ length: 20 }, (_, i) => [`d${i + 1}`, `p${i + 1}`]).flat())
    && Object.keys(j.screens[5].layout.children.at(-1)["on-click-action"].payload).length === 120);
  assert("the last button is «اعتمد», the others «التالي» or «اعتمد» by m<k>", LIB.REVIEW_SUBMIT_LABEL === "اعتمد" && first.layout.children.at(-1).type === "If" && first.layout.children.at(-1).condition === "${data.m1}" && j.screens[5].layout.children.at(-1).label === "اعتمد");
  // what the worker sends, against the model («بدون خسارة» 13.60 = the full cost 11.83 × 1.15: at the market price 14, 12.17 − 11.83 = +0.34)
  const rowsOf = (n: number): any[] => Array.from({ length: n }, (_, i) => ({ lineId: 500 + i, productId: 900 + i, name: `صنف ${i + 1}`, purchase: 10, market: 14, sale: 14, upliftPct: 0, breakEven: 13.6, suggested: 16, proposal: { kind: "market", price: 14, why: "below_suggested", outlier: false, auto: true }, decision: null, decidedPrice: 0, fullCost: 11.83, vatPct: 15 }));
  const built = RV.reviewFormItems([{ title: "فواكه", rows: rowsOf(4) }]);
  const data = RV.reviewFormData(built.pages, built.items);
  assert("the data the worker sends has exactly the keys of the Flow's first page (431), each of its type", JSON.stringify(Object.keys(data).sort()) === JSON.stringify(Object.keys(first.data).sort()) && Object.keys(data).length === 431
    && Object.entries(first.data).every(([k, m]: [string, any]) => (m.type === "array" ? Array.isArray(data[k]) : typeof data[k] === m.type)), String(Object.keys(data).length));
  assert("…431 = a heading for each of the six pages, «a page follows» for the first five, and x / y / l / o / s / i / v of the sixty slots", ["x", "y", "l", "o", "s", "i", "v"].every((k) => Array.from({ length: 60 }, (_, i) => `${k}${i + 1}`).every((key) => key in data) && !(`${k}61` in data))
    && [1, 2, 3, 4, 5, 6].every((k) => `t${k}` in data) && [1, 2, 3, 4, 5].every((k) => `m${k}` in data) && !("m6" in data) && 6 + 5 + 60 * 7 === 431);
  assert("four items on one page: «اعتمد» on it (m1 false), the other slots hidden with one harmless option", data.t1 === "فواكه" && data.m1 === false && data.v4 === true && data.v5 === false && JSON.stringify(data.o5) === JSON.stringify([{ id: "skip", title: "-" }]) && data.s5 === "skip" && data.l5 === "-" && data.x5 === "-" && data.y5 === "-");
  // 10 × 1.15 = 11.50
  assert("an item's two lines: its numbers — the purchase with × 1.15 beside it, the market, «ربحنا» at the market price — and the suggested price against the market", data.x1 === "شراء 10 (11.50 شامل) · سوق 14 · ربحنا بسعر السوق: +0.34" && data.y1 === "سعرنا المقترح 16 = أعلى من السوق بـ 2 (+14.3%)" && data.x1 === built.items[0].info && data.y1 === built.items[0].info2, JSON.stringify([data.x1, data.y1]));
  assert("…the published Flow's own examples stay as they were sent to Meta (its JSON is frozen): a first line of before «شامل» — a line of text like any other — and the second line as the worker writes it", first.data.x1.__example__ === "شراء 22 · سوق 28 · ربحنا بسعر السوق: −0.74" && first.data.y1.__example__ === "سعرنا المقترح 31.50 = أعلى من السوق بـ 3.50 (+12.5%)" && first.data.x1.type === "string" && typeof data.x1 === "string", JSON.stringify([first.data.x1.__example__, first.data.y1.__example__]));
  const g11 = RV.reviewFormItems([{ title: "فواكه", rows: rowsOf(11) }, { title: "خضار", rows: rowsOf(3) }]);
  assert("a category of eleven continues on the next page («فواكه (2)»), then the next category: nothing is dropped", JSON.stringify(g11.pages) === JSON.stringify(["فواكه", "فواكه (2)", "خضار"]) && g11.items.length === 14 && g11.items[9].slot === 10 && g11.items[10].slot === 11 && g11.items[11].slot === 21 && g11.left.length === 0, JSON.stringify([g11.pages, g11.items.map((i: any) => i.slot)]));
  const d11 = RV.reviewFormData(g11.pages, g11.items);
  assert("…«التالي» after pages one and two, «اعتمد» on the third", d11.m1 === true && d11.m2 === true && d11.m3 === false && d11.m4 === false && d11.m5 === false && d11.t3 === "خضار" && d11.t4 === "-" && d11.v11 === true && d11.v12 === false && d11.v21 === true);
  const g70 = RV.reviewFormItems([{ title: "أخرى", rows: rowsOf(70) }]);
  assert("more than sixty items: the first sixty in the form (six pages of ten), the ten others named (they keep the proposed decision)", g70.items.length === 60 && g70.pages.length === 6 && g70.pages[5] === "أخرى (6)" && g70.left.length === 10 && g70.left[0] === "صنف 61" && RV.reviewFormText("2026-10-03", 60, g70.left).includes("خارج النموذج (يتسع لـ 60): صنف 61،"));
  assert("the labels and titles within Meta's limits (20 for a list's label, 30 for an option)", built.items.every((i: any) => [...i.label].length <= 20 && i.options.every((o: any) => [...o.title].length <= 30))
    && [...RV.reviewFormItems([{ title: "x", rows: [{ ...rowsOf(1)[0], name: "رمان يمني فاخر درجة أولى كبير جداً" }] }]).items[0].label].length === 20);
  // a title that would pass thirty characters drops the word «ربح», never a digit: 1234.50 ÷ 1.15 = 1073.48, − 1051.99 (1000 + 50 + 1.99) = +21.49
  const big = RV.reviewOptions({ ...rowsOf(1)[0], purchase: 1000, market: 1234.5, sale: 1234.5, breakEven: 1209.79, suggested: 1212.5, fullCost: 1051.99 });
  assert("…a long price keeps its number whole: «بسعر السوق 1234.50 (ربح +21.49)» is 31 characters, so «بسعر السوق 1234.50 (+21.49)»", [..."بسعر السوق 1234.50 (ربح +21.49)"].length === 31 && big.find((o: any) => o.id === "market")?.title === "بسعر السوق 1234.50 (+21.49)" && big.every((o: any) => [...o.title].length <= 30), JSON.stringify(big));
  assert("the option ids are the Flow's four, and the decisions' own words", JSON.stringify(LIB.REVIEW_OPTION_IDS) === JSON.stringify(["profit", "market", "skip", "manual"]) && JSON.stringify(first.data.o1.__example__.map((o: any) => o.id)) === JSON.stringify(LIB.REVIEW_OPTION_IDS));
  // utak_owner_review_v1 (§ 54) is frozen at Meta: its JSON stays as it was published, and the worker no longer sends it
  const j1 = LIB1.buildReviewFlowJson();
  assert("utak_owner_review_v1's JSON is still there, untouched: four pages of fifteen, three components an item, 367 keys, «راجع الأسعار» — and it is not the Flow the worker sends", LIB1.REVIEW_FLOW_NAME === "utak_owner_review_v1" && JSON.stringify(j1.screens.map((s: any) => s.id)) === JSON.stringify(["REVIEW_A", "REVIEW_B", "REVIEW_C", "REVIEW_D"])
    && LIB1.REVIEW_PAGE_SLOTS === 15 && LIB1.REVIEW_SLOTS === 60 && LIB1.screenComponents(j1.screens[0]).length === 49 && JSON.stringify(LIB1.reviewSlot(1, 1).map((c: any) => c.type)) === JSON.stringify(["TextCaption", "Dropdown", "TextInput"])
    && Object.keys(j1.screens[0].data).length === 367 && !("y1" in j1.screens[0].data) && LIB1.REVIEW_CTA === "راجع الأسعار" && RV.REVIEW_FLOW_ID !== "1084593151143621" && !srcOf("price-review.ts").includes('"1084593151143621"'), JSON.stringify([LIB1.REVIEW_FLOW_NAME, LIB1.REVIEW_PAGE_SLOTS, Object.keys(j1.screens[0].data).length]));
}

console.log("\n[ج] «✏️ عدّل»: the form opens on the proposed decisions");
{
  const env = world(); prices();
  await engine(env); await review(env);
  const id = dayOf().id;
  const r = await tap(env, `prv_r_${id}_1`);
  assert("«✏️ عدّل» → one Flow message to Baraa (utak_owner_review_v2, navigate to REVIEW_A, all the data with it)", r === "form" && flows().length === 1 && par(flows()[0]).flow_id === RV.REVIEW_FLOW_ID && par(flows()[0]).flow_id === "1135227635856887" && par(flows()[0]).flow_action === "navigate" && par(flows()[0]).flow_action_payload.screen === "REVIEW_A" && par(flows()[0]).flow_cta === "عدّل الأسعار", JSON.stringify(par(flows()[0])).slice(0, 200));
  assert("…its text: «✏️ عدّل أسعار السبت 3 أكتوبر 2026: 4 أصناف.», and that every choice carries its profit a carton", bodyOf(flows()[0]).split("\n")[0] === "✏️ عدّل أسعار السبت 3 أكتوبر 2026: 4 أصناف." && bodyOf(flows()[0]).includes("وجنب كل خيار ربحه للكرتون") && bodyOf(flows()[0]).includes("واكتب «السعر اليدوي» مع «سعر يدوي» فقط، ثم «اعتمد» في آخر صفحة."), bodyOf(flows()[0]));
  const d = dataOf(flows()[0]);
  assert("…its data: exactly the 431 keys of the Flow's first page", JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(LIB.reviewDataModel()).sort()) && Object.keys(d).length === 431, String(Object.keys(d).length));
  assert("the page «فواكه», four items, «اعتمد» on it", d.t1 === "فواكه" && d.m1 === false && [1, 2, 3, 4].every((n) => d[`v${n}`] === true) && d.v5 === false && JSON.stringify([1, 2, 3, 4].map((n) => d[`l${n}`])) === JSON.stringify(["موز أمريكي", "رمان وسط", "رمان صغير", "رمان كبير"]));
  // § 55 — two lines an item. The first: the purchase with × 1.15 beside it (as in the message), the market, «ربحنا» at the market price
  assert("the banana's first line: «شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13»; the large pomegranate's: «شراء 22 (25.30 شامل) · سوق 28 · ربحنا بسعر السوق: −0.74»", d.x1 === "شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13" && d.x2 === "شراء 15 (17.25 شامل) · سوق 20 · ربحنا بسعر السوق: −0.35" && d.x4 === "شراء 22 (25.30 شامل) · سوق 28 · ربحنا بسعر السوق: −0.74", JSON.stringify([d.x1, d.x2, d.x4]));
  assert("…and the small pomegranate's, without a market price: «شراء 12 (13.80 شامل) · لا سعر سوق»", d.x3 === "شراء 12 (13.80 شامل) · لا سعر سوق", d.x3);
  // the second: the suggested price against the market as observed — 71.50 − 70 = 1.50 (2.1 %), 23 − 20 = 3 (15 %), 31.50 − 28 = 3.50 (12.5 %)
  assert("the second line, where our suggested price stands: «سعرنا المقترح 71.50 = أعلى من السوق بـ 1.50 (+2.1%)», «… 23 = أعلى من السوق بـ 3 (+15%)», «… 31.50 = أعلى من السوق بـ 3.50 (+12.5%)»", d.y1 === "سعرنا المقترح 71.50 = أعلى من السوق بـ 1.50 (+2.1%)" && d.y2 === "سعرنا المقترح 23 = أعلى من السوق بـ 3 (+15%)" && d.y4 === "سعرنا المقترح 31.50 = أعلى من السوق بـ 3.50 (+12.5%)", JSON.stringify([d.y1, d.y2, d.y4]));
  assert("…without a market price: «سعرنا المقترح 19.50 — لا سعر سوق للمقارنة»", d.y3 === "سعرنا المقترح 19.50 — لا سعر سوق للمقارنة", d.y3);
  const banana = (await RV.dayReviewRows(env, dayOf()))[0];
  // market 75: 71.50 − 75 = −3.50, of 75 = −4.7 %
  assert("…a suggested price below the market, at it, and none: «… = أقل من السوق بـ 3.50 (−4.7%)», «… = سعر السوق», «لا سعر مقترح»", RV.reviewCompare({ ...banana, market: 75, sale: 75 }) === "سعرنا المقترح 71.50 = أقل من السوق بـ 3.50 (−4.7%)" && RV.reviewCompare({ ...banana, market: 71.5, sale: 71.5 }) === "سعرنا المقترح 71.50 = سعر السوق"
    && RV.reviewCompare({ ...banana, suggested: 0 }) === "لا سعر مقترح" && RV.reviewCompare(banana) === d.y1 && RV.reviewInfo(banana) === d.x1, JSON.stringify([RV.reviewCompare({ ...banana, market: 75, sale: 75 }), RV.reviewCompare({ ...banana, market: 71.5, sale: 71.5 })]));
  assert("…an item without a purchase price: «لا سعر شراء · سوق 70» (no «شامل», no profit)", RV.reviewInfo({ ...banana, purchase: 0, fullCost: 0 }) === "لا سعر شراء · سوق 70", RV.reviewInfo({ ...banana, purchase: 0, fullCost: 0 }));
  assert("…an outlier's first line opens with what moved: «⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه · شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13»", RV.reviewInfo({ ...banana, proposal: { ...banana.proposal, outlier: true, auto: false }, moved: [{ kind: "purchase", last: 22, now: 55 }] }) === "⚠️ سعر الشراء تغيّر كثير (22 ← 55)، تأكد منه · شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13");
  // every choice with its own profit: the banana at 71.50 → 62.17 − 59.74 = +2.43, at 70 → +1.13; the large one at 31.50 → 27.39 − 25.09 = +2.30, at 28 → −0.74
  assert("the banana's choices: «بالمقترح 71.50 (ربح +2.43)», «بسعر السوق 70 (ربح +1.13)», «لا تنشر», «سعر يدوي» — none opens with «انشر»", JSON.stringify(d.o1) === JSON.stringify([{ id: "profit", title: "بالمقترح 71.50 (ربح +2.43)" }, { id: "market", title: "بسعر السوق 70 (ربح +1.13)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]), JSON.stringify(d.o1));
  assert("…the large pomegranate's, as the Flow's example: «بالمقترح 31.50 (ربح +2.30)», «بسعر السوق 28 (ربح −0.74)»", JSON.stringify(d.o4) === JSON.stringify([{ id: "profit", title: "بالمقترح 31.50 (ربح +2.30)" }, { id: "market", title: "بسعر السوق 28 (ربح −0.74)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]) && JSON.stringify(d.o4) === JSON.stringify(LIB.reviewDataModel().o1.__example__), JSON.stringify(d.o4));
  assert("«بسعر السوق» is offered only with a market price: not for the small pomegranate («بالمقترح 19.50 (ربح +2.37)», «لا تنشر», «سعر يدوي»)", JSON.stringify(d.o3) === JSON.stringify([{ id: "profit", title: "بالمقترح 19.50 (ربح +2.37)" }, { id: "skip", title: "لا تنشر" }, { id: "manual", title: "سعر يدوي" }]), JSON.stringify(d.o3));
  assert("…every title within Meta's thirty characters", [1, 2, 3, 4].every((n) => d[`o${n}`].every((o: any) => [...o.title].length <= 30)));
  assert("each list opens on the proposed decision: the market, «لا تنشر», the suggested, «لا تنشر»", JSON.stringify([1, 2, 3, 4].map((n) => d[`s${n}`])) === JSON.stringify(["market", "skip", "profit", "skip"]) && [1, 2, 3, 4].every((n) => d[`i${n}`] === ""), JSON.stringify([1, 2, 3, 4].map((n) => d[`s${n}`])));
  const token = tokenOf(flows()[0]);
  assert("the token is the review's («pr1.20261003.…»), kept in KV with the day and the items", RV.isReviewFormToken(token) && token.startsWith("pr1.20261003.") && (await RV.readReviewFormToken(env, token))?.dayId === id && (await RV.readReviewFormToken(env, token))?.items.length === 4);
  // «اعتمد» with nothing changed = the proposed decisions; a list left untouched may come back without a value
  setRiyadh(`${DAY} 04:30`);
  await hook(env, OWNER, nfm(token, { d1: "market", d2: "skip", p1: "", p2: "" }));
  const dec = [1, 2, 3, 4].map((p) => [line(p).x_decision, line(p).x_sale_price]);
  assert("«اعتمد» with nothing changed (through the webhook): the four proposed decisions — a list that came back without a value keeps the one it opened on", JSON.stringify(dec) === JSON.stringify([["market", 70], ["skip", 0], ["profit", 19.5], ["skip", 0]]), JSON.stringify(dec));
  const conf = bodyOf(owner().at(-1));
  assert("the confirmation: «سيُنشر 06:00:» the banana 70 and the small pomegranate 19.50 with «ربحنا» of each, «متوسط الربح للكرتون: +1.75», «لا يُنشر: رمان وسط، رمان كبير.», and «✏️ عدّل»", conf === ["✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026.", "سيُنشر 06:00:", "• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13", "• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37", "متوسط الربح للكرتون: +1.75", "لا يُنشر: رمان وسط، رمان كبير."].join("\n")
    && buttonIds(owner().at(-1))[0] === `prv_r_${id}_0` && buttonTitles(owner().at(-1))[0] === "✏️ عدّل", conf);
  const w = lineWrites();
  const again = await formReply(env, token, { d1: "skip", d2: "skip", d3: "skip", d4: "skip" });
  assert("the same form sent again: «هذا النموذج سبق اعتماده ✅», nothing written", again.action === "duplicate" && lineWrites() === w && line(1).x_decision === "market" && texts().at(-1) === RV.REVIEW_FORM_USED_TEXT, JSON.stringify(again));
  // «✏️ عدّل» under the confirmation: the form again, opened on what he decided
  await tap(env, `prv_r_${id}_0`);
  const d2 = dataOf(flows().at(-1));
  assert("«✏️ عدّل» → the form again, each list on HIS decision now", flows().length === 2 && JSON.stringify([1, 2, 3, 4].map((n) => d2[`s${n}`])) === JSON.stringify(["market", "skip", "profit", "skip"]) && tokenOf(flows().at(-1)) !== token);
  // a manual price, a manual price below «بدون خسارة», «سعر يدوي» without a price, a change of mind
  const t2 = tokenOf(flows().at(-1));
  const res = await formReply(env, t2, { d1: "profit", p1: "99", d2: "manual", p2: "19", d3: "manual", p3: "", d4: "manual", p4: "٣٠٫٥" });
  assert("the banana moved to «بالمقترح»: 71.50 — and «السعر اليدوي» typed beside it is NOT read (it is read with «سعر يدوي» alone)", line(1).x_decision === "profit" && line(1).x_sale_price === 71.5 && line(1).x_manual_for === "profit", JSON.stringify(line(1)));
  assert("«سعر يدوي» 19 on the medium pomegranate — below «بدون خسارة» 20.40 — is taken", line(2).x_decision === "edit" && line(2).x_sale_price === 19 && line(2).x_manual_price === 19 && line(2).x_manual_for === "edit" && line(2).x_status === "manual" && line(2).x_reason === "براء: سعر معدّل", JSON.stringify(line(2)));
  assert("«سعر يدوي» ٣٠٫٥ (Arabic digits) on the large one: 30.50", line(4).x_decision === "edit" && line(4).x_sale_price === 30.5, JSON.stringify(line(4)));
  assert("«سعر يدوي» without a price: nothing written for it — the small pomegranate stays as he had it (the suggested 19.50)", res.action === "decided" && res.written === 3 && line(3).x_decision === "profit" && line(3).x_sale_price === 19.5, JSON.stringify([res, line(3)]));
  const c2 = bodyOf(owner().at(-1));
  // «ربحنا» at each price: 71.50 → 62.17 − 59.74 = +2.43; 19 → 16.52 − 17.74 = −1.22; 19.50 → +2.37; 30.50 → 26.52 − 25.09 = +1.43
  assert("the confirmation lists the four prices, each with its profit: 71.50 (المقترح) +2.43, 19 (سعر يدوي) −1.22, 19.50 +2.37, 30.50 (سعر يدوي) +1.43", JSON.stringify(c2.split("\n").slice(1, 6))
    === JSON.stringify(["سيُنشر 06:00:", "• موز أمريكي — 71.50 ر.س (المقترح) · ربحنا +2.43", "• رمان وسط — 19 ر.س (سعر يدوي) · ربحنا −1.22", "• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37", "• رمان كبير — 30.50 ر.س (سعر يدوي) · ربحنا +1.43"]) && !c2.includes("لا يُنشر:"), c2);
  // (2.43 − 1.22 + 2.37 + 1.43) ÷ 4 = 1.2525
  assert("…then «متوسط الربح للكرتون: +1.25» — the loss he took on one item counted in it", c2.split("\n")[6] === "متوسط الربح للكرتون: +1.25", c2);
  assert("…with the ⚠️ line of the manual price below «بدون خسارة» — and none for 30.50, which is above 28.85", c2.includes("⚠️ رمان وسط: السعر اليدوي 19 أقل من سعر بدون خسارة 20.40.") && !/⚠️ رمان كبير/.test(c2), c2);
  assert("…and the ⚠️ line of what was not counted: «اخترت «سعر يدوي» بلا سعر أكبر من صفر»: رمان صغير", /⚠️ ما انحسب \(اخترت «سعر يدوي» بلا سعر أكبر من صفر\): رمان صغير — بقي على حاله\./.test(c2), c2);
  // «✏️ عدّل» once more: the lists on HIS decisions, the manual prices in their fields; «اعتمد» with nothing changed writes nothing
  await tap(env, `prv_r_${id}_0`);
  const d3 = dataOf(flows().at(-1)), t3 = tokenOf(flows().at(-1));
  assert("«✏️ عدّل» after his changes: each list on his decision («سعر يدوي» where he typed one), «السعر اليدوي» filled with 19 and 30.50", JSON.stringify([1, 2, 3, 4].map((n) => d3[`s${n}`])) === JSON.stringify(["profit", "manual", "profit", "manual"]) && JSON.stringify([1, 2, 3, 4].map((n) => d3[`i${n}`])) === JSON.stringify(["", "19", "", "30.50"]), JSON.stringify([1, 2, 3, 4].map((n) => [d3[`s${n}`], d3[`i${n}`]])));
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
  assert("…the prices of «بالمقترح» / «بسعر السوق» are the token's — what the form showed — and a slot that is not in the form is ignored", v.decisions.length === 4 && v.decisions.every((x) => rec.items.some((i) => i.lineId === x.lineId)));
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
  assert("…and how to publish now: the review's buttons by their names of today, or «نشر المعتمد الآن»", alert.includes("لا تُعاد أسعار أمس. «✅ نفّذ المقترح» أو «✏️ عدّل» من رسالة المراجعة ينشر فوراً، أو قرارك ثم «نشر المعتمد الآن» في ") && !/اعتمد الكل|✏️ مراجعة/.test(alert), alert);
  setRiyadh(`${DAY} 06:30`);
  await tap(env, `prv_r_${id}_1`);
  const token = tokenOf(flows().at(-1));
  const r = await formReply(env, token, { d1: "skip", d2: "manual", p2: "21", d3: "profit", d4: "skip" });
  assert("06:30, «اعتمد» in the form: the decisions written, the day approved and published at once", r.action === "late" && dayOf().x_state === "published" && !!dayOf().x_published_at && line(2).x_sale_price === 21 && line(3).x_sale_price === 19.5, JSON.stringify([r, dayOf().x_state]));
  const list = sentTo(C1_PHONE).map(bodyOf).join("\n");
  assert("…the customers get the list now: the medium pomegranate at 21, the small one at 19.50", /رمان وسط \(جرم\): 21 ر\.س/.test(list) && /رمان صغير \(كرتون\): 19\.50 ر\.س/.test(list), list);
  const conf = texts().at(-1) ?? "";
  // 21 ÷ 1.15 = 18.26, − 17.74 = +0.52; the mean of +0.52 and +2.37 = 1.445
  assert("…and the confirmation says so: «نُشر الآن (بعد موعد 06:00، بمسار «نشر المعتمد الآن»):» with the two prices, their profit, and the mean", JSON.stringify(conf.split("\n").slice(1, 5))
    === JSON.stringify(["نُشر الآن (بعد موعد 06:00، بمسار «نشر المعتمد الآن»):", "• رمان وسط — 21 ر.س (سعر يدوي) · ربحنا +0.52", "• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37", "متوسط الربح للكرتون: +1.45"]) && !conf.includes("سيُنشر"), conf);
  assert("…without «✏️ عدّل» (a published day takes no decision)", !buttonIds(owner().at(-1)).length);
  assert("the record's report names the late approval from WhatsApp", /اعتماد براء من واتساب بعد الموعد/.test(String(dayOf().x_publish_report)), String(dayOf().x_publish_report));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // «نفّذ المقترح» after 06:00, and a late approval with nothing to publish
  const env = world(); dp(3, 31, 12);
  await engine(env); await review(env);
  setRiyadh(`${DAY} 06:00`); await quiet(() => PR.checkPricesDeadline(env));
  setRiyadh(`${DAY} 07:30`);
  const r = await tap(env, `prv_a_${dayOf().id}_1`);
  assert("«نفّذ المقترح» at 07:30 on a day that was not published: the small pomegranate published at once at 19.50", r === "all:4" && dayOf().x_state === "published" && /رمان صغير \(كرتون\): 19\.50/.test(sentTo(C1_PHONE).map(bodyOf).join("\n")) && (texts().at(-1) ?? "").includes("نُشر الآن (بعد موعد 06:00"), JSON.stringify([r, texts().at(-1)]));
  // one item published: its profit is the mean
  assert("…the confirmation: «• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37», «متوسط الربح للكرتون: +2.37»", (texts().at(-1) ?? "").split("\n").includes("• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37") && (texts().at(-1) ?? "").split("\n").includes("متوسط الربح للكرتون: +2.37"), texts().at(-1));
  const env2 = world(); dp(2, 21, 15); market(2, 21, 20);
  await engine(env2); await review(env2);
  setRiyadh(`${DAY} 06:00`); await quiet(() => PR.checkPricesDeadline(env2));
  setRiyadh(`${DAY} 06:20`);
  const states = dayWrites();
  await tap(env2, `prv_a_${dayOf().id}_1`);                    // every proposal is «لا تنشر»
  assert("a late «نفّذ المقترح» with nothing to publish: no approval, no customer message — «فات موعد 06:00، ولا صنف للنشر: لم يُنشر شيء.» (and no mean of nothing)", dayOf().x_state === "missed" && dayWrites() === states && sentTo(C1_PHONE).length === 0 && bodyOf(owner().at(-1)).includes("فات موعد 06:00، ولا صنف للنشر: لم يُنشر شيء.") && !bodyOf(owner().at(-1)).includes("متوسط الربح"), bodyOf(owner().at(-1)));
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
  const B = bodyOf(owner()[0]).split("\n");
  // the apple: 30 + waste 1.50 + the share 1.99 = 33.49; 45 ÷ 1.15 = 39.13, − 33.49 = +5.64
  assert("the review marks the outlier ⚠️: «⚠️ تفاح — شراء 30 (34.50 شامل) · سوق 45 | ربحنا بسعر السوق: +5.64 ← انشر بـ 45», and under it which price moved (Omar's first price of it: «عن آخر سعر»)", B[7] === "⚠️ تفاح — شراء 30 (34.50 شامل) · سوق 45 | ربحنا بسعر السوق: +5.64 ← انشر بـ 45" && B[8] === "⚠️ سعر السوق تغيّر كثير عن آخر سعر، تأكد منه" && B[9] === "" && B.length === 13, bodyOf(owner()[0]));
  assert("…three published by «نفّذ المقترح» (the apple too), two not, one ⚠️ — and one by itself: the banana alone", JSON.stringify(B.slice(-3)) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان صغير 19.50، تفاح 45", "وما ينتشر: رمان وسط، رمان كبير", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 70"])
    && JSON.stringify(RV.reviewCounts(await RV.dayReviewRows(env, dayOf()))) === JSON.stringify({ publish: 3, skip: 2, warn: 1, auto: 1 }), JSON.stringify(B.slice(-3)));
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
  const many = Array.from({ length: 25 }, (_, i) => ({ x_product_tmpl_id: [i + 1, `صنف ${i + 1}`], x_cost_price: 0 }));
  assert("a long list of unpublished items stays within a message: twenty named with their reasons, the rest counted", P.unpublishedList(many).split("(لا سعر شراء)").length - 1 === 20 && P.unpublishedList(many).includes("صنف 20 (لا سعر شراء)") && !P.unpublishedList(many).includes("صنف 21") && /، و5 غيرها \(التفاصيل في /.test(P.unpublishedList(many)) && !/غيرها/.test(P.unpublishedList(many.slice(0, 20))), P.unpublishedList(many).slice(-80));
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
  const M = bodyOf(msg).split("\n");
  assert("one message to Baraa alone, titled «🧪 تجربة — 📋 مراجعة أسعار اليوم …», with the day's four lines as at 04:00", t.sent && t.items === 4 && owner().length === n + 1 && M[0] === "🧪 تجربة — 📋 مراجعة أسعار اليوم — السبت 3 أكتوبر 2026" && M[1] === RV.PROFIT_NOTE
    && JSON.stringify(M.slice(3, 7)) === JSON.stringify(["✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70", "❌ رمان وسط — شراء 15 (17.25 شامل) · سوق 20 | ربحنا بسعر السوق: −0.35 ← لا تنشر", "✅ رمان صغير — شراء 12 (13.80 شامل) · لا سعر سوق | ربحنا بالمقترح 19.50: +2.37 ← انشر بـ 19.50", "❌ رمان كبير — شراء 22 (25.30 شامل) · سوق 28 | ربحنا بسعر السوق: −0.74 ← لا تنشر"]) && !bodyOf(msg).includes("قرارك:"), bodyOf(msg));
  assert("…and the three lines, as at 04:00 (the day's own publication does not show in the trial)", JSON.stringify(M.slice(-3)) === JSON.stringify(["لو ضغطت «نفّذ المقترح» ينتشر: موز أمريكي 70، رمان صغير 19.50", "وما ينتشر: رمان وسط، رمان كبير", "لو ما ضغطت شي، الساعة 6 ينتشر تلقائياً: موز أمريكي 70"]) && M.length === 11, JSON.stringify(M.slice(-3)));
  assert("…its buttons are the trial's (prvt_…), under the same three titles", buttonIds(msg).every((id) => id.startsWith("prvt_")) && buttonIds(msg).length === 3 && JSON.stringify(buttonTitles(msg)) === JSON.stringify(["✅ نفّذ المقترح", "✏️ عدّل", "⛔ لا تنشر شيء"]), JSON.stringify(buttonIds(msg)));
  await hook(env, OWNER, button(buttonIds(msg)[0], "✅ نفّذ المقترح"));
  const a = texts().at(-1) ?? "";
  assert("«نفّذ المقترح» in the trial: what would be published — each item with «ربحنا», and the mean — marked, and «(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)»", a === ["🧪 تجربة — ✅ سُجّلت قراراتك على أسعار السبت 3 أكتوبر 2026.", "سيُنشر 06:00:", "• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13", "• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37", "متوسط الربح للكرتون: +1.75", "لا يُنشر: رمان وسط، رمان كبير.", "(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)"].join("\n"), a);
  await hook(env, OWNER, button(buttonIds(msg)[1], "✏️ عدّل"));
  const f = flows().at(-1);
  assert("«عدّل» in the trial: the form, its page marked «🧪 تجربة — فواكه», the lists on the proposed decisions", !!f && dataOf(f).t1 === "🧪 تجربة — فواكه" && JSON.stringify([1, 2, 3, 4].map((k) => dataOf(f)[`s${k}`])) === JSON.stringify(["market", "skip", "profit", "skip"]) && bodyOf(f).startsWith("🧪 تجربة — ✏️ عدّل أسعار السبت 3 أكتوبر 2026: 4 أصناف.") && par(f).flow_id === RV.REVIEW_FLOW_ID
    && dataOf(f).x1 === "شراء 55 (63.25 شامل) · سوق 70 · ربحنا بسعر السوق: +1.13" && dataOf(f).y1 === "سعرنا المقترح 71.50 = أعلى من السوق بـ 1.50 (+2.1%)", JSON.stringify([dataOf(f).t1, dataOf(f).x1, dataOf(f).y1]));
  await hook(env, OWNER, nfm(tokenOf(f), { d1: "market", d2: "manual", p2: "19", d3: "profit", d4: "skip" }));
  const fr = texts().at(-1) ?? "";
  // the medium pomegranate at his 19: 16.52 − 17.74 = −1.22
  assert("its «اعتمد»: the decisions read back, each price with «ربحنا» — with the ⚠️ of a manual price below «بدون خسارة» — and nothing written", fr === ["🧪 تجربة — وصلت قراراتك على أسعار السبت 3 أكتوبر 2026:", "• موز أمريكي — 70 ر.س (سعر السوق) · ربحنا +1.13", "• رمان وسط — 19 ر.س (سعر يدوي) · ربحنا −1.22 ⚠️ أقل من سعر بدون خسارة 20.40", "• رمان صغير — 19.50 ر.س (المقترح) · ربحنا +2.37", "• رمان كبير — لا تنشر", "(تجربة: لم يُكتب شيء في Odoo، ولم يُنشر شيء)"].join("\n"), fr);
  await hook(env, OWNER, button(buttonIds(msg)[2], "⛔ لا تنشر شيء"));
  assert("«لا تنشر شيء» in the trial: «كان سيُسجَّل «لا تنشر» على 4 أصناف»", /^🧪 تجربة — ⛔ كان سيُسجَّل «لا تنشر» على 4 أصناف/.test(texts().at(-1) ?? ""), texts().at(-1));
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
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  assert("OPERATING-DAY: the review in one message — the form, what is published with no decision, an approval after 06:00, the setting, a manual price below «بدون خسارة»", guide.includes("## مراجعة أسعار اليوم في رسالة واحدة (§ 54)")
    && guide.includes("**بلا قرار حتى 06:00**") && guide.includes("**الاعتماد بعد 06:00**") && guide.includes("«لما يكون السوق أعلى من المقترح»") && /سعر يدوي أقل من «بدون خسارة»\*\* يُقبل/.test(guide));
  // § 55 — the guide shows the message as the worker writes it NOW: the item's line with «ربحنا», and the buttons by their names of today
  assert("OPERATING-DAY: the 04:00 message as it reads since § 55 — «✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70» — and its three buttons «✅ نفّذ المقترح», «✏️ عدّل», «⛔ لا تنشر شيء»", guide.includes("✅ موز أمريكي — شراء 55 (63.25 شامل) · سوق 70 | ربحنا بسعر السوق: +1.13 ← انشر بـ 70")
    && [RV.REVIEW_BUTTON_ALL, RV.REVIEW_BUTTON_FORM, RV.REVIEW_BUTTON_NONE].every((t) => guide.includes(`«${t}»`)), JSON.stringify([RV.REVIEW_BUTTON_ALL, RV.REVIEW_BUTTON_FORM, RV.REVIEW_BUTTON_NONE].filter((t) => !guide.includes(`«${t}»`))));
  assert("OPERATING-DAY: no instruction to answer an exception per item or to type a price after «عدّل» is left", !/خيار واحد لكل صنف قبل 06:00/.test(guide) && !/ثم يكتب السعر رقماً واحداً خلال 30 دقيقة/.test(guide) && !/رسالة لكل صنف استثنائي/.test(guide) && guide.includes("**ما أُلغي:**"));
  assert("decisions use the fields the line already has: no new field on x_price_day_line", !srcOf("price-review.ts").includes("x_proposal") && Object.keys(RV.decisionVals("edit", 21, 0)).every((k) => fx.x_price_day_line.includes(k)) && Object.keys(RV.decisionVals("skip", 0, 0)).every((k) => fx.x_price_day_line.includes(k)));
}

done();
