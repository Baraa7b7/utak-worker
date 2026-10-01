// § 46 أ (2026-10-01) — the board's cards, light and dark.
//
// No logged-in session is available to a script, so (as in § 28) this is the closest thing: Odoo's
// own RTL CSS bundles, fetched from the tenant (web.assets_web.rtl and web.assets_web_dark.rtl —
// Baraa's UI is Arabic and dark), around the card exactly as the view's arch writes it (the arch is
// read from scripts/s46-20261001-board.mjs; a field becomes its value, the badge widget its span),
// with the four statuses. A script on the page measures every text against what is really behind
// it. Read-only: only two GETs of public CSS.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s46-20261001-board-shots.mts
//
// Out: scripts/artifacts/s46-20261001-board-cards.png (light | dark) + .json
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ODOO = readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").match(/^ODOO_URL=(.*)$/m)![1].trim();
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = (ext: string) => new URL(`./artifacts/s46-20261001-board-cards.${ext}`, import.meta.url).pathname;
const src = readFileSync(new URL("./s46-20261001-board.mjs", import.meta.url), "utf8");
const card = /const CARD = `<t t-name="card">([\s\S]*?)<\/t>`;/.exec(src)?.[1];
if (!card) throw new Error("the card template was not found in scripts/s46-20261001-board.mjs");

const LABEL: Record<string, string> = { green: "🟢 رابح", yellow: "🟡 يغطي البضاعة فقط", red: "🔴 خسارة على البضاعة", none: "⚪ لا بيانات" };
const SAMPLES = [
  { x_name: "رمان وسط — كرتون", x_board_status: "green", x_net_purchase: "20.00", x_full_cost: "22.99", x_board_sale: "34.50", x_real_profit: "7.01" },
  { x_name: "رمان صغير — كرتون", x_board_status: "yellow", x_net_purchase: "17.39", x_full_cost: "20.25", x_board_sale: "23.00", x_real_profit: "-0.25" },
  { x_name: "رمان كبير — كرتون", x_board_status: "red", x_net_purchase: "26.09", x_full_cost: "29.38", x_board_sale: "31.05", x_real_profit: "-2.38" },
  { x_name: "رمان مصري — كرتون · 8 كيلو", x_board_status: "none", x_net_purchase: "0.00", x_full_cost: "0.00", x_board_sale: "0.00", x_real_profit: "0.00" },
];
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
document.title = JSON.stringify(found);
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
const shots: Record<string, { png: string; probes: any[]; css: string }> = {};
for (const theme of ["light", "dark"] as const) {
  const { url, text } = await css(theme === "dark" ? "web.assets_web_dark.rtl.min.css" : "web.assets_web.rtl.min.css");
  if (!text.includes(".o_kanban_record")) throw new Error(`${theme} bundle has no kanban styles`);
  const cssFile = join(dir, `${theme}.css`);
  writeFileSync(cssFile, text);
  const html = join(dir, `${theme}.html`);
  writeFileSync(html, page(theme, `file://${cssFile}`));
  const png = join(dir, `${theme}.png`);
  const common = ["--headless=new", "--disable-gpu", `--user-data-dir=${join(dir, "prof-" + theme)}`, "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1"];
  await chrome([...common, "--window-size=760,520", `--screenshot=${png}`, `file://${html}`], () => existsSync(png) && statSync(png).size > 0);
  let dom = "";
  await chrome([...common, "--dump-dom", `file://${html}`], () => dom.includes("</html>"), (d) => { dom += d; });
  shots[theme] = { png, css: url, probes: JSON.parse((/<title>(.*?)<\/title>/s.exec(dom)?.[1] ?? "[]").replace(/&quot;/g, '"').replace(/&amp;/g, "&")) };
}
execFileSync("python3", ["-c", `
from PIL import Image
a, b = Image.open(${JSON.stringify(shots.light.png)}), Image.open(${JSON.stringify(shots.dark.png)})
c = Image.new("RGB", (a.width + b.width + 12, max(a.height, b.height)), (128, 128, 128))
c.paste(a, (0, 0)); c.paste(b, (a.width + 12, 0)); c.save(${JSON.stringify(out("png"))})
`]);
const worst = (t: "light" | "dark") => Math.min(...shots[t].probes.map((p) => p.minRatio));
const report = { at: new Date().toISOString(), css: { light: shots.light.css, dark: shots.dark.css }, minRatio: { light: worst("light"), dark: worst("dark") }, light: shots.light.probes, dark: shots.dark.probes };
writeFileSync(out("json"), JSON.stringify(report, null, 2) + "\n");
for (const t of ["light", "dark"] as const) {
  console.log(`${t}: worst text contrast ${report.minRatio[t].toFixed(2)}:1`);
  for (const p of shots[t].probes) console.log(`  ${p.status}: min ${p.minRatio} ${p.pass ? "✓" : "✗"} · border ${p.border} ${p.borderWidth} (${p.borderRatio}:1) · ${p.texts.map((x: any) => `${x.fg}/${x.bg}=${x.ratio}`).join(" ")}`);
}
console.log("→", out("png"));
