// Apply — 2026-09-19 fruit prices (رمان، موز، أفوكادو، بطيخ) via JSON-2.
//
// Pre-conditions verified by prices-20260919-scan.mjs:
//   • x_daily_price.x_sale_price is a plain float (store=true, readonly=false,
//     compute=-) — writing sale prices directly bypasses the Worker's
//     cost×1.15×1.20 formula, which is what the user's fixed table wants.
//   • Templates already exist: رمان=100, موز=97, بطيخ=104, افوكادو=105.
//   • x_product_packaging default_id per template: رمان=37 (8kg), موز=33 (13kg).
//     بطيخ has حبة (id=41,6.5kg default) + كرتون (id=42,10kg) but no per-kilo pack.
//   • res.partner "أحمد حسان" = id 30 (single match).
//   • Highest UTAK-FRT-XXX SKU = 010 → new ones take 011,012,013.
//
// This script:
//   1. Snapshots every row it will touch into
//        scripts/artifacts/prices-20260919-rollback.json
//      (BEFORE part; the AFTER part is appended after writes so rollback
//      knows which brand-new ids to delete).
//   2. Renames product.template 100 (رمان → رمان وسط) and 97 (موز → موز أمريكي).
//   3. Creates 3 new templates: رمان صغير, رمان كبير, موز هندي.
//   4. Adjusts / creates packagings.
//   5. Creates 7 x_daily_price rows (dated 2026-09-19, supplier=30).
//   6. Writes the AFTER section of rollback JSON.
//
// Nothing else in Odoo is touched: no taxes, no crons, no WA messages.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = res.headers.get("set-cookie")?.match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const url = `${ODOO_URL}/json/2/${model}/${method}`;
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  if (auth.mode === "session") headers["Cookie"] = auth.cookie;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const ROLLBACK_PATH = new URL("./artifacts/prices-20260919-rollback.json", import.meta.url).pathname;
const TODAY = "2026-09-19";
const SUPPLIER_ID = 30; // أحمد حسان

const KNOWN = {
  ROMAN_TMPL: 100,       // رمان → رمان وسط
  ROMAN_PKG:  37,        // كرتون رمان (default, 8kg → will be zeroed)
  BANANA_TMPL: 97,       // موز → موز أمريكي
  BANANA_PKG: 33,        // كرتون موز (default, 13kg → 14)
  AVOCADO_TMPL: 105,     // افوكادو (no rename)
  WATERMELON_TMPL: 104,  // بطيخ (no rename)
};

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

