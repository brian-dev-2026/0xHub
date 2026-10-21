// Mage Siege props: smooth lathe-built and displaced meshes with procedural PBR textures. Trees and rocks are
// instanced (board props plus a seeded scatter of woodland around the board); ruins, crystals, the mana well,
// reeds, the lava vent, the bridge and stepping stones are built per map. Buildable tiles keep their centre clear
// for a mage, so their props sit toward the back corners.
import * as THREE from 'three';
import { W, H } from '../../../shared/games/mages/data';
import {
  barkSwatch, fbm, hash2, lavaGlowCanvas, leafSwatch, magmaCanvas, manaCanvas, needleSwatch, plankSwatch, prng, smooth, swatch, toTex, vnoise, vnoise3,
} from './textures';

const TAU = Math.PI * 2;

// ================= Geometry helpers =================
/** Averages normals of vertices that share a position (lathe seams, sphere poles), then normalizes. */
function weldNormals(g) {
  const p = g.attributes.position, n = g.attributes.normal, acc = new Map();
  const key = i => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i), a = acc.get(k) || [0, 0, 0];
    a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); acc.set(k, a);
  }
  for (let i = 0; i < p.count; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
  return g;
}
/** Surface of revolution from a [radius, y] profile; shape(a, row, r, y) may return a changed [r, y]. */
function revolve(profile, segA, shape) {
  const rows = profile.length, cols = segA + 1, pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = (i % segA) / segA * TAU;
    let [r, y] = profile[j];
    if (shape) [r, y] = shape(a, j, r, y);
    const k = j * cols + i;
    pos[k * 3] = Math.cos(a) * r; pos[k * 3 + 1] = y; pos[k * 3 + 2] = Math.sin(a) * r;
    uv[k * 2] = i / segA; uv[k * 2 + 1] = j / (rows - 1);
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < segA; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return weldNormals(g);
}
/** Merges indexed or non-indexed geometries with position/normal/uv (and colour, filled white where missing). */
function merge(geos) {
  const withColor = geos.some(g => g.attributes.color);
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = withColor ? new Float32Array(nv * 3).fill(1) : null;
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const a = g.attributes, n = a.position.count;
    pos.set(a.position.array, vo * 3); nor.set(a.normal.array, vo * 3);
    if (a.uv) uv.set(a.uv.array, vo * 2);
    if (col && a.color) col.set(a.color.array, vo * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < n; i++) idx[io++] = vo + i;
    vo += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
/** Per-vertex colour from fn(x, y, z, nx, ny, nz) → [r, g, b]. */
function paintVerts(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)); c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ================= Prop geometries (unit-ish sizes, base at y = 0) =================
/** A smooth, rounded boulder: a sphere with broad low-frequency lumps, flattened where it sits in the ground. */
function rockGeo(seed) {
  const g = new THREE.SphereGeometry(1, 20, 14), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 1 + (vnoise3(x * 1.1 + seed, y * 1.1, z * 1.1, seed) - 0.5) * 0.55 + (vnoise3(x * 2.6, y * 2.6 + seed, z * 2.6, seed + 1) - 0.5) * 0.1;
    x *= r * 1.0; y *= r * 0.68; z *= r * 0.86;
    if (y < -0.12) y = -0.12 + (y + 0.12) * 0.25;
    p.setXYZ(i, x, y + 0.14, z);
  }
  g.computeVertexNormals(); weldNormals(g);
  return paintVerts(g, (x, y, z, nx, ny) => {
    const moss = smooth(0.8, 0.97, ny + (vnoise3(x * 2, y * 2, z * 2, seed + 2) - 0.5) * 0.4), ao = 0.5 + 0.5 * smooth(0.0, 0.45, y);
    return mixc([ao, ao * 0.98, ao * 0.95], [0.55 * ao, 0.62 * ao, 0.4 * ao], moss * 0.4);
  });
}
/** Broadleaf crown from lumpy blobs; `ring` blobs around the core, each `ws` x `hs` segments (fewer for distant trees). */
function oakCanopyGeo(seed, ring = 6, ws = 12, hs = 8) {
  const rnd = prng(seed), blobs = [[0, 0.5, 0, 0.2]];
  for (let k = 0; k < ring; k++) { const a = k / ring * TAU + rnd() * 0.6; blobs.push([Math.cos(a) * 0.14, 0.42 + rnd() * 0.12, Math.sin(a) * 0.14, 0.12 + rnd() * 0.05 + (6 - ring) * 0.01]); }
  blobs.push([0.02, 0.64, -0.01, 0.12]);
  const parts = blobs.map(([bx, by, bz, br], bi) => {
    const g = new THREE.SphereGeometry(br, ws, hs), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), d = 1 + (vnoise3(x * 22 + bi, y * 22, z * 22, seed) - 0.5) * 0.45;
      p.setXYZ(i, bx + x * d, by + y * d, bz + z * d);
    }
    g.computeVertexNormals(); weldNormals(g);
    // Bend normals toward the crown's outward direction so the canopy shades as one soft mass
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const ox = p.getX(i), oy = p.getY(i) - 0.48, oz = p.getZ(i), ol = Math.hypot(ox, oy, oz) || 1;
      const nx = n.getX(i) * 0.45 + ox / ol * 0.55, ny = n.getY(i) * 0.45 + oy / ol * 0.55, nz = n.getZ(i) * 0.45 + oz / ol * 0.55, l = Math.hypot(nx, ny, nz);
      n.setXYZ(i, nx / l, ny / l, nz / l);
    }
    return g;
  });
  const g = merge(parts);
  return paintVerts(g, (x, y, z) => { const k = 0.42 + 0.58 * smooth(0.3, 0.72, y) + (vnoise3(x * 9, y * 9, z * 9, seed + 3) - 0.5) * 0.15; return [k, k, k * 0.95]; });
}
function trunkGeo(h, r, seg = 10) {
  return revolve([[r * 1.5, -0.02], [r * 1.15, 0.03], [r, h * 0.2], [r * 0.8, h * 0.6], [r * 0.55, h * 0.95], [0, h]], seg,
    (a, j, rr, y) => [rr * (1 + (vnoise(a * 2, y * 9, 4, 0, 5) - 0.5) * 0.3), y]);
}
/** Conifer from ragged stacked cones; `seg` segments around each tier. */
function pineGeo(seed, seg = 18) {
  const tiers = [];
  for (let k = 0; k < 5; k++) {
    const base = 0.14 + k * 0.13, R = 0.22 - k * 0.04, top = base + 0.26 - k * 0.02;
    tiers.push(revolve([[0.012, base + 0.05], [R * 0.85, base - 0.01], [R, base + 0.01], [R * 0.62, base + (top - base) * 0.42], [R * 0.25, top - 0.04], [0, top]], seg,
      (a, j, r, y) => {
        const rag = 1 + (vnoise(a * 2.3, k * 3, 0, 0, seed) - 0.5) * 0.35 + Math.sin(a * 9 + k * 1.7) * 0.07;
        return [r * (j <= 2 ? rag : 1 + (rag - 1) * 0.4), y - (j <= 2 ? (rag - 1) * 0.05 : 0)];
      }));
  }
  const g = merge(tiers);
  return paintVerts(g, (x, y, z, nx, ny) => { const k = (0.45 + 0.55 * smooth(0.1, 0.8, y)) * (ny < 0 ? 0.55 : 1); return [k, k, k]; });
}
function columnGeo(h, broken, seed) {
  const R = 0.07, prof = [[0.105, 0], [0.105, 0.04], [0.09, 0.05], [R * 1.08, 0.065], [R, 0.08]];
  const top = broken ? h : h - 0.07;
  for (let k = 1; k <= 8; k++) prof.push([R * (1 - 0.06 * k / 8), 0.08 + (top - 0.08) * k / 8]);
  if (broken) prof.push([R * 0.55, h + 0.015], [0, h - 0.01]);
  else prof.push([R * 1.12, h - 0.045], [0.1, h - 0.03], [0.1, h], [0, h]);
  const shaft = j => j >= 5 && j <= 12;
  return revolve(prof, 48, (a, j, r, y) => {
    let rr = r, yy = y;
    if (shaft(j)) rr *= 1 - 0.05 * Math.pow(0.5 + 0.5 * Math.cos(a * 16), 2);
    if (broken && j >= prof.length - 3) yy += (vnoise(a * 2.5, 0, 0, 0, seed) - 0.5) * 0.09;
    rr *= 1 + (vnoise(a * 3, y * 12, 0, 0, seed + 1) - 0.5) * 0.05; // weathering
    return [rr, yy];
  });
}
function crystalGeo(w, h) {
  return revolve([[0, -0.03], [w, 0], [w * 1.08, h * 0.75], [w * 0.95, h], [0, h + w * 1.5]], 6);
}
function bladeGeo(h, w, bend, rnd) {
  const n = 6, pos = [], idx = [], uv = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, hw = w * Math.pow(1 - t, 0.7) + 0.001;
    pos.push(-hw, h * t, bend * t * t, hw, h * t, bend * t * t); uv.push(0, t, 1, t);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  g.rotateY(rnd() * TAU);
  return paintVerts(g, (x, y) => mixc([0.16, 0.24, 0.07], [0.62, 0.6, 0.3], smooth(0, h, y)));
}

