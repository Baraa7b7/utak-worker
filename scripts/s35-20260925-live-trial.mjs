// STATUS § 35 — the live trial of «💰 أسعار اليوم», Baraa (…4962) the only
// recipient who can receive anything on sim (the customers are outside the
// allowlist; the gateway refuses them before any send).
//
//   node scripts/s35-20260925-live-trial.mjs seed      today's trial prices (x_daily_price, x_is_simulation, marked «🧪 تجربة § 35»)
//   node scripts/s35-20260925-live-trial.mjs open      «💰 أسعار اليوم» (server action) + «🔄 تحديث» (webhook → the sim worker builds the lines)
//   node scripts/s35-20260925-live-trial.mjs edit      Baraa's review: another supplier, margins, «اعتماد رغم الشذوذ»
//   node scripts/s35-20260925-live-trial.mjs approve   «اعتماد أسعار اليوم» (check + lock, webhook → the worker publishes)
//   node scripts/s35-20260925-live-trial.mjs guards    after publication: a line edit, «إلغاء الاعتماد», a second record — all refused
//   node scripts/s35-20260925-live-trial.mjs state
//
// The Odoo buttons are run as ir.actions.server.run with the record as
// active_id — the call the form makes, by the API user (Baraa, user 2).
// Nothing here writes list_price / standard_price; nothing is deleted.
// Out: scripts/artifacts/s35-20260925-live-trial-<mode>.json
import { writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

const mode = process.argv[2] ?? "state";
const TODAY = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const MARK = "🧪 تجربة § 35 (أسعار محاكاة لتجربة «أسعار اليوم»، لم يرسلها مورد)";
const AHMAD = 30, TEST_SUPPLIER = 7;
// [product, packaging, supplier, price, status]
const PRICES = [
  [71, 1, AHMAD, 26, "extracted"],        // طماطم فلين · 5 كيلو — two suppliers, the cheaper one is the default
  [71, 1, TEST_SUPPLIER, 24, "extracted"],
  [72, 3, AHMAD, 45, "pending"],          // خيار جرم · 8 كيلو — its only price is an outlier: blocks until handled
  [73, 6, TEST_SUPPLIER, 18, "extracted"],// بطاطس كرتون · 10 كيلو
  [100, 37, AHMAD, 13, "extracted"],      // رمان وسط كرتون — left without margin: excluded, named to Baraa
];
const A = { openToday: 1008, approve: 1002, unapprove: 1003, refresh: 1004 };
const out = { mode, today: TODAY, at: new Date().toISOString() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dayOf = async () => (await call("x_price_day", "search_read", { domain: [["x_date", "=", TODAY]], fields: ["id", "x_name", "x_state", "x_approved_by", "x_approved_at", "x_published_at", "x_publish_report"], limit: 1 }))[0] ?? null;
const linesOf = async (id) => call("x_price_day_line", "search_read", {
  domain: [["x_day_id", "=", id]],
  fields: ["id", "x_product_tmpl_id", "x_packaging_id", "x_supplier_id", "x_offers", "x_source_price", "x_cost_price", "x_is_outlier", "x_outlier_ok", "x_margin_pct", "x_sale_price", "x_excluded", "x_blocked"],
  order: "x_sequence asc, id asc",
});
const run = async (actionId, dayId) => call("ir.actions.server", "run", {
  ids: [actionId],
  context: dayId ? { active_model: "x_price_day", active_id: dayId, active_ids: [dayId] } : {}, // the menu has no record
});
const attempt = async (label, fn) => {
  try { await fn(); return { label, refused: false }; } catch (e) { return { label, refused: true, error: String(e?.message ?? e).slice(0, 300) }; }
};

if (mode === "seed") {
  const have = await call("x_daily_price", "search_read", { domain: [["x_date", "=", TODAY], ["x_raw_reply", "=", MARK]], fields: ["id"] });
  if (have.length) out.existing = have.map((r) => r.id);
  else {
    out.created = await call("x_daily_price", "create", { vals_list: PRICES.map(([p, k, s, price, status]) => ({
      x_product_tmpl_id: p, x_packaging_id: k, x_supplier_id: s, x_price_sar: price, x_date: TODAY,
      x_extraction_status: status, x_is_simulation: true, x_raw_reply: MARK,
    })) });
  }
} else if (mode === "open") {
  const before = await dayOf();
  out.openAction = await run(A.openToday, 0);
  const d = await dayOf();
  out.day = d;
  out.createdByMenu = !before && !!d;
  out.refresh = await run(A.refresh, d.id);
  for (let i = 0; i < 20 && !(await linesOf(d.id)).length; i++) await sleep(1500);
  out.lines = await linesOf(d.id);
} else if (mode === "edit") {
  const d = await dayOf();
  const ls = await linesOf(d.id);
  const by = (p) => ls.find((l) => l.x_product_tmpl_id[0] === p);
  // 1. tomato: Baraa prefers Ahmad (the automation takes his price of the day), margin 20
  await call("x_price_day_line", "write", { ids: [by(71).id], vals: { x_supplier_id: AHMAD } });
  await call("x_price_day_line", "write", { ids: [by(71).id], vals: { x_margin_pct: 20 } });
  // 2. cucumber: its only price is an outlier — approved anyway, margin 15
  await call("x_price_day_line", "write", { ids: [by(72).id], vals: { x_outlier_ok: true, x_margin_pct: 15 } });
  // 3. potatoes: margin 12.5
  await call("x_price_day_line", "write", { ids: [by(73).id], vals: { x_margin_pct: 12.5 } });
  // 4. pomegranate: no margin (excluded)
  out.approveBeforeCucumber = null;
  out.lines = await linesOf(d.id);
} else if (mode === "approve") {
  const d = await dayOf();
  out.before = d;
  out.run = await run(A.approve, d.id);
  for (let i = 0; i < 30; i++) {
    const x = await dayOf();
    if (x.x_state === "published") break;
    await sleep(2000);
  }
  out.after = await dayOf();
  out.lines = await linesOf(d.id);
} else if (mode === "guards") {
  const d = await dayOf();
  const ls = await linesOf(d.id);
  out.lineEdit = await attempt("edit a published line", () => call("x_price_day_line", "write", { ids: [ls[0].id], vals: { x_margin_pct: 99 } }));
  out.unapprove = await attempt("«إلغاء الاعتماد» after publication", () => run(A.unapprove, d.id));
  out.secondDay = await attempt("a second record for today", () => call("x_price_day", "create", { vals_list: [{ x_date: TODAY, x_name: "مكرر", x_state: "draft" }] }));
  out.after = await dayOf();
  out.linesAfter = await linesOf(d.id);
  out.days = await call("x_price_day", "search_count", { domain: [["x_date", "=", TODAY]] });
} else {
  const d = await dayOf();
  out.day = d;
  out.lines = d ? await linesOf(d.id) : [];
}
writeFileSync(new URL(`./artifacts/s35-20260925-live-trial-${mode}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
