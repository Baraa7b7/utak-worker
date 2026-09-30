// § 41 و (2026-09-26) — the full-day simulation: 2026-09-27 (before VAT) and
// 2026-10-01 (after it), each with its fulfilment, on the worker's own code.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s41-full-day-sim.mts --odoo=fake
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s41-full-day-sim.mts --odoo=live --run=<id>
//
// See scripts/lib/s41-sim-kit.mts for how nothing leaves: every WhatsApp send
// captured (SIMULATION_MODE + sim_outbound), KV in memory, Claude scripted from
// the texts below, R2 a local folder, no Discuss line, the time a process clock.
//
// The calendar (Riyadh), as the business runs it — an order of day D is
// delivered and invoiced the next morning; Omar (driver, warehouse, collector)
// works Saturday–Thursday 02:00–12:00, so Friday is off:
//   09-27 Sun  prices (02:00 Ahmed, 02:30 Omar, the engine, one exception Baraa
//              decides, 06:00 publish) · a new number reviewed then a customer ·
//              an order ≥ 150 confirmed · one < 150 refused, completed, confirmed ·
//              one unconfirmed (20:00 reminder, 21:00 close) · one after 21:00
//              «سجّله لبكرة» · 21:15 purchase list · 21:30 summary
//   09-28 Mon  «بدء الدوام» · «تم الشراء» · the purchase tax invoice photo · the
//              route, «في الطريق», «تم التسليم» and the invoice at delivery · a
//              stop «مشكلة» (م12: 11:30 reminder, 12:30 Baraa) · full cash / partial
//              transfer, a receipt each · 18:00 collection list · 21:30 summary
//   09-30 Wed  the prelude of 10-01: prices, one order, 21:15 list
//   10-01 Thu  its delivery → the first TAX invoice (issued 10-01) · no purchase
//              invoice photo → the 12:00 line · prices with VAT, an exception
//              «عدّل» · a new number reviewed · ≥ 150 / < 150 then completed (the
//              quotation's VAT line) · unconfirmed · after 21:00 · 21:15 list
//              (Friday off: waits for Saturday) · 21:30 summary with coverage
//
// Out: scripts/artifacts/s41-sim/<run>/ (report.json, report.md, captured.json,
// created.json — every record this run created, for the marking — the PDFs).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  FAKE_PREFIX, ROOT, TEAM, at, buildEnv, captured, cron, installFetchGuard, installLiveClock, internal, netLog, nowRiyadh, odooStats, realNow, setFakeSlot, setRunTag,
  takeCaptured, useHarnessClock, webhook, type Captured, type ClaudeScript,
} from "./lib/s41-sim-kit.mts";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const MODE = (arg("odoo") ?? "fake") as "live" | "fake";
const RUN = arg("run") ?? `s41-${MODE}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
const OUT = new URL(`./artifacts/s41-sim/${RUN}/`, import.meta.url);
mkdirSync(OUT, { recursive: true });
const realFetch = globalThis.fetch;
(globalThis as any).__realFetch = realFetch;

// ---------------------------------------------------------------- backend: fake (the harness Odoo, seeded from the snapshot) or live
let harness: any = null;
let baseEnv: any = {};
let liveD1: any = null;
if (MODE === "fake") {
  harness = await import("../tests/wa-harness.mts");
  useHarnessClock(harness.setRiyadh);
  baseEnv = harness.reset();
  harness.db.clear();
  const snap = JSON.parse(readFileSync(new URL("./artifacts/s41-sim/tenant-snapshot.json", import.meta.url), "utf8"));
  const m2oIds = (v: any) => (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "string" ? v[0] : v);
  for (const [model, rows] of Object.entries(snap)) {
    if (model.startsWith("_")) continue;
    for (const r of rows as any[]) {
      const rec: any = {};
      for (const [k, v] of Object.entries(r)) rec[k] = m2oIds(v);
      harness.seed(model, rec);
    }
  }
  // standard many2one fields the code reads as [id, name] (the harness answers them raw)
  const co = harness.table("res.company").get(1);
  if (co && typeof co.account_sale_tax_id === "number") co.account_sale_tax_id = [co.account_sale_tax_id, "15%"];
  // the harness reads x_utak_whatsapp from the Work Contact's x_whatsapp_number
  for (const e of harness.rows("hr.employee")) {
    const p = harness.table("res.partner").get(e.work_contact_id);
    if (p && !p.x_whatsapp_number && e.x_utak_whatsapp) p.x_whatsapp_number = e.x_utak_whatsapp;
  }
} else {
  installLiveClock();
  const { liveSimEnv } = await import("./lib/cf-live-env.mjs");
  const live = await liveSimEnv();
  liveD1 = live.SIM_DB;
}
const env = buildEnv({ mode: MODE, runId: RUN, outDir: OUT, baseEnv, liveD1 });
if (MODE === "fake") Object.assign(env, { ODOO_URL: baseEnv.ODOO_URL, ODOO_API_KEY: baseEnv.ODOO_API_KEY });
setRunTag(RUN);
if (MODE === "live") {
  // the first slot of fake numbers no partner (archived included) holds yet
  const { call: odooRead } = await import("../src/odoo.ts");
  const oldPrefix = FAKE_PREFIX;
  let slot = -1;
  for (let s = 1; s <= 9 && slot < 0; s++) {
    const pre = `+9665000041${s}`;
    const n = await odooRead<number>(env, "res.partner", "search_count", { domain: ["|", ["x_whatsapp_number", "=like", `${pre}%`], ["phone", "=like", `${pre}%`]], context: { active_test: false } });
    if (n === 0) slot = s;
  }
  if (slot < 0) throw new Error("no free slot of fake numbers (+9665000041[1-9]x)");
  setFakeSlot(slot);
  env.SIM_ALLOWLIST = String(env.SIM_ALLOWLIST).replace(oldPrefix, FAKE_PREFIX);
  console.log(`fake customers: ${FAKE_PREFIX}1…5 (slot ${slot})`);
}
await env.MSG_DEDUP.put("sim:current_run_id", RUN);

// ---------------------------------------------------------------- Odoo creates / writes of THIS run (for the marking)
const created: Array<{ model: string; ids: number[]; at: string }> = [];
const writes: Array<{ model: string; ids: number[]; fields: string[]; at: string }> = [];
{
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
    const res = await inner(input, init);
    if (m && (m[2] === "create" || m[2] === "write") && res.ok) {
      try {
        const out = await res.clone().json();
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (m[2] === "create") created.push({ model: m[1], ids: Array.isArray(out) ? out : [out], at: nowRiyadh() });
        else writes.push({ model: m[1], ids: body.ids ?? [], fields: Object.keys(body.vals ?? {}), at: nowRiyadh() });
      } catch { /* not json */ }
    }
    return res;
  }) as typeof fetch;
}

// ---------------------------------------------------------------- scripted Claude (the texts below)
const CFG = await import("../src/config.ts");
interface Prod { id: number; name: string; pack: number }
const CATALOG: Prod[] = [
  { id: 100, name: "رمان وسط", pack: 37 }, { id: 107, name: "رمان صغير", pack: 43 },
  { id: 108, name: "رمان كبير", pack: 44 }, { id: 105, name: "افوكادو", pack: 47 },
];
const nums = (s: string) => (s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
const prodOf = (line: string) => [...CATALOG].sort((a, b) => b.name.length - a.name.length).find((p) => line.includes(p.name));
const claude: ClaudeScript = {
  intent(text) {
    const t = text.trim();
    if (/^(السلام|مرحبا|هلا)/.test(t)) return "greeting";
    if (/^(خلاص|جهزه|جهّزه)/.test(t)) return "request_quotation";
    if (CATALOG.some((p) => t.includes(p.name)) && nums(t).length) return "place_order";
    return "other";
  },
  screen() { return { intent: "unclear", reason: "تحية فقط، بلا طلب واضح بعد" }; },
  order(text) {
    return text.split(/\n|،|,/).map((l) => ({ l, p: prodOf(l), q: nums(l).pop() })).filter((x) => x.p && x.q)
      .map((x) => ({ product_id: x.p!.id, packaging_id: x.p!.pack, quantity: x.q, product_name_raw: x.p!.name }));
  },
  prices(text) {
    const prices = text.split("\n").map((l) => ({ l, p: prodOf(l), n: nums(l) })).filter((x) => x.p && x.n.length)
      .map((x) => ({ product_id: x.p!.id, packaging_id: x.p!.pack, cost_price: x.n[0], ...(x.n[1] ? { market_price: x.n[1] } : {}) }));
    return { prices, unrecognized: [] };
  },
};
installFetchGuard(MODE, claude, {
  classify: CFG.SYSTEM_PROMPT_CLASSIFY, screen: CFG.SYSTEM_PROMPT_SCREEN,
  order: CFG.SYSTEM_PROMPT_EXTRACT_ORDER, prices: CFG.SYSTEM_PROMPT_EXTRACT_SUPPLIER_PRICES,
}, globalThis.fetch);

// ---------------------------------------------------------------- the worker and its modules
const worker = (await import("../src/index.ts")).default;
const { call } = await import("../src/odoo.ts");
const SUM = await import("../src/owner-summary.ts");
const INV = await import("../src/invoice.ts");
const OUTR = await import("../src/outreach.ts");
const ZQ = await import("../src/zatca-qr.ts");

// ---------------------------------------------------------------- report
interface Check { day: string; step: string; name: string; ok: boolean; detail?: string }
interface Step { day: string; at: string; name: string; msgs: Array<{ to: string; kind: string; template: string | null; text: string }>; note?: string; error?: string }
const checks: Check[] = [];
const steps: Step[] = [];
let curDay = "", curStep = "";
const who = (n: string) => {
  const d = n.replace(/\D/g, "");
  const names: Record<string, string> = { [TEAM.owner.slice(1)]: "براء", [TEAM.omar.slice(1)]: "عمر", [TEAM.othman.slice(1)]: "عثمان", [TEAM.ahmed.slice(1)]: "أحمد" };
  return names[d] ?? (d.startsWith(FAKE_PREFIX.slice(1)) ? CUSTOMER_NAME[d] ?? `عميل ${d.slice(-3)}` : `عميل حقيقي …${d.slice(-4)}`);
};
function check(name: string, ok: unknown, detail = ""): boolean {
  checks.push({ day: curDay, step: curStep, name, ok: !!ok, ...(ok ? {} : { detail: detail.slice(0, 600) }) });
  console.log(`    ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail.slice(0, 300)}`}`);
  return !!ok;
}
let stepMsgs: Captured[] = [];
let stepStart = 0;
async function step(name: string, when: string, fn: () => Promise<string | void>): Promise<void> {
  at(`${curDay} ${when}`);
  curStep = `${when} ${name}`;
  stepStart = captured.length;
  console.log(`  ⏱ ${curDay} ${when} — ${name}`);
  let note: string | void = undefined, error: string | undefined;
  try { note = await fn(); } catch (e) { error = (e as Error)?.stack ?? String(e); console.log(`    ✗ ERROR ${(e as Error)?.message}`); checks.push({ day: curDay, step: curStep, name: "step ran without error", ok: false, detail: String((e as Error)?.message) }); }
  stepMsgs = captured.slice(stepStart);
  takeCaptured();
  // after every step: a run stopped halfway can still be marked (s41-live-2 could not)
  writeFileSync(new URL("created.json", OUT), JSON.stringify({ run: RUN, mode: MODE, partial: true, created, writes }, null, 1));
  steps.push({ day: curDay, at: when, name, msgs: stepMsgs.map((m) => ({ to: who(m.to), kind: m.type, template: m.template, text: m.text.slice(0, 400) })), ...(note ? { note } : {}), ...(error ? { error } : {}) });
  for (const m of stepMsgs) console.log(`      → ${who(m.to)} [${m.template ?? m.type}] ${m.text.replace(/\n/g, " ⏎ ").slice(0, 150)}`);
}
/** This step's captures so far (live, inside the step). */
const cur = () => captured.slice(stepStart);
const msgsTo = (n: string) => cur().filter((m) => m.to === n.replace(/\D/g, ""));
const allTo = (n: string) => captured.filter((m) => m.to === n.replace(/\D/g, ""));
const anyText = (ms: Captured[], re: RegExp) => ms.some((m) => re.test(m.text) || re.test(JSON.stringify(m.raw?.interactive ?? {})) || re.test(m.template ?? ""));
const buttonIds = (m: Captured | undefined): string[] => [
  ...((m?.raw?.interactive?.action?.buttons ?? []).map((b: any) => b.reply?.id)),
  ...((m?.raw?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => c.parameters?.[0]?.payload)),
].filter(Boolean);

