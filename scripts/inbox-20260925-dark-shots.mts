// The WhatsApp inbox in Odoo, light and dark (2026-09-25, STATUS § 28).
//
// No logged-in session is available to a script, so this is the closest
// thing: Odoo's own RTL CSS bundles, fetched live from the tenant
// (web.assets_web.rtl and web.assets_web_dark.rtl — Baraa's UI is Arabic and
// dark), around the message bodies exactly as Odoo stores them now (read from
// mail.message), in the saas~19.4 message markup (message.xml: the bubble is
// an absolutely positioned sibling behind .o-mail-Message-body; o-blue for
// others, o-green for Baraa's own). A script on the page measures every text
// element: its computed colour against the colour really behind it (its own
// background if any, else the bubble composited on the page), and the bar's
// colour for the echo. Read-only: nothing is written anywhere.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260925-dark-shots.mts before|preview|after
//
// before / after = the bodies as stored; preview = the stored bodies passed
// through restyleAutoEcho in memory (what the backfill will write).
//
// Out: scripts/artifacts/inbox-20260925-dark-<phase>.png (light | dark side by side) + .json

// @ts-ignore — plain JS helper
import { call } from "./lib/odoo-cli.mjs";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restyleAutoEcho } from "../src/wa-inbox.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const m = /\/json\/2\/[^/]+\/([^/?]+)/.exec(url);
  if (!m || !["read", "search_read"].includes(m[1])) throw new Error(`read-only script: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

const PHASE = process.argv[2];
if (!["before", "preview", "after"].includes(PHASE)) throw new Error("usage: before|preview|after");
const ODOO = readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").match(/^ODOO_URL=(.*)$/m)![1].trim();
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = (ext: string) => new URL(`./artifacts/inbox-20260925-dark-${PHASE}.${ext}`, import.meta.url).pathname;

/** Channel 32 (the complaint) plus the newest echo, a failure note and one of Baraa's own replies. */
const IDS = [2462, 2464, 2466, 2488, 2474, 2035];
const stored: Array<{ id: number; body: string; date: string; author_id: [number, string] }> =
  await call("mail.message", "read", { ids: IDS, fields: ["id", "body", "date", "author_id"] });
stored.sort((a, b) => IDS.indexOf(a.id) - IDS.indexOf(b.id));
if (PHASE === "preview") for (const m of stored) m.body = restyleAutoEcho(m.body) ?? m.body;
const BARAA = 3;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const avatar = (c: string, t: string) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${c}"/><text x="20" y="26" font-size="16" text-anchor="middle" fill="#fff">${t}</text></svg>`);

async function css(bundle: string) {
  const r = await realFetch(`${ODOO}/web/assets/1/${bundle}`, { redirect: "follow" });
  if (!r.ok) throw new Error(`${bundle}: HTTP ${r.status}`);
  return { url: r.url, text: await r.text() };
}

