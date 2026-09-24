// The eight new WhatsApp templates (2026-09-25): what the code sends matches
// each template's variables, the code works with the old and the new template
// behind the same purpose, and the deferred migration never moves a purpose
// to a template Meta has not approved (or whose variables do not match).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/wa-templates-new-eight.test.mts

import {
  CUST, OWNER, WH, graph, order, quiet, reset, seed, setFail, setRiyadh, table,
} from "./wa-harness.mts";

const { NEW_EIGHT, placeholders, textProblems } = await import("../scripts/wa-templates-20260925-new-eight.mjs");
const { planMigration } = await import("../scripts/wa-templates-20260925-migrate-when-approved.mjs");
const { CONTRACT, contractParams } = await import("../scripts/wa-templates-20260924-purpose-contract.mjs");
const { clearTemplateCache, sendOwnerAlert, T } = await import("../src/templates.ts");
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
  if (t.retry) assert(`${t.retry.name} (retry): text rules`, textProblems(t, t.retry.body).length === 0, textProblems(t, t.retry.body).join("; "));
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
console.log("\n[2] owner_alert — 1 variable both");
for (const name of ["utak_owner_alert_v2", "utak_owner_alert"]) {
  const env = reset();
  mapPurpose("owner_alert", name, 1);
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
  seed("x_invoice", { x_customer_id: CUST, x_status: "pending", x_invoice_date: "2026-09-01", x_total: 500, x_paid_amount: 0 });
  seed("x_invoice", { x_customer_id: CUST, x_status: "partial", x_invoice_date: "2026-09-05", x_total: 800, x_paid_amount: 50 });
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
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
