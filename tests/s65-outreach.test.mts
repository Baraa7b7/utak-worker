// § 65 هـ (2026-10-07) — the approved suppliers' periodic check-in (OFF by default), and their cards' numbers.
//
//   [هـ1] the calendar: a Sunday, the first of the month, a season that covers the month
//   [هـ2] OFF by default: no message, whatever the day and the hour
//   [هـ3] on: 09:00–18:00 only, on a due day only, an APPROVED supplier of a due cadence only
//   [هـ4] the message, the template outside the window, «التواصل القادم», and never twice
//   [هـ5] a farmer inside his season: every Sunday
//   [هـ6] the numbers: «نسبة الرد», «فرق سعره عن وسيط السوق», «آخر سعر/عرض», the capacity's last price
//   [هـ7] the tick: once a day, never before 09:00
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s65-outreach.test.mts

import { readFileSync } from "node:fs";
import { OWNER, heldFor, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, table } from "./wa-harness.mts";
import { AHMED, assert, done, fresh, rejected } from "./s46-kit.mts";

const OUT = await import("../src/supplier-outreach.ts");
const REG = await import("../src/supplier-registry.ts");
const OFF = await import("../src/supplier-offer.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { withAutoSendJob } = await import("../src/auto-send-guard.ts");
const LIB = await import("../scripts/lib/s65-flows.mjs");
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

const SUNDAY = "2026-10-04", MONDAY = "2026-10-05", FIRST = "2026-11-01" /* a Sunday too */, DEC1 = "2026-12-01" /* a Tuesday */;
const DIST = 7801, IMP = 7802, FARM = 7803, AGENT = 7804, PEND = 7805, STOP = 7806;
const phone = (id: number) => `9665555${id}`;
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const partner = (id: number) => table("res.partner").get(id) as any;
const run = (env: any) => quiet(() => OUT.runSupplierOutreachTick(withAutoSendJob(env, OUT.OUTREACH_JOB), Date.now()));
/** The tenant's shape and six suppliers of the registry; `on` = «تفعيل تواصل الموردين». */
function world(riyadh: string, on: boolean): any {
  const env = fresh(riyadh);
  table("x_pricing_config").get(1)!.x_supplier_outreach = on;
  const sup = (id: number, name: string, extra: Record<string, unknown>) => seed("res.partner", { id, name, x_whatsapp_number: "+" + phone(id), x_supplier_state: "approved", ...extra });
  sup(DIST, "موزع الفطر", { x_supplier_type: "distributor", x_contact_cadence: "weekly" });
  sup(IMP, "شركة الاستيراد", { x_supplier_type: "importer", x_contact_cadence: "weekly" });
  sup(FARM, "مزرعة الخير", { x_supplier_type: "farmer", x_contact_cadence: "monthly" });
  sup(AGENT, "وكيل السوق", { x_supplier_type: "market_agent", x_contact_cadence: "daily" });
  sup(PEND, "بانتظار", { x_supplier_type: "distributor", x_contact_cadence: "weekly", x_supplier_state: "pending" });
  sup(STOP, "موقوف", { x_supplier_type: "distributor", x_contact_cadence: "weekly", x_supplier_state: "suspended" });
  for (const id of [DIST, IMP, FARM, AGENT, PEND, STOP]) openWindow(env, phone(id), 0);
  return env;
}
const all = () => [DIST, IMP, FARM, AGENT, PEND, STOP].flatMap((id) => sentTo(phone(id)));

console.log("\n[هـ1] the calendar");
{
  assert("2026-10-04 is a Sunday, 2026-10-05 is not; the first of a month is its day «01»", OUT.isSunday(SUNDAY) && !OUT.isSunday(MONDAY) && OUT.isFirstOfMonth(FIRST) && !OUT.isFirstOfMonth(SUNDAY));
  assert("the Sunday after a Sunday is a week later; the first after a first is the next month's", OUT.nextSunday(SUNDAY) === "2026-10-11" && OUT.nextSunday(MONDAY) === "2026-10-11" && OUT.nextFirst(FIRST) === "2026-12-01" && OUT.nextFirst("2026-12-15") === "2027-01-01");
  assert("a season November → March covers December and February, not June; one month alone covers that month", OUT.seasonCovers("11", "03", 12) && OUT.seasonCovers("11", "03", 2) && !OUT.seasonCovers("11", "03", 6) && OUT.seasonCovers("05", false, 5) && !OUT.seasonCovers("05", false, 6) && !OUT.seasonCovers(false, "03", 2));
  assert("weekly: due on a Sunday, next the Sunday after", JSON.stringify(OUT.dueOn("weekly", false, SUNDAY)) === JSON.stringify({ due: true, next: "2026-10-11" }) && OUT.dueOn("weekly", false, MONDAY).due === false);
  assert("monthly outside the season: due on the first alone, next the first after", JSON.stringify(OUT.dueOn("monthly", false, DEC1)) === JSON.stringify({ due: true, next: "2027-01-01" }) && OUT.dueOn("monthly", false, SUNDAY).due === false);
  assert("monthly inside the season: every Sunday as well, next whichever comes first", OUT.dueOn("monthly", true, SUNDAY).due === true && OUT.dueOn("monthly", true, SUNDAY).next === "2026-10-11" && OUT.dueOn("monthly", true, "2026-10-25").next === "2026-11-01" && OUT.dueOn("monthly", true, "2026-11-29").next === "2026-12-01" && OUT.dueOn("monthly", true, MONDAY).due === false);
  assert("daily, on demand, none: never due", ["daily", "on_demand", null].every((c) => OUT.dueOn(c as any, true, SUNDAY).due === false && OUT.dueOn(c as any, true, FIRST).next === null));
  assert("the check-in template: UTILITY's text, ONE variable (his name), ONE «عرض مورد» button — the word that opens the offer form", LIB.SUPPLIER_CHECKIN.name === "utak_supplier_checkin_v1" && LIB.SUPPLIER_CHECKIN.purpose === OUT.CHECKIN_PURPOSE && LIB.SUPPLIER_CHECKIN.params === 1 && OFF.offerTrigger({ text: LIB.SUPPLIER_CHECKIN.buttons[0].text }) === "ready" && OFF.offerTrigger({ text: "x", buttonId: OUT.CHECKIN_BUTTON.id }) === "ready");
}

console.log("\n[هـ2] OFF by default");
{
  const env = world(`${SUNDAY} 10:00`, false);
  const r = await run(env);
  assert("the switch off on a Sunday at 10:00: nothing is sent, nobody's «التواصل القادم» is written", r.action === "off" && all().length === 0 && !partner(DIST).x_next_contact);
  delete (table("x_pricing_config").get(1) as any).x_supplier_outreach;
  assert("a settings row that carries no value at all is off", (await run(env)).action === "off" && all().length === 0);
  assert("the field is the settings' «تفعيل تواصل الموردين»", OUT.OUTREACH_FIELD === "x_supplier_outreach" && srcOf("supplier-outreach.ts").includes("return r?.[OUTREACH_FIELD] === true;"));
}

console.log("\n[هـ3] on: the hours, the due day, who");
{
  for (const [hm, want] of [["08:55", "outside"], ["18:00", "outside"], ["23:30", "outside"], ["02:00", "outside"]] as const) {
    const env = world(`${SUNDAY} ${hm}`, true);
    const r = await run(env);
    assert(`${hm} on a Sunday, the switch on: nothing (outside 09:00–18:00)`, r.action === want && all().length === 0);
  }
  const mon = world(`${MONDAY} 10:00`, true);
  const before = odooLog.length;
  const rm = await run(mon);
  assert("a Monday that is not the first: nothing is due — and nothing is even read", rm.action === "not_due_day" && all().length === 0 && odooLog.length === before);
  const env = world(`${SUNDAY} 09:00`, true);
  const r = await run(env);
  const got = (r.steps ?? []).map((s: any) => s.partnerId).sort();
  assert("09:00 on a Sunday: the distributor and the importer (weekly) — not the farmer (monthly, out of season), not the daily agent", r.action === "ran" && JSON.stringify(got) === JSON.stringify([DIST, IMP]) && sentTo(phone(FARM)).length === 0 && sentTo(phone(AGENT)).length === 0, JSON.stringify(r));
  assert("…never a supplier «بانتظار الاعتماد» or «موقوف»", sentTo(phone(PEND)).length === 0 && sentTo(phone(STOP)).length === 0);
  const sim = world(`${SUNDAY} 10:00`, true);
  Object.assign(partner(DIST), { x_utak_simulation: true });
  Object.assign(partner(IMP), { x_whatsapp_number: false });
  const rs = await run(sim);
  assert("a simulated card is not written to; a card with no number is «no_number»", sentTo(phone(DIST)).length === 0 && (rs.steps ?? []).some((s: any) => s.partnerId === IMP && s.action === "no_number") && sentTo(phone(IMP)).length === 0);
}

console.log("\n[هـ4] the message, the template, «التواصل القادم», never twice");
{
  const env = world(`${SUNDAY} 10:00`, true);
  await run(env);
  const m = sentTo(phone(DIST)) as any[];
  assert("inside his window: ONE short message with ONE button «📦 عرض مورد»", m.length === 1 && m[0].interactive.type === "button" && JSON.stringify(m[0].interactive.action.buttons.map((b: any) => [b.reply.id, b.reply.title])) === JSON.stringify([["sup_offer:ready", "📦 عرض مورد"]]) && bodyOf(m[0]) === OUT.checkinText("موزع الفطر") && bodyOf(m[0]).startsWith("مرحبا موزع 🌿") && [...bodyOf(m[0])].length < 160);
  assert("…no price in it, and nothing of ours but the question", !/\d/.test(bodyOf(m[0])));
  assert("«التواصل القادم» moves to next Sunday", partner(DIST).x_next_contact === "2026-10-11" && partner(IMP).x_next_contact === "2026-10-11");
  const again = await run(env);
  assert("five minutes later: nobody is written to again (his «التواصل القادم» is after today)", again.action === "none" && sentTo(phone(DIST)).length === 1 && sentTo(phone(IMP)).length === 1);
  // the claim alone stops a second attempt even when the date could not be written
  partner(DIST).x_next_contact = false;
  const third = await run(env);
  assert("…and ONE attempt a supplier a due day, even if his date was lost", (third.steps ?? []).every((s: any) => s.action === "claimed_before") && sentTo(phone(DIST)).length === 1);
  setRiyadh("2026-10-11 10:00");
  for (const id of [DIST, IMP]) openWindow(env, phone(id), 0);
  await run(env);
  assert("the next Sunday he is written to again, and the date moves on", sentTo(phone(IMP)).length === 2 && partner(IMP).x_next_contact === "2026-10-18");

  // outside his window: the template, while APPROVED and UTILITY
  const env2 = fresh(`${SUNDAY} 10:00`);
  table("x_pricing_config").get(1)!.x_supplier_outreach = true;
  seed("res.partner", { id: DIST, name: "موزع الفطر", x_whatsapp_number: "+" + phone(DIST), x_supplier_state: "approved", x_contact_cadence: "weekly" });
  const r2 = await run(env2);
  assert("outside his window with no usable template: nothing is sent, nothing is held, and his date does NOT move (he was not contacted)", (r2.steps ?? [])[0]?.action === "not_sent" && sentTo(phone(DIST)).length === 0 && heldFor(env2, phone(DIST)).length === 0 && !partner(DIST).x_next_contact, JSON.stringify(r2));
  const env3 = fresh(`${SUNDAY} 10:00`);
  table("x_pricing_config").get(1)!.x_supplier_outreach = true;
  seed("res.partner", { id: DIST, name: "موزع الفطر", x_whatsapp_number: "+" + phone(DIST), x_supplier_state: "approved", x_contact_cadence: "weekly" });
  seed("x_whatsapp_template", { id: 9652, x_purpose: "supplier_checkin", x_meta_template_id: "utak_supplier_checkin_v1", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  const r3 = await run(env3);
  const t = sentTo(phone(DIST)) as any[];
  assert("…with the template APPROVED and UTILITY: utak_supplier_checkin_v1 with his name, and the date moves", (r3.steps ?? [])[0]?.action === "template" && t.length === 1 && t[0].template.name === "utak_supplier_checkin_v1" && JSON.stringify(t[0].template.components.find((c: any) => c.type === "body").parameters.map((p: any) => p.text)) === JSON.stringify(["موزع الفطر"]) && partner(DIST).x_next_contact === "2026-10-11", JSON.stringify(t[0]?.template));
  table("x_whatsapp_template").get(9652)!.x_category = "MARKETING";
  assert("the check-in is never held, and its purpose is operational (a MARKETING template is not sent for it)", PURPOSES[OUT.CHECKIN_PURPOSE].kind === "operational" && heldFor(env3, phone(DIST)).length === 0);
  assert("Baraa's own number is never checked in on", (() => { seed("res.partner", { id: 7899, name: "براء", x_whatsapp_number: "+" + OWNER, x_supplier_state: "approved", x_contact_cadence: "weekly" }); return true; })() && (await run(env3)).steps?.some((s: any) => s.partnerId === 7899 && s.action === "no_number") === true && sentTo(OWNER).filter((b: any) => b?.interactive?.type === "button").length === 0);
}

console.log("\n[هـ5] a farmer");
{
  const env = world(`${SUNDAY} 10:00`, true); // October
  seed("x_supplier_season", { x_partner_id: FARM, x_month_from: "09", x_month_to: "11" });
  const r = await run(env);
  assert("inside his season (September → November) he is written to on a Sunday, and next Sunday is his next", (r.steps ?? []).some((s: any) => s.partnerId === FARM && s.action === "session") && sentTo(phone(FARM)).length === 1 && partner(FARM).x_next_contact === "2026-10-11");
  const env2 = world(`${DEC1} 10:00`, true); // a Tuesday, the first of December: out of his season
  seed("x_supplier_season", { x_partner_id: FARM, x_month_from: "09", x_month_to: "11" });
  const r2 = await run(env2);
  assert("out of his season: on the first of the month alone — and the weekly suppliers are not due on a Tuesday", JSON.stringify((r2.steps ?? []).map((s: any) => s.partnerId)) === JSON.stringify([FARM]) && partner(FARM).x_next_contact === "2027-01-01" && sentTo(phone(DIST)).length === 0);
  const env3 = world(`${SUNDAY} 10:00`, true);
  seed("x_supplier_season", { x_partner_id: FARM, x_month_from: "09", x_month_to: "11", x_utak_simulation: true });
  await run(env3);
  assert("a simulated season makes no season", sentTo(phone(FARM)).length === 0);
}

console.log("\n[هـ6] the numbers");
{
  assert("«نسبة الرد»: of the days we wrote to him, the share on which he wrote back", OUT.replyRate(["2026-10-01", "2026-10-02", "2026-10-02", "2026-10-03", "2026-10-04"], ["2026-10-02", "2026-10-04", "2026-09-01"]) === 50 && OUT.replyRate([], ["2026-10-02"]) === null && OUT.replyRate(["2026-10-01"], []) === 0);
  assert("«فرق سعره عن وسيط السوق»: the average of (his − the market's) ÷ the market's; nothing to compare = none", OUT.priceGap([{ his: 33, market: 30 }, { his: 27, market: 30 }, { his: 36, market: 30 }]) === 6.7 && OUT.priceGap([{ his: 10, market: 0 }]) === null && OUT.priceGap([]) === null);
  const env = fresh("2026-10-06 10:00");
  Object.assign(table("res.partner").get(AHMED)!, { x_supplier_state: "approved" });
  const msg = (dir: string, date: string, extra: Record<string, unknown> = {}) => seed("x_wa_message", { x_partner_id: AHMED, x_direction: dir, x_status: dir === "out" ? "delivered" : "received", create_date: date, ...extra });
  // the days are Riyadh's: we wrote on 10-02, 10-04 (22:00 UTC of 10-03 is 01:00 of 10-04) and 10-05; he wrote back on 10-02 and
  // on 10-04 (01:00 UTC of 10-04 is 04:00 Riyadh, the same Riyadh day as our message — another UTC day)
  msg("out", "2026-10-02 08:00:00"); msg("in", "2026-10-02 09:00:00"); msg("out", "2026-10-03 22:00:00"); msg("in", "2026-10-04 01:00:00"); msg("out", "2026-10-05 05:00:00");
  msg("out", "2026-10-05 23:05:00", { x_status: "failed" }); msg("out", "2026-09-30 23:05:00", { x_utak_simulation: true });
  const day = (date: string) => seed("x_price_day", { x_date: date });
  const line = (date: string, product: number, pack: number, mkt: number) => seed("x_price_day_line", { x_day_id: day(date), x_day_date: date, x_product_tmpl_id: product, x_packaging_id: pack, x_market_price: mkt });
  line("2026-10-04", 1, 11, 23); line("2026-10-05", 1, 11, 23);
  seed("x_daily_price", { x_supplier_id: AHMED, x_product_tmpl_id: 1, x_packaging_id: 11, x_date: "2026-10-04", x_price_sar: 20 });   // 23.00 against 23 → 0 %
  seed("x_daily_price", { x_supplier_id: AHMED, x_product_tmpl_id: 1, x_packaging_id: 11, x_date: "2026-10-05", x_price_sar: 22 });   // 25.30 against 23 → +10 %
  seed("x_daily_price", { x_supplier_id: AHMED, x_product_tmpl_id: 2, x_packaging_id: 21, x_date: "2026-10-05", x_price_sar: 8 });    // no market price that day: left out
  seed("x_price_offer", { x_source_partner_id: AHMED, x_product_tmpl_id: 1, x_packaging_id: 11, x_date: "2026-10-05", x_purchase_price: 90, x_market_price: 0, x_special: true, x_item_text: "عرض" }); // «خاص»: another unit
  seed("x_supplier_capacity", { id: 8801, x_partner_id: AHMED, x_product_tmpl_id: 1, x_qty: 50, x_per: "day" });
  seed("x_supplier_capacity", { id: 8802, x_partner_id: AHMED, x_product_tmpl_id: 4, x_qty: 10, x_per: "batch" });
  const r = await quiet(() => OUT.refreshSupplierIndicators(env));
  const a = table("res.partner").get(AHMED) as any;
  assert("Ahmad: we wrote on three days (a failed send and a simulated row are not days), he answered on two → 66.7 %", a.x_reply_rate === 66.7, String(a.x_reply_rate));
  assert("…his purchase prices × 1.15 against the day's market price: (0 % + 10 %) ÷ 2 = 5 % — a «خاص» row and a day with no market price are left out", a.x_price_gap_pct === 5, String(a.x_price_gap_pct));
  assert("…«آخر سعر/عرض»: the newest thing he sent, with its day", /— 2026-10-05$/.test(String(a.x_last_offer_text)) && r.action === "written", String(a.x_last_offer_text));
  const k1 = table("x_supplier_capacity").get(8801) as any, k2 = table("x_supplier_capacity").get(8802) as any;
  assert("his «طاقة المورد» row of the item carries his last price of it and its day; a row of an item he never priced is left", k1.x_last_price === 22 && k1.x_last_price_date === "2026-10-05" && !k2.x_last_price, JSON.stringify([k1, k2]));
  const writes = odooLog.filter((l) => l.method === "write").length;
  const again = await quiet(() => OUT.refreshSupplierIndicators(env));
  assert("a second pass writes nothing: a number is written only when it changed", again.action === "unchanged" && odooLog.filter((l) => l.method === "write").length === writes);
  assert("the numbers never send anything", sentTo("966500000801").length === 0 && rejected.length === 0, rejected.join(" | "));
}

console.log("\n[هـ7] the tick");
{
  const env = fresh("2026-10-06 08:55");
  Object.assign(table("res.partner").get(AHMED)!, { x_supplier_state: "approved" });
  seed("x_wa_message", { x_partner_id: AHMED, x_direction: "out", x_status: "sent", create_date: "2026-10-05 08:00:00" });
  seed("x_wa_message", { x_partner_id: AHMED, x_direction: "in", x_status: "received", create_date: "2026-10-05 09:00:00" });
  const early = await quiet(() => OUT.runSupplierIndicatorsTick(env));
  assert("before 09:00: the numbers are not computed", early.action === "before" && (table("res.partner").get(AHMED) as any).x_reply_rate === undefined);
  setRiyadh("2026-10-06 09:00");
  const first = await quiet(() => OUT.runSupplierIndicatorsTick(env));
  const second = await quiet(() => OUT.runSupplierIndicatorsTick(env));
  assert("from 09:00: once that day — whatever «تفعيل تواصل الموردين» says", first.action === "written" && second.action === "claimed_before" && (table("res.partner").get(AHMED) as any).x_reply_rate === 100);
  assert("the five-minute tick runs both, the check-in under its own auto-send job", srcOf("index.ts").includes("runSupplierOutreachTick(withAutoSendJob(rawEnv, OUTREACH_JOB), Date.now(), ctx)") && srcOf("index.ts").includes("runSupplierIndicatorsTick(rawEnv, Date.now())") && REG.STATE_FIELD === "x_supplier_state");
  void rows;
}

done();