// ---------------------------------------------------------------- the participants' actions
const CUSTOMER_NAME: Record<string, string> = {};
const C = {
  c1: { phone: `${FAKE_PREFIX}1`, name: "مطعم الواحة (محاكاة)" },
  c2: { phone: `${FAKE_PREFIX}2`, name: "بقالة الريان (محاكاة)" },
  c3: { phone: `${FAKE_PREFIX}3`, name: "مخبز الندى (محاكاة)" },
  c5: { phone: `${FAKE_PREFIX}5`, name: "مطبخ السنبلة (محاكاة)" },
};
for (const c of Object.values(C)) CUSTOMER_NAME[c.phone.slice(1)] = c.name;
const nameOf = (phone: string) => Object.values(C).find((c) => c.phone === phone)?.name ?? "x";
const say = (from: string, text: string) => webhook(worker, env, from, { type: "text", text: { body: text } }, nameOf(from));
const tap = (from: string, id: string, title = "x") => webhook(worker, env, from, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } }, nameOf(from));
const tapTpl = (from: string, payload: string, text = "x") => webhook(worker, env, from, { type: "button", button: { payload, text } }, nameOf(from));
/** § 42 ب — the choice under «نقد» / «تحويل»: the latest «المبلغ كامل» / «مبلغ آخر» button sent to `to`. */
const lastChoice = (to: string, which: "full" | "other"): string =>
  allTo(to).flatMap((m) => buttonIds(m)).filter((id) => id.startsWith(`collect_${which}_`)).at(-1) ?? "";
const shareLocation = (from: string, name: string) => webhook(worker, env, from, { type: "location", location: { latitude: 24.71, longitude: 46.67, name } }, nameOf(from));
const photo = (from: string, id: string) => webhook(worker, env, from, { type: "image", image: { id, mime_type: "image/jpeg" } }, nameOf(from));
const tick = () => cron(worker, env, "*/5 * * * *");
const driverTick = () => cron(worker, env, "2,7,12,17,22,27,32,37,42,47,52,57 * * * *");
const sr = <T,>(model: string, domain: unknown[], fields: string[], extra: Record<string, unknown> = {}) => call<T[]>(env, model, "search_read", { domain, fields, ...extra });
const partnerByPhone = async (phone: string) => (await sr<any>("res.partner", [["x_whatsapp_number", "=", phone]], ["id", "name", "x_contact_class", "x_review_pending", "x_ai_intent"], { limit: 1 }))[0] ?? null;
const ordersOf = async (partnerId: number) => sr<any>("x_daily_order", [["x_customer_id", "=", partnerId]], ["id", "x_state", "x_order_date", "x_line_ids"], { order: "id asc" });
const invoiceOfOrder = async (orderId: number) => (await sr<any>("x_invoice", [["x_order_id", "=", orderId]], ["id", "x_invoice_number", "x_invoice_date", "x_issued_at", "x_subtotal", "x_tax_amount", "x_total", "x_status", "x_invoice_sent_at"], { limit: 1 }))[0] ?? null;
const dayRecord = async (day: string) => (await sr<any>("x_price_day", [["x_date", "=", day], ["x_utak_simulation", "!=", true]], ["id", "x_state", "x_publish_report"], { order: "id desc", limit: 1 }))[0] ?? null;
const dayLines = async (dayId: number) => sr<any>("x_price_day_line", [["x_day_id", "=", dayId]], ["id", "x_product_tmpl_id", "x_cost_price", "x_market_price", "x_unit_profit", "x_status", "x_reason", "x_sale_price", "x_decision", "x_manual_price"]);
const m2o = (v: any) => (Array.isArray(v) ? v[0] : v);
const PRODUCT = (id: number) => CATALOG.find((p) => p.id === id)?.name ?? String(id);

// the report's figures
const invoices: any[] = [];
const payments: Array<{ invoice: string; amount: number; method: string; at: string }> = [];
const summaries: Record<string, unknown> = {};
const qrs: unknown[] = [];

