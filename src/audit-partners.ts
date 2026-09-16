// TEMPORARY — 2026-09-12
// Read-only diagnostic for the Othman dedup + role/supplier/neighborhood audit.
// Never archives, never unlinks. The single mutation path (create ONE pilot
// customer) is gated behind an explicit `createPilot` flag on the caller.
//
// Consumed by GET /admin/audit-partners in src/index.ts. Delete both this
// module and the endpoint once the audit round is finished.

import type { Env } from "./config";
import { call } from "./odoo";

// ---------- shapes ----------

interface LinkedCounts {
  x_daily_order_as_customer: number;
  x_daily_order_lines_via_orders: number;
  x_quotation_via_orders: number;
  x_invoice_via_orders: number;
  x_payment_via_invoices: number;
  x_delivery_stop_via_orders: number;
  x_daily_price_as_supplier: number;
  x_collection_task_link_field: string | null;
  x_collection_task_count: number | "unknown";
}

interface PartnerDeepDive {
  id: number;
  name: string;
  phone: string | null;
  x_whatsapp_number: string | null;
  customer_rank: number;
  supplier_rank: number;
  active: boolean;
  x_role_ids: number[];
  role_codes: string[];
  legacy_x_role: string | null;
  x_delivery_neighborhood: string | null;
  linked: LinkedCounts;
}

// ---------- helpers ----------

