// Item 2 follow-up (2026-09-18) — WhatsApp Messages screen filters.
//
// The initial migration created a very thin search view (3 filters:
// outbound / inbound / failed). The main UTAK list menu shows no filter
// bar because Odoo picks the first inherited search view alphabetically
// and never learned the tabs live under UTAK.
//
// This script:
//   1. Diagnoses the current search view + action linkage.
//   2. Rewrites the x_wa_message.search arch to add:
//        - search fields: text (x_body), meta id (x_meta_message_id)
//        - filters: صادرة / واردة / مرفوضة / اليوم / قيد الإرسال
//        - group-by: partner / status / direction
//   3. Sets ir.actions.act_window.search_view_id on the UTAK action.
//   4. Deletes TEMP-item3-customer + related x_wa_message /
//      x_quotation / x_daily_order_line rows.
//   5. Reads Ahmed Hassan's Sep 17 19:05 row and reports its
//      x_status (diagnosis only — no fix here).
//   6. Verifies filters via get_views + search_count.

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
  console.error("STOP: .env.sim-verify missing keys");
  process.exit(1);
}

// Gate: no writes 00:30–03:00 Riyadh.
{
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const m = parseInt(parts.find((p) => p.type === "minute").value, 10);
  const mins = h * 60 + m;
  console.log(`Riyadh time: ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  if (mins >= 30 && mins <= 180) {
    console.error("STOP: inside 00:30–03:00 Riyadh window — refusing to write.");
    process.exit(1);
  }
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

// ============================================================
// 0. Confirm the field names actually exist on x_wa_message.
// ============================================================
async function confirmFields() {
  const [model] = await call("ir.model", "search_read", {
    domain: [["model", "=", "x_wa_message"]],
    fields: ["id"],
    limit: 1,
  });
  if (!model) throw new Error("x_wa_message model missing");
  const rows = await call("ir.model.fields", "search_read", {
    domain: [["model_id", "=", model.id]],
    fields: ["name"],
    limit: 500,
  });
  const names = new Set(rows.map((r) => r.name));
  const required = [
    "x_partner_id",
    "x_body",
    "x_meta_message_id",
    "x_direction",
    "x_status",
  ];
  const missing = required.filter((n) => !names.has(n));
  if (missing.length) {
    throw new Error(`x_wa_message missing required fields: ${missing.join(", ")}`);
  }
  return { modelId: model.id, has: names };
}

// ============================================================
// 1. Diagnose current state.
// ============================================================
async function diagnose() {
  console.log("\n=== DIAGNOSIS ===");

  const searchViews = await call("ir.ui.view", "search_read", {
    domain: [["model", "=", "x_wa_message"], ["type", "=", "search"]],
    fields: ["id", "name", "arch_db"],
    limit: 5,
  });
  console.log(`search views for x_wa_message: ${searchViews.length}`);
  for (const v of searchViews) {
    console.log(`  id=${v.id}  name=${v.name}`);
  }

  const actions = await call("ir.actions.act_window", "search_read", {
    domain: [["res_model", "=", "x_wa_message"]],
    fields: ["id", "name", "search_view_id", "view_mode"],
    limit: 5,
  });
  console.log(`\nact_window on x_wa_message: ${actions.length}`);
  for (const a of actions) {
    const sv = a.search_view_id;
    const svTxt = Array.isArray(sv) ? `${sv[0]} (${sv[1]})` : "unset";
    console.log(`  id=${a.id}  name=${a.name}  search_view_id=${svTxt}  view_mode=${a.view_mode}`);
  }

  return { searchViews, actions };
}

// ============================================================
// 2. Rewrite the search view arch.
//
// "اليوم" filter: use context_today().strftime('%Y-%m-%d 00:00:00')
// — one call, no datetime.combine. That has been the boring / safe
// idiom in Odoo since v13 (matches sale.report, purchase.report, etc.)
// and survives 19.4 arch validation. Odoo evaluates context_today()
// in the user tz, so a Riyadh user gets today-in-Riyadh boundary.
// ============================================================
async function ensureSearchView() {
  const name = "x_wa_message.search";
  const existing = await call("ir.ui.view", "search_read", {
    domain: [["name", "=", name]],
    fields: ["id"],
    limit: 1,
  });

  // arch built up in tiers so an Odoo 19.4 validation failure names the
  // exact block that's wrong. On silent rollback, Odoo returns MissingError
  // on the just-created id; we short-circuit on the first bad tier and log
  // it. Each tier is a full <search>...</search> the previous tier plus one
  // more piece.
  const tiers = [
    ["baseline (3 filters)", `
      <search>
        <field name="x_partner_id"/>
        <filter name="fltr_outbound" string="صادرة" domain="[('x_direction', '=', 'out')]"/>
        <filter name="fltr_inbound"  string="واردة"  domain="[('x_direction', '=', 'in')]"/>
        <filter name="fltr_failed"   string="مرفوضة" domain="[('x_status', '=', 'failed')]"/>
      </search>`],
    ["+ text/meta search fields", `
      <search>
        <field name="x_partner_id"/>
        <field name="x_body" string="النص" filter_domain="[('x_body', 'ilike', self)]"/>
        <field name="x_meta_message_id" string="wamid"/>
        <filter name="fltr_outbound" string="صادرة" domain="[('x_direction', '=', 'out')]"/>
        <filter name="fltr_inbound"  string="واردة"  domain="[('x_direction', '=', 'in')]"/>
        <filter name="fltr_failed"   string="مرفوضة" domain="[('x_status', '=', 'failed')]"/>
      </search>`],
    ["+ pending filter", `
      <search>
        <field name="x_partner_id"/>
        <field name="x_body" string="النص" filter_domain="[('x_body', 'ilike', self)]"/>
        <field name="x_meta_message_id" string="wamid"/>
        <filter name="fltr_outbound" string="صادرة" domain="[('x_direction', '=', 'out')]"/>
        <filter name="fltr_inbound"  string="واردة"  domain="[('x_direction', '=', 'in')]"/>
        <filter name="fltr_failed"   string="مرفوضة" domain="[('x_status', '=', 'failed')]"/>
        <filter name="fltr_pending"  string="قيد الإرسال" domain="[('x_status', 'in', ['draft', 'queued', 'sending'])]"/>
      </search>`],
    ["+ today filter", `
      <search>
        <field name="x_partner_id"/>
        <field name="x_body" string="النص" filter_domain="[('x_body', 'ilike', self)]"/>
        <field name="x_meta_message_id" string="wamid"/>
        <filter name="fltr_outbound" string="صادرة" domain="[('x_direction', '=', 'out')]"/>
        <filter name="fltr_inbound"  string="واردة"  domain="[('x_direction', '=', 'in')]"/>
        <filter name="fltr_failed"   string="مرفوضة" domain="[('x_status', '=', 'failed')]"/>
        <filter name="fltr_pending"  string="قيد الإرسال" domain="[('x_status', 'in', ['draft', 'queued', 'sending'])]"/>
        <filter name="fltr_today"    string="اليوم" domain="[('create_date', '>=', context_today().strftime('%Y-%m-%d 00:00:00'))]"/>
      </search>`],
    ["+ group-by (flat, no <group>)", `
      <search>
        <field name="x_partner_id"/>
        <field name="x_body" string="النص" filter_domain="[('x_body', 'ilike', self)]"/>
        <field name="x_meta_message_id" string="wamid"/>
        <filter name="fltr_outbound" string="صادرة" domain="[('x_direction', '=', 'out')]"/>
        <filter name="fltr_inbound"  string="واردة"  domain="[('x_direction', '=', 'in')]"/>
        <filter name="fltr_failed"   string="مرفوضة" domain="[('x_status', '=', 'failed')]"/>
        <filter name="fltr_pending"  string="قيد الإرسال" domain="[('x_status', 'in', ['draft', 'queued', 'sending'])]"/>
        <filter name="fltr_today"    string="اليوم" domain="[('create_date', '>=', context_today().strftime('%Y-%m-%d 00:00:00'))]"/>
        <separator/>
        <filter name="gb_partner"   string="تجميع: الشريك"  context="{'group_by': 'x_partner_id'}"/>
        <filter name="gb_status"    string="تجميع: الحالة"  context="{'group_by': 'x_status'}"/>
        <filter name="gb_direction" string="تجميع: الاتجاه" context="{'group_by': 'x_direction'}"/>
      </search>`],
  ];

  let lastGoodArch = null;
  let lastGoodTier = null;
  for (const [label, arch] of tiers) {
    try {
      if (existing[0]) {
        await call("ir.ui.view", "write", { ids: [existing[0].id], vals: { arch_base: arch } });
      } else {
        // Only the first tier attempts creation; subsequent tiers overwrite.
        const ids = await call("ir.ui.view", "create", {
          vals_list: [{ name, model: "x_wa_message", type: "search", arch_base: arch }],
        });
        existing[0] = { id: ids[0] };
      }
      // Force a get_views to trip Odoo's silent-rollback validation.
      await call("x_wa_message", "get_views", { views: [[existing[0].id, "search"]] });
      lastGoodArch = arch;
      lastGoodTier = label;
      console.log(`  tier OK: ${label}`);
    } catch (e) {
      console.error(`  tier FAILED: ${label} → ${e.message.slice(0, 200)}`);
      if (lastGoodArch) {
        console.error(`  rolling back to last good tier: ${lastGoodTier}`);
        await call("ir.ui.view", "write", {
          ids: [existing[0].id],
          vals: { arch_base: lastGoodArch },
        });
      }
      throw e;
    }
  }

  const arch = lastGoodArch;

  if (existing[0]) {
    await call("ir.ui.view", "write", { ids: [existing[0].id], vals: { arch_base: arch } });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.ui.view", "create", {
    vals_list: [{ name, model: "x_wa_message", type: "search", arch_base: arch }],
  });
  return { id: ids[0], action: "created" };
}

// ============================================================
// 3. Bind the search view to the UTAK action.
// ============================================================
async function bindActionToSearchView(searchViewId) {
  const rows = await call("ir.actions.act_window", "search_read", {
    domain: [["res_model", "=", "x_wa_message"], ["name", "=", "UTAK — رسائل واتساب"]],
    fields: ["id", "search_view_id"],
    limit: 1,
  });
  if (!rows[0]) throw new Error(`action 'UTAK — رسائل واتساب' not found`);
  await call("ir.actions.act_window", "write", {
    ids: [rows[0].id],
    vals: { search_view_id: searchViewId },
  });
  return rows[0].id;
}

// ============================================================
// 4. Verify: get_views + search_count.
// ============================================================
async function verify(actionId, searchViewId) {
  console.log("\n=== VERIFY ===");

  const views = await call("x_wa_message", "get_views", {
    views: [[false, "list"], [false, "form"], [searchViewId, "search"]],
  });
  const searchArch = views?.views?.search?.arch ?? "";
  console.log(`get_views(search) arch length = ${searchArch.length}`);
  const wanted = ["fltr_inbound", "fltr_outbound", "fltr_failed", "fltr_today", "fltr_pending", "gb_partner"];
  const found = wanted.filter((n) => searchArch.includes(n));
  console.log(`filters present in arch: ${found.join(", ")}  (${found.length}/${wanted.length})`);
  const preview = searchArch.slice(0, 700).replace(/\s+/g, " ");
  console.log(`arch preview: ${preview}...`);

  const filters = [
    { name: "واردة",         domain: [["x_direction", "=", "in"]] },
    { name: "صادرة",         domain: [["x_direction", "=", "out"]] },
    { name: "مرفوضة",        domain: [["x_status", "=", "failed"]] },
    { name: "قيد الإرسال",   domain: [["x_status", "in", ["draft", "queued", "sending"]]] },
  ];
  const counts = {};
  for (const f of filters) {
    const c = await call("x_wa_message", "search_count", { domain: f.domain });
    counts[f.name] = c;
    console.log(`  search_count ${f.name.padEnd(14)} → ${c}`);
  }
  const total = await call("x_wa_message", "search_count", { domain: [] });
  console.log(`  search_count (total)         → ${total}`);

  // Prove the "today" filter parses server-side. Domain is what the
  // filter compiles to; we use a fixed Riyadh-today string to sanity
  // check, and separately validate the Python expression by asking
  // the ORM to compile the exact same view we just wrote (get_views
  // returns arch=already-parsed only, so any bad domain would 500).
  const today = new Date().toLocaleString("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayCount = await call("x_wa_message", "search_count", {
    domain: [["create_date", ">=", `${today} 00:00:00`]],
  });
  console.log(`  search_count اليوم (${today})    → ${todayCount}`);

  const actionRow = await call("ir.actions.act_window", "read", {
    ids: [actionId],
    fields: ["id", "name", "search_view_id", "view_mode"],
  });
  console.log(`action → ${JSON.stringify(actionRow[0])}`);

  return { counts, total, todayCount, foundInArch: found };
}

// ============================================================
// 5. Cleanup TEMP-item3-customer + related.
// ============================================================
async function cleanupTempItem3() {
  console.log("\n=== CLEANUP ===");
  const partners = await call("res.partner", "search_read", {
    domain: [["name", "=", "TEMP-item3-customer"]],
    fields: ["id", "name"],
    limit: 5,
  });
  if (partners.length === 0) {
    console.log("no TEMP-item3-customer partner — nothing to clean.");
    return { partner_ids: [], deleted: {} };
  }
  const partnerIds = partners.map((p) => p.id);
  console.log(`TEMP-item3-customer partner ids: ${partnerIds.join(", ")}`);

  const deleted = { x_wa_message: 0, x_daily_order_line: 0, x_quotation: 0, res_partner: 0 };

  // wa_messages tied to this partner
  const waIds = (await call("x_wa_message", "search_read", {
    domain: [["x_partner_id", "in", partnerIds]],
    fields: ["id"],
    limit: 200,
  })).map((r) => r.id);
  if (waIds.length) {
    await call("x_wa_message", "unlink", { ids: waIds });
    deleted.x_wa_message = waIds.length;
    console.log(`  x_wa_message deleted: ${waIds.length}  (ids=${waIds.join(",")})`);
  }

  // quotations for this partner
  const quotationIds = (await call("x_quotation", "search_read", {
    domain: [["x_partner_id", "in", partnerIds]],
    fields: ["id"],
    limit: 200,
  })).map((r) => r.id);

  // order lines that live under those quotations (x_daily_order_line
  // has both x_partner_id and x_quotation_id — cover both).
  const lineDomain = quotationIds.length
    ? ["|", ["x_partner_id", "in", partnerIds], ["x_quotation_id", "in", quotationIds]]
    : ["x_partner_id", "in", partnerIds];
  const lineIds = (await call("x_daily_order_line", "search_read", {
    domain: quotationIds.length ? lineDomain : [lineDomain],
    fields: ["id"],
    limit: 500,
  })).map((r) => r.id);
  if (lineIds.length) {
    await call("x_daily_order_line", "unlink", { ids: lineIds });
    deleted.x_daily_order_line = lineIds.length;
    console.log(`  x_daily_order_line deleted: ${lineIds.length}  (ids=${lineIds.join(",")})`);
  }

  if (quotationIds.length) {
    await call("x_quotation", "unlink", { ids: quotationIds });
    deleted.x_quotation = quotationIds.length;
    console.log(`  x_quotation deleted: ${quotationIds.length}  (ids=${quotationIds.join(",")})`);
  }

  await call("res.partner", "unlink", { ids: partnerIds });
  deleted.res_partner = partnerIds.length;
  console.log(`  res.partner deleted: ${partnerIds.length}  (ids=${partnerIds.join(",")})`);

  return { partner_ids: partnerIds, deleted };
}

// ============================================================
// 6. Diagnose Ahmed Hassan's Sep 17 19:05 row.
// ============================================================
async function diagnoseAhmedRow() {
  console.log("\n=== AHMED HASSAN SEP 17 19:05 ===");
  const rows = await call("x_wa_message", "search_read", {
    domain: [
      ["create_date", ">=", "2026-09-17 15:00:00"],
      ["create_date", "<=", "2026-09-17 17:05:00"],
    ],
    fields: [
      "id", "create_date", "x_partner_id", "x_direction", "x_status",
      "x_kind", "x_body", "x_meta_message_id", "x_dry_run",
    ],
    order: "id desc",
    limit: 20,
  });
  console.log(`candidate rows (Sep 17 15:00–17:05 UTC = 18:00–20:05 Riyadh): ${rows.length}`);
  for (const r of rows) {
    const partner = Array.isArray(r.x_partner_id) ? r.x_partner_id[1] : r.x_partner_id;
    console.log(
      `  id=${r.id}  create=${r.create_date}  partner=${partner}  dir=${r.x_direction}  status=${JSON.stringify(r.x_status)}  kind=${r.x_kind}  wamid=${r.x_meta_message_id ?? ""}`,
    );
  }
  // Try a broader hunt by name too.
  const byName = await call("x_wa_message", "search_read", {
    domain: [
      "|",
      ["x_partner_id.name", "ilike", "حسان"],
      ["x_partner_id.name", "ilike", "احمد"],
      ["create_date", ">=", "2026-09-17 00:00:00"],
      ["create_date", "<=", "2026-09-18 00:00:00"],
    ],
    fields: ["id", "create_date", "x_partner_id", "x_direction", "x_status", "x_body"],
    order: "id desc",
    limit: 20,
  });
  console.log(`by-partner-name candidates: ${byName.length}`);
  for (const r of byName) {
    const partner = Array.isArray(r.x_partner_id) ? r.x_partner_id[1] : r.x_partner_id;
    console.log(
      `  id=${r.id}  create=${r.create_date}  partner=${partner}  dir=${r.x_direction}  status=${JSON.stringify(r.x_status)}`,
    );
  }
  return { rows, byName };
}

async function main() {
  await diagnose();

  await confirmFields();

  const searchView = await ensureSearchView();
  console.log(`\nsearch view: id=${searchView.id}  action=${searchView.action}`);

  const actionId = await bindActionToSearchView(searchView.id);
  console.log(`bound action id=${actionId} → search_view_id=${searchView.id}`);

  const verifyOut = await verify(actionId, searchView.id);

  const cleanup = await cleanupTempItem3();
  const ahmed = await diagnoseAhmedRow();

  console.log("\n--- summary ---");
  console.log(JSON.stringify(
    {
      search_view_id: searchView.id,
      action_id: actionId,
      filters_in_arch: verifyOut.foundInArch,
      counts: verifyOut.counts,
      today_count: verifyOut.todayCount,
      total: verifyOut.total,
      cleanup,
      ahmed_row_count: ahmed.rows.length + ahmed.byName.length,
    },
    null,
    2,
  ));
}

main().catch((e) => {
  console.error("ITEM 2 FILTERS FAILED:", e);
  process.exit(1);
});
