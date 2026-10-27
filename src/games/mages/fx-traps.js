// Mage Siege traps on the path: the trap models (spike plate, barricade, frost rune, blast mine), their durability
// bars, and what they do on screen: spikes thrust, splinters fly off a worn barricade, the rune flares, the mine
// blows up, and a broken trap crumbles. Built on the core kit from fx.js.
import * as THREE from 'three';
import { TRAPS } from '../../../shared/games/mages/data';
import { barCanvas, metalSwatch, plankSwatch, toTex, woodSwatch } from './textures';

const TAU = Math.PI * 2;
const C = hex => new THREE.Color(hex);
const BAR_W = 0.026, BAR_H = 0.0036;

/** createTrapFx(kit) → { onEvent(ev), update(dt), dispose() } */
export function createTrapFx(k) {
  const { S, A, CELL, DECAL, SOFT, FLICKER, emit, decal, release, flash, glow, shake, rnd, count, tilePos, pathPos } = k;
  const mats = k.materials, geos = k.geometries;
  const own = (list, x) => k.own(list, x);

  // ================= Models =================
  const wood = plankSwatch(), grain = woodSwatch(), steel = metalSwatch();
  const plankMat = own(mats, new THREE.MeshStandardMaterial({ map: own(k.textures, toTex(wood.col, { aniso: 2 })), roughness: 0.85 }));
  const stakeMat = own(mats, new THREE.MeshStandardMaterial({ map: own(k.textures, toTex(grain.col, { aniso: 2 })), color: 0xd8c0a0, roughness: 0.8 }));
  const steelMat = own(mats, new THREE.MeshStandardMaterial({ map: own(k.textures, toTex(steel.col, { aniso: 2 })), color: 0xc8ccd4, metalness: 0.85, roughness: 0.32 }));
  const ironMat = own(mats, new THREE.MeshStandardMaterial({ map: own(k.textures, toTex(steel.col, { aniso: 2 })), color: 0x4a4c52, metalness: 0.7, roughness: 0.55 }));
  const lampMat = own(mats, new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false }));
  const runeIceMat = own(mats, new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x58b8ff, emissiveIntensity: 1.2, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.92 }));
  const merge = parts => {
    // Joins simple geometries (same attributes) into one, so each trap part is one draw call
    let n = 0, idx = 0;
    for (const g of parts) { n += g.attributes.position.count; idx += g.index.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), index = [];
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
      for (const i of g.index.array) index.push(i + o);
      o += g.attributes.position.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(index);
    return own(geos, out);
  };
  const box = (w, h, d, x, y, z, ry = 0, rz = 0) => new THREE.BoxGeometry(w, h, d).rotateZ(rz).rotateY(ry).translate(x, y, z);
  // Spike plate: an iron frame with a 3 × 3 grid of steel spikes that hide in their holes until something steps on it
  const plateGeo = merge([box(0.5, 0.025, 0.5, 0, 0.012, 0), box(0.54, 0.035, 0.05, 0, 0.017, 0.25), box(0.54, 0.035, 0.05, 0, 0.017, -0.25), box(0.05, 0.035, 0.5, 0.25, 0.017, 0), box(0.05, 0.035, 0.5, -0.25, 0.017, 0)]);
  const spikesGeo = merge([-1, 0, 1].flatMap(i => [-1, 0, 1].map(j => new THREE.ConeGeometry(0.03, 0.2, 8).translate(i * 0.14, 0.1, j * 0.14))));
  // Barricade: sharpened stakes leaning out over a cross plank (built along x; turned across the path)
  const stakes = [];
  for (let i = 0; i < 5; i++) {
    const x = -0.3 + i * 0.15, h = 0.36 + (i % 2) * 0.06;
    stakes.push(new THREE.CylinderGeometry(0.025, 0.03, h, 7).translate(0, h / 2, 0).rotateX(i % 2 ? 0.45 : -0.45).translate(x, 0, 0));
    stakes.push(new THREE.ConeGeometry(0.025, 0.07, 7).translate(0, h + 0.035, 0).rotateX(i % 2 ? 0.45 : -0.45).translate(x, 0, 0));
  }
  const stakesGeo = merge(stakes);
  const barPlankGeo = merge([box(0.72, 0.06, 0.035, 0, 0.16, 0.0), box(0.72, 0.05, 0.03, 0, 0.27, 0.0, 0, 0.12)]);
  // Mine: a half-buried iron disc with a lamp and pressure prongs
  const mineGeo = merge([new THREE.CylinderGeometry(0.13, 0.15, 0.06, 20).translate(0, 0.02, 0), new THREE.CylinderGeometry(0.06, 0.08, 0.04, 14).translate(0, 0.06, 0),
    ...[0, 1, 2, 3].map(i => new THREE.CylinderGeometry(0.008, 0.008, 0.05, 5).translate(Math.cos(i * TAU / 4) * 0.1, 0.07, Math.sin(i * TAU / 4) * 0.1))]);
  const lampGeo = own(geos, new THREE.SphereGeometry(0.022, 10, 8).translate(0, 0.085, 0));
  const crystalGeo = own(geos, new THREE.OctahedronGeometry(1, 0).scale(0.05, 0.11, 0.05));

  const barTex = own(k.textures, new THREE.CanvasTexture(barCanvas()));
  const barMat = (color, opacity = 1) => own(mats, new THREE.SpriteMaterial({ map: barTex, color, opacity, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false, fog: false }));
  const barBg = barMat(0x0e1012, 0.8), barFills = [0xe0503c, 0xe8c44a, 0x7ec8ff].map(c => barMat(c));

  // Keep one hidden mesh per material in the scene, so fx's renderer.compile() builds their programs up front
  const keeper = new THREE.Group();
  keeper.visible = false;
  for (const m of [plankMat, stakeMat, steelMat, ironMat, lampMat, runeIceMat]) keeper.add(new THREE.Mesh(lampGeo, m));
  for (const m of [barBg, ...barFills]) keeper.add(new THREE.Sprite(m));
  k.root.add(keeper);

  const traps = new Map();
  const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
  const PAL = {
    wood: C(0xa07a50), wood2: C(0x5a3e24), dust: C(0xb8a07a), dust2: C(0x8a7458), steel: C(0xe0e4ea), steel2: C(0x6a7078),
    frost: C(0xd8f4ff), frost2: C(0x58b8ff), mist: C(0xdaf0ff), mist2: C(0x9ccbe8), fire: C(0xffc04a), fire2: C(0xd8300a),
    smoke: C(0x3a3230), smoke2: C(0x6a625c), ember: C(0xffb030), glow: C(0xff6a1a), red: C(0xff3020),
  };

  function makeTrap(t) {
    const g = new THREE.Group();
    const parts = {};
    const add = (name, geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = k.q.shadows; m.receiveShadow = true; g.add(m); parts[name] = m; return m; };
    tilePos(t.tile, V1);
    // Turn the model to follow the path at its tile
    const order = k.sim.map.tiles[t.tile].order;
    pathPos(order + 0.3, V2); pathPos(order - 0.3, V3);
    const yaw = Math.atan2(V2.x - V3.x, V2.z - V3.z);
    let rec = null;
    switch (t.kind) {
      case 'spike': add('plate', plateGeo, ironMat); add('spikes', spikesGeo, steelMat).position.y = -0.17; break;
      case 'barricade': add('stakes', stakesGeo, stakeMat); add('planks', barPlankGeo, plankMat); break;
      case 'mine': add('body', mineGeo, ironMat).position.y = -0.03; add('lamp', lampGeo, lampMat).position.y = -0.03; break;
      case 'frost': {
        const c = add('crystal', crystalGeo, runeIceMat);
        c.castShadow = false;
        c.position.y = 0.2;
        break;
      }
      default: break;
    }
    g.position.copy(V1);
    g.rotation.y = yaw + (t.kind === 'barricade' ? Math.PI / 2 : 0);
    k.root.add(g);
    // Durability bar (constant size on screen, like the enemies')
    const bar = new THREE.Group(), bg = new THREE.Sprite(barBg), fill = new THREE.Sprite(barFills[2]);
    bg.scale.set(BAR_W * 1.1, BAR_H * 1.7, 1); bg.renderOrder = 20; fill.scale.set(BAR_W, BAR_H, 1); fill.renderOrder = 21;
    bar.add(bg, fill); bar.position.set(V1.x, V1.y + (t.kind === 'barricade' ? 0.55 : 0.32), V1.z);
    bar.visible = t.kind !== 'mine';
    k.root.add(bar);
    rec = { id: t.id, kind: t.kind, tile: t.tile, g, parts, bar, fill, frac: 1, dur: t.dur, max: TRAPS[t.kind].durability, x: V1.x, y: V1.y, z: V1.z, t: 0, thrust: 0, flare: 0, wobble: 0, rune: null, seen: true };
    if (t.kind === 'frost') rec.rune = decal(DECAL.RUNE, V1.x, V1.z, 0.42, Infinity, PAL.frost, PAL.frost2, { fade: 0.3 });
    traps.set(t.id, rec);
    return rec;
  }
  function removeTrap(r) {
    k.root.remove(r.g); k.root.remove(r.bar);
    release(r.rune);
    traps.delete(r.id);
  }

  // ================= Effects =================
  function splinters(r, n, speed) {
    V1.set(r.x, r.y + 0.2, r.z);
    for (let i = 0; i < count(n); i++) {
      const a = rnd(0, TAU), s = rnd(0.3, 1) * speed;
      emit(S, V1.x + rnd(-0.2, 0.2), V1.y + rnd(-0.1, 0.1), V1.z + rnd(-0.2, 0.2), Math.cos(a) * s, rnd(0.5, 1.5) * speed, Math.sin(a) * s, rnd(0.5, 0.9), rnd(0.08, 0.13), 0.06, PAL.wood, PAL.wood2, 1, -6, 0.5, CELL.SHARD);
    }
  }
  function dust(r, n, size = 0.25) {
    for (let i = 0; i < count(n); i++) {
      const a = rnd(0, TAU), s = rnd(0.2, 0.6);
      emit(S, r.x + Math.cos(a) * 0.15, r.y + 0.04, r.z + Math.sin(a) * 0.15, Math.cos(a) * s, rnd(0.05, 0.3), Math.sin(a) * s, rnd(0.6, 1), size * 0.5, size, PAL.dust, PAL.dust2, 0.65, 0, 2, CELL.PUFF, SOFT);
    }
  }
  function trigger(r) {
    switch (r.kind) {
      case 'spike':
        r.thrust = 1;
        V1.set(r.x, r.y + 0.12, r.z);
        for (let i = 0; i < count(10); i++) emit(A, V1.x + rnd(-0.18, 0.18), V1.y + rnd(0, 0.1), V1.z + rnd(-0.18, 0.18), 0, rnd(0.1, 0.4), 0, rnd(0.15, 0.3), 0.08, 0.03, C(0xffffff), PAL.steel, 1, 0, 0, CELL.SPARK);
        dust(r, 6, 0.22);
        break;
      case 'frost': {
        r.flare = 1;
        decal(DECAL.FROST, r.x, r.z, 0.5, 1, PAL.frost, PAL.frost2, { fade: 0.4, alpha: 0.85 });
        for (let i = 0; i < count(18); i++) {
          const a = rnd(0, TAU), rr = rnd(0.05, 0.3);
          emit(S, r.x + Math.cos(a) * rr, r.y + 0.05, r.z + Math.sin(a) * rr, Math.cos(a) * 0.3, rnd(0.5, 1.2), Math.sin(a) * 0.3, rnd(0.3, 0.55), 0.1, 0.05, PAL.frost, PAL.frost2, 1, -2.5, 1.5, CELL.SHARD);
        }
        for (let i = 0; i < count(8); i++) {
          const a = rnd(0, TAU);
          const j = emit(S, r.x + Math.cos(a) * 0.25, r.y + rnd(0.05, 0.25), r.z + Math.sin(a) * 0.25, 0.05, rnd(0, 0.1), 0, rnd(0.6, 1), 0.2, 0.4, PAL.mist, PAL.mist2, 0.55, 0, 0, CELL.PUFF, SOFT);
          k.orbit(S, j, r.x, r.z, rnd(2, 3.5));
        }
        flash(r.x, r.y + 0.4, r.z, PAL.frost2, 1.2, 0.4, 2.2);
        break;
      }
      case 'mine': {
        const g = r.y;
        decal(DECAL.SHOCK, r.x, r.z, 1.2, 0.5, PAL.fire, PAL.fire2);
        decal(DECAL.SCORCH, r.x, r.z, 0.6, 4, C(0x1e140e), C(0x3a2410), { fade: 1.2 });
        V1.set(r.x, g + 0.08, r.z);
        for (let i = 0; i < count(45); i++) {
          const a = rnd(0, TAU), s = rnd(0.4, 2);
          emit(S, V1.x, V1.y, V1.z, Math.cos(a) * s, rnd(0.3, 2.2), Math.sin(a) * s, rnd(0.3, 0.55), 0.24, 0.07, PAL.fire, PAL.fire2, 1, 1, 3, CELL.FLAME, FLICKER);
        }
        for (let i = 0; i < count(18); i++) emit(S, V1.x + rnd(-0.2, 0.2), V1.y + rnd(0.1, 0.4), V1.z + rnd(-0.2, 0.2), rnd(-0.5, 0.5), rnd(0.4, 1.2), rnd(-0.5, 0.5), rnd(1, 1.6), 0.3, 0.75, PAL.smoke, PAL.smoke2, 0.7, 0, 1.2, CELL.PUFF, SOFT);
        for (let i = 0; i < count(26); i++) {
          const a = rnd(0, TAU), s = rnd(0.6, 2);
          emit(S, V1.x, V1.y, V1.z, Math.cos(a) * s, rnd(1, 3), Math.sin(a) * s, rnd(0.6, 1), 0.06, 0.05, i % 3 ? C(0x4a3a2a) : PAL.steel2, C(0x1a120c), 1, -8, 0.3, CELL.CHUNK);
        }
        for (let i = 0; i < count(30); i++) {
          const a = rnd(0, TAU), s = rnd(1, 2.5);
          emit(A, V1.x, V1.y, V1.z, Math.cos(a) * s, rnd(0.5, 2), Math.sin(a) * s, rnd(0.4, 0.7), 0.06, 0.02, PAL.ember, PAL.fire2, 1, -3, 0.5, CELL.EMBER, FLICKER);
        }
        emit(A, V1.x, g + 0.3, V1.z, 0, 0, 0, 0.3, 1.6, 2.2, PAL.fire, PAL.fire2, 1);
        flash(r.x, g + 0.7, r.z, PAL.glow, 5, 0.6, 5);
        shake(0.7);
        break;
      }
      default: break;
    }
  }
  function crumble(r) {
    switch (r.kind) {
      case 'spike':
        V1.set(r.x, r.y + 0.08, r.z);
        for (let i = 0; i < count(18); i++) {
          const a = rnd(0, TAU), s = rnd(0.3, 1);
          emit(S, V1.x, V1.y, V1.z, Math.cos(a) * s, rnd(0.6, 1.6), Math.sin(a) * s, rnd(0.5, 0.9), rnd(0.04, 0.07), 0.04, PAL.steel, PAL.steel2, 1, -7, 0.4, CELL.CHUNK);
        }
        dust(r, 12);
        break;
      case 'barricade':
        // The stakes burst apart: big splinters and plank chunks, then dust
        splinters(r, 40, 1.4);
        V1.set(r.x, r.y + 0.15, r.z);
        for (let i = 0; i < count(10); i++) {
          const a = rnd(0, TAU), s = rnd(0.5, 1.2);
          emit(S, V1.x, V1.y, V1.z, Math.cos(a) * s, rnd(1, 2), Math.sin(a) * s, rnd(0.7, 1), rnd(0.1, 0.14), 0.08, PAL.wood, PAL.wood2, 1, -6, 0.3, CELL.CHUNK);
        }
        dust(r, 16, 0.4);
        break;
      case 'frost':
        V1.set(r.x, r.y + 0.2, r.z);
        for (let i = 0; i < count(26); i++) {
          const a = rnd(0, TAU), s = rnd(0.4, 1.4);
          emit(S, V1.x, V1.y, V1.z, Math.cos(a) * s, rnd(0.3, 1.5), Math.sin(a) * s, rnd(0.4, 0.7), 0.09, 0.04, PAL.frost, PAL.frost2, 1, -4, 1, CELL.SHARD);
        }
        for (let i = 0; i < count(8); i++) emit(S, V1.x + rnd(-0.2, 0.2), V1.y, V1.z + rnd(-0.2, 0.2), 0, rnd(0.05, 0.2), 0, rnd(0.6, 1), 0.2, 0.45, PAL.mist, PAL.mist2, 0.55, 0, 0, CELL.PUFF, SOFT);
        emit(A, V1.x, V1.y, V1.z, 0, 0, 0, 0.25, 0.6, 0.9, PAL.frost2, PAL.frost2, 0.8);
        break;
      default: break; // a mine is gone in its own blast
    }
  }

  return {
    onEvent(ev) {
      switch (ev.type) {
        case 'trapPlace': {
          const t = k.sim.traps.find(o => o.id === ev.trap);
          if (!t || traps.has(t.id)) break;
          const r = makeTrap(t);
          r.t = 0;
          dust(r, 10);
          break;
        }
        case 'trapTrigger': {
          let r = traps.get(ev.trap);
          if (!r) { const t = k.sim.traps.find(o => o.id === ev.trap); if (t) r = makeTrap(t); }
          if (r) trigger(r);
          break;
        }
        case 'trapBreak': {
          const r = traps.get(ev.trap);
          if (r) { crumble(r); removeTrap(r); }
          break;
        }
        default: break;
      }
    },
    update(dt) {
      for (const r of traps.values()) r.seen = false;
      for (const t of k.sim.traps) {
        const r = traps.get(t.id) || makeTrap(t);
        r.seen = true;
        // Worn down (brutes, barricade holders): chips fly off with each point of durability lost
        if (r.dur - t.dur >= 1) {
          r.dur = t.dur; r.wobble = 1;
          if (r.kind === 'barricade') splinters(r, 4, 0.6);
          else if (r.kind !== 'mine') { V1.set(r.x, r.y + 0.1, r.z); for (let i = 0; i < 3; i++) emit(S, V1.x, V1.y, V1.z, rnd(-0.5, 0.5), rnd(0.5, 1), rnd(-0.5, 0.5), 0.5, 0.05, 0.04, r.kind === 'frost' ? PAL.frost : PAL.steel, PAL.steel2, 1, -6, 0, r.kind === 'frost' ? CELL.SHARD : CELL.CHUNK); }
        } else if (t.dur > r.dur) r.dur = t.dur;
        const frac = Math.max(0, Math.min(1, t.dur / r.max));
        if (frac !== r.frac) {
          r.frac = frac; r.fill.visible = frac > 0.002;
          if (r.fill.visible) { r.fill.scale.x = BAR_W * frac; r.fill.center.set(0.5 / frac, 0.5); r.fill.material = barFills[frac < 0.3 ? 0 : frac < 0.6 ? 1 : 2]; }
        }
      }
      for (const r of [...traps.values()]) if (!r.seen) removeTrap(r);
      for (const r of traps.values()) {
        r.t += dt;
        // Dropped into place
        const drop = Math.min(1, r.t / 0.25);
        r.g.position.y = r.y + (1 - drop) * (1 - drop) * 0.4;
        r.wobble = Math.max(0, r.wobble - dt / 0.25);
        r.g.rotation.z = Math.sin(r.wobble * 18) * r.wobble * 0.06;
        switch (r.kind) {
          case 'spike': {
            // Thrust up fast, hold, then sink back into the plate
            r.thrust = Math.max(0, r.thrust - dt / 0.5);
            const t = 1 - r.thrust, up = t < 0.12 ? t / 0.12 : t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
            r.parts.spikes.position.y = -0.17 + 0.17 * (r.thrust > 0 ? up : 0) + 0.015;
            break;
          }
          case 'mine': {
            const on = Math.sin(k.time * 6 + r.id) > 0.6;
            r.parts.lamp.visible = on;
            break;
          }
          case 'frost': {
            r.flare = Math.max(0, r.flare - dt / 0.6);
            const c = r.parts.crystal;
            c.position.y = 0.2 + Math.sin(k.time * 2 + r.id) * 0.03 + r.flare * 0.08;
            c.rotation.y = k.time * 1.2;
            if (r.rune) r.rune.peak = 0.75 + 0.25 * Math.sin(k.time * 2.5 + r.id) + r.flare * 0.8;
            if (Math.random() < dt * 4) emit(A, r.x + rnd(-0.25, 0.25), r.y + 0.05, r.z + rnd(-0.25, 0.25), 0, rnd(0.15, 0.35), 0, rnd(0.6, 1), 0.05, 0.02, PAL.frost, PAL.frost2, 1, 0, 0, CELL.SPARK);
            if (r.flare > 0) glow(r.x, r.y + 0.35, r.z, PAL.frost2, r.flare * 1.4, 2);
            break;
          }
          default: break;
        }
      }
    },
    dispose() { for (const r of [...traps.values()]) removeTrap(r); },
  };
}
