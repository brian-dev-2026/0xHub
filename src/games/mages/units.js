// Mage Siege units: keeps one figure per mage and enemy in the simulation, stands them on the terrain, interpolates
// enemy movement between ticks and plays the animations: idle sway, walking gaits, wing flaps, attack recoil, casting,
// hit flashes, frost, dizzy stars, merge and placement pops, and the death dissolve. Reads the sim; never changes it.
import * as THREE from 'three';
import { ENEMIES, H, W } from '../../../shared/games/mages/data';
import { pathPointInto } from '../../../shared/games/mages/map';
import { createKit, ELEMENT, ENEMY_LOOK } from './figures';

const TAU = Math.PI * 2;
const FLASH = new THREE.Color(1, 0.9, 0.8);
const FROST = new THREE.Color(0.66, 0.86, 1);
const FROST_GLOW = new THREE.Color(0.1, 0.22, 0.34);
const EMBER = new THREE.Color(1, 0.42, 0.12);
// Health bars keep a constant size on screen (sizeAttenuation off): sizes are fractions of the view's height in tan units
const BAR_W = 0.032, BAR_H = 0.0042;
const HOP_SECS = 0.35, POP_SECS = 0.4, DISSOLVE_SECS = 0.75, FADE_SECS = 0.3;

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const easeOutBack = t => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
/** Scale over a pop: placement grows in from nothing, a merge swells and settles. */
const popScale = (kind, t) => { const k = Math.min(1, t); return kind === 'place' ? easeOutBack(k) : 1 + 0.28 * Math.sin(k * Math.PI) * (1 - k * 0.5); };
const tileWorldX = t => (t % W) + 0.5 - W / 2, tileWorldZ = t => Math.floor(t / W) + 0.5 - H / 2;

/**
 * createUnits(view, quality) → { sync(sim, alpha, dt?), onEvent(ev), staffAnchor(mageId), staffLights(), enemyAnchor(enemyId), dispose() }.
 * `view` is createScene's result (scene, toWorld, groundAt). sync() matches the figures to sim.mages/sim.enemies; `alpha`
 * (0..1) is how far rendering is between the previous tick and the current one. `dt` (seconds since the last sync)
 * is measured when omitted. staffLights() lists the level-5 staff crystals ({ mage, anchor }) for the light pool.
 */
