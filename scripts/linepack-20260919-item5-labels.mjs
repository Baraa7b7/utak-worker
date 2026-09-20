// Item 5 — Arabic labels for x_whatsapp_template rows.
// Verifies Meta name for specific ids before writing (task requires 4/14/23/45).

import { readFileSync, writeFileSync } from "node:fs";
const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL,ODOO_DB,ODOO_LOGIN,ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const ROLLBACK_PATH = new URL("./artifacts/linepack-20260919-rollback.json", import.meta.url).pathname;
const rollback = JSON.parse(readFileSync(ROLLBACK_PATH,"utf8"));
function recordOp(op){rollback.operations.push({ts:new Date().toISOString(),...op});writeFileSync(ROLLBACK_PATH,JSON.stringify(rollback,null,2));}

// Task mapping — Odoo id → Arabic label (from user spec).
const LABELS = {
  4:  "طلب أسعار المورّد",
  5:  "قائمة الشراء",
  6:  "جاهزية التحميل",
  7:  "جدول جولة السائق",
  8:  "محطة توصيل",
  9:  "تحصيل السائق",
  10: "طلب تحصيل",
  11: "ملخص التحصيل اليومي",
  12: "عمولات",
  13: "ملخص المالك",
  14: "ترحيب العميل",
  15: "تذكير يومي للعميل",
  16: "تأكيد الطلب",
  17: "التوصيل قادم",
  18: "تم التوصيل",
  19: "فاتورة العميل (نص)",
  20: "تذكير سداد",
  21: "تنشيط عميل",
  22: "تقييم العميل",
  23: "فاتورة العميل (PDF)",
  24: "تنبيه المالك",
  25: "بداية وردية",
  42: "ملخص تحصيل (v2)",
  43: "قائمة شراء (v2)",
  44: "مسار السائق (v2)",
  45: "اختبار (لا يُستخدم)",
};

// Sanity checks: id → expected Meta template_id name (the exact template name in Meta)
const EXPECTED_META_NAME = {
  4:  "utak_supplier_daily_ask",
  14: "utak_v2_welcome",
  23: "utak_invoice_pdf_v1",
  45: "hello_world",
};

const ids = Object.keys(LABELS).map(Number).sort((a,b)=>a-b);
const rows = await call("x_whatsapp_template","read",{ids,fields:["id","x_meta_template_id","x_label_ar"]});
const byId = Object.fromEntries(rows.map((r)=>[r.id,r]));

console.log("VERIFY sanity Meta names:");
const skipIds = new Set();
for (const [id, expected] of Object.entries(EXPECTED_META_NAME)) {
  const numId = Number(id);
  const r = byId[numId];
  if (!r) { console.log(`  #${id} NOT FOUND — will skip`); skipIds.add(numId); continue; }
  const got = r.x_meta_template_id;
  const ok = got === expected;
  console.log(`  #${id} x_meta_template_id="${got}" — expected="${expected}" — ${ok ? "OK" : "MISMATCH → skip"}`);
  if (!ok) skipIds.add(numId);
}

console.log("\nAPPLY labels:");
for (const id of ids) {
  const r = byId[id];
  if (!r) { console.log(`  #${id} not found — skip`); continue; }
  if (skipIds.has(id)) { console.log(`  #${id} skipped by sanity check`); continue; }
  const wanted = LABELS[id];
  if (r.x_label_ar === wanted) { console.log(`  #${id} already "${wanted}" — skip`); continue; }
  recordOp({model:"x_whatsapp_template",id,action:"write",before:{x_label_ar:r.x_label_ar},vals:{x_label_ar:wanted}});
  await call("x_whatsapp_template","write",{ids:[id],vals:{x_label_ar:wanted}});
  console.log(`  ✓ #${id} "${r.x_meta_template_id}" → "${wanted}"`);
}
