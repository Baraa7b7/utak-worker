// § 46 أ — «📊 لوحة التسعير» (2026-10-01): each line's real profit — net purchase (§ 47 أ: the
// purchase price as entered, net of VAT whoever the source — never ÷ 1.15), waste, the carton share
// of the day's operating cost (÷ the expected cartons; ÷ the actual average once 7 delivery days
// exist), net sale — and its 🟢 🟡 🔴 ⚪ status; the day's header; written with every engine run and
// every decision (src/pricing-board.ts, src/prices.ts). § 47 ب (the suggested profitable price and
// the rule that reads it) is tests/s47.test.mts; here a line below it is an exception.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s46-board.test.mts

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  COLL_PHONE, CUST, CUST_PHONE, OWNER, employee, graph, heldFor, odooLog, openWindow, partnerOf, quiet, reset, rows, seed, sentTo, setFail, setRiyadh, table, workSchedule,
} from "./wa-harness.mts";
import {
  AHMED, AHMED_PHONE, C1, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, FIX, OMAR_EMP, assert, cost, dayOf, deliveredAt, done, dp, fourLines, fresh, lineFor, market, ownerTexts, rejected, setExtract,
} from "./s46-kit.mts";

const PB = await import("../src/pricing-board.ts");
const PR = await import("../src/prices.ts");
const OC = await import("../src/operating-cost.ts");

// ================================================================ [أ] the rule of a line
console.log("\n[أ] a line of the board: net purchase, waste, carton share, full cost, net sale, real profit");
{
  const g = PB.boardLine({ purchase: 20, sale: 34.5, wastePct: 5, vatRatePct: 15, opShare: 2 });
  assert("the net purchase is the purchase price as entered (20), from the cutoff too", g.x_net_purchase === 20, JSON.stringify(g));
  assert("waste = 5 % × the net purchase = 1.00", g.x_waste_cost === 1, JSON.stringify(g));
  assert("full cost = 20 + 1 + 2 = 23", g.x_full_cost === 23 && g.x_op_share === 2, JSON.stringify(g));
  assert("net sale = 34.5 ÷ 1.15 = 30; the sale shown 34.5", g.x_net_sale === 30 && g.x_board_sale === 34.5, JSON.stringify(g));
  assert("real profit = 30 − 23 = 7 → 🟢", g.x_real_profit === 7 && g.x_board_status === "green", JSON.stringify(g));
  const u = PB.boardLine({ purchase: 23, sale: 34.5, wastePct: 5, vatRatePct: 15, opShare: 2 });
  assert("§ 47 أ — a purchase of 23 is never divided by 1.15: net 23, waste 1.15, full 26.15, profit 3.85", u.x_net_purchase === 23 && u.x_waste_cost === 1.15 && u.x_full_cost === 26.15 && u.x_net_sale === 30 && u.x_real_profit === 3.85, JSON.stringify(u));
  const b = PB.boardLine({ purchase: 23, sale: 34.5, wastePct: 5, vatRatePct: null, opShare: 2 });
  assert("before the cutoff (no VAT): nothing divided — purchase 23, sale 34.5, profit 8.35", b.x_net_purchase === 23 && b.x_net_sale === 34.5 && b.x_full_cost === 26.15 && b.x_real_profit === 8.35, JSON.stringify(b));
  const y = PB.boardLine({ purchase: 18, sale: 23, wastePct: 5, vatRatePct: 15, opShare: 2 });
  assert("🟡 covers the goods and the waste (18.90 ≤ 20) but not the share (20.90)", y.x_board_status === "yellow" && y.x_real_profit === -0.9 && y.x_full_cost === 20.9, JSON.stringify(y));
  const r = PB.boardLine({ purchase: 26, sale: 31.05, wastePct: 5, vatRatePct: 15, opShare: 2 });
  assert("🔴 a loss on the goods themselves (net sale 27 < 26 + 1.30)", r.x_board_status === "red" && r.x_net_purchase === 26 && r.x_waste_cost === 1.3 && r.x_real_profit === -2.3, JSON.stringify(r));
  const z = PB.boardLine({ purchase: 20, sale: 22, wastePct: 0, vatRatePct: null, opShare: 2 });
  assert("real profit exactly 0 is not 🟢 (> 0 only): 🟡", z.x_real_profit === 0 && z.x_board_status === "yellow", JSON.stringify(z));
  const e = PB.boardLine({ purchase: 20, sale: 20, wastePct: 0, vatRatePct: null, opShare: 2 });
  assert("the goods exactly covered (0) is not a loss: 🟡, not 🔴", e.x_board_status === "yellow" && e.x_real_profit === -2, JSON.stringify(e));
  const np = PB.boardLine({ purchase: null, sale: 30, wastePct: 5, vatRatePct: 15, opShare: 2 });
  const nm = PB.boardLine({ purchase: 20, sale: 0, wastePct: 5, vatRatePct: 15, opShare: 2 });
  assert("⚪ without a purchase price, and without a market price", np.x_board_status === "none" && nm.x_board_status === "none" && np.x_real_profit === 0 && nm.x_real_profit === 0, JSON.stringify([np, nm]));
  const nc = PB.boardLine({ purchase: 23, sale: 34.5, wastePct: 5, vatRatePct: 15, opShare: null });
  const ncRed = PB.boardLine({ purchase: 30, sale: 31.05, wastePct: 5, vatRatePct: 15, opShare: null });
  assert("the share unreadable: ⚪ (never a guessed 🟢), but a loss on the goods is still 🔴", nc.x_board_status === "none" && ncRed.x_board_status === "red", JSON.stringify([nc, ncRed]));
  const parts = [g, u, y, r].every((x) => Math.abs(x.x_net_purchase + x.x_waste_cost + x.x_op_share - x.x_full_cost) < 0.005 && Math.abs(x.x_net_sale - x.x_full_cost - x.x_real_profit) < 0.005);
  assert("a card always adds up (the sums are made from the rounded amounts)", parts);
}

