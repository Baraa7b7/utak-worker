// § 67 (2026-10-08) — «🧊 وضع التجميد»: the tenant's side (scripts/lib/s67-odoo.mjs is the data), in TWO parts:
//
//   schema (--only=schema, BEFORE the worker's code: it reads these fields and writes the status «frozen»)
//     1  x_pricing_config: x_freeze_on «🧊 وضع التجميد», x_freeze_until «حتى تاريخ», x_freeze_reply (the reply a
//        customer's attempt to order gets), x_freeze_since / x_freeze_ended_at (stamped by Odoo itself)
//     2  x_price_day.x_freeze_on — not stored: the switch of the active settings, for the button of «📊 اليوم»
//     3  x_wa_message.x_status «🧊 مجمّد (لم تُرسل)» (frozen)
//     4  three code actions (no call to the worker): «جمّد» / «أطفئ» for the button, and the stamp an automation
//        runs on every change of the switch (the worker reads «بدأ» / «انتهى» to send nothing late)
//     5  the default reply on the settings that hold none
//   ui (--only=ui, AFTER the worker's code is deployed: a switch the deployed worker does not read would lie)
//     6  three extension views: «📊 اليوم» (the button that shows the state, and the banner), «⚙️ الإعدادات»
//        (the group «🧊 وضع التجميد»), and the filter «🧊 مجمّد» of the WhatsApp messages
//
//   node scripts/s67-20261008-odoo.mjs --only=schema|ui             dry-run: the plan, nothing written
//   node scripts/s67-20261008-odoo.mjs --only=schema|ui --apply     (the rollback file first)
//   node scripts/s67-20261008-odoo.mjs --only=schema|ui --verify    read-only checks
//   node scripts/s67-20261008-odoo.mjs --switch=on|off [--until=YYYY-MM-DD] [--apply]
//                                                                   the switch itself, as the button of «📊 اليوم» writes it
//   node scripts/s67-20261008-odoo.mjs --state                      read-only: the switch and its stamps
//   node scripts/s67-20261008-odoo.mjs --rollback [--apply]         the three views off and the switch OFF. Fields, the
//                                                                   status, the actions and the automation stay.
// Rollback file: scripts/artifacts/s67-20261008-odoo-rollback.json. The tenant is production. No WhatsApp send.
// ROLLBACK ORDER: (1) --rollback (no button, the switch off), (2) THE CODE. Nothing is deleted.
import {
  APPLY, ROLLBACK, VERIFY, call, checker, ensureFields, ensureServerAction, ensureView, log, modelId, rollbackFile,
} from "./lib/s40-kit.mjs";
import * as L from "./lib/s67-odoo.mjs";

