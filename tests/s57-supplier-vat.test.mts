// § 57 ز (2026-10-05) — the supplier's tax number read from the pictures of his invoices, and his
// registration form.
//
//   [ز1]  utak_supplier_register_v1: the JSON at Meta against what the worker sends — the keys, the
//         components, Meta's limit on every text
//   [ز2]  the rule: a tax number, a commercial registration, an IBAN, a name against a name
//   [ز3]  Claude's reading: the prompt, ONE call, what its answer is decided as
//   [ز4]  a picture a supplier sends: written / silence / never replaced / not an invoice / read once
//   [ز5]  no number and none read: the form, once ever — owed while his window is closed
//   [ز6]  the purchase list's invoice: whose it is — by the name read, never «مشتريات السوق النقدية»
//   [ز7]  an expense's attachment: the bill's partner, and never a form
//   [ز8]  who is out: رائد, the team, Baraa's own number, the bucket — no Claude call at all
//   [ز9]  the form's «إرسال»: what refuses it, what it writes, the IBAN, the certificate, the token
//   [ز10] the trial to Baraa, its hook, the purposes
//   [ز11] no price anywhere, no Odoo field outside the schema
//   [ز12] the guide
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s57-supplier-vat.test.mts

import { readFileSync } from "node:fs";
import { COLL, OWNER, WH, closeOwnerWindow, ctx, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, C1, DAY, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, done, fresh, ownerTexts, rejected, setExtract } from "./s46-kit.mts";

// ---------------------------------------------------------------- Meta's media, Claude, Odoo
const MEDIA_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 7, 5, 7, 5, 7]);
const B64 = Buffer.from(MEDIA_BYTES).toString("base64");
const FILE = { base64: B64, mime: "image/jpeg" };
/** Every media id asked of Meta (the inbox's own mirror of an inbound picture asks too). */
const mediaCalls: string[] = [];
const claudeCalls: any[] = [];
let claude: "ok" | "down" | "garbage" = "ok";
let mediaDown = false, metaRefusesFlow = false;
/** "model.method" whose calls fail (Odoo down for it). */
let odooDown = "";
let sendSeq = 0;
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const mm = /graph\.facebook\.com\/[^/]+\/(SVAT_[A-Z0-9_]+)$/.exec(url);
  if (mm) {
    mediaCalls.push(mm[1]);
    if (mediaDown || mm[1].startsWith("SVAT_BAD")) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    const mime = mm[1].startsWith("SVAT_PDF") ? "application/pdf" : mm[1].startsWith("SVAT_XLS") ? "application/vnd.ms-excel" : "image/jpeg";
    return new Response(JSON.stringify({ url: `https://media.test/${mm[1]}`, mime_type: mime, file_size: MEDIA_BYTES.length }), { status: 200 });
  }
  if (url.startsWith("https://media.test/SVAT_")) return new Response(MEDIA_BYTES, { status: 200 });
  if (url.includes("graph.facebook.com") && init?.body) {
    const b = JSON.parse(init.body);
    if (metaRefusesFlow && b?.interactive?.type === "flow") return new Response(JSON.stringify({ error: { message: "(#131009) Parameter value is not valid", code: 131009 } }), { status: 400 });
    // a message id of its own for every send, as Meta gives
    const res = await kitFetch(input as any, init);
    return res.ok ? new Response(JSON.stringify({ messages: [{ id: `wamid.V${++sendSeq}` }] }), { status: 200 }) : res;
  }
  if (url.includes("anthropic.com")) {
    claudeCalls.push(JSON.parse(init.body));
    if (claude === "down") return new Response("overloaded", { status: 529 });
    if (claude === "garbage") return new Response(JSON.stringify({ content: [{ type: "text", text: "لا أستطيع قراءة هذه الصورة" }] }), { status: 200 });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && odooDown && `${m[1]}.${m[2]}` === odooDown) return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "boom" }), { status: 500 });
  return kitFetch(input as any, init);
}) as typeof fetch;

const SV = await import("../src/supplier-vat.ts");
const EX = await import("../src/expense-form.ts");
const RC = await import("../src/receipt-form.ts");
const PI = await import("../src/purchase-invoice.ts");
const PA = await import("../src/purchase-accounting.ts");
const BANK = await import("../src/bank-line.ts");
const CLAUDE = await import("../src/claude.ts");
const CONFIG = await import("../src/config.ts");
const { SUPPLIER_ACK_TEXT } = await import("../src/suppliers.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const worker = (await import("../src/index.ts")).default;
// @ts-ignore — plain .mjs helpers
const LIB = await import("../scripts/lib/s57-supplier-flow.mjs");

const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const count = (s: string) => [...String(s)].length;
const VAT_A = "310123456700003", VAT_B = "300987654300003", VAT_C = "399999999999993", OWN_VAT = "315022736600003";
/** The example IBAN of the Saudi standard: valid by mod 97. */
const IBAN_OK = "SA0380000000608010167519", IBAN_BAD = "SA0380000000608010167518";
const CR = "1010123456";
const RAED = 809, RAED_PHONE = "966500000809", CASH = 104, FAJR = 806, NAKHEEL = 807, NAKHEEL_PHONE = "966500000807", BARAA_CARD = 707;
const OMAR = DRIVER, OMAR_PHONE = DRIVER_PHONE;
const AHMED_NAME = "أحمد حسان", NAKHEEL_NAME = "مؤسسة النخيل للخضار", MKT = "مشتريات السوق النقدية";
const LABEL = "3 أكتوبر 2026";

/** The tenant's shape (tests/s46-kit.mts: Omar an employee, Ahmed a supplier with no tax number), and the cards of § 57 ز. */
function world(riyadh = `${DAY} 03:00`): any {
  const env = fresh(riyadh); setExtract(null);
  claudeCalls.length = 0; mediaCalls.length = 0; claude = "ok"; mediaDown = false; metaRefusesFlow = false; odooDown = "";
  seed("res.partner", { id: RAED, name: "رائد", x_price_source: true, x_price_role: "market", supplier_rank: 0, x_whatsapp_number: "+" + RAED_PHONE });
  seed("res.partner", { id: CASH, name: MKT, ref: "UTAK-CASH-MARKET", supplier_rank: 1 });
  seed("res.partner", { id: FAJR, name: "فجر بزنسس", supplier_rank: 1 });
  seed("res.partner", { id: NAKHEEL, name: NAKHEEL_NAME, supplier_rank: 1, x_whatsapp_number: "+" + NAKHEEL_PHONE });
  seed("res.partner", { id: BARAA_CARD, name: "براء - اختبار", supplier_rank: 1, x_whatsapp_number: "+" + OWNER });
  seed("res.company", { id: 1, name: "شركة يوتاك", vat: OWN_VAT });
  return env;
}
const card = (id: number) => table("res.partner").get(id) as any;
/** What Claude answers for the next picture. */
const INVOICE = (over: Record<string, unknown> = {}) => ({ is_invoice: true, vat: VAT_A, supplier_name: "مؤسسة أحمد حسان للخضار والفواكه", invoice_number: "INV-2045", ...over });
const UNREAD = { is_invoice: true, vat: null, supplier_name: null, invoice_number: null };
const NOT_INVOICE = { is_invoice: false, vat: null, supplier_name: null, invoice_number: null };
/** The Claude calls of § 57 ز alone (a supplier's text is read by the price extractor too). */
const vatCalls = () => claudeCalls.filter((c) => c.system === CONFIG.SYSTEM_PROMPT_READ_SUPPLIER_INVOICE);
/** The writes on a partner's card, the gateway's own record of a send apart (§ 36: the number's conversation). */
const cardWrites = () => odooLog.filter((c: any) => c.model === "res.partner" && c.method === "write" && Object.keys(c.body?.vals ?? {}).join() !== "x_wa_channel_id").map((c: any) => ({ ids: c.body.ids, vals: c.body.vals }));
/** Baraa's lines about a tax number. */
const vatLines = () => ownerTexts().filter((t: string) => /ضريبي/.test(t));
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const tokenOf = (b: any): string => par(b).flow_token ?? "";
const textsTo = (d: string) => sentTo(d).filter((b: any) => b?.type === "text").map(bodyOf);
const purposeOf = (r: any): string => { try { return JSON.parse(String(r.x_debug_payload ?? "{}")).purpose ?? ""; } catch { return ""; } };
const owed = (env: any, digits: string): any => JSON.parse(env.MSG_DEDUP.store.get(SV.supplierOwedKey(digits)) ?? "null");
const settle = () => new Promise((r) => setTimeout(r, 20));
function collectingCtx(): any { const tasks: Promise<unknown>[] = []; return { tasks, waitUntil: (p: Promise<unknown>) => { tasks.push(p); }, passThroughOnException: () => {} }; }
/** An inbound message through the webhook, every background task awaited. */
async function hook(env: any, from: string, m: Record<string, unknown>): Promise<void> {
  const c = collectingCtx();
  await quiet(async () => { await worker.fetch(signed(inbound(from, m)), env, c); await Promise.all(c.tasks); });
  await settle();
}
const text = (t: string) => ({ type: "text", text: { body: t } });
const image = (id: string) => ({ type: "image", image: { id, mime_type: "image/jpeg" } });
const pdf = (id: string) => ({ type: "document", document: { id, mime_type: "application/pdf", filename: "invoice.pdf" } });
const sheet = (id: string) => ({ type: "document", document: { id, mime_type: "application/vnd.ms-excel", filename: "prices.xls" } });
const audio = (id: string) => ({ type: "audio", audio: { id, mime_type: "audio/ogg" } });
const nfm = (token: string, values: Record<string, unknown>) => ({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...values, flow_token: token }) } } });
const photo = (id: string) => [{ id, mime_type: "image/jpeg", file_name: "certificate.jpg", sha256: "x" }];
/** A picture in the supplier's own chat, without the webhook around it. */
const sent = (env: any, partnerId: number, phone: string, id: string) => quiet(() => SV.supplierSentPicture(env, { id: partnerId }, "+" + phone, { id }));
/** A purchase list: its own supplier, and the supplier of each line. */
function list(o: { supplier?: number; lines?: number[]; sim?: boolean } = {}): number {
  const items = (o.lines ?? [AHMED]).map((s, i) => ({ product_id: i + 1, product_name: "صنف", packaging_id: 11, packaging_name: "كرتون", total_quantity: 2, order_ids: [], unit_price: 77.77, price_supplier_id: s }));
  return seed("x_purchase_list", { x_date: DAY, x_status: "done", x_supplier_id: o.supplier ?? AHMED, x_aggregated_items: JSON.stringify(items), x_utak_simulation: o.sim ?? false });
}
const onList = (env: any, listId: number, id: string) => quiet(() => SV.readListInvoice(env, listId, { id }, FILE));
const expense = (env: any, partnerId: number, id: string, moveId = 5501) => quiet(() => EX.expensePhotoPosted(env, { partnerId, moveId, mediaId: id, mime: "image/jpeg" }));
const ahmedWho = { partnerId: AHMED, name: AHMED_NAME, whatsapp: "+" + AHMED_PHONE };
let wamid = 0;
const reply = (env: any, from: string, token: string, values: Record<string, unknown>) =>
  quiet(() => SV.handleSupplierRegisterReply(env, { from: "+" + from, messageId: `wamid.SR${++wamid}`, flow: { token, values } }));
