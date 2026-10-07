// § 62 د (2026-10-07) — the first «طلب أسعار خاص»: شركة مدارات للأغذية (+966530032939), 27 lines by the kilo.
//
//   1  the customer: the partner that holds the number (never changed here); none → a company partner
//      «شركة مدارات للأغذية», a customer, with the number
//   2  each line's product: the catalog's own when its name matches (below), else a NEW product in its
//      category — «نشط للبيع» OFF (Odoo's own automation on creation sets it off, with the 15 % sale tax),
//      its unit the kilo, and its «صنف جديد» flag cleared (13 alerts to Baraa for products this script
//      names itself would say nothing new). No existing product is changed.
//   3  the request, «مسودة», with its 27 lines in the customer's order. NOTHING IS SENT: the form to the
//      sources goes when Baraa presses «📨 أرسل طلب الأسعار» himself. A request somebody already made by
//      hand for the same customer is NOT this script's: it is left exactly as it is (named in the log
//      and in the rollback file), and this script's request is made beside it.
//   4  the worker prepares it by itself (its name, the defaults, its three sources): creating it is a
//      save, and a save asks the deployed worker for the request's numbers (Odoo's automation). RUN THIS
//      AFTER THE WORKER IS DEPLOYED; if the request stays unprepared, «🔄 احسب» on its screen — or
//      `node scripts/s62-20261007-trial.mjs recalc --send` — asks again. Neither sends anything.
//
// How a line finds its product (the choice is printed and kept in the rollback file):
//   • the same name (hamza, «ة / ه», spaces and a note in brackets aside): برتقال، ثوم، ليمون، أناناس،
//     مانجو، بقدونس، نعناع، جزر، طماطم، and «بطيخ» = «بطيخ (بالحبة)», «أفوكادو» = «افوكادو», «كوسة» = «كوسا»;
//   • the two the order names: «موز» → «موز أمريكي» (the banana on sale today), «رمان» → «رمان وسط»
//     (no pomegranate is filed by the kilo);
//   • a name with a kind in it that the catalog does not hold — خس أمريكي، ملفوف أخضر، تفاح أحمر، بصل
//     أبيض، فلفل أخضر، فلفل أحمر، فطر أبيض، فطر بني، طماطم شيري — and شمام، شمندر، كرفس، ريحان: NEW
//     (a kind is priced on its own; Baraa merges two cards if they are one item).
//
//   node scripts/s62-20261007-madarat.mjs                 dry-run: the plan, nothing written
//   node scripts/s62-20261007-madarat.mjs --apply         the three steps (the rollback file first)
//   node scripts/s62-20261007-madarat.mjs --verify        read-only checks
//   node scripts/s62-20261007-madarat.mjs --rollback [--apply]   the request «مغلق», the created products archived (nothing is deleted)
// Rollback file: scripts/artifacts/s62-20261007-madarat-rollback.json. The tenant is production. No WhatsApp send.
import { APPLY, ROLLBACK, VERIFY, call, checker, log, rollbackFile, step } from "./lib/s40-kit.mjs";
import { LINE_MODEL, QUOTE_MODEL, RECIPIENT_MODEL } from "./lib/s62-odoo.mjs";

const RB = new URL("./artifacts/s62-20261007-madarat-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s62-20261007-madarat.mjs");
const { rb, save } = ctx;
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };

export const CUSTOMER = { name: "شركة مدارات للأغذية", number: "+966530032939" };
const CATEGORY = { فواكه: 5, خضار: 6, ورقيات: 7 };
const KG_UOM = 16;
const SALE_TAX = 5;
const NOTE = "أول طلب أسعار خاص: قائمة العميل 27 صنفاً بالكيلو (§ 62 د، 2026-10-07).";
/** [the customer's name of the item, kilos, its category, the catalog's name it is matched to when not its own] */
export const LINES = [
  ["برتقال", 1464, "فواكه"], ["خس أمريكي", 494, "ورقيات"], ["ملفوف أخضر", 365, "خضار"], ["مانجو", 322, "فواكه"], ["ثوم", 194, "خضار"],
  ["ليمون", 148, "فواكه"], ["موز", 132, "فواكه", "موز أمريكي"], ["أناناس", 132, "فواكه"], ["أفوكادو", 110.8, "فواكه"],
  ["بطيخ", 90, "فواكه"], ["رمان", 89, "فواكه", "رمان وسط"], ["شمام", 48, "فواكه"], ["تفاح أحمر", 47, "فواكه"], ["طماطم", 33, "خضار"],
  ["بصل أبيض", 30, "خضار"], ["جزر", 21, "خضار"], ["فلفل أخضر", 19, "خضار"], ["شمندر", 18, "خضار"],
  ["فطر أبيض", 12, "خضار"], ["بقدونس", 11.7, "ورقيات"], ["فلفل أحمر", 10, "خضار"], ["كوسة", 9, "خضار"], ["نعناع", 8.9, "ورقيات"],
  ["كرفس", 4.7, "ورقيات"], ["ريحان", 3.4, "ورقيات"], ["فطر بني", 0.5, "خضار"], ["طماطم شيري", 0.5, "خضار"],
];
/** A name as it is compared: no reference, no note in brackets, one hamza, «ة / ه / ا» at a word's end alike, no spaces. */
export const norm = (s) => String(s ?? "").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\([^)]*\)/g, "").replace(/[أإآ]/g, "ا").replace(/[ةه](?=\s|$)/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, "").trim();

