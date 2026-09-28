// § 44 — the day's order before tonight's launch (2026-09-28).
//
//   [ب] the real customers' records are never marked «محاكاة»: a record with
//       x_is_simulation of a partner in the list (scripts/lib/real-partners.mjs)
//       — its order, line, invoice, payment, stop, route, the day's purchase
//       list, its dues and lines, its messages — is left out of the pre-launch
//       mark (§ 42 ج, re-run by the cutover), and a simulation partner's is not.
//   [د] the customer's VAT number: after a confirmed order (the quotation's
//       button, «سجّله لبكرة», the standing order) of a customer «غير معروف»
//       the question follows the confirmation; «لا» → «غير مسجّل» for good;
//       «نعم» → the number (15 digits 3…3, Arabic-Indic too, asked again when
//       wrong), the name, the address, then ONE write «مسجّل»; 60 minutes →
//       nothing saved, asked again next time, three times at most, then Baraa's
//       one alert; «إيقاف» or the order cancelled → nothing saved; the full tax
//       invoice after the save (name, number, address printed), the simplified
//       one before it; delivery never waits.
//   [س] schema: every Odoo request names real fields and values (§ 44 fixture).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s44.test.mts

import { readFileSync } from "node:fs";
import {
  CUST, CUST_PHONE, OWNER, employee, graph, inbound, openWindow, partnerOf, quiet, reset, rows, seed, sentTo, setRiyadh, signed, table, workSchedule,
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
  "fixtures-odoo-fields-20260926-s41.json", "fixtures-odoo-fields-20260927-s42.json",
  // § 44 — fields_get of 2026-09-28 after part د (scripts/s44-20260928-fields-fixture.mjs; last: it wins)
  "fixtures-odoo-fields-20260928-s44.json",
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
let claudeIntent = "other";
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    const sys = String(JSON.parse(String(init?.body ?? "{}")).system ?? "");
    const out = /classify UTAK WhatsApp messages|You classify/.test(sys) ? { intent: claudeIntent, confidence: 0.9 }
      : sys.startsWith("You screen") ? { intent: "purchase", reason: "يطلب" }
      : /extract structured order items/.test(sys) ? [] : "أهلاً وسهلاً";
    return new Response(JSON.stringify({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] }), { status: 200 });
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
const { dispatch } = await import("../src/router.ts");
const INV = await import("../src/invoice.ts");
const TX = await import("../src/tax-invoice.ts");
const VA = await import("../src/vat-ask.ts");
const { ALREADY_DONE_TEXT } = await import("../src/button-lock.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helper
const RP = await import("../scripts/lib/real-partners.mjs");

// ---------------------------------------------------------------- data + helpers
const C1 = CUST, C1_PHONE = CUST_PHONE;
const DRIVER = 603, DRIVER_PHONE = "966500000603";
const AHMED = 801, AHMED_PHONE = "966500000801";
const SAT_THU: Array<[number, number, number]> = [[5, 2, 12], [6, 2, 12], [0, 2, 12], [1, 2, 12], [2, 2, 12], [3, 2, 12]];
const SELLER = "شركة يوتاك ذات مسؤولية محدودة", SELLER_VAT = "315022736600003";
const COMPANY = { nameAr: SELLER, nameEn: "UTAK", address: "الرياض", email: "care@utak.example", phone: "+966 58 004 0467", cr: "7055194869", vat: SELLER_VAT } as any;
let ENV: any;
function fresh(riyadh: string): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0; claudeIntent = "other";
  seed("res.partner", { id: DRIVER, name: "عمر المجهلي", x_whatsapp_number: "+" + DRIVER_PHONE });
  employee(DRIVER, [72], { x_utak_attendance: false, resource_calendar_id: workSchedule(SAT_THU, { name: "UTAK — عمر" }) });
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  seed("res.partner", { id: AHMED, name: "أحمد حسان", supplier_rank: 5, x_whatsapp_number: "+" + AHMED_PHONE, x_supplied_product_ids: [1, 2], x_price_source: true, x_vat_registered: true });
  Object.assign(table("product.template").get(1)!, { sale_ok: true, x_is_active_for_sale: true });
  table("x_product_packaging").get(11)!.x_is_default = true;
  seed("x_pricing_config", {
    id: 1, x_name: "UTAK Default Pricing (Launch)", x_is_active: true, x_active_from: "2026-08-29", x_active_to: false,
    x_operations_margin_percent: 15, x_profit_margin_percent: 20, x_waste_pct: 5, x_min_order_sar: 150, x_planned_stops: 0,
  });
  seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.company", { id: 1, name: SELLER, vat: SELLER_VAT, account_sale_tax_id: [77, "15%"] });
  Object.assign(table("res.partner").get(C1)!, { x_contact_class: "customer", x_vat_status: "unknown", x_vat_ask_count: 0 });
  ENV = env;
  return env;
}
/** A published tomato (sale 30) on `day`. */
function publishedTomato(day: string, sale = 30): void {
  const d = seed("x_price_day", { x_date: day, x_state: "published", x_name: `أسعار ${day}` });
  seed("x_price_day_line", { x_day_id: d, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 20, x_market_price: sale, x_sale_price: sale, x_supplier_id: AHMED, x_status: "auto", x_excluded: false, x_blocked: false });
}
/** An order of today waiting for the customer's confirmation (10 × 30 = 300). */
function waiting(day: string, extra: Record<string, unknown> = {}): number {
  const id = seed("x_daily_order", { x_customer_id: C1, x_state: "waiting_confirmation", x_order_date: day, x_created_via: "whatsapp", ...extra });
  seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 10, x_status: "pending" });
  return id;
}
function collectingCtx() {
  const tasks: Promise<unknown>[] = [];
  return { tasks, waitUntil: (p: Promise<unknown>) => { tasks.push(p); }, passThroughOnException: () => {} } as any;
}
async function say(from: string, m: Record<string, unknown>): Promise<void> {
  const c = collectingCtx();
  await quiet(async () => { await worker.fetch(signed(inbound(from, m)), ENV, c); await Promise.all(c.tasks); });
}
const tap = (from: string, id: string, title = "x") => say(from, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const write = (from: string, text: string) => say(from, { type: "text", text: { body: text } });
const bodyOf = (b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? "");
const texts = (to: string) => sentTo(to).map(bodyOf);
const lastText = (to: string) => bodyOf(sentTo(to).at(-1));
const vatButtonsOf = (to: string) => sentTo(to).filter((b: any) => b.type === "interactive").flatMap((b: any) => (b.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id)).filter((id: string) => id.startsWith("vat_"));
const partner = () => table("res.partner").get(C1) as any;
const tapAs = (env: any, buttonId: string, who: number) =>
  quiet(() => dispatch(env, {
    msg: { messageId: `w${Math.random()}`, from: "+x", fromRaw: "x", profileName: "", text: "", timestamp: "", type: "button", buttonId } as any,
    intent: "other", senderType: "customer", partner: partnerOf(who),
  }));
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const addMin = (riyadh: string, min: number) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00") + min * 60_000 + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

// ================================================================ [ب]
console.log("\n[ب] the real customers' records are never marked");
{
  reset(); setRiyadh("2026-09-28 10:00");
  const REAL = 31, SIMP = 900;
  seed("res.partner", { id: REAL, name: "ابو مكين المعبري", customer_rank: 1, x_contact_class: "customer" });
  seed("res.partner", { id: SIMP, name: "مطعم محاكاة", customer_rank: 1, x_utak_simulation: true });
  const IS = { x_is_simulation: true };
  const oR = seed("x_daily_order", { x_customer_id: REAL, x_state: "confirmed", x_order_date: "2026-09-28", ...IS });
  const oS = seed("x_daily_order", { x_customer_id: SIMP, x_state: "confirmed", x_order_date: "2026-09-30", ...IS });
  const oRc = seed("x_daily_order", { x_customer_id: REAL, x_state: "cancelled", x_order_date: "2026-10-02", ...IS });
  const lR = seed("x_daily_order_line", { x_order_id: oR, ...IS });
  const lS = seed("x_daily_order_line", { x_order_id: oS, ...IS });
  const iR = seed("x_invoice", { x_order_id: oR, ...IS });
  const iS = seed("x_invoice", { x_order_id: oS, ...IS });
  const pR = seed("x_payment", { x_invoice_id: iR, ...IS });
  const pS = seed("x_payment", { x_invoice_id: iS, ...IS });
  const rR = seed("x_delivery_route", { ...IS });
  const rS = seed("x_delivery_route", { ...IS });
  const sR = seed("x_delivery_stop", { x_route_id: rR, x_order_id: oR, ...IS });
  const sS = seed("x_delivery_stop", { x_route_id: rS, x_order_id: oS, ...IS });
  const plR = seed("x_purchase_list", { x_date: "2026-09-28", ...IS });
  const plS = seed("x_purchase_list", { x_date: "2026-09-30", ...IS });
  const plC = seed("x_purchase_list", { x_date: "2026-10-02", ...IS }); // only the real customer's CANCELLED order that day
  const dR = seed("x_supplier_due", { x_purchase_list_id: plR, ...IS });
  const dS = seed("x_supplier_due", { x_purchase_list_id: plS, ...IS });
  const dlR = seed("x_supplier_due_line", { x_due_id: dR, ...IS });
  const dlS = seed("x_supplier_due_line", { x_due_id: dS, ...IS });
  const wR = seed("x_wa_message", { x_partner_id: REAL });
  const aR = seed("x_message_analysis", { x_customer_id: REAL, ...IS });
  const MODELS_WITH_IS = ["x_daily_order", "x_daily_order_line", "x_invoice", "x_payment", "x_delivery_route", "x_delivery_stop", "x_purchase_list", "x_supplier_due", "x_supplier_due_line", "x_message_analysis"];
  // the fake Odoo's fields_get is empty: this caller answers it as the tenant does
  const call = async (model: string, method: string, body: any): Promise<any> => {
    if (method === "fields_get") return model === "x_wa_message" ? { x_utak_simulation: {} } : MODELS_WITH_IS.includes(model) ? { x_is_simulation: {}, x_utak_simulation: {} } : {};
    const r = await fetch(`https://odoo.test/json/2/${model}/${method}`, { method: "POST", body: JSON.stringify(body) });
    return r.json();
  };
  const linked = await RP.linkedRecordIds(call, [REAL]);
  const has = (m: string, id: number) => linked[m]?.has(id) === true;
  assert("[ب] the list is #31 and #105", JSON.stringify(RP.REAL_PARTNER_IDS) === "[31,105]", JSON.stringify(RP.REAL_PARTNER_IDS));
  assert("[ب] linked: the real customer's orders (live and cancelled), line, invoice, payment, stop", has("x_daily_order", oR) && has("x_daily_order", oRc) && has("x_daily_order_line", lR) && has("x_invoice", iR) && has("x_payment", pR) && has("x_delivery_stop", sR));
  assert("[ب] linked: the route carrying his stop, the purchase list of his live order's day, its due and due line", has("x_delivery_route", rR) && has("x_purchase_list", plR) && has("x_supplier_due", dR) && has("x_supplier_due_line", dlR));
  assert("[ب] linked: his messages and message analysis", has("x_wa_message", wR) && has("x_message_analysis", aR));
  assert("[ب] NOT linked: the simulation partner's records, and the list of a day with only his cancelled order", !has("x_daily_order", oS) && !has("x_daily_order_line", lS) && !has("x_invoice", iS) && !has("x_payment", pS)
    && !has("x_delivery_stop", sS) && !has("x_delivery_route", rS) && !has("x_purchase_list", plS) && !has("x_purchase_list", plC) && !has("x_supplier_due", dS) && !has("x_supplier_due_line", dlS));
  const sel: Record<string, { ids: number[]; excluded: number[] }> = {};
  for (const m of MODELS_WITH_IS) sel[m] = await RP.selectForMark(call, m, linked);
  const realIds: Record<string, number> = { x_daily_order: oR, x_daily_order_line: lR, x_invoice: iR, x_payment: pR, x_delivery_route: rR, x_delivery_stop: sR, x_purchase_list: plR, x_supplier_due: dR, x_supplier_due_line: dlR, x_message_analysis: aR };
  const simIds: Record<string, number> = { x_daily_order: oS, x_daily_order_line: lS, x_invoice: iS, x_payment: pS, x_delivery_route: rS, x_delivery_stop: sS, x_purchase_list: plS, x_supplier_due: dS, x_supplier_due_line: dlS };
  for (const m of Object.keys(realIds)) {
    assert(`[ب] ${m}: the real customer's record (x_is_simulation) is not selected, and is listed as excluded`, !sel[m].ids.includes(realIds[m]) && sel[m].excluded.includes(realIds[m]), JSON.stringify(sel[m]));
  }
  for (const m of Object.keys(simIds)) {
    assert(`[ب] ${m}: the simulation partner's record is still selected`, sel[m].ids.includes(simIds[m]), JSON.stringify(sel[m]));
  }
  assert("[ب] the day with only his cancelled order: its list is still selected", sel.x_purchase_list.ids.includes(plC));
  // an already marked real record is never selected (nor unmarked): the rule reads x_utak_simulation != true
  seed("x_daily_order", { x_customer_id: REAL, x_state: "confirmed", x_order_date: "2026-09-29", x_is_simulation: true, x_utak_simulation: true });
  const again = await RP.selectForMark(call, "x_daily_order", await RP.linkedRecordIds(call, [REAL]));
  assert("[ب] an already marked record of his is not selected again", again.ids.length === 1 && again.ids[0] === oS, JSON.stringify(again));
  // the mark script uses the rule (scan, mark, verify) and guards its write
  const markSrc = readFileSync(new URL("../scripts/s42-20260927-prelaunch-mark.mts", import.meta.url), "utf8");
  assert("[ب] the pre-launch mark script selects through selectForMark with the real customers' links", /return selectForMark\(call, model, await linked\(\)\);/.test(markSrc) && /linkedRecordIds\(call, REAL_PARTNER_IDS\)/.test(markSrc));
  assert("[ب] the mark script refuses to write a real customer's record, and verify checks its own marks", markSrc.includes("a record linked to a real customer reached the write") && markSrc.includes("among this run's marks"));
  const cutSrc = readFileSync(new URL("../scripts/cutover-prod.mts", import.meta.url), "utf8");
  assert("[ب] the cutover's re-mark (step 3ب) runs that same script, and its dry run names the list", cutSrc.includes("scripts/s42-20260927-prelaunch-mark.mts")
    && cutSrc.includes('markStep(["mark", "--apply", `--rb=${rbName}`])') && cutSrc.includes("REAL_PARTNER_IDS"));
}


// ================================================================ [د]
console.log("\n[د] the rules: the number (15 digits 3…3, Arabic-Indic, spaces), the name, the address, the stop words, the status");
{
  assert("[د] 310123456700003 → accepted", VA.parseVatNumber("310123456700003") === "310123456700003");
  assert("[د] Arabic-Indic digits with spaces «٣١٠ ١٢٣ ٤٥٦٧ ٠٠٠٠٣» → 310123456700003", VA.parseVatNumber("٣١٠ ١٢٣ ٤٥٦٧ ٠٠٠٠٣") === "310123456700003");
  assert("[د] Persian digits and the direction marks WhatsApp copies → accepted", VA.parseVatNumber("\u200f۳۱۰۱۲۳۴۵۶۷۰۰۰۰۳\u200f") === "310123456700003");
  for (const bad of ["31012345670000", "3101234567000033", "210123456700003", "310123456700004", "310-123-456-700-003", "رقمي 310123456700003", "", "abc"]) {
    assert(`[د] «${bad}» → refused`, VA.parseVatNumber(bad) === null);
  }
  assert("[د] a name needs a letter (2–120)", VA.parseLegalName("مؤسسة بيت التمور التجارية") === "مؤسسة بيت التمور التجارية" && VA.parseLegalName("1") === null && VA.parseLegalName("12345") === null);
  assert("[د] an address: 3–200 with a letter or a digit («RRRD2929» and «الملز، شارع الستين»)", VA.parseAddress("RRRD2929") === "RRRD2929" && VA.parseAddress("الملز، شارع الستين") === "الملز، شارع الستين" && VA.parseAddress("..") === null);
  assert("[د] «إيقاف» and «إلغاء» end the questions; «نعم» does not", VA.isVatStopWord("إيقاف") && VA.isVatStopWord("إلغاء") && !VA.isVatStopWord("نعم"));
  assert("[د] an empty status reads «غير معروف»", VA.vatStatusOf({ x_vat_status: false }) === "unknown" && VA.vatStatusOf({ x_vat_status: "registered" }) === "registered");
  assert("[د] the buyer: a number and «مسجّل» → full; «غير مسجّل» with a number → simplified; no number → simplified; «غير معروف» + a number Baraa typed → full",
    TX.buyerTaxInfo({ vat: "310123456700003", x_vat_status: "registered", x_legal_name: "مؤسسة", street: "RRRD2929", city: "الرياض" })?.address === "RRRD2929، الرياض"
    && TX.buyerTaxInfo({ vat: "310123456700003", x_vat_status: "not_registered" }) === null
    && TX.buyerTaxInfo({ vat: false, x_vat_status: "registered" }) === null
    && TX.buyerTaxInfo({ vat: "310123456700003", x_vat_status: false })?.vat === "310123456700003");
  assert("[د] the purpose customer_vat_ask is in wa-purposes (a reply, one hour)", (await import("../src/wa-purposes.ts")).purposePolicy("customer_vat_ask")?.kind === "reply");
}

const DAY = "2026-09-30";
console.log("\n[د] «نعم» all the way: the question after «تأكيد الطلب», a wrong number asked again, Arabic-Indic digits, the name, the address → ONE write «مسجّل»");
{
  fresh(`${DAY} 10:00`); publishedTomato(DAY);
  const o = waiting(DAY, { x_delivery_latitude: 24.7, x_delivery_longitude: 46.7, x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o}`, "تأكيد الطلب ✅");
  const t = texts(C1_PHONE);
  assert("[د] the confirmation, then the question (in that order)", t.length >= 2 && /تم التأكيد ✅/.test(t.at(-2)!) && t.at(-1) === VA.VAT_QUESTION, JSON.stringify(t));
  const btns = vatButtonsOf(C1_PHONE);
  assert("[د] with «نعم» / «لا» buttons", btns.length === 2 && /^vat_yes_501_/.test(btns[0]) && /^vat_no_501_/.test(btns[1]), JSON.stringify(btns));
  assert("[د] asked once: x_vat_ask_count 1, still «غير معروف»", partner().x_vat_ask_count === 1 && partner().x_vat_status === "unknown");
  const rec = rows("x_wa_message").filter((r: any) => String(r.x_debug_payload ?? "").includes("customer_vat_ask"));
  assert("[د] the question recorded (x_wa_message, purpose customer_vat_ask) through the gateway", rec.length === 1 && String(rec[0].x_body).includes("هل منشأتك مسجلة"), JSON.stringify(rows("x_wa_message").map((r: any) => r.x_debug_payload)));
  await tap(C1_PHONE, btns[0], "نعم");
  assert("[د] «نعم» → «اكتب الرقم الضريبي (15 رقماً)»", lastText(C1_PHONE) === VA.VAT_ASK_NUMBER, lastText(C1_PHONE));
  await tap(C1_PHONE, btns[0], "نعم");
  assert("[د] a second «نعم» → «تم هذا الإجراء مسبقاً», not asked twice", lastText(C1_PHONE) === ALREADY_DONE_TEXT, lastText(C1_PHONE));
  await write(C1_PHONE, "31012345");
  assert("[د] a wrong number → asked again", lastText(C1_PHONE) === VA.VAT_BAD_NUMBER, lastText(C1_PHONE));
  await write(C1_PHONE, "٣١٠ ١٢٣ ٤٥٦٧ ٠٠٠٠٣");
  assert("[د] Arabic-Indic digits with spaces → accepted, «اكتب اسم المنشأة كما في السجل التجاري»", lastText(C1_PHONE) === VA.VAT_ASK_NAME, lastText(C1_PHONE));
  assert("[د] …nothing saved yet (no vat, still «غير معروف»)", !partner().vat && partner().x_vat_status === "unknown");
  await write(C1_PHONE, "مؤسسة الوادي للتموين");
  assert("[د] the name → «اكتب العنوان…»", lastText(C1_PHONE) === VA.VAT_ASK_ADDRESS, lastText(C1_PHONE));
  assert("[د] …still nothing saved", !partner().vat && !partner().x_legal_name && partner().x_vat_status === "unknown");
  await write(C1_PHONE, "الملز، شارع الستين 12");
  assert("[د] the address → «تم حفظ بياناتك الضريبية ✅»", lastText(C1_PHONE) === VA.VAT_SAVED, lastText(C1_PHONE));
  const p = partner();
  assert("[د] saved in ONE write: vat, x_legal_name, street, «مسجّل»", p.vat === "310123456700003" && p.x_legal_name === "مؤسسة الوادي للتموين" && p.street === "الملز، شارع الستين 12" && p.x_vat_status === "registered", JSON.stringify(p));
  const writes = (await import("./wa-harness.mts")).odooLog.filter((l: any) => l.model === "res.partner" && l.method === "write" && l.body.ids?.includes(C1) && ("vat" in (l.body.vals ?? {}) || "x_legal_name" in (l.body.vals ?? {}) || "street" in (l.body.vals ?? {})));
  assert("[د] …exactly one write touched the number, the name or the address", writes.length === 1, JSON.stringify(writes.map((w: any) => w.body.vals)));
  assert("[د] the flow is gone (KV and the index)", !(await VA.readVatFlow(ENV, C1)) && !(await VA.readVatIndex(ENV)).includes(C1));
  assert("[د] every step recorded as customer_vat_ask", rows("x_wa_message").filter((r: any) => String(r.x_debug_payload ?? "").includes("customer_vat_ask")).length >= 6);
  const o2 = waiting(DAY, { x_delivery_latitude: 24.7, x_delivery_longitude: 46.7, x_delivery_neighborhood: "العليا" });
  const before = sentTo(C1_PHONE).length;
  await tap(C1_PHONE, `confirm_order_${o2}`, "تأكيد الطلب ✅");
  assert("[د] his next confirmed order: no question («مسجّل»)", sentTo(C1_PHONE).length === before + 1 && /تم التأكيد/.test(lastText(C1_PHONE)) && partner().x_vat_ask_count === 1, JSON.stringify(texts(C1_PHONE).slice(before)));
  assert("[د] no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[د] one question at a time: a second confirmed order while it is open asks nothing; two numbers at once → one step");
{
  fresh(`${DAY} 10:00`); publishedTomato(DAY);
  const o = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o}`);
  const o2 = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  setRiyadh(`${DAY} 10:20`);
  await tap(C1_PHONE, `confirm_order_${o2}`);
  assert("[د] the second confirmation 20 minutes later: confirmed, no second question, x_vat_ask_count still 1",
    /تم التأكيد/.test(lastText(C1_PHONE)) && vatButtonsOf(C1_PHONE).length === 2 && partner().x_vat_ask_count === 1, JSON.stringify(texts(C1_PHONE)));
  await tap(C1_PHONE, vatButtonsOf(C1_PHONE)[0], "نعم");
  // two texts of the same step answered at the same instant (two webhook deliveries racing): the step's KV lock
  const [r1, r2] = await quiet(() => Promise.all([VA.vatFlowReply(ENV, C1, "310123456700003"), VA.vatFlowReply(ENV, C1, "310123456700003")]));
  const got = [r1?.text, r2?.text];
  assert("[د] the same number twice at the same instant: one «اكتب اسم المنشأة», the other nothing (the step's lock), the flow at the name step",
    got.filter((t) => t === VA.VAT_ASK_NAME).length === 1 && got.filter((t) => t === "").length === 1 && (await VA.readVatFlow(ENV, C1))?.step === "name", JSON.stringify(got));
  await write(C1_PHONE, "مؤسسة الوادي");
  assert("[د] …the next text is the name (the lock does not block the next step)", lastText(C1_PHONE) === VA.VAT_ASK_ADDRESS, lastText(C1_PHONE));
}

console.log("\n[د] «لا»: «غير مسجّل», never asked again");
{
  fresh(`${DAY} 10:00`); publishedTomato(DAY);
  const o = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o}`);
  await tap(C1_PHONE, vatButtonsOf(C1_PHONE)[1], "لا");
  assert("[د] «لا» → «غير مسجّل» and the reply", partner().x_vat_status === "not_registered" && lastText(C1_PHONE) === VA.VAT_NO_TEXT, lastText(C1_PHONE));
  assert("[د] …no number saved, the flow gone", !partner().vat && !(await VA.readVatFlow(ENV, C1)));
  const o2 = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o2}`);
  assert("[د] the next confirmed order: no question", vatButtonsOf(C1_PHONE).length === 2 && lastText(C1_PHONE) !== VA.VAT_QUESTION && partner().x_vat_ask_count === 1);
  fresh(`${DAY} 10:00`); publishedTomato(DAY);
  const o3 = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o3}`);
  await write(C1_PHONE, "لا");
  assert("[د] «لا» typed instead of tapped → the same", partner().x_vat_status === "not_registered" && lastText(C1_PHONE) === VA.VAT_NO_TEXT, lastText(C1_PHONE));
}

console.log("\n[د] not asked: «مسجّل», «غير مسجّل», a number on the card, three asks already");
{
  for (const [label, vals] of [
    ["«مسجّل»", { x_vat_status: "registered", vat: "310123456700003" }],
    ["«غير مسجّل»", { x_vat_status: "not_registered" }],
    ["a VAT number Baraa typed (status «غير معروف»)", { vat: "300000000000003" }],
    ["three asks already", { x_vat_ask_count: 3 }],
  ] as Array<[string, Record<string, unknown>]>) {
    fresh(`${DAY} 10:00`); publishedTomato(DAY);
    Object.assign(partner(), vals);
    const o = waiting(DAY, { x_delivery_neighborhood: "العليا" });
    await tap(C1_PHONE, `confirm_order_${o}`);
    assert(`[د] ${label}: confirmed, no question`, /تم التأكيد/.test(lastText(C1_PHONE)) && vatButtonsOf(C1_PHONE).length === 0 && !(await VA.readVatFlow(ENV, C1)), JSON.stringify(texts(C1_PHONE)));
  }
}

console.log("\n[د] 60 minutes without an answer: nothing saved, asked again after the next confirmed order; the third → Baraa's one alert, then never");
{
  let now = `${DAY} 08:00`;
  fresh(now); publishedTomato(DAY);
  const { runVatAskTick } = VA;
  for (let k = 1; k <= 3; k++) {
    setRiyadh(now);
    const o = waiting(DAY, { x_delivery_neighborhood: "العليا" });
    await tap(C1_PHONE, `confirm_order_${o}`);
    assert(`[د] ask ${k}: the question, x_vat_ask_count ${k}`, lastText(C1_PHONE) === VA.VAT_QUESTION && partner().x_vat_ask_count === k, `${lastText(C1_PHONE)} / ${partner().x_vat_ask_count}`);
    if (k === 1) {
      await tap(C1_PHONE, vatButtonsOf(C1_PHONE).at(-2)!, "نعم");
      await write(C1_PHONE, "310123456700003");
      setRiyadh(addMin(now, 30));
      assert("[د] (ask 1) 30 minutes after the number: still open", (await quiet(() => runVatAskTick(ENV)))[0]?.action === "waiting");
      setRiyadh(addMin(now, 91));
      claudeIntent = "other";
      const n = sentTo(C1_PHONE).length;
      await write(C1_PHONE, "مؤسسة متأخرة");
      assert("[د] (ask 1) the name 61 minutes after its prompt: not taken (an ordinary message; the bot answers it)", lastText(C1_PHONE) !== VA.VAT_ASK_ADDRESS && sentTo(C1_PHONE).length > n && !partner().x_legal_name, lastText(C1_PHONE));
      const tk = await quiet(() => runVatAskTick(ENV));
      assert("[د] (ask 1) the tick ends it: «expired», no alert (first ask)", tk[0]?.action === "expired" && !(await VA.readVatFlow(ENV, C1)), JSON.stringify(tk));
      assert("[د] (ask 1) nothing saved: no vat, «غير معروف»", !partner().vat && partner().x_vat_status === "unknown");
      now = addMin(now, 95);
    } else {
      setRiyadh(addMin(now, 61));
      const tk = await quiet(() => runVatAskTick(ENV));
      assert(`[د] (ask ${k}) no tap, 61 minutes: ${k === 3 ? "expired + Baraa's alert" : "expired, no alert"}`, tk[0]?.action === (k === 3 ? "expired_alerted" : "expired"), JSON.stringify(tk));
      now = addMin(now, 65);
    }
  }
  const alerts = sentTo(OWNER).map(bodyOf).filter((t) => t.includes("الرقم الضريبي: سُئل العميل"));
  assert("[د] Baraa's alert: once, with the customer's name", alerts.length === 1 && alerts[0].includes("مطعم الوادي"), JSON.stringify(alerts));
  setRiyadh(now);
  const o4 = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o4}`);
  assert("[د] a fourth confirmed order: no question (three asks)", /تم التأكيد/.test(lastText(C1_PHONE)) && partner().x_vat_ask_count === 3);
  await quiet(() => runVatAskTick(ENV));
  assert("[د] …and no second alert", sentTo(OWNER).map(bodyOf).filter((t) => t.includes("الرقم الضريبي: سُئل العميل")).length === 1);
  assert("[د] no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

console.log("\n[د] the cancel: «إيقاف» during the questions, or the order cancelled → nothing saved");
{
  fresh(`${DAY} 10:00`); publishedTomato(DAY);
  const o = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o}`);
  await tap(C1_PHONE, vatButtonsOf(C1_PHONE)[0], "نعم");
  await write(C1_PHONE, "310123456700003");
  await write(C1_PHONE, "إيقاف");
  assert("[د] «إيقاف» → the questions stop, the reply says nothing was saved", lastText(C1_PHONE) === VA.VAT_STOPPED, lastText(C1_PHONE));
  assert("[د] …nothing saved (no vat, «غير معروف»), the flow gone", !partner().vat && partner().x_vat_status === "unknown" && !(await VA.readVatFlow(ENV, C1)));
  assert("[د] …«إيقاف» here is not the marketing opt-out", partner().x_wa_marketing_optout !== true);
  await write(C1_PHONE, "مؤسسة");
  assert("[د] a text after it is an ordinary message (not the name)", !partner().x_legal_name && lastText(C1_PHONE) !== VA.VAT_ASK_ADDRESS);
  fresh(`${DAY} 10:00`); publishedTomato(DAY);
  const o2 = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o2}`);
  const [yes] = vatButtonsOf(C1_PHONE);
  await tap(C1_PHONE, `cancel_order_${o2}`, "إلغاء ❌");
  assert("[د] the order cancelled → the flow ends", !(await VA.readVatFlow(ENV, C1)) && table("x_daily_order").get(o2)!.x_state === "cancelled");
  await tap(C1_PHONE, yes, "نعم");
  assert("[د] …a late «نعم» → «انتهت مهلة هذا السؤال»", lastText(C1_PHONE) === VA.VAT_EXPIRED, lastText(C1_PHONE));
  fresh(`${DAY} 10:00`); publishedTomato(DAY);
  const o3 = waiting(DAY, { x_delivery_neighborhood: "العليا" });
  await tap(C1_PHONE, `confirm_order_${o3}`);
  table("x_daily_order").get(o3)!.x_state = "cancelled"; // cancelled from Odoo
  const tk = await quiet(() => VA.runVatAskTick(ENV));
  assert("[د] the order cancelled in Odoo → the tick ends the flow", tk[0]?.action === "order_cancelled" && !(await VA.readVatFlow(ENV, C1)), JSON.stringify(tk));
}

