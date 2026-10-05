// § 49 (2026-10-01) — what § 49 changes in Odoo (scripts/lib/s49-ui.mjs is the source of every
// name, text, Python and arch piece):
//   أ  x_pricing_config   «الحد الأدنى للطلب (ريال)» 150 → 0 on the active record (0 = no minimum),
//                         and the field's help says what 0 means.
//   ب  x_daily_order      x_price_date «أسعار يوم», x_awaiting_prices «بانتظار أسعار اليوم».
//   ج  x_daily_order      x_immediate_delivery «تسليم فوري (من السيارة)».
//   د  res.partner / hr.employee   x_price_role «دور الأسعار» (شراء / سوق): Ahmed Hassan (#30) = شراء,
//                         Omar (employee #4) = سوق; shown on the source's card, in «⚙️ الإعدادات» and in
//                         «📥 عروض المصادر» (x_sources_note, computed), edited in two lists.
//   هـ x_price_day_line / x_daily_price / x_price_offer   x_item_show (the item's full name and its
//                         packaging, never cut — a text cell wraps) and x_item_code (the UTAK-… code):
//                         first in the table and on the card of «📊 اليوم», in «📥 عروض المصادر», and in
//                         the list of «📈 ربح الأصناف عبر الأيام» («📅 الأيام السابقة»; a day opened from
//                         that screen is the screen of «📊 اليوم» itself).
//
//   node scripts/s49-20261001-odoo.mjs                    dry-run: the plan, nothing written
//   node scripts/s49-20261001-odoo.mjs --apply            rollback file first, then write (idempotent)
//   node scripts/s49-20261001-odoo.mjs --verify           read-only checks
//   node scripts/s49-20261001-odoo.mjs --rollback [--apply]          views, the minimum (150), the two roles, the help back
//   node scripts/s49-20261001-odoo.mjs --rollback --drop [--apply]   and delete what this script created
//                                                                    (only after the worker's code is rolled back: it reads and writes the new fields)
//
// Rollback file: scripts/artifacts/s49-20261001-odoo-rollback.json. The tenant is production: no
// order, invoice, payment, price or price day is written here. No WhatsApp. Nothing deleted.
import {
  APPLY, DROP, ROLLBACK, VERIFY, call, checker, dropCreated, ensureActWindow, ensureFields, ensureView, log, modelId, one, rollbackFile,
} from "./lib/s40-kit.mjs";
import {
  CARD_ROLE, CFG_FIELDS, DAILY_PRICE_FIELDS, DAY_FIELDS, EMPLOYEE_FIELDS, LINE_FIELDS, MIN_ORDER_HELP, MIN_ORDER_LABEL, MIN_ORDER_SAR, OFFER_FIELDS, ORDER_FIELDS, ORDER_FORM,
  PARENT_VIEW, PARTNER_FIELDS, ROLE, ROLES_TO_SET, SOURCE_DOMAIN, SOURCE_EMPLOYEES_LIST, SOURCE_PARTNERS_LIST, VIEW, WINDOW, boardListArch, dayArch, marketListArch, purchaseListArch,
  settingsArch, sourcesArch,
} from "./lib/s49-ui.mjs";

const RB = new URL("./artifacts/s49-20261001-odoo-rollback.json", import.meta.url);
const ORDER = "x_daily_order", DAY = "x_price_day", LINE = "x_price_day_line", CFG = "x_pricing_config", DP = "x_daily_price", PO = "x_price_offer", PARTNER = "res.partner", EMP = "hr.employee";
const ALL = { active_test: false };
const ctx = rollbackFile(RB, "scripts/s49-20261001-odoo.mjs");
const { rb, save } = ctx;
const pause = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const viewOf = async (name) => (await call("ir.ui.view", "search_read", { domain: [["name", "=", name]], fields: ["id", "arch_db", "model", "type", "inherit_id"], context: ALL }))[0];
const windowOf = async (name) => (await call("ir.actions.act_window", "search_read", { domain: [["name", "=", name]], fields: ["id", "res_model", "view_mode", "domain", "context", "view_id"], context: ALL }))[0];
const fieldHave = async (model, name) => !!(await one("ir.model.fields", [["model", "=", model], ["name", "=", name]]));
const activeConfig = async (fields) => {
  const today = riyadhToday();
  return (await call(CFG, "search_read", { domain: [["x_is_active", "=", true], ["x_active_from", "<=", today], "|", ["x_active_to", "=", false], ["x_active_to", ">=", today]], fields, order: "x_active_from desc, id desc", limit: 1 }))[0];
};

