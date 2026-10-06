// § 60 ب 4 + ج 2 + هـ (2026-10-06, Baraa's amendment) — the 21:30 summary closes the day.
//
//   [1] the text gains the FOUR lines of «خلاصة اليوم» — the 🎯 line about the day just closed — then
//       «طلبوا اليوم وما كان متوفر: …»; the three variables of the templates are what Meta approved
//   [2] with the summary the day's actual is KEPT on its record and its screen written again; read
//       alone, nothing is written
//   [3] a template in place of the text while his window is open: the lines follow it as one text;
//       outside his window: the template alone, nothing held
//   [4] a brief that cannot be made: «خلاصة اليوم: تعذّر», and the summary still goes
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s60-summary.test.mts

import { CUST2, OWNER, closeOwnerWindow, heldFor, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, table } from "./wa-harness.mts";
import { C1, C1_PHONE, DAY, OMAR_EMP, assert, cost, dayOf, done, dp, fresh, market, rejected, setExtract } from "./s46-kit.mts";

const PR = await import("../src/prices.ts");
const SUM = await import("../src/owner-summary.ts");
const DS = await import("../src/day-screen.ts");
const OW = await import("../src/owner-window.ts");

const NAMES: Record<number, string> = { 1: "موز أمريكي", 2: "رمان وسط", 3: "رمان صغير", 4: "رمان كبير" };
const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const text = (html: unknown) => String(html ?? "").replace(/<\/div>/g, "\n").replace(/<[^>]*>/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
const textOf = (b: any) => String(b?.text?.body ?? "");
const tplName = (b: any) => b?.template?.name ?? null;
const tplParams = (b: any) => ((b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters ?? []).map((p: any) => p.text);

/** The tenant on 2026-10-05 (the world of § 56), the day's prices computed at 04:00, the summary's own template in Odoo. */
async function world(): Promise<any> {
  const env = fresh(`${DAY} 04:00`); cost(496.52); setExtract(null);
  for (const [id, name] of Object.entries(NAMES)) table("product.template").get(Number(id))!.name = name;
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  for (const id of [1, 2, 3, 4]) table("product.template").get(id)!.categ_id = 5;
  table("x_pricing_config").get(1)!.x_min_order_sar = 0;
  table("hr.employee").get(OMAR_EMP)!.x_price_role = "market";
  openWindow(env, C1_PHONE);
  dp(1, 11, 55); market(1, 11, 70); dp(2, 21, 15); market(2, 21, 20); dp(3, 31, 12); dp(4, 41, 22); market(4, 41, 28);
  await quiet(() => PR.refreshPriceDay(env, { force: true }));
  seed("x_whatsapp_template", { x_purpose: "owner_summary", x_meta_template_id: "utak_v2_summary", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 3, x_category: "UTILITY",
    x_body_text: "ملخص اليوم جاهز\nطلبات: {{1}}\nتوصيلات: {{2}}\nإجمالي: {{3}} ريال\nتفاصيل أكثر في لوحة القيادة." });
  setRiyadh(`${DAY} 21:30`);
  return env;
}
/** A real order delivered today: 10 bananas at 70 and 6 small pomegranates at 19.50. */
function delivered(extra: Record<string, unknown> = {}): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: DAY, x_price_date: DAY, x_delivered_at: utc(`${DAY} 09:00`), x_created_via: "whatsapp", ...extra });
  for (const [p, k, q, price] of [[1, 11, 10, 70], [3, 31, 6, 19.5]]) seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: p, x_packaging_id: k, x_quantity: q, x_status: "purchased", x_unit_price: price, x_price_unit_manual: 0, x_return_qty: 0, x_return_reason: false });
  return id;
}
const ask = (partner: number, t: string) => seed("x_unavailable_request", { x_date: DAY, x_partner_id: partner, x_text: t, x_product_tmpl_id: false, x_quantity: 0 });
const FOUR = [
  "✅ يُنشر اليوم 2 من 4 أصناف — متوسط ربح الكرتون +1.75",
  "🎯 اليوم: بعنا 16 من 133 (12%) — ربح −435 ❌، أكبر سبب: الكمية −437",
  "💧 من كل كرتون بـ 44.75: لنا +1.75، وأكبر بند الشراء 33.50",
  "➡️ لا فرصة ظاهرة اليوم",
];

