// «فتح المحادثة» and the missing purposes — 2026-09-25 (STATUS § 34).
//
//   [0] policy: the critical («مهمة») purposes are exactly Baraa's list; each
//       has a two-or-three-word update; the four opener purposes and templates;
//       the owner guard lets conv_open_owner and owner_team_note through.
//   [1] the template follows the category: customer / team / supplier / owner,
//       with its params and the «عرض التحديث» payload.
//   [2] at most once per number and Riyadh day (two holds, a race, the next
//       day, another number).
//   [3] the tap flushes everything held, in order, as text; nothing held → one
//       line; Baraa → his «✅ تم» after the flush; any message flushes too.
//   [4] no opener to an archived, «شخصي», opted-out (§ 23) or review-held
//       number — the message is still held.
//   [5] an unusable template (MARKETING, REJECTED, PENDING) or one Meta refuses
//       leaves the messages held; no resubmission, no second try that day;
//       PENDING frees the day for a later approval.
//   [6] a non-critical purpose keeps § 33: held, no opener.
//   [7] Baraa: utak_owner_alert never; alerts held + utak_update_owner once a
//       day; not in the half hour before 06:00; the 06:00 message keeps
//       utak_shift_start_v2, utak_update_owner only as its backup.
//   [8] the receipt: text inside the window, utak_payment_received [amount,
//       invoice] outside it; the ack is not held; the receipt held + opener
//       when its template cannot go.
//   [9] the collector's / driver's notes reach Baraa as critical messages with
//       the customer and the order, and are kept in Odoo.
//   [10] schema: every Odoo read / write names real fields and selection values.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-opener.test.mts

import { readFileSync } from "node:fs";
import {
  CUST, CUST_PHONE, CUST2_PHONE, COLL, COLL_PHONE, OWNER, closeOwnerWindow, ctx, employee, graph, heldFor, inbound,
  openWindow, order, quiet, reset, rows, seed, sentTo, setFail, setRiyadh, signed, table,
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
  "./fixtures-odoo-fields-20260924.json", "./fixtures-odoo-fields-20260925-review.json",
  "./fixtures-odoo-fields-20260925-gateway.json", "./fixtures-odoo-fields-20260925-team.json",
  "./fixtures-odoo-fields-20260925-opener.json",
].map(load);
const REAL: Record<string, string[]> = Object.assign({}, ...FX);
const SELECTIONS: Record<string, string[]> = Object.assign({}, ...FX.map((f) => f._selections));
const rejected: string[] = [];
function known(model: string, name: string): boolean {
  const list = REAL[model];
  const f = name.split(".")[0];
  if (!list || f === "id") return true;
  if (model === "res.partner" && !f.startsWith("x_")) return true;
  return list.includes(f);
}
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
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const { gatewayDecision, sendViaGateway } = await import("../src/wa-gateway.ts");
const { sendText } = await import("../src/meta.ts");
const { sendOwnerAlert, clearTemplateCache, T } = await import("../src/templates.ts");
const { PURPOSES, purposePolicy } = await import("../src/wa-purposes.ts");
const op = await import("../src/wa-opener.ts");
const { OPEN_PAYLOAD, OPEN_NOTHING_TEXT, OPENER_TEMPLATE, OPENER_PURPOSE, sendOpenerForHeld, openerDayKey, openerCoolKey, recipientCategory } = op;
const { sendReceiptToCustomer } = await import("../src/receipt.ts");
const { runAttendanceTick, ownerWindowAck, OWNER_OPENER_UPDATE } = await import("../src/attendance.ts");
const { recordTeamNote, COLLECT_NOTE_PROMPT, TEAM_NOTE_ACK } = await import("../src/team-note.ts");
const { OPENER_TEMPLATES, OPEN_BUTTON_TEXT } = await import("../scripts/s34-20260925-opener-templates.mjs");
const worker = (await import("../src/index.ts")).default;

const SUP = 701, SUP_PHONE = "966500000701";
const DRV = 603, DRV_PHONE = "966500000603";
const ARCH = 711, ARCH_PHONE = "966500000711";
const PERS = 712, PERS_PHONE = "966500000712";
const OPT = 713, OPT_PHONE = "966500000713";
const REV = 714, REV_PHONE = "966500000714";
const PSUP = 715, PSUP_PHONE = "966500000715";

