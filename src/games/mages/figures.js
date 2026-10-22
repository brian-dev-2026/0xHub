// Mage Siege figures: mages and enemies built in code like painted collectible figurines. Smooth lathe, tube and
// sphere geometry with welded normals, physically based materials with procedural cloth, leather, steel, fur,
// skin, wood, bark and membrane textures. A kit owns the shared geometries, materials and textures; each kind is
// built once as a prototype and every figure is a clone of it (clones share geometry and material). units.js
// animates the figures and gives enemies their own material copies for hit flashes, frost and the death dissolve.
import * as THREE from 'three';
import { merge, paintVerts, revolve, weldNormals } from './props';
import {
  auraCanvas, barCanvas, barkSwatch, clothSwatch, furSwatch, glowCanvas, heraldryCanvas, leafSwatch, leatherSwatch,
  membraneSwatch, metalSwatch, skinSwatch, starCanvas, toTex, vnoise3, woodSwatch, dissolveCanvas,
} from './textures';

const TAU = Math.PI * 2;
/** Parts smaller than this (bounding radius, tiles) cast no shadow. */
const SMALL_PART = 0.025;
const WHITE = new THREE.Color(1, 1, 1);

/** Element looks: robe, mantle and hood cloth, crystal glow, beard, crystal cut, staff and crystal holder. */
export const ELEMENT = {
  fire: { robe: 0x8c2211, cape: 0xd8641e, hood: 0x761c0e, glow: 0xff5a1e, beard: 0x8a3a1c, gem: 'flame', staff: 'darkwood', holder: 'fork', hem: 'flame' },
  ice: { robe: 0x4f7fb4, cape: 0xdfeaf4, hood: 0x456f9c, glow: 0x9be6ff, beard: 0xeeeeee, gem: 'shard', staff: 'metal', holder: 'prongs', fur: true },
  lightning: { robe: 0x42307c, cape: 0xe4dcaa, hood: 0x36286a, glow: 0xfff3a8, halo: 0xb890ff, beard: 0x9c9c9c, gem: 'gem', staff: 'metal', holder: 'ring', hem: 'zig' },
  earth: { robe: 0x6a4620, cape: 0x4f6c2a, hood: 0x5a3b1b, glow: 0xffa83c, beard: 0x5a3a20, gem: 'orb', staff: 'bark', holder: 'prongs' },
  poison: { robe: 0x2a5520, cape: 0x1e2c1a, hood: 0x22441a, glow: 0x8cff3a, beard: 0x262422, gem: 'orb', staff: 'darkwood', holder: 'prongs', hem: 'tatter' },
  wind: { robe: 0x9fcfc6, cape: 0xf4f6f2, hood: 0x86bdb3, glow: 0x9ff7e8, beard: 0xd8c690, gem: 'shard', staff: 'wood', holder: 'ring' },
};
/** Robe trim bands added at levels 2, 3, 4 and 5 (the last one glows in the element colour). */
const BAND_COLORS = [0xb0703c, 0xd2d6de, 0xf0c050, null];
const BAND_Y = [[0.03, 0.058], [0.066, 0.094], [0.102, 0.13], [0.138, 0.166]];

/**
 * Enemy looks: build function and options, figure scale, top height (bar and stars, before scale), gait and steps
 * per tile walked, and the frozen ice block size [radius, height].
 */
export const ENEMY_LOOK = {
  goblin: { build: 'goblin', opts: { skin: 0x7d9a3e }, scale: 1, top: 0.42, gait: 'biped', stride: 2.6, ice: [0.15, 0.42] },
  wolf: { build: 'wolf', opts: { fur: 0x8f8376, eye: 0xffb347 }, scale: 1, top: 0.4, gait: 'quad', stride: 1.5, ice: [0.2, 0.36] },
  brute: { build: 'brute', opts: { skin: 0xa4876c }, scale: 1, top: 0.56, gait: 'biped', stride: 1.7, ice: [0.22, 0.56] },
  bat: { build: 'bat', opts: {}, scale: 1, top: 0.2, gait: 'fly', stride: 0, ice: [0.18, 0.2], hover: 0.42 },
  shaman: { build: 'shaman', opts: {}, scale: 1, top: 0.5, gait: 'robe', stride: 2.2, ice: [0.15, 0.5] },
  knight: { build: 'knight', opts: {}, scale: 1, top: 0.56, gait: 'biped', stride: 2.0, ice: [0.17, 0.56] },
  goblinChief: { build: 'goblin', opts: { skin: 0x6c8a34, chief: true }, scale: 1.4, top: 0.46, gait: 'biped', stride: 2.4, ice: [0.17, 0.46] },
  direWolf: { build: 'wolf', opts: { fur: 0x3e3a3c, eye: 0xff3a24, dire: true }, scale: 1.45, top: 0.42, gait: 'quad', stride: 1.4, ice: [0.21, 0.4] },
  troll: { build: 'brute', opts: { skin: 0x71805e, troll: true }, scale: 1.4, top: 0.58, gait: 'biped', stride: 1.5, ice: [0.23, 0.58] },
  witch: { build: 'shaman', opts: { witch: true }, scale: 1.35, top: 0.62, gait: 'robe', stride: 2.0, ice: [0.16, 0.6] },
  treant: { build: 'treant', opts: {}, scale: 1, top: 1.7, gait: 'stomp', stride: 0.9, ice: [0.62, 1.7] },
  sapling: { build: 'sapling', opts: {}, scale: 1, top: 0.32, gait: 'none', stride: 0, ice: [0.14, 0.32] },
};

// ================= Geometry helpers =================
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** Moves, turns (Euler XYZ) and scales a geometry in place; returns it. */
function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return g.applyMatrix4(_m.compose(_p.set(p[0], p[1], p[2]), _q, _s));
}
/** Ellipsoid with radii rx, ry, rz centred at p. */
const ell = (rx, ry, rz, p = [0, 0, 0], ws = 16, hs = 12) => xf(new THREE.SphereGeometry(1, ws, hs), p, [0, 0, 0], [rx, ry, rz]);
const cone = (r, h, p, rot = [0, 0, 0], seg = 10) => xf(new THREE.ConeGeometry(r, h, seg, 2), p, rot);

/**
 * A tapered tube through control points `pts` ([x, y, z]) with radius radii[k] spread evenly along it, closed with
 * rounded caps. `flat` squashes the cross-section (ears, plumes); returns a smooth, welded geometry.
 */
function limb(pts, radii, radial = 10, segs = 12, flat = 1) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
  const fr = curve.computeFrenetFrames(segs, false);
  const R = t => { const f = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f)); return radii[i] + (radii[i + 1] - radii[i]) * (f - i); };
  const rows = [];
  const capPhis = [0, 0.95];
  const P0 = curve.getPointAt(0), P1 = curve.getPointAt(1), r0 = R(0), r1 = R(1);
  for (const ph of capPhis) rows.push({ c: P0.clone().addScaledVector(fr.tangents[0], -Math.cos(ph) * r0 * 0.8), r: Math.sin(ph) * r0, k: 0 });
  for (let k = 0; k <= segs; k++) rows.push({ c: curve.getPointAt(k / segs), r: R(k / segs), k });
  for (let i = capPhis.length - 1; i >= 0; i--) rows.push({ c: P1.clone().addScaledVector(fr.tangents[segs], Math.cos(capPhis[i]) * r1 * 0.8), r: Math.sin(capPhis[i]) * r1, k: segs });
  const cols = radial + 1, pos = new Float32Array(rows.length * cols * 3), uv = new Float32Array(rows.length * cols * 2);
  rows.forEach((row, j) => {
    const N = fr.normals[row.k], B = fr.binormals[row.k];
    for (let i = 0; i < cols; i++) {
      const a = (i % radial) / radial * TAU, ca = Math.cos(a) * row.r, sa = Math.sin(a) * row.r * flat, o = (j * cols + i) * 3;
      pos[o] = row.c.x + N.x * ca + B.x * sa; pos[o + 1] = row.c.y + N.y * ca + B.y * sa; pos[o + 2] = row.c.z + N.z * ca + B.z * sa;
      uv[(j * cols + i) * 2] = i / radial; uv[(j * cols + i) * 2 + 1] = j / (rows.length - 1);
    }
  });
  const idx = [];
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < radial; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return weldNormals(g);
}
/** Pushes vertices along their normals by smooth 3D noise (gnarled wood, lumpy hide), then re-smooths normals. */
function gnarl(g, amp, freq, seed) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), d = (vnoise3(x * freq, y * freq, z * freq, seed) - 0.5) * 2 * amp;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  g.computeVertexNormals();
  return weldNormals(g);
}
/** A lumpy leaf cluster with shaded vertex colours (darker underneath and inside). */
function leafBlob(r, p, seed, ws = 18, hs = 12) {
  const g = new THREE.SphereGeometry(r, ws, hs), q = g.attributes.position;
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i), y = q.getY(i), z = q.getZ(i), k = 1 + (vnoise3(x / r * 1.6 + seed, y / r * 1.6, z / r * 1.6, seed) - 0.5) * 0.5 + (vnoise3(x / r * 4, y / r * 4, z / r * 4 + seed, seed + 1) - 0.5) * 0.16;
    q.setXYZ(i, x * k, y * k * 0.86, z * k);
  }
  g.computeVertexNormals(); weldNormals(g);
  paintVerts(g, (x, y, z) => { const t = 0.55 + 0.45 * Math.max(0, Math.min(1, y / r * 0.6 + 0.5)), h = vnoise3(x * 9, y * 9, z * 9, seed + 2); return [t * (0.85 + h * 0.3), t * (0.95 + h * 0.1), t * 0.85]; });
  return xf(g, p);
}
/** The robe silhouette: hem flare, waist and shoulders; radius at height y, and cloth folds that fade upward. */
const ROBE = [[0.15, 0], [0.163, 0.008], [0.16, 0.022], [0.15, 0.06], [0.136, 0.12], [0.12, 0.18], [0.106, 0.235], [0.099, 0.27], [0.103, 0.305], [0.111, 0.345], [0.116, 0.38], [0.11, 0.41], [0.088, 0.437], [0.058, 0.455], [0.04, 0.463], [0, 0.468]];
function profileR(prof, y) {
  for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0 || 1); }
  return prof[prof.length - 1][0];
}
const robeFold = (a, y) => 1 + (0.018 + 0.06 * Math.max(0, 1 - y / 0.3) ** 1.5) * Math.sin(a * 7 + 1.3 * Math.sin(a * 3));
/** Re-samples a profile to `n` rows between its ends (lathes need rows for folds and displacement). */
function resample(prof, n) {
  const y0 = prof[0][1], y1 = prof[prof.length - 1][1], out = [];
  for (let i = 0; i <= n; i++) { const y = y0 + (y1 - y0) * i / n; out.push([profileR(prof, y), y]); }
  return out;
}
/** A hood: a sphere shell opening to the front, peaked toward the back and flared over the shoulders. */
function hoodGeo(r, ws = 16, hs = 9, open = 0.95) {
  const g = new THREE.SphereGeometry(r, ws, hs, Math.PI / 2 + open, TAU - open * 2, 0, Math.PI * 0.8), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ny = y / r;
    if (ny > 0.15) { const t = (ny - 0.15) ** 2; z -= 0.55 * r * t; y += 0.3 * r * t; }
    if (ny < 0) { const f = 1 + 0.3 * -ny; x *= f; z *= f; }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return weldNormals(g);
}

