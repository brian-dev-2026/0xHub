// Mage Siege renderer shell: WebGL renderer, sky-lit scene, tilted camera framing the 16 × 9 board between the
// HUD, the sideways mapping for upright touch screens (Pool's rot/loc/box) and the quality presets.
import * as THREE from 'three';

// ================= Quality =================
/** particles: share of each effect's particle budget; texSize: terrain texture width; segs: terrain vertices per tile;
 * scatter: share of the woodland around the board. */
export const QUALITY = {
  high: { name: 'high', shadows: true, shadowSize: 2048, reflect: true, ripples: true, pixelRatio: 2, particles: 1, texSize: 2048, segs: 8, scatter: 1, aniso: 8, lights: true },
  medium: { name: 'medium', shadows: true, shadowSize: 1024, reflect: false, ripples: true, pixelRatio: 1.5, particles: 0.75, texSize: 1536, segs: 6, scatter: 0.7, aniso: 4, lights: true },
  low: { name: 'low', shadows: false, shadowSize: 0, reflect: false, ripples: false, pixelRatio: 1, particles: 0.5, texSize: 1024, segs: 4, scatter: 0.45, aniso: 1, lights: false },
};
const QUALITY_KEY = '0xhubms.quality';

/** First-run pick: Low on small or weak touch screens, Medium on other touch screens, High elsewhere. */
export function autoQuality() {
  const dpr = window.devicePixelRatio || 1;
  const area = (window.screen?.width || window.innerWidth) * (window.screen?.height || window.innerHeight) * dpr;
  const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (area < 800000 || (touch && (navigator.hardwareConcurrency || 4) <= 4)) return QUALITY.low;
  return touch ? QUALITY.medium : QUALITY.high;
}
/** The saved quality, or the auto pick (saved, so it sticks) on the first run. */
export function loadQuality() {
  try { const v = localStorage.getItem(QUALITY_KEY); if (v && QUALITY[v]) return QUALITY[v]; } catch (e) { /* storage blocked */ }
  const q = autoQuality(); saveQuality(q.name); return q;
}
export function saveQuality(name) {
  try { localStorage.setItem(QUALITY_KEY, name); } catch (e) { /* storage blocked */ }
}

// ================= Scene =================
export const BOARD_W = 16, BOARD_H = 9;
const TILT = THREE.MathUtils.degToRad(55);
const FOV = 34;
const SKY = new THREE.Color(0xaebfcc); // fog and background: hazy afternoon sky
export const SUN_DIR = new THREE.Vector3(-0.8, 0.85, 0.3).normalize();

/** Tile index → board-centred world x/z (1 world unit = 1 tile; +z is toward the camera). */
export const tileX = i => (i % BOARD_W) + 0.5 - BOARD_W / 2;
export const tileZ = i => Math.floor(i / BOARD_W) + 0.5 - BOARD_H / 2;

/**
 * createScene(canvas, rootEl, quality) → { renderer, scene, camera, sun, layout(hud), toWorld(tile), tileAt(x, y),
 * loc(e), box(el), setTerrain(t), setQuality(q), render(), dispose() }.
 * `hud` gives the HUD insets in px of the (possibly turned) game frame: { top, right, bottom, left }.
 */
