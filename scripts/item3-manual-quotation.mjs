// Item 3 (tonight 2026-09-17) — manual quotation on the same pipeline.
//
// Idempotent. Adds:
//   * x_quotation.x_origin (selection: auto/manual, default auto)
//   * x_daily_order_line.x_price_unit_manual (float, optional)
//   * ir.actions.server: quotation.manual_wa_send (state=webhook) that
//     POSTs to /internal/quotation-wa-send on the Worker
//   * inherited form view on x_quotation with two buttons visible when
//     x_origin='manual': "إصدار PDF" (fires the existing /internal/
//     quotation-issue webhook via the auto-action model_id) and
//     "إرسال واتساب" (fires quotation.manual_wa_send).
//
// Requires .env.sim-verify (ODOO_URL/DB/LOGIN/API_KEY) + ODOO_HOOK_TOKEN +
// optional WORKER_ORIGIN.

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
const HOOK_TOKEN = process.env.ODOO_HOOK_TOKEN;
const WORKER_ORIGIN =
  process.env.WORKER_ORIGIN || "https://utak-worker-sim.utak-business.workers.dev";

if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: .env.sim-verify missing keys");
  process.exit(1);
}
if (!HOOK_TOKEN) {
  console.error("STOP: set ODOO_HOOK_TOKEN in the process env");
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
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") {
      await session();
      return call(model, method, body);
    }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${
      parsed?.data?.message ?? text.slice(0, 400)
    }`);
  }
  return parsed;
}

async function findModelId(technicalName) {
  const rows = await call("ir.model", "search_read", {
    domain: [["model", "=", technicalName]],
    fields: ["id"],
    limit: 1,
  });
  return rows[0]?.id ?? null;
}

async function fieldExists(model, fieldName) {
  const rows = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", model], ["name", "=", fieldName]],
    fields: ["id"],
    limit: 1,
  });
  return rows[0]?.id ?? null;
}

async function ensureXOriginField() {
  const modelId = await findModelId("x_quotation");
  if (!modelId) throw new Error("x_quotation model not found");
  const existing = await fieldExists("x_quotation", "x_origin");
  if (existing) return { id: existing, action: "existed" };
  const ids = await call("ir.model.fields", "create", {
    vals_list: [{
      model_id: modelId,
      name: "x_origin",
      field_description: "المصدر",
      ttype: "selection",
      selection: "[('auto', 'آلي'), ('manual', 'يدوي')]",
    }],
  });
  return { id: ids[0], action: "created" };
}

async function ensurePriceUnitManualField() {
  const modelId = await findModelId("x_daily_order_line");
  if (!modelId) throw new Error("x_daily_order_line model not found");
  const existing = await fieldExists("x_daily_order_line", "x_price_unit_manual");
  if (existing) return { id: existing, action: "existed" };
  const ids = await call("ir.model.fields", "create", {
    vals_list: [{
      model_id: modelId,
      name: "x_price_unit_manual",
      field_description: "سعر يدوي للوحدة",
      ttype: "float",
    }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureManualWaSendAction() {
  const modelId = await findModelId("x_quotation");
  const name = "quotation.manual_wa_send";
  const url = `${WORKER_ORIGIN}/internal/quotation-wa-send?token=${HOOK_TOKEN}`;
  const existing = await call("ir.actions.server", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) {
    await call("ir.actions.server", "write", {
      ids: [existing[0].id],
      vals: { webhook_url: url, model_id: modelId, state: "webhook" },
    });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.actions.server", "create", {
    vals_list: [{
      name,
      model_id: modelId,
      state: "webhook",
      webhook_url: url,
    }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureManualPdfAction() {
  const modelId = await findModelId("x_quotation");
  const name = "quotation.manual_pdf_build";
  const url = `${WORKER_ORIGIN}/internal/quotation-issue?token=${HOOK_TOKEN}`;
  const existing = await call("ir.actions.server", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) {
    await call("ir.actions.server", "write", {
      ids: [existing[0].id],
      vals: { webhook_url: url, model_id: modelId, state: "webhook" },
    });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.actions.server", "create", {
    vals_list: [{
      name,
      model_id: modelId,
      state: "webhook",
      webhook_url: url,
    }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureQuotationFormView(pdfActionId, waActionId) {
  const name = "x_quotation.form.utak_manual_buttons";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  const baseRows = await call("ir.ui.view", "search_read", {
    domain: [
      ["model", "=", "x_quotation"],
      ["type", "=", "form"],
      ["inherit_id", "=", false],
    ],
    fields: ["id"],
    limit: 1,
  });
  const baseId = baseRows[0]?.id;
  if (!baseId) throw new Error("no base x_quotation form view");
  const arch = `
    <data>
      <xpath expr="//sheet" position="before">
        <header>
          <field name="x_origin" widget="statusbar"/>
          <button name="${pdfActionId}" string="إصدار PDF" type="action"
                  class="oe_highlight"/>
          <button name="${waActionId}" string="إرسال واتساب" type="action"
                  class="btn-primary"
                  confirm="متأكد؟ ينشئ رسالة واتساب من نوع مستند ويرسلها فوراً."/>
        </header>
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
    vals_list: [{
      name,
      model: "x_quotation",
      inherit_id: baseId,
      priority: 40,
      arch_base: arch,
    }],
  });
  return { id: ids[0], action: "created" };
}

async function main() {
  console.log("Item 3 migration — starting");
  const originF = await ensureXOriginField();
  console.log("[x_quotation.x_origin]", originF);
  const priceF = await ensurePriceUnitManualField();
  console.log("[x_daily_order_line.x_price_unit_manual]", priceF);
  const pdfAct = await ensureManualPdfAction();
  console.log("[server action: manual_pdf_build]", pdfAct);
  const waAct = await ensureManualWaSendAction();
  console.log("[server action: manual_wa_send]", waAct);
  const view = await ensureQuotationFormView(pdfAct.id, waAct.id);
  console.log("[quotation form view]", view);
  console.log("\n--- summary ---");
  console.log(JSON.stringify({
    x_origin: originF,
    x_price_unit_manual: priceF,
    pdf_action_id: pdfAct.id,
    wa_action_id: waAct.id,
    view_id: view.id,
    webhook_pdf_url_masked: `${WORKER_ORIGIN}/internal/quotation-issue?token=${HOOK_TOKEN.slice(0,4)}…`,
    webhook_wa_url_masked: `${WORKER_ORIGIN}/internal/quotation-wa-send?token=${HOOK_TOKEN.slice(0,4)}…`,
  }, null, 2));
}

main().catch((e) => {
  console.error("ITEM 3 MIGRATION FAILED:", e);
  process.exit(1);
});
