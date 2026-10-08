// § 57 و (2026-10-05) — «تسجيل مصروف»: Baraa's expense form, and the entry it makes in Odoo.
//
//   [و1] utak_expense_v1: the JSON at Meta against what the worker sends — the keys, the components,
//        Meta's limits on every text
//   [و2] the doors: «مصروف» and the button, from Baraa alone; the button under «تم الاطلاع»; anyone
//        else; the accounting off
//   [و3] the eight types, each on its account — the constant, the entry, and the table of docs/ODOO-IDS.md
//   [و4] the tax: «نعم» with a valid number, with a wrong one, «لا»; no default tax sneaks in
//   [و5] the three journals; «من جيب براء» hidden while its journal is not in Odoo
//   [و6] the supplier: by his tax number, by his name, a new one with no customer rank
//   [و7] the photo: attached to the bill; a download that fails; the seam of § 57 ز
//   [و8] a field that cannot be read refuses the whole form — every one of them
//   [و9] the two guards: each clause, and through the form — everything undone
//   [و10] Odoo lacks an account, a journal or the tax: nothing is written
//   [و11] «↩️ تراجع»: once, for 24 hours, Baraa alone — nothing deleted
//   [و12] the tokens: another number, a second use, the webhook's route
//   [و13] the trial to Baraa, its hook, and the two purposes
//   [و14] the guide, the table of accounts and the pointer in docs/EXPENSES.md
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts), and — in this file — the
// part of Odoo's accounting the entry stands on: a bill's lines and its posting (a price-included tax
// split OUT of the price, a tax added on top, the account's default tax on a line that names none),
// the register wizard and its payment, the resets. No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s57-expense.test.mts

import { readFileSync } from "node:fs";
import { OWNER, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table } from "./wa-harness.mts";
import { C1_PHONE, DRIVER_PHONE, assert, done, fresh, rejected, setExtract } from "./s46-kit.mts";

// ---------------------------------------------------------------- Meta's media, and Odoo's accounting
const MEDIA_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const mediaCalls: string[] = [];
/** What this file's Odoo does differently, one test at a time. */
const quirk: Record<string, any> = {};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ACC = { payable: 106, vatIn: 100, cash: 141, bankOut: 142, bank: 143, pocket: 260, owner: 122, income: 70 };
const J = { EXP: 20, BILL: 9, CSHD: 19, BNK1: 13, BRA: 21 };
/** BRA's outbound payment method line, as on the tenant. */
const BRA_OUT = 8;
const METHOD = "account.payment.method.line";
const ACC_M2O: Record<string, Record<string, string>> = {
  "account.move": { journal_id: "account.journal", partner_id: "res.partner", commercial_partner_id: "res.partner" },
  "account.move.line": { account_id: "account.account", tax_line_id: "account.tax", move_id: "account.move" },
  "account.payment": { move_id: "account.move", partner_id: "res.partner", journal_id: "account.journal" },
  "account.journal": { default_account_id: "account.account" },
  [METHOD]: { journal_id: "account.journal", payment_account_id: "account.account" },
};
const refuse = (message: string) => new Response(JSON.stringify({ name: "odoo.exceptions.UserError", message, arguments: [message] }), { status: 500 });
const linesOf = (move: number) => rows("account.move.line").filter((l: any) => l.move_id === move) as any[];
let billSeq = 0;
function postBill(id: number): Response | null {
  const mv = table("account.move").get(id) as any;
  if (!mv || mv.state !== "draft") return refuse("Only draft entries can be posted.");
  if (quirk.postRefused) return refuse(String(quirk.postRefused));
  if (String(mv.invoice_date) > String(quirk.today)) return refuse("The invoice date cannot be later than today.");
  const journal = table("account.journal").get(mv.journal_id) as any;
  let untaxed = 0, tax = 0;
  for (const l of linesOf(id).filter((x) => x.display_type === "product")) {
    const price = Number(l.price_unit) * Number(l.quantity ?? 1);
    // a line that names no tax takes the default of its account: the goods' 15%, ADDED on top
    const ids: number[] = quirk.forceTax ? [quirk.forceTax] : l.tax_ids === undefined ? [21] : l.tax_ids[0][2];
    let net = price;
    for (const t of ids) {
      const row = table("account.tax").get(t) as any;
      const amount = row.price_include ? r2(price - r2(price / (1 + row.amount / 100))) : r2(price * row.amount / 100);
      if (row.price_include) net = r2(price - amount);
      seed("account.move.line", { move_id: id, account_id: ACC.vatIn, debit: amount, credit: 0, display_type: "tax", tax_line_id: t, name: row.name });
      tax = r2(tax + amount);
    }
    Object.assign(l, { account_id: quirk.lineAccount ?? l.account_id ?? journal.default_account_id, debit: net, credit: 0 });
    untaxed = r2(untaxed + net);
  }
  const total = r2(untaxed + tax);
  seed("account.move.line", { move_id: id, account_id: ACC.payable, debit: 0, credit: total, display_type: "payment_term", tax_line_id: false, name: "" });
  Object.assign(mv, { state: quirk.postState ?? "posted", name: `${journal.code}/2026/10/${String(++billSeq).padStart(4, "0")}`, amount_untaxed: untaxed, amount_tax: tax, amount_total: total, payment_state: "not_paid" });
  return null;
}
function accounting(model: string, method: string, body: any, out: any): Response | unknown {
  if (model === "account.move" && method === "create") {
    for (const id of out as number[]) {
      const mv = table("account.move").get(id) as any;
      // a bill that names no journal lands in the purchases' own: BILL, the goods' journal
      Object.assign(mv, { state: "draft", name: "/", payment_state: "not_paid", journal_id: mv.journal_id ?? J.BILL, commercial_partner_id: mv.partner_id, amount_total: 0, amount_tax: 0 });
      for (const cmd of (mv.invoice_line_ids ?? []) as any[]) seed("account.move.line", { ...cmd[2], move_id: id, display_type: "product", tax_line_id: false, debit: 0, credit: 0 });
    }
  }
  if (model === "account.move" && method === "action_post") { for (const id of body.ids) { const r = postBill(id); if (r) return r; } }
  if (model === "account.move" && method === "button_draft") {
    if (quirk.draftRefused) return refuse(String(quirk.draftRefused));
    for (const id of body.ids) {
      const mv = table("account.move").get(id) as any;
      for (const l of linesOf(id).filter((x) => x.display_type !== "product")) table("account.move.line").delete(l.id);
      Object.assign(mv, { state: "draft", payment_state: "not_paid" });
    }
  }
  if (model === "account.payment.register" && method === "create") {
    if (quirk.wizardRefused) return refuse(String(quirk.wizardRefused));
    for (const id of out as number[]) (table(model).get(id) as any)._bill = body.context?.active_ids?.[0];
  }
  if (model === "account.payment.register" && method === "action_create_payments") {
    const w = table(model).get(body.ids[0]) as any, bill = table("account.move").get(w._bill) as any;
    const amount = quirk.payAmount ?? w.amount, journal = quirk.payJournal ?? w.journal_id;
    // as on the tenant: a payment gets a journal entry only when its method line carries a payment account
    const method = rows(METHOD).find((l: any) => l.journal_id === w.journal_id && l.payment_type === "outbound") as any;
    const credit = quirk.payCreditAccount ?? method?.payment_account_id;
    const entry = quirk.payNoMove || !credit ? false : seed("account.move", { move_type: "entry", state: quirk.payMoveState ?? "posted", journal_id: journal, partner_id: bill.partner_id, name: `P${journal}/${bill.id}` });
    if (entry) {
      seed("account.move.line", { move_id: entry, account_id: quirk.payDebitAccount ?? ACC.payable, debit: amount, credit: 0, display_type: "payment_term", tax_line_id: false });
      seed("account.move.line", { move_id: entry, account_id: credit, debit: 0, credit: amount, display_type: "product", tax_line_id: false });
    }
    const pid = seed("account.payment", {
      state: quirk.payState ?? "paid", partner_id: quirk.payPartner ?? bill.partner_id, journal_id: journal, amount, date: w.payment_date,
      payment_type: "outbound", partner_type: "supplier", move_id: entry, memo: bill.ref, _bill: bill.id,
    });
    // the bank's payment waits for its statement line: the bill is «in_payment» until then
    bill.payment_state = quirk.billPaymentState ?? (w.journal_id === J.BNK1 ? "in_payment" : "paid");
    return quirk.noAction ? true : { type: "ir.actions.act_window", res_model: "account.payment", res_id: pid };
  }
  if (model === "account.payment" && (method === "action_draft" || method === "action_cancel")) {
    if (quirk.payCancelRefused) return refuse(String(quirk.payCancelRefused));
    for (const id of body.ids) {
      const p = table(model).get(id) as any, entry = p.move_id ? table("account.move").get(p.move_id) as any : null;
      p.state = method === "action_draft" ? "draft" : "canceled";
      if (entry) entry.state = method === "action_draft" ? "draft" : "cancel";
      (table("account.move").get(p._bill) as any).payment_state = "not_paid";
    }
  }
  if (model === "ir.attachment" && method === "create" && quirk.attachRefused) {
    for (const id of out as number[]) table(model).delete(id);
    return refuse(String(quirk.attachRefused));
  }
  // many2one fields as Odoo answers them: [id, name]
  const m2o = ACC_M2O[model];
  if (m2o && (method === "read" || method === "search_read") && Array.isArray(out)) {
    return out.map((r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, m2o[k] && typeof v === "number" ? [v, String((table(m2o[k]).get(v) as any)?.name ?? v)] : v])));
  }
  return out;
}
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const mm = /graph\.facebook\.com\/[^/]+\/(EXPH_[A-Z0-9]+)$/.exec(url);
  if (mm) {
    mediaCalls.push(mm[1]);
    if (mm[1].startsWith("EXPH_BAD")) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    return new Response(JSON.stringify({ url: `https://media.test/${mm[1]}`, mime_type: "image/jpeg", file_size: MEDIA_BYTES.length }), { status: 200 });
  }
  if (url.startsWith("https://media.test/EXPH_")) return new Response(MEDIA_BYTES, { status: 200 });
  // Meta refuses a Flow message (a Flow that is not published, an id that is not one)
  if (quirk.metaRefusesFlows && url.includes("graph.facebook.com") && /"type":"flow"/.test(String(init?.body ?? ""))) {
    return new Response(JSON.stringify({ error: { message: "(#131009) Parameter value is not valid", code: 131009 } }), { status: 400 });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (!m) return kitFetch(input as any, init);
  if (quirk.down && new RegExp(quirk.down).test(`${m[1]}/${m[2]}`)) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "boom" }), { status: 500 });
  const res = await kitFetch(input as any, init);
  if (!res.ok) return res;
  const out = accounting(m[1], m[2], init?.body ? JSON.parse(init.body) : {}, await res.json());
  return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
}) as typeof fetch;

const EX = await import("../src/expense-form.ts");
const XA = await import("../src/expense-accounting.ts");
const OW = await import("../src/owner-window.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s58-expense-flow.mjs"); // § 58 أ 4: utak_expense_v2 — the form the worker sends now
// @ts-ignore — plain .mjs helpers
const LIB1 = await import("../scripts/lib/s57-expense-flow.mjs"); // utak_expense_v1, as published in § 57 (frozen at Meta)
// @ts-ignore — plain .mjs helpers
const OD58 = await import("../scripts/lib/s58-odoo.mjs");

const TODAY = "2026-10-05", YESTERDAY = "2026-10-04", TOMORROW = "2026-10-06";
const LABEL = "الاثنين 5 أكتوبر 2026";
const VAT = "310123456700003";
const ms = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const doc = (f: string) => readFileSync(new URL(`../docs/${f}`, import.meta.url), "utf8");
const count = (s: string) => [...String(s)].length;
/** The lead's table (the order, § 57 و): the type, its account's code, Odoo's name, its id. */
const TABLE: Array<[string, string, string, string, number]> = [
  ["fuel", "وقود", "400077", "Fuel", 211], ["car_maintenance", "صيانة السيارة", "400042", "Maintenance", 177], ["rent", "إيجار", "400017", "Warehouse Rent", 152],
  ["utilities", "كهرباء ومياه واتصالات", "400018", "Water & Electricity", 153],
  ["gov", "رسوم حكومية", "400032", "Trade License Fees", 167], ["packaging", "مواد تغليف", "400064", "Consumables", 199], ["other", "أخرى", "400028", "Others", 163],
];
const MISC = 55;