const GOOD = { legal: "مؤسسة أحمد حسان للخضار والفواكه", cr: CR, vat: VAT_A, photo: photo("SVAT_CERT1"), iban: "" };
/** The form sent to Ahmed inside his window: its token. */
async function formTo(env: any): Promise<string> {
  openWindow(env, AHMED_PHONE);
  const n = flowsTo(AHMED_PHONE).length;
  await quiet(() => SV.sendSupplierRegisterForm(env, ahmedWho, { init: { legal: AHMED_NAME } }));
  return tokenOf(flowsTo(AHMED_PHONE)[n]);
}

// ================================================================ ز1
console.log("\n[ز1] utak_supplier_register_v1 at Meta is the form the worker fills: one screen, no endpoint");
{
  const json = LIB.buildSupplierFlowJson();
  const s = json.screens[0], c = s.layout.children, L = LIB.SUPPLIER_LIMITS;
  assert("ONE screen, SUPPLIER_REGISTER — the one the worker opens — terminal; Flow JSON 6.0; exported as FLOW for the Meta script", json.screens.length === 1 && s.id === "SUPPLIER_REGISTER" && LIB.SUPPLIER_SCREEN === SV.SUPPLIER_REGISTER_FLOW_SCREEN && s.terminal === true && s.success === true && json.version === "6.0"
    && LIB.FLOW.key === "supplier" && LIB.FLOW.name === "utak_supplier_register_v1" && LIB.FLOW.build === LIB.buildSupplierFlowJson && LIB.FLOW.first === "SUPPLIER_REGISTER");
  assert("no endpoint and no Form wrapper: no data_api_version, no data_exchange, no «Form» component", !("data_api_version" in json) && !JSON.stringify(json).includes("data_exchange") && LIB.screenComponents(s).every((x: any) => x.type !== "Form") && s.layout.type === "SingleColumnLayout");
  assert("eight components (Meta allows fifty): the heading, the line, the name, the CR, the tax number, the photo, the IBAN, «إرسال»", LIB.screenComponents(s).length === 8 && 8 <= LIB.SCREEN_COMPONENTS_MAX
    && JSON.stringify(c.map((x: any) => x.type)) === JSON.stringify(["TextHeading", "TextBody", "TextInput", "TextInput", "TextInput", "PhotoPicker", "TextInput", "Footer"]));
  assert("the heading and the line come with the message", c[0].text === "${data.t}" && c[1].text === "${data.how}");
  assert("«الاسم الرسمي»: legal, text, REQUIRED, opened from the data", c[2].name === "legal" && c[2].label === "الاسم الرسمي" && c[2]["input-type"] === "text" && c[2].required === true && c[2]["init-value"] === "${data.i_legal}");
  assert("«السجل التجاري»: cr, a number, REQUIRED", c[3].name === "cr" && c[3].label === "السجل التجاري" && c[3]["input-type"] === "number" && c[3].required === true && c[3]["init-value"] === "${data.i_cr}");
  assert("«الرقم الضريبي»: vat, a number, REQUIRED", c[4].name === "vat" && c[4].label === "الرقم الضريبي" && c[4]["input-type"] === "number" && c[4].required === true && c[4]["init-value"] === "${data.i_vat}");
  assert("«صورة شهادة الضريبة»: ONE PhotoPicker, exactly one photo — required by the Flow itself (min-uploaded-photos 1; a PhotoPicker takes no `required`), never pre-filled", c[5].name === "photo" && c[5].label === "صورة شهادة الضريبة"
    && c[5]["min-uploaded-photos"] === 1 && c[5]["max-uploaded-photos"] === 1 && c[5]["max-file-size-kb"] === 10240 && !("required" in c[5]) && !("init-value" in c[5]) && c.filter((x: any) => x.type === "PhotoPicker").length === 1);
  assert("«الآيبان (اختياري)»: iban, text, NOT required", c[6].name === "iban" && c[6].label === "الآيبان (اختياري)" && c[6]["input-type"] === "text" && c[6].required === false && c[6]["init-value"] === "${data.i_iban}");
  assert("«إرسال» completes with every field — the photo a top-level property of the payload", c[7].label === "إرسال" && c[7]["on-click-action"].name === "complete"
    && JSON.stringify(c[7]["on-click-action"].payload) === JSON.stringify({ legal: "${form.legal}", cr: "${form.cr}", vat: "${form.vat}", photo: "${form.photo}", iban: "${form.iban}" }));
  assert("Meta's limits: the screen's title 30, every label 20, every hint 80, the photo's label 80 and description 300, the footer 35, the button 20", count(s.title) <= L.screenTitle
    && [c[2], c[3], c[4], c[6]].every((x: any) => count(x.label) <= L.inputLabel && count(x["helper-text"]) <= L.inputHint && count(x["helper-text"]) > 0)
    && count(c[5].label) <= L.photoLabel && count(c[5].description) <= L.photoDescription && count(c[7].label) <= L.footer && count(LIB.SUPPLIER_CTA) <= L.cta);
  const data = SV.supplierFormData({ name: AHMED_NAME }, { init: { legal: AHMED_NAME } });
  assert("the data the worker sends is the screen's data model, key for key, each with Meta's example", JSON.stringify(Object.keys(data).sort()) === JSON.stringify(Object.keys(s.data).sort()) && Object.values(s.data).every((d: any) => d.type === "string" && "__example__" in d)
    && Object.values(data).every((v) => typeof v === "string"));
  assert("the worker's constants are the Flow's: the screen, the button", SV.SUPPLIER_REGISTER_CTA === LIB.SUPPLIER_CTA && SV.SUPPLIER_REGISTER_FLOW_SCREEN === LIB.SUPPLIER_SCREEN && typeof SV.SUPPLIER_REGISTER_FLOW_ID === "string");
  const long = SV.supplierFormData({ name: "مؤسسة ".repeat(40) }, { test: true });
  assert("the heading within Meta's 80 characters whatever the supplier's name, the line within a text's 4096", count(long.t) === 80 && long.t.startsWith("🧪 تجربة — تسجيل بيانات المورد — ") && count(data.t) <= 80 && data.t === `تسجيل بيانات المورد — ${AHMED_NAME}` && count(data.how) <= L.body);
  const session = SV.supplierFormSession("س".repeat(2000), "sr1.1.ab", data).body as any;
  assert("the message: its text within 1024, flow_action navigate to the screen with the data", count(session.interactive.body.text) === 1024 && session.interactive.action.parameters.flow_action === "navigate"
    && session.interactive.action.parameters.flow_action_payload.screen === "SUPPLIER_REGISTER" && session.interactive.action.parameters.flow_cta === "سجّل بياناتك" && count(SV.SUPPLIER_REGISTER_ASK_TEXT) <= 1024);
}

// ================================================================ ز2
console.log("\n[ز2] the rule: 15 digits, the first and the last «3» — and the form's other fields");
{
  assert("a tax number: 15 digits, the first 3, the last 3", SV.validVat(VAT_A) === VAT_A && SV.validVat(310123456700003) === VAT_A);
  assert("Arabic-Indic digits, spaces and dashes are tolerated", SV.validVat("٣١٠١٢٣٤٥٦٧٠٠٠٠٣") === VAT_A && SV.validVat("3101 2345 6700 003") === VAT_A && SV.validVat("3101-2345-6700-003") === VAT_A && SV.validVat(" ۳۱۰۱۲۳۴۵۶۷۰۰۰۰۳ ") === VAT_A && SV.validVat("3101–2345–6700–003") === VAT_A);
  assert("14 or 16 digits, a first or a last digit that is not 3, a letter, nothing: not a number", [VAT_A.slice(0, 14), VAT_A + "3", "210123456700003", "310123456700004", "31012345670000A", "SA310123456700003", "", null, undefined, {}, [], [VAT_A]].every((v) => SV.validVat(v) === null));
  assert("a commercial registration: ten digits, nothing else", SV.parseCr(CR) === CR && SV.parseCr("١٠١٠١٢٣٤٥٦") === CR && SV.parseCr("1010 123456") === CR && SV.parseCr(1010123456) === CR
    && ["101012345", "10101234567", "10101234AB", "", null].every((v) => SV.parseCr(v) === null) && SV.SUPPLIER_CR_DIGITS === 10);
  assert("an IBAN by § 52's check (SA, 24 characters, mod 97): kept compact; empty is «none»; a wrong one is null", BANK.isSaudiIban(IBAN_OK) && !BANK.isSaudiIban(IBAN_BAD)
    && SV.parseSupplierIban(IBAN_OK) === IBAN_OK && SV.parseSupplierIban("sa03 8000 0000 6080 1016 7519") === IBAN_OK && SV.parseSupplierIban("") === "" && SV.parseSupplierIban(undefined) === ""
    && SV.parseSupplierIban(IBAN_BAD) === null && SV.parseSupplierIban("GB82WEST12345698765432") === null && SV.parseSupplierIban(IBAN_OK.slice(0, 23)) === null);
  assert("a name against a name: one holds the other, whatever the spelling of the same letters", SV.sameSupplierName("مؤسسة أحمد حسان للخضار والفواكه", AHMED_NAME) && SV.sameSupplierName(AHMED_NAME, "احمد حسّان") && SV.sameSupplierName("أحمـــد  حسان", AHMED_NAME) && SV.sameSupplierName("مؤسسة النخيل", NAKHEEL_NAME)
    && SV.sameSupplierName("Fajr Business Est.", "FAJR BUSINESS"));
  assert("…and another name is another supplier; a name of two letters, or none, matches nothing", !SV.sameSupplierName("مؤسسة الريف الأخضر", AHMED_NAME) && !SV.sameSupplierName("أح", AHMED_NAME) && !SV.sameSupplierName("", AHMED_NAME) && !SV.sameSupplierName(AHMED_NAME, "") && SV.SUPPLIER_NAME_MIN === 3);
}

