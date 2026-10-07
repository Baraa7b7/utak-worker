// § 59 أ (2026-10-06) — Omar is marketing; his operating tasks are Baraa's, through the roles.
//
//   [أ3] the cost guard: the working days come from the company's schedule (the settings), whoever
//        holds «سائق» — the tenant's lines of 2026-10-06 give 641.23 before the roles move and after
//   [أ1] the gateway: the team's purposes reach Baraa while — and only while — he holds a team role
//   [أ1] the roles: who holds what, the tasks that follow them, his «بدء الدوام» and what his tap releases
//   [أ1] his messages: his own (the price review, «✅ وصل», the expense, a delivery from the car) where
//        they always were; any other one is a member's
//   [أ1] the end-of-shift reminders, to him and in words that are not about him
//   [أ2] Omar: no 02:30 ask, no «بدء الدوام», no task
//   [أ4] «في الطريق … مع فريق يو تاك» when Baraa delivers, or no driver is on record
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s59-team.test.mts

import { CUST2, CUST2_PHONE, COLL, OWNER, WH, WH_PHONE, closeOwnerWindow, ctx, employee, graph, inbound, odooLog, openWindow, order, quiet, rows, seed, sentTo, setRiyadh, signed, table, workSchedule } from "./wa-harness.mts";
import { AHMED, ALL_WEEK, C1, C1_PHONE, DRIVER, DRIVER_PHONE, OMAR_EMP, assert, cost, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

const OC = await import("../src/operating-cost.ts");
const ATT = await import("../src/attendance.ts");
const OT = await import("../src/owner-team.ts");
const OFD = await import("../src/out-for-delivery.ts");
const DF = await import("../src/driver-followup.ts");
const PS = await import("../src/price-sources.ts");
const { sendText } = await import("../src/meta.ts");
const { getTeamMembersByRole, getCollectorTeamMembers, findTeamMemberByWhatsApp } = await import("../src/odoo.ts");
const { invalidateRoster } = await import("../src/team-roster.ts");
const worker = (await import("../src/index.ts")).default;

const OWNER_PID = 45, OWNER_EMP = 7000 + OWNER_PID;
const MARKETING = 74;
const D6 = "2026-10-06";
const SIX_DAYS: Array<[number, number, number]> = ALL_WEEK.filter(([d]) => d !== 4); // no Friday
const body = (b: any): string => String(b?.text?.body ?? b?.interactive?.body?.text ?? "");
const textsTo = (digits: string) => sentTo(digits).map(body);
const post = async (env: any, from: string, m: Record<string, unknown>) => { await quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx)); };
const button = (id: string) => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } });
const text = (t: string) => ({ type: "text", text: { body: t } });
const emp = (id: number) => table("hr.employee").get(id) as any;
const config = () => table("x_pricing_config").get(1) as any;

/** The tenant's cost lines in force on 2026-10-06 (the dyna, the market's fee, the cart; Odoo, Claude, the lines). */
function tenantCosts(): void {
  cost(500, "2026-10-06", { x_name: "دينة مؤقتة" });
  cost(83, "2026-10-01", { x_name: "رسوم دخول السوق" });
  cost(50, "2026-10-01", { x_name: "العربية" });
  for (const [name, amount] of [["اشتراك Odoo", 80], ["Claude API", 75], ["الرصيد والاتصالات", 100]] as const) cost(amount, "2026-10-01", { x_name: name, x_frequency: "monthly", x_cost_type: "fixed" });
  // Omar's five lines, closed 2026-10-05: out of the day
  cost(4000, "2026-10-01", { x_name: "راتب عمر", x_frequency: "monthly", x_date_to: "2026-10-05" });
  cost(11000, "2026-10-01", { x_name: "تجديد إقامة عمر", x_frequency: "yearly", x_date_to: "2026-10-05" });
}
/** Before § 59: Omar holds the three roles, on attendance, a price source; nobody else holds one. */
function before59(riyadh = `${D6} 09:00`): any {
  const env = fresh(riyadh);
  seed("x_employee_role", { id: MARKETING, x_code: "marketing", x_name: "تسويق", x_active: true });
  emp(7000 + WH).x_utak_role_ids = [];
  emp(7000 + COLL).x_utak_role_ids = [];
  Object.assign(emp(OMAR_EMP), { x_utak_role_ids: [71, 72, 73], x_utak_attendance: true, x_price_source: true, x_price_role: "market" });
  seed("res.partner", { id: OWNER_PID, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER, customer_rank: 1 });
  return env;
}
/** What scripts/s59-20261006-odoo.mjs writes: the company's schedule on the settings, Baraa's employee with the three roles, Omar marketing alone. */
function move59(env: any, o: { calendar?: Array<[number, number, number]> } = {}): number {
  const cal = workSchedule(o.calendar ?? ALL_WEEK, { name: "UTAK — أيام العمل" });
  config().x_workdays_calendar_id = cal;
  employee(OWNER_PID, [71, 72, 73], { name: "براء", x_utak_attendance: true, resource_calendar_id: cal });
  Object.assign(emp(OMAR_EMP), { x_utak_role_ids: [MARKETING], x_utak_attendance: false, x_price_source: false });
  env.MSG_DEDUP.store.delete("team:roster:v1"); env.MSG_DEDUP.store.delete("team:roles:v1");
  for (const k of [...env.MSG_DEDUP.store.keys()]) if (String(k).startsWith("cost:workdays:")) env.MSG_DEDUP.store.delete(k);
  return cal;
}
const after59 = (riyadh = `${D6} 09:00`, o: { calendar?: Array<[number, number, number]> } = {}): any => { const env = before59(riyadh); move59(env, o); return env; };

