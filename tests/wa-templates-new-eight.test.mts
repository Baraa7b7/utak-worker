// The eight new WhatsApp templates (2026-09-25): what the code sends matches
// each template's variables, the code works with the old and the new template
// behind the same purpose, and the deferred migration never moves a purpose
// to a template Meta has not approved (or whose variables do not match).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-templates-new-eight.test.mts

import {
  CUST, OWNER, WH, closeOwnerWindow, graph, order, quiet, reset, seed, setFail, setRiyadh, table,
} from "./wa-harness.mts";

const { NEW_EIGHT, placeholders, textProblems, retrySpec, specFor } = await import("../scripts/wa-templates-20260925-new-eight.mjs");
const { planMigration } = await import("../scripts/wa-templates-20260925-migrate-when-approved.mjs");
const { CONTRACT, contractParams } = await import("../scripts/wa-templates-20260924-purpose-contract.mjs");
const { clearTemplateCache, sendOwnerAlert, T, ownerAlertParams, purchaseRemindParams } = await import("../src/templates.ts");
const team = await import("../src/team.ts");
const { askAllSuppliersForPrices } = await import("../src/suppliers.ts");
const { sendStandingOrderReminders } = await import("../src/standing.ts");
const { sendPaymentReminders } = await import("../src/outreach.ts");
const { quotationTemplateParams } = await import("../src/quotation.ts");
const labels = (await import("../src/wa-template-labels.json", { with: { type: "json" } })).default as Record<string, string>;

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}
const spec = (key: string) => NEW_EIGHT.find((t: any) => t.key === key)!;
const nVars = (body: string) => new Set(placeholders(body)).size;

