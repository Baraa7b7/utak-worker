// 2026-09-20 — Verify token acceptance on the sim Worker for every route each
// server action calls. Read-only w.r.t. Odoo and w.r.t. Worker side-effects:
// every POST body is `{}` so the Worker returns 400 before any writeUntil
// fires. Every GET uses id=0 so the Worker returns 404 before rendering.
//
// The one route that CANNOT be safely probed like this is
// /odoo/hook/wa-template-sync — it has no body validation and would trigger a
// real Meta+Odoo sync as soon as auth passes. We mark it "not tested" and
// rely on shared-secret transitivity (action 979 uses the same HOOK token and
// is known to work).
//
// Tokens read from local files, printed only as last-4.
//   HOOK      → extracted from ir.actions.server 979's webhook_url (read here)
//   INTERNAL  → ~/utak-internal-sim-token.txt (mode 600)
//   SALE_PDF  → extracted from ir.actions.server 971's code (read here)

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const envPath = new URL("../.env.sim-verify", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY } = env;

let auth = { mode: "apikey", cookie: null };
async function session() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", params: { db: ODOO_DB, login: ODOO_LOGIN, password: ODOO_API_KEY } }),
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
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    if (res.status === 401 && auth.mode === "apikey") { await session(); return call(model, method, body); }
    throw new Error(`HTTP ${res.status} on ${model}.${method}: ${parsed?.data?.message ?? text.slice(0, 400)}`);
  }
  return parsed;
}

const SIM_HOST = "utak-worker-sim.utak-business.workers.dev";

function last4(s) { return typeof s === "string" && s ? s.slice(-4) : ""; }

function extractQueryToken(url) {
  const m = /[?&]token=([^&#]+)/.exec(url || "");
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}
function extractCodeToken(code) {
  // Pattern used in actions 971/974/975:
  //   '...&token=<literal>'
  const m = /token=([^\s"'`&]+)/.exec(code || "");
  if (!m) return "";
  return m[1];
}

async function probe(method, path, token, isPdfRoute) {
  const url = `https://${SIM_HOST}${path}?token=${encodeURIComponent(token)}${isPdfRoute ? "&id=0" : ""}`;
  const init = { method, headers: {} };
  if (method === "POST") {
    init.headers["Content-Type"] = "application/json";
    init.body = "{}";
  }
  const res = await fetch(url, init);
  const bodyText = await res.text().catch(() => "");
  const status = res.status;
  // Under the task's rule: 401/403 → REJECTED; anything else with no side effect → ACCEPTED.
  const accepted = status !== 401 && status !== 403;
  return { status, accepted, snippet: bodyText.slice(0, 200) };
}

async function main() {
  const stamp = new Date().toISOString();
  console.log(`Verify tokens on ${SIM_HOST} — ${stamp}\n`);

  // ---- Load tokens ----
  const internalPath = join(homedir(), "utak-internal-sim-token.txt");
  if (!existsSync(internalPath)) throw new Error(`${internalPath} missing — cannot verify INTERNAL`);
  const INTERNAL = readFileSync(internalPath, "utf8").trim();

  // Read HOOK from action 979
  const act979 = (await call("ir.actions.server", "read", { ids: [979], fields: ["id", "name", "webhook_url"] }))[0];
  const HOOK = extractQueryToken(act979?.webhook_url || "");
  if (!HOOK) throw new Error("could not extract HOOK from action 979 webhook_url");

  // Read SALE_PDF from action 971's code
  const act971 = (await call("ir.actions.server", "read", { ids: [971], fields: ["id", "name", "code"] }))[0];
  const SALE_PDF = extractCodeToken(act971?.code || "");
  if (!SALE_PDF) throw new Error("could not extract SALE_PDF token from action 971 code");

  console.log(`INTERNAL last4: ${last4(INTERNAL)}`);
  console.log(`HOOK     last4: ${last4(HOOK)}`);
  console.log(`SALE_PDF last4: ${last4(SALE_PDF)}`);
  console.log();

  // ---- Probes ----
  const cases = [
    // Route, expected secret, token to test, isPdf
    { m: "POST", path: "/internal/quotation-issue",         needs: "INTERNAL", tok: INTERNAL, pdf: false },
    { m: "POST", path: "/internal/receipt-issue",           needs: "INTERNAL", tok: INTERNAL, pdf: false },
    { m: "POST", path: "/internal/quotation-wa-send",       needs: "HOOK",     tok: HOOK,     pdf: false },
    { m: "POST", path: "/internal/sale-quotation-wa-send",  needs: "HOOK",     tok: HOOK,     pdf: false },
    { m: "POST", path: "/odoo/hook/wa-inbox",               needs: "HOOK",     tok: HOOK,     pdf: false },
    { m: "POST", path: "/odoo/hook/wa",                     needs: "HOOK",     tok: HOOK,     pdf: false },
    // /odoo/hook/wa-template-sync is UNTESTED (no body validation → real sync)
    { m: "GET",  path: "/internal/sale-quotation-pdf",      needs: "SALE_PDF", tok: SALE_PDF, pdf: true  },
    { m: "GET",  path: "/internal/invoice-pdf",             needs: "SALE_PDF", tok: SALE_PDF, pdf: true  },
    { m: "GET",  path: "/internal/purchase-order-pdf",      needs: "SALE_PDF", tok: SALE_PDF, pdf: true  },
  ];

  console.log("route                                            method needs     tokenLast4 status accepted body-snippet");
  console.log("--------------------------------------------------------------------------------------------------");
  const results = [];
  for (const c of cases) {
    const r = await probe(c.m, c.path, c.tok, c.pdf);
    results.push({ ...c, ...r });
    console.log(
      c.path.padEnd(48),
      c.m.padEnd(6),
      c.needs.padEnd(9),
      (last4(c.tok) || "-").padEnd(10),
      String(r.status).padEnd(6),
      String(r.accepted).padEnd(8),
      r.snippet,
    );
  }
  console.log();
  console.log("NOT TESTED: POST /odoo/hook/wa-template-sync — no body validation, would trigger real sync.");
  console.log();

  // Also probe with a WRONG token for one path per secret, to prove that
  // the 401 path DOES fire when we expect it. This makes accepted=true
  // meaningful even when the accepted response is 404 or 400.
  console.log("Negative controls (wrong token → 401 expected, 404 for PDF routes):");
  const negs = [
    { m: "POST", path: "/internal/quotation-issue",         pdf: false },
    { m: "POST", path: "/odoo/hook/wa-inbox",               pdf: false },
    { m: "GET",  path: "/internal/sale-quotation-pdf",      pdf: true  },
  ];
  for (const n of negs) {
    const r = await probe(n.m, n.path, "definitely-wrong-token-xxxxxxxxxx", n.pdf);
    console.log(
      n.path.padEnd(48),
      n.m.padEnd(6),
      "WRONG    ",
      "----      ",
      String(r.status).padEnd(6),
      "",
      r.snippet,
    );
  }
}
main().catch((e) => { console.error("VERIFY FAILED:", e); process.exit(1); });
