// Supplier payments — 2026-09-25 (STATUS § 37 ب).
//
//   [0] the rules: halalas and two decimals; Omar's amount is a number only
//       (Arabic digits too); the item's supplier; that supplier's own price of
//       that day (latest, not failed; another supplier's or another day's
//       never); a line without it is «بلا سعر» and not counted.
//   [1] the dues: a confirmed list → one due per supplier with its lines; one
//       «بلا سعر» alert; unchanged → nothing; a price that arrives later →
//       recomputed in place (no new line, no deletion); an unconfirmed list →
//       nothing; the tick leaves a just-confirmed list to the tap.
//   [2] the balance: partial, pending / rejected not paid, an overpayment
//       accepted as «رصيد دائن» with an alert, amounts to two decimals.
//   [3] approve / reject / lock: the member is told (the reason on a
//       rejection); the supplier's notice after an approval only; settled once;
//       the Odoo Python (on create, approve, reject, lock) run in python3.
//   [4] the reference: SP-2026-0001, 0002 … from the sequence.
//   [5] Omar's steps over /webhook: «💵 دفعت لمورد» for the purchase and
//       collection roles, the supplier from today's list (buttons, or a list
//       past three), the amount as a number (anything else refused clearly),
//       the receipt photo or «تخطي»; «إلغاء»; Baraa's alert (supplier,
//       amount, reference, remaining); the button after «تم الشراء» (and its
//       dues).
//   [6] the supplier's notice: text inside the window; utak_supplier_payment_sent
//       outside it when APPROVED / UTILITY; held (critical) when PENDING or
//       MARKETING; a trial tag starts the texts.
//   [7] no account.move and no account.payment, anywhere.
//   [8] the hook (401 / 400 / 202) and the tick (a lost webhook, the dues).
//   [9] schema: every Odoo write names real fields and values (§ 37 fixture).
//  [10] § 37 ج — a simulation record (x_utak_simulation): out of the dues, the
//       balance, «رصيد دائن», the tick and Omar's picker (the worker and the
//       Odoo computes alike); a simulation payment's notice never goes — not
//       from settle, not through the gateway (its purpose, its template by
//       purpose or by row, a held flush), and Odoo unreachable refuses it;
//       a normal payment beside them is counted and notified as before.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/supplier-pay.test.mts

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  COLL, COLL_PHONE, OWNER, WH, WH_PHONE, computes, employee, graph, heldFor, inbound, odooLog, openWindow, ownerAlerts, quiet, reset,
  rows, seed, sentTo, setRiyadh, signed, table,
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
const MEDIA_ID = "MEDIA-RECEIPT-1";
const MEDIA_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
const harnessFetch = globalThis.fetch;
/** § 37 ج — Odoo refuses reading the payments (the gateway's check must then refuse the notice). */
let failSpRead = false;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (failSpRead && url.includes("/json/2/x_supplier_payment/search_read")) {
    return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "unreachable" }), { status: 403 });
  }
  // the receipt photo at Meta (GET the media, then its bytes)
  if (url.includes("graph.facebook.com") && url.endsWith(`/${MEDIA_ID}`)) {
    return new Response(JSON.stringify({ url: "https://media.test/receipt", mime_type: "image/jpeg", file_size: MEDIA_BYTES.length }), { status: 200 });
  }
  if (url === "https://media.test/receipt") return new Response(MEDIA_BYTES, { status: 200 });
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
const {
  halalas, money, parseAmount, planDues, itemSupplier, supplierPriceFor, lineSubtotalH, syncSupplierDues, syncRecentDues, supplierBalance,
  settlePayment, runSupplierPayTick, supplierNoticeText, SP_TEXT, SP_START, SP_SKIP, SP_START_TITLE, onPaymentHook,
} = SPM;
const { clearTemplateCache } = await import("../src/templates.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const worker = (await import("../src/index.ts")).default;
const ODOO_CODE = await import("../scripts/lib/s37-odoo-code.mjs");

// ---------------------------------------------------------------- data
const DAY = "2026-09-26";
const SUP = 701, SUP_PHONE = "966500000701";
const SUP2 = 702, SUP2_PHONE = "966500000702";
const BOT = 42;
let ENV: any;
let seqN = 0;
const odooTs = () => new Date(Date.now()).toISOString().replace("T", " ").slice(0, 19);

function fresh(riyadh = `${DAY} 10:00`): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0; seqN = 0;
  env.ODOO_HOOK_TOKEN = "HOOKTOKEN";
  seed("res.partner", { id: BOT, name: "UTAK بوت" });
  seed("res.partner", { id: 3, name: "albaraa abdulwahab" });
  seed("res.users", { id: 2, login: "admin", partner_id: 3, name: "albaraa abdulwahab" });
  seed("res.partner", { id: SUP, name: "مورد الخضار", x_whatsapp_number: "+" + SUP_PHONE, supplier_rank: 1 });
  seed("res.partner", { id: SUP2, name: "مورد الفواكه", x_whatsapp_number: "+" + SUP2_PHONE, supplier_rank: 1 });
  seed("product.template", { id: 3, name: "[UTAK-VEG-003] بطاطس" });
  seed("product.template", { id: 4, name: "[UTAK-VEG-004] بصل" });
  seed("x_product_packaging", { id: 31, x_name: "كرتون · 10 كيلو", x_product_tmpl_id: 3 });
  seed("x_product_packaging", { id: 41, x_name: "جرم · 20 كيلو", x_product_tmpl_id: 4 });
  // Odoo's on-create automation (scripts/lib/s37-odoo-code.mjs CODE.onCreate), mirrored
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
function price(supplier: number, product: number, packaging: number, p: number, extra: Record<string, unknown> = {}): number {
  return seed("x_daily_price", { x_supplier_id: supplier, x_product_tmpl_id: product, x_packaging_id: packaging, x_date: DAY, x_price_sar: p, x_extraction_status: "extracted", ...extra });
}
/** A confirmed list: tomato ×3 and cucumber ×2 from SUP, potato ×4 from SUP (no price), onion ×5 from SUP2, and one item with no supplier. */
function confirmedList(extra: Record<string, unknown> = {}): number {
  const items = [
    { product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 3, order_ids: [1], price_supplier_id: SUP, unit_price: 26 },
    { product_id: 2, product_name: "خيار", packaging_id: 21, packaging_name: "جرم", total_quantity: 2, order_ids: [1], price_supplier_id: SUP, unit_price: 45 },
    { product_id: 3, product_name: "[UTAK-VEG-003] بطاطس", packaging_id: 31, packaging_name: "كرتون · 10 كيلو", total_quantity: 4, order_ids: [2], price_supplier_id: SUP },
    { product_id: 4, product_name: "بصل", packaging_id: 41, packaging_name: "جرم · 20 كيلو", total_quantity: 5, order_ids: [2], price_supplier_id: SUP2 },
    { product_id: 2, product_name: "خيار", packaging_id: 22, packaging_name: "فلين", total_quantity: 1, order_ids: [3], price_supplier_id: null },
  ];
  return seed("x_purchase_list", { x_date: DAY, x_status: "done", x_supplier_id: false, x_aggregated_items: JSON.stringify(items), x_ahmad_confirmed_at: "2026-09-26 06:00:00", ...extra });
}
function standardPrices(): void {
  price(SUP, 1, 11, 24.5);             // older row of the same supplier: replaced by the latest
  price(SUP, 1, 11, 26);
  price(SUP, 2, 21, 45, { x_extraction_status: "pending" }); // an outlier is still his price
  price(SUP2, 1, 11, 22);              // another supplier's tomato: never SUP's
  price(SUP2, 4, 41, 10);
  price(SUP, 3, 31, 9, { x_date: "2026-09-25" });            // yesterday: not today's
  price(SUP, 3, 31, 7, { x_extraction_status: "failed" });   // a failed extraction: not a price
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
const pick = (from: string, id: string) => say(from, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: "x" } } });
const write = (from: string, text: string) => say(from, { type: "text", text: { body: text } });
/** Mirror of the Odoo approve / reject code (CODE.approve / CODE.reject), run as the API user. */
function decide(id: number, state: "approved" | "rejected", reason = ""): void {
  const r = table("x_supplier_payment").get(id) as any;
  Object.assign(r, { x_state: state, x_decided_by: 2, x_decided_at: odooTs(), ...(reason ? { x_reject_reason: reason } : {}) });
}
function payment(vals: Record<string, unknown>): number {
  const id = seed("x_supplier_payment", { x_method: "transfer", ...vals });
  computes["x_supplier_payment"]!(table("x_supplier_payment").get(id)!);
  return id;
}
function tplRow(status = "APPROVED", category = "UTILITY"): void {
  seed("x_whatsapp_template", { x_purpose: "supplier_payment_sent", x_meta_template_id: "utak_supplier_payment_sent", x_language: "ar", x_meta_status: status, x_param_count: 4, x_category: category,
    x_body_text: "تم تسجيل دفعة لك من يو تاك بمبلغ {{1}} ر.س بتاريخ {{2}}، رقم المرجع {{3}}. الرصيد المتبقي لك: {{4}} ر.س." });
}