// ================================================================ أ3 — the cost guard
console.log("\n[أ3] the cost of 2026-10-06 = 641.23 before the roles move and after; the working days are the company's");
{
  let env = before59();
  tenantCosts();
  const b = await quiet(() => OC.dailyOperatingCost(env, D6));
  assert("before: 641.23 (500 + 83 + 50 + 255 ÷ 31), the working days from the driver's schedule (Omar's)", b.total === 641.23 && b.monthWorkingDays === 31 && b.source === "driver" && b.driver === "عمر المجهلي", JSON.stringify([b.total, b.monthWorkingDays, b.source, b.driver]));

  // the roles move and the settings name NO schedule: the failure the order guards against
  env = before59(); tenantCosts();
  Object.assign(emp(OMAR_EMP), { x_utak_role_ids: [MARKETING] });
  const lost = await quiet(() => OC.dailyOperatingCost(env, D6));
  assert("without the company's schedule, moving «سائق» off Omar makes the cost «تعذّر»", lost.total === null && lost.source === null && !!lost.reason?.includes("لا جدول دوام للسائق"), JSON.stringify([lost.total, lost.reason]));

  env = after59(); tenantCosts();
  const a = await quiet(() => OC.dailyOperatingCost(env, D6));
  assert("after: 641.23 again, the working days from «UTAK — أيام العمل» (the settings)", a.total === 641.23 && a.monthWorkingDays === 31 && a.workingDay === true && a.source === "company" && a.driver === "UTAK — أيام العمل", JSON.stringify([a.total, a.monthWorkingDays, a.source, a.driver]));
  assert("…each line's share as before (the dailies whole, the monthlies ÷ 31)", JSON.stringify(a.items.map((i: any) => Math.round(i.perDay * 100) / 100)) === JSON.stringify(b.items.map((i: any) => Math.round(i.perDay * 100) / 100)));

  // it does not follow whoever holds «سائق»
  emp(OWNER_EMP).x_utak_role_ids = [71, 73];           // nobody is a driver
  env.MSG_DEDUP.store.delete("team:roster:v1");
  const none = await quiet(() => OC.dailyOperatingCost(env, D6));
  assert("nobody holds «سائق»: still 641.23", none.total === 641.23 && none.source === "company", JSON.stringify([none.total, none.source]));
  emp(OWNER_EMP).x_utak_role_ids = [71, 72, 73];
  Object.assign(emp(OMAR_EMP), { x_utak_role_ids: [72], resource_calendar_id: workSchedule(SIX_DAYS, { name: "ستة أيام" }) });
  env.MSG_DEDUP.store.delete("team:roster:v1");
  const other = await quiet(() => OC.dailyOperatingCost(env, D6));
  assert("a driver with a 6-day schedule beside it: still the company's 31 days", other.total === 641.23 && other.monthWorkingDays === 31, JSON.stringify([other.total, other.monthWorkingDays]));

  // the company's schedule IS what is read: six days give 26 working days in October 2026 (five Fridays)
  env = after59(`${D6} 09:00`, { calendar: SIX_DAYS }); tenantCosts();
  const six = await quiet(() => OC.dailyOperatingCost(env, D6));
  assert("the company's schedule with no Friday: 26 working days in October, 642.81 (500 + 83 + 50 + 255 ÷ 26)", six.monthWorkingDays === 26 && six.total === 642.81, JSON.stringify([six.total, six.monthWorkingDays]));
  const fri = await quiet(() => OC.dailyOperatingCost(env, "2026-10-09"));
  assert("…and its Friday carries the dailies alone (633.00)", fri.workingDay === false && fri.total === 633, JSON.stringify([fri.total, fri.workingDay]));

  // a schedule with no line at all: «تعذّر», never a guess — and it says where
  env = after59(`${D6} 09:00`, { calendar: [] }); tenantCosts();
  const empty = await quiet(() => OC.dailyOperatingCost(env, D6));
  assert("the company's schedule without a line: «تعذّر» with its own reason", empty.total === null && empty.reason === OC.NO_COMPANY_DAYS_REASON, JSON.stringify([empty.total, empty.reason]));

  // one read of the settings for the sends of five minutes
  env = after59(); tenantCosts();
  odooLog.length = 0;
  await quiet(() => OC.dailyOperatingCost(env, D6));
  await quiet(() => OC.dailyOperatingCost(env, D6));
  const reads = odooLog.filter((l) => l.model === "x_pricing_config" && (l.body?.fields ?? []).includes("x_workdays_calendar_id")).length;
  assert("the settings' schedule is read once for two computations (KV, 5 minutes)", reads === 1, String(reads));
  assert("…and its lines come with the roster (Baraa is on it): no read of the schedule's lines of its own", odooLog.filter((l) => l.model === "resource.calendar.attendance").length <= 1, String(odooLog.filter((l) => l.model === "resource.calendar.attendance").length));

  // the field cannot be read (the code deployed on a tenant without it): the driver's schedule, as before
  env = before59(); tenantCosts();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.includes("/x_pricing_config/search_read") && String(init?.body ?? "").includes("x_workdays_calendar_id")) return new Response(JSON.stringify({ name: "builtins.ValueError", message: "Invalid field 'x_workdays_calendar_id' on 'x_pricing_config'" }), { status: 500 });
    return realFetch(input, init);
  }) as typeof fetch;
  const fb = await quiet(() => OC.dailyOperatingCost(env, D6));
  globalThis.fetch = realFetch;
  assert("the field unreadable: the driver's schedule as before § 59 (641.23), not «تعذّر»", fb.total === 641.23 && fb.source === "driver", JSON.stringify([fb.total, fb.source]));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ أ1 — the gateway
