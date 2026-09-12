// Black-box isolation test for src/odoo.ts::call().
//
// Proves that x_is_simulation is stamped IF AND ONLY IF the calling
// environment is sim (SIMULATION_MODE === "true"), and that no other
// combination — production, pilot, or write ops in any mode — mutates
// the outgoing body.
//
// Runs directly under Node 25's --experimental-strip-types. No test
// framework; failures throw and the process exits non-zero. Every
// assertion prints ✓ / ✗ so the transcript speaks for itself.
//
//   node --experimental-strip-types tests/sim-isolation.test.mts

import { call } from "../src/odoo.ts";
import { SIM_MARKED_MODELS } from "../src/config.ts";

// ---------- fetch mock ----------
interface CapturedRequest {
  url: string;
  method: string;
  body: any;
}
let captured: CapturedRequest[] = [];

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const bodyText = init?.body ?? "";
  let body: any = null;
  try {
    body = typeof bodyText === "string" ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }
  captured.push({ url, method: init?.method ?? "GET", body });
  // Odoo JSON-2 returns whatever the method returns.
  //  create → [id1, id2, ...]
  //  write  → true
  const isCreate = url.endsWith("/create");
  return new Response(JSON.stringify(isCreate ? [1] : true), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof globalThis.fetch;

// ---------- minimal Env fixture ----------
function makeEnv(overrides: Record<string, string | undefined>): any {
  return {
    ODOO_URL: "https://utakfresh.odoo.com",
    ODOO_DB: "utakfresh",
    ODOO_LOGIN: "admin@utakfresh.com",
    ODOO_API_KEY: "TEST_KEY",
    ...overrides,
  };
}

// ---------- assertion helper ----------
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    console.log(`  ✗ ${label}${detail ? "  (" + detail + ")" : ""}`);
  }
}

function bodyHasFlag(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (Array.isArray(body.vals_list)) {
    return body.vals_list.some(
      (v: any) => v && typeof v === "object" && "x_is_simulation" in v,
    );
  }
  if (body.values && typeof body.values === "object") {
    return "x_is_simulation" in body.values;
  }
  return false;
}

// ---------- scenarios ----------
type Scenario = {
  name: string;
  env: any;
  expectFlagOnCreate: boolean; // in a SIM_MARKED_MODELS model
  expectFlagOnWrite: boolean;  // ANY model — writes never inject
};

const scenarios: Scenario[] = [
  {
    name: "prod (neither flag set) — must NEVER stamp",
    env: makeEnv({}),
    expectFlagOnCreate: false,
    expectFlagOnWrite: false,
  },
  {
    name: "prod (both flags explicitly 'false')",
    env: makeEnv({ SIMULATION_MODE: "false", PILOT_MODE: "false" }),
    expectFlagOnCreate: false,
    expectFlagOnWrite: false,
  },
  {
    name: "sim only — stamp on create",
    env: makeEnv({ SIMULATION_MODE: "true" }),
    expectFlagOnCreate: true,
    expectFlagOnWrite: false,
  },
  {
    name: "pilot only — stamp on create (real send happens in fetchMeta)",
    env: makeEnv({ PILOT_MODE: "true", SIM_ALLOWLIST: "+96650" }),
    expectFlagOnCreate: true,
    expectFlagOnWrite: false,
  },
  {
    name: "both flags true (misconfig) — fail-closed to stamping",
    env: makeEnv({ SIMULATION_MODE: "true", PILOT_MODE: "true", SIM_ALLOWLIST: "+96650" }),
    expectFlagOnCreate: true,
    expectFlagOnWrite: false,
  },
  {
    name: "SIMULATION_MODE truthy-but-not-'true' ('1') — strict === guards typos",
    env: makeEnv({ SIMULATION_MODE: "1" }),
    expectFlagOnCreate: false,
    expectFlagOnWrite: false,
  },
  {
    name: "PILOT_MODE uppercase 'TRUE' — strict === guards typos",
    env: makeEnv({ PILOT_MODE: "TRUE" }),
    expectFlagOnCreate: false,
    expectFlagOnWrite: false,
  },
];

const models = Array.from(SIM_MARKED_MODELS);

// Models NOT in SIM_MARKED_MODELS — used to prove even sim/pilot modes leave
// out-of-scope models untouched. Includes:
//  - ir.model.fields: Odoo infrastructure, must never be stamped
//  - product.template: shared catalog, never sim-owned
//  - x_collection_item: no create call in the Worker, cascades from parent
const NON_MARKED_MODELS = [
  "ir.model.fields",
  "product.template",
  "x_collection_item",
];

// Authoritative list Baraa manually adds x_is_simulation on in Odoo.
// The test also proves SIM_MARKED_MODELS matches this exactly.
// 15 models as of 2026-09-12 (x_supplier_price_request_log restored).
const EXPECTED_MARKED = [
  "res.partner",
  "x_daily_order",
  "x_daily_order_line",
  "x_quotation",
  "x_invoice",
  "x_payment",
  "x_delivery_route",
  "x_delivery_stop",
  "x_purchase_list",
  "x_collection_task",
  "x_standing_order",
  "x_complaint",
  "x_daily_price",
  "x_supplier_price_request_log",
  "x_message_analysis",
];

// ---------- run ----------
console.log(
  `\nsim-isolation test\n  ${scenarios.length} scenarios × ${models.length} marked models + ${NON_MARKED_MODELS.length} non-marked controls\n`,
);

