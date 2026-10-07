// § 63 (2026-10-07) — the full produce catalog in Odoo, from docs/catalog/produce-catalog.json (the source):
// fruit, vegetables, leaves, herbs, mushrooms, dates — what is traded in the Saudi wholesale markets.
//
//   1  the catalog is checked first (codes, names, units, synonyms): a catalog that fails is not run;
//   2  each item against Odoo's products — archived ones included — by its name as it is compared
//      (no hamza, no tashkeel, no «ال», a note in brackets aside) and by its synonyms; an existing product
//      is compared by BOTH its names (Odoo keeps one per language). What exists is never made again and
//      never changed: not its name, not «نشط للبيع», not its unit, not its packagings;
//   3  the pairs that may be one item — a name that begins with an existing product's name («موز أمريكي»
//      / «موز أمريكي مخمر», «خس» / «خس أمريكي»), a pair the catalog names «confusable», a product with two
//      names — are NOT merged and NOT changed: they go to scripts/artifacts/catalog-ambiguous-<date>.csv;
//   4  what is missing is created, in batches, as scripts/s62-20261007-madarat.mjs does it: Odoo's own
//      automation prepares the product on creation (the taxes, «نشط للبيع» off, the temporary carton, the
//      flag «صنف جديد»); right after, this script clears the flag (no «🆕 صنف جديد» alert for an item it
//      names itself) and writes the item's unit. The reference is the catalog's (the automation keeps a
//      reference given at creation), and the English name goes to «الاسم بالإنجليزي».
//      NO packaging is made or changed here, and no weight is written: the automation's temporary
//      «كرتون · 8 كيلو» stays as Odoo made it («الناقص» lists it) until Baraa sets the real one.
//   5  the unit: كيلو = kg (#16), حبة = Odoo's «الوحدات» (#1, what the automation gives), ربطة = a unit
//      of that name, made here once when Odoo has none (the rollback archives it).
//
// Synonyms: Odoo holds no field for them (the bot matches a name through Claude against the items on sale):
// none is created here — they stay in the catalog file, for the matching above.
//
//   node scripts/s63-20261007-catalog.mjs                 dry-run: the plan by category, the two CSV files, nothing written
//   node scripts/s63-20261007-catalog.mjs --apply         the rollback file first, then the unit and the batches
//   node scripts/s63-20261007-catalog.mjs --verify        read-only checks
//   node scripts/s63-20261007-catalog.mjs --rollback [--apply]   the created products archived, the unit archived (nothing is deleted)
// Rollback file: scripts/artifacts/s63-20261007-catalog-rollback.json. The tenant is production. No WhatsApp send.
import { readFileSync, writeFileSync } from "node:fs";
import { APPLY, ROLLBACK, VERIFY, call, checker, log, rollbackFile } from "./lib/s40-kit.mjs";

const DATE = "20261007";
const CATALOG = new URL("../docs/catalog/produce-catalog.json", import.meta.url);
const RB = new URL(`./artifacts/s63-${DATE}-catalog-rollback.json`, import.meta.url);
const PLAN_CSV = `scripts/artifacts/catalog-plan-${DATE}.csv`;
const AMBIGUOUS_CSV = `scripts/artifacts/catalog-ambiguous-${DATE}.csv`;
const { rb, save } = rollbackFile(RB, "scripts/s63-20261007-catalog.mjs");
const pause = (ms = 1200) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };

const CATEGORY = { "فواكه": 5, "خضار": 6, "ورقيات": 7 };
const KG_UOM = 16;        // «كجم»
const PIECE_UOM = 1;      // «الوحدات» — what the automation gives a new product
const BUNCH_NAME = "ربطة";
const SALE_TAX = 5;
const PURCHASE_TAX = 21;
const BATCH = 15;
/** The worker's reverse lookup of the items not on sale reads at most this many (src/odoo.ts). */
const DEACTIVATED_LIMIT = 500;
/** The models that hold a product of the day, of an order or of a special request. */
const PRODUCT_ROWS = ["x_price_offer", "x_daily_price", "x_price_day_line", "x_daily_order_line", "x_special_quote_line"];

