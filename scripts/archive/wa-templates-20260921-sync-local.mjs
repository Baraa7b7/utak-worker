// تشغيل مزامنة قوالب Meta → Odoo محلياً (نفس منطق src/wa-template-sync.ts).
// يقرأ x_label_ar من src/wa-template-labels.json ويعبّئه بحرص:
//   - قالب جديد: يُنشأ مع x_label_ar + x_name من الخريطة (fallback = الاسم التقني).
//   - قالب موجود مع x_label_ar فارغ: يُملأ (backfill).
//   - قالب موجود مع x_label_ar غير فارغ: لا يُلمس.
//
// Rollback (فرد فرد): update x_label_ar='' x_name='' على الصف — أو استعادة القيمة السابقة
// من سجل تعديل Odoo.

import { readFileSync } from "node:fs";

const abs = "/Users/baraa7/utak-worker/.env.sim-verify";
const env = Object.fromEntries(
  readFileSync(abs, "utf8").split(/\r?\n/).filter((l)=>l&&!l.startsWith("#")).map((l)=>{
    const i=l.indexOf("="); return[l.slice(0,i).trim(),l.slice(i+1).trim()];
  }),
);
const AR_LABELS = JSON.parse(readFileSync("/Users/baraa7/utak-worker/src/wa-template-labels.json","utf8"));
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, META_ACCESS_TOKEN } = env;

const WABA = "2144001136512196";
const V = "v22.0";

function pickAr(name) {
  const v = AR_LABELS[name];
  return typeof v === "string" && v.trim() ? v : name;
}
function nowOdoo() { return new Date().toISOString().replace("T"," ").slice(0,19); }
function countBodyParams(b) {
  const m = (b||"").match(/\{\{\d+\}\}/g);
  if (!m) return 0;
  return new Set(m.map((x)=>Number(x.replace(/[^0-9]/g,"")))).size;
}
function extract(tpl) {
  let body="", buttons="";
  for (const c of tpl.components ?? []) {
    if (c.type === "BODY" && typeof c.text === "string") body = c.text;
    if (c.type === "BUTTONS" && Array.isArray(c.buttons)) {
      buttons = c.buttons.map((b,i)=>`[${i}] ${b.type} — ${b.text}${b.url?` → ${b.url}`:""}${b.phone_number?` → ${b.phone_number}`:""}`).join("\n");
    }
  }
  return { body, buttons };
}

// ---- Meta ----
async function fetchMeta() {
  const all = [];
  let url = `https://graph.facebook.com/${V}/${WABA}/message_templates?limit=200&fields=id,name,language,status,category,components`;
  for (let p=0; p<20 && url; p++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }});
    const t = await r.text();
    if (!r.ok) throw new Error(`meta HTTP ${r.status}: ${t.slice(0,300)}`);
    const j = JSON.parse(t);
    for (const x of j.data ?? []) all.push(x);
    url = j.paging?.next ?? null;
  }
  return all;
}

// ---- Odoo ----
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
  const r = await fetch(`${ODOO_URL}/json/2/${m}/${met}`, { method:"POST", headers:h, body: JSON.stringify(b) });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(m,met,b); }
    throw new Error(`odoo ${m}.${met} HTTP ${r.status}: ${p?.data?.message ?? String(t).slice(0,300)}`);
  }
  return p;
}

// ---- run ----
const metaList = await fetchMeta();
console.log(`Meta فرغت ${metaList.length} قالب`);

const odooRows = await call("x_whatsapp_template", "search_read", {
  domain: [], fields: ["id","x_meta_template_id","x_language","x_missing_in_meta","x_label_ar","x_name"], limit: 2000,
});
const byKey = new Map();
for (const r of odooRows) if (typeof r.x_meta_template_id === "string" && r.x_meta_template_id) {
  const lang = typeof r.x_language === "string" ? r.x_language : "";
  byKey.set(`${r.x_meta_template_id}::${lang.toLowerCase()}`, r);
}
const seen = new Set();
const report = { updated: 0, created: 0, missing_in_meta: 0, created_names: [], errors: [] };

for (const t of metaList) {
  const key = `${t.name}::${(t.language||"").toLowerCase()}`;
  seen.add(key);
  const { body, buttons } = extract(t);
  const pc = countBodyParams(body);
  const existing = byKey.get(key);
  const desired = pickAr(t.name);
  try {
    if (existing) {
      const vals = {
        x_meta_id: t.id, x_meta_status: t.status, x_category: t.category,
        x_body: body, x_param_count: pc, x_buttons: buttons,
        x_last_synced: nowOdoo(), x_missing_in_meta: false,
      };
      const cur_label = typeof existing.x_label_ar === "string" ? existing.x_label_ar.trim() : "";
      const cur_name  = typeof existing.x_name === "string" ? existing.x_name.trim() : "";
      const final_label = cur_label || desired;
      if (!cur_label) vals.x_label_ar = desired;
      // x_name = display mirror of x_label_ar; skip write when already matches.
      if (cur_name !== final_label) vals.x_name = final_label;
      await call("x_whatsapp_template", "write", { ids: [existing.id], vals });
      report.updated++;
    } else {
      await call("x_whatsapp_template", "create", {
        vals_list: [{
          x_meta_template_id: t.name, x_language: t.language,
          x_meta_id: t.id, x_meta_status: t.status, x_category: t.category,
          x_body: body, x_param_count: pc, x_buttons: buttons,
          x_last_synced: nowOdoo(), x_missing_in_meta: false,
          x_label_ar: desired, x_name: desired,
          // ملاحظة: x_purpose مطلوب في النموذج → أضبطه على "other" (نمط item2e)
          x_purpose: "other",
        }],
      });
      report.created++; report.created_names.push(`${t.name}/${t.language}`);
    }
  } catch (e) {
    report.errors.push(`${t.name}/${t.language}: ${e.message}`);
  }
}
for (const r of odooRows) {
  if (typeof r.x_meta_template_id !== "string" || !r.x_meta_template_id) continue;
  const lang = typeof r.x_language === "string" ? r.x_language : "";
  if (seen.has(`${r.x_meta_template_id}::${lang.toLowerCase()}`)) continue;
  try {
    await call("x_whatsapp_template", "write", { ids: [r.id], vals: { x_missing_in_meta: true, x_last_synced: nowOdoo() }});
    report.missing_in_meta++;
  } catch (e) { report.errors.push(`mark-missing ${r.x_meta_template_id}: ${e.message}`); }
}

console.log("REPORT:", JSON.stringify(report, null, 2));
