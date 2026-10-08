// § 66 (2026-10-08) — «العميل وافق» → an order: the tenant's side (scripts/lib/s66-odoo.mjs is the data), in TWO parts:
//
//   schema (--only=schema, BEFORE the worker's code: it reads and writes these fields)
//     1  x_special_quote: the acceptance (x_accepted_at, x_delivery_date, x_pay_terms, x_delivery_note, x_accept_expired,
//        x_daily_order_id, x_converted_at, x_confirmed_total); its line's x_confirmed_qty; x_daily_order.x_special_quote_id;
//        x_daily_order_line.x_special_price / x_pack_text / x_special_purchase; x_pricing_config.x_large_order_cartons
//     2  «الحالة» of a request: «مقبول — تحوّل لطلب» (accepted) before «مغلق»
//     3  the two webhooks «✅ العميل وافق» / «📦 حوّل لطلب» (to the PROD worker's special-quote hook) and the sale order's
//        code action «✅ العميل وافق» — on no screen yet; «↩️ أعد فتحه» brings a converted request back «مقبول»
//     4  «حد الطلب الكبير» = 50 on the settings that hold none
//   ui (--only=ui, AFTER the worker's code is deployed: the buttons call ops the worker of before answers 400)
//     5  six extension views: the request's form (the two buttons, the acceptance group, «الكمية المؤكدة», the status bar),
//        its list («مقبول», the delivery date, the order) and its search («مقبول», «بانتظار رد العميل», «انتهت صلاحيته»),
//        the day's order form (the request, «سعر خاص», «التعبئة», «الشراء»), the settings («حد الطلب الكبير»), and the
//        sale order's form («✅ العميل وافق»)
//
//   node scripts/s66-20261008-odoo.mjs --only=schema|ui             dry-run: the plan, nothing written
//   node scripts/s66-20261008-odoo.mjs --only=schema|ui --apply     (the rollback file first)
//   node scripts/s66-20261008-odoo.mjs --only=schema|ui --verify    read-only checks
//   node scripts/s66-20261008-odoo.mjs --probe --apply              ONE throwaway sale order of a test partner: its lines
//                                                                   rewritten as the conversion rewrites a quotation's, confirmed
//                                                                   (state «sale», no stock picking), then cancelled. Nothing else.
//   node scripts/s66-20261008-odoo.mjs --rollback [--apply]         the six extension views off, «↩️ أعد فتحه» as before.
//                                                                   Fields, the state, the actions and the setting stay.
// Rollback file: scripts/artifacts/s66-20261008-odoo-rollback.json. The tenant is production. No WhatsApp send. SQ-0002 and
// S00016 are never read for writing nor written. The hook token is read from an existing action at run time, never printed.
// ROLLBACK ORDER: (1) --rollback (the screens: no button of the new ops), (2) THE CODE. Nothing is deleted.
import {
  APPLY, ROLLBACK, VERIFY, call, checker, ensureFields, ensureServerAction, ensureView, log, modelId, rollbackFile,
} from "./lib/s40-kit.mjs";
import * as L from "./lib/s66-odoo.mjs";

