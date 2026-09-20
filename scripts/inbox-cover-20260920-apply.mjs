// Inbox cover 2026-09-20 — apply Odoo changes for the "distinguish auto vs
// manual" feature:
//   1. Add x_source selection field on x_wa_message (auto/manual/inbound).
//   2. Backfill existing rows using x_direction + x_manual heuristics.
//   3. Add an inheriting list view that shows x_source as a colored badge.
//   4. Add an inheriting form view section that surfaces x_source read-only.
//
// Every write is captured in scripts/artifacts/inbox-cover-20260920-rollback.json
// alongside a dry-run rollback script (inbox-cover-20260920-rollback.mjs) that
// undoes only what this script did.
//
// Dry-run by default. Pass --apply to write.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

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

const rollbackPath = new URL("./artifacts/inbox-cover-20260920-rollback.json", import.meta.url).pathname;
function readRollback() {
  if (!existsSync(rollbackPath)) return { generated_at: new Date().toISOString(), created: {}, mutated: {} };
  try { return JSON.parse(readFileSync(rollbackPath, "utf8")); } catch { return { generated_at: new Date().toISOString(), created: {}, mutated: {} }; }
}
function writeRollback(json) {
  mkdirSync(dirname(rollbackPath), { recursive: true });
  writeFileSync(rollbackPath, JSON.stringify(json, null, 2) + "\n");
}

function say(...args) { console.log(APPLY ? "[apply]" : "[dry-run]", ...args); }

