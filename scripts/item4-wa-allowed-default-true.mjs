// item4 (2026-09-18) — flip x_wa_allowed to true for everyone.
//
// Two independent changes wrapped in one idempotent script:
//
//   (a) Default for NEW partners becomes True — regardless of
//       customer_rank / supplier_rank / partner type. Implemented as a
//       single ir.default row (field_id=<x_wa_allowed>, json_value="true",
//       user_id/company_id/condition all False) so Odoo's create() applies
//       it whenever the field is not passed explicitly. To roll back the
//       default to False later: delete that ir.default row, or write
//       json_value="false" on it.
//
//   (b) BULK enable on every existing res.partner (active=true AND archived
//       included; suppliers, customers, employees, drivers, everything).
//       The only exclusion is Baraa's number +966505154962 — its row keeps
//       whatever value it already has. Owner-guard in fetchMeta stays
//       non-bypassable regardless.
//
// KV cache: `wa_allowed:<+E164>` in MSG_DEDUP has a 60-second TTL. This
// script does not touch KV — cached "false" entries roll off within a
// minute. Callers hitting Odoo after that see the fresh true.

import { readFileSync } from "node:fs";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

const BARAA_NUMBER = "+966505154962";

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY },
    }),
  });
  const m = res.headers.get("set-cookie")?.match(/session_id=([^;]+)/);
  if (!m) throw new Error("session auth failed");
  auth = { mode: "session", cookie: `session_id=${m[1]}` };
}

