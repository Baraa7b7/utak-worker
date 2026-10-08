// § 66 (2026-10-08) — the simulated order of scripts/s66-20261008-scenario.mjs as the day's own readers see it:
// READ-ONLY, the worker's own code (this tree) against the tenant — the purchase list its lines make beside the
// real orders of its day, the delivery form's lines, and the invoice's arithmetic against the quotation's total.
//
// The system makes no purchase list and no invoice for a record flagged «محاكاة» (its standing rule), so the
// 21:15 job and the delivery skip this order; what they would read and compute for the same order when it is a
// real one is what is printed here, by the very functions they call:
//   getOrderForInvoicing · deliveryLines · aggregatePurchaseList · prefillPurchasePrices · renderPurchaseListMessage
//   · computeInclusiveTotals · specialQuotationData · confirmedPlan / confirmedTotal
// (the worker's reader of a day's confirmed lines leaves a simulation out in its domain: the order's own lines
// are read here with the same fields and mapped the same way.)
//
// Nothing but utakfresh.odoo.com is reachable, and only reads leave this process: a write throws. No WhatsApp.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s66-20261008-scenario-preview.mts
//
// Out: scripts/artifacts/s66-20261008-scenario-preview.txt
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const RB = new URL("scripts/artifacts/s66-20261008-scenario-rollback.json", root);
if (!existsSync(RB)) { console.log("✗ the scenario has not run (no rollback file)"); process.exit(2); }
const made = JSON.parse(readFileSync(RB, "utf8")).created as { quote?: number; order?: number; partner?: number };
if (!made.quote || !made.order) { console.log("✗ the scenario made no order yet"); process.exit(2); }

// ---------------------------------------------------------------- the gate: Odoo alone, reads alone
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
const pause = (ms = 450) => new Promise((r) => setTimeout(r, ms));
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED (not Odoo): ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) throw new Error(`BLOCKED (a write): ${m[1]}.${m[2]}`);
  await pause(); // the rate limit is shared with the live worker
  return realFetch(input, init);
}) as typeof fetch;
const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: dotenv.ODOO_URL, ODOO_API_KEY: dotenv.ODOO_API_KEY, ODOO_DB: dotenv.ODOO_DB, ODOO_LOGIN: dotenv.ODOO_LOGIN,
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};

const O = await import("../src/odoo.ts");
const SQ = await import("../src/special-quote.ts");
const QT = await import("../src/special-quotation.ts");
const ACC = await import("../src/special-accept.ts");
const DF = await import("../src/delivery-form.ts");
const TEAM = await import("../src/team.ts");
const { computeInclusiveTotals } = await import("../src/accounting.ts");

