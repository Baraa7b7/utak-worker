// Item 2 (tonight 2026-09-17) — WhatsApp Messages tab in Odoo.
//
// Idempotent. Creates / updates:
//   * x_wa_message model + all required fields
//   * ir.access rows for x_wa_message (group_user, crud)
//   * tree + form views for x_wa_message
//   * res.partner inherited view: "رسائل واتساب" tab (chronological, newest first)
//   * ir.actions.act_window for the message list (filters: today/inbound/outbound/failed)
//   * ir.ui.menu entries under UTAK: "رسائل واتساب" + "تحكم واتساب"
//   * ir.actions.server (wa_message.send_webhook) — webhook to Worker
//   * base.automation (wa_message.on_queued) — fires on status → queued
//
// Requires .env.sim-verify (ODOO_URL/DB/LOGIN/API_KEY) + ODOO_HOOK_TOKEN env var
// + optional WORKER_ORIGIN env var (defaults to sim origin).

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
    ...(opts.relation ? { relation: opts.relation } : {}),
    ...(typeof opts.required === "boolean" ? { required: opts.required } : {}),
    ...(typeof opts.copied === "boolean" ? { copied: opts.copied } : {}),
    ...(opts.default_value ? { default_value: opts.default_value } : {}),
  };
  const ids = await call("ir.model.fields", "create", { vals_list: [vals] });
  return { name, action: "created", id: ids[0] };
}

// ============================================================
// 1. x_wa_message model + fields
// ============================================================
async function ensureWaMessageModel() {
  let modelId = await findModelId("x_wa_message");
  let action = "existed";
  if (!modelId) {
    const ids = await call("ir.model", "create", {
      vals_list: [{
        name: "WhatsApp Message",
        model: "x_wa_message",
      }],
    });
    modelId = ids[0];
    action = "created";
  }

  const existing = await existingFieldsOnModel(modelId);
  const fields = [];

  // Odoo auto-adds x_name. Repurpose it as a display / short body preview.
  fields.push(await ensureField(modelId, existing, "x_name", {
    ttype: "char",
    label: "Preview",
  }));

  // Link to partner (customer/supplier/team member).
  fields.push(await ensureField(modelId, existing, "x_partner_id", {
    ttype: "many2one",
    relation: "res.partner",
    label: "الشريك",
  }));

  // in (incoming from WhatsApp) or out (queued/sent by us).
  fields.push(await ensureField(modelId, existing, "x_direction", {
    ttype: "selection",
    label: "الاتجاه",
    selection: "[('in', 'وارد'), ('out', 'صادر')]",
  }));

  fields.push(await ensureField(modelId, existing, "x_kind", {
    ttype: "selection",
    label: "النوع",
    selection: "[('template', 'قالب'), ('text', 'نص حر'), ('document', 'مستند'), ('button_reply', 'رد زر')]",
  }));

  // Template reference (only meaningful for kind=template).
  fields.push(await ensureField(modelId, existing, "x_template_id", {
    ttype: "many2one",
    relation: "x_whatsapp_template",
    label: "القالب",
  }));

  fields.push(await ensureField(modelId, existing, "x_params", {
    ttype: "text",
    label: "المعاملات (JSON)",
  }));

  fields.push(await ensureField(modelId, existing, "x_body", {
    ttype: "text",
    label: "النص",
  }));

  // Binary attachment (base64, capped at 10MB by Odoo default). Odoo's
  // binary type also supports a filename companion.
  fields.push(await ensureField(modelId, existing, "x_attachment", {
    ttype: "binary",
    label: "المرفق",
  }));

  fields.push(await ensureField(modelId, existing, "x_filename", {
    ttype: "char",
    label: "اسم الملف",
  }));

  // Link to any Odoo record (quotation, invoice, order, ...).
  fields.push(await ensureField(modelId, existing, "x_res_model", {
    ttype: "char",
    label: "النموذج المرتبط",
  }));
  fields.push(await ensureField(modelId, existing, "x_res_id", {
    ttype: "integer",
    label: "معرّف السجل المرتبط",
  }));

  fields.push(await ensureField(modelId, existing, "x_status", {
    ttype: "selection",
    label: "الحالة",
    selection: [
      "[('draft', 'مسودة'), ('queued', 'بالطابور'), ('sending', 'قيد الإرسال'),",
      " ('sent', 'انرسلت'), ('delivered', 'تسلّمت'), ('read', 'مقروءة'), ('failed', 'فشل'),",
      " ('received', 'واردة'), ('dry_ok', 'dry-run ناجحة')]",
    ].join(" "),
  }));

  fields.push(await ensureField(modelId, existing, "x_meta_message_id", {
    ttype: "char",
    label: "meta message id (wamid)",
  }));

  fields.push(await ensureField(modelId, existing, "x_meta_error", {
    ttype: "text",
    label: "خطأ Meta",
  }));

  fields.push(await ensureField(modelId, existing, "x_processed_at", {
    ttype: "datetime",
    label: "وقت المعالجة",
  }));

  fields.push(await ensureField(modelId, existing, "x_dry_run", {
    ttype: "boolean",
    label: "dry-run",
  }));

  fields.push(await ensureField(modelId, existing, "x_debug_payload", {
    ttype: "text",
    label: "debug payload",
  }));

  // Manual override that bypasses SIM_ALLOWLIST. Set only from the
  // "إرسال" button flow; never toggled by webhooks or the client.
  fields.push(await ensureField(modelId, existing, "x_manual", {
    ttype: "boolean",
    label: "إرسال يدوي (يتخطى allowlist)",
  }));

  return { modelId, modelAction: action, fields };
}

