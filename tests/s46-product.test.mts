// § 46 ب — a new product (2026-10-01): the Python Odoo runs when a product is created or its
// category set (scripts/lib/s46-odoo-code.mjs, run here in python3 against stub records) — the
// reference by the category, the taxes, the produce's defaults, the default packaging, «نشط للبيع»
// off — and Baraa's one alert with what is missing (src/product-setup.ts).
//
// In-memory Odoo + captured Graph (tests/wa-harness.mts, tests/s46-kit.mts). No network, no send.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs tests/s46-product.test.mts

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  COLL_PHONE, CUST, CUST_PHONE, OWNER, employee, graph, heldFor, odooLog, openWindow, partnerOf, quiet, reset, rows, seed, sentTo, setFail, setRiyadh, table, workSchedule,
} from "./wa-harness.mts";
import {
  AHMED, AHMED_PHONE, C1, C1_PHONE, DAY, DRIVER, DRIVER_PHONE, FIX, OMAR_EMP, assert, cost, dayOf, deliveredAt, done, dp, fourLines, fresh, lineFor, market, ownerTexts, rejected, setExtract,
} from "./s46-kit.mts";

const PSU = await import("../src/product-setup.ts");
// @ts-ignore — plain .mjs helper
const CODE = await import("../scripts/lib/s46-odoo-code.mjs");

