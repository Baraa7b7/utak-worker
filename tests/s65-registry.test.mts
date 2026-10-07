// § 65 أ و ب (2026-10-07) — the suppliers' registry: the registration from WhatsApp, the card, Odoo's buttons.
//
//   [أ1]  Odoo's data against the worker's constants: the types, the states, the cadence of a type, the
//         code of the buttons (python that compiles), the line's automation (§ 65 ز)
//   [ب1]  utak_supplier_signup_v1: the JSON at Meta against what the worker sends and reads
//   [ب2]  the keyword, and who may register
//   [ب3]  the form's fields: what is read, what refuses it
//   [ب4]  «إرسال»: a new card «بانتظار الاعتماد», the items matched to the catalog, the countries, the seasons
//   [ب5]  the card of his number is updated — a number not reviewed yet, a supplier with a state
//   [ب6]  the token: his number alone, once; a form without a name or a type opens again
//   [ب7]  «📨 أرسل رابط التسجيل»: the form, the template, the text for Baraa
//   [ب8]  «✅ اعتماد»: the welcome with his type's buttons, held outside his window, once
//   [ب9]  a supplier's number is closed to sale prices and never a customer
//   [ب10] the webhook: «تسجيل مورد» is answered before any other routing; the hook's route; the trial
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s65-registry.test.mts

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CUST, CUST_PHONE, OWNER, WH_PHONE, closeOwnerWindow, computes, ctx, heldFor, inbound, openWindow, quiet, rows, seed, sentTo, signed, table } from "./wa-harness.mts";
import { AHMED, AHMED_PHONE, DAY, assert, done, fresh, ownerTexts, rejected } from "./s46-kit.mts";

const REG = await import("../src/supplier-registry.ts");
const CAT = await import("../src/supplier-catalog.ts");
const PRIV = await import("../src/price-privacy.ts");
const { PURPOSES } = await import("../src/wa-purposes.ts");
const { sendViaGateway, gatewayDecision } = await import("../src/wa-gateway.ts");
const { textContent } = await import("../src/meta.ts");
const LIB = await import("../scripts/lib/s65-flows.mjs");
const ODOO = await import("../scripts/lib/s65-odoo.mjs");
const worker = (await import("../src/index.ts")).default;
const srcOf = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

const NEW = "966511110001", NEW2 = "966511110002";
const par = (b: any) => b?.interactive?.action?.parameters ?? {};
const dataOf = (b: any) => par(b).flow_action_payload?.data ?? {};
const bodyOf = (b: any) => String(b?.interactive?.body?.text ?? b?.text?.body ?? "");
const flowsTo = (d: string) => sentTo(d).filter((b: any) => b?.interactive?.type === "flow");
const partners = () => rows("res.partner") as any[];
const partner = (id: number) => table("res.partner").get(id) as any;
const byNumber = (d: string) => partners().filter((p) => p.x_whatsapp_number === "+" + d);
let wamid = 0;
const say = (env: any, from: string, m: Record<string, unknown>) => quiet(() => worker.fetch(signed(inbound(from, m)), env, ctx));
const reply = (env: any, from: string, token: string, values: Record<string, unknown>) => {
  openWindow(env, from, 0);
  return quiet(() => REG.handleSignupReply(env, { from: "+" + from, messageId: `wamid.S${++wamid}`, flow: { token, values } }));
};
/** A valid farmer's form. */
const FARMER = {
  trade: "مزرعة الخير", contact: "سعد", stype: "farmer", location: "القصيم — بريدة", cats: ["veg", "fruit"], items: "طماطم، خيار، فلفل رومي نادر", origin: "السعودية",
  method: "delivers", pay: "credit", pay_days: "١٥", f_c1: "طماطم", f_a1: "11", f_b1: "03", f_c2: "خيار", f_a2: "05", f_b2: "", f_c3: "", f_qty: "200 كرتون في الأسبوع",
};
/** The tenant's shape, the catalog's two products by their codes, Saudi Arabia, and the m2m commands applied as Odoo applies them. */
function world(riyadh = `${DAY} 10:00`): any {
  const env = fresh(riyadh);
  Object.assign(table("product.template").get(2)!, { default_code: CAT.matchCatalog("خيار")!.code });
  Object.assign(table("product.template").get(3)!, { default_code: CAT.matchCatalog("بطاطس")!.code });
  Object.assign(table("product.template").get(1)!, { default_code: CAT.matchCatalog("طماطم")!.code });
  seed("res.country", { id: 192, code: "SA", name: "Saudi Arabia" });
  seed("res.country", { id: 65, code: "EG", name: "Egypt" });
  shadow.clear();
  computes["res.partner"] = (r: any) => {
    for (const f of M2M) {
      const v = r[f];
      if (Array.isArray(v) && v.some(Array.isArray)) {
        const kept: number[] = [...(shadow.get(`${r.id}:${f}`) ?? [])];
        for (const c of v as any[]) { if (c[0] === 4 && !kept.includes(c[1])) kept.push(c[1]); if (c[0] === 6) { kept.length = 0; kept.push(...c[2]); } }
        r[f] = kept;
      }
    }
    snap();
  };
  snap();
  return env;
}
/** What each card's many2many carries now: Odoo applies a command ([4, id] adds, [6, 0, ids] replaces) to it. */
const M2M = ["x_supplied_product_ids", "x_origin_country_ids"];
const shadow = new Map<string, number[]>();
function snap(): void {
  for (const r of rows("res.partner") as any[]) for (const f of M2M) if (Array.isArray(r[f]) && !r[f].some(Array.isArray)) shadow.set(`${r.id}:${f}`, [...r[f]]);
}
const approveTemplates = () => {
  seed("x_whatsapp_template", { id: 9651, x_purpose: "supplier_invite", x_meta_template_id: "utak_supplier_invite_v1", x_language: "ar", x_meta_status: "APPROVED", x_param_count: 0, x_category: "UTILITY" });
};

