// Logo checks (2026-09-24), shared by scripts/brand-20260924-logo-prep.mjs
// and tests/fin-statements.test.mts.

/** True when the SVG paints its own background: a <rect> (or any element)
 *  that covers the whole viewBox with a fill. utak-avatar-light.svg does
 *  (#F7F5F0); utak-icon-color.svg does not. */
export function svgHasBackground(svg) {
  const vb = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1]?.trim().split(/\s+/).map(Number);
  if (!vb || vb.length !== 4) throw new Error("svg without a viewBox");
  const [vx, vy, vw, vh] = vb;
  for (const m of svg.matchAll(/<rect\b([^>]*)\/?>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if (!a.fill || a.fill === "none" || a.fill === "transparent") continue;
    const x = Number(a.x ?? 0), y = Number(a.y ?? 0);
    const w = a.width === "100%" ? vw : Number(a.width), h = a.height === "100%" ? vh : Number(a.height);
    if (x <= vx && y <= vy && x + w >= vx + vw && y + h >= vy + vh) return true;
  }
  return /<svg[^>]*style="[^"]*background/.test(svg);
}

/** Alpha and colour facts of a decoded PNG ({ width, height, data } RGBA). */
export function analyzeLogoPng(png, brandHex) {
  const { width: w, height: h, data } = png;
  const at = (x, y) => (y * w + x) * 4;
  const cornerAlpha = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => data[at(x, y) + 3]);
  const brand = new Set(brandHex.map((c) => c.toUpperCase()));
  let transparent = 0, opaque = 0, opaqueOffBrand = 0;
  const colours = {};
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a === 0) { transparent++; continue; }
    if (a !== 255) continue; // anti-aliased edge
    opaque++;
    const hex = "#" + [0, 1, 2].map((c) => data[i * 4 + c].toString(16).padStart(2, "0")).join("").toUpperCase();
    colours[hex] = (colours[hex] ?? 0) + 1;
    if (!brand.has(hex)) opaqueOffBrand++;
  }
  return {
    cornerAlpha,
    transparent: cornerAlpha.every((a) => a === 0),
    transparentShare: transparent / (w * h),
    opaque,
    opaqueOffBrand,
    opaqueColours: colours,
  };
}
