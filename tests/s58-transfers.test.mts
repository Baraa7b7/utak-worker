// § 58 أ + ب (2026-10-05) — ONE source for every transfer, and never two payments on an invoice.
//
//   [ب1] the customer, then the collector: ONE notice, two sources, no second «✅ وصل» — one payment
//   [ب2] the collector, then the customer: ONE notice, the customer's figures stand — one payment
//   [ب3] «✅ وصل» twice (one after the other, and at once): one payment
//   [ب4] «✅ وصل» after cash on the same invoice: nothing more than what is left — the last guard
//   [ب5] two invoices: one payment each, ONE payment in the books, ONE message to the customer
//   [ب6] a notice with no open invoice: nothing
//   [ب7] the last guard before any payment, transfer or cash — and cash as it was
//   [ب8] the collector's «تحويل 🏦»: the amount he types, a double tap, the delivery form's line
//   [أ1] the two buttons after a delivery: once an order, inside the window only
//   [أ3] the customer's ONE message after «✅ وصل», with the receipts — and no message a receipt
//   [هـ] the two trials to Baraa
//   [د]  the guide
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s58-transfers.test.mts

import { readFileSync } from "node:fs";
import { COLL, COLL_PHONE, CUST2_PHONE, OWNER, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, order, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { C1, C1_PHONE, DAY, assert, done, fresh, rejected, setExtract } from "./s46-kit.mts";

// ---------------------------------------------------------------- Meta's media, Gotenberg, and Odoo's payment wizard
const MEDIA_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const round2 = (n: number) => Math.round(n * 100) / 100;
const wizardCalls: Array<{ vals: any; active: number[] }> = [];
let gotenbergCalls = 0, gotenbergDown = false, sendSeq = 0;
const M_A = 5001, M_B = 5002, M_C = 5003;
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const mm = /graph\.facebook\.com\/[^/]+\/(TRNPH_[A-Z0-9_]+)$/.exec(url);
  if (mm) return new Response(JSON.stringify({ url: `https://media.test/${mm[1]}`, mime_type: "image/jpeg", file_size: MEDIA_BYTES.length }), { status: 200 });
  if (url.startsWith("https://media.test/TRNPH_")) return new Response(MEDIA_BYTES, { status: 200 });
  if (url.startsWith("https://gotenberg.test/")) {
    gotenbergCalls++;
    if (gotenbergDown) return new Response("down", { status: 503 });
    return new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]), { status: 200, headers: { "Content-Type": "application/pdf" } });
  }
  if (url.includes("graph.facebook.com") && init?.body) {
    // a message id of its own for every send, as Meta gives (a repeated id would read as a send already recorded, § 36)
    const res = await kitFetch(input as any, init);
    return res.ok ? new Response(JSON.stringify({ messages: [{ id: `wamid.T${++sendSeq}` }] }), { status: 200 }) : res;
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  // Odoo's payment wizard as the tenant runs it: BNK1's inbound method posts to 101003, several invoices
  // with group_payment are ONE payment, settled the oldest first
  if (m && m[1] === "account.payment.register" && m[2] === "action_create_payments") {
    const b = JSON.parse(init.body);
    const wiz = table("account.payment.register").get(b.ids[0]) as any;
    const moves = (b.context.active_ids as number[]).map((id) => table("account.move").get(id) as any);
    wizardCalls.push({ vals: { ...wiz }, active: [...b.context.active_ids] });
    const amount = Number(wiz.amount);
    const moveId = seed("account.move", { state: "posted", move_type: "entry" });
    seed("account.move.line", { move_id: moveId, account_id: [254, "101003 Outstanding Receipts"], debit: amount, credit: 0 });
    seed("account.move.line", { move_id: moveId, account_id: [300, "102011"], debit: 0, credit: amount });
    let left = amount;
    const settled: number[] = [];
    for (const mv of [...moves].sort((x, y) => String(x.invoice_date).localeCompare(String(y.invoice_date)) || x.id - y.id)) {
      const take = round2(Math.min(left, mv.amount_residual));
      if (!(take > 0)) continue;
      mv.amount_residual = round2(mv.amount_residual - take);
      mv.payment_state = mv.amount_residual <= 0.005 ? "paid" : "partial";
      left = round2(left - take);
      settled.push(mv.id);
    }
    const id = seed("account.payment", { amount, state: "paid", partner_id: moves[0].commercial_partner_id, move_id: [moveId, "PBNK1"], journal_id: wiz.journal_id, date: wiz.payment_date, memo: wiz.communication, reconciled_invoice_ids: settled });
    return new Response(JSON.stringify({ res_model: "account.payment", res_id: id }), { status: 200 });
  }
  return kitFetch(input as any, init);
}) as typeof fetch;

