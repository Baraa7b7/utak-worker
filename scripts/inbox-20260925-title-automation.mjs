// Partner renamed in Odoo → its WhatsApp inbox channel title follows (2026-09-25).
//
// Creates one ir.actions.server (webhook) and one base.automation on res.partner:
// on a write of name / x_whatsapp_number / phone, for a partner that has an
// inbox channel (x_wa_channel_id set), Odoo posts {_id, _model} to the sim
// worker's /odoo/hook/wa-inbox-partner, and the worker rebuilds the titles
// with syncInboxChannelTitles — the one place these channels are named, so
// there is no second copy of the title rule in Odoo.
//
// The token is reused from the existing server action «wa_inbox.reply_webhook»
// (never printed). Idempotent by name. Rollback archives the automation
// (active=false); nothing is deleted.
//
//   node scripts/inbox-20260925-title-automation.mjs [--dry-run]
//   node scripts/inbox-20260925-title-automation.mjs --verify     live check on test partner 10 (renamed, then restored)
//   node scripts/inbox-20260925-title-automation.mjs --rollback
//
// Rollback: scripts/artifacts/inbox-20260925-title-automation-rollback.json

import { call } from "./lib/odoo-cli.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp from the title automation script");
  return realFetch(input, init);
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const RB_PATH = new URL("./artifacts/inbox-20260925-title-automation-rollback.json", import.meta.url).pathname;
const readRb = () => (existsSync(RB_PATH) ? JSON.parse(readFileSync(RB_PATH, "utf8")) : { created: {}, verify: null });
const saveRb = (rb) => { if (!DRY) writeFileSync(RB_PATH, JSON.stringify(rb, null, 2) + "\n"); };
const SA_NAME = "wa_inbox.partner_title_webhook";
const BA_NAME = "wa_inbox.partner_title";
const TEST_PARTNER = 10;   // «محمد المحصّل - اختبار», archived, fake number +966500000002, channel 25
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apply() {
  const rb = readRb();
  const [src] = await call("ir.actions.server", "search_read", { domain: [["name", "=", "wa_inbox.reply_webhook"]], fields: ["webhook_url"], limit: 1 });
  const m = /^(https?:\/\/[^/]+)\/.*[?&]token=([^&]+)/.exec(String(src?.webhook_url ?? ""));
  if (!m) throw new Error("could not read origin/token from wa_inbox.reply_webhook");
  const url = `${m[1]}/odoo/hook/wa-inbox-partner?token=${m[2]}`;
  log(`webhook target: ${m[1]}/odoo/hook/wa-inbox-partner`);

  const [model] = await call("ir.model", "search_read", { domain: [["model", "=", "res.partner"]], fields: ["id"], limit: 1 });
  const fields = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "res.partner"], ["name", "in", ["name", "x_whatsapp_number", "phone"]]], fields: ["id", "name"],
  });
  if (fields.length !== 3) throw new Error(`trigger fields: expected 3, got ${JSON.stringify(fields)}`);

  let [sa] = await call("ir.actions.server", "search_read", { domain: [["name", "=", SA_NAME]], fields: ["id"], limit: 1 });
  if (sa) log(`server action exists (${sa.id})`);
  else if (DRY) log("would create server action");
  else {
    const [id] = await call("ir.actions.server", "create", { vals_list: [{ name: SA_NAME, model_id: model.id, state: "webhook", webhook_url: url }] });
    sa = { id };
    (rb.created.server_actions ??= []).push(id);
    saveRb(rb);
    log(`server action created ${id}`);
  }

  let [ba] = await call("base.automation", "search_read", { domain: [["name", "=", BA_NAME]], fields: ["id", "active"], context: { active_test: false }, limit: 1 });
  const vals = {
    name: BA_NAME,
    model_id: model.id,
    trigger: "on_write",
    trigger_field_ids: [[6, 0, fields.map((f) => f.id)]],
    filter_domain: "[('x_wa_channel_id', '!=', False)]",
    active: true,
  };
  if (ba) {
    log(`automation exists (${ba.id}, active=${ba.active})${DRY ? "" : " — updating"}`);
    if (!DRY) await call("base.automation", "write", { ids: [ba.id], vals: { ...vals, action_server_ids: [[6, 0, [sa.id]]] } });
  } else if (DRY) log("would create automation on res.partner (on_write: name, x_whatsapp_number, phone)");
  else {
    const [id] = await call("base.automation", "create", { vals_list: [{ ...vals, action_server_ids: [[6, 0, [sa.id]]] }] });
    ba = { id };
    (rb.created.automations ??= []).push(id);
    saveRb(rb);
    log(`automation created ${id}`);
  }
  if (DRY) { log("dry-run: nothing written"); return; }
  const [back] = await call("base.automation", "read", { ids: [ba.id], fields: ["active", "trigger", "filter_domain", "trigger_field_ids", "action_server_ids"] });
  log("read back:", JSON.stringify(back));
}

/** Rename test partner 10, watch channel 25 follow, restore the name, watch it follow back. */
async function verify() {
  const rb = readRb();
  const [p] = await call("res.partner", "read", { ids: [TEST_PARTNER], fields: ["name", "x_wa_channel_id", "active"], context: { active_test: false } });
  if (!p?.x_wa_channel_id) throw new Error(`partner ${TEST_PARTNER} has no inbox channel`);
  const chId = p.x_wa_channel_id[0];
  const title = async () => (await call("discuss.channel", "read", { ids: [chId], fields: ["name"] }))[0].name;
  const waitFor = async (pred) => { for (let i = 0; i < 20; i++) { const t = await title(); if (pred(t)) return t; await sleep(1500); } return title(); };
  const original = p.name;
  const probe = `${original} (تحقق 09-25)`;
  rb.verify = { partner: TEST_PARTNER, originalName: original, channel: chId, titleBefore: await title(), at: new Date().toISOString() };
  saveRb(rb); // the original name is on disk before the rename
  await call("res.partner", "write", { ids: [TEST_PARTNER], vals: { name: probe } });
  const renamed = await waitFor((t) => t.includes("(تحقق 09-25)"));
  await call("res.partner", "write", { ids: [TEST_PARTNER], vals: { name: original } });
  const restored = await waitFor((t) => !t.includes("(تحقق 09-25)"));
  const [pAfter] = await call("res.partner", "read", { ids: [TEST_PARTNER], fields: ["name"], context: { active_test: false } });
  const out = { ...rb.verify, titleAfterRename: renamed, titleAfterRestore: restored, nameRestored: pAfter.name === original,
    followed: renamed.includes("(تحقق 09-25)"), followedBack: restored === rb.verify.titleBefore };
  rb.verify = out;
  saveRb(rb);
  log(JSON.stringify(out, null, 2));
  if (!out.followed || !out.followedBack || !out.nameRestored) process.exit(1);
}

async function rollback() {
  const rb = readRb();
  for (const id of rb.created.automations ?? []) {
    log(`base.automation ${id}: active ← false`);
    await call("base.automation", "write", { ids: [id], vals: { active: false } });
  }
  if (rb.verify?.originalName) {
    await call("res.partner", "write", { ids: [rb.verify.partner], vals: { name: rb.verify.originalName } });
    log(`partner ${rb.verify.partner}: name ← «${rb.verify.originalName}»`);
  }
  log("rollback done (nothing deleted)");
}

await (args.includes("--rollback") ? rollback() : args.includes("--verify") ? verify() : apply());
