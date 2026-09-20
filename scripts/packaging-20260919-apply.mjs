// Packaging refactor — 2026-09-19.
//
// Applies these changes to the SHARED Odoo tenant utakfresh.odoo.com:
//
//   1) Adds selection field x_product_packaging.x_type with values
//      carton / bag / foam / loose (Arabic labels).
//   2) Creates two base.automation rules on x_product_packaging:
//        - utak.packaging.auto_name  — rebuilds x_name from x_type + weight
//        - utak.packaging.default_guard — turns off other defaults on same tmpl
//      Each rule owns one ir.actions.server row with state='code' and NO imports.
//   3) Migrates the existing 47 packaging rows: sets x_type from x_name,
//      clears weight on the one loose row (بطيخ #46), moves watermelon's
//      default onto that loose row.
//   4) Creates an inherit view "utak.product.template.list.packaging" on the
//      standard product.template list (id=604) that adds x_packaging_ids as
//      a many2many_tags column — visible in Sales, Inventory and Purchase.
//   5) Creates a primary list view "utak.x_product_packaging.list.editable"
//      for the Settings → التغليف action (act_window 932) so the list is
//      editable inline, grouped by product.
//
// Idempotency: every object is looked up by name first; re-runs update in
// place instead of creating duplicates. It is safe to re-run.
//
// Reads the BEFORE snapshot at scripts/artifacts/packaging-20260919-rollback.json
// (produced by packaging-20260919-snapshot.mjs) and validates it before
// touching anything.

import { readFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
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
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

// ────────────────────────────── Rules ──────────────────────────────
//
// Classification rules per task 2:
//   - x_name contains "كرتون" → carton
//   - x_name contains "كيس" OR "جرم"  → bag
//   - x_name contains "فلين" → foam
//   - x_name contains "كيلو" OR "فرط" (and no "عبوة") → loose
//   - otherwise: leave x_type empty and flag in the report
// Extra: watermelon's default becomes the loose row.
// Extra: loose rows have x_approx_weight_kg cleared.
function classify(x_name) {
  const s = String(x_name || "");
  if (s.includes("عبوة")) return null; // guard from task
  if (s.includes("كرتون")) return "carton";
  if (s.includes("كيس") || s.includes("جرم")) return "bag";
  if (s.includes("فلين")) return "foam";
  if (s.includes("كيلو") || s.includes("فرط")) return "loose";
  return null; // untyped — leave empty
}

// The Python action bodies. NO imports.
const AUTO_NAME_CODE = `
labels = {'carton': 'كرتون', 'bag': 'جرم', 'foam': 'فلين'}
for r in records:
    t = r.x_type
    if not t:
        continue
    if t == 'loose':
        new_name = 'فرط (بالكيلو)'
    else:
        label = labels.get(t, '')
        w = r.x_approx_weight_kg or 0
        if w and w > 0:
            wf = float(w)
            if wf == int(wf):
                w_txt = str(int(wf))
            else:
                w_txt = ('%f' % wf).rstrip('0').rstrip('.')
            new_name = label + ' · ' + w_txt + ' كيلو'
        else:
            new_name = label
    if r.x_name != new_name:
        r.write({'x_name': new_name})
`;

const DEFAULT_GUARD_CODE = `
for r in records:
    if not r.x_is_default:
        continue
    if not r.x_product_tmpl_id:
        continue
    others = env['x_product_packaging'].search([
        ('id', '!=', r.id),
        ('x_product_tmpl_id', '=', r.x_product_tmpl_id.id),
        ('x_is_default', '=', True),
    ])
    if others:
        others.write({'x_is_default': False})
`;

// ────────────────────────────── Helpers ──────────────────────────────

async function findOne(model, domain, fields) {
  const rows = await call(model, "search_read", { domain, fields, limit: 1 });
  return rows[0] ?? null;
}

async function upsertField(modelId) {
  // ir.model.fields row for x_product_packaging.x_type.
  const existing = await findOne("ir.model.fields", [
    ["model", "=", "x_product_packaging"],
    ["name", "=", "x_type"],
  ], ["id", "ttype", "state"]);
  if (existing) {
    console.log(`  x_type field already exists id=${existing.id}`);
    return existing.id;
  }
  const [id] = await call("ir.model.fields", "create", {
    vals_list: [{
      model_id: modelId,
      model: "x_product_packaging",
      name: "x_type",
      ttype: "selection",
      state: "manual",
      field_description: "النوع",
      copied: true,
    }],
  });
  console.log(`  created x_type field id=${id}`);
  return id;
}

async function upsertSelectionOptions(fieldId) {
  const wanted = [
    { value: "carton", name: "كرتون", sequence: 10 },
    { value: "bag",    name: "جرم",   sequence: 20 },
    { value: "foam",   name: "فلين", sequence: 30 },
    { value: "loose",  name: "فرط",  sequence: 40 },
  ];
  const existing = await call("ir.model.fields.selection", "search_read", {
    domain: [["field_id", "=", fieldId]],
    fields: ["id", "value", "name", "sequence"],
  });
  const byValue = new Map(existing.map((e) => [e.value, e]));
  for (const opt of wanted) {
    const e = byValue.get(opt.value);
    if (e) {
      if (e.name !== opt.name || e.sequence !== opt.sequence) {
        await call("ir.model.fields.selection", "write", {
          ids: [e.id], vals: { name: opt.name, sequence: opt.sequence },
        });
        console.log(`    updated selection ${opt.value} → "${opt.name}"`);
      }
    } else {
      await call("ir.model.fields.selection", "create", {
        vals_list: [{ field_id: fieldId, value: opt.value, name: opt.name, sequence: opt.sequence }],
      });
      console.log(`    created selection ${opt.value} → "${opt.name}"`);
    }
  }
}

async function upsertServerAction(name, modelId, code) {
  const existing = await findOne("ir.actions.server", [["name", "=", name]], ["id", "state"]);
  if (existing) {
    await call("ir.actions.server", "write", {
      ids: [existing.id],
      vals: { model_id: modelId, state: "code", code, usage: "base_automation" },
    });
    console.log(`  server action "${name}" updated id=${existing.id}`);
    return existing.id;
  }
  const [id] = await call("ir.actions.server", "create", {
    vals_list: [{ name, model_id: modelId, state: "code", code, usage: "base_automation" }],
  });
  console.log(`  server action "${name}" created id=${id}`);
  return id;
}

async function upsertAutomation({ name, modelId, trigger, triggerFieldIds, filterDomain, serverActionId }) {
  const existing = await findOne("base.automation", [["name", "=", name]], ["id", "active"]);
  const vals = {
    name,
    model_id: modelId,
    trigger,
    trigger_field_ids: [[6, 0, triggerFieldIds]],
    filter_domain: filterDomain,
    action_server_ids: [[6, 0, [serverActionId]]],
    active: true,
  };
  if (existing) {
    await call("base.automation", "write", { ids: [existing.id], vals });
    console.log(`  base.automation "${name}" updated id=${existing.id}`);
    return existing.id;
  }
  const [id] = await call("base.automation", "create", { vals_list: [vals] });
  console.log(`  base.automation "${name}" created id=${id}`);
  return id;
}

async function upsertView(name, vals) {
  const existing = await findOne("ir.ui.view", [["name", "=", name]], ["id"]);
  if (existing) {
    await call("ir.ui.view", "write", { ids: [existing.id], vals });
    console.log(`  view "${name}" updated id=${existing.id}`);
    return existing.id;
  }
  const [id] = await call("ir.ui.view", "create", { vals_list: [{ name, ...vals }] });
  console.log(`  view "${name}" created id=${id}`);
  return id;
}

// ────────────────────────────── Main ──────────────────────────────

async function main() {
  const stamp = new Date().toISOString();
  console.log(`packaging apply — ${stamp}`);

  // ---------------- BEFORE snapshot must exist ----------------
  const snapPath = new URL("./artifacts/packaging-20260919-rollback.json", import.meta.url).pathname;
  const snap = JSON.parse(readFileSync(snapPath, "utf8"));
  console.log(`snapshot: ${snapPath} (${snap.rows.length} rows)`);
  if (snap.rows.length === 0) {
    throw new Error("empty snapshot; refuse to apply");
  }

  // ---------------- Preflight: model + fields ----------------
  const model = await findOne("ir.model", [["model", "=", "x_product_packaging"]], ["id"]);
  if (!model) throw new Error("x_product_packaging model row missing");
  const modelId = model.id;
  console.log(`x_product_packaging ir.model id=${modelId}`);

  // 1) x_type selection field
  console.log("\n[1] x_type selection field");
  const fieldId = await upsertField(modelId);
  await upsertSelectionOptions(fieldId);

  // ---------------- Trigger field ids for base.automation ----------------
  const fields = await call("ir.model.fields", "search_read", {
    domain: [
      ["model", "=", "x_product_packaging"],
      ["name", "in", ["x_type", "x_approx_weight_kg", "x_is_default"]],
    ],
    fields: ["id", "name"],
  });
  const fid = Object.fromEntries(fields.map((f) => [f.name, f.id]));
  if (!fid.x_type || !fid.x_approx_weight_kg || !fid.x_is_default) {
    throw new Error(`missing trigger field ids: ${JSON.stringify(fid)}`);
  }

  // 2) server actions + automation rules
  console.log("\n[2] server actions + automation rules");
  const autoNameSaId = await upsertServerAction(
    "UTAK Packaging — auto x_name",
    modelId,
    AUTO_NAME_CODE.trim(),
  );
  const defaultGuardSaId = await upsertServerAction(
    "UTAK Packaging — default guard",
    modelId,
    DEFAULT_GUARD_CODE.trim(),
  );
  await upsertAutomation({
    name: "utak.packaging.auto_name",
    modelId,
    trigger: "on_create_or_write",
    triggerFieldIds: [fid.x_type, fid.x_approx_weight_kg],
    filterDomain: false,
    serverActionId: autoNameSaId,
  });
  await upsertAutomation({
    name: "utak.packaging.default_guard",
    modelId,
    trigger: "on_create_or_write",
    triggerFieldIds: [fid.x_is_default],
    filterDomain: "[['x_is_default', '=', True]]",
    serverActionId: defaultGuardSaId,
  });

  // 3) Migrate the 47 rows
  console.log("\n[3] migrating existing rows");
  const rows = await call("x_product_packaging", "search_read", {
    domain: [],
    fields: ["id","x_name","x_product_tmpl_id","x_approx_weight_kg","x_is_default","x_sequence","x_type"],
    order: "x_product_tmpl_id, x_sequence, id",
  });
  console.log(`  read ${rows.length} rows`);

  const untyped = [];
  const converted = { carton: [], bag: [], foam: [], loose: [] };
  // First pass: assign x_type only (the auto-name rule will rebuild x_name).
  for (const r of rows) {
    const t = classify(r.x_name);
    if (!t) {
      untyped.push(r);
      continue;
    }
    const vals = {};
    if (r.x_type !== t) vals.x_type = t;
    if (t === "loose" && r.x_approx_weight_kg) vals.x_approx_weight_kg = false;
    if (Object.keys(vals).length > 0) {
      await call("x_product_packaging", "write", { ids: [r.id], vals });
      console.log(`    #${r.id} "${r.x_name}" → x_type=${t}${vals.x_approx_weight_kg === false ? " weight→∅" : ""}`);
    } else {
      console.log(`    #${r.id} "${r.x_name}" already x_type=${t} — skip`);
    }
    converted[t].push(r.id);
  }

  // 4) Watermelon default → loose row (#46 "كيلو")
  console.log("\n[4] watermelon default → loose");
  const watermelonTmpl = 104; // UTAK-FRT-009 بطيخ
  const wmRows = await call("x_product_packaging", "search_read", {
    domain: [["x_product_tmpl_id", "=", watermelonTmpl]],
    fields: ["id", "x_name", "x_type", "x_is_default"],
    order: "x_sequence, id",
  });
  const looseRow = wmRows.find((r) => r.x_type === "loose");
  if (!looseRow) {
    console.log(`  no loose row found on watermelon (rows: ${JSON.stringify(wmRows)}) — leaving as-is, reported`);
  } else if (!looseRow.x_is_default) {
    await call("x_product_packaging", "write", {
      ids: [looseRow.id],
      vals: { x_is_default: true },
    });
    console.log(`  watermelon loose #${looseRow.id} → x_is_default=true (guard should clear others)`);
  } else {
    console.log(`  watermelon loose #${looseRow.id} already default — skip`);
  }

  // 5) Missing-default fallback (task 4): any template with no default → first by seq.
  console.log("\n[5] ensuring every template has a default");
  const allAfter = await call("x_product_packaging", "search_read", {
    domain: [],
    fields: ["id", "x_product_tmpl_id", "x_is_default", "x_sequence"],
    order: "x_product_tmpl_id, x_sequence, id",
  });
  const byTmpl = new Map();
  for (const r of allAfter) {
    if (!r.x_product_tmpl_id) continue;
    const tid = r.x_product_tmpl_id[0];
    if (!byTmpl.has(tid)) byTmpl.set(tid, []);
    byTmpl.get(tid).push(r);
  }
  const noDefaultFixed = [];
  for (const [tid, list] of byTmpl) {
    if (list.some((r) => r.x_is_default)) continue;
    const first = list[0];
    await call("x_product_packaging", "write", { ids: [first.id], vals: { x_is_default: true } });
    noDefaultFixed.push({ tmpl: tid, id: first.id });
    console.log(`  tmpl ${tid} had no default; set #${first.id} default=true`);
  }
  if (noDefaultFixed.length === 0) {
    console.log("  every template already has a default — no-op");
  }

  // 6) product.template list view: inherit view adding x_packaging_ids column
  console.log("\n[6] product.template list column via inherit");
  await upsertView("utak.product.template.list.packaging", {
    model: "product.template",
    type: "list",
    inherit_id: 604,
    priority: 30,
    mode: "extension",
    active: true,
    arch_base: `<xpath expr="//field[@name='name']" position="after">
  <field name="x_packaging_ids" widget="many2many_tags" string="التغليف" optional="show"/>
</xpath>`,
  });

  // 7) Editable list view for act_window 932 (Settings → التغليف)
  console.log("\n[7] editable list view for التغليف (act_window 932)");
  const packListId = await upsertView("utak.x_product_packaging.list.editable", {
    model: "x_product_packaging",
    type: "list",
    priority: 5,
    mode: "primary",
    active: true,
    arch_base: `<list string="التغليف" editable="bottom" default_group_by="x_product_tmpl_id">
  <field name="x_product_tmpl_id" string="الصنف"/>
  <field name="x_type" string="النوع"/>
  <field name="x_approx_weight_kg" string="الوزن (كيلو)"/>
  <field name="x_is_default" string="افتراضي"/>
  <field name="x_sequence" string="الترتيب" widget="handle"/>
  <field name="x_name" string="العرض" readonly="1" optional="hide"/>
</list>`,
  });
  console.log(`  packaging list view id=${packListId}`);

  // Wire the list view to act_window 932. Odoo enforces one row per
  // (act_window_id, view_mode); if a list row already exists (e.g. the
  // stale "id=359" join we saw in the snapshot), update it in place.
  const listLink = await findOne("ir.actions.act_window.view", [
    ["act_window_id", "=", 932],
    ["view_mode", "=", "list"],
  ], ["id", "view_id"]);
  if (listLink) {
    if (!listLink.view_id || listLink.view_id[0] !== packListId) {
      await call("ir.actions.act_window.view", "write", {
        ids: [listLink.id],
        vals: { view_id: packListId, sequence: 1 },
      });
      console.log(`  updated act_window.view #${listLink.id} → view_id=${packListId}`);
    } else {
      console.log(`  act_window.view #${listLink.id} already points at ${packListId}`);
    }
  } else {
    const [linkId] = await call("ir.actions.act_window.view", "create", {
      vals_list: [{
        act_window_id: 932,
        view_id: packListId,
        view_mode: "list",
        sequence: 1,
      }],
    });
    console.log(`  linked view to act_window 932 (act_window.view id=${linkId})`);
  }

  // ---------------- AFTER report ----------------
  console.log("\n[report] conversion summary");
  console.log(`  carton: ${converted.carton.length}`);
  console.log(`  bag:    ${converted.bag.length}`);
  console.log(`  foam:   ${converted.foam.length}`);
  console.log(`  loose:  ${converted.loose.length}`);
  console.log(`  untyped (left empty, needs human review):`);
  for (const r of untyped) {
    console.log(`    #${r.id} "${r.x_name}" tmpl=${JSON.stringify(r.x_product_tmpl_id)} weight=${r.x_approx_weight_kg}`);
  }

  console.log("\n[report] weights (task 8)");
  const after = await call("x_product_packaging", "search_read", {
    domain: [],
    fields: ["id","x_name","x_product_tmpl_id","x_approx_weight_kg","x_is_default","x_type","x_sequence"],
    order: "x_product_tmpl_id, x_sequence, id",
  });
  for (const r of after) {
    const tmpl = r.x_product_tmpl_id ? r.x_product_tmpl_id[1] : "(no tmpl)";
    const isBanana = /موز أمريكي/.test(tmpl) && r.x_approx_weight_kg === 14;
    const isAvocado = /افوكادو|أفوكادو/.test(tmpl) && r.x_approx_weight_kg === 4;
    const label = isBanana || isAvocado
      ? "متحقق"
      : r.x_approx_weight_kg === 8
        ? "قيمة إعداد افتراضية — يحتاج وزن"
        : "غير متحقق";
    console.log(
      `  #${r.id} ${tmpl} — ${r.x_type || "(untyped)"} — w=${r.x_approx_weight_kg} — default=${r.x_is_default} — ${label}`
    );
  }
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
