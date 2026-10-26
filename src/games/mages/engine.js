// Mage Siege: a merge tower-defense on a generated 3D map. Renders inside a shadow root so the app's global
// styles cannot leak in. This shell owns mounting, the fixed-tick game loop, the action log, the run flow (world map →
// team → server start → play → verified result) and the board interactions; ui.js draws the screens and HUD.
import { MAGES, MAX_LEVEL, MAX_TRAPS, SPELLS, TICK_HZ, TRAPS, W } from '../../../shared/games/mages/data';
import { outcomeOf } from '../../../shared/games/mages/chunk';
import { magePrice } from '../../../shared/games/mages/combat';
import { generateMap, pathLength } from '../../../shared/games/mages/map';
import { unlocked as unlockedOf } from '../../../shared/games/mages/progress';
import { applyAction, createSim, spawnForTest, step } from '../../../shared/games/mages/sim';
import { createKit } from './figures';
import { createFx } from './fx';
import { createInput } from './input';
import { createScene, loadQuality, QUALITY, saveQuality } from './scene';
import { buildTerrain } from './terrain';
import { createRunSubmitter, takePendingRun } from './submit';
import { MAGE_COLOR, createUI, friendlyError } from './ui';
import { UI_CSS } from './ui-style';
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
  position: fixed; inset: 0; overflow: hidden; background: var(--bg); color: var(--fg); font-family: var(--body); -webkit-tap-highlight-color: transparent;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
