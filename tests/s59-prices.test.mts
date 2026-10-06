// § 59 ب (2026-10-06) — the marketing member's price list.
//
//   [ب1] the list as he forwards it: the published items at their sale prices alone — never a
//        purchase price, a market price, a suggested price or a profit
//   [ب1] with every publication: to the member who holds «تسويق», once
//   [ب2] outside his window: utak_team_prices_ready_v1 with «أرسل القائمة» (UTILITY alone), the list
//        owed to him — his tap, or his first message, brings it
//   [ب3] «الأسعار» / «القائمة» at any hour: the valid list, or «الأسعار تتحدث»
//   § 53: the gateway refuses the list for a price source's or a supplier's number
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s59-prices.test.mts

import { readFileSync } from "node:fs";
import { CUST2_PHONE, OWNER, ctx, employee, graph, heldFor, inbound, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, cost, done, fresh, rejected } from "./s46-kit.mts";

const TP = await import("../src/team-prices.ts");
const PR = await import("../src/prices.ts");
const { sendText } = await import("../src/meta.ts");
const { CUSTOMER_PRICE_PURPOSES } = await import("../src/price-privacy.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const LIB = await import("../scripts/lib/s59-templates.mjs");
const worker = (await import("../src/index.ts")).default;

const MARKETING = 74;
const UTAK = "966580000467";
const NEXT = "2026-10-04";
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const body = (b: any): string => String(b?.text?.body ?? b?.interactive?.body?.text ?? "");
const textsTo = (digits: string) => sentTo(digits).filter((b) => b?.type === "text").map(body);
const post = async (env: any, from: string, m: Record<string, unknown>) => { await quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx)); };
const text = (t: string) => ({ type: "text", text: { body: t } });
const quickReply = (payload: string) => ({ type: "button", button: { payload, text: "أرسل القائمة" } });
const TPL = LIB.TEAM_PRICES_READY;

/** Omar is marketing alone (§ 59 أ), the tenant's products with their references, UTAK's own number known. */
function world(riyadh: string, o: { template?: string | false } = {}): any {
  const env = fresh(riyadh); cost(500);
  env.UTAK_WA_NUMBER = "+" + UTAK;
  seed("x_employee_role", { id: MARKETING, x_code: "marketing", x_name: "تسويق", x_active: true });
  Object.assign(table("hr.employee").get(OMAR_EMP)!, { x_utak_role_ids: [MARKETING], x_utak_attendance: false, x_price_source: false });
  table("product.template").get(1)!.name = "[UTAK-VEG-001] طماطم";
  table("product.template").get(2)!.name = "[UTAK-VEG-002] خيار";
  table("x_product_packaging").get(11)!.x_name = "كرتون · 14 كيلو";
  if (o.template !== false) seed("x_whatsapp_template", { x_purpose: TPL.purpose, x_meta_template_id: TPL.name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: TPL.params, x_category: o.template ?? "UTILITY" });
  return env;
}
/**
 * A price day: tomato sells at its suggested price 62.5 by Baraa's decision (cost 41.37, market 77.77),
 * cucumber at the market price 28 (cost 19.13, suggested 26.5), potato left out, onion an exception.
 */
