// § 60 (2026-10-06) — «📊 اليوم» as it looks after § 60, drawn: «خلاصة اليوم», the tiles, «🎯 هدف اليوم», the
// chart with its break-even, and the three tabs (text alone), in the light and the dark theme — on a
// phone (390px), where Baraa's Chrome cannot be made that narrow, and at 1280 / 1440 px, where the chart
// stands under / beside «ربح الكرتون» (Odoo's own «xxl» classes: the real media query, no emulation).
//
// The four HTML fields are the ones STORED on a real day (read from the tenant, read-only: one read), so
// what is drawn is what Odoo's sanitizer kept. Around them: Odoo's own RTL CSS bundles, fetched from
// the tenant (two GETs of public CSS), the form's class and stylesheet (scripts/lib/s57-ui.mjs) and the
// tiles as the view's arch writes them (scripts/lib/s56-ui.mjs). Every text is measured against what is
// really behind it (4.5:1 at least), the red ┃ of the break-even too (3:1), the pink zone must differ
// from the page, and nothing may leave the screen sideways. The browser is the Chromium Playwright
// installed, headless (not a dependency of this project). The phone's picture is a DRAWING: the real
// one is Baraa's own screenshot inside Odoo.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s60-20261006-shots.mts [--day=55]
//
// Out (scripts/artifacts/): s60-20261006-drawn-{mobile,mobile-dark,1280,1440,1440-dark}.png, s60-20261006-drawn.json
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const dotenv = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const ODOO = dotenv.ODOO_URL;
const DAY_ID = Number((process.argv.find((a) => a.startsWith("--day=")) ?? "").slice(6)) || 0;
const out = (name: string) => new URL(`./artifacts/s60-20261006-${name}`, import.meta.url).pathname;
const UI = await import("./lib/s56-ui.mjs");
const UI57 = await import("./lib/s57-ui.mjs");
const UI58 = await import("./lib/s58-ui.mjs");

// ---------------------------------------------------------------- the day, as it is stored
const { call } = await import("./lib/odoo-cli.mjs");
const FIELDS = ["id", "x_date", "x_state", "x_published_at", "x_n_publish", "x_n_skip", "x_n_warn", "x_n_publishable", "x_avg_profit", "x_avg_profit_show", "x_brief_html", "x_target_html", "x_chart_html", ...UI58.TABS.map((t: any) => t.field)];
const [rec] = await call("x_price_day", "search_read", { domain: DAY_ID ? [["id", "=", DAY_ID]] : [["x_utak_simulation", "!=", true]], fields: FIELDS, order: "x_date desc, id desc", limit: 1 });
if (!rec?.x_brief_html) throw new Error("the day carries no «خلاصة اليوم» yet: scripts/s60-20261006-days.mts --apply first");
const STATE: Record<string, string> = { draft: "مسودة", approved: "معتمد", published: "منشور", missed: "فات الموعد" };
const dayRec: Record<string, unknown> = { ...rec, x_state_label: STATE[rec.x_state] };

function browser(): string {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).sort().reverse() : [];
  for (const d of dirs.filter((x) => x.startsWith("chromium_headless_shell-"))) for (const sub of readdirSync(join(cache, d))) { const p = join(cache, d, sub, "chrome-headless-shell"); if (existsSync(p)) return p; }
  for (const d of dirs.filter((x) => /^chromium-\d+$/.test(x))) for (const sub of readdirSync(join(cache, d))) { const p = join(cache, d, sub, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"); if (existsSync(p)) return p; }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}
const CHROME = browser();
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fieldHtml = (r: Record<string, unknown>) => (_: string, name: string, attrs: string) => {
  const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "", inv = /invisible="([^"]*)"/.exec(attrs)?.[1];
  const v = name === "x_state" ? r.x_state_label : r[name];
  return `<span class="o_field_widget ${cls}" data-field="${name}"${inv ? ` invisible="${inv}"` : ""}>${v === false || v === null || v === undefined ? "" : esc(v)}</span>`;
};
// the tiles and the note under them, as the arch writes them
const body = String(UI.DAY_BODY);
const top = body.slice(body.indexOf(`<div class="row g-2 mb-2" name="utak_day_tiles">`), body.indexOf(`<field name="x_chart_html"`)).replace(`<div>${UI57.AVG_LABEL_56}</div>`, UI57.TILE).replace(/<field name="(\w+)"([^>]*)\/>/g, fieldHtml(dayRec));
const html = (f: string) => `<div class="o_field_widget o_field_html" data-field="${f}"><div class="o_readonly">${rec[f]}</div></div>`;