/** A fresh world: the four opener rows as the test needs them (default APPROVED/UTILITY). */
function fresh(riyadh: string, cats: Partial<Record<string, { status?: string; category?: string }>> = {}): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  rejected.length = 0;
  seed("res.partner", { id: 42, name: "UTAK بوت" });
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  seed("res.partner", { id: SUP, name: "أحمد حسان", supplier_rank: 5, x_whatsapp_number: "+" + SUP_PHONE, x_contact_class: "supplier" });
  seed("res.partner", { id: DRV, name: "عمر المجهلي", x_whatsapp_number: "+" + DRV_PHONE });
  employee(DRV, [72]);
  seed("res.partner", { id: ARCH, name: "مؤرشف", x_whatsapp_number: "+" + ARCH_PHONE, customer_rank: 1, active: false });
  seed("res.partner", { id: PERS, name: "شخصي", x_whatsapp_number: "+" + PERS_PHONE, customer_rank: 1, x_contact_class: "personal" });
  seed("res.partner", { id: OPT, name: "موقوف", x_whatsapp_number: "+" + OPT_PHONE, customer_rank: 1, x_contact_class: "customer", x_wa_marketing_optout: true });
  seed("res.partner", { id: REV, name: "رقم غلط", x_whatsapp_number: "+" + REV_PHONE, customer_rank: 1, x_contact_class: "unreviewed", x_review_pending: true, x_ai_intent: "wrong_number" });
  // Baraa classified «شخصي» a number that once supplied (supplier_rank kept)
  seed("res.partner", { id: PSUP, name: "قريب كان يورّد", x_whatsapp_number: "+" + PSUP_PHONE, supplier_rank: 1, x_contact_class: "personal" });
  for (const [cat, name] of Object.entries(OPENER_TEMPLATE)) {
    const o = cats[cat] ?? {};
    seed("x_whatsapp_template", {
      x_purpose: (OPENER_PURPOSE as any)[cat], x_meta_template_id: name, x_language: "ar",
      x_meta_status: o.status ?? "APPROVED", x_param_count: 2, x_category: o.category ?? "UTILITY",
    });
  }
  seed("x_whatsapp_template", { x_purpose: "customer_payment_received", x_meta_template_id: "utak_payment_received", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  return env;
}
const tpl = (to: string, name?: string) => sentTo(to).filter((b) => b.type === "template" && (!name || b.template?.name === name));
const txt = (to: string) => sentTo(to).filter((b) => b.type === "text").map((b) => String(b.text?.body ?? ""));
const params = (b: any) => (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
const payloads = (b: any) => (b?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => c.parameters?.[0]?.payload);
const openers = (to?: string) => graph.filter((b) => b?.type === "template" && Object.values(OPENER_TEMPLATE).includes(b.template?.name) && (!to || b.to === to));
const hold = (env: any, to: string, purpose: string, text: string) => quiet(() => sendText(env, to, text, { purpose }));
const tap = (env: any, from: string) => quiet(() => worker.fetch(signed(inbound(from, { type: "button", button: { payload: OPEN_PAYLOAD, text: OPEN_BUTTON_TEXT } })), env, ctx));
const say = (env: any, from: string, text: string) => quiet(() => worker.fetch(signed(inbound(from, { type: "text", text: { body: text } })), env, ctx));
const button = (env: any, from: string, id: string, title = "x") => quiet(() => worker.fetch(signed(inbound(from, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } })), env, ctx));