async function main() {
  const stamp = new Date().toISOString();
  console.log(`Apply — ${stamp}`);
  console.log(`Odoo: ${ODOO_URL} db=${ODOO_DB}`);

  if (existsSync(ROLLBACK_PATH)) {
    console.log(`Rollback JSON already exists at ${ROLLBACK_PATH} — refusing to overwrite. Delete it or move it aside first.`);
    process.exit(2);
  }

  // ---------- BEFORE snapshot ----------
  const before = { generated_at: stamp, today: TODAY, supplier_id: SUPPLIER_ID };

  const tmplIdsToSnap = [
    KNOWN.ROMAN_TMPL, KNOWN.BANANA_TMPL,
    KNOWN.AVOCADO_TMPL, KNOWN.WATERMELON_TMPL,
  ];
  before.product_templates = await call("product.template", "read", {
    ids: tmplIdsToSnap,
    fields: ["id", "name", "default_code", "categ_id", "uom_id", "list_price", "sale_ok", "purchase_ok", "taxes_id", "supplier_taxes_id", "active"],
  });
  const pkgIdsToSnap = [KNOWN.ROMAN_PKG, KNOWN.BANANA_PKG];
  before.packagings = await call("x_product_packaging", "read", {
    ids: pkgIdsToSnap,
    fields: ["id", "x_name", "x_product_tmpl_id", "x_is_default", "x_approx_weight_kg", "x_sequence"],
  });
  before.watermelon_packagings = await call("x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "=", KNOWN.WATERMELON_TMPL]],
    fields: ["id", "x_name", "x_is_default", "x_approx_weight_kg"],
  });

  writeJson(ROLLBACK_PATH, { before, after: null });
  console.log(`\nBEFORE snapshot written to ${ROLLBACK_PATH}`);
  console.log(`   templates snapped: ${before.product_templates.map((t) => `${t.id}:${t.name}`).join(", ")}`);
  console.log(`   packagings snapped: ${before.packagings.map((p) => `${p.id}:${p.x_name}(${p.x_approx_weight_kg}kg)`).join(", ")}`);
  console.log(`   watermelon packagings: ${before.watermelon_packagings.map((p) => `${p.id}:${p.x_name}(${p.x_approx_weight_kg}kg)`).join(", ")}`);

  const after = {
    renamed_templates: [], // {id, old_name, new_name}
    created_templates: [], // {id, name, default_code}
    updated_packagings: [], // {id, old_weight, new_weight}
    created_packagings: [], // {id, x_name, x_product_tmpl_id, x_approx_weight_kg}
    created_daily_prices: [], // {id, x_product_tmpl_id, x_packaging_id, x_price_sar, x_sale_price}
  };

  // ---------- 2. Renames ----------
  await call("product.template", "write", { ids: [KNOWN.ROMAN_TMPL], vals: { name: "رمان وسط" } });
  after.renamed_templates.push({ id: KNOWN.ROMAN_TMPL, old_name: "رمان", new_name: "رمان وسط" });
  console.log(`[2] renamed product.template ${KNOWN.ROMAN_TMPL}: "رمان" → "رمان وسط"`);

  await call("product.template", "write", { ids: [KNOWN.BANANA_TMPL], vals: { name: "موز أمريكي" } });
  after.renamed_templates.push({ id: KNOWN.BANANA_TMPL, old_name: "موز", new_name: "موز أمريكي" });
  console.log(`[2] renamed product.template ${KNOWN.BANANA_TMPL}: "موز" → "موز أمريكي"`);

  // ---------- 3. Create new templates ----------
  // Fields per user's spec: same fruit categ (currently false on this tenant),
  // sale_ok=true, purchase_ok=true, taxes_id + supplier_taxes_id empty, uom=Units,
  // list_price=0, default_code continues UTAK-FRT-XXX.
  const newTemplateSpecs = [
    { name: "رمان صغير",  default_code: "UTAK-FRT-011" },
    { name: "رمان كبير",  default_code: "UTAK-FRT-012" },
    { name: "موز هندي",   default_code: "UTAK-FRT-013" },
  ];
  for (const spec of newTemplateSpecs) {
    const created = await call("product.template", "create", {
      vals_list: [{
        name: spec.name,
        default_code: spec.default_code,
        uom_id: 1,                    // Units (same as existing fruit rows)
        list_price: 0,
        sale_ok: true,
        purchase_ok: true,
        taxes_id: [[6, 0, []]],
        supplier_taxes_id: [[6, 0, []]],
      }],
    });
    const newId = created[0];
    after.created_templates.push({ id: newId, name: spec.name, default_code: spec.default_code });
    console.log(`[3] created product.template id=${newId}  name=${JSON.stringify(spec.name)}  code=${spec.default_code}`);
  }

  const NEW_TMPL = Object.fromEntries(after.created_templates.map((t) => [t.name, t.id]));

  // ---------- 4. Packagings ----------
  // 4a. Update موز أمريكي كرتون: 13 → 14
  const bananaPkgBefore = before.packagings.find((p) => p.id === KNOWN.BANANA_PKG);
  await call("x_product_packaging", "write", {
    ids: [KNOWN.BANANA_PKG],
    vals: { x_approx_weight_kg: 14 },
  });
  after.updated_packagings.push({
    id: KNOWN.BANANA_PKG,
    field: "x_approx_weight_kg",
    old: bananaPkgBefore?.x_approx_weight_kg,
    new: 14,
  });
  console.log(`[4a] updated packaging ${KNOWN.BANANA_PKG} (كرتون موز أمريكي): weight ${bananaPkgBefore?.x_approx_weight_kg} → 14`);

  // 4b. Zero the weight on رمان وسط كرتون (id=37). The user asked for "بدون وزن"
  //     for all three pomegranate sizes; on a float field Odoo persists 0.0
  //     rather than a true null, so we use 0.
  const romanPkgBefore = before.packagings.find((p) => p.id === KNOWN.ROMAN_PKG);
  await call("x_product_packaging", "write", {
    ids: [KNOWN.ROMAN_PKG],
    vals: { x_approx_weight_kg: 0 },
  });
  after.updated_packagings.push({
    id: KNOWN.ROMAN_PKG,
    field: "x_approx_weight_kg",
    old: romanPkgBefore?.x_approx_weight_kg,
    new: 0,
  });
  console.log(`[4b] updated packaging ${KNOWN.ROMAN_PKG} (كرتون رمان وسط): weight ${romanPkgBefore?.x_approx_weight_kg} → 0 (بدون وزن)`);

  // 4c. Create packagings for the 3 new templates + watermelon-كيلو.
  const packagingsToCreate = [
    { name: "كرتون", tmpl_id: NEW_TMPL["رمان صغير"], weight: 0, is_default: true },
    { name: "كرتون", tmpl_id: NEW_TMPL["رمان كبير"], weight: 0, is_default: true },
    { name: "كرتون", tmpl_id: NEW_TMPL["موز هندي"], weight: 13, is_default: true },
    { name: "كيلو",  tmpl_id: KNOWN.WATERMELON_TMPL, weight: 1, is_default: false },
  ];
  for (const p of packagingsToCreate) {
    const created = await call("x_product_packaging", "create", {
      vals_list: [{
        x_name: p.name,
        x_product_tmpl_id: p.tmpl_id,
        x_approx_weight_kg: p.weight,
        x_is_default: p.is_default,
      }],
    });
    const newId = created[0];
    after.created_packagings.push({
      id: newId,
      x_name: p.name,
      x_product_tmpl_id: p.tmpl_id,
      x_approx_weight_kg: p.weight,
      x_is_default: p.is_default,
    });
    console.log(`[4c] created packaging id=${newId}  tmpl=${p.tmpl_id}  name=${JSON.stringify(p.name)}  weight=${p.weight}  default=${p.is_default}`);
  }

  const PKG = {
    "رمان صغير":  after.created_packagings.find((p) => p.x_product_tmpl_id === NEW_TMPL["رمان صغير"]).id,
    "رمان وسط":   KNOWN.ROMAN_PKG,
    "رمان كبير":  after.created_packagings.find((p) => p.x_product_tmpl_id === NEW_TMPL["رمان كبير"]).id,
    "موز أمريكي": KNOWN.BANANA_PKG,
    "موز هندي":   after.created_packagings.find((p) => p.x_product_tmpl_id === NEW_TMPL["موز هندي"]).id,
    "أفوكادو":    null, // fill from watermelon-adjacent search below
    "بطيخ_كيلو":  after.created_packagings.find((p) => p.x_product_tmpl_id === KNOWN.WATERMELON_TMPL && p.x_name === "كيلو").id,
  };

  // Avocado has no packaging yet on this tenant — create كرتون(4kg) per the user's spec.
  const avoPkgProbe = await call("x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "=", KNOWN.AVOCADO_TMPL]],
    fields: ["id", "x_name", "x_approx_weight_kg", "x_is_default"],
  });
  before.avocado_packagings = avoPkgProbe;
  if (avoPkgProbe.length === 0) {
    const created = await call("x_product_packaging", "create", {
      vals_list: [{
        x_name: "كرتون",
        x_product_tmpl_id: KNOWN.AVOCADO_TMPL,
        x_approx_weight_kg: 4,
        x_is_default: true,
      }],
    });
    const avoPkgId = created[0];
    after.created_packagings.push({
      id: avoPkgId,
      x_name: "كرتون",
      x_product_tmpl_id: KNOWN.AVOCADO_TMPL,
      x_approx_weight_kg: 4,
      x_is_default: true,
    });
    PKG["أفوكادو"] = avoPkgId;
    console.log(`[4d] created packaging id=${avoPkgId}  tmpl=${KNOWN.AVOCADO_TMPL} (افوكادو)  name="كرتون"  weight=4  default=true`);
  } else {
    // Reuse the default one if present, else the first one.
    const chosen = avoPkgProbe.find((p) => p.x_is_default) ?? avoPkgProbe[0];
    PKG["أفوكادو"] = chosen.id;
    console.log(`[4d] reusing existing avocado packaging id=${chosen.id}  name=${JSON.stringify(chosen.x_name)}  weight=${chosen.x_approx_weight_kg}`);
  }

  // ---------- 5. Daily prices ----------
  const rawReply = "إدخال يدوي 2026-09-19 — أسعار رمان (صغير/وسط/كبير)، موز (أمريكي/هندي)، أفوكادو، بطيخ (كيلو).";
  const priceRows = [
    { label: "رمان صغير",  tmpl: NEW_TMPL["رمان صغير"], pkg: PKG["رمان صغير"],  cost: 9,    sale: 11.50 },
    { label: "رمان وسط",   tmpl: KNOWN.ROMAN_TMPL,       pkg: PKG["رمان وسط"],   cost: 13,   sale: 18.00 },
    { label: "رمان كبير",  tmpl: NEW_TMPL["رمان كبير"],  pkg: PKG["رمان كبير"],  cost: 22,   sale: 30.50 },
    { label: "موز أمريكي", tmpl: KNOWN.BANANA_TMPL,      pkg: PKG["موز أمريكي"], cost: 44,   sale: 61.00 },
    { label: "موز هندي",   tmpl: NEW_TMPL["موز هندي"],   pkg: PKG["موز هندي"],   cost: 45,   sale: 62.50 },
    { label: "أفوكادو",    tmpl: KNOWN.AVOCADO_TMPL,     pkg: PKG["أفوكادو"],    cost: 45,   sale: 62.50 },
    { label: "بطيخ (كيلو)", tmpl: KNOWN.WATERMELON_TMPL, pkg: PKG["بطيخ_كيلو"],  cost: 0.60, sale: 0.85 },
  ];
  for (const r of priceRows) {
    if (!r.pkg) throw new Error(`missing packaging for ${r.label}`);
    const created = await call("x_daily_price", "create", {
      vals_list: [{
        x_supplier_id: SUPPLIER_ID,
        x_product_tmpl_id: r.tmpl,
        x_packaging_id: r.pkg,
        x_date: TODAY,
        x_price_sar: r.cost,
        x_sale_price: r.sale,
        x_extraction_status: "extracted",
        x_source_message_id: `MANUAL:${TODAY}`,
        x_raw_reply: rawReply,
        x_is_simulation: false,
      }],
    });
    const newId = created[0];
    after.created_daily_prices.push({
      id: newId, label: r.label,
      x_product_tmpl_id: r.tmpl, x_packaging_id: r.pkg,
      x_price_sar: r.cost, x_sale_price: r.sale,
    });
    console.log(`[5] x_daily_price id=${newId}  ${r.label.padEnd(14)}  cost=${r.cost}  sale=${r.sale}`);
  }

  // ---------- Persist AFTER ----------
  writeJson(ROLLBACK_PATH, { before, after });
  console.log(`\nRollback JSON updated with AFTER section: ${ROLLBACK_PATH}`);
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