// ---------------------------------------------------------------- before (read-only): what the flagged run must leave as it was
const SIM_DAYS = ["2026-09-27", "2026-09-28", "2026-10-01"];
async function baseline(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const d of SIM_DAYS) {
    at(`${d} 21:30`);
    const f = await SUM.readSummaryFigures(env);
    out[`summary_${d}`] = { tomorrow: f.tomorrow, deliveries: f.deliveries, collected: f.collected, pending: f.pending, coverage: f.coverage };
  }
  at("2026-10-04 08:00");
  out.owed = [...(await OUTR.owedByCustomer(env)).entries()];
  const { getUnpaidInvoicesWithCustomer } = await import("../src/odoo.ts");
  out.unpaid = (await getUnpaidInvoicesWithCustomer(env)).map((i) => [i.id, i.total]);
  const [a] = await call<any[]>(env, "res.partner", "read", { ids: [30], fields: ["x_sp_due_total", "x_sp_paid_total", "x_sp_remaining"] }).catch(() => [null]);
  out.ahmed = a;
  return out;
}
const before = await baseline();
writeFileSync(new URL("before.json", OUT), JSON.stringify(before, null, 1));

// ---------------------------------------------------------------- the windows before the run (as the real flow leaves them)
// Baraa tapped his 06:00 template on 09-26 (a 24h window over the next dawn).
await env.MSG_DEDUP.put(`wa_win:v1:${TEAM.owner.slice(1)}`, JSON.stringify({ in: Date.parse("2026-09-26T06:00:00+03:00") }));

