// Procedural canvas textures for Mage Siege: tileable terrain swatches (colour + height), bark, foliage,
// water ripples, magma and the tile highlight. Canvases are memoized per key (like Pool's `memo`), so a
// remount or a quality change reuses them; three.js textures are made per build with `toTex`.
import * as THREE from 'three';

export const mkCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const cache = new Map();
export const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

/** Wraps a canvas in a repeating texture. Colour maps are sRGB; height, roughness and normal maps are linear. */
export function toTex(c, { rx = 1, ry = 1, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding; t.anisotropy = aniso;
  return t;
}

// ================= Deterministic noise (renderer only, so trig is fine here) =================
export function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = t => t * t * (3 - 2 * t);
/** Value noise; with periods px/py > 0 it tiles every px × py lattice cells. */
export function vnoise(x, y, px = 0, py = 0, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
  const wx = a => px ? ((a % px) + px) % px : a, wy = a => py ? ((a % py) + py) % py : a;
  const x0 = wx(xi), x1 = wx(xi + 1), y0 = wy(yi), y1 = wy(yi + 1);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Fractal value noise in 0..1. */
export function fbm(x, y, px = 0, py = 0, oct = 4, s = 0) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x, y, px, py, s + i * 31); norm += amp;
    x *= 2; y *= 2; px *= 2; py *= 2; amp *= 0.5;
  }
  return sum / norm;
}
/** 1 on the creases of the noise, for cracks and veins. */
export const ridged = (x, y, px, py, oct, s) => 1 - Math.abs(2 * fbm(x, y, px, py, oct, s) - 1);
/** 3D value noise for displacing rocks and foliage. */
export function vnoise3(x, y, z, s = 0) {
  const zi = Math.floor(z), w = fade(z - zi);
  const a = vnoise(x + zi * 17.13, y - zi * 9.71, 0, 0, s), b = vnoise(x + (zi + 1) * 17.13, y - (zi + 1) * 9.71, 0, 0, s);
  return a + (b - a) * w;
}
/** Seeded PRNG for scattering strokes and props (mulberry32). */
export function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ================= Swatch painting =================
const SW = 256;
/** Paints a tileable swatch per pixel: fn(u, v, out) fills out = [r, g, b, height 0..1]. */
function paint(fn, size = SW) {
  const col = mkCanvas(size, size), hgt = mkCanvas(size, size);
  const cg = col.getContext('2d'), hg = hgt.getContext('2d');
  const ci = cg.createImageData(size, size), hi = hg.createImageData(size, size), o = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, y / size, o);
    const i = (y * size + x) * 4, h = clamp01(o[3]) * 255;
    ci.data[i] = o[0]; ci.data[i + 1] = o[1]; ci.data[i + 2] = o[2]; ci.data[i + 3] = 255;
    hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = h; hi.data[i + 3] = 255;
  }
  cg.putImageData(ci, 0, 0); hg.putImageData(hi, 0, 0);
  return { col, hgt, cg, hg, size };
}
/** Draws a feature at (x, y) and again across the edges it overlaps, so strokes tile seamlessly. */
function wrapDraw(size, x, y, pad, draw) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
    const X = x + dx, Y = y + dy;
    if (X > -pad && X < size + pad && Y > -pad && Y < size + pad) draw(X, Y);
  }
}
/** Short strokes (grass blades, needles) on the colour canvas, echoed lighter on the height canvas. */
function strokes(sw, n, rnd, { len, width = 1, color, hAlpha = 0.3, angle }) {
  const { cg, hg, size } = sw;
  for (let i = 0; i < n; i++) {
    const x = rnd() * size, y = rnd() * size, l = len[0] + rnd() * (len[1] - len[0]);
    const a = angle ? angle(rnd) : rnd() * Math.PI * 2, dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    const c = color(rnd), w = width * (0.6 + rnd() * 0.8);
    wrapDraw(size, x, y, l + 2, (X, Y) => {
      cg.strokeStyle = c; cg.lineWidth = w; cg.beginPath(); cg.moveTo(X, Y); cg.lineTo(X + dx, Y + dy); cg.stroke();
      hg.strokeStyle = `rgba(255,255,255,${hAlpha})`; hg.lineWidth = w; hg.beginPath(); hg.moveTo(X, Y); hg.lineTo(X + dx, Y + dy); hg.stroke();
    });
  }
}
/** Small shaded stones: a lit top-left, a shadowed bottom-right, and a bump on the height canvas. */
function pebbles(sw, n, rnd, { r, tones }) {
  const { cg, hg, size } = sw;
  for (let i = 0; i < n; i++) {
    const x = rnd() * size, y = rnd() * size, rr = r[0] + rnd() * (r[1] - r[0]), rot = rnd() * Math.PI, sq = 0.55 + rnd() * 0.4;
    const t = tones[(rnd() * tones.length) | 0], k = 0.8 + rnd() * 0.4;
    const base = `rgb(${t[0] * k | 0},${t[1] * k | 0},${t[2] * k | 0})`;
    wrapDraw(size, x, y, rr * 2, (X, Y) => {
      cg.save(); cg.translate(X, Y); cg.rotate(rot);
      cg.fillStyle = 'rgba(0,0,0,0.35)'; cg.beginPath(); cg.ellipse(rr * 0.25, rr * 0.3, rr * 1.1, rr * sq * 1.1, 0, 0, Math.PI * 2); cg.fill();
      const g = cg.createRadialGradient(-rr * 0.35, -rr * 0.35 * sq, rr * 0.1, 0, 0, rr * 1.05);
      g.addColorStop(0, `rgb(${Math.min(255, t[0] * k * 1.35) | 0},${Math.min(255, t[1] * k * 1.35) | 0},${Math.min(255, t[2] * k * 1.35) | 0})`);
      g.addColorStop(0.6, base); g.addColorStop(1, `rgb(${t[0] * k * 0.6 | 0},${t[1] * k * 0.6 | 0},${t[2] * k * 0.6 | 0})`);
      cg.fillStyle = g; cg.beginPath(); cg.ellipse(0, 0, rr, rr * sq, 0, 0, Math.PI * 2); cg.fill(); cg.restore();
      hg.save(); hg.translate(X, Y); hg.rotate(rot);
      const hgr = hg.createRadialGradient(0, 0, 0, 0, 0, rr); hgr.addColorStop(0, 'rgba(255,255,255,0.9)'); hgr.addColorStop(1, 'rgba(255,255,255,0)');
      hg.fillStyle = hgr; hg.beginPath(); hg.ellipse(0, 0, rr, rr * sq, 0, 0, Math.PI * 2); hg.fill(); hg.restore();
    });
  }
}
/** Small leaves (litter, foliage). */
function leaves(sw, n, rnd, { size: ls, color, hAlpha = 0.5 }) {
  const { cg, hg, size } = sw;
  for (let i = 0; i < n; i++) {
    const x = rnd() * size, y = rnd() * size, l = ls[0] + rnd() * (ls[1] - ls[0]), rot = rnd() * Math.PI * 2, c = color(rnd);
    wrapDraw(size, x, y, l * 2, (X, Y) => {
      cg.save(); cg.translate(X, Y); cg.rotate(rot); cg.fillStyle = c; cg.beginPath(); cg.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2); cg.fill(); cg.restore();
      hg.save(); hg.translate(X, Y); hg.rotate(rot); hg.fillStyle = `rgba(255,255,255,${hAlpha})`; hg.beginPath(); hg.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2); hg.fill(); hg.restore();
    });
  }
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const P = 256; // per-pixel noise samples use u*period with period dividing the lattice, so swatches tile

