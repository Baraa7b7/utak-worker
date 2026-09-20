// Item 1 (tonight) — supplier option on product.template + real avocado→Ahmad link.
//
// Idempotent. Steps:
//   1. Discover the many2many storage of res.partner.x_supplied_product_ids
//      (relation table + columns).
//   2. Create x_supplier_ids on product.template as many2many → res.partner
//      using the SAME table with columns REVERSED, so writes from either side
//      appear on the other.
//   3. Inherited views:
//        - product.template form: add "الموردون" field (widget many2many_tags,
//          domain supplier_rank>0).
//        - res.partner form: add tab "الأصناف اللي يوردها" that shows
//          x_supplied_product_ids, visible only when supplier_rank>0.
//   4. Real link: attach product.template id=105 (Avocado) to res.partner
//      id=30 (Ahmad Hasan). Kept — this is production data.
//
// Requires .env.sim-verify (ODOO_URL/DB/LOGIN/API_KEY).

import { readFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: .env.sim-verify missing keys");
  process.exit(1);
}

let auth = { mode: "apikey", cookie: null };

async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY },
    }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/session_id=([^;]+)/);
  if (!m) throw new Error(`session auth failed status=${res.status}`);
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}

async function call(model, method, body) {
  const url = `${ODOO_URL}/json/2/${model}/${method}`;
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  if (auth.mode === "session") headers["Cookie"] = auth.cookie;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") {
      await session();
      return call(model, method, body);
    }
    const err = new Error(
      `HTTP ${res.status} on ${model}.${method}: ${
        parsed?.data?.message ?? (typeof text === "string" ? text.slice(0, 400) : "")
      }`,
    );
    err.status = res.status;
    err.name = parsed?.data?.name ?? `HTTP_${res.status}`;
    throw err;
  }
  return parsed;
}

// ============================================================
// 1. Discover the m2m storage of res.partner.x_supplied_product_ids
// ============================================================
async function discoverSuppliedField() {
  const rows = await call("ir.model.fields", "search_read", {
    domain: [
      ["model", "=", "res.partner"],
      ["name", "=", "x_supplied_product_ids"],
    ],
    fields: [
      "id",
      "name",
      "model",
      "ttype",
      "relation",
      "relation_table",
      "column1",
      "column2",
    ],
    limit: 1,
  });
  if (rows.length === 0) {
    throw new Error(
      "res.partner.x_supplied_product_ids field not found — create it in Odoo first",
    );
  }
  const f = rows[0];
  if (f.ttype !== "many2many") {
    throw new Error(`expected many2many, got ${f.ttype}`);
  }
  if (f.relation !== "product.template") {
    throw new Error(`expected relation=product.template, got ${f.relation}`);
  }
  return {
    relation_table: f.relation_table,
    column1: f.column1,
    column2: f.column2,
  };
}

// ============================================================
// 2. Create x_supplier_ids on product.template (reverse m2m)
// ============================================================
async function ensureSupplierIdsField(rel) {
  const productModel = await call("ir.model", "search_read", {
    domain: [["model", "=", "product.template"]],
    fields: ["id"],
    limit: 1,
  });
  if (!productModel[0]) throw new Error("product.template model not found");
  const modelId = productModel[0].id;

  const existing = await call("ir.model.fields", "search_read", {
    domain: [
      ["model", "=", "product.template"],
      ["name", "=", "x_supplier_ids"],
    ],
    fields: ["id", "relation", "relation_table", "column1", "column2", "ttype"],
    limit: 1,
  });
  if (existing[0]) {
    const e = existing[0];
    const ok =
      e.ttype === "many2many" &&
      e.relation === "res.partner" &&
      e.relation_table === rel.relation_table &&
      e.column1 === rel.column2 &&
      e.column2 === rel.column1;
    return { id: e.id, action: ok ? "existed_ok" : "existed_MISMATCH", current: e };
  }
  const ids = await call("ir.model.fields", "create", {
    vals_list: [
      {
        model_id: modelId,
        name: "x_supplier_ids",
        field_description: "الموردون",
        ttype: "many2many",
        relation: "res.partner",
        relation_table: rel.relation_table,
        column1: rel.column2, // reversed
        column2: rel.column1, // reversed
      },
    ],
  });
  return { id: ids[0], action: "created" };
}

// ============================================================
// 3a. Inherited view on product.template: add "الموردون" field
// ============================================================
async function ensureProductSupplierView() {
  const name = "product.template.form.utak_suppliers";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  // Find a base form view on product.template.
  const baseRows = await call("ir.ui.view", "search_read", {
    domain: [
      ["model", "=", "product.template"],
      ["type", "=", "form"],
      ["inherit_id", "=", false],
    ],
    fields: ["id", "name"],
    limit: 1,
  });
  if (!baseRows[0]) throw new Error("no base product.template form view found");
  const baseId = baseRows[0].id;

  const arch = `
    <data>
      <xpath expr="//sheet" position="inside">
        <group string="UTAK">
          <field name="x_supplier_ids"
                 widget="many2many_tags"
                 domain="[('supplier_rank', '&gt;', 0)]"
                 options="{'no_create': True, 'no_create_edit': True}"/>
        </group>
      </xpath>
    </data>`;

  if (existing[0]) {
    await call("ir.ui.view", "write", {
      ids: [existing[0].id],
      vals: { arch_base: arch, inherit_id: baseId, active: true },
    });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [
      {
        name,
        model: "product.template",
        inherit_id: baseId,
        priority: 30,
        arch_base: arch,
      },
    ],
  });
  return { id: ids[0], action: "created" };
}