// ======================================================================== 09-27
curDay = "2026-09-27";
console.log(`\n=== ${curDay} (الأحد) ===`);
let exceptionLine = 0;
await step("طلب أسعار الموردين 02:00", "02:00", async () => {
  await cron(worker, env, "0 23 * * *");
  check("أحمد: طلب الأسعار (قالب utak_supplier_ask_v2)", msgsTo(TEAM.ahmed).some((m) => m.template === "utak_supplier_ask_v2"), JSON.stringify(cur()));
});
await step("عمر «بدء الدوام» 02:00", "02:00", async () => {
  await tick();
  const m = msgsTo(TEAM.omar);
  check("عمر: قالب «بدء الدوام» utak_shift_start_v2", m.some((x) => x.template === "utak_shift_start_v2"), JSON.stringify(m));
});
await step("عمر يضغط «بدء الدوام»", "02:03", async () => { await tapTpl(TEAM.omar, "shift_start", "بدء الدوام"); });
await step("رد أحمد بأسعاره", "02:20", async () => {
  await say(TEAM.ahmed, "رمان وسط 15\nافوكادو 50 سوق 62");
  const dp = await sr<any>("x_daily_price", [["x_date", "=", curDay], ["x_supplier_id", "=", 30], ["x_utak_simulation", "!=", true]], ["x_product_tmpl_id", "x_price_sar"]);
  check("x_daily_price: رمان وسط 15، افوكادو 50 (ما يورّده أحمد)", [[100, 15], [105, 50]].every(([p, v]) => dp.some((r) => m2o(r.x_product_tmpl_id) === p && r.x_price_sar === v)), JSON.stringify(dp));
  check("أحمد: تأكيد الاستلام (utak_supplier_confirm_v1 أو نص)", msgsTo(TEAM.ahmed).length > 0, JSON.stringify(msgsTo(TEAM.ahmed)));
});
await step("طلب عمر 02:30", "02:30", async () => {
  await tick();
  check("عمر: «أرسل أسعار السوق اليوم» (نص داخل نافذته)", anyText(msgsTo(TEAM.omar), /أرسل أسعار السوق اليوم/), JSON.stringify(msgsTo(TEAM.omar)));
});
await step("رد عمر بأسعار السوق", "02:45", async () => {
  await say(TEAM.omar, "رمان وسط 19\nافوكادو 60\nرمان كبير 26 شراء 22\nرمان صغير سوق 12 شراء 11.5");
  check("عمر: «وصلتنا أسعار السوق»", anyText(msgsTo(TEAM.omar), /وصلتنا أسعار السوق/), JSON.stringify(msgsTo(TEAM.omar)));
});
await step("المحرك (نبضة 03:00)", "03:00", async () => {
  await tick();
  const d = await dayRecord(curDay);
  const ls = d ? await dayLines(d.id) : [];
  const L = (p: number) => ls.find((l) => m2o(l.x_product_tmpl_id) === p);
  check("رمان وسط: شراء 15، سوق 19، ربح 3.25، تلقائي", L(100)?.x_cost_price === 15 && L(100)?.x_market_price === 19 && L(100)?.x_unit_profit === 3.25 && L(100)?.x_status === "auto", JSON.stringify(L(100)));
  check("افوكادو: سوق وسيط (62، 60) = 61، ربح 8.5", L(105)?.x_market_price === 61 && L(105)?.x_unit_profit === 8.5 && L(105)?.x_status === "auto", JSON.stringify(L(105)));
  check("رمان صغير: شراء 11.5 (عمر)، سوق 12 → ربح −0.08، استثناء", L(107)?.x_status === "exception" && /ربح الوحدة/.test(String(L(107)?.x_reason)), JSON.stringify(L(107)));
  exceptionLine = L(107)?.id ?? 0;
  return `lines: ${ls.map((l) => `${PRODUCT(m2o(l.x_product_tmpl_id))} ${l.x_cost_price}/${l.x_market_price} ${l.x_status}`).join(" · ")}`;
});
await step("استثناءات لبراء 04:00", "04:00", async () => {
  await tick();
  const m = msgsTo(TEAM.owner).find((x) => /استثناء في أسعار اليوم/.test(x.text));
  check("براء: رسالة الاستثناء (رمان صغير) بأزرارها", !!m && buttonIds(m).includes(`pexc_m_${exceptionLine}`), JSON.stringify(msgsTo(TEAM.owner)));
});
await step("براء: «اعتمد بسعر السوق»", "04:20", async () => {
  await tap(TEAM.owner, `pexc_m_${exceptionLine}`, "اعتمد بسعر السوق");
  const [l] = await call<any[]>(env, "x_price_day_line", "read", { ids: [exceptionLine], fields: ["x_status", "x_decision", "x_sale_price"] });
  check("السطر: معتمد يدوياً بسعر السوق 12", l?.x_status === "manual" && l?.x_sale_price === 12, JSON.stringify(l));
});
await step("05:00 تذكير الموردين ومؤشرات الموثوقية", "05:00", async () => { await cron(worker, env, "0 2 * * *"); });
await step("النشر 06:00 وفتح الطلبات", "06:00", async () => {
  await tick();
  await cron(worker, env, "0 3 * * *");
  const d = await dayRecord(curDay);
  check("اليوم منشور", d?.x_state === "published", JSON.stringify(d));
  const toCustomers = cur().filter((m) => !Object.values(TEAM).includes("+" + m.to));
  // s41-live-1: on the first day no simulation customer exists yet, so the list
  // goes to the tenant's real customers only — and the allowlist refuses each
  // of them (nothing sent, nothing captured). Baraa's copy counts them.
  const copy = String(cur().find((m) => /نُشرت أسعار/.test(String(m.text ?? "")))?.text ?? "");
  const listed = Number(/والعملاء: (\d+)/.exec(copy)?.[1] ?? -1), blocked = Number(/محجوبة (\d+)/.exec(copy)?.[1] ?? -1);
  const toReal = toCustomers.filter((m) => !("+" + m.to).startsWith(FAKE_PREFIX));
  if (MODE === "live") check("قائمة الأسعار: كل عميل حقيقي محجوب بالقائمة المسموحة (لا إرسال ولا التقاط لرقم حقيقي)",
    listed > 0 && blocked === listed - toCustomers.length && toReal.length === 0,
    `العملاء ${listed}، محجوبة ${blocked}، ملتقطة ${toCustomers.length}، لرقم حقيقي ${toReal.length} — ${copy.slice(0, 160)}`);
  return `published to ${toCustomers.length} numbers (captured)`;
});
await step("براء وعثمان يفتحان النافذة (قالب 06:00)", "06:02", async () => {
  await tapTpl(TEAM.owner, "shift_start", "بدء الدوام");
  await tapTpl(TEAM.othman, "shift_start", "بدء الدوام");
});
await step("08:00 رسائل المتابعة (التقييم، التذكير بالدفع، الغياب)", "08:00", async () => { await cron(worker, env, "0 5 * * *"); });
// the new number → review → customer
await step("رقم جديد (مطعم الواحة): «السلام عليكم»", "08:10", async () => {
  await say(C.c1.phone, "السلام عليكم");
  const p = await partnerByPhone(C.c1.phone);
  check("شريك جديد «غير مراجَع» ينتظر المراجعة", p && p.x_contact_class === "unreviewed" && p.x_review_pending === true, JSON.stringify(p));
  check("براء: «رقم جديد ينتظر المراجعة»", anyText(msgsTo(TEAM.owner), /رقم جديد ينتظر المراجعة/), JSON.stringify(msgsTo(TEAM.owner)));
});
await step("براء يصنّفه «عميل» في Odoo", "08:20", async () => {
  const p = await partnerByPhone(C.c1.phone);
  await call(env, "res.partner", "write", { ids: [p.id], vals: { x_contact_class: "customer", x_review_pending: false } });
  const q = await partnerByPhone(C.c1.phone);
  check("صار «عميل»", q?.x_contact_class === "customer" && !q?.x_review_pending, JSON.stringify(q));
});
let c1Order = 0, c2Order = 0, c3Order = 0;
await step("مطعم الواحة يطلب ≥ 150 ويؤكد", "09:00", async () => {
  await say(C.c1.phone, "رمان وسط 12");
  await say(C.c1.phone, "خلاص");
  if (anyText(msgsTo(C.c1.phone), /أرسل موقع التوصيل/)) await shareLocation(C.c1.phone, "العليا");
  const p = await partnerByPhone(C.c1.phone);
  const [o] = await ordersOf(p.id);
  c1Order = o?.id ?? 0;
  const q = allTo(C.c1.phone).filter((m) => buttonIds(m).includes(`confirm_order_${c1Order}`)).pop();
  check("كوتيشن بأزرار التأكيد (12 × 19 = 228)", !!q, JSON.stringify(allTo(C.c1.phone).slice(-3)));
  await tap(C.c1.phone, `confirm_order_${c1Order}`, "تأكيد الطلب ✅");
  const [o2] = await ordersOf(p.id);
  check("الطلب مؤكد", o2?.x_state === "confirmed", JSON.stringify(o2));
});
await step("بقالة الريان: < 150 يُرفض ثم يُكمَل ويؤكَّد", "10:00", async () => {
  await say(C.c2.phone, "رمان كبير 4");
  await say(C.c2.phone, "خلاص");
  check("«أقل طلب 150 ريال، أضف أصنافاً ليكتمل» (104)", anyText(msgsTo(C.c2.phone), /أقل طلب 150 ريال/), JSON.stringify(msgsTo(C.c2.phone)));
  check("لا زر تأكيد", !msgsTo(C.c2.phone).some((m) => buttonIds(m).some((b) => b.startsWith("confirm_order_"))));
  await say(C.c2.phone, "افوكادو 1");
  await say(C.c2.phone, "خلاص");
  if (anyText(msgsTo(C.c2.phone), /أرسل موقع التوصيل/)) await shareLocation(C.c2.phone, "الملز");
  const p = await partnerByPhone(C.c2.phone);
  const [o] = await ordersOf(p.id);
  c2Order = o?.id ?? 0;
  const q = allTo(C.c2.phone).filter((m) => buttonIds(m).includes(`confirm_order_${c2Order}`)).pop();
  check("بعد الإكمال (165): كوتيشن بزر التأكيد", !!q, JSON.stringify(allTo(C.c2.phone).slice(-3)));
  await tap(C.c2.phone, `confirm_order_${c2Order}`, "تأكيد الطلب ✅");
  check("مؤكد", (await ordersOf(p.id))[0]?.x_state === "confirmed");
});
await step("17:00 تذكير الطلبات الثابتة", "16:59", async () => { await cron(worker, env, "0 14 * * *"); });
await step("مخبز الندى: كوتيشن بلا تأكيد", "17:00", async () => {
  await say(C.c3.phone, "رمان صغير 15");
  await say(C.c3.phone, "خلاص");
  if (anyText(msgsTo(C.c3.phone), /أرسل موقع التوصيل/)) await shareLocation(C.c3.phone, "النرجس");
  const p = await partnerByPhone(C.c3.phone);
  c3Order = (await ordersOf(p.id))[0]?.id ?? 0;
  check("بانتظار التأكيد", (await ordersOf(p.id))[0]?.x_state === "waiting_confirmation");
});
await step("تذكير 20:00", "20:00", async () => {
  await cron(worker, env, "0 17 * * *");
  check("مخبز الندى: تذكير التأكيد", msgsTo(C.c3.phone).length > 0, JSON.stringify(cur().map((m) => who(m.to))));
  check("لا تذكير للمؤكدين", msgsTo(C.c1.phone).length === 0 && msgsTo(C.c2.phone).length === 0);
});
await step("إقفال 21:00", "21:00", async () => {
  await cron(worker, env, "0 18 * * *");
  const p = await partnerByPhone(C.c3.phone);
  check("غير المؤكد أُلغي", (await ordersOf(p.id))[0]?.x_state === "cancelled");
});
await step("طلب بعد 21:00 يُسجَّل للغد", "21:08", async () => {
  await say(C.c1.phone, "رمان وسط 5");
  const p = await partnerByPhone(C.c1.phone);
  check("عرض «سجّله لبكرة» / «لا شكراً»", msgsTo(C.c1.phone).some((m) => buttonIds(m).includes(`late_yes_${p.id}`)), JSON.stringify(msgsTo(C.c1.phone)));
  await tap(C.c1.phone, `late_yes_${p.id}`, "سجّله لبكرة");
  const os = await ordersOf(p.id);
  const late = os.find((o) => o.x_order_date === "2026-09-28");
  check("طلب مسجّل ليوم 09-28", !!late, JSON.stringify(os));
  return `late order #${late?.id} (${late?.x_state})`;
});
let list0927 = 0;
await step("قائمة الشراء 21:15", "21:15", async () => {
  await cron(worker, env, "15 18 * * *");
  const [l] = await sr<any>("x_purchase_list", [["x_date", "=", curDay], ["x_utak_simulation", "!=", true]], ["id", "x_status", "x_aggregated_items"], { order: "id desc", limit: 1 });
  list0927 = l?.id ?? 0;
  check("قائمة 09-27: رمان وسط 12، رمان كبير 4، افوكادو 1", !!l && /100/.test(String(l.x_aggregated_items)) && /108/.test(String(l.x_aggregated_items)), JSON.stringify(l));
  check("عمر بعد دوامه: القائمة محفوظة لضغطته التالية، ولبراء «مهمة لعمر بعد دوامه»", !msgsTo(TEAM.omar).some((m) => buttonIds(m).includes(`purchase_done_${list0927}`)) && anyText(msgsTo(TEAM.owner), /عمر/), JSON.stringify(cur().map((m) => [who(m.to), m.text.slice(0, 80)])));
});
await step("ملخص 21:30", "21:30", async () => {
  await cron(worker, env, "30 18 * * *");
  const m = msgsTo(TEAM.owner).find((x) => /ملخص اليوم/.test(x.text) || x.template === "utak_v2_summary");
  check("براء: ملخص اليوم", !!m, JSON.stringify(msgsTo(TEAM.owner)));
  summaries[curDay] = m?.text;
});

