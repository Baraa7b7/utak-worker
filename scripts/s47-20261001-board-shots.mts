// § 47 ب (2026-10-01) — the board's cards and its list with the two new numbers («أقل سعر بيع بدون
// خسارة» and «السعر المربح المقترح»), light and dark: every text measured against what is really
// behind it, as in § 46 (scripts/s46-20261001-board-shots.mts), 4.5:1 at least.
//
// No logged-in session is available to a script, so this is the closest thing: Odoo's own RTL CSS
// bundles, fetched from the tenant (web.assets_web.rtl and web.assets_web_dark.rtl), around the
// card exactly as the view's arch writes it and around the list's rows as Odoo renders them (a
// row's decoration is a text-* class on the row; a column's class sits on its cell) — both read
// from scripts/lib/s47-odoo-views.mjs. Read-only: only two GETs of public CSS.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s47-20261001-board-shots.mts
//
// Out: scripts/artifacts/s47-20261001-board-cards.png (light | dark) + .json
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ODOO = readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").match(/^ODOO_URL=(.*)$/m)![1].trim();
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = (ext: string) => new URL(`./artifacts/s47-20261001-board-cards.${ext}`, import.meta.url).pathname;
const { CARD, BOARD_LIST } = await import("./lib/s47-odoo-views.mjs");
const card = /<t t-name="card">([\s\S]*?)<\/t>/.exec(CARD)?.[1];
if (!card) throw new Error("the card template was not found in scripts/lib/s47-odoo-views.mjs");

