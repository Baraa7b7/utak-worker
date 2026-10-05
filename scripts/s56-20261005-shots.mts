// § 56 (2026-10-05) — «💲 التسعير» ← «📊 اليوم» as it looks, with the numbers of 2026-10-05 (#54,
// tests/fixtures-s56-day54.json): the header's four numbers, the chart the worker writes
// (src/day-screen.ts dayChartHtml), the table and — at a phone's width — the cards, in the light and
// the dark theme. Every text is measured against what is really behind it (4.5:1 at least), every
// drawn element of the chart too (3:1 at least), and the page must not scroll sideways — as in § 46 / § 48.
//
// No logged-in session is available to a script, so this is the closest thing: Odoo's own RTL CSS
// bundles, fetched from the tenant (web.assets_web.rtl and web.assets_web_dark.rtl — two GETs of
// public CSS, read-only), around the markup exactly as the view's arch writes it
// (scripts/lib/s56-ui.mjs) and as Odoo renders a list's rows and a kanban's cards. The browser is
// the Chromium Playwright installed (~/Library/Caches/ms-playwright), driven headless; the playwright
// package itself is not a dependency of this project.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s56-20261005-shots.mts
//
// Out (scripts/artifacts/): <tag>-chart-day54.html (the chart's HTML as written to x_chart_html),
//   <tag>-day-{light,dark,mobile,mobile-dark}.png, <tag>-day-contrast.json — <tag> is s57-20261005 from § 57 on
//   (the screen with its own class and stylesheet, scripts/lib/s57-ui.mjs); § 56's pictures keep their names.
// § 57 أ: the wide screen was then looked at INSIDE Odoo itself, in Baraa's own Chrome (the four
//   s57-20261005-day-1440-*.png and s57-20261005-day-measure.json); a phone's width could not be had there.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ODOO = readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").match(/^ODOO_URL=(.*)$/m)![1].trim();
// § 57 أ (2026-10-05): the pictures are written under the § of the screen as it is now (--tag=s56-20261005 for the old names)
const TAG = process.argv.find((a) => a.startsWith("--tag="))?.slice(6) ?? "s57-20261005";
const out = (name: string) => new URL(`./artifacts/${TAG}-${name}`, import.meta.url).pathname;
const UI = await import("./lib/s56-ui.mjs");
// § 57 أ: the form's own class and stylesheet (the whole width, a table that wraps), and the average's label
const UI57 = await import("./lib/s57-ui.mjs");
const DS = await import("../src/day-screen.ts");
const FX = JSON.parse(readFileSync(new URL("../tests/fixtures-s56-day54.json", import.meta.url), "utf8"));