// ================================================================ [1] the text
console.log("\n[1] the text: the four lines of «خلاصة اليوم», then what was asked for and not available");
/** § 61 — the data check's line of this world: its two operating members (the harness's) carry no working schedule. */
const S61_CHECK = "🧾 فحص البيانات: بدور تشغيلي بلا جدول دوام: أحمد، سالم";
{
  const env = await world();
  delivered(); ask(C1, "طماطم"); ask(CUST2, "طماطم"); ask(C1, "طماطم"); ask(C1, "خيار");
  const r = await quiet(() => SUM.sendOwnerSummary(env));
  const sent = sentTo(OWNER).filter((b: any) => b?.type === "text" && textOf(b).startsWith("📊"));
  const lines = textOf(sent[0]).split("\n");
  assert("inside his window: ONE text — its five lines as they were, then § 60's five", r.action === "session" && sent.length === 1 && lines.length === 11 && lines[0] === "📊 ملخص اليوم 3 أكتوبر 2026" && lines[4].startsWith("تغطية تكاليف اليوم:"), textOf(sent[0]));
  // what was asked for and not available is an opportunity too: the ➡️ line names the two most customers asked for
  const four = [...FOUR.slice(0, 3), "➡️ أهم فرصتين: طماطم (طلبه عميلان) · خيار (طلبه عميل واحد)"];
  assert("the four lines of «خلاصة اليوم», with the day's numbers — the 🎯 line about the day just closed («اليوم»), its largest reason alone", JSON.stringify(lines.slice(5, 9)) === JSON.stringify(four), lines.slice(5, 9).join(" | "));
  assert("then «طلبوا اليوم وما كان متوفر: طماطم ×3 (عميلان)، خيار ×1»", lines[9] === "طلبوا اليوم وما كان متوفر: طماطم ×3 (عميلان)، خيار ×1", lines[9]);
  assert("the summary's figures carry them", JSON.stringify(r.figures?.brief) === JSON.stringify(four) && r.figures?.unavailable === lines[9] && JSON.stringify(SUM.insightLines(r.figures!)) === JSON.stringify([...four, lines[9], S61_CHECK]));
  // § 61 — the data check's one line comes last (this world's two operating members carry no schedule; it holds no job, so no vacancy line)
  assert("…and § 61's data check is the last line, after what was asked for", lines[10] === S61_CHECK && JSON.stringify(r.figures?.staffing) === JSON.stringify([S61_CHECK]), lines[10]);
  assert("the templates' three variables are what Meta approved: none of § 60's lines in them", SUM.summaryParams(r.figures!).length === 3 && !/✅|🎯|💧|➡️|طلبوا/.test(SUM.summaryParams(r.figures!).join(" ")));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = await world();
  const r = await quiet(() => SUM.sendOwnerSummary(env));
  const lines = textOf(sentTo(OWNER).find((b: any) => textOf(b).startsWith("📊"))).split("\n");
  assert("no real delivery and nothing asked for: «🎯 اليوم: لا مبيعات حقيقية بعد», and no «طلبوا» line at all", r.action === "session" && lines.length === 10 && lines[9] === S61_CHECK && lines[6] === "🎯 اليوم: لا مبيعات حقيقية بعد" && !lines.join(" ").includes("طلبوا"), lines.join(" | "));
}
{
  // a day with no price record at all
  const env = fresh(`${DAY} 21:30`); cost(496.52);
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("no prices of the day: «✅ لا أسعار لليوم» and three lines that say there is nothing", JSON.stringify(f.brief) === JSON.stringify([DS.NO_DAY_BRIEF, "🎯 اليوم: لا مبيعات حقيقية بعد", "💧 لا صنف يُنشر اليوم بسعر وشراء", "➡️ لا فرصة ظاهرة اليوم"]) && DS.NO_DAY_BRIEF === "✅ لا أسعار لليوم", JSON.stringify(f.brief));
}

