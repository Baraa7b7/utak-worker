// New-number screening and «مراجعة الأرقام» + Baraa's automatic window time
// (2026-09-25, STATUS § 30).
//
//   • every intent and its behaviour: purchase stays a customer (no review);
//     unclear stays a customer, flagged; wrong number / vendor pitch / personal
//     / spam are flagged and held: no bot reply, no follow-up, reactivation,
//     rating or reminder, until Baraa decides. The first welcome reply is not
//     withdrawn. One channel message and one owner alert per partner;
//   • a real order confirms a customer, no review; screening stops once the
//     class is fixed; the known (team, supplier, a customer with an order,
//     Baraa) are never screened;
//   • each button (the Python the Odoo server actions run) sets the right
//     fields; «أرشفة» deletes nothing, and a number archived from the review
//     gets nothing (no new partner, no welcome, no reply);
//   • the backfill plan: only WhatsApp-created, unknown partners, only the new
//     fields;
//   • Baraa's window: earliest shift − 15 min, or OWNER_WINDOW_OPEN_AT.
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts) behind the strict
// schema gate from the tenant's real field lists (…-20260924, …-suppliers,
// …-attendance and …-20260925-review.json, taken after
// scripts/rev-20260925-odoo-setup.mjs --apply). Claude is faked by system
// prompt. No network, no WhatsApp send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/review.test.mts

import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { ctx, graph, odooLog, OWNER, quiet, reset, rows, seed, sentTo, setRiyadh, table, CUST, CUST_PHONE, WH_PHONE } from "./wa-harness.mts";
// @ts-ignore — plain .mjs
import { REVIEW_BUTTONS } from "../scripts/lib/review-buttons.mjs";
// @ts-ignore
import { planBackfill } from "../scripts/lib/review-backfill-core.mjs";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(name: string, cond: unknown, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ---------------------------------------------------------------- strict schema gate
const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const FX = ["./fixtures-odoo-fields-20260924.json", "./fixtures-odoo-fields-20260925-suppliers.json",
  "./fixtures-odoo-fields-20260925-attendance.json", "./fixtures-odoo-fields-20260925-review.json"].map(load);
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

// ---------------------------------------------------------------- fake Claude, by system prompt
let CLASSIFY = "other";
let SCREEN: unknown = { intent: "unclear", reason: "سبب" };
let ORDER_ITEMS: unknown[] = [];
let claudeDown = false;
const calls = { classify: 0, screen: 0, extract: 0, reply: 0 };
/** One-shot Odoo faults: the first call a predicate matches fails (HTTP 400, never retried). */
const faults: Array<(model: string, method: string, body: any) => boolean> = [];
const screenInputs: string[] = [];
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: any) => {
  const url = typeof input === "string" ? input : (input as any)?.url ?? String(input);
  if (url.includes("anthropic.com")) {
    const b = JSON.parse(init.body);
    const sys = String(b.system ?? "");
    let text: string;
    if (sys.startsWith("You screen")) {
      calls.screen++; screenInputs.push(String(b.messages?.[0]?.content ?? ""));
      if (claudeDown) return new Response("down", { status: 529 });
      text = JSON.stringify(SCREEN);
    } else if (sys.startsWith("You classify")) { calls.classify++; text = JSON.stringify({ intent: CLASSIFY, confidence: 0.9 }); }
    else if (sys.includes("extract structured order items")) { calls.extract++; text = JSON.stringify(ORDER_ITEMS); }
    else { calls.reply++; text = "أهلاً وسهلاً، كيف نخدمك؟"; }
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
  }
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m && init?.body) {
    const hit = faults.findIndex((f) => f(m[1], m[2], JSON.parse(init.body)));
    if (hit >= 0) {
      faults.splice(hit, 1);
      return new Response(JSON.stringify({ name: "builtins.RuntimeError", message: "injected" }), { status: 400 });
    }
  }
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
      const message = bad.length ? `Invalid field '${bad[0]}' on '${m[1]}'` : `Wrong value for ${badSel[0]}`;
      return new Response(JSON.stringify({ name: "builtins.ValueError", message, arguments: [message] }), { status: 500 });
    }
  }
  // Odoo's active_test: a res.partner search hides archived rows unless the
  // domain names `active` or the context turns it off (the shared harness
  // does not). The archived-from-review path depends on it.
  if (m && m[1] === "res.partner" && ["search_read", "search", "search_count"].includes(m[2]) && init?.body) {
    const b = JSON.parse(init.body);
    const namesActive = JSON.stringify(b.domain ?? []).includes('"active"');
    if (!namesActive && b.context?.active_test !== false) {
      const live = (id: number) => table("res.partner").get(id)?.active !== false;
      if (m[2] === "search_count") {
        const found = await (await harnessFetch(url.replace("/search_count", "/search"), init)).json() as number[];
        return new Response(JSON.stringify(found.filter(live).length), { status: 200 });
      }
      // Odoo filters archived rows before the limit
      const unlimited = await (await harnessFetch(input as any, { ...init, body: JSON.stringify({ ...b, limit: undefined }) })).json() as any[];
      const kept = unlimited.filter((r) => live(typeof r === "number" ? r : r.id));
      return new Response(JSON.stringify(b.limit ? kept.slice(0, b.limit) : kept), { status: 200 });
    }
  }
  return harnessFetch(input as any, init);
}) as typeof fetch;