console.log("\n[د] the location still pending: a district at the number step is the location, not a wrong number");
{
  fresh(`${DAY} 10:00`); publishedTomato(DAY);
  const o = waiting(DAY);
  await tap(C1_PHONE, `confirm_order_${o}`);
  assert("[د] the confirmation asks for the location, then the question", texts(C1_PHONE).some((t) => /أرسل موقع التوصيل/.test(t)) && lastText(C1_PHONE) === VA.VAT_QUESTION, JSON.stringify(texts(C1_PHONE)));
  await tap(C1_PHONE, vatButtonsOf(C1_PHONE)[0], "نعم");
  await write(C1_PHONE, "الملز");
  assert("[د] «الملز» → the district saved on the order, the flow still at the number", /حفظنا الحي: الملز/.test(lastText(C1_PHONE)) && table("x_daily_order").get(o)!.x_delivery_neighborhood === "الملز" && (await VA.readVatFlow(ENV, C1))?.step === "number", lastText(C1_PHONE));
  await write(C1_PHONE, "310123456700003");
  assert("[د] …then the number is taken", lastText(C1_PHONE) === VA.VAT_ASK_NAME, lastText(C1_PHONE));
}

console.log("\n[د] «سجّله لبكرة» and the standing order: the question follows their confirmation too");
{
  fresh(`${DAY} 21:30`); publishedTomato(DAY); publishedTomato("2026-10-01");
  const { offerLateOrder } = await import("../src/late-order.ts");
  await quiet(() => offerLateOrder(ENV, C1, [{ product_id: 1, packaging_id: 11, quantity: 10, notes: "", label: "طماطم كرتون × 10" }]));
  openWindow(ENV, C1_PHONE);
  await tap(C1_PHONE, `late_yes_${C1}`, "سجّله لبكرة");
  const t = texts(C1_PHONE);
  assert("[د] «سجّله لبكرة»: the order confirmed, then the question", /سجّلنا طلبك رقم/.test(t.at(-2) ?? "") && t.at(-1) === VA.VAT_QUESTION && partner().x_vat_ask_count === 1, JSON.stringify(t));
  fresh(`${DAY} 17:10`); publishedTomato(DAY);
  const st = seed("x_standing_order", { x_customer_id: C1, x_frequency: "daily", x_active: true, x_last_triggered: false });
  seed("x_standing_order_line", { x_standing_id: st, x_product_tmpl_id: 1, x_packaging_id: 11, x_default_quantity: 10, x_notes: false });
  openWindow(ENV, C1_PHONE);
  await tap(C1_PHONE, `standing_confirm_${st}`, "تمام أرسلوها");
  const t2 = texts(C1_PHONE);
  assert("[د] the standing order: confirmed, then the question", /طلبك المعتاد رقم/.test(t2.at(-2) ?? "") && t2.at(-1) === VA.VAT_QUESTION, JSON.stringify(t2));
}

