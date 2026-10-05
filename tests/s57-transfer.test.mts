// § 57 د (2026-10-05) — the customer's «إشعار تحويل»: the form, its three doors, Baraa's «✅ وصل» /
// «❌ ما وصل», and the one payment over the chosen invoices.
//
//   [د1]  utak_transfer_v1: the JSON at Meta against what the worker sends — the keys, the components,
//         Meta's limit on every text
//   [د2]  his open invoices: his, open, the oldest first, what is left — and never a simulation's
//   [د3]  the door of the text: «حولت» / «تحويل 🏦»; with nothing open, or a form that cannot go, as before
//   [د4]  the door of the invoice's text: «🏦 أرسلت تحويل», on the free text alone
//   [د5]  the door of the image: read by Claude as a receipt, the form opened on what was read
//   [د6]  «إرسال»: nothing is paid — the notice kept, the receipt on each invoice, the two messages
//   [د7]  what refuses the form as a whole, and the fresh form
//   [د8]  the token: the number it was sent to, once
//   [د9]  «✅ وصل», the custom ledger: the oldest first, the excess, an invoice paid in the meantime
//   [د10] «✅ وصل», the books: ONE payment on BNK1, and every guard — the bank account 101001 first
//   [د11] «❌ ما وصل»: nothing written
//   [د12] a second tap, another number's tap, a tap that could not finish
//   [د13] the trial to Baraa, its hook, the purposes, privacy
//   [د14] the guide
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s57-transfer.test.mts

import { readFileSync } from "node:fs";
import { COLL, CUST2, CUST2_PHONE, OWNER, WH_PHONE, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, order, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { AHMED_PHONE, C1, C1_PHONE, DAY, assert, done, dp, fresh, market, rejected, setExtract } from "./s46-kit.mts";

// ---------------------------------------------------------------- Meta's media, Claude, and Odoo's payment wizard
const MEDIA_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const round2 = (n: number) => Math.round(n * 100) / 100;
const claudeCalls: any[] = [];
let claudeDown = false;
/** How the wizard behaves: as the tenant does, or one way it must never be let through. */
let wizard: "ok" | "bank" | "plain" | "other" | "newest" | "capped" | "silent" | "split" = "ok";
const wizardCalls: Array<{ vals: any; active: number[] }> = [];
/** A model whose calls fail (Odoo down for it). */
let odooDown = "";
let metaRefusesHeader = false, metaRefusesFlow = false;
/** What Meta refused (it never reaches the harness's `graph`). */
const refusedByMeta: any[] = [];
let sendSeq = 0;
const M_A = 5001, M_B = 5002, M_C = 5003;
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const mm = /graph\.facebook\.com\/[^/]+\/(TRNPH_[A-Z0-9_]+)$/.exec(url);
  if (mm) {
    if (mm[1].startsWith("TRNPH_BAD")) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    return new Response(JSON.stringify({ url: `https://media.test/${mm[1]}`, mime_type: mm[1].startsWith("TRNPH_PDF") ? "application/pdf" : "image/jpeg", file_size: MEDIA_BYTES.length }), { status: 200 });
  }
  if (url.startsWith("https://media.test/TRNPH_")) return new Response(MEDIA_BYTES, { status: 200 });
  if (url.includes("graph.facebook.com") && init?.body) {
    const b = JSON.parse(init.body);
    if ((metaRefusesHeader && b?.interactive?.header) || (metaRefusesFlow && b?.interactive?.type === "flow")) {
      refusedByMeta.push(b);
      return new Response(JSON.stringify({ error: { message: "(#131009) Parameter value is not valid", code: 131009 } }), { status: 400 });
    }
    // a message id of its own for every send, as Meta gives: the harness counts `graph`, which the tests
    // here empty between steps — and a repeated id would read as a send already recorded (§ 36)
    const res = await kitFetch(input as any, init);
    return res.ok ? new Response(JSON.stringify({ messages: [{ id: `wamid.S${++sendSeq}` }] }), { status: 200 }) : res;
  }
  if (url.includes("anthropic.com")) {
    claudeCalls.push(JSON.parse(init.body));
    if (claudeDown) return new Response("overloaded", { status: 529 });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && odooDown && m[1] === odooDown) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "boom" }), { status: 500 });
  // Odoo's payment wizard, as the tenant runs it: BNK1's inbound method posts to 101003 «Outstanding
  // Receipts»; several invoices WITH group_payment are one payment, settled the oldest first, the rest
  // left open on it; WITHOUT it a payment an invoice, each for its whole balance.
  if (m && m[1] === "account.payment.register" && m[2] === "action_create_payments") {
    const b = JSON.parse(init.body);
    const wiz = table("account.payment.register").get(b.ids[0]) as any;
    const moves = (b.context.active_ids as number[]).map((id) => table("account.move").get(id) as any);
    wizardCalls.push({ vals: { ...wiz }, active: [...b.context.active_ids] });
    const pay = (amount: number, targets: any[]): number => {
      const moveId = seed("account.move", { state: "posted", move_type: "entry" });
      seed("account.move.line", { move_id: moveId, account_id: wizard === "bank" ? [247, "101001 Bank"] : wizard === "plain" ? [255, "101009"] : [254, "101003 Outstanding Receipts"], debit: amount, credit: 0 });
      seed("account.move.line", { move_id: moveId, account_id: [300, "102011"], debit: 0, credit: amount });
      let left = amount;
      const settled: number[] = [];
      for (const mv of targets) {
        const take = round2(Math.min(left, mv.amount_residual));
        if (!(take > 0)) continue;
        mv.amount_residual = round2(mv.amount_residual - take);
        mv.payment_state = mv.amount_residual <= 0.005 ? "paid" : "partial";
        left = round2(left - take);
        settled.push(mv.id);
      }
      return seed("account.payment", { amount, state: "paid", partner_id: moves[0].commercial_partner_id, move_id: [moveId, "PBNK1"], journal_id: wiz.journal_id, date: wiz.payment_date, memo: wiz.communication, reconciled_invoice_ids: settled });
    };
    let ids: number[];
    if ((wiz.group_payment !== true || wizard === "split") && moves.length > 1) ids = moves.map((mv) => pay(mv.amount_residual, [mv]));
    else {
      const oldest = [...moves].sort((x, y) => String(x.invoice_date).localeCompare(String(y.invoice_date)) || x.id - y.id);
      const targets = wizard === "newest" ? [...oldest].reverse() : wizard === "other" ? [...oldest, table("account.move").get(M_C)] : oldest;
      const due = round2(moves.reduce((s, mv) => s + mv.amount_residual, 0));
      ids = [pay(wizard === "capped" ? Math.min(Number(wiz.amount), due) : Number(wiz.amount), targets)];
    }
    return new Response(JSON.stringify(wizard === "silent" ? true : ids.length === 1 ? { res_model: "account.payment", res_id: ids[0] } : { res_model: "account.payment", domain: [["id", "in", ids]] }), { status: 200 });
  }
  if (m && m[1] === "account.payment" && m[2] === "action_cancel") {
    for (const id of JSON.parse(init.body).ids) (table("account.payment").get(id) as any).state = "canceled";
  }
  return kitFetch(input as any, init);
}) as typeof fetch;