console.log("\n[أ1] the gateway: a team purpose reaches Baraa while he holds a team role, and only then");
{
  let env = before59();
  const no = await quiet(() => sendText(env, "+" + OWNER, "قائمة الشراء", { purpose: "purchase_list" }));
  assert("before: «قائمة الشراء» to Baraa's number is refused (403), nothing sent", no.status === 403 && sentTo(OWNER).length === 0, String(no.status));
  assert("…he is not on the team", (await OT.ownerOnTeam(env)) === false);

  env = after59();
  assert("after: he is on the team", (await OT.ownerOnTeam(env)) === true);
  for (const p of ["purchase_list", "driver_stop", "collection_request", "collection_summary", "driver_stops_left", "shift_ack", "bot_reply", "car_load_form", "custody_form", "purchase_receipt_form", "delivery_form"]) {
    graph.length = 0;
    const r = await quiet(() => sendText(env, "+" + OWNER, `مهمة ${p}`, { purpose: p }));
    assert(`«${p}» reaches Baraa as a member's`, r.ok && sentTo(OWNER).length === 1 && body(sentTo(OWNER)[0]) === `مهمة ${p}`, String(r.status));
  }
  graph.length = 0;
  for (const p of ["customer_prices", "customer_quotation", "customer_order_confirm", "customer_invoice", "supplier_ask", "market_price_ask", "team_shift_start", "customer_welcome"]) {
    const r = await quiet(() => sendText(env, "+" + OWNER, "x", { purpose: p }));
    assert(`«${p}» is still refused for him (403)`, r.status === 403, String(r.status));
  }
  assert("…and none of them went", sentTo(OWNER).length === 0, String(sentTo(OWNER).length));
  // an owner's purpose still reaches no other number, and a team purpose still reaches the other members
  seed("res.partner", { id: 833, name: "سائق الدينة", x_whatsapp_number: "+966500000833" });
  employee(833, [72]);
  await invalidateRoster(env);
  openWindow(env, "966500000833");
  const leak = await quiet(() => sendText(env, "+966500000833", "تنبيه", { purpose: "owner_alert" }));
  const team = await quiet(() => sendText(env, "+966500000833", "توصيلة", { purpose: "driver_stop" }));
  assert("an owner's purpose to another member: refused; a team purpose to him: sent", leak.status === 403 && team.ok && sentTo("966500000833").length === 1, `${leak.status} / ${team.status}`);
  // the roles go back: the guard shuts again with no deploy
  emp(OWNER_EMP).x_utak_role_ids = [];
  await invalidateRoster(env);
  const back = await quiet(() => sendText(env, "+" + OWNER, "قائمة الشراء", { purpose: "purchase_list" }));
  assert("his roles taken back in Odoo: refused again", back.status === 403, String(back.status));
  // a roster that cannot be read: shut, not guessed
  env = after59();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.includes("/hr.employee/search_read")) return new Response("down", { status: 400 });
    return realFetch(input, init);
  }) as typeof fetch;
  const down = await quiet(() => sendText(env, "+" + OWNER, "قائمة الشراء", { purpose: "purchase_list" }));
  globalThis.fetch = realFetch;
  assert("the roster unreadable: a team purpose stays refused for him", down.status === 403, String(down.status));
}
{
  const { PURPOSES } = await import("../src/wa-purposes.ts");
  assert("OWNER_TEAM_PURPOSES: every one is in the gateway's table, and none is an owner's or a customer's", [...OT.OWNER_TEAM_PURPOSES].every((p) => p in PURPOSES && !p.startsWith("owner_") && !p.startsWith("customer_") && !p.startsWith("supplier_")), [...OT.OWNER_TEAM_PURPOSES].filter((p) => !(p in PURPOSES)).join(","));
  assert("…«بدء الدوام» is not one of them (his goes once, under owner_window)", !OT.OWNER_TEAM_PURPOSES.has("team_shift_start"));
}

