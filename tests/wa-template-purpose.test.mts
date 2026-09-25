// Tests for template choice per x_purpose (2026-09-24, WhatsApp template cleanup).
//
//   1. pickTemplate ranks APPROVED → param count the code sends → UTILITY → newest id.
//   2. findDuplicatePurposes flags shared purposes and ignores "other".
//   3. sendTemplateByPurpose with two rows on one purpose: sends the ranked
//      winner, logs, alerts the owner once per purpose per day (held for him
//      outside his 24h window, STATUS § 33).
//   4. owner_alert duplicated: logged only (no recursive alert).
//   5. Function params follow the resolved template (delivered / welcome
//      migration): new template gets the new variables, the legacy one the old.
//   6. getTemplateByPurpose (supplier path) uses the same ranking + alert.
//   7. syncTemplates reports duplicate purposes.
//
// Nothing leaves the process: fetch is mocked for Meta and Odoo.

import { pickTemplate, findDuplicatePurposes } from "../src/template-pick.ts";
import {
  sendTemplateByPurpose,
  clearTemplateCache,
  welcomeParams,
  cutoffLabel,
  T,
} from "../src/templates.ts";
import { getTemplateByPurpose } from "../src/odoo.ts";
import { syncTemplates } from "../src/wa-template-sync.ts";

function makeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
  };
}

// ---------- fetch mock ----------
let templateRows: any[] = [];
let metaSends: any[] = [];
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  let body: any = null;
  try { body = JSON.parse(init?.body ?? "null"); } catch { body = init?.body; }
  if (url.includes("graph.facebook.com") && url.includes("message_templates")) {
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }
  if (url.includes("graph.facebook.com")) {
    metaSends.push(body);
    return new Response(JSON.stringify({ messages: [{ id: `wamid.T${metaSends.length}` }] }), { status: 200 });
  }
  const path = new URL(url).pathname;
  if (path.endsWith("/x_whatsapp_template/search_read")) {
    const purpose = body?.domain?.[0]?.[2];
    const rows = body?.domain?.length ? templateRows.filter((r) => r.x_purpose === purpose) : templateRows;
    return new Response(JSON.stringify(rows), { status: 200 });
  }
  if (path.endsWith("/x_wa_message/create")) return new Response(JSON.stringify([1]), { status: 200 });
  if (path.endsWith("/search_read")) return new Response(JSON.stringify([]), { status: 200 });
  return new Response(JSON.stringify(true), { status: 200 });
}) as typeof globalThis.fetch;

function makeEnv(): any {
  return {
    ODOO_URL: "https://utakfresh.odoo.com",
    ODOO_DB: "utakfresh",
    ODOO_LOGIN: "admin@utakfresh.com",
    ODOO_API_KEY: "TEST_KEY",
    META_GRAPH_VERSION: "v22.0",
    META_WABA_ID: "W",
    META_PHONE_NUMBER_ID: "1",
    META_ACCESS_TOKEN: "x",
    OWNER_WHATSAPP: "+966500000001",
    PILOT_MODE: "true",
    SIM_ALLOWLIST: "+966500000001,+966500000002",
    MSG_DEDUP: makeKV(),
  };
}