const out: string[] = [];
let ok = true;
const say = (s = "") => { out.push(s); console.log(s); };
const check = (label: string, cond: boolean, detail = "") => { say(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`); if (!cond) ok = false; };
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const q = (await SQ.readQuote(env, made.quote))!;
const order = (await O.getOrderForInvoicing(env, made.order))!;
say(`request #${q.id} ${q.name} (${q.state}) → order #${order.id} of ${order.order_date}, «${order.customer_name}»`);
check("the order is this request's, and both are a simulation", order.special_quote_id === q.id && q.simulation === true && q.accept.orderId === order.id);

// ---- the delivery form («📦 سلّم وحصّل»): the lines by their «التعبئة», at the special prices
say("\n«📦 سلّم وحصّل» — the form's lines:");
const form = (await DF.deliveryLines(env, order.id))!;
for (const l of form.lines) say(`    ${l.name} — المطلوب ${l.ordered} — ${l.price} ر.س`);
const plan = ACC.confirmedPlan(q);
check("each confirmed line of the request is a line of the form, by the quotation's «التعبئة», at its VAT-inclusive final price", form.lines.length === plan.lines.length && form.lines.every((l, i) => l.name === `${plan.lines[i].line.productName} ${plan.lines[i].line.unit}` && l.ordered === plan.lines[i].qty && l.price === plan.lines[i].line.finalPrice), JSON.stringify(form.lines.map((l) => l.name)));

// ---- the purchase list of the delivery's eve: this order's lines beside the real confirmed orders of that day
say(`\nقائمة شراء ليلة ${order.order_date} (21:15) — as the worker aggregates it with this order in it:`);
type Row = { id: number; x_order_id: [number, string] | false; x_product_tmpl_id: [number, string] | false; x_packaging_id: [number, string] | false; x_quantity: number; x_status: string | false; x_special_price?: boolean; x_pack_text?: string | false; x_special_purchase?: number | false; x_special_supplier_id?: [number, string] | false };
const real = await O.call<Array<{ id: number }>>(env, "x_daily_order", "search_read", { domain: [["x_order_date", "=", order.order_date], ["x_state", "in", ["confirmed", "in_purchase"]], ["x_utak_simulation", "!=", true]], fields: ["id"], limit: 500 });
const rows = await O.call<Row[]>(env, "x_daily_order_line", "search_read", {
  domain: [["x_order_id", "in", [order.id, ...real.map((r) => r.id)]], ["x_status", "in", ["pending", "purchased"]]],
  fields: ["id", "x_order_id", "x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_status", "x_special_price", "x_pack_text", "x_special_purchase", "x_special_supplier_id"], limit: 5000,
});
const lines = rows.filter((l) => Array.isArray(l.x_order_id) && Array.isArray(l.x_product_tmpl_id) && Array.isArray(l.x_packaging_id)).map((l) => {
  const sp = l.x_special_price === true;
  const pack = sp && typeof l.x_pack_text === "string" ? l.x_pack_text.trim() : "";
  return {
    order_id: (l.x_order_id as [number, string])[0], customer_id: 0, customer_name: "", neighborhood: "",
    product_id: (l.x_product_tmpl_id as [number, string])[0], product_name: O.stripRef((l.x_product_tmpl_id as [number, string])[1]),
    packaging_id: (l.x_packaging_id as [number, string])[0], packaging_name: pack || O.stripRef((l.x_packaging_id as [number, string])[1]), quantity: l.x_quantity,
    ...(sp ? { special: q.name, special_line: l.id, special_purchase: typeof l.x_special_purchase === "number" && l.x_special_purchase > 0 ? l.x_special_purchase : null, special_supplier_id: Array.isArray(l.x_special_supplier_id) ? l.x_special_supplier_id[0] : null } : {}),
  };
});
const items = (await O.prefillPurchasePrices(env, O.aggregatePurchaseList(lines), String(order.order_date))).items;
for (const l of TEAM.renderPurchaseListMessage(items).split("\n")) say(`    ${l}`);
const mine = items.filter((it) => it.special === q.name);
check(`this order's ${plan.lines.length} lines are ${plan.lines.length} items of their own, marked «طلب خاص ${q.name}» with their target purchase prices — beside ${real.length} real order(s) of that day`, mine.length === plan.lines.length && mine.every((it, i) => it.total_quantity === plan.lines[i].qty && it.packaging_name === plan.lines[i].line.unit && it.unit_price === plan.lines[i].line.purchase && TEAM.specialNote(it) === ` (طلب خاص ${q.name}، الشراء المستهدف ${it.unit_price})`), JSON.stringify(mine.map((it) => [it.packaging_name, it.total_quantity, it.unit_price])));
check("the source of each target price is the one who gave it (Ahmed #30)", mine.every((it) => it.price_supplier_id === 30), JSON.stringify(mine.map((it) => it.price_supplier_id)));

// ---- the invoice's arithmetic, delivered whole, against the quotation's own total for the confirmed quantities
say("\nالفاتورة لو سُلّم كله — بحساب الفاتورة نفسه:");
const lineTotals = order.lines.map((l) => round2((l.unit_price ?? 0) * l.quantity));
const split = computeInclusiveTotals(lineTotals, 15);
say(`    ${order.lines.map((l, i) => `${l.product_name} ${l.packaging_name} × ${l.quantity} × ${l.unit_price} = ${lineTotals[i]}`).join("\n    ")}`);
say(`    قبل الضريبة ${split.subtotal} · الضريبة ${split.tax} · الإجمالي ${split.total}`);
const byQty = QT.specialQuotationData({ ...q, layout: "qty", lines: plan.lines.map((x) => ({ ...x.line, qty: x.qty })) }, "معاينة", { name: q.partnerName, address: "", phone: "" }, Date.now());
say(`    عرض السعر «قبل الضريبة» بالكميات المؤكدة: المجموع قبل الضريبة ${byQty.subtotal} · الضريبة ${byQty.vatAmount} · الإجمالي ${byQty.grandTotal}`);
check(`the invoice's total = the quotation's total = «إجمالي الطلب المؤكد», to the halala: ${split.total}`, split.total === byQty.grandTotal && split.total === q.accept.total && split.total === ACC.confirmedTotal(plan.lines), JSON.stringify([split.total, byQty.grandTotal, q.accept.total]));
check("each line's price is its price before VAT × 1.15, to the halala", order.lines.every((l, i) => l.unit_price === plan.lines[i].line.finalPrice && l.unit_price === round2(plan.lines[i].line.finalNet * 1.15)), JSON.stringify(order.lines.map((l) => l.unit_price)));
check("the lines are «سعر خاص» (no price list and no recalculation changes them)", order.lines.every((l) => l.special && l.price_unit_manual === l.unit_price));

say(ok ? "\npreview: ok" : "\npreview: FAILED");
writeFileSync(new URL("scripts/artifacts/s66-20261008-scenario-preview.txt", root), out.join("\n") + "\n");
process.exit(ok ? 0 : 1);