export function createUnits(view, quality) {
  const kit = createKit(quality);
  const group = new THREE.Group();
  group.name = 'units';
  view.scene.add(group);
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mages = new Map(), enemies = new Map(), leaving = [];
  const pp = new Float64Array(6);
  let time = 0, lastNow = 0;

  function stars(y) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(kit.star);
      s.scale.setScalar(0.065); s.position.set(Math.cos(i / 3 * TAU) * 0.075, 0, Math.sin(i / 3 * TAU) * 0.075);
      g.add(s);
    }
    g.position.y = y; g.visible = false;
    return g;
  }
  const restOf = (nodes, names) => { const r = {}; for (const n of names) if (nodes[n]) r[n] = { rot: nodes[n].rotation.clone(), pos: nodes[n].position.clone() }; return r; };
  const auraMaterial = c => new THREE.MeshBasicMaterial({
    map: kit.auraTex(1), color: c, transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  /** Turns a figure material into its death-dissolve variant (noise alpha map eaten away by lowering opacity). */
  const toDissolve = m => { m.alphaMap = kit.dissolveTex; m.alphaTest = 0.5; m.transparent = false; m.needsUpdate = true; return m; };

  // ================= Program keeper =================
  // three r128 destroys a shader program when the last material using it is disposed. Enemies own material copies
  // (and dissolve variants) that come and go with every kill and wave, and the kit's prototypes are never rendered,
  // so programs would be rebuilt again and again. A hidden group keeps one compiled material of every variant alive
  // until dispose(): a prototype clone per kind, a dissolve-variant clone per enemy kind, and the overlays.
  const keeper = new THREE.Group();
  keeper.name = 'units-keeper'; keeper.visible = false;
  view.scene.add(keeper);
  const kept = new Set(), keptMats = [];
  let keepDirty = false;
  const keep = (key, build) => { if (!kept.has(key)) { kept.add(key); build(); keepDirty = true; } };
  function keepOverlays() {
    keep('overlays', () => {
      const aura = new THREE.Mesh(plane, auraMaterial(0xffffff)), charge = new THREE.Mesh(plane, kit.chargeMaterial(0xffffff));
      keptMats.push(aura.material, charge.material);
      keeper.add(aura, charge, stars(0), new THREE.Mesh(kit.iceGeo, kit.iceMat), new THREE.Sprite(kit.barBg), ...[0.1, 0.5, 1].map(v => new THREE.Sprite(kit.barFill(v))));
    });
  }
  function keepMage(kind) {
    keep('mage:' + kind, () => keeper.add(kit.mage(kind).root));
    keepOverlays();
  }
  function keepEnemy(kind) {
    keep('enemy:' + kind, () => {
      keeper.add(kit.enemy(kind).root);
      const ghost = kit.enemy(kind).root, copies = new Map();
      const dis = m => { if (!copies.has(m)) { const c = toDissolve(m.clone()); copies.set(m, c); keptMats.push(c); } return copies.get(m); };
      ghost.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(dis) : dis(o.material); });
      keeper.add(ghost);
    });
    keepOverlays();
  }

  const pose = (f, name, rx = 0, ry = 0, rz = 0, dy = 0) => {
    const n = f.nodes[name], r = f.rest[name];
    if (!n) return;
    n.rotation.set(r.rot.x + rx, r.rot.y + ry, r.rot.z + rz);
    n.position.y = r.pos.y + dy;
  };

  // ================= Mages =================
  function makeMage(m) {
    keepMage(m.kind);
    const E = ELEMENT[m.kind], { root: fig, nodes } = kit.mage(m.kind);
    const root = new THREE.Group(), turn = new THREE.Group();
    root.add(turn); turn.add(fig);
    const crystalMat = nodes.crystal.material.clone(), haloMat = nodes.halo.material.clone();
    nodes.crystal.material = crystalMat; nodes.halo.material = haloMat;
    const aura = new THREE.Mesh(plane, auraMaterial(E.glow));
    aura.position.y = 0.012; aura.renderOrder = 2;
    const charge = new THREE.Mesh(plane, kit.chargeMaterial(E.glow));
    charge.position.y = 0.016; charge.scale.setScalar(0.46); charge.renderOrder = 3;
    const dizzy = stars(0.72);
    root.add(aura, charge, dizzy);
    group.add(root);
    return {
      id: m.id, kind: m.kind, root, turn, fig, nodes, aura, charge, crystalMat, haloMat, dizzy,
      rest: restOf(nodes, ['body', 'head', 'armL', 'armR']),
      level: 0, tile: -1, from: new THREE.Vector3(), to: new THREE.Vector3(), hop: 1,
      yaw: 0, yawTo: 0, popKind: 'place', popT: 0, recoil: 0, cast: 0, flinch: 0, phase: (m.id * 0.618) % 1 * TAU,
      glow: 1, halo: 0.15,
    };
  }
  function setLevel(f, level) {
    f.level = level;
    for (let i = 0; i < 4; i++) f.nodes['band' + i].visible = i < level - 1;
    f.aura.material.map = kit.auraTex(level);
    f.aura.material.opacity = 0.42 + level * 0.1;
    // Brighter crystal per level; level 5 glows constantly (Task 13's light pool adds a point light at `tip`)
    f.glow = level === 5 ? 3.4 : 0.9 + 0.2 * (level - 1);
    f.halo = level === 5 ? 0.34 : 0.13 + 0.015 * level;
    f.haloMat.opacity = level === 5 ? 0.95 : 0.4 + 0.05 * level;
  }
  function updateMage(f, m, dt) {
    if (m.level !== f.level) {
      if (f.level) { f.popKind = 'merge'; f.popT = 0; }
      setLevel(f, m.level);
    }
    if (m.tile !== f.tile) {
      const first = f.tile < 0;
      f.tile = m.tile;
      f.to.copy(view.toWorld(m.tile));
      if (first) { f.root.position.copy(f.to); f.hop = 1; } else { f.from.copy(f.root.position); f.hop = 0; }
    }
    if (f.hop < 1) {
      f.hop = Math.min(1, f.hop + dt / HOP_SECS);
      f.root.position.lerpVectors(f.from, f.to, f.hop).y += Math.sin(f.hop * Math.PI) * 0.22;
    }
    f.popT += dt / POP_SECS;
    const grow = 1 + 0.04 * (f.level - 1);
    f.turn.scale.setScalar(grow * popScale(f.popKind, f.popT));
    f.yaw += wrapAngle(f.yawTo - f.yaw) * Math.min(1, dt * 9);
    f.turn.rotation.y = f.yaw;

    // Pose: idle sway and breathing, plus attack recoil (staff thrust), cast (arms and staff raised) and flinch
    f.recoil = Math.max(0, f.recoil - dt / 0.3);
    f.cast = Math.max(0, f.cast - dt / 0.9);
    f.flinch = Math.max(0, f.flinch - dt / 0.5);
    const stunned = m.stunT > 0, t = time + f.phase;
    const rec = Math.sin(f.recoil * Math.PI), cast = Math.sin(f.cast * Math.PI), fl = Math.sin(f.flinch * Math.PI);
    const slump = stunned ? 0.18 : 0;
    pose(f, 'body', Math.sin(t * 0.9) * 0.015 + rec * 0.05 - cast * 0.06 + slump + fl * 0.15, 0, Math.sin(t * 1.3) * 0.025 + (stunned ? Math.sin(t * 3) * 0.06 : 0));
    pose(f, 'head', -cast * 0.25 + (stunned ? 0.2 : 0), stunned ? Math.sin(t * 2.4) * 0.3 : Math.sin(t * 0.7) * 0.08, 0);
    pose(f, 'armR', Math.sin(t * 1.1) * 0.03 - rec * 0.55 - cast * 1.0, 0, cast * 0.25);
    pose(f, 'armL', Math.sin(t * 1.2 + 1) * 0.04 - rec * 0.3 - cast * 1.5, 0, -cast * 0.35);
    f.nodes.body.scale.y = 1 + Math.sin(t * 2) * 0.008;
    f.dizzy.visible = stunned;
    if (stunned) { f.dizzy.rotation.y = time * 4; f.dizzy.position.y = 0.72 * grow; }

    // Charge ring fills with the meter; when full the ring, aura and crystal pulse
    const full = m.charge >= 1, pulse = full ? 0.5 + 0.5 * Math.sin(time * 6.5) : 0;
    const u = f.charge.material.uniforms;
    u.fill.value = m.charge; u.pulse.value = pulse;
    f.crystalMat.emissiveIntensity = f.glow * (1 + pulse * 0.8) + (rec + cast) * 2.5;
    f.nodes.halo.scale.setScalar(f.halo * (1 + pulse * 0.35 + rec * 0.5 + cast * 1.2));
    f.aura.rotation.y = time * 0.25;
    f.aura.scale.setScalar(1 + pulse * 0.04);
  }
  function faceToward(f, x, z) {
    const dx = x - f.root.position.x, dz = z - f.root.position.z;
    if (dx * dx + dz * dz > 1e-6) f.yawTo = Math.atan2(dx, dz);
  }

  // ================= Enemies =================
  function makeEnemy(e) {
    keepEnemy(e.kind);
    const L = ENEMY_LOOK[e.kind], { root: fig, nodes } = kit.enemy(e.kind);
    // Own material copies, so hit flashes, frost and the dissolve tint only this figure
    const own = new Map(), mats = [];
    const copy = m => {
      if (!own.has(m)) {
        const c = m.clone();
        c.userData.base = { color: c.color.clone(), emissive: c.emissive ? c.emissive.clone().multiplyScalar(c.emissiveIntensity) : null };
        if (c.emissive) c.emissiveIntensity = 1;
        own.set(m, c); mats.push(c);
      }
      return own.get(m);
    };
    fig.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material); });
    const root = new THREE.Group(), turn = new THREE.Group();
    root.add(turn); turn.add(fig);
    const top = L.top * L.scale, def = ENEMIES[e.kind];
    let bar = null, fill = null;
    if (def.boss === null) {
      bar = new THREE.Group();
      const bg = new THREE.Sprite(kit.barBg);
      bg.scale.set(BAR_W * 1.1, BAR_H * 1.7, 1); bg.renderOrder = 20;
      fill = new THREE.Sprite(kit.barFill(1));
      fill.scale.set(BAR_W, BAR_H, 1); fill.renderOrder = 21;
      bar.add(bg, fill); bar.position.y = top + 0.1;
      root.add(bar);
    }
    const ice = new THREE.Mesh(kit.iceGeo, kit.iceMat);
    ice.scale.set(L.ice[0] * L.scale, L.ice[1] * L.scale * 0.58, L.ice[0] * L.scale);
    ice.position.y = L.hover ? 0 : L.ice[1] * L.scale * 0.5; ice.visible = false; ice.renderOrder = 4;
    const core = new THREE.Object3D();
    core.position.y = L.hover ? 0 : top * 0.55;
    const dizzy = stars(top + 0.03);
    root.add(ice, core, dizzy);
    group.add(root);
    return {
      id: e.id, kind: e.kind, L, root, turn, fig, nodes, mats, bar, fill, ice, core, dizzy,
      rest: restOf(nodes, ['body', 'head', 'armL', 'armR', 'legL', 'legR', 'legFL', 'legFR', 'legBL', 'legBR', 'tail', 'wingL', 'wingR']),
      d0: e.d, d1: e.d, tick: -1, flyT: 0, yaw: 0, first: true, grow: 0, flash: 0, cast: 0, frozen: false, tinted: false,
      phase: (e.id * 0.618) % 1 * TAU, offset: def.boss === null && e.kind !== 'sapling' ? (((e.id * 0.618) % 1) - 0.5) * 0.24 : 0,
      killed: false, fillF: 1,
    };
  }
  function tintEnemy(f) {
    const fl = f.flash, fr = f.frozen;
    if (!fl && !fr && !f.tinted) return;
    for (const m of f.mats) {
      const b = m.userData.base;
      m.color.copy(b.color);
      if (fr) m.color.lerp(FROST, 0.55);
      if (m.emissive) {
        m.emissive.copy(b.emissive);
        if (fr) m.emissive.add(FROST_GLOW);
        if (fl) m.emissive.lerp(FLASH, fl * 0.75);
      }
    }
    f.tinted = fl > 0 || fr;
  }
  function updateEnemy(f, e, sim, alpha, dt) {
    if (f.tick !== sim.tick) {
      // After k ticks in one frame, start from the position one tick before the current one (no lurch)
      const k = sim.tick - f.tick;
      f.d0 = f.first ? e.d : k > 1 ? f.d1 + (e.d - f.d1) * (k - 1) / k : f.d1;
      f.d1 = e.d; f.tick = sim.tick; f.first = false;
    }
    const d = f.d0 + (f.d1 - f.d0) * alpha, L = f.L;
    pathPointInto(sim.map, d, pp, 0);
    pathPointInto(sim.map, d + 0.3, pp, 2);
    pathPointInto(sim.map, d - 0.3, pp, 4);
    let dx = pp[2] - pp[4], dz = pp[3] - pp[5];
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) { dx /= len; dz /= len; f.yaw += wrapAngle(Math.atan2(dx, dz) - f.yaw) * (f.grow < 1 ? 1 : Math.min(1, dt * 8)); }
    const x = pp[0] - W / 2 + dz * f.offset, z = pp[1] - H / 2 - dx * f.offset;
    const ph = d * f.L.stride * TAU + f.phase, t = time + f.phase;
    // Flyers flap and bob on their own clock, which stops while they are frozen or stunned
    if (e.status.freezeT <= 0 && e.status.stunT <= 0) f.flyT += dt;
    const ft = f.flyT + f.phase;
    f.root.position.set(x, view.groundAt(x, z) + (L.hover ? L.hover + Math.sin(ft * 3) * 0.03 : 0), z);
    f.turn.rotation.y = f.yaw;
    f.grow = Math.min(1, f.grow + dt / 0.3);
    f.turn.scale.setScalar(L.scale * easeOutBack(f.grow));

    // Gait (driven by distance walked, so it stops when the enemy is stunned or frozen) and skill pose
    f.cast = Math.max(0, f.cast - dt / 0.8);
    const c = Math.sin(f.cast * Math.PI), s = Math.sin(ph), bob = Math.abs(s);
    switch (L.gait) {
      case 'biped':
        pose(f, 'legL', s * 0.55); pose(f, 'legR', -s * 0.55);
        pose(f, 'armL', -s * 0.4 - c * 1.2, 0, -c * 0.3); pose(f, 'armR', s * 0.4 - c * 1.4, 0, c * 0.3);
        pose(f, 'body', c * -0.1, 0, s * 0.05, bob * 0.012);
        pose(f, 'head', Math.sin(t * 0.8) * 0.06, Math.sin(t * 0.5) * 0.15, 0);
        break;
      case 'quad':
        pose(f, 'legFL', s * 0.6); pose(f, 'legFR', Math.sin(ph + 0.6) * 0.6);
        pose(f, 'legBL', Math.sin(ph + Math.PI) * 0.55); pose(f, 'legBR', Math.sin(ph + Math.PI + 0.6) * 0.55);
        pose(f, 'body', Math.sin(ph * 2) * 0.04, 0, 0, bob * 0.014);
        pose(f, 'head', Math.sin(ph * 2 + 1) * 0.06, 0, 0);
        pose(f, 'tail', 0.2, Math.sin(t * 5) * 0.35, 0);
        break;
      case 'robe':
        pose(f, 'body', -c * 0.08, 0, s * 0.07, bob * 0.01);
        pose(f, 'armR', s * 0.15 - c * 1.3, 0, c * 0.2); pose(f, 'armL', -s * 0.15 - c * 0.9, 0, -c * 0.3);
        pose(f, 'head', Math.sin(t * 0.9) * 0.05, Math.sin(t * 0.6) * 0.2, 0);
        break;
      case 'fly': {
        const flap = Math.sin(ft * 15) * 0.75 + 0.1;
        pose(f, 'wingR', 0, 0, flap); pose(f, 'wingL', 0, 0, -flap);
        pose(f, 'body', 0.15 + Math.sin(ft * 15 + 1) * 0.05, 0, 0, Math.sin(ft * 15 + 1.5) * 0.012);
        break;
      }
      case 'stomp':
        pose(f, 'legL', s * 0.32); pose(f, 'legR', -s * 0.32);
        pose(f, 'armL', -s * 0.18 - c * 1.6, 0, -c * 0.4); pose(f, 'armR', s * 0.18 - c * 1.6, 0, c * 0.4);
        pose(f, 'body', -c * 0.15, 0, s * 0.04, bob * 0.025);
        break;
      default:
        pose(f, 'body', 0, 0, Math.sin(t * 1.5) * 0.05);
    }

    // Status: frozen in ice and frost-tinted, stunned with stars, hit flash; health bar
    f.frozen = e.status.freezeT > 0;
    f.ice.visible = f.frozen;
    f.dizzy.visible = e.status.stunT > 0 && !f.frozen;
    if (f.dizzy.visible) f.dizzy.rotation.y = time * 4;
    f.flash = Math.max(0, f.flash - dt / 0.16);
    tintEnemy(f);
    if (f.bar) {
      const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      if (frac !== f.fillF) {
        // Sprites face the camera, so the fill is anchored to the bar's left end in screen space through its centre
        f.fillF = frac; f.fill.visible = frac > 0.002;
        if (f.fill.visible) { f.fill.scale.x = BAR_W * frac; f.fill.center.set(0.5 / frac, 0.5); f.fill.material = kit.barFill(frac); }
      }
    }
  }

  // ================= Leaving (death dissolve, leak fade, mage removal) =================
  function startLeaving(f, mode) {
    if (mode === 'dissolve') {
      for (const m of f.mats) {
        m.color.copy(m.userData.base.color); // drop any frost tint
        toDissolve(m);
      }
      f.fig.traverse(o => { o.castShadow = false; if (o.isSprite) o.visible = false; });
    }
    if (f.bar) f.bar.visible = false;
    if (f.dizzy) f.dizzy.visible = false;
    if (f.ice) f.ice.visible = false;
    if (f.charge) f.charge.visible = false;
    leaving.push({ f, mode, t: 0, scale: f.turn.scale.x, y: f.turn.position.y });
  }
  function updateLeaving(dt) {
    for (let i = leaving.length - 1; i >= 0; i--) {
      const l = leaving[i], f = l.f;
      if (l.mode === 'dissolve') {
        l.t += dt / DISSOLVE_SECS;
        const k = Math.min(1, l.t);
        for (const m of f.mats) {
          m.opacity = 1 - 0.5 * k;
          if (m.emissive) m.emissive.copy(m.userData.base.emissive).lerp(EMBER, Math.sin(Math.min(1, k * 1.5) * Math.PI) * 0.6);
        }
        f.turn.position.y = l.y - k * k * 0.06 * f.L.scale;
      } else {
        l.t += dt / FADE_SECS;
        const k = Math.min(1, l.t);
        f.turn.scale.setScalar(l.scale * (1 - k * k));
        if (f.aura) f.aura.material.opacity *= 1 - k;
      }
      if (l.t >= 1) { leaving.splice(i, 1); removeFigure(f); }
    }
  }
  function removeFigure(f) {
    group.remove(f.root);
    if (f.mats) for (const m of f.mats) m.dispose();
    if (f.crystalMat) { f.crystalMat.dispose(); f.haloMat.dispose(); f.aura.material.dispose(); f.charge.material.dispose(); }
  }

  return {
    group,
    sync(sim, alpha = 1, dt) {
      if (dt === undefined) { const now = performance.now(); dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0; lastNow = now; }
      dt = Math.max(0, dt);
      time += dt;
      const seen = new Set();
      for (const m of sim.mages) {
        let f = mages.get(m.id);
        if (!f) { f = makeMage(m); mages.set(m.id, f); }
        seen.add(m.id);
        updateMage(f, m, dt);
      }
      for (const [id, f] of mages) if (!seen.has(id)) { mages.delete(id); startLeaving(f, 'shrink'); }
      seen.clear();
      for (const e of sim.enemies) {
        let f = enemies.get(e.id);
        if (!f) { f = makeEnemy(e); enemies.set(e.id, f); }
        seen.add(e.id);
        updateEnemy(f, e, sim, alpha, dt);
      }
      for (const [id, f] of enemies) if (!seen.has(id)) { enemies.delete(id); startLeaving(f, f.killed ? 'dissolve' : 'fade'); }
      updateLeaving(dt);
      // New kinds joined the keeper: compile now (with the scene's lights, which are part of each program's key)
      if (keepDirty) { keepDirty = false; view.renderer.compile(view.scene, view.camera); }
    },
    onEvent(ev) {
      switch (ev.type) {
        case 'attack': {
          const m = mages.get(ev.mage), e = enemies.get(ev.enemy);
          if (e) e.flash = 1;
          if (m) { m.recoil = 1; if (e) faceToward(m, e.root.position.x, e.root.position.z); }
          break;
        }
        case 'cast': {
          const m = mages.get(ev.mage);
          if (m) { m.cast = 1; if (ev.target !== undefined) faceToward(m, tileWorldX(ev.target), tileWorldZ(ev.target)); }
          for (const id of ev.hits) { const e = enemies.get(id); if (e) e.flash = 1; }
          break;
        }
        case 'passive':
          for (const id of ev.targets) { const e = enemies.get(id); if (e) e.flash = Math.max(e.flash, 0.6); }
          break;
        case 'kill': case 'despawn': {
          const e = enemies.get(ev.enemy);
          if (e) e.killed = true;
          else {
            // Already gone from the sim (sync ran first): turn its fade into the dissolve
            const l = leaving.find(x => x.f.id === ev.enemy && x.f.mats && x.mode === 'fade');
            if (l) { leaving.splice(leaving.indexOf(l), 1); l.f.turn.scale.setScalar(l.scale); startLeaving(l.f, 'dissolve'); }
          }
          break;
        }
        case 'bossSkill': {
          const e = enemies.get(ev.enemy);
          if (e) e.cast = 1;
          if (ev.skill === 'rootSlam') for (const id of ev.targets) { const m = mages.get(id); if (m) m.flinch = 1; }
          break;
        }
        default: break;
      }
    },
    /** The staff crystal of a mage (projectile origin, light anchor), or null. */
    staffAnchor: id => mages.get(id)?.nodes.tip ?? null,
    /** Level-5 staff crystals, which carry a constant light from Task 13's pool. */
    staffLights() { const out = []; for (const f of mages.values()) if (f.level === 5) out.push({ mage: f.id, anchor: f.nodes.tip }); return out; },
    /** An enemy's centre of mass (impact point), or null. */
    enemyAnchor: id => enemies.get(id)?.core ?? null,
    dispose() {
      view.scene.remove(keeper);
      for (const m of keptMats) m.dispose();
      for (const f of mages.values()) removeFigure(f);
      for (const f of enemies.values()) removeFigure(f);
      for (const l of leaving) removeFigure(l.f);
      mages.clear(); enemies.clear(); leaving.length = 0;
      view.scene.remove(group);
      plane.dispose();
      kit.dispose();
    },
  };
}