const digits = CUSTOMER.number.replace(/\D/g, "").slice(-9);
const customerRows = () => call("res.partner", "search_read", { domain: ["|", ["x_whatsapp_number", "ilike", digits], ["phone", "ilike", digits]], fields: ["id", "name", "phone", "x_whatsapp_number", "customer_rank", "supplier_rank", "is_company", "active"], order: "id asc", limit: 5 });
const catalog = () => call("product.template", "search_read", { domain: [["type", "!=", "service"]], fields: ["id", "name", "active", "x_is_active_for_sale", "categ_id", "uom_id", "taxes_id", "default_code", "x_utak_new"], order: "id asc", limit: 500, context: ALL });
const QUOTE_READ = ["id", "x_name", "x_state", "x_prepared", "x_note", "x_asked_at", "x_waste_pct", "x_min_margin_pct", "x_delivery_cost", "x_valid_until", "x_price_mode", "x_profit_text", "x_missing_purchase", "x_line_ids", "create_uid", "create_date"];
/** The customer's requests (the real ones), oldest first. */
const quotesOf = (partnerId) => call(QUOTE_MODEL, "search_read", { domain: [["x_partner_id", "=", partnerId], ["x_utak_simulation", "!=", true]], fields: QUOTE_READ, order: "id asc", limit: 20 });
/** THIS script's request: the one it made (the rollback file names it) — never a request somebody else made for the same customer. */
const quoteOf = async (partnerId) => (rb.created.quote ? (await quotesOf(partnerId)).find((q) => q.id === rb.created.quote) ?? null : null);
const linesOf = (id) => call(LINE_MODEL, "search_read", { domain: [["x_quote_id", "=", id]], fields: ["id", "x_sequence", "x_product_tmpl_id", "x_qty", "x_unit", "x_purchase_price", "x_final_price"], order: "x_sequence asc, id asc", limit: 100 });
/** Each line against the catalog: the product it is, or null (to be made). */
function matchAll(products) {
  const live = products.filter((p) => p.active);
  return LINES.map(([name, qty, category, as]) => {
    const want = norm(as ?? name);
    const hit = live.filter((p) => norm(p.name) === want);
    return { name, qty, category, as: as ?? null, product: hit[0] ?? null, twins: hit.length };
  });
}

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const qid = rb.created.quote;
  if (qid) { log(`✎ ${QUOTE_MODEL} #${qid}: «مغلق» (not deleted; a closed request takes no reply)`); if (APPLY) await call(QUOTE_MODEL, "write", { ids: [qid], vals: { x_state: "closed" } }); }
  for (const [name, id] of Object.entries(rb.created.products ?? {})) {
    log(`✎ product.template #${id} «${name}» (created here): archived (not deleted)`);
    if (APPLY) { await call("product.template", "write", { ids: [id], vals: { active: false } }); await pause(400); }
  }
  if (rb.created.partner) log(`= res.partner #${rb.created.partner} (created here): left as it is — a customer's card is Baraa's to archive`);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const partners = await customerRows();
  check(`ONE partner holds ${CUSTOMER.number}: #${partners[0]?.id} «${partners[0]?.name}», a customer`, partners.length === 1 && partners[0].customer_rank > 0 && !partners[0].supplier_rank, JSON.stringify(partners));
  await pause();
  const q = partners[0] ? await quoteOf(partners[0].id) : null;
  check(`its request #${q?.id} «${q?.x_name}»: not closed, nothing sent to a source`, !!q && q.x_state !== "closed" && !q.x_asked_at, JSON.stringify(q));
  const lines = q ? await linesOf(q.id) : [];
  await pause();
  const products = await catalog();
  const byId = new Map(products.map((p) => [p.id, p]));
  check(`its ${LINES.length} lines, in the customer's order, each with its quantity by the kilo`, lines.length === LINES.length && LINES.every(([, qty], i) => Math.abs(lines[i].x_qty - qty) < 0.001 && lines[i].x_unit === "كيلو"), JSON.stringify(lines.map((l) => l.x_qty)));
  check("each line's product is the one the plan names", LINES.every(([name, , , as], i) => norm(byId.get(lines[i]?.x_product_tmpl_id?.[0])?.name) === norm(as ?? name)), JSON.stringify(lines.map((l) => l.x_product_tmpl_id?.[1])));
  const made = Object.entries(rb.created.products ?? {});
  check(`the ${made.length} products made here: «نشط للبيع» OFF, the 15 % sale tax, the kilo, their category, no «صنف جديد» alert pending`, made.every(([name, id]) => {
    const p = byId.get(id); const cat = LINES.find((l) => l[0] === name)?.[2];
    return p && p.active && p.x_is_active_for_sale === false && JSON.stringify(p.taxes_id) === JSON.stringify([SALE_TAX]) && p.uom_id?.[0] === KG_UOM && p.categ_id?.[0] === CATEGORY[cat] && p.x_utak_new === false;
  }), JSON.stringify(made.map(([, id]) => byId.get(id)).filter((p) => !p || p.x_is_active_for_sale !== false || p.x_utak_new !== false)));
  const before = rb.before.products ?? {};
  check(`no existing product was changed (${Object.keys(before).length} snapshots: active, «نشط للبيع», category, unit, taxes, reference)`, Object.entries(before).every(([id, snap]) => JSON.stringify(snapOf(byId.get(Number(id)))) === JSON.stringify(snap)), JSON.stringify(Object.keys(before).filter((id) => JSON.stringify(snapOf(byId.get(Number(id)))) !== JSON.stringify(before[id]))));
  const forSale = products.filter((p) => p.active && p.x_is_active_for_sale).map((p) => p.id).sort((a, b) => a - b);
  check(`the items «نشط للبيع» are the ones of before (${(rb.before.forSale ?? []).join(", ")})`, JSON.stringify(forSale) === JSON.stringify(rb.before.forSale ?? forSale), JSON.stringify(forSale));
  await pause();
  const rec = q ? await call(RECIPIENT_MODEL, "search_read", { domain: [["x_quote_id", "=", q.id]], fields: ["id", "x_partner_id", "x_role", "x_asked_at", "x_replied_at"], order: "id asc" }) : [];
  check(`«الأسعار في العرض»: قبل الضريبة (the default of a new request)`, q?.x_price_mode === "net", String(q?.x_price_mode));
  check(`prepared by the worker: its name, the waste, the margin 10 %, the delivery cost, «صالح حتى», and its sources (${rec.map((r) => `${r.x_partner_id?.[1]} ${r.x_role}`).join("، ") || "—"}) — none asked yet`,
    !!q?.x_prepared && /^SQ-\d{4}$/.test(String(q.x_name)) && q.x_min_margin_pct === 10 && q.x_waste_pct > 0 && q.x_delivery_cost > 0 && !!q.x_valid_until && rec.length >= 3 && rec.every((r) => !r.x_asked_at && !r.x_replied_at), JSON.stringify(q));
  done();
}

