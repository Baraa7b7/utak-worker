// sim محاكاة خالصة (2026-09-25، STATUS § 27).
//
//   1. wrangler.toml: ACCOUNTING_SYNC = "false" في [env.sim.vars] وحدها، وSIM_ALLOWLIST
//      أرقام الفريق الأربعة كاملة بلا بادئة.
//   2. بالقيمة المنشورة نفسها: «تأكيد الطلب» و«تم التسليم» و«تم الشراء» والتحصيل
//      و«إلغاء» لا تمس account.move ولا sale.order ولا purchase.order ولا الدفعات
//      (ولا حتى قراءة). والتشغيل نفسه بـ "true" يمسها، فالمفتاح هو المانع لا الـ harness.
//   3. القائمة: رقم الفريق يُرسل إليه، والعميل يُحجب حتى بـ x_manual، والإرسال
//      المباشر لتنبيه التوقيع (خارج fetchMeta) يحترم القائمة على sim.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/sim-pure.test.mts

import { readFileSync } from "node:fs";
import {
  COLL, CUST, CUST_PHONE, WH, ctx, graph, odooLog, openWindow, order, partnerOf, quiet, reset, rows, seed, setRiyadh, table,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- wrangler.toml
const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const section = (head: string, next: string) => toml.slice(toml.indexOf(head), toml.indexOf(next, toml.indexOf(head) + head.length));
const simVars = section("[env.sim.vars]", "[[env.sim.kv_namespaces]]");
const topVars = section("[vars]", "[[kv_namespaces]]");
const pilotVars = section("[env.pilot.vars]", "[[env.pilot.kv_namespaces]]");
const tomlVar = (block: string, k: string) => (new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(block) ?? [])[1];

const TEAM: Record<string, string> = {
  "+966505154962": "براء", "+966571777704": "أحمد حسان",
  "+966530399474": "عثمان عبدالوهاب", "+966545816832": "عمر المجهلي",
};
const SIM_ACCOUNTING = tomlVar(simVars, "ACCOUNTING_SYNC");
const SIM_ALLOWLIST = tomlVar(simVars, "SIM_ALLOWLIST") ?? "";

console.log("\n[1] wrangler.toml");
{
  assert(`env.sim ACCOUNTING_SYNC = "false"`, SIM_ACCOUNTING === "false", String(SIM_ACCOUNTING));
  assert("prod [vars] has no ACCOUNTING_SYNC (untouched)", tomlVar(topVars, "ACCOUNTING_SYNC") === undefined);
  assert("pilot has no ACCOUNTING_SYNC (untouched)", tomlVar(pilotVars, "ACCOUNTING_SYNC") === undefined);
  const entries = SIM_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean);
  assert("SIM_ALLOWLIST = the four team numbers exactly", entries.length === 4 && entries.every((e) => TEAM[e]) && new Set(entries).size === 4, SIM_ALLOWLIST);
  assert("no prefix entry: every entry is a full +966 number (12 digits)", entries.every((e) => /^\+9665\d{8}$/.test(e)), SIM_ALLOWLIST);
  assert("OWNER_WHATSAPP is in the list", entries.includes(tomlVar(simVars, "OWNER_WHATSAPP") ?? "?"));
  assert("prod crons stay []", /^\[triggers\]\s*\ncrons = \[\]/m.test(toml));
}

// ---------------------------------------------------------------- accounting
const ACCT = new Set([
  "account.move", "account.move.line", "account.payment", "account.payment.register",
  "sale.order", "sale.order.line", "sale.advance.payment.inv", "purchase.order", "purchase.order.line",
]);
const acctCalls = () => odooLog.filter((c) => ACCT.has(c.model));
const acctWrites = () => acctCalls().filter((c) => !["search_read", "read", "search", "search_count", "fields_get"].includes(c.method));
const created = (m: string) => odooLog.some((c) => c.model === m && c.method === "create");

const { dispatch } = await import("../src/router.ts");
const tap = (env: any, buttonId: string, who: number) =>
  quiet(() => dispatch(env, {
    msg: { messageId: `w${Math.random()}`, from: "+x", fromRaw: "x", profileName: "", text: "", timestamp: "", type: "button", buttonId },
    intent: "other", senderType: "customer", partner: partnerOf(who),
  }));