function page(theme: "light" | "dark", cssHref: string) {
  const rows = stored.map((m) => {
    const self = m.author_id[0] === BARAA;
    const bot = m.author_id[1] === "UTAK بوت";
    return `
  <div class="o-mail-Message position-relative pt-1 o-selfAuthored-${self}" data-id="${m.id}">
    <div class="o-mail-Message-core position-relative d-flex flex-shrink-0 ${self ? "flex-row-reverse" : ""}">
      <div class="o-mail-Message-sidebar d-flex flex-shrink-0 justify-content-center" style="width:48px">
        <img class="o-mail-Message-avatar rounded-circle" style="width:32px;height:32px" src="${avatar(bot ? "#1E5A41" : self ? "#5b6b8c" : "#8c6b5b", bot ? "🤖" : self ? "ب" : "ع")}"/>
      </div>
      <div class="w-100 min-w-0 flex-grow-1 ${self ? "d-flex flex-column align-items-end" : ""}">
        <div class="o-mail-Message-header d-flex align-items-baseline lh-1 mb-1">
          <span class="o-mail-Message-author fw-bold me-2">${esc(m.author_id[1])}</span>
          <small class="o-mail-Message-date text-muted opacity-75">#${m.id} · ${esc(String(m.date).slice(5, 16))} UTC</small>
        </div>
        <div class="o-mail-Message-content min-w-0">
          <div class="o-mail-Message-textContent position-relative d-flex">
            <div class="position-relative overflow-x-auto overflow-y-hidden d-inline-block o-discuss-text-body o-rounded-bottom-bubble ${self ? "o-rounded-start-bubble" : "o-rounded-end-bubble"}">
              <div class="o-mail-Message-bubble position-absolute top-0 start-0 w-100 h-100 border o-rounded-bottom-bubble ${self ? "o-rounded-start-bubble o-green" : "o-rounded-end-bubble o-blue"}"></div>
              <div class="position-relative text-break o-mail-Message-body mb-0 py-2 align-self-start o-rounded-end-bubble o-rounded-bottom-bubble">
                <div class="o-mail-Message-richBody overflow-x-auto">${m.body || '<i class="text-muted">(صوت — المرفق)</i>'}</div>
              </div>
            </div>
          </div>
          <div class="utak-probe small mt-1"></div>
        </div>
      </div>
    </div>
  </div>`;
  }).join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link rel="stylesheet" href="${cssHref}">
<style>.utak-cap{font:600 15px system-ui;padding:10px 16px;border-bottom:1px solid #8884}.utak-probe{font-family:ui-monospace,monospace;font-size:11px}</style>
</head><body class="o_web_client" style="overflow:hidden">
<div class="utak-cap">${PHASE === "before" ? "قبل — المخزّن في Odoo الآن" : PHASE === "preview" ? "معاينة — ما سيكتبه السكربت" : "بعد — المخزّن في Odoo الآن"} · saas~19.4 · الوضع ${theme === "dark" ? "الداكن" : "الفاتح"}</div>
<div class="o-mail-Thread px-2 pb-3">${rows}</div>
<script>
const rgba = (s) => { const v = (s.match(/[\\d.]+/g) || []).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1); };
const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const pageBg = rgba(getComputedStyle(document.body).backgroundColor);
const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const found = [];
document.querySelectorAll(".o-mail-Message").forEach((msg) => {
  const body = msg.querySelector(".o-mail-Message-body");
  const bubbleBg = over(rgba(getComputedStyle(msg.querySelector(".o-mail-Message-bubble")).backgroundColor), pageBg);
  const probe = msg.querySelector(".utak-probe");
  const els = [...body.querySelectorAll("p, strong, i, a, span, div")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const rows = els.map((el) => {
    let bg = bubbleBg;
    for (let e = el; e && e !== body; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { bg = over(c, bubbleBg); break; } }
    const fg = over(rgba(getComputedStyle(el).color), bg);
    return { el: el.tagName.toLowerCase(), fg: hex(fg), bg: hex(bg), ratio: +ratio(fg, bg).toFixed(2) };
  });
  const bar = body.querySelector("p[style*='border-right-width']");
  const barInfo = bar ? { bar: hex(over(rgba(getComputedStyle(bar).borderRightColor), bubbleBg)), barRatio: +ratio(over(rgba(getComputedStyle(bar).borderRightColor), bubbleBg), bubbleBg).toFixed(2), barWidth: getComputedStyle(bar).borderRightWidth } : {};
  const min = rows.length ? Math.min(...rows.map((r) => r.ratio)) : null;
  const pass = min === null || min >= 4.5;
  probe.textContent = min === null ? "(لا نص)" : (pass ? "✓ " : "✗ ") + "أقل تباين " + min.toFixed(1) + ":1 — " + rows.map((r) => r.el + " " + r.fg + "/" + r.bg).filter((v, i, a) => a.indexOf(v) === i).join(" · ") + (bar ? " · الشريط " + barInfo.bar + " " + barInfo.barRatio + ":1" : "");
  probe.style.color = pass ? "#1bbe54" : "#e5484d";
  found.push({ id: Number(msg.dataset.id), minRatio: min, pass, texts: rows, ...barInfo });
});
document.title = JSON.stringify(found);
</script></body></html>`;
}

/** Headless Chrome writes its output but does not always exit here: wait for the output, then stop it. */
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

const dir = mkdtempSync(join(tmpdir(), "utak-dark-"));
const shots: Record<string, { png: string; probes: any[]; css: string }> = {};
for (const theme of ["light", "dark"] as const) {
  const { url, text } = await css(theme === "dark" ? "web.assets_web_dark.rtl.min.css" : "web.assets_web.rtl.min.css");
  if (!text.includes(".o-mail-Message-bubble")) throw new Error(`${theme} bundle has no message styles`);
  // A local copy of the very bundle the tenant serves (headless Chrome cannot
  // reach the tenant from here; colours are the same, only Odoo's web fonts fall back).
  const cssFile = join(dir, `${theme}.css`);
  writeFileSync(cssFile, text);
  const html = join(dir, `${theme}.html`);
  writeFileSync(html, page(theme, `file://${cssFile}`));
  const png = join(dir, `${theme}.png`);
  const common = ["--headless=new", "--disable-gpu", `--user-data-dir=${join(dir, "prof-" + theme)}`, "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1"];
  await chrome([...common, "--window-size=720,1180", `--screenshot=${png}`, `file://${html}`], () => existsSync(png) && statSync(png).size > 0);
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
const worst = (t: "light" | "dark") => Math.min(...shots[t].probes.filter((p) => p.minRatio !== null).map((p) => p.minRatio));
const report = {
  phase: PHASE, at: new Date().toISOString(), messages: IDS, css: { light: shots.light.css, dark: shots.dark.css },
  minRatio: { light: worst("light"), dark: worst("dark") },
  light: shots.light.probes, dark: shots.dark.probes,
};
writeFileSync(out("json"), JSON.stringify(report, null, 2) + "\n");
for (const t of ["light", "dark"] as const) {
  console.log(`${t}: worst ${report.minRatio[t].toFixed(2)}:1`);
  for (const p of shots[t].probes) console.log(`  #${p.id} min ${p.minRatio ?? "—"} ${p.pass ? "✓" : "✗"} ${p.texts.map((x: any) => `${x.el}:${x.fg}/${x.bg}=${x.ratio}`).join(" ")}${p.bar ? ` bar ${p.bar} ${p.barRatio}:1 ${p.barWidth}` : ""}`);
}
console.log("→", out("png"));