const TR = await import("../src/transfer-form.ts");
const CP = await import("../src/collect-pay.ts");
const INVOICE = await import("../src/invoice.ts");
const AFTER = await import("../src/after-delivery.ts");
const PAYCONF = await import("../src/payment-confirm.ts");
const RECEIPT_MOD = await import("../src/receipt.ts");
const ROUTER = await import("../src/router.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { ALREADY_DONE_TEXT } = await import("../src/button-lock.ts");
const worker = (await import("../src/index.ts")).default;

const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

const INV_A = 9001, INV_B = 9002, INV_C = 9003, O_A = 8001, O_B = 8002, O_C = 8003;
const N_A = "UTAK-INV-20260928-001", N_B = "UTAK-INV-20260930-002", N_C = "UTAK-INV-20261002-003";
const NAME = "مطعم الوادي";
const COLLECTOR = { id: COLL, name: "سالم", whatsapp: "+" + COLL_PHONE };

/**
 * The customer's three open invoices:  A 28 Sept 300 (300 left) · B 30 Sept 250.50 (50.50 paid in cash:
 * 200 left) · C 2 Oct 120 (120 left) — each with its accounting twin, and the books of BNK1 as on the tenant.
 */
function world(o: { books?: boolean; riyadh?: string } = {}): any {
  const env = fresh(o.riyadh ?? `${DAY} 14:00`); setExtract(null);
  wizardCalls.length = 0; gotenbergCalls = 0; gotenbergDown = false;
  const twin = (id: number, residual: number, date: string) => seed("account.move", { id, move_type: "out_invoice", state: "posted", commercial_partner_id: [C1, NAME], partner_id: [C1, NAME], amount_residual: residual, payment_state: "not_paid", invoice_date: date });
  const inv = (id: number, orderId: number, number: string, date: string, total: number, move: number) => {
    seed("x_daily_order", { id: orderId, x_customer_id: C1, x_state: "delivered", x_order_date: date, x_utak_simulation: false, x_is_simulation: false });
    seed("x_invoice", { id, x_invoice_number: number, x_order_id: orderId, x_total: total, x_status: "issued", x_invoice_date: date, x_account_move_id: move, x_utak_simulation: false, x_is_simulation: false });
  };
  inv(INV_C, O_C, N_C, "2026-10-02", 120, twin(M_C, 120, "2026-10-02"));
  inv(INV_A, O_A, N_A, "2026-09-28", 300, twin(M_A, 300, "2026-09-28"));
  inv(INV_B, O_B, N_B, "2026-09-30", 250.5, twin(M_B, 200, "2026-09-30"));
  seed("x_payment", { id: 7001, x_invoice_id: INV_B, x_amount: 50.5, x_method: "cash", x_collected_at: utc("2026-09-30 11:00"), x_collected_by: COLL });
  seed("account.account", { id: 247, code: "101001", account_type: "asset_cash", reconcile: false });
  seed("account.account", { id: 254, code: "101003", account_type: "asset_current", reconcile: true });
  seed("account.account", { id: 300, code: "102011", account_type: "asset_receivable", reconcile: true });
  seed("account.journal", { id: 13, code: "BNK1", type: "bank", default_account_id: [247, "101001 Bank"] });
  seed("account.journal", { id: 7, code: "CSHD", type: "cash" });
  seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.company", { id: 1, name: "شركة يوتاك", vat: "315022736600003", account_sale_tax_id: [77, "15%"] });
  Object.assign(env, {
    GOTENBERG_URL: "https://gotenberg.test", GOTENBERG_USER: "u", GOTENBERG_PASSWORD: "p", ADMIN_TOKEN: "ADM",
    INVOICES_BUCKET: { put: async () => ({}), get: async () => null, head: async () => null },
  });
  if (o.books) env.ACCOUNTING_SYNC = "true";
  openWindow(env, C1_PHONE); openWindow(env, COLL_PHONE); openWindow(env, CUST2_PHONE);
  setExtract({ receipt: true, amount: 500, date: DAY, reference: "FT26276001" });
  return env;
}
const c1 = { partnerId: C1, name: NAME, whatsapp: "+" + C1_PHONE };
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? b?.image?.caption ?? b?.document?.caption ?? "");
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map(bodyOf);
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const tokenOf = (b: any): string => b?.interactive?.action?.parameters?.flow_token ?? "";
const buttonsOf = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id);
const notices = (env: any): any[] => [...env.MSG_DEDUP.store.entries()].filter(([k]: [string]) => k.startsWith("transfer_notice:v1:")).map(([, v]: [string, string]) => JSON.parse(v));
/** The messages to Baraa that ASK for a decision: the ones with «✅ وصل» / «❌ ما وصل». */
const asks = () => sentTo(OWNER).filter((b: any) => /^trn_ok_/.test(buttonsOf(b)[0] ?? ""));
const linkedTo = () => sentTo(OWNER).map(bodyOf).filter((t: string) => t.startsWith("🔗 "));
const photo = (id: string) => [{ id, mime_type: "image/jpeg", file_name: "receipt.jpg", sha256: "x" }];
let wamid = 0;
const good = { inv: [String(INV_A), String(INV_B)], amt: "500", date: DAY, ref: "FT26276001", photo: photo("TRNPH_F1"), note: "" };
/** The customer's form and his «إرسال». */
async function customerNotice(env: any, values: Record<string, unknown> = good): Promise<any> {
  await quiet(() => TR.sendTransferForm(env, c1, {}));
  return quiet(() => TR.handleTransferReply(env, { from: "+" + C1_PHONE, messageId: `wamid.TR${++wamid}`, flow: { token: tokenOf(flowsTo(C1_PHONE).at(-1)), values } }));
}
const tap = (env: any, id: string, from = OWNER) => quiet(() => TR.handleTransferDecision(env, id, "+" + from));
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const button = (id: string, title = "x") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const text = (t: string) => ({ type: "text", text: { body: t } });
/** The collector's «تحويل 🏦» as he taps it: the request's button, then a button of the prompt. */
async function collectorTaps(env: any, invoiceId: number, which: "full" | "other" = "full"): Promise<void> {
  await say(env, COLL_PHONE, button(`collect_transfer_${invoiceId}`, "تحويل 🏦"));
  const prompt = sentTo(COLL_PHONE).filter((b: any) => buttonsOf(b).some((id) => id.startsWith(`collect_${which}_transfer_${invoiceId}_`))).at(-1);
  await say(env, COLL_PHONE, button(buttonsOf(prompt).find((id) => id.startsWith(`collect_${which}_`))!, which === "full" ? "كامل" : "مبلغ آخر"));
}
const paysOn = (invoiceId: number) => (rows("x_payment") as any[]).filter((p) => p.x_invoice_id === invoiceId && p.id !== 7001);
const transfers = () => (rows("x_payment") as any[]).filter((p) => p.x_method === "transfer");
/** NEVER two: at most one payment of a transfer on an invoice, and never more collected than invoiced. */
function neverTwo(): boolean {
  return [INV_A, INV_B, INV_C].every((id) => {
    const all = (rows("x_payment") as any[]).filter((p) => p.x_invoice_id === id);
    return all.filter((p) => p.x_method === "transfer").length <= 1 && round2(all.reduce((t, p) => t + p.x_amount, 0)) <= (table("x_invoice").get(id) as any).x_total + 0.005;
  });
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const ownerAlerts = () => textsTo(OWNER).filter((t: string) => t.startsWith("⚠️ دفعة أكبر من المتبقي"));

// ================================================================ ب1
console.log("\n[ب1] the customer, then the collector: ONE notice, two sources, no second «✅ وصل» — one payment");
{
  const env = world({ books: true });
  const first = await customerNotice(env);
  assert("the customer's form: a notice, and ONE message to Baraa that asks for a decision", first.action === "noticed" && !first.linked && notices(env).length === 1 && asks().length === 1 && transfers().length === 0);
  setRiyadh(`${DAY} 14:20`);
  await collectorTaps(env, INV_A);
  const [n] = notices(env);
  assert("the collector then taps «تحويل 🏦» → «المبلغ كامل» on A: NO payment, and no second notice — the same one, with two sources", transfers().length === 0 && notices(env).length === 1 && n.id === first.noticeId
    && JSON.stringify(n.sources.map((x: any) => [x.by, x.name, x.amount])) === JSON.stringify([["customer", NAME, 500], ["collector", "سالم", 300]]), JSON.stringify(n.sources));
  assert("…he reads «تمام، سجّلناه — ينتظر تأكيد وصول المبلغ»", textsTo(COLL_PHONE).at(-1) === "تمام، سجّلناه — ينتظر تأكيد وصول المبلغ" && TR.COLLECTOR_NOTICED_TEXT === "تمام، سجّلناه — ينتظر تأكيد وصول المبلغ", JSON.stringify(textsTo(COLL_PHONE)));
  assert("…Baraa is NOT asked a second time: still one message with the two buttons — and one line-by-line message with the two sources", asks().length === 1 && linkedTo().length === 1
    && linkedTo()[0] === [
      `🔗 مصدر ثانٍ لإشعار تحويل — ${NAME} (TRN-${n.id})`, "• العميل — 500 ر.س — الساعة 14:00", "• المحصّل سالم — 300 ر.س — الساعة 14:20", "الفواتير: 20260928-001، 20260930-002",
      "⚠️ المبالغ مختلفة: «✅ وصل» يسجّل 500 ر.س (مبلغ الإشعار الأول)", "رُبط بالإشعار الأول: لا تأكيد ثانٍ، ودفعة واحدة فقط — القرار من رسالته الأولى.",
    ].join("\n"), linkedTo()[0]);
  assert("…the notice keeps the customer's figures: 500 over A and B, his receipt", n.amount === 500 && JSON.stringify(n.invoices.map((i: any) => i.id)) === JSON.stringify([INV_A, INV_B]) && n.media?.id === "TRNPH_F1");
  graph.length = 0;
  const r = await tap(env, `trn_ok_${n.id}`);
  const ap = rows("account.payment") as any[];
  assert("«✅ وصل»: ONE payment on each invoice (300 on A, 200 on B) — and ONE payment on BNK1 for the whole transfer", r?.action === "confirmed" && JSON.stringify(transfers().map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_A, 300], [INV_B, 200]])
    && wizardCalls.length === 1 && ap.length === 1 && ap[0].amount === 500 && ap[0].journal_id === 13 && transfers().every((p) => p.x_account_payment_id === ap[0].id) && neverTwo(), JSON.stringify(ap));
  assert("…Baraa reads the two sources under what was recorded", textsTo(OWNER).at(-1)!.includes("المصادر: العميل (14:00) · المحصّل سالم (14:20)"), textsTo(OWNER).at(-1));
  const again = await tap(env, `trn_ok_${n.id}`);
  assert("a second «✅ وصل»: «سبق تسجيله» — nothing more is written", again?.action === "duplicate" && transfers().length === 2 && rows("account.payment").length === 1 && wizardCalls.length === 1 && neverTwo());
  // the collector taps again after the decision (a later tap: the minute's lock of his first is gone): the invoice is paid — nothing
  env.MSG_DEDUP.store.delete(`btnlock:v1:collect_ask:${INV_A}`);
  await say(env, COLL_PHONE, button(`collect_transfer_${INV_A}`, "تحويل 🏦"));
  assert("the collector's «تحويل 🏦» after it: the invoice is paid — no notice, no payment", notices(env).length === 1 && transfers().length === 2 && textsTo(COLL_PHONE).at(-1)!.includes("تم تحصيلها مسبقاً"), textsTo(COLL_PHONE).at(-1));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ ب2
