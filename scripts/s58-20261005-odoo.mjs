// § 58 (2026-10-05) — the fields «📊 اليوم» gains, and the account of «من جيب براء»
// (scripts/lib/s58-odoo.mjs is the data):
//
//   1  x_pricing_config: x_daily_profit_target «هدف الربح اليومي (ريال)» (0 by default)
//   2  x_price_day_line: x_contribution «مساهمة الكرتون»
//   3  x_price_day: the day's plan, its actual, and the four HTML fields (the target and the three tabs)
//   4  journal BRA #21: its OUTBOUND payment method line posts to 201021 «Owner Current Account»
//
//   node scripts/s58-20261005-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s58-20261005-odoo.mjs --apply            the four steps (the rollback file first)
//   node scripts/s58-20261005-odoo.mjs --verify           read-only checks
//   node scripts/s58-20261005-odoo.mjs --rollback [--apply]          the BRA line back to no account. The fields stay (the worker writes them).
//   node scripts/s58-20261005-odoo.mjs --rollback --drop [--apply]   and delete the fields — by Baraa's decision only, AFTER the
//                                                         worker's code and the day's view (scripts/s58-20261005-day.mjs) are rolled back.
// Rollback file: scripts/artifacts/s58-20261005-odoo-rollback.json. The tenant is production. No
// WhatsApp send. No price, decision, order, invoice, payment or journal entry is written here: fields,
// and ONE account on one payment method line. 205001 and the payment PAY00005 are not touched.
// APPLY THIS BEFORE THE WORKER'S CODE IS DEPLOYED: the engine and the 21:30 summary write the fields.
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, log, modelId, rollbackFile } from "./lib/s40-kit.mjs";
import {
  CONFIG_FIELDS, CONFIG_MODEL, DAY_FIELDS, DAY_MODEL, HTML_FIELDS, LINE_FIELDS, LINE_MODEL, PLAN_BASIS_OPTIONS, POCKET_ACCOUNT_CODE,
  POCKET_JOURNAL_CODE, POCKET_JOURNAL_ID, POCKET_UNTOUCHED_CODE, PROFIT_TARGET_FIELD, SANITIZE_FLAGS,
} from "./lib/s58-odoo.mjs";