console.log("\n[أ] the carton share: the expected cartons, then the actual average after 7 delivery days");
{
  const s = PB.boardShare(496.52, 250, { days: 0, average: null });
  assert("496.52 ÷ 250 = 1.99, basis «expected», the comparison 496.52 ÷ 500 = 0.99", s.share === 1.99 && s.basis === "expected" && s.cartons === 250 && s.share500 === 0.99 && s.note === "", JSON.stringify(s));
  const six = PB.boardShare(500, 250, { days: 6, average: null });
  assert("6 delivery days: still the expected cartons", six.basis === "expected" && six.share === 2, JSON.stringify(six));
  const seven = PB.boardShare(500, 250, { days: 7, average: 100 });
  assert("7 delivery days: ÷ the actual average (100) → 5.00, basis «actual»", seven.basis === "actual" && seven.cartons === 100 && seven.share === 5 && seven.expected === 250, JSON.stringify(seven));
  const empty = PB.boardShare(500, null, { days: 0, average: null });
  assert("the expected cartons empty: no share (null) and the reason, never ÷ 0", empty.share === null && /الكراتين المتوقعة/.test(empty.note) && empty.share500 === 1, JSON.stringify(empty));
  const noCost = PB.boardShare(null, 250, { days: 0, average: null }, "لا جدول دوام للسائق في «الموظفون»");
  assert("the day's cost unreadable: no share and no comparison, with the reason", noCost.share === null && noCost.share500 === null && /تعذّرت/.test(noCost.note) && /جدول دوام/.test(noCost.note), JSON.stringify(noCost));
  assert("the comparison is at 500 cartons, the switch at 7 days", PB.COMPARE_CARTONS === 500 && PB.ACTUAL_DAYS === 7);
}
{
  const env = fresh(`${DAY} 03:00`);
  for (let i = 1; i <= 6; i++) deliveredAt(`2026-09-${20 + i} 05:00:00`, 100);
  deliveredAt("2026-09-20 22:00:00", 10);                                  // 01:00 Riyadh of 09-21: that day's, not a seventh day
  const a6 = await quiet(() => PB.deliveredCartons(env, DAY));
  assert("6 days with real deliveries (by Riyadh time) → days 6, no average", a6.days === 6 && a6.average === null, JSON.stringify(a6));
  deliveredAt("2026-09-27 05:00:00", 170);
  deliveredAt("2026-09-27 06:00:00", 30);                                  // the same day: two orders
  const a7 = await quiet(() => PB.deliveredCartons(env, DAY));
  assert("7 days → the average of their cartons: (6 × 100 + 10 + 200) ÷ 7 = 115.71", a7.days === 7 && a7.average === 115.71, JSON.stringify(a7));
  deliveredAt("2026-09-28 05:00:00", 60, {}, { x_status: "unavailable" });   // short at delivery
  seed("x_daily_order_line", { x_order_id: rows("x_daily_order").at(-1)!.id, x_product_tmpl_id: 2, x_packaging_id: 21, x_quantity: 40, x_status: "delivered" });
  const a8 = await quiet(() => PB.deliveredCartons(env, DAY));
  assert("8 days: the LAST 7 only (09-21 drops out), a line short at delivery not counted: (5 × 100 + 200 + 40) ÷ 7 = 105.71", a8.days === 8 && a8.average === 105.71, JSON.stringify(a8));
  deliveredAt("2026-09-29 05:00:00", 900, { x_utak_simulation: true });
  deliveredAt(`${DAY} 02:30:00`, 900);                                      // the board's own day (05:30 Riyadh): not before it
  deliveredAt("2026-10-02 21:30:00", 700);                                  // 00:30 Riyadh of the board's day
  deliveredAt("2026-09-30 05:00:00", 800, { x_state: "cancelled" });         // a delivery time left on an order that is not delivered
  seed("x_daily_order", { x_customer_id: C1, x_state: "in_delivery", x_order_date: "2026-09-30", x_delivered_at: false });
  const same = await quiet(() => PB.deliveredCartons(env, DAY));
  assert("a simulation order, the board's own day (by Riyadh time) and an order that is not delivered are not counted", same.days === 8 && same.average === 105.71, JSON.stringify(same));
  deliveredAt("2026-06-01 05:00:00", 5000);
  const old = await quiet(() => PB.deliveredCartons(env, DAY));
  assert("a delivery older than the look-back (90 days) is not counted", old.days === 8, JSON.stringify(old));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] the engine writes the board with the prices: the lines and the day's header");
{
  const env = fresh(`${DAY} 03:00`); cost(500); fourLines();
  const r = await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1), c = lineFor(2), p = lineFor(3), o = lineFor(4), d = dayOf();
  assert("the day built: four lines", r.action === "refreshed" && rows("x_price_day_line").length === 4, JSON.stringify(r));
  assert("🟢 tomato: net purchase 20, waste 1, share 2, full 23, sale 34.5, net sale 30, real profit 7",
    t.x_net_purchase === 20 && t.x_waste_cost === 1 && t.x_op_share === 2 && t.x_full_cost === 23 && t.x_board_sale === 34.5 && t.x_net_sale === 30 && t.x_real_profit === 7 && t.x_board_status === "green", JSON.stringify(t));
  assert("🔴 cucumber (an exception: the market 31.05 below the suggested 36.00): the board prices it at the market price — a loss on the goods", c.x_status === "exception" && c.x_sale_price === 0 && c.x_board_sale === 31.05 && c.x_board_status === "red" && c.x_real_profit === -2.3 && c.x_reason === "سعر السوق 31.05 أقل من السعر المربح 36", JSON.stringify(c));
  // § 47 ب — a line that does not cover its share is below the suggested price: an exception now (it was approved automatically in § 46)
  assert("🟡 potato: an exception (the market 23 below the suggested 26.50); its card at the market price covers the goods, not its share", p.x_status === "exception" && p.x_sale_price === 0 && p.x_board_sale === 23 && p.x_board_status === "yellow" && p.x_real_profit === -0.9, JSON.stringify(p));
  assert("⚪ onion: no purchase and no market", o.x_status === "exception" && o.x_board_status === "none" && o.x_real_profit === 0 && o.x_full_cost === 0, JSON.stringify(o));
  assert("the header: cost 500, expected 250, share 2.00 on the expected cartons, 1.00 at 500 cartons", d.x_op_cost === 500 && d.x_op_expected === 250 && d.x_op_cartons === 250 && d.x_op_basis === "expected" && d.x_op_share === 2 && d.x_op_share_500 === 1, JSON.stringify(d));
  assert("the header: 🟢 1 · 🟡 1 · 🔴 1 · ⚪ 1, no note, the time of the update", d.x_n_green === 1 && d.x_n_yellow === 1 && d.x_n_red === 1 && d.x_n_none === 1 && !d.x_board_note && d.x_board_at === "2026-10-03 00:00:00", JSON.stringify(d));
  assert("the profitable line: sale = market (34.5 ≥ the suggested 29.00), the engine's unit profit 34.5 ÷ 1.15 − 20 − 1 = 9.00, auto", t.x_sale_price === 34.5 && t.x_market_price === 34.5 && t.x_unit_profit === 9 && t.x_status === "auto" && t.x_cost_price === 20 && t.x_suggested_price === 29, JSON.stringify(t));
  const again = await quiet(() => PR.refreshPriceDay(env));
  assert("nothing changed → the next tick writes nothing («unchanged»)", again.action === "unchanged", JSON.stringify(again));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fresh(`${DAY} 03:00`); cost(500); fourLines();
  table("res.partner").get(AHMED)!.x_vat_registered = false;
  await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1);
  assert("§ 47 أ — the source that won the purchase is NOT registered: the same card (net purchase 20, profit 7)", t.x_net_purchase === 20 && t.x_waste_cost === 1 && t.x_real_profit === 7 && t.x_board_status === "green" && t.x_status === "auto", JSON.stringify(t));
}
{
  const env = fresh("2026-09-30 03:00"); cost(500);
  dp(1, 11, 23, "2026-09-30"); market(1, 11, 34.5, "2026-09-30");
  await quiet(() => PR.refreshPriceDay(env));
  const t = lineFor(1, "2026-09-30");
  assert("a price day before 2026-10-01: nothing is divided by 1.15 (purchase 23, net sale 34.5, profit 8.35)", t.x_net_purchase === 23 && t.x_net_sale === 34.5 && t.x_real_profit === 8.35, JSON.stringify(t));
}
{
  const env = fresh(`${DAY} 03:00`); cost(500); fourLines();
  for (let i = 1; i <= 7; i++) deliveredAt(`2026-09-${20 + i} 05:00:00`, 100);
  await quiet(() => PR.refreshPriceDay(env));
  const d = dayOf(), t = lineFor(1);
  assert("7 delivery days: the share is 500 ÷ 100 = 5.00 on the actual average, and the header says so", d.x_op_basis === "actual" && d.x_op_cartons === 100 && d.x_op_share === 5 && d.x_op_expected === 250 && d.x_op_share_500 === 1, JSON.stringify(d));
  assert("…and the line uses it: full cost 20 + 1 + 5 = 26, real profit 4", t.x_op_share === 5 && t.x_full_cost === 26 && t.x_real_profit === 4, JSON.stringify(t));
}
{
  const env = fresh(`${DAY} 03:00`); fourLines();
  seed("x_operating_cost", { x_name: "صيانة", x_cost_type: "fixed", x_frequency: "monthly", x_amount: 2600, x_date_from: "2026-01-01", x_date_to: false, x_utak_simulation: false });
  table("hr.employee").get(OMAR_EMP)!.resource_calendar_id = false;      // no driver schedule → the cost is «تعذّر»
  await quiet(() => PR.refreshPriceDay(env));
  const d = dayOf();
  assert("the day's cost «تعذّر»: no share, the note says why, 🟢 / 🟡 become ⚪ and the loss on the goods stays 🔴",
    d.x_op_cost === 0 && d.x_op_share === 0 && /تعذّرت/.test(String(d.x_board_note)) && lineFor(1).x_board_status === "none" && lineFor(3).x_board_status === "none" && lineFor(2).x_board_status === "red"
    && d.x_n_green === 0 && d.x_n_red === 1 && d.x_n_none === 3, JSON.stringify(d));
  assert("…and the engine still priced the day (the board never blocks it)", lineFor(1).x_status === "auto" && lineFor(1).x_sale_price === 34.5);
}
{
  const env = fresh(`${DAY} 03:00`); cost(500); fourLines();
  table("x_pricing_config").get(1)!.x_expected_cartons = false;
  await quiet(() => PR.refreshPriceDay(env));
  const d = dayOf();
  assert("«الكراتين المتوقعة يومياً» empty: no share, the note names the setting", d.x_op_share === 0 && d.x_op_expected === 0 && /الكراتين المتوقعة يومياً/.test(String(d.x_board_note)) && lineFor(1).x_board_status === "none", JSON.stringify(d));
  const s = await quiet(() => OC.readPricingSettings(env, DAY));
  assert("readPricingSettings: expectedCartons null when empty, 250 when set", s?.expectedCartons === null, JSON.stringify(s));
  table("x_pricing_config").get(1)!.x_expected_cartons = 250;
  assert("…250", (await quiet(() => OC.readPricingSettings(env, DAY)))?.expectedCartons === 250);
}