// ================================================================ ز3
console.log("\n[ز3] Claude's reading: the SELLER's number, one call, never a guess");
{
  const P = CONFIG.SYSTEM_PROMPT_READ_SUPPLIER_INVOICE;
  assert("the prompt asks for the strict JSON { is_invoice, vat, supplier_name, invoice_number }", P.includes('{"is_invoice": <true|false>, "vat": "<digits>"|null, "supplier_name": "<string>"|null, "invoice_number": "<string>"|null}') && /Return ONLY a JSON object/.test(P));
  assert("…the SELLER's number, never the buyer's — UTAK's own may be printed as the customer's — and never a guess", /SELLER's VAT registration number/.test(P) && /NEVER the buyer's number/.test(P) && /UTAK \(يوتاك\) is the BUYER/.test(P) && /never compute, complete, correct or guess a digit/.test(P));
  assert("…and it is the last thing in src/config.ts (appended)", srcOf("config.ts").trimEnd().endsWith("When is_invoice is false the three other fields are null.`;"));
  const D = SV.decideReading;
  assert("an answer that is not the object asked for is «failed»: nothing, an object without is_invoice", D(null).status === "failed" && D({ intent: "other" }).status === "failed" && D({ is_invoice: "yes", vat: VAT_A }).status === "failed");
  assert("is_invoice false is «not an invoice», whatever else it says", D(NOT_INVOICE).status === "not_invoice" && D({ is_invoice: false, vat: VAT_A }).status === "not_invoice");
  assert("an invoice with a valid number is «valid»: the number, the name and the invoice's number, cleaned", JSON.stringify(D(INVOICE({ vat: "٣١٠١ ٢٣٤٥ ٦٧٠٠ ٠٠٣", supplier_name: "  مؤسسة  أحمد حسان ", invoice_number: 2045 }))) === JSON.stringify({ status: "valid", vat: VAT_A, name: "مؤسسة أحمد حسان", invoice: "2045" }));
  assert("an invoice whose number is not one is «invalid»: none read, 14 digits, a number that does not end with 3", [null, VAT_A.slice(0, 14), "310123456700004", "", 12].every((v) => D(INVOICE({ vat: v })).status === "invalid"));
  assert("UTAK's own number is the buyer's: never a supplier's, however Claude answered", D(INVOICE({ vat: OWN_VAT }), OWN_VAT).status === "invalid" && D(INVOICE({ vat: OWN_VAT }), "").status === "valid" && D(INVOICE(), OWN_VAT).status === "valid");

  const env = world(); setExtract(INVOICE());
  const r = await quiet(() => SV.readInvoiceVat(env, FILE, OWN_VAT));
  const call = claudeCalls[0], content = call?.messages?.[0]?.content ?? [];
  assert("ONE call: the picture as an image block, under the prompt, the buyer's number named in the question", r.status === "valid" && claudeCalls.length === 1 && call.system === P && content[0].type === "image" && content[0].source.media_type === "image/jpeg" && content[0].source.data === B64
    && content[1].type === "text" && content[1].text.includes(`UTAK's own VAT number is ${OWN_VAT}`) && call.model === env.CLAUDE_MODEL_REPLY);
  await quiet(() => SV.readInvoiceVat(env, { base64: B64, mime: "application/pdf" }));
  assert("a PDF goes as a document block; with no own number known, none is named", claudeCalls[1].messages[0].content[0].type === "document" && !claudeCalls[1].messages[0].content[1].text.includes("UTAK's own"));
  claude = "down";
  const down = await quiet(() => SV.readInvoiceVat(env, FILE, OWN_VAT));
  claude = "garbage";
  const garbage = await quiet(() => SV.readInvoiceVat(env, FILE, OWN_VAT));
  assert("Claude unreachable, or an answer that is not JSON: «failed», never a throw", down.status === "failed" && garbage.status === "failed");
  assert("what is a picture: an image or a PDF — a voice note or a sheet is not one", CLAUDE.canReadDocument("image/jpeg") && CLAUDE.canReadDocument("IMAGE/PNG; x=1") && CLAUDE.canReadDocument("application/pdf") && !CLAUDE.canReadDocument("audio/ogg") && !CLAUDE.canReadDocument("application/vnd.ms-excel") && !CLAUDE.canReadDocument("") && !CLAUDE.canReadDocument(undefined));
}

// ================================================================ ز4
console.log("\n[ز4] a picture a supplier sends: his own invoice, maybe");
{
  const env = world(); setExtract(INVOICE());
  await hook(env, AHMED_PHONE, image("SVAT_A1"));
  assert("no number on his card + a valid one read → ONE write: vat, «مسجل في الضريبة», «مسجّل»", JSON.stringify(cardWrites()) === JSON.stringify([{ ids: [AHMED], vals: { vat: VAT_A, x_vat_registered: true, x_vat_status: "registered" } }]) && card(AHMED).vat === VAT_A, JSON.stringify(cardWrites()));
  assert("Baraa reads the line, word for word", JSON.stringify(vatLines()) === JSON.stringify([`سجّلنا الرقم الضريبي لـ أحمد حسان: ${VAT_A} من فاتورة INV-2045 — فواتيره من الآن عليها 15%`]), JSON.stringify(vatLines()));
  assert("…as his alert (owner_alert), to his number alone", (rows("x_wa_message") as any[]).some((r) => String(r.x_body ?? r.x_text ?? JSON.stringify(r)).includes("سجّلنا الرقم الضريبي") && purposeOf(r) === "owner_alert") && graph.filter((b: any) => bodyOf(b).includes("سجّلنا الرقم الضريبي")).every((b: any) => b.to === OWNER));
  assert("ONE Claude call for the picture", vatCalls().length === 1 && vatCalls()[0].messages[0].content[0].source.data === B64);
  assert("the supplier's own answer is as before («وصلتنا»), and no form is sent to him", textsTo(AHMED_PHONE).includes(SUPPLIER_ACK_TEXT) && flowsTo(AHMED_PHONE).length === 0);
  assert("his bills carry 15% from now on: src/purchase-accounting.ts reads the card's vat", PA.supplierIsVatRegistered(card(AHMED).vat) === true && PA.supplierIsVatRegistered(false) === false && /supplierVat: supplier\?\.vat/.test(srcOf("purchase-accounting.ts")));
}
{
  const env = world(); setExtract(INVOICE({ invoice_number: null }));
  await hook(env, AHMED_PHONE, pdf("SVAT_PDF1"));
  assert("an invoice whose own number was not read is named by the day: «من فاتورة صورة 3 أكتوبر 2026» — and a PDF is read as a picture is", JSON.stringify(vatLines()) === JSON.stringify([`سجّلنا الرقم الضريبي لـ أحمد حسان: ${VAT_A} من فاتورة صورة ${LABEL} — فواتيره من الآن عليها 15%`])
    && vatCalls().length === 1 && vatCalls()[0].messages[0].content[0].type === "document", JSON.stringify(vatLines()));
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: "مؤسسة ريف الخير للخضار" }));
  await hook(env, AHMED_PHONE, image("SVAT_A11"));
  assert("his own chat: the picture is his whatever name it is printed under (his establishment's, not his card's)", card(AHMED).vat === VAT_A && vatLines().length === 1 && vatLines()[0].startsWith("سجّلنا الرقم الضريبي لـ أحمد حسان:"));
}
{
  const env = world(); card(AHMED).vat = VAT_A; setExtract(INVOICE());
  await hook(env, AHMED_PHONE, image("SVAT_A2"));
  card(AHMED).vat = "3101 2345 6700 003";
  await hook(env, AHMED_PHONE, image("SVAT_A3"));
  assert("the number on his card is the one read → nothing at all: no write, no line, no form (however the card groups it)", cardWrites().length === 0 && vatLines().length === 0 && flowsTo(AHMED_PHONE).length === 0 && vatCalls().length === 2 && card(AHMED).vat === "3101 2345 6700 003");
}
{
  const env = world(); card(AHMED).vat = VAT_B; setExtract(INVOICE());
  await hook(env, AHMED_PHONE, image("SVAT_A4"));
  assert("another number on his card → NEVER replaced; ONE alert with both numbers and where the picture is", card(AHMED).vat === VAT_B && cardWrites().length === 0
    && JSON.stringify(vatLines()) === JSON.stringify([SV.vatMismatchText(AHMED_NAME, VAT_B, VAT_A, "فاتورة INV-2045", SV.WHERE_CHAT)]) && vatLines()[0].includes(VAT_A) && vatLines()[0].includes(VAT_B) && vatLines()[0].includes("محادثة المورد في واتساب") && vatLines()[0].includes("لم يُستبدل"), JSON.stringify(vatLines()));
  await hook(env, AHMED_PHONE, image("SVAT_A5"));
  assert("the same pair again (the invoice's next page): read, and not said twice", vatCalls().length === 2 && vatLines().length === 1 && card(AHMED).vat === VAT_B);
  setExtract(INVOICE({ vat: VAT_C }));
  await hook(env, AHMED_PHONE, image("SVAT_A6"));
  assert("yet another number is another alert", vatLines().length === 2 && vatLines()[1].includes(VAT_C) && card(AHMED).vat === VAT_B && flowsTo(AHMED_PHONE).length === 0);
}
{
  const env = world(); setExtract(NOT_INVOICE);
  await hook(env, AHMED_PHONE, image("SVAT_A7"));
  assert("a picture that is not an invoice (his price list): read, and nothing follows — no write, no line, no form, his count untouched", vatCalls().length === 1 && cardWrites().length === 0 && vatLines().length === 0 && flowsTo(AHMED_PHONE).length === 0 && !card(AHMED).x_vat_ask_count && textsTo(AHMED_PHONE).includes(SUPPLIER_ACK_TEXT));
  setExtract(INVOICE());
  await hook(env, AHMED_PHONE, audio("SVAT_AUD1"));
  assert("a voice note is not a picture: no Claude call for it", vatCalls().length === 1 && cardWrites().length === 0);
  const before = mediaCalls.length;
  const xls = await sent(env, AHMED, AHMED_PHONE, "SVAT_XLS1");
  assert("a sheet is fetched and is not a picture either: no Claude call, nothing written, no form", xls.action === "not_picture" && mediaCalls.length === before + 1 && vatCalls().length === 1 && cardWrites().length === 0 && flowsTo(AHMED_PHONE).length === 0);
}
{
  const env = world(); setExtract(INVOICE()); card(AHMED).vat = VAT_B;
  const a = await sent(env, AHMED, AHMED_PHONE, "SVAT_A8");
  const b = await sent(env, AHMED, AHMED_PHONE, "SVAT_A8");
  assert("the same media id is not read twice: one download, one Claude call", a.action === "mismatch" && b.action === "seen" && vatCalls().length === 1 && JSON.stringify(mediaCalls) === JSON.stringify(["SVAT_A8"]));
  mediaDown = true;
  const c = await sent(env, AHMED, AHMED_PHONE, "SVAT_A9");
  mediaDown = false;
  const d = await sent(env, AHMED, AHMED_PHONE, "SVAT_A9");
  assert("a picture Meta did not hand over is not «unread»: no Claude call, no form — and it is read when it can be fetched", c.action === "no_file" && d.action === "mismatch" && vatCalls().length === 2 && flowsTo(AHMED_PHONE).length === 0);
  odooDown = "res.partner.search_read";
  const e = await sent(env, AHMED, AHMED_PHONE, "SVAT_A10");
  odooDown = "";
  assert("Odoo unreachable: never a throw, no Claude call, nothing written", e.action === "error" && vatCalls().length === 2 && cardWrites().length === 0);
}

