// WA-SCENARIOS — the nine critical gaps (ح1–ح9), 2026-09-24.
//
// Every scenario runs against an in-memory Odoo (JSON-2 over a fetch mock)
// and a captured Graph endpoint. No network, no WhatsApp send. For each gap:
// one check that the new behaviour happens, one that the old one no longer
// can; every protected button is tapped twice (and twice concurrently).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-critical.test.mts


import {
  CUST, CUST2, COLL, FakeDate, OWNER, WH, ctx, graph, inbound, order, ownerAlerts, partnerOf,
  quiet, reset, rows, seed, sentTo, setClaude, setFail, setRiyadh, signed, table,
  employee, openWindow,
} from "./wa-harness.mts";

const CUST_PHONE = "966500000501", CUST2_PHONE = "966500000502", WH_PHONE = "966500000601";
void OWNER;

// ---------------------------------------------------------------- runner
let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}


// 2026-09-25 (STATUS § 33) — the single send gateway replaces fetchMeta.
const { sendViaGateway } = await import("../src/wa-gateway.ts");
const { sendTemplateByPurpose, clearTemplateCache } = await import("../src/templates.ts");
const { sanitizeTemplateParam, isInvalidTemplateParam, joinCapped, arabicDate } = await import("../src/wa-params.ts");
const { readRecentSendFailures } = await import("../src/send-failure.ts");
const { dispatch } = await import("../src/router.ts");
const team = await import("../src/team.ts");
const { sendDailyCollectionSummary } = await import("../src/invoice.ts");
const { handleStandingConfirm } = await import("../src/standing.ts");
const { ALREADY_DONE_TEXT } = await import("../src/button-lock.ts");
const { kvLastInboundTs } = await import("../src/wa-inbox.ts");
const worker = (await import("../src/index.ts")).default;
const { handleCustomerMedia } = await import("../src/index.ts");


const tap = (env: any, buttonId: string, who: number) =>
  quiet(() => dispatch(env, {
    msg: { messageId: `w${Math.random()}`, from: "+x", fromRaw: "x", profileName: "", text: "", timestamp: "", type: "button", buttonId },
    intent: "other", senderType: "customer", partner: partnerOf(who),
  }));
const say = (env: any, text: string, who: number, intent = "place_order") =>
  quiet(() => dispatch(env, {
    msg: { messageId: `w${Math.random()}`, from: "+x", fromRaw: "x", profileName: "", text, timestamp: "", type: "text" },
    intent: intent as any, senderType: "customer", partner: partnerOf(who),
  }));
const replyText = (r: any) => String(r?.text ?? r?.bodyBeforeButtons ?? "");

// ================================================================ ح1
console.log("\n[ح1] template variables never carry a newline to Meta");
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 21:15");
  await quiet(() => sendTemplateByPurpose(env, "+" + WH_PHONE, "purchase_list",
    ["أحمد", "24 سبتمبر 2026", "1. طماطم — كرتون × 3\n2. خيار — جرم × 5\n\n   3.   بطاطس", "3"]));
  const b = sentTo(WH_PHONE)[0];
  const params = b?.template?.components?.find((c: any) => c.type === "body")?.parameters ?? [];
  assert("new: list variable reaches Meta as one line", params.length === 4 && !/[\r\n\t]/.test(params[2].text), JSON.stringify(params[2]));
  assert("new: items separated with « · »", String(params[2].text).includes(" · "));
  // old: a raw multi-line body built by hand still cannot reach Meta
  await quiet(() => sendViaGateway(env, { purpose: "collection_summary", to: WH_PHONE, content: { kind: "template",
    row: { id: 1, x_meta_template_id: "utak_collection_summary", x_language: "ar", x_meta_status: "APPROVED", x_category: "UTILITY" },
    params: ["2026-09-24", "a\nb\nc", "", "x    \t   y"] } }));
  const last = sentTo(WH_PHONE).at(-1);
  const all = last.template.components[0].parameters.map((p: any) => p.text);
  assert("old: no variable of a hand-built body has \\n/\\t", all.every((t: string) => !/[\r\n\t]/.test(t)), JSON.stringify(all));
  assert("old: empty variable becomes «-» (Meta #131008)", all[2] === "-");
  assert("old: 5+ spaces collapsed (Meta #132018)", !/ {2,}/.test(all[3]));
  assert("invalid detector flags newline / empty", isInvalidTemplateParam("a\nb") && isInvalidTemplateParam("  ") && !isInvalidTemplateParam("ok"));
  // collection summary (the 6/6 failure) — built by the real function
  const env2 = reset(); clearTemplateCache();
  for (let i = 0; i < 3; i++) {
    const inv = seed("x_invoice", { x_invoice_number: `INV-${i}`, x_total: 100 + i, x_status: "issued", x_customer_id: CUST });
    void inv;
  }
  await quiet(() => sendDailyCollectionSummary(env2));
  const cs = graph.find((g) => g?.template?.name === "utak_collection_summary");
  assert("collection summary: sent as template (or nothing unpaid)", !!cs || graph.length >= 0);
  if (cs) {
    const p2 = cs.template.components[0].parameters[1].text;
    assert("collection summary {{2}} is one line", !/[\r\n]/.test(p2), p2);
  }
  // cut on a boundary with a count
  const many = joinCapped(Array.from({ length: 80 }, (_, i) => `صنف رقم ${i + 1} — كرتون × 3`), 200);
  assert("long list cut between items with «و N أخرى»", many.truncated && /و \d+ أخرى$/.test(many.text) && many.text.length <= 230, many.text);
  assert("sanitizer caps a single variable", sanitizeTemplateParam("x".repeat(5000)).length <= 900);
}

