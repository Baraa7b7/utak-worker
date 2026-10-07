// § 64 (2026-10-07) — «📈 تاريخ الأسعار», the worker's page, as a browser draws it: at a phone's width (390) and at
// 1280, from PROD'S REAL DATA (read-only: the worker's own readHistory, through .env.sim-verify), and — because
// the real days are few yet — once more from SAMPLE data, so the chart itself can be looked at.
//
// READ-ONLY on Odoo: any request that is not a read is refused before it leaves; any graph.facebook.com request
// throws. Nothing is written, nothing is sent. The page is the worker's renderHistoryPage, byte for byte; a
// measuring script is added to a COPY of it (the worker's page carries none).
//
//   node --experimental-strip-types --experimental-loader=./tests/loader.mjs scripts/s64-20261007-shots.mts
//
// Out (git-ignored): scripts/artifacts/s64-20261007-prices-{390,1280}.png (real), -dark-1280.png,
// -sample-{390,1280}.png, s64-20261007-prices.html and s64-20261007-shots.json.
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_QUERY, MAX_WIDTH_PX, MIN_DAYS, addDays, buildHistory, readHistory, renderHistoryPage, type HistoryProduct, type HistoryRow } from "../src/price-history.ts";
import { riyadhDateKey } from "../src/hours.ts";