const { setOdooRetryHooksForTests } = await import("../src/odoo.ts");
setOdooRetryHooksForTests({ sleep: async () => {}, alert: async () => {} });
const { clearTemplateCache } = await import("../src/templates.ts");
const screening = await import("../src/screening.ts");
const outreach = await import("../src/outreach.ts");
const team = await import("../src/team.ts");
const { sendStandingOrderReminders } = await import("../src/standing.ts");
const att = await import("../src/attendance.ts");
const worker = (await import("../src/index.ts")).default;
const { REVIEW_ALERT_PREFIX, INTENT_LABEL, isCustomerAutomationHeld } = screening;

// ---------------------------------------------------------------- data + helpers
const REVIEW_CH = 36, REVIEW_ACTION = 993, BOT = 42;
const EXTRA_TPL: Array<[string, string, number, string]> = [
  ["customer_pay_remind", "utak_v2_pay_remind", 2, "UTILITY"],
  ["customer_feedback", "utak_feedback", 1, "MARKETING"],
  ["customer_inactive", "utak_v2_inactive", 1, "MARKETING"],
  ["customer_welcome", "utak_welcome", 2, "UTILITY"],
  ["team_shift_start", "utak_shift_start_v2", 1, "UTILITY"],
];
function fresh(riyadh = "2026-09-25 10:00"): any {
  const env = reset(); clearTemplateCache(); setRiyadh(riyadh);
  CLASSIFY = "other"; SCREEN = { intent: "unclear", reason: "سبب" }; ORDER_ITEMS = []; claudeDown = false; faults.length = 0;
  calls.classify = calls.screen = calls.extract = calls.reply = 0; screenInputs.length = 0; rejected.length = 0;
  EXTRA_TPL.forEach(([purpose, name, n, cat], i) => seed("x_whatsapp_template", {
    id: 950 + i, x_purpose: purpose, x_meta_template_id: name, x_language: "ar", x_meta_status: "APPROVED", x_param_count: n, x_category: cat,
  }));
  seed("res.users", { id: 2, login: "x", partner_id: 3 });
  seed("res.partner", { id: 3, name: "albaraa abdulwahab" });
  seed("res.partner", { id: BOT, name: "UTAK بوت" });
  seed("discuss.channel", { id: REVIEW_CH, name: "📋 مراجعة الأرقام", channel_type: "channel" });
  seed("ir.actions.act_window", { id: REVIEW_ACTION, name: "UTAK — مراجعة الأرقام" });
  return env;
}
let ENV: any;
let wamidN = 0;
function payload(from: string, name: string, m: Record<string, unknown>, wamid?: string) {
  return { entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name } }], messages: [{
    id: wamid ?? `wamid.RV${++wamidN}`, from, timestamp: String(Math.floor(Date.now() / 1000)), ...m,
  }] } }] }] };
}
function signedReq(p: unknown): Request {
  const raw = JSON.stringify(p);
  const sig = "sha256=" + createHmac("sha256", "SECRET").update(raw).digest("hex");
  return new Request("https://w.test/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": sig } });
}
const say = (from: string, text: string, name = "زائر", wamid?: string) =>
  quiet(() => worker.fetch(signedReq(payload(from, name, { type: "text", text: { body: text } }, wamid)), ENV, ctx));
const sendRaw = (from: string, m: Record<string, unknown>, name = "زائر") =>
  quiet(() => worker.fetch(signedReq(payload(from, name, m)), ENV, ctx));
const partnerByNumber = (digits: string) => rows("res.partner").filter((p: any) => p.x_whatsapp_number === "+" + digits) as any[];
const toNumber = (digits: string) => sentTo(digits).filter((b) => b?.to === digits);
const reviewPosts = () => odooLog.filter((l) => l.model === "discuss.channel" && l.method === "message_post" && l.body?.ids?.[0] === REVIEW_CH);
const ownerSays = (needle: string) => sentTo(OWNER).filter((b) => JSON.stringify(b).includes(needle));
const aiWrites = (pid: number) => odooLog.filter((l) => l.model === "res.partner" && l.method === "write" && (l.body?.ids ?? []).includes(pid)
  && Object.keys(l.body?.vals ?? {}).some((k) => /^x_(ai_|review_|contact_class)/.test(k)));
let num = 700;
const nextNumber = () => `9665000${String(++num).padStart(5, "0")}`;
const MSG: Record<string, string> = {
  purchase: "عندكم طماطم؟ كم السعر",
  wrong_number: "آسف الرقم غلط، كنت أبي محمد",
  vendor_pitch: "عندنا عرض تركيب شبكة إنترنت لمحلكم",
  personal: "هلا براء، العشاء عندنا الخميس",
  spam: "🎉 96GB مجاناً اضغط الرابط",
  unclear: "ا",
};