/** The tenant's books, as they were read on 10-05: the journals, the accounts, the taxes, the cash vendor. Accounting ON, as on prod. */
function world(riyadh = `${TODAY} 14:00`, o: { sync?: boolean } = {}): any {
  // the schema gate's list is emptied with every world: what an earlier one refused is kept
  everRejected.push(...rejected);
  const env = fresh(riyadh); setExtract(null);
  env.ACCOUNTING_SYNC = o.sync === false ? "false" : "true";
  for (const k of Object.keys(quirk)) delete quirk[k];
  quirk.today = riyadh.slice(0, 10);
  mediaCalls.length = 0; billSeq = 0;
  for (const [, , code, name, id] of TABLE) seed("account.account", { id, code, name, account_type: "expense" });
  seed("account.account", { id: ACC.payable, code: "201002", name: "Payables", account_type: "liability_payable" });
  seed("account.account", { id: ACC.vatIn, code: "104041", name: "VAT Input", account_type: "asset_current" });
  seed("account.account", { id: ACC.cash, code: "101007", name: "كاش السائق", account_type: "asset_cash" });
  seed("account.account", { id: ACC.bankOut, code: "101004", name: "Outstanding Payments", account_type: "asset_current" });
  seed("account.account", { id: ACC.bank, code: "101001", name: "Bank", account_type: "asset_cash" });
  seed("account.account", { id: ACC.pocket, code: "205001", name: "جاري المدير — البراء عبدالوهاب", account_type: "liability_current" });
  seed("account.account", { id: ACC.owner, code: "201021", name: "Owner Current Account", account_type: "liability_current" });
  seed("account.account", { id: ACC.income, code: "500001", name: "Sales", account_type: "income" });
  seed("account.journal", { id: J.EXP, code: "EXP", name: "المصاريف", type: "purchase", default_account_id: 163 });
  seed("account.journal", { id: J.BILL, code: "BILL", name: "Purchases", type: "purchase", default_account_id: 136 });
  seed("account.journal", { id: J.CSHD, code: "CSHD", name: "كاش السائق", type: "cash", default_account_id: ACC.cash });
  seed("account.journal", { id: J.BNK1, code: "BNK1", name: "Bank", type: "bank", default_account_id: ACC.bank });
  seed("account.journal", { id: J.BRA, code: "BRA", name: "مدفوعات البراء الشخصية", type: "credit", default_account_id: ACC.pocket });
  // the payment method lines: CSHD's post to the cash itself, BNK1's to its outstanding accounts. BRA's outbound
  // line (#8) carries NO account on the tenant today — «من جيب براء» is hidden there (و5); here Baraa has set 205001.
  seed(METHOD, { id: 4, journal_id: J.CSHD, payment_type: "inbound", payment_account_id: ACC.cash });
  seed(METHOD, { id: 5, journal_id: J.CSHD, payment_type: "outbound", payment_account_id: ACC.cash });
  seed(METHOD, { id: 2, journal_id: J.BNK1, payment_type: "outbound", payment_account_id: ACC.bankOut });
  seed(METHOD, { id: 7, journal_id: J.BRA, payment_type: "inbound", payment_account_id: false });
  seed(METHOD, { id: BRA_OUT, journal_id: J.BRA, payment_type: "outbound", payment_account_id: ACC.pocket });
  seed("account.tax", { id: 43, name: "15% شامل (مشتريات)", amount: 15, amount_type: "percent", type_tax_use: "purchase", price_include: true, active: true });
  seed("account.tax", { id: 21, name: "15%", amount: 15, amount_type: "percent", type_tax_use: "purchase", price_include: false, active: true });
  seed("account.tax", { id: 5, name: "15% شامل", amount: 15, amount_type: "percent", type_tax_use: "sale", price_include: true, active: true });
  seed("res.partner", { id: MISC, name: "مصروفات نقدية متنوعة", supplier_rank: 1, customer_rank: 0 });
  // Baraa's own contact, as on the tenant: his messages make no partner
  seed("res.partner", { id: 45, name: "براء", x_whatsapp_number: "+" + OWNER, customer_rank: 1 });
  openWindow(env, DRIVER_PHONE); openWindow(env, C1_PHONE);
  return env;
}
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const buttonsOf = (b: any): Array<{ id: string; title: string }> => (b?.interactive?.action?.buttons ?? []).map((x: any) => x.reply);
const last = () => sentTo(OWNER).at(-1);
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const text = (t: string) => ({ type: "text", text: { body: t } });
const button = (id: string, title = "x") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>, now?: number) =>
  quiet(() => EX.handleExpenseReply(env, { from: "+" + from, messageId: `wamid.X${++wamid}`, flow: { token, values } }, undefined, now));
/** A filled form: fuel, 115 as paid, no tax invoice, the cash vendor, the driver's cash, today. */
const GOOD = { type: "fuel", amt: "115", tax: "no", vat: "", sup: "مصروفات نقدية متنوعة", pay: "cash", date: TODAY, photo: [], note: "" };
const PHOTO = [{ file_name: "IMG_1.jpg", mime_type: "image/jpeg", sha256: "ab", id: "EXPH_A1" }];
async function form(env: any): Promise<string> {
  await quiet(() => EX.startExpense(env));
  return tokenOf(flowsTo(OWNER).at(-1));
}
/** A form, and its «إرسال». */
async function send(env: any, values: Record<string, unknown> = {}): Promise<any> {
  const token = await form(env);
  graph.length = 0;
  return reply(env, OWNER, token, { ...GOOD, ...values });
}
const bills = () => rows("account.move").filter((m: any) => m.move_type === "in_invoice") as any[];
const payments = () => rows("account.payment") as any[];
const lineOn = (move: number, account: number) => linesOf(move).find((l) => l.account_id === account);
const odooWrites = () => odooLog.filter((c: any) => !/^(search_read|search|search_count|read|fields_get)$/.test(c.method));
/** The gateway's own record of a send (§ 36): its x_wa_message row, and the number's conversation in Discuss. */
const gatewayRecord = (c: any): boolean => (c.model === "x_wa_message" && c.method === "create") || /^discuss\.channel(\.member)?$/.test(c.model)
  || (c.model === "res.partner" && c.method === "write" && Object.keys(c.body?.vals ?? {}).join() === "x_wa_channel_id");
const bookWrites = () => odooWrites().filter((c: any) => !gatewayRecord(c));
/** The purpose of every message the gateway recorded as sent. */
const purposes = (): string[] => rows("x_wa_message").map((m: any) => /"purpose":"([a-z_]+)"/.exec(String(m.x_debug_payload))?.[1] ?? "").filter(Boolean);
/** Every Odoo request the schema gate refused, in every world of this file so far. */
const everRejected: string[] = [];
const clean = () => assert("no Odoo field or value outside the schema — in any world so far", rejected.length === 0 && everRejected.length === 0, [...everRejected, ...rejected].join(" | "));

// ================================================================ و1
console.log("\n[و1] utak_expense_v2 at Meta is the form the worker fills: one screen, no endpoint");
{
  const json = LIB.buildExpenseFlowJson();
  const s = json.screens[0], c = s.layout.children;
  assert("ONE screen, EXPENSE_A — the one the worker opens — terminal; Flow JSON 6.0; FLOW is the Meta script's entry", json.screens.length === 1 && s.id === "EXPENSE_A" && LIB.EXPENSE_SCREEN === EX.EXPENSE_FLOW_SCREEN && s.terminal === true && s.success === true && json.version === "6.0"
    && LIB.FLOW.key === "expense" && LIB.FLOW.name === "utak_expense_v2" && LIB.EXPENSE_FLOW_NAME === "utak_expense_v2" && LIB.FLOW.build === LIB.buildExpenseFlowJson && LIB.FLOW.first === "EXPENSE_A");
  // § 58 أ 4 — «رواتب وأجور» left the list: a published Flow is frozen, so the list without it is a new Flow
  const v1 = LIB1.buildExpenseFlowJson(), back = LIB.buildExpenseFlowJson();
  back.screens[0].layout.children[2]["data-source"] = LIB1.EXPENSE_TYPES;
  assert("utak_expense_v1 stays the record of what § 57 published: its name, its eight types with «رواتب وأجور»", LIB1.EXPENSE_FLOW_NAME === "utak_expense_v1" && LIB1.FLOW.name === "utak_expense_v1" && LIB1.EXPENSE_TYPES.length === 8
    && v1.screens[0].layout.children[2]["data-source"].some((o: any) => o.id === "salaries" && o.title === "رواتب وأجور"), JSON.stringify(LIB1.EXPENSE_TYPES));
  assert("…and v2 is v1 without that one type, and nothing else: the same JSON once the list is put back", LIB.REMOVED_TYPE === "salaries" && LIB.EXPENSE_TYPES.length === 7 && !JSON.stringify(json).includes("رواتب") && !JSON.stringify(json).includes("salaries")
    && JSON.stringify(LIB.EXPENSE_TYPES) === JSON.stringify(LIB1.EXPENSE_TYPES.filter((t: any) => t.id !== "salaries")) && JSON.stringify(back) === JSON.stringify(v1));
  assert("the Meta script of § 58 walks this one Flow alone", LIB.FLOWS.length === 1 && LIB.FLOWS[0] === LIB.FLOW && JSON.stringify(LIB.FLOW_CATEGORIES) === JSON.stringify(["OTHER"]));
  assert("no endpoint and no Form wrapper: no data_api_version, no data_exchange, no routing model, no «Form» component", !("data_api_version" in json) && !("routing_model" in json) && !JSON.stringify(json).includes("data_exchange") && LIB.screenComponents(s).every((x: any) => x.type !== "Form"));
  assert("twelve components (Meta allows fifty), in the order's own order", LIB.screenComponents(s).length === 12 && LIB.screenComponents(s).length <= LIB.SCREEN_COMPONENTS_MAX
    && JSON.stringify(c.map((x: any) => x.type)) === JSON.stringify(["TextHeading", "TextBody", "Dropdown", "TextInput", "RadioButtonsGroup", "TextInput", "TextInput", "RadioButtonsGroup", "DatePicker", "PhotoPicker", "TextArea", "Footer"])
    && JSON.stringify(c.slice(2, 11).map((x: any) => x.name)) === JSON.stringify(LIB.EXPENSE_FIELDS), JSON.stringify(c.map((x: any) => x.name)));
  assert("the heading and the line come from the data", c[0].text === "${data.t}" && c[1].text === "${data.n}");
  assert("«نوع المصروف»: type, REQUIRED, the seven types (§ 58: no «رواتب وأجور»), nothing chosen for him", c[2].name === "type" && c[2].label === "نوع المصروف" && c[2].required === true && !("init-value" in c[2])
    && JSON.stringify(c[2]["data-source"].map((o: any) => o.title)) === JSON.stringify(["وقود", "صيانة السيارة", "إيجار", "كهرباء ومياه واتصالات", "رسوم حكومية", "مواد تغليف", "أخرى"]));
  assert("…the worker reads the same seven ids, under the same words, and names the one that left",  XA.EXPENSE_REMOVED_TYPE === LIB.REMOVED_TYPE && XA.expenseTypeOf("salaries") === null && JSON.stringify(XA.EXPENSE_TYPES.map((t: any) => [t.id, t.title])) === JSON.stringify(LIB.EXPENSE_TYPES.map((o: any) => [o.id, o.title])));
  assert("«المبلغ كما دُفع»: amt, a number, REQUIRED", c[3].name === "amt" && c[3].label === "المبلغ كما دُفع" && c[3]["input-type"] === "number" && c[3].required === true);
  assert("«فاتورة ضريبية؟»: tax, REQUIRED, yes «نعم» / no «لا», nothing chosen for him", c[4].name === "tax" && c[4].label === "فاتورة ضريبية؟" && c[4].required === true && !("init-value" in c[4])
    && JSON.stringify(c[4]["data-source"]) === JSON.stringify([{ id: "yes", title: "نعم" }, { id: "no", title: "لا" }]));
  assert("«رقم المورد الضريبي»: vat, optional, ALWAYS visible — its hint says it is read with «نعم» only", c[5].name === "vat" && c[5].label === "رقم المورد الضريبي" && c[5].required === false && !("visible" in c[5]) && /يُقرأ مع «نعم» فقط/.test(c[5]["helper-text"]));
  assert("«اسم المورد»: sup, a text, REQUIRED", c[6].name === "sup" && c[6].label === "اسم المورد" && c[6]["input-type"] === "text" && c[6].required === true);
  assert("«طريقة الدفع»: pay, REQUIRED, its choices come WITH THE MESSAGE (data.pay), nothing chosen for him", c[7].name === "pay" && c[7].label === "طريقة الدفع" && c[7].required === true && c[7]["data-source"] === "${data.pay}" && !("init-value" in c[7]));
  assert("…the three ways the worker may offer are the Flow's: cash «كاش السائق (CSHD)», bank «البنك (BNK1)», owner «من جيب براء»", JSON.stringify(XA.EXPENSE_PAY.map((p: any) => [p.id, p.title])) === JSON.stringify(LIB.EXPENSE_PAY_OPTIONS.map((o: any) => [o.id, o.title]))
    && JSON.stringify(XA.EXPENSE_PAY.map((p: any) => [p.id, p.journal])) === JSON.stringify([["cash", "CSHD"], ["bank", "BNK1"], ["owner", "BRA"]]));
  assert("«تاريخ المصروف»: date, a DatePicker opened on today (data.d), no later day to pick", c[8].name === "date" && c[8].label === "تاريخ المصروف" && c[8]["init-value"] === "${data.d}" && c[8]["max-date"] === "${data.d}" && c[8].required === false);
  const picker = c[9];
  assert("ONE PhotoPicker `photo`, a direct child: optional by min-uploaded-photos 0 (no `required`), one photo at most, 10 MB", LIB.screenComponents(s).filter((x: any) => x.type === "PhotoPicker").length === 1 && picker.name === "photo" && !("required" in picker)
    && picker["min-uploaded-photos"] === 0 && picker["max-uploaded-photos"] === 1 && LIB.EXPENSE_PHOTO_MAX === 1 && picker["max-file-size-kb"] === 10240);
  assert("«ملاحظة»: note, optional", c[10].name === "note" && c[10].label === "ملاحظة" && c[10].required === false);
  const pay = c[11]["on-click-action"].payload;
  assert("«إرسال» completes with the nine fields — the photo a TOP-LEVEL string property", c[11].label === "إرسال" && c[11]["on-click-action"].name === "complete" && JSON.stringify(Object.keys(pay)) === JSON.stringify(["type", "amt", "tax", "vat", "sup", "pay", "date", "photo", "note"])
    && Object.entries(pay).every(([k, v]) => v === `\${form.${k}}`));
  assert("the screen declares four keys — t, n, pay, d — each with an example; pay a list of { id, title }", JSON.stringify(Object.keys(s.data).sort()) === JSON.stringify(["d", "n", "pay", "t"]) && Object.values(s.data).every((v: any) => v.__example__ !== undefined && v.__example__ !== "")
    && s.data.pay.type === "array" && JSON.stringify(Object.keys(s.data.pay.items.properties)) === JSON.stringify(["id", "title"]) && /^\d{4}-\d{2}-\d{2}$/.test(s.data.d.__example__));
  // ---- Meta's limits, on every text of the Flow
  const LABEL_MAX: Record<string, number> = { TextInput: 20, TextArea: 20, Dropdown: 20, RadioButtonsGroup: 30, DatePicker: 40, PhotoPicker: 80, Footer: 35 };
  const fields = c.filter((x: any) => x.label);
  assert("every label within Meta's limit for its component (a field 20, a choice 30, the date 40, the photo 80, the footer 35)", fields.length === 10 && fields.every((x: any) => count(x.label) <= LABEL_MAX[x.type]), JSON.stringify(fields.filter((x: any) => count(x.label) > LABEL_MAX[x.type]).map((x: any) => x.label)));
  assert("every hint within eighty characters, the photo's description within three hundred", c.filter((x: any) => x["helper-text"]).length === 5 && c.every((x: any) => count(x["helper-text"] ?? "") <= 80) && count(picker.description) <= 300 && count(picker.description) > 0);
  assert("every choice's title within thirty characters (the types, yes / no, the ways of paying)", [...LIB.EXPENSE_TYPES, ...LIB.EXPENSE_TAX_OPTIONS, ...LIB.EXPENSE_PAY_OPTIONS].every((o: any) => count(o.title) <= 30 && count(o.title) > 0));
  assert("the screen's title within thirty, the examples of the heading within eighty and of the line within a text's room", count(s.title) <= 30 && s.title === "تسجيل مصروف" && count(s.data.t.__example__) <= 80 && count(s.data.n.__example__) <= 4096);
  // ---- what the worker sends
  const env = world();
  await quiet(() => EX.startExpense(env));
  const f = flowsTo(OWNER)[0], d = dataOf(f);
  assert("every key the worker sends is declared, and every declared key is sent", JSON.stringify(Object.keys(d).sort()) === JSON.stringify(Object.keys(s.data).sort()), JSON.stringify(d));
  assert("the heading «تسجيل مصروف — <the day>» within eighty; today as «YYYY-MM-DD»; the three ways of paying", d.t === `تسجيل مصروف — ${LABEL}` && count(d.t) <= 80 && d.d === TODAY && d.n === EX.EXPENSE_HOW_TEXT && count(d.n) <= 4096
    && JSON.stringify(d.pay) === JSON.stringify(LIB.EXPENSE_PAY_OPTIONS), JSON.stringify(d));
  assert("the message opens utak_expense_v1 on its screen with the data (navigate), under «سجّل المصروف»", par(f).flow_id === EX.EXPENSE_FLOW_ID && par(f).flow_action === "navigate" && par(f).flow_action_payload.screen === "EXPENSE_A" && par(f).flow_message_version === "3"
    && par(f).flow_cta === "سجّل المصروف" && LIB.EXPENSE_CTA === EX.EXPENSE_CTA && count(par(f).flow_cta) <= 20 && bodyOf(f).length <= 1024);
  assert("the two buttons' titles within twenty: «🧾 تسجيل مصروف», «↩️ تراجع»", count(EX.EXPENSE_BUTTON_TITLE) <= 20 && EX.EXPENSE_BUTTON_TITLE === "🧾 تسجيل مصروف" && count(EX.EXPENSE_UNDO_TITLE) <= 20 && EX.EXPENSE_UNDO_TITLE === "↩️ تراجع");
  assert("a heading longer than eighty characters is cut; the line without «من جيب براء» is within a text's room too", count(EX.expenseData(TODAY, ["cash"], "م".repeat(90)).t as string) === 80 && Object.values(EX.EXPENSE_NO_POCKET_TEXT).every((l) => count(EX.expenseData(TODAY, ["cash", "bank"], "", l as string).n as string) <= 4096));
  clean();
}

