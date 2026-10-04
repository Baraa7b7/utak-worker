// Mutation check for § 44 (2026-09-28): each mutation disables ONE guard of a
// part, runs its test file, and must make it fail. The source is restored in
// `finally` after every run; a pattern that is not found exactly once stops
// the script.
//
//   node scripts/mutation/s44-20260928-mutations.mjs [ب|د|هـ|و|ز …]     (no argument: every part)
//
// Out: scripts/artifacts/s44-20260928-mutations.json

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const T = "tests/s44.test.mts";
const RP = "scripts/lib/real-partners.mjs";
const MK = "scripts/s42-20260927-prelaunch-mark.mts";
const VA = "src/vat-ask.ts";
const RT = "src/router.ts";
const IX = "src/index.ts";
const TX = "src/tax-invoice.ts";
const INV = "src/invoice.ts";
const PA = "src/purchase-accounting.ts";
const SA = "src/sale-accounting.ts";
const TSA = "tests/sale-accounting.test.mts";
const SC = "src/screening.ts";

// [part, name, [[file, find, replace], …], test file]
const M = [
  // ---------------------------------------------------------------- ب the real customers are never marked
  ["ب", "the exclusion drops nothing (every x_is_simulation record marked)", [[RP,
    "  if (!keep || !keep.size) return { ids: [...ids], excluded: [] };",
    "  return { ids: [...ids], excluded: [] };"]], T],
  ["ب", "selectForMark ignores the links", [[RP,
    "  const { ids, excluded } = withoutReal(model, all, linked);",
    "  const { ids, excluded } = { ids: all, excluded: [] };"]], T],
  ["ب", "the route carrying his stop not protected", [[RP,
    "  out.x_delivery_route = new Set(stops.map((s) => (Array.isArray(s.x_route_id) ? s.x_route_id[0] : 0)).filter(Boolean));",
    "  out.x_delivery_route = new Set();"]], T],
  ["ب", "a cancelled order protects its day's purchase list", [[RP,
    "orders.filter((o) => o.x_state !== \"cancelled\" && o.x_order_date)",
    "orders.filter((o) => o.x_order_date)"]], T],
  ["ب", "the dues' lines not protected", [[RP,
    "  out.x_supplier_due_line = new Set(out.x_supplier_due.size ?",
    "  out.x_supplier_due_line = new Set(false ?"]], T],
  ["ب", "the payment read through a wrong path", [[RP,
    "    x_payment: [[\"x_invoice_id.x_order_id.x_customer_id\", \"in\", list]],",
    "    x_payment: [[\"x_invoice_id.x_customer_id\", \"in\", list]],"]], T],
  ["ب", "«بيت التمور» (#105) left out of the list", [[RP,
    "export const REAL_PARTNER_IDS = Object.freeze([31, 105]);",
    "export const REAL_PARTNER_IDS = Object.freeze([31]);"]], T],
  ["ب", "the mark script selects without the links", [[MK,
    "  return selectForMark(call, model, await linked());",
    "  return selectForMark(call, model, {});"]], T],
  ["ب", "the mark script's write guard removed", [[MK,
    "    if (s.ids.some((id) => L[m]?.has(id))) throw new Error(`${m}: a record linked to a real customer reached the write`);\n",
    ""]], T],
  // ---------------------------------------------------------------- د the customer's VAT number
  ["د", "asked though «مسجّل» / «غير مسجّل»", [[VA,
    "    if (!p || vatStatusOf(p) !== \"unknown\") return null;",
    "    if (!p) return null;"]], T],
  ["د", "asked though Baraa typed a number on the card", [[VA,
    "    if (typeof p.vat === \"string\" && p.vat.trim()) return null; // Baraa entered it on the card\n", ""]], T],
  ["د", "no limit of three asks", [[VA,
    "    if (count >= VAT_MAX_ASKS) return null;\n", ""]], T],
  ["د", "the ask counter not incremented", [[VA,
    "vals: { x_vat_ask_count: count + 1 } });\n    await writeFlow(env, f);", "vals: { x_vat_ask_count: count } });\n    await writeFlow(env, f);"]], T],
  ["د", "a second question while one is open", [[VA,
    "    if (open && now - open.at < VAT_WAIT_MIN * MIN) return null;\n", ""]], T],
  ["د", "any 15 digits taken as a VAT number (not 3…3)", [[VA,
    "  return /^3\\d{13}3$/.test(s) ? s : null;", "  return /^\\d{15}$/.test(s) ? s : null;"]], T],
  ["د", "Arabic-Indic digits not read", [[VA,
    "    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d)\n    .replace(/[\\s\\u200e", "    .replace(/[\\s\\u200e"]], T],
  ["د", "the spaces not removed", [[VA,
    "    .replace(/[\\s\\u200e\\u200f\\u2066-\\u2069\\u202a-\\u202e]+/g, \"\");", "    .replace(/[\\u200e\\u200f]+/g, \"\");"]], T],
  ["د", "the number saved before the third answer (a partial save)", [[VA,
    "      await writeFlow(env, { ...f, vat, step: \"name\", at: now });",
    "      await call(env, \"res.partner\", \"write\", { ids: [partnerId], vals: { vat } });\n      await writeFlow(env, { ...f, vat, step: \"name\", at: now });"]], T],
  ["د", "«لا» saves nothing", [[VA,
    "vals: { x_vat_status: \"not_registered\" } }", "vals: {} }"]], T],
  ["د", "the third answer does not set «مسجّل»", [[VA,
    "      vat: f.vat, x_legal_name: f.legalName, street: address, x_vat_status: \"registered\",",
    "      vat: f.vat, x_legal_name: f.legalName, street: address,"]], T],
  ["د", "a step answered after its 60 minutes", [[VA,
    "  if (now - f.at > VAT_WAIT_MIN * MIN) return null; // the tick ends it\n", ""]], T],
  ["د", "the tick never ends a silent flow", [[VA,
    "      if (now - f.at >= VAT_WAIT_MIN * MIN) {", "      if (false) {"]], T],
  ["د", "Baraa alerted on every unanswered ask (not only the third)", [[VA,
    "  if (f.askNo < VAT_MAX_ASKS) return false;\n", ""]], T],
  ["د", "«إيقاف» does not stop the questions", [[VA,
    "  if (isVatStopWord(text)) {", "  if (false && isVatStopWord(text)) {"]], T],
  ["د", "the location pending ignored (a district taken as a wrong number)", [[VA,
    "  if (f.step === \"number\" && opts.locationPending && !/[0-9٠-٩۰-۹]/.test(text)) return null;\n", ""]], T],
  ["د", "no per-step lock (two numbers at once → two steps)", [[VA,
    "  if (!claim.claimed) return { text: \"\" }; // the same step is being answered right now", "  void claim;"]], T],
  ["د", "the tick ignores a cancelled order", [[VA,
    "      if (o && o.x_state === \"cancelled\") {", "      if (false) {"]], T],
  ["د", "the order cancelled by the customer leaves the flow open", [[RT,
    "  if (partner?.id) await import(\"./vat-ask\").then((m) => m.endVatFlowForOrder(env, partner.id, orderId)).catch(() => {});\n", ""]], T],
  ["د", "no question after «تأكيد الطلب»", [[RT,
    "  return action === \"confirm_order\" ? await withVatAsk(env, reply, partner?.id) : reply;", "  return reply;"]], T],
  ["د", "no question after «سجّله لبكرة»", [[RT,
    "      ? await withVatAsk(env, await handleLateYes(env, partner, pid), partner?.id ?? pid)", "      ? await handleLateYes(env, partner, pid)"]], T],
  ["د", "no question after the standing order", [[RT,
    "    if (text !== ALREADY_DONE_TEXT) return await withVatAsk(env, out, partner?.id);", "    if (text !== ALREADY_DONE_TEXT) return out;"]], T],
  ["د", "the follow-up never sent", [[IX,
    "  if (reply.followUp) await sendReply(env, to, reply.followUp, ctx);\n", ""]], T],
  ["د", "the purpose ignored (every reply bot_reply)", [[IX,
    "  const purpose = reply.purpose ?? \"bot_reply\";", "  const purpose = \"bot_reply\";"]], T],
  ["د", "his texts never reach the questions", [[IX,
    "        const vr = await vatFlowReply(env, partner.id, msg.text, Date.now(), { locationPending: !!loc });",
    "        const vr = null as unknown as Awaited<ReturnType<typeof vatFlowReply>>; void loc;"]], T],
  ["د", "«غير مسجّل» with a number still a full invoice", [[TX,
    "  if (!vat || p?.x_vat_status === \"not_registered\") return null;", "  if (!vat) return null;"]], T],
  ["د", "the full invoice without the official name", [[INV,
    "      name: buyer?.legalName || order.customer_name || 'عميل',", "      name: order.customer_name || 'عميل',"]], T],
  ["د", "the full invoice without the address", [[INV,
    "      address: buyer?.address || order.neighborhood || 'الرياض',", "      address: order.neighborhood || 'الرياض',"]], T],
  ["د", "the full invoice without the buyer's number", [[INV,
    "      ...(buyer ? { vat: buyer.vat } : {}),\n    },\n    items,\n    subtotal: vatAmount > 0 ? netSubtotal : subtotal,",
    "    },\n    items,\n    subtotal: vatAmount > 0 ? netSubtotal : subtotal,"]], T],
  // ---------------------------------------------------------------- هـ one bill per supplier
  ["هـ", "the market winners ignored (Omar's line back on Ahmed's bill)", [[PA,
    "    const won = market?.winners.get(winnerKey(it.product_id, it.packaging_id));",
    "    const won = undefined as { price: number } | undefined; void winnerKey;"]], T],
  ["هـ", "a market line at the list's price (Ahmed's 13), not Omar's written one", [[PA,
    "      line = { ...it, unit_price: won.price };", "      line = it;"]], T],
  ["هـ", "no check of the fixed origin before the create (a second bill)", [[PA,
    "    if (existing.length) {\n      const inv =", "    if (false) {\n      const inv ="]], T],
  ["هـ", "the list linked though a supplier's bill failed", [[PA,
    "    if (!failed.length && !plan.noSupplier.length) {", "    if (true) {"]], T],
  ["هـ", "the input tax split whatever the supplier's card says", [[PA,
    // § 47 أ: a comment line sits between the tax and the expected totals (the tax is added on the net price now)
    "      supplierVat: supplier?.vat, billDate, vatEffectiveDate: opts.vatEffectiveDate,\n    });\n",
    "      supplierVat: \"3\", billDate, vatEffectiveDate: opts.vatEffectiveDate,\n    });\n    void supplier;\n"]], T],
  ["هـ", "the no-VAT line before 10-01 too", [[PA,
    "    if (done.some((d) => !d.existed && !d.tax) && isVatApplicable(billDate, opts.vatEffectiveDate)) {",
    "    if (done.some((d) => !d.existed && !d.tax)) {"]], T],
  ["هـ", "the no-VAT line more than once a day", [[PA,
    "  const claim = await claimButton(env, `cash_novat:${billDate}`, 26 * 60 * 60);\n  if (!claim.claimed) return;\n",
    "  void claimButton;\n"]], T],
  // two guards (its bill carries no tax; the day's sum counts untaxed bills only): both off together
  ["هـ", "the no-VAT line though the cash market has a VAT number", [[PA,
    "  if (!cash || !bills.some((d) => d.supplierId === cash.id && !d.tax && !d.existed)) return;",
    "  if (!cash || !bills.some((d) => d.supplierId === cash.id && !d.existed)) return;"], [PA,
    "  const total = roundHalala(day.filter((m) => !(m.amount_tax > 0)).reduce((a, m) => a + (m.amount_total ?? 0), 0));",
    "  const total = roundHalala(day.reduce((a, m) => a + (m.amount_total ?? 0), 0));"]], T],
  ["هـ", "a reused (existing) bill announced as a new no-VAT purchase", [[PA,
    "  if (!cash || !bills.some((d) => d.supplierId === cash.id && !d.tax && !d.existed)) return;",
    "  if (!cash || !bills.some((d) => d.supplierId === cash.id && !d.tax)) return;"]], T],
  ["هـ", "the list linked to the market's bill (not the list supplier's first)", [[PA,
    "  const bills = [...by.values()].sort((a, b) => (a.supplierId === listSupplierId ? -1 : b.supplierId === listSupplierId ? 1 : a.supplierId - b.supplierId));",
    "  const bills = [...by.values()].sort((a, b) => a.supplierId - b.supplierId);"]], T],
  ["هـ", "no supplier for an item billed anyway to the list's supplier", [[PA,
    "      sid = market!.cashSupplierId;", "      sid = market!.cashSupplierId ?? listSupplierId;"]], T],
  // ---------------------------------------------------------------- ز the invoice number on its entry
  ["ز", "the supplier bill without the list's number (PL-<list>)", [[PA,
    "      vals: { invoice_date: billDate, ref: purchaseBillRef(listId) },", "      vals: { invoice_date: billDate },"]], T],
  ["ز", "the customer's entry without the invoice number sent to him (UTAK-INV-…)", [[SA,
    "      vals: { invoice_date: invoiceDate, ref: args.invoiceNumber },", "      vals: { invoice_date: invoiceDate },"]], TSA],
  // ---------------------------------------------------------------- و «🆕 عميل جديد»
  ["و", "no alert for a new number served on its purchase text", [[SC,
    "  } else if (!pending && intent === \"purchase\") {", "  } else if (false) {"]], T],
  ["و", "no alert for a new number made «عميل» by its first real order", [[SC,
    "    if (!st.x_review_pending) await announceNewCustomerSafe(env, { partnerId: input.partnerId, name: st.name || input.partnerName, number: input.number, current: input.text });\n", ""]], T],
  ["و", "«🆕» for a number waiting for review (its first real order)", [[SC,
    "    if (!st.x_review_pending) await announceNewCustomerSafe(", "    if (true) await announceNewCustomerSafe("]], T],
  ["و", "«🆕» for a number that entered review once", [[SC,
    "    if (reviewed !== null) return;\n", ""]], T],
  ["و", "the alert repeated on every message", [[SC,
    "    const claim = await claimButton(env, `newcust:announce:${a.partnerId}`, 365 * 24 * 60 * 60);\n    if (!claim.claimed) return;\n", ""]], T],
  ["و", "the latest message instead of the first", [[SC,
    "      fields: [\"x_body\"], order: \"id asc\", limit: 10,\n    });\n    return rows.map((r) => String(r.x_body || \"\").trim()).find((t) => t && !MEDIA_MARK.test(t)) ?? String(current ?? \"\");",
    "      fields: [\"x_body\"], order: \"id desc\", limit: 10,\n    });\n    return rows.map((r) => String(r.x_body || \"\").trim()).find((t) => t && !MEDIA_MARK.test(t)) ?? String(current ?? \"\");"]], T],
  ["و", "the first message not shortened", [[SC,
    "  const short = first.length > 80 ? `${first.slice(0, 80)}…` : first;", "  const short = first;"]], T],
];

const want = new Set(process.argv.slice(2));
const results = [];
for (const [part, name, edits, test] of M) {
  if (want.size && !want.has(part)) continue;
  const originals = new Map();
  try {
    for (const [file, find, replace] of edits) {
      const path = root + file;
      if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
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
    results.push({ part, name, caught, fails });
    console.log(`${caught ? "✓ caught" : "✗ MISSED"}  [${part}] ${name}${fails.length ? `  — ${fails[0].slice(0, 140)}` : ""}`);
  } finally {
    for (const [path, src] of originals) writeFileSync(path, src);
  }
}
const caught = results.filter((r) => r.caught).length;
writeFileSync(new URL("../artifacts/s44-20260928-mutations.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), caught, total: results.length, results }, null, 2) + "\n");
console.log(`\n${caught}/${results.length} caught`);
if (caught !== results.length) process.exit(1);