/**
 * buildProps(map, ctx) → { group, update(time) }. ctx: { quality, field, K, WATER_Y, STONE_Y } from terrain.js.
 */
export function buildProps(map, { quality: q, field, K, WATER_Y, STONE_Y }) {
  const group = new THREE.Group(), seed = field.seed, rnd = prng(seed * 7919 + 13);
  const tex = (c, rx = 1, ry = 1, srgb = true) => toTex(c, { rx, ry, srgb, aniso: q.aniso });
  const ground = (u, v) => field.height(u, v);
  const cast = (o, c = true) => { o.castShadow = c && q.shadows; o.receiveShadow = q.shadows; return o; };
  const add = (o, c) => { group.add(cast(o, c)); return o; };

  // ---------- Materials ----------
  const rockSw = swatch('rock'), leaf = leafSwatch(), needle = needleSwatch(), bark = barkSwatch();
  const rockMat = new THREE.MeshStandardMaterial({ map: tex(rockSw.col, 1, 1), bumpMap: tex(rockSw.hgt, 1, 1, false), bumpScale: 0.25, roughness: 0.8, vertexColors: true });
  const stoneMat = new THREE.MeshStandardMaterial({ map: tex(rockSw.col, 2, 1), bumpMap: tex(rockSw.hgt, 2, 1, false), bumpScale: 0.8, roughness: 0.8, color: new THREE.Color(1.45, 1.38, 1.22), vertexColors: true });
  const barkMat = new THREE.MeshStandardMaterial({ map: tex(bark.col, 2, 1), bumpMap: tex(bark.hgt, 2, 1, false), bumpScale: 1.5, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ map: tex(leaf.col, 2, 2), bumpMap: tex(leaf.hgt, 2, 2, false), bumpScale: 1.4, roughness: 0.82, vertexColors: true });
  const needleMat = new THREE.MeshStandardMaterial({ map: tex(needle.col, 3, 2), bumpMap: tex(needle.hgt, 3, 2, false), bumpScale: 1.4, roughness: 0.85, vertexColors: true });
  const woodMat = new THREE.MeshStandardMaterial({ map: tex(plankSwatch().col), bumpMap: tex(plankSwatch().hgt, 1, 1, false), bumpScale: 1.2, roughness: 0.78 });

  // ---------- Instanced trees, bushes and rocks ----------
  // Board trees use the detailed meshes; the woodland around the board uses lighter ones (it is small on screen)
  const inst = { oakTrunk: [], oakA: [], oakB: [], pineTrunk: [], pine: [], oakTrunkFar: [], oakFar: [], pineTrunkFar: [], pineFar: [], rock0: [], rock1: [], rock2: [], bush: [] };
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), eu = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  const put = (key, u, v, s, yaw, tint = [1, 1, 1], sy = 1, dy = 0, tilt = 0) => {
    eu.set(tilt * (rnd() - 0.5), yaw, tilt * (rnd() - 0.5)); qt.setFromEuler(eu);
    m4.compose(v3.set(u - W / 2, ground(u, v) + dy, v - H / 2), qt, sc.set(s, s * sy, s));
    inst[key].push([m4.clone(), tint]);
  };
  const tree = (u, v, s, pine, far = false) => {
    const yaw = rnd() * TAU, tone = 0.8 + rnd() * 0.4, hue = rnd(), f = far ? 'Far' : '';
    if (pine) {
      put('pineTrunk' + f, u, v, s, yaw, [1, 1, 1], 1, -0.01, 0.08);
      put('pine' + f, u, v, s, yaw, [tone * (0.9 + hue * 0.15), tone, tone * (0.92 + hue * 0.1)], 0.95 + rnd() * 0.3, -0.01);
    } else {
      put('oakTrunk' + f, u, v, s, yaw, [1, 1, 1], 1, -0.01, 0.1);
      put(far ? 'oakFar' : rnd() < 0.5 ? 'oakA' : 'oakB', u, v, s, yaw, [tone * (0.95 + hue * 0.25), tone, tone * (0.8 + hue * 0.1)], 0.9 + rnd() * 0.2, -0.01);
    }
  };
  const rockAt = (u, v, s, sink = 0.03) => put('rock' + ((rnd() * 3) | 0), u, v, s, rnd() * TAU, [0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2], 0.7 + rnd() * 0.5, -sink * s * 4);

  const centre = t => [(t % W) + 0.5, Math.floor(t / W) + 0.5];
  const tileOf = map.tiles;
  // Board props from the map
  for (const pr of map.props) {
    const [cu, cv] = centre(pr.tile), side = pr.turn & 1 ? 1 : -1;
    switch (pr.type) {
      case 'tree':
        if (tileOf[pr.tile].terrain === 'forest') {
          tree(cu - 0.3 * side, cv - 0.3, 0.9 * pr.scale, rnd() < 0.5);
          tree(cu + 0.3 * side, cv - 0.26, 0.8 * pr.scale, rnd() < 0.5);
          tree(cu - 0.34 * side, cv + 0.14, 0.62 * pr.scale, rnd() < 0.4);
          put('bush', cu + 0.32 * side, cv + 0.3, 0.5, rnd() * TAU, [0.9, 1, 0.85], 0.7, -0.17);
        } else tree(cu + 0.3 * side, cv - 0.3, 0.8 * pr.scale, rnd() < 0.3);
        break;
      case 'rock':
        rockAt(cu, cv, 0.3 * pr.scale);
        rockAt(cu + (rnd() - 0.5) * 0.5, cv + 0.25, 0.14 * pr.scale);
        rockAt(cu + 0.28 * side, cv - 0.2, 0.17 * pr.scale);
        if (rnd() < 0.6) rockAt(cu - 0.3 * side, cv + 0.05, 0.1);
        break;
      default: break;
    }
  }
  // Woodland, bushes and boulders around the board (never on the board, the road, or tall right in front of it)
  for (let gv = -6; gv < H + 4.5; gv += 0.95) for (let gu = -7; gu < W + 7; gu += 0.95) {
    if (rnd() > q.scatter) continue;
    const u = gu + (hash2(gu * 7 | 0, gv * 7 | 0, seed) - 0.5) * 0.7, v = gv + (hash2(gu * 7 | 0, gv * 7 | 0, seed + 1) - 0.5) * 0.7;
    const out = field.outside(u, v);
    if (out < 0.3 || field.pathDist(u, v) < 0.95) continue;
    const dense = smooth(0.47, 0.62, fbm(u * 0.16, v * 0.16, 0, 0, 3, seed + 40)), r = rnd();
    const near = v > H; // in front of the board: keep it low
    if (near && v < H + 2.6) { if (r < 0.12) put('bush', u, v, 0.45 + rnd() * 0.4, rnd() * TAU, [0.9, 1, 0.85], 0.7, -0.17); else if (r < 0.17) rockAt(u, v, 0.1 + rnd() * 0.12); continue; }
    if (r < dense * 0.75 + 0.04) tree(u, v, 0.85 + rnd() * 0.65, rnd() < 0.55, true);
    else if (r < dense * 0.75 + 0.09) put('bush', u, v, 0.5 + rnd() * 0.4, rnd() * TAU, [0.9, 1, 0.85], 0.7, -0.17);
    else if (r < dense * 0.75 + 0.12) rockAt(u, v, 0.12 + rnd() * 0.2);
  }
  const geos = {
    oakTrunk: trunkGeo(0.46, 0.035), oakA: oakCanopyGeo(seed + 1), oakB: oakCanopyGeo(seed + 2),
    pineTrunk: trunkGeo(0.5, 0.03), pine: pineGeo(seed + 3), rock0: rockGeo(1), rock1: rockGeo(2), rock2: rockGeo(3),
    oakTrunkFar: trunkGeo(0.46, 0.035, 5), oakFar: oakCanopyGeo(seed + 4, 4, 8, 6), pineTrunkFar: trunkGeo(0.5, 0.03, 5), pineFar: pineGeo(seed + 5, 9),
  };
  geos.bush = geos.oakFar;
  const mats = {
    oakTrunk: barkMat, oakA: leafMat, oakB: leafMat, pineTrunk: barkMat, pine: needleMat, oakTrunkFar: barkMat, oakFar: leafMat, pineTrunkFar: barkMat, pineFar: needleMat,
    rock0: rockMat, rock1: rockMat, rock2: rockMat, bush: leafMat,
  };
  const col = new THREE.Color();
  for (const [key, list] of Object.entries(inst)) {
    if (list.length === 0) continue;
    const im = new THREE.InstancedMesh(geos[key], mats[key], list.length);
    list.forEach(([m, t], i) => { im.setMatrixAt(i, m); im.setColorAt(i, col.setRGB(t[0], t[1], t[2])); });
    im.instanceMatrix.needsUpdate = true;
    add(im, !key.endsWith('TrunkFar')); // distant trunks hide under their crowns: no shadow pass for them
  }

  // ---------- Ruins: fluted columns, one broken, a fallen drum and a lintel block ----------
  const tileProps = type => map.props.filter(p => p.type === type);
  for (const pr of tileProps('pillar')) {
    const [cu, cv] = centre(pr.tile), side = pr.turn & 1 ? 1 : -1, s = pr.scale;
    const place = (geo, u, v, rotY = 0, rotZ = 0, dy = 0) => {
      const m = add(new THREE.Mesh(geo, stoneMat));
      m.position.set(u - W / 2, ground(u, v) + dy, v - H / 2); m.rotation.set(0, rotY, rotZ); m.scale.setScalar(s);
    };
    const mossy = g => paintVerts(g, (x, y, z, nx, ny) => { const k = 0.6 + 0.4 * smooth(0, 0.25, y), m = smooth(0.5, 0.9, ny) * 0.6 + (1 - smooth(0, 0.12, y)) * 0.5; return mixc([k, k, k], [0.45 * k, 0.6 * k, 0.32 * k], m); });
    place(mossy(columnGeo(0.66, false, seed)), cu - 0.31 * side, cv - 0.31, rnd() * TAU);
    place(mossy(columnGeo(0.3, true, seed + 5)), cu + 0.31 * side, cv - 0.29, rnd() * TAU);
    const drum = mossy(columnGeo(0.2, true, seed + 9));
    place(drum, cu + 0.36 * side, cv + 0.2, 0.4 * side + Math.PI / 2, Math.PI / 2, 0.06);
    const lintel = mossy(new THREE.BoxGeometry(0.34, 0.08, 0.12, 6, 2, 2).translate(0, 0.04, 0));
    place(lintel, cu - 0.05 * side, cv - 0.4, 0.15 * side);
  }

  // ---------- Storm crystal: glowing cluster on a rock ----------
  const animated = [];
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.07, 0.09, 0.4), emissive: new THREE.Color(0.12, 0.24, 0.95), emissiveIntensity: 0.6, roughness: 0.12, metalness: 0,
    clearcoat: 0.6, clearcoatRoughness: 0.1, transparent: true, opacity: 0.92, envMapIntensity: 0.9, flatShading: true,
  });
  for (const pr of tileProps('crystal')) {
    const [cu, cv] = centre(pr.tile), side = pr.turn & 1 ? 1 : -1, ou = cu + 0.24 * side, ov = cv - 0.26, gy = ground(ou, ov);
    const cl = new THREE.Group(); cl.position.set(ou - W / 2, gy, ov - H / 2); cl.scale.setScalar(pr.scale * 1.5);
    const base = cast(new THREE.Mesh(geos.rock1, rockMat)); base.scale.set(0.2, 0.12, 0.18); base.position.y = -0.02; cl.add(base);
    const spec = [[0, 0, 0.075, 0.5, 0, 0], [0.1, 0.03, 0.055, 0.32, 0.45, 0.3], [-0.09, 0.04, 0.058, 0.34, -0.4, 0.2], [0.03, -0.1, 0.05, 0.26, 0.2, -0.45], [-0.05, -0.08, 0.042, 0.2, -0.3, -0.4], [0.11, -0.06, 0.036, 0.16, 0.6, -0.2]];
    for (const [x, z, w, h, rx, rz] of spec) {
      const c = cast(new THREE.Mesh(crystalGeo(w, h), crystalMat)); c.position.set(x, 0.03, z); c.rotation.set(rz, rnd() * TAU, -rx); cl.add(c);
    }
    group.add(cl);
    let light = null;
    if (q.lights) { light = new THREE.PointLight(0x7fa6ff, 0.9, 2.4, 2); light.position.set(ou - W / 2, gy + 0.45, ov - H / 2); group.add(light); }
    animated.push(t => { const k = 0.5 + 0.5 * Math.sin(t * 2.3 + seed); crystalMat.emissiveIntensity = 0.45 + 0.35 * k; if (light) light.intensity = 0.6 + 0.6 * k; });
  }

  // ---------- Mana well: stone ring, glowing swirl, wooden frame and roof ----------
  const flag = swatch('flag');
  const wellStone = new THREE.MeshStandardMaterial({ map: tex(flag.col, 3, 0.5), bumpMap: tex(flag.hgt, 3, 0.5, false), bumpScale: 1.4, roughness: 0.82 });
  const manaTex = tex(manaCanvas()); manaTex.center.set(0.5, 0.5);
  const manaMat = new THREE.MeshStandardMaterial({ color: 0x0b2a50, emissive: 0xffffff, emissiveMap: manaTex, emissiveIntensity: 1.6, roughness: 0.15 });
  for (const pr of tileProps('well')) {
    const [cu, cv] = centre(pr.tile), side = pr.turn & 1 ? 1 : -1, ou = cu + 0.22 * side, ov = cv - 0.24, gy = ground(ou, ov);
    const wg = new THREE.Group(); wg.position.set(ou - W / 2, gy - 0.01, ov - H / 2); wg.rotation.y = side > 0 ? 0.3 : -0.3;
    const ring = revolve([[0.17, -0.03], [0.172, 0.12], [0.182, 0.13], [0.182, 0.155], [0.135, 0.16], [0.128, 0.14], [0.125, 0.05], [0, 0.05]], 32,
      (a, j, r, y) => [r * (1 + (vnoise(a * 4, j, 0, 0, seed + 4) - 0.5) * 0.04), y]);
    wg.add(cast(new THREE.Mesh(ring, wellStone)));
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.128, 32), manaMat); water.rotation.x = -Math.PI / 2; water.position.y = 0.12; wg.add(water);
    const post = new THREE.CylinderGeometry(0.014, 0.017, 0.4, 10);
    for (const x of [-0.15, 0.15]) { const p = cast(new THREE.Mesh(post, woodMat)); p.position.set(x, 0.2, 0); wg.add(p); }
    const beam = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 10), woodMat)); beam.rotation.z = Math.PI / 2; beam.position.y = 0.33; wg.add(beam);
    for (const s of [-1, 1]) {
      const roof = cast(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.17), woodMat));
      roof.position.set(0, 0.43, s * 0.065); roof.rotation.x = s * 0.62; wg.add(roof);
    }
    group.add(wg);
    let light = null;
    if (q.lights) { light = new THREE.PointLight(0x5fc8ff, 0.7, 1.8, 2); light.position.set(ou - W / 2, gy + 0.3, ov - H / 2); group.add(light); }
    animated.push(t => { manaTex.rotation = t * 0.35; manaMat.emissiveIntensity = 1.4 + 0.3 * Math.sin(t * 1.7); if (light) light.intensity = 0.55 + 0.2 * Math.sin(t * 1.7); });
  }

  // ---------- Lava vent: a cracked basalt cone with a molten pool ----------
  const basalt = swatch('basalt');
  const lavaGlow = tex(lavaGlowCanvas(), 2, 0.6);
  const ventMat = new THREE.MeshStandardMaterial({ map: tex(basalt.col, 2, 0.6), bumpMap: tex(basalt.hgt, 2, 0.6, false), bumpScale: 1.5, roughness: 0.75, emissive: 0xffffff, emissiveMap: lavaGlow, emissiveIntensity: 1.5 });
  const magmaTex = tex(magmaCanvas(), 1, 1);
  const magmaMat = new THREE.MeshStandardMaterial({ map: magmaTex, emissive: 0xffffff, emissiveMap: magmaTex, emissiveIntensity: 2.2, roughness: 0.55 });
  map.tiles.forEach((t, i) => {
    if (t.kind !== 'build' || t.terrain !== 'lava') return;
    const [cu, cv] = centre(i), side = hash2(i, 1, seed) < 0.5 ? -1 : 1, ou = cu + 0.2 * side, ov = cv - 0.24, gy = ground(ou, ov);
    const cone = revolve([[0.3, -0.04], [0.25, 0.03], [0.17, 0.1], [0.11, 0.135], [0.085, 0.12], [0.07, 0.09], [0, 0.085]], 36,
      (a, j, r, y) => { const n = vnoise(a * 2.2, j * 0.7, 0, 0, seed + 6) - 0.5; return [r * (1 + n * 0.25), y + (j > 0 && j < 6 ? n * 0.03 : 0)]; });
    const vent = add(new THREE.Mesh(cone, ventMat)); vent.position.set(ou - W / 2, gy, ov - H / 2);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), magmaMat); pool.rotation.x = -Math.PI / 2; pool.position.set(ou - W / 2, gy + 0.092, ov - H / 2); group.add(pool);
    let light = null;
    if (q.lights) { light = new THREE.PointLight(0xff6a1a, 1.4, 2.6, 2); light.position.set(ou - W / 2, gy + 0.35, ov - H / 2); group.add(light); }
    animated.push(t2 => {
      const k = Math.sin(t2 * 1.9) * 0.6 + Math.sin(t2 * 5.3) * 0.25 + Math.sin(t2 * 11.7) * 0.15;
      magmaTex.offset.set(t2 * 0.012, t2 * 0.008); magmaMat.emissiveIntensity = 2.1 + k * 0.5; ventMat.emissiveIntensity = 1.4 + k * 0.4;
      if (light) light.intensity = 1.3 + k * 0.4;
    });
  });

  // ---------- Bridge over the lake ----------
  map.path.forEach((t, i) => {
    if (map.tiles[t].terrain !== 'bridge') return;
    const [cu, cv] = centre(t), a = map.path[i - 1], b = map.path[i + 1];
    const alongX = Math.floor(a / W) === Math.floor(b / W);
    const br = new THREE.Group(); br.position.set(cu - W / 2, 0, cv - H / 2); if (!alongX) br.rotation.y = Math.PI / 2;
    const deckY = s => -0.01 + 0.05 * (1 - (s / 0.68) ** 2);
    for (let s = -0.64; s <= 0.65; s += 0.128) {
      const plank = cast(new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.024, 0.72), woodMat));
      plank.position.set(s, deckY(s), (rnd() - 0.5) * 0.02); plank.rotation.set((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.06, -Math.atan(-0.1 * s / 0.46)); br.add(plank);
    }
    for (const z of [-0.29, 0.29]) {
      const beam = cast(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.05), woodMat)); beam.position.set(0, -0.045, z); br.add(beam);
      const rail = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.12, 8), woodMat)); rail.rotation.z = Math.PI / 2; rail.position.set(0, 0.17, z * 1.18); br.add(rail);
      for (const x of [-0.52, 0, 0.52]) { const p = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 8), woodMat)); p.position.set(x, deckY(x) - 0.03, z * 1.18); br.add(p); }
    }
    group.add(br);
  });

  // ---------- Stepping stones on water tiles (where a mage stands), and reeds along the shore ----------
  const stones = [];
  map.tiles.forEach((t, i) => {
    if (t.kind !== 'build' || t.terrain !== 'water') return;
    const [cu, cv] = centre(i);
    const g = revolve([[0.15, -0.3], [0.16, -0.02], [0.15, 0.025], [0.1, 0.042], [0, 0.046]], 28,
      (a, j, r, y) => [r * (1 + (vnoise(a * 2, i, 0, 0, seed + 7) - 0.5) * 0.22), y]).translate(cu - W / 2, STONE_Y - 0.046, cv - H / 2);
    stones.push(paintVerts(g, (x, y) => { const k = 0.55 + 0.45 * smooth(WATER_Y - 0.05, STONE_Y, y); return [k, k, k * 0.95]; }));
  });
  if (stones.length) add(new THREE.Mesh(merge(stones), rockMat));
  const reeds = [];
  for (const pr of tileProps('reed')) {
    const x = pr.tile % W, y = Math.floor(pr.tile / W);
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && map.tiles[ny * W + nx].terrain !== 'water' && map.tiles[ny * W + nx].terrain !== 'bridge'; }) || [0, -1];
    const cu = x + 0.5 + dir[0] * 0.36, cv = y + 0.5 + dir[1] * 0.36;
    for (let k = 0; k < 16; k++) {
      const h = (0.18 + rnd() * 0.22) * pr.scale, ou = cu + (rnd() - 0.5) * 0.36 * (dir[0] ? 0.5 : 1), ov = cv + (rnd() - 0.5) * 0.36 * (dir[1] ? 0.5 : 1);
      const base = Math.max(WATER_Y - 0.04, ground(ou, ov) - 0.02);
      reeds.push(bladeGeo(h, 0.011, (rnd() - 0.3) * 0.12, rnd).translate(ou - W / 2, base, ov - H / 2));
      if (k % 5 === 0) {
        const head = revolve([[0, 0], [0.012, 0.006], [0.013, 0.055], [0, 0.065]], 8).translate(ou - W / 2, base + h * 0.9, ov - H / 2);
        reeds.push(paintVerts(head, () => [0.3, 0.17, 0.08]));
      }
    }
  }
  if (reeds.length) add(new THREE.Mesh(merge(reeds), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 })));

  return { group, update(t) { for (const f of animated) f(t); } };
}