// ================================================================ 0. the rules
console.log("\n[0] money, the amount, the item's supplier and its price");
{
  assert("halalas: 13.5 → 1350, 1.005 → 101 (half up), 0.1 + 0.2 → 30", halalas(13.5) === 1350 && halalas(1.005) === 101 && halalas(0.1 + 0.2) === 30);
  assert("money: two decimals, no grouping", money(150000) === "1500.00" && money(5) === "0.05" && money(-3400) === "-34.00");
  assert("line subtotal: 3 × 26 = 78.00, 2.5 × 13.33 = 33.33 (half up), 4 × 0.125 = 0.50", lineSubtotalH(3, 26) === 7800 && lineSubtotalH(2.5, 13.33) === 3333 && lineSubtotalH(4, 0.125) === 50);
  const ok: Array<[string, number]> = [["1500", 150000], ["1500.5", 150050], ["1500.50", 150050], ["١٥٠٠", 150000], ["١٥٠٠٫٥", 150050], [" 250 ", 25000], ["0.75", 75]];
  assert("a number is accepted (Western or Arabic digits, one decimal point, two decimals)", ok.every(([t, h]) => parseAmount(t) === h), JSON.stringify(ok.map(([t]) => [t, parseAmount(t)])));
  const no = ["خمسمية", "1,500", "1500 ريال", "1500ر.س", "-50", "0", "0.00", "12.345", "", "1.2.3", "٥٠٠ ريال", "1e3", "999999999.99"];
  assert("anything else is refused: words, commas, a currency, a sign, zero, three decimals, too large", no.every((t) => parseAmount(t) === null), JSON.stringify(no.filter((t) => parseAmount(t) !== null)));
  assert("the item's supplier: the one it was priced from, else the list's, else none",
    itemSupplier({ price_supplier_id: 5 } as any, 9) === 5 && itemSupplier({ price_supplier_id: null } as any, 9) === 9 && itemSupplier({} as any, null) === null);
  const P = (id: number, s: number, pid: number, k: number, p: number, x: Record<string, unknown> = {}) => ({ id, x_supplier_id: [s, "s"], x_product_tmpl_id: [pid, "p"], x_packaging_id: [k, "k"], x_date: DAY, x_price_sar: p, x_extraction_status: "extracted", ...x }) as any;
  const prices = [P(1, SUP, 1, 11, 24.5), P(2, SUP, 1, 11, 26), P(3, SUP2, 1, 11, 22), P(4, SUP, 2, 21, 45, { x_extraction_status: "pending" }), P(5, SUP, 3, 31, 9, { x_date: "2026-09-25" }), P(6, SUP, 3, 31, 7, { x_extraction_status: "failed" })];
  const it = (pid: number, k: number, q: number, s: number | null) => ({ product_id: pid, product_name: "x", packaging_id: k, packaging_name: "y", total_quantity: q, price_supplier_id: s });
  assert("his own latest price of that day (26, not 24.5, not the other supplier's 22)", supplierPriceFor(prices, SUP, it(1, 11, 3, SUP), DAY)?.x_price_sar === 26);
  assert("an outlier (pending) is still his price; yesterday's and a failed extraction are not", supplierPriceFor(prices, SUP, it(2, 21, 2, SUP), DAY)?.x_price_sar === 45 && supplierPriceFor(prices, SUP, it(3, 31, 4, SUP), DAY) === null);
  const plan = planDues({ x_date: DAY, listSupplierId: null }, [it(1, 11, 3, SUP), it(2, 21, 2, SUP), it(3, 31, 4, SUP), it(1, 11, 5, SUP2), it(9, 99, 1, null)], prices);
  const d1 = plan.dues.find((d) => d.supplierId === SUP)!;
  assert("the due = Σ quantity × his price: 3 × 26 + 2 × 45 = 168.00", d1.amountH === 16800, String(d1.amountH));
  assert("…the line without a price is «بلا سعر» and counts 0", d1.unpriced === 1 && d1.lines.find((l) => l.productId === 3)?.noPrice === true && d1.lines.find((l) => l.productId === 3)?.subtotalH === 0);
  assert("…the other supplier's due from his own price only (5 × 22 = 110.00)", plan.dues.find((d) => d.supplierId === SUP2)?.amountH === 11000);
  assert("…an item with no supplier at all is apart (noSupplier)", plan.noSupplier.length === 1 && plan.noSupplier[0].product_id === 9);
}