// ---------------------------------------------------------------- rollback
if (ROLLBACK) {
  const b = rb.before, c = rb.created;
  for (const [k, v] of Object.entries(b.views ?? {})) log(`view ${k} #${v.id}: arch back`);
  for (const f of b.fieldTexts ?? []) log(`field #${f.id} ${f.name}: label / help back`);
  if (b.config) log(`${CFG} #${b.config.id}: x_min_order_sar back to ${b.config.x_min_order_sar}`);
  for (const r of b.roles ?? []) log(`${r.model} #${r.id}: x_price_role back to ${r.x_price_role || "∅"}`);
  for (const id of Object.values(c.views ?? {})) log(`view #${id} (created): ${DROP ? "dropped" : "active = false"}`);
  if (APPLY) {
    for (const v of Object.values(b.views ?? {})) await call("ir.ui.view", "write", { ids: [v.id], vals: { arch_base: v.arch } });
    for (const f of b.fieldTexts ?? []) await call("ir.model.fields", "write", { ids: [f.id], vals: f.vals });
    if (b.config) await call(CFG, "write", { ids: [b.config.id], vals: { x_min_order_sar: b.config.x_min_order_sar } });
    if (!DROP) for (const r of b.roles ?? []) await call(r.model, "write", { ids: [r.id], vals: { x_price_role: r.x_price_role || false } });
    const inherited = ["partnerRole", "employeeRole", "orderForm"].map((k) => c.views?.[k]).filter(Boolean);
    if (inherited.length && !DROP) await call("ir.ui.view", "write", { ids: inherited, vals: { active: false } });
  }
  if (DROP) {
    await dropCreated(rb, [
      ["ir.actions.act_window", Object.values(c.windows ?? {})], ["ir.ui.view", Object.values(c.views ?? {})], ["ir.model.fields", [...(c.fields ?? [])].reverse()],
    ]);
  }
  log(APPLY ? "rollback done" : "dry-run: nothing written (add --apply)");
  process.exit(0);
}

async function resolve() {
  const v = {}, a = {};
  for (const [k, name] of Object.entries(VIEW)) v[k] = (await viewOf(name))?.id ?? null;
  for (const [k, name] of Object.entries(WINDOW)) a[k] = (await windowOf(name))?.id ?? null;
  return { v, a };
}