// ================================================================ أ1 — the roles and the tasks
console.log("\n[أ1] the roles: Baraa holds the three, Omar «تسويق» alone; the tasks follow them");
{
  const env = after59();
  const names = async (role: any) => (await getTeamMembersByRole(env, role)).map((m: any) => m.id).join();
  assert("«سائق», «شراء» and «محصّل» are Baraa's alone", (await names("driver")) === String(OWNER_PID) && (await names("warehouse")) === String(OWNER_PID) && (await names("collector")) === String(OWNER_PID) && (await getCollectorTeamMembers(env)).length === 1, `${await names("driver")} / ${await names("warehouse")} / ${await names("collector")}`);
  const omar = await findTeamMemberByWhatsApp(env, "+" + DRIVER_PHONE);
  assert("Omar is still a member (his number is the team's), role «تسويق» alone", !!omar && omar.x_role_codes?.join() === "marketing", JSON.stringify(omar?.x_role_codes));

  // no hold about Baraa, whatever the hour
  for (const at of [`${D6} 01:00`, `${D6} 02:30`, `${D6} 13:00`, `${D6} 21:15`]) {
    setRiyadh(at);
    const h = await quiet(() => ATT.holdForTask(env, OWNER_PID, { kind: "purchase_list", label: "قائمة الشراء" }));
    assert(`${at.slice(11)}: a task of his is not held`, h.hold === false, JSON.stringify(h));
  }
  assert("…and no «مهمة لـبراء بعد دوامه» is ever sent", !ownerTexts().some((t) => t.includes("بعد دوامه")), ownerTexts().join(" | "));

  // 18:00: the collection list is his
  setRiyadh(`${D6} 18:00`);
  const oid = order(C1, "delivered", D6, 1, { x_delivered_at: `${D6} 08:00:00` });
  seed("x_invoice", { x_invoice_number: "INV-2026-0900", x_order_id: oid, x_customer_id: C1, x_total: 230, x_amount_paid: 0, x_status: "issued", x_invoice_date: D6, x_utak_simulation: false, x_is_simulation: false });
  graph.length = 0;
  const { sendDailyCollectionSummary } = await import("../src/invoice.ts");
  await quiet(() => sendDailyCollectionSummary(env));
  assert("18:00: the collection list reaches Baraa (the collector now), not Omar", sentTo(OWNER).some((b) => JSON.stringify(b).includes("INV-2026-0900")) && sentTo(DRIVER_PHONE).length === 0, JSON.stringify(sentTo(OWNER)).slice(0, 300));
}

