// Before / after screenshots of the bot echo in the Discuss inbox, light and
// dark (2026-09-24). Not a screenshot of a logged-in session: the page is
// Odoo 19's own CSS bundles, loaded live from the tenant (web.assets_web and
// web.assets_web_dark — the dark mode Baraa uses), around the message bodies
// exactly as Odoo stores them (read from mail.message). A script on the page
// reads the computed text and background colour of every cream box and
// prints the WCAG contrast under it.
//
// «before» = the stored bodies as they are. «after» = the same messages with
// the box style the new code posts (src/wa-inbox.ts AUTO_STYLE), in the form
// Odoo stores it: its style whitelist drops border-left (seen on every stored
// echo) and keeps background-color / color / padding / margin.
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/inbox-20260924-contrast-shots.mts before|after
//
// Out: scripts/artifacts/inbox-20260924-contrast-<before|after>.png (+ .json)

// @ts-ignore — plain JS helper
import { call } from "./lib/odoo-cli.mjs";
import { AUTO_STYLE } from "../src/wa-inbox.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED");
  const m = /\/json\/2\/[^/]+\/([^/?]+)/.exec(url);
  if (m && !["read", "search_read"].includes(m[1])) throw new Error(`read-only script: ${m[1]}`);
  return realFetch(input, init);
}) as typeof fetch;

const PHASE = process.argv[2];
if (!["before", "after"].includes(PHASE)) throw new Error("usage: before|after");
const env = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const ODOO = env.ODOO_URL;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** The 09-24 18:00 thread in the collector's channel: welcome echo, the two failures, the list. */
const IDS = [2471, 2472, 2473, 2474];
const out = (ext: string) => new URL(`./artifacts/inbox-20260924-contrast-${PHASE}.${ext}`, import.meta.url).pathname;

/** AUTO_STYLE as Odoo stores it: whitelisted properties only, «prop:value; prop:value». */
const ODOO_KEEPS = new Set(["background-color", "color", "padding", "margin"]);
const storedStyle = AUTO_STYLE.split(";").map((d) => d.trim()).filter(Boolean)
  .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()])
  .filter(([p]) => ODOO_KEEPS.has(p)).map(([p, v]) => `${p}:${v}`).join("; ");
const stored: Array<{ id: number; body: string; date: string }> = await call("mail.message", "read", { ids: IDS, fields: ["id", "body", "date"] });
const msgs = stored.map((m) => PHASE === "before" ? m
  : { ...m, body: m.body.replace(/<p style="[^"]*background-color:\s*#F7F5F0[^"]*"/i, `<p style="${storedStyle}"`) });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const avatar = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#1E5A41"/><text x="20" y="26" font-size="18" text-anchor="middle" fill="#fff">🤖</text></svg>`);

function page(theme: string) {
  const bundle = theme === "dark" ? "web.assets_web_dark.min.css" : "web.assets_web.min.css";
  const rows = msgs.map((m) => `
  <div class="o-mail-Message position-relative py-1 mt-2 px-3">
    <div class="o-mail-Message-core position-relative d-flex flex-shrink-0">
      <div class="o-mail-Message-sidebar d-flex flex-shrink-0 align-items-start" style="width:48px">
        <img class="o-mail-Message-avatar rounded-circle" style="width:36px;height:36px" src="${avatar}"/>
      </div>
      <div class="w-100 o-min-width-0 flex-grow-1">
        <div class="o-mail-Message-header d-flex align-items-baseline lh-1 mb-1">
          <span class="o-mail-Message-author fw-bold me-2">UTAK بوت</span>
          <small class="o-mail-Message-date text-muted opacity-75">${esc(String(m.date).slice(11, 16))} UTC · #${m.id}</small>
        </div>
        <div class="o-mail-Message-content o-min-width-0 position-relative">
          <div class="o-mail-Message-textContent position-relative d-flex">
            <div class="position-relative d-inline-block" style="max-width:100%">
              <div class="o-mail-Message-bubble rounded-bottom-3 position-absolute top-0 start-0 w-100 h-100 border o-blue"></div>
              <div class="o-mail-Message-body text-break mb-0 w-100 position-relative p-2 px-3">${m.body}</div>
            </div>
          </div>
          <div class="utak-probe small mt-1" data-for="${m.id}"></div>
        </div>
      </div>
    </div>
  </div>`).join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link rel="stylesheet" href="${ODOO}/web/assets/1/${bundle}">
<style>.utak-cap{font:600 15px system-ui;padding:10px 16px;border-bottom:1px solid #8884}.utak-probe{font-family:ui-monospace,monospace}</style>
</head><body class="o_web_client" style="overflow:hidden">
<div class="utak-cap">${PHASE === "before" ? "قبل (المخزّن الآن)" : "بعد (نمط الكود الجديد كما يخزّنه Odoo)"} · Odoo 19 · الوضع ${theme === "dark" ? "الداكن" : "الفاتح"}</div>
<div class="o-mail-Thread pb-3">${rows}</div>
<script>
const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
const lum = (c) => { const [r, g, b] = c.map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const found = [];
document.querySelectorAll(".o-mail-Message-body").forEach((body) => {
  const box = body.querySelector("p[style*='background']");
  const probe = body.closest(".o-mail-Message-content").querySelector(".utak-probe");
  if (!box) { probe.textContent = ""; return; }
  const cs = getComputedStyle(box);
  const r = ratio(rgb(cs.color), rgb(cs.backgroundColor));
  const pass = r >= 4.5;
  probe.textContent = (pass ? "✓ " : "✗ ") + "التباين " + r.toFixed(1) + ":1 — النص " + cs.color + " على " + cs.backgroundColor + (pass ? " (≥ 4.5 AA)" : " (أقل من 4.5 AA)");
  probe.style.color = pass ? "#1bbe54" : "#e5484d";
  found.push({ id: Number(probe.dataset.for), color: cs.color, background: cs.backgroundColor, ratio: +r.toFixed(2) });
});
document.title = JSON.stringify(found);
</script></body></html>`;
}

const dir = mkdtempSync(join(tmpdir(), "utak-shots-"));
const shots: Record<string, { png: string; probes: unknown[] }> = {};
for (const theme of ["light", "dark"]) {
  const html = join(dir, `${theme}.html`);
  writeFileSync(html, page(theme));
  const png = join(dir, `${theme}.png`);
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=640,1020", "--virtual-time-budget=10000", `--screenshot=${png}`, `file://${html}`], { stdio: "ignore" });
  const dom = execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--virtual-time-budget=10000", "--dump-dom", `file://${html}`]).toString();
  shots[theme] = { png, probes: JSON.parse((/<title>(.*?)<\/title>/s.exec(dom)?.[1] ?? "[]").replace(/&quot;/g, '"')) };
}
execFileSync("python3", ["-c", `
from PIL import Image
a, b = Image.open(${JSON.stringify(shots.light.png)}), Image.open(${JSON.stringify(shots.dark.png)})
c = Image.new("RGB", (a.width + b.width + 12, max(a.height, b.height)), (128, 128, 128))
c.paste(a, (0, 0)); c.paste(b, (a.width + 12, 0)); c.save(${JSON.stringify(out("png"))})
`]);
const report = { phase: PHASE, at: new Date().toISOString(), messages: IDS, boxStyle: PHASE === "before" ? "stored" : storedStyle, light: shots.light.probes, dark: shots.dark.probes };
writeFileSync(out("json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log("→", out("png"));