/** Terrain swatches: { col, hgt } canvases, each tiling seamlessly. */
export const swatch = name => memo('sw:' + name, () => SWATCHES[name]());
const SWATCHES = {
  grass() {
    const sw = paint((u, v, o) => {
      const a = fbm(u * 4, v * 4, 4, 4, 4, 11), b = fbm(u * 24, v * 24, 24, 24, 3, 12), c = vnoise(u * 96, v * 96, 96, 96, 13);
      const col = mix([50, 76, 30], [80, 104, 42], clamp01(a * 1.4 - 0.2)), k = 0.9 + b * 0.14 + c * 0.06;
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.35 + b * 0.35 + c * 0.2;
    });
    const rnd = prng(101);
    strokes(sw, 5000, rnd, { len: [2, 5], color: r => hsl(80 + r() * 26, 30 + r() * 18, 20 + r() * 16, 0.35), hAlpha: 0.03 });
    strokes(sw, 500, rnd, { len: [2, 4], color: r => hsl(68 + r() * 18, 34, 40 + r() * 10, 0.3), hAlpha: 0.04 });
    for (let i = 0; i < 10; i++) { // a few tiny flowers
      const x = rnd() * SW, y = rnd() * SW, c = rnd() < 0.5 ? 'rgba(240,230,170,0.85)' : 'rgba(235,235,245,0.8)';
      wrapDraw(SW, x, y, 3, (X, Y) => { sw.cg.fillStyle = c; sw.cg.beginPath(); sw.cg.arc(X, Y, 0.9, 0, Math.PI * 2); sw.cg.fill(); });
    }
    return sw;
  },
  dry() {
    const sw = paint((u, v, o) => {
      const a = fbm(u * 4, v * 4, 4, 4, 4, 21), b = fbm(u * 24, v * 24, 24, 24, 3, 22), c = vnoise(u * 96, v * 96, 96, 96, 23);
      const col = mix([80, 90, 42], [118, 116, 62], clamp01(a * 1.4 - 0.2)), k = 0.9 + b * 0.14 + c * 0.05;
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.35 + b * 0.35 + c * 0.2;
    });
    strokes(sw, 4000, prng(102), { len: [2, 5], color: r => hsl(52 + r() * 26, 26 + r() * 16, 28 + r() * 16, 0.35), hAlpha: 0.03 });
    return sw;
  },
  dirt() {
    const sw = paint((u, v, o) => {
      const a = fbm(u * 4, v * 4, 4, 4, 4, 31), b = fbm(u * 32, v * 32, 32, 32, 3, 32), c = vnoise(u * P, v * P, P, P, 33);
      const col = mix([86, 64, 42], [124, 96, 66], clamp01(a * 1.4 - 0.2)), k = 0.9 + b * 0.16 + c * 0.05;
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.3 + a * 0.3 + b * 0.25 + c * 0.15;
    });
    const rnd = prng(103);
    pebbles(sw, 60, rnd, { r: [2, 4.5], tones: [[128, 118, 104], [110, 96, 80], [150, 138, 120]] });
    pebbles(sw, 70, rnd, { r: [1, 2], tones: [[120, 104, 86], [96, 84, 70]] });
    return sw;
  },
  mud() {
    return paint((u, v, o) => {
      const a = fbm(u * 3, v * 3, 3, 3, 4, 41), b = fbm(u * 24, v * 24, 24, 24, 3, 42), wet = smooth(0.52, 0.66, fbm(u * 5, v * 5, 5, 5, 3, 43));
      const col = mix(mix([66, 50, 34], [96, 74, 50], a), [40, 32, 24], wet * 0.8), k = 0.86 + b * 0.22;
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.5 + b * 0.3 - wet * 0.35;
    });
  },
  ice() {
    return paint((u, v, o) => {
      const a = fbm(u * 3, v * 3, 3, 3, 4, 51), cr = smooth(0.9, 0.97, ridged(u * 5, v * 5, 5, 5, 3, 52));
      const col = mix(mix([118, 134, 146], [158, 174, 186], a), [188, 200, 210], cr * 0.3);
      o[0] = col[0]; o[1] = col[1]; o[2] = col[2]; o[3] = 0.55 + a * 0.2 - cr * 0.3;
    });
  },
  sand() {
    return paint((u, v, o) => {
      const a = fbm(u * 4, v * 4, 4, 4, 3, 61), c = vnoise(u * P, v * P, P, P, 62);
      const rip = 0.5 + 0.5 * Math.sin((v * 22 + fbm(u * 3, v * 3, 3, 3, 3, 63) * 5) * Math.PI * 2);
      const col = mix([142, 124, 88], [180, 160, 118], clamp01(a * 1.3 - 0.1)), k = 0.92 + c * 0.08 + rip * 0.05;
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.4 + rip * 0.25 + c * 0.2;
    });
  },
  wetsand() {
    return paint((u, v, o) => {
      const a = fbm(u * 4, v * 4, 4, 4, 3, 71), c = vnoise(u * P, v * P, P, P, 72);
      const col = mix([86, 76, 54], [128, 112, 80], a), k = 0.88 + c * 0.16;
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.4 + a * 0.3;
    });
  },
  forest() {
    const sw = paint((u, v, o) => {
      const a = fbm(u * 4, v * 4, 4, 4, 4, 81), b = fbm(u * 20, v * 20, 20, 20, 3, 82), moss = smooth(0.5, 0.62, fbm(u * 6, v * 6, 6, 6, 3, 83));
      const col = mix(mix([52, 40, 26], [84, 66, 40], a), [50, 74, 26], moss), k = 0.82 + b * 0.3;
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.3 + b * 0.3 + moss * 0.3;
    });
    const rnd = prng(104);
    leaves(sw, 900, rnd, { size: [2, 4], color: r => hsl(20 + r() * 30, 40 + r() * 30, 18 + r() * 22, 0.9) });
    strokes(sw, 1200, rnd, { len: [2, 4], color: r => hsl(80 + r() * 30, 40, 18 + r() * 14, 0.6), hAlpha: 0.3 });
    return sw;
  },
  rock() {
    return paint((u, v, o) => {
      const a = fbm(u * 4, v * 4, 4, 4, 5, 91), cr = smooth(0.95, 0.995, ridged(u * 6, v * 6, 6, 6, 4, 92)) * 0.25;
      const lichen = smooth(0.74, 0.82, fbm(u * 10, v * 10, 10, 10, 3, 93)) * 0.5, c = vnoise(u * P, v * P, P, P, 94);
      let col = mix([64, 62, 56], [122, 116, 106], clamp01(a * 1.5 - 0.25));
      col = mix(col, [150, 150, 96], lichen * 0.45);
      const k = (1 - cr * 0.55) * (0.9 + c * 0.16);
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = a * 0.75 + 0.2 - cr * 0.35;
    });
  },
  flag() {
    const sw = paint((u, v, o) => {
      const a = fbm(u * 8, v * 8, 8, 8, 4, 95);
      o[0] = 52 + a * 20; o[1] = 56 + a * 26; o[2] = 36 + a * 10; o[3] = 0.05; // mossy mortar
    });
    const rnd = prng(105), rows = 4, rh = SW / rows, gap = 2.6;
    for (let r = 0; r < rows; r++) {
      let x = rnd() * rh;
      const end = x + SW;
      while (x < end - 2) {
        let w = rh * (0.75 + rnd() * 0.9); if (end - (x + w) < rh * 0.5) w = end - x;
        const k = 0.78 + rnd() * 0.4, tone = [150 * k, 144 * k, 130 * k], hv = 170 + rnd() * 60 | 0;
        for (const off of [-SW, 0]) {
          const X = x + off;
          if (X + w < 0 || X > SW) continue;
          roundRect(sw.cg, X + gap, r * rh + gap, w - 2 * gap, rh - 2 * gap, 5, `rgb(${tone[0] | 0},${tone[1] | 0},${tone[2] | 0})`);
          roundRect(sw.hg, X + gap, r * rh + gap, w - 2 * gap, rh - 2 * gap, 5, `rgb(${hv},${hv},${hv})`);
        }
        x += w;
      }
    }
    // Weathering: modulate the slabs with noise so they read as worn stone
    const img = sw.cg.getImageData(0, 0, SW, SW), hi = sw.hg.getImageData(0, 0, SW, SW);
    for (let y = 0; y < SW; y++) for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4, n = fbm(x / SW * 6, y / SW * 6, 6, 6, 4, 96), c = vnoise(x, y, SW, SW, 97);
      const k = 0.78 + n * 0.36 + c * 0.1, lich = smooth(0.7, 0.78, fbm(x / SW * 9, y / SW * 9, 9, 9, 3, 98));
      img.data[i] = img.data[i] * k * (1 - lich * 0.2) + lich * 30; img.data[i + 1] = img.data[i + 1] * k + lich * 18; img.data[i + 2] = img.data[i + 2] * k * (1 - lich * 0.3);
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hi.data[i] * (0.75 + n * 0.25);
    }
    sw.cg.putImageData(img, 0, 0); sw.hg.putImageData(hi, 0, 0);
    return sw;
  },
  basalt() {
    return paint((u, v, o) => {
      const a = fbm(u * 4, v * 4, 4, 4, 5, 111), g = lavaCrack(u, v), c = vnoise(u * P, v * P, P, P, 113);
      const col = mix(mix([30, 27, 25], [70, 62, 56], a), [96, 34, 12], g), k = 0.9 + c * 0.16;
      o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.3 + a * 0.6 - g * 0.4;
    });
  },
};
function roundRect(g, x, y, w, h, r, fill) {
  g.fillStyle = fill; g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
}
const lavaCrack = (u, v) => smooth(0.86, 0.97, ridged(u * 4, v * 4, 4, 4, 4, 112));

