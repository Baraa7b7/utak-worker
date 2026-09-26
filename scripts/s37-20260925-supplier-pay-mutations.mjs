// Mutation check for STATUS § 37 ب (supplier payments) and § 37 ج (simulation
// records, 2026-09-26): each mutation
// disables ONE mechanism, runs tests/supplier-pay.test.mts, and must make it
// fail. The source is restored in `finally` after every run; a pattern that
// is not found exactly once stops the script.
//
//   node scripts/s37-20260925-supplier-pay-mutations.mjs
//
// Out: scripts/artifacts/s37-20260925-supplier-pay-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const T = "tests/supplier-pay.test.mts";
const SP = "src/supplier-pay.ts";
const OC = "scripts/lib/s37-odoo-code.mjs";
const GW = "src/wa-gateway.ts";

// [name, [[file, find, replace], …], test file]
const M = [
  // ---- the dues
  ["the due takes another supplier's price", [[SP,
    "    if (!p.x_supplier_id || p.x_supplier_id[0] !== supplierId) continue;\n", ""]], T],
  ["the due takes another day's price", [[SP,
    "    if (String(p.x_date || \"\") !== day) continue;\n", ""]], T],
  ["the due takes a failed extraction", [[SP,
    "    if (!(Number(p.x_price_sar) > 0) || p.x_extraction_status === \"failed\") continue;", "    if (!(Number(p.x_price_sar) > 0)) continue;"]], T],
  ["the due takes the oldest price, not the latest", [[SP,
    "    if (!best || p.id > best.id) best = p;", "    if (!best || p.id < best.id) best = p;"]], T],
  ["a line without a price not marked «بلا سعر»", [[SP,
    "      noPrice: !p,\n", "      noPrice: false,\n"]], T],
  ["the item's supplier ignores price_supplier_id", [[SP,
    "  if (p > 0) return p;\n", ""]], T],
  ["no «بلا سعر» alert", [[SP,
    "  if (fresh.length) {\n    const claim = await claimButton(env, `sp_noprice:", "  if (false) {\n    const claim = await claimButton(env, `sp_noprice:"]], T],
  ["the «بلا سعر» alert repeats on every change", [[SP,
    "  const fresh = keys.filter((k) => !seen.includes(k));", "  const fresh = keys.filter(() => true);\n  seen = [];"]], T],
  ["a recomputation adds lines instead of updating them", [[SP,
    "      if (old) {\n        keptLines.add(old.id);", "      if (false) {\n        keptLines.add(old!.id);"]], T],
  ["an unconfirmed list gets dues", [[SP,
    "  if (list.x_status !== \"done\") return { action: \"not_confirmed\", listId, day };", "  if (false) return { action: \"not_confirmed\", listId, day };"]], T],
  ["the tick races the tap (no 2-minute grace)", [[SP,
    "    if (!opts.force && at && now - at < DUE_TICK_GRACE_MS) continue;", "    if (false) continue;"]], T],
  ["the confirmed list's dues not built at «تم الشراء»", [["src/team.ts",
    "    await syncSupplierDues(env, listId);\n", ""]], T],
  // ---- the balance and the payment
  ["pending payments counted as paid", [[SP,
    "    domain: [[\"x_supplier_id\", \"=\", supplierId], [\"x_state\", \"=\", \"approved\"], NOT_SIM], fields: [\"x_amount\"], limit: 5000,",
    "    domain: [[\"x_supplier_id\", \"=\", supplierId], [\"x_state\", \"in\", [\"approved\", \"pending\"]], NOT_SIM], fields: [\"x_amount\"], limit: 5000,"]], T],
  ["an overpayment not marked «رصيد دائن»", [[SP,
    "    const overpaid = bal.remainingH < 0;", "    const overpaid = false;"]], T],
  ["the supplier sees a negative remaining", [[SP,
    "الرصيد المتبقي لك: ${money(Math.max(0, remainingH))} ر.س.`;", "الرصيد المتبقي لك: ${money(remainingH)} ر.س.`;"]], T],
  ["a pending payment is settled (notice before the approval)", [[SP,
    "  if (p.x_state !== \"approved\" && p.x_state !== \"rejected\") return { action: \"pending\", id, ref: String(p.x_name || \"\") };",
    "  if (false) return { action: \"pending\", id, ref: String(p.x_name || \"\") };"]], T],
  ["settled twice (no x_settled_at, no claim)", [
    [SP, "  if (p.x_settled_at) return { action: \"already\", id, ref: String(p.x_name || \"\") };\n", ""],
    [SP, "  const claim = await claimButton(env, `sp_settle:${id}`, 30 * 24 * 3600);\n  if (!claim.claimed) return",
      "  const claim = await claimButton(env, `sp_settle:${id}:${Math.random()}`, 30 * 24 * 3600);\n  if (!claim.claimed) return"]], T],
  ["a rejected payment notifies the supplier", [[SP,
    "    if (p.x_state === \"rejected\") {", "    if (false) {"]], T],
  ["the member not told of a rejection", [[SP,
    "        memberLine = await notifyMember(penv, member[0], tagged(tag, `❌ رفض", "        memberLine = await Promise.resolve(\"\") && await notifyMember(penv, member[0], tagged(tag, `❌ رفض"]], T],
  ["the rejection without its reason", [[SP,
    ".\\nالسبب: ${reason}`), opts.ctx);", ".`), opts.ctx);"]], T],
  ["the member not told of an approval", [[SP,
    "      memberLine = await notifyMember(penv, member[0], tagged(tag, `✅ اعتمد", "      memberLine = await Promise.resolve(\"\") && await notifyMember(penv, member[0], tagged(tag, `✅ اعتمد"]], T],
  ["no template outside the window (text or held only)", [[SP,
    "        fallback: tag ? [] : [{ kind: \"template\", purpose: SP_NOTICE_PURPOSE, params: supplierNoticeParams(amountH, day, ref, bal.remainingH) }],\n", "        fallback: [],\n"]], T],
  ["the notice not critical (no «فتح المحادثة» when held)", [["src/wa-purposes.ts",
    "  supplier_payment_sent: crit(op(\"إشعار دفعة المورد\", false, { hours: 72 }), \"دفعة جديدة\"),", "  supplier_payment_sent: op(\"إشعار دفعة المورد\", false, { hours: 72 }),"]], T],
  ["a trial's notice goes as the untagged template", [[SP,
    "        fallback: tag ? [] : [{ kind:", "        fallback: false ? [] : [{ kind:"]], T],
  ["the trial tag not applied", [[SP,
    "  return t ? `${t} — ${text}` : text;", "  return t ? text : text;"]], T],
  ["Omar's payment created approved", [[SP,
    "    x_channel: \"whatsapp\",\n    x_state: \"pending\",", "    x_channel: \"whatsapp\",\n    x_state: \"approved\","]], T],
  ["the receipt not stored", [[SP,
    "    ...(input.receipt ? { x_receipt: input.receipt.base64, x_receipt_filename: input.receipt.filename } : {}),\n", ""]], T],
  ["Baraa's alert without the remaining", [[SP,
    "    `المتبقي للمورد قبلها: ${money(bal.remainingH)} ر.س`,\n", ""]], T],
  // ---- Omar's steps
  ["the amount accepts «1,500» (commas dropped)", [[SP,
    ".replace(\"٫\", \".\");", ".replace(\"٫\", \".\").replace(/,/g, \"\");"]], T],
  ["the amount refuses Arabic digits", [[SP,
    ".replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d)", ""]], T],
  ["a driver may record a payment", [[SP,
    "  if (!isPaymentMember(member)) return { text: SP_TEXT.notAllowed };", "  if (false) return { text: SP_TEXT.notAllowed };"]], T],
  ["a supplier outside today's list accepted", [[SP,
    "    const s = (await todaysSuppliers(env, now)).find((x) => x.id === id);", "    const s = (await todaysSuppliers(env, now)).find((x) => x.id === id) ?? { id, name: \"?\" };"]], T],
  ["more than three suppliers as buttons (no list)", [[SP,
    "  if (rows.length <= 3) return { bodyBeforeButtons: SP_TEXT.chooseSupplier, buttons: rows };", "  if (rows.length <= 99) return { bodyBeforeButtons: SP_TEXT.chooseSupplier, buttons: rows };"]], T],
  ["«إلغاء» ignored", [[SP,
    "  if (SP_CANCEL_WORDS.includes(t.toLowerCase())) { await clearFlow(env, member.id); return { text: SP_TEXT.cancelled }; }\n", ""]], T],
  ["the receipt photo not handled (team media)", [["src/index.ts",
    "          const reply = await handlePayMedia(env, teamMatch, msg.media!, msg.messageId);", "          const reply = null as any;"]], T],
  ["the team's line without «💵 دفعت لمورد»", [["src/index.ts",
    "            if (isPaymentMember(teamMember)) {", "            if (false) {"]], T],
  ["«تم الشراء» without «💵 دفعت لمورد»", [["src/router.ts",
    "    return { bodyBeforeButtons: text, buttons: [startButton()] };", "    return { text, buttons: startButton ? [] : [] };"]], T],
  // ---- the hook and the tick
  ["the hook without its token check", [["src/index.ts",
    "    if (request.method === \"POST\" && url.pathname === \"/odoo/hook/supplier-pay\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (!expected || !timingSafeEqual(providedToken, expected)) {",
    "    if (request.method === \"POST\" && url.pathname === \"/odoo/hook/supplier-pay\") {\n      const providedToken = url.searchParams.get(\"token\") ?? \"\";\n      const expected = env.ODOO_HOOK_TOKEN ?? \"\";\n      if (false && providedToken !== expected) {"]], T],
  ["the tick settles at once (races the webhook)", [[SP,
    "export const SETTLE_RETRY_AFTER_MS = 3 * 60_000;", "export const SETTLE_RETRY_AFTER_MS = 0;"]], T],
  ["the tick never settles a lost webhook", [[SP,
    "    for (const r of rows) settled.push(await settlePayment(env, r.id, { ctx, now }));", "    for (const r of rows.slice(0, 0)) settled.push(await settlePayment(env, r.id, { ctx, now }));"]], T],
  // ---- the Odoo code
  ["Odoo: «اعتماد» on any state", [[OC,
    "    if rec.x_state != 'pending':\n        raise UserError('لا تُعتمد إلا دفعة «بانتظار الاعتماد».')\n", ""]], T],
  ["Odoo: «رفض» without a reason", [[OC,
    "    if not (rec.x_reject_reason or '').strip():\n        raise UserError('اكتب «سبب الرفض» أولاً، ثم اضغط «رفض».')\n", ""]], T],
  ["Odoo: Baraa's payment left pending", [[OC,
    "        vals.update({'x_channel': 'odoo', 'x_state': 'approved', 'x_decided_by': env.user.id, 'x_decided_at': now})",
    "        vals.update({'x_channel': 'odoo', 'x_state': 'pending'})"]], T],
  ["Odoo: the amount not kept to two decimals", [[OC,
    "    vals = {'x_amount': round(rec.x_amount, 2)}", "    vals = {'x_amount': rec.x_amount}"]], T],
  ["Odoo: the lock does not watch the amount", [[OC,
    "export const LOCK_WATCH = [\"x_name\", \"x_supplier_id\", \"x_date\", \"x_amount\",", "export const LOCK_WATCH = [\"x_name\", \"x_supplier_id\", \"x_date\","]], T],
  // ---- no accounting
  ["the dues read account.move", [[SP,
    "  const prices = await readPricesFor(env, day, items);", "  const prices = await readPricesFor(env, day, items);\n  await call(env, \"account.move\", \"search_count\", { domain: [] });"]], T],
  // ---- § 37 ج (2026-09-26): simulation records (x_utak_simulation)
  ["a simulation due / payment counted in the balance", [
    [SP, "    domain: [[\"x_supplier_id\", \"=\", supplierId], NOT_SIM], fields: [\"x_amount\"], limit: 5000,", "    domain: [[\"x_supplier_id\", \"=\", supplierId]], fields: [\"x_amount\"], limit: 5000,"],
    [SP, "[\"x_state\", \"=\", \"approved\"], NOT_SIM], fields", "[\"x_state\", \"=\", \"approved\"]], fields"]], T],
  ["a simulation list builds dues and alerts", [[SP,
    "  if (list.x_utak_simulation) {\n    // § 37 ج", "  if (false) {\n    // § 37 ج"]], T],
  ["the tick / refresh takes a simulation list", [[SP,
    "[\"x_status\", \"=\", \"done\"], [\"x_date\", \">=\", since], NOT_SIM]", "[\"x_status\", \"=\", \"done\"], [\"x_date\", \">=\", since]]"]], T],
  ["Omar's picker offers a simulation list's supplier", [[SP,
    "[\"x_status\", \"in\", [\"sent\", \"done\"]], [\"x_date\", \">=\", since], NOT_SIM]", "[\"x_status\", \"in\", [\"sent\", \"done\"]], [\"x_date\", \">=\", since]]"]], T],
  ["a simulation payment settled like a real one", [[SP,
    "  if (p.x_utak_simulation) {\n    const ref", "  if (false) {\n    const ref"]], T],
  ["the gateway lets a simulation notice through", [[GW,
    "  if (simulation) {", "  if (false && simulation) {"]], T],
  ["the gateway fails open when Odoo cannot say", [[GW,
    "    return `تعذّر التحقق من أن ${refs.join(\"، \")} ليست دفعة محاكاة: ${(e as Error)?.message ?? e}`;", "    return null;"]], T],
  ["the gateway checks only the purpose (not the template by row)", [[GW,
    " || options.some((o) =>\n    o.kind === \"template\" && (o.purpose === SP_NOTICE_PURPOSE || o.row?.x_meta_template_id === SP_NOTICE_TEMPLATE));", ";"]], T],
  ["Odoo's due compute counts a simulation due", [[OC,
    "    record['x_sp_due_total'] = round(sum(record.x_sp_due_ids.filtered(lambda d: not d.${SIM_FIELD}).mapped('x_amount')), 2)", "    record['x_sp_due_total'] = round(sum(record.x_sp_due_ids.mapped('x_amount')), 2)"]], T],
  ["Odoo's remaining compute counts a simulation payment", [[OC,
    "    paid = sum(record.x_sp_payment_ids.filtered(lambda p: p.x_state == 'approved' and not p.${SIM_FIELD}).mapped('x_amount'))\n    record['x_sp_remaining']", "    paid = sum(record.x_sp_payment_ids.filtered(lambda p: p.x_state == 'approved').mapped('x_amount'))\n    record['x_sp_remaining']"]], T],
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
writeFileSync(new URL("./artifacts/s37-20260925-supplier-pay-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
