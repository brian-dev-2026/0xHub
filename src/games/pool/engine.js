// 8-Ball Pool: a real-time 3D pool game (8-ball, 9-ball, practice) with a bot, cue spin and skins.
// It renders inside a shadow root so the app's global styles (.btn, .glass, …) cannot leak in.
import * as THREE from 'three';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap';

const CSS = `
/* Layout: full-bleed WebGL table; glass HUD hugs the edges (cards top, power left, spin + fine aim right; bottom bar in portrait) */
:host {
  --bg: #0b0d0e;
  --glass: rgba(17, 19, 21, 0.7);
  --glass-hi: rgba(30, 33, 36, 0.82);
  --line: rgba(255, 255, 255, 0.09);
  --fg: #f1ede4;
  --muted: #9aa0a3;
  --accent: #d8b26a;
  --danger: #ef5b5b;
  --display: "Barlow Condensed", "Arial Narrow", sans-serif;
  --body: "Barlow", system-ui, sans-serif;
  color-scheme: dark;
}
[hidden] { display: none !important; }
.root { position: fixed; inset: 0; overflow: hidden; background: var(--bg); color: var(--fg); font-family: var(--body); -webkit-tap-highlight-color: transparent; }
#c { position: fixed; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
button { font: inherit; color: inherit; }
button:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.glass { background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); }
.label { font-family: var(--display); font-weight: 600; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }

/* ---------- Mini balls (cards, locker) ---------- */
.mb { width: 16px; height: 16px; border-radius: 50%; position: relative; flex: none;
  --hl: radial-gradient(circle at 32% 28%, rgba(255,255,255,.8) 0 7%, rgba(255,255,255,0) 32%);
  --sh: radial-gradient(circle at 50% 60%, rgba(0,0,0,0) 55%, rgba(0,0,0,.5));
  background: var(--hl), var(--sh), var(--c); box-shadow: 0 1px 3px rgba(0,0,0,.5); transition: opacity .3s, transform .3s; }
.mb.st { background: var(--hl), var(--sh), linear-gradient(#f3eee0 0 27%, var(--c) 27% 73%, #f3eee0 73%); }
.mb::after { content: ""; position: absolute; inset: 4.5px; border-radius: 50%; background: #f3eee0; }
.mb.gone { opacity: .16; transform: scale(.82); }
.mb.slot { background: none; box-shadow: none; border: 1px dashed rgba(255,255,255,.18); }
.mb.slot::after { display: none; }

/* ---------- Top bar ---------- */
.topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 5; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); grid-template-areas: "p0 mid p1"; gap: 12px; align-items: center;
  padding-block: calc(10px + env(safe-area-inset-top, 0px)) 10px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: linear-gradient(rgba(11,13,14,.9), rgba(11,13,14,0)); pointer-events: none; }
.topbar > * { pointer-events: auto; }
.pcard { position: relative; overflow: hidden; }
.pcard .tbar { position: absolute; left: 0; bottom: 0; height: 3px; width: calc(var(--t, 0) * 100%); background: var(--accent); }
.pcard .tbar.low { background: var(--danger); }
.pcard { grid-area: p0; display: flex; align-items: center; gap: 10px; padding: 7px 14px 7px 7px; border-radius: 16px; min-width: 0; justify-self: start; transition: box-shadow .25s, border-color .25s; }
.pcard.p1 { grid-area: p1; justify-self: end; flex-direction: row-reverse; padding: 7px 7px 7px 14px; }
.pcard.p1 .pinfo { align-items: flex-end; }
.pcard.p1 .pballs { flex-direction: row-reverse; }
.pcard.active { border-color: rgba(216,178,106,.7); box-shadow: 0 0 0 1px rgba(216,178,106,.35), 0 0 24px rgba(216,178,106,.18); }
.av { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; flex: none; font-family: var(--display); font-weight: 700; font-size: 18px;
  background: linear-gradient(140deg, #3a3f45, #1c1f22); border: 1px solid var(--line); position: relative; }
.pcard.active .av { background: linear-gradient(140deg, #e9c983, #a8803a); color: #1a1408; }
.pinfo { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pname { font-family: var(--display); font-weight: 700; font-size: 17px; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; gap: 8px; align-items: baseline; }
.pname small { font-weight: 600; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.pballs { display: flex; flex-wrap: wrap; gap: 3px; }
@media (max-width: 760px) { .pballs .mb { width: 12px; height: 12px; } .pballs .mb::after { inset: 3.5px; } .pill { padding: 8px 12px; font-size: 13px; } }
.mid { grid-area: mid; display: flex; align-items: center; gap: 8px; }
.pill { padding: 9px 16px; border-radius: 999px; font-family: var(--display); font-weight: 600; font-size: 15px; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.pill .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-right: 8px; vertical-align: 2px; box-shadow: 0 0 8px var(--accent); }
.ibtn { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; cursor: pointer; font-family: var(--display); font-weight: 700; font-size: 13px; letter-spacing: .06em; }
.ibtn svg { width: 18px; height: 18px; }

/* ---------- Power (landscape: vertical on the left) ---------- */
.power { position: fixed; z-index: 4; left: max(16px, env(safe-area-inset-left, 0px)); top: 50%; transform: translateY(-38%); width: 64px; height: min(58vh, 380px);
  border-radius: 20px; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 8px; touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }
.power .track { position: relative; flex: 1; width: 28px; border-radius: 14px; background: rgba(0,0,0,.45); overflow: hidden; box-shadow: inset 0 2px 8px rgba(0,0,0,.6); }
.power .fill { position: absolute; left: 0; right: 0; top: 0; height: calc(var(--p, 0) * 100%); background: linear-gradient(#f1d58f, #d8b26a 40%, #e2734a 85%, #ef5b5b); opacity: .9; }
.power canvas { position: absolute; left: 50%; top: 6px; width: 14px; transform: translate(-50%, calc(var(--p, 0) * 55%)); pointer-events: none; }
.power .pv { font-family: var(--display); font-weight: 700; font-size: 15px; font-variant-numeric: tabular-nums; }
.power[aria-disabled="true"], .wheel[aria-disabled="true"], .spinbtn[aria-disabled="true"] { opacity: .4; pointer-events: none; }

/* ---------- Right column ---------- */
.spinbtn { position: fixed; z-index: 4; right: max(16px, env(safe-area-inset-right, 0px)); top: calc(env(safe-area-inset-top, 0px) + 78px); width: 64px; padding: 8px 0 7px; border-radius: 20px;
  display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; }
.cueball { --x: 0; --y: 0; position: relative; border-radius: 50%; background: radial-gradient(circle at 34% 30%, #fff 0 8%, #f3eee0 30%, #d7d0bf 70%, #a69e8c); box-shadow: inset -3px -5px 10px rgba(0,0,0,.25), 0 3px 10px rgba(0,0,0,.4); }
.cueball.sm { width: 40px; height: 40px; }
.cueball .hit { position: absolute; width: 22%; height: 22%; border-radius: 50%; background: #e23b3b; box-shadow: 0 0 0 2px rgba(255,255,255,.7);
  left: calc(50% + var(--x) * 50% - 11%); top: calc(50% - var(--y) * 50% - 11%); }
.wheel { position: fixed; z-index: 4; right: calc(max(16px, env(safe-area-inset-right, 0px)) + 10px); top: 50%; transform: translateY(-30%); width: 44px; height: min(44vh, 280px);
  border-radius: 14px; touch-action: none; cursor: ns-resize; overflow: hidden; --o: 0px;
  background: linear-gradient(90deg, rgba(0,0,0,.55), rgba(255,255,255,.06) 50%, rgba(0,0,0,.55)), repeating-linear-gradient(0deg, #2b2f33 0 3px, #15171a 3px 9px); background-position: 0 0, 0 var(--o); }

/* ---------- Toast ---------- */
.toast { position: fixed; z-index: 6; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 74px); transform: translate(-50%, -8px); opacity: 0; pointer-events: none;
  padding: 10px 18px; border-radius: 14px; font-weight: 600; font-size: 15px; max-width: min(92vw, 520px); text-align: center; transition: opacity .25s, transform .25s; }
.toast.on { opacity: 1; transform: translate(-50%, 0); }
.toast.bad { border-color: rgba(239,91,91,.55); }

/* ---------- Portrait layout ---------- */
.root.portrait .topbar { grid-template-columns: 1fr 1fr; grid-template-areas: "p0 p1" "mid mid"; row-gap: 8px; }
.root.portrait .pcard { justify-self: stretch; }
.root.portrait .mid { justify-self: center; }
.root.portrait .topbar:has(#card1[hidden]) #card0 { grid-column: 1 / -1; }
.root.portrait .pballs .mb { width: 13px; height: 13px; }
.root.portrait .pballs .mb::after { inset: 3.5px; }
.root.portrait .power { top: auto; transform: none; bottom: calc(env(safe-area-inset-bottom, 0px) + 16px); left: max(16px, env(safe-area-inset-left, 0px)); right: calc(max(16px, env(safe-area-inset-right, 0px)) + 76px);
  width: auto; height: 64px; flex-direction: row; padding: 0 14px 0 10px; }
.root.portrait .power .track { height: 28px; width: auto; flex: 1; }
.root.portrait .power .fill { top: 0; bottom: 0; left: auto; right: 0; height: auto; width: calc(var(--p, 0) * 100%); background: linear-gradient(270deg, #f1d58f, #d8b26a 40%, #e2734a 85%, #ef5b5b); }
.root.portrait .power canvas { top: 50%; left: auto; right: 6px; width: auto; height: 14px; transform: translate(calc(var(--p, 0) * -55%), -50%); }
.root.portrait .spinbtn { top: auto; bottom: calc(env(safe-area-inset-bottom, 0px) + 16px); height: 64px; padding: 0; justify-content: center; }
.root.portrait .spinbtn .label { display: none; }
.root.portrait .wheel { top: auto; transform: none; right: max(16px, env(safe-area-inset-right, 0px)); left: max(16px, env(safe-area-inset-left, 0px)); bottom: calc(env(safe-area-inset-bottom, 0px) + 90px);
  width: auto; height: 34px; cursor: ew-resize;
  background: linear-gradient(rgba(0,0,0,.55), rgba(255,255,255,.06) 50%, rgba(0,0,0,.55)), repeating-linear-gradient(90deg, #2b2f33 0 3px, #15171a 3px 9px); background-position: 0 0, var(--o) 0; }
.root.portrait .toast { top: calc(env(safe-area-inset-top, 0px) + 128px); }

/* ---------- Screens & sheets ---------- */
.menu-card { margin-top: auto; }
.screen { position: fixed; inset: 0; z-index: 8; display: flex; align-items: flex-start; padding-block: calc(24px + env(safe-area-inset-top, 0px)) calc(24px + env(safe-area-inset-bottom, 0px));
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: radial-gradient(120% 90% at 0% 100%, rgba(11,13,14,.92) 20%, rgba(11,13,14,0) 70%); overflow-y: auto; }
.menu-card { width: min(460px, 100%); border-radius: 24px; padding: 26px; display: flex; flex-direction: column; gap: 18px; }
.brandline { display: flex; align-items: center; gap: 10px; }
.brandline b { font-family: var(--display); font-weight: 700; font-size: 15px; letter-spacing: .08em; }
.brandline b span { color: var(--accent); }
h1 { margin: 0; font-family: var(--display); font-weight: 700; font-size: clamp(52px, 9vw, 80px); line-height: .9; letter-spacing: -.01em; text-wrap: balance; }
.lede { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.5; }
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.mode { text-align: left; padding: 14px; border-radius: 16px; background: rgba(255,255,255,.04); border: 1px solid var(--line); cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.mode b { font-family: var(--display); font-size: 20px; font-weight: 700; letter-spacing: .02em; }
.mode span { font-size: 13px; color: var(--muted); }
.mode[aria-pressed="true"] { border-color: rgba(216,178,106,.75); background: rgba(216,178,106,.1); }
.opts { display: flex; flex-direction: column; gap: 8px; }
.seg { display: flex; padding: 3px; border-radius: 12px; background: rgba(0,0,0,.35); border: 1px solid var(--line); }
.seg button { flex: 1; padding: 9px 8px; border: 0; background: none; border-radius: 9px; cursor: pointer; font-family: var(--display); font-weight: 600; font-size: 14px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.seg button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
.names { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.names input { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 12px; border: 1px solid var(--line); background: rgba(0,0,0,.35); color: var(--fg); font: 500 15px var(--body); }
.row { display: flex; gap: 10px; }
.btn { padding: 14px 18px; border-radius: 14px; border: 1px solid var(--line); background: rgba(255,255,255,.06); cursor: pointer; font-family: var(--display); font-weight: 700; font-size: 16px; letter-spacing: .1em; text-transform: uppercase; }
.btn.primary { flex: 1; border: 0; color: #1a1408; background: linear-gradient(140deg, #f0d48e, #c99a4b); box-shadow: 0 8px 24px rgba(216,178,106,.25); }
.btn.wide { width: 100%; }
.equipped { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px; background: rgba(0,0,0,.3); border: 1px solid var(--line); cursor: pointer; text-align: left; }
.equipped canvas { width: 120px; height: 14px; flex: none; }
.equipped .meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.equipped .meta b { font-family: var(--display); font-size: 16px; font-weight: 700; letter-spacing: .03em; }
.equipped .meta span { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.modal { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; background: rgba(5,6,7,.55); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.sheet { width: min(380px, 100%); border-radius: 22px; padding: 22px; display: flex; flex-direction: column; gap: 14px; background: var(--glass-hi); }
.sheet h2 { margin: 0; font-family: var(--display); font-weight: 700; font-size: 30px; letter-spacing: .01em; }
.sheet p { margin: 0; color: var(--muted); line-height: 1.5; }
.bigball { width: min(230px, 60vw); aspect-ratio: 1; margin: 6px auto; touch-action: none; cursor: crosshair; }
.bigball::before, .bigball::after { content: ""; position: absolute; background: rgba(0,0,0,.14); }
.bigball::before { left: 50%; top: 8%; bottom: 8%; width: 1px; }
.bigball::after { top: 50%; left: 8%; right: 8%; height: 1px; }
.spinread { display: flex; justify-content: space-between; font-family: var(--display); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; font-size: 13px; color: var(--muted); }

.locker { position: fixed; z-index: 11; top: 0; right: 0; bottom: 0; width: min(460px, 100%); display: flex; flex-direction: column; background: var(--glass-hi); border-left: 1px solid var(--line);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); padding-block: calc(18px + env(safe-area-inset-top, 0px)) calc(18px + env(safe-area-inset-bottom, 0px));
  padding-left: 18px; padding-right: max(18px, env(safe-area-inset-right, 0px)); gap: 14px; box-sizing: border-box; }
.locker header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.locker h2 { margin: 0; font-family: var(--display); font-weight: 700; font-size: 30px; }
.skins { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; overflow-y: auto; padding: 2px; align-content: start; }
.skin { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 16px; border: 1px solid var(--line); background: rgba(255,255,255,.04); cursor: pointer; text-align: left; min-width: 0; }
.skin canvas { width: 100%; height: auto; display: block; border-radius: 10px; }
.skin.cue canvas { background: radial-gradient(120% 140% at 50% 0%, #2a2e33, #121416); padding: 18px 6px; box-sizing: border-box; }
.skin .sn { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.skin b { font-family: var(--display); font-size: 16px; font-weight: 700; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skin .fxl { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.skin .fxl.on::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--fx); box-shadow: 0 0 8px var(--fx); flex: none; }
.skin[aria-pressed="true"] { border-color: rgba(216,178,106,.8); background: rgba(216,178,106,.1); }
.tag { font-family: var(--display); font-weight: 600; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; padding: 3px 7px; border-radius: 6px; flex: none; background: rgba(255,255,255,.08); color: var(--muted); }
.tag.Pro { color: #8fb8ff; background: rgba(90,140,255,.14); }
.tag.Modern { color: #d5dbe2; background: rgba(210,220,230,.12); }
.tag.Neon { color: #5ff0ff; background: rgba(40,231,255,.13); }
.tag.Lux { color: #f0cf85; background: rgba(216,178,106,.15); }
.tag.Legend { color: #ff8a6a; background: rgba(255,110,80,.15); }
.over-title { font-size: 44px !important; }

@media (prefers-reduced-motion: reduce) { .toast, .mb, .pcard { transition: none; } }
@media (max-width: 520px) { .menu-card { padding: 20px; } .modes { grid-template-columns: 1fr; } .skins { grid-template-columns: 1fr 1fr; } }
`;

