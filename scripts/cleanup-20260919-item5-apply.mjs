// Item 5 apply — add x_type "piece" (حبة), extend Automation 8, set rows 35 & 41.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath,"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const {ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY}=env;
let auth={mode:"apikey",cookie:null};
async function ses(){const r=await fetch(`${ODOO_URL}/web/session/authenticate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",params:{db:ODOO_DB,login:ODOO_LOGIN,password:ODOO_API_KEY}})});const m=(r.headers.get("set-cookie")??"").match(/session_id=([^;]+)/);if(!m)throw new Error("ses");auth={mode:"session",cookie:`session_id=${m[1]}`};}
async function call(m,met,b){const h={"Content-Type":"application/json"};if(auth.mode==="apikey")h["Authorization"]=`Bearer ${ODOO_API_KEY}`;else h["Cookie"]=auth.cookie;const r=await fetch(`${ODOO_URL}/json/2/${m}/${met}`,{method:"POST",headers:h,body:JSON.stringify(b)});const t=await r.text();let p;try{p=JSON.parse(t);}catch{p=t;}if(!r.ok){if(r.status===401&&auth.mode==="apikey"){await ses();return call(m,met,b);}throw new Error(`HTTP ${r.status} ${m}.${met}: ${p?.data?.message??t.slice(0,300)}`);}return p;}

const rollbackPath = new URL("./artifacts/cleanup-20260919-rollback.json", import.meta.url).pathname;
mkdirSync(dirname(rollbackPath), { recursive: true });
let rollback = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rollbackPath)) { try { rollback = JSON.parse(readFileSync(rollbackPath, "utf8")); } catch {} }
function record(op) { rollback.operations.push(op); writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2) + "\n"); }

// ---- 1. Add piece → "حبة" to selection_ids on ir.model.fields id=20157 ----
const existing = await call("ir.model.fields.selection", "search_read", {
  domain: [["field_id","=",20157],["value","=","piece"]],
  fields: ["id","name","value","sequence"],
});
let pieceSelId;
if (existing.length > 0) {
  pieceSelId = existing[0].id;
  console.log(`piece selection already exists: id=${pieceSelId}`);
} else {
  const ids = await call("ir.model.fields.selection","create",{
    vals_list: [{ field_id: 20157, value: "piece", name: "حبة", sequence: 25 }],
  });
  pieceSelId = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model:"ir.model.fields.selection", id: pieceSelId, before: null, action:"create" });
  console.log(`created piece selection: id=${pieceSelId}`);
}

// ---- 2. Update ir.actions.server id=972 (Automation 8) code to add piece ----
const act972Before = (await call("ir.actions.server","read",{ids:[972],fields:["id","name","code"]}))[0];
const NEW_CODE = "labels = {'carton': 'كرتون', 'bag': 'جرم', 'foam': 'فلين'}\n" +
  "for r in records:\n" +
  "    t = r.x_type\n" +
  "    if not t:\n" +
  "        continue\n" +
  "    if t == 'loose':\n" +
  "        new_name = 'فرط (بالكيلو)'\n" +
  "    elif t == 'piece':\n" +
  "        new_name = 'حبة (بالحبة)'\n" +
  "    else:\n" +
  "        label = labels.get(t, '')\n" +
  "        w = r.x_approx_weight_kg or 0\n" +
  "        if w and w > 0:\n" +
  "            wf = float(w)\n" +
  "            if wf == int(wf):\n" +
  "                w_txt = str(int(wf))\n" +
  "            else:\n" +
  "                w_txt = ('%f' % wf).rstrip('0').rstrip('.')\n" +
  "            new_name = label + ' · ' + w_txt + ' كيلو'\n" +
  "        else:\n" +
  "            new_name = label\n" +
  "    if r.x_name != new_name:\n" +
  "        r.write({'x_name': new_name})";
if (act972Before.code !== NEW_CODE) {
  record({ ts: new Date().toISOString(), model:"ir.actions.server", id: 972, before: { code: act972Before.code }, action:"write" });
  await call("ir.actions.server","write",{ids:[972],vals:{ code: NEW_CODE }});
  console.log(`updated ir.actions.server id=972 (Automation 8)`);
} else {
  console.log(`ir.actions.server id=972 already up-to-date`);
}

// ---- 3. Row 35: x_type=bag (weight already 15) ----
const row35 = (await call("x_product_packaging","read",{ids:[35],fields:["id","x_name","x_type","x_approx_weight_kg","x_is_default"]}))[0];
console.log(`\nrow 35 BEFORE: ${JSON.stringify(row35)}`);
if (row35.x_type !== "bag") {
  record({ ts: new Date().toISOString(), model:"x_product_packaging", id: 35, before: { x_type: row35.x_type, x_name: row35.x_name }, action:"write" });
  await call("x_product_packaging","write",{ids:[35],vals:{ x_type: "bag" }});
  console.log(`  wrote x_type=bag`);
}
const row35After = (await call("x_product_packaging","read",{ids:[35],fields:["id","x_name","x_type","x_approx_weight_kg","x_is_default"]}))[0];
console.log(`row 35 AFTER: ${JSON.stringify(row35After)}`);

// ---- 4. Row 41 (بطيخ حبة): x_type=piece, weight=false, is_default=True ----
const row41 = (await call("x_product_packaging","read",{ids:[41],fields:["id","x_name","x_type","x_approx_weight_kg","x_is_default","x_product_tmpl_id"]}))[0];
console.log(`\nrow 41 BEFORE: ${JSON.stringify(row41)}`);
record({ ts: new Date().toISOString(), model:"x_product_packaging", id: 41, before: { x_type: row41.x_type, x_name: row41.x_name, x_approx_weight_kg: row41.x_approx_weight_kg, x_is_default: row41.x_is_default }, action:"write" });
await call("x_product_packaging","write",{ids:[41],vals:{ x_type: "piece", x_approx_weight_kg: false, x_is_default: true }});
console.log(`  wrote x_type=piece x_approx_weight_kg=False x_is_default=True`);

const row41After = (await call("x_product_packaging","read",{ids:[41],fields:["id","x_name","x_type","x_approx_weight_kg","x_is_default"]}))[0];
console.log(`row 41 AFTER: ${JSON.stringify(row41After)}`);

// Verify Automation 9 turned off other defaults for watermelon
const wm = row41.x_product_tmpl_id[0];
const all = await call("x_product_packaging","search_read",{
  domain: [["x_product_tmpl_id","=",wm]],
  fields: ["id","x_name","x_type","x_approx_weight_kg","x_is_default"],
  order: "x_sequence, id",
});
console.log(`\nAll watermelon packagings AFTER:`);
for (const p of all) console.log(`  id=${p.id} x_name=${p.x_name} type=${p.x_type} w=${p.x_approx_weight_kg} default=${p.x_is_default}`);
const defaults = all.filter(p => p.x_is_default);
if (defaults.length === 1 && defaults[0].id === 41) {
  console.log(`\nOK — Automation 9 turned off the other watermelon defaults; id=41 is the sole default.`);
} else {
  console.log(`\nWARN — expected 1 default (id=41), got ${defaults.length}: ${defaults.map(d=>d.id).join(",")}`);
}