// ================= Kit =================
/**
 * createKit(quality) → { mage(kind), enemy(kind), auraTex(level), chargeMaterial(color), star, barBg, barFill(f),
 * iceGeo, iceMat, dissolveTex, glowMat(color), dispose() }.
 * mage()/enemy() return { root, nodes } where nodes holds the named parts (body, head, arms, legs, staff, tip, …).
 */
export function createKit(q) {
  const texs = new Map(), mats = new Map(), protos = new Map(), extraGeo = [], extraMat = [];
  const tx = (key, canvas, rx = 1, ry = 1, srgb = true) => {
    const k = `${key}|${rx}|${ry}|${srgb}`;
    if (!texs.has(k)) texs.set(k, toTex(canvas, { rx, ry, srgb, aniso: q.aniso }));
    return texs.get(k);
  };
  const mat = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
  /** Colours are written as sRGB hex; materials work in linear light. */
  const lin = c => new THREE.Color(c).convertSRGBToLinear();
  const sheenOf = (c, k) => lin(c).lerp(WHITE, 0.45).multiplyScalar(k);

  // ---------- Materials (shared per kind of surface and colour) ----------
  // bumpScale is effectively a height in world units (one tile = 1), so on figures this small it stays in the millimetres.
  const M = {
    cloth: (c, rep = 2, side = THREE.FrontSide) => mat(`cloth${c}|${rep}|${side}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), map: tx('cloth', clothSwatch().col, rep, rep), bumpMap: tx('clothH', clothSwatch().hgt, rep, rep, false), bumpScale: 0.0025,
      roughness: 0.86, sheen: sheenOf(c, 0.12), side,
    })),
    lining: c => mat(`lining${c}`, () => new THREE.MeshStandardMaterial({ color: lin(c).multiplyScalar(0.3), map: tx('cloth', clothSwatch().col, 2, 2), roughness: 0.95, side: THREE.BackSide })),
    trim: c => mat(`trim${c}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), map: tx('cloth', clothSwatch().col, 6, 1), bumpMap: tx('clothH', clothSwatch().hgt, 6, 1, false), bumpScale: 0.004,
      metalness: 0.85, roughness: 0.34, clearcoat: 0.3,
    })),
    glowTrim: c => mat(`glowtrim${c}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), map: tx('cloth', clothSwatch().col, 6, 1), bumpMap: tx('clothH', clothSwatch().hgt, 6, 1, false), bumpScale: 0.004,
      emissive: lin(c), emissiveIntensity: 1.3, emissiveMap: tx('cloth', clothSwatch().col, 6, 1), roughness: 0.4, metalness: 0.3,
    })),
    leather: (c = 0xffffff, rep = 2) => mat(`leather${c}|${rep}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), map: tx('leather', leatherSwatch().col, rep, rep), bumpMap: tx('leatherH', leatherSwatch().hgt, rep, rep, false), bumpScale: 0.003,
      roughness: 0.62, clearcoat: 0.18, clearcoatRoughness: 0.5,
    })),
    metal: (c, rough = 0.34, rep = 1) => mat(`metal${c}|${rough}|${rep}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), metalness: 1, roughness: rough * 1.6, map: tx('metal', metalSwatch().col, rep, rep), roughnessMap: tx('metalR', metalSwatch().col, rep, rep, false),
      bumpMap: tx('metalH', metalSwatch().hgt, rep, rep, false), bumpScale: 0.0015, clearcoat: 0.25, clearcoatRoughness: 0.3, envMapIntensity: 1.3,
    })),
    fur: (c, rep = 2) => mat(`fur${c}|${rep}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), map: tx('fur', furSwatch().col, rep, rep), bumpMap: tx('furH', furSwatch().hgt, rep, rep, false), bumpScale: 0.006,
      roughness: 0.9, sheen: sheenOf(c, 0.18),
    })),
    skin: c => mat(`skin${c}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), map: tx('skin', skinSwatch().col, 2, 2), bumpMap: tx('skinH', skinSwatch().hgt, 2, 2, false), bumpScale: 0.0015,
      roughness: 0.74, envMapIntensity: 0.6, sheen: sheenOf(c, 0.08),
    })),
    wood: (c = 0xffffff, rep = 1) => mat(`wood${c}|${rep}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), map: tx('wood', woodSwatch().col, rep, rep * 2), bumpMap: tx('woodH', woodSwatch().hgt, rep, rep * 2, false), bumpScale: 0.003,
      roughness: 0.48, clearcoat: 0.45, clearcoatRoughness: 0.35,
    })),
    bark: (c = 0xffffff, rx = 2, ry = 2, vc = false) => mat(`bark${c}|${rx}|${ry}|${vc}`, () => new THREE.MeshStandardMaterial({
      color: lin(c), map: tx('bark', barkSwatch().col, rx, ry), bumpMap: tx('barkH', barkSwatch().hgt, rx, ry, false), bumpScale: 0.012,
      roughness: 0.92, vertexColors: vc,
    })),
    bone: (c = 0xe6dabd) => mat(`bone${c}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), map: tx('skin', skinSwatch().col, 1, 1), bumpMap: tx('skinH', skinSwatch().hgt, 1, 1, false), bumpScale: 0.002, roughness: 0.42, clearcoat: 0.35,
    })),
    gloss: c => mat(`gloss${c}`, () => new THREE.MeshPhysicalMaterial({ color: lin(c), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 })),
    eye: c => mat(`eye${c}`, () => new THREE.MeshStandardMaterial({ color: lin(c).multiplyScalar(0.4), emissive: lin(c), emissiveIntensity: 2.4, roughness: 0.2 })),
    gem: (c, flat) => mat(`gem${c}|${flat}`, () => new THREE.MeshPhysicalMaterial({
      color: lin(c), emissive: lin(c).multiplyScalar(0.55), emissiveIntensity: 1.2, roughness: 0.08, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04,
      flatShading: flat, transparent: true, opacity: 0.92, envMapIntensity: 1.6,
    })),
    leaf: () => mat('leaf', () => new THREE.MeshStandardMaterial({
      map: tx('leaf', leafSwatch().col, 2, 2), bumpMap: tx('leafH', leafSwatch().hgt, 2, 2, false), bumpScale: 0.008, roughness: 0.8, vertexColors: true,
    })),
    membrane: () => mat('membrane', () => new THREE.MeshPhysicalMaterial({
      map: tx('membrane', membraneSwatch().col, 4, 4), bumpMap: tx('membraneH', membraneSwatch().hgt, 4, 4, false), bumpScale: 0.003,
      color: lin(0xb89890), roughness: 0.55, sheen: new THREE.Color(0.12, 0.05, 0.04), side: THREE.DoubleSide,
    })),
    dark: c => mat(`dark${c}`, () => new THREE.MeshStandardMaterial({ color: lin(c), roughness: 0.9 })),
    heraldry: () => mat('heraldry', () => {
      const t = toTex(heraldryCanvas(), { aniso: q.aniso });
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(1 / 0.13, 1 / 0.185); t.offset.set(0.5, 0.105 / 0.185);
      texs.set('heraldry', t);
      return new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.42, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    }),
  };

  const mesh = (g, m, name) => {
    const o = new THREE.Mesh(g, m);
    // Only High casts figure shadows, and never from tiny parts (eyes, teeth, rivets, buckles, gems): each caster is a draw call
    if (!g.boundingSphere) g.computeBoundingSphere();
    o.castShadow = q.figureShadows && g.boundingSphere.radius >= SMALL_PART; o.receiveShadow = q.shadows;
    if (name) o.name = name;
    return o;
  };
  /** One mesh from several geometries that share a material. */
  const many = (m, ...geos) => mesh(geos.length === 1 ? geos[0] : merge(geos), m);
  const node = (name, p = [0, 0, 0], kids = []) => { const g = new THREE.Group(); g.name = name; g.position.set(p[0], p[1], p[2]); for (const k of kids) g.add(k); return g; };

  // ================= Mages =================
  function buildMage(kind) {
    const E = ELEMENT[kind], fig = node('fig'), body = node('body');
    fig.add(body);
    const robeMat = M.cloth(E.robe), capeMat = M.cloth(E.cape), skin = M.skin(0xe8b494);
    const sqz = g => xf(g, [0, 0, 0], [0, 0, 0], [1, 1, 0.84]);

    // Robe with folds, belt and buckle
    body.add(mesh(sqz(revolve(resample(ROBE, 14), 28, (a, j, r, y) => [r * robeFold(a, y), y])), robeMat));
    const band = (y0, y1, out) => sqz(revolve([0, 0.25, 0.5, 0.75, 1].map(t => {
      const y = y0 + (y1 - y0) * t;
      return [profileR(ROBE, y) + out * (1 + 0.6 * Math.sin(t * Math.PI)), y];
    }), 28, (a, j, r, y) => [r * robeFold(a, y), y]));
    BAND_Y.forEach(([y0, y1], i) => {
      const m = mesh(band(y0, y1, 0.004), BAND_COLORS[i] === null ? M.glowTrim(E.glow) : M.trim(BAND_COLORS[i]), 'band' + i);
      m.visible = false; body.add(m);
    });
    body.add(mesh(band(0.252, 0.284, 0.006), M.leather(0x8a6a50)));
    body.add(mesh(ell(0.016, 0.014, 0.006, [0, 0.268, profileR(ROBE, 0.268) * 0.84 + 0.009], 10, 6), M.metal(0xd8b060, 0.3)));

    // Mantle over the shoulders: a flame-cut, zig-zag, tattered or plain hem
    const hemCut = { flame: a => 0.024 * Math.abs(Math.sin(a * 6)) ** 0.7, zig: a => 0.016 * Math.abs(((a * 8 / TAU) % 1) * 2 - 1), tatter: a => 0.014 * Math.abs(Math.sin(a * 11) * Math.sin(a * 4)) }[E.hem] || (a => 0.006 * (1 + Math.sin(a * 10)));
    // The hem rises toward the front, so the mantle opens over the chest and drapes over the upper arms
    const mantle = resample([[0.149, 0.31], [0.148, 0.33], [0.145, 0.36], [0.138, 0.39], [0.126, 0.42], [0.104, 0.445], [0.075, 0.46], [0.045, 0.468]], 8);
    const drape = (a, y) => y + 0.065 * Math.max(0, Math.sin(a)) ** 3 * Math.max(0, (0.42 - y) / 0.11);
    body.add(mesh(sqz(revolve(mantle, 28, (a, j, r, y) => [r * (1 + 0.025 * Math.sin(a * 9) * (1 - (y - 0.31) / 0.16)), drape(a, y) - (j === 0 ? hemCut(a) : 0)])), capeMat));
    if (E.fur) body.add(mesh(sqz(revolve([[0.152, 0.302], [0.162, 0.315], [0.158, 0.332]], 30, (a, j, r, y) => [r, drape(a, y)])), M.fur(0xf2f0ea, 3)));

    // Head: face, nose, eyes, brows, beard and moustache, inside the hood
    const head = node('head', [0, 0.468, 0]);
    body.add(head);
    head.add(mesh(ell(0.044, 0.048, 0.044, [0, 0.05, 0.01], 13, 10), skin));
    head.add(mesh(merge([ell(0.008, 0.011, 0.011, [0, 0.046, 0.054], 6, 5), ell(0.006, 0.006, 0.005, [-0.04, 0.05, 0.012], 6, 4), ell(0.006, 0.006, 0.005, [0.04, 0.05, 0.012], 6, 4)]), skin));
    head.add(many(M.gloss(0x14100c), ell(0.0065, 0.0065, 0.005, [-0.016, 0.058, 0.047], 6, 5), ell(0.0065, 0.0065, 0.005, [0.016, 0.058, 0.047], 6, 5)));
    const hair = M.fur(E.beard, 1);
    const beard = sqz(xf(revolve([[0, -0.07], [0.012, -0.058], [0.03, -0.032], [0.04, -0.008], [0.043, 0.012], [0.036, 0.03]], 16, (a, j, r, y) => [r * (1 + 0.1 * Math.sin(a * 9)), y]), [0, 0, 0], [0, 0, 0], [1, 1, 0.65]));
    head.add(many(hair,
      xf(beard, [0, 0.022, 0.032]),
      limb([[0.003, 0.038, 0.056], [0.018, 0.033, 0.052], [0.028, 0.02, 0.046]], [0.005, 0.005, 0.002], 5, 4),
      limb([[-0.003, 0.038, 0.056], [-0.018, 0.033, 0.052], [-0.028, 0.02, 0.046]], [0.005, 0.005, 0.002], 5, 4),
      limb([[-0.026, 0.07, 0.042], [-0.016, 0.073, 0.048], [-0.006, 0.069, 0.05]], [0.003, 0.005, 0.003], 5, 3),
      limb([[0.026, 0.07, 0.042], [0.016, 0.073, 0.048], [0.006, 0.069, 0.05]], [0.003, 0.005, 0.003], 5, 3)));
    const hood = hoodGeo(0.068), lining = hoodGeo(0.066);
    head.add(mesh(xf(hood, [0, 0.058, -0.004]), M.cloth(E.hood, 2)));
    head.add(mesh(xf(lining, [0, 0.058, -0.004]), M.lining(E.hood)));

    // Arms: bell sleeves and hands; the right (staff) arm holds the staff upright, the left is the casting hand
    const armR = node('armR', [0.095, 0.415, 0]), armL = node('armL', [-0.095, 0.415, 0]);
    body.add(armR, armL);
    armR.add(mesh(limb([[0, 0, 0], [0.032, -0.06, 0.028], [0.044, -0.118, 0.066]], [0.033, 0.036, 0.047], 10, 6), robeMat));
    armR.add(mesh(limb([[0.043, -0.113, 0.062], [0.045, -0.12, 0.067]], [0.049, 0.049], 10, 2), capeMat));
    armR.add(mesh(ell(0.02, 0.022, 0.024, [0.046, -0.132, 0.074], 10, 6), skin));
    armL.add(mesh(limb([[0, 0, 0], [-0.025, -0.06, 0.036], [-0.026, -0.11, 0.084]], [0.033, 0.036, 0.047], 10, 6), robeMat));
    armL.add(mesh(limb([[-0.026, -0.104, 0.078], [-0.026, -0.11, 0.085]], [0.049, 0.049], 10, 2), capeMat));
    armL.add(mesh(ell(0.018, 0.022, 0.024, [-0.027, -0.124, 0.096], 10, 6), skin));

    // Staff: shaft, crystal holder, the crystal and its halo; `tip` is where a light or projectile attaches
    const staff = node('staff', [0.046, -0.13, 0.074]);
    armR.add(staff);
    const shaftProf = [[0.008, -0.285], [0.011, -0.27], [0.0105, -0.12], [0.012, 0], [0.011, 0.14], [0.012, 0.3], [0.015, 0.355], [0.012, 0.375]];
    if (E.staff === 'metal') {
      staff.add(many(M.metal(kind === 'ice' ? 0xd6e2ee : 0xc8c0a8, 0.28), revolve(shaftProf, 10)));
      staff.add(many(M.metal(0xe0b860, 0.25), ...[-0.2, 0.05, 0.3].map(y => xf(new THREE.TorusGeometry(0.0125, 0.0035, 5, 10), [0, y, 0], [Math.PI / 2, 0, 0]))));
    } else if (E.staff === 'bark') {
      staff.add(mesh(gnarl(revolve(resample(shaftProf.map(([r, y]) => [r * 1.3, y]), 10), 8), 0.004, 40, 7), M.bark(0xd8c8b0, 1, 3)));
    } else {
      const twist = E.staff === 'darkwood';
      staff.add(mesh(gnarl(revolve(resample(shaftProf, 10), 8, twist ? (a, j, r, y) => [r * (1 + 0.18 * Math.sin(a * 2 + y * 60)), y] : undefined), 0.002, 30, 3), M.wood(twist ? 0x6a4a3a : 0xffffff)));
    }
    const holderMat = E.staff === 'metal' ? M.metal(0xe0b860, 0.25) : E.staff === 'bark' ? M.bark(0xd8c8b0, 1, 1) : M.wood(E.staff === 'darkwood' ? 0x6a4a3a : 0xffffff);
    const CY = 0.418; // crystal centre on the staff
    if (E.holder === 'ring') {
      staff.add(many(M.metal(0xe0b860, 0.25), xf(new THREE.TorusGeometry(0.036, 0.0045, 6, 18), [0, CY, 0]), limb([[0, 0.37, 0], [0, 0.382, 0]], [0.012, 0.008], 6, 2)));
    } else if (E.holder === 'fork') {
      staff.add(many(holderMat, ...[-1, 1].map(s => limb([[0, 0.365, 0], [s * 0.022, 0.39, 0], [s * 0.03, 0.425, 0.004], [s * 0.016, 0.458, 0.006]], [0.009, 0.007, 0.005, 0.0015], 6, 7))));
    } else {
      staff.add(many(holderMat, ...[0, 1, 2].map(i => {
        const a = i / 3 * TAU + 0.5, c = Math.cos(a), s = Math.sin(a);
        return limb([[0, 0.37, 0], [c * 0.022, 0.392, s * 0.022], [c * 0.026, 0.42, s * 0.026], [c * 0.012, 0.448, s * 0.012]], [0.0065, 0.0055, 0.0045, 0.0015], 5, 7);
      })));
    }
    const gemGeo = {
      flame: () => revolve([[0, -0.026], [0.016, -0.018], [0.022, -0.002], [0.018, 0.016], [0.009, 0.034], [0, 0.05]], 12, (a, j, r, y) => [r * (1 + 0.12 * Math.sin(a * 3 + y * 60)), y]),
      shard: () => xf(new THREE.LatheGeometry([new THREE.Vector2(0, -0.03), new THREE.Vector2(0.017, -0.01), new THREE.Vector2(0.015, 0.026), new THREE.Vector2(0, 0.056)], 6), [0, 0, 0], [0, 0.3, 0]),
      gem: () => xf(new THREE.OctahedronGeometry(0.026), [0, 0, 0], [0, 0, 0], [1, 1.45, 1]),
      orb: () => new THREE.SphereGeometry(0.025, 14, 10),
    }[E.gem]();
    const crystal = mesh(xf(gemGeo, [0, CY, 0]), M.gem(E.glow, E.gem === 'shard' || E.gem === 'gem'), 'crystal');
    crystal.castShadow = false;
    staff.add(crystal);
    const halo = new THREE.Sprite(glowMat(E.halo ?? E.glow));
    halo.name = 'halo'; halo.position.set(0, CY, 0); halo.scale.setScalar(0.16);
    staff.add(halo);
    staff.add(node('tip', [0, CY, 0]));
    return fig;
  }

  // ================= Enemies =================
  function goblin(o) {
    const fig = node('fig'), body = node('body'), skin = M.skin(o.skin), leather = M.leather(0xb89070), eye = M.eye(0xffd23a);
    fig.add(body);
    body.add(mesh(xf(revolve([[0, 0.098], [0.045, 0.1], [0.068, 0.125], [0.079, 0.16], [0.075, 0.2], [0.063, 0.235], [0.046, 0.258], [0.026, 0.27], [0, 0.274]], 18), [0, 0, 0], [0, 0, 0], [1, 1, 0.86]), skin));
    // Ragged leather tunic with a belt
    const tunic = [[0.082, 0.082], [0.083, 0.115], [0.085, 0.145], [0.083, 0.175], [0.077, 0.205]];
    body.add(mesh(xf(revolve(tunic, 18, (a, j, r, y) => j === 0 ? [r * 1.06, y + 0.014 * Math.abs(Math.sin(a * 4.5))] : [r, y]), [0, 0, 0], [0, 0, 0], [1, 1, 0.88]), leather));
    body.add(mesh(xf(revolve([[0.086, 0.118], [0.088, 0.126], [0.086, 0.134]], 18), [0, 0, 0], [0, 0, 0], [1, 1, 0.88]), M.leather(0x5a4030)));
    const head = node('head', [0, 0.262, 0.022]);
    body.add(head);
    const ears = [-1, 1].map(s => limb([[s * 0.046, 0.05, 0], [s * 0.085, 0.072, -0.012], [s * 0.118, 0.084, -0.032]], [0.02, 0.012, 0.002], 6, 6, 0.4));
    head.add(many(skin,
      ell(0.058, 0.052, 0.056, [0, 0.048, 0], 14, 11), ell(0.048, 0.028, 0.044, [0, 0.022, 0.014], 11, 6),
      ell(0.046, 0.012, 0.02, [0, 0.066, 0.04], 10, 5),
      limb([[0, 0.05, 0.05], [0, 0.04, 0.074], [0, 0.026, 0.088]], [0.012, 0.01, 0.005], 6, 4), ...ears));
    head.add(many(eye, ell(0.011, 0.01, 0.007, [-0.022, 0.053, 0.05], 8, 6), ell(0.011, 0.01, 0.007, [0.022, 0.053, 0.05], 8, 6)));
    head.add(many(M.bone(), cone(0.005, 0.014, [-0.014, 0.018, 0.054]), cone(0.005, 0.014, [0.014, 0.018, 0.054])));
    for (const s of [-1, 1]) {
      const leg = node(s < 0 ? 'legL' : 'legR', [s * 0.036, 0.11, 0]);
      leg.add(mesh(limb([[0, 0, 0], [0, -0.05, 0.012], [0, -0.098, 0]], [0.022, 0.018, 0.015], 8, 6), skin));
      leg.add(mesh(ell(0.02, 0.012, 0.032, [0, -0.103, 0.012], 8, 6), M.leather(0x6a5040)));
      fig.add(leg);
      const arm = node(s < 0 ? 'armL' : 'armR', [s * 0.072, 0.222, 0]);
      arm.add(mesh(merge([limb([[0, 0, 0], [s * 0.012, -0.05, 0.01], [s * 0.02, -0.094, 0.032]], [0.018, 0.015, 0.013], 8, 6), ell(0.017, 0.017, 0.017, [s * 0.022, -0.103, 0.036], 8, 6)]), skin));
      body.add(arm);
      if (s > 0 && !o.chief) arm.add(mesh(limb([[s * 0.022, -0.1, 0.02], [s * 0.024, -0.08, 0.08], [s * 0.026, -0.06, 0.14]], [0.008, 0.012, 0.019], 6, 6), M.wood(0x9a7050)));
      if (s > 0 && o.chief) {
        // Battle axe: shaft and a crescent steel head
        arm.add(mesh(limb([[s * 0.022, -0.16, 0.0], [s * 0.022, -0.1, 0.036], [s * 0.022, 0.02, 0.1]], [0.007, 0.007, 0.007], 6, 6), M.wood(0x8a6040)));
        const sh = new THREE.Shape();
        sh.moveTo(0, -0.012); sh.quadraticCurveTo(0.05, -0.05, 0.06, -0.02); sh.quadraticCurveTo(0.04, 0.005, 0.06, 0.035); sh.quadraticCurveTo(0.05, 0.05, 0, 0.012); sh.closePath();
        const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 6 });
        arm.add(mesh(xf(blade, [s * 0.02, 0.008, 0.09], [0, Math.PI / 2, -0.5]), M.metal(0xb8bcc2, 0.3)));
      }
    }
    if (o.chief) {
      // Crown, fur mantle and a red cape
      const gold = M.metal(0xf0c050, 0.22);
      head.add(many(gold, revolve([[0.044, 0.086], [0.047, 0.09], [0.047, 0.104], [0.044, 0.108]], 14),
        ...[0, 1, 2, 3, 4].map(i => { const a = i / 5 * TAU + Math.PI / 2; return cone(0.008, 0.024, [Math.cos(a) * 0.045, 0.118, Math.sin(a) * 0.045], [0, 0, 0], 6); })));
      head.add(many(M.gloss(0xd0203a), ...[0, 2, 4].map(i => { const a = i / 5 * TAU + Math.PI / 2; return ell(0.005, 0.005, 0.004, [Math.cos(a) * 0.048, 0.097, Math.sin(a) * 0.048], 6, 5); })));
      body.add(mesh(xf(new THREE.TorusGeometry(0.062, 0.022, 8, 16), [0, 0.24, 0], [Math.PI / 2, 0, 0], [1, 0.86, 1]), M.fur(0x6a5038)));
      const cape = new THREE.PlaneGeometry(0.15, 0.2, 6, 6), cp = cape.attributes.position;
      for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); cp.setZ(i, -0.06 * (x / 0.075) ** 2 * 0.5 - 0.02 * (0.1 - y) * 4 + 0.008 * Math.sin(x * 90)); }
      cape.computeVertexNormals();
      body.add(mesh(xf(cape, [0, 0.15, -0.07], [0.15, 0, 0]), M.cloth(0x9a1c1c, 2, THREE.DoubleSide)));
    }
    return fig;
  }

  function wolf(o) {
    const fig = node('fig'), body = node('body', [0, 0.2, 0]), fur = M.fur(o.fur, 3), furD = M.fur(new THREE.Color(o.fur).multiplyScalar(0.7).getHex(), 2);
    fig.add(body);
    const torso = revolve(resample([[0, -0.205], [0.045, -0.195], [0.066, -0.16], [0.07, -0.08], [0.077, 0], [0.087, 0.08], [0.09, 0.12], [0.08, 0.17], [0.054, 0.2], [0, 0.212]], 11), 16);
    body.add(mesh(xf(torso, [0, 0.01, 0], [Math.PI / 2, 0, 0], [0.8, 1, 1]), fur));
    body.add(mesh(merge([ell(0.07, 0.078, 0.07, [0, 0.03, 0.12], 11, 8), limb([[0, 0.035, 0.14], [0, 0.075, 0.2]], [0.052, 0.044], 8, 3)]), furD));
    if (o.dire) body.add(many(furD, ...[0, 1, 2, 3, 4, 5].map(i => cone(0.014, 0.06, [0, 0.07 - i * 0.004, 0.11 - i * 0.04], [-0.6 - i * 0.12, 0, 0], 6))));
    const head = node('head', [0, 0.09, 0.215]);
    body.add(head);
    head.add(many(fur, ell(0.047, 0.044, 0.054, [0, 0, 0], 13, 10), limb([[0, -0.008, 0.03], [0, -0.016, 0.08], [0, -0.022, 0.108]], [0.031, 0.021, 0.014], 8, 6, 0.85),
      limb([[0, -0.03, 0.02], [0, -0.038, 0.088]], [0.019, 0.011], 6, 4),
      cone(0.018, 0.046, [-0.03, 0.045, -0.012], [-0.2, 0, 0.3], 8), cone(0.018, 0.046, [0.03, 0.045, -0.012], [-0.2, 0, -0.3], 8)));
    head.add(many(M.gloss(0x0c0a0a), ell(0.011, 0.009, 0.009, [0, -0.014, 0.116], 8, 6)));
    head.add(many(M.eye(o.eye), ell(0.0085, 0.007, 0.006, [-0.024, 0.012, 0.042], 6, 5), ell(0.0085, 0.007, 0.006, [0.024, 0.012, 0.042], 6, 5)));
    head.add(many(M.bone(), cone(0.004, 0.014, [-0.012, -0.034, 0.09], [Math.PI, 0, 0], 6), cone(0.004, 0.014, [0.012, -0.034, 0.09], [Math.PI, 0, 0], 6)));
    for (const [nm, x, z, back] of [['legFL', -0.042, 0.13, 0], ['legFR', 0.042, 0.13, 0], ['legBL', -0.046, -0.14, 1], ['legBR', 0.046, -0.14, 1]]) {
      const leg = node(nm, [x, 0.2, z]);
      const pts = back ? [[0, 0, 0], [0, -0.065, -0.03], [0, -0.13, 0.016], [0, -0.193, 0.002]] : [[0, 0, 0], [0, -0.07, 0.012], [0, -0.14, -0.008], [0, -0.193, 0.006]];
      leg.add(mesh(merge([limb(pts, back ? [0.042, 0.026, 0.014, 0.013] : [0.03, 0.02, 0.014, 0.013], 8, 7), ell(0.016, 0.01, 0.022, [0, -0.197, 0.014], 8, 5)]), furD));
      fig.add(leg);
    }
    const tail = node('tail', [0, 0.235, -0.2]);
    tail.add(mesh(limb([[0, 0, 0], [0, -0.03, -0.06], [0, -0.08, -0.11], [0, -0.12, -0.13]], [0.02, 0.03, 0.024, 0.006], 8, 7), fur));
    fig.add(tail);
    return fig;
  }

  function brute(o) {
    const fig = node('fig'), body = node('body'), skin = M.skin(o.skin), leather = M.leather(0x9a7a5a);
    fig.add(body);
    for (const s of [-1, 1]) {
      const leg = node(s < 0 ? 'legL' : 'legR', [s * 0.066, 0.17, 0]);
      leg.add(mesh(merge([limb([[0, 0, 0], [0, -0.08, 0.02], [0, -0.158, 0]], [0.05, 0.042, 0.036], 8, 5), ell(0.04, 0.022, 0.05, [0, -0.165, 0.02], 8, 5)]), skin));
      fig.add(leg);
    }
    const hunch = new THREE.Group(); hunch.rotation.x = 0.22; body.add(hunch);
    hunch.add(mesh(xf(revolve(resample([[0, 0.14], [0.08, 0.145], [0.115, 0.19], [0.13, 0.26], [0.138, 0.33], [0.13, 0.38], [0.105, 0.42], [0.06, 0.44], [0, 0.445]], 10), 18), [0, 0, 0], [0, 0, 0], [1, 1, 0.85]), skin));
    hunch.add(mesh(ell(0.098, 0.088, 0.075, [0, 0.235, 0.055], 11, 8), skin));
    // Loincloth, belt and a riveted steel pauldron
    const loin = [[0.121, 0.108], [0.124, 0.14], [0.126, 0.17], [0.122, 0.2]];
    hunch.add(mesh(xf(revolve(loin, 22, (a, j, r, y) => j === 0 ? [r * 1.04, y + 0.016 * Math.abs(Math.sin(a * 3.5))] : [r, y]), [0, 0, 0], [0, 0, 0], [1, 1, 0.88]), leather));
    hunch.add(mesh(xf(revolve([[0.128, 0.19], [0.13, 0.2], [0.128, 0.21]], 22), [0, 0, 0], [0, 0, 0], [1, 1, 0.88]), M.leather(0x4a3424)));
    const pad = g => xf(g, [-0.125, 0.39, 0], [0, 0, 0.7]);
    hunch.add(many(M.metal(o.troll ? 0x6a5a48 : 0x5e5a56, 0.55), pad(revolve([[0.062, 0], [0.06, 0.02], [0.046, 0.04], [0.024, 0.052], [0, 0.055]], 16))));
    hunch.add(many(M.metal(0xb08850, 0.4), ...[0, 1, 2, 3, 4, 5].map(i => pad(ell(0.006, 0.005, 0.006, [Math.cos(i / 6 * TAU) * 0.054, 0.016, Math.sin(i / 6 * TAU) * 0.054], 6, 4)))));
    const head = node('head', [0, 0.43, 0.105]);
    hunch.add(head);
    head.add(many(skin, ell(0.05, 0.046, 0.048, [0, 0.006, -0.004], 11, 8), ell(0.05, 0.032, 0.046, [0, -0.026, 0.016], 10, 6), ell(0.043, 0.012, 0.016, [0, 0.017, 0.035], 8, 4),
      ell(0.014, 0.012, 0.013, [0, -0.002, 0.048], 6, 5), ell(0.01, 0.017, 0.008, [-0.05, 0.004, -0.004], 6, 5), ell(0.01, 0.017, 0.008, [0.05, 0.004, -0.004], 6, 5)));
    head.add(many(M.eye(o.troll ? 0xffe060 : 0xff7a2a), ell(0.0065, 0.0055, 0.005, [-0.018, 0.007, 0.042], 6, 5), ell(0.0065, 0.0055, 0.005, [0.018, 0.007, 0.042], 6, 5)));
    const tusk = o.troll ? 0.03 : 0.02;
    head.add(many(M.bone(), cone(0.0065, tusk, [-0.022, -0.016 + tusk / 2, 0.056], [0.15, 0, 0.18], 8), cone(0.0065, tusk, [0.022, -0.016 + tusk / 2, 0.056], [0.15, 0, -0.18], 8)));
    if (o.troll) head.add(many(M.fur(0x3a4a2a, 1), limb([[0, 0.04, -0.01], [0, 0.07, -0.03], [0, 0.06, -0.07]], [0.025, 0.02, 0.004], 6, 4, 0.6)));
    for (const s of [-1, 1]) {
      const arm = node(s < 0 ? 'armL' : 'armR', [s * 0.13, 0.36, 0.06]);
      arm.add(mesh(merge([limb([[0, 0, 0], [s * 0.03, -0.1, 0], [s * 0.04, -0.2, 0.04]], [0.055, 0.045, 0.04], 8, 6), ell(0.045, 0.042, 0.045, [s * 0.042, -0.225, 0.05], 8, 6)]), skin));
      hunch.add(arm);
      if (s > 0) {
        const clubMat = o.troll ? M.bark(0xd0c0a8, 1, 2) : M.wood(0x9a7050);
        const club = limb([[s * 0.042, -0.22, 0.05], [s * 0.042, -0.25, 0.13], [s * 0.042, -0.27, 0.23]], o.troll ? [0.022, 0.038, 0.05] : [0.016, 0.03, 0.044], 8, 6);
        arm.add(mesh(o.troll ? gnarl(club, 0.008, 25, 5) : club, clubMat));
        if (!o.troll) arm.add(many(M.metal(0x9a9ea4, 0.4), ...[0, 1, 2, 3, 4].map(i => { const a = i * 1.3; return cone(0.008, 0.024, [s * 0.042 + Math.cos(a) * 0.04, -0.265 + Math.sin(a) * 0.04, 0.2], [Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4], 6); })));
      }
    }
    return fig;
  }

  function bat() {
    const fig = node('fig'), body = node('body'), fur = M.fur(0x5a4840, 2);
    fig.add(body);
    body.add(many(fur, ell(0.04, 0.045, 0.05, [0, 0, 0], 11, 8), ell(0.032, 0.029, 0.031, [0, 0.03, 0.045], 11, 8), ell(0.014, 0.012, 0.014, [0, 0.022, 0.074], 6, 5),
      ...[-1, 1].map(s => limb([[s * 0.016, 0.05, 0.04], [s * 0.028, 0.08, 0.036], [s * 0.036, 0.105, 0.028]], [0.015, 0.01, 0.001], 6, 4, 0.45))));
    body.add(many(M.eye(0xff3020), ell(0.0065, 0.006, 0.005, [-0.013, 0.038, 0.071], 6, 5), ell(0.0065, 0.006, 0.005, [0.013, 0.038, 0.071], 6, 5)));
    body.add(many(M.bone(0xf4eee0), cone(0.003, 0.01, [-0.006, 0.01, 0.078], [Math.PI, 0, 0], 6), cone(0.003, 0.01, [0.006, 0.01, 0.078], [Math.PI, 0, 0], 6)));
    body.add(many(M.leather(0x3a2a24), ...[-1, 1].map(s => limb([[s * 0.015, -0.035, -0.02], [s * 0.018, -0.06, -0.035]], [0.006, 0.003], 5, 3))));
    const tips = [[0.24, 0], [0.19, -0.075], [0.12, -0.09]];
    for (const s of [-1, 1]) {
      const wing = node(s < 0 ? 'wingL' : 'wingR', [s * 0.034, 0.012, 0.004]);
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.03); sh.quadraticCurveTo(0.09, 0.075, 0.16, 0.05); sh.lineTo(0.24, 0);
      sh.quadraticCurveTo(0.19, -0.012, 0.19, -0.075); sh.quadraticCurveTo(0.15, -0.045, 0.12, -0.09); sh.quadraticCurveTo(0.07, -0.04, 0, -0.05); sh.closePath();
      const mem = new THREE.ShapeGeometry(sh, 10), mp = mem.attributes.position;
      for (let i = 0; i < mp.count; i++) { const x = mp.getX(i), y = mp.getY(i); mp.setXYZ(i, s * x, -0.03 * (x / 0.24) ** 2 - 0.006 * Math.sin(y * 40), y); }
      mem.computeVertexNormals();
      wing.add(mesh(mem, M.membrane()));
      const bone = M.leather(0x2e221e);
      wing.add(many(bone, limb([[0, 0, 0.0], [s * 0.08, 0.004, 0.058], [s * 0.16, 0, 0.05]], [0.007, 0.005, 0.004], 5, 6),
        ...tips.map(([x, z]) => limb([[s * 0.16, 0, 0.05], [s * (0.16 + (x - 0.16) * 0.5), -0.01 * (x / 0.24) ** 2, (0.05 + z) / 2], [s * x, -0.03 * (x / 0.24) ** 2, z]], [0.004, 0.003, 0.0015], 5, 4))));
      body.add(wing);
    }
    return fig;
  }

  function shaman(o) {
    const fig = node('fig'), body = node('body');
    fig.add(body);
    const robe = M.cloth(o.witch ? 0x452a5e : 0x6e4c2c), skin = M.skin(o.witch ? 0x9fb888 : 0x7d9a3e);
    const prof = [[0.1, 0], [0.108, 0.008], [0.1, 0.05], [0.088, 0.12], [0.077, 0.19], [0.071, 0.23], [0.074, 0.26], [0.076, 0.285], [0.06, 0.31], [0.035, 0.322], [0, 0.326]];
    body.add(mesh(xf(revolve(resample(prof, 9), 18, (a, j, r, y) => [r * robeFold(a, y * 1.4), j === 0 ? y + 0.014 * Math.abs(Math.sin(a * 5)) : y]), [0, 0, 0], [0, 0, 0], [1, 1, 0.86]), robe));
    body.add(mesh(xf(new THREE.TorusGeometry(0.073, 0.007, 4, 18), [0, 0.215, 0], [Math.PI / 2, 0, 0], [1, 0.86, 1]), M.leather(0x8a6a40)));
    body.add(mesh(ell(0.022, 0.026, 0.016, [0.07, 0.19, 0.02], 8, 6), M.leather(0x7a5a3a)));
    if (!o.witch) body.add(many(M.bone(), ...Array.from({ length: 7 }, (_, i) => { const a = Math.PI / 2 + (i - 3) * 0.4; return ell(0.009, 0.011, 0.009, [Math.cos(a) * 0.062, 0.296 + Math.abs(i - 3) * 0.003, Math.sin(a) * 0.054], 6, 4); }),
      cone(0.008, 0.026, [0, 0.27, 0.062], [Math.PI, 0, 0], 8)));
    const head = node('head', [0, 0.326, 0.01]);
    body.add(head);
    if (o.witch) {
      head.add(many(skin, ell(0.04, 0.044, 0.04, [0, 0.04, 0], 13, 10), limb([[0, 0.042, 0.035], [0, 0.03, 0.06], [0, 0.016, 0.07]], [0.009, 0.008, 0.004], 6, 4), ell(0.004, 0.004, 0.004, [0.006, 0.03, 0.062], 6, 4)));
      head.add(many(M.eye(0xd27aff), ell(0.007, 0.006, 0.005, [-0.015, 0.048, 0.035], 6, 5), ell(0.007, 0.006, 0.005, [0.015, 0.048, 0.035], 6, 5)));
      head.add(many(M.fur(0x1c1a20, 1), ...[-1, 1].map(s => limb([[s * 0.032, 0.07, -0.01], [s * 0.042, 0.03, -0.012], [s * 0.04, -0.02, -0.02]], [0.012, 0.01, 0.003], 6, 4, 0.5))));
      const hat = revolve(resample([[0.092, 0], [0.095, 0.004], [0.09, 0.01], [0.048, 0.012], [0.042, 0.03], [0.03, 0.075], [0.016, 0.12], [0.003, 0.16], [0, 0.165]], 10), 20);
      const hp = hat.attributes.position;
      for (let i = 0; i < hp.count; i++) { const y = hp.getY(i); hp.setZ(i, hp.getZ(i) - (y / 0.165) ** 2.2 * 0.05); }
      hat.computeVertexNormals(); weldNormals(hat);
      head.add(mesh(xf(hat, [0, 0.072, -0.004]), M.cloth(0x24182e, 2)));
      head.add(mesh(xf(revolve([[0.046, 0.086], [0.047, 0.094], [0.045, 0.1]], 22), [0, 0, -0.002]), M.metal(0xc8a050, 0.3)));
    } else {
      head.add(many(skin, ell(0.04, 0.04, 0.04, [0, 0.036, 0], 11, 8), ...[-1, 1].map(s => limb([[s * 0.036, 0.04, -0.006], [s * 0.07, 0.054, -0.02], [s * 0.088, 0.058, -0.034]], [0.014, 0.008, 0.002], 6, 4, 0.4))));
      // Animal-skull mask with glowing eyes in dark sockets, a hood and a fan of feathers
      head.add(mesh(merge([ell(0.036, 0.042, 0.024, [0, 0.04, 0.032], 11, 8), limb([[0, 0.022, 0.05], [0, 0.012, 0.074]], [0.016, 0.01], 6, 3)]), M.bone()));
      head.add(many(M.dark(0x0a0806), ell(0.011, 0.009, 0.006, [-0.015, 0.048, 0.052], 6, 5), ell(0.011, 0.009, 0.006, [0.015, 0.048, 0.052], 6, 5)));
      head.add(many(M.eye(0x7dff4a), ell(0.005, 0.005, 0.004, [-0.015, 0.048, 0.055], 6, 4), ell(0.005, 0.005, 0.004, [0.015, 0.048, 0.055], 6, 4)));
      head.add(mesh(xf(hoodGeo(0.054, 14, 8, 1.05), [0, 0.04, -0.008]), M.cloth(0x5a3c22, 2)));
      head.add(mesh(xf(hoodGeo(0.052, 14, 8, 1.05), [0, 0.04, -0.008]), M.lining(0x5a3c22)));
      const fc = [0xb8302a, 0x2a8a8a, 0xeee6d0, 0xd8a030, 0xb8302a];
      fc.forEach((c, i) => {
        const f = mesh(ell(0.008, 0.042, 0.003, [0, 0.042, 0], 6, 4), M.cloth(c, 1));
        f.position.set(0, 0.075, -0.035); f.rotation.set(-0.35, 0, (i - 2) * 0.38);
        head.add(f);
      });
    }
    for (const s of [-1, 1]) {
      const arm = node(s < 0 ? 'armL' : 'armR', [s * 0.07, 0.29, 0]);
      arm.add(mesh(limb([[0, 0, 0], [s * 0.02, -0.05, 0.02], [s * 0.026, -0.09, 0.05]], [0.022, 0.025, 0.031], 8, 6), robe));
      arm.add(mesh(ell(0.015, 0.016, 0.016, [s * 0.027, -0.1, 0.056], 8, 6), skin));
      body.add(arm);
      if (s > 0) {
        // Gnarled staff topped with a glowing orb (green for the shaman, violet for the witch)
        const staff = node('staff', [s * 0.027, -0.1, 0.056]);
        arm.add(staff);
        staff.add(mesh(gnarl(revolve(resample([[0.006, -0.19], [0.008, -0.18], [0.008, 0], [0.009, 0.12], [0.012, 0.15], [0.006, 0.16]], 9), 7), 0.0025, 30, 11), M.wood(0x7a5a40)));
        const c = o.witch ? 0xc070ff : 0x7dff4a;
        staff.add(many(M.wood(0x7a5a40), ...[0, 1, 2].map(i => { const a = i / 3 * TAU; return limb([[0, 0.15, 0], [Math.cos(a) * 0.018, 0.17, Math.sin(a) * 0.018], [Math.cos(a) * 0.01, 0.195, Math.sin(a) * 0.01]], [0.005, 0.004, 0.0015], 5, 4); })));
        const orb = mesh(new THREE.SphereGeometry(0.019, 12, 8).translate(0, 0.178, 0), M.gem(c, false), 'crystal');
        orb.castShadow = false; staff.add(orb);
        const halo = new THREE.Sprite(glowMat(c)); halo.position.set(0, 0.178, 0); halo.scale.setScalar(0.11); staff.add(halo);
        if (!o.witch) staff.add(many(M.bone(), ell(0.016, 0.014, 0.016, [0, 0.13, 0.012], 8, 6)));
      }
    }
    return fig;
  }

  function knight() {
    const fig = node('fig'), body = node('body'), steel = M.metal(0xc6cad0, 0.3, 2), dark = M.metal(0x6e7076, 0.45), brass = M.metal(0xd8a850, 0.28);
    fig.add(body);
    for (const s of [-1, 1]) {
      const leg = node(s < 0 ? 'legL' : 'legR', [s * 0.04, 0.18, 0]);
      leg.add(mesh(merge([limb([[0, 0, 0], [0, -0.09, 0.012], [0, -0.168, 0]], [0.034, 0.028, 0.026], 8, 5), ell(0.026, 0.016, 0.042, [0, -0.175, 0.016], 8, 5)]), steel));
      leg.add(mesh(ell(0.022, 0.022, 0.02, [0, -0.085, 0.024], 8, 6), dark));
      fig.add(leg);
    }
    body.add(mesh(revolve([[0.104, 0.13], [0.1, 0.16], [0.092, 0.2], [0.085, 0.24]], 22, (a, j, r, y) => [r * (1 + (j === 0 ? 0.04 * Math.sin(a * 6) : 0)), y]), M.cloth(0x1f3f8a, 2)));
    body.add(mesh(revolve([[0.087, 0.232], [0.089, 0.244], [0.087, 0.256]], 22), M.leather(0x4a3424)));
    body.add(mesh(xf(revolve(resample([[0, 0.2], [0.078, 0.205], [0.086, 0.24], [0.093, 0.29], [0.098, 0.33], [0.09, 0.36], [0.07, 0.38], [0.04, 0.39], [0, 0.392]], 9), 18,
      (a, j, r, y) => [r * (1 + 0.07 * Math.max(0, Math.cos(a - Math.PI / 2)) ** 10), y]), [0, 0, 0], [0, 0, 0], [1, 1, 0.82]), steel));
    body.add(mesh(xf(new THREE.TorusGeometry(0.04, 0.01, 5, 14), [0, 0.388, 0], [Math.PI / 2, 0, 0]), dark));
    body.add(many(steel, ...[-1, 1].map(s => xf(revolve([[0.052, 0], [0.05, 0.016], [0.04, 0.034], [0.022, 0.046], [0, 0.05]], 14), [s * 0.094, 0.348, 0], [0, 0, -s * 0.55])),
      ...[-1, 1].map(s => xf(revolve([[0.054, -0.012], [0.054, 0.0]], 14), [s * 0.094, 0.348, 0], [0, 0, -s * 0.55]))));
    const head = node('head', [0, 0.43, 0.004]);
    body.add(head);
    head.add(mesh(revolve(resample([[0.044, -0.046], [0.047, -0.02], [0.048, 0.01], [0.045, 0.03], [0.033, 0.05], [0.015, 0.058], [0, 0.06]], 7), 16), steel));
    head.add(many(M.dark(0x050505), xf(new THREE.BoxGeometry(0.062, 0.0075, 0.02), [0, 0.006, 0.039])));
    head.add(many(brass, limb([[0, 0.052, 0.03], [0, 0.03, 0.046], [0, -0.01, 0.05], [0, -0.044, 0.046]], [0.005, 0.005, 0.005, 0.005], 5, 6), xf(new THREE.TorusGeometry(0.047, 0.004, 4, 16), [0, -0.035, 0], [Math.PI / 2, 0, 0])));
    head.add(mesh(limb([[0, 0.056, 0.03], [0, 0.085, -0.005], [0, 0.075, -0.055], [0, 0.04, -0.085]], [0.01, 0.018, 0.016, 0.005], 6, 7, 0.5), M.fur(0xb01e1e, 2)));
    for (const s of [-1, 1]) {
      const arm = node(s < 0 ? 'armL' : 'armR', [s * 0.1, 0.35, 0]);
      arm.add(mesh(limb([[0, 0, 0], [s * 0.01, -0.07, 0.01], [s * 0.012, -0.128, 0.04]], [0.026, 0.023, 0.022], 8, 6), steel));
      arm.add(mesh(ell(0.024, 0.024, 0.026, [s * 0.012, -0.138, 0.048], 8, 6), dark));
      body.add(arm);
      if (s > 0) {
        // Longsword: diamond-section blade, brass guard and pommel, leather grip
        const sword = node('sword', [s * 0.012, -0.138, 0.05]);
        sword.rotation.x = 1.15;
        sword.add(mesh(xf(revolve([[0, 0], [0.011, 0.012], [0.01, 0.16], [0, 0.2]], 4), [0, 0.03, 0], [0, Math.PI / 4, 0], [1, 1, 0.28]), M.metal(0xe4e8ee, 0.18)));
        sword.add(many(brass, limb([[-0.03, 0.028, 0], [0, 0.03, 0], [0.03, 0.028, 0]], [0.005, 0.006, 0.005], 5, 4), ell(0.009, 0.009, 0.009, [0, -0.032, 0], 6, 5)));
        sword.add(mesh(limb([[0, 0.022, 0], [0, -0.025, 0]], [0.006, 0.006], 5, 3), M.leather(0x3a2a20)));
        arm.add(sword);
      } else {
        // Kite shield with painted heraldry and a steel rim
        const sh = new THREE.Shape();
        sh.moveTo(0, 0.075); sh.quadraticCurveTo(0.064, 0.072, 0.062, 0.02); sh.quadraticCurveTo(0.054, -0.055, 0, -0.105); sh.quadraticCurveTo(-0.054, -0.055, -0.062, 0.02); sh.quadraticCurveTo(-0.064, 0.072, 0, 0.075);
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 6 });
        const gp = g.attributes.position;
        for (let i = 0; i < gp.count; i++) { const x = gp.getX(i); gp.setZ(i, gp.getZ(i) - x * x * 3); }
        g.computeVertexNormals();
        const shield = new THREE.Mesh(g, [M.heraldry(), steel]);
        shield.castShadow = q.figureShadows; shield.receiveShadow = q.shadows;
        shield.position.set(-0.03, -0.1, 0.05); shield.rotation.set(0.05, -0.45, 0);
        arm.add(shield);
      }
    }
    return fig;
  }

  function treant() {
    const fig = node('fig'), body = node('body'), bark = M.bark(0xffffff, 3, 3, true), barkLimb = M.bark(0xd8ccb8, 2, 2), eye = M.eye(0xffb02a);
    fig.add(body);
    // Trunk with buttress roots, bark ridges, a carved face (sockets, brow, nose knot, mouth) and moss on the shoulders
    const gauss = (da, dy, wa, wy) => Math.exp(-((da / wa) ** 2) - ((dy / wy) ** 2));
    const trunk = revolve(resample([[0.2, 0.3], [0.245, 0.38], [0.222, 0.5], [0.2, 0.65], [0.205, 0.8], [0.22, 0.95], [0.232, 1.05], [0.212, 1.15], [0.165, 1.25], [0.1, 1.32], [0.04, 1.36], [0, 1.37]], 30), 40, (a, j, r, y) => {
      const ridge = 0.035 * Math.abs(Math.sin(a * 7 + vnoise3(Math.cos(a) * 2, y * 2, Math.sin(a) * 2, 3) * 3)) ** 0.6;
      const lump = (vnoise3(Math.cos(a) * 1.5, y * 2.5, Math.sin(a) * 1.5, 4) - 0.5) * 0.12;
      const da = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2));
      const face = -0.07 * (gauss(da - 0.32, y - 1.0, 0.16, 0.045) + gauss(da + 0.32, y - 1.0, 0.16, 0.045))
        + 0.05 * gauss(da, y - 1.06, 0.5, 0.025) + 0.06 * gauss(da, y - 0.94, 0.1, 0.04)
        - 0.08 * gauss(da, y - 0.84 - 0.06 * da * da, 0.42, 0.02);
      return [r * (1 + lump) + ridge * (y < 1.25 ? 1 : 0.4) + face * (r / 0.22), y];
    });
    xf(trunk, [0, 0, 0], [0, 0, 0], [1, 1, 0.86]);
    paintVerts(trunk, (x, y, z, nx, ny) => {
      const moss = Math.max(0, Math.min(1, (ny - 0.25) * 2.5 + (vnoise3(x * 6, y * 6, z * 6, 5) - 0.5) * 1.2)) * (y > 0.9 ? 1 : 0.4);
      const k = 0.85 + vnoise3(x * 4, y * 4, z * 4, 6) * 0.3;
      return [k * (1 - moss * 0.55), k * (1 - moss * 0.2), k * (1 - moss * 0.7)];
    });
    body.add(mesh(trunk, bark));
    body.add(many(eye, ell(0.03, 0.022, 0.016, [-0.067, 1.0, 0.162], 10, 6), ell(0.03, 0.022, 0.016, [0.067, 1.0, 0.162], 10, 6)));
    body.add(many(M.eye(0xc05a10), ell(0.075, 0.012, 0.02, [0, 0.845, 0.158], 11, 5)));
    body.add(many(M.fur(0x5a7a32, 1), ...[-0.06, -0.02, 0.025, 0.065].map((x, i) => limb([[x, 0.83, 0.17], [x * 1.1, 0.77, 0.18 + i * 0.003], [x * 1.15, 0.7 - (i % 2) * 0.04, 0.17]], [0.016, 0.012, 0.003], 5, 4, 0.6))));
    // Shelf fungi on the side of the trunk
    body.add(many(M.skin(0xd8a060), ...[[0.2, 0.62, 0.08, 0.04], [0.19, 0.7, 0.1, 0.03], [-0.2, 0.55, -0.02, 0.035]].map(([x, y, z, r]) => xf(revolve([[r, 0], [r * 1.02, 0.006], [r * 0.7, 0.016], [0, 0.02]], 14), [x, y, z], [0, 0, x > 0 ? -0.3 : 0.3], [1, 1, 0.6]))));
    // Crown: branch stubs and lumpy leaf clusters
    body.add(mesh(merge([[-1, 0.2], [1, -0.15], [0.2, 1]].map(([s, zz]) => gnarl(limb([[s * 0.05, 1.22, zz * 0.05], [s * 0.15, 1.36, zz * 0.12], [s * 0.22, 1.45, zz * 0.15]], [0.06, 0.04, 0.02], 6, 6), 0.01, 12, 8))), barkLimb));
    body.add(many(M.leaf(), leafBlob(0.32, [0, 1.5, -0.05], 1), leafBlob(0.23, [-0.28, 1.4, 0.03], 2), leafBlob(0.24, [0.29, 1.42, -0.05], 3), leafBlob(0.22, [0.02, 1.4, -0.27], 4), leafBlob(0.17, [0.12, 1.62, 0.12], 5, 14, 10)));
    // Branch arms with twig fingers and a few leafy sprigs
    for (const s of [-1, 1]) {
      const arm = node(s < 0 ? 'armL' : 'armR', [s * 0.19, 1.04, 0.02]);
      const end = [s * 0.38, -0.42, 0.13];
      const geos = [gnarl(limb([[0, 0, 0], [s * 0.15, -0.04, 0.04], [s * 0.3, -0.2, 0.09], end], [0.11, 0.085, 0.06, 0.04], 8, 10), 0.014, 14, 9 + s)];
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.5;
        geos.push(limb([end, [end[0] + s * 0.03 + Math.sin(a) * 0.03, end[1] - 0.06, end[2] + Math.cos(a) * 0.03], [end[0] + s * 0.04 + Math.sin(a) * 0.06, end[1] - 0.11, end[2] + Math.cos(a) * 0.06]], [0.024, 0.014, 0.004], 5, 4));
      }
      geos.push(limb([[s * 0.2, -0.1, 0.06], [s * 0.24, 0.0, 0.05], [s * 0.26, 0.08, 0.02]], [0.02, 0.012, 0.004], 5, 4));
      arm.add(mesh(merge(geos), barkLimb));
      arm.add(many(M.leaf(), leafBlob(0.08, [s * 0.27, 0.1, 0.02], 6 + s, 12, 8), leafBlob(0.06, [s * 0.14, 0.02, 0.07], 8 + s, 12, 8)));
      body.add(arm);
      // Root legs, each with three splayed root toes
      const leg = node(s < 0 ? 'legL' : 'legR', [s * 0.13, 0.42, 0]);
      const lg = [gnarl(limb([[0, 0, 0], [s * 0.02, -0.2, 0.03], [s * 0.035, -0.4, 0]], [0.13, 0.1, 0.1], 10, 6), 0.018, 9, 12 + s)];
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.8 + (s > 0 ? 0.2 : -0.2), dx = Math.sin(a), dz = Math.cos(a);
        lg.push(gnarl(limb([[s * 0.035, -0.37, 0], [s * 0.035 + dx * 0.1, -0.405, dz * 0.1], [s * 0.035 + dx * 0.2, -0.42, dz * 0.2]], [0.06, 0.04, 0.014], 6, 6), 0.008, 16, 20 + i));
      }
      leg.add(mesh(merge(lg), barkLimb));
      fig.add(leg);
    }
    return fig;
  }

  function sapling() {
    const fig = node('fig'), body = node('body'), bark = M.bark(0xd8ccb8, 1, 1);
    fig.add(body);
    body.add(mesh(merge([
      limb([[0, -0.01, 0], [0.01, 0.08, 0], [-0.006, 0.16, 0.01], [0, 0.21, 0]], [0.024, 0.017, 0.012, 0.007], 6, 7),
      limb([[0.006, 0.12, 0], [0.04, 0.16, 0.01], [0.055, 0.18, 0.02]], [0.007, 0.005, 0.002], 5, 4),
      limb([[-0.004, 0.14, 0], [-0.04, 0.17, -0.01], [-0.052, 0.19, -0.01]], [0.007, 0.005, 0.002], 5, 4),
      ...[0, 1, 2].map(i => { const a = i / 3 * TAU + 0.4; return limb([[0, 0.02, 0], [Math.cos(a) * 0.04, 0.0, Math.sin(a) * 0.04], [Math.cos(a) * 0.07, -0.012, Math.sin(a) * 0.07]], [0.012, 0.007, 0.002], 5, 4); }),
    ]), bark));
    body.add(many(M.leaf(), leafBlob(0.07, [0, 0.235, 0], 11, 14, 10), leafBlob(0.05, [0.058, 0.185, 0.02], 12, 12, 8), leafBlob(0.05, [-0.055, 0.195, -0.01], 13, 12, 8)));
    body.add(many(M.eye(0xffc040), ell(0.0075, 0.0065, 0.005, [-0.009, 0.12, 0.016], 6, 5), ell(0.0075, 0.0065, 0.005, [0.009, 0.12, 0.016], 6, 5)));
    return fig;
  }

  const BUILD = { goblin, wolf, brute, bat, shaman, knight, treant, sapling };

  // ---------- Shared overlays ----------
  const glowTex = tx('glow', glowCanvas());
  /** Additive halo sprite material for a glow colour (shared per colour). */
  function glowMat(c) {
    return mat(`glowSprite${c}`, () => new THREE.SpriteMaterial({ map: glowTex, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.55 }));
  }
  const star = new THREE.SpriteMaterial({ map: tx('star', starCanvas()), transparent: true, depthWrite: false, toneMapped: false });
  const barTex = tx('bar', barCanvas());
  const barBg = new THREE.SpriteMaterial({ map: barTex, color: 0x0e1012, opacity: 0.8, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false, fog: false });
  const barFills = [0xe0503c, 0xe8c44a, 0x62d65a].map(c => new THREE.SpriteMaterial({ map: barTex, color: c, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false, fog: false }));
  const iceGeo = new THREE.IcosahedronGeometry(1, 1);
  const iceMat = new THREE.MeshPhysicalMaterial({ color: 0xcdeeff, emissive: 0x2a5878, emissiveIntensity: 0.6, roughness: 0.06, clearcoat: 1, transparent: true, opacity: 0.42, flatShading: true, depthWrite: false, envMapIntensity: 1.8 });
  const dissolveTex = tx('dissolve', dissolveCanvas(), 2, 2, false);
  const auraTexs = [1, 2, 3, 4, 5].map(n => tx('aura' + n, auraCanvas(n)));
  extraMat.push(star, barBg, ...barFills, iceMat);
  extraGeo.push(iceGeo);

  const CHARGE_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const CHARGE_FS = `varying vec2 vUv; uniform float fill; uniform float pulse; uniform vec3 color;
    void main() {
      vec2 p = vUv * 2.0 - 1.0; float r = length(p);
      float band = smoothstep(0.7, 0.75, r) * (1.0 - smoothstep(0.93, 0.98, r));
      float t = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
      float on = 1.0 - smoothstep(fill - 0.004, fill, t);
      if (fill >= 1.0) on = 1.0;
      vec3 c = mix(vec3(0.04, 0.05, 0.07), color * (1.0 + pulse), on);
      float glow = (1.0 - smoothstep(0.0, 0.25, abs(r - 0.84))) * pulse * 0.6;
      gl_FragColor = vec4(c + color * glow, band * mix(0.5, 1.0, on) + glow * 0.5);
      #include <encodings_fragment>
    }`;
  const chargeProto = new THREE.ShaderMaterial({
    uniforms: { fill: { value: 0 }, pulse: { value: 0 }, color: { value: new THREE.Color() } },
    vertexShader: CHARGE_VS, fragmentShader: CHARGE_FS, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  extraMat.push(chargeProto);

  function proto(key, make) {
    if (!protos.has(key)) protos.set(key, make());
    return protos.get(key);
  }
  /** A clone of the prototype plus its named nodes. */
  function instance(root) {
    const fig = root.clone(true), nodes = {};
    fig.traverse(o => { if (o.name) nodes[o.name] = o; });
    return { root: fig, nodes };
  }

  return {
    mage: kind => instance(proto('mage:' + kind, () => buildMage(kind))),
    enemy: kind => { const L = ENEMY_LOOK[kind]; return instance(proto('enemy:' + kind, () => BUILD[L.build](L.opts))); },
    auraTex: level => auraTexs[level - 1],
    /** A charge-ring material for one mage (uniforms fill 0..1, pulse 0..1, color). */
    chargeMaterial(c) { const m = chargeProto.clone(); m.uniforms.color.value.set(c); return m; },
    glowMat, star, barBg, barFill: f => barFills[f < 0.3 ? 0 : f < 0.6 ? 1 : 2], iceGeo, iceMat, dissolveTex,
    dispose() {
      const seen = new Set();
      for (const p of protos.values()) p.traverse(o => {
        if (o.isMesh && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } // sprites share three's own quad
      });
      for (const m of mats.values()) m.dispose();
      for (const m of extraMat) m.dispose();
      for (const g of extraGeo) g.dispose();
      for (const t of texs.values()) t.dispose();
      protos.clear(); mats.clear(); texs.clear();
    },
  };
}
