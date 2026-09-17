// Phase 1 migration.
//
// Idempotent. Adds fields to x_whatsapp_template if missing, creates
// x_wa_control singleton, its form view + button + server action, and the
// Automated Action that fires the sync webhook on x_sync_requested=true.
//
// Requires .env.sim-verify with ODOO_URL/DB/LOGIN/API_KEY.
// Requires ODOO_HOOK_TOKEN env var (passed inline) — baked into the webhook_url.
// Optional WORKER_ORIGIN env var (defaults to the sim origin).

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

const ODOO_URL = env.ODOO_URL;
const ODOO_DB = env.ODOO_DB;
const ODOO_LOGIN = env.ODOO_LOGIN;
const ODOO_API_KEY = env.ODOO_API_KEY;
const HOOK_TOKEN = process.env.ODOO_HOOK_TOKEN;
const WORKER_ORIGIN =
  process.env.WORKER_ORIGIN || "https://utak-worker-sim.utak-business.workers.dev";

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
        parsed?.data?.message ?? (typeof text === "string" ? text.slice(0, 300) : "")
      }`,
    );
    err.status = res.status;
    err.name = parsed?.data?.name ?? `HTTP_${res.status}`;
    throw err;
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

async function existingFieldsOnModel(modelId) {
  const rows = await call("ir.model.fields", "search_read", {
    domain: [["model_id", "=", modelId]],
    fields: ["name"],
    limit: 5000,
  });
  return new Set(rows.map((r) => r.name));
}

async function ensureField(modelId, existing, name, opts) {
  if (existing.has(name)) return { name, action: "skip" };
  const vals = {
    model_id: modelId,
    name,
    field_description: opts.label,
    ttype: opts.ttype,
    ...(opts.help ? { help: opts.help } : {}),
    ...(opts.size ? { size: opts.size } : {}),
    ...(opts.selection ? { selection: opts.selection } : {}),
  };
  const ids = await call("ir.model.fields", "create", { vals_list: [vals] });
  return { name, action: "created", id: ids[0] };
}

// ============================================================
// PART 1 — Extend x_whatsapp_template
// ============================================================
async function extendTemplateModel() {
  const modelId = await findModelId("x_whatsapp_template");
  if (!modelId) throw new Error("x_whatsapp_template not found");
  const existing = await existingFieldsOnModel(modelId);

  const spec = [
    { name: "x_meta_id", ttype: "char", label: "Meta template id" },
    { name: "x_meta_status", ttype: "char", label: "Meta status" },
    { name: "x_category", ttype: "char", label: "Meta category" },
    { name: "x_body", ttype: "text", label: "Body" },
    { name: "x_param_count", ttype: "integer", label: "Param count" },
    { name: "x_buttons", ttype: "text", label: "Buttons (text)" },
    { name: "x_last_synced", ttype: "datetime", label: "Last synced at" },
    { name: "x_missing_in_meta", ttype: "boolean", label: "Missing in Meta" },
    // x_language already exists (used by templates.ts fetchMapping) — skip
  ];

  const out = [];
  for (const f of spec) {
    out.push(await ensureField(modelId, existing, f.name, f));
  }
  return { modelId, fields: out };
}

// ============================================================
// PART 2 — x_wa_control singleton model + form + button + rule
// ============================================================
async function ensureControlModel() {
  let modelId = await findModelId("x_wa_control");
  let modelAction = "existed";
  if (!modelId) {
    const ids = await call("ir.model", "create", {
      vals_list: [{
        name: "WhatsApp Control",
        model: "x_wa_control",
      }],
    });
    modelId = ids[0];
    modelAction = "created";
  }

  const existing = await existingFieldsOnModel(modelId);
  const fields = [];
  fields.push(await ensureField(modelId, existing, "x_name", { ttype: "char", label: "Name" }));
  fields.push(await ensureField(modelId, existing, "x_sync_requested", { ttype: "boolean", label: "Sync requested" }));
  fields.push(await ensureField(modelId, existing, "x_last_sync_at", { ttype: "datetime", label: "Last sync at" }));
  fields.push(await ensureField(modelId, existing, "x_last_sync_result", { ttype: "text", label: "Last sync result" }));

  return { modelId, modelAction, fields };
}

async function ensureControlAccess(controlModelId) {
  // Odoo 19 SaaS blocks direct calls to ir.model.access via JSON-2, but
  // ir.model exposes an `access_ids` One2many we can write through.
  // Read the current access rows to keep the step idempotent.
  const model = await call("ir.model", "read", {
    ids: [controlModelId],
    fields: ["access_ids"],
  });
  const existingIds = model[0]?.access_ids ?? [];
  if (existingIds.length > 0) return { count: existingIds.length, action: "existed" };

  // Grant access to base.group_user (the Internal User group). In Odoo 19
  // SaaS the group's translated name can vary; look it up by xmlid via
  // ir.model.data instead.
  const xmlRows = await call("ir.model.data", "search_read", {
    domain: [["module", "=", "base"], ["name", "=", "group_user"], ["model", "=", "res.groups"]],
    fields: ["res_id"],
    limit: 1,
  });
  const groupId = xmlRows[0]?.res_id;
  if (!groupId) throw new Error("base.group_user not found via ir.model.data");

  // Odoo 19.4 renamed the access model to `ir.access` with a single
  // "crud" operation that covers read/write/create/unlink. Write through
  // the ir.model.access_ids One2many so we don't need direct rights on
  // ir.access itself.
  await call("ir.model", "write", {
    ids: [controlModelId],
    vals: {
      access_ids: [[0, 0, {
        name: "x_wa_control.access.user",
        group_id: groupId,
        operation: "crud",
        kind: "permission",
        active: true,
      }]],
    },
  });
  return { action: "created", group_id: groupId };
}

async function ensureControlSingleton() {
  const rows = await call("x_wa_control", "search_read", {
    domain: [],
    fields: ["id"],
    limit: 1,
  });
  if (rows[0]) return { id: rows[0].id, action: "existed" };
  const ids = await call("x_wa_control", "create", {
    vals_list: [{ x_name: "Control" }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureRequestSyncAction(controlModelId) {
  const name = "wa_control.request_sync";
  const existing = await call("ir.actions.server", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) return { id: existing[0].id, action: "existed" };
  // state="code" is universally supported across Odoo 17-19. The code sets
  // x_sync_requested=true on the recordset the button was pressed from; the
  // base.automation below sees the write and fires the webhook.
  const ids = await call("ir.actions.server", "create", {
    vals_list: [{
      name,
      model_id: controlModelId,
      state: "code",
      code: "records.write({'x_sync_requested': True})",
    }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureControlFormView(requestActionId) {
  const name = "x_wa_control.form.phase1";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) {
    // Rewrite arch in case action id changed between runs.
    await call("ir.ui.view", "write", {
      ids: [existing[0].id],
      vals: { arch_base: buildControlArch(requestActionId) },
    });
    return { id: existing[0].id, action: "updated_arch" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [{
      name,
      model: "x_wa_control",
      type: "form",
      arch_base: buildControlArch(requestActionId),
    }],
  });
  return { id: ids[0], action: "created" };
}

function buildControlArch(actionId) {
  return `
    <form string="WhatsApp Control">
      <header>
        <button name="${actionId}" string="تحديث القوالب الآن"
                type="action" class="oe_highlight"/>
      </header>
      <sheet>
        <group>
          <field name="x_name"/>
          <field name="x_sync_requested"/>
          <field name="x_last_sync_at" readonly="1"/>
          <field name="x_last_sync_result" readonly="1"/>
        </group>
      </sheet>
    </form>`;
}

async function ensureSyncWebhookAction(controlModelId) {
  const name = "wa_control.sync_webhook";
  const url = `${WORKER_ORIGIN}/odoo/hook/wa-template-sync?token=${HOOK_TOKEN}`;
  const existing = await call("ir.actions.server", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) {
    // update URL in case token rotated
    await call("ir.actions.server", "write", {
      ids: [existing[0].id],
      vals: { webhook_url: url },
    });
    return { id: existing[0].id, action: "updated_url" };
  }
  const ids = await call("ir.actions.server", "create", {
    vals_list: [{
      name,
      model_id: controlModelId,
      state: "webhook",
      webhook_url: url,
    }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureSyncAutomation(controlModelId, actionId) {
  const name = "wa_control.on_sync_requested";
  const existing = await call("base.automation", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) return { id: existing[0].id, action: "existed" };
  const ids = await call("base.automation", "create", {
    vals_list: [{
      name,
      model_id: controlModelId,
      trigger: "on_create_or_write",
      active: true,
      filter_domain: `[["x_sync_requested", "=", true]]`,
      action_server_ids: [[6, 0, [actionId]]],
    }],
  });
  return { id: ids[0], action: "created" };
}

async function main() {
  console.log("Phase 1 migration — starting");

  // Part 1
  const t = await extendTemplateModel();
  console.log("\n[x_whatsapp_template] modelId =", t.modelId);
  for (const f of t.fields) console.log(" ", f.name, "→", f.action, f.id ?? "");

  // Part 2
  const c = await ensureControlModel();
  console.log("\n[x_wa_control model] id =", c.modelId, "action =", c.modelAction);
  for (const f of c.fields) console.log(" ", f.name, "→", f.action, f.id ?? "");

  const access = await ensureControlAccess(c.modelId);
  console.log("\n[x_wa_control access] id =", access.id, "action =", access.action);

  const singleton = await ensureControlSingleton();
  console.log("[x_wa_control singleton] id =", singleton.id, "action =", singleton.action);

  const reqAction = await ensureRequestSyncAction(c.modelId);
  console.log("[server action: request_sync] id =", reqAction.id, "action =", reqAction.action);

  const view = await ensureControlFormView(reqAction.id);
  console.log("[x_wa_control form view] id =", view.id, "action =", view.action);

  const hookAction = await ensureSyncWebhookAction(c.modelId);
  console.log("[server action: sync_webhook] id =", hookAction.id, "action =", hookAction.action);

  const rule = await ensureSyncAutomation(c.modelId, hookAction.id);
  console.log("[base.automation: on_sync_requested] id =", rule.id, "action =", rule.action);

  console.log("\n--- summary ---");
  console.log(JSON.stringify({
    template_fields_created: t.fields.filter((f) => f.action === "created").map((f) => f.name),
    template_fields_skipped: t.fields.filter((f) => f.action === "skip").map((f) => f.name),
    control_model_id: c.modelId,
    control_singleton_id: singleton.id,
    view_id: view.id,
    request_action_id: reqAction.id,
    webhook_action_id: hookAction.id,
    automation_id: rule.id,
    webhook_url_masked: `${WORKER_ORIGIN}/odoo/hook/wa-template-sync?token=${HOOK_TOKEN.slice(0, 4)}…`,
  }, null, 2));
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e);
  process.exit(1);
});