// ================================================================ ز5
console.log("\n[ز5] no number on his card and none read: the registration form, once ever");
{
  const env = world(); claude = "down";
  await hook(env, AHMED_PHONE, image("SVAT_F1"));
  const f = flowsTo(AHMED_PHONE), p = par(f[0]), d = dataOf(f[0]);
  assert("Claude did not read the picture → ONE form to the supplier, inside his window: the Flow, its screen, his name, the field opened on his card's name", f.length === 1 && p.flow_id === SV.SUPPLIER_REGISTER_FLOW_ID && p.flow_action === "navigate" && p.flow_action_payload.screen === "SUPPLIER_REGISTER" && p.flow_cta === "سجّل بياناتك"
    && bodyOf(f[0]) === SV.SUPPLIER_REGISTER_ASK_TEXT && JSON.stringify(d) === JSON.stringify({ t: `تسجيل بيانات المورد — ${AHMED_NAME}`, how: SV.SUPPLIER_REGISTER_HOW_TEXT, i_legal: AHMED_NAME, i_cr: "", i_vat: "", i_iban: "" }), JSON.stringify(d));
  const tok = JSON.parse(env.MSG_DEDUP.store.get(SV.supplierTokenKey(tokenOf(f[0]))) ?? "null");
  assert("its flow_token is kept with the number it went to", tokenOf(f[0]).startsWith(`sr1.${AHMED}.`) && SV.isSupplierRegisterToken(tokenOf(f[0])) && tok.to === AHMED_PHONE && tok.partnerId === AHMED && !tok.test);
  assert("it goes under supplier_register_form — a reply, not important, never a template", (rows("x_wa_message") as any[]).some((r) => purposeOf(r) === "supplier_register_form") && PURPOSES.supplier_register_form?.kind === "reply" && PURPOSES.supplier_register_form.important === false && !PURPOSES.supplier_register_form.critical
    && !graph.some((b: any) => b?.to === AHMED_PHONE && b?.type === "template"));
  assert("his card says he was asked: «مرات سؤال الرقم الضريبي» = 1 — the one write", card(AHMED).x_vat_ask_count === 1 && JSON.stringify(cardWrites()) === JSON.stringify([{ ids: [AHMED], vals: { x_vat_ask_count: 1 } }]) && !card(AHMED).vat);
  assert("Baraa is told nothing about it", vatLines().length === 0);
  await hook(env, AHMED_PHONE, image("SVAT_F2"));
  claude = "ok"; setExtract(UNREAD);
  await hook(env, AHMED_PHONE, image("SVAT_F3"));
  assert("ONCE EVER: the next pictures that are not read send no second form", vatCalls().length === 3 && flowsTo(AHMED_PHONE).length === 1 && card(AHMED).x_vat_ask_count === 1);
}
for (const [what, answer] of [["an invoice with no number on it", UNREAD], ["a number of 14 digits", INVOICE({ vat: VAT_A.slice(0, 14) })], ["UTAK's own number read as the seller's", INVOICE({ vat: OWN_VAT })]] as Array<[string, any]>) {
  const env = world(); setExtract(answer);
  await hook(env, AHMED_PHONE, image("SVAT_F4"));
  assert(`${what}: nothing is written as his number, and the form goes`, flowsTo(AHMED_PHONE).length === 1 && !card(AHMED).vat && card(AHMED).x_vat_ask_count === 1 && vatLines().length === 0);
}
{
  const env = world(); claude = "garbage";
  const asked = await sent(env, AHMED, AHMED_PHONE, "SVAT_F5");
  assert("his window closed (the picture came from the buyer, not from him): NOT sent, no template, nothing held by the gateway — it is owed", asked.action === "form_owed" && sentTo(AHMED_PHONE).length === 0 && heldFor(env, AHMED_PHONE).length === 0
    && owed(env, AHMED_PHONE)?.partnerId === AHMED && !card(AHMED).x_vat_ask_count && cardWrites().length === 0, JSON.stringify(asked));
  assert("the form is never held and never a template: noHold on its send, no template in the module", /noHold: true,/.test(srcOf("supplier-vat.ts")) && !/kind: "template"/.test(srcOf("supplier-vat.ts")) && !graph.some((b: any) => b?.type === "template"));
  setExtract({ prices: [], unrecognized: [] }); claude = "ok";
  await hook(env, AHMED_PHONE, text("السلام عليكم"));
  assert("his first message: the owed form goes, his card counts it, and nothing is owed any more", flowsTo(AHMED_PHONE).length === 1 && bodyOf(flowsTo(AHMED_PHONE)[0]) === SV.SUPPLIER_REGISTER_ASK_TEXT && card(AHMED).x_vat_ask_count === 1 && owed(env, AHMED_PHONE) === null);
  await hook(env, AHMED_PHONE, text("موجود؟"));
  assert("…and his next message sends nothing more", flowsTo(AHMED_PHONE).length === 1);
}
{
  const env = world(); claude = "down";
  await sent(env, AHMED, AHMED_PHONE, "SVAT_F6");
  card(AHMED).vat = VAT_A;       // Baraa typed it meanwhile
  setExtract({ prices: [], unrecognized: [] }); claude = "ok";
  await hook(env, AHMED_PHONE, text("صباح الخير"));
  assert("a number on his card since: the owed form does not go, and it is not owed any more", flowsTo(AHMED_PHONE).length === 0 && owed(env, AHMED_PHONE) === null && !card(AHMED).x_vat_ask_count);
}
{
  const env = world(); claude = "down"; card(AHMED).vat = VAT_B; openWindow(env, AHMED_PHONE);
  const a = await sent(env, AHMED, AHMED_PHONE, "SVAT_F21");
  setExtract(UNREAD); claude = "ok";
  const b = await sent(env, AHMED, AHMED_PHONE, "SVAT_F22");
  assert("a supplier who HAS a number, and a picture that was not read: nothing — no form, no line, his number as it was", a.action === "unread" && b.action === "unread" && graph.filter(Boolean).length === 0 && card(AHMED).vat === VAT_B && cardWrites().length === 0);
}
{
  const env = world(); claude = "down"; card(AHMED).x_legal_name = "مؤسسة ريف الخير للخضار"; openWindow(env, AHMED_PHONE);
  await sent(env, AHMED, AHMED_PHONE, "SVAT_F23");
  assert("the form's «الاسم الرسمي» opens on his card's official name when it has one", dataOf(flowsTo(AHMED_PHONE)[0]).i_legal === "مؤسسة ريف الخير للخضار" && dataOf(flowsTo(AHMED_PHONE)[0]).t === `تسجيل بيانات المورد — ${AHMED_NAME}`);
}
{
  const env = world(); claude = "down";
  await sent(env, AHMED, AHMED_PHONE, "SVAT_F7");
  claude = "ok"; setExtract(INVOICE());
  await hook(env, AHMED_PHONE, image("SVAT_F8"));
  assert("his first message IS his invoice, and it is read: the number is written, and the form that was owed is never sent", card(AHMED).vat === VAT_A && flowsTo(AHMED_PHONE).length === 0 && owed(env, AHMED_PHONE) === null && !card(AHMED).x_vat_ask_count && vatLines().length === 1);
}
{
  const env = world(); claude = "down";
  await sent(env, AHMED, AHMED_PHONE, "SVAT_F9");
  claude = "ok"; setExtract(NOT_INVOICE);
  await hook(env, AHMED_PHONE, image("SVAT_F10"));
  assert("his first message is a picture that is not an invoice: it is read first, then the owed form goes", vatCalls().length === 2 && flowsTo(AHMED_PHONE).length === 1 && card(AHMED).x_vat_ask_count === 1 && owed(env, AHMED_PHONE) === null);
}
{
  const env = world(); claude = "down"; card(AHMED).x_vat_ask_count = 1;
  const a = await sent(env, AHMED, AHMED_PHONE, "SVAT_F11");
  card(AHMED).x_vat_ask_count = 0; card(AHMED).x_vat_status = "not_registered";
  const b = await sent(env, AHMED, AHMED_PHONE, "SVAT_F12");
  openWindow(env, AHMED_PHONE);
  const c = await sent(env, AHMED, AHMED_PHONE, "SVAT_F13");
  assert("a supplier whose card says he was asked, or says «غير مسجّل», is never asked: not sent, not owed", a.action === "asked_before" && b.action === "asked_before" && c.action === "asked_before" && sentTo(AHMED_PHONE).length === 0 && owed(env, AHMED_PHONE) === null);
  card(AHMED).x_vat_status = false;
  const dd = await sent(env, AHMED, AHMED_PHONE, "SVAT_F14");
  assert("Baraa set the count back to 0: the next picture that is not read asks him again", dd.action === "form_sent" && flowsTo(AHMED_PHONE).length === 1 && card(AHMED).x_vat_ask_count === 1);
}
{
  const env = world(); claude = "down";
  const l = list({ supplier: FAJR, lines: [FAJR] });
  const a = await onList(env, l, "SVAT_F15"), b = await onList(env, l, "SVAT_F16");
  assert("a supplier with no WhatsApp number of his own gets no form; Baraa is told ONCE, with where the picture is", a.action === "no_number" && b.action === "no_number" && graph.filter(Boolean).every((x: any) => x.to === OWNER)
    && JSON.stringify(vatLines()) === JSON.stringify([SV.vatNoNumberText("فجر بزنسس", `قائمة الشراء #${l}`)]) && !card(FAJR).x_vat_ask_count && cardWrites().length === 0, JSON.stringify(vatLines()));
}
{
  const env = world(); claude = "down"; metaRefusesFlow = true; openWindow(env, AHMED_PHONE);
  const a = await sent(env, AHMED, AHMED_PHONE, "SVAT_F17");
  assert("Meta refuses the form: it did not go — his card does not count it, and it is not retried with every message of his (not owed)", a.action === "form_failed" && !card(AHMED).x_vat_ask_count && owed(env, AHMED_PHONE) === null && cardWrites().length === 0);
  metaRefusesFlow = false;
  const b = await sent(env, AHMED, AHMED_PHONE, "SVAT_F18");
  assert("…and the next picture that is not read asks him", b.action === "form_sent" && card(AHMED).x_vat_ask_count === 1);
}
{
  const env = world(); claude = "down"; openWindow(env, AHMED_PHONE);
  const both = await Promise.all([sent(env, AHMED, AHMED_PHONE, "SVAT_F19"), sent(env, AHMED, AHMED_PHONE, "SVAT_F20")]);
  assert("two pictures of his read at the same moment: one form", both.filter((r) => r.action === "form_sent").length === 1 && flowsTo(AHMED_PHONE).length === 1, JSON.stringify(both));
}

