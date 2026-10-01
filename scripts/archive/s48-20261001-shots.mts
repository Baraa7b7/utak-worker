// § 48 ج / و (2026-10-01) — «💲 التسعير» ← «📊 اليوم», light and dark: every text of the lines' table
// (each row's decoration, «معاينة» in italics, «—» for a missing value), of the phone's cards, and of
// the screen's notes (the «لا يوجد سجل لليوم» / «يوم سابق» banners, the comparison line, the
// explanation, the links to the other screens, the confirmation's warning) measured against what is
// really behind it — 4.5:1 at least, as in § 46 / § 47.
//
// No logged-in session is available to a script, so this is the closest thing: Odoo's own RTL CSS
// bundles, fetched from the tenant (web.assets_web.rtl and web.assets_web_dark.rtl), around the
// markup exactly as the views' arch writes it (scripts/lib/s48-ui.mjs) and as Odoo renders a list's
// rows (a row's decoration is a text-* class on the row; a cell's decoration-it is fst-italic on the
// cell). Read-only: two GETs of public CSS.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/archive/s48-20261001-shots.mts
//
// Out: scripts/artifacts/s48-20261001-day-screen.png (light | dark) + .json
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ODOO = readFileSync(new URL("../../.env.sim-verify", import.meta.url), "utf8").match(/^ODOO_URL=(.*)$/m)![1].trim();
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = (ext: string) => new URL(`../artifacts/s48-20261001-day-screen.${ext}`, import.meta.url).pathname;
const UI = await import("../lib/s48-ui.mjs");
const VW = await import("../lib/s48-odoo-views.mjs");
const card = /<t t-name="card">([\s\S]*?)<\/t>\s*$/.exec(String(UI.LINE_CARD))?.[1];
if (!card) throw new Error("the card template was not found in scripts/lib/s48-ui.mjs");