// ---------------------------------------------------------------- names
const TASHKEEL = /[ً-ٰٟـ]/g;
/** A name as it is compared: no note in brackets, no tashkeel, one hamza, «ة / ه / ا» at a word's end alike, no «ال». */
export const tokens = (s) => String(s ?? "").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\([^)]*\)/g, " ").replace(TASHKEEL, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "").replace(/ى/g, "ي")
  .split(/\s+/).filter(Boolean).map((w) => w.replace(/^ال(?=.{2,})/, "").replace(/[ةها]$/, "ه"));
export const norm = (s) => tokens(s).join(" ");
const beginsWith = (long, short) => short.length > 0 && short.length < long.length && short.every((t, i) => long[i] === t);

// ---------------------------------------------------------------- the catalog
const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
/** What is wrong in the catalog file itself ([] = sound). Pure. */
export function catalogErrors(cat) {
  const out = [];
  const byName = new Map(), byCode = new Map(), synOwner = new Map();
  for (const it of cat.items) {
    const where = `${it.code} «${it.name}»`;
    if (!it.name || !it.name_en) out.push(`${where}: a name is missing`);
    if (TASHKEEL.test(String(it.name))) out.push(`${where}: tashkeel in the name (Odoo's search would not find it)`);
    TASHKEEL.lastIndex = 0;
    if (!cat.units.includes(it.unit)) out.push(`${where}: unit «${it.unit}»`);
    if (cat.groups[it.group] !== it.category) out.push(`${where}: group «${it.group}» is not of category «${it.category}»`);
    if (!String(it.code).startsWith(cat.prefixes[it.category] ?? "?") || !/-\d{3}$/.test(it.code)) out.push(`${where}: the reference is not of its category`);
    if (byCode.has(it.code)) out.push(`${where}: the reference is also ${byCode.get(it.code)}'s`);
    byCode.set(it.code, `«${it.name}»`);
    const n = norm(it.name);
    if (byName.has(n)) out.push(`${where}: the same name as ${byName.get(n).code}`);
    byName.set(n, it);
  }
  for (const it of cat.items) {
    for (const s of it.synonyms ?? []) {
      const n = norm(s);
      if (byName.has(n) && byName.get(n) !== it) out.push(`${it.code} «${it.name}»: the synonym «${s}» is the name of ${byName.get(n).code} — name it «confusable» instead`);
      if (synOwner.has(n) && synOwner.get(n) !== it) out.push(`${it.code} «${it.name}»: the synonym «${s}» is also ${synOwner.get(n).code}'s`);
      synOwner.set(n, it);
    }
    for (const c of it.confusable ?? []) if (!byName.has(norm(c))) out.push(`${it.code} «${it.name}»: confusable «${c}» is not an item of the catalog`);
  }
  for (const prefix of Object.values(cat.prefixes)) {
    const nums = cat.items.filter((i) => i.code.startsWith(prefix)).map((i) => Number(i.code.slice(prefix.length))).sort((a, b) => a - b);
    const gap = nums.findIndex((n, i) => n !== i + 1);
    if (gap >= 0) out.push(`${prefix}: the numbering breaks at ${String(gap + 1).padStart(3, "0")}`);
  }
  for (const must of ["موز أمريكي مخمر", "موز أمريكي غير مخمر"]) if (!byName.has(norm(must))) out.push(`the catalog must hold «${must}»`);
  return out;
}
const bad = catalogErrors(catalog);
if (bad.length) { for (const b of bad) log(`✗ catalog: ${b}`); log(`the catalog has ${bad.length} error(s): nothing read, nothing written`); process.exit(1); }