// ================================================================ ز6
console.log("\n[ز6] the purchase list's invoice: whose it is");
{
  const env = world(); setExtract(INVOICE());
  const l = list({ lines: [AHMED, CASH] });
  const r = await onList(env, l, "SVAT_L1");
  assert("one supplier on the list beside the bucket, and the seller's name is his → written on his card, and Baraa's line", r.action === "registered" && card(AHMED).vat === VAT_A && JSON.stringify(cardWrites()) === JSON.stringify([{ ids: [AHMED], vals: { vat: VAT_A, x_vat_registered: true, x_vat_status: "registered" } }])
    && JSON.stringify(vatLines()) === JSON.stringify([SV.vatRegisteredText(AHMED_NAME, VAT_A, "فاتورة INV-2045")]));
  assert("the file the list's own path downloaded is the one read: no second download", mediaCalls.length === 0 && vatCalls().length === 1 && vatCalls()[0].messages[0].content[0].source.data === B64);
  assert("«مشتريات السوق النقدية» is never given a number", !card(CASH).vat && !card(CASH).x_vat_status);
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: null }));
  const l = list({ lines: [AHMED, AHMED] });
  const r = await onList(env, l, "SVAT_L2");
  assert("a valid number with NO seller's name read is never written on «the only supplier of the list» (it may be a market seller's invoice): nothing written, no form", r.action === "unmatched" && !card(AHMED).vat && !card(AHMED).x_vat_status && cardWrites().length === 0
    && sentTo(AHMED_PHONE).length === 0 && owed(env, AHMED_PHONE) === null, JSON.stringify(r));
  assert("…Baraa gets the alert: the number read, «لم يُقرأ» for the name, the list's supplier", JSON.stringify(vatLines()) === JSON.stringify([SV.vatUnmatchedText(VAT_A, "", [AHMED_NAME], "فاتورة INV-2045", `قائمة الشراء #${l}`)]) && vatLines()[0].includes(VAT_A) && vatLines()[0].includes("اسم البائع المقروء: لم يُقرأ"), JSON.stringify(vatLines()));
  await onList(env, l, "SVAT_L19");
  assert("…once for the same number on the same list", vatCalls().length === 2 && vatLines().length === 1);
  card(AHMED).x_legal_name = "مؤسسة ريف الخير للخضار";
  setExtract(INVOICE({ supplier_name: "مؤسسة ريف الخير" }));
  const named = await onList(env, l, "SVAT_L20");
  assert("…and once his card's «الاسم الرسمي للمنشأة» is the name on his invoices, the next one registers him by itself", named.action === "registered" && card(AHMED).vat === VAT_A && vatLines().at(-1) === SV.vatRegisteredText(AHMED_NAME, VAT_A, "فاتورة INV-2045"));
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: null }));
  card(AHMED).vat = VAT_B;
  const other = await onList(env, list({ lines: [AHMED, CASH] }), "SVAT_L21");
  card(AHMED).vat = "3101 2345 6700 003";
  const his = await onList(env, list({ lines: [AHMED, CASH] }), "SVAT_L22");
  assert("no name read beside a supplier who has ANOTHER number: not «a mismatch» of his — nobody's, and nothing is said; his own number, with no name, is his (nothing either)", other.action === "unmatched" && his.action === "same" && his.partnerId === AHMED
    && cardWrites().length === 0 && graph.filter(Boolean).length === 0 && card(AHMED).vat === "3101 2345 6700 003");
  claude = "down"; card(AHMED).vat = false;
  const unread = await onList(env, list({ lines: [AHMED, CASH] }), "SVAT_L23");
  assert("a picture that gave NO number names nobody either: the list's only supplier is asked by his form (owed while his window is closed)", unread.action === "form_owed" && unread.partnerId === AHMED && owed(env, AHMED_PHONE)?.partnerId === AHMED && cardWrites().length === 0);
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: "مؤسسة الريف الأخضر للخضار" }));
  const l = list({ lines: [AHMED, CASH] });
  const r = await onList(env, l, "SVAT_L3");
  assert("the seller's name read is NOT the list's supplier (a cash-market seller's invoice) → NOTHING is written", r.action === "unmatched" && !card(AHMED).vat && cardWrites().length === 0 && flowsTo(AHMED_PHONE).length === 0 && owed(env, AHMED_PHONE) === null);
  assert("…and Baraa gets ONE alert: the number read, the name read, the list's suppliers — never the bucket", JSON.stringify(vatLines()) === JSON.stringify([SV.vatUnmatchedText(VAT_A, "مؤسسة الريف الأخضر للخضار", [AHMED_NAME], "فاتورة INV-2045", `قائمة الشراء #${l}`)])
    && vatLines()[0].includes(VAT_A) && vatLines()[0].includes("مؤسسة الريف الأخضر للخضار") && vatLines()[0].includes(AHMED_NAME) && !vatLines()[0].includes(MKT) && vatLines()[0].includes(`قائمة الشراء #${l}`) && vatLines()[0].includes("لم يُكتب شيء"), JSON.stringify(vatLines()));
  await onList(env, l, "SVAT_L4");
  assert("the same number on the same list again (the invoice's next page): not said twice", vatCalls().length === 2 && vatLines().length === 1);
}
{
  const env = world(); card(AHMED).vat = VAT_B; setExtract(INVOICE({ supplier_name: "مؤسسة الريف الأخضر للخضار" }));
  const r = await onList(env, list({ lines: [AHMED, CASH] }), "SVAT_L16");
  assert("the same picture once every supplier of the list has his number: another seller's invoice (the buyer photographs one every day) — nothing written, and nothing said", r.action === "unmatched" && card(AHMED).vat === VAT_B && cardWrites().length === 0 && graph.filter(Boolean).length === 0 && vatCalls().length === 1);
}
{
  const env = world(); card(AHMED).vat = VAT_A; setExtract(INVOICE({ supplier_name: "مؤسسة ريف الخير للخضار" }));
  const one = await onList(env, list({ lines: [AHMED, CASH] }), "SVAT_L17");
  const two = await onList(env, list({ lines: [AHMED, NAKHEEL] }), "SVAT_L18");
  assert("the number read is already a card's: it is that supplier's under whatever name it is printed — nothing at all, and never another supplier's", one.action === "same" && two.action === "same" && two.partnerId === AHMED && !card(NAKHEEL).vat && cardWrites().length === 0 && graph.filter(Boolean).length === 0);
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: "مؤسسة النخيل", vat: VAT_B }));
  const r = await onList(env, list({ lines: [AHMED, NAKHEEL, CASH] }), "SVAT_L5");
  assert("several suppliers on the list → the one whose name is the name read: his card alone", r.action === "registered" && r.partnerId === NAKHEEL && card(NAKHEEL).vat === VAT_B && !card(AHMED).vat && cardWrites().length === 1 && vatLines()[0] === SV.vatRegisteredText(NAKHEEL_NAME, VAT_B, "فاتورة INV-2045"));
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: "مؤسسة النخيل" }));
  seed("res.partner", { id: 808, name: "مؤسسة النخيل للفواكه", supplier_rank: 1 });
  const r = await onList(env, list({ lines: [NAKHEEL, 808] }), "SVAT_L12");
  assert("the name read is the name of TWO suppliers of the list → neither: nothing written, Baraa decides", r.action === "unmatched" && !card(NAKHEEL).vat && !card(808).vat && cardWrites().length === 0 && vatLines().length === 1 && vatLines()[0].includes("مؤسسة النخيل للفواكه"));
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: "مؤسسة ريف الخير للخضار" }));
  card(AHMED).x_legal_name = "ريف الخير";
  const r = await onList(env, list({ lines: [AHMED, NAKHEEL, CASH] }), "SVAT_L13");
  assert("the name read is his card's official name (not the name the team calls him by) → him", r.action === "registered" && r.partnerId === AHMED && card(AHMED).vat === VAT_A && !card(NAKHEEL).vat);
}
{
  const env = world(); setExtract(INVOICE());
  const l = seed("x_purchase_list", { x_date: DAY, x_status: "done", x_supplier_id: AHMED, x_utak_simulation: false,
    x_aggregated_items: JSON.stringify([{ product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 2, order_ids: [], unit_price: null, price_supplier_id: null }]) });
  const r = await onList(env, l, "SVAT_L14");
  const bare = await onList(env, seed("x_purchase_list", { x_date: DAY, x_status: "done", x_supplier_id: NAKHEEL, x_aggregated_items: "not json", x_utak_simulation: false }), "SVAT_L15");
  assert("a list whose lines name no supplier of their own (or whose lines cannot be read): the list's own supplier is the one", r.action === "registered" && card(AHMED).vat === VAT_A && bare.action === "unmatched" && !card(NAKHEEL).vat, JSON.stringify([r, bare]));
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: null }));
  const l = list({ lines: [AHMED, NAKHEEL] });
  const r = await onList(env, l, "SVAT_L6");
  assert("several suppliers and no name read → nothing written; Baraa's alert names both and says the name was not read", r.action === "unmatched" && !card(AHMED).vat && !card(NAKHEEL).vat && cardWrites().length === 0
    && JSON.stringify(vatLines()) === JSON.stringify([SV.vatUnmatchedText(VAT_A, "", [AHMED_NAME, NAKHEEL_NAME], "فاتورة INV-2045", `قائمة الشراء #${l}`)]) && vatLines()[0].includes("لم يُقرأ"));
  setExtract(INVOICE({ supplier_name: "حسان والنخيل" }));
  claude = "down";
  openWindow(env, AHMED_PHONE); openWindow(env, NAKHEEL_PHONE);
  const f = await onList(env, l, "SVAT_L7");
  assert("several suppliers and a picture that was not read → nothing: no form to anyone, no second alert", f.action === "unmatched" && sentTo(AHMED_PHONE).length === 0 && sentTo(NAKHEEL_PHONE).length === 0 && vatLines().length === 1 && cardWrites().length === 0);
}
{
  const env = world(); setExtract(INVOICE()); card(AHMED).vat = VAT_B;
  const l = list();
  const r = await onList(env, l, "SVAT_L8");
  assert("the list's supplier has another number → not replaced, and the alert says which list the picture is on", r.action === "mismatch" && card(AHMED).vat === VAT_B && JSON.stringify(vatLines()) === JSON.stringify([SV.vatMismatchText(AHMED_NAME, VAT_B, VAT_A, "فاتورة INV-2045", `قائمة الشراء #${l}`)]) && vatLines()[0].includes(`الصورة: قائمة الشراء #${l}`));
}
{
  const env = world(); setExtract(INVOICE());
  const sim = await onList(env, list({ sim: true }), "SVAT_L9");
  const gone = await onList(env, 999999, "SVAT_L10");
  assert("a simulation's list, or a list that is gone: nothing is read (no Claude call), nothing written", sim.action === "out" && gone.action === "out" && vatCalls().length === 0 && cardWrites().length === 0 && !card(AHMED).vat);
  odooDown = "x_purchase_list.read";
  const down = await onList(env, list(), "SVAT_L11");
  odooDown = "";
  assert("the list unreadable: never a throw, no Claude call", down.action === "error" && vatCalls().length === 0);
}
{
  // the receipt form of § 55, with the invoice's photo in it
  const env = world(); setExtract(INVOICE());
  table("hr.employee").delete(7000 + WH); table("hr.employee").delete(7000 + COLL);
  table("hr.employee").get(OMAR_EMP)!.x_utak_role_ids = [71, 72, 73];
  for (const [id, name] of [[5, "فواكه"], [6, "خضار"], [7, "ورقيات"]] as Array<[number, string]>) seed("product.category", { id, name, parent_id: false });
  openWindow(env, OMAR_PHONE);
  const order = seed("x_daily_order", { x_customer_id: C1, x_state: "in_purchase", x_order_date: "2026-10-02", x_created_via: "whatsapp", x_delivery_neighborhood: "العليا" });
  seed("x_daily_order_line", { x_order_id: order, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 5, x_unit_price: 33.33, x_status: "pending" });
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: AHMED, x_price_sar: 17.35, x_date: "2026-10-02", x_extraction_status: "extracted" });
  const l = seed("x_purchase_list", { x_date: "2026-10-02", x_status: "sent", x_supplier_id: AHMED, x_total_items_count: 1, x_utak_simulation: false,
    x_aggregated_items: JSON.stringify([{ product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 5, order_ids: [order], unit_price: 17.35, price_supplier_id: AHMED }]) });
  await quiet(() => RC.sendReceiptForm(env, { partnerId: OMAR, name: "عمر المجهلي", whatsapp: "+" + OMAR_PHONE }, l));
  const token = tokenOf(flowsTo(OMAR_PHONE)[0]);
  const r = await quiet(() => RC.handleReceiptFormReply(env, { from: "+" + OMAR_PHONE, messageId: "wamid.RCV1", flow: { token, values: { g1: "5", photo: [{ id: "SVAT_RC1", mime_type: "image/jpeg", file_name: "inv.jpg", sha256: "x" }] } } }));
  await settle();
  const answerAt = graph.findIndex((b: any) => b?.to === OMAR_PHONE && bodyOf(b).includes(RC.RECEIPT_PHOTO_SAVED_TEXT)), lineAt = graph.findIndex((b: any) => bodyOf(b).includes("سجّلنا الرقم الضريبي"));
  assert("«📥 استلام المشتريات» with the invoice's photo: kept on the list as before, then read — the supplier's number is on his card", r.action === "received" && r.photos === 1 && !!(table("x_purchase_list").get(l) as any).x_tax_invoice_filename && card(AHMED).vat === VAT_A
    && vatLines().includes(SV.vatRegisteredText(AHMED_NAME, VAT_A, "فاتورة INV-2045")), JSON.stringify(r));
  assert("…read ONCE, from the file the form already downloaded, and after the buyer was answered", vatCalls().length === 1 && mediaCalls.filter((m) => m === "SVAT_RC1").length === 1 && answerAt >= 0 && lineAt > answerAt, `${answerAt} ${lineAt}`);
  assert("the buyer reads nothing about a tax number, and no price reaches the reading", !textsTo(OMAR_PHONE).some((t: string) => /ضريبي/.test(t)) && !JSON.stringify(vatCalls()).includes("17.35"));
}
{
  // the buyer's photo in the hour after «تم الشراء»
  const env = world(); setExtract(INVOICE());
  const l = list({ lines: [AHMED, CASH] });
  await PI.openPurchaseInvoiceWindow(env, OMAR, l);
  await hook(env, OMAR_PHONE, image("SVAT_PI1"));
  assert("the buyer's photo within the hour of «تم الشراء»: kept on the list, acknowledged as before, and read for the list's supplier", !!(table("x_purchase_list").get(l) as any).x_tax_invoice_filename && textsTo(OMAR_PHONE).includes(PI.PINV_ACK_TEXT) && card(AHMED).vat === VAT_A
    && vatLines().includes(SV.vatRegisteredText(AHMED_NAME, VAT_A, "فاتورة INV-2045")) && vatCalls().length === 1);
  assert("…never for the buyer himself: his own card is untouched", !card(OMAR).vat && !card(OMAR).x_vat_status);
}

