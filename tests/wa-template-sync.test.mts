// Unit tests for wa-template-sync (2026-09-21):
//  • pickArabicLabel — map hit vs fallback to technical name.
//  • hasArabicLabel  — map hit vs miss.
//  • syncTemplates
//     – new template: create includes x_label_ar + x_name from the map.
//     – template unknown to the map: create falls back to the technical name.
//     – existing row with EMPTY x_label_ar: write back-fills it.
//     – existing row with NON-EMPTY x_label_ar: write does NOT overwrite it.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs \
//     tests/wa-template-sync.test.mts

import {
  pickArabicLabel,
  hasArabicLabel,
  syncTemplates,
} from "../src/wa-template-sync.ts";

// ---------- fetch mock ----------
interface CapturedRequest { url: string; method: string; body: unknown }
let captured: CapturedRequest[] = [];
type FetchImpl = (input: unknown, init?: unknown) => Promise<Response> | Response;
const originalFetch = globalThis.fetch;

function useFetch(fn: FetchImpl) {
  globalThis.fetch = ((input: unknown, init?: unknown) =>
    Promise.resolve(fn(input, init))) as typeof globalThis.fetch;
}
function resetFetch() { globalThis.fetch = originalFetch; }

const envBase = {
  META_GRAPH_VERSION: "v22.0",
  META_WABA_ID: "WABA",
  META_ACCESS_TOKEN: "TOKEN",
  ODOO_URL: "https://odoo.example",
  ODOO_DB: "db",
  ODOO_LOGIN: "u",
  ODOO_API_KEY: "k",
  MSG_DEDUP: {
    get: async () => null,
    put: async () => undefined,
  } as unknown,
  SIMULATION_MODE: "false",
  PILOT_MODE: "false",
  SIM_ALLOWLIST: "",
  // widely-used but unused-here bindings
} as unknown as import("../src/config.ts").Env;

function metaTpl(name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id_${name}`,
    name,
    language: "ar",
    status: "APPROVED",
    category: "UTILITY",
    components: [{ type: "BODY", text: "hi {{1}}" }],
    ...extra,
  };
}

// ---------- tests ----------
let pass = 0, fail = 0;
function it(desc: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${desc}`); pass++; })
    .catch((e) => { console.error(`  ✗ ${desc}\n     ${e?.stack ?? e}`); fail++; });
}

console.log("\nwa-template-sync\n");

// ----- pickArabicLabel -----
await it("pickArabicLabel returns map value for known name", () => {
  const v = pickArabicLabel("utak_delivered");
  if (v !== "تم التسليم") throw new Error(`got ${v}`);
});
await it("pickArabicLabel falls back to technical name for unknown", () => {
  const v = pickArabicLabel("some_random_name_9876");
  if (v !== "some_random_name_9876") throw new Error(`got ${v}`);
});

// ----- hasArabicLabel -----
await it("hasArabicLabel true for known name", () => {
  if (!hasArabicLabel("utak_welcome")) throw new Error("expected true");
});
await it("hasArabicLabel false for unknown", () => {
  if (hasArabicLabel("does_not_exist_xyz")) throw new Error("expected false");
});