// ======================================================================== 09-28
curDay = "2026-09-28";
console.log(`\n=== ${curDay} (الاثنين) ===`);
await step("«بدء الدوام» لعمر", "02:00", async () => { await tick(); });
await step("عمر يضغط «بدء الدوام» ← قائمة الشراء", "02:03", async () => {
  await tapTpl(TEAM.omar, "shift_start", "بدء الدوام");
  check("عمر: قائمة الشراء بزر «تم الشراء»", msgsTo(TEAM.omar).some((m) => buttonIds(m).includes(`purchase_done_${list0927}`) || /قائمة/.test(m.text)), JSON.stringify(msgsTo(TEAM.omar).map((m) => m.text.slice(0, 80))));
});
await step("«تم الشراء»", "03:30", async () => {
  await tap(TEAM.omar, `purchase_done_${list0927}`, "تم الشراء ✅");
  check("رده: «📸 أرسل صورة فاتورة الشراء الضريبية»", anyText(msgsTo(TEAM.omar), /أرسل صورة فاتورة الشراء الضريبية/), JSON.stringify(msgsTo(TEAM.omar).map((m) => m.text.slice(0, 120))));
  check("مسار عمر ومحطاته بأزرار «تم التسليم»", msgsTo(TEAM.omar).some((m) => buttonIds(m).includes(`delivered_${c1Order}`)), JSON.stringify(msgsTo(TEAM.omar).map((m) => buttonIds(m))));
  check("«في الطريق» لأول محطة", msgsTo(C.c1.phone).some((m) => /في الطريق/.test(m.text) || m.template === "utak_out_for_delivery") || msgsTo(C.c2.phone).some((m) => /في الطريق/.test(m.text) || m.template === "utak_out_for_delivery"), JSON.stringify(cur().map((m) => [who(m.to), m.template, m.text.slice(0, 60)])));
});
await step("صورة فاتورة الشراء", "03:45", async () => {
  await photo(TEAM.omar, "SIMMEDIA_PINV0928");
  check("«وصلت الفاتورة ✅»", anyText(msgsTo(TEAM.omar), /وصلت الفاتورة/), JSON.stringify(msgsTo(TEAM.omar)));
  const [l] = await call<any[]>(env, "x_purchase_list", "read", { ids: [list0927], fields: ["x_tax_invoice_filename", "x_tax_invoice_at"] });
  check("مرفقة بالقائمة", !!l?.x_tax_invoice_filename && !!l?.x_tax_invoice_at, JSON.stringify(l));
});
await step("«تم التسليم» مطعم الواحة ← الفاتورة", "05:30", async () => {
  await tap(TEAM.omar, `delivered_${c1Order}`, "تم التسليم ✅");
  const inv = await invoiceOfOrder(c1Order);
  invoices.push({ customer: C.c1.name, ...inv });
  check("فاتورة لحظة التسليم: 228، بلا ضريبة (قبل 10-01)، مرسلة", inv?.x_total === 228 && inv?.x_tax_amount === 0 && !!inv?.x_invoice_sent_at && inv?.x_issued_at === "2026-09-28 02:30:00", JSON.stringify(inv));
  check("العميل: فاتورته", msgsTo(C.c1.phone).some((m) => /فاتورت|invoice/.test(m.text + (m.template ?? ""))), JSON.stringify(msgsTo(C.c1.phone)));
  check("عمر (المحصّل): طلب التحصيل بأزراره", msgsTo(TEAM.omar).some((m) => buttonIds(m).some((b) => b === `collect_cash_${inv?.id}`)), JSON.stringify(msgsTo(TEAM.omar).map((m) => buttonIds(m))));
  check("«في الطريق» للمحطة التالية (بقالة الريان)", msgsTo(C.c2.phone).some((m) => /في الطريق/.test(m.text) || m.template === "utak_out_for_delivery"), JSON.stringify(msgsTo(C.c2.phone)));
});
await step("06:00 فتح الطلبات، وقالب براء وعثمان", "06:00", async () => {
  await tick(); await cron(worker, env, "0 3 * * *");
  await tapTpl(TEAM.owner, "shift_start", "بدء الدوام"); await tapTpl(TEAM.othman, "shift_start", "بدء الدوام");
});
await step("«فيه مشكلة» على بقالة الريان", "06:15", async () => {
  await tap(TEAM.omar, `delivery_issue_${c2Order}`, "فيه مشكلة ⚠️");
  await say(TEAM.omar, "المحل مقفل، بأرجع له بعد الظهر");
  check("براء: المشكلة وصلته", anyText(msgsTo(TEAM.owner), /مقفل/), JSON.stringify(msgsTo(TEAM.owner)));
});
await step("08:00 رسائل المتابعة", "08:00", async () => { await cron(worker, env, "0 5 * * *"); });
await step("م12: تذكير 11:30", "11:32", async () => {
  await driverTick();
  check("عمر: «باقي 30 دقيقة… محطة»", anyText(msgsTo(TEAM.omar), /باقي 30 دقيقة/), JSON.stringify(msgsTo(TEAM.omar)));
});
await step("12:00 فحص فاتورة الشراء (مرفقة)", "12:00", async () => {
  await tick();
  check("لا تنبيه (الفاتورة مرفقة)", !anyText(msgsTo(TEAM.owner), /بلا فاتورة شراء ضريبية/), JSON.stringify(msgsTo(TEAM.owner)));
});
await step("م12: تنبيه براء 12:30", "12:32", async () => {
  await driverTick();
  check("براء: «انتهى دوامه… بلا «تم التسليم»»", anyText(msgsTo(TEAM.owner), /انتهى دوامه/), JSON.stringify(msgsTo(TEAM.owner)));
});
await step("«تم التسليم» بقالة الريان", "13:10", async () => {
  await tap(TEAM.omar, `delivered_${c2Order}`, "تم التسليم ✅");
  const inv = await invoiceOfOrder(c2Order);
  invoices.push({ customer: C.c2.name, ...inv });
  check("فاتورتها: 4 × 26 + 61 = 165، مرسلة", inv?.x_total === 165 && !!inv?.x_invoice_sent_at, JSON.stringify(inv));
});
await step("تحصيل كامل نقداً (مطعم الواحة) ← الإيصال", "13:30", async () => {
  const inv = await invoiceOfOrder(c1Order);
  await tapTpl(TEAM.omar, `collect_cash_${inv.id}`, "نقد 💵");
  check("§ 42 ب: «نقد» يسأل «المبلغ كامل» / «مبلغ آخر» ولا يسجّل شيئاً", !!lastChoice(TEAM.omar, "full") && (await sr<any>("x_payment", [["x_invoice_id", "=", inv.id]], ["id"])).length === 0);
  await tap(TEAM.omar, lastChoice(TEAM.omar, "full"), "المبلغ كامل");
  const [pay] = await sr<any>("x_payment", [["x_invoice_id", "=", inv.id]], ["id", "x_amount", "x_method"], { order: "id desc", limit: 1 });
  check("دفعة 228 نقداً والفاتورة مدفوعة", pay?.x_amount === 228 && (await invoiceOfOrder(c1Order))?.x_status === "paid", JSON.stringify(pay));
  payments.push({ invoice: inv.x_invoice_number, amount: pay?.x_amount, method: "cash", at: nowRiyadh() });
  const r = await internal(worker, env, "/internal/receipt-issue", { _model: "x_payment", _id: pay.id });
  await new Promise((res) => setTimeout(res, 50));
  check("الإيصال (أتمتة #1 محاكاة داخل العملية): 202", r.status === 202 || r.status === 200, JSON.stringify(r));
  return `payment #${pay?.id}`;
});
await step("…تأكيد الدفعة للعميل", "13:31", async () => {
  check("مطعم الواحة: «استلمنا دفعتك…» مرة واحدة", allTo(C.c1.phone).filter((m) => /استلمنا دفعتك|payment_received/.test(m.text + (m.template ?? ""))).length === 1, JSON.stringify(allTo(C.c1.phone).slice(-3)));
});
await step("تحصيل جزئي تحويلاً (بقالة الريان) ← الإيصال والمتبقي", "14:00", async () => {
  const inv = await invoiceOfOrder(c2Order);
  // § 42 ب — from WhatsApp now: «تحويل» ← «مبلغ آخر» ← «100»
  await tapTpl(TEAM.omar, `collect_transfer_${inv.id}`, "تحويل 🏦");
  await tap(TEAM.omar, lastChoice(TEAM.omar, "other"), "مبلغ آخر");
  await say(TEAM.omar, "١٠٠");
  const [p100] = await sr<any>("x_payment", [["x_invoice_id", "=", inv.id]], ["id", "x_amount"], { order: "id desc", limit: 1 });
  const r = { paymentId: p100?.id ?? null, fullyPaid: (await invoiceOfOrder(c2Order))?.x_status === "paid", amount: p100?.x_amount };
  payments.push({ invoice: inv.x_invoice_number, amount: 100, method: "transfer", at: nowRiyadh() });
  check("دفعة 100 تحويلاً، والفاتورة باقية «صادرة» (المتبقي 65)", r.paymentId && !r.fullyPaid && (await invoiceOfOrder(c2Order))?.x_status === "issued", JSON.stringify(r));
  await internal(worker, env, "/internal/receipt-issue", { _model: "x_payment", _id: r.paymentId });
  check("بقالة الريان: الإيصال و«المتبقي على الفاتورة: 65»", allTo(C.c2.phone).some((m) => /المتبقي على الفاتورة: 65/.test(m.text)) || allTo(C.c2.phone).some((m) => m.template === "utak_payment_received"), JSON.stringify(allTo(C.c2.phone).slice(-2)));
});
await step("قائمة التحصيل 18:00", "18:00", async () => {
  await cron(worker, env, "0 15 * * *");
  return JSON.stringify(cur().map((m) => [who(m.to), m.template, m.text.slice(0, 100)]));
});
await step("ملخص 21:30", "21:30", async () => {
  await cron(worker, env, "30 18 * * *");
  const m = msgsTo(TEAM.owner).find((x) => /ملخص اليوم/.test(x.text) || x.template === "utak_v2_summary");
  check("براء: ملخص اليوم بسطر التغطية", !!m && /تغطية/.test(m.text), JSON.stringify(msgsTo(TEAM.owner)));
  summaries[curDay] = m?.text;
  at(`${curDay} 21:30`);
  const f = await SUM.readSummaryFigures(env);
  check("التوصيلات 2 من 2، المحصَّل 328، المعلَّق 65", f.deliveries?.delivered === 2 && f.deliveries?.total === 2 && f.collected === 328 && f.pending === 65, JSON.stringify(f));
});

