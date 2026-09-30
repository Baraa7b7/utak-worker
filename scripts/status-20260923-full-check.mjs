// UTAK — فحص الحالة الشامل، 2026-09-23
//
// للقراءة فقط، idempotent. يُشغَّل أي عدد من المرات بنفس الأثر (لا أثر).
//   Odoo:  search_read / search_count / fields_get / read_group / read فقط —
//          أي method آخر يرمي خطأ قبل الإرسال (ALLOWED_METHODS).
//   Graph: GET فقط على /{WABA_ID}/message_templates — أي method آخر يرمي خطأ.
//   لا wrangler، لا نشر، لا تعديل في src/.
//
// لا يطبع أي سر: التوكن يُقرأ من .env.sim-verify ويُرسل في header فقط.
//
// المخرجات: scripts/artifacts/status-20260923-full-check.json + ملخص على stdout.
// التقرير المكتوب يدوياً من هذه النتائج: docs/STATUS.md
//
// الاستخدام:  node scripts/status-20260923-full-check.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, META_ACCESS_TOKEN } = env;
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: .env.sim-verify ناقص ODOO_URL/DB/LOGIN/API_KEY");
  process.exit(1);
}
const WABA_ID = "2144001136512196";
const GRAPH_V = "v22.0";
const TEST_PARTNER_ID = 48;

// ---------------------------------------------------------------- Odoo (read-only)
const ALLOWED_METHODS = new Set(["search_read", "search_count", "fields_get", "read_group", "read"]); // read_group مسموح لكنه غير مستخدم (404 على json/2)
let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = res.headers.get("set-cookie")?.match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body = {}, attempt = 0) {
  if (!ALLOWED_METHODS.has(method)) throw new Error(`FORBIDDEN: ${model}.${method}`);
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers.Authorization = `Bearer ${ODOO_API_KEY}`;
  else headers.Cookie = auth.cookie;
  await new Promise((r) => setTimeout(r, 150)); // تخفيف الضغط لتفادي 429
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); return call(model, method, body, attempt + 1); }
    throw new Error(`HTTP ${res.status} ${model}.${method}: ${String(parsed?.message ?? parsed?.data?.message ?? text).slice(0, 300)}`);
  }
  return parsed;
}
const sr = (model, domain, fields, extra = {}) => call(model, "search_read", { domain, fields, ...extra });
const sc = (model, domain) => call(model, "search_count", { domain });
// read_group غير متاح على /json/2 في هذا الإصدار (404) — نجمّع محلياً من search_read.
// fields بصيغة "debit:sum" تُجمع؛ groupby يُطابق القيمة (m2o → [id,name]).
async function rg(model, domain, fields, groupby) {
  const plain = [...new Set([...groupby, ...fields.map((f) => f.split(":")[0])])];
  const rows = await sr(model, domain, plain);
  const groups = new Map();
  for (const r of rows) {
    const key = JSON.stringify(groupby.map((g) => r[g]));
    if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(groupby.map((g) => [g, r[g]])), __count: 0 });
    const g = groups.get(key); g.__count++;
    for (const f of fields) { const [n, agg] = f.split(":"); if (agg === "sum") g[n] = (g[n] ?? 0) + (r[n] ?? 0); }
  }
  return [...groups.values()];
}
const fg = (model, attributes = ["type", "string", "relation"]) => call(model, "fields_get", { attributes });
const m2o = (v) => (Array.isArray(v) ? { id: v[0], name: v[1] } : v || null);