function day(state: "approved" | "published", d = DAY): number {
  const id = seed("x_price_day", { x_date: d, x_state: state, x_name: `أسعار اليوم ${d}`, x_utak_simulation: false, ...(state === "published" ? { x_published_at: utc(`${d} 06:00`) } : { x_approved_at: utc(`${d} 05:59`) }) });
  const line = (seq: number, p: number, k: number, v: Record<string, unknown>) => seed("x_price_day_line", { x_day_id: id, x_sequence: seq, x_product_tmpl_id: p, x_packaging_id: k, x_blocked: false, x_utak_simulation: false, x_manual_price: 0, ...v });
  line(1, 1, 11, { x_cost_price: 41.37, x_market_price: 77.77, x_suggested_price: 62.5, x_break_even: 56.21, x_real_profit: 9.84, x_sale_price: 62.5, x_status: "manual", x_decision: "profit", x_excluded: false });
  line(2, 2, 21, { x_cost_price: 19.13, x_market_price: 28, x_suggested_price: 26.5, x_break_even: 24.19, x_real_profit: 3.07, x_sale_price: 28, x_status: "auto", x_excluded: false });
  line(3, 3, 31, { x_cost_price: 15.55, x_market_price: 17.17, x_suggested_price: 22.5, x_sale_price: 0, x_status: "unpublished", x_excluded: true });
  line(4, 4, 41, { x_cost_price: 9.99, x_market_price: 0, x_suggested_price: 16.5, x_sale_price: 0, x_status: "exception", x_excluded: false });
  return id;
}
/** Every number of the day that is not a sale price: none may be in what the member reads. */
const SECRET = ["41.37", "77.77", "56.21", "9.84", "19.13", "26.5", "24.19", "3.07", "15.55", "17.17", "22.5", "9.99", "16.5"];
const leaks = (s: string) => SECRET.filter((n) => s.includes(n));
const LIST = [
  `📋 قائمة أسعار يو تاك اليوم — السبت 3 أكتوبر 2026`,
  "",
  "• طماطم (كرتون · 14 كيلو): 62.50 ر.س",
  "• خيار (جرم): 28 ر.س",
  "",
  "الأسعار شاملة ضريبة القيمة المضافة.",
  "صالحة حتى 6:00 صباح بكرة.",
  `للطلب على واتساب: https://wa.me/${UTAK}?text=${encodeURIComponent("أبي أطلب")}`,
].join("\n");

// ================================================================ ب1 — the text
console.log("\n[ب1] the list as he forwards it");
{
  const items = [{ productName: "[UTAK-VEG-001] طماطم", packagingName: "كرتون · 14 كيلو", price: 62.5 }, { productName: "[UTAK-VEG-002] خيار", packagingName: "جرم", price: 28 }];
  const link = TP.orderLink({ UTAK_WA_NUMBER: "+" + UTAK } as any);
  const parts = TP.teamPriceListParts(DAY, items, link);
  assert("the title with the day, a line an item (name, packaging, sale price), the VAT line, «صالحة حتى 6:00 صباح بكرة», the link", parts.length === 1 && parts[0] === LIST, parts[0]);
  assert("the link opens UTAK's own number with «أبي أطلب» ready", link === `https://wa.me/${UTAK}?text=%D8%A3%D8%A8%D9%8A%20%D8%A3%D8%B7%D9%84%D8%A8` && decodeURIComponent(link.split("text=")[1]) === "أبي أطلب");
  assert("no number of ours known: the list goes without the link line (never a wrong one)", TP.orderLink({} as any) === "" && TP.orderLink({ UTAK_WA_NUMBER: "12" } as any) === "" && !TP.teamPriceListParts(DAY, items, "")[0].includes("wa.me") && TP.teamPriceListParts(DAY, items, "")[0].endsWith(TP.TEAM_PRICES_VALID_LINE));
  assert("written to be forwarded: no name of his, no greeting, no reference code, no word of the team", !/عمر|مرحب|هلا|UTAK-|فريق|مهام/.test(parts[0]));
  // a long list is cut on line boundaries, the footer on the last part alone
  const many = Array.from({ length: 120 }, (_, i) => ({ productName: `صنف طويل الاسم رقم ${i + 1}`, packagingName: "كرتون · 10 كيلو", price: 10 + i }));
  const cut = TP.teamPriceListParts(DAY, many, link);
  assert("a long list: parts of at most 3500 characters, «(1/n)», every item once, the footer on the last", cut.length > 1 && cut.every((p) => p.length <= TP.TEAM_PRICES_LIMIT) && cut[0].includes(`(1/${cut.length})`) && cut.join("\n").split("• ").length - 1 === 120 && cut.at(-1)!.includes("wa.me") && !cut[0].includes("wa.me"), `${cut.length} parts`);
  for (const [t, yes] of [["الأسعار", true], ["الاسعار", true], ["أسعار", true], ["اسعار اليوم", true], ["القائمة", true], ["القايمة", true], ["قائمة الأسعار", true], ["قائمة الاسعار اليوم", true], ["الأسعار؟", true], ["  الأسعار  ", true],
    ["كم الأسعار اليوم يا شباب", false], ["أسعار الطماطم", false], ["قائمة الشراء", false], ["حمولة", false], ["", false]] as const) {
    assert(`«${t}»: ${yes ? "the list" : "not the command"}`, TP.teamPricesCommand(t) === yes);
  }
  assert("the two purposes are the gateway's, operational; the list is a price-bearing purpose (§ 53)", PURPOSES[TP.TEAM_PRICES_PURPOSE]?.kind === "operational" && PURPOSES[TP.TEAM_PRICES_READY_PURPOSE]?.kind === "operational" && CUSTOMER_PRICE_PURPOSES.has(TP.TEAM_PRICES_PURPOSE));
  assert("the template's data and the worker agree: the purpose, one variable, the payload of «أرسل القائمة»", TPL.purpose === TP.TEAM_PRICES_READY_PURPOSE && TPL.params === 1 && TPL.payload === TP.TEAM_PRICES_PAYLOAD && TPL.buttons.length === 1 && TPL.buttons[0].text === "أرسل القائمة" && TPL.body.includes("قائمة أسعار يو تاك ليوم {{1}} جاهزة"));
}