function snapOf(p) {
  return p ? { active: p.active, forSale: p.x_is_active_for_sale, categ: p.categ_id?.[0] ?? false, uom: p.uom_id?.[0] ?? false, taxes: p.taxes_id, ref: p.default_code } : null;
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write
const c = rb.created;
c.products ??= {};

log("— 1: the customer");
const partners = await customerRows();
if (partners.length > 1) { log(`✗ ${partners.length} partners hold ${CUSTOMER.number}: ${partners.map((p) => `#${p.id} «${p.name}»`).join("، ")} — nothing written`); process.exit(1); }
let partnerId = partners[0]?.id ?? null;
if (partnerId) log(`= res.partner #${partnerId} «${partners[0].name}» holds ${CUSTOMER.number} (customer_rank ${partners[0].customer_rank}): used as it is, nothing changed on it`);
else {
  partnerId = c.partner = await step(`res.partner «${CUSTOMER.name}» (a company, a customer, ${CUSTOMER.number})`, c.partner, async () =>
    (await call("res.partner", "create", { vals_list: [{ name: CUSTOMER.name, is_company: true, customer_rank: 1, phone: CUSTOMER.number, x_whatsapp_number: CUSTOMER.number }] }))[0]);
  save();
}
await pause();

log("— 2: each line's product");
const products = await catalog();
const plan = matchAll(products);
const twins = plan.filter((p) => p.twins > 1);
if (twins.length) { log(`✗ more than one product of the same name: ${twins.map((t) => t.name).join("، ")} — nothing written`); process.exit(1); }
rb.before.forSale ??= products.filter((p) => p.active && p.x_is_active_for_sale).map((p) => p.id).sort((a, b) => a - b);
rb.before.products ??= Object.fromEntries(plan.filter((p) => p.product && !Object.values(c.products).includes(p.product.id)).map((p) => [p.product.id, snapOf(p.product)]));
rb.choices = plan.map((p) => ({ line: p.name, kilos: p.qty, product: p.product ? `#${p.product.id} ${p.product.name}` : `new (${p.category})` }));
save();
const productOf = new Map();
for (const p of plan) {
  if (p.product) {
    log(`= «${p.name}» ${p.qty} كيلو → #${p.product.id} «${p.product.name}»${p.as ? " (the order's choice)" : norm(p.product.name) === norm(p.name) && p.product.name !== p.name ? " (the same item, written differently)" : ""}${p.product.x_is_active_for_sale ? " — on sale today" : ""}`);
    productOf.set(p.name, p.product.id);
    continue;
  }
  const id = await step(`product.template «${p.name}» (${p.category}, the kilo, «نشط للبيع» off) for ${p.qty} كيلو`, c.products[p.name], async () => {
    const [made] = await call("product.template", "create", { vals_list: [{ name: p.name, categ_id: CATEGORY[p.category], sale_ok: true, purchase_ok: true }] });
    c.products[p.name] = made; save();
    await pause(600);
    // Odoo's automation has prepared it (taxes, «نشط للبيع» off, the reference, the flag): the kilo, and no alert for a product named here
    await call("product.template", "write", { ids: [made], vals: { uom_id: KG_UOM, x_is_active_for_sale: false, x_utak_new: false } });
    return made;
  });
  if (id) productOf.set(p.name, id);
  save();
  await pause(600);
}
log(`matched ${plan.filter((p) => p.product).length} of ${plan.length}, to make ${plan.filter((p) => !p.product).length}: ${plan.filter((p) => !p.product).map((p) => p.name).join("، ")}`);

log("— 3: the request («مسودة», nothing sent)");
const have = partnerId ? await quoteOf(partnerId) : null;
// a request somebody made by hand for the same customer is his: left exactly as it is, and named
for (const o of (partnerId ? await quotesOf(partnerId) : []).filter((q) => q.id !== c.quote)) {
  log(`= ${QUOTE_MODEL} #${o.id} «${o.x_name || "—"}» of the customer (${o.x_state}, ${(o.x_line_ids ?? []).length} lines, made by ${o.create_uid?.[1] ?? "?"} at ${o.create_date} UTC): NOT this script's — left as it is`);
  rb.before.otherRequests ??= []; if (!rb.before.otherRequests.includes(o.id)) rb.before.otherRequests.push(o.id);
}
save();
if (have) log(`= ${QUOTE_MODEL} #${have.id} «${have.x_name || "—"}» of the customer (${have.x_state}): this script's`);
else {
  log(`+ ${QUOTE_MODEL} for #${partnerId ?? "?"}: ${LINES.length} lines, ${LINES.reduce((s, l) => s + l[1], 0).toFixed(1)} كيلو`);
  if (APPLY) {
    const missing = LINES.filter(([name]) => !productOf.get(name));
    if (missing.length) { log(`✗ no product for: ${missing.map((l) => l[0]).join("، ")} — the request is not made`); process.exit(1); }
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const [qid] = await call(QUOTE_MODEL, "create", { vals_list: [{
      x_partner_id: partnerId, x_state: "draft", x_date: today, x_note: NOTE, x_utak_simulation: false,
      x_line_ids: LINES.map(([name, qty], i) => [0, 0, { x_sequence: (i + 1) * 10, x_product_tmpl_id: productOf.get(name), x_qty: qty, x_unit: "كيلو" }]),
    }] });
    c.quote = qid; save();
    log(`  → #${qid}`);
  }
}
save();
log(APPLY ? "done — the worker prepares it within seconds; then: --verify" : "dry-run: nothing written");
