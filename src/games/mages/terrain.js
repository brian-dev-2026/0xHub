// Mage Siege terrain: a smooth heightfield (raised hills, sunken dirt path, lake basin, distant rolling land)
// textured by compositing tileable PBR swatches through per-terrain masks, a rippling lake, glowing lava
// seams, the props from props.js, and the tile highlight overlay.
import * as THREE from 'three';
import { W, H } from '../../../shared/games/mages/data';
import { bridgeSpans, buildProps, deckAt, deckTop } from './props';
import { fbm, highlightCanvas, lavaGlowCanvas, mkCanvas, rippleCanvas, smooth, swatch, toTex } from './textures';

export const WATER_Y = -0.1;
const BASIN_Y = -0.4;
const HILL_H = 0.55;
const PATH_DEPTH = 0.04;
const STONE_Y = WATER_Y + 0.045; // stepping stone top on a water tile, where a mage stands
// Textured inner area (tile coords) around the 16 × 9 board; beyond it the land is plain grass fading into fog
const U0 = -3, U1 = W + 3, V0 = -2.5, V1 = H + 2.5;
const FAR = { u0: -24, u1: W + 24, v0: -18, v1: H + 14 };

// Kinds tracked by the signed-distance scan (index into the per-point distance array)
const K = { water: 0, hill: 1, forest: 2, blocked: 3, crystal: 4, lava: 5, ruins: 6, well: 7, mud: 8, ice: 9, bridge: 10 };
const NK = 11;
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/**
 * Terrain fields for a map, in tile coordinates (u right, v down the board; tile x spans u ∈ [x, x+1]).
 * Exposes the ground height, distance to the path and signed distances to tiles of each kind.
 */
