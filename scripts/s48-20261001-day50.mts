// § 48 د (2026-10-01) — the day of 2026-10-01 (#50) recomputed by the new rule.
//
// What was found (read-only, scripts/archive/s48-20261001-explore.mjs): Baraa saved «قرار براء» = «اعتمد
// بالسعر المربح» on the four lines at 12:51:05 Riyadh (one save of the form), and nothing computed
// the day after it — the board's last write was 11:57:25, § 47's own. A decision saved in Odoo is
// applied by the engine, and the engine runs by itself only 02:00–07:00 or on «🔄 إعادة الحساب».
// From § 48 the tick applies such a decision within five minutes (src/prices.ts applyOdooDecisions).
//
// Here the engine itself (src/prices.ts refreshPriceDay, the code of this tree) computes that one
// day, forced — what «🔄 إعادة الحساب» does:
//   · the fallback sale price of Ahmed's four real rows of the day (x_daily_price #69–#72) becomes
//     the suggested price of each purchase price (§ 48 ب): 31.50 / 24.00 / 19.50 / 31.50;
//   · each line carrying «اعتمد بالسعر المربح» is approved by hand at its suggested price (the fixed
//     minimum profit of § 48 أ), with its real profit; a line without an approved price gets its
//     preview.
// The day stays «فات الموعد»: its state is never written, nothing is approved or published, and
// nothing is sent — the exception messages and the publication are other functions, not called here.
//
// What may leave this process is checked before it leaves (a request outside this list throws):
//   reads; x_daily_price.write (the day's real rows of the plan: x_sale_price alone);
//   x_price_day_line.write (lines of the day: the engine's price fields, the board's, the preview,
//   «السعر المعدّل» / its mark / «وقت القرار» of a decided line — never «قرار براء»);
//   x_price_day.write (the day: the board's header only — never x_state).
//   Nothing but utakfresh.odoo.com is reachable: no WhatsApp. A dry run fakes every write.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s48-20261001-day50.mts            dry-run
//   … --apply      the rollback file first, then the engine
//   … --verify     read-only: the day against the expected numbers
//   … --rollback [--apply]   the lines, the header and the four fallback prices back
//
// Out: scripts/artifacts/s48-20261001-day50-{plan,rollback,verify}.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply"), VERIFY = process.argv.includes("--verify"), ROLLBACK = process.argv.includes("--rollback");
const root = new URL("../", import.meta.url);
const art = (name: string) => new URL(`scripts/artifacts/s48-20261001-day50-${name}.json`, root);
const dotenv = Object.fromEntries(readFileSync(new URL(".env.sim-verify", root), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const DAY = "2026-10-01", DAY_ID = 50, AHMED = 30;
/** The order's table: share 1.99, waste 5 %, minimum profit 2 riyals a carton. */
const EXPECTED: Array<{ name: string; product: number; packaging: number; purchase: number; full: number; even: number; suggested: number; profit: number }> = [
  { name: "رمان كبير", product: 108, packaging: 44, purchase: 22, full: 25.09, even: 28.85, suggested: 31.5, profit: 2.3 },
  { name: "رمان وسط", product: 100, packaging: 37, purchase: 16, full: 18.79, even: 21.61, suggested: 24, profit: 2.08 },
  { name: "رمان صغير", product: 107, packaging: 43, purchase: 12, full: 14.59, even: 16.78, suggested: 19.5, profit: 2.37 },
  { name: "موز أمريكي", product: 97, packaging: 33, purchase: 22, full: 25.09, even: 28.85, suggested: 31.5, profit: 2.3 },
];
const SIM_ROWS = [59, 60, 67, 68];

// ---------------------------------------------------------------- the gate on every request
const READS = new Set(["search_read", "read", "search", "search_count", "fields_get"]);
const LINE_ENGINE = new Set([
  "x_supplier_id", "x_daily_price_id", "x_default_price_id", "x_source_price", "x_cost_price", "x_is_outlier", "x_outlier_ok", "x_margin_pct", "x_market_price", "x_market_count",
  "x_unit_profit", "x_offers", "x_status", "x_reason", "x_sale_price", "x_excluded", "x_blocked",
  "x_net_purchase", "x_waste_cost", "x_op_share", "x_full_cost", "x_break_even", "x_suggested_price", "x_board_sale", "x_net_sale", "x_real_profit", "x_board_status",
  "x_preview_sale", "x_preview_profit", "x_manual_price", "x_manual_for", "x_decided_at",
]);
// § 48 و — and how many customers a publication would reach (the confirmation of «نشر المعتمد الآن» shows it)
const DAY_BOARD = /^x_(op_cost|op_expected|op_cartons|op_basis|op_share|op_share_500|n_green|n_yellow|n_red|n_none|board_note|board_at|n_recipients)$/;
let dayLineIds = new Set<number>();
let dayRowIds = new Set<number>();
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
    if (model === "x_daily_price" && method === "write") {
      ok = (b.ids as number[]).every((id) => dayRowIds.has(id)) && JSON.stringify(keys(b.vals)) === JSON.stringify(["x_sale_price"]) && typeof b.vals.x_sale_price === "number";
    } else if (model === "x_price_day_line" && method === "write") {
      ok = (b.ids as number[]).every((id) => dayLineIds.has(id)) && keys(b.vals).every((k) => LINE_ENGINE.has(k));
    } else if (model === "x_price_day" && method === "write") {
      ok = JSON.stringify(b.ids) === JSON.stringify([DAY_ID]) && keys(b.vals).every((k) => DAY_BOARD.test(k));
    }
    if (!ok) throw new Error(`BLOCKED: ${model}.${method} ${JSON.stringify(b.ids ?? "")} ${JSON.stringify(b.vals ?? b.vals_list ?? {}).slice(0, 200)}`);
    writes.push(`${model}.${method} ${JSON.stringify(b.ids)} ${JSON.stringify(b.vals)}`);
    // a dry run (and --verify, --rollback without --apply) never writes: the answer Odoo would give is faked
    if (!APPLY) return new Response(JSON.stringify(true), { status: 200, headers: { "Content-Type": "application/json" } });
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
const pause = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const money = (n: unknown) => (Number(n) || 0).toFixed(2);

const DAY_FIELDS = ["id", "x_date", "x_state", "x_name", "x_approved_at", "x_approved_by", "x_published_at", "x_publish_report", "x_utak_simulation", "x_op_cost", "x_op_expected", "x_op_cartons", "x_op_basis", "x_op_share", "x_op_share_500", "x_n_green", "x_n_yellow", "x_n_red", "x_n_none", "x_board_note", "x_board_at", "x_n_recipients", "x_n_publishable", "x_publish_names", "write_date"];
const LINE_FIELDS = ["id", "x_name", "x_sequence", "x_product_tmpl_id", "x_packaging_id", "x_decision", "x_utak_simulation", ...LINE_ENGINE, "x_market_show", "x_sale_show", "x_profit_show", "x_manual_show", "write_date"];
const DP_FIELDS = ["id", "x_supplier_id", "x_product_tmpl_id", "x_packaging_id", "x_date", "x_price_sar", "x_sale_price", "x_extraction_status", "x_utak_simulation", "x_source_message_id", "write_date"];
const readDay = async () => (await call<any[]>(env, "x_price_day", "read", { ids: [DAY_ID], fields: DAY_FIELDS }))[0];
const readLines = async () => call<any[]>(env, "x_price_day_line", "search_read", { domain: [["x_day_id", "=", DAY_ID]], fields: LINE_FIELDS, order: "x_sequence asc, id asc" });
const readDp = async () => call<any[]>(env, "x_daily_price", "search_read", { domain: [["x_date", "=", DAY]], fields: DP_FIELDS, order: "id asc", context: { active_test: false } });
const id0 = (v: unknown) => (Array.isArray(v) ? v[0] : 0);
const lineOf = (lines: any[], p: { product: number; packaging: number }) => lines.find((l) => id0(l.x_product_tmpl_id) === p.product && id0(l.x_packaging_id) === p.packaging && !l.x_utak_simulation);

const day = await readDay();
if (!day || day.x_date !== DAY || day.x_utak_simulation) throw new Error(`x_price_day #${DAY_ID} is not the real record of ${DAY} — stop`);
let lines = await readLines();
dayLineIds = new Set(lines.map((l) => l.id));
let dps = await readDp();
const real = () => dps.filter((r) => !r.x_utak_simulation);
dayRowIds = new Set(real().map((r) => r.id));
await pause();
const products = await call<any[]>(env, "product.template", "read", { ids: EXPECTED.map((p) => p.product), fields: ["id", "name", "x_is_active_for_sale", "sale_ok", "active", "write_date"], context: { active_test: false } });
const forSale = (pid: number) => { const p = products.find((x) => x.id === pid); return !!p && p.active && p.sale_ok && p.x_is_active_for_sale === true; };

// ---------------------------------------------------------------- verify
if (VERIFY) {
  let ok = 0, bad = 0;
  const check = (name: string, cond: unknown, detail = "") => { if (cond) { ok++; console.log(`  ✓ ${name}`); } else { bad++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
  const rb = existsSync(art("rollback")) ? JSON.parse(readFileSync(art("rollback"), "utf8")) : null;
  check(`السجل #${DAY_ID} (${DAY}) ما زال «فات الموعد»، بلا اعتماد ولا نشر`, day.x_state === "missed" && !day.x_approved_at && !day.x_approved_by && !day.x_published_at, JSON.stringify({ s: day.x_state, a: day.x_approved_at, p: day.x_published_at }));
  if (rb) check("…واسمه وتقرير نشره كما في اللقطة", day.x_name === rb.before.day.x_name && day.x_publish_report === rb.before.day.x_publish_report);
  const report: any[] = [];
  for (const e of EXPECTED) {
    const l = lineOf(lines, e);
    report.push({ name: e.name, line: l?.id, purchase: l?.x_cost_price, full: l?.x_full_cost, even: l?.x_break_even, suggested: l?.x_suggested_price, sale: l?.x_sale_price, status: l?.x_status, reason: l?.x_reason, decision: l?.x_decision, profit: l?.x_real_profit, board: l?.x_board_status, preview: [l?.x_preview_sale, l?.x_preview_profit], shows: [l?.x_market_show, l?.x_sale_show, l?.x_profit_show, l?.x_manual_show] });
    check(`${e.name} (#${l?.id}): الشراء ${money(l?.x_cost_price)} · التكلفة الكاملة ${money(l?.x_full_cost)} · بدون خسارة ${money(l?.x_break_even)} · المقترح ${money(l?.x_suggested_price)}`,
      !!l && l.x_cost_price === e.purchase && l.x_full_cost === e.full && l.x_break_even === e.even && l.x_suggested_price === e.suggested, `المتوقع ${e.purchase} / ${e.full} / ${e.even} / ${e.suggested}`);
    if (l?.x_decision === "profit" && forSale(e.product)) {
      check(`…قراره «اعتمد بالسعر المربح»: البيع ${money(l.x_sale_price)} = المقترح، «معتمد يدوياً»، والربح الحقيقي ${money(l.x_real_profit)} (🟢)، بلا معاينة`,
        l.x_status === "manual" && l.x_sale_price === e.suggested && l.x_excluded === false && l.x_reason === "براء: اعتمد بالسعر المربح" && l.x_board_sale === e.suggested && l.x_real_profit === e.profit && l.x_board_status === "green"
        && l.x_manual_price === e.suggested && l.x_manual_for === "profit" && !!l.x_decided_at && l.x_preview_sale === 0 && l.x_preview_profit === 0, JSON.stringify(l));
      check(`…وعرضه: السوق «${l.x_market_show}» · البيع «${l.x_sale_show}» · الربح «${l.x_profit_show}»`, l.x_market_show === "—" && l.x_sale_show === e.suggested.toFixed(2) && l.x_profit_show === e.profit.toFixed(2), JSON.stringify([l.x_market_show, l.x_sale_show, l.x_profit_show]));
    } else {
      check(`…بلا سعر معتمد (${l?.x_status}: ${l?.x_reason}): البيع «—»، ومعاينته ظاهرة «${l?.x_profit_show}»`,
        !!l && l.x_sale_price === 0 && l.x_excluded === true && l.x_preview_sale === e.suggested && l.x_preview_profit === e.profit && l.x_sale_show === "—" && l.x_profit_show === `معاينة ${e.profit.toFixed(2)}` && l.x_real_profit === 0 && l.x_board_status === "none", JSON.stringify(l));
    }
  }
  const realLines = lines.filter((l) => !l.x_utak_simulation);
  const greens = realLines.filter((l) => l.x_board_status === "green").length, nones = realLines.filter((l) => l.x_board_status === "none").length;
  check(`رأس اليوم: تكلفة 496.52، وحصة الكرتون 1.99 على 250، والأصناف 🟢 ${greens} · ⚪ ${nones}`, day.x_op_cost === 496.52 && day.x_op_share === 1.99 && day.x_op_expected === 250 && day.x_n_green === greens && day.x_n_none === nones && day.x_n_yellow === 0 && day.x_n_red === 0 && greens + nones === realLines.length, JSON.stringify({ c: day.x_op_cost, s: day.x_op_share, n: [day.x_n_green, day.x_n_yellow, day.x_n_red, day.x_n_none] }));
  // § 48 و — what the confirmation of «نشر المعتمد الآن» would say (nothing is published here)
  const { priceRecipients } = await import("../src/prices.ts");
  const recipients = await priceRecipients(env);
  check(`تأكيد «نشر المعتمد الآن» سيذكر: ${day.x_n_publishable} أصناف (${day.x_publish_names}) إلى ${day.x_n_recipients} عملاء`, day.x_n_publishable === realLines.filter((l) => (l.x_status === "auto" || l.x_status === "manual") && !l.x_excluded && l.x_sale_price > 0).length && day.x_n_recipients === recipients.length && recipients.length > 0, JSON.stringify({ p: day.x_n_publishable, r: day.x_n_recipients, list: recipients.map((r) => r.id) }));
  await pause();
  // the fallback of the day's real rows = the suggested price; the simulation rows as they were
  for (const e of EXPECTED) {
    const r = real().find((x) => id0(x.x_product_tmpl_id) === e.product && id0(x.x_packaging_id) === e.packaging);
    check(`السعر الاحتياطي لصف أحمد #${r?.id} (${e.name}، شراء ${e.purchase}): ${money(r?.x_sale_price)} = المقترح`, !!r && id0(r.x_supplier_id) === AHMED && r.x_price_sar === e.purchase && r.x_sale_price === e.suggested, JSON.stringify(r));
  }
  check(`الصفوف الحقيقية لليوم أربعة (${real().map((r) => `#${r.id}`).join(" ")})`, real().length === 4 && JSON.stringify(real().map((r) => r.id)) === JSON.stringify([69, 70, 71, 72]));
  const sims = dps.filter((r) => r.x_utak_simulation);
  check(`صفوف المحاكاة ${SIM_ROWS.map((i) => `#${i}`).join(" و")} ما زالت موسومة محاكاة`, JSON.stringify(sims.map((r) => r.id)) === JSON.stringify(SIM_ROWS), JSON.stringify(sims.map((r) => r.id)));
  if (rb) check("…ولم تُكتب في هذه المهمة (write_date وسعرها كما في اللقطة)", sims.every((r) => { const b = rb.before.dailyPrices.find((x: any) => x.id === r.id); return b && b.write_date === r.write_date && b.x_sale_price === r.x_sale_price; }), JSON.stringify(sims.map((r) => [r.id, r.write_date])));
  check("…ومستبعدة من المحرك واللوحة: كل سطر مصدره صف حقيقي، وعروضه لأحمد وحده بسعره الحقيقي", realLines.every((l) => !SIM_ROWS.includes(id0(l.x_daily_price_id)) && (!l.x_offers || /^أحمد حسان: شراء \d+$/.test(String(l.x_offers)))), JSON.stringify(realLines.map((l) => [l.id, id0(l.x_daily_price_id), l.x_offers])));
  await pause();
  // the fallback a quotation would take today, by the worker's own lookup (reads only)
  const OD = await import("../src/odoo.ts");
  for (const e of EXPECTED) {
    const got = await OD.getLatestSalePrice(env, e.product, e.packaging, DAY);
    check(`سعر عرض السعر اليوم لـ ${e.name}: ${money(got.price)} (${got.source}) = المقترح`, got.price === e.suggested && got.source === "today", JSON.stringify(got));
    await pause(500);
  }
  if (rb?.appliedAt) {
    await pause();
    const since = rb.appliedAt.replace("T", " ").slice(0, 19);
    const sent = await call<any[]>(env, "x_wa_message", "search_read", { domain: [["create_date", ">=", since]], fields: ["id", "x_name", "create_date"], order: "id asc", limit: 200 }).catch(() => null);
    const about = (sent ?? []).filter((r) => /استثناء في أسعار اليوم|أسعار يو تاك اليوم|نُشرت أسعار/.test(String(r.x_name ?? "")));
    check(`لا رسالة أسعار أو استثناء أو نشر في سجل واتساب منذ التطبيق (${since} UTC)`, sent !== null && about.length === 0, JSON.stringify(about));
    console.log(`  · (للعلم) صفوف x_wa_message منذ التطبيق: ${sent?.length ?? "تعذّر"}`);
  }
  writeFileSync(art("verify"), JSON.stringify({ at: new Date().toISOString(), ok, bad, day: { id: day.id, state: day.x_state, cost: day.x_op_cost, share: day.x_op_share, counts: [day.x_n_green, day.x_n_yellow, day.x_n_red, day.x_n_none], at: day.x_board_at }, products: products.map((p) => ({ id: p.id, name: p.name, forSale: p.x_is_active_for_sale, write_date: p.write_date })), lines: report, dailyPrices: dps.map((r) => ({ id: r.id, product: r.x_product_tmpl_id, price: r.x_price_sar, sale: r.x_sale_price, sim: r.x_utak_simulation })) }, null, 2) + "\n");
  console.log(`verify: ${ok}/${ok + bad}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  if (!existsSync(art("rollback"))) throw new Error("no rollback file — nothing was applied");
  const rb = JSON.parse(readFileSync(art("rollback"), "utf8"));
  for (const b of rb.before.lines) console.log(`line #${b.id} ${b.x_name}: its price, board and decision-price fields back («قرار براء» is Baraa's: untouched)`);
  for (const b of rb.before.dailyPrices.filter((x: any) => !x.x_utak_simulation)) console.log(`x_daily_price #${b.id}: x_sale_price back to ${b.x_sale_price}`);
  console.log(`day #${DAY_ID}: the board header back`);
  for (const b of rb.before.lines) await call(env, "x_price_day_line", "write", { ids: [b.id], vals: Object.fromEntries([...LINE_ENGINE].map((k) => [k, Array.isArray(b[k]) ? b[k][0] : b[k]])) });
  for (const b of rb.before.dailyPrices.filter((x: any) => !x.x_utak_simulation)) await call(env, "x_daily_price", "write", { ids: [b.id], vals: { x_sale_price: Number(b.x_sale_price) || 0 } });
  await call(env, "x_price_day", "write", { ids: [DAY_ID], vals: Object.fromEntries(Object.entries(rb.before.day).filter(([k]) => DAY_BOARD.test(k))) });
  console.log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- plan
if (day.x_state !== "missed") throw new Error(`#${DAY_ID} is «${day.x_state}», not «فات الموعد» — stop (Baraa approved or published meanwhile?)`);
console.log(`📅 السجل #${DAY_ID} «${day.x_name}» — ${day.x_state} · الأسطر ${lines.length} · آخر حساب للوحة ${day.x_board_at} UTC · آخر كتابة ${day.write_date} UTC`);
for (const p of products) console.log(`الصنف #${p.id} ${p.name}: «نشط للبيع» ${p.x_is_active_for_sale} · آخر كتابة على بطاقته ${p.write_date} UTC`);
for (const l of lines) console.log(`السطر #${l.id} ${l.x_name}: الشراء ${l.x_cost_price} · المقترح ${l.x_suggested_price} · البيع ${l.x_sale_price} · ${l.x_status} «${l.x_reason}» · قرار براء ${l.x_decision || "—"} (وقت القرار ${l.x_decided_at || "—"}) · السعر المعدّل ${l.x_manual_price} · آخر كتابة ${l.write_date} UTC`);
for (const r of dps) console.log(`x_daily_price #${r.id}: ${r.x_product_tmpl_id?.[1]} ${r.x_price_sar} · احتياطي ${r.x_sale_price} · ${r.x_utak_simulation ? "محاكاة (مستبعد)" : "حقيقي"}`);
// § 47's rule fixed 30.50 / 23.00 / 18.00 only if «🔄» ran on the old code after 12:51: then «السعر المعدّل» holds the old number
// (a price this script's own run fixed carries its mark «profit» and is the expected suggested price: a re-run is a no-op on it)
const stale = lines.filter((l) => l.x_decision === "profit" && Number(l.x_manual_price) > 0 && !(l.x_manual_for === "profit" && EXPECTED.some((e) => e.product === id0(l.x_product_tmpl_id) && e.suggested === l.x_manual_price)));
if (stale.length) throw new Error(`a profit line already carries a fixed price (${stale.map((l) => `#${l.id} ${l.x_manual_price}`).join(", ")}): «🔄 إعادة الحساب» ran on the old rule meanwhile — stop and decide`);
writeFileSync(art("plan"), JSON.stringify({ at: new Date().toISOString(), day, lines, dailyPrices: dps, products }, null, 2) + "\n");

// ---------------------------------------------------------------- apply (or the dry run of the same engine)
const rbPath = art("rollback");
const rb = existsSync(rbPath) ? JSON.parse(readFileSync(rbPath, "utf8")) : { script: "scripts/s48-20261001-day50.mts", createdAt: new Date().toISOString(), before: { day, lines, dailyPrices: dps, products } };
const save = () => { if (APPLY) writeFileSync(rbPath, JSON.stringify(rb, null, 2) + "\n"); };
save(); // the rollback file before the first write
const r = await PR.refreshPriceDay(env, { day: DAY, force: true });
console.log(`المحرك على ${DAY}: ${JSON.stringify(r)}`);
if (r.dayId !== DAY_ID) throw new Error(`the engine worked on #${r.dayId}, not #${DAY_ID}`);
if (APPLY) { rb.appliedAt ??= new Date().toISOString(); rb.engine = r; rb.writes = writes; save(); }
console.log(`${APPLY ? "كتابات هذه العملية" : "ما كان سيُكتب (لم يُكتب شيء)"} (${writes.length}):\n${writes.map((w) => "  " + w).join("\n")}`);
console.log(APPLY ? "applied — now: --verify" : "\ndry-run: nothing written (add --apply)");