// ================================================================ و2
console.log("\n[و2] the doors: «مصروف» / «تسجيل مصروف» and the button — from Baraa alone");
{
  assert("«مصروف» and «تسجيل مصروف» are the command — as a phone types them too: « مصروف. », «تسجيل  مصروف», «مَصروف»", ["مصروف", "تسجيل مصروف", " مصروف. ", "تسجيل  مصروف", "مَصروف", "مصروف؟"].every((t) => EX.expenseCommand(t)));
  assert("the WHOLE message: a sentence that holds the word is not the command", ["مصروف اليوم كم؟", "كم المصروف", "سجل مصروف وقود 50", "مصاريف", "المصروف", "تسجيل", "115", ""].every((t) => !EX.expenseCommand(t)));
  assert("the button: expense_start, «🧾 تسجيل مصروف»; the undo: exp_undo_<the bill>", JSON.stringify(EX.expenseButton()) === JSON.stringify({ id: "expense_start", title: "🧾 تسجيل مصروف" })
    && JSON.stringify(EX.expenseUndoButton(77)) === JSON.stringify({ id: "exp_undo_77", title: "↩️ تراجع" }) && EX.EXPENSE_UNDO_PAYLOAD.test("exp_undo_77") && !EX.EXPENSE_UNDO_PAYLOAD.test("exp_undo_x") && !EX.EXPENSE_UNDO_PAYLOAD.test("exp_undo_7_7"));
}
{
  const env = world();
  odooLog.length = 0;
  const r = await say(env, OWNER, text("مصروف"));
  const f = flowsTo(OWNER);
  assert("«مصروف» from Baraa through the webhook → ONE message: the expense form", r.status === 200 && sentTo(OWNER).length === 1 && f.length === 1 && graph.length === 1, JSON.stringify(graph.map(bodyOf)));
  assert("…its text: the day, and what to do", bodyOf(f[0]) === [`🧾 تسجيل مصروف — ${LABEL}`, "اضغط «سجّل المصروف»، عبّئ النوع والمبلغ والمورد وطريقة الدفع، ثم «إرسال»."].join("\n"), bodyOf(f[0]));
  assert("…asking for the form writes nothing in the books", bookWrites().length === 0 && bills().length === 0, JSON.stringify(bookWrites().map((c: any) => `${c.model}.${c.method}`)));
  await say(env, OWNER, text("تسجيل مصروف"));
  await say(env, OWNER, button("expense_start"));
  assert("«تسجيل مصروف» and the button expense_start → the form too, each with its own token", flowsTo(OWNER).length === 3 && sentTo(OWNER).length === 3 && new Set(flowsTo(OWNER).map(tokenOf)).size === 3);
  assert("…sent under the owner's purpose expense_form", JSON.stringify(purposes()) === JSON.stringify(["expense_form", "expense_form", "expense_form"]), JSON.stringify(purposes()));
  clean();
}
{
  // the owner's one regular tap: «تم الاطلاع» of the 21:30 summary
  const env = world();
  await say(env, OWNER, { type: "button", button: { payload: OW.SUMMARY_ACK_PAYLOAD, text: "تم الاطلاع" } });
  assert("the reply to «تم الاطلاع» is «تم ✅…» with ONE button under it: expense_start «🧾 تسجيل مصروف»", sentTo(OWNER).length === 1 && bodyOf(last()) === OW.SUMMARY_ACK_TEXT && JSON.stringify(buttonsOf(last())) === JSON.stringify([{ id: "expense_start", title: "🧾 تسجيل مصروف" }]), JSON.stringify(last()));
  assert("…«عرض الاستثناءات» carries no such button", OW.ownerWindowReplyButtons(env, OW.PRICE_REVIEW_PAYLOAD).length === 0 && OW.ownerWindowReplyButtons(env, OW.SUMMARY_ACK_PAYLOAD).length === 1);
  const off = world(`${TODAY} 14:00`, { sync: false });
  await say(off, OWNER, { type: "button", button: { payload: OW.SUMMARY_ACK_PAYLOAD, text: "تم الاطلاع" } });
  assert("with the accounting off the reply is the line alone, as before (no button to a form that records nothing)", sentTo(OWNER).length === 1 && last().type === "text" && bodyOf(last()) === OW.SUMMARY_ACK_TEXT);
}
{
  // anyone else: not this module's
  const env = world();
  await say(env, DRIVER_PHONE, text("مصروف"));
  assert("«مصروف» from a team member: no form — the team's usual answer", flowsTo(DRIVER_PHONE).length === 0 && sentTo(DRIVER_PHONE).length === 1 && bodyOf(sentTo(DRIVER_PHONE)[0]).includes("استخدم الأزرار عشان نأكد الحالة"), JSON.stringify(sentTo(DRIVER_PHONE).map(bodyOf)));
  await say(env, DRIVER_PHONE, button("expense_start"));
  assert("the button from him: no form — the answer of a button the worker does not know", flowsTo(DRIVER_PHONE).length === 0 && bodyOf(sentTo(DRIVER_PHONE).at(-1)).startsWith("هذا الزر من رسالة قديمة"), bodyOf(sentTo(DRIVER_PHONE).at(-1)));
  await say(env, C1_PHONE, button("expense_start"));
  assert("the button from a customer's number: no form; and nothing of all this reached Baraa as a form", sentTo(C1_PHONE).every((b: any) => b?.interactive?.type !== "flow") && flowsTo(OWNER).length === 0);
  graph.length = 0;
  const not = await quiet(() => EX.expenseMessage(env, { from: "+" + DRIVER_PHONE, type: "text", text: "مصروف" }));
  const other = await quiet(() => EX.expenseMessage(env, { from: "+" + OWNER, type: "text", text: "كم المصروف اليوم" }));
  assert("expenseMessage is false for another number's «مصروف» and for any other text of Baraa's — nothing is sent", not === false && other === false && graph.length === 0);
  clean();
}
{
  const env = world(`${TODAY} 14:00`, { sync: false });
  await say(env, OWNER, text("مصروف"));
  assert("with the accounting off (the sim worker): «مصروف» is answered in ONE line, and no form is sent", sentTo(OWNER).length === 1 && flowsTo(OWNER).length === 0 && bodyOf(last()) === EX.EXPENSE_OFF_TEXT && /المحاسبة مطفأة في هذه البيئة/.test(EX.EXPENSE_OFF_TEXT));
  // a form sent while it was on, answered after it went off
  const on = world();
  const token = await form(on);
  on.ACCOUNTING_SYNC = "false"; graph.length = 0; odooLog.length = 0;
  const r = await reply(on, OWNER, token, GOOD);
  assert("…and a form's «إرسال» there writes nothing: the same line", r.action === "off" && bills().length === 0 && bookWrites().length === 0 && bodyOf(last()) === EX.EXPENSE_OFF_TEXT);
}
{
  const env = world();
  closeOwnerWindow(env);
  const shut = await quiet(() => EX.startExpense(env));
  assert("outside his window the form does not go, and nothing is held (an interactive message is never a template)", shut.sent === false && shut.reason === "window_closed" && graph.length === 0 && heldFor(env, OWNER).length === 0);
  const down = world();
  quirk.down = "^account\\.journal/";
  const r = await quiet(() => EX.startExpense(down));
  assert("Odoo cannot be read: one line says the form could not go", r.sent === false && r.reason === "error" && sentTo(OWNER).length === 1 && bodyOf(last()) === EX.EXPENSE_FAILED_TEXT);
  const refused = world();
  quirk.metaRefusesFlows = true;
  const m = await quiet(() => EX.startExpense(refused));
  assert("Meta refuses the form: he is told it could not go, and its token is not kept", m.sent === false && /^rejected/.test(String(m.reason)) && sentTo(OWNER).some((b: any) => bodyOf(b) === EX.EXPENSE_FAILED_TEXT)
    && flowsTo(OWNER).length === 0 && ![...refused.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("expense_t:")), JSON.stringify({ m, sent: sentTo(OWNER).map(bodyOf) }));
  const idx = srcOf("index.ts");
  assert("the Flow's reply is routed by its «ex1.» token after the delivery form and before the price form's reader", idx.indexOf("isExpenseToken(msg.flow.token") > idx.indexOf("isDeliveryFormToken(msg.flow.token") && idx.indexOf("isExpenseToken(msg.flow.token") < idx.indexOf("handlePriceFlowReply(env, msg, ctx)"));
  const src = srcOf("expense-form.ts");
  assert("the form is never held: noHold on its send, and no template", /noHold: true,/.test(src) && !/kind: "template"/.test(src));
}

// ================================================================ و3
console.log("\n[و3] the seven types, each on its expense account — found by its code");
{
  assert("the constant is the order's table: the type, its words, its account's code", JSON.stringify(XA.EXPENSE_TYPES.map((t: any) => [t.id, t.title, t.code])) === JSON.stringify(TABLE.map(([id, title, code]) => [id, title, code])));
  const ids = doc("ODOO-IDS.md");
  assert("docs/ODOO-IDS.md carries the same table: a row a type, with the code, Odoo's name and the account's id", TABLE.every(([id, title, code, name, acc]) => ids.includes(`| ${title} (\`${id}\`) | ${code} | ${name} | #${acc} |`)), TABLE.filter(([id, title, code, name, acc]) => !ids.includes(`| ${title} (\`${id}\`) | ${code} | ${name} | #${acc} |`)).map((r) => r[0]).join(","));
  for (const [id, title, code, name, acc] of TABLE) {
    const env = world();
    const r = await send(env, { type: id });
    const b = bills()[0], l = b ? lineOn(b.id, acc) : null;
    assert(`«${title}» → ONE line on ${code} ${name} (#${acc}), and the answer names the account`, r.action === "recorded" && bills().length === 1 && linesOf(b.id).filter((x) => x.display_type === "product").length === 1 && l?.debit === 115 && l?.name === title
      && bodyOf(last()).includes(`✅ سُجّل المصروف — ${title}`) && bodyOf(last()).includes(`الحساب: ${code} ${name}`), bodyOf(last()));
  }
  clean();
}