const MARKUP = `<canvas id="c" tabindex="0" aria-label="Pool table"></canvas>

<!-- In-game HUD -->
<div id="hud" hidden>
  <header class="topbar">
    <div class="pcard glass" id="card0"><div class="av"></div><div class="pinfo"><div class="pname"></div><div class="pballs"></div></div><i class="tbar"></i></div>
    <div class="mid">
      <div class="pill glass" id="pill"></div>
      <button class="ibtn glass" id="viewBtn" aria-label="Switch camera">3D</button>
      <button class="ibtn glass" id="menuBtn" aria-label="Pause"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5v14M15 5v14"/></svg></button>
    </div>
    <div class="pcard p1 glass" id="card1"><div class="av"></div><div class="pinfo"><div class="pname"></div><div class="pballs"></div></div><i class="tbar"></i></div>
  </header>
  <div class="power glass" id="power" role="slider" aria-label="Shot power. Pull back and release to shoot" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
    <div class="track"><div class="fill"></div><canvas id="powerCue"></canvas></div>
    <div class="pv" id="pv">0</div>
  </div>
  <button class="spinbtn glass" id="spinBtn" aria-label="Cue ball spin"><span class="cueball sm" id="spinMini"><i class="hit"></i></span><span class="label">Spin</span></button>
  <div class="wheel glass" id="wheel" aria-label="Fine aim: drag to nudge the cue"></div>
  <div class="toast glass" id="toast" role="status" aria-live="polite"></div>
</div>

<!-- Main menu -->
<section class="screen" id="menu">
  <div class="menu-card glass">
    <div class="brandline"><button class="ibtn glass" id="exitBtn" aria-label="Back to games"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button><b>0x<span>Hub</span></b><span class="label">Pool</span></div>
    <h1 id="gameTitle">8-Ball</h1>
    <p class="lede" id="gameLede">Real-time 3D pool with real ball physics. Pot your group, then sink the 8.</p>
    <div class="opts">
      <span class="label">Game</span>
      <div class="seg" id="gameSeg"><button data-v="8" aria-pressed="true">8-Ball</button><button data-v="9" aria-pressed="false">9-Ball</button><button data-v="practice" aria-pressed="false">Practice</button></div>
    </div>
    <div class="modes" id="modeCards">
      <button class="mode" id="mCpu" aria-pressed="true"><b>Vs Computer</b><span>Play against the bot</span></button>
      <button class="mode" id="m2p" aria-pressed="false"><b>2 Players</b><span>Pass and play on this device</span></button>
    </div>
    <div class="opts" id="cpuOpts">
      <span class="label">Difficulty</span>
      <div class="seg" id="diffSeg"><button data-d="easy" aria-pressed="false">Easy</button><button data-d="normal" aria-pressed="true">Normal</button><button data-d="hard" aria-pressed="false">Hard</button></div>
    </div>
    <div class="opts" id="pvpOpts" hidden>
      <span class="label">Players</span>
      <div class="names"><input id="n0" maxlength="14" value="Player 1" aria-label="Player 1 name" autocomplete="off"><input id="n1" maxlength="14" value="Player 2" aria-label="Player 2 name" autocomplete="off"></div>
    </div>
    <div class="opts"><span class="label">Lighting</span><div class="seg" id="lightSeg"><button data-v="moody" aria-pressed="false">Moody</button><button data-v="bright" aria-pressed="true">Bright</button><button data-v="studio" aria-pressed="false">Studio</button></div></div>
    <div class="names">
      <div class="opts"><span class="label">Guideline</span><div class="seg" id="guideSeg"><button data-v="long" aria-pressed="true">Long</button><button data-v="short" aria-pressed="false">Short</button><button data-v="off" aria-pressed="false">Off</button></div></div>
      <div class="opts" id="timerOpts"><span class="label">Shot timer</span><div class="seg" id="timerSeg"><button data-v="0" aria-pressed="true">Off</button><button data-v="30" aria-pressed="false">30s</button><button data-v="15" aria-pressed="false">15s</button></div></div>
    </div>
    <button class="equipped" id="lockerOpen">
      <canvas id="eqCue" width="480" height="56"></canvas>
      <span class="meta"><b>Locker</b><span id="eqText">Classic cue · Club Green table</span></span>
    </button>
    <div class="row"><button class="btn primary" id="play">Play</button></div>
  </div>
</section>

<!-- Spin -->
<div class="modal" id="spinSheet" hidden>
  <div class="sheet glass">
    <h2>Cue ball spin</h2>
    <p>Drag the red dot to where the cue tip strikes. Low for draw (back spin), high for follow, left or right for english off the cushions.</p>
    <div class="cueball bigball" id="bigBall"><i class="hit"></i></div>
    <div class="spinread"><span id="spinTxt">Center</span><span id="spinTxt2"></span></div>
    <div class="row"><button class="btn" id="spinReset">Center</button><button class="btn primary" id="spinDone">Done</button></div>
  </div>
</div>

<!-- Pause -->
<div class="modal" id="pause" hidden>
  <div class="sheet glass">
    <h2>Paused</h2>
    <div class="opts"><span class="label">Lighting</span><div class="seg" id="lightSeg2"><button data-v="moody" aria-pressed="false">Moody</button><button data-v="bright" aria-pressed="true">Bright</button><button data-v="studio" aria-pressed="false">Studio</button></div></div>
    <button class="btn primary wide" id="resume">Resume</button>
    <button class="btn wide" id="pLocker">Locker</button>
    <button class="btn wide" id="restart">Restart game</button>
    <button class="btn wide" id="quit">Quit to menu</button>
  </div>
</div>

<!-- Game over -->
<div class="modal" id="over" hidden>
  <div class="sheet glass">
    <span class="label" id="overEyebrow">Game over</span>
    <h2 class="over-title" id="overTitle"></h2>
    <p id="overText"></p>
    <div class="row"><button class="btn" id="overMenu">Menu</button><button class="btn primary" id="rematch">Rematch</button></div>
  </div>
</div>

<!-- Locker -->
<aside class="locker" id="locker" hidden aria-label="Locker">
  <header><h2>Locker</h2><button class="ibtn glass" id="lockerClose" aria-label="Close locker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
  <div class="seg" id="lockTabs"><button data-t="cues" aria-pressed="true">Cues</button><button data-t="tables" aria-pressed="false">Tables</button></div>
  <div class="skins" id="skins"></div>
</aside>`;