console.log("\n[أ1] Odoo's data against the worker's");
{
  assert("«نوع المورد»: the six keys of before in Arabic, and «مورد مصاريف» (expense)", JSON.stringify(ODOO.SUPPLIER_TYPES.map((t: string[]) => t[0])) === JSON.stringify(["wholesaler", "farmer", "importer", "distributor", "market_agent", "expense", "other"]) && ODOO.SUPPLIER_TYPES.every(([k, v]: string[]) => REG.TYPE_LABEL[k] === v));
  assert("«حالة المورد»: بانتظار الاعتماد / معتمد / موقوف — the worker's three states", JSON.stringify(ODOO.STATES) === JSON.stringify(Object.entries(REG.STATE_LABEL)) && REG.asState("approved") === "approved" && REG.asState("x") === null);
  assert("the cadence of a type is the same in Odoo's «✅ اعتماد» and in the worker: agent and wholesaler daily, distributor and importer weekly, farmer monthly, expense none", JSON.stringify(ODOO.CADENCE_BY_TYPE) === JSON.stringify(REG.CADENCE_BY_TYPE) && REG.CADENCE_BY_TYPE.market_agent === "daily" && REG.CADENCE_BY_TYPE.wholesaler === "daily" && REG.CADENCE_BY_TYPE.distributor === "weekly" && REG.CADENCE_BY_TYPE.importer === "weekly" && REG.CADENCE_BY_TYPE.farmer === "monthly" && REG.CADENCE_BY_TYPE.expense === undefined);
  assert("the supply methods, the pay terms and the cadences Odoo lists are the ones the worker writes", ODOO.SUPPLY_METHODS.every(([k, v]: string[]) => REG.METHOD_LABEL[k] === v) && ODOO.PAY_TERMS.every(([k, v]: string[]) => REG.PAY_LABEL[k] === v) && ODOO.CADENCES.every(([k]: string[]) => REG.asCadence(k) === k));
  assert("the buttons' hook and its two ops are the worker's", ODOO.HOOK_PATH === "/odoo/hook/supplier" && JSON.stringify(Object.values(ODOO.HOOKS).map((h: any) => h.op)) === JSON.stringify([...REG.SUPPLIER_HOOK_OPS]) && srcOf("index.ts").includes(`url.pathname === "${ODOO.HOOK_PATH}"`));
  const approve = ODOO.CODE_ACTIONS.approve.code as string;
  assert("«✅ اعتماد» writes «معتمد», the cadence of the type only when the card carries none, then presses the welcome's webhook — and never touches supplier_rank", approve.includes("'x_supplier_state': 'approved'") && approve.includes("if not rec.x_contact_cadence and CADENCE.get(rec.x_supplier_type)") && approve.includes(ODOO.HOOKS.welcome.name) && !approve.includes("supplier_rank"));
  assert("«⛔ إيقاف» writes «موقوف» and calls nothing", ODOO.CODE_ACTIONS.suspend.code === "for rec in records:\n    rec.write({'x_supplier_state': 'suspended'})");
  // the code of every action is python that compiles
  const codes = [approve, ODOO.CODE_ACTIONS.suspend.code, ODOO.LINE_ACTION.code, ...ODOO.SEASON_FIELDS.filter((f: any) => f.compute).map((f: any) => f.compute)];
  let how = "";
  try { execFileSync("python3", ["-c", "import sys,json\nfor c in json.load(sys.stdin): compile(c, '<odoo>', 'exec')"], { input: JSON.stringify(codes) }); } catch (e) { how = String((e as any)?.stderr ?? e).slice(-300); }
  assert(`the ${codes.length} python snippets Odoo runs compile (the two buttons, the line's action, the twelve months)`, how === "", how);
  // a season's month, as Odoo computes it: the snippet itself under python3
  const season = (from: string, to: string) => JSON.parse(execFileSync("python3", ["-c", `import sys,json
codes=json.load(sys.stdin)
class R(dict):
    __getattr__=dict.get
r=R(x_month_from=${JSON.stringify(from)}, x_month_to=${JSON.stringify(to)})
for c in codes: exec(c, {'self':[r]})
print(json.dumps([r['x_m%02d'%m] for m in range(1,13)]))`], { input: JSON.stringify(ODOO.SEASON_FIELDS.filter((f: any) => f.compute).map((f: any) => f.compute)) }).toString());
  assert("a season November → March covers 11, 12, 1, 2, 3 (it wraps the year); May alone covers May; none covers nothing", JSON.stringify(season("11", "03")) === JSON.stringify([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1]) && JSON.stringify(season("05", "")) === JSON.stringify([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]) && season("", "").every((x: number) => x === 0), JSON.stringify(season("11", "03")));
  assert("§ 65 ز — the line's automation: a write of the purchase price, a final price or the quantity presses the request's own «🔄 احسب», for the line's request", ODOO.LINE_AUTOMATION.trigger === "on_write" && ODOO.LINE_AUTOMATION.model === "x_special_quote_line" && JSON.stringify(ODOO.LINE_AUTOMATION.fields) === JSON.stringify(["x_purchase_price", "x_final_price", "x_final_net", "x_qty"]) && ODOO.LINE_ACTION.code.includes("records.mapped('x_quote_id')") && ODOO.LINE_ACTION.code.includes("utak.special_quote.recalc_webhook") && ODOO.LINE_ACTION.code.includes("active_model='x_special_quote'"));
  assert("«تفعيل تواصل الموردين» is a boolean of the settings (off unless Baraa turns it on)", ODOO.CONFIG_FIELDS[0].name === "x_supplier_outreach" && ODOO.CONFIG_FIELDS[0].ttype === "boolean");
  assert("the unlinked item's code is the one the worker looks for", ODOO.UNLINKED.code === CAT.UNLINKED_CODE);
  assert("the four screens under «🛒 المشتريات»: الموردون، عروض الموردين، تقويم المواسم، خريطة الطاقة", JSON.stringify(Object.values(ODOO.MENUS).map((m: any) => m.title)) === JSON.stringify(["🧑‍🌾 الموردون", "📥 عروض الموردين", "📅 تقويم المواسم", "📦 خريطة الطاقة"]) && ODOO.ACTIONS.offers.domain === "[('x_offer_kind', '=', 'supplier_offer')]" && ODOO.ACTIONS.seasons.view_mode.startsWith("pivot") && ODOO.ACTIONS.capacity.context.includes("search_default_g_product") && ODOO.ACTIONS.suppliers.context.includes("search_default_g_type"));
}

