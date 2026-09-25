// WhatsApp inbox channel titles and one channel per number — 2026-09-25.
//
//   1. inboxChannelName: «واتساب · <name> · +<number>», never without a number;
//   2. ensureInboxChannel titles a new channel, and reuses the channel a number
//      already has (archived owner → handed over; active owner → kept);
//   3. two messages from a new number open one channel, not two;
//   4. syncInboxChannelTitles: live / «(قديم)», dry run, partner rename;
//   5. /odoo/hook/wa-inbox-partner (the rename automation's webhook).
//
// In-memory Odoo (tests/wa-harness.mts). No network, no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/inbox-title.test.mts

import { ctx as baseCtx, employee, odooLog, openWindow, quiet, reset, rows, seed, table } from "./wa-harness.mts";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const { inboxChannelName, ensureInboxChannel, ingestInbound, syncInboxChannelTitles, waNumber, OLD_TITLE_PREFIX } =
  await import("../src/wa-inbox.ts");
const worker = (await import("../src/index.ts")).default;

const LRI = "\u2066", PDI = "\u2069";
const num = (n: string) => `${LRI}${n}${PDI}`;
const channelCreates = () => odooLog.filter((l) => l.model === "discuss.channel" && l.method === "create").length;
const channel = (id: number) => table("discuss.channel").get(id)!;
const hasNumber = (t: string) => /\u2066\+\d{6,}\u2069$/.test(t);
/** reset() + what ensureInboxChannel needs: Baraa's user, the bot partner. */
function fresh(): any {
  const env = reset();
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  seed("res.partner", { id: 3, name: "براء" });
  seed("res.partner", { id: 42, name: "UTAK بوت" });
  env.ODOO_HOOK_TOKEN = "HOOK";
  return env;
}

// ================================================================ 1
console.log("\n[1] inboxChannelName");
{
  const t = inboxChannelName({ partnerName: "أحمد حسان", number: "+966571777704" });
  assert("named partner: «واتساب · أحمد حسان · +966571777704»", t === `واتساب · أحمد حسان · ${num("+966571777704")}`, JSON.stringify(t));
  const p = inboxChannelName({ partnerName: "+966570540176", profileName: "𐙚 Bubbles 𐙚", number: "966570540176" });
  assert("no Odoo name (named by its number): the WhatsApp profile name", p === `واتساب · 𐙚 Bubbles 𐙚 · ${num("+966570540176")}`, JSON.stringify(p));
  const n = inboxChannelName({ partnerName: "", profileName: "", number: "+967700036370" });
  assert("no name, no profile: the number alone", n === `واتساب · ${num("+967700036370")}`, JSON.stringify(n));
  assert("formatted phone → full international number", inboxChannelName({ partnerName: "ابو مكين", number: "+966 50 961 7756" })!.endsWith(num("+966509617756")));
  const a = inboxChannelName({ partnerName: "Not Book", number: "+967700036370" });
  const b = inboxChannelName({ partnerName: "Not Book", number: "+966581840436" });
  assert("two numbers, same profile name → two different titles", a !== b && a!.startsWith("واتساب · Not Book · ") && b!.startsWith("واتساب · Not Book · "));
  assert("no number → null (never a title without one)", [undefined, null, "", false, "abc", "  "].every((v) => inboxChannelName({ partnerName: "عمر", number: v }) === null));
  assert("bidi controls and line breaks in a profile name are dropped", inboxChannelName({ partnerName: "عمر\u202e\n  الجديد", number: "+1" }) === `واتساب · عمر الجديد · ${num("+1")}`);
  assert("old channel: «(قديم) » prefix", inboxChannelName({ partnerName: "عمر", number: "+967775180888", old: true }) === `${OLD_TITLE_PREFIX}واتساب · عمر · ${num("+967775180888")}`);
  assert("waNumber normalises every stored form", waNumber("+966 50-961 (7756)") === "+966509617756" && waNumber(false) === "");
}

