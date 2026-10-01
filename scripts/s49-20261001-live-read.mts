// § 49 (2026-10-01) — the worker's own § 49 reads against the live tenant, READ-ONLY, before the
// deploy: every Odoo request the new code makes on its hot paths must be one the tenant accepts
// (field names, domains with «|», the new fields). The fetch guard lets through search_read / read /
// search_count / fields_get to the tenant alone; anything else — a write, a create, Graph, Claude —
// throws. KV is in memory. Nothing is written, nothing is sent.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s49-20261001-live-read.mts [label]
//
// Out: scripts/artifacts/s49-20261001-live-read[-label].json
import { readFileSync, writeFileSync } from "node:fs";

const secrets = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const READS = new Set(["search_read", "read", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
const seen: string[] = [];
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m || !READS.has(m[2])) throw new Error(`BLOCKED (read-only check): ${url.slice(0, 80)}`);
  seen.push(`${m[1]}.${m[2]}`);
  await new Promise((r) => setTimeout(r, 250));
  return realFetch(input as any, init);
}) as typeof fetch;

const store = new Map<string, string>();
const env: any = {
  ODOO_URL: secrets.ODOO_URL, ODOO_DB: secrets.ODOO_DB, ODOO_LOGIN: secrets.ODOO_LOGIN, ODOO_API_KEY: secrets.ODOO_API_KEY,
  OWNER_WHATSAPP: "", MSG_DEDUP: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); }, delete: async (k: string) => { store.delete(k); } },
};
const PV = await import("../src/price-validity.ts");
const PS = await import("../src/price-sources.ts");
const EN = await import("../src/pricing-engine.ts");
const OD = await import("../src/odoo.ts");
const OF = await import("../src/order-flow.ts");
const HRS = await import("../src/hours.ts");
const OP = await import("../src/order-pricing.ts");
const OC = await import("../src/operating-cost.ts");

const label = process.argv[2] ?? "";
const now = Date.now(), today = HRS.riyadhDateKey(new Date(now));
const out: Record<string, unknown> = { atRiyadh: new Date(now + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " "), today };
let ok = 0, bad = 0;
const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; console.log(`  ✓ ${name}`); } else { bad++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };

const list = await PV.validPriceList(env, now);
out.validList = list;
const days = await OD.call<Array<{ id: number; x_date: string; x_state: string; x_published_at: string | false }>>(env, "x_price_day", "search_read", { domain: [["x_utak_simulation", "!=", true], ["x_date", ">=", HRS.addDaysYmd(today, -3)]], fields: ["id", "x_date", "x_state", "x_published_at"], order: "x_date desc, id desc", limit: 10 });
out.days = days;
const expect = days.filter((d) => d.x_state === "published").map((d) => ({ d, until: PV.listValidUntilMs(d.x_date, d.x_published_at ? HRS.odooUtcMs(d.x_published_at) : null) })).find((x) => now < x.until);
check(`the valid price list now: ${list ? `day #${list.dayId} (${list.day}), until ${new Date(list.validUntilMs + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} Riyadh` : "none"} — as the real days say (${days.map((d) => `#${d.id} ${d.x_date} ${d.x_state}`).join(" · ")})`, (list?.dayId ?? null) === (expect?.d.id ?? null));
check(`the list of today asked by its date: ${JSON.stringify(await PV.listOfDayIfValid(env, today, now))}`, true);
const settings = await OC.readPricingSettings(env, today);
out.settings = settings;
check(`أ — the active settings: minimum order ${settings?.minOrder} (0 = none)`, settings?.minOrder === 0, JSON.stringify(settings));
const src = await PS.loadPriceSources(env);
out.sources = { partners: src.partners.map((p) => ({ id: p.partnerId, name: p.name, supplier: p.supplier, role: p.role })), employees: src.employees.map((e) => ({ id: e.employeeId, partnerId: e.partnerId, name: e.name, role: e.role })) };
check(`د — the sources and their roles as the worker reads them: ${[...src.partners.map((p) => `${p.name} (#${p.partnerId}): ${p.role}`), ...src.employees.map((e) => `${e.name} (employee #${e.employeeId}): ${e.role}`)].join(" · ")}`,
  src.partners.find((p) => p.partnerId === 30)?.role === "purchase" && src.employees.find((e) => e.employeeId === 4)?.role === "market");
check(`د — partnerPriceRole(#30) = ${await PS.partnerPriceRole(env, 30)}`, (await PS.partnerPriceRole(env, 30)) === "purchase");
const offers = await EN.readDayOffers(env, today, src);
out.offers = offers;
const omar = src.employees.find((e) => e.employeeId === 4)?.partnerId;
check(`د — today's offers: ${offers.length} (${offers.map((o) => `${o.sourceName} ${o.kind} ${o.price}`).join(" · ") || "none"}) — no purchase offer from a «سوق» source`, !offers.some((o) => o.kind === "purchase" && o.partnerId === omar));
const unconfirmed = await OD.getUnconfirmedOrders(env, today);
out.unconfirmed = unconfirmed;
check(`ب — today's unconfirmed real orders (the 20:00 / 21:00 query with the new fields): ${unconfirmed.length}`, Array.isArray(unconfirmed));
const open = await OD.call<Array<{ id: number }>>(env, "x_daily_order", "search_read", {
  domain: [["x_customer_id", "=", 31], ["x_state", "in", ["draft", "waiting_confirmation"]], "|", ["x_order_date", "=", HRS.nextOrderingDate(new Date(now))], ["x_awaiting_prices", "=", true]],
  fields: ["id", "x_state"], limit: 1, order: "id desc",
});
check(`ب — the open-order query of a customer (#31), with «|» and x_awaiting_prices: accepted (${open.length} row)`, Array.isArray(open));
const [last] = await OD.call<Array<{ id: number }>>(env, "x_daily_order", "search_read", { domain: [], fields: ["id"], order: "id desc", limit: 1 });
const brief = last ? await OD.getOrderBrief(env, last.id) : null;
const inv = last ? await OD.getOrderForInvoicing(env, last.id) : null;
out.lastOrder = { brief, price_date: inv?.price_date ?? null, lines: inv?.lines.length ?? 0 };
check(`ب — an order read with «أسعار يوم» and «بانتظار أسعار اليوم» (order #${last?.id}: priceDate «${brief?.priceDate}», awaiting ${brief?.awaitingPrices})`, !!brief && brief.priceDate !== undefined && typeof brief.awaitingPrices === "boolean" && inv !== undefined);
const minimum = last ? await OP.orderMinimum(env, last.id) : null;
check(`أ — orderMinimum on it: ${JSON.stringify(minimum)}`, minimum?.below === false && minimum.min === 0);
const waiting = await OF.quoteAwaitingOrders(env, now);
out.waiting = waiting;
check(`ب — the orders waiting for prices: ${waiting.length} quoted now (none is expected to exist yet)`, waiting.length === 0);
const lists = await OD.call<Array<{ id: number; x_status: string }>>(env, "x_purchase_list", "search_read", { domain: [["x_status", "in", ["draft", "sent"]], ["x_utak_simulation", "!=", true]], fields: ["id", "x_status"], order: "id desc", limit: 20 });
check(`ج — the purchase lists not bought yet (the query of a delivery on the spot): ${lists.length}`, Array.isArray(lists));
if (list) {
  const line = await OD.call<Array<{ x_product_tmpl_id: [number, string]; x_packaging_id: [number, string]; x_sale_price: number }>>(env, "x_price_day_line", "search_read", { domain: [["x_day_id", "=", list.dayId]], fields: ["x_product_tmpl_id", "x_packaging_id", "x_sale_price"], limit: 1 });
  if (line[0]) {
    const p = await PV.listPrice(env, list, line[0].x_product_tmpl_id[0], line[0].x_packaging_id[0]);
    check(`ب — the price of «${line[0].x_product_tmpl_id[1]}» in the valid list: ${p.price} (${p.source})`, p.price > 0);
  }
}
out.requests = seen;
console.log(`\n${ok} ✓  ${bad} ✗ · ${seen.length} Odoo reads, 0 writes`);
writeFileSync(new URL(`./artifacts/s49-20261001-live-read${label ? `-${label}` : ""}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
process.exit(bad ? 1 : 0);