const READS = new Set(["read", "search_read", "search", "search_count", "fields_get"]);
const realFetch = globalThis.fetch;
let odooReads = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("graph.facebook.com")) throw new Error("BLOCKED: WhatsApp send from a render check");
  const m = /\/json\/2\/([^/]+)\/([^/?]+)/.exec(url);
  if (m) { if (!READS.has(m[2])) throw new Error(`BLOCKED: ${m[1]}.${m[2]} is not a read`); odooReads++; }
  return realFetch(input, init);
}) as typeof fetch;
const env: any = Object.fromEntries(readFileSync(new URL("../.env.sim-verify", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
delete env.META_ACCESS_TOKEN;
const kv = new Map<string, string>();
env.MSG_DEDUP = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
const OUT = new URL("./artifacts/", import.meta.url).pathname;
const now = Date.now(), today = riyadhDateKey(new Date(now));

function browser(): string {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).sort().reverse() : [];
  for (const d of dirs.filter((x) => x.startsWith("chromium_headless_shell-"))) for (const sub of readdirSync(join(cache, d))) { const p = join(cache, d, sub, "chrome-headless-shell"); if (existsSync(p)) return p; }
  for (const d of dirs.filter((x) => /^chromium-\d+$/.test(x))) for (const sub of readdirSync(join(cache, d))) { const p = join(cache, d, sub, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"); if (existsSync(p)) return p; }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}
const CHROME = browser();
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
// what the page is measured by (added to a copy of it): its widths, its cards' columns, its texts' contrast, any drawn zero
const MEASURE = `<script>
const lum = (c) => { const m = /rgba?\\((\\d+), (\\d+), (\\d+)/.exec(c); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]); };
const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) return b; } return "rgb(255, 255, 255)"; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
const texts = [...document.querySelectorAll("h1, h2, .sub, .brand, .row > span, a.chip, .legend span, .stat .k, .stat .v, .stat .d, .pack, .thin, summary, .foot")].filter((e) => e.textContent.trim()).map((e) => ({ t: e.textContent.trim().slice(0, 24), r: ratio(getComputedStyle(e).color, bgOf(e)) }));
const svgTexts = [...document.querySelectorAll(".chart .tick")].map((e) => ratio(getComputedStyle(e).fill, bgOf(e.closest(".card"))));
const cards = [...document.querySelectorAll(".card")].map((c) => c.getBoundingClientRect());
const plotFloor = (svg) => svg.viewBox.baseVal.height - 24;
const onFloor = [...document.querySelectorAll(".chart")].flatMap((svg) => [...svg.querySelectorAll(".m-market, .m-purchase")].filter((m) => (m.tagName === "circle" ? +m.getAttribute("cy") : +m.getAttribute("y") + 4) >= plotFloor(svg) - 0.5)).length;
document.title = JSON.stringify({ height: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bodyScrollW: document.body.scrollWidth,
  wrapW: Math.round(document.querySelector(".wrap").getBoundingClientRect().width), cards: cards.length, columns: new Set(cards.map((r) => Math.round(r.left))).size, widest: Math.round(Math.max(0, ...cards.map((r) => r.right))),
  charts: document.querySelectorAll(".chart").length, thin: document.querySelectorAll(".thin").length, onFloor, minText: Math.min(...texts.map((t) => t.r)), low: texts.filter((t) => t.r < 4.5).slice(0, 5), minTick: svgTexts.length ? Math.min(...svgTexts) : null,
  market: getComputedStyle(document.documentElement).getPropertyValue("--market").trim(), scripts: document.scripts.length });
</script></body>`;

// ---- the real page
const data = await readHistory(env, today);
const model = buildHistory(data.rows, data.products, today, DEFAULT_QUERY);
const everything = buildHistory(data.rows, data.products, today, { ...DEFAULT_QUERY, activeOnly: false });
const realHtml = renderHistoryPage(model, "/history/p/0/sample", now + 15 * 60_000);
writeFileSync(join(OUT, "s64-20261007-prices.html"), realHtml);
console.log(`prod, ${today}: ${data.rows.length} real lines of ${data.products.length} items (${odooReads} reads) → ${model.cards.length} cards («النشطة للبيع فقط»), ${model.insufficient} «بيانات غير كافية»; every item: ${everything.cards.length} cards, ${everything.insufficient} «بيانات غير كافية»`);
for (const c of everything.cards) console.log(`  ${c.name}: market days ${c.marketDays}/${MIN_DAYS}${c.enough ? " (chart)" : ""} · last market ${c.lastMarket ? `${c.lastMarket.value} (${c.lastMarket.day})` : "—"} · last purchase ${c.lastPurchase?.value ?? "—"} · «بدون خسارة» ${c.lastReference?.value ?? "—"}`);

// ---- the sample page: six items over thirty days, with empty days, a lone day, a fall, a short one
const P = (id: number, name: string, categoryId: number, category: string): HistoryProduct => ({ id, name, categoryId, category, activeForSale: true });
const sampleProducts = [P(1, "موز أمريكي (عيّنة)", 5, "فواكه"), P(2, "رمان وسط (عيّنة)", 5, "فواكه"), P(3, "طماطم (عيّنة)", 6, "خضار"), P(4, "خيار (عيّنة)", 6, "خضار"), P(5, "برتقال (عيّنة)", 5, "فواكه"), P(6, "نعناع (عيّنة)", 7, "ورقيات")];
const sampleRows: HistoryRow[] = [];
const wave = (i: number, base: number, amp: number, drift: number) => Math.round((base + amp * Math.sin(i / 2.3) + drift * i) * 4) / 4;
for (let back = 29; back >= 0; back--) {
  const i = 29 - back, day = addDays(today, -back);
  const add = (productId: number, market: number, purchase: number, pack: string) => sampleRows.push({ day, productId, market, purchase, breakEven: purchase > 0 ? Math.round((purchase * 1.05 + 2.56) * 115) / 100 : 0, fullCost: 0, pack });
  // 1: every day; 2: the market missing five days in the middle and the purchase three others; 3: a fall, with one lone market day after a gap
  add(1, wave(i, 72, 3, 0.15), wave(i, 60, 2, 0.1), "كرتون · 14 كيلو");
  add(2, back >= 8 && back <= 12 ? 0 : wave(i, 20, 1.5, 0.05), back >= 3 && back <= 5 ? 0 : wave(i, 15, 0.8, 0.02), "كرتون · 4 كيلو");
  add(3, back === 4 || back === 5 || back === 2 || back === 1 ? 0 : wave(i, 30, 2, -0.35), wave(i, 22, 1, -0.2), "كرتون · 8 كيلو");
  if (back % 3 === 0) add(4, wave(i, 12, 1, 0), wave(i, 8, 0.5, 0), "كرتون · 5 كيلو");
  if (back < 3) add(5, wave(i, 110, 4, 0), wave(i, 95, 2, 0), "كرتون · 18 كيلو");
  if (back < 10) add(6, 0, wave(i, 6, 0.4, 0), "ربطة");
}
const sampleHtml = renderHistoryPage(buildHistory(sampleRows, sampleProducts, today, DEFAULT_QUERY), "/history/p/0/sample", now + 15 * 60_000).replace("<h1>", '<h1><span style="font-size:13px;color:var(--muted)">بيانات عيّنة للنظر في الرسم — ليست أسعاراً حقيقية · </span>');

const dir = mkdtempSync(join(tmpdir(), "utak-s64-"));
const SHOTS = [
  { key: "prices-390", html: realHtml, width: 390, dsf: 2, dark: false }, { key: "prices-1280", html: realHtml, width: 1280, dsf: 1, dark: false }, { key: "prices-dark-1280", html: realHtml, width: 1280, dsf: 1, dark: true },
  { key: "prices-sample-390", html: sampleHtml, width: 390, dsf: 2, dark: false }, { key: "prices-sample-1280", html: sampleHtml, width: 1280, dsf: 1, dark: false }, { key: "prices-sample-dark-390", html: sampleHtml, width: 390, dsf: 2, dark: true },
];
let bad = 0;
const check = (name: string, cond: unknown, detail = "") => { if (!cond) bad++; console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || !detail ? "" : ` — ${detail}`}`); };
const report: Record<string, unknown> = { at: new Date().toISOString(), browser: CHROME.replace(homedir(), "~"), today, real: { lines: data.rows.length, items: data.products.length, cards: model.cards.length, insufficient: model.insufficient, everyItem: { cards: everything.cards.length, insufficient: everything.insufficient } }, shots: {} };
for (const s of SHOTS) {
  // the dark picture: the page's own dark colours, forced (the browser here has no dark setting to turn)
  const html = (s.dark ? s.html.replace("@media (prefers-color-scheme: dark)", "@media all") : s.html.replace("@media (prefers-color-scheme: dark)", "@media not all"));
  const file = join(dir, `${s.key}.html`), measured = join(dir, `${s.key}-m.html`);
  writeFileSync(file, html);
  writeFileSync(measured, html.replace("</body>", MEASURE));
  const common = ["--headless", "--disable-gpu", `--user-data-dir=${join(dir, "prof-" + s.key)}`, "--no-first-run", "--hide-scrollbars", `--force-device-scale-factor=${s.dsf}`, "--virtual-time-budget=6000"];
  let dom = "";
  await chrome([...common, `--window-size=${s.width},1200`, "--dump-dom", `file://${measured}`], () => dom.includes("</html>"), (d) => { dom += d; });
  const m = JSON.parse((/<title>(.*?)<\/title>/s.exec(dom)?.[1] ?? "{}").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  const png = join(OUT, `s64-20261007-${s.key}.png`);
  await chrome([...common, `--window-size=${s.width},${m.height}`, `--screenshot=${png}`, `file://${file}`], () => existsSync(png) && statSync(png).mtimeMs > Date.now() - 30000 && statSync(png).size > 0);
  console.log(`${s.key} (${s.width}px${s.dark ? ", dark" : ""}): ${m.cards} cards in ${m.columns} column(s), ${m.charts} charts, ${m.thin} «بيانات غير كافية», the page ${m.wrapW}px wide, ${m.height}px high`);
  check("no sideways scroll: the page is no wider than its window", m.scrollW <= m.clientW && m.bodyScrollW <= m.clientW && m.widest <= m.clientW, JSON.stringify([m.scrollW, m.bodyScrollW, m.clientW, m.widest]));
  check(`the page is ${MAX_WIDTH_PX}px at most`, m.wrapW <= MAX_WIDTH_PX, String(m.wrapW));
  check(s.width >= 720 ? "two cards a row" : "one card a row", m.cards < 2 || m.columns === (s.width >= 720 ? 2 : 1), String(m.columns));
  check("no price drawn on the chart's floor (a zero would be)", m.onFloor === 0, String(m.onFloor));
  check("every text ≥ 4.5:1 on its ground; the chart's axis labels ≥ 4.5:1", m.minText >= 4.5 && (m.minTick === null || m.minTick >= 4.5), JSON.stringify({ low: m.low, tick: m.minTick }));
  check(`${s.dark ? "the dark" : "the light"} colours are in force`, m.market === (s.dark ? "#d95926" : "#eb6834"), m.market);
  (report.shots as any)[s.key] = { file: `scripts/artifacts/s64-20261007-${s.key}.png`, ...m, title: undefined };
}
check("the worker's own page carries no script (the measuring one is the copy's)", !/<script/i.test(realHtml));
writeFileSync(join(OUT, "s64-20261007-shots.json"), JSON.stringify(report, null, 2) + "\n");
console.log(bad ? `\n✗ ${bad} check(s) failed` : "\nall checks passed");
process.exit(bad ? 1 : 0);