// ================================================================ ز7
console.log("\n[ز7] an expense's attachment: the bill's partner — and never a form");
{
  const env = world(); setExtract(INVOICE({ supplier_name: "شركة فجر بزنسس للتجارة", invoice_number: "F-88" }));
  const r = await expense(env, FAJR, "SVAT_E1");
  assert("the seam answers nothing, and the vendor with no number gets the one read: written, and Baraa's line", r === undefined && card(FAJR).vat === VAT_A && card(FAJR).x_vat_status === "registered" && card(FAJR).x_vat_registered === true
    && JSON.stringify(vatLines()) === JSON.stringify([`سجّلنا الرقم الضريبي لـ فجر بزنسس: ${VAT_A} من فاتورة F-88 — فواتيره من الآن عليها 15%`]) && JSON.stringify(mediaCalls) === JSON.stringify(["SVAT_E1"]) && vatCalls().length === 1);
  setExtract(INVOICE({ supplier_name: "شركة فجر بزنسس للتجارة", vat: VAT_B }));
  await expense(env, FAJR, "SVAT_E2", 5502);
  assert("his next expense shows another number: not replaced, and the alert says which expense the picture is on", card(FAJR).vat === VAT_A && vatLines().length === 2 && vatLines()[1] === SV.vatMismatchText("فجر بزنسس", VAT_A, VAT_B, "فاتورة INV-2045", "مرفق المصروف (القيد #5502)"));
}
{
  const env = world(); setExtract(INVOICE({ supplier_name: "محطة الدريس للوقود" }));
  await expense(env, FAJR, "SVAT_E3");
  assert("the seller's name read is not the vendor Baraa typed (a bucket vendor, another shop's receipt): nothing written, and nothing said", vatCalls().length === 1 && !card(FAJR).vat && cardWrites().length === 0 && vatLines().length === 0 && graph.filter(Boolean).length === 0);
  setExtract(INVOICE({ supplier_name: null }));
  await expense(env, FAJR, "SVAT_E4");
  assert("a valid number with no seller's name read is not written on the bill's partner either — and from an expense nothing is said", vatCalls().length === 2 && !card(FAJR).vat && cardWrites().length === 0 && graph.filter(Boolean).length === 0);
  card(FAJR).vat = VAT_A;
  await expense(env, FAJR, "SVAT_E8");
  assert("…the vendor's own number with no name read is his: nothing at all", vatCalls().length === 3 && card(FAJR).vat === VAT_A && cardWrites().length === 0 && graph.filter(Boolean).length === 0);
}
{
  const env = world(); claude = "down"; openWindow(env, NAKHEEL_PHONE);
  await expense(env, NAKHEEL, "SVAT_E5");
  setExtract(UNREAD); claude = "ok";
  await expense(env, NAKHEEL, "SVAT_E6");
  await expense(env, FAJR, "SVAT_E7");
  assert("a picture that was not read, or shows no number: NOTHING from an expense — no form to a vendor with a number and an open window, no line about one without", vatCalls().length === 3 && graph.filter(Boolean).length === 0 && owed(env, NAKHEEL_PHONE) === null
    && !card(NAKHEEL).x_vat_ask_count && cardWrites().length === 0);
}

// ================================================================ ز8
console.log("\n[ز8] who is out: no download, no Claude call, nothing sent");
{
  const env = world(); setExtract(INVOICE()); openWindow(env, RAED_PHONE);
  card(OMAR).supplier_rank = 1;
  const out = [await sent(env, RAED, RAED_PHONE, "SVAT_O1"), await sent(env, OMAR, OMAR_PHONE, "SVAT_O2"), await sent(env, BARAA_CARD, OWNER, "SVAT_O3"), await sent(env, CASH, "", "SVAT_O4")];
  assert("رائد (a price source, not a supplier), a team member's own card, a card with Baraa's own number, «مشتريات السوق النقدية»: never read", out.every((r) => r.action === "out") && claudeCalls.length === 0 && mediaCalls.length === 0 && cardWrites().length === 0 && graph.filter(Boolean).length === 0);
  const l = list({ supplier: RAED, lines: [RAED, OMAR, CASH, BARAA_CARD] });
  const onL = await onList(env, l, "SVAT_O5");
  const ex = [await expense(env, RAED, "SVAT_O6"), await expense(env, CASH, "SVAT_O7")];
  assert("…nor as a list's suppliers or an expense's vendor: no Claude call at all", onL.action === "out" && ex.every((x) => x === undefined) && claudeCalls.length === 0 && mediaCalls.length === 0 && [RAED, OMAR, CASH, BARAA_CARD].every((id) => !card(id).vat));
  claude = "down";
  await onList(env, list({ lines: [RAED, AHMED] }), "SVAT_O8");
  assert("beside a real supplier they are not suppliers of the list: he is its only one, and the unread picture's form is his alone", vatCalls().length === 1 && owed(env, AHMED_PHONE)?.partnerId === AHMED && owed(env, RAED_PHONE) === null && sentTo(RAED_PHONE).length === 0);
}
{
  const env = world(); setExtract(INVOICE());
  await hook(env, RAED_PHONE, image("SVAT_O9"));
  await hook(env, OWNER, image("SVAT_O10"));
  assert("through the webhook: رائد's picture and Baraa's own are never read, and no form goes to either", vatCalls().length === 0 && flowsTo(RAED_PHONE).length === 0 && flowsTo(OWNER).length === 0 && !card(RAED).vat && !card(BARAA_CARD).vat && cardWrites().length === 0);
}