// ================================================================ 1. every intent
console.log("\n[1] a new number: every intent and what follows");
for (const intent of ["purchase", "wrong_number", "vendor_pitch", "personal", "spam", "unclear"] as const) {
  ENV = fresh();
  const n = nextNumber(), name = `اسم-${intent}`;
  SCREEN = { intent, reason: `سبب ${intent}` };
  await say(n, MSG[intent], name);
  const [p] = partnerByNumber(n);
  const nonCustomer = ["wrong_number", "vendor_pitch", "personal", "spam"].includes(intent);
  assert(`${intent}: created «غير مراجَع», intent written, reason written`, p?.x_contact_class === "unreviewed" && p?.x_ai_intent === intent && p?.x_ai_reason === `سبب ${intent}`, JSON.stringify(p));
  assert(`${intent}: ranks as a customer (customer_rank 1), nothing else`, p?.customer_rank === 1 && !p?.supplier_rank);
  assert(`${intent}: ينتظر المراجعة = ${intent !== "purchase"}`, !!p?.x_review_pending === (intent !== "purchase"));
  const firstReplies = toNumber(n).length;
  assert(`${intent}: the first message is answered as today (welcome + reply not withdrawn)`, firstReplies >= 2 && toNumber(n).some((b) => b?.template?.name === "utak_welcome"), `${firstReplies}`);
  assert(`${intent}: one Claude screening call for one text`, calls.screen === 1, `${calls.screen}`);
  const posts = reviewPosts();
  assert(`${intent}: channel messages = ${intent === "purchase" ? 0 : 1}`, posts.length === (intent === "purchase" ? 0 : 1), `${posts.length}`);
  assert(`${intent}: owner alert «رقم جديد ينتظر المراجعة: ${name}» ×${intent === "purchase" ? 0 : 1}`, ownerSays(`${REVIEW_ALERT_PREFIX}${name}`).length === (intent === "purchase" ? 0 : 1));
  if (posts.length) {
    const body = String(posts[0].body.body);
    assert(`${intent}: channel message = name, number, intent, reason, first message, link — as UTAK بوت`,
      body.includes(name) && body.includes("+" + n) && body.includes(INTENT_LABEL[intent]) && body.includes(`سبب ${intent}`)
      && body.includes(MSG[intent].replace(/</g, "&lt;")) && body.includes(`https://odoo.test/odoo/action-${REVIEW_ACTION}/${p.id}`) && posts[0].body.author_id === BOT, body);
  }
  // the second text
  SCREEN = { intent, reason: `سبب ${intent} 2` };
  await say(n, "رسالة ثانية", name);
  const second = toNumber(n).length - firstReplies;
  assert(`${intent}: second text ${nonCustomer ? "gets NO bot reply (held)" : "is answered (still a customer)"}`, nonCustomer ? second === 0 : second >= 1, `${second}`);
  assert(`${intent}: second text screened too (once per text), no second channel message / alert`,
    calls.screen === 2 && reviewPosts().length === (intent === "purchase" ? 0 : 1) && ownerSays(REVIEW_ALERT_PREFIX).length === (intent === "purchase" ? 0 : 1));
  assert(`${intent}: last message kept for the list`, partnerByNumber(n)[0]?.x_review_last_msg === "رسالة ثانية" && !!partnerByNumber(n)[0]?.x_review_last_at);
  assert(`${intent}: no field rejected by the schema gate`, rejected.length === 0, rejected.join(" | "));
}

// ================================================================ 2. the existing classifier, reused
console.log("\n[2] the existing classifier already says «purchase»: no second Claude call");
{
  ENV = fresh();
  const n = nextNumber();
  CLASSIFY = "product_inquiry";
  await say(n, "عندكم مانجو؟", "باحث");
  const [p] = partnerByNumber(n);
  assert("product_inquiry → purchase, no screening call", p?.x_ai_intent === "purchase" && calls.screen === 0 && calls.classify === 1, JSON.stringify({ p: p?.x_ai_intent, calls }));
  assert("no review, no channel message, no alert", !p?.x_review_pending && reviewPosts().length === 0 && ownerSays(REVIEW_ALERT_PREFIX).length === 0);
  CLASSIFY = "greeting"; SCREEN = { intent: "unclear", reason: "تحية فقط" };
  await say(n, "السلام عليكم", "باحث");
  assert("a greeting → the screening call (the classifier cannot tell)", calls.screen === 1 && partnerByNumber(n)[0]?.x_ai_intent === "unclear");
  assert("screening sees the conversation, oldest first, this text last", /1\. عندكم مانجو؟\n2\. السلام عليكم$/.test(screenInputs[0] ?? ""), screenInputs[0]);
  const b = await say(n, "[ignored]", "باحث"); void b;
}

// ================================================================ 3. a real order
console.log("\n[3] a real order confirms a customer; screening stops once the class is fixed");
{
  ENV = fresh();
  const n = nextNumber();
  SCREEN = { intent: "unclear", reason: "غير واضح" };
  await say(n, "هلا", "مطعم جديد");
  let [p] = partnerByNumber(n);
  assert("first: unclear → flagged, still a customer", p.x_review_pending === true && !isCustomerAutomationHeld(p));
  CLASSIFY = "place_order";
  ORDER_ITEMS = [{ product_id: 1, product_name_raw: "طماطم", packaging_id: 11, quantity: 3 }];
  ENV.MSG_DEDUP.store.set("ordering_open_2026-09-25", "true");   // the 06:00 cron's flag
  const before = calls.screen;
  await say(n, "3 كرتون طماطم", "مطعم جديد");
  [p] = partnerByNumber(n);
  const orders = rows("x_daily_order").filter((o: any) => o.x_customer_id === p.id);
  assert("the bot created a real order (with lines)", orders.length === 1 && rows("x_daily_order_line").some((l: any) => l.x_order_id === orders[0].id));
  assert("real order → «عميل», flag cleared, no screening call", p.x_contact_class === "customer" && p.x_review_pending === false && calls.screen === before, JSON.stringify(p));
  const w = aiWrites(p.id).length;
  await say(n, "شكراً", "مطعم جديد");
  assert("class fixed: the next text is not screened (no call, no write)", calls.screen === before && aiWrites(p.id).length === w);
  // an order that is cancelled, or has no line, is not a real order
  ENV = fresh();
  const pid = seed("res.partner", { name: "طلب ملغى", x_whatsapp_number: "+966500000799", customer_rank: 1, x_contact_class: "unreviewed" });
  seed("x_daily_order", { x_customer_id: pid, x_state: "cancelled", x_order_date: "2026-09-25" });
  seed("x_daily_order_line", { x_order_id: [...table("x_daily_order").keys()].at(-1), x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 1 });
  seed("x_daily_order", { x_customer_id: pid, x_state: "draft", x_order_date: "2026-09-25" });
  assert("cancelled order / order without lines: not real", !(await quiet(() => screening.hasRealOrder(ENV, pid))));
}