console.log("\n[ب2] the collector, then the customer: ONE notice, the customer's figures stand — one payment");
{
  const env = world({ books: true });
  await collectorTaps(env, INV_A);
  const [n0] = notices(env);
  assert("the collector's «تحويل 🏦» → «المبلغ كامل»: a notice of 300 on A with the source «المحصّل», and NO payment", notices(env).length === 1 && transfers().length === 0 && rows("account.payment").length === 0 && n0.amount === 300 && n0.date === DAY && !n0.media
    && JSON.stringify(n0.invoices) === JSON.stringify([{ id: INV_A, number: N_A, remaining: 300 }]) && JSON.stringify(n0.sources.map((x: any) => [x.by, x.name, x.amount])) === JSON.stringify([["collector", "سالم", 300]]) && n0.partnerId === C1 && n0.to === C1_PHONE, JSON.stringify(n0));
  assert("…Baraa gets it with «✅ وصل» / «❌ ما وصل», no image, and the line of its source", asks().length === 1 && !asks()[0].interactive.header && JSON.stringify(buttonsOf(asks()[0])) === JSON.stringify([`trn_ok_${n0.id}`, `trn_no_${n0.id}`])
    && bodyOf(asks()[0]).includes("المصدر: المحصّل سالم — بلا صورة إيصال") && !bodyOf(asks()[0]).includes("الصورة لم تُرفق"), bodyOf(asks()[0]));
  assert("…the customer is told nothing yet", sentTo(C1_PHONE).length === 0);
  setRiyadh(`${DAY} 15:00`);
  const second = await customerNotice(env);
  const [n] = notices(env);
  assert("the customer then sends his form for A and B (500): linked to the collector's — still ONE notice, the same id, no second request", second.action === "noticed" && second.linked === true && second.noticeId === n0.id && notices(env).length === 1 && asks().length === 1 && transfers().length === 0);
  assert("…and HIS figures stand: 500, his day, his reference, his two invoices, his receipt — the collector's 300 stays as a source", n.amount === 500 && n.reference === "FT26276001" && n.media?.id === "TRNPH_F1" && JSON.stringify(n.invoices.map((i: any) => i.id)) === JSON.stringify([INV_A, INV_B])
    && JSON.stringify(n.sources.map((x: any) => [x.by, x.amount])) === JSON.stringify([["collector", 300], ["customer", 500]]), JSON.stringify(n));
  const img = sentTo(OWNER).find((b: any) => b?.type === "image");
  assert("…Baraa sees the two sources — with the customer's receipt, and what «✅ وصل» will record", !!img && img.image.id === "TRNPH_F1" && String(img.image.caption).startsWith(`🔗 مصدر ثانٍ لإشعار تحويل — ${NAME} (TRN-${n.id})`)
    && img.image.caption.includes("• المحصّل سالم — 300 ر.س — الساعة 14:00") && img.image.caption.includes("• العميل — 500 ر.س — الساعة 15:00") && img.image.caption.includes("⚠️ المبالغ مختلفة: «✅ وصل» يسجّل 500 ر.س (مبلغ العميل)"), JSON.stringify(img));
  assert("…the customer reads what he reads after any form", textsTo(C1_PHONE).at(-1) === TR.transferReceivedText(500));
  assert("…both of B's and A's marks point at the one notice", env.MSG_DEDUP.store.get(TR.transferOpenKey(INV_A)) === n.id && env.MSG_DEDUP.store.get(TR.transferOpenKey(INV_B)) === n.id);
  graph.length = 0;
  const r = await tap(env, `trn_ok_${n.id}`);
  assert("«✅ وصل» on the FIRST message: one payment on each invoice, ONE on BNK1 — never two", r?.action === "confirmed" && JSON.stringify(transfers().map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_A, 300], [INV_B, 200]]) && rows("account.payment").length === 1 && (rows("account.payment") as any[])[0].amount === 500 && neverTwo());
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // the same amount from both: no «different amounts» line
  const env = world();
  await collectorTaps(env, INV_A);
  await customerNotice(env, { ...good, inv: [String(INV_A)], amt: "300" });
  const cap = String(sentTo(OWNER).find((b: any) => b?.type === "image")?.image?.caption ?? "");
  assert("the two say the same amount: the two sources, and no «المبالغ مختلفة»", notices(env).length === 1 && cap.includes("• المحصّل سالم — 300 ر.س") && cap.includes("• العميل — 300 ر.س") && !cap.includes("المبالغ مختلفة"), cap);
  await tap(env, `trn_ok_${notices(env)[0].id}`);
  assert("«✅ وصل»: ONE payment of 300 on A", JSON.stringify(transfers().map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_A, 300]]) && neverTwo());
}

