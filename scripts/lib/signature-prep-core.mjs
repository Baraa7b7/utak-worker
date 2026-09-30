// Signature clean-up (2026-09-24): a white-on-black scan/screenshot becomes a
// black signature on a transparent background, cropped and wide enough to
// print sharp at 46 mm. Pure functions on pngjs-shaped images
// ({ width, height, data: RGBA bytes }) so tests can feed synthetic input.
//
// Ink strength = the SMALLEST of R, G, B. White ink is high in all three;
// the dark background is low; a coloured artefact (the blue window edge in
// the source screenshot: R=28) is low in at least one channel, so it drops
// out with the background instead of surviving as grey "ink".

export const DEFAULTS = Object.freeze({
  low: 48,        // ink ≤ low → fully transparent (background + edge artefacts)
  high: 200,      // ink ≥ high → fully opaque
  border: 4,      // px cleared on every edge before anything else
  minSpeck: 40,   // connected blobs smaller than this (px) are noise
  pad: 24,        // transparent margin kept around the cropped ink (source px)
  minWidth: 1600, // output width floor (px); upscaled with bicubic when needed
});

/** Alpha 0..1 per source pixel, from the ink strength ramp. */
export function inkAlpha(img, o = DEFAULTS) {
  const { width: w, height: h, data } = img;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < o.border || y < o.border || x >= w - o.border || y >= h - o.border) continue;
      const i = (y * w + x) * 4;
      const srcA = data[i + 3] / 255;
      const m = Math.min(data[i], data[i + 1], data[i + 2]);
      let t = (m - o.low) / (o.high - o.low);
      t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); // smoothstep keeps edges soft
      a[y * w + x] = t * srcA;
    }
  }
  return a;
}

/** Drops 8-connected blobs (alpha > 0) smaller than minSpeck px. Returns count dropped. */
export function dropSpecks(a, w, h, minSpeck) {
  const label = new Int32Array(w * h);
  const stack = [];
  let dropped = 0;
  let next = 1;
  for (let s = 0; s < w * h; s++) {
    if (a[s] <= 0 || label[s]) continue;
    const members = [];
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      const px = p % w, py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (a[q] > 0 && !label[q]) { label[q] = next; stack.push(q); }
        }
      }
    }
    if (members.length < minSpeck) { for (const p of members) a[p] = 0; dropped++; }
    next++;
  }
  return dropped;
}

/** Bounding box of alpha > eps, or null when there is no ink at all. */
export function inkBox(a, w, h, eps = 0.02) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[y * w + x] > eps) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// Catmull-Rom cubic weights.
function cubic(t) {
  const x = Math.abs(t);
  if (x <= 1) return 1.5 * x * x * x - 2.5 * x * x + 1;
  if (x < 2) return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2;
  return 0;
}

/** Bicubic resample of a single-channel float image. */
export function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  const sx = sw / dw, sy = sh / dh;
  const at = (x, y) => src[Math.min(sh - 1, Math.max(0, y)) * sw + Math.min(sw - 1, Math.max(0, x))];
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const iy = Math.floor(fy);
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const ix = Math.floor(fx);
      let v = 0;
      for (let m = -1; m <= 2; m++) {
        const wy = cubic(fy - (iy + m));
        if (!wy) continue;
        for (let n = -1; n <= 2; n++) {
          const wx = cubic(fx - (ix + n));
          if (wx) v += at(ix + n, iy + m) * wx * wy;
        }
      }
      out[y * dw + x] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * Full pipeline → { png: {width, height, data}, stats }.
 * Output pixels are pure black (0,0,0) with the ink as alpha; everything
 * else is (0,0,0,0).
 */
export function prepSignature(img, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { width: w, height: h } = img;
  const a = inkAlpha(img, o);
  const specks = dropSpecks(a, w, h, o.minSpeck);
  const box = inkBox(a, w, h);
  if (!box) throw new Error("signature: no ink found (is the source white on dark?)");
  const cx0 = Math.max(0, box.x0 - o.pad), cy0 = Math.max(0, box.y0 - o.pad);
  const cx1 = Math.min(w - 1, box.x1 + o.pad), cy1 = Math.min(h - 1, box.y1 + o.pad);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  const crop = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = a[(y + cy0) * w + (x + cx0)];
  const scale = Math.max(1, o.minWidth / cw);
  const dw = Math.round(cw * scale), dh = Math.round(ch * scale);
  const out = scale === 1 ? crop : resample(crop, cw, ch, dw, dh);
  const data = Buffer.alloc(dw * dh * 4);
  let ink = 0;
  for (let p = 0; p < dw * dh; p++) {
    const v = Math.round(out[p] * 255);
    data[p * 4 + 3] = v < 3 ? 0 : v; // no near-invisible haze
    if (v >= 3) ink++;
  }
  return {
    png: { width: dw, height: dh, data },
    stats: { source: { width: w, height: h }, crop: { x: cx0, y: cy0, width: cw, height: ch }, scale: Number(scale.toFixed(4)), specksDropped: specks, output: { width: dw, height: dh }, inkPixels: ink, transparentShare: Number((1 - ink / (dw * dh)).toFixed(4)) },
  };
}

/** Transparency check used by the script and the tests. */
export function checkTransparent(png) {
  const { width: w, height: h, data } = png;
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => data[p * 4 + 3]);
  let opaque = 0, clear = 0, coloured = 0;
  for (let p = 0; p < w * h; p++) {
    const al = data[p * 4 + 3];
    if (al === 0) clear++;
    else {
      if (al === 255) opaque++;
      if (data[p * 4] || data[p * 4 + 1] || data[p * 4 + 2]) coloured++;
    }
  }
  const ok = corners.every((v) => v === 0) && clear / (w * h) > 0.5 && opaque > 0 && coloured === 0;
  return { ok, corners, clearShare: clear / (w * h), opaque, coloured };
}

/** Composites the signature over a flat colour (preview). */
export function composite(png, rgb) {
  const { width: w, height: h, data } = png;
  const out = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const al = data[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out[p * 4 + c] = Math.round(data[p * 4 + c] * al + rgb[c] * (1 - al));
    out[p * 4 + 3] = 255;
  }
  return { width: w, height: h, data: out };
}