/** Emissive cracks matching the basalt swatch: black rock, orange-to-yellow glowing seams. */
export const lavaGlowCanvas = () => memo('lavaglow', () => paint((u, v, o) => {
  const g = lavaCrack(u, v), hot = smooth(0.6, 1, g);
  o[0] = 255 * g; o[1] = (70 + 150 * hot) * g; o[2] = (10 + 60 * hot) * g; o[3] = 0;
}).col);

/** Molten rock with a drifting dark crust (map and emissive map of the vent pool). */
export const magmaCanvas = () => memo('magma', () => paint((u, v, o) => {
  const r = fbm(u * 4, v * 4, 4, 4, 5, 121), crust = smooth(0.52, 0.64, fbm(u * 5, v * 5, 5, 5, 4, 122));
  const col = mix(mix([230, 70, 8], [255, 214, 96], r), [36, 18, 12], crust);
  o[0] = col[0]; o[1] = col[1]; o[2] = col[2]; o[3] = 0;
}).col);

/** Bark: vertical ridges and grooves; u runs around the trunk, v along it. */
export const barkSwatch = () => memo('bark', () => paint((u, v, o) => {
  const rd = ridged(u * 10, v * 2, 10, 2, 4, 131), n = fbm(u * 16, v * 4, 16, 4, 3, 132);
  const col = mix([38, 28, 20], [118, 98, 76], clamp01(rd * 0.9 + n * 0.3 - 0.1));
  o[0] = col[0]; o[1] = col[1]; o[2] = col[2]; o[3] = rd * 0.8 + n * 0.2;
}));