console.log("\n[أ1] «بدء الدوام»: his one template at his own shift (02:00), and his tap releases his tasks");
{
  const env = after59(`${D6} 01:55`);
  seed("x_whatsapp_template", { x_purpose: "team_shift_start", x_meta_template_id: "utak_shift_start_v2", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 1, x_category: "UTILITY" });
  const tpl = (d: string) => sentTo(d).filter((b) => b?.template?.name === "utak_shift_start_v2");
  await quiet(() => ATT.runAttendanceTick(env));
  assert("01:55: nothing yet", tpl(OWNER).length === 0);
  setRiyadh(`${D6} 02:00`);
  const r = await quiet(() => ATT.runAttendanceTick(env));
  assert("02:00: «بدء الدوام» to Baraa («براء»), once — by his own schedule", tpl(OWNER).length === 1 && r.owner.at === "02:00" && r.owner.source === ATT.OWNER_OWN_SHIFT, JSON.stringify(r.owner));
  assert("…and none to Omar (off attendance)", tpl(DRIVER_PHONE).length === 0 && !r.members.some((m: any) => m.action === "start_sent"), JSON.stringify(r.members));
  for (const at of ["02:30", "03:00", "06:00", "06:05"]) { setRiyadh(`${D6} ${at}`); await quiet(() => ATT.runAttendanceTick(env)); }
  assert("no reminder, no second one at 06:00, no «لم يسجّل حضوره», no «غائب», no row", tpl(OWNER).length === 1 && !ownerTexts().some((t) => t.includes("لم يسجّل حضوره") || t.includes("غائب")) && rows("x_team_attendance").length === 0, ownerTexts().join(" | "));

  // his tap: the one line, then his tasks — the open purchase list (he is the buyer) and the uncollected invoice
  seed("x_purchase_list", { id: 31, x_date: "2026-10-05", x_status: "sent", x_supplier_id: AHMED, x_aggregated_items: JSON.stringify([{ product_id: 1, product_name: "طماطم", packaging_id: 11, packaging_name: "كرتون", total_quantity: 4, order_ids: [] }]), x_total_items_count: 1, x_utak_simulation: false });
  setRiyadh(`${D6} 02:03`);
  graph.length = 0;
  await post(env, OWNER, button("shift_start"));
  const got = textsTo(OWNER);
  assert("his tap: «✅ تم. تنبيهات يو تاك…» first", got[0]?.startsWith("✅ تم. تنبيهات يو تاك"), got[0]);
  assert("…then the open purchase list with its buttons", got.some((t) => t.includes("🛒 قائمة الشراء #31") && t.includes("طماطم")), got.join(" | "));
  assert("…no «ما عندك مهام», and nothing recorded about him", !got.some((t) => t.includes("ما عندك مهام")) && rows("x_team_attendance").length === 0, got.join(" | "));
  // with nothing open: the one line alone
  table("x_purchase_list").get(31)!.x_status = "done";
  graph.length = 0;
  await post(env, OWNER, button("shift_start"));
  assert("nothing open: the one line alone (no «ما عندك مهام» to him)", textsTo(OWNER).length === 1 && textsTo(OWNER)[0].startsWith("✅ تم."), textsTo(OWNER).join(" | "));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ أ1 — his messages
console.log("\n[أ1] his messages: his own where they always were; any other is a member's");
{
  for (const [id, own] of [
    ["prv_a_55_3", true], ["prvt_r_55_3", true], ["pexc_m_12", true], ["aftest_transfer", true], ["trn_ok_abc", true], ["trn_no_abc", true],
    ["cmp_comp_7", true], ["cmp_reject_7", true], ["dlv_12", true], ["delivered_12", true], ["expense_start", true], ["exp_undo_44", true],
    ["owner_summary_ack", true], ["owner_price_review", true],
    ["shift_start", false], ["purchased_31", false], ["prc_31", false], ["collect_cash_9", false], ["cl_load", false], ["issue_12", false], ["sp_start", false],
  ] as const) {
    assert(`${id}: ${own ? "his own" : "a member's"}`, OT.isOwnerOwnMessage({ type: "interactive", buttonId: id } as any) === own);
  }
  assert("«مصروف» and «تسليم 12» are his own; «حمولة», «عهدة», «استلام» and any other text are a member's",
    OT.isOwnerOwnMessage({ type: "text", text: "مصروف" } as any) && OT.isOwnerOwnMessage({ type: "text", text: "تسليم 12" } as any)
    && !OT.isOwnerOwnMessage({ type: "text", text: "حمولة" } as any) && !OT.isOwnerOwnMessage({ type: "text", text: "عهدة" } as any)
    && !OT.isOwnerOwnMessage({ type: "text", text: "استلام" } as any) && !OT.isOwnerOwnMessage({ type: "text", text: "السلام عليكم" } as any));
  assert("a template's quick reply counts as a button; an image is nobody's own", OT.isOwnerOwnMessage({ type: "button", buttonId: "delivered_12" } as any) && !OT.isOwnerOwnMessage({ type: "image" } as any));

  const env = after59(`${D6} 09:00`);
  // his own: «مصروف» → the expense form, under his own purpose (the owner's branch)
  graph.length = 0;
  await post(env, OWNER, text("مصروف"));
  assert("«مصروف» from him: his expense module answers, as before (not the team's «استخدم الأزرار», not the purchase list)", textsTo(OWNER).length === 1 && textsTo(OWNER)[0].includes("لا يُسجَّل مصروف من هنا"), textsTo(OWNER).join(" | "));
  // his own buttons: answered by their own modules, never by the team's router («هذا الزر من رسالة قديمة…»)
  const OLD_BUTTON = "هذا الزر من رسالة قديمة";
  graph.length = 0;
  await post(env, OWNER, button("prv_a_55_3"));
  assert("a price review's button from him: the review answers («ما لقينا سجل أسعار هذا اليوم»)", textsTo(OWNER).length === 1 && textsTo(OWNER)[0].includes("ما لقينا سجل أسعار"), textsTo(OWNER).join(" | "));
  graph.length = 0;
  await post(env, OWNER, button("cmp_comp_7"));
  assert("a complaint's decision from him: the complaints answer («الملاحظة #7 غير موجودة»)", textsTo(OWNER).length === 1 && textsTo(OWNER)[0].includes("الملاحظة #7 غير موجودة"), textsTo(OWNER).join(" | "));
  graph.length = 0;
  await post(env, OWNER, button("trn_ok_nothere"));
  assert("«✅ وصل» of a notice that is not there: the transfers' silence, not the team's «زر قديم»", !textsTo(OWNER).some((t) => t.includes(OLD_BUTTON)), textsTo(OWNER).join(" | "));
  graph.length = 0;
  await post(env, OWNER, button("zzz_unknown"));
  assert("a button that is not his own is a member's (the router answers it)", textsTo(OWNER).some((t) => t.includes(OLD_BUTTON)), textsTo(OWNER).join(" | "));
  // a member's: «حمولة» → the car-load form (he is the driver)
  graph.length = 0;
  await post(env, OWNER, text("حمولة"));
  assert("«حمولة» from him: the car-load form (he is the driver now)", sentTo(OWNER).some((b) => b?.interactive?.type === "flow"), JSON.stringify(sentTo(OWNER)).slice(0, 300));
  // a member's: «عهدة» → the custody form (he is the collector)
  graph.length = 0;
  await post(env, OWNER, text("عهدة"));
  assert("«عهدة» from him: the custody form (he is the collector now)", sentTo(OWNER).some((b) => b?.interactive?.type === "flow"), JSON.stringify(sentTo(OWNER)).slice(0, 300));
  // a member's: any other text → the open purchase list (he is the buyer), or the team's line
  seed("x_purchase_list", { id: 32, x_date: D6, x_status: "sent", x_supplier_id: AHMED, x_aggregated_items: JSON.stringify([{ product_id: 2, product_name: "خيار", packaging_id: 21, packaging_name: "جرم", total_quantity: 2, order_ids: [] }]), x_total_items_count: 1, x_utak_simulation: false });
  graph.length = 0;
  await post(env, OWNER, text("وين القائمة"));
  assert("any other text from him: the open purchase list, as a buyer gets it", textsTo(OWNER).some((t) => t.includes("🛒 قائمة الشراء #32")), textsTo(OWNER).join(" | "));
  assert("he never enters the customer path (no order, no welcome, no partner made)", rows("x_daily_order").length === 0 && !sentTo(OWNER).some((b) => b?.template?.name === "utak_welcome") && rows("res.partner").filter((p: any) => String(p.x_whatsapp_number || "").includes(OWNER)).length === 1);

  // before § 59 (no role): the same texts are answered by nothing, as they were
  const env0 = before59(`${D6} 09:00`);
  graph.length = 0;
  await post(env0, OWNER, text("حمولة"));
  await post(env0, OWNER, text("وين القائمة"));
  assert("without a role: «حمولة» and a free text from him are answered by nothing, as before", sentTo(OWNER).length === 0, JSON.stringify(sentTo(OWNER)).slice(0, 200));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ أ1 — the end of the shift
console.log("\n[أ1] 11:30 and 12:30: the open stops to Baraa, in words that are not about him");
{
  const world = (riyadh: string) => {
    const env = after59(riyadh);
    const route = seed("x_delivery_route", { x_driver_id: OWNER_PID, x_date: D6, x_status: "dispatched", x_dispatched_at: `2026-10-05 18:30:00`, x_total_stops: 2, x_stops_completed: 0 });
    const ids = [C1, CUST2].map((c, i) => {
      const id = order(c, "in_delivery", D6, 1, { x_utak_simulation: false });
      seed("x_delivery_stop", { x_route_id: route, x_order_id: id, x_sequence: (i + 1) * 10, x_status: "pending" });
      return id;
    });
    return { env, route, ids };
  };
  let w = world(`${D6} 11:30`);
  graph.length = 0;
  let r = await quiet(() => DF.runDriverFollowupTick(w.env));
  const remind = textsTo(OWNER).filter((t) => t.includes("باقي 30 دقيقة"));
  assert("11:30: «⏰ باقي 30 دقيقة على نهاية دوامك (12:00)…» to Baraa, with the two customers", remind.length === 1 && remind[0].includes("(12:00)") && remind[0].includes("محطتان") && remind[0].includes("مطعم الوادي"), JSON.stringify(r.drivers) + " " + textsTo(OWNER).join(" | "));
  await quiet(() => DF.runDriverFollowupTick(w.env));
  assert("…once", textsTo(OWNER).filter((t) => t.includes("باقي 30 دقيقة")).length === 1);

  w = world(`${D6} 12:30`);
  graph.length = 0;
  r = await quiet(() => DF.runDriverFollowupTick(w.env));
  const after = textsTo(OWNER);
  assert("12:30: «🚚 انتهى وقت التوصيل الساعة 12:00، وبقي طلبان…» with the order numbers", after.length === 1 && after[0].startsWith("🚚 انتهى وقت التوصيل الساعة 12:00") && after[0].includes("طلبان") && w.ids.every((id) => after[0].includes(`#${id}`)), after.join(" | "));
  assert("…and not «براء: انتهى دوامه»", !after.some((t) => t.includes("انتهى دوامه")), after.join(" | "));
  assert("the words of another driver are as they were", DF.ownerAfterShiftText("سالم", [{ stopId: 1, routeId: 1, orderId: 7, customerName: "أ", status: "pending" }], 720).startsWith("🚚 سالم: انتهى دوامه الساعة 12:00"));

  // a day his schedule gives him no shift: nothing about him, even with stops open
  w = world(`2026-10-09 18:00`);
  emp(OWNER_EMP).resource_calendar_id = workSchedule(SIX_DAYS);
  await invalidateRoster(w.env);
  table("x_delivery_route").get(w.route)!.x_dispatched_at = "2026-10-08 18:30:00";
  graph.length = 0;
  r = await quiet(() => DF.runDriverFollowupTick(w.env));
  assert("his day off with stops open: no alert that names him", sentTo(OWNER).length === 0 && JSON.stringify(r.drivers).includes("owner"), JSON.stringify(r.drivers) + textsTo(OWNER).join(" | "));
  emp(OWNER_EMP).x_utak_attendance = false;
  await invalidateRoster(w.env);
  r = await quiet(() => DF.runDriverFollowupTick(w.env));
  assert("off attendance: no «براء بلا جدول دوام مفعّل» either", sentTo(OWNER).length === 0, textsTo(OWNER).join(" | "));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ أ2 — Omar
console.log("\n[أ2] Omar: no 02:30 ask, no 05:00 reminder, no «بدء الدوام», no task");
{
  // before: he is asked
  let env = before59(`${D6} 02:30`);
  openWindow(env, DRIVER_PHONE);
  table("x_team_attendance"); seed("x_team_attendance", { x_employee_id: OMAR_EMP, x_partner_id: DRIVER, x_date: D6, x_shift_at: "2026-10-05 23:00:00", x_sent_at: "2026-10-05 23:00:00", x_tapped_at: "2026-10-05 23:01:00", x_status: "present", x_reminder_sent: false, x_utak_simulation: false });
  let r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  assert("before: the 02:30 ask names Omar", (r.asks ?? []).some((a: any) => a.name === "عمر المجهلي"), JSON.stringify(r.asks));

  env = after59(`${D6} 02:30`);
  seed("res.partner", { id: 109, name: "رائد", x_whatsapp_number: "+966500000109", x_price_source: true, x_price_role: "market", x_supplier_state: "approved", supplier_rank: 0, customer_rank: 0 });
  openWindow(env, DRIVER_PHONE); openWindow(env, "966500000109");
  graph.length = 0;
  r = await quiet(() => PS.runMarketAsk(env, Date.now(), 6 * 60));
  assert("after: 02:30 asks رائد, never Omar", (r.asks ?? []).some((a: any) => a.name === "رائد") && !(r.asks ?? []).some((a: any) => a.name === "عمر المجهلي") && sentTo(DRIVER_PHONE).length === 0, JSON.stringify(r.asks));
  setRiyadh(`${D6} 05:00`);
  const n = await quiet(() => PS.runMarketNudge(env, Date.now(), 6 * 60));
  assert("…and the 05:00 reminder does not name him", !(n.nudges ?? []).some((a: any) => a.name === "عمر المجهلي") && sentTo(DRIVER_PHONE).length === 0, JSON.stringify(n.nudges));
  assert("his «دور الأسعار» stays on his card (switched off, not deleted)", emp(OMAR_EMP).x_price_role === "market" && emp(OMAR_EMP).x_price_source === false);

  // no task is his: nothing is held for him, and Baraa is told nothing about «مهمة لعمر بعد دوامه»
  setRiyadh(`${D6} 21:15`);
  const h = await quiet(() => ATT.holdForTask(env, DRIVER, { kind: "purchase_list", label: "قائمة الشراء" }));
  assert("Omar is off attendance: never held, and no «مهمة لعمر بعد دوامه» to Baraa", h.hold === false && h.onAttendance === false && !ownerTexts().some((t) => t.includes("بعد دوامه")), JSON.stringify(h));
  assert("the purchase list and the collections are not his", (await getTeamMembersByRole(env, "warehouse")).every((m: any) => m.id !== DRIVER) && (await getCollectorTeamMembers(env)).every((m: any) => m.id !== DRIVER));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// ================================================================ أ4 — «في الطريق»
console.log("\n[أ4] «في الطريق إليك الآن مع فريق يو تاك» when Baraa delivers, or no driver is on record");
{
  assert("the label: a name → «السائق …»; none → «فريق يو تاك»", OFD.driverLabel("سالم") === "السائق سالم" && OFD.driverLabel("") === "فريق يو تاك" && OFD.driverLabel("   ") === OFD.TEAM_LABEL);
  assert("the text and the template's {{2}}", OFD.ofdText(41, "") === "🚚 طلبك رقم #41 في الطريق إليك الآن مع فريق يو تاك. يو تاك" && OFD.ofdParams(41, "").join("|") === "41|فريق يو تاك" && OFD.ofdText(41, "سالم").includes("مع السائق سالم."));
  const world = (driver: number | false) => {
    const env = after59(`${D6} 08:00`);
    seed("x_whatsapp_template", { x_purpose: "customer_delivery_incoming", x_meta_template_id: "utak_out_for_delivery", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
    const route = seed("x_delivery_route", { x_driver_id: driver, x_date: D6, x_status: "dispatched", x_dispatched_at: `${D6} 04:30:00`, x_total_stops: 1, x_stops_completed: 0 });
    const id = order(C1, "in_delivery", D6, 1, { x_utak_simulation: false });
    seed("x_delivery_stop", { x_route_id: route, x_order_id: id, x_sequence: 10, x_status: "pending" });
    return { env, route, id };
  };
  // Baraa is the route's driver: inside the customer's window, the text
  let w = world(OWNER_PID);
  openWindow(w.env, C1_PHONE);
  graph.length = 0;
  await quiet(() => OFD.notifyRouteStart(w.env, w.route, "براء"));
  assert("Baraa delivers (the caller passes his name): «مع فريق يو تاك» in the text, never «السائق براء»", textsTo(C1_PHONE).length === 1 && textsTo(C1_PHONE)[0] === `🚚 طلبك رقم #${w.id} في الطريق إليك الآن مع فريق يو تاك. يو تاك`, textsTo(C1_PHONE).join(" | "));
  // …outside the window: the template's {{2}}
  w = world(OWNER_PID);
  graph.length = 0;
  await quiet(() => OFD.notifyRouteStart(w.env, w.route));
  const t = sentTo(C1_PHONE).find((b) => b?.template?.name === "utak_out_for_delivery");
  const p = (t?.template?.components ?? []).find((c: any) => c.type === "body")?.parameters?.map((x: any) => x.text) ?? [];
  assert("…and in the template outside his window: {{2}} = «فريق يو تاك»", p.join("|") === `${w.id}|فريق يو تاك`, JSON.stringify(t?.template));
  // no driver on record
  w = world(false);
  openWindow(w.env, C1_PHONE);
  graph.length = 0;
  await quiet(() => OFD.notifyRouteStart(w.env, w.route));
  assert("a route without a driver: «مع فريق يو تاك»", textsTo(C1_PHONE)[0]?.includes("مع فريق يو تاك."), textsTo(C1_PHONE).join(" | "));
  // another driver: his name, as it was
  w = world(OWNER_PID);
  seed("res.partner", { id: 833, name: "سالم السواق", x_whatsapp_number: "+966500000833" });
  table("x_delivery_route").get(w.route)!.x_driver_id = 833;
  openWindow(w.env, C1_PHONE);
  graph.length = 0;
  await quiet(() => OFD.notifyRouteStart(w.env, w.route, "سالم السواق"));
  assert("another driver: «مع السائق سالم السواق», as it was", textsTo(C1_PHONE)[0]?.includes("مع السائق سالم السواق."), textsTo(C1_PHONE).join(" | "));
  // the next stop after his «تم التسليم» carries the same label
  w = world(OWNER_PID);
  const second = order(CUST2, "in_delivery", D6, 1, { x_utak_simulation: false });
  seed("x_delivery_stop", { x_route_id: w.route, x_order_id: second, x_sequence: 20, x_status: "pending" });
  table("x_delivery_stop").get([...table("x_delivery_stop").keys()][0])!.x_status = "delivered";
  table("x_daily_order").get(w.id)!.x_state = "delivered";
  openWindow(w.env, CUST2_PHONE);
  graph.length = 0;
  await quiet(() => OFD.notifyNextAfterDelivered(w.env, w.id));
  assert("the next stop after his «تم التسليم»: «مع فريق يو تاك» too", textsTo(CUST2_PHONE)[0] === `🚚 طلبك رقم #${second} في الطريق إليك الآن مع فريق يو تاك. يو تاك`, textsTo(CUST2_PHONE).join(" | "));
  assert("schema gate: nothing rejected", rejected.length === 0, rejected.join(" / "));
}

// keep the unused imports honest
void [closeOwnerWindow, WH, WH_PHONE];
done();
