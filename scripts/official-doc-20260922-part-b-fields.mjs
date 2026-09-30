// Part B — add language + bilingual fields to Odoo.
//
// Adds:
//   - res.partner.x_doc_lang           (selection ar/en, default ar)
//   - x_quotation.x_doc_lang           (selection ar/en/bi, not required)
//   - sale.order.x_doc_lang            (selection ar/en/bi, not required)
//   - x_invoice.x_doc_lang             (selection ar/en/bi, not required)
//   - x_payment.x_doc_lang             (selection ar/en/bi, not required)
//   - x_delivery_stop.x_doc_lang       (selection ar/en/bi, not required)
//   - x_official_doc.x_lang            (selection ar/en, default ar)
//   - res.company.x_legal_name_ar      (char)
//   - res.company.x_legal_name_en      (char)
//   - res.company.x_address_ar         (char)
//   - res.company.x_address_en         (char)
//   - product.template.x_name_en       (char)
//   - x_product_packaging.x_name_en    (char)
//
// purchase.order is a stock Odoo model — the task says "لو أمر الشراء ما له
// موديل حي، مرّر اللغة في الكود فقط واذكر ذلك". We DO NOT touch purchase.order
// here; the worker will resolve language from the partner (via x_doc_lang on
// res.partner) with an "ar" fallback.
//
// Views added (form inheritance):
//   - res.partner       → add x_doc_lang under "internal notes" area
//   - res.company       → add legal-name + address (ar/en) group
//   - x_official_doc    → header widget=radio for x_lang
//   - product.template  → add x_name_en next to name; list column
//   - x_product_packaging → add x_name_en column to list view
//   - each doc model (x_quotation/x_invoice/x_payment/x_delivery_stop):
//     add x_doc_lang selector — form inheritance (skipped when the model has
//     no root form view — the field is still addable via Studio)
//   - sale.order → add x_doc_lang under partner info (form view #660 sale.view_order_form)
//
// Every create is logged to scripts/artifacts/official-docs-created.json so
// scripts/official-doc-rollback.mjs can undo the whole batch.
//
// Idempotent-safe: re-running skips whatever it already created (matched by
// (model, name)).

import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const rbPath = new URL("./artifacts/official-docs-created.json", import.meta.url).pathname;
const rb = JSON.parse(readFileSync(rbPath, "utf8"));
rb.operations = rb.operations || [];

function log(model, id, name) {
  rb.operations.push({ ts: new Date().toISOString(), model, id, name, action: "create" });
  writeFileSync(rbPath, JSON.stringify(rb, null, 2));
}

async function modelIdOf(model) {
  const rows = await call("ir.model", "search_read", { domain: [["model", "=", model]], fields: ["id"] });
  if (rows.length === 0) throw new Error(`model ${model} not present`);
  return rows[0].id;
}

// Field factory. Every field gets `state="manual"` so Odoo treats it as a
// user-defined field. `copied=false` is only set on the doc-level x_doc_lang
// / x_lang selectors so duplicate-doc doesn't carry the language override.
async function ensureField(model, name, ttype, opts = {}) {
  const existing = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", model], ["name", "=", name]],
    fields: ["id", "field_description"],
  });
  if (existing.length > 0) {
    console.log(`  [skip] ${model}.${name} — already present (#${existing[0].id})`);
    return existing[0].id;
  }
  if (!APPLY) {
    console.log(`  [dry-run] would create ${model}.${name} : ${ttype} — ${opts.field_description}`);
    return null;
  }
  const modelId = await modelIdOf(model);
  const vals = {
    model_id: modelId,
    name,
    ttype,
    state: "manual",
    field_description: opts.field_description ?? name,
    ...opts,
  };
  const id = await call("ir.model.fields", "create", { vals_list: [vals] });
  const rowId = Array.isArray(id) ? id[0] : id;
  console.log(`  created ${model}.${name} #${rowId}`);
  log("ir.model.fields", rowId, `${model}.${name}`);
  return rowId;
}