// ================================================================ و4
console.log("\n[و4] the tax: «نعم» with a valid number splits the input VAT out of the amount paid — nothing else does");
{
  const env = world();
  odooLog.length = 0;
  const r = await send(env);
  const b = bills()[0], p = payments()[0];
  const created = odooLog.find((c: any) => c.model === "account.move" && c.method === "create")!.body.vals_list[0];
  assert("«لا»: a vendor bill (in_invoice) in the journal EXP — not BILL — to the supplier, dated the day, posted", r.action === "recorded" && bills().length === 1 && b.move_type === "in_invoice" && b.journal_id === J.EXP && b.partner_id === MISC && b.invoice_date === TODAY && b.state === "posted" && b.name === "EXP/2026/10/0001", JSON.stringify(b));
  assert("…ONE line: the type's name, the account, quantity 1, the amount AS PAID — and its taxes pinned EMPTY", created.invoice_line_ids.length === 1 && JSON.stringify(created.invoice_line_ids[0]) === JSON.stringify([0, 0, { name: "وقود", account_id: 211, quantity: 1, price_unit: 115, tax_ids: [[6, 0, []]] }]), JSON.stringify(created.invoice_line_ids));
  assert("…no tax line: 115 on the expense, 115 on the payable, total 115", b.amount_tax === 0 && b.amount_total === 115 && linesOf(b.id).length === 2 && lineOn(b.id, 211).debit === 115 && lineOn(b.id, ACC.payable).credit === 115);
  assert("…its reference is his note or the type's name, closed by this form's own mark", /^وقود — EX-[0-9A-F]{8}$/.test(b.ref), b.ref);
  assert("…then the payment, by the register wizard on that bill: the same day, the amount paid, from the driver's cash", payments().length === 1 && p.journal_id === J.CSHD && p.amount === 115 && p.date === TODAY && p.state === "paid" && b.payment_state === "paid"
    && (() => { const w = odooLog.find((c: any) => c.model === "account.payment.register" && c.method === "create")!.body; return JSON.stringify(w.vals_list) === JSON.stringify([{ journal_id: J.CSHD, amount: 115, payment_date: TODAY }]) && JSON.stringify(w.context) === JSON.stringify({ active_model: "account.move", active_ids: [b.id], active_id: b.id }); })());
  assert("his answer: the bill's number, the account, the supplier, the total without tax, the journal, the day — and what «↩️ تراجع» does", bodyOf(last()) === [
    "✅ سُجّل المصروف — وقود", "الفاتورة: EXP/2026/10/0001", "الحساب: 400077 Fuel", "المورد: مصروفات نقدية متنوعة", "الإجمالي 115 ر.س — بلا ضريبة مدخلات", "الدفع: كاش السائق (CSHD)", `التاريخ: ${LABEL}`,
    "«↩️ تراجع» خلال 24 ساعة يلغي الدفعة ويعيد الفاتورة مسودة (لا حذف).",
  ].join("\n"), bodyOf(last()));
  assert("…ONE message, with ONE button: exp_undo_<the bill>", graph.length === 1 && JSON.stringify(buttonsOf(last())) === JSON.stringify([{ id: `exp_undo_${b.id}`, title: "↩️ تراجع" }]) && bodyOf(last()).length <= 1024);
  clean();
}
{
  const env = world();
  odooLog.length = 0;
  const r = await send(env, { tax: "yes", vat: VAT, sup: "محطة الدريس", photo: PHOTO, note: "ديزل الدينا" });
  const b = bills()[0];
  const line = odooLog.find((c: any) => c.model === "account.move" && c.method === "create")!.body.vals_list[0].invoice_line_ids[0][2];
  assert("«نعم» with a valid number: the line carries the purchase tax «15% شامل (مشتريات)» (#43, price-included) — not the goods' #21", r.action === "recorded" && JSON.stringify(line.tax_ids) === JSON.stringify([[6, 0, [43]]]) && line.price_unit === 115 && line.name === "وقود — ديزل الدينا");
  assert("…Odoo splits it OUT of the amount paid: 100 on the expense, 15 on VAT Input, 115 on the payable — total 115, not 132.25", b.amount_total === 115 && b.amount_tax === 15 && lineOn(b.id, 211).debit === 100 && lineOn(b.id, ACC.vatIn).debit === 15 && lineOn(b.id, ACC.payable).credit === 115 && payments()[0].amount === 115);
  assert("…the answer reads net + VAT = total, his note, and the photo", bodyOf(last()).split("\n").slice(4, 9).join("\n") === ["الصافي 100 ر.س + ضريبة المدخلات 15 ر.س = الإجمالي 115 ر.س", "الدفع: كاش السائق (CSHD)", `التاريخ: ${LABEL}`, "ملاحظة: ديزل الدينا", "📎 الصورة مرفقة بالفاتورة."].join("\n")
    && !bodyOf(last()).includes("⚠️") && /^ديزل الدينا — EX-/.test(b.ref), bodyOf(last()));
  clean();
}
{
  const env = world();
  await send(env, { amt: "100", tax: "yes", vat: " ٣١٠١ ٢٣٤٥ ٦٧٠٠ ٠٠٣ ", sup: "محطة الدريس", photo: PHOTO });
  const b = bills()[0];
  assert("a number typed in Arabic-Indic digits with spaces is the same number; 100 paid = 86.96 + 13.04", b.amount_tax === 13.04 && lineOn(b.id, 211).debit === 86.96 && b.amount_total === 100 && rows("res.partner").find((p: any) => p.name === "محطة الدريس")?.vat === VAT
    && bodyOf(last()).includes("الصافي 86.96 ر.س + ضريبة المدخلات 13.04 ر.س = الإجمالي 100 ر.س"), bodyOf(last()));
  assert("isValidVatNumber: fifteen digits, the first 3 and the last 3", XA.isValidVatNumber(VAT) && XA.isValidVatNumber("3101-2345-6700-003") && ["31012345670000", "3101234567000033", "210123456700003", "310123456700004", "31012345670000a", "", null].every((v) => !XA.isValidVatNumber(v)));
}
for (const [typed, warn] of [["12345", "⚠️ الرقم الضريبي «12345» غير صحيح (15 رقماً يبدأ بـ 3 وينتهي بـ 3): سُجّل بلا ضريبة مدخلات."], ["", "⚠️ «فاتورة ضريبية: نعم» بلا رقم ضريبي للمورد: سُجّل بلا ضريبة مدخلات."], ["210123456700003", "⚠️ الرقم الضريبي «210123456700003» غير صحيح (15 رقماً يبدأ بـ 3 وينتهي بـ 3): سُجّل بلا ضريبة مدخلات."]]) {
  const env = world();
  odooLog.length = 0;
  const r = await send(env, { tax: "yes", vat: typed, sup: "ورشة النور", photo: PHOTO });
  const b = bills()[0];
  assert(`«نعم» with ${typed ? `the wrong number «${typed}»` : "no number"}: NOT refused — recorded WITHOUT tax, and the answer warns`, r.action === "recorded" && b.state === "posted" && b.amount_tax === 0 && b.amount_total === 115 && lineOn(b.id, 211).debit === 115 && !lineOn(b.id, ACC.vatIn)
    && bodyOf(last()).split("\n").at(-2) === warn && bodyOf(last()).includes("الإجمالي 115 ر.س — بلا ضريبة مدخلات"), bodyOf(last()));
  assert("…the wrong number is searched nowhere and kept nowhere: the new supplier has no tax number", !odooLog.some((c: any) => c.model === "res.partner" && JSON.stringify(c.body?.domain ?? []).includes("vat")) && !("vat" in rows("res.partner").find((p: any) => p.name === "ورشة النور")!) && !odooLog.some((c: any) => c.model === "account.tax"));
}
{
  const env = world();
  odooLog.length = 0;
  await send(env, { tax: "no", vat: VAT, sup: "ورشة النور" });
  const b = bills()[0];
  assert("«لا» with a valid number typed: the number is not read at all — no tax, not searched, not kept", b.amount_tax === 0 && b.amount_total === 115 && !odooLog.some((c: any) => c.model === "res.partner" && JSON.stringify(c.body?.domain ?? []).includes("vat")) && !("vat" in rows("res.partner").find((p: any) => p.name === "ورشة النور")!) && !bodyOf(last()).includes("⚠️"));
  clean();
}

// ================================================================ و5
console.log("\n[و5] the three journals — and «من جيب براء» only while BRA's outbound payment method posts to an account");
for (const [pay, journal, credit, state, title] of [["cash", J.CSHD, ACC.cash, "paid", "كاش السائق (CSHD)"], ["bank", J.BNK1, ACC.bankOut, "in_payment", "البنك (BNK1)"], ["owner", J.BRA, ACC.pocket, "paid", "من جيب براء"]] as Array<[string, number, number, string, string]>) {
  const env = world();
  const r = await send(env, { pay, date: YESTERDAY });
  const b = bills()[0], p = payments()[0];
  assert(`«${title}» → the payment from journal #${journal}, dated the bill's day, crediting ${(table("account.account").get(credit) as any).code}; the bill ${state}`, r.action === "recorded" && p.journal_id === journal && p.date === YESTERDAY && b.invoice_date === YESTERDAY && p.amount === 115
    && linesOf(p.move_id).find((l) => l.credit > 0).account_id === credit && linesOf(p.move_id).find((l) => l.debit > 0).account_id === ACC.payable && b.payment_state === state && bodyOf(last()).includes(`الدفع: ${title}`), bodyOf(last()));
}
{
  // which account «من جيب براء» credits is Baraa's setting on the method line — not the journal's default account
  const env = world();
  (table(METHOD).get(BRA_OUT) as any).payment_account_id = ACC.owner;
  odooLog.length = 0;
  const r = await send(env, { pay: "owner" });
  const p = payments()[0];
  assert("the method line set on 201021 «Owner Current Account» (the journal's default still 205001): the payment credits 201021, and stands", r.action === "recorded" && linesOf(p.move_id).find((l) => l.credit > 0).account_id === ACC.owner && (table("account.journal").get(J.BRA) as any).default_account_id === ACC.pocket);
  const asked = odooLog.filter((c: any) => c.model === METHOD);
  assert("of a payment method line the worker reads id, journal_id, payment_type and payment_account_id alone — BRA's outbound ones — and never the journal's default account", asked.length >= 1 && asked.every((c: any) => c.method === "search_read"
    && JSON.stringify(c.body.fields) === JSON.stringify(["id", "journal_id", "payment_type", "payment_account_id"]) && JSON.stringify(c.body.domain) === JSON.stringify([["journal_id", "=", J.BRA], ["payment_type", "=", "outbound"]]))
    && !odooLog.some((c: any) => c.model === "account.journal" && (c.body?.fields ?? []).includes("default_account_id")), JSON.stringify(asked.map((c: any) => c.body)));
}
{
  // the tenant today: the journal BRA is there, its outbound payment method posts to NO account
  const env = world();
  (table(METHOD).get(BRA_OUT) as any).payment_account_id = false;
  odooLog.length = 0;
  await quiet(() => EX.startExpense(env));
  const f = flowsTo(OWNER)[0], d = dataOf(f);
  const LINE = "⚠️ خيار «من جيب براء» غير معروض: يومية BRA بلا حساب على طريقة الدفع الصادرة (تُضبط في Odoo).";
  assert("BRA's outbound payment method has no account (the tenant today): «من جيب براء» is left out of the form's choices", JSON.stringify(d.pay) === JSON.stringify([{ id: "cash", title: "كاش السائق (CSHD)" }, { id: "bank", title: "البنك (BNK1)" }]));
  assert("…and ONE line tells Baraa why and where it is fixed, above the button and inside the form", bodyOf(f).split("\n").at(-1) === LINE && String(d.n).split("\n").at(-1) === LINE && EX.EXPENSE_NO_POCKET_TEXT.method === LINE && bodyOf(f).split("\n").length === 3 && bodyOf(f).length <= 1024, bodyOf(f));
  graph.length = 0;
  const r = await reply(env, OWNER, tokenOf(f), { ...GOOD, pay: "owner" });
  assert("a reply that names «من جيب براء» on that form is refused: it was not offered", r.action === "invalid" && JSON.stringify(r.problems) === JSON.stringify(["pay"]) && bills().length === 0);
  // the answer is kept ten minutes
  const n0 = odooLog.filter((c: any) => c.model === METHOD).length;
  (table(METHOD).get(BRA_OUT) as any).payment_account_id = ACC.pocket;
  await quiet(() => EX.startExpense(env, undefined, ms(`${TODAY} 14:09`)));
  const cached = flowsTo(OWNER).at(-1);
  await quiet(() => EX.startExpense(env, undefined, ms(`${TODAY} 14:10`)));
  assert("the journal and its method are read once and the answer — with its reason — kept ten minutes in KV: a form at +9 min still hides it and says why, at +10 min it is read again and offered", n0 === 1 && dataOf(cached).pay.length === 2 && bodyOf(cached).split("\n").at(-1) === LINE
    && dataOf(flowsTo(OWNER).at(-1)).pay.length === 3 && odooLog.filter((c: any) => c.model === METHOD).length === 2 && XA.POCKET_TTL_SECONDS === 600 && env.MSG_DEDUP.store.has(XA.POCKET_KV_KEY));
}
{
  const env = world();
  table("account.journal").delete(J.BRA);
  await quiet(() => EX.startExpense(env));
  const f = flowsTo(OWNER)[0];
  assert("the journal BRA is not in Odoo at all: not offered, and the line says THAT", dataOf(f).pay.length === 2 && bodyOf(f).split("\n").at(-1) === "⚠️ خيار «من جيب براء» غير معروض: يومية BRA غير موجودة في Odoo." && String(dataOf(f).n).split("\n").at(-1) === EX.EXPENSE_NO_POCKET_TEXT.journal, bodyOf(f));
  const pocket = async (lines: Array<number | false>) => {
    const e = world();
    table(METHOD).delete(BRA_OUT);
    lines.forEach((acc, i) => seed(METHOD, { id: 80 + i, journal_id: J.BRA, payment_type: "outbound", payment_account_id: acc }));
    return quiet(async () => XA.readPocket(e, await XA.readExpenseJournals(e)));
  };
  const none = await pocket([]), one = await pocket([ACC.owner]), mixed = await pocket([ACC.pocket, false]), two = await pocket([ACC.pocket, ACC.owner]), same = await pocket([ACC.pocket, ACC.pocket]);
  assert("readPocket: no outbound method, one without an account among them, or two on different accounts → not recordable; all on ONE account → that account (the inbound method, which has none, is not asked)", JSON.stringify(none) === JSON.stringify({ ok: false, why: "method" })
    && JSON.stringify(one) === JSON.stringify({ ok: true, accountId: ACC.owner }) && mixed.ok === false && two.ok === false && JSON.stringify(same) === JSON.stringify({ ok: true, accountId: ACC.pocket }), JSON.stringify([none, one, mixed, two, same]));
  // offered when the form was sent, gone when it is answered
  const env2 = world();
  const token = await form(env2);
  table("account.journal").delete(J.BRA);
  graph.length = 0; odooLog.length = 0;
  const r = await reply(env2, OWNER, token, { ...GOOD, pay: "owner" });
  assert("offered when the form was sent and the journal gone at «إرسال»: nothing is written, and he is told which journal", r.action === "blocked" && bookWrites().length === 0 && bodyOf(last()).includes("يومية الدفع BRA («من جيب براء») غير موجودة في Odoo"), bodyOf(last()));
  const env3 = world();
  const t3 = await form(env3);
  (table(METHOD).get(BRA_OUT) as any).payment_account_id = false;
  graph.length = 0; odooLog.length = 0;
  const r3 = await reply(env3, OWNER, t3, { ...GOOD, pay: "owner" });
  assert("…and a method that lost its account by then (the form's own answer is not trusted): nothing is written either — no payment without an entry", r3.action === "blocked" && bookWrites().length === 0 && payments().length === 0
    && bodyOf(last()) === ["⚠️ لم يُسجَّل المصروف، ولم يُكتب شيء في Odoo:", "• يومية BRA بلا حساب على طريقة الدفع الصادرة (تُضبط في Odoo)", "أصلحه في Odoo ثم أعد «إرسال» من النموذج نفسه."].join("\n"), bodyOf(last()));
  clean();
}