// ================================================================ 0. policy
console.log("\n[0] critical purposes, openers, owner guard");
{
  const critical = Object.entries(PURPOSES).filter(([, p]) => p.critical).map(([k]) => k).sort();
  const expected = [
    "customer_invoice", "customer_invoice_pdf", "customer_order_confirm", "customer_order_remind", "customer_order_update",
    "customer_payment_received", "customer_receipt", "owner_alert", "owner_team_note",
    ...(PURPOSES.customer_prices ? ["customer_prices", "owner_prices"] : []),
  ].sort();
  assert("critical = Baraa's list (prices, receipt, his alerts, team notes, order confirm/change, invoices)", critical.join() === expected.join(), critical.join());
  assert("every critical purpose has a 2–3 word update", critical.every((k) => { const w = String(PURPOSES[k].update ?? "").trim().split(/\s+/); return w.length >= 2 && w.length <= 3; }),
    critical.map((k) => `${k}=${PURPOSES[k].update}`).join(" | "));
  assert("the rest keeps § 33 (e.g. purchase_list, collection_request, supplier_ask not critical)", !PURPOSES.purchase_list.critical && !PURPOSES.collection_request.critical && !PURPOSES.supplier_ask.critical && !PURPOSES.bot_reply.critical);
  assert("§ 33's importance unchanged on its purposes", PURPOSES.purchase_list.important && PURPOSES.customer_receipt.important && !PURPOSES.owner_alert.important);
  for (const [cat, purpose] of Object.entries(OPENER_PURPOSE)) {
    assert(`opener purpose ${purpose} known, not critical`, !!purposePolicy(purpose) && !purposePolicy(purpose)!.critical);
    const spec = OPENER_TEMPLATES.find((t: any) => t.category === cat);
    assert(`${cat}: template ${(OPENER_TEMPLATE as any)[cat]} = the script's, 2 variables, «عرض التحديث»`,
      spec?.name === (OPENER_TEMPLATE as any)[cat] && spec?.purpose === purpose && (spec.body.match(/\{\{\d\}\}/g) ?? []).join() === "{{1}},{{2}}" && spec.body.includes("«عرض التحديث»") && OPEN_BUTTON_TEXT === "عرض التحديث");
  }
  assert("T knows the new purposes", T.CUSTOMER_PAYMENT_RECEIVED === "customer_payment_received" && T.OWNER_TEAM_NOTE === "owner_team_note" && T.CONV_OPEN_OWNER === "conv_open_owner");
  const env = fresh("2026-09-26 12:00");
  closeOwnerWindow(env);
  const r1 = await quiet(() => sendViaGateway(env, { purpose: "conv_open_owner", to: OWNER, content: { kind: "template", purpose: "conv_open_owner", params: ["x", "y"] } }));
  const r2 = await quiet(() => sendViaGateway(env, { purpose: "owner_team_note", to: OWNER, content: { kind: "session", body: { type: "text", text: { body: "n" } } } }));
  assert("owner guard lets conv_open_owner and owner_team_note through", gatewayDecision(r1)?.action === "template" && gatewayDecision(r2)?.action === "held",
    `${JSON.stringify(gatewayDecision(r1))} ${JSON.stringify(gatewayDecision(r2))}`);
  const r3 = await quiet(() => sendViaGateway(env, { purpose: "conv_open_customer", to: OWNER, content: { kind: "template", purpose: "conv_open_customer", params: ["x", "y"] } }));
  assert("…and still blocks a customer opener to Baraa", gatewayDecision(r3)?.action === "refused");
}

// ================================================================ 1. category → template
console.log("\n[1] the template follows the category");
{
  const env = fresh("2026-09-26 10:00");
  await hold(env, CUST_PHONE, "customer_invoice", "🧾 فاتورتك رقم UTAK-INV-7");
  const c = tpl(CUST_PHONE, "utak_update_customer");
  assert("customer → utak_update_customer", c.length === 1, JSON.stringify(sentTo(CUST_PHONE).map((b) => b.template?.name ?? b.type)));
  assert("customer: [account number, «فاتورة جديدة»]", params(c[0]).join("|") === `${CUST}|فاتورة جديدة`, JSON.stringify(params(c[0])));
  assert("customer: button 0 payload wa_update_open", payloads(c[0]).join() === OPEN_PAYLOAD);
  assert("customer: the invoice text is held", heldFor(env, CUST_PHONE).some((i) => i.purpose === "customer_invoice"));
  assert("the opener is logged in x_wa_message (a sent template row)", rows("x_wa_message").some((r) => r.x_status === "sent" && String(r.x_body).includes("utak_update_customer")),
    JSON.stringify(rows("x_wa_message").map((r) => [r.x_status, r.x_body])));

  const t = await quiet(() => sendOpenerForHeld(env, COLL_PHONE, "owner_team_note"));
  const tb = tpl(COLL_PHONE, "utak_update_team")[0];
  assert("team → utak_update_team [shift date, update]", t.outcome === "sent" && params(tb).join("|") === "26 سبتمبر 2026|ملاحظة من الفريق", `${t.outcome} ${JSON.stringify(params(tb))}`);
  const s = await quiet(() => sendOpenerForHeld(env, SUP_PHONE, "customer_order_update"));
  const sb = tpl(SUP_PHONE, "utak_update_supplier")[0];
  assert("supplier → utak_update_supplier [date, update]", s.outcome === "sent" && params(sb).join("|") === "26 سبتمبر 2026|تعديل الطلب", `${s.outcome} ${JSON.stringify(params(sb))}`);
  closeOwnerWindow(env);
  await quiet(() => sendOwnerAlert(env, "⚠️ تنبيه تجريبي"));
  const ob = tpl(OWNER, "utak_update_owner")[0];
  assert("owner → utak_update_owner [date, «تنبيه تشغيلي»]", params(ob).join("|") === "26 سبتمبر 2026|تنبيه تشغيلي", JSON.stringify(sentTo(OWNER)));
  assert("owner: the opener is logged in x_wa_message too", rows("x_wa_message").some((r) => String(r.x_body).includes("utak_update_owner") && r.x_status === "sent"));
  const cat = await quiet(() => recipientCategory(env, "966500000510"));
  assert("an unknown number has no category (no opener)", cat.category === null, JSON.stringify(cat));
}