// ================================================================ ب3
console.log("\n[ب3] «✅ وصل» twice: one payment");
{
  const env = world({ books: true });
  const { noticeId: id } = await customerNotice(env);
  const [x, y] = await Promise.all([tap(env, `trn_ok_${id}`), tap(env, `trn_ok_${id}`)]);
  assert("two taps at once: one records, the other reads «سبق تسجيله» — one payment an invoice, one on BNK1", [x?.action, y?.action].sort().join() === "confirmed,duplicate" && transfers().length === 2 && rows("account.payment").length === 1 && wizardCalls.length === 1 && neverTwo(), JSON.stringify([x?.action, y?.action]));
  const z = await tap(env, `trn_ok_${id}`), no = await tap(env, `trn_no_${id}`);
  assert("a third tap, and «❌ ما وصل» after it: nothing more", z?.action === "duplicate" && no?.action === "duplicate" && transfers().length === 2 && rows("account.payment").length === 1 && neverTwo());
  assert("the customer was told ONCE", textsTo(C1_PHONE).filter((t: string) => t.startsWith("استلمنا تحويلك")).length === 1);
}

// ================================================================ ب4
console.log("\n[ب4] «✅ وصل» after cash on the same invoice: the last guard");
{
  const env = world({ books: true });
  const { noticeId: id } = await customerNotice(env, { ...good, inv: [String(INV_A)], amt: "300" });
  // the collector then takes the whole of A in cash
  await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_A, method: "cash", collectedBy: COLL }));
  assert("A is paid in cash (one payment)", paysOn(INV_A).length === 1 && paysOn(INV_A)[0].x_method === "cash" && (table("x_invoice").get(INV_A) as any).x_status === "paid");
  graph.length = 0;
  // the books hold the cash payment alone (CSHD)
  const inBooks = rows("account.payment").length, wizards = wizardCalls.length;
  const r = await tap(env, `trn_ok_${id}`);
  assert("«✅ وصل» after it: NOTHING is put on A — no transfer payment, no payment in the books for it", r?.action === "confirmed" && r.payments!.length === 0 && r.excess === 300 && transfers().length === 0 && paysOn(INV_A).length === 1 && inBooks === 1 && rows("account.payment").length === inBooks && wizardCalls.length === wizards && neverTwo(), JSON.stringify([r, inBooks, wizards]));
  assert("…Baraa reads the invoice and the two amounts", textsTo(OWNER).at(-1)!.includes(`⚠️ ${N_A}: المبلغ 300 ر.س والمتبقي 0 ر.س — لم يُسجَّل عليها شيء`) && textsTo(OWNER).at(-1)!.includes("زيادة 300 ر.س باقية رصيداً للعميل"), textsTo(OWNER).at(-1));
  assert("…and the customer reads that his invoices were paid before, and that the amount is his credit", textsTo(C1_PHONE).at(-1) === "استلمنا تحويلك 300 ريال ✅ والفواتير التي اخترتها مسدّدة من قبل.\nالباقي 300 ريال رصيد لك عندنا.", textsTo(C1_PHONE).at(-1));
  assert("…the guard's own alert did not ring too (the decision's message says it)", ownerAlerts().length === 0);
}
{
  // a part in cash: the transfer takes what is left, never more
  const env = world();
  const { noticeId: id } = await customerNotice(env, { ...good, inv: [String(INV_A)], amt: "300" });
  await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_A, method: "cash", amount: 100, collectedBy: COLL }));
  graph.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  assert("100 in cash first: «✅ وصل» puts 200 on A, not 300 — the invoice is never paid over its total", r?.excess === 100 && JSON.stringify(paysOn(INV_A).map((p) => [p.x_method, p.x_amount])) === JSON.stringify([["cash", 100], ["transfer", 200]]) && (table("x_invoice").get(INV_A) as any).x_status === "paid" && neverTwo(), JSON.stringify(paysOn(INV_A)));
  assert("…Baraa reads «المبلغ 300 ر.س والمتبقي 200 ر.س — سُجّل 200 ر.س فقط»", textsTo(OWNER).at(-1)!.includes(`⚠️ ${N_A}: المبلغ 300 ر.س والمتبقي 200 ر.س — سُجّل 200 ر.س فقط`), textsTo(OWNER).at(-1));
  assert("…no «تحصيل مكرر» alert: nothing was collected twice", !textsTo(OWNER).some((t: string) => t.includes("تحصيل مكرر")));
}

// ================================================================ ب5
console.log("\n[ب5] two invoices: one payment each, ONE in the books, ONE message to the customer");
{
  const env = world({ books: true });
  const { noticeId: id } = await customerNotice(env);
  graph.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  const pays = transfers(), ap = rows("account.payment") as any[];
  assert("500 over A and B: one x_payment on each, ONE account.payment of 500 on BNK1", r?.action === "confirmed" && pays.length === 2 && paysOn(INV_A).length === 1 && paysOn(INV_B).length === 1 && ap.length === 1 && ap[0].amount === 500 && JSON.stringify(wizardCalls[0].active) === JSON.stringify([M_A, M_B]) && neverTwo());
  const urlA = String(pays[0].x_studio_char_2), urlB = String(pays[1].x_studio_char_2);
  assert("each row has its receipt issued and written back: its number and its link", pays.every((p) => /^UTAK-R-/.test(String(p.x_studio_char_1_1)) && /^https:\/\/w\.test\//.test(String(p.x_studio_char_2))) && urlA !== urlB && gotenbergCalls === 2, JSON.stringify(pays.map((p) => [p.x_studio_char_1_1, p.x_studio_char_2])));
  assert("[أ3] the customer reads ONE message, to the letter: the amount, each invoice with its amount, and the two receipts' links", JSON.stringify(sentTo(C1_PHONE).map(bodyOf)) === JSON.stringify([[
    `استلمنا تحويلك 500 ريال ✅ وسددنا: فاتورة ${N_A} (300 ريال)، فاتورة ${N_B} (200 ريال)`, "الإيصالات:", `• 20260928-001: ${urlA}`, `• 20260930-002: ${urlB}`,
  ].join("\n")]), JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  assert("…Baraa reads that the customer got one message with the receipts' links", textsTo(OWNER).at(-1)!.endsWith("أُبلغ العميل برسالة واحدة فيها روابط الإيصالات."), textsTo(OWNER).at(-1));
  // what Odoo's automation #1 does for each new x_payment, and the */5 net: the receipt's pipeline
  graph.length = 0;
  const outs: any[] = [];
  for (const p of pays) outs.push(await quiet(() => RECEIPT_MOD.createAndDispatchReceiptForRecord(env, p.id)));
  const direct = await quiet(() => PAYCONF.confirmPaymentToCustomer(env, pays[0].id));
  assert("[أ3] the receipt's own pipeline sends NOTHING for these rows: no «استلمنا دفعتك» a receipt", outs.every((o) => o?.confirmation === "transfer_notice") && direct.action === "transfer_notice" && sentTo(C1_PHONE).length === 0 && heldFor(env, C1_PHONE).length === 0, JSON.stringify(outs));
  // a cash payment keeps its own confirmation
  const cash = await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_C, method: "cash", collectedBy: COLL }));
  const c = await quiet(() => PAYCONF.confirmPaymentToCustomer(env, cash.paymentId!));
  assert("…a cash payment keeps its message as it was: «✅ استلمنا دفعتك بمبلغ 120 ريال على فاتورة …»", c.action === "sent" && bodyOf(sentTo(C1_PHONE).at(-1)).startsWith(`✅ استلمنا دفعتك بمبلغ 120 ريال على فاتورة ${N_C}. شكراً لك`), JSON.stringify(c));
  assert("the mark is the notice's name in the row's note, and nothing else", PAYCONF.isTransferNoticeNote(`إشعار تحويل TRN-${id} — المرجع FT1`) && PAYCONF.isTransferNoticeNote(`إشعار تحويل TRN-${id}`) && !PAYCONF.isTransferNoticeNote("تحويل بنكي") && !PAYCONF.isTransferNoticeNote("إشعار تحويل TRN-12") && !PAYCONF.isTransferNoticeNote(false) && !PAYCONF.isTransferNoticeNote(undefined));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a receipt that cannot be built now: the message goes without its link, and the row's own pipeline still sends nothing
  const env = world();
  const { noticeId: id } = await customerNotice(env, { ...good, inv: [String(INV_A)], amt: "300" });
  gotenbergDown = true; graph.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  assert("the PDF service is down: the payment is recorded, the customer reads his ONE message without a link, Baraa's line says no link", r?.action === "confirmed" && transfers().length === 1 && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([`استلمنا تحويلك 300 ريال ✅ وسددنا: فاتورة ${N_A} (300 ريال)`]) && textsTo(OWNER).at(-1)!.endsWith("أُبلغ العميل برسالة واحدة."), JSON.stringify(textsTo(C1_PHONE)));
  gotenbergDown = false; graph.length = 0;
  const later = await quiet(() => RECEIPT_MOD.createAndDispatchReceiptForRecord(env, transfers()[0].id));
  assert("…the */5 net issues the receipt later — and still sends nothing for it", later?.confirmation === "transfer_notice" && /^UTAK-R-/.test(String(transfers()[0].x_studio_char_1_1)) && sentTo(C1_PHONE).length === 0);
  const reuse = await quiet(() => RECEIPT_MOD.issueReceiptForRecord(env, transfers()[0].id));
  const calls = gotenbergCalls;
  assert("a row that carries its receipt is not built again", reuse?.reused === true && reuse.pdfUrl === transfers()[0].x_studio_char_2 && gotenbergCalls === calls && (await quiet(() => RECEIPT_MOD.issueReceiptForRecord(env, 999999))) === null);
}
{
  // one invoice: «الإيصال: <link>» on one line; a part payment says so; the excess is his credit
  assert("the ONE message for one invoice, a part payment, and an excess", TR.customerConfirmedText(100, [{ number: N_A, amount: 100, paid: false, receiptUrl: "https://w.test/r/1.pdf" }], 0) === `استلمنا تحويلك 100 ريال ✅ وسددنا: فاتورة ${N_A} (100 ريال — جزئي)\nالإيصال: https://w.test/r/1.pdf`
    && TR.customerConfirmedText(350.5, [{ number: N_A, amount: 300, paid: true }], 50.5) === `استلمنا تحويلك 350.50 ريال ✅ وسددنا: فاتورة ${N_A} (300 ريال)\nالباقي 50.50 ريال رصيد لك عندنا.`);
}