/** The Chromium Playwright installed: its headless shell first, then its full build; the system's Chrome last. */
function browser(): string {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).sort().reverse() : [];
  for (const d of dirs.filter((x) => x.startsWith("chromium_headless_shell-"))) {
    for (const sub of readdirSync(join(cache, d))) { const p = join(cache, d, sub, "chrome-headless-shell"); if (existsSync(p)) return p; }
  }
  for (const d of dirs.filter((x) => /^chromium-\d+$/.test(x))) {
    for (const sub of readdirSync(join(cache, d))) { const p = join(cache, d, sub, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"); if (existsSync(p)) return p; }
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}
const CHROME = browser();

// ---------------------------------------------------------------- the day of 2026-10-05, as the worker writes it
const screen = DS.dayScreen(FX.lines, FX.above, FX.day.x_date, FX.day.x_state);
const STATE: Record<string, string> = { draft: "مسودة", approved: "معتمد", published: "منشور", missed: "فات الموعد" };
const dayRec: Record<string, unknown> = { ...FX.day, ...screen.header, x_state_label: STATE[FX.day.x_state] };
const lineRecs: Array<Record<string, unknown>> = FX.lines.map((l: Record<string, unknown>, i: number) => ({ ...l, ...screen.lines[i] }));
writeFileSync(out("chart-day54.html"), `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>§ 56 — x_chart_html of 2026-10-05 (#54)</title></head><body>\n${screen.header.x_chart_html}\n</body></html>\n`);

// ---------------------------------------------------------------- the arch, as Odoo would render it
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A field of the arch → its value (a selection: its label; an empty value: nothing). */
const fieldHtml = (rec: Record<string, unknown>) => (_: string, name: string, attrs: string) => {
  const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "", inv = /invisible="([^"]*)"/.exec(attrs)?.[1];
  const v = name === "x_state" ? rec.x_state_label : rec[name];
  return `<span class="o_field_widget ${cls}" data-field="${name}"${inv ? ` invisible="${inv}"` : ""}>${v === false || v === null || v === undefined ? "" : esc(v)}</span>`;
};
const top = String(UI.DAY_BODY).slice(0, String(UI.DAY_BODY).indexOf(`<field name="x_chart_html"`)).replace(`<div>${UI57.AVG_LABEL_56}</div>`, UI57.TILE).replace(/<field name="(\w+)"([^>]*)\/>/g, fieldHtml(dayRec));
if (!top.includes(UI57.TILE)) throw new Error("the average's tile was not found in the screen's top");
if (/<field /.test(top)) throw new Error("a field of the screen's top was not rendered");
// the table: the columns of the arch (the hidden ones apart), each cell with the decoration its column asks for
const cols = [...String(UI.LINE_LIST).matchAll(/<field name="(\w+)"([^>]*)\/>/g)].map((m) => ({ name: m[1], attrs: m[2] })).filter((c) => !/column_invisible="1"|optional="hide"/.test(c.attrs));
const deco = (attrs: string, rec: Record<string, unknown>) => [...attrs.matchAll(/decoration-(\w+)="([^"]*)"/g)].filter((m) => new Function("r", `with (r) { return (${m[2].replace(/&gt;/g, ">").replace(/&lt;/g, "<")}); }`)(rec))
  .map((m) => ({ success: "text-success", danger: "text-danger", bf: "fw-bold", muted: "text-muted", it: "fst-italic" } as Record<string, string>)[m[1]] ?? "").join(" ");
const LIST_HTML = `<div class="o_field_widget o_field_x2many o_field_x2many_list" name="x_line_ids"><div class="o_list_renderer o_renderer table-responsive"><table class="o_list_table table table-sm table-hover position-relative mb-0 o_list_table_ungrouped table-striped"><thead><tr>${
  cols.map((c) => `<th data-name="${c.name}"><div class="d-flex align-items-center"><span class="d-block min-w-0 text-truncate flex-grow-1 flex-shrink-1">${/string="([^"]*)"/.exec(c.attrs)?.[1] ?? c.name}</span></div></th>`).join("")}</tr></thead><tbody>${
  lineRecs.map((r) => `<tr class="o_data_row">${cols.map((c) => `<td class="o_data_cell cursor-pointer o_field_cell o_list_char ${deco(c.attrs, r)}" name="${c.name}" data-col="${c.name}">${esc(r[c.name] === false ? "" : r[c.name])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
// the card: the kanban's template with its expressions evaluated for the record
const cardTpl = /<t t-name="card">([\s\S]*?)<\/t>\s*$/.exec(String(UI.LINE_CARD))?.[1];
if (!cardTpl) throw new Error("the card template was not found in scripts/lib/s56-ui.mjs");
function card(rec: Record<string, unknown>): string {
  const record = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, { raw_value: v }]));
  const js = (e: string) => new Function("record", `return (${e.replace(/&gt;/g, ">").replace(/&lt;/g, "<")});`)(record);
  let h = cardTpl!.replace(/t-attf-class="([^"]*)"/g, (_, c: string) => `class="${c.replace(/#\{([^}]*)\}/g, (_x, e: string) => String(js(e)))}"`);
  h = h.replace(/<div([^>]*) t-if="([^"]*)">(.*?)<\/div>/g, (_, a: string, e: string, inner: string) => (js(e) ? `<div${a}>${inner}</div>` : ""));
  if (/t-if=|t-att/.test(h)) throw new Error("an expression of the card was not evaluated: measure it here before shipping it");
  h = h.replace(/<field name="(\w+)"([^>]*)\/>/g, fieldHtml(rec));
  return `<article class="o_kanban_record d-flex flex-column border rounded p-2 mb-2">${h}</article>`;
}
const CARDS_HTML = `<div class="o_field_x2many o_field_x2many_kanban"><div class="o_kanban_renderer o_renderer d-flex flex-column">${lineRecs.map(card).join("")}</div></div>`;