console.log("\n[ب1] utak_supplier_signup_v1 at Meta against the worker");
{
  const flow = LIB.buildSignupFlowJson();
  const [general, type] = flow.screens;
  assert("two screens: SIGNUP (general) then TYPE (terminal), and the id the worker sends is Meta's", flow.screens.length === 2 && general.id === REG.SIGNUP_FLOW_SCREEN && type.id === "TYPE" && type.terminal === true && /^\d{15,17}$/.test(REG.SIGNUP_FLOW_ID) && srcOf("supplier-registry.ts").includes(`export const SIGNUP_FLOW_ID = "${REG.SIGNUP_FLOW_ID}"`));
  assert("the data the worker sends is the first screen's data model, key for key", JSON.stringify(Object.keys(REG.signupData()).sort()) === JSON.stringify(Object.keys(general.data).sort()));
  const names = general.layout.children.filter((c: any) => c.name).map((c: any) => c.name);
  assert("the general screen asks: the trade name, the contact, the type, the location, the categories, the items, the origin, the supply method, the pay terms (and the days)", JSON.stringify(names) === JSON.stringify(LIB.SIGNUP_GENERAL));
  assert("«التالي» passes the ten general answers to TYPE, and «إرسال» returns them with the type's own", JSON.stringify(Object.keys(general.layout.children.at(-1)["on-click-action"].payload)) === JSON.stringify(LIB.SIGNUP_GENERAL) && JSON.stringify(Object.keys(type.layout.children.at(-1)["on-click-action"].payload)) === JSON.stringify([...LIB.SIGNUP_GENERAL, ...LIB.TYPE_FIELDS]) && LIB.SIGNUP_GENERAL.every((k: string) => k in type.data));
  const blocks = type.layout.children.filter((c: any) => c.type === "If");
  assert("TYPE shows one block by the chosen type — farmer, importer, agent, wholesaler, distributor, other — each an `If` on data.stype with no «||»", blocks.length === 6 && blocks.every((b: any) => /^\$\{data\.stype\} == '[a-z_]+'$/.test(b.condition)) && JSON.stringify(blocks.map((b: any) => /'([a-z_]+)'/.exec(b.condition)![1])) === JSON.stringify(["farmer", "importer", "market_agent", "wholesaler", "distributor", "other"]));
  assert("the types he chooses from are the worker's six (never «مورد مصاريف»)", JSON.stringify(LIB.SIGNUP_TYPES.map((t: any) => t.id)) === JSON.stringify([...REG.SIGNUP_TYPES]) && LIB.SIGNUP_TYPES.every((t: any) => REG.TYPE_LABEL[t.id] === t.title) && !LIB.SIGNUP_TYPES.some((t: any) => t.id === "expense"));
  assert("the farmer's block: three crops with their months (a list of the twelve), and the expected quantity", LIB.FARMER_CROPS === REG.FARMER_CROPS && blocks[0].then.filter((c: any) => c.type === "Dropdown").length === 6 && blocks[0].then.filter((c: any) => c.type === "Dropdown").every((c: any) => c["data-source"].length === 12 && c["data-source"][10].title === REG.MONTH_NAMES[10]) && blocks[0].then.at(-1).name === "f_qty");
  assert("Meta's limits: fifty components a screen, twenty characters a label, eighty a hint", flow.screens.every((s: any) => LIB.screenComponents(s).length <= LIB.SCREEN_COMPONENTS_MAX) && flow.screens.flatMap((s: any) => LIB.screenComponents(s)).filter((c: any) => c.label).every((c: any) => [...c.label].length <= 20 && [...(c["helper-text"] ?? "")].length <= 80) && [...REG.SIGNUP_CTA].length <= 20);
  assert("the invitation template: UTILITY's text with no variable and ONE «تسجيل مورد» button — the keyword itself", LIB.SUPPLIER_INVITE.name === "utak_supplier_invite_v1" && LIB.SUPPLIER_INVITE.purpose === REG.SUPPLIER_INVITE_PURPOSE && LIB.SUPPLIER_INVITE.params === 0 && LIB.SUPPLIER_INVITE.buttons.length === 1 && REG.isSignupKeyword(LIB.SUPPLIER_INVITE.buttons[0].text));
}

console.log("\n[ب2] the keyword, and who may register");
{
  assert("«تسجيل مورد», «سجلني كمورد», «أبي أكون مورد» (hamzas or not, a mark after it): the keyword", ["تسجيل مورد", "سجلني كمورد", "أبي أكون مورد", "ابي اكون مورد", "تسجيل مورد.", "  تسجيل  مورد "].every((t) => REG.isSignupKeyword(t)));
  assert("a sentence that only mentions a supplier is not the keyword", ["وين المورد", "تسجيل", "ابي طماطم من المورد", "تسجيل مورد جديد عندي سؤال", ""].every((t) => !REG.isSignupKeyword(t)));
  const env = world();
  openWindow(env, NEW, 0);
  const a = await quiet(() => REG.answerSignupKeyword(env, { from: "+" + NEW, text: "تسجيل مورد" }, { team: false }));
  assert("a number we do not know: the form, inside his window, as an interactive message", a === true && flowsTo(NEW).length === 1 && par(flowsTo(NEW)[0]).flow_id === REG.SIGNUP_FLOW_ID && par(flowsTo(NEW)[0]).flow_cta === REG.SIGNUP_CTA && par(flowsTo(NEW)[0]).flow_action_payload.screen === "SIGNUP" && par(flowsTo(NEW)[0]).flow_token.startsWith("sg1."));
  openWindow(env, CUST_PHONE, 0);
  table("res.partner").get(CUST)!.x_contact_class = "customer";
  const c = await quiet(() => REG.answerSignupKeyword(env, { from: "+" + CUST_PHONE, text: "تسجيل مورد" }, { team: false }));
  assert("a registered customer: not answered here (his message is routed as any customer's)", c === false && flowsTo(CUST_PHONE).length === 0);
  openWindow(env, WH_PHONE, 0);
  const t = await quiet(() => REG.answerSignupKeyword(env, { from: "+" + WH_PHONE, text: "تسجيل مورد" }, { team: true }));
  assert("a team member: not answered here", t === false && flowsTo(WH_PHONE).length === 0);
  const o = await quiet(() => REG.answerSignupKeyword(env, { from: "+" + OWNER, text: "تسجيل مورد" }, { team: false }));
  assert("Baraa's own number: not answered here", o === false && flowsTo(OWNER).length === 0);
  seed("res.partner", { id: 7001, name: "موقوف", x_whatsapp_number: "+" + NEW2, x_supplier_state: "suspended" });
  openWindow(env, NEW2, 0);
  const s = await quiet(() => REG.answerSignupKeyword(env, { from: "+" + NEW2, text: "تسجيل مورد" }, { team: false }));
  assert("a supplier «موقوف»: no form", s === false && flowsTo(NEW2).length === 0);
  const env2 = world();
  const closed = await quiet(() => REG.answerSignupKeyword(env2, { from: "+" + NEW, text: "تسجيل مورد" }, { team: false }));
  assert("outside the number's window nothing is sent and nothing is held", closed === false && sentTo(NEW).length === 0 && heldFor(env2, NEW).length === 0);
}

