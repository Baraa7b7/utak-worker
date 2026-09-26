// § 40 (2026-09-26) — what the pricing engine v1 computes on the tenant today,
// with nothing sent and nothing written.
//
//   • Odoo: reads only. Any other method is refused (throws) — none is expected.
//   • Meta, Claude, Cloudflare: refused. KV: in memory (nothing is claimed for real).
//   • The engine for today (Riyadh): the sources, the day's offers (x_daily_price of
//     ticked suppliers, x_price_offer), each active product and packaging with its
//     purchase, market, sale, unit profit, status and reason; the exceptions and
//     whether they would go one per item or as one count message.
//   • The costs: daily_operating_cost today and on 2026-10-01; the settings and tiers;
//     the 02:30 market-ask targets; tonight's coverage line.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s40-20260926-dryrun.mts [YYYY-MM-DD]
//
// Out: scripts/artifacts/s40-20260926-dryrun.json
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED (dry run): ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) throw new Error(`BLOCKED (dry run): ${m[1]}.${m[2]} is not a read`);
  return realFetch(input, init);
}) as typeof fetch;

const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  OWNER_WHATSAPP: "+966505154962", PILOT_MODE: "true", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};

const EN = await import("../src/pricing-engine.ts");
const PS = await import("../src/price-sources.ts");
const OC = await import("../src/operating-cost.ts");
const OP = await import("../src/order-pricing.ts");
const PR = await import("../src/prices.ts");
const SUM = await import("../src/owner-summary.ts");
const { riyadhDateKey, riyadhHHMM } = await import("../src/hours.ts");
const { call } = await import("../src/odoo.ts");

const now = Date.now();
const day = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : riyadhDateKey(new Date(now));
const sources = await PS.loadPriceSources(env);
const offers = await EN.readDayOffers(env, day, sources);
const items = await EN.readActiveItems(env, offers);
const settings = await OC.readPricingSettings(env, day);
const plan = EN.computePricing(items, offers, settings?.wastePct ?? 0);
const lines = plan.map((p) => {
  const v = EN.lineVerdict(p, null, 0);
  return {
    product: p.productName, packaging: p.packagingName,
    purchase: p.purchase, purchaseFrom: p.purchaseOffer?.sourceName ?? null, market: p.market, observations: p.marketCount,
    sale: v.status === "auto" ? v.sale : null, unitProfit: p.unitProfit, displayMarginPct: p.displayMargin,
    status: v.status, reason: v.reason || null, offers: p.offersText || null,
  };
});
const exceptions = lines.filter((l) => l.status === "exception");
// the other rows of the day, outside the engine (for the record)
const dayRows = await call<Array<{ id: number; x_supplier_id: [number, string] | false; x_product_tmpl_id: [number, string] | false; x_price_sar: number; x_extraction_status: string }>>(env, "x_daily_price", "search_read", {
  domain: [["x_date", "=", day]], fields: ["id", "x_supplier_id", "x_product_tmpl_id", "x_price_sar", "x_extraction_status"], order: "id asc", limit: 200,
});
const [dayRec] = await call<Array<{ id: number; x_state: string }>>(env, "x_price_day", "search_read", { domain: [["x_date", "=", day]], fields: ["id", "x_state"], limit: 1 });
const tiers = settings ? await OP.readTiers(env, settings.configId) : [];
const costToday = await OC.dailyOperatingCost(env, day, now);
const costOct1 = await OC.dailyOperatingCost(env, "2026-10-01", now);
const costOct2 = await OC.dailyOperatingCost(env, "2026-10-02", now);
const figures = await SUM.readSummaryFigures(env, now);
const out = {
  at: new Date(now).toISOString(), riyadh: riyadhHHMM(new Date(now)), day,
  sources: {
    employees: sources.employees.map((e) => `${e.name} (موظف ${e.employeeId}، شريك ${e.partnerId})`),
    partners: sources.partners.map((p) => `${p.name} (شريك ${p.partnerId}${p.supplier ? "، مورد" : ""})`),
    marketAskTargets: [
      ...sources.employees.map((e) => e.name),
      ...sources.partners.filter((p) => !p.supplier && !sources.employees.some((e) => e.partnerId === p.partnerId)).map((p) => p.name),
    ],
  },
  offersCounted: offers.map((o) => `${o.sourceName}: ${o.kind === "purchase" ? "شراء" : "سوق"} ${o.price}${o.outlier ? " (شاذ)" : ""} — ${o.productId}/${o.packagingId} (${o.model === "dp" ? "x_daily_price" : "x_price_offer"} #${o.rowId})`),
  dailyPriceRowsToday: dayRows.map((r) => `#${r.id} ${r.x_supplier_id ? r.x_supplier_id[1] : "-"} · ${r.x_product_tmpl_id ? r.x_product_tmpl_id[1] : "-"} · ${r.x_price_sar} (${r.x_extraction_status})`),
  dayRecord: dayRec ?? null,
  settings,
  tiers,
  engine: {
    lines,
    counts: { lines: lines.length, auto: lines.filter((l) => l.status === "auto").length, exceptions: exceptions.length },
    exceptionsMessage: exceptions.length > PR.EXCEPTIONS_MANY ? `one count message (${exceptions.length} > ${PR.EXCEPTIONS_MANY}) with the review link` : `${exceptions.length} message(s), one per exception`,
    whyExceptions: Object.entries(exceptions.reduce((m: Record<string, number>, l) => { m[l.reason ?? "-"] = (m[l.reason ?? "-"] ?? 0) + 1; return m; }, {})),
  },
  costs: {
    today: { total: costToday.total, items: costToday.items, reason: costToday.reason ?? null },
    "2026-10-01": { total: costOct1.total, items: costOct1.items },
    "2026-10-02 (Friday)": { total: costOct2.total },
    minProfitPerOrder: settings?.plannedStops ? (costOct1.total ?? 0) / settings.plannedStops : "المحطات فارغ: لا خصم",
  },
  tonight: { coverage: figures.coverage, line: SUM.coverageLine(figures.coverage), templateVar3: SUM.summaryParams(figures)[2], errors: figures.errors },
};
writeFileSync(new URL("./artifacts/s40-20260926-dryrun.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