/** Point `purpose` at exactly one template row (drops any other row for it). */
function mapPurpose(purpose: string, name: string, params: number): void {
  for (const r of [...table("x_whatsapp_template").values()]) if (r.x_purpose === purpose) table("x_whatsapp_template").delete(r.id);
  seed("x_whatsapp_template", {
    x_purpose: purpose, x_meta_template_id: name, x_language: "ar",
    x_meta_status: "APPROVED", x_param_count: params, x_category: "UTILITY",
  });
  clearTemplateCache();
}
function unmap(purpose: string): void {
  for (const r of [...table("x_whatsapp_template").values()]) if (r.x_purpose === purpose) table("x_whatsapp_template").delete(r.id);
  clearTemplateCache();
}
const sentTpl = (name: string) => graph.filter((b) => b?.template?.name === name);
const bodyParams = (b: any): string[] =>
  (b?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((p: any) => p.text) ?? [];
const buttonIdx = (b: any): number[] =>
  (b?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => Number(c.index));
const buttonPayloads = (b: any): string[] =>
  (b?.template?.components ?? []).filter((c: any) => c.type === "button").map((c: any) => c.parameters[0].payload);

/** The code's send to `name` has the template's variable count and only its button indices. */
function checkSend(label: string, name: string, t: { body: string; buttons: unknown[] }, payloadRe?: RegExp[]): any {
  const sends = sentTpl(name);
  const b = sends.at(-1);
  assert(`${label}: sent as ${name}`, !!b, `graph: ${graph.map((x) => x?.template?.name ?? x?.type).join(",")}`);
  if (!b) return null;
  const p = bodyParams(b);
  assert(`${label}: ${p.length} variable(s) = ${nVars(t.body)} in the template`, p.length === nVars(t.body), JSON.stringify(p));
  assert(`${label}: no empty variable`, p.every((x) => String(x).trim().length > 0), JSON.stringify(p));
  const idx = buttonIdx(b);
  assert(`${label}: button indices within ${t.buttons.length} button(s)`, idx.every((i) => i >= 0 && i < t.buttons.length), JSON.stringify(idx));
  if (payloadRe) {
    const pl = buttonPayloads(b);
    assert(`${label}: payloads ${payloadRe.map(String).join(" ")}`, pl.length === payloadRe.length && pl.every((x, i) => payloadRe[i].test(x)), JSON.stringify(pl));
  }
  return b;
}

// ---------------------------------------------------------------- 0. texts
console.log("\n[0] template texts");
for (const t of NEW_EIGHT) {
  const probs = textProblems(t);
  assert(`${t.name}: text rules (no leading/trailing var, examples, «يو تاك», 1..n)`, probs.length === 0, probs.join("; "));
  if (t.retry) {
    const r = retrySpec(t);
    assert(`${r.name} (retry): text rules`, textProblems(r).length === 0, textProblems(r).join("; "));
    assert(`${r.name} (retry): purpose contract = its own variables`, contractParams(t.purpose, r.name) === nVars(r.body),
      `${contractParams(t.purpose, r.name)} vs ${nVars(r.body)}`);
    if (t.retry.label) assert(`${r.name} (retry): Arabic label in wa-template-labels.json`, labels[r.name] === r.label, labels[r.name]);
  }
  assert(`${t.name}: category UTILITY`, !("category" in t) || (t as any).category === "UTILITY");
  assert(`${t.name}: Arabic label in wa-template-labels.json = spec`, labels[t.name] === t.label, labels[t.name]);
  assert(`${t.name}: purpose contract knows ${t.name}`, contractParams(t.purpose, t.name) === nVars(t.body),
    `${contractParams(t.purpose, t.name)} vs ${nVars(t.body)}`);
  if (t.replaces) assert(`${t.name}: old ${t.replaces} still in the contract`, contractParams(t.purpose, t.replaces) != null);
}
assert("T has the two new purposes", T.CUSTOMER_ORDER_REMIND === "customer_order_remind" && T.PURCHASE_LIST_REMIND === "purchase_list_remind");
assert("contract has customer_order_remind + purchase_list_remind", !!CONTRACT.customer_order_remind && !!CONTRACT.purchase_list_remind);

// ---------------------------------------------------------------- 1. supplier_ask
console.log("\n[1] supplier_ask — old [list] / new [name, list]");
setRiyadh("2026-09-25 02:00");
for (const [name, n] of [["utak_supplier_ask_v2", 2], ["utak_supplier_daily_ask", 1]] as const) {
  const env = reset();
  table("product.template").get(1)!.active = true; table("product.template").get(1)!.sale_ok = true; table("product.template").get(1)!.x_is_active_for_sale = true;
  table("product.template").get(2)!.active = true; table("product.template").get(2)!.sale_ok = true; table("product.template").get(2)!.x_is_active_for_sale = true;
  seed("res.partner", { id: 700, name: "أحمد حسان", supplier_rank: 1, x_whatsapp_number: "+966500000700", x_supplied_product_ids: [1, 2] });
  mapPurpose("supplier_ask", name, n);
  await quiet(() => askAllSuppliersForPrices(env));
  const t = name === "utak_supplier_ask_v2" ? spec("supplier_ask") : { body: "…{{1}}…", buttons: [] };
  const b = checkSend(`supplier_ask → ${name}`, name, t);
  const p = bodyParams(b);
  if (n === 2) assert("new: {{1}} = supplier name, {{2}} = the list", p[0] === "أحمد حسان" && p[1].includes("طماطم") && p[1].includes("خيار"), JSON.stringify(p));
  else assert("old: {{1}} = the list (unchanged)", p[0]?.includes("طماطم") && p[0]?.includes("خيار"), JSON.stringify(p));
}

// ---------------------------------------------------------------- 2. owner_alert
console.log("\n[2] owner_alert — v3 [when, alert]; v2 and the legacy one [alert]");
setRiyadh("2026-09-25 18:01");
{
  const env = reset();
  // STATUS § 33 — outside his window an alert takes a UTILITY owner_alert
  // template if one is mapped (as here); inside it, text.
  closeOwnerWindow(env);
  mapPurpose("owner_alert", "utak_owner_alert_v3", 2);
  await quiet(() => sendOwnerAlert(env, "فشل إرسال ملخص التحصيل\nالرمز 132018"));
  const b = checkSend("owner_alert → utak_owner_alert_v3", "utak_owner_alert_v3", specFor("utak_owner_alert_v3"));
  const p = bodyParams(b);
  assert("v3: {{1}} = Riyadh time of the alert", p[0] === "25 سبتمبر 2026، 18:01", JSON.stringify(p));
  assert("v3: {{2}} = the alert on one line", p[1]?.includes("ملخص التحصيل") && p[1]?.includes("132018") && !/[\r\n]/.test(p[1]), JSON.stringify(p));
  const long = ownerAlertParams("utak_owner_alert_v3", "ت".repeat(5000), "25 سبتمبر 2026، 18:01");
  const rendered = specFor("utak_owner_alert_v3").body.replace("{{1}}", long[0]).replace("{{2}}", long[1]);
  assert("v3: the longest alert still fits Meta's 1024", rendered.length <= 1024, String(rendered.length));
  assert("legacy / v2: the alert alone", ownerAlertParams("utak_owner_alert_v2", "x", "t").join("|") === "x" && ownerAlertParams("utak_owner_alert", "x", "t").join("|") === "x");
}
for (const name of ["utak_owner_alert_v2", "utak_owner_alert"]) {
  const env = reset();
  closeOwnerWindow(env);
  mapPurpose("owner_alert", name, 1); // seeded UTILITY here; at Meta both are MARKETING (never used, tests/wa-gateway.test.mts)
  await quiet(() => sendOwnerAlert(env, "سطر أول\nسطر ثانٍ"));
  const b = checkSend(`owner_alert → ${name}`, name, spec("owner_alert"));
  assert(`owner_alert → ${name}: to the owner, one line`, b?.to === OWNER && !/[\r\n]/.test(bodyParams(b)[0] ?? "\n"));
}

// ---------------------------------------------------------------- 3. team_shift_start
console.log("\n[3] team_shift_start — 1 variable + button 0 shift_start");
for (const name of ["utak_shift_start_v2", "utak_shift_start"]) {
  const env = reset();
  mapPurpose("team_shift_start", name, 1);
  const driver = { id: 800, name: "عمر", x_whatsapp_number: "+966500000800" } as any;
  const stops = [{ order_id: 1, customer_id: CUST, customer_name: "مطعم الوادي", customer_phone: "966500000501", neighborhood: "الملقا", sequence: 1, line_summary: "طماطم كرتون × 3" }];
  await quiet(() => team.sendDriverRoute(env, driver, stops as any, 1).catch(() => {}));
  checkSend(`team_shift_start → ${name}`, name, spec("team_shift_start"), [/^shift_start$/]);
}

// ---------------------------------------------------------------- 4. customer_daily_remind
console.log("\n[4] customer_daily_remind — 1 variable + buttons 0/1");
for (const name of ["utak_standing_remind_v2", "utak_v2_daily_remind"]) {
  const env = reset();
  mapPurpose("customer_daily_remind", name, 1);
  const sid = seed("x_standing_order", { x_customer_id: CUST, x_active: true, active: true });
  seed("x_standing_order_line", { x_standing_id: sid, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 2 });
  await quiet(() => sendStandingOrderReminders(env).catch(() => ({})));
  checkSend(`customer_daily_remind → ${name}`, name, spec("customer_daily_remind"), [/^standing_confirm_\d+$/, /^standing_edit_\d+$/]);
}

// ---------------------------------------------------------------- 5. customer_pay_remind
console.log("\n[5] customer_pay_remind — [name, total], one message per customer");
for (const name of ["utak_pay_remind_v3", "utak_v2_pay_remind"]) {
  const env = reset();
  mapPurpose("customer_pay_remind", name, 2);
  // 2026-09-24 (م2) — the real x_invoice schema: the customer comes through
  // x_order_id, what was paid from x_payment, and the statuses are issued /
  // overdue (the old seed used fields x_invoice does not have).
  const o1 = seed("x_daily_order", { x_customer_id: CUST, x_state: "delivered", x_order_date: "2026-09-01" });
  const o2 = seed("x_daily_order", { x_customer_id: CUST, x_state: "delivered", x_order_date: "2026-09-05" });
  seed("x_invoice", { x_order_id: o1, x_status: "issued", x_invoice_date: "2026-09-01", x_total: 500 });
  const i2 = seed("x_invoice", { x_order_id: o2, x_status: "overdue", x_invoice_date: "2026-09-05", x_total: 800 });
  seed("x_payment", { x_invoice_id: i2, x_amount: 50 });
  await quiet(() => sendPaymentReminders(env));
  const b = checkSend(`customer_pay_remind → ${name}`, name, spec("customer_pay_remind"));
  assert(`customer_pay_remind → ${name}: one message with the sum 1250.00`, sentTpl(name).length === 1 && bodyParams(b)[1] === "1250.00" && bodyParams(b)[0] === "مطعم الوادي",
    JSON.stringify(sentTpl(name).map(bodyParams)));
}

// ---------------------------------------------------------------- 6. customer_quotation_pdf
console.log("\n[6] customer_quotation_pdf — [customer, number, date, total]");
{
  const p = quotationTemplateParams({ customer: { name: "مطعم الوادي" }, quotationNumber: "QUO-2026-0032", grandTotal: 480 }, "24 سبتمبر 2026");
  assert("quotation params = 4 = template variables", p.length === nVars(spec("customer_quotation_pdf").body), JSON.stringify(p));
  assert("quotation params order: name, number, date, total", p.join("|") === "مطعم الوادي|QUO-2026-0032|24 سبتمبر 2026|480");
  assert("quotation template has a DOCUMENT header", spec("customer_quotation_pdf").documentHeader === true);
  assert("quotation send uses T.CUSTOMER_QUOTATION_PDF = customer_quotation_pdf", T.CUSTOMER_QUOTATION_PDF === "customer_quotation_pdf");
}

// ---------------------------------------------------------------- 7. customer_order_remind (ح3)
console.log("\n[7] 20:00 reminder — new template with buttons, else utak_order_update");
setRiyadh("2026-09-25 20:00");
{
  // new template mapped
  let env = reset();
  mapPurpose("customer_order_remind", "utak_order_confirm_remind_v1", 2);
  const o = order(CUST, "waiting_confirmation", "2026-09-25");
  const r = await quiet(() => team.sendCutoffReminders(env));
  const b = checkSend("order_remind → utak_order_confirm_remind_v1", "utak_order_confirm_remind_v1", spec("customer_order_remind"),
    [new RegExp(`^confirm_order_${o}$`), new RegExp(`^cancel_order_${o}$`)]);
  assert("order_remind: {{1}} #id, {{2}} 9:00 مساءً", bodyParams(b)[0] === `#${o}` && bodyParams(b)[1] === "9:00 مساءً", JSON.stringify(bodyParams(b)));
  assert("order_remind: utak_order_update not sent too", sentTpl("utak_order_update").length === 0);
  assert("order_remind: counted as reminded", r.reminded === 1 && r.failed === 0, JSON.stringify(r));
  assert("order_remind: no cutoff_prompt KV (buttons are in the template)", !(await env.MSG_DEDUP.get(`cutoff_prompt:${CUST}`)));

  // not mapped (today) → utak_order_update + KV prompt, as before
  env = reset();
  unmap("customer_order_remind");
  const o2 = order(CUST, "waiting_confirmation", "2026-09-25");
  await quiet(() => team.sendCutoffReminders(env));
  checkSend("order_remind unmapped → utak_order_update", "utak_order_update", { body: "{{1}} {{2}}", buttons: [] });
  assert("unmapped: cutoff_prompt KV set", (await env.MSG_DEDUP.get(`cutoff_prompt:${CUST}`)) === String(o2));

  // mapped but Meta refuses → failed, and NOT re-sent as utak_order_update
  env = reset();
  mapPurpose("customer_order_remind", "utak_order_confirm_remind_v1", 2);
  setFail({ utak_order_confirm_remind_v1: 132000 });
  order(CUST, "waiting_confirmation", "2026-09-25");
  const r3 = await quiet(() => team.sendCutoffReminders(env));
  setFail({});
  assert("mapped+refused: no fallback under another name", sentTpl("utak_order_update").length === 0);
  assert("mapped+refused: counted as failed", r3.failed === 1, JSON.stringify(r3));
}

// ---------------------------------------------------------------- 8. purchase_list_remind (ح7)
console.log("\n[8] 06:00 purchase list follow-up — new template, else the list again");
setRiyadh("2026-09-26 06:00");
{
  const env = reset();
  mapPurpose("purchase_list_remind", "utak_purchase_list_remind_v2", 3);
  // items live in x_aggregated_items (JSON), as getPurchaseListBrief reads them
  const lid = seed("x_purchase_list", { x_status: "sent", x_date: "2026-09-25", x_notes: "",
    x_aggregated_items: JSON.stringify([{ product: "طماطم", packaging: "كرتون", qty: 4 }, { product: "خيار", packaging: "جرم", qty: 2 }]) });
  await quiet(() => team.followUpUnconfirmedPurchaseLists(env));
  const b = checkSend("purchase_remind → utak_purchase_list_remind_v2", "utak_purchase_list_remind_v2", specFor("utak_purchase_list_remind_v2"), [new RegExp(`^purchase_done_${lid}$`)]);
  assert("v2: [list id, Arabic date, item count]", bodyParams(b).join("|") === `${lid}|25 سبتمبر 2026|2`, JSON.stringify(bodyParams(b)));
  assert("v1 shape kept for the old name", purchaseRemindParams("utak_purchase_list_remind_v1", 7, "d", 3).join("|") === "d|3");
}
for (const mapped of [true, false]) {
  const env = reset();
  if (mapped) mapPurpose("purchase_list_remind", "utak_purchase_list_remind_v1", 2); else unmap("purchase_list_remind");
  const lid = seed("x_purchase_list", { x_status: "sent", x_date: "2026-09-25", x_notes: "" });
  seed("x_purchase_list_line", { x_list_id: lid, x_purchase_list_id: lid, x_product_tmpl_id: 1, x_packaging_id: 11, x_total_quantity: 4, x_product_name: "طماطم", x_packaging_name: "كرتون" });
  await quiet(() => team.followUpUnconfirmedPurchaseLists(env));
  if (mapped) {
    const b = checkSend("purchase_remind → utak_purchase_list_remind_v1", "utak_purchase_list_remind_v1", spec("purchase_list_remind"), [new RegExp(`^purchase_done_${lid}$`)]);
    assert("purchase_remind: {{1}} = Arabic date", bodyParams(b)[0] === "25 سبتمبر 2026", JSON.stringify(bodyParams(b)));
    assert("purchase_remind: the 4-var list not sent too", sentTpl("utak_purchase_list_v2").length === 0);
    assert("purchase_remind: to the warehouse", b?.to === "966500000601");
  } else {
    const b = sentTpl("utak_purchase_list_v2").at(-1);
    assert("unmapped: utak_purchase_list_v2 marked as a reminder (as before)", !!b && /تذكير/.test(bodyParams(b)[1] ?? ""), JSON.stringify(bodyParams(b)));
  }
}
void WH;

// ---------------------------------------------------------------- 9. deferred migration plan
console.log("\n[9] migrate-when-approved: only APPROVED + matching variables move");
{
  const meta = (name: string, status: string, category = "UTILITY", body?: string) => {
    const t = NEW_EIGHT.find((x: any) => x.name === name || x.retry?.name === name);
    const text = body ?? (t?.retry?.name === name ? t.retry.body : t?.body);
    const comps: any[] = t?.documentHeader ? [{ type: "HEADER", format: "DOCUMENT" }] : [];
    comps.push({ type: "BODY", text });
    if (t?.buttons?.length) comps.push({ type: "BUTTONS", buttons: t.buttons });
    return { name, status, category, components: comps };
  };
  const inv = new Map<string, any>([
    ["utak_supplier_ask_v2", meta("utak_supplier_ask_v2", "APPROVED")],
    ["utak_owner_alert_v2", meta("utak_owner_alert_v2", "PENDING")],
    ["utak_shift_start_v2", meta("utak_shift_start_v2", "REJECTED")],
    ["utak_standing_remind_v2", meta("utak_standing_remind_v2", "APPROVED", "MARKETING")],
    ["utak_pay_remind_v3", meta("utak_pay_remind_v3", "APPROVED", "UTILITY", "تذكير من يو تاك: {{1}} فقط.")], // 1 var ≠ code 2
    ["utak_quotation_pdf_v1", meta("utak_quotation_pdf_v1", "APPROVED")],
    // order remind: primary rejected, retry approved → the retry is chosen
    ["utak_order_confirm_remind_v1", meta("utak_order_confirm_remind_v1", "REJECTED")],
    ["utak_order_pending_remind_v1", meta("utak_order_pending_remind_v1", "APPROVED")],
    // purchase remind missing at Meta entirely
  ]);
  const plan = planMigration(inv);
  const by = (k: string) => plan.find((p: any) => p.key === k);
  assert("APPROVED+UTILITY+match → move (supplier_ask)", by("supplier_ask").action === "move" && by("supplier_ask").to === "utak_supplier_ask_v2");
  assert("PENDING → skip", by("owner_alert").action === "skip" && /PENDING/.test(by("owner_alert").why), by("owner_alert").why);
  assert("REJECTED → skip", by("team_shift_start").action === "skip");
  assert("MARKETING → skip", by("customer_daily_remind").action === "skip" && /MARKETING/.test(by("customer_daily_remind").why));
  assert("variable mismatch → skip", by("customer_pay_remind").action === "skip" && /variables/.test(by("customer_pay_remind").why), by("customer_pay_remind").why);
  assert("new purpose approved → move (quotation)", by("customer_quotation_pdf").action === "move");
  assert("retry name used when the first was rejected", by("customer_order_remind").action === "move" && by("customer_order_remind").to === "utak_order_pending_remind_v1");
  assert("missing at Meta → skip", by("purchase_list_remind").action === "skip");
  assert("no move to a non-APPROVED template, ever", plan.filter((p: any) => p.action === "move").every((p: any) => inv.get(p.to)?.status === "APPROVED"));
  const btn = new Map(inv); btn.set("utak_supplier_ask_v2", { ...meta("utak_supplier_ask_v2", "APPROVED"), components: [{ type: "BODY", text: spec("supplier_ask").body }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "x" }] }] });
  assert("button count ≠ spec → skip", planMigration(btn).find((p: any) => p.key === "supplier_ask").action === "skip");
  const noHdr = new Map(inv); noHdr.set("utak_quotation_pdf_v1", { ...inv.get("utak_quotation_pdf_v1"), components: [{ type: "BODY", text: spec("customer_quotation_pdf").body }] });
  assert("quotation without DOCUMENT header → skip", planMigration(noHdr).find((p: any) => p.key === "customer_quotation_pdf").action === "skip");

  // 2026-09-25 — what Meta shows today: v2 / v1 moved to MARKETING after approval.
  const today = new Map<string, any>([
    ["utak_owner_alert_v2", meta("utak_owner_alert_v2", "APPROVED", "MARKETING")],
    ["utak_purchase_list_remind_v1", meta("utak_purchase_list_remind_v1", "APPROVED", "MARKETING")],
  ]);
  const p0 = planMigration(today);
  const pb = (k: string, pl = p0) => pl.find((p: any) => p.key === k);
  assert("owner_alert: v2 MARKETING, v3 missing → skip (never the MARKETING one)", pb("owner_alert").action === "skip" && /MARKETING/.test(pb("owner_alert").why), pb("owner_alert").why);
  assert("purchase_list_remind: v1 MARKETING, v2 missing → skip", pb("purchase_list_remind").action === "skip" && /MARKETING/.test(pb("purchase_list_remind").why));
  const pending = new Map(today);
  pending.set("utak_owner_alert_v3", meta("utak_owner_alert_v3", "PENDING"));
  pending.set("utak_purchase_list_remind_v2", meta("utak_purchase_list_remind_v2", "APPROVED", "MARKETING"));
  const p1 = planMigration(pending);
  assert("v3 PENDING → skip", pb("owner_alert", p1).action === "skip" && /PENDING/.test(pb("owner_alert", p1).why), pb("owner_alert", p1).why);
  assert("v2 also MARKETING → skip", pb("purchase_list_remind", p1).action === "skip");
  const ok = new Map(today);
  ok.set("utak_owner_alert_v3", meta("utak_owner_alert_v3", "APPROVED"));
  ok.set("utak_purchase_list_remind_v2", meta("utak_purchase_list_remind_v2", "APPROVED"));
  const p2 = planMigration(ok);
  assert("v3 APPROVED UTILITY with 2 variables → move to v3", pb("owner_alert", p2).action === "move" && pb("owner_alert", p2).to === "utak_owner_alert_v3", JSON.stringify(pb("owner_alert", p2)));
  assert("…labelled as the third wording", pb("owner_alert", p2).label === "تنبيه تشغيلي (للمالك) — الصياغة الثالثة");
  assert("v2 APPROVED UTILITY with 3 variables → move to v2", pb("purchase_list_remind", p2).action === "move" && pb("purchase_list_remind", p2).to === "utak_purchase_list_remind_v2");
  const wrong = new Map(ok);
  wrong.set("utak_purchase_list_remind_v2", meta("utak_purchase_list_remind_v2", "APPROVED", "UTILITY", "تحديث من يو تاك: قائمة يوم {{1}} وعدد أصنافها {{2}} بانتظار التأكيد."));
  assert("v2 approved with 2 variables (code sends 3) → skip", pb("purchase_list_remind", planMigration(wrong)).action === "skip" && /variables/.test(pb("purchase_list_remind", planMigration(wrong)).why));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