export function makeField(map) {
  const seed = map.seed % 9973;
  const kinds = new Int8Array(W * H).fill(-1), extra = new Int8Array(W * H).fill(-1);
  map.tiles.forEach((t, i) => {
    if (t.kind === 'build') { if (K[t.terrain] !== undefined) kinds[i] = K[t.terrain]; }
    else if (t.terrain === 'bridge') { kinds[i] = K.water; extra[i] = K.bridge; }
    else if (t.terrain === 'mud' || t.terrain === 'ice') kinds[i] = K[t.terrain];
  });
  // Path polyline through tile centres, extended straight off both board edges into the distance
  const c = map.path.map(t => [(t % W) + 0.5, Math.floor(t / W) + 0.5]);
  const pts = [[c[0][0] - 40, c[0][1]], ...c, [c[c.length - 1][0] + 40, c[c.length - 1][1]]];
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
  // Buckets of nearby segments per tile cell (board ±2), so a distance query checks only a few segments
  const BX0 = -2, BY0 = -2, BW = W + 4, BH = H + 4, buckets = Array.from({ length: BW * BH }, () => []);
  segs.forEach((s, k) => {
    if (k === 0 || k === segs.length - 1) return; // the long extensions are checked separately
    const x0 = Math.floor(Math.min(s[0], s[2]) - 1.2), x1 = Math.floor(Math.max(s[0], s[2]) + 1.2);
    const y0 = Math.floor(Math.min(s[1], s[3]) - 1.2), y1 = Math.floor(Math.max(s[1], s[3]) + 1.2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const bx = x - BX0, by = y - BY0;
      if (bx >= 0 && by >= 0 && bx < BW && by < BH) buckets[by * BW + bx].push(k);
    }
  });
  const segDist = (s, u, v) => {
    const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((u - s[0]) * dx + (v - s[1]) * dy) / l2));
    return Math.hypot(u - s[0] - dx * t, v - s[1] - dy * t);
  };
  /** Distance to the path centre line, capped at 1.2 (exact below 1). */
  function pathDist(u, v) {
    let d = Math.min(1.2, segDist(segs[0], u, v), segDist(segs[segs.length - 1], u, v));
    const bx = Math.floor(u) - BX0, by = Math.floor(v) - BY0;
    if (bx >= 0 && by >= 0 && bx < BW && by < BH) for (const k of buckets[by * BW + bx]) d = Math.min(d, segDist(segs[k], u, v));
    return d;
  }
  /**
   * Fills out[kind] with the signed distance to the nearest tile of that kind (negative inside), capped at 1.5.
   * Tiles are rounded per kind and the lookup point is domain-warped, so features read as natural shapes
   * rather than squares while staying on their tiles.
   */
  const RAD = [0.34, 0.42, 0.3, 0.4, 0.42, 0.42, 0.1, 0.28, 0.12, 0.12, 0];
  let wu = 0, wv = 0;
  const tileSd = (out, kk, x, y, u, v) => {
    const pu = kk >= K.mud ? u : wu, pv = kk >= K.mud ? v : wv, r = RAD[kk]; // path stretches stay on the path
    const qx = Math.abs(pu - x - 0.5) - 0.5 + r, qy = Math.abs(pv - y - 0.5) - 0.5 + r;
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    out[kk] = kk === K.water ? smin(out[kk], sd, 0.45) : Math.min(out[kk], sd);
  };
  function sdKinds(u, v, out) {
    out.fill(1.5);
    wu = u + (fbm(u * 1.6, v * 1.6, 0, 0, 3, seed + 30) - 0.5) * 0.3; wv = v + (fbm(u * 1.6, v * 1.6, 0, 0, 3, seed + 31) - 0.5) * 0.3;
    const tx = Math.floor(u), ty = Math.floor(v);
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (kinds[i] >= 0) tileSd(out, kinds[i], x, y, u, v);
      if (extra[i] >= 0) tileSd(out, extra[i], x, y, u, v);
    }
    return out;
  }
  /** How far outside the board rectangle a point is (0 on the board). */
  const outside = (u, v) => Math.hypot(Math.max(-u, u - W, 0), Math.max(-v, v - H, 0));
  /** Rolling land beyond the board; kept lower on the near side so it never hides the front row. */
  const rise = (u, v) => {
    const o = outside(u, v);
    if (o === 0) return 0;
    return smooth(0.3, 9, o) * (0.9 + 2.4 * fbm(u * 0.09, v * 0.09, 0, 0, 3, seed + 7)) * (v > H ? 0.45 : 1);
  };
  const sd = new Float32Array(NK);
  /** Ground height (world y) at tile coords. */
  function height(u, v) {
    sdKinds(u, v, sd);
    let h = (fbm(u * 0.45, v * 0.45, 0, 0, 3, seed) - 0.5) * 0.09 + (fbm(u * 3.2, v * 3.2, 0, 0, 2, seed + 1) - 0.5) * 0.02;
    const r = rise(u, v);
    h += r;
    if (sd[K.hill] < 1) {
      const n = (fbm(u * 2, v * 2, 0, 0, 2, seed + 2) - 0.5) * 0.18;
      h += HILL_H * (1 - smooth(-0.42, 0.42, sd[K.hill] + n)) * (0.9 + n);
    }
    if (sd[K.blocked] < 1) h += 0.05 * (1 - smooth(-0.3, 0.2, sd[K.blocked]));
    // Sunken path with a slight raised verge
    const d = pathDist(u, v);
    if (d < 1) {
      h += 0.016 * Math.exp(-(((d - 0.53) / 0.08) ** 2));
      const floor = -PATH_DEPTH + r * 0.3 + (fbm(u * 5, v * 5, 0, 0, 2, seed + 3) - 0.5) * 0.014;
      h += (floor - h) * (1 - smooth(0.35, 0.49, d));
    }
    // Lake basin (kept off the dry path beside it; the bridge tile is part of the lake)
    if (sd[K.water] < 0.12) h += (BASIN_Y - h) * (1 - smooth(-0.3, 0.1, sd[K.water])) * Math.max(smooth(0.38, 0.5, d), 1 - smooth(0, 0.25, sd[K.bridge]));
    return h;
  }
  return { seed, kinds, extra, height, pathDist, sdKinds, outside, path: c };
}