// ================================================================ 1. the dues
console.log("\n[1] the dues of a confirmed list");
{
  ENV = fresh();
  standardPrices();
  const listId = confirmedList();
  const r1 = await quiet(() => syncSupplierDues(ENV, listId));
  assert("synced: two dues (one per supplier)", r1.action === "synced" && dues().length === 2, JSON.stringify(r1));
  const d = dueOf(SUP);
  assert("SUP: 168.00, one line «بلا سعر»", d?.x_amount === 168 && d?.x_unpriced_count === 1, JSON.stringify(d));
  const L = linesOf(d.id);
  const tomato = L.find((l) => l.x_product_tmpl_id === 1), potato = L.find((l) => l.x_product_tmpl_id === 3);
  assert("…lines: tomato 3 × 26 = 78.00 from his price row; potato «بلا سعر» 0 with a note",
    L.length === 3 && tomato?.x_unit_price === 26 && tomato?.x_subtotal === 78 && !!tomato?.x_daily_price_id && potato?.x_no_price === true && potato?.x_subtotal === 0 && String(potato?.x_note).includes("بلا سعر"));
  assert("SUP2: 5 × 10 = 50.00", dueOf(SUP2)?.x_amount === 50 && dueOf(SUP2)?.x_date === DAY && dueOf(SUP2)?.x_purchase_list_id === listId);
  const alerts1 = ownerAlerts().filter((a) => a.includes("بلا سعر"));
  assert("one important alert to Baraa: the list, the supplier, the item, and the item with no supplier",
    alerts1.length === 1 && alerts1[0].includes(`#${listId}`) && alerts1[0].includes("مورد الخضار") && alerts1[0].includes("بطاطس") && alerts1[0].includes("بلا مورد"), alerts1.join(" | "));
  const r2 = await quiet(() => syncSupplierDues(ENV, listId));
  assert("the same again: unchanged, no second alert", r2.action === "unchanged" && ownerAlerts().filter((a) => a.includes("بلا سعر")).length === 1);
  const potatoLineId = potato.id;
  price(SUP, 3, 31, 12); // his potato price arrives later
  setRiyadh(`${DAY} 10:10`);
  await quiet(() => runSupplierPayTick(ENV));
  const d2 = dueOf(SUP);
  const potato2 = linesOf(d2.id).find((l) => l.x_product_tmpl_id === 3);
  assert("a price that arrives later: the tick recomputes — 168 + 4 × 12 = 216.00, nothing «بلا سعر»", d2.x_amount === 216 && d2.x_unpriced_count === 0 && potato2?.x_no_price === false && potato2?.x_subtotal === 48);
  assert("…in place: the same line, no new line, nothing deleted", potato2?.id === potatoLineId && linesOf(d2.id).length === 3 && dues().length === 2
    && !odooLog.some((l) => l.method === "unlink"));
  assert("…no new alert (nothing without a price now)", ownerAlerts().filter((a) => a.includes("بلا سعر")).length === 1);
  const sentList = seed("x_purchase_list", { x_date: DAY, x_status: "sent", x_aggregated_items: "[]" });
  assert("a list not confirmed (sent): no due", (await quiet(() => syncSupplierDues(ENV, sentList))).action === "not_confirmed");
  // the tick leaves a list confirmed a moment ago to the tap's own sync
  const fresh1 = confirmedList({ x_ahmad_confirmed_at: odooTs() });
  const t1 = await quiet(() => syncRecentDues(ENV));
  assert("the tick: a list confirmed under 2 minutes ago is left to the tap", !t1.some((r) => r.listId === fresh1));
  setRiyadh(`${DAY} 10:13`);
  const t2 = await quiet(() => syncRecentDues(ENV));
  assert("…and taken 3 minutes later", t2.some((r) => r.listId === fresh1 && r.action === "synced"));
}

// ================================================================ 2. the balance
console.log("\n[2] the balance: partial, pending / rejected, «رصيد دائن»");
{
  ENV = fresh();
  standardPrices(); price(SUP, 3, 31, 12);
  await quiet(() => syncSupplierDues(ENV, confirmedList()));
  openWindow(ENV, SUP_PHONE, 5);
  const b0 = await supplierBalance(ENV, SUP);
  assert("due 216.00, paid 0, remaining 216.00", b0.dueH === 21600 && b0.paidH === 0 && b0.remainingH === 21600);
  const p1 = payment({ x_supplier_id: SUP, x_amount: 100 });
  await quiet(() => settlePayment(ENV, p1));
  const b1 = await supplierBalance(ENV, SUP);
  assert("a partial transfer from Baraa (approved at once): paid 100.00, remaining 116.00", b1.paidH === 10000 && b1.remainingH === 11600);
  assert("…x_remaining_after 116, not «رصيد دائن»", table("x_supplier_payment").get(p1)?.x_remaining_after === 116 && table("x_supplier_payment").get(p1)?.x_overpaid === false);
  payment({ x_supplier_id: SUP, x_amount: 50, x_channel: "whatsapp", x_method: "cash", x_recorded_by: WH });
  const rj = payment({ x_supplier_id: SUP, x_amount: 30, x_channel: "whatsapp", x_method: "cash", x_recorded_by: WH });
  decide(rj, "rejected", "مكررة");
  const b2 = await supplierBalance(ENV, SUP);
  assert("a pending and a rejected payment are not paid", b2.paidH === 10000 && b2.remainingH === 11600);
  const p2 = payment({ x_supplier_id: SUP, x_amount: 150.004, x_method: "cash" });
  assert("amounts are kept to two decimals (150.004 → 150.00)", table("x_supplier_payment").get(p2)?.x_amount === 150);
  const alertsBefore = ownerAlerts().length;
  const r = await quiet(() => settlePayment(ENV, p2));
  const row = table("x_supplier_payment").get(p2) as any;
  assert("paying more than the remaining is accepted: approved, «رصيد دائن», remaining −34.00", r.action === "approved" && row.x_overpaid === true && row.x_remaining_after === -34 && r.remaining === "-34.00");
  const oa = ownerAlerts().slice(alertsBefore).join(" | ");
  assert("…Baraa is alerted with the figures (paid 250.00 > due 216.00 by 34.00)", oa.includes("رصيد دائن") && oa.includes("250.00") && oa.includes("216.00") && oa.includes("34.00") && oa.includes("SP-2026-0004"), oa);
  const notice = texts(SUP_PHONE).at(-1) ?? "";
  assert("…the supplier's notice says remaining 0.00 (never negative)", notice.includes("150.00") && notice.includes("الرصيد المتبقي لك: 0.00 ر.س."), notice);
}

