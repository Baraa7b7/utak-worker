// Item 2 — cancel the test vendor bill BILL/2026/09/0001 (if posted+unpaid).
// Also cancels the linked purchase.order (UTAK-DAILY tag for Ahmed today) if
// still confirmed. Nothing is deleted. Every mutation records a rollback
// entry to scripts/artifacts/cleanup-20260919-rollback.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
if (existsSync(rollbackPath)) {
  try { rollback = JSON.parse(readFileSync(rollbackPath, "utf8")); } catch {}
}
function record(op) { rollback.operations.push(op); writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2) + "\n"); }

// ---- BILL ----
const bills = await call("account.move", "search_read", {
  domain: [["name", "=", "BILL/2026/09/0001"]],
  fields: ["id","name","state","payment_state","move_type","invoice_origin","amount_total","currency_id","company_id","journal_id","partner_id","invoice_date","date","ref"],
});
console.log(`Found ${bills.length} bill(s):`);
for (const b of bills) console.log(`  ${JSON.stringify(b)}`);

if (bills.length === 0) {
  console.log("No bill with name BILL/2026/09/0001. Skipping.");
} else {
  const bill = bills[0];

  // Check for any reverse (credit-note) linked to this bill
  const reverses = await call("account.move", "search_read", {
    domain: [["reversed_entry_id", "=", bill.id]],
    fields: ["id","name","state"],
  });
  console.log(`  Reverses (credit notes): ${reverses.length}`);
  for (const r of reverses) console.log(`    ${JSON.stringify(r)}`);

  // Check for payments
  const payReconciles = await call("account.partial.reconcile", "search_count", {
    domain: ["|",
      ["debit_move_id.move_id", "=", bill.id],
      ["credit_move_id.move_id", "=", bill.id]],
  }).catch(() => 0);
  console.log(`  Reconciled payments (partial reconciles touching bill): ${payReconciles}`);

  if (bill.state === "posted" && (bill.payment_state === "not_paid" || bill.payment_state === "reversed")) {
    console.log(`  Bill is posted, unpaid. Draft + cancel.`);
    record({ ts: new Date().toISOString(), model: "account.move", id: bill.id, before: { state: bill.state, payment_state: bill.payment_state }, action: "button_draft,button_cancel" });
    await call("account.move", "button_draft", { ids: [bill.id] });
    await call("account.move", "button_cancel", { ids: [bill.id] });
    const after = (await call("account.move", "read", { ids: [bill.id], fields: ["id","name","state","payment_state"] }))[0];
    console.log(`  AFTER: ${JSON.stringify(after)}`);
  } else if (bill.state === "cancel") {
    console.log(`  Bill already cancelled. Skipping.`);
  } else if (bill.state === "draft") {
    console.log(`  Bill in draft; cancel it.`);
    record({ ts: new Date().toISOString(), model: "account.move", id: bill.id, before: { state: bill.state }, action: "button_cancel" });
    await call("account.move", "button_cancel", { ids: [bill.id] });
  } else {
    console.log(`  Bill state=${bill.state} payment_state=${bill.payment_state} — not cancelling.`);
  }
}

// ---- Purchase order UTAK-DAILY for Ahmed today ----
const today = "2026-09-19";
const AHMED = 30;
const startDay = `${today} 00:00:00`;
const endDay = `${today} 23:59:59`;
const pos = await call("purchase.order", "search_read", {
  domain: [
    ["partner_id", "=", AHMED],
    ["date_order", ">=", startDay],
    ["date_order", "<=", endDay],
    ["origin", "=", "UTAK-DAILY"],
  ],
  fields: ["id","name","state","invoice_status","invoice_ids"],
});
console.log(`\nUTAK-DAILY POs for Ahmed today: ${pos.length}`);
for (const po of pos) console.log(`  ${JSON.stringify(po)}`);

for (const po of pos) {
  if (po.state === "cancel") {
    console.log(`  PO id=${po.id} already cancelled`);
    continue;
  }
  if (po.state === "purchase" || po.state === "draft" || po.state === "sent") {
    console.log(`  Cancelling PO id=${po.id} (state=${po.state})`);
    record({ ts: new Date().toISOString(), model: "purchase.order", id: po.id, before: { state: po.state }, action: "button_cancel" });
    try {
      await call("purchase.order", "button_cancel", { ids: [po.id] });
    } catch (e) {
      console.log(`  cancel raised: ${e.message}`);
    }
    const after = (await call("purchase.order", "read", { ids: [po.id], fields: ["id","name","state"] }))[0];
    console.log(`  AFTER: ${JSON.stringify(after)}`);
  }
}

// ---- BILL number sequence ----
const seqs = await call("ir.sequence", "search_read", {
  domain: [["code", "in", ["account.move", "account.move.bill"]]],
  fields: ["id","name","code","prefix","padding","number_next_actual","implementation"],
});
console.log(`\nir.sequence rows for account.move* codes:`);
for (const s of seqs) console.log(`  ${JSON.stringify(s)}`);
// Try journal-specific date_range sequence
const journals = await call("account.journal", "search_read", {
  domain: [["type", "=", "purchase"]],
  fields: ["id","name","code","type","sequence_id"],
});
console.log(`\nPurchase journals: ${JSON.stringify(journals)}`);