// ================================================================ ز9
console.log("\n[ز9] the form's «إرسال»");
for (const [what, over, key, reason] of [
  ["the official name left empty", { legal: "  " }, "legal", SV.SUPPLIER_BAD_LEGAL_TEXT],
  ["a commercial registration of nine digits", { cr: "101012345" }, "cr", SV.SUPPLIER_BAD_CR_TEXT],
  ["a commercial registration with letters", { cr: "CR10101234" }, "cr", SV.SUPPLIER_BAD_CR_TEXT],
  ["a tax number that does not end with 3", { vat: "310123456700004" }, "vat", SV.SUPPLIER_BAD_VAT_TEXT],
  ["no certificate picture", { photo: [] }, "photo", SV.SUPPLIER_NO_PHOTO_TEXT],
] as Array<[string, Record<string, unknown>, string, string]>) {
  const env = world();
  const token = await formTo(env);
  const r = await reply(env, AHMED_PHONE, token, { ...GOOD, iban: IBAN_OK, ...over });
  await settle();
  const f = flowsTo(AHMED_PHONE).at(-1), typed = { ...GOOD, iban: IBAN_OK, ...over } as any;
  assert(`${what} → the form is refused as a whole: nothing written, nothing downloaded, ONE message — a fresh form naming it, opened on what he typed`, r.action === "invalid" && JSON.stringify(r.problems) === JSON.stringify([key]) && cardWrites().length === 0 && rows("ir.attachment").length === 0 && mediaCalls.length === 0
    && sentTo(AHMED_PHONE).length === 2 && flowsTo(AHMED_PHONE).length === 2 && bodyOf(f) === SV.supplierRefusalText([key as any]) && bodyOf(f).includes(reason) && tokenOf(f) !== token
    && dataOf(f).i_legal === String(typed.legal).trim() && dataOf(f).i_cr === typed.cr && dataOf(f).i_vat === typed.vat && dataOf(f).i_iban === IBAN_OK && vatLines().length === 0, JSON.stringify(r));
}
{
  const env = world();
  const token = await formTo(env);
  const r = await reply(env, AHMED_PHONE, token, { legal: "", cr: "1", vat: "3", photo: [], iban: "" });
  assert("every field wrong: each named, in the form's order — and the refused form's token is spent", JSON.stringify(r.problems) === JSON.stringify(["legal", "cr", "vat", "photo"]) && bodyOf(flowsTo(AHMED_PHONE).at(-1)).split("\n").length === 6 && (await reply(env, AHMED_PHONE, token, GOOD)).action === "duplicate" && cardWrites().length === 0);
  const fresh2 = tokenOf(flowsTo(AHMED_PHONE).at(-1));
  metaRefusesFlow = true;
  const again = await reply(env, AHMED_PHONE, fresh2, { ...GOOD, cr: "12" });
  assert("a fresh form that cannot go: the reasons still reach him, as a text", again.action === "invalid" && textsTo(AHMED_PHONE).at(-1) === SV.supplierRefusalText(["cr"]));
  assert("the refusal's fresh form is the same one ask: his card's count is not touched by it", !card(AHMED).x_vat_ask_count);
}
{
  const env = world();
  const token = await formTo(env);
  const r = await reply(env, AHMED_PHONE, token, { ...GOOD, cr: "١٠١٠١٢٣٤٥٦", vat: "٣١٠١٢٣٤٥٦٧٠٠٠٠٣", iban: "sa03 8000 0000 6080 1016 7519" });
  await settle();
  assert("accepted, a card with no number → ONE write: the official name, the CR, the number with «مسجّل», the IBAN", r.action === "saved" && r.number === "new" && JSON.stringify(cardWrites()) === JSON.stringify([{ ids: [AHMED], vals: { x_legal_name: GOOD.legal, x_cr_number: CR, vat: VAT_A, x_vat_registered: true, x_vat_status: "registered", x_iban: IBAN_OK } }]), JSON.stringify(cardWrites()));
  const a = rows("ir.attachment") as any[], note = odooLog.filter((c: any) => c.model === "res.partner" && c.method === "message_post");
  assert("the certificate's picture is downloaded and attached to his card: ONE internal note with the file in its log", JSON.stringify(mediaCalls) === JSON.stringify(["SVAT_CERT1"]) && a.length === 1 && a[0].res_model === "res.partner" && a[0].res_id === AHMED && a[0].raw === B64 && a[0].mimetype === "image/jpeg" && a[0].name === `شهادة-الضريبة-${AHMED}.jpg`
    && note.length === 1 && JSON.stringify(note[0].body.ids) === JSON.stringify([AHMED]) && JSON.stringify(note[0].body.attachment_ids) === JSON.stringify([a[0].id]) && note[0].body.subtype_xmlid === "mail.mt_note" && note[0].body.body === SV.certificateLogLine({ legal: GOOD.legal, cr: CR, vat: VAT_A }), JSON.stringify(note.map((n: any) => n.body)));
  assert("the supplier reads «وصل ✅» with what was kept", textsTo(AHMED_PHONE).at(-1) === ["وصل ✅ سجّلنا بيانات منشأتك:", `• الاسم الرسمي: ${GOOD.legal}`, `• السجل التجاري: ${CR}`, `• الرقم الضريبي: ${VAT_A}`, "• صورة شهادة الضريبة ✅", "• الآيبان: SA03 8000 0000 6080 1016 7519"].join("\n"), textsTo(AHMED_PHONE).at(-1));
  assert("Baraa reads the summary — its first line his line, «من نموذج التسجيل»", JSON.stringify(vatLines()) === JSON.stringify([[`سجّلنا الرقم الضريبي لـ أحمد حسان: ${VAT_A} من نموذج التسجيل — فواتيره من الآن عليها 15%`, `📝 من النموذج: الاسم الرسمي «${GOOD.legal}» · السجل التجاري ${CR}`,
    "📎 صورة شهادة الضريبة في سجل بطاقته في Odoo.", "الآيبان: SA03 8000 0000 6080 1016 7519"].join("\n")]), JSON.stringify(vatLines()));
  assert("no Claude call: the form's number is typed, not read", claudeCalls.length === 0);
  assert("the token is read once", (await reply(env, AHMED_PHONE, token, GOOD)).action === "duplicate" && textsTo(AHMED_PHONE).at(-1) === SV.SUPPLIER_REGISTER_USED_TEXT && cardWrites().length === 1 && rows("ir.attachment").length === 1);
}
{
  const env = world();
  const token = await formTo(env);
  const r = await reply(env, AHMED_PHONE, token, { ...GOOD, iban: IBAN_BAD });
  assert("an IBAN that fails § 52's check is NOT written and refuses nothing: the rest is kept", r.action === "saved" && !("x_iban" in cardWrites()[0].vals) && !card(AHMED).x_iban && card(AHMED).vat === VAT_A && card(AHMED).x_cr_number === CR);
  assert("…and both are told in one line", textsTo(AHMED_PHONE).at(-1).split("\n").at(-1) === SV.SUPPLIER_BAD_IBAN_TEXT && vatLines()[0].split("\n").at(-1) === `⚠️ الآيبان اللي كتبه غير صحيح ولم يُحفظ: ${IBAN_BAD}`);
}
{
  const env = world();
  const token = await formTo(env);
  await reply(env, AHMED_PHONE, token, GOOD);
  assert("no IBAN typed: none written, and no line about it", !("x_iban" in cardWrites()[0].vals) && !/آيبان/.test(textsTo(AHMED_PHONE).at(-1)) && !/آيبان/.test(vatLines()[0]));
}
{
  const env = world(); card(AHMED).vat = VAT_A;
  const token = await formTo(env);
  const r = await reply(env, AHMED_PHONE, token, GOOD);
  assert("the number typed is the one on his card → the number is not written again, and Baraa's summary carries no «سجّلنا»", r.number === "same" && JSON.stringify(cardWrites()) === JSON.stringify([{ ids: [AHMED], vals: { x_legal_name: GOOD.legal, x_cr_number: CR } }])
    && !ownerTexts().some((t: string) => t.includes("سجّلنا الرقم الضريبي")) && vatLines()[0].startsWith(`📝 المورد أحمد حسان عبّى نموذج التسجيل. رقمه الضريبي ${VAT_A} يطابق المسجّل`));
}
{
  const env = world(); card(AHMED).vat = VAT_B;
  const token = await formTo(env);
  const r = await reply(env, AHMED_PHONE, token, GOOD);
  assert("the number typed is NOT the one on his card → never replaced; the rest is written; Baraa is alerted with both numbers", r.number === "other" && card(AHMED).vat === VAT_B && JSON.stringify(cardWrites()) === JSON.stringify([{ ids: [AHMED], vals: { x_legal_name: GOOD.legal, x_cr_number: CR } }])
    && vatLines()[0].startsWith(SV.vatMismatchText(AHMED_NAME, VAT_B, VAT_A, "نموذج التسجيل")) && vatLines()[0].includes(VAT_A) && vatLines()[0].includes(VAT_B) && !vatLines()[0].includes("سجّلنا الرقم الضريبي"));
  assert("…and the supplier is told his number is not the one we hold — not the other number itself", textsTo(AHMED_PHONE).at(-1).includes(SV.SUPPLIER_OTHER_NUMBER_TEXT) && !textsTo(AHMED_PHONE).at(-1).includes(VAT_B));
}
{
  const env = world();
  const token = await formTo(env);
  const r = await reply(env, AHMED_PHONE, token, { ...GOOD, photo: photo("SVAT_BAD_CERT") });
  assert("the certificate could not be fetched: the card is still written, and both are told the picture was not kept", r.action === "saved" && card(AHMED).vat === VAT_A && rows("ir.attachment").length === 0 && textsTo(AHMED_PHONE).at(-1).includes(SV.SUPPLIER_CERT_FAILED_TEXT) && vatLines()[0].includes("تعذّر حفظ صورة شهادة الضريبة"));
}
{
  const env = world();
  const token = await formTo(env);
  odooDown = "ir.attachment.create";
  const r = await reply(env, AHMED_PHONE, token, GOOD);
  odooDown = "";
  assert("Odoo refuses the attachment: the card is written all the same, he is answered, and both are told the picture was not kept", r.action === "saved" && card(AHMED).vat === VAT_A && card(AHMED).x_cr_number === CR && textsTo(AHMED_PHONE).at(-1).includes(SV.SUPPLIER_CERT_FAILED_TEXT)
    && vatLines()[0].includes("تعذّر حفظ صورة شهادة الضريبة") && odooLog.filter((c: any) => c.model === "res.partner" && c.method === "message_post").length === 0);
}
{
  const env = world();
  const token = await formTo(env);
  openWindow(env, NAKHEEL_PHONE);
  const other = await reply(env, NAKHEEL_PHONE, token, GOOD);
  const none = await reply(env, AHMED_PHONE, "sr1.801.deadbeef", GOOD);
  assert("a token sent to another number, or one that is not ours: nothing is read from it", other.action === "unknown" && none.action === "unknown" && cardWrites().length === 0 && textsTo(NAKHEEL_PHONE).at(-1) === SV.SUPPLIER_REGISTER_UNKNOWN_TEXT && textsTo(AHMED_PHONE).at(-1) === SV.SUPPLIER_REGISTER_UNKNOWN_TEXT);
  odooDown = "res.partner.write";
  let threw = false;
  try { await reply(env, AHMED_PHONE, token, GOOD); } catch { threw = true; }
  odooDown = "";
  const after = await reply(env, AHMED_PHONE, token, GOOD);
  assert("Odoo refuses the write: nothing is kept, and the same form can be sent again", threw && after.action === "saved" && card(AHMED).vat === VAT_A);
}
{
  const env = world();
  const token = await formTo(env);
  await hook(env, AHMED_PHONE, nfm(token, GOOD));
  assert("through the webhook: the reply is read by the registration form's handler (its token «sr1.»), not as prices", card(AHMED).vat === VAT_A && card(AHMED).x_legal_name === GOOD.legal && card(AHMED).x_cr_number === CR && textsTo(AHMED_PHONE).some((t: string) => t.startsWith("وصل ✅"))
    && /isReceiptFormToken\(msg\.flow\.token \?\? ""\)\) \{[\s\S]{0,700}?isSupplierRegisterToken\(msg\.flow\.token \?\? ""\)\) \{[\s\S]{0,700}?isOrderFormToken\(/.test(srcOf("index.ts")));
}

// ================================================================ ز10
console.log("\n[ز10] the trial to Baraa, its hook, the purposes");
{
  const env = world();
  closeOwnerWindow(env);
  const shut = await quiet(() => SV.sendSupplierRegisterFormTest(env));
  assert("Baraa's window closed: the trial does not go, nothing is held, and the day is not spent", shut.sent === false && shut.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0, JSON.stringify(shut));
  openWindow(env, OWNER);
  const hookEnv = { ...env, ODOO_HOOK_TOKEN: "HOOK" };
  const post = (q: string, e: any = hookEnv) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/supplier-register-form-test${q}`, { method: "POST" }), e, ctx));
  const no = await post(""), wrong = await post("?token=NOPE"), unset = await post("?token=HOOK", env);
  assert("POST /odoo/hook/supplier-register-form-test without the hook's token: 401, nothing sent", no.status === 401 && wrong.status === 401 && unset.status === 401 && graph.filter(Boolean).length === 0);
  const ok = await post("?token=HOOK"), t = await ok.json() as any;
  await settle();
  const f = flowsTo(OWNER)[0], d = dataOf(f);
  assert("with it: ONE message, to Baraa's number alone, marked «🧪 تجربة», under the trial's purpose", ok.status === 200 && t.ok === true && t.sent === true && graph.filter(Boolean).length === 1 && graph.filter(Boolean)[0].to === OWNER && bodyOf(f).startsWith("🧪 تجربة — 📝 تسجيل بيانات المورد")
    && d.t === `🧪 تجربة — تسجيل بيانات المورد — ${SV.SUPPLIER_TRIAL_NAME}` && d.i_legal === SV.SUPPLIER_TRIAL_NAME && (rows("x_wa_message") as any[]).some((r) => purposeOf(r) === "supplier_register_form_test"), JSON.stringify(t));
  const again = await (await post("?token=HOOK")).json() as any;
  assert("a second trial the same day is refused", again.sent === false && again.reason === "already_today" && flowsTo(OWNER).length === 1);
  const token = tokenOf(f);
  const bad = await reply(env, OWNER, token, { ...GOOD, vat: "12" });
  const f2 = flowsTo(OWNER).at(-1);
  assert("the trial refuses as a supplier's form does — a fresh trial form, marked", bad.action === "invalid" && flowsTo(OWNER).length === 2 && bodyOf(f2).startsWith("🧪 تجربة — ⚠️ ما انحفظ شيء من النموذج") && dataOf(f2).t.startsWith("🧪 تجربة — "));
  const before = odooLog.length;
  const r = await reply(env, OWNER, tokenOf(f2), { ...GOOD, iban: IBAN_BAD });
  await settle();
  assert("his «إرسال» is answered with what WOULD have been written", r.action === "test" && bodyOf(sentTo(OWNER).at(-1)) === ["🧪 تجربة — وصل نموذج تسجيل المورد ✅", "لو كان من مورد بلا رقم ضريبي لكُتب على بطاقته:", `• الاسم الرسمي: ${GOOD.legal}`, `• السجل التجاري: ${CR}`,
    `• الرقم الضريبي: ${VAT_A} («مسجّل»، وفواتيره من بعدها عليها 15%)`, `• الآيبان «${IBAN_BAD}» غير صحيح: ما كان سيُحفظ، ولا يُرفض النموذج بسببه.`, "📸 صورة شهادة الضريبة كانت ستُرفق في سجل بطاقته.", "(تجربة: لم يُكتب شيء في Odoo، ولم تصل رسالة لأحد غيرك)"].join("\n"), bodyOf(sentTo(OWNER).at(-1)));
  const writes = odooLog.slice(before).filter((c: any) => !/^(search_read|search|search_count|read|fields_get)$/.test(c.method));
  assert("…and writes NOTHING: no card, no attachment, no note, nothing downloaded or read by Claude — and reaches nobody else", cardWrites().length === 0 && rows("ir.attachment").length === 0 && mediaCalls.length === 0 && claudeCalls.length === 0
    && writes.every((c: any) => c.model === "x_wa_message" || /^discuss\.channel/.test(c.model) || (c.model === "res.partner" && Object.keys(c.body?.vals ?? {}).join() === "x_wa_channel_id")) && graph.filter(Boolean).every((b: any) => b.to === OWNER) && [AHMED, BARAA_CARD].every((id) => !card(id).vat && !card(id).x_legal_name), JSON.stringify(writes.map((c: any) => `${c.model}.${c.method}`)));
  assert("the trial's token is read once too", (await reply(env, OWNER, tokenOf(f2), GOOD)).action === "duplicate");
}
{
  const env = world(); openWindow(env, AHMED_PHONE);
  const toOther = await quiet(() => sendViaGateway(env, { purpose: SV.SUPPLIER_REGISTER_TEST_PURPOSE, to: "+" + AHMED_PHONE, content: { kind: "session", body: { type: "text", text: { body: "x" } } } }));
  const toOwner = await quiet(() => sendViaGateway(env, { purpose: SV.SUPPLIER_REGISTER_PURPOSE, to: "+" + OWNER, content: { kind: "session", body: { type: "text", text: { body: "x" } } } }));
  assert("the purposes: the trial's goes to the owner alone; the supplier's form is never the owner's", gatewayDecision(toOther)?.action !== "session" && toOther.status === 403 && gatewayDecision(toOwner)?.action !== "session" && toOwner.status === 403 && graph.filter(Boolean).length === 0
    && SV.SUPPLIER_REGISTER_PURPOSE === "supplier_register_form" && SV.SUPPLIER_REGISTER_TEST_PURPOSE === "supplier_register_form_test" && PURPOSES.supplier_register_form_test?.kind === "operational");
  const src = srcOf("wa-purposes.ts"), gw = srcOf("wa-gateway.ts");
  assert("they stand beside the suppliers' price-ask purposes, and the trial's right after expense_form_test among the owner's", src.indexOf("supplier_register_form:") > src.indexOf("price_ask_flow:") && src.indexOf("supplier_register_form_test:") < src.indexOf("supplier_payment_sent:") && gw.includes('"expense_form_test", "supplier_register_form_test",'));
  const idx = srcOf("index.ts");
  assert("the trial's hook stands right after the transfer form's, before the webhook", /transfer-form-test"\) \{[\s\S]{0,900}?supplier-register-form-test"\) \{[\s\S]{0,900}?url\.pathname === "\/webhook"/.test(idx));
}

// ================================================================ ز11
console.log("\n[ز11] no price anywhere, no Odoo field outside the schema");
{
  const env = world(); setExtract(INVOICE());
  const l = list({ lines: [AHMED, NAKHEEL, CASH] });
  odooLog.length = 0;
  await onList(env, l, "SVAT_P1");
  claude = "down";
  await onList(env, list({ lines: [NAKHEEL] }), "SVAT_P2");
  const token = await formTo(env);
  await reply(env, AHMED_PHONE, token, { ...GOOD, vat: VAT_B, iban: IBAN_OK });
  await settle();
  const models = [...new Set(odooLog.map((c: any) => c.model))];
  assert("the reading and the form touch the cards, the roster, the company, the list and the attachment — never a price, an order or an invoice", models.every((m) => !/price|pricing|x_daily_order|x_invoice|account\./.test(m)) && models.includes("res.partner") && models.includes("x_purchase_list"), models.join(" "));
  assert("the list's purchase price (77.77) reaches neither Claude nor any message", !JSON.stringify(claudeCalls).includes("77.77") && !JSON.stringify(graph).includes("77.77"));
  const src = srcOf("supplier-vat.ts");
  assert("src/supplier-vat.ts names no price field, and none of its texts says a price", !/x_price_sar|x_unit_price|unit_price|x_market_price|x_sale_price|x_source_price/.test(src) && !/سعر/.test(src.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n")));
  assert("the Flow shows no price either", !/سعر|price/i.test(JSON.stringify(LIB.buildSupplierFlowJson())));
}
assert("every Odoo request of this file names fields and selection values the tenant has (the schema gate)", rejected.length === 0, rejected.join(" | "));

// ================================================================ ز12
console.log("\n[ز12] the guide");
{
  const guide = readFileSync(new URL("../docs/OPERATING-DAY.md", import.meta.url), "utf8");
  const at = guide.indexOf("## الرقم الضريبي للمورد آلياً، ونموذج تسجيل المورد (§ 57)\n");
  const section = at >= 0 ? guide.slice(at, guide.indexOf("\n## ", at + 5)) : "";
  assert("OPERATING-DAY carries the section once, immediately before «## فاتورة الشراء»", at > 0 && guide.split("## الرقم الضريبي للمورد آلياً").length === 2 && guide.slice(at + section.length).startsWith("\n## فاتورة الشراء\n"));
  assert("…the three arrivals, and who is out", /📥 استلام المشتريات/.test(section) && /يرسله المورد نفسه/.test(section) && /مرفق المصروف/.test(section) && /رائد/.test(section) && /بطاقات الفريق/.test(section) && /مشتريات السوق النقدية/.test(section));
  assert("…Baraa's line, word for word, from an invoice and from the form", section.includes("«سجّلنا الرقم الضريبي لـ [المورد]: [الرقم] من فاتورة [رقمها] — فواتيره من الآن عليها 15%»") && section.includes("«سجّلنا الرقم الضريبي لـ [المورد]: [الرقم] من نموذج التسجيل — فواتيره من الآن عليها 15%»"));
  assert("…when an invoice is the supplier's: his own chat, or the seller's name read is his name or his «الاسم الرسمي للمنشأة» — a number with no name is nobody's, and how his first invoice becomes automatic", /\*\*من محادثته هو\*\*: له، بلا فحص اسم/.test(section)
    && section.includes("**رقم مقروء بلا اسم بائع لا يُكتب لأحد**، ولو كان على القائمة مورد واحد.") && section.includes("**أول فاتورة لمورد اسم منشأته غير اسم بطاقته تصل تنبيهاً لا تسجيلاً**")
    && section.includes("املأ «الاسم الرسمي للمنشأة» في بطاقته باسم المنشأة كما في فواتيره — أو ليرسل صورة فاتورته من محادثته هو — فيصير التسجيل آلياً."));
  assert("…the rule, a number never replaced, an invoice that is nobody's", /15 رقماً يبدأ بـ 3 وينتهي بـ 3/.test(section) && /\*\*لا يُستبدل\*\*/.test(section) && /\*\*لا يُكتب شيء\*\*/.test(section));
  assert("…the form once, owed until his first message, never from an expense", /مرة واحدة فقط/.test(section) && /\*\*أول رسالة منه\*\* \(لا قالب\)/.test(section) && /مرفق المصروف لا يُرسل نموذجاً لأحد/.test(section) && /صفّرها ليصله النموذج من جديد/.test(section));
  assert("…the form's fields, what refuses it, the IBAN's check, the trial", /«سجّل بياناتك»/.test(section) && /السجل التجاري \(10 أرقام\)/.test(section) && /\*\*يُرفض النموذج كله\*\*/.test(section) && /SA، 24 خانة، mod 97/.test(section) && /\*\*لا يُحفظ ولا يُرفض النموذج بسببه\*\*/.test(section) && /«🧪 تجربة»/.test(section));
}

done();
