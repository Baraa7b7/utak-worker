// § 46 ب (2026-10-01) — a new product: Baraa's one alert.
//
// Odoo prepares a product the moment it is created (base.automation on
// product.template, scripts/lib/s46-odoo-code.mjs): its reference by its
// category (فواكه → UTAK-FRT-###, خضار → UTAK-VEG-###, ورقيات → UTAK-LEAF-###),
// the sale and purchase taxes, the type / unit / purchase method of the
// existing produce, a default packaging «كرتون» (8 kg, temporary), «نشط للبيع»
// off — and the flag x_utak_new. Nothing links a supplier.
//
// The every-5-minutes tick reads the flagged products: ALERT_AFTER_MIN minutes
// after its creation (Baraa is usually still filling the card) each gets ONE
// alert listing what is still missing — the category, the supplier, «نشط
// للبيع», the carton's weight while it is the temporary 8 kg, the English name
// — and the flag is cleared. Nothing missing: no alert, the flag is cleared.

import type { Env } from "./config";
import { call } from "./odoo";
import { claimButton, finishButton, releaseButton } from "./button-lock";

export const NEW_FLAG = "x_utak_new";
/** The categories that give a reference (the category itself or one of its parents). */
export const REF_CATEGORIES = ["فواكه", "خضار", "ورقيات"];
export const TEMP_CARTON_KG = 8;
export const ALERT_AFTER_MIN = 10;
export const PRODUCT_SETUP_JOB = "product_setup";

type M2O = [number, string] | number | false;
const m2oId = (v: M2O | undefined): number => (Array.isArray(v) ? v[0] : typeof v === "number" ? v : 0);
interface NewProduct {
  id: number;
  name: string;
  default_code: string | false;
  categ_id: M2O;
  x_supplier_ids: number[];
  x_is_active_for_sale: boolean;
  x_name_en: string | false;
  create_date: string;
}
interface Packaging { x_product_tmpl_id: M2O; x_type: string | false; x_approx_weight_kg: number | false; x_is_default: boolean }
interface Category { id: number; name: string; parent_id: M2O }

/** Is the category (or a parent) one that gives a reference? */
export function isRefCategory(categId: number, cats: Map<number, Category>): boolean {
  for (let c = cats.get(categId), hops = 0; c && hops < 20; c = cats.get(m2oId(c.parent_id)), hops++) {
    if (REF_CATEGORIES.includes(String(c.name ?? "").trim())) return true;
  }
  return false;
}

/** What Baraa still has to complete on a new product. Pure. */
export function missingOnProduct(p: NewProduct, packs: Packaging[], cats: Map<number, Category>): string[] {
  const out: string[] = [];
  const categ = m2oId(p.categ_id);
  if (!categ || !isRefCategory(categ, cats)) {
    out.push(`الفئة (${REF_CATEGORIES.join(" / ")})${p.default_code ? "" : ": بلا فئة لا رقم مرجعي"}`);
  }
  if (!(p.x_supplier_ids ?? []).length) out.push("المورد");
  if (p.x_is_active_for_sale !== true) out.push("«نشط للبيع»");
  const def = packs.find((k) => k.x_is_default) ?? packs[0];
  if (!def) out.push("التعبئة (لا تعبئة للصنف)");
  else if (def.x_type === "carton" && Number(def.x_approx_weight_kg) === TEMP_CARTON_KG) out.push(`وزن الكرتون (القيمة المؤقتة ${TEMP_CARTON_KG} كجم)`);
  if (!String(p.x_name_en || "").trim()) out.push("الاسم بالإنجليزي");
  return out;
}

export function newProductAlert(p: NewProduct, missing: string[]): string {
  return [
    `🆕 صنف جديد: ${p.name}${p.default_code ? ` [${p.default_code}]` : " (بلا رقم مرجعي)"}`,
    `جُهّز تلقائياً: الضرائب، والتعبئة الافتراضية «كرتون»، وهو غير نشط للبيع.`,
    `الناقص:`,
    ...missing.map((m) => `• ${m}`),
  ].join("\n");
}

export interface ProductSetupTick { productId: number; action: "alerted" | "complete" | "waiting" | "claimed_before" | "error"; missing?: string[]; detail?: string }

/** The tick: one alert per flagged product, ALERT_AFTER_MIN minutes after its creation. */
export async function runProductSetupTick(env: Env, now: number = Date.now()): Promise<ProductSetupTick[]> {
  const products = await call<NewProduct[]>(env, "product.template", "search_read", {
    domain: [[NEW_FLAG, "=", true]],
    fields: ["id", "name", "default_code", "categ_id", "x_supplier_ids", "x_is_active_for_sale", "x_name_en", "create_date"],
    order: "id asc", limit: 50,
  });
  if (!products.length) return [];
  const out: ProductSetupTick[] = [];
  const due = products.filter((p) => {
    const created = Date.parse(String(p.create_date).replace(" ", "T") + "Z");
    const ok = Number.isFinite(created) && now - created >= ALERT_AFTER_MIN * 60_000;
    if (!ok) out.push({ productId: p.id, action: "waiting" });
    return ok;
  });
  if (!due.length) return out;
  const packs = await call<Packaging[]>(env, "x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "in", due.map((p) => p.id)]], fields: ["x_product_tmpl_id", "x_type", "x_approx_weight_kg", "x_is_default"], order: "x_sequence asc, id asc", limit: 500,
  });
  const cats = new Map((await call<Category[]>(env, "product.category", "search_read", { domain: [], fields: ["id", "name", "parent_id"], limit: 500 })).map((c) => [c.id, c]));
  for (const p of due) {
    const claim = await claimButton(env, `prod_new_alert:${p.id}`, 30 * 24 * 3600);
    if (!claim.claimed) {
      // alerted before and the flag write was lost: clear it now
      await call(env, "product.template", "write", { ids: [p.id], vals: { [NEW_FLAG]: false } }).catch(() => {});
      out.push({ productId: p.id, action: "claimed_before" });
      continue;
    }
    let missing: string[];
    try {
      missing = missingOnProduct(p, packs.filter((k) => m2oId(k.x_product_tmpl_id) === p.id), cats);
      if (missing.length) {
        const { sendOwnerAlert } = await import("./templates");
        await sendOwnerAlert(env, newProductAlert(p, missing));
      }
    } catch (e) {
      await releaseButton(env, claim);
      out.push({ productId: p.id, action: "error", detail: (e as Error)?.message ?? String(e) });
      continue;
    }
    // the alert is out (sent, or held for his window): the claim stays, so a lost flag write never alerts twice
    await finishButton(env, claim, 30 * 24 * 3600);
    await call(env, "product.template", "write", { ids: [p.id], vals: { [NEW_FLAG]: false } })
      .catch((e) => console.warn(`[product-setup] ${p.id}: the flag was not cleared — the next tick clears it`, (e as Error)?.message));
    out.push({ productId: p.id, action: missing.length ? "alerted" : "complete", missing });
  }
  return out;
}
