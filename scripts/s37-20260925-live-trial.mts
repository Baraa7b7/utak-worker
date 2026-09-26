// STATUS § 37 — the live trial on sim. Real WhatsApp to Baraa (…4962) and
// Ahmed Hassan (…7704) only; every text starts with «🧪 تجربة § 37».
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s37-20260925-live-trial.mts <step>
//
// Steps (in order; ids are kept in scripts/artifacts/s37-20260925-live-trial-ids.json):
//   seed      a trial purchase list (x_is_simulation, «🧪 تجربة § 37», confirmed,
//             2026-09-25, from Ahmed's trial prices of § 35: tomato 3 × 26, cucumber
//             2 × 45, potato 1 × «بلا سعر») → its dues (Ahmed 168.00) and Baraa's
//             «بلا سعر» alert.
//   omar      Omar's two cash payments through the same handlers his WhatsApp
//             messages reach (src/supplier-pay.ts handlePayButton / handlePayText):
//             «💵 دفعت لمورد» → Ahmed → «مية وخمسين» (refused) → 150 → «تخطي»; then
//             40 → «تخطي». The replies to Omar are returned, not sent. Each payment
//             is pending in Odoo, and Baraa gets its alert.
//   approve   the Odoo «اعتماد» check (server action code, not its webhook) on
//             the 150, then the settle here: Ahmed's notice (text inside his window,
//             held outside it — a trial never uses the template), Omar's line
//             intercepted (not sent). Also: the lock refuses an edit.
//   transfer  Baraa's own transfer of 50 created in Odoo as him: approved at once,
//             and the DEPLOYED worker settles it through the webhook. To the test
//             supplier «براء - اختبار» (#7, Baraa's decision: nothing more to Ahmed):
//             its due is 0, so «رصيد دائن» (−50) and the alert to Baraa; its
//             notice is refused by the allowlist.
//   reject    «رفض» without a reason is refused; with one, rejected; the settle
//             here: Omar's line (intercepted), nothing to Ahmed.
//   ahmed-skip  (Baraa's decision) Ahmed is not asked to write: his held notices
//             are checked «⏳ محفوظة» with their full text in his conversation, then
//             taken out of his queue and marked «skipped» («تجربة § 37 — لا تُرسل»),
//             no deletion; the same line turns «⏭️ لم تُرسل».
//   verify    the payments, the dues, the balance, every message in its
//             conversation with its full text, Omar's intercepted lines marked
//             «لم تُرسل», and account.move / account.payment unchanged.
//
// Omar's number (…6832) never receives anything: a Graph send to it is answered
// here (wamid.S37SIM.…), kept out of D1, and its x_wa_message row is then
// marked «skipped» with the reason (its Discuss line follows).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { liveSimEnv } from "./lib/cf-live-env.mjs";

