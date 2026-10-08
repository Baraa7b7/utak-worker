// § 67 أ (2026-10-08) — «🧊 وضع التجميد».
//
//   [أ1] the switch: frozen now, frozen at a moment, «حتى تاريخ», the read (KV on a send's path, Odoo when fresh)
//   [أ2] every scheduled job: not run, recorded «مجمّد» once a day, never sent later
//   [أ3] the gateway: an automatic send to another number is «مجمّد» (its row, nothing held); Baraa's own acts go
//   [أ4] an incoming message: recorded, the bot silent; a customer's reply (once in six hours); Baraa is told
//   [أ5] what Baraa does by hand: Odoo's routes, and his own tap on WhatsApp
//   [أ6] a trial reaches Baraa's number alone — frozen or not
//   [أ7] «حتى تاريخ»: turned off by itself, one alert, and the jobs run again
//   [أ8] turned off: everything from its NEXT time, nothing that was due while frozen is sent late
//   [أ9] the day's list is published to nobody while frozen, whoever asks
//   [أ10] the system's own alarms still reach Baraa while frozen
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s67-freeze.test.mts

import { CUST, CUST_PHONE, OWNER, computes, ctx, employee, graph, heldFor, inbound, odooLog, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed, table, workSchedule } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, ALL_WEEK, DAY, DRIVER_PHONE, assert, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

const worker = (await import("../src/index.ts")).default;
const FZ = await import("../src/freeze.ts");
const GW = await import("../src/wa-gateway.ts");
const PR = await import("../src/prices.ts");
const { allPurposes, isTrialPurpose } = await import("../src/wa-purposes.ts");
const { sendOwnerAlert } = await import("../src/templates.ts");
const { ODOO_DOWN_KIND, ODOO_DOWN_TITLE } = await import("../src/odoo.ts");
const { riyadhDayMinuteMs } = await import("../src/hours.ts");

const NEXT = "2026-10-04";
const TICK = "*/5 * * * *", TICK2 = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";
const cfg = () => table("x_pricing_config").get(1) as any;
const utc = (riyadh: string): string => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
/** Odoo's own stamp of the switch (automation #33), as the tenant runs it. */
function stamping(): void {
  let was = cfg().x_freeze_on === true;
  computes.x_pricing_config = (r: any) => {
    const on = r.x_freeze_on === true;
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    if (on && !was) { r.x_freeze_since = now; r.x_freeze_ended_at = false; }
    if (!on && was) r.x_freeze_ended_at = now;
    was = on;
  };
}
/** The tenant's world at `riyadh`; `f` is the switch as the settings hold it. */
function world(riyadh: string, f: { on?: boolean; until?: string; since?: string; ended?: string; reply?: string } = {}): any {
  const env = fresh(riyadh);
  delete computes.x_pricing_config;
  Object.assign(cfg(), {
    x_freeze_on: f.on === true, x_freeze_until: f.until ?? false, x_freeze_reply: f.reply ?? false,
    x_freeze_since: f.since ? utc(f.since) : false, x_freeze_ended_at: f.ended ? utc(f.ended) : false,
  });
  env.ODOO_HOOK_TOKEN = "HOOK";
  // the suppliers' ask and its reminder have their templates, as on the tenant
  for (const [purpose, name] of [["supplier_ask", "utak_supplier_ask_v2"], ["supplier_price_nudge", "utak_supplier_price_nudge"]]) {
    seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  }
  return env;
}
const cron = (env: any, c: string) => quiet(() => worker.scheduled({ cron: c } as any, env, ctx));
/** The switch as the last tick left it in KV (what a send and an incoming message read). */
const known = (env: any) => quiet(() => FZ.readFreeze(env, Date.now(), { fresh: true }));
const frozenRows = () => rows("x_wa_message").filter((r: any) => r.x_status === "frozen") as any[];
const say = (env: any, from: string, text: string) => quiet(() => worker.fetch(signed(inbound(from, { type: "text", text: { body: text } })), env, ctx));
const tapButton = (env: any, from: string, id: string) => quiet(() => worker.fetch(signed(inbound(from, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } })), env, ctx));
const text = (to: string, body: string, purpose: string, extra: Record<string, unknown> = {}) => ({ purpose, to: "+" + to, content: { kind: "session" as const, body: { type: "text", text: { body } } }, ...extra });
const gw = async (env: any, req: any) => GW.gatewayDecision(await quiet(() => GW.sendViaGateway(env, req)));
const bodies = (to: string): string[] => sentTo(to).map((b: any) => String(b?.text?.body ?? b?.interactive?.body?.text ?? b?.template?.name ?? `[${b?.type}]`));
/** Every message that reached Meta (a read of Meta's templates is not one). */
const msgs = () => graph.filter((b: any) => b?.to);
const notOwner = () => msgs().filter((b: any) => b.to !== OWNER);