/** Broadleaf foliage: overlapping leaves in mixed greens. */
export const leafSwatch = () => memo('leaf', () => {
  const sw = paint((u, v, o) => {
    const a = fbm(u * 6, v * 6, 6, 6, 3, 141);
    o[0] = 22 + a * 18; o[1] = 40 + a * 26; o[2] = 16 + a * 8; o[3] = 0.2;
  });
  const rnd = prng(106);
  leaves(sw, 1700, rnd, { size: [3, 6], color: r => hsl(82 + r() * 40, 38 + r() * 26, 15 + r() * 22, 0.92), hAlpha: 0.7 });
  leaves(sw, 400, rnd, { size: [3, 5], color: r => hsl(70 + r() * 30, 45, 36 + r() * 12, 0.85), hAlpha: 0.9 });
  return sw;
});

/** Conifer needles: dense dark blue-green strokes. */
export const needleSwatch = () => memo('needle', () => {
  const sw = paint((u, v, o) => {
    const a = fbm(u * 6, v * 6, 6, 6, 3, 151);
    o[0] = 16 + a * 10; o[1] = 34 + a * 18; o[2] = 24 + a * 10; o[3] = 0.2;
  });
  strokes(sw, 4200, prng(107), { len: [4, 9], color: r => hsl(128 + r() * 30, 26 + r() * 22, 12 + r() * 20, 0.85), hAlpha: 0.6, angle: r => Math.PI * (0.35 + r() * 0.3) });
  return sw;
});

