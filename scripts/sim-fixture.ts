// scripts/sim-fixture.ts — sim-harness verification helper.
//
// NOT bundled with the worker: lives outside src/, tsconfig include is
// "src/**/*.ts", and wrangler main = "src/index.ts". Import path uses
// ../src/odoo so we exercise the exact production Odoo layer (Bearer API
// key → session fallback; auto-stamp x_is_simulation on SIM_MARKED_MODELS
// creates via isTestMode).
//
// Secrets: read from process.env only. Never logged, never argv, never
// echoed into HTTP URLs.
//
// Subcommands:
//   create                  — build the fixture, print IDs as JSON
//   verify <quotation_id>   — read x_sent_at / linked-order state from Odoo
//   dispatch <quotation_id> — POST /internal/quotation-issue on sim
//   purge-dry               — POST /sim/purge (no confirm)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  call,
  addOrderLines,
  createQuotationRecord,
  findOrCreateTodayOrder,
} from "../src/odoo";
import type { Env } from "../src/config";

// --- env-file loader (in-script — NODE_OPTIONS refuses --env-file) ---------
// KEY=VALUE per line, '#' comments, empty lines ignored. Sets process.env
// for keys the caller hasn't already set. Values never logged.
(function loadEnvFile() {
  const path = resolve(process.cwd(), ".env.sim-verify");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // absent → caller may have already exported the vars
  }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
})();

// --- env plumbing (Node process, not Workers env) ---------------------------
const SHIM_ENV = {
  ODOO_URL: "https://utakfresh.odoo.com",
  ODOO_DB: "utakfresh",
  ODOO_LOGIN: "admin@utakfresh.com",
  ODOO_API_KEY: process.env.ODOO_API_KEY ?? "",
  SIMULATION_MODE: "true", // arms the SIM_MARKED_MODELS auto-stamp in call()
} as unknown as Env;

const SIM_ORIGIN = "https://utak-worker-sim.utak-business.workers.dev";

