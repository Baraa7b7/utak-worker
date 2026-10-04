// § 49 د (2026-10-01) — «دور الأسعار» (x_price_role on the source's card, set in Odoo): a «سوق» source's
// numbers are market observations even with «شراء» written beside them, a «شراء» source's are purchase
// offers, a source without a role keeps the keyword rule of § 40 ب, and «أقل عرض» counts the «شراء»
// sources alone. Ahmed Hassan (#30) = شراء, Omar = سوق.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s49-sources.test.mts

import { openWindow, quiet, rows, seed, sentTo, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, DAY, DRIVER, DRIVER_PHONE, assert, cost, done, dp, fresh, rejected, setExtract } from "./s46-kit.mts";

const PS = await import("../src/price-sources.ts");
const EN = await import("../src/pricing-engine.ts");
const PR = await import("../src/prices.ts");
const SUP = await import("../src/suppliers.ts");
// @ts-ignore — plain .mjs helper
const UI = await import("../scripts/lib/s49-ui.mjs");

// ================================================================ [د] the sources' role
console.log("\n[د] «دور الأسعار»: a «سوق» source's numbers are market observations, a «شراء» source's are purchase offers");
{
  const both = { cost_price: 22, market_price: 26 };
  assert("no role (as before § 49): Omar's «رمان كبير 26 شراء 22» → market 26, purchase 22", JSON.stringify(PS.classifyOffer(both, "رمان كبير 26 شراء 22", "observer")) === JSON.stringify({ dropped: [], purchase: 22, market: 26 }));
  const m = PS.classifyOffer(both, "رمان كبير 26 شراء 22", "observer", "market");
  assert("«سوق»: the same message → market 26 alone; the number with «شراء» is not a purchase offer", m.market === 26 && m.purchase === undefined && m.dropped.length === 1, JSON.stringify(m));
  const swapped = PS.classifyOffer({ cost_price: 26, market_price: 22 }, "رمان كبير 26 شراء 22", "observer", "market");
  assert("«سوق»: of two numbers the one WITHOUT «شراء» beside it is the market price, whatever the extractor labelled them", swapped.market === 26 && swapped.purchase === undefined, JSON.stringify(swapped));
  const one = PS.classifyOffer({ cost_price: 11, market_price: null }, "شراء رمان 11", "observer", "market");
  assert("«سوق»: «شراء رمان 11» alone → a market observation of 11, «شراء» written or not", one.market === 11 && one.purchase === undefined, JSON.stringify(one));
  const p = PS.classifyOffer({ cost_price: 50, market_price: 62 }, "افوكادو 50 سوق 62", "supplier", "purchase");
  assert("«شراء»: «افوكادو 50 سوق 62» → the purchase offer 50 alone; nothing recorded as a market observation", p.purchase === 50 && p.market === undefined && p.dropped.length === 1, JSON.stringify(p));
  const p2 = PS.classifyOffer({ cost_price: 62, market_price: 50 }, "افوكادو 50 سوق 62", "supplier", "purchase");
  assert("«شراء»: of his two numbers the one WITHOUT «سوق» beside it is the purchase offer, whatever the extractor labelled them", p2.purchase === 50 && p2.market === undefined, JSON.stringify(p2));
  const p1 = PS.classifyOffer({ cost_price: null, market_price: 62 }, "افوكادو سوق 62", "supplier", "purchase");
  assert("«شراء»: a single number is his purchase offer", p1.purchase === 62 && p1.market === undefined, JSON.stringify(p1));
  assert("a number the message does not state is still never kept, whatever the role", PS.classifyOffer({ cost_price: 99 }, "رمان 26", "observer", "market").market === undefined);
  assert("the 02:30 ask follows the role: «سوق» is asked for market prices alone, «شراء» for purchase prices without VAT, none for the prices with no word of «شراء» (§ 51)",
    !/شراء/.test(PS.marketAskText("عمر المجهلي", "market")) && /اسم الصنف كاملاً/.test(PS.marketAskText("عمر المجهلي", "market")) && /أسعار الشراء/.test(PS.marketAskText("خالد", "purchase")) && /بدون ضريبة/.test(PS.marketAskText("خالد", "purchase")) && /الصنف والتعبئة والسعر لكل صنف\.$/.test(PS.marketAskText("عمر")) && !/شراء/.test(PS.marketAskText("عمر")));
}
{
  const env = fresh(`${DAY} 03:00`); cost(500);
  table("res.partner").get(AHMED)!.x_price_role = "purchase";
  table("hr.employee").get(7000 + DRIVER)!.x_price_role = "market";
  const src = await PS.loadPriceSources(env);
  assert("the roles are read from the source's card: Ahmed «شراء» (the partner), Omar «سوق» (the employee, by his Work Contact)", PS.sourceRole(src, AHMED) === "purchase" && PS.sourceRole(src, DRIVER) === "market" && [...PS.marketOnlyPartners(src)].join() === String(DRIVER), JSON.stringify(src.partners.concat(src.employees as any)));
  dp(1, 11, 20);                                                   // Ahmed's purchase 20
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: DRIVER, x_date: DAY, x_purchase_price: 11, x_market_price: 34.5, x_purchase_outlier: false, x_market_outlier: false, x_status: "valid", x_utak_simulation: false });
  const offers = await EN.readDayOffers(env, DAY, src);
  assert("«أقل عرض» counts the «شراء» sources alone: Omar's 11 on his row is not a purchase offer, his 34.5 is a market observation", offers.filter((o: any) => o.kind === "purchase").map((o: any) => o.price).join() === "20" && offers.filter((o: any) => o.kind === "market").map((o: any) => o.price).join() === "34.5", JSON.stringify(offers));
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  const line = rows("x_price_day_line").find((l: any) => l.x_product_tmpl_id === 1) as any;
  assert("…the engine's line: purchase 20 from Ahmed (not 11), market 34.5", line?.x_cost_price === 20 && line.x_supplier_id === AHMED && line.x_market_price === 34.5, JSON.stringify(line));
  table("hr.employee").get(7000 + DRIVER)!.x_price_role = false;
  const legacy = await EN.readDayOffers(env, DAY, await PS.loadPriceSources(env));
  assert("a source without a role keeps what it did (its «شراء» number counts)", legacy.filter((o: any) => o.kind === "purchase").map((o: any) => o.price).sort().join() === "11,20");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fresh(`${DAY} 03:10`); cost(500);
  table("hr.employee").get(7000 + DRIVER)!.x_price_role = "market";
  await PS.writeMarketAskMarker(env, DRIVER_PHONE, DAY, Date.now() - 60_000);
  setExtract({ prices: [{ product_id: 1, packaging_id: 11, cost_price: 22, market_price: 26, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  const reply = await quiet(() => PS.tryMarketReply(env, { partnerId: DRIVER, employeeId: 7000 + DRIVER, name: "عمر المجهلي" }, "+" + DRIVER_PHONE, "طماطم 26 شراء 22", "wamid.R1"));
  setExtract(null);
  const row = rows("x_price_offer")[0] as any;
  assert("Omar («سوق») answers «طماطم 26 شراء 22»: one row, market 26, NO purchase price on it", /وصلتنا أسعار السوق \(1 صنف\)/.test(String(reply)) && rows("x_price_offer").length === 1 && row.x_market_price === 26 && !row.x_purchase_price, JSON.stringify(row));
}
{
  const env = fresh(`${DAY} 03:10`); cost(500);
  table("res.partner").get(AHMED)!.x_price_role = "market";
  setExtract({ prices: [{ product_id: 1, packaging_id: 11, cost_price: 20, market_price: null, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  await quiet(() => SUP.handleSupplierReply(env, { id: AHMED, name: "أحمد حسان", x_supplied_product_ids: [1, 2], x_whatsapp_number: "+" + AHMED_PHONE } as any, "طماطم 20", "wamid.S1"));
  setExtract(null);
  dp(2, 21, 26);                                                   // a purchase row of his, typed in Odoo
  const offers = await EN.readDayOffers(env, DAY, await PS.loadPriceSources(env));
  assert("…and a purchase row of a «سوق» supplier (typed in Odoo) is not a purchase offer either", offers.every((o: any) => o.kind === "market"), JSON.stringify(offers));
  table("x_daily_price").clear();
  assert("a supplier whose role is «سوق»: his number is a market observation (x_price_offer), not a purchase row (x_daily_price)", rows("x_daily_price").length === 0 && rows("x_price_offer").length === 1 && (rows("x_price_offer")[0] as any).x_market_price === 20 && !(rows("x_price_offer")[0] as any).x_purchase_price, JSON.stringify([rows("x_daily_price"), rows("x_price_offer")]));
}
{
  const env = fresh(`${DAY} 02:35`); cost(500);
  table("hr.employee").get(7000 + DRIVER)!.x_price_role = "market";
  openWindow(env, DRIVER_PHONE);
  const r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  // § 51 — inside his window the ask is the Flow, titled by his role (its text, checked above, when the Flow cannot go)
  const sentAsk = sentTo(DRIVER_PHONE)[0] as any;
  const ask = String(sentAsk?.interactive?.body?.text ?? sentAsk?.text?.body ?? "");
  const title = String(sentAsk?.interactive?.action?.parameters?.flow_action_payload?.data?.title ?? "");
  assert("02:30 — Omar («سوق») is asked for the market prices alone (the Flow «أسعار السوق اليوم» since § 51): no «شراء» anywhere in his ask", r.asks?.[0]?.action === "sent" && /أسعار السوق/.test(ask) && title === "أسعار السوق اليوم" && !/شراء/.test(ask + title), JSON.stringify([r, ask, title]));
}
{
  const env = fresh(`${DAY} 03:10`); cost(500);
  table("res.partner").get(AHMED)!.x_price_role = "purchase";
  setExtract({ prices: [{ product_id: 1, packaging_id: 11, cost_price: 20, market_price: 30, available_qty: null, actual_weight_kg: null, notes: null }], unrecognized: [] });
  await quiet(() => SUP.handleSupplierReply(env, { id: AHMED, name: "أحمد حسان", x_supplied_product_ids: [1, 2], x_whatsapp_number: "+" + AHMED_PHONE } as any, "طماطم 20 سوق 30", "wamid.S2"));
  setExtract(null);
  assert("Ahmed («شراء») writes «طماطم 20 سوق 30»: his purchase row 20, and no market observation from him", rows("x_daily_price").length === 1 && (rows("x_daily_price")[0] as any).x_price_sar === 20 && rows("x_price_offer").length === 0, JSON.stringify([rows("x_daily_price"), rows("x_price_offer")]));
  assert("Odoo: Ahmed Hassan (#30) = شراء, Omar (employee #4) = سوق — and no other source is written", JSON.stringify(UI.ROLES_TO_SET.map((r: any) => [r.model, r.id, r.role])) === JSON.stringify([["res.partner", 30, "purchase"], ["hr.employee", 4, "market"]]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

done();