const row = (id: number, name: string, purpose: string, pc: number, cat = "UTILITY", status = "APPROVED") => ({
  id, x_meta_template_id: name, x_language: "ar", x_purpose: purpose,
  x_param_count: pc, x_category: cat, x_meta_status: status,
});

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "  (" + detail + ")" : ""}`); }
}
function reset(rows: any[]) { templateRows = rows; metaSends = []; clearTemplateCache(); }
const sentName = () => metaSends.filter((b) => b.to === "966500000002").map((b) => b.template?.name);
const ownerAlerts = () => metaSends.filter((b) => b.to === "966500000001");
// 2026-09-25 (STATUS § 33) — outside Baraa's 24h window an alert is held for
// him (the MARKETING utak_owner_alert is never used): read his queue.
const ownerHeld = (env: any): any[] => JSON.parse(env.MSG_DEDUP.store.get("wa_q:v1:966500000001") ?? "[]");

console.log("\n[1] pickTemplate ranking");
{
  const rows = [row(42, "utak_v2_collection", "collection_summary", 3), row(11, "utak_collection_summary", "collection_summary", 4)];
  assert("param count beats newer id", pickTemplate(rows, () => 4)?.id === 11);
  const rows2 = [row(20, "a", "p", 1, "MARKETING"), row(10, "b", "p", 1, "UTILITY")];
  assert("UTILITY beats MARKETING", pickTemplate(rows2, () => 1)?.id === 10);
  const rows3 = [row(30, "a", "p", 1, "UTILITY", "PENDING"), row(5, "b", "p", 1, "MARKETING")];
  assert("APPROVED beats everything", pickTemplate(rows3, () => 1)?.id === 5);
  const rows4 = [row(7, "a", "p", 2), row(9, "b", "p", 2)];
  assert("full tie → newest id", pickTemplate(rows4, () => 2)?.id === 9);
  assert("empty → null", pickTemplate([], () => 1) === null);
}

console.log("\n[2] findDuplicatePurposes");
{
  const d = findDuplicatePurposes([
    row(1, "a", "purchase_list", 4), row(2, "b", "purchase_list", 2),
    row(3, "c", "other", 1), row(4, "d", "other", 1), row(5, "e", "owner_alert", 1),
  ]);
  assert("purchase_list flagged", Array.isArray(d.purchase_list) && d.purchase_list.length === 2);
  assert("'other' ignored", !("other" in d));
  assert("single purpose not flagged", !("owner_alert" in d));
}

console.log("\n[3] duplicate purpose on send → winner + one owner alert per day");
{
  reset([
    row(42, "utak_v2_collection", "collection_summary", 3),
    row(11, "utak_collection_summary", "collection_summary", 4),
    row(24, "utak_owner_alert", "owner_alert", 1, "MARKETING"),
  ]);
  const env = makeEnv();
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.join(" ")); };
  await sendTemplateByPurpose(env, "+966500000002", T.COLLECTION_SUMMARY, ["2026-09-24", "x", "10", "1"]);
  await sendTemplateByPurpose(env, "+966500000002", T.COLLECTION_SUMMARY, ["2026-09-24", "x", "10", "1"]);
  console.error = origErr;
  assert("both sends used utak_collection_summary", sentName().join() === "utak_collection_summary,utak_collection_summary", sentName().join());
  assert("owner alert held exactly once (outside his window)", ownerHeld(env).length === 1 && ownerAlerts().length === 0,
    `${ownerHeld(env).length}/${ownerAlerts().length}`);
  assert("alert names the purpose", JSON.stringify(ownerHeld(env)[0] ?? "").includes("collection_summary"));
  assert("logged on every send", errors.filter((e) => e.includes("duplicate x_purpose='collection_summary'")).length === 2);
}

console.log("\n[4] owner_alert duplicated → log only, no recursion");
{
  reset([row(24, "utak_owner_alert", "owner_alert", 1, "MARKETING"), row(99, "utak_owner_alert_b", "owner_alert", 1)]);
  const env = makeEnv();
  const origErr = console.error; const errs: string[] = [];
  console.error = (...a: unknown[]) => { errs.push(a.join(" ")); };
  await sendTemplateByPurpose(env, "+966500000001", T.OWNER_ALERT, ["x"]);
  console.error = origErr;
  assert("exactly one Meta send (the alert itself)", metaSends.length === 1, String(metaSends.length));
  assert("duplicate logged", errs.some((e) => e.includes("owner_alert")));
}

console.log("\n[5] params follow the resolved template");
{
  const deliveredParams = (name: string) => (name === "utak_delivery_done" ? ["سالم"] : ["123"]);
  reset([row(60, "utak_delivered", "customer_delivery_done", 1)]);
  await sendTemplateByPurpose(makeEnv(), "+966500000002", T.CUSTOMER_DELIVERY_DONE, deliveredParams);
  assert("utak_delivered gets the order number",
    metaSends[0]?.template?.components?.[0]?.parameters?.[0]?.text === "123");
  reset([row(18, "utak_delivery_done", "customer_delivery_done", 1, "MARKETING")]);
  await sendTemplateByPurpose(makeEnv(), "+966500000002", T.CUSTOMER_DELIVERY_DONE, deliveredParams);
  // STATUS § 33 — the legacy utak_delivery_done is MARKETING: never used for this operational notice.
  assert("rollback to the MARKETING utak_delivery_done: not sent", metaSends.length === 0, String(metaSends.length));

  assert("cutoffLabel(21) = 9:00 مساءً", cutoffLabel(21) === "9:00 مساءً", cutoffLabel(21));
  assert("cutoffLabel(12) = 12:00 مساءً", cutoffLabel(12) === "12:00 مساءً");
  assert("welcome new → [name, cutoff]", welcomeParams("utak_welcome", "عمر").join("|") === "عمر|9:00 مساءً");
  assert("welcome legacy → [name]", welcomeParams("utak_v2_welcome", "عمر").join("|") === "عمر");
  reset([row(53, "utak_welcome", "customer_welcome", 2)]);
  await sendTemplateByPurpose(makeEnv(), "+966500000002", T.CUSTOMER_WELCOME, (n) => welcomeParams(n, "عمر"));
  assert("utak_welcome sent with 2 params",
    metaSends[0]?.template?.components?.[0]?.parameters?.length === 2);
}

console.log("\n[6] getTemplateByPurpose (supplier path) ranks + alerts");
{
  reset([
    row(4, "utak_supplier_daily_ask", "supplier_ask", 1, "MARKETING"),
    row(80, "utak_supplier_ask_v2", "supplier_ask", 2),
    row(24, "utak_owner_alert", "owner_alert", 1, "MARKETING"),
  ]);
  const env = makeEnv();
  const origErr = console.error; console.error = () => {};
  const t = await getTemplateByPurpose(env, "supplier_ask", 1);
  console.error = origErr;
  assert("param-count match wins over newer UTILITY", t?.x_meta_template_id === "utak_supplier_daily_ask", t?.x_meta_template_id);
  assert("owner alert held (outside his window)", ownerHeld(env).length === 1, String(ownerHeld(env).length));
}

console.log("\n[7] syncTemplates reports duplicates");
{
  reset([
    row(5, "utak_purchase_list_v2", "purchase_list", 4),
    row(43, "utak_v2_purchase", "purchase_list", 2),
    row(45, "hello_world", "other", 0),
    row(53, "utak_welcome", "other", 2),
  ]);
  const r = await syncTemplates(makeEnv());
  assert("purchase_list in duplicate_purposes", (r.duplicate_purposes.purchase_list ?? []).length === 2);
  assert("only one duplicate purpose", Object.keys(r.duplicate_purposes).length === 1, Object.keys(r.duplicate_purposes).join());
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
