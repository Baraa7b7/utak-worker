// WA-SCENARIOS — important gaps, batch 4 (م10), 2026-09-26 (STATUS § 39 د).
//
//   م10  the payment confirmation to the customer — one message per x_payment,
//        through the gateway under customer_payment_received: inside the
//        customer's window the receipt as text (the template's words, then the
//        remaining on a partial payment, the receipt number, method and link),
//        outside it utak_payment_received [amount, invoice number]; nothing for
//        a payment / invoice / order marked x_utak_simulation; nothing to a
//        customer held for the number review (as م8); never twice (a KV claim
//        per payment, then the x_wa_message rows linked to the payment); the
//        collection button sends nothing of its own (the receipt is the one
//        message); /internal/receipt-issue, /admin/test-receipt and the */5
//        net for a lost webhook all go through the same confirmation.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind a strict schema
// gate built from the real field lists (fields_get on the tenant, the last one
// tests/fixtures-odoo-fields-20260926-s39.json: x_utak_simulation on the
// payment / invoice / order / route / stop, and x_wa_message x_res_model /
// x_res_id): an unknown field, or a selection value the field does not have, is
// answered the way Odoo answers it (HTTP 500). Gotenberg and R2 are stubs here.
// No network, no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-important-b4.test.mts

import { readFileSync, readdirSync } from "node:fs";
import {
  COLL_PHONE, CUST, CUST_PHONE, closeOwnerWindow, ctx as harnessCtx, graph, heldFor, inbound, openWindow, order, quiet, reset, rows, seed, sentTo,
  setRiyadh, signed, table,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const FIX = [
  "fixtures-odoo-fields-20260924.json",            // x_invoice, x_payment, x_daily_order, res.partner
  "fixtures-odoo-fields-20260925-review.json",     // res.partner review fields
  "fixtures-odoo-fields-20260925-team.json",       // hr.employee, resource.calendar*, x_employee_role
  "fixtures-odoo-fields-20260925-gateway.json",    // x_wa_message.x_status held / expired / skipped
  "fixtures-odoo-fields-20260925-s36.json",        // x_wa_message echo fields, template text
  "fixtures-odoo-fields-20260926-b3.json",         // § 38: x_utak_simulation on the order / invoice / payment
  "fixtures-odoo-fields-20260926-s39.json",        // § 39: … on the route / stop; x_wa_message x_res_model / x_res_id
  "fixtures-odoo-fields-20260926-s41.json",        // § 41: x_utak_simulation on the per-day models
].map((f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")));
const REAL: Record<string, string[]> = Object.assign({}, ...FIX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FIX.map((f) => f._selections ?? {}));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}
const harnessFetch = globalThis.fetch;
let gotenbergCalls = 0;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.startsWith("https://gotenberg.test/")) {
    gotenbergCalls++;
    return new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]), { status: 200, headers: { "Content-Type": "application/pdf" } });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body && typeof init.body === "string") {
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
      const message = bad.length ? `Invalid field '${bad[0]}' on '${m[1]}'` : `Wrong value for ${badSel[0]}`;
      return new Response(JSON.stringify({ name: "builtins.ValueError", message, arguments: [message] }), { status: 500 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const { setOdooRetryHooksForTests } = await import("../src/odoo.ts");
setOdooRetryHooksForTests({ sleep: async () => {}, alert: async () => {} });
const { clearTemplateCache } = await import("../src/templates.ts");
const pc = await import("../src/payment-confirm.ts");
const { CRON_JOB } = await import("../src/auto-send-guard.ts");
const worker = (await import("../src/index.ts")).default;

// ---------------------------------------------------------------- data
const DAY = "2026-09-26";
const INV_NO = "UTAK-INV-20260926-001";
const RECEIPT = { number: "UTAK-R-20260926-041", url: "https://w.test/receipt-pdf/UTAK-R-20260926-041/tok.pdf", method: "نقد" };
const REV = 714, REV_PHONE = "966500000714";
/** A ctx whose waitUntil work the test can await (the harness one drops it). */
function liveCtx() {
  const pending: Array<Promise<unknown>> = [];
  return { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => {}, flush: async () => { while (pending.length) await pending.shift(); } } as any;
}
function fresh(riyadh = `${DAY} 16:00`): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0; gotenbergCalls = 0;
  seed("res.partner", { id: 42, name: "UTAK بوت" });
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  // as on the tenant (#56) and at Meta (GET, scripts/s39-20260926-meta-payment-received.mjs)
  seed("x_whatsapp_template", {
    x_purpose: "customer_payment_received", x_meta_template_id: "utak_payment_received", x_language: "ar", x_meta_status: "APPROVED",
    x_param_count: 2, x_category: "UTILITY", x_body_text: "استلمنا دفعتك بمبلغ {{1}} ريال على فاتورة {{2}}. شكراً لك",
  });
  Object.assign(env, {
    GOTENBERG_URL: "https://gotenberg.test", GOTENBERG_USER: "u", GOTENBERG_PASSWORD: "p",
    ADMIN_TOKEN: "ADM", INTERNAL_WEBHOOK_SECRET: "HOOK",
    INVOICES_BUCKET: { put: async () => ({}), get: async () => null },
  });
  return env;
}
/** An order of the customer, delivered, and its issued invoice. */
function invoice(total = 100, o: { customer?: number; number?: string; orderExtra?: Record<string, unknown>; extra?: Record<string, unknown> } = {}): number {
  const ord = order(o.customer ?? CUST, "delivered", DAY, 1, o.orderExtra ?? {});
  return seed("x_invoice", { x_invoice_number: o.number ?? INV_NO, x_total: total, x_status: "issued", x_order_id: ord, x_invoice_date: DAY, ...(o.extra ?? {}) });
}
/** A payment on the invoice (created now, unless `created` — Odoo UTC). */
function payment(inv: number, amount: number, extra: Record<string, unknown> = {}): number {
  const now = new Date(Date.now()).toISOString().replace("T", " ").slice(0, 19);
  return seed("x_payment", { x_invoice_id: inv, x_amount: amount, x_method: "cash", x_collected_at: now, create_date: now, ...extra });
}
const confirm = (env: any, pid: number, receipt: Record<string, string> | undefined = RECEIPT) => quiet(() => pc.confirmPaymentToCustomer(env, pid, { receipt }));
const tpl = (digits: string, name = "utak_payment_received") => sentTo(digits).filter((b) => b?.type === "template" && b.template?.name === name);
const texts = (digits: string) => sentTo(digits).filter((b) => b?.type === "text").map((b) => String(b.text?.body ?? ""));
const params = (b: any): string[] => (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
const outRows = (pid: number) => rows("x_wa_message").filter((r: any) => r.x_direction === "out" && r.x_res_model === "x_payment" && r.x_res_id === pid);

// ================================================================ م10
console.log("\n[م10] outside the customer's window: utak_payment_received [amount, invoice number]");
{
  const env = fresh();
  const inv = invoice(100);
  const pid = payment(inv, 100);
  const c = await confirm(env, pid);
  const t = tpl(CUST_PHONE);
  assert("new: one utak_payment_received to the customer", c.action === "sent" && t.length === 1 && sentTo(CUST_PHONE).length === 1, JSON.stringify(c));
  assert("…[amount, invoice number], one line each", params(t[0]).join("|") === `100|${INV_NO}`, JSON.stringify(params(t[0])));
  const r = outRows(pid);
  assert("new: its x_wa_message row is the gateway's, purpose customer_payment_received, linked to the payment (x_res_model / x_res_id)",
    r.length === 1 && String(r[0].x_debug_payload).includes('"purpose":"customer_payment_received"') && r[0].x_status === "sent", JSON.stringify(r));
  assert("…the row carries the template's full text", String(r[0]?.x_body ?? "").startsWith(`استلمنا دفعتك بمبلغ 100 ريال على فاتورة ${INV_NO}`), r[0]?.x_body);
}

console.log("\n[م10] inside the window: the receipt as text");
{
  const env = fresh();
  openWindow(env, CUST_PHONE, 5);
  const pid = payment(invoice(100), 100);
  const c = await confirm(env, pid);
  const t = texts(CUST_PHONE);
  assert("new: one text, no template", c.action === "sent" && t.length === 1 && tpl(CUST_PHONE).length === 0, JSON.stringify(sentTo(CUST_PHONE)));
  assert("…the template's words first", t[0]?.startsWith(`✅ استلمنا دفعتك بمبلغ 100 ريال على فاتورة ${INV_NO}. شكراً لك`), t[0]);
  assert("…the receipt number, the method and its link", t[0]?.includes(RECEIPT.number) && t[0]?.includes("طريقة الدفع: نقد") && t[0]?.includes(RECEIPT.url), t[0]);
  assert("…paid in full: no «المتبقي»", !t[0]?.includes("المتبقي"), t[0]);
  assert("…its row: purpose customer_payment_received, linked", outRows(pid).length === 1 && String(outRows(pid)[0].x_debug_payload).includes("customer_payment_received"));
}

console.log("\n[م10] a partial payment: the text says what is left; the template keeps its two variables");
{
  const env = fresh();
  openWindow(env, CUST_PHONE, 5);
  const inv = invoice(100);
  const p1 = payment(inv, 60);
  await confirm(env, p1);
  assert("new: 60 of 100 → «المتبقي على الفاتورة: 40 ريال»", (texts(CUST_PHONE)[0] ?? "").includes("المتبقي على الفاتورة: 40 ريال"), texts(CUST_PHONE)[0]);
  const p2 = payment(inv, 40);
  await confirm(env, p2);
  assert("the payment that completes it: no «المتبقي»", texts(CUST_PHONE).length === 2 && !texts(CUST_PHONE)[1].includes("المتبقي"), texts(CUST_PHONE)[1]);

  const env2 = fresh();
  const inv2 = invoice(100);
  const q1 = payment(inv2, 60);
  const q2 = payment(inv2, 40);
  openWindow(env2, CUST_PHONE, 5);
  await confirm(env2, q1);
  assert("…counted up to this payment: confirmed after the second exists, still «40»", (texts(CUST_PHONE)[0] ?? "").includes("المتبقي على الفاتورة: 40 ريال"), texts(CUST_PHONE)[0]);
  void q2;

  const env3 = fresh();
  const inv3 = invoice(100);
  const s0 = payment(inv3, 30, { x_utak_simulation: true });
  void s0;
  const r1 = payment(inv3, 60.5);
  openWindow(env3, CUST_PHONE, 5);
  await confirm(env3, r1);
  const t3 = texts(CUST_PHONE)[0] ?? "";
  assert("…halalas «60.50», and a simulation payment on the invoice is not counted: «39.50» left", t3.includes("بمبلغ 60.50 ريال") && t3.includes("المتبقي على الفاتورة: 39.50 ريال"), t3);

  const env4 = fresh();
  const inv4 = invoice(100);
  const w1 = payment(inv4, 60);
  await confirm(env4, w1);
  const t4 = tpl(CUST_PHONE);
  assert("outside the window, partial: the template, [60, invoice] — no third variable", t4.length === 1 && params(t4[0]).join("|") === `60|${INV_NO}`, JSON.stringify(params(t4[0])));
}

console.log("\n[م10] one message per payment: KV claim, then the rows linked to the payment");
{
  const env = fresh();
  const pid = payment(invoice(100), 100);
  await confirm(env, pid);
  const again = await confirm(env, pid);
  assert("new: a second call for the same payment → «claimed», nothing sent", again.action === "claimed" && sentTo(CUST_PHONE).length === 1, JSON.stringify(again));
  assert("…the claim in KV", env.MSG_DEDUP.store.has(`btnlock:v1:payconf:${pid}`));
  env.MSG_DEDUP.store.delete(`btnlock:v1:payconf:${pid}`);
  const lost = await confirm(env, pid);
  assert("new: KV lost → the linked row stops it («already»)", lost.action === "already" && sentTo(CUST_PHONE).length === 1, JSON.stringify(lost));
}
{
  const env = fresh();
  for (const x of rows("x_whatsapp_template")) if (x.x_meta_template_id === "utak_payment_received") x.x_category = "MARKETING";
  clearTemplateCache();
  const pid = payment(invoice(100), 100);
  const c = await confirm(env, pid);
  assert("closed window and no usable template: held (critical) — its held row is linked too", c.action === "held" && heldFor(env, CUST_PHONE).length === 1 && outRows(pid).some((r: any) => r.x_status === "held"), JSON.stringify(outRows(pid)));
  env.MSG_DEDUP.store.delete(`btnlock:v1:payconf:${pid}`);
  const again = await confirm(env, pid);
  assert("…KV lost: the held row counts as on record («already»), nothing held twice", again.action === "already" && heldFor(env, CUST_PHONE).length === 1, JSON.stringify(again));
}
{
  const env = fresh();
  const inv = invoice(100);
  const a = payment(inv, 50), b = payment(inv, 50);
  await confirm(env, a);
  await confirm(env, b);
  assert("two payments of the same amount on one invoice: two messages, each linked to its own payment",
    tpl(CUST_PHONE).length === 2 && outRows(a).length === 1 && outRows(b).length === 1, JSON.stringify(rows("x_wa_message").map((r: any) => [r.x_res_model, r.x_res_id])));
}

console.log("\n[م10] simulation: nothing sent for a payment, invoice or order marked x_utak_simulation");
for (const [what, setup] of [
  ["payment", (inv: number) => payment(inv, 100, { x_utak_simulation: true })],
  ["invoice", (inv: number) => { table("x_invoice").get(inv)!.x_utak_simulation = true; return payment(inv, 100); }],
  ["order", (inv: number) => { const o = table("x_invoice").get(inv)!.x_order_id as number; table("x_daily_order").get(o)!.x_utak_simulation = true; return payment(inv, 100); }],
] as Array<[string, (inv: number) => number]>) {
  const env = fresh();
  openWindow(env, CUST_PHONE, 5);
  const pid = setup(invoice(100));
  const c = await confirm(env, pid);
  assert(`new: ${what} marked simulation → «simulation», nothing sent, no claim, no row`,
    c.action === "simulation" && sentTo(CUST_PHONE).length === 0 && !env.MSG_DEDUP.store.has(`btnlock:v1:payconf:${pid}`) && outRows(pid).length === 0, JSON.stringify(c));
}

console.log("\n[م10] a customer held for the number review (as م8), and no number");
{
  const env = fresh();
  seed("res.partner", { id: REV, name: "رقم غلط", x_whatsapp_number: "+" + REV_PHONE, customer_rank: 1, x_contact_class: "unreviewed", x_review_pending: true, x_ai_intent: "wrong_number" });
  openWindow(env, REV_PHONE, 5);
  const pid = payment(invoice(100, { customer: REV }), 100);
  const c = await confirm(env, pid);
  assert("new: held for the review → «held_partner», nothing sent, nothing held", c.action === "held_partner" && sentTo(REV_PHONE).length === 0 && heldFor(env, REV_PHONE).length === 0, JSON.stringify(c));
}
{
  const env = fresh();
  const pid = payment(invoice(100, { customer: 42 }), 100); // «UTAK بوت»: no number
  const c = await confirm(env, pid);
  assert("no number → «no_phone», nothing sent", c.action === "no_phone" && graph.length === 0, JSON.stringify(c));
}

console.log("\n[م10] the collection button sends the customer nothing of its own; a second tap no second payment");
{
  const env = fresh();
  const inv = invoice(100);
  openWindow(env, COLL_PHONE, 5); openWindow(env, CUST_PHONE, 5);
  const tapId = (id: string) => quiet(() => worker.fetch(signed(inbound(COLL_PHONE, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } })), env, harnessCtx));
  // § 42 ب — «نقد» asks «المبلغ كامل» / «مبلغ آخر»; «المبلغ كامل» records (twice tapped: once)
  await tapId(`collect_cash_${inv}`);
  const full = sentTo(COLL_PHONE).map((b) => String(b.interactive?.action?.buttons?.[0]?.reply?.id ?? "")).filter((id) => id.startsWith("collect_full_")).at(-1)!;
  await tapId(full);
  await tapId(full);
  assert("one payment for two taps (ح8)", rows("x_payment").length === 1, String(rows("x_payment").length));
  assert("new: nothing to the customer from the collection itself (no «تم استلام الدفعة»)", sentTo(CUST_PHONE).length === 0, JSON.stringify(texts(CUST_PHONE)));
}

console.log("\n[م10] the receipt pipeline: /internal/receipt-issue, /admin/test-receipt");
const receiptIssue = async (env: any, pid: number) => {
  const c = liveCtx();
  const req = new Request("https://w.test/internal/receipt-issue?token=HOOK", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _model: "x_payment", _id: pid }) });
  const r = await quiet(() => worker.fetch(req, env, c));
  await quiet(() => c.flush());
  return r;
};
{
  const env = fresh();
  openWindow(env, CUST_PHONE, 5);
  const pid = payment(invoice(100), 100);
  const r = await receiptIssue(env, pid);
  const t = texts(CUST_PHONE);
  assert("new: the automation's webhook → 202, the PDF, and one confirmation with the receipt's link", r.status === 202 && gotenbergCalls === 1 && t.length === 1 && t[0].includes("/receipt-pdf/") && t[0].startsWith("✅ استلمنا دفعتك بمبلغ 100 ريال"), JSON.stringify({ status: r.status, gotenbergCalls, t }));
  assert("…the receipt written back on the payment", !!table("x_payment").get(pid)!.x_studio_char_1_1);
  await receiptIssue(env, pid);
  assert("new: the webhook fired again → no second message", texts(CUST_PHONE).length === 1, JSON.stringify(texts(CUST_PHONE)));
  const adm = await quiet(() => worker.fetch(new Request(`https://w.test/admin/test-receipt?token=ADM&id=${pid}`), env, harnessCtx));
  const j = await adm.json() as any;
  assert("new: /admin/test-receipt goes through the same confirmation → «claimed», no message", j?.steps?.["4_send_whatsapp"] === "claimed" && texts(CUST_PHONE).length === 1, JSON.stringify(j?.steps));
}
{
  const env = fresh();
  openWindow(env, CUST_PHONE, 5);
  const pid = payment(invoice(100), 100, { x_utak_simulation: true });
  await receiptIssue(env, pid);
  assert("a simulation payment through the webhook: nothing sent", sentTo(CUST_PHONE).length === 0);
}