// ================================================================ 2. once a day
console.log("\n[2] at most once per number and Riyadh day");
{
  const env = fresh("2026-09-26 09:00");
  await hold(env, CUST_PHONE, "customer_invoice", "فاتورة 1");
  setRiyadh("2026-09-26 15:00");
  await hold(env, CUST_PHONE, "customer_receipt", "إيصال 1");
  setRiyadh("2026-09-26 23:50");
  await hold(env, CUST_PHONE, "customer_order_update", "تعديل الطلب");
  assert("three critical messages in one day → one opener", openers(CUST_PHONE).length === 1, String(openers(CUST_PHONE).length));
  assert("…and all three held", heldFor(env, CUST_PHONE).length === 3, JSON.stringify(heldFor(env, CUST_PHONE).map((i) => i.purpose)));
  await hold(env, CUST2_PHONE, "customer_invoice", "فاتورة 2");
  assert("another number the same day gets its own", openers(CUST2_PHONE).length === 1);
  setRiyadh("2026-09-27 00:10");
  await hold(env, CUST_PHONE, "customer_invoice", "فاتورة 3");
  assert("the next Riyadh day → one more", openers(CUST_PHONE).length === 2);

  const env2 = fresh("2026-09-26 11:00");
  const [a, b] = await Promise.all([
    sendOpenerForHeld(env2, CUST_PHONE, "customer_invoice"),
    sendOpenerForHeld(env2, CUST_PHONE, "customer_receipt"),
  ]);
  assert("two holds racing → one opener", openers(CUST_PHONE).length === 1 && [a.outcome, b.outcome].sort().join() === "already_today,sent", `${a.outcome} ${b.outcome}`);
  assert("the day key is the Riyadh date", !!env2.MSG_DEDUP.store.get(openerDayKey(CUST_PHONE)) && openerDayKey(CUST_PHONE).includes("2026-09-26"));
}

// ================================================================ 3. the tap flushes
console.log("\n[3] «عرض التحديث» flushes everything held, in order");
{
  const env = fresh("2026-09-26 10:00");
  await hold(env, CUST_PHONE, "customer_invoice", "أولاً: الفاتورة");
  await hold(env, CUST_PHONE, "customer_payment_ack", "ثانياً: غير مهمة");
  await hold(env, CUST_PHONE, "customer_receipt", "ثالثاً: الإيصال");
  const before = graph.length;
  setRiyadh("2026-09-26 10:30");
  await tap(env, CUST_PHONE);
  const after = graph.slice(before).filter((b) => b.to === CUST_PHONE).map((b) => b.type === "text" ? b.text.body : `[${b.type}]`);
  assert("the three held messages go out as text, oldest first", after.join(" / ") === "أولاً: الفاتورة / ثانياً: غير مهمة / ثالثاً: الإيصال", after.join(" / "));
  assert("…and nothing else (no «ما فيه تحديث» after a flush)", !after.includes(OPEN_NOTHING_TEXT));
  assert("the queue is empty", heldFor(env, CUST_PHONE).length === 0);
  assert("their rows turned «sent»", rows("x_wa_message").filter((r) => ["أولاً: الفاتورة", "ثانياً: غير مهمة", "ثالثاً: الإيصال"].includes(String(r.x_body))).every((r) => r.x_status === "sent"),
    JSON.stringify(rows("x_wa_message").map((r) => [r.x_body, r.x_status])));
  const again = graph.length;
  await tap(env, CUST_PHONE);
  const second = graph.slice(again).filter((b) => b.to === CUST_PHONE);
  assert("a second tap with nothing held → one line", second.length === 1 && second[0].text?.body === OPEN_NOTHING_TEXT, JSON.stringify(second));

  const env2 = fresh("2026-09-26 10:00");
  await hold(env2, CUST_PHONE, "customer_invoice", "فاتورة محفوظة");
  setRiyadh("2026-09-26 13:00");
  await say(env2, CUST_PHONE, "مرحبا");
  assert("any message from the number flushes too (§ 33 unchanged)", txt(CUST_PHONE).includes("فاتورة محفوظة"));

  const env3 = fresh("2026-09-26 12:00");
  closeOwnerWindow(env3);
  await quiet(() => sendOwnerAlert(env3, "تنبيه 1"));
  await quiet(() => sendOwnerAlert(env3, "تنبيه 2"));
  assert("Baraa: two alerts held, one opener", heldFor(env3, OWNER).length === 2 && openers(OWNER).length === 1);
  const b0 = graph.length;
  setRiyadh("2026-09-26 12:05");
  await tap(env3, OWNER);
  const got = graph.slice(b0).filter((b) => b.to === OWNER).map((b) => b.text?.body ?? `[${b.type}]`);
  assert("Baraa's tap: the alerts in order, then «✅ تم»", got.length === 3 && got[0] === "تنبيه 1" && got[1] === "تنبيه 2" && got[2] === ownerWindowAck(), JSON.stringify(got));
}