function requireSecret(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: ${name} not in process.env`);
    process.exit(2);
  }
  return v;
}

// --- helpers ----------------------------------------------------------------
const todayUTC = new Date().toISOString().slice(0, 10);
const yesterdayUTC = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

type Product = { id: number; name: string };
type Packaging = {
  id: number;
  x_name: string;
  x_product_tmpl_id: [number, string] | false;
  x_is_default?: boolean;
};

async function pickTwoZeroPriceProducts(): Promise<
  Array<{ id: number; name: string; packaging_id: number; packaging_name: string }>
> {
  // Stricter than "no today price" — the loud-fail contract in
  // getLatestSalePrice classifies as "missing" only when there is no row at
  // all; any older row (including production rows with x_is_simulation=false)
  // demotes the classification to "stale". So the A slot must be a
  // (product, packaging) pair with ZERO daily_price rows ever.
  const products = await call<Product[]>(SHIM_ENV, "product.template", "search_read", {
    domain: [["active", "=", true], ["sale_ok", "=", true]],
    fields: ["id", "name"],
    limit: 200,
    order: "id asc",
  });
  if (products.length === 0) throw new Error("no active sale_ok products found");
  const productIds = products.map((p) => p.id);
  const pkgs = await call<Packaging[]>(SHIM_ENV, "x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "in", productIds]],
    fields: ["id", "x_name", "x_product_tmpl_id", "x_is_default"],
    limit: 2000,
  });
  const byProd = new Map<number, Packaging[]>();
  for (const k of pkgs) {
    if (!Array.isArray(k.x_product_tmpl_id)) continue;
    const pid = k.x_product_tmpl_id[0];
    const arr = byProd.get(pid);
    if (arr) arr.push(k);
    else byProd.set(pid, [k]);
  }
  const out: Array<{ id: number; name: string; packaging_id: number; packaging_name: string }> = [];
  for (const p of products) {
    const arr = byProd.get(p.id) ?? [];
    const def = arr.find((k) => k.x_is_default === true) ?? arr[0];
    if (!def) continue;
    const rows = await call<Array<{ id: number }>>(
      SHIM_ENV,
      "x_daily_price",
      "search_read",
      {
        domain: [
          ["x_product_tmpl_id", "=", p.id],
          ["x_packaging_id", "=", def.id],
        ],
        fields: ["id"],
        limit: 1,
      },
    );
    if (rows.length === 0) {
      out.push({ id: p.id, name: p.name, packaging_id: def.id, packaging_name: def.x_name });
      if (out.length === 2) return out;
    }
  }
  throw new Error(`could not find two zero-price (product, packaging) pairs; found ${out.length}`);
}

async function cmdCreate(mode: "full" | "a-only" | "b-only" = "full"): Promise<void> {
  requireSecret("ODOO_API_KEY"); // already loaded into SHIM_ENV
  // In "a-only" mode we still call pickTwoZeroPriceProducts so the
  // A candidate satisfies the same "zero daily_price history" guarantee
  // used in the full run; we simply never write anything for B.
  const [a, b] = await pickTwoZeroPriceProducts();
  // Distinct suffix per run so re-runs don't overwrite each other's rows.
  const runTag = `#${Date.now().toString(36).slice(-6)}`;

  // 1) Customer partner — direct create so we can force phone="" (createCustomer
  // in odoo.ts sets phone=e164, which we do NOT want here).
  const customerIds = await call<number[]>(SHIM_ENV, "res.partner", "create", {
    vals_list: [
      {
        name: `[SIM] Verify Pricing ${runTag}`,
        x_whatsapp_number: "+966505154962",
        phone: "",
        customer_rank: 1,
      },
    ],
  });
  const customerId = customerIds[0];

  // 2) Supplier partner + 3) B's yesterday price — only needed for B scenarios.
  // Skipped in a-only mode.
  let supplierId: number | null = null;
  let stalePriceId: number | null = null;
  if (mode === "full" || mode === "b-only") {
    const supplierIds = await call<number[]>(SHIM_ENV, "res.partner", "create", {
      vals_list: [
        {
          name: `[SIM] Verify Pricing Supplier ${runTag}`,
          supplier_rank: 1,
        },
      ],
    });
    supplierId = supplierIds[0];

    // Seed B's stale price at x_date = yesterday_UTC. createDailyPrice
    // hardcodes today; direct call() is the only path to set an arbitrary
    // x_date without touching the schema.
    const stalePriceIds = await call<number[]>(SHIM_ENV, "x_daily_price", "create", {
      vals_list: [
        {
          x_supplier_id: supplierId,
          x_product_tmpl_id: b.id,
          x_packaging_id: b.packaging_id,
          x_date: yesterdayUTC,
          x_price_sar: 10,
          x_sale_price: 15,
          x_source_message_id: "sim-fixture-B-stale",
          x_raw_reply: "fixture: stale sale price for scenario B",
          x_extraction_status: "extracted",
        },
      ],
    });
    stalePriceId = stalePriceIds[0];
  }

  // Race checks — only run for the slot(s) we actually intend to use.
  if (mode === "full" || mode === "a-only") {
    const aTodayRows = await call<Array<{ id: number }>>(
      SHIM_ENV,
      "x_daily_price",
      "search_read",
      {
        domain: [
          ["x_product_tmpl_id", "=", a.id],
          ["x_packaging_id", "=", a.packaging_id],
          ["x_date", "=", todayUTC],
        ],
        fields: ["id"],
        limit: 1,
      },
    );
    if (aTodayRows.length > 0) {
      throw new Error(`race: product A (id=${a.id}) acquired a today price during setup`);
    }
  }
  if (mode === "full" || mode === "b-only") {
    const bTodayRows = await call<Array<{ id: number }>>(
      SHIM_ENV,
      "x_daily_price",
      "search_read",
      {
        domain: [
          ["x_product_tmpl_id", "=", b.id],
          ["x_packaging_id", "=", b.packaging_id],
          ["x_date", "=", todayUTC],
        ],
        fields: ["id"],
        limit: 1,
      },
    );
    if (bTodayRows.length > 0) {
      throw new Error(`race: product B (id=${b.id}) acquired a today price during setup`);
    }
  }

  // 4) Order A — SKIPPED in b-only mode
  let orderA: { id: number; created: boolean } | null = null;
  let qA: { id: number; number: string } | null = null;
  if (mode === "full" || mode === "a-only") {
    orderA = await findOrCreateTodayOrder(SHIM_ENV, customerId, "الرياض", "sim-fixture-A");
    await addOrderLines(SHIM_ENV, orderA.id, [
      {
        product_id: a.id,
        packaging_id: a.packaging_id,
        quantity: 3,
        notes: "",
        // ExtractedOrderItem carries a product_name_raw field for logs; empty
        // string is accepted.
        product_name_raw: "",
      },
    ]);
    qA = await createQuotationRecord(SHIM_ENV, orderA.id);
  }

  // 5) Order B — SKIPPED in a-only mode
  let orderBid: number | null = null;
  let qB: { id: number; number: string } | null = null;
  if (mode === "full" || mode === "b-only") {
    const orderBIds = await call<number[]>(SHIM_ENV, "x_daily_order", "create", {
      vals_list: [
        {
          x_customer_id: customerId,
          x_order_date: todayUTC,
          x_state: "draft",
          x_created_via: "whatsapp",
          x_source_message_id: "sim-fixture-B",
          x_delivery_neighborhood: "الرياض",
        },
      ],
    });
    orderBid = orderBIds[0];
    await addOrderLines(SHIM_ENV, orderBid, [
      {
        product_id: b.id,
        packaging_id: b.packaging_id,
        quantity: 2,
        notes: "",
        product_name_raw: "",
      },
    ]);
    qB = await createQuotationRecord(SHIM_ENV, orderBid);
  }

  console.log(
    JSON.stringify(
      {
        mode,
        customerId,
        supplierId,
        todayUTC,
        yesterdayUTC,
        A: (orderA && qA) ? {
          productId: a.id,
          productName: a.name,
          packagingId: a.packaging_id,
          orderId: orderA.id,
          quotationId: qA.id,
          quotationNumber: qA.number,
        } : null,
        B: (orderBid !== null && qB) ? {
          productId: b.id,
          productName: b.name,
          packagingId: b.packaging_id,
          orderId: orderBid,
          quotationId: qB.id,
          quotationNumber: qB.number,
          stalePriceId: stalePriceId,
          stalePriceDate: yesterdayUTC,
        } : null,
      },
      null,
      2,
    ),
  );
}