const RB = new URL("./artifacts/s67-20261008-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s67-20261008-odoo.mjs");
const { rb, save } = ctx;
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const SWITCH = (process.argv.find((a) => a.startsWith("--switch=")) ?? "").slice(9);
const UNTIL = (process.argv.find((a) => a.startsWith("--until=")) ?? "").slice(8);
const STATE = process.argv.includes("--state");
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const AR = { lang: "ar_001" };
const riyadhDay = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db"], context: ALL }))[0] ?? null;
const actionByName = async (name) => (await call("ir.actions.server", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "state", "model_name", "code", "webhook_url"], context: ALL }))[0] ?? null;
const automationRow = async () => (await call("base.automation", "search_read", { domain: [["name", "=", L.AUTOMATION]], fields: ["id", "name", "active", "trigger", "model_name", "trigger_field_ids", "action_server_ids"], context: ALL }))[0] ?? null;
const fieldId = async (model, name) => (await call("ir.model.fields", "search_read", { domain: [["model", "=", model], ["name", "=", name]], fields: ["id"] }))[0]?.id ?? 0;
const statusRows = async () => {
  const f = await fieldId(L.MSG_MODEL, "x_status");
  return { f, rows: f ? await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", f]], fields: ["id", "value", "name", "sequence"], order: "sequence asc, id asc", context: AR }) : [] };
};
const FREEZE_READ = ["id", "x_name", "x_freeze_on", "x_freeze_until", "x_freeze_reply", "x_freeze_since", "x_freeze_ended_at"];
/** The settings «⚙️ الإعدادات» opens today (the worker reads the same record). */
const activeConfig = async (fields = ["id", "x_name"]) => (await call(L.CONFIG_MODEL, "search_read", {
  domain: [["x_is_active", "=", true], ["x_active_from", "<=", riyadhDay()], "|", ["x_active_to", "=", false], ["x_active_to", ">=", riyadhDay()]],
  fields, order: "x_active_from desc, id desc", limit: 1,
}))[0] ?? null;

// ---------------------------------------------------------------- the switch, and its state
if (STATE) {
  const cfg = await activeConfig(FREEZE_READ);
  console.log(JSON.stringify({ ...cfg, x_freeze_reply: String(cfg?.x_freeze_reply || "").slice(0, 80) }));
  process.exit(0);
}
if (SWITCH) {
  if (SWITCH !== "on" && SWITCH !== "off") { console.log("--switch=on or --switch=off"); process.exit(2); }
  if (UNTIL && !/^\d{4}-\d{2}-\d{2}$/.test(UNTIL)) { console.log("--until=YYYY-MM-DD"); process.exit(2); }
  const cfg = await activeConfig(FREEZE_READ);
  if (!cfg) { log("✗ no active pricing settings today"); process.exit(1); }
  const vals = SWITCH === "on" ? { x_freeze_on: true, x_freeze_until: UNTIL || false } : { x_freeze_on: false, x_freeze_until: false };
  log(`${cfg.x_freeze_on === vals.x_freeze_on && (cfg.x_freeze_until || false) === vals.x_freeze_until ? "=" : "✎"} settings #${cfg.id}: «🧊 وضع التجميد» ${cfg.x_freeze_on ? "on" : "off"} → ${SWITCH}${SWITCH === "on" ? ` (حتى ${UNTIL || "—"})` : ""}`);
  if (!APPLY) { log("dry-run: nothing written (add --apply)"); process.exit(0); }
  rb.before.switches ??= [];
  rb.before.switches.push({ at: new Date().toISOString(), id: cfg.id, x_freeze_on: cfg.x_freeze_on, x_freeze_until: cfg.x_freeze_until });
  save();
  await call(L.CONFIG_MODEL, "write", { ids: [cfg.id], vals });
  await pause();
  const after = await activeConfig(FREEZE_READ);
  log(`${after.x_freeze_on === vals.x_freeze_on ? "✓" : "✗"} the switch is ${after.x_freeze_on ? "ON" : "off"}; بدأ ${after.x_freeze_since || "—"}، انتهى ${after.x_freeze_ended_at || "—"}، حتى ${after.x_freeze_until || "—"}`);
  process.exit(after.x_freeze_on === vals.x_freeze_on ? 0 : 1);
}

// ---------------------------------------------------------------- rollback (the screens, and the switch off)
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  for (const name of Object.keys(L.views({}))) {
    const v = await viewByName(name);
    if (v?.active) { log(`✎ view ${name} #${v.id}: off`); if (APPLY) await call("ir.ui.view", "write", { ids: [v.id], vals: { active: false } }); }
    else log(`= view ${name}: ${v ? "already off" : "not there"}`);
    await pause(500);
  }
  const cfg = await activeConfig(FREEZE_READ).catch(() => null);
  if (cfg?.x_freeze_on) { log(`✎ settings #${cfg.id}: «🧊 وضع التجميد» off (the code of before § 67 does not read it)`); if (APPLY) await call(L.CONFIG_MODEL, "write", { ids: [cfg.id], vals: { x_freeze_on: false, x_freeze_until: false } }); }
  else log("= «🧊 وضع التجميد»: off");
  log("the fields, the status «مجمّد», the three actions and the automation stay (nothing is deleted)");
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}
if (ONLY !== "schema" && ONLY !== "ui") { console.log("say which part: --only=schema (before the code) or --only=ui (after the deploy)"); process.exit(2); }

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  if (ONLY === "schema") {
    const cf = await call(L.CONFIG_MODEL, "fields_get", { attributes: ["type", "string", "readonly"] });
    for (const d of L.CONFIG_FIELDS) check(`${L.CONFIG_MODEL}.${d.name} (${d.ttype}) «${d.field_description}»`, cf[d.name]?.type === d.ttype && cf[d.name]?.string === d.field_description, JSON.stringify(cf[d.name] ?? null));
    await pause();
    const df = await call(L.DAY_MODEL, "fields_get", { attributes: ["type", "store"] });
    check(`${L.DAY_MODEL}.x_freeze_on is a boolean that is not stored`, df.x_freeze_on?.type === "boolean" && df.x_freeze_on?.store === false, JSON.stringify(df.x_freeze_on ?? null));
    await pause();
    const { rows } = await statusRows();
    check(`${L.MSG_MODEL}.x_status has «${L.FROZEN_STATUS.name}» (${L.FROZEN_STATUS.value})`, rows.some((r) => r.value === L.FROZEN_STATUS.value && r.name === L.FROZEN_STATUS.name), JSON.stringify(rows.map((r) => r.value)));
    check("no status of before § 67 is gone", ["sent", "delivered", "read", "failed", "received", "held", "expired", "skipped"].every((v) => rows.some((r) => r.value === v)));
    await pause();
    for (const [k, a] of Object.entries(L.ACTIONS)) {
      const row = await actionByName(a.name);
      check(`server action ${a.name} is Odoo code on ${a.model}, and calls no worker`, row?.state === "code" && row.model_name === a.model && row.code === a.code && !row.webhook_url && !/workers\.dev/.test(row.code), `${k}: ${JSON.stringify(row ?? null).slice(0, 200)}`);
      await pause(400);
    }
    const auto = await automationRow();
    const fOn = await fieldId(L.CONFIG_MODEL, "x_freeze_on");
    const stamp = await actionByName(L.ACTIONS.stamp.name);
    check(`automation «${L.AUTOMATION}» is on, on a write of the switch alone, and runs the stamp`, !!auto?.active && auto.trigger === "on_write" && auto.model_name === L.CONFIG_MODEL && auto.trigger_field_ids.length === 1 && auto.trigger_field_ids[0] === fOn && auto.action_server_ids.includes(stamp?.id), JSON.stringify(auto ?? null));
    await pause();
    const cfg = await activeConfig(FREEZE_READ);
    check("the active settings carry a reply", !!cfg && String(cfg.x_freeze_reply || "").trim().length > 10, JSON.stringify(cfg?.x_freeze_reply ?? null));
    // the day's field follows the switch as it is NOW (read, nothing written)
    const [day] = await call(L.DAY_MODEL, "search_read", { domain: [], fields: ["id", "x_freeze_on"], order: "x_date desc, id desc", limit: 1 });
    const today = riyadhDay();
    const effective = !!cfg?.x_freeze_on && (!cfg.x_freeze_until || cfg.x_freeze_until >= today);
    check(`a day's x_freeze_on (${day?.x_freeze_on}) is the switch of the settings (${effective})`, !!day && day.x_freeze_on === effective);
  } else {
    const ids = { on: (await actionByName(L.ACTIONS.on.name))?.id, off: (await actionByName(L.ACTIONS.off.name))?.id };
    for (const [name, v] of Object.entries(L.views(ids))) {
      const row = await viewByName(name);
      check(`view ${name} is on and carries its arch`, !!row?.active && row.arch_db === v.arch, row ? `active=${row.active}` : "not there");
      await pause(400);
    }
    // the screens still load whole (a broken inherited view fails the read)
    for (const [model, form] of [[L.DAY_MODEL, L.DAY_FORM], [L.CONFIG_MODEL, L.SETTINGS_FORM]]) {
      const base = await viewByName(form);
      const got = await call(model, "get_views", { views: [[base.id, "form"]] }).catch((e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
      const arch = got?.views?.form?.arch ?? "";
      check(`${form} loads with the freeze in it`, /x_freeze_on/.test(arch), got.error ?? `len=${arch.length}`);
      if (model === L.DAY_MODEL) check("«📊 اليوم» shows both buttons, each with its confirmation", arch.includes(`name="${ids.on}"`) && arch.includes(`name="${ids.off}"`) && (arch.match(/confirm=/g) ?? []).length >= 2);
      await pause();
    }
  }
  done();
}

// ---------------------------------------------------------------- apply / dry-run
log(APPLY ? `APPLY — ${ONLY}` : `dry-run — ${ONLY} (nothing is written; add --apply)`);
if (APPLY) save(); // the rollback file exists before the first write

if (ONLY === "schema") {
  // 1 + 2 — the fields
  await ensureFields(ctx, L.CONFIG_MODEL, await modelId(L.CONFIG_MODEL), L.CONFIG_FIELDS);
  await pause();
  await ensureFields(ctx, L.DAY_MODEL, await modelId(L.DAY_MODEL), L.DAY_FIELDS);
  await pause();
  // 3 — the status
  {
    const { f, rows } = await statusRows();
    const have = rows.find((r) => r.value === L.FROZEN_STATUS.value);
    if (have) log(`= ${L.MSG_MODEL}.x_status «${have.name}» #${have.id}`);
    else {
      log(`+ ${L.MSG_MODEL}.x_status «${L.FROZEN_STATUS.name}» (${L.FROZEN_STATUS.value})`);
      if (APPLY) {
        const [id] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: f, ...L.FROZEN_STATUS }] });
        rb.created.statusSelection = id; save();
        await call("ir.model.fields.selection", "write", { ids: [id], vals: { name: L.FROZEN_STATUS.name }, context: AR });
        log(`  → #${id}`);
      }
    }
  }
  await pause();
  // 4 — the actions and the automation
  const ids = {};
  for (const [k, a] of Object.entries(L.ACTIONS)) {
    const mid = await modelId(a.model);
    ids[k] = await ensureServerAction(ctx, k, a.name, { model_id: mid, state: "code", code: a.code });
    const row = ids[k] ? await actionByName(a.name) : null;
    if (row && row.code !== a.code) { log(`✎ server action ${a.name} #${row.id}: its code`); if (APPLY) await call("ir.actions.server", "write", { ids: [row.id], vals: { code: a.code } }); }
    await pause(500);
  }
  {
    const auto = await automationRow();
    const fOn = await fieldId(L.CONFIG_MODEL, "x_freeze_on");
    if (auto) {
      log(`= automation «${L.AUTOMATION}» #${auto.id}${auto.active ? "" : " (off)"}`);
      if (!auto.active) { log("✎ on again"); if (APPLY) await call("base.automation", "write", { ids: [auto.id], vals: { active: true } }); }
    } else {
      log(`+ automation «${L.AUTOMATION}» (${L.CONFIG_MODEL}, on_write: x_freeze_on) → ${L.ACTIONS.stamp.name}`);
      if (APPLY) {
        // the watched field is named outright: Odoo fills trigger_field_ids from a filter otherwise (§ 35)
        const [id] = await call("base.automation", "create", { vals_list: [{
          name: L.AUTOMATION, model_id: await modelId(L.CONFIG_MODEL), trigger: "on_write", active: true,
          trigger_field_ids: [[6, 0, [fOn]]], action_server_ids: [[6, 0, [ids.stamp]]],
        }] });
        rb.created.automation = id; save();
        log(`  → #${id}`);
      }
    }
  }
  await pause();
  // 5 — the default reply
  {
    const cfg = APPLY ? await activeConfig(["id", "x_freeze_reply"]) : await activeConfig();
    if (!cfg) log("✗ no active pricing settings today");
    else if (APPLY && String(cfg.x_freeze_reply || "").trim()) log(`= settings #${cfg.id}: a reply is there`);
    else {
      log(`✎ settings #${cfg.id}: the default reply «${L.DEFAULT_REPLY}»`);
      if (APPLY) await call(L.CONFIG_MODEL, "write", { ids: [cfg.id], vals: { x_freeze_reply: L.DEFAULT_REPLY } });
    }
  }
} else {
  const ids = { on: (await actionByName(L.ACTIONS.on.name))?.id, off: (await actionByName(L.ACTIONS.off.name))?.id };
  if (!ids.on || !ids.off) { log("✗ the two actions are not there — run --only=schema --apply first"); process.exit(1); }
  for (const [name, v] of Object.entries(L.views(ids))) {
    const base = await viewByName(v.inherit);
    if (!base) { log(`✗ the view ${v.inherit} is not there`); continue; }
    const have = await viewByName(name);
    if (have) {
      const same = have.arch_db === v.arch && have.active;
      log(`${same ? "=" : "✎"} view ${name} #${have.id}${same ? "" : ": its arch, on"}`);
      if (!same && APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { arch_db: v.arch, active: true } });
    } else {
      await ensureView(ctx, name, name, { model: v.model, type: undefined, inherit_id: base.id, mode: "extension", priority: v.priority, arch_db: v.arch, active: true });
    }
    await pause(600);
  }
}
log(APPLY ? "applied" : "dry-run: nothing written (add --apply)");