/** n + 1 evenly spaced samples from a to b. */
const even = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
/** Samples from `edge` outward to `end`, starting fine and growing coarser with distance (for the fogged land). */
function graded(edge, end, first) {
  const out = [], dir = Math.sign(end - edge);
  let x = edge, step = first;
  while ((end - x) * dir > step * 0.5) { x += step * dir; out.push(x); step = Math.min(1.6, step * 1.3); }
  out[out.length - 1] = end;
  return out;
}
/**
 * An indexed height grid over the sample positions us × vs, with smooth normals from central differences of the
 * height function, so grids that share edge samples meet without seams or cracks.
 */
function gridGeo(us, vs, hf, uvf) {
  const cols = us.length, rows = vs.length, nu = cols - 1, nv = rows - 1, n = cols * rows;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), e = 0.06;
  for (let j = 0, k = 0; j < rows; j++) {
    const v = vs[j];
    for (let i = 0; i < cols; i++, k++) {
      const u = us[i], y = hf(u, v);
      pos[k * 3] = u - W / 2; pos[k * 3 + 1] = y; pos[k * 3 + 2] = v - H / 2;
      const dx = (hf(u + e, v) - hf(u - e, v)) / (2 * e), dz = (hf(u, v + e) - hf(u, v - e)) / (2 * e), l = Math.hypot(dx, 1, dz);
      nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l;
      const t = uvf(u, v); uv[k * 2] = t[0]; uv[k * 2 + 1] = t[1];
    }
  }
  const idx = new Uint32Array(nu * nv * 6);
  for (let j = 0, k = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.set([a, c, b, b, c, d], k); k += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Swatch layers in painting order: tiles per swatch repeat, roughness, mask name
const LAYERS = [
  ['dry', 1.6, 0.95], ['forest', 1.4, 0.92], ['rock', 2.0, 0.78], ['sand', 1.8, 0.88], ['basalt', 1.6, 0.72],
  ['flag', 1.2, 0.8], ['dirt', 1.4, 0.92], ['mud', 1.3, 0.42], ['ice', 1.6, 0.18], ['wetsand', 1.8, 0.5],
];
const GRASS_SPAN = 1.6, GRASS_ROUGH = 0.93;

/** Per-layer masks (0..1) on a coarse grid over the inner area, plus the lava-seam mask for the emissive map. */
function buildMasks(field, MR) {
  const mw = (U1 - U0) * MR, mh = (V1 - V0) * MR, n = mw * mh, s = field.seed;
  const m = { shade: new Float32Array(n) }; for (const [name] of LAYERS) m[name] = new Float32Array(n);
  const lava = new Float32Array(n), hgt = new Float32Array(n), sd = new Float32Array(NK);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) hgt[j * mw + i] = field.height(U0 + (i + 0.5) / MR, V0 + (j + 0.5) / MR);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    const k = j * mw + i, u = U0 + (i + 0.5) / MR, v = V0 + (j + 0.5) / MR;
    field.sdKinds(u, v, sd);
    const d = field.pathDist(u, v), n1 = fbm(u * 2.6, v * 2.6, 0, 0, 3, s + 5) - 0.5, n2 = fbm(u * 0.35, v * 0.35, 0, 0, 3, s + 6);
    const out = field.outside(u, v);
    const edge = smooth(0, 1.2, Math.min(u - U0, U1 - u, v - V0, V1 - v)); // fade to plain grass at the inner border
    const gx = (hgt[j * mw + Math.min(mw - 1, i + 1)] - hgt[j * mw + Math.max(0, i - 1)]) * MR / 2;
    const gz = (hgt[Math.min(mh - 1, j + 1) * mw + i] - hgt[Math.max(0, j - 1) * mw + i]) * MR / 2;
    const slope = Math.hypot(gx, gz);
    const dirt = (1 - smooth(0.34, 0.47, d + n1 * 0.18)) * smooth(-0.15, 0.05, sd[K.bridge]);
    m.dry[k] = Math.min(1, smooth(0.52, 0.7, n2) * 0.8 + (1 - smooth(0.45, 0.85, d + n1 * 0.25)) * 0.55 + (1 - smooth(-0.3, 0.3, sd[K.hill])) * 0.35) * edge;
    m.forest[k] = Math.max(1 - smooth(-0.12, 0.3, sd[K.forest] + n1 * 0.4), smooth(0.47, 0.62, fbm(u * 0.16, v * 0.16, 0, 0, 3, s + 40)) * smooth(0.4, 1.2, out)) * edge;
    m.rock[k] = Math.max(smooth(0.55, 1.15, slope + n1 * 0.3) * 0.75, (1 - smooth(-0.3, 0.12, sd[K.blocked] + n1 * 0.45)) * 0.6, (1 - smooth(-0.3, 0.1, sd[K.crystal] + n1 * 0.45)) * 0.7) * edge;
    m.sand[k] = 1 - smooth(0.04, 0.3, sd[K.water] + n1 * 0.25);
    m.basalt[k] = 1 - smooth(-0.1, 0.3, sd[K.lava] + n1 * 0.5);
    m.flag[k] = Math.max((1 - smooth(-0.1, 0.0, sd[K.ruins])) * (1 - smooth(0.52, 0.66, fbm(u * 3, v * 3, 0, 0, 3, s + 8))), (1 - smooth(-0.1, 0.0, sd[K.well])) * (1 - smooth(0.6, 0.72, fbm(u * 3, v * 3, 0, 0, 3, s + 9))));
    m.dirt[k] = dirt;
    m.mud[k] = dirt * (1 - smooth(-0.15, 0.25, sd[K.mud] + n1 * 0.35));
    m.ice[k] = dirt * (1 - smooth(-0.15, 0.2, sd[K.ice] + n1 * 0.3)) * (0.4 + 0.25 * smooth(0.35, 0.65, fbm(u * 4, v * 4, 0, 0, 3, s + 11))); // frost over the dirt
    m.wetsand[k] = smooth(WATER_Y + 0.02, WATER_Y - 0.03, hgt[k]);
    lava[k] = 1 - smooth(-0.32, 0.02, sd[K.lava] + n1 * 0.35);
    // Baked occlusion: the path's sunken edges, the wet shoreline and the foot of hills
    m.shade[k] = Math.min(0.75, 0.5 * Math.exp(-(((d - 0.45) / 0.07) ** 2)) * smooth(-0.1, 0.1, sd[K.bridge]) + 0.4 * Math.exp(-((sd[K.water] / 0.1) ** 2)) + 0.25 * Math.exp(-(((sd[K.hill] - 0.35) / 0.15) ** 2)) + 0.35 * (1 - smooth(-0.35, 0.05, sd[K.blocked] + n1 * 0.3)));
  }
  return { m, lava, mw, mh };
}
function maskCanvas(a, mw, mh) {
  const c = mkCanvas(mw, mh), g = c.getContext('2d'), img = g.createImageData(mw, mh);
  for (let k = 0; k < a.length; k++) { img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = 255; img.data[k * 4 + 3] = a[k] * 255; }
  g.putImageData(img, 0, 0);
  return c;
}