async function cmdVerify(qid: number): Promise<void> {
  requireSecret("ODOO_API_KEY");
  type QRow = {
    id: number;
    x_quotation_number: string | false;
    x_order_id: [number, string] | false;
    x_sent_at: string | false;
    x_customer_response: string | false;
    create_date: string | false;
  };
  const rows = await call<QRow[]>(SHIM_ENV, "x_quotation", "read", {
    ids: [qid],
    fields: [
      "id",
      "x_quotation_number",
      "x_order_id",
      "x_sent_at",
      "x_customer_response",
      "create_date",
    ],
  });
  const q = rows[0];
  if (!q) {
    console.log(JSON.stringify({ quotationId: qid, found: false }));
    return;
  }
  let orderState: string | null = null;
  if (Array.isArray(q.x_order_id)) {
    type OR = { id: number; x_state: string | false };
    const os = await call<OR[]>(SHIM_ENV, "x_daily_order", "read", {
      ids: [q.x_order_id[0]],
      fields: ["id", "x_state"],
    });
    orderState = os[0]?.x_state ? String(os[0].x_state) : null;
  }
  console.log(
    JSON.stringify({
      quotationId: qid,
      found: true,
      x_quotation_number: q.x_quotation_number,
      x_sent_at: q.x_sent_at, // false = never written
      x_customer_response: q.x_customer_response,
      x_order_id: Array.isArray(q.x_order_id) ? q.x_order_id[0] : null,
      order_state: orderState,
      create_date: q.create_date,
    }),
  );
}