// ================================================================ 2
console.log("\n[2] ensureInboxChannel: title, never without a number, one channel per number");
{
  const env = fresh();
  seed("res.partner", { id: 700, name: "أحمد حسان", x_whatsapp_number: "+966571777704", phone: "+966571777704", customer_rank: 1 });
  const id = await quiet(() => ensureInboxChannel(env, 700, "أحمد حسان"));
  assert("new channel titled name · number", id && channel(id!).name === `واتساب · أحمد حسان · ${num("+966571777704")}`, JSON.stringify(id && channel(id!)));
  assert("partner linked to it", table("res.partner").get(700)!.x_wa_channel_id === id);

  seed("res.partner", { id: 701, name: "بلا رقم", customer_rank: 1 });
  const before = channelCreates();
  const none = await quiet(() => ensureInboxChannel(env, 701, "بلا رقم"));
  assert("partner without any number: no channel, null", none === null && channelCreates() === before);

  seed("res.partner", { id: 702, name: "+966570540176", x_whatsapp_number: "+966570540176", customer_rank: 1 });
  const bid = await quiet(() => ensureInboxChannel(env, 702, "+966570540176", { number: "+966570540176", profileName: "Bubbles" }));
  assert("partner named by its number: profile name in the title", channel(bid!).name === `واتساب · Bubbles · ${num("+966570540176")}`, channel(bid!).name as string);
}
{
  // archived owner → the new partner takes the channel over
  const env = fresh();
  seed("res.partner", { id: 710, name: "عمر", x_whatsapp_number: "+967775180888", active: false, x_wa_channel_id: 21 });
  seed("discuss.channel", { id: 21, name: "واتساب · عمر", x_wa_partner_id: 710 });
  seed("res.partner", { id: 711, name: "عمر الجديد", x_whatsapp_number: "+967775180888", customer_rank: 1 });
  const before = channelCreates();
  const id = await quiet(() => ensureInboxChannel(env, 711, "عمر الجديد", { number: "+967775180888" }));
  assert("archived owner: same channel reused, none created", id === 21 && channelCreates() === before, `${id} creates=${channelCreates() - before}`);
  assert("new partner linked to it", table("res.partner").get(711)!.x_wa_channel_id === 21);
  assert("channel handed over to the active partner", channel(21).x_wa_partner_id === 711);
  assert("…and titled after it", channel(21).name === `واتساب · عمر الجديد · ${num("+967775180888")}`, channel(21).name as string);
}
{
  // active owner saved as «+966 50 961 7756» → kept, its Odoo name stays the title
  const env = fresh();
  seed("res.partner", { id: 720, name: "ابو مكين المعبري", phone: "+966 50 961 7756", phone_sanitized: "+966509617756", x_wa_channel_id: 17, customer_rank: 1 });
  seed("discuss.channel", { id: 17, name: "واتساب · ابو مكين المعبري", x_wa_partner_id: 720 });
  seed("res.partner", { id: 721, name: "يو", x_whatsapp_number: "+966509617756", phone: "+966509617756", customer_rank: 1 });
  const before = channelCreates();
  const id = await quiet(() => ensureInboxChannel(env, 721, "يو", { number: "+966509617756" }));
  assert("formatted phone of an active contact: its channel reused", id === 17 && channelCreates() === before);
  assert("active owner keeps the channel (Odoo name wins)", channel(17).x_wa_partner_id === 720 && channel(17).name === "واتساب · ابو مكين المعبري");
}

// ================================================================ 3
console.log("\n[3] two messages from a new number → one channel");
{
  const env = fresh();
  const m = (text: string) => ({ partnerId: 0, partnerName: "", wamid: `w${Math.random()}`, type: "text", text, from: "+966599000111", profileName: "Not Book", metaTimestamp: String(Math.floor(Date.now() / 1000)) });
  const r1 = await quiet(() => ingestInbound(env, m("السلام عليكم")));
  const r2 = await quiet(() => ingestInbound(env, m("عندكم طماطم؟")));
  const chans = rows("discuss.channel");
  assert("one partner, one channel", r1.partnerId === r2.partnerId && chans.length === 1, JSON.stringify(chans));
  assert("title: profile name · number", chans[0]?.name === `واتساب · Not Book · ${num("+966599000111")}`, String(chans[0]?.name));
  const posts = odooLog.filter((l) => l.model === "discuss.channel" && l.method === "message_post");
  assert("both messages posted to it", posts.length === 2 && posts.every((p) => p.body.ids[0] === chans[0].id));
}