// ================================================================ [ب] the Odoo Python (python3, stub records)
console.log("\n[ب] the on-create / on-category Python, run in python3 against stub records");
const D = { saleTax: 5, purchaseTax: 43, type: "consu", storable: true, uom: 1, purchaseMethod: "purchase", invoicePolicy: "order" };
const PY = `
import json, sys
codes = json.loads(sys.argv[1]); cases = json.loads(sys.argv[2])
class Cat:
    def __init__(s, name, parent=None): s.name = name; s.parent_id = parent
class Prod:
    def __init__(s, d, cats):
        s.id = d['id']; s.default_code = d.get('default_code') or False; s.type = d.get('type', 'consu'); s.active = d.get('active', True)
        s.categ_id = cats.get(d.get('categ')) or False
        s.x_is_active_for_sale = d.get('afs', False); s.written = {}
    def write(s, vals):
        s.written.update(vals)
        for k, v in vals.items(): setattr(s, k, v)
        return True
class Tmpl:
    def __init__(s, prods, ctx=None): s.prods = prods; s.ctx = ctx or {}
    def with_context(s, **kw): return Tmpl(s.prods, kw)
    def search(s, domain):
        f, op, val = domain[0]
        assert f == 'default_code' and op == '=like' and val.endswith('%')
        return [p for p in s.prods if (p.default_code or '').startswith(val[:-1]) and (p.active or s.ctx.get('active_test') is False)]
class Pack:
    def __init__(s, rows): s.rows = rows
    def search_count(s, domain): return len([r for r in s.rows if r['x_product_tmpl_id'] == domain[0][2]])
    def create(s, vals): s.rows.append(dict(vals)); return vals
out = []
for c in cases:
    cats = {}
    for name, parent in c.get('cats', []): cats[name] = Cat(name, cats.get(parent))
    prods = [Prod(d, cats) for d in c.get('existing', [])]
    rec = Prod(c['product'], cats); prods.append(rec)
    packs = Pack([{'x_product_tmpl_id': pid} for pid in c.get('packs', [])])
    env = {'product.template': Tmpl(prods), 'x_product_packaging': packs}
    for step in c['steps']:
        if step.startswith('categ:'): rec.categ_id = cats.get(step[6:]) or False
        elif step.startswith('code:'): rec.default_code = step[5:] or False
        else: exec(codes[step], {'env': env, 'records': [rec]})
    out.append({'code': rec.default_code or '', 'written': {k: (v if not isinstance(v, list) else [list(x) for x in v]) for k, v in rec.written.items()}, 'packs': [r for r in packs.rows if r.get('x_type')]})
print(json.dumps(out, ensure_ascii=False))
`;
const CATS = [["فواكه", null], ["خضار", null], ["ورقيات", null], ["Goods", null], ["حمضيات", "فواكه"]];
const EXISTING = [
  { id: 1, default_code: "UTAK-FRT-012" }, { id: 2, default_code: "UTAK-FRT-013" }, { id: 3, default_code: "UTAK-VEG-018" },
  { id: 4, default_code: "UTAK-LEAF-007" }, { id: 5, default_code: "UTAK-FRT-TEST" }, { id: 6, default_code: "UTAK-FRT-005" },
];
function py(cases: unknown[], codes: Record<string, string> = { create: CODE.onCreateCode(D), category: CODE.ON_CATEGORY_CODE }): any[] {
  return JSON.parse(execFileSync("python3", ["-c", PY, JSON.stringify(codes), JSON.stringify(cases)], { encoding: "utf8" }));
}
{
  const base = { cats: CATS, existing: EXISTING };
  const [fruit, veg, leaf, child, none, other, manual, service, sale, pur, archived, hasPack, active, later, laterManual, changed, gap] = py([
    { ...base, product: { id: 50, categ: "فواكه" }, steps: ["create"] },
    { ...base, product: { id: 51, categ: "خضار" }, steps: ["create"] },
    { ...base, product: { id: 52, categ: "ورقيات" }, steps: ["create"] },
    { ...base, product: { id: 53, categ: "حمضيات" }, steps: ["create"] },
    { ...base, product: { id: 54 }, steps: ["create"] },
    { ...base, product: { id: 55, categ: "Goods" }, steps: ["create"] },
    { ...base, product: { id: 56, categ: "فواكه", default_code: "MY-CODE-1" }, steps: ["create"] },
    { ...base, product: { id: 57, categ: "فواكه", type: "service" }, steps: ["create"] },
    { ...base, product: { id: 58, default_code: "UTAK-SALE-GOODS" }, steps: ["create"] },
    { ...base, product: { id: 59, default_code: "UTAK-PUR-GOODS" }, steps: ["create"] },
    { ...base, existing: [...EXISTING, { id: 7, default_code: "UTAK-FRT-020", active: false }], product: { id: 60, categ: "فواكه" }, steps: ["create"] },
    { ...base, packs: [61], product: { id: 61, categ: "فواكه" }, steps: ["create"] },
    { ...base, product: { id: 62, categ: "فواكه", afs: true }, steps: ["create"] },
    { ...base, product: { id: 63 }, steps: ["create", "categ:فواكه", "category"] },
    { ...base, product: { id: 64 }, steps: ["create", "code:BARAA-7", "categ:فواكه", "category"] },
    { ...base, product: { id: 65, categ: "فواكه" }, steps: ["create", "categ:خضار", "category"] },
    { ...base, existing: [{ id: 1, default_code: "UTAK-VEG-003" }, { id: 2, default_code: "UTAK-VEG-009" }], product: { id: 66, categ: "خضار" }, steps: ["create"] },
  ]);
  assert("فواكه → UTAK-FRT-014 (after 013; «UTAK-FRT-TEST» is not a number)", fruit.code === "UTAK-FRT-014", JSON.stringify(fruit));
  assert("خضار → UTAK-VEG-019, ورقيات → UTAK-LEAF-008", veg.code === "UTAK-VEG-019" && leaf.code === "UTAK-LEAF-008", `${veg.code} ${leaf.code}`);
  assert("a sub-category of فواكه («حمضيات») → UTAK-FRT-014 too", child.code === "UTAK-FRT-014", JSON.stringify(child));
  assert("no category → no reference; another category (Goods) → none", none.code === "" && other.code === "" && !("default_code" in none.written) && !("default_code" in other.written), JSON.stringify([none, other]));
  assert("a reference typed by hand is never changed", manual.code === "MY-CODE-1" && !("default_code" in manual.written), JSON.stringify(manual));
  assert("a service, UTAK-SALE… and UTAK-PUR… are left entirely alone (nothing written, no packaging)", [service, sale, pur].every((x: any) => Object.keys(x.written).length === 0 && x.packs.length === 0), JSON.stringify([service, sale, pur]));
  assert("the highest number counts even on an archived product: 020 → 021", archived.code === "UTAK-FRT-021", JSON.stringify(archived));
  assert("the series continues from the highest (009 → 010), it does not fill a gap", gap.code === "UTAK-VEG-010", JSON.stringify(gap));
  assert("on creation: sale tax #5 and purchase tax #43 «15% شامل (مشتريات)»", JSON.stringify(fruit.written.taxes_id) === "[[6,0,[5]]]" && JSON.stringify(fruit.written.supplier_taxes_id) === "[[6,0,[43]]]", JSON.stringify(fruit.written));
  assert("…the produce's type / storable / unit / purchase method / invoice policy", fruit.written.type === "consu" && fruit.written.is_storable === true && fruit.written.uom_id === 1 && fruit.written.purchase_method === "purchase" && fruit.written.invoice_policy === "order", JSON.stringify(fruit.written));
  assert("…«نشط للبيع» false ALWAYS (even created ticked), and the flag for Baraa's alert", fruit.written.x_is_active_for_sale === false && active.written.x_is_active_for_sale === false && fruit.written.x_utak_new === true, JSON.stringify(active.written));
  assert("…a default packaging «كرتون» 8 kg (the naming automation names it), once", fruit.packs.length === 1 && fruit.packs[0].x_type === "carton" && fruit.packs[0].x_approx_weight_kg === 8 && fruit.packs[0].x_is_default === true && fruit.packs[0].x_product_tmpl_id === 50 && !("x_name" in fruit.packs[0]), JSON.stringify(fruit.packs));
  assert("…no second packaging when the product already has one", hasPack.packs.length === 0, JSON.stringify(hasPack));
  assert("the supplier is never linked", !("seller_ids" in fruit.written) && !("x_supplier_ids" in fruit.written));
  assert("the category set later → the reference then (UTAK-FRT-014)", later.code === "UTAK-FRT-014", JSON.stringify(later));
  assert("…but never over a reference Baraa typed meanwhile", laterManual.code === "BARAA-7", JSON.stringify(laterManual));
  assert("a later change of category does not renumber", changed.code === "UTAK-FRT-014", JSON.stringify(changed));
  const [twice] = py([{ ...base, product: { id: 70, categ: "فواكه" }, steps: ["create", "create", "category"] }]);
  assert("the action run twice is idempotent: one reference, one packaging", twice.code === "UTAK-FRT-014" && twice.packs.length === 1, JSON.stringify(twice));
  assert("the lib's prefixes: فواكه / خضار / ورقيات → FRT / VEG / LEAF, 8 kg, the flag", JSON.stringify(CODE.REF_PREFIX) === JSON.stringify({ "فواكه": "UTAK-FRT-", "خضار": "UTAK-VEG-", "ورقيات": "UTAK-LEAF-" }) && CODE.TEMP_CARTON_KG === 8 && CODE.NEW_FLAG === "x_utak_new");
  assert("the worker and the Odoo code agree: the categories, the flag, the temporary weight", JSON.stringify(PSU.REF_CATEGORIES) === JSON.stringify(Object.keys(CODE.REF_PREFIX)) && PSU.NEW_FLAG === CODE.NEW_FLAG && PSU.TEMP_CARTON_KG === CODE.TEMP_CARTON_KG);
  const code = CODE.onCreateCode(D) + CODE.ON_CATEGORY_CODE;
  assert("nothing Odoo's sandbox refuses: no import, no def, no dunder", !/^\s*(import|from)\s/m.test(code) && !/\bdef\s/.test(code) && !/__/.test(code));
}