const RB = new URL("./artifacts/s66-20261008-odoo-rollback.json", import.meta.url);
const ctx = rollbackFile(RB, "scripts/s66-20261008-odoo.mjs");
const { rb, save } = ctx;
const b = rb.before;
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const PROBE = process.argv.includes("--probe");
const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const ALL = { active_test: false };
const AR = { lang: "ar_001" };
const PROTECTED_SALE = ["S00015", "S00016"];
const PROBE_PARTNER = 10; // «محمد المحصّل - اختبار»: the test partner of SQ-0003
const viewByName = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "active", "inherit_id", "arch_db", "model", "type", "priority"], context: ALL }))[0] ?? null;
const actionByName = async (name) => (await call("ir.actions.server", "search_read", { domain: [["name", "=", name]], fields: ["id", "name", "state", "model_name", "webhook_url", "code"], context: ALL }))[0] ?? null;
const stateRows = async () => {
  const [f] = await call("ir.model.fields", "search_read", { domain: [["model", "=", L.QUOTE_MODEL], ["name", "=", "x_state"]], fields: ["id"] });
  const rows = f ? await call("ir.model.fields.selection", "search_read", { domain: [["field_id", "=", f.id]], fields: ["id", "value", "name", "sequence"], order: "sequence asc, id asc" }) : [];
  return { f, rows };
};
/** The prod worker's origin and the hook token, from the action Odoo already calls it with. Never printed. */
async function hookBase() {
  const [src] = await call("ir.actions.server", "search_read", { domain: [["name", "=", L.SOURCE_ACTION]], fields: ["webhook_url"], limit: 1 });
  const m = /^https:\/\/([^/]+)\/odoo\/hook\/[a-z-]+\?token=([A-Za-z0-9._~-]+)/.exec(String(src?.webhook_url ?? ""));
  if (!m) throw new Error(`could not read the origin / token from ${L.SOURCE_ACTION}`);
  if (m[1] !== L.PROD_HOST) throw new Error(`${L.SOURCE_ACTION} does not call the prod worker (${m[1]})`);
  return { url: (op) => `https://${m[1]}${L.HOOK_PATH}?token=${m[2]}&op=${op}`, shown: (op) => `https://${m[1]}${L.HOOK_PATH}?token=…&op=${op}` };
}
/** The ids the screens' buttons call: § 62's four, § 66's three. */
async function buttonIds() {
  const names = { ...L.FORM_ACTIONS, approve: L.HOOKS.approve.name, convert: L.HOOKS.convert.name, saleAccept: L.SALE_ACCEPT_ACTION };
  const rows = await call("ir.actions.server", "search_read", { domain: [["name", "in", Object.values(names)]], fields: ["id", "name"], context: ALL });
  return Object.fromEntries(Object.entries(names).map(([k, n]) => [k, rows.find((r) => r.name === n)?.id]));
}
if (!ROLLBACK && !PROBE && ONLY !== "schema" && ONLY !== "ui") { console.log("say which part: --only=schema (before the code) or --only=ui (after the deploy)"); process.exit(2); }