// ================================================================ 3. approve / reject / lock
console.log("\n[3] approve / reject: the member, the supplier, once; the Odoo code");
{
  ENV = fresh();
  standardPrices(); price(SUP, 3, 31, 12);
  await quiet(() => syncSupplierDues(ENV, confirmedList()));
  openWindow(ENV, SUP_PHONE, 5); openWindow(ENV, WH_PHONE, 5);
  const pend = payment({ x_supplier_id: SUP, x_amount: 500, x_channel: "whatsapp", x_method: "cash", x_recorded_by: WH });
  const beforeSup = sentTo(SUP_PHONE).length, beforeWh = sentTo(WH_PHONE).length;
  const r0 = await quiet(() => settlePayment(ENV, pend));
  assert("pending: nothing happens (no notice, no line to the member)", r0.action === "pending" && sentTo(SUP_PHONE).length === beforeSup && sentTo(WH_PHONE).length === beforeWh);
  decide(pend, "approved");
  const r1 = await quiet(() => settlePayment(ENV, pend));
  assert("approved: settled — the supplier's notice and the member's line", r1.action === "approved" && sentTo(SUP_PHONE).length === beforeSup + 1 && sentTo(WH_PHONE).length === beforeWh + 1);
  assert("…the member: «✅ اعتمد براء دفعتك SP-…»", texts(WH_PHONE).at(-1)!.startsWith("✅ اعتمد براء دفعتك SP-2026-0001: مورد الخضار بمبلغ 500.00 ر.س."), texts(WH_PHONE).at(-1));
  const row = table("x_supplier_payment").get(pend) as any;
  assert("…the row: x_settled_at, the notice «نصاً», remaining −284.00 «رصيد دائن»", !!row.x_settled_at && String(row.x_supplier_notice).startsWith("نصاً") && row.x_remaining_after === -284 && row.x_overpaid === true);
  const r2 = await quiet(() => settlePayment(ENV, pend));
  assert("settled once: a second call does nothing", r2.action === "already" && sentTo(SUP_PHONE).length === beforeSup + 1 && sentTo(WH_PHONE).length === beforeWh + 1);
  const rej = payment({ x_supplier_id: SUP, x_amount: 70, x_channel: "whatsapp", x_method: "cash", x_recorded_by: WH });
  decide(rej, "rejected", "المبلغ لا يطابق الإيصال");
  const supBefore = sentTo(SUP_PHONE).length;
  const r3 = await quiet(() => settlePayment(ENV, rej));
  assert("rejected: the member is told with the reason", r3.action === "rejected" && texts(WH_PHONE).at(-1) === "❌ رفض براء دفعتك SP-2026-0002: مورد الخضار بمبلغ 70.00 ر.س.\nالسبب: المبلغ لا يطابق الإيصال", texts(WH_PHONE).at(-1));
  assert("…and the supplier gets nothing", sentTo(SUP_PHONE).length === supBefore && String(table("x_supplier_payment").get(rej)?.x_supplier_notice).includes("مرفوضة"));
  // Baraa's own payment in Odoo: no member line
  const whBefore = sentTo(WH_PHONE).length;
  const own = payment({ x_supplier_id: SUP, x_amount: 10, x_method: "cash" });
  await quiet(() => settlePayment(ENV, own));
  assert("Baraa's own cash payment: approved at once, the supplier notified, no member line", table("x_supplier_payment").get(own)?.x_state === "approved" && sentTo(WH_PHONE).length === whBefore);

  // the Odoo Python itself (on create, approve, reject, lock, no delete), in python3 with stub records
  const py = `
import json, sys, datetime
class UserError(Exception):
    pass
class Seq:
    n = 0
    def sudo(self):
        return self
    def next_by_code(self, code):
        assert code == 'utak.supplier.payment'
        Seq.n += 1
        return 'SP-2026-%04d' % Seq.n
class Partner:
    id = 3
class User:
    id = 2
    partner_id = Partner()
class Env(dict):
    user = User()
env = Env({'ir.sequence': Seq()})
class Rec:
    def __init__(self, **kw):
        self.__dict__.update({'x_name': False, 'x_date': False, 'x_state': False, 'x_channel': False, 'x_recorded_by': False, 'x_reject_reason': False, 'x_amount': 0.0})
        self.__dict__.update(kw)
    def write(self, vals):
        self.__dict__.update(vals)
class Recs(list):
    def mapped(self, f):
        return [getattr(r, f) for r in self]
def run(code, recs):
    try:
        exec(code, {'datetime': datetime, 'UserError': UserError, 'env': env, 'records': Recs(recs)})
        return 'ok'
    except UserError as e:
        return 'UserError: ' + str(e)
code = json.loads(sys.argv[1])
out = {}
wa = Rec(x_channel='whatsapp', x_amount=1500.505)
out['wa'] = [run(code['onCreate'], [wa]), wa.x_name, wa.x_state, bool(wa.x_date), wa.x_amount]
ui = Rec(x_amount=100.0)
out['ui'] = [run(code['onCreate'], [ui]), ui.x_name, ui.x_state, ui.x_channel, getattr(ui, 'x_decided_by', None), ui.x_recorded_by]
out['zero'] = run(code['onCreate'], [Rec(x_amount=0.0)])
p = Rec(x_state='pending', x_amount=10.0, x_name='SP-2026-0009')
out['approve'] = [run(code['approve'], [p]), p.x_state, getattr(p, 'x_decided_by', None)]
out['approve_again'] = run(code['approve'], [p])
q = Rec(x_state='pending', x_amount=10.0, x_name='SP-2026-0010')
out['reject_noreason'] = [run(code['reject'], [q]), q.x_state]
q.x_reject_reason = 'مكررة'
out['reject'] = [run(code['reject'], [q]), q.x_state]
out['lock'] = run(code['lock'], [p])
out['nounlink'] = run(code['noUnlink'], [q])
print(json.dumps(out, ensure_ascii=False))
`;
  const o = JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify(ODOO_CODE.CODE)], { encoding: "utf8" }));
  assert("Odoo on create (WhatsApp): SP-2026-0001, pending, today's date, amount to 2 decimals", o.wa[0] === "ok" && o.wa[1] === "SP-2026-0001" && o.wa[2] === "pending" && o.wa[3] === true && o.wa[4] === 1500.51, JSON.stringify(o.wa));
  assert("Odoo on create (Baraa in Odoo): approved at once, channel Odoo, decided by him, recorded by his partner", o.ui[0] === "ok" && o.ui[1] === "SP-2026-0002" && o.ui[2] === "approved" && o.ui[3] === "odoo" && o.ui[4] === 2 && o.ui[5] === 3, JSON.stringify(o.ui));
  assert("Odoo: an amount of 0 is refused", String(o.zero).includes("أكبر من صفر"));
  assert("Odoo «اعتماد»: pending → approved (by him); a second time refused", o.approve[0] === "ok" && o.approve[1] === "approved" && o.approve[2] === 2 && String(o.approve_again).startsWith("UserError"));
  assert("Odoo «رفض»: refused without a reason, done with one", String(o.reject_noreason[0]).includes("سبب الرفض") && o.reject_noreason[1] === "pending" && o.reject[0] === "ok" && o.reject[1] === "rejected");
  assert("Odoo lock and no-delete: refused, with the references", String(o.lock).includes("مقفلة") && String(o.lock).includes("SP-2026-0009") && String(o.nounlink).includes("لا تُحذف"));
  assert("the lock watches the business fields (state, amount, supplier, reason …), not the worker's",
    ["x_state", "x_amount", "x_supplier_id", "x_reject_reason", "x_method", "x_date"].every((f) => ODOO_CODE.LOCK_WATCH.includes(f))
      && !["x_remaining_after", "x_overpaid", "x_supplier_notice", "x_settled_at"].some((f) => ODOO_CODE.LOCK_WATCH.includes(f)));
}

// ================================================================ 4. the reference
console.log("\n[4] the reference: SP-2026-0001, 0002 …");
{
  ENV = fresh();
  const ids = [payment({ x_supplier_id: SUP, x_amount: 1 }), payment({ x_supplier_id: SUP, x_amount: 2, x_channel: "whatsapp", x_method: "cash" }), payment({ x_supplier_id: SUP2, x_amount: 3 })];
  const refs = ids.map((id) => String(table("x_supplier_payment").get(id)?.x_name));
  assert("in order, one per payment, whatever the channel or supplier", JSON.stringify(refs) === JSON.stringify(["SP-2026-0001", "SP-2026-0002", "SP-2026-0003"]), refs.join());
  assert("the Odoo code takes it from the sequence utak.supplier.payment (prefix SP-%(range_year)s-, 4 digits: --verify)",
    ODOO_CODE.CODE.onCreate.includes("next_by_code('utak.supplier.payment')") && ODOO_CODE.SEQ_CODE === "utak.supplier.payment");
}