console.log("\n[ب] Baraa's one alert for a new product (the every-5-minutes tick)");
function newProduct(o: Record<string, unknown> = {}): number {
  seed("product.category", { id: 91, name: "فواكه", parent_id: false });
  seed("product.category", { id: 92, name: "Goods", parent_id: false });
  seed("product.category", { id: 93, name: "حمضيات", parent_id: 91 });
  const id = seed("product.template", { id: 113, name: "رمان مصري", default_code: false, categ_id: false, x_supplier_ids: [], x_is_active_for_sale: false, x_name_en: false, x_utak_new: true, create_date: "2026-10-03 06:00:00", ...o });
  seed("x_product_packaging", { id: 1131, x_name: "كرتون · 8 كيلو", x_product_tmpl_id: id, x_type: "carton", x_approx_weight_kg: 8, x_is_default: true, x_sequence: 10 });
  return id;
}
{
  const env = fresh(`${DAY} 09:05`); const id = newProduct();
  const early = await quiet(() => PSU.runProductSetupTick(env));
  assert("5 minutes after its creation: nothing yet (Baraa is still filling the card)", early.length === 1 && early[0].action === "waiting" && ownerTexts().length === 0 && table("product.template").get(id)!.x_utak_new === true, JSON.stringify(early));
  setRiyadh(`${DAY} 09:10`);
  const r = await quiet(() => PSU.runProductSetupTick(env));
  const texts = ownerTexts();
  assert("10 minutes: ONE alert to Baraa naming the product", r[0].action === "alerted" && texts.length === 1 && texts[0].startsWith("🆕 صنف جديد: رمان مصري (بلا رقم مرجعي)"), JSON.stringify(texts));
  assert("…listing what is missing: the category, the supplier, «نشط للبيع», the carton's temporary 8 kg, the English name",
    /• الفئة \(فواكه \/ خضار \/ ورقيات\): بلا فئة لا رقم مرجعي/.test(texts[0]) && /• المورد/.test(texts[0]) && /• «نشط للبيع»/.test(texts[0]) && /• وزن الكرتون \(القيمة المؤقتة 8 كجم\)/.test(texts[0]) && /• الاسم بالإنجليزي/.test(texts[0]), texts[0]);
  assert("…and the flag is cleared", table("product.template").get(id)!.x_utak_new === false);
  setRiyadh(`${DAY} 09:15`);
  const again = await quiet(() => PSU.runProductSetupTick(env));
  assert("the next ticks: nothing more (one alert per product)", again.length === 0 && ownerTexts().length === 1, JSON.stringify(again));
  assert("no Odoo field or value outside the schema", rejected.length === 0, rejected.join(" | "));
}
{
  const env = fresh(`${DAY} 09:10`);
  const id = newProduct({ default_code: "UTAK-FRT-014", categ_id: 93, x_supplier_ids: [AHMED], x_name_en: "Egyptian Pomegranate" });
  table("x_product_packaging").get(1131)!.x_approx_weight_kg = 6;
  const r = await quiet(() => PSU.runProductSetupTick(env));
  const t = ownerTexts()[0] ?? "";
  assert("completed but for «نشط للبيع»: the alert lists that alone, with the reference", r[0].action === "alerted" && t.startsWith("🆕 صنف جديد: رمان مصري [UTAK-FRT-014]") && /• «نشط للبيع»/.test(t) && !/الفئة|المورد|وزن الكرتون|الاسم بالإنجليزي/.test(t.split("الناقص:")[1]), t);
  assert("a sub-category of فواكه counts as the category", JSON.stringify(r[0].missing) === JSON.stringify(["«نشط للبيع»"]), JSON.stringify(r[0]));
  table("product.template").get(id)!.x_utak_new = true;
  const dup = await quiet(() => PSU.runProductSetupTick(env));
  assert("the flag written back by a lost write: no second alert, the flag cleared", dup[0].action === "claimed_before" && ownerTexts().length === 1 && table("product.template").get(id)!.x_utak_new === false, JSON.stringify(dup));
}
{
  const env = fresh(`${DAY} 09:10`);
  const id = newProduct({ default_code: "UTAK-FRT-014", categ_id: 91, x_supplier_ids: [AHMED], x_name_en: "Egyptian Pomegranate", x_is_active_for_sale: true });
  table("x_product_packaging").get(1131)!.x_approx_weight_kg = 6;
  const r = await quiet(() => PSU.runProductSetupTick(env));
  assert("nothing missing: no alert, the flag cleared", r[0].action === "complete" && ownerTexts().length === 0 && table("product.template").get(id)!.x_utak_new === false, JSON.stringify(r));
  const old = seed("product.template", { id: 71, name: "طماطم قديمة", default_code: "UTAK-VEG-001", x_utak_new: false, create_date: "2026-09-01 00:00:00" });
  const none = await quiet(() => PSU.runProductSetupTick(env));
  assert("an existing product (flag off) is never alerted", none.length === 0 && table("product.template").get(old)!.x_utak_new === false);
  const m = PSU.missingOnProduct({ id: 1, name: "x", default_code: "UTAK-VEG-020", categ_id: [92, "Goods"], x_supplier_ids: [1], x_is_active_for_sale: true, x_name_en: "x", create_date: "" }, [{ x_product_tmpl_id: [1, "x"], x_type: "bag", x_approx_weight_kg: 8, x_is_default: true }], new Map([[92, { id: 92, name: "Goods", parent_id: false as const }]]));
  const viaParent = PSU.isRefCategory(93, new Map([[91, { id: 91, name: "فواكه", parent_id: false as const }], [93, { id: 93, name: "حمضيات", parent_id: [91, "فواكه"] as [number, string] }]]));
  assert("a category whose PARENT is فواكه (Odoo's [id, name] pair) gives the reference too", viaParent === true);
  assert("another category is «الفئة» missing (a typed reference: no «بلا رقم» tail); 8 kg on a non-carton is not the temporary weight", JSON.stringify(m) === JSON.stringify(["الفئة (فواكه / خضار / ورقيات)"]), JSON.stringify(m));
}

// ================================================================ [س]
console.log("\n[س] schema");
assert("no Odoo field or value outside the schema in the whole run", rejected.length === 0, rejected.join(" | "));
{
  const f = FIX[FIX.length - 1];
  assert("the § 46 fixture names product.template.x_utak_new", f["product.template"].includes("x_utak_new"));
  const idx = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const tick = idx.split('case "*/5 * * * *": {')[1].split('case "2,7,12,17,22,27,32,37,42,47,52,57 * * * *"')[0];
  assert("*/5: runProductSetupTick under its own send job (product_setup)", /const ps = await runProductSetupTick\(withAutoSendJob\(rawEnv, PRODUCT_SETUP_JOB\), Date\.now\(\)\);/.test(tick) && PSU.PRODUCT_SETUP_JOB === "product_setup");
}

done();