// ================================================================ ب6
console.log("\n[ب6] a notice with no open invoice: nothing");
{
  const env = world();
  (table("x_invoice").get(INV_A) as any).x_status = "paid";
  graph.length = 0;
  const paid = await quiet(() => TR.noticeCollectorTransfer(env, INV_A, null, COLLECTOR));
  seed("x_payment", { x_invoice_id: INV_C, x_amount: 120, x_method: "cash" });
  const nothingLeft = await quiet(() => TR.noticeCollectorTransfer(env, INV_C, null, COLLECTOR));
  const none = await quiet(() => TR.noticeCollectorTransfer(env, 424242, null, COLLECTOR));
  assert("the collector's «تحويل 🏦» on a paid invoice, on one with nothing left, on one that does not exist: one line each — no notice, no payment, nothing to Baraa", paid.text === `الفاتورة ${N_A} تم تحصيلها مسبقاً ✅` && !paid.noticeId
    && nothingLeft.text === `لا يوجد مبلغ متبقٍ للتحصيل على الفاتورة ${N_C}.` && !nothingLeft.noticeId && none.text === "الفاتورة رقم 424242 غير موجودة." && notices(env).length === 0 && transfers().length === 0 && sentTo(OWNER).length === 0);
  // the customer with nothing open
  for (const id of [INV_B, INV_C]) (table("x_invoice").get(id) as any).x_status = "paid";
  const form = await quiet(() => TR.sendTransferForm(env, c1, {}));
  assert("the customer with no open invoice: no form, so no notice", form.sent === false && form.reason === "no_open_invoice" && notices(env).length === 0);
}
{
  // every invoice of a notice paid before the decision: «✅ وصل» pays nothing
  const env = world({ books: true });
  await collectorTaps(env, INV_A);
  const [n] = notices(env);
  (table("x_invoice").get(INV_A) as any).x_status = "paid";
  const r = await tap(env, `trn_ok_${n.id}`);
  assert("a notice whose invoice was paid meanwhile: «✅ وصل» records nothing — no row, nothing in the books", r?.action === "confirmed" && r.payments!.length === 0 && transfers().length === 0 && rows("account.payment").length === 0 && wizardCalls.length === 0);
}
{
  // «❌ ما وصل»: nothing, and the invoice is free for a new notice
  const env = world();
  await collectorTaps(env, INV_A);
  const [n] = notices(env);
  const r = await tap(env, `trn_no_${n.id}`);
  assert("«❌ ما وصل» on a collector's notice: nothing written, the customer reads the fixed line", r?.action === "declined" && transfers().length === 0 && textsTo(C1_PHONE).at(-1) === TR.TRANSFER_NOT_ARRIVED_TEXT);
  const next = await customerNotice(env, { ...good, inv: [String(INV_A)], amt: "300" });
  assert("…a notice after the decision is a NEW one (the first is not open any more): Baraa is asked again", next.action === "noticed" && !next.linked && notices(env).length === 2 && asks().length === 2 && (await TR.openNoticeOn(env, [INV_A]))?.id === next.noticeId);
}

