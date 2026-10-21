// Mage Siege: a merge tower-defense on a generated 3D map. Renders inside a shadow root so the app's global
// styles cannot leak in. This shell owns mounting, the frame loop and the quality setting; the simulation,
// units, effects, input and UI plug in here in later steps.
import { generateMap } from '../../../shared/games/mages/map';
import { createScene, loadQuality, QUALITY, saveQuality } from './scene';
import { buildTerrain } from './terrain';

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
  let terrain = null, map = null;

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
  }

  // TEMPORARY BOOT (replaced by the menus and run flow): preview the seed-1 map.
  showMap(generateMap(1));

  const layout = () => view.layout();
  layout();
  listen(window, 'resize', layout);
  listen(window, 'orientationchange', layout);
  $('exitBtn').addEventListener('click', () => onExit());

  let last = performance.now(), raf = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
    if (terrain) terrain.update(dt);
    view.render();
    if (alive) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  if (import.meta.env.DEV) window.__mages = { view, get terrain() { return terrain; }, setQuality, showMap: seed => showMap(generateMap(seed)) };

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    for (const [target, type, fn] of unlisten) target.removeEventListener(type, fn);
    if (terrain) terrain.dispose();
    view.dispose();
    shadow.innerHTML = '';
    if (import.meta.env.DEV) delete window.__mages;
  };
}