console.log("\n[ب3] the form's fields");
{
  const p = REG.parseSignupValues(FARMER);
  assert("a farmer's form: the name, the type, the location, the two categories, the supply method, «آجل» 15 days (Arabic digits)", p.problems.length === 0 && p.trade === "مزرعة الخير" && p.type === "farmer" && p.location === "القصيم — بريدة" && JSON.stringify(p.categories) === JSON.stringify(["veg", "fruit"]) && p.method === "delivers" && p.pay === "credit" && p.payDays === 15);
  assert("…his crops with their months: طماطم 11 → 03, خيار 05 → 05 (an empty «إلى» is that month alone)", JSON.stringify(p.crops) === JSON.stringify([{ name: "طماطم", from: "11", to: "03" }, { name: "خيار", from: "05", to: "05" }]) && p.cropQty === "200 كرتون في الأسبوع");
  assert("…every item he typed, each once: the general field's three (the crops are among them)", JSON.stringify(p.itemNames) === JSON.stringify(["طماطم", "خيار", "فلفل رومي نادر"]));
  assert("…and «تفاصيل التسجيل» says his crops and his quantity", p.detail.join("\n") === "المحصول: طماطم — من نوفمبر إلى مارس\nالمحصول: خيار — من مايو إلى مايو\nالكمية المتوقعة: 200 كرتون في الأسبوع");
  const imp = REG.parseSignupValues({ trade: "شركة الاستيراد", stype: "importer", items: "موز", origin: "", i_countries: "مصر، الإكوادور", i_ship: "شحنة كل أسبوعين", i_min: "50 كرتون", f_c1: "ليس له" });
  assert("an importer: his countries, his shipping dates, his minimum — and never a farmer's field", imp.originText === "مصر، الإكوادور" && imp.minQty === "50 كرتون" && imp.crops.length === 0 && imp.detail.join(" | ") === "بلدان الاستيراد: مصر، الإكوادور | مواعيد الشحن: شحنة كل أسبوعين | أقل كمية: 50 كرتون");
  const ag = REG.parseSignupValues({ trade: "محل السوق", stype: "market_agent", items: "", a_shop: "محل 14", a_daily: "طماطم، بصل", w_shop: "ليس له" });
  const wh = REG.parseSignupValues({ trade: "جملة", stype: "wholesaler", items: "خيار", w_shop: "مستودع 3", w_daily: "بطاطس" });
  assert("an agent and a wholesaler: the shop and the daily items, each from his own block", ag.shop === "محل 14" && JSON.stringify(ag.itemNames) === JSON.stringify(["طماطم", "بصل"]) && wh.shop === "مستودع 3" && JSON.stringify(wh.itemNames) === JSON.stringify(["خيار", "بطاطس"]));
  const di = REG.parseSignupValues({ trade: "موزع الفطر", stype: "distributor", items: "", d_items: "فطر", d_min: "10 كراتين", d_lead: "يوم واحد" });
  assert("a distributor: his items, his minimum, his lead time", di.minQty === "10 كراتين" && di.leadTime === "يوم واحد" && JSON.stringify(di.itemNames) === JSON.stringify(["فطر"]));
  assert("no trade name, or a type that is not of the list: refused", JSON.stringify(REG.parseSignupValues({ ...FARMER, trade: " " }).problems) === JSON.stringify(["trade"]) && JSON.stringify(REG.parseSignupValues({ ...FARMER, stype: "expense" }).problems) === JSON.stringify(["type"]) && JSON.stringify(REG.parseSignupValues({ ...FARMER, trade: "…", stype: "" }).problems) === JSON.stringify(["trade", "type"]));
  assert("a choice that is not of its list is not kept (the method, the pay terms, a category, a month)", (() => { const x = REG.parseSignupValues({ ...FARMER, method: "drone", pay: "later", cats: ["veg", "cars"], f_a1: "13" }); return x.method === "" && x.pay === "" && JSON.stringify(x.categories) === JSON.stringify(["veg"]) && x.crops[0].from === ""; })());
  assert("the countries a text names, each once, by whole names: «مصر، الإكوادور و جنوب أفريقيا» → EG, EC, ZA; «مصري» names none", JSON.stringify(REG.countryCodes("مصر، الإكوادور و جنوب أفريقيا، مصر")) === JSON.stringify(["EG", "EC", "ZA"]) && REG.countryCodes("مصري").length === 0);
  assert("an item's name is compared as § 63 compares it: «الطماطم» = «طماطم», «خيارة» ≠ «خيار» is left to the catalog", CAT.normName("الطماطم") === CAT.normName("طماطم") && CAT.matchCatalog("الطماطم")?.name === CAT.matchCatalog("طماطم")?.name && CAT.matchCatalog("شيء لا يوجد") === null);
  assert("«طماطم، خيار ؛ موز\\nبصل و ثوم» → five names, each once", JSON.stringify(CAT.splitItems("طماطم، خيار ؛ موز\nبصل و ثوم، طماطم")) === JSON.stringify(["طماطم", "خيار", "موز", "بصل", "ثوم"]));
}