// ================================================================ أ1
console.log("\n[أ1] the switch");
{
  const at = (riyadh: string) => Date.parse(riyadh.replace(" ", "T") + ":00+03:00");
  const s = (o: Partial<import("../src/freeze.ts").FreezeState>): import("../src/freeze.ts").FreezeState => ({ configId: 1, switchOn: false, until: null, since: null, endedAt: null, reply: "x", readAt: 0, ...o });
  assert("on, no «حتى تاريخ»: frozen", FZ.isFrozenNow(s({ switchOn: true }), at(`${DAY} 10:00`)));
  assert("off: not frozen", !FZ.isFrozenNow(s({}), at(`${DAY} 10:00`)));
  assert("«حتى تاريخ» is the LAST frozen day: frozen at its 23:59, not at 00:00 of the day after", FZ.isFrozenNow(s({ switchOn: true, until: DAY }), at(`${DAY} 23:59`)) && !FZ.isFrozenNow(s({ switchOn: true, until: DAY }), at(`${NEXT} 00:00`)));
  const on = s({ switchOn: true, since: at(`${DAY} 01:00`) });
  assert("frozen at a moment: from «بدأ» on, not before it", FZ.frozenAt(on, at(`${DAY} 02:00`)) && FZ.frozenAt(on, at(`${DAY} 01:00`)) && !FZ.frozenAt(on, at(`${DAY} 00:59`)));
  const off = s({ since: at(`${DAY} 01:00`), endedAt: at(`${DAY} 05:20`) });
  assert("turned off: what fell between «بدأ» and «انتهى» WAS frozen — not what came at «انتهى» or after", FZ.frozenAt(off, at(`${DAY} 04:00`)) && !FZ.frozenAt(off, at(`${DAY} 05:20`)) && !FZ.frozenAt(off, at(`${DAY} 06:00`)));
  assert("never frozen: nothing was", !FZ.frozenAt(s({}), at(`${DAY} 04:00`)) && !FZ.frozenAt(s({ since: at(`${DAY} 01:00`) }), at(`${DAY} 04:00`)));
  assert("on without a stamp (Odoo's automation did not run): frozen whenever", FZ.frozenAt(s({ switchOn: true }), at(`${DAY} 04:00`)));
  assert("«حتى تاريخ» ends it at 00:00 of the day after", FZ.frozenAt(s({ switchOn: true, since: at(`${DAY} 01:00`), until: DAY }), at(`${DAY} 23:00`)) && !FZ.frozenAt(s({ switchOn: true, since: at(`${DAY} 01:00`), until: DAY }), at(`${NEXT} 02:00`)));

  const env = world(`${DAY} 10:00`, { on: true, since: `${DAY} 01:00` });
  const n0 = odooLog.length;
  const blind = await quiet(() => FZ.readFreeze(env, Date.now()));
  assert("a send's read is KV alone: no Odoo call, and with nothing on record — not frozen", odooLog.length === n0 && blind.switchOn === false);
  const read = await known(env);
  assert("the fresh read (the ticks, the crons) is the settings', and it is kept", read.switchOn === true && read.configId === 1 && read.since === at(`${DAY} 01:00`) && read.reply === FZ.DEFAULT_FREEZE_REPLY && odooLog.slice(n0).some((l) => l.model === "x_pricing_config" && l.method === "search_read"));
  const n1 = odooLog.length;
  const again = await quiet(() => FZ.readFreeze(env, Date.now()));
  assert("…and the next send reads it back from KV (no Odoo call)", again.switchOn === true && odooLog.length === n1);
  // Odoo not answering never thaws a frozen system
  cfg().x_freeze_on = false;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: any) => {
    const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
    if (url.includes("x_pricing_config")) return new Response("<html><h1>429 Too Many Requests</h1></html>", { status: 429 });
    return real(input as any, init);
  }) as typeof fetch;
  let stale: any;
  try { stale = await known(env); } finally { globalThis.fetch = real; }
  assert("Odoo not answering: the last state read stands (a frozen system stays frozen), and Baraa is not alerted for it", stale.switchOn === true && ownerTexts().length === 0);
  assert("the settings' own reply is the one read", (await known(world(`${DAY} 10:00`, { on: true, reply: "  نرجع السبت 🌿 " }))).reply === "نرجع السبت 🌿");
}

