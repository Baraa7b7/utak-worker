// Item 1 (2026-09-18) — parallel build: standard sale.order → UTAK
// quotation PDF + WhatsApp send.
//
// Adds (idempotent):
//   * sale.order.line.x_price_unit_manual (float) — Studio field
//   * sale.order.line.x_packaging_id (many2one → x_product_packaging) — Studio field
//   * ir.actions.server "sale.quotation.wa_send" (state=webhook) →
//       POSTs to /internal/sale-quotation-wa-send on the Worker
//   * ir.ui.view "sale.order.form.utak_wa_button" — inherits the standard
//       sale.order form and adds a header button "إرسال واتساب" that fires
//       the server action above.
//
// DOES NOT TOUCH: x_quotation, x_daily_order_line.x_price_unit_manual,
// the 02:00 supplier flow, any cron, any allowlist, or any existing
// server action / automation. If a field or action already exists the
// script updates it in place.
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
    throw new Error(
      `HTTP ${res.status} on ${model}.${method}: ${
        parsed?.data?.message ?? text.slice(0, 400)
      }`,
    );
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

async function findModelIdOrFail(technicalName) {
  const id = await findModelId(technicalName);
  if (!id) throw new Error(`model ${technicalName} not found`);
  return id;
}

async function fieldExists(model, name) {
  const rows = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", model], ["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  return rows[0]?.id ?? null;
}

async function ensureFloatField(model, name, description) {
  const modelId = await findModelIdOrFail(model);
  const existing = await fieldExists(model, name);
  if (existing) return { id: existing, action: "existed" };
  const ids = await call("ir.model.fields", "create", {
    vals_list: [{
      model_id: modelId,
      name,
      field_description: description,
      ttype: "float",
    }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureMany2oneField(model, name, description, relation) {
  const modelId = await findModelIdOrFail(model);
  const existing = await fieldExists(model, name);
  if (existing) return { id: existing, action: "existed" };
  const ids = await call("ir.model.fields", "create", {
    vals_list: [{
      model_id: modelId,
      name,
      field_description: description,
      ttype: "many2one",
      relation,
    }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureServerAction(name, model, path) {
  const modelId = await findModelIdOrFail(model);
  const url = `${WORKER_ORIGIN}${path}?token=${HOOK_TOKEN}`;
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

async function ensureFormView(waActionId) {
  const name = "sale.order.form.utak_wa_button";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  const baseRows = await call("ir.ui.view", "search_read", {
    domain: [
      ["model", "=", "sale.order"],
      ["type", "=", "form"],
      ["inherit_id", "=", false],
    ],
    fields: ["id"],
    limit: 1,
  });
  const baseId = baseRows[0]?.id;
  if (!baseId) throw new Error("no base sale.order form view");
  // Header xpath — sale.order.form ships with a <header> already, so we
  // inject the button *inside* it rather than adding a second header.
  const arch = `
    <data>
      <xpath expr="//header" position="inside">
        <button name="${waActionId}" string="إرسال واتساب (UTAK)"
                type="action" class="btn-primary"
                confirm="متأكد؟ يبني PDF بقالب UTAK ويرسل رسالة واتساب من نوع مستند."/>
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
      model: "sale.order",
      inherit_id: baseId,
      priority: 40,
      arch_base: arch,
    }],
  });
  return { id: ids[0], action: "created" };
}

async function main() {
  console.log("Item 1 (parallel build) migration — starting");

  const priceF = await ensureFloatField(
    "sale.order.line",
    "x_price_unit_manual",
    "سعر يدوي للوحدة",
  );
  console.log("[sale.order.line.x_price_unit_manual]", priceF);

  const pkgF = await ensureMany2oneField(
    "sale.order.line",
    "x_packaging_id",
    "العبوة",
    "x_product_packaging",
  );
  console.log("[sale.order.line.x_packaging_id]", pkgF);

  const waAct = await ensureServerAction(
    "sale.quotation.wa_send",
    "sale.order",
    "/internal/sale-quotation-wa-send",
  );
  console.log("[server action: sale.quotation.wa_send]", waAct);

  const view = await ensureFormView(waAct.id);
  console.log("[sale.order form view]", view);

  console.log("\n--- summary ---");
  console.log(JSON.stringify({
    x_price_unit_manual: priceF,
    x_packaging_id: pkgF,
    wa_action_id: waAct.id,
    view_id: view.id,
    webhook_url_masked: `${WORKER_ORIGIN}/internal/sale-quotation-wa-send?token=${HOOK_TOKEN.slice(0, 4)}…`,
  }, null, 2));
}

main().catch((e) => {
  console.error("ITEM 1 MIGRATION FAILED:", e);
  process.exit(1);
});
