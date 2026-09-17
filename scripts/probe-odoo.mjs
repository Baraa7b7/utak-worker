// Phase 0.c — Odoo capability probe.
// Creates then immediately deletes disabled test records for each capability.
// Reports WEBHOOK_OK / CODE_OK / VIEWS_OK / MODELS_OK — yes|no|error.
// Uses .env.sim-verify credentials. No side effects if all deletes succeed.

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
  console.error("missing env");
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

async function tryCap(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`${name}: yes  (${Date.now() - started}ms)  ${detail ?? ""}`);
    return { name, ok: true, detail };
  } catch (e) {
    console.log(`${name}: no   (${Date.now() - started}ms)  ${e.name}: ${e.message}`);
    return { name, ok: false, error: `${e.name}: ${e.message}` };
  }
}

// ---- 1. res.partner model id (needed later) ----
async function getResPartnerModelId() {
  const rows = await call("ir.model", "search_read", {
    domain: [["model", "=", "res.partner"]],
    fields: ["id"],
    limit: 1,
  });
  if (!rows[0]) throw new Error("res.partner not found");
  return rows[0].id;
}

async function main() {
  const stamp = Date.now();
  console.log(`Probing ${ODOO_URL} as ${ODOO_LOGIN} — ${new Date().toISOString()}`);

  let modelId;
  try {
    modelId = await getResPartnerModelId();
    console.log(`res.partner model id = ${modelId}`);
  } catch (e) {
    console.error("cannot read ir.model — aborting probe:", e.message);
    process.exit(1);
  }

  const results = [];

  // ---- WEBHOOK_OK: base.automation with ir.actions.server state="webhook" ----
  results.push(await tryCap("WEBHOOK_OK", async () => {
    let actionId, ruleId;
    try {
      const actIds = await call("ir.actions.server", "create", {
        vals_list: [{
          name: `probe_webhook_${stamp}`,
          model_id: modelId,
          state: "webhook",
          webhook_url: "https://example.invalid/probe",
        }],
      });
      actionId = actIds[0];
      const ruleIds = await call("base.automation", "create", {
        vals_list: [{
          name: `probe_webhook_${stamp}`,
          model_id: modelId,
          trigger: "on_create",
          active: false,
          action_server_ids: [[6, 0, [actionId]]],
        }],
      });
      ruleId = ruleIds[0];
      return `action=${actionId} rule=${ruleId}`;
    } finally {
      if (ruleId) { try { await call("base.automation", "unlink", { ids: [ruleId] }); } catch {} }
      if (actionId) { try { await call("ir.actions.server", "unlink", { ids: [actionId] }); } catch {} }
    }
  }));

  // ---- CODE_OK: ir.actions.server state="code" ----
  results.push(await tryCap("CODE_OK", async () => {
    let actionId, ruleId;
    try {
      const actIds = await call("ir.actions.server", "create", {
        vals_list: [{
          name: `probe_code_${stamp}`,
          model_id: modelId,
          state: "code",
          code: "# probe — no-op",
        }],
      });
      actionId = actIds[0];
      const ruleIds = await call("base.automation", "create", {
        vals_list: [{
          name: `probe_code_${stamp}`,
          model_id: modelId,
          trigger: "on_create",
          active: false,
          action_server_ids: [[6, 0, [actionId]]],
        }],
      });
      ruleId = ruleIds[0];
      return `action=${actionId} rule=${ruleId}`;
    } finally {
      if (ruleId) { try { await call("base.automation", "unlink", { ids: [ruleId] }); } catch {} }
      if (actionId) { try { await call("ir.actions.server", "unlink", { ids: [actionId] }); } catch {} }
    }
  }));

  // ---- VIEWS_OK: ir.ui.view inherit on res.partner ----
  results.push(await tryCap("VIEWS_OK", async () => {
    // xml_id is not a stored column on ir.ui.view; go via ir.model.data.
    let baseId;
    try {
      const rows = await call("ir.model.data", "search_read", {
        domain: [["model", "=", "ir.ui.view"], ["module", "=", "base"], ["name", "=", "view_partner_form"]],
        fields: ["res_id"],
        limit: 1,
      });
      baseId = rows[0]?.res_id;
    } catch { /* fall through */ }
    if (!baseId) {
      const any = await call("ir.ui.view", "search_read", {
        domain: [["model", "=", "res.partner"], ["type", "=", "form"], ["inherit_id", "=", false]],
        fields: ["id"],
        limit: 1,
      });
      baseId = any[0]?.id;
    }
    if (!baseId) throw new Error("no base res.partner form view found");

    let viewId;
    try {
      const ids = await call("ir.ui.view", "create", {
        vals_list: [{
          name: `probe_view_${stamp}`,
          model: "res.partner",
          inherit_id: baseId,
          active: false,
          arch_base: `<data><xpath expr="//form" position="inside"><!-- probe --></xpath></data>`,
        }],
      });
      viewId = ids[0];
      return `view=${viewId} inherit=${baseId}`;
    } finally {
      if (viewId) { try { await call("ir.ui.view", "unlink", { ids: [viewId] }); } catch {} }
    }
  }));

  // ---- MODELS_OK: ir.model + ir.model.fields ----
  results.push(await tryCap("MODELS_OK", async () => {
    let newModelId, fieldId;
    try {
      const ids = await call("ir.model", "create", {
        vals_list: [{
          name: `Probe Model ${stamp}`,
          model: `x_probe_model_${stamp}`,
        }],
      });
      newModelId = ids[0];
      const fids = await call("ir.model.fields", "create", {
        vals_list: [{
          model_id: newModelId,
          name: "x_probe_char",
          field_description: "Probe Char",
          ttype: "char",
        }],
      });
      fieldId = fids[0];
      return `model=${newModelId} field=${fieldId}`;
    } finally {
      if (fieldId) { try { await call("ir.model.fields", "unlink", { ids: [fieldId] }); } catch {} }
      if (newModelId) { try { await call("ir.model", "unlink", { ids: [newModelId] }); } catch {} }
    }
  }));

  // ---- Summary ----
  console.log("\n--- summary ---");
  const summary = {};
  for (const r of results) summary[r.name] = r.ok ? "yes" : `no (${r.error})`;
  console.log(JSON.stringify(summary, null, 2));

  const modelsOk = results.find((r) => r.name === "MODELS_OK")?.ok;
  const viewsOk = results.find((r) => r.name === "VIEWS_OK")?.ok;
  const webhookOk = results.find((r) => r.name === "WEBHOOK_OK")?.ok;

  console.log(`\nMODE = ${webhookOk ? "hook mode" : "poll mode"}`);
  if (!modelsOk || !viewsOk) {
    console.error("\nSTOP: MODELS_OK or VIEWS_OK failed — entire task must halt.");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