// ================================================================ 5. Omar's steps on WhatsApp
console.log("\n[5] Omar's steps over /webhook");
{
  ENV = fresh();
  standardPrices(); price(SUP, 3, 31, 12);
  const listId = confirmedList();
  await quiet(() => syncSupplierDues(ENV, listId));
  openWindow(ENV, WH_PHONE, 2); openWindow(ENV, COLL_PHONE, 2);
  const driver = 603; seed("res.partner", { id: driver, name: "سائق", x_whatsapp_number: "+966500000603" }); employee(driver, [72]);
  openWindow(ENV, "966500000603", 2);
  await write(WH_PHONE, "هلا");
  const menu = last(WH_PHONE);
  assert("the purchase role writes: the usual line with «💵 دفعت لمورد»", menu?.type === "interactive" && menu.interactive.action.buttons.some((b: any) => b.reply.id === SP_START && b.reply.title === SP_START_TITLE), JSON.stringify(menu));
  await write(COLL_PHONE, "هلا");
  assert("the collection role too", last(COLL_PHONE)?.interactive?.action?.buttons?.some((b: any) => b.reply.id === SP_START));
  await write("966500000603", "هلا");
  assert("a driver only: no button (text)", last("966500000603")?.type === "text");
  await tap("966500000603", SP_START);
  assert("…and his tap is refused", texts("966500000603").at(-1) === SP_TEXT.notAllowed);
  await tap(WH_PHONE, SP_START);
  const picker = last(WH_PHONE);
  const ids = (picker?.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id);
  assert("the suppliers of today's purchase list, as buttons (two)", picker?.interactive?.type === "button" && ids.join() === `sp_sup_${SUP},sp_sup_${SUP2}` && picker.interactive.body.text === SP_TEXT.chooseSupplier, JSON.stringify(picker));
  await tap(WH_PHONE, "sp_sup_999");
  assert("a supplier not on today's list is refused", texts(WH_PHONE).at(-1) === SP_TEXT.notSupplier);
  await tap(WH_PHONE, SP_START);
  await tap(WH_PHONE, `sp_sup_${SUP}`);
  assert("the supplier → «اكتب المبلغ المدفوع رقماً فقط»", texts(WH_PHONE).at(-1) === SP_TEXT.askAmount("مورد الخضار"));
  for (const bad of ["خمسمية", "1,500", "1500 ريال", "0"]) {
    await write(WH_PHONE, bad);
  }
  const lastFour = texts(WH_PHONE).slice(-4);
  assert("anything but a number is refused with the clear line (4 ×), nothing recorded", lastFour.every((t) => t === SP_TEXT.badAmount) && payments().length === 0, JSON.stringify(lastFour));
  await write(WH_PHONE, "١٥٠٠٫٥");
  const ask = last(WH_PHONE);
  assert("the amount (Arabic digits) → «أرسل صورة الإيصال … أو «تخطي»» with the button",
    ask?.interactive?.body?.text === SP_TEXT.askReceipt(150050, "مورد الخضار") && ask.interactive.action.buttons[0].reply.id === SP_SKIP, JSON.stringify(ask));
  await write(WH_PHONE, "الحين أصورها");
  assert("a text while the receipt is awaited: the reminder with «تخطي»", last(WH_PHONE)?.interactive?.body?.text === SP_TEXT.receiptOnly);
  const alertsBefore = ownerAlerts().length;
  await say(WH_PHONE, { type: "image", image: { id: MEDIA_ID, mime_type: "image/jpeg" } });
  const p = payments()[0];
  assert("the photo: a pending cash payment by the member, from WhatsApp, with the receipt",
    payments().length === 1 && p.x_state === "pending" && p.x_method === "cash" && p.x_channel === "whatsapp" && p.x_recorded_by === WH && p.x_supplier_id === SUP && p.x_amount === 1500.5
      && p.x_receipt === Buffer.from(MEDIA_BYTES).toString("base64") && String(p.x_receipt_filename).endsWith(".jpg") && !!p.x_source_wamid, JSON.stringify({ ...p, x_receipt: String(p.x_receipt).slice(0, 12) }));
  assert("…the member is told: the reference, pending Baraa", texts(WH_PHONE).at(-1) === SP_TEXT.recorded("SP-2026-0001", "مورد الخضار", 150050, true));
  const a = ownerAlerts().slice(alertsBefore).join(" | ");
  assert("…Baraa's alert: the supplier, the amount, the reference, the remaining (216.00 before it) and the excess",
    a.includes("بانتظار اعتمادك") && a.includes("مورد الخضار") && a.includes("1500.50") && a.includes("SP-2026-0001") && a.includes("216.00") && a.includes("رصيد دائن"), a);
  // «تخطي»
  await tap(WH_PHONE, SP_START); await tap(WH_PHONE, `sp_sup_${SUP2}`); await write(WH_PHONE, "50"); await tap(WH_PHONE, SP_SKIP);
  const p2 = payments()[1];
  assert("«تخطي»: recorded without a receipt", payments().length === 2 && p2.x_supplier_id === SUP2 && p2.x_amount === 50 && !p2.x_receipt && texts(WH_PHONE).at(-1) === SP_TEXT.recorded("SP-2026-0002", "مورد الفواكه", 5000, false));
  await tap(WH_PHONE, SP_SKIP);
  assert("«تخطي» again (no flow): «انتهت المهلة», nothing recorded", payments().length === 2 && String(last(WH_PHONE)?.interactive?.body?.text ?? texts(WH_PHONE).at(-1)).includes("انتهت"));
  // «إلغاء»
  await tap(WH_PHONE, SP_START); await tap(WH_PHONE, `sp_sup_${SUP}`); await write(WH_PHONE, "إلغاء");
  assert("«إلغاء»: nothing recorded", texts(WH_PHONE).at(-1) === SP_TEXT.cancelled && payments().length === 2);
  await write(WH_PHONE, "300");
  assert("…and a number after it is not a payment (the usual line)", payments().length === 2);
  // team media outside the flow: nothing
  const n = sentTo(WH_PHONE).length;
  await say(WH_PHONE, { type: "image", image: { id: MEDIA_ID, mime_type: "image/jpeg" } });
  assert("a photo outside the flow: no payment, no reply", payments().length === 2 && sentTo(WH_PHONE).length === n);
  // the flow expires after 30 minutes
  await tap(WH_PHONE, SP_START); await tap(WH_PHONE, `sp_sup_${SUP}`);
  ENV.MSG_DEDUP.store.delete(`sp_flow:v1:${WH}`); // the KV TTL (30 min) has passed
  await write(WH_PHONE, "100");
  assert("after the flow expired, «100» is not a payment", payments().length === 2);
  // more than three suppliers → a list
  for (const [id, name] of [[704, "مورد ٣"], [705, "مورد ٤"]] as Array<[number, string]>) seed("res.partner", { id, name, supplier_rank: 1 });
  seed("x_purchase_list", { x_date: DAY, x_status: "sent", x_aggregated_items: JSON.stringify([
    { product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 1, price_supplier_id: 704 },
    { product_id: 2, product_name: "خيار", packaging_id: 21, packaging_name: "جرم", total_quantity: 1, price_supplier_id: 705 },
  ]) });
  await tap(WH_PHONE, SP_START);
  const lst = last(WH_PHONE);
  const rowsIds = (lst?.interactive?.action?.sections?.[0]?.rows ?? []).map((r: any) => r.id);
  assert("more than three suppliers: a list message (the sent list's suppliers too)", lst?.interactive?.type === "list" && rowsIds.length === 4 && rowsIds.includes("sp_sup_704"), JSON.stringify(lst?.interactive));
  await pick(WH_PHONE, "sp_sup_705");
  assert("…a row picked → the amount step", texts(WH_PHONE).at(-1) === SP_TEXT.askAmount("مورد ٤"));
  // «تم الشراء» → the button, and the list's dues
  ENV = fresh();
  standardPrices();
  openWindow(ENV, WH_PHONE, 2);
  const sentId = confirmedList({ x_status: "sent" });
  await tap(WH_PHONE, `purchase_done_${sentId}`);
  const reply = last(WH_PHONE);
  assert("«تم الشراء»: the reply carries «💵 دفعت لمورد»", reply?.interactive?.action?.buttons?.some((b: any) => b.reply.id === SP_START) && String(reply?.interactive?.body?.text).includes("تم إرسال المسارات"), JSON.stringify(reply));
  assert("…and the confirmed list's dues are built at once", table("x_purchase_list").get(sentId)?.x_status === "done" && dueOf(SUP)?.x_amount === 168);
}