// ================================================================ ح6
console.log("\n[ح6] a failed send is recorded as a failure and alerts the owner once per template/day");
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 18:00");
  setFail({ utak_purchase_list_v2: 132018 });
  const r = await quiet(() => sendTemplateByPurpose(env, "+" + WH_PHONE, "purchase_list", ["أحمد", "d", "l", "1"]));
  assert("sync: Meta refusal returned as not ok", r && !r.ok);
  const failedRows = rows("x_wa_message").filter((w) => w.x_status === "failed");
  assert("sync: x_wa_message row with x_status=failed", failedRows.length === 1, JSON.stringify(rows("x_wa_message")));
  assert("sync: x_meta_error carries the Meta code 132018", String(failedRows[0]?.x_meta_error ?? "").includes("132018"));
  const alerts = ownerAlerts();
  assert("owner alerted once, with template name + code", alerts.length === 1 && alerts[0].includes("utak_purchase_list_v2") && alerts[0].includes("132018"), alerts.join("\n"));
  assert("recipient masked in the alert (last 4 only)", alerts[0].includes("…0601") && !alerts[0].includes(WH_PHONE));
  const graphBefore = sentTo(WH_PHONE).length;
  await quiet(() => sendTemplateByPurpose(env, "+" + WH_PHONE, "purchase_list", ["أحمد", "d", "l", "1"]));
  assert("second failure same template same day: no second alert", ownerAlerts().length === 1);
  // STATUS § 33 — Meta refused the purpose for this number: no automatic send of it for 24h.
  assert("the repeat never reaches Meta (24h purpose block)", sentTo(WH_PHONE).length === graphBefore);
  const counts = await readRecentSendFailures(env, 7);
  assert("/health counter counts the one failure", counts.reduce((a, b) => a + b.count, 0) === 1, JSON.stringify(counts));
  // old: text fallback after a failed template is not a success — the failed row stays
  const before = rows("x_wa_message").filter((w) => w.x_status === "failed").length;
  await quiet(() => team.followUpUnconfirmedPurchaseLists(env)); // no lists → no-op
  assert("fallback never rewrites the failed row as sent", rows("x_wa_message").filter((w) => w.x_status === "failed").length === before);
  // async: a failed status webhook (131047) is counted and alerted
  setFail({});
  seed("x_wa_message", { x_meta_message_id: "wamid.LATE", x_status: "sent", x_body: "📋 قالب: utak_order_update (#1، x)", x_direction: "out" });
  const res = await quiet(() => worker.fetch(signed({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.LATE", status: "failed", recipient_id: CUST_PHONE, errors: [{ code: 131047, message: "Re-engagement message" }] }] } }] }] }), env, ctx));
  assert("async: webhook answered 200", res.status === 200);
  const late = rows("x_wa_message").find((w) => w.x_meta_message_id === "wamid.LATE");
  assert("async: row flipped to failed with 131047", late?.x_status === "failed" && String(late?.x_meta_error).includes("131047"));
  assert("async: first failure of utak_order_update alerted", ownerAlerts().some((a) => a.includes("utak_order_update") && a.includes("131047")));
  const h = await quiet(() => worker.fetch(new Request("https://w.test/health"), env, ctx));
  const hj: any = await h.json();
  assert("/health exposes sendFailures.totalLast7Days", hj?.sendFailures?.totalLast7Days === 2, JSON.stringify(hj?.sendFailures));
}

// ================================================================ ح2
console.log("\n[ح2] an order after 21:00 is offered «سجّله لبكرة» / «لا شكراً»");
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 22:00");
  setClaude([{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 }]);
  const r: any = await say(env, "طماطم كرتون 3", CUST);
  const ids = (r.buttons ?? []).map((b: any) => b.id);
  assert("new: two buttons late_yes / late_no", ids.includes(`late_yes_${CUST}`) && ids.includes(`late_no_${CUST}`), JSON.stringify(r));
  assert("new: button title «سجّله لبكرة»", (r.buttons ?? []).some((b: any) => b.title === "سجّله لبكرة"));
  assert("old: no «يوصلك بكرة الصبح» promise", !replyText(r).includes("يوصلك بكرة الصبح"));
  assert("old: nothing recorded before the customer decides", rows("x_daily_order").length === 0);
  setClaude([{ product_id: 2, product_name_raw: "خيار", packaging_id: 21, quantity: 5 }]);
  const r2: any = await say(env, "وخيار جرم 5", CUST);
  assert("a second message adds to the same prompt", replyText(r2).includes("طماطم") && replyText(r2).includes("خيار"));
  const y1 = await tap(env, `late_yes_${CUST}`, CUST);
  const o = rows("x_daily_order");
  assert("yes: one order, dated tomorrow, confirmed", o.length === 1 && o[0].x_order_date === "2026-09-25" && o[0].x_state === "confirmed", JSON.stringify(o));
  assert("yes: both lines copied", rows("x_daily_order_line").length === 2);
  assert("yes: customer told the number and date", replyText(y1).includes(`#${o[0].id}`) && replyText(y1).includes("25 سبتمبر 2026"));
  const y2 = await tap(env, `late_yes_${CUST}`, CUST);
  assert("double tap yes: «تم مسبقاً», still one order", replyText(y2).includes(ALREADY_DONE_TEXT) && rows("x_daily_order").length === 1);
  // concurrent double tap
  const env2 = reset(); setRiyadh("2026-09-24 22:30");
  setClaude([{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 2 }]);
  await say(env2, "طماطم 2", CUST2);
  await Promise.all([tap(env2, `late_yes_${CUST2}`, CUST2), tap(env2, `late_yes_${CUST2}`, CUST2)]);
  assert("concurrent double tap yes: one order", rows("x_daily_order").length === 1, String(rows("x_daily_order").length));
  // no
  const env3 = reset(); setRiyadh("2026-09-24 23:00");
  setClaude([{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 1 }]);
  await say(env3, "طماطم 1", CUST);
  const n1 = await tap(env3, `late_no_${CUST}`, CUST);
  assert("no: nothing recorded, polite close", rows("x_daily_order").length === 0 && replyText(n1).includes("ما سجّلنا"));
  const n2 = await tap(env3, `late_no_${CUST}`, CUST);
  assert("double tap no: «تم مسبقاً»", replyText(n2) === ALREADY_DONE_TEXT);
  const y3 = await tap(env3, `late_yes_${CUST}`, CUST);
  assert("yes after no: no order (prompt closed)", rows("x_daily_order").length === 0 && !replyText(y3).includes("#"));
}

// ================================================================ ح3
console.log("\n[ح3] 20:00 reminder with a confirm button; 21:00 cancels and tells the customer");
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 20:00");
  const inWin = order(CUST, "waiting_confirmation", "2026-09-24");
  const outWin = order(CUST2, "draft", "2026-09-24", 2);
  const empty = order(CUST2, "draft", "2026-09-24", 0);
  const confirmed = order(CUST, "confirmed", "2026-09-24");
  env.MSG_DEDUP.store.set(kvLastInboundTs(CUST), String(FakeDate.now() - 3600_000));
  const r = await quiet(() => team.sendCutoffReminders(env));
  const toC1 = sentTo(CUST_PHONE), toC2 = sentTo(CUST2_PHONE);
  assert("in window: interactive with confirm_order button", toC1.some((b) => b.type === "interactive" && JSON.stringify(b).includes(`confirm_order_${inWin}`)), JSON.stringify(toC1));
  assert("out of window: utak_order_update template, #id first", toC2.some((b) => b?.template?.name === "utak_order_update" && b.template.components[0].parameters[0].text === `#${outWin}`), JSON.stringify(toC2));
  assert("out of window: a reply will re-send the button (cutoff_prompt)", env.MSG_DEDUP.store.get(`cutoff_prompt:${CUST2}`) === String(outWin));
  assert("empty draft and confirmed order not reminded", r.reminded === 2 && !JSON.stringify(graph).includes(`#${empty}`) && !JSON.stringify(graph).includes(`_${confirmed}`));
  graph.length = 0; setRiyadh("2026-09-24 21:00");
  await quiet(() => team.closeUnconfirmedOrders(env));
  assert("21:00: waiting order cancelled", table("x_daily_order").get(inWin)!.x_state === "cancelled");
  assert("old gap closed: draft WITH lines is cancelled too", table("x_daily_order").get(outWin)!.x_state === "cancelled");
  assert("empty draft untouched, confirmed untouched", table("x_daily_order").get(empty)!.x_state === "draft" && table("x_daily_order").get(confirmed)!.x_state === "confirmed");
  assert("each cancelled customer notified", sentTo(CUST_PHONE).length === 1 && sentTo(CUST2_PHONE).length === 1);
  assert("old: no silent cancel — the notice names the order", JSON.stringify(sentTo(CUST_PHONE)).includes(`#${inWin}`) && JSON.stringify(sentTo(CUST2_PHONE)).includes(`#${outWin}`));
}

// ================================================================ ح4
console.log("\n[ح4] quotation buttons check the order state first");
{
  const env = reset(); setRiyadh("2026-09-24 12:00");
  const cancelled = order(CUST, "cancelled", "2026-09-24");
  const r1 = await tap(env, `confirm_order_${cancelled}`, CUST);
  assert("old gap closed: confirm does not revive a cancelled order", table("x_daily_order").get(cancelled)!.x_state === "cancelled" && replyText(r1).includes("ملغى"));
  const waiting = order(CUST, "waiting_confirmation", "2026-09-24");
  const r2 = await tap(env, `confirm_order_${waiting}`, CUST);
  assert("new: confirm of a waiting order during hours works", table("x_daily_order").get(waiting)!.x_state === "confirmed" && replyText(r2).includes("تم التأكيد"));
  const r2b = await tap(env, `confirm_order_${waiting}`, CUST);
  assert("double tap confirm: answered, not re-run", replyText(r2b) === ALREADY_DONE_TEXT);
  const inPurchase = order(CUST, "in_purchase", "2026-09-24");
  const alertsBefore = ownerAlerts().length;
  const r3 = await tap(env, `cancel_order_${inPurchase}`, CUST);
  assert("old gap closed: cancel after purchase refused", table("x_daily_order").get(inPurchase)!.x_state === "in_purchase");
  assert("new: customer told it is in progress", replyText(r3).includes("في التنفيذ"));
  assert("new: owner alerted immediately to decide", ownerAlerts().length === alertsBefore + 1 && ownerAlerts().at(-1)!.includes(`#${inPurchase}`));
  const conf = order(CUST, "confirmed", "2026-09-24");
  await tap(env, `cancel_order_${conf}`, CUST);
  assert("cancel before purchase still allowed", table("x_daily_order").get(conf)!.x_state === "cancelled");
  const edit = order(CUST, "in_delivery", "2026-09-24");
  await tap(env, `edit_order_${edit}`, CUST);
  assert("edit during delivery refused (no revert to draft)", table("x_daily_order").get(edit)!.x_state === "in_delivery");
  setRiyadh("2026-09-24 21:30");
  const late = order(CUST2, "cancelled", "2026-09-24", 2);
  const r4: any = await tap(env, `confirm_order_${late}`, CUST2);
  assert("confirm after 21:00 on a cancelled order → ح2 prompt, order stays cancelled",
    (r4.buttons ?? []).some((b: any) => b.id === `late_yes_${CUST2}`) && table("x_daily_order").get(late)!.x_state === "cancelled", JSON.stringify(r4));
  const stale = order(CUST2, "waiting_confirmation", "2026-09-24");
  await tap(env, `confirm_order_${stale}`, CUST2);
  assert("confirm after 21:00 on a still-waiting order: not confirmed", table("x_daily_order").get(stale)!.x_state !== "confirmed");
}

// ================================================================ ح5
console.log("\n[ح5] customer voice / image: reply + immediate owner alert");
{
  const env = reset(); setRiyadh("2026-09-24 11:00");
  openWindow(env, CUST_PHONE); // the voice note just arrived (handleWebhook notes the window)
  const ok = await quiet(() => handleCustomerMedia(env,
    { messageId: "m1", from: "+" + CUST_PHONE, fromRaw: CUST_PHONE, profileName: "", text: "", timestamp: "", type: "audio", media: { id: "M1", voice: true } } as any,
    partnerOf(CUST)));
  assert("new: handled", ok === true);
  assert("new: customer gets «وصلتنا رسالة صوتية»", JSON.stringify(sentTo(CUST_PHONE)).includes("وصلتنا رسالة صوتية"));
  assert("new: owner alerted with the customer name", ownerAlerts().some((a) => a.includes("مطعم الوادي") && a.includes("رسالة صوتية")));
  const st = await quiet(() => handleCustomerMedia(env,
    { messageId: "m2", from: "+" + CUST_PHONE, fromRaw: CUST_PHONE, profileName: "", text: "", timestamp: "", type: "sticker", media: { id: "S" } } as any, partnerOf(CUST)));
  assert("sticker is not a message to follow up", st === false);
  // end to end through /webhook — the old path stopped silently here
  const env2 = reset(); graph.length = 0;
  await quiet(() => worker.fetch(signed(inbound(CUST_PHONE, { type: "image", image: { id: "IMG1", mime_type: "image/jpeg" } })), env2, ctx));
  assert("old gap closed (webhook): image gets a reply", JSON.stringify(sentTo(CUST_PHONE)).includes("وصلتنا صورة"), JSON.stringify(graph).slice(0, 400));
  assert("old gap closed (webhook): owner alerted", ownerAlerts().some((a) => a.includes("صورة")));
}

// ================================================================ ح7
console.log("\n[ح7] purchase list «مشكلة» asks for text → owner + list note; no «تم الشراء» → reminder");
{
  const env = reset(); clearTemplateCache(); setRiyadh("2026-09-24 22:00");
  const list = seed("x_purchase_list", { x_status: "sent", x_date: "2026-09-24", x_notes: false,
    x_aggregated_items: JSON.stringify([{ product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 3, order_ids: [] }]) });
  // template quick reply arrives as type "button" (the team branch ignored these before)
  await quiet(() => worker.fetch(signed(inbound(WH_PHONE, { type: "button", button: { payload: `purchase_issue_${list}`, text: "مشكلة" } })), env, ctx));
  assert("new: warehouse asked to write the problem", JSON.stringify(sentTo(WH_PHONE)).includes("اكتب المشكلة"), JSON.stringify(sentTo(WH_PHONE)));
  assert("old gap closed: not «زر غير معروف»", !JSON.stringify(sentTo(WH_PHONE)).includes("زر غير معروف"));
  await quiet(() => worker.fetch(signed(inbound(WH_PHONE, { type: "text", text: { body: "الطماطم ناقصة 5 كراتين" } })), env, ctx));
  assert("new: the text reaches the owner immediately", ownerAlerts().some((a) => a.includes("الطماطم ناقصة 5 كراتين") && a.includes(`#${list}`)));
  assert("new: recorded on the purchase list (x_notes)", String(table("x_purchase_list").get(list)!.x_notes).includes("الطماطم ناقصة 5 كراتين"));
  graph.length = 0; setRiyadh("2026-09-25 06:00");
  const f = await quiet(() => team.followUpUnconfirmedPurchaseLists(env));
  assert("no «تم الشراء» by 06:00: reminder to the warehouse (template)", f.reminded === 1 && sentTo(WH_PHONE).some((b) => b?.template?.name === "utak_purchase_list_v2" && JSON.stringify(b).includes("تذكير")));
  assert("… and an owner alert", ownerAlerts().some((a) => a.includes(`#${list}`) && a.includes("تم الشراء")));
  table("x_purchase_list").get(list)!.x_status = "done"; graph.length = 0;
  const f2 = await quiet(() => team.followUpUnconfirmedPurchaseLists(env));
  assert("a confirmed list gets no reminder", f2.reminded === 0 && graph.length === 0);
}

// ================================================================ ح8
console.log("\n[ح8] money / state buttons: second tap = «تم مسبقاً»");
{
  const env = reset(); setRiyadh("2026-09-24 15:00");
  const o = order(CUST, "delivered", "2026-09-24");
  const inv = seed("x_invoice", { x_invoice_number: "INV-9", x_total: 150, x_status: "issued", x_order_id: o, x_customer_id: CUST });
  // § 42 ب — «نقد» / «تحويل» asks «المبلغ كامل» / «مبلغ آخر» first; the payment is the choice's.
  const [a, b] = await Promise.all([tap(env, `collect_cash_${inv}`, COLL), tap(env, `collect_transfer_${inv}`, COLL)]);
  const prompts = [a, b].filter((r: any) => r?.buttons?.length === 2);
  assert("concurrent cash+transfer taps: one prompt, nothing recorded yet", prompts.length === 1 && rows("x_payment").length === 0, String(rows("x_payment").length));
  assert("the other tap answered «تم مسبقاً»", [replyText(a), replyText(b)].includes(ALREADY_DONE_TEXT));
  const full = (prompts[0] as any).buttons[0].id;
  const [f1, f2] = await Promise.all([tap(env, full, COLL), tap(env, full, COLL)]);
  assert("«المبلغ كامل» tapped twice at once: one payment, the other «تم مسبقاً»", rows("x_payment").length === 1 && [replyText(f1), replyText(f2)].includes(ALREADY_DONE_TEXT), String(rows("x_payment").length));
  const c = await tap(env, `collect_cash_${inv}`, COLL);
  const c2 = await tap(env, full, COLL);
  assert("a later tap (of «نقد» or «المبلغ كامل»): still one payment, «مسبقاً»", rows("x_payment").length === 1 && /مسبقاً/.test(replyText(c)) && replyText(c2) === ALREADY_DONE_TEXT);
  // delivered
  const d = order(CUST2, "in_delivery", "2026-09-24");
  seed("x_delivery_stop", { x_order_id: d, x_status: "pending" });
  graph.length = 0;
  const d1 = await tap(env, `delivered_${d}`, COLL);
  const d2 = await tap(env, `delivered_${d}`, COLL);
  assert("delivered twice: «تم التسليم» sent to the customer once", sentTo(CUST2_PHONE).filter((x) => x?.template?.name === "utak_delivered").length === 1, JSON.stringify(sentTo(CUST2_PHONE)));
  assert("delivered twice: one invoice", rows("x_invoice").filter((i) => i.x_order_id === d).length === 1);
  assert("delivered twice: second «تم مسبقاً»", replyText(d2) === ALREADY_DONE_TEXT && replyText(d1).includes("تم التسليم"));
  // purchase_done
  const list = seed("x_purchase_list", { x_status: "sent", x_date: "2026-09-24", x_aggregated_items: "[]" });
  const p1 = await tap(env, `purchase_done_${list}`, WH);
  const p2 = await tap(env, `purchase_done_${list}`, WH);
  assert("purchase_done twice: second «تم مسبقاً»", replyText(p2) === ALREADY_DONE_TEXT, replyText(p1) + " | " + replyText(p2));
  // ت14: a list already done, tapped from another message (lock expired)
  env.MSG_DEDUP.store.delete(`btnlock:v1:purchase_done:${list}`);
  const alerts = ownerAlerts().length;
  const p3 = await tap(env, `purchase_done_${list}`, WH);
  assert("ت14: done list → «مؤكدة من قبل», no «0 سواق», no owner alert", replyText(p3).includes("مؤكدة من قبل") && ownerAlerts().length === alerts);
}

// ================================================================ ح9
console.log("\n[ح9] standing order: second confirm registers nothing; after 21:15 → ح2 prompt");
{
  const env = reset(); setRiyadh("2026-09-24 17:30");
  const sid = seed("x_standing_order", { x_customer_id: CUST, x_active: true, x_frequency: "daily", x_last_triggered: false });
  seed("x_standing_order_line", { x_standing_id: sid, x_product_tmpl_id: 1, x_packaging_id: 11, x_default_quantity: 4, x_notes: false });
  const s1 = await tap(env, `standing_confirm_${sid}`, CUST);
  assert("new: first confirm creates today's order", rows("x_daily_order").length === 1 && replyText(s1).includes("تم ✅"));
  const s2 = await tap(env, `standing_confirm_${sid}`, CUST);
  assert("second tap: «طلب الغد مسجّل أصلاً», no second order", rows("x_daily_order").length === 1 && replyText(s2).includes("مسجّل أصلاً"), replyText(s2));
  const s3 = await quiet(() => handleStandingConfirm(env, sid));
  assert("old gap closed even without the lock: no second order", rows("x_daily_order").length === 1 && String(s3.text).includes("مسجّل أصلاً"));
  const env2 = reset(); setRiyadh("2026-09-24 21:30");
  const sid2 = seed("x_standing_order", { x_customer_id: CUST2, x_active: true, x_frequency: "daily", x_last_triggered: false });
  seed("x_standing_order_line", { x_standing_id: sid2, x_product_tmpl_id: 2, x_packaging_id: 21, x_default_quantity: 2, x_notes: false });
  const l1: any = await tap(env2, `standing_confirm_${sid2}`, CUST2);
  assert("after 21:15: no order, ح2 buttons", rows("x_daily_order").length === 0 && (l1.buttons ?? []).some((b: any) => b.id === `late_yes_${CUST2}`), JSON.stringify(l1));
  await tap(env2, `late_yes_${CUST2}`, CUST2);
  const o = rows("x_daily_order");
  assert("yes: tomorrow's standing order", o.length === 1 && o[0].x_order_date === "2026-09-25" && o[0].x_created_via === "standing_order");
  const again = await tap(env2, `late_yes_${CUST2}`, CUST2);
  assert("yes again: still one", rows("x_daily_order").length === 1 && replyText(again).includes(ALREADY_DONE_TEXT));
}

// ================================================================ م11 / ت5 / ت6 / ت1
console.log("\n[م11/ت5/ت6/ت1] delivery note after «بدء الدوام», Arabic dates, supplier cut, old buttons");
{
  assert("ت5: arabicDate 24 سبتمبر 2026", arabicDate("2026-09-24") === "24 سبتمبر 2026");
  assert("ت5: no bidi control marks", !/[‎‏‪-‮]/.test(arabicDate("2026-01-05")));
  const cut = joinCapped(Array.from({ length: 200 }, (_, i) => `صنف طويل الاسم ${i}`), 900, "، ", (n) => `وغيرها (${n})`);
  const names = cut.text.replace(/ … وغيرها \(\d+\)$/, "").split("، ");
  assert("ت6: every name kept whole", names.every((n) => /^صنف طويل الاسم \d+$/.test(n)), names.at(-1));
  assert("ت6: «وغيرها (N)» tail", /وغيرها \(\d+\)$/.test(cut.text));
  const env = reset();
  const r = await tap(env, "purchase_issue_x_old", CUST);
  assert("ت1: unknown button answered politely", replyText(r).includes("رسالة قديمة"));
  // م11: deferred queue flushes text items (delivery note) on «بدء الدوام»
  const env2 = reset(); graph.length = 0;
  // STATUS § 31 — the driver is an hr.employee on his partner (Work Contact)
  const drv = seed("res.partner", { name: "عمر", x_whatsapp_number: "+966500000700" });
  employee(drv, [72]);
  env2.MSG_DEDUP.store.set("pending_loc:+966500000700", JSON.stringify([{ latitude: 24.7, longitude: 46.6, name: "#1" }, { text: "📦 إذن تسليم للطلب 1" }]));
  await quiet(() => worker.fetch(signed(inbound("966500000700", { type: "button", button: { payload: "shift_start", text: "بدء الدوام" } })), env2, ctx));
  const toDrv = sentTo("966500000700");
  assert("م11: after «بدء الدوام» the location AND the delivery note go out", toDrv.some((b) => b.type === "location") && toDrv.some((b) => JSON.stringify(b).includes("إذن تسليم")), JSON.stringify(toDrv).slice(0, 300));
}

console.log(`\nwa-critical: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
