// Submit the utak_supplier_confirm_v1 template to Meta via Graph API.
//
// Spec source: docs/supplier-confirm-template.md
// WABA ID: 2144001136512196
// Graph API version: v22.0
// Endpoint: POST /{WABA_ID}/message_templates
//
// Behaviour:
//   1. If META_ACCESS_TOKEN is missing from .env.sim-verify, prints the exact
//      one-liner Baraa needs to add it, then exits without submitting.
//   2. Runs a GET first to check if the template name already exists. If it
//      does, reports its status and exits.
//   3. Submits POST with language=ar, category=UTILITY, body_text + 3
//      quick-reply buttons, and example.body_text for each variable.
//   4. On success, updates x_meta_status on Odoo row id=46
//      (x_whatsapp_template) with the returned status.

import { readFileSync, writeFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const envRaw = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envRaw.split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);

const WABA_ID = "2144001136512196";
const GRAPH_VERSION = "v22.0";
const NAME = "utak_supplier_confirm_v1";
const LANG = "ar";
const CATEGORY = "UTILITY";
const BODY_TEXT = `شكراً {{1}} 🌿

استلمنا أسعارك لـ {{2}} صنف اليوم. سنعتمدها لطلبات اليوم.

لو تحتاج تعديل، اضغط "تعديل الأسعار" أو رد "تعديل".`;
const BODY_EXAMPLE = ["أحمد", "7"];
const BUTTONS = [
  { type: "QUICK_REPLY", text: "تعديل الأسعار" },
  { type: "QUICK_REPLY", text: "توقف اليوم" },
  { type: "QUICK_REPLY", text: "شكراً" },
];

const token = env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN is not set in .env.sim-verify.");
  console.error("Add it with (paste one line, then paste the token when prompted, then press Enter):");
  console.error("");
  console.error("  read -rs META_ACCESS_TOKEN && printf 'META_ACCESS_TOKEN=%s\\n' \"$META_ACCESS_TOKEN\" >> .env.sim-verify && unset META_ACCESS_TOKEN");
  console.error("");
  console.error("Then rerun: node scripts/submit-supplier-confirm-template.mjs");
  process.exit(2);
}

// --- 1. Check if the template already exists on Meta ---
const listUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates?limit=100&fields=id,name,language,status,category`;
console.log(`GET ${listUrl}`);
const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
const listJson = await listRes.json();
if (!listRes.ok) {
  console.error(`GET failed: HTTP ${listRes.status}`);
  console.error(JSON.stringify(listJson, null, 2));
  process.exit(3);
}
const matches = (listJson.data ?? []).filter((t) => t.name === NAME && t.language === LANG);
if (matches.length > 0) {
  console.log(`Template ${NAME}/${LANG} already exists on Meta:`);
  for (const m of matches) console.log(`  id=${m.id} status=${m.status} category=${m.category}`);
  const status = matches[0].status;
  console.log(`\nMeta status: ${status}. Will update Odoo row id=46.`);
  await updateOdoo(status);
  process.exit(0);
}
console.log(`No existing ${NAME}/${LANG} on Meta. Creating…`);

// --- 2. POST create ---
const payload = {
  name: NAME,
  language: LANG,
  category: CATEGORY,
  allow_category_change: true,
  components: [
    {
      type: "BODY",
      text: BODY_TEXT,
      example: { body_text: [BODY_EXAMPLE] },
    },
    {
      type: "BUTTONS",
      buttons: BUTTONS,
    },
  ],
};
const createUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates`;
console.log(`POST ${createUrl}`);
console.log("Payload:", JSON.stringify(payload, null, 2));
const createRes = await fetch(createUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const createJson = await createRes.json();
console.log(`HTTP ${createRes.status}`);
console.log(JSON.stringify(createJson, null, 2));
if (!createRes.ok) {
  console.error("Meta rejected the template. Not touching Odoo.");
  process.exit(4);
}
const metaStatus = createJson.status ?? "PENDING";
const metaId = createJson.id;
console.log(`\nMeta template created: id=${metaId} status=${metaStatus}`);
await updateOdoo(metaStatus, metaId);
process.exit(0);

// --- 3. Update Odoo row id=46 ---
async function updateOdoo(status, metaId) {
  const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;
  let auth = { mode: "apikey", cookie: null };
  async function ses() {
    const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
    });
    const m = (r.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
    if (!m) throw new Error("session auth failed");
    auth = { mode: "session", cookie: `session_id=${m[1]}` };
  }
  async function call(m, met, b) {
    const h = { "Content-Type": "application/json" };
    if (auth.mode === "apikey") h["Authorization"] = `Bearer ${ODOO_API_KEY}`;
    else h["Cookie"] = auth.cookie;
    const r = await fetch(`${ODOO_URL}/json/2/${m}/${met}`, {
      method: "POST", headers: h, body: JSON.stringify(b),
    });
    const t = await r.text();
    let p; try { p = JSON.parse(t); } catch { p = t; }
    if (!r.ok) {
      if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(m, met, b); }
      throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message ?? String(t).slice(0,300)}`);
    }
    return p;
  }
  const vals = { x_meta_status: status };
  if (metaId) vals.x_meta_id = String(metaId);
  await call("x_whatsapp_template", "write", { ids: [46], vals });
  console.log(`Odoo x_whatsapp_template id=46 updated: ${JSON.stringify(vals)}`);
}
