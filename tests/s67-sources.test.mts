// § 67 و (2026-10-08) — outside the freeze: 04:30 «مصدر لم يرسل» with «🔁 أعد طلب الأسعار», and 07:30 the
// reminder of a day still «فائت».
//
//   [و1] 04:30: ONE alert with every silent source, the day each last sent, and the button — once a day
//   [و2] «🔁 أعد طلب الأسعار»: the ask again to who is still silent, once a day, and one line back
//   [و3] 07:30: one reminder of a day still «فائت» — never of a day Baraa closed himself
//   [و4] both are wired in the prices tick, and Baraa's tap reaches the button from the webhook
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s67-sources.test.mts

import { OWNER, closeOwnerWindow, ctx, failNext, graph, heldFor, inbound, openWindow, quiet, rows, seed, sentTo, setRiyadh, signed } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, DAY, DRIVER, DRIVER_PHONE, assert, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

const worker = (await import("../src/index.ts")).default;
const SM = await import("../src/sources-missing.ts");
const PR = await import("../src/prices.ts");
const GW = await import("../src/wa-gateway.ts");
const { isOwnerOwnMessage, REASK_PAYLOAD } = await import("../src/owner-team.ts");

const utc = (riyadh: string): string => new Date(Date.parse(riyadh.replace(" ", "T") + ":00+03:00")).toISOString().replace("T", " ").slice(0, 19);
/** The tenant's world: Ahmed (a supplier) was asked at 02:00 and has not answered; Omar is a market source. */
function world(riyadh: string, opts: { asked?: boolean } = {}): any {
  const env = fresh(riyadh);
  for (const [purpose, name] of [["supplier_ask", "utak_supplier_ask_v2"], ["supplier_price_nudge", "utak_supplier_price_nudge"]]) {
    seed("x_whatsapp_template", { x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: 2, x_category: "UTILITY" });
  }
  if (opts.asked !== false) seed("x_supplier_price_request_log", { x_supplier_id: AHMED, x_sent_at: utc(`${DAY} 02:00`), x_status: "sent", x_replied_at: false });
  return env;
}
const offer = (partner: number, day: string, extra: Record<string, unknown> = {}) => seed("x_price_offer", { x_source_partner_id: partner, x_date: day, x_product_tmpl_id: 1, x_packaging_id: 11, x_purchase_price: 20, ...extra });
const buttonsTo = (to: string) => sentTo(to).filter((b: any) => b?.type === "interactive" && b.interactive?.type === "button") as any[];
const tap = (env: any, id: string) => quiet(() => worker.fetch(signed(inbound(OWNER, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: SM.REASK_TITLE } } })), env, ctx));