// ---------------------------------------------------------------- verify
if (VERIFY) {
  const { check, done } = checker();
  const { v, a } = await resolve();
  check("every view and window of § 49 exists", Object.values(v).every(Boolean) && Object.values(a).every(Boolean), JSON.stringify({ v, a }));
  // أ — the minimum order
  const cf = await call(CFG, "fields_get", { attributes: ["type", "string", "help"] });
  const cfg = await activeConfig(["id", "x_min_order_sar", "x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_outlier_ratio", "x_planned_stops", "x_sources_note"]);
  check(`أ — active settings #${cfg?.id}: «${MIN_ORDER_LABEL}» = ${MIN_ORDER_SAR}`, cfg?.x_min_order_sar === MIN_ORDER_SAR && cf.x_min_order_sar?.string === MIN_ORDER_LABEL, JSON.stringify([cfg?.x_min_order_sar, cf.x_min_order_sar?.string]));
  check("أ — the field's help says what 0 means", cf.x_min_order_sar?.help === MIN_ORDER_HELP, cf.x_min_order_sar?.help);
  if (rb.before.config) check("أ — the other settings untouched (التالف، الربح الأدنى، الكراتين، نسبة الشاذ، المحطات)", ["x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_outlier_ratio", "x_planned_stops"].every((f) => cfg?.[f] === rb.before.config[f]), JSON.stringify(cfg));
  const tiers = await call("x_pricing_tier", "search_read", { domain: [["x_config_id", "=", cfg.id]], fields: ["id", "x_amount_from", "x_amount_to", "x_discount_pct", "x_active"], order: "id" });
  if (rb.before.tiers) check(`أ — the ${tiers.length} discount tiers as they were`, JSON.stringify(tiers) === JSON.stringify(rb.before.tiers), JSON.stringify(tiers));
  await pause();
  // ب / ج — the order's fields
  const of = await call(ORDER, "fields_get", { attributes: ["type", "string"] });
  for (const d of ORDER_FIELDS) check(`ب/ج — ${ORDER}.${d.name} ${d.ttype} «${d.field_description}»`, of[d.name]?.type === d.ttype && of[d.name]?.string === d.field_description, JSON.stringify(of[d.name]));
  const oArch = String((await call(ORDER, "get_views", { views: [[false, "form"]] }))?.views?.form?.arch ?? "");
  check("ب/ج — the order's form shows «أسعار يوم», «بانتظار أسعار اليوم» and «تسليم فوري», read-only", ORDER_FIELDS.every((d) => new RegExp(`name="${d.name}"[^>]*readonly="1"`).test(oArch)), oArch.slice(0, 300));
  // د — the role
  for (const m of [PARTNER, EMP]) {
    const f = (await call(m, "fields_get", { attributes: ["type", "string", "selection"] })).x_price_role;
    check(`د — ${m}.x_price_role selection «دور الأسعار»: شراء / سوق`, f?.type === "selection" && f.string === "دور الأسعار" && JSON.stringify(f.selection) === JSON.stringify([["purchase", ROLE.purchase], ["market", ROLE.market]]), JSON.stringify(f));
  }
  for (const r of ROLES_TO_SET) {
    const [row] = await call(r.model, "read", { ids: [r.id], fields: ["id", "name", "x_price_role", "x_price_source"] });
    check(`د — ${r.model} #${r.id} ${row?.name}: مصدر أسعار، ودوره «${ROLE[r.role]}»`, row?.x_price_source === true && row.x_price_role === r.role && String(row.name).includes(r.name.split(" ")[0]), JSON.stringify(row));
  }
  const sources = [
    ...(await call(PARTNER, "search_read", { domain: [["x_price_source", "=", true]], fields: ["id", "name", "x_price_role"], context: ALL })).map((p) => ({ ...p, model: PARTNER })),
    ...(await call(EMP, "search_read", { domain: [["x_price_source", "=", true]], fields: ["id", "name", "x_price_role"], context: ALL })).map((p) => ({ ...p, model: EMP })),
  ];
  const others = sources.filter((s) => !ROLES_TO_SET.some((r) => r.model === s.model && r.id === s.id));
  // § 52 (2026-10-04) added ONE outside market source — رائد, res.partner #109, «سوق» — and § 57 ب reads it so: he is the only
  // source beside the two of § 49 that may carry a role, his role is «سوق» (never «شراء»: «أقل عرض» is made of purchase prices
  // alone), and no other source carries one. (The check failed from § 52 on: it knew the two of § 49 only.)
  const OUTSIDE_MARKET = { model: PARTNER, id: 109, name: "رائد", role: "market" };
  const outside = others.filter((s) => s.model === OUTSIDE_MARKET.model && s.id === OUTSIDE_MARKET.id);
  const rest = others.filter((s) => !(s.model === OUTSIDE_MARKET.model && s.id === OUTSIDE_MARKET.id));
  check(`د — one outside market source is allowed (${OUTSIDE_MARKET.model} #${OUTSIDE_MARKET.id} ${OUTSIDE_MARKET.name}: «${ROLE[OUTSIDE_MARKET.role]}»), and no other source carries a role (${rest.length} other source${rest.length === 1 ? "" : "s"})`,
    outside.length === 1 && outside[0].x_price_role === OUTSIDE_MARKET.role && String(outside[0].name).includes(OUTSIDE_MARKET.name) && rest.every((s) => !s.x_price_role), JSON.stringify(others));
  check(`د — the line the screens show: «${cfg?.x_sources_note}»`, ROLES_TO_SET.every((r) => String(cfg?.x_sources_note).includes(`${r.name}: ${ROLE[r.role]}`)), cfg?.x_sources_note);
  const sArch = String((await call(CFG, "get_views", { views: [[v.settings, "form"]] }))?.views?.form?.arch ?? "");
  check("د — «⚙️ الإعدادات» renders the roles (the line, the rule, the two lists' buttons), and «الحد الأدنى للطلب» is still there", sArch.includes('name="x_sources_note"') && sArch.includes(`name="${a.sourcePartners}"`) && sArch.includes(`name="${a.sourceEmployees}"`) && sArch.includes('name="x_min_order_sar"') && sArch.includes('name="x_cost_line_ids"') && sArch.includes('name="x_tier_ids"'));
  const noteOf = (arch) => /<div class="alert alert-info[^"]*" role="status"><strong>دور الأسعار:<\/strong>[\s\S]*?<\/div>\s*<\/div>/.exec(arch)?.[0] ?? "";
  check("د — the links to the two lists sit under the note, not inside it (a link on the light-blue note is 3.93:1)", noteOf(sArch).length > 0 && !/<button/.test(noteOf(sArch)), noteOf(sArch).slice(0, 200));
  const srcArch = String((await call(DAY, "get_views", { views: [[v.sources, "form"]] }))?.views?.form?.arch ?? "");
  check("د — «📥 عروض المصادر» renders the roles too, its links under the note", srcArch.includes('name="x_sources_note"') && srcArch.includes(`name="${a.sourcePartners}"`) && noteOf(srcArch).length > 0 && !/<button/.test(noteOf(srcArch)));
  const wp = await windowOf(WINDOW.sourcePartners), we = await windowOf(WINDOW.sourceEmployees);
  check("د — the two lists the role is edited in: the sources alone, on their own list views", wp?.res_model === PARTNER && wp.view_id?.[0] === v.sourcePartners && wp.domain === SOURCE_DOMAIN && we?.res_model === EMP && we.view_id?.[0] === v.sourceEmployees && we.domain === SOURCE_DOMAIN, JSON.stringify([wp, we]));
  for (const [m, view] of [[PARTNER, v.sourcePartners], [EMP, v.sourceEmployees]]) {
    const arch = String((await call(m, "get_views", { views: [[view, "list"]] }))?.views?.list?.arch ?? "");
    check(`د — ${m}: the list renders, «دور الأسعار» editable in the row`, /<list[^>]*editable="bottom"/.test(arch) && /name="x_price_role"/.test(arch) && !/name="x_price_role"[^>]*readonly/.test(arch), arch.slice(0, 200));
    const card = String((await call(m, "get_views", { views: [[false, "form"]] }))?.views?.form?.arch ?? "");
    const at = (f) => card.indexOf(`name="${f}"`);
    check(`د — ${m}: the source's own card shows «دور الأسعار» after «مصدر أسعار», only for a source`, at("x_price_source") > 0 && at("x_price_role") > at("x_price_source") && /name="x_price_role"[^>]*invisible="not x_price_source"/.test(card), `${at("x_price_source")} / ${at("x_price_role")}`);
  }
  await pause();
  // هـ — the item's full name
  for (const [m, defs] of [[LINE, LINE_FIELDS], [DP, DAILY_PRICE_FIELDS], [PO, OFFER_FIELDS]]) {
    const f = await call(m, "fields_get", { attributes: ["type", "string", "store"] });
    check(`هـ — ${m}.x_item_show text (it wraps in a table, never cut) and x_item_code char, neither stored`, f.x_item_show?.type === "text" && f.x_item_show.store === false && f.x_item_code?.type === "char" && f.x_item_code.store === false && defs.length === 2, JSON.stringify([f.x_item_show, f.x_item_code]));
  }
  const [day] = await call(DAY, "search_read", { domain: [["x_utak_simulation", "!=", true]], fields: ["id", "x_date"], order: "x_date desc, id desc", limit: 1 });
  const lines = await call(LINE, "search_read", { domain: [["x_day_id", "=", day.id]], fields: ["id", "x_name", "x_product_tmpl_id", "x_packaging_id", "x_item_show", "x_item_code"], order: "id asc" });
  const prods = await call("product.template", "read", { ids: [...new Set(lines.map((l) => l.x_product_tmpl_id?.[0]).filter(Boolean))], fields: ["id", "name", "default_code"] });
  const packs = await call("x_product_packaging", "read", { ids: [...new Set(lines.map((l) => l.x_packaging_id?.[0]).filter(Boolean))], fields: ["id", "x_name"] });
  const want = (l) => [prods.find((p) => p.id === l.x_product_tmpl_id?.[0])?.name, packs.find((k) => k.id === l.x_packaging_id?.[0])?.x_name].filter(Boolean).join(" — ");
  check(`هـ — the ${lines.length} lines of day #${day.id} (${day.x_date}): the name whole, no code in it, the code apart`,
    lines.length > 0 && lines.every((l) => l.x_item_show === want(l) && !/\[|UTAK-/.test(l.x_item_show) && !l.x_item_show.includes("…") && l.x_item_code === (prods.find((p) => p.id === l.x_product_tmpl_id?.[0])?.default_code || false)),
    JSON.stringify(lines.map((l) => [l.id, l.x_item_show, l.x_item_code])));
  for (const l of lines) log(`    #${l.id}: «${l.x_item_show}» · ${l.x_item_code}`);
  const dArch = String((await call(DAY, "get_views", { views: [[v.day, "form"]] }))?.views?.form?.arch ?? "");
  // § 56 (2026-10-05) — the day's table is read-only now (scripts/lib/s56-ui.mjs): the lines' own list, editable or not
  const listPart = /<list[\s\S]*?<\/list>/.exec(dArch.slice(dArch.indexOf('name="x_line_ids"')))?.[0] ?? "";
  const linePart = /<form string="تفاصيل الصنف">[\s\S]*?<\/form>/.exec(dArch)?.[0] ?? "";
  const firstShown = [...listPart.matchAll(/<field name="(\w+)"([^>]*)\/>/g)].find((m) => !/column_invisible/.test(m[2]));
  check("هـ — «📊 اليوم»: the table's first column is the item's full name; the code is a column of its own, hidden by default; no «[UTAK-…] name» column left", firstShown?.[1] === "x_item_show" && /name="x_item_code"[^>]*optional="hide"/.test(listPart) && !/name="x_product_tmpl_id"/.test(listPart), listPart.slice(0, 400));
  check("هـ — …«قرار براء» and «السعر المعدّل» still edited in Odoo (§ 56: in the line's own form, its title the item's full name), the «—» columns in the table and «بدون خسارة», «البيع», «معاينة» in that form", /name="x_decision"/.test(linePart) && /name="x_manual_price"[^>]*invisible=/.test(linePart) && /<h2><field name="x_item_show"/.test(linePart)
    && ["x_cost_show", "x_market_show"].every((f) => listPart.includes(`name="${f}"`)) && ["x_even_show", "x_sale_show", "x_profit_show"].every((f) => linePart.includes(`name="${f}"`)));
  const cardPart = /<kanban[\s\S]*?<\/kanban>/.exec(dArch)?.[0] ?? "";
  check("هـ — the phone's card: the full name first (bold), the code under it in small text", /name="x_item_show"[^>]*class="fw-bold fs-5"/.test(cardPart) && /class="small text-muted"[^>]*>\s*<field name="x_item_code"/.test(cardPart) && cardPart.indexOf('name="x_item_show"') < cardPart.indexOf('name="x_cost_show"') && !/name="x_name"/.test(cardPart), cardPart.slice(0, 500));
  for (const [label, model, view, type] of [["ردود الشراء", DP, v.purchaseList, "list"], ["مشاهدات السوق", PO, v.marketList, "list"], ["📅 الأيام السابقة ← 📈 ربح الأصناف عبر الأيام", LINE, v.boardList, "list"]]) {
    const arch = String((await call(model, "get_views", { views: [[view, type]] }))?.views?.[type]?.arch ?? "");
    const first = [...arch.matchAll(/<field name="(\w+)"([^>]*)\/>/g)].find((m) => m[1] !== "x_day_date");
    check(`هـ — «${label}» (the list of its own): the item's full name first, the code hidden, no «[UTAK-…] name» column`, first?.[1] === "x_item_show" && /name="x_item_code"[^>]*optional="hide"/.test(arch) && !/name="x_product_tmpl_id"/.test(arch), arch.slice(0, 300));
  }
  const tabs = [...srcArch.matchAll(/<list[^>]*>([\s\S]*?)<\/list>/g)].map((m) => [...m[1].matchAll(/<field name="(\w+)"/g)][0]?.[1]);
  check("هـ — «📥 عروض المصادر»: the item's full name first in the purchase and the market tabs", tabs[0] === "x_item_show" && tabs[1] === "x_item_show", JSON.stringify(tabs));
  const [lock] = await call("base.automation", "read", { ids: [23], fields: ["trigger_field_ids", "active"] });
  const newIds = [await one("ir.model.fields", [["model", "=", LINE], ["name", "=", "x_item_show"]]), await one("ir.model.fields", [["model", "=", LINE], ["name", "=", "x_item_code"]])];
  check("the lock automation #23 does not watch the new line fields", lock?.active === true && newIds.every((id) => id && !(lock.trigger_field_ids ?? []).includes(id)));
  done();
}