async function ensureSelection(fieldId, value, label) {
  const existing = await call("ir.model.fields.selection", "search_read", {
    domain: [["field_id", "=", fieldId], ["value", "=", value]],
    fields: ["id"],
  });
  if (existing.length > 0) {
    console.log(`    [skip] selection ${value} — already present`);
    return existing[0].id;
  }
  if (!APPLY) {
    console.log(`    [dry-run] would create selection ${value} → ${label}`);
    return null;
  }
  const id = await call("ir.model.fields.selection", "create", {
    vals_list: [{ field_id: fieldId, value, name: label }],
  });
  const rowId = Array.isArray(id) ? id[0] : id;
  console.log(`    created selection ${value} #${rowId}`);
  log("ir.model.fields.selection", rowId, `${value}=${label}`);
  return rowId;
}

async function ensureView({ name, model, inherit_id, arch }) {
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
  });
  if (existing.length > 0) {
    console.log(`  [skip] view ${name} — already present (#${existing[0].id})`);
    return existing[0].id;
  }
  if (!APPLY) {
    console.log(`  [dry-run] would create view ${name}`);
    return null;
  }
  // arch_base is the compatibility field on Odoo 19 — but create with `arch`
  // still works when we pass a valid xpath diff. Use `arch_base` since inherit
  // views need the change diff, not the whole tree.
  const id = await call("ir.ui.view", "create", {
    vals_list: [{
      name,
      model,
      inherit_id,
      arch_base: arch,
      priority: 20,
    }],
  });
  const rowId = Array.isArray(id) ? id[0] : id;
  console.log(`  created view ${name} #${rowId}`);
  log("ir.ui.view", rowId, name);
  return rowId;
}

