// Official-doc 2026-09-22 — English mirrors of the 4 canonical templates.
//   1. Bank Letter — General Request
//   2. Certificate / To Whom It May Concern
//   3. Authorization
//   4. Estimated Income Statement (identical numbers/structure to the ar
//      version so bilingual customers get an apples-to-apples view).
//
// Each template lives as x_official_doc(x_is_template=True, x_status='draft',
// x_lang='en'). Duplicating a template yields a fresh English draft.
//
// Idempotent by x_template_name — reruns skip templates that already exist.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
  });
  const m = (res.headers.get("set-cookie") ?? "").match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}
async function call(model, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  else headers["Cookie"] = auth.cookie;
  const res = await fetch(`${ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const rbPath = new URL("./artifacts/official-docs-created.json", import.meta.url).pathname;
mkdirSync(dirname(rbPath), { recursive: true });
let rb = { generated_at: new Date().toISOString(), operations: [] };
if (existsSync(rbPath)) { try { rb = JSON.parse(readFileSync(rbPath, "utf8")); } catch {} }
function record(op) { rb.operations.push(op); writeFileSync(rbPath, JSON.stringify(rb, null, 2) + "\n"); }

const TODAY_ISO = new Date().toISOString().slice(0, 10);

const T_BANK_EN = {
  x_template_name: "Bank Letter — General Request",
  x_doc_type: "letter",
  x_recipient_label: "To",
  x_recipient: "[Bank Name]",
  x_subject: "[Letter Subject]",
  blocks: [
    { seq: 10, type: "heading", tone: "neutral", text: "Official Letter" },
    { seq: 20, type: "paragraph", tone: "neutral",
      text: "Dear Sir/Madam,\nWith reference to [reference if any], we, [Company Name], hereby request [specific request].\nOur company details are set out below; further supporting documents can be provided upon request." },
    { seq: 30, type: "kv_card", tone: "neutral",
      text: "Legal Name: [read from company data]\nCommercial Registration: [read from company data]\nVAT No.: [read from company data]\nAddress: [read from company data]\nContact: [Name]\nMobile: [Number]" },
    { seq: 40, type: "paragraph", tone: "neutral",
      text: "We appreciate your kind cooperation and remain at your disposal for any further information." },
    { seq: 50, type: "signature", tone: "neutral",
      text: "Baraa Alwesabi\nManaging Director" },
  ],
};

const T_CERT_EN = {
  x_template_name: "Certificate — To Whom It May Concern",
  x_doc_type: "certificate",
  x_recipient_label: "To Whom It May Concern",
  x_recipient: "",
  x_subject: "Certificate of Employment / Reference",
  blocks: [
    { seq: 10, type: "heading", tone: "neutral", text: "Certificate" },
    { seq: 20, type: "paragraph", tone: "neutral",
      text: "This is to certify that [Name] has been employed at [Company Name] as [Position] since [Date], and that their record with the company is documented in our administrative files.\nThis certificate is issued at their request for use in [purpose], with no liability incumbent upon the company." },
    { seq: 30, type: "kv_card", tone: "neutral",
      text: "Legal Name: [read from company data]\nCommercial Registration: [read from company data]\nAddress: [read from company data]" },
    { seq: 40, type: "signature", tone: "neutral",
      text: "Baraa Alwesabi\nManaging Director" },
  ],
};

const T_AUTH_EN = {
  x_template_name: "Authorization",
  x_doc_type: "authorization",
  x_recipient_label: "To",
  x_recipient: "[Recipient Entity]",
  x_subject: "Authorization",
  blocks: [
    { seq: 10, type: "heading", tone: "neutral", text: "Official Authorization" },
    { seq: 20, type: "paragraph", tone: "neutral",
      text: "We, [Company Name], hereby authorize Mr./Ms. [Authorized Person Name] — ID No. [ID Number] — to act on our behalf in [scope of authorization], effective from [start date] until [end date]." },
    { seq: 30, type: "kv_card", tone: "neutral",
      text: "Authorized Person: [Name]\nID Number: [Number]\nRole: [Role]\nRelationship to Company: [Relationship]" },
    { seq: 40, type: "notes", tone: "warning",
      text: "This authorization is strictly limited to the scope above and does not extend to any other action.\nThe authorization terminates on its end date or by written notice from the company.\nDelegating this authorization to a third party is prohibited without written consent from the company." },
    { seq: 50, type: "signature", tone: "neutral",
      text: "Baraa Alwesabi\nManaging Director" },
  ],
};

// Same numbers and structure as the Arabic income statement — this is the
// English mirror. Table cells are labels/monthly/annual in the same rows.
const T_STATEMENT_EN = {
  x_template_name: "Estimated Income Statement",
  x_doc_type: "statement",
  x_recipient_label: "To",
  x_recipient: "",
  x_subject: "Estimated Income Statement — First 12 Months from VAT Registration",
  blocks: [
    { seq: 10, type: "heading", tone: "neutral", text: "Estimated Income Statement" },
    { seq: 20, type: "badge", tone: "warning",
      text: "Estimated — First 12 months from VAT registration" },
    { seq: 30, type: "table", tone: "neutral",
      text: [
        "Item | Monthly (SAR) | Annual (SAR)",
        "Sales | 40,000 | 480,000",
        "Cost of Sales | 30,000 | 360,000",
        "= Gross Profit | 10,000 | 120,000",
        "Salaries | 8,000 | 96,000",
        "Transport & Delivery | 3,000 | 36,000",
        "Rent | 1,000 | 12,000",
        "Government Fees | 833 | 10,000",
        "Packaging & Materials | 800 | 9,600",
        "Systems & Communications | 500 | 6,000",
        "Marketing | 500 | 6,000",
        "Other Expenses | 400 | 4,800",
        "= Total Operating Expenses | 15,033 | 180,400",
      ].join("\n") },
    { seq: 40, type: "highlight_row", tone: "warning",
      text: "Projected Net Profit / (Loss) | (5,033) | (60,400)" },
    { seq: 50, type: "notes", tone: "neutral",
      text: [
        "Figures are projections based on the company plan for the first twelve months after VAT registration.",
        "Sales reflect the average expected orders through UTAK's B2B channels for fresh-produce distribution.",
        "Cost of sales includes product purchases from suppliers plus an initial operating margin.",
        "Operating expenses are estimated; actual figures may vary with growth and operational needs.",
        "The projected net loss is typical of the launch phase and reflects investment in operational infrastructure.",
      ].join("\n") },
  ],
};

async function findTemplate(templateName) {
  const rows = await call("x_official_doc", "search_read", {
    domain: [["x_is_template", "=", true], ["x_template_name", "=", templateName]],
    fields: ["id"], limit: 1,
  });
  return rows[0]?.id ?? null;
}

async function seedTemplate(t) {
  const existing = await findTemplate(t.x_template_name);
  if (existing) {
    console.log(`[seed] ${t.x_template_name} exists id=${existing} — skipping`);
    return existing;
  }
  const ids = await call("x_official_doc", "create", { vals_list: [{
    x_is_template: true,
    x_template_name: t.x_template_name,
    x_doc_type: t.x_doc_type,
    x_recipient_label: t.x_recipient_label,
    x_recipient: t.x_recipient,
    x_subject: t.x_subject,
    x_date: TODAY_ISO,
    x_status: "draft",
    x_lang: "en",
  }] });
  const id = Array.isArray(ids) ? ids[0] : ids;
  record({ ts: new Date().toISOString(), model: "x_official_doc", id, name: `template-en:${t.x_template_name}`, action: "create" });
  console.log(`[seed] created template ${t.x_template_name} id=${id}`);
  const blockRows = t.blocks.map((b) => ({
    x_doc_id: id,
    x_sequence: b.seq,
    x_block_type: b.type,
    x_text: b.text,
    x_tone: b.tone,
    x_align_numbers: true,
  }));
  const blockIds = await call("x_official_doc_block", "create", { vals_list: blockRows });
  const blockIdsArr = Array.isArray(blockIds) ? blockIds : [blockIds];
  for (const bid of blockIdsArr) {
    record({ ts: new Date().toISOString(), model: "x_official_doc_block", id: bid, name: `template-en:${t.x_template_name}:block`, action: "create" });
  }
  console.log(`[seed]   + ${blockIdsArr.length} blocks`);
  return id;
}

async function main() {
  await seedTemplate(T_BANK_EN);
  await seedTemplate(T_CERT_EN);
  await seedTemplate(T_AUTH_EN);
  await seedTemplate(T_STATEMENT_EN);
  console.log("\n[seed] done.");
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