// ================================================================ و6
console.log("\n[و6] the supplier: by his tax number, then by his name; none → a new supplier with no customer rank");
{
  const env = world();
  seed("res.partner", { id: 301, name: "شركة الدريس للخدمات البترولية", vat: VAT, supplier_rank: 2, customer_rank: 0 });
  seed("res.partner", { id: 300, name: "محطة الدريس", supplier_rank: 1 });
  const before = JSON.stringify([table("res.partner").get(300), table("res.partner").get(301)]);
  const n = rows("res.partner").length;
  odooLog.length = 0;
  await send(env, { tax: "yes", vat: VAT, sup: "محطة الدريس", photo: PHOTO });
  assert("a valid number finds the partner that holds it — before the name is tried — and the bill is his", bills()[0].partner_id === 301 && payments()[0].partner_id === 301 && bodyOf(last()).includes("المورد: شركة الدريس للخدمات البترولية\n"), bodyOf(last()));
  assert("…no partner is created, and neither existing one is modified", rows("res.partner").length === n && JSON.stringify([table("res.partner").get(300), table("res.partner").get(301)]) === before && !bookWrites().some((c: any) => c.model === "res.partner"));
}
{
  const env = world();
  seed("res.partner", { id: 310, name: "ورشة النور", supplier_rank: 0, customer_rank: 1 });
  seed("res.partner", { id: 311, name: "ورشة  النور", supplier_rank: 1 });
  seed("res.partner", { id: 312, name: "ورشة النور للسيارات", supplier_rank: 5 });
  const n = rows("res.partner").length;
  await send(env, { sup: " ورشة النور " });
  assert("by name: the SAME name (its spaces aside), a partner that is a supplier before one that is not — never a name that only contains it", bills()[0].partner_id === 311 && rows("res.partner").length === n && bodyOf(last()).includes("المورد: ورشة  النور\n"), `partner=${bills()[0].partner_id}`);
  table("res.partner").delete(311);
  await send(env, { sup: "ورشة النور" });
  assert("…a partner of that name who is no supplier yet is used as he is (the oldest), not duplicated", bills().at(-1).partner_id === 310 && rows("res.partner").length === n - 1 && (table("res.partner").get(310) as any).supplier_rank === 0);
  assert("supplierNameKey: one space for every run of spaces, no case", XA.supplierNameKey("  ABC   Co\u00a0Ltd ") === "abc co ltd" && XA.supplierNameKey("ورشة\u200fالنور") === "ورشة النور");
}
{
  // as on prod (no test mode: the gateway of Odoo adds nothing to a created partner)
  const env = world(); env.PILOT_MODE = "false";
  const n = rows("res.partner").length;
  odooLog.length = 0;
  await send(env, { sup: "مؤسسة التغليف الحديث", type: "packaging" });
  const p = rows("res.partner").at(-1) as any;
  assert("no partner by that name: a NEW one — a company, a supplier, customer rank 0, classed «supplier» (never left unreviewed), and nothing else on him (no number, no WhatsApp, no tax number)", rows("res.partner").length === n + 1 && bills()[0].partner_id === p.id
    && JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => k !== "id"))) === JSON.stringify({ name: "مؤسسة التغليف الحديث", is_company: true, supplier_rank: 1, customer_rank: 0, x_contact_class: "supplier" }), JSON.stringify(p));
  assert("…the answer says «مورد جديد»", bodyOf(last()).includes("المورد: مؤسسة التغليف الحديث (مورد جديد)\n"));
  const env2 = world(); env2.PILOT_MODE = "false";
  await send(env2, { tax: "yes", vat: VAT, sup: "محطة الدريس", photo: PHOTO });
  const q = rows("res.partner").at(-1) as any;
  assert("…created with «نعم» and a valid number: the number, «مسجل في الضريبة», and still no customer rank", JSON.stringify(Object.fromEntries(Object.entries(q).filter(([k]) => k !== "id"))) === JSON.stringify({ name: "محطة الدريس", is_company: true, supplier_rank: 1, customer_rank: 0, x_contact_class: "supplier", vat: VAT, x_vat_registered: true, x_vat_status: "registered" }), JSON.stringify(q));
  // a name and a note longer than their room
  const env3 = world();
  const long = "مؤسسة ".repeat(40).trim(), words = "ملاحظة طويلة ".repeat(40).trim();
  await send(env3, { sup: long, note: words });
  const p3 = rows("res.partner").at(-1) as any, line3 = linesOf(bills()[0].id).find((l) => l.display_type === "product");
  assert("a supplier's name is kept to eighty characters and a note to two hundred — and the answer still fits one message", count(p3.name) === 80 && p3.name.endsWith("…") && count(line3.name) === count("وقود — ") + 200 && EX.EXPENSE_SUPPLIER_MAX === 80 && EX.EXPENSE_NOTE_MAX === 200
    && bodyOf(last()).length <= 1024 && buttonsOf(last()).length === 1 && bodyOf(last()).split("\n").at(-1) === EX.EXPENSE_UNDO_HINT, `${count(p3.name)} ${count(line3.name)} ${bodyOf(last()).length}`);
  clean();
}