/** Paints colour, height (bump) and roughness canvases for the inner area, plus the lava emissive map. */
function paintTerrain(field, q) {
  const tw = q.texSize, ppt = tw / (U1 - U0), th = Math.round((V1 - V0) * ppt), MR = 12;
  const { m, lava, mw, mh } = buildMasks(field, MR);
  const masks = Object.fromEntries(Object.entries(m).map(([k, a]) => [k, maskCanvas(a, mw, mh)]));
  const tmp = mkCanvas(tw, th), tg = tmp.getContext('2d');
  const fillPattern = (g, img, span) => {
    const s = ppt * span / img.width;
    g.save(); g.setTransform(s, 0, 0, s, 0, 0); g.fillStyle = g.createPattern(img, 'repeat'); g.fillRect(0, 0, tw / s + 1, th / s + 1); g.restore();
  };
  const layer = (out, mask, fill) => {
    tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, tw, th); fill(tg);
    tg.globalCompositeOperation = 'destination-in'; tg.imageSmoothingEnabled = true; tg.drawImage(mask, 0, 0, tw, th);
    out.drawImage(tmp, 0, 0);
  };
  const make = (base, each) => {
    const c = mkCanvas(tw, th), g = c.getContext('2d');
    base(g);
    for (const [name, span, rough] of LAYERS) layer(g, masks[name], tg2 => each(tg2, name, span, rough));
    return { c, g };
  };
  const col = make(g => fillPattern(g, swatch('grass').col, GRASS_SPAN), (g, name, span) => fillPattern(g, swatch(name).col, span));
  layer(col.g, masks.shade, g => { g.fillStyle = '#1c1408'; g.fillRect(0, 0, tw, th); });
  // Broad light/dark variation so the field does not look tiled
  const vary = mkCanvas(mw, mh), vg = vary.getContext('2d'), vi = vg.createImageData(mw, mh);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    const k = (j * mw + i) * 4, n = fbm((U0 + i / MR) * 0.5, (V0 + j / MR) * 0.5, 0, 0, 4, field.seed + 20);
    vi.data[k] = vi.data[k + 1] = vi.data[k + 2] = 90 + n * 76; vi.data[k + 3] = 255;
  }
  vg.putImageData(vi, 0, 0);
  col.g.globalCompositeOperation = 'overlay'; col.g.globalAlpha = 0.45; col.g.drawImage(vary, 0, 0, tw, th);
  col.g.globalCompositeOperation = 'source-over'; col.g.globalAlpha = 1;
  const hgt = make(g => fillPattern(g, swatch('grass').hgt, GRASS_SPAN), (g, name, span) => fillPattern(g, swatch(name).hgt, span));
  const gray = r => { const v = Math.round(r * 255); return `rgb(${v},${v},${v})`; };
  const rough = make(g => { g.fillStyle = gray(GRASS_ROUGH); g.fillRect(0, 0, tw, th); }, (g, _n, _s, r) => { g.fillStyle = gray(r); g.fillRect(0, 0, tw, th); });
  // Emissive: glowing seams only inside the lava tile (half resolution is plenty for a glow)
  const ew = tw >> 1, eh = th >> 1, emi = mkCanvas(ew, eh), eg = emi.getContext('2d');
  eg.fillStyle = '#000'; eg.fillRect(0, 0, ew, eh);
  const lt = mkCanvas(ew, eh), ltg = lt.getContext('2d'), s = (ppt / 2) * 1.6 / 256;
  ltg.setTransform(s, 0, 0, s, 0, 0); ltg.fillStyle = ltg.createPattern(lavaGlowCanvas(), 'repeat'); ltg.fillRect(0, 0, ew / s + 1, eh / s + 1);
  ltg.setTransform(1, 0, 0, 1, 0, 0); ltg.globalCompositeOperation = 'destination-in'; ltg.drawImage(maskCanvas(lava, mw, mh), 0, 0, ew, eh);
  eg.drawImage(lt, 0, 0);
  return { col: col.c, hgt: hgt.c, rough: rough.c, emi };
}

