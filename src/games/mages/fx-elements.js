// Mage Siege element effects: attack projectiles and their impacts, passives, actives, the zones actives leave on
// the path, the burning/poisoned status looks, and the meteor. Each grows with the mage's level: more particles,
// a larger radius, and real point lights from L4. Built on the core kit from fx.js (particles, decals, lights).
import * as THREE from 'three';
import { MAGES, TICK_HZ } from '../../../shared/games/mages/data';
import { ELEMENT } from './figures';
import { magmaCanvas, swatch, toTex, vnoise3 } from './textures';

const TAU = Math.PI * 2;
const C = hex => new THREE.Color(hex);
/** Particle count multiplier and size multiplier per level (index 1..5). */
const LK = [0, 0.55, 0.8, 1, 1.4, 1.9];
const SZ = lv => 1 + 0.15 * (lv - 1);
const SHOTS = 48, STRIKES = 40, ROCKS = 24;

const PAL = {
  fire: { hot: C(0xfff2a8), flame: C(0xffc04a), mid: C(0xffa020), deep: C(0xd8300a), dark: C(0x7a1404), smoke: C(0x3a3230), smoke2: C(0x6a625c), ember: C(0xffb030), glow: C(0xff6a1a) },
  ice: { hot: C(0xf2fbff), mid: C(0xa8e4ff), deep: C(0x4a9ee0), dark: C(0x2a5ea8), mist: C(0xdaf0ff), mist2: C(0x9ccbe8), glow: C(0x7fd0ff) },
  lightning: { hot: C(0xffffff), mid: C(0xfff3a8), deep: C(0x6a4ad8), dark: C(0x3a2290), glow: C(0xc8b0ff), spark: C(0xfff6c8) },
  earth: { rock: C(0x8a6a4a), rock2: C(0x4a3424), dust: C(0xc0a47a), dust2: C(0x8a7254), glow: C(0xffa83c), hot: C(0xffd27a) },
  poison: { hot: C(0xd8ff7a), mid: C(0x8ee03a), deep: C(0x3f9a18), dark: C(0x1f4a0c), mist: C(0x86c84a), mist2: C(0x3e6a26), glow: C(0x8cff3a), purple: C(0x7a3a9a) },
  wind: { hot: C(0xffffff), mid: C(0xc8fff4), deep: C(0x4ab8a4), dark: C(0x2a7a6c), dust: C(0xd6cdb4), dust2: C(0x9c9078), glow: C(0x9ff7e8), leaf: C(0x6aa83a) },
};
const ASH = C(0xa49c94);
const WHITE = C(0xffffff), METAL = C(0xd8dce4), METAL2 = C(0x6a7078);