async function css(bundle: string) {
  const r = await fetch(`${ODOO}/web/assets/1/${bundle}`, { redirect: "follow" });
  if (!r.ok) throw new Error(`${bundle}: HTTP ${r.status}`);
  return { url: r.url, text: await r.text() };
}
const page = (cssHref: string, phone: boolean) => `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${cssHref}">
</head><body class="o_web_client" style="overflow-x:hidden">
<div class="o_action_manager"><div class="o_form_view o_view_controller ${UI57.FORM_CLASS}"><div class="o_form_renderer"><div class="o_form_sheet_bg"><div class="o_form_sheet" id="utak-sheet" data-record='${esc(JSON.stringify(Object.fromEntries(Object.entries(dayRec).filter(([k]) => k !== "x_chart_html"))))}'>
<style>${UI57.DAY_STYLE}</style>
${top}
<div class="o_field_widget o_field_html mb-3" data-field="x_chart_html"><div class="o_readonly">${screen.header.x_chart_html}</div></div>
${phone ? CARDS_HTML : LIST_HTML}
</div></div></div></div></div>
<script>
const rec = JSON.parse(document.getElementById("utak-sheet").dataset.record);
// Odoo's own «invisible»: the element is not rendered at all
const py = (e) => e.replace(/(\\w+) not in \\(([^)]*)\\)/g, "![$2].includes($1)").replace(/(\\w+) in \\(([^)]*)\\)/g, "[$2].includes($1)").replace(/\\bnot /g, "!").replace(/ and /g, " && ").replace(/ or /g, " || ");
document.querySelectorAll("[invisible]").forEach((el) => { if (new Function("r", "with (r) { return (" + py(el.getAttribute("invisible")) + "); }")(rec)) el.remove(); else el.removeAttribute("invisible"); });
const rgba = (s) => { const v = (s.match(/[\\d.]+/g) || []).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
const over = (t, b) => { const a = t[3]; return [0, 1, 2].map((i) => t[i] * a + b[i] * (1 - a)).concat(1); };
const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(rgba(getComputedStyle(e).backgroundColor)); let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) if (c[3] > 0) bg = over(c, bg); return bg; };
const sheet = document.getElementById("utak-sheet");
// every element that carries text of its own (an emoji alone has no text colour to measure)
const texts = [...sheet.querySelectorAll("*")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && /[\\p{L}\\p{N}+−—%]/u.test(n.textContent))).map((el) => {
  const bg = bgOf(el), fg = over(rgba(getComputedStyle(el).color), bg);
  return { text: el.textContent.trim().slice(0, 28), where: el.closest(".utak-day-chart") ? "chart" : el.closest("table") ? "table" : el.closest("article") ? "card" : el.closest("[name=utak_day_tiles]") ? "tiles" : "head", fg: hex(fg), bg: hex(bg), ratio: ratio(fg, bg), px: parseFloat(getComputedStyle(el).fontSize) };
});
// every drawn element of the chart: its fill (or its stroke, for the ring) against what is behind it
const drawn = [...sheet.querySelectorAll(".utak-m-cost, .utak-m-market, .utak-m-ours, .utak-bar, .utak-zero, .utak-track > .text-muted, .utak-key span[style], .utak-values span[style]")].map((el) => {
  const cs = getComputedStyle(el), bg = bgOf(el.parentElement), ring = rgba(cs.backgroundColor)[3] === 0;
  const fg = over(rgba(ring ? cs.borderTopColor : cs.backgroundColor), bg), box = el.getBoundingClientRect();
  return { kind: el.className.split(" ")[0] || el.parentElement.className.split(" ")[0] + " mark", fg: hex(fg), bg: hex(bg), ratio: ratio(fg, bg), w: +box.width.toFixed(1), h: +box.height.toFixed(1) };
});
// the three marks of a row never hide each other completely, and each stands inside its track
const rows = [...sheet.querySelectorAll(".utak-row")].map((row) => {
  const track = row.querySelector(".utak-track").getBoundingClientRect();
  const marks = [...row.querySelectorAll("[class^=utak-m-]")].map((m) => { const b = m.getBoundingClientRect(); return { kind: m.className, x: +(b.left + b.width / 2 - track.left).toFixed(1), inside: b.left >= track.left - 12 && b.right <= track.right + 12 }; });
  return { name: row.querySelector(".utak-name").textContent.trim(), profit: row.querySelector(".utak-profit").textContent.trim(), values: row.querySelector(".utak-values").textContent.trim().replace(/\\s+/g, " "), track: +track.width.toFixed(0), marks };
});
const bars = [...sheet.querySelectorAll(".utak-col")].map((c) => { const bar = c.querySelector(".utak-bar"), zero = c.querySelector(".utak-zero").getBoundingClientRect(), b = bar ? bar.getBoundingClientRect() : null; return { value: c.querySelector(".utak-bar-value").textContent.trim(), tone: bar ? bar.className.split(" ")[1] : "", height: b ? +b.height.toFixed(0) : 0, above: b ? b.bottom <= zero.top + 0.5 : null, below: b ? b.top >= zero.bottom - 0.5 : null }; });
// Odoo scrolls the action, not the document: the page's height is the sheet's own; and in a right-to-left page what overflows leaves by the LEFT edge
const edges = [...sheet.querySelectorAll("*")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
document.title = JSON.stringify({ height: Math.ceil(sheet.getBoundingClientRect().bottom + 32), width: innerWidth, scrollWidth: document.documentElement.scrollWidth, widest: Math.ceil(Math.max(...edges.map((b) => b.right))), leftmost: Math.floor(Math.min(...edges.map((b) => b.left))), texts, drawn, rows, bars });
</script></body></html>`;

