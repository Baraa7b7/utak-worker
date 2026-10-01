// § 47 ج (2026-10-01) — the purchase prices of 2026-10-01 on the day's record (#50), for the board.
//
// Baraa's four prices, net of VAT, entered where Ahmed's offers are recorded when he answers the
// 02:00 ask (x_daily_price, supplier أحمد حسان — the row the worker's createDailyPrice writes, its
// x_sale_price by the same settings formula):
//     رمان كبير 22 · رمان وسط 16 · رمان صغير 12 · موز أمريكي 22
// «موز أمريكي» EXISTS on the tenant (#97, UTAK-FRT-002, «نشط للبيع» off, no English name): it is NOT
// created again — no product is created here, so no «🆕 صنف جديد» alert can come of it (its flag
// x_utak_new is off and stays off; --verify checks it). Not being for sale, the engine gives it no
// line: its line on the day is created here, with its purchase price.
// Then the engine itself (src/prices.ts refreshPriceDay, the code of this tree) computes the day's
// lines and the board — on that one day, forced. It sends nothing and never changes a day's state;
// the exception messages and the publication are other functions, not called here.
//
// What may leave this process is checked before it leaves (a request outside this list throws):
//   reads; x_daily_price.create (the four rows of the plan); x_price_day_line.create (a line of the
//   day); x_price_day_line.write (lines of the day: the engine's price fields and the board's,
//   never «قرار براء» / «السعر المعدّل»); x_price_day.write (the day: the board's header only —
//   never x_state). Nothing but utakfresh.odoo.com is reachable: no WhatsApp.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s47-20261001-day50.mts            dry-run
//   … --apply      the rollback file first, then the rows, the line, the engine
//   … --verify     read-only: the day against the expected table
//   … --rollback [--apply]   the three lines and the header back; what was created is marked
//                            x_utak_simulation (counted nowhere) — never deleted
//
// Out: scripts/artifacts/s47-20261001-day50-{plan,rollback,verify}.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply"), VERIFY = process.argv.includes("--verify"), ROLLBACK = process.argv.includes("--rollback");
const root = new URL("../", import.meta.url);
const art = (name: string) => new URL(`scripts/artifacts/s47-20261001-day50-${name}.json`, root);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const DAY = "2026-10-01", DAY_ID = 50, AHMED = 30;
const TAG = "manual:s47-20261001";
/** [product.template, x_product_packaging, the net purchase price] */
const PRICES: Array<{ name: string; product: number; packaging: number; price: number; newLine?: boolean }> = [
  { name: "رمان كبير", product: 108, packaging: 44, price: 22 },
  { name: "رمان وسط", product: 100, packaging: 37, price: 16 },
  { name: "رمان صغير", product: 107, packaging: 43, price: 12 },
  { name: "موز أمريكي", product: 97, packaging: 33, price: 22, newLine: true },
];
/** The order's table (share 1.99, waste 5 %, margin 5 %). */
const EXPECTED: Record<string, { purchase: number; waste: number; full: number; even: number; suggested: number }> = {
  "رمان كبير": { purchase: 22, waste: 1.1, full: 25.09, even: 28.85, suggested: 30.5 },
  "رمان وسط": { purchase: 16, waste: 0.8, full: 18.79, even: 21.61, suggested: 23 },
  "رمان صغير": { purchase: 12, waste: 0.6, full: 14.59, even: 16.78, suggested: 18 },
  "موز أمريكي": { purchase: 22, waste: 1.1, full: 25.09, even: 28.85, suggested: 30.5 },
};
const RAW = `إدخال يدوي (§ 47، ${DAY}) — أسعار شراء أحمد، خام بدون ضريبة: ${PRICES.map((p) => `${p.name} ${p.price}`).join("، ")}`;