// ================================================================ أ2
console.log("\n[أ2] every scheduled job: not run, «مجمّد» once a day, never later");
{
  // the control: not frozen, the 02:00 ask reaches the supplier
  const free = world(`${DAY} 02:00`);
  await cron(free, "0 23 * * *");
  assert("not frozen (the control): the 02:00 ask reaches the supplier", sentTo(AHMED_PHONE).length === 1 && frozenRows().length === 0, JSON.stringify(bodies(AHMED_PHONE)));

  const env = world(`${DAY} 02:00`, { on: true, since: "2026-10-02 18:00" });
  // an ask of before the freeze, still unanswered: the 05:00 cron would remind him
  seed("x_supplier_price_request_log", { x_supplier_id: AHMED, x_sent_at: utc(`${DAY} 00:30`), x_status: "sent", x_replied_at: false });
  openWindow(env, AHMED_PHONE, 30);
  odooLog.length = 0;
  const writes0 = () => odooLog.filter((l) => l.method === "create" || l.method === "write").map((l) => l.model);
  await cron(env, "0 23 * * *");
  assert("frozen: the 02:00 cron sends nothing and writes nothing (no ask log, no price day)", graph.length === 0 && writes0().length === 0, JSON.stringify([graph.length, writes0()]));
  await cron(env, TICK);
  const first = frozenRows();
  assert("the tick records what is due by 02:00 — the price ask and the team's shift messages — «مجمّد», with no recipient", first.length === 2 && first.some((r) => r.x_body === FZ.frozenJobText("طلب أسعار الشراء من الموردين (02:00)")) && first.some((r) => String(r.x_body).includes("بدء الدوام")) && first.every((r) => !r.x_partner_id && r.x_direction === "out"), JSON.stringify(first.map((r) => r.x_body)));
  assert("…and still nothing left for anyone", graph.length === 0);
  await cron(env, TICK);
  assert("the same tick again: no second row («مجمّد» once a day a job)", frozenRows().length === 2);
  // the whole day, every cron at its time
  const day: Array<[string, string]> = [
    ["02:30", TICK], ["04:00", TICK], ["04:30", TICK], ["05:00", "0 2 * * *"], ["05:00", TICK], ["06:00", "0 3 * * *"], ["06:00", TICK], ["06:02", TICK2],
    ["08:00", "0 5 * * *"], ["08:00", TICK], ["12:00", TICK], ["17:00", "0 14 * * *"], ["17:00", TICK], ["18:00", "0 15 * * *"], ["18:00", TICK],
    ["20:00", "0 17 * * *"], ["20:00", TICK], ["21:00", "0 18 * * *"], ["21:00", TICK], ["21:15", "15 18 * * *"], ["21:15", TICK], ["21:30", "30 18 * * *"], ["21:30", TICK],
  ];
  for (const [hm, c] of day) { setRiyadh(`${DAY} ${hm}`); await cron(env, c); }
  assert("a whole frozen day, every cron at its time: NOT ONE message to anyone — not to Baraa either («لم تُنشر», «صباح الخير», the 21:30 summary)", msgs().length === 0, JSON.stringify(msgs().map((b: any) => [b.to, b?.text?.body ?? b?.template?.name])));
  const all = frozenRows().map((r) => String(r.x_body));
  assert("each of the day's fourteen jobs is «مجمّد» exactly once", all.length === FZ.FROZEN_JOBS.length && FZ.FROZEN_JOBS.every((j) => all.filter((b) => b === FZ.frozenJobText(j.label)).length === 1), JSON.stringify(all));
  assert("the list of what the freeze steps over names each of the command's: the asks, their reminders, the publication, the collection, the team, the day's alerts", ["طلب أسعار الشراء", "طلب أسعار السوق", "تذكير الموردين", "نشر أسعار اليوم", "تذكير الدفع", "ملخص التحصيل", "بدء الدوام", "ملخص اليوم"].every((w) => FZ.FROZEN_JOBS.some((j) => j.label.includes(w))));
  assert("no price day was built, no order closed, no purchase list made: the jobs did not run", rows("x_price_day").length === 0 && rows("x_purchase_list").length === 0 && rows("x_supplier_price_request_log").length === 1);
  assert("nothing is held for anyone", [OWNER, CUST_PHONE, AHMED_PHONE, DRIVER_PHONE].every((d) => heldFor(env, d).length === 0));
  // the next day: its own rows
  setRiyadh(`${NEXT} 02:00`);
  await cron(env, "0 23 * * *"); await cron(env, TICK);
  assert("the next day's 02:00 is recorded «مجمّد» in its turn", frozenRows().length === FZ.FROZEN_JOBS.length + 2 && msgs().length === 0);
  // a freeze turned on at 10:00: what ran before it is not «مجمّد» — only what comes due after
  const mid = world(`${DAY} 10:05`, { on: true, since: `${DAY} 10:00` });
  await cron(mid, TICK);
  assert("turned on at 10:00: the jobs of 02:00–08:00 ran before it — none of them is recorded «مجمّد»", frozenRows().length === 0);
  setRiyadh(`${DAY} 17:00`);
  await cron(mid, TICK);
  assert("…and at 17:00 the one that has come due since is", frozenRows().length === 1 && String(frozenRows()[0].x_body).includes("تذكير الطلب المعتاد"));
  assert("the crons the freeze stops are the ten of the day's work — not the 05:00 one (the template sync) nor the */5 tick (the upkeep)", FZ.FROZEN_CRONS.size === 10 && !FZ.FROZEN_CRONS.has("0 2 * * *") && !FZ.FROZEN_CRONS.has(TICK) && FZ.FROZEN_CRONS.has(TICK2));
  // a job started by hand while frozen (/sim/trigger): its own row, once
  const n = frozenRows().length;
  const r1 = await quiet(() => FZ.noteFrozenRun(env, "ask_suppliers"));
  const r2 = await quiet(() => FZ.noteFrozenRun(env, "ask_suppliers"));
  assert("a job started by hand while frozen: its «مجمّد» row, once a day", /^x_wa_message #\d+$/.test(r1) && r2 === "recorded before" && frozenRows().length === n + 1 && String(frozenRows().at(-1).x_body).includes("تشغيل يدوي"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ أ3
console.log("\n[أ3] the gateway: an automatic send to another number is «مجمّد»");
{
  const env = world(`${DAY} 10:00`, { on: true, since: `${DAY} 01:00` });
  openWindow(env, CUST_PHONE, 5);
  // before any tick read the switch: the gateway knows nothing, and sends (the tick comes within five minutes)
  await known(env);
  const d = await gw(env, text(CUST_PHONE, "طلبك في الطريق 🚚", "customer_delivery_incoming"));
  const row = frozenRows().at(-1);
  assert("an automatic message to a customer: refused «frozen», nothing reaches Meta", d?.action === "frozen" && sentTo(CUST_PHONE).length === 0, JSON.stringify(d));
  assert("…recorded «مجمّد» with its text and its recipient", row?.x_body === "طلبك في الطريق 🚚" && row.x_partner_id === CUST && String(row.x_meta_error).includes("🧊 مجمّد") && String(row.x_meta_error).includes("لا تُرسل لاحقاً"));
  assert("…and NOT held: nothing waits for his next message", heldFor(env, CUST_PHONE).length === 0);
  // outside his window it is not held either (a held message would leave after the freeze)
  const env2 = world(`${DAY} 10:00`, { on: true, since: `${DAY} 01:00` });
  await known(env2);
  const out = await gw(env2, text(CUST_PHONE, "فاتورتك جاهزة", "customer_invoice"));
  assert("outside his window too: «مجمّد», never held, and no «فتح المحادثة» template", out?.action === "frozen" && heldFor(env2, CUST_PHONE).length === 0 && graph.length === 0);
  // Baraa's number is never frozen by the gateway
  const own = await gw(env, text(OWNER, "تنبيه للمالك", "owner_alert"));
  assert("a message to Baraa's own number goes", own?.action === "session" && sentTo(OWNER).length === 1);
  // what Baraa does by hand
  const manual = await gw(env, text(CUST_PHONE, "أهلاً، معك براء", "wa_message_manual"));
  const flagged = await gw(env, text(CUST_PHONE, "عرض السعر مرفق", "customer_quotation", { manual: true }));
  const byOdoo = await gw(FZ.withOwnerAct(env, "odoo"), text(CUST_PHONE, "فاتورتك", "customer_invoice"));
  assert("a manual message, a send marked manual, and a send inside a request of Odoo's buttons: all go", manual?.action === "session" && flagged?.action === "session" && byOdoo?.action === "session" && sentTo(CUST_PHONE).length === 3, JSON.stringify([manual, flagged, byOdoo]));
  assert("the freeze's own reply goes", (await gw(env, text(CUST_PHONE, FZ.DEFAULT_FREEZE_REPLY, FZ.FREEZE_REPLY_PURPOSE)))?.action === "session");
  // a held message of before the freeze, flushed by his message while frozen: frozen too, never sent
  const env3 = world(`${DAY} 10:00`);
  await known(env3);
  await gw(env3, text(CUST_PHONE, "رسالة محفوظة قبل التجميد", "customer_invoice"));
  assert("(held before the freeze, his window closed)", heldFor(env3, CUST_PHONE).length === 1);
  Object.assign(cfg(), { x_freeze_on: true, x_freeze_since: utc(`${DAY} 10:01`) });
  setRiyadh(`${DAY} 10:05`); await known(env3);
  await say(env3, CUST_PHONE, "السلام عليكم");
  assert("a message held before the freeze is not flushed out while frozen: its row is «مجمّد», the queue is empty", !bodies(CUST_PHONE).includes("رسالة محفوظة قبل التجميد") && heldFor(env3, CUST_PHONE).length === 0 && rows("x_wa_message").some((r: any) => r.x_body === "رسالة محفوظة قبل التجميد" && r.x_status === "frozen"));
  // turned off: sends go again, and what was frozen is not sent
  Object.assign(cfg(), { x_freeze_on: false, x_freeze_ended_at: utc(`${DAY} 10:30`) });
  setRiyadh(`${DAY} 10:35`); await known(env3);
  graph.length = 0;
  const after = await gw(env3, text(CUST_PHONE, "طلبك في الطريق 🚚", "customer_delivery_incoming"));
  await say(env3, CUST_PHONE, "مرحبا");
  assert("turned off: an automatic send goes again", after?.action === "session");
  assert("…and nothing the freeze stepped over leaves later", !bodies(CUST_PHONE).includes("رسالة محفوظة قبل التجميد"));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ أ4
console.log("\n[أ4] an incoming message while frozen");
{
  const env = world(`${DAY} 10:00`, { on: true, since: `${DAY} 01:00`, reply: "نشكر تواصلك 🌿 نرجع السبت بإذن الله" });
  await known(env);
  await say(env, CUST_PHONE, "أبغى 5 كرتون طماطم و3 خيار");
  const inRow = rows("x_wa_message").find((r: any) => r.x_direction === "in" && String(r.x_body).includes("5 كرتون طماطم")) as any;
  assert("the message is recorded in Odoo as it is", !!inRow && inRow.x_status === "received" && inRow.x_partner_id === CUST);
  assert("the customer gets the settings' reply — and nothing else (no quotation, no menu)", JSON.stringify(bodies(CUST_PHONE)) === JSON.stringify(["نشكر تواصلك 🌿 نرجع السبت بإذن الله"]), JSON.stringify(bodies(CUST_PHONE)));
  assert("no order is made of it", rows("x_daily_order").length === 0 && rows("x_daily_order_line").length === 0);
  assert("the bot does not even try to answer: nothing of its own was stopped at the gateway («مجمّد» rows: none)", frozenRows().length === 0, JSON.stringify(frozenRows().map((r) => r.x_body)));
  assert("Baraa is told who wrote and what", ownerTexts().length === 1 && ownerTexts()[0] === FZ.frozenInboundAlert("customer", "مطعم الوادي", CUST_PHONE, "أبغى 5 كرتون طماطم و3 خيار", true), ownerTexts().join(" | "));
  // again inside six hours: recorded, no second reply
  setRiyadh(`${DAY} 12:00`);
  await say(env, CUST_PHONE, "متى ترجعون؟");
  assert("again inside six hours: recorded, and the reply is not said twice", bodies(CUST_PHONE).length === 1 && rows("x_wa_message").some((r: any) => r.x_direction === "in" && r.x_body === "متى ترجعون؟"));
  setRiyadh(`${DAY} 16:01`);
  await say(env, CUST_PHONE, "الو");
  assert("six hours later: the reply again", bodies(CUST_PHONE).length === 2);
  // the team and a supplier: recorded, no reply, Baraa told
  graph.length = 0;
  for (const k of [...env.MSG_DEDUP.store.keys()]) if (k.startsWith("oa_")) env.MSG_DEDUP.store.delete(k);
  await say(env, AHMED_PHONE, "طماطم 20 خيار 15");
  assert("a supplier's prices while frozen: recorded, NOT read (no offer, no price), no reply to him", sentTo(AHMED_PHONE).length === 0 && rows("x_price_offer").length === 0 && rows("x_daily_price").length === 0 && rows("x_wa_message").some((r: any) => r.x_direction === "in" && r.x_body === "طماطم 20 خيار 15"));
  assert("…and Baraa is told a supplier wrote", ownerTexts().some((t) => t.includes("مورد «أحمد حسان»") && t.includes("لم يُرَدّ عليه")), ownerTexts().join(" | "));
  await tapButton(env, DRIVER_PHONE, "shift_start");
  assert("a team member's tap while frozen: no reply, no task, no attendance row", sentTo(DRIVER_PHONE).length === 0 && rows("x_attendance").length === 0);
  // Baraa's own message is not the freeze's
  const b0 = ownerTexts().length;
  await say(env, OWNER, "مرحبا");
  assert("Baraa's own message is never answered as a frozen one", !ownerTexts().slice(b0).some((t) => t.includes("🧊")));
  // not frozen: the bot answers as it always did (the control)
  const free = world(`${DAY} 10:00`);
  await known(free);
  await say(free, CUST_PHONE, "السلام عليكم");
  assert("not frozen (the control): no freeze reply, no «🧊» alert", !bodies(CUST_PHONE).some((b) => b === FZ.DEFAULT_FREEZE_REPLY) && !ownerTexts().some((t) => t.includes("🧊")));
  assert("the default reply is the command's", FZ.DEFAULT_FREEZE_REPLY === "نشكر تواصلك 🌿 استقبال الطلبات متوقف مؤقتاً ونرجع قريباً بإذن الله");
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ أ5
console.log("\n[أ5] what Baraa does by hand");
{
  assert("Odoo's buttons and automations are Baraa's acts; Meta's webhook and the sim routes are not", ["/odoo/hook/wa", "/odoo/hook/special-quote", "/odoo/hook/supplier", "/internal/quotation-issue", "/internal/receipt-issue"].every(FZ.isOwnerActPath) && !["/webhook", "/sim/trigger", "/health", "/"].some(FZ.isOwnerActPath));
  const env = world(`${DAY} 04:40`, { on: true, since: `${DAY} 01:00` });
  // a route of Odoo's: the trial's «state» reads the switch fresh and answers
  const res = await quiet(() => worker.fetch(new Request("https://w.test/odoo/hook/s67-trial?token=HOOK&op=state", { method: "POST" }), env, ctx));
  const state = (await res.json() as any).state;
  assert("the worker reads the switch the moment a route of Odoo's asks (no wait for the tick)", res.status === 200 && state.frozen === true && state.switchOn === true && state.until === null && state.retriesWaiting === 0 && state.ownerBlocks.owner_alert === false);
  assert("a request of Odoo's is marked as Baraa's own act for everything it sends", state.ownerAct === "odoo");
  assert("…and the route is closed without the hook token", (await quiet(() => worker.fetch(new Request("https://w.test/odoo/hook/s67-trial?token=nope&op=alert", { method: "POST" }), env, ctx))).status === 401 && graph.length === 0);
  // his own tap on WhatsApp is his act: «🔁 أعد طلب الأسعار» reaches the supplier while frozen
  seed("x_supplier_price_request_log", { x_supplier_id: 801, x_sent_at: utc(`${DAY} 02:00`), x_status: "sent", x_replied_at: false });
  openWindow(env, AHMED_PHONE, 30);
  await tapButton(env, OWNER, `rsk_${DAY}`);
  assert("frozen: Baraa's own tap («🔁 أعد طلب الأسعار») sends — the ask reaches the supplier", sentTo(AHMED_PHONE).length === 1, JSON.stringify(graph.map((b: any) => [b?.to, b.type])));
  assert("…and he reads what went", ownerTexts().some((t) => t.startsWith("🔁 أُعيد طلب أسعار اليوم") && t.includes("أحمد حسان ✅")), ownerTexts().join(" | "));
  // the same send from a tick is the system's: frozen
  const d = await gw(env, text(AHMED_PHONE, "تذكير بالأسعار", "supplier_price_nudge"));
  assert("the same supplier, a send of the system's: «مجمّد»", d?.action === "frozen");
}

// ================================================================ أ6
console.log("\n[أ6] a trial reaches Baraa's number alone — frozen or not");
{
  const trials = allPurposes().filter(isTrialPurpose);
  assert("the trials are the «…_test» purposes (the sim worker's test send among them)", trials.length >= 20 && trials.includes("sim_test") && trials.includes("price_flow_test") && trials.includes("special_quote_test"), String(trials.length));
  for (const frozen of [false, true]) {
    const env = world(`${DAY} 10:00`, frozen ? { on: true, since: `${DAY} 01:00` } : {});
    await known(env);
    openWindow(env, CUST_PHONE, 5);
    const toOther = [];
    for (const p of trials) toOther.push(await gw(env, text(CUST_PHONE, "🧪 تجربة", p)));
    assert(`${frozen ? "frozen" : "not frozen"}: no trial is sent to another number, whatever its purpose`, toOther.every((d) => d?.action === "refused") && sentTo(CUST_PHONE).length === 0, JSON.stringify(toOther.filter((d) => d?.action !== "refused")));
    assert(`${frozen ? "frozen" : "not frozen"}: the refusal says why`, toOther.every((d: any) => /^TrialOwnerOnly: trial: purpose=\w+_test goes to the owner alone$/.test(d.reason)), JSON.stringify(toOther.find((d: any) => !/^TrialOwnerOnly/.test(d.reason))));
    const toOwner = [];
    for (const p of trials) toOwner.push(await gw(env, text(OWNER, `🧪 تجربة ${p}`, p)));
    assert(`${frozen ? "frozen" : "not frozen"}: every trial reaches Baraa`, toOwner.every((d) => d?.action === "session") && sentTo(OWNER).length === trials.length, JSON.stringify(toOwner.filter((d) => d?.action !== "session")));
  }
}

// ================================================================ أ7
console.log("\n[أ7] «حتى تاريخ»");
{
  const env = world(`${DAY} 23:55`, { on: true, since: `${DAY} 01:00`, until: DAY });
  stamping();
  await cron(env, TICK);
  assert("its last day, 23:55: still frozen, the switch untouched", cfg().x_freeze_on === true && ownerTexts().length === 0);
  setRiyadh(`${NEXT} 00:05`);
  await cron(env, TICK);
  assert("the first tick after it: the switch is turned OFF in Odoo, and «حتى تاريخ» cleared", cfg().x_freeze_on === false && cfg().x_freeze_until === false && !!cfg().x_freeze_ended_at);
  assert("…and Baraa is told, once", ownerTexts().length === 1 && ownerTexts()[0] === FZ.freezeEndedText(DAY), ownerTexts().join(" | "));
  setRiyadh(`${NEXT} 00:10`);
  await cron(env, TICK);
  assert("the tick after: no second alert", ownerTexts().length === 1);
  setRiyadh(`${NEXT} 02:00`);
  await cron(env, "0 23 * * *");
  assert("the day after: the 02:00 ask goes again", sentTo(AHMED_PHONE).length === 1);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ أ8
console.log("\n[أ8] turned off: everything from its next time, nothing late");
{
  // the control: never frozen — the 06:25 tick tells Baraa the day was not published (the 06:00 deadline, an hour's window)
  const free = world(`${DAY} 06:25`);
  await cron(free, TICK);
  assert("never frozen (the control): the 06:25 tick sends what was due at 06:00 («لم تُنشر»)", ownerTexts().some((t) => t.includes("لم تُنشر حتى 06:00")), JSON.stringify(msgs().map((b: any) => [b.to, b?.template?.name ?? b.type])));

  // frozen from 01:00, turned off at 06:20: the 06:25 tick sends nothing of what was due while frozen
  const env = world(`${DAY} 06:25`, { since: `${DAY} 01:00`, ended: `${DAY} 06:20` });
  await cron(env, TICK);
  assert("turned off at 06:20: the 06:25 tick sends NOTHING of 02:00–06:00 late — no «بدء الدوام», no ask, no reminder, no review, no «مصدر لم يرسل», no «لم تُنشر»", msgs().length === 0, JSON.stringify(msgs().map((b: any) => [b.to, b?.text?.body ?? b?.template?.name ?? b.type])));
  assert("…and nothing is recorded «مجمّد» after the freeze (the rows are the frozen ticks')", frozenRows().length === 0);
  const tick = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("the prices tick names what it stepped over", (tick.marketAsk as any)?.action === "frozen_missed" && (tick.sourcesMissing as any)?.action === "frozen_missed" && (tick.marketNudge as any)?.action === "frozen_missed" && (tick.review as any)?.action === "frozen_missed" && (tick.deadline as any)?.action === "after_window", JSON.stringify(tick));
  // the next time of each is the next day's: it runs
  setRiyadh(`${NEXT} 06:00`);
  await cron(env, TICK);
  assert("the next day's 06:00: the publication's tick runs («لم تُنشر», there being no price)", ownerTexts().some((t) => t.includes("لم تُنشر حتى 06:00")), ownerTexts().join(" | "));
  // 05:25 is INSIDE the windows of the market ask, «مصدر لم يرسل», the 05:00 reminder and the review: the control sends, the thawed tick does not
  const silentAsk = () => { seed("x_supplier_price_request_log", { x_supplier_id: AHMED, x_sent_at: utc(`${DAY} 00:30`), x_status: "sent", x_replied_at: false }); };
  const free2 = world(`${DAY} 05:25`); silentAsk();
  await cron(free2, TICK);
  const due = msgs().length;
  assert("never frozen (the control): the 05:25 tick sends what 04:30 owes («مصادر لم ترسل», with its button)", due >= 1 && sentTo(OWNER).some((b: any) => b?.interactive?.action?.buttons?.[0]?.reply?.id === `rsk_${DAY}`), JSON.stringify(msgs().map((b: any) => [b.to, b.type])));
  const thaw = world(`${DAY} 05:25`, { since: `${DAY} 01:00`, ended: `${DAY} 05:20` }); silentAsk();
  await cron(thaw, TICK);
  assert("turned off at 05:20: the 05:25 tick sends none of it — the asks, «مصدر لم يرسل», the reminder and the review were due while frozen", msgs().length === 0, JSON.stringify(msgs().map((b: any) => [b.to, b?.text?.body ?? b?.interactive?.body?.text ?? b.type])));
  // a start of shift that fell inside the freeze gets nothing after it; the next one does
  const AT = await import("../src/attendance.ts");
  const ctl = await quiet(() => AT.runAttendanceTick(world(`${DAY} 06:10`)));
  const env2 = world(`${DAY} 06:10`, { since: `${DAY} 01:00`, ended: `${DAY} 06:05` });
  await known(env2); // the tick reads the switch fresh before its jobs
  const r = await quiet(() => AT.runAttendanceTick(env2));
  assert("Baraa's 06:00 «بدء الدوام» fell inside the freeze: nothing ten minutes later, the freeze off (the control sends it)", r.owner.action === AT.FROZEN_MISSED_STEP && ctl.owner.action !== AT.FROZEN_MISSED_STEP && ctl.owner.action !== "before", JSON.stringify([ctl.owner, r.owner]));
  setRiyadh(`${NEXT} 06:00`);
  const r2 = await quiet(() => AT.runAttendanceTick(env2));
  assert("the next day's: as always", r2.owner.action === ctl.owner.action, JSON.stringify(r2.owner));
  // a member whose shift began while frozen; and a freeze that began after the shift did
  const member = (env: any) => { seed("res.partner", { id: 604, name: "سائق الدينة", x_whatsapp_number: "+966500000604" }); employee(604, [72], { x_utak_attendance: true, resource_calendar_id: workSchedule(ALL_WEEK, { name: "UTAK — سائق" }) }); return env; };
  const mctl = await quiet(() => AT.runAttendanceTick(member(world(`${DAY} 02:10`))));
  const menv = member(world(`${DAY} 02:10`, { since: `${DAY} 01:00`, ended: `${DAY} 02:05` }));
  await known(menv);
  const mr = await quiet(() => AT.runAttendanceTick(menv));
  const of = (r: any) => r.members.find((m: any) => m.name === "سائق الدينة")?.action;
  assert("a member whose 02:00 shift began while frozen: no «بدء الدوام» at 02:10, the freeze off (the control acts on it)", of(mr) === AT.FROZEN_MISSED_STEP && of(mctl) !== AT.FROZEN_MISSED_STEP && of(mctl) !== "before_shift" && sentTo("966500000604").length === 0, JSON.stringify([of(mctl), of(mr)]));
  const late = member(world(`${DAY} 02:15`, { on: true, since: `${DAY} 02:10` }));
  await known(late);
  const lr = await quiet(() => AT.runAttendanceTick(late));
  assert("a freeze that began at 02:10, after the 02:00 shift: frozen NOW — nothing at 02:15 either, for the member or for Baraa", of(lr) === AT.FROZEN_MISSED_STEP && lr.owner.action === AT.FROZEN_MISSED_STEP);
  const late2 = world(`${DAY} 06:15`, { on: true, since: `${DAY} 06:10` });
  await known(late2);
  assert("a freeze that began at 06:10, after Baraa's 06:00 «بدء الدوام» was due: nothing at 06:15 (frozen NOW)", (await quiet(() => AT.runAttendanceTick(late2))).owner.action === AT.FROZEN_MISSED_STEP);
  // a day approved while frozen is not published by itself after the freeze
  const env3 = world(`${DAY} 06:10`, { since: `${DAY} 01:00`, ended: `${DAY} 06:05` });
  seed("x_price_day", { id: 70, x_date: DAY, x_state: "approved", x_approved_at: utc(`${DAY} 05:00`), x_name: DAY });
  await known(env3);
  const t3 = await quiet(() => PR.runPricesTick(env3, Date.now()));
  assert("a day approved while frozen is not published by itself once the freeze is off", t3.publish === undefined && sentTo(CUST_PHONE).length === 0, JSON.stringify([t3.publish, sentTo(CUST_PHONE).length]));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ أ9
console.log("\n[أ9] the day's list while frozen");
{
  const env = world(`${DAY} 06:30`, { on: true, since: `${DAY} 01:00` });
  await known(env);
  seed("x_price_day", { id: 71, x_date: DAY, x_state: "approved", x_approved_at: utc(`${DAY} 06:20`), x_name: DAY });
  const r = await quiet(() => PR.publishPriceDay(FZ.withOwnerAct(env, "odoo"), 71));
  assert("«نشر المعتمد الآن» while frozen: the list goes to NOBODY — not even as Baraa's own act", r.action === "frozen" && notOwner().length === 0 && (table("x_price_day").get(71) as any).x_state === "approved", JSON.stringify(r));
  assert("…and Baraa is told why, and what to do", ownerTexts().length === 1 && ownerTexts()[0].startsWith("🧊 أسعار") && ownerTexts()[0].includes("وضع التجميد مُشغَّل") && ownerTexts()[0].includes("نشر المعتمد الآن"), ownerTexts().join(" | "));
  setRiyadh(`${DAY} 07:00`);
  const again = await quiet(() => PR.publishPriceDay(env, 71));
  assert("pressed again half an hour later: refused again, and not said twice in a day", again.action === "frozen" && ownerTexts().length === 1);
}

// ================================================================ أ10
console.log("\n[أ10] the system's own alarms still reach Baraa");
{
  const env = world(`${DAY} 03:00`, { on: true, since: `${DAY} 01:00` });
  await cron(env, TICK);
  await quiet(() => sendOwnerAlert(env, "بعد 4 محاولات — العملية x_daily_order.write، السجل ids=7 — odoo HTTP_429", { kind: ODOO_DOWN_KIND, critical: true, buffer: { title: ODOO_DOWN_TITLE } }));
  setRiyadh(`${DAY} 03:12`);
  await cron(env, TICK2);
  assert("frozen: «Odoo لم يستجب» still reaches Baraa (from the driver's tick, which the freeze otherwise stops)", ownerTexts().length === 1 && ownerTexts()[0].startsWith("⚠️ Odoo لم يستجب (03:00)") && ownerTexts()[0].includes("x_daily_order.write"), ownerTexts().join(" | "));
  assert("…under the important purpose", riyadhDayMinuteMs(DAY, 0) > 0 && rows("x_wa_message").some((r: any) => String(r.x_body).startsWith("⚠️ Odoo لم يستجب")));
}

done();
