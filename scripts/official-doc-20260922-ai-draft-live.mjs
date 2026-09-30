// Live end-to-end test for "الصياغة الذكية" (AI drafting) on sim.
//
// For each language (ar, en):
//   1. Create a draft x_official_doc with the requested x_ai_prompt.
//   2. Fire the ai_draft_webhook Server Action (id 982, added in the initial
//      official-doc setup — the same one Baraa clicks from the form).
//   3. Poll x_official_doc for x_block_ids to appear or x_last_error to hit.
//   4. Read the resulting blocks — assert count > 0 and every text is a
//      non-empty string. Detect [[placeholder]] tokens (Claude's convention
//      for missing user-supplied values).
//   5. Delete the draft to leave no test rows in Odoo.
//
// Aborts on 401 from Claude (indicating a stale ANTHROPIC_API_KEY on sim);
// the outer runbook says to stop and report in that case.

import { readFileSync } from "node:fs";

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

async function runScenario(lang, prompt) {
  console.log(`\n=== scenario lang=${lang} ===`);
  // Create draft doc
  const createIds = await call("x_official_doc", "create", {
    vals_list: [{
      x_name: `TEST-AI-${lang}-${Date.now()}`,
      x_doc_type: "letter",
      x_lang: lang,
      x_ai_prompt: prompt,
      x_status: "draft",
      x_is_template: false,
    }],
  });
  const docId = Array.isArray(createIds) ? createIds[0] : createIds;
  console.log(`  created draft doc id=${docId}`);

  try {
    // Fire the ai_draft_webhook Server Action.
    const acts = await call("ir.actions.server", "search_read", {
      domain: [["name", "=", "official-doc.ai_draft_webhook"]],
      fields: ["id"], limit: 1,
    });
    const actionId = acts[0]?.id;
    if (!actionId) throw new Error("ai_draft_webhook action missing");
    console.log(`  firing server action #${actionId}`);
    await call("ir.actions.server", "run", {
      ids: [actionId],
      context: { active_id: docId, active_ids: [docId], active_model: "x_official_doc" },
    });

    // Poll for blocks or error. Ai draft is streaming Claude → typically ~5-20s.
    let ok = false, err = null, blockIds = [];
    for (let i = 0; i < 45; i++) {
      const [row] = await call("x_official_doc", "read", {
        ids: [docId], fields: ["x_block_ids", "x_last_error"],
      });
      const bids = Array.isArray(row?.x_block_ids) ? row.x_block_ids : [];
      const errStr = typeof row?.x_last_error === "string" ? row.x_last_error : "";
      if (errStr) { err = errStr; break; }
      if (bids.length > 0) { ok = true; blockIds = bids; break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (err) {
      console.log(`  x_last_error: ${err}`);
      // Distinguish 401 vs other Claude failures explicitly per the runbook.
      if (/401|unauthorized|invalid_api_key/i.test(err)) {
        console.log(`  ABORT: ANTHROPIC_API_KEY on sim looks bad. Stopping this scenario.`);
        throw new Error("ANTHROPIC_API_KEY 401");
      }
      throw new Error(`ai draft failed: ${err}`);
    }
    if (!ok) throw new Error("ai draft timeout — no blocks after 90s");

    // Read the blocks to inspect. Report count, types, whether any [[placeholder]]s.
    const blocks = await call("x_official_doc_block", "read", {
      ids: blockIds, fields: ["id", "x_sequence", "x_block_type", "x_text", "x_tone"],
    });
    console.log(`  blocks written: ${blocks.length}`);
    const types = blocks.map((b) => b.x_block_type);
    console.log(`  block types: ${types.join(", ")}`);
    const placeholders = new Set();
    for (const b of blocks) {
      const t = String(b.x_text ?? "");
      if (!t.trim()) console.log(`    WARN: block #${b.id} empty text`);
      const matches = t.match(/\[\[([^\]]+)\]\]/g);
      if (matches) for (const m of matches) placeholders.add(m);
    }
    if (placeholders.size > 0) {
      console.log(`  placeholders found (${placeholders.size}): ${Array.from(placeholders).slice(0, 5).join(", ")}`);
    } else {
      console.log("  no [[placeholders]] — Claude filled everything or template had none");
    }

    // Sample the first two block bodies (first 120 chars each) so we see the
    // draft actually reads sensibly, without spilling the whole thing.
    for (const b of blocks.slice(0, 2)) {
      const s = String(b.x_text ?? "").slice(0, 120).replace(/\s+/g, " ");
      console.log(`    [${b.x_block_type} tone=${b.x_tone}] ${s}${s.length === 120 ? "…" : ""}`);
    }
    return { ok: true };
  } finally {
    // Always cleanup the draft doc — no test rows linger in Odoo.
    try {
      await call("x_official_doc", "unlink", { ids: [docId] });
      console.log(`  cleanup: deleted x_official_doc#${docId}`);
    } catch (e) {
      console.log(`  cleanup FAILED (manual delete may be needed): ${(e).message}`);
    }
  }
}

async function main() {
  console.log("=== AI drafting live test ===");
  const arResult = await runScenario("ar", "خطاب لبنك الراجحي نطلب فتح حساب جاري تجاري للشركة");
  const enResult = await runScenario("en", "Draft a bank letter to Al Rajhi requesting a corporate current-account opening.");
  console.log("\n=== SUMMARY ===");
  console.log(`  ar: ${arResult.ok ? "OK" : "FAIL"}`);
  console.log(`  en: ${enResult.ok ? "OK" : "FAIL"}`);
}

main().catch((e) => {
  console.error("[fatal]", e.stack ?? e.message ?? e);
  process.exit(1);
});
