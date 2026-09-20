// Verify the two automation rules end-to-end without touching the real 47 rows.
//
// 1) Create a fresh test packaging row on one product (طماطم tmpl 71) —
//    with x_type='bag' and weight=10 — and confirm the auto-name rule set
//    x_name to "جرم · 10 كيلو".
// 2) Update its weight to 6 — confirm x_name updates to "جرم · 6 كيلو".
// 3) Toggle x_is_default=True on it — confirm the previously-default row
//    (#1 فلين — طماطم foam) is now False.
// 4) Restore #1 to x_is_default=True, delete the test row, and confirm the
//    total count is exactly 47 again.

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

const TMPL = 71; // طماطم — has #1 (فلين foam default) + #2 (جرم bag) already
const ORIGINAL_DEFAULT_ID = 1;

const assertEq = (label, got, want) => {
  const ok = String(got) === String(want);
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  if (!ok) process.exitCode = 1;
};

async function readRow(id) {
  const rows = await call("x_product_packaging", "read", {
    ids: [id],
    fields: ["id","x_name","x_type","x_approx_weight_kg","x_is_default","x_product_tmpl_id","x_sequence"],
  });
  return rows[0];
}

async function main() {
  console.log(`packaging rules verify — ${new Date().toISOString()}`);
  const startCount = await call("x_product_packaging", "search_count", { domain: [] });
  console.log(`starting count: ${startCount}`);

  console.log(`\n[1] create test row on tmpl ${TMPL} with x_type='bag' weight=10`);
  const createdIds = await call("x_product_packaging", "create", {
    vals_list: [{
      x_product_tmpl_id: TMPL,
      x_type: "bag",
      x_approx_weight_kg: 10,
      x_is_default: false,
      x_sequence: 999,
      x_name: "temp",
    }],
  });
  const testId = createdIds[0];
  console.log(`  created id=${testId}`);
  let r = await readRow(testId);
  assertEq("auto-name after create", r.x_name, "جرم · 10 كيلو");

  console.log(`\n[2] update weight to 6`);
  await call("x_product_packaging", "write", { ids: [testId], vals: { x_approx_weight_kg: 6 } });
  r = await readRow(testId);
  assertEq("auto-name after weight change", r.x_name, "جرم · 6 كيلو");

  console.log(`\n[3] toggle x_is_default=true → guard clears others`);
  const before1 = await readRow(ORIGINAL_DEFAULT_ID);
  console.log(`  #${ORIGINAL_DEFAULT_ID} default (before): ${before1.x_is_default}`);
  await call("x_product_packaging", "write", { ids: [testId], vals: { x_is_default: true } });
  const testDefault = await readRow(testId);
  const oldDefault = await readRow(ORIGINAL_DEFAULT_ID);
  assertEq(`test row now default`, testDefault.x_is_default, true);
  assertEq(`original default #${ORIGINAL_DEFAULT_ID} cleared`, oldDefault.x_is_default, false);
  // count of defaults on this tmpl must be exactly 1
  const dupes = await call("x_product_packaging", "search_count", {
    domain: [["x_product_tmpl_id", "=", TMPL], ["x_is_default", "=", true]],
  });
  assertEq("exactly 1 default on tmpl", dupes, 1);

  console.log(`\n[4] restore original default + delete test row`);
  await call("x_product_packaging", "write", { ids: [ORIGINAL_DEFAULT_ID], vals: { x_is_default: true } });
  const restored = await readRow(ORIGINAL_DEFAULT_ID);
  assertEq(`#${ORIGINAL_DEFAULT_ID} default restored`, restored.x_is_default, true);
  // Guard should have flipped the test row's default off.
  const testAfter = await readRow(testId);
  assertEq(`test row default cleared by guard`, testAfter.x_is_default, false);
  await call("x_product_packaging", "unlink", { ids: [testId] });
  const endCount = await call("x_product_packaging", "search_count", { domain: [] });
  assertEq("row count restored", endCount, startCount);
  const finalDefaults = await call("x_product_packaging", "search_count", {
    domain: [["x_product_tmpl_id", "=", TMPL], ["x_is_default", "=", true]],
  });
  assertEq("tmpl still has exactly 1 default", finalDefaults, 1);

  if (process.exitCode) {
    console.log("\nFAIL — at least one assertion failed.");
  } else {
    console.log("\nOK — all rule assertions passed.");
  }
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
