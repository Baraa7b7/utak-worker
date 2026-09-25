// Unit tests for src/accounting.ts — proves:
//   1. buildInvoiceLineCommands: no tax, right qty/price, product_id mapping
//   2. journalIdForMethod: cash → CSHD, transfer → BNK1
//   3. syncInvoiceToAccounting: idempotent (skips when existingMoveId set)
//   4. syncInvoiceToAccounting: gated on ACCOUNTING_SYNC (no-op when off)
//   5. syncPaymentToAccounting: skips when invoiceMoveId missing (legacy)
//   6. Accounting failure is contained — never throws to caller
//
// Runs directly under Node's --experimental-strip-types loader. No
// framework; every assertion prints ✓ / ✗ and process exits non-zero on
// any failure.

import {
  isAccountingSyncEnabled,
  buildInvoiceLineCommands,
  journalIdForMethod,
  syncInvoiceToAccounting,
  syncPaymentToAccounting,
  todayRiyadhYmd,
  extractPaymentIdFromAction,
  buildPaymentSearchDomain,
  evaluatePaymentGuard,
  evaluateInvoiceGuard,
} from "../src/accounting.ts";

// ---------- fetch mock ----------
interface CapturedRequest {
  url: string;
  method: string;
  body: any;
}
let captured: CapturedRequest[] = [];
type Responder = (req: CapturedRequest) => any;
let responder: Responder = () => true;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const bodyText = init?.body ?? "";
  let body: any = null;
  try { body = typeof bodyText === "string" ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
  const req: CapturedRequest = { url, method: init?.method ?? "GET", body };
  captured.push(req);
  const payload = responder(req);
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof globalThis.fetch;

function makeEnv(overrides: Record<string, string | undefined> = {}): any {
  return {
    ODOO_URL: "https://utakfresh.odoo.com",
    ODOO_DB: "utakfresh",
    ODOO_LOGIN: "admin@utakfresh.com",
    ODOO_API_KEY: "TEST_KEY",
    OWNER_WHATSAPP: "+966505154962",
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    console.log(`  ✗ ${label}${detail ? "  (" + detail + ")" : ""}`);
  }
}

function reset(): void {
  captured = [];
  responder = () => true;
}

// ---------- Odoo fixtures (account ids/types as on the live tenant) ----------
const ACCOUNTS = [
  { id: 69, code: "102011", account_type: "asset_receivable" },
  { id: 70, code: "500001", account_type: "income" },
  { id: 257, code: "101007", account_type: "asset_cash" },
  { id: 254, code: "101003", account_type: "asset_current" },
  { id: 90, code: "400001", account_type: "expense" },
];
const accName = (id: number) => {
  const a = ACCOUNTS.find((x) => x.id === id)!;
  return [id, `${a.code} x`];
};
const INVOICE_LINES_OK = [
  { account_id: accName(69), debit: 175.5, credit: 0 },
  { account_id: accName(70), debit: 0, credit: 175.5 },
];

// ==================== TESTS ====================

async function testFlagGating(): Promise<void> {
  console.log("\n[1] ACCOUNTING_SYNC flag gating");
  reset();
  const envOff = makeEnv({});
  assert("undefined disables", isAccountingSyncEnabled(envOff) === false);
  const envFalse = makeEnv({ ACCOUNTING_SYNC: "false" });
  assert("'false' disables", isAccountingSyncEnabled(envFalse) === false);
  const envOn = makeEnv({ ACCOUNTING_SYNC: "true" });
  assert("'true' enables", isAccountingSyncEnabled(envOn) === true);

  // syncInvoiceToAccounting returns null with no side-effects when disabled.
  const result = await syncInvoiceToAccounting(envOff, {
    invoiceId: 999,
    existingMoveId: null,
    invoiceNumber: "UTAK-INV-TEST-000",
    customerPartnerId: 1,
    lines: [{ product_tmpl_id: 1, description: "t", quantity: 1, price_unit: 1 }],
    expectedTotal: 1,
  });
  assert("disabled sync returns null", result === null);
  assert("disabled sync issues no fetch", captured.length === 0, `captured=${captured.length}`);
}

async function testBuildInvoiceLineCommands(): Promise<void> {
  console.log("\n[2] buildInvoiceLineCommands — payload shape");
  const productMap = new Map<number, number>([[10, 20], [11, 21]]);
  const cmds = buildInvoiceLineCommands(
    [
      { product_tmpl_id: 10, description: "طماطم كرتون", quantity: 3, price_unit: 25 },
      { product_tmpl_id: 11, description: "خيار جرم", quantity: 5, price_unit: 12.5 },
      { product_tmpl_id: 0, description: "manual line", quantity: 1, price_unit: 7 },
    ],
    productMap,
  );
  assert("three commands emitted", cmds.length === 3);
  const first = cmds[0];
  assert("(0, 0, vals) shape", first[0] === 0 && first[1] === 0);
  const v0 = first[2] as any;
  assert("product_id resolved from tmpl", v0.product_id === 20);
  assert("quantity preserved", v0.quantity === 3);
  assert("price_unit preserved", v0.price_unit === 25);
  assert(
    "tax_ids explicitly empty",
    Array.isArray(v0.tax_ids) &&
      v0.tax_ids.length === 1 &&
      v0.tax_ids[0][0] === 6 &&
      v0.tax_ids[0][1] === 0 &&
      Array.isArray(v0.tax_ids[0][2]) &&
      v0.tax_ids[0][2].length === 0,
    JSON.stringify(v0.tax_ids),
  );
  assert("description passes through as name", v0.name === "طماطم كرتون");
  const v2 = cmds[2][2] as any;
  assert("unknown tmpl → no product_id", v2.product_id === undefined);
}

async function testJournalRouting(): Promise<void> {
  console.log("\n[3] journalIdForMethod — cash vs transfer routing");
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  assert("cash → CSHD", journalIdForMethod(env, "cash") === "CSHD");
  assert("transfer → BNK1", journalIdForMethod(env, "transfer") === "BNK1");
}

async function testInvoiceIdempotency(): Promise<void> {
  console.log("\n[4] syncInvoiceToAccounting — idempotent when link already set");
  reset();
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  const result = await syncInvoiceToAccounting(env, {
    invoiceId: 1,
    existingMoveId: 999,
    invoiceNumber: "UTAK-INV-TEST-001",
    customerPartnerId: 1,
    lines: [{ product_tmpl_id: 1, description: "t", quantity: 1, price_unit: 1 }],
    expectedTotal: 1,
  });
  assert("returns existing move id", result === 999);
  assert("no Odoo calls issued when linked", captured.length === 0, `captured=${captured.length}`);
}

async function testInvoiceHappyPath(): Promise<void> {
  console.log("\n[5] syncInvoiceToAccounting — happy path calls Odoo & links");
  reset();
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  const moveTotal = 175.5;
  responder = (req) => {
    // product.product/search_read → return one variant per template
    if (req.url.endsWith("/product.product/search_read")) {
      const tmplIds = (req.body.domain[0][2] as number[]);
      return tmplIds.map((t) => ({ id: t + 1000, product_tmpl_id: [t, `tmpl-${t}`] }));
    }
    if (req.url.endsWith("/res.partner/read")) {
      return [{ id: req.body.ids[0], property_payment_term_id: false }];
    }
    if (req.url.endsWith("/account.move/create")) return [42];
    if (req.url.endsWith("/account.move/action_post")) return true;
    if (req.url.endsWith("/account.move/read")) return [{ id: 42, amount_total: moveTotal, state: "posted" }];
    if (req.url.endsWith("/account.move.line/search_read")) return INVOICE_LINES_OK;
    if (req.url.endsWith("/account.account/read")) return ACCOUNTS;
    if (req.url.endsWith("/x_invoice/write")) return true;
    return true;
  };

  const result = await syncInvoiceToAccounting(env, {
    invoiceId: 7,
    existingMoveId: null,
    invoiceNumber: "UTAK-INV-TEST-007",
    customerPartnerId: 33,
    invoiceDate: "2026-09-21", // pre-VAT cutoff: tax_ids must stay empty
    lines: [
      { product_tmpl_id: 100, description: "طماطم", quantity: 3, price_unit: 25 },
      { product_tmpl_id: 101, description: "خيار", quantity: 8, price_unit: 12.5625 },
    ],
    expectedTotal: moveTotal,
  });
  assert("returns move id 42", result === 42);

  const create = captured.find((c) => c.url.endsWith("/account.move/create"));
  assert("account.move/create called", !!create);
  const moveVals = create?.body?.vals_list?.[0];
  assert("move_type = out_invoice", moveVals?.move_type === "out_invoice");
  assert("partner_id passed", moveVals?.partner_id === 33);
  assert("ref = invoice number", moveVals?.ref === "UTAK-INV-TEST-007");
  const lines = moveVals?.invoice_line_ids ?? [];
  assert("2 lines", lines.length === 2);
  // First line product_id = tmpl + 1000
  assert("line0 product_id resolved", lines[0][2].product_id === 1100);
  assert("line0 tax_ids empty", lines[0][2].tax_ids[0][2].length === 0);
  assert("line1 tax_ids empty", lines[1][2].tax_ids[0][2].length === 0);

  const post = captured.find((c) => c.url.endsWith("/account.move/action_post"));
  assert("action_post called on 42", post?.body?.ids?.[0] === 42);

  const write = captured.find((c) => c.url.endsWith("/x_invoice/write"));
  assert("x_invoice write links move", write?.body?.vals?.x_account_move_id === 42);
}

async function testInvoiceFailureContained(): Promise<void> {
  console.log("\n[6] syncInvoiceToAccounting — Odoo failure never throws to caller");
  reset();
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  responder = (req) => {
    if (req.url.endsWith("/product.product/search_read")) return [];
    if (req.url.endsWith("/res.partner/read")) return [{ id: 1, property_payment_term_id: false }];
    if (req.url.endsWith("/account.move/create")) {
      throw new Error("simulated ORM error");
    }
    return true;
  };

  // Wrap the swallowed sendOwnerAlert path in a mock: no template will be
  // registered on this fake tenant, so sendOwnerAlert falls through to
  // sendText — which hits fetch. Silence it by making every unmatched
  // response harmless.
  let threw = false;
  let result: number | null | "threw" = null;
  try {
    result = await syncInvoiceToAccounting(env, {
      invoiceId: 8,
      existingMoveId: null,
      invoiceNumber: "UTAK-INV-TEST-008",
      customerPartnerId: 1,
      invoiceDate: "2026-09-21",
      lines: [{ product_tmpl_id: 1, description: "t", quantity: 1, price_unit: 1 }],
      expectedTotal: 1,
    });
  } catch { threw = true; result = "threw"; }
  assert("caller never sees the error", threw === false);
  assert("sync returns null on failure", result === null);
}

async function testPaymentSkipsLegacy(): Promise<void> {
  console.log("\n[7] syncPaymentToAccounting — skips when invoice has no move twin");
  reset();
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  const result = await syncPaymentToAccounting(env, {
    paymentId: 5,
    existingPaymentMoveId: null,
    invoiceMoveId: null, // legacy x_invoice, no twin
    invoiceNumber: "LEGACY-001",
    amount: 100,
    method: "cash",
  });
  assert("returns null for legacy invoice", result === null);
  assert("no Odoo calls issued", captured.length === 0, `captured=${captured.length}`);
}

async function testPaymentIdempotency(): Promise<void> {
  console.log("\n[8] syncPaymentToAccounting — idempotent when already linked");
  reset();
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  const result = await syncPaymentToAccounting(env, {
    paymentId: 5,
    existingPaymentMoveId: 77,
    invoiceMoveId: 42,
    invoiceNumber: "UTAK-INV-TEST-007",
    amount: 100,
    method: "cash",
  });
  assert("returns existing payment id", result === 77);
  assert("no Odoo calls issued", captured.length === 0);
}

async function testPaymentGatedOff(): Promise<void> {
  console.log("\n[9] syncPaymentToAccounting — no-op when ACCOUNTING_SYNC off");
  reset();
  const env = makeEnv({});
  const result = await syncPaymentToAccounting(env, {
    paymentId: 5,
    existingPaymentMoveId: null,
    invoiceMoveId: 42,
    invoiceNumber: "X",
    amount: 100,
    method: "cash",
  });
  assert("returns null when gated off", result === null);
  assert("no Odoo calls issued", captured.length === 0);
}

async function testDateRiyadh(): Promise<void> {
  console.log("\n[10] todayRiyadhYmd shifts UTC by +3");
  // At 22:30 UTC on 2026-09-21, Riyadh is 01:30 on 2026-09-22.
  const nightBefore = new Date(Date.UTC(2026, 8, 21, 22, 30));
  assert("22:30 UTC on 2026-09-21 → 2026-09-22", todayRiyadhYmd(nightBefore) === "2026-09-22");
  const noon = new Date(Date.UTC(2026, 8, 21, 12, 0));
  assert("12:00 UTC → same day", todayRiyadhYmd(noon) === "2026-09-21");
}


async function testExtractPaymentId(): Promise<void> {
  console.log("\n[11] extractPaymentIdFromAction — Odoo 19 action shapes");
  assert("act_window res_id", extractPaymentIdFromAction({ type: "ir.actions.act_window", res_model: "account.payment", res_id: 17 }) === 17);
  assert("domain with one id", extractPaymentIdFromAction({ res_model: "account.payment", domain: [["id", "in", [18]]] }) === 18);
  assert("domain with two ids → null (ambiguous)", extractPaymentIdFromAction({ res_model: "account.payment", domain: [["id", "in", [18, 19]]] }) === null);
  assert("other model → null", extractPaymentIdFromAction({ res_model: "account.move", res_id: 5 }) === null);
  assert("true (dont_redirect) → null", extractPaymentIdFromAction(true) === null);
}

async function testSearchDomainHasPartner(): Promise<void> {
  console.log("\n[12] buildPaymentSearchDomain — partner + amount + journal + date");
  const d = buildPaymentSearchDomain({ partnerId: 48, amount: 9, journalId: 19, date: "2026-09-23" });
  const has = (f: string, v: unknown) => d.some((l) => l[0] === f && l[1] === "=" && l[2] === v);
  assert("partner_id filter", has("partner_id", 48));
  assert("amount filter", has("amount", 9));
  assert("journal_id filter", has("journal_id", 19));
  assert("date filter", has("date", "2026-09-23"));
}

/** Responder for a full payment run; `opts` bends one fact at a time. */
function paymentResponder(opts: {
  action?: unknown;
  debitAccount?: number;
  moveId?: number | false;
  invoiceState?: string;
  paymentPartner?: number;
  residualBefore?: number;
}) {
  let invReads = 0;
  return (req: CapturedRequest): any => {
    const u = req.url;
    if (u.endsWith("/account.journal/search_read")) return [{ id: 19, code: "CSHD" }];
    if (u.endsWith("/account.payment.register/create")) return [555];
    if (u.endsWith("/account.payment.register/action_create_payments")) {
      return opts.action ?? { type: "ir.actions.act_window", res_model: "account.payment", res_id: 31 };
    }
    if (u.endsWith("/account.payment/search_read")) return [{ id: 31 }];
    if (u.endsWith("/account.payment/read")) {
      const mv = opts.moveId === undefined ? 900 : opts.moveId;
      return [{ id: 31, state: "paid", move_id: mv ? [mv, "PCSHD/1"] : false, partner_id: [opts.paymentPartner ?? 48, "p"] }];
    }
    if (u.endsWith("/account.move/read")) {
      const id = req.body.ids[0];
      if (id === 900) return [{ id: 900, state: "posted" }];
      invReads++;
      return [{
        id: 42,
        commercial_partner_id: [48, "p"],
        partner_id: [48, "p"],
        amount_residual: opts.residualBefore ?? 12,
        payment_state: opts.invoiceState ?? "partial",
      }];
    }
    if (u.endsWith("/account.move.line/search_read")) {
      return [
        { account_id: accName(opts.debitAccount ?? 257), debit: 9, credit: 0 },
        { account_id: accName(69), debit: 0, credit: 9 },
      ];
    }
    if (u.endsWith("/account.account/read")) return ACCOUNTS;
    if (u.endsWith("/x_whatsapp_template/search_read")) return [{ x_meta_template_id: "utak_owner_alert", x_language: "ar" }];
    if (u.includes("graph.facebook.com")) return { messages: [{ id: "wamid.T" }] };
    void invReads;
    return true;
  };
}

const PAY_ARGS = {
  paymentId: 5,
  existingPaymentMoveId: null,
  invoiceMoveId: 42,
  invoiceNumber: "UTAK-INV-TEST-GUARD",
  amount: 9,
  method: "cash" as const,
  paymentDate: "2026-09-23",
};

async function testPaymentHappyPathUsesAction(): Promise<void> {
  console.log("\n[13] syncPaymentToAccounting — id from action, guard passes, links");
  reset();
  responder = paymentResponder({});
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  const r = await syncPaymentToAccounting(env, PAY_ARGS);
  assert("returns payment id from action (31)", r === 31, String(r));
  assert("no account.payment search when action carries res_id",
    !captured.some((c) => c.url.endsWith("/account.payment/search_read")));
  const w = captured.find((c) => c.url.endsWith("/x_payment/write"));
  assert("x_payment linked to 31", w?.body?.vals?.x_account_payment_id === 31);
  assert("no cancel issued", !captured.some((c) => c.url.endsWith("/account.payment/action_cancel")));
  const wiz = captured.find((c) => c.url.endsWith("/account.payment.register/create"));
  const vals = wiz?.body?.vals_list?.[0] ?? {};
  assert("wizard vals carry no currency_id (Odoo 19 rejects false once a move is built)",
    !("currency_id" in vals), JSON.stringify(vals));
}

async function testPaymentFallbackSearchFiltersPartner(): Promise<void> {
  console.log("\n[14] syncPaymentToAccounting — fallback search filters by partner");
  reset();
  responder = paymentResponder({ action: true });
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  const r = await syncPaymentToAccounting(env, PAY_ARGS);
  const s = captured.find((c) => c.url.endsWith("/account.payment/search_read"));
  const dom: any[] = s?.body?.domain ?? [];
  assert("fallback search issued", !!s);
  assert("search domain has partner_id = invoice partner 48",
    dom.some((l) => l[0] === "partner_id" && l[2] === 48), JSON.stringify(dom));
  assert("search domain has amount/journal/date",
    ["amount", "journal_id", "date"].every((f) => dom.some((l) => l[0] === f)));
  assert("linked via search result", r === 31);
}

async function testPaymentGuardFailureCancels(): Promise<void> {
  console.log("\n[15] syncPaymentToAccounting — guard failure: cancel, alert, no link");
  reset();
  responder = paymentResponder({ debitAccount: 70 }); // income on the debit side
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  // STATUS § 33 — the alert goes through the send gateway: text inside
  // Baraa's 24h window (opened here by his message an hour ago).
  const kv = new Map<string, string>();
  env.MSG_DEDUP = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  const { noteInbound } = await import("../src/wa-window.ts");
  await noteInbound(env, "+966505154962", Date.now() - 3600_000);
  let threw = false;
  let r: number | null = -1;
  try { r = await syncPaymentToAccounting(env, PAY_ARGS); } catch { threw = true; }
  assert("never throws", !threw);
  assert("returns null", r === null);
  assert("payment cancelled", captured.some((c) => c.url.endsWith("/account.payment/action_cancel") && c.body?.ids?.[0] === 31));
  assert("x_payment NOT linked", !captured.some((c) => c.url.endsWith("/x_payment/write")));
  const alert = captured.find((c) => c.url.includes("graph.facebook.com"));
  const alertText = JSON.stringify(alert?.body ?? "");
  assert("owner alert sent as text inside his window (no MARKETING template)",
    alert?.body?.type === "text" && !captured.some((c) => JSON.stringify(c.body ?? "").includes("utak_owner_alert")));
  assert("alert names the invoice number", alertText.includes("UTAK-INV-TEST-GUARD"), alertText.slice(0, 200));
  assert("alert names the reason (income)", alertText.includes("income"), alertText.slice(0, 200));
}

async function testPaymentGuardNoMove(): Promise<void> {
  console.log("\n[16] syncPaymentToAccounting — payment without move_id is rejected");
  reset();
  responder = paymentResponder({ moveId: false });
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  const r = await syncPaymentToAccounting(env, PAY_ARGS);
  assert("returns null", r === null);
  assert("payment cancelled", captured.some((c) => c.url.endsWith("/account.payment/action_cancel")));
}

async function testGuardPure(): Promise<void> {
  console.log("\n[17] evaluatePaymentGuard / evaluateInvoiceGuard — pure rules");
  const base = {
    paymentState: "paid", paymentPartnerId: 48, moveId: 900, moveState: "posted",
    invoicePaymentState: "paid", expectedPartnerId: 48, expectFull: true,
    lines: [
      { account_code: "101003", account_type: "asset_current", debit: 10, credit: 0 },
      { account_code: "102011", account_type: "asset_receivable", debit: 0, credit: 10 },
    ],
  };
  assert("outstanding (asset_current) + paid → ok", evaluatePaymentGuard(base).ok);
  assert("in_payment → ok", evaluatePaymentGuard({ ...base, invoicePaymentState: "in_payment" }).ok);
  assert("cash (asset_cash) → ok", evaluatePaymentGuard({ ...base, lines: [
    { account_code: "101007", account_type: "asset_cash", debit: 10, credit: 0 },
    { account_code: "102011", account_type: "asset_receivable", debit: 0, credit: 10 }] }).ok);
  assert("expense debit → rejected", !evaluatePaymentGuard({ ...base, lines: [
    { account_code: "400001", account_type: "expense", debit: 10, credit: 0 },
    { account_code: "102011", account_type: "asset_receivable", debit: 0, credit: 10 }] }).ok);
  assert("move not posted → rejected", !evaluatePaymentGuard({ ...base, moveState: "draft" }).ok);
  assert("full payment but invoice partial → rejected", !evaluatePaymentGuard({ ...base, invoicePaymentState: "partial" }).ok);
  assert("partial payment and invoice partial → ok", evaluatePaymentGuard({ ...base, invoicePaymentState: "partial", expectFull: false }).ok);
  assert("full payment but invoice not_paid → rejected", !evaluatePaymentGuard({ ...base, invoicePaymentState: "not_paid" }).ok);
  assert("partner mismatch → rejected", !evaluatePaymentGuard({ ...base, paymentPartnerId: 49 }).ok);

  const inv = { moveState: "posted", lines: [
    { account_code: "102011", account_type: "asset_receivable", debit: 12, credit: 0 },
    { account_code: "500001", account_type: "income", debit: 0, credit: 12 }] };
  assert("invoice AR debit / income credit → ok", evaluateInvoiceGuard(inv).ok);
  assert("invoice with expense line → rejected", !evaluateInvoiceGuard({ ...inv, lines: [
    { account_code: "102011", account_type: "asset_receivable", debit: 12, credit: 0 },
    { account_code: "400001", account_type: "expense", debit: 0, credit: 12 }] }).ok);
  assert("invoice with reversed sides → rejected", !evaluateInvoiceGuard({ ...inv, lines: [
    { account_code: "102011", account_type: "asset_receivable", debit: 0, credit: 12 },
    { account_code: "500001", account_type: "income", debit: 12, credit: 0 }] }).ok);
}

async function testInvoiceGuardFailureCancels(): Promise<void> {
  console.log("\n[18] syncInvoiceToAccounting — guard failure: cancel move, no link");
  reset();
  const env = makeEnv({ ACCOUNTING_SYNC: "true" });
  responder = (req) => {
    const u = req.url;
    if (u.endsWith("/product.product/search_read")) return [];
    if (u.endsWith("/res.partner/read")) return [{ id: 33, property_payment_term_id: false }];
    if (u.endsWith("/account.move/create")) return [43];
    if (u.endsWith("/account.move/read")) return [{ id: 43, amount_total: 12, state: "posted" }];
    if (u.endsWith("/account.move.line/search_read")) return [
      { account_id: accName(69), debit: 12, credit: 0 },
      { account_id: accName(90), debit: 0, credit: 12 }, // expense instead of income
    ];
    if (u.endsWith("/account.account/read")) return ACCOUNTS;
    if (u.endsWith("/x_whatsapp_template/search_read")) return [{ x_meta_template_id: "utak_owner_alert", x_language: "ar" }];
    if (u.includes("graph.facebook.com")) return { messages: [{ id: "wamid.T" }] };
    return true;
  };
  const r = await syncInvoiceToAccounting(env, {
    invoiceId: 8, existingMoveId: null, invoiceNumber: "UTAK-INV-TEST-BADACC",
    customerPartnerId: 33, invoiceDate: "2026-09-21",
    lines: [{ product_tmpl_id: 0, description: "x", quantity: 1, price_unit: 12 }],
    expectedTotal: 12,
  });
  assert("returns null", r === null);
  assert("move cancelled", captured.some((c) => c.url.endsWith("/account.move/button_cancel") && c.body?.ids?.[0] === 43));
  assert("x_invoice NOT linked", !captured.some((c) => c.url.endsWith("/x_invoice/write")));
}

// ==================== RUNNER ====================

async function main(): Promise<void> {
  try {
    await testFlagGating();
    await testBuildInvoiceLineCommands();
    await testJournalRouting();
    await testInvoiceIdempotency();
    await testInvoiceHappyPath();
    await testInvoiceFailureContained();
    await testPaymentSkipsLegacy();
    await testPaymentIdempotency();
    await testPaymentGatedOff();
    await testDateRiyadh();
    await testExtractPaymentId();
    await testSearchDomainHasPartner();
    await testPaymentHappyPathUsesAction();
    await testPaymentFallbackSearchFiltersPartner();
    await testPaymentGuardFailureCancels();
    await testPaymentGuardNoMove();
    await testGuardPure();
    await testInvoiceGuardFailureCancels();
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("test runner crashed", e); process.exit(1); });