async function main() {
  console.log(`=== Part B fields (${APPLY ? "apply" : "dry-run"}) ===\n`);

  // -------------------- language selection helpers --------------------
  const AR_EN = [
    ["ar", "عربي"],
    ["en", "إنجليزي"],
  ];
  const AR_EN_BI = [
    ["ar", "عربي"],
    ["en", "إنجليزي"],
    ["bi", "ثنائي"],
  ];

  async function langField(model, name, options, { default_value, field_description, required }) {
    const fieldId = await ensureField(model, name, "selection", {
      field_description,
      copied: false,
      required: !!required,
    });
    if (fieldId) {
      for (const [v, lbl] of options) await ensureSelection(fieldId, v, lbl);
      if (APPLY && default_value) {
        // Set the field-level default via a hidden company field-default row.
        // Odoo default: write it as `default_<name>` on ir.default. This is
        // the "user-defined field" default hook and mirrors what Studio does
        // when you set a Default value on a selection.
        await call("ir.default", "set", {
          model_name: model,
          field_name: name,
          value: default_value,
        }).catch((e) => console.log(`    [warn] set default ${default_value}: ${e.message.slice(0, 120)}`));
      }
    }
    return fieldId;
  }

  // partner: ar/en, default ar
  console.log("res.partner.x_doc_lang");
  await langField("res.partner", "x_doc_lang", AR_EN, {
    default_value: "ar",
    field_description: "لغة المستند المفضلة",
  });

  // doc models: ar/en/bi, not required
  for (const model of ["x_quotation", "sale.order", "x_invoice", "x_payment", "x_delivery_stop"]) {
    console.log(`${model}.x_doc_lang`);
    await langField(model, "x_doc_lang", AR_EN_BI, {
      field_description: "لغة المستند",
    });
  }

  // official-doc: ar/en, default ar
  console.log("x_official_doc.x_lang");
  await langField("x_official_doc", "x_lang", AR_EN, {
    default_value: "ar",
    field_description: "لغة المستند",
  });

  // -------------------- company bilingual --------------------
  for (const [name, label] of [
    ["x_legal_name_ar", "الاسم القانوني (عربي)"],
    ["x_legal_name_en", "الاسم القانوني (إنجليزي)"],
    ["x_address_ar", "العنوان (عربي)"],
    ["x_address_en", "العنوان (إنجليزي)"],
  ]) {
    console.log(`res.company.${name}`);
    await ensureField("res.company", name, "char", {
      field_description: label,
    });
  }

  // -------------------- product bilingual names --------------------
  console.log("product.template.x_name_en");
  await ensureField("product.template", "x_name_en", "char", {
    field_description: "الاسم بالإنجليزي",
  });
  console.log("x_product_packaging.x_name_en");
  await ensureField("x_product_packaging", "x_name_en", "char", {
    field_description: "الاسم بالإنجليزي",
  });

  // -------------------- views --------------------
  console.log("\n--- Views ---");

  // res.partner form — add lang under the "الأخرى" tab or right side of Sales area.
  // Odoo 19 the safest xpath is expr="//sheet/notebook" — we position after
  // the sheet. Fall back: after "vat" field on res.partner.
  await ensureView({
    name: "res.partner.form.x_doc_lang",
    model: "res.partner",
    inherit_id: 124,
    arch: `<data><xpath expr="//field[@name='vat']" position="after"><field name="x_doc_lang" widget="radio" options="{'horizontal': true}"/></xpath></data>`,
  });

  // res.company form — add bilingual name/address group after root sheet.
  await ensureView({
    name: "res.company.form.x_bilingual",
    model: "res.company",
    inherit_id: 115,
    arch: `<data><xpath expr="//field[@name='name']" position="after">
      <field name="x_legal_name_ar"/>
      <field name="x_legal_name_en"/>
      <field name="x_address_ar"/>
      <field name="x_address_en"/>
    </xpath></data>`,
  });

  // product.template form — add x_name_en next to name.
  await ensureView({
    name: "product.template.form.x_name_en",
    model: "product.template",
    inherit_id: 559,
    arch: `<data><xpath expr="//field[@name='name']" position="after"><field name="x_name_en"/></xpath></data>`,
  });

  // x_official_doc form — add x_lang widget=radio horizontal at top-of-form.
  // Locate the existing form view (#2804 created in earlier commit).
  await ensureView({
    name: "x_official_doc.form.x_lang",
    model: "x_official_doc",
    inherit_id: 2804,
    arch: `<data><xpath expr="//field[@name='x_doc_type']" position="after">
      <field name="x_lang" widget="radio" options="{'horizontal': true}"/>
    </xpath></data>`,
  });

  // x_quotation / x_invoice / x_payment / x_delivery_stop / sale.order:
  // Find their first root form and inject x_doc_lang.
  const docModelForms = [
    { model: "x_quotation", name: "x_quotation.form.x_doc_lang" },
    { model: "x_invoice", name: "x_invoice.form.x_doc_lang" },
    { model: "x_payment", name: "x_payment.form.x_doc_lang" },
    { model: "x_delivery_stop", name: "x_delivery_stop.form.x_doc_lang" },
    { model: "sale.order", name: "sale.order.form.x_doc_lang" },
  ];
  for (const spec of docModelForms) {
    const roots = await call("ir.ui.view", "search_read", {
      domain: [["model", "=", spec.model], ["type", "=", "form"], ["inherit_id", "=", false]],
      fields: ["id", "name"], limit: 1,
    });
    if (roots.length === 0) {
      console.log(`  [skip] ${spec.model} — no root form to inherit`);
      continue;
    }
    await ensureView({
      name: spec.name,
      model: spec.model,
      inherit_id: roots[0].id,
      arch: `<data><xpath expr="//sheet" position="inside"><group><field name="x_doc_lang" widget="radio" options="{'horizontal': true}"/></group></xpath></data>`,
    });
  }

  // x_product_packaging list — add x_name_en column.
  const packListRoots = await call("ir.ui.view", "search_read", {
    domain: [["model", "=", "x_product_packaging"], ["type", "=", "list"], ["inherit_id", "=", false]],
    fields: ["id", "name"], limit: 1,
  });
  if (packListRoots.length > 0) {
    await ensureView({
      name: "x_product_packaging.list.x_name_en",
      model: "x_product_packaging",
      inherit_id: packListRoots[0].id,
      arch: `<data><xpath expr="//list" position="inside"><field name="x_name_en" optional="show"/></xpath></data>`,
    });
  } else {
    console.log("  [skip] x_product_packaging — no root list view to inherit");
  }

  console.log(`\n=== Done (${APPLY ? "applied" : "dry-run"}) ===`);
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
