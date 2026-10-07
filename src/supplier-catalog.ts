// § 65 (2026-10-07) — an item a supplier TYPED, against the catalog (docs/catalog/produce-catalog.json,
// § 63: 275 items with their codes, names and synonyms — the synonyms live in the file alone).
//
//   • normName: a name as it is compared — the rule of scripts/s63-20261007-catalog.mjs, letter for
//     letter (no note in brackets, no tashkeel, one hamza, «ة / ه / ا» at a word's end alike, no «ال»).
//   • matchCatalog: the catalog item whose name or synonym is the typed text, compared so. Nothing
//     is guessed: a text that is no item's name stays a text («غير مطابق يبقى نصاً»).
//   • resolveItems: the Odoo products of the matched codes (one read), and what stayed a text.
//   • unlinkedItem: the archived product «صنف من مورد (غير مربوط)» and its packaging — what an offer
//     of an unmatched item hangs on (x_price_offer's product and packaging are required) until Baraa
//     links it. KV keeps its two ids.

import type { Env } from "./config";
import { call } from "./odoo";
import CATALOG from "../docs/catalog/produce-catalog.json" with { type: "json" };

export const UNLINKED_CODE = "UTAK-UNLINKED";
const UNLINKED_KV = "sup_unlinked:v1";
const UNLINKED_TTL = 24 * 60 * 60;

interface CatalogItem { code: string; name: string; synonyms?: string[] }
const ITEMS: CatalogItem[] = (CATALOG as { items: CatalogItem[] }).items;

const TASHKEEL = /[ً-ٰٟـ]/g;
/** A name's words as they are compared (scripts/s63-20261007-catalog.mjs `tokens`). */
export function nameTokens(s: string): string[] {
  return String(s ?? "").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\([^)]*\)/g, " ").replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "").replace(/ى/g, "ي")
    .split(/\s+/).filter(Boolean).map((w) => w.replace(/^ال(?=.{2,})/, "").replace(/[ةها]$/, "ه"));
}
export const normName = (s: string): string => nameTokens(s).join(" ");

let index: Map<string, string> | null = null;
/** normalized name or synonym → the item's code (a name wins over another item's synonym). */
function catalogIndex(): Map<string, string> {
  if (index) return index;
  const m = new Map<string, string>();
  for (const it of ITEMS) for (const s of it.synonyms ?? []) { const k = normName(s); if (k && !m.has(k)) m.set(k, it.code); }
  for (const it of ITEMS) { const k = normName(it.name); if (k) m.set(k, it.code); }
  index = m;
  return m;
}
/** The catalog item a typed text names, else null. */
export function matchCatalog(text: string): { code: string; name: string } | null {
  const code = catalogIndex().get(normName(text));
  if (!code) return null;
  return { code, name: ITEMS.find((i) => i.code === code)?.name ?? "" };
}

/** «طماطم، خيار ؛ موز\nبصل» → the names, each once, in order (at most `max`). */
export function splitItems(text: string, max = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(text ?? "").split(/[،,;؛\n\/|+]+| و(?=\s)/)) {
    const name = raw.replace(/[‎‏⁦-⁩‪-‮]/g, "").replace(/^[\s\-–•*.\d)]+/, "").replace(/\s+/g, " ").trim().slice(0, 60);
    const key = normName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

export interface ResolvedItems {
  /** The typed names the catalog matched, with their Odoo product. */
  matched: Array<{ text: string; code: string; name: string; productId: number }>;
  /** The typed names that stayed a text: no catalog item, or its product is not in Odoo. */
  unmatched: string[];
}
/** The Odoo products of the typed names (one read of the matched codes). Throws on Odoo trouble. */
export async function resolveItems(env: Env, names: string[]): Promise<ResolvedItems> {
  const hits = names.map((text) => ({ text, hit: matchCatalog(text) }));
  const codes = [...new Set(hits.map((h) => h.hit?.code).filter((c): c is string => !!c))];
  const rows = codes.length ? await call<Array<{ id: number; default_code: string | false }>>(env, "product.template", "search_read", {
    domain: [["default_code", "in", codes]], fields: ["id", "default_code"], limit: 400,
  }) : [];
  const idOf = new Map(rows.map((r) => [String(r.default_code || ""), r.id]));
  const out: ResolvedItems = { matched: [], unmatched: [] };
  for (const h of hits) {
    const id = h.hit ? idOf.get(h.hit.code) : undefined;
    if (h.hit && id) { if (!out.matched.some((m) => m.productId === id)) out.matched.push({ text: h.text, code: h.hit.code, name: h.hit.name, productId: id }); }
    else out.unmatched.push(h.text);
  }
  return out;
}

export interface OfferItemRef { productId: number; packagingId: number }
/** The archived product an unmatched item hangs on, and its packaging. Throws when it is not in Odoo. */
export async function unlinkedItem(env: Env): Promise<OfferItemRef> {
  try {
    const kept = JSON.parse((await env.MSG_DEDUP.get(UNLINKED_KV)) || "null") as OfferItemRef | null;
    if (kept && kept.productId > 0 && kept.packagingId > 0) return kept;
  } catch { /* read Odoo */ }
  const [p] = await call<Array<{ id: number }>>(env, "product.template", "search_read", { domain: [["default_code", "=", UNLINKED_CODE]], fields: ["id"], limit: 1, context: { active_test: false } });
  if (!p) throw new Error("the unlinked item is not in Odoo (scripts/s65-20261007-odoo.mjs)");
  const [k] = await call<Array<{ id: number }>>(env, "x_product_packaging", "search_read", { domain: [["x_product_tmpl_id", "=", p.id]], fields: ["id"], order: "id asc", limit: 1 });
  if (!k) throw new Error("the unlinked item has no packaging in Odoo");
  const ref = { productId: p.id, packagingId: k.id };
  try { await env.MSG_DEDUP.put(UNLINKED_KV, JSON.stringify(ref), { expirationTtl: UNLINKED_TTL }); } catch { /* read again next time */ }
  return ref;
}

/** A product's packaging for an offer's row: its default one, else its first; 0 = it has none. */
export async function defaultPackaging(env: Env, productId: number): Promise<number> {
  const [k] = await call<Array<{ id: number }>>(env, "x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "=", productId]], fields: ["id"], order: "x_is_default desc, id asc", limit: 1,
  });
  return k?.id ?? 0;
}

/**
 * The product and the packaging an offer's row of a TYPED item carries: the catalog's product with its
 * packaging, else the unlinked item (`linked` false: Baraa is told «🆕 صنف من مورد»).
 */
export async function itemRefFor(env: Env, text: string): Promise<OfferItemRef & { linked: boolean; name: string }> {
  const r = await resolveItems(env, [text]).catch(() => ({ matched: [], unmatched: [text] } as ResolvedItems));
  const m = r.matched[0];
  if (m) {
    const pack = await defaultPackaging(env, m.productId).catch(() => 0);
    if (pack) return { productId: m.productId, packagingId: pack, linked: true, name: m.name };
  }
  return { ...(await unlinkedItem(env)), linked: false, name: text };
}