// ---------------------------------------------------------------- Odoo reads
const PRODUCT_FIELDS = ["id", "name", "default_code", "categ_id", "uom_id", "active", "sale_ok", "purchase_ok", "type", "x_is_active_for_sale", "x_utak_new", "x_name_en", "taxes_id", "supplier_taxes_id", "create_uid", "write_uid", "write_date"];
/** Every product that is not a service — archived ones too — with both its names. */
async function readProducts() {
  const rows = await call("product.template", "search_read", { domain: [["type", "!=", "service"]], fields: PRODUCT_FIELDS, order: "id asc", limit: 2000, context: { ...ALL, lang: "en_US" } });
  await pause();
  const ar = new Map((await call("product.template", "search_read", { domain: [["type", "!=", "service"]], fields: ["id", "name"], order: "id asc", limit: 2000, context: { ...ALL, lang: "ar_001" } })).map((p) => [p.id, p.name]));
  return rows.map((p) => ({ ...p, nameAr: ar.get(p.id) ?? p.name }));
}
const snapOf = (p) => (p ? { name: p.name, nameAr: p.nameAr, ref: p.default_code, categ: p.categ_id?.[0] ?? false, uom: p.uom_id?.[0] ?? false, active: p.active, forSale: p.x_is_active_for_sale, isNew: p.x_utak_new, en: p.x_name_en, taxes: p.taxes_id, buyTaxes: p.supplier_taxes_id } : null);
const forSaleIds = async () => (await call("product.template", "search_read", { domain: [["active", "=", true], ["sale_ok", "=", true], ["x_is_active_for_sale", "=", true]], fields: ["id"], order: "id asc", limit: 2000 })).map((p) => p.id);
const bunchUom = async () => (await call("uom.uom", "search_read", { domain: [["name", "=", BUNCH_NAME]], fields: ["id", "name", "active"], limit: 2, context: ALL }))[0] ?? null;

// ---------------------------------------------------------------- the plan
/**
 * Each catalog item against Odoo's products. `before`: the ids that were in Odoo before this script's
 * first write (null on a first run: every product is one of before).
 *   state: "exists" (never made, never changed) · "made" (this script's) · "new" (to be made)
 */
export function planOf(cat, products, before) {
  const wasBefore = (p) => !before || before.has(p.id);
  const keys = (p) => new Set([norm(p.name), norm(p.nameAr)]);
  const errors = [];
  const rows = cat.items.map((it) => {
    const n = norm(it.name);
    const byName = products.filter((p) => keys(p).has(n));
    const bySyn = byName.length ? [] : products.filter((p) => (it.synonyms ?? []).some((s) => keys(p).has(norm(s))));
    const byCode = products.filter((p) => p.default_code === it.code);
    const hit = byName[0] ?? bySyn[0] ?? null;
    let state = "new", note = "";
    if (hit) {
      state = wasBefore(hit) ? "exists" : hit.default_code === it.code ? "made" : "exists";
      if (byName.length > 1) note = `الاسم على ${byName.length} أصناف في Odoo: ${byName.map((p) => `#${p.id}`).join("، ")}`;
      else if (!byName.length) note = `موجود باسم آخر (مرادف): «${hit.name}»`;
      else if (state === "exists" && !wasBefore(hit)) note = "أُنشئ في Odoo بعد بدء هذا الأمر (ليس من السكربت)";
      if (state === "exists" && wasBefore(hit) && byName.length === 1 && hit.default_code !== it.code) errors.push(`«${it.name}» is #${hit.id} in Odoo with the reference ${hit.default_code || "—"}, the catalog says ${it.code}`);
    } else if (byCode.length) errors.push(`${it.code} «${it.name}»: the reference is taken in Odoo by #${byCode[0].id} «${byCode[0].name}» — the catalog must be renumbered`);
    return { it, state, product: hit, twins: byName, bySynonym: !byName.length && !!hit, note };
  });
  const used = new Set(rows.filter((r) => r.product).map((r) => r.product.id));
  return { rows, errors, strangers: products.filter((p) => !used.has(p.id)) };
}