// ================================================================ 4. the known are never touched
console.log("\n[4] team, supplier, a customer with orders, Baraa: never screened");
{
  ENV = fresh();
  const SUP = seed("res.partner", { name: "مورد", supplier_rank: 1, x_whatsapp_number: "+966500000810", x_supplied_product_ids: [1] });
  const OTH = seed("res.partner", { name: "عثمان", x_whatsapp_number: "+966500000811", customer_rank: 1, x_role_ids: [71], x_contact_class: "team" });
  CLASSIFY = "other"; SCREEN = { intent: "spam", reason: "x" };
  await say(WH_PHONE, "مرحبا", "أحمد");
  await say("966500000810", "طماطم 20", "مورد");
  await say("966500000811", "السلام عليكم", "عثمان");
  await say(CUST_PHONE, "هلا", "مطعم الوادي");        // a legacy customer: class empty
  await say(OWNER, "تجربة", "براء");
  assert("no screening call for any of them", calls.screen === 0, `${calls.screen}`);
  assert("no review field written on any of them", [601, SUP, OTH, CUST].every((id) => aiWrites(id).length === 0));
  assert("nothing entered review", reviewPosts().length === 0 && ownerSays(REVIEW_ALERT_PREFIX).length === 0);
  assert("the legacy customer is answered as before", toNumber(CUST_PHONE).length >= 1);
  assert("a button tap from an unreviewed number is not screened (text only)", await (async () => {
    const n = nextNumber();
    await sendRaw(n, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "want_order", title: "أبغى أطلب" } } });
    return calls.screen === 0;
  })());
}

