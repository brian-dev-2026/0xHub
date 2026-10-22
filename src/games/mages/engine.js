// Mage Siege: a merge tower-defense on a generated 3D map. Renders inside a shadow root so the app's global
// styles cannot leak in. This shell owns mounting, the frame loop and the quality setting; the simulation,
// units, effects, input and UI plug in here in later steps.
import { TICK_HZ, W } from '../../../shared/games/mages/data';
import { generateMap, pathLength } from '../../../shared/games/mages/map';
import { createSim, spawnForTest, step } from '../../../shared/games/mages/sim';
import { createScene, loadQuality, QUALITY, saveQuality } from './scene';
import { buildTerrain } from './terrain';
import { createUnits } from './units';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap';

const CSS = `
:host {
  --bg: #0d1012;
  --glass: rgba(17, 19, 21, 0.62);
  --line: rgba(255, 255, 255, 0.12);
  --fg: #f3efe6;
  --muted: #a3a8aa;
  --accent: #e2b866;
  --display: "Barlow Condensed", "Arial Narrow", sans-serif;
  --body: "Barlow", system-ui, sans-serif;
  color-scheme: dark;
}
[hidden] { display: none !important; }
.root { --sa-top: env(safe-area-inset-top, 0px); --sa-right: env(safe-area-inset-right, 0px); --sa-bottom: env(safe-area-inset-bottom, 0px); --sa-left: env(safe-area-inset-left, 0px);
  position: fixed; inset: 0; overflow: hidden; background: var(--bg); color: var(--fg); font-family: var(--body); -webkit-tap-highlight-color: transparent; }
/* layout() sizes and turns .root; safe areas follow the turn: local top = screen right, local left = screen top */
.root.rot { inset: auto; top: 0; left: 0; transform-origin: 0 0; --sa-top: env(safe-area-inset-right, 0px); --sa-right: env(safe-area-inset-bottom, 0px); --sa-bottom: env(safe-area-inset-left, 0px); --sa-left: env(safe-area-inset-top, 0px); }
#c { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
button { font: inherit; color: inherit; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.glass { background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); }
.ibtn { position: absolute; z-index: 4; top: calc(10px + var(--sa-top)); left: max(12px, var(--sa-left)); width: 40px; height: 40px; border-radius: 12px;
  display: grid; place-items: center; cursor: pointer; font-family: var(--display); font-weight: 700; font-size: 20px; }
.root.short .ibtn { width: 34px; height: 34px; border-radius: 10px; top: calc(6px + var(--sa-top)); }
`;
const MARKUP = `<canvas id="c" tabindex="0" aria-label="Mage Siege battlefield"></canvas>
<button class="ibtn glass" id="exitBtn" aria-label="Exit to games">&#x2039;</button>`;