console.log("\n[ب4] «إرسال»: a new card «بانتظار الاعتماد»");
{
  const env = world();
  openWindow(env, NEW, 0);
  const sent = await quiet(() => REG.sendSignupForm(env, { partnerId: 0, whatsapp: "+" + NEW }));
  const before = partners().length;
  const r = await reply(env, NEW, sent.token!, FARMER);
  const card = byNumber(NEW)[0];
  assert("ONE new card, «بانتظار الاعتماد», a farmer, with his number — and supplier_rank untouched (the 02:00 ask is not his)", r.action === "saved" && partners().length === before + 1 && card?.name === "مزرعة الخير" && card.x_supplier_state === "pending" && card.x_supplier_type === "farmer" && !card.supplier_rank && card.customer_rank === 0 && card.x_contact_class === "supplier" && card.x_review_pending === false, JSON.stringify(card));
  assert("…his contact, his location, how he supplies, how he is paid (آجل 15 يوماً)", card.x_contact_name === "سعد" && card.x_supplier_location === "القصيم — بريدة" && card.x_supply_method === "delivers" && card.x_pay_terms === "credit" && card.x_pay_days === 15);
  assert("…the items the catalog names are his «الأصناف التي يوفرها» (طماطم، خيار); the one it does not name stays a text", JSON.stringify(card.x_supplied_product_ids) === JSON.stringify([1, 2]) && card.x_supplier_items_text === "فلفل رومي نادر", JSON.stringify([card.x_supplied_product_ids, card.x_supplier_items_text]));
  assert("…«المنشأ»: Saudi Arabia from Odoo's countries, and the text as he wrote it", JSON.stringify(card.x_origin_country_ids) === JSON.stringify([192]) && card.x_origin_text === "السعودية");
  const seasons = (rows("x_supplier_season") as any[]).filter((s) => s.x_partner_id === card.id);
  assert("…his two crops are two «مواسم المورد» rows with their product, their months and the expected quantity", seasons.length === 2 && seasons[0].x_product_tmpl_id === 1 && seasons[0].x_month_from === "11" && seasons[0].x_month_to === "03" && seasons[1].x_product_tmpl_id === 2 && seasons[1].x_month_from === "05" && seasons[1].x_month_to === "05" && seasons.every((s) => s.x_expected_qty === "200 كرتون في الأسبوع" && !s.x_utak_simulation), JSON.stringify(seasons));
  assert("he is told «استلمنا طلبك» — one text, nothing else", bodyOf(sentTo(NEW).at(-1)) === REG.SIGNUP_DONE_TEXT && sentTo(NEW).length === 2);
  const o = ownerTexts().filter((t) => t.includes("🧑‍🌾"));
  assert("Baraa gets ONE message: who, his type, what matched and what did not, where to approve him", o.length === 1 && o[0].startsWith(`🧑‍🌾 مورد جديد بانتظار الاعتماد: مزرعة الخير (+${NEW})`) && o[0].includes("النوع: مزارع") && o[0].includes("الأصناف (2 من الكتالوج): طماطم، خيار") && o[0].includes("غير مطابق (بقي نصاً): فلفل رومي نادر") && o[0].includes("الدفع: آجل 15 يوم") && o[0].includes("«🛒 المشتريات ← 🧑‍🌾 الموردون»"), o.join("\n---\n"));
  assert("no price anywhere: not in his answer, not in Baraa's message", !/\d+(\.\d+)? ?ريال/.test([...sentTo(NEW).map(bodyOf), ...o].join(" ")));
  assert("no Odoo field outside the tenant's schema", rejected.length === 0, rejected.join(" | "));
  // the same token again
  const again = await reply(env, NEW, sent.token!, { ...FARMER, trade: "اسم آخر" });
  assert("the token again: not written a second time, and he is told so", again.action === "duplicate" && byNumber(NEW)[0].name === "مزرعة الخير" && partners().length === before + 1 && bodyOf(sentTo(NEW).at(-1)) === REG.SIGNUP_USED_TEXT);
}

console.log("\n[ب5] the card of his number is updated");
{
  const env = world();
  // a number that wrote before and was made a customer card Baraa has not reviewed
  seed("res.partner", { id: 7100, name: "x", x_whatsapp_number: "+" + NEW, customer_rank: 1, x_contact_class: "unreviewed", x_review_pending: true });
  openWindow(env, NEW, 0);
  await quiet(() => REG.answerSignupKeyword(env, { from: "+" + NEW, text: "سجلني كمورد" }, { team: false }));
  const tok = par(flowsTo(NEW)[0]).flow_token;
  const before = partners().length;
  const r = await reply(env, NEW, tok, { ...FARMER, stype: "wholesaler", w_shop: "مستودع 9" });
  const c = partner(7100);
  assert("a number not reviewed yet: ITS card becomes the supplier's — no second card — and it leaves the customers' path", r.action === "saved" && r.partnerId === 7100 && partners().length === before && c.name === "مزرعة الخير" && c.x_supplier_state === "pending" && c.x_contact_class === "supplier" && c.customer_rank === 0 && c.x_review_pending === false, JSON.stringify(c));
  assert("…the location carries the shop he wrote", c.x_supplier_location === "القصيم — بريدة — مستودع 9");
  // Ahmad: a supplier of before, approved
  Object.assign(partner(AHMED), { x_supplier_state: "approved" });
  snap();
  openWindow(env, AHMED_PHONE, 0);
  await quiet(() => REG.answerSignupKeyword(env, { from: "+" + AHMED_PHONE, text: "تسجيل مورد" }, { team: false }));
  const f = flowsTo(AHMED_PHONE).at(-1);
  assert("a supplier we know gets the form opened on his name", dataOf(f).i_trade === "أحمد حسان");
  const r2 = await reply(env, AHMED_PHONE, par(f).flow_token, { ...FARMER, trade: "مؤسسة أحمد حسان", stype: "wholesaler", items: "بطاطس" });
  const a = partner(AHMED);
  assert("an approved supplier's form updates HIS card: his state stays «معتمد», his name stays, his rank stays", r2.action === "updated" && a.x_supplier_state === "approved" && a.name === "أحمد حسان" && a.supplier_rank === 5 && a.x_supplier_type === "wholesaler" && String(a.x_supplier_detail).startsWith("الاسم التجاري: مؤسسة أحمد حسان"), JSON.stringify(a));
  assert("…his items are ADDED to «الأصناف التي يوفرها», never replaced (1, 2 of before, and بطاطس)", JSON.stringify(a.x_supplied_product_ids) === JSON.stringify([1, 2, 3]), JSON.stringify(a.x_supplied_product_ids));
  assert("…he is told his data arrived, and Baraa that he updated it", bodyOf(sentTo(AHMED_PHONE).at(-1)) === REG.SIGNUP_UPDATED_TEXT && ownerTexts().some((t) => t.startsWith("🧑‍🌾 مورد حدّث بياناته: مؤسسة أحمد حسان")));
  // a second form of the same farmer: no second season of the same crop and months
  const env2 = world();
  openWindow(env2, NEW, 0);
  const s1 = await quiet(() => REG.sendSignupForm(env2, { partnerId: 0, whatsapp: "+" + NEW }));
  await reply(env2, NEW, s1.token!, FARMER);
  const s2 = await quiet(() => REG.sendSignupForm(env2, { partnerId: byNumber(NEW)[0].id, whatsapp: "+" + NEW }));
  await reply(env2, NEW, s2.token!, { ...FARMER, f_c3: "بصل", f_a3: "01", f_b3: "02" });
  assert("the form again: the two seasons of before are not written twice, the new crop is added", (rows("x_supplier_season") as any[]).length === 3 && byNumber(NEW).length === 1);
  const s3 = await quiet(() => REG.sendSignupForm(env2, { partnerId: byNumber(NEW)[0].id, whatsapp: "+" + NEW }));
  await reply(env2, NEW, s3.token!, { ...FARMER, f_c1: "ثوم", f_a1: "", f_b1: "", f_c2: "كوسة", f_a2: "04", f_b2: "06", f_c3: "" });
  const all = rows("x_supplier_season") as any[];
  assert("a crop with no month is no season — and it does not cost the form its other seasons (كوسة April → June is written)", all.length === 4 && all.at(-1).x_item_text === "كوسة" && all.at(-1).x_month_from === "04" && !all.some((s) => s.x_item_text === "ثوم"), JSON.stringify(all.map((s) => [s.x_item_text, s.x_month_from])));
}