async function css(bundle: string) {
  const r = await fetch(`${ODOO}/web/assets/1/${bundle}`, { redirect: "follow" });
  if (!r.ok) throw new Error(`${bundle}: HTTP ${r.status}`);
  return { url: r.url, text: await r.text() };
}
const page = (cssHref: string) => `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${cssHref}">
</head><body class="o_web_client" style="overflow-x:hidden">
<div class="o_action_manager"><div class="o_form_view o_view_controller ${UI57.FORM_CLASS}"><div class="o_form_renderer"><div class="o_form_sheet_bg"><div class="o_form_sheet" id="utak-sheet" data-record='${esc(JSON.stringify(Object.fromEntries(Object.entries(dayRec).filter(([k]) => !/_html$/.test(k)))))}'>
<style>${UI57.DAY_STYLE}</style>
<div class="fs-2 fw-bold mb-2">📊 اليوم — ${esc(rec.x_date)} <span class="fs-6 text-muted">(${dayRec.x_state_label})</span></div>
<div class="o_notebook d-flex w-100 horizontal flex-column"><div class="o_notebook_content tab-content"><div class="tab-pane active show" id="utak-today">
<div name="utak_day_brief" class="mb-2">${html("x_brief_html")}</div>
${top}
<div class="mb-3">${html("x_target_html")}</div>
${html("x_chart_html")}
</div></div></div>
${UI58.TABS.map((t: any) => `<div class="utak-tab-drawn border-top mt-4 pt-3"><div class="fw-bold text-muted mb-2">${t.title}</div><div class="o_notebook"><div class="tab-content"><div class="tab-pane active show">${html(t.field)}</div></div></div></div>`).join("\n")}
</div></div></div></div></div>
<script>
const recd = JSON.parse(document.getElementById("utak-sheet").dataset.record);
const py = (e) => e.replace(/(\\w+) not in \\(([^)]*)\\)/g, "![$2].includes($1)").replace(/(\\w+) in \\(([^)]*)\\)/g, "[$2].includes($1)").replace(/\\bnot /g, "!").replace(/ and /g, " && ").replace(/ or /g, " || ");
document.querySelectorAll("[invisible]").forEach((el) => { if (new Function("r", "with (r) { return (" + py(el.getAttribute("invisible")) + "); }")(recd)) el.remove(); else el.removeAttribute("invisible"); });
const rgba = (s) => { const v = (s.match(/[\\d.]+/g) || []).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
const over = (t, b) => { const a = t[3]; return [0, 1, 2].map((i) => t[i] * a + b[i] * (1 - a)).concat(1); };
const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(rgba(getComputedStyle(e).backgroundColor)); let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) if (c[3] > 0) bg = over(c, bg); return bg; };
const sheet = document.getElementById("utak-sheet");
const where = (el) => el.closest(".utak-brief") ? "brief" : el.closest(".utak-target") ? "target" : el.closest(".utak-tab") ? "tab" : el.closest(".utak-day-chart") ? "chart" : el.closest("[name=utak_day_tiles]") ? "tiles" : "head";
const texts = [...sheet.querySelectorAll("*")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && /[\\p{L}\\p{N}+−—%]/u.test(n.textContent))).map((el) => {
  const bg = bgOf(el), fg = over(rgba(getComputedStyle(el).color), bg);
  return { text: el.textContent.trim().slice(0, 28), where: where(el), fg: hex(fg), bg: hex(bg), ratio: ratio(fg, bg) };
});
const even = [...sheet.querySelectorAll(".utak-even")].map((el) => { const bg = bgOf(el.parentElement), fg = over(rgba(getComputedStyle(el).backgroundColor), bg), b = el.getBoundingClientRect(), t = el.parentElement.getBoundingClientRect(); return { ratio: ratio(fg, bg), fg: hex(fg), w: +b.width.toFixed(1), h: +b.height.toFixed(1), inside: b.left >= t.left - 2 && b.right <= t.right + 2 }; });
const zone = [...sheet.querySelectorAll(".utak-loss-zone")].map((el) => { const bg = bgOf(el.parentElement), fg = over(rgba(getComputedStyle(el).backgroundColor), bg), b = el.getBoundingClientRect(); return { fg: hex(fg), bg: hex(bg), differs: hex(fg) !== hex(bg), w: +b.width.toFixed(1), red: fg[0] > fg[1] + 12 && fg[0] > fg[2] + 12 }; });
const box = (s) => { const e = sheet.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
const edges = [...sheet.querySelectorAll("*")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
document.title = JSON.stringify({ height: Math.ceil(sheet.getBoundingClientRect().bottom + 32), width: innerWidth, scrollWidth: document.documentElement.scrollWidth, widest: Math.ceil(Math.max(...edges.map((b) => b.right))), leftmost: Math.floor(Math.min(...edges.map((b) => b.left))),
  texts, even, zone, chart: getComputedStyle(sheet.querySelector(".utak-day-chart")).display, prices: box(".utak-prices"), profits: box(".utak-profits"), brief: box(".utak-brief"), tiles: box("[name=utak_day_tiles]"), drawings: sheet.querySelectorAll(".utak-tab [style], .utak-tab svg, .utak-tab table, .utak-brief [style], .utak-target [style]").length });
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

const dir = mkdtempSync(join(tmpdir(), "utak-s60-"));
const SHOTS = [
  { name: "mobile", theme: "light", width: 390 }, { name: "mobile-dark", theme: "dark", width: 390 },
  { name: "1280", theme: "light", width: 1280 }, { name: "1440", theme: "light", width: 1440 }, { name: "1440-dark", theme: "dark", width: 1440 },
];
const bundles: Record<string, { url: string; file: string }> = {};
for (const theme of ["light", "dark"]) {
  const { url, text } = await css(theme === "dark" ? "web.assets_web_dark.rtl.min.css" : "web.assets_web.rtl.min.css");
  if (!text.includes(".o_form_sheet") || !text.includes(".bg-opacity-25") || !text.includes(".d-xxl-flex")) throw new Error(`${theme} bundle lacks the classes § 60 uses`);
  const file = join(dir, `${theme}.css`);
  writeFileSync(file, text);
  bundles[theme] = { url, file };
}
const report: Record<string, any> = { at: new Date().toISOString(), browser: CHROME.replace(homedir(), "~"), css: { light: bundles.light.url, dark: bundles.dark.url }, day: { id: rec.id, date: rec.x_date, state: rec.x_state }, shots: {} };
let bad = 0;
const check = (name: string, cond: unknown, detail = "") => { if (!cond) bad++; console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : ` — ${detail}`}`); };
for (const s of SHOTS) {
  const file = join(dir, `${s.name}.html`);
  writeFileSync(file, page(`file://${bundles[s.theme].file}`));
  const common = ["--headless", "--disable-gpu", `--user-data-dir=${join(dir, "prof-" + s.name)}`, "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=2"];
  let dom = "";
  await chrome([...common, `--window-size=${s.width},1200`, "--dump-dom", `file://${file}`], () => dom.includes("</html>"), (d) => { dom += d; });
  const m = JSON.parse((/<title>(.*?)<\/title>/s.exec(dom)?.[1] ?? "{}").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  const png = out(`drawn-${s.name}.png`);
  await chrome([...common, `--window-size=${s.width},${m.height}`, `--screenshot=${png}`, `file://${file}`], () => existsSync(png) && statSync(png).mtimeMs > Date.now() - 30000 && statSync(png).size > 0);
  const low = (m.texts as any[]).filter((t) => t.ratio < 4.5);
  const by = (w: string) => Math.min(...(m.texts as any[]).filter((t) => t.where === w).map((t) => t.ratio));
  console.log(`${s.name} (${s.theme}, ${s.width}px): ${m.texts.length} نصاً — الخلاصة ${by("brief")} · الهدف ${by("target")} · التبويبات ${by("tab")} · الرسم ${by("chart")} · ارتفاع ${m.height}`);
  check("كل نص ≥ 4.5:1", low.length === 0, JSON.stringify(low.slice(0, 4)));
  check("┃ التعادل ≥ 3:1 وداخل محوره وبعرض 3 بكسل، لكل صنف له تعادل", m.even.length > 0 && m.even.every((e: any) => e.ratio >= 3 && e.inside && Math.abs(e.w - 3) < 0.6), JSON.stringify(m.even));
  check("المنطقة قبل التعادل تُرى وتميل للأحمر (وردية)", m.zone.length === m.even.length && m.zone.every((z: any) => z.differs && z.red && z.w > 0), JSON.stringify(m.zone));
  check("لا تمرير جانبي", m.scrollWidth <= m.width && m.widest <= m.width && m.leftmost >= 0, `${m.scrollWidth} / ${m.leftmost}…${m.widest} of ${m.width}`);
  check("«سعرنا مقابل السوق» ≤ 960 بكسل", m.prices.w <= 960, String(m.prices.w));
  if (s.width >= 1400) check("من 1400 بكسل: «ربح الكرتون» بجانب «سعرنا مقابل السوق» (على يساره)", m.chart === "flex" && Math.abs(m.profits.y - m.prices.y) < 4 && m.profits.x + m.profits.w <= m.prices.x, JSON.stringify([m.chart, m.prices, m.profits]));
  else check("دون 1400 بكسل: «ربح الكرتون» تحته", m.chart === "block" && m.profits.y >= m.prices.y + m.prices.h - 2, JSON.stringify([m.chart, m.prices, m.profits]));
  check("«خلاصة اليوم» بعرض البلاطات (لا تدخل عنها)", Math.abs(m.brief.w - m.tiles.w) <= 16, JSON.stringify([m.brief, m.tiles]));
  check("لا رسم في الخلاصة ولا الهدف ولا التبويبات (نص وقوائم فقط)", m.drawings === 0, String(m.drawings));
  report.shots[s.name] = { png: png.replace(new URL("../", import.meta.url).pathname, ""), theme: s.theme, width: s.width, height: m.height, minText: Math.min(...m.texts.map((t: any) => t.ratio)), even: m.even, zone: m.zone, chart: m.chart, prices: m.prices, profits: m.profits, brief: m.brief, tiles: m.tiles };
}
writeFileSync(out("drawn.json"), JSON.stringify(report, null, 1) + "\n");
console.log(`${bad ? "✗" : "✓"} shots: ${SHOTS.map((s) => report.shots[s.name].png).join(" · ")}`);
process.exit(bad ? 1 : 0);
