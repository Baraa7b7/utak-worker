// The single send gateway (STATUS § 33) — three new values on
// x_wa_message.x_status, 2026-09-25.
//
//   held    «محفوظة (بانتظار نافذة 24 ساعة)» — the gateway holds the message
//           for the number; it goes at the number's next inbound.
//   expired «انتهت صلاحيتها (لم تُرسل)»      — held past its purpose's expiry;
//           dropped, never sent.
//   skipped «لم تُرسل (البوابة)»             — nothing could go (no usable
//           template and no session option), or Meta refused the purpose for
//           this number within 24h.
//
// «queued» cannot be reused: automation 7 (wa_message.on_queued) sends every
// row that turns «queued» (the Odoo manual-send route). The script checks that
// no automation on x_wa_message filters on the new values.
//
// Nothing else is written, nothing is deleted.
//
//   node scripts/gw-20260925-odoo-status.mjs                 # dry run (default)
//   node scripts/gw-20260925-odoo-status.mjs --apply
//   node scripts/gw-20260925-odoo-status.mjs --verify        # read-only checks
//   node scripts/gw-20260925-odoo-status.mjs --rollback [--apply]
//
// Rollback: scripts/artifacts/gw-20260925-odoo-status-rollback.json, written
// before the first write; each created id is appended as soon as it exists.
// The rollback removes the three values only if no x_wa_message row carries
// one of them (it reports the rows and stops otherwise).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { call } from "./lib/odoo-cli.mjs";

globalThis.fetch = ((real) => (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: no WhatsApp from this script");
  if (!url.includes("odoo.com")) throw new Error(`BLOCKED: ${url.slice(0, 60)}`);
  return real(input, init);
})(globalThis.fetch);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const VERIFY = args.includes("--verify");
const RB = new URL("./artifacts/gw-20260925-odoo-status-rollback.json", import.meta.url).pathname;

const MODEL = "x_wa_message";
const FIELD = "x_status";
export const NEW_VALUES = [
  { value: "held", name: "محفوظة (بانتظار نافذة 24 ساعة)" },
  { value: "expired", name: "انتهت صلاحيتها (لم تُرسل)" },
  { value: "skipped", name: "لم تُرسل (البوابة)" },
];

async function readState() {
  const fields = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", MODEL], ["name", "=", FIELD]],
    fields: ["id", "name", "ttype", "state", "field_description"],
    limit: 2,
  });
  if (fields.length !== 1) throw new Error(`expected one ${MODEL}.${FIELD}, found ${fields.length}`);
  const field = fields[0];
  if (field.ttype !== "selection") throw new Error(`${MODEL}.${FIELD} is ${field.ttype}, not selection`);
  const sel = await call("ir.model.fields.selection", "search_read", {
    domain: [["field_id", "=", field.id]],
    fields: ["id", "value", "name", "sequence"],
    order: "sequence asc, id asc",
    limit: 100,
  });
  const fg = await call(MODEL, "fields_get", { allfields: [FIELD], attributes: ["type", "selection"] });
  const autos = await call("base.automation", "search_read", {
    domain: [["model_name", "=", MODEL]],
    fields: ["id", "name", "active", "trigger", "filter_domain", "filter_pre_domain"],
    context: { active_test: false },
    limit: 50,
  });
  return { field, sel, fg: fg[FIELD], autos };
}

function plan(state) {
  const have = new Set(state.sel.map((s) => s.value));
  const maxSeq = Math.max(0, ...state.sel.map((s) => s.sequence ?? 0));
  return NEW_VALUES.filter((v) => !have.has(v.value)).map((v, i) => ({ ...v, sequence: maxSeq + 1 + i }));
}

function automationTouches(autos) {
  // Any automation whose filter names one of the new values would fire on them.
  return autos.filter((a) => NEW_VALUES.some((v) => `${a.filter_domain}${a.filter_pre_domain}`.includes(`"${v.value}"`) || `${a.filter_domain}${a.filter_pre_domain}`.includes(`'${v.value}'`)));
}