/** Mounts the game into `host` and returns a function that tears it down. */
export function mountPool(host, { onExit }) {
  // Fonts declared inside a shadow root are ignored, so load them on the page
  if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT_HREF });
    document.head.append(link);
  }
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style><div class="root">${MARKUP}</div>`;
  const rootEl = shadow.querySelector('.root');
  let alive = true;
  const unlisten = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); unlisten.push([target, type, fn]); };

  const $ = id => shadow.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('0xhub8b.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('0xhub8b.' + k, JSON.stringify(v)); } catch (e) {} },
  };

  // ================= Constants (metres, WPA 9 ft table) =================
  const R = 0.028575, L = 1.27, W = 0.635, HEAD = -L / 2, FOOT = L / 2, CUT = 0.055, STEP = 1 / 480;
  const COLORS = { 1: '#f0b400', 2: '#1747a6', 3: '#c8201e', 4: '#4a2a83', 5: '#ea6a17', 6: '#0e6e3c', 7: '#7d1a1d', 8: '#121214' };
  const IVORY = '#f3eee0';
  const colorOf = n => COLORS[n > 8 ? n - 8 : n];
  const grp = n => n < 8 ? 'solid' : n > 8 ? 'stripe' : 'eight';

  const POCKETS = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) POCKETS.push({ cx: sx * (L + 0.012), cy: sy * (W + 0.012), r: 0.068, sx: sx * (L + 0.028), sy: sy * (W + 0.028), vr: 0.064, side: false });
  for (const sy of [-1, 1]) POCKETS.push({ cx: 0, cy: sy * (W + 0.035), r: 0.05, sx: 0, sy: sy * (W + 0.04), vr: 0.056, side: true });

  // ================= Skins =================
  const WOOD = {
    maple: ['#d8b98a', [150, 110, 60], [240, 220, 180]], walnut: ['#5a2c18', [28, 10, 4], [150, 85, 50]], ebony: ['#1b1410', [0, 0, 0], [80, 60, 45]],
    rosewood: ['#4a1a14', [20, 4, 2], [120, 50, 35]], mahogany: ['#6b2015', [30, 6, 4], [160, 70, 50]], oak: ['#9a7040', [60, 38, 18], [200, 160, 110]],
    lacquer: ['#141414', [0, 0, 0], [58, 58, 58]],
  };
  const GOLD = { color: '#d4af37', metal: 1, rough: 0.25 }, BRASS = { color: '#c9a45c', metal: 1, rough: 0.28 }, CHROME = { color: '#d9dde2', metal: 1, rough: 0.12 };
  const CUES = [
    { id: 'classic', name: 'Classic', tag: 'Classic', shaft: { wood: 'maple' }, joint: BRASS, fore: { wood: 'walnut' }, wrap: { color: '#151515', rough: 0.75 }, sleeve: { wood: 'walnut' }, cap: BRASS },
    { id: 'ebony', name: 'Ebony Gold', tag: 'Pro', shaft: { wood: 'maple' }, joint: GOLD, fore: { points: { base: { wood: 'ebony' }, inlay: '#d4af37' } }, wrap: { color: '#0d0d0d', rough: 0.55, coat: 0.3 }, sleeve: { wood: 'ebony' }, cap: GOLD },
    { id: 'carbon', name: 'Carbon X', tag: 'Modern', shaft: { carbon: 1 }, joint: CHROME, fore: { carbon: 1 }, wrap: { color: '#c3122b', rough: 0.5 }, sleeve: { carbon: 1 }, cap: CHROME },
    { id: 'neon', name: 'Neon Pulse', tag: 'Neon', shaft: { color: '#1a1d22', rough: 0.3, coat: 1 }, joint: { color: '#28e7ff', glow: 1 }, fore: { neon: { base: '#0b0f14', glow: '#28e7ff' } }, wrap: { color: '#0c0c10', rough: 0.6 }, sleeve: { neon: { base: '#0b0f14', glow: '#ff3ad8' } }, cap: { color: '#ff3ad8', glow: 1 } },
    { id: 'dragon', name: 'Crimson Dragon', tag: 'Legend', shaft: { wood: 'maple' }, joint: GOLD, fore: { points: { base: { color: '#7d0f12' }, inlay: '#e7c46a' } }, wrap: { color: '#111111', rough: 0.6 }, sleeve: { color: '#7d0f12', rough: 0.25, coat: 1 }, cap: GOLD },
    { id: 'glacier', name: 'Glacier', tag: 'Pro', shaft: { wood: 'maple' }, joint: CHROME, fore: { points: { base: { color: '#eef3f7' }, inlay: '#4fb6e8' } }, wrap: { color: '#21415a', rough: 0.55 }, sleeve: { color: '#eef3f7', rough: 0.2, coat: 1 }, cap: CHROME },
    { id: 'rosewood', name: 'Rosewood', tag: 'Classic', shaft: { wood: 'maple' }, joint: BRASS, fore: { points: { base: { wood: 'rosewood' }, inlay: '#e5cf9d' } }, wrap: { color: '#2a1a12', rough: 0.7 }, sleeve: { wood: 'rosewood' }, cap: BRASS },
    { id: 'chrome', name: 'Chrome Reaper', tag: 'Modern', shaft: { color: '#2a2d31', rough: 0.25, coat: 1 }, joint: CHROME, fore: { color: '#cfd4da', metal: 1, rough: 0.12 }, wrap: { color: '#0b0b0b', rough: 0.6 }, sleeve: { color: '#3a3d42', metal: 1, rough: 0.2 }, cap: CHROME },
  ];
  const TABLES = [
    { id: 'club', name: 'Club Green', tag: 'Classic', cloth: '#1b5a40', rail: { wood: 'walnut' }, irons: '#c9a45c' },
    { id: 'pro', name: 'Tournament Blue', tag: 'Pro', cloth: '#1f4f93', rail: { wood: 'lacquer' }, irons: '#d9dde2' },
    { id: 'crimson', name: 'Crimson Lounge', tag: 'Lux', cloth: '#7a1622', rail: { wood: 'mahogany' }, irons: '#d4af37' },
    { id: 'midnight', name: 'Midnight Neon', tag: 'Neon', cloth: '#181b20', rail: { carbon: 1 }, irons: '#d9dde2', led: '#28e7ff' },
    { id: 'royal', name: 'Royal Purple', tag: 'Lux', cloth: '#4a2368', rail: { wood: 'ebony' }, irons: '#d4af37' },
    { id: 'teal', name: 'Teal Coast', tag: 'Modern', cloth: '#0f6a6a', rail: { wood: 'oak' }, irons: '#d9dde2' },
  ];
  // Animated effects per skin (Classic cue and Club Green table stay plain)
  const CUE_FX = {
    ebony: { kind: 'sparkle', color: '#ffd56b', label: 'Gold sparkle' },
    carbon: { kind: 'ring', color: '#ff2a3d', label: 'Energy ring' },
    neon: { kind: 'neon', color: '#28e7ff', color2: '#ff3ad8', label: 'Neon pulse' },
    dragon: { kind: 'embers', color: '#ff7a1a', label: 'Dragon embers' },
    glacier: { kind: 'frost', color: '#bfeaff', label: 'Frost' },
    rosewood: { kind: 'dust', color: '#ffb35c', label: 'Ember dust' },
    chrome: { kind: 'wisp', color: '#9d6bff', label: 'Phantom wisps' },
  };
  const TABLE_FX = {
    pro: { kind: 'crest', color: '#9cc4ff', crest: '#cfe0ff', label: 'Felt crest' },
    crimson: { kind: 'motes', color: '#ffcf7a', label: 'Gold motes' },
    midnight: { kind: 'neon', color: '#28e7ff', label: 'Color-shift LEDs' },
    royal: { kind: 'stars', color: '#e6c6ff', crest: '#e8c56a', label: 'Starfield' },
    teal: { kind: 'water', color: '#7ff5ea', label: 'Water light' },
  };
  // Cue segments from tip to butt: key, tip-side radius, butt-side radius, length
  const SEGS = [['tip', 0.0062, 0.0063, 0.008], ['ferrule', 0.0064, 0.0065, 0.022], ['shaft', 0.0065, 0.0105, 0.72], ['joint', 0.0108, 0.0108, 0.012], ['fore', 0.011, 0.0128, 0.28],
    ['wrap', 0.0128, 0.0138, 0.24], ['sleeve', 0.0138, 0.0148, 0.14], ['cap', 0.0148, 0.0148, 0.012], ['bumper', 0.0148, 0.014, 0.012]];
  const FIXED_SEG = { tip: { color: '#2a5d8f', rough: 0.9 }, ferrule: { color: '#f2efe6', rough: 0.25, coat: 1 }, bumper: { color: '#0a0a0a', rough: 0.6 } };
  const segSpec = (cue, key) => FIXED_SEG[key] || cue[key];

  // ================= Renderer & scene =================
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d0e);
  scene.fog = new THREE.Fog(0x0b0d0e, 4, 11);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 30);

  (function buildEnv() {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10), new THREE.MeshBasicMaterial({ color: 0x120e0b, side: THREE.BackSide })));
    const panel = (w, h, rgb, pos, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...rgb), side: THREE.DoubleSide }));
      m.position.set(...pos); if (rot) m.rotation.set(...rot); env.add(m);
    };
    panel(1.7, 0.35, [7, 6.3, 5.2], [0, 1.0, 0], [Math.PI / 2, 0, 0]);
    panel(2.5, 1.2, [0.5, 0.36, 0.24], [0, 1.2, -4.9]);
    panel(1.6, 1.0, [0.35, 0.22, 0.15], [4.9, 1.0, 1], [0, -Math.PI / 2, 0]);
    panel(1.0, 0.25, [0.15, 0.4, 0.5], [-4.9, 1.6, -1], [0, Math.PI / 2, 0]);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, 0.03).texture;
  })();

  // ================= Procedural textures =================
  const mkCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const cache = new Map();
  const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const toTex = (c, rx = 1, ry = 1) => {
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso; return t;
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const transpose = c => memo(c, () => { const t = mkCanvas(c.height, c.width), g = t.getContext('2d'); g.setTransform(0, 1, 1, 0, 0, 0); g.drawImage(c, 0, 0); return t; });

  const feltCanvas = hex => memo('felt' + hex, () => {
    const s = 512, c = mkCanvas(s, s), g = c.getContext('2d'), rgb = hexRgb(hex);
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    const img = g.getImageData(0, 0, s, s), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 16; d[i] += n; d[i + 1] += n * 1.1; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    const dk = rgb.map(v => v * 0.45 | 0), lt = rgb.map(v => Math.min(255, v * 1.6 + 20) | 0);
    for (let i = 0; i < 4000; i++) {
      g.strokeStyle = Math.random() < 0.5 ? rgba(dk, 0.22) : rgba(lt, 0.14); g.lineWidth = 0.6;
      const x = Math.random() * s, y = Math.random() * s, a = Math.random() * Math.PI, l = 2 + Math.random() * 4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    return c;
  });
  const woodCanvas = name => memo('wood' + name, () => {
    const [base, dark, light] = WOOD[name], w = 1024, h = 512, c = mkCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      const y0 = Math.random() * h, amp = 2 + Math.random() * 7, f = (1 + Math.floor(Math.random() * 3)) * Math.PI * 2 / w, ph = Math.random() * 6;
      g.strokeStyle = Math.random() < 0.65 ? rgba(dark, 0.08 + Math.random() * 0.25) : rgba(light, 0.05 + Math.random() * 0.12);
      g.lineWidth = 0.5 + Math.random() * 2.5; g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 4 + ph * 2) * 1.2);
      g.stroke();
    }
    return c;
  });
  const carbonCanvas = () => memo('carbon', () => {
    const s = 512, cell = 16, c = mkCanvas(s, s), g = c.getContext('2d');
    for (let i = 0; i < s / cell; i++) for (let j = 0; j < s / cell; j++) {
      const horiz = (i + j) % 4 < 2, x = i * cell, y = j * cell;
      const gr = horiz ? g.createLinearGradient(0, y, 0, y + cell) : g.createLinearGradient(x, 0, x + cell, 0);
      gr.addColorStop(0, '#141619'); gr.addColorStop(0.5, horiz ? '#3c4147' : '#31353a'); gr.addColorStop(1, '#111316');
      g.fillStyle = gr; g.fillRect(x, y, cell, cell);
    }
    return c;
  });
  const pointsCanvas = p => memo('pts' + JSON.stringify(p), () => {
    const w = 1024, h = 256, c = mkCanvas(w, h), g = c.getContext('2d');
    if (p.base.wood) g.drawImage(woodCanvas(p.base.wood), 0, 0, w, h); else { g.fillStyle = p.base.color; g.fillRect(0, 0, w, h); }
    const tri = (cy, hw, len, col, alpha) => { g.globalAlpha = alpha; g.fillStyle = col; g.beginPath(); g.moveTo(0, cy - hw); g.lineTo(len, cy); g.lineTo(0, cy + hw); g.closePath(); g.fill(); g.globalAlpha = 1; };
    for (let k = 0; k < 4; k++) { tri((k + 0.5) * h / 4, h / 8 * 0.92, w * 0.82, p.inlay, 1); tri(k * h / 4, h / 18, w * 0.45, p.inlay, 0.55); }
    tri(h, h / 18, w * 0.45, p.inlay, 0.55);
    return c;
  });
  const neonCanvas = n => memo('neon' + JSON.stringify(n), () => {
    const w = 1024, h = 256, c = mkCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = n.base; g.fillRect(0, 0, w, h);
    g.strokeStyle = n.glow; g.shadowColor = n.glow; g.shadowBlur = 14; g.lineWidth = 6;
    for (const f of [0.125, 0.375, 0.625, 0.875]) { g.beginPath(); g.moveTo(0, f * h); g.lineTo(w * 0.86, f * h); g.stroke(); }
    g.lineWidth = 10; for (let x = w * 0.88; x < w; x += 30) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    return c;
  });
  const segCanvas = s => s.wood ? woodCanvas(s.wood) : s.carbon ? carbonCanvas() : s.points ? pointsCanvas(s.points) : s.neon ? neonCanvas(s.neon) : null;

  function floorCanvas() {
    const s = 1024, c = mkCanvas(s, s), g = c.getContext('2d'), rowH = 128;
    for (let r = 0; r < s / rowH; r++) {
      let x = -Math.random() * 400;
      while (x < s) {
        const len = 300 + Math.random() * 400, t = 0.75 + Math.random() * 0.35;
        g.save(); g.beginPath(); g.rect(x, r * rowH, len, rowH); g.clip();
        g.fillStyle = `rgb(${54 * t | 0},${36 * t | 0},${25 * t | 0})`; g.fillRect(x, r * rowH, len, rowH);
        for (let i = 0; i < 30; i++) {
          const y0 = r * rowH + Math.random() * rowH, ph = Math.random() * 6;
          g.strokeStyle = rgba([20, 12, 8], 0.1 + Math.random() * 0.25); g.lineWidth = 0.5 + Math.random() * 1.5; g.beginPath();
          for (let xx = x; xx <= x + len; xx += 10) g.lineTo(xx, y0 + Math.sin(xx * 0.01 + ph) * 3);
          g.stroke();
        }
        g.restore(); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x, r * rowH, 2, rowH); x += len;
      }
      g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, r * rowH, s, 2);
    }
    return c;
  }
  function ballCanvas(n) {
    const w = 1024, h = 512, c = mkCanvas(w, h), g = c.getContext('2d');
    if (n === 0) { g.fillStyle = IVORY; g.fillRect(0, 0, w, h); return c; }
    if (n <= 8) { g.fillStyle = colorOf(n); g.fillRect(0, 0, w, h); }
    else { g.fillStyle = IVORY; g.fillRect(0, 0, w, h); g.fillStyle = colorOf(n); g.fillRect(0, h * 0.28, w, h * 0.44); }
    for (const u of [256, 768]) {
      g.fillStyle = IVORY; g.beginPath(); g.arc(u, h / 2, 66, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.font = 'bold 80px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), u, h / 2 + 4);
      if (n === 6 || n === 9) g.fillRect(u - 18, h / 2 + 40, 36, 6);
    }
    return c;
  }

  // ================= Materials =================
  const physical = o => new THREE.MeshPhysicalMaterial(o);
  function cueMat(s) {
    return memo('cm' + JSON.stringify(s), () => {
      if (s.color) return physical({ color: s.color, metalness: s.metal || 0, roughness: s.rough ?? 0.4, clearcoat: s.coat || 0, clearcoatRoughness: 0.08,
        emissive: s.glow ? new THREE.Color(s.color) : new THREE.Color(0), emissiveIntensity: s.glow ? 1.6 : 1 });
      const t = toTex(transpose(segCanvas(s)), s.carbon ? 2 : 1, s.carbon ? 10 : 1);
      const m = physical({ map: t, roughness: s.carbon ? 0.3 : 0.35, metalness: s.carbon ? 0.2 : 0, clearcoat: 0.9, clearcoatRoughness: 0.08 });
      if (s.neon) { m.emissiveMap = t; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 1.3; }
      return m;
    });
  }
  function railMat(s, rx, ry) {
    return memo('rm' + JSON.stringify(s) + rx + ry, () => s.carbon
      ? physical({ map: toTex(carbonCanvas(), rx * 9, ry * 2.4), roughness: 0.45, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 0.4 })
      : physical({ map: toTex(woodCanvas(s.wood), rx, ry), roughness: s.wood === 'lacquer' ? 0.3 : 0.5, clearcoat: s.wood === 'lacquer' ? 0.6 : 0.35, clearcoatRoughness: 0.25, envMapIntensity: 0.45 }));
  }
  const feltMat = new THREE.MeshStandardMaterial({ roughness: 0.95, bumpScale: 0.015 });
  const cushionMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0xc9a45c, metalness: 1, roughness: 0.28 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a45c, metalness: 1, roughness: 0.28 });
  const pearl = physical({ color: 0xf5efe2, roughness: 0.2, clearcoat: 1 });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x28e7ff });

  // ================= Table =================
  const shadowed = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };
  const tableGroup = new THREE.Group(); scene.add(tableGroup);
  const bed = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * L + 0.1, 0.03, 2 * W + 0.1), feltMat), false);
  bed.position.y = -0.015; tableGroup.add(bed);
  const CH = 0.04;
  for (const sz of [-1, 1]) for (const [a, b] of [[-L + CUT, -CUT], [CUT, L - CUT]]) {
    const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(b - a, CH, 0.05), cushionMat)); m.position.set((a + b) / 2, CH / 2, sz * (W + 0.025)); tableGroup.add(m);
  }
  for (const sx of [-1, 1]) { const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.05, CH, 2 * (W - CUT)), cushionMat)); m.position.set(sx * (L + 0.025), CH / 2, 0); tableGroup.add(m); }
  const railMesh = (function () {
    const ox = L + 0.19, oz = W + 0.19, rr = 0.06, ix = L + 0.05, iz = W + 0.05, s = new THREE.Shape();
    s.moveTo(-ox + rr, -oz); s.lineTo(ox - rr, -oz); s.quadraticCurveTo(ox, -oz, ox, -oz + rr); s.lineTo(ox, oz - rr); s.quadraticCurveTo(ox, oz, ox - rr, oz);
    s.lineTo(-ox + rr, oz); s.quadraticCurveTo(-ox, oz, -ox, oz - rr); s.lineTo(-ox, -oz + rr); s.quadraticCurveTo(-ox, -oz, -ox + rr, -oz);
    const hole = new THREE.Path(); hole.moveTo(-ix, -iz); hole.lineTo(-ix, iz); hole.lineTo(ix, iz); hole.lineTo(ix, -iz); hole.lineTo(-ix, -iz); s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 10 });
    g.rotateX(-Math.PI / 2);
    const m = shadowed(new THREE.Mesh(g)); m.position.y = 0.045 - 0.112; tableGroup.add(m); return m;
  })();
  const apron = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * (L + 0.15), 0.22, 2 * (W + 0.15))));
  apron.position.y = -0.18; tableGroup.add(apron);
  const legGeo = new THREE.LatheGeometry([[0.06, 0], [0.072, 0.03], [0.05, 0.09], [0.042, 0.24], [0.068, 0.33], [0.048, 0.4], [0.062, 0.46], [0.08, 0.5]].map(p => new THREE.Vector2(p[0], p[1])), 32);
  const legs = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = shadowed(new THREE.Mesh(legGeo)); leg.position.set(sx * (L - 0.05), -0.79, sz * (W - 0.02)); tableGroup.add(leg); legs.push(leg); }
  const dGeo = new THREE.SphereGeometry(1, 16, 8);
  const diamond = (x, z) => { const d = new THREE.Mesh(dGeo, pearl); d.scale.set(0.007, 0.0015, 0.007); d.position.set(x, 0.0455, z); tableGroup.add(d); };
  for (let k = 1; k < 8; k++) if (k !== 4) for (const sz of [-1, 1]) diamond(-L + k * (2 * L / 8), sz * (W + 0.12));
  for (let k = 1; k < 4; k++) for (const sx of [-1, 1]) diamond(sx * (L + 0.12), -W + k * (2 * W / 4));
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x030303 });
  for (const p of POCKETS) {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(p.vr, 40), holeMat); hole.rotation.x = -Math.PI / 2; hole.position.set(p.sx, 0.047, p.sy); tableGroup.add(hole);
    const ring = shadowed(new THREE.Mesh(new THREE.TorusGeometry(p.vr, 0.006, 12, 48), ironMat), true, false); ring.rotation.x = -Math.PI / 2; ring.position.set(p.sx, 0.047, p.sy); tableGroup.add(ring);
  }
  const led = new THREE.Group(); tableGroup.add(led);
  // LED runs along the inner rail edge, broken at each pocket
  for (const sz of [-1, 1]) for (const [a, b] of [[-L + 0.1, -0.075], [0.075, L - 0.1]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.003, 0.004), ledMat); m.position.set((a + b) / 2, 0.0465, sz * (W + 0.058)); led.add(m); }
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, 2 * (W - 0.1)), ledMat); m.position.set(sx * (L + 0.058), 0.0465, 0); led.add(m); }
  for (const sz of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(2 * (L + 0.15), 0.01, 0.002), ledMat); m.position.set(0, -0.08, sz * (W + 0.152)); led.add(m); }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: toTex(floorCanvas(), 4, 4), roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.79; floor.receiveShadow = true; scene.add(floor);
  const spots = [];
  const lampGroup = (function lamp() {
    const g = new THREE.Group(); g.position.y = 1.05; scene.add(g);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.09, 0.36), new THREE.MeshStandardMaterial({ color: 0x1a2a21, metalness: 0.5, roughness: 0.35 })));
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.012, 0.38), brass); trim.position.y = -0.045; g.add(trim);
    for (const x of [-0.58, 0, 0.58]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3, 2.8, 2.4) }));
      p.rotation.x = Math.PI / 2; p.position.set(x, -0.052, 0); g.add(p);
      const s = new THREE.SpotLight(0xfff0d8, 1.5, 0, 0.95, 0.7, 1);
      s.position.set(x, 0.98, 0); s.target.position.set(x * 1.15, 0, 0);
      s.castShadow = true; s.shadow.mapSize.set(1024, 1024); s.shadow.camera.near = 0.4; s.shadow.camera.far = 2.4; s.shadow.bias = -0.0004;
      scene.add(s, s.target); spots.push(s);
    }
    for (const x of [-0.7, 0.7]) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1.6, 6), brass); ch.position.set(x, 0.85, 0); g.add(ch); }
    return g;
  })();
  const hemi = new THREE.HemisphereLight(0x8a7a66, 0x0a0806, 0.35); scene.add(hemi);
  // Lighting presets: moody is the original bar look, studio lights the whole room
  const LIGHTS = { moody: { exp: 1.15, spot: 1.5, hemi: 0.35 }, bright: { exp: 1.3, spot: 1.85, hemi: 0.6 }, studio: { exp: 1.45, spot: 2.2, hemi: 1.0 } };
  function applyLighting(v) {
    const l = LIGHTS[v] || LIGHTS.bright;
    renderer.toneMappingExposure = l.exp; hemi.intensity = l.hemi; for (const sp of spots) sp.intensity = l.spot;
  }

  function applyTable(id) {
    const t = TABLES.find(x => x.id === id) || TABLES[0];
    const fc = feltCanvas(t.cloth);
    feltMat.map = toTex(fc, 10, 5); feltMat.bumpMap = toTex(fc, 10, 5); feltMat.needsUpdate = true;
    cushionMat.map = toTex(fc, 4, 0.3); cushionMat.needsUpdate = true;
    railMesh.material = railMat(t.rail, 0.8, 3);
    apron.material = railMat(t.rail, 2, 1);
    for (const l of legs) l.material = railMat(t.rail, 1, 2);
    ironMat.color.set(t.irons);
    led.visible = !!t.led; if (t.led) ledMat.color.set(t.led);
    tableFx = TABLE_FX[t.id] || null;
    const k = tableFx && tableFx.kind;
    crest.visible = !!(tableFx && tableFx.crest);
    if (crest.visible) { crest.material.map = memo('crestTex', () => toTex(crestCanvas())); crest.material.color.set(tableFx.crest); crest.material.needsUpdate = true; }
    for (const m of water) m.visible = k === 'water';
    pocketGlow.visible = k === 'neon';
    skin.table = t.id; store.set('table', t.id); updateEquipped();
  }

  // ================= Balls =================
  const ballGeo = new THREE.SphereGeometry(R, 48, 32);
  const balls = [], meshes = [], prev = [];
  for (let n = 0; n <= 15; n++) {
    const mesh = shadowed(new THREE.Mesh(ballGeo, physical({ map: toTex(ballCanvas(n)), roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03 })), true, false);
    scene.add(mesh); meshes.push(mesh); prev.push({ x: 0, y: 0 });
    balls.push({ n, x: 0, y: 0, vx: 0, vy: 0, on: true, ts: 0, ss: 0 });
  }
  const cue = balls[0];
  const syncPrev = b => { prev[b.n].x = b.x; prev[b.n].y = b.y; };

  // ================= Cue stick =================
  const stick = new THREE.Group(), stickInner = new THREE.Group(); stick.add(stickInner); scene.add(stick);
  function applyCue(id) {
    const c = CUES.find(x => x.id === id) || CUES[0];
    while (stickInner.children.length) stickInner.remove(stickInner.children[0]);
    let y = 0;
    cueGlowMats = [];
    for (const [key, r1, r2, len] of SEGS) {
      const spec = segSpec(c, key), m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 32), cueMat(spec)), true, false);
      m.position.y = y + len / 2; stickInner.add(m); y += len;
      if (spec.neon || spec.glow) cueGlowMats.push(m.material);
    }
    cueFx = CUE_FX[c.id] || null; fxRing = null;
    if (cueFx && cueFx.kind === 'ring') {
      fxRing = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0016, 10, 40), new THREE.MeshBasicMaterial({ color: cueFx.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      fxRing.rotation.x = Math.PI / 2; stickInner.add(fxRing);
    }
    skin.cue = c.id; store.set('cue', c.id); drawPowerCue(); updateEquipped();
  }

  // 2D cue drawing (tip at +x) for previews and the power slider
  function drawCue2D(g, c, len, thick) {
    const total = SEGS.reduce((a, s) => a + s[3], 0), k = len / total, rk = thick / (2 * 0.0148);
    let x = len;
    for (const [key, r1, r2, sl] of SEGS) {
      const w = sl * k, a = r1 * rk, b = r2 * rk, s = segSpec(c, key), src = segCanvas(s);
      g.save(); g.beginPath(); g.moveTo(x, -a); g.lineTo(x, a); g.lineTo(x - w, b); g.lineTo(x - w, -b); g.closePath(); g.clip();
      if (src) g.drawImage(src, x - w, -b, w, 2 * b); else { g.fillStyle = s.color; g.fillRect(x - w, -b, w, 2 * b); }
      const sh = g.createLinearGradient(0, -b, 0, b);
      sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(0.22, 'rgba(255,255,255,.4)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.55)');
      g.fillStyle = sh; g.fillRect(x - w, -b, w, 2 * b); g.restore(); x -= w;
    }
  }
  function cuePreview(cnv, c) {
    const g = cnv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cnv.width, cnv.height);
    g.translate(4, cnv.height / 2); drawCue2D(g, c, cnv.width - 8, cnv.height * 0.8);
  }
  function tablePreview(cnv, t) {
    const g = cnv.getContext('2d'), w = cnv.width, h = cnv.height, rr = 18;
    g.clearRect(0, 0, w, h);
    const rail = new Path2D(); rail.roundRect ? rail.roundRect(4, 4, w - 8, h - 8, rr) : rail.rect(4, 4, w - 8, h - 8);
    g.save(); g.clip(rail);
    if (t.rail.carbon) { g.fillStyle = g.createPattern(carbonCanvas(), 'repeat'); g.fillRect(0, 0, w, h); } else g.drawImage(woodCanvas(t.rail.wood), 0, 0, w * 2, h * 2);
    const gl = g.createLinearGradient(0, 0, 0, h); gl.addColorStop(0, 'rgba(255,255,255,.18)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = gl; g.fillRect(0, 0, w, h); g.restore();
    const ix = 26, iy = 26, iw = w - 52, ih = h - 52;
    g.fillStyle = t.cloth; g.fillRect(ix, iy, iw, ih);
    const lg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.55); lg.addColorStop(0, 'rgba(255,240,210,.22)'); lg.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = lg; g.fillRect(ix, iy, iw, ih);
    if (t.led) { g.save(); g.strokeStyle = t.led; g.shadowColor = t.led; g.shadowBlur = 10; g.lineWidth = 2; g.strokeRect(ix - 7, iy - 7, iw + 14, ih + 14); g.restore(); }
    for (const [px, py] of [[ix, iy], [ix + iw / 2, iy - 3], [ix + iw, iy], [ix, iy + ih], [ix + iw / 2, iy + ih + 3], [ix + iw, iy + ih]]) {
      g.beginPath(); g.arc(px, py, 10, 0, Math.PI * 2); g.fillStyle = '#050505'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = t.irons; g.stroke();
    }
    const br = 5.5, ax = ix + iw * 0.7, ay = iy + ih / 2, order = [1, 9, 2, 10, 8, 3, 11, 7, 14, 4, 5, 13, 15, 6, 12];
    let i = 0;
    for (let r = 0; r < 5; r++) for (let k = 0; k <= r; k++) {
      const n = order[i++], bx = ax + r * br * 1.75, by = ay + (k - r / 2) * br * 2.02;
      g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fillStyle = n > 8 ? IVORY : colorOf(n); g.fill();
      if (n > 8) { g.save(); g.clip(); g.fillStyle = colorOf(n); g.fillRect(bx - br, by - br * 0.45, br * 2, br * 0.9); g.restore(); }
    }
    g.beginPath(); g.arc(ix + iw * 0.25, ay, br, 0, Math.PI * 2); g.fillStyle = IVORY; g.fill();
  }

  // ================= Aim guide & markers =================
  const mkLine = mat => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); const l = new THREE.Line(g, mat); l.frustumCulled = false; scene.add(l); return l; };
  const aimLine = mkLine(new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.02, gapSize: 0.014, transparent: true, opacity: 0.75 }));
  const objLine = mkLine(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  const cueLine = mkLine(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
  const ghostRing = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
  ghostRing.rotation.x = -Math.PI / 2;
  const handRing = new THREE.Mesh(new THREE.RingGeometry(R * 1.3, R * 1.55, 48), new THREE.MeshBasicMaterial({ color: 0xd8b26a, transparent: true, opacity: 0.8, depthWrite: false }));
  handRing.rotation.x = -Math.PI / 2;
  const callRing = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.082, 48), new THREE.MeshBasicMaterial({ color: 0xd8b26a, transparent: true, opacity: 0.9, depthWrite: false }));
  callRing.rotation.x = -Math.PI / 2;
  scene.add(ghost, ghostRing, handRing, callRing);
  const setLine = (l, ax, ay, bx, by) => {
    const p = l.geometry.attributes.position; p.setXYZ(0, ax, R, ay); p.setXYZ(1, bx, R, by); p.needsUpdate = true;
    if (l.material.isLineDashedMaterial) l.computeLineDistances();
  };

  // ================= Effects =================
  const glowSprite = (() => {
    const c = mkCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  function particles(N, size) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3).fill(-50), col = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size, map: glowSprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
    return { N, size, mat, geo, pos, col, vel: new Float32Array(N * 3), base: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), grav: new Float32Array(N), tw: new Uint8Array(N), next: 0 };
  }
  const fxSmall = particles(900, 0.014), fxBig = particles(260, 0.045);
  const fxColor = new THREE.Color();
  function emit(P, x, y, z, vx, vy, vz, color, life, grav = 0, tw = 0) {
    const i = P.next, k = i * 3; P.next = (i + 1) % P.N;
    P.pos[k] = x; P.pos[k + 1] = y; P.pos[k + 2] = z; P.vel[k] = vx; P.vel[k + 1] = vy; P.vel[k + 2] = vz;
    fxColor.set(color); P.base[k] = fxColor.r; P.base[k + 1] = fxColor.g; P.base[k + 2] = fxColor.b;
    P.life[i] = P.max[i] = life; P.grav[i] = grav; P.tw[i] = tw;
  }
  function stepParticles(P, dt, now) {
    for (let i = 0; i < P.N; i++) {
      if (P.life[i] <= 0) continue;
      const k = i * 3; P.life[i] -= dt;
      if (P.life[i] <= 0) { P.pos[k + 1] = -50; P.col[k] = P.col[k + 1] = P.col[k + 2] = 0; continue; }
      P.vel[k + 1] += P.grav[i] * dt; P.pos[k] += P.vel[k] * dt; P.pos[k + 1] += P.vel[k + 1] * dt; P.pos[k + 2] += P.vel[k + 2] * dt;
      const t = P.life[i] / P.max[i]; let a = Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8);
      if (P.tw[i]) a *= 0.35 + 0.65 * Math.abs(Math.sin(now * 0.012 + i * 1.7));
      P.col[k] = P.base[k] * a; P.col[k + 1] = P.base[k + 1] * a; P.col[k + 2] = P.base[k + 2] * a;
    }
    P.geo.attributes.position.needsUpdate = true; P.geo.attributes.color.needsUpdate = true;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(x, y, z, color, n, speed) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = rnd(0.3, 1) * speed; emit(fxSmall, x, y, z, Math.cos(a) * s, rnd(0.05, 0.4) * speed, Math.sin(a) * s, color, rnd(0.3, 0.6), -0.6); }
    emit(fxBig, x, y + 0.01, z, 0, 0, 0, color, 0.25);
  }

  // Cue effects: particles emitted along the stick, an energy ring, pulsing neon
  let cueFx = null, cueGlowMats = [], fxRing = null, emitAcc = 0;
  const fxV = new THREE.Vector3();
  function alongStick(s, r = 0.016) { const a = Math.random() * Math.PI * 2; return stick.localToWorld(fxV.set(Math.cos(a) * r, s, Math.sin(a) * r)); }
  function cueEffects(dt, now) {
    if (!cueFx) return;
    const f = cueFx, rate = { sparkle: 45, embers: 60, frost: 40, neon: 30, dust: 18, wisp: 22, ring: 12 }[f.kind] || 0;
    if (f.kind === 'neon') { const p = 1.1 + 0.9 * Math.sin(now * 0.006); for (const m of cueGlowMats) m.emissiveIntensity = p; }
    if (fxRing) { const t = (now * 0.0007) % 1, y = 1.42 - t * 1.38; fxRing.position.y = y; const r = 0.0105 - (1.42 - y) / 1.42 * 0.004 + 0.003; fxRing.scale.setScalar(r / 0.012); fxRing.material.opacity = Math.sin(t * Math.PI); }
    if (!stick.visible) return;
    stick.updateMatrixWorld();
    emitAcc += dt * rate;
    while (emitAcc >= 1) {
      emitAcc--;
      if (f.kind === 'sparkle') { const p = alongStick(rnd(0.05, 1.42)); emit(fxSmall, p.x, p.y, p.z, rnd(-0.02, 0.02), rnd(0, 0.03), rnd(-0.02, 0.02), Math.random() < 0.7 ? f.color : '#ffffff', rnd(0.4, 0.9), 0, 1); }
      else if (f.kind === 'embers') { const p = alongStick(rnd(0.3, 1.44)); emit(fxSmall, p.x, p.y, p.z, rnd(-0.04, 0.04), rnd(0.08, 0.2), rnd(-0.04, 0.04), ['#ff7a1a', '#ffb02e', '#ff3b1a'][Math.random() * 3 | 0], rnd(0.6, 1.1), 0.05, 1); if (Math.random() < 0.25) emit(fxBig, p.x, p.y, p.z, 0, 0.06, 0, '#ff4a12', 0.5); }
      else if (f.kind === 'frost') { const p = alongStick(rnd(0.05, 1.42), 0.02); emit(fxSmall, p.x, p.y, p.z, rnd(-0.015, 0.015), rnd(-0.04, -0.01), rnd(-0.015, 0.015), Math.random() < 0.5 ? f.color : '#ffffff', rnd(0.8, 1.4), 0, 1); }
      else if (f.kind === 'neon') { const p = alongStick(rnd(0.75, 1.3), 0.014); emit(fxSmall, p.x, p.y, p.z, rnd(-0.03, 0.03), rnd(-0.03, 0.03), rnd(-0.03, 0.03), Math.random() < 0.5 ? f.color : f.color2, rnd(0.3, 0.6), 0, 1); }
      else if (f.kind === 'dust') { const p = alongStick(rnd(0.3, 1.44), 0.025); emit(fxSmall, p.x, p.y, p.z, rnd(-0.01, 0.01), rnd(0.01, 0.04), rnd(-0.01, 0.01), f.color, rnd(1, 1.8), 0, 1); }
      else if (f.kind === 'wisp') { const p = alongStick(rnd(0.4, 1.44), 0.02); emit(fxBig, p.x, p.y, p.z, rnd(-0.03, 0.03), rnd(0.03, 0.07), rnd(-0.03, 0.03), Math.random() < 0.6 ? f.color : '#4b2a9e', rnd(0.8, 1.4)); }
      else if (f.kind === 'ring' && fxRing) { const p = stick.localToWorld(fxV.set(0, fxRing.position.y, 0)); emit(fxSmall, p.x, p.y, p.z, rnd(-0.05, 0.05), rnd(-0.05, 0.05), rnd(-0.05, 0.05), f.color, 0.35); }
    }
  }

  // Table effects: felt crest, caustic water light, LED hue cycling, pocket glow, floating motes, stars
  function crestCanvas() {
    const c = mkCanvas(1024, 512), g = c.getContext('2d');
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 10;
    g.beginPath(); g.arc(512, 256, 200, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(512, 256, 180, 0, Math.PI * 2); g.stroke();
    g.font = '700 150px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('0xHUB', 512, 250);
    g.font = '600 38px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText('P O O L   C L U B', 512, 360);
    return c;
  }
  const crest = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false }));
  crest.rotation.x = -Math.PI / 2; crest.position.set(0, 0.0008, 0); scene.add(crest);
  function causticCanvas() {
    const s = 512, c = mkCanvas(s, s), g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 34; i++) {
      const x0 = rnd(0, s), y0 = rnd(0, s), r = rnd(30, 90), w = rnd(1, 2.5);
      // Draw each wobbly ring at every wrap offset so the texture tiles seamlessly
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        g.lineWidth = w; g.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.2) { const rr = r * (1 + 0.35 * Math.sin(a * 3 + i)); g.lineTo(x0 + ox + Math.cos(a) * rr, y0 + oy + Math.sin(a) * rr); }
        g.stroke();
      }
    }
    return c;
  }
  const water = [];
  for (const sp of [1, -0.7]) {
    const tex = toTex(causticCanvas(), 3, 1.5); tex.encoding = THREE.LinearEncoding;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * L, 2 * W), new THREE.MeshBasicMaterial({ map: tex, color: 0x7ff5ea, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.0007; m.userData.sp = sp; scene.add(m); water.push(m);
  }
  const pocketGlow = new THREE.Group(); scene.add(pocketGlow);
  for (const p of POCKETS) { const r = new THREE.Mesh(new THREE.RingGeometry(p.vr + 0.006, p.vr + 0.02, 48), new THREE.MeshBasicMaterial({ color: 0x28e7ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.position.set(p.sx, 0.048, p.sy); pocketGlow.add(r); }
  let tableFx = null, tableAcc = 0;
  function tableEffects(dt, now) {
    if (!tableFx) return;
    const f = tableFx;
    if (f.kind === 'water') for (const m of water) { const o = m.material.map.offset; o.x += dt * 0.02 * m.userData.sp; o.y += dt * 0.013 * m.userData.sp; }
    if (f.kind === 'neon') {
      const h = 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.0009));
      ledMat.color.setHSL(h, 1, 0.55);
      for (const r of pocketGlow.children) { r.material.color.setHSL(h, 1, 0.55); r.material.opacity = 0.45 + 0.3 * Math.sin(now * 0.004); }
    }
    const rate = { motes: 22, stars: 16 }[f.kind] || 0;
    tableAcc += dt * rate;
    while (tableAcc >= 1) {
      tableAcc--;
      if (f.kind === 'motes') emit(fxSmall, rnd(-L, L), rnd(0.05, 0.6), rnd(-W, W), rnd(-0.02, 0.02), rnd(-0.01, 0.02), rnd(-0.02, 0.02), f.color, rnd(2, 3.5), 0, 1);
      else if (f.kind === 'stars') emit(fxSmall, rnd(-L + 0.05, L - 0.05), 0.003, rnd(-W + 0.05, W - 0.05), 0, 0, 0, Math.random() < 0.6 ? f.color : '#ffffff', rnd(1, 2), 0, 1);
    }
  }
  const potFx = pk => { const c = tableFx ? tableFx.color : null; if (c) burst(pk.sx, 0.06, pk.sy, c, 28, 0.6); };

  // ================= Sound =================
  let actx = null, lastClack = 0;
  const ensureAudio = () => { if (!actx) try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} if (actx && actx.state === 'suspended') actx.resume(); };
  function noiseHit(vol, freq, dur) {
    if (!actx || vol < 0.02) return;
    const now = actx.currentTime; if (now - lastClack < 0.012) return; lastClack = now;
    const len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4; g.gain.value = Math.min(vol, 1) * 0.9;
    src.connect(f).connect(g).connect(actx.destination); src.start();
  }
  function thunk() {
    if (!actx) return;
    const now = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.frequency.setValueAtTime(150, now); o.frequency.exponentialRampToValueAtTime(55, now + 0.22);
    g.gain.setValueAtTime(0.35, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o.connect(g).connect(actx.destination); o.start(now); o.stop(now + 0.26);
  }

  // ================= Physics (pure: works on any ball array) =================
  function physStep(bs, h, ev) {
    for (const b of bs) {
      if (!b.on) continue;
      const sp = Math.hypot(b.vx, b.vy); if (sp === 0) continue;
      const dec = (0.14 + 0.1 * sp) * h;
      if (dec >= sp) { b.vx = b.vy = 0; continue; }
      const k = (sp - dec) / sp; b.vx *= k; b.vy *= k; b.x += b.vx * h; b.y += b.vy * h;
      if (b.n === 0) { b.ts += (0.3 - b.ts) * (1 - Math.exp(-h * 1.6)); b.ss *= Math.exp(-h * 0.5); }
    }
    for (let i = 0; i < 16; i++) {
      const a = bs[i]; if (!a.on) continue;
      for (let j = i + 1; j < 16; j++) {
        const b = bs[j]; if (!b.on) continue;
        let nx = b.x - a.x, ny = b.y - a.y; const d = Math.hypot(nx, ny);
        if (d >= 2 * R || d === 0) continue;
        nx /= d; ny /= d;
        const over = (2 * R - d) / 2; a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; if (rel <= 0) continue;
        const cb = a.n === 0 ? a : b.n === 0 ? b : null;
        let px = 0, py = 0;
        if (cb) { const s = Math.hypot(cb.vx, cb.vy); if (s > 0) { px = cb.vx / s; py = cb.vy / s; } }
        const imp = rel * 0.975;
        a.vx -= nx * imp; a.vy -= ny * imp; b.vx += nx * imp; b.vy += ny * imp;
        if (cb) { const add = cb.ts * imp * 0.9; cb.vx += px * add; cb.vy += py * add; cb.ts *= 0.25; }
        ev.hit(a, b, rel);
      }
    }
    for (const b of bs) {
      if (!b.on) continue;
      let potted = false;
      for (const pk of POCKETS) if (Math.hypot(b.x - pk.cx, b.y - pk.cy) < pk.r) { b.on = false; ev.pot(b, pk); potted = true; break; }
      if (potted) continue;
      const ax = Math.abs(b.x), ay = Math.abs(b.y), corner = ax > L - CUT && ay > W - CUT, side = ax < CUT;
      if (!corner && ax > L - R) { const s = Math.sign(b.x), vn = Math.abs(b.vx); english(b, -s, 0); b.x = s * (L - R); b.vx = -b.vx * 0.78; b.vy *= 0.96; addEnglish(b, 0, 1, vn); ev.cushion(b, vn); }
      if (!corner && !side && ay > W - R) { const s = Math.sign(b.y), vn = Math.abs(b.vy); english(b, 0, -s); b.y = s * (W - R); b.vy = -b.vy * 0.78; b.vx *= 0.96; addEnglish(b, 1, 0, vn); ev.cushion(b, vn); }
      if (ax > L + 0.02 || ay > W + 0.02) {
        let best = POCKETS[0], bd = 1e9; for (const pk of POCKETS) { const dd = Math.hypot(pk.cx - b.x, pk.cy - b.y); if (dd < bd) { bd = dd; best = pk; } }
        b.on = false; ev.pot(b, best);
      }
    }
  }
  // Side spin: remember travel direction before the bounce, then push along the cushion toward the shooter's right (or left)
  let engDx = 0, engDy = 0;
  function english(b) { const s = Math.hypot(b.vx, b.vy) || 1; engDx = b.vx / s; engDy = b.vy / s; }
  function addEnglish(b, tx, ty, vn) {
    if (b.n !== 0 || Math.abs(b.ss) < 0.02) return;
    const side = Math.sign((-engDy) * tx + engDx * ty) || 1;
    b.vx += tx * side * b.ss * vn * 0.45; b.vy += ty * side * b.ss * vn * 0.45; b.ss *= 0.4;
  }
  const moving = bs => bs.some(b => b.on && (b.vx !== 0 || b.vy !== 0));
  const newRec = () => ({ first: null, potted: [], rail: false, scratch: false });
  const recEvents = (rec, live) => ({
    hit(a, b, rel) { if (rec.first === null && (a.n === 0 || b.n === 0)) rec.first = a.n === 0 ? b.n : a.n; if (live) noiseHit(rel / 3, 2600, 0.035); },
    cushion(b, v) { if (rec.first !== null) rec.rail = true; if (live) noiseHit(v / 4, 380, 0.05); },
    pot(b, pk) { rec.potted.push(b.n); if (b.n === 0) rec.scratch = true; if (b.n === 8) rec.pk8 = POCKETS.indexOf(pk); if (live) { thunk(); potFx(pk); falls.push({ n: b.n, fx: b.x, fy: b.y, tx: pk.sx, ty: pk.sy, t: 0 }); } },
  });
  const shotSpeed = p => 0.35 + Math.pow(p, 1.3) * 6.2;

  // ================= Rules =================
  const G = { mode: store.get('mode', 'cpu'), diff: store.get('diff', 'normal'), game: store.get('game', '8'), guide: store.get('guide', 'long'), timer: store.get('timer', 0), light: store.get('light', 'bright'),
    players: [], groups: [null, null], cur: 0, breaker: 0, isBreak: true, bih: false, phase: 'menu', paused: false, call: null, callManual: false, shots: 0, turnLeft: 0 };
  const skin = { cue: store.get('cue', 'classic'), table: store.get('table', 'club') };
  const groupLeft = (g, bs = balls) => bs.filter(b => b.on && b.n !== 0 && grp(b.n) === g).length;
  const onEight = (p, bs = balls) => G.game === '8' && !!G.groups[p] && groupLeft(G.groups[p], bs) === 0;
  const lowestOn = (bs = balls) => { for (const b of bs) if (b.n > 0 && b.on) return b.n; return null; };
  const objectsLeft = (bs = balls) => bs.filter(b => b.n > 0 && b.on).length;
  const pname = p => G.players[p].name;
  const ctxFor = (p, bs, isBreak, call) => ({ cur: p, isBreak, eight: onEight(p, bs), lowest: lowestOn(bs), call });

  const judge = (rec, ctx) => G.game === '9' ? judge9(rec, ctx) : G.game === 'practice' ? judgePractice(rec) : judge8(rec, ctx);
  function judgePractice(rec) {
    return { foul: rec.scratch ? 'The cue ball went in' : null, assign: null, keep: true, respot8: false, respot9: false, win: null, why: '' };
  }
  function judge9(rec, ctx) {
    const { cur, isBreak, lowest } = ctx, other = 1 - cur;
    let foul = null;
    if (rec.scratch) foul = 'The cue ball went in';
    else if (rec.first === null) foul = 'No ball was hit';
    else if (rec.first !== lowest) foul = `The ${lowest}-ball had to be hit first`;
    else if (!isBreak && rec.potted.length === 0 && !rec.rail) foul = 'No ball reached a cushion after contact';
    const res = { foul, assign: null, keep: false, respot8: false, respot9: false, win: null, why: '' };
    if (rec.potted.includes(9)) {
      if (!foul) { res.win = cur; res.why = `${pname(cur)} sank the 9-ball`; return res; }
      res.respot9 = true;
    }
    res.keep = !foul && rec.potted.some(n => n !== 0);
    return res;
  }

  function judge8(rec, ctx) {
    const { cur, isBreak, eight } = ctx, g = G.groups[cur], other = 1 - cur;
    let foul = null;
    if (rec.scratch) foul = 'The cue ball went in';
    else if (rec.first === null) foul = 'No ball was hit';
    else if (!isBreak) {
      if (!g) { if (rec.first === 8) foul = 'The 8-ball was hit first'; }
      else if (eight) { if (rec.first !== 8) foul = 'The 8-ball had to be hit first'; }
      else if (grp(rec.first) !== g) foul = rec.first === 8 ? 'The 8-ball was hit first' : `Hit ${g === 'solid' ? 'a stripe' : 'a solid'} first`;
      if (!foul && rec.potted.length === 0 && !rec.rail) foul = 'No ball reached a cushion after contact';
    }
    const res = { foul, assign: null, keep: false, respot8: false, respot9: false, win: null, why: '' };
    if (rec.potted.includes(8)) {
      if (isBreak) res.respot8 = true;
      else if (eight && !foul && ctx.call != null && rec.pk8 !== ctx.call) { res.win = other; res.why = `${pname(cur)} sank the 8-ball in the wrong pocket`; return res; }
      else if (eight && !foul) { res.win = cur; res.why = `${pname(cur)} sank the 8-ball in the called pocket`; return res; }
      else { res.win = other; res.why = foul ? `${pname(cur)} fouled while potting the 8-ball` : `${pname(cur)} potted the 8-ball too early`; return res; }
    }
    const pots = rec.potted.filter(n => n !== 0 && n !== 8);
    if (!g && !foul && !isBreak && pots.length) res.assign = grp(pots[0]);
    const mine = g || res.assign;
    res.keep = !foul && (mine ? pots.some(n => grp(n) === mine) : pots.length > 0);
    return res;
  }

  // ================= Game state helpers =================
  let aim = 0, power = 0, spin = { x: 0, y: 0 }, rec = null, shotCtx = null, strikeT = 0, gap = 0.012, falls = [], keyCharge = false, chargeT = 0;
  let view = store.get('view', 'top');

  function rackBalls() {
    const nine = G.game === '9' && G.phase !== 'menu';
    const order = nine ? [[1], [2, 3], [4, 9, 5], [6, 7], [8]] : [[1], [9, 2], [10, 8, 3], [11, 7, 14, 4], [5, 13, 15, 6, 12]];
    const dx = 2 * R * Math.cos(Math.PI / 6) * 1.002, dz = 2 * R * 1.002;
    order.forEach((row, r) => row.forEach((n, k) => { const b = balls[n]; b.x = FOOT + r * dx; b.y = (k - (row.length - 1) / 2) * dz; }));
    cue.x = HEAD; cue.y = 0;
    falls = [];
    for (const b of balls) {
      const used = !nine || b.n <= 9;
      b.vx = b.vy = 0; b.on = used; b.ts = b.ss = 0; meshes[b.n].visible = used; syncPrev(b);
      meshes[b.n].quaternion.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    }
  }
  function validPlace(x, y, kitchen, bs = balls) {
    if (Math.abs(x) > L - R || Math.abs(y) > W - R) return false;
    if (kitchen && x > HEAD) return false;
    for (const b of bs) if (b.n !== 0 && b.on && Math.hypot(b.x - x, b.y - y) < 2 * R * 1.01) return false;
    for (const pk of POCKETS) if (Math.hypot(pk.cx - x, pk.cy - y) < pk.r + R) return false;
    return true;
  }
  function placeCueDefault() {
    cue.on = true; cue.vx = cue.vy = 0; meshes[0].visible = true;
    for (let k = 0; k < 40; k++) { const y = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.2 * R; if (validPlace(HEAD, y, false)) { cue.x = HEAD; cue.y = y; break; } }
    syncPrev(cue);
  }
  function respot(n) {
    const b = balls[n]; b.on = true; b.vx = b.vy = 0; meshes[n].visible = true;
    for (let x = FOOT; x < L - R; x += 0.005) if (validPlace(x, 0, false) && Math.hypot(cue.x - x, cue.y) > 2 * R) { b.x = x; b.y = 0; break; }
    falls = falls.filter(f => f.n !== n); syncPrev(b);
  }

  // ================= HUD =================
  const hud = $('hud'), pill = $('pill'), toastEl = $('toast'), powerEl = $('power'), wheelEl = $('wheel'), spinBtn = $('spinBtn');
  let toastTimer = 0;
  function toast(text, bad) { toastEl.textContent = text; toastEl.classList.toggle('bad', !!bad); toastEl.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600); }
  const isBotTurn = () => G.players[G.cur] && G.players[G.cur].bot;
  const canAct = () => !G.paused && G.phase === 'aim' && !isBotTurn();

  const miniBall = (n, gone) => { const i = document.createElement('i'); i.className = 'mb' + (n > 8 ? ' st' : '') + (gone ? ' gone' : ''); i.style.setProperty('--c', colorOf(n)); i.title = `${n} ball`; return i; };
  function renderCards() {
    $('card1').hidden = G.game === 'practice';
    for (let p = 0; p < G.players.length; p++) {
      const card = $('card' + p), pl = G.players[p], g = G.groups[p];
      card.classList.toggle('active', G.cur === p && G.phase !== 'over' && G.game !== 'practice');
      card.querySelector('.av').textContent = pl.bot ? 'AI' : pl.name.trim().charAt(0).toUpperCase() || 'P';
      const nameEl = card.querySelector('.pname'); nameEl.innerHTML = '';
      const nm = document.createElement('span'); nm.textContent = pl.name;
      const sm = document.createElement('small');
      const row = card.querySelector('.pballs'); row.innerHTML = '';
      if (G.game === 'practice') {
        sm.textContent = `Shot ${G.shots + 1}`;
        for (let n = 1; n <= 15; n++) row.append(miniBall(n, !balls[n].on));
      } else if (G.game === '9') {
        const lo = lowestOn();
        sm.textContent = G.cur === p ? 'Target' : '';
        if (lo) row.append(miniBall(lo, false));
        if (lo !== 9 && balls[9].on) row.append(miniBall(9, false));
      } else {
        sm.textContent = g ? (g === 'solid' ? 'Solids' : 'Stripes') : (G.isBreak ? (p === G.cur ? 'Break' : '') : 'Open');
        const list = g ? (g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]) : [];
        for (let i = 0; i < 7; i++) {
          if (list.length) row.append(miniBall(list[i], !balls[list[i]].on));
          else { const s = document.createElement('i'); s.className = 'mb slot'; row.append(s); }
        }
        if (g && onEight(p)) row.append(miniBall(8, false));
      }
      nameEl.append(nm, sm);
    }
  }
  function renderPill() {
    let t;
    if (G.phase === 'over') t = 'Game over';
    else if (G.phase === 'rolling' || G.phase === 'strike') t = 'Balls rolling';
    else if (isBotTurn()) t = 'Computer is thinking';
    else if (G.game === 'practice') t = G.bih ? 'Practice · ball in hand' : G.isBreak ? 'Practice · break' : 'Practice';
    else {
      const who = G.mode === 'cpu' ? 'Your turn' : `${pname(G.cur)}'s turn`;
      t = G.bih ? `${who} · ball in hand` : G.isBreak ? `${who} · break` : G.game === '9' ? `${who} · hit the ${lowestOn()}` : onEight(G.cur) ? `${who} · tap a pocket to call the 8` : who;
    }
    pill.innerHTML = '<span class="dot"></span>'; pill.append(document.createTextNode(t));
    const off = String(!canAct());
    powerEl.setAttribute('aria-disabled', off); wheelEl.setAttribute('aria-disabled', off); spinBtn.setAttribute('aria-disabled', off);
  }
  function setSpinUI() {
    for (const el of [$('spinMini'), $('bigBall')]) { el.style.setProperty('--x', spin.x.toFixed(3)); el.style.setProperty('--y', spin.y.toFixed(3)); }
    const v = spin.y > 0.15 ? 'Follow' : spin.y < -0.15 ? 'Draw' : 'Center', s = spin.x > 0.15 ? 'Right english' : spin.x < -0.15 ? 'Left english' : '';
    $('spinTxt').textContent = v; $('spinTxt2').textContent = s;
  }
  function drawPowerCue() {
    const c = CUES.find(x => x.id === skin.cue) || CUES[0], cnv = $('powerCue'), portrait = rootEl.classList.contains('portrait');
    const len = 420, th = 28;
    cnv.width = portrait ? len : th; cnv.height = portrait ? th : len;
    cnv.style.width = portrait ? 'auto' : '14px'; cnv.style.height = portrait ? '14px' : 'auto';
    const g = cnv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cnv.width, cnv.height);
    if (portrait) { g.translate(0, th / 2); drawCue2D(g, c, len, th * 0.9); }
    else { g.translate(th / 2, 0); g.rotate(-Math.PI / 2); g.translate(-len, 0); drawCue2D(g, c, len, th * 0.9); }
  }
  function updateEquipped() {
    const c = CUES.find(x => x.id === skin.cue), t = TABLES.find(x => x.id === skin.table);
    if (!c || !t) return;
    $('eqText').textContent = `${c.name} cue · ${t.name} table`;
    cuePreview($('eqCue'), c);
  }

  // ================= Turn flow =================
  function newGame() {
    const practice = G.game === 'practice', cpu = G.mode === 'cpu' && !practice;
    if (practice) G.breaker = 0;
    const names = practice ? ['You'] : cpu ? ['You', 'Computer'] : [$('n0').value.trim() || 'Player 1', $('n1').value.trim() || 'Player 2'];
    G.players = names.map((name, i) => ({ name, bot: cpu && i === 1 }));
    G.groups = [null, null]; G.cur = G.breaker; G.isBreak = true; G.bih = 'kitchen'; G.paused = false; G.shots = 0;
    G.phase = 'aim'; rackBalls(); aim = 0;
    $('menu').hidden = true; hud.hidden = false; $('over').hidden = true; $('pause').hidden = true;
    layout(); startTurn();
    toast(`${G.cur === 0 && (cpu || practice) ? 'You break' : pname(G.cur) + ' breaks'}. Drag the cue ball behind the line to place it`);
  }
  function startTurn() {
    G.phase = 'aim'; power = 0; spin = { x: 0, y: 0 }; setSpinUI();
    G.call = null; G.callManual = false; G.turnLeft = G.timer;
    if (!cue.on) placeCueDefault();
    if (G.isBreak) aim = Math.atan2(-cue.y, FOOT - cue.x);
    renderCards(); renderPill();
    if (isBotTurn()) { G.phase = 'bot'; renderPill(); setTimeout(botTurn, 450); }
  }
  function shoot() {
    if (G.phase !== 'aim' && G.phase !== 'bot') return;
    if (power < 0.02) { power = 0; return; }
    ensureAudio(); G.phase = 'strike'; strikeT = 0; renderPill();
  }
  function launch() {
    const sp = shotSpeed(power);
    cue.vx = Math.cos(aim) * sp; cue.vy = Math.sin(aim) * sp; cue.ts = spin.y * 1.25; cue.ss = spin.x;
    if (cueFx) burst(cue.x - Math.cos(aim) * R, R, cue.y - Math.sin(aim) * R, cueFx.color, 20 + Math.round(power * 30), 0.5 + power * 0.6);
    rec = newRec(); shotCtx = ctxFor(G.cur, balls, G.isBreak, G.call);
    G.bih = false; G.phase = 'rolling'; noiseHit(0.4 + power * 0.5, 1800, 0.03); power = 0; renderPill();
  }
  function afterShot() {
    const res = judge(rec, shotCtx), cur = G.cur, other = 1 - cur;
    G.shots++;
    if (res.respot8) { respot(8); toast('8-ball potted on the break, so it goes back on the spot'); }
    if (res.respot9) respot(9);
    if (res.win !== null) return gameOver(res.win, res.why);
    if (G.game === 'practice') {
      if (!cue.on) placeCueDefault();
      G.isBreak = false;
      if (objectsLeft() === 0) return gameOver(0, `You cleared the table in ${G.shots} shots`);
      if (res.foul) { G.bih = 'anywhere'; toast('Scratch. Place the cue ball anywhere', true); }
      return startTurn();
    }
    if (res.assign) {
      G.groups[cur] = res.assign; G.groups[other] = res.assign === 'solid' ? 'stripe' : 'solid';
      toast(`${G.mode === 'cpu' && cur === 0 ? 'You are' : pname(cur) + ' is'} ${res.assign === 'solid' ? 'solids' : 'stripes'}`);
    }
    if (!cue.on) placeCueDefault();
    G.isBreak = false;
    if (res.foul) foulTo(other, res.foul);
    else if (!res.keep) G.cur = other;
    startTurn();
  }
  function foulTo(other, why) {
    G.cur = other; G.bih = 'anywhere';
    toast(`Foul: ${why}. ${G.mode === 'cpu' && other === 0 ? 'You have' : pname(other) + ' has'} ball in hand`, true);
  }
  function gameOver(winner, why) {
    G.phase = 'over'; renderCards(); renderPill();
    const you = G.mode === 'cpu' || G.game === 'practice';
    $('overEyebrow').textContent = G.game === 'practice' ? 'Practice' : you ? (winner === 0 ? 'Victory' : 'Defeat') : 'Game over';
    $('overTitle').textContent = G.game === 'practice' ? 'Table cleared' : you ? (winner === 0 ? 'You win' : 'Computer wins') : `${pname(winner)} wins`;
    $('overText').textContent = why + '.';
    setTimeout(() => { if (G.phase === 'over') $('over').hidden = false; }, 700);
  }

  // ================= Bot =================
  const clone = bs => bs.map(b => ({ ...b }));
  function pathClear(ax, ay, bx, by, ignore, bs) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    for (const b of bs) {
      if (!b.on || ignore.includes(b.n)) continue;
      const t = Math.max(0, Math.min(1, ((b.x - ax) * dx + (b.y - ay) * dy) / l2));
      if (Math.hypot(ax + dx * t - b.x, ay + dy * t - b.y) < 2 * R * 0.98) return false;
    }
    return true;
  }
  function legalTargets(p, bs) {
    if (G.game === '9') { const lo = lowestOn(bs); return lo ? [bs[lo]] : []; }
    if (G.game === 'practice') return bs.filter(b => b.on && b.n !== 0);
    const g = G.groups[p];
    if (!g) return bs.filter(b => b.on && b.n !== 0 && b.n !== 8);
    if (onEight(p, bs)) return [bs[8]];
    return bs.filter(b => b.on && b.n !== 0 && grp(b.n) === g);
  }
  function candidate(cx, cy, t, pk, bs) {
    let dx = pk.cx - t.x, dy = pk.cy - t.y; const d2 = Math.hypot(dx, dy); dx /= d2; dy /= d2;
    if (pk.side && Math.abs(dy) < 0.45) return null;
    const gx = t.x - dx * 2 * R, gy = t.y - dy * 2 * R;
    let vx = gx - cx, vy = gy - cy; const d1 = Math.hypot(vx, vy); if (d1 < 0.01) return null; vx /= d1; vy /= d1;
    const cos = vx * dx + vy * dy; if (cos < 0.3) return null;
    if (!pathClear(cx, cy, gx, gy, [0, t.n], bs) || !pathClear(t.x, t.y, pk.cx, pk.cy, [t.n], bs)) return null;
    const vObj = Math.sqrt(2 * 0.35 * (d2 + 0.15)) + 0.3, vCue = vObj / (cos * 0.975), vAt = Math.sqrt(vCue * vCue + 2 * 0.35 * d1);
    return { aim: Math.atan2(vy, vx), p: Math.min(1, Math.pow(Math.max(vAt - 0.35, 0) / 6.2, 1 / 1.3)), score: cos * 2 - (d1 + d2) * 0.35, gx, gy, dx, dy, pk: POCKETS.indexOf(pk) };
  }
  function simulate(place, a, p, sp, call) {
    const bs = clone(balls), c = bs[0];
    if (place) { c.x = place.x; c.y = place.y; c.on = true; }
    const s = shotSpeed(p); c.vx = Math.cos(a) * s; c.vy = Math.sin(a) * s; c.ts = sp.y * 1.25; c.ss = sp.x;
    const r = newRec(), ev = recEvents(r, false), ctx = ctxFor(G.cur, balls, false, call);
    for (let i = 0; i < 15 / STEP && moving(bs); i++) physStep(bs, STEP, ev);
    return { res: judge(r, ctx), bs };
  }
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  function botPlan() {
    const me = G.cur, diff = G.diff, noise = { easy: 0.03, normal: 0.011, hard: 0.0035 }[diff];
    if (G.isBreak) {
      const place = { x: HEAD, y: (Math.random() - 0.5) * 0.25 };
      return { place, aim: Math.atan2(-place.y, FOOT - place.x) + gauss() * 0.004, power: 0.9 + Math.random() * 0.1, spin: { x: 0, y: 0 } };
    }
    const targets = legalTargets(me, balls);
    // Where can the cue ball start from?
    let starts = [{ x: cue.x, y: cue.y, place: null }];
    if (G.bih) {
      starts = [];
      for (const t of targets) for (const pk of POCKETS) {
        let dx = pk.cx - t.x, dy = pk.cy - t.y; const d = Math.hypot(dx, dy); dx /= d; dy /= d;
        if (pk.side && Math.abs(dy) < 0.45) continue;
        if (!pathClear(t.x, t.y, pk.cx, pk.cy, [t.n], balls)) continue;
        for (const back of [0.22, 0.38]) {
          const x = t.x - dx * (2 * R + back), y = t.y - dy * (2 * R + back);
          if (validPlace(x, y, G.bih === 'kitchen')) starts.push({ x, y, place: { x, y }, pre: -d });
        }
      }
      starts.sort((a, b) => b.pre - a.pre); starts = starts.slice(0, 5);
      if (!starts.length) for (let k = 0; k < 60 && starts.length < 4; k++) { const x = (Math.random() * 2 - 1) * (L - 0.1), y = (Math.random() * 2 - 1) * (W - 0.1); if (validPlace(x, y, G.bih === 'kitchen')) starts.push({ x, y, place: { x, y } }); }
    }
    let cands = [];
    for (const s of starts) for (const t of targets) for (const pk of POCKETS) { const c = candidate(s.x, s.y, t, pk, balls); if (c) cands.push({ ...c, s }); }
    cands.sort((a, b) => b.score - a.score);
    cands = cands.slice(0, diff === 'easy' ? 2 : diff === 'normal' ? 5 : 8);
    const spins = diff === 'hard' ? [{ x: 0, y: 0 }, { x: 0, y: -0.55 }, { x: 0, y: 0.5 }] : [{ x: 0, y: 0 }];
    const muls = diff === 'easy' ? [1] : [0.85, 1.15, 1.5];
    let best = null;
    const consider = (s, a, p, sp, call = null) => {
      const { res, bs } = simulate(s.place, a, p, sp, call);
      let score;
      if (res.win === me) score = 1e6; else if (res.win !== null) score = -1e6;
      else if (!res.foul && res.keep) {
        let next = 0; const c0 = bs[0];
        for (const t of legalTargets(me, bs)) for (const pk of POCKETS) if (candidate(c0.x, c0.y, t, pk, bs)) { next++; break; }
        score = 1000 + next * 25 - p * 30;
      } else score = res.foul ? -100 : 100 - p * 20;
      if (!best || score > best.score) best = { score, place: s.place, aim: a, power: p, spin: sp, call };
    };
    for (const c of cands) for (const m of muls) for (const sp of spins) consider(c.s, c.aim, Math.max(0.08, Math.min(1, c.p * m)), sp, c.pk);
    if (!best || best.score < 100) {
      // Safety: roll softly into a legal ball
      const s = starts[0];
      for (const t of targets.slice(0, 6)) for (const p of [0.22, 0.35]) consider(s, Math.atan2(t.y - s.y, t.x - s.x), p, { x: 0, y: 0 });
    }
    if (!best) {
      const s = starts[0] || { x: cue.x, y: cue.y, place: null }, t = targets[0] || balls.find(b => b.on && b.n !== 0);
      best = { place: s.place, aim: t ? Math.atan2(t.y - s.y, t.x - s.x) : aim, power: 0.35, spin: { x: 0, y: 0 }, call: null };
    }
    best.aim += gauss() * noise;
    return best;
  }
  let botAnim = null;
  function botTurn() {
    if (!alive) return;
    if (G.phase !== 'bot' || G.paused) { if (G.phase === 'bot') setTimeout(botTurn, 300); return; }
    const plan = botPlan();
    if (onEight(G.cur)) { G.call = plan.call; G.callManual = true; }
    let da = plan.aim - aim; da = Math.atan2(Math.sin(da), Math.cos(da));
    botAnim = { t: 0, stage: plan.place ? 'place' : 'aim', plan, fx: cue.x, fy: cue.y, a0: aim, da };
  }
  function updateBot(dt) {
    const b = botAnim; if (!b) return;
    b.t += dt; const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    if (b.stage === 'place') {
      const k = Math.min(b.t / 0.6, 1), e = ease(k);
      cue.x = b.fx + (b.plan.place.x - b.fx) * e; cue.y = b.fy + (b.plan.place.y - b.fy) * e; syncPrev(cue);
      if (k >= 1) { b.stage = 'aim'; b.t = 0; let da = b.plan.aim - aim; b.a0 = aim; b.da = Math.atan2(Math.sin(da), Math.cos(da)); }
    } else if (b.stage === 'aim') {
      const k = Math.min(b.t / 0.8, 1); aim = b.a0 + b.da * ease(k);
      if (k >= 1) { b.stage = 'power'; b.t = 0; spin = { ...b.plan.spin }; setSpinUI(); }
    } else if (b.stage === 'power') {
      const k = Math.min(b.t / 0.6, 1); power = b.plan.power * ease(k);
      if (k >= 1) { botAnim = null; shoot(); }
    }
  }

  // ================= Camera =================
  const goalPos = new THREE.Vector3(), goalLook = new THREE.Vector3(), curLook = new THREE.Vector3();
  let menuT = 0, viewOff = { x: 0, y: 0 }, topH = 4, area = null, tableVertical = false;
  function layout() {
    // The phone layout (controls along the bottom) is only for real phones held upright
    const portrait = window.innerWidth < 480 && window.innerHeight > window.innerWidth;
    rootEl.classList.toggle('portrait', portrait);
    drawPowerCue();
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    if (hud.hidden) { area = null; camera.updateProjectionMatrix(); return; }
    const top = shadow.querySelector('.topbar').getBoundingClientRect().bottom + 6;
    let a;
    if (portrait) { const bottom = Math.min(wheelEl.getBoundingClientRect().top, powerEl.getBoundingClientRect().top) - 8; a = { x: 8, y: top, w: w - 16, h: bottom - top }; }
    else { const left = powerEl.getBoundingClientRect().right + 10, right = Math.min(spinBtn.getBoundingClientRect().left, wheelEl.getBoundingClientRect().left) - 10; a = { x: left, y: top, w: right - left, h: h - top - 10 }; }
    area = a;
    // Stand the table upright whenever that makes it bigger in the space between the controls
    const ex = L + 0.2, ey = W + 0.2;
    const sFlat = Math.min(a.w / (2 * ex), a.h / (2 * ey)), sUp = Math.min(a.w / (2 * ey), a.h / (2 * ex));
    tableVertical = sUp > sFlat;
    const s = Math.max(sFlat, sUp), t = Math.tan(THREE.MathUtils.degToRad(30 / 2));
    topH = h / (2 * s * t); viewOff = { x: w / 2 - (a.x + a.w / 2), y: h / 2 - (a.y + a.h / 2) };
    camera.updateProjectionMatrix();
  }
  function cameraFrame(dt) {
    let fov = 42, top = false;
    if (G.phase === 'menu') {
      menuT += dt * 0.07;
      goalPos.set(Math.cos(menuT) * 2.5, 1.1, Math.sin(menuT) * 1.9); goalLook.set(0.2, -0.1, 0); camera.up.set(0, 1, 0);
    } else if (view === 'top') {
      top = true; fov = 30; goalPos.set(0, topH, 0); goalLook.set(0, 0, 0);
      camera.up.set(tableVertical ? 1 : 0, 0, tableVertical ? 0 : -1);
    } else {
      camera.up.set(0, 1, 0);
      if (G.phase !== 'rolling' && cue.on) {
        const dx = Math.cos(aim), dy = Math.sin(aim);
        goalPos.set(cue.x - dx * 0.8, 0.3, cue.y - dy * 0.8); goalLook.set(cue.x + dx * 0.5, 0, cue.y + dy * 0.5);
      }
    }
    // The lamp hangs between an overhead camera and the table, so hide it there (its lights stay on)
    lampGroup.visible = !top;
    if (camera.fov !== fov) { camera.fov = fov; }
    // Small windows push the overhead camera far back; keep the fog beyond the table so it never dims it
    scene.fog.near = top ? topH + 2 : 4; scene.fog.far = top ? topH + 12 : 11;
    if (top && area) camera.setViewOffset(window.innerWidth, window.innerHeight, viewOff.x, viewOff.y, window.innerWidth, window.innerHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const k = 1 - Math.exp(-dt * (G.phase === 'menu' ? 2 : 6));
    camera.position.lerp(goalPos, k); curLook.lerp(goalLook, k); camera.lookAt(curLook);
  }

  // ================= Input =================
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R), hitP = new THREE.Vector3(), ndc = new THREE.Vector2();
  function worldAt(x, y) {
    const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hitP) ? { x: hitP.x, y: hitP.z } : null;
  }
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    ensureAudio(); if (!canAct()) return;
    const p = worldAt(e.clientX, e.clientY);
    if (p && onEight(G.cur)) {
      const i = POCKETS.findIndex(pk => Math.hypot(pk.sx - p.x, pk.sy - p.y) < 0.11);
      if (i >= 0) { G.call = i; G.callManual = true; return; }
    }
    canvas.setPointerCapture(e.pointerId);
    if (G.bih && p && Math.hypot(p.x - cue.x, p.y - cue.y) < 0.08) drag = { kind: 'place', x: e.clientX };
    else { drag = { kind: 'aim', x: e.clientX }; if (view === 'top' && p) aim = Math.atan2(p.y - cue.y, p.x - cue.x); }
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || !canAct()) return;
    if (drag.kind === 'place') {
      const p = worldAt(e.clientX, e.clientY);
      if (p) {
        const kitchen = G.bih === 'kitchen';
        const x = Math.max(-(L - R), Math.min(kitchen ? HEAD : L - R, p.x)), y = Math.max(-(W - R), Math.min(W - R, p.y));
        if (validPlace(x, y, kitchen)) { cue.x = x; cue.y = y; syncPrev(cue); }
        if (G.isBreak) aim = Math.atan2(-cue.y, FOOT - cue.x);
      }
    } else if (view === 'top') { const p = worldAt(e.clientX, e.clientY); if (p && Math.hypot(p.x - cue.x, p.y - cue.y) > 0.01) aim = Math.atan2(p.y - cue.y, p.x - cue.x); }
    else aim += (e.clientX - drag.x) * 0.0035;
    drag.x = e.clientX;
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

  // Power: pull back (down in landscape, left in portrait) and release
  let pdrag = null;
  powerEl.addEventListener('pointerdown', e => {
    if (!canAct()) return; ensureAudio(); powerEl.setPointerCapture(e.pointerId);
    const r = powerEl.querySelector('.track').getBoundingClientRect();
    pdrag = { x: e.clientX, y: e.clientY, len: rootEl.classList.contains('portrait') ? r.width : r.height };
  });
  powerEl.addEventListener('pointermove', e => {
    if (!pdrag) return;
    const d = rootEl.classList.contains('portrait') ? pdrag.x - e.clientX : e.clientY - pdrag.y;
    power = Math.max(0, Math.min(1, d / (pdrag.len * 0.8)));
  });
  const powerUp = () => { if (!pdrag) return; pdrag = null; if (canAct()) shoot(); };
  powerEl.addEventListener('pointerup', powerUp);
  powerEl.addEventListener('pointercancel', () => { pdrag = null; power = 0; });

  // Fine aim wheel
  let wdrag = null, wheelOff = 0;
  wheelEl.addEventListener('pointerdown', e => { if (!canAct()) return; wheelEl.setPointerCapture(e.pointerId); wdrag = { x: e.clientX, y: e.clientY }; });
  wheelEl.addEventListener('pointermove', e => {
    if (!wdrag || !canAct()) return;
    const portrait = rootEl.classList.contains('portrait'), d = portrait ? e.clientX - wdrag.x : wdrag.y - e.clientY;
    aim += d * 0.0009; wheelOff += d; wheelEl.style.setProperty('--o', wheelOff + 'px'); wdrag = { x: e.clientX, y: e.clientY };
  });
  wheelEl.addEventListener('pointerup', () => { wdrag = null; }); wheelEl.addEventListener('pointercancel', () => { wdrag = null; });

  // Spin sheet
  spinBtn.addEventListener('click', () => { if (canAct()) $('spinSheet').hidden = false; });
  const big = $('bigBall');
  let sdrag = false;
  const setSpinFrom = e => {
    const r = big.getBoundingClientRect(); let x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const m = Math.hypot(x, y); if (m > 0.8) { x *= 0.8 / m; y *= 0.8 / m; }
    spin = { x, y }; setSpinUI();
  };
  big.addEventListener('pointerdown', e => { sdrag = true; big.setPointerCapture(e.pointerId); setSpinFrom(e); });
  big.addEventListener('pointermove', e => { if (sdrag) setSpinFrom(e); });
  big.addEventListener('pointerup', () => { sdrag = false; });
  $('spinReset').addEventListener('click', () => { spin = { x: 0, y: 0 }; setSpinUI(); });
  $('spinDone').addEventListener('click', () => { $('spinSheet').hidden = true; });

  listen(window, 'keydown', e => {
    if (e.composedPath()[0].tagName === 'INPUT') return;
    if (e.code === 'Space' && canAct()) { e.preventDefault(); if (!e.repeat) { keyCharge = true; chargeT = 0; ensureAudio(); } }
    if (canAct() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); aim += (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) * (e.shiftKey ? 0.002 : 0.012);
    }
    if (e.key === 'Escape') { if (!$('spinSheet').hidden) $('spinSheet').hidden = true; else if (!$('locker').hidden) closeLocker(); }
  });
  listen(window, 'keyup', e => { if (e.code === 'Space' && keyCharge) { e.preventDefault(); keyCharge = false; shoot(); } });

  // Top bar
  const viewBtn = $('viewBtn');
  const setView = v => { view = v; store.set('view', v); viewBtn.textContent = v === 'top' ? '3D' : 'Top'; viewBtn.setAttribute('aria-label', v === 'top' ? 'Switch to 3D view' : 'Switch to top view'); };
  viewBtn.addEventListener('click', () => setView(view === 'top' ? '3d' : 'top'));
  $('menuBtn').addEventListener('click', () => { G.paused = true; $('pause').hidden = false; });
  $('resume').addEventListener('click', () => { G.paused = false; $('pause').hidden = true; });
  $('restart').addEventListener('click', () => { botAnim = null; newGame(); });
  $('quit').addEventListener('click', toMenu);
  $('pLocker').addEventListener('click', () => { $('pause').hidden = true; openLocker(); });
  $('rematch').addEventListener('click', () => { G.breaker = 1 - G.breaker; botAnim = null; newGame(); });
  $('overMenu').addEventListener('click', toMenu);
  function toMenu() {
    botAnim = null; G.phase = 'menu'; G.paused = false; hud.hidden = true;
    for (const id of ['pause', 'over', 'spinSheet']) $(id).hidden = true;
    $('menu').hidden = false; rackBalls(); layout();
  }

  // Menu
  const setMode = m => { G.mode = m; store.set('mode', m); $('mCpu').setAttribute('aria-pressed', String(m === 'cpu')); $('m2p').setAttribute('aria-pressed', String(m === '2p')); $('cpuOpts').hidden = m !== 'cpu' || G.game === 'practice'; $('pvpOpts').hidden = m === 'cpu' || G.game === 'practice'; };
  $('mCpu').addEventListener('click', () => setMode('cpu')); $('m2p').addEventListener('click', () => setMode('2p'));
  const setDiff = d => { G.diff = d; store.set('diff', d); for (const b of $('diffSeg').children) b.setAttribute('aria-pressed', String(b.dataset.d === d)); };
  for (const b of $('diffSeg').children) b.addEventListener('click', () => setDiff(b.dataset.d));
  const segPick = (id, key, val, cast = v => v) => { G[key] = val; store.set(key, val); for (const b of $(id).children) b.setAttribute('aria-pressed', String(cast(b.dataset.v) === val)); };
  const LEDES = {
    '8': ['8-Ball', 'Pot all your solids or stripes, then call a pocket and sink the 8.'],
    '9': ['9-Ball', 'Always hit the lowest ball first. Whoever sinks the 9 wins.'],
    practice: ['Practice', 'Rack them up and clear the table alone. No fouls, no opponent.'],
  };
  const setGame = v => {
    segPick('gameSeg', 'game', v);
    $('gameTitle').textContent = LEDES[v][0]; $('gameLede').textContent = LEDES[v][1];
    const practice = v === 'practice';
    $('modeCards').hidden = practice; $('timerOpts').hidden = practice;
    $('cpuOpts').hidden = practice || G.mode !== 'cpu'; $('pvpOpts').hidden = practice || G.mode === 'cpu';
  };
  for (const b of $('gameSeg').children) b.addEventListener('click', () => setGame(b.dataset.v));
  for (const b of $('guideSeg').children) b.addEventListener('click', () => segPick('guideSeg', 'guide', b.dataset.v));
  for (const b of $('timerSeg').children) b.addEventListener('click', () => segPick('timerSeg', 'timer', Number(b.dataset.v), Number));
  $('play').addEventListener('click', () => { ensureAudio(); G.breaker = 0; newGame(); });

  // Locker
  let lockTab = 'cues';
  function renderLocker() {
    const wrap = $('skins'); wrap.innerHTML = '';
    for (const b of $('lockTabs').children) b.setAttribute('aria-pressed', String(b.dataset.t === lockTab));
    const list = lockTab === 'cues' ? CUES : TABLES;
    for (const it of list) {
      const btn = document.createElement('button'); btn.className = 'skin ' + (lockTab === 'cues' ? 'cue' : 'table');
      const on = lockTab === 'cues' ? skin.cue === it.id : skin.table === it.id; btn.setAttribute('aria-pressed', String(on));
      const cnv = document.createElement('canvas');
      if (lockTab === 'cues') { cnv.width = 520; cnv.height = 40; cuePreview(cnv, it); } else { cnv.width = 360; cnv.height = 200; tablePreview(cnv, it); }
      const sn = document.createElement('span'); sn.className = 'sn';
      const nm = document.createElement('b'); nm.textContent = it.name;
      const tg = document.createElement('span'); tg.className = 'tag ' + it.tag; tg.textContent = it.tag;
      const fx = (lockTab === 'cues' ? CUE_FX : TABLE_FX)[it.id];
      const fl = document.createElement('span'); fl.className = 'fxl' + (fx ? ' on' : ''); fl.textContent = fx ? `Effect · ${fx.label}` : 'No effect';
      if (fx) fl.style.setProperty('--fx', fx.color);
      sn.append(nm, tg); btn.append(cnv, sn, fl);
      btn.addEventListener('click', () => { if (lockTab === 'cues') applyCue(it.id); else applyTable(it.id); renderLocker(); });
      wrap.append(btn);
    }
  }
  function openLocker() { $('locker').hidden = false; renderLocker(); }
  function closeLocker() { $('locker').hidden = true; if (G.paused && G.phase !== 'menu') $('pause').hidden = false; }
  $('lockerOpen').addEventListener('click', openLocker);
  $('lockerClose').addEventListener('click', closeLocker);
  for (const b of $('lockTabs').children) b.addEventListener('click', () => { lockTab = b.dataset.t; renderLocker(); });

  // ================= Aim trace =================
  function traceAim() {
    const dx = Math.cos(aim), dy = Math.sin(aim);
    let tMin = Infinity, hit = null;
    for (const b of balls) {
      if (b.n === 0 || !b.on) continue;
      const fx = cue.x - b.x, fy = cue.y - b.y, bq = fx * dx + fy * dy, cq = fx * fx + fy * fy - 4 * R * R, disc = bq * bq - cq;
      if (disc > 0) { const t = -bq - Math.sqrt(disc); if (t > 0 && t < tMin) { tMin = t; hit = b; } }
    }
    const tx = dx > 0 ? (L - R - cue.x) / dx : dx < 0 ? (-(L - R) - cue.x) / dx : Infinity;
    const ty = dy > 0 ? (W - R - cue.y) / dy : dy < 0 ? (-(W - R) - cue.y) / dy : Infinity;
    const tc = Math.min(tx, ty); if (tc < tMin) { tMin = tc; hit = null; }
    const gx = cue.x + dx * tMin, gy = cue.y + dy * tMin;
    setLine(aimLine, cue.x, cue.y, gx, gy);
    ghost.position.set(gx, R, gy); ghostRing.position.set(gx, 0.001, gy);
    objLine.visible = cueLine.visible = !!hit;
    if (hit) {
      let ox = hit.x - gx, oy = hit.y - gy; const ol = Math.hypot(ox, oy); ox /= ol; oy /= ol;
      setLine(objLine, hit.x, hit.y, hit.x + ox * 0.3, hit.y + oy * 0.3);
      const dot = dx * ox + dy * oy; let cx = dx - ox * dot, cy = dy - oy * dot; const cl = Math.hypot(cx, cy);
      if (cl > 1e-4) { cx /= cl; cy /= cl; const len = 0.18 * (1 - dot); setLine(cueLine, gx, gy, gx + cx * len, gy + cy * len); } else cueLine.visible = false;
      // Auto-call the pocket the 8 is heading for, until the player taps one
      if (hit.n === 8 && onEight(G.cur) && !G.callManual) {
        let bi = 0, bd = -2;
        POCKETS.forEach((pk, i) => { const px = pk.cx - hit.x, py = pk.cy - hit.y, pl = Math.hypot(px, py), d = (px * ox + py * oy) / pl; if (d > bd) { bd = d; bi = i; } });
        G.call = bi;
      }
      if (G.guide === 'short') setLine(objLine, hit.x, hit.y, hit.x + ox * 0.1, hit.y + oy * 0.1);
    }
    if (G.guide === 'off') { aimLine.visible = ghost.visible = ghostRing.visible = objLine.visible = cueLine.visible = false; }
    else if (G.guide === 'short') {
      const sl = Math.min(tMin, 0.35); setLine(aimLine, cue.x, cue.y, cue.x + dx * sl, cue.y + dy * sl);
      cueLine.visible = false;
      if (tMin > 0.35) ghost.visible = ghostRing.visible = objLine.visible = false;
    }
  }

  // ================= Main loop =================
  const tmpQ = new THREE.Quaternion(), tmpAxis = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), back = new THREE.Vector3();
  let last = performance.now(), acc = 0, cardsDirty = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    update(dt, now);
    renderer.render(scene, camera);
    if (alive) raf = requestAnimationFrame(frame);
  }
  function update(dt, now) {
    if (!G.paused) {
      if (keyCharge && canAct()) { chargeT += dt; power = (1 - Math.cos(chargeT * Math.PI / 0.9)) / 2; }
      if (G.phase === 'bot') updateBot(dt);
      const timed = G.timer > 0 && G.game !== 'practice' && G.phase === 'aim' && !isBotTurn() && $('spinSheet').hidden;
      if (timed) {
        G.turnLeft -= dt;
        if (G.turnLeft <= 0) { pdrag = null; keyCharge = false; foulTo(1 - G.cur, 'Time ran out'); startTurn(); }
      }
      for (let p = 0; p < 2; p++) {
        const bar = $('card' + p).querySelector('.tbar'), t = G.timer && G.cur === p && G.phase === 'aim' ? Math.max(0, G.turnLeft / G.timer) : 0;
        bar.style.setProperty('--t', t.toFixed(3)); bar.classList.toggle('low', t > 0 && t < 0.3);
      }
      if (G.phase === 'strike') {
        strikeT += dt; gap = (0.012 + power * 0.2) * Math.max(0, 1 - strikeT / 0.07);
        if (strikeT >= 0.07) launch();
      } else if (G.phase === 'aim' || G.phase === 'bot') gap = 0.012 + power * 0.2;
      if (G.phase === 'rolling') {
        acc += dt; let n = 0;
        while (acc >= STEP && n < 40) { physStep(balls, STEP, recEvents(rec, true)); acc -= STEP; n++; }
        if (++cardsDirty % 10 === 0) renderCards();
        if (cueFx && cue.on && Math.hypot(cue.vx, cue.vy) > 0.15) for (let i = 0; i < 2; i++) emit(fxSmall, cue.x + rnd(-0.008, 0.008), R, cue.y + rnd(-0.008, 0.008), 0, 0, 0, cueFx.color, 0.35);
        if (!moving(balls) && !falls.length) { acc = 0; afterShot(); }
      }
      for (let i = falls.length - 1; i >= 0; i--) {
        const f = falls[i]; f.t += dt; const k = Math.min(f.t / 0.28, 1), m = meshes[f.n];
        const kk = Math.min(k * 1.4, 1); m.position.set(f.fx + (f.tx - f.fx) * kk, R - k * k * 0.09, f.fy + (f.ty - f.fy) * kk);
        if (k >= 1) { m.visible = false; falls.splice(i, 1); }
      }
    }
    // Ball meshes + rolling rotation
    for (const b of balls) {
      if (!b.on) continue;
      const m = meshes[b.n], p = prev[b.n], dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
      if (d > 0) { tmpAxis.set(dy / d, 0, -dx / d); tmpQ.setFromAxisAngle(tmpAxis, d / R); m.quaternion.premultiply(tmpQ); p.x = b.x; p.y = b.y; }
      m.visible = true; m.position.set(b.x, R, b.y);
    }
    // Stick, guide, ball-in-hand ring
    const aiming = (G.phase === 'aim' || G.phase === 'bot' || G.phase === 'strike') && cue.on && !G.paused;
    stick.visible = aiming;
    const guide = (G.phase === 'aim' || G.phase === 'bot') && cue.on;
    for (const o of [aimLine, ghost, ghostRing]) o.visible = guide;
    if (guide) traceAim(); else objLine.visible = cueLine.visible = false;
    callRing.visible = G.call != null && G.phase !== 'menu' && G.phase !== 'over' && onEight(G.cur);
    if (callRing.visible) { const pk = POCKETS[G.call]; callRing.position.set(pk.sx, 0.05, pk.sy); callRing.material.opacity = 0.6 + 0.3 * Math.sin(now / 180); }
    handRing.visible = !!G.bih && G.phase === 'aim' && !isBotTurn();
    if (handRing.visible) { handRing.position.set(cue.x, 0.002, cue.y); handRing.material.opacity = 0.45 + 0.35 * Math.sin(now / 220); }
    if (aiming) {
      const elev = view === 'top' ? 0.05 : 0.09, dx = Math.cos(aim), dy = Math.sin(aim);
      back.set(-dx * Math.cos(elev), Math.sin(elev), -dy * Math.cos(elev));
      stick.quaternion.setFromUnitVectors(up, back);
      stick.position.set(cue.x, R + 0.004, cue.y).addScaledVector(back, R + gap);
    }
    // Effects: particles are sized in world units, so scale them up for the distant overhead camera
    if (!G.paused) { cueEffects(dt, now); tableEffects(dt, now); stepParticles(fxSmall, dt, now); stepParticles(fxBig, dt, now); }
    const far = view === 'top' && G.phase !== 'menu' ? 3.6 : 1;
    fxSmall.mat.size = fxSmall.size * far; fxBig.mat.size = fxBig.size * far;
    // Power UI
    powerEl.style.setProperty('--p', power.toFixed(3));
    const pct = Math.round(power * 100); $('pv').textContent = pct; powerEl.setAttribute('aria-valuenow', pct);

    cameraFrame(dt);
  }

  // ================= Boot =================
  applyTable(skin.table); applyCue(skin.cue);
  setMode(G.mode); setDiff(G.diff); setGame(G.game); setView(view); setSpinUI();
  segPick('guideSeg', 'guide', G.guide); segPick('timerSeg', 'timer', G.timer, Number);
  const setLight = v => { segPick('lightSeg', 'light', v); segPick('lightSeg2', 'light', v); applyLighting(v); };
  for (const id of ['lightSeg', 'lightSeg2']) for (const b of $(id).children) b.addEventListener('click', () => setLight(b.dataset.v));
  setLight(G.light);
  rackBalls(); layout();
  camera.position.set(2.5, 1.1, 0); curLook.set(0.2, -0.1, 0);
  listen(window, 'resize', layout);
  if (import.meta.env.DEV) window.__pool = { G, balls, camera, setAim: a => { aim = a; }, setPower: p => { power = p; }, shoot, newGame, startTurn, tick: n => { for (let i = 0; i < n; i++) update(1 / 30, performance.now()); }, state: () => ({ aim, power, phase: G.phase, falls: falls.length, bih: G.bih, cur: G.cur }) };
  $('exitBtn').addEventListener('click', () => onExit());
  let raf = requestAnimationFrame(frame);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    for (const [target, type, fn] of unlisten) target.removeEventListener(type, fn);
    clearTimeout(toastTimer);
    if (actx) actx.close().catch(() => {});
    renderer.dispose(); renderer.forceContextLoss();
    shadow.innerHTML = '';
    if (import.meta.env.DEV) delete window.__pool;
  };
}