const RB = new URL("./artifacts/s58-20261005-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s58-20261005-odoo.mjs");
const { rb, save } = ctx;
rb.before.pocket ??= null;
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const m2oId = (v) => (Array.isArray(v) ? v[0] : 0);
const pocketLines = async () => call("account.payment.method.line", "search_read", {
  domain: [["journal_id", "=", POCKET_JOURNAL_ID], ["payment_type", "=", "outbound"]], fields: ["id", "name", "payment_type", "payment_account_id", "journal_id"],
});
const accountOf = async (code) => (await call("account.account", "search_read", { domain: [["code", "=", code]], fields: ["id", "code", "name", "account_type"], limit: 2 }));
const SETS = [[CONFIG_MODEL, CONFIG_FIELDS], [LINE_MODEL, LINE_FIELDS], [DAY_MODEL, DAY_FIELDS]];

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const was = rb.before.pocket;
  log(was ? `payment method line #${was.id} of ${POCKET_JOURNAL_CODE}: its account back to ${was.payment_account_id ? `#${was.payment_account_id}` : "none"}` : `the ${POCKET_JOURNAL_CODE} line: not changed by this script`);
  if (APPLY && was) await call("account.payment.method.line", "write", { ids: [was.id], vals: { payment_account_id: was.payment_account_id || false } });
  const fields = rb.created.fields ?? [];
  log(DROP ? `fields ${fields.join(", ") || "-"} (created): dropped` : `fields ${fields.join(", ") || "-"} (created): stay (the worker writes them; nothing is deleted)`);
  if (DROP) await dropCreated(rb, [["ir.model.fields", [...fields].reverse()]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  for (const [model, defs] of SETS) {
    const f = await call(model, "fields_get", { attributes: ["type", "string", "selection", ...SANITIZE_FLAGS] });
    check(`${model}: ${defs.map((d) => `${d.name} (${d.ttype})`).join(", ")}`, defs.every((d) => f[d.name]?.type === d.ttype && f[d.name].string === d.field_description), JSON.stringify(defs.filter((d) => f[d.name]?.type !== d.ttype || f[d.name]?.string !== d.field_description).map((d) => [d.name, f[d.name]])));
    if (model === DAY_MODEL) {
      check(`x_plan_basis: ${PLAN_BASIS_OPTIONS.map((o) => `${o[0]} «${o[1]}»`).join(" / ")}`, JSON.stringify(f.x_plan_basis?.selection) === JSON.stringify(PLAN_BASIS_OPTIONS), JSON.stringify(f.x_plan_basis?.selection));
      const rows = await call("ir.model.fields", "search_read", { domain: [["model", "=", DAY_MODEL], ["name", "in", HTML_FIELDS.map((d) => d.name)]], fields: ["name", ...SANITIZE_FLAGS] });
      check(`the four HTML fields keep Odoo's sanitizer as § 56's chart does (${SANITIZE_FLAGS.join(", ")})`, rows.length === HTML_FIELDS.length && rows.every((r) => SANITIZE_FLAGS.every((k) => r[k] === HTML_FIELDS[0][k])), JSON.stringify(rows));
      check("…beside the chart and the screen's numbers of § 56, which stay (x_chart_html, x_n_publish, x_avg_profit_show, x_op_cost, x_op_cartons)", ["x_chart_html", "x_n_publish", "x_avg_profit_show", "x_op_cost", "x_op_cartons"].every((k) => f[k]), "");
    }
    await pause();
  }
  const [config] = await call(CONFIG_MODEL, "search_read", { domain: [["x_is_active", "=", true]], fields: ["id", PROFIT_TARGET_FIELD], limit: 1 });
  check(`the active settings #${config?.id}: «هدف الربح اليومي» = 0 by default`, Number(config?.[PROFIT_TARGET_FIELD]) === 0, JSON.stringify(config));
  await pause();
  const lines = await pocketLines();
  const [want] = await accountOf(POCKET_ACCOUNT_CODE);
  check(`${POCKET_JOURNAL_CODE} #${POCKET_JOURNAL_ID} has ONE outbound payment method line, and it posts to ${POCKET_ACCOUNT_CODE} «${want?.name}» (#${want?.id}, ${want?.account_type})`, lines.length === 1 && !!want && m2oId(lines[0].payment_account_id) === want.id && want.account_type === "liability_current", JSON.stringify(lines));
  await pause();
  const [journal] = await call("account.journal", "read", { ids: [POCKET_JOURNAL_ID], fields: ["id", "code", "default_account_id"] });
  const [other] = await accountOf(POCKET_UNTOUCHED_CODE);
  check(`${POCKET_UNTOUCHED_CODE} is still the journal's default account, untouched`, journal?.code === POCKET_JOURNAL_CODE && m2oId(journal.default_account_id) === other?.id, JSON.stringify(journal));
  const old = await call("account.payment", "search_read", { domain: [["journal_id", "=", POCKET_JOURNAL_ID]], fields: ["id", "name", "amount", "state", "move_id"], limit: 20 });
  check(`the old payment on ${POCKET_JOURNAL_CODE} is as it was (${old.map((p) => `${p.name} ${p.amount} ${p.state}, ${p.move_id ? "an entry" : "no entry"}`).join("; ") || "none"})`, old.every((p) => p.name !== "PAY00005" || (!p.move_id && p.amount === 19444)), JSON.stringify(old));
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

for (const [k, [model, defs]] of SETS.entries()) {
  log(`— ${k + 1}: ${model}`);
  await ensureFields(ctx, model, await modelId(model), defs);
  await pause();
}

log(`— 4: ${POCKET_JOURNAL_CODE} #${POCKET_JOURNAL_ID}: the account of its outbound payment method line`);
const lines = await pocketLines();
const accounts = await accountOf(POCKET_ACCOUNT_CODE);
if (lines.length !== 1) throw new Error(`${POCKET_JOURNAL_CODE}: ${lines.length} outbound payment method lines (one expected) — stop`);
if (accounts.length !== 1 || accounts[0].account_type !== "liability_current") throw new Error(`account ${POCKET_ACCOUNT_CODE}: ${JSON.stringify(accounts)} (one current liability expected) — stop`);
const [line] = lines, [account] = accounts;
const cur = m2oId(line.payment_account_id);
if (cur === account.id) log(`= line #${line.id} «${line.name}» already posts to ${POCKET_ACCOUNT_CODE} #${account.id}`);
else if (cur && rb.before.pocket === null) throw new Error(`line #${line.id} already posts to another account (#${cur}) — stop: not this script's to change`);
else {
  log(`✎ line #${line.id} «${line.name}» (outbound, ${POCKET_JOURNAL_CODE}): payment_account_id ${cur ? `#${cur}` : "none"} → #${account.id} ${POCKET_ACCOUNT_CODE} «${account.name}»`);
  if (APPLY) {
    rb.before.pocket ??= { id: line.id, payment_account_id: cur || false }; save();
    await call("account.payment.method.line", "write", { ids: [line.id], vals: { payment_account_id: account.id } });
  }
}
save();
log(APPLY ? "done — verify: node scripts/s58-20261005-odoo.mjs --verify" : "dry-run: nothing written");