// ---------------------------------------------------------------- rollback (the screens, and «أعد فتحه»)
if (ROLLBACK) {
  log(APPLY ? "ROLLBACK — apply" : "rollback dry-run (nothing is written; add --apply)");
  for (const name of Object.keys(L.views({}))) {
    const v = await viewByName(name);
    if (v?.active) { log(`✎ view ${name} #${v.id}: off`); if (APPLY) await call("ir.ui.view", "write", { ids: [v.id], vals: { active: false } }); }
    else log(`= view ${name}: ${v ? "already off" : "not there"}`);
    await pause(500);
  }
  const reopen = await actionByName(L.REOPEN_ACTION);
  const before = b.reopenCode ?? L.REOPEN_CODE_BEFORE;
  if (reopen && reopen.code !== before) { log(`✎ server action ${L.REOPEN_ACTION} #${reopen.id}: its code of before § 66`); if (APPLY) await call("ir.actions.server", "write", { ids: [reopen.id], vals: { code: before } }); }
  else log(`= server action ${L.REOPEN_ACTION}: as before`);
  log("the fields, the state «مقبول», the three actions and «حد الطلب الكبير» stay (nothing is deleted)");
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

// ---------------------------------------------------------------- probe: a quotation's lines rewritten, confirmed, cancelled
if (PROBE) {
  const { check, done } = checker();
  log(APPLY ? "PROBE — apply (one throwaway sale order: made, rewritten, confirmed, cancelled)" : "probe dry-run (nothing is written; add --apply)");
  const [partner] = await call("res.partner", "search_read", { domain: [["id", "=", PROBE_PARTNER]], fields: ["id", "name"], context: ALL });
  const [service] = await call("product.product", "search_read", { domain: [["default_code", "=", "UTAK-SALE-GOODS"], ["type", "=", "service"]], fields: ["id"], limit: 1 });
  // two storable goods, as a special quotation's lines are (never a product of the day's own list is changed: read only)
  const goods = await call("product.product", "search_read", { domain: [["product_tmpl_id.type", "=", "consu"], ["product_tmpl_id.is_storable", "=", true]], fields: ["id", "display_name"], order: "id asc", limit: 2 });
  const [co] = await call("res.company", "search_read", { domain: [], fields: ["id", "account_sale_tax_id"], limit: 1 });
  const taxId = Array.isArray(co?.account_sale_tax_id) ? co.account_sale_tax_id[0] : 0;
  log(`partner #${partner?.id} «${partner?.name}», the service product #${service?.id}, goods ${goods.map((g) => `#${g.id}`).join(" ")}, the sale tax #${taxId}`);
  if (!APPLY) { log("dry-run: nothing written"); process.exit(0); }
  if (!partner || !service || goods.length < 2 || !taxId) { check("a test partner, the service product, two storable goods and the sale tax", false); done(); }
  rb.created.probe ??= {}; save();
  const line = (g, qty, price, seq) => [0, 0, { product_id: g.id, name: "تجربة § 66", product_uom_qty: qty, price_unit: price, sequence: seq, tax_ids: [[6, 0, [taxId]]] }];
  const [soId] = await call(L.SALE_MODEL, "create", { vals_list: [{ partner_id: partner.id, origin: "S66-PROBE", order_line: [line(goods[0], 1, 139.5, 10), line(goods[1], 1, 73.26, 20)] }] }, { probe: [["origin", "=", "S66-PROBE"], ["state", "=", "draft"]] });
  rb.created.probe.saleOrder = soId; save();
  await pause();
  const [so0] = await call(L.SALE_MODEL, "read", { ids: [soId], fields: ["id", "name", "state", "order_line"] });
  check(`a draft quotation ${so0?.name} #${soId} of two storable lines, as a special request issues it`, so0?.state === "draft" && so0.order_line.length === 2 && !PROTECTED_SALE.includes(so0.name), JSON.stringify(so0));
  const old = await call("sale.order.line", "read", { ids: so0.order_line, fields: ["id", "product_id", "sequence"] });
  const first = old.find((l) => l.product_id[0] === goods[0].id), second = old.find((l) => l.product_id[0] === goods[1].id);
  // the conversion's write: the confirmed line becomes the service product at its confirmed quantity and its locked
  // price (its text and its key kept on it); the line outside the order keeps its product at quantity 0 and price 0
  await call(L.SALE_MODEL, "write", { ids: [soId], vals: { client_order_ref: "UTAK-ORDER-PROBE", order_line: [
    [1, first.id, { product_id: service.id, name: "برتقال — 18 كيلو", product_uom_qty: 9, price_unit: 139.5, tax_ids: [[6, 0, [taxId]]], sequence: 987654 }],
    [1, second.id, { product_uom_qty: 0, price_unit: 0, sequence: 9000000 }],
  ] } });
  await pause();
  const after = await call("sale.order.line", "read", { ids: [first.id, second.id], fields: ["id", "product_id", "name", "product_uom_qty", "price_unit", "tax_ids", "sequence", "price_total", "qty_delivered_method"] });
  const a1 = after.find((l) => l.id === first.id), a2 = after.find((l) => l.id === second.id);
  check("the confirmed line: the service product, its own text, quantity 9, price 139.50 kept as written, the tax, its key as its sequence", a1?.product_id[0] === service.id && a1.name === "برتقال — 18 كيلو" && a1.product_uom_qty === 9 && a1.price_unit === 139.5 && JSON.stringify(a1.tax_ids) === JSON.stringify([taxId]) && a1.sequence === 987654 && Math.abs(a1.price_total - 1255.5) < 0.005, JSON.stringify(a1));
  check("the line outside the order: its own product, quantity 0, price 0", a2?.product_id[0] === goods[1].id && a2.product_uom_qty === 0 && a2.price_unit === 0, JSON.stringify(a2));
  await call(L.SALE_MODEL, "action_confirm", { ids: [soId] });
  await pause();
  const [so1] = await call(L.SALE_MODEL, "read", { ids: [soId], fields: ["id", "name", "state", "locked", "picking_ids", "invoice_ids", "amount_total", "invoice_status"] });
  check("confirmed: state «sale», NO stock picking, no invoice, its total 9 × 139.50 = 1,255.50", so1?.state === "sale" && so1.picking_ids.length === 0 && so1.invoice_ids.length === 0 && Math.abs(so1.amount_total - 1255.5) < 0.005, JSON.stringify(so1));
  const [l1] = await call("sale.order.line", "read", { ids: [first.id], fields: ["id", "qty_delivered_method", "qty_delivered", "qty_to_invoice"] });
  check("the confirmed line is delivered by hand (the delivery writes qty_delivered), nothing to invoice yet", l1?.qty_delivered_method === "manual" && l1.qty_delivered === 0 && l1.qty_to_invoice === 0, JSON.stringify(l1));
  await call(L.SALE_MODEL, "action_cancel", { ids: [soId], context: { disable_cancel_warning: true } }).catch((e) => log(`  action_cancel: ${String(e?.message ?? e).slice(0, 200)}`));
  await pause();
  const [so2] = await call(L.SALE_MODEL, "read", { ids: [soId], fields: ["id", "name", "state", "picking_ids", "invoice_ids"] });
  check(`the probe's order ${so2?.name} is cancelled, with no picking and no invoice left behind`, so2?.state === "cancel" && so2.picking_ids.length === 0 && so2.invoice_ids.length === 0, JSON.stringify(so2));
  rb.created.probe.name = so2?.name; save();
  done();
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  if (ONLY === "schema") {
    for (const [model, defs] of [[L.QUOTE_MODEL, L.QUOTE_FIELDS], [L.LINE_MODEL, L.LINE_FIELDS], [L.ORDER_MODEL, L.ORDER_FIELDS], [L.ORDER_LINE_MODEL, L.ORDER_LINE_FIELDS], [L.CONFIG_MODEL, L.CONFIG_FIELDS]]) {
      const f = await call(model, "fields_get", { attributes: ["type", "string", "selection", "store", "relation"] }).catch(() => ({}));
      const bad = defs.filter((d) => !(f[d.name]?.type === d.ttype && f[d.name].string === d.field_description && f[d.name].store !== false && (!d.relation || f[d.name].relation === d.relation)));
      check(`${model}: ${defs.map((d) => `${d.name} «${d.field_description}»`).join(", ")}`, !bad.length, JSON.stringify(bad.map((d) => [d.name, f[d.name]])));
      if (model === L.QUOTE_MODEL) {
        check("«الحالة»: مسودة / أُرسل للمصادر / مُسعَّر / صدر العرض / مقبول — تحوّل لطلب / مغلق, in that order", JSON.stringify(f.x_state?.selection ?? []) === JSON.stringify(L.STATES), JSON.stringify(f.x_state?.selection));
        check("«طريقة الدفع»: the three terms of the customer's card", JSON.stringify(f.x_pay_terms?.selection ?? []) === JSON.stringify(L.PAY_TERMS), JSON.stringify(f.x_pay_terms?.selection));
      }
      await pause();
    }
    const p = await call("res.partner", "fields_get", { attributes: ["selection"] });
    check("the request's terms are the card's («شروط الدفع»)", JSON.stringify(p.x_pay_terms?.selection ?? []) === JSON.stringify(L.PAY_TERMS), JSON.stringify(p.x_pay_terms?.selection));
    const base = await hookBase();
    for (const h of Object.values(L.HOOKS)) {
      const a = await actionByName(h.name);
      check(`action ${h.name} #${a?.id}: a webhook of ${L.QUOTE_MODEL} → ${base.shown(h.op)}`, a?.state === "webhook" && a.model_name === L.QUOTE_MODEL && a.webhook_url === base.url(h.op));
      await pause(500);
    }
    const sale = await actionByName(L.SALE_ACCEPT_ACTION);
    check(`action ${L.SALE_ACCEPT_ACTION} #${sale?.id}: code of ${L.SALE_MODEL}, as written (no token in it)`, sale?.state === "code" && sale.model_name === L.SALE_MODEL && sale.code === L.SALE_ACCEPT_CODE && !/token=/.test(sale.code ?? ""), JSON.stringify(sale?.code));
    const reopen = await actionByName(L.REOPEN_ACTION);
    check(`action ${L.REOPEN_ACTION} #${reopen?.id}: a converted request comes back «مقبول»`, reopen?.state === "code" && reopen.code === L.REOPEN_CODE, JSON.stringify(reopen?.code));
    const cfgs = await call(L.CONFIG_MODEL, "search_read", { domain: [], fields: ["id", "x_is_active", "x_large_order_cartons"], limit: 20 });
    check(`«حد الطلب الكبير» = ${L.LARGE_ORDER_DEFAULT} on the active settings (${cfgs.filter((c) => c.x_is_active).map((c) => `#${c.id}`).join(" ")})`, cfgs.some((c) => c.x_is_active) && cfgs.filter((c) => c.x_is_active).every((c) => c.x_large_order_cartons === L.LARGE_ORDER_DEFAULT), JSON.stringify(cfgs));
    // the worker's reads and its domain answer
    let how = "";
    const q = await call(L.QUOTE_MODEL, "search_read", { domain: [["x_state", "=", "quoted"], ["x_daily_order_id", "=", false]], fields: ["id", ...L.QUOTE_FIELDS.map((d) => d.name)], limit: 2 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    const l = await call(L.LINE_MODEL, "search_read", { domain: [], fields: ["id", "x_confirmed_qty"], limit: 2 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    const o = await call(L.ORDER_MODEL, "search_read", { domain: [["x_special_quote_id", "!=", false]], fields: ["id", "x_special_quote_id"], limit: 2 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    const ol = await call(L.ORDER_LINE_MODEL, "search_read", { domain: [], fields: ["id", ...L.ORDER_LINE_FIELDS.map((d) => d.name)], limit: 2 }).catch((e) => { how = String(e?.message ?? e).slice(0, 160); return null; });
    check(`the worker's reads of the new fields answer (requests ${q?.length ?? "-"}, lines ${l?.length ?? "-"}, orders ${o?.length ?? "-"}, order lines ${ol?.length ?? "-"})`, [q, l, o, ol].every(Array.isArray), how);
    const none = await call(L.ORDER_MODEL, "search_count", { domain: [["x_special_quote_id", "!=", false]] });
    const flagged = await call(L.ORDER_LINE_MODEL, "search_count", { domain: [["x_special_price", "=", true]] });
    log(`  (orders from a special request now: ${none}; lines «سعر خاص»: ${flagged})`);
  } else {
    const ids = await buttonIds();
    check("the seven actions the buttons call are there", Object.values(ids).every(Boolean), JSON.stringify(ids));
    for (const [name, def] of Object.entries(L.views(ids))) {
      const v = await viewByName(name), p = await viewByName(def.parent);
      check(`the extension ${name} #${v?.id} on ${def.parent} #${p?.id}: active, as written`, !!v?.active && v.inherit_id?.[0] === p?.id && v.arch_db === def.arch, JSON.stringify(v?.arch_db)?.slice(0, 300));
      // the screen loads with it: Odoo combines the parent and its extensions (a broken xpath answers an error here)
      let how = "";
      const r = p ? await call(def.model, "get_view", { view_id: p.id, view_type: def.type }).catch((e) => { how = String(e?.message ?? e).slice(0, 240); return null; }) : null;
      const arch = String(r?.arch ?? "");
      check(`Odoo builds ${def.parent} with it (${def.shows.join(" · ")})`, !!arch && def.shows.every((s) => arch.includes(s)), how || def.shows.filter((s) => !arch.includes(s)).join(" | "));
      await pause(500);
    }
    const form = await viewByName("utak.special_quote_form");
    const built = form ? await call(L.QUOTE_MODEL, "get_view", { view_id: form.id, view_type: "form" }).catch(() => null) : null;
    const header = String(built?.arch ?? "").split("</header>")[0];
    const order = [L.APPROVE_LABEL, L.CONVERT_LABEL, "🔒 أغلق الطلب"].map((s) => header.indexOf(s));
    check("the form's header: «✅ العميل وافق» then «📦 حوّل لطلب», before «🔒 أغلق الطلب»; the status bar shows «مقبول»", order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2] && header.includes("draft,sent,priced,quoted,accepted,closed"), JSON.stringify(order));
  }
  done();
}

// ---------------------------------------------------------------- apply (dry by default)
log(APPLY ? `APPLY — ${ONLY}` : `dry-run — ${ONLY} (nothing is written; add --apply)`);
save(); // the rollback file before the first write

if (ONLY === "schema") {
  log("— 1: the fields");
  for (const [model, defs] of [[L.QUOTE_MODEL, L.QUOTE_FIELDS], [L.LINE_MODEL, L.LINE_FIELDS], [L.ORDER_MODEL, L.ORDER_FIELDS], [L.ORDER_LINE_MODEL, L.ORDER_LINE_FIELDS], [L.CONFIG_MODEL, L.CONFIG_FIELDS]]) {
    await ensureFields(ctx, model, await modelId(model), defs);
    await pause();
  }
  log("— 2: «الحالة»: «مقبول — تحوّل لطلب» before «مغلق»");
  {
    const { f, rows } = await stateRows();
    if (!f) throw new Error("x_special_quote.x_state is not there — stop");
    b.stateRows ??= rows.map((r) => ({ id: r.id, value: r.value, name: r.name, sequence: r.sequence }));
    save();
    for (const [i, [value, name]] of L.STATES.entries()) {
      const row = rows.find((r) => r.value === value);
      if (row && row.sequence === i) { log(`= «الحالة» ${value}: «${row.name}» (${i})`); continue; }
      if (row) {
        log(`✎ «الحالة» ${value}: sequence ${row.sequence} → ${i}`);
        if (APPLY) { await call("ir.model.fields.selection", "write", { ids: [row.id], vals: { sequence: i } }); await pause(300); }
      } else {
        log(`+ «الحالة» ${value}: «${name}» (sequence ${i})`);
        if (APPLY) {
          const [id] = await call("ir.model.fields.selection", "create", { vals_list: [{ field_id: f.id, value, name, sequence: i }] });
          rb.created.acceptedSelection = id; save();
          await call("ir.model.fields.selection", "write", { ids: [id], vals: { name }, context: AR });
          await pause(300);
        }
      }
    }
  }
  log("— 3: the actions");
  const base = await hookBase();
  log(`hook: ${base.shown("<op>")} (the token is read from «${L.SOURCE_ACTION}», not printed)`);
  const quoteMid = await modelId(L.QUOTE_MODEL), saleMid = await modelId(L.SALE_MODEL);
  for (const [key, h] of Object.entries(L.HOOKS)) {
    await ensureServerAction(ctx, key, h.name, { model_id: quoteMid, state: "webhook", webhook_url: base.url(h.op), webhook_field_ids: [[6, 0, []]] });
    await pause(500);
  }
  for (const l of L.SALE_ACCEPT_CODE.split("\n")) log(`    ${l}`);
  await ensureServerAction(ctx, "saleAccept", L.SALE_ACCEPT_ACTION, { model_id: saleMid, state: "code", code: L.SALE_ACCEPT_CODE });
  {
    const have = await actionByName(L.SALE_ACCEPT_ACTION);
    if (have && have.code !== L.SALE_ACCEPT_CODE) { log(`✎ server action ${L.SALE_ACCEPT_ACTION} #${have.id}: its code, as written here`); if (APPLY) await call("ir.actions.server", "write", { ids: [have.id], vals: { code: L.SALE_ACCEPT_CODE } }); }
  }
  await pause(500);
  {
    const reopen = await actionByName(L.REOPEN_ACTION);
    if (!reopen) throw new Error(`${L.REOPEN_ACTION} is not there — stop`);
    if (reopen.code === L.REOPEN_CODE) log(`= server action ${L.REOPEN_ACTION} #${reopen.id}: a converted request comes back «مقبول»`);
    else {
      log(`✎ server action ${L.REOPEN_ACTION} #${reopen.id}: a converted request comes back «مقبول», never «صدر العرض»`);
      b.reopenCode ??= reopen.code; save();
      if (APPLY) await call("ir.actions.server", "write", { ids: [reopen.id], vals: { code: L.REOPEN_CODE } });
    }
  }
  await pause(500);
  log(`— 4: «حد الطلب الكبير» = ${L.LARGE_ORDER_DEFAULT}`);
  {
    const cfgs = await call(L.CONFIG_MODEL, "search_read", { domain: [], fields: ["id", "x_name", "x_is_active", "x_large_order_cartons"], limit: 20 }).catch(() => null);
    if (!cfgs) log(`+ «حد الطلب الكبير» = ${L.LARGE_ORDER_DEFAULT} on the active settings (the field is not there yet)`);
    for (const c of cfgs ?? []) {
      if (!c.x_is_active || c.x_large_order_cartons > 0) { log(`= settings #${c.id}: ${c.x_is_active ? `«حد الطلب الكبير» ${c.x_large_order_cartons}` : "not the active one — left"}`); continue; }
      log(`✎ settings #${c.id} «${c.x_name}»: «حد الطلب الكبير» ← ${L.LARGE_ORDER_DEFAULT}`);
      b.largeOrder ??= {}; b.largeOrder[c.id] ??= c.x_large_order_cartons; save();
      if (APPLY) await call(L.CONFIG_MODEL, "write", { ids: [c.id], vals: { x_large_order_cartons: L.LARGE_ORDER_DEFAULT } });
    }
  }
  save();
  log(APPLY ? "done — verify: node scripts/s66-20261008-odoo.mjs --only=schema --verify" : "dry-run: nothing written");
  process.exit(0);
}

// ui
log("— 5: the six extension views");
const ids = await buttonIds();
const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { log(`✗ actions not found: ${missing.join(", ")} — run --only=schema first`); process.exit(1); }
for (const [name, def] of Object.entries(L.views(ids))) {
  const p = await viewByName(def.parent);
  if (!p) { log(`✗ the view ${def.parent} is not there`); process.exit(1); }
  const have = await viewByName(name);
  if (have && !have.active) {
    log(`✎ view ${name} #${have.id}: on again`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { active: true, arch_base: def.arch } });
  } else if (have && have.arch_db !== def.arch) {
    log(`✎ view ${name} #${have.id}: its arch, as written here`);
    if (APPLY) await call("ir.ui.view", "write", { ids: [have.id], vals: { arch_base: def.arch } });
  } else await ensureView(ctx, name, name, { model: def.model, inherit_id: p.id, mode: "extension", priority: 99, arch_base: def.arch });
  await pause(600);
}
save();
log(APPLY ? "done — verify: node scripts/s66-20261008-odoo.mjs --only=ui --verify" : "dry-run: nothing written");
