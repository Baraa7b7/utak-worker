// Every outbound WhatsApp message on record — 2026-09-25 (STATUS § 36).
//
//   [0] static: every accepted send goes through recordAccepted; Baraa is no
//       longer left out; the server action is generated from the TS functions.
//   [1] every send path writes an x_wa_message row AND a Discuss line: a direct
//       text, the flush after a hold, a template, the price publication,
//       Baraa's copy, his alerts, the receipt, the collector's / driver's
//       note, and a script run without ctx (cf-live-env trials).
//   [2] the Discuss line failing never stops the row or the send; it is
//       retried by the */5 tick (not within 2 minutes), three times at most,
//       then the row is «failed»; a row Odoo refused is created later.
//   [3] a template as the recipient reads it: variables filled, «🔘 label»
//       lines, a document header, the footer; unsynced → the filled variables
//       under «⚠️ نص القالب غير متزامن», never the name alone.
//   [4] held → the full text under «⏳ محفوظة»; at the flush the SAME message
//       turns «✅ أُرسلت» (the server action); refused edit → a short reply
//       under it; expired and skipped follow the same line.
//   [5] the template's name never reaches Discuss (only x_template_id /
//       x_params / x_debug_payload).
//   [6] utak_update_supplier: chosen for a critical message to a supplier
//       outside the window once it is APPROVED / UTILITY; not while PENDING.
//   [7] schema: every write names real fields and values (§ 36 fixture).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-record.test.mts

