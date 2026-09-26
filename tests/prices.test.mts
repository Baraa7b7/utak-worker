// «أسعار اليوم» — build, review, approve, publish (STATUS § 35), with the
// pricing engine v1 since STATUS § 40 ج (the engine's own rules and the
// exceptions: tests/pricing-v1.test.mts).
//
//   [0] the rules kept from § 35: the deadline (ORDERING_HOURS_OPEN,
//       PRICES_DEADLINE); the message (sale price and packaging only, cut into
//       parts).
//   [1] refresh: the day's record from the day's offers only (a supplier's
//       latest price, a failed extraction out); purchase / market / sale /
//       profit / status on the line; unchanged → skipped; Baraa's decision kept;
//       approved / published never touched.
//   [2] publish: only an approved day, once; customers by the gateway (text
//       inside the window, held + opener outside); opted-out / held / team /
//       Baraa not recipients; Baraa's copy with the counts, «لم يُنشر», one line
//       with the undecided exceptions; blocked / mismatched → nothing sent.
//   [3] the publication time: approved and published by the worker; nothing
//       approved → «missed» + one alert; no record → one created; yesterday's
//       prices never re-sent; a late decision and approval publishes.
//   [4] the tick and the Odoo hook (401 / 400 / 202, publish, refresh), a lost
//       webhook retried.
//   [5] quotes and invoices: today's published price first, else as before.
//   [6] list_price / standard_price: never written (the flows and src/).
//   [7] schema: every Odoo call names real fields and selection values.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/prices.test.mts