/* layout() sizes and turns .root; safe areas follow the turn: local top = screen right, local left = screen top */
.root.rot { inset: auto; top: 0; left: 0; transform-origin: 0 0; --sa-top: env(safe-area-inset-right, 0px); --sa-right: env(safe-area-inset-bottom, 0px); --sa-bottom: env(safe-area-inset-left, 0px); --sa-left: env(safe-area-inset-top, 0px); }
#c { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
button { font: inherit; color: inherit; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.glass { background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); }
.ibtn { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; cursor: pointer; padding: 0; }
.ibtn svg { width: 20px; height: 20px; }
.root.short .ibtn { width: 36px; height: 36px; border-radius: 11px; }
${UI_CSS}`;
const MARKUP = `<canvas id="c" tabindex="0" aria-label="Mage Siege battlefield"></canvas>`;

/** The menus' backdrop: a fixed map, so the world map always opens on the same view. */
const MENU_CFG = { seed: 7, mode: 'stage', stage: 1, team: ['fire'], traps: [], spells: [] };
const TEAM_KEY = '0xhubms.team';
/** How long (ms) the end of a game stays in view before the results cover it. */
const END_PAUSE_MS = 1400;
/** Mage portraits for the menus, rendered once per page load. */
const portraitCache = {};

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
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); };

  const view = createScene($('c'), rootEl, loadQuality());
  let terrain = null, map = null, units = createUnits(view, view.quality), fx = createFx(view, units, view.quality);

  // ================= Game loop =================
  // Real time × speed accumulates into fixed 30 Hz ticks (at most MAX_TICKS per frame, so a slow frame never
  // snowballs); the renderer interpolates enemies by the leftover fraction. Pause and speed are not actions: they
  // only change how many ticks run, so replays are unaffected. A hidden page stops the clock as well. Time only
  // moves while a game is `running`; the menus show a still board.
  const MAX_TICKS = 8;
  let sim = null, speed = 1, paused = false, hidden = document.hidden, acc = 0, running = false;
  let devHold = false; // DEV: the frame loop only renders; __mages.advance() moves time
  let queued = [], log = [];
  const listeners = [];
  /**
   * Steps the simulation once. Queued actions are applied first, one at a time, exactly as step() applies them; a
   * refused one is dropped rather than logged, so the log the server replays never holds an illegal action.
   */
  function tickOnce() {
    const evs = [];
    if (queued.length) {
      const due = queued;
      queued = [];
      if (sim.phase !== 'won' && sim.phase !== 'lost') {
        for (const a of due) {
          const act = { ...a, t: sim.tick };
          if (applyAction(sim, act, evs)) log.push(act);
          else onRefused(act);
        }
      }
    }
    for (const ev of step(sim, [])) evs.push(ev);
    for (const ev of evs) { units.onEvent(ev); fx.onEvent(ev, sim); }
    if (evs.length) for (const cb of listeners) cb(evs, sim);
    afterTick(evs);
  }
  function runTicks(n) { for (let i = 0; i < n && sim; i++) tickOnce(); }
  /** Engine-internal API for the run flow and input. */
  const game = {
    /** Starts driving `s` (a fresh sim): clears the queue and the action log. */
    setSim(s) { sim = s; queued = []; log = []; acc = 0; },
    getSim: () => sim,
    /** Queues a player action for the next tick; it joins the run's action log once the sim accepts it. */
    queueAction(a) {
      if (!sim) return null;
      const act = { ...a, t: sim.tick };
      queued.push(act);
      return act;
    },
    /** The accepted actions so far, in order. */
    actionLog: () => log,
    setSpeed(n) { speed = n === 2 ? 2 : 1; },
    getSpeed: () => speed,
    pause() { paused = true; },
    resume() { paused = false; },
    isPaused: () => paused || hidden,
    /** Calls cb(events, sim) after every tick that produced events; returns an unsubscribe function. */
    onEvents(cb) { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
  };

  function showMap(m) {
    map = m;
    if (terrain) terrain.dispose();
    terrain = buildTerrain(view.scene, map, view.quality);
    view.setTerrain(terrain);
    fx.precompile(); // the terrain's point lights change every lit program's key
    hlKey = '';
  }
  function setQuality(name) {
    const q = QUALITY[name];
    if (!q || q === view.quality) return;
    saveQuality(name);
    view.setQuality(q);
    if (map) showMap(map); // texture sizes, ripples and lights depend on quality
    fx.dispose(); units.dispose();
    units = createUnits(view, q); // shadow casting is set per figure when it is built
    fx = createFx(view, units, q); // particle budgets follow the quality
    relayout();
  }

  // ================= Progress and the run flow =================
  let progress = null, unl = null, loadError = '';
  /** 'world' | 'team' | 'play' | 'results' (| 'demo' in DEV) */
  let screenName = 'world';
  /** The run being played: { runId, cfg, submit (submit.js), over, offline, results } */
  let run = null;
  /** An earlier run (from a past visit, or a result left unsaved) whose chunks are still being sent. */
  let leftover = null, leftoverFailed = false;
  let lastTeam = [];
  try { lastTeam = JSON.parse(localStorage.getItem(TEAM_KEY) || '[]'); } catch (e) { /* storage blocked */ }
  if (!Array.isArray(lastTeam)) lastTeam = [];

  /** Stops time and shows an empty board: the map of `cfg` (the run just played), or the menu map. */
  function backdrop(cfg) {
    running = false;
    const s = createSim(cfg || MENU_CFG);
    game.setSim(s);
    if (!map || map.seed !== s.map.seed) showMap(s.map);
    view.resetZoom();
  }

  const ui = createUI(rootEl, {
    exit: () => onExit(),
    reload: () => loadProgress(),
    stage: n => openTeam('stage', n),
    endless: () => openTeam('endless', 1),
    back: () => showWorld(),
    play: team => startRun(teamCtx.mode, teamCtx.stage, team),
    shop: (kind, id) => pickShop(kind, id),
    startWave: () => startWave(),
    speed: () => game.setSpeed(speed === 2 ? 1 : 2),
    pause: () => openPause(),
    resume: () => { ui.pause(null); game.resume(); },
    quality: name => setQuality(name),
    quit: () => quitRun(),
    sell: () => sellInfo(),
    closeInfo: () => closeInfo(),
    cancelMode: () => setMode(null),
    result: act => resultAction(act),
    resendLeftover: () => { if (leftover) { leftoverFailed = false; leftover.retry(); if (screenName === 'world') showWorld(); } },
    discardLeftover: () => { if (leftover) { leftover.drop(); leftover = null; ui.toast('Your last result was discarded'); if (screenName === 'world') showWorld(); } },
  });

  function relayout() {
    view.layout(); // sets the turn and the short-screen class that the HUD is measured in
    view.layout(ui.insets());
  }

  function loadProgress() {
    loadError = '';
    if (screenName === 'world') showWorld();
    api.progress().then(r => {
      if (!alive) return;
      progress = r.progress; unl = r.unlocked || unlockedOf(progress);
      if (screenName === 'world') showWorld();
    }).catch(() => {
      if (!alive) return;
      loadError = "Couldn't load your progress. Check your connection.";
      if (screenName === 'world') showWorld();
    });
  }

  /**
   * After the player leaves a result the server is still verifying (it finishes on its own), fetch progress again a few
   * times so a stage win shows up on the world map without a reload. Unlocks only ever come from the server.
   */
  function refreshProgressSoon() {
    for (const ms of [6000, 20000, 45000, 90000]) later(() => {
      api.progress().then(r => {
        if (!alive || !r || !r.progress) return;
        progress = r.progress; unl = r.unlocked || unlockedOf(progress);
        if (screenName === 'world') showWorld();
      }).catch(() => { /* the next mount loads it anyway */ });
    }, ms);
  }

  /** Runs the player left before the server had them (runId → mode), for the message once they are stored. */
  const leftModes = new Map();
  const savedSoonText = mode => mode === 'endless' ? 'Your score will appear on the leaderboard in a minute'
    : mode === 'stage' ? 'Your stars will be saved in a minute' : 'Your last result will be saved in a minute';

  function worldNote() {
    if (!leftover || !leftover.unsent) return null;
    // After a few failed attempts the player may give up on it (R44), so it can never block Play for good
    return leftoverFailed ? { text: "Your last result isn't saved yet.", bad: true, retry: true, discard: leftover.failures >= 3 } : { text: 'Saving your last result…', busy: true };
  }
  function showWorld() {
    screenName = 'world';
    setMode(null); closeInfo();
    ui.world({ progress, unlocked: unl, loading: !progress && !loadError, error: loadError, note: worldNote() });
    relayout();
  }

  let teamCtx = { mode: 'stage', stage: 1 };
  function openTeam(mode, stage, error = '', busy = false) {
    if (!unl) return;
    if (leftover && leftover.unsent) { ui.toast(leftoverFailed ? 'Retry saving your last result first' : 'Saving your last result first…', leftoverFailed); return; }
    screenName = 'team';
    teamCtx = { mode, stage };
    ui.team({ mode, stage, unlocked: unl, team: lastTeam, busy, error });
  }

  function startRun(mode, stage, team) {
    openTeam(mode, stage, '', true);
    if (screenName !== 'team') return;
    lastTeam = team;
    try { localStorage.setItem(TEAM_KEY, JSON.stringify(team)); } catch (e) { /* storage blocked */ }
    api.start({ mode, stage, team }).then(r => {
      if (!alive || screenName !== 'team') return;
      if (!r || typeof r.runId !== 'string' || !r.cfg) throw new Error("Couldn't start the run.");
      beginRun(r.runId, r.cfg);
    }).catch(e => {
      if (!alive || screenName !== 'team') return;
      openTeam(mode, stage, (e && e.message) || "Couldn't start the run. Check your connection.");
    });
  }

  /** Plays the run the server just created: the same sim (seed, team, traps, spells) the server will verify. */
  function beginRun(runId, cfg) {
    const s = createSim(cfg);
    game.setSim(s);
    showMap(s.map);
    run = { runId, cfg, submit: createRunSubmitter(api, runId, submitHandlers(runId)), over: false, offline: false, results: null };
    screenName = 'play';
    paused = false; running = true;
    setMode(null); closeInfo();
    ui.showHud(cfg);
    view.resetZoom();
    relayout();
  }

  function afterTick(evs) {
    if (!run || run.over || !running) return;
    const end = evs.find(e => e.type === 'end');
    if (end) {
      run.over = true;
      setMode(null); closeInfo(); input.cancel();
      run.results = { mode: run.cfg.mode, stage: run.cfg.stage, won: end.won, outcome: outcomeOf(sim), state: 'verify' };
      if (run.cfg.mode === 'stage' && !end.won) {
        // A lost stage records nothing (R33), so there is nothing to wait for or to keep (R44)
        run.submit.drop();
        Object.assign(run.results, { state: 'done', stars: 0 });
      } else run.submit.finish(sim, log);
      // Let the last moment play out before the results cover the board
      const r = run;
      later(() => { if (run === r && screenName === 'play') { screenName = 'results'; ui.results(r.results); } }, END_PAUSE_MS);
      return;
    }
    run.submit.afterTick(sim, log, evs);
    for (const e of evs) if (e.type === 'waveStart') ui.toast(`Wave ${e.wave}`);
  }

  /** What a run's submitter reports back: to the results screen for the run in play, to the world map otherwise. */
  function submitHandlers(runId) {
    const mine = () => run && run.runId === runId;
    const offWorld = () => { if (screenName === 'world') showWorld(); };
    return {
      onResult(res) {
        applyResult(res);
        if (!mine()) { if (leftover && leftover.runId === runId) leftover = null; ui.toast('Your last result was saved'); offWorld(); return; }
        const o = res.outcome;
        Object.assign(run.results, { state: 'done', outcome: o, won: o.won, stars: o.stars, score: o.score, best: res.best, rank: res.rank, newUnlocks: res.newUnlocks });
        run.offline = false;
        if (screenName === 'results') ui.results(run.results);
      },
      onReject(error) {
        if (!mine()) {
          if (leftover && leftover.runId === runId) leftover = null;
          ui.toast(friendlyError(error).replace('This run', 'Your last run'), true);
          offWorld();
          return;
        }
        // The server refused the run: it can't count, so stop it and say so
        run.over = true; running = false;
        setMode(null); closeInfo(); input.cancel(); ui.pause(null); game.resume();
        run.results = { mode: run.cfg.mode, stage: run.cfg.stage, won: false, outcome: outcomeOf(sim), state: 'rejected', error };
        screenName = 'results';
        ui.results(run.results);
      },
      onStored() {
        // The final chunk is on the server: nothing can be lost now, verification just takes a moment
        if (mine()) return;
        if (leftover && leftover.runId === runId) { leftover = null; leftoverFailed = false; }
        ui.toast(savedSoonText(leftModes.get(runId)));
        refreshProgressSoon();
        offWorld();
      },
      onProgress(verifiedTo, queuedTo) {
        if (!mine() || !run.results) return;
        // A cold server instance resumes from its last checkpoint, so verifiedTo can step back: the bar never does
        run.results.verify = Math.max(run.results.verify || 0, queuedTo > 0 ? Math.min(1, verifiedTo / queuedTo) : 0);
        if (screenName === 'results') ui.verifyProgress(run.results.verify);
      },
      onStatus(state, final) {
        if (!mine()) { leftoverFailed = state === 'failed'; offWorld(); return; }
        run.offline = state === 'failed';
        if (run.results && final && state === 'failed') { run.results.state = 'failed'; if (screenName === 'results') ui.results(run.results); }
      },
    };
  }
  /** Takes the server's progress from a final response and notes what it unlocked (res.newUnlocks). */
  function applyResult(res) {
    if (!res.progress) return;
    const before = unl || unlockedOf(progress || { cleared: {}, endlessBest: 0 });
    progress = res.progress; unl = unlockedOf(progress);
    res.newUnlocks = {
      mages: unl.mages.filter(k => !before.mages.includes(k)), traps: unl.traps.filter(k => !before.traps.includes(k)),
      spells: unl.spells.filter(k => !before.spells.includes(k)), endless: unl.endless && !before.endless,
    };
  }

  function resultAction(act) {
    const r = run;
    if (!r) { showWorld(); return; }
    if (act === 'resend') { r.results.state = 'verify'; ui.results(r.results); r.submit.retry(); return; }
    if (r.submit.finalStored && !r.submit.done) {
      // Leaving while the server still verifies: it finishes and records the run on its own (R43)
      r.submit.detach();
      ui.toast(savedSoonText(r.cfg.mode));
      refreshProgressSoon();
    } else if (r.submit.unsent) {
      // Leaving with the result unsaved: its submitter carries on from the world map
      leftover = r.submit; leftoverFailed = r.results.state === 'failed';
      leftModes.set(r.runId, r.cfg.mode);
      leftover.detach();
    }
    run = null;
    backdrop(r.cfg);
    showWorld();
    if (act === 'retry') startRun(r.cfg.mode, r.cfg.stage, r.cfg.team);
    else if (act === 'next') openTeam('stage', r.cfg.stage + 1);
  }

  function startWave() {
    if (!playing() || sim.phase !== 'build') return;
    setMode(null);
    game.queueAction({ type: 'startWave' });
  }
  function openPause() {
    if (screenName !== 'play' || !run || run.over) return;
    game.pause();
    input.cancel();
    ui.pause({ quality: view.quality.name, endless: run.cfg.mode === 'endless' });
  }
  function quitRun() {
    ui.pause(null);
    game.resume();
    if (!run) { showWorld(); return; }
    if (run.cfg.mode === 'endless' && !run.over) {
      // Ending Endless records the score so far: post the final chunk and wait for the verified result
      run.over = true; running = false;
      setMode(null); closeInfo();
      run.results = { mode: 'endless', stage: 1, won: false, outcome: outcomeOf(sim), state: 'verify' };
      run.submit.finish(sim, log);
      screenName = 'results';
      ui.results(run.results);
      return;
    }
    // A quit stage records nothing: forget its chunks
    run.submit.drop();
    const cfg = run.cfg;
    run = null;
    backdrop(cfg);
    showWorld();
  }

  // ================= Board interactions =================
  // `mode` is what the next board tap does: place a bought mage, set a trap, or aim a mage's active or the meteor.
  let mode = null, infoId = null, dragFrom = -1, hoverTile = -1, hlKey = '';
  const tileAt = t => sim.map.tiles[t];
  const mageAt = t => sim.mages.find(m => m.tile === t);
  const isPath = t => t >= 0 && tileAt(t).kind === 'path';
  const freeBuild = t => t >= 0 && tileAt(t).kind === 'build' && tileAt(t).terrain !== 'blocked' && !mageAt(t);
  const trapOk = t => isPath(t) && sim.map.path[0] !== t && !sim.traps.some(x => x.tile === t);
  const playing = () => screenName === 'play' && run && !run.over && !paused;
  const TRAP_NAME = { spike: 'Spike Trap', barricade: 'Barricade', frost: 'Frost Rune', mine: 'Blast Mine' };

  function setMode(m) {
    mode = m;
    if (m) closeInfo();
    let label = null, color;
    if (m && m.kind === 'place') { label = `Tap a tile to place the ${MAGES[m.id].name}${MAGES[m.id].boost.length ? ': glowing tiles boost it' : ''}`; color = MAGE_COLOR[m.id]; }
    else if (m && m.kind === 'trap') { label = `Tap the path to set the ${TRAP_NAME[m.id]}`; color = '#e2b866'; }
    else if (m && m.kind === 'cast') { label = 'Tap the path to aim'; color = MAGE_COLOR[m.element]; }
    else if (m) { label = 'Tap where the meteor should strike'; color = '#ff7a3d'; }
    ui.banner(label, color);
  }
  function pickShop(kind, id) {
    if (!playing()) return;
    if (mode && mode.id === id && mode.kind === (kind === 'mage' ? 'place' : kind)) { setMode(null); return; }
    if (kind === 'mage') {
      if (sim.gold < magePrice(sim)) { ui.toast(`Not enough gold: a mage costs ${magePrice(sim)}`, true); return; }
      setMode({ kind: 'place', id });
    } else if (kind === 'trap') {
      if (sim.traps.length >= MAX_TRAPS) { ui.toast(`At most ${MAX_TRAPS} traps at once`, true); return; }
      if (sim.gold < TRAPS[id].price) { ui.toast(`Not enough gold: costs ${TRAPS[id].price}`, true); return; }
      setMode({ kind, id });
    } else {
      if (sim.spellCd[id] > 0) { ui.toast(`Recharging: ready in ${Math.ceil(sim.spellCd[id] / TICK_HZ)} s`, true); return; }
      if (sim.gold < SPELLS[id].cost) { ui.toast(`Not enough gold: costs ${SPELLS[id].cost}`, true); return; }
      if (id === 'meteor') setMode({ kind, id });
      else { setMode(null); game.queueAction({ type: 'spell', spell: id }); }
    }
  }

  function onTap(tile, { long }) {
    if (!playing()) return;
    if (mode) {
      const m = mode;
      if (m.kind === 'place' && freeBuild(tile)) game.queueAction({ type: 'place', mage: m.id, tile });
      else if (m.kind === 'trap' && trapOk(tile)) game.queueAction({ type: 'trap', trap: m.id, tile });
      else if (m.kind === 'cast' && isPath(tile)) { const mg = sim.mages.find(x => x.id === m.mage); if (mg) game.queueAction({ type: 'cast', tile: mg.tile, target: tile }); }
      else if (m.kind === 'spell' && tile >= 0) game.queueAction({ type: 'spell', spell: 'meteor', target: tile });
      setMode(null); // a tap anywhere else cancels
      return;
    }
    const mg = tile >= 0 ? mageAt(tile) : null;
    if (!mg) { closeInfo(); return; }
    // A charged mage casts on tap (aimed actives ask for a path tile next); a long press always shows the details
    if (!long && mg.stunT <= 0 && mg.charge >= 1) {
      closeInfo();
      if (MAGES[mg.kind].activeTargeted) setMode({ kind: 'cast', mage: mg.id, element: mg.kind });
      else game.queueAction({ type: 'cast', tile: mg.tile });
      return;
    }
    if (infoId === mg.id && !long) closeInfo();
    else infoId = mg.id;
  }
  function closeInfo() { infoId = null; ui.mageInfo(null); }
  function sellInfo() {
    const mg = sim && sim.mages.find(m => m.id === infoId);
    if (!mg || !playing()) return;
    if (mg.stunT > 0) { ui.toast('Stunned mages can’t be sold', true); return; }
    game.queueAction({ type: 'sell', tile: mg.tile });
    closeInfo();
  }

  // Dragging a mage: onto the same mage at the same level merges, onto a free build tile moves, anything else snaps
  // back (Review Focus 1). A stunned mage can't be picked up (Review Focus 5).
  function onDragStart(tile) {
    if (!playing()) return false;
    const mg = mageAt(tile);
    if (!mg) return false;
    if (mode) setMode(null);
    closeInfo();
    if (mg.stunT > 0) { ui.toast('Stunned: this mage can’t move', true); return false; }
    dragFrom = tile;
    units.dragMage(mg.id, tile);
    return true;
  }
  function onDragMove(tile) {
    if (dragFrom < 0) return;
    const mg = mageAt(dragFrom);
    if (mg && tile >= 0) units.dragMage(mg.id, tile);
    hoverTile = tile;
  }
  /** What dropping the mage on `from` onto `to` does: { act: 'merge' | 'move' | null, why } (null snaps back). */
  function dropAction(from, to) {
    const a = mageAt(from);
    if (!a || to < 0 || to === from) return { act: null, why: '' };
    if (a.stunT > 0) return { act: null, why: 'This mage is stunned' };
    const b = mageAt(to);
    if (b) {
      if (b.kind !== a.kind) return { act: null, why: 'Only the same kind of mage can merge' };
      if (b.level !== a.level) return { act: null, why: 'Merging needs two mages of the same level' };
      if (b.level >= MAX_LEVEL) return { act: null, why: 'Already at the top level' };
      if (b.stunT > 0) return { act: null, why: 'That mage is stunned' };
      return { act: 'merge', why: '' };
    }
    if (freeBuild(to)) return { act: 'move', why: '' };
    return { act: null, why: isPath(to) ? 'Mages can’t stand on the path' : 'Nothing can stand there' };
  }
  function onDragEnd(from, to) {
    dragFrom = -1; hoverTile = -1;
    if (!playing() || !mageAt(from)) { units.dropMage(false); return; }
    const { act, why } = dropAction(from, to);
    if (act) game.queueAction({ type: act, from, to });
    else if (why) ui.toast(why, true);
    units.dropMage(!!act);
  }
  /** Long-press feedback: a ring fills under a finger held on a mage (the press becomes "show details"). */
  function onPress(tile, x, y) {
    const mg = tile >= 0 && playing() && !mode ? mageAt(tile) : null;
    ui.holdRing(mg ? x : null, y, mg ? MAGE_COLOR[mg.kind] : null);
  }
  const input = createInput(view, { tap: onTap, dragStart: onDragStart, dragMove: onDragMove, dragEnd: onDragEnd, press: onPress });

  /** An action the sim refused after all (the board changed before its tick): undo its preview. */
  function onRefused(a) {
    if (a.type === 'merge' || a.type === 'move') units.dropMage(false);
    if (run && !run.over) ui.toast('That can’t be done right now', true);
  }

  // Tile highlights, each kind on its own terrain channel so they never clobber one another: place mode (free tiles,
  // the ones that boost this mage in its colour), trap and aim modes (path tiles), and a drag (merge partners, plus the
  // tile under the pointer in green or red)
  function highlights() {
    if (!terrain) return;
    const ch = { free: [], boost: [], target: [], partner: [], hover: [] };
    let target = 0xffffff, hover = 0xffffff, boost = 0xffffff;
    if (screenName === 'play' && run && !run.over) {
      const all = sim.map.tiles;
      if (mode && mode.kind === 'place') {
        const b = MAGES[mode.id].boost;
        boost = MAGE_COLOR[mode.id];
        for (let t = 0; t < all.length; t++) if (freeBuild(t)) (b.includes(all[t].terrain) ? ch.boost : ch.free).push(t);
      } else if (mode && mode.kind !== 'place') {
        for (const t of sim.map.path) if (mode.kind !== 'trap' || trapOk(t)) ch.target.push(t);
        target = mode.kind === 'cast' ? MAGE_COLOR[mode.element] : mode.kind === 'spell' ? '#ff7a3d' : '#e2b866';
      } else if (dragFrom >= 0) {
        for (const m of sim.mages) if (dropAction(dragFrom, m.tile).act) ch.partner.push(m.tile);
        if (hoverTile >= 0 && hoverTile !== dragFrom) { ch.hover.push(hoverTile); hover = dropAction(dragFrom, hoverTile).act ? '#9dffb0' : '#ff6a5a'; }
      }
    }
    const key = JSON.stringify([ch, target, hover, boost]);
    if (key === hlKey) return;
    hlKey = key;
    terrain.setHighlight(ch.free, 0x7d8a8f, 'place');
    terrain.setHighlight(ch.boost, boost, 'boost');
    terrain.setHighlight(ch.target, target, 'target');
    terrain.setHighlight(ch.partner, 0xf3c95c, 'partner');
    terrain.setHighlight(ch.hover, hover, 'hover');
  }

  // ================= Portraits =================
  /** Renders each mage figure once for the shop, team cards and details (the UI shows emblems until then). */
  function makePortraits() {
    const need = Object.keys(MAGES).filter(k => !portraitCache[k]);
    if (need.length) {
      const kit = createKit(view.quality);
      try {
        for (const k of need) {
          const { root, nodes } = kit.mage(k);
          for (let i = 0; i < 4; i++) if (nodes['band' + i]) nodes['band' + i].visible = false;
          root.rotation.y = -0.35;
          portraitCache[k] = view.snapshot(root, { size: 128, from: [0, 0.47, 1.05], at: [0, 0.37, 0], fov: 30 });
        }
      } catch (e) { /* the emblems stay */ }
      kit.dispose();
    }
    ui.setPortraits(portraitCache);
  }

  // ================= Mount =================
  backdrop(null);
  showWorld();
  loadProgress();
  // A result left unsent last time goes out first (Review Focus 3); a run without a final chunk can't record anything (R44)
  const pending = takePendingRun();
  if (pending) {
    leftover = createRunSubmitter(api, pending.runId, submitHandlers(pending.runId), pending.batches);
    leftover.detach(); // once the server has it, the server finishes it; the world map only refreshes progress
    leftover.retry();
    showWorld();
  }
  later(makePortraits, 60);

  listen(window, 'resize', relayout);
  listen(window, 'orientationchange', relayout);
  // Review Focus 2: a hidden page stops the clock (some browsers still fire rAF in the background, and the first
  // frame back must not catch up on the time away); during a run it also opens the pause menu
  listen(document, 'visibilitychange', () => {
    hidden = document.hidden; last = performance.now();
    if (hidden) openPause();
  });
  listen(window, 'keydown', e => {
    if (e.key === 'Escape') {
      if (mode) setMode(null);
      else if (infoId !== null) closeInfo();
      else if (screenName === 'play' && paused) { ui.pause(null); game.resume(); }
      else openPause();
    } else if (e.key === ' ' && screenName === 'play') { e.preventDefault(); startWave(); }
  });

  let last = performance.now(), raf = 0;
  function frame(now) {
    // A rAF timestamp can predate the mount (it is the frame start), so clamp at 0 as well
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.25)); last = now;
    if (terrain) terrain.update(dt);
    if (sim && running && !paused && !hidden && !devHold) {
      acc += dt * speed * TICK_HZ;
      const n = Math.min(MAX_TICKS, Math.floor(acc));
      acc -= n;
      if (acc >= 1) acc %= 1; // over the cap: drop the backlog instead of running behind forever
      runTicks(n);
      if (demoEnemies && screenName === 'demo' && sim.enemies.length === 0) demoEnemies();
    }
    // Figures and effects keep animating while paused (flames flicker, particles settle); only the sim stops
    const fdt = hidden ? 0 : Math.min(dt, 0.1);
    if (sim && !devHold) { units.sync(sim, running ? acc : 1, fdt); fx.update(fdt, sim); }
    if (sim && screenName === 'play') {
      // An aimed cast lapses if its mage is sold, merged away or stunned meanwhile
      if (mode && mode.kind === 'cast' && !sim.mages.some(m => m.id === mode.mage && m.charge >= 1 && m.stunT <= 0)) setMode(null);
      const im = infoId !== null ? sim.mages.find(m => m.id === infoId) : null;
      if (infoId !== null && !im) closeInfo();
      const sel = !mode || mode.kind === 'cast' ? null : { kind: mode.kind === 'place' ? 'mage' : mode.kind, id: mode.id };
      ui.frame(sim, { speed, sel, offline: run && run.offline });
      if (im) ui.mageInfo(im, sim, (im.tile % W) < W / 2 ? 'r' : 'l');
    }
    highlights();
    const shake = fx.shakeOffset;
    view.camera.position.add(shake);
    view.render();
    view.camera.position.sub(shake);
    if (alive) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // DEV only: every mage at levels 1, 3 and 5 (built with real merge actions) and one enemy of each kind on the path,
  // tough enough to stay alive, for checking figures and effects (__mages.demo(); it ends any run in play).
  let demoEnemies = null;
  function demo() {
    const team = ['fire', 'ice', 'lightning', 'earth', 'poison', 'wind'];
    if (run) run.submit.stop();
    run = null; screenName = 'demo';
    ui.hideHud(); ui.pause(null); ui.world({ progress: null, unlocked: null });
    rootEl.querySelector('#screen').hidden = true;
    game.setSim(createSim({ seed: 1, mode: 'stage', stage: 1, team, traps: ['spike', 'barricade', 'frost', 'mine'], spells: ['meteor', 'freeze', 'surge'], __noLeak: true }));
    showMap(sim.map); running = true;
    relayout();
    sim.gold = 1e9;
    const all = sim.map.tiles, path = sim.map.path;
    const free = i => all[i] && all[i].kind === 'build' && all[i].terrain !== 'blocked' && all[i].terrain !== 'water';
    const near = i => path.filter(p => ((p % W) - (i % W)) ** 2 + (Math.floor(p / W) - Math.floor(i / W)) ** 2 <= 6.25).length;
    const used = new Set(), rows = [];
    const cands = [];
    for (let i = 0; i < all.length; i++) if (i % W <= W - 3 && free(i) && free(i + 1) && free(i + 2)) cands.push(i);
    cands.sort((a, b) => near(b) + near(b + 2) - near(a) - near(a + 2) || a - b);
    for (const i of cands) if (rows.length < team.length && ![i, i + 1, i + 2].some(t => used.has(t))) { rows.push(i); [i, i + 1, i + 2].forEach(t => used.add(t)); }
    const spares = [];
    for (let i = 0; i < all.length && spares.length < 4; i++) if (free(i) && !used.has(i)) spares.push(i);
    const build = (mage, lv, tile) => {
      if (lv === 1) { game.queueAction({ type: 'place', mage, tile }); return; }
      build(mage, lv - 1, tile);
      const sp = spares.pop();
      build(mage, lv - 1, sp);
      game.queueAction({ type: 'merge', from: sp, to: tile });
      spares.push(sp);
    };
    team.forEach((mage, k) => { if (rows[k] !== undefined) [1, 3, 5].forEach((lv, j) => build(mage, lv, rows[k] + j)); });
    runTicks(1);
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

  if (import.meta.env.DEV) {
    // DEV hooks for visual checks and play-tests: tick(n) steps the sim (a run posts its chunks as in play), pause(on)
    // stops the clock; cast/spell/trap/startWave queue an action and run one tick so its events fire at once;
    // focus(x, z, dist) points the camera at a board-centred world point from closer in (layout() restores the framing).
    const now1 = () => runTicks(1);
    window.__mages = {
      view, game, ui, input, get terrain() { return terrain; }, get units() { return units; }, get fx() { return fx; }, get sim() { return sim; },
      get run() { return run; }, get screen() { return screenName; }, get progress() { return progress; },
      setQuality, showMap: seed => showMap(generateMap(seed)), demo,
      tick: n => runTicks(n), pause: on => { paused = on; }, respawn: () => demoEnemies && demoEnemies(),
      /** hold(true): the loop stops moving time and only renders; advance(secs) then steps sim, figures and effects in 1/30 s steps. */
      hold: on => { devHold = on; },
      advance(secs, simToo = true) {
        for (let i = Math.round(secs * TICK_HZ); i > 0; i--) {
          if (simToo) runTicks(1);
          units.sync(sim, 0, 1 / TICK_HZ); fx.update(1 / TICK_HZ, sim);
        }
      },
      programs: () => view.renderer.info.programs.length,
      /** Fills the mage's meter and casts its active (`target`: a path tile, for targeted actives). */
      cast(tile, target) { const m = sim.mages.find(o => o.tile === tile); if (m) m.charge = 1; game.queueAction({ type: 'cast', tile, target }); now1(); },
      spell(kind, target) { sim.spellCd[kind] = 0; game.queueAction({ type: 'spell', spell: kind, target }); now1(); },
      trap(kind, tile) { game.queueAction({ type: 'trap', trap: kind, tile }); now1(); },
      startWave() { game.queueAction({ type: 'startWave' }); now1(); },
      focus(x, z, dist = 2.5, tilt = 0.6, yaw = 0, lift = 0.3) {
        const y = view.groundAt(x, z) + lift, c = view.camera;
        c.clearViewOffset(); c.zoom = 1;
        c.position.set(x + Math.sin(yaw) * Math.cos(tilt) * dist, y + Math.sin(tilt) * dist, z + Math.cos(yaw) * Math.cos(tilt) * dist);
        c.lookAt(x, y, z); c.updateProjectionMatrix();
      },
    };
  }

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
    for (const [target, type, fn] of unlisten) target.removeEventListener(type, fn);
    // Unsent chunks stay in storage for the next visit
    if (run) run.submit.stop();
    if (leftover) leftover.stop();
    input.dispose();
    fx.dispose();
    units.dispose();
    if (terrain) terrain.dispose();
    view.dispose();
    shadow.innerHTML = '';
    if (import.meta.env.DEV) delete window.__mages;
  };
}
