// الدفعة 3 (STATUS § 38، 2026-09-26) — x_utak_simulation on the order, the
// invoice and the payment.
//
// § 37 ج put the «محاكاة (تجربة)» flag (boolean, default false) on the five
// supplier-payment models only. The important gaps of batch 3 read orders,
// invoices and payments — «في الطريق» (م8) must send nothing for a simulation
// order, and the driver's follow-up (م12) and Baraa's daily summary (م17) must
// leave simulation records out of every count and total — so the same field
// goes on x_daily_order, x_invoice and x_payment, created the same way
// (ir.model.fields over JSON-2). Not x_is_simulation: that one is on every row
// the sim / pilot worker creates. No record is written: every existing row
// reads false.
//
//   node scripts/wa-b3-20260926-odoo.mjs            dry-run: what would be created
//   node scripts/wa-b3-20260926-odoo.mjs --apply    snapshot (rollback file) → create
//   node scripts/wa-b3-20260926-odoo.mjs --verify   read-only checks
//   node scripts/wa-b3-20260926-odoo.mjs --fixture  read-only: fields_get → tests/fixtures-odoo-fields-20260926-b3.json
//   node scripts/wa-b3-20260926-odoo.mjs --rollback [--apply]   removes ONLY the fields this script created
//                                                               (not run without Baraa's decision)
//
// Rollback file: scripts/artifacts/wa-b3-20260926-odoo-rollback.json. Tenant shared with prod: prod's code
// (5c138821) never reads the field. No WhatsApp, no deletion of any record, no account.move / account.payment.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.startsWith("https://utakfresh.odoo.com/")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const FIXTURE = process.argv.includes("--fixture");
const ROLLBACK = process.argv.includes("--rollback");
const RB = new URL("./artifacts/wa-b3-20260926-odoo-rollback.json", import.meta.url);
const SIM_FIELD = "x_utak_simulation";
const MODELS = ["x_daily_order", "x_invoice", "x_payment"];
const FIELD = {
  name: SIM_FIELD, ttype: "boolean", field_description: "محاكاة (تجربة)",
  help: "سجل تجربة (STATUS § 38، الدفعة 3): لا يدخل في متابعة السائق ولا ملخص اليوم ولا أي عدّ أو مجموع، ولا تُرسل عنه «في الطريق». لا يُحذف.",
};
// the fixture of the strict schema gate (tests/wa-important-b3.test.mts)
const FIXTURE_MODELS = [
  "x_daily_order", "x_daily_order_line", "x_delivery_route", "x_delivery_stop", "x_invoice", "x_payment",
  "x_team_attendance", "x_wa_message", "x_whatsapp_template", "x_price_day", "x_price_day_line", "x_daily_price",
];
const log = (...a) => console.log(...a);

const fieldRow = async (model) => (await call("ir.model.fields", "search_read", {
  domain: [["model", "=", model], ["name", "=", SIM_FIELD]], fields: ["id", "ttype", "field_description", "store"], limit: 1,
}))[0] ?? null;
const counts = async () => {
  const out = {};
  for (const m of [...MODELS, "account.move", "account.payment"]) out[m] = await call(m, "search_count", { domain: [] });
  return out;
};

if (FIXTURE) {
  const out = { _source: `fields_get on utakfresh.odoo.com, ${new Date().toISOString().slice(0, 10)} (read-only), after scripts/wa-b3-20260926-odoo.mjs --apply. Every field of each model.`, _selections: {} };
  for (const m of FIXTURE_MODELS) {
    const f = await call(m, "fields_get", { attributes: ["type", "selection"] });
    out[m] = Object.keys(f).sort();
    for (const k of out[m]) if (f[k].type === "selection" && Array.isArray(f[k].selection)) out._selections[`${m}.${k}`] = f[k].selection.map((s) => s[0]);
  }
  writeFileSync(new URL("../tests/fixtures-odoo-fields-20260926-b3.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
  log(FIXTURE_MODELS.map((m) => `${m}: ${out[m].length}${out[m].includes(SIM_FIELD) ? " (sim)" : ""}`).join(", "));
  process.exit(0);
}

if (VERIFY) {
  const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : null;
  let ok = 0, bad = 0;
  const check = (name, cond, detail = "") => { if (cond) { ok++; log(`  ✓ ${name}`); } else { bad++; log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
  for (const m of MODELS) {
    const f = await fieldRow(m);
    check(`${m}.${SIM_FIELD} exists, boolean, stored`, f && f.ttype === "boolean" && f.store !== false, JSON.stringify(f));
    const got = (await call(m, "fields_get", { attributes: ["type"] }))[SIM_FIELD];
    check(`${m}: fields_get sees it`, got?.type === "boolean");
    const marked = await call(m, "search_count", { domain: [[SIM_FIELD, "=", true]] });
    check(`${m}: no record marked (all false)`, marked === 0, String(marked));
  }
  const now = await counts();
  if (rb?.countsBefore) {
    for (const [m, n] of Object.entries(rb.countsBefore)) check(`${m}: count unchanged (${n})`, now[m] === n, `now ${now[m]}`);
  } else {
    check("rollback file with the counts before", false, "no snapshot");
  }
  log(`\nverify ${ok}/${ok + bad}`);
  process.exit(bad ? 1 : 0);
}

if (ROLLBACK) {
  if (!existsSync(RB)) throw new Error("no rollback file — nothing this script created");
  const rb = JSON.parse(readFileSync(RB, "utf8"));
  const ids = Object.values(rb.created ?? {}).filter((x) => typeof x === "number");
  log(`${APPLY ? "removing" : "would remove"} ir.model.fields ${ids.join(", ") || "(none)"} (${Object.keys(rb.created ?? {}).join(", ")})`);
  if (APPLY && ids.length) {
    await call("ir.model.fields", "unlink", { ids });
    rb.rolledBackAt = new Date().toISOString();
    writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
    log("done");
  }
  process.exit(0);
}

// dry-run / apply
const rb = existsSync(RB) ? JSON.parse(readFileSync(RB, "utf8")) : { script: "scripts/wa-b3-20260926-odoo.mjs", createdAt: new Date().toISOString(), created: {} };
if (APPLY && !rb.countsBefore) {
  rb.countsBefore = await counts();
  rb.fieldsBefore = Object.fromEntries(await Promise.all(MODELS.map(async (m) => [m, await fieldRow(m)])));
  writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
  log(`snapshot → ${RB.pathname.split("/").slice(-3).join("/")} ${JSON.stringify(rb.countsBefore)}`);
}
for (const m of MODELS) {
  const have = await fieldRow(m);
  if (have) { log(`= ${m}.${SIM_FIELD} #${have.id} (${have.ttype}) — already there`); continue; }
  log(`+ ${m}.${SIM_FIELD} (boolean «${FIELD.field_description}», default false)`);
  if (!APPLY) continue;
  const [mid] = await call("ir.model", "search", { domain: [["model", "=", m]], limit: 1 });
  if (!mid) throw new Error(`no ir.model ${m} — stop`);
  const [id] = await call("ir.model.fields", "create", { vals_list: [{ model_id: mid, ...FIELD }] });
  rb.created[m] = id;
  writeFileSync(RB, JSON.stringify(rb, null, 2) + "\n");
  log(`  created #${id}`);
}
if (!APPLY) log("\n(dry-run — add --apply)");