/** Weathered planks running along u (the bridge deck and well roof). */
export const plankSwatch = () => memo('plank', () => paint((u, v, o) => {
  const row = Math.floor(v * 4), f = v * 4 - row, seam = smooth(0.0, 0.06, f) * smooth(1, 0.94, f);
  const g = fbm(u * 2, v * 40 + row * 3.1, 2, 160, 4, 161 + row), tone = 0.8 + hash2(row, 0, 162) * 0.3;
  const col = mix([70, 50, 32], [146, 112, 76], clamp01(g * 1.3 - 0.15));
  const k = tone * (0.35 + 0.65 * seam);
  o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = seam * (0.5 + g * 0.5);
}));

/** Tangent-space ripple normals for the lake (linear). */
export const rippleCanvas = () => memo('ripple', () => {
  const N = 256, hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    hgt[y * N + x] = fbm(u * 4, v * 4, 4, 4, 4, 171) * 0.6 + fbm(u * 10, v * 10, 10, 10, 3, 172) * 0.4;
  }
  const c = mkCanvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N), at = (x, y) => hgt[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 6, dy = (at(x, y + 1) - at(x, y - 1)) * 6, l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
});

/** Swirling mana for the well surface. */
export const manaCanvas = () => memo('mana', () => {
  const N = 256, c = mkCanvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x / N - 0.5, dy = y / N - 0.5, r = Math.hypot(dx, dy) * 2, a = Math.atan2(dy, dx);
    const sw = fbm(a / Math.PI * 3 + r * 4, r * 3, 6, 0, 4, 181), k = clamp01(0.35 + sw * 0.9 - r * 0.25), i = (y * N + x) * 4;
    img.data[i] = 40 + 120 * k * k; img.data[i + 1] = 120 + 120 * k; img.data[i + 2] = 230 + 25 * k; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
});