// Structural check: SIM_MARKED_MODELS matches Baraa's list exactly.
console.log("\n[structural] SIM_MARKED_MODELS matches authoritative list");
const gotSet = new Set(models);
const expSet = new Set(EXPECTED_MARKED);
const inCodeNotExpected = models.filter((m) => !expSet.has(m));
const inExpectedNotCode = EXPECTED_MARKED.filter((m) => !gotSet.has(m));
assert(
  `same size (${models.length} = ${EXPECTED_MARKED.length})`,
  models.length === EXPECTED_MARKED.length,
  `got ${models.length}, expected ${EXPECTED_MARKED.length}`,
);
assert(
  `no extra models in code`,
  inCodeNotExpected.length === 0,
  `extras: [${inCodeNotExpected.join(", ")}]`,
);
assert(
  `no missing models in code`,
  inExpectedNotCode.length === 0,
  `missing: [${inExpectedNotCode.join(", ")}]`,
);

for (const s of scenarios) {
  console.log(`\n[scenario] ${s.name}`);
  for (const model of models) {
    // CREATE — batch (vals_list)
    captured = [];
    await call(s.env, model, "create", { vals_list: [{ name: "x" }] });
    const createBatchHasFlag = bodyHasFlag(captured[0]?.body);
    assert(
      `create ${model} (vals_list) → x_is_simulation ${s.expectFlagOnCreate ? "present" : "absent"}`,
      createBatchHasFlag === s.expectFlagOnCreate,
      `got flag=${createBatchHasFlag}, body.vals_list[0]=${JSON.stringify(captured[0]?.body?.vals_list?.[0])}`,
    );

    // CREATE — single (values)
    captured = [];
    await call(s.env, model, "create", { values: { name: "x" } });
    const createSingleHasFlag = bodyHasFlag(captured[0]?.body);
    assert(
      `create ${model} (values)    → x_is_simulation ${s.expectFlagOnCreate ? "present" : "absent"}`,
      createSingleHasFlag === s.expectFlagOnCreate,
      `got flag=${createSingleHasFlag}, body.values=${JSON.stringify(captured[0]?.body?.values)}`,
    );

    // WRITE — JSON-2 shape: { ids, vals }
    captured = [];
    await call(s.env, model, "write", { ids: [1], vals: { name: "x" } });
    const writeHasFlag =
      captured[0]?.body?.vals?.x_is_simulation !== undefined ||
      bodyHasFlag(captured[0]?.body);
    assert(
      `write  ${model}             → x_is_simulation ${s.expectFlagOnWrite ? "present" : "absent"}`,
      writeHasFlag === s.expectFlagOnWrite,
      `got flag=${writeHasFlag}, body=${JSON.stringify(captured[0]?.body)}`,
    );
  }

  // Non-marked models — must NEVER be stamped, even in sim mode.
  for (const m of NON_MARKED_MODELS) {
    captured = [];
    await call(s.env, m, "create", { vals_list: [{ name: "x" }] });
    const nonMarkedHasFlag = bodyHasFlag(captured[0]?.body);
    assert(
      `create ${m} (NON-marked) → x_is_simulation absent`,
      nonMarkedHasFlag === false,
      `got flag=${nonMarkedHasFlag}`,
    );
  }
}

// ---------- v6Call delegation check ----------
// Proves that createComplaint (which used to bypass call()) now stamps in BOTH
// sim and pilot — the two "test mode" worlds — and NOT in prod.
console.log("\n[v6-append] v6Call delegates to call() → stamps in sim AND pilot, never in prod");
{
  const { createComplaint } = await import("../src/odoo-v6-append.ts");

  // sim
  captured = [];
  await createComplaint(makeEnv({ SIMULATION_MODE: "true" }), {
    customerId: 1,
    type: "quality",
    severity: "low",
    text: "sim test",
  });
  assert(
    `createComplaint via v6Call in sim → x_is_simulation present`,
    bodyHasFlag(captured[0]?.body) === true,
    `body=${JSON.stringify(captured[0]?.body)}`,
  );

  // pilot
  captured = [];
  await createComplaint(makeEnv({ PILOT_MODE: "true", SIM_ALLOWLIST: "+96650" }), {
    customerId: 1,
    type: "quality",
    severity: "low",
    text: "pilot test",
  });
  assert(
    `createComplaint via v6Call in pilot → x_is_simulation present`,
    bodyHasFlag(captured[0]?.body) === true,
    `body=${JSON.stringify(captured[0]?.body)}`,
  );

  // prod
  captured = [];
  await createComplaint(makeEnv({}), {
    customerId: 1,
    type: "quality",
    severity: "low",
    text: "prod test",
  });
  assert(
    `createComplaint via v6Call in prod → x_is_simulation absent`,
    bodyHasFlag(captured[0]?.body) === false,
    `body=${JSON.stringify(captured[0]?.body)}`,
  );
}

// ---------- summary ----------
console.log(`\n─────────────────────────────────────────────`);
console.log(`  scenarios : ${scenarios.length}`);
console.log(`  models    : ${models.length} (+ 1 non-marked control)`);
console.log(`  total assertions : ${passed + failed}`);
console.log(`  passed    : ${passed}`);
console.log(`  failed    : ${failed}`);
if (failed > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  • ${f}`);
  globalThis.fetch = originalFetch;
  process.exit(1);
}
console.log(`\n✅ ALL PASSED — injection is exactly gated by isTestMode(env) (SIMULATION_MODE OR PILOT_MODE === "true")\n`);
globalThis.fetch = originalFetch;
process.exit(0);