/** Lake surface: a fine grid over the water tiles with depth-tinted RGBA vertex colours and a soft shoreline. */
function buildWater(field, q, group) {
  const water = [];
  field.kinds.forEach((k, i) => { if (k === K.water) water.push(i); });
  if (water.length === 0) return null;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const t of water) { const x = t % W, y = Math.floor(t / W); u0 = Math.min(u0, x); u1 = Math.max(u1, x + 1); v0 = Math.min(v0, y); v1 = Math.max(v1, y + 1); }
  u0 -= 0.2; v0 -= 0.2; u1 += 0.2; v1 += 0.2;
  const R = 14, nu = Math.ceil((u1 - u0) * R), nv = Math.ceil((v1 - v0) * R);
  const geo = gridGeo(even(u0, u1, nu), even(v0, v1, nv), () => WATER_Y, (u, v) => [u / 2.2, -v / 2.2]);
  const cnt = (nu + 1) * (nv + 1), colr = new Float32Array(cnt * 4);
  const shallow = [0.05, 0.11, 0.1], deep = [0.008, 0.03, 0.038], foam = [0.42, 0.46, 0.44];
  for (let j = 0, k = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) {
    const u = u0 + (u1 - u0) * i / nu, v = v0 + (v1 - v0) * j / nv, depth = WATER_Y - field.height(u, v);
    const t = smooth(0, 0.22, depth), f = 1 - smooth(0.0, 0.035, depth);
    for (let c = 0; c < 3; c++) colr[k * 4 + c] = (shallow[c] + (deep[c] - shallow[c]) * t) * (1 - f * 0.6) + foam[c] * f * 0.6;
    colr[k * 4 + 3] = smooth(-0.005, 0.05, depth) * (0.8 + 0.18 * t);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 4));
  const normalMap = toTex(rippleCanvas(), { srgb: false, aniso: q.aniso });
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, depthWrite: false, roughness: 0.1, metalness: 0,
    normalMap, normalScale: new THREE.Vector2(0.18, 0.18), envMapIntensity: q.reflect ? 0.55 : 0,
  });
  const flow = { value: new THREE.Vector4() };
  if (q.ripples) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uFlow = flow;
      sh.fragmentShader = 'uniform vec4 uFlow;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(
        'vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = normalize( texture2D( normalMap, vUv + uFlow.xy ).xyz * 2.0 - 1.0 + texture2D( normalMap, vUv * 1.7 + uFlow.zw ).xyz * 2.0 - 1.0 );'));
    };
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = q.shadows;
  mesh.renderOrder = 2;
  group.add(mesh);
  return t => { flow.value.set(t * 0.011, t * 0.007, -t * 0.008, t * 0.012); };
}