// ================================================================ 4. who never gets an opener
console.log("\n[4] archived / personal / opted out / under review: no opener, still held");
{
  for (const [label, phone] of [["archived", ARCH_PHONE], ["«شخصي»", PERS_PHONE], ["«شخصي» with a supplier rank", PSUP_PHONE], ["opted out (§ 23)", OPT_PHONE], ["review hold (wrong number)", REV_PHONE]] as const) {
    const env = fresh("2026-09-26 10:00");
    await hold(env, phone, "customer_invoice", "فاتورة");
    const r = await quiet(() => sendOpenerForHeld(env, phone, "customer_receipt"));
    assert(`${label}: no opener`, openers(phone).length === 0 && r.outcome === "no_category", `${r.outcome} ${r.detail}`);
    assert(`${label}: the message itself is held (for the number's own next message)`, heldFor(env, phone).length === 1);
  }
}

// ================================================================ 5. unusable or refused
console.log("\n[5] an unusable or refused template: messages stay held, no second try");
{
  for (const [label, o] of [["MARKETING (as Meta filed team / owner)", { category: "MARKETING" }], ["REJECTED", { status: "REJECTED" }]] as const) {
    const env = fresh("2026-09-26 10:00", { customer: o as any });
    await hold(env, CUST_PHONE, "customer_invoice", "فاتورة");
    assert(`${label}: no opener sent`, openers(CUST_PHONE).length === 0, JSON.stringify(openers(CUST_PHONE)));
    assert(`${label}: the invoice stays held`, heldFor(env, CUST_PHONE).length === 1);
    assert(`${label}: the attempt is logged «skipped» with the reason`, rows("x_wa_message").some((r) => r.x_status === "skipped" && /MARKETING|REJECTED/.test(String(r.x_meta_error))),
      JSON.stringify(rows("x_wa_message").map((r) => [r.x_status, r.x_meta_error])));
    const skippedRows = rows("x_wa_message").filter((r) => r.x_status === "skipped").length;
    env.MSG_DEDUP.store.delete(openerCoolKey(CUST_PHONE)); // hours later: no cool-down left
    setRiyadh("2026-09-26 18:00");
    await hold(env, CUST_PHONE, "customer_receipt", "إيصال");
    assert(`${label}: final → the day's one attempt is spent (no new row, no send)`, rows("x_wa_message").filter((r) => r.x_status === "skipped").length === skippedRows && openers(CUST_PHONE).length === 0);
  }
  {
    const env = fresh("2026-09-26 10:00", { customer: { status: "PENDING" } });
    await hold(env, CUST_PHONE, "customer_invoice", "فاتورة");
    assert("PENDING: no opener, the day freed, an hour's cool-down", openers(CUST_PHONE).length === 0 && !env.MSG_DEDUP.store.get(openerDayKey(CUST_PHONE)) && !!env.MSG_DEDUP.store.get(openerCoolKey(CUST_PHONE)));
    await hold(env, CUST_PHONE, "customer_receipt", "إيصال");
    assert("PENDING: within the hour, no second attempt", rows("x_wa_message").filter((r) => r.x_status === "skipped").length === 1);
    for (const r of rows("x_whatsapp_template")) if (r.x_meta_template_id === "utak_update_customer") r.x_meta_status = "APPROVED";
    clearTemplateCache();
    env.MSG_DEDUP.store.delete(openerCoolKey(CUST_PHONE)); // the hour passed
    setRiyadh("2026-09-26 11:30");
    await hold(env, CUST_PHONE, "customer_order_update", "تعديل");
    assert("…approved later the same day → the opener goes", openers(CUST_PHONE).length === 1);
  }
  {
    const env = fresh("2026-09-26 10:00");
    setFail({ utak_update_customer: 131026 });
    await hold(env, CUST_PHONE, "customer_invoice", "فاتورة");
    const n = graph.filter((b) => b.template?.name === "utak_update_customer").length;
    setFail({});
    setRiyadh("2026-09-26 16:00");
    await hold(env, CUST_PHONE, "customer_receipt", "إيصال");
    assert("Meta refused the opener → no second try that day", n === 1 && graph.filter((b) => b.template?.name === "utak_update_customer").length === 1);
    assert("…not even an attempt (no «skipped» opener row)", !rows("x_wa_message").some((r) => r.x_status === "skipped"), JSON.stringify(rows("x_wa_message").map((r) => [r.x_status, r.x_meta_error])));
    assert("…and the messages stay held", heldFor(env, CUST_PHONE).length === 2);
  }
}