// ============================================================
// 3b. Inherited view on res.partner: tab "الأصناف اللي يوردها"
// Visible only when supplier_rank > 0.
// ============================================================
async function ensurePartnerSuppliedView() {
  const name = "res.partner.form.utak_supplied_products";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  // Prefer the canonical base partner form via xmlid.
  const xml = await call("ir.model.data", "search_read", {
    domain: [
      ["module", "=", "base"],
      ["name", "=", "view_partner_form"],
      ["model", "=", "ir.ui.view"],
    ],
    fields: ["res_id"],
    limit: 1,
  });
  let baseId = xml[0]?.res_id;
  if (!baseId) {
    const any = await call("ir.ui.view", "search_read", {
      domain: [
        ["model", "=", "res.partner"],
        ["type", "=", "form"],
        ["inherit_id", "=", false],
      ],
      fields: ["id"],
      limit: 1,
    });
    baseId = any[0]?.id;
  }
  if (!baseId) throw new Error("no base res.partner form view found");

  const arch = `
    <data>
      <xpath expr="//notebook" position="inside">
        <page string="الأصناف اللي يوردها" invisible="supplier_rank == 0">
          <field name="x_supplied_product_ids"
                 widget="many2many_tags"
                 options="{'no_create': True, 'no_create_edit': True}"/>
        </page>
      </xpath>
    </data>`;

  if (existing[0]) {
    await call("ir.ui.view", "write", {
      ids: [existing[0].id],
      vals: { arch_base: arch, inherit_id: baseId, active: true },
    });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [
      {
        name,
        model: "res.partner",
        inherit_id: baseId,
        priority: 30,
        arch_base: arch,
      },
    ],
  });
  return { id: ids[0], action: "created" };
}

// ============================================================
// 4. Real link: avocado (105) → Ahmad Hasan (30)
// ============================================================
async function linkAvocadoToAhmad() {
  const supplierId = 30; // Ahmad Hasan (per tonight spec)
  const productId = 105; // Avocado (per tonight spec)

  // Verify both exist.
  const supplier = await call("res.partner", "read", {
    ids: [supplierId],
    fields: ["id", "name", "supplier_rank"],
  });
  if (!supplier[0]) throw new Error(`supplier id=${supplierId} not found`);
  if (supplier[0].supplier_rank === 0) {
    throw new Error(`partner ${supplierId} (${supplier[0].name}) is not a supplier`);
  }

  const product = await call("product.template", "read", {
    ids: [productId],
    fields: ["id", "name"],
  });
  if (!product[0]) throw new Error(`product id=${productId} not found`);

  // Read current supplied set on Ahmad.
  const cur = await call("res.partner", "read", {
    ids: [supplierId],
    fields: ["x_supplied_product_ids"],
  });
  const current = cur[0]?.x_supplied_product_ids ?? [];
  const already = current.includes(productId);

  if (!already) {
    // (4, id) = add existing rel; safer than (6, 0, [...]) which replaces.
    await call("res.partner", "write", {
      ids: [supplierId],
      vals: { x_supplied_product_ids: [[4, productId]] },
    });
  }

  // Verify from BOTH sides.
  const verifyPartner = await call("res.partner", "read", {
    ids: [supplierId],
    fields: ["x_supplied_product_ids"],
  });
  const partnerSide = verifyPartner[0]?.x_supplied_product_ids ?? [];
  const verifyProduct = await call("product.template", "read", {
    ids: [productId],
    fields: ["x_supplier_ids"],
  });
  const productSide = verifyProduct[0]?.x_supplier_ids ?? [];

  return {
    supplier: { id: supplierId, name: supplier[0].name },
    product: { id: productId, name: product[0].name },
    was_already_linked: already,
    partner_side_ids: partnerSide,
    product_side_ids: productSide,
    both_sides_consistent:
      partnerSide.includes(productId) && productSide.includes(supplierId),
  };
}

async function main() {
  console.log("Item 1 migration — starting");

  const rel = await discoverSuppliedField();
  console.log("[1] discovered relation:", rel);

  const field = await ensureSupplierIdsField(rel);
  console.log("[2] x_supplier_ids field:", field);
  if (field.action === "existed_MISMATCH") {
    throw new Error(
      "x_supplier_ids exists but does NOT use the same reversed m2m table. " +
        "Manual fix required: delete it in Odoo, then re-run.",
    );
  }

  const pv = await ensureProductSupplierView();
  console.log("[3a] product.template inherited view:", pv);

  const rv = await ensurePartnerSuppliedView();
  console.log("[3b] res.partner inherited view:", rv);

  const link = await linkAvocadoToAhmad();
  console.log("[4] avocado→ahmad link:", link);
  if (!link.both_sides_consistent) {
    throw new Error(
      "Link inconsistency: field created but reads from the two sides disagree.",
    );
  }

  console.log("\n--- summary ---");
  console.log(JSON.stringify({
    relation_table: rel.relation_table,
    x_supplier_ids_field_id: field.id,
    x_supplier_ids_action: field.action,
    product_view_id: pv.id,
    partner_view_id: rv.id,
    avocado_to_ahmad: {
      supplier: link.supplier,
      product: link.product,
      partner_side_ids_count: link.partner_side_ids.length,
      product_side_ids_count: link.product_side_ids.length,
      both_sides_consistent: link.both_sides_consistent,
      was_already_linked: link.was_already_linked,
    },
  }, null, 2));
}

main().catch((e) => {
  console.error("ITEM 1 MIGRATION FAILED:", e);
  process.exit(1);
});