import { readFileSync } from "node:fs";
import {
  COLL, COLL_PHONE, CUST, CUST_PHONE, CUST2, CUST2_PHONE, OWNER, closeOwnerWindow, computes, graph, heldFor, openWindow,
  quiet, reset, rows, seed, sentTo, serverActions, setRiyadh, table,
} from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const FX = [
  "./fixtures-odoo-fields-20260924.json", "./fixtures-odoo-fields-20260925-review.json", "./fixtures-odoo-fields-20260925-gateway.json",
  "./fixtures-odoo-fields-20260925-team.json", "./fixtures-odoo-fields-20260925-opener.json", "./fixtures-odoo-fields-20260925-prices.json",
  "./fixtures-odoo-fields-20260925-s36.json",
  "./fixtures-odoo-fields-20260926-s39.json", // § 39 د: x_utak_simulation on the payment, x_wa_message x_res_model / x_res_id
  "./fixtures-odoo-fields-20260926-s40.json", // § 40: the pricing engine (sources, offers, settings, the day's lines)
  "./fixtures-odoo-fields-20260926-s41.json", // § 41: «مسجل في الضريبة» on the sources, x_utak_simulation on the per-day models
].map(load);
const REAL: Record<string, string[]> = Object.assign({}, ...FX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FX.map((f) => f._selections));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if ((model === "res.partner" || model === "product.template") && !f.startsWith("x_")) return true;
  return list.includes(f);
}
/** message_post answered 500 while set (the Discuss line failing). */
let failPosts = 0;
/** x_wa_message.create answered 500 while set (Odoo refusing the row). */
let failRowCreates = 0;
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body) {
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
      return new Response(JSON.stringify({ name: "builtins.ValueError", message: "Invalid" }), { status: 500 });
    }
    if (failPosts > 0 && m[1] === "discuss.channel" && m[2] === "message_post") {
      failPosts--;
      return new Response(JSON.stringify({ name: "odoo.exceptions.AccessError", message: "down" }), { status: 500 });
    }
    if (failRowCreates > 0 && m[1] === "x_wa_message" && m[2] === "create") {
      failRowCreates--;
      return new Response(JSON.stringify({ name: "odoo.exceptions.ValidationError", message: "down" }), { status: 422 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

computes["x_price_day_line"] = (r) => {
  const cost = Number(r.x_cost_price || 0), mg = Number(r.x_margin_pct || 0);
  r.x_sale_price = cost > 0 && mg > 0 ? Math.floor((Math.floor(cost * 100 + 0.5) * (10000 + Math.floor(mg * 100 + 0.5)) + 5000) / 10000) / 100 : 0;
  r.x_excluded = !(mg > 0);
  r.x_blocked = false;
};

const R = await import("../src/wa-record.ts");
const {
  HELD_LINE_ACTION_NAME, STATUS_MARKERS, UNSYNCED_LINE, clearTemplateTextCache, echoHtml, heldLineActionCode, renderTemplateMessage,
  replaceStatusLine, retryPendingRecords, riyadhHHMM, statusLineFor, MAX_ECHO_RETRIES,
} = R;
const { sendViaGateway, gatewayDecision, flushHeld, sweepExpiredHeld } = await import("../src/wa-gateway.ts");
const { readWindow } = await import("../src/wa-window.ts");
const { sendText } = await import("../src/meta.ts");
const { sendTemplateByPurpose, sendOwnerAlert, clearTemplateCache } = await import("../src/templates.ts");
const { confirmPaymentToCustomer } = await import("../src/payment-confirm.ts");
const { recordTeamNote } = await import("../src/team-note.ts");
const { refreshPriceDay, publishPriceDay } = await import("../src/prices.ts");
const { handleWaMessageWebhook } = await import("../src/wa-message-send.ts");
const { sendOpenerForHeld } = await import("../src/wa-opener.ts");

const BOT = 42, OWNERP = 814, SUP = 801, SUP_PHONE = "966500000801";
const CH_CUST = 70, CH_OWNER = 90, CH_SUP = 91, ACTION = 1010;
const TODAY = "2026-09-26";

/** The tenant's server action «UTAK — سطر حالة رسالة واتساب», mirrored from the same TS functions its Python is generated from. */
function lineAction(body: any): unknown {
  let n = 0;
  for (const id of body?.context?.active_ids ?? []) {
    const rec = table("x_wa_message").get(id);
    const mid = Number(rec?.x_echo_message_id || 0);
    const msg = mid ? table("mail.message").get(mid) : undefined;
    if (!rec || !msg || msg.model !== "discuss.channel" || msg.author_id !== BOT || msg.message_type !== "comment") continue;
    if (!table("discuss.channel").get(Number(msg.res_id))?.x_wa_partner_id) continue;
    const line = statusLineFor(String(rec.x_status || ""), riyadhHHMM(rec.x_processed_at as string), String(rec.x_meta_error || ""));
    const nb = line ? replaceStatusLine(String(msg.body), line) : null;
    if (nb === null) continue;
    msg.body = nb;
    n++;
  }
  return { type: "ir.actions.act_window_close", infos: { utak_updated: n } };
}

function fresh(riyadh = "2026-09-26 10:00", o: { supplierOpener?: "APPROVED" | "PENDING"; noAction?: boolean } = {}): any {
  const env = reset(); clearTemplateCache(); clearTemplateTextCache(); setRiyadh(riyadh);
  rejected.length = 0; failPosts = 0; failRowCreates = 0;
  seed("res.partner", { id: BOT, name: "UTAK بوت" });
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  // Baraa's partner and channel, as on the tenant (45 / «واتساب · Bara.a - U TAK · +…4962»)
  seed("res.partner", { id: OWNERP, name: "Bara.a - U TAK", customer_rank: 1, x_whatsapp_number: "+" + OWNER, x_wa_channel_id: CH_OWNER });
  seed("discuss.channel", { id: CH_OWNER, name: "واتساب · Bara.a - U TAK", x_wa_partner_id: OWNERP });
  seed("discuss.channel", { id: CH_CUST, name: "واتساب · مطعم الوادي", x_wa_partner_id: CUST });
  table("res.partner").get(CUST)!.x_wa_channel_id = CH_CUST;
  seed("res.partner", { id: SUP, name: "أحمد حسان", supplier_rank: 5, x_whatsapp_number: "+" + SUP_PHONE, x_contact_class: "supplier", x_wa_channel_id: CH_SUP });
  seed("discuss.channel", { id: CH_SUP, name: "واتساب · أحمد حسان", x_wa_partner_id: SUP });
  if (!o.noAction) {
    seed("ir.actions.server", { id: ACTION, name: HELD_LINE_ACTION_NAME });
    serverActions[ACTION] = lineAction;
  }
  // approved texts, as the sync writes them (x_body_text / x_buttons_text)
  const tpl = (name: string) => rows("x_whatsapp_template").find((r) => r.x_meta_template_id === name)!;
  Object.assign(tpl("utak_order_update"), { x_body_text: "تم تحديث طلبك رقم {{1}}: {{2}}. شكراً لك", x_buttons_text: "" });
  Object.assign(tpl("utak_collection_request"), { x_body_text: "تحصيل اليوم {{1}}: {{2}} ريال من {{3}} ({{4}})", x_buttons_text: "نقد\nتحويل" });
  seed("x_whatsapp_template", { x_purpose: "customer_payment_received", x_meta_template_id: "utak_payment_received", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY",
    x_body_text: "استلمنا دفعتك بمبلغ {{1}} ريال على فاتورة {{2}}. شكراً لك", x_buttons_text: "" });
  seed("x_whatsapp_template", { x_purpose: "customer_invoice_pdf", x_meta_template_id: "utak_invoice_pdf_v1", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY",
    x_body_text: "هلا {{1}} 🌿\nفاتورتك رقم {{2}}\nUTAK | يو تاك", x_buttons_text: "" });
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: "utak_shift_start_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY",
    x_body_text: "مرحباً {{1}}، مهامك في يو تاك لهذا اليوم جاهزة. اضغط زر «بدء الدوام» أدناه لاستلام التفاصيل والمواقع.", x_buttons_text: "بدء الدوام" });
  seed("x_whatsapp_template", { x_purpose: "conv_open_supplier", x_meta_template_id: "utak_update_supplier", x_language: "ar", x_meta_status: o.supplierOpener ?? "PENDING", x_param_count: 2, x_category: "UTILITY",
    x_body_text: "يوجد تحديث على طلب التوريد بتاريخ {{1}}: {{2}}. اضغط «عرض التحديث» للتفاصيل.", x_buttons_text: "عرض التحديث" });
  // utak_delivered (harness) has no x_body_text: «not synced»
  return env;
}
const waRows = () => rows("x_wa_message");
const lastRow = () => waRows()[waRows().length - 1];
const msgs = (channel?: number) => rows("mail.message").filter((m) => !channel || m.res_id === channel);
const plain = (html: unknown) => String(html ?? "").replace(/<br\/>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const waits: Promise<unknown>[] = [];
const ctxW = { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException: () => {} } as any;
const settle = async () => { while (waits.length) await Promise.all(waits.splice(0)); };
/** A row and its Discuss line for `text`: the row on `partner`, «posted», the line in `channel` with the text. */
function onRecord(text: string, partner: number, channel: number): { row: any; msg: any } {
  const row = waRows().find((r) => r.x_direction === "out" && String(r.x_body).includes(text) && r.x_partner_id === partner);
  const msg = row?.x_echo_message_id ? table("mail.message").get(Number(row.x_echo_message_id)) : undefined;
  return { row, msg: msg && msg.res_id === channel && plain(msg.body).includes(text) ? msg : undefined };
}

// ================================================================ 0. static
console.log("\n[0] static: one recording path, Baraa included, the action generated from TS");
{
  const gw = readFileSync(new URL("../src/wa-gateway.ts", import.meta.url), "utf8");
  const calls = gw.match(/await recordAccepted\(env, req, to, body, wamid\);/g) ?? [];
  assert("both accepted branches of dispatchToMeta (sim capture, real send) record the send", calls.length === 2);
  assert("no «owner is never echoed» early return left in the gateway", !/never echoed into Discuss/.test(gw) && !/HANDLED_BY_CALLER/.test(gw));
  assert("the held line is posted for every number (no owner guard around it)", /await echoRowSoon\(env, item\.rowId, to, req\.ctx\);/.test(gw));
  const code = heldLineActionCode();
  assert("server action: the five markers, the status texts of statusLineFor", STATUS_MARKERS.every((m) => code.includes(JSON.stringify(m)))
    && code.includes(JSON.stringify(statusLineFor("expired", "", ""))) && code.includes(JSON.stringify(statusLineFor("held", "", ""))));
  assert("server action: only a bot line of a WhatsApp channel, only the last paragraph", /msg\.author_id != bot/.test(code) && /x_wa_partner_id/.test(code) && /body\.rfind\('<p>'\)/.test(code));
  const idx = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert("the */5 tick runs retryPendingRecords", /retryPendingRecords\(env\)/.test(idx));
  assert("MAX_ECHO_RETRIES = 3", MAX_ECHO_RETRIES === 3);
}

// ================================================================ 1. every path: a row and a line
console.log("\n[1] every send path writes an x_wa_message row and a Discuss line");
{
  // a) a direct text inside the window
  let env = fresh();
  openWindow(env, CUST_PHONE, 5);
  await quiet(() => sendText(env, "+" + CUST_PHONE, "صباح الخير، طلبك في الطريق", { purpose: "customer_delivery_incoming" }));
  let r = onRecord("صباح الخير، طلبك في الطريق", CUST, CH_CUST);
  assert("direct text: row «sent» on the customer, with the wamid", r.row?.x_status === "sent" && String(r.row?.x_meta_message_id).startsWith("wamid.T"), JSON.stringify(r.row));
  assert("direct text: its line in «واتساب · مطعم الوادي», § 28 box, row «posted»", !!r.msg && String(r.msg.body).includes("🤖 آلي") && r.row?.x_echo_status === "posted");

  // b) the flush after a hold
  env = fresh();
  await quiet(() => sendText(env, "+" + CUST_PHONE, "تذكير: طلبك جاهز للتوصيل", { purpose: "customer_delivery_incoming" }));
  const heldRow = lastRow();
  assert("held: row «held» with the full text", heldRow.x_status === "held" && heldRow.x_body === "تذكير: طلبك جاهز للتوصيل");
  openWindow(env, CUST_PHONE, 1);
  await quiet(() => flushHeld(env, CUST_PHONE, { open: true } as any));
  r = onRecord("تذكير: طلبك جاهز للتوصيل", CUST, CH_CUST);
  assert("flush: the same row turns «sent» with its wamid", r.row?.id === heldRow.id && r.row?.x_status === "sent" && !!r.row?.x_meta_message_id);
  assert("flush: its line is the held one (one line for the message)", !!r.msg && msgs(CH_CUST).filter((m) => plain(m.body).includes("تذكير: طلبك جاهز للتوصيل")).length === 1);

  // c) a template
  env = fresh();
  await quiet(() => sendTemplateByPurpose(env, "+" + CUST_PHONE, "customer_order_update", ["UTAK-7", "أضيف صنف"]));
  r = onRecord("تم تحديث طلبك رقم UTAK-7: أضيف صنف. شكراً لك", CUST, CH_CUST);
  assert("template: row = the text as received, kind template", r.row?.x_kind === "template" && r.row?.x_status === "sent", JSON.stringify(waRows().map((x) => x.x_body)));
  assert("template: its line shows the same text, «قالب» box", !!r.msg && String(r.msg.body).includes("🤖 آلي · قالب"));

  // d) + e) + f) the price publication, Baraa's copy, the undecided-exceptions line (§ 40 ج: the engine)
  env = fresh("2026-09-26 05:30");
  table("res.partner").get(SUP)!.x_price_source = true;
  Object.assign(table("product.template").get(1)!, { sale_ok: true, x_is_active_for_sale: true });
  Object.assign(table("product.template").get(2)!, { sale_ok: true, x_is_active_for_sale: true });
  seed("x_pricing_config", { x_name: "cfg", x_is_active: true, x_active_from: "2026-08-29", x_active_to: false, x_waste_pct: 5 });
  seed("x_daily_price", { x_product_tmpl_id: 1, x_packaging_id: 11, x_supplier_id: SUP, x_price_sar: 25, x_date: TODAY, x_extraction_status: "extracted" });
  seed("x_daily_price", { x_product_tmpl_id: 2, x_packaging_id: 21, x_supplier_id: SUP, x_price_sar: 14, x_date: TODAY, x_extraction_status: "extracted" });
  seed("x_price_offer", { x_product_tmpl_id: 1, x_packaging_id: 11, x_source_partner_id: SUP, x_market_price: 30, x_purchase_price: 0, x_date: TODAY, x_status: "valid", x_utak_simulation: false });
  await quiet(() => refreshPriceDay(env));
  const day = rows("x_price_day").find((d) => d.x_date === TODAY)!;
  Object.assign(day, { x_state: "approved", x_approved_by: 2 });
  openWindow(env, CUST_PHONE, 10);
  const pub = await quiet(() => publishPriceDay(env, day.id));
  r = onRecord("• طماطم (كرتون): 30 ر.س", CUST, CH_CUST);
  assert("publication: the customer's list has its row and line", pub.action === "published" && !!r.row && !!r.msg, JSON.stringify(pub));
  r = onRecord("📢 نُشرت أسعار", OWNERP, CH_OWNER);
  assert("Baraa's copy: row on his partner, line in «واتساب · Bara.a - U TAK»", !!r.row && !!r.msg, JSON.stringify(waRows().filter((x) => x.x_partner_id === OWNERP).map((x) => x.x_body)));
  r = onRecord("⏰ لم يُنشر اليوم 1 صنف", OWNERP, CH_OWNER);
  assert("the line (an exception left without a decision): row and line in his channel", !!r.row && !!r.msg);

  // f) an alert, g) the receipt, h) the team note
  env = fresh("2026-09-26 16:00");
  await quiet(() => sendOwnerAlert(env, "⚠️ تنبيه تشغيلي تجريبي"));
  r = onRecord("⚠️ تنبيه تشغيلي تجريبي", OWNERP, CH_OWNER);
  assert("alert: row and line for Baraa", !!r.row && !!r.msg);
  // § 39 د — the receipt through confirmPaymentToCustomer: its row is linked to the payment
  const ro = seed("x_daily_order", { x_customer_id: CUST, x_state: "delivered", x_order_date: TODAY });
  const rinv = seed("x_invoice", { x_invoice_number: "UTAK-INV-20260926-007", x_total: 60, x_status: "issued", x_order_id: ro, x_invoice_date: TODAY });
  const rpay = seed("x_payment", { x_invoice_id: rinv, x_amount: 60, x_method: "cash" });
  await quiet(() => confirmPaymentToCustomer(env, rpay, { receipt: { number: "UTAK-RCPT-20260926-001", url: "https://w.test/r.pdf", method: "نقد" } }));
  r = onRecord("استلمنا دفعتك بمبلغ 60 ريال على فاتورة UTAK-INV-20260926-007. شكراً لك", CUST, CH_CUST);
  assert("receipt (closed window → utak_payment_received): row and line with the template's text", !!r.row && !!r.msg && r.row.x_kind === "template");
  assert("…its row names the payment (x_res_model x_payment, x_res_id)", r.row?.x_res_model === "x_payment" && r.row?.x_res_id === rpay, JSON.stringify([r.row?.x_res_model, r.row?.x_res_id]));
  const o = seed("x_daily_order", { x_customer_id: CUST, x_state: "confirmed", x_order_date: TODAY });
  seed("x_delivery_stop", { x_order_id: o, x_sequence: 1 });
  await quiet(() => recordTeamNote(env, { kind: "delivery", memberName: "عمر المجهلي", orderId: o, text: "الباب مغلق" }));
  r = onRecord("الباب مغلق", OWNERP, CH_OWNER);
  assert("team note to Baraa: row and line", !!r.row && !!r.msg);

  // i) a script run without ctx (scripts/lib/cf-live-env.mjs): awaited, both there when it returns
  env = fresh();
  openWindow(env, CUST_PHONE, 5);
  await quiet(() => sendViaGateway(env, { purpose: "sim_test", to: "+" + CUST_PHONE, content: { kind: "session", body: { type: "text", text: { body: "🧪 تجربة" } } } }));
  r = onRecord("🧪 تجربة", CUST, CH_CUST);
  assert("script path (no ctx): row and line exist when the send returns", !!r.row && !!r.msg && r.row.x_source === "manual");

  // with a ctx: the row is written before the send returns; the line follows in waitUntil
  env = fresh();
  openWindow(env, CUST_PHONE, 5);
  await quiet(() => sendText(env, "+" + CUST_PHONE, "رد عبر الويبهوك", { purpose: "bot_reply", ctx: ctxW }));
  const early = onRecord("رد عبر الويبهوك", CUST, CH_CUST);
  await quiet(settle);
  const late = onRecord("رد عبر الويبهوك", CUST, CH_CUST);
  assert("with ctx: the row exists before waitUntil runs; the line after", !!early.row && !!late.msg);

  // an Odoo manual send (x_wa_message queued) and Baraa's reply from Discuss
  env = fresh();
  openWindow(env, CUST_PHONE, 5);
  const manualId = seed("x_wa_message", { x_partner_id: CUST, x_direction: "out", x_kind: "text", x_body: "رسالة يدوية من Odoo", x_status: "queued", x_manual: true });
  await quiet(() => handleWaMessageWebhook(env, manualId));
  r = onRecord("رسالة يدوية من Odoo", CUST, CH_CUST);
  assert("manual send from Odoo: its own row «sent» and a «📤 يدوي» line", r.row?.id === manualId && r.row?.x_status === "sent" && !!r.msg && String(r.msg.body).includes("📤 يدوي"));
  const before = msgs(CH_CUST).length;
  await quiet(() => sendViaGateway(env, { purpose: "inbox_reply", to: "+" + CUST_PHONE, content: { kind: "session", body: { type: "text", text: { body: "رد براء" } } } }));
  assert("Baraa's Discuss reply: no second line (his message is the line), no gateway row (his route writes it)",
    msgs(CH_CUST).length === before && !waRows().some((x) => x.x_body === "رد براء"));
  assert("no write named a missing field or value", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ 2. the line failing, and its retry
console.log("\n[2] the Discuss line failing: row and send kept, */5 retry ×3, then «failed»");
{
  const env = fresh("2026-09-26 10:00");
  openWindow(env, CUST_PHONE, 5);
  failPosts = 1;
  const resp = await quiet(() => sendText(env, "+" + CUST_PHONE, "نص يفشل صداه", { purpose: "customer_delivery_incoming" }));
  const row = waRows().find((x) => x.x_body === "نص يفشل صداه")!;
  assert("the send went (Meta got it) although the line failed", gatewayDecision(resp)?.action === "session" && sentTo(CUST_PHONE).some((b) => b.text?.body === "نص يفشل صداه"));
  assert("the row is there, «sent», line «pending»", row?.x_status === "sent" && row?.x_echo_status === "pending" && !row?.x_echo_message_id);
  setRiyadh("2026-09-26 10:01");
  let rr = await quiet(() => retryPendingRecords(env));
  assert("within 2 minutes: not retried (the first try may still be running)", rr.echoed === 0 && rr.waiting === 0 && rr.failed === 0, JSON.stringify(rr));
  setRiyadh("2026-09-26 10:05");
  failPosts = 1;
  rr = await quiet(() => retryPendingRecords(env));
  assert("retry 1 fails → still «pending», counted", rr.waiting === 1 && table("x_wa_message").get(row.id)!.x_echo_status === "pending");
  setRiyadh("2026-09-26 10:10");
  rr = await quiet(() => retryPendingRecords(env));
  const after = table("x_wa_message").get(row.id)!;
  assert("retry 2 succeeds → «posted», the line in the channel", rr.echoed === 1 && after.x_echo_status === "posted" && plain(table("mail.message").get(Number(after.x_echo_message_id))?.body).includes("نص يفشل صداه"));
  setRiyadh("2026-09-26 10:15");
  rr = await quiet(() => retryPendingRecords(env));
  assert("a posted row is not retried again", rr.echoed === 0 && msgs(CH_CUST).filter((m) => plain(m.body).includes("نص يفشل صداه")).length === 1);

  const env2 = fresh("2026-09-26 10:00");
  openWindow(env2, CUST_PHONE, 5);
  failPosts = 99;
  await quiet(() => sendText(env2, "+" + CUST_PHONE, "صدى لا يُكتب أبداً", { purpose: "customer_delivery_incoming" }));
  const row2 = waRows().find((x) => x.x_body === "صدى لا يُكتب أبداً")!;
  const outs: any[] = [];
  for (const t of ["10:05", "10:10", "10:15", "10:20"]) { setRiyadh(`2026-09-26 ${t}`); outs.push(await quiet(() => retryPendingRecords(env2))); }
  assert("three failed retries → row «failed», no fourth", outs[0].waiting === 1 && outs[1].waiting === 1 && outs[2].failed === 1 && outs[3].failed === 0 && outs[3].waiting === 0
    && table("x_wa_message").get(row2.id)!.x_echo_status === "failed", JSON.stringify(outs));
  failPosts = 0;

  // Odoo refuses the row itself: kept, created at the next tick with its line
  const env3 = fresh("2026-09-26 10:00");
  openWindow(env3, CUST_PHONE, 5);
  failRowCreates = 1;
  const resp3 = await quiet(() => sendText(env3, "+" + CUST_PHONE, "صف رفضه Odoo", { purpose: "customer_delivery_incoming" }));
  assert("the send is not blocked by a refused row", gatewayDecision(resp3)?.action === "session" && !waRows().some((x) => x.x_body === "صف رفضه Odoo"));
  setRiyadh("2026-09-26 10:05");
  const rr3 = await quiet(() => retryPendingRecords(env3));
  const r3 = onRecord("صف رفضه Odoo", CUST, CH_CUST);
  assert("the */5 tick creates the row and its line (time = the send)", rr3.orphans === 1 && !!r3.row && !!r3.msg && String(r3.row.x_processed_at).endsWith("07:00:00"), JSON.stringify({ rr3, at: r3.row?.x_processed_at }));
}

// ================================================================ 3. a template as the recipient reads it
console.log("\n[3] templates rendered: variables, buttons, header, footer; unsynced");
{
  const t = { id: 1, name: "utak_collection_request", bodyText: "تحصيل اليوم {{1}}: {{2}} ريال من {{3}} ({{4}})", buttonsText: "نقد\nتحويل" };
  const body = { type: "template", template: { name: "utak_collection_request", components: [{ type: "body", parameters: ["26 سبتمبر", "60", "مطعم الوادي", "UTAK-INV-7"].map((x) => ({ type: "text", text: x })) }, { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "p" }] }] } };
  const out = renderTemplateMessage(t, body);
  assert("variables filled in order", out.synced && out.text.startsWith("تحصيل اليوم 26 سبتمبر: 60 ريال من مطعم الوادي (UTAK-INV-7)"), out.text);
  assert("buttons as «🔘 label» lines", out.text.endsWith("🔘 نقد\n🔘 تحويل"), out.text);
  const doc = renderTemplateMessage({ id: 2, name: "utak_invoice_pdf_v1", bodyText: "هلا {{1}} 🌿\nفاتورتك رقم {{2}}\nUTAK | يو تاك", buttonsText: "" },
    { type: "template", template: { name: "utak_invoice_pdf_v1", components: [{ type: "header", parameters: [{ type: "document", document: { filename: "UTAK-INV-7.pdf" } }] }, { type: "body", parameters: [{ type: "text", text: "مطعم الوادي" }, { type: "text", text: "UTAK-INV-7" }] }] } });
  assert("document header → «📎 filename» first; footer kept last", doc.text === "📎 UTAK-INV-7.pdf\nهلا مطعم الوادي 🌿\nفاتورتك رقم UTAK-INV-7\nUTAK | يو تاك", doc.text);
  const un = renderTemplateMessage(null, body);
  assert("unsynced: «⚠️ نص القالب غير متزامن» + the filled variables, no name", un.text === `${UNSYNCED_LINE}\n• 26 سبتمبر\n• 60\n• مطعم الوادي\n• UTAK-INV-7` && !un.text.includes("utak_") && !un.synced, un.text);
  const empty = renderTemplateMessage({ id: 3, name: "x", bodyText: "  ", buttonsText: "" }, body);
  assert("an empty synced text counts as unsynced", !empty.synced && empty.text.startsWith(UNSYNCED_LINE));

  const env = fresh();
  await quiet(() => sendTemplateByPurpose(env, "+" + CUST_PHONE, "customer_delivery_done", ["UTAK-9"]));
  const row = lastRow();
  const msg = table("mail.message").get(Number(row.x_echo_message_id))!;
  assert("unsynced template send: row and line say «غير متزامن» with the variable, not the name",
    String(row.x_body).startsWith(UNSYNCED_LINE) && String(row.x_body).includes("• UTAK-9") && plain(msg.body).includes(UNSYNCED_LINE) && !plain(msg.body).includes("utak_delivered"));
  assert("…and the row knows it (x_debug_payload unsynced, the name there only)", JSON.parse(String(row.x_debug_payload)).unsynced === true && JSON.parse(String(row.x_debug_payload)).template === "utak_delivered");
  await quiet(() => sendTemplateByPurpose(env, "+" + COLL_PHONE, "collection_request", ["26 سبتمبر", "60", "مطعم الوادي", "UTAK-INV-7"], [{ index: 0, payload: "a" }, { index: 1, payload: "b" }]));
  const cr = waRows().find((x) => x.x_partner_id === COLL && x.x_kind === "template")!;
  assert("technical fields: x_template_id = the row, x_params = the variables", cr?.x_template_id === rows("x_whatsapp_template").find((t) => t.x_meta_template_id === "utak_collection_request")!.id
    && cr?.x_params === JSON.stringify(["26 سبتمبر", "60", "مطعم الوادي", "UTAK-INV-7"]), JSON.stringify(cr));
  assert("…the collector's line: the text and «🔘 نقد» «🔘 تحويل»", !!cr && plain(table("mail.message").get(Number(cr.x_echo_message_id))?.body).includes("🔘 نقد\n🔘 تحويل"));
}

// ================================================================ 4. the held line: ⏳ → ✅ / ⌛ / ⏭️
console.log("\n[4] held: the full text under «⏳ محفوظة»; the same line follows its fate");
{
  const env = fresh("2026-09-26 10:00");
  await quiet(() => sendText(env, "+" + CUST_PHONE, "طلبك جاهز", { purpose: "customer_delivery_incoming" }));
  const row = lastRow();
  const heldMsg = table("mail.message").get(Number(row.x_echo_message_id))!;
  assert("held: one line with the full text and «⏳ محفوظة» last", plain(heldMsg.body).includes("طلبك جاهز") && /<p>⏳ محفوظة: [^<]*<\/p>$/.test(String(heldMsg.body)), String(heldMsg.body));
  setRiyadh("2026-09-26 11:40");
  openWindow(env, CUST_PHONE, 1);
  const n = msgs(CH_CUST).length;
  await quiet(async () => flushHeld(env, CUST_PHONE, await readWindow(env, CUST_PHONE)));
  assert("flush: the SAME message now ends «✅ أُرسلت 11:40», no new message", String(table("mail.message").get(heldMsg.id)!.body).endsWith("<p>✅ أُرسلت 11:40</p>") && msgs(CH_CUST).length === n,
    String(table("mail.message").get(heldMsg.id)!.body));
  assert("…the text above it untouched", plain(table("mail.message").get(heldMsg.id)!.body).includes("طلبك جاهز"));

  // Odoo refuses the edit (no action) → a short reply under the same message
  const env2 = fresh("2026-09-26 10:00", { noAction: true });
  await quiet(() => sendText(env2, "+" + CUST_PHONE, "طلبك جاهز ٢", { purpose: "customer_delivery_incoming" }));
  const held2 = table("mail.message").get(Number(lastRow().x_echo_message_id))!;
  setRiyadh("2026-09-26 11:45");
  openWindow(env2, CUST_PHONE, 1);
  await quiet(async () => flushHeld(env2, CUST_PHONE, await readWindow(env2, CUST_PHONE)));
  const reply = msgs(CH_CUST).find((m) => m.parent_id === held2.id);
  assert("edit refused → a reply «✅ أُرسلت 11:45» on the same message; the held line unchanged",
    !!reply && plain(reply.body) === "✅ أُرسلت 11:45" && String(held2.body).includes("⏳ محفوظة"), JSON.stringify(reply));

  // expired: the sweep turns the same line «⌛ انتهت»
  const env3 = fresh("2026-09-26 10:00");
  await quiet(() => sendText(env3, "+" + CUST_PHONE, "ينتهي اليوم", { purpose: "customer_delivery_incoming" }));
  const held3 = table("mail.message").get(Number(lastRow().x_echo_message_id))!;
  setRiyadh("2026-09-27 00:30");
  await quiet(() => sweepExpiredHeld(env3));
  assert("expired: the same line → «⌛ انتهت صلاحيتها ولم تُرسل…»", String(held3.body).endsWith(`<p>${statusLineFor("expired", "", "")}</p>`), String(held3.body));

  // skipped: the number left the allowlist before its flush
  const env4 = fresh("2026-09-26 10:00");
  await quiet(() => sendText(env4, "+" + CUST_PHONE, "ممنوع لاحقاً", { purpose: "customer_delivery_incoming" }));
  const held4 = table("mail.message").get(Number(lastRow().x_echo_message_id))!;
  env4.SIM_ALLOWLIST = "+9999";
  openWindow(env4, CUST_PHONE, 1);
  await quiet(async () => flushHeld(env4, CUST_PHONE, await readWindow(env4, CUST_PHONE)));
  assert("skipped: the same line → «⏭️ لم تُرسل: …» with the reason", /<p>⏭️ لم تُرسل: [^<]+<\/p>$/.test(String(held4.body)), String(held4.body));

  // Baraa: his alert held, then flushed at his tap — his channel too
  const env5 = fresh("2026-09-26 10:00");
  closeOwnerWindow(env5);
  await quiet(() => sendOwnerAlert(env5, "⚠️ تنبيه محفوظ"));
  const ownerRow = waRows().find((x) => x.x_body === "⚠️ تنبيه محفوظ")!;
  const ownerHeld = table("mail.message").get(Number(ownerRow?.x_echo_message_id));
  assert("Baraa's held alert: in his channel with «⏳ محفوظة»", ownerHeld?.res_id === CH_OWNER && String(ownerHeld?.body).includes("⏳ محفوظة"));
  setRiyadh("2026-09-26 10:30");
  openWindow(env5, OWNER, 1);
  await quiet(async () => flushHeld(env5, OWNER, await readWindow(env5, OWNER)));
  assert("…at his tap: the same line «✅ أُرسلت 10:30»", String(ownerHeld?.body).endsWith("<p>✅ أُرسلت 10:30</p>"));

  const e = echoHtml("نص", { backfilled: true, template: true });
  assert("a backfilled line says «مستكمل» (and «قالب»)", e.includes("🤖 آلي · قالب · مستكمل"));
  assert("replaceStatusLine leaves a message without a status line alone", replaceStatusLine("<p style=\"x\"><strong>🤖 آلي</strong><br/>نص</p>", "✅ أُرسلت") === null);
}

// ================================================================ 5. the template's name never in Discuss
console.log("\n[5] the template's name stays in the technical fields");
{
  const env = fresh("2026-09-26 06:00");
  await quiet(() => sendTemplateByPurpose(env, "+" + CUST_PHONE, "customer_order_update", ["UTAK-8", "تغيير الكمية"]));
  await quiet(() => sendTemplateByPurpose(env, "+" + COLL_PHONE, "collection_request", ["26 سبتمبر", "60", "مطعم الوادي", "UTAK-INV-7"]));
  await quiet(() => sendTemplateByPurpose(env, "+" + OWNER, "team_shift_start", ["براء"], [{ index: 0, payload: "shift_start" }], undefined, { sendPurpose: "owner_window" }));
  await quiet(() => sendTemplateByPurpose(env, "+" + CUST_PHONE, "customer_delivery_done", ["UTAK-8"]));
  const all = msgs().map((m) => String(m.body)).join("\n");
  assert("no «utak_» in any Discuss message", !/utak_/i.test(all), all.match(/utak_[a-z0-9_]+/i)?.[0] ?? "");
  assert("no «📋 قالب:» label either", !all.includes("📋 قالب"));
  const own = onRecord("مرحباً براء، مهامك في يو تاك", OWNERP, CH_OWNER);
  assert("Baraa's 06:00 template: its text and «🔘 بدء الدوام» in his channel", !!own.msg && plain(own.msg.body).includes("🔘 بدء الدوام"));
  assert("the names are in x_debug_payload of the four rows", ["utak_order_update", "utak_collection_request", "utak_shift_start_v2", "utak_delivered"]
    .every((n) => waRows().some((r) => JSON.parse(String(r.x_debug_payload || "{}")).template === n && !String(r.x_body).includes(n))));
}

// ================================================================ 6. utak_update_supplier
console.log("\n[6] utak_update_supplier: used once APPROVED / UTILITY");
{
  const env = fresh("2026-09-26 12:00", { supplierOpener: "APPROVED" });
  const resp = await quiet(() => sendText(env, "+" + SUP_PHONE, "🧾 فاتورة توريد", { purpose: "customer_invoice" }));
  const o = sentTo(SUP_PHONE).filter((b) => b.template?.name === "utak_update_supplier");
  assert("critical message to a supplier outside the window: held + utak_update_supplier [date, update]",
    gatewayDecision(resp)?.action === "held" && o.length === 1 && o[0].template.components[0].parameters.map((p: any) => p.text).join("|") === "26 سبتمبر 2026|فاتورة جديدة",
    JSON.stringify(sentTo(SUP_PHONE)));
  const r = onRecord("يوجد تحديث على طلب التوريد بتاريخ 26 سبتمبر 2026: فاتورة جديدة", SUP, CH_SUP);
  assert("…its row and line show the text and «🔘 عرض التحديث»", !!r.row && !!r.msg && plain(r.msg.body).includes("🔘 عرض التحديث"));
  const env2 = fresh("2026-09-26 12:00", { supplierOpener: "PENDING" });
  const res2 = await quiet(() => sendOpenerForHeld(env2, SUP_PHONE, "customer_invoice"));
  assert("PENDING (as at Meta today): not sent, the message stays held", res2.outcome === "unusable" && sentTo(SUP_PHONE).length === 0, JSON.stringify(res2));
}

// ================================================================ 7. schema
console.log("\n[7] schema");
assert("every Odoo write in this file named real fields and values", rejected.length === 0, rejected.join(" | "));

console.log(`\n${passed} ✓  ${failed} ✗`);
if (failed) { console.log("failed:", failures.join(" · ")); process.exit(1); }