/** The pairs that may be one item: never merged, never changed — a list for Baraa. */
export function ambiguousOf(plan) {
  const out = [];
  const side = (r) => (r.product ? { id: `#${r.product.id}`, ref: r.product.default_code || "", name: r.product.name, state: r.state === "exists" ? `موجود${r.product.x_is_active_for_sale ? " (نشط للبيع)" : ""}` : "أُنشئ في § 63" } : { id: "", ref: r.it.code, name: r.it.name, state: "جديد (يُنشأ)" });
  const rows = plan.rows;
  const byName = new Map(rows.map((r) => [norm(r.it.name), r]));
  // a product with two names (one per language)
  for (const r of rows) if (r.state === "exists" && norm(r.product.name) !== norm(r.product.nameAr)) out.push({ why: "صنف واحد باسمين في Odoo (اسم لكل لغة): الوركر يقرأ الأول", a: side(r), b: { id: `#${r.product.id}`, ref: r.product.default_code || "", name: r.product.nameAr, state: "الاسم في الواجهة العربية" } });
  for (const r of rows) if (r.twins.length > 1) for (const t of r.twins.slice(1)) out.push({ why: "الاسم نفسه على صنفين في Odoo", a: side(r), b: { id: `#${t.id}`, ref: t.default_code || "", name: t.name, state: "موجود" } });
  for (const r of rows) if (r.bySynonym) out.push({ why: "اسم الكتالوج مرادف لصنف موجود: لم يُنشأ ثانية", a: side(r), b: { id: "", ref: r.it.code, name: r.it.name, state: "في الكتالوج (لم يُنشأ)" } });
  // a name that begins with an existing product's name (the existing one may be the same item, or its general name)
  for (const a of rows.filter((r) => r.state === "exists")) {
    const ta = tokens(a.it.name);
    for (const b of rows) {
      if (b === a) continue;
      const tb = tokens(b.it.name);
      if (beginsWith(tb, ta)) out.push({ why: "اسم يبدأ باسم صنف موجود: قد يكون هو نفسه أو نوعاً منه", a: side(a), b: side(b) });
    }
  }
  // the pairs the catalog itself names
  for (const a of rows) for (const c of a.it.confusable ?? []) out.push({ why: "اسمان يُقالان للصنف نفسه عند بعض الناس", a: side(a), b: side(byName.get(norm(c))) });
  // a pair is listed once (its first reason)
  const seen = new Set();
  return out.filter((p) => { const key = [`${p.a.ref}:${p.a.name}`, `${p.b.ref}:${p.b.name}`].sort().join("|"); return seen.has(key) ? false : (seen.add(key), true); });
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (head, lines) => "﻿" + [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
const STATE_AR = { exists: "موجود (لا يُنشأ ولا يُعدَّل)", made: "أُنشئ في § 63", new: "جديد (يُنشأ)" };
function writeFiles(plan, pairs) {
  writeFileSync(new URL(`../${PLAN_CSV}`, import.meta.url), csv(
    ["الكود", "الاسم", "الاسم بالإنجليزي", "المجموعة", "الفئة في Odoo", "الوحدة", "المرادفات", "الحالة", "رقم Odoo", "ملاحظة"],
    plan.rows.map((r) => [r.it.code, r.it.name, r.it.name_en, r.it.group, r.it.category, r.it.unit, (r.it.synonyms ?? []).join("، "), STATE_AR[r.state], r.product ? r.product.id : "", r.note])));
  writeFileSync(new URL(`../${AMBIGUOUS_CSV}`, import.meta.url), csv(
    ["السبب", "رقم (أ)", "كود (أ)", "اسم (أ)", "حالة (أ)", "رقم (ب)", "كود (ب)", "اسم (ب)", "حالة (ب)", "ما فُعل"],
    pairs.map((p) => [p.why, p.a.id, p.a.ref, p.a.name, p.a.state, p.b.id, p.b.ref, p.b.name, p.b.state, "لا دمج ولا تعديل: القرار لبراء"])));
}
const GROUPS = Object.keys(catalog.groups);
const countsLine = (rows) => GROUPS.map((g) => `${g} ${rows.filter((r) => r.it.group === g).length}`).join(" · ");

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  const ids = Object.values(rb.created.products ?? {});
  log(`✎ ${ids.length} product.template created here: archived (not deleted; their references stay taken)`);
  if (APPLY) for (let i = 0; i < ids.length; i += 50) { await call("product.template", "write", { ids: ids.slice(i, i + 50), vals: { active: false } }); await pause(); }
  if (rb.created.bunchUom) { log(`✎ uom.uom #${rb.created.bunchUom} «${BUNCH_NAME}» (created here): archived`); if (APPLY) await call("uom.uom", "write", { ids: [rb.created.bunchUom], vals: { active: false } }); }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- the reads both modes need
const products = await readProducts();
const before = rb.before.products ? new Set(Object.keys(rb.before.products).map(Number)) : null;
const plan = planOf(catalog, products, before);
const pairs = ambiguousOf(plan);
const todo = plan.rows.filter((r) => r.state === "new");
const made = plan.rows.filter((r) => r.state === "made");
const exists = plan.rows.filter((r) => r.state === "exists");

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const byId = new Map(products.map((p) => [p.id, p]));
  const created = rb.created.products ?? {};
  const createdIds = Object.values(created);
  const want = plan.rows.filter((r) => r.state !== "exists");
  log(`the catalog: ${catalog.items.length} items — ${countsLine(plan.rows)}`);
  log(`in Odoo before: ${countsLine(exists)} (= ${exists.length})`);
  log(`created here:   ${countsLine(made)} (= ${made.length})`);
  check(`the catalog is sound and Odoo agrees with it (no reference taken by another product)`, plan.errors.length === 0, plan.errors.join(" | "));
  check(`created = the plan: ${want.length} items, none left to make (${countsLine(want)})`, todo.length === 0 && made.length === want.length && createdIds.length === made.length && made.every((r) => created[r.it.code] === r.product.id), `to make ${todo.length}, made ${made.length}, in the rollback file ${createdIds.length}`);
  await pause();
  const bunch = await bunchUom();
  const uomOf = { "كيلو": KG_UOM, "حبة": PIECE_UOM, "ربطة": bunch?.id };
  check(`the unit «${BUNCH_NAME}» is in Odoo (#${bunch?.id}), active`, !!bunch?.active, JSON.stringify(bunch));
  const wrong = made.filter((r) => {
    const p = r.product;
    return !(p.active && p.sale_ok && p.purchase_ok && p.type === "consu" && p.x_is_active_for_sale === false && p.x_utak_new === false && p.name === r.it.name && p.default_code === r.it.code && p.x_name_en === r.it.name_en
      && p.categ_id?.[0] === CATEGORY[r.it.category] && p.uom_id?.[0] === uomOf[r.it.unit] && JSON.stringify(p.taxes_id) === JSON.stringify([SALE_TAX]) && JSON.stringify(p.supplier_taxes_id) === JSON.stringify([PURCHASE_TAX]));
  });
  check(`each created item: its name, reference, category, unit and English name; «نشط للبيع» OFF; the 15 % taxes; no «صنف جديد» alert pending`, wrong.length === 0, wrong.slice(0, 8).map((r) => `#${r.product.id} ${r.it.name}`).join("، "));
  const refs = new Map();
  for (const p of products) if (p.default_code) refs.set(p.default_code, [...(refs.get(p.default_code) ?? []), p.id]);
  const dupRefs = [...refs].filter(([, ids]) => ids.length > 1);
  check(`no reference on two products (${refs.size} references, archived products included)`, dupRefs.length === 0, JSON.stringify(dupRefs.slice(0, 8)));
  const names = new Map();
  for (const p of products) for (const n of new Set([norm(p.name), norm(p.nameAr)])) names.set(n, [...(names.get(n) ?? []), p.id]);
  const dupNames = [...names].filter(([, ids]) => ids.length > 1);
  check(`no name on two products (${products.length} products, both languages, archived included)`, dupNames.length === 0, JSON.stringify(dupNames.slice(0, 8)));
  const changed = Object.entries(rb.before.products ?? {}).filter(([id, snap]) => JSON.stringify(snapOf(byId.get(Number(id)))) !== JSON.stringify(snap));
  check(`no existing product was changed (${Object.keys(rb.before.products ?? {}).length} snapshots: both names, reference, category, unit, active, «نشط للبيع», taxes, English name)`, !!rb.before.products && changed.length === 0, changed.map(([id]) => `#${id}`).join("، "));
  const apiUid = byId.get(createdIds[0])?.create_uid?.[0];
  const touched = Object.keys(rb.before.products ?? {}).map(Number).filter((id) => byId.get(id)?.write_date !== rb.before.writeDates?.[id]);
  check(`…and none was written by this script's user since the snapshot${touched.length ? ` (written by somebody else: ${touched.map((id) => `#${id} ${byId.get(id)?.write_uid?.[1]}`).join("، ")})` : ""}`, touched.every((id) => byId.get(id)?.write_uid?.[0] !== apiUid), touched.map((id) => `#${id}`).join("، "));
  await pause();
  const forSale = await forSaleIds();
  check(`the items on sale are the ones of before (${(rb.before.forSale ?? []).join(", ")}): the daily list, the suppliers' forms and the bot read these alone`, JSON.stringify(forSale) === JSON.stringify(rb.before.forSale), JSON.stringify(forSale));
  check(`no created item is among them`, createdIds.every((id) => !forSale.includes(id)));
  for (const model of PRODUCT_ROWS) {
    await pause(900);
    const n = createdIds.length ? await call(model, "search_count", { domain: [["x_product_tmpl_id", "in", createdIds]] }) : 0;
    check(`${model}: no row on a created item`, n === 0, String(n));
  }
  await pause();
  const flagged = await call("product.template", "search_read", { domain: [["x_utak_new", "=", true]], fields: ["id", "name"], context: ALL, limit: 50 });
  check(`no product waits for a «🆕 صنف جديد» alert`, flagged.length === 0, JSON.stringify(flagged));
  await pause();
  const sent = await call("x_wa_message", "search_read", { domain: [["id", ">", rb.before.waLastId ?? 0]], fields: ["id", "create_date", "x_direction", "x_kind", "x_status", "x_partner_id", "x_body"], order: "id asc", limit: 200 });
  const out = sent.filter((m) => m.x_direction === "out");
  // the worker's alert for a flagged product goes 10 minutes after its creation, on the next */5 tick
  if (rb.appliedAt) log(`  · ${Math.floor((Date.now() - Date.parse(rb.appliedAt)) / 60000)} minute(s) since the last creation (an alert, were one pending, would be out within 15)`);
  for (const m of sent) log(`  · x_wa_message #${m.id} ${m.create_date} UTC ${m.x_direction}/${m.x_kind}/${m.x_status} ${m.x_partner_id?.[1] ?? "—"}: ${String(m.x_body || "").replace(/\s+/g, " ").slice(0, 70)}`);
  check(`no message about a product since the snapshot (last message then #${rb.before.waLastId}; ${sent.length} row(s) since, ${out.length} outgoing)`, rb.before.waLastId > 0 && sent.every((m) => !/صنف جديد/.test(String(m.x_body || ""))), sent.filter((m) => /صنف جديد/.test(String(m.x_body || ""))).map((m) => `#${m.id}`).join("، "));
  check(`the outbox is as it was: no outgoing message since the snapshot`, out.length === 0, out.map((m) => `#${m.id} ${m.x_kind}`).join("، "));
  await pause();
  const packs = createdIds.length ? await call("x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "in", createdIds]], fields: ["id", "x_product_tmpl_id", "x_type", "x_approx_weight_kg", "create_uid"], limit: 2000 }) : [];
  const perProduct = new Map();
  for (const k of packs) perProduct.set(k.x_product_tmpl_id?.[0], [...(perProduct.get(k.x_product_tmpl_id?.[0]) ?? []), k]);
  check(`no packaging was made here: each created item holds only the temporary carton Odoo's automation gives a new product (8 kg, «الناقص» lists it)`, createdIds.every((id) => (perProduct.get(id) ?? []).length === 1 && perProduct.get(id)[0].x_type === "carton" && perProduct.get(id)[0].x_approx_weight_kg === 8), `${packs.length} packagings on ${createdIds.length} items`);
  await pause();
  const oldPacks = await call("x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "in", Object.keys(rb.before.products ?? {}).map(Number)]], fields: ["id", "write_date"], order: "id asc", limit: 2000 });
  check(`the packagings of the existing products are as they were (${rb.before.packs?.length ?? "?"})`, JSON.stringify(oldPacks.map((k) => [k.id, k.write_date])) === JSON.stringify(rb.before.packs), `${oldPacks.length} now`);
  await pause();
  const special = await call("x_special_quote", "search_read", { domain: [], fields: ["id", "x_name", "write_date"], order: "id asc", limit: 50 });
  await pause();
  const orders = await call("sale.order", "search_read", { domain: [["name", "=", "S00015"]], fields: ["id", "name", "write_date"], limit: 2 });
  check(`the special requests (SQ-0002 among them) and S00015 are as they were`, JSON.stringify({ special, orders }) === JSON.stringify(rb.before.untouched), JSON.stringify({ special, orders }));
  const off = products.filter((p) => p.active && p.sale_ok && !p.x_is_active_for_sale).length;
  check(`the items not on sale (${off}) are under the worker's lookup limit (${DEACTIVATED_LIMIT})`, off < DEACTIVATED_LIMIT, String(off));
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written to Odoo; add --apply)");
log(`the catalog: ${catalog.items.length} items — ${countsLine(plan.rows)}`);
log(`= in Odoo already (never changed): ${exists.length} — ${countsLine(exists)}`);
if (made.length) log(`= created here before: ${made.length} — ${countsLine(made)}`);
log(`+ to create: ${todo.length} — ${countsLine(todo)}`);
for (const p of plan.strangers) log(`= #${p.id} «${p.name}»${p.default_code ? ` [${p.default_code}]` : ""} is in Odoo and not in the catalog: left as it is`);
if (plan.errors.length) { for (const e of plan.errors) log(`✗ ${e}`); log("the catalog and Odoo disagree: nothing written"); process.exit(1); }
writeFiles(plan, pairs);
log(`the plan: ${PLAN_CSV} (${plan.rows.length} rows) · the pairs for Baraa: ${AMBIGUOUS_CSV} (${pairs.length} rows)`);

// the guards: the three categories, the two units, the taxes — as this script expects them
await pause();
const cats = await call("product.category", "search_read", { domain: [["id", "in", Object.values(CATEGORY)]], fields: ["id", "name"], context: { lang: "ar_001" } });
const catsOk = Object.entries(CATEGORY).every(([name, id]) => cats.find((c) => c.id === id)?.name === name);
await pause();
const uoms = await call("uom.uom", "search_read", { domain: [["id", "in", [KG_UOM, PIECE_UOM]]], fields: ["id", "name", "active"], context: { lang: "en_US" } });
const uomsOk = uoms.find((u) => u.id === KG_UOM)?.name === "kg" && uoms.find((u) => u.id === PIECE_UOM)?.name === "Units";
await pause();
const auto = await call("base.automation", "search_read", { domain: [["name", "=", "utak.product.setup (on_create)"]], fields: ["id", "active"], context: ALL });
if (!catsOk || !uomsOk || auto.length !== 1 || !auto[0].active) { log(`✗ Odoo is not as expected — categories ${JSON.stringify(cats)}, units ${JSON.stringify(uoms)}, the on-create automation ${JSON.stringify(auto)}: nothing written`); process.exit(1); }
log(`= the categories #5 / #6 / #7, the units kg #${KG_UOM} and Units #${PIECE_UOM}, the on-create automation #${auto[0].id} (active)`);

// the rollback file before the first write: what Odoo held before
if (!rb.before.products) {
  rb.before.products = Object.fromEntries(products.map((p) => [p.id, snapOf(p)]));
  rb.before.writeDates = Object.fromEntries(products.map((p) => [p.id, p.write_date]));
  await pause();
  rb.before.forSale = await forSaleIds();
  await pause();
  rb.before.waLastId = (await call("x_wa_message", "search_read", { domain: [], fields: ["id"], order: "id desc", limit: 1 }))[0]?.id ?? 0;
  await pause();
  rb.before.packs = (await call("x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "in", products.map((p) => p.id)]], fields: ["id", "write_date"], order: "id asc", limit: 2000 })).map((k) => [k.id, k.write_date]);
  await pause();
  const special = await call("x_special_quote", "search_read", { domain: [], fields: ["id", "x_name", "write_date"], order: "id asc", limit: 50 });
  await pause();
  const orders = await call("sale.order", "search_read", { domain: [["name", "=", "S00015"]], fields: ["id", "name", "write_date"], limit: 2 });
  rb.before.untouched = { special, orders };
  rb.before.at = new Date().toISOString();
  log(`= before: ${products.length} products, on sale ${rb.before.forSale.join(", ")}, last x_wa_message #${rb.before.waLastId}, ${rb.before.packs.length} packagings`);
}
rb.created.products ??= {};
for (const r of made) rb.created.products[r.it.code] ??= r.product.id; // a creation whose answer was lost: found again by its reference and name
save();

// the unit «ربطة»
await pause();
let bunch = await bunchUom();
if (bunch) log(`= uom.uom #${bunch.id} «${BUNCH_NAME}»${bunch.active ? "" : " (archived!)"}`);
else {
  log(`+ uom.uom «${BUNCH_NAME}» (a unit of its own, as «Units»)`);
  if (APPLY) { const [id] = await call("uom.uom", "create", { vals_list: [{ name: BUNCH_NAME, relative_factor: 1 }] }); rb.created.bunchUom = id; save(); bunch = { id, active: true }; log(`  → #${id}`); }
}
if (APPLY && !bunch?.active) { log(`✗ the unit «${BUNCH_NAME}» is archived: nothing created`); process.exit(1); }

// the batches. The LAST reference of each category goes in the first batch: a product somebody makes by
// hand meanwhile takes the number after it (Odoo's automation continues from the highest), never one of the plan's.
const lastOf = new Set(Object.values(catalog.prefixes).map((prefix) => todo.filter((r) => r.it.code.startsWith(prefix)).map((r) => r.it.code).sort().pop()).filter(Boolean));
const queue = [...todo.filter((r) => lastOf.has(r.it.code)), ...todo.filter((r) => !lastOf.has(r.it.code))];
/** After Odoo's automation: no alert for an item named here, «نشط للبيع» off, and the item's unit. */
async function finish(rows, idOf) {
  const ids = rows.map((r) => idOf(r));
  await call("product.template", "write", { ids, vals: { x_utak_new: false, x_is_active_for_sale: false } });
  for (const [unit, uom] of [["كيلو", KG_UOM], ["ربطة", bunch.id]]) {
    const of = rows.filter((r) => r.it.unit === unit).map((r) => idOf(r));
    if (of.length) { await pause(500); await call("product.template", "write", { ids: of, vals: { uom_id: uom } }); }
  }
}
if (APPLY && made.length) {
  // a run that stopped between a creation and its two writes: finished first
  const half = made.filter((r) => r.product.x_utak_new || r.product.x_is_active_for_sale || r.product.uom_id?.[0] !== { "كيلو": KG_UOM, "حبة": PIECE_UOM, "ربطة": bunch.id }[r.it.unit]);
  if (half.length) { log(`✎ ${half.length} item(s) created before and not finished: the flag, «نشط للبيع» off, the unit`); await finish(half, (r) => r.product.id); await pause(); }
}
for (let i = 0; i < queue.length; i += BATCH) {
  const rows = queue.slice(i, i + BATCH);
  log(`+ batch ${i / BATCH + 1}/${Math.ceil(queue.length / BATCH)}: ${rows.map((r) => `${r.it.code} «${r.it.name}» (${r.it.unit})`).join("، ")}`);
  if (!APPLY) continue;
  await pause();
  const taken = await call("product.template", "search_read", { domain: [["default_code", "in", rows.map((r) => r.it.code)]], fields: ["id", "name", "default_code"], context: ALL, limit: 50 });
  if (taken.length) { log(`✗ a reference of this batch was taken meanwhile: ${taken.map((p) => `${p.default_code} #${p.id} «${p.name}»`).join("، ")} — stopped; run again (the plan is read anew)`); process.exit(1); }
  await pause(600);
  const ids = await call("product.template", "create", { vals_list: rows.map((r) => ({ name: r.it.name, default_code: r.it.code, categ_id: CATEGORY[r.it.category], x_name_en: r.it.name_en, sale_ok: true, purchase_ok: true })) });
  rows.forEach((r, k) => { rb.created.products[r.it.code] = ids[k]; });
  save();
  await pause(500);
  await finish(rows, (r) => rb.created.products[r.it.code]);
  log(`  → #${ids[0]}–#${ids[ids.length - 1]}`);
}
if (APPLY && queue.length) rb.appliedAt = new Date().toISOString();
save();
log(APPLY ? `done: ${queue.length} created (${Object.keys(rb.created.products).length} in the rollback file) — then: --verify` : `dry-run: nothing written — ${todo.length} to create in ${Math.ceil(queue.length / BATCH)} batches`);