async function main() {
  const rb = readRollback();
  rb.created = rb.created ?? {};
  rb.mutated = rb.mutated ?? {};

  // 1. Find x_wa_message model id
  const [mdl] = await call("ir.model", "search_read", {
    domain: [["model", "=", "x_wa_message"]],
    fields: ["id", "name"], limit: 1,
  });
  if (!mdl) throw new Error("x_wa_message model not found");
  say(`x_wa_message model id=${mdl.id}`);

  // 2. Ensure x_source field
  const existingField = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "x_wa_message"], ["name", "=", "x_source"]],
    fields: ["id", "name", "field_description", "state", "selection"], limit: 1,
  });
  if (existingField.length > 0) {
    say(`x_source field already exists id=${existingField[0].id}`);
  } else {
    say("creating x_source selection field…");
    if (APPLY) {
      const created = await call("ir.model.fields", "create", {
        vals_list: [{
          model_id: mdl.id,
          name: "x_source",
          field_description: "المصدر",
          ttype: "selection",
          selection: "[('auto', 'آلي'), ('manual', 'يدوي'), ('inbound', 'وارد')]",
          state: "manual",
        }],
      });
      (rb.created.fields ??= []).push({ id: created[0], model: "x_wa_message", name: "x_source" });
      say(`x_source field created id=${created[0]}`);
    }
  }

  // 3. Backfill existing rows
  say("scanning existing x_wa_message rows for backfill…");
  const all = await call("x_wa_message", "search_read", {
    domain: [],
    fields: ["id", "x_direction", "x_manual"],
  });
  say(`total rows: ${all.length}`);
  const inboundIds = [];
  const manualIds = [];
  const autoIds = [];
  for (const r of all) {
    if (r.x_direction === "in") inboundIds.push(r.id);
    else if (r.x_manual === true) manualIds.push(r.id);
    else autoIds.push(r.id);
  }
  say(`inbound=${inboundIds.length}, manual=${manualIds.length}, auto=${autoIds.length}`);
  if (APPLY) {
    // Only write if the field exists in the model already, else skip.
    const after = await call("ir.model.fields", "search_read", {
      domain: [["model", "=", "x_wa_message"], ["name", "=", "x_source"]],
      fields: ["id"], limit: 1,
    });
    if (after.length === 0) {
      say("x_source not present — skipping backfill");
    } else {
      const chunk = 200;
      async function batchWrite(ids, source) {
        for (let i = 0; i < ids.length; i += chunk) {
          const slice = ids.slice(i, i + chunk);
          if (slice.length === 0) continue;
          await call("x_wa_message", "write", { ids: slice, vals: { x_source: source } });
        }
      }
      await batchWrite(inboundIds, "inbound");
      await batchWrite(manualIds, "manual");
      await batchWrite(autoIds, "auto");
      say("backfill complete");
    }
    (rb.mutated.x_wa_message_backfill = {
      applied_at: new Date().toISOString(),
      inbound_count: inboundIds.length,
      manual_count: manualIds.length,
      auto_count: autoIds.length,
    });
  }

  // 4. Inheriting list view for x_source badge column
  const existingListInherit = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", "x_wa_message.tree.source_badge"]],
    fields: ["id"], limit: 1,
  });
  if (existingListInherit.length === 0) {
    say("creating inherited list view for x_source badge…");
    if (APPLY) {
      const listArch = `<data>
  <xpath expr="//field[@name='x_status']" position="before">
    <field name="x_source" string="المصدر" widget="badge"
      decoration-success="x_source == 'manual'"
      decoration-info="x_source == 'auto'"
      decoration-warning="x_source == 'inbound'"/>
  </xpath>
</data>`;
      const created = await call("ir.ui.view", "create", {
        vals_list: [{
          name: "x_wa_message.tree.source_badge",
          model: "x_wa_message",
          type: "list",
          inherit_id: 2775,
          arch: listArch,
        }],
      });
      (rb.created.views ??= []).push({ id: created[0], name: "x_wa_message.tree.source_badge", inherit_id: 2775 });
      say(`inherited list view id=${created[0]}`);
    }
  } else {
    say(`inherited list view already exists id=${existingListInherit[0].id}`);
  }

  // 5. Inheriting form view for x_source display
  const existingFormInherit = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", "x_wa_message.form.source_badge"]],
    fields: ["id"], limit: 1,
  });
  if (existingFormInherit.length === 0) {
    say("creating inherited form view for x_source…");
    if (APPLY) {
      const formArch = `<data>
  <xpath expr="//field[@name='x_manual']" position="after">
    <field name="x_source" widget="badge"
      decoration-success="x_source == 'manual'"
      decoration-info="x_source == 'auto'"
      decoration-warning="x_source == 'inbound'"/>
  </xpath>
</data>`;
      const created = await call("ir.ui.view", "create", {
        vals_list: [{
          name: "x_wa_message.form.source_badge",
          model: "x_wa_message",
          type: "form",
          inherit_id: 2778,
          arch: formArch,
        }],
      });
      (rb.created.views ??= []).push({ id: created[0], name: "x_wa_message.form.source_badge", inherit_id: 2778 });
      say(`inherited form view id=${created[0]}`);
    }
  } else {
    say(`inherited form view already exists id=${existingFormInherit[0].id}`);
  }

  // 6. Inheriting search view for x_source filter + groupby
  const existingSearchInherit = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", "x_wa_message.search.source_filter"]],
    fields: ["id"], limit: 1,
  });
  if (existingSearchInherit.length === 0) {
    say("creating inherited search view for x_source filters…");
    if (APPLY) {
      const searchArch = `<data>
  <xpath expr="//filter[@name='fltr_inbound']" position="after">
    <separator/>
    <filter name="fltr_src_auto" string="آلي" domain="[('x_source', '=', 'auto')]"/>
    <filter name="fltr_src_manual" string="يدوي" domain="[('x_source', '=', 'manual')]"/>
    <filter name="fltr_src_inbound" string="وارد" domain="[('x_source', '=', 'inbound')]"/>
  </xpath>
  <xpath expr="//filter[@name='gb_direction']" position="after">
    <filter name="gb_source" string="تجميع: المصدر" context="{'group_by': 'x_source'}"/>
  </xpath>
</data>`;
      const created = await call("ir.ui.view", "create", {
        vals_list: [{
          name: "x_wa_message.search.source_filter",
          model: "x_wa_message",
          type: "search",
          inherit_id: 2781,
          arch: searchArch,
        }],
      });
      (rb.created.views ??= []).push({ id: created[0], name: "x_wa_message.search.source_filter", inherit_id: 2781 });
      say(`inherited search view id=${created[0]}`);
    }
  } else {
    say(`inherited search view already exists id=${existingSearchInherit[0].id}`);
  }

  writeRollback(rb);
  say("done");
  if (!APPLY) console.log("\nDry-run only. Re-run with --apply to persist changes.");
}
main().catch((e) => { console.error("[fatal]", e.stack || e.message || e); process.exit(1); });