// ---------------------------------------------------------------- Graph (GET only)
async function graphGet(path) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_V}${path}`);
  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } });
  const j = await res.json();
  if (!res.ok) throw new Error(`Graph HTTP ${res.status}: ${j?.error?.message ?? "?"}`);
  return j;
}

const out = { generated_at: new Date().toISOString(), sections: {} };
async function section(name, fn) {
  try { out.sections[name] = await fn(); console.log(`✓ ${name}`); }
  catch (e) { out.sections[name] = { error: String(e.message ?? e) }; console.log(`✗ ${name}: ${e.message}`); }
}

// ================================================================ 2) إصلاح قيد التحصيل
await section("payment_fix_journals", async () => {
  const jf = await fg("account.journal");
  const inboundField = ["inbound_payment_method_line_ids"].find((f) => jf[f]);
  const journals = await sr("account.journal", [["code", "in", ["CSHD", "BNK1"]]],
    ["id", "code", "name", "type", "default_account_id", "suspense_account_id", inboundField].filter(Boolean));
  const accIds = new Set();
  const lineIds = journals.flatMap((j) => j[inboundField] ?? []);
  const plf = await fg("account.payment.method.line");
  const lines = lineIds.length
    ? await sr("account.payment.method.line", [["id", "in", lineIds]],
        ["id", "name", "journal_id", "payment_method_id", "payment_type", "payment_account_id"].filter((f) => plf[f]))
    : [];
  for (const j of journals) { if (j.default_account_id) accIds.add(j.default_account_id[0]); if (j.suspense_account_id) accIds.add(j.suspense_account_id[0]); }
  for (const l of lines) if (l.payment_account_id) accIds.add(l.payment_account_id[0]);
  const accs = accIds.size ? await sr("account.account", [["id", "in", [...accIds]]], ["id", "code", "name", "account_type", "reconcile"]) : [];
  const accById = Object.fromEntries(accs.map((a) => [a.id, a]));
  const co = await sr("res.company", [], ["id", "account_journal_payment_debit_account_id"].filter(Boolean)).catch(() => []);
  return {
    journals: journals.map((j) => ({
      id: j.id, code: j.code, name: j.name, type: j.type,
      default_account: j.default_account_id ? accById[j.default_account_id[0]] : null,
      suspense_account: j.suspense_account_id ? accById[j.suspense_account_id[0]] : null,
      inbound_lines: lines.filter((l) => (j[inboundField] ?? []).includes(l.id)).map((l) => ({
        id: l.id, name: l.name, payment_method: m2o(l.payment_method_id)?.name, payment_type: l.payment_type,
        payment_account: l.payment_account_id ? accById[l.payment_account_id[0]] : null,
      })),
    })),
    company_outstanding_receipts_account: co[0]?.account_journal_payment_debit_account_id ?? null,
  };
});

// ================================================================ 3) المحاسبة الفعلية
await section("accounting_counts", async () => {
  const moves = await rg("account.move", [], ["move_type", "state"], ["move_type", "state"]);
  const payments = await rg("account.payment", [], ["state"], ["state"]);
  return {
    account_move_by_type_state: moves.map((g) => ({ move_type: g.move_type, state: g.state, count: g.__count })),
    account_move_total: await sc("account.move", []),
    account_payment_by_state: payments.map((g) => ({ state: g.state, count: g.__count })),
    account_payment_total: await sc("account.payment", []),
    account_move_line_total: await sc("account.move.line", []),
  };
});

await section("moves_detail", async () => {
  const moves = await sr("account.move", [], ["id", "name", "move_type", "state", "partner_id", "date", "invoice_date",
    "amount_total", "amount_untaxed", "amount_tax", "journal_id", "ref", "payment_state"], { order: "id asc" });
  const lines = moves.length ? await sr("account.move.line", [["move_id", "in", moves.map((m) => m.id)]],
    ["id", "move_id", "account_id", "debit", "credit", "name", "partner_id", "tax_ids"], { order: "move_id asc, id asc" }) : [];
  const accIds = [...new Set(lines.map((l) => l.account_id?.[0]).filter(Boolean))];
  const accs = accIds.length ? await sr("account.account", [["id", "in", accIds]], ["id", "code", "name", "account_type"]) : [];
  const accById = Object.fromEntries(accs.map((a) => [a.id, a]));
  const payments = await sr("account.payment", [], ["id", "name", "state", "partner_id", "date", "amount", "journal_id",
    "payment_type", "move_id", "is_reconciled"].filter(Boolean), { order: "id asc" }).catch(async () =>
    sr("account.payment", [], ["id", "name", "state", "partner_id", "date", "amount", "journal_id", "payment_type", "move_id"]));
  const tag = (p) => (p && p[0] === TEST_PARTNER_ID ? "test-48" : "real");
  return {
    moves: moves.map((m) => ({
      id: m.id, name: m.name, move_type: m.move_type, state: m.state, partner: m2o(m.partner_id), class: tag(m.partner_id),
      date: m.date, amount_total: m.amount_total, amount_tax: m.amount_tax, journal: m2o(m.journal_id)?.name, ref: m.ref,
      payment_state: m.payment_state,
      lines: lines.filter((l) => l.move_id[0] === m.id).map((l) => ({
        account: accById[l.account_id?.[0]]?.code, account_name: accById[l.account_id?.[0]]?.name,
        account_type: accById[l.account_id?.[0]]?.account_type, debit: l.debit, credit: l.credit, label: l.name,
      })),
    })),
    payments: payments.map((p) => ({ ...p, partner_id: m2o(p.partner_id), journal_id: m2o(p.journal_id), move_id: m2o(p.move_id), class: tag(p.partner_id) })),
  };
});

await section("trial_balance", async () => {
  const groups = await rg("account.move.line", [], ["account_id", "debit:sum", "credit:sum", "balance:sum"], ["account_id", "parent_state"]);
  const accIds = [...new Set(groups.map((g) => g.account_id?.[0]).filter(Boolean))];
  const accs = accIds.length ? await sr("account.account", [["id", "in", accIds]], ["id", "code", "name", "account_type"]) : [];
  const accById = Object.fromEntries(accs.map((a) => [a.id, a]));
  const rows = groups.map((g) => ({
    code: accById[g.account_id?.[0]]?.code, name: accById[g.account_id?.[0]]?.name, account_type: accById[g.account_id?.[0]]?.account_type,
    parent_state: g.parent_state, debit: g.debit, credit: g.credit, balance: g.balance, lines: g.__count,
  })).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.parent_state).localeCompare(String(b.parent_state)));
  const posted = rows.filter((r) => r.parent_state === "posted");
  return {
    rows,
    posted_totals: { debit: posted.reduce((s, r) => s + r.debit, 0), credit: posted.reduce((s, r) => s + r.credit, 0) },
  };
});

await section("capital_300010", async () => {
  const acc = await sr("account.account", [["code", "=", "300010"]], ["id", "code", "name", "account_type"]);
  if (!acc.length) return { exists: false };
  return { account: acc[0], move_lines: await sc("account.move.line", [["account_id", "=", acc[0].id]]),
    posted_lines: await sc("account.move.line", [["account_id", "=", acc[0].id], ["parent_state", "=", "posted"]]) };
});

await section("company", async () => {
  const f = await fg("res.company");
  const lockFields = Object.keys(f).filter((k) => /lock/.test(k) && f[k].type === "date");
  const stampSig = Object.keys(f).filter((k) => /stamp|seal|signature|sign_|ختم/i.test(k)).map((k) => ({ field: k, type: f[k].type, string: f[k].string }));
  const custom = Object.keys(f).filter((k) => k.startsWith("x_")).map((k) => ({ field: k, type: f[k].type, string: f[k].string }));
  const want = ["id", "name", "vat", "company_registry", "country_id", "currency_id", "fiscalyear_last_day", "fiscalyear_last_month",
    "account_sale_tax_id", "account_purchase_tax_id", "street", "street2", "city", "zip", "phone", "email", "partner_id",
    "chart_template", "account_fiscal_country_id", ...lockFields, ...custom.map((c) => c.field)].filter((k) => f[k]);
  const rows = await sr("res.company", [], want.filter((k) => !["binary", "image"].includes(f[k].type)));
  const binaryCustom = custom.filter((c) => c.type === "binary");
  // binary custom fields: presence only, never the payload
  const binaryPresence = {};
  for (const c of binaryCustom) binaryPresence[c.field] = (await sc("res.company", [[c.field, "!=", false]])) > 0;
  const pf = await fg("res.partner");
  const partnerFields = Object.keys(pf).filter((k) => /^l10n_sa|^x_|company_registry/.test(k) && !["binary", "one2many", "many2many"].includes(pf[k].type));
  const partner = rows[0]?.partner_id ? (await call("res.partner", "read", { ids: [rows[0].partner_id[0]], fields: ["name", "vat", ...partnerFields] }))[0] : null;
  const saIdFields = Object.keys(pf).filter((k) => /^l10n_sa/.test(k));
  const partnerNonEmpty = partner ? Object.fromEntries(Object.entries(partner).filter(([, v]) => v !== false && v !== "" && v !== null)) : null;
  return { lock_fields: lockFields, stamp_signature_fields: stampSig, custom_fields: custom, companies: rows, binary_presence: binaryPresence, company_partner_non_empty: partnerNonEmpty, partner_l10n_sa_fields: saIdFields };
});

await section("taxes_products", async () => {
  const taxes = await sr("account.tax", [["amount", "=", 15], ["active", "=", true]], ["id", "name", "type_tax_use", "amount", "amount_type", "price_include"].filter(Boolean));
  const pf = await fg("product.template");
  const total = await sc("product.template", []);
  const withSale = await sc("product.template", [["taxes_id", "!=", false]]);
  const withSupp = await sc("product.template", [["supplier_taxes_id", "!=", false]]);
  const byType = await rg("product.template", [], ["type"], ["type"]);
  const saleOk = await sc("product.template", [["sale_ok", "=", true]]);
  const activeForSale = pf.x_is_active_for_sale ? await sc("product.template", [["x_is_active_for_sale", "=", true]]) : null;
  const storable = pf.is_storable ? await sc("product.template", [["is_storable", "=", true]]) : null;
  return {
    taxes_15_active: taxes, product_template_total: total, with_taxes_id: withSale, with_supplier_taxes_id: withSupp,
    by_type: byType.map((g) => ({ type: g.type, count: g.__count })), is_storable_true: storable,
    sale_ok: saleOk, x_is_active_for_sale: activeForSale,
  };
});

await section("modules", async () => {
  const names = ["l10n_sa", "l10n_sa_edi", "l10n_sa_pos", "account", "account_accountant", "stock", "purchase", "sale_management", "hr_expense", "hr_payroll", "stock_account"];
  const rows = await sr("ir.module.module", [["name", "in", names]], ["name", "state"]);
  return Object.fromEntries(names.map((n) => [n, rows.find((r) => r.name === n)?.state ?? "not-present"]));
});

// ================================================================ 4) نماذج x_*
await section("x_models", async () => {
  const models = await sr("ir.model", [["model", "=like", "x\\_%"]], ["model", "name"], { order: "model asc" });
  const res = [];
  for (const m of models) {
    try {
      const count = await sc(m.model, []);
      const last = count ? await sr(m.model, [], ["id", "create_date"], { order: "create_date desc", limit: 1 }) : [];
      res.push({ model: m.model, name: m.name, count, last_create_date: last[0]?.create_date ?? null });
    } catch (e) { res.push({ model: m.model, name: m.name, error: String(e.message).slice(0, 120) }); }
  }
  return res;
});

await section("standard_models_counts", async () => {
  const ms = ["sale.order", "purchase.order", "stock.picking", "hr.expense", "hr.payslip", "res.partner", "product.template", "product.supplierinfo"];
  const res = {};
  for (const m of ms) { try { res[m] = await sc(m, []); } catch (e) { res[m] = `n/a (${String(e.message).slice(0, 60)})`; } }
  return res;
});

// ================================================================ 5) قوالب واتساب
await section("wa_templates_meta", async () => {
  if (!META_ACCESS_TOKEN) return { error: "no META_ACCESS_TOKEN in .env.sim-verify" };
  const all = [];
  let path = `/${WABA_ID}/message_templates?limit=200&fields=id,name,status,category,language,components`;
  while (path) {
    const j = await graphGet(path);
    all.push(...(j.data ?? []));
    const next = j.paging?.next;
    path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, "") : null;
  }
  return all.map((t) => {
    const body = (t.components ?? []).find((c) => c.type === "BODY")?.text ?? "";
    const vars = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const header = (t.components ?? []).find((c) => c.type === "HEADER");
    const buttons = (t.components ?? []).find((c) => c.type === "BUTTONS")?.buttons ?? [];
    return { name: t.name, status: t.status, category: t.category, language: t.language, var_count: new Set(vars).size,
      var_order: vars, header_format: header?.format ?? null, buttons: buttons.map((b) => b.type), body };
  }).sort((a, b) => a.name.localeCompare(b.name));
});

await section("wa_templates_odoo", async () => {
  return sr("x_whatsapp_template", [], ["id", "x_meta_template_id", "x_purpose", "x_meta_status", "x_category", "x_language", "x_param_count", "x_label_ar"], { order: "id asc" });
});

// ================================================================ 7) x_wa_message ليلة 02:00
await section("wa_message_supplier_ask", async () => {
  // آخر دورة 02:00 (23:00 UTC): سجلات x_supplier_price_request_log ثم x_wa_message في نفس النافذة.
  const logs = await sr("x_supplier_price_request_log", [], ["id", "create_date", "x_status"], { order: "create_date desc", limit: 5 });
  const last = logs[0]?.create_date;
  if (!last) return { logs: [], wa_rows: [] };
  const from = last.slice(0, 14) + "00:00";
  const to = last.slice(0, 14) + "59:59";
  const wa = await sr("x_wa_message", [["create_date", ">=", from], ["create_date", "<=", to]],
    ["id", "create_date", "x_direction", "x_kind", "x_source", "x_status", "x_template_id", "x_partner_id", "x_meta_error"], { order: "id asc" });
  return {
    last_cycle_window_utc: [from, to],
    logs_in_window: logs.filter((l) => l.create_date >= from && l.create_date <= to),
    wa_rows: wa.map((r) => ({ ...r, x_partner_id: m2o(r.x_partner_id), x_template_id: m2o(r.x_template_id) })),
    total_x_wa_message: await sc("x_wa_message", []),
  };
});

mkdirSync(new URL("./artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("./artifacts/status-20260923-full-check.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nwrote scripts/artifacts/status-20260923-full-check.json");