const LABEL: Record<string, string> = { green: "🟢 رابح", yellow: "🟡 يغطي البضاعة فقط", red: "🔴 خسارة على البضاعة", none: "⚪ لا بيانات" };
const SAMPLES: Array<Record<string, string>> = [
  { x_name: "رمان وسط — كرتون", x_board_status: "green", x_cost_price: "16.00", x_net_purchase: "16.00", x_waste_cost: "0.80", x_op_share: "1.99", x_full_cost: "18.79", x_break_even: "21.61", x_suggested_price: "23.00", x_board_sale: "26.00", x_net_sale: "22.61", x_real_profit: "3.82" },
  { x_name: "رمان صغير — كرتون", x_board_status: "yellow", x_cost_price: "12.00", x_net_purchase: "12.00", x_waste_cost: "0.60", x_op_share: "1.99", x_full_cost: "14.59", x_break_even: "16.78", x_suggested_price: "18.00", x_board_sale: "16.00", x_net_sale: "13.91", x_real_profit: "-0.68" },
  { x_name: "رمان كبير — كرتون", x_board_status: "red", x_cost_price: "22.00", x_net_purchase: "22.00", x_waste_cost: "1.10", x_op_share: "1.99", x_full_cost: "25.09", x_break_even: "28.85", x_suggested_price: "30.50", x_board_sale: "26.00", x_net_sale: "22.61", x_real_profit: "-2.48" },
  { x_name: "موز أمريكي — كرتون · 14 كيلو", x_board_status: "none", x_cost_price: "22.00", x_net_purchase: "22.00", x_waste_cost: "1.10", x_op_share: "1.99", x_full_cost: "25.09", x_break_even: "28.85", x_suggested_price: "30.50", x_board_sale: "0.00", x_net_sale: "0.00", x_real_profit: "0.00" },
];
// ---- the list: one row per sample, its decoration on the row, each column's class on its cell
const DECO: Record<string, string> = { green: "text-success", yellow: "text-warning", red: "text-danger", none: "text-muted" };
const listCols = [...String(BOARD_LIST).matchAll(/<field name="(\w+)"([^>]*)\/>/g)].map((m) => ({ name: m[1], cls: /class="([^"]*)"/.exec(m[2])?.[1] ?? "", badge: /widget="badge"/.test(m[2]), hidden: /optional="hide"/.test(m[2]) })).filter((c) => !c.hidden);
if (!listCols.some((c) => c.name === "x_suggested_price") || !listCols.some((c) => c.name === "x_break_even")) throw new Error("the list has no x_break_even / x_suggested_price column");
const listRow = (r: Record<string, string>) => `<tr class="o_data_row ${DECO[r.x_board_status]}" data-status="${r.x_board_status}">${listCols.map((c) =>
  `<td class="o_data_cell cursor-pointer o_field_cell ${/^x_(?!board_status|day_date)/.test(c.name) && c.name !== "x_product_tmpl_id" && c.name !== "x_packaging_id" ? "o_list_number" : ""} ${c.cls}" data-col="${c.name}">${c.name === "x_board_status" ? `<span class="badge rounded-pill text-bg-${{ green: "success", yellow: "warning", red: "danger", none: "secondary" }[r.x_board_status]}">${LABEL[r.x_board_status]}</span>` : c.name === "x_product_tmpl_id" ? r.x_name.split(" — ")[0] : c.name === "x_packaging_id" ? r.x_name.split(" — ")[1] : c.name === "x_day_date" ? "2026/10/01" : r[c.name] ?? ""}</td>`).join("")}</tr>`;
const LIST_HTML = `<div class="o_list_view"><div class="o_list_renderer o_renderer table-responsive"><table class="o_list_table table table-sm table-hover position-relative mb-0 o_list_table_ungrouped table-striped"><tbody class="ui-sortable">${SAMPLES.map(listRow).join("")}</tbody></table></div></div>`;
/** The card as the kanban renders it for a record: t-attf-class evaluated, each field its value. */
function render(r: Record<string, string>): string {
  let h = card!;
  h = h.replace(/t-attf-class="([^"]*)"/, (_, cls: string) => {
    const expr = /#\{([^}]*)\}/.exec(cls)![1];
    const border = { green: "border-success", yellow: "border-warning", red: "border-danger", none: "border-secondary" }[r.x_board_status];
    if (!expr.includes(border!)) throw new Error("the card's class expression changed");
    return `class="${cls.replace(/#\{[^}]*\}/, border!)}"`;
  });
  if (/widget="badge"/.test(h)) throw new Error("the card uses a filled badge again: measure it here before shipping it");
  h = h.replace(/<field name="(\w+)"( class="([^"]*)")?\/>/g, (_, name: string, _c, cls: string) => `<span${cls ? ` class="${cls}"` : ""}>${name === "x_board_status" ? LABEL[r[name]] : r[name] ?? ""}</span>`);
  return `<article class="o_kanban_record d-flex flex-column border rounded p-2 m-1" style="width:320px">${h}</article>`;
}
async function css(bundle: string) {
  const r = await fetch(`${ODOO}/web/assets/1/${bundle}`, { redirect: "follow" });
  if (!r.ok) throw new Error(`${bundle}: HTTP ${r.status}`);
  return { url: r.url, text: await r.text() };
}
const page = (theme: string, cssHref: string) => `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link rel="stylesheet" href="${cssHref}">
<style>.utak-cap{font:600 15px system-ui;padding:10px 16px}.utak-probe{font-family:ui-monospace,monospace;font-size:11px;padding:0 8px 8px}</style>
</head><body class="o_web_client" style="overflow:hidden">
<div class="utak-cap">📊 لوحة التسعير — بطاقات الأصناف · saas~19.4 · الوضع ${theme === "dark" ? "الداكن" : "الفاتح"}</div>
<div class="o_action_manager"><div class="o_form_view"><div class="o_form_sheet_bg"><div class="o_form_sheet p-3"><div class="o_kanban_view"><div class="o_kanban_renderer o_renderer d-flex flex-wrap o_kanban_ungrouped">
${SAMPLES.map((s) => `<div class="utak-card" data-status="${s.x_board_status}">${render(s)}<div class="utak-probe"></div></div>`).join("\n")}
</div></div></div></div></div></div>
<div class="utak-cap">📋 قائمة اللوحة — أسطر اليوم</div>
<div class="o_action_manager">${LIST_HTML}</div>
<div class="utak-probe" id="utak-list-probe"></div>
<script>
const rgba = (s) => { const v = (s.match(/[\\d.]+/g) || []).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1); };
const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(rgba(getComputedStyle(e).backgroundColor)); let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) if (c[3] > 0) bg = over(c, bg); return bg; };
const found = [];
document.querySelectorAll(".utak-card").forEach((box) => {
  const art = box.querySelector("article");
  const els = [...art.querySelectorAll("span")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const rows = els.map((el) => { const bg = bgOf(el); const fg = over(rgba(getComputedStyle(el).color), bg); return { text: el.textContent.trim().slice(0, 24), cls: el.className, fg: hex(fg), bg: hex(bg), ratio: +ratio(fg, bg).toFixed(2) }; });
  const side = art.firstElementChild;
  const cs = getComputedStyle(side);
  const borderColor = over(rgba(cs.borderInlineStartColor), bgOf(art));
  const min = Math.min(...rows.map((r) => r.ratio));
  const pass = min >= 4.5;
  const probe = box.querySelector(".utak-probe");
  probe.textContent = (pass ? "✓ " : "✗ ") + "أقل تباين " + min.toFixed(1) + ":1 · الحد " + hex(borderColor) + " " + cs.borderInlineStartWidth;
  probe.style.color = pass ? "#1bbe54" : "#e5484d";
  found.push({ status: box.dataset.status, minRatio: min, pass, border: hex(borderColor), borderWidth: cs.borderInlineStartWidth, borderRatio: +ratio(borderColor, bgOf(art)).toFixed(2), texts: rows });
});
// the list: the two new columns of every row (and, for the record, the row's other cells)
const list = [];
document.querySelectorAll("tr.o_data_row").forEach((tr) => {
  const cells = [...tr.querySelectorAll("td")].map((td) => { const el = td.querySelector("span") || td; const bg = bgOf(el); const fg = over(rgba(getComputedStyle(el).color), bg); return { col: td.dataset.col, text: el.textContent.trim().slice(0, 24), fg: hex(fg), bg: hex(bg), ratio: +ratio(fg, bg).toFixed(2) }; });
  const fresh = cells.filter((c) => c.col === "x_break_even" || c.col === "x_suggested_price");
  list.push({ status: tr.dataset.status, newMin: Math.min(...fresh.map((c) => c.ratio)), rowMin: Math.min(...cells.map((c) => c.ratio)), cells });
});
const lp = document.getElementById("utak-list-probe");
const lmin = Math.min(...list.map((r) => r.newMin));
lp.textContent = (lmin >= 4.5 ? "✓ " : "✗ ") + "العمودان الجديدان: أقل تباين " + lmin.toFixed(1) + ":1 · باقي أعمدة الصف (كما في § 46): " + Math.min(...list.map((r) => r.rowMin)).toFixed(1) + ":1";
lp.style.color = lmin >= 4.5 ? "#1bbe54" : "#e5484d";
document.title = JSON.stringify({ cards: found, list });
</script></body></html>`;

