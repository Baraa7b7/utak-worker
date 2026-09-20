// Rollback for the 2026-09-19 fruit prices batch.
//
// Reads scripts/artifacts/prices-20260919-rollback.json and undoes every
// change recorded in `after` using the values captured in `before`:
//   • Deletes the 7 x_daily_price rows just created.
//   • Deletes the packagings created for the 3 new templates + بطيخ كيلو
//     + أفوكادو كرتون (if this run created it).
//   • Restores x_approx_weight_kg on the two touched packagings
//     (33: 14 → 13, 37: 0 → 8).
//   • Deletes the 3 new templates.
//   • Restores names on templates 100 (رمان وسط → رمان) and 97 (موز أمريكي → موز).
//
// Usage:
//   node scripts/prices-20260919-rollback.mjs --dry-run   ← what will happen
//   node scripts/prices-20260919-rollback.mjs --apply     ← actually undo
//
// A run without a flag prints usage and exits with code 2.

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

const MODE = process.argv[2];
if (MODE !== "--dry-run" && MODE !== "--apply") {
  console.error("Usage: node scripts/prices-20260919-rollback.mjs [--dry-run|--apply]");
  process.exit(2);
}
const DRY = MODE === "--dry-run";

async function step(desc, run) {
  console.log(`[${DRY ? "DRY" : "APPLY"}] ${desc}`);
  if (!DRY) await run();
}

async function main() {
  const rollbackPath = new URL("./artifacts/prices-20260919-rollback.json", import.meta.url).pathname;
  const rb = JSON.parse(readFileSync(rollbackPath, "utf8"));
  console.log(`Rollback JSON: ${rollbackPath}`);
  console.log(`Applied at:    ${rb.before.generated_at}`);
  console.log(`Mode:          ${MODE}\n`);

  // 1) Delete daily prices
  const priceIds = rb.after.created_daily_prices.map((r) => r.id);
  await step(
    `unlink x_daily_price rows ${JSON.stringify(priceIds)} (${priceIds.length} rows: ${rb.after.created_daily_prices.map((r) => r.label).join(", ")})`,
    () => call("x_daily_price", "unlink", { ids: priceIds }),
  );

  // 2) Delete packagings created by this run
  const newPkgIds = rb.after.created_packagings.map((p) => p.id);
  await step(
    `unlink x_product_packaging rows ${JSON.stringify(newPkgIds)} (${newPkgIds.length} rows: ${rb.after.created_packagings.map((p) => `${p.id}=${p.x_name}(tmpl ${p.x_product_tmpl_id})`).join(", ")})`,
    () => call("x_product_packaging", "unlink", { ids: newPkgIds }),
  );

  // 3) Restore packaging weights
  for (const upd of rb.after.updated_packagings) {
    const oldVal = upd.old;
    await step(
      `restore x_product_packaging ${upd.id}.${upd.field}: ${upd.new} → ${oldVal}`,
      () => call("x_product_packaging", "write", { ids: [upd.id], vals: { [upd.field]: oldVal } }),
    );
  }

  // 4) Delete new templates
  const newTmplIds = rb.after.created_templates.map((t) => t.id);
  await step(
    `unlink product.template rows ${JSON.stringify(newTmplIds)} (${newTmplIds.length} rows: ${rb.after.created_templates.map((t) => `${t.id}=${t.name}`).join(", ")})`,
    () => call("product.template", "unlink", { ids: newTmplIds }),
  );

  // 5) Restore template names
  for (const r of rb.after.renamed_templates) {
    await step(
      `restore product.template ${r.id}.name: "${r.new_name}" → "${r.old_name}"`,
      () => call("product.template", "write", { ids: [r.id], vals: { name: r.old_name } }),
    );
  }

  console.log(`\n${DRY ? "Dry run complete. Nothing was changed." : "Rollback applied."}`);
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