// ================================================================ [2] kept with the summary
console.log("\n[2] with the summary the day's actual is kept and its screen written again");
{
  const env = await world();
  delivered();
  odooLog.length = 0;
  const f = await quiet(() => SUM.readSummaryFigures(env));
  assert("read alone (a script, a test): the lines are made and NOTHING is written", JSON.stringify(f.brief) === JSON.stringify(FOUR) && odooLog.every((x) => x.method !== "write" && x.method !== "create") && !dayOf().x_act_at, odooLog.filter((x) => x.method === "write").map((x) => x.model).join());
  await quiet(() => SUM.sendOwnerSummary(env));
  const d = dayOf();
  assert("the summary itself keeps the actual on the day's record (Q 16, A −434.97, when)", d.x_act_cartons === 16 && d.x_act_profit === -434.97 && d.x_act_at === utc(`${DAY} 21:30`), JSON.stringify([d.x_act_cartons, d.x_act_profit, d.x_act_at]));
  assert("…and writes the day's screen again: under the tiles the day's own line joins — «اليوم: بعنا 16 من 133 (12%) — ربح اليوم الحقيقي −435 ❌» and its gap by its parts", text(d.x_target_html).slice(-2).join(" | ") === "اليوم: بعنا 16 من 133 (12%) — ربح اليوم الحقيقي −435 ❌ | عجز 435: الكمية −437 · الهامش +2", text(d.x_target_html).join(" | "));
  assert("the screen's own box keeps «🎯 أمس» (the day before): the summary's 🎯 line alone is about the day just closed", text(d.x_brief_html)[2] === "🎯 أمس: لم تُحسب أرقامه بعد", text(d.x_brief_html).join(" | "));
  assert("only display fields were written: the actual's, the screen's and § 60's — no price, no status, no state", odooLog.filter((x) => x.method === "write" && (x.model === "x_price_day" || x.model === "x_price_day_line")).every((x) => Object.keys(x.body.vals).every((k) => /^x_(act_|var_)/.test(k) || ([...PR.SCREEN_LINE_FIELDS, ...PR.SCREEN_DAY_FIELDS, ...DS.INSIGHT_DAY_FIELDS] as readonly string[]).includes(k))),
    odooLog.filter((x) => x.method === "write").map((x) => Object.keys(x.body.vals).join()).join(" | "));
  const again = await quiet(() => SUM.sendOwnerSummary(env));
  assert("still once a day", again.action === "sent_before" && sentTo(OWNER).filter((b: any) => textOf(b).startsWith("📊")).length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ [3] a template in place of the text
console.log("\n[3] a template carries three variables: the lines follow it inside his window, and are not sent outside it");
{
  const env = await world();
  delivered(); ask(C1, "خيار");
  seed("x_whatsapp_template", { x_purpose: "other", x_meta_template_id: OW.SUMMARY_TEMPLATE, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 4, x_category: "UTILITY",
    x_body_text: "ملخص عمليات يو تاك ليوم {{1}}\n\nطلبات: {{2}}\nتوصيلات: {{3}}\nإجمالي: {{4}} ريال\n\nتفاصيل أكثر في لوحة القيادة.", x_buttons_text: "تم الاطلاع" });
  openWindow(env, OWNER, 20 * 60);   // he wrote at 01:30: his window closes 01:20 tomorrow, before 06:00
  const r = await quiet(() => SUM.sendOwnerSummary(env));
  const m = sentTo(OWNER);
  assert("his window open but closing before 06:00: the night's template first, with its four variables as they were", r.action === "template" && m.length === 2 && tplName(m[0]) === OW.SUMMARY_TEMPLATE && tplParams(m[0]).length === 4 && !/✅|🎯|طلبوا/.test(tplParams(m[0]).join(" ")), JSON.stringify(m.map(tplName)));
  assert("…then § 60's lines as ONE text of their own: «📊 تكملة ملخص اليوم 3 أكتوبر 2026», the four lines, what was asked for", textOf(m[1]) === ["📊 تكملة ملخص اليوم 3 أكتوبر 2026", ...FOUR.slice(0, 3), "➡️ أهم فرصة: خيار (طلبه عميل واحد)", "طلبوا اليوم وما كان متوفر: خيار ×1", S61_CHECK].join("\n") && SUM.insightFollowUp(r.figures!) === textOf(m[1]), textOf(m[1]));
}
{
  const env = await world();
  delivered();
  closeOwnerWindow(env);
  const r = await quiet(() => SUM.sendOwnerSummary(env));
  const m = sentTo(OWNER);
  assert("outside his window: the template alone — § 60's lines are not sent, and nothing is held for him", r.action === "template" && m.length === 1 && tplName(m[0]) === "utak_v2_summary" && heldFor(env, OWNER).length === 0, JSON.stringify(m.map((b: any) => tplName(b) ?? textOf(b).slice(0, 30))));
  assert("…the day's actual is kept all the same (the screen carries the lines)", dayOf().x_act_cartons === 16 && !!dayOf().x_act_at);
}

// ================================================================ [4] a brief that cannot be made
console.log("\n[4] a brief that cannot be made: «خلاصة اليوم: تعذّر», and the summary still goes");
{
  const env = await world();
  delivered();
  // a delivered line without a sale price: the day's actual cannot be computed — never a partial sum
  rows("x_daily_order_line").forEach((l: any) => { l.x_unit_price = 0; });
  const r = await quiet(() => SUM.sendOwnerSummary(env));
  const lines = textOf(sentTo(OWNER).find((b: any) => textOf(b).startsWith("📊"))).split("\n");
  assert("the summary goes with «خلاصة اليوم: تعذّر» in the place of the four lines, and names what failed", r.action === "session" && lines.length === 7 && lines[6] === S61_CHECK && lines[5] === "خلاصة اليوم: تعذّر" && SUM.BRIEF_UNAVAILABLE_TEXT === "خلاصة اليوم: تعذّر" && r.figures!.brief === null && r.figures!.errors.some((e: string) => e.startsWith("brief:")), lines.join(" | "));
}

done();