function world(flag: string): any {
  const env = reset();
  env.ACCOUNTING_SYNC = flag;
  seed("product.product", { id: 801, default_code: "UTAK-SALE-GOODS", type: "service", name: "بضاعة مباعة" });
  seed("product.product", { id: 802, default_code: "UTAK-PUR-GOODS", type: "service", name: "بضاعة مشتراة" });
  // After 10-01 the x_invoice itself needs the company sale tax (15% included).
  seed("res.company", { id: 1, account_sale_tax_id: [5, "ضريبة 15%"], account_purchase_tax_id: false });
  seed("account.tax", { id: 5, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("account.journal", { id: 61, code: "CSHD", name: "نقد" });
  seed("account.journal", { id: 62, code: "BNK1", name: "بنك" });
  return env;
}

type Flow = { name: string; run: (env: any) => Promise<unknown>; onCreates?: string };
const FLOWS: Flow[] = [
  {
    name: "«تأكيد الطلب» confirm_order_",
    onCreates: "sale.order",
    run: async (env) => {
      setRiyadh("2026-09-25 10:00");
      const o = order(CUST, "waiting_confirmation", "2026-09-25");
      return tap(env, `confirm_order_${o}`, CUST);
    },
  },
  {
    name: "«تم التسليم» delivered_",
    onCreates: "sale.order",
    run: async (env) => {
      setRiyadh("2026-10-02 11:00"); // after the VAT cutoff: the case § 23 أ is about
      const o = order(CUST, "in_delivery", "2026-10-02");
      seed("x_delivery_stop", { x_order_id: o, x_status: "pending" });
      return tap(env, `delivered_${o}`, COLL);
    },
  },
  {
    name: "«تم الشراء» purchase_done_",
    onCreates: "purchase.order",
    run: async (env) => {
      setRiyadh("2026-10-02 23:00");
      const sup = seed("res.partner", { name: "مورد", supplier_rank: 1, vat: false });
      const list = seed("x_purchase_list", {
        x_status: "sent", x_date: "2026-10-02", x_supplier_id: sup,
        x_aggregated_items: JSON.stringify([{ product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 3, order_ids: [], unit_price: 20 }]),
      });
      return tap(env, `purchase_done_${list}`, WH);
    },
  },
  {
    name: "التحصيل collect_cash_",
    onCreates: "account.payment.register",
    run: async (env) => {
      setRiyadh("2026-10-02 15:00");
      const o = order(CUST, "delivered", "2026-10-02");
      const move = seed("account.move", { name: "INV/2026/10/0001", state: "posted", move_type: "out_invoice", amount_total: 60, amount_residual: 60, commercial_partner_id: [CUST, "مطعم الوادي"], payment_state: "not_paid" });
      const inv = seed("x_invoice", { x_invoice_number: "UTAK-INV-1", x_total: 60, x_status: "issued", x_order_id: o, x_customer_id: CUST, x_account_move_id: move });
      return tap(env, `collect_cash_${inv}`, COLL);
    },
  },
  {
    name: "«إلغاء» cancel_order_ (sale.order linked)",
    run: async (env) => {
      setRiyadh("2026-09-25 10:00");
      const so = seed("sale.order", { name: "S00099", state: "sale" });
      const o = order(CUST, "confirmed", "2026-09-25", 1, { x_sale_order_id: so });
      odooLog.length = 0; // the seed above is not a call
      return tap(env, `cancel_order_${o}`, CUST);
    },
  },
];

console.log(`\n[2] ACCOUNTING_SYNC="${SIM_ACCOUNTING}" (the deployed sim value) — no accounting call from any button`);
for (const f of FLOWS) {
  const env = world(SIM_ACCOUNTING!);
  const reply = await f.run(env);
  assert(`${f.name}: 0 calls to account.* / sale.* / purchase.*`, acctCalls().length === 0,
    acctCalls().map((c) => `${c.model}.${c.method}`).join(", "));
  assert(`${f.name}: the button still answers`, String((reply as any)?.text ?? "").length > 0);
}
{
  // What the off path still does (x_invoice / x_payment issue as before).
  const env = world(SIM_ACCOUNTING!);
  await FLOWS[1].run(env);
  assert("off: «تم التسليم» still issues the x_invoice", rows("x_invoice").length === 1);
  const env2 = world(SIM_ACCOUNTING!);
  await FLOWS[3].run(env2);
  assert("off: collection still records the x_payment", rows("x_payment").length === 1);
}

console.log(`\n[2b] control: the same taps with ACCOUNTING_SYNC="true" do reach accounting (so [2] is the switch, not the harness)`);
for (const f of FLOWS) {
  const env = world("true");
  await f.run(env);
  assert(`${f.name}: on → accounting touched`, acctWrites().length > 0 || acctCalls().length > 0, "no accounting call");
  if (f.onCreates) assert(`${f.name}: on → ${f.onCreates}.create`, created(f.onCreates), acctCalls().map((c) => `${c.model}.${c.method}`).join(", "));
}
{
  const env = world("true");
  await FLOWS[4].run(env);
  assert("«إلغاء»: on → sale.order.action_cancel", odooLog.some((c) => c.model === "sale.order" && c.method === "action_cancel"));
}

// ---------------------------------------------------------------- allowlist
console.log("\n[3] SIM_ALLOWLIST (deployed value) + x_wa_allowed");
const { sendText } = await import("../src/meta.ts");
const { handleWaMessageWebhook } = await import("../src/wa-message-send.ts");
const { handleSignatureFailure } = await import("../src/webhook-alert.ts");
const simEnv = () => {
  const env = reset();
  env.SIM_ALLOWLIST = SIM_ALLOWLIST;
  env.OWNER_WHATSAPP = tomlVar(simVars, "OWNER_WHATSAPP");
  env.PILOT_MODE = tomlVar(simVars, "PILOT_MODE");
  env.SIMULATION_MODE = tomlVar(simVars, "SIMULATION_MODE");
  env.ACCOUNTING_SYNC = SIM_ACCOUNTING;
  return env;
};
{
  const env = simEnv();
  // STATUS § 33 — a session text needs the number's 24h window (the gateway
  // holds it otherwise): each number wrote a minute ago.
  for (const num of Object.keys(TEAM)) openWindow(env, num);
  for (const [num, who] of Object.entries(TEAM)) {
    graph.length = 0;
    const r = await quiet(() => sendText(env, num, "اختبار", { purpose: who === "براء" ? "owner_alert" : "team_task" }));
    assert(`team ${who} (…${num.slice(-4)}): sent`, r.ok && graph.length === 1, String(r.status));
  }
  graph.length = 0;
  const r = await quiet(() => sendText(env, "+" + CUST_PHONE, "اختبار", { purpose: "bot_reply" }));
  assert("customer (partner x_wa_allowed unset): blocked 403 AllowlistBlocked, nothing to Graph", r.status === 403 && graph.length === 0 && (await r.text()).includes("AllowlistBlocked"));
  table("res.partner").get(CUST)!.x_wa_allowed = false;
  await env.MSG_DEDUP.delete("wa_allowed:+" + CUST_PHONE);
  const r2 = await quiet(() => sendText(env, "+" + CUST_PHONE, "اختبار", { purpose: "bot_reply" }));
  assert("customer with x_wa_allowed=false: blocked", r2.status === 403 && graph.length === 0);
  const old = { ...env, SIM_ALLOWLIST: "+966505154962,+966536251307,+966571777704" };
  const r3 = await quiet(() => sendText(old, "+966536251307", "اختبار", { purpose: "bot_reply" }));
  const r4 = await quiet(() => sendText(env, "+966536251307", "اختبار", { purpose: "bot_reply" }));
  assert("removed entry +966536251307: allowed by the old list, blocked by the new", r3.ok && r4.status === 403);
}
{
  const env = simEnv();
  graph.length = 0;
  const wa = seed("x_wa_message", { x_status: "queued", x_partner_id: CUST, x_kind: "text", x_body: "يدوي", x_manual: true, x_dry_run: false });
  const res = await quiet(() => handleWaMessageWebhook(env, wa, ctx));
  assert("x_manual from Odoo to a customer: still blocked by the send gateway (no Graph)", graph.length === 0 && table("x_wa_message").get(wa)!.x_status === "failed", JSON.stringify(res));
}
{
  // The signature-failure alert: its direct Graph fallback is gone (STATUS
  // § 33) — it goes through the gateway, allowlist first, like any send.
  const env = simEnv();
  env.OWNER_WHATSAPP = "+966500000777"; // an owner number the list does not carry
  graph.length = 0;
  await quiet(() => handleSignatureFailure(env, { rawBodyLength: 10, signatureHeader: "sha256=abc" }));
  assert("sig-fail direct fallback: owner outside SIM_ALLOWLIST on sim → no Graph POST", graph.length === 0, String(graph.length));
  const env2 = simEnv();
  openWindow(env2, env2.OWNER_WHATSAPP); // STATUS § 33 — inside his window: text
  graph.length = 0;
  await quiet(() => handleSignatureFailure(env2, { rawBodyLength: 10, signatureHeader: "sha256=abc" }));
  assert("sig-fail alert to the real owner (in the list): one send", graph.length === 1, String(graph.length));
  const prod: any = { ...simEnv(), PILOT_MODE: "false", SIM_ALLOWLIST: "", OWNER_WHATSAPP: "+966500000777" };
  delete prod.PILOT_MODE;
  openWindow(prod, "966500000777");
  graph.length = 0;
  await quiet(() => handleSignatureFailure(prod, { rawBodyLength: 10, signatureHeader: "sha256=abc" }));
  assert("prod (no test mode) unchanged: alert still sent", graph.length === 1, String(graph.length));
}

console.log(`\n${passed} ✓  ${failed} ✗`);
if (failed) { console.log("failures:\n  " + failures.join("\n  ")); process.exit(1); }