async function ensureAccessRow(modelId, name, groupXmlId) {
  const model = await call("ir.model", "read", {
    ids: [modelId],
    fields: ["access_ids"],
  });
  const existingIds = model[0]?.access_ids ?? [];
  // Check by name to stay idempotent — call site names each row uniquely.
  if (existingIds.length > 0) {
    const rows = await call("ir.access", "search_read", {
      domain: [["id", "in", existingIds], ["name", "=", name]],
      fields: ["id"],
      limit: 1,
    });
    if (rows[0]) return { id: rows[0].id, action: "existed" };
  }
  const xmlRows = await call("ir.model.data", "search_read", {
    domain: [
      ["module", "=", "base"],
      ["name", "=", groupXmlId],
      ["model", "=", "res.groups"],
    ],
    fields: ["res_id"],
    limit: 1,
  });
  const groupId = xmlRows[0]?.res_id;
  if (!groupId) throw new Error(`base.${groupXmlId} not found`);
  await call("ir.model", "write", {
    ids: [modelId],
    vals: {
      access_ids: [[0, 0, {
        name,
        group_id: groupId,
        operation: "crud",
        kind: "permission",
        active: true,
      }]],
    },
  });
  return { action: "created", group_id: groupId };
}

// ============================================================
// 2. Views
// ============================================================
async function ensureWaMessageTreeView() {
  const name = "x_wa_message.tree";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  const arch = `
    <list string="رسائل واتساب" default_order="id desc">
      <field name="create_date" string="التاريخ"/>
      <field name="x_direction" string="الاتجاه"/>
      <field name="x_partner_id" string="الشريك"/>
      <field name="x_kind" string="النوع"/>
      <field name="x_template_id" string="القالب"/>
      <field name="x_body" string="النص"/>
      <field name="x_status" string="الحالة"
             decoration-danger="x_status == 'failed'"
             decoration-success="x_status in ('sent', 'delivered', 'read', 'dry_ok')"
             decoration-info="x_status == 'received'"
             decoration-warning="x_status in ('queued', 'sending')"/>
      <field name="x_dry_run" string="dry"/>
    </list>`;
  if (existing[0]) {
    await call("ir.ui.view", "write", { ids: [existing[0].id], vals: { arch_base: arch } });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [{ name, model: "x_wa_message", type: "list", arch_base: arch }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureWaMessageFormView(queueActionId) {
  const name = "x_wa_message.form";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  // Kept intentionally lean — Odoo 19.4 silently rolls back form views that
  // fail arch validation (raises MissingError on the just-created id). The
  // "إرسال" button uses type="action" with a server-action id, because a
  // Studio model has no Python module to expose type="object" methods.
  const arch = `
    <form string="رسالة واتساب">
      <header>
        <button name="${queueActionId}"
                string="إرسال"
                type="action"
                class="oe_highlight"
                confirm="متأكد؟ الرسالة تنضاف للطابور فوراً."/>
        <field name="x_status" widget="statusbar"/>
      </header>
      <sheet>
        <group>
          <group>
            <field name="x_partner_id"/>
            <field name="x_direction"/>
            <field name="x_kind"/>
            <field name="x_template_id"/>
            <field name="x_filename"/>
            <field name="x_attachment" filename="x_filename"/>
          </group>
          <group>
            <field name="x_meta_message_id" readonly="1"/>
            <field name="x_processed_at" readonly="1"/>
            <field name="x_dry_run"/>
            <field name="x_manual"/>
            <field name="x_res_model"/>
            <field name="x_res_id"/>
          </group>
        </group>
        <notebook>
          <page string="النص">
            <field name="x_body"/>
          </page>
          <page string="المعاملات">
            <field name="x_params"/>
          </page>
          <page string="خطأ Meta">
            <field name="x_meta_error" readonly="1"/>
          </page>
          <page string="debug">
            <field name="x_debug_payload" readonly="1"/>
          </page>
        </notebook>
      </sheet>
    </form>`;
  if (existing[0]) {
    await call("ir.ui.view", "write", { ids: [existing[0].id], vals: { arch_base: arch } });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [{ name, model: "x_wa_message", type: "form", arch_base: arch }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureWaMessageSearchView() {
  const name = "x_wa_message.search";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  const arch = `
    <search>
      <field name="x_partner_id"/>
      <filter name="fltr_outbound" string="صادرة" domain="[('x_direction', '=', 'out')]"/>
      <filter name="fltr_inbound"  string="واردة"  domain="[('x_direction', '=', 'in')]"/>
      <filter name="fltr_failed"   string="مرفوضة" domain="[('x_status', '=', 'failed')]"/>
    </search>`;
  if (existing[0]) {
    await call("ir.ui.view", "write", { ids: [existing[0].id], vals: { arch_base: arch } });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [{ name, model: "x_wa_message", type: "search", arch_base: arch }],
  });
  return { id: ids[0], action: "created" };
}

async function ensurePartnerWaTab() {
  const name = "res.partner.form.utak_wa_messages";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  const xml = await call("ir.model.data", "search_read", {
    domain: [
      ["module", "=", "base"],
      ["name", "=", "view_partner_form"],
      ["model", "=", "ir.ui.view"],
    ],
    fields: ["res_id"],
    limit: 1,
  });
  const baseId = xml[0]?.res_id;
  if (!baseId) throw new Error("base res.partner form not found");
  const arch = `
    <data>
      <xpath expr="//notebook" position="inside">
        <page string="رسائل واتساب">
          <field name="x_wa_message_ids" nolabel="1" readonly="1">
            <list default_order="id desc" limit="30">
              <field name="create_date" string="التاريخ"/>
              <field name="x_direction" string="الاتجاه"/>
              <field name="x_kind" string="النوع"/>
              <field name="x_body" string="النص"/>
              <field name="x_status" string="الحالة"/>
            </list>
          </field>
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
    vals_list: [{
      name,
      model: "res.partner",
      inherit_id: baseId,
      priority: 40,
      arch_base: arch,
    }],
  });
  return { id: ids[0], action: "created" };
}

// Inverse many2one exposure on res.partner: an O2M helper field
// x_wa_message_ids so the partner tab has a related recordset to render.
async function ensurePartnerWaMessageIdsField() {
  const partnerModel = await findModelId("res.partner");
  const existing = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "res.partner"], ["name", "=", "x_wa_message_ids"]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) return { id: existing[0].id, action: "existed" };
  const ids = await call("ir.model.fields", "create", {
    vals_list: [{
      model_id: partnerModel,
      name: "x_wa_message_ids",
      field_description: "رسائل واتساب",
      ttype: "one2many",
      relation: "x_wa_message",
      relation_field: "x_partner_id",
    }],
  });
  return { id: ids[0], action: "created" };
}

// ============================================================
// 3. Menus + actions
// ============================================================
async function ensureAction(name, spec) {
  const existing = await call("ir.actions.act_window", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) {
    await call("ir.actions.act_window", "write", {
      ids: [existing[0].id],
      vals: spec,
    });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.actions.act_window", "create", {
    vals_list: [{ name, ...spec }],
  });
  return { id: ids[0], action: "created" };
}

async function ensureMenu(name, spec) {
  const existing = await call("ir.ui.menu", "search_read", {
    domain: [["name", "=", name], ...(spec.parent_id ? [["parent_id", "=", spec.parent_id]] : [])],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) {
    await call("ir.ui.menu", "write", { ids: [existing[0].id], vals: spec });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.menu", "create", { vals_list: [{ name, ...spec }] });
  return { id: ids[0], action: "created" };
}

async function ensureMenusAndActions() {
  // UTAK root: reuse existing if present, else create a top-level menu.
  const rootExisting = await call("ir.ui.menu", "search_read", {
    domain: [["name", "=", "UTAK"], ["parent_id", "=", false]],
    fields: ["id"],
    limit: 1,
  });
  let rootId = rootExisting[0]?.id;
  if (!rootId) {
    const ids = await call("ir.ui.menu", "create", {
      vals_list: [{ name: "UTAK", sequence: 5 }],
    });
    rootId = ids[0];
  }

  // Action: WhatsApp messages list.
  const listAction = await ensureAction("UTAK — رسائل واتساب", {
    res_model: "x_wa_message",
    view_mode: "list,form",
  });

  // Menu: رسائل واتساب under UTAK.
  const listMenu = await ensureMenu("رسائل واتساب", {
    parent_id: rootId,
    action: `ir.actions.act_window,${listAction.id}`,
    sequence: 90,
  });

  // Action: WhatsApp control (single record).
  const controlRows = await call("x_wa_control", "search_read", {
    domain: [],
    fields: ["id"],
    limit: 1,
  });
  const controlId = controlRows[0]?.id;
  let controlAction = null;
  let controlMenu = null;
  if (controlId) {
    controlAction = await ensureAction("UTAK — تحكم واتساب", {
      res_model: "x_wa_control",
      view_mode: "form",
      res_id: controlId,
      target: "current",
    });
    controlMenu = await ensureMenu("تحكم واتساب", {
      parent_id: rootId,
      action: `ir.actions.act_window,${controlAction.id}`,
      sequence: 91,
    });
  }

  return { rootId, listAction, listMenu, controlAction, controlMenu };
}

// ============================================================
// 4. Automation: on status=queued → webhook to worker
// ============================================================
async function ensureQueuedWebhookAutomation(modelId) {
  const actionName = "wa_message.send_webhook";
  const webhookUrl = `${WORKER_ORIGIN}/odoo/hook/wa?token=${HOOK_TOKEN}`;

  const existingAction = await call("ir.actions.server", "search_read", {
    domain: [["name", "=", actionName]],
    fields: ["id"],
    limit: 1,
  });
  let actionId;
  if (existingAction[0]) {
    actionId = existingAction[0].id;
    await call("ir.actions.server", "write", {
      ids: [actionId],
      vals: { webhook_url: webhookUrl, model_id: modelId, state: "webhook" },
    });
  } else {
    const ids = await call("ir.actions.server", "create", {
      vals_list: [{
        name: actionName,
        model_id: modelId,
        state: "webhook",
        webhook_url: webhookUrl,
      }],
    });
    actionId = ids[0];
  }

  const ruleName = "wa_message.on_queued";
  const existingRule = await call("base.automation", "search_read", {
    domain: [["name", "=", ruleName]],
    fields: ["id"],
    limit: 1,
  });
  if (existingRule[0]) {
    await call("base.automation", "write", {
      ids: [existingRule[0].id],
      vals: {
        model_id: modelId,
        trigger: "on_create_or_write",
        filter_domain: `[["x_status", "=", "queued"]]`,
        action_server_ids: [[6, 0, [actionId]]],
        active: true,
      },
    });
    return { rule_id: existingRule[0].id, action_id: actionId, action: "updated" };
  }
  const ids = await call("base.automation", "create", {
    vals_list: [{
      name: ruleName,
      model_id: modelId,
      trigger: "on_create_or_write",
      filter_domain: `[["x_status", "=", "queued"]]`,
      action_server_ids: [[6, 0, [actionId]]],
      active: true,
    }],
  });
  return { rule_id: ids[0], action_id: actionId, action: "created" };
}

// ============================================================
// 5. Server action: "action_queue" button — flips draft → queued
// (Odoo's builtin `object`-typed button expects a server action of the
//  same name; we create one that does records.write({x_status: 'queued'}).)
// ============================================================
async function ensureQueueButtonAction(modelId) {
  const name = "wa_message.action_queue";
  const existing = await call("ir.actions.server", "search_read", {
    domain: [["name", "=", name], ["model_id", "=", modelId]],
    fields: ["id"],
    limit: 1,
  });
  if (existing[0]) return { id: existing[0].id, action: "existed" };
  const ids = await call("ir.actions.server", "create", {
    vals_list: [{
      name,
      model_id: modelId,
      state: "code",
      code: "records.write({'x_status': 'queued'})",
    }],
  });
  return { id: ids[0], action: "created" };
}

async function main() {
  console.log("Item 2 migration — starting");
  console.log("WEBHOOK_URL_MASKED:",
    `${WORKER_ORIGIN}/odoo/hook/wa?token=${HOOK_TOKEN.slice(0, 4)}…`);

  const m = await ensureWaMessageModel();
  console.log("\n[x_wa_message model] id =", m.modelId, "action =", m.modelAction);
  for (const f of m.fields) console.log(" ", f.name, "→", f.action, f.id ?? "");

  const access = await ensureAccessRow(m.modelId, "x_wa_message.access.user", "group_user");
  console.log("\n[ir.access user] ", access);

  const partnerField = await ensurePartnerWaMessageIdsField();
  console.log("[res.partner.x_wa_message_ids]", partnerField);

  const qBtn = await ensureQueueButtonAction(m.modelId);
  console.log("[server action: action_queue] ", qBtn);

  const treeView = await ensureWaMessageTreeView();
  console.log("[tree view] ", treeView);
  const formView = await ensureWaMessageFormView(qBtn.id);
  console.log("[form view] ", formView);
  const searchView = await ensureWaMessageSearchView();
  console.log("[search view] ", searchView);
  const partnerTab = await ensurePartnerWaTab();
  console.log("[partner tab view] ", partnerTab);

  const menus = await ensureMenusAndActions();
  console.log("[menus] root =", menus.rootId,
    " list_action =", menus.listAction?.id,
    " list_menu =", menus.listMenu?.id,
    " control_action =", menus.controlAction?.id ?? "n/a",
    " control_menu =", menus.controlMenu?.id ?? "n/a");

  const auto = await ensureQueuedWebhookAutomation(m.modelId);
  console.log("[base.automation: on_queued] ", auto);

  console.log("\n--- summary ---");
  console.log(JSON.stringify({
    model_id: m.modelId,
    fields_created: m.fields.filter((f) => f.action === "created").map((f) => f.name),
    fields_skipped: m.fields.filter((f) => f.action === "skip").map((f) => f.name),
    partner_field: partnerField.action,
    views: {
      tree: treeView.id, form: formView.id, search: searchView.id, partner_tab: partnerTab.id,
    },
    menus,
    queue_button_action: qBtn.id,
    automation: auto,
    webhook_url_masked: `${WORKER_ORIGIN}/odoo/hook/wa?token=${HOOK_TOKEN.slice(0, 4)}…`,
  }, null, 2));
}

main().catch((e) => {
  console.error("ITEM 2 MIGRATION FAILED:", e);
  process.exit(1);
});