// ---------------------------------------------------------------- plan / apply
save(); // the rollback file before the first write
rb.before.views ??= {}; rb.before.fieldTexts ??= []; rb.before.roles ??= [];

// 1. the fields
for (const [model, defs] of [[ORDER, ORDER_FIELDS], [PARTNER, PARTNER_FIELDS], [EMP, EMPLOYEE_FIELDS], [LINE, LINE_FIELDS], [DP, DAILY_PRICE_FIELDS], [PO, OFFER_FIELDS], [DAY, DAY_FIELDS], [CFG, CFG_FIELDS]]) {
  await ensureFields(ctx, model, await modelId(model), defs);
  await pause(300);
}

// 2. أ — the minimum order: 0, and what 0 means
const text = async (model, name, vals) => {
  const [f] = await call("ir.model.fields", "search_read", { domain: [["model", "=", model], ["name", "=", name]], fields: ["id", "field_description", "help"] });
  if (!f) throw new Error(`${model}.${name} not found — stop`);
  const diff = Object.fromEntries(Object.entries(vals).filter(([k, v]) => (f[k] || "") !== v));
  if (!Object.keys(diff).length) { log(`= ${model}.${name} label / help`); return; }
  log(`✎ ${model}.${name}: ${Object.entries(diff).map(([k, v]) => `${k} «${f[k] || ""}» → «${v}»`).join(" · ")}`);
  if (!APPLY) return;
  if (!rb.before.fieldTexts.some((x) => x.id === f.id)) { rb.before.fieldTexts.push({ id: f.id, name: `${model}.${name}`, vals: Object.fromEntries(Object.keys(diff).map((k) => [k, f[k]])) }); save(); }
  await call("ir.model.fields", "write", { ids: [f.id], vals: diff });
};
await text(CFG, "x_min_order_sar", { field_description: MIN_ORDER_LABEL, help: MIN_ORDER_HELP });
const cfg = await activeConfig(["id", "x_name", "x_min_order_sar", "x_waste_pct", "x_min_profit_sar", "x_expected_cartons", "x_outlier_ratio", "x_planned_stops"]);
if (!cfg) throw new Error("no active x_pricing_config — stop");
if (cfg.x_min_order_sar === MIN_ORDER_SAR) log(`= config #${cfg.id} x_min_order_sar ${MIN_ORDER_SAR}`);
else {
  log(`✎ config #${cfg.id} (${cfg.x_name}): x_min_order_sar ${cfg.x_min_order_sar} → ${MIN_ORDER_SAR} (the discount tiers and every other setting as they are)`);
  if (APPLY) {
    rb.before.config ??= { ...cfg };
    rb.before.tiers ??= await call("x_pricing_tier", "search_read", { domain: [["x_config_id", "=", cfg.id]], fields: ["id", "x_amount_from", "x_amount_to", "x_discount_pct", "x_active"], order: "id" });
    save();
    await call(CFG, "write", { ids: [cfg.id], vals: { x_min_order_sar: MIN_ORDER_SAR } });
  }
}

