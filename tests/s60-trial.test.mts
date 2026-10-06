// § 60 هـ (2026-10-06) — the ONE trial of § 60 to Baraa's own number: the 21:30 summary as it reaches him
// from now on (src/s60-trial.ts).
//
//   [1] the text: it says what it is and that EVERY number is illustrative; between its first line and
//       its last, the summary's own lines — its five, the four of «خلاصة اليوم», «طلبوا اليوم وما كان
//       متوفر» — each made by the summary's own functions
//   [2] his number alone, inside his window (nothing held), once a day; nothing read from the day's
//       data and nothing written
//   [3] its hook is behind the Odoo hook token
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s60-trial.test.mts

import { readFileSync } from "node:fs";
import { CUST2, OWNER, closeOwnerWindow, heldFor, odooLog, openWindow, quiet, sentTo, setRiyadh } from "./wa-harness.mts";
import { C1_PHONE, DAY, assert, done, fresh } from "./s46-kit.mts";

const TR = await import("../src/s60-trial.ts");
const worker = (await import("../src/index.ts")).default;
const textOf = (b: any) => String(b?.text?.body ?? "");
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ================================================================ the trial
console.log("\nthe one trial of § 60: Baraa's number alone, inside his window, once a day, illustrative numbers that say so");
{
  const body = TR.summaryTrialText("2026-10-06").split("\n");
  assert("it opens by saying what it is and that EVERY number is illustrative, and closes by saying nothing was written", body[0] === TR.S60_TRIAL_HEAD && body[0].startsWith("🧪 تجربة — ") && body[0].includes("الأرقام كلها توضيحية وليست أرقام اليوم") && body[body.length - 1] === TR.S60_TRIAL_TAIL && TR.S60_TRIAL_TAIL.includes("توضيحية") && TR.S60_TRIAL_TAIL.includes("لم يُكتب شيء في Odoo"));
  assert("between them the summary as it reaches him now: its five lines, the four of «خلاصة اليوم», «طلبوا اليوم وما كان متوفر»", JSON.stringify(body.slice(2, 12)) === JSON.stringify([
    "📊 ملخص اليوم 6 أكتوبر 2026",
    "طلبات الغد: 3 مؤكدة لـ 7 أكتوبر 2026 بإجمالي 1840.00 ريال",
    "توصيلات اليوم: 5 مسلَّمة من 5",
    "تحصيل اليوم: المحصَّل اليوم 2150.00 والمعلَّق 980.00 ريال",
    "تغطية تكاليف اليوم: 64% (ربح 225.00 من 350.00)",
    "✅ نُشر اليوم 4 من 4 أصناف — متوسط ربح الكرتون +4.12",
    "🎯 اليوم: بعنا 96 من 140 (69%) — ربح −125 ❌، أكبر سبب: الكمية −110",
    "💧 من كل كرتون بـ 35.75: لنا +4.12، وأكبر بند الشراء 23.25",
    "➡️ أهم فرصتين: موز أمريكي (السوق فوق المقترح +11.50) · رمان كبير (شراء أرخص +2.00 عند مورد آخر)",
    "طلبوا اليوم وما كان متوفر: طماطم ×3 (عميلان)، خيار ×1",
  ]), body.slice(2, 12).join(" | "));
  const a = TR.trialActual();
  assert("its 🎯 line is the order's own example: a gap of 125 made of the volume −110 and the waste −15", a.gap === -125 && a.volume === -110 && a.wasteVar === -15 && a.marginVar === 0 && a.costVar === 0 && a.cartons === 96 && a.target === 140);
}
{
  const env = fresh(`${DAY} 12:00`);
  odooLog.length = 0;
  const closed = (closeOwnerWindow(env), await quiet(() => TR.sendSummaryTrial(env)));
  assert("his window closed: nothing goes, nothing is held, and the day's trial is not spent", closed.sent === false && closed.reason === "window_closed" && sentTo(OWNER).length === 0 && heldFor(env, OWNER).length === 0);
  openWindow(env, OWNER);
  const r = await quiet(() => TR.sendSummaryTrial(env));
  const m = sentTo(OWNER);
  assert("his window open: ONE text to his number, the trial's own", r.sent === true && m.length === 1 && m[0].type === "text" && textOf(m[0]) === TR.summaryTrialText(DAY), JSON.stringify(r));
  assert("…under the purpose § 58 kept for it (his number alone), and no other number is reached", TR.SUMMARY_TEST_PURPOSE === "target_lines_test" && sentTo(C1_PHONE).length === 0 && sentTo(CUST2 as any).length === 0);
  // a number that is not the owner's is refused that purpose by the gateway itself
  const GW = await import("../src/wa-gateway.ts"), { textContent } = await import("../src/meta.ts");
  openWindow(env, C1_PHONE);
  const refused = GW.gatewayDecision(await quiet(() => GW.sendViaGateway(env, { purpose: TR.SUMMARY_TEST_PURPOSE, to: "+" + C1_PHONE, content: textContent("x"), noHold: true })));
  assert("…the gateway refuses the trial's purpose to any number but his", refused?.action !== "session" && refused?.action !== "template" && sentTo(C1_PHONE).length === 0, JSON.stringify(refused));
  assert("nothing is read from the day's data and nothing is written to it (no price day, no order, no ask, no actual)", odooLog.every((x) => !["x_price_day", "x_price_day_line", "x_daily_order", "x_daily_order_line", "x_unavailable_request", "x_invoice", "x_payment"].includes(x.model)), [...new Set(odooLog.map((x) => `${x.model}.${x.method}`))].join(" "));
  const again = await quiet(() => TR.sendSummaryTrial(env));
  assert("once a day", again.sent === false && again.reason === "already_today" && sentTo(OWNER).length === 1);
  setRiyadh("2026-10-04 12:00"); openWindow(env, OWNER);
  assert("the day after: once more", (await quiet(() => TR.sendSummaryTrial(env))).sent === true && sentTo(OWNER).length === 2);
  const noOwner = fresh(`${DAY} 12:00`); noOwner.OWNER_WHATSAPP = "";
  assert("no owner's number: nothing", (await quiet(() => TR.sendSummaryTrial(noOwner))).reason === "no_owner");
}
{
  const env = fresh(`${DAY} 12:00`); env.ODOO_HOOK_TOKEN = "tok"; openWindow(env, OWNER);
  const hook = (token: string) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/s60-trial?token=${token}`, { method: "POST" }), env, { waitUntil() {}, passThroughOnException() {} } as any));
  const bad = await hook("nope");
  assert("the trial's hook is behind the Odoo hook token", bad.status === 401 && sentTo(OWNER).length === 0);
  const ok = await hook("tok");
  assert("…with it the trial goes, once", ok.status === 200 && (await ok.json() as any).sent === true && sentTo(OWNER).length === 1 && /url\.pathname === "\/odoo\/hook\/s60-trial"/.test(read("src/index.ts")));
  assert("the purpose is one of the owner's alone in the gateway", read("src/wa-gateway.ts").includes(`"target_lines_test"`) && read("src/wa-purposes.ts").includes("target_lines_test:"));
}

done();