function chrome(argv: string[], done: () => boolean, onOut?: (d: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(CHROME, argv, { stdio: ["ignore", "pipe", "ignore"] });
    p.stdout.on("data", (b) => onOut?.(b.toString()));
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (done()) { clearInterval(tick); setTimeout(() => { p.kill("SIGKILL"); resolve(); }, 300); }
      else if (Date.now() - t0 > 60000) { clearInterval(tick); p.kill("SIGKILL"); reject(new Error("chrome: no output in 60 s")); }
    }, 200);
  });
}

const dir = mkdtempSync(join(tmpdir(), "utak-board-"));
const shots: Record<string, { png: string; probes: any[]; list: any[]; css: string }> = {};
for (const theme of ["light", "dark"] as const) {
  const { url, text } = await css(theme === "dark" ? "web.assets_web_dark.rtl.min.css" : "web.assets_web.rtl.min.css");
  if (!text.includes(".o_kanban_record")) throw new Error(`${theme} bundle has no kanban styles`);
  const cssFile = join(dir, `${theme}.css`);
  writeFileSync(cssFile, text);
  const html = join(dir, `${theme}.html`);
  writeFileSync(html, page(theme, `file://${cssFile}`));
  const png = join(dir, `${theme}.png`);
  const common = ["--headless=new", "--disable-gpu", `--user-data-dir=${join(dir, "prof-" + theme)}`, "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1"];
  await chrome([...common, "--window-size=1100,720", `--screenshot=${png}`, `file://${html}`], () => existsSync(png) && statSync(png).size > 0);
  let dom = "";
  await chrome([...common, "--dump-dom", `file://${html}`], () => dom.includes("</html>"), (d) => { dom += d; });
  const measured = JSON.parse((/<title>(.*?)<\/title>/s.exec(dom)?.[1] ?? "{}").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  shots[theme] = { png, css: url, probes: measured.cards ?? [], list: measured.list ?? [] };
}
execFileSync("python3", ["-c", `
from PIL import Image
a, b = Image.open(${JSON.stringify(shots.light.png)}), Image.open(${JSON.stringify(shots.dark.png)})
c = Image.new("RGB", (a.width + b.width + 12, max(a.height, b.height)), (128, 128, 128))
c.paste(a, (0, 0)); c.paste(b, (a.width + 12, 0)); c.save(${JSON.stringify(out("png"))})
`]);
const worst = (t: "light" | "dark") => Math.min(...shots[t].probes.map((p) => p.minRatio));
const worstNew = (t: "light" | "dark") => Math.min(...shots[t].list.map((r) => r.newMin));
const worstRow = (t: "light" | "dark") => Math.min(...shots[t].list.map((r) => r.rowMin));
const report = {
  at: new Date().toISOString(), css: { light: shots.light.css, dark: shots.dark.css },
  minRatio: { light: worst("light"), dark: worst("dark") },
  listNewColumnsMinRatio: { light: worstNew("light"), dark: worstNew("dark") },
  listOtherCellsMinRatio: { light: worstRow("light"), dark: worstRow("dark") },
  light: shots.light.probes, dark: shots.dark.probes, lightList: shots.light.list, darkList: shots.dark.list,
};
writeFileSync(out("json"), JSON.stringify(report, null, 2) + "\n");
for (const t of ["light", "dark"] as const) {
  console.log(`${t}: worst text contrast ${report.minRatio[t].toFixed(2)}:1`);
  for (const p of shots[t].probes) console.log(`  ${p.status}: min ${p.minRatio} ${p.pass ? "✓" : "✗"} · border ${p.border} ${p.borderWidth} (${p.borderRatio}:1) · ${p.texts.map((x: any) => `${x.fg}/${x.bg}=${x.ratio}`).join(" ")}`);
}
for (const t of ["light", "dark"] as const) {
  console.log(`${t} list: the two new columns ${report.listNewColumnsMinRatio[t].toFixed(2)}:1 · every cell of a row ${report.listOtherCellsMinRatio[t].toFixed(2)}:1`);
  for (const r of shots[t].list) console.log(`  ${r.status}: ${r.cells.map((c: any) => `${c.col.replace("x_", "")} ${c.fg}/${c.bg}=${c.ratio}`).join(" ")}`);
}
console.log("→", out("png"));
if (Math.min(worst("light"), worst("dark"), worstNew("light"), worstNew("dark")) < 4.5) { console.log("✗ below 4.5:1"); process.exit(1); }
