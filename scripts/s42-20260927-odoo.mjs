// § 42 أ (2026-09-27) — «مشتريات السوق النقدية»: the supplier that is owed
// every purchase-list line whose winning purchase price came from a price
// source that is not a supplier (Omar at the market). JSON-2 only
// (scripts/lib/s40-kit.mjs: every request other than utakfresh.odoo.com is
// blocked). No tax setting, no module, no account.move / account.payment, no
// WhatsApp. Nothing is deleted: the rollback archives the partner.
//
//   res.partner «مشتريات السوق النقدية»:
//     ref = UTAK-CASH-MARKET (how the worker finds it: src/cash-market.ts),
//     supplier_rank 1, «مسجل في الضريبة» (x_vat_registered) true, not a price
//     source (x_price_source false), no phone / mobile / x_whatsapp_number,
//     x_wa_allowed false, «التصنيف» supplier (x_contact_class).
//
//   node scripts/s42-20260927-odoo.mjs                     dry-run
//   node scripts/s42-20260927-odoo.mjs --apply             rollback file first, then create (idempotent)
//   node scripts/s42-20260927-odoo.mjs --verify            read-only checks
//   node scripts/s42-20260927-odoo.mjs --rollback [--apply]  archive it (active = false), never deleted
//
// Rollback file: scripts/artifacts/s42-20260927-odoo-rollback.json.
import { APPLY, ROLLBACK, VERIFY, call, checker, log, rollbackFile, step } from "./lib/s40-kit.mjs";

const RB = new URL("./artifacts/s42-20260927-odoo-rollback.json", import.meta.url);
export const CASH_MARKET_REF = "UTAK-CASH-MARKET";
const NAME = "مشتريات السوق النقدية";
const VALS = {
  name: NAME,
  ref: CASH_MARKET_REF,
  supplier_rank: 1,
  x_vat_registered: true,
  x_price_source: false,
  x_wa_allowed: false,
  x_contact_class: "supplier",
  comment: "<p>§ 42 أ: مستحق كل سطر في قائمة الشراء سعر شرائه الفائز من مصدر غير مورد (عمر من السوق)، بسعره المكتوب. "
    + "دفعاته من مسار دفعات الموردين (عمر يسجّل وبراء يعتمد)، ولا إشعار له لأنه بلا رقم، والوركر لا يرسل له شيئاً أبداً. "
    + "لا تضف له رقماً. المرجع UTAK-CASH-MARKET يعرّفه للوركر فلا يُغيَّر.</p>",
};
const FIELDS = ["id", "name", "ref", "active", "supplier_rank", "x_vat_registered", "x_price_source", "x_wa_allowed", "x_contact_class", "phone", "x_whatsapp_number", "vat"];

const found = async () => (await call("res.partner", "search_read", {
  domain: [["ref", "=", CASH_MARKET_REF]], fields: FIELDS, context: { active_test: false }, limit: 5,
}));

if (VERIFY) {
  const c = checker();
  const rows = await found();
  const p = rows[0];
  c.check("one partner with ref UTAK-CASH-MARKET", rows.length === 1, JSON.stringify(rows.map((r) => r.id)));
  c.check(`#${p?.id} name «${NAME}», active`, p?.name === NAME && p?.active === true, JSON.stringify(p));
  c.check("supplier (supplier_rank ≥ 1, class supplier)", Number(p?.supplier_rank) >= 1 && p?.x_contact_class === "supplier");
  c.check("«مسجل في الضريبة» true", p?.x_vat_registered === true);
  c.check("not a price source", p?.x_price_source === false);
  c.check("no number at all (phone, x_whatsapp_number), x_wa_allowed false", !p?.phone && !p?.x_whatsapp_number && p?.x_wa_allowed === false);
  const same = await call("res.partner", "search_read", { domain: [["name", "=", NAME]], fields: ["id"], context: { active_test: false } });
  c.check("no second partner of that name", same.length === 1, JSON.stringify(same));
  c.done();
}

const { rb, save } = rollbackFile(RB, "scripts/s42-20260927-odoo.mjs");

if (ROLLBACK) {
  const id = rb.created?.cashMarketPartner;
  if (!id) { log("nothing created by this script — nothing to roll back"); process.exit(0); }
  log(`archive res.partner #${id} (active = false) — never deleted`);
  if (APPLY) await call("res.partner", "write", { ids: [id], vals: { active: false }, context: { active_test: false } });
  process.exit(0);
}

const have = (await found())[0]?.id ?? null;
if (have) log(`= res.partner «${NAME}» #${have} (ref ${CASH_MARKET_REF})`);
else log(`dry-run: would create res.partner ${JSON.stringify(VALS)}`);
rb.before.cashMarketPartner = have ? "existed" : "absent";
save();
const id = await step(`res.partner «${NAME}»`, have, async () => {
  const [pid] = await call("res.partner", "create", { vals_list: [VALS] }, { probe: [["ref", "=", CASH_MARKET_REF]] });
  rb.created.cashMarketPartner = pid;
  save();
  return pid;
});
if (APPLY) log(`done: #${id}. Verify: node scripts/s42-20260927-odoo.mjs --verify`);
else log("dry-run only (add --apply)");