console.log("\n[م10] the */5 net: a payment whose receipt webhook was lost");
const odooUtc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
{
  const env = fresh(`${DAY} 16:00`);
  openWindow(env, CUST_PHONE, 5);
  const inv = invoice(100);
  const lost = payment(inv, 60, { create_date: odooUtc(`${DAY} 15:45`) });
  const fresh5 = payment(inv, 10, { create_date: odooUtc(`${DAY} 15:55`) });
  const old = payment(invoice(50, { number: "UTAK-INV-OLD" }), 50, { create_date: odooUtc("2026-09-25 15:00") });
  const sim = payment(invoice(70, { number: "UTAK-INV-SIM" }), 70, { create_date: odooUtc(`${DAY} 15:40`), x_utak_simulation: true });
  const out = await quiet(() => pc.runPaymentConfirmTick(env, Date.now(), harnessCtx));
  assert("new: 15 min old, no receipt, no claim → the pipeline now, one confirmation", out.length === 1 && out[0].paymentId === lost && out[0].action === "sent" && texts(CUST_PHONE).length === 1, JSON.stringify(out));
  assert("…not the 5-minute-old one (its webhook may still come), not the 25-hour-old one, not a simulation", !out.some((x) => [fresh5, old, sim].includes(x.paymentId)));
  const again = await quiet(() => pc.runPaymentConfirmTick(env, Date.now(), harnessCtx));
  assert("next tick: nothing (receipt written back, claim taken)", again.length === 0 && texts(CUST_PHONE).length === 1, JSON.stringify(again));
}
{
  const env = fresh(`${DAY} 16:00`);
  const pid = payment(invoice(100), 100, { create_date: odooUtc(`${DAY} 15:40`) });
  env.MSG_DEDUP.store.set(`btnlock:v1:payconf:${pid}`, "run:earlier");
  const out = await quiet(() => pc.runPaymentConfirmTick(env, Date.now(), harnessCtx));
  assert("a claim already taken (the webhook ran, its write-back failed): no pipeline, no message", out.length === 0 && gotenbergCalls === 0 && graph.length === 0, JSON.stringify(out));
}
{
  // the webhook ran and wrote the receipt back, but took no claim (a customer held for the review, or no number)
  const env = fresh(`${DAY} 16:00`);
  seed("res.partner", { id: REV, name: "رقم غلط", x_whatsapp_number: "+" + REV_PHONE, customer_rank: 1, x_contact_class: "unreviewed", x_review_pending: true, x_ai_intent: "wrong_number" });
  payment(invoice(100, { customer: REV }), 100, { create_date: odooUtc(`${DAY} 15:40`), x_studio_char_1_1: "UTAK-R-20260926-099" });
  const out = await quiet(() => pc.runPaymentConfirmTick(env, Date.now(), harnessCtx));
  assert("a payment already receipted (no claim: held customer): the net leaves it — no PDF again every 5 minutes", out.length === 0 && gotenbergCalls === 0, JSON.stringify(out));
}
{
  const env = fresh(`${DAY} 16:00`);
  const a = payment(invoice(60, { number: "UTAK-INV-A" }), 60, { create_date: odooUtc(`${DAY} 15:40`) });
  const b = payment(invoice(60, { number: "UTAK-INV-B" }), 60, { create_date: odooUtc(`${DAY} 15:41`) });
  const out = await quiet(() => worker.scheduled({ cron: "*/5 * * * *" } as any, env, liveCtx()));
  void out;
  assert("new: wired in the */5 cron; two payments of one customer the same day both go (one auto-send job per payment)",
    tpl(CUST_PHONE).length === 2 && outRows(a).length === 1 && outRows(b).length === 1, JSON.stringify(tpl(CUST_PHONE).map(params)));
  assert("the */5 cron keeps its job name (no new schedule)", CRON_JOB["*/5 * * * *"] === "team_attendance");
}