// ================================================================ 4
console.log("\n[4] syncInboxChannelTitles");
{
  const env = fresh();
  // +967775180888: archived «عمر» (channel 21) and active «عمر» (channel 30, the live one)
  seed("res.partner", { id: 17, name: "عمر", x_whatsapp_number: "+967775180888", active: false, x_wa_channel_id: 21 });
  seed("res.partner", { id: 46, name: "عمر", x_whatsapp_number: "+967775180888", phone: "+967775180888", customer_rank: 1, x_wa_channel_id: 30 });
  seed("discuss.channel", { id: 21, name: "واتساب · عمر", x_wa_partner_id: 17 });
  seed("discuss.channel", { id: 30, name: "واتساب · عمر", x_wa_partner_id: 46 });
  // another «عمر», another number
  seed("res.partner", { id: 9, name: "عمر المجهلي", x_whatsapp_number: "+966545816832", x_wa_channel_id: 19 });
  employee(9, [73]); // STATUS § 31 — the team is hr.employee (Work Contact 9)
  seed("discuss.channel", { id: 19, name: "واتساب · عمر المجهلي", x_wa_partner_id: 9 });
  // archived partner, the only channel of its number: not «(قديم)»
  seed("res.partner", { id: 18, name: "🤍", x_whatsapp_number: "+967774375736", active: false, x_wa_channel_id: 22 });
  seed("discuss.channel", { id: 22, name: "واتساب · 🤍", x_wa_partner_id: 18 });
  // partner without a number: left alone
  seed("res.partner", { id: 60, name: "بلا رقم", x_wa_channel_id: 40 });
  seed("discuss.channel", { id: 40, name: "واتساب · بلا رقم", x_wa_partner_id: 60 });

  const dry = await quiet(() => syncInboxChannelTitles(env, { dryRun: true }));
  assert("dry run writes nothing", !odooLog.some((l) => l.model === "discuss.channel" && l.method === "write") && dry.every((c) => !c.written));
  const res = await quiet(() => syncInboxChannelTitles(env));
  const t = (id: number) => channel(id).name as string;
  assert("live channel of the number: no prefix", t(30) === `واتساب · عمر · ${num("+967775180888")}`, t(30));
  assert("the other channel of that number: «(قديم)»", t(21) === `(قديم) واتساب · عمر · ${num("+967775180888")}`, t(21));
  assert("three «عمر» channels now tell apart", new Set([t(19), t(21), t(30)]).size === 3);
  assert("single channel of an archived partner: no «(قديم)»", t(22) === `واتساب · 🤍 · ${num("+967774375736")}`, t(22));
  assert("no number: title untouched, after = null", t(40) === "واتساب · بلا رقم" && res.find((c) => c.channelId === 40)?.after === null);
  assert("every written title ends with a number", res.filter((c) => c.written).every((c) => hasNumber(c.after!.replace(OLD_TITLE_PREFIX, ""))));
  const again = await quiet(() => syncInboxChannelTitles(env));
  assert("second run writes nothing (idempotent)", again.every((c) => !c.written));

  // Baraa renames the partner in Odoo → the title follows
  table("res.partner").get(46)!.name = "عمر الحداد";
  const one = await quiet(() => syncInboxChannelTitles(env, { partnerId: 46 }));
  assert("rename: live title follows the partner", t(30) === `واتساب · عمر الحداد · ${num("+967775180888")}`, t(30));
  assert("rename: only that number's channels are touched", one.every((c) => [21, 30].includes(c.channelId)), JSON.stringify(one.map((c) => c.channelId)));
}

// ================================================================ 5
console.log("\n[5] /odoo/hook/wa-inbox-partner");
{
  const env = fresh();
  seed("res.partner", { id: 50, name: "Not Book", x_whatsapp_number: "+967700036370", customer_rank: 1, x_wa_channel_id: 33 });
  seed("discuss.channel", { id: 33, name: "واتساب · Not Book", x_wa_partner_id: 50 });
  const pending: Promise<unknown>[] = [];
  const ctx = { ...baseCtx, waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  const hook = (token: string, body: unknown) => worker.fetch(new Request(`https://w.test/odoo/hook/wa-inbox-partner?token=${token}`, { method: "POST", body: JSON.stringify(body) }), env, ctx);
  const bad = await quiet(() => hook("nope", { _id: 50, _model: "res.partner" }));
  assert("wrong token → 401, nothing renamed", bad.status === 401 && channel(33).name === "واتساب · Not Book");
  const wrongModel = await quiet(() => hook("HOOK", { _id: 50, _model: "mail.message" }));
  assert("other model → 400", wrongModel.status === 400);
  table("res.partner").get(50)!.name = "بقالة الريان";
  const ok = await quiet(() => hook("HOOK", { _id: 50, _model: "res.partner" }));
  await quiet(() => Promise.all(pending));
  assert("202 accepted", ok.status === 202);
  assert("title rebuilt from the renamed partner", channel(33).name === `واتساب · بقالة الريان · ${num("+967700036370")}`, channel(33).name as string);
}

// ================================================================ 6
console.log("\n[6] outbound echo reaches the number's channel when no active partner matches it exactly");
{
  const env = fresh();
  const { sendText } = await import("../src/meta.ts");
  // saved by hand as «+966 50 000 0777»: the echo's ilike on the digits misses it
  seed("res.partner", { id: 41, name: "ماجد المجهلي", phone: "+966 50 000 0777", phone_sanitized: "+966500000777", x_wa_channel_id: 18 });
  seed("discuss.channel", { id: 18, name: "واتساب · ماجد المجهلي", x_wa_partner_id: 41 });
  openWindow(env, "966500000777"); // STATUS § 33 — a session text needs the window
  await quiet(() => sendText(env, "+966500000777", "طلبك في الطريق", { purpose: "bot_reply" }));
  const posts = odooLog.filter((l) => l.model === "discuss.channel" && l.method === "message_post");
  assert("echo posted in the number's channel", posts.length === 1 && posts[0].body.ids[0] === 18, JSON.stringify(posts.map((p) => p.body.ids)));
  assert("no channel created", channelCreates() === 0);
}

console.log(`\ninbox-title: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