console.log("\n[ب6] the token, and a form that is refused");
{
  const env = world();
  openWindow(env, NEW, 0);
  const sent = await quiet(() => REG.sendSignupForm(env, { partnerId: 0, whatsapp: "+" + NEW }));
  const before = JSON.stringify(partners());
  const other = await reply(env, NEW2, sent.token!, FARMER);
  assert("a token sent to another number: nothing written, «غير صالح»", other.action === "unknown" && JSON.stringify(partners()) === before && bodyOf(sentTo(NEW2).at(-1)) === REG.SIGNUP_UNKNOWN_TEXT);
  const unknown = await reply(env, NEW, "sg1.0.deadbeef", FARMER);
  assert("a token nobody issued: nothing written", unknown.action === "unknown" && JSON.stringify(partners()) === before);
  const bad = await reply(env, NEW, sent.token!, { ...FARMER, trade: "" });
  const again = flowsTo(NEW).at(-1);
  assert("no trade name: NOTHING is written, and the form opens again with what he typed — on a new token", bad.action === "invalid" && JSON.stringify(partners()) === before && rows("x_supplier_season").length === 0 && bodyOf(again) === REG.SIGNUP_BAD_TEXT && dataOf(again).i_contact === "سعد" && par(again).flow_token !== sent.token);
  const ok = await reply(env, NEW, par(again).flow_token, FARMER);
  assert("…and the corrected form is taken", ok.action === "saved" && byNumber(NEW).length === 1);
  assert("the signup purposes are replies, never held: a form is not owed", PURPOSES[REG.SIGNUP_PURPOSE].kind === "reply" && PURPOSES[REG.SUPPLIER_REPLY_PURPOSE].kind === "reply");
}

console.log("\n[ب7] «📨 أرسل رابط التسجيل»");
{
  const env = world();
  seed("res.partner", { id: 7200, name: "مستورد جديد", x_whatsapp_number: "+" + NEW, x_contact_name: "خالد" });
  openWindow(env, NEW, 0);
  const a = await quiet(() => REG.handleSupplierHook(env, 7200, "invite"));
  const c = partner(7200);
  assert("inside the card's number's window: the form itself, opened on the card's name", a.action === "form" && flowsTo(NEW).length === 1 && dataOf(flowsTo(NEW)[0]).i_trade === "مستورد جديد" && dataOf(flowsTo(NEW)[0]).i_contact === "خالد");
  assert("…the card becomes «بانتظار الاعتماد», with when it was invited and what the button did", c.x_supplier_state === "pending" && !!c.x_supplier_invited_at && String(c.x_supplier_result).startsWith("📨 أُرسل نموذج التسجيل"));
  const b = await quiet(() => REG.handleSupplierHook(env, 7200, "invite"));
  assert("the button again the same day: nothing is sent a second time", b.action === "claimed_before" && sentTo(NEW).length === 1);

  const env2 = world();
  approveTemplates();
  seed("res.partner", { id: 7201, name: "مزرعة", x_whatsapp_number: "+" + NEW2, x_supplier_state: "approved" });
  const t = await quiet(() => REG.handleSupplierHook(env2, 7201, "invite"));
  const tpl = sentTo(NEW2).filter((m: any) => m?.template?.name === "utak_supplier_invite_v1");
  assert("outside his window, the template APPROVED and UTILITY: utak_supplier_invite_v1, and no Flow", t.action === "template" && tpl.length === 1 && flowsTo(NEW2).length === 0);
  assert("…a card that already carries a state keeps it", partner(7201).x_supplier_state === "approved" && String(partner(7201).x_supplier_result).startsWith("📨 أُرسل قالب الدعوة"));

  const env3 = world();
  seed("res.partner", { id: 7202, name: "وكيل", x_whatsapp_number: "+" + NEW });
  const n = await quiet(() => REG.handleSupplierHook(env3, 7202, "invite"));
  assert("outside his window with no usable template: NOTHING reaches him, nothing is held", n.action === "text_for_owner" && sentTo(NEW).length === 0 && heldFor(env3, NEW).length === 0);
  assert("…the card shows the invitation's text for Baraa to send, and Baraa gets it on WhatsApp too", String(partner(7202).x_supplier_result).includes(REG.INVITE_TEXT) && ownerTexts().some((x) => x.includes(REG.INVITE_TEXT) && x.includes("«وكيل»")));
  const again = await quiet(() => REG.handleSupplierHook(env3, 7202, "invite"));
  assert("…and the button can be pressed again (nothing went)", again.action === "text_for_owner");

  seed("res.partner", { id: 7203, name: "بلا رقم" });
  seed("res.partner", { id: 7204, name: "محاكاة", x_whatsapp_number: "+966511110009", x_utak_simulation: true });
  seed("res.partner", { id: 7205, name: "رقم براء", x_whatsapp_number: "+" + OWNER });
  const r3 = [await quiet(() => REG.handleSupplierHook(env3, 7203, "invite")), await quiet(() => REG.handleSupplierHook(env3, 7204, "invite")), await quiet(() => REG.handleSupplierHook(env3, 7205, "invite")), await quiet(() => REG.handleSupplierHook(env3, 99999, "invite"))];
  assert("a card with no number, a simulated card, Baraa's own number, a card that is not there: nothing is sent", JSON.stringify(r3.map((x) => x.action)) === JSON.stringify(["no_number", "simulation", "owner", "not_found"]) && sentTo("966511110009").length === 0 && String(partner(7203).x_supplier_result).includes("اكتب رقم الواتساب"));
}