// ======================================================================== 09-30 (the prelude of 10-01)
curDay = "2026-09-30";
console.log(`\n=== ${curDay} (الأربعاء، تمهيد 10-01) ===`);
await step("طلب الأسعار 02:00", "02:00", async () => { await cron(worker, env, "0 23 * * *"); await tick(); });
await step("عمر «بدء الدوام»", "02:03", async () => { await tapTpl(TEAM.omar, "shift_start", "بدء الدوام"); });
await step("رد أحمد", "02:15", async () => { await say(TEAM.ahmed, "رمان وسط 15\nافوكادو 50"); });
await step("طلب عمر 02:30 ورده", "02:30", async () => { await tick(); at(`${curDay} 02:40`); await say(TEAM.omar, "رمان وسط 19\nافوكادو 61\nرمان كبير 26 شراء 22\nرمان صغير 13 شراء 11"); });
await step("المحرك 03:00 والنشر 06:00", "06:00", async () => {
  at(`${curDay} 03:00`); await tick(); at(`${curDay} 06:00`); await tick(); await cron(worker, env, "0 3 * * *");
  const d = await dayRecord(curDay);
  check("09-30 منشور (كلها تلقائي)", d?.x_state === "published", JSON.stringify(d));
  await tapTpl(TEAM.owner, "shift_start", "بدء الدوام");
});
let c1Order0930 = 0;
await step("مطعم الواحة يطلب ويؤكد (190)", "09:00", async () => {
  const p = await partnerByPhone(C.c1.phone);
  await say(C.c1.phone, "رمان وسط 10");
  await say(C.c1.phone, "خلاص");
  const o = (await ordersOf(p.id)).filter((x) => x.x_order_date === curDay).pop();
  c1Order0930 = o?.id ?? 0;
  await tap(C.c1.phone, `confirm_order_${c1Order0930}`, "تأكيد الطلب ✅");
  check("مؤكد", (await ordersOf(p.id)).find((x) => x.id === c1Order0930)?.x_state === "confirmed");
  check("كوتيشن 09-30 بلا سطر الضريبة", !anyText(msgsTo(C.c1.phone), /شاملة ضريبة/), JSON.stringify(msgsTo(C.c1.phone)));
});
let c2Order0930 = 0;
await step("بقالة الريان تطلب وتؤكد (3 × 61 = 183)", "10:00", async () => {
  const p = await partnerByPhone(C.c2.phone);
  await say(C.c2.phone, "افوكادو 3");
  await say(C.c2.phone, "خلاص");
  const o = (await ordersOf(p.id)).filter((x) => x.x_order_date === curDay).pop();
  c2Order0930 = o?.id ?? 0;
  await tap(C.c2.phone, `confirm_order_${c2Order0930}`, "تأكيد الطلب ✅");
  check("مؤكد", (await ordersOf(p.id)).find((x) => x.id === c2Order0930)?.x_state === "confirmed");
});
let list0930 = 0;
await step("إقفال 21:00 وقائمة 21:15", "21:15", async () => {
  at(`${curDay} 21:00`); await cron(worker, env, "0 18 * * *");
  at(`${curDay} 21:15`); await cron(worker, env, "15 18 * * *");
  const [l] = await sr<any>("x_purchase_list", [["x_date", "=", curDay], ["x_utak_simulation", "!=", true]], ["id"], { order: "id desc", limit: 1 });
  list0930 = l?.id ?? 0;
  check("قائمة 09-30 (رمان وسط 10، افوكادو 3)", list0930 > 0);
});