/** Rounded-square ring with a faint fill: tinted per call by the highlight material colour. */
export const highlightCanvas = () => memo('hl', () => {
  const N = 128, c = mkCanvas(N, N), g = c.getContext('2d');
  roundRect(g, 8, 8, N - 16, N - 16, 18, 'rgba(255,255,255,0.22)');
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 10; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(26, 10); g.arcTo(N - 10, 10, N - 10, N - 10, 16); g.arcTo(N - 10, N - 10, 10, N - 10, 16);
  g.arcTo(10, N - 10, 10, 10, 16); g.arcTo(10, 10, N - 10, 10, 16); g.closePath(); g.stroke();
  return c;
});

// ================= Figure swatches (mages and enemies) =================
// Figures are small on screen, so these read like a painted figurine: soft, low-contrast surface detail over broad
// tonal variation, never per-pixel noise. Neutral-toned where a figure tints them with its material colour (cloth,
// fur, skin); u runs around a part, v along it.

/** Twill-woven cloth: soft raised threads on a diagonal, gentle slubs, lengthwise folds and wear. Light grey, tinted per robe. */
export const clothSwatch = () => memo('cloth', () => paint((u, v, o) => {
  const T = 64, tx = Math.floor(u * T), ty = Math.floor(v * T), fu = u * T - tx, fv = v * T - ty;
  const warp = ((tx + ty) & 3) < 2; // the warp thread is on top for two of every four crossings: the diagonal twill
  const prof = Math.sin(Math.PI * (warp ? fu : fv));
  const slub = fbm(warp ? u * 32 : u * 8, warp ? v * 8 : v * 32, warp ? 32 : 8, warp ? 8 : 32, 2, 191);
  const fold = fbm(u * 6, v * 1, 6, 1, 3, 193), wear = fbm(u * 3, v * 3, 3, 3, 4, 192);
  const k = (0.965 + 0.035 * prof) * (0.97 + slub * 0.05) * (0.84 + fold * 0.16) * (0.92 + wear * 0.1), base = 212;
  o[0] = base * k; o[1] = base * k * 0.985; o[2] = base * k * 0.965; o[3] = prof * 0.35 + fold * 0.45 + slub * 0.2;
}));

/** Tanned leather: fine pebbled grain, soft creases and worn, lighter patches. */
export const leatherSwatch = () => memo('leather', () => paint((u, v, o) => {
  const grain = fbm(u * 48, v * 48, 48, 48, 2, 201), crease = smooth(0.88, 0.99, ridged(u * 3, v * 5, 3, 5, 4, 203)), wear = fbm(u * 3, v * 3, 3, 3, 4, 204);
  const col = mix([88, 56, 34], [132, 90, 56], clamp01(wear * 1.3 - 0.15)), k = (0.94 + grain * 0.08) * (1 - crease * 0.18);
  o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.55 + grain * 0.25 - crease * 0.4;
}));

/** Worked steel: soft brushed streaks, hammer dimples and smudges (also the roughness map). */
export const metalSwatch = () => memo('metal', () => {
  const sw = paint((u, v, o) => {
    const brush = fbm(u * 2, v * 48, 2, 48, 3, 211), dent = fbm(u * 5, v * 5, 5, 5, 3, 212), smudge = smooth(0.55, 0.8, fbm(u * 3, v * 3, 3, 3, 4, 213));
    const k = 168 + brush * 22 + dent * 18 - smudge * 30;
    o[0] = k; o[1] = k; o[2] = k * 1.02; o[3] = 0.5 + dent * 0.4 + brush * 0.1;
  });
  strokes(sw, 80, prng(214), { len: [8, 30], width: 0.7, color: () => 'rgba(225,228,232,0.35)', hAlpha: 0.05 });
  return sw;
});

