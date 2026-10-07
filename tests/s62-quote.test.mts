// § 62 أ (2026-10-07) — «طلب أسعار خاص»: the request in Odoo and the worker's numbers on it.
//
//   • a new request is prepared once: its name, the waste of the settings, the margin 10 %, the day's
//     cost as its delivery cost, «صالح حتى» the end of tomorrow, its three sources by their roles
//   • the numbers of every line and of the order, written in ONE call and only when they changed
//   • «اعتمد المقترح للكل» fills the lines without a final price, never one Baraa typed
//   • the state follows the final prices; an issued or a closed request is left alone
//   • the hook: its token, its model, its ops
//   • the screen's data (scripts/lib/s62-odoo.mjs): the eight columns, the fields the worker writes
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s62-quote.test.mts

import { readFileSync } from "node:fs";
import { ctx, graph, odooLog, quiet, rows, seed, table } from "./wa-harness.mts";
import { assert, done, rejected } from "./s46-kit.mts";
import { AHMED, DAY, GARLIC, LETTUCE, LINE, MADARAT, MUSHROOM, OMAR, ORANGE, QUOTE, RAED, RECIPIENT, lineOf, linesOf, quote, recipientsOf, request, world, writes } from "./s62-kit.mts";

const SQ = await import("../src/special-quote.ts");
const LIB = await import("../scripts/lib/s62-odoo.mjs");
const M = await import("../src/special-quote-math.ts");
const ASK_HOURS = (await import("../src/special-ask.ts")).NUDGE_AFTER_MS / 3600_000;
const worker = (await import("../src/index.ts")).default;
const quoteWrites = () => odooLog.filter((l) => l.model === QUOTE && l.method === "write");

console.log("\n[أ1] a new request is prepared once");
{
  const env = world();
  const id = request();
  const r = await quiet(() => SQ.recalcQuote(env, id));
  const q = quote(id);
  assert("its name: «SQ-» and its id", q.x_name === SQ.quoteName(id) && /^SQ-\d{4,}$/.test(q.x_name), q.x_name);
  assert("the waste of the settings (5 %), the margin 10 %, the day's operating cost (600) as the delivery cost", q.x_waste_pct === 5 && q.x_min_margin_pct === 10 && q.x_delivery_cost === 600, JSON.stringify([q.x_waste_pct, q.x_min_margin_pct, q.x_delivery_cost]));
  assert("«صالح حتى»: the end of tomorrow in Riyadh (23:59:59 of 10-04, kept as UTC)", q.x_valid_until === "2026-10-04 20:59:59" && SQ.defaultValidUntil(Date.now()) === "2026-10-04 20:59:59", q.x_valid_until);
  assert("its date: today in Riyadh; prepared; still «مسودة»", q.x_date === DAY && q.x_prepared === true && q.x_state === "draft" && r?.state === "draft");
  const rec = recipientsOf(id).map((x) => `${x.x_partner_id}:${x.x_role}`);
  assert("its sources: Ahmed «شراء», Raed «سوق», and Omar (marketing) «سوق» for this request", JSON.stringify(rec) === JSON.stringify([`${AHMED}:purchase`, `${RAED}:market`, `${OMAR}:market`]), JSON.stringify(rec));
  assert("…Omar's card is not touched: no price source, no price role on it", table("hr.employee").get(7000 + OMAR)!.x_price_source === false && !table("res.partner").get(OMAR)!.x_price_source && !writes().some((w) => w.model === "hr.employee" || w.model === "res.partner"));
  assert("ONE write on the request did all of it", quoteWrites().length === 1 && writes().every((w) => w.model === QUOTE), JSON.stringify(writes().map((w) => `${w.model}.${w.method}`)));
  assert("the schema gate let every field through", rejected.length === 0, rejected.join(" | "));
  // what Baraa set is kept: a second pass prepares nothing
  Object.assign(q, { x_waste_pct: 0, x_min_margin_pct: 0, x_delivery_cost: 0 });
  await quiet(() => SQ.recalcQuote(env, id));
  assert("a prepared request keeps what Baraa set, zero included (no default comes back)", q.x_waste_pct === 0 && q.x_min_margin_pct === 0 && q.x_delivery_cost === 0 && recipientsOf(id).length === 3);
  // a request Baraa filled himself keeps his numbers and his sources
  const id2 = request(undefined, { x_waste_pct: 8, x_min_margin_pct: 15, x_delivery_cost: 250, x_valid_until: "2026-10-09 09:00:00", x_date: "2026-10-01" });
  seed(RECIPIENT, { x_quote_id: id2, x_partner_id: AHMED, x_role: "purchase" });
  await quiet(() => SQ.recalcQuote(env, id2));
  const q2 = quote(id2);
  assert("what Baraa typed before the first save stays: 8 %, 15 %, 250, his validity, his date, his one source", q2.x_waste_pct === 8 && q2.x_min_margin_pct === 15 && q2.x_delivery_cost === 250 && q2.x_valid_until === "2026-10-09 09:00:00" && q2.x_date === "2026-10-01" && recipientsOf(id2).length === 1);
  // the settings unreadable: the request is still prepared, the waste stays empty
  const env3 = world();
  table("x_pricing_config").clear(); table("x_operating_cost").clear();
  const id3 = request();
  await quiet(() => SQ.recalcQuote(env3, id3));
  assert("no settings and no cost line: prepared with the margin alone (no waste, no delivery cost guessed)", quote(id3).x_prepared === true && quote(id3).x_min_margin_pct === 10 && !quote(id3).x_waste_pct && !quote(id3).x_delivery_cost);
}