// ================================================================ و1
console.log("\n[و1] 04:30: one alert with every silent source");
{
  const env = world(`${DAY} 04:25`);
  // (in the order Odoo keeps them: the harness's «desc» is the reverse of insertion)
  offer(AHMED, "2026-09-28");
  offer(AHMED, "2026-10-01");
  offer(AHMED, "2026-10-02", { x_special: true }); // his answer to a special request is not his prices of a day
  assert("04:25: not yet", (await quiet(() => SM.runSourcesMissing(env))).action === "before" && graph.length === 0);
  setRiyadh(`${DAY} 04:30`);
  const r = await quiet(() => SM.runSourcesMissing(env));
  const sent = buttonsTo(OWNER);
  const body = String(sent[0]?.interactive?.body?.text ?? "");
  assert("04:30: ONE message to Baraa, and to nobody else", r.action === "alerted" && sentTo(OWNER).length === 1 && sent.length === 1 && graph.filter((b: any) => b?.to && b.to !== OWNER).length === 0, JSON.stringify(r));
  assert("it names every silent source with its kind — the supplier asked at 02:00 and the market source", JSON.stringify(r.silent) === JSON.stringify(["أحمد حسان", "عمر المجهلي"]) && body.includes("• أحمد حسان (شراء)") && body.includes("• عمر المجهلي (سوق)") && body.startsWith("⏰ 04:30 — مصادر لم ترسل أسعار اليوم (3 أكتوبر 2026): 2"), body);
  assert("…and the day each last sent a price («خاص» left out) — or that he never did", body.includes("• أحمد حسان (شراء) — آخر إرسال: 1 أكتوبر 2026") && body.includes("• عمر المجهلي (سوق) — آخر إرسال: لم يرسل من قبل"), body.split("\n").slice(1).join(" / "));
  assert("it carries the button «🔁 أعد طلب الأسعار» of the day", sent[0].interactive.action.buttons.length === 1 && sent[0].interactive.action.buttons[0].reply.id === `rsk_${DAY}` && sent[0].interactive.action.buttons[0].reply.title === "🔁 أعد طلب الأسعار" && SM.REASK_TITLE.length <= 20);
  assert("no price of ours is in it", !/\d+(\.\d+)? ?(ريال|ر\.س)/.test(body));
  setRiyadh(`${DAY} 04:35`);
  assert("the next tick: once a day", (await quiet(() => SM.runSourcesMissing(env))).action === "claimed_before" && sentTo(OWNER).length === 1);
  setRiyadh(`${DAY} 05:30`);
  assert("an hour after its minute: not any more (06:00 has its own alert)", (await quiet(() => SM.runSourcesMissing(world(`${DAY} 05:30`)))).action === "after");

  // a source that sent today is not in it; all sent → no alert at all
  const env2 = world(`${DAY} 04:30`);
  offer(DRIVER, DAY, { x_purchase_price: 0, x_market_price: 30 });
  const r2 = await quiet(() => SM.runSourcesMissing(env2));
  assert("a source that sent today is not named", r2.action === "alerted" && JSON.stringify(r2.silent) === JSON.stringify(["أحمد حسان"]) && !String(buttonsTo(OWNER)[0]?.interactive?.body?.text).includes("عمر"));
  const env3 = world(`${DAY} 04:30`, { asked: false });
  offer(DRIVER, DAY, { x_purchase_price: 0, x_market_price: 30 });
  assert("every source sent: no alert", (await quiet(() => SM.runSourcesMissing(env3))).action === "none" && graph.length === 0);

  // an alert the gateway did not take is not «the day's one»
  const env4 = world(`${DAY} 04:30`);
  env4.SIM_ALLOWLIST = "+9665000005,+9665000006,+9665000008"; // Baraa's number is not on it
  const lost = await quiet(() => SM.runSourcesMissing(env4));
  env4.SIM_ALLOWLIST = "+9665";
  setRiyadh(`${DAY} 04:35`);
  const retry = await quiet(() => SM.runSourcesMissing(env4));
  assert("an alert the gateway did not take is tried again at the next tick", lost.action === "not_delivered" && retry.action === "alerted" && buttonsTo(OWNER).length === 1);
  // Meta refuses it: never dropped (an important alert) — queued, and it counts as the day's
  const env5 = world(`${DAY} 04:30`);
  failNext.push(131056);
  const queued = await quiet(() => SM.runSourcesMissing(env5));
  const { readRetries } = await import("../src/wa-retry.ts");
  assert("Meta refuses it (131056): it is an important alert — queued for its retry, nothing blocked", queued.action === "alerted" && (await quiet(() => readRetries(env5))).length === 1 && !env5.MSG_DEDUP.store.has(GW.purposeBlockKey(OWNER, "owner_critical")));
  // outside Baraa's window: held for it
  const env6 = world(`${DAY} 04:30`);
  closeOwnerWindow(env6);
  const held = await quiet(() => SM.runSourcesMissing(env6));
  assert("outside Baraa's window: held for his next message, with its button", held.action === "alerted" && heldFor(env6, OWNER).length === 1 && heldFor(env6, OWNER)[0].purpose === "owner_critical" && heldFor(env6, OWNER)[0].body?.interactive?.action?.buttons?.[0]?.reply?.id === `rsk_${DAY}`);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ و2
console.log("\n[و2] «🔁 أعد طلب الأسعار»");
{
  assert("the button is one of Baraa's own (answered in the owner's branch, whatever role he holds)", isOwnerOwnMessage({ type: "interactive", buttonId: `rsk_${DAY}`, text: "" }) && REASK_PAYLOAD.test(SM.reaskPayload(DAY)) && !REASK_PAYLOAD.test("rsk_x") && !isOwnerOwnMessage({ type: "interactive", buttonId: "rsk_", text: "" }));
  const env = world(`${DAY} 04:40`);
  openWindow(env, AHMED_PHONE, 60);
  const line = await quiet(() => SM.handleReaskButton(env, `rsk_${DAY}`));
  assert("the ask goes again to the supplier still silent (his window open: the form)", sentTo(AHMED_PHONE).length === 1 && sentTo(AHMED_PHONE)[0].type === "interactive", JSON.stringify(sentTo(AHMED_PHONE).map((b: any) => b.type)));
  assert("Baraa reads who was asked and how — and who could not be reached", line.startsWith("🔁 أُعيد طلب أسعار اليوم (04:40): ") && line.includes("أحمد حسان ✅ (النموذج)") && line.includes("عمر المجهلي ✗"), line);
  const again = await quiet(() => SM.handleReaskButton(env, `rsk_${DAY}`));
  assert("a second tap: once a day — nothing goes again", again === "سبق إعادة طلب الأسعار اليوم من هذا الزر ✅" && sentTo(AHMED_PHONE).length === 1);
  // yesterday's button
  const old = await quiet(() => SM.handleReaskButton(world(`${DAY} 04:40`), "rsk_2026-10-02"));
  assert("the button of another day's alert asks nobody", old.includes("لا يُعاد منه طلب") && graph.filter((b: any) => b?.to).length === 0, old);
  // nobody is silent any more
  const env3 = world(`${DAY} 04:40`, { asked: false });
  offer(DRIVER, DAY, { x_purchase_price: 0, x_market_price: 30 });
  assert("every source has sent since: nothing to ask again", (await quiet(() => SM.handleReaskButton(env3, `rsk_${DAY}`))) === "كل المصادر أرسلت أسعار اليوم ✅ لا طلب يُعاد." && graph.filter((b: any) => b?.to).length === 0);
  // from the webhook: Baraa's tap, his one line back
  const env4 = world(`${DAY} 04:40`);
  openWindow(env4, AHMED_PHONE, 60);
  await tap(env4, `rsk_${DAY}`);
  assert("Baraa's tap from WhatsApp: the supplier is asked, and Baraa gets the line", sentTo(AHMED_PHONE).length === 1 && ownerTexts().some((t) => t.startsWith("🔁 أُعيد طلب أسعار اليوم")), ownerTexts().join(" | "));
  // the same button from another number does nothing
  const env5 = world(`${DAY} 04:40`);
  openWindow(env5, AHMED_PHONE, 60);
  await quiet(() => worker.fetch(signed(inbound(DRIVER_PHONE, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `rsk_${DAY}`, title: "x" } } })), env5, ctx));
  assert("the same payload from anyone but Baraa asks nobody", sentTo(AHMED_PHONE).length === 0);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ و3