// ----- syncTemplates behavior -----
async function runSyncWith(metaList: unknown[], odooRows: unknown[]) {
  captured = [];
  useFetch((input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init as { method?: string })?.method ?? "GET";
    const rawBody = (init as { body?: string })?.body ?? "";
    let body: unknown = null;
    try { body = typeof rawBody === "string" && rawBody ? JSON.parse(rawBody) : null; } catch { body = rawBody; }
    captured.push({ url, method, body });

    // Meta list
    if (url.includes("graph.facebook.com") && url.includes("message_templates")) {
      return new Response(JSON.stringify({ data: metaList }), { status: 200 });
    }
    // Odoo search_read on x_whatsapp_template
    if (url.endsWith("/x_whatsapp_template/search_read")) {
      return new Response(JSON.stringify(odooRows), { status: 200 });
    }
    // Odoo write
    if (url.endsWith("/x_whatsapp_template/write")) {
      return new Response(JSON.stringify(true), { status: 200 });
    }
    // Odoo create
    if (url.endsWith("/x_whatsapp_template/create")) {
      return new Response(JSON.stringify([100]), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
  const report = await syncTemplates(envBase);
  resetFetch();
  return report;
}

await it("CREATE fills x_label_ar + x_name from the map", async () => {
  const r = await runSyncWith(
    [metaTpl("utak_delivered")],
    [], // no Odoo rows
  );
  if (r.created !== 1) throw new Error(`created=${r.created}`);
  const createCall = captured.find((c) => c.url.endsWith("/x_whatsapp_template/create"));
  if (!createCall) throw new Error("no create call");
  // deno-lint-ignore no-explicit-any
  const vals = (createCall.body as any).vals_list[0];
  if (vals.x_label_ar !== "تم التسليم") throw new Error(`x_label_ar=${vals.x_label_ar}`);
  if (vals.x_name !== "تم التسليم") throw new Error(`x_name=${vals.x_name}`);
});

await it("CREATE for unmapped name falls back to the technical name", async () => {
  const r = await runSyncWith(
    [metaTpl("brand_new_template_2999")],
    [],
  );
  if (r.created !== 1) throw new Error(`created=${r.created}`);
  const createCall = captured.find((c) => c.url.endsWith("/x_whatsapp_template/create"));
  // deno-lint-ignore no-explicit-any
  const vals = (createCall!.body as any).vals_list[0];
  if (vals.x_label_ar !== "brand_new_template_2999") throw new Error(`x_label_ar=${vals.x_label_ar}`);
  if (vals.x_name !== "brand_new_template_2999") throw new Error(`x_name=${vals.x_name}`);
});

await it("UPDATE back-fills x_label_ar when empty", async () => {
  const r = await runSyncWith(
    [metaTpl("utak_welcome")],
    [{
      id: 42,
      x_meta_template_id: "utak_welcome",
      x_language: "ar",
      x_missing_in_meta: false,
      x_label_ar: false,   // empty
      x_name: false,       // empty
    }],
  );
  if (r.updated !== 1) throw new Error(`updated=${r.updated}`);
  const writeCall = captured.find((c) => c.url.endsWith("/x_whatsapp_template/write"));
  if (!writeCall) throw new Error("no write call");
  // deno-lint-ignore no-explicit-any
  const vals = (writeCall.body as any).vals;
  if (vals.x_label_ar !== "ترحيب عميل جديد") throw new Error(`x_label_ar=${vals.x_label_ar}`);
  if (vals.x_name !== "ترحيب عميل جديد") throw new Error(`x_name=${vals.x_name}`);
});

await it("UPDATE does NOT overwrite an existing non-empty x_label_ar (source of truth)", async () => {
  const r = await runSyncWith(
    [metaTpl("utak_welcome")],
    [{
      id: 42,
      x_meta_template_id: "utak_welcome",
      x_language: "ar",
      x_missing_in_meta: false,
      x_label_ar: "اسم اختاره براء يدوياً",
      x_name: "اسم اختاره براء يدوياً",   // x_name already mirrors label → no rewrite needed
    }],
  );
  if (r.updated !== 1) throw new Error(`updated=${r.updated}`);
  const writeCall = captured.find((c) => c.url.endsWith("/x_whatsapp_template/write"));
  // deno-lint-ignore no-explicit-any
  const vals = (writeCall!.body as any).vals;
  if ("x_label_ar" in vals) throw new Error(`x_label_ar written: ${JSON.stringify(vals)}`);
  if ("x_name" in vals) throw new Error(`x_name written: ${JSON.stringify(vals)}`);
});

await it("UPDATE: x_name mirrors x_label_ar (rewrites x_name when it holds the technical name)", async () => {
  // Old row where x_label_ar is already Arabic but x_name still holds the
  // technical utak_* string — display_name shows English until we fix x_name.
  const r = await runSyncWith(
    [metaTpl("utak_delivery_done")],
    [{
      id: 18,
      x_meta_template_id: "utak_delivery_done",
      x_language: "ar",
      x_missing_in_meta: false,
      x_label_ar: "تم التوصيل",
      x_name: "utak_delivery_done",
    }],
  );
  if (r.updated !== 1) throw new Error(`updated=${r.updated}`);
  const writeCall = captured.find((c) => c.url.endsWith("/x_whatsapp_template/write"));
  // deno-lint-ignore no-explicit-any
  const vals = (writeCall!.body as any).vals;
  if ("x_label_ar" in vals) throw new Error(`x_label_ar should NOT change: ${JSON.stringify(vals)}`);
  if (vals.x_name !== "تم التوصيل") throw new Error(`x_name=${vals.x_name}`);
});

await it("UPDATE fallback: unmapped name + empty x_label_ar → back-fill with technical name (no blank rows)", async () => {
  const r = await runSyncWith(
    [metaTpl("no_ar_entry_1234")],
    [{
      id: 42,
      x_meta_template_id: "no_ar_entry_1234",
      x_language: "ar",
      x_missing_in_meta: false,
      x_label_ar: "",
      x_name: "",
    }],
  );
  if (r.updated !== 1) throw new Error(`updated=${r.updated}`);
  const writeCall = captured.find((c) => c.url.endsWith("/x_whatsapp_template/write"));
  // deno-lint-ignore no-explicit-any
  const vals = (writeCall!.body as any).vals;
  if (vals.x_label_ar !== "no_ar_entry_1234") throw new Error(`x_label_ar=${vals.x_label_ar}`);
  if (vals.x_name !== "no_ar_entry_1234") throw new Error(`x_name=${vals.x_name}`);
});

console.log(`\nPASS ${pass}  FAIL ${fail}\n`);
if (fail > 0) process.exit(1);