const BOARD: Record<string, string> = { green: "🟢 رابح", yellow: "🟡 يغطي البضاعة فقط", red: "🔴 خسارة على البضاعة", none: "⚪ لا بيانات" };
const STATUS: Record<string, string> = { auto: "تلقائي", exception: "استثناء", manual: "معتمد يدوياً", unpublished: "لم يُنشر" };
const DECISION: Record<string, string> = { profit: "اعتمد بالسعر المربح", market: "اعتمد بسعر السوق", skip: "لا تنشر", edit: "سعر معدّل", "": "" };
/** The row's decoration, as the list's arch says it. */
const rowDeco = (s: string) => {
  const m = [...String(UI.LINE_LIST).matchAll(/decoration-(\w+)="x_status == '(\w+)'"/g)].find((x) => x[2] === s);
  return m ? `text-${m[1]}` : "";
};
const SAMPLES: Array<Record<string, string>> = [
  { x_name: "رمان كبير — كرتون", x_product_tmpl_id: "[UTAK-FRT-012] رمان كبير", x_packaging_id: "كرتون", x_supplier_id: "أحمد حسان", x_board_status: "green", x_status: "manual", x_reason: "براء: اعتمد بالسعر المربح", x_decision: "profit",
    x_cost_show: "22.00", x_market_show: "—", x_market_count: "0", x_even_show: "28.85", x_suggested_show: "31.50", x_sale_show: "31.50", x_profit_show: "2.30", x_manual_show: "31.50", x_manual_price: "31.50", sale: "1", preview: "" },
  { x_name: "خيار — جرم · 8 كيلو", x_product_tmpl_id: "[UTAK-VEG-002] خيار", x_packaging_id: "جرم · 8 كيلو", x_supplier_id: "أحمد حسان", x_board_status: "red", x_status: "exception", x_reason: "سعر السوق 31.05 أقل من السعر المربح 36", x_decision: "",
    x_cost_show: "26.00", x_market_show: "31.05", x_market_count: "2", x_even_show: "33.70", x_suggested_show: "36.00", x_sale_show: "—", x_profit_show: "معاينة 2.00", x_manual_show: "—", x_manual_price: "", sale: "", preview: "1" },
  { x_name: "موز أمريكي — كرتون · 14 كيلو", x_product_tmpl_id: "[UTAK-FRT-002] موز أمريكي", x_packaging_id: "كرتون · 14 كيلو", x_supplier_id: "أحمد حسان", x_board_status: "none", x_status: "unpublished", x_reason: "ليس في الكتالوج النشط اليوم", x_decision: "",
    x_cost_show: "22.00", x_market_show: "—", x_market_count: "0", x_even_show: "28.85", x_suggested_show: "31.50", x_sale_show: "—", x_profit_show: "معاينة 2.30", x_manual_show: "—", x_manual_price: "", sale: "", preview: "1" },
  { x_name: "طماطم — فلين · 5 كيلو", x_product_tmpl_id: "[UTAK-VEG-001] طماطم", x_packaging_id: "فلين · 5 كيلو", x_supplier_id: "عمر المجهلي", x_board_status: "green", x_status: "auto", x_reason: "", x_decision: "",
    x_cost_show: "20.00", x_market_show: "34.50", x_market_count: "1", x_even_show: "26.45", x_suggested_show: "29.00", x_sale_show: "34.50", x_profit_show: "7.00", x_manual_show: "—", x_manual_price: "", sale: "1", preview: "" },
  { x_name: "بصل — جرم · 20 كيلو", x_product_tmpl_id: "[UTAK-VEG-004] بصل", x_packaging_id: "جرم · 20 كيلو", x_supplier_id: "", x_board_status: "yellow", x_status: "exception", x_reason: "لا سعر شراء", x_decision: "edit",
    x_cost_show: "—", x_market_show: "30.00", x_market_count: "1", x_even_show: "—", x_suggested_show: "—", x_sale_show: "—", x_profit_show: "—", x_manual_show: "—", x_manual_price: "0.00", sale: "", preview: "" },
];
// ---- the list: the columns of the arch (the hidden ones apart), each row with its decoration
const cols = [...String(UI.LINE_LIST).matchAll(/<field name="(\w+)"([^>]*)\/>/g)].map((m) => ({ name: m[1], attrs: m[2] })).filter((c) => !/column_invisible="1"|optional="hide"/.test(c.attrs));
for (const need of ["x_market_show", "x_sale_show", "x_profit_show", "x_decision", "x_manual_price"]) if (!cols.some((c) => c.name === need)) throw new Error(`the list has no ${need} column`);
const headers = cols.map((c) => /string="([^"]*)"/.exec(c.attrs)?.[1] ?? c.name);
const cellText = (c: string, r: Record<string, string>) => c === "x_board_status" ? BOARD[r[c]] : c === "x_status" ? STATUS[r[c]] : c === "x_decision" ? DECISION[r[c]] : c === "x_manual_price" ? (r.x_decision === "edit" || r.x_manual_price ? r.x_manual_price : "") : r[c] ?? "";
const listRow = (r: Record<string, string>) => `<tr class="o_data_row ${rowDeco(r.x_status)}" data-status="${r.x_status}">${cols.map((c) => {
  const italic = c.name === "x_profit_show" && /decoration-it=/.test(c.attrs) && r.preview;
  return `<td class="o_data_cell cursor-pointer o_field_cell ${c.name.endsWith("_show") || c.name === "x_reason" ? "o_list_char" : ""} ${italic ? "fst-italic" : ""}" data-col="${c.name}">${cellText(c.name, r)}</td>`;
}).join("")}</tr>`;
const LIST_HTML = `<div class="o_field_x2many o_field_x2many_list"><div class="o_list_renderer o_renderer table-responsive"><table class="o_list_table table table-sm table-hover position-relative mb-0 o_list_table_ungrouped table-striped"><thead><tr>${headers.map((h) => `<th class="o_column_sortable"><span>${h}</span></th>`).join("")}</tr></thead><tbody class="ui-sortable">${SAMPLES.map(listRow).join("")}</tbody></table></div></div>`;
/** The card as the kanban renders it for a record: t-attf-class evaluated, t-if resolved, each field its value. */
function render(r: Record<string, string>): string {
  let h = card!;
  const border = { green: "border-success", yellow: "border-warning", red: "border-danger", none: "border-secondary" }[r.x_board_status]!;
  h = h.replace(/t-attf-class="([^"]*x_board_status[^"]*)"/, (_, cls: string) => {
    if (!cls.includes(border)) throw new Error("the card's border expression changed");
    return `class="${cls.replace(/#\{[^}]*\}/, border)}"`;
  });
  h = h.replace(/t-attf-class="#\{!record\.x_sale_price\.raw_value and record\.x_preview_sale\.raw_value \? 'fst-italic' : ''\}"/, `class="${r.preview ? "fst-italic" : ""}"`);
  if (/t-attf-class=/.test(h)) throw new Error("an unknown t-attf-class in the card: measure it here before shipping it");
  h = h.replace(/<div t-if="record\.x_reason\.raw_value">([\s\S]*?)<\/div>/, (_, inner: string) => (r.x_reason ? `<div>${inner}</div>` : ""));
  h = h.replace(/<t t-if="!record\.x_decision\.raw_value">—<\/t>/, r.x_decision ? "" : "—");
  if (/widget="badge"/.test(h)) throw new Error("the card uses a filled badge: measure it here before shipping it");
  h = h.replace(/<field name="(\w+)"( class="([^"]*)")?\/>/g, (_, name: string, _c, cls: string) => `<span${cls ? ` class="${cls}"` : ""}>${cellText(name, r)}</span>`);
  return `<article class="o_kanban_record d-flex flex-column border rounded p-2 m-1" style="width:320px">${h}</article>`;
}
// ---- the notes of the screen, with the classes the arch gives them
const A = { refresh: 1, confirm: 2, unapprove: 3, approve: 4, prev: 5, next: 6, openDay: 7, openSources: 8, days: 9, products: 10, settings: 11, purchaseList: 12, marketList: 13, packagings: 14, profitGraph: 15 };
const dayArch = String(UI.dayForm(A)), confArch = String(UI.confirmForm(A));
const banners = [...dayArch.matchAll(/<div class="(alert alert-\w+)"[^>]*>([^<]*)/g)].map((m) => ({ cls: m[1], text: m[2].trim() || "«الكراتين المتوقعة يومياً» فارغة: لا حصة تشغيل." }));
const confBanners = [...confArch.matchAll(/<div class="(alert alert-\w+)"[^>]*>(?:<strong>)?([^<]*)/g)].map((m) => ({ cls: m[1], text: m[2].trim() }));
if (banners.length < 4 || confBanners.length < 2) throw new Error(`the banners were not found in the arch (${banners.length}, ${confBanners.length})`);
const links = [...String(UI.navRow(A, "today")).matchAll(/string="([^"]*)" class="([^"]*)"/g)].map((m) => ({ text: m[1], cls: m[2] }));
const NOTES_HTML = `<div class="o_form_view"><div class="o_form_sheet_bg"><div class="o_form_sheet p-3" id="utak-notes">
  <div class="d-flex flex-wrap gap-1 mb-2">${links.map((l) => `<button class="${l.cls} utak-m" data-kind="link">${l.text}</button>`).join("")}</div>
  ${[...banners, ...confBanners].map((b) => `<div class="${b.cls} utak-m" role="status" data-kind="${b.cls}">${b.text}</div>`).join("\n  ")}
  <div class="text-muted mb-2 utak-m" data-kind="text-muted">${VW.DAY_NOTE}</div>
</div></div></div>`;