function chrome(argv: string[], done: () => boolean, onOut?: (d: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(CHROME, argv, { stdio: ["ignore", "pipe", "ignore"] });
    p.stdout.on("data", (b) => onOut?.(b.toString()));
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (done()) { clearInterval(tick); setTimeout(() => { p.kill("SIGKILL"); resolve(); }, 300); }
      else if (Date.now() - t0 > 60000) { clearInterval(tick); p.kill("SIGKILL"); reject(new Error("the browser gave no output in 60 s")); }
    }, 200);
  });
}

const dir = mkdtempSync(join(tmpdir(), "utak-s56-"));
const SHOTS = [
  { name: "light", theme: "light", width: 1280, phone: false }, { name: "dark", theme: "dark", width: 1280, phone: false },
  { name: "mobile", theme: "light", width: 390, phone: true }, { name: "mobile-dark", theme: "dark", width: 390, phone: true },
];
const bundles: Record<string, { url: string; file: string }> = {};
for (const theme of ["light", "dark"]) {
  const { url, text } = await css(theme === "dark" ? "web.assets_web_dark.rtl.min.css" : "web.assets_web.rtl.min.css");
  if (!text.includes(".o_form_sheet") || !text.includes(".text-success")) throw new Error(`${theme} bundle has no form / text styles`);
  const file = join(dir, `${theme}.css`);
  writeFileSync(file, text);
  bundles[theme] = { url, file };
}
const report: Record<string, any> = { at: new Date().toISOString(), browser: CHROME.replace(homedir(), "~"), css: { light: bundles.light.url, dark: bundles.dark.url }, day: { id: FX.day.id, date: FX.day.x_date, state: FX.day.x_state }, header: Object.fromEntries(Object.entries(screen.header).filter(([k]) => k !== "x_chart_html")), shots: {} };
let bad = 0;
const check = (name: string, cond: unknown, detail = "") => { if (!cond) bad++; console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : ` — ${detail}`}`); };
for (const s of SHOTS) {
  const html = join(dir, `${s.name}.html`);
  writeFileSync(html, page(`file://${bundles[s.theme].file}`, s.phone));
  const common = ["--headless", "--disable-gpu", `--user-data-dir=${join(dir, "prof-" + s.name)}`, "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=2"];
  let dom = "";
  await chrome([...common, `--window-size=${s.width},1200`, "--dump-dom", `file://${html}`], () => dom.includes("</html>"), (d) => { dom += d; });
  const m = JSON.parse((/<title>(.*?)<\/title>/s.exec(dom)?.[1] ?? "{}").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  const png = out(`day-${s.name}.png`);
  await chrome([...common, `--window-size=${s.width},${m.height}`, `--screenshot=${png}`, `file://${html}`], () => existsSync(png) && statSync(png).mtimeMs > Date.now() - 30000 && statSync(png).size > 0);
  const low = (m.texts as any[]).filter((t) => t.ratio < 4.5), weak = (m.drawn as any[]).filter((d) => d.ratio < 3), small = (m.drawn as any[]).filter((d) => /^utak-m-/.test(d.kind) && Math.min(d.w, d.h) < 8);
  const by = (w: string) => Math.min(...(m.texts as any[]).filter((t) => t.where === w).map((t) => t.ratio));
  console.log(`${s.name} (${s.theme}, ${s.width}px): ${m.texts.length} نصاً — الرأس ${by("head")} · الأرقام الأربعة ${by("tiles")} · الرسم ${by("chart")} · ${s.phone ? `البطاقات ${by("card")}` : `الجدول ${by("table")}`} — و${m.drawn.length} عنصراً مرسوماً، أقلها ${Math.min(...m.drawn.map((d: any) => d.ratio))}:1`);
  check("كل نص ≥ 4.5:1", low.length === 0, JSON.stringify(low.slice(0, 4)));
  check("كل عنصر مرسوم في الرسم ≥ 3:1", weak.length === 0, JSON.stringify(weak.slice(0, 4)));
  check("كل علامة ≥ 8 بكسل", small.length === 0, JSON.stringify(small));
  check("لا تمرير جانبي (لا شيء يخرج عن الشاشة يميناً ولا يساراً)", m.scrollWidth <= m.width && m.widest <= m.width && m.leftmost >= 0, `${m.scrollWidth} / ${m.leftmost}…${m.widest} of ${m.width}`);
  check("كل علامة داخل محورها، وكل عمود على جهته من خط الصفر", m.rows.every((r: any) => r.marks.every((k: any) => k.inside)) && m.bars.every((b: any) => !b.tone || (b.tone === "text-success" ? b.above : b.below)), JSON.stringify(m.bars));
  report.shots[s.name] = { png: png.replace(new URL("../", import.meta.url).pathname, ""), theme: s.theme, width: s.width, height: m.height, minText: Math.min(...m.texts.map((t: any) => t.ratio)), minDrawn: Math.min(...m.drawn.map((d: any) => d.ratio)), rows: m.rows, bars: m.bars, texts: m.texts, drawn: m.drawn };
}
writeFileSync(out("day-contrast.json"), JSON.stringify(report, null, 1) + "\n");
for (const r of report.shots.light.rows) console.log(`    ${r.name} | ${r.profit} | ${r.values}`);
console.log(`    الأعمدة: ${report.shots.light.bars.map((b: any) => b.value).join("  ")}`);
console.log(`${bad ? "✗" : "✓"} shots: ${SHOTS.map((s) => report.shots[s.name].png).join(" · ")}`);
process.exit(bad ? 1 : 0);
