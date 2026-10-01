// فرض تحديث x_label_ar + x_name للـ 6 قوالب القديمة في Odoo.
//
// لماذا سكربت مستقل؟ لأن wa-template-sync.ts يعمل backfill-only على
// x_label_ar (لا يلمس قيمة موجودة). لتغيير أسماء موجودة نحتاج write
// صريح — هذا السكربت يفعل ذلك فقط لـ 6 أسماء محدّدة، ويأخذ snapshot
// قبل الكتابة لـ rollback فرد فرد.
//
// المصدر: src/wa-template-labels.json (تم تعديله ليعطي الأسماء الجديدة).
// الكتابة: على سجلات x_whatsapp_template حيث x_meta_template_id في القائمة.
// لا يمس x_wa_allowed لأن الحقل غير موجود على القالب أصلاً (فقط على res.partner).
//
// Rollback: عكس القيم بيدك من snapshot المطبوع في الأسفل (before → after).

import { readFileSync, writeFileSync } from "node:fs";

const abs = "/Users/baraa7/utak-worker/.env.sim-verify";
const env = Object.fromEntries(
  readFileSync(abs, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const AR_LABELS = JSON.parse(readFileSync("/Users/baraa7/utak-worker/src/wa-template-labels.json", "utf8"));
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

// القوالب القديمة الستة — بحسب السبك.
const OLD_NAMES = [
  "utak_v2_order_confirm",
  "utak_delivery_done",
  "utak_delivery_incoming",
  "utak_v2_pay_remind",
  "utak_v2_welcome",
  "utak_v2_inactive",
];

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
  const r = await fetch(`${ODOO_URL}/json/2/${m}/${met}`, { method: "POST", headers: h, body: JSON.stringify(b) });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = t; }
  if (!r.ok) {
    if (r.status === 401 && auth.mode === "apikey") { await ses(); return call(m, met, b); }
    throw new Error(`odoo ${m}.${met} HTTP ${r.status}: ${p?.data?.message ?? String(t).slice(0,300)}`);
  }
  return p;
}

const rows = await call("x_whatsapp_template", "search_read", {
  domain: [["x_meta_template_id", "in", OLD_NAMES]],
  fields: ["id", "x_meta_template_id", "x_language", "x_label_ar", "x_name"],
  limit: 100,
});

if (rows.length === 0) {
  console.error("لم يتم إيجاد أي قالب قديم في Odoo");
  process.exit(2);
}

const snapshot = { at: new Date().toISOString(), before: [] };
const changes = [];

for (const r of rows) {
  const desired = AR_LABELS[r.x_meta_template_id];
  if (typeof desired !== "string" || !desired.trim()) {
    console.warn(`[skip] ${r.x_meta_template_id}: لا يوجد اسم في الملف`);
    continue;
  }
  snapshot.before.push({
    id: r.id,
    x_meta_template_id: r.x_meta_template_id,
    x_language: r.x_language,
    x_label_ar: r.x_label_ar,
    x_name: r.x_name,
  });
  changes.push({ id: r.id, x_meta_template_id: r.x_meta_template_id, desired });
}

const snapPath = "/Users/baraa7/utak-worker/scripts/artifacts/wa-templates-20260921-relabel-old.rollback.json";
try {
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
  console.log(`snapshot rollback: ${snapPath}`);
} catch (e) {
  console.warn(`تعذّرت كتابة snapshot: ${e.message}`);
}

const result = [];
for (const c of changes) {
  try {
    await call("x_whatsapp_template", "write", {
      ids: [c.id],
      vals: { x_label_ar: c.desired, x_name: c.desired },
    });
    console.log(`[write] ${c.x_meta_template_id} → "${c.desired}"`);
    result.push({ ...c, status: "OK" });
  } catch (e) {
    console.error(`[fail] ${c.x_meta_template_id}: ${e.message}`);
    result.push({ ...c, status: "FAIL", error: e.message });
  }
}

// التحقق: قراءة الصفوف مجدداً
const verify = await call("x_whatsapp_template", "search_read", {
  domain: [["x_meta_template_id", "in", OLD_NAMES]],
  fields: ["id", "x_meta_template_id", "x_label_ar", "x_name"],
  limit: 100,
});
console.log("\n=== after ===");
for (const v of verify) {
  console.log(`  ${v.x_meta_template_id} · label="${v.x_label_ar}" · name="${v.x_name}"`);
}
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(result, null, 2));