async function verify() {
  const state = await readState();
  const checks = [];
  const ok = (label, cond, detail = "") => checks.push({ label, ok: !!cond, detail });
  const values = state.fg.selection.map(([v]) => v);
  for (const v of NEW_VALUES) {
    const row = state.sel.find((s) => s.value === v.value);
    ok(`${v.value}: in fields_get`, values.includes(v.value));
    ok(`${v.value}: label «${v.name}»`, row?.name === v.name, row?.name ?? "missing");
  }
  for (const old of ["draft", "queued", "sending", "sent", "delivered", "read", "failed", "received", "dry_ok"]) {
    ok(`${old}: unchanged`, values.includes(old));
  }
  ok("no automation on x_wa_message filters on a new value", automationTouches(state.autos).length === 0,
    automationTouches(state.autos).map((a) => a.id).join(","));
  const seven = state.autos.find((a) => a.id === 7);
  ok("automation 7 still fires on «queued» only", seven && JSON.stringify(seven.filter_domain).includes("queued"), JSON.stringify(seven?.filter_domain));
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.label}${c.detail && !c.ok ? ` (${c.detail})` : ""}`);
  const bad = checks.filter((c) => !c.ok).length;
  console.log(`verify: ${checks.length - bad}/${checks.length}`);
  return bad === 0;
}

async function main() {
  if (VERIFY) {
    process.exit((await verify()) ? 0 : 1);
  }

  if (ROLLBACK) {
    if (!existsSync(RB)) throw new Error(`no rollback file at ${RB}`);
    const rb = JSON.parse(readFileSync(RB, "utf8"));
    const ids = (rb.created ?? []).map((c) => c.id);
    console.log(`rollback: selection values ${JSON.stringify(rb.created ?? [])}`);
    const used = await call(MODEL, "search_read", {
      domain: [[FIELD, "in", (rb.created ?? []).map((c) => c.value)]],
      fields: ["id", FIELD],
      limit: 50,
    });
    if (used.length) {
      console.log(`  ✗ ${used.length} x_wa_message row(s) carry a new value (${used.map((u) => `#${u.id}=${u[FIELD]}`).join(", ")}) — roll the code back first and settle them; nothing removed`);
      process.exit(1);
    }
    if (!APPLY) {
      console.log(`  dry run: would unlink ir.model.fields.selection ${ids.join(", ") || "(none)"}`);
      return;
    }
    if (ids.length) await call("ir.model.fields.selection", "unlink", { ids });
    console.log(`  ✓ removed ${ids.length}`);
    return;
  }

  const state = await readState();
  console.log(`${MODEL}.${FIELD} (#${state.field.id}, ${state.field.state}): ${state.sel.map((s) => `${s.value}«${s.name}»`).join(" · ")}`);
  const touching = automationTouches(state.autos);
  console.log(`automations on ${MODEL}: ${state.autos.map((a) => `#${a.id} ${a.name} ${JSON.stringify(a.filter_domain)}`).join(" | ")}`);
  if (touching.length) throw new Error(`automation(s) ${touching.map((a) => a.id).join(",")} filter on a new value — stop`);
  const todo = plan(state);
  if (todo.length === 0) {
    console.log("nothing to add — all three values exist");
    return;
  }
  console.log(`plan: add ${todo.map((t) => `${t.value}«${t.name}» seq ${t.sequence}`).join(" · ")}`);
  if (!APPLY) {
    console.log("dry run — nothing written (use --apply)");
    return;
  }
  const rb = {
    at: new Date().toISOString(),
    field: state.field,
    before: state.sel,
    automations: state.autos,
    created: [],
  };
  writeFileSync(RB, JSON.stringify(rb, null, 2));
  console.log(`rollback snapshot → ${RB}`);
  for (const t of todo) {
    const [id] = await call("ir.model.fields.selection", "create", {
      vals_list: [{ field_id: state.field.id, value: t.value, name: t.name, sequence: t.sequence }],
    }, { probe: [["field_id", "=", state.field.id], ["value", "=", t.value]] });
    rb.created.push({ id, value: t.value });
    writeFileSync(RB, JSON.stringify(rb, null, 2));
    console.log(`  + ${t.value} → ir.model.fields.selection #${id}`);
  }
  console.log("applied");
  await verify();
}

await main();