async function cmdDispatch(qid: number): Promise<void> {
  const token = requireSecret("INTERNAL_WEBHOOK_SECRET");
  const url = new URL(`${SIM_ORIGIN}/internal/quotation-issue`);
  url.searchParams.set("token", token);
  const r = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quotation_id: qid }),
  });
  const text = await r.text();
  console.log(
    JSON.stringify({
      quotationId: qid,
      http_status: r.status,
      body: (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })(),
    }),
  );
}

async function cmdInspectPrices(productId: number, packagingId: number): Promise<void> {
  requireSecret("ODOO_API_KEY");
  type R = {
    id: number;
    x_date: string | false;
    x_price_sar: number | false;
    x_sale_price: number | false;
    x_is_simulation?: boolean;
  };
  const rows = await call<R[]>(SHIM_ENV, "x_daily_price", "search_read", {
    domain: [
      ["x_product_tmpl_id", "=", productId],
      ["x_packaging_id", "=", packagingId],
    ],
    fields: ["id", "x_date", "x_price_sar", "x_sale_price", "x_is_simulation"],
    order: "x_date desc, id desc",
    limit: 100,
  });
  console.log(JSON.stringify({ productId, packagingId, count: rows.length, rows }, null, 2));
}

// classify — call buildQuotationPDFDataFromOdoo directly and print the
// price-warning classification. Used when the /internal/quotation-issue
// path is blocked by a downstream requirement (e.g. Gotenberg absent on
// sim) — this proves the source/age_days classification independently.
async function cmdClassify(qid: number): Promise<void> {
  requireSecret("ODOO_API_KEY");
  const { buildQuotationPDFDataFromOdoo } = await import("../src/quotation");
  const data = await buildQuotationPDFDataFromOdoo(SHIM_ENV, qid);
  if (!data) {
    console.log(JSON.stringify({ quotationId: qid, found: false }));
    return;
  }
  console.log(
    JSON.stringify({
      quotationId: qid,
      quotationNumber: data.quotationNumber,
      customer: data.customer.name,
      customer_phone: data.customer.phone,
      items: data.items.map((it) => ({ name: it.name, pack: it.pack, qty: it.qty, price: it.price })),
      has_blocking_issue: data.has_blocking_issue,
      price_warnings: data.price_warnings,
    }, null, 2),
  );
}

// One-off: create the x_is_active_for_sale boolean on product.template.
// Idempotent — re-runs return {existed:true}. Uses the same
// ir.model.fields.create pattern as ensureLocationFields. Never writes
// a value to any product — the field default (false) is what applies.
async function cmdEnsureActiveField(): Promise<void> {
  requireSecret("ODOO_API_KEY");
  const { ensureProductActiveField } = await import("../src/odoo");
  const result = await ensureProductActiveField(SHIM_ENV);
  console.log(JSON.stringify(result, null, 2));
}

// Idempotent create of three inherited views on product.template — one
// each for form / list / search. Prints their ids and archs so the caller
// can eyeball the injection without opening Odoo.
async function cmdEnsureActiveViews(): Promise<void> {
  requireSecret("ODOO_API_KEY");
  const { ensureProductActiveViews } = await import("../src/odoo");
  const result = await ensureProductActiveViews(SHIM_ENV);
  console.log(JSON.stringify(result, null, 2));
}