// ================================================================ و7
console.log("\n[و7] the photo: attached to the bill; a download that fails does not lose the entry");
{
  const env = world();
  const r = await send(env, { photo: PHOTO });
  const b = bills()[0], a = rows("ir.attachment") as any[];
  // the second download is § 57 ز's: the seam below reads the picture for its seller's tax number (tests/s57-supplier-vat.test.mts)
  assert("a photo in the reply is downloaded by its media id and attached to the BILL (ir.attachment, `raw`)", r.action === "recorded" && JSON.stringify(mediaCalls) === JSON.stringify(["EXPH_A1", "EXPH_A1"]) && a.length === 1 && a[0].res_model === "account.move" && a[0].res_id === b.id
    && a[0].raw === Buffer.from(MEDIA_BYTES).toString("base64") && a[0].mimetype === "image/jpeg" && a[0].name === `مرفق-المصروف-${TODAY}-${b.id}.jpg`, JSON.stringify(a.map((x) => ({ ...x, raw: "…" }))));
  assert("…and the answer says so", bodyOf(last()).includes(EX.EXPENSE_PHOTO_SAVED_TEXT));
  const src = srcOf("expense-form.ts");
  assert("the seam of § 57 ز: expensePhotoPosted(env, { partnerId, moveId, mediaId, mime }) is exported, called once the expense stands with its photo, and answers nothing (what it does is § 57 ز's: tests/s57-supplier-vat.test.mts)", typeof EX.expensePhotoPosted === "function"
    && (await EX.expensePhotoPosted(env, { partnerId: 1, moveId: 2, mediaId: "x", mime: "image/jpeg" })) === undefined && /if \(r\.photo === "saved" && read\.photo\) \{\s+try \{ await expensePhotoPosted\(env, \{ partnerId: r\.supplierId, moveId: r\.moveId, mediaId: read\.photo\.id, mime: /.test(src));
}
{
  const env = world();
  const r = await send(env, { photo: [{ file_name: "x.jpg", mime_type: "image/jpeg", sha256: "cd", id: "EXPH_BAD1" }] });
  assert("the download fails: the expense is still recorded, nothing is attached, and the answer says the photo was not kept", r.action === "recorded" && bills()[0].state === "posted" && payments().length === 1 && rows("ir.attachment").length === 0 && mediaCalls.length === 1
    && bodyOf(last()).includes(EX.EXPENSE_PHOTO_FAILED_TEXT) && !bodyOf(last()).includes(EX.EXPENSE_PHOTO_SAVED_TEXT), bodyOf(last()));
  const env2 = world();
  quirk.attachRefused = "attachment too large";
  const r2nd = await send(env2, { photo: PHOTO });
  assert("Odoo refuses the attachment: the same — recorded, and said", r2nd.action === "recorded" && bills()[0].state === "posted" && rows("ir.attachment").length === 0 && bodyOf(last()).includes(EX.EXPENSE_PHOTO_FAILED_TEXT));
  const env3 = world();
  await send(env3);
  assert("no photo and no tax invoice: nothing is downloaded, nothing attached, and no line about a photo", mediaCalls.length === 0 && rows("ir.attachment").length === 0 && !/الصورة/.test(bodyOf(last())));
  clean();
}

// ================================================================ و8
console.log("\n[و8] a field that cannot be read: the WHOLE form is refused, nothing is written, and a fresh form goes");
{
  const BAD: Array<[string, Record<string, unknown>, string]> = [
    ["a type that is not one of the seven", { type: "travel" }, "type"], ["no type", { type: undefined }, "type"],
    // § 58 أ 4 — a form of utak_expense_v1 sent before the list changed: refused whole, by its own line
    ["«رواتب وأجور» of a form of utak_expense_v1", { type: "salaries" }, "salaries"],
    ["an amount of zero", { amt: "0" }, "amt"], ["a negative amount", { amt: "-5" }, "amt"], ["an amount that is no number", { amt: "مئة" }, "amt"], ["no amount", { amt: "" }, "amt"], ["three decimals", { amt: "12.345" }, "amt"],
    ["«فاتورة ضريبية؟» without an answer", { tax: undefined }, "tax"], ["«فاتورة ضريبية؟» with another word", { tax: "maybe" }, "tax"],
    ["no supplier name", { sup: "" }, "sup"], ["a supplier name of spaces", { sup: "   " }, "sup"],
    ["a way of paying that is not one", { pay: "card" }, "pay"], ["no way of paying", { pay: undefined }, "pay"],
    ["a date that is no day", { date: "2026-02-30" }, "date"], ["a date in another shape", { date: "05/10/2026" }, "date"],
    ["a date after today in Riyadh", { date: TOMORROW }, "future"],
    ["«نعم» without the invoice's photo", { tax: "yes", vat: VAT }, "photo"], ["«نعم» with a wrong number and no photo", { tax: "yes", vat: "1" }, "photo"],
  ];
  for (const [what, values, key] of BAD) {
    const env = world();
    const token = await form(env);
    graph.length = 0; odooLog.length = 0;
    const r = await reply(env, OWNER, token, { ...GOOD, ...values });
    const f = flowsTo(OWNER);
    assert(`${what} → refused: nothing in Odoo, ONE message — a fresh form naming it`, r.action === "invalid" && JSON.stringify(r.problems) === JSON.stringify([key]) && bookWrites().length === 0 && bills().length === 0 && mediaCalls.length === 0
      && graph.length === 1 && f.length === 1 && tokenOf(f[0]) !== token && bodyOf(f[0]) === ["⚠️ لم يُسجَّل شيء من النموذج:", `• ${EX.EXPENSE_BAD[key]}`, "عبّه من جديد ثم «إرسال» 👇"].join("\n"), `${JSON.stringify(r)} ${bodyOf(f[0])}`);
  }
  assert("each problem has its own words — «رواتب وأجور» says the salaries have their monthly entry", Object.keys(EX.EXPENSE_BAD).length === 9 && new Set(Object.values(EX.EXPENSE_BAD)).size === 9
    && EX.EXPENSE_BAD.salaries.includes("«رواتب وأجور»") && EX.EXPENSE_BAD.salaries.includes("بقيدها الشهري"), EX.EXPENSE_BAD.salaries);
}
{
  const env = world();
  const token = await form(env);
  graph.length = 0;
  const r = await reply(env, OWNER, token, { type: "x", amt: "0", sup: "", pay: "x", date: "x", tax: "yes", photo: [] });
  assert("several at once: every one is named, in the form's order", r.action === "invalid" && JSON.stringify(r.problems) === JSON.stringify(["type", "amt", "sup", "pay", "date", "photo"]) && bodyOf(flowsTo(OWNER)[0]).split("\n").length === 8);
  const again = await reply(env, OWNER, token, GOOD);
  assert("the refused form's token is spent; the FRESH form's is good", again.action === "duplicate" && bills().length === 0 && (await reply(env, OWNER, tokenOf(flowsTo(OWNER)[0]), GOOD)).action === "recorded" && bills().length === 1);
  // the fresh form cannot go: the refusal is said as text
  const env2 = world();
  const t2 = await form(env2);
  quirk.down = "^account\\.journal/"; env2.MSG_DEDUP.store.delete(XA.POCKET_KV_KEY); graph.length = 0;
  await reply(env2, OWNER, t2, { ...GOOD, amt: "0" });
  assert("the fresh form cannot be sent: the refusal still reaches him, as a text", graph.length === 1 && last().type === "text" && bodyOf(last()).includes(EX.EXPENSE_BAD.amt));
}
{
  const env = world(`${TODAY} 00:20`);
  const r = await send(env, { date: "" });
  assert("an empty date is today in Riyadh (20 minutes after midnight: not yesterday's UTC day)", r.action === "recorded" && bills()[0].invoice_date === TODAY && payments()[0].date === TODAY);
  assert("parseExpenseAmount: «115», «٨٦٫٩٦», «86,5» — above zero, two decimals at most", EX.parseExpenseAmount("115") === 115 && EX.parseExpenseAmount("٨٦٫٩٦") === 86.96 && EX.parseExpenseAmount("86,5") === 86.5 && EX.parseExpenseAmount(0.5) === 0.5
    && ["0", "0.00", "-1", "1.234", "1e3", "", " ", null, undefined, "١٢ ريال"].every((v) => EX.parseExpenseAmount(v) === "invalid"));
  assert("parseExpenseDate: today and before; never after; a real day only", EX.parseExpenseDate(TODAY, TODAY) === TODAY && EX.parseExpenseDate("2026-09-30", TODAY) === "2026-09-30" && EX.parseExpenseDate(TOMORROW, TODAY) === "future" && EX.parseExpenseDate("", TODAY) === TODAY
    && ["2026-02-30", "2026-13-01", "20261005", "1759654800000", "today"].every((v) => EX.parseExpenseDate(v, TODAY) === "invalid"));
  clean();
}

// ================================================================ و9
console.log("\n[و9] the guards: each clause — and, through the form, everything written is undone");
{
  const L = (code: string, type: string, debit: number, credit: number, is_tax = false) => ({ account_code: code, account_type: type, debit, credit, is_tax });
  const bill = (o: Record<string, unknown> = {}) => XA.evaluateExpenseBillGuard({
    moveType: "in_invoice", moveState: "posted", journalId: 20, expectedJournalId: 20, accountCode: "400077", total: 115, expectTax: true, expectedTax: 15, amountTax: 15, amountTotal: 115,
    lines: [L("400077", "expense", 100, 0), L("104041", "asset_current", 15, 0, true), L("201002", "liability_payable", 0, 115)], ...o,
  } as any);
  const untaxed = [L("400077", "expense", 115, 0), L("201002", "liability_payable", 0, 115)];
  assert("the bill guard passes a taxed bill (100 + 15 = 115) and an untaxed one (115)", bill().ok && bill({ expectTax: false, expectedTax: 0, amountTax: 0, lines: untaxed }).ok, bill().reasons.join("؛"));
  const refuses = (name: string, o: Record<string, unknown>, re: RegExp) => { const g = bill(o); assert(`the bill guard refuses ${name}`, !g.ok && g.reasons.length === 1 && re.test(g.reasons[0]), g.reasons.join("؛")); };
  refuses("an entry that is not a vendor bill", { moveType: "entry" }, /نوع القيد entry/);
  refuses("a bill that is not posted", { moveState: "draft" }, /حالتها draft/);
  refuses("a bill in another journal (BILL, the goods')", { journalId: 9 }, /في اليومية 9 وليست يومية المصاريف 20/);
  refuses("a line on another account", { lines: [L("400028", "expense", 100, 0), L("104041", "asset_current", 15, 0, true), L("201002", "liability_payable", 0, 115)] }, /على الحساب 400028 والمتوقع 400077/);
  refuses("two expense lines", { lines: [L("400077", "expense", 60, 0), L("400077", "expense", 40, 0), L("104041", "asset_current", 15, 0, true), L("201002", "liability_payable", 0, 115)] }, /سطور المصروف 2/);
  refuses("a payable that is not the amount paid", { lines: [L("400077", "expense", 100, 0), L("104041", "asset_current", 15, 0, true), L("201002", "liability_payable", 0, 100)] }, /الذمم الدائنة 100 ≠ المبلغ المدفوع 115/);
  refuses("a total that is not the amount paid", { amountTotal: 132.25 }, /إجمالي الفاتورة 132.25 ≠ المبلغ المدفوع 115/);
  refuses("a tax that is not the split of the amount paid", { amountTax: 17.25 }, /ضريبة المدخلات 17.25/);
  refuses("a tax line where none is expected", { expectTax: false, expectedTax: 0, amountTax: 0, lines: [L("400077", "expense", 115, 0), L("104041", "asset_current", 0, 0, true), L("201002", "liability_payable", 0, 115)] }, /والمتوقع بلا ضريبة/);
  const g = bill({ lines: untaxed });
  assert("the bill guard refuses a taxed bill whose tax line is missing (the expense took the whole amount)", !g.ok && g.reasons.some((r: string) => /ضريبة المدخلات/.test(r)) && g.reasons.some((r: string) => /سطر المصروف مدين 115/.test(r)), g.reasons.join("؛"));

  const pay = (o: Record<string, unknown> = {}) => XA.evaluateExpensePaymentGuard({
    paymentState: "paid", journalId: 19, partnerId: 55, amount: 115, moveId: 900, moveState: "posted", billPaymentState: "paid", expectedJournalId: 19, expectedPartnerId: 55, total: 115, pocketAccountCode: null,
    lines: [L("201002", "liability_payable", 115, 0), L("101007", "asset_cash", 0, 115)], ...o,
  } as any);
  const pocket = [L("201002", "liability_payable", 115, 0), L("205001", "liability_current", 0, 115)];
  assert("the payment guard passes cash (on the cash account), the bank (in_payment, on its outstanding payments) and «من جيب براء» (on 205001)", pay().ok && pay({ billPaymentState: "in_payment", lines: [L("201002", "liability_payable", 115, 0), L("101004", "asset_current", 0, 115)] }).ok
    && pay({ pocketAccountCode: "205001", lines: pocket }).ok && pay({ paymentState: "reconciled" }).ok, pay().reasons.join("؛"));
  const stops = (name: string, o: Record<string, unknown>, re: RegExp) => { const x = pay(o); assert(`the payment guard refuses ${name}`, !x.ok && x.reasons.length === 1 && re.test(x.reasons[0]), x.reasons.join("؛")); };
  stops("a payment with no entry", { moveId: 0, moveState: "", lines: [] }, /بلا قيد/);
  stops("an entry that is not posted", { moveState: "draft" }, /قيد الدفعة حالته draft/);
  for (const s of ["draft", "canceled", "rejected"]) stops(`a payment that is ${s}`, { paymentState: s }, new RegExp(`حالة الدفعة ${s}`));
  stops("a payment from another journal", { journalId: 13 }, /من اليومية 13 وليست 19/);
  stops("a payment to another partner", { partnerId: 31 }, /شريك الدفعة 31 ≠ مورد الفاتورة 55/);
  stops("a payment of another amount", { amount: 100 }, /مبلغ الدفعة 100 ≠ المبلغ المدفوع 115/);
  stops("an entry that debits anything but the payable", { lines: [L("400077", "expense", 115, 0), L("101007", "asset_cash", 0, 115)] }, /مدين على 400077 \(expense\)/);
  stops("a cash payment credited to a liability", { lines: pocket }, /دائن على 205001 \(liability_current\) وليس على النقد أو البنك/);
  stops("«من جيب براء» credited anywhere but the partner's current account", { pocketAccountCode: "205001" }, /دائن على 101007 وليس على جاري الشريك 205001/);
  stops("a bill left unpaid", { billPaymentState: "not_paid" }, /حالة سداد الفاتورة not_paid/);
}
{
  // through the form: what Odoo does wrong, and what is left behind
  const CASES: Array<[string, Record<string, unknown>, RegExp, { payment: boolean }]> = [
    ["Odoo refuses to post the bill", { postRefused: "السنة المالية مقفلة" }, /رفض Odoo ترحيل الفاتورة: .*السنة المالية مقفلة/, { payment: false }],
    ["a tax is added on top of the amount paid (132.25 for 115)", { forceTax: 21 }, /حارس الفاتورة: .*إجمالي الفاتورة 132.25 ≠ المبلغ المدفوع 115/, { payment: false }],
    ["the line lands on another account", { lineAccount: 163 }, /حارس الفاتورة: سطر المصروف على الحساب 400028 والمتوقع 400077/, { payment: false }],
    ["the wizard refuses the payment", { wizardRefused: "no outstanding account" }, /تعذّر التسجيل في Odoo: .*no outstanding account/, { payment: false }],
    ["the payment has no journal entry", { payNoMove: true }, /حارس الدفعة: الدفعة بلا قيد/, { payment: true }],
    ["the payment comes from another journal", { payJournal: J.BNK1 }, /حارس الدفعة: الدفعة من اليومية 13 وليست 19/, { payment: true }],
    ["the bill is left unpaid", { billPaymentState: "not_paid" }, /حارس الدفعة: حالة سداد الفاتورة not_paid/, { payment: true }],
    ["the payment is credited to an income account", { payCreditAccount: ACC.income }, /حارس الدفعة: قيد الدفعة دائن على 500001 \(income\)/, { payment: true }],
  ];
  for (const [what, q, re, left] of CASES) {
    const env = world();
    const token = await form(env);
    Object.assign(quirk, q); graph.length = 0;
    const r = await reply(env, OWNER, token, { ...GOOD, photo: PHOTO });
    const b = bills()[0], p = payments()[0];
    assert(`${what} → NOTHING is left posted: the bill is a draft${left.payment ? ", its payment cancelled" : ", no payment"} — and nothing is deleted`, r.action === "failed" && bills().length === 1 && b.state === "draft" && b.payment_state === "not_paid"
      && (left.payment ? payments().length === 1 && p.state === "canceled" : payments().length === 0), JSON.stringify({ r, bill: b?.state, pay: p?.state }));
    assert("…Baraa is told why and what is left, in ONE message without «↩️ تراجع»", graph.length === 1 && last().type === "text" && re.test(bodyOf(last())) && bodyOf(last()).startsWith("⚠️ لم يُسجَّل المصروف: ")
      && bodyOf(last()).includes(`لا شيء مرحَّل: الفاتورة #${b.id} مسودة في Odoo (لم تُحذف)`) && bodyOf(last()).split("\n").at(-1) === "بعد التصحيح اكتب «مصروف» لنموذج جديد.", bodyOf(last()));
    assert("…no undo is on offer for it, and the form's token is spent (a second «إرسال» is not a second bill)", ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("expense_undo:")) && (await reply(env, OWNER, token, GOOD)).action === "duplicate" && bills().length === 1);
  }
}
{
  // the payment was made and the worker cannot find it: the bill does not stay posted under it
  const env = world();
  const token = await form(env);
  quirk.noAction = true; quirk.payAmount = 99; graph.length = 0;
  const r = await reply(env, OWNER, token, GOOD);
  assert("the wizard answers no payment and none is found by partner, amount, journal and day: the bill goes back to draft, and he is told to look", r.action === "failed" && bills()[0].state === "draft" && /أنشأ Odoo الدفعة ولم يُعثر عليها/.test(bodyOf(last())));
  const env2 = world();
  const t2 = await form(env2);
  quirk.noAction = true; graph.length = 0;
  const ok = await reply(env2, OWNER, t2, GOOD);
  assert("…when the action names none but the payment is there, it is found by partner, amount, journal and day", ok.action === "recorded" && ok.paymentId === payments()[0].id && bills()[0].payment_state === "paid");
}
{
  // the undo itself fails: he is told what is left
  const env = world();
  const token = await form(env);
  quirk.billPaymentState = "not_paid"; quirk.payCancelRefused = "الدفعة مطابقة لكشف البنك"; graph.length = 0;
  const r = await reply(env, OWNER, token, GOOD);
  assert("a guard fails and Odoo refuses to cancel the payment: the bill is NOT sent back to draft under a live payment, and he is told what is left", r.action === "failed" && payments()[0].state === "paid" && bills()[0].state === "posted"
    && /🚨 بقي في Odoo ما يحتاج مراجعتك يدوياً \(الفاتورة #\d+\): الدفعة \d+ لم تُلغَ \(حالتها paid\)، فبقيت الفاتورة كما هي/.test(bodyOf(last())) && !bodyOf(last()).includes("لا شيء مرحَّل"), bodyOf(last()));
  const env2 = world();
  const t2 = await form(env2);
  quirk.forceTax = 21; quirk.draftRefused = "locked"; graph.length = 0;
  await reply(env2, OWNER, t2, GOOD);
  assert("…and a bill Odoo refuses to send back to draft is named too", bills()[0].state === "posted" && /🚨 .*الفاتورة \d+ لم تعد مسودة \(حالتها posted\)/.test(bodyOf(last())), bodyOf(last()));
  clean();
}

// ================================================================ و10
console.log("\n[و10] Odoo lacks an account, a journal or the tax: nothing is written, and Baraa is told which");
{
  const LACK: Array<[string, (env: any) => void, Record<string, unknown>, string]> = [
    ["the type's account is not in the chart", () => table("account.account").delete(199), { type: "packaging" }, "• الحساب 400064 («مواد تغليف») غير موجود في دليل الحسابات"],
    ["the code is not an expense account", () => { (table("account.account").get(211) as any).account_type = "asset_current"; }, {}, "• الحساب 400077 («وقود») نوعه asset_current وليس حساب مصروف"],
    ["the journal EXP is missing", () => table("account.journal").delete(J.EXP), {}, "• يومية المصاريف EXP غير موجودة في Odoo"],
    ["the journal of the payment is missing", () => table("account.journal").delete(J.CSHD), {}, "• يومية الدفع CSHD («كاش السائق (CSHD)») غير موجودة في Odoo"],
    ["the price-included purchase tax is missing", () => table("account.tax").delete(43), { tax: "yes", vat: VAT, photo: PHOTO }, "• ضريبة المشتريات «15% شامل (مشتريات)» غير موجودة في Odoo أو ليست شاملة في السعر"],
  ];
  for (const [what, breakIt, values, line] of LACK) {
    const env = world();
    const token = await form(env);
    breakIt(env); graph.length = 0; odooLog.length = 0;
    const r = await reply(env, OWNER, token, { ...GOOD, sup: "مورد لم يُعرف بعد", ...values });
    assert(`${what} → nothing is written (no bill, no payment, no supplier, nothing downloaded), and he is told which`, r.action === "blocked" && bookWrites().length === 0 && bills().length === 0 && !rows("res.partner").some((p: any) => p.name === "مورد لم يُعرف بعد") && mediaCalls.length === 0
      && graph.length === 1 && bodyOf(last()) === ["⚠️ لم يُسجَّل المصروف، ولم يُكتب شيء في Odoo:", line, "أصلحه في Odoo ثم أعد «إرسال» من النموذج نفسه."].join("\n"), bodyOf(last()));
  }
  // after the fix, the SAME form goes through
  const env = world();
  const token = await form(env);
  const acc = { ...(table("account.account").get(211) as any) };
  table("account.account").delete(211);
  await reply(env, OWNER, token, GOOD);
  seed("account.account", acc);
  const r = await reply(env, OWNER, token, GOOD);
  assert("…nothing was spent: after the fix the same form's «إرسال» records it, once", r.action === "recorded" && bills().length === 1 && (await reply(env, OWNER, token, GOOD)).action === "duplicate" && bills().length === 1);
}
{
  const env = world();
  seed("account.tax", { id: 44, name: "15% شامل (مشتريات خدمات)", amount: 15, amount_type: "percent", type_tax_use: "purchase", price_include: true, active: true });
  const two = await quiet(() => XA.findInclusivePurchaseTax(env));
  (table("account.tax").get(43) as any).name = "ضريبة أخرى";
  const none = await quiet(() => XA.findInclusivePurchaseTax(env));
  table("account.tax").delete(44);
  const one = await quiet(() => XA.findInclusivePurchaseTax(env));
  (table("account.tax").get(43) as any).active = false;
  const archived = await quiet(() => XA.findInclusivePurchaseTax(env));
  assert("the tax is found by what it IS — purchase, 15 percent, included in the price, active — by its name when Odoo has several; never the one added on top, never an archived one", two?.id === 43 && none === null && one?.id === 43 && one.rate === 15 && archived === null);
  const down = world();
  const token = await form(down);
  quirk.down = "^account\\.account/"; graph.length = 0; odooLog.length = 0;
  const r = await reply(down, OWNER, token, GOOD);
  delete quirk.down;
  assert("Odoo cannot be read at «إرسال»: nothing is written, one line, and the same form can be sent again", r.action === "error" && bookWrites().length === 0 && bodyOf(last()) === EX.EXPENSE_ERROR_TEXT && (await reply(down, OWNER, token, GOOD)).action === "recorded");
  clean();
}

// ================================================================ و11
console.log("\n[و11] «↩️ تراجع»: for 24 hours, once, Baraa alone — the payment cancelled, the bill a draft, nothing deleted");
{
  const env = world(`${TODAY} 14:00`);
  await send(env, { photo: PHOTO });
  const b = bills()[0], p = payments()[0], id = buttonsOf(last())[0].id;
  const counts = () => JSON.stringify([rows("account.move").length, rows("account.payment").length, rows("ir.attachment").length, rows("res.partner").length]);
  const n = counts();
  // from anyone else: not theirs
  graph.length = 0; odooLog.length = 0;
  await say(env, DRIVER_PHONE, button(id));
  assert("the button from another number changes nothing (the answer of a button the worker does not know)", b.state === "posted" && p.state === "paid" && !bookWrites().some((c: any) => /^(account\.|res\.partner|ir\.attachment)/.test(c.model)) && sentTo(OWNER).length === 0 && bodyOf(sentTo(DRIVER_PHONE).at(-1)).startsWith("هذا الزر من رسالة قديمة"),
    JSON.stringify({ bill: b.state, pay: p.state, w: bookWrites().map((c: any) => `${c.model}.${c.method}`), owner: sentTo(OWNER).map(bodyOf), driver: sentTo(DRIVER_PHONE).map(bodyOf) }));
  setRiyadh(`${TODAY} 20:00`); graph.length = 0; odooLog.length = 0;
  await say(env, OWNER, button(id));
  const calls = bookWrites().map((c: any) => `${c.model}.${c.method}`);
  assert("Baraa's tap, six hours later: the payment back to draft and cancelled, THEN the bill back to draft", JSON.stringify(calls) === JSON.stringify(["account.payment.action_draft", "account.payment.action_cancel", "account.move.button_draft"]) && p.state === "canceled" && b.state === "draft" && b.payment_state === "not_paid", JSON.stringify(calls));
  assert("…nothing is deleted: the bill, the payment, the photo and the supplier are all still there", counts() === n && !odooLog.some((c: any) => c.method === "unlink") && (rows("ir.attachment")[0] as any).res_id === b.id);
  assert("…ONE line says so", sentTo(OWNER).length === 1 && bodyOf(last()) === `↩️ تم التراجع: أُلغيت الدفعة، وعادت الفاتورة ${b.name} مسودة في Odoo (لم يُحذف شيء). صحّحها ورحّلها من Odoo، أو اكتب «مصروف» لتسجيلها من جديد.`, bodyOf(last()));
  graph.length = 0; odooLog.length = 0;
  await say(env, OWNER, button(id));
  assert("a second tap: one line, and nothing is written", sentTo(OWNER).length === 1 && bodyOf(last()) === EX.expenseUndoDoneText(b.name) && bookWrites().length === 0 && b.state === "draft");
  clean();
}
{
  const env = world(`${TODAY} 14:00`);
  await send(env);
  const b = bills()[0], id = buttonsOf(last())[0].id;
  const at = ms(`${TODAY} 14:00`);
  graph.length = 0; odooLog.length = 0;
  const late = await quiet(() => EX.handleExpenseUndo(env, id, undefined, at + 24 * 3600_000 + 1000));
  assert("a tap after 24 hours: one line, nothing is written, the entry stands", late === "expired" && bodyOf(last()) === EX.EXPENSE_UNDO_EXPIRED_TEXT && bookWrites().length === 0 && b.state === "posted" && payments()[0].state === "paid" && EX.EXPENSE_UNDO_SECONDS === 86400);
  const edge = await quiet(() => EX.handleExpenseUndo(env, id, undefined, at + 24 * 3600_000));
  assert("…at 24 hours to the second it is still good", edge === "undone" && b.state === "draft");
  graph.length = 0; odooLog.length = 0;
  const none = await quiet(() => EX.handleExpenseUndo(env, "exp_undo_424242"));
  assert("a bill this worker did not record (or a button of long ago): one line, nothing written", none === "unknown" && bodyOf(last()) === EX.EXPENSE_UNDO_UNKNOWN_TEXT && bookWrites().length === 0);
}
{
  const env = world();
  await send(env);
  const b = bills()[0], p = payments()[0], id = buttonsOf(last())[0].id;
  quirk.payCancelRefused = "الدفعة مطابقة لكشف البنك"; graph.length = 0;
  const failed = await quiet(() => EX.handleExpenseUndo(env, id));
  assert("Odoo refuses to cancel the payment: the bill stays posted (never a draft under a live payment), and he is told", failed === "failed" && p.state === "paid" && b.state === "posted" && /^⚠️ لم يكتمل التراجع عن EXP\/2026\/10\/0001: الدفعة \d+ لم تُلغَ/.test(bodyOf(last())), bodyOf(last()));
  delete quirk.payCancelRefused;
  const again = await quiet(() => EX.handleExpenseUndo(env, id));
  assert("…the tap is not spent: once Odoo lets it, the same button undoes it", again === "undone" && p.state === "canceled" && b.state === "draft");
  // the undo of the entry itself
  const env2 = world();
  await send(env2);
  const b2 = bills()[0], p2 = payments()[0];
  odooLog.length = 0;
  const u1 = await quiet(() => XA.undoExpenseEntry(env2, { moveId: b2.id, paymentId: p2.id }));
  const w1 = bookWrites().length;
  const u2 = await quiet(() => XA.undoExpenseEntry(env2, { moveId: b2.id, paymentId: p2.id }));
  assert("undoExpenseEntry reads each step back, and what is already undone is left as it is (a second run writes nothing)", u1.ok && u1.paymentState === "canceled" && u1.billState === "draft" && w1 === 3 && u2.ok && bookWrites().length === 3);
  clean();
}

// ================================================================ و12
console.log("\n[و12] the tokens: read from the number it was sent to — Baraa's — once");
{
  const env = world();
  const token = await form(env);
  assert("the token is ex1.<day>.<random>, kept with his number, the day and the ways of paying it offered", /^ex1\.20261005\.[0-9a-f]{18}$/.test(token) && EX.isExpenseToken(token) && !EX.isExpenseToken("cu1.20261005.603.aa") && !EX.isExpenseToken("")
    && (() => { const t = JSON.parse(env.MSG_DEDUP.store.get(EX.expenseTokenKey(token))); return t.to === OWNER && t.day === TODAY && JSON.stringify(t.pay) === JSON.stringify(["cash", "bank", "owner"]); })());
  graph.length = 0; odooLog.length = 0;
  const other = await reply(env, DRIVER_PHONE, token, GOOD);
  assert("the same token from ANOTHER number: nothing read, nothing written, and nothing sent to anyone", other.action === "unknown" && bills().length === 0 && bookWrites().length === 0 && graph.length === 0);
  const made = await reply(env, OWNER, "ex1.20261005.000000000000000000", GOOD);
  assert("a token the worker never issued: nothing written, one line", made.action === "unknown" && bills().length === 0 && bodyOf(last()) === EX.EXPENSE_UNKNOWN_TEXT);
  // the owner's number changed since the form was sent
  const moved = { ...env, OWNER_WHATSAPP: "+" + DRIVER_PHONE };
  graph.length = 0;
  const old = await reply(moved, OWNER, token, GOOD), fresh2 = await reply(moved, DRIVER_PHONE, token, GOOD);
  assert("a token is its number's: after the owner's number changes, neither the old number nor the new one records from it", old.action === "unknown" && fresh2.action === "unknown" && bills().length === 0 && sentTo(OWNER).length === 0);
  const ok = await reply(env, OWNER, token, GOOD);
  graph.length = 0;
  const twice = await reply(env, OWNER, token, { ...GOOD, amt: "999" });
  assert("a second use of the token: not recorded again — one bill, of 115 — one line", ok.action === "recorded" && twice.action === "duplicate" && bills().length === 1 && bills()[0].amount_total === 115 && payments().length === 1 && bodyOf(last()) === EX.EXPENSE_USED_TEXT && graph.length === 1);
  // through the webhook, by the token's prefix
  const env2 = world();
  await say(env2, OWNER, text("مصروف"));
  const t2 = tokenOf(flowsTo(OWNER)[0]);
  const res = await say(env2, OWNER, nfm(t2, { ...GOOD, note: "من الويب هوك" }));
  assert("the Flow's reply through the webhook is routed by its «ex1.» token: the bill and its payment are made, and no price row is written from it", res.status === 200 && bills().length === 1 && payments().length === 1 && bills()[0].ref.startsWith("من الويب هوك — EX-") && rows("x_daily_price").length === 0 && rows("x_price_offer").length === 0);
  const res2 = await say(env2, DRIVER_PHONE, nfm(t2, GOOD));
  assert("…and the same reply from another number through the webhook writes nothing", res2.status === 200 && bills().length === 1 && flowsTo(DRIVER_PHONE).length === 0);
  assert("every message of this part went to Baraa under expense_form", JSON.stringify(purposes()) === JSON.stringify(["expense_form", "expense_form"]) && sentTo(OWNER).length === 2, JSON.stringify(purposes()));
  clean();
}

// ================================================================ و13
console.log("\n[و13] the trial to Baraa, its hook, and the purposes");
{
  const env = world(`${TODAY} 16:00`, { sync: false });
  closeOwnerWindow(env);
  seed("x_wa_message", { x_direction: "inbound", x_partner_id: 3, x_processed_at: "2026-10-03 22:00:00", x_status: "received" });
  const shut = await quiet(() => EX.sendExpenseFormTest(env));
  assert("Baraa's window closed: the trial does not go, nothing is held, and the day is not spent", shut.sent === false && shut.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(shut));
  openWindow(env, OWNER);
  odooLog.length = 0;
  const t = await quiet(() => EX.sendExpenseFormTest(env));
  const f = flowsTo(OWNER)[0], d = dataOf(f);
  assert("the trial: ONE message, to Baraa's number alone, marked «🧪 تجربة» — whatever ACCOUNTING_SYNC says (it writes nothing)", t.sent === true && graph.length === 1 && graph[0].to === OWNER && bodyOf(f).startsWith(`🧪 تجربة — 🧾 تسجيل مصروف — ${LABEL}`) && d.t === `🧪 تجربة — تسجيل مصروف — ${LABEL}` && d.pay.length === 3, bodyOf(f));
  assert("…sent under expense_form_test, and read-only", JSON.stringify(purposes()) === JSON.stringify(["expense_form_test"]) && bookWrites().length === 0, JSON.stringify(purposes()));
  const again = await quiet(() => EX.sendExpenseFormTest(env));
  assert("a second trial the same day is refused", again.sent === false && again.reason === "already_today" && graph.length === 1);
  odooLog.length = 0;
  const r = await reply(env, OWNER, tokenOf(f), { ...GOOD, type: "car_maintenance", tax: "yes", vat: VAT, sup: "ورشة النور", pay: "owner", photo: PHOTO, note: "زيت وفلتر" });
  assert("his «إرسال» is answered with what WOULD have been recorded — the account, the split, the journal, the supplier — marked as a trial", r.action === "test" && bodyOf(last()) === [
    "🧪 تجربة — كان سيُسجَّل: صيانة السيارة", "الحساب: 400042 Maintenance", "المورد: ورشة النور (مورد جديد: كان سيُنشأ)", "الصافي 100 ر.س + ضريبة المدخلات 15 ر.س = الإجمالي 115 ر.س", "الدفع: من جيب براء", `التاريخ: ${LABEL}`, "ملاحظة: زيت وفلتر",
    "📎 مع النموذج صورة: كانت ستُرفق بالفاتورة.", "(تجربة: لم يُكتب شيء في Odoo — لا فاتورة ولا دفعة ولا مورد)",
  ].join("\n"), bodyOf(last()));
  assert("…and writes NOTHING: no bill, no payment, no supplier, no attachment, nothing downloaded, no undo — and no one else is reached", bookWrites().length === 0 && bills().length === 0 && payments().length === 0 && rows("ir.attachment").length === 0 && mediaCalls.length === 0
    && !rows("res.partner").some((p: any) => p.name === "ورشة النور") && ![...env.MSG_DEDUP.store.keys()].some((k: string) => k.startsWith("expense_undo:")) && graph.every((b: any) => b.to === OWNER) && buttonsOf(last()).length === 0);
  const twice = await reply(env, OWNER, tokenOf(f), GOOD);
  assert("the trial's token is read once too, and every message of the trial went under expense_form_test", twice.action === "duplicate" && purposes().length === 3 && purposes().every((x) => x === "expense_form_test"), JSON.stringify(purposes()));
  // a trial reply that is refused, one with a wrong number, one Odoo could not record
  setRiyadh(`${TOMORROW} 16:00`); openWindow(env, OWNER); quirk.today = TOMORROW;
  const day2 = await quiet(() => EX.sendExpenseFormTest(env));
  const t2 = tokenOf(flowsTo(OWNER).at(-1));
  graph.length = 0;
  const bad = await reply(env, OWNER, t2, { ...GOOD, date: TOMORROW, amt: "0" });
  const f2 = flowsTo(OWNER).at(-1);
  assert("a trial reply with a bad field: refused with a fresh TRIAL form, still marked", bad.action === "invalid" && graph.length === 1 && bodyOf(f2).startsWith("🧪 تجربة — ⚠️ لم يُسجَّل شيء من النموذج:") && String(dataOf(f2).t).startsWith("🧪 تجربة — "), JSON.stringify({ day2, bad, n: graph.length, body: graph.map(bodyOf) }));
  graph.length = 0;
  table("account.account").delete(211);
  const blocked = await reply(env, OWNER, tokenOf(f2), { ...GOOD, date: TOMORROW, tax: "yes", vat: "77", photo: PHOTO, sup: "مصروفات نقدية متنوعة" });
  assert("a trial whose account is not in Odoo says where the real one would have stopped", blocked.action === "test" && bodyOf(last()) === "🧪 تجربة — ⚠️ كان سيتوقف قبل أي كتابة:\n• الحساب 400077 («وقود») غير موجود في دليل الحسابات" && bills().length === 0);
  assert("the trial's words for a wrong number and a known supplier", EX.badVatText("77", true) === "⚠️ الرقم الضريبي «77» غير صحيح (15 رقماً يبدأ بـ 3 وينتهي بـ 3): كان سيُسجَّل بلا ضريبة مدخلات."
    && EX.expenseTestText({ ...({} as any), supplier: "x", date: TODAY, note: "" }, { type: { title: "وقود" }, account: { code: "400077", name: "Fuel" }, pay: { title: "البنك (BNK1)" }, tax: null, net: 50, vat: 0, total: 50, supplier: { id: 55, name: "مصروفات نقدية متنوعة" } } as any, { badVat: "77", photo: false })
      === ["🧪 تجربة — كان سيُسجَّل: وقود", "الحساب: 400077 Fuel", "المورد: مصروفات نقدية متنوعة (موجود في Odoo)", "الإجمالي 50 ر.س — بلا ضريبة مدخلات", "الدفع: البنك (BNK1)", `التاريخ: ${LABEL}`, "بلا صورة.", EX.badVatText("77", true), "(تجربة: لم يُكتب شيء في Odoo — لا فاتورة ولا دفعة ولا مورد)"].join("\n"));
  // the hook
  const hookEnv = { ...env, HOOK_SECRET: "HOOK-0123456789abcdef0123456789abcdef" };
  const post = (q: string, e: any = hookEnv) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/expense-form-test${q}`, { method: "POST" }), e, ctx));
  const no = await post("?token=nope"), none = await post(""), unset = await post("?token=", env);
  assert("POST /odoo/hook/expense-form-test without the hook's token: 401, nothing sent", no.status === 401 && none.status === 401 && unset.status === 401);
  const yes = await post("?token=HOOK-0123456789abcdef0123456789abcdef");
  const body = await yes.json() as any;
  assert("…with it: the worker's own answer (today's trial already went)", yes.status === 200 && body.ok === true && body.sent === false && body.reason === "already_today", JSON.stringify(body));
  setRiyadh("2026-10-07 16:00"); openWindow(env, OWNER);
  const n = flowsTo(OWNER).length;
  const next = await (await post("?token=HOOK-0123456789abcdef0123456789abcdef")).json() as any;
  assert("…and the next day it sends one", next.ok === true && next.sent === true && flowsTo(OWNER).length === n + 1, JSON.stringify(next));
  clean();
}
{
  const env = world();
  assert("expense_form is a reply to his own tap (never important, never critical); expense_form_test is the trial", PURPOSES.expense_form?.kind === "reply" && !PURPOSES.expense_form.important && !PURPOSES.expense_form.critical && PURPOSES.expense_form_test?.kind === "operational"
    && EX.EXPENSE_PURPOSE === "expense_form" && EX.EXPENSE_TEST_PURPOSE === "expense_form_test");
  const x = { kind: "session" as const, body: { type: "text", text: { body: "x" } } };
  const out = [] as any[];
  for (const purpose of ["expense_form", "expense_form_test"]) {
    out.push(gatewayDecision(await quiet(() => sendViaGateway(env, { purpose, to: "+" + DRIVER_PHONE, content: x })))?.action);
    out.push(gatewayDecision(await quiet(() => sendViaGateway(env, { purpose, to: "+" + OWNER, content: x })))?.action);
  }
  assert("the gateway lets both purposes through to Baraa's number, and refuses both to any other", JSON.stringify(out) === JSON.stringify(["refused", "session", "refused", "session"]) && graph.length === 2 && graph.every((b: any) => b.to === OWNER), JSON.stringify(out));
  assert("the Flow's id at Meta is one constant, filled in when the Flow is created there", typeof EX.EXPENSE_FLOW_ID === "string" && /^\d+$/.test(EX.EXPENSE_FLOW_ID) && (srcOf("expense-form.ts").match(/EXPENSE_FLOW_ID = "/g) ?? []).length === 1);
  assert("…it is utak_expense_v2's (§ 58 أ 4), not the one of v1 with «رواتب وأجور» — and docs/ODOO-IDS.md names both", EX.EXPENSE_FLOW_ID === "2207848546771736" && EX.EXPENSE_FLOW_ID !== "1084220070882916"
    && doc("ODOO-IDS.md").includes("`utak_expense_v2` #2207848546771736 (`EXPENSE_FLOW_ID`") && doc("ODOO-IDS.md").includes("`utak_expense_v1` #1084220070882916"));
}

// ================================================================ و14
console.log("\n[و14] the guide, the table of accounts, and the pointer in the expenses' guide");
{
  const day = doc("OPERATING-DAY.md");
  const at = day.indexOf("## تسجيل مصروف من واتساب (§ 57)"), next = day.indexOf("## سعر الشراء خام، والسعر المربح المقترح (§ 47)");
  const sec = day.slice(at, next);
  assert("docs/OPERATING-DAY.md has «تسجيل مصروف من واتساب (§ 57)», immediately before the section of § 47", at > 0 && next > at && !sec.slice(3).includes("\n## "));
  assert("…it says who, how to open it, the eight types, the three ways of paying, the tax rule, the photo, the undo and the trial", ["لبراء وحده", "«مصروف»", "«🧾 تسجيل مصروف»", "«تم الاطلاع»", "كاش السائق (CSHD)", "البنك (BNK1)", "من جيب براء", "15 رقماً", "بلا ضريبة مدخلات", "«↩️ تراجع»", "24 ساعة", "🧪 تجربة", "EXP", "لا يُحذف"]
    .every((w) => sec.includes(w)) && XA.EXPENSE_TYPES.every((t: any) => sec.includes(t.title)), ["لبراء وحده", "«مصروف»", "«🧾 تسجيل مصروف»", "«تم الاطلاع»", "كاش السائق (CSHD)", "البنك (BNK1)", "من جيب براء", "15 رقماً", "بلا ضريبة مدخلات", "«↩️ تراجع»", "24 ساعة", "🧪 تجربة", "EXP", "لا يُحذف"].filter((w) => !sec.includes(w)).join(","));
  const ids = doc("ODOO-IDS.md");
  assert("docs/ODOO-IDS.md names the journals of the entry and the tax: EXP #20, BRA #21 with its outbound payment method (#8) and the account it posts to since § 58 (201021; 205001 untouched), tax #43", /EXP[^\n]*#20/.test(ids) && /BRA[^\n]*#21[^\n]*#8[^\n]*201021[^\n]*205001/.test(ids) && /«15% شامل \(مشتريات\)»[^\n]*#43/.test(ids));
  assert("…the account is the one scripts/s58-20261005-odoo.mjs writes on that line, on the journal the worker reads", OD58.POCKET_ACCOUNT_CODE === "201021" && OD58.POCKET_UNTOUCHED_CODE === "205001" && OD58.POCKET_JOURNAL_CODE === XA.POCKET_JOURNAL_CODE && OD58.POCKET_JOURNAL_ID === 21);
  assert("both documents say «من جيب براء» is OFFERED since § 58 — BRA's outbound payment method posts to 201021 — and that it hides itself again without that account; neither says it is hidden today", [sec, ids.slice(ids.indexOf("## حسابات نموذج «تسجيل مصروف»"))].every((t) => t.includes("طريقة الدفع الصادرة") && t.includes("201021") && t.includes("معروض") && t.includes("§ 58") && !t.includes("مخفي")));
  assert("the guide says «رواتب وأجور» left the list and why, and the table of accounts has no row for it", sec.includes("«رواتب وأجور»") && sec.includes("بقيدها الشهري") && !/\| رواتب وأجور \(`salaries`\)/.test(ids) && !/نوع المصروف \|[^\n]*رواتب وأجور/.test(sec));
  const exp = doc("EXPENSES.md");
  assert("docs/EXPENSES.md § 1 points to the form", exp.slice(exp.indexOf("## 1)"), exp.indexOf("## 2)")).includes("«مصروف»") && exp.includes("OPERATING-DAY.md"));
}

clean();
done();