/**
 * buildTerrain(scene, map, quality) → { group, update(dt), dispose(), setHighlight(tiles, color, channel), heightAt(x, z),
 * surfaceAt(x, z), standAt(tile) }. Heights take board-centred world x/z. heightAt is the walking height (ground, or
 * the bridge deck inside its footprint); surfaceAt also counts the lake surface (for picking).
 */
export function buildTerrain(scene, map, quality) {
  const q = quality, field = makeField(map), group = new THREE.Group();
  group.name = 'terrain';
  const { col, hgt, rough, emi } = paintTerrain(field, q);
  const tex = (c, srgb) => toTex(c, { srgb, aniso: q.aniso });
  const inner = new THREE.MeshStandardMaterial({
    map: tex(col, true), bumpMap: tex(hgt, false), bumpScale: 0.2, roughnessMap: tex(rough, false), roughness: 1, envMapIntensity: 0.7,
    emissiveMap: tex(emi, true), emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.6,
  });
  // One set of sample positions: fine over the textured area, coarser outward, so every block shares its edges exactly
  const segs = q.segs, fu = even(U0, U1, (U1 - U0) * segs), fv = even(V0, V1, (V1 - V0) * segs);
  const lu = graded(U0, FAR.u0, 1 / segs).reverse(), ru = graded(U1, FAR.u1, 1 / segs);
  const tv = graded(V0, FAR.v0, 1 / segs).reverse(), bv = graded(V1, FAR.v1, 1 / segs);
  const allU = [...lu, ...fu, ...ru];
  const innerMesh = new THREE.Mesh(gridGeo(fu, fv, field.height, (u, v) => [(u - U0) / (U1 - U0), 1 - (v - V0) / (V1 - V0)]), inner);
  innerMesh.receiveShadow = true;
  group.add(innerMesh);
  // Surroundings: four strips of plain grass that share the inner edge's vertices and the grass pattern's alignment
  const grass = swatch('grass');
  const outer = new THREE.MeshStandardMaterial({
    map: toTex(grass.col, { aniso: q.aniso }), bumpMap: toTex(grass.hgt, { srgb: false, aniso: q.aniso }), bumpScale: 0.2, roughness: GRASS_ROUGH, envMapIntensity: 0.7,
  });
  const ouv = (u, v) => [(u - U0) / GRASS_SPAN, -(v - V0) / GRASS_SPAN];
  for (const [us, vs] of [[allU, [...tv, V0]], [allU, [V1, ...bv]], [[...lu, U0], fv], [[U1, ...ru], fv]]) {
    const mesh = new THREE.Mesh(gridGeo(us, vs, field.height, ouv), outer);
    mesh.receiveShadow = true; group.add(mesh);
  }
  const updateWater = buildWater(field, q, group);

  const toU = x => x + W / 2, toV = z => z + H / 2;
  const spans = bridgeSpans(map);
  const walkUV = (u, v) => Math.max(field.height(u, v), deckAt(spans, u, v));
  const heightAt = (x, z) => walkUV(toU(x), toV(z));
  const surfaceAt = (x, z) => Math.max(heightAt(x, z), WATER_Y);
  const standAt = t => {
    if (field.extra[t] === K.bridge) return deckTop(0);
    return field.kinds[t] === K.water ? STONE_Y : field.height((t % W) + 0.5, Math.floor(t / W) + 0.5);
  };

  const props = buildProps(map, { quality: q, field, WATER_Y, STONE_Y });
  group.add(props.group);

  // Tile highlights: rings draped over the surface of each highlighted tile, in independent channels (e.g. a hover
  // ring and boost markers) so several can show at once in different colours
  const hlTex = toTex(highlightCanvas(), { aniso: q.aniso });
  const hlGeo = new Map(), hlChannels = new Map(), hlGroup = new THREE.Group();
  hlGroup.renderOrder = 3; group.add(hlGroup);
  const tileGeo = t => {
    if (!hlGeo.has(t)) {
      const x = t % W, y = Math.floor(t / W), stone = field.kinds[t] === K.water && field.extra[t] < 0 ? STONE_Y : -Infinity;
      const sp = field.extra[t] === K.bridge ? spans.find(b => b.tile === t) : null;
      // On a bridge the ring follows the deck's arch across the whole tile, so it sits on top of the planks
      const top = (u, v) => sp ? deckTop(sp.alongX ? u - sp.cu : v - sp.cv) : stone;
      hlGeo.set(t, gridGeo(even(x + 0.03, x + 0.97, 8), even(y + 0.03, y + 0.97, 8), (u, v) => Math.max(walkUV(u, v), WATER_Y, top(u, v)) + 0.02, (u, v) => [u - x, 1 - (v - y)]));
    }
    return hlGeo.get(t);
  };
  /** Shows rings on `tiles` in `color` for one channel, replacing that channel's previous tiles; [] clears it. */
  function setHighlight(tiles, color = 0xffffff, channel = 'main') {
    let ch = hlChannels.get(channel);
    if (!ch) {
      const mat = new THREE.MeshBasicMaterial({
        map: hlTex, transparent: true, depthWrite: false, toneMapped: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      ch = { mat, meshes: [] }; hlChannels.set(channel, ch);
    }
    ch.mat.color.set(color);
    tiles.forEach((t, i) => {
      if (!ch.meshes[i]) { ch.meshes[i] = new THREE.Mesh(tileGeo(t), ch.mat); ch.meshes[i].renderOrder = 3; hlGroup.add(ch.meshes[i]); }
      ch.meshes[i].geometry = tileGeo(t); ch.meshes[i].visible = true;
    });
    for (let i = tiles.length; i < ch.meshes.length; i++) ch.meshes[i].visible = false;
  }

  scene.add(group);
  let time = 0;
  return {
    group, heightAt, surfaceAt, standAt, setHighlight,
    update(dt) {
      time += dt;
      inner.emissiveIntensity = 1.5 + 0.45 * Math.sin(time * 1.9) + 0.2 * Math.sin(time * 5.3);
      if (updateWater && q.ripples) updateWater(time);
      props.update(time);
    },
    dispose() {
      scene.remove(group);
      const seen = new Set();
      group.traverse(o => {
        if (o.isInstancedMesh) o.dispose(); // frees the instance matrix and colour buffers
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        for (const m of o.material ? [].concat(o.material) : []) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const v of Object.values(m)) if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
          m.dispose();
        }
      });
      for (const g of hlGeo.values()) g.dispose();
    },
  };
}
