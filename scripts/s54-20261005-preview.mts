// § 54 (2026-10-05) — what the day's price review would read for a day of the tenant, as it arrives
// at 04:00 (every row waiting for Baraa's decision): the worker's own text (src/price-review.ts
// buildReviewTexts) over the day's stored lines — § 55: the line with its mark and «ربحنا», the three
// choice lines, and what moved on an outlier. READ-ONLY: five search_read calls (and up to three for
// each outlier), nothing written, nothing sent — this script imports worker code, so it blocks
// graph.facebook.com.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s54-20261005-preview.mts [YYYY-MM-DD] [--form]
//
// No day = today (Riyadh). --form also prints what each item of the form («✏️ عدّل») shows.
// @ts-ignore — plain .mjs helper
import { call } from "./lib/odoo-cli.mjs";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  if (url.includes("graph.facebook.com")) throw new Error("blocked: this script never sends");
  return realFetch(input, init);
}) as typeof fetch;

const RV = await import("../src/price-review.ts");
const PR = await import("../src/prices.ts");
const { FLOW_CATEGORIES } = await import("../src/price-flow.ts");
const { aboveSuggestedOf } = await import("../src/pricing-engine.ts");

const pause = () => new Promise((r) => setTimeout(r, 900));
const day = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const [rec] = await call("x_price_day", "search_read", { domain: [["x_date", "=", day], ["x_utak_simulation", "!=", true]], fields: ["id", "x_date", "x_state"], order: "id asc", limit: 1 });
if (!rec) { console.log(`no x_price_day for ${day}`); process.exit(1); }
await pause();
const lines = await call("x_price_day_line", "search_read", { domain: [["x_day_id", "=", rec.id]], fields: PR.LINE_FIELDS, order: "x_sequence asc, id asc", limit: 500 });
await pause();
const cfgFields = await call("x_pricing_config", "fields_get", { attributes: ["type"] });
const hasSetting = "x_above_suggested" in cfgFields;
const [cfg] = await call("x_pricing_config", "search_read", {
  domain: [["x_is_active", "=", true], ["x_active_from", "<=", day], "|", ["x_active_to", "=", false], ["x_active_to", ">=", day]],
  fields: ["id", ...(hasSetting ? ["x_above_suggested"] : [])], order: "x_active_from desc, id desc", limit: 1,
});
const above = aboveSuggestedOf(cfg?.x_above_suggested);
// as at 04:00: no decision taken yet on any row
const rows = RV.reviewRows(lines, above, day).map((r) => ({ ...r, decision: null, decidedPrice: 0 }));
for (const r of rows) {
  if (!r.proposal.outlier) continue;
  await pause();
  r.moved = await RV.readMoved(async (model: string, body: Record<string, unknown>) => { await pause(); return call(model, "search_read", body); }, day, lines.find((l: any) => l.id === r.lineId));
}
await pause();
const prods = await call("product.template", "search_read", { domain: [["id", "in", [...new Set(rows.map((r) => r.productId))]]], fields: ["id", "categ_id"], limit: 500 });
await pause();
const cats = new Map<number, any>((await call("product.category", "search_read", { domain: [], fields: ["id", "name", "parent_id"], limit: 500 })).map((c: any) => [c.id, c]));
const titles = new Map<number, string>(FLOW_CATEGORIES.map((c) => [c.id, String(cats.get(c.id)?.name ?? c.title)]));
const of = new Map<number, number>();
for (const p of prods) {
  let page = 0;
  for (let c = cats.get(Array.isArray(p.categ_id) ? p.categ_id[0] : 0), hops = 0; c && hops < 20; c = cats.get(Array.isArray(c.parent_id) ? c.parent_id[0] : 0), hops++) {
    if (titles.has(c.id)) { page = c.id; break; }
  }
  of.set(p.id, page);
}
const groups = RV.groupRows(rows, of, titles);
const built = RV.buildReviewTexts(day, groups, 6 * 60);
console.log(`day #${rec.id} ${day} (${rec.x_state}) · ${lines.length} line(s), ${rows.length} in the review · «لما يكون السوق أعلى من المقترح» = ${above}${hasSetting ? "" : " (the field does not exist yet)"}\n`);
for (const t of built.texts) console.log(`──────── text (${t.length} characters)\n${t}\n`);
console.log(`──────── with the buttons (${built.body.length} characters)\n${built.body}\n[ ${RV.REVIEW_BUTTON_ALL} ] [ ${RV.REVIEW_BUTTON_FORM} ] [ ${RV.REVIEW_BUTTON_NONE} ]`);
if (process.argv.includes("--form")) {
  const f = RV.reviewFormItems(groups);
  console.log(`\n──────── the form: ${f.pages.map((p, i) => `${i + 1}. ${p}`).join(" · ")}`);
  for (const it of f.items) console.log(`${it.slot}. ${it.label}\n   ${it.info}\n   ${it.info2}\n   ${it.options.map((o) => (o.id === it.selected ? `[${o.title}]` : o.title)).join(" | ")}`);
}