// ---------------------------------------------------------------- the gate on every request
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const LINE_ENGINE = new Set([
  "x_supplier_id", "x_daily_price_id", "x_default_price_id", "x_source_price", "x_cost_price", "x_is_outlier", "x_outlier_ok", "x_margin_pct", "x_market_price", "x_market_count",
  "x_unit_profit", "x_offers", "x_status", "x_reason", "x_sale_price", "x_excluded", "x_blocked",
  "x_net_purchase", "x_waste_cost", "x_op_share", "x_full_cost", "x_break_even", "x_suggested_price", "x_board_sale", "x_net_sale", "x_real_profit", "x_board_status",
]);
const LINE_CREATE = new Set([...LINE_ENGINE, "x_day_id", "x_name", "x_sequence", "x_product_tmpl_id", "x_packaging_id"]);
const DAY_BOARD = /^x_(op_cost|op_expected|op_cartons|op_basis|op_share|op_share_500|n_green|n_yellow|n_red|n_none|board_note|board_at)$/;
const ROLLBACK_LINE = new Set([...LINE_ENGINE, "x_utak_simulation"]);
let dayLineIds = new Set<number>();
let createdDp = 0;
const writes: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /^https:\/\/utakfresh\.odoo\.com\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) throw new Error(`BLOCKED (not Odoo): ${url.slice(0, 60)}`);
  if (!READS.has(m[2])) {
    const b = JSON.parse(init?.body ?? "{}");
    const [model, method] = [m[1], m[2]];
    const keys = (v: Record<string, unknown>) => Object.keys(v ?? {});
    let ok = false;
    if ((APPLY && !ROLLBACK) && model === "x_daily_price" && method === "create") {
      const list = (b.vals_list ?? []) as Array<Record<string, unknown>>;
      ok = list.length === 1 && createdDp < PRICES.length && list[0].x_date === DAY && list[0].x_supplier_id === AHMED && list[0].x_source_message_id === TAG
        && PRICES.some((p) => p.product === list[0].x_product_tmpl_id && p.packaging === list[0].x_packaging_id && p.price === list[0].x_price_sar);
      if (ok) createdDp++;
    } else if (APPLY && !ROLLBACK && model === "x_price_day_line" && method === "create") {
      ok = ((b.vals_list ?? []) as Array<Record<string, unknown>>).every((v) => v.x_day_id === DAY_ID && keys(v).every((k) => LINE_CREATE.has(k)));
    } else if (APPLY && model === "x_price_day_line" && method === "write") {
      ok = (b.ids as number[]).every((id) => dayLineIds.has(id)) && keys(b.vals).every((k) => (ROLLBACK ? ROLLBACK_LINE : LINE_ENGINE).has(k));
    } else if (APPLY && model === "x_price_day" && method === "write") {
      ok = JSON.stringify(b.ids) === JSON.stringify([DAY_ID]) && keys(b.vals).every((k) => DAY_BOARD.test(k));
    } else if (APPLY && ROLLBACK && model === "x_daily_price" && method === "write") {
      ok = JSON.stringify(keys(b.vals)) === JSON.stringify(["x_utak_simulation"]) && b.vals.x_utak_simulation === true;
    }
    if (!ok) throw new Error(`BLOCKED: ${model}.${method} ${JSON.stringify(b.ids ?? "")} ${JSON.stringify(b.vals ?? b.vals_list ?? {}).slice(0, 200)}`);
    writes.push(`${model}.${method}${b.ids ? ` ${JSON.stringify(b.ids)}` : ""} ${keys(b.vals ?? (b.vals_list ?? [{}])[0]).join(",")}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

const kv = new Map<string, string>();
const env: any = {
  ODOO_URL: "https://utakfresh.odoo.com", ODOO_DB: "utakfresh", ODOO_LOGIN: "admin@utakfresh.com", ODOO_API_KEY: dotenv.ODOO_API_KEY,
  OWNER_WHATSAPP: "+966505154962", SIMULATION_MODE: "false", ACCOUNTING_SYNC: "false",
  MSG_DEDUP: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
};
const { call } = await import("../src/odoo.ts");
const PR = await import("../src/prices.ts");
const PB = await import("../src/pricing-board.ts");
const { DEFAULT_OPS_MARGIN_PCT, DEFAULT_PROFIT_MARGIN_PCT } = await import("../src/config.ts");
const pause = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: unknown) => (Number(n) || 0).toFixed(2);

const DAY_FIELDS = ["id", "x_date", "x_state", "x_name", "x_approved_at", "x_approved_by", "x_published_at", "x_publish_report", "x_utak_simulation", "x_op_cost", "x_op_expected", "x_op_cartons", "x_op_basis", "x_op_share", "x_op_share_500", "x_n_green", "x_n_yellow", "x_n_red", "x_n_none", "x_board_note", "x_board_at", "write_date"];
const LINE_FIELDS = ["id", "x_name", "x_sequence", "x_product_tmpl_id", "x_packaging_id", "x_decision", "x_manual_price", "x_decided_at", "x_utak_simulation", ...LINE_ENGINE, "write_date"];
const readDay = async () => (await call<any[]>(env, "x_price_day", "read", { ids: [DAY_ID], fields: DAY_FIELDS }))[0];
const readLines = async () => call<any[]>(env, "x_price_day_line", "search_read", { domain: [["x_day_id", "=", DAY_ID]], fields: LINE_FIELDS, order: "x_sequence asc, id asc" });
const readDp = async () => call<any[]>(env, "x_daily_price", "search_read", { domain: [["x_date", "=", DAY], ["x_supplier_id", "=", AHMED]], fields: ["id", "x_name", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_date", "x_price_sar", "x_sale_price", "x_source_message_id", "x_raw_reply", "x_extraction_status", "x_utak_simulation", "create_date"], order: "id asc" });
const id0 = (v: unknown) => (Array.isArray(v) ? v[0] : 0);
const lineOf = (lines: any[], p: { product: number; packaging: number }) => lines.find((l) => id0(l.x_product_tmpl_id) === p.product && id0(l.x_packaging_id) === p.packaging && !l.x_utak_simulation);

const day = await readDay();
if (!day || day.x_date !== DAY || day.x_utak_simulation) throw new Error(`x_price_day #${DAY_ID} is not the real record of ${DAY} — stop`);
let lines = await readLines();
dayLineIds = new Set(lines.map((l) => l.id));
let dps = await readDp();
const mine = () => dps.filter((r) => r.x_source_message_id === TAG && !r.x_utak_simulation);

// ---------------------------------------------------------------- verify
if (VERIFY) {
  let ok = 0, bad = 0;
  const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; console.log(`  ✓ ${name}`); } else { bad++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
  const rb = existsSync(art("rollback")) ? JSON.parse(readFileSync(art("rollback"), "utf8")) : null;
  check(`السجل #${DAY_ID} (${DAY}) ما زال «فات الموعد»، بلا اعتماد ولا نشر`, day.x_state === "missed" && !day.x_approved_at && !day.x_approved_by && !day.x_published_at, JSON.stringify({ s: day.x_state, a: day.x_approved_at, p: day.x_published_at }));
  if (rb) check("…وحالته واسمه وتقرير نشره كما في اللقطة", day.x_state === rb.before.day.x_state && day.x_name === rb.before.day.x_name && day.x_publish_report === rb.before.day.x_publish_report);
  check("عروض الشراء الأربعة في x_daily_price (المورد أحمد حسان، 10-01، مستخرجة)", mine().length === 4 && PRICES.every((p) => mine().filter((r) => id0(r.x_product_tmpl_id) === p.product && id0(r.x_packaging_id) === p.packaging && r.x_price_sar === p.price && r.x_extraction_status === "extracted").length === 1), JSON.stringify(mine().map((r) => [r.id, r.x_price_sar])));
  check("…ولا عرض آخر لأحمد لهذا اليوم (لا تكرار)", dps.filter((r) => !r.x_utak_simulation).length === 4, String(dps.length));
  const report: any[] = [];
  for (const p of PRICES) {
    const l = lineOf(lines, p), e = EXPECTED[p.name];
    report.push({ name: p.name, line: l?.id, purchase: l?.x_cost_price, net: l?.x_net_purchase, waste: l?.x_waste_cost, share: l?.x_op_share, full: l?.x_full_cost, even: l?.x_break_even, suggested: l?.x_suggested_price, status: l?.x_board_status, price: l?.x_status, reason: l?.x_reason });
    check(`${p.name} (#${l?.id}): الشراء ${money(l?.x_cost_price)} · التالف ${money(l?.x_waste_cost)} · التكلفة الكاملة ${money(l?.x_full_cost)} · أقل سعر بدون خسارة ${money(l?.x_break_even)} · المقترح ${money(l?.x_suggested_price)}`,
      !!l && l.x_cost_price === e.purchase && l.x_net_purchase === e.purchase && l.x_waste_cost === e.waste && l.x_full_cost === e.full && l.x_break_even === e.even && l.x_suggested_price === e.suggested,
      `المتوقع ${e.purchase} / ${e.waste} / ${e.full} / ${e.even} / ${e.suggested}`);
    check(`…بلا سعر سوق: ⚪، والربح 0، وبلا بيع ولا قرار (${l?.x_status}: ${l?.x_reason})`, !!l && l.x_board_status === "none" && l.x_real_profit === 0 && l.x_market_price === 0 && l.x_sale_price === 0 && l.x_excluded === true && !l.x_decision && !(l.x_manual_price > 0) && id0(l.x_supplier_id) === AHMED, JSON.stringify(l));
  }
  check("رأس اليوم: تكلفة 496.52، وحصة الكرتون 1.99 على 250، والأصناف ⚪ 4", day.x_op_cost === 496.52 && day.x_op_share === 1.99 && day.x_op_expected === 250 && day.x_n_none === lines.filter((l) => !l.x_utak_simulation).length && day.x_n_green === 0 && day.x_n_yellow === 0 && day.x_n_red === 0, JSON.stringify({ c: day.x_op_cost, s: day.x_op_share, n: [day.x_n_green, day.x_n_yellow, day.x_n_red, day.x_n_none] }));
  await pause();
  const bananas = await call<any[]>(env, "product.template", "search_read", { domain: [["name", "ilike", "موز أمريكي"]], fields: ["id", "name", "default_code", "categ_id", "x_is_active_for_sale", "x_name_en", "x_utak_new", "active", "write_date"], context: { active_test: false } });
  check("«موز أمريكي»: صنف واحد (#97، UTAK-FRT-002)، لم يُنشأ مكرر", bananas.length === 1 && bananas[0].id === 97 && bananas[0].default_code === "UTAK-FRT-002", JSON.stringify(bananas));
  check("…«نشط للبيع» مطفأ، والاسم الإنجليزي فارغ، وعلامة «صنف جديد» مطفأة (لا تنبيه)", bananas[0]?.x_is_active_for_sale === false && !bananas[0]?.x_name_en && bananas[0]?.x_utak_new !== true, JSON.stringify(bananas[0]));
  if (rb) check("…وبطاقته لم تُكتب في هذه المهمة (write_date كما في اللقطة)", bananas[0]?.write_date === rb.before.banana?.write_date, `${bananas[0]?.write_date} / ${rb.before.banana?.write_date}`);
  const flagged = await call<any[]>(env, "product.template", "search_read", { domain: [["x_utak_new", "=", true]], fields: ["id", "name"], context: { active_test: false } });
  check("لا صنف معلَّم «صنف جديد» ينتظر تنبيهاً", flagged.length === 0, JSON.stringify(flagged));
  if (rb?.appliedAt) {
    await pause();
    const since = rb.appliedAt.replace("T", " ").slice(0, 19);
    const sent = await call<any[]>(env, "x_wa_message", "search_read", { domain: [["create_date", ">=", since]], fields: ["id", "x_name", "create_date"], order: "id asc", limit: 200 }).catch(() => null);
    const about = (sent ?? []).filter((r) => /استثناء في أسعار اليوم|أسعار يو تاك اليوم|نُشرت أسعار|صنف جديد/.test(String(r.x_name ?? "")));
    check(`لا رسالة أسعار أو استثناء أو «صنف جديد» في سجل واتساب منذ التطبيق (${since} UTC)`, sent !== null && about.length === 0, JSON.stringify(about));
    console.log(`  · (للعلم) صفوف x_wa_message منذ التطبيق: ${sent?.length ?? "تعذّر"}`);
  }
  writeFileSync(art("verify"), JSON.stringify({ at: new Date().toISOString(), ok, bad, day: { id: day.id, state: day.x_state, cost: day.x_op_cost, share: day.x_op_share, counts: [day.x_n_green, day.x_n_yellow, day.x_n_red, day.x_n_none], at: day.x_board_at }, lines: report, dailyPrices: mine().map((r) => ({ id: r.id, product: r.x_product_tmpl_id, price: r.x_price_sar, sale: r.x_sale_price })) }, null, 2) + "\n");
  console.log(`verify: ${ok}/${ok + bad}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  if (!existsSync(art("rollback"))) throw new Error("no rollback file — nothing was applied");
  const rb = JSON.parse(readFileSync(art("rollback"), "utf8"));
  for (const b of rb.before.lines) console.log(`line #${b.id} ${b.x_name}: its price and board fields back`);
  console.log(`day #${DAY_ID}: the board header back`);
  console.log(`created (kept, marked x_utak_simulation — never deleted): x_daily_price ${JSON.stringify(rb.created.dailyPrices)} · x_price_day_line ${JSON.stringify(rb.created.lines)}`);
  if (APPLY) {
    for (const b of rb.before.lines) {
      const vals = Object.fromEntries([...LINE_ENGINE].map((k) => [k, Array.isArray(b[k]) ? b[k][0] : b[k]]));
      await call(env, "x_price_day_line", "write", { ids: [b.id], vals });
    }
    await call(env, "x_price_day", "write", { ids: [DAY_ID], vals: Object.fromEntries(Object.entries(rb.before.day).filter(([k]) => DAY_BOARD.test(k))) });
    if (rb.created.lines.length) await call(env, "x_price_day_line", "write", { ids: rb.created.lines, vals: { x_utak_simulation: true } });
    if (rb.created.dailyPrices.length) await call(env, "x_daily_price", "write", { ids: rb.created.dailyPrices, vals: { x_utak_simulation: true } });
  }
  console.log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- plan
if (day.x_state !== "missed") throw new Error(`#${DAY_ID} is «${day.x_state}», not «فات الموعد» — stop (Baraa decided meanwhile?)`);
await pause();
const [cfg] = await call<any[]>(env, "x_pricing_config", "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", DAY], "|", ["x_active_to", "=", false], ["x_active_to", ">=", DAY]], fields: ["id", "x_operations_margin_percent", "x_profit_margin_percent", "x_waste_pct", "x_min_margin_pct", "x_expected_cartons"], order: "x_active_from desc, id desc", limit: 1 });
const mul = (1 + (cfg?.x_operations_margin_percent ?? DEFAULT_OPS_MARGIN_PCT) / 100) * (1 + (cfg?.x_profit_margin_percent ?? DEFAULT_PROFIT_MARGIN_PCT) / 100);
const products = await call<any[]>(env, "product.template", "read", { ids: PRICES.map((p) => p.product), fields: ["id", "name", "default_code", "categ_id", "active", "sale_ok", "x_is_active_for_sale", "x_name_en", "x_utak_new", "x_supplier_ids", "write_date"], context: { active_test: false } });
const packs = await call<any[]>(env, "x_product_packaging", "read", { ids: PRICES.map((p) => p.packaging), fields: ["id", "x_name", "x_product_tmpl_id"] });
const [template] = await call<any[]>(env, "x_daily_price", "search_read", { domain: [["x_supplier_id", "=", AHMED], ["x_utak_simulation", "!=", true], ["x_date", "<", DAY]], fields: ["id", "x_name", "x_date", "x_price_sar", "x_sale_price", "x_extraction_status", "x_source_message_id"], order: "id desc", limit: 1 });
console.log(`📅 السجل #${DAY_ID} «${day.x_name}» — ${day.x_state} · الأسطر ${lines.length} · عروض أحمد الحقيقية لليوم ${dps.filter((r) => !r.x_utak_simulation).length} (ومعها ${dps.filter((r) => r.x_utak_simulation).length} صفوف محاكاة § 41، مستبعدة)`);
console.log(`الإعدادات #${cfg?.id}: التالف ${cfg?.x_waste_pct}٪ · الهامش الأدنى ${cfg?.x_min_margin_pct}٪ · الكراتين المتوقعة ${cfg?.x_expected_cartons} · السعر الاحتياطي للسطر = الشراء × ${round2(mul)} (كما يكتبه الوركر)`);
console.log(`آخر عرض حقيقي لأحمد (النموذج): #${template?.id} ${template?.x_date} ${template?.x_price_sar} (sale ${template?.x_sale_price}, ${template?.x_extraction_status})`);
const plan: any[] = [];
for (const p of PRICES) {
  const prod = products.find((x) => x.id === p.product), pack = packs.find((x) => x.id === p.packaging);
  if (!prod || !pack || id0(pack.x_product_tmpl_id) !== p.product || !String(prod.name).includes(p.name)) throw new Error(`${p.name}: product #${p.product} / packaging #${p.packaging} do not match the tenant — stop`);
  const have = mine().find((r) => id0(r.x_product_tmpl_id) === p.product && id0(r.x_packaging_id) === p.packaging);
  const other = dps.find((r) => !r.x_utak_simulation && r.x_source_message_id !== TAG && id0(r.x_product_tmpl_id) === p.product);
  if (other) throw new Error(`${p.name}: Ahmed already has a price for ${DAY} (#${other.id} ${other.x_price_sar}) — stop`);
  const line = lineOf(lines, p);
  const last = (await call<any[]>(env, "x_daily_price", "search_read", { domain: [["x_supplier_id", "=", AHMED], ["x_product_tmpl_id", "=", p.product], ["x_packaging_id", "=", p.packaging], ["x_utak_simulation", "!=", true], ["x_date", "<", DAY]], fields: ["x_price_sar", "x_date"], order: "x_date desc, id desc", limit: 1 }))[0];
  plan.push({ ...p, productName: prod.name, packagingName: pack.x_name, forSale: prod.x_is_active_for_sale, sale: round2(p.price * mul), dailyPrice: have?.id ?? null, line: line?.id ?? null, last: last ? `${last.x_price_sar} (${last.x_date})` : "—", ratio: last ? round2(Math.max(last.x_price_sar, p.price) / Math.min(last.x_price_sar, p.price)) : null });
  console.log(`${have ? "=" : "+"} x_daily_price ${p.name} (${pack.x_name}) ${p.price} خام · احتياطي البيع ${money(p.price * mul)} · آخر سعر لأحمد ${last ? `${last.x_price_sar} (${last.x_date})` : "—"}${have ? ` #${have.id}` : ""}`);
  console.log(`${line ? "=" : p.newLine ? "+" : "✗"} السطر على #${DAY_ID}: ${line ? `#${line.id} ${line.x_name} (${line.x_status}: ${line.x_reason})` : p.newLine ? `${String(prod.name).replace(/^\[[^\]]*\]\s*/, "")} — ${pack.x_name} (الصنف غير نشط للبيع، فالمحرك لا ينشئ سطره)` : "لا سطر — المحرك ينشئه"}`);
  await pause(600);
}
const banana = products.find((x) => x.id === 97);
console.log(`«موز أمريكي» موجود: #${banana.id} [${banana.default_code}] · نشط للبيع ${banana.x_is_active_for_sale} · الاسم الإنجليزي «${banana.x_name_en || ""}» · علامة «صنف جديد» ${banana.x_utak_new} · الفئة ${JSON.stringify(banana.categ_id)} → لا إنشاء، ولا كتابة على بطاقته`);
writeFileSync(art("plan"), JSON.stringify({ at: new Date().toISOString(), day: { id: day.id, state: day.x_state }, multiplier: round2(mul), plan, banana }, null, 2) + "\n");
if (!APPLY) {
  // what the board would show, by the same code (no write)
  const share = PB.boardShare(Number(day.x_op_cost) || null, cfg?.x_expected_cartons ?? null, { days: 0, average: null }).share;
  for (const p of PRICES) {
    const b = PB.boardLine({ purchase: p.price, sale: 0, wastePct: cfg?.x_waste_pct ?? 0, vatRatePct: 15, opShare: share, minMarginPct: cfg?.x_min_margin_pct ?? 5 });
    console.log(`  ⚪ ${p.name}: الشراء ${money(b.x_net_purchase)} · التالف ${money(b.x_waste_cost)} · التكلفة الكاملة ${money(b.x_full_cost)} · أقل سعر بدون خسارة ${money(b.x_break_even)} · المقترح ${money(b.x_suggested_price)} (بحصة اليوم المكتوبة ${money(share)})`);
  }
  console.log("\ndry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- apply
const rbPath = art("rollback");
const rb = existsSync(rbPath) ? JSON.parse(readFileSync(rbPath, "utf8")) : { script: "scripts/s47-20261001-day50.mts", createdAt: new Date().toISOString(), appliedAt: new Date().toISOString(), before: { day, lines, banana }, created: { dailyPrices: [] as number[], lines: [] as number[] } };
const save = () => writeFileSync(rbPath, JSON.stringify(rb, null, 2) + "\n");
save(); // the rollback file before the first write
for (const p of plan) {
  if (!p.dailyPrice) {
    // as src/odoo.ts createDailyPrice writes a supplier's price (the Riyadh day, the settings' sale formula)
    const [id] = await call<number[]>(env, "x_daily_price", "create", { vals_list: [{
      x_supplier_id: AHMED, x_product_tmpl_id: p.product, x_packaging_id: p.packaging, x_date: DAY, x_price_sar: p.price, x_sale_price: p.sale,
      x_source_message_id: TAG, x_raw_reply: RAW, x_extraction_status: "extracted",
    }] });
    p.dailyPrice = id; rb.created.dailyPrices.push(id); save();
    console.log(`  → x_daily_price #${id} ${p.name} ${p.price}`);
    await pause(700);
  }
  if (!p.line && p.newLine) {
    const seq = lines.reduce((m, l) => Math.max(m, Number(l.x_sequence) || 0), 0) + 1;
    const [id] = await call<number[]>(env, "x_price_day_line", "create", { vals_list: [{
      x_day_id: DAY_ID, x_name: `${String(p.productName).replace(/^\[[^\]]*\]\s*/, "")} — ${p.packagingName}`, x_sequence: seq, x_product_tmpl_id: p.product, x_packaging_id: p.packaging,
      x_supplier_id: AHMED, x_daily_price_id: p.dailyPrice, x_default_price_id: p.dailyPrice, x_source_price: p.price, x_cost_price: p.price, x_offers: `أحمد حسان: شراء ${p.price}`,
      x_market_price: 0, x_market_count: 0, x_sale_price: 0, x_excluded: true, x_blocked: false, x_status: "unpublished", x_reason: "ليس في الكتالوج النشط اليوم",
    }] });
    p.line = id; rb.created.lines.push(id); save();
    console.log(`  → x_price_day_line #${id} ${p.name} على #${DAY_ID}`);
    await pause(700);
  }
}
lines = await readLines();
dayLineIds = new Set(lines.map((l) => l.id));
// the engine itself, on that one day (forced): the lines' prices and the board. Nothing is sent, the state is not written.
const r = await PR.refreshPriceDay(env, { day: DAY, force: true });
console.log(`المحرك على ${DAY}: ${JSON.stringify(r)}`);
if (r.dayId !== DAY_ID) throw new Error(`the engine worked on #${r.dayId}, not #${DAY_ID}`);
rb.appliedAt ??= new Date().toISOString(); rb.engine = r; rb.writes = writes; save();
console.log(`كتابات هذه العملية (${writes.length}):\n${writes.map((w) => "  " + w).join("\n")}`);
console.log("applied — now: --verify");