async function css(bundle: string) {
  const r = await fetch(`${ODOO}/web/assets/1/${bundle}`, { redirect: "follow" });
  if (!r.ok) throw new Error(`${bundle}: HTTP ${r.status}`);
  return { url: r.url, text: await r.text() };
}
const page = (theme: string, cssHref: string) => `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link rel="stylesheet" href="${cssHref}">
<style>.utak-cap{font:600 15px system-ui;padding:10px 16px}.utak-probe{font-family:ui-monospace,monospace;font-size:11px;padding:0 8px 8px}</style>
</head><body class="o_web_client" style="overflow:hidden">
<div class="utak-cap">💲 التسعير ← 📊 اليوم — جدول الأسطر · saas~19.4 · الوضع ${theme === "dark" ? "الداكن" : "الفاتح"}</div>
<div class="o_action_manager"><div class="o_form_view"><div class="o_form_sheet_bg"><div class="o_form_sheet p-3">${LIST_HTML}</div></div></div></div>
<div class="utak-probe" id="utak-list-probe"></div>
<div class="utak-cap">على الجوال: بطاقة لكل صنف</div>
<div class="o_action_manager"><div class="o_form_view"><div class="o_form_sheet_bg"><div class="o_form_sheet p-3"><div class="o_kanban_view"><div class="o_kanban_renderer o_renderer d-flex flex-wrap o_kanban_ungrouped">
${SAMPLES.map((s) => `<div class="utak-card" data-status="${s.x_status}">${render(s)}<div class="utak-probe"></div></div>`).join("\n")}
</div></div></div></div></div></div>
<div class="utak-cap">الروابط والملاحظات ونص الشرح</div>
<div class="o_action_manager">${NOTES_HTML}</div>
<div class="utak-probe" id="utak-notes-probe"></div>
<script>
const rgba = (s) => { const v = (s.match(/[\\d.]+/g) || []).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1); };
const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(rgba(getComputedStyle(e).backgroundColor)); let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) if (c[3] > 0) bg = over(c, bg); return bg; };
const measure = (el) => { const bg = bgOf(el); const fg = over(rgba(getComputedStyle(el).color), bg); return { fg: hex(fg), bg: hex(bg), ratio: +ratio(fg, bg).toFixed(2), italic: getComputedStyle(el).fontStyle === "italic" }; };
const mark = (el, min) => { el.textContent = (min >= 4.5 ? "✓ " : "✗ ") + "أقل تباين " + min.toFixed(2) + ":1"; el.style.color = min >= 4.5 ? "#1bbe54" : "#e5484d"; };
// the list: every cell of every row, and the headers
const list = [];
document.querySelectorAll("tr.o_data_row").forEach((tr) => {
  const cells = [...tr.querySelectorAll("td")].filter((td) => td.textContent.trim()).map((td) => ({ col: td.dataset.col, text: td.textContent.trim().slice(0, 24), ...measure(td) }));
  list.push({ status: tr.dataset.status, min: Math.min(...cells.map((c) => c.ratio)), preview: cells.find((c) => c.col === "x_profit_show"), dash: cells.filter((c) => c.text === "—").map((c) => c.ratio), cells });
});
const heads = [...document.querySelectorAll("thead th span")].map((el) => measure(el).ratio);
mark(document.getElementById("utak-list-probe"), Math.min(...list.map((r) => r.min), ...heads));
// the cards
const cards = [];
document.querySelectorAll(".utak-card").forEach((box) => {
  const art = box.querySelector("article");
  const els = [...art.querySelectorAll("span, div")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const rows = els.map((el) => ({ text: el.textContent.trim().slice(0, 24), cls: el.className, ...measure(el) }));
  const side = art.firstElementChild, cs = getComputedStyle(side);
  const border = over(rgba(cs.borderInlineStartColor), bgOf(art));
  const min = Math.min(...rows.map((r) => r.ratio));
  mark(box.querySelector(".utak-probe"), min);
  cards.push({ status: box.dataset.status, min, border: hex(border), borderWidth: cs.borderInlineStartWidth, previewItalic: rows.some((r) => r.text.startsWith("معاينة") && r.italic), texts: rows });
});
// the notes
const notes = [...document.querySelectorAll(".utak-m")].map((el) => ({ kind: el.dataset.kind, text: el.textContent.trim().slice(0, 40), ...measure(el) }));
mark(document.getElementById("utak-notes-probe"), Math.min(...notes.map((n) => n.ratio)));
document.title = JSON.stringify({ list, heads, cards, notes });
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

const dir = mkdtempSync(join(tmpdir(), "utak-s48-"));
const shots: Record<string, any> = {};
for (const theme of ["light", "dark"] as const) {
  const { url, text } = await css(theme === "dark" ? "web.assets_web_dark.rtl.min.css" : "web.assets_web.rtl.min.css");
  if (!text.includes(".o_kanban_record") || !text.includes(".o_list_table")) throw new Error(`${theme} bundle has no list / kanban styles`);
  const cssFile = join(dir, `${theme}.css`);
  writeFileSync(cssFile, text);
  const html = join(dir, `${theme}.html`);
  writeFileSync(html, page(theme, `file://${cssFile}`));
  const png = join(dir, `${theme}.png`);
  const common = ["--headless=new", "--disable-gpu", `--user-data-dir=${join(dir, "prof-" + theme)}`, "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1"];
  await chrome([...common, "--window-size=1500,1500", `--screenshot=${png}`, `file://${html}`], () => existsSync(png) && statSync(png).size > 0);
  let dom = "";
  await chrome([...common, "--dump-dom", `file://${html}`], () => dom.includes("</html>"), (d) => { dom += d; });
  const measured = JSON.parse((/<title>(.*?)<\/title>/s.exec(dom)?.[1] ?? "{}").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  shots[theme] = { png, css: url, ...measured };
}
execFileSync("python3", ["-c", `
from PIL import Image
a, b = Image.open(${JSON.stringify(shots.light.png)}), Image.open(${JSON.stringify(shots.dark.png)})
c = Image.new("RGB", (a.width + b.width + 12, max(a.height, b.height)), (128, 128, 128))
c.paste(a, (0, 0)); c.paste(b, (a.width + 12, 0)); c.save(${JSON.stringify(out("png"))})
`]);
const min = (t: string, part: "list" | "cards" | "notes" | "preview" | "dash" | "heads") => {
  const s = shots[t];
  if (part === "list") return Math.min(...s.list.map((r: any) => r.min));
  if (part === "heads") return Math.min(...s.heads);
  if (part === "cards") return Math.min(...s.cards.map((c: any) => c.min));
  if (part === "notes") return Math.min(...s.notes.map((n: any) => n.ratio));
  if (part === "preview") return Math.min(...s.list.filter((r: any) => r.preview?.text.startsWith("معاينة")).map((r: any) => r.preview.ratio));
  return Math.min(...s.list.flatMap((r: any) => r.dash));
};
const report: any = { at: new Date().toISOString(), css: { light: shots.light.css, dark: shots.dark.css }, min: {} as any, light: shots.light, dark: shots.dark };
let worst = 99, italics = true;
for (const t of ["light", "dark"]) {
  report.min[t] = { list: min(t, "list"), headers: min(t, "heads"), preview: min(t, "preview"), dash: min(t, "dash"), cards: min(t, "cards"), notes: min(t, "notes") };
  worst = Math.min(worst, ...Object.values(report.min[t] as Record<string, number>));
  const pv = shots[t].list.filter((r: any) => r.preview?.text.startsWith("معاينة"));
  italics = italics && pv.length > 0 && pv.every((r: any) => r.preview.italic) && shots[t].cards.filter((c: any) => c.texts.some((x: any) => x.text.startsWith("معاينة"))).every((c: any) => c.previewItalic);
  console.log(`${t}: الجدول ${report.min[t].list.toFixed(2)}:1 (العناوين ${report.min[t].headers.toFixed(2)}، «معاينة» ${report.min[t].preview.toFixed(2)}، «—» ${report.min[t].dash.toFixed(2)}) · البطاقات ${report.min[t].cards.toFixed(2)}:1 · الملاحظات والروابط ${report.min[t].notes.toFixed(2)}:1`);
  for (const r of shots[t].list) console.log(`  صف ${r.status}: أقل ${r.min} · ${r.cells.map((c: any) => `${c.col.replace("x_", "")} ${c.fg}/${c.bg}=${c.ratio}${c.italic ? " مائل" : ""}`).slice(0, 6).join(" ")}`);
  for (const n of shots[t].notes) console.log(`  ${n.kind}: ${n.fg}/${n.bg} = ${n.ratio}`);
}
report.previewItalic = italics;
delete report.light.png; delete report.dark.png;
writeFileSync(out("json"), JSON.stringify(report, null, 2) + "\n");
console.log(`«معاينة» مائلة في الجدول والبطاقات: ${italics ? "✓" : "✗"}`);
console.log("→", out("png"));
if (worst < 4.5 || !italics) { console.log(`✗ below 4.5:1 (${worst.toFixed(2)}) or the preview is not set apart`); process.exit(1); }
console.log(`✓ every text ≥ 4.5:1 (worst ${worst.toFixed(2)}:1)`);
