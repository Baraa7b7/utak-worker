// § 42 — the launch (2026-09-27).
//
//   [أ] «مشتريات السوق النقدية»: a purchase-list line whose winning purchase
//       price came from a source that is not a supplier (Omar) is owed to it at
//       Omar's written price — Ahmed's due is untouched and no «بلا سعر» line
//       lands under Ahmed; a winner that is a supplier, a simulation day and a
//       missing partner; its payments through Omar's steps and Baraa's
//       approval with no notice; the gateway never sends it anything.
//   [س] schema: every Odoo request names real fields and values (§ 42 fixture).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s42.test.mts

import { readFileSync } from "node:fs";
import {
  COLL, COLL_PHONE, OWNER, computes, employee, graph, inbound, openWindow, ownerAlerts, quiet, reset, rows, seed, sentTo, setRiyadh, signed, table,
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
  "./fixtures-odoo-fields-20260925-s36.json", "./fixtures-odoo-fields-20260925-s37.json", "./fixtures-odoo-fields-20260926-s37-sim.json",
  "./fixtures-odoo-fields-20260926-s41.json",
  // § 42 — fields_get of 2026-09-27 (scripts/s42-20260927-fields-fixture.mjs), the dues and the accounting twins included
  "./fixtures-odoo-fields-20260927-s42.json",
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

const SPM = await import("../src/supplier-pay.ts");
const { syncSupplierDues, settlePayment, planDues, SP_START, SP_SKIP, SP_TEXT, CASH_MARKET_NOTICE } = SPM;
const CM = await import("../src/cash-market.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const { textContent } = await import("../src/meta.ts");
const { clearTemplateCache } = await import("../src/templates.ts");
const worker = (await import("../src/index.ts")).default;

// ---------------------------------------------------------------- data
const DAY = "2026-09-27";
const AHMED = 701, AHMED_PHONE = "966500000701";
const CASH = 104;
const BOT = 42;
let ENV: any;
let seqN = 0;
const odooTs = () => new Date(Date.now()).toISOString().replace("T", " ").slice(0, 19);

/** Omar is the harness collector (COLL, «سالم»): a price source employee with the collection role. */
function fresh(riyadh = `${DAY} 10:00`, opts: { cash?: boolean } = {}): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0; seqN = 0;
  env.ODOO_HOOK_TOKEN = "HOOKTOKEN";
  seed("res.partner", { id: BOT, name: "UTAK بوت" });
  seed("res.partner", { id: 3, name: "albaraa abdulwahab" });
  seed("res.users", { id: 2, login: "admin", partner_id: 3, name: "albaraa abdulwahab" });
  seed("res.partner", { id: AHMED, name: "أحمد حسان", x_whatsapp_number: "+" + AHMED_PHONE, supplier_rank: 5, x_price_source: true, x_vat_registered: true });
  if (opts.cash !== false) seed("res.partner", { id: CASH, name: "مشتريات السوق النقدية", ref: "UTAK-CASH-MARKET", supplier_rank: 1, x_vat_registered: true, x_price_source: false, x_wa_allowed: false, x_contact_class: "supplier" });
  const omarEmp = table("hr.employee").get(7000 + COLL) as any;
  Object.assign(omarEmp, { x_price_source: true, x_vat_registered: true });
  seed("product.template", { id: 3, name: "[UTAK-VEG-003] بطاطس" });
  seed("product.template", { id: 4, name: "[UTAK-FRT-004] افوكادو" });
  seed("product.template", { id: 5, name: "[UTAK-FRT-005] رمان صغير" });
  seed("x_product_packaging", { id: 31, x_name: "كرتون · 10 كيلو", x_product_tmpl_id: 3 });
  seed("x_product_packaging", { id: 41, x_name: "كرتون · 4 كيلو", x_product_tmpl_id: 4 });
  seed("x_product_packaging", { id: 51, x_name: "صندوق", x_product_tmpl_id: 5 });
  computes["x_supplier_payment"] = (r: any) => {
    if (r.x_name) return;
    r.x_name = `SP-2026-${String(++seqN).padStart(4, "0")}`;
    if (!r.x_date) r.x_date = DAY;
    r.x_amount = Math.round(Number(r.x_amount) * 100) / 100;
    if (r.x_channel === "whatsapp") { if (!r.x_state) r.x_state = "pending"; }
    else Object.assign(r, { x_channel: "odoo", x_state: "approved", x_decided_by: 2, x_decided_at: odooTs(), x_recorded_by: r.x_recorded_by || 3 });
  };
  return env;
}
function dailyPrice(supplier: number, product: number, packaging: number, p: number, extra: Record<string, unknown> = {}): number {
  return seed("x_daily_price", { x_supplier_id: supplier, x_product_tmpl_id: product, x_packaging_id: packaging, x_date: DAY, x_price_sar: p, x_extraction_status: "extracted", ...extra });
}
/** «أسعار اليوم» of DAY: potato won by Ahmed (20), avocado by Omar (11.5 — Ahmed said 13), small pomegranate by Omar (9 — Ahmed had none). */
function priceDay(extra: Record<string, unknown> = {}, lines?: Array<[number, number, number, number]>): number {
  const day = seed("x_price_day", { x_date: DAY, x_state: "published", ...extra });
  for (const [p, k, sup, price] of lines ?? [[3, 31, AHMED, 20], [4, 41, COLL, 11.5], [5, 51, COLL, 9]]) {
    seed("x_price_day_line", { x_day_id: day, x_product_tmpl_id: p, x_packaging_id: k, x_supplier_id: sup, x_source_price: price, x_cost_price: price, ...(extra.x_utak_simulation ? { x_utak_simulation: true } : {}) });
  }
  return day;
}
/** The confirmed list as the 21:15 prefill leaves it: Ahmed's x_daily_price on potato and avocado, nothing on the pomegranate; the list's supplier Ahmed. */
function confirmedList(extra: Record<string, unknown> = {}): number {
  const items = [
    { product_id: 3, product_name: "[UTAK-VEG-003] بطاطس", packaging_id: 31, packaging_name: "كرتون · 10 كيلو", total_quantity: 10, order_ids: [1], price_supplier_id: AHMED, unit_price: 20 },
    { product_id: 4, product_name: "[UTAK-FRT-004] افوكادو", packaging_id: 41, packaging_name: "كرتون · 4 كيلو", total_quantity: 4, order_ids: [1], price_supplier_id: AHMED, unit_price: 13 },
    { product_id: 5, product_name: "[UTAK-FRT-005] رمان صغير", packaging_id: 51, packaging_name: "صندوق", total_quantity: 2, order_ids: [2], price_supplier_id: null },
  ];
  return seed("x_purchase_list", { x_date: DAY, x_status: "done", x_supplier_id: AHMED, x_aggregated_items: JSON.stringify(items), x_ahmad_confirmed_at: `${DAY} 03:00:00`, ...extra });
}
const dues = () => rows("x_supplier_due") as any[];
const dueOf = (s: number) => dues().find((d) => d.x_supplier_id === s);
const linesOf = (dueId: number) => (rows("x_supplier_due_line") as any[]).filter((l) => l.x_due_id === dueId);
const payments = () => rows("x_supplier_payment") as any[];
const texts = (to: string) => sentTo(to).map((b) => String(b.text?.body ?? b.interactive?.body?.text ?? ""));
const last = (to: string) => sentTo(to).at(-1);
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

// ================================================================ أ. «مشتريات السوق النقدية»
console.log("\n[أ] «مشتريات السوق النقدية»: the market-won lines, Ahmed untouched, payments with no notice, nothing sent");
{
  // --- the plan (pure)
  const it = (p: number, k: number, q: number, s: number | null) => ({ product_id: p, product_name: `p${p}`, packaging_id: k, packaging_name: "k", total_quantity: q, price_supplier_id: s });
  const P = (id: number, s: number, p: number, k: number, v: number) => ({ id, x_supplier_id: [s, "s"], x_product_tmpl_id: [p, "p"], x_packaging_id: [k, "k"], x_date: DAY, x_price_sar: v, x_extraction_status: "extracted" }) as any;
  const items = [it(3, 31, 10, AHMED), it(4, 41, 4, AHMED), it(5, 51, 2, null)];
  const prices = [P(1, AHMED, 3, 31, 20), P(2, AHMED, 4, 41, 13)];
  const winners = new Map([["4::41", { partnerId: COLL, sourceName: "سالم", price: 11.5 }], ["5::51", { partnerId: COLL, sourceName: "سالم", price: 9 }]]);
  const before = planDues({ x_date: DAY, listSupplierId: AHMED }, items, prices);
  const after = planDues({ x_date: DAY, listSupplierId: AHMED }, items, prices, { cashSupplierId: CASH, winners });
  const aB = before.dues.find((d) => d.supplierId === AHMED)!, aA = after.dues.find((d) => d.supplierId === AHMED)!;
  assert("without the rule (§ 41): avocado 4 × 13 under Ahmed and the pomegranate «بلا سعر» under Ahmed",
    aB.amountH === 25200 && aB.unpriced === 1 && aB.lines.find((l) => l.productId === 5)?.noPrice === true, JSON.stringify(aB));
  assert("with it: Ahmed keeps his own line only (potato 10 × 20 = 200.00), nothing «بلا سعر»",
    aA.amountH === 20000 && aA.unpriced === 0 && aA.lines.length === 1 && aA.lines[0].productId === 3 && aA.lines[0].unitPrice === 20 && aA.lines[0].priceId === 1, JSON.stringify(aA));
  const c = after.dues.find((d) => d.supplierId === CASH)!;
  assert("…«مشتريات السوق النقدية»: avocado 4 × 11.5 + pomegranate 2 × 9 = 64.00, at Omar's written prices",
    c?.amountH === 6400 && c.unpriced === 0 && c.lines.map((l) => `${l.productId}:${l.unitPrice}:${l.subtotalH}`).join() === "4:11.5:4600,5:9:1800" && c.lines.every((l) => l.marketBy === "سالم"), JSON.stringify(c));
  const noCash = planDues({ x_date: DAY, listSupplierId: AHMED }, items, prices, { cashSupplierId: null, winners });
  assert("no partner found: the market lines have no supplier («بلا مورد»), still not Ahmed's",
    noCash.noSupplier.map((i) => i.product_id).join() === "4,5" && noCash.dues.length === 1 && noCash.dues[0].amountH === 20000);
  const ahmedOnly = planDues({ x_date: DAY, listSupplierId: AHMED }, [it(3, 31, 10, AHMED)], prices, { cashSupplierId: CASH, winners });
  assert("a list with Ahmed's lines only: the same due as before the rule", JSON.stringify(ahmedOnly) === JSON.stringify(planDues({ x_date: DAY, listSupplierId: AHMED }, [it(3, 31, 10, AHMED)], prices)));

  // --- the dues in Odoo
  ENV = fresh();
  dailyPrice(AHMED, 3, 31, 20); dailyPrice(AHMED, 4, 41, 13);
  priceDay();
  priceDay({ x_utak_simulation: true, x_state: "draft" }, [[3, 31, COLL, 1]]); // a simulation day of the same date: never read
  const listId = confirmedList();
  const r = await quiet(() => syncSupplierDues(ENV, listId));
  const a = dueOf(AHMED), cash = dueOf(CASH);
  assert("synced: Ahmed 200.00 with one line and 0 «بلا سعر»", r.action === "synced" && a?.x_amount === 200 && a?.x_unpriced_count === 0 && linesOf(a.id).length === 1, JSON.stringify(r));
  const pl = linesOf(a.id)[0];
  assert("…his line: potato 10 × 20 from his x_daily_price (the simulation day's winner ignored)", pl.x_product_tmpl_id === 3 && pl.x_unit_price === 20 && pl.x_subtotal === 200 && !!pl.x_daily_price_id && pl.x_no_price === false);
  const cl = linesOf(cash?.id ?? -1);
  assert("«مشتريات السوق النقدية» #104: 64.00, two lines at Omar's prices, noted «سعر شراء سالم المكتوب من السوق»",
    cash?.x_amount === 64 && cash?.x_unpriced_count === 0 && cl.length === 2 && cl.every((l) => l.x_no_price === false && !l.x_daily_price_id && String(l.x_note).includes("سعر شراء سالم المكتوب من السوق"))
      && cl.find((l) => l.x_product_tmpl_id === 4)?.x_subtotal === 46 && cl.find((l) => l.x_product_tmpl_id === 5)?.x_subtotal === 18, JSON.stringify(cl));
  assert("no «بلا سعر» alert at all (Omar's lines are not Ahmed's)", !ownerAlerts().some((x) => x.includes("بلا سعر")), ownerAlerts().join(" | "));
  const r2 = await quiet(() => syncSupplierDues(ENV, listId));
  assert("again: unchanged", r2.action === "unchanged" && dues().length === 2);

  // a winner that is a supplier (Ahmed) stays Ahmed's; the pomegranate won by Ahmed without a price row is his «بلا سعر»
  ENV = fresh();
  dailyPrice(AHMED, 3, 31, 20); dailyPrice(AHMED, 4, 41, 13);
  priceDay({}, [[3, 31, AHMED, 20], [4, 41, AHMED, 13]]);
  const l2 = confirmedList();
  await quiet(() => syncSupplierDues(ENV, l2));
  assert("every winner a supplier: all Ahmed's (20 × 10 + 13 × 4 = 252), pomegranate «بلا سعر» as before, nothing to the market",
    dueOf(AHMED)?.x_amount === 252 && dueOf(AHMED)?.x_unpriced_count === 1 && !dueOf(CASH), JSON.stringify(dues()));

  // the partner missing (archived / ref changed)
  ENV = fresh(`${DAY} 10:00`, { cash: false });
  dailyPrice(AHMED, 3, 31, 20); dailyPrice(AHMED, 4, 41, 13);
  priceDay();
  const l3 = confirmedList();
  await quiet(() => syncSupplierDues(ENV, l3));
  const al = ownerAlerts().filter((x) => x.includes("بلا مورد"));
  assert("no «مشتريات السوق النقدية»: Ahmed 200 only, the two market lines «بلا مورد (شراء السوق…)» in Baraa's alert",
    dueOf(AHMED)?.x_amount === 200 && dueOf(AHMED)?.x_unpriced_count === 0 && dues().length === 1 && al.length === 1 && al[0].includes("شراء السوق") && al[0].includes("UTAK-CASH-MARKET"), al.join(" | "));

  // --- the payments: Omar records, Baraa approves, no notice
  ENV = fresh();
  dailyPrice(AHMED, 3, 31, 20); dailyPrice(AHMED, 4, 41, 13);
  priceDay();
  const l4 = confirmedList();
  await quiet(() => syncSupplierDues(ENV, l4));
  openWindow(ENV, COLL_PHONE, 2);
  await tap(COLL_PHONE, SP_START);
  const ids = (last(COLL_PHONE)?.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id);
  assert("Omar's picker: Ahmed and «مشتريات السوق النقدية»", ids.includes(`sp_sup_${AHMED}`) && ids.includes(`sp_sup_${CASH}`), JSON.stringify(ids));
  await tap(COLL_PHONE, `sp_sup_${CASH}`);
  assert("…the amount step names it", texts(COLL_PHONE).at(-1) === SP_TEXT.askAmount("مشتريات السوق النقدية"));
  await write(COLL_PHONE, "٦٤");
  const alertsBefore = ownerAlerts().length;
  await tap(COLL_PHONE, SP_SKIP);
  const p = payments()[0];
  assert("a pending cash payment to #104 by Omar, 64.00", payments().length === 1 && p.x_supplier_id === CASH && p.x_amount === 64 && p.x_state === "pending" && p.x_recorded_by === COLL, JSON.stringify(p));
  const pa = ownerAlerts().slice(alertsBefore).join(" | ");
  assert("…Baraa's approval alert: the supplier, 64.00, the remaining 64.00 before it", pa.includes("بانتظار اعتمادك") && pa.includes("مشتريات السوق النقدية") && pa.includes("64.00"), pa);
  Object.assign(table("x_supplier_payment").get(p.id) as any, { x_state: "approved", x_decided_by: 2, x_decided_at: odooTs() });
  const graphBefore = graph.length;
  const s = await quiet(() => settlePayment(ENV, p.id));
  const out = graph.slice(graphBefore).map((b) => b?.to);
  assert("approved: settled with «لا إشعار للمورد (مشتريات السوق النقدية بلا رقم)», remaining 0.00", s.action === "approved" && s.notice === CASH_MARKET_NOTICE && s.remaining === "0.00"
    && (table("x_supplier_payment").get(p.id) as any).x_supplier_notice === CASH_MARKET_NOTICE, JSON.stringify(s));
  assert("…only Omar hears of it (the decision line); no message to any supplier", out.length === 1 && out[0] === COLL_PHONE && texts(COLL_PHONE).at(-1).includes("اعتمد براء دفعتك"), JSON.stringify(out));
  assert("…Ahmed's balance untouched (200 due, nothing paid)", dueOf(AHMED)?.x_amount === 200 && !payments().some((x) => x.x_supplier_id === AHMED));

  // --- the gateway: a number added to it later in Odoo never receives anything
  Object.assign(table("res.partner").get(CASH) as any, { phone: "0500000104" }); // local spelling: the last nine digits decide
  ENV.MSG_DEDUP.store.delete("cash_market_nums:v1"); // the 10-minute cache
  openWindow(ENV, "966500000104", 1);
  const g0 = graph.length;
  const d1 = gatewayDecision(await quiet(() => sendViaGateway(ENV, { purpose: "supplier_payment_sent", to: "+966500000104", content: textContent("دفعة") })));
  const d2 = gatewayDecision(await quiet(() => sendViaGateway(ENV, { purpose: "wa_message_manual", to: "0500000104", content: textContent("يدوية") })));
  const d3 = gatewayDecision(await quiet(() => sendViaGateway(ENV, { purpose: "bot_reply", to: "966500000104", content: textContent("رد") })));
  assert("the gateway refuses it for any purpose (notice, manual, bot reply), any spelling of the number",
    [d1, d2, d3].every((d) => d?.action === "refused" && String((d as any).reason).includes("CashMarketSupplier")) && graph.length === g0, JSON.stringify([d1, d2, d3]));
  const g1 = graph.length;
  const d4 = gatewayDecision(await quiet(() => sendViaGateway(ENV, { purpose: "bot_reply", to: AHMED_PHONE, content: textContent("هلا") })));
  openWindow(ENV, AHMED_PHONE, 1);
  const d5 = gatewayDecision(await quiet(() => sendViaGateway(ENV, { purpose: "bot_reply", to: AHMED_PHONE, content: textContent("هلا") })));
  assert("…Ahmed's number is not affected", d4?.action !== "refused" && d5?.action === "session" && graph.length === g1 + 1, JSON.stringify([d4, d5]));
  // a second payment approved after the number was added: still no notice
  const p2 = seed("x_supplier_payment", { x_supplier_id: CASH, x_amount: 10, x_method: "cash" });
  computes["x_supplier_payment"]!(table("x_supplier_payment").get(p2)!);
  const g2 = graph.length;
  const s2 = await quiet(() => settlePayment(ENV, p2));
  assert("…a payment settled after the number was added: still «لا إشعار», nothing to it (only Baraa's «رصيد دائن» alert: 74 paid of 64)",
    s2.notice === CASH_MARKET_NOTICE && s2.overpaid === true && graph.slice(g2).every((b) => b?.to === OWNER) && sentTo("966500000104").length === 0, JSON.stringify(s2));
  assert("isCashMarketNumber: its number yes, Ahmed's no, empty no", await CM.isCashMarketNumber(ENV, "+966500000104") && !(await CM.isCashMarketNumber(ENV, AHMED_PHONE)) && !(await CM.isCashMarketNumber(ENV, "")));
}

// ================================================================ س. schema
console.log("\n[س] schema: every Odoo request names real fields and values");
assert("no request with an unknown field or selection value", rejected.length === 0, rejected.join(" | "));

console.log(`\ns42: ${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.map((f) => ` - ${f}`).join("\n")); process.exit(1); }