export function createScene(canvas, rootEl, quality) {
  let q = quality;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(SKY);

  const scene = new THREE.Scene();
  scene.background = SKY.clone();
  scene.fog = new THREE.Fog(SKY.clone(), 20, 40);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  // Sun with soft shadows over the board and its margin, plus a sky/ground fill
  const sun = new THREE.DirectionalLight(0xffecd2, 2.8);
  sun.position.copy(SUN_DIR).multiplyScalar(30);
  const sc = sun.shadow.camera;
  sc.left = -15; sc.right = 15; sc.top = 12; sc.bottom = -12; sc.near = 5; sc.far = 70;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x5a4a32, 0.35);
  scene.add(hemi);

  // Environment: a gradient sky with a bright sun disc, prefiltered for reflections and image-based fill light
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = (function buildEnv() {
    const env = new THREE.Scene();
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main() {
          float h = vP.y;
          vec3 zen = vec3(0.22, 0.42, 0.85), hor = vec3(0.86, 0.9, 0.94), gnd = vec3(0.16, 0.17, 0.12);
          // pow() of a negative base is NaN, and some drivers evaluate both sides of a ternary
          vec3 up = mix(hor, zen, pow(max(h, 0.0), 0.55)), down = mix(hor * 0.7, gnd, pow(max(-h, 0.0), 0.4));
          vec3 c = h > 0.0 ? up : down;
          gl_FragColor = vec4(c, 1.0);
          #include <encodings_fragment>
        }`,
    });
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
    const disc = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(28, 24, 18) }));
    disc.position.copy(SUN_DIR).multiplyScalar(9); env.add(disc);
    const tex = pmrem.fromScene(env, 0.02).texture;
    skyMat.dispose(); disc.material.dispose(); disc.geometry.dispose();
    return tex;
  })();
  scene.environment = envTex;

  let terrain = null;

  // ================= Sideways mapping (Pool's rot/loc/box) =================
  // Landscape only: a touch screen held upright turns the whole game 90° clockwise, so screen points and rects
  // are mapped into that turned frame before use.
  let rot = false, vw = window.innerWidth, vh = window.innerHeight;
  const loc = e => rot ? { x: e.clientY, y: window.innerWidth - e.clientX } : { x: e.clientX, y: e.clientY };
  const box = el => {
    const r = el.getBoundingClientRect();
    if (!rot) return r;
    const left = r.top, top = window.innerWidth - r.right;
    return { left, top, width: r.height, height: r.width, right: left + r.height, bottom: top + r.width };
  };
  const coarse = window.matchMedia('(pointer: coarse)');

  // ================= Camera framing =================
  const corners = [];
  for (const x of [-BOARD_W / 2 - 0.1, BOARD_W / 2 + 0.1]) for (const z of [-BOARD_H / 2 - 0.1, BOARD_H / 2 + 0.1]) for (const y of [-0.05, 0.55]) corners.push(new THREE.Vector3(x, y, z));
  const dir = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT));
  const tmp = new THREE.Vector3();
  let lastHud = { top: 8, right: 8, bottom: 8, left: 8 };

  function projectedBox() {
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of corners) {
      tmp.copy(c).project(camera);
      const px = (tmp.x + 1) / 2 * vw, py = (1 - tmp.y) / 2 * vh;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return { x0, y0, x1, y1 };
  }

  function layout(hud = lastHud) {
    lastHud = { top: 8, right: 8, bottom: 8, left: 8, ...hud };
    rot = coarse.matches && window.innerHeight > window.innerWidth;
    vw = rot ? window.innerHeight : window.innerWidth; vh = rot ? window.innerWidth : window.innerHeight;
    rootEl.classList.toggle('rot', rot);
    Object.assign(rootEl.style, rot
      ? { width: vw + 'px', height: vh + 'px', transform: `translateX(${window.innerWidth}px) rotate(90deg)` }
      : { width: '', height: '', transform: '' });
    rootEl.classList.toggle('short', vh < 560);
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.clearViewOffset();
    // Fit the board's bounding box into the free area: projected size scales ~1/distance, so a few passes converge
    const a = { x: lastHud.left, y: lastHud.top, w: Math.max(40, vw - lastHud.left - lastHud.right), h: Math.max(40, vh - lastHud.top - lastHud.bottom) };
    let dist = 20, b;
    for (let i = 0; i < 6; i++) {
      camera.position.copy(dir).multiplyScalar(dist); camera.lookAt(0, 0, 0);
      b = projectedBox();
      dist *= Math.max((b.x1 - b.x0) / a.w, (b.y1 - b.y0) / a.h);
    }
    camera.position.copy(dir).multiplyScalar(dist); camera.lookAt(0, 0, 0);
    b = projectedBox();
    // Slide the view so the board's box is centred in the free area
    camera.setViewOffset(vw, vh, (b.x0 + b.x1) / 2 - (a.x + a.w / 2), (b.y0 + b.y1) / 2 - (a.y + a.h / 2), vw, vh);
    camera.updateProjectionMatrix();
    // Keep the fog beyond the board so it never dims it, then fade the surroundings into the sky
    let far = 0;
    for (const c of corners) far = Math.max(far, camera.position.distanceTo(c));
    scene.fog.near = far + 1; scene.fog.far = far + 18;
  }

  // ================= Picking =================
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), p = new THREE.Vector3();
  const surface = (x, z) => terrain ? terrain.surfaceAt(x, z) : 0;
  /** Board tile under a screen point (client coordinates), or -1. Marches the ray down onto the terrain surface. */
  function tileAt(clientX, clientY) {
    const pt = loc({ clientX, clientY }), r = box(canvas);
    ndc.set(((pt.x - r.left) / r.width) * 2 - 1, -((pt.y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const { origin: o, direction: d } = ray.ray;
    if (d.y >= 0) return -1;
    // Start just above the tallest terrain and step until the ray dips under the surface, then bisect
    let t0 = (0.8 - o.y) / d.y, t1 = t0;
    const below = t => { p.copy(d).multiplyScalar(t).add(o); return p.y <= surface(p.x, p.z); };
    let hit = false;
    for (let i = 0; i < 80; i++) { t1 = t0 + 0.06; if (below(t1)) { hit = true; break; } t0 = t1; }
    if (!hit) return -1;
    for (let i = 0; i < 12; i++) { const m = (t0 + t1) / 2; if (below(m)) t1 = m; else t0 = m; }
    p.copy(d).multiplyScalar(t1).add(o);
    const tx = Math.floor(p.x + BOARD_W / 2), tz = Math.floor(p.z + BOARD_H / 2);
    return tx < 0 || tx >= BOARD_W || tz < 0 || tz >= BOARD_H ? -1 : tz * BOARD_W + tx;
  }
  /** Where a unit stands on a tile: its centre at the walkable height (hill tops, stepping stones, path). */
  const toWorld = i => new THREE.Vector3(tileX(i), terrain ? terrain.standAt(i) : 0, tileZ(i));

  // ================= Quality =================
  function setQuality(next) {
    q = next;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    renderer.shadowMap.enabled = q.shadows;
    sun.castShadow = q.shadows;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (q.shadows) sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    layout();
  }
  setQuality(q);

  return {
    renderer, scene, camera, sun,
    layout, tileAt, toWorld, loc, box,
    get rot() { return rot; },
    get quality() { return q; },
    setTerrain(t) { terrain = t; },
    setQuality,
    render() { renderer.render(scene, camera); },
    dispose() {
      envTex.dispose(); pmrem.dispose();
      if (sun.shadow.map) sun.shadow.map.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