console.log("\n[م10] every payment confirmation is this one path");
{
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const files = readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts"));
  const hits = (re: RegExp) => files.filter((f) => re.test(src(f).replace(/^\s*\/\/.*$/gm, "")));
  assert("«تم استلام الدفعة» is sent nowhere", hits(/تم استلام الدفعة/).length === 0, JSON.stringify(hits(/تم استلام الدفعة/)));
  assert("customer_payment_received is sent only from src/payment-confirm.ts", JSON.stringify(hits(/PAYCONF_PURPOSE|CUSTOMER_PAYMENT_RECEIVED|"customer_payment_received"/).filter((f) => !["payment-confirm.ts", "templates.ts", "wa-purposes.ts"].includes(f))) === "[]",
    JSON.stringify(hits(/CUSTOMER_PAYMENT_RECEIVED|"customer_payment_received"/)));
  assert("customer_receipt / customer_payment_ack carry no send any more (their keys stay in wa-purposes)", hits(/"customer_receipt"|"customer_payment_ack"/).length === 0 && /customer_receipt:/.test(src("wa-purposes.ts")), JSON.stringify(hits(/"customer_receipt"|"customer_payment_ack"/)));
  assert("the receipt pipeline and /admin/test-receipt call confirmPaymentToCustomer", /confirmPaymentToCustomer\(env, paymentId/.test(src("receipt.ts")) && /confirmPaymentToCustomer\(env, paymentId/.test(src("index.ts")));
}

console.log("\n[gate]");
assert("no field / value the tenant does not have", rejected.length === 0, rejected.join(" / "));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.map((f) => `  ${f}`).join("\n")); process.exit(1); }