// ================================================================ ب7
console.log("\n[ب7] the last guard before any payment, transfer or cash — and cash as it was");
{
  const env = world();
  graph.length = 0;
  const cut = await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_A, method: "cash", amount: 500, collectedBy: COLL }));
  assert("cash 500 on A (300 left): 300 is recorded — the excess is never put on the invoice", cut.amount === 300 && cut.fullyPaid && paysOn(INV_A).length === 1 && paysOn(INV_A)[0].x_amount === 300);
  assert("…and Baraa is told the invoice and the two amounts", JSON.stringify(ownerAlerts()) === JSON.stringify([`⚠️ دفعة أكبر من المتبقي — الفاتورة ${N_A} (نقد 💵): المبلغ 500 ر.س والمتبقي 300 ر.س. سُجّل 300 ر.س فقط، والزيادة لم تُسجَّل على الفاتورة.`]), JSON.stringify(ownerAlerts()));
  graph.length = 0;
  const paid = await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_A, method: "transfer", amount: 50 }));
  assert("a payment on a paid invoice: nothing recorded, and Baraa is told «المتبقي 0 … لم يُسجَّل شيء»", paid.paymentId === null && paysOn(INV_A).length === 1 && JSON.stringify(ownerAlerts()) === JSON.stringify([`⚠️ دفعة أكبر من المتبقي — الفاتورة ${N_A} (تحويل 🏦): المبلغ 50 ر.س والمتبقي 0 ر.س. لم يُسجَّل شيء.`]), JSON.stringify(ownerAlerts()));
  graph.length = 0;
  const typed = await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_C, method: "cash", amount: 150, exact: true }));
  const typedAgain = await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_C, method: "cash", amount: 150, exact: true }));
  assert("an amount typed above what is left (150 on C's 120): refused whole as it was — and ONE alert, not one a try", typed.overLimit?.remaining === 120 && typedAgain.overLimit?.remaining === 120 && paysOn(INV_C).length === 0
    && JSON.stringify(ownerAlerts()) === JSON.stringify([`⚠️ دفعة أكبر من المتبقي — الفاتورة ${N_C} (نقد 💵): المبلغ 150 ر.س والمتبقي 120 ر.س. لم يُسجَّل شيء.`]), JSON.stringify(ownerAlerts()));
  graph.length = 0;
  const quietOne = await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_C, method: "cash", amount: 900, quietExcess: true }));
  assert("a caller that says it itself (quietExcess): cut down all the same, and no alert from the guard", quietOne.amount === 120 && paysOn(INV_C).length === 1 && ownerAlerts().length === 0);
  graph.length = 0;
  const exact = await quiet(() => INVOICE.recordCollection(env, { invoiceId: INV_B, method: "cash", collectedBy: COLL }));
  assert("cash at what is left («المبلغ كامل»), as it was: recorded, paid, and NO alert", exact.amount === 200 && exact.fullyPaid && ownerAlerts().length === 0 && (table("x_invoice").get(INV_B) as any).x_status === "paid");
  assert("the alert's words", INVOICE.excessAlertText({ number: "N", method: "cash", asked: null, left: -5, recorded: 0 }) === "⚠️ دفعة أكبر من المتبقي — الفاتورة N (نقد 💵): المبلغ «المبلغ كامل» والمتبقي 0 ر.س. لم يُسجَّل شيء." && INVOICE.EXCESS_ALERT_TTL === 600);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // «نقد 💵» by the collector's buttons: a payment at once, as before — and no notice
  const env = world();
  await say(env, COLL_PHONE, button(`collect_cash_${INV_A}`, "نقد 💵"));
  const prompt = sentTo(COLL_PHONE).filter((b: any) => buttonsOf(b).some((id) => id.startsWith(`collect_full_cash_${INV_A}_`))).at(-1);
  await say(env, COLL_PHONE, button(buttonsOf(prompt)[0], "كامل"));
  assert("«نقد 💵» → «المبلغ كامل»: ONE cash payment of 300 at once, the invoice paid — no notice, nothing asked of Baraa", JSON.stringify(paysOn(INV_A).map((p) => [p.x_method, p.x_amount, p.x_collected_by])) === JSON.stringify([["cash", 300, COLL]]) && (table("x_invoice").get(INV_A) as any).x_status === "paid" && notices(env).length === 0 && asks().length === 0);
}