/** createElementFx(kit) → { onEvent(ev), update(dt), burning(e, p, top, dt), poisoned(e, p, top, dt), meteor(tile), rootBurst(p), dispose() } */
export function createElementFx(k) {
  const { S, A, CELL, DECAL, SOFT, FLICKER, ALIGN, emit, orbit, decal, release, flash, glow, shake, tint, column, rnd, count, enemyPos, magePos, pathPos, tilePos, surface } = k;
  const own = (list, x) => k.own(list, x);
  const mats = k.materials, geos = k.geometries;
  const V = () => new THREE.Vector3();
  const P1 = V(), P2 = V(), P3 = V(), D = V(), U = V(), W2 = V();
  /** Emits round(n) particles on average (keeps per-frame emitters steady at any frame rate). */
  const due = n => { const f = Math.floor(n); return f + (Math.random() < n - f ? 1 : 0); };

  // ================= Meshes =================
  const rockTex = own(k.textures, toTex(swatch('rock').col, { aniso: 1 }));
  const rockMat = own(mats, new THREE.MeshStandardMaterial({ map: rockTex, color: 0xb09070, roughness: 0.92 }));
  const lumpy = (geo, amp, seed) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      U.fromBufferAttribute(p, i);
      const n = vnoise3(U.x * 2.2 + seed, U.y * 2.2, U.z * 2.2, seed);
      U.multiplyScalar(1 + (n - 0.5) * amp); p.setXYZ(i, U.x, U.y, U.z);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const rockGeos = [0, 1, 2].map(s => own(geos, lumpy(new THREE.IcosahedronGeometry(1, 2), 0.55, 3 + s * 7)));
  const spikeGeo = own(geos, lumpy(new THREE.ConeGeometry(1, 1, 8, 4).translate(0, 0.5, 0), 0.3, 11));
  const fireMat = own(mats, new THREE.MeshBasicMaterial({ color: 0xffb444, toneMapped: false }));
  const fireGeo = own(geos, new THREE.SphereGeometry(1, 16, 12));
  const shardMat = own(mats, new THREE.MeshStandardMaterial({ color: 0xd2f1ff, emissive: 0x4aa8e8, emissiveIntensity: 0.9, roughness: 0.08, metalness: 0.1 }));
  const shardGeo = own(geos, new THREE.OctahedronGeometry(1, 0).scale(0.35, 0.35, 1.2));
  const dartMat = own(mats, new THREE.MeshStandardMaterial({ color: 0xb4ff5a, emissive: 0x3a9a10, emissiveIntensity: 1, roughness: 0.3 }));
  const dartGeo = own(geos, new THREE.ConeGeometry(0.28, 1, 8).rotateX(Math.PI / 2));
  const magmaTex = own(k.textures, toTex(magmaCanvas(), { aniso: 1 }));
  const basaltTex = own(k.textures, toTex(swatch('basalt').col, { aniso: 1 }));
  const meteorMat = own(mats, new THREE.MeshStandardMaterial({ map: basaltTex, color: 0x5a4a44, emissive: 0xffffff, emissiveMap: magmaTex, emissiveIntensity: 3.2, roughness: 0.8 }));
  const meteorGeo = own(geos, lumpy(new THREE.IcosahedronGeometry(1, 3), 0.4, 21));

  function meshPool(geo, mat, n) {
    const free = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.castShadow = false;
      k.root.add(m); free.push(m);
    }
    return { take: () => { const m = free.pop() || null; if (m) m.visible = true; return m; }, give: m => { m.visible = false; free.push(m); } };
  }
  const pools = {
    fire: meshPool(fireGeo, fireMat, 16), ice: meshPool(shardGeo, shardMat, 16), earth: meshPool(rockGeos[0], rockMat, 12),
    poison: meshPool(dartGeo, dartMat, 16), meteor: meshPool(meteorGeo, meteorMat, 2),
  };
  // Rocks jutting out of the ground (earthquake spikes) and rock walls
  const rocks = [];
  for (let i = 0; i < ROCKS; i++) {
    const m = new THREE.Mesh(i % 2 ? spikeGeo : rockGeos[i % 3], rockMat);
    m.visible = false; m.castShadow = k.q.shadows; m.receiveShadow = true;
    k.root.add(m);
    rocks.push({ mesh: m, on: false, spike: i % 2 === 1, t: 0, dur: 0, rise: 0.15, x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, zone: -1, ry: 0 });
  }
  function rock(spike, x, y, z, sx, sy, sz, dur, rise, zone = -1) {
    const r = rocks.find(o => !o.on && o.spike === spike);
    if (!r) return null;
    Object.assign(r, { on: true, t: 0, dur, rise, x, y, z, sx, sy, sz, zone, ry: rnd(0, TAU) });
    r.mesh.visible = true;
    r.mesh.rotation.set(rnd(-0.15, 0.15), r.ry, rnd(-0.15, 0.15));
    return r;
  }
  function stepRocks(dt) {
    for (const r of rocks) {
      if (!r.on) continue;
      r.t += dt;
      // Rise fast out of the ground, hold, then sink back in
      const up = Math.min(1, r.t / r.rise), down = Math.min(1, Math.max(0, (r.dur - r.t) / 0.3));
      const e = Math.min(1 - (1 - up) ** 3, down);
      r.mesh.position.set(r.x, r.y - (1 - e) * r.sy * 1.05, r.z);
      r.mesh.scale.set(r.sx, r.sy, r.sz);
      if (r.t >= r.dur) { r.on = false; r.mesh.visible = false; }
    }
  }

  // ================= Bolts: dense chains of solid points, with a dark rim and an additive glow =================
  // Own scratch vectors per recursion depth (forks call bolt() again while the parent's points are still needed)
  const BPS = [Array.from({ length: 24 }, V), Array.from({ length: 24 }, V)];
  const BA = [V(), V()], BB = [V(), V()], BD = V(), BU = V(), BW = V(), BS = V(), BF = V(), BT = V();
  function bolt(a, b, lv, o = {}) {
    const depth = o.depth ?? 0, BP = BPS[depth], pa = BA[depth].copy(a), pb = BB[depth].copy(b);
    const th = (o.thick ?? 1) * (0.75 + 0.12 * lv), pal = PAL.lightning, life = o.life ?? 0.16;
    const Dl = BD.subVectors(pb, pa), len = Dl.length();
    if (len < 1e-3) return;
    const n = Math.min(23, Math.max(6, Math.round(len * 7)));
    // Two directions across the bolt
    BU.set(-Dl.z, 0, Dl.x); if (BU.lengthSq() < 1e-6) BU.set(1, 0, 0); BU.normalize();
    BW.crossVectors(Dl, BU).normalize();
    const amp = len * (o.jag ?? 0.09);
    for (let i = 0; i <= n; i++) {
      const t = i / n, env = Math.sin(t * Math.PI);
      BP[i].copy(pa).addScaledVector(Dl, t).addScaledVector(BU, (Math.random() - 0.5) * 2 * amp * env).addScaledVector(BW, (Math.random() - 0.5) * 2 * amp * env);
    }
    const step = 0.014 / Math.sqrt(k.q.particles);
    // Two passes, so every core point draws over all of the glow: first a dark violet rim and a lilac glow, then the
    // white-hot core. Reads as a bolt even on bright ground.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        BS.subVectors(BP[i + 1], BP[i]);
        const segs = Math.max(1, Math.ceil(BS.length() / step));
        for (let j = 0; j < segs; j++) {
          const t = j / segs, x = BP[i].x + BS.x * t, y = BP[i].y + BS.y * t, z = BP[i].z + BS.z * t;
          if (pass === 1) { emit(S, x, y, z, 0, 0, 0, life, 0.06 * th, 0.045 * th, pal.hot, pal.spark, 1, 0, 0, CELL.EMBER); continue; }
          if (j % 3 === 0) emit(S, x, y, z, 0, 0, 0, life, 0.17 * th, 0.12 * th, pal.deep, pal.dark, 0.32, 0, 0, CELL.GLOW);
          if (j % 2 === 0) emit(S, x, y, z, 0, 0, 0, life, 0.1 * th, 0.075 * th, pal.glow, pal.deep, 0.6, 0, 0, CELL.GLOW);
          if (j % 5 === 0) emit(A, x, y, z, 0, 0, 0, life * 1.2, 0.24 * th, 0.18 * th, pal.glow, pal.deep, 0.4, 0, 0, CELL.GLOW);
        }
      }
    }
    // Forks off the main channel at higher levels
    const forks = depth ? 0 : o.forks ?? (lv >= 3 ? lv - 2 : 0);
    for (let f = 0; f < forks; f++) {
      const i = 1 + Math.floor(Math.random() * (n - 2));
      BF.copy(BP[i]);
      BT.copy(BF).addScaledVector(BD.subVectors(pb, pa), rnd(0.08, 0.2)).add(BS.set(rnd(-1, 1), rnd(-0.6, 0.2), rnd(-1, 1)).multiplyScalar(len * 0.16));
      bolt(BF, BT, lv, { thick: th * 0.45, life, depth: 1, jag: 0.14 });
    }
  }
  function sparks(p, n, speed, c0, c1, life = 0.4) {
    for (let i = 0; i < count(n); i++) {
      const a = rnd(0, TAU), s = rnd(0.3, 1) * speed;
      emit(S, p.x, p.y, p.z, Math.cos(a) * s, rnd(0.2, 1.2) * speed, Math.sin(a) * s, rnd(0.5, 1) * life, 0.045, 0.015, c0, c1, 1, -4, 1, CELL.EMBER, FLICKER);
    }
  }
  // Thunder re-strikes: a bolt from the sky flickers two or three times before it fades
  const strikes = Array.from({ length: STRIKES }, () => ({ on: false, t: 0, a: V(), id: 0, b: V(), lv: 1, left: 0 }));
  function strike(id, lv, delay) {
    const s = strikes.find(o => !o.on);
    if (!s) return;
    if (!enemyPos(id, s.b)) return;
    s.a.set(s.b.x + rnd(-0.6, 0.6), s.b.y + 4.2, s.b.z - rnd(0.6, 1.4));
    Object.assign(s, { on: true, t: -delay, id, lv, left: lv >= 4 ? 3 : 2 });
  }
  function stepStrikes(dt) {
    for (const s of strikes) {
      if (!s.on) continue;
      s.t -= dt;
      if (s.t > 0) continue;
      enemyPos(s.id, s.b);
      const first = s.left === (s.lv >= 4 ? 3 : 2);
      bolt(s.a, s.b, s.lv, { thick: 1.6 + s.lv * 0.12, life: 0.12, jag: 0.06, forks: s.lv >= 3 ? 2 : 1 });
      if (first) thunderHit(s.b, s.lv);
      s.left--; s.t = rnd(0.06, 0.12);
      if (s.left <= 0) s.on = false;
    }
  }
  function thunderHit(p, lv) {
    const pal = PAL.lightning, g = surface(p.x, p.z);
    flash(p.x, p.y + 0.6, p.z, pal.glow, 2.5 + lv * 0.7, 0.35, 4 + lv * 0.4);
    decal(DECAL.SCORCH, p.x, p.z, 0.32 + 0.04 * lv, 2.5, C(0x241a30), C(0x241a30), { fade: 0.8, alpha: 0.9 });
    decal(DECAL.SHOCK, p.x, p.z, 0.5 + lv * 0.1, 0.35, pal.mid, pal.deep);
    P1.set(p.x, g + 0.05, p.z);
    sparks(P1, 14 + lv * 6, 1.6, pal.hot, pal.mid);
    emit(A, p.x, p.y, p.z, 0, 0, 0, 0.25, 0.9 + lv * 0.15, 1.2, pal.glow, pal.deep, 0.9);
    for (let i = 0; i < count(6 + lv * 2); i++) emit(S, p.x + rnd(-0.1, 0.1), g + 0.05, p.z + rnd(-0.1, 0.1), rnd(-0.3, 0.3), rnd(0.2, 0.5), rnd(-0.3, 0.3), rnd(0.6, 1), 0.15, 0.4, C(0x4a4250), C(0x8a8490), 0.55, 0, 1.5, CELL.PUFF, SOFT);
  }

  // ================= Projectiles =================
  const shots = Array.from({ length: SHOTS }, () => ({
    on: false, kind: '', lv: 1, enemy: 0, from: V(), to: V(), p: V(), last: V(), t: 0, dur: 0, arc: 0, mesh: null, spin: V(),
    pass: Array.from({ length: 4 }, () => ({ kind: '', targets: [] })), npass: 0, extra: 0,
  }));
  const SPEED = { fire: 6, ice: 9, earth: 5, poison: 10, wind: 7, burnJump: 5, venomJump: 5, meteor: 1 };
  function launch(kind, from, enemy, lv, toPoint = null) {
    const s = shots.find(o => !o.on);
    if (!s) return null;
    s.on = true; s.kind = kind; s.lv = lv; s.enemy = enemy; s.t = 0; s.npass = 0;
    s.from.copy(from); s.p.copy(from); s.last.copy(from);
    if (toPoint) s.to.copy(toPoint); else if (!enemyPos(enemy, s.to)) s.to.copy(from);
    const dist = s.from.distanceTo(s.to);
    s.dur = Math.min(0.55, Math.max(0.1, dist / SPEED[kind]));
    s.arc = kind === 'earth' ? 0.35 + dist * 0.12 : kind === 'burnJump' || kind === 'venomJump' ? 0.35 : kind === 'fire' ? 0.08 : 0;
    s.mesh = pools[kind] ? pools[kind].take() : null;
    s.spin.set(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12));
    if (s.mesh) {
      const sz = SZ(lv);
      if (kind === 'fire') s.mesh.scale.setScalar(0.045 * sz);
      else if (kind === 'ice') s.mesh.scale.setScalar(0.1 * sz);
      else if (kind === 'earth') s.mesh.scale.setScalar(0.05 * sz);
      else if (kind === 'poison') s.mesh.scale.setScalar(0.12 * sz);
      s.mesh.position.copy(from);
    }
    return s;
  }
  /** Moves a projectile and draws its trail. */
  function fly(s, dt) {
    s.t += dt;
    if (s.enemy && s.kind !== 'meteor') enemyPos(s.enemy, s.to); // home in on a moving target
    const t = Math.min(1, s.t / s.dur);
    s.last.copy(s.p);
    s.p.lerpVectors(s.from, s.to, t);
    s.p.y += Math.sin(t * Math.PI) * s.arc;
    const lv = s.lv, lk = LK[lv], sz = SZ(lv), p = s.p;
    D.subVectors(s.p, s.last);
    if (s.mesh) {
      s.mesh.position.copy(p);
      if (s.kind === 'ice' || s.kind === 'poison') { if (D.lengthSq() > 1e-8) s.mesh.lookAt(P1.copy(p).add(D)); }
      else if (s.kind === 'earth' || s.kind === 'meteor') { s.mesh.rotation.x += s.spin.x * dt * 0.5; s.mesh.rotation.y += s.spin.y * dt * 0.5; }
      else if (s.kind === 'fire') s.mesh.scale.setScalar(0.045 * sz * (0.9 + 0.2 * Math.random()));
    }
    // Trail: emitted along the segment flown this frame so it stays continuous at any speed
    const n = due(dt * 120 * lk * k.q.particles);
    for (let i = 0; i < n; i++) {
      const f = Math.random(), x = s.last.x + D.x * f, y = s.last.y + D.y * f, z = s.last.z + D.z * f;
      switch (s.kind) {
        case 'fire': case 'burnJump': {
          const P = PAL.fire;
          // A comet tail: soft fire shrinking from yellow to deep red, with a few tongues licking up off it
          emit(S, x + rnd(-0.015, 0.015), y + rnd(-0.015, 0.015), z + rnd(-0.015, 0.015), rnd(-0.05, 0.05), rnd(0.05, 0.25), rnd(-0.05, 0.05), rnd(0.16, 0.28), 0.15 * sz, 0.04, P.flame, P.deep, 0.9, 0, 0, CELL.GLOW, FLICKER);
          if (Math.random() < 0.3) emit(S, x, y, z, rnd(-0.1, 0.1), rnd(0.3, 0.6), rnd(-0.1, 0.1), rnd(0.15, 0.25), 0.1 * sz, 0.04, P.flame, P.deep, 0.9, 0, 0, CELL.FLAME, FLICKER);
          if (Math.random() < 0.3) emit(S, x, y, z, rnd(-0.1, 0.1), rnd(0.3, 0.6), rnd(-0.1, 0.1), rnd(0.4, 0.7), 0.1 * sz, 0.24 * sz, P.smoke, P.smoke2, 0.45, 0, 0.5, CELL.PUFF, SOFT);
          if (Math.random() < 0.35) emit(A, x, y, z, rnd(-0.3, 0.3), rnd(-0.1, 0.4), rnd(-0.3, 0.3), rnd(0.3, 0.6), 0.04, 0.015, P.ember, P.deep, 1, -1, 0, CELL.EMBER, FLICKER);
          break;
        }
        case 'ice': {
          const P = PAL.ice;
          emit(S, x, y, z, rnd(-0.08, 0.08), rnd(-0.05, 0.08), rnd(-0.08, 0.08), rnd(0.25, 0.45), 0.07 * sz, 0.16 * sz, P.mist, P.mist2, 0.55, 0, 1, CELL.PUFF, SOFT);
          if (Math.random() < 0.4) emit(S, x, y, z, rnd(-0.15, 0.15), rnd(-0.3, 0), rnd(-0.15, 0.15), rnd(0.3, 0.5), 0.05, 0.03, P.hot, P.mid, 1, -1, 0, CELL.FLAKE);
          break;
        }
        case 'earth': {
          const P = PAL.earth;
          emit(S, x, y, z, rnd(-0.06, 0.06), rnd(0, 0.1), rnd(-0.06, 0.06), rnd(0.3, 0.5), 0.07 * sz, 0.18 * sz, P.dust, P.dust2, 0.5, 0, 1, CELL.PUFF, SOFT);
          if (Math.random() < 0.25) emit(S, x, y, z, rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2), rnd(0.3, 0.5), 0.03, 0.025, P.rock, P.rock2, 1, -6, 0, CELL.CHUNK);
          break;
        }
        case 'poison': case 'venomJump': {
          const P = PAL.poison;
          emit(S, x, y, z, rnd(-0.05, 0.05), rnd(-0.1, 0.05), rnd(-0.05, 0.05), rnd(0.25, 0.4), 0.06 * sz, 0.14 * sz, P.mist, P.mist2, 0.55, 0, 1, CELL.PUFF, SOFT);
          if (Math.random() < 0.4) emit(S, x, y, z, rnd(-0.1, 0.1), rnd(-0.2, 0.05), rnd(-0.1, 0.1), rnd(0.3, 0.5), 0.04, 0.03, P.hot, P.deep, 1, -3, 0, CELL.DROP);
          break;
        }
        case 'wind': {
          // Three strands spiralling around the line of flight
          const P = PAL.wind, len = D.length() || 1;
          U.set(-D.z / len, 0, D.x / len); W2.set(0, 1, 0);
          const th = (s.t + f * dt) * 30 + Math.floor(Math.random() * 3) * TAU / 3, r = 0.06 * sz;
          const ox = (U.x * Math.cos(th) + W2.x * Math.sin(th)) * r, oy = Math.sin(th) * r, oz = (U.z * Math.cos(th)) * r;
          emit(S, x + ox, y + oy, z + oz, 0, 0, 0, rnd(0.14, 0.22), 0.11 * sz, 0.07 * sz, P.hot, P.deep, 0.95, 0, 0, CELL.STREAK, ALIGN);
          break;
        }
        case 'meteor': {
          const P = PAL.fire;
          // Fire streaming off the rock: yellow at the head, orange to red down the trail; smoke only fades in at the tail
          emit(S, x + rnd(-0.06, 0.06), y + rnd(-0.06, 0.06), z + rnd(-0.06, 0.06), rnd(-0.1, 0.1), rnd(0, 0.2), rnd(-0.1, 0.1), rnd(0.25, 0.4), 0.42, 0.1, P.hot, P.deep, 1, 0, 0, CELL.GLOW, FLICKER);
          if (Math.random() < 0.6) emit(S, x + rnd(-0.12, 0.12), y + rnd(-0.12, 0.12), z + rnd(-0.12, 0.12), rnd(-0.2, 0.2), rnd(0.2, 0.6), rnd(-0.2, 0.2), rnd(0.25, 0.4), 0.3, 0.1, P.flame, P.deep, 1, 0, 0, CELL.FLAME, FLICKER);
          if (Math.random() < 0.35) emit(S, x, y, z, rnd(-0.15, 0.15), rnd(0.1, 0.3), rnd(-0.15, 0.15), rnd(0.9, 1.3), 0.25, 0.6, P.deep, P.smoke2, 0.35, 0, 0.8, CELL.PUFF, SOFT);
          emit(A, x, y, z, rnd(-0.6, 0.6), rnd(-0.2, 0.6), rnd(-0.6, 0.6), rnd(0.4, 0.8), 0.06, 0.02, P.ember, P.deep, 1, -2, 0, CELL.EMBER, FLICKER);
          break;
        }
        default: break;
      }
    }
    if (s.kind === 'fire') {
      emit(S, p.x, p.y, p.z, 0, 0, 0, 0.05, 0.17 * sz, 0.15 * sz, PAL.fire.hot, PAL.fire.flame, 0.95, 0, 0, CELL.GLOW);
      emit(A, p.x, p.y, p.z, 0, 0, 0, 0.06, 0.4 * sz, 0.3 * sz, PAL.fire.mid, PAL.fire.deep, 0.8);
      if (lv >= 4) glow(p.x, p.y, p.z, PAL.fire.glow, lv === 5 ? 1.6 : 0.9, 2.2);
    } else if (s.kind === 'meteor') {
      emit(S, p.x, p.y, p.z, 0, 0, 0, 0.06, 0.75, 0.7, PAL.fire.hot, PAL.fire.flame, 0.9, 0, 0, CELL.GLOW);
      emit(A, p.x, p.y, p.z, 0, 0, 0, 0.08, 1.4, 1.1, PAL.fire.mid, PAL.fire.deep, 1);
      glow(p.x, p.y, p.z, PAL.fire.glow, 3, 6);
    } else if (s.kind === 'ice' && lv >= 4) glow(p.x, p.y, p.z, PAL.ice.glow, lv === 5 ? 1.2 : 0.7, 2);
    else if (s.kind === 'poison' && lv >= 4) glow(p.x, p.y, p.z, PAL.poison.glow, lv === 5 ? 1 : 0.6, 2);
    if (t >= 1) { land(s); s.on = false; if (s.mesh) { pools[s.kind].give(s.mesh); s.mesh = null; } }
  }

  // ================= Impacts =================
  function burst(P, p, n, speed, life, s0, s1, c0, c1, a, grav, drag, cell, flags = 0, up = 0.6) {
    for (let i = 0; i < count(n); i++) {
      const ang = rnd(0, TAU), sp = rnd(0.3, 1) * speed;
      emit(P, p.x, p.y, p.z, Math.cos(ang) * sp, rnd(-0.2, 1) * speed * up, Math.sin(ang) * sp, rnd(0.6, 1) * life, s0, s1, c0, c1, a, grav, drag, cell, flags);
    }
  }
  function land(s) {
    const p = s.to, lv = s.lv, lk = LK[lv], sz = SZ(lv);
    switch (s.kind) {
      case 'fire': {
        const P = PAL.fire;
        burst(S, p, 12 * lk, 0.9 * sz, 0.4, 0.16 * sz, 0.05, P.flame, P.deep, 1, 1.5, 2, CELL.FLAME, FLICKER);
        burst(S, p, 4 * lk, 0.3, 0.8, 0.14 * sz, 0.32 * sz, P.smoke, P.smoke2, 0.55, 0.4, 1, CELL.PUFF, SOFT);
        burst(A, p, 10 * lk, 1.4, 0.5, 0.05, 0.02, P.ember, P.deep, 1, -3, 1, CELL.EMBER, FLICKER);
        emit(A, p.x, p.y, p.z, 0, 0, 0, 0.18, 0.4 * sz, 0.6 * sz, P.mid, P.deep, 0.9);
        if (lv >= 3) decal(DECAL.SHOCK, p.x, p.z, 0.6, 0.35, P.mid, P.deep, { alpha: 0.8 });
        if (lv >= 4) flash(p.x, p.y + 0.2, p.z, P.glow, lv === 5 ? 2.2 : 1.3, 0.25, 2.5);
        break;
      }
      case 'ice': {
        const P = PAL.ice;
        burst(S, p, 10 * lk, 1.1 * sz, 0.45, 0.09 * sz, 0.04, P.hot, P.deep, 1, -3, 1, CELL.SHARD);
        burst(S, p, 5 * lk, 0.35, 0.6, 0.12 * sz, 0.3 * sz, P.mist, P.mist2, 0.6, 0, 1.5, CELL.PUFF, SOFT);
        emit(A, p.x, p.y, p.z, 0, 0, 0, 0.2, 0.35 * sz, 0.5 * sz, P.glow, P.deep, 0.8);
        if (lv >= 4) flash(p.x, p.y + 0.2, p.z, P.glow, lv === 5 ? 1.6 : 1, 0.25, 2.5);
        break;
      }
      case 'earth': {
        const P = PAL.earth, g = surface(p.x, p.z);
        P2.set(p.x, Math.max(g + 0.05, p.y - 0.1), p.z);
        burst(S, P2, 8 * lk, 0.6 * sz, 0.8, 0.14 * sz, 0.4 * sz, P.dust, P.dust2, 0.7, 0, 2, CELL.PUFF, SOFT, 0.4);
        burst(S, P2, 9 * lk, 1.1, 0.7, 0.05 * sz, 0.04, P.rock, P.rock2, 1, -7, 0.5, CELL.CHUNK, 0, 1.6);
        if (lv >= 3) decal(DECAL.SHOCK, p.x, p.z, 0.45 + 0.05 * lv, 0.4, P.dust, P.rock2, { alpha: 0.85 });
        break;
      }
      case 'poison': {
        const P = PAL.poison;
        burst(S, p, 10 * lk, 0.8, 0.5, 0.05 * sz, 0.035, P.hot, P.deep, 1, -5, 0.5, CELL.DROP, 0, 1.4);
        burst(S, p, 4 * lk, 0.25, 0.7, 0.12 * sz, 0.3 * sz, P.mist, P.mist2, 0.55, 0, 1.5, CELL.PUFF, SOFT);
        if (lv >= 4) flash(p.x, p.y + 0.2, p.z, P.glow, lv === 5 ? 1.2 : 0.8, 0.25, 2);
        break;
      }
      case 'wind': {
        const P = PAL.wind;
        for (let i = 0; i < count(10 * lk); i++) {
          const a = rnd(0, TAU), r = rnd(0.08, 0.16) * sz;
          const j = emit(S, p.x + Math.cos(a) * r, p.y + rnd(-0.1, 0.15), p.z + Math.sin(a) * r, rnd(0.1, 0.4), rnd(0, 0.3), 0, rnd(0.25, 0.4), 0.12 * sz, 0.06, P.hot, P.deep, 0.95, 0, 0, CELL.STREAK, ALIGN);
          orbit(S, j, p.x, p.z, rnd(9, 14));
        }
        break;
      }
      case 'burnJump': {
        const P = PAL.fire;
        burst(S, p, 10, 0.7, 0.4, 0.14, 0.04, P.flame, P.deep, 1, 1.5, 2, CELL.FLAME, FLICKER);
        break;
      }
      case 'venomJump': {
        const P = PAL.poison;
        burst(S, p, 10, 0.6, 0.6, 0.06, 0.04, P.hot, P.deep, 1, -3, 1, CELL.BUBBLE);
        break;
      }
      case 'meteor': meteorImpact(p); break;
      default: break;
    }
    for (let i = 0; i < s.npass; i++) passive(s.pass[i].kind, s.pass[i].targets, s.lv, s.enemy);
  }

  // ================= Passives =================
  let lastMage = -1, lastEnemy = -1, lastShot = null, lastLv = 1;
  const killPos = V();
  function passive(kind, targets, lv, origin) {
    const sz = SZ(lv), lk = LK[lv];
    switch (kind) {
      case 'burn': {
        const P = PAL.fire;
        for (const id of targets) if (enemyPos(id, P1)) burst(S, P1, 6 * lk, 0.5, 0.45, 0.14 * sz, 0.04, P.flame, P.deep, 1, 2, 2, CELL.FLAME, FLICKER, 1.2);
        break;
      }
      case 'chill': {
        const P = PAL.ice;
        for (const id of targets) {
          if (!enemyPos(id, P1)) continue;
          for (let i = 0; i < count(8 * lk); i++) {
            const a = rnd(0, TAU), r = rnd(0.12, 0.2);
            const j = emit(S, P1.x + Math.cos(a) * r, P1.y + rnd(-0.15, 0.1), P1.z + Math.sin(a) * r, 0.05, rnd(-0.1, 0.1), 0, rnd(0.4, 0.7), 0.1, 0.2, P.mist, P.mist2, 0.6, 0, 0, CELL.PUFF, SOFT);
            orbit(S, j, P1.x, P1.z, rnd(2, 4));
          }
        }
        break;
      }
      case 'freeze': {
        const P = PAL.ice;
        for (const id of targets) {
          if (!enemyPos(id, P1)) continue;
          const g = surface(P1.x, P1.z);
          decal(DECAL.FROST, P1.x, P1.z, 0.42, 1.1, P.hot, P.mid, { fade: 0.4, alpha: 0.9 });
          P2.set(P1.x, g + 0.05, P1.z);
          // Crystals spring up around the enemy's feet
          for (let i = 0; i < count(16); i++) {
            const a = rnd(0, TAU), r = rnd(0.1, 0.25);
            emit(S, P1.x + Math.cos(a) * r, g + 0.06, P1.z + Math.sin(a) * r, Math.cos(a) * 0.2, rnd(0.6, 1.4), Math.sin(a) * 0.2, rnd(0.3, 0.5), 0.12, 0.06, P.hot, P.mid, 1, -3, 2, CELL.SHARD);
          }
          emit(A, P1.x, P1.y, P1.z, 0, 0, 0, 0.3, 0.6, 0.8, P.glow, P.deep, 0.9);
        }
        break;
      }
      case 'shatter': {
        const P = PAL.ice;
        for (const id of targets) {
          if (!enemyPos(id, P1)) continue;
          burst(S, P1, 18, 1.6, 0.5, 0.1, 0.04, P.hot, P.mid, 1, -4, 1, CELL.SHARD, 0, 1.2);
          emit(A, P1.x, P1.y, P1.z, 0, 0, 0, 0.2, 0.7, 1, WHITE, P.glow, 1, 0, 0, CELL.SPARK);
        }
        break;
      }
      case 'chain': {
        // Arcs hop from the struck enemy to each chained one in turn
        if (!enemyPos(origin, P3)) break;
        for (const id of targets) {
          if (!enemyPos(id, P2)) continue;
          bolt(P3, P2, lv, { thick: 0.95, life: 0.22, jag: 0.14, forks: lv >= 4 ? 1 : 0 });
          sparks(P2, 5 + lv * 2, 1, PAL.lightning.hot, PAL.lightning.mid, 0.3);
          P3.copy(P2);
        }
        if (lv >= 4) flash(P3.x, P3.y + 0.3, P3.z, PAL.lightning.glow, 1.4, 0.25, 3);
        break;
      }
      case 'armorBreak': {
        for (const id of targets) {
          if (!enemyPos(id, P1)) continue;
          burst(S, P1, 5 + lv * 2, 0.9, 0.5, 0.05, 0.04, METAL, METAL2, 1, -6, 0.5, CELL.CHUNK, 0, 1.4);
          burst(A, P1, 6 + lv * 2, 1.2, 0.3, 0.06, 0.02, PAL.earth.hot, PAL.earth.glow, 1, -3, 1, CELL.SPARK);
        }
        break;
      }
      case 'quake': {
        const P = PAL.earth;
        if (!enemyPos(origin, P1)) break;
        const g = surface(P1.x, P1.z);
        decal(DECAL.SHOCK, P1.x, P1.z, 0.85, 0.45, P.dust, P.rock2);
        decal(DECAL.CRACKS, P1.x, P1.z, 0.5, 1, P.glow, P.rock2, { fade: 0.5 });
        P2.set(P1.x, g + 0.04, P1.z);
        for (let i = 0; i < count(18); i++) {
          const a = rnd(0, TAU), sp = rnd(0.6, 1.4);
          emit(S, P1.x + Math.cos(a) * 0.15, g + 0.04, P1.z + Math.sin(a) * 0.15, Math.cos(a) * sp, rnd(0.05, 0.3), Math.sin(a) * sp, rnd(0.5, 0.8), 0.14, 0.34, P.dust, P.dust2, 0.7, 0, 3, CELL.PUFF, SOFT);
        }
        burst(S, P2, 10, 0.9, 0.7, 0.05, 0.04, P.rock, P.rock2, 1, -7, 0.5, CELL.CHUNK, 0, 1.8);
        break;
      }
      case 'venom': {
        const P = PAL.poison;
        for (const id of targets) if (enemyPos(id, P1)) burst(S, P1, 4 * lk, 0.4, 0.7, 0.05, 0.07, P.hot, P.mid, 1, 0.4, 1, CELL.BUBBLE);
        break;
      }
      case 'gust': {
        const P = PAL.wind;
        for (const id of targets) {
          if (!enemyPos(id, P1)) continue;
          const g = surface(P1.x, P1.z);
          for (let i = 0; i < count(18); i++) {
            const a = rnd(0, TAU), r = rnd(0.12, 0.3);
            const j = emit(S, P1.x + Math.cos(a) * r, P1.y + rnd(-0.2, 0.25), P1.z + Math.sin(a) * r, rnd(0.3, 0.8), rnd(0, 0.4), 0, rnd(0.3, 0.5), 0.16 * sz, 0.08, P.hot, P.deep, 0.95, 0, 0, CELL.STREAK, ALIGN);
            orbit(S, j, P1.x, P1.z, rnd(10, 15));
          }
          for (let i = 0; i < count(8); i++) emit(S, P1.x + rnd(-0.15, 0.15), g + 0.05, P1.z + rnd(-0.15, 0.15), rnd(-0.5, 0.5), rnd(0.1, 0.3), rnd(-0.5, 0.5), rnd(0.5, 0.8), 0.12, 0.3, P.dust, P.dust2, 0.6, 0, 2, CELL.PUFF, SOFT);
          decal(DECAL.SHOCK, P1.x, P1.z, 0.55, 0.35, P.mid, P.deep, { alpha: 0.85 });
        }
        break;
      }
      default: break;
    }
  }
  function deathPassive(ev) {
    const lv = ev.kind === 'burnSpread' ? 3 : 5; // spread needs L3+, the rest L5
    switch (ev.kind) {
      case 'burnSpread':
        for (const id of ev.targets) { const s = launch('burnJump', killPos, id, lv); if (!s) break; }
        break;
      case 'explode': {
        const P = PAL.fire, p = killPos, g = surface(p.x, p.z);
        decal(DECAL.SHOCK, p.x, p.z, 1.05, 0.45, P.mid, P.deep);
        decal(DECAL.SCORCH, p.x, p.z, 0.55, 2.5, C(0x2a1a10), C(0x2a1a10), { fade: 0.8 });
        burst(S, p, 30, 1.8, 0.5, 0.2, 0.06, P.flame, P.deep, 1, 1, 3, CELL.FLAME, FLICKER, 0.8);
        burst(S, p, 10, 0.6, 1, 0.25, 0.55, P.smoke, P.smoke2, 0.6, 0.5, 1.5, CELL.PUFF, SOFT);
        burst(A, p, 24, 2.2, 0.6, 0.06, 0.02, P.ember, P.deep, 1, -3, 1, CELL.EMBER, FLICKER);
        emit(A, p.x, p.y, p.z, 0, 0, 0, 0.25, 0.9, 1.4, P.mid, P.deep, 1);
        flash(p.x, g + 0.5, p.z, P.glow, 3, 0.35, 3.5);
        break;
      }
      case 'venomJump':
        for (const id of ev.targets) launch('venomJump', killPos, id, lv);
        break;
      default: break;
    }
  }

  // ================= Actives =================
  const pillars = Array.from({ length: 12 }, () => ({ on: false, t: 0, dur: 0, lv: 1, p: V(), delay: 0, started: false }));
  function pathOrders(target, n) {
    const tile = k.sim.map.tiles[target];
    if (!tile || tile.kind !== 'path') return [];
    const last = k.sim.map.path.length - 1, first = Math.max(0, Math.min(last - n + 1, tile.order - Math.floor((n - 1) / 2)));
    const out = [];
    for (let i = 0; i < n; i++) out.push(first + i);
    return out;
  }
  function castFlourish(ev) {
    if (!magePos(ev.mage, P1)) return;
    const c = C(ELEMENT[ev.skill].glow), lv = ev.level;
    for (let i = 0; i < count(10 + lv * 4); i++) {
      const a = rnd(0, TAU), r = rnd(0.05, 0.12);
      const j = emit(A, P1.x + Math.cos(a) * r, P1.y + rnd(-0.05, 0.05), P1.z + Math.sin(a) * r, 0.25, rnd(0.2, 0.7), 0, rnd(0.35, 0.6), 0.07, 0.02, WHITE, c, 1, 0, 0, CELL.SPARK);
      orbit(A, j, P1.x, P1.z, rnd(5, 8));
    }
    emit(A, P1.x, P1.y, P1.z, 0, 0, 0, 0.35, 0.3, 0.7 + lv * 0.08, c, c, 0.9);
    if (k.mageFeet(ev.mage, P2)) column(P2.x, P2.y, P2.z, 0.3, 0.7 + lv * 0.12, c, 0.7);
  }
  function cast(ev) {
    castFlourish(ev);
    const lv = ev.level, lk = LK[lv], sz = SZ(lv);
    switch (ev.skill) {
      case 'fire': {
        const orders = pathOrders(ev.target, MAGES.fire.active[lv - 1]);
        orders.forEach((o, i) => {
          const pl = pillars.find(x => !x.on);
          if (!pl) return;
          Object.assign(pl, { on: true, t: 0, dur: 1 + lv * 0.1, lv, delay: i * 0.09, started: false });
          pathPos(o, pl.p);
        });
        if (lv >= 4) shake(lv === 5 ? 0.55 : 0.35);
        break;
      }
      case 'ice': {
        const P = PAL.ice, r = MAGES.ice.active[lv - 1];
        if (!tilePos(ev.target, P1)) break;
        decal(DECAL.SHOCK, P1.x, P1.z, r * 1.1, 0.5, P.hot, P.deep);
        P2.set(P1.x, P1.y + 0.15, P1.z);
        burst(S, P2, 24 * lk, 2.2 * r / 1.5, 0.55, 0.12 * sz, 0.05, P.hot, P.mid, 1, -2, 2, CELL.SHARD, 0, 0.6);
        burst(S, P2, 12 * lk, 0.9, 1, 0.3, 0.7, P.mist, P.mist2, 0.6, 0, 1.5, CELL.PUFF, SOFT, 0.3);
        flash(P1.x, P1.y + 0.8, P1.z, P.glow, 2 + lv * 0.5, 0.6, 4 + r);
        if (lv === 5) { tint(P.glow, 0.12, 0.5, 0.5); shake(0.4); }
        break;
      }
      case 'lightning': {
        ev.hits.forEach((id, i) => strike(id, lv, i * 0.04));
        if (lv >= 4) shake(lv === 5 ? 0.6 : 0.4);
        if (lv === 5) tint(WHITE, 0.18, 0.18, 0, 0.02);
        if (!ev.hits.length && magePos(ev.mage, P1)) sparks(P1, 20, 1.2, PAL.lightning.hot, PAL.lightning.mid);
        break;
      }
      case 'earth': {
        const P = PAL.earth, orders = pathOrders(ev.target, MAGES.earth.active[lv - 1]);
        for (const o of orders) {
          pathPos(o, P1);
          decal(DECAL.CRACKS, P1.x, P1.z, 0.55 + lv * 0.04, 1.6 + lv * 0.1, P.glow, P.rock2, { fade: 0.7 });
          decal(DECAL.SHOCK, P1.x, P1.z, 0.7 + lv * 0.1, 0.55, P.dust, P.rock2);
          for (let i = 0; i < count(26 * lk); i++) {
            const a = rnd(0, TAU), sp = rnd(0.4, 1.3);
            emit(S, P1.x + Math.cos(a) * 0.2, P1.y + 0.05, P1.z + Math.sin(a) * 0.2, Math.cos(a) * sp, rnd(0.1, 0.6), Math.sin(a) * sp, rnd(0.7, 1.2), 0.2 * sz, 0.5 * sz, P.dust, P.dust2, 0.75, 0, 2.5, CELL.PUFF, SOFT);
          }
          P2.set(P1.x, P1.y + 0.05, P1.z);
          burst(S, P2, 20 * lk, 1.2, 0.9, 0.07 * sz, 0.05, P.rock, P.rock2, 1, -7, 0.4, CELL.CHUNK, 0, 2.2);
          // Rock spikes jut out of the ground: more and taller with level
          const n = Math.min(3, 1 + Math.floor(lv / 2));
          for (let i = 0; i < n; i++) {
            const a = rnd(0, TAU), r = i ? rnd(0.12, 0.3) : 0;
            rock(true, P1.x + Math.cos(a) * r, P1.y, P1.z + Math.sin(a) * r, 0.07 + 0.012 * lv, 0.22 + 0.05 * lv * rnd(0.8, 1.2), 0.07 + 0.012 * lv, 0.9 + 0.08 * lv, 0.1);
          }
          if (lv >= 4) flash(P1.x, P1.y + 0.3, P1.z, P.glow, lv === 5 ? 2 : 1.3, 0.5, 2.5);
        }
        shake(lv >= 4 ? (lv === 5 ? 0.75 : 0.5) : 0.2 + lv * 0.05);
        break;
      }
      case 'poison': {
        const P = PAL.poison;
        if (!tilePos(ev.target, P1)) break;
        decal(DECAL.SHOCK, P1.x, P1.z, 1.6, 0.6, P.mid, P.dark);
        P2.set(P1.x, P1.y + 0.1, P1.z);
        burst(S, P2, 20 * lk, 1.2, 1, 0.3, 0.7, P.mist, P.mist2, 0.65, 0, 1.6, CELL.PUFF, SOFT, 0.4);
        burst(S, P2, 16 * lk, 1.2, 0.7, 0.06, 0.05, P.hot, P.deep, 1, -4, 0.5, CELL.DROP, 0, 1.5);
        flash(P1.x, P1.y + 0.5, P1.z, P.glow, 1.4 + lv * 0.3, 0.6, 3.5);
        break;
      }
      case 'wind': {
        const P = PAL.wind;
        if (magePos(ev.mage, P1)) {
          for (let i = 0; i < count(30 * lk); i++) {
            const a = rnd(0, TAU), r = rnd(0.15, 0.35);
            const j = emit(S, P1.x + Math.cos(a) * r, P1.y + rnd(-0.5, 0.2), P1.z + Math.sin(a) * r, 0.4, rnd(0.2, 0.8), 0, rnd(0.4, 0.7), 0.15, 0.08, P.hot, P.deep, 0.95, 0, 0, CELL.STREAK, ALIGN);
            orbit(S, j, P1.x, P1.z, rnd(8, 12));
          }
        }
        break;
      }
      default: break;
    }
  }
  function stepPillars(dt) {
    const P = PAL.fire;
    for (const pl of pillars) {
      if (!pl.on) continue;
      pl.t += dt;
      if (pl.t < pl.delay) continue;
      const lv = pl.lv, lk = LK[lv], sz = SZ(lv), p = pl.p, age = pl.t - pl.delay;
      if (!pl.started) {
        pl.started = true;
        // Eruption: the ground splits, a ring of fire bursts out and rock flies
        decal(DECAL.SHOCK, p.x, p.z, 0.65 + 0.06 * lv, 0.4, P.mid, P.deep);
        decal(DECAL.SCORCH, p.x, p.z, 0.45 + 0.03 * lv, pl.dur + 2, C(0x2a1a10), C(0x2a1a10), { fade: 1 });
        for (let i = 0; i < count(16 * lk); i++) {
          const a = rnd(0, TAU), sp = rnd(0.8, 1.6);
          emit(S, p.x, p.y + 0.05, p.z, Math.cos(a) * sp, rnd(0.2, 0.6), Math.sin(a) * sp, rnd(0.25, 0.45), 0.18 * sz, 0.06, P.flame, P.deep, 1, 0, 3, CELL.FLAME, FLICKER);
        }
        P1.set(p.x, p.y + 0.05, p.z);
        burst(S, P1, 8 * lk, 0.9, 0.7, 0.05, 0.04, C(0x3a2a20), C(0x1a120c), 1, -7, 0.4, CELL.CHUNK, 0, 2.4);
        flash(p.x, p.y + 0.5, p.z, P.glow, 2 + lv * 0.5, 0.5, 3 + lv * 0.3);
      }
      const life = 1 - age / pl.dur, k2 = Math.min(1, age / 0.12) * Math.min(1, life * 3);
      const rad = 0.13 * sz, hv = 2 + 0.4 * lv;
      // Rising tongues of flame (solid, so they keep their colour on grass), a bright core and embers
      const nf = due(dt * 260 * lk * k.q.particles * k2);
      for (let i = 0; i < nf; i++) {
        const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * rad;
        emit(S, p.x + Math.cos(a) * r, p.y + rnd(0, 0.1), p.z + Math.sin(a) * r, -Math.cos(a) * 0.08, hv * rnd(0.7, 1.15), -Math.sin(a) * 0.08, rnd(0.35, 0.6), 0.2 * sz, 0.05, P.flame, P.deep, 0.95, 0, 0.3, CELL.FLAME, FLICKER);
      }
      if (Math.random() < dt * 12 * k2) emit(S, p.x + rnd(-0.05, 0.05), p.y + hv * 0.5 + rnd(0, 0.2), p.z + rnd(-0.05, 0.05), rnd(-0.1, 0.1), rnd(0.3, 0.6), rnd(-0.1, 0.1), rnd(0.8, 1.2), 0.2 * sz, 0.55 * sz, P.smoke2, ASH, 0.3, 0, 0.5, CELL.PUFF, SOFT);
      const ne = due(dt * 40 * lk * k2);
      for (let i = 0; i < ne; i++) emit(A, p.x + rnd(-rad, rad), p.y + rnd(0.1, 0.6), p.z + rnd(-rad, rad), rnd(-0.3, 0.3), rnd(1, 2.2), rnd(-0.3, 0.3), rnd(0.5, 0.9), 0.05, 0.02, P.ember, P.deep, 1, -0.5, 0, CELL.EMBER, FLICKER);
      if (Math.random() < dt * 20) emit(A, p.x, p.y + 0.3 * sz, p.z, 0, 0.4, 0, 0.25, 0.6 * sz, 0.4, P.mid, P.deep, 0.7 * k2);
      glow(p.x, p.y + 0.45, p.z, P.glow, (1.4 + lv * 0.35) * k2 * (0.8 + 0.2 * Math.random()), 2.6 + lv * 0.2);
      if (age >= pl.dur) pl.on = false;
    }
  }

  // ================= Zones (drawn from sim.zones every frame) =================
  const zones = new Map();
  function zoneLook(z, dt) {
    let r = zones.get(z.id);
    const secsLeft = z.t / TICK_HZ;
    if (!r) {
      r = { kind: z.kind, slot: k.claimSlot(), dec: null, dec2: null, age: 0, x: 0, z: 0, rocks: [], funnel: null, zap: 0, seen: true, lv: z.level };
      zones.set(z.id, r);
    }
    r.seen = true;
    r.age += dt;
    pathPos(z.d, P1);
    const moved = Math.hypot(P1.x - r.x, P1.z - r.z) > 0.06;
    r.x = P1.x; r.z = P1.z;
    if (r.slot >= 0) { k.slots[r.slot * 2] = r.x; k.slots[r.slot * 2 + 1] = r.z; }
    const lv = z.level, lk = LK[lv], fade = Math.min(1, secsLeft / 0.4), y = P1.y;
    switch (z.kind) {
      case 'lava': {
        const P = PAL.fire;
        if (!r.dec) r.dec = decal(DECAL.LAVA, r.x, r.z, 0.5, Infinity, P.mid, P.deep, { fade: 0.5 });
        if (Math.random() < dt * 30) emit(A, r.x + rnd(-0.35, 0.35), y + 0.05, r.z + rnd(-0.35, 0.35), rnd(-0.1, 0.1), rnd(0.4, 0.9), rnd(-0.1, 0.1), rnd(0.6, 1), 0.05, 0.02, P.ember, P.deep, fade, -0.2, 0, CELL.EMBER, FLICKER);
        if (Math.random() < dt * 14) emit(S, r.x + rnd(-0.3, 0.3), y + 0.04, r.z + rnd(-0.3, 0.3), 0, rnd(0.3, 0.6), 0, rnd(0.3, 0.5), 0.14, 0.04, P.flame, P.deep, 0.9 * fade, 0, 0, CELL.FLAME, FLICKER);
        if (Math.random() < dt * 5) emit(S, r.x + rnd(-0.3, 0.3), y + 0.3, r.z + rnd(-0.3, 0.3), 0, rnd(0.2, 0.4), 0, rnd(1, 1.5), 0.2, 0.5, P.smoke, P.smoke2, 0.35 * fade, 0, 0, CELL.PUFF, SOFT);
        glow(r.x, y + 0.35, r.z, P.glow, 1.3 * fade * (0.85 + 0.15 * Math.sin(k.time * 7 + z.id)), 2.4);
        break;
      }
      case 'blizzard': {
        const P = PAL.ice, rad = z.r;
        if (!r.dec) r.dec = decal(DECAL.FROST, r.x, r.z, rad, Infinity, P.hot, P.mid, { fade: 0.6, alpha: 0.85 });
        // Snow swirling round the eye of the storm, mist low over the ground
        const n = due(dt * 150 * lk * rad * k.q.particles);
        for (let i = 0; i < n; i++) {
          const a = rnd(0, TAU), rr = Math.sqrt(Math.random()) * rad;
          const j = emit(S, r.x + Math.cos(a) * rr, y + rnd(0.1, 1.1), r.z + Math.sin(a) * rr, rnd(-0.05, 0.05), rnd(-0.6, -0.2), 0, rnd(0.8, 1.3), rnd(0.05, 0.08), 0.05, P.hot, P.mid, 0.95 * fade, 0, 0, Math.random() < 0.6 ? CELL.FLAKE : CELL.EMBER);
          orbit(S, j, r.x, r.z, rnd(1.8, 3.2) / Math.max(0.4, rr), r.slot);
        }
        const nm = due(dt * 14 * rad);
        for (let i = 0; i < nm; i++) {
          const a = rnd(0, TAU), rr = Math.sqrt(Math.random()) * rad * 0.9;
          const j = emit(S, r.x + Math.cos(a) * rr, y + rnd(0.05, 0.35), r.z + Math.sin(a) * rr, 0, rnd(0, 0.05), 0, rnd(1.2, 1.8), 0.4, 0.75, P.mist, P.mist2, 0.42 * fade, 0, 0, CELL.PUFF, SOFT);
          orbit(S, j, r.x, r.z, rnd(0.8, 1.4), r.slot);
        }
        glow(r.x, y + 0.9, r.z, P.glow, 1.1 * fade, 2 + rad);
        break;
      }
      case 'plague': {
        const P = PAL.poison, rad = z.r;
        if (!r.dec) r.dec = decal(DECAL.PLAGUE, r.x, r.z, rad, Infinity, P.mid, P.dark, { fade: 0.6, alpha: 0.9 });
        else if (moved) k.moveDecal(r.dec, r.x, r.z);
        const n = due(dt * 22 * rad * (0.7 + 0.3 * lk));
        for (let i = 0; i < n; i++) {
          const a = rnd(0, TAU), rr = Math.sqrt(Math.random()) * rad * 0.85;
          const j = emit(S, r.x + Math.cos(a) * rr, y + rnd(0.08, 0.5), r.z + Math.sin(a) * rr, 0, rnd(0.02, 0.1), 0, rnd(1.4, 2.2), rnd(0.35, 0.5), rnd(0.7, 1), Math.random() < 0.8 ? P.mist : P.purple, P.mist2, 0.5 * fade, 0, 0, CELL.PUFF, SOFT);
          orbit(S, j, r.x, r.z, rnd(-0.5, 0.5), r.slot);
        }
        if (Math.random() < dt * 16 * rad) emit(S, r.x + rnd(-rad, rad) * 0.7, y + 0.05, r.z + rnd(-rad, rad) * 0.7, 0, rnd(0.2, 0.4), 0, rnd(0.7, 1.1), 0.05, 0.09, P.hot, P.mid, fade, 0, 0, CELL.BUBBLE);
        glow(r.x, y + 0.5, r.z, P.glow, 0.9 * fade, 2 + rad);
        break;
      }
      case 'charged': {
        const P = PAL.lightning;
        if (!r.dec) r.dec = decal(DECAL.CHARGED, r.x, r.z, 0.55, Infinity, P.mid, P.deep, { fade: 0.4 });
        r.zap -= dt;
        if (r.zap <= 0) {
          r.zap = rnd(0.08, 0.22);
          const a = rnd(0, TAU), rr = rnd(0, 0.4);
          P2.set(r.x + Math.cos(a) * rr, y + 0.03, r.z + Math.sin(a) * rr);
          P3.set(P2.x + rnd(-0.15, 0.15), y + rnd(0.2, 0.45), P2.z + rnd(-0.15, 0.15));
          bolt(P2, P3, 2, { thick: 0.55, life: 0.1, jag: 0.2, forks: 0 });
          sparks(P2, 3, 0.6, P.hot, P.mid, 0.25);
        }
        glow(r.x, y + 0.3, r.z, P.glow, (0.6 + Math.random() * 0.8) * fade, 2);
        break;
      }
      case 'wall': {
        const P = PAL.earth;
        if (!r.rocks.length) {
          // A ridge of boulders bursting up across the path
          pathPos(z.d + 0.3, P2); pathPos(z.d - 0.3, P3);
          D.subVectors(P2, P3); U.set(-D.z, 0, D.x).normalize();
          const life = secsLeft + 0.05;
          for (let i = 0; i < 5; i++) {
            const o = (i - 2) * 0.2 + rnd(-0.03, 0.03), big = i === 2 ? 1.25 : i % 2 ? 1 : 0.8;
            const rx = r.x + U.x * o, rz = r.z + U.z * o;
            const rk = rock(i % 2 === 1, rx, surface(rx, rz), rz, 0.13 * big, (i % 2 ? 0.5 : 0.24) * big, 0.13 * big, life, 0.3, z.id);
            if (rk) r.rocks.push(rk);
          }
          decal(DECAL.CRACKS, r.x, r.z, 0.7, life + 0.5, P.glow, P.rock2, { fade: 0.6 });
          decal(DECAL.SHOCK, r.x, r.z, 0.9, 0.5, P.dust, P.rock2);
          for (let i = 0; i < count(40); i++) {
            const a = rnd(0, TAU), sp = rnd(0.4, 1.3);
            emit(S, r.x + Math.cos(a) * 0.3, y + 0.05, r.z + Math.sin(a) * 0.3, Math.cos(a) * sp, rnd(0.2, 0.8), Math.sin(a) * sp, rnd(0.8, 1.3), 0.25, 0.6, P.dust, P.dust2, 0.75, 0, 2.5, CELL.PUFF, SOFT);
          }
          P1.set(r.x, y + 0.1, r.z);
          burst(S, P1, 24, 1.1, 0.9, 0.07, 0.05, P.rock, P.rock2, 1, -7, 0.4, CELL.CHUNK, 0, 2.4);
          shake(0.5);
        }
        if (secsLeft < 0.35 && Math.random() < dt * 40) emit(S, r.x + rnd(-0.4, 0.4), y + 0.05, r.z + rnd(-0.4, 0.4), rnd(-0.3, 0.3), rnd(0.1, 0.4), rnd(-0.3, 0.3), rnd(0.6, 1), 0.2, 0.45, P.dust, P.dust2, 0.6, 0, 2, CELL.PUFF, SOFT);
        break;
      }
      case 'tornado': {
        const P = PAL.wind, active = z.t <= 3 * TICK_HZ;
        if (!active) break;
        if (!r.funnel) { r.funnel = k.funnels.find(f => !f.on) || null; if (r.funnel) { r.funnel.on = true; r.funnel.mesh.visible = true; } }
        const h = 1.35, grow = Math.min(1, r.age / 0.3) * fade;
        if (r.funnel) {
          const m = r.funnel.mesh;
          m.position.set(r.x + Math.sin(k.time * 5 + z.id) * 0.04, y, r.z + Math.cos(k.time * 4 + z.id) * 0.04);
          m.scale.set(grow, h * grow, grow);
          m.rotation.set(Math.sin(k.time * 3) * 0.06, -k.time * 9, Math.cos(k.time * 2.6) * 0.06);
          r.funnel.u.alpha.value = grow; r.funnel.u.time.value = k.time;
        }
        // Streaks racing round the funnel, dust and debris whipped up at its foot
        const n = due(dt * 140 * k.q.particles * (0.8 + 0.2 * lk));
        for (let i = 0; i < n; i++) {
          const v = Math.random(), rad = (0.08 + 0.55 * Math.pow(v, 1.7)) * grow, a = rnd(0, TAU);
          const j = emit(S, r.x + Math.cos(a) * rad, y + v * h * grow, r.z + Math.sin(a) * rad, 0.03, rnd(0.3, 0.7), 0, rnd(0.25, 0.4), 0.16, 0.1, P.hot, P.mid, 0.9 * grow, 0, 0, CELL.STREAK, ALIGN);
          orbit(S, j, r.x, r.z, rnd(10, 14), r.slot);
        }
        const nd = due(dt * 40 * grow);
        for (let i = 0; i < nd; i++) {
          const a = rnd(0, TAU), rad = rnd(0.1, 0.3);
          const j = emit(S, r.x + Math.cos(a) * rad, y + rnd(0, 0.15), r.z + Math.sin(a) * rad, 0.25, rnd(0.1, 0.5), 0, rnd(0.6, 1), 0.2, 0.45, P.dust, P.dust2, 0.6 * grow, 0, 0, CELL.PUFF, SOFT);
          orbit(S, j, r.x, r.z, rnd(5, 8), r.slot);
        }
        if (Math.random() < dt * 14) {
          const a = rnd(0, TAU);
          const j = emit(S, r.x + Math.cos(a) * 0.15, y + 0.1, r.z + Math.sin(a) * 0.15, 0.3, rnd(0.8, 1.4), 0, rnd(0.7, 1.1), 0.05, 0.05, Math.random() < 0.5 ? P.leaf : PAL.earth.rock, PAL.earth.rock2, 1, -0.5, 0, Math.random() < 0.5 ? CELL.LEAF : CELL.CHUNK);
          orbit(S, j, r.x, r.z, rnd(7, 10), r.slot);
        }
        break;
      }
      default: break;
    }
  }
  function zoneGone(id, r) {
    release(r.dec); release(r.dec2);
    k.freeSlot(r.slot);
    if (r.funnel) { r.funnel.on = false; r.funnel.mesh.visible = false; }
    if (r.kind === 'tornado' && r.age > 0.1) {
      const P = PAL.wind;
      for (let i = 0; i < count(20); i++) emit(S, r.x + rnd(-0.2, 0.2), surface(r.x, r.z) + rnd(0.1, 0.9), r.z + rnd(-0.2, 0.2), rnd(-0.6, 0.6), rnd(0, 0.4), rnd(-0.6, 0.6), rnd(0.5, 0.9), 0.25, 0.6, P.dust, P.dust2, 0.6, 0, 2, CELL.PUFF, SOFT);
    }
    zones.delete(id);
  }

  // ================= Status: flames licking burning enemies, bubbles rising off poisoned ones =================
  function burning(e, p, top, dt) {
    const P = PAL.fire, lv = e.status.burnLv || 1, big = Math.max(1, top / 0.5);
    const n = due(dt * (10 + lv * 7) * big * k.q.particles);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), r = rnd(0, 0.09) * big;
      emit(S, p.x + Math.cos(a) * r, p.y + rnd(-0.35, 0.2) * top, p.z + Math.sin(a) * r, rnd(-0.05, 0.05), rnd(0.5, 0.9), rnd(-0.05, 0.05), rnd(0.25, 0.42), (0.1 + lv * 0.012) * big, 0.03, P.flame, P.deep, 0.95, 0, 0, CELL.FLAME, FLICKER);
    }
    if (Math.random() < dt * 5 * big) emit(S, p.x, p.y + top * 0.4, p.z, rnd(-0.05, 0.05), rnd(0.3, 0.5), rnd(-0.05, 0.05), rnd(0.6, 0.9), 0.08 * big, 0.22 * big, P.smoke, P.smoke2, 0.4, 0, 0.5, CELL.PUFF, SOFT);
    if (Math.random() < dt * 8) emit(A, p.x + rnd(-0.08, 0.08), p.y + rnd(0, 0.2), p.z + rnd(-0.08, 0.08), rnd(-0.2, 0.2), rnd(0.6, 1.2), rnd(-0.2, 0.2), rnd(0.4, 0.7), 0.04, 0.015, P.ember, P.deep, 1, 0, 0, CELL.EMBER, FLICKER);
  }
  function poisoned(e, p, top, dt) {
    const P = PAL.poison, st = e.status.poison.stacks, big = Math.max(1, top / 0.5);
    const n = due(dt * (2 + st * 2.2) * big * k.q.particles);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), r = rnd(0.03, 0.11) * big;
      emit(S, p.x + Math.cos(a) * r, p.y + rnd(-0.3, 0.25) * top, p.z + Math.sin(a) * r, 0, rnd(0.15, 0.35), 0, rnd(0.6, 1), rnd(0.035, 0.05) + st * 0.006, 0.07 + st * 0.008, P.hot, P.mid, 1, 0, 0.5, CELL.BUBBLE);
    }
    if (st >= 3 && Math.random() < dt * st * 1.2) emit(S, p.x + rnd(-0.1, 0.1), p.y - top * 0.2, p.z + rnd(-0.1, 0.1), 0, rnd(0.05, 0.15), 0, rnd(0.8, 1.2), 0.18 * big, 0.4 * big, P.mist, P.mist2, 0.35, 0, 0, CELL.PUFF, SOFT);
    if (Math.random() < dt * st * 0.8) emit(S, p.x + rnd(-0.08, 0.08), p.y, p.z + rnd(-0.08, 0.08), 0, -0.1, 0, rnd(0.4, 0.6), 0.04, 0.035, P.hot, P.deep, 1, -3, 0, CELL.DROP);
  }

  // ================= Meteor and Root Slam =================
  function meteor(tile) {
    if (!tilePos(tile, P1)) return;
    P2.set(P1.x - 1.5, P1.y + 4, P1.z - 1.6);
    const s = launch('meteor', P2, 0, 5, P1);
    if (!s) { meteorImpact(P1); return; }
    s.dur = 0.55;
    if (s.mesh) s.mesh.scale.setScalar(0.2);
    decal(DECAL.GLOW, P1.x, P1.z, 1.3, 0.55, PAL.fire.mid, PAL.fire.deep, { fade: 0.05, alpha: 0.6 });
  }
  function meteorImpact(p) {
    const P = PAL.fire, g = surface(p.x, p.z);
    P1.set(p.x, g + 0.1, p.z);
    decal(DECAL.SHOCK, p.x, p.z, 2, 0.6, P.hot, P.deep);
    decal(DECAL.SCORCH, p.x, p.z, 1.15, 5, C(0x1e140e), C(0x3a2410), { fade: 1.5 });
    decal(DECAL.CRACKS, p.x, p.z, 0.9, 3, P.mid, P.dark, { fade: 1.2 });
    burst(S, P1, 70, 2.4, 0.6, 0.3, 0.08, P.flame, P.deep, 1, 1, 3, CELL.FLAME, FLICKER, 0.8);
    for (let i = 0; i < count(30); i++) emit(S, p.x + rnd(-0.3, 0.3), g + rnd(0.1, 0.5), p.z + rnd(-0.3, 0.3), rnd(-0.8, 0.8), rnd(0.5, 1.5), rnd(-0.8, 0.8), rnd(1.2, 2), 0.35, 0.9, P.smoke, P.smoke2, 0.7, 0, 1.2, CELL.PUFF, SOFT);
    burst(S, P1, 40, 2.4, 1.1, 0.08, 0.06, C(0x3a2a20), C(0x140c08), 1, -8, 0.3, CELL.CHUNK, 0, 1.8);
    burst(A, P1, 60, 3, 0.8, 0.07, 0.02, P.ember, P.deep, 1, -3, 0.5, CELL.EMBER, FLICKER, 1.2);
    emit(A, p.x, g + 0.4, p.z, 0, 0, 0, 0.35, 2.4, 3.2, P.hot, P.deep, 1);
    flash(p.x, g + 1, p.z, P.glow, 7, 0.8, 7);
    tint(C(0xffb060), 0.28, 0.35, 0, 0.02);
    shake(1);
  }
  function rootBurst(p) {
    const P = PAL.earth;
    decal(DECAL.SHOCK, p.x, p.z, 0.6, 0.45, P.dust, P.rock2);
    decal(DECAL.CRACKS, p.x, p.z, 0.45, 1.5, C(0x7a5a3a), P.rock2, { fade: 0.6 });
    P1.set(p.x, p.y + 0.05, p.z);
    burst(S, P1, 16, 0.9, 0.8, 0.06, 0.05, P.rock, P.rock2, 1, -7, 0.4, CELL.CHUNK, 0, 2.2);
    burst(S, P1, 12, 0.5, 1, 0.2, 0.45, P.dust, P.dust2, 0.7, 0, 2, CELL.PUFF, SOFT, 0.5);
    for (let i = 0; i < 3; i++) {
      const a = rnd(0, TAU), r = rnd(0.18, 0.3);
      rock(true, p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r, 0.045, rnd(0.25, 0.4), 0.045, 1.2, 0.12);
    }
  }

  return {
    onEvent(ev) {
      switch (ev.type) {
        case 'attack': {
          lastMage = ev.mage; lastEnemy = ev.enemy; lastShot = null;
          const m = k.sim.mages.find(o => o.id === ev.mage);
          if (!m || !magePos(ev.mage, P1)) break;
          lastLv = m.level;
          if (m.kind === 'lightning') {
            if (enemyPos(ev.enemy, P2)) {
              bolt(P1, P2, m.level, { thick: 0.85, life: 0.16 });
              sparks(P2, 4 + m.level * 2, 0.9, PAL.lightning.hot, PAL.lightning.mid, 0.3);
              emit(A, P2.x, P2.y, P2.z, 0, 0, 0, 0.15, 0.4 + m.level * 0.05, 0.6, PAL.lightning.glow, PAL.lightning.deep, 0.8);
              if (m.level >= 4) flash(P2.x, P2.y + 0.3, P2.z, PAL.lightning.glow, m.level === 5 ? 1.6 : 1, 0.18, 3);
            }
          } else lastShot = launch(m.kind, P1, ev.enemy, m.level);
          break;
        }
        case 'passive': {
          const timed = ev.mage === lastMage && lastShot && lastShot.on;
          // Death-triggered passives burst from where the enemy died
          if (ev.kind === 'burnSpread' || ev.kind === 'explode' || ev.kind === 'venomJump') { deathPassive(ev); break; }
          if (timed && lastShot.npass < 4) {
            // Shown when the projectile lands
            const slot = lastShot.pass[lastShot.npass++];
            slot.kind = ev.kind; slot.targets.length = 0;
            for (const id of ev.targets) slot.targets.push(id);
          } else passive(ev.kind, ev.targets, ev.mage === lastMage ? lastLv : 3, ev.mage === lastMage ? lastEnemy : ev.targets[0]);
          break;
        }
        case 'cast': cast(ev); break;
        case 'kill': if (!enemyPos(ev.enemy, killPos)) killPos.set(0, -50, 0); break;
        default: break;
      }
    },
    update(dt) {
      for (const s of shots) if (s.on) fly(s, dt);
      stepStrikes(dt);
      stepPillars(dt);
      stepRocks(dt);
      for (const r of zones.values()) r.seen = false;
      for (const z of k.sim.zones) zoneLook(z, dt);
      for (const [id, r] of zones) if (!r.seen) zoneGone(id, r);
    },
    burning, poisoned, meteor, rootBurst,
    dispose() {
      for (const [id, r] of zones) zoneGone(id, r);
    },
  };
}