console.log("\n[د] the invoice at delivery (10-01): simplified before the save, full after it — name, number, address printed; delivery never waits");
{
  const deliver = async (riyadh: string): Promise<{ inv: any; text: string; data: any }> => {
    setRiyadh(riyadh);
    const id = seed("x_daily_order", { x_customer_id: C1, x_state: "in_delivery", x_order_date: DAY, x_created_via: "whatsapp", x_delivery_neighborhood: "العليا" });
    seed("x_daily_order_line", { x_order_id: id, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 5, x_status: "pending" });
    seed("x_delivery_stop", { x_order_id: id, x_status: "pending" });
    await tapAs(ENV, `delivered_${id}`, DRIVER);
    const inv = rows("x_invoice").find((i: any) => i.x_order_id === id);
    const data = (await quiet(() => INV.buildInvoicePDFDataFromOdoo(ENV, inv.id)))!;
    return { inv, data, text: plain(INV.renderInvoiceHTML(data, COMPANY)) };
  };
  fresh("2026-10-01 07:00"); publishedTomato(DAY); publishedTomato("2026-10-01"); openWindow(ENV, C1_PHONE);
  // the questions are open (the number given) — delivery does not wait, nothing half-saved
  const o = waiting("2026-10-01", { x_delivery_neighborhood: "العليا" });
  setRiyadh("2026-10-01 07:00");
  await tap(C1_PHONE, `confirm_order_${o}`);
  await tap(C1_PHONE, vatButtonsOf(C1_PHONE)[0], "نعم");
  await write(C1_PHONE, "310123456700003");
  const a = await deliver("2026-10-01 07:10");
  assert("[د] delivered while the questions wait: issued at once, «فاتورة ضريبية مبسطة»", !!a.inv && a.text.includes("فاتورة ضريبية مبسطة"), a.text.slice(0, 200));
  assert("[د] …the order's customer name and district, no buyer VAT number", a.data.customer.name === "مطعم الوادي" && a.data.customer.address === "العليا" && !a.data.customer.vat && !a.text.includes("310123456700003"), JSON.stringify(a.data.customer));
  await write(C1_PHONE, "مؤسسة الوادي للتموين");
  await write(C1_PHONE, "RRRD2929 الملز");
  assert("[د] then saved «مسجّل»", partner().x_vat_status === "registered");
  const b = await deliver("2026-10-01 08:40");
  assert("[د] the next delivery: «فاتورة ضريبية» (not «مبسطة»)", b.text.includes("فاتورة ضريبية") && !b.text.includes("فاتورة ضريبية مبسطة"), b.text.slice(0, 200));
  assert("[د] …the establishment's official name printed (not the WhatsApp name)", b.text.includes("مؤسسة الوادي للتموين") && b.data.customer.name === "مؤسسة الوادي للتموين");
  assert("[د] …its VAT number printed", b.text.includes("310123456700003") && b.data.customer.vat === "310123456700003");
  assert("[د] …its address printed (the street it gave)", b.text.includes("RRRD2929 الملز") && b.data.customer.address === "RRRD2929 الملز", JSON.stringify(b.data.customer));
  partner().x_vat_status = "not_registered";
  const c = await deliver("2026-10-01 09:00");
  assert("[د] Baraa sets «غير مسجّل» on the card (the number stays): simplified again", c.text.includes("فاتورة ضريبية مبسطة") && !c.data.customer.vat);
  const d = await deliver("2026-09-30 20:00");
  assert("[د] before 10-01 the status changes nothing: «فاتورة», no VAT", !d.text.includes("فاتورة ضريبية") && !d.data.customer.vat, d.text.slice(0, 120));
  assert("[د] no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ summary
console.log(`\n${passed} ✓, ${failed} ✗`);
if (failed) { console.log("failed:\n  " + failures.join("\n  ")); process.exit(1); }