// ================================================================ ب1 — with the publication
console.log("\n[ب1] with the publication: the published items alone, at their sale prices alone");
{
  const env = world(`${DAY} 06:00`);
  openWindow(env, DRIVER_PHONE);
  const d = day("approved");
  const pub = await quiet(() => PR.publishPriceDay(env, d));
  const got = textsTo(DRIVER_PHONE);
  assert("published, and Omar got «📋 قائمة أسعار يو تاك اليوم» inside his window", pub.action === "published" && got.length === 1 && got[0] === LIST, got.join("\n---\n"));
  assert("the report names him", JSON.stringify(pub.marketing) === JSON.stringify([{ name: "عمر المجهلي", action: "session" }]), JSON.stringify(pub.marketing));
  assert("the item left out and the exception without a decision are not in it", !got[0].includes("بطاطس") && !got[0].includes("بصل"));
  assert("NO purchase price, market price, suggested price, break-even or profit of any line is in it", leaks(got[0]).length === 0, leaks(got[0]).join(","));
  assert("…nor in anything else he was sent", sentTo(DRIVER_PHONE).every((b) => leaks(JSON.stringify(b)).length === 0));
  assert("it went under its own purpose, as text — not a template, not the customers' list", sentTo(DRIVER_PHONE).length === 1 && sentTo(DRIVER_PHONE)[0].type === "text" && !got[0].includes("🌿 أسعار يو تاك اليوم"));
  // once a publication
  const again = await quiet(() => TP.teamPricesAfterPublication(env, { dayId: d, day: DAY, publishedAtMs: Date.now(), validUntilMs: Date.now() + 3600_000 }));
  assert("a second run for the same day: nothing more", again[0]?.action === "claimed_before" && textsTo(DRIVER_PHONE).length === 1, JSON.stringify(again));
  assert("Baraa's copy and the customers' list are as they were", sentTo(OWNER).some((b) => body(b).includes("📢 نُشرت أسعار")) && (textsTo(C1_PHONE).length + heldFor(env, C1_PHONE).length) >= 1);

  // nobody holds «تسويق»: nothing, and the publication is as it was
  const env2 = world(`${DAY} 06:00`);
  table("hr.employee").get(OMAR_EMP)!.x_utak_role_ids = [72];
  openWindow(env2, DRIVER_PHONE);
  const pub2 = await quiet(() => PR.publishPriceDay(env2, day("approved")));
  assert("nobody holds «تسويق»: no list to anyone of the team", pub2.action === "published" && pub2.marketing === undefined && !textsTo(DRIVER_PHONE).some((t) => t.includes("📋 قائمة أسعار")), JSON.stringify(pub2.marketing));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ب2 — outside his window
console.log("\n[ب2] outside his window: the template with «أرسل القائمة», and the list owed to him");
{
  let env = world(`${DAY} 06:00`);
  let d = day("approved");
  let pub = await quiet(() => PR.publishPriceDay(env, d));
  let t = sentTo(DRIVER_PHONE);
  const params = (b: any): string[] => (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
  const payloads = (b: any): string[] => (b?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => c.parameters?.[0]?.payload);
  assert("window closed, the template UTILITY: utak_team_prices_ready_v1 [the day], «أرسل القائمة» → team_prices_send", t.length === 1 && t[0]?.template?.name === TPL.name && params(t[0]).join() === "3 أكتوبر 2026" && payloads(t[0]).join() === "team_prices_send" && pub.marketing?.[0]?.action === "template", JSON.stringify(t[0]?.template));
  assert("no price in the template, and nothing held in the gateway", leaks(JSON.stringify(t[0])).length === 0 && !JSON.stringify(t[0]).includes("62.5") && heldFor(env, DRIVER_PHONE).length === 0);
  // his tap sends the list
  setRiyadh(`${DAY} 07:10`);
  graph.length = 0;
  await post(env, DRIVER_PHONE, quickReply("team_prices_send"));
  assert("his tap on «أرسل القائمة»: the list, once", textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === LIST, textsTo(DRIVER_PHONE).join("\n---\n"));
  graph.length = 0;
  await post(env, DRIVER_PHONE, text("السلام عليكم"));
  assert("his next message: no second list (what was owed is settled), one line says what he can ask for", textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === TP.marketingHintText("عمر المجهلي"), textsTo(DRIVER_PHONE).join(" | "));

  // he writes instead of tapping: the owed list with his first message, and nothing under it
  env = world(`${DAY} 06:00`);
  d = day("approved");
  await quiet(() => PR.publishPriceDay(env, d));
  setRiyadh(`${DAY} 08:00`);
  graph.length = 0;
  await post(env, DRIVER_PHONE, text("صباح الخير"));
  assert("he writes instead of tapping: the owed list with his first message, alone", textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === LIST, textsTo(DRIVER_PHONE).join("\n---\n"));
  graph.length = 0;
  await post(env, DRIVER_PHONE, quickReply("team_prices_send"));
  assert("…and a late tap still answers (the list again, by his own ask)", textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === LIST);

  // the template filed MARKETING (or not there): never used — the list waits for his first message
  for (const [label, tpl] of [["MARKETING", "MARKETING"], ["not at Meta", false]] as const) {
    env = world(`${DAY} 06:00`, { template: tpl });
    d = day("approved");
    pub = await quiet(() => PR.publishPriceDay(env, d));
    assert(`the template ${label}: not used — nothing sent to him, nothing held, the list owed`, sentTo(DRIVER_PHONE).length === 0 && heldFor(env, DRIVER_PHONE).length === 0 && pub.marketing?.[0]?.action === "owed", JSON.stringify(pub.marketing) + JSON.stringify(sentTo(DRIVER_PHONE)).slice(0, 200));
    assert(`the template ${label}: Baraa is not alerted about it (it is not a failed send)`, !sentTo(OWNER).some((b) => body(b).includes("قائمة الأسعار (التسويق)")));
    setRiyadh(`${DAY} 09:30`);
    graph.length = 0;
    await post(env, DRIVER_PHONE, text("هلا"));
    assert(`the template ${label}: his first message brings the list`, textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === LIST, textsTo(DRIVER_PHONE).join(" | "));
  }

  // owed, and he writes after the list has expired (06:00 of the next day): no old list — the day's, or «الأسعار تتحدث» by his ask
  env = world(`${DAY} 06:00`, { template: false });
  d = day("approved");
  await quiet(() => PR.publishPriceDay(env, d));
  setRiyadh(`${NEXT} 06:30`);
  graph.length = 0;
  await post(env, DRIVER_PHONE, text("هلا"));
  assert("owed, and he writes after it expired: yesterday's list is NOT sent", !textsTo(DRIVER_PHONE).some((x) => x.includes("📋 قائمة أسعار")), textsTo(DRIVER_PHONE).join(" | "));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ ب3 — «الأسعار» / «القائمة»
console.log("\n[ب3] «الأسعار» / «القائمة» at any hour");
{
  let env = world(`${DAY} 14:00`);
  day("published");
  for (const ask of ["الأسعار", "القائمة", "قائمة الاسعار"]) {
    graph.length = 0;
    await post(env, DRIVER_PHONE, text(ask));
    assert(`«${ask}» from Omar: the valid list, alone`, textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === LIST && leaks(textsTo(DRIVER_PHONE)[0]).length === 0, textsTo(DRIVER_PHONE).join(" | "));
  }
  // 02:00 of the next day: yesterday's list is still valid (until 06:00), and it says its own day
  setRiyadh(`${NEXT} 02:00`);
  graph.length = 0;
  await post(env, DRIVER_PHONE, text("الأسعار"));
  assert("02:00 of the next day: the list of the day still valid (until 06:00)", textsTo(DRIVER_PHONE)[0] === LIST);
  // after 06:00 with no new publication: «الأسعار تتحدث»
  setRiyadh(`${NEXT} 06:05`);
  graph.length = 0;
  await post(env, DRIVER_PHONE, text("الأسعار"));
  assert("after 06:00 with no publication yet: «الأسعار تتحدث», no list", textsTo(DRIVER_PHONE).length === 1 && textsTo(DRIVER_PHONE)[0] === TP.TEAM_PRICES_UPDATING_TEXT, textsTo(DRIVER_PHONE).join(" | "));
  // a day approved and not published is not a list
  env = world(`${DAY} 05:00`);
  day("approved");
  graph.length = 0;
  await post(env, DRIVER_PHONE, text("القائمة"));
  assert("before the publication (the day approved only): «الأسعار تتحدث»", textsTo(DRIVER_PHONE)[0] === TP.TEAM_PRICES_UPDATING_TEXT && !textsTo(DRIVER_PHONE).some((x) => x.includes("62.50")));

  // a member who does not hold «تسويق» is not answered with the list
  env = world(`${DAY} 14:00`);
  day("published");
  seed("res.partner", { id: 833, name: "سائق الدينة", x_whatsapp_number: "+966500000833" });
  employee(833, [72]);
  graph.length = 0;
  await post(env, "966500000833", text("الأسعار"));
  assert("«الأسعار» from a member without «تسويق»: no list (the team's line, as before)", !textsTo("966500000833").some((x) => x.includes("📋 قائمة أسعار")) && textsTo("966500000833").some((x) => x.includes("استخدم الأزرار")), textsTo("966500000833").join(" | "));
  // a customer who writes «الأسعار» is in the customers' path, not here
  graph.length = 0;
  await post(env, CUST2_PHONE, text("الأسعار"));
  assert("a customer's «الأسعار» is not answered with the team's list", !textsTo(CUST2_PHONE).some((x) => x.includes("📋 قائمة أسعار يو تاك اليوم")));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ § 53 — who may read it
console.log("\n[§ 53] the list never reaches a price source or a supplier");
{
  const env = world(`${DAY} 14:00`);
  day("published");
  openWindow(env, AHMED_PHONE);
  const sup = await quiet(() => sendText(env, "+" + AHMED_PHONE, LIST, { purpose: TP.TEAM_PRICES_PURPOSE }));
  assert("the list to a supplier's number: refused (403), nothing sent", sup.status === 403 && sentTo(AHMED_PHONE).length === 0, String(sup.status));
  // Omar's own partner flagged «مصدر أسعار» again: the gateway refuses, whatever the role says
  table("res.partner").get(DRIVER)!.x_price_source = true;
  env.MSG_DEDUP.store.delete("price_closed:v1");
  openWindow(env, DRIVER_PHONE);
  graph.length = 0;
  await post(env, DRIVER_PHONE, text("الأسعار"));
  assert("his partner flagged «مصدر أسعار»: no list reaches him", !textsTo(DRIVER_PHONE).some((x) => x.includes("62.50")), textsTo(DRIVER_PHONE).join(" | "));
  const src = readFileSync(new URL("../src/team-prices.ts", import.meta.url), "utf8");
  assert("the module reads no purchase, market, suggested or profit field at all", !/x_cost_price|x_market_price|x_suggested_price|x_break_even|x_real_profit|x_full_cost|x_purchase_price/.test(src));
  assert("no row of the day's lines was read with a field beyond the customers' own reader", rows("x_price_day_line").length === 4);
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

void [AHMED];
done();