console.log("\n[ب8] «✅ اعتماد»: the welcome");
{
  const env = world(`${DAY} 10:00`); // 2026-10-03, a Saturday
  seed("res.partner", { id: 7300, name: "مزرعة الخير", x_whatsapp_number: "+" + NEW, x_supplier_state: "approved", x_supplier_type: "farmer", x_contact_cadence: "monthly" });
  openWindow(env, NEW, 0);
  const w = await quiet(() => REG.handleSupplierHook(env, 7300, "welcome"));
  const m = sentTo(NEW).at(-1) as any;
  assert("a farmer inside his window: the welcome with ONE button «📦 بضاعتي جاهزة»", w.action === "sent" && m.interactive.type === "button" && JSON.stringify(m.interactive.action.buttons.map((b: any) => [b.reply.id, b.reply.title])) === JSON.stringify([["sup_offer:ready", "📦 بضاعتي جاهزة"]]) && bodyOf(m).startsWith("مرحبا مزرعة 🌿 تم اعتمادك مورداً لدى يو تاك ✅"));
  assert("…«التواصل القادم» is the first of next month (monthly), and the card says the welcome went", partner(7300).x_next_contact === "2026-11-01" && !!partner(7300).x_supplier_welcomed_at && String(partner(7300).x_supplier_result).startsWith("✅ معتمد — أُرسل الترحيب"));
  const w2 = await quiet(() => REG.handleSupplierHook(env, 7300, "welcome"));
  assert("the welcome goes ONCE: a second «✅ اعتماد» (after «⛔ إيقاف») sends none", w2.action === "claimed_before" && sentTo(NEW).length === 1);

  seed("res.partner", { id: 7301, name: "شركة الاستيراد", x_whatsapp_number: "+" + NEW2, x_supplier_state: "approved", x_supplier_type: "importer", x_contact_cadence: "weekly" });
  const h = await quiet(() => REG.handleSupplierHook(env, 7301, "welcome"));
  const held = heldFor(env, NEW2);
  assert("an importer outside his window: the welcome is HELD until it opens — «🚢 وصلت شحنة» first, then «📦 بضاعتي جاهزة»", h.action === "held" && sentTo(NEW2).length === 0 && held.length === 1 && JSON.stringify(REG.welcomeButtons("importer").map((b) => b.title)) === JSON.stringify(["🚢 وصلت شحنة", "📦 بضاعتي جاهزة"]) && JSON.stringify(held[0]).includes("sup_offer:ship"), JSON.stringify(held).slice(0, 300));
  assert("…«التواصل القادم» is next Sunday (weekly)", partner(7301).x_next_contact === "2026-10-04" && String(partner(7301).x_supplier_result).includes("محفوظ حتى يكتب"));
  assert("the welcome's purpose is held for a week, never a template", PURPOSES[REG.SUPPLIER_WELCOME_PURPOSE].kind === "operational" && JSON.stringify(PURPOSES[REG.SUPPLIER_WELCOME_PURPOSE].ttl) === JSON.stringify({ hours: 168 }));

  seed("res.partner", { id: 7302, name: "بانتظار", x_whatsapp_number: "+966511110003", x_supplier_state: "pending", x_supplier_type: "farmer" });
  seed("res.partner", { id: 7303, name: "موقوف", x_whatsapp_number: "+966511110004", x_supplier_state: "suspended", x_supplier_type: "farmer" });
  openWindow(env, "966511110003", 0); openWindow(env, "966511110004", 0);
  const no = [await quiet(() => REG.handleSupplierHook(env, 7302, "welcome")), await quiet(() => REG.handleSupplierHook(env, 7303, "welcome"))];
  assert("a card that is not «معتمد» (pending, suspended): no welcome, nothing written", no.every((x) => x.action === "not_approved") && sentTo("966511110003").length === 0 && sentTo("966511110004").length === 0 && !partner(7302).x_supplier_result);
  assert("an expense supplier is welcomed with no button; a daily and an on-demand cadence have no «التواصل القادم»", REG.welcomeButtons("expense").length === 0 && REG.nextContactAfter("daily", DAY) === null && REG.nextContactAfter("on_demand", DAY) === null && REG.nextContactAfter(null, DAY) === null);
  assert("the next Sunday after a Sunday is the one a week later; the first after the 31st of December is the 1st of January", REG.nextContactAfter("weekly", "2026-10-04") === "2026-10-11" && REG.nextContactAfter("monthly", "2026-12-31") === "2027-01-01");
}