// ================================================================ 6. non-critical
console.log("\n[6] a non-critical purpose keeps § 33: held, no opener");
{
  const env = fresh("2026-09-26 19:00");
  await hold(env, COLL_PHONE, "collection_nothing", "لا توجد فواتير معلّقة");
  await hold(env, CUST_PHONE, "customer_payment_ack", "تم استلام الدفعة");
  assert("collection_nothing / customer_payment_ack held, no opener", heldFor(env, COLL_PHONE).length === 1 && heldFor(env, CUST_PHONE).length === 1 && openers().length === 0);
}

// ================================================================ 7. Baraa
console.log("\n[7] Baraa: no utak_owner_alert; utak_update_owner once a day; 06:00 backup only");
{
  const env = fresh("2026-09-26 14:00");
  closeOwnerWindow(env);
  seed("x_whatsapp_template", { x_purpose: "owner_alert", x_meta_template_id: "utak_owner_alert_v3", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  clearTemplateCache();
  await quiet(() => sendOwnerAlert(env, "تنبيه"));
  assert("no owner_alert template, even a UTILITY one mapped", !sentTo(OWNER).some((b) => /utak_owner_alert/.test(String(b.template?.name))) && heldFor(env, OWNER).length === 1);
  assert("…utak_update_owner instead", openers(OWNER).length === 1);

  const env2 = fresh("2026-09-26 05:40");
  closeOwnerWindow(env2);
  await quiet(() => sendOwnerAlert(env2, "قبل السادسة"));
  assert("05:40 (the 06:00 message is due): no opener, the alert held", openers(OWNER).length === 0 && heldFor(env2, OWNER).length === 1);
  setRiyadh("2026-09-26 05:20");
  await quiet(() => sendOwnerAlert(env2, "قبل السادسة بأربعين"));
  assert("05:20: the opener goes", openers(OWNER).length === 1);

  // The 06:00 message: utak_shift_start_v2 when it can go …
  const env3 = fresh("2026-09-26 06:00");
  closeOwnerWindow(env3);
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: "utak_shift_start_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  clearTemplateCache();
  const r3 = await quiet(() => runAttendanceTick(env3, Date.now()));
  assert("06:00: utak_shift_start_v2, not the backup", tpl(OWNER, "utak_shift_start_v2").length === 1 && openers(OWNER).length === 0, JSON.stringify(r3.owner ?? r3));
  // … utak_update_owner only when it cannot
  const env4 = fresh("2026-09-26 06:00");
  closeOwnerWindow(env4);
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: "utak_shift_start_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "MARKETING" });
  clearTemplateCache();
  await quiet(() => runAttendanceTick(env4, Date.now()));
  const bk = tpl(OWNER, "utak_update_owner");
  assert("06:00 with utak_shift_start_v2 unusable → utak_update_owner [date, «تنبيهات اليوم»]", bk.length === 1 && params(bk[0]).join("|") === `26 سبتمبر 2026|${OWNER_OPENER_UPDATE}`, JSON.stringify(sentTo(OWNER)));
  setRiyadh("2026-09-26 09:00");
  await quiet(() => sendOwnerAlert(env4, "بعدها"));
  assert("…that counts as today's opener (an alert later: held, no second)", openers(OWNER).length === 1 && heldFor(env4, OWNER).length === 1);
  const env5 = fresh("2026-09-26 06:00", { owner: { category: "MARKETING" } });
  closeOwnerWindow(env5);
  await quiet(() => runAttendanceTick(env5, Date.now()));
  assert("06:00 with both unusable (as at Meta: owner opener MARKETING) → nothing sent", sentTo(OWNER).length === 0);
}

// ================================================================ 8. the receipt
console.log("\n[8] the receipt: utak_payment_received outside the window");
{
  const data = {
    receiptNumber: "UTAK-RCPT-20260926-001", receiptDate: new Date(), customer: { name: "مطعم الوادي", address: "-", phone: "+" + CUST_PHONE },
    payments: [{ invoiceNumber: "UTAK-INV-20260926-007", invoiceDate: "2026-09-26", amount: 60, method: "نقد" }], totalReceived: 60,
  };
  const env = fresh("2026-09-26 16:00");
  const r = await quiet(() => sendReceiptToCustomer(env, CUST_PHONE, data as any, "https://w.test/r.pdf"));
  const t = tpl(CUST_PHONE, "utak_payment_received");
  assert("closed window → utak_payment_received, sent directly", gatewayDecision(r)?.action === "template" && t.length === 1);
  assert("…[amount, invoice number]", params(t[0]).join("|") === "60|UTAK-INV-20260926-007", JSON.stringify(params(t[0])));
  assert("…nothing held, no opener", heldFor(env, CUST_PHONE).length === 0 && openers().length === 0);
  assert("amount with halalas: «60.5»→«60.50»", (await import("../src/receipt.ts")).receiptAmountLabel(60.5) === "60.50");

  const env2 = fresh("2026-09-26 16:00");
  openWindow(env2, CUST_PHONE, 5);
  await quiet(() => sendReceiptToCustomer(env2, CUST_PHONE, data as any, "https://w.test/r.pdf"));
  assert("open window → the receipt text with its link", txt(CUST_PHONE).some((x) => x.includes("UTAK-RCPT-20260926-001") && x.includes("https://w.test/r.pdf")) && tpl(CUST_PHONE).length === 0);

  const env3 = fresh("2026-09-26 16:00");
  for (const x of rows("x_whatsapp_template")) if (x.x_meta_template_id === "utak_payment_received") x.x_category = "MARKETING";
  clearTemplateCache();
  await quiet(() => sendReceiptToCustomer(env3, CUST_PHONE, data as any, "https://w.test/r.pdf"));
  assert("template re-filed MARKETING → the receipt held + utak_update_customer [account, «إيصال الدفع»]",
    heldFor(env3, CUST_PHONE).length === 1 && params(tpl(CUST_PHONE, "utak_update_customer")[0]).join("|") === `${CUST}|إيصال الدفع`, JSON.stringify(sentTo(CUST_PHONE)));

  // The collection: the ack is not held outside the window (the receipt covers it).
  const env4 = fresh("2026-09-26 16:00");
  const o = order(CUST, "delivered", "2026-09-26");
  const inv = seed("x_invoice", { x_invoice_number: "UTAK-INV-20260926-007", x_total: 60, x_status: "issued", x_order_id: o, x_invoice_date: "2026-09-26" });
  openWindow(env4, COLL_PHONE, 5);
  await button(env4, COLL_PHONE, `collect_cash_${inv}`, "نقد 💵");
  assert("collection recorded (x_payment)", rows("x_payment").length === 1);
  assert("the ack to the customer: not sent, not held — «skipped» with the reason", txt(CUST_PHONE).length === 0 && heldFor(env4, CUST_PHONE).length === 0
    && rows("x_wa_message").some((r) => r.x_status === "skipped" && String(r.x_meta_error).includes("utak_payment_received")), JSON.stringify(rows("x_wa_message").map((r) => [r.x_status, r.x_meta_error])));
  const coll = sentTo(COLL_PHONE).filter((b) => b.type === "interactive");
  assert("the collector's reply carries «ملاحظة 📝» (collect_note_<invoice>)", coll.some((b) => b.interactive?.action?.buttons?.some((x: any) => x.reply?.id === `collect_note_${inv}`)), JSON.stringify(sentTo(COLL_PHONE)));
  const env5 = fresh("2026-09-26 16:00");
  const o5 = order(CUST, "delivered", "2026-09-26");
  const inv5 = seed("x_invoice", { x_invoice_number: "UTAK-INV-5", x_total: 60, x_status: "issued", x_order_id: o5, x_invoice_date: "2026-09-26" });
  openWindow(env5, COLL_PHONE, 5); openWindow(env5, CUST_PHONE, 5);
  await button(env5, COLL_PHONE, `collect_cash_${inv5}`, "نقد 💵");
  assert("inside the customer's window the ack goes as text", txt(CUST_PHONE).some((x) => x.startsWith("تم استلام الدفعة")));
}

// ================================================================ 9. team notes
console.log("\n[9] the collector's / driver's notes reach Baraa with the customer and the order");
{
  const env = fresh("2026-09-26 11:00");
  const o = order(CUST, "in_delivery", "2026-09-26");
  seed("x_delivery_stop", { x_order_id: o, x_status: "pending" });
  openWindow(env, DRV_PHONE, 5);
  await button(env, DRV_PHONE, `delivery_issue_${o}`, "فيه مشكلة ⚠️");
  await say(env, DRV_PHONE, "المحل مقفل ورقمه ما يرد");
  const toOwner = txt(OWNER);
  const note = toOwner.find((x) => x.startsWith("⚠️ ملاحظة توصيل من عمر المجهلي"));
  assert("delivery note → Baraa, with the customer and the order", !!note && note.includes("العميل: مطعم الوادي") && note.includes(`الطلب: #${o}`) && note.includes("المحل مقفل"), JSON.stringify(toOwner));
  assert("…kept on the stop (x_issue_note)", rows("x_delivery_stop").some((r) => r.x_issue_note === "المحل مقفل ورقمه ما يرد" && r.x_status === "issue"));

  const o2 = order(CUST, "delivered", "2026-09-26");
  const inv = seed("x_invoice", { x_invoice_number: "UTAK-INV-20260926-009", x_total: 80, x_status: "issued", x_order_id: o2, x_invoice_date: "2026-09-26" });
  const pay = seed("x_payment", { x_invoice_id: inv, x_amount: 50, x_method: "cash", x_notes: false });
  openWindow(env, COLL_PHONE, 5);
  await button(env, COLL_PHONE, `collect_note_${inv}`, "ملاحظة 📝");
  assert("«ملاحظة 📝» → the prompt", txt(COLL_PHONE).includes(COLLECT_NOTE_PROMPT), JSON.stringify(txt(COLL_PHONE)));
  await say(env, COLL_PHONE, "دفع 50 والباقي بكرة");
  const cn = txt(OWNER).find((x) => x.startsWith("📝 ملاحظة تحصيل من سالم"));
  assert("collection note → Baraa, with the customer, the order and the invoice", !!cn && cn.includes("العميل: مطعم الوادي") && cn.includes(`#${o2}`) && cn.includes("UTAK-INV-20260926-009") && cn.includes("دفع 50"), JSON.stringify(txt(OWNER)));
  assert("…kept on the payment (x_notes)", String(table("x_payment").get(pay)?.x_notes ?? "").includes("سالم] دفع 50 والباقي بكرة"), String(table("x_payment").get(pay)?.x_notes));
  assert("…and the collector hears it arrived", txt(COLL_PHONE).includes(TEAM_NOTE_ACK));
  assert("the notes went as owner_team_note (x_wa_message rows not needed for Baraa; the gateway sent text)", txt(OWNER).length >= 2);

  const env2 = fresh("2026-09-26 11:00");
  closeOwnerWindow(env2);
  const o3 = order(CUST, "in_delivery", "2026-09-26");
  seed("x_delivery_stop", { x_order_id: o3, x_status: "pending" });
  const res = await quiet(() => recordTeamNote(env2, { kind: "delivery", memberName: "عمر المجهلي", orderId: o3, text: "تأخرت نصف ساعة" }));
  const q = heldFor(env2, OWNER);
  assert("Baraa outside his window: the note is held as owner_team_note", q.length === 1 && q[0].purpose === "owner_team_note" && String(q[0].body?.text?.body).includes("العميل: مطعم الوادي"), JSON.stringify(q));
  assert("…critical: utak_update_owner [date, «ملاحظة من الفريق»] (when usable)", params(tpl(OWNER, "utak_update_owner")[0]).join("|") === "26 سبتمبر 2026|ملاحظة من الفريق" && res.customerName === "مطعم الوادي");
}

// ================================================================ 10. schema
console.log("\n[10] schema gate");
assert("every Odoo read / write named real fields and selection values", rejected.length === 0, rejected.slice(0, 5).join(" | "));

console.log(`\n${passed} ✓  ${failed} ✗`);
if (failed) { console.log("failures:\n  " + failures.join("\n  ")); process.exit(1); }