const TAG = "🧪 تجربة § 37";
const step = process.argv[2] ?? "verify";
const AHMED = 30, AHMED_PHONE = "966571777704", AHMED_CHANNEL = 14;
const OMAR = 9, OMAR_PHONE = "966545816832", OMAR_CHANNEL = 19;
const BARAA_PARTNER = 45, BARAA_CHANNEL = 29;
const TEST_SUPPLIER = 7; // «براء - اختبار», +966500000099: not on the allowlist, x_wa_allowed false
const LIST_DAY = "2026-09-25";
const IDS = new URL("./artifacts/s37-20260925-live-trial-ids.json", import.meta.url);
const ids: any = existsSync(IDS) ? JSON.parse(readFileSync(IDS, "utf8")) : { startedAt: new Date(Date.now() - 5000).toISOString() };
const saveIds = () => writeFileSync(IDS, JSON.stringify(ids, null, 2) + "\n");
const out = (name: string, o: unknown) => writeFileSync(new URL(`./artifacts/s37-20260925-live-trial-${name}.json`, import.meta.url), JSON.stringify(o, null, 2) + "\n");
const odooTs = (iso: string) => iso.replace("T", " ").slice(0, 19);
const plain = (html: string) => String(html || "").replace(/<br\s*\/?>/g, "\n").replace(/<\/p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

// ---------------------------------------------------------------- the environment
const env: any = await liveSimEnv();
env.TRIAL_TAG = TAG;
// Omar never receives anything: his sends are answered here, and kept out of D1.
const intercepted: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com") && url.endsWith("/messages") && String(init?.method ?? "GET").toUpperCase() === "POST") {
    const body = JSON.parse(init.body);
    const to = String(body.to ?? "").replace(/\D/g, "");
    if (to === OMAR_PHONE) {
      const wamid = `wamid.S37SIM.${Date.now()}.${intercepted.length + 1}`;
      intercepted.push({ at: new Date().toISOString(), wamid, body });
      return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ input: to, wa_id: to }], messages: [{ id: wamid }] }), { status: 200 });
    }
    if (to !== AHMED_PHONE && to !== "966505154962") throw new Error(`BLOCKED: a trial send to …${to.slice(-4)} (only Baraa and Ahmed)`);
  }
  return realFetch(input, init);
}) as typeof fetch;
// …and his line (approved / rejected) must not wait in his real queue for his
// next message: in THIS process only, his window reads open, so the line goes
// to the Graph interceptor above. The live KV is never written for him.
const realKvGet = env.MSG_DEDUP.get.bind(env.MSG_DEDUP);
env.MSG_DEDUP.get = async (key: string) => (key === `wa_win:v1:${OMAR_PHONE}` ? JSON.stringify({ in: Date.now() - 60_000 }) : realKvGet(key));
const realKvPut = env.MSG_DEDUP.put.bind(env.MSG_DEDUP);
env.MSG_DEDUP.put = async (key: string, value: string, opts?: unknown) => {
  if (key === `wa_win:v1:${OMAR_PHONE}` || key.startsWith(`wa_q:v1:${OMAR_PHONE}`)) throw new Error(`BLOCKED: a trial write to Omar's window / queue (${key})`);
  return realKvPut(key, value, opts);
};
const realPrepare = env.SIM_DB.prepare.bind(env.SIM_DB);
env.SIM_DB.prepare = (sql: string) => {
  const stmt = realPrepare(sql);
  if (!/INSERT INTO sim_outbound/.test(sql)) return stmt;
  return { ...stmt, bind: (...p: unknown[]) => (String(p[2]) === OMAR_PHONE ? { run: async () => ({ skipped: "omar" }) } : stmt.bind(...p)) };
};
const { call } = await import("../src/odoo.ts");
const SP = await import("../src/supplier-pay.ts");
const { recordStateChange } = await import("../src/wa-record.ts");
const OMAR_MEMBER = { id: OMAR, name: "عمر المجهلي", x_whatsapp_number: "+" + OMAR_PHONE, x_role: "warehouse", x_role_codes: ["driver", "warehouse", "collector"] } as any;