console.log("\n[و3] 07:30: one reminder of a day still «فائت»");
{
  const missed = (riyadh: string, state = "missed", lines: Array<Record<string, unknown>> = []) => {
    const env = world(riyadh);
    const id = seed("x_price_day", { x_date: DAY, x_state: state, x_name: DAY });
    for (const l of lines) seed("x_price_day_line", { x_day_id: id, x_product_tmpl_id: 1, x_packaging_id: 11, ...l });
    return env;
  };
  assert("07:25: not yet", (await quiet(() => SM.runMissedReminder(missed(`${DAY} 07:25`)))).action === "before" && graph.length === 0);
  const env = missed(`${DAY} 07:30`);
  const r = await quiet(() => SM.runMissedReminder(env));
  assert("07:30, the day still «فائت»: ONE reminder to Baraa", r.action === "reminded" && JSON.stringify(ownerTexts()) === JSON.stringify([SM.missedReminderText(DAY)]) && ownerTexts()[0].startsWith("⏰ تذكير 07:30: أسعار اليوم (3 أكتوبر 2026) ما زالت لم تُنشر"), ownerTexts().join(" | "));
  setRiyadh(`${DAY} 07:35`);
  assert("the next tick: once", (await quiet(() => SM.runMissedReminder(env))).action === "claimed_before" && ownerTexts().length === 1);
  for (const state of ["published", "approved", "draft"]) {
    assert(`a day «${state}» by 07:30: no reminder`, (await quiet(() => SM.runMissedReminder(missed(`${DAY} 07:30`, state)))).action === "not_missed" && graph.length === 0);
  }
  assert("no record of the day at all: no reminder", (await quiet(() => SM.runMissedReminder(world(`${DAY} 07:30`)))).action === "not_missed");
  const closed = missed(`${DAY} 07:30`, "missed", [{ x_decision: "skip" }, { x_decision: "skip", x_product_tmpl_id: 2, x_packaging_id: 21 }]);
  assert("a day Baraa closed himself («لا تنشر» on every line): never reminded", (await quiet(() => SM.runMissedReminder(closed))).action === "by_owner" && graph.length === 0);
  const mixed = missed(`${DAY} 07:30`, "missed", [{ x_decision: "skip" }, { x_decision: false, x_product_tmpl_id: 2, x_packaging_id: 21 }]);
  assert("…one line he did not decide: reminded", (await quiet(() => SM.runMissedReminder(mixed))).action === "reminded");
  assert("08:30: not any more", (await quiet(() => SM.runMissedReminder(missed(`${DAY} 08:30`)))).action === "after" && SM.MISSED_REMIND_MINUTE === 450 && SM.SOURCES_MISSING_MINUTE === 270);
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ و4
console.log("\n[و4] wired in the prices tick");
{
  const env = world(`${DAY} 04:30`);
  const t = await quiet(() => PR.runPricesTick(env, Date.now()));
  assert("the 04:30 tick runs it", (t.sourcesMissing as any)?.action === "alerted" && buttonsTo(OWNER).filter((b) => b.interactive.action.buttons[0].reply.id === `rsk_${DAY}`).length === 1 && (t.missedRemind as any)?.action === "before", JSON.stringify([t.sourcesMissing, t.missedRemind]));
  // the day: the 06:00 alert, then the 07:30 reminder
  const env2 = world(`${DAY} 06:00`);
  await quiet(() => worker.scheduled({ cron: "*/5 * * * *" } as any, env2, ctx));
  assert("06:00: the day is «فائت» and Baraa is told («لم تُنشر»)", (rows("x_price_day")[0] as any)?.x_state === "missed" && ownerTexts().filter((t) => t.includes("لم تُنشر حتى 06:00")).length === 1, ownerTexts().join(" | "));
  setRiyadh(`${DAY} 07:00`);
  await quiet(() => worker.scheduled({ cron: "*/5 * * * *" } as any, env2, ctx));
  assert("07:00: nothing more", ownerTexts().length === 1);
  setRiyadh(`${DAY} 07:30`);
  await quiet(() => worker.scheduled({ cron: "*/5 * * * *" } as any, env2, ctx));
  setRiyadh(`${DAY} 07:35`);
  await quiet(() => worker.scheduled({ cron: "*/5 * * * *" } as any, env2, ctx));
  assert("07:30: the ONE reminder (the day still «فائت»), and none at 07:35", ownerTexts().length === 2 && ownerTexts()[1] === SM.missedReminderText(DAY), ownerTexts().join(" | "));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}

done();
