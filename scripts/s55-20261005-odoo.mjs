// § 55 ب (2026-10-05) — what the delivery and collection form needs in Odoo (scripts/lib/s55-odoo.mjs is
// the data):
//
//   1   x_daily_order_line: x_ordered_qty «الكمية المطلوبة», x_return_qty «المرتجع / غير المسلَّم»,
//       x_return_reason «سبب المرتجع» (تالف / ناقص / رفضه العميل). The worker writes them on a line that
//       was not delivered in full (src/delivery-form.ts); nothing reads them back.
//   2   the order's form (x_daily_order.form): the three as optional columns of the lines' list, after
//       «الكمية» — an extension view, as § 49's own (x_daily_order.form.utak_s49). ONLY when the form lists
//       its lines inline with an x_quantity column (read from the tenant at run time); otherwise the views
//       are left alone and the script says so.
//
//   node scripts/s55-20261005-odoo.mjs              dry-run: the plan, nothing written
//   node scripts/s55-20261005-odoo.mjs --apply      rollback file first, then write (idempotent)
//   node scripts/s55-20261005-odoo.mjs --verify     read-only checks
//   node scripts/s55-20261005-odoo.mjs --rollback [--apply]          the extension view off (active = false). Nothing
//                                                    is deleted: the three fields stay (the worker of § 55
//                                                    writes them — roll its code back first).
//   node scripts/s55-20261005-odoo.mjs --rollback --drop [--apply]   and delete the view and the fields — by Baraa's
//                                                    decision only, after the worker's code is rolled back.
// Rollback file: scripts/artifacts/s55-20261005-odoo-rollback.json. The tenant is production. No
// WhatsApp send. No order, line, invoice or payment is written here: fields and one view only.
// APPLY THIS BEFORE THE WORKER'S CODE IS DEPLOYED: the form's «إرسال» writes the three fields.
import { APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureFields, ensureView, log, modelId, one, rollbackFile } from "./lib/s40-kit.mjs";
import {
  LINE_FIELDS, LINE_MODEL, ORDER_FORM_VIEW, ORDER_LINES_VIEW, ORDER_MODEL, ORDERED_FIELD, RETURN_QTY_FIELD, RETURN_REASON_FIELD, RETURN_REASON_OPTIONS,
  linesColumnsIn, linesListTag, orderLinesArch,
} from "./lib/s55-odoo.mjs";

