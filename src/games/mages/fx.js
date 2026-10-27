// Mage Siege effects: particles, ground decals, projectiles, a fixed point-light pool, screen tint and shake, driven
// by sim events and by the sim state each frame (zones, burning, poison, shields). Reads the sim; never changes it.
// The core lives here; per-element recipes are in fx-elements.js and the trap models in fx-traps.js.
//
// Two particle layers share one atlas and shader: an additive one for glows and sparks, and a normal-blended one
// with per-particle alpha for fire, smoke, snow, mist and bolts. Additive light only ever brightens, so on bright
// grass it washes out; the solid layer keeps real colours over grass, dirt and water (the lesson from Pool).
import * as THREE from 'three';
import { H, W } from '../../../shared/games/mages/data';
import { pathPointInto } from '../../../shared/games/mages/map';
import { ELEMENT, ENEMY_LOOK } from './figures';
import { createElementFx } from './fx-elements';
import { createTrapFx } from './fx-traps';
import { WATER_Y } from './terrain';
import { memo, mkCanvas } from './textures';

const TAU = Math.PI * 2;
/** Point lights owned by the effects: created once, always in the scene, unused ones at intensity 0 (ruling R40). */
const LIGHTS = 5;
const DECALS = 28, COLUMNS = 10, BUBBLES = 24, FUNNELS = 2;
const TILT_C = Math.cos(THREE.MathUtils.degToRad(55)), TILT_S = Math.sin(THREE.MathUtils.degToRad(55));

// ================= Particle atlas =================
/** Atlas cells (4 × 4, 128 px each); white or grey shapes tinted by the particle colour. */
export const CELL = { GLOW: 0, PUFF: 1, FLAME: 2, FLAKE: 3, BUBBLE: 4, SPARK: 5, LEAF: 6, CHUNK: 7, RING: 8, SHARD: 9, STREAK: 10, EMBER: 11, DROP: 12, PLUS: 13 };
const atlasCanvas = () => memo('fx-atlas', () => {
  const N = 128, c = mkCanvas(N * 4, N * 4), g = c.getContext('2d');
  let rs = 7;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const cell = (i, draw) => { g.save(); g.translate((i % 4) * N + N / 2, Math.floor(i / 4) * N + N / 2); draw(); g.restore(); };
  const radial = (x, y, r, stops) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); for (const [o, col] of stops) gr.addColorStop(o, col); return gr; };
  const disc = (x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  cell(CELL.GLOW, () => disc(0, 0, 60, radial(0, 0, 60, [[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,0.6)'], [0.55, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']])));
  cell(CELL.PUFF, () => {
    // Overlapping soft blobs, lit from above: reads as a volume of smoke, not a flat disc
    for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU, d = rnd() * 20, x = Math.cos(a) * d, y = Math.sin(a) * d * 0.8, r = 24 + rnd() * 14;
      disc(x, y, r, radial(x, y, r, [[0, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]));
    }
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, -50, 0, 50); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(110,110,110,0.55)');
    g.fillStyle = sh; g.fillRect(-64, -64, 128, 128);
  });
  cell(CELL.FLAME, () => {
    // A soft, rounded tongue: overlapping glows rising and narrowing gently, brightest low down
    for (let k = 0; k < 10; k++) {
      const y = 26 - k * 7, r = 32 * (1 - k / 15);
      disc(0, y, r, radial(0, y, r, [[0, 'rgba(255,255,255,0.42)'], [0.65, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]));
    }
    disc(0, 18, 20, radial(0, 18, 20, [[0, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]));
  });
  cell(CELL.FLAKE, () => {
    g.strokeStyle = '#ffffff'; g.lineCap = 'round'; g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 6;
    for (let i = 0; i < 6; i++) {
      g.save(); g.rotate(i * TAU / 6); g.lineWidth = 6;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -48); g.stroke(); g.lineWidth = 4;
      for (const y of [-20, -34]) { g.beginPath(); g.moveTo(0, y); g.lineTo(-11, y - 11); g.moveTo(0, y); g.lineTo(11, y - 11); g.stroke(); }
      g.restore();
    }
  });
  cell(CELL.BUBBLE, () => {
    disc(0, 0, 40, 'rgba(255,255,255,0.4)');
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, 40, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(-14, -16, 10, 6, -0.7, 0, TAU); g.fill();
  });
  cell(CELL.SPARK, () => {
    disc(0, 0, 30, radial(0, 0, 30, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]));
    g.fillStyle = '#ffffff';
    for (const r of [0, Math.PI / 2]) { g.save(); g.rotate(r); g.beginPath(); g.moveTo(0, -58); g.lineTo(7, 0); g.lineTo(0, 58); g.lineTo(-7, 0); g.closePath(); g.fill(); g.restore(); }
  });
  cell(CELL.LEAF, () => {
    g.rotate(0.5);
    const gr = g.createLinearGradient(-30, 0, 30, 0); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#9a9a9a');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, -50); g.quadraticCurveTo(38, -10, 0, 50); g.quadraticCurveTo(-38, -10, 0, -50); g.fill();
    g.strokeStyle = 'rgba(80,80,80,0.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -44); g.lineTo(0, 46); g.stroke();
  });
  cell(CELL.CHUNK, () => {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + rnd() * 0.4, r = 30 + rnd() * 16; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath();
    const gr = g.createLinearGradient(-30, -30, 30, 30); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#b4b4b4'); gr.addColorStop(1, '#5a5a5a');
    g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(40,40,40,0.9)'; g.lineWidth = 3; g.stroke();
  });
  cell(CELL.RING, () => { g.strokeStyle = '#ffffff'; g.shadowColor = '#ffffff'; g.shadowBlur = 10; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 44, 0, TAU); g.stroke(); });
  cell(CELL.SHARD, () => {
    g.beginPath(); g.moveTo(0, -60); g.lineTo(14, -6); g.lineTo(0, 60); g.lineTo(-14, -6); g.closePath();
    g.fillStyle = '#ffffff'; g.fill();
    g.fillStyle = 'rgba(150,150,150,0.8)'; g.beginPath(); g.moveTo(0, -60); g.lineTo(14, -6); g.lineTo(0, 60); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.stroke();
  });
  cell(CELL.STREAK, () => {
    const gr = g.createLinearGradient(-60, 0, 60, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 60, 9, 0, 0, TAU); g.fill();
  });
  cell(CELL.EMBER, () => disc(0, 0, 40, radial(0, 0, 40, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.95)'], [0.5, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']])));
  cell(CELL.DROP, () => {
    g.beginPath(); g.moveTo(0, -46); g.bezierCurveTo(26, -8, 30, 30, 0, 36); g.bezierCurveTo(-30, 30, -26, -8, 0, -46);
    const gr = g.createLinearGradient(-24, -30, 24, 34); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#8a8a8a');
    g.fillStyle = gr; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(-9, 4, 5, 9, 0.3, 0, TAU); g.fill();
  });
  cell(CELL.PLUS, () => {
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 8; g.fillStyle = '#ffffff';
    g.fillRect(-10, -34, 20, 68); g.fillRect(-34, -10, 68, 20);
  });
  return c;
});