// ================================================================ ب8
console.log("\n[ب8] the collector's «تحويل 🏦»: the amount he types, a double tap, the old button, the delivery form");
{
  const env = world();
  await collectorTaps(env, INV_A, "other");
  await say(env, COLL_PHONE, text("٥٠٠"));
  assert("«مبلغ آخر» then 500 on A's 300: «المتبقي 300 ر.س فقط» and asked again — no notice, no payment", textsTo(COLL_PHONE).at(-1) === CP.overAmountText(300) && notices(env).length === 0 && transfers().length === 0, textsTo(COLL_PHONE).at(-1));
  await say(env, COLL_PHONE, text("100"));
  const [n] = notices(env);
  assert("…then 100: a notice of 100 on A — no payment — and «تمام، سجّلناه — ينتظر تأكيد وصول المبلغ»", notices(env).length === 1 && n.amount === 100 && transfers().length === 0 && paysOn(INV_A).length === 0 && textsTo(COLL_PHONE).at(-1) === TR.COLLECTOR_NOTICED_TEXT && !(await CP.readPending(env, INV_A)), JSON.stringify(n));
  await say(env, COLL_PHONE, text("100"));
  assert("…the same number again is an ordinary message: still one notice", notices(env).length === 1 && asks().length === 1);
  const r = await tap(env, `trn_ok_${n.id}`);
  assert("«✅ وصل»: 100 on A as a part payment — the rest stays due", r?.action === "confirmed" && JSON.stringify(paysOn(INV_A).map((p) => [p.x_method, p.x_amount])) === JSON.stringify([["transfer", 100]]) && (table("x_invoice").get(INV_A) as any).x_status === "issued"
    && textsTo(C1_PHONE).at(-1)!.startsWith(`استلمنا تحويلك 100 ريال ✅ وسددنا: فاتورة ${N_A} (100 ريال — جزئي)`), textsTo(C1_PHONE).at(-1));
}
{
  const env = world();
  await say(env, COLL_PHONE, button(`collect_transfer_${INV_A}`, "تحويل 🏦"));
  const prompt = sentTo(COLL_PHONE).filter((b: any) => buttonsOf(b).some((id) => id.startsWith(`collect_full_transfer_${INV_A}_`))).at(-1);
  const full = buttonsOf(prompt)[0];
  await Promise.all([say(env, COLL_PHONE, button(full, "كامل")), say(env, COLL_PHONE, button(full, "كامل"))]);
  assert("«المبلغ كامل» of «تحويل 🏦» tapped twice at once: ONE notice, the other tap reads «تم مسبقاً» — and no payment", notices(env).length === 1 && asks().length === 1 && transfers().length === 0 && textsTo(COLL_PHONE).includes(ALREADY_DONE_TEXT) && textsTo(COLL_PHONE).includes(TR.COLLECTOR_NOTICED_TEXT), JSON.stringify(textsTo(COLL_PHONE)));
  // a later tap of his, on a new prompt: linked to his own first notice
  setRiyadh(`${DAY} 14:10`);
  env.MSG_DEDUP.store.delete(`btnlock:v1:collect_ask:${INV_A}`);
  await collectorTaps(env, INV_A);
  assert("a later «تحويل 🏦» of his on the same invoice: linked to his first — still one notice, Baraa not asked again", notices(env).length === 1 && notices(env)[0].sources.length === 2 && asks().length === 1 && linkedTo().length === 1 && transfers().length === 0, JSON.stringify(notices(env)[0].sources));
  // the old one-tap button (scripts): «تحويل» files a notice too
  const old = await quiet(() => INVOICE.handleCollectionButton(env, `collect_transfer_${INV_C}`, COLL));
  assert("the direct collection button: «تحويل» is a notice — «نقد» alone records", old?.text === TR.COLLECTOR_NOTICED_TEXT && notices(env).length === 2 && transfers().length === 0 && paysOn(INV_C).length === 0);
  const cash = await quiet(() => INVOICE.handleCollectionButton(env, `collect_cash_${INV_C}`, COLL));
  assert("…«نقد» by it records the payment as it did", /تم تسجيل التحصيل نقد/.test(cash!.text) && paysOn(INV_C).length === 1 && paysOn(INV_C)[0].x_method === "cash");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const src = srcOf("delivery-form.ts"), cp = srcOf("collect-pay.ts"), tf = srcOf("transfer-form.ts"), inv = srcOf("invoice.ts");
  assert("the delivery form's «تحويل» goes by the collector's notice — and its cash by the collection, as it did", /if \(method === "transfer"\) \{\n      const \{ noticeCollectorTransfer \} = await import\("\.\/transfer-form"\);/.test(src) && /recordCollection\(env, \{ invoiceId: inv\.invoiceId, quietExcess: true, method, amount, collectedBy, exact: true \}\)/.test(src));
  assert("a transfer is recorded as a payment in ONE place: «✅ وصل» — no other caller names the method", (tf.match(/method: "transfer"/g) ?? []).length === 1 && !/recordCollection\([^)]*method: "transfer"/.test(cp) && !/method: "transfer"/.test(src)
    && /if \(method === "transfer"\) \{\n    const \{ noticeCollectorTransfer \}/.test(cp) && /if \(ptr\.method === "transfer"\) \{/.test(cp) && /if \(method === "transfer"\) \{\n    const \{ noticeCollectorTransfer \}/.test(inv));
}

// ================================================================ أ1
console.log("\n[أ1] the two buttons after a delivery: once an order, inside the window only");
{
  const env = world();
  graph.length = 0;
  const r = await quiet(() => AFTER.offerAfterDelivery(env, { orderId: O_A, to: "+" + C1_PHONE }));
  const sent = sentTo(C1_PHONE);
  assert("inside his window: ONE short interactive message — «لو حوّلت أو عندك ملاحظة على الطلب، اضغط هنا 👇» with «🏦 أرسلت تحويل» and «⚠️ عندي ملاحظة»", r.sent && sent.length === 1 && sent[0].interactive?.type === "button" && bodyOf(sent[0]) === "لو حوّلت أو عندك ملاحظة على الطلب، اضغط هنا 👇"
    && JSON.stringify(sent[0].interactive.action.buttons.map((b: any) => [b.reply.id, b.reply.title])) === JSON.stringify([["transfer_notice", "🏦 أرسلت تحويل"], ["complaint_start", "⚠️ عندي ملاحظة"]]), JSON.stringify(sent));
  const again = await quiet(() => AFTER.offerAfterDelivery(env, { orderId: O_A, to: "+" + C1_PHONE }));
  assert("a second time for the same order: nothing — one message an order", !again.sent && again.reason === "already" && sentTo(C1_PHONE).length === 1);
  const other = await quiet(() => AFTER.offerAfterDelivery(env, { orderId: O_B, to: "+" + C1_PHONE }));
  assert("another order of his: its own message", other.sent && sentTo(C1_PHONE).length === 2);
  await settle();
  const rec = (rows("x_wa_message") as any[]).filter((m) => /"purpose":"customer_after_delivery"/.test(String(m.x_debug_payload)));
  assert("it goes under its own purpose: a reply, not important, never a template", rec.length === 2 && (PURPOSES as any).customer_after_delivery?.kind === "reply" && (PURPOSES as any).customer_after_delivery?.important === false);
  // outside the window
  const env2 = world();
  env2.MSG_DEDUP.store.delete(`wa_win:v1:${C1_PHONE}`);
  graph.length = 0;
  const out = await quiet(() => AFTER.offerAfterDelivery(env2, { orderId: O_A, to: "+" + C1_PHONE }));
  assert("outside his window: NOTHING — not sent, not held, no template", !out.sent && out.reason === "window_closed" && sentTo(C1_PHONE).length === 0 && heldFor(env2, C1_PHONE).length === 0, JSON.stringify(out));
  openWindow(env2, C1_PHONE);
  const later = await quiet(() => AFTER.offerAfterDelivery(env2, { orderId: O_A, to: "+" + C1_PHONE }));
  assert("…and the order's one time was not spent: a send inside the window later goes", later.sent && sentTo(C1_PHONE).length === 1);
  assert("no number, no order: nothing", !(await AFTER.offerAfterDelivery(env2, { orderId: O_B, to: "" })).sent && !(await AFTER.offerAfterDelivery(env2, { orderId: 0, to: "+" + C1_PHONE })).sent);
  // the buttons open the forms the free texts' buttons open
  graph.length = 0;
  await say(env, C1_PHONE, button("transfer_notice", "🏦 أرسلت تحويل"));
  assert("«🏦 أرسلت تحويل» of that message opens his transfer-notice form", flowsTo(C1_PHONE).length === 1 && flowsTo(C1_PHONE)[0].interactive.action.parameters.flow_id === TR.TRANSFER_FLOW_ID);
}
{
  // «تم التسليم»: the invoice and the delivery message as they were, then the ONE message
  const env = world();
  const o = order(C1, "in_delivery", DAY);
  seed("x_delivery_stop", { x_order_id: o, x_status: "pending" });
  graph.length = 0;
  const d = await quiet(() => ROUTER.deliverOrder(env, o));
  const two = sentTo(C1_PHONE).filter((b: any) => JSON.stringify(buttonsOf(b)) === JSON.stringify(["transfer_notice", "complaint_start"]));
  const last = sentTo(C1_PHONE).at(-1);
  assert("«تم التسليم» on an order: after what the customer always got, ONE message with the two buttons — the last one", d.delivered && two.length === 1 && last === two[0] && sentTo(C1_PHONE).length >= 2, JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  const again = await quiet(() => ROUTER.deliverOrder(env, o));
  assert("«تم التسليم» again: nothing more to the customer", again.delivered && sentTo(C1_PHONE).filter((b: any) => buttonsOf(b).includes("transfer_notice") && buttonsOf(b).includes("complaint_start")).length === 1);
  const router = srcOf("router.ts"), invoiceSrc = srcOf("invoice.ts");
  assert("it is sent from «تم التسليم» itself, after the invoice and the delivery message — and the invoice's own send does not know it", router.indexOf("offerAfterDelivery(env, { orderId, to: afterTo })") > router.indexOf("await notifyCustomerDelivered(env, cust.phone, cust.name, orderId);") && router.indexOf("await notifyCustomerDelivered(env, cust.phone, cust.name, orderId);") > router.indexOf("await createAndDispatchInvoiceForOrder(env, orderId, invoiceOpts);")
    && !/after-delivery|offerAfterDelivery/.test(invoiceSrc) && !/after-delivery|offerAfterDelivery/.test(srcOf("team.ts")));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ هـ
console.log("\n[هـ] the two trials to Baraa: his number alone, inside his window, once a day, nothing written");
{
  const env = world();
  openWindow(env, OWNER);
  graph.length = 0; odooLog.length = 0;
  const a = await quiet(() => AFTER.sendAfterDeliveryTest(env));
  const m = sentTo(OWNER).at(-1);
  assert("the two buttons, marked «🧪 تجربة», with the customer's words and the trial's own button ids", a.sent && sentTo(OWNER).length === 1 && bodyOf(m).startsWith("🧪 تجربة — ") && bodyOf(m).endsWith("لو حوّلت أو عندك ملاحظة على الطلب، اضغط هنا 👇")
    && JSON.stringify(m.interactive.action.buttons.map((b: any) => [b.reply.id, b.reply.title])) === JSON.stringify([["aftest_transfer", "🏦 أرسلت تحويل"], ["aftest_note", "⚠️ عندي ملاحظة"]]), JSON.stringify(m));
  assert("…once a day", (await quiet(() => AFTER.sendAfterDeliveryTest(env))).reason === "already_today" && sentTo(OWNER).length === 1);
  graph.length = 0;
  await say(env, OWNER, button("aftest_transfer", "🏦 أرسلت تحويل"));
  await say(env, OWNER, button("aftest_note", "⚠️ عندي ملاحظة"));
  assert("his tap on a trial button: one line that says what it opens for a customer — no form, nothing written", JSON.stringify(textsTo(OWNER)) === JSON.stringify([AFTER.afterDeliveryTestAnswer("transfer"), AFTER.afterDeliveryTestAnswer("note")]) && flowsTo(OWNER).length === 0 && textsTo(OWNER).every((t: string) => t.startsWith("🧪 تجربة — ") && t.endsWith(AFTER.AFTER_DELIVERY_TEST_TAIL)), JSON.stringify(textsTo(OWNER)));
  assert("…a trial button from another number is not answered", (await AFTER.answerAfterDeliveryTest(env, "aftest_transfer", "+" + C1_PHONE)) === null && (await AFTER.answerAfterDeliveryTest(env, "transfer_notice", "+" + OWNER)) === null);
  graph.length = 0;
  const t = await quiet(() => TR.sendTransferConfirmedTest(env));
  const body = textsTo(OWNER).at(-1) ?? "";
  assert("the ONE message of «✅ وصل» for two invoices, marked «🧪 تجربة»: the customer's words on the two oldest real open invoices, read only", t.sent && sentTo(OWNER).length === 1 && body.startsWith("🧪 تجربة — ")
    && body.includes(`استلمنا تحويلك 500 ريال ✅ وسددنا: فاتورة ${N_A} (300 ريال)، فاتورة ${N_B} (200 ريال)`) && body.includes("الإيصالات:") && body.includes("الفاتورتان حقيقيتان ومفتوحتان الآن (للقراءة فقط).") && body.endsWith("(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)"), body);
  assert("…once a day", (await quiet(() => TR.sendTransferConfirmedTest(env))).reason === "already_today");
  await settle();
  // the gateway's own record of a send (§ 36): its x_wa_message row, the number's conversation in Discuss and its partner
  const writes = odooLog.filter((c: any) => !/^(search_read|search|search_count|read|fields_get)$/.test(c.method) && !(c.model === "x_wa_message" || /^discuss\.channel/.test(c.model) || c.model === "res.partner"));
  assert("the trials write nothing in Odoo but the record of their own sends — no payment, no notice, no receipt", writes.length === 0 && transfers().length === 0 && notices(env).length === 0 && gotenbergCalls === 0 && sentTo(C1_PHONE).length === 0, JSON.stringify(writes.map((c: any) => [c.model, c.method])));
  // with fewer than two real open invoices: two samples, said to be samples
  const env3 = world();
  openWindow(env3, OWNER);
  for (const id of [INV_A, INV_B]) (table("x_invoice").get(id) as any).x_status = "paid";
  graph.length = 0;
  await quiet(() => TR.sendTransferConfirmedTest(env3));
  assert("fewer than two real open invoices: two samples, said to be samples", (textsTo(OWNER).at(-1) ?? "").includes("فاتورة عيّنة 1 (300 ريال)، فاتورة عيّنة 2 (250.50 ريال)") && (textsTo(OWNER).at(-1) ?? "").includes("الفاتورتان عيّنتان، ليستا فاتورتين حقيقيتين."), textsTo(OWNER).at(-1));
  // his window closed: neither goes, and the day's one time is not spent
  const env2 = world();
  closeOwnerWindow(env2);
  graph.length = 0;
  const closedA = await quiet(() => AFTER.sendAfterDeliveryTest(env2)), closedT = await quiet(() => TR.sendTransferConfirmedTest(env2));
  assert("his window closed: neither trial goes, nothing is held — and the day's one time is not spent", closedA.reason === "window_closed" && closedT.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env2, OWNER).length === 0);
  openWindow(env2, OWNER);
  assert("…the same day, his window open: both go", (await quiet(() => AFTER.sendAfterDeliveryTest(env2))).sent && (await quiet(() => TR.sendTransferConfirmedTest(env2))).sent);
  const idx = srcOf("index.ts"), gw = srcOf("wa-gateway.ts");
  assert("the two hooks are behind the Odoo hook token, and the two purposes are Baraa's alone", /url\.pathname === "\/odoo\/hook\/after-delivery-test" \|\| url\.pathname === "\/odoo\/hook\/transfer-confirmed-test"/.test(idx) && /for \(const p of \["after_delivery_test", "transfer_confirmed_test", "target_lines_test"\]\)/.test(gw)
    && (PURPOSES as any).after_delivery_test && (PURPOSES as any).transfer_confirmed_test);
  // the gate itself: a trial's purpose to a customer's number is refused
  const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
  const { textContent } = await import("../src/meta.ts");
  const refused = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: "transfer_confirmed_test", to: C1_PHONE, content: textContent("x") })));
  const refused2 = gatewayDecision(await quiet(() => sendViaGateway(env, { purpose: "after_delivery_test", to: C1_PHONE, content: textContent("x") })));
  assert("…the gateway refuses either trial's purpose to any number but his", refused?.action !== "session" && refused?.action !== "template" && refused2?.action !== "session" && refused2?.action !== "template", JSON.stringify([refused, refused2]));
}

// ================================================================ د
console.log("\n[د] the guide: one source for a transfer, as the team reads it");
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  const at = guide.indexOf("## التحويلات: مصدر واحد (§ 58)"), section = guide.slice(at, guide.indexOf("\n## ", at + 5));
  assert("OPERATING-DAY carries «التحويلات: مصدر واحد (§ 58)», once, right before the transfer notice's page", at > 0 && guide.split("## التحويلات: مصدر واحد").length === 2 && guide.indexOf("\n## ", at + 5) === guide.indexOf("\n## نموذج «إشعار تحويل» (§ 57)"), String(at));
  assert("…Omar taps «تحويل 🏦» as he always did, reads «تمام، سجّلناه — ينتظر تأكيد وصول المبلغ», and the system stops the repeat", section.includes("«تحويل 🏦»") && section.includes(`«${TR.COLLECTOR_NOTICED_TEXT}»`) && /يمنع التكرار/.test(section) && section.includes("«✅ وصل»"));
  assert("…a second notice is linked to the first, with no second request — and never two payments", /يُربط بالأول/.test(section) && /بلا طلب تأكيد ثانٍ/.test(section) && /دفعة واحدة أو لا شيء/.test(section));
  assert("…the last guard, cash as it was, the two buttons after the delivery, and the ONE message", section.includes("«دفعة أكبر من المتبقي»") && /النقد كما هو/.test(section) && section.includes(`«${AFTER.AFTER_DELIVERY_TEXT}»`) && section.includes("«استلمنا تحويلك X ريال ✅ وسددنا: فاتورة Y (مبلغ)، فاتورة Z (مبلغ)»"));
}

done();