console.log("\n[أ] the board follows the day's cost and Baraa's decisions");
{
  const env = fresh(`${DAY} 03:00`); const c1 = cost(500); fourLines();
  await quiet(() => PR.refreshPriceDay(env));
  table("x_operating_cost").get(c1)!.x_amount = 1000;
  const soon = await quiet(() => PR.refreshPriceDay(env));
  assert("a cost changed: not read again within 15 minutes (the tick stays light)", soon.action === "unchanged" && dayOf().x_op_share === 2, JSON.stringify(soon));
  setRiyadh(`${DAY} 03:20`);
  const later = await quiet(() => PR.refreshPriceDay(env));
  assert("…after 15 minutes the board is rewritten: share 4.00, tomato's profit 5, potato still 🟡", later.action === "refreshed" && dayOf().x_op_share === 4 && dayOf().x_op_cost === 1000 && lineFor(1).x_real_profit === 5 && lineFor(1).x_full_cost === 25, JSON.stringify([later, dayOf()]));
  table("x_operating_cost").get(c1)!.x_amount = 250;
  const forced = await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("«🔄 إعادة الحساب» (force) reads the cost at once: share 1.00, potato turns 🟢 (20 − 19.90 = 0.10)", forced.action === "refreshed" && dayOf().x_op_share === 1 && lineFor(3).x_board_status === "green" && lineFor(3).x_real_profit === 0.1, JSON.stringify(lineFor(3)));
}
{
  const env = fresh(`${DAY} 04:00`); cost(500); fourLines();
  await quiet(() => PR.refreshPriceDay(env));
  const c = lineFor(2);
  const e1 = await quiet(() => PR.handlePriceExceptionButton(env, `pexc_e_${c.id}`));
  setRiyadh(`${DAY} 04:05`);
  const e2 = await quiet(() => PR.handlePriceEditReply(env, "40"));
  const c2 = lineFor(2), d = dayOf();
  assert("«عدّل» 40 on the 🔴 cucumber: the decision is written …", /أرسل سعر البيع/.test(e1) && /يُنشر بـ 40/.test(String(e2)) && c2.x_status === "manual" && c2.x_sale_price === 40, JSON.stringify(c2));
  assert("…and its card follows at once: sale 40, net sale 34.78, real profit 34.78 − 29.30 = 5.48 → 🟢", c2.x_board_sale === 40 && c2.x_net_sale === 34.78 && c2.x_real_profit === 5.48 && c2.x_board_status === "green", JSON.stringify(c2));
  assert("…and the header's counts: 🟢 2 · 🟡 1 · 🔴 0 · ⚪ 1", d.x_n_green === 2 && d.x_n_yellow === 1 && d.x_n_red === 0 && d.x_n_none === 1, JSON.stringify(d));
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("the engine's next run keeps his price on the card (sale 40, 🟢 5.48)", lineFor(2).x_board_sale === 40 && lineFor(2).x_real_profit === 5.48 && lineFor(2).x_board_status === "green" && dayOf().x_n_green === 2, JSON.stringify(lineFor(2)));
  const o = lineFor(4);
  await quiet(() => PR.handlePriceExceptionButton(env, `pexc_s_${lineFor(1).id}`));
  const t = lineFor(1);
  assert("«لا تنشر» on tomato: not published (sale 0), its card still shows what the market price would earn (🟢 7)", t.x_status === "unpublished" && t.x_sale_price === 0 && t.x_board_sale === 34.5 && t.x_real_profit === 7 && t.x_board_status === "green", JSON.stringify(t));
  assert("a line nobody decided on is not rewritten by a decision elsewhere", JSON.stringify(lineFor(4)) === JSON.stringify(o));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[أ] a locked day: the engine leaves it; rewriteBoard fills its board fields only");
{
  const env = fresh(`${DAY} 09:00`); cost(500);
  const d = seed("x_price_day", { x_date: DAY, x_state: "published", x_name: `أسعار اليوم ${DAY}`, x_utak_simulation: false });
  const l = seed("x_price_day_line", { x_day_id: d, x_sequence: 1, x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_cost_price: 20, x_market_price: 34.5, x_sale_price: 34.5, x_status: "auto", x_excluded: false, x_blocked: false });
  const before = JSON.stringify(table("x_price_day_line").get(l));
  const r = await quiet(() => PR.refreshPriceDay(env, { force: true }));
  assert("the engine: «locked», nothing written on a published day", r.action === "locked" && JSON.stringify(table("x_price_day_line").get(l)) === before, JSON.stringify(r));
  const dry = await quiet(() => PR.rewriteBoard(env, d, { dry: true }));
  assert("rewriteBoard dry: the values are returned and nothing is written", dry.updated === 1 && dry.values?.[0]?.x_real_profit === 7 && dry.header?.x_op_share === 2 && JSON.stringify(table("x_price_day_line").get(l)) === before && table("x_price_day").get(d)!.x_op_share === undefined, JSON.stringify(dry));
  odooLog.length = 0;
  const w = await quiet(() => PR.rewriteBoard(env, d));
  const lineWrites = odooLog.filter((x) => x.model === "x_price_day_line" && x.method === "write");
  const dayWrites = odooLog.filter((x) => x.model === "x_price_day" && x.method === "write");
  const row = table("x_price_day_line").get(l)! as any;
  assert("rewriteBoard: the card is filled (🟢 7) and the header written", w.updated === 1 && w.counts.green === 1 && row.x_real_profit === 7 && row.x_board_status === "green" && table("x_price_day").get(d)!.x_n_green === 1, JSON.stringify(w));
  assert("…writing the board's fields ONLY (the lock's watched fields and the prices are never in the write)", lineWrites.length === 1 && Object.keys(lineWrites[0].body.vals).every((k) => (PB.BOARD_LINE_FIELDS as readonly string[]).includes(k))
    && dayWrites.length === 1 && Object.keys(dayWrites[0].body.vals).every((k) => /^x_(op_|n_|board_)/.test(k)), JSON.stringify([lineWrites.map((x) => x.body.vals), dayWrites.map((x) => x.body.vals)]));
  assert("…the day's state and its prices as they were", table("x_price_day").get(d)!.x_state === "published" && row.x_sale_price === 34.5 && row.x_cost_price === 20 && row.x_status === "auto");
  const again = await quiet(() => PR.rewriteBoard(env, d));
  assert("a second run writes no line (idempotent)", again.updated === 0, JSON.stringify(again));
}

console.log("\n[أ] the customers' message carries nothing of the board");
{
  const lines = [{ productName: "طماطم", packagingName: "كرتون", salePrice: 34.5 }];
  const msg = PR.buildPriceMessages(DAY, lines).join("\n");
  assert("sale price and packaging only: no cost, no profit, no status", /طماطم \(كرتون\): 34.50? ر\.س/.test(msg) && !/الربح|التكلفة|🟢|🟡|🔴|الشراء/.test(msg), msg);
}

console.log("\n[أ] the Odoo screen (scripts/s46-20261001-board.mjs): Arabic, read-only, standard views, opens on today without creating");
{
  const src = readFileSync(new URL("../scripts/s46-20261001-board.mjs", import.meta.url), "utf8");
  // § 47 — the card and the list live in scripts/lib/s47-odoo-views.mjs (one source for § 46's script and § 47's)
  const lib = readFileSync(new URL("../scripts/lib/s47-odoo-views.mjs", import.meta.url), "utf8");
  const card = lib.split('t-name="card"')[1].split("</t>")[0] + lib.split("export const CARD")[1].split("const kanbanView")[0];
  assert("the menu «📊 لوحة التسعير» under UTAK, and 250 expected cartons", src.includes('menu: "📊 لوحة التسعير"') && /EXPECTED_CARTONS = 250/.test(src));
  assert("the board form is read-only (no create / edit / delete) and its lines are cards (kanban)", /<form string="لوحة التسعير" create="0" delete="0" edit="0">/.test(src) && /<field name="x_line_ids" mode="kanban" readonly="1">/.test(src));
  assert("a card shows the net purchase, the full cost, the sale and the real profit, coloured by its status", ["x_net_purchase", "x_full_cost", "x_board_sale", "x_real_profit"].every((f) => card.includes(`name="${f}"`)) && /border-success/.test(card) && /border-warning/.test(card) && /border-danger/.test(card) && /import \{[^}]*\bCARD\b[^}]*\} from "\.\/lib\/s47-odoo-views\.mjs"/.test(src));
  assert("the colour is a side border and the status is plain words: no filled badge, no fixed text colour (readable in the light and the dark mode)",
    !/style="[^"]*color/.test(src + lib) && !/text-(white|black|dark|light|bg-)/.test(src + lib) && !/widget="badge"/.test(card) && /<field name="x_board_status" class="text-nowrap ms-2"\/>/.test(card));
  assert("a list and a bar graph of each line's real profit, for the day opened", /<graph string="الربح الحقيقي لكل صنف" type="bar"/.test(src) && src.includes(`domain: "[('x_day_id', '=', active_id)]"`));
  assert("the previous / next day skip simulation days, and «اليوم» opens today", (src.match(/\('x_utak_simulation', '=', False\)/g) ?? []).length >= 4 && /اليوم السابق/.test(src) && /اليوم التالي/.test(src));
  assert("opening the board never creates a price day", !/CODE\.open[\s\S]*\.create\(/.test(src.split("export const CODE")[1].split("const ctx")[0]));
  assert("no module is installed by the script", !/button_immediate_install|ir\.module\.module", "write"/.test(src));
}

// ================================================================ [س]
console.log("\n[س] schema");
assert("no Odoo field or value outside the schema in the whole run", rejected.length === 0, rejected.join(" | "));
{
  const f = FIX[FIX.length - 1];
  assert("the fixture (read-only fields_get) names the board's fields and x_expected_cartons",
    ["x_net_purchase", "x_waste_cost", "x_op_share", "x_full_cost", "x_board_sale", "x_net_sale", "x_real_profit", "x_board_status"].every((k) => f.x_price_day_line.includes(k))
    && ["x_op_cost", "x_op_expected", "x_op_cartons", "x_op_basis", "x_op_share", "x_op_share_500", "x_n_green", "x_n_yellow", "x_n_red", "x_n_none", "x_board_note", "x_board_at"].every((k) => f.x_price_day.includes(k))
    && f.x_pricing_config.includes("x_expected_cartons"));
  assert("…and the board status / basis values", JSON.stringify(f._selections["x_price_day_line.x_board_status"]) === '["green","yellow","red","none"]' && JSON.stringify(f._selections["x_price_day.x_op_basis"]) === '["expected","actual"]');
  const idx = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert("*/5: the prices tick (the engine that writes the board) runs", /runPricesTick\(env, Date\.now\(\), ctx\)/.test(idx.split('case "*/5 * * * *": {')[1]));
}

done();