async function markIntercepted(): Promise<void> {
  for (const i of intercepted) {
    const rows = await call<any[]>(env, "x_wa_message", "search_read", { domain: [["x_meta_message_id", "=", i.wamid]], fields: ["id"], limit: 1 });
    if (!rows[0]) continue;
    await call(env, "x_wa_message", "write", { ids: [rows[0].id], vals: { x_status: "skipped", x_meta_error: `${TAG}: رد لعمر أُنشئ في التجربة ولم يُرسل (الإرسال الحي لبراء وأحمد فقط).` } });
    await recordStateChange(env, rows[0].id, OMAR_PHONE);
    i.rowId = rows[0].id;
  }
}
async function accounting() {
  return {
    moves: await call<number>(env, "account.move", "search_count", { domain: [] }),
    posted: await call<number>(env, "account.move", "search_count", { domain: [["state", "=", "posted"]] }),
    payments: await call<number>(env, "account.payment", "search_count", { domain: [] }),
  };
}
async function runAction(name: string, id: number): Promise<{ ok: boolean; error?: string }> {
  const [a] = await call<any[]>(env, "ir.actions.server", "search_read", { domain: [["name", "=", name]], fields: ["id"], limit: 1 });
  try {
    await call(env, "ir.actions.server", "run", { ids: [a.id], context: { active_model: "x_supplier_payment", active_id: id, active_ids: [id] } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}
const pay = async (id: number) => (await call<any[]>(env, "x_supplier_payment", "read", { ids: [id], fields: SP.SP_FIELDS }))[0];

// ---------------------------------------------------------------- steps
if (step === "seed") {
  if (ids.listId) throw new Error(`already seeded: list #${ids.listId}`);
  ids.accountingBefore = await accounting();
  const items = [
    { product_id: 71, product_name: "[UTAK-VEG-001] طماطم", packaging_id: 1, packaging_name: "فلين · 5 كيلو", total_quantity: 3, order_ids: [], price_supplier_id: AHMED },
    { product_id: 72, product_name: "[UTAK-VEG-002] خيار", packaging_id: 3, packaging_name: "جرم · 8 كيلو", total_quantity: 2, order_ids: [], price_supplier_id: AHMED },
    { product_id: 73, product_name: "[UTAK-VEG-003] بطاطس", packaging_id: 6, packaging_name: "كرتون · 10 كيلو", total_quantity: 1, order_ids: [], price_supplier_id: AHMED },
  ];
  const [listId] = await call<number[]>(env, "x_purchase_list", "create", { vals_list: [{
    x_name: `${TAG} — قائمة شراء تجريبية`, x_date: LIST_DAY, x_status: "done", x_is_simulation: true,
    x_aggregated_items: JSON.stringify(items), x_total_items_count: items.length,
    x_ahmad_confirmed_at: odooTs(new Date().toISOString()),
    x_notes: `${TAG}: قائمة تجريبية للمستحقات فقط (لا طلبات ولا شراء حقيقي). أسعار أحمد حسان التجريبية #15 و#17 من § 35.`,
  }] });
  ids.listId = listId; saveIds();
  const r = await SP.syncSupplierDues(env, listId);
  out("seed", { listId, dues: r, accountingBefore: ids.accountingBefore });
  console.log(JSON.stringify({ listId, dues: r }, null, 1));
} else if (step === "omar") {
  const replies: any[] = [];
  const say = async (label: string, fn: () => Promise<unknown>) => { const r = await fn(); replies.push({ label, reply: r }); return r; };
  // the first payment: 150 (after a refused word)
  await say("tap «💵 دفعت لمورد»", () => SP.handlePayButton(env, OMAR_MEMBER, SP.SP_START));
  await say(`tap sp_sup_${AHMED}`, () => SP.handlePayButton(env, OMAR_MEMBER, `${SP.SP_SUPPLIER_PREFIX}${AHMED}`));
  await say("text «مية وخمسين»", () => SP.handlePayText(env, OMAR_MEMBER, "مية وخمسين"));
  await say("text «150»", () => SP.handlePayText(env, OMAR_MEMBER, "150"));
  await say("tap «تخطي»", () => SP.handlePayButton(env, OMAR_MEMBER, SP.SP_SKIP));
  // the second payment: 40 (to be rejected)
  await say("tap «💵 دفعت لمورد»", () => SP.handlePayButton(env, OMAR_MEMBER, SP.SP_START));
  await say(`tap sp_sup_${AHMED}`, () => SP.handlePayButton(env, OMAR_MEMBER, `${SP.SP_SUPPLIER_PREFIX}${AHMED}`));
  await say("text «40»", () => SP.handlePayText(env, OMAR_MEMBER, "40"));
  await say("tap «تخطي»", () => SP.handlePayButton(env, OMAR_MEMBER, SP.SP_SKIP));
  const mine = await call<any[]>(env, "x_supplier_payment", "search_read", { domain: [["x_trial_tag", "=", TAG], ["x_channel", "=", "whatsapp"]], fields: ["id", "x_name", "x_amount", "x_state"], order: "id asc" });
  ids.p150 = mine.find((p) => p.x_amount === 150)?.id; ids.p40 = mine.find((p) => p.x_amount === 40)?.id; saveIds();
  out("omar", { replies, payments: mine });
  for (const r of replies) console.log(`${r.label} →`, JSON.stringify(r.reply));
  console.log(JSON.stringify(mine));
} else if (step === "approve") {
  const before = await pay(ids.p150);
  const a = await runAction("utak.sp.approve_check", ids.p150);
  const settled = await SP.settlePayment(env, ids.p150);
  await markIntercepted();
  const lock = await call(env, "x_supplier_payment", "write", { ids: [ids.p150], vals: { x_amount: 999 } }).then(() => ({ ok: true })).catch((e: Error) => ({ ok: false, error: e.message.slice(0, 200) }));
  const after = await pay(ids.p150);
  out("approve", { before: { state: before.x_state }, approve: a, settled, lock, after, intercepted });
  console.log(JSON.stringify({ approve: a, settled, lockRefused: !lock.ok, amountAfter: after.x_amount, state: after.x_state, notice: after.x_supplier_notice, intercepted: intercepted.length }, null, 1));
} else if (step === "transfer") {
  // Baraa's decision (after Ahmed's window turned out open, 26/09 07:15): the transfer goes to
  // the test supplier «براء - اختبار» (#7, number outside the allowlist): nothing more to Ahmed.
  const [id] = await call<number[]>(env, "x_supplier_payment", "create", { vals_list: [{
    x_supplier_id: TEST_SUPPLIER, x_amount: 50, x_method: "transfer", x_trial_tag: TAG, x_is_simulation: true,
    x_note: `${TAG}: دفعة تحويل تجريبية من براء (ليست تحويلاً حقيقياً).`,
  }] });
  ids.p50 = id; saveIds();
  // the deployed worker settles it through the webhook; wait for x_settled_at
  let p: any = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    p = await pay(id);
    if (p.x_settled_at) break;
  }
  out("transfer", { id, payment: p });
  console.log(JSON.stringify({ id, ref: p.x_name, state: p.x_state, channel: p.x_channel, recordedBy: p.x_recorded_by, settled: p.x_settled_at, overpaid: p.x_overpaid, remaining: p.x_remaining_after, notice: p.x_supplier_notice }, null, 1));
} else if (step === "reject") {
  const noReason = await runAction("utak.sp.reject_check", ids.p40);
  await call(env, "x_supplier_payment", "write", { ids: [ids.p40], vals: { x_reject_reason: `${TAG}: رفض تجريبي — المبلغ لا يطابق الإيصال` } });
  const r = await runAction("utak.sp.reject_check", ids.p40);
  const settled = await SP.settlePayment(env, ids.p40);
  await markIntercepted();
  out("reject", { noReason, reject: r, settled, payment: await pay(ids.p40), intercepted });
  console.log(JSON.stringify({ noReasonRefused: !noReason.ok, noReason: noReason.error, reject: r, settled, intercepted: intercepted.length }, null, 1));
} else if (step === "ahmed-skip") {
  // Baraa's decision: Ahmed is not asked to write. His held notices (the trial's) are first
  // checked «⏳ محفوظة» with their full text in his conversation, then taken out of his queue
  // and marked «skipped» («تجربة § 37 — لا تُرسل»), no deletion; the same line follows.
  const REASON = "تجربة § 37 — لا تُرسل";
  const { readQueue, writeQueue } = await import("../src/wa-queue.ts");
  const since = odooTs(ids.startedAt);
  const held = await call<any[]>(env, "x_wa_message", "search_read", {
    domain: [["x_partner_id", "=", AHMED], ["x_direction", "=", "out"], ["x_status", "=", "held"], ["create_date", ">=", since]],
    fields: ["id", "x_body", "x_echo_message_id", "x_debug_payload"], order: "id asc",
  });
  const lineOf = async (id: number) => plain((await call<any[]>(env, "mail.message", "read", { ids: [id], fields: ["body"] }))[0]?.body ?? "");
  const report: any[] = [];
  for (const r of held) {
    const before = r.x_echo_message_id ? await lineOf(r.x_echo_message_id) : "";
    report.push({ rowId: r.id, bodyStartsWithTag: String(r.x_body).startsWith(TAG), lineBefore: before, heldShown: before.includes(String(r.x_body).split("\n")[0]) && before.includes("⏳ محفوظة") });
  }
  const q = await readQueue(env, AHMED_PHONE);
  const trialRows = new Set(held.map((r) => r.id));
  const keep = q.filter((i: any) => !trialRows.has(i.rowId));
  ids.ahmedQueueBefore = q.map((i: any) => ({ id: i.id, purpose: i.purpose, rowId: i.rowId })); saveIds();
  if (keep.length !== q.length) await writeQueue(env, AHMED_PHONE, keep, Date.now());
  for (const r of held) {
    await call(env, "x_wa_message", "write", { ids: [r.id], vals: { x_status: "skipped", x_meta_error: REASON } });
    await recordStateChange(env, r.id, AHMED_PHONE);
  }
  for (const e of report) {
    const row = held.find((r) => r.id === e.rowId);
    e.lineAfter = row?.x_echo_message_id ? await lineOf(row.x_echo_message_id) : "";
    const [st] = await call<any[]>(env, "x_wa_message", "read", { ids: [e.rowId], fields: ["x_status", "x_meta_error", "x_echo_status"] });
    e.after = st;
  }
  const qAfter = await readQueue(env, AHMED_PHONE);
  out("ahmed-skip", { held: report, queueBefore: ids.ahmedQueueBefore, queueAfter: qAfter.map((i: any) => ({ id: i.id, purpose: i.purpose, rowId: i.rowId })) });
  for (const e of report) console.log(`row #${e.rowId} tagged=${e.bodyStartsWithTag} heldShown=${e.heldShown} → ${e.after.x_status} «${e.after.x_meta_error}»\n  before: ${e.lineBefore.replace(/\n/g, " ⏎ ")}\n  after:  ${e.lineAfter.replace(/\n/g, " ⏎ ")}`);
  console.log(`Ahmed's queue: ${ids.ahmedQueueBefore.length} → ${qAfter.length}`);
} else {
  // verify
  const since = odooTs(ids.startedAt);
  const payments = await call<any[]>(env, "x_supplier_payment", "search_read", { domain: [["x_trial_tag", "=", TAG]], fields: SP.SP_FIELDS, order: "id asc" });
  const dues = await call<any[]>(env, "x_supplier_due", "search_read", { domain: [["x_purchase_list_id", "=", ids.listId]], fields: ["id", "x_name", "x_supplier_id", "x_amount", "x_unpriced_count", "x_line_ids"] });
  const lines = dues[0] ? await call<any[]>(env, "x_supplier_due_line", "read", { ids: dues[0].x_line_ids, fields: ["x_product_tmpl_id", "x_packaging_id", "x_quantity", "x_unit_price", "x_subtotal", "x_no_price", "x_note"] }) : [];
  const [ahmed] = await call<any[]>(env, "res.partner", "read", { ids: [AHMED], fields: ["x_sp_due_total", "x_sp_paid_total", "x_sp_remaining"] });
  const bal = await SP.supplierBalance(env, AHMED);
  const convo = async (partner: number, channel: number) => ({
    rows: await call<any[]>(env, "x_wa_message", "search_read", { domain: [["x_partner_id", "=", partner], ["x_direction", "=", "out"], ["create_date", ">=", since]], fields: ["id", "x_status", "x_body", "x_meta_error", "x_meta_message_id", "x_echo_status", "x_echo_message_id"], order: "id asc" }),
    lines: (await call<any[]>(env, "mail.message", "search_read", { domain: [["model", "=", "discuss.channel"], ["res_id", "=", channel], ["create_date", ">=", since]], fields: ["id", "author_id", "date", "parent_id", "body"], order: "id asc" }))
      .map((m) => ({ id: m.id, author: m.author_id?.[1], date: m.date, parent: m.parent_id || null, text: plain(m.body) })),
  });
  const d1 = await env.SIM_DB.prepare("SELECT id, ts_ms, to_number, msg_type, template_name, body_text, wamid FROM sim_outbound WHERE ts_ms >= ? ORDER BY id").bind(Date.parse(ids.startedAt)).all();
  const res = {
    at: new Date().toISOString(),
    payments, dues, lines, ahmedComputes: ahmed, workerBalance: { due: SP.money(bal.dueH), paid: SP.money(bal.paidH), remaining: SP.money(bal.remainingH) },
    baraa: await convo(BARAA_PARTNER, BARAA_CHANNEL), ahmed: await convo(AHMED, AHMED_CHANNEL), omar: await convo(OMAR, OMAR_CHANNEL),
    d1: d1.results, accountingBefore: ids.accountingBefore, accountingAfter: await accounting(),
  };
  out("verify", res);
  console.log("payments:", payments.map((p) => `${p.x_name} ${p.x_amount} ${p.x_method} ${p.x_state} settled=${!!p.x_settled_at} overpaid=${p.x_overpaid} remaining=${p.x_remaining_after} notice=«${p.x_supplier_notice}»`).join("\n  "));
  console.log("dues:", JSON.stringify(dues.map((d) => [d.x_name, d.x_amount, d.x_unpriced_count])), "lines:", JSON.stringify(lines.map((l) => [l.x_product_tmpl_id?.[1], l.x_quantity, l.x_unit_price, l.x_subtotal, l.x_no_price])));
  console.log("Ahmed (Odoo computes):", JSON.stringify(ahmed), "worker:", JSON.stringify(res.workerBalance));
  for (const [who, c] of [["Baraa", res.baraa], ["Ahmed", res.ahmed], ["Omar", res.omar]] as const) {
    console.log(`\n== ${who}: ${c.rows.length} rows, ${c.lines.length} lines`);
    for (const r of c.rows) console.log(`row #${r.id} ${r.x_status} echo=${r.x_echo_status}#${r.x_echo_message_id || "-"} — ${String(r.x_body).replace(/\n/g, " ⏎ ").slice(0, 160)}${r.x_meta_error ? ` [${String(r.x_meta_error).slice(0, 90)}]` : ""}`);
    for (const l of c.lines) console.log(`line #${l.id} ${l.author}${l.parent ? ` ↳ #${Array.isArray(l.parent) ? l.parent[0] : l.parent}` : ""}\n    ${l.text.replace(/\n/g, "\n    ")}`);
  }
  console.log("\nD1 since start:", JSON.stringify((d1.results ?? []).map((r: any) => [r.id, `…${String(r.to_number).slice(-4)}`, r.msg_type, r.template_name])));
  console.log("accounting before:", JSON.stringify(ids.accountingBefore), "after:", JSON.stringify(res.accountingAfter));
}