// ================================================================ 5. held: no automated customer message
console.log("\n[5] held for review: no follow-up, reactivation, rating, reminder — «غير واضح» still gets them");
{
  const people = () => ({
    held: seed("res.partner", { id: 901, name: "إزعاج", x_whatsapp_number: "+966500000901", customer_rank: 1, x_contact_class: "unreviewed", x_ai_intent: "spam", x_review_pending: true }),
    unclear: seed("res.partner", { id: 902, name: "غير واضح", x_whatsapp_number: "+966500000902", customer_rank: 1, x_contact_class: "unreviewed", x_ai_intent: "unclear", x_review_pending: true }),
    personal: seed("res.partner", { id: 903, name: "صديق", x_whatsapp_number: "+966500000903", customer_rank: 1, x_contact_class: "personal" }),
    decided: seed("res.partner", { id: 904, name: "عميل مثبّت", x_whatsapp_number: "+966500000904", customer_rank: 1, x_contact_class: "customer", x_ai_intent: "spam", x_review_pending: true }),
  });
  const got = (id: number) => sentTo(`966500000${id}`).length;
  const expect = (label: string) => {
    assert(`${label}: held (spam, flagged) gets nothing`, got(901) === 0, `${got(901)}`);
    assert(`${label}: decided «شخصي» gets nothing`, got(903) === 0, `${got(903)}`);
    assert(`${label}: «غير واضح» (flagged) still gets it`, got(902) >= 1, `${got(902)}`);
    assert(`${label}: decided «عميل» gets it`, got(904) >= 1, `${got(904)}`);
  };
  // 08:00 feedback (delivered in the last 24h)
  ENV = fresh("2026-09-25 08:00"); let ids = people();
  for (const id of Object.values(ids)) seed("x_daily_order", { x_customer_id: id, x_state: "delivered", x_delivered_at: "2026-09-24 12:00:00", x_order_date: "2026-09-24" });
  await quiet(() => outreach.sendPostDeliveryFeedback(ENV)); expect("rating (08:00)");
  // 08:00 pay reminder
  ENV = fresh("2026-09-25 08:00"); ids = people();
  for (const id of Object.values(ids)) {
    const o = seed("x_daily_order", { x_customer_id: id, x_state: "delivered", x_order_date: "2026-09-18" });
    seed("x_invoice", { x_invoice_number: `INV-${id}`, x_total: 100, x_status: "issued", x_invoice_date: "2026-09-18", x_is_simulation: false, x_order_id: o });
  }
  await quiet(() => outreach.sendPaymentReminders(ENV)); expect("pay reminder (08:00)");
  // 08:00 inactive nudge
  ENV = fresh("2026-09-25 08:00"); ids = people();
  for (const id of Object.values(ids)) seed("x_daily_order", { x_customer_id: id, x_state: "delivered", x_order_date: "2026-08-20" });
  await quiet(() => outreach.sendInactiveReengagement(ENV)); expect("reactivation (08:00)");
  // 17:00 standing order
  ENV = fresh("2026-09-25 17:00"); ids = people();
  for (const id of Object.values(ids)) {
    const sid = seed("x_standing_order", { x_customer_id: id, x_active: true, x_frequency: "daily", x_last_triggered: false });
    seed("x_standing_order_line", { x_standing_id: sid, x_product_tmpl_id: 1, x_packaging_id: 11, x_default_quantity: 2 });
  }
  await quiet(() => sendStandingOrderReminders(ENV)); expect("standing reminder (17:00)");
  // 20:00 unconfirmed-order reminder, 21:00 cancel notice
  ENV = fresh("2026-09-25 20:00"); ids = people();
  for (const id of Object.values(ids)) {
    const o = seed("x_daily_order", { x_customer_id: id, x_state: "draft", x_order_date: "2026-09-25" });
    seed("x_daily_order_line", { x_order_id: o, x_product_tmpl_id: 1, x_packaging_id: 11, x_quantity: 2 });
  }
  await quiet(() => team.sendCutoffReminders(ENV)); expect("order reminder (20:00)");
  graph.length = 0; setRiyadh("2026-09-25 21:00");
  await quiet(() => team.closeUnconfirmedOrders(ENV)); expect("cancel notice (21:00)");
  assert("21:00: the held partner's order is still cancelled (only the notice is skipped)", rows("x_daily_order").filter((o: any) => o.x_customer_id === 901).every((o: any) => o.x_state === "cancelled"));
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

// ================================================================ 6. a held partner writes in
console.log("\n[6] a held partner writes: no reply to text, location, media or «إيقاف»; a purchase text lifts the hold");
{
  ENV = fresh();
  const H = seed("res.partner", { id: 911, name: "عرض", x_whatsapp_number: "+966500000911", phone: "+966500000911", customer_rank: 1, x_contact_class: "unreviewed", x_ai_intent: "vendor_pitch", x_review_pending: true });
  SCREEN = { intent: "vendor_pitch", reason: "ما زال يعرض" };
  await say("966500000911", "نعرض عليكم أكياس", "عرض");
  await sendRaw("966500000911", { type: "location", location: { latitude: 24.7, longitude: 46.7, name: "المحل" } }, "عرض");
  await sendRaw("966500000911", { type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }, "عرض");
  await say("966500000911", "إيقاف", "عرض");
  assert("text / location / image / «إيقاف»: nothing sent to him", toNumber("966500000911").length === 0, JSON.stringify(toNumber("966500000911")).slice(0, 200));
  assert("no owner alert about his image (no «📎 صورة من عميل»)", ownerSays("صورة من عميل").length === 0);
  assert("«إيقاف» still kept as his preference", table("res.partner").get(H)!.x_wa_marketing_optout === true);
  assert("his text was screened (once), not the command", calls.screen === 1);
  assert("already flagged: no second channel message, no alert", reviewPosts().length === 0 && ownerSays(REVIEW_ALERT_PREFIX).length === 0);
  SCREEN = { intent: "purchase", reason: "يسأل عن الأسعار" };
  await say("966500000911", "طيب كم سعر الطماطم عندكم؟", "عرض");
  const p = table("res.partner").get(H)!;
  assert("a purchase text lifts the hold: this text is answered", toNumber("966500000911").length >= 1 && p.x_ai_intent === "purchase");
  assert("the flag stays for Baraa's decision", p.x_review_pending === true);
  assert("screened once for that text (no second call after the reply)", calls.screen === 2, `${calls.screen}`);
}

// ================================================================ 7. the buttons
console.log("\n[7] the five buttons (the server actions' Python, run on the selected rows)");
function pyToJs(code: string): string {
  const out: string[] = []; const stack: number[] = [];
  for (const raw of code.split("\n")) {
    if (!raw.trim()) continue;
    const ind = raw.match(/^ */)![0].length;
    while (stack.length && ind <= stack[stack.length - 1]) { out.push("}"); stack.pop(); }
    const line = raw.trim().replace(/\bFalse\b/g, "false").replace(/\bTrue\b/g, "true");
    let m: RegExpExecArray | null;
    if ((m = /^for (\w+) in (\w+):$/.exec(line))) { out.push(`for (const ${m[1]} of ${m[2]}) {`); stack.push(ind); continue; }
    if ((m = /^if (.+):$/.exec(line))) { out.push(`if (${m[1]}) {`); stack.push(ind); continue; }
    if ((m = /^(\w+) = (.+)$/.exec(line))) { out.push(`var ${m[1]} = ${m[2]};`); continue; }
    out.push(`${line};`);
  }
  while (stack.length) { out.push("}"); stack.pop(); }
  return out.join("\n");
}
function runButton(key: string, recs: Array<Record<string, unknown>>) {
  const b = REVIEW_BUTTONS.find((x: any) => x.key === key)!;
  const deleted: unknown[] = [];
  const records: any = recs.map((r) => Object.assign(r, { write(v: Record<string, unknown>) { Object.assign(this, v); return true; } }));
  records.write = (v: Record<string, unknown>) => { for (const r of records) r.write(v); return true; };
  records.unlink = () => { deleted.push(...records); return true; };
  new Function("records", pyToJs(b.code))(records);
  return { recs, deleted };
}
const row0 = (extra: Record<string, unknown> = {}) => ({ id: 1, active: true, x_contact_class: "unreviewed", x_review_pending: true, customer_rank: 0, supplier_rank: 0, ...extra });
{
  const labels = REVIEW_BUTTONS.map((b: any) => b.label).join(" · ");
  assert("five buttons: عميل · مورد · فريق · شخصي · أرشفة", labels === "عميل · مورد · فريق · شخصي · أرشفة", labels);
  let r = runButton("customer", [row0(), row0({ id: 2, customer_rank: 4 })]);
  assert("«عميل»: class customer, flag cleared, customer_rank ≥ 1 (4 stays 4), supplier_rank untouched",
    r.recs.every((x: any) => x.x_contact_class === "customer" && x.x_review_pending === false && x.supplier_rank === 0)
    && r.recs[0].customer_rank === 1 && r.recs[1].customer_rank === 4, JSON.stringify(r.recs));
  r = runButton("supplier", [row0(), row0({ id: 2, supplier_rank: 5 })]);
  assert("«مورد»: class supplier, flag cleared, supplier_rank ≥ 1 (5 stays 5), customer_rank untouched",
    r.recs.every((x: any) => x.x_contact_class === "supplier" && x.x_review_pending === false && x.customer_rank === 0)
    && r.recs[0].supplier_rank === 1 && r.recs[1].supplier_rank === 5, JSON.stringify(r.recs));
  r = runButton("team", [row0({ customer_rank: 1 })]);
  assert("«فريق»: class team only (no role, ranks untouched), flag cleared",
    r.recs[0].x_contact_class === "team" && r.recs[0].x_review_pending === false && r.recs[0].customer_rank === 1 && !("x_role_ids" in r.recs[0]), JSON.stringify(r.recs));
  r = runButton("personal", [row0({ customer_rank: 1 })]);
  assert("«شخصي»: class personal, flag cleared, ranks untouched",
    r.recs[0].x_contact_class === "personal" && r.recs[0].x_review_pending === false && r.recs[0].customer_rank === 1);
  assert("«شخصي» then: held from every automated customer message", isCustomerAutomationHeld(r.recs[0] as any));
  r = runButton("archive", [row0({ customer_rank: 1 }), row0({ id: 2 })]);
  assert("«أرشفة»: active = False, flag cleared, class and ranks untouched, nothing deleted",
    r.recs.every((x: any) => x.active === false && x.x_review_pending === false && x.x_contact_class === "unreviewed") && r.recs[0].customer_rank === 1 && r.deleted.length === 0);
  assert("no button's code deletes (no unlink anywhere)", REVIEW_BUTTONS.every((b: any) => !/unlink/.test(b.code)));
}

// ================================================================ 8. archived from the review
console.log("\n[8] a number archived from the review writes again: no new partner, no welcome, no reply");
{
  ENV = fresh();
  const A = seed("res.partner", { id: 921, name: "مؤرشف", x_whatsapp_number: "+966500000921", phone: "+966500000921", customer_rank: 1, active: false, x_contact_class: "unreviewed", x_ai_intent: "spam" });
  const before = rows("res.partner").length;
  await say("966500000921", "مرحبا مرة ثانية", "مؤرشف");
  await sendRaw("966500000921", { type: "image", image: { id: "MEDIA2", mime_type: "image/jpeg" } }, "مؤرشف");
  assert("no new partner", rows("res.partner").length === before, `${rows("res.partner").length - before}`);
  assert("no welcome, no reply", toNumber("966500000921").length === 0);
  assert("the message is in his inbox (logged on the archived partner)", rows("x_wa_message").some((m: any) => m.x_partner_id === A && m.x_direction === "in"));
  assert("not screened, nothing entered review, no owner alert", calls.screen === 0 && reviewPosts().length === 0 && sentTo(OWNER).length === 0);
  // an archived partner WITHOUT a class (an old duplicate) keeps the old behaviour
  const B = seed("res.partner", { id: 922, name: "قديم مؤرشف", x_whatsapp_number: "+966500000922", customer_rank: 1, active: false });
  const n0 = rows("res.partner").length;
  await say("966500000922", "هلا", "جديد");
  assert("archived without a class: a new partner as before (and it starts «غير مراجَع»)", rows("res.partner").length === n0 + 1 && partnerByNumber("966500000922").some((p: any) => p.id !== B && p.x_contact_class === "unreviewed"),
    JSON.stringify({ added: rows("res.partner").length - n0, byNumber: partnerByNumber("966500000922") }));
}

console.log("\n[8b] the ingest failed (Odoo hiccup): the customer path still sees the archive");
{
  ENV = fresh();
  seed("res.partner", { id: 925, name: "مؤرشف ثانٍ", x_whatsapp_number: "+966500000925", phone: "+966500000925", customer_rank: 1, active: false, x_contact_class: "personal" });
  const before = rows("res.partner").length;
  // the ingest's archive lookup fails (→ «not archived»), then its partner create fails (→ ingest skipped)
  faults.push((mo, me, b) => mo === "res.partner" && me === "search_read" && JSON.stringify(b.domain ?? []).includes('["active","=",false]'));
  faults.push((mo, me) => mo === "res.partner" && me === "create");
  await say("966500000925", "مرحبا", "مؤرشف ثانٍ");
  assert("faults consumed (the ingest really failed)", faults.length === 0, `${faults.length}`);
  assert("no new partner, no welcome, no reply", rows("res.partner").length === before && toNumber("966500000925").length === 0, `${rows("res.partner").length - before} / ${toNumber("966500000925").length}`);
  faults.length = 0;
}

// ================================================================ 9. one message per partner, even when two texts race
console.log("\n[9] two texts at once: one channel message, one alert; Claude down: nothing written");
{
  ENV = fresh();
  const R = seed("res.partner", { id: 931, name: "سباق", x_whatsapp_number: "+966500000931", customer_rank: 1, x_contact_class: "unreviewed" });
  SCREEN = { intent: "wrong_number", reason: "الرقم غلط" };
  await Promise.all([say("966500000931", "غلطان", "سباق"), say("966500000931", "آسف", "سباق")]);
  assert("two racing texts: one channel message, one alert", reviewPosts().length === 1 && ownerSays(`${REVIEW_ALERT_PREFIX}سباق`).length === 1, `${reviewPosts().length}/${ownerSays(REVIEW_ALERT_PREFIX).length}`);
  // the hard race: both texts read the partner before either wrote the flag
  ENV = fresh();
  const R2 = seed("res.partner", { id: 933, name: "سباق ٢", x_whatsapp_number: "+966500000933", customer_rank: 1, x_contact_class: "unreviewed" });
  const stale = { id: R2, name: "سباق ٢", x_contact_class: "unreviewed", x_review_pending: false };
  const both = await quiet(() => Promise.all(["أ", "ب"].map((t) => screening.screenInbound(ENV, {
    partnerId: R2, partnerName: "سباق ٢", number: "+966500000933", text: t, state: { ...stale },
  }))));
  assert("same stale state twice: both see «entered», still one channel message and one alert",
    both.every((o) => o.entered) && reviewPosts().length === 1 && ownerSays(`${REVIEW_ALERT_PREFIX}سباق ٢`).length === 1, `${reviewPosts().length}/${ownerSays(REVIEW_ALERT_PREFIX).length}`);
  ENV = fresh();
  const D = seed("res.partner", { id: 932, name: "بلا ذكاء", x_whatsapp_number: "+966500000932", customer_rank: 1, x_contact_class: "unreviewed" });
  claudeDown = true;
  await say("966500000932", "مرحبا", "بلا ذكاء");
  const p = table("res.partner").get(D)!;
  assert("Claude down: no intent, no flag, not held; answered as a customer", !p.x_ai_intent && !p.x_review_pending && toNumber("966500000932").length >= 1);
  claudeDown = false; SCREEN = { intent: "spam", reason: "إعلان" };
  await say("966500000932", "اشترك الآن", "بلا ذكاء");
  assert("the next text is screened again", table("res.partner").get(D)!.x_ai_intent === "spam" && reviewPosts().length === 1);
  assert("screening prompt: a bad answer falls to «غير واضح»", await (async () => {
    SCREEN = { intent: "maybe", reason: "" };
    const r = await quiet(() => (import("../src/claude.ts")).then((c) => c.screenContact(ENV, ["x"], "y")));
    return r?.intent === "unclear" && !!r?.reason;
  })());
}

// ================================================================ 10. the backfill plan
console.log("\n[10] backfill plan: only WhatsApp-created unknown partners, only the new fields");
{
  const P = (id: number, extra: Record<string, unknown>) => ({ id, name: `p${id}`, active: true, phone: false, x_whatsapp_number: `+9665000${id}`, customer_rank: 1, supplier_rank: 0, x_role_ids: [], ...extra });
  const partners = [
    P(1, { x_whatsapp_number: "+966500000001" }),                       // Baraa's number
    P(2, { x_role_ids: [4] }),                                            // active team role
    P(3, { x_role_ids: [10] }),                                           // only the archived «Customer» role → not team
    P(4, { supplier_rank: 5 }),                                           // supplier
    P(5, {}),                                                             // order on its number
    P(6, { customer_rank: 0 }),                                           // not created by the bot
    P(7, {}),                                                             // no conversation
    P(8, { active: false }),                                              // archived
    P(9, { x_contact_class: "team" }),                                    // already classified
    P(10, {}), P(11, {}),
  ];
  // every partner has a conversation and a decision: only its own rule may keep it out
  const talk = [{ body: "x", at: "2026-09-20 10:00:00" }];
  const history = new Map<number, Array<{ body: string; at: string }>>([
    [1, talk], [2, talk], [3, [{ body: "عرض", at: "2026-09-20 10:00:00" }]], [4, talk], [5, talk], [6, talk], [8, talk],
    [9, talk], [10, [{ body: "أبغى أطلب", at: "2026-09-21 10:00:00" }]],
    [11, [{ body: "ا", at: "2026-09-24 10:00:00" }, { body: "ب", at: "2026-09-24 11:00:00" }]],
  ]);
  const any = { intent: "spam", reason: "لو صُنّف" };
  const plan = planBackfill({
    partners, activeRoleIds: new Set([1, 2, 3, 4]), orderNumbers: new Set(["96650005"]), history, ownerNumber: "+966500000001",
    decisions: { 1: any, 2: any, 4: any, 5: any, 6: any, 7: any, 8: any, 9: any,
      3: { intent: "vendor_pitch", reason: "يعرض" }, 10: { intent: "purchase", reason: "طلب" }, 11: { intent: "unclear", reason: "حرف" } },
  });
  const by = (id: number) => plan.find((r: any) => r.id === id);
  const why: Record<number, string> = { 1: "معروف: رقم براء", 2: "معروف: فريق (له دور)", 4: "معروف: مورد", 5: "معروف: له طلب على الرقم", 8: "مؤرشف", 9: "مصنّف مسبقاً (team)" };
  assert("Baraa, team, supplier, order on the number, archived, already classified: untouched, each by its own rule",
    Object.entries(why).every(([id, w]) => by(Number(id))?.skip === w && !by(Number(id))?.vals), JSON.stringify(plan.filter((r: any) => Number(r.id) in why)));
  assert("not created by the bot (customer_rank 0 / no conversation): untouched", !!by(6)?.skip && !!by(7)?.skip);
  assert("only an archived «Customer» role is not «team»: classified", by(3)?.intent === "vendor_pitch" && by(3)?.pending === true);
  assert("purchase: not flagged; unclear: flagged", by(10)?.pending === false && by(11)?.pending === true);
  assert("writes only the six new fields — never ranks, never active",
    plan.filter((r: any) => r.vals).every((r: any) => Object.keys(r.vals).sort().join() === "x_ai_intent,x_ai_reason,x_contact_class,x_review_last_at,x_review_last_msg,x_review_pending"));
  assert("last message = the latest text; first message kept for the channel", by(11)?.vals.x_review_last_msg === "ب" && by(11)?.vals.x_review_last_at === "2026-09-24 11:00:00" && by(11)?.first === "ا");
  let threw = false;
  try { planBackfill({ partners: [P(12, {})], activeRoleIds: new Set(), orderNumbers: new Set(), history: new Map([[12, [{ body: "x", at: "1" }]]]), ownerNumber: "", decisions: {} }); } catch { threw = true; }
  assert("a classifiable partner without an explicit decision stops the plan", threw);
}

// ================================================================ 11. Baraa's window: earliest shift − 15 min
console.log("\n[11] Baraa's morning template: earliest shift − 15 min, else OWNER_WINDOW_OPEN_AT (06:00)");
{
  const m = (id: number, shiftStart: number | false, whatsapp = `+96650000${id}`) => ({ id, name: `m${id}`, whatsapp, codes: ["driver"] as any, shiftStart });
  const env0: any = { OWNER_WHATSAPP: "+" + OWNER, OWNER_WINDOW_OPEN_AT: "06:00" };
  const hh = (p: { minutes: number }) => att.hhmm(p.minutes);
  assert("05:00 and 07:30 → 04:45", hh(att.ownerWindowPlan(env0, [m(1, 5), m(2, 7.5)])) === "04:45");
  assert("only 07:30 → 07:15", hh(att.ownerWindowPlan(env0, [m(2, 7.5)])) === "07:15");
  assert("no time (00:00 / empty) → 06:00 (fallback)", hh(att.ownerWindowPlan(env0, [m(1, 0), m(2, false)])) === "06:00" && att.ownerWindowPlan(env0, []).source === "fallback");
  assert("no time, OWNER_WINDOW_OPEN_AT unset → 06:00", hh(att.ownerWindowPlan({ OWNER_WHATSAPP: "+" + OWNER } as any, [])) === "06:00");
  assert("Baraa's own time never counts (03:00 on his number)", hh(att.ownerWindowPlan(env0, [m(9, 3, "+" + OWNER), m(1, 5)])) === "04:45");
  assert("00:10 → 00:00 (not the day before)", hh(att.ownerWindowPlan(env0, [m(1, 10 / 60)])) === "00:00");
  // through the real tick, with the roster in Odoo
  const run = async (shifts: Record<number, number>, ticks: string[]) => {
    ENV = fresh("2026-09-26 00:00"); ENV.OWNER_WINDOW_OPEN_AT = "06:00";
    for (const [id, s] of Object.entries(shifts)) seed("res.partner", { id: Number(id), name: `موظف ${id}`, x_whatsapp_number: `+9665000${id}`, x_role_ids: [72], x_shift_start: s });
    seed("res.partner", { id: 950, name: "بلا دور", x_whatsapp_number: "+966500000950", x_role_ids: [], x_shift_start: 3 });
    const out: string[] = [];
    for (const t of ticks) {
      setRiyadh(`2026-09-26 ${t}`);
      const before = sentTo(OWNER).filter((b) => b?.template?.name === "utak_shift_start_v2").length;
      const r = await quiet(() => att.runAttendanceTick(ENV));
      if (sentTo(OWNER).filter((b) => b?.template?.name === "utak_shift_start_v2").length > before) out.push(`${t}@${r.owner.at}/${r.owner.source}`);
    }
    return out;
  };
  const withTime = await run({ 961: 5, 962: 7.5 }, ["04:40", "04:45", "05:00", "06:00"]);
  assert("tick: عمر 05:00 → Baraa's template at 04:45, once", withTime.join() === "04:45@04:45/earliest_shift", withTime.join());
  const noTime = await run({ 961: 0 }, ["04:45", "05:55", "06:00", "06:05"]);
  assert("tick: nobody with a time → 06:00, once (a no-role partner's 03:00 does not count)", noTime.join() === "06:00@06:00/fallback", noTime.join());
  assert("no field rejected by the schema gate", rejected.length === 0, rejected.join(" | "));
}

console.log(`\nreview: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:\n  " + failures.join("\n  ")); process.exit(1); }