console.log("\n[أ2–أ4] the numbers of every line and of the order");
{
  const env = world();
  const id = request();
  // Ahmed's purchase prices on four lines, the market's observations on three, Baraa's final prices on three
  Object.assign(lineOf(id, ORANGE), { x_purchase_price: 3, x_final_price: 4.75, x_obs: JSON.stringify({ purchase: { [AHMED]: { p: 3, n: "أحمد حسان", at: 1 } }, market: { [RAED]: { p: 4.5, n: "رائد", at: 2 }, [OMAR]: { p: 5, n: "عمر المجهلي", at: 3 } } }) });
  Object.assign(lineOf(id, LETTUCE), { x_purchase_price: 6, x_final_price: 6.5, x_obs: JSON.stringify({ purchase: {}, market: { [RAED]: { p: 9, n: "رائد", at: 2 } } }) });
  Object.assign(lineOf(id, GARLIC), { x_purchase_price: 10, x_final_price: 14.25 });
  Object.assign(lineOf(id, 1), { x_purchase_price: 2 });
  Object.assign(lineOf(id, MUSHROOM), { x_obs: JSON.stringify({ purchase: {}, market: { [OMAR]: { p: 22, n: "عمر المجهلي", at: 3 } } }) });
  const r = await quiet(() => SQ.recalcQuote(env, id));
  const orange = lineOf(id, ORANGE), lettuce = lineOf(id, LETTUCE), garlic = lineOf(id, GARLIC), tomato = lineOf(id, 1), mushroom = lineOf(id, MUSHROOM), cucumber = lineOf(id, 2);
  // orange: cost 3.15, «بدون خسارة» 3.62, «الأدنى المربح» 3.985, the median 4.75 → «المقترح» 4.75; profit 1464 × (4.75 ÷ 1.15 − 3.15) = 1435.36
  assert("برتقال: the median of the market 4.75 with each observation and its source", orange.x_market_median === 4.75 && orange.x_market_text === "4.75 (رائد 4.5 · عمر 5)", `${orange.x_market_median} / ${orange.x_market_text}`);
  assert("…«بدون خسارة» 3.62, «المقترح» 4.75 (the market, above «الأدنى المربح»), its total 6954, its profit 1435.36", orange.x_no_loss_price === 3.62 && orange.x_suggested_price === 4.75 && orange.x_total === 6954 && orange.x_profit === 1435.36, JSON.stringify([orange.x_no_loss_price, orange.x_suggested_price, orange.x_total, orange.x_profit]));
  // lettuce: cost 6.3, «بدون خسارة» 7.25; the final 6.5 is under it: 494 × (6.5 ÷ 1.15 − 6.3) = −320.03
  assert("خس أمريكي: one observation is its own median («9 (رائد 9)»), «المقترح» 9, and a final price under «بدون خسارة» is a loss (−320.03)", lettuce.x_market_text === "9 (رائد 9)" && lettuce.x_suggested_price === 9 && lettuce.x_no_loss_price === 7.25 && lettuce.x_profit === -320.03, JSON.stringify([lettuce.x_market_text, lettuce.x_suggested_price, lettuce.x_no_loss_price, lettuce.x_profit]));
  // garlic: no market → «الأدنى المربح» 13.2825 → 13.5; profit 194 × (14.25 ÷ 1.15 − 10.5) = 366.91
  assert("ثوم: no market — «المقترح» is «الأدنى المربح» up to the quarter (13.5), no market text, its profit 366.91", garlic.x_suggested_price === 13.5 && !garlic.x_market_text && !garlic.x_market_median && garlic.x_profit === 366.91, JSON.stringify([garlic.x_suggested_price, garlic.x_market_text, garlic.x_profit]));
  assert("طماطم: a purchase price and no final price — «المقترح» 2.75, no total and no profit yet", tomato.x_suggested_price === 2.75 && tomato.x_no_loss_price === 2.42 && !tomato.x_total && !tomato.x_profit);
  assert("فطر أبيض: a market price and no purchase price — its median is shown, nothing is suggested", mushroom.x_market_median === 22 && mushroom.x_market_text === "22 (عمر 22)" && !mushroom.x_suggested_price && !mushroom.x_no_loss_price);
  assert("خيار: nothing yet — nothing written on it", !cucumber.x_suggested_price && !cucumber.x_market_text && !cucumber.x_profit);
  const q = quote(id);
  // 1435.36 − 320.03 + 366.91 = 1482.24; − 600 = 882.24
  assert("the order's profit = the lines' profits − the delivery cost: 1482.24 − 600 = 882.24, with its sign", q.x_order_profit === 882.24 && q.x_profit_text === "✅ ربح الطلب +882.24 ريال (3 أسطر خارج الحساب)", `${q.x_order_profit} / ${q.x_profit_text}`);
  assert("the count of lines without a purchase price (2) and without a final price (3), the total, the summary", q.x_missing_purchase === 2 && q.x_missing_final === 3 && q.x_total === 12929.5 && q.x_summary === "6 صنف · 2 بلا سعر شراء · 3 بلا سعر نهائي · ⚠️ 1 نهائيه تحت «بدون خسارة» · الإجمالي 12929.5 ريال", `${q.x_missing_purchase} ${q.x_missing_final} ${q.x_total} ${q.x_summary}`);
  assert("the result says the same", r?.numbers.profit === 882.24 && r.numbers.counted === 3 && r.numbers.belowCost === 1 && r.state === "draft");
  // a dearer delivery: the sign turns
  q.x_delivery_cost = 2000;
  await quiet(() => SQ.recalcQuote(env, id));
  assert("a delivery cost above the lines' profits: ❌ and the loss with its sign", q.x_order_profit === -517.76 && q.x_profit_text.startsWith("❌ ربح الطلب −517.76 ريال"), q.x_profit_text);
  // ONE write a pass, and none when nothing changed (the automation's second call ends there)
  odooLog.length = 0;
  const again = await quiet(() => SQ.recalcQuote(env, id));
  assert("a pass that changes nothing writes nothing (a save's second call ends the loop)", again?.wrote === false && writes().length === 0, JSON.stringify(writes().map((w) => `${w.model}.${w.method}`)));
  lineOf(id, 1).x_final_price = 3;
  odooLog.length = 0;
  await quiet(() => SQ.recalcQuote(env, id));
  const w = quoteWrites();
  assert("a final price typed on one line: ONE write — that line's price before VAT, its total and its profit, and the order's numbers alone", w.length === 1 && writes().length === 1 && JSON.stringify(w[0].body.vals.x_line_ids.map((c: any) => [c[0], c[1], Object.keys(c[2]).sort()])) === JSON.stringify([[1, lineOf(id, 1).id, ["x_final_net", "x_profit", "x_total"]]]), JSON.stringify(w[0]?.body.vals));
  assert("…33 × (3 ÷ 1.15 − 2.1) = 16.79, and the total 99", lineOf(id, 1).x_profit === 16.79 && lineOf(id, 1).x_total === 99);
  assert("no price of the day is read or written: not x_price_day, not x_daily_price, not x_price_offer", !odooLog.some((l) => ["x_price_day", "x_price_day_line", "x_daily_price", "x_price_offer"].includes(l.model)));
  assert("nothing is sent by a recalculation", graph.length === 0);
  assert("the schema gate let every field through", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ4] «اعتمد المقترح للكل», and the state");
{
  const env = world();
  const id = request();
  for (const [p, price] of [[ORANGE, 3], [LETTUCE, 6], [GARLIC, 10], [1, 2]] as Array<[number, number]>) lineOf(id, p).x_purchase_price = price;
  lineOf(id, GARLIC).x_final_price = 15;                       // typed by Baraa
  const r = await quiet(() => SQ.recalcQuote(env, id, { accept: true }));
  assert("the lines without a final price take «المقترح» (orange, no market: 3.985 → 4; lettuce 7.969 → 8; tomato 2.657 → 2.75)", lineOf(id, ORANGE).x_final_price === 4 && lineOf(id, LETTUCE).x_final_price === 8 && lineOf(id, 1).x_final_price === 2.75, JSON.stringify([lineOf(id, ORANGE).x_final_price, lineOf(id, LETTUCE).x_final_price, lineOf(id, 1).x_final_price]));
  assert("a price Baraa typed is never overwritten (15 stays, though «المقترح» is 13.5)", lineOf(id, GARLIC).x_final_price === 15 && lineOf(id, GARLIC).x_suggested_price === 13.5);
  assert("a line with no «المقترح» (no purchase price) is left empty, and counted", !lineOf(id, MUSHROOM).x_final_price && !lineOf(id, 2).x_final_price && r?.accepted === 3 && r.noSuggestion === 2);
  assert("the profit follows in the same write: the three accepted lines and the typed one are counted", r!.numbers.counted === 4 && lineOf(id, ORANGE).x_profit === 480.57 && quoteWrites().length === 1, `${r!.numbers.counted} ${lineOf(id, ORANGE).x_profit}`);
  assert("what Baraa reads back", SQ.acceptResultText(r!) === "اعتُمد المقترح لـ 3 سطر، و2 بلا مقترح (لا سعر شراء)" && SQ.acceptResultText({ accepted: 0, noSuggestion: 0 }) === "لا شيء يُعتمد: كل سطر له سعر نهائي" && SQ.acceptResultText({ accepted: 0, noSuggestion: 2 }).startsWith("لا شيء يُعتمد: 2 سطر بلا مقترح"));
  assert("still «مسودة»: two lines have no final price", quote(id).x_state === "draft");
  // every line priced → «مُسعَّر»
  lineOf(id, MUSHROOM).x_final_price = 30; lineOf(id, 2).x_final_price = 5;
  await quiet(() => SQ.recalcQuote(env, id));
  assert("every line has its final price: «مُسعَّر»", quote(id).x_state === "priced" && quote(id).x_missing_final === 0);
  lineOf(id, 2).x_final_price = 0;
  await quiet(() => SQ.recalcQuote(env, id));
  assert("a line loses its final price: back to «مسودة» (nothing was sent to the sources)", quote(id).x_state === "draft");
  quote(id).x_asked_at = "2026-10-03 10:00:00";
  await quiet(() => SQ.recalcQuote(env, id));
  assert("…and to «أُرسل للمصادر» once the sources were asked", quote(id).x_state === "sent");
  for (const st of ["quoted", "closed"]) {
    quote(id).x_state = st;
    await quiet(() => SQ.recalcQuote(env, id));
    assert(`«${SQ.STATE_LABEL[st as "quoted"]}» is left as it is by a recalculation`, quote(id).x_state === st);
  }
  odooLog.length = 0;
  assert("a request that is not there: null, nothing written", (await quiet(() => SQ.recalcQuote(env, 999999))) === null && writes().length === 0);
  assert("…it is SEARCHED by its id, never `read`: Odoo's read of a deleted record throws, and a request Baraa deleted must end quietly", odooLog.some((l) => l.model === QUOTE && l.method === "search_read" && JSON.stringify(l.body.domain) === "[[\"id\",\"=\",999999]]") && !odooLog.some((l) => l.model === QUOTE && l.method === "read"));
  assert("the labels of the five states", JSON.stringify(SQ.STATE_LABEL) === JSON.stringify({ draft: "مسودة", sent: "أُرسل للمصادر", priced: "مُسعَّر", quoted: "صدر العرض", closed: "مغلق" }));
}

console.log("\n[ج+] «الأسعار في العرض»: the final price Baraa types is the one of the mode");
{
  const env = world();
  // a request with no mode of its own (made outside the screen): prepared «قبل الضريبة»
  const id = request(undefined, { x_price_mode: false });
  await quiet(() => SQ.recalcQuote(env, id));
  assert("a new request is «قبل الضريبة» unless Baraa chose", quote(id).x_price_mode === "net" && SQ.asPriceMode(false) === "net" && SQ.asPriceMode("gross") === "gross" && SQ.asPriceMode("x") === "net");
  const kept = request(undefined, { x_price_mode: "gross" });
  await quiet(() => SQ.recalcQuote(env, kept));
  assert("…a mode Baraa chose is kept", quote(kept).x_price_mode === "gross");
  // «قبل الضريبة»: he types the price before VAT; the VAT-inclusive final follows it, and the formulas read that one
  Object.assign(lineOf(id, ORANGE), { x_purchase_price: 3, x_final_net: 5 });
  Object.assign(lineOf(id, GARLIC), { x_purchase_price: 10, x_final_net: 12.39 });
  await quiet(() => SQ.recalcQuote(env, id));
  assert("«قبل الضريبة»: the price he typed before VAT (5.00) gives the VAT-inclusive final (5.75)", lineOf(id, ORANGE).x_final_net === 5 && lineOf(id, ORANGE).x_final_price === 5.75 && lineOf(id, GARLIC).x_final_price === 14.25, `${lineOf(id, ORANGE).x_final_price} ${lineOf(id, GARLIC).x_final_price}`);
  // § 62 أ's formulas as they were, on the VAT-inclusive final: 1464 × (5.75 ÷ 1.15 − 3.15) = 2708.4
  assert("…the formulas are § 62 أ's, on the VAT-inclusive final: the profit 1464 × (5.75 ÷ 1.15 − 3.15) = 2708.4, the total 8418", lineOf(id, ORANGE).x_profit === 2708.4 && lineOf(id, ORANGE).x_total === 8418 && lineOf(id, ORANGE).x_no_loss_price === 3.62, JSON.stringify([lineOf(id, ORANGE).x_profit, lineOf(id, ORANGE).x_total]));
  // § 62 د — «المقترح» in «قبل الضريبة» is rounded up to the quarter on the price BEFORE VAT: 3.98475 ÷ 1.15 = 3.465 → 3.50, and 4.02 with it
  assert("…and «المقترح» is rounded on the price before VAT: 3.50 («المقترح قبل الضريبة»), 4.02 with it (it was 4.00 with it, 3.48 before)", lineOf(id, ORANGE).x_suggested_net === 3.5 && lineOf(id, ORANGE).x_suggested_price === 4.02, JSON.stringify([lineOf(id, ORANGE).x_suggested_net, lineOf(id, ORANGE).x_suggested_price]));
  // he clears it: the final goes with it
  lineOf(id, GARLIC).x_final_net = 0;
  await quiet(() => SQ.recalcQuote(env, id));
  assert("…a price he cleared is cleared: the VAT-inclusive final never brings it back", !lineOf(id, GARLIC).x_final_net && !lineOf(id, GARLIC).x_final_price && !lineOf(id, GARLIC).x_profit);
  // «اعتمد المقترح»: «المقترح» ÷ 1.15 before VAT, its VAT-inclusive final beside it; what he typed stays
  const r = await quiet(() => SQ.recalcQuote(env, id, { accept: true }));
  assert("«اعتمد المقترح للكل» in «قبل الضريبة» (§ 62 د): «المقترح» 11.75 before VAT — a quarter — and 13.51 with it; the 5.00 he typed stays", r?.accepted === 1 && lineOf(id, GARLIC).x_final_net === 11.75 && lineOf(id, GARLIC).x_final_price === 13.51 && lineOf(id, ORANGE).x_final_net === 5, JSON.stringify([lineOf(id, GARLIC).x_final_net, lineOf(id, GARLIC).x_final_price]));
  odooLog.length = 0;
  assert("…a second pass writes nothing (the two prices agree)", (await quiet(() => SQ.recalcQuote(env, id)))?.wrote === false && writes().length === 0);
  // «شاملة الضريبة»: he types the VAT-inclusive final; the price before VAT follows it
  Object.assign(lineOf(kept, ORANGE), { x_purchase_price: 3, x_final_price: 4.75, x_final_net: 99 });
  await quiet(() => SQ.recalcQuote(env, kept));
  assert("«شاملة الضريبة»: the final he typed (4.75) stays, and the price before VAT is 4.75 ÷ 1.15 = 4.13 whatever stood there", lineOf(kept, ORANGE).x_final_price === 4.75 && lineOf(kept, ORANGE).x_final_net === 4.13);
  assert("the two conversions, to the halala: ÷ 1.15 and × 1.15 — and a typed price before VAT always comes back from its own final", M.netOf(4.75) === 4.13 && M.grossOf(5) === 5.75 && M.grossOf(12.39) === 14.25 && M.netOf(0) === 0 && [0.01, 0.03, 4.13, 9.99, 68, 16.5, 152, 1234.56].every((n) => M.netOf(M.grossOf(n)) === n) && M.VAT_RATE === 0.15);
  assert("the schema gate let every field through", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] the observations the worker keeps on a line");
{
  const o = SQ.parseObs(JSON.stringify({ purchase: { 30: { p: 4.456, n: "أحمد", at: 5 }, 31: { p: 4.1, n: "مورد", at: 6 } }, market: { 0: { p: 3 }, 9: { p: "x" }, 109: { p: 6, n: "رائد", at: 1 } } }));
  assert("read back: prices to the halala, a source without an id or a price dropped", o.purchase["30"].p === 4.46 && Object.keys(o.market).join() === "109");
  assert("«أقل عرض» of the purchase sources (4.1); none: 0", SQ.lowestPurchase(o) === 4.1 && SQ.lowestPurchase(SQ.parseObs("")) === 0);
  assert("unreadable text, or none: no observation (never a throw)", JSON.stringify(SQ.parseObs("{oops")) === JSON.stringify({ purchase: {}, market: {} }) && JSON.stringify(SQ.parseObs(false)) === JSON.stringify({ purchase: {}, market: {} }));
  assert("the market's text: the median, then each observation by its source's first name in the order they came", SQ.marketText({ purchase: {}, market: { 9: { p: 6, n: "عمر المجهلي", at: 9 }, 109: { p: 5, n: "رائد", at: 2 } } }, 5.5) === "5.5 (رائد 5 · عمر 6)" && SQ.marketText({ purchase: {}, market: {} }, 0) === "");
}

console.log("\n[أ4] the hook from Odoo");
{
  const env = world();
  const id = request();
  const post = (op: string, body: unknown = { _model: QUOTE, _id: id }, token = "HOOK") => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/special-quote?op=${op}&token=${token}`, { method: "POST", body: JSON.stringify(body) }), env, ctx));
  assert("no token, or a wrong one: 401", (await post("recalc", undefined, "x")).status === 401);
  assert("another model's record: 400", (await post("recalc", { _model: "x_price_day", _id: id })).status === 400);
  assert("an op that is not one of the five, or no id: 400", (await post("delete")).status === 400 && (await post("recalc", { _model: QUOTE })).status === 400);
  assert("the five ops", JSON.stringify(SQ.HOOK_OPS) === JSON.stringify(["recalc", "accept", "send", "issue", "pdf"]) && SQ.isHookOp("send") && !SQ.isHookOp("drop"));
  assert("a good call is accepted at once (202: Odoo's webhook waits a second)", (await post("recalc")).status === 202);
  const out = await quiet(() => SQ.handleSpecialQuoteHook(env, id, "recalc", ctx));
  assert("recalc through the hook: the request is prepared and its numbers written", out.action === "written" && quote(id).x_prepared === true && !quote(id).x_last_result, JSON.stringify(out));
  lineOf(id, ORANGE).x_purchase_price = 3;
  const acc = await quiet(() => SQ.handleSpecialQuoteHook(env, id, "accept", ctx));
  assert("accept through the hook: the line takes «المقترح», and «آخر نتيجة» says what was done, with the hour", acc.action === "written" && lineOf(id, ORANGE).x_final_price === 4 && /^اعتُمد المقترح لـ 1 سطر، و5 بلا مقترح \(لا سعر شراء\) — \d\d:\d\d$/.test(quote(id).x_last_result), quote(id).x_last_result);
  assert("a request that is not there: said, nothing thrown", (await quiet(() => SQ.handleSpecialQuoteHook(env, 424242, "recalc", ctx))).action === "not_found");
  assert("nothing was sent by any of it", graph.length === 0);
}

console.log("\n[أ1–أ4] the screen's data (scripts/lib/s62-odoo.mjs)");
{
  const names = (defs: Array<{ name: string }>) => defs.map((d) => d.name);
  assert("the request: the customer, the date, the five states, the waste, the margin, the delivery cost, «صالح حتى», the note", ["x_partner_id", "x_date", "x_state", "x_waste_pct", "x_min_margin_pct", "x_delivery_cost", "x_valid_until", "x_note"].every((f) => names(LIB.QUOTE_FIELDS).includes(f)) && JSON.stringify(LIB.STATES.map((s: string[]) => s[0])) === JSON.stringify(["draft", "sent", "priced", "quoted", "closed"]) && JSON.stringify(LIB.STATES.map((s: string[]) => s[1])) === JSON.stringify(Object.values(SQ.STATE_LABEL)));
  assert("the line: the item, the quantity, the unit, the purchase price, the market's observations and median, «بدون خسارة», «المقترح», the final price, the total, the profit", ["x_product_tmpl_id", "x_qty", "x_unit", "x_purchase_price", "x_market_text", "x_market_median", "x_no_loss_price", "x_suggested_price", "x_final_price", "x_total", "x_profit"].every((f) => names(LIB.LINE_FIELDS).includes(f)));
  assert("the columns of a line, in Baraa's order: § 62 أ's eight, with «التعبئة» after the quantity and «النهائي قبل الضريبة» after the final price", JSON.stringify(LIB.LINE_COLUMNS) === JSON.stringify(["x_product_tmpl_id", "x_qty", "x_unit", "x_purchase_price", "x_market_text", "x_no_loss_price", "x_suggested_price", "x_final_price", "x_final_net", "x_profit"]));
  assert("«الأسعار في العرض»: قبل الضريبة / شاملة الضريبة, «قبل الضريبة» for a new request; and «خيارات بديلة»", JSON.stringify(LIB.PRICE_MODES) === JSON.stringify([["net", "قبل الضريبة"], ["gross", "شاملة الضريبة"]]) && LIB.ACTION_CONTEXT.includes("'default_x_price_mode': 'net'") && M.DEFAULT_PRICE_MODE === "net" && names(LIB.QUOTE_FIELDS).includes("x_alternatives") && names(LIB.LINE_FIELDS).includes("x_final_net"));
  const arch = LIB.formArch({ send: 1, accept: 2, recalc: 3, issue: 4, pdf: 5, close: 6, reopen: 7 });
  const shown = [...arch.split('<page string="الأصناف"')[1].split("</page>")[0].matchAll(/<field name="(x_[a-z_]+)"([^>]*)\/>/g)].filter((m) => !/optional="hide"|widget="handle"/.test(m[2])).map((m) => m[1]);
  assert("…and the form's list shows exactly those", JSON.stringify(shown) === JSON.stringify(LIB.LINE_COLUMNS), shown.join());
  assert("…the packaging is titled «التعبئة»; the final price Baraa types is the one of the mode — the other is read-only", /name="x_unit" string="التعبئة"/.test(arch) && arch.includes(`<field name="x_final_price" string="النهائي (شامل)" readonly="parent.x_price_mode != 'gross'"/>`) && arch.includes(`<field name="x_final_net" readonly="parent.x_price_mode == 'gross'"/>`) && arch.includes('<field name="x_price_mode" required="1"/>') && /name="x_alternatives"/.test(arch));
  assert("above them: the order's profit with its sign, and the count of lines without a purchase price", arch.indexOf('name="x_profit_text"') < arch.indexOf("<notebook>") && arch.indexOf('name="x_missing_purchase"') < arch.indexOf("<notebook>"));
  assert("what the worker computes is read-only on the screen; the purchase price is Baraa's to type", ["x_market_text", "x_no_loss_price", "x_suggested_price", "x_profit", "x_profit_text", "x_missing_purchase"].every((f) => new RegExp(`name="${f}"[^>]*readonly="1"`).test(arch)) && !/name="x_purchase_price"[^>]*readonly/.test(arch));
  assert("the seven buttons: send, accept, recalc, issue, PDF for me, close, reopen", ["📨 أرسل طلب الأسعار", "اعتمد المقترح للكل", "🔄 احسب", "📄 أصدر عرض السعر", "⬇️ PDF لي فقط", "🔒 أغلق الطلب", "↩️ أعد فتحه"].every((s) => arch.includes(`string="${s}"`)));
  assert("the hook's ops are the worker's, and its path", JSON.stringify(Object.values(LIB.HOOKS).map((h: any) => h.op).sort()) === JSON.stringify([...SQ.HOOK_OPS].sort()) && LIB.HOOK_PATH === "/odoo/hook/special-quote" && LIB.PROD_HOST === "utak-worker.utak-business.workers.dev");
  assert("the save's automation watches what the numbers are made of — and no field the worker writes alone", JSON.stringify(LIB.AUTOMATION_FIELDS) === JSON.stringify(["x_partner_id", "x_waste_pct", "x_min_margin_pct", "x_delivery_cost", "x_line_ids"]) && !LIB.AUTOMATION_FIELDS.some((f: string) => ["x_order_profit", "x_profit_text", "x_state", "x_summary", "x_recipient_ids", "x_last_result", "x_name", "x_prepared"].includes(f)));
  assert("the models and their names are the worker's", LIB.QUOTE_MODEL === SQ.QUOTE_MODEL && LIB.LINE_MODEL === SQ.LINE_MODEL && LIB.RECIPIENT_MODEL === SQ.RECIPIENT_MODEL);
  assert("the menu: «🧾 طلبات أسعار خاصة» under «💲 التسعير» (#582), the real requests alone", LIB.MENU_TITLE === "🧾 طلبات أسعار خاصة" && LIB.PRICING_MENU === 582 && LIB.ACTION_DOMAIN === "[('x_utak_simulation', '=', False)]");
  assert("«عروض المصادر»: «خاص», the request and the price's unit on a row", JSON.stringify(names(LIB.OFFER_FIELDS)) === JSON.stringify(["x_special", "x_special_quote_id", "x_special_unit"]));
  void rows; void MADARAT; void LINE; void linesOf;
}

console.log("\n[دليل] the operating guide (docs/OPERATING-DAY.md)");
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  const sec = guide.slice(guide.indexOf("## طلب أسعار خاص (§ 62)"));
  const part = sec.slice(0, sec.indexOf("\n## ", 5) > 0 ? sec.indexOf("\n## ", 5) : undefined);
  assert("the guide has the section «طلب أسعار خاص (§ 62)»", guide.includes("## طلب أسعار خاص (§ 62)"));
  assert("…where the screen is", part.includes("UTAK ← 💲 التسعير ← **🧾 طلبات أسعار خاصة**") && guide.includes("- **UTAK ← 💲 التسعير ← 🧾 طلبات أسعار خاصة:**"));
  assert("…its five steps, in order: أنشئ ← أرسل ← انتظر الأسعار ← اعتمد ← أصدر", part.includes("أنشئ ← أرسل ← انتظر الأسعار ← اعتمد ← أصدر") && ["1. **أنشئ.**", "2. **أرسل.**", "3. **انتظر الأسعار.**", "4. **اعتمد.**", "5. **أصدر.**"].every((x, i, a) => part.includes(x) && (i === 0 || part.indexOf(a[i - 1]) < part.indexOf(x))));
  assert("…the buttons by their names", ["«📨 أرسل طلب الأسعار»", "«اعتمد المقترح للكل»", "«📄 أصدر عرض السعر»", "«⬇️ PDF لي فقط»", "«🔒 أغلق الطلب»"].every((b) => part.includes(b)));
  assert("…that it never touches the day's prices, and its new items are not «نشط للبيع»", part.includes("**لا يلمس أسعار اليوم ولا نشرها**") && part.includes("ليست «نشط للبيع»"));
  assert("…who reads what: the quantity to «شراء» alone, the customer's name to nobody", part.includes("يرى **كمية** كل صنف") && part.includes("**لا يريان كمية**") && part.includes("**لا أحد يرى اسم العميل، ولا أي سعر منّا.**"));
  assert("…the formulas as the worker computes them: the VAT factor, the quarter, the delivery cost", part.includes(`التكلفة × ${M.VAT_FACTOR}`) && part.includes("الشراء × (1 + التالف)") && part.includes("**ربع ريال**") && part.includes("مجموع ربح الأسطر − تكلفة التوصيل") && part.includes(`«هامش الربح الأدنى» ${M.DEFAULT_MARGIN_PCT}٪`));
  assert("…that a typed final price is never overwritten, and a quotation never issues with a line unpriced", part.includes("**ما كتبته بيدك لا يُستبدل**") && part.includes("**لا يصدر عرض وفي الطلب سطر بلا سعر نهائي**"));
  assert("…the reminder after three hours, and a reply at any hour while the request is not closed", part.includes("**تذكير واحد بعد 3 ساعات**") && ASK_HOURS === 3 && part.includes("**في أي ساعة وأي يوم ما دام الطلب غير مغلق**") && part.includes("**لا يُحفظ**"));
  assert("…the customer's file: the template only up to 6:00 of tomorrow, else to Baraa", part.includes("**فقط إن كان «صالح حتى» لا يتجاوز 6:00 صباح الغد**") && part.includes("**يصلك الملف أنت**"));
  assert("…Baraa's line when prices arrive, and the «خاص» mark in «عروض المصادر»", part.includes("**«📨 وصلت أسعار الشراء (أو السوق) لطلب {العميل}: N من M صنف»**") && part.includes("**«خاص»**"));
  assert("…the five states by their labels", Object.values(SQ.STATE_LABEL).every((l) => part.includes(l)));
  const QT = await import("../src/special-quotation.ts");
  assert("…«الأسعار في العرض»: «قبل الضريبة» by default, which price Baraa types in each, and the three totals by their names", part.includes("**«الأسعار في العرض» (حقل على الطلب، افتراضياً «قبل الضريبة»):**") && part.includes("تكتب **«النهائي قبل الضريبة»**") && part.includes("تكتب «النهائي (شامل)»") && part.includes(`**«${QT.NET_SUBTOTAL_LABEL}»** ثم **«${QT.NET_VAT_LABEL}»** ثم **«الإجمالي»**`) && part.includes("**المعادلات واحدة**"));
  assert("…«خيارات بديلة» printed under the table as it is, and the closing line letter for letter", part.includes("يُطبع **تحت جدول العرض كما هو**") && part.includes(`«${QT.CLOSING_LINE}»`));
  assert("…a line by the carton: its weight in «التعبئة», the quantity the count of cartons", part.includes("**«كرتون 18 كجم»**") && part.includes("عدد الكراتين") && part.includes("**«التعبئة»**"));
}

done();
