// Mutation check for the important gaps, batch 4 (STATUS § 39 د, 2026-09-26):
// each mutation disables ONE guard of م10 (the payment confirmation), runs
// tests/wa-important-b4.test.mts, and must make it fail. The source is
// restored in `finally` after every run; a pattern that is not found exactly
// once stops the script.
//
//   node scripts/wa-b4-20260926-mutations.mjs
//
// Out: scripts/artifacts/wa-b4-20260926-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/wa-important-b4.test.mts";
const PC = "src/payment-confirm.ts";

// [name, [[file, find, replace], …], test file]
const M = [
  // ---- the send
  ["م10: another purpose than customer_payment_received", [[PC,
    "    purpose: PAYCONF_PURPOSE,\n    to,", "    purpose: \"customer_receipt\",\n    to,"]], T],
  ["م10: no utak_payment_received outside the window", [[PC,
    "    fallback: [{ kind: \"template\", purpose: PAYCONF_PURPOSE, params: payconfParams(amount, invoiceNumber) }],\n", ""]], T],
  ["م10: the template first even inside the window", [[PC,
    "    content: textContent(payconfText({ amount, invoiceNumber, remaining, receipt: opts.receipt })),\n    fallback: [{ kind: \"template\", purpose: PAYCONF_PURPOSE, params: payconfParams(amount, invoiceNumber) }],",
    "    content: { kind: \"template\", purpose: PAYCONF_PURPOSE, params: payconfParams(amount, invoiceNumber) },\n    fallback: [textContent(payconfText({ amount, invoiceNumber, remaining, receipt: opts.receipt }))],"]], T],
  ["م10: the remaining as a third template variable", [[PC,
    "params: payconfParams(amount, invoiceNumber) }],\n    link:", "params: [...payconfParams(amount, invoiceNumber), String(remaining)] }],\n    link:"]], T],
  ["م10: a partial payment does not say what is left", [[PC,
    "  if (a.remaining !== undefined && a.remaining > 0.005) lines.push(", "  if (false) lines.push("]], T],
  ["م10: the receipt's link left out of the text", [[PC,
    "  if (a.receipt?.url) lines.push(`الإيصال: ${a.receipt.url}`);\n", ""]], T],
  ["م10: the remaining counts later payments too", [[PC,
    "[[\"x_invoice_id\", \"=\", invoiceId], [\"id\", \"<=\", paymentId], [SIM_FIELD, \"!=\", true]]", "[[\"x_invoice_id\", \"=\", invoiceId], [SIM_FIELD, \"!=\", true]]"]], T],
  ["م10: the remaining counts a simulation payment", [[PC,
    "[[\"x_invoice_id\", \"=\", invoiceId], [\"id\", \"<=\", paymentId], [SIM_FIELD, \"!=\", true]]", "[[\"x_invoice_id\", \"=\", invoiceId], [\"id\", \"<=\", paymentId]]"]], T],
  // ---- one per payment
  ["م10: no KV claim per payment", [[PC,
    "claimButton(env, `payconf:${paymentId}`, PAYCONF_CLAIM_TTL)", "claimButton(env, `payconf:${paymentId}:${Math.random()}`, PAYCONF_CLAIM_TTL)"]], T],
  ["م10: no record check", [[PC,
    "  if (await confirmedOnRecord(env, paymentId)) return { action: \"already\", ...base, remaining };\n", ""]], T],
  ["م10: the row not linked to the payment", [[PC,
    "    link: { model: PAYCONF_LINK_MODEL, id: paymentId },\n", ""]], T],
  ["م10: the gateway drops the link on the sent row", [["src/wa-record.ts",
    "    ...(rec.link ? { x_res_model: rec.link.model, x_res_id: rec.link.id } : {}),\n", ""]], T],
  ["م10: the gateway drops the link on the held row", [["src/wa-gateway.ts",
    "purpose: req.purpose, link: req.link });\n  await enqueueHeld(", "purpose: req.purpose });\n  await enqueueHeld("]], T],
  ["م10: a held confirmation not counted as on record", [[PC,
    "[\"x_status\", \"in\", [\"sent\", \"delivered\", \"read\", \"held\", \"dry_ok\"]]", "[\"x_status\", \"in\", [\"sent\", \"delivered\", \"read\", \"dry_ok\"]]"]], T],
  // ---- nothing sent
  ["م10: a simulation payment confirmed", [[PC,
    "  if (pay[SIM_FIELD] === true || inv[SIM_FIELD] === true || order?.[SIM_FIELD] === true) {", "  if (inv[SIM_FIELD] === true || order?.[SIM_FIELD] === true) {"]], T],
  ["م10: a simulation invoice confirmed", [[PC,
    "  if (pay[SIM_FIELD] === true || inv[SIM_FIELD] === true || order?.[SIM_FIELD] === true) {", "  if (pay[SIM_FIELD] === true || order?.[SIM_FIELD] === true) {"]], T],
  ["م10: a simulation order confirmed", [[PC,
    "  if (pay[SIM_FIELD] === true || inv[SIM_FIELD] === true || order?.[SIM_FIELD] === true) {", "  if (pay[SIM_FIELD] === true || inv[SIM_FIELD] === true) {"]], T],
  ["م10: a customer held for the review confirmed", [[PC,
    "    if ((await heldPartnerIds(env, [customerId])).has(customerId)) {", "    if (false) {"]], T],
  // ---- one path
  ["م10: the collection's own «تم استلام الدفعة» back", [["src/invoice.ts",
    "  // STATUS § 39 د (م10) — nothing to the customer from here:",
    "  if (invoice.orderId) { const { getOrderCustomerWhatsapp } = await import(\"./odoo\"); const wa = await getOrderCustomerWhatsapp(env, invoice.orderId); if (wa) await sendText(env, wa, `تم استلام الدفعة ${amount} ر.س`, { purpose: \"customer_payment_ack\", noHold: true }); }\n  // STATUS § 39 د (م10) — nothing to the customer from here:"]], T],
  ["م10: the receipt pipeline does not confirm", [["src/receipt.ts",
    "    const c = await confirmPaymentToCustomer(env, paymentId, {\n      receipt: { number: data.receiptNumber, url: uploaded.publicUrl, method: data.payments[0]?.method || undefined },\n      ctx,\n    });",
    "    const c = { action: \"no_phone\" as const }; void confirmPaymentToCustomer;"]], T],
  ["م10: /admin/test-receipt bypasses the guards (a raw send)", [["src/index.ts",
    "        const c = await confirmPaymentToCustomer(env, paymentId, {\n          receipt: { number: built.receiptNumber, url: uploaded.publicUrl, method: built.payments[0]?.method || undefined },\n        });",
    "        void confirmPaymentToCustomer; const { sendText } = await import(\"./meta\"); await sendText(env, built.customer.phone, \"✅ استلمنا دفعتك\", { purpose: \"customer_payment_received\" }); const c = { action: \"sent\" as string };"]], T],
  // ---- the */5 net
  ["م10 net: not wired in the */5 cron", [["src/index.ts",
    "            const pc = await runPaymentConfirmTick(rawEnv, Date.now(), ctx);", "            const pc = [] as Array<unknown>; void runPaymentConfirmTick;"]], T],
  ["م10 net: no minimum age (races the webhook)", [[PC,
    "      [\"create_date\", \"<=\", toOdooUtc(nowMs - PAYCONF_SWEEP_MIN_AGE_MIN * MIN)],\n", ""]], T],
  ["م10 net: no maximum age (a day-old confirmation)", [[PC,
    "      [\"create_date\", \">=\", toOdooUtc(nowMs - PAYCONF_SWEEP_MAX_AGE_H * 60 * MIN)],\n", ""]], T],
  ["م10 net: simulation payments swept", [[PC,
    "      [SIM_FIELD, \"!=\", true],\n      [\"x_studio_char_1_1\", \"=\", false],", "      [\"x_studio_char_1_1\", \"=\", false],"]], T],
  ["م10 net: a receipted payment swept again", [[PC,
    "      [\"x_studio_char_1_1\", \"=\", false],\n", ""]], T],
  ["م10 net: a claimed payment re-run", [[PC,
    "    if (await rawEnv.MSG_DEDUP.get(`btnlock:v1:payconf:${id}`)) continue;\n", ""]], T],
  ["م10 net: one auto-send job for all payments (the second of the day dropped)", [[PC,
    "withAutoSendJob(rawEnv, `payment_confirm:${id}`)", "withAutoSendJob(rawEnv, \"payment_confirm\")"]], T],
];

const results = [];
for (const [name, edits, test] of M) {
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      const src = originals.get(path) ?? readFileSync(path, "utf8");
      if (!originals.has(path)) originals.set(path, src);
      const cur = readFileSync(path, "utf8");
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error(`pattern found ${n}× in ${file}: ${find.slice(0, 80)}`);
      writeFileSync(path, cur.replace(find, replace));
    }
    let caught = false, out = "";
    try {
      out = execFileSync("node", ["--experimental-strip-types", "--experimental-loader=./tests/loader.mjs", test], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    } catch (e) {
      caught = true;
      out = String(e.stdout ?? "") + String(e.stderr ?? "");
    }
    const fails = (out.match(/^\s+✗ .*/gm) ?? []).map((l) => l.trim()).slice(0, 4);
    results.push({ name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("./artifacts/wa-b4-20260926-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
