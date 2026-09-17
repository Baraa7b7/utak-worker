// TEMPORARY (item 1, tonight 2026-09-17) — dry-run of the 02:00 supplier-ask
// cron. Mirrors src/suppliers.ts::askAllSuppliersForPrices step-for-step but
// NEVER calls sendTemplate, NEVER creates x_supplier_price_request_log rows.
// Instead returns a per-supplier report describing what would happen.
//
// Included in the "would_block" reason: SIM_ALLOWLIST match, owner-guard,
// missing/pending template.
//
// This file MUST be removed as part of the item 1 cleanup — see the tonight
// spec and merge-debt.md. The route that reaches it is /admin/dry-run-supplier-ask
// (header-only X-Admin-Token auth) in src/index.ts.

import type { Env } from "./config";
import { isRecipientAllowed, parseAllowlist, TMPL_SUPPLIER_ASK } from "./config";
import {
  call,
  fetchSupplierCatalog,
  getActiveSuppliersForAsk,
  getTemplateByPurpose,
} from "./odoo";

const isTemplateApproved = (metaId: string | undefined | null): boolean =>
  !!metaId && typeof metaId === "string" && !metaId.startsWith("PENDING_");

type BlockReason =
  | null
  | "owner_guard"
  | "not_in_allowlist"
  | "no_active_products"
  | "no_supplied_products"
  | "no_whatsapp_number";

export interface DryRunSupplierEntry {
  supplier_id: number;
  supplier_name: string;
  whatsapp_number: string | null;
  supplied_product_ids: number[];
  active_product_names: string[];
  active_product_names_count: number;
  product_list_param: string;
  would_send: boolean;
  block_reason: BlockReason;
  block_detail?: string;
}

export interface DryRunReport {
  now_utc: string;
  template: {
    purpose: string;
    meta_template_id: string | null;
    language: string | null;
    approved: boolean;
    registered: boolean;
  };
  allowlist: {
    set: boolean;
    entries: number;
    entries_masked: string[];
  };
  owner_whatsapp: string | null;
  suppliers_total: number;
  suppliers_would_send: number;
  suppliers_blocked: number;
  entries: DryRunSupplierEntry[];
}

function ownerDigits(env: Env): string {
  return String(env.OWNER_WHATSAPP ?? "").replace(/[^0-9]/g, "");
}

function toDigits(to: string): string {
  return String(to ?? "").replace(/[^0-9]/g, "");
}

export async function runDryRunSupplierAsk(env: Env): Promise<DryRunReport> {
  const suppliers = await getActiveSuppliersForAsk(env);
  const tmpl = await getTemplateByPurpose(env, TMPL_SUPPLIER_ASK);
  const approved = isTemplateApproved(tmpl?.x_meta_template_id ?? null);

  // Batch: names for all supplied products at once.
  const allProductIds = [
    ...new Set(suppliers.flatMap((s) => s.x_supplied_product_ids || [])),
  ];
  const catalog = allProductIds.length
    ? await fetchSupplierCatalog(env, allProductIds)
    : { products: [], packagings: [] };
  const productNameById = new Map(catalog.products.map((p) => [p.id, p.name]));

  // Same intersection filter as the cron: active + sale_ok + x_is_active_for_sale.
  const activeIds = new Set<number>(
    (await call<Array<{ id: number }>>(env, "product.template", "search_read", {
      domain: [
        ["active", "=", true],
        ["sale_ok", "=", true],
        ["x_is_active_for_sale", "=", true],
      ],
      fields: ["id"],
      limit: 500,
    })).map((r) => r.id),
  );

  const owner = ownerDigits(env);
  const allowlist = parseAllowlist(env);

  const entries: DryRunSupplierEntry[] = suppliers.map((s) => {
    const suppliedIds = s.x_supplied_product_ids || [];
    const wa = s.x_whatsapp_number || "";

    const activeSupplied = suppliedIds.filter((id) => activeIds.has(id));
    const activeNames = activeSupplied
      .map((id) => productNameById.get(id))
      .filter((n): n is string => !!n);

    const productList = activeNames
      .join("، ")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/ {2,}/g, " ")
      .trim()
      .slice(0, 900);

    // Compute block_reason in the same precedence the cron applies:
    // (1) skip if no supplied products at all
    // (2) skip if intersection with active-for-sale is empty
    // (3) owner-guard blocks the owner recipient regardless of purpose
    //     (supplier_ask is not in OWNER_ALLOWED_PURPOSES)
    // (4) allowlist blocks non-matching numbers
    let block: BlockReason = null;
    let detail: string | undefined;
    if (!wa) {
      block = "no_whatsapp_number";
    } else if (suppliedIds.length === 0) {
      block = "no_supplied_products";
    } else if (activeNames.length === 0) {
      block = "no_active_products";
      detail = `${suppliedIds.length} supplied, 0 active-for-sale`;
    } else if (owner && toDigits(wa) === owner) {
      block = "owner_guard";
      detail = "recipient == OWNER_WHATSAPP; supplier_ask not in OWNER_ALLOWED_PURPOSES";
    } else if (!isRecipientAllowed(env, wa)) {
      block = "not_in_allowlist";
    }

    return {
      supplier_id: s.id,
      supplier_name: s.name,
      whatsapp_number: wa || null,
      supplied_product_ids: suppliedIds,
      active_product_names: activeNames,
      active_product_names_count: activeNames.length,
      product_list_param: productList,
      would_send: block === null && approved && !!tmpl,
      block_reason: block,
      ...(detail ? { block_detail: detail } : {}),
    };
  });

  return {
    now_utc: new Date().toISOString(),
    template: {
      purpose: TMPL_SUPPLIER_ASK,
      meta_template_id: tmpl?.x_meta_template_id ?? null,
      language: tmpl?.x_language ?? null,
      approved,
      registered: !!tmpl,
    },
    allowlist: {
      set: allowlist.length > 0,
      entries: allowlist.length,
      entries_masked: allowlist.map((p) => (p.length > 6 ? `${p.slice(0, 6)}…` : p)),
    },
    owner_whatsapp: env.OWNER_WHATSAPP ?? null,
    suppliers_total: entries.length,
    suppliers_would_send: entries.filter((e) => e.would_send).length,
    suppliers_blocked: entries.filter((e) => !e.would_send).length,
    entries,
  };
}