const PVERT = `
attribute vec4 extra; // alpha, world size, atlas cell, rotation
uniform float scale;
varying vec3 vC; varying float vA; varying vec2 vCell; varying float vRot;
void main() {
  vC = color; vA = extra.x; vRot = extra.w;
  vCell = vec2(mod(extra.z, 4.0), floor(extra.z / 4.0));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = extra.x > 0.0 ? extra.y * scale / max(0.1, -mv.z) : 0.0;
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = `
uniform sampler2D map;
varying vec3 vC; varying float vA; varying vec2 vCell; varying float vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = clamp(vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5, 0.02, 0.98);
  vec4 t = texture2D(map, vec2((vCell.x + p.x) * 0.25, 1.0 - (vCell.y + p.y) * 0.25));
  float a = t.a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC * t.rgb, a);
}`;

// ================= Ground decals =================
/** Decal looks (the `mode` uniform). */
export const DECAL = { SHOCK: 0, LAVA: 1, FROST: 2, PLAGUE: 3, CHARGED: 4, SCORCH: 5, CRACKS: 6, RUNE: 7, GLOW: 8 };
const DVERT = `
varying vec2 vP;
void main() { vP = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DFRAG = `
uniform float mode, prog, alpha, time, seed;
uniform vec3 color, color2;
varying vec2 vP;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s / 0.9375; }
void main() {
  vec2 p = vP; float r = length(p);
  vec2 q = p * 2.2 + seed;
  float n = fbm(q);
  float edge = smoothstep(1.0, 0.72, r + (n - 0.5) * 0.35);
  vec3 col = color; float a = 0.0;
  if (mode < 0.5) {
    // Shockwave: a bright ring running out to the rim, with a faint fill behind it
    float w = 0.05 + 0.12 * (1.0 - prog);
    float ring = smoothstep(w, 0.0, abs(r - prog));
    a = (ring + step(r, prog) * 0.18 * (1.0 - r)) * (1.0 - prog * prog);
    col = mix(color2, color, ring);
  } else if (mode < 1.5) {
    // Lava: molten rock with a drifting black crust and a hot rim
    float m = fbm(q * 1.6 + vec2(time * 0.15, -time * 0.1));
    float crust = smoothstep(0.48, 0.62, fbm(q * 2.4 - vec2(time * 0.06, time * 0.04)));
    col = mix(mix(vec3(0.95, 0.25, 0.02), vec3(1.0, 0.85, 0.35), m), vec3(0.12, 0.05, 0.03), crust * 0.85);
    col += vec3(1.0, 0.5, 0.1) * smoothstep(0.55, 0.9, r) * 0.4;
    a = edge;
  } else if (mode < 2.5) {
    // Frost: pale ice with crystalline streaks radiating out
    float ang = atan(p.y, p.x);
    float streak = pow(abs(sin(ang * 7.0 + n * 6.0)), 18.0) * smoothstep(0.1, 0.9, r);
    float crack = smoothstep(0.035, 0.0, abs(fbm(q * 2.0) - 0.5));
    col = mix(color2, color, 0.55 + 0.45 * n) + vec3(streak * 0.5 + crack * 0.4);
    a = edge * (0.62 + 0.3 * n);
  } else if (mode < 3.5) {
    // Plague: a murky, slowly swirling stain
    float m = fbm(q * 1.3 + vec2(sin(time * 0.4), cos(time * 0.3)));
    col = mix(color2, color, m);
    a = edge * (0.4 + 0.35 * m);
  } else if (mode < 4.5) {
    // Charged ground: scorched earth crawling with bright arcs that re-strike several times a second
    float f = floor(time * 14.0);
    float arc = smoothstep(0.05, 0.0, abs(fbm(q * 1.4 + f * 1.37) - 0.5)) * step(0.35, h21(vec2(f, seed)));
    float arc2 = smoothstep(0.03, 0.0, abs(fbm(q * 2.3 - f * 0.71) - 0.5));
    col = mix(vec3(0.08, 0.07, 0.1), color, max(arc, arc2 * 0.8));
    a = edge * (0.5 + 0.5 * max(arc, arc2));
  } else if (mode < 5.5) {
    // Scorch: soot burnt into the ground
    col = mix(vec3(0.05, 0.035, 0.03), color, n * 0.5);
    a = edge * (0.55 + 0.3 * n);
  } else if (mode < 6.5) {
    // Cracks: dark fissures radiating from the centre, glowing while fresh
    float ang = atan(p.y, p.x) / 6.2832 + 0.5;
    float k = abs(fract(ang * 9.0 + (n - 0.5) * 0.9 + seed) - 0.5);
    float fis = smoothstep(0.06, 0.0, k) * smoothstep(1.0, 0.2, r);
    float ring = smoothstep(0.03, 0.0, abs(fbm(q * 1.5) - 0.5)) * smoothstep(0.95, 0.4, r);
    float c = max(fis, ring * 0.8);
    col = mix(color2, color, prog);
    a = max(c, edge * 0.35 * n);
    col = mix(vec3(0.16, 0.11, 0.07), col, c);
  } else if (mode < 7.5) {
    // Rune circle: two rings and ticks, slowly turning
    float ang = atan(p.y, p.x) + time * 0.4;
    float ring = smoothstep(0.05, 0.0, abs(r - 0.86)) + smoothstep(0.035, 0.0, abs(r - 0.62));
    float ticks = step(0.62, r) * step(r, 0.86) * smoothstep(0.08, 0.0, abs(fract(ang * 12.0 / 6.2832) - 0.5) - 0.4);
    float star = smoothstep(0.04, 0.0, abs(r * cos(mod(ang, 1.2566) - 0.6283) - 0.45)) * step(r, 0.62);
    a = clamp(ring + ticks + star * 0.9, 0.0, 1.0) + smoothstep(0.9, 0.0, r) * 0.25;
    col = mix(color2, color, clamp(ring + star, 0.0, 1.0));
  } else {
    // Glow: a soft coloured pool of light
    a = smoothstep(1.0, 0.0, r);
    a *= a;
  }
  gl_FragColor = vec4(col, clamp(a * alpha, 0.0, 1.0));
}`;

// ================= Tint (screen) =================
const TVERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const TFRAG = `
uniform vec3 color; uniform float alpha, frost, time, aspect;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p * vec2(1.0, 0.8));
  float vig = smoothstep(0.3, 1.3, r);
  float n = vn(vUv * vec2(aspect, 1.0) * 9.0) * 0.6 + vn(vUv * vec2(aspect, 1.0) * 31.0) * 0.4;
  float ice = frost * smoothstep(0.82, 1.25, r + (n - 0.5) * 0.45);
  float a = alpha * (0.35 + 0.65 * vig) + ice * 0.75;
  gl_FragColor = vec4(mix(color, vec3(0.92, 0.97, 1.0), clamp(ice * 1.4, 0.0, 1.0)), clamp(a, 0.0, 0.9));
}`;

// ================= Shield bubble, light column, tornado funnel =================
const BVERT = `
varying vec3 vN; varying vec3 vV; varying vec3 vO;
void main() {
  vO = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BFRAG = `
uniform vec3 color; uniform float alpha, time;
varying vec3 vN; varying vec3 vV; varying vec3 vO;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  // A hexagon-ish shimmer drifting over the surface
  vec2 h = vec2(atan(vO.z, vO.x) * 3.0, vO.y * 6.0 + time * 0.8);
  float cell = abs(fract(h.x + 0.5 * floor(h.y)) - 0.5) + abs(fract(h.y) - 0.5);
  float line = smoothstep(0.08, 0.0, abs(cell - 0.48));
  float a = 0.1 + 0.75 * pow(f, 2.2) + line * 0.25;
  gl_FragColor = vec4(mix(color, vec3(1.0), pow(f, 4.0) * 0.6), a * alpha);
}`;
const CVERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const CFRAG = `
uniform vec3 color; uniform float alpha, time;
varying vec2 vUv;
void main() {
  // A band of light rising from the ground: bright at the foot, fading upward, with drifting streaks
  float s = 0.6 + 0.4 * sin(vUv.x * 6.2832 * 6.0 + time * 3.0 + vUv.y * 4.0);
  float a = pow(1.0 - vUv.y, 1.6) * s;
  gl_FragColor = vec4(mix(color, vec3(1.0), (1.0 - vUv.y) * 0.35), a * alpha);
}`;
const FFRAG = `
uniform vec3 color; uniform float alpha, time;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  // Spiralling bands of dust and air: noise sheared around the funnel, scrolling up and around
  vec2 q = vec2(vUv.x * 5.0 + vUv.y * 2.5 - time * 2.4, vUv.y * 3.0 - time * 1.1);
  float n = vn(q * vec2(1.0, 2.0)) * 0.65 + vn(q * vec2(2.0, 5.0)) * 0.35;
  float band = smoothstep(0.35, 0.8, n);
  float fade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  gl_FragColor = vec4(mix(color * 0.62, color, band), (0.3 + 0.65 * band) * fade * alpha);
}`;

/**
 * createFx(view, units, quality) → { onEvent(ev, sim), update(dt, sim), shakeOffset, dispose() }.
 * `view` is createScene's result, `units` createUnits' (anchors for staffs and enemies). Feed every sim event to
 * onEvent as step() returns it (before units.sync, so killed enemies still have a figure to read), and call
 * update(dt, sim) once per frame after units.sync. `shakeOffset` is the camera nudge for this frame.
 */
export function createFx(view, units, quality) {
  const q = quality, scene = view.scene, renderer = view.renderer;
  const root = new THREE.Group();
  root.name = 'fx';
  scene.add(root);
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const materials = [], geometries = [], textures = [];
  const own = (list, x) => { list.push(x); return x; };
  let time = 0, sim = null;

  // ================= Particles =================
  const atlas = own(textures, new THREE.CanvasTexture(atlasCanvas()));
  const uScale = { value: 400 };
  const slots = new Float32Array(32 * 2); // moving centres particles can orbit (zones claim one each)
  const slotUsed = new Uint8Array(32);
  function makeSystem(N, additive) {
    const geo = own(geometries, new THREE.BufferGeometry());
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), ext = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -99;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('extra', new THREE.BufferAttribute(ext, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = own(materials, new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas }, scale: uScale }, vertexShader: PVERT, fragmentShader: PFRAG,
      vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = additive ? 12 : 11;
    root.add(pts);
    return {
      N, geo, pos, col, ext, next: 0, live: 0,
      vel: new Float32Array(N * 3), c0: new Float32Array(N * 3), c1: new Float32Array(N * 3),
      life: new Float32Array(N), max: new Float32Array(N), s0: new Float32Array(N), s1: new Float32Array(N), a0: new Float32Array(N),
      grav: new Float32Array(N), drag: new Float32Array(N), spin: new Float32Array(N), cell: new Float32Array(N),
      orbW: new Float32Array(N), orbA: new Float32Array(N), orbR: new Float32Array(N), orbX: new Float32Array(N), orbZ: new Float32Array(N),
      slot: new Int8Array(N).fill(-1), flags: new Uint8Array(N),
    };
  }
  const S = makeSystem(Math.round(6000 * q.particles), false);
  const A = makeSystem(Math.round(3000 * q.particles), true);
  /** Particle flags: fade in slowly (mist), flicker (fire, sparks), turn to face the direction of travel (streaks). */
  const SOFT = 1, FLICKER = 2, ALIGN = 4;

  /** Emits one particle; c0 → c1 over its life, size s0 → s1, peak alpha a. Returns its index (for orbit()). */
  function emit(P, x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a, grav = 0, drag = 0, cell = CELL.GLOW, flags = 0) {
    // Take the next free slot (a short probe), so a burst of short-lived sparks does not overwrite long-lived snow,
    // smoke or clouds; only a full ring recycles a live particle
    let i = P.next;
    for (let n = 0; n < 48 && P.life[i] > 0; n++) i = (i + 1) % P.N;
    const k = i * 3;
    P.next = (i + 1) % P.N;
    if (P.life[i] <= 0) P.live++;
    P.pos[k] = x; P.pos[k + 1] = y; P.pos[k + 2] = z;
    P.vel[k] = vx; P.vel[k + 1] = vy; P.vel[k + 2] = vz;
    P.c0[k] = c0.r; P.c0[k + 1] = c0.g; P.c0[k + 2] = c0.b;
    P.c1[k] = c1.r; P.c1[k + 1] = c1.g; P.c1[k + 2] = c1.b;
    P.life[i] = P.max[i] = life; P.s0[i] = s0; P.s1[i] = s1; P.a0[i] = a;
    P.grav[i] = grav; P.drag[i] = drag; P.cell[i] = cell; P.flags[i] = flags;
    P.spin[i] = cell === CELL.FLAME || cell === CELL.STREAK ? 0 : (Math.random() - 0.5) * 6;
    P.ext[i * 4 + 3] = cell === CELL.FLAME ? (Math.random() - 0.5) * 0.5 : Math.random() * TAU;
    P.orbW[i] = 0; P.slot[i] = -1;
    return i;
  }
  /** Makes particle i circle (cx, cz) (or a moving slot) at w rad/s; its x velocity becomes the outward speed. */
  function orbit(P, i, cx, cz, w, slot = -1) {
    const k = i * 3, dx = P.pos[k] - cx, dz = P.pos[k + 2] - cz;
    P.orbW[i] = w; P.orbA[i] = Math.atan2(dz, dx); P.orbR[i] = Math.hypot(dx, dz); P.orbX[i] = cx; P.orbZ[i] = cz; P.slot[i] = slot;
  }
  function stepSystem(P, dt) {
    if (P.live <= 0) return;
    let live = 0;
    const { pos, vel, col, ext, c0, c1, life, max } = P;
    for (let i = 0; i < P.N; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const k = i * 3, e = i * 4;
      if (life[i] <= 0) { pos[k + 1] = -99; ext[e] = 0; continue; }
      live++;
      const t = 1 - life[i] / max[i];
      const ox = pos[k], oy = pos[k + 1], oz = pos[k + 2];
      if (P.orbW[i] !== 0) {
        P.orbA[i] += P.orbW[i] * dt;
        P.orbR[i] = Math.max(0, P.orbR[i] + vel[k] * dt);
        vel[k + 1] += P.grav[i] * dt;
        const s = P.slot[i], cx = s >= 0 ? slots[s * 2] : P.orbX[i], cz = s >= 0 ? slots[s * 2 + 1] : P.orbZ[i];
        pos[k] = cx + Math.cos(P.orbA[i]) * P.orbR[i]; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] = cz + Math.sin(P.orbA[i]) * P.orbR[i];
      } else {
        vel[k + 1] += P.grav[i] * dt;
        const f = Math.max(0, 1 - P.drag[i] * dt);
        vel[k] *= f; vel[k + 1] *= f; vel[k + 2] *= f;
        pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
      }
      col[k] = c0[k] + (c1[k] - c0[k]) * t; col[k + 1] = c0[k + 1] + (c1[k + 1] - c0[k + 1]) * t; col[k + 2] = c0[k + 2] + (c1[k + 2] - c0[k + 2]) * t;
      const fl = P.flags[i];
      let a = P.a0[i] * Math.min(1, t * (fl & SOFT ? 3 : 14)) * Math.min(1, (1 - t) * 2.6);
      if (fl & FLICKER) a *= 0.65 + 0.35 * Math.sin(time * 31 + i * 1.7);
      ext[e] = a;
      ext[e + 1] = P.s0[i] + (P.s1[i] - P.s0[i]) * t;
      ext[e + 2] = P.cell[i];
      if (fl & ALIGN) {
        // Screen direction of this frame's motion under the tilted camera (right = +x, up = +y and −z)
        const sx = pos[k] - ox, sy = (pos[k + 1] - oy) * TILT_C - (pos[k + 2] - oz) * TILT_S;
        if (sx * sx + sy * sy > 1e-10) ext[e + 3] = Math.atan2(sy, sx);
      } else ext[e + 3] += P.spin[i] * dt;
    }
    P.live = live;
    const g = P.geo.attributes;
    g.position.needsUpdate = true; g.color.needsUpdate = true; g.extra.needsUpdate = true;
  }

  // ================= Decals (draped over the ground) =================
  const DSEG = 20;
  const decalProto = own(materials, new THREE.ShaderMaterial({
    uniforms: {
      mode: { value: 0 }, prog: { value: 0 }, alpha: { value: 1 }, time: { value: 0 }, seed: { value: 0 },
      color: { value: new THREE.Color() }, color2: { value: new THREE.Color() },
    },
    vertexShader: DVERT, fragmentShader: DFRAG, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }));
  const decals = [];
  for (let i = 0; i < DECALS; i++) {
    const geo = own(geometries, new THREE.PlaneGeometry(2, 2, DSEG, DSEG));
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const mat = own(materials, decalProto.clone());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 4;
    root.add(mesh);
    decals.push({ mesh, mat, u: mat.uniforms, on: false, t: 0, dur: 0, x: 0, z: 0, r: 0, fade: 0.3, peak: 1, ring: false, held: false, grow: 0 });
  }
  const surface = (x, z) => Math.max(view.groundAt(x, z), WATER_Y);
  function drape(d, x, z, r, lift = 0.03) {
    const p = d.mesh.geometry.attributes.position, n = DSEG + 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const lx = (i / DSEG) * 2 - 1, lz = (j / DSEG) * 2 - 1, wx = x + lx * r, wz = z + lz * r;
      p.setXYZ(j * n + i, wx, surface(wx, wz) + lift, wz);
    }
    p.needsUpdate = true;
    d.x = x; d.z = z; d.r = r;
  }
  /**
   * Shows a decal of `mode` centred at world (x, z) with radius r for `dur` seconds (Infinity: until released).
   * Rings (SHOCK) run their `prog` 0 → 1 over the duration; others fade in, hold and fade out over `fade` seconds.
   */
  function decal(mode, x, z, r, dur, color, color2 = color, opts = {}) {
    // A free decal, else the timed one nearest its end (held ones, like zones, are never taken)
    let d = decals.find(o => !o.on);
    if (!d) for (const o of decals) if (!o.held && (!d || o.t / o.dur > d.t / d.dur)) d = o;
    if (!d) return null;
    d.on = true; d.t = 0; d.dur = dur; d.fade = opts.fade ?? 0.35; d.peak = opts.alpha ?? 1; d.ring = mode === DECAL.SHOCK; d.held = dur === Infinity; d.grow = opts.grow ?? 0;
    const u = d.u;
    u.mode.value = mode; u.prog.value = 0; u.alpha.value = 0; u.seed.value = Math.random() * 50;
    u.color.value.copy(color); u.color2.value.copy(color2);
    drape(d, x, z, r, opts.lift);
    d.mesh.visible = true;
    return d;
  }
  /** Moves a decal to a new centre, keeping its radius (a drifting cloud). */
  function moveDecal(d, x, z) { if (d && d.on) drape(d, x, z, d.r); }
  /** Ends a held decal (it fades out). */
  function release(d) { if (d && d.on) { d.held = false; d.dur = d.t + d.fade; } }
  function stepDecals(dt) {
    for (const d of decals) {
      if (!d.on) continue;
      d.t += dt;
      const u = d.u;
      u.time.value = time;
      if (d.ring) { const k = Math.min(1, d.t / d.dur); u.prog.value = 1 - (1 - k) * (1 - k); u.alpha.value = d.peak; }
      else {
        const fin = Math.min(1, d.t / Math.min(0.2, d.fade)), fout = d.held ? 1 : Math.min(1, Math.max(0, (d.dur - d.t) / d.fade));
        u.alpha.value = d.peak * fin * fout;
        if (d.grow) u.prog.value = Math.min(1, d.t / d.grow);
      }
      if (!d.held && d.t >= d.dur) { d.on = false; d.mesh.visible = false; }
    }
  }

  // ================= Light pool =================
  const lights = [];
  for (let i = 0; i < LIGHTS; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 4, 2);
    l.position.set(0, -50, 0);
    root.add(l); lights.push(l);
  }
  // Light requests: timed flashes, plus per-frame glows from zones and projectiles; the brightest win the pool
  const flashes = Array.from({ length: 24 }, () => ({ on: false, x: 0, y: 0, z: 0, color: new THREE.Color(), peak: 0, t: 0, dur: 0, dist: 3, flicker: false }));
  const reqs = Array.from({ length: 48 }, () => ({ x: 0, y: 0, z: 0, color: new THREE.Color(), i: 0, dist: 3 }));
  let nreq = 0;
  /** A point-light flash at (x, y, z) peaking at `intensity` and fading over `dur` seconds. */
  function flash(x, y, z, color, intensity, dur, dist = 3.5, flicker = false) {
    let f = flashes.find(o => !o.on);
    if (!f) f = flashes.reduce((a, b) => (a.peak * (1 - a.t / a.dur) < b.peak * (1 - b.t / b.dur) ? a : b));
    f.on = true; f.x = x; f.y = y; f.z = z; f.color.copy(color); f.peak = intensity; f.t = 0; f.dur = dur; f.dist = dist; f.flicker = flicker;
  }
  /** Asks for a light at (x, y, z) this frame only (zones and projectiles call it every frame). */
  function glow(x, y, z, color, intensity, dist = 3) {
    if (nreq >= reqs.length) return;
    const r = reqs[nreq++];
    r.x = x; r.y = y; r.z = z; r.color.copy(color); r.i = intensity; r.dist = dist;
  }
  const staffColor = new THREE.Color(), camPos = new THREE.Vector3(), tmpV = new THREE.Vector3();
  function stepLights(dt) {
    for (const f of flashes) {
      if (!f.on) continue;
      f.t += dt;
      if (f.t >= f.dur) { f.on = false; continue; }
      const k = 1 - f.t / f.dur;
      glow(f.x, f.y, f.z, f.color, f.peak * k * k * (f.flicker ? 0.75 + 0.25 * Math.sin(time * 40 + f.x * 9) : 1), f.dist);
    }
    // Partial selection of the brightest requests
    let used = 0;
    for (; used < LIGHTS && used < nreq; used++) {
      let best = used;
      for (let j = used + 1; j < nreq; j++) if (reqs[j].i > reqs[best].i) best = j;
      const r = reqs[best]; reqs[best] = reqs[used]; reqs[used] = r;
      const l = lights[used];
      l.position.set(r.x, r.y, r.z); l.color.copy(r.color); l.intensity = r.i; l.distance = r.dist;
    }
    // Level-5 staff crystals fill the rest, nearest the camera first
    if (used < LIGHTS) {
      const staffs = units.staffLights();
      if (staffs.length) {
        view.camera.getWorldPosition(camPos);
        for (const s of staffs) { s.anchor.getWorldPosition(tmpV); s.d = tmpV.distanceToSquared(camPos); }
        staffs.sort((a, b) => a.d - b.d);
        for (const s of staffs) {
          if (used >= LIGHTS) break;
          const m = sim && sim.mages.find(o => o.id === s.mage);
          staffColor.setHex(m ? ELEMENT[m.kind].glow : 0xffffff);
          const l = lights[used++];
          s.anchor.getWorldPosition(l.position); l.position.y += 0.05; l.color.copy(staffColor); l.distance = 1.6;
          l.intensity = 0.9 + 0.15 * Math.sin(time * 3 + s.mage);
        }
      }
    }
    for (let i = used; i < LIGHTS; i++) lights[i].intensity = 0;
    nreq = 0;
  }

  // ================= Shake and tint =================
  let shakeAmp = 0;
  const shakeOffset = new THREE.Vector3();
  /** A short camera shake (big hits only); nothing when the player prefers reduced motion. */
  function shake(s) { if (!reduceMotion) shakeAmp = Math.min(1, Math.max(shakeAmp, s)); }
  const tintMat = own(materials, new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0x5aa8ff) }, alpha: { value: 0 }, frost: { value: 0 }, time: { value: 0 }, aspect: { value: 1.6 } },
    vertexShader: TVERT, fragmentShader: TFRAG, transparent: true, depthTest: false, depthWrite: false,
  }));
  const tintQuad = new THREE.Mesh(own(geometries, new THREE.PlaneGeometry(2, 2)), tintMat);
  tintQuad.frustumCulled = false; tintQuad.renderOrder = 1000; tintQuad.visible = false;
  root.add(tintQuad);
  const tintState = { t: 0, dur: 0, peak: 0, frost: 0, rise: 0.1 };
  /** Tints the whole screen with `color` (peak alpha, seconds; `frost` creeps ice in from the edges). */
  function tint(color, peak, dur, frost = 0, rise = 0.1) {
    tintMat.uniforms.color.value.copy(color);
    Object.assign(tintState, { t: 0, dur, peak, frost, rise });
    tintQuad.visible = true;
  }
  function stepScreen(dt) {
    shakeAmp = Math.max(0, shakeAmp - dt * 2.8);
    if (shakeAmp > 0) {
      const s = shakeAmp * shakeAmp * 0.07;
      shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.6, (Math.random() - 0.5) * s);
    } else shakeOffset.set(0, 0, 0);
    if (tintQuad.visible) {
      const T = tintState;
      T.t += dt;
      const k = Math.min(1, T.t / T.rise) * Math.min(1, Math.max(0, (T.dur - T.t) / Math.min(0.6, T.dur * 0.4)));
      const u = tintMat.uniforms;
      u.alpha.value = T.peak * k; u.frost.value = T.frost * k; u.time.value = time;
      u.aspect.value = view.camera.aspect;
      if (T.t >= T.dur) tintQuad.visible = false;
    }
  }

  // ================= Mesh pools: shield bubbles, light columns, tornado funnels =================
  const bubbleMat = own(materials, new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xc070ff) }, alpha: { value: 1 }, time: { value: 0 } },
    vertexShader: BVERT, fragmentShader: BFRAG, transparent: true, depthWrite: false,
  }));
  const bubbleGeo = own(geometries, new THREE.SphereGeometry(1, 28, 18));
  const bubbles = [];
  for (let i = 0; i < BUBBLES; i++) {
    const m = new THREE.Mesh(bubbleGeo, i ? bubbleMat.clone() : bubbleMat);
    if (i) materials.push(m.material);
    m.visible = false; m.renderOrder = 9; root.add(m);
    bubbles.push({ mesh: m, id: -1, k: 0, seen: false });
  }
  const columnProto = own(materials, new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, alpha: { value: 1 }, time: { value: 0 } },
    vertexShader: CVERT, fragmentShader: CFRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending,
  }));
  const columnGeo = own(geometries, new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0));
  const columns = [];
  for (let i = 0; i < COLUMNS; i++) {
    const mat = own(materials, columnProto.clone());
    const m = new THREE.Mesh(columnGeo, mat);
    m.visible = false; m.renderOrder = 10; root.add(m);
    columns.push({ mesh: m, u: mat.uniforms, on: false, t: 0, dur: 0, r: 0, h: 0, follow: null });
  }
  /** A ring of light rising around (x, y, z): radius r, height h, for dur seconds. */
  function column(x, y, z, r, h, color, dur) {
    let c = columns.find(o => !o.on);
    if (!c) c = columns.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    Object.assign(c, { on: true, t: 0, dur, r, h });
    c.mesh.position.set(x, y, z); c.u.color.value.copy(color); c.mesh.visible = true;
  }
  function stepColumns(dt) {
    for (const c of columns) {
      if (!c.on) continue;
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      c.mesh.scale.set(c.r * (0.7 + 0.3 * k), c.h * (0.3 + 0.7 * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2)), c.r * (0.7 + 0.3 * k));
      c.u.alpha.value = Math.min(1, c.t / 0.08) * (1 - k) ** 1.4;
      c.u.time.value = time;
      if (k >= 1) { c.on = false; c.mesh.visible = false; }
    }
  }
  const funnelProto = own(materials, new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xd6dcd6) }, alpha: { value: 1 }, time: { value: 0 } },
    vertexShader: CVERT, fragmentShader: FFRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  // A funnel: narrow at the ground, flaring out at the top, with a slight lean
  const funnelGeo = own(geometries, (() => {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const v = i / 16; pts.push(new THREE.Vector2(0.06 + 0.5 * Math.pow(v, 1.7), v)); }
    return new THREE.LatheGeometry(pts, 36);
  })());
  const funnels = [];
  for (let i = 0; i < FUNNELS; i++) {
    const mat = own(materials, funnelProto.clone());
    const m = new THREE.Mesh(funnelGeo, mat);
    m.visible = false; m.renderOrder = 10; root.add(m);
    funnels.push({ mesh: m, u: mat.uniforms, on: false });
  }

  // ================= Positions =================
  const pp = new Float64Array(2);
  /** World point on the ground at path distance d. */
  function pathPos(d, out) {
    pathPointInto(sim.map, d, pp, 0);
    const x = pp[0] - W / 2, z = pp[1] - H / 2;
    return out.set(x, surface(x, z), z);
  }
  /** Centre of a tile on the ground. */
  function tilePos(t, out) { const x = (t % W) + 0.5 - W / 2, z = Math.floor(t / W) + 0.5 - H / 2; return out.set(x, surface(x, z), z); }
  /** An enemy's body centre: from its figure when it has one, else from the sim. False when it is gone. */
  function enemyPos(id, out) {
    const a = units.enemyAnchor(id);
    if (a) { a.getWorldPosition(out); return true; }
    const e = sim && sim.enemies.find(o => o.id === id);
    if (!e) return false;
    pathPos(e.d, out).y += 0.2;
    return true;
  }
  /** The staff crystal of a mage (or its tile when the figure is not built yet). */
  function magePos(id, out) {
    const a = units.staffAnchor(id);
    if (a) { a.getWorldPosition(out); return true; }
    const m = sim && sim.mages.find(o => o.id === id);
    if (!m) return false;
    out.copy(view.toWorld(m.tile)); out.y += 0.55;
    return true;
  }
  /** A mage's feet (tile centre on the ground). */
  function mageFeet(id, out) {
    const m = sim && sim.mages.find(o => o.id === id);
    if (!m) return false;
    out.copy(view.toWorld(m.tile));
    return true;
  }
  /** Height of an enemy kind's figure. */
  const enemyTop = kind => { const L = ENEMY_LOOK[kind]; return L ? L.top * L.scale : 0.4; };

  const rnd = (a, b) => a + Math.random() * (b - a);
  /** Particle count scaled by the quality budget. */
  const count = n => Math.max(1, Math.round(n * q.particles));

  // ================= Recipes =================
  const kit = {
    q, view, units, root, S, A, CELL, DECAL, SOFT, FLICKER, ALIGN, slots, slotUsed,
    emit, orbit, decal, moveDecal, release, flash, glow, shake, tint, column, funnels, own, materials, geometries, textures,
    pathPos, tilePos, enemyPos, magePos, mageFeet, enemyTop, surface, rnd, count,
    get sim() { return sim; }, get time() { return time; },
    claimSlot() { const i = slotUsed.indexOf(0); if (i < 0) return -1; slotUsed[i] = 1; return i; },
    freeSlot(i) { if (i >= 0) slotUsed[i] = 0; },
  };
  const elements = createElementFx(kit);
  const traps = createTrapFx(kit);

  // ================= Status visuals: burning, poisoned, shielded =================
  const P0 = new THREE.Vector3();
  const C = hex => new THREE.Color(hex);
  const HEAL = C(0x7dff7a), HEAL2 = C(0x2fae3a), WITCH = C(0xc070ff), WITCH2 = C(0x5a1a8a), DIRT = C(0x6a4a2a), DIRT2 = C(0x3a2814);
  const LEAF = C(0x5aa83a), LEAF2 = C(0x2f6a1a), SURGE = C(0x7fd8ff), SURGE2 = C(0xd8b0ff), GOLD = C(0xffd34a), GOLD2 = C(0xc07a10), WHITE = C(0xffffff);
  const DUST = C(0xb8a07a), DUST2 = C(0x8a7458), FROSTB = C(0x8fd0ff), FROSTW = C(0xe8f6ff), RED = C(0xff4a3a);
  function stepStatus(dt) {
    for (const b of bubbles) b.seen = false;
    for (const e of sim.enemies) {
      const st = e.status;
      const burning = st.burnT > 0, poisoned = st.poison.stacks > 0 && st.poison.t > 0, shielded = st.shieldT > 0;
      if (!burning && !poisoned && !shielded) continue;
      if (!enemyPos(e.id, P0)) continue;
      const top = enemyTop(e.kind);
      if (burning) elements.burning(e, P0, top, dt);
      if (poisoned) elements.poisoned(e, P0, top, dt);
      if (shielded) {
        let b = bubbles.find(o => o.id === e.id);
        if (!b) { b = bubbles.find(o => o.id < 0); if (b) { b.id = e.id; b.k = 0; } }
        if (b) {
          b.seen = true;
          b.k = Math.min(1, b.k + dt / 0.25);
          const s = (top * 0.62 + 0.08) * (0.6 + 0.4 * b.k) * (1 + Math.sin(time * 5 + e.id) * 0.03);
          b.mesh.position.copy(P0); b.mesh.position.y = P0.y - (ENEMY_LOOK[e.kind]?.hover ? 0 : top * 0.05);
          b.mesh.scale.set(s, s * 1.05, s);
          b.mesh.material.uniforms.alpha.value = b.k * Math.min(1, st.shieldT / 8);
          b.mesh.material.uniforms.time.value = time + e.id;
          b.mesh.visible = true;
        }
      }
    }
    for (const b of bubbles) if (!b.seen && b.id >= 0) { b.id = -1; b.mesh.visible = false; }
  }

  // ================= Spells, boss skills and the rest =================
  const V1 = new THREE.Vector3(), V2 = new THREE.Vector3();
  function spell(ev) {
    if (ev.spell === 'meteor') elements.meteor(ev.target);
    else if (ev.spell === 'freeze') {
      tint(FROSTB, 0.32, 3, 1, 0.25);
      for (const e of sim.enemies) {
        if (!enemyPos(e.id, V1)) continue;
        for (let i = 0; i < count(14); i++) {
          const a = rnd(0, TAU), s = rnd(0.3, 1.1);
          emit(S, V1.x, V1.y, V1.z, Math.cos(a) * s, rnd(0.2, 1.2), Math.sin(a) * s, rnd(0.4, 0.8), 0.09, 0.03, FROSTW, FROSTB, 0.95, -2, 1.5, CELL.SHARD);
        }
        emit(A, V1.x, V1.y, V1.z, 0, 0, 0, 0.5, 0.9, 1.3, FROSTB, FROSTB, 0.8);
      }
      // Snow drifting over the whole board while time stands still
      for (let i = 0; i < count(160); i++) {
        const x = rnd(-W / 2, W / 2), z = rnd(-H / 2, H / 2);
        emit(S, x, rnd(0.6, 2.2), z, rnd(-0.05, 0.05), rnd(-0.25, -0.1), rnd(-0.05, 0.05), rnd(2, 3.2), 0.07, 0.06, FROSTW, FROSTB, 0.9, 0, 0, CELL.FLAKE, SOFT);
      }
      flash(0, 3, 0, FROSTB, 3, 1.2, 14);
    } else if (ev.spell === 'surge') {
      tint(SURGE2, 0.12, 0.8, 0, 0.1);
      for (const m of sim.mages) {
        if (!mageFeet(m.id, V1)) continue;
        const c = C(ELEMENT[m.kind].glow);
        column(V1.x, V1.y, V1.z, 0.42, 1.5, c, 1.3);
        decal(DECAL.SHOCK, V1.x, V1.z, 0.85, 0.8, c, SURGE);
        decal(DECAL.RUNE, V1.x, V1.z, 0.5, 1.3, c, SURGE, { fade: 0.5 });
        for (let i = 0; i < count(30); i++) {
          const a = rnd(0, TAU), r = rnd(0.25, 0.42);
          const k = emit(S, V1.x + Math.cos(a) * r, V1.y + rnd(0, 0.2), V1.z + Math.sin(a) * r, 0, rnd(0.6, 1.6), 0, rnd(0.6, 1.1), 0.11, 0.03, WHITE, c, 1, 0, 0, CELL.SPARK);
          orbit(S, k, V1.x, V1.z, rnd(3, 5));
        }
      }
      flash(0, 3, 0, SURGE, 2.4, 0.9, 14);
    }
  }
  function bossSkill(ev) {
    const e = sim.enemies.find(o => o.id === ev.enemy);
    const have = enemyPos(ev.enemy, V1);
    switch (ev.skill) {
      case 'saplings':
        for (const id of ev.targets) {
          if (!enemyPos(id, V2)) continue;
          const g = surface(V2.x, V2.z);
          decal(DECAL.CRACKS, V2.x, V2.z, 0.4, 1.4, DIRT, DIRT2, { fade: 0.6 });
          for (let i = 0; i < count(22); i++) {
            const a = rnd(0, TAU), s = rnd(0.2, 0.8);
            emit(S, V2.x, g + 0.03, V2.z, Math.cos(a) * s, rnd(0.8, 1.8), Math.sin(a) * s, rnd(0.5, 0.9), 0.07, 0.05, DIRT, DIRT2, 1, -5, 0.5, CELL.CHUNK);
          }
          for (let i = 0; i < count(16); i++) {
            const a = rnd(0, TAU), s = rnd(0.1, 0.5);
            emit(S, V2.x, g + 0.1, V2.z, Math.cos(a) * s, rnd(0.6, 1.3), Math.sin(a) * s, rnd(0.8, 1.4), 0.09, 0.07, LEAF, LEAF2, 1, -1.2, 1.5, CELL.LEAF);
          }
          emit(S, V2.x, g + 0.1, V2.z, 0, 0.2, 0, 0.8, 0.3, 0.6, DUST, DUST2, 0.7, 0, 0, CELL.PUFF, SOFT);
          column(V2.x, g, V2.z, 0.22, 0.6, LEAF, 0.7);
        }
        break;
      case 'rootSlam':
        if (have) {
          const g = surface(V1.x, V1.z);
          decal(DECAL.SHOCK, V1.x, V1.z, 2.4, 0.8, DUST, DIRT);
          decal(DECAL.CRACKS, V1.x, V1.z, 1.2, 2, DIRT, DIRT2, { fade: 0.8 });
          for (let i = 0; i < count(50); i++) {
            const a = rnd(0, TAU), s = rnd(0.8, 2.2);
            emit(S, V1.x + Math.cos(a) * 0.3, g + 0.05, V1.z + Math.sin(a) * 0.3, Math.cos(a) * s, rnd(0.1, 0.5), Math.sin(a) * s, rnd(0.6, 1.1), 0.25, 0.6, DUST, DUST2, 0.75, 0, 2.5, CELL.PUFF, SOFT);
          }
        }
        // A shockwave bursts up under each slammed mage
        for (const id of ev.targets) {
          if (!mageFeet(id, V2)) continue;
          elements.rootBurst(V2);
        }
        shake(0.8);
        break;
      case 'shield':
        if (have) {
          decal(DECAL.SHOCK, V1.x, V1.z, 2.2, 0.7, WITCH, WITCH2);
          for (let i = 0; i < count(30); i++) {
            const a = rnd(0, TAU), s = rnd(1, 2.2);
            emit(A, V1.x, V1.y, V1.z, Math.cos(a) * s, rnd(-0.1, 0.4), Math.sin(a) * s, rnd(0.4, 0.7), 0.1, 0.03, WHITE, WITCH, 1, 0, 2, CELL.SPARK);
          }
          flash(V1.x, V1.y + 0.3, V1.z, WITCH, 2.4, 0.7);
        }
        for (const id of ev.targets) if (enemyPos(id, V2)) emit(A, V2.x, V2.y, V2.z, 0, 0, 0, 0.4, 0.4, 0.8, WITCH, WITCH, 0.8);
        break;
      case 'heal': case 'regen':
        for (const id of ev.targets) {
          if (!enemyPos(id, V2)) continue;
          for (let i = 0; i < count(6); i++) emit(S, V2.x + rnd(-0.12, 0.12), V2.y + rnd(0, 0.15), V2.z + rnd(-0.12, 0.12), 0, rnd(0.3, 0.6), 0, rnd(0.6, 1), 0.08, 0.06, HEAL, HEAL2, 1, 0, 0.5, CELL.PLUS);
        }
        if (have && ev.skill === 'heal' && e && e.kind === 'shaman') decal(DECAL.SHOCK, V1.x, V1.z, 1.5, 0.6, HEAL, HEAL2);
        break;
      case 'summon':
        if (have) {
          decal(DECAL.RUNE, V1.x, V1.z, 0.7, 1.2, LEAF, LEAF2, { fade: 0.5 });
          for (let i = 0; i < count(30); i++) {
            const a = rnd(0, TAU), s = rnd(0.2, 0.7);
            emit(S, V1.x, V1.y - 0.1, V1.z, Math.cos(a) * s, rnd(0.2, 0.6), Math.sin(a) * s, rnd(0.7, 1.2), 0.2, 0.45, DUST, DUST2, 0.7, 0, 1.5, CELL.PUFF, SOFT);
          }
        }
        break;
      case 'sprint':
        if (have) for (let i = 0; i < count(16); i++) emit(S, V1.x + rnd(-0.15, 0.15), surface(V1.x, V1.z) + 0.05, V1.z + rnd(-0.15, 0.15), rnd(-0.3, 0.3), rnd(0.2, 0.5), rnd(-0.3, 0.3), rnd(0.5, 0.9), 0.15, 0.35, DUST, DUST2, 0.7, 0, 1.5, CELL.PUFF, SOFT);
        if (have) emit(A, V1.x, V1.y, V1.z, 0, 0, 0, 0.4, 0.5, 0.9, RED, RED, 0.7);
        break;
      default: break;
    }
  }
  function misc(ev) {
    switch (ev.type) {
      case 'merge': {
        const m = sim.mages.find(o => o.id === ev.mage);
        if (!m || !mageFeet(m.id, V1)) break;
        const c = C(ELEMENT[m.kind].glow), lv = ev.level;
        column(V1.x, V1.y, V1.z, 0.3 + lv * 0.02, 0.8 + lv * 0.15, c, 0.9);
        decal(DECAL.SHOCK, V1.x, V1.z, 0.55 + lv * 0.08, 0.6, c, WHITE);
        for (let i = 0; i < count(16 + lv * 6); i++) {
          const a = rnd(0, TAU), s = rnd(0.4, 1.2);
          emit(A, V1.x, V1.y + 0.3, V1.z, Math.cos(a) * s, rnd(0.5, 1.6), Math.sin(a) * s, rnd(0.5, 0.9), 0.07, 0.02, WHITE, c, 1, -2, 1.5, CELL.SPARK);
        }
        flash(V1.x, V1.y + 0.5, V1.z, c, 1.5 + lv * 0.3, 0.6);
        break;
      }
      case 'place': {
        if (!mageFeet(ev.mage, V1)) break;
        for (let i = 0; i < count(12); i++) {
          const a = rnd(0, TAU), s = rnd(0.2, 0.6);
          emit(S, V1.x + Math.cos(a) * 0.15, V1.y + 0.04, V1.z + Math.sin(a) * 0.15, Math.cos(a) * s, rnd(0.05, 0.3), Math.sin(a) * s, rnd(0.5, 0.8), 0.12, 0.3, DUST, DUST2, 0.65, 0, 2, CELL.PUFF, SOFT);
        }
        break;
      }
      case 'sell': {
        tilePos(ev.tile, V1);
        for (let i = 0; i < count(18); i++) {
          const a = rnd(0, TAU), s = rnd(0.2, 0.6);
          emit(S, V1.x, V1.y + 0.2, V1.z, Math.cos(a) * s, rnd(0.8, 1.6), Math.sin(a) * s, rnd(0.6, 0.9), 0.07, 0.06, GOLD, GOLD2, 1, -3, 0.5, CELL.CHUNK);
        }
        emit(A, V1.x, V1.y + 0.25, V1.z, 0, 0.2, 0, 0.5, 0.4, 0.7, GOLD, GOLD, 0.8);
        break;
      }
      default: break;
    }
  }

  // Compile every effect program now (with this pool's lights), so the first cast does not hitch. The terrain adds
  // its own point lights later (they are part of each lit program's key), so the engine calls precompile() again then.
  const precompile = () => renderer.compile(scene, view.camera);
  precompile();

  return {
    get shakeOffset() { return shakeOffset; },
    precompile,
    /** Live particle counts and capacities (for checks). */
    stats() {
      const cells = {};
      for (let i = 0; i < S.N; i++) if (S.life[i] > 0) cells[S.cell[i]] = (cells[S.cell[i]] || 0) + 1;
      return { solid: S.live, solidMax: S.N, additive: A.live, additiveMax: A.N, solidByCell: cells };
    },
    shake,
    onEvent(ev, s) {
      sim = s;
      switch (ev.type) {
        case 'attack': case 'passive': case 'cast': case 'kill':
          elements.onEvent(ev);
          break;
        case 'trapPlace': case 'trapTrigger': case 'trapBreak':
          traps.onEvent(ev);
          break;
        case 'spell': spell(ev); break;
        case 'bossSkill': bossSkill(ev); break;
        case 'merge': case 'place': case 'sell': misc(ev); break;
        default: break;
      }
    },
    update(dt, s) {
      sim = s;
      time += dt;
      // Pixels per world unit at distance 1: particle sizes are in world units
      uScale.value = renderer.getDrawingBufferSize(tmpV2).y * view.camera.projectionMatrix.elements[5] / 2;
      elements.update(dt);
      traps.update(dt);
      stepStatus(dt);
      stepSystem(S, dt);
      stepSystem(A, dt);
      stepDecals(dt);
      stepColumns(dt);
      bubbleMat.uniforms.time.value = time;
      stepLights(dt);
      stepScreen(dt);
    },
    dispose() {
      elements.dispose();
      traps.dispose();
      scene.remove(root);
      for (const m of materials) m.dispose();
      for (const g of geometries) g.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
const tmpV2 = new THREE.Vector2();
