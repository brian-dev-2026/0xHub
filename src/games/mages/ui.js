// Mage Siege interface: the world map, team select, in-game HUD (stats, boss bar, shop, wave button, mage details),
// pause and results screens.
// Pure DOM inside the engine's shadow root; it renders what it is told and reports clicks through `on` callbacks.
import { BUILD_BREAK_SECS, ENEMIES, MAGES, MAX_TRAPS, PASSIVES, SPELLS, TICK_HZ, TRAPS, UNLOCKS, secs } from '../../../shared/games/mages/data';
import { magePrice } from '../../../shared/games/mages/combat';
import { totalWaves } from '../../../shared/games/mages/sim';

// The pending-run storage helpers live with the rest of run submission in submit.js; re-exported for the plan's interface
export { clearPendingRun, loadPendingRun, savePendingRun } from './submit';

// ================= Text =================
export const MAGE_COLOR = { fire: '#ff7a3d', ice: '#8fd8ff', lightning: '#c9a6ff', earth: '#e3a554', poison: '#93dc4e', wind: '#8ff0dc' };
const ROLE = {
  fire: 'Splash damage that sets enemies alight',
  ice: 'Slows the path, then freezes it solid',
  lightning: 'Chains between enemies, strong against flyers',
  earth: 'Heavy hits that strip armor',
  poison: 'Venom that stacks on every hit',
  wind: 'Rapid hits that blow enemies back',
};
const TERRAIN_NAME = { grass: 'Grass', hill: 'Hill', water: 'Water', lava: 'Lava vent', crystal: 'Storm crystal', forest: 'Forest', well: 'Mana well', ruins: 'Ruins' };
const TRAP_TEXT = {
  spike: { name: 'Spike Trap', text: 'Stabs each ground enemy that steps on it.' },
  barricade: { name: 'Barricade', text: 'Blocks the path until enemies break through.' },
  frost: { name: 'Frost Rune', text: 'Slows enemies on its tile by 40%.' },
  mine: { name: 'Blast Mine', text: 'Explodes under the first enemy. Single use.' },
};
const SPELL_TEXT = {
  meteor: { name: 'Meteor', text: 'Tap a spot: a huge impact in 1.2 tiles.' },
  freeze: { name: 'Time Freeze', text: 'Freezes every enemy for 3 s.' },
  surge: { name: 'Mana Surge', text: "Fully charges every mage's active." },
};
const BOSS_NAME = { goblinChief: 'Goblin Chief', direWolf: 'Dire Wolf', troll: 'Troll', witch: 'Witch', treant: 'Ancient Treant' };
const STAGE_BOSS = ['goblinChief', 'direWolf', 'troll', 'witch', 'treant'];
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** What a mage's passive and active do at `level` (1–5), with that level's numbers. */
export function describeMage(kind, level) {
  const d = MAGES[kind], i = level - 1, p = d.passive[i], a = d.active[i], L5 = level >= 5;
  switch (kind) {
    case 'fire': return {
      passive: { name: 'Burn', text: `Hits burn for ${p}% of hit damage per second over ${PASSIVES.burnSecs} s.${level >= PASSIVES.burnSpreadLevel ? ' Fire spreads when a burning enemy dies.' : ''}${L5 ? ' Burning enemies explode.' : ''}` },
      active: { name: 'Flame Pillars', text: `${plural(a, 'pillar')} of fire erupt along the path for 300% damage.${L5 ? ' Leaves lava for 5 s.' : ''}` },
    };
    case 'ice': return {
      passive: { name: 'Chill', text: `Hits slow by ${p}% for ${PASSIVES.slowSecs} s.${level >= PASSIVES.freezeLevel ? ' Every 5th hit freezes for 1 s.' : ''}${L5 ? ' Frozen enemies take +50% damage.' : ''}` },
      active: { name: 'Blizzard', text: `A ${a}-tile storm for 4 s: slows 50% and deals 60% damage per second.${L5 ? ' Freezes everything inside for 2 s.' : ''}` },
    };
    case 'lightning': return {
      passive: { name: 'Chain Lightning', text: `${L5 ? 'Every attack' : 'Every 3rd attack'} chains to ${plural(p, 'more enemy', 'more enemies')}.` },
      active: { name: 'Thunder Stun', text: `Strikes the ${a} front enemies in reach for 250% and stuns them ${d.stun[i]} s.${L5 ? ' Struck ground stays charged for 4 s.' : ''}` },
    };
    case 'earth': return {
      passive: { name: 'Armor Break', text: `Hits strip ${p} armor for good.${L5 ? ' Each hit also quakes the ground around it.' : ''}` },
      active: { name: 'Earthquake', text: `Shakes ${a} path tiles for 200% damage and a ${d.stun[i]} s stun.${L5 ? ' Raises a rock wall for 3 s.' : ''}` },
    };
    case 'poison': return {
      passive: { name: 'Venom', text: `Each hit adds a stack (up to ${p}); each stack deals ${PASSIVES.venomDpsPerLevel * level} damage per second.${L5 ? ' Stacks jump on when the enemy dies.' : ''}` },
      active: { name: 'Plague Cloud', text: `A ${a}-tile cloud for 5 s adds a stack every second and stops all healing.${L5 ? ' It drifts with the enemies.' : ''}` },
    };
    default: return {
      passive: { name: 'Gust', text: `${p}% chance per hit to blow the enemy back ${PASSIVES.knockback[i]} tile${PASSIVES.knockback[i] === 1 ? '' : 's'}.` },
      active: { name: 'Tornado', text: `${a === 2 ? 'Two tornadoes sweep' : 'A tornado sweeps'} back from the exit, carrying enemies back up to 2 tiles.` },
    };
  }
}
/** What standing on `terrain` gives this mage, or ''. */
function terrainNote(kind, terrain) {
  const parts = [];
  if (MAGES[kind].boost.includes(terrain)) parts.push('+30% damage');
  if (terrain === 'hill') parts.push('+25% range');
  if (terrain === 'crystal') parts.push('charges 20% faster');
  if (terrain === 'well') parts.push('charges 35% faster');
  if (terrain === 'ruins') parts.push('+50% kill gold');
  return parts.length ? `${TERRAIN_NAME[terrain]}: ${parts.join(', ')}` : '';
}
/** The stage whose clear unlocks `kind` (a mage, trap or spell id), or 0 when it is unlocked from the start. */
function unlockStage(group, id) {
  for (const s of [1, 2, 3, 4, 5]) if ((UNLOCKS.stages[s][group] || []).includes(id)) return s;
  return 0;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Math.floor(n).toLocaleString('en-US');

// ================= Icons (inline SVG, currentColor) =================
const svg = (body, { fill = true, w = 2 } = {}) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : `fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`}>${body}</svg>`;
export const ICON = {
  heart: svg('<path d="M12 20.6s-7.4-4.5-9.4-9C1 8 3.1 4.3 6.8 4.3c2.1 0 3.6 1.1 4.3 2.6h1.8c.7-1.5 2.2-2.6 4.3-2.6 3.7 0 5.8 3.7 4.2 7.3-2 4.5-9.4 9-9.4 9z"/><path d="M7 7.6c-1.4.2-2.3 1.4-2.2 2.8" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.4" stroke-linecap="round"/>'),
  coin: svg('<circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="rgba(60,36,0,.42)" stroke-width="1.5"/><path d="M9.6 9.2h4.2M12 9.2v5.8" stroke="rgba(60,36,0,.5)" stroke-width="1.6" stroke-linecap="round"/>'),
  flag: svg('<path d="M5.5 21V3.5"/><path d="M5.5 4.5h12l-2.6 4.2 2.6 4.3h-12z" fill="currentColor" stroke="none"/>', { fill: false, w: 2.2 }),
  pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/>'),
  play: svg('<path d="M7.5 4.8v14.4c0 .8.9 1.3 1.6.8l10.6-7.2a1 1 0 0 0 0-1.6L9.1 4c-.7-.5-1.6 0-1.6.8z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', { fill: false, w: 2.4 }),
  back: svg('<path d="M14.5 5l-7 7 7 7"/>', { fill: false, w: 2.6 }),
  next: svg('<path d="M9.5 5l7 7-7 7"/>', { fill: false, w: 2.6 }),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/>'),
  star: svg('<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.3l-5.8 3.1 1.1-6.4-4.7-4.6 6.5-.9z"/>'),
  retry: svg('<path d="M19.5 12.5A7.5 7.5 0 1 1 17 6.6"/><path d="M19.5 3.8v4.6h-4.6"/>', { fill: false, w: 2.4 }),
  map: svg('<path d="M9 4.5 3.5 6.6v13l5.5-2.1 6 2.1 5.5-2.1v-13L15 6.6z"/><path d="M9 4.5v13M15 6.6v13"/>', { fill: false, w: 2 }),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', { fill: false, w: 3 }),
  cloud: svg('<path d="M7 18.5h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 10.3a4.1 4.1 0 0 0 1 8.2z"/><path d="M4 4l16 16" stroke="#ef5b5b"/>', { fill: false, w: 2 }),
  infinity: svg('<path d="M12 12c-2-2.6-3.6-4-5.6-4a4 4 0 0 0 0 8c2 0 3.6-1.4 5.6-4s3.6-4 5.6-4a4 4 0 0 1 0 8c-2 0-3.6-1.4-5.6-4z"/>', { fill: false, w: 2.4 }),
  crown: svg('<path d="M3.5 8.5l4.6 3.7L12 5.5l3.9 6.7 4.6-3.7-1.9 10H5.4z"/><rect x="5.4" y="19.4" width="13.2" height="1.8" rx=".9"/>'),
  tree: svg('<path d="M12 2.5c-2.8 0-4.9 2.2-4.9 4.8C5.3 8 4 9.6 4 11.6 4 14 6 16 8.5 16h2.4v5.5h2.2V16h2.4c2.5 0 4.5-2 4.5-4.4 0-2-1.3-3.6-3.1-4.3 0-2.6-2.1-4.8-4.9-4.8z"/>'),
  hat: svg('<path d="M12 2.2c-.6 0-1 .3-1.3.9L6.6 14.6h10.8L13.4 3.4c-.3-.7-.8-1.2-1.4-1.2z"/><path d="M2.5 16.8c0-1.4 4.3-2.6 9.5-2.6s9.5 1.2 9.5 2.6-4.3 2.9-9.5 2.9-9.5-1.5-9.5-2.9z"/>'),
  sparkle: svg('<path d="M10.5 2.5l1.9 6.1 6.1 1.9-6.1 1.9-1.9 6.1-1.9-6.1-6.1-1.9 6.1-1.9z"/><path d="M18.5 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/>'),
  // Traps
  spike: svg('<path d="M3 20.5h18"/><path d="M4.5 19.5 7 9.5l2.5 10M9.5 19.5 12 5l2.5 14.5M14.5 19.5 17 9.5l2.5 10" fill="currentColor"/>', { fill: false, w: 1.6 }),
  barricade: svg('<path d="M5 21V7.5L6.6 4l1.6 3.5V21zM10.4 21V6.5L12 3l1.6 3.5V21zM15.8 21V7.5L17.4 4 19 7.5V21z"/><rect x="2.5" y="10" width="19" height="2.6" rx=".6" opacity=".85"/><rect x="2.5" y="15" width="19" height="2.6" rx=".6" opacity=".85"/>'),
  frost: svg('<circle cx="12" cy="12" r="9.2" stroke-dasharray="3 2.2"/><path d="M12 5.5v13M6.4 8.8l11.2 6.4M6.4 15.2l11.2-6.4M10.4 6.6 12 8.2l1.6-1.6M10.4 17.4 12 15.8l1.6 1.6"/>', { fill: false, w: 1.7 }),
  mine: svg('<path d="M3.5 18.5a8.5 8.5 0 0 1 17 0z"/><rect x="2.5" y="18" width="19" height="2.6" rx="1.3"/><circle cx="12" cy="11.6" r="1.8" fill="#ffd36b"/><path d="M12 5.4V2.8M6.4 7.9 4.9 6.4M17.6 7.9l1.5-1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  // Spells
  meteor: svg('<circle cx="15" cy="9" r="5.2"/><path d="M10.6 13.4 3.5 20.5M9.4 9.6 4.8 14.2M14.4 14.6l-4.6 4.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".7"/><circle cx="16.4" cy="7.6" r="1.5" fill="rgba(255,255,255,.6)"/>'),
  freeze: svg('<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.6 4.2 12 6.6l2.4-2.4M9.6 19.8 12 17.4l2.4 2.4M4.3 10.6l3.3-.9-.9-3.3M19.7 13.4l-3.3.9.9 3.3M4.3 13.4l3.3.9-.9 3.3M19.7 10.6l-3.3-.9.9-3.3"/>', { fill: false, w: 1.8 }),
  surge: svg('<path d="M13.2 2.2 4.8 13.4h6.1l-1.4 8.4 8.9-11.6h-6.3z"/>'),
};
/** Fallback element emblems, shown until the 3D portraits are rendered. */
const EMBLEM = {
  fire: svg('<path d="M12 2.5c.5 3-1.3 4.6-2.6 6.2C8 10.4 7 12 7 14.3a5 5 0 0 0 10 0c0-2.4-1.2-4-2-5.3-.2 1.3-.9 2.3-1.8 2.6.5-3.2-.1-6.6-1.2-9.1z"/>'),
  ice: ICON.freeze,
  lightning: ICON.surge,
  earth: svg('<path d="M12 3 4 8v8l8 5 8-5V8z"/><path d="M4 8l8 5 8-5M12 13v8" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="1.4"/>'),
  poison: svg('<path d="M12 2.8s-6.2 7-6.2 11.2a6.2 6.2 0 0 0 12.4 0C18.2 9.8 12 2.8 12 2.8z"/><circle cx="10" cy="14.5" r="1.6" fill="rgba(255,255,255,.5)"/>'),
  wind: svg('<path d="M3 8.5h10.5a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 16.5h7"/>', { fill: false, w: 2.2 }),
};

// ================= Styles =================
export const UI_CSS = `
.label { font-family: var(--display); font-weight: 600; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
svg { display: block; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 18px; border-radius: 14px; border: 1px solid var(--line); background: rgba(255,255,255,.07);
  cursor: pointer; font-family: var(--display); font-weight: 700; font-size: 16px; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; transition: background .15s, transform .1s; }
.btn:hover { background: rgba(255,255,255,.12); }
.btn:active { transform: scale(.97); }
.btn svg { width: 18px; height: 18px; }
.btn.primary { border: 0; color: #1d1404; background: linear-gradient(160deg, #f6dc97, #d3a352 55%, #b88232); box-shadow: 0 8px 22px rgba(226,184,102,.28), inset 0 1px 0 rgba(255,255,255,.5); }
.btn.primary:hover { filter: brightness(1.06); }
.btn[disabled] { opacity: .45; pointer-events: none; }
.spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid rgba(255,255,255,.18); border-top-color: var(--accent); animation: spin .8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---------- Full-screen menus (world map, team) ---------- */
.screen { position: absolute; inset: 0; z-index: 8; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;
  padding: calc(16px + var(--sa-top)) max(18px, var(--sa-right)) calc(16px + var(--sa-bottom)) max(18px, var(--sa-left));
  background: radial-gradient(120% 90% at 50% 55%, rgba(8,10,12,.12), rgba(8,10,12,.55) 75%), linear-gradient(rgba(8,10,12,.62), rgba(8,10,12,.08) 38%, rgba(8,10,12,.1) 62%, rgba(8,10,12,.7)); }
.shead { display: flex; align-items: center; gap: 14px; min-height: 40px; }
.shead .ibtn { position: static; flex: none; }
.titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.titles h1 { margin: 0; font-family: var(--display); font-weight: 700; font-size: 34px; line-height: 1; letter-spacing: .02em; text-transform: uppercase;
  background: linear-gradient(#fff3d2, #e2b866 70%, #b9893c); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 2px 6px rgba(0,0,0,.6)); }
.titles h2 { margin: 0; font-family: var(--display); font-weight: 700; font-size: 26px; line-height: 1.05; letter-spacing: .02em; }
.titles .label { color: #d9c49a; }
.sbody { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 18px; min-height: 0; }
.note { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 14px; font-size: 14px; align-self: center; }
.note.bad { border-color: rgba(239,91,91,.5); }
.note .btn { padding: 8px 12px; font-size: 13px; }

/* World map */
.trackwrap { align-self: center; width: min(800px, 100%); padding: 16px 10px 12px; border-radius: 24px; background: rgba(14,16,18,.5); }
.track { position: relative; display: grid; grid-template-columns: repeat(5, 1fr); align-items: start; width: 100%; }
.track::before { content: ""; position: absolute; left: 10%; right: 10%; top: 34px; height: 3px; border-radius: 2px;
  background: repeating-linear-gradient(90deg, rgba(226,184,102,.75) 0 10px, transparent 10px 17px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.8)); }
.node { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; background: none; border: 0; padding: 0; cursor: pointer; }
.medal { width: 68px; height: 68px; border-radius: 50%; display: grid; place-items: center; position: relative; font-family: var(--display); font-weight: 700; font-size: 28px; color: #2a1b05;
  background: radial-gradient(circle at 35% 28%, #fff1c6, #e2b866 45%, #9c6c26 100%); box-shadow: 0 6px 18px rgba(0,0,0,.55), inset 0 -3px 6px rgba(80,48,8,.5), 0 0 0 3px rgba(20,16,10,.85), 0 0 0 4.5px rgba(226,184,102,.55);
  transition: transform .15s; }
.node:hover .medal { transform: translateY(-2px) scale(1.04); }
.medal svg { width: 30px; height: 30px; }
.node.open .medal { background: radial-gradient(circle at 35% 28%, #4c5560, #262b31 60%, #15181b); color: #f3e3bb; box-shadow: 0 6px 18px rgba(0,0,0,.55), inset 0 2px 3px rgba(255,255,255,.12), 0 0 0 3px rgba(20,16,10,.85), 0 0 0 4.5px #e2b866; }
.node.open .medal::after { content: ""; position: absolute; inset: -9px; border-radius: 50%; border: 2px solid rgba(226,184,102,.7); animation: halo 1.8s ease-out infinite; }
@keyframes halo { from { transform: scale(.88); opacity: 1; } to { transform: scale(1.18); opacity: 0; } }
.node.locked { cursor: default; }
.node.locked .medal { background: radial-gradient(circle at 35% 28%, #3a3f44, #1d2023 70%); color: #7d8388; box-shadow: 0 4px 12px rgba(0,0,0,.5), 0 0 0 3px rgba(20,16,10,.85), 0 0 0 4.5px rgba(255,255,255,.12); }
.node.locked .medal svg { width: 24px; height: 24px; }
.stars { display: flex; gap: 2px; color: rgba(255,255,255,.18); }
.stars svg { width: 15px; height: 15px; }
.stars .on { color: #f3c95c; filter: drop-shadow(0 0 4px rgba(243,201,92,.6)); }
.node .nname { font-family: var(--display); font-weight: 600; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: #e7dcc4; text-shadow: 0 1px 3px #000; white-space: nowrap; }
.node .nboss { font-size: 11.5px; color: var(--muted); display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.node .nboss svg { width: 12px; height: 12px; color: #d9a24c; }
.endless { align-self: center; display: flex; align-items: center; gap: 14px; padding: 12px 16px 12px 12px; border-radius: 18px; cursor: pointer; text-align: left; min-width: 260px; }
.endless .eic { width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; color: #1d1404; flex: none;
  background: linear-gradient(150deg, #c9a6ff, #7a52d6); box-shadow: inset 0 1px 0 rgba(255,255,255,.4), 0 6px 16px rgba(122,82,214,.35); }
.endless .eic svg { width: 28px; height: 28px; color: #fff; }
.endless b { display: block; font-family: var(--display); font-size: 20px; letter-spacing: .04em; text-transform: uppercase; }
.endless span { font-size: 13px; color: var(--muted); }
.endless.locked { cursor: default; opacity: .7; }
.endless.locked .eic { background: linear-gradient(150deg, #3a3f44, #23272b); box-shadow: none; }
.endless.locked .eic svg { color: #8a9095; width: 22px; height: 22px; }

/* Team select */
.cards { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.card { position: relative; width: 122px; padding: 8px 8px 10px; border-radius: 18px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; text-align: center;
  background: linear-gradient(180deg, color-mix(in srgb, var(--el) 16%, rgba(22,25,28,.86)), rgba(16,18,20,.9)); border: 1px solid var(--line); transition: transform .15s, border-color .15s, box-shadow .15s; }
.card:hover { transform: translateY(-2px); }
.card .pic { width: 92px; height: 92px; }
.card b { font-family: var(--display); font-size: 16px; letter-spacing: .03em; }
.card .role { font-size: 11.5px; line-height: 1.25; color: var(--muted); min-height: 29px; }
.card .boost { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: color-mix(in srgb, var(--el) 70%, white); font-family: var(--display); font-weight: 600; }
.card .tick { position: absolute; z-index: 1; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: #1d1404; background: var(--accent); opacity: 0; transform: scale(.6); transition: opacity .15s, transform .15s; }
.card .tick svg { width: 14px; height: 14px; }
.card[aria-pressed="true"] { border-color: color-mix(in srgb, var(--el) 80%, white); box-shadow: 0 0 0 1px color-mix(in srgb, var(--el) 50%, transparent), 0 10px 26px color-mix(in srgb, var(--el) 22%, transparent); }
.card[aria-pressed="true"] .tick { opacity: 1; transform: none; }
.card.locked { cursor: default; filter: grayscale(.9); opacity: .55; }
.card.locked:hover { transform: none; }
.card .lockt { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--muted); }
.card .lockt svg { width: 12px; height: 12px; }
.sfoot { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: space-between; }
.kit { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kit .chip { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: var(--c); }
.kit .chip svg { width: 20px; height: 20px; }
.kit .chip.locked { color: #5c6166; }
.err { color: #ff9a8a; font-size: 14px; }

/* Portraits */
.pic { position: relative; display: grid; place-items: center; border-radius: 14px; flex: none;
  background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--el, #888) 34%, #2a2f35), #14171a 72%); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -10px 18px rgba(0,0,0,.35); overflow: hidden; }
.pic img { width: 100%; height: 100%; object-fit: cover; }
.pic svg { width: 58%; height: 58%; color: var(--el, #ccc); filter: drop-shadow(0 2px 4px rgba(0,0,0,.5)); }

/* ---------- HUD ---------- */
.hud { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
.hud > * { pointer-events: auto; }
.topl { position: absolute; top: calc(10px + var(--sa-top)); left: max(12px, var(--sa-left)); display: flex; gap: 8px; }
.topr { position: absolute; top: calc(10px + var(--sa-top)); right: max(12px, var(--sa-right)); display: flex; gap: 8px; }
.stat { height: 40px; display: flex; align-items: center; gap: 7px; padding: 0 14px 0 10px; border-radius: 13px; font-family: var(--display); font-weight: 700; font-size: 21px; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.stat svg { width: 22px; height: 22px; flex: none; }
.stat.lives svg { color: #ff5f6b; filter: drop-shadow(0 0 5px rgba(255,80,96,.45)); }
.stat.gold svg { color: #f3c95c; filter: drop-shadow(0 0 5px rgba(243,201,92,.45)); }
.stat.wave svg { color: #d9c49a; }
.stat small { font-size: 14px; color: var(--muted); font-weight: 600; }
.stat.bump b { animation: bump .35s; }
.stat.hurt { animation: hurt .5s; }
@keyframes bump { 40% { transform: scale(1.22); color: #ffe39a; } }
@keyframes hurt { 30% { background: rgba(160,30,40,.75); border-color: rgba(255,95,107,.8); } }
.offline { width: 40px; height: 40px; border-radius: 13px; display: grid; place-items: center; color: #e9d6d6; }
.offline svg { width: 22px; height: 22px; }
.hbtn { width: 44px; height: 40px; border-radius: 13px; display: grid; place-items: center; cursor: pointer; padding: 0; font-family: var(--display); font-weight: 700; font-size: 17px; letter-spacing: .02em; }
.hbtn svg { width: 20px; height: 20px; }
.hbtn.speed { width: 52px; gap: 0; }
.hbtn.speed[aria-pressed="true"] { color: #1d1404; background: linear-gradient(160deg, #f6dc97, #d3a352); border-color: transparent; }

.boss { position: absolute; top: calc(58px + var(--sa-top)); left: 50%; transform: translateX(-50%); width: min(440px, 50%); padding: 6px 12px 8px; border-radius: 14px; display: flex; flex-direction: column; gap: 5px; }
.boss .bt { display: flex; align-items: center; gap: 6px; font-family: var(--display); font-weight: 700; font-size: 14px; letter-spacing: .12em; text-transform: uppercase; color: #ffd9c2; }
.boss .bt svg { width: 15px; height: 15px; color: #e2b866; }
.boss .bt small { margin-left: auto; font-size: 12px; letter-spacing: .04em; color: var(--muted); font-variant-numeric: tabular-nums; }
.boss .bar { height: 9px; border-radius: 5px; background: rgba(0,0,0,.55); overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,.7); }
.boss .bar i { display: block; height: 100%; width: calc(var(--f, 1) * 100%); border-radius: 5px; background: linear-gradient(#ff8a6a, #d8322c 60%, #9c1a1a); box-shadow: 0 0 10px rgba(255,80,60,.5); transition: width .2s; }

.banner { position: absolute; top: calc(58px + var(--sa-top)); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px; border-radius: 14px; font-size: 14px; font-weight: 500; white-space: nowrap; max-width: calc(100% - 32px); }
.banner span { overflow: hidden; text-overflow: ellipsis; }
.banner .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c, var(--accent)); box-shadow: 0 0 10px var(--c, var(--accent)); flex: none; }
.banner button { width: 30px; height: 30px; border-radius: 10px; border: 0; background: rgba(255,255,255,.08); display: grid; place-items: center; cursor: pointer; flex: none; }
.banner button svg { width: 15px; height: 15px; }
.hud.bossy .banner { top: calc(108px + var(--sa-top)); }

.shop { position: absolute; left: max(12px, var(--sa-left)); bottom: calc(10px + var(--sa-bottom)); max-width: calc(100% - max(12px, var(--sa-left)) - max(12px, var(--sa-right)) - 116px);
  display: flex; gap: 8px; padding: 6px; border-radius: 18px; }
.tabs { display: flex; flex-direction: column; gap: 4px; flex: none; }
.tab { width: 40px; flex: 1; min-height: 26px; border-radius: 11px; border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; padding: 0; }
.tab svg { width: 19px; height: 19px; }
.tab[aria-selected="true"] { background: rgba(255,255,255,.12); color: var(--fg); box-shadow: inset 0 0 0 1px rgba(226,184,102,.5); }
.items { display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; flex: 0 1 auto; min-width: 0; }
.items::-webkit-scrollbar { display: none; }
.item { --el: #ccc; position: relative; width: 74px; height: 86px; flex: none; padding: 5px 5px 4px; border-radius: 13px; border: 1px solid transparent; background: rgba(255,255,255,.04); cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 3px; transition: background .15s, border-color .15s, transform .1s; }
.item:hover { background: rgba(255,255,255,.09); }
.item:active { transform: scale(.96); }
.item .pic { width: 58px; height: 58px; border-radius: 11px; }
.item .pic svg { width: 64%; height: 64%; }
.item .price { display: flex; align-items: center; gap: 3px; font-family: var(--display); font-weight: 700; font-size: 15px; font-variant-numeric: tabular-nums; line-height: 1; }
.item .price svg { width: 13px; height: 13px; color: #f3c95c; }
.item[aria-pressed="true"] { border-color: color-mix(in srgb, var(--el) 85%, white); background: color-mix(in srgb, var(--el) 16%, transparent); box-shadow: 0 0 18px color-mix(in srgb, var(--el) 30%, transparent); }
.item.off .pic { filter: grayscale(1) brightness(.55); }
.item.off .price { color: #ff8f80; }
.item.off .price svg { filter: grayscale(1); }
.item .cd { position: absolute; left: 5px; right: 5px; top: 5px; height: 58px; border-radius: 11px; display: none; place-items: center; font-family: var(--display); font-weight: 700; font-size: 18px; color: #fff; text-shadow: 0 1px 4px #000;
  background: conic-gradient(rgba(0,0,0,.5) calc(var(--cd, 0) * 360deg), rgba(0,0,0,.08) 0); }
.item.cooling .pic { filter: grayscale(.6) brightness(.85); }
.item.cooling .cd { display: grid; }

.go { position: absolute; right: max(12px, var(--sa-right)); bottom: calc(10px + var(--sa-bottom)); width: 96px; height: 98px; border-radius: 20px; cursor: pointer; padding: 0; border: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; color: #1d1404; font-family: var(--display); font-weight: 700;
  background: linear-gradient(160deg, #f6dc97, #d3a352 55%, #b88232); box-shadow: 0 10px 26px rgba(226,184,102,.3), inset 0 1px 0 rgba(255,255,255,.55); transition: transform .1s, filter .15s; }
.go:active { transform: scale(.96); }
.go .gi { width: 34px; height: 34px; position: relative; display: grid; place-items: center; }
.go .gi svg.icon { width: 22px; height: 22px; }
.go .ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.go .ring circle { fill: none; stroke-width: 3; }
.go .ring .rt { stroke: rgba(40,26,4,.18); }
.go .ring .rf { stroke: #2a1b05; stroke-linecap: round; stroke-dasharray: 94.25; stroke-dashoffset: calc((1 - var(--t, 0)) * 94.25); }
.go b { font-size: 16px; letter-spacing: .1em; text-transform: uppercase; line-height: 1.05; }
.go small { font-size: 12px; font-weight: 600; letter-spacing: .06em; opacity: .75; }
.go.start { animation: glow 1.6s ease-in-out infinite; }
@keyframes glow { 50% { box-shadow: 0 10px 34px rgba(246,220,151,.55), 0 0 0 4px rgba(246,220,151,.25), inset 0 1px 0 rgba(255,255,255,.55); } }
.go.busy { color: var(--fg); background: var(--glass); border: 1px solid var(--line); box-shadow: none; cursor: default; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.go.busy small { color: var(--muted); opacity: 1; }

/* Mage details */
.info { position: absolute; z-index: 5; top: 50%; transform: translateY(-50%); width: 280px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border-radius: 18px; display: flex; flex-direction: column; gap: 9px;
  background: rgba(17,19,21,.82); }
.info.atl { left: max(12px, var(--sa-left)); }
.info.atr { right: max(12px, var(--sa-right)); }
.ihead { display: flex; align-items: center; gap: 10px; }
.ihead .pic { width: 54px; height: 54px; border-radius: 12px; }
.ihead .nm { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ihead b { font-family: var(--display); font-size: 19px; letter-spacing: .03em; line-height: 1; }
.pips { display: flex; gap: 3px; }
.pips i { width: 11px; height: 11px; transform: rotate(45deg) scale(.78); border-radius: 2px; background: rgba(255,255,255,.14); }
.pips i.on { background: var(--el); box-shadow: 0 0 6px var(--el); }
.ihead .x { width: 30px; height: 30px; border-radius: 10px; border: 0; background: rgba(255,255,255,.07); display: grid; place-items: center; cursor: pointer; align-self: flex-start; }
.ihead .x svg { width: 14px; height: 14px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { padding: 3px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 600; background: rgba(255,255,255,.08); color: #e6dcc6; }
.tag.stun { background: rgba(239,91,91,.2); color: #ffb4a8; }
.tag.ready { background: color-mix(in srgb, var(--el) 22%, transparent); color: color-mix(in srgb, var(--el) 60%, white); }
.sk { display: flex; flex-direction: column; gap: 2px; font-size: 13px; line-height: 1.35; color: #d5d8d9; }
.sk .label { color: color-mix(in srgb, var(--el) 55%, #d9c49a); }
.sk .meter { height: 4px; border-radius: 2px; background: rgba(255,255,255,.1); margin-top: 3px; overflow: hidden; }
.sk .meter i { display: block; height: 100%; width: calc(var(--c, 0) * 100%); background: var(--el); box-shadow: 0 0 6px var(--el); }
.info .btn { padding: 9px 12px; font-size: 14px; }
.info .btn svg { color: #f3c95c; width: 15px; height: 15px; }

/* ---------- Toast ---------- */
.toast { position: absolute; z-index: 12; left: 50%; top: calc(58px + var(--sa-top)); transform: translate(-50%, -8px); opacity: 0; pointer-events: none; padding: 9px 16px; border-radius: 13px;
  font-weight: 600; font-size: 14px; max-width: min(92%, 460px); text-align: center; transition: opacity .2s, transform .2s; }
.toast.on { opacity: 1; transform: translate(-50%, 0); }
.toast.bad { border-color: rgba(239,91,91,.55); }

/* ---------- Modals (pause, results) ---------- */
.modal { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; overflow-y: auto; background: rgba(5,6,7,.55);
  padding: calc(12px + var(--sa-top)) max(16px, var(--sa-right)) calc(12px + var(--sa-bottom)) max(16px, var(--sa-left)); }
.sheet { width: min(400px, 100%); border-radius: 22px; padding: 20px; display: flex; flex-direction: column; gap: 14px; background: rgba(24,27,30,.88); box-shadow: 0 24px 60px rgba(0,0,0,.5); }
.sheet h2 { margin: 0; font-family: var(--display); font-weight: 700; font-size: 32px; letter-spacing: .02em; line-height: 1; text-transform: uppercase; }
.sheet .row { display: flex; gap: 8px; flex-wrap: wrap; }
.sheet .row .btn { flex: 1; }
.sheet p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
.seg { display: flex; padding: 3px; border-radius: 12px; background: rgba(0,0,0,.35); border: 1px solid var(--line); }
.seg button { flex: 1; padding: 8px; border: 0; background: none; border-radius: 9px; cursor: pointer; font-family: var(--display); font-weight: 600; font-size: 14px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.seg button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
.res { text-align: center; align-items: center; }
.res h2 { font-size: 42px; background: linear-gradient(#fff3d2, #e2b866 70%, #b9893c); -webkit-background-clip: text; background-clip: text; color: transparent; }
.res.lost h2 { background: linear-gradient(#ffd2c8, #e0685a 70%, #a8362c); -webkit-background-clip: text; background-clip: text; }
.res .bigstars { display: flex; gap: 6px; color: rgba(255,255,255,.14); }
.res .bigstars svg { width: 46px; height: 46px; }
.res .bigstars .on { color: #f3c95c; filter: drop-shadow(0 0 10px rgba(243,201,92,.6)); animation: starpop .5s cubic-bezier(.3,1.6,.5,1) backwards; }
.res .bigstars .on:nth-child(2) { width: 56px; height: 56px; margin-top: -8px; animation-delay: .18s; }
.res .bigstars .on:nth-child(3) { animation-delay: .36s; }
.res .bigstars :nth-child(2) { width: 56px; height: 56px; margin-top: -8px; }
@keyframes starpop { from { transform: scale(0) rotate(-40deg); opacity: 0; } }
.facts { display: flex; gap: 8px; width: 100%; }
.fact { flex: 1; padding: 8px; border-radius: 12px; background: rgba(255,255,255,.05); display: flex; flex-direction: column; gap: 2px; }
.fact b { font-family: var(--display); font-size: 22px; font-variant-numeric: tabular-nums; }
.unl { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.unl .list { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.unl .u { display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px 5px; border-radius: 12px; background: rgba(226,184,102,.12); border: 1px solid rgba(226,184,102,.35); font-weight: 600; font-size: 13.5px; animation: starpop .5s .5s backwards; }
.unl .u .pic { width: 30px; height: 30px; border-radius: 9px; }
.status { display: flex; align-items: center; gap: 10px; justify-content: center; font-size: 14px; color: var(--muted); min-height: 22px; }
.status.bad { color: #ffb4a8; }

/* ---------- Short screens (phone landscape, and upright phones turned sideways): side columns ---------- */
.root.short .topl { top: calc(6px + var(--sa-top)); left: auto; right: max(8px, var(--sa-right)); flex-direction: column; width: 84px; gap: 5px; margin-top: 44px; }
.root.short .topr { top: calc(6px + var(--sa-top)); right: max(8px, var(--sa-right)); width: 84px; gap: 4px; }
.root.short .hbtn { height: 38px; flex: 1; width: auto; }
.root.short .stat { height: 32px; font-size: 18px; padding: 0 8px 0 7px; gap: 5px; border-radius: 11px; }
.root.short .stat svg { width: 17px; height: 17px; }
.root.short .stat small { font-size: 12px; }
.root.short .offline { width: 84px; height: 30px; border-radius: 11px; }
.root.short .shop { top: calc(6px + var(--sa-top)); bottom: calc(6px + var(--sa-bottom)); left: max(8px, var(--sa-left)); width: 76px; max-width: none; flex-direction: column; padding: 5px; gap: 5px; border-radius: 16px; }
.root.short .tabs { flex-direction: row; gap: 2px; }
.root.short .tab { width: auto; height: 28px; min-height: 0; }
.root.short .tab svg { width: 17px; height: 17px; }
.root.short .items { flex-direction: column; overflow-x: hidden; overflow-y: auto; gap: 4px; }
.root.short .item { width: 100%; height: auto; padding: 4px 3px 3px; gap: 2px; }
.root.short .item .pic { width: 44px; height: 44px; border-radius: 10px; }
.root.short .item .cd { left: auto; right: auto; width: 44px; height: 44px; top: 4px; font-size: 15px; border-radius: 10px; }
.root.short .item .price { font-size: 13.5px; }
.root.short .go { right: max(8px, var(--sa-right)); bottom: calc(6px + var(--sa-bottom)); width: 84px; height: 80px; border-radius: 17px; }
.root.short .go .gi { width: 30px; height: 30px; }
.root.short .go b { font-size: 14px; }
.root.short .go small { font-size: 11px; }
.root.short .boss { top: calc(6px + var(--sa-top)); width: min(360px, calc(100% - 220px)); padding: 4px 10px 6px; }
.root.short .boss .bar { height: 7px; }
.root.short .banner { top: calc(6px + var(--sa-top)); max-width: calc(100% - 220px); font-size: 13px; }
.root.short .hud.bossy .banner { top: calc(52px + var(--sa-top)); }
.root.short .toast { top: calc(52px + var(--sa-top)); }
.root.short .info { width: 260px; padding: 10px; gap: 7px; }
.root.short .info.atl { left: calc(max(8px, var(--sa-left)) + 84px); }
.root.short .info.atr { right: calc(max(8px, var(--sa-right)) + 92px); }
.root.short .sk { font-size: 12.5px; }
.root.short .screen { gap: 8px; padding-top: calc(10px + var(--sa-top)); padding-bottom: calc(10px + var(--sa-bottom)); }
.root.short .titles h1 { font-size: 28px; }
.root.short .titles h2 { font-size: 22px; }
.root.short .sbody { gap: 12px; }
.root.short .medal { width: 56px; height: 56px; font-size: 24px; }
.root.short .track::before { top: 28px; }
.root.short .trackwrap { padding: 12px 8px 10px; }
.root.short .card { width: 112px; padding: 6px 6px 8px; gap: 2px; }
.root.short .card .pic { width: 74px; height: 74px; }
.root.short .card .role { min-height: 0; font-size: 11px; }
.root.short .sheet { padding: 16px; gap: 10px; }
.root.short .res h2 { font-size: 34px; }
.root.short .res .bigstars svg { width: 36px; height: 36px; }
.root.short .res .bigstars :nth-child(2) { width: 44px; height: 44px; }
.root.short .facts .fact b { font-size: 19px; }
@media (prefers-reduced-motion: reduce) { .node.open .medal::after, .go.start, .res .bigstars .on, .unl .u { animation: none; } }
`;

// ================= Markup =================
const MARKUP = `
<div class="hud" id="hud" hidden>
  <div class="topl" id="stats">
    <div class="stat glass lives" id="livesBox" title="Lives">${ICON.heart}<b id="lives">20</b></div>
    <div class="stat glass gold" id="goldBox" title="Gold">${ICON.coin}<b id="gold">0</b></div>
    <div class="stat glass wave" title="Wave">${ICON.flag}<b id="wave">0</b><small id="waveOf"></small></div>
    <div class="offline glass" id="offline" title="Not saved yet: reconnecting" hidden>${ICON.cloud}</div>
  </div>
  <div class="topr">
    <button class="hbtn glass speed" id="speedBtn" aria-pressed="false" aria-label="Game speed">1×</button>
    <button class="hbtn glass" id="pauseBtn" aria-label="Pause">${ICON.pause}</button>
  </div>
  <div class="boss glass" id="boss" hidden><div class="bt">${ICON.crown}<span id="bossName"></span><small id="bossHp"></small></div><div class="bar"><i id="bossFill"></i></div></div>
  <div class="banner glass" id="banner" hidden><i class="dot"></i><span id="bannerText"></span><button id="bannerX" aria-label="Cancel">${ICON.close}</button></div>
  <div class="shop glass" id="shop">
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="mages" aria-label="Mages" title="Mages">${ICON.hat}</button>
      <button class="tab" role="tab" data-tab="traps" aria-label="Traps" title="Traps">${ICON.spike}</button>
      <button class="tab" role="tab" data-tab="spells" aria-label="Spells" title="Spells">${ICON.sparkle}</button>
    </div>
    <div class="items" id="items"></div>
  </div>
  <button class="go" id="goBtn"><span class="gi"><svg class="ring" viewBox="0 0 34 34"><circle class="rt" cx="17" cy="17" r="15"/><circle class="rf" cx="17" cy="17" r="15"/></svg><span id="goIcon"></span></span><b id="goLabel">Start</b><small id="goSub"></small></button>
  <div class="info glass" id="info" hidden></div>
</div>
<div class="screen" id="screen" hidden></div>
<div class="modal" id="modal" hidden><div class="sheet glass" id="sheet"></div></div>
<div class="toast glass" id="toast" role="status" aria-live="polite"></div>`;

/**
 * createUI(rootEl, on) → the screens and HUD. `on` receives the player's choices:
 * exit(), stage(n), endless(), back(), play(team), shop(kind, id), startWave(), speed(), pause(), resume(), quality(name),
 * quit(), sell(), closeInfo(), cancelMode(), result(action: 'retry' | 'next' | 'map' | 'resend'), resendLeftover(), reload().
 */
export function createUI(rootEl, on) {
  rootEl.insertAdjacentHTML('beforeend', MARKUP);
  const $ = id => rootEl.querySelector('#' + id);
  const hud = $('hud'), screen = $('screen'), modal = $('modal'), sheet = $('sheet'), info = $('info'), items = $('items');
  let portraits = {};
  const portrait = kind => (portraits[kind] ? `<img src="${portraits[kind]}" alt="">` : EMBLEM[kind]);
  const pic = kind => `<span class="pic" data-mage="${kind}" style="--el:${MAGE_COLOR[kind]}">${portrait(kind)}</span>`;
  const iconPic = (icon, color) => `<span class="pic" style="--el:${color}">${ICON[icon]}</span>`;
  const KIT_COLOR = { spike: '#d4d8de', barricade: '#d29a5c', frost: '#8fd8ff', mine: '#ff8a4a', meteor: '#ff7a3d', freeze: '#9be6ff', surge: '#c9a6ff' };
  const starRow = (n, cls = 'stars') => `<span class="${cls}">${[0, 1, 2].map(i => `<span class="${i < n ? 'on' : ''}">${ICON.star}</span>`).join('')}</span>`;

  // ---------- Toast ----------
  let toastTimer = 0;
  function toast(text, bad = false) {
    const t = $('toast');
    t.textContent = text; t.classList.toggle('bad', bad); t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ---------- World map ----------
  /** state: { progress, unlocked, note?: { text, bad, retry } , error?: string, loading?: bool } */
  function world(state) {
    hideHud(); closeModal();
    screen.hidden = false;
    const p = state.progress, u = state.unlocked;
    const nodes = state.loading || !p ? '' : [1, 2, 3, 4, 5].map(s => {
      const open = u.stages.includes(s), stars = p.cleared[s] || 0, boss = STAGE_BOSS[s - 1];
      const cls = !open ? 'locked' : stars ? 'done' : 'open';
      return `<button class="node ${cls}" data-stage="${s}" ${open ? '' : 'aria-disabled="true"'} aria-label="Stage ${s}${open ? '' : ', locked'}">
        <span class="medal">${open ? (s === 5 ? ICON.tree : s) : ICON.lock}</span>
        ${starRow(stars)}
        <span class="nname">Stage ${s}</span>
        <span class="nboss">${ICON.crown}${BOSS_NAME[boss]}</span>
      </button>`;
    }).join('');
    const endless = state.loading || !p ? '' : u.endless
      ? `<button class="endless glass" id="endlessBtn"><span class="eic">${ICON.infinity}</span><span><b>Endless</b><span>${p.endlessBest ? `Best score ${fmt(p.endlessBest)}` : 'How long can you hold?'}</span></span></button>`
      : `<div class="endless glass locked"><span class="eic">${ICON.lock}</span><span><b>Endless</b><span>Clear stage 5 to unlock</span></span></div>`;
    const note = state.note ? `<div class="note glass ${state.note.bad ? 'bad' : ''}">${state.note.busy ? '<span class="spin"></span>' : ''}<span>${esc(state.note.text)}</span>${state.note.retry ? `<button class="btn" id="noteRetry">${ICON.retry}Retry</button>` : ''}</div>` : '';
    screen.innerHTML = `
      <div class="shead"><button class="ibtn glass" id="exitBtn2" aria-label="Exit to games">${ICON.back}</button>
        <div class="titles"><h1>Mage Siege</h1><span class="label">World 1 &middot; The Greenwood</span></div></div>
      <div class="sbody">
        ${state.loading ? '<div class="note glass"><span class="spin"></span><span>Loading your progress…</span></div>' : ''}
        ${state.error ? `<div class="note glass bad"><span>${esc(state.error)}</span><button class="btn" id="loadRetry">${ICON.retry}Retry</button></div>` : ''}
        ${nodes ? `<div class="trackwrap glass"><div class="track">${nodes}</div></div>` : ''}
        ${endless}
        ${note}
      </div>`;
    screen.querySelector('#exitBtn2').onclick = () => on.exit();
    screen.querySelectorAll('.node:not(.locked)').forEach(b => { b.onclick = () => on.stage(+b.dataset.stage); });
    const eb = screen.querySelector('#endlessBtn'); if (eb) eb.onclick = () => on.endless();
    const nr = screen.querySelector('#noteRetry'); if (nr) nr.onclick = () => on.resendLeftover();
    const lr = screen.querySelector('#loadRetry'); if (lr) lr.onclick = () => on.reload();
  }

  // ---------- Team select ----------
  /** opts: { mode, stage, unlocked, team (preselected), busy, error } */
  let teamState = null;
  function team(opts) {
    hideHud(); closeModal();
    const u = opts.unlocked, size = Math.min(5, u.mages.length);
    if (!teamState || teamState.key !== `${opts.mode}${opts.stage}`) {
      const pre = (opts.team || []).filter(k => u.mages.includes(k));
      for (const k of u.mages) if (pre.length < size && !pre.includes(k)) pre.push(k);
      teamState = { key: `${opts.mode}${opts.stage}`, pick: pre.slice(0, size) };
    }
    const pick = teamState.pick, all = u.mages.length <= 5;
    screen.hidden = false;
    const cards = Object.keys(MAGES).map(k => {
      const open = u.mages.includes(k), on2 = pick.includes(k), boost = MAGES[k].boost;
      return `<button class="card ${open ? '' : 'locked'}" data-mage="${k}" style="--el:${MAGE_COLOR[k]}" aria-pressed="${on2}" ${open ? '' : 'aria-disabled="true"'}>
        <span class="tick">${ICON.check}</span>${pic(k)}<b>${MAGES[k].name.replace(' Mage', '')}</b>
        ${open ? `<span class="role">${ROLE[k]}</span><span class="boost">${boost.length ? 'Boost: ' + boost.map(t => TERRAIN_NAME[t]).join(', ') : 'No boost terrain yet'}</span>`
    : `<span class="lockt">${ICON.lock}Clear stage ${unlockStage('mages', k)}</span>`}
      </button>`;
    }).join('');
    const chip = (group, id, label, icon) => {
      const open = u[group].includes(id);
      return `<span class="chip ${open ? '' : 'locked'}" style="--c:${KIT_COLOR[id]}" title="${esc(label)}${open ? '' : ` (clear stage ${unlockStage(group, id)})`}">${open ? ICON[icon] : ICON.lock}</span>`;
    };
    const title = opts.mode === 'endless' ? 'Endless' : `Stage ${opts.stage}`;
    screen.innerHTML = `
      <div class="shead"><button class="ibtn glass" id="teamBack" aria-label="Back to the world map">${ICON.back}</button>
        <div class="titles"><span class="label">${title}${opts.mode === 'stage' ? ` &middot; Boss: ${BOSS_NAME[STAGE_BOSS[opts.stage - 1]]}` : ' &middot; Every 10th wave a boss'}</span><h2>Choose your team</h2></div>
        <span class="label" id="teamCount">${all ? 'All your mages join' : `${pick.length} / ${size} chosen`}</span></div>
      <div class="sbody"><div class="cards">${cards}</div></div>
      <div class="sfoot">
        <div class="kit"><span class="label">Traps</span>${['spike', 'barricade', 'frost', 'mine'].map(t => chip('traps', t, TRAP_TEXT[t].name, t)).join('')}
          <span class="label" style="margin-left:8px">Spells</span>${['meteor', 'freeze', 'surge'].map(t => chip('spells', t, SPELL_TEXT[t].name, t)).join('')}</div>
        ${opts.error ? `<span class="err">${esc(opts.error)}</span>` : ''}
        <button class="btn primary" id="playBtn" ${opts.busy || pick.length !== size ? 'disabled' : ''}>${opts.busy ? '<span class="spin"></span>Starting' : `${ICON.play}Start ${opts.mode === 'endless' ? 'Endless' : 'stage'}`}</button>
      </div>`;
    screen.querySelector('#teamBack').onclick = () => { teamState = null; on.back(); };
    screen.querySelector('#playBtn').onclick = () => on.play(pick.slice());
    screen.querySelectorAll('.card:not(.locked)').forEach(c => {
      c.onclick = () => {
        if (all) return;
        const k = c.dataset.mage, i = pick.indexOf(k);
        if (i >= 0) pick.splice(i, 1); else if (pick.length < size) pick.push(k); else { toast(`Pick ${size} mages: tap one to swap it out`); return; }
        team(opts);
      };
    });
  }

  // ---------- HUD ----------
  let tab = 'mages', cfg = null, shopSel = null, last = {};
  const tabs = rootEl.querySelectorAll('.tab');
  tabs.forEach(t => { t.onclick = () => { tab = t.dataset.tab; renderShop(); }; });
  $('speedBtn').onclick = () => on.speed();
  $('pauseBtn').onclick = () => on.pause();
  $('goBtn').onclick = () => on.startWave();
  $('bannerX').onclick = () => on.cancelMode();

  function showHud(runCfg) {
    cfg = runCfg; tab = 'mages'; shopSel = null; last = {};
    screen.hidden = true; screen.innerHTML = '';
    hud.hidden = false;
    info.hidden = true;
    $('banner').hidden = true;
    renderShop();
  }
  function hideHud() { hud.hidden = true; info.hidden = true; cfg = null; }

  function renderShop() {
    if (!cfg) return;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    let list;
    if (tab === 'mages') list = cfg.team.map(k => ({ kind: 'mage', id: k, title: MAGES[k].name, html: pic(k), color: MAGE_COLOR[k] }));
    else if (tab === 'traps') list = cfg.traps.map(k => ({ kind: 'trap', id: k, title: `${TRAP_TEXT[k].name}: ${TRAP_TEXT[k].text}`, html: iconPic(k, KIT_COLOR[k]), color: KIT_COLOR[k], price: TRAPS[k].price }));
    else list = cfg.spells.map(k => ({ kind: 'spell', id: k, title: `${SPELL_TEXT[k].name}: ${SPELL_TEXT[k].text}`, html: iconPic(k, KIT_COLOR[k]), color: KIT_COLOR[k], price: SPELLS[k].cost }));
    items.innerHTML = list.map(it => `<button class="item" data-kind="${it.kind}" data-id="${it.id}" style="--el:${it.color}" title="${esc(it.title)}" aria-label="${esc(it.title)}">
      ${it.html}<span class="price">${ICON.coin}<span class="pv">${it.price ?? ''}</span></span>${it.kind === 'spell' ? '<span class="cd"></span>' : ''}</button>`).join('');
    items.querySelectorAll('.item').forEach(b => { b.onclick = () => on.shop(b.dataset.kind, b.dataset.id); });
    last.items = null;
  }

  /** Per-frame HUD refresh; touches the DOM only where something changed. ctx: { speed, sel: { kind, id } | null, offline } */
  function frame(sim, ctx) {
    if (!cfg || hud.hidden) return;
    const set = (key, val, fn) => { if (last[key] !== val) { last[key] = val; fn(val); } };
    set('lives', sim.lives, v => {
      if (last.livesSeen !== undefined && v < last.livesSeen) { const b = $('livesBox'); b.classList.remove('hurt'); void b.offsetWidth; b.classList.add('hurt'); }
      last.livesSeen = v; $('lives').textContent = v;
    });
    set('gold', sim.gold, v => {
      if (last.goldSeen !== undefined && v > last.goldSeen) { const b = $('goldBox'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
      last.goldSeen = v; $('gold').textContent = fmt(v);
    });
    set('wave', sim.wave, v => { $('wave').textContent = v; });
    set('waveOf', cfg.mode === 'endless' ? '' : `/${totalWaves(sim)}`, v => { $('waveOf').textContent = v; });
    set('speed', ctx.speed, v => { const b = $('speedBtn'); b.textContent = v === 2 ? '2×' : '1×'; b.setAttribute('aria-pressed', String(v === 2)); });
    set('offline', !!ctx.offline, v => { $('offline').hidden = !v; });

    // Boss bar: the first boss on the board
    let boss = null;
    for (const e of sim.enemies) if (ENEMIES[e.kind].boss) { boss = e; break; }
    set('bossId', boss ? boss.id : 0, () => {
      $('boss').hidden = !boss; hud.classList.toggle('bossy', !!boss);
      if (boss) $('bossName').textContent = BOSS_NAME[boss.kind] || 'Boss';
    });
    if (boss) {
      const f = Math.max(0, boss.hp / boss.maxHp);
      set('bossF', Math.round(f * 400), () => { $('bossFill').style.setProperty('--f', f.toFixed(4)); $('bossHp').textContent = `${fmt(Math.max(0, Math.ceil(boss.hp)))} / ${fmt(boss.maxHp)}`; });
    }

    // Wave button: Start before wave 1, Next wave (with the break countdown) between waves, enemies left during a wave
    const phase = sim.phase, br = sim.breakT / secs(BUILD_BREAK_SECS);
    let goKey;
    if (phase === 'build' && sim.wave === 0) goKey = 'start';
    else if (phase === 'build') goKey = `next${Math.ceil(sim.breakT / TICK_HZ)}`;
    else if (phase === 'wave') goKey = `wave${sim.enemies.length + sim.spawnQueue.length}`;
    else goKey = 'over';
    set('go', goKey, () => {
      const g = $('goBtn');
      g.classList.toggle('start', goKey === 'start');
      g.classList.toggle('busy', phase !== 'build');
      g.disabled = phase !== 'build';
      if (goKey === 'start') { $('goIcon').innerHTML = ICON.play.replace('<svg', '<svg class="icon"'); $('goLabel').textContent = 'Start'; $('goSub').textContent = `Wave 1`; }
      else if (phase === 'build') { $('goIcon').innerHTML = ICON.next.replace('<svg', '<svg class="icon"'); $('goLabel').textContent = 'Next wave'; $('goSub').textContent = `in ${Math.ceil(sim.breakT / TICK_HZ)} s`; }
      else if (phase === 'wave') { $('goIcon').innerHTML = ICON.flag.replace('<svg', '<svg class="icon"'); $('goLabel').textContent = `Wave ${sim.wave}`; $('goSub').textContent = `${sim.enemies.length + sim.spawnQueue.length} left`; }
      else { $('goIcon').innerHTML = ''; $('goLabel').textContent = ''; $('goSub').textContent = ''; }
    });
    $('goBtn').style.setProperty('--t', phase === 'build' && sim.wave > 0 ? br.toFixed(3) : '0');

    // Shop: prices, what is affordable, spell cooldowns, the selected item
    const price = magePrice(sim), selKey = ctx.sel ? `${ctx.sel.kind}:${ctx.sel.id}` : '';
    const stateKey = `${tab}|${sim.gold}|${price}|${sim.traps.length}|${selKey}|${cfg.spells.map(s => Math.ceil(sim.spellCd[s] / TICK_HZ)).join(',')}`;
    if (last.items !== stateKey) {
      last.items = stateKey;
      items.querySelectorAll('.item').forEach(b => {
        const { kind, id } = b.dataset;
        let cost, off, cd = 0;
        if (kind === 'mage') { cost = price; off = sim.gold < price; }
        else if (kind === 'trap') { cost = TRAPS[id].price; off = sim.gold < cost || sim.traps.length >= MAX_TRAPS; }
        else { cost = SPELLS[id].cost; cd = sim.spellCd[id]; off = sim.gold < cost || cd > 0; }
        b.querySelector('.pv').textContent = cost;
        b.classList.toggle('off', off);
        b.setAttribute('aria-pressed', String(selKey === `${kind}:${id}`));
        if (kind === 'spell') {
          b.classList.toggle('cooling', cd > 0);
          const c = b.querySelector('.cd');
          c.style.setProperty('--cd', (cd / secs(SPELLS[id].cooldown)).toFixed(3));
          c.textContent = cd > 0 ? Math.ceil(cd / TICK_HZ) : '';
        }
      });
    }
  }

  /** Shows the mode hint (text, colour) with a cancel button, or hides it (null). */
  function banner(text, color) {
    const b = $('banner');
    b.hidden = !text;
    if (text) { $('bannerText').textContent = text; b.style.setProperty('--c', color || 'var(--accent)'); }
  }

  // ---------- Mage details ----------
  let infoKey = '';
  /** Shows a mage's details on the side away from it (`side`: 'l' | 'r'), refreshed each frame while open; null hides. */
  function mageInfo(m, sim, side) {
    if (!m) { info.hidden = true; infoKey = ''; return; }
    const terrain = sim.map.tiles[m.tile].terrain, stunned = m.stunT > 0, d = describeMage(m.kind, m.level), ready = m.charge >= 1;
    // The charge meter moves every frame without rebuilding the card (a rebuild mid-click would swallow the click)
    const meter = info.querySelector('.meter');
    if (meter) meter.style.setProperty('--c', Math.min(1, m.charge).toFixed(3));
    const key = `${m.id}|${m.level}|${m.tile}|${stunned}|${ready}|${side}`;
    if (key === infoKey) return;
    const fresh = !infoKey.startsWith(`${m.id}|`);
    infoKey = key;
    info.hidden = false;
    info.className = `info glass at${side}`;
    info.style.setProperty('--el', MAGE_COLOR[m.kind]);
    const note = terrainNote(m.kind, terrain);
    const html = `
      <div class="ihead">${pic(m.kind)}<div class="nm"><b>${MAGES[m.kind].name}</b><span class="pips">${[1, 2, 3, 4, 5].map(l => `<i class="${l <= m.level ? 'on' : ''}"></i>`).join('')}</span>
        <span class="label">Level ${m.level}${m.level < 5 ? ' &middot; merge two to level up' : ' &middot; max'}</span></div><button class="x" id="infoX" aria-label="Close">${ICON.close}</button></div>
      ${stunned || note || ready ? `<div class="tags">${stunned ? '<span class="tag stun">Stunned: can\'t act</span>' : ''}${ready && !stunned ? '<span class="tag ready">Active ready: tap the mage</span>' : ''}${note ? `<span class="tag">${esc(note)}</span>` : ''}</div>` : ''}
      <div class="sk"><span class="label">Passive &middot; ${d.passive.name}</span><span>${esc(d.passive.text)}</span></div>
      <div class="sk"><span class="label">Active &middot; ${d.active.name}${MAGES[m.kind].activeTargeted ? ' (aimed)' : ''}</span><span>${esc(d.active.text)}</span><span class="meter" style="--c:${Math.min(1, m.charge).toFixed(2)}"><i></i></span></div>
      <button class="btn" id="sellBtn" ${stunned ? 'disabled' : ''}>Sell for ${ICON.coin}${Math.floor(m.spent / 2)}</button>`;
    info.innerHTML = html;
    if (fresh) info.scrollTop = 0;
    info.querySelector('#infoX').onclick = () => on.closeInfo();
    info.querySelector('#sellBtn').onclick = () => on.sell();
  }

  // ---------- Pause ----------
  /** opts: { quality, endless, confirm } */
  function pause(opts) {
    if (!opts) { closeModal(); return; }
    modal.hidden = false;
    sheet.className = 'sheet glass';
    const q = opts.quality;
    sheet.innerHTML = opts.confirm
      ? `<h2>${opts.endless ? 'End this run?' : 'Quit the stage?'}</h2>
         <p>${opts.endless ? 'Your score so far is recorded if you cleared at least one wave.' : 'This run is lost: stages are only saved when cleared.'}</p>
         <div class="row"><button class="btn" id="qNo">Keep playing</button><button class="btn primary" id="qYes">${opts.endless ? 'End run' : 'Quit'}</button></div>`
      : `<h2>Paused</h2>
         <div><span class="label">Graphics</span><div class="seg" id="qseg" style="margin-top:6px">${['high', 'medium', 'low'].map(n => `<button data-q="${n}" aria-pressed="${q === n}">${n}</button>`).join('')}</div></div>
         <div class="row"><button class="btn" id="quitBtn">${ICON.map}${opts.endless ? 'End run' : 'Quit'}</button><button class="btn primary" id="resumeBtn">${ICON.play}Resume</button></div>`;
    if (opts.confirm) {
      sheet.querySelector('#qNo').onclick = () => pause({ ...opts, confirm: false });
      sheet.querySelector('#qYes').onclick = () => on.quit();
    } else {
      sheet.querySelector('#resumeBtn').onclick = () => on.resume();
      sheet.querySelector('#quitBtn').onclick = () => pause({ ...opts, confirm: true });
      sheet.querySelectorAll('#qseg button').forEach(b => { b.onclick = () => { on.quality(b.dataset.q); pause({ ...opts, quality: b.dataset.q }); }; });
    }
  }

  // ---------- Results ----------
  /**
   * opts: { mode, stage, won, outcome (local until verified), state: 'verify' | 'done' | 'failed' | 'rejected',
   * error?, stars?, newUnlocks?: { mages, traps, spells, endless }, score?, best?, rank? }
   */
  function results(o) {
    hud.hidden = true; info.hidden = true;
    modal.hidden = false;
    const endless = o.mode === 'endless', rejected = o.state === 'rejected';
    sheet.className = `sheet glass res ${o.won || endless ? '' : 'lost'}`;
    const title = rejected ? 'Not verified' : endless ? 'Run over' : o.won ? 'Victory' : 'Defeat';
    const kicker = endless ? 'Endless' : `Stage ${o.stage}`;
    const done = o.state === 'done';
    const stars = done && !endless ? o.stars : 0;
    const facts = endless
      ? `<div class="fact"><span class="label">Waves</span><b>${o.outcome.wavesCleared}</b></div><div class="fact"><span class="label">Score</span><b>${done ? fmt(o.score) : '–'}</b></div>
         <div class="fact"><span class="label">Best</span><b>${done ? fmt(o.best ?? o.score) : '–'}</b></div><div class="fact"><span class="label">Rank</span><b>${done && o.rank ? '#' + fmt(o.rank) : '–'}</b></div>`
      : `<div class="fact"><span class="label">Lives left</span><b>${o.outcome.lives}<small style="font-size:14px;color:var(--muted)"> / 20</small></b></div><div class="fact"><span class="label">Waves</span><b>${o.outcome.wavesCleared}<small style="font-size:14px;color:var(--muted)"> / 10</small></b></div>`;
    const nu = o.newUnlocks, unl = done && nu && (nu.mages.length + nu.traps.length + nu.spells.length + (nu.endless ? 1 : 0)) ? `
      <div class="unl"><span class="label">Unlocked</span><div class="list">
        ${nu.mages.map(k => `<span class="u">${pic(k)}${MAGES[k].name}</span>`).join('')}
        ${nu.traps.map(k => `<span class="u">${iconPic(k, KIT_COLOR[k])}${TRAP_TEXT[k].name}</span>`).join('')}
        ${nu.spells.map(k => `<span class="u">${iconPic(k, KIT_COLOR[k])}${SPELL_TEXT[k].name}</span>`).join('')}
        ${nu.endless ? `<span class="u"><span class="pic" style="--el:#c9a6ff">${ICON.infinity}</span>Endless mode</span>` : ''}
      </div></div>` : '';
    const status = o.state === 'verify' ? '<div class="status"><span class="spin"></span>Verifying your run…</div>'
      : o.state === 'failed' ? `<div class="status bad">Couldn't save your result.</div>`
        : rejected ? `<div class="status bad">This run couldn't be verified, so it doesn't count.</div>${o.error ? `<p>${esc(o.error)}</p>` : ''}` : '';
    const canNext = done && !endless && o.won && o.stage < 5;
    const buttons = rejected ? `<button class="btn primary" data-act="map">${ICON.map}World map</button>`
      : o.state === 'failed' ? `<button class="btn" data-act="map">${ICON.map}Later</button><button class="btn primary" data-act="resend">${ICON.retry}Retry</button>`
        : `<button class="btn" data-act="map" ${done ? '' : 'disabled'}>${ICON.map}Map</button><button class="btn ${canNext ? '' : 'primary'}" data-act="retry" ${done ? '' : 'disabled'}>${ICON.retry}${endless ? 'Again' : 'Retry'}</button>${canNext ? `<button class="btn primary" data-act="next">Next${ICON.next}</button>` : ''}`;
    sheet.innerHTML = `<span class="label">${kicker}</span><h2>${title}</h2>
      ${!endless && !rejected ? starRow(stars, 'bigstars') : ''}
      ${rejected ? '' : `<div class="facts">${facts}</div>`}
      ${unl}${status}
      <div class="row" style="width:100%">${buttons}</div>`;
    sheet.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => on.result(b.dataset.act); });
  }

  function closeModal() { modal.hidden = true; sheet.innerHTML = ''; }

  /** HUD insets for the camera framing (game-frame px): the bars around the board, or a small margin in menus. */
  function insets() {
    if (hud.hidden) return { top: 8, right: 8, bottom: 8, left: 8 };
    const frameW = rootEl.clientWidth, frameH = rootEl.clientHeight, shop = $('shop'), go = $('goBtn');
    if (rootEl.classList.contains('short')) {
      return { top: 6, bottom: 6, left: shop.offsetLeft + shop.offsetWidth + 4, right: frameW - go.offsetLeft + 4 };
    }
    const top = $('stats');
    return { top: top.offsetTop + top.offsetHeight + 6, bottom: frameH - Math.min(shop.offsetTop, go.offsetTop) + 4, left: 8, right: 8 };
  }

  return {
    world, team, showHud, hideHud, frame, banner, mageInfo, pause, results, toast, insets,
    get infoOpen() { return !info.hidden; },
    /** Mage portraits (kind → image URL) for the shop, team cards and details; swapped in place, so no screen is rebuilt under a click. */
    setPortraits(map) {
      portraits = { ...map };
      rootEl.querySelectorAll('.pic[data-mage]').forEach(el => { if (portraits[el.dataset.mage]) el.innerHTML = portrait(el.dataset.mage); });
    },
  };
}