/** Mounts the game into `host` and returns a function that tears it down. */
export function mountMages(host, { onExit, api }) {
  // Fonts declared inside a shadow root are ignored, so load them on the page
  if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT_HREF }));
  }
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style><div class="root">${MARKUP}</div>`;
  const rootEl = shadow.querySelector('.root');
  const $ = id => shadow.getElementById(id);
  let alive = true;
  const unlisten = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); unlisten.push([target, type, fn]); };
  void api; // used by the menus and run flow

  const view = createScene($('c'), rootEl, loadQuality());
  let terrain = null, map = null, units = createUnits(view, view.quality);
  let sim = null, paused = false, acc = 0;
  /** Advances the simulation n ticks and hands its events to the renderer. */
  function runTicks(n) {
    for (let i = 0; i < n && sim; i++) for (const ev of step(sim, [])) units.onEvent(ev);
  }

  function showMap(m) {
    map = m;
    if (terrain) terrain.dispose();
    terrain = buildTerrain(view.scene, map, view.quality);
    view.setTerrain(terrain);
  }
  function setQuality(name) {
    const q = QUALITY[name];
    if (!q || q === view.quality) return;
    saveQuality(name);
    view.setQuality(q);
    if (map) showMap(map); // texture sizes, ripples and lights depend on quality
    units.dispose();
    units = createUnits(view, q); // shadow casting is set per figure when it is built
  }

  // TEMPORARY BOOT (replaced by the menus and run flow): preview the seed-1 map.
  showMap(generateMap(1));

  // TEMPORARY DEV DEMO (Tasks 13/14 replace it): every mage at levels 1, 3 and 5 (built with real merge actions) and
  // one enemy of each kind on the path, tough enough to stay alive, so the figures can be checked in a browser.
  let demoEnemies = null;
  if (import.meta.env.DEV) {
    const team = ['fire', 'ice', 'lightning', 'earth', 'poison', 'wind'];
    sim = createSim({ seed: 1, mode: 'stage', stage: 1, team, traps: [], spells: [], __noLeak: true });
    sim.gold = 1e9;
    const tiles = sim.map.tiles, path = sim.map.path;
    const free = i => tiles[i] && tiles[i].kind === 'build' && tiles[i].terrain !== 'blocked' && tiles[i].terrain !== 'water';
    const near = i => path.filter(p => ((p % W) - (i % W)) ** 2 + (Math.floor(p / W) - Math.floor(i / W)) ** 2 <= 6.25).length;
    const used = new Set(), rows = [];
    const cands = [];
    for (let i = 0; i < tiles.length; i++) if (i % W <= W - 3 && free(i) && free(i + 1) && free(i + 2)) cands.push(i);
    cands.sort((a, b) => near(b) + near(b + 2) - near(a) - near(a + 2) || a - b);
    for (const i of cands) if (rows.length < team.length && ![i, i + 1, i + 2].some(t => used.has(t))) { rows.push(i); [i, i + 1, i + 2].forEach(t => used.add(t)); }
    const spares = [];
    for (let i = 0; i < tiles.length && spares.length < 4; i++) if (free(i) && !used.has(i)) spares.push(i);
    const acts = [];
    const build = (mage, lv, tile) => {
      if (lv === 1) { acts.push({ t: sim.tick, type: 'place', mage, tile }); return; }
      build(mage, lv - 1, tile);
      const sp = spares.pop();
      build(mage, lv - 1, sp);
      acts.push({ t: sim.tick, type: 'merge', from: sp, to: tile });
      spares.push(sp);
    };
    team.forEach((mage, k) => { if (rows[k] !== undefined) [1, 3, 5].forEach((lv, j) => build(mage, lv, rows[k] + j)); });
    for (const ev of step(sim, acts)) units.onEvent(ev);
    demoEnemies = () => {
      const kinds = ['goblin', 'wolf', 'brute', 'bat', 'shaman', 'knight', 'goblinChief', 'direWolf', 'troll', 'witch', 'treant', 'sapling'];
      const span = pathLength(sim.map) - 3;
      kinds.forEach((kind, i) => {
        const e = spawnForTest(sim, kind, 0.5 + (i / (kinds.length - 1)) * span);
        e.maxHp = 1e7; e.hp = e.maxHp * (0.3 + 0.06 * i);
      });
    };
    demoEnemies();
  }

  const layout = () => view.layout();
  layout();
  listen(window, 'resize', layout);
  listen(window, 'orientationchange', layout);
  $('exitBtn').addEventListener('click', () => onExit());

  let last = performance.now(), raf = 0;
  function frame(now) {
    // A rAF timestamp can predate the mount (it is the frame start), so clamp at 0 as well
    const dt = Math.max(0, Math.min((now - last) / 1000, 1 / 20)); last = now;
    if (terrain) terrain.update(dt);
    if (sim && !paused) {
      acc += dt * TICK_HZ;
      const n = Math.floor(acc);
      acc -= n;
      runTicks(n);
      if (demoEnemies && sim.enemies.length === 0) demoEnemies();
    }
    if (sim) units.sync(sim, acc, dt);
    view.render();
    if (alive) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  if (import.meta.env.DEV) {
    // TEMPORARY DEV hooks for visual checks: tick(n) steps the demo sim, pause(on) stops the clock, focus(x, z, dist)
    // points the camera at a board-centred world point from closer in (layout() restores the framing).
    window.__mages = {
      view, get terrain() { return terrain; }, get units() { return units; }, get sim() { return sim; }, setQuality, showMap: seed => showMap(generateMap(seed)),
      tick: n => runTicks(n), pause: on => { paused = on; },
      focus(x, z, dist = 2.5, tilt = 0.6, yaw = 0, lift = 0.3) {
        const y = view.groundAt(x, z) + lift, c = view.camera;
        c.clearViewOffset();
        c.position.set(x + Math.sin(yaw) * Math.cos(tilt) * dist, y + Math.sin(tilt) * dist, z + Math.cos(yaw) * Math.cos(tilt) * dist);
        c.lookAt(x, y, z); c.updateProjectionMatrix();
      },
    };
  }

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    for (const [target, type, fn] of unlisten) target.removeEventListener(type, fn);
    units.dispose();
    if (terrain) terrain.dispose();
    view.dispose();
    shadow.innerHTML = '';
    if (import.meta.env.DEV) delete window.__mages;
  };
}
