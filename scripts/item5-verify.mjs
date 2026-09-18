// Item 5 verify — READ-first, create test rows, delete every test row on the
// way out.
//
// Tests:
//   T1  A new sale.order.line with a real UTAK product gets tax_ids = [].
//   T2  price_subtotal == qty * price_unit (no VAT added anywhere).
//   T3  sale.order.amount_tax == 0 and amount_total == amount_untaxed.
//   T4  A NEW product.template created with no explicit taxes_id has
//       taxes_id = [] (proves the company default was really cleared).
//   T5  The override view utak.sale.order.line.form.no_service_filter is
//       active with priority 1000 above sale_project view 2431 (priority 999).
//   IMM x_quotation / x_daily_order / x_daily_price / ir.cron / the two
//       quotation.manual_* server actions and x_is_active_for_sale field
//       definition are unchanged before → after.

import { readFileSync } from "node:fs";

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

async function main() {
  const stamp = Date.now();
  console.log(`Item 5 verify — ${new Date().toISOString()}`);

  // Immutability snapshot BEFORE
  const before = {
    x_quotation:       await call("x_quotation", "search_count", { domain: [] }),
    x_daily_order:     await call("x_daily_order", "search_count", { domain: [] }),
    x_daily_price:     await call("x_daily_price", "search_count", { domain: [] }),
    x_wa_message:      await call("x_wa_message", "search_count", { domain: [] }),
    ir_cron:           await call("ir.cron", "search_count", { domain: [] }),
    sale_order:        await call("sale.order", "search_count", { domain: [] }),
    product_template:  await call("product.template", "search_count", { domain: [] }),
  };
  const manualWaBefore = await call("ir.actions.server", "search_read", {
    domain: [["name", "in", ["quotation.manual_wa_send", "quotation.manual_pdf_build", "sale.quotation.wa_send"]]],
    fields: ["id", "name", "webhook_url"], order: "name",
  });
  const xIsActiveFieldBefore = await call("ir.model.fields", "search_read", {
    domain: [["model", "=", "product.template"], ["name", "=", "x_is_active_for_sale"]],
    fields: ["id", "name", "ttype", "field_description", "state"],
  });
  console.log("[BEFORE]", JSON.stringify({ ...before, manual_actions: manualWaBefore.length, x_is_active_field: xIsActiveFieldBefore[0]?.id }, null, 2));

  const trackedSaleOrders = [];
  const trackedProducts = [];

  const cleanup = async () => {
    console.log("\n=== cleanup ===");
    for (const soid of trackedSaleOrders) {
      try {
        const rows = await call("sale.order", "read", { ids: [soid], fields: ["order_line"] });
        if (rows[0]?.order_line?.length) {
          try { await call("sale.order.line", "unlink", { ids: rows[0].order_line }); } catch (e) {
            console.log(`  line unlink failed (${soid}):`, e.message.slice(0, 200));
          }
        }
        try { await call("sale.order", "unlink", { ids: [soid] }); }
        catch (e) { console.log(`  sale.order unlink failed (${soid}):`, e.message.slice(0, 200)); }
      } catch (e) { console.log(`  cleanup sale.order ${soid}:`, e.message.slice(0, 200)); }
    }
    for (const pid of trackedProducts) {
      try { await call("product.template", "unlink", { ids: [pid] }); }
      catch (e) { console.log(`  product unlink failed (${pid}):`, e.message.slice(0, 200)); }
    }
  };

  try {
    // Pick a real UTAK partner + a UTAK product
    const partners = await call("res.partner", "search_read", {
      domain: [["x_whatsapp_number", "=", "+966571777704"]],
      fields: ["id", "name"], limit: 1,
    });
    if (!partners[0]) throw new Error("test partner missing");
    const partner = partners[0];

    const tmpls = await call("product.template", "search_read", {
      domain: [["name", "=", "طماطم"]], fields: ["id", "name", "taxes_id", "sale_ok"], limit: 1,
    });
    if (!tmpls[0]) throw new Error("test product 'طماطم' missing");
    const tmpl = tmpls[0];
    const products = await call("product.product", "search_read", {
      domain: [["product_tmpl_id", "=", tmpl.id]], fields: ["id", "name"], limit: 1,
    });
    const product = products[0];

    console.log(`partner: ${partner.id} name="${partner.name}"`);
    console.log(`product: template id=${tmpl.id} name="${tmpl.name}" taxes_id=${JSON.stringify(tmpl.taxes_id)} sale_ok=${tmpl.sale_ok}`);
    console.log(`product.product id: ${product.id}`);

    // T1..T3: create sale.order + a line, check taxes and totals
    console.log("\n=== T1..T3: sale.order line has no tax, totals correct ===");
    const soIds = await call("sale.order", "create", {
      vals_list: [{ partner_id: partner.id, origin: `item5 verify ${stamp}` }],
    });
    const soId = soIds[0];
    trackedSaleOrders.push(soId);
    const lineIds = await call("sale.order.line", "create", {
      vals_list: [{
        order_id: soId, product_id: product.id, product_uom_qty: 4, price_unit: 25.0,
      }],
    });
    const lineId = lineIds[0];

    // Read the line back (Odoo may auto-populate tax_ids based on product OR company)
    const line = (await call("sale.order.line", "read", {
      ids: [lineId],
      fields: ["id", "product_id", "product_uom_qty", "price_unit", "tax_ids", "price_subtotal", "price_tax", "price_total"],
    }))[0];
    const so = (await call("sale.order", "read", {
      ids: [soId],
      fields: ["id", "name", "amount_untaxed", "amount_tax", "amount_total", "partner_id"],
    }))[0];
    console.log("[line]", JSON.stringify(line));
    console.log("[so]  ", JSON.stringify(so));

    const t1_taxIds_empty = Array.isArray(line.tax_ids) && line.tax_ids.length === 0;
    const expectedSubtotal = 4 * 25.0;
    const t2_subtotal_matches = Math.abs(line.price_subtotal - expectedSubtotal) < 0.01;
    const t3_no_vat_at_order = so.amount_tax === 0 && Math.abs(so.amount_total - so.amount_untaxed) < 0.01 &&
                               Math.abs(so.amount_total - expectedSubtotal) < 0.01;
    console.log(`T1 line.tax_ids empty:     ${t1_taxIds_empty}`);
    console.log(`T2 line.price_subtotal:    ${line.price_subtotal} (expected ${expectedSubtotal})  → ${t2_subtotal_matches}`);
    console.log(`T3 order.amount_tax=${so.amount_tax}, untaxed=${so.amount_untaxed}, total=${so.amount_total}  → ${t3_no_vat_at_order}`);

    // T4: create a brand-new product and confirm taxes_id defaults to []
    console.log("\n=== T4: new product.template has no default taxes ===");
    const newTmplIds = await call("product.template", "create", {
      vals_list: [{ name: `_item5_test_${stamp}`, sale_ok: true, active: true, type: "consu" }],
    });
    const newTmplId = newTmplIds[0];
    trackedProducts.push(newTmplId);
    const newTmpl = (await call("product.template", "read", {
      ids: [newTmplId], fields: ["id", "name", "taxes_id", "supplier_taxes_id"],
    }))[0];
    console.log("[new tmpl]", JSON.stringify(newTmpl));
    const t4_new_tmpl_no_tax = Array.isArray(newTmpl.taxes_id) && newTmpl.taxes_id.length === 0 &&
                               Array.isArray(newTmpl.supplier_taxes_id) && newTmpl.supplier_taxes_id.length === 0;
    console.log(`T4 new tmpl has no taxes_id / supplier_taxes_id: ${t4_new_tmpl_no_tax}`);

    // T5: override view priority + activity
    console.log("\n=== T5: override view outranks sale_project view 2431 ===");
    const overrideView = (await call("ir.ui.view", "search_read", {
      domain: [["name", "=", "utak.sale.order.line.form.no_service_filter"]],
      fields: ["id", "name", "priority", "active", "inherit_id"],
    }))[0];
    const view2431 = (await call("ir.ui.view", "read", {
      ids: [2431], fields: ["id", "name", "priority", "active"],
    }))[0];
    console.log("[override]", JSON.stringify(overrideView));
    console.log("[view 2431]", JSON.stringify(view2431));
    const t5_priority_ok =
      overrideView && overrideView.active === true && overrideView.priority > (view2431?.priority ?? 0);
    console.log(`T5 override priority > 2431: ${t5_priority_ok}`);

    // Immutability snapshot AFTER
    const after = {
      x_quotation:       await call("x_quotation", "search_count", { domain: [] }),
      x_daily_order:     await call("x_daily_order", "search_count", { domain: [] }),
      x_daily_price:     await call("x_daily_price", "search_count", { domain: [] }),
      x_wa_message:      await call("x_wa_message", "search_count", { domain: [] }),
      ir_cron:           await call("ir.cron", "search_count", { domain: [] }),
      sale_order:        await call("sale.order", "search_count", { domain: [] }),
      product_template:  await call("product.template", "search_count", { domain: [] }),
    };
    const manualWaAfter = await call("ir.actions.server", "search_read", {
      domain: [["name", "in", ["quotation.manual_wa_send", "quotation.manual_pdf_build", "sale.quotation.wa_send"]]],
      fields: ["id", "name", "webhook_url"], order: "name",
    });
    const xIsActiveFieldAfter = await call("ir.model.fields", "search_read", {
      domain: [["model", "=", "product.template"], ["name", "=", "x_is_active_for_sale"]],
      fields: ["id", "name", "ttype", "field_description", "state"],
    });

    const imm_xquot   = after.x_quotation   === before.x_quotation;
    const imm_xdaily  = after.x_daily_order === before.x_daily_order;
    const imm_xdp     = after.x_daily_price === before.x_daily_price;
    const imm_ircron  = after.ir_cron       === before.ir_cron;
    const imm_manual  = JSON.stringify(manualWaBefore) === JSON.stringify(manualWaAfter);
    const imm_xactive = JSON.stringify(xIsActiveFieldBefore) === JSON.stringify(xIsActiveFieldAfter);
    const so_delta    = after.sale_order      - before.sale_order;      // will drop back to 0 after cleanup
    const tmpl_delta  = after.product_template - before.product_template; // will drop back to 0 after cleanup

    console.log("\n[immutability]");
    console.log("  x_quotation unchanged:      ", imm_xquot);
    console.log("  x_daily_order unchanged:    ", imm_xdaily);
    console.log("  x_daily_price unchanged:    ", imm_xdp);
    console.log("  ir.cron unchanged:          ", imm_ircron);
    console.log("  manual actions unchanged:   ", imm_manual);
    console.log("  x_is_active_for_sale field: ", imm_xactive);
    console.log(`  transient sale_order delta:      ${so_delta} (cleaned below)`);
    console.log(`  transient product.template delta:${tmpl_delta} (cleaned below)`);

    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify({
      T1_line_tax_ids_empty: t1_taxIds_empty,
      T2_line_subtotal_matches: t2_subtotal_matches,
      T3_order_no_vat: t3_no_vat_at_order,
      T4_new_tmpl_no_default_tax: t4_new_tmpl_no_tax,
      T5_override_view_wins: t5_priority_ok,
      IMM_x_quotation_unchanged: imm_xquot,
      IMM_x_daily_order_unchanged: imm_xdaily,
      IMM_x_daily_price_unchanged: imm_xdp,
      IMM_ir_cron_unchanged: imm_ircron,
      IMM_manual_actions_unchanged: imm_manual,
      IMM_x_is_active_for_sale_unchanged: imm_xactive,
    }, null, 2));

  } finally {
    await cleanup();
    const final = {
      sale_order: await call("sale.order", "search_count", { domain: [] }),
      product_template: await call("product.template", "search_count", { domain: [] }),
    };
    console.log("[final counts]", JSON.stringify({
      sale_order_delta: final.sale_order - before.sale_order,
      product_template_delta: final.product_template - before.product_template,
    }));
  }
}
main().catch((e) => { console.error("VERIFY FAILED:", e); process.exit(1); });