/** Fur: soft locks of hair running lengthwise, darker at the roots, lighter at the tips. Neutral, tinted per animal. */
export const furSwatch = () => memo('fur', () => {
  const sw = paint((u, v, o) => {
    const a = fbm(u * 4, v * 4, 4, 4, 4, 221), lock = fbm(u * 16, v * 3, 16, 3, 3, 223);
    o[0] = o[1] = o[2] = 120 + a * 30 + lock * 30; o[3] = 0.3 + lock * 0.5;
  });
  const rnd = prng(222), along = r => Math.PI * (0.45 + r() * 0.1);
  strokes(sw, 2600, rnd, { len: [7, 16], width: 1.6, color: r => { const g = 110 + r() * 50 | 0; return `rgba(${g},${g},${g},0.22)`; }, hAlpha: 0.12, angle: along });
  strokes(sw, 900, rnd, { len: [6, 12], width: 1.2, color: r => { const g = 185 + r() * 40 | 0; return `rgba(${g},${g},${g * 0.98 | 0},0.18)`; }, hAlpha: 0.15, angle: along });
  return sw;
});

/** Skin: soft mottling, faint wrinkles and very fine pores. Light and neutral, tinted per creature (goblin green, troll grey). */
export const skinSwatch = () => memo('skin', () => {
  const sw = paint((u, v, o) => {
    const blot = fbm(u * 4, v * 4, 4, 4, 4, 231), fine = fbm(u * 24, v * 24, 24, 24, 2, 232), wr = smooth(0.92, 0.99, ridged(u * 6, v * 10, 6, 10, 3, 233));
    const k = (0.9 + blot * 0.12 + fine * 0.03) * (1 - wr * 0.06);
    o[0] = 222 * k; o[1] = 208 * k; o[2] = 196 * k; o[3] = 0.6 + fine * 0.15 - wr * 0.3;
  });
  const rnd = prng(234), { cg, hg, size } = sw;
  for (let i = 0; i < 500; i++) { // pores
    const x = rnd() * size, y = rnd() * size, r = 0.6 + rnd() * 0.6;
    cg.fillStyle = 'rgba(110,70,60,0.06)'; cg.beginPath(); cg.arc(x, y, r, 0, Math.PI * 2); cg.fill();
    hg.fillStyle = 'rgba(0,0,0,0.12)'; hg.beginPath(); hg.arc(x, y, r, 0, Math.PI * 2); hg.fill();
  }
  return sw;
});

/** Polished wood grain running along v (staffs, clubs, shafts). */
export const woodSwatch = () => memo('wood', () => paint((u, v, o) => {
  const warp = fbm(u * 3, v, 3, 1, 4, 241) * 2.5, ring = 0.5 + 0.5 * Math.sin((u * 6 + warp) * Math.PI * 2);
  const fine = fbm(u * 32, v * 4, 32, 4, 2, 242), knot = smooth(0.8, 0.92, fbm(u * 4, v * 2, 4, 2, 3, 243));
  const col = mix([104, 66, 36], [156, 108, 64], clamp01(ring * 0.6 + fine * 0.4)), k = 1 - knot * 0.25;
  o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; o[3] = 0.4 + ring * 0.3 + fine * 0.2 - knot * 0.3;
}));

/** Bat wing membrane: thin leathery skin with raised branching veins. */
export const membraneSwatch = () => memo('membrane', () => paint((u, v, o) => {
  const vein = smooth(0.9, 0.985, ridged(u * 4, v * 4, 4, 4, 4, 251)), blot = fbm(u * 6, v * 6, 6, 6, 3, 252);
  const col = mix(mix([58, 36, 34], [92, 58, 52], blot), [128, 86, 74], vein * 0.7);
  o[0] = col[0]; o[1] = col[1]; o[2] = col[2]; o[3] = 0.3 + vein * 0.6 + blot * 0.1;
}));