// 3. د — the two roles (no other source is written)
for (const r of ROLES_TO_SET) {
  if (!(await fieldHave(r.model, "x_price_role"))) { log(`+ ${r.model} #${r.id} ${r.name}: x_price_role → ${r.role} («${ROLE[r.role]}») once the field exists`); continue; }
  const [row] = await call(r.model, "read", { ids: [r.id], fields: ["id", "name", "x_price_source", "x_price_role"] });
  if (!row || row.x_price_source !== true || !String(row.name).includes(r.name.split(" ")[0])) throw new Error(`${r.model} #${r.id} is not the source «${r.name}»: ${JSON.stringify(row)} — stop`);
  if (row.x_price_role === r.role) { log(`= ${r.model} #${r.id} ${row.name}: دور الأسعار «${ROLE[r.role]}»`); continue; }
  log(`✎ ${r.model} #${r.id} ${row.name}: x_price_role ${row.x_price_role || "∅"} → ${r.role} («${ROLE[r.role]}»)`);
  if (APPLY) {
    if (!rb.before.roles.some((x) => x.model === r.model && x.id === r.id)) { rb.before.roles.push({ model: r.model, id: r.id, x_price_role: row.x_price_role || false }); save(); }
    await call(r.model, "write", { ids: [r.id], vals: { x_price_role: r.role } });
  }
}
await pause();