// ======================================================================== 10-01
curDay = "2026-10-01";
console.log(`\n=== ${curDay} (الخميس، بعد الضريبة) ===`);
await step("طلب الأسعار 02:00 و«بدء الدوام»", "02:00", async () => { await cron(worker, env, "0 23 * * *"); await tick(); });
await step("عمر يضغط «بدء الدوام» ← قائمة 09-30", "02:03", async () => { await tapTpl(TEAM.omar, "shift_start", "بدء الدوام"); });
await step("رد أحمد", "02:10", async () => { await say(TEAM.ahmed, "رمان وسط 16\nافوكادو 52 سوق 63"); });
await step("طلب عمر 02:30 ورده", "02:30", async () => { await tick(); at(`${curDay} 02:40`); await say(TEAM.omar, "رمان وسط 20\nافوكادو 62\nرمان كبير 24 شراء 23\nرمان صغير 13 شراء 11.5"); });
let exc1001 = 0;
await step("المحرك 03:00 (ربح الوحدة ÷ 1.15)", "03:00", async () => {
  await tick();
  const d = await dayRecord(curDay);
  const ls = d ? await dayLines(d.id) : [];
  const L = (p: number) => ls.find((l) => m2o(l.x_product_tmpl_id) === p);
  check("رمان وسط: (20 − 16 − 0.8) ÷ 1.15 = 2.78، تلقائي", L(100)?.x_unit_profit === 2.78 && L(100)?.x_status === "auto", JSON.stringify(L(100)));
  check("افوكادو: سوق (63، 62) = 62.5، (62.5 − 52 − 2.6) ÷ 1.15 = 6.87", L(105)?.x_unit_profit === 6.87, JSON.stringify(L(105)));
  check("رمان كبير: (24 − 23 − 1.15) ÷ 1.15 = −0.13 → استثناء", L(108)?.x_status === "exception" && L(108)?.x_unit_profit === -0.13, JSON.stringify(L(108)));
  exc1001 = L(108)?.id ?? 0;
});
await step("«تم الشراء» (قائمة 09-30) بلا صورة فاتورة", "03:30", async () => {
  await tap(TEAM.omar, `purchase_done_${list0930}`, "تم الشراء ✅");
  check("سطر طلب الصورة", anyText(msgsTo(TEAM.omar), /أرسل صورة فاتورة الشراء الضريبية/));
});
await step("استثناء 10-01 لبراء ← «عدّل» 25", "04:05", async () => {
  await tick();
  const m = msgsTo(TEAM.owner).find((x) => /استثناء في أسعار اليوم/.test(x.text));
  check("براء: استثناء رمان كبير", !!m && buttonIds(m).includes(`pexc_e_${exc1001}`), JSON.stringify(msgsTo(TEAM.owner)));
  await tap(TEAM.owner, `pexc_e_${exc1001}`, "عدّل");
  await say(TEAM.owner, "25");
  const [l] = await call<any[]>(env, "x_price_day_line", "read", { ids: [exc1001], fields: ["x_status", "x_sale_price", "x_manual_price"] });
  check("السطر: سعر معدّل 25", l?.x_status === "manual" && l?.x_sale_price === 25, JSON.stringify(l));
});
let tax1001: any = null;
await step("«تم التسليم» مطعم الواحة ← أول فاتورة ضريبية", "05:30", async () => {
  await tap(TEAM.omar, `delivered_${c1Order0930}`, "تم التسليم ✅");
  const inv = await invoiceOfOrder(c1Order0930);
  tax1001 = inv;
  invoices.push({ customer: C.c1.name, ...inv });
  check("10 × 19 = 190 شامل، ضريبة 24.78 (190 × 15 ÷ 115)، صافٍ 165.22، تاريخها 10-01", inv?.x_total === 190 && inv?.x_tax_amount === 24.78 && inv?.x_subtotal === 165.22 && inv?.x_invoice_date === "2026-10-01", JSON.stringify(inv));
  // the PDF: the real render (Gotenberg) of the stored invoice, and its QR decoded
  const data = await INV.buildInvoicePDFDataFromOdoo(env, inv.id);
  const html = INV.renderInvoiceHTML(data!, await (await import("../src/company.ts")).readCompanyInfo(env));
  writeFileSync(new URL(`invoice-${inv.x_invoice_number}.html`, OUT), html);
  const pdf = await INV.generateInvoicePDF(data!, env);
  writeFileSync(new URL(`invoice-${inv.x_invoice_number}.pdf`, OUT), pdf);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("PDF: «فاتورة ضريبية مبسطة» (العميل بلا رقم ضريبي)", text.includes("فاتورة ضريبية مبسطة"));
  check("PDF: الرقم الضريبي 315022736600003 واسم المنشأة", text.includes("315022736600003") && text.includes("شركة يوتاك"));
  check("PDF: رقم الفاتورة ووقت الإصدار 2026/10/01 05:30", text.includes(inv.x_invoice_number) && text.includes("2026/10/01 05:30"));
  check("PDF: السطر صافياً 16.52 × 10 = 165.22", data!.items[0]?.price === 16.52 && data!.items[0]?.total === 165.22, JSON.stringify(data!.items));
  const qr = ZQ.parseZatcaQr(data!.zatcaQr!.base64);
  // the QR as printed: the PDF page at 300 dpi, read back with jsQR
  const { execFileSync } = await import("node:child_process");
  const jsQR = (await import("jsqr")).default as any;
  const { PNG } = await import("pngjs");
  const pdfPath = new URL(`invoice-${inv.x_invoice_number}.pdf`, OUT).pathname;
  const pngBase = new URL(`invoice-${inv.x_invoice_number}-p1`, OUT).pathname;
  execFileSync("pdftoppm", ["-r", "300", "-png", "-f", "1", "-l", "1", "-singlefile", pdfPath, pngBase]);
  const png = PNG.sync.read(readFileSync(`${pngBase}.png`));
  const scanned = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
  check("QR read from the printed page (300 dpi) = the encoded TLV (Base64)", scanned === data!.zatcaQr!.base64, String(scanned).slice(0, 80));
  qrs.push({ invoice: inv.x_invoice_number, scannedFromPdf: scanned === data!.zatcaQr!.base64, ...qr });
  check("QR: اسم البائع", qr?.sellerName === "شركة يوتاك ذات مسؤولية محدودة", JSON.stringify(qr));
  check("QR: الرقم الضريبي", qr?.vatNumber === "315022736600003");
  check("QR: وقت الإصدار 2026-10-01T05:30:00", qr?.timestamp === "2026-10-01T05:30:00", qr?.timestamp);
  check("QR: الإجمالي 190.00 والضريبة 24.78", qr?.total === "190.00" && qr?.vatTotal === "24.78");
  check("الإجمالي الشامل = سعر السوق × الكمية − الخصم (19 × 10 − 0)", inv.x_total === 19 * 10);
});
let tax1001b: any = null;
await step("«تم التسليم» بقالة الريان ← فاتورة ضريبية ثانية", "05:50", async () => {
  await tap(TEAM.omar, `delivered_${c2Order0930}`, "تم التسليم ✅");
  const inv = await invoiceOfOrder(c2Order0930);
  tax1001b = inv;
  invoices.push({ customer: C.c2.name, ...inv });
  check("183 شامل = 159.13 صافٍ + 23.87 ضريبة، تاريخها 10-01، مرسلة", inv?.x_total === 183 && inv?.x_tax_amount === 23.87 && inv?.x_subtotal === 159.13 && !!inv?.x_invoice_sent_at, JSON.stringify(inv));
});
await step("النشر 06:00 (10-01) وفتح الطلبات", "06:00", async () => {
  await tick(); await cron(worker, env, "0 3 * * *");
  check("10-01 منشور", (await dayRecord(curDay))?.x_state === "published");
  await tapTpl(TEAM.owner, "shift_start", "بدء الدوام");
  await tapTpl(TEAM.othman, "shift_start", "بدء الدوام");
});
let c5Order = 0, c2Order1001 = 0;
await step("08:00 رسائل المتابعة (تذكير الدفع لمتبقي 09-28)", "07:59", async () => { await cron(worker, env, "0 5 * * *"); });
await step("رقم جديد (مطبخ السنبلة) ← مراجعة ← عميل ← طلب ≥ 150", "08:00", async () => {
  await say(C.c5.phone, "مرحبا");
  check("براء: «رقم جديد ينتظر المراجعة»", anyText(msgsTo(TEAM.owner), /رقم جديد ينتظر المراجعة/));
  const p = await partnerByPhone(C.c5.phone);
  await call(env, "res.partner", "write", { ids: [p.id], vals: { x_contact_class: "customer", x_review_pending: false } });
  await say(C.c5.phone, "افوكادو 3");
  await say(C.c5.phone, "خلاص");
  if (anyText(allTo(C.c5.phone).slice(-3) as any, /أرسل موقع التوصيل/)) await shareLocation(C.c5.phone, "النرجس");
  const [o] = await ordersOf(p.id);
  c5Order = o?.id ?? 0;
  const q = allTo(C.c5.phone).filter((m) => buttonIds(m).includes(`confirm_order_${c5Order}`)).pop();
  check("الكوتيشن يذكر «الأسعار شاملة ضريبة القيمة المضافة.»", !!q && /الأسعار شاملة ضريبة القيمة المضافة/.test(q.text), JSON.stringify(q?.text));
  await tap(C.c5.phone, `confirm_order_${c5Order}`, "تأكيد الطلب ✅");
  check("مؤكد (3 × 62.5 = 187.5)", (await ordersOf(p.id))[0]?.x_state === "confirmed");
});
await step("بقالة الريان < 150 ثم تُكمل وتؤكد", "10:00", async () => {
  const p = await partnerByPhone(C.c2.phone);
  await say(C.c2.phone, "رمان صغير 5");
  await say(C.c2.phone, "خلاص");
  check("«أقل طلب 150 ريال» (65)", anyText(msgsTo(C.c2.phone), /أقل طلب 150 ريال/));
  await say(C.c2.phone, "رمان وسط 5");
  await say(C.c2.phone, "خلاص");
  const o = (await ordersOf(p.id)).filter((x) => x.x_order_date === curDay).pop();
  c2Order1001 = o?.id ?? 0;
  await tap(C.c2.phone, `confirm_order_${c2Order1001}`, "تأكيد الطلب ✅");
  check("مؤكد (5 × 13 + 5 × 20 = 165)", (await ordersOf(p.id)).find((x) => x.id === c2Order1001)?.x_state === "confirmed");
});
await step("12:00: قائمة 09-30 مؤكدة بلا فاتورة شراء ← سطر لبراء", "12:00", async () => {
  await tick();
  check("براء: «… مؤكدة بلا فاتورة شراء ضريبية مرفقة حتى 12:00»", anyText(msgsTo(TEAM.owner), /بلا فاتورة شراء ضريبية/), JSON.stringify(msgsTo(TEAM.owner)));
  at(`${curDay} 12:05`); await tick();
  check("مرة واحدة", allTo(TEAM.owner).filter((m) => /بلا فاتورة شراء ضريبية/.test(m.text)).length === 1);
});
await step("تحصيل كامل نقداً (مطعم الواحة، الفاتورة الضريبية)", "13:00", async () => {
  await tapTpl(TEAM.omar, `collect_cash_${tax1001.id}`, "نقد 💵");
  await tap(TEAM.omar, lastChoice(TEAM.omar, "full"), "المبلغ كامل");
  const [pay] = await sr<any>("x_payment", [["x_invoice_id", "=", tax1001.id]], ["id", "x_amount"], { order: "id desc", limit: 1 });
  await internal(worker, env, "/internal/receipt-issue", { _model: "x_payment", _id: pay?.id });
  check("190 نقداً، مدفوعة", pay?.x_amount === 190 && (await invoiceOfOrder(c1Order0930))?.x_status === "paid", JSON.stringify(pay));
  payments.push({ invoice: tax1001.x_invoice_number, amount: pay?.x_amount, method: "cash", at: nowRiyadh() });
});
await step("تحصيل جزئي تحويلاً (بقالة الريان، الفاتورة الضريبية) ← الإيصال والمتبقي 83", "13:20", async () => {
  // § 42 ب — «تحويل» ← «مبلغ آخر» ← «100»
  await tapTpl(TEAM.omar, `collect_transfer_${tax1001b.id}`, "تحويل 🏦");
  await tap(TEAM.omar, lastChoice(TEAM.omar, "other"), "مبلغ آخر");
  await say(TEAM.omar, "100");
  const [p100] = await sr<any>("x_payment", [["x_invoice_id", "=", tax1001b.id]], ["id", "x_amount"], { order: "id desc", limit: 1 });
  const r = { paymentId: p100?.id ?? null, fullyPaid: (await invoiceOfOrder(c2Order0930))?.x_status === "paid", amount: p100?.x_amount };
  payments.push({ invoice: tax1001b.x_invoice_number, amount: 100, method: "transfer", at: nowRiyadh() });
  await internal(worker, env, "/internal/receipt-issue", { _model: "x_payment", _id: r.paymentId });
  check("دفعة 100، والفاتورة باقية «صادرة» (83 متبقٍ)", !!r.paymentId && !r.fullyPaid && (await invoiceOfOrder(c2Order0930))?.x_status === "issued", JSON.stringify(r));
  check("بقالة الريان: تأكيد الدفعة (نصاً بالمتبقي أو القالب)", msgsTo(C.c2.phone).some((m) => /المتبقي على الفاتورة: 83/.test(m.text) || m.template === "utak_payment_received"), JSON.stringify(msgsTo(C.c2.phone)));
});
await step("م12: 11:30 و12:30 بلا محطة باقية ← صمت", "12:40", async () => {
  at(`${curDay} 11:32`); await driverTick();
  at(`${curDay} 12:32`); await driverTick();
  check("لا تذكير لعمر ولا تنبيه لبراء (كل المحطات سُلّمت)", !anyText(msgsTo(TEAM.omar), /باقي 30 دقيقة/) && !anyText(msgsTo(TEAM.owner), /انتهى دوامه/), JSON.stringify(cur().map((m) => [who(m.to), m.text.slice(0, 60)])));
});
await step("مخبز الندى: كوتيشن بلا تأكيد ← 20:00 ← 21:00", "17:00", async () => {
  await say(C.c3.phone, "رمان كبير 7");
  await say(C.c3.phone, "خلاص");
  at(`${curDay} 20:00`); await cron(worker, env, "0 17 * * *");
  at(`${curDay} 21:00`); await cron(worker, env, "0 18 * * *");
  const p = await partnerByPhone(C.c3.phone);
  check("أُلغي عند الإقفال", (await ordersOf(p.id)).filter((x) => x.x_order_date === curDay).pop()?.x_state === "cancelled");
});
await step("طلب بعد 21:00 ← للغد (الجمعة)", "21:10", async () => {
  const p = await partnerByPhone(C.c5.phone);
  await say(C.c5.phone, "افوكادو 2");
  await tap(C.c5.phone, `late_yes_${p.id}`, "سجّله لبكرة");
  const late = (await ordersOf(p.id)).find((o) => o.x_order_date === "2026-10-02");
  check("طلب مسجّل ليوم 10-02", !!late, JSON.stringify(await ordersOf(p.id)));
});
await step("قائمة 21:15 (الجمعة راحة عمر ← السبت)", "21:15", async () => {
  await cron(worker, env, "15 18 * * *");
  check("لا قائمة لعمر الآن (محفوظة لدوامه التالي)، ولبراء السبب", !msgsTo(TEAM.omar).some((m) => /قائمة الشراء/.test(m.text)), JSON.stringify(cur().map((m) => [who(m.to), m.text.slice(0, 80)])));
});
await step("ملخص 21:30 بسطر التغطية", "21:30", async () => {
  await cron(worker, env, "30 18 * * *");
  const m = msgsTo(TEAM.owner).find((x) => /ملخص اليوم/.test(x.text) || x.template === "utak_v2_summary");
  summaries[curDay] = m?.text;
  at(`${curDay} 21:30`);
  const f = await SUM.readSummaryFigures(env);
  check("التوصيلات 2 من 2 (طلبا 09-30)، المحصَّل 290 (190 + 100)، المعلَّق 148 (65 + 83)", f.deliveries?.delivered === 2 && f.deliveries?.total === 2 && f.collected === 290 && f.pending === 148, JSON.stringify(f));
  check("التغطية: ربح (10 × (19 − 15 − 0.75) + 3 × (61 − 50 − 2.5)) ÷ 1.15 = 50.43 من 500 = 10%", f.coverage.profit === 50.43 && f.coverage.cost === 500 && f.coverage.pct === 10, JSON.stringify(f.coverage));
  check("السطر الرابع في الرسالة", !!m && /تغطية تكاليف اليوم: 10% \(ربح 50.43 من 500.00\)/.test(m.text), m?.text);
});