// Post-create verification (does NOT write anything):
//  1) read ir.model.fields to prove the field exists with the expected
//     ttype/state
//  2) count products where x_is_active_for_sale=true — MUST be 0 on a
//     fresh install; a non-zero count is a stop signal
async function cmdVerifyActiveField(): Promise<void> {
  requireSecret("ODOO_API_KEY");
  type FieldRow = {
    id: number;
    name: string;
    model: string;
    ttype: string;
    state: string;
    field_description: string | false;
  };
  const fields = await call<FieldRow[]>(SHIM_ENV, "ir.model.fields", "search_read", {
    domain: [
      ["model", "=", "product.template"],
      ["name", "=", "x_is_active_for_sale"],
    ],
    fields: ["id", "name", "model", "ttype", "state", "field_description"],
    limit: 1,
  });
  const activeCount = await call<number>(SHIM_ENV, "product.template", "search_count", {
    domain: [
      ["active", "=", true],
      ["sale_ok", "=", true],
      ["x_is_active_for_sale", "=", true],
    ],
  });
  console.log(
    JSON.stringify(
      { field: fields[0] ?? null, active_for_sale_true_count: activeCount },
      null,
      2,
    ),
  );
}

// Exercises the actual src/odoo.ts::fetchCatalog against Odoo. We shim
// env.MSG_DEDUP so the KV branch always misses cache, and only reads/writes
// go to Odoo. Returns the catalog size — the barrier signal Baraa wants
// to see after the field lands.
async function cmdCatalogCount(): Promise<void> {
  requireSecret("ODOO_API_KEY");
  const shim = { ...SHIM_ENV, MSG_DEDUP: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
    list: async () => ({ keys: [], list_complete: true }),
  } } as unknown as import("../src/config").Env;
  const { fetchCatalog } = await import("../src/odoo");
  const catalog = await fetchCatalog(shim);
  console.log(
    JSON.stringify(
      {
        count: catalog.length,
        sample: catalog.slice(0, 3).map((p) => ({ id: p.id, name: p.name })),
      },
      null,
      2,
    ),
  );
}

async function cmdPurgeDry(): Promise<void> {
  const secret = requireSecret("SIM_SECRET");
  const r = await fetch(`${SIM_ORIGIN}/sim/purge`, {
    method: "POST",
    headers: { "x-sim-secret": secret },
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch { /* keep raw */ }
  console.log(JSON.stringify({ http_status: r.status, body: parsed }, null, 2));
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case "create": {
      const raw = rest[0];
      const mode: "full" | "a-only" | "b-only" =
        raw === "a-only" ? "a-only" : raw === "b-only" ? "b-only" : "full";
      await cmdCreate(mode);
      return;
    }
    case "verify": {
      const id = Number(rest[0]);
      if (!Number.isFinite(id) || id <= 0) throw new Error("verify: bad quotation_id");
      await cmdVerify(id);
      return;
    }
    case "dispatch": {
      const id = Number(rest[0]);
      if (!Number.isFinite(id) || id <= 0) throw new Error("dispatch: bad quotation_id");
      await cmdDispatch(id);
      return;
    }
    case "ensure-active-field":
      await cmdEnsureActiveField();
      return;
    case "verify-active-field":
      await cmdVerifyActiveField();
      return;
    case "ensure-active-views":
      await cmdEnsureActiveViews();
      return;
    case "catalog-count":
      await cmdCatalogCount();
      return;
    case "purge-dry":
      await cmdPurgeDry();
      return;
    case "classify": {
      const id = Number(rest[0]);
      if (!Number.isFinite(id) || id <= 0) throw new Error("classify: bad quotation_id");
      await cmdClassify(id);
      return;
    }
    case "inspect-prices": {
      const pid = Number(rest[0]);
      const pkid = Number(rest[1]);
      if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(pkid) || pkid <= 0) {
        throw new Error("inspect-prices: need <productId> <packagingId>");
      }
      await cmdInspectPrices(pid, pkid);
      return;
    }
    default:
      console.error(
        `unknown cmd: ${cmd}. use: create | verify <id> | dispatch <id> | purge-dry | inspect-prices <productId> <packagingId>`,
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  const st = (e as Error).stack;
  if (st) console.error(st);
  process.exit(1);
});