const RB = new URL("./artifacts/s55-20261005-odoo-rollback.json", import.meta.url);
const ALL = { active_test: false };
const ctx = rollbackFile(RB, "scripts/s55-20261005-odoo.mjs");
const { rb, save } = ctx;
const pause = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "active", "inherit_id"], context: ALL }))[0];
const fieldId = async (model, name) => one("ir.model.fields", [["model", "=", model], ["name", "=", name]]);
/** The order's form as Odoo renders it (the parent and its extensions combined). */
const renderedForm = async (viewId) => String((await call(ORDER_MODEL, "get_views", { views: [[viewId, "form"]] }))?.views?.form?.arch ?? "");

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const c = rb.created;
  const view = c.views?.orderLines;
  log(view ? `view #${view} ${ORDER_LINES_VIEW} (created): ${DROP ? "dropped" : "active = false"}` : `no view was created by this script`);
  log(DROP ? `fields ${(c.fields ?? []).join(", ") || "-"} (created): dropped` : `fields ${(c.fields ?? []).join(", ") || "-"} (created): stay (nothing is deleted)`);
  if (APPLY && view && !DROP) await call("ir.ui.view", "write", { ids: [view], vals: { active: false } });
  if (DROP) await dropCreated(rb, [["ir.ui.view", [view]], ["ir.model.fields", [...(c.fields ?? [])].reverse()]]);
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const lf = await call(LINE_MODEL, "fields_get", { attributes: ["type", "string", "selection"] });
  for (const d of LINE_FIELDS) {
    const f = lf[d.name];
    check(`${LINE_MODEL}.${d.name} ${d.ttype} «${d.field_description}»`, f?.type === d.ttype && f.string === d.field_description, JSON.stringify(f));
  }
  check(`${RETURN_REASON_FIELD}: ${RETURN_REASON_OPTIONS.map((o) => `${o[0]} «${o[1]}»`).join(" / ")}`, JSON.stringify(lf[RETURN_REASON_FIELD]?.selection) === JSON.stringify(RETURN_REASON_OPTIONS), JSON.stringify(lf[RETURN_REASON_FIELD]?.selection));
  check(`the line still has what the worker reads and writes beside them (x_quantity, x_status with «unavailable»)`, lf.x_quantity?.type === "float" && (lf.x_status?.selection ?? []).some((s) => s[0] === "unavailable"), JSON.stringify(lf.x_status?.selection));
  const of = await call(ORDER_MODEL, "fields_get", { attributes: ["type", "string"] });
  check(`${ORDER_MODEL}.x_delivery_notes exists (the form's note)`, ["text", "char", "html"].includes(of.x_delivery_notes?.type), JSON.stringify(of.x_delivery_notes));
  await pause();
  const parent = await viewOf(ORDER_FORM_VIEW);
  const ext = await viewOf(ORDER_LINES_VIEW);
  const arch = parent ? await renderedForm(parent.id) : "";
  if (ext?.active) check(`the order's form #${parent?.id} renders, with the three columns after «الكمية» (view #${ext.id})`, linesColumnsIn(arch), arch.slice(0, 300));
  else {
    check(`the order's form #${parent?.id} renders`, arch.includes("<form"), arch.slice(0, 200));
    log(`  · no extension view ${ORDER_LINES_VIEW}: the lines' columns were left alone (${linesListTag(arch) ? "the form lists its lines inline — run --apply" : "the form does not list its lines inline with «الكمية»"})`);
  }
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? "APPLY" : "dry-run (nothing is written; add --apply)");
save(); // the rollback file before the first write

log(`— 1: the three fields on ${LINE_MODEL}`);
await ensureFields(ctx, LINE_MODEL, await modelId(LINE_MODEL), LINE_FIELDS);
await pause();

log(`— 2: the lines' columns on the order's form`);
const parent = await viewOf(ORDER_FORM_VIEW);
if (!parent) log(`· view ${ORDER_FORM_VIEW} not found: the views are left alone`);
else {
  const have = await viewOf(ORDER_LINES_VIEW);
  const arch = await renderedForm(parent.id);
  const tag = linesListTag(arch);
  if (have?.active) log(`= view ${ORDER_LINES_VIEW} #${have.id}`);
  else if (have) {
    // switched off by an earlier --rollback: on again
    log(`✎ view ${ORDER_LINES_VIEW} #${have.id}: active false → true`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { active: true } });
  } else if (!tag) log(`· the order's form #${parent.id} does not list its lines inline with «الكمية» (x_line_ids → list → x_quantity): the views are left alone, and the three fields are shown nowhere until a view names them.`);
  else {
    const fieldsReady = (await fieldId(LINE_MODEL, ORDERED_FIELD)) && (await fieldId(LINE_MODEL, RETURN_QTY_FIELD)) && (await fieldId(LINE_MODEL, RETURN_REASON_FIELD));
    log(`  the form #${parent.id} lists its lines in an inline <${tag}> with «الكمية»: the three columns go after it`);
    for (const l of orderLinesArch(tag).split("\n")) log(`    ${l}`);
    if (!fieldsReady) log(`+ view ${ORDER_LINES_VIEW}${APPLY ? " — the fields are not there yet: stop" : " (dry-run: the fields do not exist yet; written with --apply)"}`);
    if (!fieldsReady && APPLY) throw new Error("the three fields do not exist — stop");
    if (fieldsReady) await ensureView(ctx, "orderLines", ORDER_LINES_VIEW, { model: ORDER_MODEL, type: "form", inherit_id: parent.id, mode: "extension", priority: 99, arch_base: orderLinesArch(tag) });
  }
}
save();
log(APPLY ? "done — verify: node scripts/s55-20261005-odoo.mjs --verify" : "dry-run: nothing written");