// ================================================================ 6. the supplier's notice
console.log("\n[6] the supplier's notice: text, template, held");
{
  const setup = async (window: boolean, tpl: [string, string] | null) => {
    ENV = fresh();
    standardPrices(); price(SUP, 3, 31, 12);
    await quiet(() => syncSupplierDues(ENV, confirmedList()));
    if (window) openWindow(ENV, SUP_PHONE, 5);
    if (tpl) tplRow(tpl[0], tpl[1]);
    const id = payment({ x_supplier_id: SUP, x_amount: 1500 });
    const r = await quiet(() => settlePayment(ENV, id));
    return { id, r, row: table("x_supplier_payment").get(id) as any };
  };
  const want = "تم تسجيل دفعة لك من يو تاك بمبلغ 1500.00 ر.س بتاريخ 26 سبتمبر 2026، رقم المرجع SP-2026-0001. الرصيد المتبقي لك: 0.00 ر.س.";
  assert("the text is the template's text, filled", supplierNoticeText(150000, DAY, "SP-2026-0001", -128400) === want);
  let s = await setup(true, ["APPROVED", "UTILITY"]);
  assert("inside his window: the text", sentTo(SUP_PHONE).length === 1 && texts(SUP_PHONE)[0] === want && String(s.row.x_supplier_notice).startsWith("نصاً"), texts(SUP_PHONE).join(" | "));
  s = await setup(false, ["APPROVED", "UTILITY"]);
  const t = sentTo(SUP_PHONE)[0];
  assert("outside it, APPROVED / UTILITY: utak_supplier_payment_sent [1500.00, 26 سبتمبر 2026, SP-2026-0001, 0.00]",
    t?.type === "template" && t.template.name === "utak_supplier_payment_sent" && JSON.stringify(t.template.components[0].parameters.map((p: any) => p.text)) === JSON.stringify(["1500.00", "26 سبتمبر 2026", "SP-2026-0001", "0.00"])
      && String(s.row.x_supplier_notice).startsWith("بالقالب"), JSON.stringify(t));
  s = await setup(false, ["PENDING", "UTILITY"]);
  assert("outside it, PENDING: held (critical, § 34), nothing sent", sentTo(SUP_PHONE).length === 0 && heldFor(ENV, SUP_PHONE).length === 1 && heldFor(ENV, SUP_PHONE)[0].purpose === "supplier_payment_sent"
    && String(s.row.x_supplier_notice).startsWith("محفوظ"));
  assert("…a critical purpose: its «فتح المحادثة» was tried (no usable template → a «skipped» row)", PURPOSES.supplier_payment_sent.critical === true
    && (rows("x_wa_message") as any[]).some((w) => w.x_status === "skipped" && String(w.x_meta_error).includes("conv_open_supplier")));
  s = await setup(false, ["APPROVED", "MARKETING"]);
  assert("outside it, MARKETING: never used, held", sentTo(SUP_PHONE).length === 0 && heldFor(ENV, SUP_PHONE).length === 1);
  s = await setup(false, null);
  assert("outside it, no template row: held", sentTo(SUP_PHONE).length === 0 && heldFor(ENV, SUP_PHONE).length === 1);
  // held → sent at his next message, the text in full
  openWindow(ENV, SUP_PHONE, 0);
  await quiet(async () => { const { flushHeld } = await import("../src/wa-gateway.ts"); await flushHeld(ENV, SUP_PHONE, { open: true } as any); });
  assert("…and reaches him as text at his next message", texts(SUP_PHONE).at(-1) === want);
  // a trial tag starts every text about the payment
  ENV = fresh();
  standardPrices();
  await quiet(() => syncSupplierDues(ENV, confirmedList()));
  openWindow(ENV, SUP_PHONE, 5); openWindow(ENV, WH_PHONE, 5);
  const tagId = payment({ x_supplier_id: SUP, x_amount: 20, x_channel: "whatsapp", x_method: "cash", x_recorded_by: WH, x_trial_tag: "🧪 تجربة § 37" });
  decide(tagId, "approved");
  await quiet(() => settlePayment(ENV, tagId));
  assert("a trial tag: the supplier's text and the member's line start with it", texts(SUP_PHONE).at(-1)!.startsWith("🧪 تجربة § 37 — تم تسجيل دفعة لك") && texts(WH_PHONE).at(-1)!.startsWith("🧪 تجربة § 37 — ✅ اعتمد براء"));
  // outside his window, a trial's notice never goes as the (untagged) template: held, tagged
  tplRow("APPROVED", "UTILITY");
  ENV.MSG_DEDUP.store.delete(`wa_win:v1:${SUP_PHONE}`);
  const tag2 = payment({ x_supplier_id: SUP, x_amount: 21, x_trial_tag: "🧪 تجربة § 37" });
  const before = sentTo(SUP_PHONE).length;
  await quiet(() => settlePayment(ENV, tag2));
  assert("a trial's notice outside the window: no template (it cannot carry the tag) — held, tagged",
    sentTo(SUP_PHONE).length === before && heldFor(ENV, SUP_PHONE).some((i: any) => String(i.body?.text?.body).startsWith("🧪 تجربة § 37 — تم تسجيل دفعة لك")));
}