// 4. the new views and the two windows
const parent = {};
for (const [k, name] of Object.entries(PARENT_VIEW)) {
  parent[k] = (await viewOf(name))?.id;
  if (!parent[k]) throw new Error(`view ${name} not found — stop`);
}
const fieldsReady = (await fieldHave(PARTNER, "x_price_role")) && (await fieldHave(EMP, "x_price_role")) && (await fieldHave(ORDER, "x_price_date")) && (await fieldHave(LINE, "x_item_show")) && (await fieldHave(CFG, "x_sources_note")) && (await fieldHave(DAY, "x_sources_note"));
if (!fieldsReady && !APPLY) log("· (dry-run) the new fields do not exist yet: the views that name them are planned, and written with --apply");
if (fieldsReady) {
  await ensureView(ctx, "sourcePartners", VIEW.sourcePartners, { model: PARTNER, type: "list", priority: 95, arch_base: SOURCE_PARTNERS_LIST });
  await ensureView(ctx, "sourceEmployees", VIEW.sourceEmployees, { model: EMP, type: "list", priority: 95, arch_base: SOURCE_EMPLOYEES_LIST });
  await ensureView(ctx, "partnerRole", VIEW.partnerRole, { model: PARTNER, type: "form", inherit_id: parent.partnerRole, mode: "extension", priority: 99, arch_base: CARD_ROLE });
  await ensureView(ctx, "employeeRole", VIEW.employeeRole, { model: EMP, type: "form", inherit_id: parent.employeeRole, mode: "extension", priority: 99, arch_base: CARD_ROLE });
  await ensureView(ctx, "orderForm", VIEW.orderForm, { model: ORDER, type: "form", inherit_id: parent.orderForm, mode: "extension", priority: 99, arch_base: ORDER_FORM });
} else for (const k of ["sourcePartners", "sourceEmployees", "partnerRole", "employeeRole", "orderForm"]) log(`+ view ${VIEW[k]}`);
let { v, a } = await resolve();
if (v.sourcePartners && v.sourceEmployees) {
  await ensureActWindow(ctx, "sourcePartners", WINDOW.sourcePartners, { res_model: PARTNER, view_mode: "list,form", view_id: v.sourcePartners, domain: SOURCE_DOMAIN, context: "{'create': False}" });
  await ensureActWindow(ctx, "sourceEmployees", WINDOW.sourceEmployees, { res_model: EMP, view_mode: "list,form", view_id: v.sourceEmployees, domain: SOURCE_DOMAIN, context: "{'create': False}" });
  ({ v, a } = await resolve());
} else for (const k of ["sourcePartners", "sourceEmployees"]) log(`+ act_window ${WINDOW[k]}`);
// a view switched off by a rollback comes back
const off = Object.values(rb.created.views ?? {}).filter(Boolean);
if (off.length) {
  const dead = await call("ir.ui.view", "search_read", { domain: [["id", "in", off], ["active", "=", false]], fields: ["id"], context: ALL });
  if (dead.length) { log(`✎ views switched off by a rollback: on again (${dead.map((x) => `#${x.id}`).join(" ")})`); if (APPLY) await call("ir.ui.view", "write", { ids: dead.map((x) => x.id), vals: { active: true } }); }
}

// 5. the archs of § 48's screens: the pieces § 49 changes
const edit = async (key, name, change) => {
  const cur = await viewOf(name);
  if (!cur) throw new Error(`view ${name} not found — stop`);
  const want = change(cur.arch_db);
  if (want === cur.arch_db) { log(`= view ${name} #${cur.id}`); return; }
  log(`✎ view ${name} #${cur.id}: ${cur.arch_db.length} → ${want.length} characters`);
  if (!APPLY) return;
  rb.before.views[key] ??= { id: cur.id, arch: cur.arch_db }; save();
  await call("ir.ui.view", "write", { ids: [cur.id], vals: { arch_base: want } });
};
if (fieldsReady) {
  await edit("day", VIEW.day, dayArch);
  await edit("purchaseList", VIEW.purchaseList, purchaseListArch);
  await edit("marketList", VIEW.marketList, marketListArch);
  await edit("boardList", VIEW.boardList, boardListArch);
  if (a.sourcePartners && a.sourceEmployees) {
    await edit("sources", VIEW.sources, (arch) => sourcesArch(arch, a));
    await edit("settings", VIEW.settings, (arch) => settingsArch(arch, a));
  } else log("· the roles block of «📥 عروض المصادر» and «⚙️ الإعدادات» is written once the two windows exist (--apply)");
} else {
  // the plan, against the stored archs, with placeholder ids: a piece that is not found stops here, before any write
  const A = { sourcePartners: 0, sourceEmployees: 0 };
  for (const [name, change] of [[VIEW.day, dayArch], [VIEW.purchaseList, purchaseListArch], [VIEW.marketList, marketListArch], [VIEW.boardList, boardListArch], [VIEW.sources, (x) => sourcesArch(x, A)], [VIEW.settings, (x) => settingsArch(x, A)]]) {
    const cur = await viewOf(name);
    if (!cur) throw new Error(`view ${name} not found — stop`);
    const want = change(cur.arch_db);
    log(`✎ view ${name} #${cur.id}: ${cur.arch_db.length} → ${want.length} characters`);
  }
}
save();
log(APPLY ? `applied — ${JSON.stringify(rb.created)}` : "dry-run: nothing written (add --apply)");
