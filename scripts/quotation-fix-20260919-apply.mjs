// 2026-09-19 — Apply script for the quotation-fix change.
//
// One-shot: idempotent where possible, records BEFORE snapshots, writes
// post-apply ids back into scripts/artifacts/quotation-fix-20260919-rollback.json.
//
// Odoo mutations performed here:
//   1. ir.actions.report[433].binding_model_id  — re-asserted to false (no-op)
//   2. res.company[1].quotation_validity_days   — 30 → 0
//   3. ir.actions.server (create)               — Download PDF (UTAK) server action
//   4. ir.ui.view (create)                      — sale.order header button
//
// Nothing here touches WhatsApp send code, PDF template design, or R2.
//
// Usage:
//   node scripts/quotation-fix-20260919-apply.mjs
//
// The script asks for the SALE_PDF_DOWNLOAD_TOKEN value via env (SALE_PDF_DOWNLOAD_TOKEN=...).
// The token is embedded into the ir.actions.server.code as plaintext — same
// pattern as the existing sale.quotation.wa_send action (id=970) whose
// webhook_url embeds ODOO_HOOK_TOKEN.
//
// Base URL for the button is derived from the running worker (sim by default).

import { readFileSync, writeFileSync } from "node:fs";

const ARTIFACT_PATH = new URL(
  "./artifacts/quotation-fix-20260919-rollback.json",
  import.meta.url,
);

const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));

function envFromFile() {
  const raw = readFileSync(
    "/Users/baraa7/utak-worker/.env.sim-verify",
    "utf8",
  );
  const out = {};
  for (const l of raw.split(/\r?\n/)) {
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i < 0) continue;
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}

const fileEnv = envFromFile();
const ODOO_URL = fileEnv.ODOO_URL;
const ODOO_DB = fileEnv.ODOO_DB;
const ODOO_LOGIN = fileEnv.ODOO_LOGIN;
const ODOO_API_KEY = fileEnv.ODOO_API_KEY;
if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
  console.error("STOP: missing Odoo creds in .env.sim-verify");
  process.exit(1);
}

const WORKER_ORIGIN = process.env.WORKER_ORIGIN
  || "https://utak-worker-sim.utak-business.workers.dev";
const SALE_PDF_DOWNLOAD_TOKEN = process.env.SALE_PDF_DOWNLOAD_TOKEN;
if (!SALE_PDF_DOWNLOAD_TOKEN) {
  console.error("STOP: pass SALE_PDF_DOWNLOAD_TOKEN=<value> node scripts/quotation-fix-20260919-apply.mjs");
  console.error("(same value as the one stored via `wrangler secret put SALE_PDF_DOWNLOAD_TOKEN --env sim`)");
  process.exit(1);
}
if (!/^[a-f0-9]{32,128}$/i.test(SALE_PDF_DOWNLOAD_TOKEN)) {
  console.error("STOP: SALE_PDF_DOWNLOAD_TOKEN must be 32-128 hex chars (rotate the secret and try again).");
  process.exit(1);
}

let auth = { mode: "apikey", cookie: null };
async function ses() {
  const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY },
    }),
  });
  const m = (r.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const h = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") h["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else h["Cookie"] = auth.cookie;
  const r = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(model, method, body); }
    throw new Error(`HTTP ${r.status} ${model}.${method}: ${p?.data?.message ?? String(t).slice(0, 300)}`);
  }
  return p;
}

function updateOp(field, value) {
  const idx = artifact.planned_mutations.findIndex((m) => m.field === field);
  if (idx >= 0) artifact.planned_mutations[idx].before = value;
}

// ---------------------------------------------------------------------------
// 1) ir.actions.report[433].binding_model_id — idempotently unbind, log BEFORE
// ---------------------------------------------------------------------------
{
  const [row] = await call("ir.actions.report", "read", {
    ids: [433],
    fields: ["id", "name", "report_name", "binding_model_id", "write_date"],
  });
  console.log(`[1/4] ir.actions.report[433] BEFORE: name=${JSON.stringify(row.name)} binding_model_id=${JSON.stringify(row.binding_model_id)} write_date=${row.write_date}`);
  updateOp("binding_model_id", row.binding_model_id);
  if (row.binding_model_id !== false) {
    await call("ir.actions.report", "write", {
      ids: [433],
      vals: { binding_model_id: false },
    });
    const [after] = await call("ir.actions.report", "read", {
      ids: [433],
      fields: ["binding_model_id"],
    });
    console.log(`     AFTER: binding_model_id=${JSON.stringify(after.binding_model_id)}`);
  } else {
    console.log(`     no-op — already unbound`);
  }
}

// ---------------------------------------------------------------------------
// 2) res.company[1].quotation_validity_days — 30 → 0
// ---------------------------------------------------------------------------
{
  const [row] = await call("res.company", "read", {
    ids: [1],
    fields: ["id", "name", "quotation_validity_days"],
  });
  console.log(`[2/4] res.company[1] BEFORE: name=${row.name} quotation_validity_days=${row.quotation_validity_days}`);
  updateOp("quotation_validity_days", row.quotation_validity_days);
  if (row.quotation_validity_days !== 0) {
    await call("res.company", "write", {
      ids: [1],
      vals: { quotation_validity_days: 0 },
    });
    const [after] = await call("res.company", "read", {
      ids: [1],
      fields: ["quotation_validity_days"],
    });
    console.log(`     AFTER: quotation_validity_days=${after.quotation_validity_days}`);
  } else {
    console.log(`     no-op — already 0`);
  }
}