const TR = await import("../src/transfer-form.ts");
const CLAIM = await import("../src/pay-claim.ts");
const ACC = await import("../src/accounting.ts");
const INVOICE = await import("../src/invoice.ts");
const META = await import("../src/meta.ts");
const CLAUDE = await import("../src/claude.ts");
const CONFIG = await import("../src/config.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const { markPayRemindSent } = CLAIM;
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s57-transfer-flow.mjs");

const utc = (riyadh: string) => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const count = (s: string) => [...String(s)].length;
const INV_A = 9001, INV_B = 9002, INV_C = 9003, O_A = 8001, O_B = 8002, O_C = 8003;
const N_A = "UTAK-INV-20260928-001", N_B = "UTAK-INV-20260930-002", N_C = "UTAK-INV-20261002-003";
const NAME = "مطعم الوادي";

/**
 * The customer's three open invoices — seeded the newest first, as Odoo may hand them:
 *   A  28 Sept  300      nothing paid               → 300 left
 *   B  30 Sept  250.50   50.50 collected in cash    → 200 left
 *   C   2 Oct   120      nothing paid               → 120 left
 * each with its accounting twin (`twins: false` = none), and the books of BNK1 as on the tenant.
 */
function world(riyadh = `${DAY} 14:00`, o: { twins?: boolean } = {}): any {
  const env = fresh(riyadh); setExtract(null);
  claudeCalls.length = 0; wizardCalls.length = 0; claudeDown = false; wizard = "ok"; odooDown = ""; metaRefusesHeader = false; metaRefusesFlow = false;
  const twin = (id: number, residual: number, date: string) => (o.twins === false ? false : seed("account.move", { id, move_type: "out_invoice", state: "posted", commercial_partner_id: [C1, NAME], partner_id: [C1, NAME], amount_residual: residual, payment_state: "not_paid", invoice_date: date }));
  const inv = (id: number, orderId: number, number: string, date: string, total: number, move: number | false, extra: Record<string, unknown> = {}) => {
    seed("x_daily_order", { id: orderId, x_customer_id: C1, x_state: "delivered", x_order_date: date, x_utak_simulation: false, x_is_simulation: false });
    seed("x_invoice", { id, x_invoice_number: number, x_order_id: orderId, x_total: total, x_status: "issued", x_invoice_date: date, x_account_move_id: move, x_utak_simulation: false, x_is_simulation: false, ...extra });
  };
  inv(INV_C, O_C, N_C, "2026-10-02", 120, twin(M_C, 120, "2026-10-02"));
  inv(INV_A, O_A, N_A, "2026-09-28", 300, twin(M_A, 300, "2026-09-28"));
  inv(INV_B, O_B, N_B, "2026-09-30", 250.5, twin(M_B, 200, "2026-09-30"));
  seed("x_payment", { id: 7001, x_invoice_id: INV_B, x_amount: 50.5, x_method: "cash", x_collected_at: utc("2026-09-30 11:00"), x_collected_by: COLL });
  seed("account.account", { id: 247, code: "101001", account_type: "asset_cash", reconcile: false });
  seed("account.account", { id: 254, code: "101003", account_type: "asset_current", reconcile: true });
  seed("account.account", { id: 255, code: "101009", account_type: "asset_current", reconcile: false });
  seed("account.account", { id: 300, code: "102011", account_type: "asset_receivable", reconcile: true });
  seed("account.journal", { id: 13, code: "BNK1", type: "bank", default_account_id: [247, "101001 Bank"] });
  // what an invoice issued from 10-01 needs: the company's sale tax (15%, included)
  seed("account.tax", { id: 77, amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.company", { id: 1, name: "شركة يوتاك", vat: "315022736600003", account_sale_tax_id: [77, "15%"] });
  dp(1, 11, 77.77); market(1, 11, 88.88);
  openWindow(env, C1_PHONE); openWindow(env, CUST2_PHONE);
  return env;
}
const c1 = { partnerId: C1, name: NAME, whatsapp: "+" + C1_PHONE };
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map(bodyOf);
const notices = (env: any): any[] => [...env.MSG_DEDUP.store.entries()].filter(([k]: [string]) => k.startsWith("transfer_notice:v1:")).map(([, v]: [string, string]) => JSON.parse(v));
/** Baraa's notices: the button messages that carry «✅ وصل» / «❌ ما وصل». */
const ownerNotices = () => sentTo(OWNER).filter((b: any) => b?.interactive?.type === "button" && /^trn_ok_/.test(b.interactive.action.buttons[0]?.reply?.id ?? ""));
const buttonsOf = (b: any): string[] => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply.id);
const photo = (id: string) => [{ id, mime_type: "image/jpeg", file_name: "receipt.jpg", sha256: "x" }];
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => TR.handleTransferReply(env, { from: "+" + from, messageId: `wamid.TR${++wamid}`, flow: { token, values } }, undefined, now));
const tap = (env: any, id: string, from = OWNER) => quiet(() => TR.handleTransferDecision(env, id, "+" + from));
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (t: string) => ({ type: "text", text: { body: t } });
const button = (id: string, title = "x") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
const image = (id: string) => ({ type: "image", image: { id, mime_type: "image/jpeg" } });
const good = { inv: [String(INV_A), String(INV_B)], amt: "500", date: DAY, ref: "FT26276001", photo: photo("TRNPH_F1"), note: "" };
/** The form sent to the customer, and its reply: a notice. */
async function notice(env: any, values: Record<string, unknown> = good, opts: Record<string, unknown> = {}): Promise<any> {
  const sent = await quiet(() => TR.sendTransferForm(env, c1, opts));
  const f = flowsTo(C1_PHONE).at(-1);
  const r = await reply(env, C1_PHONE, tokenOf(f), values);
  return { sent, f, r, n: notices(env).at(-1), id: r.noticeId };
}
/** The gateway writes a send's record behind the send: wait for what is still on its way before counting writes. */
const settle = () => new Promise((r) => setTimeout(r, 20));
const odooWrites = () => odooLog.filter((c: any) => !/^(search_read|search|search_count|read|fields_get)$/.test(c.method));
/** The gateway's own record of a send (§ 36): its x_wa_message row, and the number's conversation in Discuss. */
const gatewayRecord = (c: any): boolean => (c.model === "x_wa_message" && c.method === "create") || /^discuss\.channel(\.member)?$/.test(c.model)
  || (c.model === "res.partner" && c.method === "write" && Object.keys(c.body?.vals ?? {}).join() === "x_wa_channel_id");
const money = () => JSON.stringify(["x_payment", "x_invoice", "x_daily_order", "account.payment", "account.move", "account.move.line"].map((t) => rows(t)));
const RECEIPT = { receipt: true, amount: 500, date: "2026-10-02", reference: "FT26276001" };
/** § 58 أ — the customer's ONE message after «✅ وصل» (its words and its receipts: tests/s58-transfers.test.mts). */
const confirmed = (t: string) => t.startsWith("استلمنا تحويلك ");
const LABEL = "3 أكتوبر 2026";

// ================================================================ د1
console.log("\n[د1] utak_transfer_v1 at Meta is the form the worker fills: one screen, no endpoint");
{
  const json = LIB.buildTransferFlowJson();
  const s = json.screens[0], c = s.layout.children, L = LIB.TRANSFER_LIMITS;
  assert("ONE screen, TRANSFER_A — the one the worker opens — terminal; Flow JSON 6.0; exported as FLOW for the Meta script", json.screens.length === 1 && s.id === "TRANSFER_A" && LIB.TRANSFER_SCREEN === TR.TRANSFER_FLOW_SCREEN && s.terminal === true && s.success === true && json.version === "6.0"
    && LIB.FLOW.key === "transfer" && LIB.FLOW.name === "utak_transfer_v1" && LIB.FLOW.build === LIB.buildTransferFlowJson && LIB.FLOW.first === "TRANSFER_A");
  assert("no endpoint and no Form wrapper: no data_api_version, no data_exchange, no «Form» component", !("data_api_version" in json) && !JSON.stringify(json).includes("data_exchange") && LIB.screenComponents(s).every((x: any) => x.type !== "Form"));
  assert("nine components (Meta allows fifty): the heading, the line, the invoices, the amount, the date, the reference, the photo, the note, «إرسال»", LIB.screenComponents(s).length === 9 && 9 <= LIB.SCREEN_COMPONENTS_MAX
    && JSON.stringify(c.map((x: any) => x.type)) === JSON.stringify(["TextHeading", "TextBody", "CheckboxGroup", "TextInput", "DatePicker", "TextInput", "PhotoPicker", "TextArea", "Footer"]));
  assert("the invoices: inv, a CheckboxGroup, REQUIRED (one at least), its options and what is ticked from the data", c[2].name === "inv" && c[2].required === true && c[2]["min-selected-items"] === 1 && c[2]["data-source"] === "${data.invs}" && c[2]["init-value"] === "${data.sel}" && count(c[2].label) <= L.groupLabel);
  assert("«المبلغ المحوّل»: amt, a number, REQUIRED, opened from the data", c[3].name === "amt" && c[3].label === "المبلغ المحوّل" && c[3]["input-type"] === "number" && c[3].required === true && c[3]["init-value"] === "${data.amt}" && count(c[3].label) <= L.inputLabel && count(c[3]["helper-text"]) <= L.inputHint);
  assert("«تاريخ التحويل»: date, a DatePicker, REQUIRED, opened on a day of the data and never after today (max-date)", c[4].name === "date" && c[4].label === "تاريخ التحويل" && c[4].required === true && c[4]["init-value"] === "${data.d}" && c[4]["max-date"] === "${data.max}" && count(c[4].label) <= L.dateLabel);
  assert("«رقم المرجع»: ref, optional, opened from the data", c[5].name === "ref" && c[5].label === "رقم المرجع" && c[5].required === false && c[5]["input-type"] === "text" && c[5]["init-value"] === "${data.ref}" && count(c[5].label) <= L.inputLabel && count(c[5]["helper-text"]) <= L.inputHint);
  assert("«صورة الإيصال»: ONE PhotoPicker — optional in the Flow (the receipt may have come before it), one photo at most, never pre-filled, not `required`", c[6].name === "photo" && c[6].label === "صورة الإيصال" && c[6]["min-uploaded-photos"] === 0 && c[6]["max-uploaded-photos"] === 1 && c[6]["max-file-size-kb"] === 10240
    && !("required" in c[6]) && !("init-value" in c[6]) && c.filter((x: any) => x.type === "PhotoPicker").length === 1 && count(c[6].label) <= L.photoLabel && count(c[6].description) <= L.photoDescription);
  assert("«ملاحظة»: note, optional", c[7].name === "note" && c[7].label === "ملاحظة" && c[7].required === false && count(c[7].label) <= L.inputLabel && count(c[7]["helper-text"]) <= L.inputHint);
  assert("«إرسال» completes with the six fields — the photo a top-level property of the payload, as Meta requires", c[8].label === "إرسال" && count(c[8].label) <= L.footer && c[8]["on-click-action"].name === "complete"
    && JSON.stringify(c[8]["on-click-action"].payload) === JSON.stringify({ inv: "${form.inv}", amt: "${form.amt}", date: "${form.date}", ref: "${form.ref}", photo: "${form.photo}", note: "${form.note}" }));
  assert("the screen's title and the message's button are within Meta's thirty and twenty characters, and carry no emoji", count(s.title) <= L.screenTitle && count(LIB.TRANSFER_CTA) <= L.cta && LIB.TRANSFER_CTA === TR.TRANSFER_CTA && !/\p{Extended_Pictographic}/u.test(LIB.TRANSFER_CTA + s.title));
  assert("Meta's limits are the ones the test holds every text to", JSON.stringify(L) === JSON.stringify({ screenTitle: 30, heading: 80, body: 4096, footer: 35, inputLabel: 20, inputHint: 80, groupLabel: 30, optionTitle: 30, optionDescription: 300, dateLabel: 40, photoLabel: 80, photoDescription: 300, cta: 20 }));
  assert("the screen declares nine keys, each with an example", JSON.stringify(Object.keys(s.data).sort()) === JSON.stringify(["amt", "d", "how", "invs", "max", "note", "ref", "sel", "t"]) && Object.values(s.data).every((v: any) => "__example__" in v)
    && s.data.invs.type === "array" && s.data.sel.type === "array" && s.data.sel.items.type === "string" && count(s.data.invs.__example__[0].title) <= L.optionTitle);
  const env = world();
  const r = await quiet(() => TR.sendTransferForm(env, c1));
  const f = flowsTo(C1_PHONE)[0], d = dataOf(f);
  assert("every key the worker sends is declared, and every declared key is sent", r.sent === true && r.invoices === 3 && JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(s.data).sort()), JSON.stringify(d));
  assert("the heading and the line: within Meta's eighty and 4096 characters, neither empty", d.t === `إشعار تحويل — ${NAME}` && count(d.t) <= L.heading && d.how === TR.TRANSFER_HOW_TEXT && count(d.how) <= L.body && d.how !== "");
  assert("every option: an id, a title within thirty characters, a description within three hundred", d.invs.length === 3 && d.invs.every((x: any) => /^\d+$/.test(x.id) && count(x.title) <= L.optionTitle && x.title !== "" && count(x.description) <= L.optionDescription && x.description !== ""), JSON.stringify(d.invs));
  assert("the message opens utak_transfer_v1 on its screen with the data (navigate), under «إشعار تحويل»", par(f).flow_id === TR.TRANSFER_FLOW_ID && par(f).flow_action === "navigate" && par(f).flow_action_payload.screen === "TRANSFER_A" && par(f).flow_message_version === "3"
    && par(f).flow_cta === "إشعار تحويل" && bodyOf(f).length <= 1024 && TR.TRANSFER_BODY_MAX === 1024);
  assert("…its text says what to do", bodyOf(f) === ["🏦 إشعار تحويل", `اضغط «إشعار تحويل»: ${TR.TRANSFER_HOW_TEXT}`].join("\n"), bodyOf(f));
  assert("the worker's limits are Meta's", TR.TRANSFER_HEADING_MAX === L.heading && TR.TRANSFER_OPTION_TITLE_MAX === L.optionTitle && TR.TRANSFER_OPTION_DESCRIPTION_MAX === L.optionDescription && TR.TRANSFER_INVOICES_MAX === LIB.TRANSFER_INVOICES_MAX && LIB.TRANSFER_INVOICES_MAX === 20);
  assert("a name longer than the heading's eighty characters is cut", count(TR.transferData({ ...c1, name: "م".repeat(90) }, [], DAY).t as string) === 80);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د2
console.log("\n[د2] his open invoices: his, open, the oldest first, with what is left — never a simulation's");
{
  const env = world();
  const open = await quiet(() => TR.openInvoices(env, C1));
  assert("the three, the OLDEST first whatever order Odoo hands them in: A (28 Sept), B (30 Sept), C (2 Oct)", JSON.stringify(open.map((i: any) => i.id)) === JSON.stringify([INV_A, INV_B, INV_C]), JSON.stringify(open.map((i: any) => i.id)));
  assert("what is left = the total less every payment on it: 300, 200 (250.50 − 50.50), 120", JSON.stringify(open.map((i: any) => i.remaining)) === JSON.stringify([300, 200, 120]) && open[1].total === 250.5);
  assert("each with its accounting twin, its customer and its date", open[0].moveId === M_A && open[0].customerId === C1 && open[0].customer === NAME && open[0].date === "2026-09-28" && open[0].number === N_A);
  const d = dataOf((await quiet(() => TR.sendTransferForm(env, c1)), flowsTo(C1_PHONE)[0]));
  assert("an option's title: the number without «UTAK-INV-» and what is left — «20260928-001 · 300 ر.س»", JSON.stringify(d.invs.map((x: any) => x.title)) === JSON.stringify(["20260928-001 · 300 ر.س", "20260930-002 · 200 ر.س", "20261002-003 · 120 ر.س"]), JSON.stringify(d.invs.map((x: any) => x.title)));
  assert("…its description: the whole number, the date, the total and what is left", d.invs[1].description === `${N_B} — 30 سبتمبر 2026 — الإجمالي 250.50 ر.س — المتبقي 200 ر.س` && d.invs[1].id === String(INV_B), d.invs[1].description);
  assert("nothing is ticked for him when he has several; the date opens on today, and today is the last day it takes", JSON.stringify(d.sel) === "[]" && d.d === DAY && d.max === DAY && d.amt === "" && d.ref === "" && d.note === "");
  assert("a number too long for a title is cut — never the amount", TR.invoiceOption({ id: 1, number: "UTAK-INV-" + "9".repeat(40), date: "", total: 99999.99, remaining: 99999.99, moveId: null, customerId: 1, customer: "" }).title.endsWith(" · 99999.99 ر.س")
    && count(TR.invoiceOption({ id: 1, number: "UTAK-INV-" + "9".repeat(40), date: "", total: 99999.99, remaining: 99999.99, moveId: null, customerId: 1, customer: "" }).title) === 30);
  const one = world();
  for (const id of [INV_B, INV_C]) table("x_invoice").get(id)!.x_status = "paid";
  await quiet(() => TR.sendTransferForm(one, c1));
  assert("his ONLY open invoice is ticked for him: there is nothing to choose", JSON.stringify(dataOf(flowsTo(C1_PHONE)[0]).sel) === JSON.stringify([String(INV_A)]) && dataOf(flowsTo(C1_PHONE)[0]).invs.length === 1, JSON.stringify(dataOf(flowsTo(C1_PHONE)[0]).sel));
  // ---- what is NOT an open invoice of his
  const only = async (extra: Record<string, unknown>, orderExtra: Record<string, unknown> = {}, pay = 0) => {
    const env2 = world();
    seed("x_daily_order", { id: 8100, x_customer_id: C1, x_state: "delivered", x_order_date: "2026-09-20", ...orderExtra });
    seed("x_invoice", { id: 9100, x_invoice_number: "UTAK-INV-X", x_order_id: 8100, x_total: 80, x_status: "issued", x_invoice_date: "2026-09-20", ...extra });
    if (pay) seed("x_payment", { x_invoice_id: 9100, x_amount: pay, x_method: "cash", x_collected_at: utc("2026-09-21 10:00") });
    return (await quiet(() => TR.openInvoices(env2, C1))).some((i: any) => i.id === 9100);
  };
  assert("an issued or an overdue invoice of his is open — and is then the oldest", (await only({})) && (await only({ x_status: "overdue" })));
  assert("a paid one is not; nor one whose payments cover it; one partly paid is", !(await only({ x_status: "paid" })) && !(await only({}, {}, 80)) && (await only({}, {}, 79)));
  assert("a simulation invoice is NEVER open: x_utak_simulation, or x_is_simulation (every row the sim worker made)", !(await only({ x_utak_simulation: true })) && !(await only({ x_is_simulation: true })));
  assert("…nor a real invoice of a simulation ORDER, by either flag", !(await only({}, { x_utak_simulation: true })) && !(await only({}, { x_is_simulation: true })));
  assert("another customer's invoice is not his", !(await only({}, { x_customer_id: CUST2 })));
  const env3 = world();
  for (let k = 0; k < 25; k++) { seed("x_daily_order", { id: 8200 + k, x_customer_id: C1, x_state: "delivered" }); seed("x_invoice", { id: 9200 + k, x_invoice_number: `UTAK-INV-202608${String(k + 1).padStart(2, "0")}-001`, x_order_id: 8200 + k, x_total: 10, x_status: "issued", x_invoice_date: `2026-08-${String(k + 1).padStart(2, "0")}` }); }
  const many = await quiet(() => TR.openInvoices(env3, C1));
  assert("28 open invoices: the form lists twenty — the OLDEST twenty (Meta's limit of a CheckboxGroup)", many.length === 20 && many[0].id === 9200 && many[19].id === 9219 && !many.some((i: any) => i.id === INV_A));
  assert("only x_invoice, its order and its payments are read — no price, cost or purchase model", odooLog.filter((c: any) => /^(search_read|read)$/.test(c.method)).every((c: any) => /^(x_invoice|x_daily_order|x_payment|res\.partner)$/.test(c.model)), JSON.stringify([...new Set(odooLog.map((c: any) => c.model))]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د3
console.log("\n[د3] the door of the text: «حولت» / «دفعت» / «تحويل 🏦» from a customer with an open invoice");
{
  assert("«تحويل» / «تحويل 🏦» is the WHOLE message — as a phone types it: «تحويل.», « تحويل 🏦 »", ["تحويل", "تحويل 🏦", "تحويل.", " تحويل 🏦 ", "🏦 تحويل", "تَحويل"].every(CLAIM.isTransferReply));
  assert("a sentence that holds the word is not it: «أبي تحويل الطلب لبكرة», «كم التحويل», «تحويل بنكي»", ["أبي تحويل الطلب لبكرة", "كم التحويل", "تحويل بنكي", "حولت", "", "🏦", null, undefined].every((t) => !CLAIM.isTransferReply(t as any)));
}
for (const word of ["حوّلت المبلغ الحين", "دفعت", "تحويل 🏦", "تحويل"]) {
  const env = world();
  const r = await say(env, C1_PHONE, text(word));
  const f = flowsTo(C1_PHONE);
  assert(`«${word}» through the webhook → ONE message: his transfer-notice form, with his three invoices`, r.status === 200 && sentTo(C1_PHONE).length === 1 && f.length === 1 && dataOf(f[0]).invs.length === 3, JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  assert("…not «المحصّل بيتأكد», nothing to Baraa, nothing to the collectors, nothing held", !textsTo(C1_PHONE).includes(CLAIM.PAY_CLAIM_REPLY) && sentTo(OWNER).length === 0 && graph.every((b: any) => b === null || b.to === C1_PHONE) && heldFor(env, C1_PHONE).length === 0);
}
{
  // within 48h of a payment reminder too: the form, not the old reply
  const env = world();
  await markPayRemindSent(env, C1, 620);
  await say(env, C1_PHONE, text("حولت"));
  assert("a reminded customer with an open invoice: the form too — no «يقول إنه حوّل» alert", flowsTo(C1_PHONE).length === 1 && !textsTo(C1_PHONE).includes(CLAIM.PAY_CLAIM_REPLY) && !sentTo(OWNER).some((b: any) => bodyOf(b).includes("يقول إنه حوّل")));
}
{
  // no open invoice: what the path did before, word for word
  const env = world();
  for (const id of [INV_A, INV_B, INV_C]) table("x_invoice").get(id)!.x_status = "paid";
  await markPayRemindSent(env, C1, 100);
  await say(env, C1_PHONE, text("حولت"));
  assert("NO open invoice, reminded: «وصلنا إشعار التحويل، والمحصّل بيتأكد» and the alert to Baraa — as before", flowsTo(C1_PHONE).length === 0 && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([CLAIM.PAY_CLAIM_REPLY]) && sentTo(OWNER).filter((b: any) => bodyOf(b).includes("يقول إنه حوّل")).length === 1, JSON.stringify(textsTo(C1_PHONE)));
  const env2 = world();
  for (const id of [INV_A, INV_B, INV_C]) table("x_invoice").get(id)!.x_status = "paid";
  await say(env2, C1_PHONE, text("حولت"));
  assert("NO open invoice, not reminded: an ordinary message, as before — no form, no claim reply", flowsTo(C1_PHONE).length === 0 && !textsTo(C1_PHONE).includes(CLAIM.PAY_CLAIM_REPLY) && !sentTo(OWNER).some((b: any) => bodyOf(b).includes("يقول إنه حوّل")));
  await say(env2, C1_PHONE, text("تحويل 🏦"));
  assert("…and «تحويل 🏦» with nothing open is an ordinary message too", flowsTo(C1_PHONE).length === 0);
  // only simulation invoices: nothing open
  const env3 = world();
  for (const id of [INV_A, INV_B, INV_C]) table("x_invoice").get(id)!.x_is_simulation = true;
  await markPayRemindSent(env3, C1, 100);
  await say(env3, C1_PHONE, text("حولت"));
  assert("only simulation invoices: nothing is open — the old reply", flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).includes(CLAIM.PAY_CLAIM_REPLY));
}
{
  // the form cannot go: the old behaviour
  const env = world();
  await markPayRemindSent(env, C1, 620);
  metaRefusesFlow = true;
  await say(env, C1_PHONE, text("حولت"));
  metaRefusesFlow = false;
  assert("Meta refuses the form: «المحصّل بيتأكد» and the alert, as before — and no token is left behind", textsTo(C1_PHONE).includes(CLAIM.PAY_CLAIM_REPLY) && sentTo(OWNER).some((b: any) => bodyOf(b).includes("يقول إنه حوّل")) && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("transfer_t:")), JSON.stringify(textsTo(C1_PHONE)));
  const env2 = world();
  await markPayRemindSent(env2, C1, 620);
  odooDown = "x_invoice";
  const out = await quiet(() => CLAIM.answerClaimWithForm(env2, { id: C1, name: NAME }, "+" + C1_PHONE, "حولت"));
  odooDown = "";
  assert("his invoices cannot be read: no form (false) — the caller answers as before", out === false && flowsTo(C1_PHONE).length === 0);
  assert("answerClaimWithForm is false for a text that is no claim — and reads nothing", (await quiet(() => CLAIM.answerClaimWithForm(env2, { id: C1, name: NAME }, "+" + C1_PHONE, "ابي طماطم"))) === false && flowsTo(C1_PHONE).length === 0);
  // outside his window nothing goes and nothing is held
  const env3 = world();
  env3.MSG_DEDUP.store.delete(`wa_win:v1:${C1_PHONE}`);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: C1, x_processed_at: utc("2026-10-01 01:00"), x_status: "received" });
  const shut = await quiet(() => TR.sendTransferForm(env3, c1));
  assert("his 24h window closed: no form, no template, nothing held, no token kept", shut.sent === false && shut.reason === "window_closed" && sentTo(C1_PHONE).length === 0 && heldFor(env3, C1_PHONE).length === 0 && ![...env3.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("transfer_t:")));
  const src = srcOf("transfer-form.ts");
  assert("the form is never held: noHold on its send, and no template", /noHold: true,/.test(src) && !/kind: "template"/.test(src));
}
{
  // a number of a supplier or a price source never gets the customer's form
  const env = world();
  openWindow(env, AHMED_PHONE);
  const r = await quiet(() => TR.sendTransferForm(env, { ...c1, whatsapp: "+" + AHMED_PHONE }));
  assert("a supplier's number named as the customer's: no form («closed_number»), nothing sent", r.sent === false && r.reason === "closed_number" && sentTo(AHMED_PHONE).length === 0, JSON.stringify(r));
  await say(env, AHMED_PHONE, text("حولت"));
  assert("«حولت» from the supplier himself through the webhook: no transfer form", flowsTo(AHMED_PHONE).every((b: any) => par(b).flow_id !== TR.TRANSFER_FLOW_ID || !TR.isTransferToken(tokenOf(b))));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د4
console.log("\n[د4] the door of the invoice: «🏦 أرسلت تحويل» under its free text, never on a template");
{
  const env = world(`${DAY} 14:00`);
  const issued = await quiet(() => INVOICE.createAndDispatchInvoiceForOrder(env, order(C1, "delivered", DAY, 1, { x_delivery_neighborhood: "العليا" })));
  const m = sentTo(C1_PHONE).find((b: any) => /فاتورتك رقم/.test(bodyOf(b)));
  assert("the invoice's free text is a button message: its text as it was, and ONE button — transfer_notice «🏦 أرسلت تحويل»", !!issued && m?.interactive?.type === "button" && bodyOf(m).startsWith(`🧾 فاتورتك رقم ${issued!.number}`) && bodyOf(m).endsWith("شكراً لتعاملكم مع UTAK 🌿")
    && JSON.stringify(m.interactive.action.buttons) === JSON.stringify([{ type: "reply", reply: { id: "transfer_notice", title: "🏦 أرسلت تحويل" } }]), JSON.stringify(m));
  assert("the button's title is within Meta's twenty characters", count(TR.TRANSFER_BUTTON_TITLE) <= 20 && TR.TRANSFER_BUTTON === "transfer_notice" && JSON.stringify(TR.transferNoticeButton()) === JSON.stringify({ id: "transfer_notice", title: "🏦 أرسلت تحويل" }));
  graph.length = 0;
  await say(env, C1_PHONE, button("transfer_notice", "🏦 أرسلت تحويل"));
  assert("tapping it → ONE message: the form — and an invoice the PILOT worker made (x_is_simulation, as every row of this test's worker) is not in it", sentTo(C1_PHONE).length === 1 && flowsTo(C1_PHONE).length === 1 && table("x_invoice").get(issued!.invoiceId)!.x_is_simulation === true && dataOf(flowsTo(C1_PHONE)[0]).invs.length === 3, JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  // the same invoice as prod makes it: no flag
  table("x_invoice").get(issued!.invoiceId)!.x_is_simulation = false;
  table("x_daily_order").get(table("x_invoice").get(issued!.invoiceId)!.x_order_id as number)!.x_is_simulation = false;
  graph.length = 0;
  await say(env, C1_PHONE, button("transfer_notice", "🏦 أرسلت تحويل"));
  assert("…as prod makes it (no flag): his FOUR open invoices, the new one the newest", flowsTo(C1_PHONE).length === 1 && dataOf(flowsTo(C1_PHONE)[0]).invs.length === 4 && dataOf(flowsTo(C1_PHONE)[0]).invs[3].description.startsWith(issued!.number), JSON.stringify(dataOf(flowsTo(C1_PHONE)[0]).invs?.map((x: any) => x.description)));
  const src = srcOf("invoice.ts");
  assert("the two invoice templates carry no such button: it is on the session option alone", src.includes("const options: GwOption[] = [...(pdfTemplate ? [pdfTemplate] : []), textTemplate, sessionInvoice];") && !/buttons: \[\{ index: 0, payload: `transfer/.test(src) && !/TRANSFER_BUTTON/.test(src.split("const textTemplate")[1].split("const sessionInvoice")[0]));
}
{
  // an approved UTILITY template goes first, as before: no button on it
  const env = world();
  seed("x_whatsapp_template", { id: 960, x_purpose: "customer_invoice", x_meta_template_id: "utak_invoice_customer_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 4, x_category: "UTILITY" });
  await quiet(() => INVOICE.createAndDispatchInvoiceForOrder(env, order(C1, "delivered", DAY, 1, { x_delivery_neighborhood: "العليا" })));
  const t = sentTo(C1_PHONE).find((b: any) => b?.template?.name === "utak_invoice_customer_v2");
  assert("with an approved invoice template the invoice goes by it — and carries no transfer button", !!t && !JSON.stringify(t).includes("transfer_notice") && !sentTo(C1_PHONE).some((b: any) => b?.interactive?.type === "button"), JSON.stringify(sentTo(C1_PHONE).map((b: any) => b?.template?.name ?? b?.type)));
}
{
  // an invoice longer than a button message's body goes as the plain text it was, whole
  const env = world();
  const o = seed("x_daily_order", { x_customer_id: C1, x_state: "delivered", x_order_date: DAY, x_created_via: "whatsapp", x_delivery_neighborhood: "العليا" });
  for (let k = 0; k < 40; k++) seed("x_daily_order_line", { x_order_id: o, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 3, x_unit_price: 20, x_status: "pending" });
  await quiet(() => INVOICE.createAndDispatchInvoiceForOrder(env, o));
  const m = sentTo(C1_PHONE).find((b: any) => /فاتورتك رقم/.test(bodyOf(b)));
  assert("a 40-line invoice (more than 1024 characters): plain text, whole — never cut to fit a button", m?.type === "text" && bodyOf(m).length > 1024 && bodyOf(m).endsWith("شكراً لتعاملكم مع UTAK 🌿"), `${m?.type} ${bodyOf(m).length}`);
}
{
  const env = world();
  for (const id of [INV_A, INV_B, INV_C]) table("x_invoice").get(id)!.x_status = "paid";
  await say(env, C1_PHONE, button("transfer_notice"));
  assert("the button with nothing open (the invoice was paid since): one line — «ما عليك فواتير مفتوحة عندنا الآن ✅»", flowsTo(C1_PHONE).length === 0 && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([TR.TRANSFER_NONE_TEXT]), JSON.stringify(textsTo(C1_PHONE)));
  const env2 = world();
  metaRefusesFlow = true;
  await say(env2, C1_PHONE, button("transfer_notice"));
  metaRefusesFlow = false;
  assert("the button when the form cannot go: one line saying so, asking for the receipt's photo", textsTo(C1_PHONE).includes(TR.TRANSFER_FAILED_TEXT));
  assert("answerTransferButton with no partner: the same line, nothing read", (await quiet(() => TR.answerTransferButton(env2, null))).text === TR.TRANSFER_FAILED_TEXT);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د5
console.log("\n[د5] the door of the image: read by Claude as a transfer receipt, the form opened on what was read");
{
  const env = world();
  // the extraction model has its own name here: the classifier's is «m»
  env.CLAUDE_MODEL_REPLY = "the-extraction-model";
  setExtract(RECEIPT);
  const r = await say(env, C1_PHONE, image("TRNPH_R1"));
  const f = flowsTo(C1_PHONE), d = dataOf(f[0]);
  assert("a receipt's photo from a customer with open invoices → ONE message: the form", r.status === 200 && sentTo(C1_PHONE).length === 1 && f.length === 1, JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  assert("…opened on what was read: the amount 500, the date 2 Oct, the reference", d.amt === "500" && d.d === "2026-10-02" && d.ref === "FT26276001" && d.max === DAY, JSON.stringify([d.amt, d.d, d.ref]));
  assert("…its line says the photo is already with us, and its text says what was read", d.how === TR.TRANSFER_HOW_WITH_PHOTO_TEXT && bodyOf(f[0]) === ["🏦 إشعار تحويل", "قرأنا من إيصالك: المبلغ 500 ر.س · التاريخ 2 أكتوبر 2026 · المرجع FT26276001. راجعها في النموذج وصحّحها لو لزم.", `اضغط «إشعار تحويل»: ${TR.TRANSFER_HOW_WITH_PHOTO_TEXT}`].join("\n"), bodyOf(f[0]));
  const tok = JSON.parse(env.MSG_DEDUP.store.get(TR.transferTokenKey(tokenOf(f[0]))));
  assert("the image stays with the form's token: its media id and what was read", tok.media.id === "TRNPH_R1" && tok.media.mime === "image/jpeg" && JSON.stringify(tok.read) === JSON.stringify({ amount: 500, date: "2026-10-02", reference: "FT26276001" }) && tok.to === C1_PHONE && tok.partnerId === C1);
  assert("not the old «وصلتنا صورة» reply, and no «📎 صورة من عميل» alert to Baraa", !textsTo(C1_PHONE).some((t: string) => t.includes("وصلتنا صورة")) && sentTo(OWNER).length === 0);
  const q = claudeCalls.at(-1);
  assert("Claude was asked ONCE, by the extraction model (not the classifier's), under the receipt's instruction, with the image as a base64 block before the question", claudeCalls.length === 1 && q.model === "the-extraction-model" && env.CLAUDE_MODEL_CLASSIFY !== q.model && q.system === CONFIG.SYSTEM_PROMPT_READ_TRANSFER_RECEIPT && q.messages.length === 1 && q.messages[0].content[0].type === "image"
    && q.messages[0].content[0].source.type === "base64" && q.messages[0].content[0].source.media_type === "image/jpeg" && q.messages[0].content[0].source.data === Buffer.from(MEDIA_BYTES).toString("base64") && q.messages[0].content[1].type === "text", JSON.stringify(q).slice(0, 300));
  // a refused form (no invoice ticked): the fresh one still has the photo that came before the first
  graph.length = 0;
  const refusedOnce = await reply(env, C1_PHONE, tokenOf(f[0]), { inv: [], amt: "500", date: "2026-10-02", ref: "FT26276001", note: "" });
  const fresh2 = flowsTo(C1_PHONE)[0], tok2 = JSON.parse(env.MSG_DEDUP.store.get(TR.transferTokenKey(tokenOf(fresh2))));
  assert("a form refused for another reason: the fresh one keeps the photo that came before it — its token, and its line «صورة إيصالك وصلتنا»", refusedOnce.action === "invalid" && JSON.stringify(refusedOnce.problems) === JSON.stringify(["inv"]) && tok2.media?.id === "TRNPH_R1" && tok2.read?.reference === "FT26276001" && dataOf(fresh2).how === TR.TRANSFER_HOW_WITH_PHOTO_TEXT, JSON.stringify(tok2));
  // «إرسال» with no photo in the form: the earlier one is the notice's
  graph.length = 0;
  const out = await reply(env, C1_PHONE, tokenOf(fresh2), { inv: [String(INV_A)], amt: "500", date: "2026-10-02", ref: "FT26276001", note: "" });
  assert("«إرسال» without a photo in the form: accepted — the photo that came before it is the notice's", out.action === "noticed" && notices(env)[0].media.id === "TRNPH_R1" && ownerNotices()[0].interactive.header.image.id === "TRNPH_R1", JSON.stringify(out));
  assert("…and Claude is not asked a second time for it", claudeCalls.length === 1);
}
{
  const env = world();
  setExtract({ receipt: true, amount: 500, date: "2026-10-02", reference: "FT1" });
  await say(env, C1_PHONE, { type: "document", document: { id: "TRNPH_PDF1", mime_type: "application/pdf", filename: "receipt.pdf" } });
  const q = claudeCalls.at(-1);
  assert("a PDF receipt: handed to Claude as a document block, and the form goes", flowsTo(C1_PHONE).length === 1 && q.messages[0].content[0].type === "document" && q.messages[0].content[0].source.media_type === "application/pdf");
}
{
  // not a receipt, or not read: the media's old answer, unchanged
  const OLD = "وصلتنا صورة ✅ الفريق بيتابعها ويرد عليك قريب. ولو هي طلب، تقدر تكتب الأصناف والكميات نصاً عشان تتسجل مباشرة 🌿";
  const env = world();
  setExtract({ receipt: false, amount: null, date: null, reference: null });
  await say(env, C1_PHONE, image("TRNPH_N1"));
  assert("Claude says it is NOT a receipt: the old reply «وصلتنا صورة…» and the alert to Baraa, word for word", flowsTo(C1_PHONE).length === 0 && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([OLD]) && sentTo(OWNER).filter((b: any) => bodyOf(b).startsWith("📎 صورة من عميل")).length === 1 && claudeCalls.length === 1, JSON.stringify(textsTo(C1_PHONE)));
  const env2 = world();
  setExtract(RECEIPT); claudeDown = true;
  await say(env2, C1_PHONE, image("TRNPH_N2"));
  claudeDown = false;
  assert("Claude unreachable: not read — the old reply (the read never throws)", flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).includes(OLD));
  const env3 = world();
  setExtract(RECEIPT);
  await say(env3, C1_PHONE, image("TRNPH_BAD1"));
  assert("the image cannot be fetched from Meta: the old reply, and Claude is not asked", flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).includes(OLD) && claudeCalls.length === 0);
  const env4 = world();
  for (const id of [INV_A, INV_B, INV_C]) table("x_invoice").get(id)!.x_status = "paid";
  setExtract(RECEIPT);
  await say(env4, C1_PHONE, image("TRNPH_R2"));
  assert("a customer with NO open invoice: Claude is NOT asked at all — the old reply", claudeCalls.length === 0 && flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).includes(OLD));
  const env5 = world();
  setExtract({ receipt: false });
  await markPayRemindSent(env5, C1, 620);
  await say(env5, C1_PHONE, image("TRNPH_N3"));
  assert("not a receipt within 48h of a reminder: «وصلنا الإيصال، والمحصّل بيتأكد», as before", flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).includes(CLAIM.PAY_RECEIPT_REPLY));
  const env7 = world();
  setExtract(RECEIPT);
  odooDown = "x_invoice";
  await say(env7, C1_PHONE, image("TRNPH_R3"));
  odooDown = "";
  assert("his invoices cannot be read: the old reply all the same — the image's door never throws, and Claude is not asked", textsTo(C1_PHONE).includes(OLD) && flowsTo(C1_PHONE).length === 0 && claudeCalls.length === 0, JSON.stringify(textsTo(C1_PHONE)));
  const env6 = world();
  setExtract(RECEIPT);
  await say(env6, CUST2_PHONE, { type: "audio", audio: { id: "TRNPH_A1", mime_type: "audio/ogg", voice: true } });
  assert("a voice note is never read as a receipt", claudeCalls.length === 0 && flowsTo(CUST2_PHONE).length === 0);
}
{
  // what Claude answers, as the worker reads it
  const env = world();
  const file = { base64: "AAAA", mime: "image/jpeg" };
  const read = async (answer: unknown) => { setExtract(answer); return quiet(() => TR.readTransferReceipt(env, file, DAY)); };
  assert("a receipt with every field", JSON.stringify(await read(RECEIPT)) === JSON.stringify({ amount: 500, date: "2026-10-02", reference: "FT26276001" }));
  assert("`receipt` must be TRUE: false, missing, «yes», or an array is not a receipt", (await read({ receipt: false, amount: 500 })) === null && (await read({ amount: 500, date: DAY })) === null && (await read({ receipt: "yes", amount: 500 })) === null && (await read([RECEIPT])) === null);
  assert("a field that cannot be what it says is left out, the receipt stays: a date after today, a Hijri date, an amount of 0, a negative one", JSON.stringify(await read({ receipt: true, amount: 0, date: "2026-10-04", reference: null })) === "{}"
    && JSON.stringify(await read({ receipt: true, amount: -5, date: "1448-04-21", reference: "  AB 12  " })) === JSON.stringify({ reference: "AB 12" }) && JSON.stringify(await read({ receipt: true, amount: 120.456, date: DAY })) === JSON.stringify({ amount: 120.46, date: DAY }));
  claudeCalls.length = 0;
  assert("a file that is neither an image nor a PDF, an empty one, one too large: not read — and Claude is not called", (await quiet(() => CLAUDE.readDocumentJson(env, { base64: "AAAA", mime: "audio/ogg" }, "s"))) === null && (await quiet(() => CLAUDE.readDocumentJson(env, { base64: "", mime: "image/png" }, "s"))) === null
    && (await quiet(() => CLAUDE.readDocumentJson(env, { base64: "A".repeat(CLAUDE.READ_DOCUMENT_MAX_BASE64 + 1), mime: "image/png" }, "s"))) === null && claudeCalls.length === 0);
  setExtract(RECEIPT); claudeDown = true;
  const down = await quiet(async () => { try { return [await CLAUDE.readDocumentJson(env, file, "s"), await TR.readTransferReceipt(env, file, DAY)]; } catch (e) { return `threw: ${(e as Error).message}`; } });
  claudeDown = false;
  assert("Claude unreachable: readDocumentJson answers null — it NEVER throws — and the receipt is «not read»", JSON.stringify(down) === "[null,null]", JSON.stringify(down));
  setExtract({ a: 1 });
  assert("readDocumentJson is the instruction's own: any system prompt, one JSON object back («image/jpeg; x» is an image)", JSON.stringify(await quiet(() => CLAUDE.readDocumentJson(env, { base64: "AAAA", mime: "image/jpeg; x" }, "another instruction"))) === JSON.stringify({ a: 1 }) && claudeCalls.at(-1).system === "another instruction" && claudeCalls.at(-1).messages[0].content[0].source.media_type === "image/jpeg");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د6
console.log("\n[د6] «إرسال»: NOTHING is paid — the notice is kept, the receipt goes on each invoice, two messages");
{
  const env = world();
  const before = money();
  const puts: Array<[string, any]> = [];
  const put = env.MSG_DEDUP.put.bind(env.MSG_DEDUP);
  env.MSG_DEDUP.put = async (k: string, v: string, o?: any) => { puts.push([k, o]); return put(k, v); };
  await quiet(() => TR.sendTransferForm(env, c1));
  const f = flowsTo(C1_PHONE)[0];
  setExtract({ receipt: true, amount: 500, date: DAY, reference: "FT26276001" });
  graph.length = 0; odooLog.length = 0;
  const r = await reply(env, C1_PHONE, tokenOf(f), { ...good, ref: "", note: "  من حساب\nالراجحي " });
  await settle();
  const n = notices(env)[0];
  assert("the reply is a notice",r.action === "noticed" && r.amount === 500 && r.noticeId === n.id && /^[a-f0-9]{10}$/.test(n.id), JSON.stringify(r));
  assert("NOTHING is paid: no x_payment, no account.payment, no entry — and no invoice or order changed", money() === before && !odooLog.some((c: any) => c.model === "x_payment" && c.method === "create") && !odooLog.some((c: any) => /^account\.payment/.test(c.model)));
  assert("the notice is kept in KV thirty days: who, his number, the invoices (the oldest first, with what was left), the amount, the date, the reference, the note, the photo", n.v === 1 && n.partnerId === C1 && n.name === NAME && n.to === C1_PHONE && n.amount === 500 && n.date === DAY && n.reference === "FT26276001" && n.note === "من حساب الراجحي"
    && JSON.stringify(n.invoices) === JSON.stringify([{ id: INV_A, number: N_A, remaining: 300 }, { id: INV_B, number: N_B, remaining: 200 }]) && n.media.id === "TRNPH_F1" && !n.decided
    && TR.TRANSFER_KEEP_SEC === 30 * 24 * 3600 && puts.some(([k, o]) => k === TR.transferNoticeKey(n.id) && o?.expirationTtl === 2592000) && TR.transferNoticeKey("ab") === "transfer_notice:v1:ab", JSON.stringify(n));
  // ---- in Odoo: the receipt on each chosen invoice
  const att = rows("ir.attachment") as any[], posts = odooLog.filter((c: any) => c.method === "message_post" && c.model === "account.move");
  assert("the receipt is attached to EACH chosen invoice's account.move — and not to the one he did not tick", att.length === 2 && JSON.stringify(att.map((a) => [a.res_model, a.res_id])) === JSON.stringify([["account.move", M_A], ["account.move", M_B]])
    && att.every((a) => a.raw === Buffer.from(MEDIA_BYTES).toString("base64") && a.mimetype === "image/jpeg" && a.name === `إيصال-تحويل-TRN-${n.id}.jpg` && !("datas" in a)), JSON.stringify(att.map((a) => [a.res_model, a.res_id, a.name])));
  assert("…with ONE note in each one's log, carrying its attachment: an internal note saying no payment is recorded", posts.length === 2 && JSON.stringify(posts.map((c: any) => c.body.ids)) === JSON.stringify([[M_A], [M_B]]) && posts.every((c: any, k: number) => JSON.stringify(c.body.attachment_ids) === JSON.stringify([att[k].id]) && c.body.subtype_xmlid === "mail.mt_note"
    && c.body.body === `إشعار تحويل من العميل ${NAME} (TRN-${n.id}): 500 ر.س بتاريخ ${LABEL} — المرجع FT26276001. بانتظار تأكيد وصوله للحساب، ولم تُسجَّل دفعة.`), JSON.stringify(posts.map((c: any) => c.body)));
  assert("the ONLY writes in Odoo: the two attachments, the two notes, and the gateway's own record of each message", odooWrites().every((c: any) => gatewayRecord(c) || (c.model === "ir.attachment" && c.method === "create") || (c.model === "account.move" && c.method === "message_post")), JSON.stringify([...new Set(odooWrites().filter((c: any) => !gatewayRecord(c)).map((c: any) => `${c.model}.${c.method}`))]));
  // ---- the two messages
  assert("the customer reads: «وصلنا إشعار تحويلك بمبلغ 500 ر.س — نأكد لك أول ما يوصل الحساب»", JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify(["وصلنا إشعار تحويلك بمبلغ 500 ر.س — نأكد لك أول ما يوصل الحساب"]) && sentTo(C1_PHONE).length === 1, JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  const o = ownerNotices();
  assert("Baraa gets ONE message: the customer, the invoices, the amount, the date, the reference, his note", o.length === 1 && sentTo(OWNER).length === 1 && bodyOf(o[0]) === [
    `🏦 إشعار تحويل — ${NAME}`, "الفواتير:", `• ${N_A} — المتبقي 300 ر.س`, `• ${N_B} — المتبقي 200 ر.س`,
    "المبلغ المحوّل: 500 ر.س (يطابق المتبقي على المختارة)", `تاريخ التحويل: ${LABEL}`, "المرجع: FT26276001", "ملاحظته: من حساب الراجحي", "وصل الحساب؟ 👇",
  ].join("\n"), bodyOf(o[0]));
  assert("…with the receipt as its header (the media Meta already holds), and the two buttons «✅ وصل» / «❌ ما وصل»", JSON.stringify(o[0].interactive.header) === JSON.stringify({ type: "image", image: { id: "TRNPH_F1" } })
    && JSON.stringify(o[0].interactive.action.buttons) === JSON.stringify([{ type: "reply", reply: { id: `trn_ok_${n.id}`, title: "✅ وصل" } }, { type: "reply", reply: { id: `trn_no_${n.id}`, title: "❌ ما وصل" } }]) && bodyOf(o[0]).length <= 1024);
  assert("…and nobody else is told: not the collectors, not the driver", graph.filter(Boolean).every((b: any) => b.to === C1_PHONE || b.to === OWNER) && graph.filter(Boolean).length === 2);
  assert("the form's own photo was read by Claude for its reference (he typed none)", claudeCalls.length === 1 && n.reference === "FT26276001");
  assert("each message is recorded under its purpose: the customer's form, Baraa's notice", rows("x_wa_message").some((m: any) => /"purpose":"customer_transfer_form"/.test(String(m.x_debug_payload))) && rows("x_wa_message").some((m: any) => /"purpose":"owner_transfer_notice"/.test(String(m.x_debug_payload))));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // what he typed stands; what the image says differently reaches Baraa in one line
  const env = world();
  setExtract({ receipt: true, amount: 450, date: "2026-10-01", reference: "IMG-REF" });
  const { n } = await notice(env, { ...good, ref: "TYPED-REF", date: "2026-10-02" });
  assert("his own amount, date and reference stand: 500, 2 Oct, «TYPED-REF»", n.amount === 500 && n.date === "2026-10-02" && n.reference === "TYPED-REF");
  assert("…and Baraa reads, in ONE line, what the image says differently — the notice is not blocked", bodyOf(ownerNotices()[0]).split("\n").filter((l: string) => l.startsWith("⚠️")).join("|") === "⚠️ الصورة تقول غير ما كتب: المبلغ 450 ر.س (كتب 500 ر.س) · التاريخ 1 أكتوبر 2026 (كتب 2 أكتوبر 2026)", bodyOf(ownerNotices()[0]));
  assert("an image that agrees adds no line; one that gives no amount adds none for it", TR.mismatchLine({ amount: 500, date: DAY }, { amount: 500, date: DAY }) === "" && TR.mismatchLine({ amount: 500, date: DAY }, { reference: "x" }) === "" && TR.mismatchLine({ amount: 500, date: DAY }, null) === ""
    && TR.mismatchLine({ amount: 500, date: DAY }, { amount: 500.01 }) === "⚠️ الصورة تقول غير ما كتب: المبلغ 500.01 ر.س (كتب 500 ر.س)");
  // an image Claude does not read as a receipt: the notice still goes, and Baraa is told
  const env2 = world();
  setExtract({ receipt: false });
  const two = await notice(env2);
  assert("a form photo that Claude does not read as a receipt: the notice goes all the same, with «لم يُقرأ من الصورة شيء»", two.r.action === "noticed" && bodyOf(ownerNotices()[0]).includes(TR.TRANSFER_UNREAD_TEXT) && two.n.reference === "FT26276001");
  // amount against what is left on the ticked invoices
  assert("the amount against what is left on the ticked invoices: equal, more, less", TR.coverText(500, [{ remaining: 300 }, { remaining: 200 }]) === "يطابق المتبقي على المختارة" && TR.coverText(550.5, [{ remaining: 300 }, { remaining: 200 }]) === "يزيد عن المتبقي على المختارة بـ 50.50 ر.س"
    && TR.coverText(120, [{ remaining: 300 }]) === "أقل من المتبقي على المختارة بـ 180 ر.س");
}
{
  // an invoice with no accounting twin: the file on the x_invoice row itself
  const env = world(`${DAY} 14:00`, { twins: false });
  setExtract(RECEIPT);
  const { n } = await notice(env, { ...good, inv: [String(INV_C)], amt: "120" });
  const att = rows("ir.attachment") as any[];
  assert("no account.move: an ir.attachment on the x_invoice row, the line as its description — and no note is posted (x_invoice has no log)", att.length === 1 && att[0].res_model === "x_invoice" && att[0].res_id === INV_C && att[0].description === TR.noticeLogLine(n) && !odooLog.some((c: any) => c.method === "message_post" && c.model !== "discuss.channel"), JSON.stringify(att));
  // the photo cannot be fetched from Meta: the notice still goes, and Baraa is told
  const env2 = world();
  const bad = await notice(env2, { ...good, photo: photo("TRNPH_BAD9") });
  assert("the receipt cannot be fetched from Meta: the notice still goes — the line is kept in each invoice's log without a file, and Baraa is told which", bad.r.action === "noticed" && rows("ir.attachment").length === 0 && odooLog.filter((c: any) => c.method === "message_post" && c.model === "account.move" && !("attachment_ids" in c.body)).length === 2
    && bodyOf(ownerNotices()[0]).includes(`⚠️ تعذّر حفظ صورة الإيصال على: ${N_A}، ${N_B}`), bodyOf(ownerNotices()[0]));
  // Odoo refuses the attachment: the notice still goes
  const env3 = world();
  setExtract(RECEIPT);
  await quiet(() => TR.sendTransferForm(env3, c1));
  odooDown = "ir.attachment";
  const r3 = await reply(env3, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), good);
  odooDown = "";
  assert("Odoo refuses the file: the customer's notice is not lost — kept in KV, sent to Baraa with the line saying where it was not kept", r3.action === "noticed" && notices(env3).length === 1 && textsTo(C1_PHONE).includes(TR.transferReceivedText(500)) && bodyOf(ownerNotices()[0]).includes("⚠️ تعذّر حفظ صورة الإيصال على:"));
}
{
  // Meta refuses the header: the same message without it
  const env = world();
  setExtract(RECEIPT);
  await quiet(() => TR.sendTransferForm(env, c1));
  const token = tokenOf(flowsTo(C1_PHONE)[0]);
  metaRefusesHeader = true;
  graph.length = 0; refusedByMeta.length = 0;
  await reply(env, C1_PHONE, token, good);
  metaRefusesHeader = false;
  const sent = ownerNotices();
  assert("Meta refuses the receipt as a header: the notice is sent again WITHOUT it — the same buttons, and a line saying where the image is", refusedByMeta.length === 1 && !!refusedByMeta[0].interactive.header && sent.length === 1 && !sent[0].interactive.header && JSON.stringify(buttonsOf(sent[0])) === JSON.stringify(buttonsOf(refusedByMeta[0]))
    && buttonsOf(sent[0]).length === 2 && bodyOf(sent[0]) === `${bodyOf(refusedByMeta[0])}\n${TR.TRANSFER_NO_IMAGE_TEXT}`, JSON.stringify([refusedByMeta.length, sent.length]));
  // a PDF receipt is a document header
  const env2 = world();
  setExtract(RECEIPT);
  await quiet(() => TR.sendTransferForm(env2, c1, { media: { id: "TRNPH_PDF7", mime: "application/pdf" }, read: { amount: 500 } }));
  const pdf = await reply(env2, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), { ...good, photo: undefined });
  const h = ownerNotices()[0].interactive.header;
  assert("a PDF receipt goes to Baraa as a document header, and is kept as a .pdf", pdf.action === "noticed" && h.type === "document" && h.document.id === "TRNPH_PDF7" && /\.pdf$/.test(h.document.filename) && (rows("ir.attachment") as any[]).every((a) => a.mimetype === "application/pdf" && /\.pdf$/.test(a.name)));
  // Baraa's window closed: the notice waits for him
  const env3 = world();
  setExtract(RECEIPT); closeOwnerWindow(env3);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: 3, x_processed_at: utc("2026-10-01 01:00"), x_status: "received" });
  await notice(env3);
  const held = heldFor(env3, OWNER);
  assert("Baraa's window closed: the notice is HELD for him with its buttons and its receipt — never lost", ownerNotices().length === 0 && held.length === 1 && held[0].purpose === "owner_transfer_notice" && held[0].body.interactive.action.buttons.length === 2 && !!held[0].body.interactive.header, JSON.stringify(held.map((x: any) => x.purpose)));
  // many invoices: the message stays within 1024 characters, the amount and the reference never cut
  const many = TR.ownerNoticeText({ name: NAME, invoices: Array.from({ length: 20 }, (_, k) => ({ id: k, number: `UTAK-INV-202608${String(k + 1).padStart(2, "0")}-001`, remaining: 1234.5 })), amount: 24690, date: DAY, reference: "FT26276001", note: "ملاحظة ".repeat(40) });
  assert("twenty invoices and a long note: within a button message's 1024 characters — the amount, the date and the reference whole", count(many) <= 1024 && many.includes("الفواتير (20): 20260801-001، 20260802-001") && many.includes("المبلغ المحوّل: 24690 ر.س") && many.includes(`تاريخ التحويل: ${LABEL}`) && many.includes("المرجع: FT26276001"), String(count(many)));
  assert("no reference typed and none read: «المرجع: لم يُذكر»", TR.ownerNoticeText({ name: NAME, invoices: [{ id: 1, number: N_A, remaining: 300 }], amount: 300, date: DAY, reference: "", note: "" }).includes("المرجع: لم يُذكر"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د7
console.log("\n[د7] a field that cannot be read refuses the form as a WHOLE: nothing kept, one message, a fresh form");
{
  const a = TR.parseTransferAmount, d = (v: unknown) => TR.parseTransferDate(v, DAY);
  assert("an amount: a number > 0 with at most two decimals — «500», «500.5», «٥٠٠», «500,25»", a("500") === 500 && a("500.5") === 500.5 && a("٥٠٠") === 500 && a("500,25") === 500.25 && a(0.01) === 0.01);
  assert("anything else is not one: 0, empty, a word, negative, three decimals, a unit", ["0", "0.00", "", " ", undefined, null, "abc", "-5", "500.255", "1,234", "500 ر.س", "4e2"].every((v) => a(v) === "invalid"));
  assert("a date: YYYY-MM-DD, a real day, today or before", d(DAY) === DAY && d("2026-09-28") === "2026-09-28" && d("2024-02-29") === "2024-02-29");
  assert("anything else is not one: tomorrow, 30 February, a month 13, another format, a timestamp, empty", ["2026-10-04", "2026-02-30", "2026-13-01", "03/10/2026", "3-10-2026", "1759449600000", "", undefined, null, "اليوم"].every((v) => d(v) === "invalid"));
  assert("the ticked invoices: the ids of the list, each once — a single string, an object or nothing is no choice", JSON.stringify(TR.parseChosen(["9001", "9002", "9001", 9003])) === "[9001,9002,9003]" && [undefined, null, "", "9001", {}, [], ["x"], [0], [-1], [1.5]].every((v) => TR.parseChosen(v).length === 0));
}
{
  const env = world();
  const before = money();
  await quiet(() => TR.sendTransferForm(env, c1));
  const f = flowsTo(C1_PHONE)[0];
  graph.length = 0; odooLog.length = 0;
  const r = await reply(env, C1_PHONE, tokenOf(f), { ...good, amt: "0" });
  await settle();
  const again = flowsTo(C1_PHONE);
  assert("an amount of 0: refused — no notice, nothing in Odoo, nothing to Baraa", r.action === "invalid" && JSON.stringify(r.problems) === JSON.stringify(["amt"]) && notices(env).length === 0 && money() === before && odooWrites().every(gatewayRecord) && sentTo(OWNER).length === 0, JSON.stringify(r));
  assert("…ONE message: what is wrong, and a fresh form with a fresh token", sentTo(C1_PHONE).length === 1 && again.length === 1 && bodyOf(again[0]) === ["⚠️ ما انحفظ شيء من النموذج:", `• ${TR.TRANSFER_BAD_AMOUNT_TEXT}`, "عبّه من جديد ثم «إرسال» 👇"].join("\n") && tokenOf(again[0]) !== tokenOf(f), bodyOf(again[0]));
  const d = dataOf(again[0]);
  assert("…opened on what he wrote that was right: the two invoices ticked, the date, the reference — the amount empty", JSON.stringify(d.sel) === JSON.stringify([String(INV_A), String(INV_B)]) && d.amt === "" && d.d === DAY && d.ref === "FT26276001" && d.invs.length === 3, JSON.stringify([d.sel, d.amt, d.d, d.ref]));
  const old = await reply(env, C1_PHONE, tokenOf(f), good);
  assert("…the refused form itself is spent", old.action === "duplicate" && notices(env).length === 0);
  // each refusal's fresh form is the one the next reply answers
  let last = again[0];
  const next = async (values: Record<string, unknown>) => { const out = await reply(env, C1_PHONE, tokenOf(last), values); last = flowsTo(C1_PHONE).at(-1); return out; };
  const noInv = await next({ ...good, inv: [] });
  assert("no invoice ticked: refused", noInv.action === "invalid" && JSON.stringify(noInv.problems) === JSON.stringify(["inv"]) && bodyOf(last).includes(TR.TRANSFER_BAD_INVOICES_TEXT) && notices(env).length === 0);
  const notHis = await next({ ...good, inv: [String(INV_A), "424242"] });
  assert("an invoice that is not among his open ones (another's, or made up): refused — the right one stays ticked in the fresh form", notHis.action === "invalid" && JSON.stringify(notHis.problems) === JSON.stringify(["gone"]) && bodyOf(last).includes(TR.TRANSFER_GONE_INVOICE_TEXT) && JSON.stringify(dataOf(last).sel) === JSON.stringify([String(INV_A)]) && notices(env).length === 0);
  const future = await next({ ...good, date: "2026-10-04" });
  assert("a date after today: refused — the fresh form opens on today", future.action === "invalid" && JSON.stringify(future.problems) === JSON.stringify(["date"]) && bodyOf(last).includes(TR.TRANSFER_BAD_DATE_TEXT) && dataOf(last).d === DAY && dataOf(last).amt === "500");
  const noPhoto = await next({ ...good, photo: [] });
  assert("NO photo at all — none before the form, none in it: refused", noPhoto.action === "invalid" && JSON.stringify(noPhoto.problems) === JSON.stringify(["photo"]) && bodyOf(last).includes(TR.TRANSFER_NO_PHOTO_TEXT) && notices(env).length === 0);
  const all = await next({ inv: "9001", amt: "abc", date: "", note: "x" });
  assert("everything wrong: every reason is said, in the form's order", all.action === "invalid" && JSON.stringify(all.problems) === JSON.stringify(["inv", "amt", "date", "photo"]) && bodyOf(last).split("\n").length === 6 && dataOf(last).note === "x");
  setExtract(RECEIPT);
  const ok = await next(good);
  assert("…and the fresh form, filled right, is a notice", ok.action === "noticed" && notices(env).length === 1 && ownerNotices().length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // an invoice paid between the form and «إرسال»
  const env = world();
  await quiet(() => TR.sendTransferForm(env, c1));
  const f = flowsTo(C1_PHONE)[0];
  table("x_invoice").get(INV_A)!.x_status = "paid";
  graph.length = 0;
  const r = await reply(env, C1_PHONE, tokenOf(f), good);
  const again = flowsTo(C1_PHONE)[0];
  assert("an invoice paid since the form was sent is not open any more: refused — the fresh form lists the two that are, B still ticked", r.action === "invalid" && JSON.stringify(r.problems) === JSON.stringify(["gone"]) && dataOf(again).invs.length === 2 && JSON.stringify(dataOf(again).sel) === JSON.stringify([String(INV_B)]) && notices(env).length === 0, JSON.stringify(r));
  // another customer's invoice id in the reply
  const env2 = world();
  seed("x_daily_order", { id: 8300, x_customer_id: CUST2, x_state: "delivered" });
  seed("x_invoice", { id: 9300, x_invoice_number: "UTAK-INV-OTHER", x_order_id: 8300, x_total: 80, x_status: "issued", x_invoice_date: "2026-09-01" });
  await quiet(() => TR.sendTransferForm(env2, c1));
  const r2 = await reply(env2, C1_PHONE, tokenOf(flowsTo(C1_PHONE)[0]), { ...good, inv: ["9300"] });
  assert("ANOTHER customer's open invoice in the reply: refused — it is not his", r2.action === "invalid" && JSON.stringify(r2.problems) === JSON.stringify(["gone"]) && notices(env2).length === 0);
  // every invoice paid meanwhile: the refusal alone (no form can be built)
  const env3 = world();
  await quiet(() => TR.sendTransferForm(env3, c1));
  const f3 = flowsTo(C1_PHONE)[0];
  for (const id of [INV_A, INV_B, INV_C]) table("x_invoice").get(id)!.x_status = "paid";
  graph.length = 0;
  const r3 = await reply(env3, C1_PHONE, tokenOf(f3), good);
  assert("every invoice paid meanwhile: refused with the reason as a plain text (there is no form to send)", r3.action === "invalid" && flowsTo(C1_PHONE).length === 0 && textsTo(C1_PHONE).length === 1 && textsTo(C1_PHONE)[0].includes(TR.TRANSFER_GONE_INVOICE_TEXT));
}

// ================================================================ د8
console.log("\n[د8] the token: the number it was sent to, once");
{
  const env = world();
  setExtract(RECEIPT);
  await quiet(() => TR.sendTransferForm(env, c1));
  const token = tokenOf(flowsTo(C1_PHONE)[0]);
  assert("the token is tr1.<partner>.<random>, kept with the number", new RegExp(`^tr1\\.${C1}\\.[0-9a-f]{18}$`).test(token) && TR.isTransferToken(token) && !TR.isTransferToken("cu1.x") && !TR.isTransferToken("") && JSON.parse(env.MSG_DEDUP.store.get(TR.transferTokenKey(token))).to === C1_PHONE);
  graph.length = 0;
  const other = await reply(env, CUST2_PHONE, token, good);
  assert("the same token from ANOTHER number: nothing read, nothing kept, one line to that number, nothing to Baraa", other.action === "unknown" && notices(env).length === 0 && JSON.stringify(textsTo(CUST2_PHONE)) === JSON.stringify([TR.TRANSFER_UNKNOWN_TEXT]) && sentTo(OWNER).length === 0);
  const made = await reply(env, C1_PHONE, `tr1.${C1}.000000000000000000`, good);
  assert("a token the worker never issued: nothing kept", made.action === "unknown" && notices(env).length === 0);
  const ok = await reply(env, C1_PHONE, token, good);
  graph.length = 0;
  const twice = await reply(env, C1_PHONE, token, { ...good, amt: "900" });
  assert("a second «إرسال» of the same form: not kept again — one notice, one line, nothing more to Baraa", ok.action === "noticed" && twice.action === "duplicate" && notices(env).length === 1 && notices(env)[0].amount === 500 && JSON.stringify(textsTo(C1_PHONE)) === JSON.stringify([TR.TRANSFER_USED_TEXT]) && sentTo(OWNER).length === 0);
  // through the webhook, by the token's prefix
  const env2 = world();
  setExtract(RECEIPT);
  await say(env2, C1_PHONE, text("تحويل"));
  const res = await say(env2, C1_PHONE, nfm(tokenOf(flowsTo(C1_PHONE)[0]), good));
  assert("the Flow's reply through the webhook is routed by its «tr1.» token: a notice — and no price row is written from it", res.status === 200 && notices(env2).length === 1 && rows("x_daily_price").length === 1 && rows("x_price_offer").length === 1);
  const idx = srcOf("index.ts");
  assert("the reply is routed by its token before the price form's reader, right after the custody form's", idx.indexOf("isTransferToken(msg.flow.token") > idx.indexOf("isCustodyToken(msg.flow.token") && idx.indexOf("isTransferToken(msg.flow.token") < idx.indexOf("isDeliveryFormToken(msg.flow.token") && idx.indexOf("isTransferToken(msg.flow.token") < idx.indexOf("handlePriceFlowReply(env, msg, ctx)"));
  assert("the reply as one line of the inbox: the ticked ids as they are, the photo as «📎 صورة»", META.flowReplyText({ token: "t", values: good }) === "📝 رد النموذج: 9001، 9002 · 500 · 2026-10-03 · FT26276001 · 📎 صورة" && META.flowReplyText({ token: "t", values: { inv: [], photo: [] } }) === "📝 رد النموذج (بلا قيم)"
    && META.flowReplyText({ token: "t", values: { photo: photo("A").concat(photo("B")) } }) === "📝 رد النموذج: 📎 صورة × 2");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د9
console.log("\n[د9] «✅ وصل», the custom ledger: the chosen invoices, the oldest first, each up to what is left on it");
{
  const env = world();
  setExtract(RECEIPT);
  const { id } = await notice(env, { ...good, date: "2026-10-01" });
  graph.length = 0; odooLog.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  const pays = (rows("x_payment") as any[]).filter((p) => p.id !== 7001);
  assert("500 over A (300 left) and B (200 left): two x_payment rows — 300 on the OLDER, then 200", r?.action === "confirmed" && pays.length === 2 && JSON.stringify(pays.map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_A, 300], [INV_B, 200]]) && r.excess === 0 && JSON.stringify(r.payments) === JSON.stringify(pays.map((p) => p.id)), JSON.stringify(pays));
  assert("…each a TRANSFER, dated the day of the transfer (1 Oct, noon in Riyadh), with the notice and the reference in its note, and no collector", pays.every((p) => p.x_method === "transfer" && p.x_collected_at === "2026-10-01 09:00:00" && p.x_notes === `إشعار تحويل TRN-${id} — المرجع FT26276001` && !p.x_collected_by));
  assert("both invoices are paid, and their orders closed — the third is untouched", table("x_invoice").get(INV_A)!.x_status === "paid" && table("x_invoice").get(INV_B)!.x_status === "paid" && table("x_invoice").get(INV_C)!.x_status === "issued"
    && table("x_daily_order").get(O_A)!.x_state === "closed" && table("x_daily_order").get(O_B)!.x_state === "closed" && table("x_daily_order").get(O_C)!.x_state === "delivered");
  assert("the customer reads ONE message (§ 58 أ): the amount and what was paid on each invoice", JSON.stringify(sentTo(C1_PHONE).map(bodyOf)) === JSON.stringify([`استلمنا تحويلك 500 ريال ✅ وسددنا: فاتورة ${N_A} (300 ريال)، فاتورة ${N_B} (200 ريال)`]), JSON.stringify(sentTo(C1_PHONE).map(bodyOf)));
  assert("Baraa reads what was recorded", JSON.stringify(textsTo(OWNER)) === JSON.stringify([[
    `✅ سُجّل تحويل ${NAME}: 500 ر.س — 1 أكتوبر 2026 — المرجع FT26276001`, `• ${N_A}: 300 ر.س (سُدّدت كاملة)`, `• ${N_B}: 200 ر.س (سُدّدت كاملة)`, "أُبلغ العميل برسالة واحدة.",
  ].join("\n")]), textsTo(OWNER).join("\n---\n"));
  assert("ACCOUNTING_SYNC off: no account.payment, no wizard — the x_payment rows alone", wizardCalls.length === 0 && !odooLog.some((c: any) => /^account\./.test(c.model)) && rows("account.payment").length === 0 && pays.every((p) => !p.x_account_payment_id));
  assert("the notice is marked decided", notices(env)[0].decided.how === "ok" && notices(env)[0].decided.excess === 0 && notices(env)[0].decided.at === Date.now());
  await settle();
  const recorded = (purpose: string) => (rows("x_wa_message") as any[]).filter((m) => new RegExp(`"purpose":"${purpose}"`).test(String(m.x_debug_payload))).map((m) => String(m.x_body));
  assert("the customer's line goes under the decision's purpose, Baraa's under his own", recorded("customer_transfer_decision").length === 1 && confirmed(recorded("customer_transfer_decision")[0]) && recorded("owner_transfer_notice").length === 2 && recorded("owner_transfer_notice")[1].startsWith("✅ سُجّل تحويل"), JSON.stringify(recorded("owner_transfer_notice")).slice(0, 200));
  // what Odoo's automation #1 then does for each new x_payment (the collection's own receipt, src/payment-confirm.ts)
  const PAYCONF = await import("../src/payment-confirm.ts");
  graph.length = 0;
  const outs: any[] = [];
  for (const p of pays) outs.push(await quiet(() => PAYCONF.confirmPaymentToCustomer(env, p.id)));
  assert("§ 58 أ — no row of the notice gets a message of its own: the per-payment confirmation finds the notice's mark in its note and sends nothing", outs.every((o) => o.action === "transfer_notice") && sentTo(C1_PHONE).length === 0, JSON.stringify(outs));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  // a transfer of today is collected now
  const env = world(`${DAY} 14:00`);
  setExtract(RECEIPT);
  const { id } = await notice(env, { ...good, inv: [String(INV_A)], amt: "300" });
  setRiyadh(`${DAY} 16:30`);
  await tap(env, `trn_ok_${id}`);
  assert("a transfer dated TODAY is collected at the moment of «✅ وصل» (16:30 Riyadh)", (rows("x_payment") as any[]).at(-1).x_collected_at === utc(`${DAY} 16:30`));
}
{
  // less than what is left on the first: a partial payment on it alone
  const env = world();
  setExtract(RECEIPT);
  const { id } = await notice(env, { ...good, amt: "120" });
  graph.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  const pays = (rows("x_payment") as any[]).filter((p) => p.id !== 7001);
  assert("120 over A (300) and B (200): ALL of it on the older one — A stays issued, B is not touched", r?.excess === 0 && JSON.stringify(pays.map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_A, 120]]) && table("x_invoice").get(INV_A)!.x_status === "issued" && table("x_daily_order").get(O_A)!.x_state === "delivered");
  assert("…Baraa reads «جزئي»", textsTo(OWNER)[0].split("\n")[1] === `• ${N_A}: 120 ر.س (جزئي)`, textsTo(OWNER)[0]);
  assert("the next notice sees what is left: A 180", (await quiet(() => TR.openInvoices(env, C1)))[0].remaining === 180);
}
{
  // more than what is left on the chosen ones: the excess is his credit, never put on an invoice he did not tick
  const env = world();
  setExtract(RECEIPT);
  const { id } = await notice(env, { ...good, amt: "560.5" });
  assert("before the tap Baraa reads that it is more than what is left on the ticked ones", bodyOf(ownerNotices()[0]).includes("المبلغ المحوّل: 560.50 ر.س (يزيد عن المتبقي على المختارة بـ 60.50 ر.س)"));
  graph.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  const pays = (rows("x_payment") as any[]).filter((p) => p.id !== 7001);
  assert("560.50 over A and B (500 left): 300 + 200 — the 60.50 over is NOT put on C, the invoice he did not tick", r?.excess === 60.5 && JSON.stringify(pays.map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_A, 300], [INV_B, 200]]) && table("x_invoice").get(INV_C)!.x_status === "issued" && !pays.some((p) => p.x_invoice_id === INV_C));
  assert("…and Baraa reads «زيادة 60.50 ر.س باقية رصيداً للعميل» — with the books off it lives in that message alone", textsTo(OWNER)[0].split("\n")[3] === "زيادة 60.50 ر.س باقية رصيداً للعميل (لا قيد لها: سجّلها يدوياً لو لزم)" && notices(env)[0].decided.excess === 60.5, textsTo(OWNER)[0]);
  const plan = TR.allocateTransfer([{ id: 1, number: "a", remaining: 300 }, { id: 2, number: "b", remaining: 200 }], 560.5);
  assert("the plan, pure: the oldest first, each up to what is left, the rest the excess — as the ledger recorded it", JSON.stringify(plan) === JSON.stringify({ rows: [{ invoiceId: 1, number: "a", amount: 300, paid: true }, { invoiceId: 2, number: "b", amount: 200, paid: true }], excess: 60.5 })
    && JSON.stringify(TR.allocateTransfer([{ id: 1, number: "a", remaining: 300 }, { id: 2, number: "b", remaining: 200 }], 350.25).rows.map((x: any) => [x.amount, x.paid])) === JSON.stringify([[300, true], [50.25, false]]) && TR.allocateTransfer([{ id: 1, number: "a", remaining: 300 }], 0.1 + 0.2).rows[0].amount === 0.3);
}
{
  // an invoice the collector collected in cash between the notice and the tap
  const env = world();
  setExtract(RECEIPT);
  const { id } = await notice(env);
  seed("x_payment", { x_invoice_id: INV_A, x_amount: 300, x_method: "cash", x_collected_at: utc(`${DAY} 14:30`), x_collected_by: COLL });
  table("x_invoice").get(INV_A)!.x_status = "paid";
  graph.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  const pays = (rows("x_payment") as any[]).filter((p) => p.x_method === "transfer");
  assert("A was paid in cash meanwhile: nothing more is put on it — B takes its 200, and the 300 left over is his credit", JSON.stringify(pays.map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_B, 200]]) && r?.excess === 300 && textsTo(OWNER)[0].includes("زيادة 300 ر.س باقية رصيداً للعميل"), JSON.stringify(pays));
  const env2 = world();
  setExtract(RECEIPT);
  const two = await notice(env2, { ...good, inv: [String(INV_A)], amt: "300" });
  table("x_invoice").get(INV_A)!.x_status = "paid";
  graph.length = 0;
  const r2 = await tap(env2, `trn_ok_${two.id}`);
  assert("every ticked invoice paid meanwhile: no row at all — the whole amount is his credit, and Baraa and the customer are still told", r2?.action === "confirmed" && r2.payments!.length === 0 && r2.excess === 300 && (rows("x_payment") as any[]).every((p) => p.x_method !== "transfer")
    && textsTo(OWNER)[0].includes("لم يُسجَّل شيء على فاتورة: المختارة كلها مسدّدة الآن.") && textsTo(C1_PHONE).some(confirmed));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د10
console.log("\n[د10] «✅ وصل», the books: ONE payment for the whole transfer on BNK1 — never on the bank account itself");
const books = (riyadh = `${DAY} 14:00`, o: { twins?: boolean } = {}) => { const env = world(riyadh, o); env.ACCOUNTING_SYNC = "true"; setExtract(RECEIPT); return env; };
{
  const env = books();
  const { id } = await notice(env, { ...good, amt: "560.5", date: "2026-10-01" });
  graph.length = 0; odooLog.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  const pays = (rows("x_payment") as any[]).filter((p) => p.id !== 7001), ap = rows("account.payment") as any[];
  assert("ONE wizard, ONE account.payment — for the WHOLE 560.50, not for the 500 the invoices take", wizardCalls.length === 1 && ap.length === 1 && ap[0].amount === 560.5 && r?.accountPaymentId === ap[0].id, JSON.stringify(ap));
  assert("…on BNK1, dated the day of the transfer, its memo the receipt's reference, as ONE grouped payment", JSON.stringify(wizardCalls[0].vals) === JSON.stringify({ journal_id: 13, amount: 560.5, payment_date: "2026-10-01", communication: "FT26276001", group_payment: true, id: wizardCalls[0].vals.id }) && ap[0].memo === "FT26276001" && ap[0].date === "2026-10-01");
  assert("…registered on the two chosen invoices' entries together, the oldest first — and not on C's", JSON.stringify(wizardCalls[0].active) === JSON.stringify([M_A, M_B]) && table("account.move").get(M_A)!.amount_residual === 0 && table("account.move").get(M_B)!.amount_residual === 0 && table("account.move").get(M_C)!.amount_residual === 120);
  assert("EVERY x_payment row of the notice links to that one payment — no payment a row", pays.length === 2 && pays.every((p) => p.x_account_payment_id === ap[0].id) && odooLog.filter((c: any) => c.model === "account.payment.register" && c.method === "create").length === 1);
  const lines = (rows("account.move.line") as any[]).filter((l) => l.move_id === ap[0].move_id[0]);
  assert("the debit is on 101003 «Outstanding Receipts» — NOT on the bank account 101001: the statement line will move the bank once", lines.find((l) => l.debit > 0).account_id[0] === 254 && !lines.some((l) => l.account_id[0] === 247));
  assert("the excess stays on the payment as his credit, and Baraa reads it with the line of the books", JSON.stringify(textsTo(OWNER)) === JSON.stringify([[
    `✅ سُجّل تحويل ${NAME}: 560.50 ر.س — 1 أكتوبر 2026 — المرجع FT26276001`, `• ${N_A}: 300 ر.س (سُدّدت كاملة)`, `• ${N_B}: 200 ر.س (سُدّدت كاملة)`,
    "زيادة 60.50 ر.س باقية رصيداً للعميل", TR.TRANSFER_POSTED_TEXT, "أُبلغ العميل برسالة واحدة.",
  ].join("\n")]), textsTo(OWNER).join("\n---\n"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = books();
  const { id } = await notice(env, { ...good, amt: "350" });
  await tap(env, `trn_ok_${id}`);
  assert("350 over A and B: A settled in full, B by 50 — its entry has 150 left", table("account.move").get(M_A)!.amount_residual === 0 && table("account.move").get(M_B)!.amount_residual === 150 && table("account.move").get(M_B)!.payment_state === "partial" && table("x_invoice").get(INV_B)!.x_status === "issued"
    && rows("account.payment").length === 1 && (rows("account.payment") as any[])[0].amount === 350);
  // the form's photo gave no reference and he typed none: the notice's own name is the memo
  const env2 = books();
  setExtract({ receipt: true, amount: 350 });
  const two = await notice(env2, { ...good, amt: "350", ref: "" });
  await tap(env2, `trn_ok_${two.id}`);
  assert("no reference typed and none read: the payment's memo is the notice's own name «TRN-…»", wizardCalls.at(-1)!.vals.communication === `TRN-${two.id}` && two.n.reference === "" && (rows("x_payment") as any[]).at(-1).x_notes === `إشعار تحويل TRN-${two.id}`);
}
/** A tap under one way the wizard must never be let through: the payment cancelled, the rows unlinked, Baraa told. */
async function refused(mode: typeof wizard, values: Record<string, unknown> = good): Promise<{ alert: string; ap: any[]; pays: any[]; said: string }> {
  const env = books();
  const { id } = await notice(env, values);
  wizard = mode;
  graph.length = 0;
  await tap(env, `trn_ok_${id}`);
  wizard = "ok";
  return { alert: textsTo(OWNER).find((t: string) => t.startsWith("[accounting]")) ?? "", ap: rows("account.payment") as any[], pays: (rows("x_payment") as any[]).filter((p) => p.x_method === "transfer"), said: textsTo(OWNER).at(-1) ?? "" };
}
{
  const bank = await refused("bank");
  assert("THE LOCKED CONDITION — a payment whose debit is on the journal's own bank account (101001) is REFUSED: cancelled, for it would be counted twice once the statement is uploaded", bank.ap.length === 1 && bank.ap[0].state === "canceled" && /الحساب المدين 101001 هو حساب البنك نفسه لليومية: المبلغ يُحسب مرتين عند رفع الكشف/.test(bank.alert) && bank.alert.includes(`الدفعة ${bank.ap[0].id} أُلغيت`), bank.alert);
  assert("…the x_payment rows stay (the custom ledger), unlinked; Baraa's confirmation says the books were NOT written; the customer is still told", bank.pays.length === 2 && bank.pays.every((p) => !p.x_account_payment_id) && bank.said.includes(TR.TRANSFER_NOT_POSTED_TEXT) && !bank.said.includes(TR.TRANSFER_POSTED_TEXT) && textsTo(C1_PHONE).some(confirmed), bank.said);
  const plain = await refused("plain");
  assert("a debit on an account that takes no reconciliation: refused — the payment would never be proposed to its statement line", plain.ap[0].state === "canceled" && /الحساب المدين 101009 لا يقبل المطابقة/.test(plain.alert) && plain.pays.every((p) => !p.x_account_payment_id), plain.alert);
  const other = await refused("other", { ...good, amt: "560.5" });
  assert("a payment that settled an entry he did NOT choose (C): refused", other.ap[0].state === "canceled" && other.alert.includes(`الدفعة سوّت قيداً لم يختره العميل: ${M_C}`), other.alert);
  const newest = await refused("newest", { ...good, amt: "350" });
  assert("invoices settled the newest first — not as the ledger recorded them: refused, naming each entry", newest.ap[0].state === "canceled" && newest.alert.includes(`القيد ${M_A}: سُوّي منه 150 والمسجَّل على فاتورته 300`) && newest.alert.includes(`القيد ${M_B}: سُوّي منه 200 والمسجَّل على فاتورته 50`), newest.alert);
  const capped = await refused("capped", { ...good, amt: "560.5" });
  assert("a payment for less than the transfer (the excess dropped): refused", capped.ap[0].state === "canceled" && capped.alert.includes("مبلغ الدفعة 500 ≠ المبلغ المحوّل 560.5"), capped.alert);
  const split = await refused("split");
  assert("Odoo makes a payment an invoice all the same: EVERY one of them is cancelled, and no row is linked", split.ap.length === 2 && split.ap.every((p) => p.state === "canceled") && split.alert.includes("Odoo أنشأ 2 دفعات بدل دفعة واحدة") && split.pays.every((p) => !p.x_account_payment_id) && split.said.includes(TR.TRANSFER_NOT_POSTED_TEXT), split.alert);
  const silent = await refused("silent");
  assert("the wizard's action names no payment: it is found by partner, amount, journal and date — and linked", silent.alert === "" && silent.ap.length === 1 && silent.ap[0].state === "paid" && silent.pays.every((p) => p.x_account_payment_id === silent.ap[0].id) && silent.said.includes(TR.TRANSFER_POSTED_TEXT), silent.alert);
}
{
  // an invoice with no accounting twin among the chosen: no payment is made at all
  const env = books(`${DAY} 14:00`, { twins: false });
  const { id } = await notice(env);
  graph.length = 0;
  await tap(env, `trn_ok_${id}`);
  const alert = textsTo(OWNER).find((t: string) => t.startsWith("[accounting]")) ?? "";
  assert("a chosen invoice with no account.move: NO payment is registered (never one that settles only part of what the ledger recorded) — Baraa is told which", wizardCalls.length === 0 && rows("account.payment").length === 0 && alert.includes(`بلا قيد محاسبي (account.move): ${N_A}، ${N_B}`) && alert.includes("لم تُسجَّل دفعة") && (rows("x_payment") as any[]).filter((p) => p.x_method === "transfer").length === 2, alert);
  // two partners' entries are never paid by one payment
  const env2 = books();
  const two = await notice(env2);
  table("account.move").get(M_B)!.commercial_partner_id = [CUST2, "بقالة النخيل"];
  graph.length = 0;
  await tap(env2, `trn_ok_${two.id}`);
  assert("entries of two partners: no payment — Baraa is told", wizardCalls.length === 0 && (textsTo(OWNER).find((t: string) => t.startsWith("[accounting]")) ?? "").includes("ليست لشريك واحد معروف"));
  // nothing recorded on any invoice: nothing to post
  const env3 = books();
  const three = await notice(env3, { ...good, inv: [String(INV_A)], amt: "300" });
  table("x_invoice").get(INV_A)!.x_status = "paid";
  graph.length = 0;
  await tap(env3, `trn_ok_${three.id}`);
  assert("nothing recorded on any invoice: no wizard, no alert — the excess line says it has no entry", wizardCalls.length === 0 && !textsTo(OWNER).some((t: string) => t.startsWith("[accounting]")) && textsTo(OWNER)[0].includes("زيادة 300 ر.س باقية رصيداً للعميل (لا قيد لها: سجّلها يدوياً لو لزم)"));
  // Odoo fails inside the wizard: alert, no throw
  const env4 = books();
  const four = await notice(env4);
  odooDown = "account.payment.register";
  graph.length = 0;
  const r4 = await tap(env4, `trn_ok_${four.id}`);
  odooDown = "";
  assert("Odoo refuses the wizard (a locked period, a date it will not post): no throw — the rows stay, Baraa gets the reason, the tap is finished", r4?.action === "confirmed" && r4.accountPaymentId === null && textsTo(OWNER).some((t: string) => t.startsWith("[accounting]") && t.includes("sync failed")) && notices(env4)[0].decided.how === "ok");
}
{
  // the guard, pure
  const base = {
    paymentState: "paid", paymentPartnerId: C1, paymentAmount: 500, moveId: 1, moveState: "posted",
    lines: [{ account_id: 254, account_code: "101003", account_type: "asset_current", reconcile: true, debit: 500, credit: 0 }, { account_id: 300, account_code: "102011", account_type: "asset_receivable", reconcile: true, debit: 0, credit: 500 }],
    reconciledInvoiceIds: [M_A, M_B], residualAfter: { [M_A]: 0, [M_B]: 0 },
    expectedPartnerId: C1, amount: 500, bankAccountId: 247, chosen: [{ moveId: M_A, residualBefore: 300, amount: 300 }, { moveId: M_B, residualBefore: 200, amount: 200 }],
  };
  const g = (over: Record<string, unknown>) => ACC.evaluateTransferGuard({ ...base, ...over } as any);
  assert("the payment as the tenant makes it passes", g({}).ok === true && g({}).reasons.length === 0, g({}).reasons.join(" | "));
  assert("…and each of these does not: no entry, an entry not posted, a cancelled payment, another partner, an income line", !g({ moveId: null }).ok && !g({ moveState: "draft" }).ok && !g({ paymentState: "canceled" }).ok && !g({ paymentPartnerId: CUST2 }).ok
    && !g({ lines: [...base.lines, { account_id: 400, account_code: "401001", account_type: "income", reconcile: false, debit: 0, credit: 1 }] }).ok);
  assert("…the journal's bank account unknown: refused — the guard is never skipped", !g({ bankAccountId: null }).ok && g({ bankAccountId: null }).reasons.some((x: string) => x.includes("تعذّرت قراءة حساب البنك")));
  assert("an excess that stays open on the payment is as it must be: 560.50 paid, 500 settled", g({ paymentAmount: 560.5, amount: 560.5, lines: base.lines.map((l) => ({ ...l, debit: l.debit ? 560.5 : 0, credit: l.credit ? 560.5 : 0 })) }).ok === true);
  assert("the payments an action names: one {res_id}, several in a domain, none in anything else", JSON.stringify(ACC.paymentIdsFromAction({ res_model: "account.payment", res_id: 7 })) === "[7]" && JSON.stringify(ACC.paymentIdsFromAction({ res_model: "account.payment", domain: [["id", "in", [7, 8]]] })) === "[7,8]"
    && [true, null, {}, { res_model: "account.move", res_id: 7 }, { res_model: "account.payment" }].every((x) => ACC.paymentIdsFromAction(x).length === 0));
  const env = world();
  assert("with ACCOUNTING_SYNC off syncTransferToAccounting does nothing at all", (await quiet(() => ACC.syncTransferToAccounting(env, { label: "x", rows: [{ paymentId: 1, invoiceNumber: N_A, invoiceMoveId: M_A, amount: 300 }], amount: 300, date: DAY, reference: "r" }))) === null && wizardCalls.length === 0 && sentTo(OWNER).length === 0);
}
{
  // Odoo without group_payment makes a payment an invoice: the guard's reason for refusing several
  const env = books();
  seed("account.payment.register", { id: 600, journal_id: 13, amount: 500, payment_date: DAY, communication: "x" });
  const out = await (await fetch("https://odoo.test/json/2/account.payment.register/action_create_payments", { method: "POST", body: JSON.stringify({ ids: [600], context: { active_ids: [M_A, M_B] } }) })).json() as any;
  assert("(the harness, as Odoo: without group_payment several invoices are a payment EACH, for its whole balance)", ACC.paymentIdsFromAction(out).length === 2 && (rows("account.payment") as any[]).map((p) => p.amount).join() === "300,200");
  assert("syncTransferToAccounting asks for ONE grouped payment, and cancels them all when Odoo makes several", /group_payment: true,/.test(srcOf("accounting.ts")) && srcOf("accounting.ts").includes("if (made.length > 1) return await refuse(`Odoo أنشأ ${made.length} دفعات بدل دفعة واحدة`, made);"));
}

// ================================================================ د11
console.log("\n[د11] «❌ ما وصل»: nothing is written — the customer reads one fixed text");
{
  const env = books();
  const { id } = await notice(env);
  const before = money(), atts = rows("ir.attachment").length;
  graph.length = 0; odooLog.length = 0;
  const r = await tap(env, `trn_no_${id}`);
  await settle();
  assert("no write at all: no x_payment, no payment, no entry, no attachment, no note — only the gateway's record of the two messages", r?.action === "declined" && money() === before && rows("ir.attachment").length === atts && odooWrites().length > 0 && odooWrites().every(gatewayRecord) && wizardCalls.length === 0, JSON.stringify([r?.action, odooWrites().length, ...new Set(odooWrites().filter((c: any) => !gatewayRecord(c)).map((c: any) => `${c.model}.${c.method}`))]));
  assert("the customer reads the fixed text, to the letter", JSON.stringify(sentTo(C1_PHONE).map(bodyOf)) === JSON.stringify(["ما وصلنا التحويل للحين. لو حوّلت أرسل لنا صورة إيصال واضحة، أو انتظر يوم عمل ونراجع مرة ثانية"]));
  assert("Baraa reads that nothing was recorded", JSON.stringify(textsTo(OWNER)) === JSON.stringify([`❌ إشعار تحويل ${NAME} (500 ر.س): ما وصل. لم يُسجَّل شيء، وأُبلغ العميل.`]), textsTo(OWNER).join("|"));
  assert("the notice is marked decided", notices(env)[0].decided.how === "no" && notices(env)[0].decided.excess === undefined);
  assert("the invoices are still open: he can send another notice", (await quiet(() => TR.openInvoices(env, C1))).length === 3);
}

// ================================================================ د12
console.log("\n[د12] a second tap on EITHER button: «سبق تسجيله», and nothing is written; the buttons are Baraa's alone");
{
  const env = books();
  const { id } = await notice(env);
  await tap(env, `trn_ok_${id}`);
  const before = money();
  for (const second of [`trn_ok_${id}`, `trn_no_${id}`]) {
    graph.length = 0; odooLog.length = 0;
    const r = await tap(env, second);
    await settle();
    assert(`«✅ وصل» then ${second.startsWith("trn_ok") ? "«✅ وصل»" : "«❌ ما وصل»"}: «سبق تسجيله» — no row, no payment, nothing to the customer`, r?.action === "duplicate" && money() === before && wizardCalls.length === 1 && sentTo(C1_PHONE).length === 0 && odooWrites().every(gatewayRecord)
      && JSON.stringify(textsTo(OWNER)) === JSON.stringify([`سبق تسجيله: «✅ وصل» الساعة 14:00 — ${NAME}، 500 ر.س`]), textsTo(OWNER).join("|"));
  }
  const env2 = books();
  const two = await notice(env2);
  await tap(env2, `trn_no_${two.id}`);
  graph.length = 0;
  const late = await tap(env2, `trn_ok_${two.id}`);
  assert("«❌ ما وصل» then «✅ وصل»: «سبق تسجيله» — NOTHING is paid", late?.action === "duplicate" && (rows("x_payment") as any[]).every((p) => p.x_method !== "transfer") && rows("account.payment").length === 0 && textsTo(OWNER)[0].startsWith("سبق تسجيله: «❌ ما وصل»") && sentTo(C1_PHONE).length === 0);
  // a tap while the first is still running (the lock is held, nothing decided yet)
  const env3 = books();
  const three = await notice(env3);
  env3.MSG_DEDUP.store.set(`btnlock:v1:transfer_decide:${three.id}`, "run:1:abc");
  graph.length = 0;
  const racing = await tap(env3, `trn_ok_${three.id}`);
  assert("a tap while the first is still running: «سبق تسجيله», nothing written", racing?.action === "duplicate" && JSON.stringify(textsTo(OWNER)) === JSON.stringify(["سبق تسجيله"]) && (rows("x_payment") as any[]).every((p) => p.x_method !== "transfer"));
  assert("ONE lock for the two buttons", (srcOf("transfer-form.ts").match(/claimButton\(env, `transfer_decide:\$\{id\}`/g) ?? []).length === 1);
}
{
  // another number's tap
  const env = books();
  const { id } = await notice(env);
  const before = money();
  graph.length = 0;
  const customer = await tap(env, `trn_ok_${id}`, C1_PHONE), team = await tap(env, `trn_ok_${id}`, WH_PHONE), no = await tap(env, `trn_no_${id}`, C1_PHONE);
  assert("a tap from the customer's number, or a team member's: NOT theirs (null) — nothing written, nothing sent, the notice still undecided", customer === null && team === null && no === null && money() === before && graph.length === 0 && !notices(env)[0].decided);
  await say(env, C1_PHONE, button(`trn_ok_${id}`, "✅ وصل"));
  assert("…through the webhook the customer gets the answer of a button the worker does not know — and nothing is paid", money() === before && !notices(env)[0].decided && !textsTo(C1_PHONE).some(confirmed) && sentTo(OWNER).length === 0, JSON.stringify(textsTo(C1_PHONE)));
  graph.length = 0;
  const res = await say(env, OWNER, button(`trn_ok_${id}`, "✅ وصل"));
  assert("Baraa's own tap through the webhook records it", res.status === 200 && notices(env)[0].decided?.how === "ok" && (rows("x_payment") as any[]).filter((p) => p.x_method === "transfer").length === 2 && textsTo(C1_PHONE).some(confirmed));
  graph.length = 0;
  const gone = await tap(env, "trn_ok_0000000000");
  assert("a notice the worker does not hold any more (thirty days): one line, nothing written", gone?.action === "unknown" && JSON.stringify(textsTo(OWNER)) === JSON.stringify([TR.TRANSFER_NOTICE_GONE_TEXT]));
  assert("an id that is no notice's is not this module's", (await tap(env, "trn_ok_x")) === null && (await tap(env, "trn_maybe_0000000000")) === null && (await tap(env, "prv_a_1_1")) === null && TR.TRANSFER_DECISION_RE.test(`trn_no_${id}`));
  const idx = srcOf("index.ts");
  assert("the two buttons are read in Baraa's own branch of the webhook alone", idx.indexOf("/^trn_(ok|no)_/.test(msg.buttonId") > idx.indexOf("// ---- owner-guard (inbound) ----") && idx.indexOf("/^trn_(ok|no)_/.test(msg.buttonId") < idx.indexOf("// § 52 ب — an outside price source (رائد): its prices within 90 minutes") && !/trn_/.test(srcOf("router.ts")));
}
{
  // a tap that could not finish: released — and the next one goes on from what Odoo already holds
  const env = books();
  const { id } = await notice(env, { ...good, amt: "560.5" });
  const transfers = () => (rows("x_payment") as any[]).filter((p) => p.x_method === "transfer");
  odooDown = "x_daily_order";            // A's row is written, then closing its order fails
  graph.length = 0;
  const r = await tap(env, `trn_ok_${id}`);
  odooDown = "";
  assert("Odoo fails half-way (A's row is written, then its order cannot be closed): the tap says so, is NOT marked decided, the customer is not told, nothing is posted", r?.action === "error" && JSON.stringify(textsTo(OWNER)) === JSON.stringify([TR.TRANSFER_RETRY_TEXT]) && !notices(env)[0].decided && sentTo(C1_PHONE).length === 0
    && JSON.stringify(transfers().map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_A, 300]]) && wizardCalls.length === 0, JSON.stringify(transfers().map((p) => [p.x_invoice_id, p.x_amount])));
  graph.length = 0;
  const again = await tap(env, `trn_ok_${id}`);
  const ap = rows("account.payment") as any[];
  assert("the next tap goes on from A's row, read from Odoo: B takes its 200, the excess is 60.50 — no row twice", again?.action === "confirmed" && JSON.stringify(transfers().map((p) => [p.x_invoice_id, p.x_amount])) === JSON.stringify([[INV_A, 300], [INV_B, 200]]) && again.excess === 60.5 && textsTo(C1_PHONE).some(confirmed), JSON.stringify(transfers().map((p) => [p.x_invoice_id, p.x_amount])));
  assert("…and the books get ONE payment for the whole 560.50 over BOTH entries, every row linked — Baraa reads the two invoices", wizardCalls.length === 1 && JSON.stringify(wizardCalls[0].active) === JSON.stringify([M_A, M_B]) && ap.length === 1 && ap[0].amount === 560.5 && transfers().every((p) => p.x_account_payment_id === ap[0].id)
    && textsTo(OWNER)[0].split("\n").slice(1, 5).join("|") === [`• ${N_A}: 300 ر.س (سُدّدت كاملة)`, `• ${N_B}: 200 ر.س (سُدّدت كاملة)`, "زيادة 60.50 ر.س باقية رصيداً للعميل", TR.TRANSFER_POSTED_TEXT].join("|"), textsTo(OWNER)[0]);
  // the decision's own mark was lost after everything was written (KV): the tap is taken again — and writes nothing twice
  const kv = env.MSG_DEDUP.store;
  const key = TR.transferNoticeKey(id), lost = JSON.parse(kv.get(key));
  delete lost.decided; kv.set(key, JSON.stringify(lost)); kv.delete(`btnlock:v1:transfer_decide:${id}`);
  graph.length = 0;
  const third = await tap(env, `trn_ok_${id}`);
  assert("everything written but the notice's own mark lost: the tap finishes — no second row, no second payment (the rows already carry theirs)", third?.action === "confirmed" && transfers().length === 2 && wizardCalls.length === 1 && rows("account.payment").length === 1 && third.accountPaymentId === ap[0].id && textsTo(OWNER)[0].includes(TR.TRANSFER_POSTED_TEXT));
  // the mark is there but the lock was lost: still a second tap
  kv.delete(`btnlock:v1:transfer_decide:${id}`);
  graph.length = 0;
  const fourth = await tap(env, `trn_no_${id}`);
  assert("the lock lost but the notice marked decided: still «سبق تسجيله»", fourth?.action === "duplicate" && textsTo(OWNER)[0].startsWith("سبق تسجيله: «✅ وصل»") && transfers().length === 2);
}
{
  // the rows read back from Odoo in another order: still the oldest invoice first, in the books and in his message
  const env = books();
  const { id } = await notice(env);
  for (const [k, inv, amount] of [[7100, INV_B, 200], [7101, INV_A, 300]] as const) {
    seed("x_payment", { id: k, x_invoice_id: inv, x_amount: amount, x_method: "transfer", x_collected_at: utc(`${DAY} 14:00`), x_notes: `إشعار تحويل TRN-${id}` });
    table("x_invoice").get(inv)!.x_status = "paid";
  }
  graph.length = 0;
  await tap(env, `trn_ok_${id}`);
  assert("rows that Odoo hands back the newer first: the payment is still registered on the entries the OLDEST first, and Baraa reads them so", JSON.stringify(wizardCalls[0]?.active) === JSON.stringify([M_A, M_B]) && textsTo(OWNER)[0].split("\n").slice(1, 3).join("|") === [`• ${N_A}: 300 ر.س (سُدّدت كاملة)`, `• ${N_B}: 200 ر.س (سُدّدت كاملة)`].join("|")
    && (rows("x_payment") as any[]).filter((p) => p.x_method === "transfer").length === 2, JSON.stringify(wizardCalls[0]?.active));
}
{
  // the customer's window closed when Baraa decides: his line waits for him
  const env = world();
  setExtract(RECEIPT);
  const { id } = await notice(env);
  env.MSG_DEDUP.store.delete(`wa_win:v1:${C1_PHONE}`);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: C1, x_processed_at: utc("2026-10-01 01:00"), x_status: "received" });
  graph.length = 0;
  await tap(env, `trn_no_${id}`);
  const held = heldFor(env, C1_PHONE);
  assert("the customer's window closed when Baraa taps: his line is HELD for him (48h), not lost", sentTo(C1_PHONE).length === 0 && held.length === 1 && held[0].purpose === "customer_transfer_decision" && held[0].body.text.body === TR.TRANSFER_NOT_ARRIVED_TEXT && held[0].expiresAt - held[0].createdAt === 48 * 3600_000);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ د13
console.log("\n[د13] the trial to Baraa, its hook, the purposes, and what the form never shows");
{
  const env = books(`${DAY} 16:00`);
  closeOwnerWindow(env);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: 3, x_processed_at: utc("2026-10-01 01:00"), x_status: "received" });
  const shut = await quiet(() => TR.sendTransferFormTest(env));
  assert("Baraa's window closed: the trial does not go, nothing is held, and the day is not spent", shut.sent === false && shut.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(shut));
  openWindow(env, OWNER);
  // another customer's open invoice, older than everyone's
  seed("x_daily_order", { id: 8400, x_customer_id: CUST2, x_state: "delivered" });
  seed("x_invoice", { id: 9400, x_invoice_number: "UTAK-INV-20260901-009", x_order_id: 8400, x_total: 80, x_status: "issued", x_invoice_date: "2026-09-01" });
  const before = money();
  odooLog.length = 0;
  const t = await quiet(() => TR.sendTransferFormTest(env));
  await settle();
  const f = flowsTo(OWNER)[0], d = dataOf(f);
  assert("the trial: ONE message, to Baraa's number alone, marked «🧪 تجربة», under the trial's purpose", t.sent === true && graph.filter(Boolean).length === 1 && graph.filter(Boolean)[0].to === OWNER && bodyOf(f).startsWith("🧪 تجربة — 🏦 إشعار تحويل") && d.t === "🧪 تجربة — إشعار تحويل — براء"
    && rows("x_wa_message").every((m: any) => !/"purpose":"customer_transfer_form"/.test(String(m.x_debug_payload))), bodyOf(f));
  assert("…listing the OLDEST real open invoices of everyone (read-only), each naming its customer — and saying so", d.invs.length === 4 && d.invs[0].id === "9400" && d.invs[0].description.includes("بقالة النخيل") && d.invs[1].description.includes(NAME) && bodyOf(f).endsWith(TR.TRANSFER_TEST_REAL_TEXT) && TR.TRANSFER_TEST_ROWS === 5, JSON.stringify(d.invs.map((x: any) => x.description)));
  assert("…read-only: nothing written in Odoo but the message's own record", odooWrites().every(gatewayRecord) && money() === before);
  const again = await quiet(() => TR.sendTransferFormTest(env));
  assert("a second trial the same day is refused", again.sent === false && again.reason === "already_today" && flowsTo(OWNER).length === 1);
  graph.length = 0; odooLog.length = 0; claudeCalls.length = 0;
  const bad = await reply(env, OWNER, tokenOf(f), { ...good, inv: ["9400", String(INV_A)], amt: "", photo: [] });
  assert("the trial refuses as the customer's form does — a fresh trial form, marked", bad.action === "invalid" && JSON.stringify(bad.problems) === JSON.stringify(["amt", "photo"]) && flowsTo(OWNER).length === 1 && bodyOf(flowsTo(OWNER)[0]).startsWith("🧪 تجربة — ⚠️ ما انحفظ شيء من النموذج:") && dataOf(flowsTo(OWNER)[0]).invs.length === 4);
  const r = await reply(env, OWNER, tokenOf(flowsTo(OWNER)[0]), { ...good, inv: ["9400", String(INV_A)], amt: "400", note: "تجربة" });
  await settle();
  assert("his «إرسال» is answered with what WOULD have been recorded: 80 on the older invoice, 300 on the next, 20 over", r.action === "test" && bodyOf(sentTo(OWNER).at(-1)) === [
    "🧪 تجربة — وصل إشعار تحويل ✅", `المبلغ 400 ر.س — التاريخ ${LABEL} — المرجع FT26276001`, "لو كان إشعار عميل وضغطت «✅ وصل» لسُجّل:",
    "• UTAK-INV-20260901-009: 80 ر.س (تُسدَّد كاملة)", `• ${N_A}: 300 ر.س (تُسدَّد كاملة)`, "زيادة 20 ر.س باقية رصيداً للعميل",
    "📸 صورة النموذج كانت ستُحفظ على كل فاتورة مختارة.", "ملاحظتك: تجربة", "(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)",
  ].join("\n"), bodyOf(sentTo(OWNER).at(-1)));
  assert("…and writes NOTHING: no notice in KV, no attachment, no note, no payment, nothing downloaded or read by Claude — and reaches nobody else", notices(env).length === 0 && rows("ir.attachment").length === 0 && money() === before && odooWrites().every(gatewayRecord) && claudeCalls.length === 0
    && graph.filter(Boolean).every((b: any) => b.to === OWNER) && ownerNotices().length === 0 && wizardCalls.length === 0);
  const twice = await reply(env, OWNER, tokenOf(flowsTo(OWNER)[0]), good);
  assert("the trial's token is read once too", twice.action === "duplicate");
  // nothing real open: samples, said to be samples
  setRiyadh("2026-10-04 16:00"); openWindow(env, OWNER);
  for (const i of rows("x_invoice") as any[]) i.x_status = "paid";
  graph.length = 0;
  const s = await quiet(() => TR.sendTransferFormTest(env));
  const sd = dataOf(flowsTo(OWNER)[0]);
  assert("nothing real is open: three SAMPLE rows, each saying it is one, and the message says so", s.sent === true && sd.invs.length === 3 && sd.invs.every((x: any) => x.title.startsWith("عيّنة ") && x.description.includes("عيّنة للتجربة، ليست فاتورة")) && bodyOf(flowsTo(OWNER)[0]).endsWith(TR.TRANSFER_TEST_SAMPLE_TEXT), JSON.stringify(sd.invs));
  const sample = await reply(env, OWNER, tokenOf(flowsTo(OWNER)[0]), { ...good, inv: ["1", "3"], amt: "400" });
  assert("the samples' trial is answered from the rows it showed (none of them is in Odoo): 300 on «عيّنة 1», 100 of the 120 on «عيّنة 3»", sample.action === "test" && bodyOf(sentTo(OWNER).at(-1)).includes("• عيّنة 1: 300 ر.س (تُسدَّد كاملة)") && bodyOf(sentTo(OWNER).at(-1)).includes("• عيّنة 3: 100 ر.س (جزئي)") && notices(env).length === 0, bodyOf(sentTo(OWNER).at(-1)));
  // the hook
  const hookEnv = { ...env, ODOO_HOOK_TOKEN: "HOOK" };
  const post = (q: string, e: any = hookEnv) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/transfer-form-test${q}`, { method: "POST" }), e, ctx));
  const no = await post("?token=nope"), none = await post(""), unset = await post("?token=", env);
  assert("POST /odoo/hook/transfer-form-test without the hook's token: 401, nothing sent", no.status === 401 && none.status === 401 && unset.status === 401 && flowsTo(OWNER).length === 1);
  const body = await (await post("?token=HOOK")).json() as any;
  assert("…with it: the worker's own answer (today's trial already went)", body.ok === true && body.sent === false && body.reason === "already_today", JSON.stringify(body));
  setRiyadh("2026-10-05 16:00"); openWindow(env, OWNER);
  const next = await (await post("?token=HOOK")).json() as any;
  assert("…and the next day it sends one", next.ok === true && next.sent === true && flowsTo(OWNER).length === 2, JSON.stringify(next));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = world();
  assert("the four purposes: the form, the decision (important, 48h) and Baraa's notice are replies (one refusal never stops the next), the trial his own", PURPOSES.customer_transfer_form?.kind === "reply" && PURPOSES.customer_transfer_decision?.kind === "reply" && PURPOSES.customer_transfer_decision.important === true
    && JSON.stringify(PURPOSES.customer_transfer_decision.ttl) === JSON.stringify({ hours: 48 }) && PURPOSES.owner_transfer_notice?.kind === "reply" && PURPOSES.transfer_form_test?.kind === "operational"
    && TR.TRANSFER_PURPOSE === "customer_transfer_form" && TR.TRANSFER_DECISION_PURPOSE === "customer_transfer_decision" && TR.TRANSFER_OWNER_PURPOSE === "owner_transfer_notice" && TR.TRANSFER_TEST_PURPOSE === "transfer_form_test");
  const x = { kind: "session" as const, body: { type: "text", text: { body: "x" } } };
  const d = async (purpose: string, to: string) => gatewayDecision(await quiet(() => sendViaGateway(env, { purpose, to: "+" + to, content: x })))?.action;
  assert("the gateway refuses Baraa's notice and the trial to any number but his, and the customer's two purposes to his", (await d("owner_transfer_notice", C1_PHONE)) === "refused" && (await d("transfer_form_test", C1_PHONE)) === "refused" && (await d("customer_transfer_form", OWNER)) === "refused" && (await d("customer_transfer_decision", OWNER)) === "refused"
    && (await d("owner_transfer_notice", OWNER)) === "session" && (await d("customer_transfer_form", C1_PHONE)) === "session");
  // privacy: his own invoices, and nothing of the purchase side
  setExtract(RECEIPT);
  odooLog.length = 0; graph.length = 0;
  const { id } = await notice(env);
  await tap(env, `trn_ok_${id}`);
  const reads = odooLog.filter((c: any) => /^(search_read|search|read)$/.test(c.method));
  assert("no purchase or pricing model is read (the purchase prices, the offers, the day's prices, the settings, the costs)", !reads.some((c: any) => /^(x_daily_price|x_price_offer|x_price_day|x_price_day_line|x_pricing_config|x_operating_cost|x_purchase_list|x_supplier_due|purchase\.)/.test(c.model)), JSON.stringify([...new Set(reads.map((c: any) => c.model))]));
  assert("nothing sent carries a purchase price, a cost or a profit: not 77.77, 88.88, nor «شراء», «ربح», «تكلفة», «هامش»", graph.filter(Boolean).length >= 5 && !/77\.77|88\.88|شراء|ربح|تكلفة|هامش/.test(JSON.stringify(graph)));
  const code = srcOf("transfer-form.ts").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert("src/transfer-form.ts names no price, cost or profit field and no pricing module", !/x_[a-z_]*(price|cost|profit|margin)/i.test(code) && !/from "\.\/(pricing-engine|prices|price-review|purchase-accounting|operating-cost)"/.test(code));
  assert("its id at Meta is a constant the tests never read the value of", typeof TR.TRANSFER_FLOW_ID === "string" && /export const TRANSFER_FLOW_ID = "\d+";/.test(srcOf("transfer-form.ts")));
}

// ================================================================ د14
console.log("\n[د14] the guide: the team's page on the transfer notice");
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  const at = guide.indexOf("## نموذج «إشعار تحويل» (§ 57)"), section = guide.slice(at, guide.indexOf("\n## ", at + 5));
  assert("OPERATING-DAY carries «نموذج «إشعار تحويل»», once, right before «من يرى أي سعر»", at > 0 && guide.split("## نموذج «إشعار تحويل»").length === 2 && guide.indexOf("\n## ", at + 5) === guide.indexOf("\n## من يرى أي سعر (§ 53)") && at > guide.indexOf("## كشف البنك الأسبوعي (§ 57)"), String(at));
  assert("…the three doors: the button under the invoice's text, «تحويل 🏦» or «حولت», a receipt's photo", section.includes("«🏦 أرسلت تحويل»") && section.includes("«تحويل 🏦»") && /«حولت»/.test(section) && /صورة الإيصال/.test(section));
  assert("…what the customer reads, to the letter, at each step", section.includes("«وصلنا إشعار تحويلك بمبلغ X — نأكد لك أول ما يوصل الحساب»") && section.includes("«استلمنا تحويلك X ريال ✅ وسددنا: فاتورة Y (مبلغ)، فاتورة Z (مبلغ)»") && section.includes(`«${TR.TRANSFER_NOT_ARRIVED_TEXT}»`));
  assert("…that «إرسال» pays nothing, and what Baraa's two buttons do", section.includes("**لا تُسجَّل دفعة**") && section.includes("«✅ وصل»") && section.includes("«❌ ما وصل»") && section.includes("«سبق تسجيله»"));
  assert("…the oldest first, the excess as his credit, and the bank account moving once", /الأقدم أولاً/.test(section) && /رصيداً للعميل/.test(section) && /101003/.test(section) && /لا يُحسب مرتين|مرة واحدة/.test(section));
  assert("…what refuses the form, and that nothing of it reaches a supplier or a price source", /يُرفض النموذج كله/.test(section) && /بلا صورة/.test(section) && /مصدر أسعار/.test(section));
  assert("the guide's statement section points here", guide.includes("(نموذج «إشعار تحويل»، أدناه)"));
}

done();