// ================================================================ 7. no accounting
console.log("\n[7] no account.move, no account.payment");
{
  const touched = odooLog.filter((l) => /^account\.(move|payment)/.test(l.model));
  assert("this whole run never touched account.move / account.payment (not even a read)", touched.length === 0, JSON.stringify(touched.slice(0, 3).map((l) => `${l.model}.${l.method}`)));
  const src = readFileSync(new URL("../src/supplier-pay.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert("src/supplier-pay.ts names neither model outside its comments", !/account\.move|account\.payment/.test(src));
  const script = readFileSync(new URL("../scripts/s37-20260925-odoo.mjs", import.meta.url), "utf8");
  assert("the Odoo setup only counts them (search_count), never writes them", !/"account\.(move|payment)",\s*"(create|write|unlink)"/.test(script));
}

// ================================================================ 8. the hook and the tick
console.log("\n[8] the hook (401 / 400 / 202) and the tick");
{
  ENV = fresh();
  standardPrices();
  await quiet(() => syncSupplierDues(ENV, confirmedList()));
  openWindow(ENV, SUP_PHONE, 5); openWindow(ENV, WH_PHONE, 5);
  const hook = async (qs: string, body: unknown) => {
    const c = collectingCtx();
    const r = await quiet(async () => {
      const res = await worker.fetch(new Request(`https://w.test/odoo/hook/supplier-pay?${qs}`, { method: "POST", body: JSON.stringify(body) }), ENV, c);
      await Promise.all(c.tasks);
      return res;
    });
    return r.status;
  };
  const pend = payment({ x_supplier_id: SUP, x_amount: 40, x_channel: "whatsapp", x_method: "cash", x_recorded_by: WH });
  assert("no token → 401", await hook(`op=decided`, { _model: "x_supplier_payment", _id: pend }) === 401);
  assert("an unknown op → 400; no id → 400; another model → 400",
    await hook("token=HOOKTOKEN&op=paid", { _id: pend }) === 400 && await hook("token=HOOKTOKEN&op=decided", {}) === 400 && await hook("token=HOOKTOKEN&op=decided", { _model: "x_price_day", _id: pend }) === 400);
  const n0 = sentTo(SUP_PHONE).length;
  assert("op=created on Omar's pending payment → 202, nothing sent", await hook("token=HOOKTOKEN&op=created", { _model: "x_supplier_payment", _id: pend }) === 202 && sentTo(SUP_PHONE).length === n0);
  decide(pend, "approved");
  assert("op=decided after «اعتماد» → 202, the notice goes", await hook("token=HOOKTOKEN&op=decided", { _model: "x_supplier_payment", _id: pend }) === 202 && sentTo(SUP_PHONE).length === n0 + 1);
  const own = payment({ x_supplier_id: SUP, x_amount: 5 });
  assert("op=created on Baraa's own (approved at once) → the notice goes", await hook("token=HOOKTOKEN&op=created", { _model: "x_supplier_payment", _id: own }) === 202 && sentTo(SUP_PHONE).length === n0 + 2);
  // a lost webhook: the tick settles it 3 minutes after the decision, not before
  const lost = payment({ x_supplier_id: SUP, x_amount: 7, x_channel: "whatsapp", x_method: "cash", x_recorded_by: WH });
  decide(lost, "approved");
  setRiyadh(`${DAY} 10:02`);
  const t1 = await quiet(() => runSupplierPayTick(ENV));
  assert("the tick: a decision under 3 minutes old is left to its webhook", Array.isArray(t1.settled) && t1.settled.length === 0 && !table("x_supplier_payment").get(lost)?.x_settled_at);
  setRiyadh(`${DAY} 10:04`);
  const t2 = await quiet(() => runSupplierPayTick(ENV));
  assert("…settled after 3 minutes (a lost webhook)", Array.isArray(t2.settled) && t2.settled.some((r) => r.id === lost && r.action === "approved") && !!table("x_supplier_payment").get(lost)?.x_settled_at);
  const t3 = await quiet(() => runSupplierPayTick(ENV));
  assert("…once", Array.isArray(t3.settled) && t3.settled.length === 0);
  assert("op=refresh → 202 (the dues of the last 7 days)", await hook("token=HOOKTOKEN&op=refresh", { _model: "res.partner", _id: SUP }) === 202);
  const r = await quiet(() => onPaymentHook(ENV, 99999, { waitMs: 1 }));
  assert("a payment Odoo has not committed yet: read again, then «not_found»", r.action === "not_found");
}

// ================================================================ 10. § 37 ج — simulation records
console.log("\n[10] § 37 ج: a simulation record counts nowhere, and its notice never goes");
{
  const SIM = SPM.SIM_FIELD;
  const { sendViaGateway, gatewayDecision, flushHeld } = await import("../src/wa-gateway.ts");
  const { textContent } = await import("../src/meta.ts");
  const { sendOwnerAlert } = await import("../src/templates.ts");
  /** Run with the console captured (the skip lines), not printed. */
  const logged = async <T,>(fn: () => Promise<T>): Promise<{ r: T; lines: string[] }> => {
    const lines: string[] = [];
    const real = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    try { return { r: await fn(), lines }; } finally { Object.assign(console, real); }
  };
  const spReads = () => odooLog.filter((l) => l.model === "x_supplier_payment" && l.method === "search_read").length;

  // (1) out of the dues, the balance and «رصيد دائن»
  ENV = fresh();
  standardPrices(); price(SUP, 3, 31, 12);
  const realList = confirmedList();
  await quiet(() => syncSupplierDues(ENV, realList)); // SUP 216.00, SUP2 50.00
  const simList = confirmedList({ [SIM]: true });
  const alerts0 = ownerAlerts().length;
  const s1 = await logged(() => syncSupplierDues(ENV, simList));
  assert("a simulation list: no due built, no «بلا سعر» alert, the skip in the log",
    s1.r.action === "simulation" && !dues().some((d) => d.x_purchase_list_id === simList) && ownerAlerts().length === alerts0
      && s1.lines.some((l) => l.includes(`skip dues list=${simList}`) && l.includes(SIM)), JSON.stringify(s1));
  const tick = await quiet(() => syncRecentDues(ENV, Date.now(), { force: true }));
  assert("…the tick and «🔄 إعادة حساب المستحقات» leave it out, the real list is still synced", !tick.some((x) => x.listId === simList) && tick.some((x) => x.listId === realList));
  // the trial's leftovers, marked afterwards: a due of 168 and an approved 150 on SUP, an overpaying 500 on SUP2
  seed("x_supplier_due", { x_supplier_id: SUP, x_purchase_list_id: simList, x_date: DAY, x_amount: 168, x_unpriced_count: 1, [SIM]: true });
  const simPaid = payment({ x_supplier_id: SUP, x_amount: 150, [SIM]: true });
  payment({ x_supplier_id: SUP2, x_amount: 500, [SIM]: true });
  const b1 = await supplierBalance(ENV, SUP);
  assert("the balance leaves the simulation due (168) and payment (150) out: due 216.00, paid 0, remaining 216.00", b1.dueH === 21600 && b1.paidH === 0 && b1.remainingH === 21600, JSON.stringify(b1));
  const b2 = await supplierBalance(ENV, SUP2);
  assert("…a simulation overpayment is no «رصيد دائن» (SUP2: due 50.00, paid 0, remaining 50.00)", b2.dueH === 5000 && b2.paidH === 0 && b2.remainingH === 5000, JSON.stringify(b2));
  const py = `
import json, sys
class L(list):
    def mapped(self, f):
        return [getattr(x, f) for x in self]
    def filtered(self, fn):
        return L([x for x in self if fn(x)])
class R:
    def __init__(self, **kw):
        self.__dict__.update(kw)
    def __setitem__(self, k, v):
        self.__dict__[k] = v
    def __getitem__(self, k):
        return self.__dict__[k]
code, dues, pays = json.loads(sys.argv[1])
rec = R(x_sp_due_ids=L([R(**d) for d in dues]), x_sp_payment_ids=L([R(**p) for p in pays]))
for c in code:
    exec(c, {'self': [rec]})
print(json.dumps([rec['x_sp_due_total'], rec['x_sp_paid_total'], rec['x_sp_remaining']]))
`;
  const only = (r: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k] ?? false]));
  const supDues = dues().filter((d) => d.x_supplier_id === SUP).map((d) => only(d, ["x_amount", SIM]));
  const supPays = payments().filter((p) => p.x_supplier_id === SUP).map((p) => only(p, ["x_amount", "x_state", SIM]));
  const odooSums = JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify([[ODOO_CODE.DUE_TOTAL_COMPUTE, ODOO_CODE.PAID_TOTAL_COMPUTE, ODOO_CODE.REMAINING_COMPUTE], supDues, supPays])], { encoding: "utf8" }));
  assert("Odoo's computes (python3, the same rows): 216 / 0 / 216 — the worker's sums", JSON.stringify(odooSums) === JSON.stringify([216, 0, 216]), JSON.stringify(odooSums));
  assert("…and they depend on the flag (a mark recomputes them)", [ODOO_CODE.DUE_TOTAL_DEPENDS, ODOO_CODE.PAID_TOTAL_DEPENDS, ODOO_CODE.REMAINING_DEPENDS].every((d) => d.includes(SIM)) && ODOO_CODE.SP_O2M_DOMAIN.includes(SIM));
  seed("res.partner", { id: 777, name: "مورد تجربة", supplier_rank: 1 });
  seed("x_purchase_list", { x_date: DAY, x_status: "done", [SIM]: true, x_aggregated_items: JSON.stringify([{ product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 1, price_supplier_id: 777 }]) });
  const today = await SPM.todaysSuppliers(ENV);
  assert("Omar's picker: a supplier only on a simulation list is not «today's»", !today.some((s) => s.id === 777) && today.some((s) => s.id === SUP));

  // (2) a simulation payment never reaches utak_supplier_payment_sent
  tplRow("APPROVED", "UTILITY"); // outside his window, the template would go
  const g0 = graph.length, a0 = ownerAlerts().length;
  const s2 = await logged(() => settlePayment(ENV, simPaid));
  const simRow = table("x_supplier_payment").get(simPaid) as any;
  assert("a simulation payment, approved, outside the window with the template APPROVED / UTILITY: nothing to Meta, nothing held, no alert",
    s2.r.action === "simulation" && graph.length === g0 && heldFor(ENV, SUP_PHONE).length === 0 && ownerAlerts().length === a0, JSON.stringify(s2.r));
  assert("…settled «لا إشعار للمورد (محاكاة)», and the skip in the log naming the template",
    !!simRow.x_settled_at && simRow.x_supplier_notice === SPM.SIM_NOTICE && s2.lines.some((l) => l.includes(`[supplier-pay] skip ${simRow.x_name}`) && l.includes("utak_supplier_payment_sent")), s2.lines.join(" | "));
  const simOmar = payment({ x_supplier_id: SUP, x_amount: 40, x_channel: "whatsapp", x_method: "cash", x_recorded_by: WH, [SIM]: true });
  decide(simOmar, "approved");
  openWindow(ENV, SUP_PHONE, 5); openWindow(ENV, WH_PHONE, 5);
  await quiet(() => settlePayment(ENV, simOmar));
  assert("…Omar's simulation payment, inside both windows: no text to the supplier, no line to Omar", sentTo(SUP_PHONE).length === 0 && sentTo(WH_PHONE).length === 0);
  ENV.MSG_DEDUP.store.delete(`wa_win:v1:${SUP_PHONE}`);
  // the gateway itself, whoever sends
  const simRef = String(simRow.x_name);
  const params = SPM.supplierNoticeParams(15000, DAY, simRef, 0);
  const g1 = graph.length;
  const direct = await logged(() => sendViaGateway(ENV, {
    purpose: "supplier_payment_sent", to: SUP_PHONE,
    content: textContent(supplierNoticeText(15000, DAY, simRef, 0)),
    fallback: [{ kind: "template", purpose: "supplier_payment_sent", params }],
  }));
  assert("the gateway: its notice (text, the template as fallback) naming a simulation payment → refused, nothing sent, the skip in the log",
    gatewayDecision(direct.r)?.action === "refused" && graph.length === g1 && heldFor(ENV, SUP_PHONE).length === 0
      && direct.lines.some((l) => l.includes("[gateway] skip purpose=supplier_payment_sent") && l.includes(simRef)), direct.lines.join(" | "));
  const manual = await quiet(() => sendViaGateway(ENV, {
    purpose: "wa_message_manual", to: SUP_PHONE, manual: true,
    content: { kind: "template", row: { id: 1, x_meta_template_id: "utak_supplier_payment_sent", x_language: "ar", x_meta_status: "APPROVED", x_category: "UTILITY", x_param_count: 4 } as any, params },
  }));
  assert("…a manual send from Odoo of utak_supplier_payment_sent with that reference → refused", gatewayDecision(manual)?.action === "refused" && graph.length === g1);
  // a notice held before its payment was marked: the flush refuses it
  const late = payment({ x_supplier_id: SUP, x_amount: 60 });
  const lateRef = String(table("x_supplier_payment").get(late)?.x_name);
  await quiet(() => sendViaGateway(ENV, { purpose: "supplier_payment_sent", to: SUP_PHONE, content: textContent(supplierNoticeText(6000, DAY, lateRef, 0)) }));
  assert("…(a real payment's notice outside the window is held, as before)", heldFor(ENV, SUP_PHONE).length === 1);
  (table("x_supplier_payment").get(late) as any)[SIM] = true; // marked afterwards, as the cleanup did
  openWindow(ENV, SUP_PHONE, 0);
  const g2 = graph.length;
  const fl = await quiet(() => flushHeld(ENV, SUP_PHONE, { open: true } as any));
  assert("…held, then marked: at the supplier's next message the flush refuses it — not sent, its row «skipped» with the reason",
    graph.length === g2 && fl.sent === 0 && fl.dropped === 1
      && (rows("x_wa_message") as any[]).some((w) => w.x_status === "skipped" && String(w.x_meta_error).includes(`دفعة محاكاة ${lateRef}`)), JSON.stringify(fl));
  ENV.MSG_DEDUP.store.delete(`wa_win:v1:${SUP_PHONE}`);
  // Odoo cannot say: refused (a trial amount must not reach a real supplier)
  failSpRead = true;
  const down = await quiet(() => sendViaGateway(ENV, { purpose: "supplier_payment_sent", to: SUP_PHONE, content: textContent("x"), fallback: [{ kind: "template", purpose: "supplier_payment_sent", params: SPM.supplierNoticeParams(100, DAY, "SP-2026-0099", 0) }] }));
  failSpRead = false;
  assert("…Odoo unreachable for the check → refused, nothing sent", gatewayDecision(down)?.action === "refused" && String((gatewayDecision(down) as any)?.reason).includes("تعذّر التحقق") && graph.length === g2);
  const reads0 = spReads();
  await quiet(() => sendOwnerAlert(ENV, "تنبيه عادي"));
  assert("…any other purpose: no payment read at all", spReads() === reads0);

  // (3) a normal payment beside them: counted and notified exactly as before
  const realPay = payment({ x_supplier_id: SUP, x_amount: 100 });
  const g3 = graph.length;
  const r3 = await quiet(() => settlePayment(ENV, realPay));
  const t = sentTo(SUP_PHONE).at(-1);
  const realRef = String(table("x_supplier_payment").get(realPay)?.x_name);
  assert("a normal payment: approved, counted (paid 100.00, remaining 116.00 — the marked 60 out too), outside the window → utak_supplier_payment_sent",
    r3.action === "approved" && r3.remaining === "116.00" && graph.length === g3 + 1 && t?.type === "template" && t.template.name === "utak_supplier_payment_sent"
      && JSON.stringify(t.template.components[0].parameters.map((p: any) => p.text)) === JSON.stringify(["100.00", "26 سبتمبر 2026", realRef, "116.00"]), JSON.stringify({ r3, t }));
  openWindow(ENV, SUP_PHONE, 5);
  const realPay2 = payment({ x_supplier_id: SUP, x_amount: 6 });
  await quiet(() => settlePayment(ENV, realPay2));
  assert("…inside his window: the text, as before", texts(SUP_PHONE).at(-1) === supplierNoticeText(600, DAY, String(table("x_supplier_payment").get(realPay2)?.x_name), 11000));
  const b3 = await supplierBalance(ENV, SUP);
  assert("…the balance: due 216.00, paid 106.00 (100 + 6), remaining 110.00 — the simulation ones (150, 40, 60) still out", b3.dueH === 21600 && b3.paidH === 10600 && b3.remainingH === 11000, JSON.stringify(b3));
}

// ================================================================ 9. schema
console.log("\n[9] schema: every Odoo write names real fields and values");
assert("no write named a field or value the fixtures do not know", rejected.length === 0, rejected.slice(0, 5).join(" | "));
assert("the purposes are registered (the notice critical, the member's line not)", PURPOSES.supplier_payment_sent?.critical === true && !!PURPOSES.team_sp_decision && !PURPOSES.team_sp_decision.critical);

console.log(`\n${passed} ✓  ${failed} ✗`);
if (failed) { console.log("failures:\n  " + failures.join("\n  ")); process.exit(1); }