/** Soft round glow (halos around staff crystals). */
export const glowCanvas = () => memo('glow', () => {
  const N = 128, c = mkCanvas(N, N), g = c.getContext('2d'), gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  return c;
});

/** A glinting five-pointed star (stunned "dizzy" stars). */
export const starCanvas = () => memo('star', () => {
  const N = 64, c = mkCanvas(N, N), g = c.getContext('2d');
  g.translate(N / 2, N / 2); g.shadowColor = 'rgba(255,230,120,0.95)'; g.shadowBlur = 10;
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i & 1 ? 9 : 22; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath();
  const gr = g.createRadialGradient(-4, -6, 2, 0, 0, 22); gr.addColorStop(0, '#fffbe0'); gr.addColorStop(0.5, '#ffd84a'); gr.addColorStop(1, '#e09a10');
  g.fillStyle = gr; g.fill(); g.shadowBlur = 0; g.lineWidth = 1.5; g.strokeStyle = 'rgba(120,70,0,0.8)'; g.stroke();
  return c;
});

/** Rounded bar (health bar frame and fill); white, tinted by the sprite material. */
export const barCanvas = () => memo('bar', () => {
  const c = mkCanvas(64, 16);
  roundRect(c.getContext('2d'), 1, 1, 62, 14, 6, '#ffffff');
  return c;
});

/** `n` aura rings for a mage's feet (one per level): soft glowing circles with runic ticks and sparkles. White, tinted per element. */
export const auraCanvas = n => memo('aura' + n, () => {
  const N = 512, c = mkCanvas(N, N), g = c.getContext('2d'), cx = N / 2, rnd = prng(260 + n);
  for (let i = 0; i < n; i++) {
    // Strokes are wide enough to stay visible when the whole board is on screen (a tile is only ~50 px there)
    const r = N * (0.42 - 0.058 * i), w = 13 - i;
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 14; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = w;
    g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 5; g.lineWidth = 2.2; g.strokeStyle = 'rgba(255,255,255,0.7)';
    const ticks = 16 + i * 4;
    for (let k = 0; k < ticks; k++) {
      const a = (k + (i & 1) * 0.5) / ticks * Math.PI * 2, r0 = r + w / 2 + 2, r1 = r0 + (k % 4 === 0 ? 9 : 5);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2, rr = r + (rnd() - 0.5) * 12, s = 1 + rnd() * 2.2;
      g.beginPath(); g.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, s, 0, Math.PI * 2); g.fill();
    }
  }
  return c;
});

/** Painted shield face: a royal blue field, a gold chevron between three gold roundels, worn and scratched. */
export const heraldryCanvas = () => memo('heraldry', () => {
  const N = 256, c = mkCanvas(N, N), g = c.getContext('2d');
  g.fillStyle = '#1d3a86'; g.fillRect(0, 0, N, N);
  g.fillStyle = '#e2b24a';
  g.beginPath(); g.moveTo(0, N * 0.62); g.lineTo(N / 2, N * 0.3); g.lineTo(N, N * 0.62); g.lineTo(N, N * 0.8); g.lineTo(N / 2, N * 0.48); g.lineTo(0, N * 0.8); g.closePath(); g.fill();
  for (const [x, y] of [[0.3, 0.2], [0.7, 0.2], [0.5, 0.72]]) { g.beginPath(); g.arc(x * N, (1 - y) * N * 0.98, N * 0.07, 0, Math.PI * 2); g.fill(); }
  const img = g.getImageData(0, 0, N, N), rnd = prng(281);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, k = 0.82 + fbm(x / N * 6, y / N * 6, 6, 6, 4, 282) * 0.3 + vnoise(x, y, N, N, 283) * 0.06;
    img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(220,220,220,0.35)'; g.lineWidth = 0.8;
  for (let i = 0; i < 40; i++) { const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI, l = 5 + rnd() * 18; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  return c;
});

/** Blotchy noise for the death dissolve (alpha map): values 0.5..1, so lowering opacity from 1 to 0.5 eats the figure away. */
export const dissolveCanvas = () => memo('dissolve', () => paint((u, v, o) => {
  const n = clamp01(fbm(u * 6, v * 6, 6, 6, 4, 271) * 1.4 - 0.2), k = 128 + n * 127;
  o[0] = o[1] = o[2] = k; o[3] = 0;
}).col);