import { readdirSync, readFileSync } from "node:fs";
import {
  CUST, CUST_PHONE, CUST2, CUST2_PHONE, COLL_PHONE, OWNER, graph, heldFor, odooLog, openWindow,
  quiet, reset, rows, seed, sentTo, setRiyadh, table,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const FX = [
  "./fixtures-odoo-fields-20260924.json", "./fixtures-odoo-fields-20260925-review.json", "./fixtures-odoo-fields-20260925-gateway.json",
  "./fixtures-odoo-fields-20260925-team.json", "./fixtures-odoo-fields-20260925-opener.json", "./fixtures-odoo-fields-20260925-prices.json",
  // STATUS § 36 — x_body_text / x_buttons_text, x_echo_status / x_echo_message_id / x_backfilled
  "./fixtures-odoo-fields-20260925-s36.json",
  // STATUS § 40 — the engine's fields, the sources, the offers, the settings (the tenant after § 40)
  "./fixtures-odoo-fields-20260926-s40.json",
  // STATUS § 41 — «مسجل في الضريبة» on the sources, x_utak_simulation on the per-day models
  "./fixtures-odoo-fields-20260926-s41.json",
].map(load);
const REAL: Record<string, string[]> = Object.assign({}, ...FX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FX.map((f) => f._selections));
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
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body) {
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
      return new Response(JSON.stringify({ name: "builtins.ValueError", message: "Invalid" }), { status: 500 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const P = await import("../src/prices.ts");
const { pricesDeadlineMinutes, buildPriceMessages, refreshPriceDay, publishPriceDay, checkPricesDeadline, runPricesTick, priceRecipients } = P;
const { clearTemplateCache } = await import("../src/templates.ts");
const { getLatestSalePrice } = await import("../src/odoo.ts");
const worker = (await import("../src/index.ts")).default;

const SUP_A = 801, SUP_B = 802;
const OBS = 820;   // a price source that is not a supplier (market observations)
const OPT = 811, OPT_PHONE = "966500000811";
const HELD = 812, HELD_PHONE = "966500000812";
const PERS = 813, PERS_PHONE = "966500000813";
const OWNERP = 814;
const TODAY = "2026-09-26", YESTERDAY = "2026-09-25";

function fresh(riyadh = "2026-09-26 04:00", opts: { openerUsable?: boolean } = {}): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0;
  env.ODOO_HOOK_TOKEN = "HOOK";
  seed("res.partner", { id: 42, name: "UTAK بوت" });
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  // § 40 ب — the sources: two suppliers and an observer, «مصدر أسعار» ticked
  seed("res.partner", { id: SUP_A, name: "أحمد حسان", supplier_rank: 5, x_whatsapp_number: "+966500000801", x_price_source: true });
  seed("res.partner", { id: SUP_B, name: "خالد", supplier_rank: 1, x_whatsapp_number: "+966500000802", x_price_source: true });
  seed("res.partner", { id: OBS, name: "عمر", supplier_rank: 0, x_whatsapp_number: "+966500000820", x_price_source: true });
  seed("res.partner", { id: OPT, name: "موقوف", customer_rank: 1, x_whatsapp_number: "+" + OPT_PHONE, x_wa_marketing_optout: true });
  seed("res.partner", { id: HELD, name: "ينتظر المراجعة", customer_rank: 1, x_whatsapp_number: "+" + HELD_PHONE, x_contact_class: "unreviewed", x_review_pending: true, x_ai_intent: "vendor_pitch" });
  seed("res.partner", { id: PERS, name: "شخصي", customer_rank: 1, x_whatsapp_number: "+" + PERS_PHONE, x_contact_class: "personal" });
  seed("res.partner", { id: OWNERP, name: "Bara.a - U TAK", customer_rank: 1, x_whatsapp_number: "+" + OWNER });
  // a team member who is also a customer (as Othman on the tenant): never a price recipient
  table("res.partner").get(602)!.customer_rank = 1;
  // the active catalog, and the settings (waste 5 %)
  Object.assign(table("product.template").get(1)!, { sale_ok: true, x_is_active_for_sale: true });
  Object.assign(table("product.template").get(2)!, { sale_ok: true, x_is_active_for_sale: true });
  table("x_product_packaging").get(11)!.x_is_default = true;
  table("x_product_packaging").get(21)!.x_is_default = true;
  seed("x_pricing_config", { id: 1, x_name: "cfg", x_is_active: true, x_active_from: "2026-08-29", x_active_to: false, x_waste_pct: 5, x_min_order_sar: 150, x_planned_stops: 0 });
  if (opts.openerUsable) {
    seed("x_whatsapp_template", { x_purpose: "conv_open_customer", x_meta_template_id: "utak_update_customer", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  } else {
    // as at Meta today (STATUS § 34): filed MARKETING → never used
    seed("x_whatsapp_template", { x_purpose: "conv_open_customer", x_meta_template_id: "utak_update_customer", x_language: "ar", x_meta_status: "PENDING", x_param_count: 2, x_category: "MARKETING" });
  }
  return env;
}
/** A supplier's purchase price (x_daily_price, § 26). */
function price(product: number, packaging: number, supplier: number, p: number, date = TODAY, status = "extracted"): number {
  return seed("x_daily_price", { x_product_tmpl_id: product, x_packaging_id: packaging, x_supplier_id: supplier, x_price_sar: p, x_date: date, x_extraction_status: status });
}
/** A market observation (x_price_offer, § 40 ب). */
function market(product: number, packaging: number, p: number, source = OBS, date = TODAY): number {
  return seed("x_price_offer", { x_product_tmpl_id: product, x_packaging_id: packaging, x_source_partner_id: source, x_market_price: p, x_purchase_price: 0, x_date: date, x_status: "valid", x_utak_simulation: false });
}
const dayRec = (d = TODAY) => rows("x_price_day").find((r) => r.x_date === d);
const linesOf = (id: number) => rows("x_price_day_line").filter((l) => l.x_day_id === id);
const lineOf = (id: number, product: number) => linesOf(id).find((l) => l.x_product_tmpl_id === product)!;
const txt = (to: string) => sentTo(to).filter((b) => b.type === "text").map((b) => String(b.text?.body ?? ""));
/** The Odoo «نشر المعتمد الآن» code action, mirrored (the real one: scripts/s40-20260926-engine.mjs APPROVE_CODE). */
function approveInOdoo(id: number): string | null {
  const d = table("x_price_day").get(id)!;
  if (!["draft", "missed"].includes(String(d.x_state))) return "not draft";
  const ls = linesOf(id);
  if (!ls.some((l) => ["auto", "manual"].includes(String(l.x_status)) && !l.x_excluded && Number(l.x_sale_price) > 0)) return "nothing publishable";
  Object.assign(d, { x_state: "approved", x_approved_by: 2, x_approved_at: new Date().toISOString().replace("T", " ").slice(0, 19) });
  return null;
}
const waits: Promise<unknown>[] = [];
const ctxW = { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException: () => {} } as any;
async function hook(env: any, op: string, id: number, token = "HOOK"): Promise<Response> {
  waits.length = 0;
  const r = await quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/prices?token=${token}&op=${op}`, {
    method: "POST", body: JSON.stringify({ _model: "x_price_day", _id: id, x_date: table("x_price_day").get(id)?.x_date }), headers: { "Content-Type": "application/json" },
  }), env, ctxW));
  await quiet(() => Promise.all(waits));
  return r;
}

// ================================================================ 0. rules
console.log("\n[0] the rules kept from § 35 (the margin rule is gone: § 40 ج)");
{
  assert("deadline = ORDERING_HOURS_OPEN (06:00)", JSON.stringify(pricesDeadlineMinutes({} as any)) === JSON.stringify({ minutes: 360, source: "ORDERING_HOURS_OPEN" }));
  assert("PRICES_DEADLINE=07:00 overrides; invalid → 06:00", pricesDeadlineMinutes({ PRICES_DEADLINE: "07:00" } as any).minutes === 420 && pricesDeadlineMinutes({ PRICES_DEADLINE: "7am" } as any).minutes === 360);
  const msg = buildPriceMessages(TODAY, [{ productName: "[UTAK-VEG-001] طماطم", packagingName: "كرتون", salePrice: 30 }, { productName: "خيار", packagingName: "جرم", salePrice: 15.5 }]);
  assert("the message: title with the day, «• الصنف (التعبئة): السعر ر.س», the cutoff", msg.length === 1 && msg[0].startsWith("🌿 أسعار يو تاك اليوم — السبت 26 سبتمبر 2026") && msg[0].includes("• طماطم (كرتون): 30 ر.س") && msg[0].includes("• خيار (جرم): 15.50 ر.س") && msg[0].includes("قبل الساعة 9:00 مساءً"), msg[0]);
  const many = Array.from({ length: 150 }, (_, i) => ({ productName: `صنف رقم ${i + 1} بطول معقول`, packagingName: "كرتون · 10 كيلو", salePrice: 10 + i }));
  const parts = buildPriceMessages(TODAY, many);
  assert("a long list is cut into parts ≤ 3500 characters, numbered, every item once, the footer at the end",
    parts.length > 1 && parts.every((p) => p.length <= 3500) && parts[0].includes(`(1/${parts.length})`) && many.every((m) => parts.join("\n").includes(m.productName)) && parts[parts.length - 1].includes("قبل الساعة") && !parts[0].includes("قبل الساعة"),
    parts.map((p) => p.length).join(","));
}

// ================================================================ 1. refresh
console.log("\n[1] refresh: the day's record from the day's offers (the engine)");
{
  const env = fresh("2026-09-26 03:00");
  price(1, 11, SUP_A, 99, YESTERDAY);
  market(1, 11, 120, OBS, YESTERDAY);
  assert("no offer today (yesterday's exist) → nothing built", (await quiet(() => refreshPriceDay(env))).action === "no_prices" && !dayRec());
  price(1, 11, SUP_A, 30);
  const b = price(1, 11, SUP_B, 25);
  price(1, 11, SUP_B, 10, TODAY, "failed");
  market(1, 11, 32);
  price(2, 21, SUP_A, 14);
  const r1 = await quiet(() => refreshPriceDay(env));
  const d = dayRec()!;
  assert("today's record created (draft), one line per product+packaging", r1.action === "refreshed" && d.x_state === "draft" && linesOf(d.id).length === 2, JSON.stringify(r1));
  const t = lineOf(d.id, 1), c = lineOf(d.id, 2);
  assert("tomato: the lowest purchase (خالد 25, not the failed 10), market 32 → sale 32, profit 5.75, auto",
    t.x_supplier_id === SUP_B && t.x_daily_price_id === b && t.x_cost_price === 25 && t.x_market_price === 32 && t.x_sale_price === 32
      && t.x_unit_profit === 5.75 && t.x_status === "auto" && !t.x_excluded, JSON.stringify(t));
  assert("cucumber: no market price → an exception, not published", c.x_status === "exception" && c.x_excluded === true && c.x_sale_price === 0 && /لا سعر سوق/.test(String(c.x_reason)), JSON.stringify(c));
  assert("the offers shown on the line", t.x_offers === "خالد: شراء 25 · أحمد حسان: شراء 30 · عمر: سوق 32", String(t.x_offers));
  assert("run again with nothing new → unchanged", (await quiet(() => refreshPriceDay(env))).action === "unchanged");
  price(1, 11, SUP_A, 22);
  await quiet(() => refreshPriceDay(env));
  assert("a supplier's later price replaces his earlier one (أحمد 30 → 22): the new lowest", lineOf(d.id, 1).x_cost_price === 22 && String(lineOf(d.id, 1).x_offers).startsWith("أحمد حسان: شراء 22"), JSON.stringify(lineOf(d.id, 1)));
  Object.assign(lineOf(d.id, 2), { x_decision: "skip" });
  await quiet(() => refreshPriceDay(env));
  assert("Baraa's decision on a line is kept by the next refresh («لا تنشر»)", lineOf(d.id, 2).x_status === "unpublished" && lineOf(d.id, 2).x_reason === "براء: لا تنشر" && !!lineOf(d.id, 2).x_decided_at, JSON.stringify(lineOf(d.id, 2)));
  // locked
  const env5 = fresh("2026-09-26 03:00");
  price(1, 11, SUP_A, 30);
  market(1, 11, 33);
  await quiet(() => refreshPriceDay(env5));
  approveInOdoo(dayRec()!.id);
  price(1, 11, SUP_B, 20);
  const r5 = await quiet(() => refreshPriceDay(env5, { force: true }));
  assert("an approved day is never touched", r5.action === "locked" && lineOf(dayRec()!.id, 1).x_cost_price === 30);
}

// ================================================================ 2. publish
console.log("\n[2] publish: only approved, once, through the gateway");
{
  const env = fresh("2026-09-26 05:30", { openerUsable: true });
  price(1, 11, SUP_A, 25);
  market(1, 11, 30);
  price(2, 21, SUP_B, 14);
  await quiet(() => refreshPriceDay(env));
  const id = dayRec()!.id;
  assert("a draft is not published", (await quiet(() => publishPriceDay(env, id))).action === "not_approved" && graph.length === 0);
  openWindow(env, CUST_PHONE, 30);
  assert("approve (Odoo) — the cucumber exception does not block", approveInOdoo(id) === null && dayRec()!.x_state === "approved");
  const before = graph.length;
  const r = await quiet(() => publishPriceDay(env, id));
  assert("published: 1 item, recipients = the two plain customers", r.action === "published" && r.items === 1 && r.recipients === 2, JSON.stringify(r));
  const c1 = txt(CUST_PHONE);
  assert("inside the window: the list as text, at the market price", c1.length === 1 && c1[0].includes("• طماطم (كرتون): 30 ر.س"), JSON.stringify(c1));
  assert("…no purchase price, no source, no margin in it", !/25|أحمد|خالد|عمر|هامش|%/.test(c1[0].replace("2026", "").replace("26 سبتمبر", "")), c1[0]);
  assert("…and not the cucumber exception", !c1[0].includes("خيار"));
  assert("outside the window: held for the day, + utak_update_customer [account, «أسعار اليوم»]",
    heldFor(env, CUST2_PHONE).some((i) => i.purpose === "customer_prices") && sentTo(CUST2_PHONE).some((b) => b.template?.name === "utak_update_customer" && b.template.components[0].parameters.map((p: any) => p.text).join("|") === `${CUST2}|أسعار اليوم`),
    JSON.stringify(sentTo(CUST2_PHONE)));
  const nobody = [OPT_PHONE, HELD_PHONE, PERS_PHONE, COLL_PHONE];
  assert("opted out / review-held / «شخصي» / team: nothing at all", nobody.every((p) => sentTo(p).length === 0 && heldFor(env, p).length === 0));
  const own = txt(OWNER);
  assert("Baraa: the counts, «لم يُنشر», and the same list", own.some((t) => t.startsWith("📢 نُشرت أسعار السبت 26 سبتمبر 2026. الأصناف: 1، والعملاء: 2.") && t.includes("نصاً 1 · محفوظة حتى رسالتهم 1") && t.includes("لم يُنشر: خيار") && t.includes("• طماطم (كرتون): 30 ر.س")), JSON.stringify(own));
  assert("…and one line with the number of exceptions left without a decision", own.filter((t) => t.startsWith("⏰ لم يُنشر اليوم 1 صنف: استثناء بلا قرار")).length === 1, JSON.stringify(own));
  assert("the cucumber line: «لم يُنشر» with the reason", lineOf(id, 2).x_status === "unpublished" && String(lineOf(id, 2).x_reason).startsWith("استثناء بلا قرار عند النشر"), JSON.stringify(lineOf(id, 2)));
  assert("the record: published, with its time and report", dayRec()!.x_state === "published" && !!dayRec()!.x_published_at && String(dayRec()!.x_publish_report).includes("لم يُنشر: خيار"));
  const n = graph.length;
  assert("publishing again → «already», nothing sent", (await quiet(() => publishPriceDay(env, id))).action === "already" && graph.length === n);
  assert("the customers' sends came from this publication only", graph.length - before >= 3);

  // the opener as at Meta today (MARKETING): held, no opener
  const env2 = fresh("2026-09-26 05:30");
  price(1, 11, SUP_A, 25);
  market(1, 11, 30);
  await quiet(() => refreshPriceDay(env2));
  approveInOdoo(dayRec()!.id);
  await quiet(() => publishPriceDay(env2, dayRec()!.id));
  assert("utak_update_customer MARKETING (as at Meta): no opener, the list held for the customer's next message", heldFor(env2, CUST_PHONE).length === 1 && !sentTo(CUST_PHONE).some((b) => b.type === "template"));

  // blocked / mismatch → nothing sent
  const env3 = fresh("2026-09-26 05:30");
  price(1, 11, SUP_A, 25);
  market(1, 11, 30);
  await quiet(() => refreshPriceDay(env3));
  approveInOdoo(dayRec()!.id);
  lineOf(dayRec()!.id, 1).x_blocked = true; // marked by hand in Odoo
  const r3 = await quiet(() => publishPriceDay(env3, dayRec()!.id));
  assert("an approved day with a line marked «يمنع الاعتماد» → blocked, no customer send", r3.action === "blocked" && sentTo(CUST_PHONE).length === 0 && sentTo(CUST2_PHONE).length === 0);
  const env4 = fresh("2026-09-26 05:30");
  price(1, 11, SUP_A, 25);
  market(1, 11, 30);
  await quiet(() => refreshPriceDay(env4));
  approveInOdoo(dayRec()!.id);
  lineOf(dayRec()!.id, 1).x_sale_price = 99; // Odoo's value no longer the rule (market 30)
  const r4 = await quiet(() => publishPriceDay(env4, dayRec()!.id));
  assert("a stored sale price that is not the rule → not published", r4.action === "mismatch" && sentTo(CUST_PHONE).length === 0);

  // recipients
  const env5 = fresh();
  const rc = await quiet(() => priceRecipients(env5));
  assert("recipients: customers with a number, minus opted-out, review-held, personal, team, Baraa", rc.map((x) => x.id).sort().join() === [CUST, CUST2].sort().join(), JSON.stringify(rc));
}

// ================================================================ 3. the publication time
console.log("\n[3] the publication time (06:00): approved and published by the worker");
{
  const env = fresh("2026-09-26 05:55");
  price(1, 11, SUP_A, 25);
  market(1, 11, 30);
  price(2, 21, SUP_A, 14);
  await quiet(() => refreshPriceDay(env));
  assert("05:55 → before", (await quiet(() => checkPricesDeadline(env))).action === "before");
  setRiyadh("2026-09-26 06:00");
  const r = await quiet(() => checkPricesDeadline(env));
  assert("06:00: the auto line published, the day «منشورة», without Baraa", r.action === "auto_published" && (r.publish as any)?.action === "published" && dayRec()!.x_state === "published"
    && heldFor(env, CUST_PHONE).length === 1 && String(dayRec()!.x_publish_report).includes("اعتماد تلقائي"), JSON.stringify(r));
  assert("…the undecided cucumber not published, one line to Baraa", txt(OWNER).filter((t) => t.startsWith("⏰ لم يُنشر اليوم 1 صنف")).length === 1 && lineOf(dayRec()!.id, 2).x_status === "unpublished");
  setRiyadh("2026-09-26 06:05");
  assert("the next tick → once only", (await quiet(() => checkPricesDeadline(env))).action === "claimed_before");

  // nothing approved: «missed», one alert; a late decision + approval publishes
  const envM = fresh("2026-09-26 05:30");
  price(1, 11, SUP_A, 25);
  await quiet(() => refreshPriceDay(envM));
  setRiyadh("2026-09-26 06:00");
  const rm = await quiet(() => checkPricesDeadline(envM));
  assert("06:00 with exceptions only → «missed», one alert, no customer send", rm.action === "missed" && dayRec()!.x_state === "missed"
    && txt(OWNER).filter((t) => t.startsWith("⏰ أسعار اليوم")).length === 1 && sentTo(CUST_PHONE).length === 0 && heldFor(envM, CUST_PHONE).length === 0, JSON.stringify(txt(OWNER)));
  setRiyadh("2026-09-26 07:30");
  Object.assign(lineOf(dayRec()!.id, 1), { x_decision: "edit", x_manual_price: 29 });
  await quiet(() => refreshPriceDay(envM, { force: true }));
  assert("a late decision (سعر معدّل 29) then approval (from «missed») is allowed", approveInOdoo(dayRec()!.id) === null);
  const lp = await quiet(() => publishPriceDay(envM, dayRec()!.id));
  assert("…and publishes at his price", lp.action === "published" && heldFor(envM, CUST_PHONE).length === 1 && String(heldFor(envM, CUST_PHONE)[0]?.body?.text?.body ?? JSON.stringify(heldFor(envM, CUST_PHONE)[0])).includes("29"),
    JSON.stringify(heldFor(envM, CUST_PHONE)[0]).slice(0, 200));

  // nothing today, yesterday published: missed, nothing re-sent
  const env2 = fresh("2026-09-26 06:00");
  const y = seed("x_price_day", { x_date: YESTERDAY, x_state: "published", x_name: "أمس" });
  seed("x_price_day_line", { x_day_id: y, x_product_tmpl_id: 1, x_packaging_id: 11, x_cost_price: 20, x_market_price: 24, x_sale_price: 24, x_status: "auto", x_excluded: false, x_blocked: false });
  const r2 = await quiet(() => checkPricesDeadline(env2));
  assert("no offer today (yesterday published) → today's record «missed», every line an exception", r2.action === "missed" && dayRec()!.x_state === "missed"
    && linesOf(dayRec()!.id).length === 2 && linesOf(dayRec()!.id).every((l) => l.x_status === "exception"));
  assert("…yesterday's prices are not re-sent to anyone", sentTo(CUST_PHONE).length === 0 && sentTo(CUST2_PHONE).length === 0 && heldFor(env2, CUST_PHONE).length === 0);
  assert("…Baraa told no price came", txt(OWNER).some((t) => t.includes("لم يصل سعر من المصادر اليوم") && t.includes("لا تُعاد أسعار أمس")), JSON.stringify(txt(OWNER)));
  const env3 = fresh("2026-09-26 09:00");
  assert("09:00 (a worker down at 06:00) → no late alert", (await quiet(() => checkPricesDeadline(env3))).action === "after_window" && !dayRec());
  const env4 = fresh("2026-09-26 06:00");
  const pub = seed("x_price_day", { x_date: TODAY, x_state: "published", x_name: "اليوم" });
  assert("an already published day at the deadline → untouched", (await quiet(() => checkPricesDeadline(env4))).action === "published" && table("x_price_day").get(pub)!.x_state === "published");
}

// ================================================================ 4. tick + hook
console.log("\n[4] the tick and the Odoo hook");
{
  const env = fresh("2026-09-26 04:00");
  price(1, 11, SUP_A, 25);
  market(1, 11, 30);
  const t1 = await quiet(() => runPricesTick(env, Date.now()));
  assert("the tick builds the day from the offers", (t1.refresh as any)?.action === "refreshed" && !!dayRec());
  const id = dayRec()!.id;
  assert("hook: no token → 401", (await hook(env, "approved", id, "bad")).status === 401);
  assert("hook: unknown op → 400", (await hook(env, "delete", id)).status === 400);
  price(1, 11, SUP_B, 21);
  assert("hook refresh → 202 and the record follows (forced)", (await hook(env, "refresh", id)).status === 202 && lineOf(id, 1).x_cost_price === 21);
  assert("hook approved on a draft → 202, nothing published", (await hook(env, "approved", id)).status === 202 && dayRec()!.x_state === "draft" && sentTo(CUST_PHONE).length === 0);
  approveInOdoo(id);
  const h = await hook(env, "approved", id);
  assert("hook approved after the Odoo check → published", h.status === 202 && dayRec()!.x_state === "published" && heldFor(env, CUST_PHONE).length === 1);
  // a lost webhook: the tick publishes an approval older than 3 minutes
  const env2 = fresh("2026-09-26 04:00");
  price(1, 11, SUP_A, 25);
  market(1, 11, 30);
  await quiet(() => refreshPriceDay(env2));
  approveInOdoo(dayRec()!.id);
  setRiyadh("2026-09-26 04:01");
  const t2 = await quiet(() => runPricesTick(env2, Date.now()));
  assert("the tick waits for the webhook (< 3 min)", !t2.publish && dayRec()!.x_state === "approved");
  setRiyadh("2026-09-26 04:05");
  const t3 = await quiet(() => runPricesTick(env2, Date.now()));
  assert("…then publishes it (> 3 min)", (t3.publish as any)?.action === "published" && dayRec()!.x_state === "published");
  setRiyadh("2026-09-26 04:10");
  const n = graph.length;
  const t4 = await quiet(() => runPricesTick(env2, Date.now()));
  assert("…once", !t4.publish && graph.length === n, JSON.stringify({ t4, g: graph.slice(n) }));
}

// ================================================================ 5. quotes / invoices
console.log("\n[5] quotations and invoices: today's published price first");
{
  const env = fresh("2026-09-26 08:00");
  price(1, 11, SUP_A, 25);
  market(1, 11, 30);
  table("x_daily_price").get(rows("x_daily_price")[0].id)!.x_sale_price = 34.5; // § 26's own computed price
  await quiet(() => refreshPriceDay(env));
  assert("not published yet → as before (the supplier row's sale price)", (await quiet(() => getLatestSalePrice(env, 1, 11))).price === 34.5);
  approveInOdoo(dayRec()!.id);
  await quiet(() => publishPriceDay(env, dayRec()!.id));
  const p = await quiet(() => getLatestSalePrice(env, 1, 11));
  assert("published → the published price (30, the market), source today", p.price === 30 && p.source === "today", JSON.stringify(p));
  const other = await quiet(() => getLatestSalePrice(env, 2, 21));
  assert("a product not in today's list → as before (here: no price at all)", other.source === "missing" && other.price === 0, JSON.stringify(other));
}

// ================================================================ 6. list_price
console.log("\n[6] list_price / standard_price are never written");
{
  const writes = odooLog.filter((c) => c.model === "product.template" && ["write", "create"].includes(c.method));
  assert("no product.template write in any flow above", writes.length === 0, JSON.stringify(writes.slice(0, 2)));
  const SRC = new URL("../src/", import.meta.url);
  const offenders = readdirSync(SRC).filter((f) => f.endsWith(".ts")).filter((f) => {
    const code = readFileSync(new URL(f, SRC), "utf8");
    return /["']product\.template["']\s*,\s*["']write["']/.test(code) || /(list_price|standard_price)\s*:/.test(code);
  });
  assert("src/: no product.template write, no list_price / standard_price value", offenders.length === 0, offenders.join(","));
}

// ================================================================ 7. schema
console.log("\n[7] schema gate");
assert("every Odoo call named real fields and selection values", rejected.length === 0, rejected.slice(0, 5).join(" | "));

console.log(`\n${passed} ✓  ${failed} ✗`);
if (failed) { console.log("failures:\n  " + failures.join("\n  ")); process.exit(1); }