// ---------------------------------------------------------------------------
// 3) ir.actions.server — new "Download PDF (UTAK)" server action
// ---------------------------------------------------------------------------
let serverActionId = null;
{
  // idempotent: reuse an existing row with the same name if present
  const existing = await call("ir.actions.server", "search_read", {
    domain: [
      ["name", "=", "sale.quotation.pdf_download"],
      ["model_id", "=", 2731],
    ],
    fields: ["id", "name", "state", "code", "binding_type", "binding_view_types"],
  });
  const codeBody = `action = {\n    'type': 'ir.actions.act_url',\n    'url': '${WORKER_ORIGIN}/internal/sale-quotation-pdf?id=' + str(record.id) + '&token=${SALE_PDF_DOWNLOAD_TOKEN}',\n    'target': 'new',\n}`;
  if (existing.length > 0) {
    serverActionId = existing[0].id;
    console.log(`[3/4] ir.actions.server BEFORE: reuse id=${serverActionId} name=${JSON.stringify(existing[0].name)} state=${existing[0].state}`);
    await call("ir.actions.server", "write", {
      ids: [serverActionId],
      vals: {
        state: "code",
        code: codeBody,
        binding_type: "action",
        binding_view_types: "list,form",
      },
    });
    console.log(`     AFTER: id=${serverActionId} state=code (updated code + bindings)`);
  } else {
    const ids = await call("ir.actions.server", "create", {
      vals_list: [
        {
          name: "sale.quotation.pdf_download",
          model_id: 2731,
          state: "code",
          code: codeBody,
          binding_type: "action",
          binding_view_types: "list,form",
        },
      ],
    });
    serverActionId = Array.isArray(ids) ? ids[0] : ids;
    console.log(`[3/4] ir.actions.server CREATE: new id=${serverActionId}`);
  }
}

// ---------------------------------------------------------------------------
// 4) ir.ui.view — inherit sale.view_order_form, add header button
// ---------------------------------------------------------------------------
let viewId = null;
{
  // resolve inherit_id via xml_id (sale.view_order_form) → fallback to search
  let inheritId = 0;
  try {
    const inh = await call("ir.model.data", "search_read", {
      domain: [["module", "=", "sale"], ["name", "=", "view_order_form"]],
      fields: ["res_id"],
    });
    if (inh[0]?.res_id) inheritId = inh[0].res_id;
  } catch (e) {
    console.warn("     inherit lookup via ir.model.data failed:", (e).message);
  }
  if (!inheritId) {
    const cand = await call("ir.ui.view", "search_read", {
      domain: [
        ["model", "=", "sale.order"],
        ["type", "=", "form"],
        ["mode", "=", "primary"],
      ],
      fields: ["id", "name"],
      limit: 5,
    });
    if (cand[0]?.id) inheritId = cand[0].id;
  }
  if (!inheritId) throw new Error("cannot resolve sale.view_order_form id");

  const existing = await call("ir.ui.view", "search_read", {
    domain: [
      ["name", "=", "sale.order.form.utak_pdf_button"],
      ["model", "=", "sale.order"],
    ],
    fields: ["id", "name", "type"],
  });
  const arch = `<data>\n      <xpath expr="//header" position="inside">\n        <button name="${serverActionId}" string="تنزيل PDF (UTAK)" type="action" class="btn-secondary"/>\n      </xpath>\n    </data>`;
  if (existing.length > 0) {
    viewId = existing[0].id;
    console.log(`[4/4] ir.ui.view BEFORE: reuse id=${viewId} name=${JSON.stringify(existing[0].name)}`);
    await call("ir.ui.view", "write", {
      ids: [viewId],
      vals: { arch, inherit_id: inheritId, active: true },
    });
    console.log(`     AFTER: id=${viewId} (arch updated with server action id=${serverActionId})`);
  } else {
    const ids = await call("ir.ui.view", "create", {
      vals_list: [
        {
          name: "sale.order.form.utak_pdf_button",
          type: "form",
          model: "sale.order",
          inherit_id: inheritId,
          arch,
        },
      ],
    });
    viewId = Array.isArray(ids) ? ids[0] : ids;
    console.log(`[4/4] ir.ui.view CREATE: new id=${viewId} (inherit_id=${inheritId})`);
  }
}

// ---------------------------------------------------------------------------
// Persist post-apply ids to the rollback JSON
// ---------------------------------------------------------------------------
artifact.post_apply_ids = artifact.post_apply_ids || {};
artifact.post_apply_ids.server_action_id = serverActionId;
artifact.post_apply_ids.view_id = viewId;
writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2) + "\n");
console.log(`\nWrote post_apply_ids to ${ARTIFACT_PATH.pathname}`);
console.log(`  server_action_id=${serverActionId}`);
console.log(`  view_id=${viewId}`);