// ---------------------------------------------------------------- the purchase lists («تم الشراء») for the accounting table
const purchaseLists: Array<{ id: number; date: string; billDate: string; total: number; net: number; vat: number; supplierVat: boolean }> = [];
for (const [id, billDate] of [[list0927, "2026-09-28"], [list0930, "2026-10-01"]] as Array<[number, string]>) {
  if (!id) continue;
  const [l] = await call<any[]>(env, "x_purchase_list", "read", { ids: [id], fields: ["id", "x_date", "x_aggregated_items", "x_supplier_id"] });
  const items = JSON.parse(String(l?.x_aggregated_items || "[]")) as any[];
  const total = Math.round(items.reduce((a, it) => a + (Number(it.unit_price ?? it.price_sar ?? 0) || 0) * (Number(it.total_quantity ?? it.quantity ?? 0) || 0), 0) * 100) / 100;
  const sup = m2o(l?.x_supplier_id);
  const [p] = sup ? await call<any[]>(env, "res.partner", "read", { ids: [sup], fields: ["vat"] }) : [];
  const supplierVat = typeof p?.vat === "string" && !!p.vat.trim();
  const vat = billDate >= "2026-10-01" && supplierVat ? Math.round(total * 15 / 115 * 100) / 100 : 0;
  purchaseLists.push({ id, date: String(l?.x_date), billDate, total, net: Math.round((total - vat) * 100) / 100, vat, supplierVat });
}

// ---------------------------------------------------------------- the report
const ok = checks.filter((c) => c.ok).length;
const report = {
  run: RUN, mode: MODE, at: new Date(realNow()).toISOString(),
  checks: { ok, total: checks.length, failed: checks.filter((c) => !c.ok) },
  allChecks: checks,
  steps, invoices, payments, purchaseLists, qrs, summaries,
  network: Object.entries(netLog.reduce((a: Record<string, number>, n) => { a[`${n.host} ${n.method}`] = (a[`${n.host} ${n.method}`] ?? 0) + 1; return a; }, {})),
  capturedCount: captured.length,
  odoo: odooStats,
  created: created.reduce((a: Record<string, number>, c) => { a[c.model] = (a[c.model] ?? 0) + c.ids.length; return a; }, {}),
};
writeFileSync(new URL("report.json", OUT), JSON.stringify(report, null, 1));
writeFileSync(new URL("captured.json", OUT), JSON.stringify(captured, null, 1));
writeFileSync(new URL("created.json", OUT), JSON.stringify({ run: RUN, mode: MODE, created, writes }, null, 1));
console.log(`\n${ok}/${checks.length} checks · ${captured.length} messages captured (none sent) · Odoo creates: ${JSON.stringify(report.created)}`);
console.log(`out: ${OUT.pathname}`);
try { (await import("node:child_process")).execFileSync("node", [new URL("./s41-sim-report.mjs", import.meta.url).pathname, RUN], { stdio: "inherit" }); } catch (e) { console.log("report.md failed", (e as Error).message); }
if (ok !== checks.length) process.exit(1);