console.log("\n[ب9] a supplier's number is closed to sale prices");
{
  const env = world();
  seed("res.partner", { id: 7400, name: "مزرعة", x_whatsapp_number: "+" + NEW, x_supplier_state: "pending" });
  const closed = await PRIV.readClosedNumbers(env);
  const mine = closed.find((c: any) => c.id === 7400);
  assert("a card with «حالة المورد» is a closed number — a supplier — whatever its supplier_rank", !!mine && mine.kind === "supplier" && mine.digits === NEW, JSON.stringify(closed));
  assert("…a price source that is not a supplier is still «مصدر أسعار», a supplier of before still «مورد»", (() => { seed("res.partner", { id: 7401, name: "رائد", x_whatsapp_number: "+966511110005", x_price_source: true, supplier_rank: 0 }); return true; })() && (await PRIV.readClosedNumbers(env)).find((c: any) => c.id === 7401)?.kind === "source" && (await PRIV.readClosedNumbers(env)).find((c: any) => c.id === AHMED)?.kind === "supplier");
  openWindow(env, NEW, 0);
  const res = await quiet(() => sendViaGateway(env, { purpose: "customer_prices", to: NEW, content: textContent("طماطم 25 ريال") }));
  assert("the gateway refuses a customers' price list for his number", gatewayDecision(res)?.action === "refused" && sentTo(NEW).length === 0, JSON.stringify(gatewayDecision(res)));
}

console.log("\n[ب10] the webhook, the hook's route, the trial");
{
  const env = world();
  await say(env, NEW, { type: "text", text: { body: "تسجيل مورد" } });
  const f = flowsTo(NEW);
  assert("«تسجيل مورد» from a number we do not know: the registration form — and no customer's welcome, no order form, nothing else", f.length === 1 && par(f[0]).flow_id === REG.SIGNUP_FLOW_ID && sentTo(NEW).length === 1, JSON.stringify(sentTo(NEW).map((b: any) => b?.interactive?.type ?? b?.template?.name ?? b?.type)));
  await say(env, NEW, { type: "button", button: { text: "تسجيل مورد", payload: "تسجيل مورد" } });
  assert("the invitation's button «تسجيل مورد» is the keyword: the form again", flowsTo(NEW).length === 2);
  const tok = par(flowsTo(NEW).at(-1)).flow_token;
  await say(env, NEW, { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ ...FARMER, flow_token: tok }) } } });
  const card = byNumber(NEW).find((p) => p.x_supplier_state);
  assert("its reply through the webhook is read by its token: ONE card «بانتظار الاعتماد» on the number", !!card && card.x_supplier_state === "pending" && byNumber(NEW).length === 1 && bodyOf(sentTo(NEW).at(-1)) === REG.SIGNUP_DONE_TEXT, JSON.stringify(byNumber(NEW)));
  const n = sentTo(NEW).length;
  await say(env, NEW, { type: "text", text: { body: "ابي طماطم ٣ كراتين" } });
  assert("his later message never enters the customers' path: no order, no quotation, no order form", rows("x_daily_order").length === 0 && !sentTo(NEW).slice(n).some((b: any) => b?.interactive?.type === "flow" || /عرض سعر|طلبك/.test(bodyOf(b))), JSON.stringify(sentTo(NEW).slice(n).map(bodyOf)));
  // the route
  const hookEnv = { ...env, ODOO_HOOK_TOKEN: "HOOK" };
  const waits: Promise<unknown>[] = [];
  const hctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException: () => {} } as any;
  const post = (q: string, body: unknown = { _model: "res.partner", _id: card.id }) => quiet(() => worker.fetch(new Request(`https://w.test/odoo/hook/supplier${q}`, { method: "POST", body: JSON.stringify(body) }), hookEnv, hctx));
  assert("the hook refuses a wrong token (401), an op it does not know and another model (400)", (await post("?token=NO&op=welcome")).status === 401 && (await post("?token=HOOK&op=delete")).status === 400 && (await post("?token=HOOK&op=welcome", { _model: "x_special_quote", _id: 1 })).status === 400 && (await post("?token=HOOK&op=welcome", { _model: "res.partner" })).status === 400);
  Object.assign(card, { x_supplier_state: "approved", x_contact_cadence: "monthly" });
  const ok = await post("?token=HOOK&op=welcome");
  await quiet(() => Promise.all(waits));
  assert("«✅ اعتماد» through the hook: 202 at once, then the welcome with his button", ok.status === 202 && (sentTo(NEW).at(-1) as any)?.interactive?.type === "button" && !!partner(card.id).x_supplier_welcomed_at);
  // the trial
  const T = await import("../src/s65-trials.ts");
  const env2 = world();
  seed("res.partner", { id: 45, name: "Bara.a - U TAK", x_whatsapp_number: "+" + OWNER });
  const before = partners().length;
  const t = await quiet(() => T.sendS65Trial(env2, "signup"));
  const tf = flowsTo(OWNER);
  assert("the trial: one form to Baraa's own number, marked «🧪 تجربة»", t.sent === true && tf.length === 1 && bodyOf(tf[0]).startsWith("🧪 تجربة") && String(dataOf(tf[0]).t).startsWith("🧪 تجربة"));
  const t2 = await quiet(() => T.sendS65Trial(env2, "signup"));
  assert("…once a day", t2.sent === false && t2.reason === "already_today" && flowsTo(OWNER).length === 1);
  const tr = await reply(env2, OWNER, par(tf[0]).flow_token, FARMER);
  const sim = partners().find((p) => p.x_utak_simulation === true && p.x_supplier_state === "pending");
  assert("its reply makes a NEW card flagged «محاكاة», with no number — Baraa's own card is not touched", tr.action === "test" && partners().length === before + 1 && !!sim && !sim.x_whatsapp_number && sim.name === "🧪 تجربة مزرعة الخير" && !partner(45).x_supplier_state && partner(45).name === "Bara.a - U TAK", JSON.stringify(sim));
  assert("…its seasons are flagged «محاكاة» too, and Baraa's line says it is a trial", (rows("x_supplier_season") as any[]).every((s) => s.x_utak_simulation === true) && rows("x_supplier_season").length === 2 && ownerTexts().some((x) => x.startsWith("🧪 تجربة — 🧑‍🌾") && x.includes("محاكاة")));
  const env3 = world();
  closeOwnerWindow(env3);
  const t3 = await quiet(() => T.sendS65Trial(env3, "signup"));
  const t4 = await quiet(() => T.sendS65Trial(env3, "nothing"));
  assert("a closed window burns no attempt: nothing sent, «window_closed» — and an unknown trial is refused", t3.sent === false && t3.reason === "window_closed" && sentTo(OWNER).length === 0 && ![...env3.MSG_DEDUP.store.keys()].some((k: string) => k.includes("supsg_test")) && t4.reason === "unknown_trial");
  assert("no Odoo field outside the tenant's schema", rejected.length === 0, rejected.join(" | "));
}

done();
