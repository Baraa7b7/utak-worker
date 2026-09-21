// UTAK — Accounting readiness audit, 2026-09-21
//
// READ-ONLY. No create/write/unlink calls to Odoo. No Meta/Graph calls.
// Uses search_read / search_count / read_group / fields_get only.
//
// Purpose: enumerate the current Odoo tenant's state so we can judge exactly
// what is missing before Odoo can produce the standard financial statements
// (Balance Sheet, Profit & Loss, Trial Balance) end-to-end.
//
// Output: writes a snapshot JSON to scripts/artifacts/ and prints the same
// summary to stdout. The report is written separately by hand from these
// results into docs/audit-20260921-accounting-readiness.md.
//
// Requires .env.sim-verify (ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: .env.sim-verify missing one of ODOO_URL/DB/LOGIN/API_KEY");
  process.exit(1);
}

const ALLOWED_METHODS = new Set([
  "search_read",
  "search_count",
  "fields_get",
  "read_group",
  "read",
  "get_views",
]);

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
  const m = res.headers.get("set-cookie")?.match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`FORBIDDEN write attempt: ${model}.${method}`);
  }
  const url = `${ODOO_URL}/json/2/${model}/${method}`;
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  if (auth.mode === "session") headers["Cookie"] = auth.cookie;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${(parsed?.data?.message ?? text).toString().slice(0, 400)}`);
  }
  return parsed;
}

const REDACT_KEYS = new Set(["password", "api_key", "token", "cookie"]);
function safe(v) {
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (REDACT_KEYS.has(k.toLowerCase())) v[k] = "<redacted>";
    }
  }
  return v;
}

// -------------------- 1) Installed modules --------------------
async function installedModules() {
  const wanted = [
    "sale", "sale_management",
    "purchase",
    "account", "account_accountant",
    "stock",
    "crm",
    "hr", "hr_expense",
    "l10n_sa", "l10n_sa_edi",
    "web_studio",
    "mail",
  ];
  const rows = await call("ir.module.module", "search_read", {
    domain: [["name", "in", wanted]],
    fields: ["name", "state", "shortdesc", "installed_version"],
  });
  const map = {};
  for (const n of wanted) map[n] = { state: "not_present" };
  for (const r of rows) {
    map[r.name] = { state: r.state, version: r.installed_version, shortdesc: r.shortdesc };
  }
  return map;
}

// -------------------- 2) Standard model counts --------------------
// read_group is blocked on JSON-2 for many models on this tenant, so we
// enumerate the plausible values and search_count each.
async function countsByField(model, field, values) {
  const out = { total: null, by: {} };
  try { out.total = await call(model, "search_count", { domain: [] }); }
  catch (e) { out.total = `error: ${e.message.slice(0, 160)}`; return out; }
  for (const v of values) {
    try {
      out.by[String(v)] = await call(model, "search_count", { domain: [[field, "=", v]] });
    } catch (e) { out.by[String(v)] = `error: ${e.message.slice(0, 120)}`; }
  }
  return out;
}

async function standardCounts() {
  const out = {};
  out.sale_order_by_state = await countsByField("sale.order", "state",
    ["draft", "sent", "sale", "done", "cancel"]);
  out.purchase_order_by_state = await countsByField("purchase.order", "state",
    ["draft", "sent", "to approve", "purchase", "done", "cancel"]);
  out.account_move_by_type = await countsByField("account.move", "move_type",
    ["out_invoice", "out_refund", "in_invoice", "in_refund",
     "out_receipt", "in_receipt", "entry"]);
  out.account_move_by_state = await countsByField("account.move", "state",
    ["draft", "posted", "cancel"]);
  out.account_payment_by_state = await countsByField("account.payment", "state",
    ["draft", "in_process", "posted", "sent", "canceled", "cancel", "rejected"]);
  out.stock_picking_by_state = await countsByField("stock.picking", "state",
    ["draft", "waiting", "confirmed", "assigned", "done", "cancel"]);

  const singles = [
    "account.bank.statement.line",
    "stock.picking",
    "stock.quant",
    "crm.lead",
    "hr.employee",
    "hr.expense",
  ];
  out.single_counts = {};
  for (const m of singles) {
    out.single_counts[m] = await call(m, "search_count", { domain: [] })
      .catch((e) => `error: ${e.message.slice(0, 120)}`);
  }
  return out;
}

// -------------------- 3) Custom x_* models --------------------
async function customModels() {
  const rows = await call("ir.model", "search_read", {
    domain: [["model", "=like", "x_%"]],
    fields: ["model", "name", "transient", "modules"],
    order: "model asc",
    limit: 500,
  });
  const results = [];
  for (const r of rows) {
    const model = r.model;
    let count = null, lastWrite = null, err = null;
    try {
      count = await call(model, "search_count", { domain: [] });
      if (count > 0) {
        const [row] = await call(model, "search_read", {
          domain: [], fields: ["id", "write_date"],
          order: "write_date desc", limit: 1,
        });
        lastWrite = row?.write_date ?? null;
      }
    } catch (e) { err = e.message.slice(0, 200); }
    results.push({ model, name: r.name, transient: r.transient, count, last_write: lastWrite, error: err });
  }
  results.sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
  return results;
}

// -------------------- 4) Accounting readiness --------------------
async function accountingReadiness() {
  const out = {};

  // Company
  try {
    const companyFields = await call("res.company", "fields_get", {
      allfields: [], attributes: ["type", "string"],
    });
    const lockDateFields = Object.keys(companyFields).filter(
      (n) => /lock_date$/.test(n) || /^(fiscalyear|period)_lock/.test(n) || n === "tax_lock_date",
    );
    const baseFields = [
      "id", "name", "country_id", "vat", "currency_id",
      "fiscalyear_last_month", "fiscalyear_last_day",
      "account_sale_tax_id", "account_purchase_tax_id",
      "chart_template",
      "account_fiscal_country_id",
    ];
    const wantFields = baseFields
      .concat(lockDateFields)
      .filter((f) => Object.prototype.hasOwnProperty.call(companyFields, f));
    const companies = await call("res.company", "search_read", {
      domain: [], fields: wantFields,
    });
    out.company = { fields_used: wantFields, rows: companies, lock_date_fields_seen: lockDateFields };
  } catch (e) { out.company = { error: e.message.slice(0, 200) }; }

  // Journals
  try {
    const journals = await call("account.journal", "search_read", {
      domain: [], fields: ["id", "name", "code", "type", "active", "currency_id", "default_account_id"],
      order: "type asc, code asc", limit: 100,
    });
    for (const j of journals) {
      j.move_count = await call("account.move", "search_count", { domain: [["journal_id", "=", j.id]] });
    }
    out.journals = journals;
  } catch (e) { out.journals = { error: e.message.slice(0, 200) }; }

  // Accounts by account_type — read_group is blocked on this tenant, so
  // enumerate rows and count client-side.
  try {
    out.account_total = await call("account.account", "search_count", { domain: [] });
    const rows = await call("account.account", "search_read", {
      domain: [], fields: ["id", "code", "name", "account_type"],
      order: "code asc", limit: 5000,
    });
    const by = {};
    for (const r of rows) {
      const t = r.account_type || "unknown";
      by[t] = (by[t] ?? 0) + 1;
    }
    out.account_by_type = by;
    out.account_sample = rows.slice(0, 40).map((r) => ({ code: r.code, name: r.name, type: r.account_type }));
  } catch (e) { out.account_by_type = { error: e.message.slice(0, 200) }; }

  // Taxes
  try {
    out.tax_active = await call("account.tax", "search_read", {
      domain: [["active", "=", true]],
      fields: ["id", "name", "amount", "amount_type", "type_tax_use"],
      order: "type_tax_use asc, amount desc", limit: 200,
    });
  } catch (e) { out.tax_active = { error: e.message.slice(0, 200) }; }

  // Payment terms
  try {
    out.payment_terms = await call("account.payment.term", "search_read", {
      domain: [], fields: ["id", "name", "active"], limit: 100,
    });
  } catch (e) { out.payment_terms = { error: e.message.slice(0, 200) }; }

  // Products: are income/expense accounts set on product or category?
  try {
    const total = await call("product.product", "search_count", { domain: [] });
    // On product.template we check property_account_income_id / property_account_expense_id
    const tmplWithIncome = await call("product.template", "search_count", {
      domain: [["property_account_income_id", "!=", false]],
    });
    const tmplWithExpense = await call("product.template", "search_count", {
      domain: [["property_account_expense_id", "!=", false]],
    });
    const tmplTotal = await call("product.template", "search_count", { domain: [] });
    // Categories with income/expense
    const catTotal = await call("product.category", "search_count", { domain: [] });
    const catWithIncome = await call("product.category", "search_count", {
      domain: [["property_account_income_categ_id", "!=", false]],
    });
    const catWithExpense = await call("product.category", "search_count", {
      domain: [["property_account_expense_categ_id", "!=", false]],
    });
    // Sample of categories
    const catSample = await call("product.category", "search_read", {
      domain: [], fields: [
        "id", "name",
        "property_account_income_categ_id",
        "property_account_expense_categ_id",
      ], limit: 20,
    });
    // UoM sanity
    const uomCount = await call("uom.uom", "search_count", { domain: [] });
    out.products = {
      product_product_count: total,
      product_template_count: tmplTotal,
      tmpl_with_income_account: tmplWithIncome,
      tmpl_with_expense_account: tmplWithExpense,
      category_count: catTotal,
      category_with_income_account: catWithIncome,
      category_with_expense_account: catWithExpense,
      category_sample: catSample,
      uom_count: uomCount,
    };
  } catch (e) { out.products = { error: e.message.slice(0, 200) }; }

  // Partners: receivable/payable coverage
  try {
    const partnerTotal = await call("res.partner", "search_count", { domain: [] });
    const customerCount = await call("res.partner", "search_count", {
      domain: [["customer_rank", ">", 0]],
    }).catch(() => "field missing");
    const supplierCount = await call("res.partner", "search_count", {
      domain: [["supplier_rank", ">", 0]],
    }).catch(() => "field missing");
    const withRecv = await call("res.partner", "search_count", {
      domain: [["property_account_receivable_id", "!=", false]],
    }).catch((e) => `error: ${e.message.slice(0, 120)}`);
    const withPay = await call("res.partner", "search_count", {
      domain: [["property_account_payable_id", "!=", false]],
    }).catch((e) => `error: ${e.message.slice(0, 120)}`);
    out.partners = {
      partner_total: partnerTotal,
      customer_count: customerCount,
      supplier_count: supplierCount,
      with_receivable_set: withRecv,
      with_payable_set: withPay,
    };
  } catch (e) { out.partners = { error: e.message.slice(0, 200) }; }

  // Account move counters that reveal whether GL is being fed
  try {
    out.gl_signals = {
      posted_moves: await call("account.move", "search_count", { domain: [["state", "=", "posted"]] }),
      draft_moves: await call("account.move", "search_count", { domain: [["state", "=", "draft"]] }),
      account_move_line_count: await call("account.move.line", "search_count", { domain: [] }),
      posted_move_lines: await call("account.move.line", "search_count", {
        domain: [["parent_state", "=", "posted"]],
      }).catch((e) => `error: ${e.message.slice(0, 120)}`),
    };
  } catch (e) { out.gl_signals = { error: e.message.slice(0, 200) }; }

  return out;
}

async function main() {
  console.log(`Audit — ${new Date().toISOString()} — DB=${ODOO_DB} URL=${ODOO_URL.replace(/^https?:\/\//, "")}`);
  const report = {
    generated_at: new Date().toISOString(),
    tenant: { db: ODOO_DB, url: ODOO_URL.replace(/^https?:\/\//, "") },
  };

  console.log("• modules");
  report.modules = await installedModules();

  console.log("• standard counts");
  report.standard = await standardCounts();

  console.log("• custom x_* models");
  report.custom_models = await customModels();

  console.log("• accounting readiness");
  report.accounting = await accountingReadiness();

  // Persist
  const dir = new URL("./artifacts/", import.meta.url);
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const outPath = new URL("./artifacts/audit-20260921-accounting-readiness.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify(safe(report), null, 2), "utf8");
  console.log(`\nJSON snapshot: ${outPath.pathname}`);

  // Console summary
  const nonEmptyCustom = report.custom_models.filter((r) => (r.count ?? 0) > 0);
  console.log(`\n== summary ==`);
  console.log(`modules installed: ${Object.entries(report.modules).filter(([, v]) => v.state === "installed").map(([n]) => n).join(", ")}`);
  console.log(`custom x_* models with rows: ${nonEmptyCustom.length}`);
  console.log(`account.move total: ${JSON.stringify(report.standard.account_move_by_state)}`);
  console.log(`account.move.line total: ${report.accounting.gl_signals?.account_move_line_count}`);
  console.log(`journals: ${Array.isArray(report.accounting.journals) ? report.accounting.journals.length : "error"}`);
  console.log(`account.account total: ${report.accounting.account_total}`);
}

main().catch((e) => { console.error("AUDIT FAILED:", e); process.exit(1); });