async function fieldExists(env: Env, model: string, field: string): Promise<boolean> {
  try {
    const rows = await call<Array<{ id: number }>>(env, "ir.model.fields", "search_read", {
      domain: [["model", "=", model], ["name", "=", field]],
      fields: ["id"],
      limit: 1,
    });
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function countLinkedForPartner(env: Env, partnerId: number): Promise<LinkedCounts> {
  // Customer-side orders
  const orderIdRows = await call<Array<{ id: number }>>(env, "x_daily_order", "search_read", {
    domain: [["x_customer_id", "=", partnerId]],
    fields: ["id"],
    limit: 10000,
  });
  const orderIds = orderIdRows.map((o) => o.id);
  const x_daily_order_as_customer = orderIds.length;

  const x_daily_order_lines_via_orders = orderIds.length
    ? await call<number>(env, "x_daily_order_line", "search_count", {
        domain: [["x_order_id", "in", orderIds]],
      })
    : 0;

  const x_quotation_via_orders = orderIds.length
    ? await call<number>(env, "x_quotation", "search_count", {
        domain: [["x_order_id", "in", orderIds]],
      })
    : 0;

  const invoiceIdRows = orderIds.length
    ? await call<Array<{ id: number }>>(env, "x_invoice", "search_read", {
        domain: [["x_order_id", "in", orderIds]],
        fields: ["id"],
        limit: 10000,
      })
    : [];
  const invoiceIds = invoiceIdRows.map((r) => r.id);
  const x_invoice_via_orders = invoiceIds.length;

  const x_payment_via_invoices = invoiceIds.length
    ? await call<number>(env, "x_payment", "search_count", {
        domain: [["x_invoice_id", "in", invoiceIds]],
      })
    : 0;

  const x_delivery_stop_via_orders = orderIds.length
    ? await call<number>(env, "x_delivery_stop", "search_count", {
        domain: [["x_order_id", "in", orderIds]],
      })
    : 0;

  const x_daily_price_as_supplier = await call<number>(env, "x_daily_price", "search_count", {
    domain: [["x_supplier_id", "=", partnerId]],
  });

  // x_collection_task: link field name is not clear from src — probe candidates.
  let taskField: string | null = null;
  for (const candidate of ["x_customer_id", "x_partner_id", "x_collector_id", "x_debtor_id"]) {
    if (await fieldExists(env, "x_collection_task", candidate)) {
      taskField = candidate;
      break;
    }
  }
  let x_collection_task_count: number | "unknown" = "unknown";
  if (taskField) {
    try {
      x_collection_task_count = await call<number>(env, "x_collection_task", "search_count", {
        domain: [[taskField, "=", partnerId]],
      });
    } catch {
      x_collection_task_count = "unknown";
    }
  }

  return {
    x_daily_order_as_customer,
    x_daily_order_lines_via_orders,
    x_quotation_via_orders,
    x_invoice_via_orders,
    x_payment_via_invoices,
    x_delivery_stop_via_orders,
    x_daily_price_as_supplier,
    x_collection_task_link_field: taskField,
    x_collection_task_count,
  };
}

function orNull<T>(v: T | false | undefined | null): T | null {
  if (v === false || v === undefined || v === null) return null;
  return v;
}

async function readPartnerDeep(
  env: Env,
  id: number,
  legacyRoleExists: boolean,
  roleMap: Map<number, { x_code: string; x_name: string }>,
): Promise<PartnerDeepDive | null> {
  const fields = [
    "id","name","phone","x_whatsapp_number","customer_rank","supplier_rank",
    "active","x_role_ids","x_delivery_neighborhood",
  ];
  if (legacyRoleExists) fields.push("x_role");

  const rows = await call<Array<Record<string, unknown>>>(env, "res.partner", "read", {
    ids: [id],
    fields,
  });
  const p = rows[0];
  if (!p) return null;

  const roleIds = Array.isArray(p.x_role_ids) ? (p.x_role_ids as number[]) : [];
  const role_codes = roleIds.map((rid) => roleMap.get(rid)?.x_code ?? `unknown:${rid}`);

  const linked = await countLinkedForPartner(env, id);

  return {
    id: p.id as number,
    name: (p.name as string) ?? "",
    phone: orNull(p.phone as string | false | null),
    x_whatsapp_number: orNull(p.x_whatsapp_number as string | false | null),
    customer_rank: (p.customer_rank as number) ?? 0,
    supplier_rank: (p.supplier_rank as number) ?? 0,
    active: p.active === true,
    x_role_ids: roleIds,
    role_codes,
    legacy_x_role: legacyRoleExists ? orNull(p.x_role as string | false | null) : null,
    x_delivery_neighborhood: orNull(p.x_delivery_neighborhood as string | false | null),
    linked,
  };
}

// ---------- main entrypoint ----------

export interface AuditOptions {
  createPilot: boolean;
}

export async function runPartnerAudit(env: Env, opts: AuditOptions) {
  // 0. Feature-detect: does legacy x_role field still exist on res.partner?
  const legacyRoleExists = await fieldExists(env, "res.partner", "x_role");

  // 0b. Load role table once
  const allRoles = await call<Array<{ id: number; x_code: string; x_name: string }>>(
    env,
    "x_employee_role",
    "search_read",
    { domain: [], fields: ["id", "x_code", "x_name"], limit: 100 },
  );
  const roleMap = new Map(allRoles.map((r) => [r.id, r]));

  // ---------- Task 1: partner 8 vs partner 15 ----------
  const partner_8 = await readPartnerDeep(env, 8, legacyRoleExists, roleMap);
  const partner_15 = await readPartnerDeep(env, 15, legacyRoleExists, roleMap);

  // ---------- Task 2: all partners with x_role_ids OR legacy x_role ----------
  const roleFields = ["id", "name", "x_role_ids", "x_whatsapp_number", "active"];
  if (legacyRoleExists) roleFields.push("x_role");

  const withRoleIds = await call<Array<Record<string, unknown>>>(env, "res.partner", "search_read", {
    domain: [["x_role_ids", "!=", false]],
    fields: roleFields,
    limit: 500,
  });
  const partners_with_role_ids = withRoleIds
    .filter((p) => Array.isArray(p.x_role_ids) && (p.x_role_ids as number[]).length > 0)
    .map((p) => {
      const rids = p.x_role_ids as number[];
      return {
        id: p.id as number,
        name: (p.name as string) ?? "",
        x_whatsapp_number: orNull(p.x_whatsapp_number as string | false | null),
        active: p.active === true,
        role_ids: rids,
        role_codes: rids.map((rid) => roleMap.get(rid)?.x_code ?? `unknown:${rid}`),
        legacy_x_role: legacyRoleExists ? orNull(p.x_role as string | false | null) : null,
      };
    });

  let partners_with_legacy_role_only: Array<Record<string, unknown>> = [];
  if (legacyRoleExists) {
    const rows = await call<Array<Record<string, unknown>>>(env, "res.partner", "search_read", {
      domain: [["x_role", "!=", false], ["x_role", "!=", ""]],
      fields: roleFields,
      limit: 500,
    });
    partners_with_legacy_role_only = rows
      .filter((p) => !Array.isArray(p.x_role_ids) || (p.x_role_ids as number[]).length === 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        x_whatsapp_number: orNull(p.x_whatsapp_number as string | false | null),
        active: p.active === true,
        legacy_x_role: p.x_role,
      }));
  }

  // ---------- Task 3: real vs test suppliers ----------
  const supplierTypeExists = await fieldExists(env, "res.partner", "x_supplier_type");
  const supplierFields = [
    "id","name","x_whatsapp_number","x_supplied_product_ids","active","supplier_rank",
  ];
  if (supplierTypeExists) supplierFields.push("x_supplier_type");

  const domain: unknown[] = [["x_whatsapp_number", "!=", false]];
  if (supplierTypeExists) {
    domain.unshift("|");
    domain.push(["supplier_rank", ">", 0]);
    domain.push(["x_supplier_type", "!=", false]);
  } else {
    domain.push(["supplier_rank", ">", 0]);
  }

  const suppliers = await call<Array<Record<string, unknown>>>(env, "res.partner", "search_read", {
    domain,
    fields: supplierFields,
    limit: 300,
  });
  const supplier_rows = suppliers.map((s) => {
    const supplied = Array.isArray(s.x_supplied_product_ids) ? (s.x_supplied_product_ids as number[]) : [];
    const phone = (s.x_whatsapp_number as string) ?? "";
    const isTestBaraa = s.id === 7 || phone === "+966500000099";
    return {
      id: s.id as number,
      name: (s.name as string) ?? "",
      x_whatsapp_number: phone,
      x_supplier_type: supplierTypeExists ? orNull(s.x_supplier_type as string | false | null) : undefined,
      supplier_rank: (s.supplier_rank as number) ?? 0,
      active: s.active === true,
      supplied_products_count: supplied.length,
      supplied_product_ids: supplied,
      classification: isTestBaraa ? "test-baraa" : "real",
      breaks_2am_cron_getActiveSuppliersForAsk: !isTestBaraa && supplied.length === 0,
    };
  });

  // ---------- Task 4: customers without neighborhood ----------
  const total_customers = await call<number>(env, "res.partner", "search_count", {
    domain: [["customer_rank", ">", 0]],
  });
  const customers_without_neighborhood = await call<number>(env, "res.partner", "search_count", {
    domain: [
      ["customer_rank", ">", 0],
      "|",
      ["x_delivery_neighborhood", "=", false],
      ["x_delivery_neighborhood", "=", ""],
    ],
  });
  const neighborhoods = await call<Array<{ id: number; x_name: string }>>(
    env,
    "x_neighborhood",
    "search_read",
    { domain: [], fields: ["id", "x_name"], limit: 200, order: "id asc" },
  );

  let pilot_created:
    | { id: number; name: string; neighborhood: string; whatsapp: string }
    | null = null;

  if (opts.createPilot && neighborhoods.length > 0) {
    // Deterministic-ish pilot name so it is easy to find/archive later.
    const chosenNeigh = neighborhoods[0]!;
    const suffix = Date.now().toString().slice(-6);
    const pilotName = `PILOT-عميل-حي-${chosenNeigh.x_name}-${suffix}`;
    // Use a phone under the test range so it never accidentally receives WA
    // (mirrors "براء - اختبار" — that number is +966500000099).
    const pilotWhatsapp = `+96650000${suffix}`;
    const createIds = await call<number[]>(env, "res.partner", "create", {
      vals_list: [
        {
          name: pilotName,
          x_whatsapp_number: pilotWhatsapp,
          phone: pilotWhatsapp,
          customer_rank: 1,
          x_delivery_neighborhood: chosenNeigh.x_name,
        },
      ],
    });
    pilot_created = {
      id: createIds[0],
      name: pilotName,
      neighborhood: chosenNeigh.x_name,
      whatsapp: pilotWhatsapp,
    };
  }

  return {
    _meta: {
      timestamp: new Date().toISOString(),
      create_pilot_requested: opts.createPilot,
      legacy_x_role_field_exists: legacyRoleExists,
      supplier_type_field_exists: supplierTypeExists,
    },
    task1_othman_dedup: {
      note:
        "Read-only. Both ids fetched with linked-record counts. Take NO action without explicit approval.",
      partner_8,
      partner_15,
    },
    task2_roles: {
      all_role_codes: allRoles,
      partners_with_role_ids,
      partners_with_legacy_role_only,
    },
    task3_suppliers: {
      count: supplier_rows.length,
      rows: supplier_rows,
    },
    task4_neighborhood: {
      total_customers,
      customers_without_neighborhood,
      available_neighborhoods: neighborhoods,
      pilot_created,
    },
  };
}