async function call(model, method, body) {
  const url = `${ODOO_URL}/json/2/${model}/${method}`;
  const headers = { "Content-Type": "application/json" };
  if (auth.mode === "apikey") headers["Authorization"] = `Bearer ${ODOO_API_KEY}`;
  if (auth.mode === "session") headers["Cookie"] = auth.cookie;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") {
      await session();
      return call(model, method, body);
    }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${
      parsed?.data?.message ?? text.slice(0, 400)
    }`);
  }
  return parsed;
}

async function xWaAllowedFieldId() {
  const rows = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "res.partner"], ["name", "=", "x_wa_allowed"]],
    fields: ["id"],
    limit: 1,
  });
  const id = rows[0]?.id;
  if (!id) throw new Error("x_wa_allowed field not found on res.partner");
  return id;
}

// (a) Set the field default to True via ir.default. Idempotent: we look
// for an existing global default row (no user_id / company_id / condition)
// and update it, else create one.
async function ensureDefaultTrue(fieldId) {
  const existing = await call("ir.default", "search_read", {
    domain: [
      ["field_id", "=", fieldId],
      ["user_id", "=", false],
      ["company_id", "=", false],
      ["condition", "=", false],
    ],
    fields: ["id", "json_value"],
    limit: 1,
  });
  if (existing[0]) {
    if (existing[0].json_value === "true") {
      return { id: existing[0].id, action: "unchanged" };
    }
    await call("ir.default", "write", {
      ids: [existing[0].id],
      vals: { json_value: "true" },
    });
    return { id: existing[0].id, action: "updated" };
  }
  const ids = await call("ir.default", "create", {
    vals_list: [{ field_id: fieldId, json_value: "true" }],
  });
  return { id: ids[0], action: "created" };
}

// (b) Bulk enable x_wa_allowed on every existing partner, excluding Baraa.
// active=false rows are included via the active_test=false context.
async function bulkEnable() {
  const baraaRows = await call("res.partner", "search_read", {
    domain: [
      "|",
      ["x_whatsapp_number", "=", BARAA_NUMBER],
      ["phone", "=", BARAA_NUMBER],
    ],
    fields: ["id", "name", "x_whatsapp_number", "phone", "x_wa_allowed"],
    limit: 100,
    context: { active_test: false },
  });
  const baraaIds = baraaRows.map((r) => r.id);

  const targetIds = await call("res.partner", "search", {
    domain: [
      ["x_wa_allowed", "=", false],
      "!", ["id", "in", baraaIds],
    ],
    context: { active_test: false },
  });

  const before = await call("res.partner", "search_read", {
    domain: [["id", "in", targetIds]],
    fields: ["id", "customer_rank", "supplier_rank", "is_company", "employee", "active"],
    limit: targetIds.length || 1,
    context: { active_test: false },
  });

  const dist = {
    customers: 0,
    suppliers: 0,
    employees: 0,
    other: 0,
    archived: 0,
    companies: 0,
  };
  for (const r of before) {
    if (!r.active) dist.archived++;
    if (r.is_company) dist.companies++;
    if (r.customer_rank && r.customer_rank > 0) dist.customers++;
    else if (r.supplier_rank && r.supplier_rank > 0) dist.suppliers++;
    else if (r.employee) dist.employees++;
    else dist.other++;
  }

  // Batch writes to keep payloads reasonable. Odoo write() on a list of
  // ids is one UPDATE regardless of batch size, but we split just to keep
  // JSON bodies below the JSON-RPC size guardrails.
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < targetIds.length; i += BATCH) {
    const chunk = targetIds.slice(i, i + BATCH);
    await call("res.partner", "write", {
      ids: chunk,
      vals: { x_wa_allowed: true },
      context: { active_test: false },
    });
    written += chunk.length;
  }

  return { baraaRows, targetIds, distribution: dist, written };
}

// --- verification helpers ---

async function readWaAllowed(id) {
  const rows = await call("res.partner", "read", {
    ids: [id],
    fields: ["id", "name", "x_wa_allowed"],
    context: { active_test: false },
  });
  return rows[0];
}

async function totals() {
  const yes = await call("res.partner", "search_count", {
    domain: [["x_wa_allowed", "=", true]],
    context: { active_test: false },
  });
  const no = await call("res.partner", "search_count", {
    domain: [["x_wa_allowed", "=", false]],
    context: { active_test: false },
  });
  return { yes, no };
}

async function verifyDefaultForNew() {
  // (i) A brand-new contact with no rank, no company, no employee — the
  // hardest case (customer_rank stays 0, supplier_rank stays 0). Expected:
  // x_wa_allowed comes out true from the ir.default.
  const idsNoRank = await call("res.partner", "create", {
    vals_list: [{
      name: "UTAK verify no-rank " + Date.now(),
    }],
  });
  const idNoRank = idsNoRank[0];
  const noRankRow = await readWaAllowed(idNoRank);

  // (ii) A supplier contact — supplier_rank>0 branch. Expected: still true.
  const idsSupplier = await call("res.partner", "create", {
    vals_list: [{
      name: "UTAK verify supplier " + Date.now(),
      supplier_rank: 1,
    }],
  });
  const idSupplier = idsSupplier[0];
  const supplierRow = await readWaAllowed(idSupplier);

  // Clean up both.
  await call("res.partner", "unlink", { ids: [idNoRank, idSupplier] });

  return { noRankRow, supplierRow };
}

async function findKnownPartner(nameFragment) {
  const rows = await call("res.partner", "search_read", {
    domain: [["name", "ilike", nameFragment]],
    fields: ["id", "name", "x_wa_allowed"],
    limit: 5,
    context: { active_test: false },
  });
  return rows;
}

async function main() {
  console.log("[item4] default-true + bulk enable — starting");
  const fieldId = await xWaAllowedFieldId();
  console.log("[x_wa_allowed field_id]", fieldId);

  const def = await ensureDefaultTrue(fieldId);
  console.log("[ir.default]", def);

  const bulk = await bulkEnable();
  console.log("[bulk] rows written:", bulk.written);
  console.log("[bulk] distribution:", bulk.distribution);
  console.log("[bulk] Baraa rows skipped:",
    bulk.baraaRows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      x_whatsapp_number: r.x_whatsapp_number,
      x_wa_allowed: r.x_wa_allowed,
    })),
  );

  const t = await totals();
  console.log("[totals] enabled:", t.yes, "disabled:", t.no);

  const ver = await verifyDefaultForNew();
  console.log("[verify new no-rank]", ver.noRankRow);
  console.log("[verify new supplier]", ver.supplierRow);

  // Known partners requested in the spec.
  const ahmad = await readWaAllowed(30);
  const omar = await readWaAllowed(9);
  console.log("[known] Ahmad Hassan id=30 ->", ahmad);
  console.log("[known] Omar id=9 ->", omar);
  const othmanCandidates = await findKnownPartner("عثمان");
  console.log("[known] عثمان matches ->", othmanCandidates);
  const othmanCandidatesLatin = await findKnownPartner("Othman");
  if (othmanCandidatesLatin.length) {
    console.log("[known] Othman (latin) ->", othmanCandidatesLatin);
  }

  console.log("\n--- summary ---");
  console.log(JSON.stringify({
    ir_default: def,
    bulk_written: bulk.written,
    distribution: bulk.distribution,
    baraa_ids_skipped: bulk.baraaRows.map((r) => r.id),
    baraa_values: bulk.baraaRows.map((r) => r.x_wa_allowed),
    totals: t,
    verify_new_no_rank: ver.noRankRow,
    verify_new_supplier: ver.supplierRow,
    ahmad_hassan_30: ahmad,
    omar_9: omar,
    othman_matches: othmanCandidates.concat(othmanCandidatesLatin),
  }, null, 2));
}

main().catch((e) => {
  console.error("ITEM 4 DEFAULT-TRUE MIGRATION FAILED:", e);
  process.exit(1);
});
